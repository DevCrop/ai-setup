"""Register code projects and deploy AO settings without replacing existing choices (roles change only with apply --lanes)."""
import argparse
import json
import os
from pathlib import Path
import re
import shlex
import sys
from urllib.request import Request, urlopen
import qa

BASE = Path(__file__).resolve().parent
REGISTRY = BASE / 'projects.json'


def api(method, path, body=None):
    run_file = Path(os.environ.get('AO_RUN_FILE', str(Path.home() / '.ao' / 'running.json')))
    port = json.loads(run_file.read_text(encoding='utf-8'))['port']
    request = Request(f'http://127.0.0.1:{port}/api/v1/{path}', method=method,
                      data=json.dumps(body).encode() if body is not None else None,
                      headers={'Content-Type': 'application/json'})
    with urlopen(request, timeout=30) as response:
        return json.load(response) if response.status != 204 else None


# Role lanes (docs/DECISIONS.md, 2026-10-12 and 2026-10-13): Claude workers on Haiku in auto mode, a Claude orchestrator
# on Opus, and Codex as the PR reviewer so the reviewer is a different vendor from the author. Codex as a worker ran `rm` without approval
# and could not commit (2026-10-13), so it is never the worker. Full model IDs: AO 0.13.7 rejects aliases such as `haiku`
# (UNSUPPORTED_MODEL). Update the IDs here when the models change. Reviewer effort is also passed per pass (`ao review trigger --effort high`)
# because the CLI round trip drops agentConfig.effort; this tool talks to the API, which keeps it.
LANES = {
    'worker': {'agent': 'claude-code', 'agentConfig': {'model': 'claude-haiku-5-5', 'permissions': 'auto'}},
    'orchestrator': {'agent': 'claude-code', 'agentConfig': {'model': 'claude-opus-5-5'}},  # permission: AO's default (no decision sets it)
    'reviewers': [{'harness': 'codex', 'agentConfig': {'model': 'gpt-6.1-sol', 'effort': 'high'}}],
}


def _role_view(role):
    """Only the fields worth showing from a role value (worker/orchestrator dict or reviewers list)."""
    keep = ('agent', 'harness', 'model', 'effort', 'permissions')
    flat = lambda r: {k: v for k, v in {**r, **(r.get('agentConfig') or {})}.items() if k in keep} if isinstance(r, dict) else r
    return [flat(r) for r in role] if isinstance(role, list) else flat(role)


def command(action, project):
    # A bare launcher works in cmd, PowerShell and Git Bash command Cues.
    # The script retains the shell's working directory and quotes native argv.
    if os.name == 'nt':
        return f'powershell.exe -NoProfile -NonInteractive -File "{BASE / "launch.ps1"}" -PythonPath "{sys.executable}" -Action {action} -Project {project}'
    return ' '.join(shlex.quote(value) for value in (sys.executable, '-B', str(BASE / 'qa.py'), action, '--project', project))


def definitions(project, profile):
    package_file = Path(profile['path']) / 'package.json'
    scripts = json.loads(package_file.read_text(encoding='utf-8')).get('scripts', {}) if package_file.is_file() else {}
    cues = [{'name': 'QA 상태', 'type': 'command', 'command': command('status', project)}]
    if profile.get('compose'):
        cues += [{'name': 'QA 시작 · 웹+DB', 'type': 'command', 'command': command('start', project)},
                 {'name': 'QA 종료 · 컨테이너 제거', 'type': 'command', 'command': command('stop', project)}]
        if profile.get('dbSourceVolume'):
            cues += [{'name': 'QA DB 사본 · 최초 1회', 'type': 'command', 'command': command('clone-db', project)}]
    else:
        cues += [{'name': '개발 서버 · Vite', 'type': 'command', 'command': 'npm run dev -- --host 127.0.0.1'}]
    cues += [{'name': '가벼운 타입 검사', 'type': 'command', 'command': 'npm run typecheck' if 'typecheck' in scripts else 'npx --no-install tsc --noEmit'},
             {'name': '의존성 준비 · 수동', 'type': 'command', 'command': 'npm ci'},
             {'name': '코드 QA · 읽기 전용', 'type': 'agent', 'prompt':
              '현재 워크트리의 AGENTS.md와 이번 변경 diff만 읽고 좁은 코드 QA를 수행해. 코드·DB·원격 저장소는 변경하지 마. '
              '검증은 해당 프로젝트의 기존 명령을 사용하고 불필요한 전체 빌드·이미지 압축은 생략해. Docker는 등록된 QA 시작/종료 Cue만 사용하며 '
              '다른 실행 컨테이너를 포함해 전체 2개를 넘기지 마. 실제 확인 결과와 미검증 항목을 한국어로 보고해.'}]
    return cues


def apply(lanes=False):
    """lanes=True also moves already registered projects to LANES (their other settings stay); otherwise only new projects get them."""
    projects = json.loads(REGISTRY.read_text(encoding='utf-8'))['projects']
    existing = {p['id']: p for p in api('GET', 'projects')['projects']}
    for project, profile in projects.items():
        root = Path(profile['path']).resolve(strict=True)
        qa.root_for(profile, root)
        branch = qa.git(root, 'branch', '--show-current') or qa.git(root, 'rev-parse', 'HEAD')
        qa.git(root, 'rev-parse', '--verify', 'HEAD')
        if project in existing:
            if Path(existing[project]['path']).resolve() != root:
                raise RuntimeError(f'{project}: AO id belongs to another checkout')
            config = api('GET', f'projects/{project}')['project']['config'] or {}
            if lanes:
                for key, val in LANES.items():  # shown before the write: a deliberate per-project choice is replaced here
                    print(json.dumps({'project': project, 'lanes': key, 'old': _role_view(config.get(key)), 'new': _role_view(val)}, ensure_ascii=False))
                config.update(json.loads(json.dumps(LANES)))
        else:
            config = {'defaultBranch': branch, **json.loads(json.dumps(LANES)), 'autoReview': False}
        rules = ('[AO local QA]\n프로젝트의 AGENTS.md와 기존 작업별 규칙을 따른다. 모델과 reasoning effort는 유지한다. '
                 '작업 코드와 QA 대상은 현재 워크트리여야 한다. Docker는 이 프로젝트의 QA 시작/종료 Cue를 사용한다. '
                 '전체 실행 컨테이너 한도는 2개이며 다른 프로젝트 컨테이너를 임의 종료하지 않는다. '
                 'QA 후 해당 Cue로 만든 컨테이너를 제거한다. DB 볼륨은 보존한다. '
                 '의존성 설치는 수동 Cue, 빌드·브라우저 검사는 변경 범위에 맞게 실행한다. '
                 '워크트리는 기준 커밋에서 시작하므로 원본 폴더의 미커밋 변경을 포함한다고 가정하지 않는다.\n[/AO local QA]')
        for field in ('agentRules', 'orchestratorRules'):
            previous = re.sub(r'\[AO local QA\].*?\[/AO local QA\]', '', config.get(field, ''), flags=re.S).strip()
            config[field] = '\n\n'.join(filter(None, (previous, rules)))
        for field, action in (('postCreate', 'prepare'), ('preRemove', 'stop')):
            entries = config.get(field, [])
            owned = (str(BASE / 'qa.py'), str(BASE / 'launch.ps1'))
            config[field] = [entry for entry in entries if not any(path in entry for path in owned)] + [command(action, project)] if profile.get('compose') or field == 'postCreate' else entries
        if project in existing:
            api('PUT', f'projects/{project}/config', {'config': config})
        else:
            api('POST', 'projects', {'projectId': project, 'name': project, 'path': str(root), 'config': config})
        saved = api('GET', f'projects/{project}')['project']
        if saved['config'] != config:
            # API may omit empty values; compare required values rather than claim a full exact round-trip.
            for key in ('worker', 'orchestrator', 'reviewers', 'defaultBranch', 'postCreate', 'agentRules'):
                if saved['config'].get(key) != config.get(key):
                    raise RuntimeError(f'{project}: setting readback mismatch: {key}')
        current = {c['name']: c for c in api('GET', f'projects/{project}/cues')['cues']}
        for cue in definitions(project, profile):
            if cue['name'] in current:
                api('PATCH', f'cues/{current[cue["name"]]["id"]}', cue)
            else:
                api('POST', f'projects/{project}/cues', cue)
        print(json.dumps({'project': project, 'root': str(root), 'base': saved['config']['defaultBranch'], 'cues': len(definitions(project, profile)), 'applied': True}, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['apply', 'register'])
    parser.add_argument('--id')
    parser.add_argument('--path')
    parser.add_argument('--image')
    parser.add_argument('--db-source-volume')
    parser.add_argument('--port', type=int, default=18901)
    parser.add_argument('--lanes', action='store_true', help='apply: also move registered projects to the Claude worker / Codex reviewer lanes')
    args = parser.parse_args()
    if args.action == 'register':
        if not args.id or not re.fullmatch('[a-z0-9][a-z0-9-]{0,40}', args.id) or not args.path:
            raise RuntimeError('register requires --id (lowercase slug) and --path')
        root = Path(args.path).expanduser().resolve(strict=True)
        profile = {'path': str(root), 'port': args.port}
        qa.root_for(profile, root)
        compose = next((name for name in ('compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml') if (root / name).is_file()), None)
        if compose:
            if not args.image:
                raise RuntimeError('PHP Compose project requires --image identifying its compatible local web image')
            profile.update(compose=compose, image=args.image)
            if args.db_source_volume:
                profile['dbSourceVolume'] = args.db_source_volume
        registry = json.loads(REGISTRY.read_text(encoding='utf-8')) if REGISTRY.exists() else {'projects': {}}
        if args.id in registry['projects']:
            raise RuntimeError('Id already registered; review projects.json to relocate it explicitly')
        if any(Path(p['path']).resolve() == root for p in registry['projects'].values()):
            raise RuntimeError('This repository is already registered')
        registry['projects'][args.id] = profile
        REGISTRY.write_text(json.dumps(registry, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({'registered': args.id, 'path': str(root)}, ensure_ascii=False))
    else:
        apply(lanes=args.lanes)


if __name__ == '__main__':
    main()
