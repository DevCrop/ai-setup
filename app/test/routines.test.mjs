import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { RoutineSource, normalizeRoutines, readClaudeRoutines } from '../core/sources/routine-source.js';
import { tmpDir } from './helpers.mjs';

const task = (o = {}) => ({ name: '백업', path: '\\백업', state: 3, enabled: true, hidden: false, lastRun: '2026-10-30T01:00:00.0000000Z', nextRun: '2026-11-01T01:00:00.0000000Z', lastResult: '0x0', triggers: ['daily'], exe: 'robocopy.exe', account: 'user', elevated: false, ...o });
const raw = (o = {}) => ({ tasks: [task()], startup: [], services: { total: 3, running: 2, auto: 2, autoStopped: [], thirdParty: [] }, ...o });
const ok = (data) => async () => ({ code: 0, stdout: JSON.stringify(data), stderr: '' });

test('normalize: Korean name kept, a single object becomes a list, a task that never ran has null dates', () => {
  const d = normalizeRoutines({ tasks: task({ lastRun: null, nextRun: '', lastResult: '0x41303' }), startup: { name: 'A', location: 'folder', scope: 'all', exe: 'a.lnk', enabled: false } });
  assert.equal(d.tasks.length, 1);
  assert.equal(d.tasks[0].name, '백업');
  assert.equal(d.tasks[0].lastRun, null);
  assert.equal(d.tasks[0].nextRun, null);
  assert.equal(d.tasks[0].failed, false);
  assert.deepEqual(d.startup, [{ name: 'A', location: 'folder', scope: 'all', exe: 'a.lnk', enabled: false }]);
  assert.deepEqual(d.services, { total: 0, running: 0, auto: 0, autoStopped: [], thirdParty: [] });
});

test('normalize: running, queued and not-yet-run codes are not failures; other codes are, unless the task is off', () => {
  const f = (o) => normalizeRoutines({ tasks: [task(o)] }).tasks[0];
  for (const c of ['0x0', '0x41301', '0x41325', '0x41303', '0x40010004', '0x10000000']) assert.equal(f({ lastResult: c }).failed, false, c);
  assert.equal(f({ lastResult: '0x1' }).failed, true);
  assert.equal(f({ lastResult: '0x800710e0' }).failed, true);
  assert.equal(f({ lastResult: '0x800710e0' }).lastResult, '0x800710E0');
  assert.equal(f({ lastResult: '0x1', enabled: false }).failed, false);
  assert.equal(f({ state: 4 }).state, 'running');
  assert.equal(f({ path: '\\Microsoft\\Windows\\X' }).microsoft, true);
});

test('normalize: only executable basenames survive; arguments, folders, user names and unknown accounts never do', () => {
  const d = normalizeRoutines({
    tasks: [task({ exe: 'C:\\Users\\kim\\bin\\tool.exe', account: 'DOMAIN\\kim' }), task({ exe: 'tool.exe --token=abc' })],
    startup: [{ name: 'x', exe: 'C:\\Users\\kim\\a.exe /silent' }],
    services: { autoStopped: [{ name: 's', display: 'S', exe: 'svc.exe -k secret' }] },
  });
  assert.equal(d.tasks[0].exe, 'tool.exe');
  assert.equal(d.tasks[0].account, null);
  assert.equal(d.tasks[1].exe, null);
  assert.ok(!JSON.stringify(d).includes('kim'));
  assert.ok(!JSON.stringify(d).includes('secret'));
  assert.ok(!JSON.stringify(d).includes('abc'));
});

test('claude routines: front matter name and description only, never the body', () => {
  const home = tmpDir();
  const dir = path.join(home, 'scheduled-tasks');
  fs.mkdirSync(path.join(dir, 'daily'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'daily', 'SKILL.md'), '---\nname: daily-check\ndescription: "Daily check"\n---\n\nSECRET body cd /d/project\n');
  fs.mkdirSync(path.join(dir, 'bare'));
  assert.deepEqual(readClaudeRoutines(home), [{ name: 'bare', description: '' }, { name: 'daily-check', description: 'Daily check' }]);
  assert.deepEqual(readClaudeRoutines(path.join(home, 'none')), []);
});

test('source: not Windows or no runner never spawns; first collect is missing, then the cached result, refreshed after the TTL', async () => {
  let calls = 0;
  const runner = async (...a) => { calls++; return ok(raw())(...a); };
  const ctx = (now) => ({ now, homes: { claude: tmpDir() } });
  assert.equal((await new RoutineSource({ runner, platform: 'linux' }).collect(ctx(0))).status, 'missing');
  assert.equal((await new RoutineSource({ platform: 'win32' }).collect(ctx(0))).status, 'missing');
  assert.equal(calls, 0);
  const s = new RoutineSource({ runner, platform: 'win32', ttlMs: 1000 });
  const first = await s.collect(ctx(0));
  assert.equal(first.status, 'missing');
  await s.collect(ctx(1)); // in flight: no second spawn
  await s.settle();
  assert.equal(calls, 1);
  const r = await s.collect(ctx(500));
  assert.equal(r.status, 'ok');
  assert.equal(r.data.tasks[0].name, '백업');
  assert.equal(r.data.collectedAt, new Date(0).toISOString());
  assert.equal(calls, 1);
  await s.collect(ctx(1000));
  await s.settle();
  assert.equal(calls, 2);
});

test('source: garbage output, a failing exit and a rejecting runner give missing and never throw', async () => {
  const ctx = { now: 0, homes: { claude: tmpDir() } };
  for (const runner of [async () => ({ code: 0, stdout: 'not json', stderr: '' }), async () => ({ code: 1, stdout: '', stderr: 'x' }), async () => { throw new Error('spawn'); }]) {
    const s = new RoutineSource({ runner, platform: 'win32' });
    await s.collect(ctx);
    await s.settle();
    const r = await s.collect(ctx);
    assert.equal(r.status, 'missing');
    assert.equal(r.data, null);
    assert.match(r.note, /읽지 못했/);
  }
});

test('routines.ps1 sends executable names only and never the command line', () => {
  const src = fs.readFileSync(new URL('../core/sources/routines.ps1', import.meta.url), 'utf8');
  assert.match(src, /exe = ExeName/);
  assert.doesNotMatch(src, /Arguments|\.Author|\.User\b/);
  assert.match(src, /ConvertTo-Json -Compress/);
});
