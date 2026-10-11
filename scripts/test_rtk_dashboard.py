"""Focused live-view tests, using disposable reports and a fake verified runner."""
import copy
from http.client import HTTPConnection
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest

from rtk_dashboard import Collector, make_server, write_ready


def aggregate():
    return {'summary': {'total_commands': 2, 'total_input': 100,
                        'total_output': 60, 'total_saved': 40, 'avg_savings_pct': 40},
            'daily': [{'date': '2026-10-08', 'commands': 2, 'input_tokens': 100,
                       'output_tokens': 60, 'saved_tokens': 40, 'savings_pct': 40}]}


class CollectorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.home = self.root / 'home'
        (self.home / 'bin').mkdir(parents=True)
        (self.home / 'bin/trace_rtk.py').write_text('# fake owned runner', encoding='utf-8')
        self.reports = self.root / 'reports'
        self.reports.mkdir()
        self.baseline = self.reports / 'rtk-efficiency.json'
        self.baseline.write_text(json.dumps({'probe': {'checked_at': '2026-10-08T05:25:00Z',
                                                      'raw_bytes': 84, 'filtered_bytes': 66,
                                                      'raw_command': 'private'}}), encoding='utf-8')
        self.original = self.baseline.read_bytes()
        self.tick = 0
        self.calls = []
        self.raw = aggregate()

    def tearDown(self):
        self.temp.cleanup()

    def runner(self, argv, **kwargs):
        self.calls.append((argv, kwargs))
        return subprocess.CompletedProcess(argv, 0, json.dumps(self.raw), '')

    def collector(self, runner=None):
        return Collector(self.home, self.reports, run=runner or self.runner,
                         clock=lambda: self.tick)

    def test_fixed_verified_runner_readonly_whitelist_and_cache(self):
        self.raw['commands'] = ['private project command']
        self.raw['daily'][0]['project'] = 'private'
        c = self.collector()
        first = c.snapshot()
        self.assertIs(c.snapshot(), first)
        self.assertEqual(len(self.calls), 1)
        argv, kw = self.calls[0]
        self.assertEqual(argv, [sys.executable, '-B', str(self.home / 'bin/trace_rtk.py'),
                               'gain', '--daily', '--format', 'json'])
        self.assertEqual(kw['cwd'], str(self.reports))
        self.assertEqual(kw['env']['CODEX_HOME'], str(self.home))
        self.assertEqual(kw['timeout'], 12)
        self.assertNotIn('project', first['daily'][0])
        self.assertNotIn('commands', first)
        self.assertNotIn('raw_command', first['probe'])
        self.assertEqual(first['probe']['checked_at'], '2026-10-08T05:25:00Z')
        self.assertFalse(first['live']['writes_scheduled_snapshot'])
        self.assertEqual(self.baseline.read_bytes(), self.original)
        self.tick = 2.01
        self.raw['summary']['total_commands'] = 3
        self.assertEqual(c.snapshot()['summary']['total_commands'], 3)
        self.assertEqual(len(self.calls), 2)

    def test_failure_is_sanitized_cached_and_never_fresh_stale_success(self):
        c = self.collector()
        c.snapshot()
        self.tick = 3
        def fail(*args, **kwargs):
            raise OSError('SECRET private host path')
        c.run = fail
        for _ in range(2):
            with self.assertRaisesRegex(RuntimeError, '^Aggregate unavailable$'):
                c.snapshot()
        self.tick = 6
        c.run = self.runner
        self.assertTrue(c.snapshot()['live']['enabled'])

    def test_invalid_date_duplicates_and_nonfinite_counts(self):
        for change in ('date', 'duplicate', 'nan', 'bool', 'fraction'):
            self.raw = aggregate()
            if change == 'date': self.raw['daily'][0]['date'] = '<script>'
            if change == 'duplicate': self.raw['daily'].append(copy.deepcopy(self.raw['daily'][0]))
            if change == 'nan': self.raw['summary']['total_input'] = float('nan')
            if change == 'bool': self.raw['summary']['total_commands'] = True
            if change == 'fraction': self.raw['summary']['total_commands'] = 0.5
            with self.subTest(change=change), self.assertRaises(RuntimeError):
                self.collector().snapshot()

    def test_missing_probe_is_unknown_not_success(self):
        self.baseline.unlink()
        data = self.collector().snapshot()
        self.assertEqual(data['probe'], {})
        self.assertEqual(data['live']['probe_state'], 'unavailable')

    def test_ready_file_refuses_unmanaged_contents_and_replaces_owned_receipt(self):
        path = self.reports / '.rtk-live-ready.json'
        ready = {'url': 'http://127.0.0.1:50000/rtk-efficiency.html', 'pid': 123,
                 'instance_id': 'a' * 32, 'poll_interval_ms': 2000}
        path.write_text('user file', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'Unmanaged readiness file refused'):
            write_ready(path, ready)
        self.assertEqual(path.read_text(encoding='utf-8'), 'user file')
        path.unlink()  # Only this disposable fixture, not a real home.
        write_ready(path, ready)
        write_ready(path, {**ready, 'pid': 124})
        self.assertEqual(json.loads(path.read_text(encoding='utf-8'))['pid'], 124)


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / 'rtk-efficiency.template.html').write_text(
            '<script type="application/json">__RTK_REPORT_DATA__</script>', encoding='utf-8')
        class FakeCollector:
            def snapshot(inner):
                return {'summary': aggregate()['summary'], 'live': {'enabled': True}}
        self.server = make_server(self.root, self.root, collector=FakeCollector())
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)
        self.temp.cleanup()

    def request(self, path, headers=None, method='GET'):
        conn = HTTPConnection('127.0.0.1', self.server.server_port, timeout=3)
        try:
            conn.request(method, path, headers=headers or {})
            response = conn.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            conn.close()

    def test_live_endpoint_and_template(self):
        status, headers, body = self.request('/api/rtk')
        self.assertEqual(status, 200)
        self.assertEqual(headers['Cache-Control'], 'no-store')
        self.assertNotIn('Access-Control-Allow-Origin', headers)
        self.assertTrue(json.loads(body)['live']['enabled'])
        status, _, body = self.request('/rtk-efficiency.html')
        self.assertEqual(status, 200)
        self.assertNotIn(b'__RTK_REPORT_DATA__', body)

    def test_paths_origins_methods_and_failures(self):
        for path in ('/../private.json', '/private.json', '/api/rtk?command=delete', '/assets/'):
            with self.subTest(path=path):
                self.assertEqual(self.request(path)[0], 404)
        for headers in ({'Host': 'attacker.example'}, {'Origin': 'https://attacker.example'},
                        {'Sec-Fetch-Site': 'cross-site'}):
            self.assertEqual(self.request('/api/rtk', headers)[0], 403)
        self.assertEqual(self.request('/api/rtk', method='POST')[0], 405)
        def fail(): raise OSError('SECRET')
        self.server.collector.snapshot = fail
        status, _, body = self.request('/api/rtk')
        self.assertEqual(status, 503)
        self.assertNotIn(b'SECRET', body)


if __name__ == '__main__':
    unittest.main()
