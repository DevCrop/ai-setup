import fs from 'node:fs';
import path from 'node:path';
import { localDates } from '../../scripts/monitor.mjs';
import { isDenied } from './guard.js';

// Codex token use from ~/.codex/sessions rollout files. Only three line types are parsed: session_meta (cwd folder name),
// turn_context (model name) and event_msg/token_count (counts and the usage-limit percentages). Every other line, which
// holds prompts, tool output and instructions, is skipped by a substring test before JSON.parse and never kept.
const WINDOW_DAYS = 7;
const LIVE_MS = 15 * 60 * 1000;
const MAX_FILES = 2000; // shortcut: files beyond this in the window are skipped, upgrade if a real week is larger
const MAX_LINE = 4 << 20; // a token_count line is ~1 KB; longer lines are prompt or tool text and are not parsed
const CHUNK = 8 << 20;
const yieldNow = () => new Promise((r) => setImmediate(r));
const WANT = ['"token_count"', '"session_meta"', '"turn_context"'];
const pad = (n) => String(n).padStart(2, '0');
const localDate = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const n0 = (v) => (Number.isFinite(v) && v > 0 ? v : 0);
// both separators on every OS: a Windows path must never leak whole when the app runs elsewhere
const base = (p) => (typeof p === 'string' && p ? p.split(/[\\/]/).filter(Boolean).pop()?.slice(0, 80) ?? null : null);
const pct = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : null);

function limitOf(l) {
  if (!l || typeof l !== 'object') return null;
  const usedPercent = pct(l.used_percent);
  if (usedPercent === null) return null;
  return { usedPercent, windowMinutes: n0(l.window_minutes) || null, resetsAt: Number.isFinite(l.resets_at) ? l.resets_at * 1000 : null };
}

// Folds the new complete lines of one file into its running state. Totals are cumulative per session, so each event adds
// its rise over the last one: a repeated event adds nothing, and a drop (a new thread in the same file) starts over.
function feed(st, text) {
  for (const line of text.split('\n')) {
    if (!line || line.length > MAX_LINE || !WANT.some((w) => line.includes(w))) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    const ts = Date.parse(j?.timestamp);
    if (j?.type === 'session_meta') { st.cwd = base(j.payload?.cwd) ?? st.cwd; continue; }
    if (j?.type === 'turn_context') { if (typeof j.payload?.model === 'string') st.model = j.payload.model.slice(0, 60); st.cwd = st.cwd ?? base(j.payload?.cwd); continue; }
    if (j?.type !== 'event_msg' || j.payload?.type !== 'token_count' || !Number.isFinite(ts)) continue;
    const info = j.payload.info;
    const t = info?.total_token_usage;
    if (t && typeof t === 'object') {
      const cur = { input: n0(t.input_tokens), cached: n0(t.cached_input_tokens), output: n0(t.output_tokens), total: n0(t.total_tokens) };
      const prev = st.total && cur.total >= st.total.total ? st.total : { input: 0, cached: 0, output: 0, total: 0 };
      const d = { input: Math.max(0, cur.input - prev.input), cached: Math.max(0, cur.cached - prev.cached), output: Math.max(0, cur.output - prev.output) };
      st.total = cur;
      if (d.input || d.cached || d.output) {
        const date = localDate(ts);
        const day = st.days[date] ?? (st.days[date] = { input: 0, cached: 0, output: 0, models: {} });
        day.input += d.input; day.cached += d.cached; day.output += d.output;
        if (st.model) day.models[st.model] = (day.models[st.model] ?? 0) + d.output;
      }
      const last = info.last_token_usage;
      if (last && Number.isFinite(info.model_context_window)) st.context = { tokens: n0(last.input_tokens), window: n0(info.model_context_window), at: ts };
    }
    const rl = j.payload.rate_limits;
    if (rl && typeof rl === 'object' && (!st.rate || ts >= st.rate.at)) {
      const primary = limitOf(rl.primary);
      if (primary) st.rate = { at: ts, primary, secondary: limitOf(rl.secondary) };
    }
    st.lastAt = Math.max(st.lastAt, ts);
  }
}

const freshState = () => ({ offset: 0, cwd: null, model: null, total: null, days: {}, context: null, rate: null, lastAt: 0, skipping: false });

// Each window expires on its own: a weekly limit still counts after the 5-hour window reset.
function liveRate(rate, nowMs) {
  if (!rate) return null;
  const keep = (w) => (w && (!w.resetsAt || w.resetsAt > nowMs) ? w : null);
  const primary = keep(rate.primary);
  const secondary = keep(rate.secondary);
  return primary || secondary ? { at: new Date(rate.at).toISOString(), primary, secondary } : null;
}

// Reads only the bytes added since the last run (rollouts are append-only); a file that shrank or changed identity is
// read again from the start. A partial last line waits for the next run.
async function readNew(file, size, st) {
  if (size < st.offset) Object.assign(st, { ...freshState(), ino: st.ino });
  // a file that has not grown is not read again, even when its last line has no newline yet
  if (size === st.offset || size === st.seenSize) return;
  st.seenSize = size;
  // Chunks, never the whole file: one live Codex session file was 728 MB, past the longest string V8 can hold.
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(Math.min(CHUNK, size - st.offset));
  try {
    while (st.offset < size) {
      const n = fs.readSync(fd, buf, 0, Math.min(CHUNK, size - st.offset), st.offset);
      if (n <= 0) break;
      const end = buf.lastIndexOf(10, n - 1);
      if (end < 0) {
        // no newline in a whole chunk: one huge prompt or tool line; skip past it, it is never a token_count line
        if (n < CHUNK) break;
        st.offset += n;
        st.skipping = true;
        continue;
      }
      let start = 0;
      if (st.skipping) { start = buf.indexOf(10) + 1; st.skipping = false; }
      if (start <= end) feed(st, buf.toString('utf8', start, end + 1));
      st.offset += end + 1;
      await yieldNow(); // a first read of a big file must not freeze the Electron main process
    }
  } finally { fs.closeSync(fd); }
}

function listFiles(dir, codexHome, from) {
  const out = [];
  const walk = (d, depth) => {
    if (depth > 6 || out.length >= MAX_FILES) return;
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (isDenied(full, codexHome)) continue;
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.isFile() && /^rollout-.*\.jsonl$/.test(e.name) && out.length < MAX_FILES) {
        try { const s = fs.statSync(full); if (s.mtimeMs >= from) out.push({ file: full, size: s.size, ino: `${s.ino}|${s.birthtimeMs}` }); } catch { /* vanished */ }
      }
    }
  };
  walk(dir, 0);
  return out;
}

// `cache` (Map, kept by the caller between runs) holds per-file state keyed by path. Returns counts and names only.
export async function scanCodexUsage(codexHome, nowMs, cache = new Map()) {
  const dir = path.join(codexHome, 'sessions');
  if (!fs.existsSync(dir)) return { status: 'missing', note: 'No Codex sessions folder.', days: [], today: null, rate: null, live: [], models: [] };
  const from = nowMs - WINDOW_DAYS * 86400000;
  const seen = new Set();
  for (const { file, size, ino } of listFiles(dir, codexHome, from)) {
    let st = cache.get(file);
    if (!st || st.ino !== ino) { st = { ...freshState(), ino }; cache.set(file, st); }
    try { await readNew(file, size, st); } catch { continue; }
    seen.add(file);
  }
  for (const k of cache.keys()) if (!seen.has(k)) cache.delete(k);

  const dates = localDates(nowMs, WINDOW_DAYS);
  const today = localDate(nowMs);
  const days = dates.map((date) => ({ date, input: 0, cached: 0, output: 0 }));
  const byDate = Object.fromEntries(days.map((d) => [d.date, d]));
  const projects = new Map();
  const models = {};
  let rate = null;
  const live = [];
  for (const st of cache.values()) {
    for (const [date, v] of Object.entries(st.days)) {
      const d = byDate[date];
      if (!d) continue;
      d.input += v.input; d.cached += v.cached; d.output += v.output;
      for (const [m, o] of Object.entries(v.models)) models[m] = (models[m] ?? 0) + o;
    }
    const t = st.days[today];
    if (t && (t.output || t.input)) {
      const name = st.cwd ?? '(알 수 없음)';
      const p = projects.get(name) ?? { projectName: name, sessions: 0, output: 0, cached: 0, input: 0, lastAt: 0 };
      p.sessions += 1; p.output += t.output; p.cached += t.cached; p.input += t.input; p.lastAt = Math.max(p.lastAt, st.lastAt);
      projects.set(name, p);
    }
    if (st.rate && (!rate || st.rate.at > rate.at)) rate = st.rate;
    if (st.context && nowMs - st.context.at <= LIVE_MS && st.context.window) live.push({ projectName: st.cwd ?? '(알 수 없음)', tokens: st.context.tokens, window: st.context.window, at: new Date(st.context.at).toISOString() });
  }
  const list = [...projects.values()].sort((a, b) => b.output - a.output);
  const sum = (k) => list.reduce((n, p) => n + p[k], 0);
  return {
    status: 'ok', note: '',
    days,
    today: { output: sum('output'), input: sum('input'), cached: sum('cached'), sessions: sum('sessions'), projects: list.slice(0, 6).map((p) => ({ ...p, lastAt: p.lastAt ? new Date(p.lastAt).toISOString() : null })) },
    // the limit as of its newest report; a window that already reset reads as unknown
    rate: liveRate(rate, nowMs),
    live: live.sort((a, b) => b.tokens - a.tokens).slice(0, 6),
    models: Object.entries(models).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([model, output]) => ({ model, output })),
  };
}
