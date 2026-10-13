"""Install one pinned RTK binary; no hook, credential, permission or PATH edits."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import re
import stat
import subprocess
import sys
import tarfile
import urllib.request
import zipfile

from setup import ROOT, Deployment, atomic, deployment_lock, read_json, safe, save_json
sys.path.insert(0, str(ROOT/'global/runtime'))
from rtk_runner import runtime_env, validate_command

RTK_RELEASE_SOURCE = 'https://api.github.com/repos/rtk-ai/rtk/releases/latest'


def release_plan(release, lock):
    """Validate collected upstream identity; never review, pin or install it."""
    tag = release.get('tag_name', '')
    if not re.fullmatch(r'v[0-9]+\.[0-9]+\.[0-9]+', tag) or release.get('draft') or release.get('prerelease'):
        raise ValueError('Only an exact stable RTK release can be planned')
    version = tag[1:]
    assets = {}
    for asset in release.get('assets', []):
        name = asset.get('name')
        if name not in lock['assets']:
            continue
        digest = asset.get('digest', '') or ''
        url = f'https://github.com/rtk-ai/rtk/releases/download/{tag}/{name}'
        if name in assets or not re.fullmatch(r'sha256:[0-9a-f]{64}', digest) or asset.get('browser_download_url') != url:
            raise ValueError('Missing, duplicate or invalid pinned-platform RTK asset identity')
        assets[name] = {'url': url, 'sha256': digest.removeprefix('sha256:')}
    if set(assets) != set(lock['assets']):
        raise ValueError('Stable release is missing a supported platform asset')
    newer = tuple(map(int, version.split('.')))
    current = tuple(map(int, lock['version'].split('.')))
    if newer < current:
        return {'status': 'deferred', 'version': version, 'reason': 'Older release; no automatic downgrade'}
    if newer == current:
        if assets != lock['assets']:
            raise ValueError('Same RTK version has changed assets; preserve the current pin for review')
        return {'status': 'unchanged', 'version': version}
    return {'status': 'candidate', 'version': version, 'assets': assets,
            'release_url': f'https://github.com/rtk-ai/rtk/releases/tag/{tag}',
            'requires_semantic_review': True}


def plan_update(state, lock=None):
    """Reuse one successful source collection; no new network call or writes."""
    lock = lock or read_json(ROOT / 'versions.lock.json')['tools']['rtk']
    report = read_json(state / 'source-report.json', {})
    rows = [r for r in report.get('results', []) if r.get('url') == RTK_RELEASE_SOURCE]
    if len(rows) != 1 or rows[0].get('status') != 'fetched' or not report.get('checked_at'):
        raise ValueError('Current RTK source collection unavailable; run check_updates.py')
    row = rows[0]
    source = read_json(state / 'source-status.json', {}).get(row['id'], {})
    body = source.get('body', '')
    if (not body or row.get('sha256') != source.get('sha256') or
            hashlib.sha256(body.encode()).hexdigest() != row.get('sha256')):
        raise ValueError('RTK collection evidence differs; recollect before planning')
    return {**release_plan(json.loads(body), lock), 'collected_at': report['checked_at'],
            'source_sha256': row['sha256'], 'limit': 'Candidate identity only; no semantic approval or installation.'}


def target_name(system=None, machine=None):
    system, machine = system or platform.system(), (machine or platform.machine()).lower()
    arch = {'amd64': 'x86_64', 'x86_64': 'x86_64', 'arm64': 'aarch64', 'aarch64': 'aarch64'}.get(machine)
    suffix = {'Windows': 'pc-windows-msvc.zip', 'Darwin': 'apple-darwin.tar.gz',
              'Linux': 'unknown-linux-musl.tar.gz' if arch == 'x86_64' else 'unknown-linux-gnu.tar.gz'}.get(system)
    if not arch or not suffix or (system == 'Windows' and arch != 'x86_64'):
        raise ValueError('Unsupported RTK platform')
    return f'rtk-{arch}-{suffix}'


def extract(data, archive_name):
    binary_name = 'rtk.exe' if archive_name.endswith('.zip') else 'rtk'
    if archive_name.endswith('.zip'):
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            matches = [x for x in z.infolist() if Path(x.filename).name == binary_name and not x.is_dir()]
            if len(matches) != 1 or matches[0].file_size > 40_000_000:
                raise ValueError('Unexpected binary archive')
            if stat.S_ISLNK(matches[0].external_attr >> 16):
                raise ValueError('Archive link refused')
            return z.read(matches[0])
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as t:
        matches = [x for x in t if Path(x.name).name == binary_name and x.isfile()]
        if len(matches) != 1 or matches[0].size > 40_000_000:
            raise ValueError('Unexpected binary archive')
        return t.extractfile(matches[0]).read()


def download(url):
    if not url.startswith('https://github.com/rtk-ai/rtk/releases/download/'):
        raise ValueError('Only pinned upstream release assets are allowed')
    request = urllib.request.Request(url, headers={'User-Agent': 'TRACE-Setup-tools/1'})
    with urllib.request.urlopen(request, timeout=45) as response:
        data = response.read(15_000_001)
        if len(data) > 15_000_000:
            raise ValueError('Download too large')
        return data


def install(state, lock=None, fetcher=download, verify_binary=True):
    lock = lock or read_json(ROOT / 'versions.lock.json')['tools']['rtk']
    name = target_name()
    asset = lock['assets'][name]
    binary = safe(state, 'tools/rtk/' + ('rtk.exe' if os.name == 'nt' else 'rtk'))
    record_path = safe(state, 'tools-installed.json')
    record = read_json(record_path, {})
    old = binary.read_bytes() if binary.exists() else None
    old_hash = hashlib.sha256(old).hexdigest() if old is not None else None
    owned = record.get('rtk', {})
    if old is not None and owned.get('sha256') != old_hash:
        raise ValueError('Unowned or modified RTK binary; preserve conflict')
    if old is not None and owned.get('version') == lock['version']:
        if owned.get('asset_sha256') and (owned['asset_sha256'] != asset['sha256'] or owned.get('asset_name') != name):
            raise ValueError('Same-version RTK asset differs from installed receipt; preserve conflict')
        return {'status': 'unchanged', **owned}
    backup = safe(state, 'tools/rtk/.previous')
    if backup.exists() and hashlib.sha256(backup.read_bytes()).hexdigest() != (owned.get('previous') or {}).get('sha256'):
        raise ValueError('Modified restore point; preserve conflict')
    data = fetcher(asset['url'])
    if hashlib.sha256(data).hexdigest() != asset['sha256']:
        raise ValueError('RTK release checksum mismatch')
    payload = extract(data, name)
    staged = safe(state, 'tools/rtk/.staged' + ('.exe' if os.name == 'nt' else ''))
    if staged.exists():
        raise ValueError('Unexpected staging file; inspect ownership before removal')
    atomic(staged, payload)
    staged.chmod(0o755)
    try:
        if verify_binary:
            result = subprocess.run([str(staged), '--version'], capture_output=True, timeout=20, check=True)
            if result.stdout.decode().strip() != 'rtk ' + lock['version']:
                raise ValueError('Unexpected RTK version')
        previous_backup = backup.read_bytes() if backup.exists() else None
        new = {'version': lock['version'], 'path': str(binary),
               'sha256': hashlib.sha256(payload).hexdigest(),
               'asset_name': name, 'asset_sha256': asset['sha256'],
               'previous': {k: v for k, v in owned.items() if k != 'previous'} or None}
        record['rtk'] = new
        try:
            if old is not None:
                atomic(backup, old)
            elif backup.exists():
                backup.unlink()
            os.replace(staged, binary)
            save_json(record_path, record)
        except Exception:
            if old is not None:
                atomic(binary, old)
                binary.chmod(0o755)
            else:
                binary.unlink()
            if previous_backup is not None:
                atomic(backup, previous_backup)
            elif backup.exists():
                backup.unlink()
            raise
        return {'status': 'installed', **new}
    finally:
        if staged.exists():
            staged.unlink()


def verify(state):
    record = read_json(state / 'tools-installed.json', {}).get('rtk')
    if not record:
        return {'status': 'not-installed'}
    path = safe(state, 'tools/rtk/' + ('rtk.exe' if os.name == 'nt' else 'rtk'))
    if str(path) != record['path'] or hashlib.sha256(path.read_bytes()).hexdigest() != record['sha256']:
        raise ValueError('RTK ownership/hash mismatch')
    result = subprocess.run([str(path), '--version'], capture_output=True, timeout=20, check=True)
    if result.stdout.decode().strip() != 'rtk ' + record['version']:
        raise ValueError('RTK recorded version mismatch')
    return {'status': 'pass', 'version': result.stdout.decode().strip(), 'path': str(path),
            'mode': 'explicit commands; transparent hooks not installed'}


def uninstall(state):
    verify(state)
    record = read_json(state / 'tools-installed.json', {})
    if 'rtk' not in record:
        return {'status': 'unchanged'}
    backup = safe(state, 'tools/rtk/.previous')
    if backup.exists() and hashlib.sha256(backup.read_bytes()).hexdigest() != (record['rtk'].get('previous') or {}).get('sha256'):
        raise ValueError('Modified restore point; preserve conflict')
    paths = [safe(state, relative) for relative in
             ('tools/rtk/rtk.exe' if os.name == 'nt' else 'tools/rtk/rtk', 'tools/rtk/.previous')]
    before = {p: p.read_bytes() for p in paths if p.exists()}
    del record['rtk']
    try:
        for p in before:
            p.unlink()
        save_json(safe(state, 'tools-installed.json'), record)
    except Exception:
        for p, data in before.items():
            atomic(p, data)
            p.chmod(0o755)
        raise
    directory = state / 'tools/rtk'
    if directory.exists() and not any(directory.iterdir()):
        directory.rmdir()
    return {'status': 'removed'}


def rollback(state):
    verify(state)
    record = read_json(state / 'tools-installed.json', {})
    current = record.get('rtk', {})
    previous = current.get('previous')
    backup = safe(state, 'tools/rtk/.previous')
    if not previous or not backup.exists():
        raise ValueError('No prior RTK version')
    data = backup.read_bytes()
    if hashlib.sha256(data).hexdigest() != previous['sha256']:
        raise ValueError('Modified restore point')
    path = safe(state, 'tools/rtk/' + ('rtk.exe' if os.name == 'nt' else 'rtk'))
    before = path.read_bytes()
    record['rtk'] = {**previous, 'previous': None}
    try:
        atomic(path, data)
        path.chmod(0o755)
        save_json(safe(state, 'tools-installed.json'), record)
    except Exception:
        atomic(path, before)
        path.chmod(0o755)
        raise
    backup.unlink()
    return {'status': 'restored', 'version': previous['version']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['install-rtk', 'verify', 'uninstall-rtk', 'rollback-rtk', 'plan-rtk-update', 'run'])
    parser.add_argument('--state', type=Path)
    parser.add_argument('argv', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    state = args.state or Deployment().state
    if args.command == 'plan-rtk-update':
        print(json.dumps(plan_update(state), ensure_ascii=False, indent=2))
        return 0
    if args.command == 'run':
        checked = verify(state)
        if checked['status'] != 'pass' or not args.argv:
            raise ValueError('Install RTK first; supply its command arguments')
        env = runtime_env()
        validate_command(args.argv)
        return subprocess.call([checked['path'], *args.argv], env=env)
    with deployment_lock(state):
        result = (install(state) if args.command == 'install-rtk' else uninstall(state)
                  if args.command == 'uninstall-rtk' else rollback(state)
                  if args.command == 'rollback-rtk' else verify(state))
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
