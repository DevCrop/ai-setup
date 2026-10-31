import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { Check } from '../core/check.js';
import { Finding } from '../core/finding.js';
import { FixJournal } from '../core/fix-journal.js';
import { FRAME_CSP, MonitorService } from '../core/monitor-service.js';
import { Optimizer } from '../core/optimizer.js';
import { CodexSource } from '../core/sources/codex-source.js';
import { NOW, fakeClock, fakeCodex, flush, fullClaude, tmpDir } from './helpers.mjs';

// claude.flag decides the finding severity, so a test can steer warn and bad.
class FlagCheck extends Check {
  id = 'C9';
  source = 'claude';
  run(s) {
    const sev = this.data(s)?.flag;
    return sev ? [new Finding({ id: 'C9:flag', checkId: 'C9', source: 'claude', severity: sev, title: 't', detail: 'd' })] : [];
  }
}
class CodexFlagCheck extends Check {
  id = 'X9';
  source = 'codex';
  run(s) {
    return this.data(s)?.flag ? [new Finding({ id: 'X9:flag', checkId: 'X9', source: 'codex', severity: 'warn', title: 't', detail: 'd' })] : [];
  }
}

const codexData = (over = {}) => ({ config: { model: 'm', reasoningEffort: 'high', approval: 'a', sandbox: 's', projects: [{ path: '/a', exists: true }, { path: '/b', exists: false }], plugins: { total: 2, enabled: 1 }, mcpServers: { total: 1, enabled: 1 } }, backups: [{ name: 'x' }, { name: 'y' }], logs: [], sessions: { total: 5, last7d: 4, byDate: {} }, ...over });

function make({ claude = () => fullClaude(), codex = () => codexData(), service = {} } = {}) {
  const clock = fakeClock();
  const calls = { claude: 0, codex: 0, ctx: [] };
  const sources = [
    { id: 'claude', label: 'Claude', async collect(ctx) { calls.claude++; calls.ctx.push(ctx); const d = await claude(calls.claude, ctx); return { status: 'ok', note: '', data: d }; } },
    { id: 'codex', label: 'Codex', async collect() { calls.codex++; const d = await codex(calls.codex); return d === null ? { status: 'missing', note: '', data: null } : { status: 'ok', note: '', data: d }; } },
  ];
  const outDir = path.join(tmpDir(), 'out');
  const optimizer = new Optimizer({ checks: [new FlagCheck(), new CodexFlagCheck()] });
  const svc = new MonitorService({ outDir, homes: { claude: tmpDir(), codex: tmpDir() }, repo: tmpDir(), env: {}, refreshSec: 10, sources, optimizer, clock, ...service });
  return { svc, clock, calls, outDir, optimizer, sources };
}

test('starting before the first snapshot, then ok with the status shape of the api contract', async () => {
  const { svc, clock } = make();
  const s0 = svc.status();
  assert.equal(s0.state, 'starting');
  assert.deepEqual([s0.generatedAt, s0.counts, s0.codex, s0.busyFindingId], [null, { warn: 0, bad: 0 }, null, null]);
  svc.start();
  await flush();
  const s = svc.status();
  assert.equal(s.state, 'ok');
  assert.deepEqual(Object.keys(s).sort(), ['busyFindingId', 'cacheHit7d', 'claudeMem', 'codex', 'counts', 'findingsRev', 'generatedAt', 'health', 'live', 'refreshSec', 'routing', 'state', 'todayOutput', 'todayProjects', 'todaySavedInput'].sort());
  assert.equal(s.generatedAt, new Date(NOW).toISOString());
  assert.deepEqual([s.routing, s.live, s.todayOutput, s.cacheHit7d, s.claudeMem], [{ ok: 1, total: 2 }, { sessions: 1, agents: 2 }, 5, 0.5, true]);
  assert.deepEqual(s.codex, { state: 'ok', model: 'm', reasoningEffort: 'high', approval: 'a', sandbox: 's', plugins: 1, mcpServers: 1, trustedProjects: 2, missingProjects: 1, sessions7d: 4, backups: 2, todayOutput: 0, limitPercent: null });
  svc.stop();
  assert.equal(clock.timerCount(), 0);
});

test('warn and bad come from finding severities; counts and codex state follow', async () => {
  let flag = 'warn';
  const { svc } = make({ claude: () => fullClaude({ flag }) });
  await svc.refreshNow();
  assert.deepEqual([svc.status().state, svc.status().counts], ['warn', { warn: 1, bad: 0 }]);
  flag = 'bad';
  await svc.refreshNow();
  assert.deepEqual([svc.status().state, svc.status().counts], ['bad', { warn: 0, bad: 1 }]);
  flag = undefined;
  await svc.refreshNow();
  assert.equal(svc.status().state, 'ok');
  const c = make({ codex: () => codexData({ flag: true }) });
  await c.svc.refreshNow();
  assert.equal(c.svc.status().codex.state, 'warn');
});

test('nodata when every Claude section and Codex are missing; codex missing alone is not nodata', async () => {
  const gone = Object.fromEntries(['routing', 'tokens', 'rtk', 'plugins', 'claudeMem', 'hooks', 'savings', 'orchestration', 'setup'].map((k) => [k, { status: 'missing' }]));
  const a = make({ claude: () => fullClaude(gone), codex: () => null });
  await a.svc.refreshNow();
  assert.equal(a.svc.status().state, 'nodata');
  assert.equal(a.svc.status().codex.state, 'missing');
  const b = make({ codex: () => null });
  await b.svc.refreshNow();
  assert.equal(b.svc.status().state, 'ok');
});

test('stale after more than 3 periods without a new snapshot, even while a run hangs; every tick re-emits', async () => {
  let hang = false;
  const { svc, clock } = make({ claude: () => (hang ? new Promise(() => {}) : fullClaude()), service: { runTimeoutMs: 1e12 } });
  const seen = [];
  svc.onChange((s) => seen.push(s.state));
  svc.start();
  await flush();
  hang = true;
  await clock.advance(30000);
  assert.equal(svc.status().state, 'ok'); // exactly 3 periods is not yet stale
  const before = seen.length;
  await clock.advance(10000);
  assert.equal(svc.status().state, 'stale');
  assert.ok(seen.length > before, 'status is re-emitted on each tick');
  assert.equal(seen.at(-1), 'stale');
});

test('setRefreshSec: a shorter period runs at once and never reads an older snapshot as stale; a longer one waits', async () => {
  const calls = [];
  const { svc, clock } = make({ claude: () => { calls.push(clock.now()); return fullClaude(); }, service: { refreshSec: 30 } });
  svc.start();
  await flush();
  await clock.advance(80000); // last snapshot 20 s old under a 30 s period
  const n = calls.length;
  assert.equal(svc.setRefreshSec(5), 5);
  assert.equal(svc.status().state, 'ok'); // 20 s > 3 x 5 s, but it was taken under 30 s
  await flush();
  assert.equal(calls.length, n + 1); // ran at once
  await clock.advance(5000);
  assert.equal(calls.length, n + 2);
  assert.equal(svc.setRefreshSec(60), 60);
  await flush();
  assert.equal(calls.length, n + 2); // no extra run when slowing down
  assert.equal(svc.setRefreshSec(1), 3);
});

test('a throwing source does not stop the next tick; the snapshot of the next tick lands', async () => {
  const { svc, clock, calls } = make({ claude: (n) => { if (n === 1) throw new Error('boom'); return fullClaude(); } });
  svc.start();
  await flush();
  assert.equal(svc.status().state, 'starting'); // the first run threw before a snapshot
  await clock.advance(10000);
  assert.equal(calls.claude, 2);
  assert.equal(svc.status().state, 'ok');
});

test('error after 3 failed runs in a row, ok again after one good run', async () => {
  let fail = true;
  const { svc, clock } = make({ claude: () => { if (fail) throw new Error('x'); return fullClaude(); } });
  svc.start();
  await flush();
  await clock.advance(10000);
  assert.equal(svc.status().state, 'starting');
  await clock.advance(10000);
  assert.equal(svc.status().state, 'error'); // run 1 at 0 s, 2 at 10 s, 3 at 20 s
  fail = false;
  await clock.advance(10000);
  assert.equal(svc.status().state, 'ok');
});

test('a hung run is dropped after the run limit and the next tick starts a new one', async () => {
  const { svc, clock, calls } = make({ claude: (n) => (n === 1 ? new Promise(() => {}) : fullClaude()) });
  svc.start();
  await flush();
  await clock.advance(20000);
  assert.equal(calls.claude, 1); // still waiting on the hung run
  await clock.advance(20000);
  assert.ok(calls.claude >= 2);
  assert.equal(svc.status().state, 'ok');
});

test('refresh works even when the timeout timer is stuck: the age of the run decides, not the timer', async () => {
  const { svc, clock, calls } = make({ claude: (n) => (n === 1 ? new Promise(() => {}) : fullClaude()) });
  clock.setTimeout = () => 0; // a timer that never fires
  const r1 = svc.refresh();
  assert.deepEqual(r1, { started: true });
  await flush();
  assert.deepEqual(svc.refresh(), { started: false }); // coalesced while the run is young
  await clock.advance(31000);
  assert.deepEqual(svc.refresh(), { started: true }); // older than the limit: dropped, new run
  await flush();
  assert.equal(calls.claude, 2);
  assert.equal(svc.status().state, 'ok');
});

test('refresh() returns plain data only (safe to send over IPC) and refreshNow() resolves after the run', async () => {
  const { svc } = make();
  const r = svc.refresh();
  assert.deepEqual(Object.keys(r), ['started']);
  assert.doesNotThrow(() => structuredClone(r));
  await flush();
  assert.equal(await svc.refreshNow(), true);
});

test('a listener that throws does not stop the loop or other listeners', async () => {
  const { svc } = make();
  let ok = 0;
  svc.onChange(() => { throw new Error('bad listener'); });
  svc.onChange(() => ok++);
  await svc.refreshNow();
  assert.ok(ok > 0);
  assert.equal(svc.status().state, 'ok');
});

test('stop() ends the ticks; onChange returns an unsubscribe', async () => {
  const { svc, clock, calls } = make();
  let n = 0;
  const off = svc.onChange(() => n++);
  svc.start();
  await flush();
  svc.stop();
  const c = calls.claude;
  await clock.advance(60000);
  assert.equal(calls.claude, c);
  off();
  const k = n;
  await svc.refreshNow();
  assert.equal(n, k);
});

test('writes claude-monitor.html (embed render, frame CSP after <head>) and status.json atomically into the folder it was given', async () => {
  const rendered = [];
  const { svc, outDir } = make({ service: { renderFn: (d, o) => { rendered.push([d, o]); return '<!DOCTYPE html><html><head><title>t</title></head><body><header class="x"></header></body></html>'; } } });
  assert.equal(svc.htmlPath(), null);
  assert.equal(svc.getViewFileUrl(), null);
  await svc.refreshNow();
  assert.deepEqual(rendered[0][1], { embed: true });
  assert.equal(rendered[0][0].refreshSec, 10);
  assert.ok(!('summary' in rendered[0][0]) && !('liveOnlyKeys' in rendered[0][0]));
  const html = fs.readFileSync(path.join(outDir, 'claude-monitor.html'), 'utf8');
  assert.ok(html.startsWith(`<!DOCTYPE html><html><head>\n<meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}">`));
  assert.equal(html.split('Content-Security-Policy').length, 2);
  const status = JSON.parse(fs.readFileSync(path.join(outDir, 'status.json'), 'utf8'));
  assert.deepEqual(status.routing, { ok: 1, total: 2 });
  assert.deepEqual(fs.readdirSync(outDir).sort(), ['claude-monitor.html', 'status.json']);
  assert.equal(svc.htmlPath(), path.join(outDir, 'claude-monitor.html'));
  assert.match(svc.getViewFileUrl(), /^file:\/\/.*claude-monitor\.html$/);
});

test('with the real render(): the written page is a full document with exactly one frame CSP in <head>', async () => {
  const { svc, outDir } = make({ claude: () => { const { summary, liveOnlyKeys, ...raw } = fullClaude(); return { ...raw, summary, liveOnlyKeys }; } });
  await svc.refreshNow();
  const html = fs.readFileSync(path.join(outDir, 'claude-monitor.html'), 'utf8');
  const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
  assert.ok(head.includes(FRAME_CSP));
  assert.equal(html.split('Content-Security-Policy').length, 2);
});

test('a render without <head> counts as a failed run (no html is claimed)', async () => {
  const { svc } = make({ service: { renderFn: () => '<body>no head</body>' } });
  await svc.refreshNow();
  assert.equal(svc.status().state, 'starting');
  assert.equal(svc.htmlPath(), null);
});

test('the sources get the clock, the folders and the refresh period through ctx', async () => {
  const { svc, calls, clock } = make();
  await svc.refreshNow();
  const ctx = calls.ctx[0];
  assert.equal(ctx.now, clock.now());
  assert.equal(ctx.refreshSec, 10);
  assert.ok(ctx.homes.claude && ctx.homes.codex && ctx.repo);
});

test('the run limit and refresh period are clamped: 3 s minimum', () => {
  assert.equal(make({ service: { refreshSec: 1 } }).svc.refreshSec, 3);
  assert.equal(make({ service: { refreshSec: 'x' } }).svc.refreshSec, 10);
});

test('codexDetail: NO_SNAPSHOT before the first run; then the CodexDetail shape of the api contract from the last snapshot', async () => {
  const codex = fakeCodex();
  const svc = new MonitorService({ outDir: path.join(tmpDir(), 'out'), homes: { claude: tmpDir(), codex: codex.home }, repo: tmpDir(), env: {}, clock: fakeClock(),
    sources: [{ id: 'claude', async collect() { return { status: 'ok', note: '', data: fullClaude() }; } }, new CodexSource()] });
  assert.throws(() => svc.codexDetail(), { code: 'NO_SNAPSHOT' });
  await svc.refreshNow();
  const d = svc.codexDetail();
  assert.deepEqual(Object.keys(d), ['generatedAt', 'state', 'note', 'settings', 'plugins', 'mcpServers', 'projects', 'hooks', 'agents', 'agentsMd', 'skills', 'sessions', 'logs', 'backups', 'worktrees', 'usage', 'findings']);
  assert.equal(d.generatedAt, new Date(NOW).toISOString());
  assert.deepEqual([d.state, d.note], ['warn', '']);
  assert.equal(d.settings.length, 10);
  assert.deepEqual(d.settings.find((s) => s.key === 'max_concurrent_threads_per_session'), { key: 'max_concurrent_threads_per_session', value: 4 });
  assert.deepEqual(d.plugins, [{ name: 'a', marketplace: 'b', enabled: true }, { name: 'c', marketplace: 'd', enabled: false }]);
  assert.deepEqual(d.mcpServers.map((s) => [s.name, s.enabled, s.transport, s.hasEnv]), [['x', true, 'command', true], ['y', true, 'url', false], ['z', true, null, false], ['w', false, 'command', false]]);
  assert.deepEqual(d.projects, [{ path: codex.live, trustLevel: 'trusted', exists: true }, { path: codex.gone, trustLevel: 'trusted', exists: false }]);
  assert.deepEqual(d.hooks, { total: 2, enabled: 1, missing: 1 });
  assert.deepEqual(d.agents, [{ name: 'explorer.toml', bytes: 'CANARY_AGENT_FILE_9f3a'.length }]);
  assert.equal(d.agentsMd, 9);
  assert.deepEqual(d.skills, ['alpha', 'beta']);
  assert.deepEqual(d.sessions, { total: 3, last7d: 2, byDate: { '2026-10-24': 1, '2026-10-25': 1 }, archived: 1 });
  assert.deepEqual(d.logs, [{ name: 'logs_1.sqlite', bytes: 4 }]);
  assert.deepEqual(d.backups.map((b) => [b.name, b.bytes]), [['config.toml.bak', 1], ['config.toml.bak1', 1], ['config.toml.bak2', 1]]);
  assert.ok(d.backups.every((b) => !Number.isNaN(Date.parse(b.mtime))));
  assert.equal(d.worktrees, 2);
  const ids = d.findings;
  assert.ok(ids.some((i) => i.startsWith('X1:')) && ids.some((i) => i.startsWith('X4:')) && ids.includes('X5:z') && ids.includes('X6:worktrees') && ids.includes('X2:backups'));
  assert.ok(ids.every((i) => svc.optimizer.list().some((f) => f.id === i && f.source === 'codex')));
});

test('codexDetail: a missing ~/.codex gives state missing with a Korean note and empty lists; an unreadable config.toml keeps the folder lists', async () => {
  const none = make({ codex: () => null });
  await none.svc.refreshNow();
  const d = none.svc.codexDetail();
  assert.deepEqual([d.state, d.settings, d.plugins, d.mcpServers, d.agents, d.skills, d.worktrees, d.findings, d.agentsMd], ['missing', [], [], [], [], [], 0, [], null]);
  assert.match(d.note, /~\/\.codex/);
  const noCfg = make({ codex: () => codexData({ config: null }) });
  await noCfg.svc.refreshNow();
  assert.match(noCfg.svc.codexDetail().note, /config\.toml/);
  const bare = make({ codex: () => codexData() }); // data without the detail fields (older shape)
  await bare.svc.refreshNow();
  assert.deepEqual(bare.svc.codexDetail().hooks, { total: 0, enabled: 0, missing: 0 });
});

// summaryText ---------------------------------------------------------------------------------

test('summaryText: Korean plain text with state, counts, routing, tokens, cache hit, Codex line, findings and (without history) nothing else', async () => {
  const { svc } = make({ claude: () => fullClaude({ flag: 'warn' }) });
  assert.equal(svc.summaryText(), ['Claude Monitor 요약', '상태: 시작 중', '', '발견 사항: 없음'].join('\n'));
  await svc.refreshNow();
  const ld = new Date(NOW); const p2 = (n) => String(n).padStart(2, '0');
  const stamp = `${ld.getFullYear()}-${p2(ld.getMonth() + 1)}-${p2(ld.getDate())} ${p2(ld.getHours())}:${p2(ld.getMinutes())}`; // local time
  assert.equal(svc.summaryText(), [
    `Claude Monitor 요약 (${stamp})`, '상태: 확인 필요 (주의 1)', '라우팅: 1/2 정상', '오늘 출력 토큰: 5', '캐시 적중(7일): 50%',
    'Codex: 모델 m, 플러그인 1, MCP 1, 신뢰 프로젝트 2 (없는 폴더 1)', '', '발견 사항:', '- [주의] t (Claude)',
  ].join('\n'));
});

test('summaryText: finding lines use the severity word and the source; ok findings are left out; the last 5 history entries follow newest first', async () => {
  const journal = new FixJournal({ file: path.join(tmpDir(), 'j.json'), now: () => NOW });
  for (let i = 0; i < 7; i++) journal.record({ findingId: `X1:n${i}`, checkId: 'X1', source: 'codex', action: i % 2 ? 'restored' : 'applied' });
  const { svc } = make({ claude: () => fullClaude({ flag: 'bad' }), codex: () => codexData({ flag: true }), service: { journal } });
  await svc.refreshNow();
  const lines = svc.summaryText().split('\n');
  assert.equal(lines[1], '상태: 문제 (문제 1, 주의 1)');
  assert.deepEqual(lines.filter((l) => l.startsWith('- [')), ['- [문제] t (Claude)', '- [주의] t (Codex)']);
  const hist = lines.slice(lines.indexOf('최근 변경 기록:') + 1);
  assert.equal(hist.length, 5);
  assert.match(hist[0], /적용 X1:n6$/);
  assert.match(hist[1], /되돌림 X1:n5$/);
  assert.match(hist[4], /X1:n2$/);
});

test('summaryText: a title with line breaks stays on one line', async () => {
  class Odd extends Check {
    id = 'C9'; source = 'claude';
    run() { return [new Finding({ id: 'C9:odd', checkId: 'C9', source: 'claude', severity: 'info', title: 'two\nlines\r\n here', detail: 'd' })]; }
  }
  const { svc } = make({ service: { optimizer: new Optimizer({ checks: [new Odd()] }) } });
  await svc.refreshNow();
  assert.ok(svc.summaryText().includes('- [참고] two lines here (Claude)'));
});

test('summaryText: findings with the same severity, source and title collapse into one line with a count', async () => {
  class Many extends Check {
    id = 'X9'; source = 'codex';
    run() { return ['a', 'b', 'c'].map((k) => new Finding({ id: `X9:${k}`, checkId: 'X9', source: 'codex', severity: 'warn', title: 'same', detail: 'd' })); }
  }
  const { svc } = make({ service: { optimizer: new Optimizer({ checks: [new Many()] }) } });
  await svc.refreshNow();
  const text = svc.summaryText();
  assert.deepEqual(text.split('\n').filter((l) => l.startsWith('- [')), ['- [주의] same (Codex, 3건)']);
});
