// Shared test helpers. Everything lives in temp dirs; nothing here touches the real home.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after } from 'node:test';
import { Snapshot } from '../core/snapshot.js';

export const CANARY = Object.freeze({
  apiKey: 'CANARY_API_KEY_9f3a',
  accessToken: 'CANARY_ACCESS_TOKEN_9f3a',
  clientSecret: 'CANARY_CLIENT_SECRET_9f3a',
  password: 'CANARY_PASSWORD_9f3a',
  projectKey: 'CANARY_PROJECT_KEY_9f3a',
  githubPat: 'CANARY_GITHUB_PAT_9f3a',
  authJson: 'CANARY_AUTH_JSON_9f3a',
  secretsFile: 'CANARY_SECRETS_FILE_9f3a',
  sandboxSecret: 'CANARY_SANDBOX_SECRET_9f3a',
  envFile: 'CANARY_ENV_FILE_9f3a',
  session: 'CANARY_SESSION_TEXT_9f3a',
  claudeToken: 'CANARY_CLAUDE_TOKEN_9f3a',
  notify: 'CANARY_NOTIFY_9f3a',
  mcpArg: 'CANARY_MCP_ARG_9f3a',
  mcpEnv: 'CANARY_MCP_ENV_9f3a',
  mcpUrl: 'CANARY_MCP_URL_9f3a',
  agentFile: 'CANARY_AGENT_FILE_9f3a',
  skillFile: 'CANARY_SKILL_FILE_9f3a',
});

export function tmpDir(prefix = 'cm-test-') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

export const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return file; };

// Fake ~/.codex. `live` exists, `gone` does not; a table inside a multi-line string must never count as a project.
// Mirrors the real shape: settings at top level and in [agents], plugins, four MCP servers (x has args and env, y a url,
// z neither command nor url, w is off), two hook states (file there / file gone), agents/, skills/, worktrees/, archived_sessions/.
export function fakeCodex({ backups = 3, eol = '\n' } = {}) {
  const home = tmpDir('cm-codex-');
  const live = tmpDir('cm-live-');
  const gone = path.join(os.tmpdir(), `cm-gone-${process.pid}-${Date.now()}`);
  const liveHook = write(path.join(live, 'hooks.json'), '{}');
  const goneHook = path.join(gone, 'hooks.json');
  const lines = [
    'model = "gpt-5-codex"', 'model_reasoning_effort = "high"', 'approval_policy = "on-request"', 'sandbox_mode = "workspace-write"',
    'service_tier = "fast"', 'approvals_reviewer = "user"', 'mcp_optional_startup_grace_ms = 3000', `notify = ["node", "notify.js", "${CANARY.notify}"]`,
    `api_key = "${CANARY.apiKey}"`, `access_token = "${CANARY.accessToken}"`, `client_secret = "${CANARY.clientSecret}"`, `password = "${CANARY.password}"`,
    'notes = """', "[projects.'/canary/in-a-string']", '"""', '',
    `[projects.'${live}']`, 'trust_level = "trusted"', '',
    `[projects.'${gone}']`, 'trust_level = "trusted"', `api_key = "${CANARY.projectKey}"`, '',
    '[plugins."a@b"]', 'enabled = true', '',
    '[plugins."c@d"]', 'enabled = false', '',
    '[mcp_servers.x]', 'command = "npx"', `args = ["-y", "pkg", "--token=${CANARY.mcpArg}"]`, 'enabled = true', 'startup_timeout_sec = 30', 'tool_timeout_sec = 120.5', '',
    '[mcp_servers.x.env]', `GITHUB_PAT = "${CANARY.githubPat}"`, `OTHER = "${CANARY.mcpEnv}"`, '',
    '[mcp_servers.y]', `url = "https://example.test/mcp?x=${CANARY.mcpUrl}"`, '',
    '[mcp_servers.z]', 'enabled = true', '',
    '[mcp_servers.w]', 'command = "off"', 'enabled = false', '',
    '[hooks.state]', '',
    `[hooks.state.'${liveHook}:pre_tool_use:0:0']`, 'enabled = true', 'trusted_hash = "sha256:aaa"', '',
    `[hooks.state.'${goneHook}:post_tool_use:0:1']`, 'enabled = false', 'trusted_hash = "sha256:bbb"', '',
    '[agents]', 'default_subagent_model = "gpt-5-mini"', 'default_subagent_reasoning_effort = "low"', 'max_concurrent_threads_per_session = 4', '',
  ];
  const config = write(path.join(home, 'config.toml'), lines.join(eol));
  for (let i = 0; i < backups; i++) write(path.join(home, `config.toml.bak${i || ''}`), 'x');
  write(path.join(home, 'logs_1.sqlite'), 'stub');
  write(path.join(home, 'auth.json'), CANARY.authJson);
  write(path.join(home, 'secrets', 'token.txt'), CANARY.secretsFile);
  write(path.join(home, '.sandbox-secrets', 'k'), CANARY.sandboxSecret);
  write(path.join(home, '.env'), CANARY.envFile);
  // complete lines, so the usage scan really parses this file and the canary checks prove the text is dropped
  write(path.join(home, 'sessions', '2026', '10', '25', 'rollout-2026-10-25T10-00-00-a.jsonl'), [
    { timestamp: new Date(2026, 9, 25, 10).toISOString(), type: 'session_meta', payload: { cwd: '/w/alpha', base_instructions: { text: CANARY.session } } },
    { timestamp: new Date(2026, 9, 25, 11).toISOString(), type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 } } } },
  ].map((l) => JSON.stringify(l)).join('\n') + '\n');
  write(path.join(home, 'sessions', '2026', '10', '24', 'rollout-2026-10-24T10-00-00-b.jsonl'), CANARY.session);
  write(path.join(home, 'sessions', '2025', '01', '02', 'rollout-2025-01-02T10-00-00-c.jsonl'), CANARY.session);
  write(path.join(home, 'agents', 'explorer.toml'), CANARY.agentFile);
  write(path.join(home, 'agents', 'AGENTS.md'), 'agents md');
  write(path.join(home, 'skills', 'alpha', 'SKILL.md'), CANARY.skillFile);
  write(path.join(home, 'skills', 'beta', 'x.txt'), CANARY.skillFile);
  write(path.join(home, 'archived_sessions', 'rollout-2026-01-01T00-00-00-d.jsonl.zst'), CANARY.session);
  // one worktree 40 days old and one a day old, relative to NOW
  for (const [name, days] of [['old-1', 40], ['new-1', 1]]) {
    const dir = path.join(home, 'worktrees', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.utimesSync(dir, new Date(NOW - days * 86400000), new Date(NOW - days * 86400000));
  }
  return { home, config, live, gone, liveHook, goneHook };
}

export const NOW = new Date(2026, 9, 25, 12, 0, 0).getTime();

export const snap = ({ claude, codex, ctx = {} } = {}) => new Snapshot({
  generatedAt: new Date(NOW).toISOString(),
  sources: { ...(claude ? { claude } : {}), ...(codex ? { codex } : {}) },
  ctx,
});
export const claudeRes = (data, status = 'ok') => ({ status, note: '', data });
export const codexRes = (data, status = 'ok') => ({ status, note: '', data });

export const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };

export function fakeClock(start = NOW) {
  let now = start;
  let id = 0;
  const timers = new Map();
  const add = (f, ms, every) => { const t = ++id; timers.set(t, { f, ms, due: now + ms, every }); return t; };
  return {
    now: () => now,
    setInterval: (f, ms) => add(f, ms, true),
    clearInterval: (t) => timers.delete(t),
    setTimeout: (f, ms) => add(f, ms, false),
    clearTimeout: (t) => timers.delete(t),
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
        if (!due) break;
        const [t, timer] = due;
        now = Math.max(now, timer.due);
        if (timer.every) timer.due += timer.ms; else timers.delete(t);
        timer.f();
        await flush();
      }
      now = end;
      await flush();
    },
    timerCount: () => timers.size,
  };
}

export const fullClaude = (over = {}) => ({
  generatedAt: new Date(NOW).toISOString(), refreshSec: 10,
  routing: { status: 'ok', agents: [] }, tokens: { status: 'ok', days: [], totals: null },
  rtk: { status: 'ok' }, plugins: { status: 'ok', items: [] }, claudeMem: { status: 'ok', reachable: true },
  hooks: { status: 'ok', items: [] }, savings: { status: 'ok' }, orchestration: { status: 'ok', sessions: [] },
  setup: { status: 'ok', drift: [], driftCount: 0 }, liveOnlyKeys: [],
  summary: { status: 'ok', routing: { ok: 1, total: 2 }, live: { sessions: 1, agents: 2 }, todayOutput: 5, cacheHit7d: 0.5, claudeMem: true, issues: [] },
  ...over,
});
