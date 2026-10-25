import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ApplyRepoFix, execRunner } from '../core/fixes/apply-repo-fix.js';
import { RemoveCodexProjectFix } from '../core/fixes/remove-codex-project-fix.js';
import { RemoveCodexTableFix } from '../core/fixes/remove-codex-table-fix.js';
import { CANARY, fakeCodex, tmpDir, write } from './helpers.mjs';

const clock = () => new Date(2026, 9, 25, 10, 30, 0);
const code = async (p) => { try { await p; return null; } catch (e) { return e.code ?? `raw:${e.message}`; } };
const x1 = (c) => new RemoveCodexProjectFix({ id: 'X1:abcdef012345', codexHome: c.home, projectPath: c.gone, clock });
const tree = (dir) => fs.readdirSync(dir, { recursive: true }).sort().map((r) => `${r}:${fs.statSync(path.join(dir, r)).isFile() ? createHash('sha1').update(fs.readFileSync(path.join(dir, r))).digest('hex') : 'dir'}`);

test('X1: preview, apply writes the backup first, restore returns the original bytes', async () => {
  const c = fakeCodex();
  const original = fs.readFileSync(c.config);
  const fix = x1(c);
  const { diff, previewId } = await fix.preview();
  assert.equal(diff, [`-[projects.'${c.gone}']`, '-trust_level = "trusted"', '-api_key = ***'].join('\n'));
  assert.ok(!diff.includes(CANARY.projectKey));
  assert.equal(previewId, createHash('sha256').update(original).digest('hex'));
  assert.deepEqual(fs.readFileSync(c.config), original); // preview writes nothing

  const r = await fix.apply(previewId);
  assert.equal(path.dirname(r.backupPath), path.join(c.home, 'backups', 'claude-monitor'));
  assert.equal(path.basename(r.backupPath), '20261025-103000-config.toml');
  assert.deepEqual(fs.readFileSync(r.backupPath), original);
  const after = fs.readFileSync(c.config, 'utf8');
  assert.ok(!after.includes(`[projects.'${c.gone}']`));
  assert.ok(after.includes(`[projects.'${c.live}']`));
  assert.ok(after.includes('[plugins."a@b"]'));
  assert.deepEqual(fs.readdirSync(c.home).filter((n) => n.endsWith('.tmp')), []); // atomic write left no temp file

  assert.deepEqual(await fix.restore(), { restored: true });
  assert.deepEqual(fs.readFileSync(c.config), original);
  assert.equal(fix.state, 'restored');
});

test('X1: the removed text is the original minus exactly the table lines (diff of the two files)', async () => {
  const c = fakeCodex();
  const before = fs.readFileSync(c.config, 'utf8').split('\n');
  const fix = x1(c);
  const { previewId } = await fix.preview();
  await fix.apply(previewId);
  const after = fs.readFileSync(c.config, 'utf8').split('\n');
  const i = before.indexOf(`[projects.'${c.gone}']`);
  assert.deepEqual(before.slice(i, i + 3), [`[projects.'${c.gone}']`, 'trust_level = "trusted"', `api_key = "${CANARY.projectKey}"`]);
  assert.deepEqual(after, [...before.slice(0, i), ...before.slice(i + 3)]);
  assert.equal(before.length - after.length, 3);
});

test('X1: CRLF line endings are kept', async () => {
  const c = fakeCodex({ eol: '\r\n' });
  const fix = x1(c);
  const { previewId } = await fix.preview();
  await fix.apply(previewId);
  const after = fs.readFileSync(c.config, 'utf8');
  assert.ok(after.includes('\r\n'));
  assert.ok(!/[^\r]\n/.test(after));
});

test('X1: PREVIEW_STALE when config.toml is edited between preview and apply; nothing written, no backup', async () => {
  const c = fakeCodex();
  const fix = x1(c);
  const { previewId } = await fix.preview();
  fs.appendFileSync(c.config, '\n# edited by codex\n');
  const edited = fs.readFileSync(c.config);
  assert.equal(await code(fix.apply(previewId)), 'PREVIEW_STALE');
  assert.equal(fix.state, 'proposed');
  assert.deepEqual(fs.readFileSync(c.config), edited);
  assert.ok(!fs.existsSync(path.join(c.home, 'backups')));
});

test('X1: RESTORE_CONFLICT when config.toml is edited between apply and restore; nothing written', async () => {
  const c = fakeCodex();
  const fix = x1(c);
  const { previewId } = await fix.preview();
  await fix.apply(previewId);
  fs.appendFileSync(c.config, '\n# codex wrote this\n');
  const edited = fs.readFileSync(c.config);
  assert.equal(await code(fix.restore()), 'RESTORE_CONFLICT');
  assert.equal(fix.state, 'applied');
  assert.deepEqual(fs.readFileSync(c.config), edited);
});

test('X1: two applies in the same second get two different backup files', async () => {
  const a = fakeCodex();
  const f1 = x1(a);
  const p1 = (await f1.preview()).previewId;
  const b1 = (await f1.apply(p1)).backupPath;
  fs.copyFileSync(b1, a.config); // put the table back
  const f2 = x1(a);
  const p2 = (await f2.preview()).previewId;
  const b2 = (await f2.apply(p2)).backupPath;
  assert.notEqual(b1, b2);
});

test('X1: preview of a table that is not there fails with PREVIEW_FAILED', async () => {
  const c = fakeCodex();
  const fix = new RemoveCodexProjectFix({ id: 'X1:abcdef012345', codexHome: c.home, projectPath: '/not/there', clock });
  assert.equal(await code(fix.preview()), 'PREVIEW_FAILED');
  assert.equal(fix.state, 'previewFailed');
});

test('X1 never touches auth.json, secrets/ or .sandbox-secrets/ (tree outside config.toml and backups is unchanged)', async () => {
  const c = fakeCodex();
  const keep = (d) => tree(d).filter((l) => !l.startsWith('config.toml:') && !l.startsWith('backups'));
  const before = keep(c.home);
  const fix = x1(c);
  const { previewId } = await fix.preview();
  await fix.apply(previewId);
  await fix.restore();
  assert.deepEqual(keep(c.home), before);
});

// C1 ---------------------------------------------------------------------------------------

const fakeRunner = (script = {}) => {
  const calls = [];
  const fn = async (file, args, opts) => { calls.push({ file, args, cwd: opts?.cwd }); return script[args.join(' ')] ?? { code: 0, stdout: `plan ${args.length}\n`, stderr: '' }; };
  fn.calls = calls;
  return fn;
};

test('C1: runs only bash scripts/apply.sh (dry run, dry run again, real), always in the repo, and the Claude home stays unchanged', async () => {
  const home = tmpDir();
  write(path.join(home, 'agents', 'a.md'), 'live');
  write(path.join(home, 'settings.json'), '{}');
  const before = tree(home);
  const runner = fakeRunner({ 'scripts/apply.sh --dry-run': { code: 0, stdout: 'would copy a.md\n', stderr: '' } });
  const fix = new ApplyRepoFix({ id: 'C1:drift', repo: '/the/repo', runner });
  const { diff, previewId } = await fix.preview();
  assert.equal(diff, 'would copy a.md\n');
  assert.equal(previewId, createHash('sha256').update('would copy a.md\n').digest('hex'));
  const r = await fix.apply(previewId);
  assert.deepEqual(r, {});
  assert.deepEqual(runner.calls.map((c) => [c.file, ...c.args]), [
    ['bash', 'scripts/apply.sh', '--dry-run'], ['bash', 'scripts/apply.sh', '--dry-run'], ['bash', 'scripts/apply.sh'],
  ]);
  assert.ok(runner.calls.every((c) => c.cwd === '/the/repo'));
  assert.deepEqual(tree(home), before);
  assert.equal(fix.restorable, false);
  assert.equal(await code(fix.restore()), 'NOT_RESTORABLE');
  assert.equal(runner.calls.length, 3);
});

test('C1: PREVIEW_STALE when the dry run output changed; the real command is not run', async () => {
  let n = 0;
  const calls = [];
  const runner = async (file, args) => { calls.push(args.join(' ')); return { code: 0, stdout: `out ${args.includes('--dry-run') ? n++ : 'real'}`, stderr: '' }; };
  const fix = new ApplyRepoFix({ id: 'C1:drift', repo: '/r', runner });
  const { previewId } = await fix.preview();
  assert.equal(await code(fix.apply(previewId)), 'PREVIEW_STALE');
  assert.ok(!calls.includes('scripts/apply.sh'));
  assert.equal(fix.state, 'proposed');
});

test('C1: a non-zero exit is APPLY_FAILED with a detail tail of at most 400 chars, home replaced by ~, state applyFailed', async () => {
  const homeDir = path.join(tmpDir(), 'me');
  const msys = homeDir.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`);
  const runner = fakeRunner({ 'scripts/apply.sh': { code: 2, stdout: 'x'.repeat(600), stderr: `cannot write ${homeDir}\\a and ${msys}/b` } });
  const fix = new ApplyRepoFix({ id: 'C1:drift', repo: '/r', runner, homeDir });
  const { previewId } = await fix.preview();
  const e = await fix.apply(previewId).catch((x) => x);
  assert.equal(e.code, 'APPLY_FAILED');
  assert.ok(e.detail.length <= 400);
  assert.ok(!e.detail.includes(homeDir) && !e.detail.includes(msys));
  assert.match(e.detail, /~/);
  assert.equal(fix.state, 'applyFailed');
});

test('L6: the home path is masked before the last 400 chars are cut, so a path at the cut edge is not left half visible', async () => {
  const homeDir = path.join(tmpDir(), 'me');
  const runner = fakeRunner({ 'scripts/apply.sh': { code: 2, stdout: `${homeDir}/${'q'.repeat(396)}`, stderr: '' } });
  const fix = new ApplyRepoFix({ id: 'C1:drift', repo: '/r', runner, homeDir });
  const { previewId } = await fix.preview();
  const e = await fix.apply(previewId).catch((x) => x);
  assert.equal(e.code, 'APPLY_FAILED');
  assert.ok(e.detail.startsWith('~'));
  assert.ok(!e.detail.includes(homeDir.slice(-3)) || e.detail.includes('~'));
  assert.ok(e.detail.length <= 400);
});

test('C1: a failing dry run is PREVIEW_FAILED', async () => {
  const fix = new ApplyRepoFix({ id: 'C1:drift', repo: '/r', runner: fakeRunner({ 'scripts/apply.sh --dry-run': { code: 1, stdout: '', stderr: 'no' } }) });
  assert.equal(await code(fix.preview()), 'PREVIEW_FAILED');
});

test('execRunner: resolves {code, stdout, stderr} and never rejects', async () => {
  const ok = await execRunner(process.execPath, ['-e', 'console.log("hi")'], {});
  assert.deepEqual([ok.code, ok.stdout.trim()], [0, 'hi']);
  const bad = await execRunner(process.execPath, ['-e', 'process.exit(3)'], {});
  assert.equal(bad.code, 3);
  const none = await execRunner('cm-no-such-binary-xyz', [], {});
  assert.notEqual(none.code, 0);
});

// X4 ---------------------------------------------------------------------------------------

const x4 = (c, parts = ['hooks', 'state', `${c.goneHook}:post_tool_use:0:1`]) => new RemoveCodexTableFix({ id: 'X4:abcdef012345', codexHome: c.home, parts, clock });

test('X4: removes only the hook state table, backup first, restore returns the original bytes; the parent table and the other hook stay', async () => {
  const c = fakeCodex();
  const original = fs.readFileSync(c.config);
  const fix = x4(c);
  const { diff, previewId } = await fix.preview();
  assert.equal(diff, [`-[hooks.state.'${c.goneHook}:post_tool_use:0:1']`, '-enabled = false', '-trusted_hash = "sha256:bbb"'].join('\n'));
  assert.deepEqual(fs.readFileSync(c.config), original); // preview writes nothing
  const r = await fix.apply(previewId);
  assert.deepEqual(fs.readFileSync(r.backupPath), original);
  assert.equal(path.dirname(r.backupPath), path.join(c.home, 'backups', 'claude-monitor'));
  const after = fs.readFileSync(c.config, 'utf8');
  assert.ok(!after.includes('post_tool_use'));
  assert.ok(after.includes('[hooks.state]') && after.includes(`${c.liveHook}:pre_tool_use:0:0`) && after.includes('[agents]') && after.includes(`[projects.'${c.gone}']`));
  assert.deepEqual(await fix.restore(), { restored: true });
  assert.deepEqual(fs.readFileSync(c.config), original);
});

test('X4: PREVIEW_STALE, RESTORE_CONFLICT and a missing table behave like X1; bad parts are refused', async () => {
  const c = fakeCodex();
  const a = x4(c);
  const { previewId } = await a.preview();
  fs.appendFileSync(c.config, '\n# edited\n');
  assert.equal(await code(a.apply(previewId)), 'PREVIEW_STALE');
  const b = x4(c);
  await b.apply((await b.preview()).previewId);
  fs.appendFileSync(c.config, '\n# codex wrote\n');
  assert.equal(await code(b.restore()), 'RESTORE_CONFLICT');
  assert.equal(await code(x4(c, ['hooks', 'state', '/not/there:x:0:0']).preview()), 'PREVIEW_FAILED');
  assert.throws(() => x4(c, []), TypeError);
  assert.throws(() => x4(c, 'hooks'), TypeError);
});
