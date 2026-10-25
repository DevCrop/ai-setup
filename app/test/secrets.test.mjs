import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { FixJournal } from '../core/fix-journal.js';
import { MonitorService } from '../core/monitor-service.js';
import { Optimizer } from '../core/optimizer.js';
import { Snapshot } from '../core/snapshot.js';
import { ClaudeSource } from '../core/sources/claude-source.js';
import { CodexSource } from '../core/sources/codex-source.js';
import { CANARY, NOW, fakeClock, fakeCodex, fullClaude, tmpDir, write } from './helpers.mjs';

// Canary values sit in config.toml keys (api_key, access_token, client_secret, password, notify, MCP args and url, GITHUB_PAT in an env table),
// in auth.json, secrets/, .sandbox-secrets/, .env, session, agent and skill files, and in the Claude settings.json / .credentials.json.
test('no canary value reaches any snapshot, finding, diff, status or written file', async () => {
  const codex = fakeCodex();
  const claudeHome = tmpDir();
  const repo = tmpDir();
  write(path.join(claudeHome, 'settings.json'), JSON.stringify({ model: 'x', effortLevel: 'high', apiToken: CANARY.claudeToken, env: { TOKEN: CANARY.claudeToken }, hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: `bash ~/.claude/hooks/cm-no-such-hook.sh --token=${CANARY.claudeToken}` }] }] } }));
  write(path.join(claudeHome, '.credentials.json'), CANARY.claudeToken);
  write(path.join(repo, 'claude', 'settings.json'), JSON.stringify({ model: 'y' }));
  const drift = [{ path: 'agents/a.md', kind: 'differs' }];
  const claude = new ClaudeSource({ collectFn: async () => fullClaude({ setup: { status: 'warn', drift, driftCount: 1 }, plugins: { status: 'warn' } }) });
  const homes = { claude: claudeHome, codex: codex.home };

  const ctx = { now: NOW, homes, repo, env: { GH_TOKEN: CANARY.githubPat }, cache: new Map(), refreshSec: 10 };
  const sources = { claude: await claude.collect(ctx), codex: await new CodexSource().collect(ctx) };
  const snapshot = new Snapshot({ generatedAt: new Date(NOW).toISOString(), sources, ctx: { repo, homes } });
  const runner = async () => ({ code: 0, stdout: 'would copy\n', stderr: '' });
  const optimizer = new Optimizer({ deps: { runner } });
  const findings = optimizer.run(snapshot);
  assert.ok(findings.some((f) => f.id === 'C5:hook-scripts') && findings.some((f) => f.id === 'C4:live-only'), 'C4 and C5 findings exist');
  assert.ok(findings.some((f) => f.id === 'C1:drift') && findings.some((f) => f.id.startsWith('X1:')) && findings.some((f) => f.id.startsWith('X4:')), 'fixtures produce every fixable finding');

  const out = [JSON.stringify(snapshot), JSON.stringify(optimizer.list()), JSON.stringify(findings.map((f) => ({ ...f, fix: f.fix?.id })))];
  for (const f of findings) if (f.fix) out.push(JSON.stringify(await optimizer.preview(f.id)));

  const outDir = path.join(tmpDir(), 'out');
  const svc = new MonitorService({ outDir, homes, repo, env: ctx.env, sources: [claude, new CodexSource()], optimizer: new Optimizer({ deps: { runner } }), journal: new FixJournal({ file: path.join(outDir, 'fix-journal.json') }), clock: fakeClock() });
  await svc.refreshNow();
  const x1 = svc.optimizer.list().find((f) => f.id.startsWith('X1:'));
  await svc.optimizer.apply(x1.id, (await svc.optimizer.preview(x1.id)).previewId);
  assert.equal(svc.history().length, 1);
  out.push(JSON.stringify(svc.history()), svc.summaryText());
  assert.match(svc.summaryText(), /\[주의\]/);
  out.push(JSON.stringify(svc.status()));
  const detail = svc.codexDetail();
  out.push(JSON.stringify(detail));
  assert.ok(detail.mcpServers.length === 4 && detail.mcpServers[0].hasEnv && detail.agents.length === 1 && detail.hooks.total === 2, 'the detail payload is filled, so the canary check below means something');
  for (const n of fs.readdirSync(outDir)) out.push(fs.readFileSync(path.join(outDir, n), 'utf8'));

  const all = out.join('\n');
  for (const [name, value] of Object.entries(CANARY)) assert.ok(!all.includes(value), `${name} leaked`);
  assert.ok(all.includes('gpt-5-codex'), 'allowlisted values are still returned');
});
