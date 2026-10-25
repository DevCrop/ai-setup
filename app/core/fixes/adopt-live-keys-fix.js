import { createHash } from 'node:crypto';
import path from 'node:path';
import { writeAtomic } from '../../../scripts/monitor.mjs';
import { CoreError } from '../errors.js';
import { Fix } from '../fix.js';
import { SECRET_KEY_RE, readGuarded } from '../guard.js';

// Top-level keys of the live settings.json that are never copied into the repo and never read as values,
// on top of every key that matches SECRET_KEY_RE (guard.js): they hold secrets, tokens or commands that print them.
export const ADOPT_EXCLUDED_KEYS = Object.freeze(['env', 'apiKeyHelper', 'awsAuthRefresh', 'awsCredentialExport', 'otelHeadersHelper']);

const MAX_BYTES = 1 << 20;
const MAX_KEY = 80;
const sha = (b) => createHash('sha256').update(b).digest('hex');
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const barred = (k) => SECRET_KEY_RE.test(k) || ADOPT_EXCLUDED_KEYS.some((x) => x.toLowerCase() === k.toLowerCase());
// A key whose value holds a barred key name at any depth (mcpServers.x.env, headers.apiKey) is barred as a whole.
// A string that assigns a secret-looking name (--token=abc, apiKey: abc) or carries a bearer token bars its key too.
const SECRET_VALUE_RE = /(?:key|token|secret|password|passwd|credential)[\w.-]*["']?\s*[=:]\s*["']?[^\s"']{4,}|bearer\s+[A-Za-z0-9._~+/=-]{8,}/i;
const tainted = (v) => {
  if (typeof v === 'string') return SECRET_VALUE_RE.test(v);
  if (Array.isArray(v)) return v.some(tainted);
  return isObj(v) && Object.entries(v).some(([k, x]) => barred(k) || tainted(x));
};

// Which live-only top-level keys can be copied. Only key names of barred keys are looked at; their values are never touched.
export function planAdoption(live, repo) {
  const adopt = [];
  const excluded = [];
  for (const k of Object.keys(live)) {
    if (Object.hasOwn(repo, k) || k.length > MAX_KEY || k === '__proto__') continue;
    (barred(k) || tainted(live[k]) ? excluded : adopt).push(k);
  }
  return { adopt, excluded };
}

const parseObject = (buf) => {
  const text = buf.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(buf)) throw new Error('settings.json is not valid UTF-8');
  const j = JSON.parse(text.replace(/^﻿/, ''));
  if (!isObj(j)) throw new Error('settings.json is not an object');
  return { text, obj: j };
};

// C4: appends live-only top-level keys to the REPO claude/settings.json. The live file is only read (through readGuarded);
// nothing under the Claude home is written and apply.sh is not run (C1 shows the drift afterwards and the user applies it).
export class AdoptLiveKeysFix extends Fix {
  #repoFile;
  #liveFile;
  #old = null; // bytes of the repo file before apply, kept in memory for restore
  #appliedHash = null;

  constructor({ id, repo, claudeHome }) {
    super(id);
    this.#repoFile = path.join(repo, 'claude', 'settings.json');
    this.#liveFile = path.join(claudeHome, 'settings.json');
    if (path.resolve(this.#repoFile).toLowerCase() === path.resolve(this.#liveFile).toLowerCase()) throw new TypeError('repo and Claude home must differ');
  }

  get restorable() { return true; }

  #plan() {
    const liveBuf = readGuarded(this.#liveFile, { maxBytes: MAX_BYTES });
    const repoBuf = readGuarded(this.#repoFile, { maxBytes: MAX_BYTES });
    const live = parseObject(liveBuf).obj;
    const { text, obj: repo } = parseObject(repoBuf);
    const { adopt } = planAdoption(live, repo);
    if (!adopt.length) throw new Error('nothing to adopt');
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const added = adopt.map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(live[k], null, 2).split('\n').join(`${eol}  `)}`);
    const end = text.lastIndexOf('}');
    const head = text.slice(0, end).trimEnd();
    const hasKeys = Object.keys(repo).length > 0;
    const next = `${head}${hasKeys ? ',' : ''}${eol}${added.join(`,${eol}`)}${eol}${text.slice(end)}`;
    const check = JSON.parse(next.replace(/^﻿/, ''));
    if (Object.keys(check).join('\u0000') !== [...Object.keys(repo), ...adopt].join('\u0000')) throw new Error('result does not match the plan');
    const last = head.split(/\r?\n/).pop();
    const addedLines = added.flatMap((a, i) => `${a}${i < added.length - 1 ? ',' : ''}`.split(/\r?\n/)).map((l) => `+${l}`);
    const diff = ['--- claude/settings.json', '+++ claude/settings.json', ...(hasKeys ? [`-${last}`, `+${last},`] : []), ...addedLines].join('\n');
    return { repoBuf, text: next, diff, previewId: sha(`${sha(liveBuf)}:${sha(repoBuf)}`) };
  }

  doPreview() {
    const p = this.#plan();
    return { diff: p.diff, previewId: p.previewId };
  }

  doApply(previewId) {
    const p = this.#plan(); // narrows the window between Fix.apply's check and the write
    if (p.previewId !== previewId) throw new Error('settings changed');
    this.#old = p.repoBuf;
    writeAtomic(this.#repoFile, p.text);
    this.#appliedHash = sha(Buffer.from(p.text, 'utf8'));
    return {};
  }

  checkRestore() {
    if (sha(readGuarded(this.#repoFile, { maxBytes: MAX_BYTES })) !== this.#appliedHash) throw new CoreError('RESTORE_CONFLICT');
  }

  doRestore() {
    if (!this.#old) throw new Error('no previous bytes recorded');
    writeAtomic(this.#repoFile, this.#old);
  }
}
