import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isDenied, secretFile } from '../lib/deny.mjs';
import { resolveCacheDir, CACHE_TOOLS } from '../lib/caches.mjs';
import { APPDATA_SKIP, APPDATA_MIN_BYTES, APPDATA_MIN_AGE_DAYS, DEV_MIN_AGE_DAYS, APP_CACHE_PATHS, tierOf } from '../lib/rules.mjs';
import { validatePlan, verifyItem, main, makeCtx, execute, defaultRun, SHIMS, du, parseRecycleOutput, defaultDriveOk } from '../clean.mjs';

const W = path.win32;
const win = process.platform === 'win32';
const GIT = ['git', '-c', 'core.fsmonitor=false'];

// ---------- deny list (pure strings) ----------
const E = {
  home: 'C:\\Users\\me', windir: 'C:\\Windows', programFiles: ['C:\\Program Files', 'C:\\Program Files (x86)'],
  programData: 'C:\\ProgramData', tmp: 'D:\\Temp', appData: 'C:\\Users\\me\\AppData\\Roaming',
  localAppData: 'C:\\Users\\me\\AppData\\Local', repo: 'D:\\project\\ai-setup',
};
const DENY_CASES = [
  // [path, denied]
  ['C:\\', true], ['c:/', true], ['D:\\', true],
  ['C:\\Windows', true], ['c:/windows/system32', true], ['C:\\WINDOWS\\System32\\drivers', true],
  ['C:\\Windows\\Temp', true], ['C:\\Windows\\Temp\\foo', false], ['c:/windows/temp/foo/bar', false],
  ['C:\\Windows\\Temp\\..\\System32', true],
  ['C:\\Program Files', true], ['C:\\Program Files\\App\\x.dll', true], ['C:\\PROGRAM FILES (X86)\\App', true],
  ['D:\\Program Files Extra\\a', true], ['C:\\ProgramData', true], ['C:\\ProgramData\\Microsoft\\Windows', true],
  ['C:\\Users\\me', true], ['C:\\Users\\me\\Documents', true], ['C:\\Users\\me\\documents\\a.txt', true],
  ['C:\\Users\\me\\Desktop\\x', true], ['C:\\Users\\me\\Pictures', true], ['C:\\Users\\me\\Videos', true],
  ['C:\\Users\\me\\Music', true], ['C:\\Users\\me\\Downloads\\a.zip', true],
  ['C:\\Users\\me\\OneDrive', true], ['C:\\Users\\me\\OneDrive - Corp\\Documents\\a', true],
  ['C:\\Users\\me\\AppData\\Local\\npm-cache', false], ['C:\\Users\\me\\.gradle\\caches', false],
  ['C:\\Users\\me\\proj\\.git', true], ['C:\\Users\\me\\proj\\.GIT\\objects', true], ['C:\\Users\\me\\proj\\node_modules', false],
  ['C:\\Users\\me\\.claude', true], ['C:\\Users\\me\\.claude\\settings.json', true], ['C:\\Users\\me\\.claude\\plugins\\cache', true],
  ['C:\\Users\\me\\.claude\\plugins\\cache\\mk', true], ['C:\\Users\\me\\.claude\\plugins\\cache\\mk\\pl', true],
  ['C:\\Users\\me\\.claude\\plugins\\cache\\mk\\pl\\1.0.0', false], ['c:/users/ME/.claude/plugins/cache/mk/pl/1.0.0/x/y', true],
  ['C:\\Users\\me\\.claude-mem', true], ['C:\\Users\\me\\.claude-mem\\db', true],
  ['C:\\Users\\me\\x\\.credentials.json', true], ['C:\\Users\\me\\x\\.env', true], ['C:\\Users\\me\\x\\.env.local\\a', true],
  ['C:\\Users\\me\\x\\.envrc', true], ['C:\\Users\\me\\x\\env.txt', false],
  ['D:\\Temp', true], ['D:\\Temp\\foo', false], ['D:\\Temp\\claude', true], ['d:/temp/CLAUDE/x', false], ['D:\\Temp\\claude\\x\\y', true],
  ['C:\\Users\\me\\.claude\\plugins\\.trash', true], ['C:\\Users\\me\\.claude\\plugins\\.trash\\old', false], ['C:\\Users\\me\\.claude\\plugins\\.trash\\old\\x', true],
  ['C:\\Users\\me\\.claude\\projects', true], ['C:\\Users\\me\\.claude\\projects\\p1', true], ['C:\\Users\\me\\.claude\\plugins\\installed_plugins.json', true],
  ['C:\\Users\\me\\.codex', true], ['C:\\Users\\me\\.codex\\.tmp', true], ['C:\\Users\\me\\.codex\\.tmp\\x', false], ['C:\\Users\\me\\.codex\\.tmp\\x\\y', true],
  ['C:\\Users\\me\\.codex\\cache', true], ['C:\\Users\\me\\.codex\\cache\\x', false], ['C:\\Users\\me\\.codex\\.sandbox-recovery\\x', true], ['C:\\Users\\me\\.codex\\.sandbox-recovery', true],
  ['C:\\Users\\me\\.codex\\sessions', true], ['C:\\Users\\me\\.codex\\sessions\\2026', true], ['C:\\Users\\me\\.codex\\archived_sessions\\x', true],
  ['C:\\Users\\me\\.codex\\auth.json', true], ['C:\\Users\\me\\.codex\\config.toml', true],
  ['C:\\Users\\me\\.codex\\worktrees', true], ['C:\\Users\\me\\.codex\\worktrees\\ab12\\repo', false], ['C:\\Users\\me\\.codex\\worktrees\\ab12\\repo\\.git', true],
  ['c:/users/ME/.CODEX/.TMP/x', false],
  ['D:\\Temp\\machine-map.html', true], ['D:\\Temp\\claude-other', false],
  ['D:\\project\\ai-setup', true], ['d:/project/ai-setup/machine', true], ['D:\\project\\ai-setup2', false],
  ['relative\\path', true], ['\\\\server\\share\\x', true],
];
test('deny list table', () => {
  for (const [p, denied] of DENY_CASES) assert.equal(isDenied(p, E).denied, denied, `${p} should be ${denied ? 'denied' : 'allowed'}`);
  assert.ok(isDenied('C:\\Windows', E).reason);
});
test('deny: .git allowed only through the orphan hook', () => {
  assert.equal(isDenied('C:\\x\\.git', { ...E, isOrphanGit: () => true }).denied, false);
});

test('secretFile: .example/.sample/.template copies are fine, real secrets are not', () => {
  for (const n of ['.env', '.env.local', '.credentials.json', 'prod-credentials.json', '.envrc']) assert.equal(secretFile(n), true, n);
  for (const n of ['.env.example', '.env.sample', '.env.template', '.env.example.local', '.ENV.EXAMPLE', 'a.txt']) assert.equal(secretFile(n), false, n);
});

// ---------- lib/caches.mjs ----------
test('resolveCacheDir: tool answer wins, else official default, else null', async () => {
  const env = { home: 'C:\\Users\\me', localAppData: 'C:\\Users\\me\\AppData\\Local' };
  const seen = [];
  const probe = async (a) => {
    seen.push(a.join(' '));
    if (a[0] === 'npm') return { code: 0, stdout: '\r\nD:\\Caches\\npm\r\n' };
    if (a[0] === 'uv') return { code: 0, stdout: 'relative/dir' };
    return { code: 1, stdout: '' };
  };
  assert.equal(await resolveCacheDir('npm', { probe, env }), 'D:\\Caches\\npm');
  assert.equal(await resolveCacheDir('uv', { probe, env }), env.localAppData + '\\uv\\cache'); // non-absolute answer ignored
  assert.equal(await resolveCacheDir('pip', { probe: async () => { throw new Error('ENOENT'); }, env }), env.localAppData + '\\pip\\cache');
  assert.equal(await resolveCacheDir('gradle', { probe, env }), env.home + '\\.gradle\\caches');
  assert.equal(await resolveCacheDir('nuget', { probe, env }), env.home + '\\.nuget\\packages');
  assert.equal(await resolveCacheDir('rm -rf', { probe, env }), null);
  assert.equal(await resolveCacheDir('__proto__', { probe, env }), null);
  assert.equal(await resolveCacheDir('pip', { probe: async () => ({ code: 1, stdout: '' }), env: { home: env.home } }), null);
  assert.equal(seen[0], 'npm config get cache');
  assert.ok(CACHE_TOOLS.includes('npm') && !CACHE_TOOLS.includes('cmd'));
});

// ---------- plan validation ----------
const good = { id: 'a', category: 'dev-artifact', path: 'C:\\x\\node_modules' };
test('validatePlan rejects bad plans and items, ignores command-like fields', () => {
  for (const bad of [null, {}, { version: 2, items: [] }, { version: 1, items: 'x' }]) assert.throws(() => validatePlan(bad));
  const evil = { ...good, id: 'b', path: 'C:\\x\\a', how: 'rm -rf /', action: 'powershell -c bad', command: 'calc' };
  const { items, rejected } = validatePlan({ version: 1, items: [
    good, evil,
    { ...good, id: 'c', category: 'nope', path: 'C:\\q' },
    { ...good, id: 'd', path: 'rel\\path' },
    { ...good, id: 'e', path: 'C:\\x\\..\\Windows' },
    { ...good, id: 'f', path: 'C:/x/../y' },
    { id: 'g', category: 'pkg-cache', tool: 'npm; calc', path: 'C:\\n' },
    { id: 'h', category: 'pkg-cache', path: 'C:\\n2' },
    { ...good, id: 'i', path: 'C:\\x\\a?*' },
    { ...good, id: 'j', path: 'C:\\x\\NODE_MODULES' }, // duplicate of the first (case-insensitive)
    { ...good, id: 'k', path: 'C:\\k', size: -1 },
    { id: 5, category: 'temp', path: 'C:\\t' }, 'str', null,
  ] });
  assert.deepEqual(items.map((i) => i.id), ['a', 'b']);
  assert.equal(rejected.length, 12);
  assert.ok(rejected.every((r) => r.reason));
  assert.equal(Object.keys(items[1]).sort().join(), 'category,id,path,size,tool'); // extra fields (how, action, safety...) dropped
});

// ---------- fixtures ----------
async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'clean-test-')));
  const d = (...p) => W.join(root, ...p);
  for (const p of ['home', 'Windows\\Temp', 'tmp', 'repo', 'ProgramData', 'AppData\\Local', 'AppData\\Roaming']) await fs.mkdir(d(p), { recursive: true });
  const env = {
    home: d('home'), windir: d('Windows'), programFiles: [d('PF')], programData: d('ProgramData'), tmp: d('tmp'),
    appData: d('AppData', 'Roaming'), localAppData: d('AppData', 'Local'), repo: d('repo'),
  };
  const calls = { probe: [], run: [], recycle: [] };
  const mk = (over = {}) => makeCtx({
    env,
    probe: async (a) => { calls.probe.push(a); return over.probe ? over.probe(a) : { code: 1, stdout: '', stderr: '' }; },
    run: async (a) => { calls.run.push(a); return { code: 0, stdout: '', stderr: '' }; },
    recycle: async (l) => { calls.recycle.push(l); return l.map(() => ({ ok: true })); },
    listInstalledApps: async () => [], ...sys,
    ...over.ctx,
  });
  const write = async (p, s = 'x') => { await fs.mkdir(W.dirname(p), { recursive: true }); await fs.writeFile(p, s); };
  const plan = async (items) => { const f = d('plan.json'); await fs.writeFile(f, JSON.stringify({ version: 1, items })); return f; };
  // set every file and dir under `p` to `days` ago
  const age = async (p, days = 200) => {
    const t = (Date.now() - days * 864e5) / 1000;
    const walk = async (q) => { if ((await fs.lstat(q)).isDirectory()) for (const n of await fs.readdir(q)) await walk(W.join(q, n)); await fs.utimes(q, t, t); };
    await walk(p);
  };
  return { root, d, env, calls, mk, write, plan, age, done: () => fs.rm(root, { recursive: true, force: true }) };
}
// deterministic drive facts: a Recycle Bin exists and the drive is huge
const sys = { driveOk: async () => true, driveTotal: async () => 1e15 };
const opts = { skip: !win && 'Windows-only' };

// ---------- re-verify ----------
test('verify: missing path, re-measured size, symlink refused', opts, async () => {
  const f = await fixture();
  try {
    const nm = f.d('proj', 'node_modules');
    await f.write(W.join(nm, 'a.js'), '12345');
    await f.write(W.join(nm, 'sub', 'b.js'), '123');
    await f.write(f.d('proj', 'package.json'), '{}');
    await f.age(f.d('proj'));
    const ctx = f.mk();
    const miss = await verifyItem({ id: 'm', category: 'dev-artifact', path: f.d('proj', 'dist') }, ctx);
    assert.deepEqual([miss.ok, miss.reason], [false, '경로가 없음']);
    const r = await verifyItem({ id: 'n', category: 'dev-artifact', path: nm, size: 999999 }, ctx);
    assert.ok(r.ok);
    assert.equal(r.entry.size, 8); // plan said 999999
    assert.equal(r.entry.action, 'recycle');
    // no project marker -> rejected; wrong folder name -> rejected
    await f.write(f.d('bare', 'node_modules', 'x'));
    assert.equal((await verifyItem({ id: 'o', category: 'dev-artifact', path: f.d('bare', 'node_modules') }, ctx)).ok, false);
    assert.equal((await verifyItem({ id: 'p', category: 'dev-artifact', path: f.d('proj') }, ctx)).ok, false);
    // junction as target
    const link = f.d('proj', 'dist');
    try { await fs.symlink(nm, link, 'junction'); } catch { return; }
    const l = await verifyItem({ id: 'q', category: 'dev-artifact', path: link }, ctx);
    assert.equal(l.ok, false);
    assert.match(l.reason, /링크/);
  } finally { await f.done(); }
});

test('verify: directory containing a runtime-created .env file is denied', opts, async () => {
  const f = await fixture();
  try {
    await f.write(f.d('proj', 'package.json'), '{}');
    await f.write(f.d('proj', 'node_modules', 'pkg', 'a.js'));
    await f.age(f.d('proj'));
    const ctx = f.mk();
    // .env.example / .env.sample / .env.template copies are not secrets
    for (const n of ['.env.example', '.env.sample', '.env.template']) await f.write(f.d('proj', 'node_modules', 'pkg', n));
    assert.equal((await verifyItem({ id: 'a', category: 'dev-artifact', path: f.d('proj', 'node_modules') }, ctx)).ok, true);
    await f.write(f.d('proj', 'node_modules', 'pkg', 'deep', '.env'), 'SECRET=1');
    const r = await verifyItem({ id: 'a', category: 'dev-artifact', path: f.d('proj', 'node_modules') }, ctx);
    assert.equal(r.ok, false);
    assert.match(r.reason, /민감 파일/);
    assert.ok(!r.reason.includes('SECRET')); // content is never read
    // a real repo (.git directory) inside a target is denied too
    await f.write(f.d('proj', 'dist', 'sub', '.git', 'HEAD'));
    assert.equal((await verifyItem({ id: 'b', category: 'dev-artifact', path: f.d('proj', 'dist') }, ctx)).ok, false);
  } finally { await f.done(); }
});

test('verify: denied paths are refused even when the path exists', opts, async () => {
  const f = await fixture();
  try {
    await f.write(f.d('Windows', 'System32', 'x.dll'));
    await f.write(f.d('home', '.claude', 'settings.json'));
    const ctx = f.mk();
    for (const p of [f.d('Windows', 'System32'), f.d('home', '.claude'), f.d('ProgramData')]) {
      const r = await verifyItem({ id: 'x', category: 'appdata-orphan', path: p }, ctx);
      assert.equal(r.ok, false, p);
    }
    assert.match((await verifyItem({ id: 'x', category: 'crash-dump', path: f.d('Windows', 'System32') }, ctx)).reason, /거부/);
  } finally { await f.done(); }
});

test('verify: temp recycles only old, allowed children', opts, async () => {
  const f = await fixture();
  try {
    const old = Date.now() / 1000 - 3 * 86400;
    for (const n of ['old.tmp', 'new.tmp', 'claude\\live.txt', 'machine-map.html', 'oldsecret\\.env']) await f.write(f.d('tmp', ...n.split('\\')));
    for (const n of ['old.tmp', 'claude\\live.txt', 'machine-map.html', 'oldsecret\\.env']) await fs.utimes(f.d('tmp', ...n.split('\\')), old, old);
    await fs.utimes(f.d('tmp', 'claude'), old, old);
    await fs.utimes(f.d('tmp', 'oldsecret'), old, old);
    const r = await verifyItem({ id: 't', category: 'temp', path: f.d('tmp') }, f.mk());
    assert.ok(r.ok);
    assert.deepEqual(r.entry.children.map((c) => W.basename(c.path)), ['old.tmp']);
    assert.equal(r.entry.skipped, 4);
    assert.equal((await verifyItem({ id: 't', category: 'temp', path: f.d('home') }, f.mk())).ok, false); // not a temp root
  } finally { await f.done(); }
});

test('verify: pkg-cache must match the real cache dir', opts, async () => {
  const f = await fixture();
  try {
    const real = f.d('realcache'), other = f.d('othercache');
    await f.write(W.join(real, 'a'), 'abc');
    await f.write(W.join(other, 'a'), 'abc');
    const ctx = f.mk({ probe: (a) => (a.join(' ') === 'npm config get cache' ? { code: 0, stdout: real + '\r\n', stderr: '' } : { code: 1, stdout: '', stderr: '' }) });
    const ok = await verifyItem({ id: 'n', category: 'pkg-cache', tool: 'npm', path: real }, ctx);
    assert.ok(ok.ok);
    assert.deepEqual(ok.entry.argv, ['npm', 'cache', 'clean', '--force']);
    assert.equal(ok.entry.action, 'run');
    assert.equal((await verifyItem({ id: 'n', category: 'pkg-cache', tool: 'npm', path: other }, ctx)).ok, false);
    // the .env deny applies to command-based targets too
    await f.write(W.join(real, 'deep', '.env'), 'SECRET=1');
    const withEnv = await verifyItem({ id: 'n', category: 'pkg-cache', tool: 'npm', path: real }, ctx);
    assert.equal(withEnv.ok, false);
    assert.match(withEnv.reason, /민감 파일/);
    await fs.rm(W.join(real, 'deep'), { recursive: true });
    // tool does not answer -> no default-location fallback (R5); the check still needs the tool
    await f.write(W.join(f.env.localAppData, 'pip', 'cache', 'a'));
    const pip = await verifyItem({ id: 'p', category: 'pkg-cache', tool: 'pip', path: W.join(f.env.localAppData, 'pip', 'cache') }, ctx);
    assert.equal(pip.ok, false);
    assert.match(pip.reason, /확인할 수 없음/);
    const pip2 = await verifyItem({ id: 'p', category: 'pkg-cache', tool: 'pip', path: W.join(f.env.localAppData, 'pip', 'cache') }, f.mk({ probe: (a) => (a[0] === 'pip' ? { code: 0, stdout: W.join(f.env.localAppData, 'pip', 'cache'), stderr: '' } : { code: 1, stdout: '', stderr: '' }) }));
    assert.deepEqual(pip2.entry.argv, ['pip', 'cache', 'purge']);
    // gradle: recycle ~/.gradle/caches
    await f.write(f.d('home', '.gradle', 'caches', 'a'));
    const g = await verifyItem({ id: 'g', category: 'pkg-cache', tool: 'gradle', path: f.d('home', '.gradle', 'caches') }, ctx);
    assert.equal(g.entry.action, 'recycle');
  } finally { await f.done(); }
});

test('verify: plugin-cache referenced by installed_plugins.json is rejected', opts, async () => {
  const f = await fixture();
  try {
    const base = f.d('home', '.claude', 'plugins', 'cache', 'mk', 'pl');
    await f.write(W.join(base, '1.0.0', 'a.md'));
    await f.write(W.join(base, '2.0.0', 'a.md'));
    await f.write(f.d('home', '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: { 'pl@mk': [{ installPath: W.join(base, '2.0.0') }] } }));
    const ctx = f.mk();
    assert.ok((await verifyItem({ id: 'a', category: 'plugin-cache', path: W.join(base, '1.0.0') }, ctx)).ok);
    assert.equal((await verifyItem({ id: 'b', category: 'plugin-cache', path: W.join(base, '2.0.0') }, ctx)).ok, false);
    assert.equal((await verifyItem({ id: 'c', category: 'plugin-cache', path: base }, ctx)).ok, false); // plugin dir, not a version
  } finally { await f.done(); }
});

test('verify: orphan worktree (a) missing gitdir, (b) merged+clean via git, dirty refused', opts, async () => {
  const f = await fixture();
  try {
    await f.write(f.d('wt1', '.git'), 'gitdir: ' + f.d('gone', '.git', 'worktrees', 'wt1') + '\n');
    await f.write(f.d('wt1', 'a.txt'));
    const a = await verifyItem({ id: 'a', category: 'orphan-worktree', path: f.d('wt1') }, f.mk());
    assert.ok(a.ok);
    assert.equal(a.entry.action, 'recycle');

    const parent = f.d('parent');
    await fs.mkdir(W.join(parent, '.git', 'worktrees', 'wt2'), { recursive: true });
    await f.write(f.d('wt2', '.git'), 'gitdir: ' + W.join(parent, '.git', 'worktrees', 'wt2') + '\n');
    const head = 'a'.repeat(40);
    const git = (dirty, merged = true) => (a) => {
      const s = a.slice(5).join(' ');
      if (s.startsWith('worktree list')) return { code: 0, stdout: `worktree ${parent.replace(/\\/g, '/')}\nHEAD ${head}\n\nworktree ${f.d('wt2').replace(/\\/g, '/')}\nHEAD ${head}\n`, stderr: '' };
      if (s.startsWith('rev-parse HEAD')) return { code: 0, stdout: head + '\n', stderr: '' };
      if (s.startsWith('symbolic-ref')) return { code: 0, stdout: 'origin/main\n', stderr: '' };
      if (s.startsWith('merge-base')) return { code: merged ? 0 : 1, stdout: '', stderr: '' };
      if (s.startsWith('status')) return { code: 0, stdout: dirty ? ' M a.txt\n' : '', stderr: '' };
      return { code: 1, stdout: '', stderr: '' };
    };
    const b = await verifyItem({ id: 'b', category: 'orphan-worktree', path: f.d('wt2') }, f.mk({ probe: git(false) }));
    assert.ok(b.ok);
    assert.deepEqual(b.entry.argv, GIT.concat(['-C', parent, 'worktree', 'remove', '--', f.d('wt2')]));
    assert.equal(b.entry.action, 'run');
    assert.equal((await verifyItem({ id: 'b', category: 'orphan-worktree', path: f.d('wt2') }, f.mk({ probe: git(true) }))).ok, false);
    // every git status call ignores submodules (their config could run programs)
    const seen = [];
    await verifyItem({ id: 'b', category: 'orphan-worktree', path: f.d('wt2') }, f.mk({ probe: (a) => { seen.push(a); return git(false)(a); } }));
    const statuses = seen.filter((a) => a[5] === 'status');
    assert.ok(statuses.length >= 1 && statuses.every((a) => a.includes('--ignore-submodules=all')));
    // a worktree with .gitmodules is skipped before any git call
    await f.write(f.d('wt2', '.gitmodules'), '[submodule "x"]\n');
    const sm = await verifyItem({ id: 'b', category: 'orphan-worktree', path: f.d('wt2') }, f.mk({ probe: git(false) }));
    assert.equal(sm.ok, false);
    assert.equal(sm.reason, '서브모듈이 있어 건너뜀');
    assert.equal((await verifyItem({ id: 'b', category: 'orphan-worktree', path: f.d('wt2') }, f.mk({ probe: git(false, false) }))).ok, false);
  } finally { await f.done(); }
});

test('verify: orphan-worktree (c) repo root with a .git dir and prunable entries -> git worktree prune', opts, async () => {
  const f = await fixture();
  try {
    const repo = f.d('someRepo');
    await fs.mkdir(W.join(repo, '.git', 'worktrees'), { recursive: true });
    const list = (prunable) => (a) => (a.slice(5).join(' ') === 'worktree list --porcelain'
      ? { code: 0, stdout: `worktree ${repo.replace(/\\/g, '/')}\nHEAD ${'a'.repeat(40)}\n\nworktree ${f.d('gone').replace(/\\/g, '/')}\nHEAD ${'b'.repeat(40)}\n${prunable ? 'prunable gitdir file points to non-existent location\n' : ''}`, stderr: '' }
      : { code: 1, stdout: '', stderr: '' });
    const r = await verifyItem({ id: 'c', category: 'orphan-worktree', path: repo }, f.mk({ probe: list(true) }));
    assert.ok(r.ok);
    assert.deepEqual([r.entry.action, r.entry.argv], ['run', GIT.concat(['-C', repo, 'worktree', 'prune'])]);
    assert.equal((await verifyItem({ id: 'c', category: 'orphan-worktree', path: repo }, f.mk({ probe: list(false) }))).ok, false);
    // through main(): confirmed run executes exactly the prune argv, nothing is recycled
    const file = await f.plan([{ id: 'c', category: 'orphan-worktree', path: repo, how: 'rm -rf /' }]);
    const runs = [];
    const code = await main([file], { env: f.env, ...sys, probe: list(true), run: async (a) => { runs.push(a); return { code: 0 }; }, recycle: async () => { throw new Error('recycle'); }, ask: async () => 'y', out: () => {} });
    assert.equal(code, 0);
    assert.deepEqual(runs, [GIT.concat(['-C', repo, 'worktree', 'prune'])]);
  } finally { await f.done(); }
});

test('verify: shader-cache and app-cache recycle children of allowed locations only', opts, async () => {
  const f = await fixture();
  try {
    const la = f.env.localAppData, ad = f.env.appData;
    const ok = [
      W.join(la, 'D3DSCache'), W.join(la, 'NVIDIA', 'DXCache'), W.join(la, 'AMD', 'DxCache'),
      W.join(ad, 'Discord', 'Cache'), W.join(ad, 'Code', 'Code Cache'), W.join(ad, 'Slack', 'GPUCache'), W.join(ad, 'Code', 'CachedData'),
      W.join(la, 'Microsoft', 'Windows', 'INetCache'), W.join(la, 'Microsoft', 'Windows', 'WER'),
    ];
    const bad = [la, W.join(la, 'NVIDIA'), W.join(la, 'Programs'), ad, W.join(ad, 'Discord'), W.join(ad, 'Discord', 'Local Storage'), W.join(ad, 'a', 'b', 'Cache'), W.join(ad, 'SomeUnknownApp', 'Cache'), W.join(la, 'Microsoft', 'Windows'), f.d('home', 'Documents')];
    for (const p of [...ok, ...bad]) { await f.write(W.join(p, 'x.bin'), '12345'); await f.write(W.join(p, 'sub', 'y.bin'), '123'); }
    await f.write(W.join(ok[0], 'secret', '.env'), 'S=1'); // a child with a secret is skipped, not recycled
    const ctx = f.mk();
    for (const p of ok) {
      const cat = /D3DS|NVIDIA|AMD/.test(p) ? 'shader-cache' : 'app-cache';
      const r = await verifyItem({ id: p, category: cat, path: p }, ctx);
      assert.ok(r.ok, p);
      assert.equal(r.entry.action, 'recycle');
      assert.ok(r.entry.children.length >= 2, p);
      assert.equal(r.entry.size, p === ok[0] ? 8 : 8);
    }
    const first = await verifyItem({ id: 'a', category: 'shader-cache', path: ok[0] }, ctx);
    assert.equal(first.entry.skipped, 1);
    assert.ok(!first.entry.children.some((c) => c.path.endsWith('secret')));
    for (const p of bad) {
      for (const cat of ['shader-cache', 'app-cache']) assert.equal((await verifyItem({ id: p, category: cat, path: p }, ctx)).ok, false, `${cat} ${p}`);
    }
    // an app-cache path is not valid as shader-cache and vice versa
    assert.equal((await verifyItem({ id: 'x', category: 'shader-cache', path: ok[3] }, ctx)).ok, false);
    assert.equal((await verifyItem({ id: 'x', category: 'app-cache', path: ok[0] }, ctx)).ok, false);
    // locked children are skipped with a message, not failed
    const file = await f.plan([{ id: 'a', category: 'app-cache', path: ok[3] }]);
    const o = collect();
    const code = await main([file], { env: f.env, ...sys, recycle: async (l) => l.map(() => ({ ok: false, e: 'IOException' })), ask: async () => 'y', out: o.out });
    assert.equal(code, 0);
    assert.match(o.lines.join('\n'), /사용 중 — 건너뜀/);
  } finally { await f.done(); }
});

test('system-cleanup and old-download are report-only and never executed', opts, async () => {
  const f = await fixture();
  try {
    const sd = f.d('Windows', 'SoftwareDistribution', 'Download');
    await f.write(W.join(sd, 'pkg.cab'), '1234567');
    await f.write(f.d('Windows', 'System32', 'x.dll'));
    await f.write(f.d('home', 'Downloads', 'big.iso'), '12345');
    await f.write(f.d('home', 'Downloads', 'dir', 'a.zip'));
    await f.write(f.d('home', 'Documents', 'old.iso'));
    const ctx = f.mk();
    const s = await verifyItem({ id: 's', category: 'system-cleanup', path: sd }, ctx);
    assert.ok(s.ok);
    assert.deepEqual([s.entry.action, s.entry.size], ['report', 7]); // protected Windows folder is listed, not refused
    assert.equal((await verifyItem({ id: 's', category: 'system-cleanup', path: f.d('Windows', 'System32') }, ctx)).ok, false);
    const d = await verifyItem({ id: 'd', category: 'old-download', path: f.d('home', 'Downloads', 'big.iso') }, ctx);
    assert.ok(d.ok);
    assert.deepEqual([d.entry.action, d.entry.size], ['report', 5]);
    assert.equal((await verifyItem({ id: 'd', category: 'old-download', path: f.d('home', 'Downloads', 'dir') }, ctx)).ok, false); // a folder
    assert.equal((await verifyItem({ id: 'd', category: 'old-download', path: f.d('home', 'Documents', 'old.iso') }, ctx)).ok, false);
    const file = await f.plan([
      { id: 's', category: 'system-cleanup', path: sd, safety: 'safe', how: 'del /s /q C:\\' },
      { id: 'd', category: 'old-download', path: f.d('home', 'Downloads', 'big.iso'), safety: 'safe' },
    ]);
    const o = collect();
    const never = async () => { throw new Error('executed'); };
    const code = await main([file], { env: f.env, recycle: never, run: never, ask: never, out: o.out }); // nothing actionable: no prompt either
    assert.equal(code, 0);
    const text = o.lines.join('\n');
    assert.match(text, /cleanmgr/);
    assert.match(text, /다운로드 폴더는 보호됨/);
    assert.ok(!text.includes('del /s')); // plan text is never echoed as instructions
    assert.match(text, /실행할 항목이 없습니다/);
  } finally { await f.done(); }
});

test('the safety tier shown comes from the category, never from the plan', opts, async () => {
  const f = await fixture();
  try {
    await f.write(f.d('proj', 'package.json'), '{}');
    await f.write(f.d('proj', 'node_modules', 'a.js'), 'abc');
    await f.age(f.d('proj'));
    await f.write(W.join(f.env.localAppData, 'CrashDumps', 'a.dmp'), 'x');
    const file = await f.plan([
      { id: 'a', category: 'dev-artifact', path: f.d('proj', 'node_modules'), safety: 'safe' }, // plan says safe, the category says check
      { id: 'c', category: 'crash-dump', path: W.join(f.env.localAppData, 'CrashDumps'), safety: 'manual' },
      { id: 'b', category: 'dev-artifact', path: f.d('Windows', 'System32'), safety: 'safe' }, // still refused
    ]);
    const o = collect();
    assert.equal(await main([file, '--dry-run'], { env: f.env, ...sys, out: o.out }), 0);
    const text = o.lines.join('\n');
    const label = { safe: '삭제해도 됨', check: '확인 후 삭제', manual: '직접 판단' };
    assert.equal(tierOf('dev-artifact'), 'check');
    assert.match(text, new RegExp(`\\[휴지통 이동\\] \\[${label[tierOf('dev-artifact')]}\\].*node_modules`));
    assert.match(text, new RegExp(`\\[휴지통 이동\\] \\[${label[tierOf('crash-dump')]}\\].*CrashDumps`));
    assert.match(text, /\[거부\].*System32/);
  } finally { await f.done(); }
});

// ---------- hardening round ----------
const BIG = APPDATA_MIN_BYTES + 1024;
async function bigDir(f, p, days) {
  await f.write(W.join(p, 'blob.bin'), 'x');
  await fs.truncate(W.join(p, 'blob.bin'), BIG);
  if (days) await f.age(p, days);
}

test('appdata-orphan: needs size, age, a non-skipped name and no installed-app match', opts, async () => {
  const f = await fixture();
  try {
    const ad = f.env.appData, old = APPDATA_MIN_AGE_DAYS + 20;
    await bigDir(f, W.join(ad, 'OldTool'), old);
    await bigDir(f, W.join(ad, 'FreshTool'), 1);
    await f.write(W.join(ad, 'TinyTool', 'a.txt'), 'x'); await f.age(W.join(ad, 'TinyTool'), old);
    const skipName = [...APPDATA_SKIP][0];
    await bigDir(f, W.join(ad, skipName), old);
    const apps = [{ name: 'Totally Different App', publisher: 'Acme', location: 'C:\\Program Files\\Acme' }];
    const v = (name, over = {}) => verifyItem({ id: name, category: 'appdata-orphan', path: W.join(ad, name) }, f.mk({ ctx: { listInstalledApps: async () => apps, ...over } }));
    const ok = await v('OldTool');
    assert.ok(ok.ok, ok.reason);
    assert.equal(ok.entry.action, 'recycle');
    assert.match((await v('FreshTool')).reason, /이내/);
    assert.match((await v('TinyTool')).reason, /미만/);
    assert.equal((await v(skipName)).ok, false);
    assert.match((await v('OldTool', { listInstalledApps: async () => [{ name: 'OldTool Pro' }] })).reason, /비슷/); // looks installed
    assert.match((await v('OldTool', { listInstalledApps: async () => [] })).reason, /판단 불가/); // unsure -> reject
    assert.match((await v('OldTool', { listInstalledApps: async () => { throw new Error('reg'); } })).reason, /판단 불가/);
  } finally { await f.done(); }
});

test('dev-artifact: refused when the project has source newer than the age limit', opts, async () => {
  const f = await fixture();
  try {
    const proj = f.d('proj'), nm = W.join(proj, 'node_modules');
    await f.write(W.join(proj, 'package.json'), '{}');
    await f.write(W.join(proj, 'src', 'a.js'), 'x');
    await f.write(W.join(nm, 'pkg', 'i.js'), 'x');
    await f.age(proj, DEV_MIN_AGE_DAYS + 5);
    const ctx = f.mk();
    const v = () => verifyItem({ id: 'n', category: 'dev-artifact', path: nm }, ctx);
    assert.ok((await v()).ok);
    // a fresh file inside an artifact dir or .git does not count as source activity
    await f.write(W.join(nm, 'pkg', 'fresh.js'), 'x');
    await f.write(W.join(proj, '.git', 'index'), 'x');
    assert.ok((await v()).ok);
    // inside the age window: refused
    await fs.utimes(W.join(proj, 'src', 'a.js'), (Date.now() - (DEV_MIN_AGE_DAYS - 5) * 864e5) / 1000, (Date.now() - (DEV_MIN_AGE_DAYS - 5) * 864e5) / 1000);
    const r = await v();
    assert.equal(r.ok, false);
    assert.match(r.reason, /이내/);
    // a brand new file
    await f.age(proj, DEV_MIN_AGE_DAYS + 5);
    await f.write(W.join(proj, 'src', 'new.js'), 'x');
    assert.equal((await v()).ok, false);
  } finally { await f.done(); }
});

test('git: every argv starts with -c core.fsmonitor=false and the runner refuses anything else', opts, async () => {
  const f = await fixture();
  try {
    const parent = f.d('parent');
    await fs.mkdir(W.join(parent, '.git', 'worktrees', 'wt2'), { recursive: true });
    await f.write(f.d('wt2', '.git'), 'gitdir: ' + W.join(parent, '.git', 'worktrees', 'wt2') + '\n');
    const head = 'a'.repeat(40), seen = [];
    const probe = async (a) => {
      seen.push(a);
      const s = a.slice(5).join(' ');
      if (s.startsWith('worktree list')) return { code: 0, stdout: `worktree ${parent}\nHEAD ${head}\n\nworktree ${f.d('wt2')}\nHEAD ${head}\n`, stderr: '' };
      if (s.startsWith('rev-parse HEAD')) return { code: 0, stdout: head, stderr: '' };
      if (s.startsWith('symbolic-ref')) return { code: 0, stdout: 'origin/main', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const r = await verifyItem({ id: 'b', category: 'orphan-worktree', path: f.d('wt2') }, f.mk({ probe }));
    assert.ok(r.ok, r.reason);
    assert.ok(seen.length >= 5);
    for (const a of [...seen, r.entry.argv]) assert.deepEqual(a.slice(0, 3), GIT, a.join(' '));
    assert.equal((await defaultRun(['git', '--version'])).code, -1); // no fsmonitor flag: not allowed
    assert.equal((await defaultRun(['git', '-c', 'core.fsmonitor=true', '--version'])).code, -1);
    assert.equal((await defaultRun([...GIT, '--version'])).code, 0);
    assert.ok(SHIMS.has('bun') && SHIMS.has('npm'));
  } finally { await f.done(); }
});

test('orphan-worktree (a): structure and drive guards, listing compared by real path', opts, async () => {
  const f = await fixture();
  try {
    // pointer to a missing gitdir that is not <repo>\.git\worktrees\<id>: never "orphan"
    await f.write(f.d('w1', '.git'), 'gitdir: ' + f.d('gone', 'somewhere') + '\n');
    const s = await verifyItem({ id: 'a', category: 'orphan-worktree', path: f.d('w1') }, f.mk());
    assert.equal(s.ok, false);
    assert.match(s.reason, /구조/);
    // a missing gitdir on a drive that is not there may just be an unplugged disk
    let free = null;
    for (const c of 'ZYXWVUTSRQPONMLKJIHGFE') if (!(await fs.access(`${c}:\\`).then(() => true, () => false))) { free = c; break; }
    if (free) {
      await f.write(f.d('w2', '.git'), `gitdir: ${free}:\\repo\\.git\\worktrees\\w2\n`);
      const d = await verifyItem({ id: 'a', category: 'orphan-worktree', path: f.d('w2') }, f.mk());
      assert.equal(d.ok, false);
      assert.match(d.reason, /드라이브/);
    }
    // git lists the worktree through a junction: still listed (not an orphan to recycle)
    const parent = f.d('parent');
    await fs.mkdir(W.join(parent, '.git', 'worktrees', 'w3'), { recursive: true });
    await f.write(f.d('w3', '.git'), 'gitdir: ' + W.join(parent, '.git', 'worktrees', 'w3') + '\n');
    try { await fs.symlink(f.d('w3'), f.d('w3link'), 'junction'); } catch { return; }
    const head = 'b'.repeat(40);
    const probe = async (a) => {
      const q = a.slice(5).join(' ');
      if (q.startsWith('worktree list')) return { code: 0, stdout: `worktree ${parent}\nHEAD ${head}\n\nworktree ${f.d('w3link')}\nHEAD ${head}\n`, stderr: '' };
      if (q.startsWith('rev-parse HEAD')) return { code: 0, stdout: head, stderr: '' };
      if (q.startsWith('symbolic-ref')) return { code: 0, stdout: 'origin/main', stderr: '' };
      if (q.startsWith('status')) return { code: 0, stdout: ' M x\n', stderr: '' }; // dirty -> rejected, proving we got past "listed"
      return { code: 0, stdout: '', stderr: '' };
    };
    const l = await verifyItem({ id: 'a', category: 'orphan-worktree', path: f.d('w3') }, f.mk({ probe }));
    assert.equal(l.ok, false);
    assert.match(l.reason, /깨끗/);
  } finally { await f.done(); }
});

test('run: a missing tool is reported as not installed, not as a failure', opts, async () => {
  const f = await fixture();
  try {
    const real = f.d('realcache');
    await f.write(W.join(real, 'a'), 'abc');
    const file = await f.plan([{ id: 'n', category: 'pkg-cache', tool: 'npm', path: real }]);
    for (const res of [{ code: -1, stdout: '', stderr: 'ENOENT' }, { code: 9009, stdout: '', stderr: '' }, { code: 1, stdout: '', stderr: "'npm' is not recognized as an internal or external command" }]) {
      const o = collect();
      const code = await main([file], { env: f.env, ...sys, probe: async (a) => (a[0] === 'npm' ? { code: 0, stdout: real, stderr: '' } : { code: 1, stdout: '', stderr: '' }), run: async () => res, ask: async () => 'y', out: o.out });
      assert.equal(code, 0);
      assert.match(o.lines.join('\n'), /도구가 설치되어 있지 않음 — 건너뜀/);
      assert.match(o.lines.join('\n'), /실패 0/);
    }
    // a real failure still fails
    const o = collect();
    const code = await main([file], { env: f.env, ...sys, probe: async (a) => (a[0] === 'npm' ? { code: 0, stdout: real, stderr: '' } : { code: 1, stdout: '', stderr: '' }), run: async () => ({ code: 1, stdout: '', stderr: 'boom' }), ask: async () => 'y', out: o.out });
    assert.equal(code, 1);
  } finally { await f.done(); }
});

const entry = (p, extra = {}) => ({ item: {}, category: 'dev-artifact', action: 'recycle', kind: 'recycle', path: p, isDir: true, size: 10, maxPath: p.length, ...extra });

test('recycle: skipped when the drive is not a fixed NTFS drive, the item is over 5% of the drive, or the path is too long', opts, async () => {
  const f = await fixture();
  try {
    await f.write(f.d('a', 'x.txt'), 'x'); await f.write(f.d('b', 'x.txt'), 'x'); await f.write(f.d('c', 'x.txt'), 'x'); await f.write(f.d('d', 'x.txt'), 'x');
    const o = collect();
    let ctx = f.mk({ ctx: { driveOk: async () => false, out: o.out } });
    await execute([entry(f.d('a'))], ctx);
    assert.match(o.lines.join('\n'), /고정 NTFS/);
    ctx = f.mk({ ctx: { driveTotal: async () => 100, out: o.out } }); // size 10 of 100 = 10% > 5%
    const r2 = await execute([entry(f.d('b'))], ctx);
    assert.match(o.lines.join('\n'), /휴지통 용량 초과 위험 — 건너뜀/);
    assert.equal(r2.skipped, 1);
    ctx = f.mk({ ctx: { out: o.out } });
    await execute([entry(f.d('c'), { maxPath: 300 })], ctx);
    assert.match(o.lines.join('\n'), /경로가 너무 길어/);
    assert.equal(f.calls.recycle.length, 0); // nothing was sent to the recycler
    const r4 = await execute([entry(f.d('d'), { size: 1 })], f.mk({ ctx: { driveTotal: async () => 1000, out: o.out } }));
    assert.equal(r4.done, 1);
    assert.equal(f.calls.recycle.length, 1);
  } finally { await f.done(); }
});

test('recycle results: locked, access denied and the permanent-delete warning are skipped, not failed', opts, async () => {
  const f = await fixture();
  try {
    for (const n of ['a', 'b', 'c', 'd']) await f.write(f.d(n, 'x.txt'), 'x');
    const o = collect();
    const codes = { a: 'SHErr32', b: 'SHErr5', c: 'SHErr1223', d: 'SHErr1026' };
    const ctx = f.mk({ ctx: { out: o.out, recycle: async (l) => l.map((x) => ({ ok: false, e: codes[W.basename(x.path)] })) } });
    const r = await execute(['a', 'b', 'c', 'd'].map((n) => entry(f.d(n))), ctx);
    const text = o.lines.join('\n');
    assert.match(text, /a: 사용 중 — 건너뜀/);
    assert.match(text, /b: 관리자 권한 필요 — 건너뜀/);
    assert.match(text, /c: 휴지통으로 보낼 수 없음\(영구 삭제 경고\) — 건너뜀/);
    assert.deepEqual([r.skipped, r.failed], [3, 1]); // 1026 = unknown shell error stays a failure
  } finally { await f.done(); }
});

test('TOCTOU: the target is re-checked right before recycle/run', opts, async () => {
  const f = await fixture();
  try {
    const o = collect();
    const ctx = () => f.mk({ ctx: { out: o.out } });
    await f.write(f.d('gone', 'x'));
    await f.write(f.d('swapped', 'x')); await f.write(f.d('target', 'x'));
    await f.write(f.d('Windows', 'System32', 'x.dll'));
    await f.write(f.d('home', 'Documents', 'x.txt'));
    await f.write(f.d('real', 'x'));
    const paths = { gone: f.d('gone'), swapped: f.d('swapped'), denied: f.d('Windows', 'System32'), docs: f.d('home', 'Documents') };
    await fs.rm(paths.gone, { recursive: true });
    let junction = true;
    try { await fs.rm(paths.swapped, { recursive: true }); await fs.symlink(f.d('target'), paths.swapped, 'junction'); } catch { junction = false; }
    const r = await execute([entry(paths.gone), ...(junction ? [entry(paths.swapped)] : []), entry(paths.denied), entry(paths.docs),
      entry(f.d('real'), { kind: 'run', action: 'run', argv: ['npm', 'cache', 'clean', '--force'] }),
      entry(paths.denied, { kind: 'run', action: 'run', argv: ['npm', 'cache', 'clean', '--force'] })], ctx());
    const text = o.lines.join('\n');
    assert.match(text, /경로가 사라짐/);
    if (junction) assert.match(text, /링크로 바뀜/);
    assert.match(text, /보호 경로로 판정됨/);
    assert.equal(f.calls.recycle.length, 0); // nothing reached the recycler
    assert.deepEqual(f.calls.run, [['npm', 'cache', 'clean', '--force']]); // only the untouched run target executed
    assert.equal(r.done, 1);
  } finally { await f.done(); }
});

test('orphan-worktree: repo config that can run programs is refused before status/remove', opts, async () => {
  const f = await fixture();
  try {
    const parent = f.d('parent');
    await fs.mkdir(W.join(parent, '.git', 'worktrees', 'wt'), { recursive: true });
    await f.write(f.d('wt', '.git'), 'gitdir: ' + W.join(parent, '.git', 'worktrees', 'wt') + '\n');
    const head = 'c'.repeat(40);
    const mkProbe = (cfg, seen) => async (a) => {
      seen.push(a);
      const q = a.slice(5);
      if (q[0] === 'config') return cfg(a, q);
      if (q[0] === 'worktree') return { code: 0, stdout: `worktree ${parent}\nHEAD ${head}\n\nworktree ${f.d('wt')}\nHEAD ${head}\n`, stderr: '' };
      if (q[0] === 'rev-parse') return { code: 0, stdout: head, stderr: '' };
      if (q[0] === 'symbolic-ref') return { code: 0, stdout: 'origin/main', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const run = async (cfg) => {
      const seen = [];
      const r = await verifyItem({ id: 'w', category: 'orphan-worktree', path: f.d('wt') }, f.mk({ probe: mkProbe(cfg, seen) }));
      return { r, seen, status: seen.some((a) => a[5] === 'status') };
    };
    const clean = await run(() => ({ code: 1, stdout: '', stderr: '' }));
    assert.ok(clean.r.ok, clean.r.reason);
    const cfgCalls = clean.seen.filter((a) => a[5] === 'config');
    assert.equal(cfgCalls.length, 4); // for the worktree and for the parent: the worktreeConfig flag, then the local regexp check
    assert.ok(cfgCalls.every((a) => a[6] === '--local'));
    assert.equal(cfgCalls.filter((a) => a[9] === 'extensions.worktreeConfig').length, 2);
    assert.equal(cfgCalls.filter((a) => a[7] === '--get-regexp').length, 2);
    // with extensions.worktreeConfig on, the per-worktree file is checked too
    const wtCfg = await run((a) => {
      if (a[9] === 'extensions.worktreeConfig') return { code: 0, stdout: 'true\n', stderr: '' };
      return a[6] === '--worktree' ? { code: 0, stdout: 'core.hookspath /x\n', stderr: '' } : { code: 1, stdout: '', stderr: '' };
    });
    assert.equal(wtCfg.r.ok, false);
    assert.ok(wtCfg.seen.some((a) => a[6] === '--worktree'));
    // it must come before status
    assert.ok(clean.seen.findIndex((a) => a[5] === 'config') < clean.seen.findIndex((a) => a[5] === 'status'));
    for (const bad of [
      { code: 0, stdout: 'filter.x.clean evil.exe\n', stderr: '' },
      { code: 0, stdout: 'core.fsmonitor C:/x/hook.exe\n', stderr: '' },
      { code: 128, stdout: '', stderr: 'fatal' },
      { code: -1, stdout: '', stderr: 'ENOENT' },
    ]) {
      const x = await run(() => bad);
      assert.equal(x.r.ok, false);
      assert.match(x.r.reason, /외부 프로그램 실행 항목/);
      assert.equal(x.status, false); // git status never ran
    }
    // only the parent's config is bad: still refused
    const onlyParent = await run((a) => (a[4] === parent ? { code: 0, stdout: 'diff.x.textconv y\n', stderr: '' } : { code: 1, stdout: '', stderr: '' }));
    assert.equal(onlyParent.r.ok, false);
    // (c) prune on a repo root checks config too
    const repo = f.d('someRepo');
    await fs.mkdir(W.join(repo, '.git'), { recursive: true });
    const prune = (cfgOut) => async (a) => {
      const q = a.slice(5);
      if (q[0] === 'worktree') return { code: 0, stdout: `worktree ${repo}\nHEAD ${head}\n\nworktree ${f.d('gone')}\nHEAD ${head}\nprunable x\n`, stderr: '' };
      return cfgOut;
    };
    assert.equal((await verifyItem({ id: 'c', category: 'orphan-worktree', path: repo }, f.mk({ probe: prune({ code: 1, stdout: '', stderr: '' }) }))).ok, true);
    assert.equal((await verifyItem({ id: 'c', category: 'orphan-worktree', path: repo }, f.mk({ probe: prune({ code: 0, stdout: 'include.path x\n', stderr: '' }) }))).ok, false);
  } finally { await f.done(); }
});

test('recycler output: partial results are kept and a missing result is "unknown", not failed', opts, async () => {
  const out = '{"i":0,"ok":true}\n{"i":2,"ok":false,"e":"SHErr32"}\nnot json\n{"i":9,"ok":true}\n{"i":1,';
  assert.deepEqual(parseRecycleOutput(out, 4), [{ i: 0, ok: true }, { ok: false, e: 'Unknown' }, { i: 2, ok: false, e: 'SHErr32' }, { ok: false, e: 'Unknown' }]);
  assert.deepEqual(parseRecycleOutput(undefined, 2), [{ ok: false, e: 'Unknown' }, { ok: false, e: 'Unknown' }]);
  const f = await fixture();
  try {
    for (const n of ['a', 'b', 'c']) await f.write(f.d(n, 'x.txt'), 'x');
    const o = collect();
    const ctx = f.mk({ ctx: { out: o.out, recycle: async () => [{ ok: true }, { ok: false, e: 'Unknown' }] } }); // 3 paths, 2 results (timeout)
    const kids = ['a', 'b', 'c'].map((n) => ({ path: f.d(n), dir: true, size: 1, maxPath: 50 }));
    const r = await execute([entry(f.d('a'), { children: kids })], ctx); // one entry, 3 paths
    assert.deepEqual([r.done, r.skipped, r.failed], [1, 2, 0]);
    assert.match(o.lines.join('\n'), /알 수 없음 \(확인 필요\)/);
  } finally { await f.done(); }
});

test('du counts hard-linked files once', opts, async () => {
  const f = await fixture();
  try {
    await f.write(f.d('t', 'a.bin'), 'x'.repeat(1000));
    await f.write(f.d('t', 'plain.bin'), 'y'.repeat(10));
    try { await fs.link(f.d('t', 'a.bin'), f.d('t', 'sub', 'b.bin').replace('sub\\', '')); await fs.mkdir(f.d('t', 'sub')); await fs.link(f.d('t', 'a.bin'), f.d('t', 'sub', 'c.bin')); } catch { return; }
    assert.equal((await du(f.d('t'))).size, 1010); // 1000 once (3 links) + 10
  } finally { await f.done(); }
});

test('drive check: only a validated drive root reaches PowerShell', opts, async () => {
  for (const bad of ['', 'D:', 'D:\\x', "D:\\'; calc; '", '\\\\srv\\share\\', 'DD:\\']) assert.equal(await defaultDriveOk(bad), false, bad);
  assert.equal(typeof (await defaultDriveOk(W.parse(os.tmpdir()).root)), 'boolean');
});

test('temp: exactly three roots, each protecting claude and machine-map*.html', opts, async () => {
  const f = await fixture();
  try {
    const roots = [f.env.tmp, W.join(f.env.localAppData, 'Temp'), W.join(f.env.windir, 'Temp')];
    await fs.mkdir(roots[1], { recursive: true });
    const ctx = f.mk();
    for (const root of roots) {
      for (const n of ['old.tmp', 'claude\\live.txt', 'Claude\\x', 'machine-map.html', 'machine-map-2.html', 'MACHINE-MAP.HTML']) {
        const p = W.join(root, n);
        await f.write(p).catch(() => {}); // Claude\x collides with claude on a case-insensitive disk: fine
      }
      await f.age(root, 3);
      const r = await verifyItem({ id: root, category: 'temp', path: root }, ctx);
      assert.ok(r.ok, `${root}: ${r.reason}`);
      assert.deepEqual(r.entry.children.map((c) => W.basename(c.path)), ['old.tmp'], root);
      assert.equal(r.entry.skipped, 3, root); // claude, machine-map.html, machine-map-2.html (MACHINE-MAP.HTML is the same file)
    }
    // anything else is not a temp root
    for (const bad of [f.env.localAppData, W.join(roots[1], 'sub'), W.join(roots[0], 'claude'), f.env.windir, f.d('home')]) {
      await fs.mkdir(bad, { recursive: true });
      assert.equal((await verifyItem({ id: bad, category: 'temp', path: bad }, ctx)).ok, false, bad);
    }
    // a root reached through a junction is refused (the path is not the real path)
    const link = f.d('templink');
    try { await fs.symlink(roots[1], link, 'junction'); } catch { return; }
    assert.equal((await verifyItem({ id: 'l', category: 'temp', path: link }, ctx)).ok, false);
  } finally { await f.done(); }
});

// ---------- AI tools and editors ----------
const mkdirs = async (f, ...paths) => { for (const p of paths) await f.write(W.join(p, 'x.bin'), 'x'); };
const accept = (r) => assert.ok(r.ok, r.reason);

test('ai-old-version: only non-newest direct children, recomputed per group from disk', opts, async () => {
  const f = await fixture();
  try {
    const cli = f.d('home', '.local', 'share', 'claude', 'versions');
    await mkdirs(f, ...['2.1.50', '2.1.51', '2.1.52', 'notes'].map((n) => W.join(cli, n)));
    const v = (p, over) => verifyItem({ id: p, category: 'ai-old-version', path: p }, f.mk(over));
    accept(await v(W.join(cli, '2.1.50')));
    accept(await v(W.join(cli, '2.1.51')));
    assert.match((await v(W.join(cli, '2.1.52'))).reason, /최신/);
    assert.match((await v(W.join(cli, 'notes'))).reason, /해석/);
    const e = (await v(W.join(cli, '2.1.50'))).entry;
    assert.deepEqual([e.action, e.category, e.size], ['recycle', 'ai-old-version', 1]);
    // the version `claude --version` reports is refused; an unanswered probe does not block
    const running = { probe: async (a) => (a.join(' ') === 'claude --version' ? { code: 0, stdout: '2.1.51 (Claude Code)\n', stderr: '' } : { code: 1, stdout: '', stderr: '' }) };
    assert.match((await v(W.join(cli, '2.1.51'), running)).reason, /실행 중/);
    accept(await v(W.join(cli, '2.1.50'), running));
    accept(await v(W.join(cli, '2.1.51'), { probe: async () => ({ code: -1, stdout: '', stderr: 'ENOENT' }) }));
    // numeric compare: 2.1.9 is older than 2.1.10
    await mkdirs(f, W.join(cli, '2.1.9'), W.join(cli, '2.1.10'));
    accept(await v(W.join(cli, '2.1.9')));
    assert.match((await v(W.join(cli, '2.1.52'))).reason, /최신/);
    // not a direct child, the root itself, or somewhere else
    await mkdirs(f, W.join(cli, '2.1.50', 'sub'), f.d('home', 'other', '1.0.0'));
    for (const p of [W.join(cli, '2.1.50', 'sub'), cli, f.d('home', 'other', '1.0.0')]) assert.equal((await v(p)).ok, false, p);

    // a group with a single entry is never touched
    const cc = W.join(f.env.appData, 'Claude', 'claude-code');
    await mkdirs(f, W.join(cc, '1.0.0'));
    assert.match((await v(W.join(cc, '1.0.0'))).reason, /하나뿐/);
    await mkdirs(f, W.join(cc, '1.1.0'));
    accept(await v(W.join(cc, '1.0.0')));
    assert.equal((await v(W.join(cc, '1.1.0'))).ok, false);

    // editor extensions: grouped by id, platform builds of the newest version both stay
    const ext = f.d('home', '.vscode', 'extensions');
    const names = ['pub.a-1.0.0-win32-x64', 'pub.a-1.2.0-win32-x64', 'pub.b-3.0.0', 'pub.c-1.0.0', 'pub.c-1.0.0-win32-x64', 'pub.c-0.9.0'];
    await mkdirs(f, ...names.map((n) => W.join(ext, n)));
    await f.write(W.join(ext, 'extensions.json'), '[]');
    const res = Object.fromEntries(await Promise.all(names.map(async (n) => [n, (await v(W.join(ext, n))).ok])));
    assert.deepEqual(res, { 'pub.a-1.0.0-win32-x64': true, 'pub.a-1.2.0-win32-x64': false, 'pub.b-3.0.0': false, 'pub.c-1.0.0': false, 'pub.c-1.0.0-win32-x64': false, 'pub.c-0.9.0': true });
    assert.equal((await v(W.join(ext, 'extensions.json'))).ok, false);
    const cur = f.d('home', '.cursor', 'extensions');
    await mkdirs(f, W.join(cur, 'x.y-1.0.0'), W.join(cur, 'x.y-2.0.0'));
    accept(await v(W.join(cur, 'x.y-1.0.0')));
    // a version the editor lists in extensions.json is in use: refused by folder name or by id@version; bad JSON blocks nothing
    await f.write(W.join(ext, 'extensions.json'), JSON.stringify([{ identifier: { id: 'pub.c' }, version: '0.9.0' }, { relativeLocation: 'pub.a-1.0.0-win32-x64' }]));
    for (const n of ['pub.c-0.9.0', 'pub.a-1.0.0-win32-x64']) assert.match((await v(W.join(ext, n))).reason, /사용 중인 확장/, n);
    await f.write(W.join(ext, 'extensions.json'), '{not json');
    accept(await v(W.join(ext, 'pub.c-0.9.0')));
    // another category cannot borrow these paths
    assert.equal((await verifyItem({ id: 'a', category: 'ai-temp', path: W.join(cur, 'x.y-1.0.0') }, f.mk())).ok, false);
  } finally { await f.done(); }
});

test('ai-temp: the AI temp roots are accepted, their old-enough children are recycled, protected state never', opts, async () => {
  const f = await fixture();
  try {
    const cx = f.d('home', '.codex'), tc = W.join(f.env.tmp, 'claude'), trash = f.d('home', '.claude', 'plugins', '.trash');
    const cwd = f.d('proj', 'my sub_dir');
    const slug = (p) => p.replace(/[^A-Za-z0-9]/g, '-');
    const mk = async (p, days) => { await f.write(W.join(p, 'a.bin'), 'x'); await f.age(p, days); };
    await mk(W.join(cx, '.tmp', 'old'), 3); await mk(W.join(cx, '.tmp', 'new'), 0.2);
    await mk(W.join(cx, '.tmp', 'busy.lock'), 3); await mk(W.join(cx, '.tmp', 'x.GUARD'), 3); // lock/guard names are never recycled
    await f.write(W.join(cx, '.tmp', 'withenv', '.env'), 'S=1'); await f.age(W.join(cx, '.tmp', 'withenv'), 5);
    await f.write(W.join(cx, '.tmp', 'repo', 'r', '.git', 'HEAD')); await f.age(W.join(cx, '.tmp', 'repo'), 5);
    await mk(W.join(cx, 'cache', 'old'), 3);
    await mk(W.join(trash, 'fresh'), 0);
    await mk(W.join(tc, 'old-session'), 20); await mk(W.join(tc, 'mid-session'), 8);
    await mk(W.join(tc, slug(cwd)), 30); await mk(W.join(tc, slug(f.d('proj'))), 30); // the running session and a project it sits in
    const ctx = f.mk({ ctx: { cwd } });
    const v = (p) => verifyItem({ id: p, category: 'ai-temp', path: p }, ctx);
    const names = (r) => r.entry.children.map((c) => W.basename(c.path)).sort();
    const roots = [
      [W.join(cx, '.tmp'), 'safe', 1, ['old']],
      [W.join(cx, 'cache'), 'safe', 1, ['old']],
      [trash, 'safe', 0, ['fresh']],
      [tc, 'check', 14, ['old-session']],
    ];
    for (const [p, tier, days, kids] of roots) {
      const r = await v(p); accept(r);
      assert.deepEqual([r.entry.action, r.entry.tier, r.entry.ageDays, names(r)], ['recycle', tier, days, kids], p);
    }
    // children, deeper paths and other Codex/Claude state are not roots
    await f.write(W.join(cx, 'sessions', '2026', 'rollout.jsonl')); await f.write(W.join(cx, 'auth.json'), '{}'); await f.write(f.d('home', '.claude', 'projects', 'p', 'a.jsonl'));
    await f.write(W.join(cx, '.sandbox-recovery', 'r', 'a.bin'));
    for (const p of [W.join(cx, '.tmp', 'old'), W.join(tc, 'old-session'), W.join(trash, 'fresh'), W.join(cx, '.tmp', 'old', 'x'), cx, W.join(cx, 'sessions'), W.join(cx, 'sessions', '2026'), W.join(cx, '.sandbox-recovery'), W.join(cx, '.sandbox-recovery', 'r'), W.join(cx, 'auth.json'), f.d('home', '.claude', 'projects', 'p'), f.d('home', '.claude', 'plugins'), f.env.tmp]) {
      assert.equal((await v(p)).ok, false, p);
    }
    // through main(): the confirmed run recycles exactly the qualifying children
    const file = await f.plan([{ id: 'a', category: 'ai-temp', path: W.join(cx, '.tmp') }, { id: 'b', category: 'ai-temp', path: tc }]);
    const calls = [], o = collect();
    await main([file], { env: f.env, cwd, ...sys, recycle: async (l) => { calls.push(l); return l.map(() => ({ ok: true })); }, ask: async () => 'y', out: o.out });
    assert.deepEqual(calls.flat().map((c) => c.path).sort(), [W.join(cx, '.tmp', 'old'), W.join(tc, 'old-session')].sort());
    // the listed safety label is the root's own tier
    const lo = collect();
    await main([file, '--dry-run'], { env: f.env, cwd, out: lo.out });
    const text = lo.lines.join('\n');
    assert.match(text, /\[삭제해도 됨\].*\.tmp.*<ai-temp>/);
    assert.match(text, /\[확인 후 삭제\].*claude.*<ai-temp>.*14일 이상/);
  } finally { await f.done(); }
});

test('codex worktrees: a dev-artifact with changes inside the last 14 days is skipped', opts, async () => {
  const f = await fixture();
  try {
    const wt = f.d('home', '.codex', 'worktrees');
    for (const id of ['ab12', 'cd34']) { await f.write(W.join(wt, id, 'repo', 'package.json'), '{}'); await f.write(W.join(wt, id, 'repo', 'node_modules', 'x.js')); await f.age(W.join(wt, id), 200); }
    await f.write(W.join(wt, 'cd34', 'repo', 'node_modules', 'fresh.js')); // changed just now
    const ctx = f.mk();
    const v = (p) => verifyItem({ id: p, category: 'dev-artifact', path: p }, ctx);
    accept(await v(W.join(wt, 'ab12', 'repo', 'node_modules')));
    const busy = await v(W.join(wt, 'cd34', 'repo', 'node_modules'));
    assert.equal(busy.ok, false);
    assert.match(busy.reason, /14일/);
  } finally { await f.done(); }
});

test('editor-state is report-only: the workspaceStorage root or a hash folder is listed, never executed', opts, async () => {
  const f = await fixture();
  try {
    const ws = (app) => W.join(f.env.appData, app, 'User', 'workspaceStorage');
    await f.write(W.join(ws('Code'), 'hashold', 'state.vscdb'), '123'); await f.age(W.join(ws('Code'), 'hashold'), 120);
    await f.write(W.join(ws('Cursor'), 'hashnew', 'state.vscdb'), '1');
    await f.write(W.join(f.env.appData, 'Code', 'User', 'globalStorage', 'x', 'a'));
    const ctx = f.mk();
    const v = (p) => verifyItem({ id: p, category: 'editor-state', path: p }, ctx);
    for (const p of [ws('Code'), W.join(ws('Code'), 'hashold'), W.join(ws('Cursor'), 'hashnew')]) {
      const r = await v(p); accept(r);
      assert.equal(r.entry.action, 'report', p);
    }
    for (const p of [W.join(f.env.appData, 'Code', 'User', 'globalStorage', 'x'), W.join(ws('Code'), 'hashold', 'state.vscdb'), f.env.appData]) assert.equal((await v(p)).ok, false, p);
    const file = await f.plan([{ id: 'a', category: 'editor-state', path: W.join(ws('Code'), 'hashold') }, { id: 'b', category: 'editor-state', path: ws('Cursor') }]);
    const o = collect();
    const never = async () => { throw new Error('executed'); };
    assert.equal(await main([file], { env: f.env, recycle: never, run: never, ask: never, out: o.out }), 0);
    const text = o.lines.join('\n');
    assert.match(text, /\[직접 판단\].*<editor-state>/);
    assert.match(text, /실행할 항목이 없습니다/);
  } finally { await f.done(); }
});

test('crash-dump also accepts the editors Crashpad folders (children), nothing else', opts, async () => {
  const f = await fixture();
  try {
    const cp = (app) => W.join(f.env.appData, app, 'Crashpad');
    for (const app of ['Code', 'Cursor']) { await f.write(W.join(cp(app), 'reports', 'a.dmp'), 'x'); await f.write(W.join(cp(app), 'settings.dat'), 'xx'); }
    await f.write(W.join(f.env.appData, 'Code', 'Cache', 'x'));
    const ctx = f.mk();
    for (const app of ['Code', 'Cursor']) {
      const r = await verifyItem({ id: app, category: 'crash-dump', path: cp(app) }, ctx);
      accept(r);
      assert.deepEqual(r.entry.children.map((c) => W.basename(c.path)).sort(), ['reports', 'settings.dat']);
      assert.equal(r.entry.size, 3);
    }
    assert.equal((await verifyItem({ id: 'x', category: 'crash-dump', path: W.join(f.env.appData, 'Code', 'Cache') }, ctx)).ok, false);
    assert.equal((await verifyItem({ id: 'x', category: 'crash-dump', path: W.join(cp('Code'), 'reports') }, ctx)).ok, false);
    assert.equal((await verifyItem({ id: 'x', category: 'app-cache', path: cp('Code') }, ctx)).ok, false);
  } finally { await f.done(); }
});

test('ai-history is report-only: listed with a size, never executed', opts, async () => {
  const f = await fixture();
  try {
    const h = [f.d('home', '.codex', 'sessions'), f.d('home', '.codex', 'archived_sessions'), f.d('home', '.claude', 'projects'), f.d('npmroot', 'node_modules', '@anthropic-ai', 'claude-code')];
    for (const p of h) await f.write(W.join(p, 'a.jsonl'), '12345');
    await f.write(f.d('home', 'notes', 'a.txt'));
    const ctx = f.mk();
    for (const p of h) {
      const r = await verifyItem({ id: p, category: 'ai-history', path: p }, ctx);
      accept(r);
      assert.deepEqual([r.entry.action, r.entry.size], ['report', 5]);
    }
    assert.equal((await verifyItem({ id: 'n', category: 'ai-history', path: f.d('home', 'notes') }, ctx)).ok, false);
    assert.equal((await verifyItem({ id: 'n', category: 'ai-history', path: f.d('home', '.codex') }, ctx)).ok, false);
    const file = await f.plan(h.map((p, i) => ({ id: String(i), category: 'ai-history', path: p })));
    const o = collect();
    const never = async () => { throw new Error('executed'); };
    assert.equal(await main([file], { env: f.env, recycle: never, run: never, ask: never, out: o.out }), 0);
    const text = o.lines.join('\n');
    assert.match(text, /\[직접 판단\]/);
    assert.match(text, /npm uninstall -g @anthropic-ai\/claude-code/);
    assert.match(text, /실행할 항목이 없습니다/);
  } finally { await f.done(); }
});

test('the listed tier of the new categories follows tierOf / the root tier', opts, async () => {
  const f = await fixture();
  try {
    const cli = f.d('home', '.local', 'share', 'claude', 'versions');
    await mkdirs(f, W.join(cli, '1.0.0'), W.join(cli, '1.1.0'));
    const hash = W.join(f.env.appData, 'Code', 'User', 'workspaceStorage', 'h');
    await f.write(W.join(hash, 's')); await f.age(hash, 100);
    const rec = f.d('home', '.codex', '.sandbox-recovery');
    await f.write(W.join(rec, 's')); await f.age(rec, 20);
    const file = await f.plan([
      { id: 'a', category: 'ai-old-version', path: W.join(cli, '1.0.0') },
      { id: 'b', category: 'editor-state', path: hash },
      { id: 'c', category: 'ai-history', path: rec },
    ]);
    const o = collect();
    assert.equal(await main([file, '--dry-run'], { env: f.env, out: o.out }), 0);
    const text = o.lines.join('\n');
    assert.match(text, /\[삭제해도 됨\].*1\.0\.0.*<ai-old-version>/);
    assert.match(text, /\[직접 판단\].*<editor-state>/);
    assert.match(text, /\[직접 판단\].*\.sandbox-recovery.*<ai-history>/);
  } finally { await f.done(); }
});

// ---------- confirmation, dry-run, execution ----------
async function scenario() {
  const f = await fixture();
  await f.write(f.d('proj', 'package.json'), '{}');
  await f.write(f.d('proj', 'node_modules', 'a.js'), 'abc');
  await f.age(f.d('proj'));
  const file = await f.plan([
    { id: 'n', category: 'dev-artifact', path: f.d('proj', 'node_modules'), size: 1 },
    { id: 'd', category: 'dev-artifact', path: f.d('Windows', 'System32') },
    { id: 'x', category: 'bogus', path: 'rel' },
    { id: 'c', category: 'pkg-cache', tool: 'npm', path: f.d('realcache'), how: 'del /s C:\\', action: 'calc.exe' },
  ]);
  return { f, file };
}
const collect = () => { const lines = []; return { lines, out: (s) => lines.push(s) }; };

test('--dry-run lists, rejects, and never calls run/recycle/ask', opts, async () => {
  const { f, file } = await scenario();
  try {
    const o = collect();
    let asked = false;
    const code = await main([file, '--dry-run'], { env: f.env, probe: async () => ({ code: 1, stdout: '', stderr: '' }), run: async () => { throw new Error('run'); }, recycle: async () => { throw new Error('recycle'); }, ask: async () => { asked = true; }, out: o.out });
    assert.equal(code, 0);
    assert.equal(asked, false);
    const text = o.lines.join('\n');
    assert.match(text, /\[휴지통 이동\].*node_modules/);
    assert.match(text, /3 B/);
    assert.match(text, /\[거부\].*System32/);
    assert.match(text, /\[거부\].*rel/);
    assert.match(text, /변경하지 않았습니다/);
    await fs.access(f.d('proj', 'node_modules', 'a.js')); // untouched
  } finally { await f.done(); }
});

test('confirmation: anything but y aborts; y recycles the expected paths', opts, async () => {
  const { f, file } = await scenario();
  try {
    for (const ans of ['n', '', 'yes', null, undefined, 'yy']) {
      const calls = [];
      const code = await main([file], { env: f.env, ...sys, recycle: async (l) => { calls.push(l); return []; }, run: async (a) => { calls.push(a); return { code: 0 }; }, ask: async () => ans, out: () => {} });
      assert.equal(code, 1, `answer ${JSON.stringify(ans)}`);
      assert.equal(calls.length, 0);
    }
    const calls = [], runs = [], o = collect();
    const code = await main([file], { env: f.env, ...sys, recycle: async (l) => { calls.push(l); return l.map(() => ({ ok: true })); }, run: async (a) => { runs.push(a); return { code: 0 }; }, ask: async () => 'y', out: o.out });
    assert.equal(code, 0);
    assert.deepEqual(calls, [[{ path: f.d('proj', 'node_modules'), dir: true }]]);
    assert.deepEqual(runs, []); // the plan's command-like text never reaches a runner
    assert.match(o.lines.join('\n'), /요약: 완료 1/);
  } finally { await f.done(); }
});

test('execution: access denied is skipped with the admin message, plan commands are never run', opts, async () => {
  const f = await fixture();
  try {
    await f.write(W.join(f.env.localAppData, 'CrashDumps', 'a.dmp'), 'x');
    const real = f.d('realcache');
    await f.write(W.join(real, 'a'), 'abc');
    const file = await f.plan([
      { id: 'c', category: 'crash-dump', path: W.join(f.env.localAppData, 'CrashDumps') },
      { id: 'n', category: 'pkg-cache', tool: 'npm', path: real },
      { id: 'v', category: 'recycle-bin', path: f.d('realcache') },
    ]);
    const o = collect(), runs = [];
    const code = await main([file], {
      env: f.env, ...sys,
      probe: async (a) => (a[0] === 'npm' ? { code: 0, stdout: real, stderr: '' } : { code: 1, stdout: '', stderr: '' }),
      recycle: async () => [{ ok: false, e: 'UnauthorizedAccessException' }],
      run: async (a) => { runs.push(a); return { code: 0, stdout: '', stderr: '' }; },
      ask: async () => 'y', out: o.out,
    });
    const text = o.lines.join('\n');
    assert.equal(code, 0);
    assert.match(text, /관리자 권한 필요 — 건너뜀/);
    assert.deepEqual(runs, [['npm', 'cache', 'clean', '--force']]); // report item ($Recycle.Bin mismatch rejected, never executed)
  } finally { await f.done(); }
});
