// Model-free tests for scripts/monitor.mjs. Run: node --test scripts/monitor.test.mjs (or bash scripts/qa-monitor.sh).
import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { collect, collectSetupFlow, parseOrchestrate, localDates, parseRtkTopCommands, parseTranscriptLine, readExpectedModels, scanTranscripts, buildTokens, buildRouting, buildOrchestration } from './monitor.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const NOW = '2026-10-19T12:00:00.000Z';
let tmp, home, data, ENV;

const walk = (d) => fs.readdirSync(d, { recursive: true, withFileTypes: false }).map((r) => path.join(d, String(r)));

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-test-'));
  home = path.join(tmp, 'home');
  fs.cpSync(path.join(here, 'fixtures', 'monitor', 'home'), home, { recursive: true });
  const recent = new Date(Date.parse(NOW) - 3600e3);
  for (const f of walk(home)) if (fs.statSync(f).isFile()) fs.utimesSync(f, recent, recent);
  // A file with in-window records but a 60-day-old mtime must be skipped.
  const stale = path.join(home, 'projects', 'C--Users-fake-AppData-proj-a', 'stale.jsonl');
  fs.writeFileSync(stale, '{"type":"assistant","timestamp":"2026-10-19T08:00:00.000Z","entrypoint":"cli","message":{"id":"stale1","model":"claude-opus-5-5","usage":{"input_tokens":777}}}\n');
  const old = new Date(Date.parse(NOW) - 60 * 86400e3);
  fs.utimesSync(stale, old, old);
  // installed_plugins.json is built from the real pins so a pin bump does not break the test; claude-mem gets a wrong version.
  const mk = JSON.parse(fs.readFileSync(path.join(repo, 'claude', 'settings.json'), 'utf8')).extraKnownMarketplaces;
  const plugins = {};
  for (const [m, v] of Object.entries(mk)) {
    for (const p of v.source.plugins) {
      const bad = p.name === 'claude-mem';
      plugins[`${p.name}@${m}`] = [{ version: bad ? '0.0.1' : p.source.ref.replace(/^v/, ''), gitCommitSha: p.source.sha }];
    }
  }
  fs.mkdirSync(path.join(home, 'plugins'));
  fs.writeFileSync(path.join(home, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins }));
  fs.mkdirSync(path.join(tmp, 'mem'));
  // Isolated from this machine: no real rtk, dead claude-mem port.
  ENV = { CLAUDE_MEM_WORKER_PORT: '9', CLAUDE_MEM_DATA_DIR: path.join(tmp, 'mem'), MONITOR_RTK_BIN: path.join(tmp, 'no-such-rtk') };
  data = await collect({ home, now: NOW, env: ENV });
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('parseTranscriptLine skips malformed, non-assistant and synthetic lines and keeps only whitelisted fields', () => {
  assert.equal(parseTranscriptLine('{not json "assistant"'), null);
  assert.equal(parseTranscriptLine('{"type":"user"}'), null);
  assert.equal(parseTranscriptLine('{"type":"assistant","timestamp":"2026-10-19T09:00:00Z","message":{"id":"x","model":"<synthetic>"}}'), null);
  const r = parseTranscriptLine('{"type":"assistant","timestamp":"2026-10-19T09:00:00Z","message":{"id":"x","model":"claude-opus-5-5","content":"CANARY_MSG_TEXT_42","usage":{"input_tokens":3}}}');
  assert.deepEqual(Object.keys(r).sort(), ['cacheCreation', 'cacheRead', 'cwdBase', 'entrypoint', 'id', 'input', 'model', 'output', 'ts']);
  assert.equal(r.input, 3);
  assert.ok(!JSON.stringify(r).includes('CANARY'));
});

test('readExpectedModels reads the real agent frontmatter', () => {
  const e = readExpectedModels(repo);
  assert.equal(e.worker, 'haiku');
  assert.equal(e.reviewer, 'opus');
  assert.equal(e.general, undefined);
});

test('every section has a status', () => {
  for (const k of ['routing', 'tokens', 'rtk', 'plugins', 'claudeMem', 'hooks', 'setup']) {
    assert.ok(['ok', 'warn', 'missing'].includes(data[k].status), k);
  }
  assert.equal(data.generatedAt, NOW);
});

test('routing: worker on sonnet without meta model is a mismatch, meta model override is counted separately', () => {
  const by = Object.fromEntries(data.routing.agents.map((a) => [a.agentType, a]));
  assert.equal(by.worker.verdict, 'mismatch');
  assert.equal(by.worker.runs, 3);
  assert.equal(by.worker.overrides, 1);
  assert.deepEqual(by.worker.models, [{ model: 'claude-sonnet-5-5', messages: 3 }, { model: 'claude-haiku-5-5', messages: 1 }]);
  assert.equal(by.reviewer.verdict, 'ok');
  assert.equal(by['general-purpose'].verdict, 'n/a');
  assert.equal(by['general-purpose'].expected, null);
  assert.equal(by.explorer.verdict, 'no data');
  assert.equal(by.backend.verdict, 'ok');
  assert.equal(data.routing.windowDays, 7);
  assert.equal(data.routing.status, 'warn');
});

test('routing: main thread distribution is deduplicated and ignores synthetic and out-of-window records', () => {
  const m = Object.fromEntries(data.routing.mainThread.map((r) => [`${r.entrypoint}|${r.model}`, r.messages]));
  assert.deepEqual(m, { 'claude-desktop|claude-opus-5-5': 2, 'cli|claude-opus-5-5': 2 });
});

test('tokens: sums are exact (duplicate ids counted once, growing output keeps the final 50), window and stale files respected', () => {
  const pick = (date, model) => data.tokens.days.find((d) => d.date === date && d.model === model);
  const strip = ({ date, model, ...n }) => n; // eslint-disable-line no-unused-vars
  assert.deepEqual(strip(pick('2026-10-19', 'claude-opus-5-5')), { input: 123, output: 110, cacheRead: 1050, cacheCreation: 250, hitRate: round3(1050 / (123 + 1050 + 250)) });
  assert.deepEqual(strip(pick('2026-10-19', 'claude-sonnet-5-5')), { input: 40, output: 22, cacheRead: 100, cacheCreation: 0, hitRate: round3(100 / 140) });
  assert.deepEqual(strip(pick('2026-10-18', 'claude-opus-5-5')), { input: 40, output: 20, cacheRead: 60, cacheCreation: 0, hitRate: 0.6 });
  assert.deepEqual(strip(pick('2026-10-19', 'claude-haiku-5-5')), { input: 8, output: 10, cacheRead: 0, cacheCreation: 0, hitRate: 0 });
  assert.equal(data.tokens.days.length, 4);
  assert.deepEqual(data.tokens.totals, { input: 211, output: 162, cacheRead: 1210, cacheCreation: 250, hitRate: round3(1210 / 1671) });
});
const round3 = (n) => Math.round(n * 1000) / 1000;

test('parseRtkTopCommands handles commands with spaces and ignores other lines', () => {
  const text = [
    'By Command',
    '  #  Command                   Count   Saved  Total%    Time  Impact    ',
    ' 1.  rtk grep                   2056    4.7M   92.2%    2.1s  ██████████',
    ' 4.  rtk:toml jq -e . D:/P...      2   28.8K   97.8%    51ms  ░░░░░░░░░░',
    '10.  rtk ls scripts               14   10.5K   85.5%   102ms  ░░░░░░░░░░',
    'Total commands:    7622',
  ].join('\n');
  assert.deepEqual(parseRtkTopCommands(text), [
    { command: 'rtk grep', count: 2056, saved: '4.7M', pct: '92.2%' },
    { command: 'rtk:toml jq -e . D:/P...', count: 2, saved: '28.8K', pct: '97.8%' },
    { command: 'rtk ls scripts', count: 14, saved: '10.5K', pct: '85.5%' },
  ]);
});

test('rtk: missing binary gives status missing', () => {
  assert.equal(data.rtk.status, 'missing');
  assert.deepEqual(data.rtk.topCommands, []);
});

test('plugins: pinned version and sha compared, wrong version warns', () => {
  const by = Object.fromEntries(data.plugins.items.map((i) => [i.name, i]));
  assert.equal(by['ponytail@ponytail'].status, 'ok');
  assert.equal(by['claude-mem@thedotmack'].status, 'warn');
  assert.equal(by['claude-mem@thedotmack'].installedVersion, '0.0.1');
  assert.equal(data.plugins.status, 'warn');
});

test('hooks: script files and registrations in live settings', () => {
  assert.equal(data.hooks.status, 'ok');
  assert.deepEqual(data.hooks.items.map((i) => i.name), ['compact-context.sh', 'config-audit.sh', 'rtk hook claude']);
  fs.rmSync(path.join(home, 'hooks', 'config-audit.sh'));
  return collect({ home, now: NOW, env: ENV }).then((d) => {
    assert.equal(d.hooks.items[1].status, 'warn');
    assert.equal(d.hooks.status, 'warn');
  });
});

test('claudeMem: dead port is unreachable (warn), env port wins', () => {
  assert.equal(data.claudeMem.reachable, false);
  assert.equal(data.claudeMem.status, 'warn');
  assert.equal(data.claudeMem.portSource, 'env');
  assert.equal(data.claudeMem.url, 'http://127.0.0.1:9/api/health');
});

test('claudeMem: port from settings file, other keys (tokens) never surface', async () => {
  fs.writeFileSync(path.join(tmp, 'mem', 'settings.json'), JSON.stringify({ CLAUDE_MEM_WORKER_PORT: '9', CLAUDE_MEM_TOKEN: 'SECRET_TOKEN_42' }));
  const d = await collect({ home, now: NOW, env: { ...ENV, CLAUDE_MEM_WORKER_PORT: undefined } });
  assert.equal(d.claudeMem.portSource, 'settings');
  assert.equal(d.claudeMem.url, 'http://127.0.0.1:9/api/health');
  assert.ok(!JSON.stringify(d).includes('SECRET_TOKEN_42'));
});

test('a missing home never crashes and reports missing sections', async () => {
  const d = await collect({ home: path.join(tmp, 'nope'), now: NOW, env: ENV });
  for (const k of ['routing', 'tokens', 'plugins', 'hooks']) assert.equal(d[k].status, 'missing', k);
});

test('collected data holds no message text or subagent description', () => {
  const s = JSON.stringify(data);
  assert.ok(!s.includes('CANARY_MSG_TEXT_42') && !s.includes('CANARY_DESC_42'));
});

test('rendered HTML leaks neither canary', async (t) => {
  let render;
  try { ({ render } = await import('./monitor-html.mjs')); }
  catch (e) { if (e.code === 'ERR_MODULE_NOT_FOUND') return t.skip('scripts/monitor-html.mjs not present yet'); throw e; }
  const html = render(data);
  assert.equal(typeof html, 'string');
  assert.ok(!html.includes('CANARY_MSG_TEXT_42') && !html.includes('CANARY_DESC_42'));
});

test('localDates: one entry per local calendar day across a DST change', () => {
  const dst = (tz) => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
    "import { localDates } from './scripts/monitor.mjs'; console.log(JSON.stringify(localDates(Date.parse('2026-03-09T04:30:00Z'), 4)));"],
  { cwd: repo, env: { ...process.env, TZ: tz }, encoding: 'utf8' }));
  // 2026-03-09 00:30 in New York is the day after spring-forward (23-hour day 03-08); a fixed 24h step would skip 03-08.
  assert.deepEqual(dst('America/New_York'), ['2026-03-09', '2026-03-08', '2026-03-07', '2026-03-06']);
  assert.equal(new Set(localDates(Date.parse(NOW))).size, 7);
});

test('delegation: output split by role and family, shares sum to 1', () => {
  const d = data.savings.delegation;
  const out = Object.fromEntries(d.map((r) => [`${r.role}|${r.family}`, r.output7d]));
  assert.deepEqual(out, { 'main|opus': 127, 'subagent|sonnet': 22, 'subagent|opus': 3, 'subagent|haiku': 1, 'claude-mem|haiku': 6, 'sdk|haiku': 3 });
  assert.ok(Math.abs(d.reduce((s, r) => s + r.share, 0) - 1) < 0.01);
  assert.equal(d.reduce((s, r) => s + r.output7d, 0), data.tokens.totals.output);
});

test('savings: cache, ponytail and unavailable sources', () => {
  const s = data.savings;
  assert.deepEqual(s.cache, { cacheRead7d: 1210, savedInputTokens7d: 1089, hitRate7d: data.tokens.totals.hitRate });
  assert.equal(s.ponytail.enabled, true);
  assert.equal(s.ponytail.linesPct, 47);
  assert.equal(s.rtk, null);
  assert.equal(s.claudeMem, null);
  assert.equal(s.status, 'warn');
  assert.equal(data.refreshSec, null);
});

test('orchestration: subagents attach to their own session, live flag follows the injected now', () => {
  const o = data.orchestration;
  assert.deepEqual(o.sessions.map((s) => [s.sessionId, s.live]), [['sess2', true], ['sess1', false]]);
  const [s2, s1] = o.sessions;
  assert.deepEqual(s2.agents.map((a) => [a.agentType, a.model, a.verdict, a.live, a.messages, a.output]), [['backend', 'claude-sonnet-5-5', 'ok', true, 1, 4]]);
  assert.deepEqual(s2.main, { models: [{ model: 'claude-opus-5-5', messages: 1 }], output: 7 });
  assert.deepEqual(s1.agents.map((a) => a.agentType), ['worker', 'worker', 'reviewer', 'general-purpose']);
  assert.deepEqual(s1.agents.map((a) => [a.verdict, a.override]), [['mismatch', false], ['override', true], ['ok', false], ['n/a', false]]);
  assert.equal(s1.main.output, 120);
  assert.equal(s1.agents[0].output, 15);
  assert.equal(s1.agents[0].start, '2026-10-19T10:00:00.000Z');
});

test('per-file cache: a second pass over unchanged files re-reads nothing and gives identical results', async () => {
  const cache = new Map();
  const now = Date.parse(NOW);
  const first = await scanTranscripts(home, now, cache);
  const second = await scanTranscripts(home, now, cache);
  assert.ok(first.parsed >= 7);
  assert.equal(second.parsed, 0);
  const view = (s) => [buildTokens(s), buildRouting(s, readExpectedModels(repo)), buildOrchestration(s, readExpectedModels(repo))];
  assert.deepEqual(view(second), view(first));
  assert.deepEqual((await collect({ home, now: NOW, env: ENV, cache, refreshSec: 5 })).tokens, data.tokens);
  // appending to a file invalidates only that file
  const f = path.join(home, 'projects', 'proj-b', 'sess2.jsonl');
  fs.appendFileSync(f, '{"type":"assistant","timestamp":"2026-10-19T11:59:40.000Z","entrypoint":"cli","message":{"id":"m6","model":"claude-opus-5-5","usage":{"output_tokens":9}}}' + String.fromCharCode(10));
  const third = await scanTranscripts(home, now, cache);
  assert.equal(third.parsed, 1);
  assert.equal(buildTokens(third).totals.output, 162 + 9);
});

test('roles: claude-mem observer and sdk-ts records are not main thread; orchestration keeps only main sessions', () => {
  assert.deepEqual(data.routing.background, [{ role: 'claude-mem', model: 'claude-haiku-5-5', messages: 1 }, { role: 'sdk', model: 'claude-haiku-5-5', messages: 1 }]);
  assert.ok(data.routing.mainThread.every((r) => r.model === 'claude-opus-5-5' && r.entrypoint !== 'sdk-ts'));
  const d = data.savings.delegation;
  assert.ok(!d.some((r) => r.role === 'main' && r.family === 'haiku'));
  assert.equal(d.find((r) => r.role === 'claude-mem').output7d, 6);
  assert.deepEqual(data.orchestration.sessions.map((s) => s.sessionId), ['sess2', 'sess1']); // sdk session sess3 and the observer are out
});

test('orchestration projectName: basename of the last main record cwd, capped, full path never kept, null without cwd', () => {
  const by = Object.fromEntries(data.orchestration.sessions.map((s) => [s.sessionId, s.projectName]));
  assert.deepEqual(by, { sess2: null, sess1: 'ai-setup' }); // sess1: g1x (latest) has cwd ...\ai-setup, earlier lines ...\old-name
  assert.ok(!JSON.stringify(data.orchestration).includes('\\')); // no backslash path survives, only basenames
  assert.equal(parseTranscriptLine('{"type":"assistant","timestamp":"2026-10-19T09:00:00Z","cwd":"/a/' + 'x'.repeat(80) + '","message":{"id":"x","model":"m"}}').cwdBase.length, 60);
  assert.equal(parseTranscriptLine('{"type":"assistant","timestamp":"2026-10-19T09:00:00Z","message":{"id":"x","model":"m"}}').cwdBase, null);
});

test('privacy: no encoded project dir, no drive-encoded prefix, no home path in the data or the page', async (t) => {
  const check = (s) => {
    for (const bad of ['C--Users-fake-AppData-proj-a', 'x-claude-mem-observer-sessions', 'proj-b', 'proj-c']) assert.ok(!s.includes(bad), bad);
    assert.ok(!/[A-Za-z]--/.test(s), 'drive-encoded prefix');
    assert.ok(!s.includes(home) && !s.includes(home.split(path.sep).join('/')), 'home path');
  };
  assert.ok(!('home' in data));
  assert.ok(data.orchestration.sessions.every((s) => !('project' in s)));
  check(JSON.stringify(data));
  let render;
  try { ({ render } = await import('./monitor-html.mjs')); }
  catch (e) { if (e.code === 'ERR_MODULE_NOT_FOUND') return t.skip('monitor-html.mjs not present'); throw e; }
  check(render(data));
});

test('rtk end to end with a fake rtk: summary, 7-day saved sum and top commands', async () => {
  const d = await collect({ home, now: NOW, env: { ...ENV, MONITOR_RTK_BIN: path.join(here, 'fixtures', 'monitor', 'fake-rtk.mjs') } });
  assert.equal(d.rtk.status, 'ok');
  assert.deepEqual(d.rtk.summary, { commands: 10, inputTokens: 2000, outputTokens: 500, savedTokens: 9000, savedPct: 45.5 });
  assert.deepEqual(d.rtk.topCommands, [
    { command: 'rtk grep', count: 8, saved: '4.7M', pct: '92.2%' },
    { command: 'rtk git status', count: 2, saved: '1.0K', pct: '10.0%' },
  ]);
  assert.deepEqual(d.savings.rtk, { saved7d: 1500, savedAll: 9000, savedPct: 45.5 });
});

// A throwaway copy of the repo's agents, skills and apply.sh, so a test can rename a rule or change a model.
function setupRepo() {
  const r = fs.mkdtempSync(path.join(tmp, 'repo-'));
  for (const sub of ['claude/agents', 'claude/skills', 'scripts/apply.sh']) fs.cpSync(path.join(repo, sub), path.join(r, sub), { recursive: true });
  return r;
}
const orchFile = (r) => path.join(r, 'claude', 'skills', 'orchestrate', 'SKILL.md');
const edit = (f, fn) => fs.writeFileSync(f, fn(fs.readFileSync(f, 'utf8')));

test('setup: parses the real orchestrate rules and agent frontmatter', () => {
  const s = data.setup;
  assert.equal(s.rules.delegate.length, 4);
  assert.deepEqual(s.rules.delegate[1].agents, ['explorer']);
  assert.deepEqual(s.rules.routing.find((x) => x.agent === 'publisher').part, 'Markup, SCSS/CSS, templates, UI-interaction TS (tabs, accordion, modal, slider)');
  assert.deepEqual(s.rules.lanes.filter((l) => l.model === 'opus').length, 2); // main thread and verifiers stay separate
  assert.deepEqual(s.rules.lanes.find((l) => l.model === 'haiku').agents, ['explorer', 'publisher', 'worker']);
  assert.equal(s.rules.failure.length, 3);
  assert.deepEqual(s.agents.find((a) => a.name === 'frontend').skills, ['ui-baseline', 'frontend-design', 'publishing']);
  assert.ok(s.skills.includes('orchestrate'));
  // The test home has no agents/ or skills/: every repo file is drift, with relative paths only.
  assert.ok(s.drift.some((x) => x.path === 'agents/worker.md' && x.kind === 'missing'));
  assert.ok(s.drift.every((x) => !path.isAbsolute(x.path) && !x.path.includes('..')));
});

test('setup: a renamed section is null on its own and renders 규칙을 읽지 못함; other sections still render', async () => {
  const { render } = await import('./monitor-html.mjs');
  const r = setupRepo();
  edit(orchFile(r), (t) => t.replace('Model lanes:', 'Model choice:').replace('When a delegated part fails:', 'On failure:'));
  const s = collectSetupFlow(home, r);
  assert.equal(s.rules.lanes, null);
  assert.equal(s.rules.failure, null);
  assert.equal(s.rules.delegate.length, 4);
  assert.equal(s.status, 'warn');
  const html = render({ ...data, setup: s });
  assert.ok(html.includes('규칙을 읽지 못함 · <code>orchestrate/SKILL.md</code> “Model lanes”'));
  assert.ok(html.includes('“When a delegated part fails”'));
  assert.ok(html.includes('독립 작업 병렬 실행'));
  // A missing SKILL.md leaves all four sections null without throwing.
  fs.rmSync(orchFile(r));
  assert.deepEqual(collectSetupFlow(home, r).rules, { delegate: null, routing: null, lanes: null, failure: null });
});

test('setup: a changed agent model and a new rule show in the diagram without code changes', async () => {
  const { render } = await import('./monitor-html.mjs');
  const r = setupRepo();
  edit(path.join(r, 'claude', 'agents', 'worker.md'), (t) => t.replace(/^model: haiku$/m, 'model: sonnet'));
  edit(orchFile(r), (t) => t.replace('   - The user asks for subagents or a parallel run.', '   - The user asks for subagents or a parallel run.\n   - A long migration nobody should watch: `worker`.'));
  const s = collectSetupFlow(home, r);
  assert.equal(s.agents.find((a) => a.name === 'worker').model, 'sonnet');
  assert.equal(s.rules.delegate.length, 5);
  const html = render({ ...data, setup: s });
  const card = html.match(/<div class="ag f-(\w+)[^"]*"[^>]*><div class="a1"><b>worker<\/b>.*?<\/div><\/div>/);
  assert.equal(card[1], 'sonnet');
  assert.ok(card[0].includes('규칙: Haiku')); // the lane in SKILL.md still says Haiku
  assert.ok(html.includes('A long migration nobody should watch: `worker`.')); // unknown bullet shown as its own text
});

test('setup: usage badge shows 7-day runs and flags the actual model when it differs', async () => {
  const { render } = await import('./monitor-html.mjs');
  const html = render(data);
  const card = (n) => html.match(new RegExp(`<div class="ag [^"]*"[^>]*><div class="a1"><b>${n}</b>.*?</div></div>`))[0];
  assert.match(card('worker'), /^<div class="ag f-haiku off"/);
  assert.ok(card('worker').includes('7일 3회') && card('worker').includes('실제 Sonnet'));
  assert.ok(card('reviewer').includes('실제 일치'));
  assert.ok(!card('reviewer').includes('u warn'));
  assert.ok(html.includes('data-tab="flow"') && html.includes('id="v-flow"'));
});

test('setup: drift is clean when home matches the repo, home-only extras are ignored, a changed file is flagged', () => {
  const h = fs.mkdtempSync(path.join(tmp, 'live-'));
  fs.cpSync(path.join(repo, 'claude', 'agents'), path.join(h, 'agents'), { recursive: true });
  fs.cpSync(path.join(repo, 'claude', 'skills'), path.join(h, 'skills'), { recursive: true });
  fs.mkdirSync(path.join(h, 'skills', 'synced'));
  fs.writeFileSync(path.join(h, 'skills', 'synced', 'x.md'), 'x');
  assert.deepEqual(collectSetupFlow(h, repo).drift, []);
  edit(path.join(h, 'agents', 'qa.md'), (t) => t.replace('model: opus', 'model: sonnet'));
  assert.deepEqual(collectSetupFlow(h, repo).drift, [{ path: 'agents/qa.md', kind: 'differs' }]);
});

test('parseOrchestrate: lenient on CRLF and stray text, empty input gives all null', () => {
  const t = '1. Delegate when:\r\n   - A: `explorer`.\r\n2. Keep inline.\r\n   - not this\r\n';
  assert.deepEqual(parseOrchestrate(t).delegate, [{ text: 'A: `explorer`.', agents: ['explorer'] }]);
  assert.deepEqual(parseOrchestrate(''), { delegate: null, routing: null, lanes: null, failure: null });
});

test('setup render: malformed setup data is escaped, empty sections say 규칙을 읽지 못함, overrides are not flagged', async () => {
  const { render } = await import('./monitor-html.mjs');
  const bad = '"><img src=x onerror=alert(1)>';
  const html = render({ setup: { status: 'ok', agents: [{ name: bad, model: bad, skills: [bad], description: bad }], rules: { lanes: [{ text: 'Opus, the main thread', model: bad, agents: [] }], delegate: [], failure: [] }, skills: [bad], drift: [{ path: bad, kind: bad }] } });
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('“Delegate when”') && html.includes('“When a delegated part fails”'));
  const override = render({ ...data, routing: { ...data.routing, agents: [{ agentType: 'worker', expected: 'haiku', runs: 1, verdict: 'override', models: [{ model: 'claude-sonnet-5-5', messages: 2 }] }] } });
  const card = override.match(/<div class="ag [^"]*"[^>]*><div class="a1"><b>worker<\/b>.*?<\/div><\/div>/)[0];
  assert.ok(card.includes('수동 지정 Sonnet') && !card.includes('u warn'));
});

test('setup render: a new bullet whose words overlap an old label keeps its own text', async () => {
  const { render } = await import('./monitor-html.mjs');
  const r = setupRepo();
  edit(orchFile(r), (t) => t.replace('   - The user asks for subagents or a parallel run.', '   - The user asks for subagents or a parallel run.\n   - Work that would block the main thread: `worker`.'));
  const html = render({ ...data, setup: collectSetupFlow(home, r) });
  assert.ok(html.includes('<b>Work that would block the main thread: `worker`.</b>'));
});

test('collect outside the repo: plugins and sessions still show when claude/ is not next to the script', async () => {
  const bare = fs.mkdtempSync(path.join(tmp, 'bare-'));
  const d = await collect({ home, now: NOW, env: ENV, repo: bare });
  assert.equal(d.orchestration.status, data.orchestration.status);
  assert.equal(d.orchestration.sessions.length, data.orchestration.sessions.length);
  assert.ok(d.orchestration.sessions.flatMap((s) => s.agents).every((a) => a.verdict === 'n/a' || a.verdict === 'no data'));
  assert.notEqual(d.routing.status, 'missing');
  assert.equal(d.plugins.status, 'warn');
  assert.deepEqual(d.plugins.items.map((i) => i.name).sort(), ['claude-mem@thedotmack', 'ponytail@ponytail']);
  assert.ok(d.plugins.items.every((i) => i.enabled && i.installedVersion && i.pinnedRef === null && i.status === 'ok'));
  assert.match(d.plugins.note, /not compared/);
});
