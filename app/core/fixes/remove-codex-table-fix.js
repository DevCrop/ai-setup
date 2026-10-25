import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { writeAtomic } from '../../../scripts/monitor.mjs';
import { CoreError } from '../errors.js';
import { Fix } from '../fix.js';
import { readGuarded } from '../guard.js';
import { removeTable } from '../toml-lite.js';

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

// X1 / X4: removes exactly one table (all header parts must match) from ~/.codex/config.toml, with a backup first and an atomic write.
export class RemoveCodexTableFix extends Fix {
  #home;
  #parts;
  #clock;
  #appliedHash = null;

  constructor({ id, codexHome, parts, clock = () => new Date() }) {
    super(id);
    if (!Array.isArray(parts) || !parts.length || !parts.every((p) => typeof p === 'string')) throw new TypeError('parts must be a non-empty string array');
    this.#home = codexHome;
    this.#parts = parts;
    this.#clock = clock;
  }

  get restorable() { return true; }
  get parts() { return [...this.#parts]; }
  get appliedHash() { return this.#appliedHash; }

  // After a restart: the backup file and the config.toml hash right after apply come from the journal.
  resume({ backupPath, appliedHash }) {
    this.#appliedHash = appliedHash;
    this.resumeApplied({ backupPath, appliedHash });
  }

  get #config() { return path.join(this.#home, 'config.toml'); }

  #read() {
    const buf = readGuarded(this.#config, { codexHome: this.#home });
    const text = buf.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(buf)) throw new Error('config.toml is not valid UTF-8');
    return { buf, text };
  }

  doPreview() {
    const { text } = this.#read();
    const r = removeTable(text, this.#parts);
    if (!r) throw new Error('table not found');
    // previewId covers only this table, so applying another X1/X4 in the same batch does not make this one stale
    return { diff: r.removed.map((l) => `-${l}`).join('\n'), previewId: sha(r.block) };
  }

  doApply(previewId) {
    const { text } = this.#read();
    const r = removeTable(text, this.#parts);
    if (!r) throw new Error('table not found');
    // Fix.apply compared the hash already; this narrows the window to the read just before the write.
    if (sha(r.block) !== previewId) throw new Error('the table changed');
    const dir = path.join(this.#home, 'backups', 'claude-monitor');
    fs.mkdirSync(dir, { recursive: true });
    const base = stamp(this.#clock());
    let backupPath;
    for (let n = 0; ; n++) {
      backupPath = path.join(dir, `${base}${n ? `-${n}` : ''}-config.toml`);
      try { fs.copyFileSync(this.#config, backupPath, fs.constants.COPYFILE_EXCL); break; } catch (e) { if (e.code !== 'EEXIST' || n > 99) throw e; }
    }
    writeAtomic(this.#config, r.text);
    this.#appliedHash = sha(Buffer.from(r.text, 'utf8'));
    return { backupPath, appliedHash: this.#appliedHash };
  }

  checkRestore() {
    if (sha(readGuarded(this.#config, { codexHome: this.#home })) !== this.#appliedHash) throw new CoreError('RESTORE_CONFLICT');
  }

  doRestore() {
    if (!this.backupPath) throw new Error('no backup recorded');
    writeAtomic(this.#config, readGuarded(this.backupPath, { codexHome: this.#home }));
  }
}
