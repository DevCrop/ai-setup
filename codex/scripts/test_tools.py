import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import tarfile
import unittest
from unittest.mock import patch
import zipfile

from tools import extract, install, rollback, uninstall, runtime_env, target_name, validate_command, release_plan, plan_update, RTK_RELEASE_SOURCE
from setup import read_json, save_json


class ToolTests(unittest.TestCase):
    def release_fixture(self, version='0.51.0'):
        names = ['rtk-x86_64-pc-windows-msvc.zip', 'rtk-aarch64-apple-darwin.tar.gz']
        assets = [{'name': name, 'digest': 'sha256:' + 'a'*64,
                   'browser_download_url': f'https://github.com/rtk-ai/rtk/releases/download/v{version}/{name}'}
                  for name in names]
        release = {'tag_name': 'v'+version, 'assets': assets}
        lock = {'version': version, 'assets': {a['name']: {'url': a['browser_download_url'],
                                                        'sha256': 'a'*64} for a in assets}}
        return release, lock

    def test_release_plan_reuses_exact_pin_and_never_installs(self):
        release, lock = self.release_fixture()
        before = json.dumps(lock, sort_keys=True)
        self.assertEqual(release_plan(release, lock)['status'], 'unchanged')
        newer, _ = self.release_fixture('0.52.0')
        candidate = release_plan(newer, lock)
        self.assertEqual(candidate['status'], 'candidate')
        self.assertTrue(candidate['requires_semantic_review'])
        self.assertEqual(json.dumps(lock, sort_keys=True), before)

    def test_release_plan_rejects_unstable_and_defers_older(self):
        release, lock = self.release_fixture()
        for field in ['draft', 'prerelease']:
            with self.subTest(field=field), self.assertRaises(ValueError):
                release_plan({**release, field: True}, lock)
        with self.assertRaises(ValueError):
            release_plan({**release, 'tag_name':'v0.52.0-rc.1'}, lock)
        older, _ = self.release_fixture('0.50.0')
        self.assertEqual(release_plan(older, lock)['status'], 'deferred')

    def test_release_plan_rejects_missing_duplicate_untrusted_assets(self):
        release, lock = self.release_fixture('0.52.0')
        for assets in [release['assets'][:-1], release['assets'] + release['assets'][:1],
                       [{**release['assets'][0], 'digest':None}, release['assets'][1]],
                       [{**release['assets'][0], 'browser_download_url':'https://example.invalid/rtk.zip'}, release['assets'][1]]]:
            with self.subTest(assets=assets), self.assertRaises(ValueError):
                release_plan({**release, 'assets': assets}, lock)

    def test_same_version_asset_drift_preserves_reviewed_pin(self):
        release, lock = self.release_fixture()
        release['assets'][0]['digest'] = 'sha256:'+'b'*64
        with self.assertRaises(ValueError):
            release_plan(release, lock)
        self.assertEqual(lock['assets'][release['assets'][0]['name']]['sha256'], 'a'*64)

    def test_update_plan_requires_current_matching_collection(self):
        release, lock = self.release_fixture()
        body = json.dumps(release, sort_keys=True)
        sha = hashlib.sha256(body.encode()).hexdigest()
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            with self.assertRaises(ValueError):
                plan_update(state, lock)
            report = {'checked_at':'2026-10-07T00:00:00Z', 'results':[
                {'id':'R41', 'url':RTK_RELEASE_SOURCE, 'status':'fetched', 'sha256':sha}]}
            save_json(state/'source-report.json', report)
            save_json(state/'source-status.json', {'R41':{'body':body,'sha256':sha}})
            with patch('tools.download', side_effect=AssertionError('No network allowed')):
                self.assertEqual(plan_update(state, lock)['status'], 'unchanged')
            report['results'][0]['status'] = 'error'
            save_json(state/'source-report.json', report)
            with self.assertRaises(ValueError):
                plan_update(state, lock)
            report['results'][0]['status'] = 'fetched'
            save_json(state/'source-report.json', report)
            save_json(state/'source-status.json', {'R41':{'body':body+' ', 'sha256':sha}})
            with self.assertRaises(ValueError):
                plan_update(state, lock)

    def test_same_version_install_cannot_replace_receipted_asset(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            lock, fetcher = self.package('fixture')
            installed = install(state, lock, fetcher, verify_binary=False)
            record = (state/'tools-installed.json').read_bytes()
            before = Path(installed['path']).read_bytes()
            lock['assets'][target_name()]['sha256'] = 'b'*64
            with self.assertRaises(ValueError):
                install(state, lock, fetcher, verify_binary=False)
            self.assertEqual(Path(installed['path']).read_bytes(), before)
            self.assertEqual((state/'tools-installed.json').read_bytes(), record)

    def package(self, version):
        payload = version.encode()
        buffer = io.BytesIO()
        if os.name == 'nt':
            with zipfile.ZipFile(buffer, 'w') as z:
                z.writestr('rtk.exe', payload)
        else:
            with tarfile.open(fileobj=buffer, mode='w:gz') as t:
                entry = tarfile.TarInfo('rtk')
                entry.size = len(payload)
                t.addfile(entry, io.BytesIO(payload))
        data = buffer.getvalue()
        lock = {'version': version, 'assets': {target_name():
                {'url': 'fixture', 'sha256': hashlib.sha256(data).hexdigest()}}}
        return lock, lambda url: data

    def test_upgrade_restore_uninstall_and_failed_record(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            one, fetch_one = self.package('one')
            two, fetch_two = self.package('two')
            result = install(state, one, fetch_one, verify_binary=False)
            binary = Path(result['path'])
            with patch('tools.save_json', side_effect=OSError('fixture write failure')):
                with self.assertRaises(OSError):
                    install(state, two, fetch_two, verify_binary=False)
            self.assertEqual(binary.read_bytes(), b'one')
            self.assertEqual(read_json(state/'tools-installed.json')['rtk']['version'], 'one')
            self.assertFalse((state/'tools/rtk/.previous').exists())
            self.assertFalse(list((state/'tools/rtk').glob('.staged*')))
            install(state, two, fetch_two, verify_binary=False)
            with patch('tools.verify', return_value={'status': 'pass'}):
                for action in (rollback, uninstall):
                    with patch('tools.save_json', side_effect=OSError('fixture record failure')):
                        with self.assertRaises(OSError):
                            action(state)
                    self.assertEqual(binary.read_bytes(), b'two')
                    self.assertEqual((state/'tools/rtk/.previous').read_bytes(), b'one')
                    self.assertEqual(read_json(state/'tools-installed.json')['rtk']['version'], 'two')
                self.assertEqual(rollback(state)['version'], 'one')
                self.assertEqual(binary.read_bytes(), b'one')
                self.assertEqual(uninstall(state)['status'], 'removed')
                self.assertEqual(uninstall(state)['status'], 'unchanged')
            self.assertFalse(binary.exists())

    def test_local_compiler_priority_and_missing_compiler_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            (project/'.git').mkdir()
            bins = project/'node_modules/.bin'
            bins.mkdir(parents=True)
            self.assertEqual(runtime_env(project)['PATH'].split(os.pathsep)[0], str(bins.resolve()))
            with self.assertRaises(ValueError):
                validate_command(['tsc'], project)
            compiler = project/'node_modules/typescript/bin/tsc'
            compiler.parent.mkdir(parents=True)
            compiler.write_text('fixture')
            validate_command(['tsc','--noEmit'], project)
            self.assertEqual(runtime_env(project)['npm_config_offline'], 'true')
    def test_platforms_and_bad_archive(self):
        self.assertIn('windows', target_name('Windows', 'AMD64'))
        self.assertIn('aarch64-apple', target_name('Darwin', 'arm64'))
        self.assertIn('linux-musl', target_name('Linux', 'x86_64'))
        with self.assertRaises(ValueError):
            target_name('Windows', 'arm64')
        with self.assertRaises(Exception):
            extract(b'not an archive', 'rtk.zip')

    def test_checksum_owned_repeat_and_modified_conflict(self):
        buffer = io.BytesIO()
        if os.name == 'nt':
            with zipfile.ZipFile(buffer, 'w') as z:
                z.writestr('rtk.exe', b'fixture binary')
                z.writestr('../../outside', b'must not extract')
        else:
            with tarfile.open(fileobj=buffer, mode='w:gz') as t:
                entry = tarfile.TarInfo('rtk')
                entry.size = len(b'fixture binary')
                t.addfile(entry, io.BytesIO(b'fixture binary'))
                link = tarfile.TarInfo('../../outside')
                link.type = tarfile.SYMTYPE
                link.linkname = '/outside'
                t.addfile(link)
        data = buffer.getvalue()
        asset = {'url': 'fixture', 'sha256': hashlib.sha256(data).hexdigest()}
        lock = {'version': 'fixture', 'assets': {target_name(): asset}}
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            result = install(state, lock, lambda u: data, verify_binary=False)
            self.assertEqual(result['status'], 'installed')
            self.assertFalse((state/'outside').exists())
            self.assertEqual(install(state, lock, lambda u: data, verify_binary=False)['status'], 'unchanged')
            Path(result['path']).write_bytes(b'user modified')
            with self.assertRaises(ValueError):
                install(state, lock, lambda u: data, verify_binary=False)
        with tempfile.TemporaryDirectory() as directory:
            asset['sha256'] = '0'*64
            with self.assertRaises(ValueError):
                install(Path(directory), lock, lambda u: data, verify_binary=False)


if __name__ == '__main__':
    unittest.main()
