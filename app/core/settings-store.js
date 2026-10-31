import fs from 'node:fs';
import { writeAtomic } from '../../scripts/monitor.mjs';

export const DEFAULT_SETTINGS = Object.freeze({ notify: true, quietStart: '', quietEnd: '', updateCheck: true });
const HHMM = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;
const VALID = {
  notify: (v) => typeof v === 'boolean',
  updateCheck: (v) => typeof v === 'boolean',
  quietStart: (v) => v === '' || (typeof v === 'string' && HHMM.test(v)),
  quietEnd: (v) => v === '' || (typeof v === 'string' && HHMM.test(v)),
};

// userData/settings.json: only the keys above, each checked; a broken or missing file reads as the defaults.
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
    for (const [k, v] of Object.entries(patch)) if (!VALID[k] || !VALID[k](v)) throw new TypeError(`bad setting ${k}`);
    const next = { ...this.get(), ...patch };
    writeAtomic(this.#file, JSON.stringify(next));
    this.#cache = next;
    return { ...next };
  }
}
