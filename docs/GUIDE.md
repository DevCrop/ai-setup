# Setup guide

End-to-end order for a machine and a project. Sources: Claude Code docs (best-practices, memory, skills, plugins, permissions). This is the runbook for the Claude Code setup and the shared scripts; `codex/` and `ao/` keep their own (`operations.md` in `codex/docs/`, and `ao/README.md`). Why things are the way they are: `docs/DECISIONS.md`; the measurements behind them: `docs/evidence.md`; open work, by priority: `docs/BACKLOG.md`.

## Quick path (new machine, about 15 minutes)

Run in order; each line says what proves it worked. Prerequisites are in section 0, details in section 1, the steps only you can do in the app in section 1b.

| # | Command | Done when |
|---|---|---|
| 1 | `git clone https://github.com/DevCrop/ai-setup.git && cd ai-setup` | `git log -1` prints a commit |
| 1b | `python3 scripts/bootstrap.py check --write` (a bare machine: `powershell -ExecutionPolicy Bypass -File scripts\bootstrap.ps1 check`, which first installs Git and Python if missing). Then, as needed: `bootstrap.py install` (missing tools via winget), `apply` (each setup's own plan, then apply; Claude's plan is `apply.sh --dry-run`), `verify`, `autostart` (dashboard at login). Each step that writes shows what it will do and asks y/N; without a terminal it refuses | `check` ends with `missing required: none`; `verify` prints PASS per setup. `--write` records the found setup checkouts, except a folder of this repo such as `codex/` (and copies the roots from `state/project-roots.txt`; the `~/Projects` default is not written; delete an empty `"projectRoots": []` by hand) in `state/machine.json` |
| 2 | `bash scripts/apply.sh` | prints `applied: ...` and, when the machine differs, what it replaced, kept or removed |
| 3 | Open one Claude Code session and exit (it registers the pinned marketplaces from `settings.json`; `claude plugin marketplace add` cannot), then `claude plugin install ponytail@ponytail` | `claude plugin list` shows ponytail enabled |
| 4 | claude-mem (below): `claude plugin install claude-mem@thedotmack`, open one Claude Code session, then `bash scripts/setup-claude-mem.sh` | script prints `OK` |
| 5 | `bash scripts/verify.sh --live` | `0 FAIL` (a FAIL on `ponytail` means step 3 was skipped or went to another `CLAUDE_CONFIG_DIR`). On a first run these WARN lines are expected: no `.ponytail-active` yet (written by the first new session), no scheduled task yet (manual steps), `rtk` missing if you skipped it, and `config changed outside this repo` if a session was open while a plugin was installed more than 2 minutes after apply |
| 6 | `python3 scripts/dashboard/server.py` (optional) | http://127.0.0.1:8787 loads |
| 7 | `bash scripts/qa-ui.sh && bash scripts/qa-dashboard.sh` (optional, needs node 22+ and Chrome or Edge) | both end with `failures: 0` |

Update later: `git pull && bash scripts/apply.sh && bash scripts/verify.sh --live`. Pins move only through the weekly PR `chore: update pinned versions` (`.github/workflows/updates.yml`, Mondays and by hand; review and merge it like any PR). When a pin in `settings.json` moved to a newer version (the daily report says "update needed"), back up `~/.claude-mem` and run `claude plugin update <id>` in a new session; never when the installed version is newer than the pin. The same PR lists new releases of the unpinned tools (`docs/tool-versions.json`) with their `winget upgrade` command; run those on each PC yourself.

## claude-mem (per machine)

claude-mem keeps a local memory database in `~/.claude-mem`. The plugin entry is in `claude/settings.json` (so `apply.sh` enables it), but the plugin files and its own settings are per machine and are not in this repo.

1. Install the plugin (the official marketplace does not carry it; `thedotmack` is an inline marketplace in `settings.json` pinned to one upstream commit, DECISIONS "Third-party plugins are pinned"; a session must have started once after `apply.sh` so it is registered):
   ```
   claude plugin install claude-mem@thedotmack
   ```
   Do not use `npx claude-mem install` on Windows: its `bun install` fails there with `spawn EINVAL` and leaves a half install.
2. Open one Claude Code session so the worker starts and writes `~/.claude-mem/settings.json`. Check: `curl -s http://127.0.0.1:37777/api/stats` returns JSON.
3. Set the two machine-local values with `bash scripts/setup-claude-mem.sh` (`--check` only reports):
   - `CLAUDE_MEM_MODEL=claude-haiku-5-5`: the observer runs on every session, so it should be the cheap current model (Haiku 5.5 is about 20x cheaper per token than Sonnet 5.5 at list price; the default model on a new install may be an older one).
   - `CLAUDE_MEM_REDACT_ENABLED=true`: off by default; it masks secret-looking text before storage.
   The script backs up the file, changes only these two keys, and is safe to re-run.
4. Leave Cloud Sync, Telegram and server keys empty unless you decide otherwise. The default provider uses your Claude subscription, so the observer spends plan limit; a past `quota_exhausted` entry in `~/.claude-mem/observer-health.json` is how that shows up.
5. Check: `curl -s http://127.0.0.1:37777/api/settings` shows both values, and the dashboard "도구 점검" panel lists claude-mem items as OK (it reads `CLAUDE_MEM_REDACT_ENABLED` and offers the fix "turn on claude-mem redaction" when it is off). Whether the worker picks up a changed value without a restart is not verified: restart the session after the script.

What to know about it:
- Always-on parts: five hooks, a Bun-based local worker (HTTP API and web viewer on `127.0.0.1:37777`), SQLite (`~/.claude-mem/claude-mem.db`) and Chroma (`~/.claude-mem/chroma`).
- A PostToolUse hook captures every tool output. Reading `.env*` and `.credentials*` is denied, but a secret printed by another command can still be stored; redaction masks secret-looking text, and text wrapped in `<private>` tags is not stored. To check what is stored without printing it, count regex matches (API keys, tokens, JWTs, private keys, `key=value`) in `claude-mem.db` rather than reading rows.
- The observer is an LLM call (`provider=claude`, `auth=subscription` by default): it spends plan limit, so the net token effect of the memory is not known (not measured).
- Its own memory overlaps the auto memory, `CLAUDE.md` and the handoff note; injected observations add context at session start.
- Uninstall: stop the `chroma-mcp` process (`--data-dir ~/.claude-mem/chroma`) first, or `~/.claude-mem` cannot be deleted; in PowerShell use `Remove-Item -Recurse -Force`.
- Not verified: deletion and per-project separation procedures, the Cloud Sync transfer scope (not logged in), and a test that redaction masks real secret patterns.

## Layers

| Layer | What | Where |
|---|---|---|
| Always on, every machine | RTK hook, Ponytail plugin, permissions (deny and ask rules, default mode auto with an `autoMode` block), `secret-guard` hook, session hooks `compact-context` and `config-audit`, short global `CLAUDE.md`, status line, agents `explorer` `reviewer` `worker` `publisher` `frontend` `backend` `qa`, daily routine | this repo, applied to `~/.claude` |
| On demand | skill `orchestrate` (description match, or `/orchestrate`), skills `spec-writing` and `design-spec` (planning and design in the main thread), skill `project-setup` (manual, `/project-setup`), skill `ui-baseline` (preloaded into `publisher` and `frontend` when they run; not in the `/` menu), AO as an external app | skills, plugin scope, the user |
| Per project, once | project `CLAUDE.md`, path-scoped rules, verification command, project permissions | the project's `.claude/` |

Superpowers is not adopted (`docs/DECISIONS.md`): not at user scope, and no project install is recommended. Remove it from a machine with `claude plugin uninstall superpowers@claude-plugins-official`; `verify.sh --live` warns while it is installed.

## 0. Machine prerequisites (once per machine)

Needed before the quick path (`python3 scripts/bootstrap.py check` lists all of them with versions and install commands; the list is `tools.json`):
- **Claude Code 2.1.295 or newer**, installed and logged in. Credentials are not in this repo, so every machine logs in itself. Install by the official instructions; `claude --version` must print 2.1.295 or newer (`verify.sh --live` fails below that: auto mode is the built-in starting mode from 2.1.283 per the permission-modes doc, and the hook `onFailure` field needs 2.1.295 per the hooks doc).
- `git` and GitHub access for the clone (the repo is private: `gh auth login` or a credential manager).
- `jq` (required by `apply.sh` and the status line), `python3` (dashboard, QA scripts), `bash` (Git Bash on Windows).
- `rtk` (recommended): `winget install rtk-ai.rtk`. It must be on PATH of the shell that Claude Code uses; after a fresh install open a new terminal or restart the app. Without it Bash still works, only the output filtering is off; `bash scripts/qa-deny.sh` should be run once where it is installed.
- `node` 22 or newer (required in `tools.json`; Ponytail hooks and the UI QA), `gh` (daily routine, optional).
- Adding a tool: one entry in `tools.json`: `id`, `label`, `kind` (`dep` or `tool`), `required`, `bin`; optional `env`, `version`, `min`, `why`, `paths`, `home`, `setup` (needs `repo`, `marker`, `verify`), `install` (`winget` or `url`), `note`. `bootstrap.py check` shows it at once. Per-machine paths go in `state/machine.json`, never in `tools.json`.
- Windows: Git Bash `$HOME` must equal `%USERPROFILE%`; otherwise set `CLAUDE_CONFIG_DIR` to `%USERPROFILE%\.claude`. `.gitattributes` keeps shell scripts on LF.

```
echo ${CLAUDE_CONFIG_DIR:-$HOME/.claude}
claude --version
command -v rtk jq node gh python3
```

Done when every command prints a value (`rtk` and `gh` may be missing; the rest, `node` 22+ included, may not). No path is hard-coded anywhere; only the clone location of this repo differs per machine. Cloud sessions (claude.ai/code) do not read `~/.claude`: their settings live in each project's `.claude/`.

## 1. Apply the global setup (each machine)

```
git pull
bash scripts/apply.sh            # needs jq; merges settings.json, copies the items listed in apply.sh
claude                           # open one session and exit: it registers the pinned marketplaces
claude plugin install ponytail@ponytail
```

Open a new session (running sessions do not get the plugin), then verify:

```
bash scripts/verify.sh --live    # repo checks + applied files equal claude/ + tools + Ponytail
bash scripts/verify.sh --full    # also runs qa-deny.sh (claude CLI + haiku); run it where RTK is installed
```

Done when `verify.sh --live` prints `0 FAIL`. WARN lines are informational (for example no `.ponytail-active` flag before the first new session). It is not strictly read-only: it runs `claude --version` and `claude plugin list`, and the CLI may rewrite `settings.json` while loading it (on a fresh config it spells `"model": "opus"` as `"opus[1m]"`, which is why the repo uses that spelling, and drops a `modelSettings` that is not an object); the next `apply.sh` restores the repo values. Then spot-check by hand: `rtk gain` total commands grows after a few Bash calls, the status line shows `[model] N% context`, `/context` lists the Memory files `CLAUDE.md` and `RTK.md`, the seven custom agents (`explorer`, `reviewer`, `worker`, `publisher`, `frontend`, `backend`, `qa`) and the skills (`orchestrate`, `spec-writing`, `design-spec`, `project-setup`, `ui-baseline`), and `claude plugin details ponytail` shows its always-on token cost.

`apply.sh` merges `settings.json` instead of replacing it. This repo owns the top-level and `permissions.*` keys listed in `scripts/owned-keys.json` (read by both `apply.sh` and `verify.sh --live`) and the fields it sets inside `modelSettings` entries (live values are replaced, a key the repo lacks is deleted) and every other key the repo sets (`model`, `effortLevel`, ...). Keys that exist only on the machine, such as `env` (for example `CLAUDE_CODE_TMPDIR`) or a plugin enabled by `claude plugin install`, are kept and reported. `scripts/removed-keys.json` lists keys that are deleted. Files that an earlier apply copied (tracked in `~/.claude/.ai-setup-manifest`; a `.claude-global-manifest` is renamed to it once, and `verify.sh --live` warns until then) and the repo no longer has are removed; files of an item dropped from the copy list (a retired skill) are kept and reported as `kept (dropped from the copy list ...)` on every apply and dry run until removed by hand; files that never came from this repo are kept and reported. `verify.sh --live` compares only the owned keys (WARN on a difference, INFO for machine-only keys).

Undo: there is no backup; git is the history. Check out the older commit and run `apply.sh` again. Owned settings keys (`scripts/owned-keys.json`) and tracked files go back exactly, as long as the older commit's `apply.sh` owns them; a key only a newer `apply.sh` owns (the bypass lock) stays live: add `["permissions","disableBypassPermissionsMode"]` to `scripts/removed-keys.json` in that checkout before running `apply.sh`, or undo it in a forward PR instead. Other keys do not: one the repo set (`model`, `theme`, cache TTLs) keeps its live value when the older commit lacks it, unless `scripts/removed-keys.json` lists it; plugins enabled since and machine-only keys stay.

## 1b. Steps only you can do (once per machine)

`apply.sh` and the scripts cannot do these. Tick them off after the quick path; each says how to check it.

1. **Remove what the repo no longer wants.** Superpowers, if it was ever installed: `claude plugin uninstall superpowers@claude-plugins-official` (check: `verify.sh --live` prints `Superpowers is not installed`). `apply.sh` already removed its `enabledPlugins` entry.
2. **Create the scheduled task** `daily-claude-update` in the Claude app once, from the pointer body in `claude/scheduled-tasks/daily-claude-update/SKILL.md` (replace `<repo>` with this machine's clone path). Pick Opus in the app's Scheduled settings and the auto permission mode. Check: run it once by hand; `reports/YYYY-MM-DD.md` appears and `verify.sh --live` no longer warns about the task.
3. **Project settings for AO** (only if you use AO): `ao project set-config <id> --permission auto` (it replaces the whole project config; round-trip `ao project get --json` first).
4. **VS Code**: leave `claudeCode.initialPermissionMode` unset (it does not accept `auto`).
5. **Dashboard autostart** (optional, per machine, not in the repo): `python3 scripts/bootstrap.py autostart` shows and, after y, writes the launcher for this machine's Python. Windows: `claude-dashboard.vbs` in `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup` (pythonw, hidden). Delete the file to undo.
6. **`desktop-commander@synced` stays `false`** in `enabledPlugins`: that synced plugin starts an MCP server (`npx -y @wonderwhy-er/desktop-commander@latest`) in every session; on Windows each start opens console windows and failed connects retry in bursts, and `claude -p` QA runs load it too. Re-enable with `claude plugin enable desktop-commander@synced` if you want it.
7. **Secrets in a repository**: if a `~/.claude` snapshot ever reached a repository, remove the files from it and rotate the tokens (log out and in again). Deleting a repository is irreversible: confirm first.

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
| Parallel | Git worktrees; AO is optional. Workers per non-overlapping file area with tests as the done criterion, then an AO review per PR (`docs/evidence.md`, "AO QA 실측") |

Habits: `/clear` between unrelated tasks; after two failed corrections on one issue, `/clear` and restate the task; `/rewind` to undo; changes go through a branch and a PR and Claude merges once CI is green.

## 4. Daily routine and maintenance

- The routine `daily-claude-update` runs `claude --version`, the changelog, `scripts/verify.sh --live`, and `scripts/docs-watch.sh` (sixteen official docs pages this setup depends on, plus two platform pages), then writes `reports/YYYY-MM-DD.md` and proposes changes. It only reads and reports. Steps live in `claude/routines/daily-update.md` and are read from the clone, so `git pull` updates them.
- On each machine create the scheduled task in the app once, from the pointer body in `claude/scheduled-tasks/daily-claude-update/SKILL.md` (replace `<repo>` with that machine's clone path). The task body is only that pointer; the steps are read from the clone.
- Model of the scheduled task: the task body has no model field, so the task runs on the model picked in the app. Set Opus explicitly in the app's Scheduled settings and check the model shown in the run session. Set the task's permission mode to auto too.
- Monthly: `/doctor` on `CLAUDE.md`, skills and agents; `/context` for the share of system and MCP tool definitions (switch off connectors you do not use, for example the Chrome and Browser tools); `/skill-doctor` for what each skill costs and how often it is used (skills doc; Claude Code 2.1.252 or newer, run in the terminal, not over Remote Control, and not available when feature-flag fetching is off); `/insights` for friction points across recent sessions (costs doc; it uses tokens from your plan).
- After any change to permissions or hooks: `bash scripts/verify.sh --full` on every machine where RTK is installed.
- Weekly (GitHub, no PC involved): `.github/workflows/updates.yml` runs `scripts/update-pins.py --write` and opens or updates the PR `chore: update pinned versions` from `bot/updates` when a plugin pin, the Codex Ponytail skill, RTK or a recorded tool version moved (DECISIONS "Pinned versions move by a weekly PR"). Preview by hand: `python3 scripts/update-pins.py` (report only).
- Edit `claude/` in this repo, never `~/.claude` directly.

## Live dashboard

`python3 scripts/dashboard/server.py` serves http://127.0.0.1:8787 (local only, standard library, `--port N` to change). Ten tabs: monitoring, errors and debugging, orchestration (delegation flow), model routing, features, tool efficiency (RTK, claude-mem, AO, models; every number labelled measured, estimated or unavailable), practice checks (against the official docs), log and fixes, project setup, Codex setup. State refreshes every 3 seconds from the newest session log in `~/.claude/projects` (tool names, times and file basenames only, never message text; the efficiency tab also sums model names and token counts from every session log and subagent log there, shows a model name only if it has a price entry and a subagent type name only if this repo defines it or it is built in, otherwise `other`), `verify.sh --live` (at most once a minute), PR history, and the AO CLI if found (`AO_BIN`, the default Windows path, or `ao` on PATH; read-only). Fixes (turn on claude-mem redaction, update RTK) run only from a server allow-list after a confirm dialog.

- Code: Python modules in `scripts/dashboard/` (`procs.py` is the only place a process starts, hidden on Windows), UI as ES modules in `scripts/dashboard/ui/` (a screen is a `Tab` subclass in `ui/tabs/`, built from `ui/components.js`).
- Codex setup tab: shows what the Codex global setup (TRACE, [`codex/`](../codex/README.md)) reports about itself: `setup.py verify` and `setup.py plan` (both read-only) and `codex --version`. It never runs apply or rollback; those stay with Codex. The checkout is `codex/` in this repo only (`checkout.codex` in `state/machine.json` is not read). The Codex CLI is `CODEX_BIN` or `codex` on PATH. TRACE needs Python 3.11+.
- Project list: `PROJECT_DIRS` (paths joined by the OS path separator, `;` on Windows) or, without it, `state/projects.txt` (one path per line, `#` starts a comment); with neither, it uses folders recorded in session logs, skipping temp and worktree paths. Project roots name parent folders whose direct sub-folders are all listed (one level, never a drive root); they are read as `bootstrap.py check` reads them (`scripts/toolreg.py`): `PROJECT_ROOTS` (paths joined by the OS path separator) > `state/machine.json` `projectRoots` > `state/project-roots.txt` > `~/Projects` when it exists. A project root is the "work root" of the global path rule; with the `<client>/<stage>/<name>` layout, list the stage folders (the search reads one level, `docs/DECISIONS.md` "Dashboard structure").
- Autostart is a per-machine choice, not in the repo. Windows: a `.vbs` in the Startup folder that runs `pythonw scripts/dashboard/server.py` hidden (step 5 of section 1b).
- Checks: `bash scripts/qa-dashboard.sh` (API, security, static files), `bash scripts/qa-ui.sh` (headless Chrome: every tab, three widths, palette, dialogs, flow lines, live update, offline and recovery; needs node 22+).
- Not measured: sessions that run on another machine.

## Permission mode: auto

The default mode is `auto`, the mode the permission-modes doc recommends for working without prompts; `bypassPermissions` is documented for isolated containers and VMs only, so it is not used here. In auto mode a classifier reviews actions that no rule already decided. It blocks force pushes, `reset --hard`, `clean -fd`, irreversible deletes, secrets in commits, credential output and prompt-injection-driven actions by default, and it reads `CLAUDE.md`.

Two layers, on purpose:
- **Deterministic:** `permissions.deny` blocks in every mode (secret files are denied both under the project, `**/`, and in the home folder, `~/`: an unprefixed pattern is relative to the current directory per the permissions doc); `permissions.ask` always prompts, even in auto mode, and covers only `git push` (no other permission prompts, `docs/DECISIONS.md`); the `secret-guard` hook blocks staging secret files. These do not depend on a model.
- **Classifier:** the `autoMode` block in `claude/settings.json` adds this setup's context (`environment`), a plugin-install rule (`soft_deny`) and a secret-file rule (`hard_deny`). Every array starts with `"$defaults"`; without it the built-in rules for that array are dropped. `permissions.allow` stays empty (broad allow rules are suspended in auto mode anyway).

Rules of use:
- `defaultMode: "auto"` and `autoMode` take effect only from user settings (`~/.claude/settings.json`, written by `apply.sh`), not from a project `.claude/settings.json`. Needs Claude Code 2.1.295 or newer; `verify.sh --live` fails below that.
- This repo owns the permission and `autoMode` settings. Do not change them with `/permissions` or `/auto-mode-setup` (the second is switched off by `skillOverrides`): edit `claude/settings.json`, then run `bash scripts/apply.sh`.
- If the classifier blocks something it should allow: open `/permissions`, **Recently denied**, read the rule name in brackets, then add an `environment` or `allow` entry (keep `"$defaults"`) in `claude/settings.json` and apply. `claude auto-mode critique` reviews custom entries. After 3 blocks in a row or 20 in total, auto mode pauses and Claude Code goes back to prompting. In `-p` runs a blocked action is skipped and the run continues.
- If auto mode is not available (turned off for the account or server side), sessions start in Manual mode; the deny, ask and hook layer still works. Classifier calls count toward token usage on some plans (permission-modes doc).
- VS Code: `claudeCode.initialPermissionMode` does not accept `auto`; leave it unset.
- AO workers: `ao project set-config <id> --permission auto` (it replaces the whole config; round-trip `ao project get --json` first). Deny and ask rules apply to workers in every mode.
- Bypass is locked: `permissions.disableBypassPermissionsMode` is `"disable"`, so `--dangerously-skip-permissions` is refused on any machine where `apply.sh` ran. Going back to bypass is a decision to record, not a setting to flip: change `permissions.defaultMode`, that key and the checks in `scripts/verify.sh` in one PR.
- Bypass in an isolated container or VM (permission-modes doc: "Isolated containers and VMs only"): do not run `apply.sh` there; start `claude -p "<prompt>" --dangerously-skip-permissions` as a non-root user. Deny rules still apply in bypass mode; allow rules and the classifier do not.

## Secret-guard hook

`claude/hooks/secret-guard.sh` runs before every Bash call (PreToolUse; exit 2 blocks, per the hooks doc). It also runs before the GitHub MCP file writes `push_files` and `create_or_update_file` (matcher `^mcp__.*github.*__(push_files|create_or_update_file)$`, which also covers plugin-scoped servers such as `mcp__plugin_engineering_github__`) and blocks when a path they carry has a secret-looking name; without jq such a write is blocked. File contents are not inspected, and other ways to write to a remote (another MCP server, `gh api`) are not covered. Calls without a `git` word pass at once. Otherwise it blocks when a secret-looking name would be staged, committed or pushed by `git add`, `stage`, `commit`, `push`, `update-index`, `mv`, `apply --index` or `am`. The name list is the `is_secret` function in the script (`.env*`, `.credentials*`, `credentials.json`, `.npmrc`, `.netrc`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, private keys `id_rsa*`, `id_ed25519*` and the like, `*.tfstate`, `secrets.yaml`; names ending in `.example`, `.sample`, `.template` and public keys `*.pub` are allowed). It also catches an `rtk ` prefix, `-C dir`, `cd dir &&`, quotes and backslashes (`g\it`), `bash -c`, `xargs`/`find -exec` feeding `git add`, and globals such as `--no-pager`. Git output is read NUL-separated, so paths with spaces or non-ASCII names are judged correctly. A blocked call prints the file names; fix it by removing them from the change or adding them to `.gitignore`. To turn it off, remove its entry from `claude/settings.json` in a PR and run `bash scripts/apply.sh`.

Fail-closed: when jq or git is missing, or the hook input is not JSON, a command that mentions a staging verb is blocked (exit 2); other commands pass. `settings.json` gives the hook `timeout: 30` and `onFailure: "block"` (Claude Code 2.1.295 or newer), so a crash or a timeout blocks the call too. In a very large repository the 30 s limit can block a git command: raise `timeout` for that project instead of removing the hook.

Limit: it reads the command text. Aliases, scripts that call git, git itself held in a variable, a quoted path with a space given as one argument, brace expansion, `eval` and pushes of another branch (`git push origin feat`, `--all`; only HEAD and its upstream are judged) are not seen. A variable, `$()` or `xargs`/`find -exec` as an argument of `add`, `stage`, `update-index`, `apply`, `am` or `mv` is read as "everything pending" and judged like `git add -A`. It also blocks some harmless text: a command whose quoted text or heredoc line contains `git add -A` while a secret-named file is untracked, so it is a guard rail, not a boundary. `git stash -u` is not checked: a stash stays on the machine. The daily routine's repository exposure check (step 7b) covers what reaches a public repository anyway. Tests: `bash scripts/qa-hooks.sh` (also run by `verify.sh`).

## Session hooks

Both are in `claude/hooks/`, registered in `claude/settings.json`, always exit 0 and never block (hooks doc: https://code.claude.com/docs/en/hooks). Tests: `bash scripts/qa-hooks-session.sh` (also run by `verify.sh`).
- `compact-context.sh` (SessionStart, matcher `compact`): after an automatic or manual compaction it prints the project's `.claude/handoff.md` with the time it was last written, so a note from an older task is recognisable. It searches upwards from the input `cwd` (which follows Claude into a worktree), then, if that finds nothing, from `CLAUDE_PROJECT_DIR`, skipping levels that no longer exist; it stops at the nearest project mark (`.git`, `CLAUDE.md`, `AGENTS.md`, `.claude`) without a note, so a nested project never gets its parent's note (not through the `CLAUDE_PROJECT_DIR` fallback either; a linked worktree, whose `.git` file points into `.git/worktrees`, is not a stop (a submodule is) and reaches its main checkout's note), and at the home folder (also when it is reached through a symlink). A SessionStart hook's plain stdout becomes context. Output over 10,000 characters would be moved to a file Claude is not asked to read, so the note is cut at 8,000 bytes, without splitting a UTF-8 character, and the cut is named. Without a note it prints one line: keep the modified files, check commands and open issues.
- `config-audit.sh` (ConfigChange, matchers `user_settings` and `skills`): appends `<epoch> <UTC time> <source> <file>` to `~/.claude/config-changes.log` (last 500 lines kept once it passes 256 KB). Only files inside the config directory are logged: the `skills` matcher also fires for a project's `.claude/skills/`. The hooks guide says ConfigChange fires "when an external process or editor modifies a configuration file"; whether changes made through `/permissions` or `/config` inside the session also fire it is not verified (local check L-13). A ConfigChange hook's output is not shown to you or Claude, so `verify.sh --live` reads the log and warns about changes recorded more than 2 minutes after the last `apply.sh`. Move a change you want into `claude/`, then apply.

## AO (Orchestrator.inc) use

AO runs on the local machine only. Per machine, by hand (not part of `bootstrap.py apply`: it needs the AO app running and a per-machine `ao/projects.json`, gitignored): start the AO app, then in `ao/` run `python -B setup.py register --id <id> --path <repo>` for each project (add `--image` for a repo with a compose file), then `python -B setup.py apply` (add `--lanes` only to replace the roles of projects already registered; it prints old and new values first), and check `ao project get <id> --json` shows the `ao/` path (`ao/README.md`). When the `ao/` folder moves (another clone path), the Setup/Cleanup entries with the old path stay and must be removed by hand in the AO app (the CLI round trip does not show `preRemove`). Cloud sessions do not run or QA it: the VM is reclaimed when idle and background processes are not restored (DECISIONS "AO runs on the local machine"). Use AO only for parallel work with disjoint file scopes. Set permissions with `ao project set-config <id> --permission ...` (it replaces the whole config: round-trip `ao project get --json` first), put the done criteria and "never push" in `--agent-rules`, and push and merge by hand. The PR reviewer is Codex (`gpt-6.1-sol`), a different vendor from the Claude workers: `ao project set-config <id> --config-json "$(ao project get <id> --json | jq -c '(.project.config // {}) + {reviewers: [{harness: "codex", agentConfig: {model: "gpt-6.1-sol"}}]}')"`. Send only `.project.config`, never the whole `get` output: `set-config` ignores unknown keys and would replace the config with an empty one. The CLI round trip also drops fields its client does not know (`agentConfig.effort`, `preRemove`, `disabled`); run every review pass with `ao review trigger <session> --effort high` (DECISIONS "AO reviewer lane"). A configured reviewer wins over the worker's harness. The Codex CLI must be installed and logged in on that machine, and `gh auth login` done there, or the review is not posted to GitHub; findings then stay in `ao review ls --json` (pass them with `ao send`). Killing a worker session empties its worktree and blocks review, so trigger `ao review trigger` before ending it, or re-register the repository and use `--claim-pr`. Measured behavior and traps: `docs/evidence.md` ("Orchestrator.inc(AO) 도입 검토"). How this setup and the Codex setup (`codex/`) line up, and which differences are deliberate: `docs/codex-alignment.md`.

## Benchmark: single vs subagents vs AO

One fixed job (three independent Python tasks in `scripts/bench/fixture`, graded by hidden tests in `scripts/bench/hidden` the agents never see) run three ways, and one table that compares them: cost split into cache read, cache write, output and input, wall time, peak context of the main thread, and the hidden-test score. Use it to decide whether AO, or parallel subagents, beat one agent on this machine.

1. Run on the machine you work on, after `bash scripts/apply.sh` (`run` refuses otherwise: the hooks in `settings.json` live in the config directory, and without them every Bash call is blocked). All three arms on the same machine, settings, Claude Code version and model, or the table compares machines. Use a work folder outside this repository.
2. `bash scripts/bench.sh run <work> single 3`, then `bash scripts/bench.sh run <work> subagents 3`. Each run is `claude -p` on a fresh committed copy of the fixture (with this repo's agents in `.claude/agents`), permission mode auto, up to 30 minutes (no limit when `timeout` does not exist). A parent Claude session's id is unset for the run, so runs started from inside Claude Code do not share a transcript. An existing run folder is never replaced unless `BENCH_FORCE=1`. Costs tokens: roughly six short sessions plus nine subagents.
3. `bash scripts/bench.sh prepare-ao <work> 3`, then for each `ao-r*` folder in turn: register `<folder>/repo` as an AO project, set the worker model to the same model, as a full model ID such as `claude-haiku-5-5` (AO 0.13.7 rejects aliases), and the permission to auto (`ao project get <id> --json`, then `ao project set-config`), spawn three workers at once with the three prompt files pasted verbatim, and when they finish merge their branches into `main` in that repo (before ending the sessions). The prompt carries the marker the report looks for (`[BENCH-...] Do ` at the start of a line of the worker's typed prompt, so lines AO puts before it are fine; if AO rewrites the prompt itself, the runs show as missing). Paste the prompts only into the workers: any Claude session that receives one at the start of a line, an orchestrator included, is counted as part of the run; `ao spawn --help` shows how your version takes a prompt.
4. `bash scripts/bench.sh report <work>` prints the table and writes `reports/bench/latest.json` (gitignored); the dashboard's efficiency tab shows it as "같은 과제 비교".

How to read it: compare cost and time only between arms with the same hidden-test score. Every delegate pays its own start-up (about 43K prompt tokens written to the cache, `docs/evidence.md`), so parallel arms can be faster and dearer at once; the table shows that rather than hiding it.

Limits: three runs per arm is a small sample. Wall time is first to last transcript entry of the sessions carrying the marker, so an AO orchestrator session that never received a prompt, session titles and hook classifier calls are left out. A run whose marker is found in no transcript is listed as missing and left out of the averages; a damaged `bench.json` is listed as invalid; `report` exits non-zero and keeps the previous `latest.json` when no run has a transcript (an empty folder, or a `--projects`/`CLAUDE_CONFIG_DIR` other than the one the runs used). A compaction summary that quotes the run's prompt does not end the run. Log cost comes from transcript tokens; the "CLI 집계" column is `claude -p`'s own `total_cost_usd` (none for AO), and a gap over 5% is flagged (transcripts can hold fewer output tokens than the CLI counts, `docs/evidence.md`). If several runs share one transcript (a session id passed on by hand), the last run also counts later non-bench work in that file. The tasks are small and touch different files; they say nothing about large projects or overlapping files. Harness test: `bash scripts/bench.sh selftest` (synthetic logs, also in CI). `BENCH_SETTINGS=<file>` swaps the settings file and skips the applied-setup check; it exists to test the harness, and its numbers are not a baseline.

## Troubleshooting and traps

- **A hook or deny rule blocks something harmless**: read the message (the secret-guard hook prints the file names); `git clean -n`, editing `.env.example` and reading a project `.npmrc` are known, accepted over-blocks (`docs/DECISIONS.md`). Do not widen the rule from a chat message: edit `claude/settings.json` in a PR.
- **The classifier blocks a routine action**: see "Permission mode: auto". Repeated blocks for the same destination usually mean it lacks context; add it to `autoMode.environment`.
- **Permission rules see the command after RTK rewrote it** (`git ...` becomes `rtk git ...`), so every Bash rule needs its `rtk ` twin. Deny and ask rules are not a security boundary: `/bin/rm -rf`, `bash -c '...'` are other spellings. Real enforcement needs the Bash sandbox, which is off by default and does not exist on native Windows.
- **Windows Git Bash QA scripts**: do not set `MSYS_NO_PATHCONV=1` for the whole shell (native `jq.exe` cannot open `/d/...`); pass work folders as `D:/...`. Windows Python does not read `/c/...` paths; use `cygpath -w` for Node and Python.
- **AO**: ending a worker session empties its worktree and blocks the review; run `ao review trigger` first, or `ao spawn --claim-pr <PR URL>` later. The local app (0.13.7) rejects the alias `haiku` with `UNSUPPORTED_MODEL`; use `claude-haiku-5-5`. Whether `sonnet` and `opus` pass on a 0.13.7 worker spawn is not checked. Worktrees start without `node_modules` or `vendor`, so install or copy them in `postCreate`; a spawn can fail with `WORKSPACE_PROVISION_FAILED` while other workers run (cause not checked), and a retry once they were idle worked. If the Codex reviewer cannot post to GitHub, its findings stay in `ao review ls --json`; pass them on with `ao send`. If the Codex CLI fails every shell command with `setup refresh had errors`, update the CLI (Codex CLI 0.161.0 has this bug; openai/codex#51822 fixes it). Closing the AO window does not stop the app (it restarts from the tray), and orphan `ao.exe chat-host` process trees can remain after the daemon stops: end each root with `taskkill /T`.
- **Push is refused in a session**: the `git push *` ask rule prompts even in auto mode, and the classifier may refuse a push you did not ask for. Say so in chat; use plain `git push origin <branch>`, never force.
- **x.com returns HTTP 402 to automated fetches**: use the app browser; official links decide.
- **Processes named `--chrome-native-host`** belong to Chrome; leave them.
- **`~/.claude` must never be committed**: `.credentials*`, `.claude.json`, `history.jsonl` are gitignored and blocked by `secret-guard`.

## Local test checklist (the two Windows PCs)

CI covers the scripts in Linux and Windows runners; these checks need your machines. Write the latest result in the "Last run" column (`machine, date, result`), replacing the earlier one. `both` in the Where column means both Windows PCs.

| ID | Where | Do | Expect | Last run |
|---|---|---|---|---|
| L-1 | Windows | `claude --version`, `git pull && bash scripts/apply.sh && bash scripts/verify.sh --live` | 2.1.295+; 0 FAIL; the apply report lists replaced/kept/removed keys; stale files removed. Also, with jq off the PATH, staging a secret-named file in a throwaway repo is blocked by secret-guard (CI skips this simulation on Git Bash) | Windows, 2026-10-13, claude 2.1.296, rtk 0.51.0: `verify.sh --live` 0 FAIL, 0 WARN; a second `apply.sh` replaces nothing. The jq-off secret-guard simulation was not run |
| L-3 | both | new session; `claude auto-mode config`; `claude auto-mode critique` | session starts in auto; output holds the DevCrop environment and both custom rules; read the critique | — |
| L-4 | both | step 1 of section 1b; the plugin pinning change (after a fresh install, `gitCommitSha` in `installed_plugins.json` equals the `sha` in `settings.json`) | `claude plugin list` has no Superpowers; claude-mem worker answers on :37777 | — |
| L-5 | both | `bash scripts/qa-deny.sh` | all PASS (30 cases; with RTK installed it exercises the rewrite) | Windows, 2026-10-13, rtk 0.51.0 hook active: all 30 PASS |
| L-6 | both | `qa-role-agents.sh <dir>` real mode, `qa-project-setup.sh <dir>`, one AO worker | still pass in auto mode; note any action the classifier skipped | Windows, 2026-10-12, AO part only: three Haiku workers in auto, no classifier skips (`docs/evidence.md`, "AO 로컬 QA"); the two scripts not run |
| L-7 | both | `bash scripts/qa-ui.sh` | 80 checks pass; no backup tile; AUTO badge | — |
| L-8 | both | in a session: stage a secret file; remove jq from PATH and stage again; remove jq and run `ls`; ask for `cat .env` | blocked; blocked; allowed; refused | — |
| L-9 | both | `git push`, `git -C . push`, then `rm x` and `git stash clear` in a session | the two pushes ask for confirmation, also in auto mode; `rm x` and `git stash clear` run with no permission prompt (ask rules cover push only) | — |
| L-10 | Windows | run the scheduled task once | report written, runs in auto mode | — |
| L-11 | both | change a rule in `/permissions` → Auto mode, then `verify.sh --live`, then `apply.sh` | WARN naming the key; apply restores it | — |
| L-12 | both | VS Code settings | `claudeCode.initialPermissionMode` is empty | — |
| L-13 | both | write `.claude/handoff.md` in a project, run `/compact` in a session there; then change a setting in `/config`, and separately edit `~/.claude/settings.json` in an editor, and run `verify.sh --live` after each | Claude quotes the note and its time after the compaction; the editor change gives a `config changed outside this repo` WARN naming `settings.json`; note whether the `/config` change does too | — |

## Not verified

- Windows Git Bash with the real RTK hook: the plugin hooks there and the jq-off secret-guard simulation (L-1, L-8); `apply.sh`, `verify.sh --live` and `qa-deny.sh` are in checklist L-1 and L-5.
- The `claude plugin list` output format that `verify.sh` parses for the Ponytail status; a changed format shows up as a WARN, not a false PASS.
- How often `orchestrate` is loaded by description matching (`/orchestrate` is the fallback).
- `secret-guard`: hook latency, and running next to the real RTK hook (checked once with RTK-less project settings: `git add -A` was blocked).
- `project-setup` was dry-run once on a scratch PHP + React project; the interactive approval flow and real projects are untested.

## Deliberately not adopted

Superpowers (any scope), agent teams (experimental), agent view (research preview), hook-based intent detection, a global Stop hook or `/goal` gate (enable per project once it has tests), a daily proposal loop that mines session logs.
