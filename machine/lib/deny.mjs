// Hard deny list for machine/clean.mjs. A denied path is never touched, even if a plan asks for it.
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { AI_TEMP_ROOTS } from './rules.mjs';

const W = path.win32;

/** Lowercase, `/` -> `\`, normalized, no trailing slash (except drive root). */
export function norm(p) {
  let s = W.normalize(String(p).replace(/\//g, '\\')).replace(/^\\\\\?\\/, '');
  if (s.length > 3) s = s.replace(/\\+$/, '');
  return s.toLowerCase();
}

/** Names that may hold secrets: `.credentials*`, `.env*`, `*credentials*.json`. */
export const sensitiveName = (n) => /^\.(credentials|env)/i.test(n) || /credentials.*\.json$/i.test(n);

/** Same, minus .example/.sample/.template copies (as in .gitignore); used when scanning inside a directory target. */
export const secretFile = (n) => sensitiveName(n) && !/\.(example|sample|template)(\..*)?$/i.test(n);

const SHELL_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders';
// Desktop, Documents, Pictures, Music, Videos and Downloads
const SHELL_NAMES = new Set(['desktop', 'personal', 'my pictures', 'my music', 'my video', '{374de290-123f-4565-9164-39c4925e467b}']);
let shellCache = null;
const regQuery = () =>
  execFileSync('reg', ['query', SHELL_KEY], { encoding: 'utf8', timeout: 5000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });

/** Real (possibly relocated) user shell folders from the registry (read-only). [] when unavailable. */
export function readUserShellFolders(run = regQuery) {
  const out = [];
  try {
    for (const line of String(run()).split(/\r?\n/)) {
      const m = /^\s+(\S.*?)\s+REG_(?:EXPAND_)?SZ\s+(.*?)\s*$/.exec(line);
      if (!m || !SHELL_NAMES.has(m[1].toLowerCase())) continue;
      const v = m[2].replace(/%([^%]+)%/g, (all, n) => {
        const k = Object.keys(process.env).find((x) => x.toLowerCase() === n.toLowerCase());
        return k ? process.env[k] : all;
      });
      if (/^[a-z]:[\\/]/i.test(v) && !v.includes('%')) out.push(v);
    }
  } catch { /* not Windows or reg unavailable: the default folder names still apply */ }
  return out;
}

export function defaultEnv(e = process.env) {
  const env = {
    home: os.homedir(),
    windir: e.SystemRoot || e.windir || 'C:\\Windows',
    programFiles: [e.ProgramFiles, e['ProgramFiles(x86)'], e.ProgramW6432].filter(Boolean),
    programData: e.ProgramData || 'C:\\ProgramData',
    tmp: os.tmpdir(),
    appData: e.APPDATA,
    localAppData: e.LOCALAPPDATA,
    repo: 'D:\\project\\ai-setup',
    // Hook: true when `p` is an orphan worktree whose `.git` may be handled; default none.
    isOrphanGit: () => false,
  };
  // lazy and non-enumerable so spreading the env does not trigger the registry read
  Object.defineProperty(env, 'userShellFolders', { get: () => (shellCache ??= readUserShellFolders()), enumerable: false });
  return env;
}

const USER_DIRS = ['documents', 'desktop', 'pictures', 'videos', 'music', 'downloads'];

/** @returns {{denied:boolean, reason:string}} */
export function isDenied(p, envIn = {}) {
  const base = defaultEnv();
  const env = { ...base, ...envIn };
  const shellFolders = envIn.userShellFolders ?? base.userShellFolders;
  const yes = (reason) => ({ denied: true, reason });
  if (typeof p !== 'string' || !/^[a-z]:[\\/]/i.test(p)) return yes('절대 경로가 아님');
  const s = norm(p);
  const segs = s.split('\\').slice(1);
  const within = (base) => !!base && (s === norm(base) || s.startsWith(norm(base) + '\\'));
  const join = (b, ...r) => W.join(b, ...r);

  if (/^[a-z]:\\?$/.test(s)) return yes('드라이브 루트');
  // Windows strips trailing dots/spaces, so "Documents." would alias "Documents"
  if (segs.some((g) => /[. ]$/.test(g))) return yes('이름 끝에 점이나 공백이 있는 경로');
  if (segs.some(sensitiveName)) return yes('인증/환경 파일(.credentials*, .env*) 경로');
  if (segs.includes('.git') && !env.isOrphanGit(p)) return yes('.git 폴더 (또는 그 안)');

  if (within(env.windir)) {
    const t = norm(join(env.windir, 'Temp'));
    if (!s.startsWith(t + '\\')) return yes('Windows 시스템 폴더 (Windows\\Temp 하위 항목만 허용)');
  }
  if (/^[a-z]:\\program files[^\\]*(\\|$)/.test(s) || [].concat(env.programFiles).some(within)) return yes('Program Files');
  if (within(env.programData)) return yes('ProgramData');

  const home = env.home;
  if (s === norm(home)) return yes('홈 폴더 자체');
  if (USER_DIRS.some((d) => within(join(home, d)))) return yes('사용자 문서/바탕화면/사진/동영상/음악/다운로드');
  // the real shell folders may be relocated (e.g. D:\PC-Storage\UserFiles\Downloads); skip entries that are the home or a drive root
  if (shellFolders.some((d) => norm(d) !== norm(home) && !/^[a-z]:\\?$/.test(norm(d)) && within(d))) return yes('실제 문서/바탕화면/사진/동영상/음악/다운로드 폴더 (레지스트리)');
  if (s.startsWith(norm(home) + '\\') && s.slice(norm(home).length + 1).split('\\')[0].startsWith('onedrive')) return yes('OneDrive');

  const claude = norm(join(home, '.claude'));
  if (within(claude)) {
    const rel = s.slice(claude.length + 1).split('\\');
    // only exactly plugins/cache/<market>/<plugin>/<version> and the direct children of plugins/.trash are allowed, not deeper
    const version = rel[0] === 'plugins' && rel[1] === 'cache' && rel.length === 5;
    const trashChild = rel[0] === 'plugins' && rel[1] === '.trash' && rel.length === 3;
    if (!version && !trashChild) return yes('~/.claude (plugin 캐시 버전 폴더와 plugins/.trash 하위 항목만 허용)');
  }
  const codex = norm(join(home, '.codex'));
  if (within(codex)) {
    // allowed: direct children of the AI temp roots, and anything inside ~/.codex/worktrees/<id>; auth, sessions, config stay denied
    if (s === codex + '\\.sandbox-recovery' || s.startsWith(codex + '\\.sandbox-recovery\\')) return yes('~/.codex/.sandbox-recovery (Codex 복구 백업, 직접 판단)');
    const parentOf = s.slice(0, s.lastIndexOf('\\'));
    const tempChild = AI_TEMP_ROOTS(env).some((r) => norm(r.root).startsWith(codex + '\\') && norm(r.root) === parentOf);
    const worktree = s.startsWith(codex + '\\worktrees\\');
    if (!tempChild && !worktree) return yes('~/.codex (임시/캐시 하위 항목과 worktrees만 허용)');
  }
  if (within(join(home, '.claude-mem'))) return yes('~/.claude-mem');

  if (s === norm(env.tmp)) return yes('임시 폴더 자체 (하위 항목만 허용)');
  const tmpClaude = norm(join(env.tmp, 'claude'));
  // the folder itself and anything deeper stay protected; only its direct children (old session scratch) may be handled
  if (within(tmpClaude) && (s === tmpClaude || s.slice(tmpClaude.length + 1).includes('\\'))) return yes('실행 중인 Claude 세션 폴더');
  if (within(join(env.tmp, 'machine-map.html'))) return yes('machine-map.html');
  if (within(env.repo)) return yes('ai-setup 저장소');
  return { denied: false, reason: '' };
}
