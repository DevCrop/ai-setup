import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readGuarded } from './guard.js';

const SCRIPT_EXT = /\.(sh|js|mjs|ps1|py)$/i;
const MAX_FILE = 1 << 20;
const MAX_LIST = 50;

// First path-like token of a hook command that ends in a script extension, or null. Quotes are removed.
// A token is path-like when it has a separator; a bare `hook.js` depends on the working directory, so it is ignored.
export function scriptToken(command) {
  for (const m of String(command).matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
    const t = m[1] ?? m[2] ?? m[3];
    if (SCRIPT_EXT.test(t) && /[\\/]/.test(t)) return t;
  }
  return null;
}

// ~, $HOME, ${HOME}, $CLAUDE_CONFIG_DIR and ${CLAUDE_CONFIG_DIR} are expanded; a path that still has a variable or is relative gives null.
export function expandScript(token, { home, claudeHome }) {
  let t = token.replace(/^~(?=[\\/])/, home).replace(/\$\{?HOME\}?(?=[\\/])/g, home).replace(/\$\{?CLAUDE_CONFIG_DIR\}?(?=[\\/])/g, claudeHome);
  if (/[$%]/.test(t)) return null;
  if (process.platform === 'win32') t = t.replace(/^\/([A-Za-z])\//, (_, d) => `${d.toUpperCase()}:/`); // Git Bash form /c/Users/x
  return path.isAbsolute(t) ? path.normalize(t) : null;
}

const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

// Which hook scripts named in the given settings.json files do not exist. Each file is { scope, file }.
// Only { scope, event, path } leaves this function: the command text never does. `path` shows the home folder as ~.
export function findMissingHookScripts(files, { home = os.homedir(), claudeHome, exists = isFile } = {}) {
  const shown = (p) => {
    const rel = path.relative(home, p);
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? `~/${rel.split(path.sep).join('/')}` : p.split(path.sep).join('/');
  };
  const out = [];
  const seen = new Set();
  for (const { scope, file } of files) {
    let hooks;
    try { hooks = JSON.parse(readGuarded(file, { maxBytes: MAX_FILE }).toString('utf8').replace(/^﻿/, ''))?.hooks; } catch { continue; }
    if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) continue;
    for (const [event, groups] of Object.entries(hooks)) {
      if (!Array.isArray(groups)) continue;
      // a group is { matcher, hooks: [{ type, command }] }; a bare { command } is accepted too
      for (const g of groups) {
        for (const h of Array.isArray(g?.hooks) ? g.hooks : [g]) {
          if (!h || typeof h.command !== 'string' || (h.type !== undefined && h.type !== 'command')) continue;
          const token = scriptToken(h.command);
          const abs = token && expandScript(token, { home, claudeHome });
          if (!abs || exists(abs)) continue;
          const key = `${scope}\0${event}\0${abs}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (out.length < MAX_LIST) out.push({ scope, event: event.slice(0, 40), path: shown(abs).slice(0, 200) });
        }
      }
    }
  }
  return out;
}
