import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { plan, stopApp, LINK_NAME } from '../install.mjs';

const appDir = path.join('X:', 'repo', 'app');
const startupDir = path.join('X:', 'Startup');
const exe = path.join(appDir, 'node_modules', 'electron', 'dist', 'electron.exe');

test('install plan: missing electron or a changed lockfile stops the app, then npm ci, before the shortcut', () => {
  const kinds = (o) => plan({ appDir, startupDir, start: true, ...o }).steps.map((s) => s.kind);
  assert.deepEqual(kinds({ exists: () => false, lockHash: 'a', stampHash: 'a' }), ['stop', 'deps', 'shortcut', 'start']);
  assert.deepEqual(kinds({ exists: (f) => f === exe, lockHash: 'b', stampHash: 'a' }), ['stop', 'deps', 'shortcut', 'start']);
  assert.deepEqual(kinds({ exists: (f) => f === exe, lockHash: 'a', stampHash: 'a' }), ['shortcut', 'start']); // rerun on a set-up PC: app keeps running
});

test('install plan: shortcut points at electron.exe with the app folder, then starts', () => {
  const p = plan({ appDir, startupDir, exists: (f) => f === exe, start: true });
  assert.deepEqual(p.steps.map((s) => s.kind), ['shortcut', 'start']);
  assert.equal(p.steps[0].path, path.join(startupDir, LINK_NAME));
  assert.equal(p.steps[0].target, exe);
  assert.equal(p.steps[0].args, `"${appDir}"`);
});

test('install plan: the old .vbs starter is removed, the same-named old shortcut is overwritten, --no-start skips start', () => {
  const vbs = path.join(startupDir, 'claude-monitor.vbs');
  const p = plan({ appDir, startupDir, exists: (f) => f === exe || f === vbs || f.endsWith('Claude monitor.lnk'), start: false });
  assert.deepEqual(p.steps.map((s) => [s.kind, s.kind === 'remove' ? s.path : '']), [['remove', vbs], ['shortcut', '']]);
});

test('install stop: succeeds when no Claude Monitor is running', { skip: process.platform !== 'win32' }, () => {
  assert.doesNotThrow(() => stopApp(path.join('X:', 'no-such', 'electron.exe')));
});
