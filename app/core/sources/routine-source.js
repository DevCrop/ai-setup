import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Source } from '../source.js';

const TTL_MS = 10 * 60 * 1000;
const SCRIPT = fileURLToPath(new URL('./routines.ps1', import.meta.url));
// A failure is an HRESULT with the severity bit or a plain exit code (1..0xFFFF). Running, not yet run and queued
// (0x41301, 0x41303, 0x41325) and informational codes such as 0x40010004 are not.
const failedCode = (hex) => { const n = parseInt(hex, 16); return n >= 0x80000000 || (n > 0 && n <= 0xffff); };
const STATE = { 0: 'unknown', 1: 'disabled', 2: 'queued', 3: 'ready', 4: 'running' };
const ACCOUNTS = new Set(['system', 'service', 'user']);
const LIST_MAX = 400;

const text = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
const iso = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
// PowerShell 5.1 turns a one-item array into an object and may drop an empty one.
const list = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? [v] : []).slice(0, LIST_MAX);
// Basename only, so no folder (user name) or argument ever leaves this function.
const exe = (v) => { const s = text(v, 260).split(/[\\/]/).pop().trim(); return s && !/\s-|\s\/|=/.test(s) ? s.slice(0, 80) : null; };

export function normalizeRoutines(raw) {
  const tasks = list(raw?.tasks).map((t) => {
    const p = text(t?.path, 300);
    const lastResult = /^0x[0-9A-F]{1,8}$/i.test(t?.lastResult) ? `0x${t.lastResult.slice(2).toUpperCase()}` : null;
    const enabled = t?.enabled === true;
    const lastRun = iso(t?.lastRun);
    return {
      name: text(t?.name), path: p, state: STATE[t?.state] ?? 'unknown', enabled, microsoft: /^\\Microsoft\\/i.test(p), hidden: t?.hidden === true,
      lastRun, nextRun: iso(t?.nextRun), lastResult,
      failed: enabled && !!lastRun && !!lastResult && failedCode(lastResult),
      triggers: list(t?.triggers).filter((x) => typeof x === 'string').map((x) => x.slice(0, 40)).slice(0, 8),
      exe: t?.exe === 'COM' ? 'COM' : exe(t?.exe), account: ACCOUNTS.has(t?.account) ? t.account : null, elevated: t?.elevated === true,
    };
  });
  const startup = list(raw?.startup).map((s) => ({
    name: text(s?.name, 120), location: ['run', 'runonce', 'folder'].includes(s?.location) ? s.location : 'run',
    scope: s?.scope === 'all' ? 'all' : 'me', exe: exe(s?.exe), enabled: typeof s?.enabled === 'boolean' ? s.enabled : null,
  }));
  const sv = raw?.services ?? {};
  const num = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
  const services = {
    total: num(sv.total), running: num(sv.running), auto: num(sv.auto),
    autoStopped: list(sv.autoStopped).map((s) => ({ name: text(s?.name, 120), display: text(s?.display), exe: exe(s?.exe) })),
    thirdParty: list(sv.thirdParty).map((s) => ({ name: text(s?.name, 120), display: text(s?.display), state: text(s?.state, 20), startMode: text(s?.startMode, 20), exe: exe(s?.exe) })),
  };
  return { tasks, startup, services };
}

// Front matter name and description of ~/.claude/scheduled-tasks/*/SKILL.md; the body is never read past the closing ---.
export function readClaudeRoutines(claudeHome) {
  const dir = path.join(claudeHome, 'scheduled-tasks');
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort().slice(0, 50); } catch { return []; }
  return names.map((n) => {
    let head = '';
    try {
      const fd = fs.openSync(path.join(dir, n, 'SKILL.md'), 'r');
      try { const b = Buffer.alloc(2048); head = b.toString('utf8', 0, fs.readSync(fd, b, 0, 2048, 0)); } finally { fs.closeSync(fd); }
    } catch { /* no SKILL.md: show the folder name */ }
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(head)?.[1] ?? '';
    const field = (k) => new RegExp(`^${k}:\\s*(.+)$`, 'm').exec(fm)?.[1].trim().replace(/^["']|["']$/g, '') ?? '';
    return { name: text(field('name'), 80) || text(n, 80), description: text(field('description'), 200) };
  });
}

// Report-only view of what runs on its own on this PC. collect() returns the last result at once and refreshes
// in the background every 10 minutes; it never throws. Windows only; inert without a runner.
export class RoutineSource extends Source {
  id = 'routines';
  label = 'PC 루틴';
  #cache = null; // { at, data }
  #inflight = null;

  constructor({ runner = null, platform = process.platform, ttlMs = TTL_MS } = {}) {
    super();
    this.runner = runner;
    this.platform = platform;
    this.ttlMs = ttlMs;
  }

  async collect(ctx) {
    if (this.platform !== 'win32') return { status: 'missing', note: 'Windows에서만 봅니다.', data: null };
    if (!this.runner) return { status: 'missing', note: 'routine check off', data: null };
    if (!this.#inflight && (!this.#cache || ctx.now - this.#cache.at >= this.ttlMs)) {
      const at = ctx.now;
      this.#inflight = this.refresh(ctx).then((data) => { this.#cache = { at, data }; }, () => { this.#cache = { at, data: null }; })
        .finally(() => { this.#inflight = null; });
    }
    const data = this.#cache?.data ?? null;
    return { status: data ? 'ok' : 'missing', note: data ? '' : this.#cache ? 'PC 루틴을 읽지 못했습니다.' : '처음 읽는 중입니다.', data };
  }

  // Exposed for tests: resolves when a background refresh started by collect() has finished.
  settle() { return this.#inflight ?? Promise.resolve(); }

  async refresh(ctx) {
    const r = await this.runner('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT], { timeout: 60000 });
    if (r.code !== 0) throw new Error('powershell failed');
    const data = normalizeRoutines(JSON.parse(r.stdout.replace(/^﻿/, '')));
    return { ...data, claude: readClaudeRoutines(ctx.homes.claude), collectedAt: new Date(ctx.now).toISOString() };
  }
}
