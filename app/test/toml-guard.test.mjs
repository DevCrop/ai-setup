import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { isDenied, readGuarded } from '../core/guard.js';
import { parseHeader, readConfig, removeProjectTable, removeTable, scan } from '../core/toml-lite.js';
import { CANARY, fakeCodex, tmpDir, write } from './helpers.mjs';
import fs from 'node:fs';

test('parseHeader: bare, literal and basic quoted parts; junk gives null', () => {
  assert.deepEqual(parseHeader("[projects.'C:\\a b\\c']"), ['projects', 'C:\\a b\\c']);
  assert.deepEqual(parseHeader('[projects."/x/y.z"]  # note'), ['projects', '/x/y.z']);
  assert.deepEqual(parseHeader('[[arr.t]]'), ['arr', 't']);
  assert.equal(parseHeader('[projects.'), null);
  assert.equal(parseHeader('[a] junk'), null);
});

test('readConfig: allowlist values, counts, no secret value, no nested env table', () => {
  const { config } = fakeCodex();
  const c = readConfig(fs.readFileSync(config, 'utf8'));
  assert.equal(c.model, 'gpt-5-codex');
  assert.equal(c.reasoningEffort, 'high');
  assert.equal(c.approval, 'on-request');
  assert.equal(c.sandbox, 'workspace-write');
  assert.equal(c.projects.length, 2); // the table inside the multi-line string is not a project
  assert.deepEqual(c.plugins, { total: 2, enabled: 1 });
  assert.deepEqual(c.mcpServers, { total: 4, enabled: 3 }); // mcp_servers.x.env is not counted as a server
  const json = JSON.stringify(c);
  for (const v of Object.values(CANARY)) assert.ok(!json.includes(v), v);
});

test('a key whose name matches the secret pattern never returns a value, even at top level', () => {
  const c = readConfig('model = "m"\nmodel_token = "SECRET1"\n');
  assert.equal(c.model, 'm');
  assert.ok(!JSON.stringify(c).includes('SECRET1'));
});

test('scan keeps arrays and multi-line strings in one key range', () => {
  const { tables } = scan('a = [\n  "x",\n  "[not.a.table]",\n]\nb = \'\'\'\n[nor.this]\n\'\'\'\nc = 1\n[t]\nd = 2\n');
  assert.deepEqual(tables.map((t) => t.parts.join('.')), ['', 't']);
  assert.deepEqual(tables[0].keys.map((k) => [k.name, k.start, k.end]), [['a', 0, 3], ['b', 4, 6], ['c', 7, 7]]);
});

test('removeProjectTable removes exactly the table lines, keeps the blank separator and CRLF endings', () => {
  const text = "a = 1\r\n\r\n[projects.'/gone']\r\ntrust_level = \"trusted\"\r\napi_key = \"S3\"\r\n\r\n[projects.'/keep']\r\ntrust_level = \"trusted\"\r\n";
  const r = removeProjectTable(text, '/gone');
  assert.equal(r.text, "a = 1\r\n\r\n\r\n[projects.'/keep']\r\ntrust_level = \"trusted\"\r\n");
  assert.deepEqual(r.removed, ["[projects.'/gone']", 'trust_level = "trusted"', 'api_key = ***']);
  assert.equal(removeProjectTable(text, '/nope'), null);
});

test('removeProjectTable handles the last table without a final newline', () => {
  const r = removeProjectTable("a = 1\n[projects.'/g']\ntrust_level = \"t\"", '/g');
  assert.equal(r.text, 'a = 1\n');
});

test('isDenied: credentials, env files and the Codex secret locations; readGuarded refuses them', () => {
  const { home } = fakeCodex();
  for (const f of ['auth.json', 'secrets/token.txt', '.sandbox-secrets/k', '.env']) {
    assert.equal(isDenied(path.join(home, f), home), true, f);
    assert.throws(() => readGuarded(path.join(home, f), { codexHome: home }), { code: 'EDENIED' });
  }
  const d = tmpDir();
  write(path.join(d, '.credentials.json'), CANARY.claudeToken);
  write(path.join(d, '.env.local'), CANARY.envFile);
  assert.throws(() => readGuarded(path.join(d, '.credentials.json')), { code: 'EDENIED' });
  assert.throws(() => readGuarded(path.join(d, '.env.local')), { code: 'EDENIED' });
  assert.equal(isDenied(path.join(home, 'config.toml'), home), false);
  assert.throws(() => readGuarded(path.join(home, 'config.toml'), { maxBytes: 5 }), { code: 'ETOOLARGE' });
});

test('readConfig: detail lists (settings, plugins, MCP servers, hook states) hold names and flags only', () => {
  const { config, liveHook, goneHook } = fakeCodex();
  const c = readConfig(fs.readFileSync(config, 'utf8'));
  assert.deepEqual(c.settings.map((s) => [s.key, s.value]), [
    ['model', 'gpt-5-codex'], ['model_reasoning_effort', 'high'], ['approval_policy', 'on-request'], ['sandbox_mode', 'workspace-write'],
    ['service_tier', 'fast'], ['approvals_reviewer', 'user'], ['default_subagent_model', 'gpt-5-mini'], ['default_subagent_reasoning_effort', 'low'],
    ['max_concurrent_threads_per_session', 4], ['mcp_optional_startup_grace_ms', 3000],
  ]);
  assert.deepEqual(c.pluginList, [{ name: 'a', marketplace: 'b', enabled: true }, { name: 'c', marketplace: 'd', enabled: false }]);
  assert.deepEqual(c.mcpList, [
    { name: 'x', enabled: true, transport: 'command', hasEnv: true, startupTimeoutSec: 30, toolTimeoutSec: 120.5 },
    { name: 'y', enabled: true, transport: 'url', hasEnv: false, startupTimeoutSec: null, toolTimeoutSec: null },
    { name: 'z', enabled: true, transport: null, hasEnv: false, startupTimeoutSec: null, toolTimeoutSec: null },
    { name: 'w', enabled: false, transport: 'command', hasEnv: false, startupTimeoutSec: null, toolTimeoutSec: null },
  ]);
  assert.deepEqual(c.mcpServers, { total: 4, enabled: 3 });
  assert.deepEqual(c.hookList, [
    { key: `${liveHook}:pre_tool_use:0:0`, enabled: true },
    { key: `${goneHook}:post_tool_use:0:1`, enabled: false },
  ]);
  const json = JSON.stringify(c);
  for (const v of Object.values(CANARY)) assert.ok(!json.includes(v), v);
  assert.ok(!json.includes('sha256:'), 'trusted_hash is never read');
});

test('readConfig: an MCP server without enabled is on; an env table alone is no server; settings are not taken from secret-holding tables', () => {
  const c = readConfig('[mcp_servers.a]\ncommand = "x"\n[mcp_servers.ghost.env]\nK = "v"\n[mcp_servers.a.env]\nmodel = "from-env"\n[agents]\nmodel = "from-agents"\n');
  assert.deepEqual(c.mcpList.map((s) => [s.name, s.enabled, s.hasEnv]), [['a', true, true]]);
  assert.equal(c.settings.find((s) => s.key === 'model').value, 'from-agents');
});

test('removeTable matches every header part: a hook state key with colons and backslashes', () => {
  const key = String.raw`C:\Users\me\hooks.json:pre_tool_use:0:0`;
  assert.equal(key.split('\\').length, 4); // the backslashes are really there
  const text = `a = 1\n\n[hooks.state]\n\n[hooks.state.'${key}']\nenabled = true\ntrusted_hash = "h"\n\n[hooks.state.'other']\nenabled = true\n`;
  const r = removeTable(text, ['hooks', 'state', key]);
  assert.equal(r.text, "a = 1\n\n[hooks.state]\n\n\n[hooks.state.'other']\nenabled = true\n");
  assert.deepEqual(r.removed, [`[hooks.state.'${key}']`, 'enabled = true', 'trusted_hash = "h"']);
  assert.equal(removeTable(text, ['hooks', 'state']).removed[0], '[hooks.state]'); // parts must match exactly, the parent table is its own table
  assert.equal(removeTable(text, ['hooks']), null);
});
