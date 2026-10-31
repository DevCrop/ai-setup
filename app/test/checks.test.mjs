import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
import { C6LowCacheHit } from '../core/checks/c6-low-cache-hit.js';
import { C7MainModel } from '../core/checks/c7-main-model.js';
import { C8AgentUse } from '../core/checks/c8-agent-use.js';
import { C9TokenSpike } from '../core/checks/c9-token-spike.js';
import { C10BigContext } from '../core/checks/c10-big-context.js';
import { C11TokenEconomizer } from '../core/checks/c11-token-economizer.js';
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
  assert.equal(all.length, 19);
  const ids = all.map((C) => { const c = new C(); assert.ok(c instanceof Check); assert.ok(c.source); return c.id; });
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, ['C10', 'C11', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'U1', 'U2', 'X1', 'X2', 'X3', 'X4', 'X5', 'X6']); // namespace order
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

test('C6: a role/model with a big output share and a low hit rate is reported as info; small or cached ones are not', () => {
  const byRole = [
    { role: 'claude-mem', family: 'haiku', output: 300000, hitRate: 0.03 },
    { role: 'main', family: 'opus', output: 600000, hitRate: 0.95 },
    { role: 'sdk', family: 'haiku', output: 40000, hitRate: 0 }, // under the token floor
    { role: 'subagent', family: 'sonnet', output: 60000, hitRate: 0.1 }, // 6% share
  ];
  const fs = new C6LowCacheHit().run(snap({ claude: claudeRes(fullClaude({ tokens: { byRole } })) }));
  assert.deepEqual(fs.map((f) => [f.id, f.severity]), [['C6:claude-mem-haiku', 'info']]);
  assert.match(fs[0].title, /3%/);
  assert.deepEqual(new C6LowCacheHit().run(snap({ claude: claudeRes(fullClaude()) })), []);
});

test('C7: main messages off the settings model at 20% or more give one info finding; none without mainModel', () => {
  const mainThread = [{ entrypoint: 'cli', model: 'claude-opus-5-5', messages: 70 }, { entrypoint: 'cli', model: 'claude-sonnet-5-5', messages: 30 }];
  const run = (d) => new C7MainModel().run(snap({ claude: claudeRes(fullClaude(d)) }));
  const [f] = run({ mainModel: 'opus', routing: { mainThread } });
  assert.equal(f.id, 'C7:main-model');
  assert.equal(f.severity, 'info');
  assert.deepEqual(f.evidence, ['opus: 70건', 'sonnet: 30건']);
  assert.deepEqual(run({ mainModel: 'opus', routing: { mainThread: [mainThread[0], { ...mainThread[1], messages: 10 }] } }), []);
  assert.deepEqual(run({ mainModel: null, routing: { mainThread } }), []);
});

test('C8: unused repo agents in one finding, untyped agents on Opus or Fable in another; cheap or idle ones none', () => {
  const agents = [
    { agentType: 'explorer', expected: 'haiku', models: [], runs: 0, verdict: 'no data' },
    { agentType: 'reviewer', expected: 'opus', models: [], runs: 2, verdict: 'ok' },
    { agentType: 'general-purpose', expected: null, models: [{ model: 'claude-opus-5-5', messages: 9 }, { model: 'claude-haiku-5-5', messages: 2 }], runs: 4, verdict: 'n/a' },
    { agentType: 'Explore', expected: null, models: [{ model: 'claude-haiku-5-5', messages: 3 }], runs: 1, verdict: 'n/a' },
  ];
  const fs = new C8AgentUse().run(snap({ claude: claudeRes(fullClaude({ routing: { agents } })) }));
  assert.deepEqual(fs.map((f) => f.id), ['C8:unused', 'C8:untyped']);
  assert.deepEqual(fs[0].evidence, ['explorer']);
  assert.deepEqual(fs[1].evidence, ['general-purpose: 실행 4회, Opus·Fable 9건']);
  assert.ok(fs.every((f) => f.severity === 'info'));
});

test('C9: today over 3x the median of earlier days gives info; a quiet history or a small today gives none', () => {
  const today = new Date(NOW);
  const d = (back) => { const x = new Date(today); x.setDate(x.getDate() - back); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const days = (now) => [{ date: d(0), output: now }, ...[1, 2, 3, 4].map((b) => ({ date: d(b), output: 100000 }))];
  const run = (rows) => new C9TokenSpike().run(snap({ claude: claudeRes(fullClaude({ tokens: { days: rows } })) }));
  const [f] = run(days(400000));
  assert.equal(f.id, 'C9:today');
  assert.match(f.title, /4배/);
  assert.deepEqual(run(days(250000)), []);
  assert.deepEqual(run(days(400000).slice(0, 3)), []); // fewer than 3 earlier days
  assert.deepEqual(run([{ date: d(0), output: 90000 }, ...[1, 2, 3].map((b) => ({ date: d(b), output: 1000 }))]), []); // under the floor
});

test('C10: a live session over 200k context tokens gives one warn per project; idle or small ones none', () => {
  const projects = [
    { projectName: 'ai-setup', live: true, context: 250000, output: 1200 },
    { projectName: 'blog post', live: true, context: 90000, output: 10 },
    { projectName: 'old', live: false, context: 0, output: 10 }, // context is only kept for recently active sessions
    { projectName: null, live: true, context: 300000, output: 0 },
    { projectName: '작업', live: false, context: 210000, output: 0 },
    { projectName: '회의', live: true, context: 210000, output: 0 },
  ];
  const fs = new C10BigContext().run(snap({ claude: claudeRes(fullClaude({ activity: { status: 'ok', projects } })) }));
  const h = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12);
  assert.deepEqual(fs.map((f) => [f.id, f.severity]), [[`C10:${h('ai-setup')}`, 'warn'], ['C10:unknown', 'warn'], [`C10:${h('작업')}`, 'warn'], [`C10:${h('회의')}`, 'warn']]);
  assert.match(fs[0].title, /250k/);
  assert.match(fs[0].detail, /\/compact/);
  for (const f of fs) assert.match(f.id, FINDING_ID_RE);
  assert.deepEqual(new C10BigContext().run(snap({ claude: claudeRes(fullClaude()) })), []);
});

test('C11: slow hook, a waiting prune proposal and a costly overhead each give one info; a missing state gives none', () => {
  const te = (o) => new C11TokenEconomizer().run(snap({ claude: claudeRes(fullClaude({ tokenEconomizer: { status: 'ok', config: {}, fastHook: true, repos: [], ...o } })) }));
  const repos = [{ label: 'devcrop/ai-setup', sessions: 3, effectiveTokens: 1000, overheadTokens: 100, nudges: 0, proposed: 2 }, { label: 'o/b', sessions: 1, effectiveTokens: 1000, overheadTokens: 10, nudges: 0, proposed: 0 }];
  const fs = te({ fastHook: false, repos });
  assert.deepEqual(fs.map((f) => f.id.replace(/[0-9a-f]{12}$/, 'H')), ['C11:slow-hook', 'C11:prune-H', 'C11:overhead-H']);
  assert.ok(fs.every((f) => f.severity === 'info'));
  const long = te({ repos: [{ ...repos[0], label: 'x'.repeat(80) }] }); // 80-char label still gives valid ids
  assert.equal(long.length, 2);
  for (const f of long) assert.match(f.id, FINDING_ID_RE);
  assert.match(fs[2].title, /10%/);
  assert.deepEqual(te({}), []);
  assert.deepEqual(te({ fastHook: null }), []);
  assert.deepEqual(new C11TokenEconomizer().run(snap({ claude: claudeRes(fullClaude({ tokenEconomizer: { status: 'missing' } })) })), []);
});
