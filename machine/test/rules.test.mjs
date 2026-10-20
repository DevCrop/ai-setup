import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import * as rules from '../lib/rules.mjs';
import { isDenied, readUserShellFolders, defaultEnv } from '../lib/deny.mjs';
import { resolveCacheDir } from '../lib/caches.mjs';

const W = path.win32;

test('rules: exports and constants', () => {
  assert.deepEqual(Object.keys(rules).sort(), ['APPDATA_MIN_AGE_DAYS', 'APPDATA_MIN_BYTES', 'APPDATA_SKIP', 'APP_CACHE_DIRS', 'APP_CACHE_PATHS', 'DEV_MIN_AGE_DAYS', 'ELECTRON_APPS', 'tierOf']);
  assert.equal(rules.APPDATA_MIN_BYTES, 50 * 2 ** 20);
  assert.equal(rules.APPDATA_MIN_AGE_DAYS, 180);
  assert.equal(rules.DEV_MIN_AGE_DAYS, 90);
  assert.ok(rules.APPDATA_SKIP instanceof Set && rules.APPDATA_SKIP.has('microsoft'));
  for (const n of rules.APPDATA_SKIP) assert.equal(n, n.toLowerCase());
  assert.ok(rules.ELECTRON_APPS.includes('Microsoft\\Teams'));
  assert.deepEqual(rules.APP_CACHE_DIRS, ['Cache', 'Code Cache', 'GPUCache', 'CachedData']);
});

test('rules: APP_CACHE_PATHS covers every app and dir under %APPDATA%', () => {
  const p = rules.APP_CACHE_PATHS({ appData: 'C:\\Users\\me\\AppData\\Roaming' });
  assert.equal(p.length, rules.ELECTRON_APPS.length * rules.APP_CACHE_DIRS.length);
  assert.ok(p.includes('C:\\Users\\me\\AppData\\Roaming\\Microsoft\\Teams\\Code Cache'));
  assert.ok(p.every((x) => x.startsWith('C:\\Users\\me\\AppData\\Roaming\\')));
  assert.deepEqual(rules.APP_CACHE_PATHS({}), []);
});

test('rules: tierOf follows the contract tiers', () => {
  for (const c of ['temp', 'pkg-cache', 'crash-dump', 'browser-cache', 'shader-cache', 'app-cache', 'plugin-cache']) assert.equal(rules.tierOf(c), 'safe', c);
  for (const c of ['dev-artifact', 'orphan-worktree']) assert.equal(rules.tierOf(c), 'check', c);
  for (const c of ['appdata-orphan', 'recycle-bin', 'vm-disk', 'system-cleanup', 'old-download', 'unknown']) assert.equal(rules.tierOf(c), 'manual', c);
});

const env = (extra = {}) => ({
  home: 'C:\\Users\\me', windir: 'C:\\Windows', programFiles: [], programData: 'C:\\ProgramData',
  tmp: 'C:\\Users\\me\\AppData\\Local\\Temp', appData: 'C:\\Users\\me\\AppData\\Roaming', localAppData: 'C:\\Users\\me\\AppData\\Local',
  repo: 'D:\\project\\ai-setup', userShellFolders: [], ...extra,
});

test('deny: plugin cache only at exactly <market>/<plugin>/<version>', () => {
  const base = 'C:\\Users\\me\\.claude\\plugins\\cache';
  assert.equal(isDenied(W.join(base, 'm', 'p', '1.0.0'), env()).denied, false);
  assert.equal(isDenied(W.join(base, 'm', 'p', '1.0.0', 'src'), env()).denied, true);
  assert.equal(isDenied(W.join(base, 'm', 'p'), env()).denied, true);
  assert.equal(isDenied(W.join(base, 'm'), env()).denied, true);
});

test('deny: segments ending in a dot or space are denied', () => {
  for (const p of ['C:\\Users\\me\\AppData\\Local\\Temp\\foo.', 'C:\\Users\\me\\AppData\\Local\\Temp\\foo \\x', 'C:\\Users\\me\\Documents.\\a', 'C:\\Users\\me\\AppData\\Local\\Temp\\a  ']) {
    assert.equal(isDenied(p, env()).denied, true, p);
  }
  assert.equal(isDenied('C:\\Users\\me\\AppData\\Local\\Temp\\foo.txt', env()).denied, false);
});

test('deny: relocated real shell folders are denied (injected)', () => {
  const e = env({ userShellFolders: ['D:\\PC-Storage\\UserFiles\\Downloads', 'D:\\PC-Storage\\UserFiles\\Music'] });
  assert.equal(isDenied('D:\\PC-Storage\\UserFiles\\Downloads\\big.iso', e).denied, true);
  assert.equal(isDenied('D:\\PC-Storage\\UserFiles\\Music', e).denied, true);
  assert.equal(isDenied('D:\\PC-Storage\\Temp\\x', e).denied, false);
  // a shell folder that equals the home or a drive root must not deny everything
  const odd = env({ userShellFolders: ['C:\\Users\\me', 'D:\\'] });
  assert.equal(isDenied('C:\\Users\\me\\AppData\\Local\\Temp\\x', odd).denied, false);
  assert.equal(isDenied('D:\\PC-Storage\\Temp\\x', odd).denied, false);
});

test('deny: readUserShellFolders parses reg output and expands variables', () => {
  const out = [
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders',
    '    Desktop    REG_EXPAND_SZ    %USERPROFILE%\\Desktop',
    '    Personal    REG_EXPAND_SZ    D:\\Docs',
    '    My Pictures    REG_SZ    D:\\Pics',
    '    {374DE290-123F-4565-9164-39C4925E467B}    REG_EXPAND_SZ    D:\\PC-Storage\\UserFiles\\Downloads',
    '    AppData    REG_EXPAND_SZ    %USERPROFILE%\\AppData\\Roaming',
    '    My Music    REG_EXPAND_SZ    %NOPE_UNSET%\\Music',
  ].join('\r\n');
  const saved = process.env.USERPROFILE;
  process.env.USERPROFILE = 'C:\\Users\\me';
  try {
    assert.deepEqual(readUserShellFolders(() => out), ['C:\\Users\\me\\Desktop', 'D:\\Docs', 'D:\\Pics', 'D:\\PC-Storage\\UserFiles\\Downloads']);
  } finally {
    if (saved === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = saved;
  }
  assert.deepEqual(readUserShellFolders(() => { throw new Error('no reg'); }), []);
});

test('deny: defaultEnv exposes userShellFolders without enumerating it', () => {
  const d = defaultEnv();
  assert.ok(Array.isArray(d.userShellFolders));
  assert.equal(Object.keys(d).includes('userShellFolders'), false);
});

const probeOk = (line) => async () => ({ code: 0, stdout: line + '\r\n' });
const probeFail = async () => { throw new Error('ENOENT'); };
const e2 = { home: 'C:\\Users\\me', localAppData: 'C:\\Users\\me\\AppData\\Local' };

test('caches: requireTool returns null unless the tool answered', async () => {
  assert.equal(await resolveCacheDir('npm', { probe: probeFail, env: e2 }), 'C:\\Users\\me\\AppData\\Local\\npm-cache'); // unchanged default
  assert.equal(await resolveCacheDir('npm', { probe: probeFail, env: e2, requireTool: false }), 'C:\\Users\\me\\AppData\\Local\\npm-cache');
  assert.equal(await resolveCacheDir('npm', { probe: probeFail, env: e2, requireTool: true }), null);
  assert.equal(await resolveCacheDir('npm', { probe: async () => ({ code: 1, stdout: '' }), env: e2, requireTool: true }), null);
  assert.equal(await resolveCacheDir('npm', { probe: probeOk('D:\\npm\\cache'), env: e2, requireTool: true }), 'D:\\npm\\cache');
  // tools with no resolver keep their fixed default
  assert.equal(await resolveCacheDir('gradle', { probe: probeFail, env: e2, requireTool: true }), 'C:\\Users\\me\\.gradle\\caches');
});
