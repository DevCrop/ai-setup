import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { U3AutoUpdate } from '../core/checks/u3-auto-update.js';
import { execRunner } from '../core/fixes/apply-repo-fix.js';
import { NotificationPolicy } from '../core/notification-policy.js';
import { Snapshot } from '../core/snapshot.js';
import { AutoUpdater, RETRY_MS, RepoPullStep, updateFacts } from '../core/updater.js';
import { MonitorService } from '../core/monitor-service.js';
import { fakeClock, fullClaude, tmpDir, write } from './helpers.mjs';

const OLD = 'a'.repeat(40);
const NEW = 'b'.repeat(40);
const HOME = 'C:\\Users\\tester';

const snapOf = ({ remote = NEW, behind = 2, branch, claudeCode = null, plugins = [] } = {}) => new Snapshot({
  generatedAt: new Date(0).toISOString(),
  sources: {
    updates: { status: 'ok', note: '', data: { claudeCode, repo: remote ? { behind, remote, ...(branch ? { branch } : {}) } : null } },
    claude: { status: 'ok', note: '', data: { plugins: { items: plugins } } },
  },
  ctx: {},
});

// Fake runner for the four steps; `fail` names commands that exit 1, `dirty` makes git status report a change.
function fakeRunner({ changed = ['claude/CLAUDE.md'], dirty = false, branch = 'main', fail = [] } = {}) {
  const calls = [];
  let head = OLD;
  const run = async (file, args, opts) => {
    const a = [file, ...args].join(' ');
    calls.push({ a, opts });
    if (fail.some((f) => a.includes(f))) return { code: 1, stdout: '', stderr: `boom in ${HOME}\\x and /c/Users/tester/y` };
    if (a.includes('--abbrev-ref')) return { code: 0, stdout: `${branch}\n`, stderr: '' };
    if (a.includes('status --porcelain')) return { code: 0, stdout: dirty ? ' M claude/x\n' : '', stderr: '' };
    if (a.includes('rev-parse HEAD')) return { code: 0, stdout: `${head}\n`, stderr: '' };
    if (a.includes('pull --ff-only')) { head = NEW; return { code: 0, stdout: 'Fast-forward', stderr: '' }; }
    if (a.includes('diff --name-only')) return { code: 0, stdout: changed.join('\n'), stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  return { run, calls, cmds: () => calls.map((c) => c.a) };
}

const make = (o = {}) => {
  let t = o.t0 ?? 1000;
  const u = new AutoUpdater({ file: o.file ?? path.join(tmpDir(), 'update-state.json'), repo: o.repo ?? '/repo', runner: o.runner, enabled: () => o.enabled ?? true, now: () => t, homeDir: HOME, onDone: o.onDone });
  return { u, advance: (ms) => { t += ms; } };
};

test('updateFacts: target keys come from the snapshot only; feature branch, up to date and a bad sha give nothing', () => {
  assert.deepEqual(updateFacts(snapOf()), { repoRemote: NEW, claudeCode: null, pluginsOff: null, known: { repo: true, claudeCode: false, plugins: true, drift: false }, drift: 0 });
  assert.equal(updateFacts(snapOf({ branch: 'other', behind: 0 })).repoRemote, null);
  assert.equal(updateFacts(snapOf({ behind: 0 })).repoRemote, null);
  assert.equal(updateFacts(snapOf({ remote: 'x; rm -rf /' })).repoRemote, null);
  assert.equal(updateFacts(snapOf({ behind: null })).repoRemote, NEW); // unknown count: the remote has unseen commits
  assert.equal(updateFacts(snapOf({ claudeCode: { installed: '2.1.310', latest: '2.1.316', channel: 'latest' } })).claudeCode, '2.1.316');
  assert.equal(updateFacts(snapOf({ claudeCode: { installed: '2.1.316', latest: '2.1.316', channel: 'latest' } })).claudeCode, null);
  const off = updateFacts(snapOf({ plugins: [{ name: 'a@b', status: 'warn', pinnedRef: 'v2' }, { name: 'c@d', status: 'ok' }] })).pluginsOff;
  assert.match(off, /^off:[0-9a-f]{12}$/);
  assert.equal(updateFacts(snapOf()).pluginsOff, null);
});

test('AutoUpdater: off, without a runner, or while a fix runs it starts nothing', () => {
  const r = fakeRunner();
  assert.equal(make({ runner: r.run, enabled: false }).u.consider(snapOf()), null);
  assert.equal(make({ runner: null }).u.consider(snapOf()), null);
  const { u } = make({ runner: r.run });
  u.isBusy = () => true;
  assert.equal(u.consider(snapOf()), null);
  assert.equal(r.calls.length, 0);
});

test('AutoUpdater: a pull that changes claude/, the pins and app/ runs apply and plugins, then flags a restart; the same target never runs twice', async () => {
  const r = fakeRunner({ changed: ['claude/CLAUDE.md', 'claude/settings.json', 'app/main/main.js'] });
  const results = [];
  const { u } = make({ runner: r.run, onDone: (x) => results.push(x) });
  const p = u.consider(snapOf());
  assert.ok(p);
  assert.equal(u.running, true);
  assert.equal(u.consider(snapOf()), null); // one pass at a time
  const res = await p;
  assert.deepEqual(res, { done: ['repo', 'apply', 'plugins'], failed: [], restartNeeded: true, npmNeeded: false });
  assert.deepEqual(results, [res]);
  const cmds = r.cmds();
  assert.ok(cmds.includes('git -C /repo pull --ff-only origin main'));
  assert.ok(cmds.includes('bash scripts/apply.sh'));
  assert.ok(cmds.includes('bash scripts/install-plugins.sh'));
  assert.ok(!cmds.some((c) => /reset|checkout|clean|npm/.test(c)));
  assert.ok(r.calls.filter((c) => c.a.startsWith('git')).every((c) => c.opts.env.GIT_TERMINAL_PROMPT === '0'));
  assert.ok(cmds.indexOf('bash scripts/apply.sh') < cmds.indexOf('bash scripts/install-plugins.sh'));
  assert.equal(u.consider(snapOf()), null); // the source still says behind until it re-checks: the done key holds
  assert.equal(u.status().restartNeeded, true);
});

test('AutoUpdater: a pull outside claude/ runs no apply; a dirty tree blocks the pull and its followers but not claude update', async () => {
  const quiet = fakeRunner({ changed: ['docs/x.md'] });
  assert.deepEqual((await make({ runner: quiet.run }).u.consider(snapOf())).done, ['repo']);

  const file = path.join(tmpDir(), 'update-state.json');
  const r = fakeRunner({ dirty: true });
  const { u, advance } = make({ runner: r.run, file });
  const res = await u.consider(snapOf({ claudeCode: { installed: '2.1.310', latest: '2.1.316', channel: 'latest' } }));
  assert.deepEqual([res.done, res.failed], [['claudeCode'], ['repo']]);
  assert.ok(!r.cmds().some((c) => c.includes('pull')));
  assert.ok(r.cmds().includes('claude update'));
  const st = u.status();
  assert.deepEqual(st.failed.map((f) => [f.step, f.note]), [['repo', '커밋하지 않은 변경이 있어 받지 않았습니다.']]);
  // the failure waits RETRY_MS, also across a restart (state file)
  const again = new AutoUpdater({ file, repo: '/repo', runner: r.run, enabled: () => true, now: () => 1000 + RETRY_MS - 1, homeDir: HOME });
  assert.equal(again.consider(snapOf()), null);
  advance(RETRY_MS);
  assert.ok(u.consider(snapOf()));
  await u.settle();
});

test('AutoUpdater: a failed command keeps only the masked tail of its output; a failure the user fixed by hand is forgotten', async () => {
  const r = fakeRunner({ fail: ['claude update'] });
  const { u } = make({ runner: r.run });
  await u.consider(snapOf({ remote: null, claudeCode: { installed: '2.1.310', latest: '2.1.316', channel: 'latest' } }));
  const [f] = u.status().failed;
  assert.equal(f.step, 'claudeCode');
  assert.ok(!f.note.includes('tester'), f.note);
  assert.match(f.note, /~\\x and ~\/y/);
  assert.equal(u.consider(snapOf({ remote: null, claudeCode: { installed: '2.1.316', latest: '2.1.316', channel: 'latest' } })), null);
  assert.deepEqual(u.status().failed, []);
});

test('AutoUpdater: an empty first snapshot (no update data yet) keeps a failure and its 6 h wait; a new target key does not skip it', async () => {
  const file = path.join(tmpDir(), 'update-state.json');
  const r = fakeRunner({ dirty: true });
  await make({ runner: r.run, file }).u.consider(snapOf());
  const empty = new Snapshot({ generatedAt: '', sources: { updates: { status: 'missing', note: '', data: null }, claude: { status: 'ok', note: '', data: {} } }, ctx: {} });
  let t = 2000;
  const again = new AutoUpdater({ file, repo: '/repo', runner: r.run, enabled: () => true, now: () => t, homeDir: HOME });
  assert.equal(again.consider(empty), null);
  assert.deepEqual(again.status().failed.map((f) => f.step), ['repo']); // not forgotten on "no data"
  assert.equal(again.consider(snapOf({ remote: 'c'.repeat(40) })), null); // a newer remote waits out the same 6 h
  t = 1000 + RETRY_MS;
  assert.ok(again.consider(snapOf({ remote: 'c'.repeat(40) })));
  await again.settle();
  // plugins: a failed pins:<head> attempt also holds an off:<hash> attempt
  const pr = fakeRunner({ changed: ['claude/settings.json'], fail: ['install-plugins'] });
  const { u, advance } = make({ runner: pr.run });
  assert.deepEqual((await u.consider(snapOf())).failed, ['plugins']);
  advance(1000);
  assert.equal(u.consider(snapOf({ remote: null, plugins: [{ name: 'a@b', status: 'warn', pinnedRef: 'v2' }] })), null);
});

test('AutoUpdater: a failed apply is forgotten once C1 reports no drift, kept while drift remains or is unknown', async () => {
  const r = fakeRunner({ fail: ['apply.sh'] });
  const { u } = make({ runner: r.run });
  assert.deepEqual((await u.consider(snapOf())).failed, ['apply']);
  const withDrift = (n) => new Snapshot({ generatedAt: '', sources: { claude: { status: 'ok', note: '', data: { setup: n === null ? {} : { driftCount: n } } } }, ctx: {} });
  u.consider(withDrift(null));
  u.consider(withDrift(3));
  assert.deepEqual(u.status().failed.map((f) => f.step), ['apply']);
  u.consider(withDrift(0));
  assert.deepEqual(u.status().failed, []);
});

test('MonitorService: a pass that did something drops the source caches and runs again', async () => {
  let invalidated = 0;
  let collects = 0;
  const sources = [{ id: 'claude', label: 'Claude', invalidate() { invalidated++; }, async collect() { collects++; return { status: 'ok', note: '', data: fullClaude() }; } }];
  let pass = { done: ['repo'], failed: [] };
  const updater = { running: false, status: () => null, consider() { const p = pass; pass = null; return p ? Promise.resolve(p) : null; } };
  const svc = new MonitorService({ outDir: path.join(tmpDir(), 'o'), homes: { claude: tmpDir(), codex: tmpDir() }, repo: tmpDir(), env: {}, sources, updater, clock: fakeClock(), refreshSec: 600 });
  await svc.refreshNow();
  await new Promise((res) => setImmediate(res));
  await svc.refreshNow();
  assert.equal(invalidated, 1);
  assert.ok(collects >= 2);
});

test('AutoUpdater: a dependency change asks for npm ci and never runs it; npm ci done later clears it at the next start', async () => {
  const repo = tmpDir();
  const file = path.join(tmpDir(), 'update-state.json');
  const r = fakeRunner({ changed: ['app/package.json', 'app/package-lock.json'] });
  const { u } = make({ runner: r.run, repo, file });
  const res = await u.consider(snapOf());
  assert.deepEqual([res.restartNeeded, res.npmNeeded], [true, true]);
  assert.ok(!r.cmds().some((c) => c.includes('npm')));
  assert.equal(new AutoUpdater({ file, repo }).status().npmNeeded, true);
  const lock = write(path.join(repo, 'app', 'node_modules', '.package-lock.json'), '{}');
  fs.utimesSync(lock, new Date(), new Date(Date.now() + 60000));
  const fresh = new AutoUpdater({ file, repo });
  assert.deepEqual([fresh.status().npmNeeded, fresh.status().restartNeeded], [false, false]);
});

test('AutoUpdater: a damaged state file reads as a fresh start', () => {
  const file = write(path.join(tmpDir(), 'update-state.json'), '{"steps":{"repo":{"key":1}},"log":[{"at":"x"}],"npmAt":"y"}');
  const st = new AutoUpdater({ file, repo: '/repo' }).status();
  assert.deepEqual([st.failed, st.log, st.npmNeeded], [[], [], false]);
});

test('U3 reports npm ci (warn) before a restart (info) and each failed step; nothing without updater state', () => {
  const run = (autoUpdate) => new U3AutoUpdate().run(new Snapshot({ generatedAt: '', sources: {}, ctx: { autoUpdate } }));
  assert.deepEqual(run(null), []);
  assert.deepEqual(run({ restartNeeded: false, npmNeeded: false, failed: [] }), []);
  assert.deepEqual(run({ restartNeeded: true, npmNeeded: false, failed: [] }).map((f) => [f.id, f.severity]), [['U3:restart', 'info']]);
  const all = run({ restartNeeded: true, npmNeeded: true, failed: [{ step: 'claudeCode', label: 'Claude Code', note: 'exit 1' }] });
  assert.deepEqual(all.map((f) => [f.id, f.severity]), [['U3:npm', 'warn'], ['U3:claudeCode', 'info']]);
  assert.deepEqual(all[1].evidence, ['exit 1']);
});

test('NotificationPolicy.updated: one toast per pass that did something, step labels only, held back by notify off', () => {
  const p = new NotificationPolicy({ now: () => 0 });
  assert.equal(p.updated({ done: [], failed: ['repo'] }), null);
  const n = p.updated({ done: ['repo', 'apply'], restartNeeded: true, npmNeeded: false }, { repo: '저장소 받기', apply: '설정 반영' });
  assert.equal(n.body, '저장소 받기, 설정 반영 완료. 메인 창을 닫으면 앱이 다시 시작합니다.');
  assert.equal(new NotificationPolicy({ settings: () => ({ notify: false }) }).updated({ done: ['repo'] }), null);
});

test('MonitorService: considers the updater after each run, passes its state to the checks, and locks fixes while it runs', async () => {
  const seen = [];
  const updater = {
    running: false, isBusy: null,
    status: () => ({ restartNeeded: true, npmNeeded: false, failed: [] }),
    consider(s) { seen.push(s); return Promise.resolve({ done: [], failed: [] }); },
  };
  const sources = [{ id: 'claude', label: 'Claude', async collect() { return { status: 'ok', note: '', data: fullClaude() }; } }];
  const svc = new MonitorService({ outDir: path.join(tmpDir(), 'o'), homes: { claude: tmpDir(), codex: tmpDir() }, repo: tmpDir(), env: {}, sources, updater, clock: fakeClock(), refreshSec: 600 });
  await svc.refreshNow();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].ctx.autoUpdate.restartNeeded, true);
  assert.ok(svc.optimizer.findings().some((f) => f.id === 'U3:restart'));
  assert.equal(svc.optimizer.externalBusy(), false);
  updater.running = true;
  assert.equal(svc.optimizer.externalBusy(), true);
  assert.equal(updater.isBusy(), false);
});

// Real git: a bare origin, the checkout the app updates, and a second clone that pushes. Checks ff-only and the dirty gate.
// Each git spawn costs about half a second on Windows, so one set of repos serves both cases.
const GIT_ID = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', env: { ...process.env, ...GIT_ID, GIT_TERMINAL_PROMPT: '0' } }).trim();
function gitRepos() {
  const root = tmpDir('cm-git-');
  const origin = path.join(root, 'origin.git');
  const app = path.join(root, 'app');
  const dev = path.join(root, 'dev');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', dev]);
  git(dev, 'remote', 'add', 'origin', origin);
  write(path.join(dev, 'claude', 'CLAUDE.md'), 'one\n');
  git(dev, 'add', '-A'); git(dev, 'commit', '-qm', 'one'); git(dev, 'push', '-q', 'origin', 'main');
  execFileSync('git', ['clone', '-q', '-b', 'main', origin, app]);
  write(path.join(dev, 'claude', 'CLAUDE.md'), 'two\n');
  write(path.join(dev, 'app', 'x.js'), 'x\n');
  git(dev, 'add', '-A'); git(dev, 'commit', '-qm', 'two'); git(dev, 'push', '-q', 'origin', 'main');
  return { app, remote: git(dev, 'rev-parse', 'HEAD') };
}

test('RepoPullStep with real git: fast-forwards a clean main and lists the changed paths; untracked files do not block; local edits do', async () => {
  const { app, remote } = gitRepos();
  const job = { facts: { repoRemote: remote }, repo: app, runner: execRunner, changed: [], head: null, mask: (t) => t };
  const tracked = path.join(app, 'claude', 'CLAUDE.md');
  fs.appendFileSync(tracked, 'local edit\n');
  await assert.rejects(new RepoPullStep().run(job), /커밋하지 않은 변경/);
  assert.notEqual(git(app, 'rev-parse', 'HEAD'), remote);
  git(app, 'checkout', '--', 'claude/CLAUDE.md'); // not a rewrite: autocrlf may have checked it out with CRLF
  write(path.join(app, '.claude', 'note.txt'), 'untracked');
  await new RepoPullStep().run(job);
  assert.equal(git(app, 'rev-parse', 'HEAD'), remote);
  assert.deepEqual(job.changed.sort(), ['app/x.js', 'claude/CLAUDE.md']);
});
