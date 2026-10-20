import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isDenied, secretFile } from '../lib/deny.mjs';
import { resolveCacheDir, CACHE_TOOLS } from '../lib/caches.mjs';
import { validatePlan, verifyItem, main, makeCtx } from '../clean.mjs';

const W = path.win32;
const win = process.platform === 'win32';

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
  ['C:\\Users\\me\\.claude\\plugins\\cache\\mk\\pl\\1.0.0', false], ['c:/users/ME/.claude/plugins/cache/mk/pl/1.0.0/x/y', false],
  ['C:\\Users\\me\\.claude-mem', true], ['C:\\Users\\me\\.claude-mem\\db', true],
  ['C:\\Users\\me\\x\\.credentials.json', true], ['C:\\Users\\me\\x\\.env', true], ['C:\\Users\\me\\x\\.env.local\\a', true],
  ['C:\\Users\\me\\x\\.envrc', true], ['C:\\Users\\me\\x\\env.txt', false],
  ['D:\\Temp', true], ['D:\\Temp\\foo', false], ['D:\\Temp\\claude', true], ['d:/temp/CLAUDE/x', true],
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
  assert.equal(Object.keys(items[1]).sort().join(), 'category,id,path,safety,size,tool'); // extra fields dropped
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
    ...over.ctx,
  });
  const write = async (p, s = 'x') => { await fs.mkdir(W.dirname(p), { recursive: true }); await fs.writeFile(p, s); };
  const plan = async (items) => { const f = d('plan.json'); await fs.writeFile(f, JSON.stringify({ version: 1, items })); return f; };
  return { root, d, env, calls, mk, write, plan, done: () => fs.rm(root, { recursive: true, force: true }) };
}
const opts = { skip: !win && 'Windows-only' };

// ---------- re-verify ----------
test('verify: missing path, re-measured size, symlink refused', opts, async () => {
  const f = await fixture();
  try {
    const nm = f.d('proj', 'node_modules');
    await f.write(W.join(nm, 'a.js'), '12345');
    await f.write(W.join(nm, 'sub', 'b.js'), '123');
    await f.write(f.d('proj', 'package.json'), '{}');
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
    // tool does not answer -> official default location
    await f.write(W.join(f.env.localAppData, 'pip', 'cache', 'a'));
    const pip = await verifyItem({ id: 'p', category: 'pkg-cache', tool: 'pip', path: W.join(f.env.localAppData, 'pip', 'cache') }, ctx);
    assert.deepEqual(pip.entry.argv, ['pip', 'cache', 'purge']);
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
      const s = a.slice(3).join(' ');
      if (s.startsWith('worktree list')) return { code: 0, stdout: `worktree ${parent.replace(/\\/g, '/')}\nHEAD ${head}\n\nworktree ${f.d('wt2').replace(/\\/g, '/')}\nHEAD ${head}\n`, stderr: '' };
      if (s.startsWith('rev-parse HEAD')) return { code: 0, stdout: head + '\n', stderr: '' };
      if (s.startsWith('symbolic-ref')) return { code: 0, stdout: 'origin/main\n', stderr: '' };
      if (s.startsWith('merge-base')) return { code: merged ? 0 : 1, stdout: '', stderr: '' };
      if (s.startsWith('status')) return { code: 0, stdout: dirty ? ' M a.txt\n' : '', stderr: '' };
      return { code: 1, stdout: '', stderr: '' };
    };
    const b = await verifyItem({ id: 'b', category: 'orphan-worktree', path: f.d('wt2') }, f.mk({ probe: git(false) }));
    assert.ok(b.ok);
    assert.deepEqual(b.entry.argv, ['git', '-C', parent, 'worktree', 'remove', '--', f.d('wt2')]);
    assert.equal(b.entry.action, 'run');
    assert.equal((await verifyItem({ id: 'b', category: 'orphan-worktree', path: f.d('wt2') }, f.mk({ probe: git(true) }))).ok, false);
    assert.equal((await verifyItem({ id: 'b', category: 'orphan-worktree', path: f.d('wt2') }, f.mk({ probe: git(false, false) }))).ok, false);
  } finally { await f.done(); }
});

test('verify: orphan-worktree (c) repo root with a .git dir and prunable entries -> git worktree prune', opts, async () => {
  const f = await fixture();
  try {
    const repo = f.d('someRepo');
    await fs.mkdir(W.join(repo, '.git', 'worktrees'), { recursive: true });
    const list = (prunable) => (a) => (a.slice(3).join(' ') === 'worktree list --porcelain'
      ? { code: 0, stdout: `worktree ${repo.replace(/\\/g, '/')}\nHEAD ${'a'.repeat(40)}\n\nworktree ${f.d('gone').replace(/\\/g, '/')}\nHEAD ${'b'.repeat(40)}\n${prunable ? 'prunable gitdir file points to non-existent location\n' : ''}`, stderr: '' }
      : { code: 1, stdout: '', stderr: '' });
    const r = await verifyItem({ id: 'c', category: 'orphan-worktree', path: repo }, f.mk({ probe: list(true) }));
    assert.ok(r.ok);
    assert.deepEqual([r.entry.action, r.entry.argv], ['run', ['git', '-C', repo, 'worktree', 'prune']]);
    assert.equal((await verifyItem({ id: 'c', category: 'orphan-worktree', path: repo }, f.mk({ probe: list(false) }))).ok, false);
    // through main(): confirmed run executes exactly the prune argv, nothing is recycled
    const file = await f.plan([{ id: 'c', category: 'orphan-worktree', path: repo, how: 'rm -rf /' }]);
    const runs = [];
    const code = await main([file], { env: f.env, probe: list(true), run: async (a) => { runs.push(a); return { code: 0 }; }, recycle: async () => { throw new Error('recycle'); }, ask: async () => 'y', out: () => {} });
    assert.equal(code, 0);
    assert.deepEqual(runs, [['git', '-C', repo, 'worktree', 'prune']]);
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
    const bad = [la, W.join(la, 'NVIDIA'), W.join(la, 'Programs'), ad, W.join(ad, 'Discord'), W.join(ad, 'Discord', 'Local Storage'), W.join(ad, 'a', 'b', 'Cache'), W.join(la, 'Microsoft', 'Windows'), f.d('home', 'Documents')];
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
    const code = await main([file], { env: f.env, recycle: async (l) => l.map(() => ({ ok: false, e: 'IOException' })), ask: async () => 'y', out: o.out });
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

test('safety tier is shown but never changes decisions', opts, async () => {
  const f = await fixture();
  try {
    await f.write(f.d('proj', 'package.json'), '{}');
    await f.write(f.d('proj', 'node_modules', 'a.js'), 'abc');
    const file = await f.plan([
      { id: 'a', category: 'dev-artifact', path: f.d('proj', 'node_modules'), safety: 'safe' },
      { id: 'b', category: 'dev-artifact', path: f.d('Windows', 'System32'), safety: 'safe' }, // still refused
      { id: 'c', category: 'dev-artifact', path: f.d('proj', 'dist'), safety: 'bogus' },
    ]);
    await f.write(f.d('proj', 'dist', 'x'));
    await f.write(f.d('proj', 'build', 'x'));
    const o = collect();
    assert.equal(await main([file, '--dry-run'], { env: f.env, out: o.out }), 0);
    const text = o.lines.join('\n');
    assert.match(text, /\[휴지통 이동\] \[삭제해도 됨\].*node_modules/);
    assert.match(text, /\[휴지통 이동\] \[직접 판단\].*dist/); // invalid tier falls back to the most cautious label
    assert.match(text, /\[거부\].*System32/);
    for (const [tier, label] of [['check', '확인 후 삭제'], ['manual', '직접 판단']]) {
      const pf = await f.plan([{ id: 'a', category: 'dev-artifact', path: f.d('proj', 'node_modules'), safety: tier }]);
      const oo = collect();
      await main([pf, '--dry-run'], { env: f.env, out: oo.out });
      assert.ok(oo.lines.join('\n').includes(`[${label}]`));
    }
  } finally { await f.done(); }
});

// ---------- confirmation, dry-run, execution ----------
async function scenario() {
  const f = await fixture();
  await f.write(f.d('proj', 'package.json'), '{}');
  await f.write(f.d('proj', 'node_modules', 'a.js'), 'abc');
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
      const code = await main([file], { env: f.env, recycle: async (l) => { calls.push(l); return []; }, run: async (a) => { calls.push(a); return { code: 0 }; }, ask: async () => ans, out: () => {} });
      assert.equal(code, 1, `answer ${JSON.stringify(ans)}`);
      assert.equal(calls.length, 0);
    }
    const calls = [], runs = [], o = collect();
    const code = await main([file], { env: f.env, recycle: async (l) => { calls.push(l); return l.map(() => ({ ok: true })); }, run: async (a) => { runs.push(a); return { code: 0 }; }, ask: async () => 'y', out: o.out });
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
      env: f.env,
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
