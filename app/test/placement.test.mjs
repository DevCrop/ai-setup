import assert from 'node:assert/strict';
import { test } from 'node:test';
import { savedPosition, noticeFor, gitBash } from '../main/placement.js';

const size = { width: 620, height: 34 };
const areas = [{ x: 0, y: 0, width: 1920, height: 1040 }, { x: 1920, y: 0, width: 1280, height: 984 }];

test('savedPosition: kept inside a display, dropped when off screen or invalid', () => {
  assert.deepEqual(savedPosition({ x: 100.4, y: 900 }, size, areas), { x: 100, y: 900 });
  assert.deepEqual(savedPosition({ x: 2000, y: 900 }, size, areas), { x: 2000, y: 900 });
  assert.equal(savedPosition({ x: 1500, y: 900 }, size, areas), null); // straddles two displays
  assert.equal(savedPosition({ x: 3000, y: 100 }, size, areas), null); // monitor unplugged
  assert.equal(savedPosition({ x: 100, y: 1020 }, size, areas), null); // under the taskbar
  assert.equal(savedPosition(null, size, areas), null);
  assert.equal(savedPosition({ x: 'a', y: 1 }, size, areas), null);
});

test('noticeFor: only when bad or warn rises, or collection starts failing', () => {
  const s = (state, warn, bad) => ({ state, counts: { warn, bad } });
  assert.equal(noticeFor(null, s('ok', 0, 0)), null);
  assert.equal(noticeFor(s('starting', 0, 0), s('bad', 0, 3)), null); // first snapshot is not news
  assert.match(noticeFor(s('warn', 2, 0), s('bad', 2, 1)).title, /문제/);
  assert.match(noticeFor(s('ok', 0, 0), s('warn', 1, 0)).body, /1건/);
  assert.equal(noticeFor(s('warn', 3, 0), s('warn', 2, 0)), null);
  assert.equal(noticeFor(s('warn', 2, 0), s('stale', 2, 0)), null);
  assert.match(noticeFor(s('ok', 0, 0), s('error', 0, 0)).title, /수집 오류/);
  assert.equal(noticeFor(s('error', 0, 0), s('error', 0, 0)), null);
});

test('gitBash: install folders first, then next to git.exe on PATH, never a bare PATH bash (WSL)', () => {
  const w = (s) => s.replaceAll('/', '\\');
  const has = (list) => (f) => list.map(w).includes(f);
  const env = { ProgramFiles: w('C:/Program Files'), LOCALAPPDATA: w('C:/Users/u/AppData/Local'), PATH: w('C:/Windows/System32;D:/scoop/apps/git/current/cmd') };
  assert.equal(gitBash(env, has(['C:/Program Files/Git/bin/bash.exe'])), w('C:/Program Files/Git/bin/bash.exe'));
  const scoop = ['D:/scoop/apps/git/current/cmd/git.exe', 'D:/scoop/apps/git/current/bin/bash.exe'];
  assert.equal(gitBash(env, has(scoop)), w('D:/scoop/apps/git/current/bin/bash.exe'));
  assert.equal(gitBash(env, has(['C:/Windows/System32/bash.exe'])), 'git-bash-not-found'); // WSL bash is never picked
  assert.equal(gitBash({}, () => false), 'git-bash-not-found');
});
