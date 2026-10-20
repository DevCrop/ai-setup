#!/usr/bin/env node
// Local monitor for the global Claude Code setup: collect() gathers data, monitor-html.mjs renders it.
// Usage: node scripts/monitor.mjs [out.html] [--watch [sec]]   (prints the absolute path of the written file)
// Privacy: transcripts are parsed through a whitelist (model, usage numbers, timestamp, entrypoint, agentType, meta model).
// Message text and subagent descriptions are never kept. Node 20+, no dependencies.
import { createReadStream } from 'node:fs';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WINDOW_DAYS = 7; // routing, tokens, savings and orchestration all use the same window
const LIVE_MS = 120000;
const MAX_SESSIONS = 8;
const FAMILY_RE = /opus|sonnet|haiku|fable/;
const OUT_FIELDS = ['input', 'output', 'cacheRead', 'cacheCreation'];
const PONYTAIL = { source: 'Ponytail 5 benchmark, 39 tasks x 5 runs (2026-10-07)', linesPct: 47, outputTokensPct: 55, costPct: 74, timePct: 59 };

// Role of a record: subagent transcripts are "subagent"; main transcripts are split so claude-mem's observer and SDK runs do not pass as the user's main thread.
export const roleOf = (f, rec) => (f.isSub ? 'subagent' : f.project.includes('claude-mem-observer-sessions') ? 'claude-mem' : rec.entrypoint === 'sdk-ts' ? 'sdk' : 'main');

const slash = (p) => p.replace(/\\/g, '/');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const family = (m) => (typeof m === 'string' ? (m.toLowerCase().match(FAMILY_RE) || [''])[0] : '');
const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;
const hitRate = (t) => {
  const den = t.input + t.cacheRead + t.cacheCreation;
  return den === 0 ? 0 : round(t.cacheRead / den, 3);
};
const num = (v) => (Number.isFinite(v) && v >= 0 ? v : 0);
const pad = (n) => String(n).padStart(2, '0');
const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const iso = (ms) => new Date(ms).toISOString();

// Local calendar dates, newest first. Built with new Date(y, m, d - i) so a DST day of 23/25 hours does not skip or repeat a date.
export function localDates(nowMs, n = WINDOW_DAYS) {
  const t = new Date(nowMs);
  return Array.from({ length: n }, (_, i) => dateStr(new Date(t.getFullYear(), t.getMonth(), t.getDate() - i)));
}
const windowStart = (nowMs) => {
  const t = new Date(nowMs);
  return new Date(t.getFullYear(), t.getMonth(), t.getDate() - (WINDOW_DAYS - 1)).getTime();
};

// Whitelist parse of one transcript line. Returns null for anything that is not a usable assistant record.
export function parseTranscriptLine(line) {
  if (!line.includes('"assistant"')) return null;
  let r;
  try { r = JSON.parse(line); } catch { return null; }
  if (!r || r.type !== 'assistant' || !r.message || typeof r.message.id !== 'string') return null;
  const model = r.message.model;
  if (typeof model !== 'string' || model === '<synthetic>') return null;
  const ts = Date.parse(r.timestamp);
  if (Number.isNaN(ts)) return null;
  const u = r.message.usage || {};
  return {
    id: r.message.id,
    model: model.slice(0, 80),
    ts,
    entrypoint: typeof r.entrypoint === 'string' ? r.entrypoint.slice(0, 40) : 'unknown',
    cwdBase: typeof r.cwd === 'string' ? r.cwd.split(/[\\/]/).filter(Boolean).pop()?.slice(0, 60) ?? null : null, // basename only, never the full path
    input: num(u.input_tokens),
    output: num(u.output_tokens),
    cacheRead: num(u.cache_read_input_tokens),
    cacheCreation: num(u.cache_creation_input_tokens),
  };
}

// Expected model per agent type from the `model:` frontmatter of <repo>/claude/agents/*.md.
export function readExpectedModels(repo = REPO) {
  const dir = path.join(repo, 'claude', 'agents');
  const out = {};
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.md')) continue;
    const head = fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/);
    const end = head.indexOf('---', 1);
    const line = head.slice(1, end < 0 ? 0 : end).find((l) => /^model:/.test(l));
    out[f.slice(0, -3)] = line ? family(line) || line.slice(6).trim() || null : null;
  }
  return out;
}

// Parses the "By Command" rows of plain `rtk gain`; the command column is fixed-width and may contain spaces.
export function parseRtkTopCommands(text) {
  const rows = [];
  for (const l of String(text).split(/\r?\n/)) {
    const m = l.match(/^\s*\d+\.\s+(.+?)\s+(\d+)\s+([\d.]+[KMGB]?)\s+([\d.]+%)\s+\S+\s+\S+\s*$/);
    if (m) rows.push({ command: m[1].trim(), count: Number(m[2]), saved: m[3], pct: m[4] });
  }
  return rows;
}

// Recursive walk with a try/catch per directory: one unreadable dir skips only that dir.
function walkJsonl(dir, rel = '', out = []) {
  let entries;
  try { entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walkJsonl(dir, r, out);
    else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(r);
  }
  return out;
}

// Reads one transcript; keeps one record per message.id, the one with the largest output (later lines carry the final count).
async function parseFile(file, rel) {
  const best = new Map();
  const input = createReadStream(file, { encoding: 'utf8' });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  let failed = false;
  input.on('error', () => { failed = true; rl.close(); });
  for await (const line of rl) {
    const r = parseTranscriptLine(line);
    if (r && (!best.has(r.id) || r.output >= best.get(r.id).output)) best.set(r.id, r);
  }
  if (failed) return null;
  const parts = rel.split('/');
  const si = parts.lastIndexOf('subagents');
  const isSub = si > 1;
  let meta = {};
  if (isSub) { try { meta = readJson(file.replace(/\.jsonl$/, '.meta.json')); } catch { /* no meta */ } }
  return {
    isSub,
    project: parts[0],
    sessionId: isSub ? parts[si - 1] : parts[parts.length - 1].replace(/\.jsonl$/, ''),
    agentType: typeof meta.agentType === 'string' ? meta.agentType.slice(0, 60) : 'unknown',
    metaModel: typeof meta.model === 'string' ? meta.model.slice(0, 80) : null,
    records: [...best.values()],
    mainEntry: isSub ? null : [...best.values()][0]?.entrypoint ?? null,
  };
}

// Scans projects/ once. `cache` (Map, optional) keeps parsed files keyed by path+mtime+size so unchanged files are not re-read.
// Cross-file dedup by message.id keeps the largest output. Returns per-file aggregates for the window.
export async function scanTranscripts(home, nowMs, cache = new Map()) {
  const root = path.join(home, 'projects');
  if (!fs.existsSync(root)) throw Object.assign(new Error('no projects dir'), { code: 'ENOENT' });
  const from = windowStart(nowMs);
  const fresh = new Map();
  let parsed = 0;
  for (const rel of walkJsonl(root)) {
    const file = path.join(root, rel);
    try {
      const st = fs.statSync(file);
      if (st.mtimeMs < from) continue;
      const key = `${file}|${st.mtimeMs}|${st.size}`;
      let entry = cache.get(file);
      if (!entry || entry.key !== key) {
        const f = await parseFile(file, slash(rel));
        if (!f) continue;
        entry = { key, f };
        parsed++;
      }
      fresh.set(file, entry);
    } catch { /* unreadable or vanished file: skip it */ }
  }
  cache.clear();
  for (const [k, v] of fresh) cache.set(k, v);

  const winner = new Map(); // id -> { rec, file }
  for (const { f } of fresh.values()) {
    for (const rec of f.records) {
      const w = winner.get(rec.id);
      if (!w || rec.output > w.rec.output) winner.set(rec.id, { rec, file: f });
    }
  }
  const agg = new Map(); // file object -> window records
  for (const { rec, file } of winner.values()) {
    if (rec.ts < from || rec.ts > nowMs) continue;
    if (!agg.has(file)) agg.set(file, []);
    agg.get(file).push(rec);
  }
  const files = [...agg].map(([f, records]) => ({ ...f, records }));
  return { files, parsed, from, nowMs };
}

const bump = (map, k, n = 1) => map.set(k, (map.get(k) || 0) + n);
const topModels = (m) => [...m].map(([model, messages]) => ({ model, messages })).sort((a, b) => b.messages - a.messages);
const sumOut = (recs) => recs.reduce((s, r) => s + r.output, 0);
const span = (recs) => ({ start: Math.min(...recs.map((r) => r.ts)), end: Math.max(...recs.map((r) => r.ts)) });

function runInfo(f, exp) {
  const models = new Map();
  for (const r of f.records) bump(models, r.model);
  const overridden = !!exp && !!f.metaModel && family(f.metaModel) !== exp;
  const off = !!exp && [...models.keys()].some((m) => family(m) !== exp);
  return { models, overridden, off };
}

export function buildRouting(scan, expected) {
  const main = new Map();
  const bg = new Map();
  for (const f of scan.files) {
    for (const r of f.records) {
      const role = roleOf(f, r);
      if (role === 'main') bump(main, `${r.entrypoint}|${r.model}`);
      else if (role !== 'subagent') bump(bg, `${role}|${r.model}`);
    }
  }
  const background = [...bg].map(([k, messages]) => {
    const i = k.indexOf('|');
    return { role: k.slice(0, i), model: k.slice(i + 1), messages };
  }).sort((a, b) => b.messages - a.messages || a.role.localeCompare(b.role));
  const mainThread = [...main].map(([k, messages]) => {
    const i = k.indexOf('|');
    return { entrypoint: k.slice(0, i), model: k.slice(i + 1), messages };
  }).sort((a, b) => b.messages - a.messages);
  const subs = scan.files.filter((f) => f.isSub);
  const types = new Set([...Object.keys(expected), ...subs.map((r) => r.agentType)]);
  const agents = [...types].sort().map((agentType) => {
    const known = Object.hasOwn(expected, agentType);
    const exp = known ? expected[agentType] : null;
    const mine = subs.filter((r) => r.agentType === agentType);
    const models = new Map();
    let mismatch = 0;
    let overrides = 0;
    let overrideOff = 0;
    for (const f of mine) {
      const ri = runInfo(f, exp);
      for (const [m, n] of ri.models) bump(models, m, n);
      if (ri.overridden) overrides++;
      if (ri.off && ri.overridden) overrideOff++;
      else if (ri.off) mismatch++;
    }
    let verdict = 'ok';
    if (!exp) verdict = 'n/a';
    else if (!mine.length) verdict = 'no data';
    else if (mismatch) verdict = 'mismatch';
    else if (overrideOff) verdict = 'override';
    return { agentType, expected: exp, models: topModels(models), runs: mine.length, overrides, verdict };
  });
  return {
    status: agents.some((a) => a.verdict === 'mismatch') ? 'warn' : 'ok',
    note: `Last ${WINDOW_DAYS} days of transcripts. Subagent model compared by family (opus/sonnet/haiku/fable).`,
    windowDays: WINDOW_DAYS, mainThread, background, agents,
  };
}

export function tokenDays(scan) {
  const dates = new Set(localDates(scan.nowMs));
  const days = new Map();
  for (const f of scan.files) {
    for (const r of f.records) {
      const date = dateStr(new Date(r.ts));
      if (!dates.has(date)) continue;
      const k = `${date}|${r.model}`;
      const t = days.get(k) || { date, model: r.model, input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
      for (const k2 of OUT_FIELDS) t[k2] += r[k2];
      days.set(k, t);
    }
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date) || a.model.localeCompare(b.model));
}

export function buildTokens(scan) {
  const days = tokenDays(scan).map((t) => ({ ...t, hitRate: hitRate(t) }));
  const totals = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  for (const d of days) for (const k of OUT_FIELDS) totals[k] += d[k];
  return {
    status: 'ok',
    note: `Last ${WINDOW_DAYS} days, local dates, deduplicated by message id (largest output kept). Hit rate = cache read / (input + cache read + cache creation).`,
    days, totals: { ...totals, hitRate: hitRate(totals) },
  };
}

// Output tokens by main thread vs subagent and model family.
export function buildDelegation(scan) {
  const out = new Map();
  for (const fam of ['opus', 'sonnet', 'haiku']) out.set(`subagent|${fam}`, 0);
  for (const f of scan.files) for (const r of f.records) bump(out, `${roleOf(f, r)}|${family(r.model) || 'other'}`, r.output);
  const total = [...out.values()].reduce((s, n) => s + n, 0);
  return [...out].map(([k, output7d]) => {
    const [role, fam] = k.split('|');
    return { role, family: fam, output7d, share: total ? round(output7d / total, 3) : 0 };
  }).sort((a, b) => b.output7d - a.output7d || (a.role === 'main' ? -1 : 1));
}

export function buildOrchestration(scan, expected) {
  const sessions = new Map();
  const get = (f) => {
    const k = `${f.project}/${f.sessionId}`;
    if (!sessions.has(k)) sessions.set(k, { sessionId: f.sessionId.slice(0, 8), mains: [], subs: [] });
    return sessions.get(k);
  };
  for (const f of scan.files) get(f)[f.isSub ? 'subs' : 'mains'].push(f);
  const list = [];
  for (const s of sessions.values()) {
    if (!s.subs.length || s.mains.some((f) => roleOf(f, { entrypoint: f.mainEntry }) !== 'main')) continue;
    const mainRecs = s.mains.flatMap((f) => f.records);
    const mainModels = new Map();
    for (const r of mainRecs) bump(mainModels, r.model);
    const agents = s.subs.map((f) => {
      const exp = Object.hasOwn(expected, f.agentType) ? expected[f.agentType] : null;
      const ri = runInfo(f, exp);
      const sp = span(f.records);
      return {
        agentType: f.agentType, expected: exp, model: topModels(ri.models)[0].model,
        verdict: !exp ? 'n/a' : !ri.off ? 'ok' : ri.overridden ? 'override' : 'mismatch',
        override: ri.overridden, start: iso(sp.start), end: iso(sp.end), live: scan.nowMs - sp.end <= LIVE_MS,
        messages: f.records.length, output: sumOut(f.records),
      };
    }).sort((a, b) => a.start.localeCompare(b.start));
    const all = span([...mainRecs, ...s.subs.flatMap((f) => f.records)]);
    const lastCwd = mainRecs.filter((r) => r.cwdBase).sort((a, b) => b.ts - a.ts)[0]?.cwdBase;
    list.push({
      sessionId: s.sessionId, projectName: lastCwd || null, // never the encoded project dir: it holds the full cwd path
      start: iso(all.start), end: iso(all.end), live: scan.nowMs - all.end <= LIVE_MS,
      main: { models: topModels(mainModels), output: sumOut(mainRecs) }, agents,
    });
  }
  list.sort((a, b) => b.end.localeCompare(a.end));
  return {
    status: 'ok',
    note: `Sessions with subagents in the last ${WINDOW_DAYS} days, newest first (max ${MAX_SESSIONS}). Live = a record in the last 2 minutes.`,
    sessions: list.slice(0, MAX_SESSIONS),
  };
}

// shortcut: a .mjs MONITOR_RTK_BIN runs under this node so tests can use a fake rtk on any OS; drop if tests get a real stub binary.
const run = (bin, args) => new Promise((resolve, reject) => {
  if (bin.endsWith('.mjs')) { args = [bin, ...args]; bin = process.execPath; }
  execFile(bin, args, { timeout: 5000, windowsHide: true, maxBuffer: 8 << 20 }, (e, out) => (e ? reject(e) : resolve(out)));
});

// Two rtk calls: `gain -f json --daily` (summary + per-day saved) and plain `gain` (the only source of per-command rows).
export async function fetchRtk(bin) {
  const r = { missing: false, summary: null, daily: [], topCommands: [] };
  try {
    const j = JSON.parse(await run(bin, ['gain', '-f', 'json', '--daily']));
    const s = j.summary;
    r.summary = {
      commands: num(s.total_commands), inputTokens: num(s.total_input), outputTokens: num(s.total_output),
      savedTokens: num(s.total_saved), savedPct: num(s.avg_savings_pct),
    };
    r.daily = (Array.isArray(j.daily) ? j.daily : []).filter((d) => typeof d?.date === 'string').map((d) => ({ date: d.date, saved: num(d.saved_tokens) }));
  } catch (e) {
    if (e.code === 'ENOENT') return { ...r, missing: true };
  }
  try { r.topCommands = parseRtkTopCommands(await run(bin, ['gain'])); } catch { /* summary may still be usable */ }
  return r;
}

export function rtkSection(r) {
  if (r.missing) return { status: 'missing', note: 'rtk not found on PATH.', summary: null, topCommands: [] };
  const note = !r.summary ? 'rtk gain -f json failed.' : !r.topCommands.length ? 'No per-command rows parsed from rtk gain.' : '';
  return { status: r.summary && r.topCommands.length ? 'ok' : 'warn', note, summary: r.summary, topCommands: r.topCommands };
}

export function collectPlugins(home, repo = REPO) {
  const pins = [];
  const mk = readJson(path.join(repo, 'claude', 'settings.json')).extraKnownMarketplaces || {};
  for (const [mkt, v] of Object.entries(mk)) {
    for (const p of v?.source?.plugins || []) {
      if (typeof p?.name === 'string') pins.push({ key: `${p.name}@${mkt}`, ref: p.source?.ref ?? null, sha: p.source?.sha ?? null });
    }
  }
  let installed;
  try { installed = readJson(path.join(home, 'plugins', 'installed_plugins.json')).plugins || {}; }
  catch { return { status: 'missing', note: 'installed_plugins.json not readable.', items: [] }; }
  let enabledMap = {};
  try { enabledMap = readJson(path.join(home, 'settings.json')).enabledPlugins || {}; } catch { /* treated as not enabled */ }
  const items = pins.map((p) => {
    const inst = installed[p.key]?.[0];
    const enabled = enabledMap[p.key] === true;
    const item = {
      name: p.key, enabled, installedVersion: inst?.version ?? null, installedSha: inst?.gitCommitSha ?? null,
      pinnedRef: p.ref, pinnedSha: p.sha, status: 'missing',
    };
    if (inst) {
      const versionOk = !p.ref || inst.version === String(p.ref).replace(/^v/, '');
      const shaOk = !p.sha || inst.gitCommitSha === p.sha;
      item.status = enabled && versionOk && shaOk ? 'ok' : 'warn';
    }
    return item;
  });
  return { status: items.some((i) => i.status !== 'ok') ? 'warn' : 'ok', note: items.length ? '' : 'No pins found in claude/settings.json.', items };
}

export function collectHooks(home) {
  let live;
  try { live = readJson(path.join(home, 'settings.json')); }
  catch { return { status: 'missing', note: 'Live settings.json not readable.', items: [] }; }
  const cmds = [];
  for (const groups of Object.values(live.hooks || {})) {
    for (const g of Array.isArray(groups) ? groups : []) {
      for (const h of g?.hooks || []) if (typeof h?.command === 'string') cmds.push(h.command);
    }
  }
  const items = ['compact-context.sh', 'config-audit.sh'].map((name) => {
    const fileExists = fs.existsSync(path.join(home, 'hooks', name));
    const registered = cmds.some((c) => c.includes(name));
    return { name, fileExists, registered, status: fileExists && registered ? 'ok' : fileExists || registered ? 'warn' : 'missing' };
  });
  const rtk = cmds.some((c) => c.trim() === 'rtk hook claude');
  items.push({ name: 'rtk hook claude', fileExists: null, registered: rtk, status: rtk ? 'ok' : 'missing' });
  return { status: items.every((i) => i.status === 'ok') ? 'ok' : 'warn', note: '', items };
}

// Port and host resolution for the claude-mem worker. Only the two worker keys are read from its settings file (it may hold tokens).
export function resolveWorker(env) {
  let fileCfg = {};
  try {
    const s = readJson(path.join(env.CLAUDE_MEM_DATA_DIR || path.join(os.homedir(), '.claude-mem'), 'settings.json'));
    fileCfg = { port: s.CLAUDE_MEM_WORKER_PORT, host: s.CLAUDE_MEM_WORKER_HOST };
  } catch { /* no settings */ }
  const validPort = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 && n < 65536 ? n : null; };
  let port = validPort(env.CLAUDE_MEM_WORKER_PORT);
  let portSource = 'env';
  if (!port) { port = validPort(fileCfg.port); portSource = 'settings'; }
  if (!port) { port = 37700 + ((process.getuid?.() ?? 77) % 100); portSource = 'default'; }
  const okHost = (h) => (typeof h === 'string' && /^[A-Za-z0-9.\-:[\]]{1,100}$/.test(h) ? h : null);
  const host = okHost(env.CLAUDE_MEM_WORKER_HOST) || okHost(fileCfg.host) || '127.0.0.1';
  return { base: `http://${host}:${port}`, portSource };
}

const get = (url) => fetch(url, { signal: AbortSignal.timeout(1000), redirect: 'manual' });

export async function collectClaudeMem(env) {
  const { base, portSource } = resolveWorker(env);
  const url = `${base}/api/health`;
  const b = { url, portSource, reachable: false, version: null };
  try {
    const res = await get(url);
    if (!res.ok) return { status: 'warn', note: `Worker answered HTTP ${res.status}.`, ...b };
    let version = null;
    try { const v = (await res.json()).version; if (typeof v === 'string') version = v.slice(0, 40); } catch { /* not JSON */ }
    return { status: 'ok', note: '', ...b, reachable: true, version };
  } catch {
    return { status: 'warn', note: 'Worker not reachable.', ...b };
  }
}

// Keeps only four fields of /api/stats (never the database path). Null when the worker is unreachable.
export async function fetchMemStats(env) {
  try {
    const res = await get(`${resolveWorker(env).base}/api/stats`);
    if (!res.ok) return null;
    const d = (await res.json()).database;
    const s = (v) => (typeof v === 'string' ? v.slice(0, 40) : null);
    return { observations: num(d.observations), sessions: num(d.sessions), summaries: num(d.summaries), since: s(d.firstObservationAt) };
  } catch { return null; }
}

export function buildSavings({ scan, rtk, mem, home, nowMs }) {
  const dates = new Set(localDates(nowMs));
  const tok = scan ? buildTokens(scan).totals : null;
  const cacheRead7d = tok ? tok.cacheRead : 0;
  let ponytailOn = false;
  try {
    ponytailOn = Object.entries(readJson(path.join(home, 'settings.json')).enabledPlugins || {}).some(([k, v]) => k.startsWith('ponytail@') && v === true);
  } catch { /* treated as not enabled */ }
  const missing = [];
  if (!rtk.summary) missing.push('RTK');
  if (!scan) missing.push('cache');
  if (!mem) missing.push('claude-mem');
  return {
    status: missing.length === 3 ? 'missing' : missing.length ? 'warn' : 'ok',
    note: 'RTK and cache figures are measured on this machine. Ponytail figures are its published benchmark, not this machine.'
      + (missing.length ? ` Unavailable: ${missing.join(', ')}.` : ''),
    rtk: rtk.summary ? {
      saved7d: rtk.daily.filter((d) => dates.has(d.date)).reduce((s, d) => s + d.saved, 0),
      savedAll: rtk.summary.savedTokens, savedPct: rtk.summary.savedPct,
    } : null,
    cache: tok ? { cacheRead7d, savedInputTokens7d: Math.round(cacheRead7d * 0.9), hitRate7d: tok.hitRate } : null,
    claudeMem: mem,
    ponytail: { enabled: ponytailOn, ...PONYTAIL },
    delegation: scan ? buildDelegation(scan) : [],
  };
}

const guard = async (fn, extra = {}) => {
  try { return await fn(); }
  catch (e) { return { status: 'missing', note: `Collector failed (${e?.code || e?.name || 'error'}).`, ...extra }; }
};

export async function collect(opts = {}) {
  const env = opts.env || process.env;
  const home = path.resolve(opts.home || env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'));
  const nowMs = Date.parse(opts.now || '') || Date.now();
  const bin = env.MONITOR_RTK_BIN || 'rtk';

  let scan = null;
  let scanErr = null;
  try { scan = await scanTranscripts(home, nowMs, opts.cache); } catch (e) { scanErr = e; }
  const noScan = (extra) => ({ status: 'missing', note: `No transcripts readable (${scanErr?.code || 'error'}).`, ...extra });
  const expected = () => readExpectedModels();
  const routing = await guard(() => (scan ? buildRouting(scan, expected()) : noScan({ windowDays: WINDOW_DAYS, mainThread: [], background: [], agents: [] })), { windowDays: WINDOW_DAYS, mainThread: [], background: [], agents: [] });
  const tokens = await guard(() => (scan ? buildTokens(scan) : noScan({ days: [], totals: null })), { days: [], totals: null });
  const orchestration = await guard(() => (scan ? buildOrchestration(scan, expected()) : noScan({ sessions: [] })), { sessions: [] });
  const rtkRaw = await fetchRtk(bin).catch(() => ({ missing: false, summary: null, daily: [], topCommands: [] }));
  const mem = await fetchMemStats(env);
  const savings = await guard(() => buildSavings({ scan, rtk: rtkRaw, mem, home, nowMs }), { rtk: null, cache: null, claudeMem: null, ponytail: null, delegation: [] });
  return {
    generatedAt: iso(nowMs),
    refreshSec: opts.refreshSec ?? null,
    routing, tokens,
    rtk: rtkSection(rtkRaw),
    plugins: await guard(() => collectPlugins(home), { items: [] }),
    claudeMem: await guard(() => collectClaudeMem(env), { url: null, portSource: null, reachable: false, version: null }),
    hooks: await guard(() => collectHooks(home), { items: [] }),
    savings, orchestration,
  };
}

// CLI args: [out.html] [--watch [sec]]; sec defaults to 10 and is at least 3.
export function parseArgs(argv) {
  const a = argv.slice(2);
  const wi = a.indexOf('--watch');
  let watch = null;
  if (wi >= 0) {
    const n = Number(a[wi + 1]);
    const hasSec = a[wi + 1] !== undefined && Number.isFinite(n);
    watch = Math.max(3, hasSec ? n : 10);
    a.splice(wi, hasSec ? 2 : 1);
  }
  return { out: path.resolve(a[0] || path.join(os.tmpdir(), 'claude-monitor.html')), watch };
}

async function main() {
  const { render } = await import('./monitor-html.mjs');
  const { out, watch } = parseArgs(process.argv);
  if (!watch) {
    fs.writeFileSync(out, render(await collect()));
    console.log(out);
    return;
  }
  const cache = new Map();
  process.on('SIGINT', () => { console.log('stopped'); process.exit(0); });
  console.log(out);
  for (;;) {
    const t0 = Date.now();
    try {
      fs.writeFileSync(out, render(await collect({ cache, refreshSec: watch })));
      console.log(`${new Date().toTimeString().slice(0, 8)} refreshed in ${Date.now() - t0} ms`);
    } catch (e) { console.error(`refresh failed: ${e?.message || e}`); }
    await new Promise((r) => setTimeout(r, watch * 1000));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => { console.error(`monitor failed: ${e?.message || e}`); process.exit(1); });
}
