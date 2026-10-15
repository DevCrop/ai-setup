"""Exercise the actual release payload in disposable, explicitly isolated roots."""
from pathlib import Path
import json
import os
import subprocess
import sys
import tempfile
import tomllib
import unittest

from setup import Deployment, ROOT, read_json, digest


class ReleaseTests(unittest.TestCase):
    def test_actual_payload_cli_outside_checkout_preserves_host_state(self):
        with tempfile.TemporaryDirectory(prefix='trace-portable-') as directory:
            root = Path(directory)
            home = root / 'custom Codex 한글'
            personal = root / 'separate personal skills'
            state = root / 'private state'
            home.mkdir()
            state.mkdir()
            config = ('model = "user-selected-model"\nmodel_reasoning_effort = "high"\n'
                      'approval_policy = "never"\n[mcp_servers.fixture]\n'
                      'command = "user-tool"\n[agents]\nenabled = false\n')
            (home / 'config.toml').write_text(config, encoding='utf-8')
            sentinels = {home / 'auth.json': b'{"fixture":"not-real-authentication"}',
                         home / 'sessions/fixture.txt': b'user-history-fixture',
                         state / 'routine-review.json': b'{"fixture":"private-host-state"}'}
            for path, data in sentinels.items():
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
            env = dict(os.environ, CODEX_HOME=str(home), PYTHONIOENCODING='utf-8',
                       USERPROFILE=str(root / 'user'), HOME=str(root / 'user'),
                       LOCALAPPDATA=str(root / 'local'), XDG_STATE_HOME=str(root / 'xdg'))

            def run(command):
                result = subprocess.run(
                    [sys.executable, '-B', str(ROOT / 'scripts/setup.py'), command,
                     '--home', str(home), '--state', str(state), '--personal-skills', str(personal)],
                    cwd=root, env=env, capture_output=True, text=True, encoding='utf-8', timeout=30)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                return json.loads(result.stdout)

            self.assertFalse(any(row['action'] == 'conflict' for row in run('plan')))
            self.assertEqual(run('apply')['status'], 'applied')
            self.assertEqual(run('verify')['status'], 'pass')
            before = tomllib.loads(config)
            after = tomllib.loads((home / 'config.toml').read_text(encoding='utf-8'))
            managed = ('agents', 'check_for_update_on_startup')  # keys the manifest writes; everything else must survive
            self.assertIs(after['check_for_update_on_startup'], False)
            self.assertEqual({k: v for k, v in after.items() if k not in managed},
                             {k: v for k, v in before.items() if k not in managed})
            restore_point = (state / 'previous.json').read_bytes()
            self.assertEqual(run('apply')['status'], 'unchanged')
            self.assertEqual((state / 'previous.json').read_bytes(), restore_point)
            self.assertEqual(run('rollback')['status'], 'restored')
            self.assertEqual(tomllib.loads((home / 'config.toml').read_text(encoding='utf-8')), before)
            self.assertFalse((home / 'AGENTS.md').exists())
            for path, data in sentinels.items():
                self.assertEqual(path.read_bytes(), data)
            self.assertFalse((home / 'routine-review.json').exists())

    def test_payload_install_remove_restore(self):
        with tempfile.TemporaryDirectory(prefix='trace-release-') as directory:
            root = Path(directory)
            dep = Deployment(ROOT, root / 'home 한글', root / 'state', root / 'personal skills')
            dep.apply()
            self.assertEqual(dep.verify()['status'], 'pass')
            self.assertEqual(dep.apply()['status'], 'unchanged')
            for skill in read_json(ROOT / 'versions.lock.json')['skills']:
                for relative, expected in skill['files'].items():
                    self.assertEqual(digest((dep.personal_skills / skill['name'] / relative).read_bytes()), expected)
                self.assertEqual((dep.personal_skills / skill['name'] / 'agents/openai.yaml').read_text(encoding='utf-8').strip(),
                                 'policy:\n  allow_implicit_invocation: false')
            (dep.personal_skills / 'user').mkdir(parents=True)
            user = dep.personal_skills / 'user/SKILL.md'
            user.write_text('user-owned', encoding='utf-8')
            self.assertIn('@personal/user/SKILL.md', dep.inventory())
            dep.uninstall()
            self.assertFalse(any(p.is_file() for p in dep.home.rglob('*')))
            self.assertEqual(user.read_text(encoding='utf-8'), 'user-owned')
            dep.restore()
            self.assertEqual(dep.verify()['status'], 'pass')


if __name__ == '__main__':
    unittest.main()
