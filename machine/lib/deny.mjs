// Hard deny list for machine/clean.mjs. A denied path is never touched, even if a plan asks for it.
import path from 'node:path';
import os from 'node:os';

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

export function defaultEnv(e = process.env) {
  return {
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
}

const USER_DIRS = ['documents', 'desktop', 'pictures', 'videos', 'music', 'downloads'];

/** @returns {{denied:boolean, reason:string}} */
export function isDenied(p, envIn = {}) {
  const env = { ...defaultEnv(), ...envIn };
  const yes = (reason) => ({ denied: true, reason });
  if (typeof p !== 'string' || !/^[a-z]:[\\/]/i.test(p)) return yes('절대 경로가 아님');
  const s = norm(p);
  const segs = s.split('\\').slice(1);
  const within = (base) => !!base && (s === norm(base) || s.startsWith(norm(base) + '\\'));
  const join = (b, ...r) => W.join(b, ...r);

  if (/^[a-z]:\\?$/.test(s)) return yes('드라이브 루트');
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
  if (s.startsWith(norm(home) + '\\') && s.slice(norm(home).length + 1).split('\\')[0].startsWith('onedrive')) return yes('OneDrive');

  const claude = norm(join(home, '.claude'));
  if (within(claude)) {
    const rel = s.slice(claude.length + 1).split('\\');
    // only plugins/cache/<market>/<plugin>/<version>[/...] is allowed
    if (!(rel[0] === 'plugins' && rel[1] === 'cache' && rel.length >= 5)) return yes('~/.claude (plugin 캐시 버전 폴더만 허용)');
  }
  if (within(join(home, '.claude-mem'))) return yes('~/.claude-mem');

  if (s === norm(env.tmp)) return yes('임시 폴더 자체 (하위 항목만 허용)');
  if (within(join(env.tmp, 'claude'))) return yes('실행 중인 Claude 세션 폴더');
  if (within(join(env.tmp, 'machine-map.html'))) return yes('machine-map.html');
  if (within(env.repo)) return yes('ai-setup 저장소');
  return { denied: false, reason: '' };
}
