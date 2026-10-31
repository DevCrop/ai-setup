import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { Check } from '../core/check.js';
import { Finding } from '../core/finding.js';
import { C3SectionHealth } from '../core/checks/c3-section-health.js';
import { U1ClaudeCodeUpdate, newer } from '../core/checks/u1-claude-code-update.js';
import { U2RepoBehind } from '../core/checks/u2-repo-behind.js';
import { MonitorService } from '../core/monitor-service.js';
import { NotificationPolicy } from '../core/notification-policy.js';
import { Optimizer } from '../core/optimizer.js';
import { Snapshot } from '../core/snapshot.js';
import { UpdateSource, httpsJson } from '../core/sources/update-source.js';
import { claudeRes, fakeClock, fullClaude, snap, tmpDir, write } from './helpers.mjs';

const HEAD = 'a'.repeat(40);
const REMOTE = 'b'.repeat(40);

// Fake runner: answers by the command line; records every call.
function fakeRunner({ version = '2.1.310 (Claude Code)', remote = REMOTE, known = true, behind = '3', branch = 'main' } = {}) {
  const calls = [];
  const run = async (file, args, opts) => {
    calls.push({ file, args, opts });
    const a = args.join(' ');
    if (file === 'claude') return version ? { code: 0, stdout: version, stderr: '' } : { code: -1, stdout: '', stderr: 'ENOENT' };
    if (a.includes('ls-remote')) return remote ? { code: 0, stdout: `${remote}\trefs/heads/main\n`, stderr: '' } : { code: 128, stdout: '', stderr: 'offline' };
    if (a.includes('--abbrev-ref')) return { code: 0, stdout: `${branch}
`, stderr: '' };
    if (a.includes('rev-parse')) return { code: 0, stdout: `${HEAD}\n`, stderr: '' };
    if (a.includes('cat-file')) return { code: known ? 0 : 1, stdout: '', stderr: '' };
    if (a.includes('rev-list')) return { code: 0, stdout: `${behind}\n`, stderr: '' };
    return { code: 1, stdout: '', stderr: '' };
  };
  return { run, calls };
}

const ctxFor = (claudeHome, now = 1000) => ({ now, homes: { claude: claudeHome, codex: tmpDir() }, repo: tmpDir(), env: {} });

test('UpdateSource is inert by default and when the setting is off: no command, no fetch', async () => {
  const { run, calls } = fakeRunner();
  let fetched = 0;
  const ctx = ctxFor(tmpDir());
  assert.equal((await new UpdateSource().collect(ctx)).data, null);
  const off = new UpdateSource({ runner: run, fetchJson: async () => { fetched++; return {}; }, updateCheck: () => false });
  assert.equal((await off.collect(ctx)).data, null);
  assert.deepEqual([calls.length, fetched], [0, 0]);
});

test('UpdateSource: collect never waits for the network, caches for the TTL, uses the stable tag when the channel is stable', async () => {
  const home = tmpDir();
  write(path.join(home, 'settings.json'), JSON.stringify({ autoUpdatesChannel: 'stable' }));
  const { run, calls } = fakeRunner();
  const urls = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const src = new UpdateSource({ runner: run, fetchJson: async (u) => { urls.push(u); await gate; return { latest: '2.1.316', stable: '2.1.312' }; }, updateCheck: () => true, ttlMs: 100 });
  const first = await src.collect(ctxFor(home, 1000));
  assert.equal(first.data, null); // returned before the fetch finished
  release();
  await src.settle();
  const second = await src.collect(ctxFor(home, 1050));
  assert.deepEqual(second.data, { claudeCode: { installed: '2.1.310', latest: '2.1.312', channel: 'stable' }, repo: { behind: 3, remote: REMOTE } });
  assert.equal(urls.length, 1); // inside the TTL: no new fetch
  await src.collect(ctxFor(home, 1200));
  await src.settle();
  assert.equal(urls.length, 2);
  assert.ok(urls.every((u) => u.startsWith('https://registry.npmjs.org/')));
  const git = calls.filter((c) => c.file === 'git');
  assert.ok(git.every((c) => c.opts.env.GIT_TERMINAL_PROMPT === '0' && c.opts.env.GCM_INTERACTIVE === 'never'));
  assert.ok(!git.some((c) => /fetch|pull|reset|checkout/.test(c.args.join(' ')))); // read-only git only
});

test('UpdateSource: offline, a missing claude, a bad version string and an unknown remote commit', async () => {
  const home = tmpDir();
  const one = async (runnerOpts, fetchJson) => {
    const src = new UpdateSource({ runner: fakeRunner(runnerOpts).run, fetchJson, updateCheck: () => true });
    await src.collect(ctxFor(home));
    await src.settle();
    return (await src.collect(ctxFor(home, 2000))).data;
  };
  assert.deepEqual(await one({ remote: null, version: null }, async () => { throw new Error('offline'); }), { claudeCode: null, repo: null });
  assert.deepEqual((await one({}, async () => ({ latest: '2.1.316; rm -rf /' }))).claudeCode, null);
  assert.deepEqual((await one({ known: false }, async () => ({ latest: '2.1.316' }))).repo, { behind: null, remote: REMOTE });
  assert.deepEqual((await one({ remote: HEAD }, async () => ({ latest: '2.1.316' }))).repo, { behind: 0, remote: HEAD });
  assert.deepEqual((await one({ branch: 'feat/x' }, async () => ({ latest: '2.1.316' }))).repo, { behind: 0, branch: 'other', remote: REMOTE }); // feature branch: no 'git pull' advice
});

test('httpsJson: registry host only, size limit, http errors throw', async () => {
  await assert.rejects(httpsJson('https://evil.test/x', async () => assert.fail('fetched')), /host not allowed/);
  await assert.rejects(httpsJson('http://registry.npmjs.org/x', async () => assert.fail('fetched')), /host not allowed/);
  const res = (status, text) => async () => ({ ok: status === 200, status, text: async () => text });
  assert.deepEqual(await httpsJson('https://registry.npmjs.org/x', res(200, '{"latest":"1.0.0"}')), { latest: '1.0.0' });
  await assert.rejects(httpsJson('https://registry.npmjs.org/x', res(500, '')), /http 500/);
  await assert.rejects(httpsJson('https://registry.npmjs.org/x', res(200, 'x'.repeat(70000))), /too large/);
});

const upd = (data) => new Snapshot({ generatedAt: new Date(0).toISOString(), sources: { updates: { status: 'ok', note: '', data } }, ctx: {} });

test('U1 and U2 report as info with the command to run; nothing when up to date or unknown', () => {
  assert.equal(newer('2.1.316', '2.1.310'), true);
  assert.equal(newer('2.1.310', '2.1.310'), false);
  assert.equal(newer('2.0.999', '2.1.0'), false);
  const [u1] = new U1ClaudeCodeUpdate().run(upd({ claudeCode: { installed: '2.1.310', latest: '2.1.316', channel: 'latest' } }));
  assert.deepEqual([u1.id, u1.severity], ['U1:claude-code', 'info']);
  assert.ok(u1.evidence.includes('명령: claude update'));
  assert.deepEqual(new U1ClaudeCodeUpdate().run(upd({ claudeCode: { installed: '2.1.316', latest: '2.1.316', channel: 'latest' } })), []);
  assert.deepEqual(new U1ClaudeCodeUpdate().run(upd(null)), []);
  const [u2] = new U2RepoBehind().run(upd({ repo: { behind: 3 } }));
  assert.deepEqual([u2.id, u2.severity], ['U2:repo', 'info']);
  assert.match(u2.title, /3개의/);
  assert.match(new U2RepoBehind().run(upd({ repo: { behind: null } }))[0].title, /새 커밋/);
  assert.deepEqual(new U2RepoBehind().run(upd({ repo: { behind: 0 } })), []);
});

test('C3:plugins names the plugin off its pin and the install command', () => {
  const plugins = { status: 'warn', items: [
    { name: 'ponytail@ponytail', enabled: true, installedVersion: '5.3.2', pinnedRef: 'v5.3.2', status: 'ok' },
    { name: 'claude-mem@thedotmack', enabled: true, installedVersion: '15.0.2', pinnedRef: 'v15.3.0', status: 'warn' },
    { name: 'x@y', enabled: false, installedVersion: '1.0.0', pinnedRef: null, pinnedSha: 'c'.repeat(40), status: 'warn' },
  ] };
  const [f] = new C3SectionHealth().run(snap({ claude: claudeRes(fullClaude({ plugins })) })).filter((x) => x.id === 'C3:plugins');
  assert.deepEqual(f.evidence, ['status: warn', 'claude-mem@thedotmack: 15.0.2 → 핀 v15.3.0', 'x@y: 꺼짐', '명령: bash scripts/install-plugins.sh']);
});

test('MonitorService: with a policy, a new warn is not counted until stable; health follows the stable counts', async () => {
  const clock = fakeClock();
  let flag = 'warn';
  const sources = [{ id: 'claude', label: 'Claude', async collect() { return { status: 'ok', note: '', data: fullClaude({ flag }) }; } }];
  class Flag extends Check {
    id = 'C9'; source = 'claude';
    run(s) { const sev = this.data(s)?.flag; return sev ? [new Finding({ id: 'C9:f', checkId: 'C9', source: 'claude', severity: sev, title: 't', detail: 'd' })] : []; }
  }
  const policy = new NotificationPolicy({ now: () => clock.now() });
  const svc = new MonitorService({ outDir: path.join(tmpDir(), 'o'), homes: { claude: tmpDir(), codex: tmpDir() }, repo: tmpDir(), env: {}, sources, optimizer: new Optimizer({ checks: [new Flag()] }), policy, clock, refreshSec: 600 });
  assert.equal(svc.status().health, null); // starting
  await svc.refreshNow();
  assert.deepEqual([svc.status().state, svc.status().counts, svc.status().health], ['ok', { warn: 0, bad: 0 }, 100]);
  await clock.advance(3 * 60 * 1000);
  assert.deepEqual([svc.status().state, svc.status().counts, svc.status().health], ['warn', { warn: 1, bad: 0 }, 95]);
  flag = 'bad';
  await svc.refreshNow();
  assert.deepEqual([svc.status().state, svc.status().health], ['bad', 85]);
});
