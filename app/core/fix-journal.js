import fs from 'node:fs';
import path from 'node:path';
import { writeAtomic } from '../../scripts/monitor.mjs';
import { FINDING_ID_RE } from './finding.js';
import { readGuarded } from './guard.js';

export const MAX_ENTRIES = 200;
export const ACTIONS = Object.freeze(['applied', 'restored', 'applyFailed', 'restoreFailed']);
export const BACKUP_NAME_RE = /^[0-9]{8}-[0-9]{6}(-[0-9]{1,3})?-config\.toml$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const FILE_MAX_BYTES = 1 << 20;

// Journal entries hold names, ids and hashes only: never diff text, never a config value.
// `parts` are the header parts of the removed Codex table (a trusted project path or a hook state key).
function clean(e) {
  if (!e || typeof e !== 'object') return null;
  const at = typeof e.at === 'string' && Number.isFinite(Date.parse(e.at)) ? new Date(e.at).toISOString() : null;
  const parts = Array.isArray(e.parts) && e.parts.length >= 1 && e.parts.length <= 4 && e.parts.every((p) => typeof p === 'string' && p.length >= 1 && p.length <= 260) ? [...e.parts] : null;
  const backupName = typeof e.backupName === 'string' && BACKUP_NAME_RE.test(e.backupName) ? e.backupName : null;
  const appliedHash = typeof e.appliedHash === 'string' && HASH_RE.test(e.appliedHash) ? e.appliedHash : null;
  if (!at || typeof e.findingId !== 'string' || !FINDING_ID_RE.test(e.findingId) || !/^[CX][0-9]{1,2}$/.test(e.checkId ?? '')) return null;
  if (!['claude', 'codex'].includes(e.source) || !ACTIONS.includes(e.action)) return null;
  return Object.freeze({
    at, findingId: e.findingId, checkId: e.checkId, source: e.source, action: e.action, backupName, appliedHash, parts,
    // true only when a restart can still undo it: a backup file, the hash right after apply and the table to name (X1, X4)
    restorableAfterRestart: e.action === 'applied' && !!backupName && !!appliedHash && !!parts,
  });
}

// Fix history that survives a restart: <outDir>/fix-journal.json, atomic writes, the newest MAX_ENTRIES entries.
export class FixJournal {
  #entries = [];

  constructor({ file, now = () => Date.now(), max = MAX_ENTRIES } = {}) {
    if (!file) throw new TypeError('file is required');
    this.file = file;
    this.now = now;
    this.max = Math.min(MAX_ENTRIES, Math.max(1, max | 0));
    try {
      const j = JSON.parse(readGuarded(file, { maxBytes: FILE_MAX_BYTES }).toString('utf8'));
      this.#entries = (Array.isArray(j?.entries) ? j.entries : []).map(clean).filter(Boolean).slice(-this.max);
    } catch { /* no file yet or a damaged one: start empty, the next record replaces it */ }
  }

  // Never throws: a journal that cannot be written must not break a fix that already happened.
  record(entry) {
    const e = clean({ ...entry, at: new Date(this.now()).toISOString() });
    if (!e) return null;
    this.#entries = [...this.#entries, e].slice(-this.max);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      writeAtomic(this.file, JSON.stringify({ version: 1, entries: this.#entries }));
    } catch { /* kept in memory for this session */ }
    return e;
  }

  // oldest first, the same frozen objects every call
  entries() { return [...this.#entries]; }

  // newest first
  recent(n = 50) { const k = Math.max(0, n | 0); return k ? this.#entries.slice(-k).reverse() : []; }
}
