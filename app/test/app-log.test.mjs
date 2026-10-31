import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { AppLog, errText } from '../core/app-log.js';
import { tmpDir } from './helpers.mjs';

test('AppLog: one masked line per event, control characters dropped, rotates to app.1.log, never throws', () => {
  const dir = path.join(tmpDir(), 'logs');
  const log = new AppLog({ dir, now: () => 0, homeDir: 'C:\\Users\\tester', maxBytes: 200 });
  log.error('boom at C:\\Users\\tester\\x\nsecond line');
  const text = fs.readFileSync(path.join(dir, 'app.log'), 'utf8');
  assert.equal(text, '1970-01-01T00:00:00.000Z error boom at ~\\x second line\n');
  for (let i = 0; i < 10; i++) log.info('x'.repeat(30));
  assert.ok(fs.existsSync(path.join(dir, 'app.1.log')));
  assert.ok(fs.statSync(path.join(dir, 'app.log')).size < 260);
  log.write('nonsense', 'y'.repeat(2000));
  assert.match(fs.readFileSync(path.join(dir, 'app.log'), 'utf8').trim().split('\n').at(-1), /^\S+ info y{600}$/);
  assert.doesNotThrow(() => new AppLog({ dir: path.join(dir, 'app.log', 'nope') }).error('x')); // a file where the folder should be
  assert.doesNotThrow(() => new AppLog().info('no dir'));
});

test('errText: name, code, message and the first frame only', () => {
  const e = Object.assign(new Error('bad', { cause: new Error('secret cause') }), { code: 'EX' });
  const t = errText(e);
  assert.match(t, /^Error\(EX\): bad at /);
  assert.ok(!t.includes('secret cause'));
  assert.equal(errText('plain'), 'plain');
});
