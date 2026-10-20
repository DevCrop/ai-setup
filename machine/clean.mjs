#!/usr/bin/env node
// Confirmed cleaner: node machine/clean.mjs plan.json [--dry-run]
// The plan is untrusted. Actions come from the fixed tables below, never from plan text.
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolveCacheDir, CACHE_TOOLS } from './lib/caches.mjs';
import { isDenied, defaultEnv, norm, secretFile } from './lib/deny.mjs';

const W = path.win32;
export const CATEGORIES = ['temp', 'pkg-cache', 'dev-artifact', 'orphan-worktree', 'plugin-cache', 'appdata-orphan', 'recycle-bin', 'crash-dump', 'vm-disk', 'browser-cache', 'shader-cache', 'app-cache', 'system-cleanup', 'old-download'];
const REPORT = new Set(['recycle-bin', 'vm-disk', 'system-cleanup', 'old-download']);
const SAFETY = { safe: '삭제해도 됨', check: '확인 후 삭제', manual: '직접 판단' }; // display only, never used for decisions
const REPORT_TEXT = { 'system-cleanup': 'Windows 디스크 정리(cleanmgr) → 시스템 파일 정리 (관리자 권한 필요)', 'old-download': '다운로드 폴더는 보호됨 — 직접 확인 후 삭제하세요', 'recycle-bin': 'Windows에서 직접 휴지통을 비우세요', 'vm-disk': '직접 정리하세요' };
const APP_CACHE_DIRS = new Set(['cache', 'code cache', 'gpucache', 'cacheddata']);
const LABEL = { recycle: '휴지통 이동', run: '명령 실행', report: '보고만' };
const ADMIN_MSG = '관리자 권한 필요 — 건너뜀';
const DAY = 864e5;

// Fixed cleaner table: the tool's official cleaner (argv), or recycle the dir. Cache dirs come from lib/caches.mjs.
const CLEAN = {
  npm: ['npm', 'cache', 'clean', '--force'],
  pnpm: ['pnpm', 'store', 'prune'],
  yarn: ['yarn', 'cache', 'clean'],
  pip: ['pip', 'cache', 'purge'],
  uv: ['uv', 'cache', 'clean'],
  bun: ['bun', 'pm', 'cache', 'rm'],
  nuget: ['dotnet', 'nuget', 'locals', 'all', '--clear'],
  gradle: null, // recycle ~/.gradle/caches
};
const DEV_DIRS = new Set(['node_modules', '.venv', 'venv', 'dist', 'build', '.next', 'target']);
const BROWSER_DIRS = new Set(['cache', 'code cache', 'gpucache', 'cache2']);
const MARKERS = ['package.json', 'pyproject.toml', 'Cargo.toml', '.git'];
const SHIMS = new Set(['npm', 'pnpm', 'yarn']); // .cmd shims on Windows
const RUNNABLE = new Set([...SHIMS, 'pip', 'uv', 'bun', 'dotnet', 'git']);

// ---------- default (real) runners; tests inject fakes ----------

/** argv is always built from the fixed tables (plus validated absolute paths for `git -C`). */
export function defaultRun(argv, { timeout = 120000 } = {}) {
  return new Promise((resolve) => {
    const [bin, ...rest] = argv;
    if (!RUNNABLE.has(bin)) return resolve({ code: -1, stdout: '', stderr: 'not allowed' });
    const [cmd, args] = SHIMS.has(bin) ? ['cmd.exe', ['/d', '/s', '/c', bin, ...rest]] : [bin, rest];
    let out = '', err = '';
    const c = spawn(cmd, args, { shell: false, windowsHide: true, timeout, stdio: ['ignore', 'pipe', 'pipe'] });
    c.stdout.on('data', (d) => { if (out.length < 1e6) out += d; });
    c.stderr.on('data', (d) => { if (err.length < 1e6) err += d; });
    c.on('error', (e) => resolve({ code: -1, stdout: out, stderr: String(e.code || e.message) }));
    c.on('close', (code) => resolve({ code, stdout: out, stderr: err }));
  });
}

// Fixed script; paths arrive on stdin as lines "D|F <base64 utf8 path>", never inside the command line.
const PS_SCRIPT = String.raw`
Add-Type -AssemblyName Microsoft.VisualBasic
$lines = @([Console]::In.ReadToEnd() -split '\r?\n' | Where-Object { $_ })
$res = @()
for ($i = 0; $i -lt $lines.Count; $i++) {
  try {
    $kind, $b64 = $lines[$i] -split ' ', 2
    $p = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64))
    if ($kind -eq 'D') { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin') }
    else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin') }
    $res += @{ i = $i; ok = $true }
  } catch {
    $ex = $_.Exception
    if ($ex.InnerException) { $ex = $ex.InnerException }
    $res += @{ i = $i; ok = $false; e = $ex.GetType().Name }
  }
}
ConvertTo-Json -InputObject @($res) -Compress
`;

/** list: [{path, dir}] -> [{ok, e?}] in the same order. */
export async function defaultRecycle(list) {
  const out = [];
  for (let s = 0; s < list.length; s += 300) {
    const chunk = list.slice(s, s + 300);
    const payload = chunk.map(({ path: p, dir }) => `${dir ? 'D' : 'F'} ${Buffer.from(p).toString('base64')}`).join('\n');
    const enc = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');
    const r = await new Promise((resolve) => {
      let o = '';
      const c = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', enc], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
      c.stdout.on('data', (d) => { o += d; });
      c.on('error', () => resolve(null));
      c.on('close', () => resolve(o));
      c.stdin.on('error', () => {});
      c.stdin.end(payload);
    });
    let parsed = null;
    try { parsed = JSON.parse(r); } catch { /* runner failed */ }
    chunk.forEach((_, i) => out.push(parsed?.find((x) => x.i === i) ?? { ok: false, e: 'RunnerError' }));
  }
  return out;
}

async function defaultAsk(q) {
  if (!process.stdin.isTTY) return null; // no TTY, no answer: abort
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = await new Promise((r) => { rl.on('close', () => r(null)); rl.question(q, r); });
  rl.close();
  return a;
}

export function makeCtx(o = {}) {
  return {
    env: { ...defaultEnv(), ...o.env },
    now: o.now ?? Date.now(),
    probe: o.probe ?? defaultRun, // read-only commands (resolve cache dir, git queries)
    run: o.run ?? defaultRun, // mutating commands (official cleaners, git worktree remove/prune)
    recycle: o.recycle ?? defaultRecycle,
    ask: o.ask ?? defaultAsk,
    out: o.out ?? ((s) => console.log(s)),
  };
}

// ---------- 1. plan validation ----------

const printable = (s, n = 200) => String(s).replace(/[\u0000-\u001f\u007f]/g, '?').slice(0, n);

function checkShape(it) {
  if (!it || typeof it !== 'object' || Array.isArray(it)) return '항목이 객체가 아님';
  const { id, category, path: p, tool, size } = it;
  if (typeof id !== 'string' || !id || id.length > 700) return 'id가 문자열이 아님';
  if (typeof category !== 'string' || !CATEGORIES.includes(category)) return '알 수 없는 category';
  if (typeof p !== 'string' || p.length > 400) return 'path가 문자열이 아니거나 너무 김';
  if (!/^[A-Za-z]:[\\/]/.test(p)) return '절대 Windows 경로가 아님';
  if (/[<>"|?*\u0000-\u001f]/.test(p) || p.slice(2).includes(':')) return '경로에 허용되지 않는 문자';
  if (p.split(/[\\/]/).includes('..')) return "경로에 '..' 포함";
  if (category === 'pkg-cache' && !(typeof tool === 'string' && CACHE_TOOLS.includes(tool))) return '허용되지 않은 tool';
  if (size !== undefined && !(Number.isFinite(size) && size >= 0)) return 'size가 올바르지 않음';
  return null;
}

/** Throws on a malformed plan; bad items go to `rejected`, good ones to `items`. */
export function validatePlan(plan) {
  if (!plan || typeof plan !== 'object' || plan.version !== 1 || !Array.isArray(plan.items)) throw new Error('계획 형식이 올바르지 않음 (version 1, items 배열 필요)');
  if (plan.items.length > 5000) throw new Error('항목이 너무 많음 (최대 5000)');
  const items = [], rejected = [], seen = new Set();
  for (const it of plan.items) {
    let reason = checkShape(it);
    if (!reason) {
      const k = norm(it.path);
      if (seen.has(k)) reason = '중복 경로';
      seen.add(k);
    }
    if (reason) rejected.push({ id: printable(it?.id ?? '?', 80), path: printable(it?.path ?? '?'), reason });
    else items.push({ id: it.id, category: it.category, tool: it.tool, path: it.path, size: it.size, safety: Object.hasOwn(SAFETY, it.safety) ? it.safety : undefined });
  }
  return { items, rejected };
}

// ---------- 2. re-verification ----------

/** Own small du: logical size, newest mtime, first sensitive name, first `.git` dir. Does not follow links. */
export async function du(top, { scanSensitive = true } = {}) {
  const r = { size: 0, newest: 0, sensitive: null, gitDir: null, unreadable: 0 };
  const topSt = await fs.lstat(top);
  r.newest = topSt.mtimeMs;
  if (!topSt.isDirectory()) { r.size = topSt.size; return r; }
  const stack = [top];
  while (stack.length && !r.sensitive && !r.gitDir) {
    const dir = stack.pop();
    let ents;
    try { ents = await fs.readdir(dir, { withFileTypes: true }); } catch { r.unreadable++; continue; }
    await Promise.all(ents.map(async (e) => {
      const q = W.join(dir, e.name);
      if (scanSensitive && secretFile(e.name)) { r.sensitive ??= q; return; }
      if (e.isSymbolicLink()) return; // symlinks/junctions are skipped, not followed
      if (e.isDirectory()) {
        if (scanSensitive && e.name.toLowerCase() === '.git') r.gitDir ??= q;
        else stack.push(q);
        return;
      }
      try { const st = await fs.lstat(q); r.size += st.size; r.newest = Math.max(r.newest, st.mtimeMs); } catch { r.unreadable++; }
    }));
  }
  return r;
}

const no = (reason) => ({ ok: false, reason });
const errReason = (e) => (/EPERM|EACCES/.test(e.code) ? ADMIN_MSG : `확인 실패 (${e.code || e.message})`);
const exists = (p) => fs.access(p).then(() => true, () => false);
const isAbs = (s) => typeof s === 'string' && /^[a-z]:[\\/]/i.test(s);

function parseWorktrees(txt) {
  return txt.split(/\r?\n\r?\n/).map((b) => {
    const wt = /^worktree (.+)$/m.exec(b);
    return wt ? { path: wt[1].trim(), prunable: /^prunable\b/m.test(b) } : null;
  }).filter(Boolean);
}

async function defaultBranch(parent, ctx) {
  const g = (...a) => ctx.probe(['git', '-C', parent, ...a]);
  const s = await g('symbolic-ref', '--short', 'refs/remotes/origin/HEAD');
  const name = s.stdout?.trim();
  if (s.code === 0 && /^[\w./-]+$/.test(name) && !name.startsWith('-')) return name;
  for (const b of ['main', 'master']) if ((await g('rev-parse', '--verify', '--quiet', `refs/heads/${b}`)).code === 0) return b;
  return null;
}

async function planWorktree(p, ctx) {
  const gitEntry = W.join(p, '.git');
  const gst = await fs.lstat(gitEntry).catch(() => null);
  if (!gst) return { reject: '.git 없음 — 워크트리가 아님' };
  const git = (cwd, ...a) => ctx.probe(['git', '-C', cwd, ...a]);
  if (gst.isDirectory()) {
    // (c) repo root with prunable worktree entries -> git worktree prune
    const l = await git(p, 'worktree', 'list', '--porcelain');
    if (l.code !== 0 || !parseWorktrees(l.stdout).some((w) => w.prunable)) return { reject: 'prunable 워크트리 항목이 없음' };
    return { kind: 'run', argv: ['git', '-C', p, 'worktree', 'prune'], noDu: true };
  }
  if (!gst.isFile() || gst.size > 4096) return { reject: '.git 포인터 파일이 올바르지 않음' };
  const m = /^gitdir:\s*(.+)$/m.exec(await fs.readFile(gitEntry, 'utf8'));
  if (!m) return { reject: '.git 포인터 파일에 gitdir 줄이 없음' };
  const gitdir = W.resolve(p, m[1].trim());
  if (!(await exists(gitdir))) return { kind: 'recycle' }; // (a) gitdir missing
  const wtDir = W.dirname(gitdir), parentGit = W.dirname(wtDir), parent = W.dirname(parentGit);
  if (W.basename(wtDir).toLowerCase() !== 'worktrees' || W.basename(parentGit).toLowerCase() !== '.git') return { reject: '부모 저장소를 찾을 수 없음' };
  const l = await git(parent, 'worktree', 'list', '--porcelain');
  if (l.code !== 0) return { reject: '부모 저장소 git 확인 실패' };
  if (!parseWorktrees(l.stdout).some((w) => norm(w.path) === norm(p))) return { kind: 'recycle' }; // (a) not listed
  // (b) listed worktree: merged into the default branch, clean, outside the parent's .claude/worktrees
  if (norm(p).startsWith(norm(W.join(parent, '.claude', 'worktrees')) + '\\')) return { reject: '부모의 .claude/worktrees 안 — 건너뜀' };
  const head = (await git(p, 'rev-parse', 'HEAD')).stdout?.trim();
  if (!/^[0-9a-f]{40,64}$/.test(head || '')) return { reject: 'HEAD를 확인할 수 없음' };
  const def = await defaultBranch(parent, ctx);
  if (!def) return { reject: '기본 브랜치를 찾을 수 없음' };
  if ((await git(parent, 'merge-base', '--is-ancestor', head, def)).code !== 0) return { reject: `HEAD가 ${def}에 병합되지 않음` };
  const st = await git(p, 'status', '--porcelain');
  if (st.code !== 0 || st.stdout.trim() !== '') return { reject: '작업 트리가 깨끗하지 않음' };
  return { kind: 'run', argv: ['git', '-C', parent, 'worktree', 'remove', '--', p] };
}

function collectStrings(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => collectStrings(x, out));
  return out;
}

/** Category rules. Returns {reject} or {kind:'recycle'|'run'|'report', argv?}. */
async function planFor(item, p, st, ctx) {
  const { env } = ctx;
  const np = norm(p), base = W.basename(np), parent = norm(W.dirname(p));
  switch (item.category) {
    case 'pkg-cache': {
      const real = await resolveCacheDir(item.tool, { probe: ctx.probe, env });
      const dirs = real ? [norm(real), ...(item.tool === 'pnpm' ? [norm(W.dirname(real))] : [])] : [];
      if (!dirs.includes(np)) return { reject: `${item.tool}의 실제 캐시 경로와 다름` };
      return CLEAN[item.tool] ? { kind: 'run', argv: CLEAN[item.tool] } : { kind: 'recycle' };
    }
    case 'dev-artifact': {
      if (!st.isDirectory() || !DEV_DIRS.has(base)) return { reject: '개발 산출물 폴더가 아님' };
      for (const mk of MARKERS) if (await exists(W.join(W.dirname(p), mk))) return { kind: 'recycle' };
      return { reject: '상위에 프로젝트 파일(package.json 등)이 없음' };
    }
    case 'orphan-worktree': return planWorktree(p, ctx);
    case 'plugin-cache': {
      const root = norm(W.join(env.home, '.claude', 'plugins', 'cache'));
      if (!np.startsWith(root + '\\') || np.slice(root.length + 1).split('\\').length !== 3) return { reject: 'plugin 캐시 버전 폴더가 아님' };
      let refs;
      try { refs = collectStrings(JSON.parse(await fs.readFile(W.join(env.home, '.claude', 'plugins', 'installed_plugins.json'), 'utf8'))); }
      catch { return { reject: 'installed_plugins.json을 읽을 수 없음' }; }
      const used = refs.some((s) => isAbs(s) && (norm(s) === np || norm(s).startsWith(np + '\\') || np.startsWith(norm(s) + '\\')));
      return used ? { reject: '설치된 plugin이 참조 중' } : { kind: 'recycle' };
    }
    case 'appdata-orphan':
      if (!st.isDirectory() || ![env.appData, env.localAppData].filter(Boolean).map(norm).includes(parent)) return { reject: 'AppData 바로 아래 폴더가 아님' };
      return { kind: 'recycle' };
    case 'crash-dump': {
      const la = env.localAppData && norm(env.localAppData);
      if (!la || !np.startsWith(la + '\\') || !((st.isDirectory() && base === 'crashdumps') || (st.isFile() && base.endsWith('.dmp')))) return { reject: 'LOCALAPPDATA의 CrashDumps/*.dmp가 아님' };
      return { kind: 'recycle' };
    }
    case 'browser-cache':
      if (!st.isDirectory() || !BROWSER_DIRS.has(base) || ![env.appData, env.localAppData].filter(Boolean).map(norm).some((r) => np.startsWith(r + '\\'))) return { reject: '브라우저 캐시 폴더가 아님' };
      return { kind: 'recycle' };
    case 'recycle-bin':
      return base === '$recycle.bin' ? { kind: 'report' } : { reject: '$Recycle.Bin이 아님' };
    case 'vm-disk':
      return st.isFile() && /\.vhdx?$/.test(base) ? { kind: 'report' } : { reject: 'vhd/vhdx 파일이 아님' };
  }
  return { reject: '알 수 없는 category' };
}

/** Allowed roots for the "recycle children" categories. */
function childrenRootOk(category, p, env) {
  const np = norm(p), la = env.localAppData, ad = env.appData;
  if (category === 'temp') return [env.tmp, W.join(env.windir, 'Temp')].map(norm).includes(np);
  if (category === 'shader-cache') {
    return !!la && [['D3DSCache'], ['NVIDIA', 'DXCache'], ['NVIDIA', 'GLCache'], ['AMD', 'DxCache']].map((x) => norm(W.join(la, ...x))).includes(np);
  }
  if (la && [['Microsoft', 'Windows', 'INetCache'], ['Microsoft', 'Windows', 'WER']].map((x) => norm(W.join(la, ...x))).includes(np)) return true;
  if (!ad || !np.startsWith(norm(ad) + '\\')) return false;
  const rel = np.slice(norm(ad).length + 1).split('\\'); // <app>\{Cache,Code Cache,GPUCache,CachedData}
  return rel.length === 2 && APP_CACHE_DIRS.has(rel[1]);
}

async function verifyChildren(item, p, st, ctx) {
  const { env, now } = ctx;
  const temp = item.category === 'temp';
  if (!st.isDirectory() || !childrenRootOk(item.category, p, env)) return no(temp ? '임시 폴더가 아님' : '허용된 캐시 위치가 아님');
  if (!temp) { const d = isDenied(p, env); if (d.denied) return no(`거부: ${d.reason}`); } // temp roots are denied themselves; only children count
  let names;
  try { names = await fs.readdir(p, { withFileTypes: true }); } catch (e) { return no(errReason(e)); }
  const children = [];
  let skipped = 0, size = 0;
  const one = async (e) => {
    const cp = W.join(p, e.name);
    if (e.isSymbolicLink() || isDenied(cp, env).denied) return void skipped++;
    try {
      const u = await du(cp);
      if (u.sensitive || (u.gitDir && !(await env.isOrphanGit(cp))) || (temp && u.newest > now - DAY)) return void skipped++;
      children.push({ path: cp, dir: e.isDirectory(), size: u.size });
      size += u.size;
    } catch { skipped++; }
  };
  for (let i = 0; i < names.length; i += 16) await Promise.all(names.slice(i, i + 16).map(one));
  return { ok: true, entry: { item, category: item.category, action: 'recycle', kind: 'recycle', path: p, isDir: true, size, children, skipped, ageFilter: temp } };
}

/** Report-only categories are never executed, so a protected location (Windows, Downloads) may still be listed. */
async function reportOnly(item, p, st, ctx) {
  const { env } = ctx, np = norm(p), base = W.basename(np);
  const bad = (() => {
    switch (item.category) {
      case 'recycle-bin': return base === '$recycle.bin' ? null : '$Recycle.Bin이 아님';
      case 'vm-disk': return !st || (st.isFile() && /\.vhdx?$/.test(base)) ? null : 'vhd/vhdx 파일이 아님';
      case 'system-cleanup': {
        const w = env.windir;
        const ok = [['SoftwareDistribution', 'Download'], ['Logs', 'CBS'], ['ServiceProfiles', 'NetworkService', 'AppData', 'Local', 'Microsoft', 'Windows', 'DeliveryOptimization']].map((x) => norm(W.join(w, ...x)));
        return ok.includes(np) ? null : '허용된 Windows 정리 위치가 아님';
      }
      case 'old-download': return (!st || st.isFile()) && np.startsWith(norm(W.join(env.home, 'Downloads')) + '\\') ? null : '다운로드 폴더 안의 파일이 아님';
    }
    return '알 수 없는 category';
  })();
  if (bad) return no(bad);
  let size = null, unreadable = 0;
  if (st) { try { const u = await du(p, { scanSensitive: false }); size = u.size; unreadable = u.unreadable; } catch { /* size unknown */ } }
  return { ok: true, entry: { item, category: item.category, action: 'report', kind: 'report', path: p, isDir: !!st?.isDirectory(), size, unreadable } };
}

/** @returns {{ok:true, entry}|{ok:false, reason}} */
export async function verifyItem(item, ctx) {
  const { env } = ctx;
  const p = W.normalize(item.path);
  const report = REPORT.has(item.category);
  let st;
  try { st = await fs.lstat(p); } catch (e) {
    if (e.code === 'ENOENT') return no('경로가 없음');
    if (!report || !/EPERM|EACCES/.test(e.code)) return no(errReason(e));
    st = null; // report-only item we may not read: still listed, size unknown
  }
  if (!st) return reportOnly(item, p, null, ctx);
  if (st.isSymbolicLink()) return no('심볼릭 링크/정션은 대상이 될 수 없음');
  try {
    if (norm(await fs.realpath(p)) !== norm(p)) return no('실제 경로와 다름 (링크 또는 8.3 단축 이름)');
  } catch (e) { if (!report) return no(errReason(e)); }
  if (['temp', 'shader-cache', 'app-cache'].includes(item.category)) return verifyChildren(item, p, st, ctx);
  if (report) return reportOnly(item, p, st, ctx);
  const d = isDenied(p, env);
  if (d.denied) return no(`거부: ${d.reason}`);
  const plan = await planFor(item, p, st, ctx);
  if (plan.reject) return no(plan.reject);
  const entry = { item, category: item.category, action: plan.kind, kind: plan.kind, path: p, isDir: st.isDirectory(), size: null, argv: plan.argv, unreadable: 0 };
  if (plan.noDu) return { ok: true, entry };
  let u;
  try { u = await du(p); } catch (e) { return no(errReason(e)); }
  if (u.sensitive) return no(`거부: 민감 파일 포함 (${W.relative(p, u.sensitive)})`);
  if (u.gitDir && !(await env.isOrphanGit(p))) return no('거부: .git 폴더 포함');
  entry.size = u.size;
  entry.unreadable = u.unreadable;
  return { ok: true, entry };
}

// ---------- 3. listing ----------

export function fmtSize(n) {
  if (n == null) return '크기 알 수 없음';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < 4) { n /= 1024; i++; }
  return `${i ? n.toFixed(1) : n} ${u[i]}`;
}

export function printList(entries, rejected, out) {
  out('정리 계획 (재검증 결과)');
  let total = 0;
  const cnt = { recycle: 0, run: 0, report: 0 };
  for (const e of entries) {
    cnt[e.action]++;
    if (e.action !== 'report') total += e.size ?? 0;
    const extra = e.argv ? `  → ${e.argv.join(' ')}`
      : e.children ? `  (하위 ${e.children.length}개${e.ageFilter ? ', 1일 이상 지난 것만' : ''}; 건너뜀 ${e.skipped})`
      : e.action === 'report' ? `  (${REPORT_TEXT[e.category]})` : '';
    out(`[${LABEL[e.action]}] [${SAFETY[e.item.safety] ?? SAFETY.manual}] ${fmtSize(e.size).padStart(10)}  ${e.path}  <${e.category}>${extra}`);
  }
  if (rejected.length) out('거부/제외된 항목:');
  for (const r of rejected) out(`[거부] ${r.path}  — ${r.reason}`);
  out(`합계: 휴지통 ${cnt.recycle}개 / 명령 ${cnt.run}개 / 보고만 ${cnt.report}개, 약 ${fmtSize(total)}, 거부 ${rejected.length}개`);
}

// ---------- 5. execution ----------

const classify = (e = '') => (/Unauthorized|Security|EPERM|EACCES|denied/i.test(e) ? ADMIN_MSG : /IOException|Sharing|locked/i.test(e) ? '사용 중 — 건너뜀' : null);

export async function execute(entries, ctx) {
  const res = { done: 0, skipped: 0, failed: 0, bytes: 0 };
  const tally = (r, p, size) => {
    if (r?.ok) { res.done++; res.bytes += size ?? 0; return; }
    const why = classify(r?.e);
    why ? res.skipped++ : res.failed++;
    ctx.out(`  - ${p}: ${why ?? `실패 (${printable(r?.e ?? '알 수 없음', 60)})`}`);
  };
  for (const e of entries) {
    if (e.action === 'report') continue; // never executed
    if (e.kind === 'recycle') {
      const list = e.children ?? [{ path: e.path, dir: e.isDir }];
      const rs = await ctx.recycle(list.map(({ path: p, dir }) => ({ path: p, dir })));
      list.forEach((c, i) => tally(rs?.[i], c.path, c.size ?? e.size));
    } else if (e.kind === 'run') {
      const r = await ctx.run(e.argv);
      if (r.code === 0) { res.done++; res.bytes += e.size ?? 0; continue; }
      const why = classify(`${r.stderr}${r.stdout}`);
      why ? res.skipped++ : res.failed++;
      ctx.out(`  - ${e.argv.join(' ')}: ${why ?? `실패 (종료 코드 ${r.code})`}`);
    }
  }
  ctx.out(`요약: 완료 ${res.done}, 건너뜀 ${res.skipped}, 실패 ${res.failed}, 약 ${fmtSize(res.bytes)} 정리`);
  return res;
}

// ---------- main ----------

export async function main(argv, ctxIn = {}) {
  const ctx = makeCtx(ctxIn);
  const dry = argv.includes('--dry-run');
  const rest = argv.filter((a) => a !== '--dry-run');
  if (rest.length !== 1 || rest[0].startsWith('--')) { ctx.out('사용법: node machine/clean.mjs plan.json [--dry-run]'); return 2; }
  let plan;
  try {
    const f = await fs.stat(rest[0]);
    if (f.size > 5e6) throw new Error('계획 파일이 너무 큼');
    plan = JSON.parse(await fs.readFile(rest[0], 'utf8'));
  } catch (e) { ctx.out(`계획 파일을 읽을 수 없음: ${printable(e.message, 100)}`); return 2; }
  let v;
  try { v = validatePlan(plan); } catch (e) { ctx.out(e.message); return 2; }
  const entries = [], rejected = [...v.rejected];
  for (const it of v.items) {
    const r = await verifyItem(it, ctx);
    if (r.ok) entries.push(r.entry); else rejected.push({ id: printable(it.id, 80), path: printable(it.path), reason: r.reason });
  }
  printList(entries, rejected, ctx.out);
  if (dry) { ctx.out('--dry-run: 아무것도 변경하지 않았습니다.'); return 0; }
  if (!entries.some((e) => e.action !== 'report')) { ctx.out('실행할 항목이 없습니다.'); return 0; }
  const ans = await ctx.ask('위 항목을 실행합니다. 계속하려면 y 를 입력하세요: ');
  if (typeof ans !== 'string' || ans.trim().toLowerCase() !== 'y') { ctx.out('취소했습니다. 아무것도 변경하지 않았습니다.'); return 1; }
  const res = await execute(entries, ctx);
  return res.failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
