import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { walk } from '../lib/walk.mjs';
import * as D from '../lib/detectors.mjs';

const DAY = 86400e3;

async function setup() {
  const T = await fs.mkdtemp(path.join(os.tmpdir(), 'det-test-'));
  const p = (...a) => path.join(T, ...a);
  const put = async (rel, size = 10, ageDays = 0) => {
    const f = p(rel);
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, Buffer.alloc(size, 1));
    const d = new Date(Date.now() - ageDays * DAY);
    await fs.utimes(f, d, d);
    return f;
  };
  // Build the env after the fixture is filled: walk is the single disk pass, detectors only look things up.
  const env = async (extra = {}) => {
    const r = await walk([T], { bigBytes: 1000 });
    return {
      home: p('home'), tmp: p('tmp'), localAppData: p('home', 'AppData', 'Local'), appData: p('home', 'AppData', 'Roaming'),
      windir: p('win'), drives: [T], idx: r.idx, sizeOf: r.sizeOf,
      git: async () => ({ ok: false, out: '' }), listInstalledApps: async () => [], ...extra,
    };
  };
  return { T, p, put, env, done: () => fs.rm(T, { recursive: true, force: true }) };
}

// Fake probe: every listed tool is "installed" and reports its default cache dir; others fail like a missing command.
const installedProbe = (f, tools = ['npm', 'pnpm', 'yarn', 'pip', 'uv', 'bun', 'dotnet']) => async (argv) => {
  const la = f.p('home', 'AppData', 'Local');
  const dirs = {
    npm: path.join(la, 'npm-cache'), pnpm: path.join(la, 'pnpm', 'store'), yarn: path.join(la, 'Yarn', 'Cache'),
    pip: path.join(la, 'pip', 'cache'), uv: path.join(la, 'uv', 'cache'), bun: f.p('home', '.bun', 'install', 'cache'), dotnet: '8.0.100',
  };
  return tools.includes(argv[0]) ? { code: 0, stdout: `${dirs[argv[0]]}
` } : { code: 1, stdout: '' };
};

function assertShape(j) {
  assert.equal(typeof j.id, 'string');
  assert.ok(j.id.startsWith(`${j.category}:`));
  assert.equal(typeof j.label, 'string');
  assert.equal(typeof j.path, 'string');
  assert.ok(Number.isInteger(j.size) && j.size >= 0, `size ${j.size}`);
  assert.ok(Number.isInteger(j.mtime), `mtime ${j.mtime}`);
  assert.ok(j.score >= 0 && j.score <= 1);
  assert.ok(j.reason && j.how);
  assert.ok(['safe', 'check', 'manual'].includes(j.safety), `safety ${j.safety}`);
  assert.ok(typeof j.effect === 'string' && j.effect.length > 10);
  assert.ok(['recycle', 'command', 'report'].includes(j.action));
}

test('temp: only children older than 1 day, never claude or machine-map.html', async (t) => {
  const f = await setup();
  t.after(f.done);
  await f.put('tmp/old.bin', 100, 3);
  await f.put('tmp/olddir/x.bin', 50, 3);
  await f.put('tmp/new.bin', 1000, 0);
  await f.put('tmp/claude/session/x', 5000, 9);
  await f.put('tmp/machine-map.html', 7000, 9);
  await f.put('tmp/machine-map-2.html', 7000, 9);
  await f.put('tmp/.env.runtime', 1, 9); // credential-like name: only stat'ed, never opened
  await f.put('win/Temp/w.bin', 20, 5);
  const out = await D.detectTemp(await f.env());
  out.forEach(assertShape);
  assert.equal(out.length, 2);
  const tmp = out.find((j) => j.path === f.p('tmp'));
  assert.equal(tmp.size, 151);
  assert.equal(tmp.category, 'temp');
  assert.equal(tmp.action, 'recycle');
  assert.equal(out.find((j) => j.path === f.p('win', 'Temp')).size, 20);
});

test('pkg-cache: resolves real cache dirs and only those that exist', async (t) => {
  const f = await setup();
  t.after(f.done);
  const la = path.join('home', 'AppData', 'Local');
  await f.put(path.join(la, 'npm-cache', 'a'), 10);
  await f.put(path.join(la, 'pnpm', 'store', 'a'), 10);
  await f.put(path.join(la, 'Yarn', 'Cache', 'a'), 10);
  await f.put(path.join(la, 'pip', 'cache', 'a'), 10);
  await f.put(path.join(la, 'uv', 'cache', 'a'), 10);
  await f.put(path.join('home', '.bun', 'install', 'cache', 'a'), 10);
  await f.put(path.join('home', '.nuget', 'packages', 'a'), 10);
  await f.put(path.join('home', '.gradle', 'caches', 'a'), 10);
  const all = await D.detectPkgCache(await f.env({ probe: installedProbe(f) }));
  all.forEach(assertShape);
  assert.deepEqual(all.map((j) => j.tool).sort(), ['bun', 'gradle', 'npm', 'nuget', 'pip', 'pnpm', 'uv', 'yarn']);
  assert.equal(all.find((j) => j.tool === 'gradle').action, 'recycle');
  assert.equal(all.find((j) => j.tool === 'npm').action, 'command');
  assert.equal(all.find((j) => j.tool === 'npm').how, 'npm cache clean --force');

  await fs.rm(f.p('home', '.bun'), { recursive: true });
  assert.ok(!(await D.detectPkgCache(await f.env({ probe: installedProbe(f) }))).some((j) => j.tool === 'bun'));
});

test('pkg-cache: a cache whose tool is not installed is not flagged; pnpm carries a size caveat', async (t) => {
  const f = await setup();
  t.after(f.done);
  const la = path.join('home', 'AppData', 'Local');
  await f.put(path.join(la, 'pip', 'cache', 'a'), 10);
  await f.put(path.join(la, 'pnpm', 'store', 'a'), 10);
  await f.put(path.join('home', '.nuget', 'packages', 'a'), 10);
  await f.put(path.join('home', '.gradle', 'caches', 'a'), 10);
  const out = await D.detectPkgCache(await f.env({ probe: installedProbe(f, ['pnpm']) })); // no pip, no dotnet
  assert.deepEqual(out.map((j) => j.tool).sort(), ['gradle', 'pnpm']);
  assert.match(out.find((j) => j.tool === 'pnpm').effect, /실제 확보량은 더 적을 수 있음/);
});

test('dev-artifact: stale projects only, mtime ignores the artifact itself, no nested artifacts', async (t) => {
  const f = await setup();
  t.after(f.done);
  // stale project whose node_modules was installed today (must still be flagged)
  await f.put('proj/old/package.json', 10, 200);
  await f.put('proj/old/src/a.js', 10, 200);
  await f.put('proj/old/node_modules/x/index.js', 500, 0);
  await f.put('proj/old/node_modules/x/node_modules/y/index.js', 500, 0);
  await f.put('proj/old/.venv/lib.py', 300, 0);
  // fresh project
  await f.put('proj/fresh/package.json', 10, 200);
  await f.put('proj/fresh/src/a.js', 10, 1);
  await f.put('proj/fresh/node_modules/x/index.js', 500, 0);
  // not a project
  await f.put('misc/node_modules/x/index.js', 500, 200);
  const out = await D.detectDevArtifact(await f.env(), { minBytes: 1 });
  out.forEach(assertShape);
  assert.deepEqual(out.map((j) => j.path).sort(), [f.p('proj', 'old', '.venv'), f.p('proj', 'old', 'node_modules')].sort());
  assert.equal(out.find((j) => j.path.endsWith('node_modules')).size, 1000);
  assert.equal(out[0].score, 0.8);
  // default minBytes (1 MB) drops these small ones
  assert.equal((await D.detectDevArtifact(await f.env())).length, 0);
});

// ---- orphan-worktree ----
function fakeGit(repo, { listed, ancestors, dirty = [], prunable = [] }) {
  const fw = (x) => x.replace(/\\/g, '/');
  const calls = [];
  const git = async (args, cwd) => {
    calls.push([args.join(' '), cwd]);
    const [a, b] = args;
    if (a === 'worktree') {
      const blocks = [`worktree ${fw(repo)}\nHEAD m0\nbranch refs/heads/main`];
      for (const [wt, head] of listed) blocks.push(`worktree ${fw(wt)}\nHEAD ${head}\nbranch refs/heads/x`);
      for (const wt of prunable) blocks.push(`worktree ${fw(wt)}\nHEAD zz\ndetached\nprunable gitdir file points to non-existent location`);
      return { ok: true, out: `${blocks.join('\n\n')}\n\n` };
    }
    if (a === 'symbolic-ref') return { ok: false, out: '' };
    if (a === 'rev-parse') return { ok: args[3] === 'refs/heads/main', out: '' };
    if (a === 'merge-base') return { ok: ancestors.includes(args[2]), out: '' };
    if (a === 'status') return { ok: true, out: dirty.some((d) => cwd === d) ? ' M file\n' : '' };
    return { ok: false, out: '' };
  };
  return { git, calls };
}

test('orphan-worktree: rules (a), (b), (c); submodules and .claude/worktrees are never flagged', async (t) => {
  const f = await setup();
  t.after(f.done);
  const repo = f.p('repo');
  const gw = (n) => path.join(repo, '.git', 'worktrees', n);
  const pointer = (dir, gitdir) => f.put(path.join(dir, '.git'), 0).then((fp) => fs.writeFile(fp, `gitdir: ${gitdir.replace(/\\/g, '/')}\n`));
  await fs.mkdir(path.join(repo, '.git', 'worktrees'), { recursive: true });
  for (const n of ['merged', 'dirtyone', 'ahead', 'notlisted', 'live']) await fs.mkdir(gw(n), { recursive: true });
  await f.put('repo/README', 5);

  await pointer('wt/gone', gw('missing')); // (a) gitdir missing
  await f.put('wt/gone/file', 5);
  await pointer('wt/notlisted', gw('notlisted')); // (a) parent does not list it
  await pointer('wt/merged', gw('merged')); // (b)
  await pointer('wt/dirtyone', gw('dirtyone')); // merged but dirty
  await pointer('wt/ahead', gw('ahead')); // not an ancestor
  await pointer('repo/.claude/worktrees/live', gw('live')); // live Claude session
  await pointer('sub', path.join('..', 'repo', '.git', 'modules', 'sub')); // submodule pointer
  await fs.mkdir(path.join(repo, '.git', 'modules', 'sub'), { recursive: true });

  const { git, calls } = fakeGit(repo, {
    listed: [[f.p('wt', 'merged'), 'h-merged'], [f.p('wt', 'dirtyone'), 'h-dirty'], [f.p('wt', 'ahead'), 'h-ahead'], [f.p('repo', '.claude', 'worktrees', 'live'), 'h-live']],
    ancestors: ['h-merged', 'h-dirty', 'h-live'],
    dirty: [f.p('wt', 'dirtyone')],
    prunable: [f.p('wt', 'vanished')],
  });
  const out = await D.detectOrphanWorktree(await f.env({ git }));
  out.forEach(assertShape);
  const by = (p) => out.find((j) => j.path === p);

  assert.equal(by(f.p('wt', 'gone')).action, 'recycle');
  assert.equal(by(f.p('wt', 'notlisted')).action, 'recycle');
  const merged = by(f.p('wt', 'merged'));
  assert.equal(merged.action, 'command');
  assert.match(merged.how, /git worktree remove/);
  assert.equal(by(f.p('wt', 'dirtyone')), undefined);
  assert.equal(by(f.p('wt', 'ahead')), undefined);
  assert.equal(by(f.p('repo', '.claude', 'worktrees', 'live')), undefined);
  assert.equal(by(f.p('sub')), undefined);
  const pr = out.find((j) => /worktree prune/.test(j.how));
  assert.equal(pr.path, repo);
  assert.equal(pr.how, `git -C "${repo}" worktree prune`);
  assert.equal(pr.action, 'command');
  assert.equal(out.length, 4);
  // git status is run inside the worktree, remove/ancestor checks in the parent
  assert.ok(calls.some(([c, cwd]) => c === 'status --porcelain' && cwd === f.p('wt', 'merged')));
});

test('orphan-worktree: git failures flag nothing for listed-state rules', async (t) => {
  const f = await setup();
  t.after(f.done);
  const gd = path.join(f.p('repo'), '.git', 'worktrees', 'a');
  await fs.mkdir(gd, { recursive: true });
  const fp = await f.put('wt/a/.git', 0);
  await fs.writeFile(fp, `gitdir: ${gd}\n`);
  assert.deepEqual(await D.detectOrphanWorktree(await f.env()), []); // default fake git always fails
});

test('plugin-cache: versions not referenced by installed_plugins.json', async (t) => {
  const f = await setup();
  t.after(f.done);
  const c = path.join('home', '.claude', 'plugins', 'cache');
  await f.put(path.join(c, 'mk', 'p', '2.0', 'a'), 10);
  await f.put(path.join(c, 'mk', 'p', '1.0', 'a'), 10);
  await f.put(path.join(c, 'mk', 'q', '1.0', 'a'), 10);
  const json = { version: 2, plugins: { 'p@mk': [{ scope: 'user', installPath: f.p(c, 'mk', 'p', '2.0'), version: '2.0' }] } };
  await f.put(path.join('home', '.claude', 'plugins', 'installed_plugins.json'), 1);
  await fs.writeFile(f.p('home', '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify(json));
  const out = await D.detectPluginCache(await f.env());
  out.forEach(assertShape);
  assert.deepEqual(out.map((j) => j.path).sort(), [f.p(c, 'mk', 'p', '1.0'), f.p(c, 'mk', 'q', '1.0')]);
  assert.equal(out[0].action, 'recycle');

  await fs.writeFile(f.p('home', '.claude', 'plugins', 'installed_plugins.json'), '{broken');
  assert.deepEqual(await D.detectPluginCache(await f.env()), []);
});

test('appdata-orphan: old big folders with no matching installed app', async (t) => {
  const f = await setup();
  t.after(f.done);
  const r = path.join('home', 'AppData', 'Roaming');
  await f.put(path.join(r, 'GhostApp', 'data'), 100, 400); // orphan
  await f.put(path.join(r, 'Installed Thing', 'data'), 100, 400); // matches DisplayName
  await f.put(path.join(r, 'vendorx', 'data'), 100, 400); // matches Publisher
  await f.put(path.join(r, 'Fresh', 'data'), 100, 1); // recently used
  await f.put(path.join(r, 'Small', 'data'), 1, 400); // under the size threshold
  await f.put(path.join(r, 'Microsoft', 'data'), 100, 400); // system folder
  const apps = [{ name: 'Installed Thing 2.0', publisher: 'Acme', location: '' }, { name: 'Other', publisher: 'VendorX Inc.', location: '' }];
  const env = await f.env({ listInstalledApps: async () => apps });
  const out = await D.detectAppdataOrphan(env, { minBytes: 50 });
  out.forEach(assertShape);
  assert.deepEqual(out.map((j) => j.path), [f.p(r, 'GhostApp')]);
  assert.equal(out[0].score, 0.4);
  // empty registry result means "unknown": flag nothing
  assert.deepEqual(await D.detectAppdataOrphan(await f.env(), { minBytes: 50 }), []);
});

test('parseRegUninstall reads DisplayName/Publisher/InstallLocation per key', () => {
  const text = [
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\X\\Uninstall\\A',
    '    DisplayName    REG_SZ    카카오톡',
    '    Publisher    REG_SZ    Kakao Corp.',
    '    InstallLocation    REG_SZ    C:\\Kakao',
    '',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\X\\Uninstall\\B',
    '    Foo    REG_SZ    nope',
  ].join('\r\n');
  assert.deepEqual(D.parseRegUninstall(text), [{ name: '카카오톡', publisher: 'Kakao Corp.', location: 'C:\\Kakao' }]);
});

test('recycle-bin: report only', async (t) => {
  const f = await setup();
  t.after(f.done);
  await f.put(path.join('$Recycle.Bin', 'S-1-5', '$R1.bin'), 500, 5);
  const out = await D.detectRecycleBin(await f.env());
  out.forEach(assertShape);
  assert.equal(out.length, 1);
  assert.equal(out[0].action, 'report');
  assert.equal(out[0].size, 500);
});

test('crash-dump: dump folders plus stray .dmp files, no double counting', async (t) => {
  const f = await setup();
  t.after(f.done);
  const la = path.join('home', 'AppData', 'Local');
  await f.put(path.join(la, 'CrashDumps', 'a.dmp'), 100);
  await f.put(path.join(la, 'SomeApp', 'b.DMP'), 40);
  await f.put(path.join(la, 'SomeApp', 'keep.txt'), 40);
  await f.put(path.join('win', 'Minidump', 'c.dmp'), 60);
  const out = await D.detectCrashDump(await f.env());
  out.forEach(assertShape);
  assert.deepEqual(out.map((j) => path.basename(j.path)).sort(), ['CrashDumps', 'Minidump', 'b.DMP']);
  assert.equal(out.find((j) => j.path.endsWith('b.DMP')).size, 40);
});

test('vm-disk: vhdx files, report only', async (t) => {
  const f = await setup();
  t.after(f.done);
  await f.put(path.join('home', 'AppData', 'Local', 'Docker', 'wsl', 'data', 'ext4.vhdx'), 300);
  await f.put(path.join('home', 'notes.txt'), 3);
  const out = await D.detectVmDisk(await f.env());
  out.forEach(assertShape);
  assert.equal(out.length, 1);
  assert.equal(out[0].action, 'report');
  assert.equal(out[0].score, 0.2);
});

test('browser-cache: chromium profiles and firefox cache2', async (t) => {
  const f = await setup();
  t.after(f.done);
  const la = path.join('home', 'AppData', 'Local');
  await f.put(path.join(la, 'Google', 'Chrome', 'User Data', 'Default', 'Cache', 'Cache_Data', 'x'), 10);
  await f.put(path.join(la, 'Google', 'Chrome', 'User Data', 'Default', 'Code Cache', 'x'), 10);
  await f.put(path.join(la, 'Google', 'Chrome', 'User Data', 'Default', 'Cookies', 'x'), 10); // must not match
  await f.put(path.join(la, 'Microsoft', 'Edge', 'User Data', 'Profile 1', 'GPUCache', 'x'), 10);
  await f.put(path.join(la, 'Mozilla', 'Firefox', 'Profiles', 'abc.default', 'cache2', 'x'), 10);
  const out = await D.detectBrowserCache(await f.env());
  out.forEach(assertShape);
  assert.deepEqual(out.map((j) => path.basename(j.path)).sort(), ['Cache', 'Code Cache', 'GPUCache', 'cache2']);
  assert.ok(out.every((j) => j.action === 'recycle' && j.score === 0.8));
});

test('detectAll returns unique ids across all detectors', async (t) => {
  const f = await setup();
  t.after(f.done);
  await f.put(path.join('home', 'AppData', 'Local', 'npm-cache', 'a'), 10);
  await f.put(path.join('tmp', 'old'), 10, 3);
  const out = await D.detectAll(await f.env({ probe: installedProbe(f) }));
  assert.deepEqual(out.map((j) => j.category).sort(), ['pkg-cache', 'temp']);
  assert.equal(new Set(out.map((j) => j.id)).size, out.length);
});

test('pkg-cache resolves relocated caches through the injected probe', async (t) => {
  const f = await setup();
  t.after(f.done);
  await f.put(path.join('Caches', 'npm', 'a'), 10);
  const probe = async (argv) => (argv[0] === 'npm' ? { code: 0, stdout: `${f.p('Caches', 'npm')}
` } : { code: 1, stdout: '' });
  const out = await D.detectPkgCache(await f.env({ probe }));
  assert.deepEqual(out.map((j) => [j.tool, j.path]), [['npm', f.p('Caches', 'npm')]]);
});

test('detectAll: junk inside protected folders becomes report-only with a lower score', async (t) => {
  const f = await setup();
  t.after(f.done);
  await f.put(path.join('home', 'OneDrive', 'Desktop', 'proj', 'package.json'), 5, 300);
  await f.put(path.join('home', 'OneDrive', 'Desktop', 'proj', 'node_modules', 'a'), 50, 300);
  await f.put(path.join('home', 'AppData', 'Local', 'npm-cache', 'a'), 10);
  await f.put(path.join('tmp', 'old'), 10, 3);
  const env = await f.env({ probe: installedProbe(f) });
  env.idx.artifacts.forEach((a) => { a.node.s = 2 * 1024 * 1024; }); // clear the 1 MB floor without big fixtures
  const out = await D.detectAll(env);
  const da = out.find((j) => j.category === 'dev-artifact');
  assert.equal(da.action, 'report');
  assert.ok(da.score <= 0.3);
  assert.match(da.reason, /보호 폴더 안이라 자동 정리 대상이 아닙니다/);
  const by = (c) => out.find((j) => j.category === c);
  assert.equal(by('pkg-cache').action, 'command');
  assert.equal(by('temp').action, 'recycle'); // temp dir itself is exempt
});

test('nothing under <tmp>\claude is flagged as worktree or dev artifact', async (t) => {
  const f = await setup();
  t.after(f.done);
  const gone = f.p('tmp', 'claude', 's1', 'wt');
  const fp = await f.put(path.join('tmp', 'claude', 's1', 'wt', '.git'), 0);
  await fs.writeFile(fp, `gitdir: ${f.p('tmp', 'claude', 's1', 'repo', '.git', 'worktrees', 'x')}\n`);
  await f.put(path.join('tmp', 'claude', 's1', 'proj', 'package.json'), 5, 300);
  await f.put(path.join('tmp', 'claude', 's1', 'proj', 'node_modules', 'a'), 50, 300);
  const env = await f.env();
  assert.deepEqual(await D.detectOrphanWorktree(env), []);
  assert.deepEqual(await D.detectDevArtifact(env, { minBytes: 1 }), []);
  assert.ok(env.sizeOf(gone)); // it is in the walk, so only the protection explains the empty result
});

test('shader-cache: gpu cache dirs, size excludes <tmp>\claude when it sits inside', async (t) => {
  const f = await setup();
  t.after(f.done);
  const la = path.join('home', 'AppData', 'Local');
  await f.put(path.join(la, 'D3DSCache', 'a'), 100);
  await f.put(path.join(la, 'NVIDIA', 'DXCache', 'a'), 40);
  await f.put(path.join(la, 'NVIDIA', 'GLCache', 'a'), 30);
  await f.put(path.join(la, 'AMD', 'DxCache', 'a'), 20);
  const out = await D.detectShaderCache(await f.env());
  out.forEach(assertShape);
  assert.equal(out.length, 4);
  assert.ok(out.every((j) => j.category === 'shader-cache' && j.safety === 'safe' && j.action === 'recycle' && j.score === 0.85));

  await f.put(path.join(la, 'D3DSCache', 'claude', 'live'), 500); // pretend tmp lives here
  const two = await D.detectShaderCache(await f.env({ tmp: f.p(la, 'D3DSCache') }));
  assert.equal(two.find((j) => j.label.startsWith('DirectX')).size, 100);
});

test('app-cache: electron caches, INetCache and WER; other app data is left alone', async (t) => {
  const f = await setup();
  t.after(f.done);
  const r = path.join('home', 'AppData', 'Roaming');
  await f.put(path.join(r, 'Discord', 'Cache', 'a'), 100);
  await f.put(path.join(r, 'Discord', 'Local Storage', 'a'), 100); // logins live here: must not match
  await f.put(path.join(r, 'Code', 'CachedData', 'a'), 50);
  await f.put(path.join(r, 'Microsoft', 'Teams', 'GPUCache', 'a'), 30);
  await f.put(path.join(r, 'Unknown', 'Cache', 'a'), 30); // not in the known list
  await f.put(path.join('home', 'AppData', 'Local', 'Microsoft', 'Windows', 'INetCache', 'a'), 20);
  await f.put(path.join('home', 'AppData', 'Local', 'Microsoft', 'Windows', 'WER', 'a'), 10);
  const out = await D.detectAppCache(await f.env());
  out.forEach(assertShape);
  assert.deepEqual(out.map((j) => j.path.slice(f.T.length + 1)).sort(), [
    path.join(r, 'Code', 'CachedData'), path.join(r, 'Discord', 'Cache'), path.join(r, 'Microsoft', 'Teams', 'GPUCache'),
    path.join('home', 'AppData', 'Local', 'Microsoft', 'Windows', 'INetCache'), path.join('home', 'AppData', 'Local', 'Microsoft', 'Windows', 'WER'),
  ].sort());
  assert.ok(out.every((j) => j.safety === 'safe'));
});

test('system-cleanup: report only, unreadable or missing dirs are skipped', async (t) => {
  const f = await setup();
  t.after(f.done);
  await f.put(path.join('win', 'SoftwareDistribution', 'Download', 'a'), 100);
  await f.put(path.join('win', 'Logs', 'CBS', 'a'), 10);
  const out = await D.detectSystemCleanup(await f.env());
  out.forEach(assertShape);
  assert.equal(out.length, 2); // DeliveryOptimization is absent: silently skipped
  assert.ok(out.every((j) => j.action === 'report' && j.safety === 'manual' && j.score === 0.5));
  assert.match(out[0].how, /cleanmgr/);
});

test('old-download: big old files in ~/Downloads only, one junk per file', async (t) => {
  const f = await setup();
  t.after(f.done);
  await f.put(path.join('home', 'Downloads', 'setup.exe'), 2000, 200); // old and big
  await f.put(path.join('home', 'Downloads', 'movie.mkv'), 3000, 200);
  await f.put(path.join('home', 'Downloads', 'recent.zip'), 2000, 5); // too new
  await f.put(path.join('home', 'Downloads', 'small.iso'), 10, 200); // too small
  await f.put(path.join('home', 'Documents', 'big.zip'), 2000, 200); // not Downloads
  const out = await D.detectOldDownload(await f.env(), { minBytes: 1000 });
  out.forEach(assertShape);
  assert.deepEqual(out.map((j) => path.basename(j.path)).sort(), ['movie.mkv', 'setup.exe']);
  assert.equal(out.find((j) => j.path.endsWith('setup.exe')).label, '오래된 설치 파일/압축 파일');
  assert.ok(out.every((j) => j.action === 'report' && j.safety === 'manual' && j.score === 0.3));
});

test('safety tiers: defaults per category, protected-folder junk becomes manual', async (t) => {
  const f = await setup();
  t.after(f.done);
  await f.put(path.join('home', 'AppData', 'Local', 'D3DSCache', 'a'), 10);
  await f.put(path.join('home', 'OneDrive', 'p', 'package.json'), 5, 300);
  await f.put(path.join('home', 'OneDrive', 'p', 'node_modules', 'a'), 50, 300);
  const env = await f.env({ probe: installedProbe(f) });
  env.idx.artifacts.forEach((a) => { a.node.s = 2 * 1024 * 1024; });
  const out = await D.detectAll(env);
  assert.equal(out.find((j) => j.category === 'shader-cache').safety, 'safe');
  const da = out.find((j) => j.category === 'dev-artifact');
  assert.equal(da.safety, 'manual');
  assert.equal(da.action, 'report');
  const direct = await D.detectDevArtifact(env);
  assert.equal(direct[0].safety, 'check');
});

test('matchesInstalledApp is exported and fuzzy-matches name, publisher and install folder', () => {
  const apps = [{ name: 'Some Tool 2.0', publisher: 'Acme Corp', location: 'C:\Apps\ToolDir' }];
  assert.equal(D.matchesInstalledApp('SomeTool', apps), true);
  assert.equal(D.matchesInstalledApp('acme', apps), true);
  assert.equal(D.matchesInstalledApp('tooldir', apps), true);
  assert.equal(D.matchesInstalledApp('Ghost', apps), false);
  assert.equal(D.matchesInstalledApp('ab', apps), true); // too short to judge
});
