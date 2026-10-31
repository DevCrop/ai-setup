// IPC trust boundary: role check, payload validation, result envelope. No `electron` import,
// so CI tests it with a fake ipcMain (docs/api-claude-monitor.md section 1).

import { MESSAGES } from '../core/errors.js';
import { IDLE_SECS, LIVE_SECS, THEMES } from '../core/settings-store.js';

export const TABS = ['ov', 'flow', 'orch', 'route', 'tok', 'sav', 'set', 'codex', 'rt', 'opt'];

const FINDING_ID = /^[CXU][0-9]{1,2}:[A-Za-z0-9._-]{1,64}$/;
const PREVIEW_ID = /^[0-9a-f]{64}$/;
const HHMM = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;

// Fixed texts live in core/errors.js so core and the IPC boundary never drift apart.


const str = (re, min, max) => (v) => typeof v === 'string' && v.length >= min && v.length <= max && re.test(v);
const FIELDS = {
  findingId: str(FINDING_ID, 3, 80),
  previewId: str(PREVIEW_ID, 64, 64),
  tab: (v) => TABS.includes(v),
  notify: (v) => typeof v === 'boolean',
  updateCheck: (v) => typeof v === 'boolean',
  autoUpdate: (v) => typeof v === 'boolean',
  theme: (v) => THEMES.includes(v),
  quietStart: (v) => v === '' || str(HHMM, 5, 5)(v),
  quietEnd: (v) => v === '' || str(HHMM, 5, 5)(v),
  liveSec: (v) => LIVE_SECS.includes(v),
  idleSec: (v) => IDLE_SECS.includes(v),
  // shape only here; SettingsStore checks that the folder exists and looks like that home
  claudeHome: (v) => v === '' || (typeof v === 'string' && v.length <= 400 && !/[\0\r\n]/.test(v)),
  codexHome: (v) => v === '' || (typeof v === 'string' && v.length <= 400 && !/[\0\r\n]/.test(v)),
};

// channel -> { roles, keys (required), optional, none: payload must be absent }
export const CHANNELS = {
  'status:get': { roles: ['strip', 'main'], none: true },
  'app:open-main': { roles: ['strip', 'main'], optional: ['tab'] },
  'app:refresh': { roles: ['strip', 'main'], none: true },
  'app:quit': { roles: ['strip', 'main'], none: true },
  'app:strip-menu': { roles: ['strip'], none: true },
  'view:html': { roles: ['main'], none: true },
  'findings:list': { roles: ['main'], none: true },
  'codex:detail': { roles: ['main'], none: true },
  'routines:detail': { roles: ['main'], none: true },
  'history:list': { roles: ['main'], none: true },
  'app:copy-summary': { roles: ['strip', 'main'], none: true },
  'fix:preview': { roles: ['main'], keys: ['findingId'] },
  'fix:apply': { roles: ['main'], keys: ['findingId', 'previewId'] },
  'fix:restore': { roles: ['main'], keys: ['findingId'] },
  'settings:get': { roles: ['main'], none: true },
  'settings:set': { roles: ['main'], optional: ['notify', 'quietStart', 'quietEnd', 'updateCheck', 'autoUpdate', 'theme', 'liveSec', 'idleSec', 'claudeHome', 'codexHome'] },
};

export function fail(code, detail) {
  const c = MESSAGES[code] ? code : 'INTERNAL';
  const error = { code: c, message: MESSAGES[c] };
  if (detail !== undefined && c === 'APPLY_FAILED') error.detail = String(detail).slice(-400);
  return { ok: false, error };
}

export function validPayload(spec, payload) {
  if (spec.none) return payload === undefined;
  const required = spec.keys ?? [];
  const allowed = [...required, ...(spec.optional ?? [])];
  if (payload === undefined) return required.length === 0;
  if (payload === null || typeof payload !== 'object' || Object.getPrototypeOf(payload) !== Object.prototype) return false;
  let size;
  try { size = JSON.stringify(payload).length; } catch { return false; }
  if (size > 1024) return false;
  const keys = Object.keys(payload);
  if (keys.some((k) => !allowed.includes(k))) return false;
  if (required.some((k) => !(k in payload))) return false;
  return keys.every((k) => FIELDS[k](payload[k]));
}

export class IpcRouter {
  // senderRole(event) -> 'strip' | 'main' | null (checks sender id and frame url); log(line) gets key=value text only.
  constructor({ ipcMain, senderRole, handlers, log = () => {} }) {
    this.ipcMain = ipcMain;
    this.senderRole = senderRole;
    this.handlers = handlers;
    this.log = log;
  }

  register() {
    for (const channel of Object.keys(CHANNELS)) {
      this.ipcMain.handle(channel, (event, payload) => this.dispatch(channel, event, payload));
    }
  }

  async dispatch(channel, event, payload) {
    const spec = CHANNELS[channel];
    let role = null;
    try { role = this.senderRole(event); } catch { role = null; }
    if (!spec || !spec.roles.includes(role)) return fail('FORBIDDEN');
    if (!validPayload(spec, payload)) return fail('BAD_REQUEST');
    const handler = this.handlers[channel];
    if (!handler) return fail('INTERNAL');
    try {
      return { ok: true, data: await handler(payload ?? {}, role) };
    } catch (err) {
      const code = err && MESSAGES[err.code] ? err.code : 'INTERNAL';
      this.log(`ipc channel=${channel} code=${code}`);
      return fail(code, err?.detail);
    }
  }
}
