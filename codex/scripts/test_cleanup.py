from datetime import timedelta
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from project_cleanup import acknowledge, artifact_info, parse_date, prune, register, scan, timestamp
from setup import read_json, save_json


class CleanupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='trace-cleanup-')
        base = Path(self.temp.name)
        self.root, self.state = base / 'project 한글', base / 'state'
        self.root.mkdir()
        self.git('init', '-q')
        self.git('config', 'user.email', 'fixture@example.invalid')
        self.git('config', 'user.name', 'Fixture')
        (self.root / 'package.json').write_text('{}')
        (self.root / 'package-lock.json').write_text('{}')
        (self.root / '.gitignore').write_text('node_modules/\nvendor/\n.venv/\n')
        self.git('add', '.')
        self.git('commit', '-qm', 'fixture')
        (self.root / 'node_modules').mkdir()
        (self.root / 'node_modules/package.js').write_text('installed fixture')
        register(self.state, 'fixture', str(self.root), auto=True)
        self.start = timestamp() + timedelta(seconds=1)

    def tearDown(self):
        self.temp.cleanup()

    def git(self, *args):
        subprocess.run(['git', '-C', str(self.root), *args], capture_output=True, check=True)

    def observe(self, day, busy=False):
        return scan(self.state, self.start + timedelta(days=day), lambda root: busy)

    def mature(self):
        for day in range(0, 50, 7):
            self.observe(day)

    def info(self, report):
        return report['projects'][0]['artifacts'][0]

    def test_baseline_grace_and_exact_removal_preserve_sources(self):
        self.assertEqual(self.info(self.observe(0))['status'], 'observing')
        self.mature()
        self.assertEqual(self.info(self.observe(49))['status'], 'candidate')
        self.assertEqual(prune(self.state, self.start+timedelta(days=50), lambda root: False)['results'], [])
        acknowledge(self.state, 'fixture', 'node_modules', self.start+timedelta(days=50))
        self.assertEqual(self.info(self.observe(56))['status'], 'candidate')
        result = prune(self.state, self.start+timedelta(days=57), lambda root: False)
        self.assertEqual(result['results'][0]['status'], 'removed')
        self.assertFalse((self.root/'node_modules').exists())
        self.assertTrue((self.root/'package-lock.json').is_file())
        self.assertTrue((self.root/'.git').is_dir())
        self.assertEqual(prune(self.state, self.start+timedelta(days=58), lambda root: False)['results'], [])

    def test_activity_changed_untracked_hold_and_unknown_cancel(self):
        self.mature()
        acknowledge(self.state, 'fixture', 'node_modules', self.start+timedelta(days=49))
        (self.root/'note.txt').write_text('new work')
        self.assertEqual(self.info(self.observe(56))['status'], 'observing')
        self.assertNotIn('notified_at', self.info(self.observe(57)))
        self.assertEqual(self.info(self.observe(58, None))['status'], 'process-unknown')
        self.assertEqual(self.info(self.observe(59, True))['status'], 'observing')
        registry = read_json(self.state/'cleanup-projects.json')
        registry['projects']['fixture']['hold'] = True
        save_json(self.state/'cleanup-projects.json', registry)
        self.assertEqual(self.info(self.observe(60))['status'], 'held')

    def test_missed_collection_restarts_observation(self):
        self.observe(0)
        self.assertEqual(self.info(self.observe(46))['status'], 'observing')
        self.assertEqual(self.observe(47)['projects'][0]['idle_days'], 1)

    def test_missing_locks_tracked_and_nonignored_refused(self):
        (self.root/'package-lock.json').unlink()
        with self.assertRaises(ValueError):
            artifact_info(self.root, 'node_modules')
        (self.root/'package-lock.json').write_text('{}')
        self.git('add', '-f', 'node_modules/package.js')
        with self.assertRaisesRegex(ValueError, 'Tracked'):
            artifact_info(self.root, 'node_modules')
        self.git('reset', '-q', 'HEAD', '--', 'node_modules/package.js')
        (self.root/'.gitignore').write_text('')
        with self.assertRaisesRegex(ValueError, 'ignored'):
            artifact_info(self.root, 'node_modules')
        with self.assertRaises(ValueError):
            artifact_info(self.root, '../outside')

    def test_overlap_and_subdirectory_registration_refused(self):
        with self.assertRaises(ValueError):
            register(self.state, 'other', str(self.root), True)
        (self.root/'nested').mkdir()
        with self.assertRaises(ValueError):
            register(self.state, 'other', str(self.root/'nested'), True)

    def test_nested_link_never_touches_external_content(self):
        external = Path(self.temp.name)/'external'
        external.mkdir()
        (external/'keep').write_text('user')
        link = self.root/'node_modules/shared'
        try:
            link.symlink_to(external, target_is_directory=True)
        except OSError:
            self.skipTest('Symlink creation unavailable')
        with self.assertRaises(ValueError):
            artifact_info(self.root, 'node_modules', deep=True)
        self.mature()
        self.assertEqual(self.info(self.observe(49))['status'], 'refused')
        self.assertEqual((external/'keep').read_text(), 'user')

    def test_windows_junction_never_followed(self):
        if os.name != 'nt':
            self.skipTest('Windows junction check')
        external = Path(self.temp.name)/'external'
        external.mkdir()
        (external/'keep').write_text('user')
        link = self.root/'node_modules/shared'
        # Fixed test paths, one shell. Never route removal through cmd.
        import ctypes
        result = subprocess.run(['cmd', '/c', 'mklink', '/J', str(link), str(external)], capture_output=True)
        if result.returncode:
            self.skipTest('Junction creation unavailable')
        try:
            with self.assertRaises(ValueError):
                artifact_info(self.root, 'node_modules', deep=True)
            self.assertTrue((external/'keep').is_file())
        finally:
            os.rmdir(link)

    def test_lock_change_and_new_install_cancel_candidates(self):
        self.mature()
        acknowledge(self.state, 'fixture', 'node_modules', self.start+timedelta(days=49))
        (self.root/'package-lock.json').write_text('{"new":true}')
        self.assertEqual(self.info(self.observe(56))['status'], 'observing')
        self.assertEqual(prune(self.state, self.start+timedelta(days=57), lambda root: False)['results'], [])

    def test_timezone_required(self):
        with self.assertRaises(ValueError):
            parse_date('2026-01-01T00:00:00')

    def test_special_file_refused(self):
        if not hasattr(os, 'mkfifo'):
            self.skipTest('POSIX special-file check')
        os.mkfifo(self.root/'node_modules/pipe')
        with self.assertRaisesRegex(ValueError, 'Special'):
            artifact_info(self.root, 'node_modules', deep=True)


if __name__ == '__main__':
    unittest.main()
