import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isFrameUrl } from '../core/frame-url.js';

const F = 'file:///C:/Users/u/AppData/Roaming/Claude%20Monitor/claude-monitor.html';

test('frame guard: the monitor file, with a hash or a snapshot reload query', () => {
  assert.equal(isFrameUrl(F, F), true);
  assert.equal(isFrameUrl(F + '#tok', F), true);
  assert.equal(isFrameUrl(F + '?v=2026-10-31T03%3A59%3A20.564Z#ov', F), true);
});

test('frame guard: anything else is denied', () => {
  assert.equal(isFrameUrl(F, null), false);
  assert.equal(isFrameUrl(undefined, F), false);
  assert.equal(isFrameUrl('file:///C:/Windows/win.ini', F), false);
  assert.equal(isFrameUrl(F + '.evil.html', F), false);
  assert.equal(isFrameUrl(F + '/../other.html', F), false);
  assert.equal(isFrameUrl(F + '?x=1', F), false);
  assert.equal(isFrameUrl(F + '?v=a/b', F), false);
  assert.equal(isFrameUrl(F + '?v=' + 'a'.repeat(65), F), false);
  assert.equal(isFrameUrl('https://example.com/?v=1', F), false);
});
