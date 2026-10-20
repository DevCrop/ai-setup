import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { renderPage } from '../page.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'sample-scan.json'), 'utf8'));
const scripts = (html) => [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].map((m) => ({ attrs: m[1], body: m[2] }));

// Fixture copy with a hostile path that tries to close the script tag.
const evil = structuredClone(fixture);
const evilPath = 'C:\\Users\\me\\</script><img src=x onerror=alert(1)>\\a&b';
evil.tree.c[1].c.push({ n: '</script>', p: evilPath, s: 1024, m: 0 });
evil.junk.push({ ...fixture.junk[0], id: 'pkg-cache:' + evilPath, path: evilPath });

test('static shell: charset, lang, viewport, Korean button', () => {
  const html = renderPage(fixture);
  assert.match(html, /<html lang="ko">/);
  assert.match(html, /<meta charset="utf-8">/);
  assert.match(html, /<meta name="viewport"/);
  assert.match(html, /정리 계획 저장/);
  assert.match(html, /이 PC의 디스크 지도/);
  assert.match(html, /prefers-color-scheme:\s*dark/);
});

test('no external resources', () => {
  const html = renderPage(fixture);
  assert.doesNotMatch(html, /\b(?:src|href)\s*=\s*["']?(?:https?:)?\/\//i);
  assert.doesNotMatch(html, /url\(\s*["']?(?:https?:)?\/\//i);
  assert.doesNotMatch(html, /@import/);
});

test('embedded JSON round-trips, including a path containing </script>', () => {
  for (const data of [fixture, evil]) {
    const html = renderPage(data);
    const json = scripts(html).find((s) => s.attrs.includes('application/json'));
    assert.ok(json);
    assert.ok(!json.body.includes('<'), 'every < must be escaped');
    assert.deepEqual(JSON.parse(json.body), data);
    // the hostile string must not appear raw anywhere in the markup
    assert.equal(html.includes('</script><img'), false);
  }
});

test('inline code scripts parse', () => {
  const html = renderPage(evil);
  const code = scripts(html).filter((s) => !s.attrs.includes('application/json'));
  assert.equal(code.length, 1);
  assert.doesNotThrow(() => new vm.Script(code[0].body));
});

test('fixture matches the contract basics', () => {
  assert.equal(fixture.roots.length, 2);
  assert.ok(fixture.junk.some((j) => j.action === 'report'));
  fixture.junk.forEach((j) => assert.ok(j.id === j.category + ':' + j.path));
  let nodes = 0;
  (function walk(n) {
    nodes++;
    (n.j || []).forEach((i) => assert.equal(fixture.junk[i].path, n.p));
    (n.c || []).forEach(walk);
  })(fixture.tree);
  assert.ok(nodes >= 50);
});

test('fixture has safety tiers, effect text and the new categories', () => {
  const cats = new Set(fixture.junk.map((j) => j.category));
  for (const c of ['shader-cache', 'app-cache', 'system-cleanup', 'old-download']) assert.ok(cats.has(c), c);
  for (const t of ['safe', 'check', 'manual']) assert.ok(fixture.junk.some((j) => j.safety === t), t);
  fixture.junk.forEach((j) => assert.ok(j.effect && ['safe', 'check', 'manual'].includes(j.safety)));
  // report-only items are never "safe" auto-ticks
  fixture.junk.filter((j) => j.action === 'report').forEach((j) => assert.notEqual(j.safety, 'safe'));
});

test('page has the panel sections, auto button and category strip; old scans without safety still render', () => {
  const html = renderPage(fixture);
  for (const t of ['안전한 것만 자동 선택', '삭제해도 되는 것', '확인 후 삭제', '직접 판단', '지워도 되나요?', 'id="cats"']) {
    assert.ok(html.includes(t), t);
  }
  const old = structuredClone(fixture);
  old.junk.forEach((j) => { delete j.safety; delete j.effect; });
  const html2 = renderPage(old);
  const json = scripts(html2).find((s) => s.attrs.includes('application/json'));
  assert.deepEqual(JSON.parse(json.body), old);
  assert.doesNotThrow(() => new vm.Script(scripts(html2).find((s) => !s.attrs.includes('application/json')).body));
});

// Dev helper: writes the sample page so it can be opened in a browser.
test('render sample to tmpdir', () => {
  const out = path.join(os.tmpdir(), 'machine-map-sample.html');
  fs.writeFileSync(out, renderPage(fixture));
  assert.ok(fs.statSync(out).size > 5000);
});
