// Shared thresholds and lists (see machine/CONTRACT.md) so scanner, cleaner and page agree.
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

/** Absolute `%APPDATA%\<app>\<dir>` for every app/dir combination; [] when APPDATA is unknown. */
export const APP_CACHE_PATHS = (env) =>
  env?.appData ? ELECTRON_APPS.flatMap((app) => APP_CACHE_DIRS.map((d) => W.join(env.appData, app, d))) : [];

const SAFE = new Set(['temp', 'pkg-cache', 'crash-dump', 'browser-cache', 'shader-cache', 'app-cache', 'plugin-cache']);
const CHECK = new Set(['dev-artifact', 'orphan-worktree']);

/** Safety tier of a junk category; unknown categories are 'manual'. */
export const tierOf = (category) => (SAFE.has(category) ? 'safe' : CHECK.has(category) ? 'check' : 'manual');
