import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { maskHome } from './mask-home.js';

const MAX_BYTES = 512 * 1024;
const MAX_LINE = 600;
const LEVELS = new Set(['info', 'warn', 'error']);

// userData/logs/app.log: one line per event ("<iso> <level> <text>"), home path masked, control characters dropped.
// At MAX_BYTES the file moves to app.1.log (one old file kept). Never throws: a log that cannot be written is skipped.
export class AppLog {
  constructor({ dir, now = () => Date.now(), homeDir = os.homedir(), maxBytes = MAX_BYTES } = {}) {
    this.file = dir ? path.join(dir, 'app.log') : null;
    this.now = now;
    this.homeDir = homeDir;
    this.maxBytes = maxBytes;
  }

  write(level, text) {
    if (!this.file) return;
    const lv = LEVELS.has(level) ? level : 'info';
    const clean = maskHome(String(text ?? ''), this.homeDir).replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, MAX_LINE);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      let size = 0;
      try { size = fs.statSync(this.file).size; } catch { /* first line */ }
      if (size >= this.maxBytes) fs.renameSync(this.file, this.file.replace(/\.log$/, '.1.log'));
      fs.appendFileSync(this.file, `${new Date(this.now()).toISOString()} ${lv} ${clean}\n`);
    } catch { /* logging is best effort */ }
  }

  info(t) { this.write('info', t); }
  warn(t) { this.write('warn', t); }
  error(t) { this.write('error', t); }
}

// Error text for the log: name, code and message, plus the first stack frame; never the cause chain.
export const errText = (e) => {
  if (!(e instanceof Error)) return String(e);
  const frame = String(e.stack ?? '').split('\n').find((l) => /^\s+at /.test(l))?.trim() ?? '';
  return `${e.name}${e.code ? `(${e.code})` : ''}: ${e.message}${frame ? ` ${frame}` : ''}`;
};
