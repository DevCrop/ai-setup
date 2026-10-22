// Junk detectors. Every detector takes an injected env and returns Junk[] per machine/CONTRACT.md.
// env: { home, tmp, localAppData, appData, windir, drives, idx, sizeOf, git(args, cwd), listInstalledApps(), now? }
//   sizeOf(path) -> { s, m, ms, node } | null (null = outside the walked roots, so the item is skipped)
//   git(args, cwd) -> Promise<{ ok, out }>; listInstalledApps() -> Promise<[{ name, publisher, location }]>
// Junk.path always comes from the walk node, never from text read out of files or git output.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { pkey } from './walk.mjs';
import { resolveCacheDir, CACHE_TOOLS } from './caches.mjs';
import { isDenied } from './deny.mjs';
import { OLD_VERSION_ROOTS, AI_TEMP_ROOTS, EDITOR_STATE_ROOTS, CRASH_EXTRA, groupKey, newestOf, versionOf, compareVersions, APPDATA_SKIP, APPDATA_MIN_BYTES, APPDATA_MIN_AGE_DAYS, DEV_MIN_AGE_DAYS, APP_CACHE_PATHS, tierOf } from './rules.mjs';

const DAY = 86400e3;
const MB = 1024 * 1024;
const slashKey = (p) => pkey(p).replace(/\\/g, '/').replace(/\/+$/, '');
// <tmp>\claude holds live Claude session scratch (fixtures, repos): never flag anything inside it.
const underClaudeTmp = (env, p) => !!env.tmp && `${slashKey(p)}/`.startsWith(`${slashKey(path.join(env.tmp, 'claude'))}/`);
const exists = (p) => fs.stat(p).then(() => true, () => false);
const realOr = async (p) => fs.realpath(p).catch(() => p);
const dirNames = async (p) => (await fs.readdir(p, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory()).map((e) => e.name);

// Default safety tier and plain-Korean "can I delete it?" sentence per category (call sites may override effect).
const EFFECT = {
  temp: '프로그램이 잠깐 쓰고 남긴 임시 파일이라 지워도 괜찮습니다. 사용 중인 파일은 건너뜁니다.',
  'pkg-cache': '다음에 패키지를 설치할 때 인터넷에서 다시 받습니다. 그 외 영향 없음.',
  'dev-artifact': '그 프로젝트를 다시 실행하려면 npm install 등으로 다시 설치해야 합니다. 직접 작성한 코드는 그대로입니다.',
  'orphan-worktree': '작업용으로 복사해 둔 폴더입니다. 원본 저장소는 그대로이고, 이 폴더에만 있던 파일은 사라집니다.',
  'plugin-cache': '더 이상 쓰지 않는 예전 버전 파일이라 영향이 없습니다.',
  'appdata-orphan': '이미 지운 프로그램의 설정·데이터일 수 있습니다. 지우면 되돌릴 수 없는 자료가 있을 수 있으니 내용을 확인하세요.',
  'recycle-bin': '휴지통을 비우면 그 안의 파일은 다시 복구할 수 없습니다.',
  'crash-dump': '프로그램이 갑자기 꺼진 원인을 분석하는 용도의 파일입니다. 오류 문의를 할 일이 없으면 지워도 됩니다.',
  'vm-disk': 'Docker/WSL/가상 머신의 모든 데이터가 이 파일 하나에 들어 있습니다. 직접 지우면 그 안의 내용이 전부 사라집니다.',
  'browser-cache': '다음 방문 때 사이트가 조금 늦게 열릴 수 있고, 로그인·즐겨찾기는 그대로입니다.',
  'shader-cache': '게임·그래픽 프로그램을 처음 켤 때 잠깐 더 느릴 수 있고, 곧 자동으로 다시 만들어집니다.',
  'app-cache': '앱이 필요한 것을 다시 내려받아 처음 열 때만 조금 느릴 수 있습니다. 로그인과 설정은 그대로입니다.',
  'system-cleanup': 'Windows 업데이트·로그 찌꺼기입니다. 관리자 권한의 Windows 디스크 정리로 안전하게 지울 수 있습니다.',
  'ai-old-version': '새 버전이 이미 설치돼 있어 지워도 됩니다. 프로그램은 최신 버전으로 계속 동작합니다.',
  'ai-temp': 'AI 도구가 남긴 임시 파일입니다. 지워도 필요할 때 다시 만들어집니다.',
  'editor-state': '그 프로젝트를 다시 열면 이전 되돌리기 내역과 채팅·패널 상태 없이 시작합니다. 소스 파일은 그대로입니다.',
  'ai-history': '대화 기록입니다. 지우면 지난 대화를 다시 볼 수 없습니다 — 필요 없을 때만 직접 지우세요.',
  'old-download': '오래전에 받아 둔 파일입니다. 지우면 다시 받아야 할 수 있으니 필요한 파일인지 직접 확인하세요.',
};

function junk(category, node, { size, mtime, score, label, reason, how, action, tool, effect, safety }) {
  const p = node.p ?? node.path;
  const j = { id: `${category}:${p}`, category };
  if (tool) j.tool = tool;
  return Object.assign(j, {
    label, path: p, size: size ?? node.s, mtime: mtime ?? node.m, score, reason, how, action,
    safety: safety ?? tierOf(category), effect: effect ?? EFFECT[category],
  });
}

/** Sized junk for an existing walked path, or null. */
function sized(env, p, fields) {
  const z = env.sizeOf(p);
  return z && z.s > 0 ? junk(fields.category, z.node, fields) : null;
}

// ---- temp ----
export async function detectTemp(env) {
  const out = [];
  const now = env.now ?? Date.now();
  const seen = new Set();
  // %TEMP% may be relocated while apps still hardcode %LOCALAPPDATA%\Temp, so scan all three; dedupe by realpath.
  const roots = [env.tmp, env.localAppData && path.join(env.localAppData, 'Temp'), env.windir && path.join(env.windir, 'Temp')];
  for (const dir of roots) {
    if (!dir) continue;
    const rk = pkey(await realOr(dir));
    if (seen.has(rk)) continue;
    seen.add(rk);
    const z = env.sizeOf(dir);
    if (!z) continue;
    const ents = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    let size = 0;
    let newest = 0;
    for (const e of ents) {
      const lower = e.name.toLowerCase();
      if (lower === 'claude' || /^machine-map.*\.html$/.test(lower) || e.isSymbolicLink()) continue;
      const cp = path.join(dir, e.name);
      let s;
      let m;
      if (e.isDirectory()) {
        const cz = env.sizeOf(cp);
        if (!cz) continue;
        ({ s, m } = cz);
      } else {
        const st = await fs.lstat(cp).catch(() => null);
        if (!st) continue;
        s = st.size;
        m = Math.floor(st.mtimeMs);
      }
      if (now - m < DAY) continue;
      size += s;
      if (m > newest) newest = m;
    }
    if (size > 0) {
      out.push(junk('temp', z.node, {
        category: 'temp', size, mtime: newest, score: 0.9, label: '임시 파일',
        reason: '하루 넘게 쓰이지 않은 임시 파일입니다. 프로그램이 필요하면 다시 만듭니다.',
        how: '하루 지난 항목만 휴지통으로 이동 (사용 중인 파일은 건너뜀)', action: 'recycle',
      }));
    }
  }
  return out;
}

// ---- pkg-cache ----
export async function detectPkgCache(env) {
  const gr = '휴지통으로 이동 (다음 빌드 때 다시 받음)';
  const meta = {
    npm: ['npm 캐시', 'npm cache clean --force', 'command'],
    pnpm: ['pnpm 저장소', 'pnpm store prune', 'command'],
    yarn: ['Yarn 캐시', 'yarn cache clean', 'command'],
    pip: ['pip 캐시', 'pip cache purge', 'command'],
    uv: ['uv 캐시', 'uv cache clean', 'command'],
    bun: ['bun 캐시', 'bun pm cache rm', 'command'],
    nuget: ['NuGet 패키지 캐시', 'dotnet nuget locals all --clear', 'command'],
    gradle: ['Gradle 캐시', gr, 'recycle'],
  };
  const probe = env.probe ?? (async () => ({ code: 1, stdout: '' }));
  const out = [];
  const seen = new Set();
  for (const tool of CACHE_TOOLS) {
    // Command tools are only reported when installed (`<tool> --version` works; NuGet needs dotnet); requireTool is passed too.
    if (tool !== 'gradle' && (await probe([tool === 'nuget' ? 'dotnet' : tool, '--version']).catch(() => ({ code: 1 }))).code !== 0) continue;
    const p = await resolveCacheDir(tool, { probe, env: { home: env.home, localAppData: env.localAppData }, requireTool: tool !== 'gradle' });
    if (!p || !path.isAbsolute(p) || seen.has(pkey(p))) continue;
    seen.add(pkey(p));
    const [label, how, action] = meta[tool];
    const note = tool === 'pnpm' ? ' store prune은 안 쓰는 패키지만 지웁니다 — 실제 확보량은 더 적을 수 있음' : '';
    const j = sized(env, p, {
      category: 'pkg-cache', tool, score: 0.9, label, action, how: how + (note && ` (${note.trim()})`),
      reason: `${tool}이(가) 필요할 때 다시 받을 수 있는 다운로드 캐시입니다.${note}`,
      effect: note ? `${EFFECT['pkg-cache']}${note}` : undefined,
    });
    if (j) out.push(j);
  }
  return out;
}

// ---- dev-artifact ----
export async function detectDevArtifact(env, { days = DEV_MIN_AGE_DAYS, minBytes = MB } = {}) {
  const now = env.now ?? Date.now();
  const out = [];
  for (const { node, parent } of env.idx.artifacts) {
    // shortcut: a project is the artifact's direct parent; monorepo nesting is judged by that folder only.
    if (!parent.proj || node.s < minBytes || underClaudeTmp(env, node.p)) continue;
    if (!parent.ms || now - parent.ms < days * DAY) continue;
    out.push(junk('dev-artifact', node, {
      score: 0.8, label: `개발 산출물 (${node.name})`, action: 'recycle',
      reason: `${days}일 넘게 손대지 않은 프로젝트의 ${node.name} 폴더입니다. 다시 설치/빌드하면 만들어집니다.`,
      how: '휴지통으로 이동 (필요할 때 npm install, 빌드 등으로 재생성)',
    }));
  }
  return out;
}

// ---- orphan-worktree ----
function parsePorcelain(text) {
  return text.split(/\r?\n\r?\n/).map((blk) => {
    const e = {};
    for (const line of blk.split(/\r?\n/)) {
      const [k, ...rest] = line.split(' ');
      if (k === 'worktree') e.path = rest.join(' ');
      else if (k === 'HEAD') e.head = rest.join(' ');
      else if (k === 'bare' || k === 'locked' || k === 'prunable' || k === 'detached') e[k] = true;
    }
    return e;
  }).filter((e) => e.path);
}

async function readGitdir(dir) {
  try {
    const fp = path.join(dir, '.git');
    const st = await fs.stat(fp);
    if (!st.isFile() || st.size > 4096) return null;
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(await fs.readFile(fp, 'utf8'));
    return m ? path.resolve(dir, m[1]) : null;
  } catch {
    return null;
  }
}

/**
 * Mirrors configRisk in clean.mjs (not exported there). Reading config executes nothing. Only the repo-local file, plus the
 * per-worktree file when extensions.worktreeConfig is on, is checked: the user's global config (git-lfs filters) is theirs.
 * Exit 1 = no matching key; anything printed or any other failure counts as a risk.
 */
async function configRisk(env, dir) {
  const re = '^(include\\.|includeif\\.|filter\\.|core\\.fsmonitor|core\\.hookspath|core\\.sshcommand|diff\\.|merge\\.)';
  const run = async (...a) => {
    const r = await env.git(['config', ...a], dir);
    return { ...r, code: r.code ?? (r.ok ? 0 : 1) };
  };
  const ext = await run('--local', '--bool', '--get', 'extensions.worktreeConfig');
  if (![0, 1].includes(ext.code)) return true;
  const scopes = ['--local', ...(ext.code === 0 && ext.out.trim() === 'true' ? ['--worktree'] : [])];
  for (const scope of scopes) {
    const r = await run(scope, '--get-regexp', re);
    if (![0, 1].includes(r.code) || r.out.trim()) return true;
  }
  return false;
}

export async function detectOrphanWorktree(env) {
  const out = [];
  const parents = new Map(); // slashKey(common dir) -> { repoDir, common, list, branch }
  const getParent = async (common) => {
    const k = slashKey(common);
    if (parents.has(k)) return parents.get(k);
    const repoDir = path.basename(common).toLowerCase() === '.git' ? path.dirname(common) : common;
    const p = { repoDir, common, list: null, branch: null };
    parents.set(k, p);
    const r = await env.git(['worktree', 'list', '--porcelain'], repoDir);
    if (r.ok) p.list = parsePorcelain(r.out);
    return p;
  };
  const defaultBranch = async (p) => {
    if (p.branch !== null) return p.branch || null;
    const names = [];
    const h = await env.git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], p.repoDir);
    if (h.ok && h.out.trim()) names.push(h.out.trim().replace(/^origin\//, ''));
    names.push('main', 'master');
    p.branch = '';
    for (const n of names) {
      if ((await env.git(['rev-parse', '--verify', '--quiet', `refs/heads/${n}`], p.repoDir)).ok) { p.branch = n; break; }
    }
    return p.branch || null;
  };
  const inClaudeWt = (p, dir) => slashKey(dir).startsWith(`${slashKey(path.join(p.repoDir, '.claude', 'worktrees'))}/`);

  const commons = new Set();
  for (const dir of env.idx.gitFiles) {
    const g = await readGitdir(dir);
    // Only `<common>/worktrees/<id>` pointers are worktrees; submodule pointers (`modules/`) are never touched.
    if (!g || path.basename(path.dirname(g)).toLowerCase() !== 'worktrees') continue;
    const common = path.dirname(path.dirname(g));
    commons.add(common);
    const z = env.sizeOf(dir);
    if (!z || underClaudeTmp(env, dir)) continue;
    const p = await getParent(common);
    if (inClaudeWt(p, dir)) continue;

    let why = null;
    let how = null;
    let action = 'recycle';
    let effect;
    // A missing drive (unplugged disk) must not make a live worktree look orphaned.
    if (!(await exists(g)) && (await exists(path.parse(g).root || '.'))) {
      why = '연결된 git 저장소 기록이 없어진 고아 워크트리 폴더입니다.';
      how = '휴지통으로 이동';
    } else if (p.list) {
      const real = slashKey(await realOr(dir));
      const entry = p.list.find((e) => slashKey(e.path) === slashKey(dir) || slashKey(e.path) === real);
      let entryReal = entry;
      if (!entry) {
        for (const e of p.list) if (slashKey(await realOr(e.path)) === real) { entryReal = e; break; }
      }
      if (!entryReal) {
        why = '원본 저장소의 worktree 목록에 없는 고아 워크트리 폴더입니다.';
        how = '휴지통으로 이동';
      } else if (!entryReal.prunable && !entryReal.locked && !entryReal.bare && entryReal.head) {
        // Codex keeps live detached worktrees under ~/.codex/worktrees: only touch ones idle for 14+ days.
        const codexWt = env.home && `${slashKey(dir)}/`.startsWith(`${slashKey(path.join(env.home, '.codex', 'worktrees'))}/`);
        if (codexWt && (env.now ?? Date.now()) - z.m < 14 * DAY) continue;
        const br = await defaultBranch(p);
        if (!br) continue;
        const anc = await env.git(['merge-base', '--is-ancestor', entryReal.head, br], p.repoDir);
        if (!anc.ok) continue;
        // A repo config that can run external programs (filters, fsmonitor, hooks, ...) makes `git status` unsafe: do not run it.
        // Config that can run programs, or submodules (status would recurse into them): never run status, hand it to the user.
        const noCheck = (await configRisk(env, dir)) ? '저장소 설정에 외부 프로그램 실행 항목이 있어 자동 확인하지 않았습니다'
          : (await exists(path.join(dir, '.gitmodules'))) ? '서브모듈이 있어 자동 확인하지 않았습니다' : null;
        if (noCheck) {
          out.push(junk('orphan-worktree', z.node, {
            score: 0.3, label: '고아 워크트리', safety: 'manual', action: 'report',
            reason: noCheck,
            how: `직접 확인 후 git worktree remove "${z.node.p}" (원본 저장소 ${p.repoDir}에서 실행)`,
          }));
          continue;
        }
        const status = await env.git(['status', '--porcelain', '--ignore-submodules=all'], dir);
        if (!status.ok || status.out.trim()) continue;
        why = `작업이 모두 ${br} 브랜치에 병합되었고 변경 사항이 없는 워크트리입니다.`;
        how = `git worktree remove "${z.node.p}" (원본 저장소 ${p.repoDir}에서 실행, 변경 사항이 있으면 거부됨)`;
        action = 'command';
        effect = `작업 내용이 이미 ${br} 브랜치에 합쳐져 있어 잃는 것이 없습니다. 변경 사항이 있으면 git이 삭제를 거부합니다.`;
      }
    }
    if (why) out.push(junk('orphan-worktree', z.node, { score: 0.7, label: '고아 워크트리', reason: why, how, action, effect }));
  }

  // Rule (c): repos with prunable entries. Also look at repos found in the walk that have a worktrees/ dir.
  for (const repo of env.idx.repos) {
    const common = path.join(repo, '.git');
    if (await exists(path.join(common, 'worktrees'))) commons.add(common);
  }
  for (const common of commons) {
    if (underClaudeTmp(env, common)) continue;
    const p = await getParent(common);
    const n = (p.list ?? []).filter((e) => e.prunable && !inClaudeWt(p, e.path)).length;
    if (!n) continue;
    const wz = env.sizeOf(path.join(common, 'worktrees'));
    const rz = env.sizeOf(p.repoDir);
    out.push(junk('orphan-worktree', { p: rz ? rz.node.p : p.repoDir }, {
      size: wz ? wz.s : 0, mtime: wz ? wz.m : 0, score: 0.7, label: `삭제된 워크트리 기록 ${n}개`,
      reason: '폴더가 이미 지워져 git에 기록만 남은 워크트리입니다.',
      how: `git -C "${p.repoDir}" worktree prune`, action: 'command',
      effect: '이미 지워진 작업 폴더의 git 기록만 정리합니다. 파일은 건드리지 않습니다.',
    }));
  }
  return out;
}

// ---- plugin-cache ----
function collectInstallPaths(v, acc = []) {
  if (Array.isArray(v)) v.forEach((x) => collectInstallPaths(x, acc));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (k === 'installPath' && typeof x === 'string') acc.push(x);
      else collectInstallPaths(x, acc);
    }
  }
  return acc;
}

export async function detectPluginCache(env) {
  if (!env.home) return [];
  const root = path.join(env.home, '.claude', 'plugins');
  let refs;
  try {
    refs = collectInstallPaths(JSON.parse(await fs.readFile(path.join(root, 'installed_plugins.json'), 'utf8'))).map(slashKey);
  } catch {
    return []; // unreadable registry: flag nothing
  }
  if (!refs.length) return [];
  const out = [];
  const cache = path.join(root, 'cache');
  for (const market of await dirNames(cache)) {
    for (const plugin of await dirNames(path.join(cache, market))) {
      for (const ver of await dirNames(path.join(cache, market, plugin))) {
        const vp = path.join(cache, market, plugin, ver);
        const k = slashKey(vp);
        if (refs.some((r) => r === k || r.startsWith(`${k}/`))) continue;
        const j = sized(env, vp, {
          category: 'plugin-cache', score: 0.8, label: `플러그인 캐시 (${plugin} ${ver})`, action: 'recycle',
          reason: '설치된 플러그인 목록(installed_plugins.json)이 쓰지 않는 예전 버전 캐시입니다.',
          how: '휴지통으로 이동',
        });
        if (j) out.push(j);
      }
    }
  }
  return out;
}

// ---- appdata-orphan ----
const nz = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9가-힣]/g, '');

/** True when `name` fuzzy-matches an installed app (DisplayName/Publisher/InstallLocation); too-short names count as matched so callers skip them. */
export function matchesInstalledApp(name, apps) {
  const folder = name;
  const f = nz(folder);
  if (f.length < 3) return true; // too short to judge: treat as matched, i.e. skip
  const fl = folder.toLowerCase();
  return apps.some((a) => {
    if ([a.name, a.publisher, path.basename(a.location || '')].some((x) => { const n = nz(x); return n.length >= 3 && (n.includes(f) || f.includes(n)); })) return true;
    return (a.location || '').toLowerCase().split(/[\\/]+/).includes(fl);
  });
}

export async function detectAppdataOrphan(env, { minBytes = APPDATA_MIN_BYTES, days = APPDATA_MIN_AGE_DAYS } = {}) {
  const now = env.now ?? Date.now();
  const roots = [env.appData, env.localAppData].filter(Boolean);
  if (!roots.length) return [];
  const apps = await env.listInstalledApps();
  if (!apps.length) return []; // registry unreadable: flag nothing
  const out = [];
  for (const r of roots) {
    for (const name of await dirNames(r)) {
      if (name.startsWith('.') || APPDATA_SKIP.has(name.toLowerCase()) || matchesInstalledApp(name, apps)) continue;
      const z = env.sizeOf(path.join(r, name));
      if (!z || z.s < minBytes) continue;
      // Same "newest mtime" as the cleaner: newest file in the subtree or the folder's own mtime.
      const st = await fs.stat(z.node.p).catch(() => null);
      const m = Math.max(z.m, st ? Math.floor(st.mtimeMs) : 0);
      if (!m || now - m < days * DAY) continue;
      out.push(junk('appdata-orphan', z.node, {
        mtime: m, score: 0.4, label: `앱 데이터 (${name})`, action: 'recycle',
        reason: `설치된 앱 목록에서 찾지 못한 폴더이고 ${days}일 넘게 쓰이지 않았습니다. 확신이 낮으니 직접 확인하세요.`,
        how: '내용을 확인한 뒤 휴지통으로 이동',
      }));
    }
  }
  return out;
}

// ---- recycle-bin ----
export async function detectRecycleBin(env) {
  const out = [];
  for (const d of env.drives ?? []) {
    const j = sized(env, path.join(d, '$Recycle.Bin'), {
      category: 'recycle-bin', score: 0.6, label: `휴지통 (${d.slice(0, 2)})`, action: 'report',
      reason: '이미 지운 파일이 휴지통에 남아 차지하는 공간입니다.',
      how: 'Windows 휴지통에서 직접 비우세요.',
    });
    if (j) out.push(j);
  }
  return out;
}

// ---- crash-dump ----
export async function detectCrashDump(env) {
  const out = [];
  const dirs = [env.localAppData && path.join(env.localAppData, 'CrashDumps'), env.windir && path.join(env.windir, 'Minidump')].filter(Boolean);
  for (const d of dirs) {
    const j = sized(env, d, {
      category: 'crash-dump', score: 0.9, label: '충돌 덤프 폴더', action: 'recycle',
      reason: '프로그램이 죽을 때 남긴 진단용 덤프 파일입니다.', how: '휴지통으로 이동',
    });
    if (j) out.push(j);
  }
  for (const d of CRASH_EXTRA(env)) {
    const j = cacheJunk(env, d, {
      category: 'crash-dump', score: 0.9, label: `${/[\\/]Cursor[\\/]/i.test(d) ? 'Cursor' : 'VS Code'} 충돌 보고서`, action: 'recycle',
      reason: '편집기가 죽을 때 남긴 진단용 보고서입니다.', how: '내용물을 휴지통으로 이동 (사용 중인 파일은 건너뜀)',
    });
    if (j) out.push(j);
  }
  if (env.localAppData) {
    const la = `${slashKey(env.localAppData)}/`;
    const inDumps = dirs.map((d) => `${slashKey(d)}/`);
    for (const f of env.idx.files) {
      const k = slashKey(f.path);
      if (!f.path.toLowerCase().endsWith('.dmp') || !k.startsWith(la) || inDumps.some((d) => k.startsWith(d))) continue;
      out.push(junk('crash-dump', { p: f.path }, {
        size: f.size, mtime: f.mtime, score: 0.9, label: '충돌 덤프 파일', action: 'recycle',
        reason: '프로그램이 죽을 때 남긴 진단용 덤프 파일입니다.', how: '휴지통으로 이동',
      }));
    }
  }
  return out;
}

// ---- vm-disk ----
export async function detectVmDisk(env) {
  return env.idx.files.filter((f) => f.path.toLowerCase().endsWith('.vhdx')).map((f) => junk('vm-disk', { p: f.path }, {
    size: f.size, mtime: f.mtime, score: 0.2, label: '가상 디스크 (VHDX)', action: 'report',
    reason: 'Docker/WSL/가상머신 디스크 이미지입니다. 안에 데이터가 들어 있어 직접 지우면 안 됩니다.',
    how: 'Docker Desktop 또는 wsl --manage 로 정리하세요.',
  }));
}

// ---- browser-cache ----
export async function detectBrowserCache(env) {
  const la = env.localAppData;
  if (!la) return [];
  const out = [];
  const add = (name, p) => {
    const j = sized(env, p, {
      category: 'browser-cache', score: 0.8, label: `${name} 캐시`, action: 'recycle',
      reason: '브라우저가 웹 페이지를 빨리 열려고 저장한 캐시입니다. 지워도 다시 쌓입니다.',
      how: '휴지통으로 이동 (브라우저를 닫고 진행, 사용 중인 파일은 건너뜀)',
    });
    if (j) out.push(j);
  };
  const chromium = [['Chrome', 'Google', 'Chrome'], ['Edge', 'Microsoft', 'Edge'], ['Brave', 'BraveSoftware', 'Brave-Browser']];
  for (const [name, a, b] of chromium) {
    const ud = path.join(la, a, b, 'User Data');
    for (const prof of await dirNames(ud)) {
      for (const c of ['Cache', 'Code Cache', 'GPUCache']) add(name, path.join(ud, prof, c));
    }
  }
  const ff = path.join(la, 'Mozilla', 'Firefox', 'Profiles');
  for (const prof of await dirNames(ff)) add('Firefox', path.join(ff, prof, 'cache2'));
  return out;
}

// ---- helpers for recycle-children categories ----
/** Size of what clean.mjs would actually recycle in dir: the subtree minus <tmp>\claude when that lives inside it. */
function cacheJunk(env, dir, fields) {
  const z = env.sizeOf(dir);
  if (!z) return null;
  let size = z.s;
  if (env.tmp) {
    const c = path.join(env.tmp, 'claude');
    if (slashKey(c).startsWith(`${slashKey(dir)}/`)) size -= env.sizeOf(c)?.s ?? 0;
  }
  return size > 0 ? junk(fields.category, z.node, { ...fields, size }) : null;
}

// ---- shader-cache ----
export async function detectShaderCache(env) {
  const la = env.localAppData;
  if (!la) return [];
  const dirs = [[['D3DSCache'], 'DirectX'], [['NVIDIA', 'DXCache'], 'NVIDIA DirectX'], [['NVIDIA', 'GLCache'], 'NVIDIA OpenGL'], [['AMD', 'DxCache'], 'AMD DirectX']];
  const out = [];
  for (const [rel, name] of dirs) {
    const j = cacheJunk(env, path.join(la, ...rel), {
      category: 'shader-cache', score: 0.85, label: `${name} 셰이더 캐시`, action: 'recycle',
      reason: '그래픽 드라이버가 게임·앱 속도를 위해 저장해 둔 캐시이며 필요하면 자동으로 다시 만들어집니다.',
      how: '내용물을 휴지통으로 이동 (사용 중인 파일은 건너뜀)',
    });
    if (j) out.push(j);
  }
  return out;
}

// ---- app-cache ----
export async function detectAppCache(env) {
  const out = [];
  const how = '내용물을 휴지통으로 이동 (앱을 닫고 진행, 사용 중인 파일은 건너뜀)';
  for (const p of APP_CACHE_PATHS(env)) {
    const name = path.win32.basename(path.win32.dirname(p));
    const j = cacheJunk(env, p, {
      category: 'app-cache', score: 0.8, label: `${name} ${path.win32.basename(p)}`, action: 'recycle', how,
      reason: `${name} 앱이 빨리 열리려고 저장한 캐시이며 앱이 다시 만듭니다.`,
    });
    if (j) out.push(j);
  }
  if (env.localAppData) {
    const win = path.join(env.localAppData, 'Microsoft', 'Windows');
    const j1 = cacheJunk(env, path.join(win, 'INetCache'), {
      category: 'app-cache', score: 0.8, label: '인터넷 임시 파일 (INetCache)', action: 'recycle', how,
      reason: 'Windows와 일부 앱이 웹에서 받아 둔 임시 파일입니다.',
    });
    const j2 = cacheJunk(env, path.join(win, 'WER'), {
      category: 'app-cache', score: 0.8, label: 'Windows 오류 보고 기록 (WER)', action: 'recycle', how,
      reason: '프로그램 오류가 났을 때 Windows가 남긴 보고서입니다.',
      effect: '지난 오류 보고 기록만 사라지고 Windows 사용에는 영향이 없습니다.',
    });
    out.push(...[j1, j2].filter(Boolean));
  }
  return out;
}

// ---- system-cleanup: needs admin to clean, so report only; unreadable dirs have no size and are skipped silently ----
export async function detectSystemCleanup(env) {
  if (!env.windir) return [];
  const dirs = [
    [['SoftwareDistribution', 'Download'], 'Windows 업데이트 다운로드 파일'],
    [['Logs', 'CBS'], 'Windows 업데이트 로그 (CBS)'],
    [['ServiceProfiles', 'NetworkService', 'AppData', 'Local', 'Microsoft', 'Windows', 'DeliveryOptimization'], 'Windows 전송 최적화 캐시'],
  ];
  const out = [];
  for (const [rel, label] of dirs) {
    const j = sized(env, path.join(env.windir, ...rel), {
      category: 'system-cleanup', score: 0.5, label, action: 'report',
      reason: 'Windows가 업데이트 과정에서 남긴 파일입니다. 관리자 권한이 있어야 정리할 수 있습니다.',
      how: 'Windows 디스크 정리(cleanmgr) → 시스템 파일 정리',
    });
    if (j) out.push(j);
  }
  return out;
}

// ---- old-download: big files come from the walk (idx.big), one junk per file ----
export async function detectOldDownload(env, { minBytes = 100 * MB, days = 90 } = {}) {
  if (!env.home) return [];
  const now = env.now ?? Date.now();
  const base = `${slashKey(path.join(env.home, 'Downloads'))}/`;
  const installer = /\.(exe|msi|zip|iso|7z)$/i;
  return (env.idx.big ?? [])
    .filter((f) => slashKey(f.path).startsWith(base) && f.size >= minBytes && now - f.mtime >= days * DAY)
    .map((f) => junk('old-download', { p: f.path }, {
      size: f.size, mtime: f.mtime, score: 0.3, action: 'report',
      label: installer.test(f.path) ? '오래된 설치 파일/압축 파일' : '오래된 큰 파일',
      reason: `다운로드 폴더에서 ${days}일 넘게 열지 않은 큰 파일입니다.`,
      how: '다운로드 폴더는 보호 폴더라 자동으로 지우지 않습니다. 직접 확인 후 삭제하세요.',
    }));
}

// ---- AI tools and editors: ai-old-version, ai-temp, editor-state, ai-history ----
/** Direct children of dir (files and folders, no symlinks) with the size/newest-mtime a recycle would free. */
async function childEntries(env, dir, { ownMtime = false } = {}) {
  const ents = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const out = [];
  for (const e of ents) {
    if (e.isSymbolicLink()) continue;
    const p = path.join(dir, e.name);
    let s;
    let m;
    if (e.isDirectory()) {
      const z = env.sizeOf(p);
      if (!z) continue;
      ({ s, m } = z);
      if (ownMtime) m = Math.max(m, Math.floor((await fs.stat(p).catch(() => null))?.mtimeMs ?? 0));
    } else {
      const st = await fs.lstat(p).catch(() => null);
      if (!st) continue;
      s = st.size;
      m = Math.floor(st.mtimeMs);
    }
    out.push({ name: e.name, path: p, s, m });
  }
  return out;
}

/** One junk for a container dir whose old children get recycled: size/mtime cover only the qualifying children. */
async function staleChildrenJunk(env, root, minAgeDays, fields, opts) {
  const z = env.sizeOf(root);
  if (!z) return null;
  const now = env.now ?? Date.now();
  let size = 0;
  let newest = 0;
  for (const c of await childEntries(env, root, opts)) {
    if (now - c.m < minAgeDays * DAY) continue;
    size += c.s;
    if (c.m > newest) newest = c.m;
  }
  return size > 0 ? junk(fields.category, z.node, { ...fields, size, mtime: newest }) : null;
}

// ai-old-version: keep the newest version per group, one junk per older folder/file.
export async function detectAiOldVersion(env) {
  const out = [];
  const label = { 'claude-cli': 'Claude Code', 'claude-desktop-cc': 'Claude 데스크톱 내장 Claude Code', 'vscode-ext': 'VS Code 확장', 'cursor-ext': 'Cursor 확장' };
  for (const { root, kind } of OLD_VERSION_ROOTS(env)) {
    const kids = await childEntries(env, root);
    const groups = new Map();
    for (const k of kids) {
      const g = groupKey(k.name, kind);
      if (g === null) continue; // unparseable names are never touched
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(k);
    }
    for (const members of groups.values()) {
      const keep = newestOf(members.map((k) => k.name), kind);
      if (!keep) continue;
      const keepV = versionOf(keep, kind);
      for (const k of members) {
        // every build of the newest version (platform variants) stays
        if (k.s <= 0 || compareVersions(versionOf(k.name, kind), keepV) === 0) continue;
        out.push(junk('ai-old-version', { p: k.path }, {
          size: k.s, mtime: k.m, score: 0.85, safety: 'safe', action: 'recycle', label: `${label[kind]} 이전 버전 (${k.name})`,
          reason: `같은 프로그램의 더 새로운 버전(${keep})이 이미 설치되어 있습니다.`,
          how: '휴지통으로 이동 (사용 중인 파일은 건너뜀)',
        }));
      }
    }
  }
  return out;
}

// ---- ai-temp ----
export async function detectAiTemp(env) {
  const out = [];
  const names = [
    [/[\\/]\.codex[\\/]\.tmp$/i, 'Codex 임시 파일', 'Codex가 작업 중에 잠깐 쓰고 남긴 임시 파일입니다. 지워도 필요할 때 다시 만들어집니다.'],
    [/[\\/]\.codex[\\/]cache$/i, 'Codex 캐시', 'Codex가 빨리 동작하려고 저장한 캐시입니다. 지워도 필요할 때 다시 만들어집니다.'],
    [/[\\/]\.codex[\\/]\.sandbox-recovery$/i, 'Codex 샌드박스 복구 파일', '샌드박스 작업이 중단됐을 때를 대비해 남겨 둔 복구용 파일입니다. 오래된 것만 지우며, 최근 작업을 복구할 일이 없으면 지워도 됩니다.'],
    [/[\\/]\.claude[\\/]plugins[\\/]\.trash$/i, 'Claude 플러그인 휴지통', '플러그인을 지울 때 임시로 옮겨 둔 폴더입니다. 비워도 영향이 없습니다.'],
    [/[\\/]claude$/i, '지난 Claude Code 세션 임시 폴더', '지난 Claude Code 작업이 남긴 임시 폴더입니다. 7일 넘게 쓰이지 않은 것만 지우며, 그 작업의 임시 산출물은 사라집니다.'],
  ];
  for (const { root, minAgeDays, tier } of AI_TEMP_ROOTS(env)) {
    const [, label, effect] = names.find(([re]) => re.test(root)) ?? [null, 'AI 도구 임시 파일', undefined];
    const j = await staleChildrenJunk(env, root, minAgeDays, {
      category: 'ai-temp', score: tier === 'safe' ? 0.9 : 0.7, safety: tier, label, effect, action: 'recycle',
      reason: minAgeDays ? `AI 도구가 남긴 임시 파일 중 ${minAgeDays}일 넘게 쓰이지 않은 것들입니다.` : 'AI 도구가 남긴 임시 파일입니다.',
      how: '오래된 항목만 휴지통으로 이동 (사용 중인 파일은 건너뜀)',
    });
    if (j) out.push(j);
  }
  return out;
}

// ---- editor-state: stale per-project editor state; one junk per root, children recycled by the cleaner ----
export async function detectEditorState(env) {
  const out = [];
  for (const { root, minAgeDays } of EDITOR_STATE_ROOTS(env)) {
    const app = /[\\/]Cursor[\\/]/i.test(root) ? 'Cursor' : 'VS Code';
    const j = await staleChildrenJunk(env, root, minAgeDays, {
      category: 'editor-state', score: 0.6, safety: 'check', action: 'recycle', label: `${app} 오래된 작업 영역 기록`,
      reason: `${minAgeDays}일 넘게 열지 않은 프로젝트의 편집기 기록(되돌리기 내역, 채팅 패널 등)입니다.`,
      how: '오래된 항목만 휴지통으로 이동 (편집기를 닫고 진행)',
      effect: '그 프로젝트를 다시 열면 이전 되돌리기 내역과 열어 둔 채팅·패널 상태가 사라진 채 시작합니다. 소스 파일은 그대로입니다.',
    }, { ownMtime: true });
    if (j) out.push(j);
  }
  return out;
}

// ---- ai-history: report only ----
export async function detectAiHistory(env) {
  const out = [];
  const histEffect = '대화 기록입니다. 지우면 지난 대화를 다시 볼 수 없습니다 — 필요 없을 때만 직접 지우세요.';
  const base = { category: 'ai-history', score: 0.2, safety: 'manual', action: 'report' };
  const add = (p, label, extra = {}) => {
    const j = sized(env, p, { ...base, label, reason: '이전 대화·작업 기록이 쌓인 폴더입니다. 자동으로 지우지 않습니다.', how: '내용을 확인한 뒤 직접 정리하세요.', effect: histEffect, ...extra });
    if (j) out.push(j);
  };
  if (env.home) {
    add(path.join(env.home, '.codex', 'sessions'), 'Codex 대화 기록');
    add(path.join(env.home, '.codex', 'archived_sessions'), 'Codex 보관된 대화 기록');
    add(path.join(env.home, '.claude', 'projects'), 'Claude Code 대화 기록');
  }
  if (env.appData) {
    const cursorEffect = 'Cursor 채팅·에이전트 기록과 확장 데이터입니다. 지우면 기록이 사라집니다 — Cursor 안에서 오래된 채팅을 지우는 게 안전합니다.';
    add(path.join(env.appData, 'Cursor', 'User', 'globalStorage'), 'Cursor 채팅·에이전트 기록', { effect: cursorEffect, how: 'Cursor 안에서 오래된 채팅을 지우세요.' });
    const code = path.join(env.appData, 'Code', 'User', 'globalStorage');
    if ((env.sizeOf(code)?.s ?? 0) >= 1024 * MB) {
      add(code, 'VS Code 확장 데이터·기록', { effect: 'VS Code 확장 데이터와 채팅 기록입니다. 지우면 확장 설정과 기록이 사라집니다 — 필요 없을 때만 직접 지우세요.' });
    }
    // npm-global Claude Code is a duplicate once the native install exists.
    if (env.home && (await exists(path.join(env.home, '.local', 'share', 'claude', 'versions')))) {
      add(path.join(env.appData, 'npm', 'node_modules', '@anthropic-ai', 'claude-code'), 'npm 전역 Claude Code (중복 설치)', {
        reason: '같은 Claude Code가 새 방식으로 이미 설치되어 있어 npm으로 설치한 것은 중복입니다.',
        how: 'npm uninstall -g @anthropic-ai/claude-code',
        effect: '이미 따로 설치된 Claude Code(claude)가 있어 지워도 계속 동작합니다. 직접 명령어로 제거하세요.',
      });
    }
  }
  return out;
}

export async function detectAll(env) {
  const parts = await Promise.all([
    detectTemp, detectPkgCache, detectDevArtifact, detectOrphanWorktree, detectPluginCache,
    detectAppdataOrphan, detectRecycleBin, detectCrashDump, detectVmDisk, detectBrowserCache,
    detectShaderCache, detectAppCache, detectSystemCleanup, detectOldDownload,
    detectAiOldVersion, detectAiTemp, detectEditorState, detectAiHistory,
  ].map((f) => f(env)));
  const seen = new Set();
  const denyEnv = Object.fromEntries(Object.entries({
    home: env.home, windir: env.windir, tmp: env.tmp, appData: env.appData, localAppData: env.localAppData, ...env.denyEnv,
  }).filter(([, v]) => v !== undefined));
  return parts.flat().filter((j) => !seen.has(j.id) && seen.add(j.id)).map((j) => {
    // temp is exempt: its path is the temp dir itself, and clean.mjs only recycles children.
    if (['temp', 'ai-temp', 'ai-history'].includes(j.category) || !isDenied(j.path, denyEnv).denied) return j;
    return { ...j, action: 'report', safety: 'manual', score: Math.min(j.score, 0.3), reason: `${j.reason} (보호 폴더 안이라 자동 정리 대상이 아닙니다 — 직접 확인하세요)` };
  });
}

// ---- real-system helpers used by scan.mjs ----
/** Read-only probe for caches.mjs: fixed argv, never built from outside input. */
export function realProbe(argv) {
  return new Promise((resolve) => {
    // shell on Windows so npm.cmd/pnpm.cmd resolve; argv is a fixed constant list from caches.mjs.
    execFile(argv[0], argv.slice(1), { timeout: 20000, windowsHide: true, shell: process.platform === 'win32', maxBuffer: 1 << 20 },
      (err, stdout) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout ?? '') }));
  });
}

export function realGit(args, cwd) {
  return new Promise((resolve) => {
    // fsmonitor=false: a repo config must not make `git status` run a hook.
    execFile('git', ['-c', 'core.fsmonitor=false', ...args], {
      cwd, timeout: 30000, windowsHide: true, maxBuffer: 1 << 26, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    }, (err, stdout) => resolve({ ok: !err, code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: String(stdout ?? '') }));
  });
}

const UNINSTALL_KEYS = [
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
];

export function parseRegUninstall(text) {
  const apps = [];
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    if (/^HKEY_/.test(line)) { cur = {}; apps.push(cur); continue; }
    const m = /^\s+(DisplayName|Publisher|InstallLocation)\s+REG_(?:EXPAND_)?SZ\s+(.*)$/.exec(line);
    if (m && cur) cur[{ DisplayName: 'name', Publisher: 'publisher', InstallLocation: 'location' }[m[1]]] = m[2].trim();
  }
  return apps.filter((a) => a.name);
}

export function realListInstalledApps() {
  // chcp 65001 makes reg.exe print UTF-8 so Korean app names are not garbled into false "orphans".
  const run = (key) => new Promise((resolve) => {
    execFile('cmd.exe', ['/d', '/s', '/c', `"chcp 65001>nul && reg query "${key}" /s"`], {
      encoding: 'buffer', maxBuffer: 1 << 28, windowsHide: true, windowsVerbatimArguments: true,
    }, (err, stdout) => resolve(parseRegUninstall(Buffer.from(stdout ?? '').toString('utf8'))));
  });
  return Promise.all(UNINSTALL_KEYS.map(run)).then((r) => r.flat());
}
