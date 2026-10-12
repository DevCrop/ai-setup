# Decisions

One entry per decision that still shapes this setup: the choice, why, and how to undo it. Newest first. Long measurements and the original wording are in `docs/evidence.md` (Korean, verbatim); the runbook is `docs/GUIDE.md`. Change a decision in a PR that updates this file, the setting and the check in `scripts/verify.sh` together.

## 2026-10-12 — skill and agent metadata against the official limits

### `when_to_use`, agent colors, and the official limits checked by `verify.sh`
- What: `orchestrate`, `spec-writing` and `design-spec` have `when_to_use` with example requests in Korean and English (skills doc: "trigger phrases or example requests"; it is appended to `description` and shares its 1,536-character cap). Each agent has a `color` (sub-agents doc; display only). `verify.sh` now checks: `description` + `when_to_use` within 1,536 characters (it checked `description` alone), `SKILL.md` within 500 lines ("Keep SKILL.md under 500 lines"), agent names unique, at most 256 characters, not starting with `-` and without `:` (sub-agents doc: such a file is skipped), a `when_to_use` written over several lines (the check reads one line), and the combined agent descriptions against the 15,000-token startup warning (WARN above 15,000 characters, an approximation). Characters are counted as UTF-8 characters in any locale.
- Why: model-invoked skills load by description match, which is the known weak spot (entry 2026-10-11, "description matching is probabilistic"); the limits were enforced by nothing.
- Not done: a check that an agent's `name` equals its file name, which the plan had; the sub-agents doc says "The filename doesn't have to match".
- Undo: remove the `when_to_use` and `color` lines, the added checks in `verify.sh` sections 6 and 7 with their helpers (`chars`, `fm_value`, `fm_multiline`), and the `when_to_use` part of the skill check in `scripts/dashboard/inventory.py`.

### Worktree isolation stays conditional
- What: no agent sets `isolation: worktree` in its frontmatter; the `orchestrate` skill (step 5) uses it only when two delegates cannot be kept off the same files.
- Why: the sub-agents doc suggests worktrees for file-changing agents, but a worktree branches from the default branch, so the delegate does not see uncommitted work in the main thread, which is the usual state when a part is delegated. Splitting by file gives the same safety without that.
- Undo: add `isolation: worktree` to the file-changing agents and drop the condition in step 5.

### `project-setup` still recommends no plugin (code intelligence plugins not proposed)
- The best-practices and costs pages suggest code intelligence plugins for typed languages. `project-setup` step 9 says "do not install or recommend any plugin", and the plugin pinning decision (entry "Third-party plugins are pinned through an own marketplace") is pending. Proposing one is a decision for the user, not part of this change.

## 2026-10-12 — session hooks and the settings schema

### SessionStart `compact` hook re-injects the handoff note; ConfigChange hook logs edits outside this repo
- What: `claude/hooks/compact-context.sh` and `claude/hooks/config-audit.sh` (`docs/GUIDE.md`, Session hooks); `verify.sh --live` reads `config-changes.log`; `docs-watch.sh` and the routine now watch the hooks reference page.
- Why: best-practices and hooks-guide ("Re-inject context after compaction") recommend a deterministic hook over an advisory line, and the security page recommends auditing settings changes with ConfigChange hooks. The audit hook only logs: its output is never shown (hooks reference, "ConfigChange decision control"), and blocking would also block the app's own writes (theme, plugins) and `apply.sh`.
- Checked: `qa-hooks-session.sh` (note found from a subfolder and from a worktree cwd, home folder skipped also through a symlink with a trailing slash, 9 KB note cut under the 10,000-character cap without splitting a Korean character, broken input, project skills not logged, a newline in `file_path` cannot forge a line, rotation; mutations of the cut, the home stop and the config-dir filter each fail it), `qa-apply.sh` case 10b (a change within 2 minutes of apply is not reported, a later one is). Not checked here: a real `/compact` in a session (`docs/GUIDE.md` local checklist).
- Undo: remove the two hook files, the `SessionStart` and `ConfigChange` entries in `claude/settings.json`, check 3d and 9b in `verify.sh`, case 10b in `qa-apply.sh`, `scripts/qa-hooks-session.sh` and its README row, the GUIDE "Session hooks" section, the hooks in the GUIDE "Always on" row and check L-13, and the `hooks` page in `docs-watch.sh` and the routine. `apply.sh` then deletes the hook files from `~/.claude/hooks/` (manifest); delete `~/.claude/config-changes.log` by hand on each machine.

### `$schema` in `claude/settings.json`
- What: `"$schema": "https://json.schemastore.org/claude-code-settings.json"` (settings page). Editors validate and complete the file. The settings page says the schema can lag behind new keys, so a warning on a recently documented key is not an error.
- Undo: remove the line and add `["$schema"]` to `scripts/removed-keys.json`; otherwise `apply.sh` keeps the live copy as a machine-only key.

## 2026-10-12 — prompts only for push; bypass locked

### Ask rules cover push only; `git -C`/`git -c` forms of the deny rules added; `shred` denied
- What: `permissions.ask` keeps only `git push *`, `git -C * push*`, `git -c * push*` (with `rtk ` twins). Every git deny rule (reset, clean, checkout, switch, restore, push variants) also exists as `git -C * <rule>` and `git -c * <rule>`; for `clean` the twins are `clean` and `clean -*` (a bare `clean*` tail would also match ` cleanup` in a message), plus `git -c *equire*orce* clean*` and `git -C * -c *equire*orce* clean*`, because `git -c clean.requireForce=false clean .` deletes untracked files without a flag; the second rule covers `-C dir` before `-c` (a leading `git *` would also have matched a plain `git commit` whose message quotes the command, found in review), and `equire*orce` covers the usual spellings (`requireForce`, `RequireForce`, `requireforce`), since git config keys ignore case but rule matching does not. `shred *` moved from ask to deny.
- Why: the user wants to work without permission prompts (2026-10-12); push stays because "send anything outward only after approval" is a standing rule. The `-C`/`-c` gap was found in review on 2026-10-12: `git -C . reset --hard` and `git -c x=y clean -fdx` matched no deny or ask rule. It was closed before the ask rules were removed, so the classifier was never the only guard for those forms. `shred` has no legitimate use here and cannot be undone, so it is denied rather than left to the classifier.
- Left to the classifier and the chat-confirmation lines in `claude/CLAUDE.md` (Safety): `rm` (except the `rm -rf` home and root deny rules), `git branch -D` (recoverable from the reflog), `git stash drop`/`clear` (recoverable only with `git fsck --unreachable`, until gc), `git restore <file>` (`restore .` stays denied), `find -delete`.
- Accepted over-block: the `*` in `git -C * <tail>` spans words, so a `git -C`/`git -c` command whose text later contains a denied tail is denied too, for example `git -C repo commit -m "explain reset --hard"` or `git -C repo log -S "push --force"` (found in review, reproduced with `claude -p`). Deny rules cannot express exceptions, and narrowing them would reopen the gap. Work around it with `cd <dir> && git commit ...` or `git commit -F <file>`.
- Not covered: `git -C dir clean <path>` in a repository whose own config sets `clean.requireForce=false`, and spellings with other capitals such as `REQUIREFORCE`, and global options before `-c` such as `git --no-pager -c ...` (left to the classifier); `git --no-pager reset --hard` and `git reset HEAD --hard` were already unmatched before this change.
- Checked: `qa-deny.sh --static` (every rule has its twin), new `qa-deny.sh` cases (`git -C . reset --hard HEAD`, `git -c x=y clean -fdx`, `git -c clean.requireForce=false clean .` and its `-C . -c` and `RequireForce` forms, `git -C . push --force`, `git -c x=y -C . checkout -- f.txt`, `shred` blocked; `git stash clear`, `rm <file>` run). Not checked in CI: the live `qa-deny.sh` run (needs the claude CLI); run `bash scripts/verify.sh --live --full` on each machine.
- Undo: put back the ask rules `git branch -D *`, `git stash drop *`, `git stash clear *`, `rm *`, `git restore *`, `find * -delete*`, `shred *` with their `rtk ` twins, drop the `shred` deny rules, and restore the removed `qa-deny.sh` cases.

### `permissions.disableBypassPermissionsMode: "disable"`
- What: bypass mode cannot be selected in sessions that read `~/.claude/settings.json` from this repo. `apply.sh` and `verify.sh` own the key (`own_perm`), and `verify.sh` asserts it.
- Why: the auto decision (2026-10-11) was a convention; the permissions doc says a user "can set it in their own settings to lock themselves out of bypass mode". Bypass stays for isolated containers and VMs that do not run `apply.sh` (`docs/GUIDE.md`, Permission mode).
- Undo: remove the key, the `verify.sh` assertion and the key from both `own_perm` lists.

## 2026-10-12 — project path rule and handoff on the PR

### The project is found from the cwd by its marks, never from a fixed path
- What: `claude/CLAUDE.md` (Working method): projects live under a per-machine work root as `<client>/<stage>/<date or name>`; the project is the nearest folder at or above the cwd with `.git`, `CLAUDE.md`, `AGENTS.md` or `.claude`, searching no higher than the work root or the home folder, which are never projects. The marks are the dashboard's (`scripts/dashboard/projects.py`); the work root is what the dashboard and `bootstrap.py` call a project root.
- Why: project folders sit one to three levels deep and the root differs per machine; `~/.claude` would otherwise make the home folder a project.
- Not yet: the same line in codex-setup `global/AGENTS.md` (an ask for the Codex side, `docs/codex-alignment.md`), and the dashboard project search to depth 3 (frozen, entry below).
- Undo: remove the line from `claude/CLAUDE.md` and this entry.

### The handoff note is also posted on the work's own open PR (standing approval)
- What: besides `.claude/handoff.md` (entry 2026-10-11), the note goes in a comment on the work's open PR in a repository the user owns, without secrets or machine-local paths; without such a PR the model says the note is on this machine only. `claude/CLAUDE.md` names it as the one exception to "send anything outward only after approval".
- Why: on 2026-10-12 a note stayed on one PC when the work continued on another machine. The user gave this standing approval the same day.
- Undo: remove the sentence from the handoff line and the exception from the Safety line in `claude/CLAUDE.md`, the "since 2026-10-12" sentence in the 2026-10-11 handoff entry, and this entry.

## 2026-10-12 — tool registry and bootstrap

### One hub, one registry: `tools.json` in this repo, per-machine values in `state/machine.json`
- What: every dependency and tool (git, python, node, jq, gh, rtk, claude, codex, ao, cursor) is one entry in `tools.json`: how to detect it, its minimum version, its setup checkout candidates and its winget/brew/cask id or install URL. `scripts/toolreg.py` reads it; `scripts/bootstrap.py` is the one entry point (`check`, `install`, `clone`, `apply`, `verify`, `autostart`). A new tool is one entry.
- Why: each machine has different paths (project folders at different depths, codex-setup under `Documents/ChatGPT/글로벌 셋업` on the Windows PC), and the setup steps were spread over three repos and hand edits (a hand-made autostart `.vbs` with a fixed Python path). Per-machine facts belong in `state/machine.json` on that machine, not in the repo or a PR comment. The hub stays here because this repo is already cloned first on every machine.
- Rule: paths in `tools.json` use tokens (`${HOME}`, `${DOCUMENTS}`, `${LOCALAPPDATA}`, `${REPO}`, `${REPO_PARENT}`), never one user's path. Per-machine values go in gitignored `state/machine.json`; precedence for setup checkouts and project roots is environment variable > `machine.json` > legacy `state/*.txt` > registry candidates (project roots fall back to `~/Projects`; binaries: environment variable > `machine.json` > PATH > registry paths).
- Undo: delete `tools.json`, `scripts/toolreg.py`, `scripts/bootstrap.py`, `scripts/bootstrap.sh`, `scripts/bootstrap.ps1`, `scripts/qa-bootstrap.py` and the "Tool registry and bootstrap check" step in both jobs of `.github/workflows/check.yml`; remove GUIDE quick path 1b and step 5, the "Adding a tool" line and the bootstrap mentions in `CLAUDE.md`, `README.md` and GUIDE section 0; `apply.sh --dry-run` (qa-apply case 11) can stay. The dashboard does not import the registry yet.

### Installs only what is missing, one y/N per item, never an upgrade
- What: `install` runs `winget install --id <id> --exact --no-upgrade`, or `brew install` / `brew install --cask` with `HOMEBREW_NO_INSTALL_UPGRADE=1`, only for items not found. A tool that is too old is reported with its upgrade command, not upgraded. `install`, `clone`, `apply` and `autostart` show what they will do and ask y/N on the terminal; without one they refuse. A declined `clone`, `apply` or `autostart` exits 1; `install` exits 1 when a required item is declined. `check --write` asks nothing: it only adds missing values to `state/machine.json`. `bootstrap.ps1` has no terminal check yet (deferred finding 8 below).
- Why: an upgrade can break what already uses the old version, and nothing should change a machine unattended.
- Checked: `scripts/qa-bootstrap.py` (CI, linux and windows) and `scripts/qa-apply.sh` case 11, the dry run writes nothing (runs in CI through `verify.sh`). Not checked: a real winget or brew install, macOS. Sources for the flags are in commit `ded49bd`.
- Undo: drop `--no-upgrade` and `HOMEBREW_NO_INSTALL_UPGRADE=1` in `toolreg.install_argv` and the `ask()` gate in `bootstrap.py`, with their qa-bootstrap cases.

### Dashboard feature freeze kept until the Mac run
- What: the tools tab and the project search to depth 3 (PR3 of the plan) wait for the macOS run.
- Why: the 2026-10-11 "Dashboard structure" entry freezes features until that run, and it has not happened yet.
- Also waiting for that run: deferred review findings 6–10 of PR #91 (LaunchAgent PATH, `bootstrap.sh` installing git when present, `bootstrap.ps1` terminal check, the "read-only" wording of `verify`, the codex clone target on macOS/Linux).
- Undo: lift the freeze after the run by editing both entries.

## 2026-10-12 — AO reviewer lane

### AO reviewer lane is Codex `gpt-6.1-sol`; Claude keeps the worker lanes
- Why: the reviewer should not share the author's vendor and blind spots ("the author does not verify its own output"), and one Codex lane keeps routing simple (Claude already has Haiku, Sonnet and Opus). `gpt-6.1-sol` is the Codex catalog's "workhorse model for coding"; `gpt-6-astra` (frontier) and `gpt-6-luna` (easier tasks) can be added later if a measured need appears. Effort stays at the model default, which is `low` for `gpt-6.1-sol` (`models.json`); raise it per pass with `ao review trigger --effort` if reviews miss things.
- Where: per machine, in each AO project's config (`reviewers[].harness = "codex"`, `agentConfig.model`), not in this repository. The `orchestrate` skill and `docs/GUIDE.md` say how. Sources in `docs/evidence.md` ("AO Codex 리뷰어 레인").
- Not verified: a real Codex review run in AO; review quality against a Claude reviewer.
- AO itself is still a candidate (entry below); this applies when it is used. No `verify.sh` check: the setting lives in each machine's AO config, not in this repository.
- Undo: remove `reviewers` from the AO project config (AO then follows the worker's harness: claude-code for Claude workers) and these lines.

## 2026-10-12 — model usage and saving view

### Cache reads are shown as their own cost, and AO is judged by a same-task benchmark
- What: `usage.py` splits cost into input, cache write, cache read and output; the efficiency tab shows the split and the cache-read share. `scripts/bench.sh` runs one fixed job as one agent, as parallel `worker` subagents and as AO workers, and `scripts/bench/report.py` compares cost by kind, wall time, peak context and a hidden-test score; the dashboard reads `reports/bench/latest.json`.
- Why: in one long session in this cloud container (2026-10-12, `docs/evidence.md`) Sonnet cache reads were $2.95 of about $5.5 (list price), and the main context grew to 316K tokens (median 212K over 139 requests). Context length looks like a bigger lever than routing, and AO's value (time against start-up cost) cannot be read from logs of different jobs.
- Rule: all arms on one machine with the setup applied. A first harness run here, without `apply.sh`, blocked every Bash call through the missing `secret-guard` hook and measured nothing; `run` now refuses in that state. Log cost is cross-checked against the CLI's own `total_cost_usd` (transcripts held fewer output tokens in one run).
- Open: no AO numbers yet (AO is not installable in this container: GitHub is outside its network policy). `autoCompactWindow` stays 400000 until the benchmark or a week of `/usage` gives a reason.
- Undo: remove `scripts/bench.sh`, `scripts/bench/`, `BenchEfficiency`, `ui/bench-panel.js`, the split in `usage.py` and its UI, and the CI step in one PR.

### The efficiency tab sums per-reply usage from the session logs; `modelUsage` is not used
- What: `scripts/dashboard/usage.py` sums `message.usage` over every reply in the main logs and in `<session>/subagents/*.jsonl`, de-duplicated by `requestId`, and prices it with the official list prices. The tab shows actual cost, the same tokens repriced on each session's main model, the difference, per-model cost, and a table of defined versus actual model per agent.
- Why: the logs' own `modelUsage` stopped updating at line 97 of 270 in the session checked and missed a subagent that ran later. A reply is logged once per content block with the same usage (35 requests in 60+ entries), so a plain sum counts it up to 4 times.
- Basis labels: token counts are measured; every amount is an estimate (list-price arithmetic, not a bill); the saving is an estimate that assumes the same tokens on the main model and ignores quality. Calls that never reach a transcript (titles, hook classifiers) are not counted.
- Privacy: model names leave only if they are on `usage.PRICES` (else "other"); agent type names only if this repo defines them or they are built-ins (else "other").
- Read-only on purpose: the tab does not edit `claude/agents/*.md`. Changing a model stays a PR, and the earlier rule stands (no move of verifying roles to Haiku before 3+ samples and a reviewer scenario).
- Undo: remove `usage.py`, `UsageEfficiency`, `ui/usage-panel.js` and its line in `ui/tabs/eff.js` in one PR.

## 2026-10-11 — refactor round

### Working rules added to `claude/CLAUDE.md` (the plan's deferred D6 items)
- Commits: English Conventional Commits (`type: summary`, body gives the reason and the check). Code comments in English; text the user sees keeps the project's language. Why: the history is mostly `type: summary` already (22 of the last 40 subjects did not match a strict `type(scope):` pattern, so this tightens it rather than describing it), and one format keeps tools and the log consistent.
- Tests: a bug fix starts with a reproducing test; new logic with a branch, a parser or a security effect ships with a test. Not "every change": exploratory work, docs and settings do not need it.
- Handoff note: `.claude/handoff.md` in the project, never committed (this repo's `.gitignore` lists it; the rule tells the model to say so when a project does not). It is per machine; since 2026-10-12 it is also posted on the work's open PR (entry above).
- claude-mem retention: no automatic deletion, prune by hand. Revisit when size or search quality degrades. Not checked: whether claude-mem can delete by age and under which setting; read its docs before choosing an automatic policy.
- Undo: remove the lines from `claude/CLAUDE.md`, the `.claude/handoff.md` line in `.gitignore` (optional, it is harmless) and this entry in one PR.

### Permission mode is `auto`, not `bypassPermissions`
- Why: the permission-modes doc recommends auto for working without prompts and documents bypass for isolated containers and VMs only. Deny rules apply in every mode, ask rules always prompt, and a classifier (which also reads `CLAUDE.md`) reviews the rest. Replaces the 2026-10-10 bypass decision.
- Layers: deterministic (`permissions.deny`, `permissions.ask`, the `secret-guard` hook) plus the `autoMode` block (environment, `soft_deny` for plugin installs, `hard_deny` for secret files; every array keeps `"$defaults"`). `permissions.allow` is empty.
- Needs Claude Code 2.1.295 or newer (`verify.sh --live` fails below). If auto is unavailable the session starts in Manual mode and the deterministic layer still holds.
- Locked by setting since 2026-10-12: `permissions.disableBypassPermissionsMode: "disable"` (entry above).
- Undo: change `permissions.defaultMode` and the assertion in `verify.sh` in one PR.

### Superpowers is not adopted at any scope
- Why: it was enabled at user scope by a drift-fix commit while the docs said never to; the always-on hook cost and Windows risk were never measured. `docs/reviews/superpowers-review.md` stays as the record.
- Guard: `verify.sh` fails when `settings.json` enables it and warns (`--live`) while it is installed; `scripts/removed-keys.json` deletes the key on apply.
- Undo: drop the guard and re-enable per project.

### Third-party plugins are pinned through an own marketplace (pending)
- Why: Ponytail, claude-mem and Archify are personal GitHub repositories outside the official marketplace; an unpinned upstream push would run code on every machine. Plan: fork them, publish `DevCrop/claude-plugins` with `sha`-pinned plugin sources, point `extraKnownMarketplaces` at it.
- Status: waits for the forks; until then `settings.json` still names the upstream marketplaces, and the `autoMode.environment` line says so ("plugins come from the marketplaces already listed"). When the pinned marketplace exists, change that line, `extraKnownMarketplaces` and `enabledPlugins` in the same PR. The `soft_deny` rule already blocks plugin installs unless the user names them.

### `apply.sh` merges `settings.json` and keeps no backup
- Why: whole-file replacement fought the app (theme, `enableWorkflows`, `agentPushNotifEnabled`, plugin entries): repeated "keep key X from being deleted" commits within two days (0eae5f6, 106c52e, 21f4cea, 04218ce). Now this repo owns `permissions.{defaultMode,deny,ask,allow}`, `autoMode`, `hooks`, `statusLine`, `extraKnownMarketplaces`, `skillOverrides` and every other key it sets; machine-only keys are kept and reported; `scripts/removed-keys.json` deletes listed keys (today: the Superpowers plugin entry and `skipDangerousModePermissionPrompt`, which `verify.sh` also asserts absent); a manifest removes files the repo dropped and never deletes through a symlink or outside the config directory.
- No backup: git is the history. Rollback is "check out the older commit, apply again". Owned keys (`permissions.*`, `autoMode`, `hooks`, `statusLine`, `extraKnownMarketplaces`, `skillOverrides`) and tracked files return exactly. Other keys do not go back: a key the repo set (`model`, `theme`, the cache TTLs, ...) keeps its live value when the older commit lacks it, unless `scripts/removed-keys.json` lists it; so do plugins enabled since and machine-only keys.
- `scripts/setup-claude-mem.sh` still writes a timestamped `.bak-<time>` next to the file it edits: that file lives outside this repo and has no other history.
- Undo: restore the backup logic from git history (`apply.sh` before commit `9da161c`).

### `secret-guard` fails closed and knows more names
- Fails closed (exit 2, plus `onFailure: "block"` and `timeout: 30` in settings) when jq or git is missing or the hook input is not JSON, but only for commands that mention a staging verb; commands without a git word are never touched. Judges `add`, `stage`, `commit`, `push`, `update-index`, `mv`, `apply --index`, `am`; reads git output NUL-separated; treats `$()`, variables and `xargs`/`find -exec` feeding `git add` as "everything pending".
- Not checked: `git stash -u` (stays local). Known: a plain `git commit -m x` is blocked while a tracked secret-named file is modified but unstaged.
- Accepted limit: it reads command text, so it is a guard rail, not a boundary.

### The deny/ask backstop is deliberately broad, with accepted over-blocks
- Added deny: `git clean` (any flags), `checkout`/`switch -f`, `reset --merge/--keep`, `push --force-with-lease`, `+refspec`, `--delete`/`-d`; Read of keys, `.netrc`, `.npmrc`; Edit of `.env*`, `.credentials*`. Added ask: `git -C/-c ... push` (not matched by `git push *`), `git restore`, `find -delete`, `shred` (the last three, `rm`, `branch -D` and `stash drop/clear` were removed again on 2026-10-12, entry above).
- Accepted over-blocks: `git clean -n` (even the dry run), editing `.env.example`, reading a project `.npmrc`, editing `.envrc`.
- A deny with a trailing `:*` (`git push * :*`) never matched when tested with `claude -p`, so it was dropped; `git push origin :branch` is covered by the `git push *` ask rule and the classifier.
- `rm *` was an ask rule (the user's "confirm before deleting") until 2026-10-12 (entry above).
- Reading secrets through Bash (`cat .env`) is left to the `hard_deny` rule and the classifier; `Read` deny rules do not apply to Bash.

### Not adopted this round
- A `git-guard` hook (the classifier plus the deny backstop cover it), the Bash sandbox and `autoMode.classifyAllShell` (no allow rules to suspend; the sandbox is not available on native Windows), a `PermissionDenied` logging hook or dashboard tab (use `/permissions` → Recently denied), dashboard CSP/SSE/new features (feature freeze), an ADR folder (this file is enough for one person).

### Docs: one runbook, one decision log, one evidence file
- `docs/GUIDE.md` is the only runbook, `docs/DECISIONS.md` this log, `docs/evidence.md` the verbatim measurements. `docs/NEXT-MACHINE.md` was split into them; the dated status table, the "remaining work" list and the repository history were dropped (git keeps them).

## 2026-10-11 — earlier

### Prompt cache TTL 1 hour for the main thread and for subagents (PR #46)
- `promptCacheTtl` and `subagentPromptCacheTtl` are `"1h"`; `autoCompactWindow` is 400000. No measured benefit yet: this is a trial. Check after 3–7 days in `/usage` (Behavior flags, Attribution); drop `subagentPromptCacheTtl` if short subagents dominate. Details: `docs/evidence.md`.

### `agentPushNotifEnabled: true` is in the shared settings
- The desktop app writes it; without it `apply.sh` used to delete it. The key is not in the public docs.

### Model lanes unchanged: Sonnet main, Opus advisor, Haiku only where it was measured
- `publisher` and `explorer` run on Haiku; `backend`, `frontend`, `worker`, `qa`, `reviewer` on Sonnet (a false pass costs more than the saving). Single runs per scenario are not statistics. Fable is never a default, subagent or advisor: it draws from the same weekly pool (at most 50% of it) and is picked by the user for one hard task.

### `.env` can leak through recursive search, so agents exclude it
- `Read` deny does not stop `grep -r`. The Bash-using agents are told to exclude `.env*` and credential files and not to print them; effect not proven (rare event). The auto-mode `hard_deny` adds a second layer.

### Dashboard structure
- One process entry (`procs.py`), `TtlCache`, `Fix`/`FixRegistry`, `Source` list, ES-module UI with a `Tab` per screen. Feature freeze until the 2026-10-11 refactor and the Mac run are finished.

## 2026-10-10

### Role agents and planning skills
- `publisher`, `frontend`, `backend`, `qa` were added (reverses "no role agents"); planning and design stay in the main thread as the skills `spec-writing` and `design-spec`, because subagents cannot ask the user. Agent teams stay off.

### One global hook beyond RTK: `secret-guard`
- Reason: a public repository once held `~/.claude` snapshots; sentences and `Read` deny did not stop `git add -A`. The daily routine also checks public repositories for secret file names.

### Orchestrator.inc (AO) is a candidate, not adopted (candidate 2026-10-09, measured 2026-10-10)
- Measured on a disposable repository (parallel workers with disjoint files, ask/deny rules held, push attempts stopped at ask rules). Permission is a project setting: `ao project set-config <id> --permission auto` (replaces the whole config). Not compared with Claude Code worktrees.

## 2026-10-09

### Ponytail always on; Archify only on request
- Ponytail costs about 641 tokens a session plus Node hooks; Archify is installed after review and used for diagrams only.

### Daily routine on every machine, Sonnet, read-only
- `reports/` and `state/` are local and gitignored, so machines do not mix baselines and `git pull` never conflicts.

### Rules for orchestration live in the `orchestrate` skill, not in `CLAUDE.md`
- Needed only sometimes (best-practices: occasional knowledge goes in a skill). Description matching is probabilistic; `/orchestrate` is the fallback.

### Deny covers dangerous paths only; ask rules enforce "confirm before push" (delete left to the classifier since 2026-10-12)
- No blanket `rm -rf *` deny (it would block requested clean-ups). Every Bash rule has an `rtk ` twin because RTK rewrites commands before rules are evaluated (`bash scripts/qa-deny.sh --static` checks it, `qa-deny.sh` tests it).

### Changes go through a branch and a PR, Claude merges (changed 2026-10-12)
- The user lets Claude merge a PR itself, after CI is green on the head, the PR is mergeable and the reviewer subagent has no open findings. Push stays after approval; no force push; no merge of a PR with red CI or a conflict.
- Replaces "a person merges" (2026-10-09). Undo: restore that wording in root `CLAUDE.md`, `docs/GUIDE.md` and this entry.

## Settings notes (facts that explain the values in `claude/settings.json`)

- `effortLevel: high`: the official default is medium and xhigh costs more tokens; change it mid-session with `/effort`.
- `autoCompactWindow: 400000`: compaction at 400K tokens instead of about 967K on a 1M-token model. The reason is the best-practices advice that a full context degrades quality; the value is not measured. Raise it toward 600000 if compaction is too frequent. Precedence: env `CLAUDE_CODE_AUTO_COMPACT_WINDOW` > `--autocompact` > `/autocompact` (stored per model in `modelSettings`, a machine-only key that `apply.sh` keeps) > this key.
- `promptCacheTtl` and `subagentPromptCacheTtl` need Claude Code 2.1.242 or newer. Precedence: `FORCE_PROMPT_CACHING_5M` > env `CLAUDE_CODE_PROMPT_CACHE_TTL` / `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` > the keys > `ENABLE_PROMPT_CACHING_1H` (not used: it also raises compaction and subagent requests and only adds write cost).
- `explorer` uses `omitClaudeMd` (2.1.271 or newer); the status line needs 2.1.251 or newer and `jq`.
- `autoUpdatesChannel: latest` and `enableAllProjectMcpServers: false` were removed (2026-10-09) because they equal the defaults; an explicit `false` would not protect anything, since a project setting overrides the user setting.
- `rtk init -g` is not required (the hook is already in `settings.json`) and may rewrite it; compare `settings.json` before and after if you run it.
