import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Source } from '../source.js';

const TTL_MS = 10 * 60 * 1000;
const SCRIPT = fileURLToPath(new URL('./routines.ps1', import.meta.url));
const STATE = { 0: 'unknown', 1: 'disabled', 2: 'queued', 3: 'ready', 4: 'running' };
const ACCOUNTS = new Set(['system', 'service', 'user']);
const AI = new Set(['claude', 'codex']);
const LIST_MAX = 100;

// A failure is an HRESULT with the severity bit or a plain exit code (1..0xFFFF). Running, not yet run and queued
// (0x41301, 0x41303, 0x41325) and informational codes such as 0x40010004 are not.
const failedCode = (hex) => { const n = parseInt(hex, 16); return n >= 0x80000000 || (n > 0 && n <= 0xffff); };
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Per-user task names carry SIDs (GoogleUpdateTaskUserS-1-5-21-...) or the user name; neither leaves the main process.
export function masker(user = os.userInfo().username) {
  const name = user && user.length >= 2 ? new RegExp(escapeRe(user), 'gi') : null;
  return (s) => { let t = s.replace(/S-1-5-21(?:-\d+)+/gi, 'S-1-5-21-…'); if (name) t = t.replace(name, '<사용자>'); return t; };
}

export function normalizeRoutines(raw, mask = masker()) {
  const text = (v, max = 200) => (typeof v === 'string' ? mask(v.slice(0, max)) : '');
  const iso = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
  // PowerShell 5.1 turns a one-item array into an object and may drop an empty one.
  const list = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? [v] : []).slice(0, LIST_MAX);
  // Basename only, so no folder or argument ever leaves; anything that still looks like arguments is dropped.
  const exe = (v) => { const s = text(v, 260).split(/[\\/]/).pop().trim(); return s && !/\s-|=/.test(s) ? s.slice(0, 80) : null; };
  const tasks = list(raw?.tasks).filter((t) => AI.has(t?.ai)).map((t) => {
    const lastResult = /^0x[0-9A-F]{1,8}$/i.test(t.lastResult) ? `0x${t.lastResult.slice(2).toUpperCase()}` : null;
    const enabled = t.enabled === true;
    const lastRun = iso(t.lastRun);
    return {
      ai: t.ai, name: text(t.name), path: text(t.path, 300), state: STATE[t.state] ?? 'unknown', enabled,
      lastRun, nextRun: iso(t.nextRun), lastResult, failed: enabled && !!lastRun && !!lastResult && failedCode(lastResult),
      triggers: list(t.triggers).filter((x) => typeof x === 'string').map((x) => x.slice(0, 40)).slice(0, 8),
      exe: exe(t.exe), account: ACCOUNTS.has(t.account) ? t.account : null, elevated: t.elevated === true,
    };
  });
  const startup = list(raw?.startup).filter((s) => AI.has(s?.ai)).map((s) => ({
    ai: s.ai, name: text(s.name, 120), location: ['run', 'runonce', 'folder'].includes(s.location) ? s.location : 'run',
    scope: s.scope === 'all' ? 'all' : 'me', exe: exe(s.exe), enabled: typeof s.enabled === 'boolean' ? s.enabled : null,
  }));
  return { tasks, startup };
}

// Reads only the first 2 KB of a file: front matter and leading keys live there, the rest is never read.
function head(file) {
  const fd = fs.openSync(file, 'r');
  try { const b = Buffer.alloc(2048); return b.toString('utf8', 0, fs.readSync(fd, b, 0, 2048, 0)); } finally { fs.closeSync(fd); }
}
function dirs(dir, max = 50) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort().slice(0, max); } catch { return []; }
}

// ~/.claude/scheduled-tasks/*/SKILL.md: front matter name and description only, never the body.
export function readClaudeRoutines(claudeHome) {
  const dir = path.join(claudeHome, 'scheduled-tasks');
  return dirs(dir).map((n) => {
    let fm = '';
    try { fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(head(path.join(dir, n, 'SKILL.md')))?.[1] ?? ''; } catch { /* no SKILL.md: folder name only */ }
    const field = (k) => new RegExp(`^${k}:\\s*(.+)$`, 'm').exec(fm)?.[1].trim().replace(/^["']|["']$/g, '') ?? '';
    return { name: (field('name') || n).slice(0, 80), description: field('description').slice(0, 200) };
  });
}

// ~/.codex/automations/*/automation.toml: id, name, kind, status, rrule and updated_at only. The prompt and the
// target thread are skipped, and keys inside a multi-line string are never taken as keys.
const CODEX_KEYS = new Set(['id', 'name', 'kind', 'status', 'rrule', 'updated_at']);
export function readCodexAutomations(codexHome) {
  const dir = path.join(codexHome, 'automations');
  return dirs(dir).flatMap((n) => {
    let src;
    try { src = fs.readFileSync(path.join(dir, n, 'automation.toml'), 'utf8').slice(0, 65536); } catch { return []; }
    const kv = {};
    let inMulti = null;
    for (const line of src.split(/\r?\n/)) {
      if (inMulti) { if (line.includes(inMulti)) inMulti = null; continue; }
      if (/^\s*\[/.test(line)) break; // only top-level keys
      const m = /^([a-z_]+)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      const q = /^("""|''')/.exec(m[2])?.[1];
      if (q && !m[2].slice(3).includes(q)) { inMulti = q; continue; }
      if (!CODEX_KEYS.has(m[1])) continue;
      const v = /^"((?:[^"\\]|\\.)*)"/.exec(m[2])?.[1] ?? /^'([^']*)'/.exec(m[2])?.[1] ?? /^(\d+)/.exec(m[2])?.[1];
      if (v != null) kv[m[1]] = v;
    }
    const updated = Number(kv.updated_at);
    return [{
      id: (kv.id || n).slice(0, 80), name: (kv.name || kv.id || n).slice(0, 120), kind: (kv.kind || '').slice(0, 30),
      status: (kv.status || '').slice(0, 20).toLowerCase(), rrule: /^[A-Z0-9=;,:+-]{1,200}$/.test(kv.rrule || '') ? kv.rrule : '',
      updatedAt: Number.isFinite(updated) && updated > 0 ? new Date(updated).toISOString() : null,
    }];
  });
}

// Report-only view of the Claude and Codex routines on this PC: their own schedules, plus Windows scheduled tasks
// and startup entries that run claude or codex. collect() returns the last result at once and refreshes in the
// background every 10 minutes; it never throws. PowerShell runs only on Windows with a runner.
export class RoutineSource extends Source {
  id = 'routines';
  label = '루틴';
  #cache = null; // { at, data }
  #inflight = null;

  constructor({ runner = null, platform = process.platform, ttlMs = TTL_MS, mask = masker() } = {}) {
    super();
    this.runner = runner;
    this.platform = platform;
    this.ttlMs = ttlMs;
    this.mask = mask;
  }

  async collect(ctx) {
    if (!this.#inflight && (!this.#cache || ctx.now - this.#cache.at >= this.ttlMs)) {
      const at = ctx.now;
      this.#inflight = this.refresh(ctx).then((data) => { this.#cache = { at, data }; }, () => { this.#cache = { at, data: null }; })
        .finally(() => { this.#inflight = null; });
    }
    const data = this.#cache?.data ?? null;
    return { status: data ? 'ok' : 'missing', note: data ? '' : this.#cache ? '루틴을 읽지 못했습니다.' : '처음 읽는 중입니다.', data };
  }

  // Exposed for tests: resolves when a background refresh started by collect() has finished.
  settle() { return this.#inflight ?? Promise.resolve(); }

  async refresh(ctx) {
    const claude = readClaudeRoutines(ctx.homes.claude);
    const codex = readCodexAutomations(ctx.homes.codex);
    const windows = this.platform === 'win32' && !!this.runner;
    let win = { tasks: [], startup: [] };
    let windowsNote = windows ? '' : 'Windows 예약 작업은 Windows에서만 봅니다.';
    if (windows) {
      try {
        const r = await this.runner('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT], { timeout: 60000 });
        if (r.code !== 0) throw new Error('powershell failed');
        win = normalizeRoutines(JSON.parse(r.stdout.replace(/^﻿/, '')), this.mask);
      } catch { windowsNote = 'Windows 예약 작업과 시작 프로그램을 읽지 못했습니다.'; }
    }
    return { claude, codex, ...win, windowsNote, collectedAt: new Date(ctx.now).toISOString() };
  }
}
