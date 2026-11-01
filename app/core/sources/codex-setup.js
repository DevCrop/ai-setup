// TRACE Setup (repo DevCrop/codex-setup) owns the Codex setup; ai-setup owns the Claude one. The app reports both and edits neither.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readGuarded } from '../guard.js';

const MAX_RECEIPT = 4 << 20;

// Same place as default_state() in codex-setup's scripts/setup.py.
export function traceStateDir(home, { env = process.env, platform = process.platform, homedir = os.homedir() } = {}) {
  const base = platform === 'win32' ? (env.LOCALAPPDATA || path.join(homedir, 'AppData', 'Local'))
    : platform === 'darwin' ? path.join(homedir, 'Library', 'Application Support')
      : (env.XDG_STATE_HOME || path.join(homedir, '.local', 'state'));
  return path.join(base, 'TRACE-Setup', crypto.createHash('sha256').update(path.resolve(home)).digest('hex').slice(0, 16));
}

const text = (v) => (typeof v === 'string' && v.length <= 80 ? v : null);

function receipt(file, codexHome) {
  try { return JSON.parse(readGuarded(file, { codexHome, maxBytes: MAX_RECEIPT }).toString('utf8')); } catch { return null; }
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
  const accepted = receipt(path.join(part, 'acceptance.json'), home);
  return {
    found: true,
    version: text(installed.version),
    appliedAt: text(installed.applied_at),
    recordedVersion: text(routine?.current_deployment?.version),
    verifiedAt: text(routine?.last_verification?.checked_at),
    softwareStatus: text(routine?.software_updates?.status),
    agentDesktop: component ? { version: text(component.version), runtimeVersion: text(runtime?.version), acceptedAt: text(accepted?.completed_at) } : null,
  };
}

// The shared install Claude uses, found without running it: a global npm shim on PATH and the package beside it.
export function readSharedAgentDesktop({ env = process.env, platform = process.platform, homedir = os.homedir() } = {}) {
  const names = platform === 'win32' ? ['agent-desktop.cmd', 'agent-desktop.exe'] : ['agent-desktop'];
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  const bin = dirs.find((d) => names.some((n) => fs.existsSync(path.join(d, n))));
  const state = path.resolve(env.AGENT_DESKTOP_HOME || path.join(homedir, '.agent-desktop'));
  const rel = path.relative(path.resolve(homedir), state);
  const stateInProfile = !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  if (!bin) return { installed: false, version: null, stateInProfile };
  let version = null;
  try { version = text(JSON.parse(fs.readFileSync(path.join(bin, 'node_modules', 'agent-desktop', 'package.json'), 'utf8')).version); } catch { /* another install layout: unknown, not a failure */ }
  return { installed: true, version, stateInProfile };
}
