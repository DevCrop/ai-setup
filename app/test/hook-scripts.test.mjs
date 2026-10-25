import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { C5MissingHookScript } from '../core/checks/c5-missing-hook-script.js';
import { expandScript, findMissingHookScripts, scriptToken } from '../core/hook-scripts.js';
import { ClaudeSource } from '../core/sources/claude-source.js';
import { CANARY, NOW, claudeRes, fullClaude, snap, tmpDir, write } from './helpers.mjs';

const hook = (command, extra = {}) => ({ matcher: '*', hooks: [{ type: 'command', command, ...extra }] });

function fixture() {
  const home = tmpDir('cm-home-');
  const claudeHome = path.join(home, '.claude');
  const repo = tmpDir('cm-repo-');
  write(path.join(claudeHome, 'hooks', 'there.sh'), '#!/bin/sh');
  write(path.join(claudeHome, 'settings.json'), JSON.stringify({
    hooks: {
      PreToolUse: [
        hook(`bash ~/.claude/hooks/missing.sh --token=${CANARY.mcpArg}`),
        hook('bash ~/.claude/hooks/there.sh'),
        hook('node "${CLAUDE_CONFIG_DIR}/hooks/gone.js" --x'),
        hook('echo hello'), hook('bash -c "ls"'), hook('node hook.js'), hook('bash ./scripts/rel.sh'), hook('bash $CLAUDE_PROJECT_DIR/x.sh'),
        hook('bash ~/.claude/hooks/missing.sh again'), // same script twice: reported once
        { matcher: '*', hooks: [{ type: 'prompt', command: 'bash ~/.claude/hooks/not-a-command.sh' }] },
      ],
      Stop: [{ command: `python3 ${home.replaceAll('\\', '/')}/tools/stop.py` }], // bare entry, absolute path
      Notification: 'not a list',
    },
  }));
  write(path.join(repo, 'claude', 'settings.json'), JSON.stringify({ hooks: { SessionStart: [hook('bash $HOME/.claude/hooks/repo-missing.sh')] } }));
  return { home, claudeHome, repo };
}

test('scriptToken: first path-like token with a script extension; quotes removed; bare names, other files and no token give null', () => {
  assert.equal(scriptToken('bash ~/.claude/a.sh -x'), '~/.claude/a.sh');
  assert.equal(scriptToken('node "C:\\Users\\me\\h x\\a.mjs" arg'), 'C:\\Users\\me\\h x\\a.mjs');
  assert.equal(scriptToken("python3 '/opt/a b/c.py'"), '/opt/a b/c.py');
  assert.equal(scriptToken('pwsh -File $HOME/h.ps1'), '$HOME/h.ps1');
  for (const none of ['echo hi', 'node hook.js', 'cat ~/.claude/notes.txt', 'bash -c "ls"', '']) assert.equal(scriptToken(none), null, none);
});

test('expandScript: ~, $HOME, ${HOME}, CLAUDE_CONFIG_DIR expand; other variables and relative paths give null', () => {
  const o = { home: path.resolve('/h'), claudeHome: path.resolve('/h/.claude') };
  assert.equal(expandScript('~/x.sh', o), path.normalize(`${o.home}/x.sh`));
  assert.equal(expandScript('$HOME/x.sh', o), path.normalize(`${o.home}/x.sh`));
  assert.equal(expandScript('${HOME}/x.sh', o), path.normalize(`${o.home}/x.sh`));
  assert.equal(expandScript('${CLAUDE_CONFIG_DIR}/x.sh', o), path.normalize(`${o.claudeHome}/x.sh`));
  assert.equal(expandScript('$CLAUDE_CONFIG_DIR/x.sh', o), path.normalize(`${o.claudeHome}/x.sh`));
  for (const none of ['$CLAUDE_PROJECT_DIR/x.sh', './x.sh', 'scripts/x.sh', '%USERPROFILE%/x.sh']) assert.equal(expandScript(none, o), null, none);
});

test('findMissingHookScripts: live and repo files, only missing scripts, event and path only (home shown as ~), the command text never leaves', () => {
  const { home, claudeHome, repo } = fixture();
  const r = findMissingHookScripts([{ scope: 'live', file: path.join(claudeHome, 'settings.json') }, { scope: 'repo', file: path.join(repo, 'claude', 'settings.json') }, { scope: 'live', file: path.join(home, 'no-such.json') }], { home, claudeHome });
  assert.deepEqual(r, [
    { scope: 'live', event: 'PreToolUse', path: '~/.claude/hooks/missing.sh' },
    { scope: 'live', event: 'PreToolUse', path: '~/.claude/hooks/gone.js' },
    { scope: 'live', event: 'Stop', path: '~/tools/stop.py' },
    { scope: 'repo', event: 'SessionStart', path: '~/.claude/hooks/repo-missing.sh' },
  ]);
  assert.ok(!JSON.stringify(r).includes(CANARY.mcpArg));
});

test('C5: one warn finding without a fix; evidence is scope, event and path; no command text; nothing missing gives nothing', () => {
  const list = [{ scope: 'live', event: 'PreToolUse', path: '~/.claude/hooks/missing.sh' }, { scope: 'repo', event: 'Stop', path: '~/x.py' }];
  const [f] = new C5MissingHookScript().run(snap({ claude: claudeRes(fullClaude({ missingHookScripts: list })) }));
  assert.equal(f.id, 'C5:hook-scripts');
  assert.equal(f.severity, 'warn');
  assert.equal(f.fix, null);
  assert.equal(f.toDto().fixable, false);
  assert.deepEqual(f.evidence, ['라이브 PreToolUse: ~/.claude/hooks/missing.sh', '저장소 Stop: ~/x.py']);
  assert.match(f.detail, /스크립트/);
  assert.deepEqual(new C5MissingHookScript().run(snap({ claude: claudeRes(fullClaude()) })), []);
  assert.deepEqual(new C5MissingHookScript().run(snap({ claude: claudeRes(fullClaude({ missingHookScripts: [] })) })), []);
});

test('ClaudeSource puts missingHookScripts (paths only) into the data; the canary in a command line stays out', async () => {
  const { home, claudeHome, repo } = fixture();
  const src = new ClaudeSource({ collectFn: async () => fullClaude() });
  const r = await src.collect({ now: NOW, homes: { claude: claudeHome }, repo, env: { HOME: home }, cache: new Map(), refreshSec: 10 });
  assert.equal(r.data.missingHookScripts.length, 4);
  assert.ok(!JSON.stringify(r).includes(CANARY.mcpArg));
  const [f] = new C5MissingHookScript().run(snap({ claude: r }));
  assert.equal(f.evidence.length, 4);
  assert.ok(f.evidence.every((e) => !e.includes('--token') && !e.includes('bash ')));
});
