import copy
import unittest
import tempfile
import os
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch
import qa


class BudgetTests(unittest.TestCase):
    def test_two_allowed(self):
        qa.ensure_budget([], 0, 2)

    def test_unowned_container_counts(self):
        with self.assertRaises(RuntimeError):
            qa.ensure_budget([{'id': 'unrelated'}], 0, 2)

    def test_same_stack_can_restart(self):
        qa.ensure_budget([{}, {}], 2, 2)

    def test_unrelated_plus_replacement_refused(self):
        with self.assertRaises(RuntimeError):
            qa.ensure_budget([{}, {}], 1, 2)

    def test_worker_data_override_cannot_bypass_global_lock(self):
        code = ('import qa\ntry:\n with qa.budget_lock(): pass\n'
                'except OSError: raise SystemExit(3)\n')
        with tempfile.TemporaryDirectory() as worker_data, qa.budget_lock():
            child = subprocess.run([sys.executable, '-B', '-c', code], cwd=qa.BASE,
                                   env={**os.environ, 'AO_DATA_DIR': worker_data},
                                   capture_output=True, timeout=10)
        self.assertEqual(child.returncode, 3, 'worker bypassed the shared Docker lock')

    def test_legacy_names_ports_and_admin_removed(self):
        fixture = {'name': 'legacy', 'services': {
            'web': {'container_name': 'shared', 'build': {'context': '.'}, 'ports': ['8888:80'],
                    'depends_on': {'db': {}, 'phpmyadmin': {}}},
            'db': {'image': 'mysql:8.0', 'ports': ['3306:3306']}, 'phpmyadmin': {'image': 'admin'}},
            'volumes': {'db_data': {'name': 'production-db'}}}
        root = Path.cwd()
        with patch.object(qa, 'run', return_value=__import__('json').dumps(copy.deepcopy(fixture))):
            name, config = qa.compose_config('sample', {'compose': 'compose.yml', 'path': str(root), 'image': 'cached', 'port': 18900}, root)
        self.assertEqual(set(config['services']), {'web', 'db'})
        self.assertNotIn('container_name', config['services']['web'])
        self.assertEqual(set(config['services']['web']['depends_on']), {'db'})
        self.assertEqual(config['services']['db']['ports'], [])
        self.assertEqual(config['services']['web']['ports'][0]['host_ip'], '127.0.0.1')
        self.assertNotIn('name', config['volumes']['db_data'])

    def test_unrelated_repository_is_rejected(self):
        root = Path.cwd()
        with tempfile.TemporaryDirectory() as other, patch.object(qa, 'git', side_effect=[str(root), str(root / '.git'), str(Path(other) / '.git')]):
            with self.assertRaises(RuntimeError):
                qa.root_for({'path': other}, str(root))

    def test_worktree_with_shared_git_metadata_is_accepted(self):
        with tempfile.TemporaryDirectory() as canonical, tempfile.TemporaryDirectory() as worktree:
            shared = str(Path(canonical) / '.git')
            with patch.object(qa, 'git', side_effect=[worktree, shared, shared]):
                self.assertEqual(qa.root_for({'path': canonical}, worktree), Path(worktree).resolve())

    def test_plain_subfolder_is_rejected(self):
        root = Path.cwd()
        with patch.object(qa, 'git', side_effect=[str(root.parent), str(root / '.git'), str(root / '.git')]):
            with self.assertRaises(RuntimeError):
                qa.root_for({'path': str(root)}, str(root))



class LaneTests(unittest.TestCase):
    """New projects get the decided lanes (docs/DECISIONS.md "Model lanes" and "AO reviewer lane"): Claude worker on Haiku in auto mode,
    Claude orchestrator on Opus, Codex reviewer on gpt-6.1-sol at high effort. Full model IDs: AO 0.13.7 rejects aliases."""

    def run_apply(self, existing_config=None, lanes=False, extra=None):
        import json
        import setup
        calls = []
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'proj'
            root.mkdir()
            reg = Path(tmp) / 'projects.json'
            reg.write_text(json.dumps({'projects': {'demo': {'path': str(root), 'port': 5173, **(extra or {})}}}), encoding='utf-8')
            # AO 0.14.2 shape (ai-setup-4 evidence): defaultBranch is top-level in GET, never inside config.
            existing = dict(existing_config or {})
            store = {'branch': existing.pop('defaultBranch', 'main'), 'config': existing}

            def api(method, path, body=None):
                calls.append((method, path, copy.deepcopy(body)))
                if path == 'projects' and method == 'GET':
                    return {'projects': [{'id': 'demo', 'path': str(root)}] if existing_config is not None else []}
                if path == 'projects/demo' and method == 'GET':
                    return {'project': {'defaultBranch': store['branch'], 'config': copy.deepcopy(store['config'])}}
                if (method, path) in (('POST', 'projects'), ('PUT', 'projects/demo/config')):
                    config = copy.deepcopy(body['config'])
                    store['branch'] = config.pop('defaultBranch', store['branch'])
                    store['config'] = config
                    return {}
                if path.endswith('/cues') and method == 'GET':
                    return {'cues': []}
                return {}
            with patch.object(setup, 'REGISTRY', reg), patch.object(setup, 'api', api), \
                 patch.object(qa, 'root_for', return_value=root), patch.object(qa, 'git', return_value='main'):
                setup.apply(lanes=lanes)
        return {**store['config'], 'defaultBranch': store['branch']}, calls

    def test_new_project_gets_claude_worker_and_codex_reviewer(self):
        config, _ = self.run_apply()
        self.assertEqual(config['worker'], {'agent': 'claude-code', 'agentConfig': {'model': 'claude-haiku-5-5', 'permissions': 'auto'}})
        self.assertEqual(config['orchestrator']['agent'], 'claude-code')
        self.assertEqual(config['orchestrator']['agentConfig']['model'], 'claude-opus-5-5')
        self.assertEqual(config['reviewers'], [{'harness': 'codex', 'agentConfig': {'model': 'gpt-6.1-sol', 'effort': 'high'}}])
        self.assertFalse(config['autoReview'])

    def test_no_codex_config_needed(self):
        with tempfile.TemporaryDirectory() as empty, patch.dict(os.environ, {'CODEX_HOME': empty}):
            config, _ = self.run_apply()
        self.assertEqual(config['worker']['agent'], 'claude-code')

    def test_existing_project_keeps_its_roles_unless_lanes(self):
        old = {'defaultBranch': 'main', 'worker': {'agent': 'codex', 'agentConfig': {'model': 'gpt-6.1-sol'}},
               'orchestrator': {'agent': 'claude-code', 'agentConfig': {'model': 'sonnet'}}, 'reviewers': [{'harness': 'claude-code'}], 'env': {'A': '1'},
               'postCreate': ['echo hi'], 'symlinks': ['node_modules']}
        kept, _ = self.run_apply(existing_config=old)
        self.assertEqual(kept['worker'], old['worker'])
        self.assertEqual(kept['reviewers'], old['reviewers'])
        moved, _ = self.run_apply(existing_config=old, lanes=True)
        self.assertEqual(moved['worker']['agent'], 'claude-code')
        self.assertEqual(moved['reviewers'][0]['harness'], 'codex')
        self.assertEqual(moved['env'], {'A': '1'})
        self.assertEqual(moved['symlinks'], ['node_modules'])
        self.assertIn('echo hi', moved['postCreate'])
        self.assertIn('[AO local QA]', moved['agentRules'])
        self.assertEqual(moved['defaultBranch'], 'main')

    def test_default_branch_read_from_top_level_for_existing_project(self):
        # Reproduces KeyError 'defaultBranch' (setup.py final print) on 0.14.2 shape.
        config, _ = self.run_apply(existing_config={'worker': {'agent': 'claude-code'}})
        self.assertEqual(config['defaultBranch'], 'main')

    def test_default_branch_readback_for_new_project(self):
        # Reproduces the readback RuntimeError: GET config has no defaultBranch, top-level has it.
        config, _ = self.run_apply()
        self.assertEqual(config['worker']['agent'], 'claude-code')


class CommandTests(unittest.TestCase):
    def test_windows_command_has_no_embedded_quotes(self):
        # AO 0.14.2 quotes arguments itself; the embedded quotes broke every spawn (WORKSPACE_PROVISION_FAILED).
        import setup
        with patch.object(setup.os, 'name', 'nt'):
            command = setup.command('prepare', 'demo')
        self.assertNotIn('"', command)
        self.assertTrue(command.endswith('-Action prepare -Project demo'), command)


if __name__ == '__main__':
    unittest.main()
