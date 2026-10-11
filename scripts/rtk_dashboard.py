"""Opt-in loopback RTK live viewer; no scheduler, hook or telemetry installation."""
import argparse
from datetime import datetime, timezone, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
import time
from urllib.parse import urlsplit
import uuid


INTERVAL = 2.0
SUMMARY_FIELDS = ('total_commands', 'total_input', 'total_output', 'total_saved',
                  'avg_savings_pct', 'total_time_ms', 'avg_time_ms')
DAILY_FIELDS = ('commands', 'input_tokens', 'output_tokens', 'saved_tokens',
                'savings_pct', 'total_time_ms', 'avg_time_ms')
PROBE_FIELDS = ('check', 'checked_at', 'raw_bytes', 'filtered_bytes', 'raw_exit',
                'filtered_exit', 'required_evidence_preserved',
                'recorded_invocation_delta', 'binary_sha256')


def safe_file(path):
    path = Path(path).absolute()
    for ancestor in (path, *path.parents):
        if ancestor.is_symlink() or (ancestor.exists() and
                getattr(ancestor.lstat(), 'st_file_attributes', 0) & 0x400):
            # Supported macOS system-directory aliases, as in the existing runner.
            if sys.platform == 'darwin' and str(ancestor) in ('/var', '/tmp') and \
                    ancestor.resolve() == Path('/private') / ancestor.name:
                continue
            raise ValueError('Linked report/runtime path refused')
    return path


def numbers(source, fields):
    result = {}
    for key in fields:
        value = source.get(key)
        if value is None and key in ('total_time_ms', 'avg_time_ms'):
            continue
        if isinstance(value, bool) or not isinstance(value, (int, float)) or \
                not math.isfinite(value):
            raise ValueError('Invalid aggregate field')
        if key in ('commands', 'total_commands') and (value < 0 or int(value) != value):
            raise ValueError('Invalid invocation count')
        result[key] = value
    return result


def write_ready(path, ready):
    """Replace only a recognizable previous viewer receipt, never arbitrary files."""
    path = safe_file(path)
    if path.exists():
        try:
            previous = json.loads(path.read_text(encoding='utf-8'))
            owned = isinstance(previous, dict) and \
                isinstance(previous.get('pid'), int) and not isinstance(previous['pid'], bool) and \
                previous['pid'] > 0 and previous.get('poll_interval_ms') == int(INTERVAL * 1000) and \
                re.fullmatch(r'[0-9a-f]{32}', previous.get('instance_id', '')) and \
                re.fullmatch(r'http://127\.0\.0\.1:[0-9]+/rtk-efficiency\.html', previous.get('url', ''))
            if not owned:
                raise ValueError('Unmanaged readiness file')
        except (OSError, ValueError, TypeError):
            raise ValueError('Unmanaged readiness file refused') from None
    path.write_text(json.dumps(ready), encoding='utf-8')


class Collector:
    def __init__(self, home, reports, run=None, clock=time.monotonic):
        self.home = Path(home).absolute()
        self.reports = Path(reports).absolute()
        self.run = run or subprocess.run
        self.clock = clock
        self.lock = threading.Lock()
        self.cached = None
        self.attempt_at = None
        self.error = False

    def snapshot(self):
        with self.lock:
            tick = self.clock()
            if self.attempt_at is not None and tick - self.attempt_at < INTERVAL:
                if self.error:
                    raise RuntimeError('Aggregate unavailable')
                return self.cached
            self.attempt_at = tick
            try:
                runner = safe_file(self.home / 'bin/trace_rtk.py')
                proc = self.run([sys.executable, '-B', str(runner),
                                 'gain', '--daily', '--format', 'json'],
                                cwd=str(self.reports), capture_output=True,
                                text=True, encoding='utf-8', timeout=12,
                                env={**os.environ, 'CODEX_HOME': str(self.home),
                                     'PYTHONIOENCODING': 'utf-8'})
                if proc.returncode or len(proc.stdout) > 8 * 1024 * 1024:
                    raise RuntimeError('Aggregate unavailable')
                raw = json.loads(proc.stdout)
                summary = numbers(raw['summary'], SUMMARY_FIELDS)
                daily = []
                for row in raw['daily']:
                    date = row['date']
                    if not isinstance(date, str) or \
                            datetime.strptime(date, '%Y-%m-%d').strftime('%Y-%m-%d') != date:
                        raise ValueError('Invalid aggregate date')
                    daily.append({'date': date, **numbers(row, DAILY_FIELDS)})
                if len({r['date'] for r in daily}) != len(daily):
                    raise ValueError('Duplicate aggregate date')
                now = datetime.now(timezone.utc)
                # The scheduled snapshot is evidence, not live raw command history.
                probe = {}
                probe_state = 'unavailable'
                baseline = safe_file(self.reports / 'rtk-efficiency.json')
                try:
                    saved = json.loads(baseline.read_text(encoding='utf-8'))
                    probe = {k: v for k, v in saved.get('probe', {}).items()
                             if k in PROBE_FIELDS}
                    probe_state = 'retained'
                except (OSError, ValueError, TypeError):
                    pass
                self.cached = {
                    'collected_at': now.isoformat(),
                    'collection_date_kst': now.astimezone(timezone(timedelta(hours=9))).date().isoformat(),
                    'rtk_record_date_basis': 'RTK recorded date; source timezone not established',
                    'summary': summary, 'daily': sorted(daily, key=lambda r: r['date']),
                    'probe': probe,
                    'arithmetic_difference': summary['total_saved'] -
                        (summary['total_input'] - summary['total_output']),
                    'openai_usage_measured': False,
                    'live': {'enabled': True, 'poll_interval_ms': int(INTERVAL * 1000),
                             'probe_state': probe_state,
                             'writes_scheduled_snapshot': False},
                }
                self.error = False
                return self.cached
            except Exception:
                self.error = True
                # Never expose subprocess stderr, command text or host paths over HTTP.
                raise RuntimeError('Aggregate unavailable') from None


class DashboardServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False


class Handler(BaseHTTPRequestHandler):
    server_version = 'TRACE'
    sys_version = ''

    def log_message(self, *args):
        pass  # No access/command history log.

    def send_body(self, code, content, mime):
        self.send_response(code)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(content)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(content)

    def do_GET(self):
        authority = f'127.0.0.1:{self.server.server_port}'
        origin = self.headers.get('Origin')
        if self.headers.get('Host') != authority or \
                (origin and origin != 'http://' + authority) or \
                self.headers.get('Sec-Fetch-Site') == 'cross-site':
            return self.send_body(403, b'{"error":"Access refused"}', 'application/json')
        parsed = urlsplit(self.path)
        if parsed.query or parsed.fragment or parsed.scheme or parsed.netloc:
            return self.send_body(404, b'{"error":"Not found"}', 'application/json')
        try:
            if parsed.path == '/api/health':
                return self.send_body(200, json.dumps({
                    'viewer': 'TRACE RTK', 'instance_id': self.server.instance_id,
                    'pid': os.getpid()}).encode(), 'application/json')
            if parsed.path in ('/api/rtk', '/rtk-efficiency.json'):
                data = self.server.collector.snapshot()
                return self.send_body(200, json.dumps(data, ensure_ascii=False).encode(),
                                      'application/json; charset=utf-8')
            if parsed.path in ('/', '/rtk-efficiency.html'):
                data = self.server.collector.snapshot()
                template = safe_file(self.server.reports / 'rtk-efficiency.template.html').read_text(encoding='utf-8')
                if template.count('__RTK_REPORT_DATA__') != 1:
                    raise ValueError('Report template invalid')
                payload = json.dumps(data, ensure_ascii=False).replace('</', '<\\/')
                return self.send_body(200, template.replace('__RTK_REPORT_DATA__', payload).encode(),
                                      'text/html; charset=utf-8')
            allowlist = {
                '/adaptive-routine.html': ('adaptive-routine.html', 'text/html; charset=utf-8'),
                '/assets/PretendardVariable.woff2': ('assets/PretendardVariable.woff2', 'font/woff2'),
            }
            if parsed.path in allowlist:
                file, mime = allowlist[parsed.path]
                return self.send_body(200, safe_file(self.server.reports / file).read_bytes(), mime)
            return self.send_body(404, b'{"error":"Not found"}', 'application/json')
        except Exception:
            return self.send_body(503, b'{"error":"Live data unavailable; retain previous display"}',
                                  'application/json')

    def do_POST(self):
        return self.send_body(405, b'{"error":"Read-only viewer"}', 'application/json')

    do_PUT = do_POST
    do_DELETE = do_POST
    do_PATCH = do_POST


def make_server(reports, home, port=0, collector=None):
    reports = safe_file(reports)
    server = DashboardServer(('127.0.0.1', port), Handler)
    server.reports = reports
    server.instance_id = uuid.uuid4().hex
    server.collector = collector or Collector(home, reports)
    return server


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reports-dir', type=Path, required=True)
    parser.add_argument('--home', type=Path,
                        default=Path(os.environ.get('CODEX_HOME', Path.home() / '.codex')))
    parser.add_argument('--port', type=int, default=0)
    parser.add_argument('--ready-file', type=Path)
    args = parser.parse_args()
    try:
        server = make_server(args.reports_dir, args.home, args.port)
        ready = {'url': f'http://127.0.0.1:{server.server_port}/rtk-efficiency.html',
                 'pid': os.getpid(), 'instance_id': server.instance_id,
                 'poll_interval_ms': int(INTERVAL * 1000)}
        if args.ready_file:
            write_ready(args.ready_file, ready)
        print(json.dumps(ready), flush=True)
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    except Exception:
        print('{"status":"failed","error":"Live viewer unavailable"}', flush=True)
        return 1
    finally:
        if 'server' in locals():
            server.server_close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
