import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { walk, buildTree } from '../lib/walk.mjs';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'walk-test-'));
  const put = async (rel, size) => {
    const p = path.join(root, rel);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, Buffer.alloc(size, 1));
  };
  await put('a/one.bin', 1000);
  await put('a/deep/two.bin', 500);
  await put('b/three.bin', 100);
  await put('top.bin', 10);
  return { root, put, done: () => fs.rm(root, { recursive: true, force: true }) };
}

test('walk sums sizes and tracks the newest mtime', async (t) => {
  const f = await fixture();
  t.after(f.done);
  const old = new Date('2020-01-01T00:00:00Z');
  await fs.utimes(path.join(f.root, 'a', 'one.bin'), old, old);
  const r = await walk([f.root]);
  assert.equal(r.files, 4);
  assert.equal(r.bytes, 1610);
  assert.equal(r.rootNodes[0].s, 1610);
  assert.equal(r.sizeOf(path.join(f.root, 'a')).s, 1500);
  assert.equal(r.sizeOf(path.join(f.root, 'A', 'DEEP')).s, 500); // case-insensitive on Windows
  assert.equal(r.sizeOf(path.join(f.root, 'nope')), null);
  assert.equal(r.sizeOf(path.join(path.parse(f.root).root, 'zzz-not-walked')), null);
  assert.ok(r.sizeOf(path.join(f.root, 'a')).m > old.getTime());
});

test('walk skips junctions/symlinks and counts them, and counts unreadable roots', async (t) => {
  const f = await fixture();
  t.after(f.done);
  const link = path.join(f.root, 'link');
  try {
    await fs.symlink(path.join(f.root, 'a'), link, 'junction');
  } catch (e) {
    t.skip(`cannot create junction: ${e.code}`);
    return;
  }
  const r = await walk([f.root, path.join(f.root, 'missing')]);
  assert.equal(r.skipped.reparse, 1);
  assert.equal(r.skipped.unreadable, 1);
  assert.equal(r.rootNodes[0].s, 1610); // link target not counted twice
});

test('buildTree: depth limit, pruning into (기타 N개), junk kept at full depth', async (t) => {
  const f = await fixture();
  t.after(f.done);
  await f.put('d1/d2/d3/d4/d5/d6/deep.bin', 5000);
  for (let i = 0; i < 5; i++) await f.put(`many/f${i}/x.bin`, 1); // tiny siblings, below 0.1%
  await f.put('many/big/x.bin', 100000);
  const r = await walk([f.root]);

  const plain = buildTree(r.rootNodes, []);
  assert.equal(plain.n, 'PC');
  const root = plain.c[0];
  assert.equal(root.s, r.rootNodes[0].s);
  let node = root;
  for (const n of ['d1', 'd2', 'd3', 'd4', 'd5']) node = node.c.find((c) => c.n === n);
  assert.equal(node.c, undefined, 'depth 5 is the last level');

  const many = root.c.find((c) => c.n === 'many');
  assert.deepEqual(many.c.map((c) => c.n).slice(0, 1), ['big']);
  const rest = many.c.find((c) => c.p === null);
  assert.match(rest.n, /^\(기타 5개\)$/);
  assert.equal(rest.s, 5);
  assert.deepEqual(many.c.map((c) => c.s), [...many.c.map((c) => c.s)].sort((a, b) => b - a));

  const deepDir = path.join(f.root, 'd1', 'd2', 'd3', 'd4', 'd5', 'd6');
  const withJunk = buildTree(r.rootNodes, [{ path: deepDir }, { path: path.join(f.root, 'many', 'f3') }]);
  let n2 = withJunk.c[0];
  for (const n of ['d1', 'd2', 'd3', 'd4', 'd5', 'd6']) n2 = n2.c.find((c) => c.n === n);
  assert.deepEqual(n2.j, [0]);
  const f3 = withJunk.c[0].c.find((c) => c.n === 'many').c.find((c) => c.n === 'f3');
  assert.deepEqual(f3.j, [1], 'junk node survives pruning');
});

test('walk indexes projects, artifacts (not nested), git pointers, dmp and vhdx files', async (t) => {
  const f = await fixture();
  t.after(f.done);
  await f.put('proj/package.json', 5);
  await f.put('proj/node_modules/x/node_modules/y/i.js', 10);
  await f.put('proj/node_modules/x/i.js', 10);
  await f.put('proj/src/a.js', 5);
  await f.put('wt/.git', 5);
  await f.put('d/crash.DMP', 7);
  await f.put('d/disk.vhdx', 9);
  await fs.mkdir(path.join(f.root, 'repo', '.git'), { recursive: true });
  const r = await walk([f.root]);
  assert.deepEqual(r.idx.artifacts.map((a) => a.node.name), ['node_modules']);
  assert.equal(r.idx.artifacts[0].parent.proj, true);
  assert.deepEqual(r.idx.gitFiles, [path.join(f.root, 'wt')]);
  assert.deepEqual(r.idx.repos, [path.join(f.root, 'repo')]);
  assert.deepEqual(r.idx.files.map((x) => path.basename(x.path)).sort(), ['crash.DMP', 'disk.vhdx']);

  // ms ignores artifact subtrees: make the project old, then touch a file inside node_modules.
  const old = new Date('2020-01-01T00:00:00Z');
  for (const rel of ['proj/package.json', 'proj/src/a.js']) await fs.utimes(path.join(f.root, rel), old, old);
  const r2 = await walk([f.root]);
  const proj = r2.sizeOf(path.join(f.root, 'proj'));
  assert.equal(proj.ms, old.getTime());
  assert.ok(proj.m > proj.ms);
});

test('walk counts hard-linked files once', async (t) => {
  const f = await fixture();
  t.after(f.done);
  await f.put('store/blob.bin', 4000);
  try {
    await fs.link(path.join(f.root, 'store', 'blob.bin'), path.join(f.root, 'a', 'link.bin'));
  } catch (e) {
    t.skip(`cannot create hard link: ${e.code}`);
    return;
  }
  const r = await walk([f.root]);
  assert.equal(r.bytes, 1610 + 4000); // fixture 1610 + one copy of the blob
  assert.equal(r.rootNodes[0].s, 5610);
  assert.equal(r.files, 6);
});
