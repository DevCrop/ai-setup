import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CoreError } from '../core/errors.js';
import { Fix, FixState, TRANSITIONS } from '../core/fix.js';

const PID = 'a'.repeat(64);

// A scripted Fix: each do* can succeed, throw, or wait for release().
class ScriptFix extends Fix {
  constructor(opts = {}) { super('C1:test'); this.opts = opts; this.calls = []; }
  get restorable() { return this.opts.restorable ?? true; }
  hold(name) { return new Promise((res) => { this.release = res; this.held = name; }); }
  async doPreview() {
    this.calls.push('preview');
    if (this.opts.previewThrows) throw new Error('raw /secret/path');
    return { diff: 'd', previewId: this.opts.previewId ?? PID };
  }
  async doApply() {
    this.calls.push('apply');
    if (this.opts.hold === 'apply') await this.hold('apply');
    if (this.opts.applyThrows) throw new Error('raw');
    return { backupPath: '/b/x' };
  }
  async checkRestore() { if (this.opts.conflict) throw new CoreError('RESTORE_CONFLICT'); }
  async doRestore() {
    this.calls.push('restore');
    if (this.opts.hold === 'restore') await this.hold('restore');
    if (this.opts.restoreThrows) throw new Error('raw');
  }
}

const code = async (p) => { try { await p; return null; } catch (e) { assert.ok(e instanceof CoreError, 'only CoreError leaves a Fix'); return e.code; } };

// Builds a fix in each state through public calls only.
const BUILD = {
  proposed: async () => new ScriptFix(),
  previewed: async () => { const f = new ScriptFix(); await f.preview(); return f; },
  previewFailed: async () => { const f = new ScriptFix({ previewThrows: true }); await code(f.preview()); f.opts.previewThrows = false; return f; },
  applying: async () => { const f = new ScriptFix({ hold: 'apply' }); await f.preview(); f.pending = f.apply(PID); await new Promise((r) => setImmediate(r)); return f; },
  applied: async () => { const f = new ScriptFix(); await f.preview(); await f.apply(PID); return f; },
  applyFailed: async () => { const f = new ScriptFix({ applyThrows: true }); await f.preview(); await code(f.apply(PID)); return f; },
  restoring: async () => { const f = new ScriptFix({ hold: 'restore' }); await f.preview(); await f.apply(PID); f.pending = f.restore(); await new Promise((r) => setImmediate(r)); return f; },
  restored: async () => { const f = new ScriptFix(); await f.preview(); await f.apply(PID); await f.restore(); return f; },
  restoreFailed: async () => { const f = new ScriptFix({ restoreThrows: true }); await f.preview(); await f.apply(PID); await code(f.restore()); f.opts.restoreThrows = false; return f; },
};

// Allowed user actions per state, written from the stateDiagram-v2 of docs/arch-claude-monitor.md section 2 (not from TRANSITIONS).
const ALLOWED = {
  proposed: ['preview'], previewFailed: ['preview'], applyFailed: ['preview'],
  previewed: ['preview', 'apply'], applied: ['restore'], restoreFailed: ['restore'],
  applying: [], restoring: [], restored: [],
};

const ACTION = { preview: (f) => f.preview(), apply: (f) => f.apply(PID), restore: (f) => f.restore() };

test('every state is reachable through public calls', async () => {
  for (const [state, build] of Object.entries(BUILD)) assert.equal((await build()).state, state);
});

for (const state of Object.keys(BUILD)) {
  for (const action of ['preview', 'apply', 'restore']) {
    const ok = ALLOWED[state].includes(action);
    test(`${state} + ${action}: ${ok ? 'allowed' : 'INVALID_STATE'}`, async () => {
      const f = await BUILD[state]();
      const c = await code(ACTION[action](f));
      if (ok) assert.equal(c, null); else assert.equal(c, 'INVALID_STATE');
      if (f.release) { f.release(); await f.pending; }
    });
  }
}

test('result states of the diagram', async () => {
  const f = await BUILD.proposed();
  assert.equal((await f.preview()).previewId, PID);
  assert.equal(f.state, FixState.previewed);
  assert.deepEqual(await f.apply(PID), { backupPath: '/b/x' });
  assert.equal(f.state, FixState.applied);
  assert.equal(f.backupPath, '/b/x');
  assert.deepEqual(await f.restore(), { restored: true });
  assert.equal(f.state, FixState.restored);
  f.rescan();
  assert.equal(f.state, FixState.proposed); // restored -> proposed when the next scan finds it again
});

test('failures: previewFailed, applyFailed, restoreFailed carry fixed codes and no raw message', async () => {
  const p = new ScriptFix({ previewThrows: true });
  const e1 = await p.preview().catch((e) => e);
  assert.equal(e1.code, 'PREVIEW_FAILED');
  assert.ok(!e1.message.includes('/secret/path'));
  assert.equal(p.state, 'previewFailed');
  const a = await BUILD.applyFailed();
  assert.equal(a.state, 'applyFailed');
  await a.preview();
  assert.equal(a.state, 'previewed'); // applyFailed -> previewed
  const r = await BUILD.restoreFailed();
  assert.equal(r.state, 'restoreFailed');
});

test('previewFailed -> previewed and restoreFailed -> applied -> restoring -> restored work again', async () => {
  const f = new ScriptFix({ previewThrows: true });
  await code(f.preview());
  f.opts.previewThrows = false;
  await f.preview();
  assert.equal(f.state, 'previewed');
  await f.apply(PID);
  f.opts.restoreThrows = true;
  assert.equal(await code(f.restore()), 'RESTORE_FAILED');
  assert.equal(f.state, 'restoreFailed');
  f.opts.restoreThrows = false;
  await f.restore();
  assert.equal(f.state, 'restored');
});

test('apply with a wrong previewId: PREVIEW_STALE, back to proposed, nothing applied', async () => {
  const f = await BUILD.previewed();
  assert.equal(await code(f.apply('b'.repeat(64))), 'PREVIEW_STALE');
  assert.equal(f.state, 'proposed');
  assert.ok(!f.calls.includes('apply'));
});

test('apply when the target changed since the preview: PREVIEW_STALE, back to proposed, nothing applied', async () => {
  const f = await BUILD.previewed();
  f.opts.previewId = 'c'.repeat(64); // the recomputed id differs
  assert.equal(await code(f.apply(PID)), 'PREVIEW_STALE');
  assert.equal(f.state, 'proposed');
  assert.ok(!f.calls.includes('apply'));
});

test('restore after the file changed: RESTORE_CONFLICT and the state stays applied', async () => {
  const f = await BUILD.applied();
  f.opts.conflict = true;
  assert.equal(await code(f.restore()), 'RESTORE_CONFLICT');
  assert.equal(f.state, 'applied');
  assert.ok(!f.calls.includes('restore'));
});

test('a non-restorable fix answers NOT_RESTORABLE from any state', async () => {
  for (const build of [BUILD.proposed, BUILD.applied]) {
    const f = await build();
    f.opts.restorable = false;
    assert.equal(await code(f.restore()), 'NOT_RESTORABLE');
  }
});

test('the guard (FIX_BUSY) is asked before preview, apply and restore, and refuses without a state change', async () => {
  const f = await BUILD.proposed();
  f.guard = () => { throw new CoreError('FIX_BUSY'); };
  assert.equal(await code(f.preview()), 'FIX_BUSY');
  assert.equal(f.state, 'proposed');
});

test('the transition table has no edge into a state the diagram does not know and onChange fires per move', async () => {
  assert.ok(TRANSITIONS.every((t) => Object.hasOwn(FixState, t.from) && Object.hasOwn(FixState, t.to)));
  assert.equal(TRANSITIONS.length, 14); // the 14 arrows of the diagram (the [*] and final arrows are not moves)
  const f = new ScriptFix();
  const seen = [];
  f.onChange = (x) => seen.push(x.state);
  await f.preview();
  await f.apply(PID);
  assert.deepEqual(seen, ['previewed', 'applying', 'applied']);
});

test('M1: a previewed fix can be previewed again; the fresh id works and the old id is stale', async () => {
  const f = await BUILD.previewed();
  f.opts.previewId = 'd'.repeat(64);
  const again = await f.preview();
  assert.equal(again.previewId, 'd'.repeat(64));
  assert.equal(f.state, 'previewed');
  assert.equal(await code(f.apply(PID)), 'PREVIEW_STALE');
  assert.equal(f.state, 'proposed');
  const g = await BUILD.previewed();
  g.opts.previewId = 'd'.repeat(64);
  await g.preview();
  await g.apply('d'.repeat(64));
  assert.equal(g.state, 'applied');
});

test('M1: a failing second preview keeps the state previewed and kills the old id', async () => {
  const f = await BUILD.previewed();
  f.opts.previewThrows = true;
  assert.equal(await code(f.preview()), 'PREVIEW_FAILED');
  assert.equal(f.state, 'previewed');
  f.opts.previewThrows = false;
  assert.equal(await code(f.apply(PID)), 'PREVIEW_STALE');
});
