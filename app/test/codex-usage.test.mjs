import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { X7CodexLimit } from '../core/checks/x7-codex-limit.js';
import { X8CodexBigContext } from '../core/checks/x8-codex-big-context.js';
import { scanCodexUsage } from '../core/codex-usage.js';
import { CANARY, snap, tmpDir, write } from './helpers.mjs';

const NOW = Date.parse('2026-10-31T12:00:00'); // local time
const at = (minAgo) => new Date(NOW - minAgo * 60000).toISOString();
const meta = (cwd) => JSON.stringify({ timestamp: at(60), type: 'session_meta', payload: { cwd, base_instructions: { text: CANARY.session }, creator_user_id: CANARY.accessToken } });
const ctx = (model) => JSON.stringify({ timestamp: at(60), type: 'turn_context', payload: { model, cwd: 'x', collaboration_mode: { settings: { developer_instructions: CANARY.agentFile } } } });
const msg = (text) => JSON.stringify({ timestamp: at(59), type: 'response_item', payload: { type: 'message', content: [{ type: 'input_text', text }] } });
const tc = (minAgo, total, last, rate) => JSON.stringify({
  timestamp: at(minAgo), type: 'event_msg',
  payload: {
    type: 'token_count',
    info: { total_token_usage: { input_tokens: total[0], cached_input_tokens: total[1], output_tokens: total[2], total_tokens: total[0] + total[2] }, last_token_usage: { input_tokens: last }, model_context_window: 400000 },
    rate_limits: rate ? { primary: { used_percent: rate, window_minutes: 10080, resets_at: Math.floor((NOW + 3600000) / 1000) }, secondary: null } : null,
  },
});

function codexHome() {
  const home = tmpDir('cm-cxu-');
  const day = path.join(home, 'sessions', '2026', '10', '31');
  const a = write(path.join(day, 'rollout-a.jsonl'), [
    meta('D:\\work\\alpha'), ctx('gpt-6.1-sol'),
    // a prompt that quotes the marker words must still never be parsed or kept
    msg(`${CANARY.session} "token_count" "session_meta"`),
    tc(50, [1000, 800, 100], 1000, 40),
    tc(49, [1000, 800, 100], 1000, 40), // repeated event adds nothing
    tc(10, [3000, 2500, 300], 300000, 85),
  ].join('\n') + '\n');
  write(path.join(day, 'rollout-b.jsonl'), [meta('/home/u/beta/'), ctx('gpt-6-astra'), tc(30, [500, 0, 50], 500, 20)].join('\n') + '\n');
  // a week-old file outside the window by mtime is not read at all
  const old = write(path.join(home, 'sessions', '2026', '10', '01', 'rollout-old.jsonl'), [meta('/old'), tc(60 * 24 * 30, [9e9, 0, 9e9], 1)].join('\n') + '\n');
  fs.utimesSync(old, new Date(NOW - 30 * 86400000), new Date(NOW - 30 * 86400000));
  write(path.join(home, 'secrets', 'rollout-x.jsonl'), CANARY.secretsFile);
  return { home, a };
}

test('scanCodexUsage: per-day and per-project counts from token_count rises, the newest limit, live context; no text kept', async () => {
  const { home } = codexHome();
  const r = await scanCodexUsage(home, NOW, new Map());
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.days.find((d) => d.date === '2026-10-31'), { date: '2026-10-31', input: 3500, cached: 2500, output: 350 });
  assert.deepEqual(r.today.projects.map((p) => [p.projectName, p.sessions, p.output]), [['alpha', 1, 300], ['beta', 1, 50]]);
  assert.deepEqual([r.today.output, r.today.sessions], [350, 2]);
  assert.equal(r.rate.primary.usedPercent, 85);
  assert.equal(r.rate.primary.windowMinutes, 10080);
  assert.deepEqual(r.live.map((l) => [l.projectName, l.tokens]), [['alpha', 300000]]); // beta's last event is 30 min old
  assert.deepEqual(r.models, [{ model: 'gpt-6.1-sol', output: 300 }, { model: 'gpt-6-astra', output: 50 }]);
  const text = JSON.stringify(r);
  for (const v of Object.values(CANARY)) assert.ok(!text.includes(v), v);
  assert.ok(!text.includes('D:\\work'));
});

test('scanCodexUsage: reads only appended bytes, waits for a partial line, restarts on a shrunk file, skips a line longer than a chunk', async () => {
  const { home, a } = codexHome();
  const cache = new Map();
  await scanCodexUsage(home, NOW, cache);
  fs.appendFileSync(a, tc(5, [4000, 3000, 400], 1000, 90).slice(0, 40)); // half a line
  assert.equal((await scanCodexUsage(home, NOW, cache)).today.output, 350);
  fs.appendFileSync(a, `${tc(5, [4000, 3000, 400], 1000, 90).slice(40)}\n`);
  let r = await scanCodexUsage(home, NOW, cache);
  assert.deepEqual([r.today.output, r.rate.primary.usedPercent], [450, 90]);
  // one 9 MB prompt line, then a normal event: the event after it still counts
  fs.appendFileSync(a, `${msg('y'.repeat(9 << 20))}\n${tc(4, [5000, 3500, 500], 1000, 91)}\n`);
  r = await scanCodexUsage(home, NOW, cache);
  assert.deepEqual([r.today.output, r.rate.primary.usedPercent], [550, 91]);
  fs.writeFileSync(a, `${meta('/x/gamma')}\n${tc(3, [10, 0, 7], 10, 10)}\n`);
  r = await scanCodexUsage(home, NOW, cache);
  assert.ok(r.today.projects.some((p) => p.projectName === 'gamma' && p.output === 7));
  assert.ok(!r.today.projects.some((p) => p.projectName === 'alpha'));
});

test('scanCodexUsage: no sessions folder reads as missing; a limit window that already reset reads as unknown', async () => {
  assert.equal((await scanCodexUsage(tmpDir(), NOW)).status, 'missing');
  const { home } = codexHome();
  assert.equal((await scanCodexUsage(home, NOW + 2 * 3600000, new Map())).rate, null);
});

const withUsage = (usage) => snap({ codex: { status: 'ok', note: '', data: { usage } } });

test('X7: warn at 80% and up per window, with the reset time; nothing below or without a report', () => {
  const lim = (p) => ({ usedPercent: p, windowMinutes: 10080, resetsAt: NOW + 3600000 });
  const [f] = new X7CodexLimit().run(withUsage({ rate: { primary: lim(100), secondary: null } }));
  assert.deepEqual([f.id, f.severity], ['X7:primary', 'warn']);
  assert.match(f.title, /100% \(7일 창\)/);
  assert.match(f.detail, /막힙니다/);
  assert.deepEqual(new X7CodexLimit().run(withUsage({ rate: { primary: lim(79), secondary: null } })), []);
  assert.deepEqual(new X7CodexLimit().run(withUsage({ rate: { primary: lim(10), secondary: lim(95) } })).map((x) => x.id), ['X7:secondary']);
  assert.deepEqual(new X7CodexLimit().run(withUsage(null)), []);
});

test('X8: a live Codex session over 60% of its window, one finding per project, hashed id', () => {
  const out = new X8CodexBigContext().run(withUsage({ live: [
    { projectName: '나인원랩스', tokens: 300000, window: 400000 },
    { projectName: '나인원랩스', tokens: 250000, window: 400000 },
    { projectName: 'small', tokens: 1000, window: 400000 },
  ] }));
  assert.equal(out.length, 1);
  assert.match(out[0].id, /^X8:[0-9a-f]{12}$/);
  assert.equal(out[0].severity, 'info');
});
