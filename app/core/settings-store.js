import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeAtomic } from '../../scripts/monitor.mjs';

export const DEFAULT_SETTINGS = Object.freeze({ notify: true, quietStart: '', quietEnd: '', updateCheck: true, autoUpdate: true, applySetup: true, theme: 'system', liveSec: 5, idleSec: 30, claudeHome: '', codexHome: '' });
export const THEMES = ['system', 'light', 'dark'];
// Refresh period in seconds while the main window is on screen (live) and while only the strip shows (idle).
export const LIVE_SECS = [3, 5, 10];
export const IDLE_SECS = [10, 30, 60];
const HHMM = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;

// A home folder setting must be a normalized absolute local path to a folder holding the folder only that tool writes
// (session transcripts), so a typo, the repo's own claude/ or another tool's config folder cannot point the monitor
// (and its fixes) elsewhere. UNC paths are refused (a dead share would hang the main process); a mapped drive letter or a
// link to a share still passes. '' means automatic.
const MARKER = { claudeHome: 'projects', codexHome: 'sessions' };
const NETWORK = /^[\\/]{2}/;
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
export function validHome(key, v) {
  if (v === '') return true;
  if (typeof v !== 'string' || v.length > 400 || /[\0\r\n]/.test(v) || NETWORK.test(v) || !path.isAbsolute(v) || path.resolve(v) !== v) return false;
  return isDir(v) && isDir(path.join(v, MARKER[key]));
}

// What the user typed, made comparable: a local absolute path is resolved (slashes, '..', trailing separator); anything
// else is returned as is for validHome to refuse.
export function normHome(v) {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  return t && path.isAbsolute(t) && !NETWORK.test(t) ? path.resolve(t) : t;
}

// The folders the monitor reads: the setting, else the tool's own env variable, else the default under the home folder.
export function resolveHomes(s, env = process.env, home = os.homedir()) {
  return {
    claude: s.claudeHome || env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'),
    codex: s.codexHome || env.CODEX_HOME || path.join(home, '.codex'),
  };
}

const VALID = {
  theme: (v) => THEMES.includes(v),
  notify: (v) => typeof v === 'boolean',
  updateCheck: (v) => typeof v === 'boolean',
  autoUpdate: (v) => typeof v === 'boolean',
  applySetup: (v) => typeof v === 'boolean',
  quietStart: (v) => v === '' || (typeof v === 'string' && HHMM.test(v)),
  quietEnd: (v) => v === '' || (typeof v === 'string' && HHMM.test(v)),
  liveSec: (v) => LIVE_SECS.includes(v),
  idleSec: (v) => IDLE_SECS.includes(v),
  claudeHome: (v) => validHome('claudeHome', v),
  codexHome: (v) => validHome('codexHome', v),
};

// userData/settings.json: only the keys above, each checked; a broken or missing file reads as the defaults, and a saved
// folder that is gone reads as automatic.
export class SettingsStore {
  #file;
  #cache = null;

  constructor({ file }) { this.#file = file; }

  get() {
    if (this.#cache) return { ...this.#cache };
    let raw = {};
    try { raw = JSON.parse(fs.readFileSync(this.#file, 'utf8')); } catch { /* defaults */ }
    const out = { ...DEFAULT_SETTINGS };
    if (raw && typeof raw === 'object') for (const k of Object.keys(VALID)) if (Object.hasOwn(raw, k) && VALID[k](raw[k])) out[k] = raw[k];
    this.#cache = out;
    return { ...out };
  }

  set(patch) {
    if (!patch || typeof patch !== 'object') throw new TypeError('bad settings');
    for (const [k, v] of Object.entries(patch)) if (!Object.hasOwn(VALID, k) || !VALID[k](v)) throw new TypeError(`bad setting ${k}`);
    const next = { ...this.get(), ...patch };
    writeAtomic(this.#file, JSON.stringify(next));
    this.#cache = next;
    return { ...next };
  }
}
