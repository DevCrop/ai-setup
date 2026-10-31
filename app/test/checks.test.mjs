import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Check } from '../core/check.js';
import * as registry from '../core/checks/index.js';
import { C1ConfigDrift } from '../core/checks/c1-config-drift.js';
import { C2RoutingMismatch } from '../core/checks/c2-routing-mismatch.js';
import { C3SectionHealth } from '../core/checks/c3-section-health.js';
import { C4LiveOnlyKeys } from '../core/checks/c4-live-only-keys.js';
import { X1MissingTrustedProject } from '../core/checks/x1-missing-trusted-project.js';
import { X2StaleBackups } from '../core/checks/x2-stale-backups.js';
import { X3LargeLogDb } from '../core/checks/x3-large-log-db.js';
import { X4MissingHookState } from '../core/checks/x4-missing-hook-state.js';
import { X5McpNoTransport } from '../core/checks/x5-mcp-no-transport.js';
import { X6ManyWorktrees } from '../core/checks/x6-many-worktrees.js';
import { FINDING_ID_RE } from '../core/finding.js';
import { NOW, claudeRes, codexRes, fullClaude, snap } from './helpers.mjs';

const MB = 1024 * 1024;

test('C1: drift gives one warn finding with evidence and a non-restorable fix; no drift gives none', () => {
  const drift = Array.from({ length: 12 }, (_, i) => ({ path: `agents/a${i}.md`, kind: i ? 'differs' : 'missing' }));
  const s = snap({ claude: claudeRes(fullClaude({ setup: { status: 'warn', drift, driftCount: 12 } })), ctx: { repo: '/r' } });
  const [f] = new C1ConfigDrift().run(s);
  assert.equal(f.id, 'C1:drift');
  assert.equal(f.severity, 'warn');
  assert.equal(f.evidence.length, 10);
  assert.equal(f.evidence[0], 'missing: agents/a0.md');
  assert.equal(f.fix.restorable, false);
  assert.deepEqual(new C1ConfigDrift().run(snap({ claude: claudeRes(fullClaude()) })), []);
});

test('C2: one finding per mismatching agent, id made safe; ok, override and no-data verdicts give none', () => {
  const agents = [
    { agentType: 'reviewer', expected: 'opus', models: [{ model: 'claude-sonnet-4', messages: 3 }], verdict: 'mismatch' },
    { agentType: 'plug:in agent', expected: 'haiku', models: [], verdict: 'mismatch' },
    { agentType: 'ok-one', expected: 'opus', models: [], verdict: 'ok' },
    { agentType: 'ov', expected: 'opus', models: [], verdict: 'override' },
    { agentType: 'nd', expected: 'opus', models: [], verdict: 'no data' },
  ];
  const fs = new C2RoutingMismatch().run(snap({ claude: claudeRes(fullClaude({ routing: { status: 'warn', agents } })) }));
  assert.deepEqual(fs.map((f) => f.id), ['C2:reviewer', 'C2:plug_in_agent']);
  assert.ok(fs.every((f) => f.severity === 'warn' && !f.fix));
  assert.deepEqual(fs[0].evidence, ['expected: opus', 'claude-sonnet-4 x3']);
  assert.deepEqual(new C2RoutingMismatch().run(snap({ claude: claudeRes(fullClaude()) })), []);
});

test('C3: warn section is warn, missing section is bad, ok gives none, with a next-step sentence', () => {
  const d = fullClaude({ plugins: { status: 'warn' }, hooks: { status: 'missing' }, rtk: { status: 'ok' }, claudeMem: {} });
  const fs = new C3SectionHealth().run(snap({ claude: claudeRes(d) }));
  assert.deepEqual(fs.map((f) => [f.id, f.severity]), [['C3:plugins', 'warn'], ['C3:hooks', 'bad'], ['C3:claudeMem', 'bad']]);
  assert.ok(fs.every((f) => f.detail.includes('다음 할 일:')));
  assert.deepEqual(new C3SectionHealth().run(snap({ claude: claudeRes(fullClaude()) })), []);
});

test('C4: live-only key names give one info finding that points to the repo; none gives nothing', () => {
  const [f] = new C4LiveOnlyKeys().run(snap({ claude: claudeRes(fullClaude({ liveOnlyKeys: ['env', 'apiToken'] })) }));
  assert.equal(f.id, 'C4:live-only');
  assert.equal(f.severity, 'info');
  assert.deepEqual(f.evidence, ['제외(비밀 가능): env · apiToken']);
  assert.match(f.detail, /저장소 claude\//);
  assert.deepEqual(new C4LiveOnlyKeys().run(snap({ claude: claudeRes(fullClaude()) })), []);
});

test('X1: one finding per vanished trusted project with a restorable fix; existing projects give none', () => {
  const data = { config: { projects: [{ path: '/a', exists: true }, { path: '/gone/1', exists: false }, { path: '/gone/2', exists: false }] } };
  const fs = new X1MissingTrustedProject().run(snap({ codex: codexRes(data), ctx: { homes: { codex: '/h' } } }));
  assert.equal(fs.length, 2);
  assert.ok(fs.every((f) => /^X1:[0-9a-f]{12}$/.test(f.id) && f.severity === 'warn' && f.fix.restorable));
  assert.deepEqual(fs.map((f) => f.evidence[0]), ['/gone/1', '/gone/2']);
  assert.deepEqual(new X1MissingTrustedProject().run(snap({ codex: codexRes({ config: { projects: [{ path: '/a', exists: true }] } }), ctx: { homes: { codex: '/h' } } })), []);
  assert.deepEqual(new X1MissingTrustedProject().run(snap({ codex: codexRes(null, 'missing'), ctx: { homes: { codex: '/h' } } })), []);
});

test('X2: three or more config backups give an info finding; two give none', () => {
  const b = (n) => ({ backups: Array.from({ length: n }, (_, i) => ({ name: `config.toml.bak${i}` })) });
  const [f] = new X2StaleBackups().run(snap({ codex: codexRes(b(3)) }));
  assert.equal(f.id, 'X2:backups');
  assert.equal(f.severity, 'info');
  assert.equal(f.evidence.length, 3);
  assert.deepEqual(new X2StaleBackups().run(snap({ codex: codexRes(b(2)) })), []);
});

test('X3: a log db of 500 MB or more gives a warn finding; just under gives none', () => {
  const logs = (size) => ({ logs: [{ name: 'logs_1.sqlite', size }] });
  const [f] = new X3LargeLogDb().run(snap({ codex: codexRes(logs(500 * MB)) }));
  assert.equal(f.id, 'X3:logs');
  assert.equal(f.severity, 'warn');
  assert.deepEqual(f.evidence, ['logs_1.sqlite 500 MB']);
  assert.deepEqual(new X3LargeLogDb().run(snap({ codex: codexRes(logs(500 * MB - 1)) })), []);
});

test('X4: a hook state whose file is gone gives a restorable warn finding per table; present, unknown or no hooks give none', () => {
  const hookList = [{ key: '/h/a.json:pre_tool_use:0:0', exists: false }, { key: '/h/b.json:pre_tool_use:0:0', exists: true }, { key: '/h/c.json:post_tool_use:0:1', exists: false }];
  const fs = new X4MissingHookState().run(snap({ codex: codexRes({ config: { hookList } }), ctx: { homes: { codex: '/h' } } }));
  assert.equal(fs.length, 2);
  assert.ok(fs.every((f) => /^X4:[0-9a-f]{12}$/.test(f.id) && f.severity === 'warn' && f.fix.restorable));
  assert.deepEqual(fs.map((f) => f.evidence[0]), ['/h/a.json:pre_tool_use:0:0', '/h/c.json:post_tool_use:0:1']);
  const none = (data) => new X4MissingHookState().run(snap({ codex: codexRes(data), ctx: { homes: { codex: '/h' } } }));
  assert.deepEqual(none({ config: { hookList: [{ key: 'k', exists: true }] } }), []);
  assert.deepEqual(none({ config: { hookList: [{ key: 'k' }] } }), []); // unknown is not missing
  assert.deepEqual(none({ config: null }), []);
  assert.deepEqual(new X4MissingHookState().run(snap({ codex: codexRes(null, 'missing'), ctx: { homes: { codex: '/h' } } })), []);
});

test('X5: an enabled MCP server with neither command nor url is a report-only warn; disabled or wired ones give none', () => {
  const mcpList = [
    { name: 'bare', enabled: true, transport: null }, { name: 'off', enabled: false, transport: null },
    { name: 'cmd', enabled: true, transport: 'command' }, { name: 'web', enabled: true, transport: 'url' },
  ];
  const fs = new X5McpNoTransport().run(snap({ codex: codexRes({ config: { mcpList } }) }));
  assert.deepEqual(fs.map((f) => [f.id, f.severity, !!f.fix, f.evidence]), [['X5:bare', 'warn', false, ['mcp_servers.bare']]]);
  assert.deepEqual(new X5McpNoTransport().run(snap({ codex: codexRes({ config: null }) })), []);
});

test('X6: 20 entries or one older than 30 days gives an info finding with the count and the oldest age; below both gives none', () => {
  const day = 86400000;
  const run = (w) => new X6ManyWorktrees().run(snap({ codex: codexRes({ worktrees: w }) }));
  const [many] = run({ count: 20, oldestMtimeMs: NOW - 2 * day });
  assert.deepEqual([many.id, many.severity, !!many.fix, many.evidence], ['X6:worktrees', 'info', false, ['항목 20개', '가장 오래된 것 2일']]);
  const [old] = run({ count: 1, oldestMtimeMs: NOW - 31.5 * day });
  assert.deepEqual(old.evidence, ['항목 1개', '가장 오래된 것 31일']);
  assert.deepEqual(run({ count: 19, oldestMtimeMs: NOW - 30 * day }), []); // exactly 30 days is not older than 30
  assert.equal(run({ count: 1, oldestMtimeMs: NOW - 30.5 * day }).length, 1); // 30.5 days is
  assert.deepEqual(run({ count: 0, oldestMtimeMs: null }), []);
  assert.deepEqual(new X6ManyWorktrees().run(snap({ codex: codexRes(null, 'missing') })), []);
});

test('registry: every export of checks/index.js is a Check with a unique id, and adding a check is one file plus one line', () => {
  const all = Object.values(registry);
  assert.equal(all.length, 13);
  const ids = all.map((C) => { const c = new C(); assert.ok(c instanceof Check); assert.ok(c.source); return c.id; });
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, ['C1', 'C2', 'C3', 'C4', 'C5', 'U1', 'U2', 'X1', 'X2', 'X3', 'X4', 'X5', 'X6']); // namespace order
});

test('every finding id any check can produce matches the contract pattern', () => {
  const s = snap({
    claude: claudeRes(fullClaude({
      setup: { drift: [{ path: 'a', kind: 'missing' }], driftCount: 1 }, liveOnlyKeys: ['k'], plugins: { status: 'warn' },
      routing: { agents: [{ agentType: 'a b/c', expected: 'x', verdict: 'mismatch', models: [] }] },
    })),
    codex: codexRes({
      config: { projects: [{ path: '/g', exists: false }], hookList: [{ key: '/h/hooks.json:pre:0:0', exists: false }], mcpList: [{ name: 'a b/c', enabled: true, transport: null }] },
      backups: [{ name: 'a' }, { name: 'b' }, { name: 'c' }], logs: [{ name: 'l', size: 600 * MB }], worktrees: { count: 25, oldestMtimeMs: NOW },
    }),
    ctx: { repo: '/r', homes: { codex: '/h' } },
  });
  const found = Object.values(registry).flatMap((C) => new C().run(s));
  assert.ok(found.length >= 10);
  for (const f of found) assert.match(f.id, FINDING_ID_RE);
});

test('recommended: only fixable findings of C1, X1 and X4 are recommended for the default batch', async () => {
  const { Finding } = await import('../core/finding.js');
  const fix = { restorable: true, state: 'proposed' };
  assert.equal(new Finding({ id: 'X1:a', checkId: 'X1', source: 'codex', severity: 'warn', title: 't', detail: 'd', fix, recommended: true }).toDto().recommended, true);
  assert.equal(new Finding({ id: 'X1:a', checkId: 'X1', source: 'codex', severity: 'warn', title: 't', detail: 'd', recommended: true }).toDto().recommended, false); // no fix, nothing to batch
  assert.equal(new Finding({ id: 'C4:a', checkId: 'C4', source: 'claude', severity: 'info', title: 't', detail: 'd', fix }).toDto().recommended, false);
  const { readFileSync } = await import('node:fs');
  const src = (f) => readFileSync(new URL(`../core/checks/${f}`, import.meta.url), 'utf8');
  for (const f of ['c1-config-drift.js', 'x1-missing-trusted-project.js', 'x4-missing-hook-state.js']) assert.match(src(f), /recommended: true/);
  assert.doesNotMatch(src('c4-live-only-keys.js'), /recommended: true/);
});
