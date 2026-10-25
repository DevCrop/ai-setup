// Line-based reader for ~/.codex/config.toml: functions only, no TOML grammar.
// shortcut: inline tables, dotted keys on one line and multi-line strings inside arrays are not read; upgrade to a TOML library only if a check needs nested values.
import { SECRET_KEY_RE } from './guard.js';

const ALLOWED_TOP = ['model', 'model_reasoning_effort', 'approval_policy', 'sandbox_mode'];
// Detail settings: read by key name from the top level or the first table that has the key (not from tables that hold secrets or env).
const SETTING_KEYS = [...ALLOWED_TOP, 'service_tier', 'approvals_reviewer', 'default_subagent_model', 'default_subagent_reasoning_effort', 'max_concurrent_threads_per_session', 'mcp_optional_startup_grace_ms'];
const NO_SETTINGS = new Set(['mcp_servers', 'shell_environment_policy', 'projects', 'hooks', 'plugins', 'marketplaces', 'apps', 'computer_use']);
const eol = (l) => l.replace(/\r?\n$/, '');
export const splitLines = (text) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];

// `[a.'b c'."d"]` -> ['a', 'b c', 'd']; null when the line is not a table header.
export function parseHeader(line) {
  const t = line.trim();
  const arr = t.startsWith('[[');
  let i = arr ? 2 : 1;
  const parts = [];
  for (;;) {
    while (t[i] === ' ' || t[i] === '\t') i++;
    let part = '';
    if (t[i] === '"') {
      i++;
      while (i < t.length && t[i] !== '"') {
        if (t[i] === '\\' && i + 1 < t.length) { i++; part += t[i] === 'n' ? '\n' : t[i] === 't' ? '\t' : t[i]; } else part += t[i];
        i++;
      }
      if (t[i] !== '"') return null;
      i++;
    } else if (t[i] === "'") {
      const j = t.indexOf("'", i + 1);
      if (j < 0) return null;
      part = t.slice(i + 1, j);
      i = j + 1;
    } else {
      const m = /^[A-Za-z0-9_-]+/.exec(t.slice(i));
      if (!m) return null;
      part = m[0];
      i += part.length;
    }
    parts.push(part);
    while (t[i] === ' ' || t[i] === '\t') i++;
    if (t[i] === '.') { i++; continue; }
    if (t.slice(i, i + (arr ? 2 : 1)) !== (arr ? ']]' : ']')) return null;
    const rest = t.slice(i + (arr ? 2 : 1)).trim();
    return rest === '' || rest.startsWith('#') ? parts : null;
  }
}

// Index of the last line of the value that starts on line `start` with text `rest`; skips strings, comments and nested brackets.
function valueEnd(lines, start, rest) {
  let depth = 0;
  let ml = null;
  let i = start;
  let s = rest;
  for (;;) {
    for (let p = 0; p < s.length; p++) {
      const c = s[p];
      if (ml) {
        if (ml === '"""' && c === '\\') p++;
        else if (s.startsWith(ml, p)) { ml = null; p += 2; }
      } else if (s.startsWith('"""', p) || s.startsWith("'''", p)) { ml = s.slice(p, p + 3); p += 2; }
      else if (c === '"') { for (p++; p < s.length && s[p] !== '"'; p++) if (s[p] === '\\') p++; }
      else if (c === "'") { p = s.indexOf("'", p + 1); if (p < 0) break; }
      else if (c === '#') break;
      else if (c === '[' || c === '{') depth++;
      else if (c === ']' || c === '}') depth--;
    }
    if (!ml && depth <= 0) return i;
    i++;
    if (i >= lines.length) return lines.length - 1;
    s = eol(lines[i]);
  }
}

// Tables in file order; tables[0] is the top level (parts []). Keys carry their line range and first-line value text.
export function scan(text) {
  const lines = splitLines(text);
  const top = { parts: [], array: false, header: -1, keys: [] };
  const tables = [top];
  let cur = top;
  for (let i = 0; i < lines.length; i++) {
    const t = eol(lines[i]).trim();
    if (t === '' || t.startsWith('#')) continue;
    if (t.startsWith('[')) {
      const parts = parseHeader(t);
      if (!parts) continue;
      cur = { parts, array: t.startsWith('[['), header: i, keys: [] };
      tables.push(cur);
      continue;
    }
    const m = /^("[^"]*"|'[^']*'|[A-Za-z0-9_.-]+)\s*=\s*(.*)$/.exec(t);
    if (!m) continue;
    const end = valueEnd(lines, i, m[2]);
    cur.keys.push({ name: m[1].replace(/^["']|["']$/g, ''), value: m[2].trim(), start: i, end });
    i = end;
  }
  return { lines, tables };
}

// A string or boolean literal on one line, else null.
export function scalar(v) {
  if (typeof v !== 'string') return null;
  let m = /^"((?:[^"\\]|\\.)*)"/.exec(v);
  if (m && !v.startsWith('"""')) return m[1].replace(/\\(.)/g, '$1');
  m = /^'([^']*)'/.exec(v);
  if (m && !v.startsWith("'''")) return m[1];
  if (/^true\b/.test(v)) return true;
  if (/^false\b/.test(v)) return false;
  return null;
}

const NUM_RE = /^-?\d[\d_]*(?:\.\d+)?(?=\s|#|,|$)/;
// A string, boolean or number literal on one line, else null.
export function scalarOrNumber(v) {
  const s = scalar(v);
  if (s !== null) return s;
  const m = typeof v === 'string' ? NUM_RE.exec(v) : null;
  return m ? Number(m[0].replace(/_/g, '')) : null;
}

// Value of an allowlisted key; never a value whose key name matches the secret pattern.
const valueOf = (table, name) => {
  if (SECRET_KEY_RE.test(name)) return null;
  const k = table.keys.find((x) => x.name === name);
  return k ? scalar(k.value) : null;
};
const str = (v) => (typeof v === 'string' ? v.slice(0, 80) : null);

const has = (table, name) => table.keys.some((x) => x.name === name);
const num = (table, name) => { const v = scalarOrNumber(table.keys.find((x) => x.name === name)?.value); return typeof v === 'number' ? v : null; };
const cut = (s) => String(s).slice(0, 120);

// Allowlist: the SETTING_KEYS, trust_level in projects tables, and per plugins / mcp_servers / hooks.state table only
// the names and flags below. Values of env tables, args, urls and trusted_hash are never read.
// A plugin, MCP server or hook is enabled unless `enabled = false` (the Codex default).
export function readConfig(text) {
  const { tables } = scan(text);
  const out = {
    model: null, reasoningEffort: null, approval: null, sandbox: null, settings: [], projects: [],
    plugins: { total: 0, enabled: 0 }, mcpServers: { total: 0, enabled: 0 }, pluginList: [], mcpList: [], hookList: [],
  };
  const top = tables[0];
  [out.model, out.reasoningEffort, out.approval, out.sandbox] = ALLOWED_TOP.map((n) => str(valueOf(top, n)));
  for (const key of SETTING_KEYS) {
    const t = tables.find((x) => !x.array && !NO_SETTINGS.has(x.parts[0]) && has(x, key));
    const v = t ? valueOf(t, key) ?? num(t, key) : null;
    if (v !== null) out.settings.push({ key, value: typeof v === 'string' ? v.slice(0, 80) : v });
  }
  const mcp = new Map();
  const server = (name) => { if (!mcp.has(name)) mcp.set(name, { name: cut(name), enabled: true, transport: null, hasEnv: false, startupTimeoutSec: null, toolTimeoutSec: null }); return mcp.get(name); };
  for (const t of tables.slice(1)) {
    if (t.array) continue;
    const [kind, name, sub] = t.parts;
    if (t.parts.length === 3 && kind === 'mcp_servers' && sub === 'env') { server(name).hasEnv = true; continue; }
    if (t.parts.length === 3 && kind === 'hooks' && name === 'state') { out.hookList.push({ key: cut(sub), enabled: valueOf(t, 'enabled') !== false }); continue; }
    if (t.parts.length !== 2) continue;
    if (kind === 'projects') out.projects.push({ path: name, trustLevel: str(valueOf(t, 'trust_level')) });
    else if (kind === 'plugins') {
      const i = name.lastIndexOf('@');
      out.pluginList.push({ name: cut(i > 0 ? name.slice(0, i) : name), marketplace: i > 0 ? cut(name.slice(i + 1)) : null, enabled: valueOf(t, 'enabled') !== false });
    } else if (kind === 'mcp_servers') {
      Object.assign(server(name), {
        declared: true, enabled: valueOf(t, 'enabled') !== false, transport: has(t, 'command') ? 'command' : has(t, 'url') ? 'url' : null,
        startupTimeoutSec: num(t, 'startup_timeout_sec'), toolTimeoutSec: num(t, 'tool_timeout_sec'),
      });
      if (has(t, 'env') || has(t, 'env_vars')) server(name).hasEnv = true;
    }
  }
  out.mcpList = [...mcp.values()].filter((s) => s.declared).map(({ declared, ...s }) => s); // an env table without its server table is not a server
  out.plugins = { total: out.pluginList.length, enabled: out.pluginList.filter((p) => p.enabled).length };
  out.mcpServers = { total: out.mcpList.length, enabled: out.mcpList.filter((s) => s.enabled).length };
  return out;
}

// Removes exactly one table (all header parts must match): header line plus its key lines (up to the last key line); trailing blank lines stay.
// Returns { text, removed } where `removed` are the lines with secret-looking values masked, or null when the table is not there.
export function removeTable(text, parts) {
  const { lines, tables } = scan(text);
  const t = tables.find((x) => !x.array && x.parts.length === parts.length && x.parts.every((p, i) => p === parts[i]));
  if (!t) return null;
  const last = t.keys.length ? t.keys[t.keys.length - 1].end : t.header;
  const removed = [];
  for (let i = t.header; i <= last; i++) {
    const k = t.keys.find((x) => i >= x.start && i <= x.end);
    if (k && SECRET_KEY_RE.test(k.name)) { if (i === k.start) removed.push(`${k.name} = ***`); } else removed.push(eol(lines[i]));
  }
  // block: the raw table text, only ever hashed (it can hold secret values)
  return { text: [...lines.slice(0, t.header), ...lines.slice(last + 1)].join(''), removed, block: lines.slice(t.header, last + 1).join('') };
}

export const removeProjectTable = (text, projectPath) => removeTable(text, ['projects', projectPath]);
