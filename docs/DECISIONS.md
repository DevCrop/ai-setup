# Decisions

One entry per decision that still shapes this setup: the choice, why, and how to undo it. Newest first. Long measurements and the original wording are in `docs/evidence.md` (Korean, verbatim); the runbook is `docs/GUIDE.md`. Change a decision in a PR that updates this file, the setting and the check in `scripts/verify.sh` together.

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
- Handoff note: `.claude/handoff.md` in the project, never committed (this repo's `.gitignore` lists it; the rule tells the model to say so when a project does not). It is per machine, so it is also posted as a comment on the work's open PR, without secrets or machine-local paths; the user gave this standing approval on 2026-10-12 after a note stayed on one PC (it is the exception to "send anything outward only after approval"). Without a PR the model says the note is on this machine only.
- claude-mem retention: no automatic deletion, prune by hand. Revisit when size or search quality degrades. Not checked: whether claude-mem can delete by age and under which setting; read its docs before choosing an automatic policy.
- Undo: remove the lines from `claude/CLAUDE.md`, the `.claude/handoff.md` line in `.gitignore` (optional, it is harmless) and this entry in one PR.

### Permission mode is `auto`, not `bypassPermissions`
- Why: the permission-modes doc recommends auto for working without prompts and documents bypass for isolated containers and VMs only. Deny rules apply in every mode, ask rules always prompt, and a classifier (which also reads `CLAUDE.md`) reviews the rest. Replaces the 2026-10-10 bypass decision.
- Layers: deterministic (`permissions.deny`, `permissions.ask`, the `secret-guard` hook) plus the `autoMode` block (environment, `soft_deny` for plugin installs, `hard_deny` for secret files; every array keeps `"$defaults"`). `permissions.allow` is empty.
- Needs Claude Code 2.1.295 or newer (`verify.sh --live` fails below). If auto is unavailable the session starts in Manual mode and the deterministic layer still holds.
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
- Added deny: `git clean` (any flags), `checkout`/`switch -f`, `reset --merge/--keep`, `push --force-with-lease`, `+refspec`, `--delete`/`-d`; Read of keys, `.netrc`, `.npmrc`; Edit of `.env*`, `.credentials*`. Added ask: `git -C/-c ... push` (not matched by `git push *`), `git restore`, `find -delete`, `shred`.
- Accepted over-blocks: `git clean -n` (even the dry run), editing `.env.example`, reading a project `.npmrc`, editing `.envrc`.
- A deny with a trailing `:*` (`git push * :*`) never matched when tested with `claude -p`, so it was dropped; `git push origin :branch` is covered by the `git push *` ask rule and the classifier.
- `rm *` stays an ask rule (the user's "confirm before deleting").
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

### Deny covers dangerous paths only; ask rules enforce "confirm before push or delete"
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
