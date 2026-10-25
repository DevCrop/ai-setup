import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ClaudeSource } from '../core/sources/claude-source.js';
import { CodexSource } from '../core/sources/codex-source.js';
import { isDenied } from '../core/guard.js';
import { CANARY, NOW, fakeCodex, tmpDir, write } from './helpers.mjs';

test('CodexSource: config, backups, logs and sessions from a fake ~/.codex', async () => {
  const { home, live, gone } = fakeCodex();
  const r = await new CodexSource().collect({ now: NOW, homes: { codex: home } });
  assert.equal(r.status, 'ok');
  const { config, backups, logs, sessions } = r.data;
  assert.equal(config.model, 'gpt-5-codex');
  assert.deepEqual(config.projects.map((p) => [p.path, p.exists]), [[live, true], [gone, false]]);
  assert.equal(backups.length, 3);
  assert.deepEqual(logs.map((l) => l.name), ['logs_1.sqlite']);
  assert.equal(sessions.total, 3);
  assert.equal(sessions.last7d, 2); // the 2025 file is outside the window
});

test('CodexSource: a missing or unreadable ~/.codex is status missing, never a throw', async () => {
  const r = await new CodexSource().collect({ now: NOW, homes: { codex: path.join(tmpDir(), 'nope') } });
  assert.equal(r.status, 'missing');
  assert.equal(r.data, null);
});

test('CodexSource: config.toml over 1 MB is not read and says so', async () => {
  const { home, config } = fakeCodex();
  fs.writeFileSync(config, `a = "${'x'.repeat((1 << 20) + 10)}"\n`);
  const r = await new CodexSource().collect({ now: NOW, homes: { codex: home } });
  assert.equal(r.status, 'warn');
  assert.match(r.note, /1 MB/);
  assert.equal(r.data.config, null);
});

test('CodexSource never opens auth.json, secrets/, .sandbox-secrets/ or .env, and session files are not opened', async () => {
  const { home } = fakeCodex();
  const opened = [];
  const names = ['readFileSync', 'openSync', 'createReadStream', 'readFile'];
  const orig = Object.fromEntries(names.map((n) => [n, fs[n]]));
  for (const n of names) fs[n] = function (...a) { opened.push(String(a[0])); return orig[n].apply(this, a); };
  try { await new CodexSource().collect({ now: NOW, homes: { codex: home } }); } finally { Object.assign(fs, orig); }
  assert.ok(opened.length > 0);
  for (const f of opened) {
    assert.equal(isDenied(f, home), false, f);
    assert.ok(!f.includes(`${path.sep}sessions${path.sep}`), `session file opened: ${f}`);
  }
});

test('ClaudeSource: passes ctx to collect, adds summary and live-only key names (never values)', async () => {
  const home = tmpDir();
  const repo = tmpDir();
  write(path.join(home, 'settings.json'), JSON.stringify({ model: 'x', apiToken: CANARY.claudeToken, env: { A: '1' } }));
  write(path.join(repo, 'claude', 'settings.json'), JSON.stringify({ model: 'y' }));
  write(path.join(home, '.credentials.json'), CANARY.claudeToken);
  let seen;
  const src = new ClaudeSource({ collectFn: async (o) => { seen = o; return { generatedAt: new Date(NOW).toISOString(), routing: { status: 'ok', agents: [] } }; } });
  const r = await src.collect({ now: NOW, homes: { claude: home }, repo, env: {}, cache: new Map(), refreshSec: 10 });
  assert.equal(seen.home, home);
  assert.equal(seen.repo, repo);
  assert.equal(seen.refreshSec, 10);
  assert.deepEqual(r.data.liveOnlyKeys, ['apiToken', 'env']);
  assert.ok(r.data.summary);
  assert.ok(!JSON.stringify(r).includes(CANARY.claudeToken));
});

test('ClaudeSource: a throwing collect becomes status missing', async () => {
  const r = await new ClaudeSource({ collectFn: async () => { throw new Error('boom /secret/path'); } }).collect({ now: NOW, homes: { claude: tmpDir() }, repo: tmpDir() });
  assert.equal(r.status, 'missing');
  assert.ok(!JSON.stringify(r).includes('/secret/path'));
});

test('ClaudeSource with the real collect(): fake home and repo, no rtk, claude-mem pointed at an unused port', async () => {
  const home = tmpDir();
  const mem = tmpDir();
  const r = await new ClaudeSource().collect({
    now: NOW, homes: { claude: home }, repo: tmpDir(), cache: new Map(), refreshSec: 10,
    env: { CLAUDE_MEM_DATA_DIR: mem, CLAUDE_MEM_WORKER_PORT: '1', MONITOR_RTK_BIN: path.join(mem, 'no-rtk'), PATH: '' },
  });
  assert.ok(['ok', 'warn', 'missing'].includes(r.status));
  assert.ok(r.data.summary && Array.isArray(r.data.summary.issues));
  assert.deepEqual(r.data.liveOnlyKeys, []);
});

test('CodexSource: detail data (config lists, agents, skills, sessions, logs, backups, worktrees) from a fake ~/.codex', async () => {
  const { home, liveHook, goneHook } = fakeCodex();
  const r = await new CodexSource().collect({ now: NOW, homes: { codex: home } });
  const d = r.data;
  assert.deepEqual(d.config.hookList.map((h) => [h.path, h.exists]), [[liveHook, true], [goneHook, false]]);
  assert.deepEqual(d.agents.map((a) => [a.name, a.size]), [['explorer.toml', 'CANARY_AGENT_FILE_9f3a'.length]]); // sizes only, AGENTS.md is not an agent
  assert.equal(d.agentsMd, 'agents md'.length);
  assert.deepEqual(d.skills, ['alpha', 'beta']);
  assert.equal(d.sessions.archived, 1);
  assert.equal(d.worktrees.count, 2);
  assert.equal(d.worktrees.oldestMtimeMs, NOW - 40 * 86400000);
  assert.ok(d.backups.every((b) => Number.isFinite(b.mtimeMs) && b.size > 0));
});

test('CodexSource: AGENTS.md in ~/.codex is used when agents/ has none; missing folders give empty values, not a throw', async () => {
  const home = tmpDir();
  write(path.join(home, 'AGENTS.md'), '12345');
  const r = await new CodexSource().collect({ now: NOW, homes: { codex: home } });
  assert.equal(r.status, 'warn'); // no config.toml
  assert.deepEqual([r.data.agentsMd, r.data.agents, r.data.skills, r.data.worktrees, r.data.sessions.archived], [5, [], [], { count: 0, oldestMtimeMs: null }, 0]);
});

test('CodexSource: a hook state with a relative file part is not reported as missing', async () => {
  const home = tmpDir();
  write(path.join(home, 'config.toml'), "[hooks.state.'rel/hooks.json:pre:0:0']\nenabled = true\n");
  const r = await new CodexSource().collect({ now: NOW, homes: { codex: home } });
  assert.deepEqual(r.data.config.hookList.map((h) => [h.path, h.exists]), [['rel/hooks.json', true]]);
});
