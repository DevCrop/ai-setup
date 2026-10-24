// Real detector output fed into the cleaner's verifyItem: what the scanner proposes, the cleaner must accept (or keep report-only).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { walk } from '../lib/walk.mjs';
import * as D from '../lib/detectors.mjs';
import { verifyItem, makeCtx } from '../clean.mjs';

const W = path.win32;
const DAY = 86400e3;
const opts = { skip: process.platform !== 'win32' && 'Windows-only' };

async function setup() {
  const T = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'integ-test-')));
  const p = (...a) => path.join(T, ...a);
  const put = async (rel, size = 10, ageDays = 0) => {
    const f = p(rel);
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, Buffer.alloc(size, 1));
    const d = new Date(Date.now() - ageDays * DAY);
    await fs.utimes(f, d, d);
    return f;
  };
  // age every file and directory under `rel` (a directory's own mtime is what the scanner and the cleaner both look at)
  const age = async (rel, days) => {
    const t = new Date(Date.now() - days * DAY);
    const rec = async (q) => { if ((await fs.lstat(q)).isDirectory()) for (const n of await fs.readdir(q)) await rec(path.join(q, n)); await fs.utimes(q, t, t); };
    await rec(p(rel));
  };
  const cwd = p('proj', 'sub');
  const env = async () => {
    const r = await walk([T], { bigBytes: 1000 });
    return {
      home: p('home'), tmp: p('tmp'), localAppData: p('home', 'AppData', 'Local'), appData: p('home', 'AppData', 'Roaming'),
      windir: p('win'), repo: p('repo'), drives: [T], idx: r.idx, sizeOf: r.sizeOf, cwd,
      git: async () => ({ ok: false, out: '' }), listInstalledApps: async () => [], probe: async () => ({ code: 1, stdout: '' }),
    };
  };
  return { T, p, put, age, cwd, env, done: () => fs.rm(T, { recursive: true, force: true }) };
}

const ctxFor = (env, cwd) => makeCtx({
  env, cwd, probe: env.probe, run: async () => ({ code: 0, stdout: '', stderr: '' }), recycle: async (l) => l.map(() => ({ ok: true })),
  listInstalledApps: async () => [], driveOk: async () => true, driveTotal: async () => 1e15,
});
const slug = (c) => c.replace(/[:\\/.]/g, '-');
const base = (c) => c.children.map((x) => W.basename(x.path)).sort();

test('detector output for the AI tool categories is accepted by verifyItem', opts, async () => {
  const f = await setup();
  try {
    // ai-old-version: CLI versions, plus an extension the editor still lists as installed
    await f.put('home/.local/share/claude/versions/2.1.50/a.bin'); await f.put('home/.local/share/claude/versions/2.1.52/a.bin');
    const ext = 'home/.vscode/extensions';
    for (const n of ['pub.a-1.0.0', 'pub.a-1.2.0', 'pub.c-0.9.0', 'pub.c-1.0.0']) await f.put(`${ext}/${n}/x.js`);
    await fs.writeFile(f.p(ext, 'extensions.json'), JSON.stringify([{ identifier: { id: 'pub.c' }, version: '0.9.0', relativeLocation: 'pub.c-0.9.0' }]));
    // ai-temp roots: old children qualify, fresh ones and the running session do not
    await f.put('home/.codex/.tmp/old/a.bin'); await f.age('home/.codex/.tmp/old', 3); await f.put('home/.codex/.tmp/new/a.bin');
    await f.put('home/.codex/cache/old/a.bin'); await f.age('home/.codex/cache/old', 3);
    await f.put('home/.claude/plugins/.trash/gone/a.bin');
    await f.put('tmp/claude/old-session/a.bin'); await f.age('tmp/claude/old-session', 20);
    await f.put('tmp/claude/mid-session/a.bin'); await f.age('tmp/claude/mid-session', 8);
    await f.put(`tmp/claude/${slug(f.cwd)}/a.bin`); await f.age(`tmp/claude/${slug(f.cwd)}`, 30);
    // report-only: editor state and AI history
    await f.put('home/AppData/Roaming/Code/User/workspaceStorage/hashold/state.vscdb'); await f.age('home/AppData/Roaming/Code/User/workspaceStorage/hashold', 120);
    await f.put('home/.codex/sessions/2026/rollout.jsonl'); await f.put('home/.claude/projects/p/a.jsonl');
    await f.put('home/.codex/.sandbox-recovery/r/a.bin'); await f.age('home/.codex/.sandbox-recovery', 30);

    const env = await f.env();
    const ctx = ctxFor(env, f.cwd);
    const verify = (j) => verifyItem({ id: j.id, category: j.category, path: j.path }, ctx);

    const oldV = await D.detectAiOldVersion(env);
    assert.deepEqual(oldV.map((j) => W.basename(j.path)).sort(), ['2.1.50', 'pub.a-1.0.0']); // pub.c-0.9.0 is in extensions.json
    for (const j of oldV) { const r = await verify(j); assert.ok(r.ok, `${j.path}: ${r.reason}`); assert.equal(r.entry.action, 'recycle'); }

    const temps = await D.detectAiTemp(env);
    assert.ok(!temps.some((j) => /sandbox-recovery/i.test(j.path)), 'sandbox-recovery is report-only now');
    assert.equal(temps.length, 4);
    const kids = {};
    for (const j of temps) {
      const r = await verify(j);
      assert.ok(r.ok, `${j.path}: ${r.reason}`);
      assert.equal(r.entry.action, 'recycle');
      assert.equal(r.entry.tier, j.safety, j.path); // the cleaner derives the same tier as the scanner
      kids[W.relative(f.T, j.path)] = base(r.entry);
    }
    assert.deepEqual(kids, {
      'home\\.codex\\.tmp': ['old'], 'home\\.codex\\cache': ['old'], 'home\\.claude\\plugins\\.trash': ['gone'], 'tmp\\claude': ['old-session'],
    });

    for (const [det, cat] of [[D.detectEditorState, 'editor-state'], [D.detectAiHistory, 'ai-history']]) {
      const js = await det(env);
      assert.ok(js.length > 0, cat);
      for (const j of js) {
        assert.equal(j.category, cat);
        const r = await verify(j);
        assert.ok(r.ok, `${j.path}: ${r.reason}`);
        assert.equal(r.entry.action, 'report', j.path);
      }
    }
    assert.ok((await D.detectAiHistory(env)).some((j) => /\.sandbox-recovery$/i.test(j.path)));
  } finally { await f.done(); }
});

test('detector output for temp is accepted by verifyItem and only qualifying children are kept', opts, async () => {
  const f = await setup();
  try {
    await f.put('tmp/oldchild/a.bin'); await f.age('tmp/oldchild', 3);
    await f.put('tmp/newchild/a.bin');
    await fs.mkdir(f.p('win', 'Temp'), { recursive: true });
    const env = await f.env();
    const ctx = ctxFor(env, f.cwd);
    const js = await D.detectTemp(env);
    assert.ok(js.length > 0);
    for (const j of js) {
      const r = await verifyItem({ id: j.id, category: j.category, path: j.path }, ctx);
      assert.ok(r.ok, `${j.path}: ${r.reason}`);
      assert.equal(r.entry.action, 'recycle');
      if (W.relative(f.T, j.path) === 'tmp') assert.deepEqual(base(r.entry), ['oldchild']);
    }
  } finally { await f.done(); }
});
