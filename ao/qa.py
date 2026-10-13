"""AO local QA: one shared two-container budget, no daemon or extra dependencies."""
import argparse
import contextlib
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

BASE = Path(__file__).resolve().parent
# All AO instances and manual Cues share this user's Docker budget and receipts.
# AO_DATA_DIR differs between a worker, the installed app and a dev daemon.
STATE = Path.home() / '.ao' / 'local-qa'
OWNER = 'ao.local-qa'
LIMIT = 2


def run(args, cwd=None, data=None, timeout=90):
    result = subprocess.run(args, cwd=cwd, input=data, capture_output=True,
                            text=True, encoding='utf-8', errors='replace', timeout=timeout)
    if result.returncode:
        # Compose diagnostics can contain interpolated credentials. Do not echo them.
        raise RuntimeError(f'{args[0]} {args[1]} failed (exit {result.returncode}); inspect locally')
    return result.stdout.strip()


def git(root, *args):
    return run(['git', '-C', str(root), *args])


def root_for(profile, requested):
    root = Path(requested or Path.cwd()).resolve()
    canonical = Path(profile['path']).resolve()
    actual = Path(git(root, 'rev-parse', '--show-toplevel')).resolve()
    common = Path(git(root, 'rev-parse', '--path-format=absolute', '--git-common-dir')).resolve()
    expected = Path(git(canonical, 'rev-parse', '--path-format=absolute', '--git-common-dir')).resolve()
    if root != actual or common != expected:
        raise RuntimeError('Run from this project root or one of its registered Git worktrees')
    return root


@contextlib.contextmanager
def budget_lock():
    STATE.mkdir(parents=True, exist_ok=True)
    with (STATE / 'budget.lock').open('a+b') as handle:
        handle.seek(0)
        if os.name == 'nt':
            import msvcrt
            if not handle.read(1):
                handle.write(b'0')
                handle.flush()
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            yield
        finally:
            handle.seek(0)
            if os.name == 'nt':
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle, fcntl.LOCK_UN)


def containers(all_containers=False):
    args = ['docker', 'ps', '-q']
    if all_containers:
        args.append('-a')
    ids = run(args).split()
    if not ids:
        return []
    raw = json.loads(run(['docker', 'inspect', *ids]))
    return [{'id': c['Id'], 'running': c['State']['Running'], 'mounts': c.get('Mounts', []),
             'labels': c['Config'].get('Labels') or {}} for c in raw]


def ensure_budget(running, own_running, requested):
    prospective = len(running) - own_running + requested
    if prospective > LIMIT:
        raise RuntimeError(f'Container budget: {len(running)} running; requested total {prospective} exceeds {LIMIT}. Stop your previous QA stack first.')


def identity(project, root):
    fingerprint = hashlib.sha256(os.path.normcase(str(root)).encode()).hexdigest()[:10]
    return f'aoqa-{project}-{fingerprint}'


def compose_config(project, profile, root):
    args = ['docker', 'compose', '--project-directory', str(root), '-p', 'aoqa-config']
    args += ['-f', str(root / profile['compose']), 'config', '--format', 'json']
    config = json.loads(run(args, cwd=root))
    selected = {name: config['services'][name] for name in ('web', 'db')}
    name = identity(project, root)
    for service_name, service in selected.items():
        for key in ('container_name', 'profiles', 'depends_on', 'develop', 'scale'):
            service.pop(key, None)
        service['restart'] = 'no'
        service['deploy'] = {'resources': {'limits': {'memory': '512M' if service_name == 'db' else '384M', 'cpus': '1'}}}
        service['mem_limit'] = '512M' if service_name == 'db' else '384M'
        service['labels'] = {**service.get('labels', {}), OWNER: name}
        if os.environ.get('AO_SESSION_ID'):
            service['labels']['ao.session'] = os.environ['AO_SESSION_ID']
        if service_name == 'web':
            service['image'] = profile['image']
            service.pop('build', None)
            service['ports'] = [{'target': 80, 'published': str(profile['port']), 'host_ip': '127.0.0.1', 'protocol': 'tcp'}]
            service['depends_on'] = {'db': {'condition': 'service_healthy' if selected['db'].get('healthcheck') else 'service_started'}}
            # Dependencies are shared read-only; source code always comes from this worktree.
            vendor = Path(profile['path']) / 'vendor'
            if root != Path(profile['path']).resolve() and not (root / 'vendor').exists() and vendor.is_dir():
                service.setdefault('volumes', []).append({'type': 'bind', 'source': str(vendor), 'target': '/var/www/html/vendor', 'read_only': True})
        else:
            service['ports'] = []
    result = {'name': name, 'services': selected}
    for key in ('networks', 'volumes', 'configs', 'secrets'):
        if key in config:
            result[key] = config[key]
    # Named volumes are isolated per checkout; never adopt an existing site's DB.
    for key, volume in result.get('volumes', {}).items():
        if volume.get('external'):
            raise RuntimeError('External volumes require an explicit project-specific QA plan')
        volume.pop('name', None)
        if key == 'db_data' and profile.get('dbSourceVolume'):
            volume['name'] = name + '-db-snapshot'
            volume['external'] = True
    return name, result


def clone_db(project, profile, root):
    source = profile.get('dbSourceVolume')
    if not source:
        raise RuntimeError('No cold development DB volume registered for this project')
    current = containers()
    ensure_budget(current, 0, 1)
    if any(m.get('Name') == source for c in current for m in c['mounts']):
        raise RuntimeError('Source DB is running; cold snapshot requires it to be stopped')
    name = identity(project, root)
    target = name + '-db-snapshot'
    existing = run(['docker', 'volume', 'ls', '-q']).splitlines()
    if target in existing:
        raise RuntimeError('Snapshot volume already exists; refusing to overwrite its data')
    run(['docker', 'volume', 'inspect', source])
    run(['docker', 'volume', 'create', '--label', f'{OWNER}={name}', target])
    # The source is read-only and stopped. Copy uses one short-lived bounded container.
    run(['docker', 'run', '--rm', '--name', name + '-db-copy', '--label', f'{OWNER}={name}',
         '--network', 'none', '--memory', '128m', '--cpus', '0.5',
         '--mount', f'type=volume,source={source},target=/source,readonly',
         '--mount', f'type=volume,source={target},target=/target',
         '--entrypoint', '/bin/sh', 'mysql:8.0', '-c',
         'test -z "$(ls -A /target)" && cp -a /source/. /target/ && touch /target/.ao-qa-snapshot-complete'], timeout=180)
    info = json.loads(run(['docker', 'volume', 'inspect', target]))[0]
    (STATE / (name + '-snapshot.json')).write_text(json.dumps({'volume': target, 'createdAt': info['CreatedAt'], 'complete': True}), encoding='utf-8')
    print(json.dumps({'snapshot': target, 'sourceReadOnly': True, 'remaining': len(containers())}))


def prepare(profile, root):
    source = Path(profile['path']) / '.env'
    dest = root / '.env'
    if source.is_file() and not dest.exists():
        ignored = subprocess.run(['git', '-C', str(root), 'check-ignore', '-q', '.env']).returncode == 0
        if not ignored:
            raise RuntimeError('Refusing to copy .env unless Git ignores it')
        dest.write_bytes(source.read_bytes())
    print(json.dumps({'root': str(root), 'prepared': True, 'nodeDependencies': (root / 'node_modules').is_dir(),
                      'dockerAutoStarted': False}, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'plan', 'start', 'stop', 'status', 'php-lint', 'clone-db'])
    parser.add_argument('--project', required=True)
    parser.add_argument('--root')
    parser.add_argument('files', nargs='*')
    args = parser.parse_args()
    profile = json.loads((BASE / 'projects.json').read_text(encoding='utf-8'))['projects'][args.project]
    root = root_for(profile, args.root)
    if args.action == 'prepare':
        prepare(profile, root)
        return
    name = identity(args.project, root)
    if args.action == 'status':
        current = containers()
        print(json.dumps({'running': len(current), 'limit': LIMIT, 'own': sum(c['labels'].get(OWNER) == name for c in current)}))
        return
    if not profile.get('compose'):
        raise RuntimeError('Static Vite project: use npm run dev; Docker is unnecessary')
    with budget_lock():
        if args.action == 'clone-db':
            clone_db(args.project, profile, root)
            return
        if args.action == 'stop':
            owned = [c for c in containers(True) if c['labels'].get(OWNER) == name]
            running = [c['id'] for c in owned if c['running']]
            if running:
                run(['docker', 'stop', '--time', '10', *running])
            if owned:
                run(['docker', 'rm', *[c['id'] for c in owned]])
            print(json.dumps({'removed': len(owned), 'remaining': len(containers()), 'volumesPreserved': True}))
            return
        if args.action == 'php-lint':
            if not args.files:
                raise RuntimeError('Supply exact repository-relative PHP files')
            owned = [c for c in containers() if c['labels'].get(OWNER) == name and c['labels'].get('com.docker.compose.service') == 'web']
            if len(owned) != 1:
                raise RuntimeError('Start this checkout QA stack first')
            for filename in args.files:
                target = (root / filename).resolve(strict=True)
                relative = target.relative_to(root).as_posix()
                if target.suffix != '.php':
                    raise RuntimeError('PHP files only')
                print(run(['docker', 'exec', owned[0]['id'], 'php', '-l', '/var/www/html/' + relative]))
            return
        name, config = compose_config(args.project, profile, root)
        if args.action == 'plan':
            print(json.dumps({'project': name, 'services': list(config['services']), 'url': f'http://127.0.0.1:{profile["port"]}',
                              'source': str(root), 'limitsMiB': {'web': 384, 'db': 512}}, ensure_ascii=False))
            return
        current = containers()
        ensure_budget(current, sum(c['labels'].get(OWNER) == name for c in current), len(config['services']))
        if profile.get('dbSourceVolume'):
            # Do not silently create a blank database that makes the site return HTTP 500.
            snapshot = name + '-db-snapshot'
            info = json.loads(run(['docker', 'volume', 'inspect', snapshot]))[0]
            if (info.get('Labels') or {}).get(OWNER) != name:
                raise RuntimeError('QA DB snapshot ownership mismatch')
            receipt = STATE / (name + '-snapshot.json')
            if not receipt.is_file():
                raise RuntimeError('QA DB copy completion is unverified; inspect the existing snapshot before reuse')
            saved = json.loads(receipt.read_text(encoding='utf-8'))
            if saved != {'volume': snapshot, 'createdAt': info['CreatedAt'], 'complete': True}:
                raise RuntimeError('QA DB snapshot identity or completion changed')
        # Refuse automatic pulls/builds and disable dependencies outside the selected pair.
        try:
            run(['docker', 'compose', '--parallel', '1', '--project-directory', str(root), '-p', name, '-f', '-',
                 'up', '-d', '--no-build', '--pull', 'never', '--no-deps', 'db', 'web'], cwd=root, data=json.dumps(config), timeout=180)
        except (RuntimeError, subprocess.TimeoutExpired):
            owned_running = [c['id'] for c in containers() if c['labels'].get(OWNER) == name]
            if owned_running:
                run(['docker', 'stop', '--time', '10', *owned_running])
            raise
        current = containers()
        if len(current) > LIMIT:
            owned = [c['id'] for c in current if c['labels'].get(OWNER) == name]
            if owned:
                run(['docker', 'stop', '--time', '10', *owned])
            raise RuntimeError('An external Docker client exceeded the budget; this QA stack was stopped')
        print(json.dumps({'running': len(current), 'url': f'http://127.0.0.1:{profile["port"]}', 'source': str(root)}, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
        print(f'QA: {error}', file=sys.stderr)
        sys.exit(1)
