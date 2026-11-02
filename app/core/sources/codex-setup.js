// TRACE Setup (repo DevCrop/codex-setup) owns the Codex setup; ai-setup owns the Claude one. The app reports both and edits neither.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readGuarded } from '../guard.js';

const MAX_RECEIPT = 4 << 20;

// Same place as default_state() in codex-setup's scripts/setup.py.
// shortcut: path.resolve folds '..' and Python's absolute() keeps it, so a CODEX_HOME written with '..' reads as not found; normalize like Python if that ever occurs.
export function traceStateDir(home, { env = process.env, platform = process.platform, homedir = os.homedir() } = {}) {
  const base = platform === 'win32' ? (env.LOCALAPPDATA || path.join(homedir, 'AppData', 'Local'))
    : platform === 'darwin' ? path.join(homedir, 'Library', 'Application Support')
      : (env.XDG_STATE_HOME || path.join(homedir, '.local', 'state'));
  return path.join(base, 'TRACE-Setup', crypto.createHash('sha256').update(path.resolve(home)).digest('hex').slice(0, 16));
}

const text = (v) => (typeof v === 'string' && v.length <= 80 ? v : null);

function receipt(file, codexHome) {
  try {
    const v = JSON.parse(readGuarded(file, { codexHome, maxBytes: MAX_RECEIPT }).toString('utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch { return null; }
}

// Allow-listed fields only: installed.json also carries a copy of the original config, and routine-review.json free text.
export function readCodexSetup(home, opts = {}) {
  const dir = traceStateDir(home, opts);
  const installed = receipt(path.join(dir, 'installed.json'), home);
  if (!installed) return { found: false };
  const routine = receipt(path.join(dir, 'routine-review.json'), home);
  const part = path.join(dir, 'components', 'agent-desktop');
  const component = receipt(path.join(part, 'installed.json'), home);
  const runtime = receipt(path.join(part, 'runtime.json'), home);
  return {
    found: true,
    version: text(installed.version),
    verifiedAt: text(routine?.last_verification?.checked_at),
    softwareStatus: text(routine?.software_updates?.status),
    agentDesktop: component ? { version: text(component.version), runtimeVersion: text(runtime?.version) } : null,
  };
}

// The shared install Claude uses, found without running it: a global npm shim on PATH and the package beside it.
export function readSharedAgentDesktop({ env = process.env, platform = process.platform, homedir = os.homedir() } = {}) {
  const names = platform === 'win32' ? ['agent-desktop.cmd', 'agent-desktop.exe'] : ['agent-desktop'];
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).map((d) => d.replace(/^"|"$/g, '')).filter(Boolean);
  const isFile = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } };
  const bin = dirs.find((d) => names.some((n) => isFile(path.join(d, n))));
  const state = path.resolve(env.AGENT_DESKTOP_HOME || path.join(homedir, '.agent-desktop'));
  const rel = path.relative(path.resolve(homedir), state);
  // Windows only: the clash is with Codex's sandbox users there (docs/agent-desktop.md).
  const stateInProfile = platform === 'win32' && !rel.startsWith('..') && !path.isAbsolute(rel);
  if (!bin) return { installed: false, version: null, stateInProfile };
  let version = null;
  for (const root of [path.join(bin, 'node_modules'), path.join(bin, '..', 'lib', 'node_modules')]) {
    try { version = text(JSON.parse(fs.readFileSync(path.join(root, 'agent-desktop', 'package.json'), 'utf8')).version); break; } catch { /* another install layout: unknown, not a failure */ }
  }
  return { installed: true, version, stateInProfile };
}
