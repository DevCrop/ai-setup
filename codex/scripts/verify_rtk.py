"""Opt-in RTK host smoke checks. No models, installs, builds or project writes."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

from setup import Deployment, save_json
from tools import runtime_env, verify


def run(argv, cwd, env):
    p = subprocess.run(argv, cwd=cwd, env=env, capture_output=True, timeout=90)
    return p.returncode, p.stdout, p.stderr


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', type=Path, action='append', default=[])
    args = parser.parse_args()
    state = Deployment().state
    binary = verify(state)['path']
    env = {**os.environ, 'RTK_TELEMETRY_DISABLED': '1', 'RTK_SUPPRESS_HOOK_WARNING': '1',
           'npm_config_offline': 'true', 'npm_config_yes': 'false'}
    checks = []

    def compare(label, raw, wrapped, cwd, required=None, expected=0):
        task_env = {**env, **runtime_env(cwd)}
        a = run(raw, cwd, task_env)
        b = run([binary, *wrapped], cwd, task_env)
        passed = a[0] == b[0] and (a[0] != 0 if expected == 'nonzero' else a[0] == expected)
        if required:
            passed = passed and required.encode() in a[1]+a[2] and required.encode() in b[1]+b[2]
        checks.append({'check': label, 'status': 'pass' if passed else 'fail',
                       'raw_exit': a[0], 'rtk_exit': b[0],
                       'raw_output_bytes': len(a[1])+len(a[2]), 'rtk_output_bytes': len(b[1])+len(b[2])})
        if not passed and label == 'tsc-real-error-preserved':
            checks[-1]['fixture_diagnostics'] = [(x[1]+x[2]).decode(errors='replace')[:1000] for x in (a,b)]

    for index, path in enumerate(args.project):
        path = path.resolve(strict=True)
        compare(f'project-{index+1}-git-status', ['git','status'], ['git','status'], path)
        compare(f'project-{index+1}-git-log', ['git','log','-3','--oneline'], ['git','log','-3','--oneline'], path)
        tsc = path/'node_modules/typescript/bin/tsc'
        if tsc.is_file() and (path/'tsconfig.json').is_file():
            compare(f'project-{index+1}-tsc', [shutil.which('node'),str(tsc),'--noEmit'],
                    ['tsc','--noEmit'], path)
    with tempfile.TemporaryDirectory(prefix='trace-rtk-한글 space-') as directory:
        path = Path(directory)
        for command in (['git','init','-q'], ['git','config','user.email','fixture@example.invalid'],
                        ['git','config','user.name','Fixture']):
            subprocess.run(command, cwd=path, capture_output=True, check=True)
        (path/'fixture.txt').write_text('fixture\n', encoding='utf-8')
        subprocess.run(['git','add','.'], cwd=path, capture_output=True, check=True)
        subprocess.run(['git','commit','-qm','fixture'], cwd=path, capture_output=True, check=True)
        (path/'fixture.txt').write_text('changed\n', encoding='utf-8')
        compare('unicode-space-git-status', ['git','status'], ['git','status'], path, 'fixture.txt')
        compare('unicode-space-git-diff', ['git','diff'], ['git','diff'], path, 'changed')
        compare('nonzero-exit-preserved', [sys.executable,'-c','import sys; print("fixture-error"); sys.exit(7)'],
                ['proxy',sys.executable,'-c','import sys; print("fixture-error"); sys.exit(7)'], path, 'fixture-error', 7)
        compare('stderr-preserved', [sys.executable,'-c','import sys; sys.stderr.write("fixture-stderr"); sys.exit(3)'],
                ['proxy',sys.executable,'-c','import sys; sys.stderr.write("fixture-stderr"); sys.exit(3)'], path, 'fixture-stderr', 3)
        compare('space-argument-preserved', [sys.executable,'-c','import sys; print(sys.argv[1])','a b'],
                ['proxy',sys.executable,'-c','import sys; print(sys.argv[1])','a b'], path, 'a b')
        literals = ['a b', '$(echo trace)', '&', ';', '$HOME', '`literal`']
        probe = 'import sys; assert sys.argv[1:] == ' + repr(literals)
        compare('test-direct-argv-no-shell-expansion', [sys.executable, '-c', probe, *literals],
                ['test', sys.executable, '-c', probe, *literals], path)
        for project in args.project:
            tsc = project.resolve()/'node_modules/typescript/bin/tsc'
            if tsc.is_file():
                failure = path/'typed failure.ts'
                failure.write_text('const value: number = "intentional-type-error";\n', encoding='utf-8')
                config = path/'tsconfig.json'
                config.write_text(json.dumps({'compilerOptions':{'noEmit':True,'skipLibCheck':True},
                                             'files':[failure.name]}), encoding='utf-8')
                flags = ['--project',str(config)]
                compare('tsc-real-error-preserved', [shutil.which('node'), str(tsc), *flags],
                        ['tsc', *flags], project.resolve(), 'TS2322', 'nonzero')
                break
    report = {'checked_at': datetime.now(timezone.utc).isoformat(),
              'status': 'pass' if all(c['status']=='pass' for c in checks) else 'fail', 'checks': checks,
              'limit': 'These explicit commands only; bytes are not OpenAI tokens, hook loading or proof for every command/project.'}
    save_json(state/'rtk-runtime-check.json', report)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report['status']=='pass' else 1


if __name__ == '__main__':
    sys.exit(main())
