import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { IpcRouter, CHANNELS } from '../main/ipc-router.js';

function setup(handlers = {}) {
  const registered = {};
  const ipcMain = { handle: (ch, fn) => { registered[ch] = fn; } };
  const calls = [];
  const all = Object.fromEntries(Object.keys(CHANNELS).map((ch) => [ch, (p) => { calls.push(ch); return { ch }; }]));
  const router = new IpcRouter({ ipcMain, senderRole: (e) => e.role, handlers: { ...all, ...handlers } });
  router.register();
  const call = (ch, role, payload) => registered[ch]({ role }, payload);
  return { registered, call, calls };
}

const FID = 'X1:proj-1';
const PID = 'a'.repeat(64);
const good = { 'fix:preview': { findingId: FID }, 'fix:apply': { findingId: FID, previewId: PID }, 'fix:restore': { findingId: FID } };

test('every channel is registered and refuses roles it does not allow', async () => {
  const { registered, call } = setup();
  assert.deepEqual(Object.keys(registered).sort(), Object.keys(CHANNELS).sort());
  for (const [ch, spec] of Object.entries(CHANNELS)) {
    for (const role of ['strip', 'main', null, 'other']) {
      const r = await call(ch, role, good[ch]);
      if (spec.roles.includes(role)) assert.equal(r.ok, true, `${ch} ${role}`);
      else assert.deepEqual(r, { ok: false, error: { code: 'FORBIDDEN', message: 'not allowed from this window' } }, `${ch} ${role}`);
    }
  }
});

test('bad payloads answer BAD_REQUEST and never reach the handler', async () => {
  const { call, calls } = setup();
  const bad = [
    ['fix:preview', {}],
    ['fix:preview', { findingId: 'Z1:x' }],
    ['fix:preview', { findingId: FID, extra: 1 }],
    ['fix:preview', { findingId: 'X1:' + 'a'.repeat(65) }],
    ['fix:preview', { findingId: 5 }],
    ['fix:preview', 'X1:a'],
    ['fix:preview', Object.assign(Object.create({ evil: 1 }), { findingId: FID })],
    ['fix:apply', { findingId: FID, previewId: 'A'.repeat(64) }],
    ['fix:apply', { findingId: FID }],
    ['status:get', {}],
    ['app:open-main', { tab: 'nope' }],
    ['app:open-main', { tab: 'opt', x: 1 }],
  ];
  for (const [ch, p] of bad) {
    const r = await call(ch, 'main', p);
    assert.equal(r.error?.code, 'BAD_REQUEST', `${ch} ${JSON.stringify(p)}`);
  }
  assert.deepEqual(calls, []);
  assert.equal((await call('app:open-main', 'main', { tab: 'opt' })).ok, true);
  assert.equal((await call('app:open-main', 'strip', undefined)).ok, true);
});

test('thrown errors map to fixed codes; unknown errors become INTERNAL without the raw message', async () => {
  const boom = (code, detail) => () => { throw Object.assign(new Error('secret C:\\Users\\x stack'), { code, detail }); };
  const { call } = setup({ 'fix:preview': boom('FIX_BUSY'), 'fix:restore': boom(undefined), 'fix:apply': boom('APPLY_FAILED', 'x'.repeat(500) + 'tail') });
  assert.deepEqual(await call('fix:preview', 'main', good['fix:preview']), { ok: false, error: { code: 'FIX_BUSY', message: 'another fix is running' } });
  const internal = await call('fix:restore', 'main', good['fix:restore']);
  assert.deepEqual(internal, { ok: false, error: { code: 'INTERNAL', message: 'internal error' } });
  const applied = await call('fix:apply', 'main', good['fix:apply']);
  assert.equal(applied.error.code, 'APPLY_FAILED');
  assert.equal(applied.error.detail.length, 400);
  assert.ok(applied.error.detail.endsWith('tail'));
});

test('preload exposes exactly the contract methods and channels', () => {
  const src = fs.readFileSync(new URL('../preload/preload.cjs', import.meta.url), 'utf8');
  const methods = [...src.matchAll(/^\s{2}(\w+): /gm)].map((m) => m[1]).sort();
  assert.deepEqual(methods, ['applyFix', 'copySummary', 'getCodexDetail', 'getStatus', 'getViewHtml', 'listFindings', 'listHistory', 'onStatusChanged', 'openMain', 'previewFix', 'quit', 'refresh', 'restoreFix', 'showStripMenu']);
  const channels = [...new Set([...src.matchAll(/'([a-z]+:[a-z-]+)'/g)].map((m) => m[1]))].sort();
  assert.deepEqual(channels, [...Object.keys(CHANNELS), 'status:changed'].sort());
});
