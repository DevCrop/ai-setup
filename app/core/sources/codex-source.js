import fs from 'node:fs';
import path from 'node:path';
import { localDates } from '../../../scripts/monitor.mjs';
import { scanCodexUsage } from '../codex-usage.js';
import { isDenied, readGuarded } from '../guard.js';
import { Source, guardSource } from '../source.js';
import { readConfig } from '../toml-lite.js';

const MAX_CONFIG = 1 << 20;
const MAX_WORKTREES = 5000; // shortcut: entries beyond this are not counted, upgrade if a real tree is larger
const MAX_SESSION_FILES = 20000; // shortcut: stop counting here, upgrade if a real tree is larger
const pad = (n) => String(n).padStart(2, '0');
const localDate = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

// Date of a session file from its path (YYYY/MM/DD) or name (YYYY-MM-DD), else from mtime. The file is never opened.
const sessionDate = (rel, mtimeMs) => {
  const m = /(\d{4})[\\/](\d{2})[\\/](\d{2})/.exec(rel) || /(\d{4})-(\d{2})-(\d{2})/.exec(rel);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : localDate(mtimeMs);
};

// Names and stats only.
function listDir(dir, codexHome, re) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && re.test(e.name) && !isDenied(path.join(dir, e.name), codexHome))
    .map((e) => { const st = fs.statSync(path.join(dir, e.name)); return { name: e.name, size: st.size, mtimeMs: st.mtimeMs }; });
}

// Directory names only (skills/).
const listDirs = (dir, codexHome) => fs.readdirSync(dir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !isDenied(path.join(dir, e.name), codexHome)).map((e) => e.name).sort();

// Entries directly under worktrees/: how many, and the oldest mtime. Never opened.
function scanWorktrees(dir, codexHome) {
  const entries = fs.readdirSync(dir).filter((n) => !isDenied(path.join(dir, n), codexHome)).slice(0, MAX_WORKTREES);
  const times = entries.map((n) => fs.statSync(path.join(dir, n)).mtimeMs);
  return { count: entries.length, oldestMtimeMs: times.length ? Math.min(...times) : null };
}

// A hook state key is "<file>:<event>:<n>:<n>"; the file part is what must exist.
const HOOK_SUFFIX = /:[A-Za-z0-9_-]+:\d+:\d+$/;
export const hookFile = (key) => key.replace(HOOK_SUFFIX, '');

function countSessionsByDate(dir, codexHome, nowMs) {
  const byDate = {};
  let total = 0;
  const walk = (d, rel, depth) => {
    if (depth > 6 || total >= MAX_SESSION_FILES) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (isDenied(full, codexHome)) continue;
      if (e.isDirectory()) walk(full, `${rel}${e.name}/`, depth + 1);
      else if (e.isFile() && total < MAX_SESSION_FILES) {
        total++;
        const date = sessionDate(`${rel}${e.name}`, fs.statSync(full).mtimeMs);
        byDate[date] = (byDate[date] || 0) + 1;
      }
    }
  };
  walk(dir, '', 0);
  const recent = localDates(nowMs, 7);
  const last7d = recent.reduce((n, d) => n + (byDate[d] || 0), 0);
  return { total, last7d, byDate: Object.fromEntries(recent.filter((d) => byDate[d]).map((d) => [d, byDate[d]])) };
}

export class CodexSource extends Source {
  id = 'codex';
  label = 'Codex';
  #usageCache = new Map();
  #usageRun = null; // a scan still running from a timed-out collect is joined, never run twice over one cache

  #usage(home, now) {
    this.#usageRun ??= scanCodexUsage(home, now, this.#usageCache).finally(() => { this.#usageRun = null; });
    return this.#usageRun;
  }

  async collect(ctx) {
    return guardSource(async () => {
      const home = ctx.homes.codex;
      if (!home || !fs.statSync(home).isDirectory()) return { status: 'missing', note: '~/.codex not readable.', data: null };
      let status = 'ok';
      let note = '';
      let config = null;
      try {
        config = readConfig(readGuarded(path.join(home, 'config.toml'), { codexHome: home, maxBytes: MAX_CONFIG }).toString('utf8'));
        config.projects = config.projects.map((p) => ({ ...p, exists: fs.existsSync(p.path) }));
        // A relative file part cannot be checked from here, so it counts as existing (never a false "missing").
        config.hookList = config.hookList.map((h) => ({ ...h, path: hookFile(h.key), exists: !path.isAbsolute(hookFile(h.key)) || fs.existsSync(hookFile(h.key)) }));
      } catch (e) {
        status = 'warn';
        note = e?.code === 'ETOOLARGE' ? 'config.toml is larger than 1 MB and was not read.' : 'config.toml not readable.';
      }
      const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };
      const backups = safe(() => listDir(home, home, /^config\.toml\.bak/), []);
      const logs = safe(() => listDir(home, home, /^logs_.*\.sqlite$/), []);
      const sessions = safe(() => countSessionsByDate(path.join(home, 'sessions'), home, ctx.now), { total: 0, last7d: 0, byDate: {} });
      sessions.archived = safe(() => countSessionsByDate(path.join(home, 'archived_sessions'), home, ctx.now).total, 0);
      const agents = safe(() => listDir(path.join(home, 'agents'), home, /\.toml$/i), []);
      const agentsMd = safe(() => listDir(path.join(home, 'agents'), home, /^AGENTS\.md$/)[0]?.size, null) ?? safe(() => listDir(home, home, /^AGENTS\.md$/)[0]?.size, null) ?? null;
      const skills = safe(() => listDirs(path.join(home, 'skills'), home), []);
      const worktrees = safe(() => scanWorktrees(path.join(home, 'worktrees'), home), { count: 0, oldestMtimeMs: null });
      const usage = await this.#usage(home, ctx.now).catch(() => null);
      return { status, note, data: { config, backups, logs, sessions, agents, agentsMd, skills, worktrees, usage } };
    });
  }
}
