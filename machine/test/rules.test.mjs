import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import * as rules from '../lib/rules.mjs';
import { isDenied, readUserShellFolders, defaultEnv } from '../lib/deny.mjs';
import { resolveCacheDir } from '../lib/caches.mjs';

const W = path.win32;

test('rules: exports and constants', () => {
  assert.deepEqual(Object.keys(rules).sort(), ['AI_TEMP_ROOTS', 'AI_TEMP_SKIP','APPDATA_MIN_AGE_DAYS', 'APPDATA_MIN_BYTES', 'APPDATA_SKIP', 'APP_CACHE_DIRS', 'APP_CACHE_PATHS', 'CODEX_WT_MIN_IDLE_DAYS', 'CRASH_EXTRA',
    'DEV_MIN_AGE_DAYS', 'EDITOR_STATE_ROOTS', 'ELECTRON_APPS', 'OLD_VERSION_ROOTS', 'activeExtensionVersions', 'claudeSessionSlug', 'compareVersions', 'extGroup', 'groupKey', 'newestOf',
    'runningClaudeVersion', 'tierOf', 'versionOf']);
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

// ---------- AI tools and editors ----------
test('rules: extGroup parses <publisher.name>-<semver>[-<platform>]', () => {
  assert.deepEqual(rules.extGroup('ms-python.python-2024.2.1-win32-x64'), { id: 'ms-python.python', version: '2024.2.1' });
  assert.deepEqual(rules.extGroup('anthropic.claude-code-2.0.5'), { id: 'anthropic.claude-code', version: '2.0.5' });
  assert.deepEqual(rules.extGroup('esbenp.prettier-vscode-11.0.0-universal'), { id: 'esbenp.prettier-vscode', version: '11.0.0' });
  assert.equal(rules.extGroup('extensions.json'), null);
  assert.equal(rules.extGroup('.obsolete'), null);
  assert.equal(rules.extGroup('foo-bar'), null);
});

test('rules: compareVersions and newestOf', () => {
  assert.ok(rules.compareVersions('2.1.10', '2.1.9') > 0); // numeric, not text
  assert.ok(rules.compareVersions('1.0.0', '1.0.0-beta.1') > 0);
  assert.equal(rules.compareVersions('1.0', '1.0.0'), 0);
  assert.ok(rules.compareVersions('x', '1.0.0') < 0);
  assert.equal(rules.newestOf(['2.1.9', '2.1.10', '2.0.99'], 'claude-cli'), '2.1.10');
  assert.equal(rules.newestOf(['2.1.52.exe', '2.1.9.exe'], 'claude-desktop-cc'), '2.1.52.exe');
  assert.equal(rules.newestOf(['a.b-1.2.0-win32-x64', 'a.b-1.10.0-win32-x64', 'a.b-1.9.9'], 'vscode-ext'), 'a.b-1.10.0-win32-x64');
  assert.equal(rules.newestOf(['a.b-1.0.0', 'c.d-9.0.0'], 'cursor-ext'), null); // several ids: caller must group first
  assert.equal(rules.newestOf(['junk', 'notes.txt'], 'claude-cli'), null);
  assert.equal(rules.newestOf([], 'claude-cli'), null);
  assert.equal(rules.groupKey('A.B-1.0.0', 'vscode-ext'), 'a.b');
  assert.equal(rules.groupKey('2.1.0', 'claude-cli'), 'all');
  assert.equal(rules.groupKey('junk', 'claude-cli'), null);
});

test('rules: OLD_VERSION_ROOTS, AI_TEMP_ROOTS, EDITOR_STATE_ROOTS, CRASH_EXTRA', () => {
  const e = env();
  assert.deepEqual(rules.OLD_VERSION_ROOTS(e), [
    { root: 'C:\\Users\\me\\.local\\share\\claude\\versions', kind: 'claude-cli' },
    { root: 'C:\\Users\\me\\AppData\\Roaming\\Claude\\claude-code', kind: 'claude-desktop-cc' },
    { root: 'C:\\Users\\me\\.vscode\\extensions', kind: 'vscode-ext' },
    { root: 'C:\\Users\\me\\.cursor\\extensions', kind: 'cursor-ext' },
  ]);
  assert.deepEqual(rules.AI_TEMP_ROOTS(e), [
    { root: 'C:\\Users\\me\\.codex\\.tmp', minAgeDays: 1, tier: 'safe' },
    { root: 'C:\\Users\\me\\.codex\\cache', minAgeDays: 1, tier: 'safe' },
    { root: 'C:\\Users\\me\\.claude\\plugins\\.trash', minAgeDays: 0, tier: 'safe' },
    { root: 'C:\\Users\\me\\AppData\\Local\\Temp\\claude', minAgeDays: 14, tier: 'check' },
  ]);
  assert.deepEqual(rules.EDITOR_STATE_ROOTS(e), [
    { root: 'C:\\Users\\me\\AppData\\Roaming\\Code\\User\\workspaceStorage', minAgeDays: 90 },
    { root: 'C:\\Users\\me\\AppData\\Roaming\\Cursor\\User\\workspaceStorage', minAgeDays: 90 },
  ]);
  assert.deepEqual(rules.CRASH_EXTRA(e), ['C:\\Users\\me\\AppData\\Roaming\\Code\\Crashpad', 'C:\\Users\\me\\AppData\\Roaming\\Cursor\\Crashpad']);
  for (const f of [rules.OLD_VERSION_ROOTS, rules.AI_TEMP_ROOTS, rules.EDITOR_STATE_ROOTS, rules.CRASH_EXTRA]) assert.deepEqual(f({}), []);
});

test('rules: tierOf for the AI categories', () => {
  assert.equal(rules.tierOf('ai-old-version'), 'safe');
  assert.equal(rules.tierOf('ai-temp'), 'check'); // cautious default; each AI_TEMP_ROOTS entry carries its own tier
  assert.equal(rules.tierOf('editor-state'), 'manual'); // report only
  assert.equal(rules.tierOf('ai-history'), 'manual');
});

test('rules: APP_CACHE_PATHS includes every Packages\\Claude_* store-app cache', async () => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rules-test-'));
  try {
    const la = W.join(root, 'Local');
    for (const n of ['Claude_pzs8sxrjxfjjc', 'claude_other', 'NotClaude_x', 'Microsoft.Foo']) await fs.mkdir(W.join(la, 'Packages', n), { recursive: true });
    const p = rules.APP_CACHE_PATHS({ localAppData: la });
    const base = W.join(la, 'Packages', 'Claude_pzs8sxrjxfjjc', 'LocalCache', 'Roaming', 'Claude');
    assert.ok(['Cache', 'Code Cache', 'GPUCache'].every((d) => p.includes(W.join(base, d))));
    assert.ok(p.includes(W.join(la, 'Packages', 'claude_other', 'LocalCache', 'Roaming', 'Claude', 'Cache'))); // prefix match is case-insensitive
    assert.equal(p.length, 6);
    assert.ok(!p.some((x) => /NotClaude|Microsoft\.Foo/.test(x)));
    assert.equal(rules.APP_CACHE_PATHS({ localAppData: W.join(root, 'nowhere') }).length, 0);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('deny: Claude/Codex state stays protected except the named children', () => {
  const e = env();
  const d = (p) => isDenied(p, e).denied;
  const cl = 'C:\\Users\\me\\.claude', cx = 'C:\\Users\\me\\.codex', tc = 'C:\\Users\\me\\AppData\\Local\\Temp\\claude';
  for (const p of [cl, W.join(cl, 'projects'), W.join(cl, 'projects', 'x'), W.join(cl, 'settings.json'), W.join(cl, 'plugins', '.trash'), W.join(cl, 'plugins', '.trash', 'a', 'b'),
    W.join(cx, '.sandbox-recovery'), W.join(cx, '.sandbox-recovery', 'a'), cx, W.join(cx, 'sessions'), W.join(cx, 'archived_sessions', 'x'), W.join(cx, 'auth.json'), W.join(cx, 'config.toml'), W.join(cx, '.tmp'), W.join(cx, 'cache'), W.join(cx, '.tmp', 'a', 'b'),
    W.join(cx, 'worktrees'), tc, W.join(tc, 'a', 'b')]) assert.equal(d(p), true, p);
  for (const p of [W.join(cl, 'plugins', '.trash', 'a'), W.join(cx, '.tmp', 'a'), W.join(cx, 'cache', 'a'), W.join(cx, 'worktrees', 'id', 'repo'), W.join(tc, 'old-session')]) assert.equal(d(p), false, p);
});

test('claudeSessionSlug and runningClaudeVersion', async () => {
  assert.equal(rules.claudeSessionSlug('D:\\project\\ai-setup\\.claude\\worktrees\\x'), 'D--project-ai-setup--claude-worktrees-x');
  assert.equal(rules.claudeSessionSlug(undefined), '');
  // every non-alphanumeric character becomes "-": underscore, space, Korean, parentheses
  assert.equal(rules.claudeSessionSlug('C:\\Users\\edn_y\\my app'), 'C--Users-edn-y-my-app');
  assert.equal(rules.claudeSessionSlug('D:\\프로젝트\\a_b (1)'), 'D-------a-b--1-');
  assert.ok(rules.AI_TEMP_SKIP.test('x.lock') && rules.AI_TEMP_SKIP.test('X.GUARD') && !rules.AI_TEMP_SKIP.test('lock') && !rules.AI_TEMP_SKIP.test('a.lock.d'));
  const probe = (r) => async () => r;
  assert.equal(await rules.runningClaudeVersion(probe({ code: 0, stdout: '2.1.51 (Claude Code)\n' })), '2.1.51');
  assert.equal(await rules.runningClaudeVersion(probe({ code: 1, stdout: '2.1.51' })), null);
  assert.equal(await rules.runningClaudeVersion(probe({ code: 0, stdout: 'hello' })), null);
  assert.equal(await rules.runningClaudeVersion(async () => { throw new Error('x'); }), null);
});

test('activeExtensionVersions reads only extensions.json and tolerates bad input', async () => {
  const fs = await import('node:fs/promises'), os = await import('node:os');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ext-test-'));
  try {
    assert.equal((await rules.activeExtensionVersions(dir)).size, 0); // missing
    await fs.writeFile(path.join(dir, 'extensions.json'), JSON.stringify([
      { identifier: { id: 'Pub.A' }, version: '1.0.0', relativeLocation: 'pub.a-1.0.0-win32-x64' },
      { location: { fsPath: 'c:\\x\\extensions\\pub.b-2.0.0' } }, null, 5]));
    const s = await rules.activeExtensionVersions(dir);
    assert.deepEqual([...s].sort(), ['pub.a-1.0.0-win32-x64', 'pub.a@1.0.0', 'pub.b-2.0.0']);
    await fs.writeFile(path.join(dir, 'extensions.json'), '{not json');
    assert.equal((await rules.activeExtensionVersions(dir)).size, 0);
    await fs.writeFile(path.join(dir, 'extensions.json'), '{"a":1}');
    assert.equal((await rules.activeExtensionVersions(dir)).size, 0);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
