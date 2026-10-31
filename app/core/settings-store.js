import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeAtomic } from '../../scripts/monitor.mjs';

export const DEFAULT_SETTINGS = Object.freeze({ notify: true, quietStart: '', quietEnd: '', updateCheck: true, autoUpdate: true, theme: 'system', liveSec: 5, idleSec: 30, claudeHome: '', codexHome: '' });
export const THEMES = ['system', 'light', 'dark'];
// Refresh period in seconds while the main window is on screen (live) and while only the strip shows (idle).
export const LIVE_SECS = [3, 5, 10];
export const IDLE_SECS = [10, 30, 60];
const HHMM = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;

// A home folder setting must be an absolute path to an existing folder that holds what that tool writes there, so a
// typo cannot point the monitor (and its fixes) at an unrelated folder. '' means automatic.
const MARKERS = { claudeHome: ['projects', 'settings.json'], codexHome: ['config.toml', 'sessions'] };
export function validHome(key, v, exists = fs.existsSync) {
  if (v === '') return true;
  if (typeof v !== 'string' || v.length > 400 || /[\0\r\n]/.test(v) || !path.isAbsolute(v)) return false;
  try { if (!fs.statSync(v).isDirectory()) return false; } catch { return false; }
  return MARKERS[key].some((m) => exists(path.join(v, m)));
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
