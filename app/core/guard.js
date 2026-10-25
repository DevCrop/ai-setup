// Read guard: the files and values the app never touches (arch section 6).
import fs from 'node:fs';
import path from 'node:path';

export const SECRET_KEY_RE = /key|token|secret|password/i;

const CODEX_DENIED = ['auth.json', 'secrets', '.sandbox-secrets'];

// True when `file` is a credential, an env file or inside the Codex secret locations.
export function isDenied(file, codexHome = null) {
  const abs = path.resolve(file);
  if (path.basename(abs).match(/^\.(credentials|env)/i)) return true;
  if (abs.split(path.sep).some((s) => /^\.(credentials|env)/i.test(s))) return true;
  if (codexHome) {
    const rel = path.relative(path.resolve(codexHome), abs);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
      const first = rel.split(path.sep)[0];
      if (CODEX_DENIED.some((d) => d.toLowerCase() === first.toLowerCase())) return true;
    }
  }
  return false;
}

// Every file read in app/core goes through here (config.toml, settings.json, the X1 backup); the denied names are refused.
export function readGuarded(file, { codexHome = null, maxBytes = Infinity } = {}) {
  if (isDenied(file, codexHome)) throw Object.assign(new Error('denied path'), { code: 'EDENIED' });
  const st = fs.statSync(file);
  if (st.size > maxBytes) throw Object.assign(new Error('file too large'), { code: 'ETOOLARGE' });
  return fs.readFileSync(file);
}
