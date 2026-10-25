import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { C4LiveOnlyKeys } from '../core/checks/c4-live-only-keys.js';
import { ADOPT_EXCLUDED_KEYS, AdoptLiveKeysFix, planAdoption } from '../core/fixes/adopt-live-keys-fix.js';
import { Optimizer } from '../core/optimizer.js';
import { Snapshot } from '../core/snapshot.js';
import { ClaudeSource } from '../core/sources/claude-source.js';
import { NOW, fullClaude, snap, tmpDir, write } from './helpers.mjs';

const SENTINEL = 'SENTINEL_VALUE_7c1e';
const code = async (p) => { try { await p; return null; } catch (e) { return e.code ?? `raw:${e.message}`; } };
const tree = (dir) => fs.readdirSync(dir, { recursive: true }).sort().map((r) => `${r}:${fs.statSync(path.join(dir, r)).isFile() ? createHash('sha1').update(fs.readFileSync(path.join(dir, r))).digest('hex') : 'dir'}`);
const pretty = (o) => `${JSON.stringify(o, null, 2)}\n`;

const LIVE = {
  model: 'opus', theme: 'dark', effortLevel: 'high', statusLine: { type: 'command', command: 'bash ~/.claude/statusline.sh' },
  env: { ANTHROPIC_FOO: SENTINEL }, apiToken: SENTINEL, apiKeyHelper: `echo ${SENTINEL}`, awsAuthRefresh: `aws ${SENTINEL}`,
  awsCredentialExport: `aws ${SENTINEL}`, otelHeadersHelper: `echo ${SENTINEL}`,
  mcpServers: { a: { command: 'x', env: { Z: SENTINEL } } }, // nested env: barred as a whole
};
const REPO = { model: 'opus', theme: 'dark' };

function setup({ live = LIVE, repo = REPO, repoText = pretty(repo) } = {}) {
  const claudeHome = tmpDir('cm-chome-');
  const repoDir = tmpDir('cm-repo-');
  write(path.join(claudeHome, 'settings.json'), JSON.stringify(live));
  write(path.join(claudeHome, 'agents', 'a.md'), 'live agent');
  const repoFile = write(path.join(repoDir, 'claude', 'settings.json'), repoText);
  const fix = new AdoptLiveKeysFix({ id: 'C4:live-only', repo: repoDir, claudeHome });
  return { claudeHome, repoDir, repoFile, fix };
}

const collectOpts = (home, repo) => ({ now: NOW, homes: { claude: home }, repo, env: {}, cache: new Map(), refreshSec: 10 });
const claudeSource = () => new ClaudeSource({ collectFn: async () => fullClaude() });

test('preview: the diff adds only the allowed live-only keys, appended in live order with 2-space indent; the repo file is not written', async () => {
  const { fix, repoFile } = setup();
  const before = fs.readFileSync(repoFile);
  const { diff, previewId } = await fix.preview();
  assert.equal(diff, [
    '--- claude/settings.json', '+++ claude/settings.json',
    '-  "theme": "dark"', '+  "theme": "dark",',
    '+  "effortLevel": "high",',
    '+  "statusLine": {', '+    "type": "command",', '+    "command": "bash ~/.claude/statusline.sh"', '+  }',
  ].join('\n'));
  assert.match(previewId, /^[0-9a-f]{64}$/);
  assert.deepEqual(fs.readFileSync(repoFile), before);
  assert.equal(fix.state, 'previewed');
});

test('excluded keys (secret-looking names, env, the helper keys, a nested env) never appear in the diff or the written file', async () => {
  const { fix, repoFile } = setup();
  const { diff, previewId } = await fix.preview();
  await fix.apply(previewId);
  const written = fs.readFileSync(repoFile, 'utf8');
  for (const text of [diff, written]) {
    assert.ok(!text.includes(SENTINEL));
    for (const k of [...ADOPT_EXCLUDED_KEYS, 'apiToken', 'mcpServers']) assert.ok(!text.includes(`"${k}"`), k);
  }
  assert.deepEqual(ADOPT_EXCLUDED_KEYS, ['env', 'apiKeyHelper', 'awsAuthRefresh', 'awsCredentialExport', 'otelHeadersHelper']);
});

test('apply writes only the repo file: the Claude home is byte-identical, the result is valid JSON with the old keys first, no temp file is left', async () => {
  const { fix, repoFile, claudeHome, repoDir } = setup();
  const homeBefore = tree(claudeHome);
  const { previewId } = await fix.preview();
  assert.deepEqual(await fix.apply(previewId), {});
  assert.deepEqual(tree(claudeHome), homeBefore);
  const j = JSON.parse(fs.readFileSync(repoFile, 'utf8'));
  assert.deepEqual(Object.keys(j), ['model', 'theme', 'effortLevel', 'statusLine']);
  assert.deepEqual(j.statusLine, LIVE.statusLine);
  assert.equal(fs.readFileSync(repoFile, 'utf8'), '{\n  "model": "opus",\n  "theme": "dark",\n  "effortLevel": "high",\n  "statusLine": {\n    "type": "command",\n    "command": "bash ~/.claude/statusline.sh"\n  }\n}\n');
  assert.deepEqual(fs.readdirSync(path.join(repoDir, 'claude')), ['settings.json']);
  assert.equal(fix.state, 'applied');
});

test('restore writes the old bytes back', async () => {
  const { fix, repoFile, claudeHome } = setup();
  const original = fs.readFileSync(repoFile);
  const homeBefore = tree(claudeHome);
  await fix.apply((await fix.preview()).previewId);
  assert.notDeepEqual(fs.readFileSync(repoFile), original);
  assert.deepEqual(await fix.restore(), { restored: true });
  assert.deepEqual(fs.readFileSync(repoFile), original);
  assert.deepEqual(tree(claudeHome), homeBefore);
  assert.equal(fix.state, 'restored');
  assert.equal(fix.restorable, true);
});

test('PREVIEW_STALE when the live file or the repo file changed since the preview; nothing is written', async () => {
  const a = setup();
  const pa = (await a.fix.preview()).previewId;
  write(path.join(a.claudeHome, 'settings.json'), JSON.stringify({ ...LIVE, another: 1 }));
  const repoBefore = fs.readFileSync(a.repoFile);
  assert.equal(await code(a.fix.apply(pa)), 'PREVIEW_STALE');
  assert.equal(a.fix.state, 'proposed');
  assert.deepEqual(fs.readFileSync(a.repoFile), repoBefore);

  const b = setup();
  const pb = (await b.fix.preview()).previewId;
  fs.appendFileSync(b.repoFile, '\n');
  const edited = fs.readFileSync(b.repoFile);
  assert.equal(await code(b.fix.apply(pb)), 'PREVIEW_STALE');
  assert.deepEqual(fs.readFileSync(b.repoFile), edited);
});

test('RESTORE_CONFLICT when the repo file changed after apply; nothing is written, the state stays applied', async () => {
  const { fix, repoFile } = setup();
  await fix.apply((await fix.preview()).previewId);
  fs.appendFileSync(repoFile, '\n');
  const edited = fs.readFileSync(repoFile);
  assert.equal(await code(fix.restore()), 'RESTORE_CONFLICT');
  assert.equal(fix.state, 'applied');
  assert.deepEqual(fs.readFileSync(repoFile), edited);
});

test('nothing left after exclusion: preview fails and the C4 finding is report-only with a Korean reason; evidence is key names', async () => {
  const live = { model: 'opus', env: { A: SENTINEL }, apiToken: SENTINEL };
  const { fix } = setup({ live });
  assert.equal(await code(fix.preview()), 'PREVIEW_FAILED');

  const home = tmpDir();
  const repo = tmpDir();
  write(path.join(home, 'settings.json'), JSON.stringify(live));
  write(path.join(repo, 'claude', 'settings.json'), JSON.stringify({ model: 'opus' }));
  const r = await claudeSource().collect(collectOpts(home, repo));
  assert.deepEqual(r.data.liveOnlyKeys, ['apiToken', 'env']);
  assert.deepEqual(r.data.adoptableKeys, []);
  const [f] = new C4LiveOnlyKeys().run(snap({ claude: r, ctx: { repo, homes: { claude: home } } }));
  assert.equal(f.fix, null);
  assert.equal(f.toDto().fixable, false);
  assert.match(f.detail, /자동으로 가져오지 않습니다/);
  assert.deepEqual(f.evidence, ['제외(비밀 가능): apiToken · env']);
  assert.ok(!JSON.stringify(f).includes(SENTINEL));
});

test('C4 finding is fixable when a key can be adopted; detail is Korean and says how many were skipped', async () => {
  const home = tmpDir();
  const repo = tmpDir();
  write(path.join(home, 'settings.json'), JSON.stringify(LIVE));
  write(path.join(repo, 'claude', 'settings.json'), JSON.stringify(REPO));
  const r = await claudeSource().collect(collectOpts(home, repo));
  assert.deepEqual(r.data.adoptableKeys, ['effortLevel', 'statusLine']);
  const [f] = new C4LiveOnlyKeys().run(snap({ claude: r, ctx: { repo, homes: { claude: home } } }));
  assert.ok(f.fix instanceof AdoptLiveKeysFix);
  const dto = f.toDto();
  assert.deepEqual([dto.fixable, dto.restorable, dto.fixState], [true, true, 'proposed']);
  assert.match(f.detail, /키 2개/);
  assert.match(f.detail, /7개는 제외/);
  assert.equal(f.evidence.length, 2);
  assert.equal(f.evidence[0], '가져올 키: effortLevel · statusLine');
  assert.match(f.evidence[1], /^제외\(비밀 가능\): /);
  assert.ok(f.evidence[1].includes('env') && !f.evidence[1].includes('effortLevel'));
  assert.ok(!JSON.stringify(dto).includes(SENTINEL));
});

test('Optimizer with the default registry: preview, apply and restore of C4; the applied fix stays listed as restorable', async () => {
  const claudeHome = tmpDir();
  const repo = tmpDir();
  write(path.join(claudeHome, 'settings.json'), JSON.stringify(LIVE));
  const repoFile = write(path.join(repo, 'claude', 'settings.json'), pretty(REPO));
  const original = fs.readFileSync(repoFile);
  const src = claudeSource();
  const scan = async () => new Snapshot({
    generatedAt: new Date(NOW).toISOString(),
    sources: { claude: await src.collect(collectOpts(claudeHome, repo)) },
    ctx: { repo, homes: { claude: claudeHome } },
  });
  const o = new Optimizer();
  o.run(await scan());
  const dto = o.list().find((f) => f.id === 'C4:live-only');
  assert.deepEqual([dto.fixable, dto.restorable, dto.fixState], [true, true, 'proposed']);
  const p = await o.preview('C4:live-only');
  assert.equal(p.restorable, true);
  assert.ok(p.diff.includes('"effortLevel"') && !p.diff.includes(SENTINEL));
  assert.deepEqual(await o.apply('C4:live-only', p.previewId), { findingId: 'C4:live-only', fixState: 'applied', restorable: true, backupName: null });
  o.run(await scan()); // the excluded keys are still live-only: the finding stays (report-only now) and keeps the applied fix, so undo is still offered
  const kept = o.list().find((f) => f.id === 'C4:live-only');
  assert.deepEqual([kept.severity, kept.restorable, kept.fixState], ['info', true, 'applied']);
  assert.deepEqual(await o.restore('C4:live-only'), { findingId: 'C4:live-only', fixState: 'restored' });
  assert.deepEqual(fs.readFileSync(repoFile), original);
});

test('Optimizer: when every live-only key was adopted the finding is gone and the applied fix is listed as ok, still restorable', async () => {
  const claudeHome = tmpDir();
  const repo = tmpDir();
  write(path.join(claudeHome, 'settings.json'), JSON.stringify({ model: 'opus', effortLevel: 'high' }));
  const repoFile = write(path.join(repo, 'claude', 'settings.json'), pretty({ model: 'opus' }));
  const original = fs.readFileSync(repoFile);
  const src = claudeSource();
  const scan = async () => new Snapshot({
    generatedAt: new Date(NOW).toISOString(),
    sources: { claude: await src.collect(collectOpts(claudeHome, repo)) },
    ctx: { repo, homes: { claude: claudeHome } },
  });
  const o = new Optimizer();
  o.run(await scan());
  await o.apply('C4:live-only', (await o.preview('C4:live-only')).previewId);
  o.run(await scan());
  const kept = o.list().find((f) => f.id === 'C4:live-only');
  assert.deepEqual([kept.severity, kept.restorable, kept.fixState], ['ok', true, 'applied']);
  await o.restore('C4:live-only');
  assert.deepEqual(fs.readFileSync(repoFile), original);
});

test('formats: an empty object, CRLF files and a file without a final newline keep their style', async () => {
  const e = setup({ repo: {}, repoText: '{}' });
  await e.fix.apply((await e.fix.preview()).previewId);
  const eText = fs.readFileSync(e.repoFile, 'utf8');
  assert.deepEqual(Object.keys(JSON.parse(eText)), ['model', 'theme', 'effortLevel', 'statusLine']);
  assert.ok(!eText.endsWith('\n'));

  const c = setup({ repoText: pretty(REPO).replaceAll('\n', '\r\n') });
  await c.fix.apply((await c.fix.preview()).previewId);
  const text = fs.readFileSync(c.repoFile, 'utf8');
  assert.ok(text.includes('\r\n') && !/[^\r]\n/.test(text));
  assert.deepEqual(Object.keys(JSON.parse(text)), ['model', 'theme', 'effortLevel', 'statusLine']);
});

test('planAdoption: case-insensitive exclusion, nested names, long names and __proto__ are skipped; own repo keys are not copied', () => {
  const live = JSON.parse(`{"ENV":1,"ok":1,"has":{"deep":[{"secretThing":1}]},"clean":{"a":[1,{"b":2}]},"__proto__":{"x":1},"${'k'.repeat(81)}":1,"same":1}`);
  const { adopt, excluded } = planAdoption(live, { same: 2 });
  assert.deepEqual(adopt, ['ok', 'clean']);
  assert.deepEqual(excluded, ['ENV', 'has']);
  // a secret inside a string value bars the key; plain commands stay
  const vals = planAdoption({ a: { command: 'bash x.sh --token=abc12345' }, b: ['Authorization: Bearer abcdefgh12345'], c: { apiKey_note: 1, x: 'password: hunter22' }, d: { command: 'bash ~/.claude/statusline.sh' }, e: 'tokenizer on' }, {});
  assert.deepEqual(vals.adopt, ['d', 'e']);
  assert.deepEqual(vals.excluded, ['a', 'b', 'c']);
});

test('the fix has no direct fs import (reads go through readGuarded, writes through writeAtomic on the repo file); same repo and live path is refused', () => {
  const src = fs.readFileSync(new URL('../core/fixes/adopt-live-keys-fix.js', import.meta.url), 'utf8');
  assert.ok(!/node:fs/.test(src));
  assert.deepEqual([...src.matchAll(/writeAtomic\(([^,]+),/g)].map((m) => m[1]), ['this.#repoFile', 'this.#repoFile']);
  const d = tmpDir();
  assert.throws(() => new AdoptLiveKeysFix({ id: 'C4:live-only', repo: d, claudeHome: path.join(d, 'claude') }), TypeError);
});
