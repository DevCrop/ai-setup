import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { summarize, writeAtomic } from '../../scripts/monitor.mjs';
import { render } from '../../scripts/monitor-html.mjs';
import { CoreError } from './errors.js';
import { FixJournal } from './fix-journal.js';
import { Optimizer } from './optimizer.js';
import { Snapshot } from './snapshot.js';
import * as sourceModules from './sources/index.js';

// Frame CSP of arch section 6: render() output has inline script and style.
export const FRAME_CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'";
export const HTML_NAME = 'claude-monitor.html';
const CLAUDE_SECTIONS = ['routing', 'tokens', 'rtk', 'plugins', 'claudeMem', 'hooks', 'savings', 'orchestration', 'setup'];
const ERROR_AFTER = 3;
const STATE_KO = { starting: '시작 중', ok: '정상', warn: '확인 필요', bad: '문제', stale: '모니터 멈춤', nodata: '데이터 없음', error: '오류' };
const SEVERITY_KO = { bad: '문제', warn: '주의', info: '참고', ok: '정상' };
const SOURCE_KO = { claude: 'Claude', codex: 'Codex', updates: '업데이트' };
const NO_SCORE = new Set(['starting', 'stale', 'nodata', 'error']);
const ACTION_KO = { applied: '적용', restored: '되돌림', applyFailed: '적용 실패', restoreFailed: '되돌리기 실패' };

const realClock = {
  now: () => Date.now(),
  setInterval: (f, ms) => setInterval(f, ms),
  clearInterval: (t) => clearInterval(t),
  setTimeout: (f, ms) => setTimeout(f, ms),
  clearTimeout: (t) => clearTimeout(t),
};

const codexState = (res, findings) => (res.status === 'missing' ? 'missing' : findings.some((f) => f.severity === 'bad') ? 'bad' : findings.some((f) => f.severity === 'warn') ? 'warn' : 'ok');

// Local wall-clock time, as the user reads it on the strip.
const localStamp = (iso) => { const d = new Date(iso); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };

export class MonitorService {
  #snapshot = null;
  #claude = null;
  #failures = 0;
  #runId = 0;
  #inflight = null; // { id, startedAt, done }
  #timer = null;
  #subs = new Set();
  #htmlReady = false;
  #cache = new Map();

  // Everything with a side effect is passed in: sources, optimizer, clock, folders, env.
  constructor({ outDir, homes, repo, env = process.env, refreshSec = 10, sources, sourceDeps = {}, policy = null, optimizer, runner, clock = realClock, renderFn = render, runTimeoutMs, journal, updater = null } = {}) {
    if (!outDir) throw new TypeError('outDir is required');
    this.outDir = outDir;
    this.repo = repo ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    this.homes = homes ?? { claude: env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), codex: env.CODEX_HOME || path.join(os.homedir(), '.codex') };
    this.env = env;
    this.refreshSec = Math.min(86400, Math.max(3, Number(refreshSec) || 10)); // 3 s minimum like parseArgs in monitor.mjs
    this.sources = sources ?? Object.values(sourceModules).map((S) => new S(sourceDeps));
    // Optional NotificationPolicy: when given, only its stable findings count toward state, counts and health.
    this.policy = policy;
    this.optimizer = optimizer ?? new Optimizer({ deps: { runner } });
    this.clock = clock;
    // Fix history survives a restart: outDir/fix-journal.json. An optimizer that was injected keeps its own journal unless one is given.
    const j = journal ?? (optimizer ? null : new FixJournal({ file: path.join(outDir, 'fix-journal.json'), now: () => this.clock.now() }));
    if (j) this.optimizer.useJournal?.(j);
    this.optimizer.resume?.({ codexHome: this.homes.codex });
    this.renderFn = renderFn;
    this.runTimeoutMs = runTimeoutMs ?? Math.max(30000, 3 * this.refreshSec * 1000);
    this.optimizer.subscribe(() => this.#emit());
    // Optional AutoUpdater: considered after every run; a fix and an update never run at the same time.
    this.updater = updater;
    if (updater) {
      const prev = this.optimizer.externalBusy ?? (() => false);
      this.optimizer.externalBusy = () => updater.running || prev();
      updater.isBusy = () => !!this.optimizer.busyFindingId();
    }
  }

  // After a pass that changed something: check for updates again at once and show the result.
  #afterUpdate(result) {
    if (!result) return;
    if (result.done.length) for (const s of this.sources) s.invalidate?.();
    this.#refresh();
  }

  start() {
    if (this.#timer) return;
    this.#timer = this.clock.setInterval(() => this.#tick(), this.refreshSec * 1000);
    this.#tick();
  }

  stop() {
    if (this.#timer) this.clock.clearInterval(this.#timer);
    this.#timer = null;
    this.#inflight = null; // a late result of the dropped run is ignored
  }

  onChange(cb) { this.#subs.add(cb); return () => this.#subs.delete(cb); }

  #emit() {
    let s;
    try { s = this.status(); } catch { return; }
    for (const cb of this.#subs) { try { cb(s); } catch { /* a broken listener must not stop the loop */ } }
  }

  #tick() {
    try {
      this.#emit(); // also while a run hangs, so "모니터 멈춤" can show
      this.#unstick();
      if (!this.#inflight) this.#startRun();
    } catch { /* the interval must survive anything */ }
  }

  // A run older than its limit is dropped even if its timeout timer never fired.
  #unstick() {
    if (this.#inflight && this.clock.now() - this.#inflight.startedAt > this.runTimeoutMs) {
      this.#inflight = null;
      this.#failures++;
    }
  }

  #refresh() {
    this.#unstick();
    if (this.#inflight) return { started: false, done: this.#inflight.done };
    return { started: true, done: this.#startRun() };
  }

  // Coalesced: started is false when a run is already in flight. Plain data, safe to send over IPC.
  refresh() { return { started: this.#refresh().started }; }

  // Resolves when the run has ended; true when this call started it.
  async refreshNow() { const r = this.#refresh(); await r.done; return r.started; }

  #startRun() {
    const id = ++this.#runId;
    const run = { id, startedAt: this.clock.now(), done: null };
    this.#inflight = run;
    const live = () => this.#inflight?.id === id;
    let timer = null;
    const work = (async () => {
      const ctx = { now: run.startedAt, homes: this.homes, repo: this.repo, env: this.env, cache: this.#cache, refreshSec: this.refreshSec };
      const results = await Promise.all(this.sources.map((s) => s.collect(ctx)));
      if (!live()) return null;
      const snapshot = new Snapshot({
        generatedAt: new Date(run.startedAt).toISOString(),
        sources: Object.fromEntries(this.sources.map((s, i) => [s.id, results[i]])),
        ctx: { repo: this.repo, homes: this.homes, autoUpdate: this.updater?.status() ?? null },
      });
      this.optimizer.run(snapshot);
      this.updater?.consider(snapshot)?.then((r) => this.#afterUpdate(r), () => {});
      // a source that could not be read this run keeps its findings' ages (no reset to 'just seen')
      this.policy?.observe(this.optimizer.findings(), this.sources.filter((s, i) => results[i]?.data == null && results[i]?.status === 'missing' && s.id !== 'updates').map((s) => s.id));
      this.#write(snapshot);
      return snapshot;
    })();
    const timeout = new Promise((_, reject) => { timer = this.clock.setTimeout(() => reject(new Error('run timeout')), this.runTimeoutMs); });
    run.done = Promise.race([work, timeout]).then((snapshot) => {
      if (!live() || !snapshot) return;
      this.#snapshot = snapshot;
      this.#claude = snapshot.sources.claude?.data ?? null;
      this.#failures = 0;
    }, () => { if (live()) this.#failures++; }).finally(() => {
      this.clock.clearTimeout(timer);
      if (live()) this.#inflight = null;
      this.#emit();
    });
    return run.done;
  }

  // status.json (same shape as the old bar read) and the monitor html, both replaced atomically.
  #write(snapshot) {
    const { summary, liveOnlyKeys, adoptableKeys, missingHookScripts, mainModel, ...raw } = snapshot.sources.claude?.data ?? { generatedAt: snapshot.generatedAt, refreshSec: this.refreshSec };
    fs.mkdirSync(this.outDir, { recursive: true });
    let html = this.renderFn({ ...raw, refreshSec: this.refreshSec }, { embed: true });
    if (!/<head(?=[\s>])[^>]*>/i.test(html)) throw new Error('render output has no <head>');
    html = html.replace(/<head(?=[\s>])[^>]*>/i, (m) => `${m}\n<meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}">`);
    writeAtomic(path.join(this.outDir, HTML_NAME), html);
    writeAtomic(path.join(this.outDir, 'status.json'), JSON.stringify(summary ?? summarize(raw)));
    this.#htmlReady = true;
  }

  htmlPath() { return this.#htmlReady ? path.join(this.outDir, HTML_NAME) : null; }
  getViewFileUrl() { return this.#htmlReady ? pathToFileURL(path.join(this.outDir, HTML_NAME)).href : null; }

  // Status of docs/api-claude-monitor.md section 2.
  status() {
    const now = this.clock.now();
    const snap = this.#snapshot;
    const findings = this.optimizer.findings();
    const stable = this.policy ? findings.filter((f) => this.policy.isStable(f)) : findings;
    const count = (sev) => stable.filter((f) => f.severity === sev).length;
    const claude = this.#claude;
    const sum = claude?.summary ?? null;
    const codexRes = snap?.sources.codex ?? null;
    const cfg = codexRes?.data?.config ?? null;
    const projects = cfg?.projects ?? [];
    const codexFindings = stable.filter((f) => f.source === 'codex');
    const codex = codexRes ? {
      state: codexState(codexRes, codexFindings),
      model: cfg?.model ?? null, reasoningEffort: cfg?.reasoningEffort ?? null, approval: cfg?.approval ?? null, sandbox: cfg?.sandbox ?? null,
      plugins: cfg?.plugins.enabled ?? 0, mcpServers: cfg?.mcpServers.enabled ?? 0,
      trustedProjects: projects.length, missingProjects: projects.filter((p) => p.exists === false).length,
      sessions7d: codexRes.data?.sessions?.last7d ?? 0, backups: codexRes.data?.backups?.length ?? 0,
    } : null;
    const allMissing = (!claude || CLAUDE_SECTIONS.every((k) => claude[k]?.status === 'missing')) && (!codexRes || codexRes.status === 'missing');
    let state;
    // error is checked first: with no snapshot ever, 3 failures must not read as "starting" forever
    if (this.#failures >= ERROR_AFTER) state = 'error';
    else if (!snap) state = 'starting';
    else if (now - Date.parse(snap.generatedAt) > 3 * this.refreshSec * 1000) state = 'stale';
    else if (allMissing) state = 'nodata';
    else if (count('bad')) state = 'bad';
    else if (count('warn')) state = 'warn';
    else state = 'ok';
    return {
      generatedAt: snap?.generatedAt ?? null,
      refreshSec: this.refreshSec,
      state,
      counts: { warn: count('warn'), bad: count('bad') },
      health: NO_SCORE.has(state) ? null : Math.max(0, Math.min(100, 100 - 15 * count('bad') - 5 * count('warn'))),
      findingsRev: this.optimizer.rev,
      routing: sum?.routing ?? { ok: 0, total: 0 },
      live: sum?.live ?? { sessions: 0, agents: 0 },
      todayOutput: sum?.todayOutput ?? 0,
      todayProjects: sum?.todayProjects ?? 0,
      todaySavedInput: sum?.todaySavedInput ?? 0,
      cacheHit7d: sum?.cacheHit7d ?? null,
      claudeMem: sum?.claudeMem ?? null,
      codex,
      busyFindingId: this.optimizer.busyFindingId(),
    };
  }

  getStatus() { return this.status(); }

  // Last 50 fix journal entries, newest first, for the UI: { at, findingId, checkId, source, action, backupName,
  // restorableAfterRestart, restorable }. No diff, hash or table name.
  history() { return this.optimizer.history?.(50) ?? []; }

  // Short Korean plain-text report of the last snapshot for the clipboard. Counts, names and fixed titles only.
  summaryText() {
    const s = this.status();
    const one = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const counts = [s.counts.bad && `문제 ${s.counts.bad}`, s.counts.warn && `주의 ${s.counts.warn}`].filter(Boolean).join(', ');
    const lines = [`Claude Monitor 요약${s.generatedAt ? ` (${localStamp(s.generatedAt)})` : ''}`, `상태: ${STATE_KO[s.state] ?? s.state}${counts ? ` (${counts})` : ''}`];
    if (this.#snapshot) {
      lines.push(`라우팅: ${s.routing.ok}/${s.routing.total} 정상`, `오늘 출력 토큰: ${Number(s.todayOutput).toLocaleString('en-US')}`, `캐시 적중(7일): ${s.cacheHit7d === null ? '알 수 없음' : `${Math.round(s.cacheHit7d * 100)}%`}`);
      const c = s.codex;
      lines.push(c ? `Codex: 모델 ${one(c.model) || '알 수 없음'}, 플러그인 ${c.plugins}, MCP ${c.mcpServers}, 신뢰 프로젝트 ${c.trustedProjects} (없는 폴더 ${c.missingProjects})` : 'Codex: 데이터 없음');
    }
    const findings = this.optimizer.findings().filter((f) => f.severity !== 'ok');
    lines.push('', findings.length ? '발견 사항:' : '발견 사항: 없음');
    // Same check and title -> one line with a count, so five missing folders read as one item.
    const groups = new Map();
    for (const f of findings) {
      const key = `${f.severity}|${f.source}|${one(f.title)}`;
      groups.set(key, { f, n: (groups.get(key)?.n ?? 0) + 1 });
    }
    for (const { f, n } of groups.values()) lines.push(`- [${SEVERITY_KO[f.severity]}] ${one(f.title)} (${SOURCE_KO[f.source] ?? f.source}${n > 1 ? `, ${n}건` : ''})`);
    const hist = this.history().slice(0, 5);
    if (hist.length) {
      lines.push('', '최근 변경 기록:');
      for (const h of hist) lines.push(`- ${localStamp(h.at)} ${ACTION_KO[h.action]} ${h.findingId}`);
    }
    return lines.join('\n');
  }

  // CodexDetail of docs/api-claude-monitor.md (codex:detail), built from the last snapshot: names, flags and counts only.
  codexDetail() {
    const snap = this.#snapshot;
    if (!snap) throw new CoreError('NO_SNAPSHOT');
    const res = snap.sources.codex ?? null;
    const d = res?.data ?? null;
    const cfg = d?.config ?? null;
    const codexFindings = this.optimizer.findings().filter((f) => f.source === 'codex');
    const hooks = cfg?.hookList ?? [];
    const sizes = (list) => (list ?? []).map((x) => ({ name: x.name, bytes: x.size })).sort((a, b) => a.name.localeCompare(b.name));
    return {
      generatedAt: snap.generatedAt,
      state: res ? codexState(res, codexFindings) : 'missing',
      note: !d ? '~/.codex 폴더를 읽을 수 없습니다.' : !cfg ? 'config.toml 을 읽지 못해 설정, 플러그인, MCP 목록이 비어 있습니다.' : '',
      settings: (cfg?.settings ?? []).map((s) => ({ key: s.key, value: s.value })),
      plugins: (cfg?.pluginList ?? []).map((p) => ({ name: p.name, marketplace: p.marketplace, enabled: p.enabled })),
      mcpServers: (cfg?.mcpList ?? []).map((s) => ({ name: s.name, enabled: s.enabled, transport: s.transport, hasEnv: s.hasEnv, startupTimeoutSec: s.startupTimeoutSec, toolTimeoutSec: s.toolTimeoutSec })),
      projects: (cfg?.projects ?? []).map((p) => ({ path: p.path, trustLevel: p.trustLevel, exists: p.exists !== false })),
      hooks: { total: hooks.length, enabled: hooks.filter((h) => h.enabled).length, missing: hooks.filter((h) => h.exists === false).length },
      agents: sizes(d?.agents),
      agentsMd: d?.agentsMd ?? null,
      skills: [...(d?.skills ?? [])],
      sessions: { total: d?.sessions?.total ?? 0, last7d: d?.sessions?.last7d ?? 0, byDate: { ...(d?.sessions?.byDate ?? {}) }, archived: d?.sessions?.archived ?? 0 },
      logs: sizes(d?.logs),
      backups: (d?.backups ?? []).map((b) => ({ name: b.name, bytes: b.size ?? 0, mtime: Number.isFinite(b.mtimeMs) ? new Date(b.mtimeMs).toISOString() : '' })).sort((a, b) => a.name.localeCompare(b.name)),
      worktrees: d?.worktrees?.count ?? 0,
      findings: codexFindings.map((f) => f.id),
    };
  }

  // RoutinesDetail of docs/api-claude-monitor.md (routines:detail): the routines source data as collected, report only.
  routinesDetail() {
    const snap = this.#snapshot;
    if (!snap) throw new CoreError('NO_SNAPSHOT');
    const res = snap.sources.routines ?? null;
    const d = res?.data ?? null;
    return {
      generatedAt: snap.generatedAt,
      status: d ? 'ok' : 'missing',
      note: d ? '' : res?.note || '루틴을 읽지 못했습니다.',
      collectedAt: d?.collectedAt ?? null,
      claude: d?.claude ?? [],
      codex: d?.codex ?? [],
      tasks: d?.tasks ?? [],
      startup: d?.startup ?? [],
      windowsNote: d?.windowsNote ?? '',
    };
  }
}
