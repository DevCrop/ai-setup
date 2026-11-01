import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { test } from 'node:test';
import { X10AgentDesktopState } from '../core/checks/x10-agent-desktop-state.js';
import { X9CodexSetup } from '../core/checks/x9-codex-setup.js';
import { readCodexSetup, readSharedAgentDesktop, traceStateDir } from '../core/sources/codex-setup.js';
import { codexRes, NOW, snap, tmpDir, write } from './helpers.mjs';

const fixture = (over = {}) => {
  const base = tmpDir();
  const home = path.join(base, 'home', '.codex');
  const env = { LOCALAPPDATA: path.join(base, 'local'), XDG_STATE_HOME: path.join(base, 'local') };
  const dir = traceStateDir(home, { env, homedir: path.join(base, 'home') });
  write(path.join(dir, 'installed.json'), JSON.stringify({ version: '1.3.5', applied_at: '2026-10-26T11:15:17Z', original_config: 'SECRET_CONFIG_COPY', home, ...over.installed }));
  write(path.join(dir, 'routine-review.json'), JSON.stringify({ current_deployment: { version: '1.3.4' }, last_verification: { checked_at: '2026-10-20T00:00:00Z', scope: 'FREE_TEXT' }, software_updates: { status: 'attention', outcomes: { x: 'FREE_TEXT' } }, ...over.routine }));
  return { home, dir, env, homedir: path.join(base, 'home') };
};

test('traceStateDir: the same folder codex-setup computes for a home', () => {
  const home = path.resolve('some-home/.codex');
  const want = crypto.createHash('sha256').update(home).digest('hex').slice(0, 16);
  assert.equal(path.basename(traceStateDir(home, { env: { LOCALAPPDATA: 'L' }, platform: 'win32' })), want);
  assert.ok(traceStateDir(home, { env: { LOCALAPPDATA: 'L' }, platform: 'win32' }).includes(path.join('L', 'TRACE-Setup')));
  assert.ok(traceStateDir(home, { platform: 'darwin', homedir: 'H' }).includes(path.join('H', 'Library', 'Application Support', 'TRACE-Setup')));
});

test('readCodexSetup: allow-listed fields only, never the config copy or free text', () => {
  const { home, env, homedir } = fixture();
  const r = readCodexSetup(home, { env, homedir });
  assert.deepEqual(r, { found: true, version: '1.3.5', appliedAt: '2026-10-26T11:15:17Z', recordedVersion: '1.3.4', verifiedAt: '2026-10-20T00:00:00Z', softwareStatus: 'attention', agentDesktop: null });
  assert.ok(!JSON.stringify(r).includes('SECRET_CONFIG_COPY'));
  assert.ok(!JSON.stringify(r).includes('FREE_TEXT'));
});

test('readCodexSetup: agent-desktop component, and a PC without the tool', () => {
  const { home, dir, env, homedir } = fixture();
  const part = path.join(dir, 'components', 'agent-desktop');
  write(path.join(part, 'installed.json'), JSON.stringify({ version: '1.1.0' }));
  write(path.join(part, 'runtime.json'), JSON.stringify({ version: '1.0.2', sha256: 'abc' }));
  write(path.join(part, 'acceptance.json'), JSON.stringify({ completed_at: '2026-11-01T11:36:56Z' }));
  assert.deepEqual(readCodexSetup(home, { env, homedir }).agentDesktop, { version: '1.1.0', runtimeVersion: '1.0.2', acceptedAt: '2026-11-01T11:36:56Z' });
  assert.deepEqual(readCodexSetup(path.join(homedir, 'other'), { env, homedir }), { found: false });
});

test('readCodexSetup: a broken receipt is treated as not found, never a throw', () => {
  const { home, dir, env, homedir } = fixture();
  write(path.join(dir, 'installed.json'), '{nope');
  assert.deepEqual(readCodexSetup(home, { env, homedir }), { found: false });
});

test('readSharedAgentDesktop: finds the shim and its version, and where the state folder is', () => {
  const base = tmpDir();
  const homedir = path.join(base, 'home');
  const bin = path.join(base, 'npm');
  write(path.join(bin, 'agent-desktop.cmd'), '');
  write(path.join(bin, 'node_modules', 'agent-desktop', 'package.json'), '{"version":"1.0.2"}');
  const at = (extra) => readSharedAgentDesktop({ env: { PATH: bin, ...extra }, platform: 'win32', homedir });
  assert.deepEqual(at({}), { installed: true, version: '1.0.2', stateInProfile: true });
  assert.equal(at({ AGENT_DESKTOP_HOME: path.join(base, 'elsewhere') }).stateInProfile, false);
  assert.equal(at({ AGENT_DESKTOP_HOME: path.join(homedir, 'x') }).stateInProfile, true);
  assert.equal(readSharedAgentDesktop({ env: { PATH: path.join(base, 'none') }, platform: 'win32', homedir }).installed, false);
});

const withData = (data) => snap({ codex: codexRes(data), ctx: { now: NOW } });

test('X9: reports what the owner recorded and says who fixes it; silent without the tool', () => {
  const setup = { found: true, version: '1.3.5', recordedVersion: '1.3.4', softwareStatus: 'attention', verifiedAt: new Date(NOW - 15 * 86400000).toISOString() };
  const out = new X9CodexSetup().run(withData({ setup }));
  assert.deepEqual(out.map((f) => f.id), ['X9:version', 'X9:software', 'X9:stale']);
  assert.ok(out.every((f) => f.severity === 'info' && f.detail.includes('setup.py verify')));
  assert.deepEqual(new X9CodexSetup().run(withData({ setup: { ...setup, recordedVersion: '1.3.5', softwareStatus: 'ok', verifiedAt: new Date(NOW).toISOString() } })), []);
  assert.deepEqual(new X9CodexSetup().run(withData({ setup: { found: false } })), []);
  assert.deepEqual(new X9CodexSetup().run(withData({})), []);
});

test('X10: warns only for an installed copy whose state folder is in the profile', () => {
  const run = (sharedAgentDesktop) => new X10AgentDesktopState().run(withData({ sharedAgentDesktop }));
  assert.equal(run({ installed: true, stateInProfile: true })[0].severity, 'warn');
  assert.deepEqual(run({ installed: true, stateInProfile: false }), []);
  assert.deepEqual(run({ installed: false, stateInProfile: true }), []);
});
