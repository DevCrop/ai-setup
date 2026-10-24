// Shared thresholds and lists (see machine/CONTRACT.md) so scanner, cleaner and page agree.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const W = path.win32;

// Folders directly under %APPDATA% / %LOCALAPPDATA% that are never reported as an appdata orphan.
export const APPDATA_SKIP = new Set([
  'microsoft', 'packages', 'temp', 'programs', 'publishers', 'connecteddevices', 'comms', 'd3dscache', 'virtualstore',
  'history', 'crashdumps', 'diagnostics', 'tempstate', 'packagemanagement', 'nuget', 'google', 'mozilla', 'bravesoftware',
  'npm', 'npm-cache', 'pnpm', 'yarn', 'pip', 'uv', 'node-gyp', 'nvidia', 'nvidia corporation', 'intel', 'amd', 'adobe',
  'apple computer', 'claude', 'code', 'jetbrains', 'docker', 'low', 'application data', 'ms-playwright', 'discord',
]);
export const APPDATA_MIN_BYTES = 50 * 2 ** 20;
export const APPDATA_MIN_AGE_DAYS = 180;
export const DEV_MIN_AGE_DAYS = 90;

// Electron/desktop apps whose cache lives at %APPDATA%\<app>\<dir>.
export const ELECTRON_APPS = ['Discord', 'Slack', 'Microsoft\\Teams', 'Code', 'Cursor', 'Notion', 'Spotify', 'Claude', 'obsidian'];
export const APP_CACHE_DIRS = ['Cache', 'Code Cache', 'GPUCache', 'CachedData'];

/** Store-app (MSIX) Claude desktop: %LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude\{Cache,Code Cache,GPUCache}. */
const packagedClaudeCaches = (env) => {
  if (!env?.localAppData) return [];
  const pk = W.join(env.localAppData, 'Packages');
  let names = [];
  try { names = fs.readdirSync(pk); } catch { /* no Packages dir */ }
  return names.filter((n) => /^Claude_/i.test(n))
    .flatMap((n) => ['Cache', 'Code Cache', 'GPUCache'].map((d) => W.join(pk, n, 'LocalCache', 'Roaming', 'Claude', d)));
};

/** Absolute app cache dirs: `%APPDATA%\<app>\<dir>` for every app/dir combination plus the packaged Claude desktop caches. */
export const APP_CACHE_PATHS = (env) => [
  ...(env?.appData ? ELECTRON_APPS.flatMap((app) => APP_CACHE_DIRS.map((d) => W.join(env.appData, app, d))) : []),
  ...packagedClaudeCaches(env),
];

const SAFE = new Set(['temp', 'pkg-cache', 'crash-dump', 'browser-cache', 'shader-cache', 'app-cache', 'plugin-cache', 'ai-old-version']);
// ai-temp is safe for some roots and "check" for others: use the root's own tier (AI_TEMP_ROOTS); this default is the cautious one.
const CHECK = new Set(['dev-artifact', 'orphan-worktree', 'ai-temp']);

/** Safety tier of a junk category; unknown categories are 'manual'. */
export const tierOf = (category) => (SAFE.has(category) ? 'safe' : CHECK.has(category) ? 'check' : 'manual');

// ---- AI tools and editors ----
/** Old-version roots: each direct child is one installed version (Claude CLI) or one extension folder. */
export const OLD_VERSION_ROOTS = (env) => [
  env?.home && { root: W.join(env.home, '.local', 'share', 'claude', 'versions'), kind: 'claude-cli' },
  env?.appData && { root: W.join(env.appData, 'Claude', 'claude-code'), kind: 'claude-desktop-cc' },
  env?.home && { root: W.join(env.home, '.vscode', 'extensions'), kind: 'vscode-ext' },
  env?.home && { root: W.join(env.home, '.cursor', 'extensions'), kind: 'cursor-ext' },
].filter(Boolean);

const isExtKind = (kind) => kind === 'vscode-ext' || kind === 'cursor-ext';

/** Parse "<publisher.name>-<semver>[-<platform>]" (e.g. ms-python.python-2024.2.1-win32-x64); null when it does not look like one. */
export function extGroup(name) {
  const m = /^(.+?)-(\d+(?:\.\d+)+)(?:-.+)?$/.exec(String(name));
  return m ? { id: m[1], version: m[2] } : null;
}

/** "2.1.52" / "v2.1.52-beta.1" -> { nums, pre } ; null when the text does not start with a version. */
function parseVer(text) {
  const m = /^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?/.exec(String(text));
  return m ? { nums: m[1].split('.').map(Number), pre: m[2] ?? null } : null;
}

/** Semver-ish compare of two version strings: <0, 0, >0. A release is newer than its prerelease. Unparseable sorts lowest. */
export function compareVersions(a, b) {
  const x = parseVer(a), y = parseVer(b);
  if (!x || !y) return x ? 1 : y ? -1 : 0;
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) return d;
  }
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/** Version text of a folder name for its kind, or null. */
export const versionOf = (name, kind) => (isExtKind(kind) ? extGroup(name)?.version ?? null : parseVer(name) ? name.replace(/^v/, '') : null);

/** Group key: one group for the Claude kinds, one per extension id for the editors. null = unparseable (never touched). */
export const groupKey = (name, kind) => (isExtKind(kind) ? extGroup(name)?.id.toLowerCase() ?? null : parseVer(name) ? 'all' : null);

/**
 * The name to keep among the names of ONE group (callers group by groupKey first). Highest version wins; with ties the first.
 * null when no name parses or the names span several extension ids (the caller must group first).
 */
export function newestOf(names, kind) {
  let best = null, bestV = null;
  const keys = new Set();
  for (const n of names) {
    const k = groupKey(n, kind), v = versionOf(n, kind);
    if (k === null || v === null) continue;
    keys.add(k);
    if (best === null || compareVersions(v, bestV) > 0) { best = n; bestV = v; }
  }
  return keys.size > 1 ? null : best;
}

/** AI tool scratch/cache roots; each direct child older than minAgeDays may be recycled. */
export const AI_TEMP_ROOTS = (env) => {
  const out = [];
  if (env?.home) {
    const codex = W.join(env.home, '.codex');
    out.push(
      { root: W.join(codex, '.tmp'), minAgeDays: 1, tier: 'safe' },
      { root: W.join(codex, 'cache'), minAgeDays: 1, tier: 'safe' },
      { root: W.join(env.home, '.claude', 'plugins', '.trash'), minAgeDays: 0, tier: 'safe' },
    );
  }
  if (env?.tmp) out.push({ root: W.join(env.tmp, 'claude'), minAgeDays: 14, tier: 'check' });
  return out;
};

/** Per-project editor state: each direct child (a hash folder) untouched for minAgeDays may be recycled. */
export const EDITOR_STATE_ROOTS = (env) => (env?.appData
  ? ['Code', 'Cursor'].map((app) => ({ root: W.join(env.appData, app, 'User', 'workspaceStorage'), minAgeDays: 90 }))
  : []);

/** Extra crash-report folders (recycle their children). */
export const CRASH_EXTRA = (env) => (env?.appData ? ['Code', 'Cursor'].map((app) => W.join(env.appData, app, 'Crashpad')) : []);

// Codex worktrees (~/.codex/worktrees) are never touched while anything in them changed within this many days.
export const CODEX_WT_MIN_IDLE_DAYS = 14;

/** Folder name Claude Code uses for a working directory: ":", "\", "/" and "." become "-" (D:\a\.b -> D--a--b). */
export const claudeSessionSlug = (cwd) => String(cwd ?? '').replace(/[:\\/.]/g, '-');

/** Version of the running Claude Code CLI (`claude --version`), or null when it cannot be resolved. probe(argv) is read-only. */
export async function runningClaudeVersion(probe) {
  try {
    const r = await probe(['claude', '--version']);
    return r?.code === 0 ? /(\d+\.\d+\.\d+)/.exec(r.stdout || '')?.[1] ?? null : null;
  } catch { return null; }
}

/**
 * Extensions the editor lists as installed in `<extRoot>\extensions.json` (the only content read here): a Set of lowercase
 * folder names and `id@version` strings. Missing, oversized or invalid JSON gives an empty set.
 */
export async function activeExtensionVersions(extRoot) {
  const out = new Set();
  try {
    const f = W.join(extRoot, 'extensions.json');
    if ((await fsp.stat(f)).size > 5e6) return out;
    const list = JSON.parse(await fsp.readFile(f, 'utf8'));
    for (const x of Array.isArray(list) ? list : []) {
      const loc = [x?.relativeLocation, x?.location?.fsPath, x?.location?.path].find((v) => typeof v === 'string' && v);
      if (loc) out.add(W.basename(loc.replace(/\//g, '\\')).toLowerCase());
      if (typeof x?.identifier?.id === 'string' && typeof x?.version === 'string') out.add(`${x.identifier.id}@${x.version}`.toLowerCase());
    }
  } catch { /* missing or invalid: nothing is known to be in use */ }
  return out;
}
