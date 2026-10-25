import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Check } from '../core/check.js';
import * as registry from '../core/checks/index.js';
import { CoreError } from '../core/errors.js';
import { Finding } from '../core/finding.js';
import { Fix } from '../core/fix.js';
import { Optimizer } from '../core/optimizer.js';
import { snap } from './helpers.mjs';

const PID = 'a'.repeat(64);

class MemFix extends Fix {
  constructor(id, { hold = false } = {}) { super(id); this.hold = hold; }
  get restorable() { return this.id.startsWith('X'); }
  async doPreview() { return { diff: `diff ${this.id}`, previewId: PID }; }
  async doApply() { if (this.hold) await new Promise((r) => { this.release = r; }); return { backupPath: '/x/20261025-103000-config.toml' }; }
  async doRestore() {}
}

// A check whose findings the test edits between scans.
class ScriptCheck extends Check {
  id = 'X9';
  source = 'codex';
  items = [];
  run() {
    return this.items.map(([id, severity, withFix, hold]) => new Finding({
      id, checkId: 'X9', source: id.startsWith('C') ? 'claude' : 'codex', severity, title: id, detail: 'd', evidence: ['e'],
      fix: withFix ? new MemFix(id, { hold }) : null,
    }));
  }
}
const setup = (items = []) => { const c = new ScriptCheck(); c.items = items; return { c, o: new Optimizer({ checks: [c] }) }; };
const tick = (o) => o.run(snap({}));
const code = async (p) => { try { await p; return null; } catch (e) { return e.code ?? `raw:${e.message}`; } };

test('default registry is every export of checks/index.js (no second list)', () => {
  assert.equal(new Optimizer().checks.length, Object.keys(registry).length);
});

test('list(): FindingDto[] sorted by severity, then source, then id; capped fields', () => {
  const { o } = setup([['X2:b', 'info', false], ['C1:a', 'warn', true], ['X1:a', 'bad', false], ['C3:a', 'warn', false], ['X3:z', 'ok', false]]);
  tick(o);
  const l = o.list();
  assert.deepEqual(l.map((f) => f.id), ['X1:a', 'C1:a', 'C3:a', 'X2:b', 'X3:z']);
  assert.deepEqual(Object.keys(l[1]).sort(), ['checkId', 'detail', 'evidence', 'fixState', 'fixable', 'id', 'recommended', 'restorable', 'severity', 'source', 'title']);
  assert.deepEqual([l[1].fixable, l[1].restorable, l[1].fixState], [true, false, 'proposed']);
  assert.deepEqual([l[0].fixable, l[0].restorable, l[0].fixState], [false, false, null]);
  assert.equal(o.generatedAt, snap({}).generatedAt);
});

test('a check that throws does not hide the others', () => {
  const bad = new (class extends Check { id = 'X8'; source = 'codex'; run() { throw new Error('boom'); } })();
  const c = new ScriptCheck();
  c.items = [['X1:a', 'warn', false]];
  const o = new Optimizer({ checks: [bad, c] });
  tick(o);
  assert.deepEqual(o.list().map((f) => f.id), ['X1:a']);
  assert.deepEqual(o.failedChecks, ['X8']);
});

test('preview, apply, restore by finding id; apply answers the file name only', async () => {
  const { o } = setup([['X1:a', 'warn', true]]);
  tick(o);
  const p = await o.preview('X1:a');
  assert.deepEqual(p, { findingId: 'X1:a', diff: 'diff X1:a', previewId: PID, restorable: true });
  assert.deepEqual(await o.apply('X1:a', PID), { findingId: 'X1:a', fixState: 'applied', restorable: true, backupName: '20261025-103000-config.toml' });
  assert.deepEqual(await o.restore('X1:a'), { findingId: 'X1:a', fixState: 'restored' });
});

test('NOT_FOUND for an unknown id and for a finding without a fix', async () => {
  const { o } = setup([['X2:b', 'info', false]]);
  tick(o);
  assert.equal(await code(o.preview('X1:nope')), 'NOT_FOUND');
  assert.equal(await code(o.preview('X2:b')), 'NOT_FOUND');
  assert.equal(await code(o.apply('X2:b', PID)), 'NOT_FOUND');
  assert.equal(await code(o.restore('X2:b')), 'NOT_FOUND');
});

test('an applied fix survives a scan, stays listed as ok after its finding is gone, and can be restored', async () => {
  const { c, o } = setup([['X1:a', 'warn', true]]);
  tick(o);
  await o.preview('X1:a');
  await o.apply('X1:a', PID);
  c.items = [];
  tick(o);
  const [f] = o.list();
  assert.deepEqual([f.id, f.severity, f.fixState, f.restorable], ['X1:a', 'ok', 'applied', true]);
  assert.deepEqual(await o.restore('X1:a'), { findingId: 'X1:a', fixState: 'restored' });
  tick(o);
  assert.deepEqual(o.list(), []); // restored and gone: dropped
});

test('a restored fix goes back to proposed when the next scan finds the problem again', async () => {
  const { o } = setup([['X1:a', 'warn', true]]);
  tick(o);
  await o.preview('X1:a');
  await o.apply('X1:a', PID);
  await o.restore('X1:a');
  tick(o);
  assert.equal(o.list()[0].fixState, 'proposed');
});

test('a previewed fix survives the next scan, so the user can read the diff and still apply', async () => {
  const { o } = setup([['X1:a', 'warn', true]]);
  tick(o);
  await o.preview('X1:a');
  tick(o);
  assert.equal(o.list()[0].fixState, 'previewed');
});

test('FIX_BUSY: one fix at a time; busyFindingId names the running one; the busy fix itself is not blocked', async () => {
  const { o } = setup([['X1:a', 'warn', true, true], ['X1:b', 'warn', true]]);
  tick(o);
  await o.preview('X1:a');
  const running = o.apply('X1:a', PID);
  await new Promise((r) => setImmediate(r));
  assert.equal(o.busyFindingId(), 'X1:a');
  assert.equal(await code(o.preview('X1:b')), 'FIX_BUSY');
  o.getFix('X1:a').release();
  await running;
  assert.equal(o.busyFindingId(), null);
  assert.equal((await o.preview('X1:b')).findingId, 'X1:b');
});

test('findingsRev grows when the list or a fix state changes, not on an identical scan; subscribers hear about it', async () => {
  const { c, o } = setup([['X1:a', 'warn', true]]);
  let heard = 0;
  o.subscribe(() => heard++);
  tick(o);
  const r1 = o.rev;
  tick(o);
  assert.equal(o.rev, r1);
  await o.preview('X1:a');
  assert.ok(o.rev > r1);
  const r2 = o.rev;
  c.items.push(['X2:b', 'info', false]);
  tick(o);
  assert.ok(o.rev > r2);
  assert.ok(heard >= 3);
});

test('Finding rejects a bad id or severity and trims long text to the contract limits', () => {
  assert.throws(() => new Finding({ id: 'bad id', checkId: 'C1', source: 'claude', severity: 'warn', title: 't', detail: 'd' }));
  assert.throws(() => new Finding({ id: 'C1:x', checkId: 'C1', source: 'claude', severity: 'loud', title: 't', detail: 'd' }));
  const f = new Finding({ id: 'C1:x', checkId: 'C1', source: 'claude', severity: 'warn', title: 't'.repeat(500), detail: 'd'.repeat(500), evidence: Array.from({ length: 30 }, () => 'e'.repeat(400)) });
  assert.equal(f.title.length, 120);
  assert.equal(f.detail.length, 400);
  assert.equal(f.evidence.length, 20);
  assert.equal(f.evidence[0].length, 260);
  assert.ok(new CoreError('NOT_FOUND') instanceof Error);
});

test('C1 style fix (not restorable): applied is final; a returning finding gets a fresh proposed fix, a gone one is dropped', async () => {
  const { c, o } = setup([['C1:drift', 'warn', true]]);
  tick(o);
  const { previewId } = await o.preview('C1:drift');
  assert.equal((await o.apply('C1:drift', previewId)).fixState, 'applied');
  tick(o); // finding still present: new fix
  assert.equal(o.list()[0].fixState, 'proposed');
  assert.equal((await o.preview('C1:drift')).findingId, 'C1:drift');
  c.items = [];
  tick(o);
  assert.deepEqual(o.list(), []);
  await o.apply('C1:drift', PID).catch(() => {});
  c.items = [['C1:drift', 'warn', true]];
  tick(o);
  assert.equal(o.list()[0].fixState, 'proposed');
});

// L2: the busy lock covers the whole apply call, including the preview that checks for staleness.
test('L2: while one fix re-runs its preview inside apply, every other preview, apply and restore gets FIX_BUSY', async () => {
  let gate = null;
  let calls = 0;
  class SlowPreviewFix extends MemFix {
    async doPreview() { if (++calls >= 2) await new Promise((r) => { gate = r; }); return { diff: 'd', previewId: PID }; }
  }
  const check = new (class extends Check {
    id = 'X9';
    source = 'codex';
    run() {
      return [['C1:slow', new SlowPreviewFix('C1:slow')], ['X1:other', new MemFix('X1:other')]].map(([id, fix]) => new Finding({
        id, checkId: id.slice(0, 2), source: 'codex', severity: 'warn', title: id, detail: 'd', fix,
      }));
    }
  })();
  const o = new Optimizer({ checks: [check] });
  tick(o);
  await o.preview('C1:slow');
  await o.preview('X1:other');
  const pending = o.apply('C1:slow', PID);
  await new Promise((r) => setImmediate(r));
  assert.ok(gate, 'the apply is waiting inside its stale-check preview');
  assert.equal(o.getFix('C1:slow').state, 'previewed');
  assert.equal(o.busyFindingId(), 'C1:slow');
  assert.equal(await code(o.apply('X1:other', PID)), 'FIX_BUSY');
  assert.equal(await code(o.preview('X1:other')), 'FIX_BUSY');
  assert.equal(await code(o.restore('X1:other')), 'FIX_BUSY');
  assert.equal(await code(o.preview('C1:slow')), 'FIX_BUSY');
  assert.equal(await code(o.apply('C1:slow', PID)), 'FIX_BUSY');
  gate();
  await pending;
  assert.equal(o.busyFindingId(), null);
  assert.equal(o.getFix('C1:slow').state, 'applied');
});
