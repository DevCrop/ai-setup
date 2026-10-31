import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { RoutineSource, masker, normalizeRoutines, readClaudeRoutines, readCodexAutomations } from '../core/sources/routine-source.js';
import { tmpDir } from './helpers.mjs';

const mask = masker('kimuser');
const task = (o = {}) => ({ ai: 'claude', name: '클로드 백업', path: '\\클로드 백업', state: 3, enabled: true, lastRun: '2026-10-30T01:00:00.0000000Z', nextRun: '2026-11-01T01:00:00.0000000Z', lastResult: '0x0', triggers: ['daily'], exe: 'claude.exe', account: 'user', elevated: false, ...o });
const homes = () => { const h = tmpDir(); return { claude: path.join(h, 'claude'), codex: path.join(h, 'codex') }; };

test('normalize: Korean name kept, a single object becomes a list, a task that never ran has null dates, other tools dropped', () => {
  const d = normalizeRoutines({ tasks: task({ lastRun: null, nextRun: '', lastResult: '0x41303' }), startup: [{ ai: 'codex', name: 'A', location: 'folder', scope: 'all', exe: 'a.lnk', enabled: false }, { ai: 'other', name: 'B' }] }, mask);
  assert.equal(d.tasks.length, 1);
  assert.equal(d.tasks[0].name, '클로드 백업');
  assert.equal(d.tasks[0].lastRun, null);
  assert.equal(d.tasks[0].nextRun, null);
  assert.equal(d.tasks[0].failed, false);
  assert.deepEqual(d.startup, [{ ai: 'codex', name: 'A', location: 'folder', scope: 'all', exe: 'a.lnk', enabled: false }]);
  assert.deepEqual(normalizeRoutines({}, mask), { tasks: [], startup: [] });
});

test('normalize: running, queued, not-yet-run and info codes are not failures; error codes are, unless the task is off', () => {
  const f = (o) => normalizeRoutines({ tasks: [task(o)] }, mask).tasks[0];
  for (const c of ['0x0', '0x41301', '0x41325', '0x41303', '0x40010004', '0x10000000']) assert.equal(f({ lastResult: c }).failed, false, c);
  assert.equal(f({ lastResult: '0x1' }).failed, true);
  assert.equal(f({ lastResult: '0x800710e0' }).failed, true);
  assert.equal(f({ lastResult: '0x800710e0' }).lastResult, '0x800710E0');
  assert.equal(f({ lastResult: '0x1', enabled: false }).failed, false);
  assert.equal(f({ state: 4 }).state, 'running');
});

test('normalize: basenames only; arguments, folders, SIDs, the user name and unknown accounts never pass', () => {
  const d = normalizeRoutines({
    tasks: [
      task({ exe: 'C:\\Users\\kimuser\\bin\\claude.exe', account: 'DOMAIN\\kimuser' }),
      task({ exe: 'codex.exe --token=abc', name: 'ClaudeTaskUserS-1-5-21-111-222-333-1001', path: '\\Adobe-PC-KimUser\\ClaudeTaskUserS-1-5-21-111-222-333-1001' }),
    ],
    startup: [{ ai: 'claude', name: 'x', exe: 'C:\\Users\\kimuser\\a.exe -silent' }],
  }, mask);
  assert.equal(d.tasks[0].exe, 'claude.exe');
  assert.equal(d.tasks[0].account, null);
  assert.equal(d.tasks[1].exe, null);
  assert.equal(d.tasks[1].name, 'ClaudeTaskUserS-1-5-21-…');
  const all = JSON.stringify(d);
  for (const bad of ['kimuser', 'KimUser', '1001', 'abc', '-silent']) assert.ok(!all.includes(bad), bad);
});

test('claude routines: front matter name and description only, never the body', () => {
  const h = homes();
  const dir = path.join(h.claude, 'scheduled-tasks');
  fs.mkdirSync(path.join(dir, 'daily'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'daily', 'SKILL.md'), '---\nname: daily-check\ndescription: "Daily check"\n---\n\nSECRET body cd /d/project\n');
  fs.mkdirSync(path.join(dir, 'bare'));
  assert.deepEqual(readClaudeRoutines(h.claude), [{ name: 'bare', description: '' }, { name: 'daily-check', description: 'Daily check' }]);
  assert.deepEqual(readClaudeRoutines(path.join(h.claude, 'none')), []);
});

test('codex automations: id, name, kind, status, rrule and time only; the prompt and keys inside it are never read', () => {
  const h = homes();
  const dir = path.join(h.codex, 'automations');
  fs.mkdirSync(path.join(dir, 'trace'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'trace', 'automation.toml'), [
    'version = 1', 'id = "trace"', 'kind = "heartbeat"', 'name = "TRACE"',
    'prompt = """Use C:\\\\Users\\\\kim\\\\secret', 'name = "FAKE"', 'status = "HACKED"', '"""',
    'status = "ACTIVE"', 'rrule = "FREQ=DAILY;BYHOUR=8;BYMINUTE=0"', 'target_thread_id = "01a0"', 'created_at = 1', 'updated_at = 1792858985769',
    '[extra]', 'name = "nested"',
  ].join('\n'));
  fs.mkdirSync(path.join(dir, 'empty'));
  fs.writeFileSync(path.join(dir, '.run-jitter-salt'), 'x');
  const [a, ...rest] = readCodexAutomations(h.codex);
  assert.deepEqual(rest, []);
  assert.deepEqual(a, { id: 'trace', name: 'TRACE', kind: 'heartbeat', status: 'active', rrule: 'FREQ=DAILY;BYHOUR=8;BYMINUTE=0', updatedAt: new Date(1792858985769).toISOString() });
  assert.ok(!JSON.stringify(a).includes('secret'));
  assert.deepEqual(readCodexAutomations(path.join(h.codex, 'none')), []);
});

test('source: off Windows or without a runner reads the files only; one refresh at a time; cached until the TTL', async () => {
  let calls = 0;
  const runner = async () => { calls++; return { code: 0, stdout: JSON.stringify({ tasks: [task()], startup: [] }), stderr: '' }; };
  const h = homes();
  const ctx = (now) => ({ now, homes: h });
  const linux = new RoutineSource({ runner, platform: 'linux', mask });
  await linux.collect(ctx(0)); await linux.settle();
  const l = await linux.collect(ctx(1));
  assert.equal(l.status, 'ok');
  assert.match(l.data.windowsNote, /Windows에서만/);
  assert.equal(calls, 0);
  const s = new RoutineSource({ runner, platform: 'win32', ttlMs: 1000, mask });
  assert.equal((await s.collect(ctx(0))).status, 'missing'); // first run still going
  await s.collect(ctx(1)); // in flight: no second spawn
  await s.settle();
  assert.equal(calls, 1);
  const r = await s.collect(ctx(500));
  assert.equal(r.status, 'ok');
  assert.equal(r.data.tasks[0].name, '클로드 백업');
  assert.equal(r.data.collectedAt, new Date(0).toISOString());
  await s.collect(ctx(1000)); await s.settle();
  assert.equal(calls, 2);
});

test('source: garbage output, a failing exit and a rejecting runner keep the Claude and Codex lists and never throw', async () => {
  const h = homes();
  fs.mkdirSync(path.join(h.claude, 'scheduled-tasks', 'one'), { recursive: true });
  for (const runner of [async () => ({ code: 0, stdout: 'not json', stderr: '' }), async () => ({ code: 1, stdout: '', stderr: 'x' }), async () => { throw new Error('spawn'); }]) {
    const s = new RoutineSource({ runner, platform: 'win32', mask });
    await s.collect({ now: 0, homes: h }); await s.settle();
    const r = await s.collect({ now: 0, homes: h });
    assert.equal(r.status, 'ok');
    assert.deepEqual(r.data.tasks, []);
    assert.equal(r.data.claude.length, 1);
    assert.match(r.data.windowsNote, /읽지 못했/);
  }
});

test('routines.ps1 matches claude or codex on the full command but prints executable names only', () => {
  const src = fs.readFileSync(new URL('../core/sources/routines.ps1', import.meta.url), 'utf8');
  assert.match(src, /exe = ExeName/);
  assert.match(src, /\(claude\|codex\)/);
  assert.doesNotMatch(src, /\.Author|arguments\s*=/i);
  assert.doesNotMatch(src, /^\$AI\b/m); // PowerShell names are case-insensitive: $AI would be overwritten by $ai
});
