import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { Check } from '../core/check.js';
import { X1MissingTrustedProject } from '../core/checks/x1-missing-trusted-project.js';
import { Finding } from '../core/finding.js';
import { FixJournal, MAX_ENTRIES } from '../core/fix-journal.js';
import { Fix } from '../core/fix.js';
import { MonitorService } from '../core/monitor-service.js';
import { Optimizer } from '../core/optimizer.js';
import { Snapshot } from '../core/snapshot.js';
import { CodexSource } from '../core/sources/codex-source.js';
import { CANARY, NOW, fakeClock, fakeCodex, tmpDir, write } from './helpers.mjs';

const clock = () => new Date(2026, 9, 25, 10, 30, 0);
const code = async (p) => { try { await p; return null; } catch (e) { return e.code ?? `raw:${e.message}`; } };
const HASH = 'a'.repeat(64);
const entry = (over = {}) => ({ findingId: 'X1:abcdef012345', checkId: 'X1', source: 'codex', action: 'applied', backupName: '20261025-103000-config.toml', appliedHash: HASH, parts: ['projects', '/gone'], ...over });

const jfile = () => path.join(tmpDir('cm-journal-'), 'out', 'fix-journal.json');

// One "session": a journal on `file` and an optimizer with the real X1 check, scanned against the fake ~/.codex.
async function session(c, file) {
  const journal = new FixJournal({ file, now: () => NOW });
  const o = new Optimizer({ checks: [new X1MissingTrustedProject({ clock })], journal });
  o.resume({ codexHome: c.home });
  const scan = async () => {
    const codex = await new CodexSource().collect({ now: NOW, homes: { codex: c.home } });
    return o.run(new Snapshot({ generatedAt: new Date(NOW).toISOString(), sources: { codex }, ctx: { repo: '/r', homes: { codex: c.home } } }));
  };
  return { o, journal, scan };
}

test('FixJournal: records are stored with ids, names and hashes only; a new instance reads them back; no temp file is left', () => {
  const file = jfile();
  const j = new FixJournal({ file, now: () => NOW });
  const e = j.record(entry());
  assert.equal(e.at, new Date(NOW).toISOString());
  assert.equal(e.restorableAfterRestart, true);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(Object.keys(raw.entries[0]).sort(), ['action', 'appliedHash', 'at', 'backupName', 'checkId', 'findingId', 'parts', 'restorableAfterRestart', 'source']);
  assert.deepEqual(new FixJournal({ file }).entries(), j.entries());
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['fix-journal.json']);
});

test('FixJournal: keeps the newest 200 entries; recent() is newest first', () => {
  const file = jfile();
  const j = new FixJournal({ file, now: () => NOW });
  for (let i = 0; i < MAX_ENTRIES + 5; i++) j.record(entry({ findingId: `X1:n${i}` }));
  assert.equal(j.entries().length, 200);
  assert.equal(new FixJournal({ file }).entries().length, 200);
  assert.equal(j.recent(3).map((e) => e.findingId).join(), 'X1:n204,X1:n203,X1:n202');
  assert.deepEqual(j.recent(0), []);
  assert.equal(j.entries()[0].findingId, 'X1:n5');
});

test('FixJournal: a damaged file starts empty; bad or hostile entries are dropped; a failing write does not throw', () => {
  const file = write(jfile(), '{not json');
  assert.deepEqual(new FixJournal({ file }).entries(), []);
  const at = new Date(NOW).toISOString();
  write(file, JSON.stringify({ entries: [entry({ at }), entry({ at, findingId: '../etc' }), entry({ at, action: 'deleted' }), entry({ at, backupName: '../../x' }), entry({ at, appliedHash: 'zz' }), entry(), null, 5] }));
  const j = new FixJournal({ file });
  assert.equal(j.entries().length, 3);
  assert.deepEqual(j.entries().slice(1).map((e) => [e.backupName, e.appliedHash, e.restorableAfterRestart]), [[null, HASH, false], ['20261025-103000-config.toml', null, false]]);
  assert.equal(j.record(entry({ findingId: 'bad id' })), null);
  const blocked = new FixJournal({ file: path.join(write(path.join(tmpDir(), 'plain'), 'x'), 'sub', 'j.json') }); // parent is a file: mkdir fails
  assert.ok(blocked.record(entry()));
  assert.equal(blocked.entries().length, 1);
});

test('after a restart an applied X1 comes back as a restorable fix; restore copies the backup back and is journaled', async () => {
  const c = fakeCodex();
  const original = fs.readFileSync(c.config);
  const file = jfile();
  const s1 = await session(c, file);
  await s1.scan();
  const id = s1.o.list().find((f) => f.id.startsWith('X1:')).id;
  const p = await s1.o.preview(id);
  const r = await s1.o.apply(id, p.previewId);
  assert.equal(r.backupName, '20261025-103000-config.toml');
  const applied = s1.journal.entries().at(-1);
  assert.deepEqual([applied.action, applied.checkId, applied.source, applied.backupName, applied.restorableAfterRestart], ['applied', 'X1', 'codex', r.backupName, true]);
  const afterApply = fs.readFileSync(c.config);

  const s2 = await session(c, file); // restart
  assert.deepEqual(s2.o.list(), []); // listed after the first scan
  await s2.scan();
  const dto = s2.o.list().find((f) => f.id === id);
  assert.deepEqual([dto.severity, dto.fixable, dto.restorable, dto.fixState], ['ok', true, true, 'applied']);
  assert.deepEqual(dto.evidence, [c.gone]);
  assert.deepEqual(s2.o.history(5).map((h) => [h.action, h.restorable, h.restorableAfterRestart]), [['applied', true, true]]);
  assert.deepEqual(fs.readFileSync(c.config), afterApply);
  assert.deepEqual(await s2.o.restore(id), { findingId: id, fixState: 'restored' });
  assert.deepEqual(fs.readFileSync(c.config), original);
  assert.deepEqual(s2.o.history(5).map((h) => [h.action, h.restorable]), [['restored', false], ['applied', false]]);

  const s3 = await session(c, file); // restored entries are not resumed again
  await s3.scan();
  assert.equal(s3.o.getFix(id)?.state, 'proposed'); // the table is back, so the next scan proposes the fix anew
});

test('after a restart RESTORE_CONFLICT still guards: config.toml changed after apply -> nothing is written', async () => {
  const c = fakeCodex();
  const file = jfile();
  const s1 = await session(c, file);
  await s1.scan();
  const id = s1.o.list().find((f) => f.id.startsWith('X1:')).id;
  await s1.o.apply(id, (await s1.o.preview(id)).previewId);
  fs.appendFileSync(c.config, '\n# codex wrote this\n');
  const edited = fs.readFileSync(c.config);
  const s2 = await session(c, file);
  await s2.scan();
  assert.equal(await code(s2.o.restore(id)), 'RESTORE_CONFLICT');
  assert.equal(s2.o.getFix(id).state, 'applied');
  assert.deepEqual(fs.readFileSync(c.config), edited);
});

test('no resume when the backup file is gone; failures are journaled but never resumed', async () => {
  const c = fakeCodex();
  const file = jfile();
  const s1 = await session(c, file);
  await s1.scan();
  const id = s1.o.list().find((f) => f.id.startsWith('X1:')).id;
  const r = await s1.o.apply(id, (await s1.o.preview(id)).previewId);
  fs.rmSync(path.join(c.home, 'backups', 'claude-monitor', r.backupName));
  const s2 = await session(c, file);
  await s2.scan();
  assert.equal(s2.o.getFix(id), null);
  assert.deepEqual(s2.o.history(5).map((h) => h.restorable), [false]);

  class Boom extends Fix {
    get restorable() { return true; }
    async doPreview() { return { diff: 'd', previewId: HASH }; }
    async doApply() { throw new Error('raw'); }
    async doRestore() { throw new Error('raw'); }
  }
  const check = new (class extends Check { id = 'X9'; source = 'codex'; run() { return [new Finding({ id: 'X9:boom', checkId: 'X9', source: 'codex', severity: 'warn', title: 't', detail: 'd', fix: new Boom('X9:boom') })]; } })();
  const j = new FixJournal({ file: jfile() });
  const o = new Optimizer({ checks: [check], journal: j });
  o.run(new Snapshot({ generatedAt: 'x', sources: {} }));
  await o.preview('X9:boom');
  assert.equal(await code(o.apply('X9:boom', HASH)), 'APPLY_FAILED');
  assert.deepEqual(j.entries().map((e) => [e.action, e.backupName, e.restorableAfterRestart]), [['applyFailed', null, false]]);
  assert.equal(await code(o.apply('X9:boom', 'f'.repeat(64))), 'INVALID_STATE'); // a refused call is not a failure and is not journaled
  assert.equal(j.entries().length, 1);
});

test('C4 entries are not restorable after a restart (the old bytes were in memory)', async () => {
  const claudeHome = tmpDir();
  const repo = tmpDir();
  write(path.join(claudeHome, 'settings.json'), JSON.stringify({ model: 'a', effortLevel: 'high' }));
  const repoFile = write(path.join(repo, 'claude', 'settings.json'), '{\n  "model": "a"\n}\n');
  const { AdoptLiveKeysFix } = await import('../core/fixes/adopt-live-keys-fix.js');
  const check = new (class extends Check { id = 'C4'; source = 'claude'; run() { return [new Finding({ id: 'C4:live-only', checkId: 'C4', source: 'claude', severity: 'info', title: 't', detail: 'd', fix: new AdoptLiveKeysFix({ id: 'C4:live-only', repo, claudeHome }) })]; } })();
  const file = jfile();
  const o = new Optimizer({ checks: [check], journal: new FixJournal({ file, now: () => NOW }) });
  o.run(new Snapshot({ generatedAt: 'x', sources: {} }));
  await o.apply('C4:live-only', (await o.preview('C4:live-only')).previewId);
  assert.deepEqual(o.history(5).map((h) => [h.action, h.restorable, h.restorableAfterRestart]), [['applied', true, false]]);
  assert.ok(fs.readFileSync(repoFile, 'utf8').includes('effortLevel'));

  const o2 = new Optimizer({ checks: [], journal: new FixJournal({ file }) });
  assert.equal(o2.resume({ codexHome: tmpDir() }), 0);
  assert.deepEqual(o2.history(5).map((h) => [h.action, h.restorable, h.restorableAfterRestart]), [['applied', false, false]]);
});

test('MonitorService: journal at outDir/fix-journal.json, history() is the last 50 newest first, an injected optimizer without a journal gives []', async () => {
  const c = fakeCodex();
  const outDir = path.join(tmpDir(), 'out');
  const mk = () => new MonitorService({ outDir, homes: { claude: tmpDir(), codex: c.home }, repo: tmpDir(), env: {}, sources: [new CodexSource()], clock: fakeClock() });
  const svc = mk();
  assert.deepEqual(svc.history(), []);
  await svc.refreshNow();
  const id = svc.optimizer.list().find((f) => f.id.startsWith('X1:')).id;
  await svc.optimizer.apply(id, (await svc.optimizer.preview(id)).previewId);
  assert.ok(fs.existsSync(path.join(outDir, 'fix-journal.json')));
  const h = svc.history();
  assert.deepEqual(Object.keys(h[0]).sort(), ['action', 'at', 'backupName', 'checkId', 'findingId', 'restorable', 'restorableAfterRestart', 'source']);
  assert.deepEqual([h[0].action, h[0].restorable], ['applied', true]);

  const svc2 = mk(); // restart
  assert.equal(svc2.history()[0].restorable, true); // resumed at construction
  await svc2.refreshNow();
  assert.equal(svc2.optimizer.list().find((f) => f.id === id).fixState, 'applied');

  const bare = new MonitorService({ outDir: path.join(tmpDir(), 'o2'), homes: { claude: tmpDir(), codex: tmpDir() }, repo: tmpDir(), env: {}, sources: [], optimizer: new Optimizer({ checks: [] }), clock: fakeClock() });
  assert.deepEqual(bare.history(), []);

  const many = new FixJournal({ file: jfile(), now: () => NOW });
  for (let i = 0; i < 80; i++) many.record(entry({ findingId: `X1:n${i}`, action: 'restored', backupName: null, appliedHash: null, parts: null }));
  const svc3 = new MonitorService({ outDir: path.join(tmpDir(), 'o3'), homes: { claude: tmpDir(), codex: tmpDir() }, repo: tmpDir(), env: {}, sources: [], journal: many, clock: fakeClock() });
  assert.equal(svc3.history().length, 50);
  assert.equal(svc3.history()[0].findingId, 'X1:n79');
});

test('canary: the journal file and history never hold a config value, a diff or a secret', async () => {
  const c = fakeCodex();
  const file = jfile();
  const s = await session(c, file);
  await s.scan();
  const id = s.o.list().find((f) => f.id.startsWith('X1:')).id;
  const p = await s.o.preview(id);
  await s.o.apply(id, p.previewId);
  const all = [fs.readFileSync(file, 'utf8'), JSON.stringify(s.o.history(50)), JSON.stringify(s.o.list())].join('\n');
  for (const [name, value] of Object.entries(CANARY)) assert.ok(!all.includes(value), name);
  assert.ok(!all.includes('trust_level') && !all.includes(p.diff));
});
