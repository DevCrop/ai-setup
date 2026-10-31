import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { NotificationPolicy, inQuietHours, minAgeMs } from '../core/notification-policy.js';
import { SettingsStore, DEFAULT_SETTINGS, normHome, resolveHomes, validHome } from '../core/settings-store.js';
import { tmpDir } from './helpers.mjs';

const MIN = 60000;
const f = (id, severity = 'warn', title = id) => ({ id, checkId: id.split(':')[0], severity, title });
const at = (h, m = 0) => new Date(2026, 9, 31, h, m).getTime();

function policy({ settings = { notify: true }, file = null, start = at(12) } = {}) {
  const clock = { t: start };
  const p = new NotificationPolicy({ file, now: () => clock.t, settings: () => settings });
  return { p, clock };
}

test('inQuietHours: plain range, a range over midnight, and off when an end is empty', () => {
  const s = { quietStart: '22:00', quietEnd: '07:00' };
  assert.equal(inQuietHours(s, at(23)), true);
  assert.equal(inQuietHours(s, at(6, 59)), true);
  assert.equal(inQuietHours(s, at(7)), false);
  assert.equal(inQuietHours(s, at(12)), false);
  assert.equal(inQuietHours({ quietStart: '09:00', quietEnd: '17:00' }, at(10)), true);
  assert.equal(inQuietHours({ quietStart: '09:00', quietEnd: '17:00' }, at(18)), false);
  assert.equal(inQuietHours({ quietStart: '22:00', quietEnd: '' }, at(23)), false);
});

test('a finding counts only after its min age; leaving resets it; C1 waits 30 minutes', () => {
  const { p, clock } = policy();
  const w = f('C2:x'); const c1 = f('C1:drift'); const info = f('U1:claude-code', 'info');
  p.observe([w, c1, info]);
  assert.equal(p.isStable(w), false);
  assert.equal(p.isStable(info), true);
  clock.t += minAgeMs('C2');
  assert.equal(p.isStable(w), true);
  assert.equal(p.isStable(c1), false);
  clock.t += 30 * MIN;
  assert.equal(p.isStable(c1), true);
  p.observe([c1]); // w gone
  p.observe([w, c1]); // and back: counts from now
  assert.equal(p.isStable(w), false);
});

test('toast: stable warn/bad only, batched, once per hour, cooldown per finding, re-alert when severity rises', () => {
  const { p, clock } = policy();
  const a = f('C3:hooks'); const b = f('X1:abc');
  p.observe([a, b]);
  assert.equal(p.decide(null, { state: 'warn' }, [a, b]), null); // not stable yet
  clock.t += 3 * MIN;
  const n = p.decide(null, { state: 'warn' }, [a, b]);
  assert.match(n.title, /확인 필요/);
  assert.match(n.body, /외 1건/);
  clock.t += 10 * MIN;
  const c = f('X5:z');
  p.observe([a, b, c]);
  clock.t += 3 * MIN;
  assert.equal(p.decide(null, { state: 'warn' }, [a, b, c]), null); // within the hour: held, not marked
  clock.t += 60 * MIN;
  assert.equal(p.decide(null, { state: 'warn' }, [a, b, c]).body, 'X5:z.'); // a and b are in cooldown
  clock.t += 2 * 60 * MIN;
  const worse = f('C3:hooks', 'bad');
  assert.match(p.decide(null, { state: 'bad' }, [worse, b, c]).title, /문제/); // severity rose
  clock.t += 2 * 60 * MIN;
  assert.equal(p.decide(null, { state: 'bad' }, [worse, b, c]), null);
  clock.t += 24 * 60 * MIN;
  assert.match(p.decide(null, { state: 'bad' }, [worse, b, c]).body, /외 2건/); // cooldown over
});

test('toast: C2 cools down for 7 days; notify off and quiet hours hold the toast without marking it', () => {
  const settings = { notify: false, quietStart: '', quietEnd: '' };
  const { p, clock } = policy({ settings });
  const r = f('C2:explorer');
  p.observe([r]);
  clock.t += 3 * MIN;
  assert.equal(p.decide(null, { state: 'warn' }, [r]), null);
  settings.notify = true; settings.quietStart = '00:00'; settings.quietEnd = '23:59';
  assert.equal(p.decide(null, { state: 'warn' }, [r]), null);
  settings.quietStart = '';
  assert.ok(p.decide(null, { state: 'warn' }, [r]));
  clock.t += 6 * 24 * 60 * MIN;
  p.observe([r]);
  assert.equal(p.decide(null, { state: 'warn' }, [r]), null);
  clock.t += 25 * 60 * MIN;
  assert.ok(p.decide(null, { state: 'warn' }, [r]));
});

test('toast: collection error once per error streak, not on the first status', () => {
  const { p } = policy();
  assert.equal(p.decide(null, { state: 'error' }, []), null);
  assert.match(p.decide({ state: 'ok' }, { state: 'error' }, []).title, /수집 오류/);
  assert.equal(p.decide({ state: 'error' }, { state: 'error' }, []), null);
  p.decide({ state: 'error' }, { state: 'ok' }, []);
  assert.ok(p.decide({ state: 'ok' }, { state: 'error' }, []));
});

test('notify-state.json keeps ids and times only; after a restart a finding waits again but its cooldown holds', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'notify-state.json');
  const { p, clock } = policy({ file });
  const a = f('C3:hooks', 'warn', 'secret-looking title');
  p.observe([a]);
  assert.equal(fs.existsSync(file), false); // first-seen times are not written
  clock.t += 3 * MIN;
  assert.ok(p.decide(null, { state: 'warn' }, [a]));
  const text = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(text, /secret-looking/);
  p.observe([a]);
  assert.equal(fs.readFileSync(file, 'utf8'), text); // unchanged: not rewritten
  clock.t += 24 * 60 * MIN - MIN; // off for almost a day
  const again = new NotificationPolicy({ file, now: () => clock.t, settings: () => ({ notify: true }) });
  again.observe([a]);
  assert.equal(again.isStable(a), false); // time the app was off is not time seen
  clock.t += 3 * MIN;
  assert.equal(again.isStable(a), true);
  clock.t -= 2 * MIN; // still inside the 24 h cooldown from before the restart
  assert.equal(again.decide(null, { state: 'warn' }, [a]), null);
  fs.writeFileSync(file, '{broken');
  assert.doesNotThrow(() => new NotificationPolicy({ file, now: () => clock.t }));
});

test('a source that could not be read keeps its findings ages; a read source that drops one resets it', () => {
  const { p, clock } = policy();
  const a = { ...f('C3:hooks'), source: 'claude' };
  p.observe([a]);
  clock.t += 2 * MIN;
  p.observe([], ['claude']); // claude source failed this run
  clock.t += MIN;
  p.observe([a]);
  assert.equal(p.isStable(a), true);
  p.observe([]); // read fine, finding gone
  p.observe([a]);
  assert.equal(p.isStable(a), false);
});

test('SettingsStore: defaults, checked keys, atomic write, broken file reads as defaults', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'settings.json');
  const s = new SettingsStore({ file });
  assert.deepEqual(s.get(), DEFAULT_SETTINGS);
  assert.deepEqual(s.set({ notify: false, quietStart: '22:00', quietEnd: '07:00' }), { ...DEFAULT_SETTINGS, notify: false, quietStart: '22:00', quietEnd: '07:00' });
  assert.equal(s.set({ theme: 'dark' }).theme, 'dark');
  assert.equal(new SettingsStore({ file }).get().quietEnd, '07:00');
  assert.throws(() => s.set({ notify: 'no' }), TypeError);
  assert.throws(() => s.set({ quietStart: '25:00' }), TypeError);
  assert.throws(() => s.set({ theme: 'x' }), TypeError);
  assert.throws(() => s.set({ constructor: 1 }), TypeError); // prototype keys are not settings
  fs.writeFileSync(file, JSON.stringify({ notify: 'bad', updateCheck: false, extra: 1 }));
  assert.deepEqual(new SettingsStore({ file }).get(), { ...DEFAULT_SETTINGS, updateCheck: false });
  fs.writeFileSync(file, 'nope');
  assert.deepEqual(new SettingsStore({ file }).get(), DEFAULT_SETTINGS);
});

test('SettingsStore: refresh periods from a fixed list; a home folder must be absolute, exist and look like that home', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'settings.json');
  const s = new SettingsStore({ file });
  assert.equal(s.set({ liveSec: 3, idleSec: 60 }).liveSec, 3);
  assert.throws(() => s.set({ liveSec: 1 }), TypeError);
  assert.throws(() => s.set({ idleSec: '30' }), TypeError);
  const claude = path.join(dir, 'c'); fs.mkdirSync(path.join(claude, 'projects'), { recursive: true });
  const codex = path.join(dir, 'x'); fs.mkdirSync(path.join(codex, 'sessions'), { recursive: true });
  assert.equal(s.set({ claudeHome: claude, codexHome: codex }).claudeHome, claude);
  assert.equal(validHome('claudeHome', codex), false); // a Codex folder is not a Claude home
  // config files alone do not make a home: the repo's own claude/ (settings.json) or ~/.cargo (config.toml)
  const cfg = path.join(dir, 'cfg'); fs.mkdirSync(cfg); fs.writeFileSync(path.join(cfg, 'settings.json'), '{}'); fs.writeFileSync(path.join(cfg, 'config.toml'), '');
  assert.equal(validHome('claudeHome', cfg), false);
  assert.equal(validHome('codexHome', cfg), false);
  fs.writeFileSync(path.join(cfg, 'projects'), ''); // a file named like the marker folder
  assert.equal(validHome('claudeHome', cfg), false);
  // only normalized local paths; typed input is normalized first
  for (const bad of [String.raw`\\server\share\.claude`, '//server/share/.claude', String.raw`\\?\C:\x`, `${claude}${path.sep}`, `${claude}${path.sep}.`]) assert.equal(validHome('claudeHome', bad), false, bad);
  assert.equal(normHome(`  ${claude}${path.sep}  `), claude);
  assert.equal(normHome(path.join(dir, 'x', '..', 'c')), claude);
  assert.equal(normHome('relative'), 'relative');
  assert.equal(normHome(String.raw`\\server\share`), String.raw`\\server\share`);
  assert.equal(normHome(''), '');
  assert.equal(normHome('   '), ''); // blank means automatic
  fs.writeFileSync(path.join(cfg, 'sessions'), '');
  assert.equal(validHome('codexHome', cfg), false);
  for (const bad of ['relative/path', path.join(dir, 'missing'), path.join(codex, 'config.toml'), `${claude}\n`, 7]) assert.throws(() => s.set({ claudeHome: bad }), TypeError, String(bad));
  assert.equal(s.set({ claudeHome: '' }).claudeHome, '');
  // a saved folder that was removed reads as automatic
  s.set({ claudeHome: claude });
  fs.rmSync(claude, { recursive: true });
  assert.equal(new SettingsStore({ file }).get().claudeHome, '');
  assert.deepEqual(resolveHomes({ claudeHome: '', codexHome: codex }, { CLAUDE_CONFIG_DIR: '/env/claude' }, '/home/u'), { claude: '/env/claude', codex });
  assert.deepEqual(resolveHomes({ claudeHome: '', codexHome: '' }, {}, '/home/u'), { claude: path.join('/home/u', '.claude'), codex: path.join('/home/u', '.codex') });
});

test('digest: once a day from 18:00 with counts only; held by notify off, quiet hours, no output or a bad state; survives a restart', () => {
  const file = path.join(tmpDir(), 'notify-state.json');
  const settings = { notify: true, quietStart: '22:00', quietEnd: '07:00' };
  const { p, clock } = policy({ settings, file, start: at(17, 59) });
  const st = { state: 'ok', todayOutput: 123456, todayProjects: 2, todaySavedInput: 2500000 };
  const tips = [f('C11:slow-hook', 'info'), f('C10:x', 'ok')];
  p.observe(tips);
  assert.equal(p.digest(st, tips), null); // before 18:00
  clock.t = at(18, 5);
  assert.equal(p.digest({ ...st, state: 'stale' }, tips), null);
  assert.equal(p.digest({ ...st, todayOutput: 0 }, tips), null);
  settings.notify = false;
  assert.equal(p.digest(st, tips), null);
  settings.notify = true;
  const n = p.digest(st, tips);
  assert.deepEqual(n, { title: 'Claude Monitor: 오늘 요약', body: '프로젝트 2곳 · 출력 123K 토큰 · 캐시로 입력 2.5M 절약 · 개선 제안 1건.' });
  assert.equal(p.digest(st, tips), null); // once a day
  const again = new NotificationPolicy({ file, now: () => clock.t, settings: () => settings });
  assert.equal(again.digest(st, tips), null); // the date is kept on disk
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /123456|slow-hook/);
  clock.t = at(23) + 86400000; // next day, quiet hours
  assert.equal(again.digest(st, []), null);
  clock.t = at(19) + 86400000;
  assert.match(again.digest({ ...st, todayProjects: 0, todaySavedInput: 0 }, []).body, /^출력 123K 토큰 · 개선 제안 없음\.$/);
});
