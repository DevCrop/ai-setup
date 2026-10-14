# Decisions

One entry per choice that shapes this setup: what it is, why, how it is checked, and how to remove it. Entries describe the current setup only; git holds the history (when a choice was made and what it replaced). Entries are grouped by topic. The measurements behind an entry are in `docs/evidence.md` (Korean); the runbook is `docs/GUIDE.md`. Change a decision in a PR that updates this file, the setting and the check in `scripts/verify.sh` together.

## Models

### Model lanes: Opus orchestrates and verifies, Haiku executes
- What: `settings.json` `model` is `opus[1m]` (next entry) with `modelSettings.claude-opus-5-5.effortLevel: "medium"`; `worker`, `backend`, `frontend`, `explorer` and `publisher` run on Haiku; `qa` and `reviewer` run on Opus with `effort: high`; `advisorModel` is `opus`. There is no Sonnet lane. Fable is never a default, a subagent or the advisor: the user picks it for one hard task. The `orchestrate` skill, `claude/CLAUDE.md`, the routine target and the docs say the same. `verify.sh` asserts the main model and the Opus effort entry, and that every agent's `model` is `haiku`, `opus` or `inherit` (an allowlist: `sonnet`, `fable` and full model IDs fail).
- Why: the user chose Opus as orchestrator at medium effort and Haiku as executor, with no Sonnet or Fable. Verifiers run on Opus rather than Haiku because a false pass is the most expensive failure, and Opus reviews have found real defects the author missed. Fable draws from the same weekly pool as the other models (at most 50% of it, `docs/evidence.md`, "Fable 한도 정정"), so it stays a per-task pick.
- Effort: model-config says Opus 5.5 starts at `medium` and a top-level `effortLevel` in user settings does not apply to it, so `effortLevel: "high"` applies only to older models (for example a Fable session the user picks); `modelSettings` states Opus's level explicitly. `apply.sh` merges `modelSettings` key by key, so levels a machine saved for other models and other fields of the Opus entry (`autoCompactWindow` from `/autocompact`, `maxEffortLevel`) stay; `apply.sh` and `verify.sh --live` report only the fields this repo sets. The repo owns Opus's `effortLevel`: a level saved with `/effort` (Enter) is reset by the next `apply.sh` and reported by `verify.sh --live` until then. For one session, pick the level with `s` (this session only) instead.
- Aliases (model-config, "Model aliases"): on the Anthropic API `opus` and `haiku` resolve to Opus 5.5 and Haiku 5.5. On Bedrock and Google Cloud's Agent Platform `opus` is Opus 5.5 and `haiku` is Haiku 4.5; on Microsoft Foundry `opus` is Opus 4.6. Haiku 4.5 has no effort support, so `effort` on the executors does nothing there.
- Evidence against: one full role QA with `QA_AGENT_MODEL=haiku` (`docs/evidence.md`, "모델 배치 재검토") failed `backend`'s `be-security` case on Haiku. It was a single run; the user's decision overrides it, and BACKLOG R2 re-measures it.
- Not measured: cost and quality of these lanes on this setup's jobs (BACKLOG R2: `bash scripts/bench.sh` and `QA_AGENT_MODEL` comparisons in `scripts/qa-role-agents.sh`). Caveat: both pass `--settings claude/settings.json`, and a top-level `effortLevel` given that way applies to every model without a `modelSettings` entry, so agents without an `effort` field (worker, explorer) may run at `high` there but at their default live (inferred from the settings reference; not verified). Advisor calls need counting too: one advisor call cost about 3.6 main calls (`docs/evidence.md`), and with Opus main the advisor is no longer a stronger model. The dashboard's efficiency hint (`scripts/dashboard/efficiency.py`) states the lanes and quotes no numbers until R2 measures them; the dashboard's main effort reads the main model's `modelSettings` entry.
- Undo: to change the lanes, set `model`, `modelSettings` and each agent's `model` in one PR; change the lanes line in the `orchestrate` skill and `claude/CLAUDE.md`, the routine `Model:` line, the model lines in README and GUIDE, the `verify.sh` lane checks and the `modelSettings` assertions in `scripts/qa-apply.sh` (case 10, 10a, 10c). To stop setting Opus's level, also add `["modelSettings","claude-opus-5-5","effortLevel"]` to `scripts/removed-keys.json`, otherwise the live level stays as a machine-only key.

### `model` is spelled `opus[1m]`
- What: `claude/settings.json` `model` is `opus[1m]`; `verify.sh` asserts it, and the dashboard's main-effort lookup strips a `[1m]` suffix before it matches `modelSettings`.
- Why: `claude plugin list`, which `verify.sh --live` runs, rewrites `opus` to `opus[1m]` on a fresh config, and `apply.sh` would revert it on every run. Model-config's alias table says `opus[1m]` has "No effect when `opus` already resolves to Opus 4.7 or later with its native 1M window", and the alias resolves to Opus 5.5. Settings reference: `modelSettings` "matches that model's alias, date-suffixed, `[1m]` ... IDs to the same entry", so `modelSettings.claude-opus-5-5` still applies. Why the CLI adds the suffix is not documented.
- Undo: set `model` to `opus` and change the `verify.sh` check; the `[1m]` strip in `inventory.py` is harmless and can stay.

## Permissions and safety

### Permission mode is `auto`, not `bypassPermissions`
- Why: the permission-modes doc recommends auto for working without prompts and documents bypass for isolated containers and VMs only. Deny rules apply in every mode, ask rules always prompt, and a classifier (which also reads `CLAUDE.md`) reviews the rest.
- Layers: deterministic (`permissions.deny`, `permissions.ask`, the `secret-guard` hook) plus the `autoMode` block (environment, `soft_deny` for plugin installs, `hard_deny` for secret files; every array keeps `"$defaults"`). `permissions.allow` is empty.
- Needs Claude Code 2.1.295 or newer (`verify.sh --live` fails below). If auto is unavailable the session starts in Manual mode and the deterministic layer still holds.
- Locked by `permissions.disableBypassPermissionsMode: "disable"` (next entry).
- Undo: change `permissions.defaultMode`, remove `disableBypassPermissionsMode` as its entry says, and change the assertions in `verify.sh`, in one PR.

### `permissions.disableBypassPermissionsMode: "disable"`
- What: bypass mode cannot be selected in sessions that read `~/.claude/settings.json` from this repo. `apply.sh` and `verify.sh` own the key (`scripts/owned-keys.json`), and `verify.sh` asserts it.
- Why: auto mode alone is a convention; the permissions doc says a user "can set it in their own settings to lock themselves out of bypass mode". Bypass stays for isolated containers and VMs that do not run `apply.sh` (`docs/GUIDE.md`, Permission mode).
- Undo: remove the key from `claude/settings.json` and the `verify.sh` assertion, but keep it in the `permissions` list of `scripts/owned-keys.json` (read by the `apply.sh` merge and report and by `verify.sh --live`): that is what makes `apply.sh` delete the live value. Removing it from that list too, or applying from an older commit, leaves the lock live; then list `["permissions","disableBypassPermissionsMode"]` in `scripts/removed-keys.json`.

### Deny covers dangerous paths only; every Bash rule has an `rtk ` twin
- What: no blanket `rm -rf *` deny: only the dangerous targets (`/*`, `~*`, `$HOME*`, `%USERPROFILE%*`) are denied. Every Bash deny and ask rule exists twice, plain and with an `rtk ` prefix, because RTK rewrites commands before permission rules are evaluated (`docs/evidence.md`, "RTK 훅과 deny 규칙").
- Why: a blanket deny would block clean-ups the user asked for.
- Accepted over-block: the `*` in `Bash(rm -rf /*)` spans slashes, so it blocks deleting any absolute path (`docs/evidence.md`, "deny 규칙 시험").
- Check: `bash scripts/qa-deny.sh --static` (every rule has its twin, no CLI) and `qa-deny.sh` (live cases). Undo: remove a rule together with its twin.

### Ask rules cover push only; `git -C`/`git -c` forms of the deny rules; `shred` denied
- What: `permissions.ask` holds only `git push *`, `git -C * push*`, `git -c * push*` (with `rtk ` twins). Every git deny rule (reset, clean, checkout, switch, restore, push variants) also exists as `git -C * <rule>` and `git -c * <rule>`; for `clean` the twins are `clean` and `clean -*` (a bare `clean*` tail would also match ` cleanup` in a message), plus `git -c *equire*orce* clean*` and `git -C * -c *equire*orce* clean*`, because `git -c clean.requireForce=false clean .` deletes untracked files without a flag; the second rule covers `-C dir` before `-c` (a leading `git *` would also match a plain `git commit` whose message quotes the command), and `equire*orce` covers the usual spellings (`requireForce`, `RequireForce`, `requireforce`), since git config keys ignore case but rule matching does not. `shred *` is denied.
- Why: the user works without permission prompts; push stays because "send anything outward only after approval" is a standing rule. Without the `-C`/`-c` forms, `git -C . reset --hard` and `git -c x=y clean -fdx` match no rule. `shred` has no legitimate use here and cannot be undone, so it is denied rather than left to the classifier.
- Left to the classifier and the chat-confirmation lines in `claude/CLAUDE.md` (Safety): `rm` (except the `rm -rf` home and root deny rules), `git branch -D` (recoverable from the reflog), `git stash drop`/`clear` (recoverable only with `git fsck --unreachable`, until gc), `git restore <file>` (`restore .` stays denied), `find -delete`.
- Accepted over-block: the `*` in `git -C * <tail>` spans words, so a `git -C`/`git -c` command whose text later contains a denied tail is denied too, for example `git -C repo commit -m "explain reset --hard"` or `git -C repo log -S "push --force"` (reproduced with `claude -p`). Deny rules cannot express exceptions, and narrowing them would reopen the gap. The ask rules `git -C * push*` and `git -c * push*` over-match the same way (`git -C repo commit -m "push fix"` prompts; in a `-p` run the prompt is a denial). Work around it with `cd <dir> && git commit ...` or `git commit -F <file>`.
- Not covered: `git -C dir clean <path>` in a repository whose own config sets `clean.requireForce=false`, spellings with other capitals such as `REQUIREFORCE`, global options before `-c` such as `git --no-pager -c ...`, `git --no-pager reset --hard` and `git reset HEAD --hard` (left to the classifier).
- Check: `qa-deny.sh --static` (every rule has its twin) and the `qa-deny.sh` cases (`git -C . reset --hard HEAD`, `git -c x=y clean -fdx`, `git -c clean.requireForce=false clean .` and its `-C . -c` and `RequireForce` forms, `git -C . push --force`, `git -c x=y -C . checkout -- f.txt`, `shred` blocked; `git stash clear`, `rm <file>` run). The live run needs the claude CLI and is not in CI: run `bash scripts/verify.sh --live --full` on each machine.
- Undo: to prompt for more, add ask rules with their `rtk ` twins (for example `git branch -D *`, `git stash drop *`, `git stash clear *`, `rm *`, `git restore *`, `find * -delete*`) and change the matching `qa-deny.sh` cases; to allow `shred`, remove its deny rules.

### The deny backstop is deliberately broad, with accepted over-blocks
- Denied: `git clean` (any flags), `checkout`/`switch -f`, `reset --merge/--keep`, `push --force-with-lease`, `+refspec`, `--delete`/`-d`; Read of keys, `.netrc`, `.npmrc`; Edit of `.env*`, `.credentials*`.
- Accepted over-blocks: `git clean -n` (even the dry run), editing `.env.example`, reading a project `.npmrc`, editing `.envrc`.
- A deny with a trailing `:*` (`git push * :*`) never matched when tested with `claude -p`, so there is none; `git push origin :branch` is covered by the `git push *` ask rule and the classifier.
- Reading secrets through Bash (`cat .env`) is left to the `hard_deny` rule and the classifier; `Read` deny rules do not apply to Bash. Deny and ask rules are not a security boundary (`docs/evidence.md`, "deny/ask 규칙은 보안 경계가 아니다").
- Undo: remove a rule with its `rtk ` twin and its `qa-deny.sh` case.

### Home-folder secrets are denied with `~/` patterns
- What: `Read(~/.ssh/**)`, `Read(~/.claude/.credentials*)`, `Read(~/.netrc)`, `Read(~/.npmrc)`, `Read(~/.aws/credentials)`, `Read(~/.env*)` and `Edit(~/.claude/.credentials*)` are in the deny list.
- Why: the permissions doc's pattern table says a pattern without `/`, `~/` or `//` is relative to the current directory, so `Read(**/.netrc)` does not match `~/.netrc` from inside a project (not probed with `claude -p`; the rules follow the table).
- Undo: remove the seven `~/` rules.

### One secret list: the Read deny rules, the hard_deny text and `secret-guard` name the same files
- What: every file name `secret-guard.sh` `is_secret()` blocks from a commit also has a `Read(**/...)` deny rule in `claude/settings.json`, and the `autoMode.hard_deny` text names each of those rules. The list includes `*credentials*.json`, `*.pem.*`, `id_ecdsa*`, `id_dsa*`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, `*.keystore`, `.pypirc`, `.pgpass`, `.htpasswd`, `.git-credentials`, `*.tfstate`, `secrets.yaml`, `secrets.yml`, `.aws/credentials`.
- Why: three lists that disagree leave gaps, for example a `*.key` file that can be read but not committed.
- Accepted differences: `.claude.json` and `history.jsonl` are commit-only (kept readable for inspecting Claude's own config and history); `~/.ssh/**` and the other `~/` rules are Read-only (they are outside any repository). Accepted over-blocks on reading: `*.key` also matches Keynote documents, `*credentials*.json` also matches `credentials.example.json` and `*.schema.json` (the `.example` exception does not apply because the name ends in `.json`), and `secrets.yaml` also matches Helm chart templates and SOPS-encrypted files; ask the user to open such a file.
- Check: the S5 block in `scripts/qa-hooks.sh` (sample names in all three lists, every Read glob named in hard_deny). Undo: remove a name from all three lists and the block's sample in one PR.

### `.env` can leak through recursive search, so agents exclude it
- What: the Bash-using agents (`worker`, `reviewer`, `publisher`, `frontend`, `backend`, `qa`) exclude `.env*` and credential files when they search or list, never print them, and report it when output shows their contents anyway. The auto-mode `hard_deny` is a second layer.
- Why: `Read` deny does not stop `grep -r`, and a recursive search once printed a test secret from `.env` (`docs/evidence.md`, "`.env` 노출 경로"). The effect of the rule is not proven (a rare event).
- Check: the `env-search`, `env-worker` and `env-reviewer` cases of `scripts/qa-role-agents.sh`. Undo: remove the lines from the agents and the cases.

## Hooks

### `secret-guard` blocks committing secret files and fails closed
- What: `claude/hooks/secret-guard.sh` (PreToolUse) judges `add`, `stage`, `commit`, `push`, `update-index`, `mv`, `apply --index`, `am`; reads git output NUL-separated; treats `$()`, variables and `xargs`/`find -exec` feeding `git add` as "everything pending". It fails closed (exit 2, plus `onFailure: "block"` and `timeout: 30` in settings) when jq or git is missing or the hook input is not JSON, but only for commands that mention a staging verb; commands without a git word are never touched. The daily routine also checks public repositories for secret file names (step 7b).
- Why: sentences in `CLAUDE.md` and `Read` deny rules do not stop `git add -A`; a public repository once held `~/.claude` snapshots (`docs/evidence.md`, "비밀 유출 방지").
- Not checked: `git stash -u` (stays local). Known: a plain `git commit -m x` is blocked while a tracked secret-named file is modified but unstaged.
- Accepted limit: it reads command text, so it is a guard rail, not a boundary (`docs/GUIDE.md`, Secret-guard hook).
- Check: `bash scripts/qa-hooks.sh`. Undo: remove its entry from `claude/settings.json` and the hook file in a PR.

### SessionStart `compact` hook re-injects the handoff note; ConfigChange hook logs edits outside this repo
- What: `claude/hooks/compact-context.sh` and `claude/hooks/config-audit.sh` (`docs/GUIDE.md`, Session hooks); `verify.sh --live` reads `config-changes.log`; `docs-watch.sh` and the routine watch the hooks reference page.
- Why: best-practices and hooks-guide ("Re-inject context after compaction") recommend a deterministic hook over an advisory line, and the security page recommends auditing settings changes with ConfigChange hooks. The audit hook only logs: its output is never shown (hooks reference, "ConfigChange decision control"), and blocking would also block the app's own writes (theme, plugins) and `apply.sh`.
- Checked: `qa-hooks-session.sh` (note found from a subfolder and from a worktree cwd, home folder skipped also through a symlink with a trailing slash, 9 KB note cut under the 10,000-character cap without splitting a Korean character, broken input, project skills not logged, a newline in `file_path` cannot forge a line, rotation; mutations of the cut, the home stop and the config-dir filter each fail it), `qa-apply.sh` case 10b (a change within 2 minutes of apply is not reported, a later one is). Not checked here: a real `/compact` in a session (`docs/GUIDE.md` local checklist L-13).
- Undo: remove the two hook files, the `SessionStart` and `ConfigChange` entries in `claude/settings.json`, check 3d and 9b in `verify.sh`, case 10b in `qa-apply.sh`, `scripts/qa-hooks-session.sh` and its README row, the GUIDE "Session hooks" section, the hooks in the GUIDE "Always on" row and check L-13, and the `hooks` page in `docs-watch.sh` and the routine. `apply.sh` then deletes the hook files from `~/.claude/hooks/` (manifest); delete `~/.claude/config-changes.log` by hand on each machine.

### `compact-context.sh` stops at the nearest project without a note, except a linked worktree
- What: when the walk from the input `cwd` ends at a project mark without a note, the hook stops and does not fall back to `CLAUDE_PROJECT_DIR`. A folder whose `.git` file points into `.git/worktrees/` (a linked git worktree) is not a stop; a submodule (`.git/modules/`) is, so a worktree session still reaches its main checkout's note.
- Why: a nested project must never get its parent's note, and a worktree must still get its main checkout's note (GUIDE: "follows Claude into a worktree").
- Limit: a linked worktree of a different repository nested inside a project also walks on to that project's note; the printed header asks the model to check the note is about the current task.
- Check: the nested-project and worktree cases in `qa-hooks-session.sh`. Undo: in `find_note`, return plain instead of `2` and drop the worktree branch; drop `stop` in the caller; remove those cases and the GUIDE clause.

## Rules, agents and skills

### Working rules in `claude/CLAUDE.md`: commits, tests, handoff note, claude-mem retention
- Commits: English Conventional Commits (`type: summary`, body gives the reason and the check). Code comments in English; text the user sees keeps the project's language. Why: one format keeps tools and the log consistent.
- Tests: a bug fix starts with a reproducing test; new logic with a branch, a parser or a security effect ships with a test. Not "every change": exploratory work, docs and settings do not need it.
- Handoff note: `.claude/handoff.md` in the project, never committed (this repo's `.gitignore` lists it; the rule tells the model to say so when a project does not). It is per machine, so it is also posted on the work's open PR (entry below).
- claude-mem retention: no automatic deletion, prune by hand. Revisit when size or search quality degrades. Not checked: whether claude-mem can delete by age and under which setting; read its docs before choosing an automatic policy.
- Undo: remove the lines from `claude/CLAUDE.md` and, optionally, the `.claude/handoff.md` line in `.gitignore` (it is harmless).

### The handoff note is also posted on the work's own open PR (standing approval)
- What: besides `.claude/handoff.md`, the note goes in a comment on the work's open PR in a repository the user owns, without secrets or machine-local paths; without such a PR the model says the note is on this machine only. `claude/CLAUDE.md` names it as the one exception to "send anything outward only after approval".
- Why: a note in `.claude/handoff.md` stays on one machine while the work may continue on another. The user gave this standing approval.
- Undo: remove the sentence from the handoff line and the exception from the Safety line in `claude/CLAUDE.md`.

### The project is found from the cwd by its marks, never from a fixed path
- What: `claude/CLAUDE.md` (Working method): projects live under a per-machine work root as `<client>/<stage>/<date or name>`; the project is the nearest folder at or above the cwd with `.git`, `CLAUDE.md`, `AGENTS.md` or `.claude`, searching no higher than the work root or the home folder, which are never projects. The marks are the dashboard's (`scripts/dashboard/projects.py`); the work root is what the dashboard and `bootstrap.py` call a project root.
- Why: project folders sit one to three levels deep and the root differs per machine; `~/.claude` would otherwise make the home folder a project.
- Open: the same line in `codex/global/AGENTS.md` (BACKLOG section 6, `docs/codex-alignment.md`).
- Undo: remove the line from `claude/CLAUDE.md`.

### Built-in Concise output style, plus plain-language lines in `claude/CLAUDE.md`
- What: `claude/settings.json` sets `"outputStyle": "Concise"` (built-in, Claude Code 2.1.237 or newer; the name is case-sensitive). `claude/CLAUDE.md` Communication has three lines: plain words with technical terms explained, tables and long lists only when asked or comparing three or more items, at most one question at the end.
- Why: the user finds long replies hard to read. The output-styles page names Concise for when "Default responses are longer than you want"; it leads with the result and drops narration and recaps, but does not ask for plain words, fewer tables or fewer questions, so the CLAUDE.md lines add only those (they also reach subagents, which output styles do not). Completion reports still keep the conditions and what was not verified (Working method). Errors, failing tests, security warnings and destructive-action confirmations stay full length (the same page). The third-party `caveman` skill is not used: it saves tokens with fragment prose, which reads harder.
- Limits: an output style is an instruction, not a guarantee; it does not change the replies of subagents other than a fork (they run their own system prompt). Not measured.
- Check: `scripts/verify.sh` asserts `outputStyle == "Concise"`. Undo: remove the key, the three lines and the check. Source: https://code.claude.com/docs/en/output-styles.

### Role agents and planning skills
- What: the agents `explorer`, `reviewer`, `worker`, `publisher`, `frontend`, `backend`, `qa`. Planning and design stay in the main thread as the skills `spec-writing` and `design-spec`, because subagents cannot ask the user. Every executor (`worker`, `publisher`, `frontend`, `backend`) refuses to commit, push or install "even when the brief asks you to", and treats an input the brief calls assumed or temporary as missing. Agent teams stay off.
- Why: official docs (sub-agents, agent-teams; `docs/evidence.md`, "역할 에이전트"): subagents cannot use `AskUserQuestion`, role knowledge is shared through `skills:`, and teammates do not get a definition's `skills:`. The executor lines come from role-agent QA runs where a delegate followed a brief's "commit and push" or built on an invented contract (`docs/evidence.md`, "역할 보강").
- Check: `bash scripts/qa-role-agents.sh <dir>` (`QA_MODE=selftest` for the grader). Undo: remove an agent file; `apply.sh` deletes the applied copy (manifest).

### Rules for orchestration live in the `orchestrate` skill, not in `CLAUDE.md`
- Needed only sometimes (best-practices: occasional knowledge goes in a skill). Description matching is probabilistic; `/orchestrate` is the fallback. `claude/CLAUDE.md` keeps one line that holds every turn: never invent an input a delegate needs.
- Undo: move the skill's rules into `claude/CLAUDE.md` and delete the skill.

### `when_to_use`, agent colors, and the official limits checked by `verify.sh`
- What: `orchestrate`, `spec-writing` and `design-spec` have `when_to_use` with example requests in Korean and English (skills doc: "trigger phrases or example requests"; it is appended to `description` and shares its 1,536-character cap). Each agent has a `color` (sub-agents doc; display only). `verify.sh` checks: `description` + `when_to_use` within 1,536 characters, `SKILL.md` within 500 lines ("Keep SKILL.md under 500 lines"), agent names unique, at most 256 characters, not starting with `-` and without `:` (sub-agents doc: such a file is skipped), a `when_to_use` written over several lines (the check reads one line), and the combined agent descriptions against the 15,000-token startup warning (WARN above 15,000 characters, an approximation). Characters are counted as UTF-8 characters in any locale.
- Why: model-invoked skills load by description match, which is the known weak spot (entry "Rules for orchestration live in the `orchestrate` skill"); nothing else enforces the limits.
- No check that an agent's `name` equals its file name: the sub-agents doc says "The filename doesn't have to match".
- Undo: remove the `when_to_use` and `color` lines, the checks in `verify.sh` sections 6 and 7 with their helpers (`chars`, `fm_value`, `fm_multiline`), and the `when_to_use` part of the skill check in `scripts/dashboard/inventory.py`.

### Worktree isolation stays conditional
- What: no agent sets `isolation: worktree` in its frontmatter; the `orchestrate` skill (step 5) uses it only when two delegates cannot be kept off the same files.
- Why: the sub-agents doc suggests worktrees for file-changing agents, but a worktree branches from the default branch, so the delegate does not see uncommitted work in the main thread, which is the usual state when a part is delegated. Splitting by file gives the same safety without that.
- Undo: add `isolation: worktree` to the file-changing agents and drop the condition in step 5.

### `project-setup` recommends no plugin
- What: `project-setup` step 9 says "do not install or recommend any plugin"; code intelligence plugins, which the best-practices and costs pages suggest for typed languages, are not proposed.
- Why: a plugin is a decision for the user, and the plugin pinning decision covers only Ponytail and claude-mem.
- Undo: let step 9 propose a plugin, pinned like the others.

### Superpowers is not adopted at any scope
- Why: its SessionStart hook injects a bootstrap on every start, clear and compact, and its 15 skill descriptions load every turn; its skills are written to over-trigger ("1% chance -> MUST invoke") and its TDD rule does not fit infra, config or legacy code without a test harness. The small skills it offers (verification, debugging, review) repeat rules `claude/CLAUDE.md` already has. The always-on cost and the Windows risk were never measured.
- Guard: `verify.sh` fails when `settings.json` enables it and warns (`--live`) while it is installed; `scripts/removed-keys.json` deletes the key on apply.
- Undo: drop the guard and the `removed-keys.json` entry, then install it per project.

## Plugins

### Ponytail is always on
- Ponytail costs about 641 tokens a session plus Node hooks (`claude plugin details ponytail`); the user wants it on in every session. `/ponytail off` turns it off for one session. The daily routine reports it as unhealthy when it is missing or disabled.
- Undo: remove its `enabledPlugins` entry and marketplace from `claude/settings.json`, the routine's health check and the `verify.sh` Ponytail check.

### Third-party plugins are pinned to a commit in an inline marketplace
- What (user choice: pin both plugins at a release rather than each machine taking upstream's newest): `extraKnownMarketplaces` declares `ponytail` and `thedotmack` as `settings` (inline) marketplaces, each with one plugin whose source carries a release tag as `ref` and its full commit as `sha`: Ponytail `url` source, claude-mem `git-subdir` source (`plugin/`). The keys and plugin ids equal the upstream ones, so `enabledPlugins` and installed data stay.
- Why: without a pin, an upstream push runs code on every machine at the next install or update. An inline catalog pins without a fork or a marketplace repository to keep.
- Sources: `url` and `git-subdir` with `https://` URLs, not `github` or `owner/repo` shorthand: in a rehearsal (Claude Code 2.1.296, empty `CLAUDE_CONFIG_DIR`) those two cloned over SSH and failed without a GitHub host key, while the https URLs installed both plugins at the pinned commit. Changing the source of an installed marketplace kept both plugins and their data folder.
- Existing installs: `claude plugin update` replaces a plugin when the version it computes differs from the installed one, higher or lower (docs `plugins/loading`, "Versions and updates"; for an install of the same version string at another commit it prints "already at the latest version"). So an install older than the pin needs one `claude plugin update <id>` after `apply.sh` (back up `~/.claude-mem` first); an install of the same version at another commit stays as it is; an install newer than the pin must not be updated (it would move claude-mem back). The daily routine tells the three apart.
- Upgrades: the weekly `updates` workflow opens a PR that changes `ref` and `sha` (entry "Pinned versions move by a weekly PR"); after merge, apply, then `claude plugin update <id>`. The daily routine reports a newer release tag and never edits the pin. Never move claude-mem to an older version (it migrates its database); back up `~/.claude-mem` before an upgrade.
- If upstream force-pushes or deletes the repository, fresh installs of the pinned commit break (installed copies keep working); fork the repository then and point the `url` at the fork.
- Limits: `claude plugin marketplace add` cannot register an inline marketplace; Claude Code registers it when a session starts, so a new machine opens one session after `apply.sh` before `claude plugin install`. A plugin cache path longer than the Windows path limit fails (claude-mem has deep test fixtures); `~/.claude` is short enough.
- Undo: replace the inline marketplaces with upstream `github` sources in `extraKnownMarketplaces` (installs then follow upstream's newest), and drop the pin steps in GUIDE, the daily routine, `scripts/update-pins.py` and the `verify.sh` hint.

## Apply and settings

### `apply.sh` merges `settings.json` and keeps no backup
- What: this repo owns `permissions.{defaultMode,disableBypassPermissionsMode,deny,ask,allow}`, `autoMode`, `hooks`, `statusLine`, `extraKnownMarketplaces`, `skillOverrides`, the fields it sets inside `modelSettings` entries and every other key it sets; machine-only keys are kept and reported; `scripts/removed-keys.json` deletes listed keys (the Superpowers plugin entry and `skipDangerousModePermissionPrompt`, which `verify.sh` also asserts absent); a manifest removes files the repo dropped (files of an item dropped from the copy list are only reported) and never deletes through a symlink or outside the config directory. A live owned key of the wrong type is replaced by `apply.sh` (qa-apply case 10d) and reported as a FAIL by `verify.sh --live`.
- Why: a whole-file copy would delete keys the app writes (theme, `enableWorkflows`, `agentPushNotifEnabled`, plugin entries).
- No backup: git is the history. Rollback is "check out the older commit, apply again". Owned keys (`permissions.*`, `autoMode`, `hooks`, `statusLine`, `extraKnownMarketplaces`, `skillOverrides`) and tracked files return exactly, as long as the older commit's `apply.sh` owns them: a key that only a newer `apply.sh` owns (the bypass lock) stays live: add it to `removed-keys.json` in that checkout before applying, or undo in a forward PR. Other keys do not go back: a key the repo set (`model`, `theme`, the cache TTLs, ...) keeps its live value when the older commit lacks it, unless `scripts/removed-keys.json` lists it; so do plugins enabled since and machine-only keys.
- `scripts/setup-claude-mem.sh` writes a timestamped `.bak-<time>` next to the file it edits: that file lives outside this repo and has no other history.
- Undo: replace the merge in `apply.sh` with a whole-file copy plus a backup, and change `verify.sh --live` to compare whole files.

### The apply manifest is `~/.claude/.ai-setup-manifest`
- What: `scripts/apply.sh` records the files it copied in `.ai-setup-manifest`. A manifest under the name before the ai-setup rename (`.claude-global-manifest`) is moved to the new name once, when the new one does not exist (a dry run only reports `would rename`); when both exist the new one is used and the old one is left alone. `verify.sh --live` reads the new name and warns "run apply.sh" while only the old one exists.
- Check: case 13 in `scripts/qa-apply.sh`; the `verify.sh` warning has no test.
- Undo: drop the migration block in `apply.sh` and the warning in `verify.sh` once no machine has the old file.

### `$schema` in `claude/settings.json`
- What: `"$schema": "https://json.schemastore.org/claude-code-settings.json"` (settings page). Editors validate and complete the file. The settings page says the schema can lag behind new keys, so a warning on a recently documented key is not an error.
- Undo: remove the line and add `["$schema"]` to `scripts/removed-keys.json`; otherwise `apply.sh` keeps the live copy as a machine-only key.

### Prompt cache TTL 1 hour for the main thread and for subagents
- `promptCacheTtl` and `subagentPromptCacheTtl` are `"1h"`; `autoCompactWindow` is 400000. It is a trial with no measured benefit; BACKLOG R1 checks `/usage` (Behavior flags, Attribution) and drops `subagentPromptCacheTtl` if short subagents dominate. Details: `docs/evidence.md`, "캐시 TTL 1시간".
- Undo: remove the two keys and add them to `scripts/removed-keys.json`.

### `agentPushNotifEnabled: true` is in the shared settings
- The desktop app writes it; setting it in the repo keeps it the same on every machine instead of reporting it as machine-only. The key is not in the public docs (`docs/evidence.md`).
- Undo: remove the key; `apply.sh` then keeps the app's value as a machine-only key.

### Settings notes (facts that explain the values in `claude/settings.json`)
- `effortLevel: high` does not apply to the Opus 5.5 main model (model-config: Opus 5.5 reads `modelSettings`, set to medium); it applies to older models. A level picked with `/effort` and Enter is reset by the next `apply.sh`; pick with `s` for one session.
- `autoCompactWindow: 400000`: compaction at 400K tokens instead of about 967K on a 1M-token model. The reason is the best-practices advice that a full context degrades quality; the value is not measured. Raise it toward 600000 if compaction is too frequent. Precedence: env `CLAUDE_CODE_AUTO_COMPACT_WINDOW` > `--autocompact` > `/autocompact` (stored per model in `modelSettings`; `apply.sh` keeps every field there except the ones the repo sets) > this key.
- `promptCacheTtl` and `subagentPromptCacheTtl` need Claude Code 2.1.242 or newer. Precedence: `FORCE_PROMPT_CACHING_5M` > env `CLAUDE_CODE_PROMPT_CACHE_TTL` / `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` > the keys > `ENABLE_PROMPT_CACHING_1H` (not used: it also raises compaction and subagent requests and only adds write cost).
- `explorer` uses `omitClaudeMd` (2.1.271 or newer); the status line needs 2.1.251 or newer and `jq`.
- `autoUpdatesChannel` and `enableAllProjectMcpServers` are not set: their values would equal the defaults, and an explicit `false` would not protect anything, since a project setting overrides the user setting.
- `rtk init -g` is not required (the hook is already in `settings.json`) and may rewrite it; compare `settings.json` before and after if you run it.

## Machines and tools

### The setup targets two Windows PCs; macOS is out of scope
- What: the setup runs on two machines, both Windows PCs. `scripts/` has no macOS code paths (no brew installs, no LaunchAgent, no `bootstrap.sh`), and CI has no macOS runner. The linux CI job stays (it runs the same scripts in bash). The darwin branches inside `codex/` (for example `setup.py`, `runtime/rtk_runner.py`, `tools.py`, `project_cleanup.py`, `rtk_dashboard.py`, `versions.lock.json` and their tests) stay, because some are owned files deployed to `~/.codex` and changing them needs a separate Codex apply; CI does not exercise them.
- Why: the user's choice; a macOS run would take very long for a machine that is not used.
- Undo: add macOS install and autostart paths to `scripts/toolreg.py` and `bootstrap.py`, `brew` keys to `tools.json`, and a macos CI runner.

### One hub, one registry: `tools.json` in this repo, per-machine values in `state/machine.json`
- What: every dependency and tool (git, python, node, jq, gh, rtk, claude, codex, ao) is one entry in `tools.json`: how to detect it, its minimum version, its setup checkout candidates and its winget id or install URL. `scripts/toolreg.py` reads it; `scripts/bootstrap.py` is the one entry point (`check`, `install`, `apply`, `verify`, `autostart`). A new tool is one entry.
- Why: each machine has different paths (project folders at different depths), so per-machine facts belong in `state/machine.json` on that machine, not in the repo or a PR comment; one registry keeps the setup steps in one place. The hub is this repo because it is cloned first on every machine.
- Rule: paths in `tools.json` use tokens (`${HOME}`, `${LOCALAPPDATA}`, `${REPO}`), never one user's path. Per-machine values go in gitignored `state/machine.json`. Precedence: setup checkouts `machine.json` > registry candidates, and an `inRepo` setup (`codex`) uses only its candidates; project roots `PROJECT_ROOTS` > `machine.json` `projectRoots` > `state/project-roots.txt` > `~/Projects` when it exists; binaries environment variable > `machine.json` > PATH > registry paths.
- Undo: delete `tools.json`, `scripts/toolreg.py`, `scripts/bootstrap.py`, `scripts/bootstrap.ps1`, `scripts/qa-bootstrap.py` and the "Tool registry and bootstrap check" step in both jobs of `.github/workflows/check.yml`; remove GUIDE quick path 1b and step 5, the "Adding a tool" line and the bootstrap mentions in `CLAUDE.md`, `README.md` and GUIDE section 0; `apply.sh --dry-run` (qa-apply case 11) can stay. The dashboard imports the registry too (`scripts/dashboard/codex.py`, `fixes.py`, and project roots through `toolreg.project_roots()`): undo those uses with it.

### Installs only what is missing, one y/N per item, never an upgrade
- What: `install` runs `winget install --id <id> --exact --no-upgrade`, only for items not found. A tool that is too old is reported with its upgrade command, not upgraded. `install`, `apply` and `autostart` show what they will do and ask y/N on the terminal; without one they refuse. A declined `apply` or `autostart` exits 1; `install` exits 1 when a required item is declined. `check --write` asks nothing: it only adds missing values to `state/machine.json`. `bootstrap.ps1` has no terminal check (BACKLOG section 8).
- Why: an upgrade can break what already uses the old version, and nothing should change a machine unattended.
- Checked: `scripts/qa-bootstrap.py` (CI, linux and windows) and `scripts/qa-apply.sh` case 11, the dry run writes nothing (runs in CI through `verify.sh`). Not checked: a real winget install.
- Undo: drop `--no-upgrade` in `toolreg.install_argv` and the `ask()` gate in `bootstrap.py`, with their qa-bootstrap cases.

### Daily routine on every machine, Opus, read-only
- What: `claude/routines/daily-update.md` runs as the scheduled task `daily-claude-update` on every machine, on Opus in auto mode, and only reads and reports. `reports/` and `state/` are local and gitignored, so machines do not mix baselines and `git pull` never conflicts. `scripts/docs-watch.sh` and the routine watch the official pages this setup depends on (the list is in routine step 8, model-config and advisor included).
- Undo: delete the scheduled task on each machine; remove `claude/routines/` and `claude/scheduled-tasks/`.

## CI and automation

### Changes go through a branch and a PR, and Claude merges
- The user lets Claude merge a PR itself, after CI is green on the head, the PR is mergeable and the reviewer subagent has no open findings. Push stays after approval; no force push; no merge of a PR with red CI or a conflict.
- Undo: require a person to merge: change root `CLAUDE.md`, `docs/GUIDE.md` and this entry.

### `check.yml` also runs every Monday and by hand
- What: `.github/workflows/check.yml` has a `schedule` trigger (Mondays 00:17 UTC, 09:17 KST) and `workflow_dispatch`, besides push to `main` and pull requests.
- Why: the user chose GitHub automation that runs the existing checks between PRs, so a change in the runner image, Python or a pinned tool shows up within a week. In a public repository GitHub disables a schedule after 60 days without repository activity (GitHub docs, "Disabling and enabling a workflow"); re-enable it from the Actions tab. Who is notified of a failed scheduled run follows the account's Actions notification settings (not verified here).
- Check: `scripts/verify.sh` fails when either trigger is missing. Undo: remove the two triggers and that check.

### Pinned versions move by a weekly PR
- What (user choice: automate with PRs, never install anything on a PC, changes land only after review and merge): `.github/workflows/updates.yml` runs every Monday at 00:47 UTC (09:47 KST) and by hand. It runs `python3 scripts/update-pins.py --write`, which moves the Ponytail and claude-mem plugin pins (`ref` and `sha` in `claude/settings.json`; newest stable `vX.Y.Z` tag from `git ls-remote --tags`, an annotated tag peeled to its commit), the Codex Ponytail skill (`codex/versions.lock.json` commit, version, the vendored files under `codex/vendor/ponytail/` and their sha256) and RTK (`codex/versions.lock.json`: the newest GitHub release, each asset name already locked downloaded and hashed; `release_plan` from `codex/scripts/tools.py` checks the release as GitHub returned it, and each locked asset needs a `sha256:` release digest equal to the downloaded bytes, or RTK is a failed source; other platforms are ignored). The Ponytail plugin and the Codex skill move together to the same tag or not at all; an upstream change to the skill's file set is reported for a manual update. It also records the newest release of the unpinned tools (Claude Code, Codex, Git for Windows, jq, GitHub CLI, Node.js LTS, Python, AO) in `docs/tool-versions.json` (Python: the newest patch of the minor that the `tools.json` winget id installs; a version that is not a plain version string is a failed source); the PR body lists which changed, with the `winget upgrade` id from `tools.json`. A job with a read-only token runs the script and uploads the changed files and the report as an artifact; a second job copies only `claude/settings.json`, `codex/versions.lock.json`, `codex/vendor/` and `docs/tool-versions.json` from it onto `main`. When anything changed, that job commits to the bot-owned branch `bot/updates` (force-updated each week), opens or updates one PR to `main` titled `chore: update pinned versions` with the report as its body, then runs `gh workflow run check.yml --ref bot/updates`, because a push or PR made with `GITHUB_TOKEN` starts no other workflow and `workflow_dispatch` is the documented exception. When nothing changed, upstream equals `main`, so it closes any open bot PR with a comment (merging it would change nothing or move pins back). A source that fails (network, rate limit) is listed in the report, the others are still written, and the run ends red. Only upward moves are made; a tag that now points at another commit is reported and left alone.
- Why: without it the pins move only when someone reads the daily report and edits them by hand. A PR keeps the review step and CI, and nothing reaches a PC before merge.
- Needs: the repository setting "Allow GitHub Actions to create and approve pull requests" (Settings, Actions, General, Workflow permissions) must be on, otherwise `gh pr create` fails. `check.yml` must keep its `workflow_dispatch` trigger, or the PR gets no checks.
- After merge, on each PC (docs/GUIDE.md): `git pull && bash scripts/apply.sh && bash scripts/verify.sh --live`; for a moved plugin pin the user backs up `~/.claude-mem` and runs `claude plugin update <id>`; the Codex skill and RTK follow `codex/README.md` (`setup.py` plan/apply, `tools.py install-rtk`). The tools in `docs/tool-versions.json` are upgraded with winget by the user.
- Check: `scripts/verify.sh` fails when `updates.yml` is missing its `schedule` or `workflow_dispatch` trigger or no longer runs `update-pins.py --write`; `scripts/qa-update-pins.py` (fake fetchers, in the linux CI job) covers newer and same versions, tag peeling, RTK hashing with only locked names and required release digests, a failing source, rejected version strings, the Python minor from `tools.json`, and the two Ponytail pins kept equal. The workflow itself runs only on GitHub.
- Undo: delete `.github/workflows/updates.yml`, `scripts/update-pins.py`, `scripts/qa-update-pins.py`, `docs/tool-versions.json`, the CI step and the `verify.sh` check, and this entry's lines in GUIDE, README and the daily routine; close the open bot PR and delete the `bot/updates` branch.

### `updates.yml` runs only on `main`, and both jobs read the same commit
- What: both jobs have `if: github.ref == 'refs/heads/main'`; the check job and the PR job both check out `github.sha`.
- Why: a manual run from another branch would copy files read on that branch into the PR against `main`, and a branch can move between the two jobs.
- Check: none outside GitHub. Undo: drop the two `if:` lines.

### Workflow actions are pinned to commit SHAs; Dependabot moves them
- What: every `uses:` in `.github/workflows/check.yml` and `updates.yml` names a full commit SHA with the release as a comment (`actions/checkout@<sha>  # v4.4.0`). `.github/dependabot.yml` (ecosystem `github-actions`, weekly) opens a PR when a newer release exists; it goes through review and CI like any PR.
- Why: a tag such as `v4` can be moved to other code by whoever controls the action's repository, a commit SHA cannot. `updates.yml` holds a token that can push and open PRs, so the code it runs should not change without a PR here. GitHub's security hardening guide for Actions recommends full-length SHAs (not re-read for this entry).
- Check: CI runs the pinned actions. No `verify.sh` check enforces the SHA form.
- Undo: use release tags in both workflows and delete `.github/dependabot.yml`.

### CI parses every tracked `*.ps1`; `verify.sh` syntax-checks the hooks and the status line
- What: the `windows` job of `check.yml` parses every file from `git ls-files '*.ps1'` with the PowerShell parser and fails on any parse error (or when none is found). `verify.sh` runs `bash -n` on `claude/hooks/*.sh` and `claude/statusline.sh` as well as `scripts/*.sh`.
- Why: `scripts/bootstrap.ps1`, `ao/launch.ps1` and the `codex/` scripts run only on Windows PCs; the hooks and the status line are applied to every machine. Without these checks nothing reads them before they reach a machine.
- Undo: remove the step and the two globs.

### `docs-watch.sh` creates its cache only with `--update`, and has an offline test
- What: `scripts/docs-watch.sh` creates the cache folder only under `--update`, as its header says; `scripts/qa-docs-watch.sh` runs it against a fake `curl` (no network) in the CI `linux` job.
- Why: a report run must not write anything; the test keeps the script to its header.
- Undo: drop the `--update` guard, the test and its CI step.

### `.gitignore`: anchored `/reports/` and `/state/`, worktrees and secret file names
- What: `reports/` and `state/` are ignored only at the repository root (`/reports/`, `/state/`), so a folder of that name elsewhere (for example in `codex/`) is not hidden. `.claude/worktrees/` is ignored. The secret file names of `secret-guard.sh` `is_secret()` and the Read deny rules (entry "One secret list") are listed too, with the `*.pub` public keys allowed.
- Why: the hook blocks staging those files from a Claude session; `.gitignore` also covers a commit made by hand or by another tool.
- Undo: remove the secret-name and worktree lines; un-anchor the two folders.

## Dashboard

### Dashboard structure
- One process entry (`procs.py`, the only place a process starts, hidden on Windows), `TtlCache`, `Fix`/`FixRegistry`, `Source` list, ES-module UI with a `Tab` per screen (`docs/GUIDE.md`, Live dashboard). There is no tools tab (the Codex tab shows TRACE and the Codex CLI, and `bootstrap.py check` lists every tool, version and setup), and the project search reads one level below each project root.
- Check: `bash scripts/qa-dashboard.sh`, `bash scripts/qa-ui.sh`, `scripts/qa-spawn-guard.py`. Undo: not a single switch; change a part in its own PR.

### The efficiency tab sums per-reply usage from the session logs; `modelUsage` is not used
- What: `scripts/dashboard/usage.py` sums `message.usage` over every reply in the main logs and in `<session>/subagents/*.jsonl`, de-duplicated by `requestId` across files, and prices it with the official list prices. The tab shows actual cost, the same tokens repriced on each session's main model, the difference, per-model cost, and a table of defined versus actual model per agent.
- Why: the logs' own `modelUsage` stopped updating partway through the session checked and missed a subagent that ran later. A reply is logged once per content block with the same usage, so a plain sum counts it up to 4 times; a forked or resumed session copies earlier replies into its own file (`docs/evidence.md`, "모델 사용량 집계 검증").
- Basis labels: token counts are measured; every amount is an estimate (list-price arithmetic, not a bill); the saving is an estimate that assumes the same tokens on the main model and ignores quality. Calls that never reach a transcript (titles, hook classifiers) are not counted.
- Privacy: model names leave only if they are on `usage.PRICES` (else "other"); agent type names only if this repo defines them or they are built-ins (else "other").
- Read-only on purpose: the tab does not edit `claude/agents/*.md`. Changing a model stays a PR, and verifying roles are not moved to Haiku without 3+ samples and a reviewer scenario.
- Undo: remove `usage.py`, `UsageEfficiency`, `ui/usage-panel.js` and its line in `ui/tabs/eff.js` in one PR.

### Cache reads are shown as their own cost, and AO is judged by a same-task benchmark
- What: `usage.py` splits cost into input, cache write, cache read and output; the efficiency tab shows the split and the cache-read share. `scripts/bench.sh` runs one fixed job as one agent, as parallel `worker` subagents and as AO workers, and `scripts/bench/report.py` compares cost by kind, wall time, peak context and a hidden-test score; the dashboard reads `reports/bench/latest.json`.
- Why: in one long measured session cache reads were more than half of the cost and the main context grew to 316K tokens (`docs/evidence.md`, "캐시 읽기 비중"). Context length looks like a bigger lever than routing, and AO's value (time against start-up cost) cannot be read from logs of different jobs.
- Rule: all arms on one machine with the setup applied; `run` refuses otherwise, because without the applied hooks every Bash call is blocked. Log cost is cross-checked against the CLI's own `total_cost_usd`.
- Open: no AO numbers (BACKLOG R3). `autoCompactWindow` stays 400000 until the benchmark or a week of `/usage` gives a reason.
- Undo: remove `scripts/bench.sh`, `scripts/bench/`, `BenchEfficiency`, `ui/bench-panel.js`, the split in `usage.py` and its UI, and the CI step in one PR.

## Codex and AO

### One repository for Claude, Codex and AO: ai-setup
- What: the whole agent setup lives in this repository: `claude/`, `codex/` (the Codex setup TRACE), `ao/` (the AO lane setup) and the shared `scripts/` (bootstrap, dashboard, QA). Every machine sets up from this one checkout with `bootstrap`; per-machine paths stay in the gitignored `state/machine.json`. One agent writes at a time: whoever works on `codex/` (Claude or Codex) does it while the other is stopped, through the same branch, reviewer and CI flow. `codex/` keeps its own decision records in `codex/docs/decisions/` for choices that concern only the Codex setup; this file covers the whole setup.
- Why: the work is one global setup plus AO settings, and one repository lets one session change all of it. AO does not read the setup repository: its Claude Code workers load `~/.claude` and its Codex reviewer `~/.codex` (AO v0.13.7 source `backend/internal/adapters/agent/codex/codex.go` falls back to `~/.codex` without `CODEX_HOME`, `backend/internal/adapters/agent/claudecode/claudecode.go`, `chatdriver/claudeacp/driver.go`, the bundled `claude-agent-acp` 0.70.0 `settingSources: ["user","project","local"]`), so only the applied outputs matter. `codex/scripts/setup.py` resolves its root from its own file and stores no source path in its ownership record.
- Undo: move `codex/` and `ao/` into their own repositories, drop their CI jobs, the `inRepo` setup in `tools.json` and their links in README, GUIDE and `docs/codex-alignment.md`.

### AO runs on the local machine, not in cloud sessions
- What: AO (Orchestrator.inc) runs and is QA'd only on the local machine, the AO desktop app with its daemon. Cloud sessions (claude.ai/code, `claude --cloud`) do not install, build or run AO. For parallel work in the cloud, use what the cloud docs offer: several `claude --cloud` sessions, a project, or subagents. To steer local AO work from a phone, start a local Claude Code session with Remote Control and run `ao` from it.
- Why, from the official docs (code.claude.com/docs/en/claude-code-on-the-web): a cloud session runs in an isolated VM; sessions "stop after a period of inactivity and the session's VM is reclaimed", and on reopen "background work that was still running when the VM was reclaimed, such as subagents and shell commands" is not restored. That would include the AO daemon and its worker panes, which are background shell processes (inferred). A setup script "is cached only when it finishes in roughly five minutes", and building AO there needs a Go toolchain and zellij (`docs/evidence.md`, "AO 클라우드 QA"). Reaching the user's own computer is Remote Control's job (docs/en/remote-control), not the cloud session's.
- Codebase: `tools.json` installs AO from `OrchestratorInc/agent-orchestrator`, the local app's codebase (AO 0.13.7's commit `4273bec` is the tag `v0.13.7`). `aoagents/agent-orchestrator` is a different codebase with no `ao review trigger` and no reviewer model field, so results from it do not carry over.
- Undo: delete this entry. Nothing in `claude/` or `scripts/` depends on it.

### Orchestrator.inc (AO) is a candidate, not the default
- What: AO is used only for parallel work with disjoint file scopes; the default is one agent or subagents. Permission is a project setting: `ao project set-config <id> --permission auto` (replaces the whole config). Role lanes for new projects come from `ao/setup.py` `LANES` (Claude `claude-haiku-5-5` worker in auto mode, Claude `claude-opus-5-5` orchestrator, Codex `gpt-6.1-sol` reviewer).
- Why: on a disposable repository parallel workers with disjoint files finished their tasks, deny and ask rules held, and push attempts stopped at ask rules (`docs/evidence.md`, "Orchestrator.inc(AO) 도입 검토"). It is not compared with Claude Code worktrees.
- Undo: delete `ao/`, its CI job and the AO lines in GUIDE and the `orchestrate` skill.

### AO reviewer lane is Codex `gpt-6.1-sol`; Claude keeps the worker lanes
- What: the AO PR reviewer is Codex (`reviewers[].harness = "codex"`, `agentConfig.model: "gpt-6.1-sol"`), set per machine in each AO project's config, not in this repository; the `orchestrate` skill and `docs/GUIDE.md` say how. Every review pass runs with `ao review trigger <session> --effort high`. The reviewer posts to GitHub through `gh auth login` on the machine that runs it; there is no token in the AO config. Without that login, findings stay in `ao review ls --json`; pass them on with `ao send`.
- Why: the reviewer should not share the author's vendor and blind spots ("the author does not verify its own output"), and one Codex lane keeps routing simple. `gpt-6.1-sol` is the Codex catalog's "workhorse model for coding"; the setup uses only Opus and Haiku on Claude and Sol on Codex (user choice). Sources in `docs/evidence.md` ("AO Codex 리뷰어 레인").
- Effort: the model default is `low` for `gpt-6.1-sol` (`models.json`). The measured passes that found real defects ran at `high`, which came from the machine's Codex config, not from AO; stating it per pass removes that dependence. The config cannot carry reviewer effort through the CLI.
- gh login: without `gh` auth Codex cannot post the review to GitHub, and in the measured run no finding reached the worker either; whether posting is what delivers it is not checked (`docs/evidence.md`, "AO 로컬 QA", trap 4). A login keeps the token out of AO's database; the cost is that every `gh` call on that machine gets the same access.
- Measured on Windows, AO 0.13.7 (`docs/evidence.md`, "AO 로컬 QA"): five Codex review runs on three PRs used `gpt-6.1-sol` and found three real defects that the workers' passing tests missed.
- Codex as an AO worker (`docs/evidence.md`, "AO 로컬 QA", Codex 워커 가드레일): `rm` ran without approval (no per-command deny or ask layer), and `git commit` failed because the worktree's `.git` lies outside the sandbox's write roots. So Claude keeps the worker lane.
- Not verified: review quality against a Claude reviewer (BACKLOG R3); the gh login and `--effort high` on the local machine; that a posted review reaches the worker without `ao send`.
- No `verify.sh` check: the setting lives in each machine's AO config. Undo: remove `reviewers` from the AO project config (AO then follows the worker's harness: claude-code for Claude workers), the reviewer lines in the `orchestrate` skill, GUIDE and `ao/setup.py` `LANES`.

## Docs

### Docs: one runbook, one decision log, one evidence file, one backlog
- What: `docs/GUIDE.md` is the runbook for the Claude setup and the shared scripts (`codex/docs/operations.md` and `ao/README.md` are the runbooks of their folders), `docs/DECISIONS.md` this log, `docs/evidence.md` the measurements behind current decisions, `docs/BACKLOG.md` the open work, `docs/codex-alignment.md` the comparison with the Codex setup. Docs describe the current setup only: no history asides and no narrative of past runs; git keeps the history. Verification results live only in GUIDE's local checklist ("Last run", the latest result per row).
- Rule: a BACKLOG row names its file and its done criterion and is deleted in the PR that does it; steps GUIDE owns are referenced, not copied.
- Why: the user asked for one place per kind of document, and documents that mix history with the current state are hard to act on.
- Undo: fold the rows back into GUIDE and DECISIONS, delete a file and its links in README, GUIDE and the root `CLAUDE.md`.

### Not adopted
- A `git-guard` hook (the classifier plus the deny backstop cover it), the Bash sandbox and `autoMode.classifyAllShell` (no allow rules to suspend; the sandbox is not available on native Windows), a `PermissionDenied` logging hook or dashboard tab (use `/permissions` → Recently denied), an ADR folder (this file is enough for one person).
