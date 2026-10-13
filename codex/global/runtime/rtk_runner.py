"""Portable explicit RTK runner installed as CODEX_HOME/bin/trace_rtk.py."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys


def state_location(home):
    if os.name == 'nt':
        base = Path(os.environ.get('LOCALAPPDATA', Path.home()/'AppData/Local'))
    elif sys.platform == 'darwin':
        base = Path.home()/'Library/Application Support'
    else:
        base = Path(os.environ.get('XDG_STATE_HOME', Path.home()/'.local/state'))
    return base/'TRACE-Setup'/hashlib.sha256(str(home).encode()).hexdigest()[:16]


def local_binaries(cwd=None):
    current = Path(cwd or Path.cwd()).resolve()
    for directory in [current, *current.parents]:
        binaries = directory/'node_modules/.bin'
        if binaries.is_dir():
            return binaries
        if (directory/'.git').exists():
            break
    return None


def runtime_env(cwd=None):
    env = {**os.environ, 'RTK_TELEMETRY_DISABLED':'1', 'RTK_SUPPRESS_HOOK_WARNING':'1',
           'npm_config_offline':'true', 'npm_config_yes':'false'}
    binaries = local_binaries(cwd)
    if binaries:
        env['PATH'] = str(binaries)+os.pathsep+env.get('PATH','')
    return env


def validate_command(argv, cwd=None):
    if not argv:
        raise ValueError('Supply an explicit RTK command')
    if argv[0] == 'tsc':
        bins = local_binaries(cwd)
        if not bins or not (bins.parent/'typescript/bin/tsc').is_file():
            raise ValueError('Project TypeScript required; do not use global/fetched compiler')


def main():
    installed_home = Path(__file__).absolute().parents[1]
    home = Path(os.environ.get('CODEX_HOME', installed_home if Path(__file__).parent.name=='bin' else Path.home()/'.codex')).absolute()
    state = state_location(home)
    record = json.loads((state/'tools-installed.json').read_text(encoding='utf-8'))['rtk']
    binary = state/'tools/rtk'/('rtk.exe' if os.name=='nt' else 'rtk')
    for p in [binary, *binary.parents]:
        if p.is_symlink() or (p.exists() and getattr(p.lstat(),'st_file_attributes',0)&0x400):
            if sys.platform=='darwin' and str(p) in ('/var','/tmp') and p.resolve()==Path('/private')/p.name:
                continue
            raise ValueError('Linked runtime path refused')
    if str(binary)!=record['path'] or hashlib.sha256(binary.read_bytes()).hexdigest()!=record['sha256']:
        raise ValueError('RTK ownership mismatch')
    validate_command(sys.argv[1:])
    return subprocess.call([str(binary),*sys.argv[1:]],env=runtime_env())


if __name__=='__main__':
    sys.exit(main())
