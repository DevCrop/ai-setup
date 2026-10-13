"""Scoped dependency maintenance. Observation is not proof of human inactivity."""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys

from setup import Deployment, deployment_lock, read_json, save_json, safe

IDLE_DAYS = 45
GRACE_DAYS = 7
# Reinstall commands are documentation, never executed by this tool.
ARTIFACTS = {
    'node_modules': [('package.json', 'package-lock.json', 'npm ci'),
                     ('package.json', 'pnpm-lock.yaml', 'pnpm install --frozen-lockfile'),
                     ('package.json', 'yarn.lock', 'yarn install --immutable')],
    'vendor': [('composer.json', 'composer.lock', 'composer install')],
    '.venv': [('pyproject.toml', 'uv.lock', 'uv sync --frozen')],
}


def timestamp():
    return datetime.now(timezone.utc)


def parse_date(value):
    result = datetime.fromisoformat(value)
    if result.tzinfo is None:
        raise ValueError('Timezone required')
    return result


def linked(path):
    return path.is_symlink() or bool(getattr(path.lstat(), 'st_file_attributes', 0) & 0x400)


def root_path(value):
    root = Path(os.path.abspath(os.path.expanduser(value)))
    if not root.is_dir() or root == Path(root.anchor) or root == Path.home():
        raise ValueError('An existing project directory is required')
    for ancestor in [root, *root.parents]:
        if sys.platform == 'darwin' and str(ancestor) in ('/var', '/tmp'):
            if ancestor.resolve() == Path('/private') / ancestor.name:
                continue
        if linked(ancestor):
            raise ValueError('Linked project root/ancestor refused')
    return root


def git(root, *args):
    result = subprocess.run(['git', '-C', str(root), *args], capture_output=True,
                            timeout=30, check=True)
    return result.stdout


def project_fingerprint(root):
    if Path(os.fsdecode(git(root, 'rev-parse', '--show-toplevel')).strip()).resolve() != root.resolve():
        raise ValueError('Register the exact Git root, not a subdirectory')
    h = hashlib.sha256()
    for args in [('rev-parse', 'HEAD'), ('status', '--porcelain=v1', '-z'),
                 ('diff', 'HEAD', '--no-ext-diff', '--no-textconv')]:
        h.update(git(root, *args))
    for raw in sorted(git(root, 'ls-files', '--others', '--exclude-standard', '-z').split(b'\0')):
        if not raw:
            continue
        p = root / os.fsdecode(raw)
        if p.is_file() and not p.is_symlink():
            h.update(raw)
            with p.open('rb') as f:
                for chunk in iter(lambda: f.read(65536), b''):
                    h.update(chunk)
    return h.hexdigest()


def process_busy(root):
    """Return unknown on collection failure. Never save command lines (secrets)."""
    try:
        if os.name == 'nt':
            result = subprocess.run(['powershell', '-NoProfile', '-NonInteractive', '-Command',
                '[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress'],
                capture_output=True, timeout=30, check=True)
            rows = json.loads(result.stdout.decode('utf-8-sig', errors='replace') or '[]')
            rows = rows if isinstance(rows, list) else [rows]
            rows = [r for r in rows if r.get('ProcessId') not in (os.getpid(), os.getppid())]
            commands = [r.get('CommandLine') or '' for r in rows]
            ambiguous = any((r.get('Name') or '').casefold() in ('node.exe', 'php.exe', 'python.exe', 'python3.exe', 'bun.exe')
                            and not any(s in (r.get('CommandLine') or '').replace('\\', '/').casefold()
                                        for s in ('/.codex/', '/trace-setup/', '/codex-setup/', '/@openai/codex/')) for r in rows)
        else:
            result = subprocess.run(['ps', '-axo', 'pid=,args='], capture_output=True, timeout=15, check=True)
            commands = [line.split(None, 1)[1] for line in result.stdout.decode(errors='replace').splitlines()
                        if len(line.split(None, 1)) == 2
                        and int(line.split(None, 1)[0]) not in (os.getpid(), os.getppid())]
            ambiguous = any(Path(c.split()[0]).name in ('node', 'php', 'python', 'python3', 'bun')
                            and not any(s in c for s in ('/.codex/', '/TRACE-Setup/', '/codex-setup/', '/@openai/codex/'))
                            for c in commands if c.split())
        needle = str(root).replace('\\', '/').casefold()
        if any(needle in c.replace('\\', '/').casefold() for c in commands):
            return True
        return None if ambiguous else False
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def artifact_info(root, name, deep=False):
    if name not in ARTIFACTS:
        raise ValueError('Only allowlisted reinstallable directories are supported')
    target = root / name
    if not target.exists():
        if target.is_symlink():
            raise ValueError('Broken dependency link refused')
        return None
    if linked(target) or not target.is_dir() or target.resolve().parent != root.resolve():
        raise ValueError('Dependency root must be a real direct child')
    if git(root, 'ls-files', '-z', '--', name):
        raise ValueError('Tracked dependency contents refused')
    ignored = subprocess.run(['git', '-C', str(root), 'check-ignore', '-q', '--', name], timeout=15)
    if ignored.returncode != 0:
        raise ValueError('Dependency directory must be Git-ignored')
    choices = [(a, b, cmd) for a, b, cmd in ARTIFACTS[name]
               if (root / a).is_file() and (root / b).is_file()]
    if len(choices) != 1:
        raise ValueError('Exactly one supported manifest/lock pair is required')
    a, b, cmd = choices[0]
    if any(linked(root / p) for p in (a, b)):
        raise ValueError('Linked manifest/lock refused')
    locks = hashlib.sha256((root / a).read_bytes() + b'\0' + (root / b).read_bytes()).hexdigest()
    s = target.stat()
    identity = [s.st_dev, s.st_ino, s.st_mtime_ns]
    latest = s.st_mtime
    size = count = 0
    if deep:
        for directory, dirs, files in os.walk(target, followlinks=False):
            base = Path(directory)
            # Refuse nested reparse points/symlinks rather than risk shared stores.
            for item in dirs + files:
                p = base / item
                if linked(p):
                    raise ValueError('Nested dependency link refused; use manual cleanup')
                st = p.stat()
                latest = max(latest, st.st_mtime)
                if not (stat.S_ISREG(st.st_mode) or stat.S_ISDIR(st.st_mode)):
                    raise ValueError('Special file refused')
                if stat.S_ISREG(st.st_mode):
                    size += st.st_size
                    count += 1
    return {'name': name, 'identity': identity, 'locks_sha256': locks,
            'latest_write': latest, 'bytes': size, 'files': count, 'restore': cmd}


def register(state, project_id, path, auto=False):
    if not project_id or not all(c.isalnum() or c in '-_' for c in project_id):
        raise ValueError('Invalid project ID')
    root = root_path(path)
    project_fingerprint(root)
    registry = read_json(safe(state, 'cleanup-projects.json'), {'schema_version': 1, 'projects': {}})
    for key, row in registry['projects'].items():
        other = Path(row['path'])
        if key != project_id and (root == other or root in other.parents or other in root.parents):
            raise ValueError('Overlapping registrations refused')
    prior = registry['projects'].get(project_id)
    if prior and prior['path'] != str(root):
        raise ValueError('ID already binds another path')
    registry['projects'][project_id] = {'path': str(root), 'auto_cleanup': auto,
        'hold': False, 'idle_days': IDLE_DAYS, 'grace_days': GRACE_DAYS}
    save_json(safe(state, 'cleanup-projects.json'), registry)


def scan(state, now=None, busy=process_busy):
    now = now or timestamp()
    registry = read_json(safe(state, 'cleanup-projects.json'), {'projects': {}})
    record = read_json(safe(state, 'cleanup-observations.json'), {'projects': {}})
    rows = []
    for key, policy in registry['projects'].items():
        previous = record['projects'].get(key, {})
        row = {'id': key, 'path': policy['path'], 'status': 'observing', 'artifacts': []}
        try:
            root = root_path(policy['path'])
            fingerprint = project_fingerprint(root)
            activity = parse_date(previous.get('last_activity', now.isoformat()))
            # A missed/inaccessible interval is unknown, not continuous idle evidence.
            last_check = parse_date(previous.get('checked_at', now.isoformat()))
            if (previous.get('fingerprint') != fingerprint or previous.get('status') == 'error'
                    or now - last_check > timedelta(days=14)):
                activity = now
            running = busy(root)
            if running is not False:
                activity = now
            infos = []
            for name in ARTIFACTS:
                try:
                    info = artifact_info(root, name)
                    if info:
                        old = next((x for x in previous.get('artifacts', []) if x['name'] == name), None)
                        if not old or any(info[k] != old.get(k) for k in ('identity', 'locks_sha256')):
                            activity = now
                        infos.append(info)
                except (ValueError, OSError, subprocess.SubprocessError) as exc:
                    row['artifacts'].append({'name': name, 'status': 'refused', 'reason': str(exc)[:200]})
            age = (now - activity).total_seconds() / 86400
            for info in infos:
                info['status'] = 'observing'
                if policy.get('hold') or not policy.get('auto_cleanup'):
                    info['status'] = 'held'
                elif running is None:
                    info['status'] = 'process-unknown'
                elif age >= policy['idle_days']:
                    try:
                        full = artifact_info(root, info['name'], deep=True)
                        if full['latest_write'] > activity.timestamp():
                            activity = datetime.fromtimestamp(full['latest_write'], timezone.utc)
                        else:
                            info.update(full)
                            old = next((x for x in previous.get('artifacts', []) if x['name'] == info['name']), {})
                            info['candidate_since'] = old.get('candidate_since', now.isoformat())
                            if old.get('notified_at'):
                                info['notified_at'] = old['notified_at']
                            info['status'] = ('eligible' if info.get('notified_at')
                                and now - parse_date(info['notified_at']) >= timedelta(days=policy['grace_days'])
                                else 'candidate')
                    except (ValueError, OSError, subprocess.SubprocessError) as exc:
                        info['status'] = 'refused'
                        info['reason'] = str(exc)[:200]
                row['artifacts'].append(info)
            # A discovered write cancels every pending candidate for the project.
            if (now - activity).total_seconds() / 86400 < policy['idle_days']:
                for info in row['artifacts']:
                    for k in ('candidate_since', 'notified_at'):
                        info.pop(k, None)
                    if info['status'] in ('candidate', 'eligible'):
                        info['status'] = 'observing'
            row.update(fingerprint=fingerprint, last_activity=activity.isoformat(),
                       idle_days=round((now-activity).total_seconds()/86400, 2))
        except (ValueError, OSError, subprocess.SubprocessError) as exc:
            row.update(status='error', reason=str(exc)[:200], last_activity=previous.get('last_activity', now.isoformat()))
        row['checked_at'] = now.isoformat()
        record['projects'][key] = row
        rows.append(row)
    record['projects'] = {k: v for k, v in record['projects'].items() if k in registry['projects']}
    record['checked_at'] = now.isoformat()
    save_json(safe(state, 'cleanup-observations.json'), record)
    return {'checked_at': now.isoformat(), 'projects': rows,
            'limit': 'Observed idle only; no edits/installs/builds; linked, tracked, unlocked and unknown targets refused.'}


def acknowledge(state, project_id, name, now=None):
    record = read_json(safe(state, 'cleanup-observations.json'))
    info = next(x for x in record['projects'][project_id]['artifacts'] if x['name'] == name)
    if info['status'] != 'candidate':
        raise ValueError('Only an actually reported candidate can be acknowledged')
    info['notified_at'] = (now or timestamp()).isoformat()
    save_json(safe(state, 'cleanup-observations.json'), record)


def prune(state, now=None, busy=process_busy):
    now = now or timestamp()
    report = scan(state, now, busy)
    results = []
    for row in report['projects']:
        for info in row['artifacts']:
            if info['status'] != 'eligible':
                continue
            root = root_path(row['path'])
            if busy(root) is not False or project_fingerprint(root) != row['fingerprint']:
                raise ValueError('Project changed or process state uncertain; rescan')
            target = root / info['name']
            current = artifact_info(root, info['name'], deep=True)
            if current != {k: v for k, v in info.items()
                           if k not in ('status', 'candidate_since', 'notified_at')}:
                raise ValueError('Dependency changed; rescan')
            # Fixed direct-child path, validated root and no links anywhere in tree.
            try:
                shutil.rmtree(target)
                if target.exists():
                    raise OSError('Target remains')
                results.append({'id': row['id'], 'name': info['name'], 'status': 'removed',
                                'logical_bytes': info['bytes'], 'restore': info['restore']})
            except OSError as exc:
                results.append({'id': row['id'], 'name': info['name'], 'status': 'error',
                                'reason': type(exc).__name__, 'restore': info['restore']})
    prior = read_json(safe(state, 'cleanup-result.json'), {}).get('unresolved', [])
    unresolved = {(r['id'], r['name']): r for r in prior}
    for result in results:
        key = (result['id'], result['name'])
        if result['status'] == 'error':
            unresolved[key] = result
        else:
            unresolved.pop(key, None)
    save_json(safe(state, 'cleanup-result.json'), {'checked_at': now.isoformat(), 'results': results,
                                             'unresolved': list(unresolved.values())})
    return {'results': results, 'unresolved': list(unresolved.values()),
            'limit': 'Dependencies restore via locked reinstall, not managed-policy rollback. Partial removal may require reinstall.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['register', 'scan', 'prune', 'reported', 'hold', 'touch'])
    parser.add_argument('--state', type=Path)
    parser.add_argument('--id')
    parser.add_argument('--path')
    parser.add_argument('--auto', action='store_true')
    parser.add_argument('--artifact', choices=list(ARTIFACTS))
    args = parser.parse_args()
    state = args.state or Deployment().state
    with deployment_lock(state):
        if args.command == 'register':
            register(state, args.id, args.path, args.auto)
            result = {'status': 'registered'}
        elif args.command == 'scan':
            result = scan(state)
        elif args.command == 'prune':
            result = prune(state)
        elif args.command == 'reported':
            acknowledge(state, args.id, args.artifact)
            result = {'status': 'report-recorded'}
        elif args.command == 'hold':
            registry = read_json(safe(state, 'cleanup-projects.json'))
            registry['projects'][args.id]['hold'] = True
            save_json(safe(state, 'cleanup-projects.json'), registry)
            result = {'status': 'held'}
        else:
            record = read_json(safe(state, 'cleanup-observations.json'))
            record['projects'][args.id]['last_activity'] = timestamp().isoformat()
            for info in record['projects'][args.id].get('artifacts', []):
                info.pop('candidate_since', None)
                info.pop('notified_at', None)
            save_json(safe(state, 'cleanup-observations.json'), record)
            result = {'status': 'activity-recorded'}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 1 if any(r.get('status') == 'error' for r in result.get('projects', []) + result.get('results', []) + result.get('unresolved', [])) else 0


if __name__ == '__main__':
    sys.exit(main())
