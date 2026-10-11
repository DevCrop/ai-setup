# Setup guide

End-to-end order for a machine and a project. Sources: Claude Code docs (best-practices, memory, skills, plugins, permissions). Decisions and history: `docs/NEXT-MACHINE.md`.

## Quick path (new machine, about 15 minutes)

Run in order; each line says what proves it worked. Prerequisites and details are in sections 0 and 1.

| # | Command | Done when |
|---|---|---|
| 1 | `git clone https://github.com/DevCrop/claude-global.git && cd claude-global` | `git log -1` prints a commit |
| 2 | `bash scripts/apply.sh` | prints `applied: ...`; backup folder `~/.claude-backup-<time>` exists |
| 3 | `claude plugin marketplace add DietrichGebert/ponytail && claude plugin install ponytail@ponytail` | `claude plugin list` shows ponytail enabled |
| 4 | claude-mem (below): `claude plugin marketplace add thedotmack/claude-mem && claude plugin install claude-mem@thedotmack`, open one Claude Code session, then `bash scripts/setup-claude-mem.sh` | script prints `OK` |
| 5 | `bash scripts/verify.sh --live` | `== 0 FAIL, 0 WARN` |
| 6 | `python3 scripts/dashboard/server.py` (optional) | http://127.0.0.1:8787 loads |
| 7 | `bash scripts/qa-ui.sh && bash scripts/qa-dashboard.sh` (optional, needs node 22+ and Chrome or Edge) | both end with `failures: 0` |

Update later: `git pull && bash scripts/apply.sh && bash scripts/verify.sh --live`.

## claude-mem (per machine)

claude-mem keeps a local memory database in `~/.claude-mem`. The plugin entry is in `claude/settings.json` (so `apply.sh` enables it), but the plugin files and its own settings are per machine and are not in this repo.

1. Install the plugin (the official marketplace does not carry it; `thedotmack` is the author's marketplace, a third party):
   ```
   claude plugin marketplace add thedotmack/claude-mem
   claude plugin install claude-mem@thedotmack
   ```
   Do not use `npx claude-mem install` on Windows: `bun install` failed there with `spawn EINVAL` and left a half install.
2. Open one Claude Code session so the worker starts and writes `~/.claude-mem/settings.json`. Check: `curl -s http://127.0.0.1:37777/api/stats` returns JSON.
3. Set the two machine-local values with `bash scripts/setup-claude-mem.sh` (`--check` only reports):
   - `CLAUDE_MEM_MODEL=claude-haiku-5-5`: the observer runs on every session, so it should be the cheap current model (Haiku 5.5 is about 20x cheaper per token than Sonnet 5.5 at list price; the default model on a new install may be an older one).
   - `CLAUDE_MEM_REDACT_ENABLED=true`: off by default; it masks secret-looking text before storage.
   The script backs up the file, changes only these two keys, and is safe to re-run.
4. Leave Cloud Sync, Telegram and server keys empty unless you decide otherwise. The default provider uses your Claude subscription, so the observer spends plan limit; a past `quota_exhausted` entry in `~/.claude-mem/observer-health.json` is how that shows up.
5. Check: `curl -s http://127.0.0.1:37777/api/settings` shows both values, and the dashboard "도구 점검" panel lists claude-mem items as OK. Review notes and risks: `docs/review-claude-mem.md`.

## Layers

| Layer | What | Where |
|---|---|---|
| Always on, every machine | RTK hook, Ponytail plugin, permissions (deny and ask rules, default mode auto with an `autoMode` block), `secret-guard` hook, short global `CLAUDE.md`, status line, agents `explorer` `reviewer` `worker` `publisher` `frontend` `backend` `qa`, daily routine | this repo, applied to `~/.claude` |
| On demand | skill `orchestrate` (description match, or `/orchestrate`), skills `spec-writing` and `design-spec` (planning and design in the main thread), skill `project-setup` (manual, `/project-setup`), AO as an external app | skills, plugin scope, the user |
| Per project, once | project `CLAUDE.md`, path-scoped rules, verification command, project permissions | the project's `.claude/` |

Superpowers is not adopted (decision 2026-10-11): not at user scope, and no project install is recommended. Remove it from a machine with `claude plugin uninstall superpowers@claude-plugins-official`; `verify.sh --live` warns while it is installed.

## 0. Machine prerequisites (once per machine)

Needed: `git`, `jq` (status line), `node` (Ponytail hooks), `gh`, `rtk`, current Claude Code. On Windows use Git Bash.

```
echo ${CLAUDE_CONFIG_DIR:-$HOME/.claude}
claude --version
command -v rtk jq node gh
```

Done when every command prints a value. No path is hard-coded anywhere; only the clone location of this repo differs per machine.

## 1. Apply the global setup (each machine)

```
git pull
bash scripts/apply.sh            # backs up first, copies the items listed in apply.sh
claude plugin marketplace add DietrichGebert/ponytail
claude plugin install ponytail@ponytail
```

Open a new session (running sessions do not get the plugin), then verify:

```
bash scripts/verify.sh --live    # repo checks + applied files equal claude/ + tools + Ponytail
bash scripts/verify.sh --full    # also runs qa-deny.sh (claude CLI + haiku); run it where RTK is installed
```

Done when `verify.sh --live` prints `0 FAIL`. WARN lines are informational (for example no `.ponytail-active` flag before the first new session). Then spot-check by hand: `rtk gain` total commands grows after a few Bash calls, the status line shows `[model] N% context`, `/context` lists the global `CLAUDE.md`, and `claude plugin details ponytail` shows its always-on token cost.

A machine-local `env` block in the live `settings.json` (for example `CLAUDE_CODE_TMPDIR`) is kept by `apply.sh` and ignored by `verify.sh`; the repo copy has no `env`.

Undo: copy files back from `~/.claude-backup-<timestamp>/`.

## 2. Bootstrap a project (once, before the first task)

Run `/project-setup` in the project directory (manual-only skill). It reads manifests, CI workflows and lint configs, finds the verification command per area, and proposes `CLAUDE.md`, `.claude/rules/*.md` and `.claude/settings.json` as files for you to approve. It installs nothing and invents no commands; what it cannot confirm is listed under "Not verified". In auto mode a write may not prompt at all (the classifier decides), so the skill's own step 10 (an explicit yes in chat) is the approval.

What to check afterwards:
1. `CLAUDE.md` is under 200 lines and every line would cause a mistake if removed (`/doctor` proposes cuts).
2. The verification commands are the ones CI or the scripts really run. For markup and CSS with no automated check, decide on a screenshot comparison or a lint and write it down; without a check Claude can run, "done" is only its own opinion.
3. Path-scoped rules use the documented frontmatter, a YAML `paths:` list (the only field Claude Code reads in a rule).
4. Permissions: `deny` repeats the global `.env*` and credentials rules on purpose (cloud sessions and teammates do not read `~/.claude`); `allow` lists only read-only check commands and, in auto mode, narrow allow rules still apply while broad ones are suspended; each Bash rule has its `rtk ` twin where RTK is installed. No `defaultMode`.
   Also pick how hard the check gates the work (prompt line, `/goal`, Stop hook, reviewer subagent; the skill asks) and add `CLAUDE.local.md` and `.claude/settings.local.json` to the project `.gitignore`.
   Projects that share `AGENTS.md` with Codex: `AGENTS.md` stays the source and the skill never edits it. With no `CLAUDE.md`, Claude Code reads `AGENTS.md` itself, so the skill adds only `.claude/` files; a `CLAUDE.md` it creates must start with `@AGENTS.md` (a `CLAUDE.md` without the import makes Claude stop reading `AGENTS.md`; use the import, not a symlink, on Windows).
5. In a new session: `/context` shows the project `CLAUDE.md`, `/hooks` lists only intended hooks.

## 3. Per task

| Work | Flow |
|---|---|
| Markup, small fix | Ask directly, verify with the check, commit |
| Bug | Give symptom, location and what "fixed" means; reproduce with a failing check; fix; verify |
| Feature, medium | Plan mode (Shift+Tab), approve the plan, implement, verify |
| Feature, large | Let Claude interview you (`AskUserQuestion`), write `SPEC.md`, implement in a fresh session |
| Review | Fresh-context `reviewer` or `/code-review`; only findings that affect correctness or the stated requirements |
| Parallel | Git worktrees; AO is optional. Workers per non-overlapping file area with tests as the done criterion, then an AO review per PR; measured once on a disposable repo (`docs/NEXT-MACHINE.md`, "AO QA 실측") |

Habits: `/clear` between unrelated tasks; after two failed corrections on one issue, `/clear` and restate the task; `/rewind` to undo; changes go through a branch and a PR and a person merges.

## 4. Daily routine and maintenance

- The routine `daily-claude-update` runs `claude --version`, the changelog, `scripts/verify.sh --live`, and `scripts/docs-watch.sh` (thirteen official docs pages this setup depends on, plus two platform pages), then writes `reports/YYYY-MM-DD.md` and proposes changes. It only reads and reports. Steps live in `claude/routines/daily-update.md` and are read from the clone, so `git pull` updates them.
- On each machine create the scheduled task in the app once, from the pointer body in `claude/scheduled-tasks/daily-claude-update/SKILL.md` (replace `<repo>` with that machine's clone path). If the app still holds the older body with the full list of steps, replace it with the pointer body.
- Monthly: `/doctor` on `CLAUDE.md`, skills and agents.
- After any change to permissions or hooks: `bash scripts/verify.sh --full` on every machine where RTK is installed.
- Edit `claude/` in this repo, never `~/.claude` directly.

## Live dashboard

`python3 scripts/dashboard/server.py` serves http://127.0.0.1:8787 (local only, standard library, `--port N` to change). Nine tabs: monitoring, errors and debugging, orchestration (delegation flow), model routing, features, tool efficiency (RTK, claude-mem, AO, models; every number labelled measured, estimated or unavailable), practice checks (against the official docs), log and fixes, project setup. State refreshes every 3 seconds from the newest session log in `~/.claude/projects` (tool names, times and file basenames only, never message text), `verify.sh --live` (at most once a minute), PR history, and the AO CLI if found (`AO_BIN`, the default Windows path, or `ao` on PATH; read-only). Fixes (prune backups, turn on claude-mem redaction, update RTK) run only from a server allow-list after a confirm dialog.

- Code: Python modules in `scripts/dashboard/` (`procs.py` is the only place a process starts, hidden on Windows), UI as ES modules in `scripts/dashboard/ui/` (a screen is a `Tab` subclass in `ui/tabs/`, built from `ui/components.js`).
- Project list: `state/projects.txt` or `PROJECT_DIRS` (one path per line); with neither, it uses folders recorded in session logs, skipping temp and worktree paths.
- Autostart is a per-machine choice, not in the repo. Windows: a `.vbs` in the Startup folder that runs `pythonw scripts/dashboard/server.py` hidden (see the last section of `docs/NEXT-MACHINE.md`). macOS and Linux: not tried; any login-time launcher works.
- Checks: `bash scripts/qa-dashboard.sh` (API, security, static files), `bash scripts/qa-ui.sh` (headless Chrome: every tab, three widths, palette, dialogs, flow lines, live update, offline and recovery; needs node 22+).
- Not measured: macOS and Linux runs, and sessions that run on another machine.

## Permission mode: auto (decision 2026-10-11)

The default mode is `auto`, the mode the permission-modes doc recommends for working without prompts; `bypassPermissions` is documented for isolated containers and VMs only, so it is not used here (it replaces the 2026-10-10 decision). In auto mode a classifier reviews actions that no rule already decided. It blocks force pushes, `reset --hard`, `clean -fd`, irreversible deletes, secrets in commits, credential output and prompt-injection-driven actions by default, and it reads `CLAUDE.md`.

Two layers, on purpose:
- **Deterministic:** `permissions.deny` blocks in every mode; `permissions.ask` always prompts, even in auto mode; the `secret-guard` hook blocks staging secret files. These do not depend on a model.
- **Classifier:** the `autoMode` block in `claude/settings.json` adds this setup's context (`environment`), a plugin-install rule (`soft_deny`) and a secret-file rule (`hard_deny`). Every array starts with `"$defaults"`; without it the built-in rules for that array are dropped. `permissions.allow` stays empty (broad allow rules are suspended in auto mode anyway).

Rules of use:
- `defaultMode: "auto"` and `autoMode` take effect only from user settings (`~/.claude/settings.json`, written by `apply.sh`), not from a project `.claude/settings.json`. Needs Claude Code 2.1.295 or newer; `verify.sh --live` fails below that.
- This repo owns the permission and `autoMode` settings. Do not change them with `/permissions` or `/auto-mode-setup` (the second is switched off by `skillOverrides`): edit `claude/settings.json`, then run `bash scripts/apply.sh`.
- If the classifier blocks something it should allow: open `/permissions`, **Recently denied**, read the rule name in brackets, then add an `environment` or `allow` entry (keep `"$defaults"`) in `claude/settings.json` and apply. `claude auto-mode critique` reviews custom entries. After 3 blocks in a row or 20 in total, auto mode pauses and Claude Code goes back to prompting. In `-p` runs a blocked action is skipped and the run continues.
- If auto mode is not available (turned off for the account or server side), sessions start in Manual mode; the deny, ask and hook layer still works. Classifier calls count toward token usage on some plans (permission-modes doc).
- VS Code: `claudeCode.initialPermissionMode` does not accept `auto`; leave it unset.
- AO workers: `ao project set-config <id> --permission auto` (it replaces the whole config; round-trip `ao project get --json` first). Deny and ask rules apply to workers in every mode.
- Going back to bypass is a decision to record, not a setting to flip: change `permissions.defaultMode` and the check in `scripts/verify.sh` in one PR.

## Secret-guard hook

`claude/hooks/secret-guard.sh` runs before every Bash call (PreToolUse; exit 2 blocks, per the hooks doc). Calls without `git` plus `add`, `stage`, `commit` or `push` pass at once. Otherwise it blocks when a secret-looking name would be staged, committed or pushed: `.credentials*`, `.env`, `.env.*`, `.claude.json`, `history.jsonl`, `*.pem`, `id_rsa*`; names ending in `.example`, `.sample`, `.template` and `id_rsa*.pub` are allowed. It also catches an `rtk ` prefix, `-C dir`, `cd dir &&`, quotes, `bash -c`, `git stage` and globals such as `--no-pager`. A blocked call prints the file names; fix it by removing them from the change or adding them to `.gitignore`. To turn it off, remove its entry from `claude/settings.json` in a PR and run `bash scripts/apply.sh`.

Limit: it reads the command text. Aliases, scripts that call git, variables, `xargs`/`find -exec`, paths with spaces, brace expansion, `eval` and pushes of another branch (`git push origin feat`, `--all`; only HEAD and its upstream are judged) are not seen. It also blocks some harmless text: a command whose quoted text or heredoc line contains `git add -A` while a secret-named file is untracked (a reviewer found these on 2026-10-10), and it has no timeout of its own, so a huge repository can make it slow, so it is a guard rail, not a boundary. The daily routine's repository exposure check (step 7b) covers what reaches a public repository anyway. Tests: `bash scripts/qa-hooks.sh` (also run by `verify.sh`).

## AO (Orchestrator.inc) use

Use AO only for parallel work with disjoint file scopes. Set permissions with `ao project set-config <id> --permission ...` (it replaces the whole config: round-trip `ao project get --json` first), put the done criteria and "never push" in `--agent-rules`, and push and merge by hand. Killing a worker session empties its worktree and blocks review, so trigger `ao review trigger` before ending it, or re-register the repository and use `--claim-pr`. Measured behavior and traps: `docs/NEXT-MACHINE.md` section 13.

## Not verified

- Windows Git Bash and macOS behavior of `apply.sh`, `verify.sh`, the plugin hooks and `qa-deny.sh` with the real RTK hook (tested on Linux without RTK).
- The `claude plugin list` output format that `verify.sh` parses for the Ponytail status; a changed format shows up as a WARN, not a false PASS.
- How often `orchestrate` is loaded by description matching (`/orchestrate` is the fallback).
- `secret-guard`: macOS bash 3.2 and BSD `sed`/`tr` behavior, hook latency, and running next to the real RTK hook (checked once with RTK-less project settings: `git add -A` was blocked).
- `project-setup` was dry-run once on a scratch PHP + React project; the interactive approval flow and real projects are untested.

## Deliberately not adopted

Superpowers (any scope), agent teams (experimental), agent view (research preview), hook-based intent detection, a global Stop hook or `/goal` gate (enable per project once it has tests), a daily proposal loop that mines session logs.
