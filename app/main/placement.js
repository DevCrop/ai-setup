// Pure helpers for main.js (no `electron` import, tested on CI).
import path from 'node:path';

// Saved strip position is reused only when the whole strip still lies inside one display's work area.
export function savedPosition(saved, size, workAreas) {
  if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return null;
  const inside = workAreas.some((a) => saved.x >= a.x && saved.y >= a.y
    && saved.x + size.width <= a.x + a.width && saved.y + size.height <= a.y + a.height);
  return inside ? { x: Math.round(saved.x), y: Math.round(saved.y) } : null;
}

// Desktop notice text when things got worse since the last status, else null.
// Only rising bad/warn counts notify; recovering, stale and starting states stay quiet.
export function noticeFor(prev, next) {
  if (!prev || !next || prev.state === 'starting') return null;
  const pc = prev.counts ?? { warn: 0, bad: 0 };
  const nc = next.counts ?? { warn: 0, bad: 0 };
  if (nc.bad > pc.bad) return { title: 'Claude Monitor: 문제', body: `문제가 ${nc.bad}건이 됐습니다. 눌러서 확인하세요.` };
  if (nc.warn > pc.warn) return { title: 'Claude Monitor: 확인 필요', body: `확인할 항목이 ${nc.warn}건이 됐습니다.` };
  if (next.state === 'error' && prev.state !== 'error') return { title: 'Claude Monitor: 수집 오류', body: '설정을 3번 연속 읽지 못했습니다.' };
  return null;
}

// C1 runs apply.sh; `bash` on PATH may be WSL, which would sync the wrong ~/.claude. Same lookup as bootstrap
// Get-GitBash: the usual install folders, then ..\bin\bash.exe next to a git.exe on PATH.
// shortcut: never falls back to PATH `bash`; with no Git Bash the C1 preview fails visibly instead.
export function gitBash(env, exists, p = path.win32) {
  const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA && p.join(env.LOCALAPPDATA, 'Programs')].filter(Boolean);
  const fixed = roots.map((r) => p.join(r, 'Git', 'bin', 'bash.exe'));
  const fromPath = (env.PATH || '').split(';').filter(Boolean)
    .filter((d) => exists(p.join(d, 'git.exe'))).map((d) => p.join(d, '..', 'bin', 'bash.exe'));
  return [...fixed, ...fromPath].find((f) => exists(f)) ?? 'git-bash-not-found';
}
