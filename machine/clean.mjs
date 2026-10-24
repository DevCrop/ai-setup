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
import { APPDATA_SKIP, APPDATA_MIN_BYTES, APPDATA_MIN_AGE_DAYS, DEV_MIN_AGE_DAYS, APP_CACHE_PATHS, tierOf,
  OLD_VERSION_ROOTS, AI_TEMP_ROOTS, EDITOR_STATE_ROOTS, CRASH_EXTRA, groupKey, versionOf, newestOf, compareVersions,
  CODEX_WT_MIN_IDLE_DAYS, claudeSessionSlug, runningClaudeVersion, activeExtensionVersions, extGroup } from './lib/rules.mjs';
import { realListInstalledApps } from './lib/detectors.mjs';

const W = path.win32;
export const CATEGORIES = ['temp', 'pkg-cache', 'dev-artifact', 'orphan-worktree', 'plugin-cache', 'appdata-orphan', 'recycle-bin', 'crash-dump', 'vm-disk', 'browser-cache', 'shader-cache', 'app-cache', 'system-cleanup', 'old-download', 'ai-old-version', 'ai-temp', 'editor-state', 'ai-history'];
const REPORT = new Set(['recycle-bin', 'vm-disk', 'system-cleanup', 'old-download', 'ai-history', 'editor-state']);
const SAFETY = { safe: '삭제해도 됨', check: '확인 후 삭제', manual: '직접 판단' }; // display only, never used for decisions
const REPORT_TEXT = { 'system-cleanup': 'Windows 디스크 정리(cleanmgr) → 시스템 파일 정리 (관리자 권한 필요)', 'old-download': '다운로드 폴더는 보호됨 — 직접 확인 후 삭제하세요', 'recycle-bin': 'Windows에서 직접 휴지통을 비우세요', 'vm-disk': '직접 정리하세요', 'ai-history': '대화 기록이라 자동으로 지우지 않습니다 — 직접 확인하세요',
  'editor-state': '프로젝트별 AI 채팅 기록이 들어 있어 자동으로 지우지 않습니다 — 편집기 안에서 직접 정리하세요' };
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
export const SHIMS = new Set(['npm', 'pnpm', 'yarn', 'bun', 'claude']); // .cmd shims on Windows
const RUNNABLE = new Set([...SHIMS, 'pip', 'uv', 'dotnet', 'git']);
// Every git call starts with this: a repo's config must not make git run a hook program (fsmonitor).
const GIT = ['git', '-c', 'core.fsmonitor=false'];
const git = (...a) => [...GIT, ...a];

// ---------- default (real) runners; tests inject fakes ----------

/** argv is always built from the fixed tables (plus validated absolute paths for `git -C`). */
export function defaultRun(argv, { timeout = 120000 } = {}) {
  return new Promise((resolve) => {
    const [bin, ...rest] = argv;
    if (!RUNNABLE.has(bin) || (bin === 'git' && (rest[0] !== '-c' || rest[1] !== 'core.fsmonitor=false'))) return resolve({ code: -1, stdout: '', stderr: 'not allowed' });
    const [cmd, args] = SHIMS.has(bin) ? ['cmd.exe', ['/d', '/s', '/c', bin, ...rest]] : [bin, rest];
    let out = '', err = '';
    const c = spawn(cmd, args, { shell: false, windowsHide: true, timeout, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
    c.stdout.on('data', (d) => { if (out.length < 1e6) out += d; });
    c.stderr.on('data', (d) => { if (err.length < 1e6) err += d; });
    c.on('error', (e) => resolve({ code: -1, stdout: out, stderr: String(e.code || e.message) }));
    c.on('close', (code) => resolve({ code, stdout: out, stderr: err }));
  });
}

// Fixed script; paths arrive on stdin as lines of base64 (utf8), never inside the command line.
// SHFileOperation flags 0x4454 = FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI | FOF_WANTNUKEWARNING:
// to the Recycle Bin, no error dialogs, and Windows still asks before it would delete permanently.
const PS_SCRIPT = String.raw`
$cs = @'
using System;
using System.Runtime.InteropServices;
public static class Shf {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct Op64 { public IntPtr hwnd; public uint wFunc; public string pFrom; public string pTo; public ushort fFlags; public int aborted; public IntPtr map; public string title; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode, Pack = 1)]
  struct Op32 { public IntPtr hwnd; public uint wFunc; public string pFrom; public string pTo; public ushort fFlags; public int aborted; public IntPtr map; public string title; }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, EntryPoint = "SHFileOperationW")] static extern int F64(ref Op64 o);
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, EntryPoint = "SHFileOperationW")] static extern int F32(ref Op32 o);
  // 0 = recycled, 100000 = aborted, anything else = the SHFileOperation error code
  public static int Recycle(string path) {
    string from = path + "\0";
    if (IntPtr.Size == 8) { Op64 o = new Op64(); o.wFunc = 3; o.pFrom = from; o.fFlags = 0x4454; int r = F64(ref o); return (r == 0 && o.aborted != 0) ? 100000 : r; }
    else { Op32 o = new Op32(); o.wFunc = 3; o.pFrom = from; o.fFlags = 0x4454; int r = F32(ref o); return (r == 0 && o.aborted != 0) ? 100000 : r; }
  }
}
'@
Add-Type -TypeDefinition $cs
$lines = @([Console]::In.ReadToEnd() -split '\r?\n' | Where-Object { $_ })
function Emit($h) { [Console]::Out.WriteLine(($h | ConvertTo-Json -Compress)); [Console]::Out.Flush() }
for ($i = 0; $i -lt $lines.Count; $i++) {
  try {
    $p = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($lines[$i].Trim()))
    $r = [Shf]::Recycle($p)
    if ($r -eq 0) { Emit @{ i = $i; ok = $true } } else { Emit @{ i = $i; ok = $false; e = "SHErr$r" } }
  } catch {
    $ex = $_.Exception
    if ($ex.InnerException) { $ex = $ex.InnerException }
    Emit @{ i = $i; ok = $false; e = $ex.GetType().Name }
  }
}
`;

/** Parse the recycler's one-JSON-object-per-line output into n results; a path without a line is "Unknown" (needs a look), not failed. */
export function parseRecycleOutput(text, n) {
  const got = new Map();
  for (const line of String(text ?? '').split(/\r?\n/)) {
    try { const x = JSON.parse(line); if (Number.isInteger(x?.i) && x.i >= 0 && x.i < n) got.set(x.i, x); } catch { /* partial line */ }
  }
  return Array.from({ length: n }, (_, i) => got.get(i) ?? { ok: false, e: 'Unknown' });
}

/** list: [{path}] -> [{ok, e?}] in the same order. Small chunks + timeout: a stuck confirmation dialog must not hang forever. */
export async function defaultRecycle(list) {
  const out = [];
  for (let s = 0; s < list.length; s += 50) {
    const chunk = list.slice(s, s + 50);
    const payload = chunk.map(({ path: p }) => Buffer.from(p).toString('base64')).join('\n');
    const enc = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');
    const r = await new Promise((resolve) => {
      let o = '';
      const c = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', enc], { shell: false, windowsHide: true, timeout: 300000, stdio: ['pipe', 'pipe', 'ignore'] });
      c.stdout.on('data', (d) => { o += d; });
      c.on('error', () => resolve(o));
      c.on('close', () => resolve(o)); // after a timeout kill this still holds every result printed so far
      c.stdin.on('error', () => {});
      c.stdin.end(payload);
    });
    out.push(...parseRecycleOutput(r, chunk.length));
  }
  return out;
}

/** True for a fixed NTFS drive root such as "D:\". Only the validated drive letter goes into the (otherwise fixed) command. */
export function defaultDriveOk(root) {
  return new Promise((resolve) => {
    const m = /^([A-Za-z]):\\$/.exec(root);
    if (!m) return resolve(false);
    let o = '';
    const script = `$d = [IO.DriveInfo]::new('${m[1]}:\\'); Write-Output ($d.DriveType.ToString() + ' ' + $d.DriveFormat)`;
    const c = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { shell: false, windowsHide: true, timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] });
    c.stdout.on('data', (d) => { o += d; });
    c.on('error', () => resolve(false));
    c.on('close', () => resolve(/^Fixed NTFS\s*$/.test(o)));
  });
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
    cwd: o.cwd ?? process.cwd(), // the running session's working directory (its <tmp>\claude scratch dir is never touched)
    probe: o.probe ?? defaultRun, // read-only commands (resolve cache dir, git queries)
    run: o.run ?? defaultRun, // mutating commands (official cleaners, git worktree remove/prune)
    recycle: o.recycle ?? defaultRecycle,
    listInstalledApps: o.listInstalledApps ?? realListInstalledApps, // uninstall registry (read-only)
    driveOk: o.driveOk ?? defaultDriveOk, // fixed NTFS drive (has a Recycle Bin; a missing $Recycle.Bin folder is created on demand)
    driveTotal: o.driveTotal ?? (async (root) => { try { const s = await fs.statfs(root); return s.blocks * s.bsize; } catch { return null; } }),
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
    else items.push({ id: it.id, category: it.category, tool: it.tool, path: it.path, size: it.size });
  }
  return { items, rejected };
}

// ---------- 2. re-verification ----------

/** Own small du: logical size, newest mtime, first sensitive name, first `.git` dir. Does not follow links. */
export async function du(top, { scanSensitive = true } = {}) {
  const r = { size: 0, newest: 0, sensitive: null, gitDir: null, unreadable: 0, maxPath: top.length };
  const topSt = await fs.lstat(top);
  r.newest = topSt.mtimeMs;
  if (!topSt.isDirectory()) { r.size = topSt.size; return r; }
  const links = new Set();
  const stack = [top];
  while (stack.length && !r.sensitive && !r.gitDir) {
    const dir = stack.pop();
    let ents;
    try { ents = await fs.readdir(dir, { withFileTypes: true }); } catch { r.unreadable++; continue; }
    await Promise.all(ents.map(async (e) => {
      const q = W.join(dir, e.name);
      if (q.length > r.maxPath) r.maxPath = q.length;
      if (scanSensitive && secretFile(e.name)) { r.sensitive ??= q; return; }
      if (e.isSymbolicLink()) return; // symlinks/junctions are skipped, not followed
      if (e.isDirectory()) {
        if (scanSensitive && e.name.toLowerCase() === '.git') r.gitDir ??= q;
        else stack.push(q);
        return;
      }
      try {
        const st = await fs.lstat(q, { bigint: true });
        r.newest = Math.max(r.newest, Number(st.mtimeMs));
        if (st.nlink > 1n) { // hard links (pnpm stores) count once
          const id = `${st.dev}:${st.ino}`;
          if (links.has(id)) return;
          links.add(id);
        }
        r.size += Number(st.size);
      } catch { r.unreadable++; }
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
  const g = (...a) => ctx.probe(git('-C', parent, ...a));
  const s = await g('symbolic-ref', '--short', 'refs/remotes/origin/HEAD');
  const name = s.stdout?.trim();
  if (s.code === 0 && /^[\w./-]+$/.test(name) && !name.startsWith('-')) return name;
  for (const b of ['main', 'master']) if ((await g('rev-parse', '--verify', '--quiet', `refs/heads/${b}`)).code === 0) return b;
  return null;
}

/** Is `p` one of git's listed worktrees? Compared by normalized path and by real path (junctions, 8.3 names). */
async function isListed(list, p) {
  const rp = norm(await fs.realpath(p).catch(() => p));
  for (const w of list) {
    if (norm(w.path) === norm(p)) return true;
    if (norm(await fs.realpath(w.path).catch(() => w.path)) === rp) return true;
  }
  return false;
}

const CONFIG_RISK = '저장소 설정에 외부 프로그램 실행 항목이 있어 건너뜀';
/**
 * `git status` / `worktree remove` can run programs named in the repo's own config (filters, fsmonitor, hooks, ssh, diff/merge drivers,
 * includes). Reading config executes nothing. Only the repo-local and per-worktree files are checked: the user's global config
 * (git-lfs filters) is theirs. Returns a reject reason or null.
 */
async function configRisk(dir, ctx) {
  const re = '^(include\\.|includeif\\.|filter\\.|core\\.fsmonitor|core\\.hookspath|core\\.sshcommand|diff\\.|merge\\.)';
  const cfg = (...a) => ctx.probe(git('-C', dir, 'config', ...a));
  // --worktree is only valid (git errors otherwise) when extensions.worktreeConfig is on
  const ext = await cfg('--local', '--bool', '--get', 'extensions.worktreeConfig');
  if (![0, 1].includes(ext.code)) return CONFIG_RISK;
  const scopes = ['--local', ...(ext.code === 0 && (ext.stdout || '').trim() === 'true' ? ['--worktree'] : [])];
  for (const scope of scopes) {
    const r = await cfg(scope, '--get-regexp', re);
    // exit 1 = no matching key; anything printed, or any other failure, is a risk
    if (![0, 1].includes(r.code) || (r.stdout || '').trim()) return CONFIG_RISK;
  }
  return null;
}

async function planWorktree(p, ctx) {
  const gitEntry = W.join(p, '.git');
  const gst = await fs.lstat(gitEntry).catch(() => null);
  if (!gst) return { reject: '.git 없음 — 워크트리가 아님' };
  const q = (cwd, ...a) => ctx.probe(git('-C', cwd, ...a));
  if (gst.isDirectory()) {
    // (c) repo root with prunable worktree entries -> git worktree prune
    const l = await q(p, 'worktree', 'list', '--porcelain');
    if (l.code !== 0 || !parseWorktrees(l.stdout).some((w) => w.prunable)) return { reject: 'prunable 워크트리 항목이 없음' };
    const risk = await configRisk(p, ctx);
    if (risk) return { reject: risk };
    return { kind: 'run', argv: git('-C', p, 'worktree', 'prune'), noDu: true };
  }
  if (!gst.isFile() || gst.size > 4096) return { reject: '.git 포인터 파일이 올바르지 않음' };
  const m = /^gitdir:\s*(.+)$/m.exec(await fs.readFile(gitEntry, 'utf8'));
  if (!m) return { reject: '.git 포인터 파일에 gitdir 줄이 없음' };
  if (await exists(W.join(p, '.gitmodules'))) return { reject: '서브모듈이 있어 건너뜀' };
  const gitdir = W.resolve(p, m[1].trim());
  // 1. structure first: <parent>\.git\worktrees\<id>
  const wtDir = W.dirname(gitdir), parentGit = W.dirname(wtDir), parent = W.dirname(parentGit);
  if (W.basename(wtDir).toLowerCase() !== 'worktrees' || W.basename(parentGit).toLowerCase() !== '.git') return { reject: 'gitdir가 <저장소>\\.git\\worktrees\\<id> 구조가 아님' };
  // 2. "missing" must not just mean an unplugged drive
  if (!(await exists(W.parse(gitdir).root))) return { reject: 'gitdir의 드라이브를 찾을 수 없음 — 판단 불가' };
  if (!(await exists(gitdir))) return { kind: 'recycle' }; // (a) gitdir missing
  const l = await q(parent, 'worktree', 'list', '--porcelain');
  const listed = l.code === 0 ? parseWorktrees(l.stdout) : [];
  if (!listed.length) return { reject: '부모 저장소 git 확인 실패' };
  if (!(await isListed(listed, p))) return { kind: 'recycle' }; // (a) not listed
  // (b) listed worktree: merged into the default branch, clean, outside the parent's .claude/worktrees
  if (norm(p).startsWith(norm(W.join(parent, '.claude', 'worktrees')) + '\\')) return { reject: '부모의 .claude/worktrees 안 — 건너뜀' };
  const head = (await q(p, 'rev-parse', 'HEAD')).stdout?.trim();
  if (!/^[0-9a-f]{40,64}$/.test(head || '')) return { reject: 'HEAD를 확인할 수 없음' };
  const def = await defaultBranch(parent, ctx);
  if (!def) return { reject: '기본 브랜치를 찾을 수 없음' };
  if ((await q(parent, 'merge-base', '--is-ancestor', head, def)).code !== 0) return { reject: `HEAD가 ${def}에 병합되지 않음` };
  for (const dir of [p, parent]) { const risk = await configRisk(dir, ctx); if (risk) return { reject: risk }; } // before status and remove
  const st = await q(p, 'status', '--porcelain', '--ignore-submodules=all');
  if (st.code !== 0 || st.stdout.trim() !== '') return { reject: '작업 트리가 깨끗하지 않음' };
  return { kind: 'run', argv: git('-C', parent, 'worktree', 'remove', '--', p) };
}

function collectStrings(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => collectStrings(x, out));
  return out;
}

const SKIP_SRC = new Set([...DEV_DIRS, '.git']); // artifact dirs and git metadata are not "source"

/** First file under `root` (outside artifact dirs) newer than `cutoff`, or {truncated} when the tree is too big to judge. */
async function newestSource(root, cutoff, limit = 100000) {
  const stack = [root];
  let seen = 0;
  while (stack.length) {
    const dir = stack.pop();
    let ents;
    try { ents = await fs.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      if (e.isSymbolicLink()) continue;
      const q = W.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_SRC.has(e.name.toLowerCase())) stack.push(q); continue; }
      if (++seen > limit) return { truncated: true };
      try { if ((await fs.lstat(q)).mtimeMs > cutoff) return { recent: q }; } catch { /* vanished */ }
    }
  }
  return {};
}

const nz = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
/** Fuzzy "does an installed app own this folder?" (same idea as the scanner); too-short names count as matched. */
function matchesApp(folder, apps) {
  const f = nz(folder);
  if (f.length < 3) return true;
  const fl = folder.toLowerCase();
  return apps.some((a) => {
    if ([a.name, a.publisher, W.basename(a.location || '')].some((x) => { const n = nz(x); return n.length >= 3 && (n.includes(f) || f.includes(n)); })) return true;
    return (a.location || '').toLowerCase().split(/[\\/]+/).includes(fl);
  });
}

/** appdata-orphan checks that need the measured size/mtime. Returns a reject reason or null. */
async function orphanReject(p, u, ctx) {
  if (u.size < APPDATA_MIN_BYTES) return `크기가 ${fmtSize(APPDATA_MIN_BYTES)} 미만`;
  if (ctx.now - u.newest < APPDATA_MIN_AGE_DAYS * DAY) return `${APPDATA_MIN_AGE_DAYS}일 이내에 사용된 흔적이 있음`;
  let apps = [];
  try { apps = await ctx.listInstalledApps(); } catch { /* unreadable registry */ }
  if (!apps?.length) return '설치된 앱 목록을 읽을 수 없어 판단 불가';
  return matchesApp(W.basename(p), apps) ? '설치된 앱과 이름이 비슷함' : null;
}

/** ai-old-version: a direct child of an old-version root that is not the newest of its group (recomputed from disk). */
async function planOldVersion(item, p, st, ctx) {
  const np = norm(p), parent = norm(W.dirname(p)), name = W.basename(p);
  const hit = OLD_VERSION_ROOTS(ctx.env).find((r) => norm(r.root) === parent);
  if (!hit) return { reject: 'AI 도구 버전 폴더의 직속 항목이 아님' };
  const key = groupKey(name, hit.kind), ver = versionOf(name, hit.kind);
  if (key === null || ver === null) return { reject: '버전을 해석할 수 없음 — 건너뜀' };
  let names;
  try { names = await fs.readdir(hit.root); } catch (e) { return { reject: errReason(e) }; }
  const group = names.filter((n) => groupKey(n, hit.kind) === key);
  if (group.length < 2) return { reject: '같은 그룹에 버전이 하나뿐이라 건너뜀' };
  const keep = newestOf(group, hit.kind);
  if (!keep) return { reject: '최신 버전을 정할 수 없음 — 건너뜀' };
  if (compareVersions(ver, versionOf(keep, hit.kind)) >= 0) return { reject: '그룹에서 가장 최신 버전이라 건너뜀' }; // also equal versions (other platform builds)
  if (hit.kind === 'claude-cli') {
    ctx.claudeVersion ??= { v: await runningClaudeVersion(ctx.probe) }; // one `claude --version` per run
    if (ctx.claudeVersion.v && compareVersions(ver, ctx.claudeVersion.v) === 0) return { reject: '실행 중인 claude 버전이라 건너뜀' };
  } else if (hit.kind === 'vscode-ext' || hit.kind === 'cursor-ext') {
    const active = await activeExtensionVersions(hit.root); // extensions.json: what the editor has installed
    const g = extGroup(name);
    if (active.has(name.toLowerCase()) || active.has(`${g.id}@${g.version}`.toLowerCase())) return { reject: '편집기가 사용 중인 확장 버전이라 건너뜀' };
  }
  return { kind: 'recycle' };
}

/** Category rules. Returns {reject} or {kind:'recycle'|'run'|'report', argv?}. */
async function planFor(item, p, st, ctx) {
  const { env } = ctx;
  const np = norm(p), base = W.basename(np), parent = norm(W.dirname(p));
  switch (item.category) {
    case 'pkg-cache': {
      // the tool itself must answer (no default-location fallback), except gradle/nuget which have no resolver
      const real = await resolveCacheDir(item.tool, { probe: ctx.probe, env, requireTool: !['gradle', 'nuget'].includes(item.tool) });
      if (!real) return { reject: `${item.tool}에서 캐시 경로를 확인할 수 없음 — 건너뜀` };
      const dirs = [norm(real), ...(item.tool === 'pnpm' ? [norm(W.dirname(real))] : [])];
      if (!dirs.includes(np)) return { reject: `${item.tool}의 실제 캐시 경로와 다름` };
      return CLEAN[item.tool] ? { kind: 'run', argv: CLEAN[item.tool] } : { kind: 'recycle' };
    }
    case 'dev-artifact': {
      if (!st.isDirectory() || !DEV_DIRS.has(base)) return { reject: '개발 산출물 폴더가 아님' };
      let marker = false;
      for (const mk of MARKERS) if (await exists(W.join(W.dirname(p), mk))) { marker = true; break; }
      if (!marker) return { reject: '상위에 프로젝트 파일(package.json 등)이 없음' };
      const r = await newestSource(W.dirname(p), ctx.now - DEV_MIN_AGE_DAYS * DAY);
      if (r.recent) return { reject: `프로젝트에 ${DEV_MIN_AGE_DAYS}일 이내에 수정된 파일이 있음 (${W.relative(W.dirname(p), r.recent)})` };
      if (r.truncated) return { reject: '프로젝트가 너무 커서 최근 수정 여부를 판단할 수 없음' };
      return { kind: 'recycle' };
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
      if (base.startsWith('.') || APPDATA_SKIP.has(base)) return { reject: '고아 폴더로 보지 않는 이름(시스템/공용 폴더)' };
      return { kind: 'recycle', orphan: true };
    case 'crash-dump': {
      const la = env.localAppData && norm(env.localAppData);
      if (!la || !np.startsWith(la + '\\') || !((st.isDirectory() && base === 'crashdumps') || (st.isFile() && base.endsWith('.dmp')))) return { reject: 'LOCALAPPDATA의 CrashDumps/*.dmp가 아님' };
      return { kind: 'recycle' };
    }
    case 'ai-old-version': return planOldVersion(item, p, st, ctx);
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

/** The only temp roots: the user temp dir (os.tmpdir()), %LOCALAPPDATA%\Temp and <windir>\Temp, compared by real path. */
async function tempRoots(env) {
  const roots = [env.tmp, env.localAppData && W.join(env.localAppData, 'Temp'), W.join(env.windir, 'Temp')].filter(Boolean);
  return Promise.all(roots.map(async (r) => norm(await fs.realpath(r).catch(() => r))));
}
/** Never touched inside any temp root: live Claude sessions and the machine map page. */
const tempProtected = (name) => name.toLowerCase() === 'claude' || /^machine-map.*\.html$/i.test(name);

/** Allowed roots for the "recycle children" categories. */
async function childrenRootOk(category, p, env) {
  const np = norm(p), la = env.localAppData;
  if (category === 'temp') return (await tempRoots(env)).includes(np);
  if (category === 'crash-dump') return CRASH_EXTRA(env).map(norm).includes(np);
  if (category === 'ai-temp') return !!(await aiTempRoot(env, p));
  if (category === 'shader-cache') {
    return !!la && [['D3DSCache'], ['NVIDIA', 'DXCache'], ['NVIDIA', 'GLCache'], ['AMD', 'DxCache']].map((x) => norm(W.join(la, ...x))).includes(np);
  }
  if (la && [['Microsoft', 'Windows', 'INetCache'], ['Microsoft', 'Windows', 'WER']].map((x) => norm(W.join(la, ...x))).includes(np)) return true;
  return category === 'app-cache' && APP_CACHE_PATHS(env).map(norm).includes(np); // exact list shared with the scanner
}

/** The matching AI_TEMP_ROOTS entry for a root path (compared by real path), or null. */
async function aiTempRoot(env, p) {
  const np = norm(p);
  for (const r of AI_TEMP_ROOTS(env)) if (norm(await fs.realpath(r.root).catch(() => r.root)) === np) return r;
  return null;
}

/** A child of <tmp>\claude that may belong to the running session: the slug of the current cwd, or a project it sits in. */
function isCurrentSessionDir(name, cwd) {
  const slug = claudeSessionSlug(cwd).toLowerCase(), n = name.toLowerCase();
  return !!n && (slug === n || slug.startsWith(n + '-'));
}

async function verifyChildren(item, p, st, ctx) {
  const { env, now } = ctx;
  const temp = item.category === 'temp', aiTemp = item.category === 'ai-temp';
  const root = aiTemp ? await aiTempRoot(env, p) : null;
  if (!st.isDirectory() || !(await childrenRootOk(item.category, p, env))) return no(temp ? '임시 폴더가 아님' : aiTemp ? 'AI 도구 임시/캐시 폴더가 아님' : '허용된 캐시 위치가 아님');
  // temp and AI temp roots are denied themselves (only their children may be handled); other roots must pass the deny list
  if (!temp && !aiTemp) { const d = isDenied(p, env); if (d.denied) return no(`거부: ${d.reason}`); }
  const ageDays = temp ? 1 : root?.minAgeDays ?? 0;
  const claudeScratch = aiTemp && norm(p) === norm(await fs.realpath(W.join(env.tmp, 'claude')).catch(() => W.join(env.tmp, 'claude')));
  let names;
  try { names = await fs.readdir(p, { withFileTypes: true }); } catch (e) { return no(errReason(e)); }
  const children = [];
  let skipped = 0, size = 0;
  const one = async (e) => {
    const cp = W.join(p, e.name);
    if (e.isSymbolicLink() || (temp && tempProtected(e.name)) || (claudeScratch && isCurrentSessionDir(e.name, ctx.cwd)) || isDenied(cp, env).denied) return void skipped++;
    try {
      const u = await du(cp);
      if (u.sensitive || (u.gitDir && !(await env.isOrphanGit(cp))) || (ageDays && u.newest > now - ageDays * DAY)) return void skipped++;
      children.push({ path: cp, dir: e.isDirectory(), size: u.size, maxPath: u.maxPath });
      size += u.size;
    } catch { skipped++; }
  };
  for (let i = 0; i < names.length; i += 16) await Promise.all(names.slice(i, i + 16).map(one));
  return { ok: true, entry: { item, category: item.category, action: 'recycle', kind: 'recycle', path: p, isDir: true, size, children, skipped, ageDays, tier: root?.tier } };
}

/** Report-only categories are never executed, so a protected location (Windows, Downloads) may still be listed. */
async function reportOnly(item, p, st, ctx) {
  const { env } = ctx, np = norm(p), base = W.basename(np), parentOf = norm(W.dirname(p));
  const bad = (() => {
    switch (item.category) {
      case 'recycle-bin': return base === '$recycle.bin' ? null : '$Recycle.Bin이 아님';
      case 'vm-disk': return !st || (st.isFile() && /\.vhdx?$/.test(base)) ? null : 'vhd/vhdx 파일이 아님';
      case 'system-cleanup': {
        const w = env.windir;
        const ok = [['SoftwareDistribution', 'Download'], ['Logs', 'CBS'], ['ServiceProfiles', 'NetworkService', 'AppData', 'Local', 'Microsoft', 'Windows', 'DeliveryOptimization']].map((x) => norm(W.join(w, ...x)));
        return ok.includes(np) ? null : '허용된 Windows 정리 위치가 아님';
      }
      case 'editor-state': return EDITOR_STATE_ROOTS(env).some((r) => norm(r.root) === np || norm(r.root) === parentOf) ? null : '에디터 workspaceStorage가 아님';
      case 'ai-history': {
        const h = env.home;
        const ok = [['.codex', 'sessions'], ['.codex', 'archived_sessions'], ['.codex', '.sandbox-recovery'], ['.claude', 'projects']].map((x) => norm(W.join(h, ...x)));
        for (const app of ['Code', 'Cursor']) if (env.appData) ok.push(norm(W.join(env.appData, app, 'User', 'globalStorage')));
        return ok.includes(np) || /\\node_modules\\@anthropic-ai\\claude-code$/.test(np) ? null : '대화 기록/전역 설치 위치가 아님';
      }
      case 'old-download': return (!st || st.isFile()) && np.startsWith(norm(W.join(env.home, 'Downloads')) + '\\') ? null : '다운로드 폴더 안의 파일이 아님';
    }
    return '알 수 없는 category';
  })();
  if (bad) return no(bad);
  let size = null, unreadable = 0;
  if (st) { try { const u = await du(p, { scanSensitive: false }); size = u.size; unreadable = u.unreadable; } catch { /* size unknown */ } }
  const note = item.category === 'ai-history' && base === 'claude-code' ? 'native 설치가 있으면 npm uninstall -g @anthropic-ai/claude-code 로 제거할 수 있습니다 (직접 실행)' : undefined;
  return { ok: true, entry: { item, category: item.category, action: 'report', kind: 'report', path: p, isDir: !!st?.isDirectory(), size, unreadable, note } };
}

const inCodexWorktrees = (p, env) => !!env.home && norm(p).startsWith(norm(W.join(env.home, '.codex', 'worktrees')) + '\\');

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
  if (['temp', 'shader-cache', 'app-cache', 'ai-temp'].includes(item.category) || (item.category === 'crash-dump' && CRASH_EXTRA(env).some((r) => norm(r) === norm(p)))) return verifyChildren(item, p, st, ctx);
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
  if (plan.orphan) { const why = await orphanReject(p, u, ctx); if (why) return no(why); }
  if (inCodexWorktrees(p, env) && ctx.now - u.newest < CODEX_WT_MIN_IDLE_DAYS * DAY) return no(`Codex worktree에 ${CODEX_WT_MIN_IDLE_DAYS}일 이내 변경이 있어 건너뜀`);
  if (plan.minAgeDays && ctx.now - u.newest < plan.minAgeDays * DAY) return no(`${plan.minAgeDays}일 이내에 수정되어 건너뜀`);
  entry.tier = plan.tier;
  entry.size = u.size;
  entry.unreadable = u.unreadable;
  entry.maxPath = u.maxPath;
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
      : e.children ? `  (하위 ${e.children.length}개${e.ageDays ? `, ${e.ageDays}일 이상 지난 것만` : ''}; 건너뜀 ${e.skipped})`
      : e.action === 'report' ? `  (${e.note ?? REPORT_TEXT[e.category]})` : '';
    out(`[${LABEL[e.action]}] [${SAFETY[e.tier ?? tierOf(e.category)]}] ${fmtSize(e.size).padStart(10)}  ${e.path}  <${e.category}>${extra}`);
  }
  if (rejected.length) out('거부/제외된 항목:');
  for (const r of rejected) out(`[거부] ${r.path}  — ${r.reason}`);
  out(`합계: 휴지통 ${cnt.recycle}개 / 명령 ${cnt.run}개 / 보고만 ${cnt.report}개, 약 ${fmtSize(total)}, 거부 ${rejected.length}개`);
}

// ---------- 5. execution ----------

const NOT_INSTALLED = '도구가 설치되어 있지 않음 — 건너뜀';
const classify = (e = '') => (/Unauthorized|Security|EPERM|EACCES|denied|SHErr(?:5|120)\b/i.test(e) ? ADMIN_MSG
  : /IOException|Sharing|locked|SHErr(?:32|33)\b/i.test(e) ? '사용 중 — 건너뜀'
  : /Aborted|SHErr(?:100000|1223)\b/i.test(e) ? '휴지통으로 보낼 수 없음(영구 삭제 경고) — 건너뜀'
  : /^Unknown$/.test(e) ? '알 수 없음 (확인 필요)' : null);
const notInstalled = (r) => r.code === 9009 || (r.code === -1 && /ENOENT/.test(r.stderr || '')) || /is not recognized|내부 또는 외부 명령/i.test(`${r.stderr}${r.stdout}`);

/** TOCTOU guard right before acting: the target must still be the same plain, non-denied path. */
async function recheck(p, ctx, { root = false } = {}) {
  let st;
  try { st = await fs.lstat(p); } catch (e) { return e.code === 'ENOENT' ? '경로가 사라짐 — 건너뜀' : errReason(e); }
  if (st.isSymbolicLink()) return '링크로 바뀜 — 건너뜀';
  try { if (norm(await fs.realpath(p)) !== norm(p)) return '실제 경로가 바뀜 — 건너뜀'; } catch (e) { return errReason(e); }
  if (!root && isDenied(p, ctx.env).denied) return '보호 경로로 판정됨 — 건너뜀';
  return null;
}

/** Why a path must not be sent to the Recycle Bin (it could be deleted permanently instead), or null. */
async function recycleBlocker(u, ctx, cache) {
  const root = W.parse(u.path).root;
  if (!cache.has(root)) cache.set(root, { ok: await ctx.driveOk(root), total: await ctx.driveTotal(root) });
  const d = cache.get(root);
  if (!d.ok) return '고정 NTFS 드라이브가 아니라 휴지통을 쓸 수 없음 — 건너뜀';
  if (d.total && u.size > d.total * 0.05) return '휴지통 용량 초과 위험 — 건너뜀';
  if ((u.maxPath ?? 0) >= 240) return '경로가 너무 길어 휴지통 이동 불가 — 건너뜀';
  return null;
}

export async function execute(entries, ctx) {
  const res = { done: 0, skipped: 0, failed: 0, bytes: 0 };
  const skip = (p, why) => { res.skipped++; ctx.out(`  - ${p}: ${why}`); };
  const tally = (r, p, size) => {
    if (r?.ok) { res.done++; res.bytes += size ?? 0; return; }
    const why = classify(r ? r.e : 'Unknown'); // no result at all (timeout, runner died) = unknown, not failed
    why ? res.skipped++ : res.failed++;
    ctx.out(`  - ${p}: ${why ?? `실패 (${printable(r?.e ?? '알 수 없음', 60)})`}`);
  };
  const bins = new Map();
  for (const e of entries) {
    if (e.action === 'report') continue; // never executed
    if (e.kind === 'recycle') {
      const list = e.children ?? [{ path: e.path, dir: e.isDir, size: e.size, maxPath: e.maxPath }];
      const send = [];
      for (const c of list) {
        const why = (await recheck(c.path, ctx)) ?? (await recycleBlocker(c, ctx, bins));
        why ? skip(c.path, why) : send.push(c);
      }
      if (!send.length) continue;
      const rs = await ctx.recycle(send.map(({ path: p, dir }) => ({ path: p, dir })));
      send.forEach((c, i) => tally(rs?.[i], c.path, c.size));
    } else if (e.kind === 'run') {
      const why = await recheck(e.path, ctx);
      if (why) { skip(e.path, why); continue; }
      const r = await ctx.run(e.argv);
      if (r.code === 0) { res.done++; res.bytes += e.size ?? 0; continue; }
      if (notInstalled(r)) { skip(e.argv.slice(e.argv[0] === 'git' ? 3 : 0).join(' '), NOT_INSTALLED); continue; }
      const m = classify(`${r.stderr}${r.stdout}`);
      m ? res.skipped++ : res.failed++;
      ctx.out(`  - ${e.argv.join(' ')}: ${m ?? `실패 (종료 코드 ${r.code})`}`);
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
