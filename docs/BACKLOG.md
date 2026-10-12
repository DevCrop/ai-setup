# Backlog

Open work, by priority. Each row names where it is and what proves it done; delete the row in the PR that does it, and record any decision in `docs/DECISIONS.md`. Steps that GUIDE's local checklist already owns are referenced by their ID, not repeated. Every row was checked against `main` 0b43ae0 on 2026-10-12.

## 1. Only you can do these (per machine)

| # | Do | Done when |
|---|---|---|
| M1 | GUIDE local checks L-1 / L-2, then L-5 (`bash scripts/qa-deny.sh`, also run by `verify.sh --live --full`: 30 live cases) | `0 FAIL`; it is the first run with the real RTK hook |
| M2 | Claude app, Scheduled settings of `daily-claude-update`: model **Opus** (decision 2026-10-12) and permission mode **auto** | GUIDE L-10; the run session shows `claude-opus-5-5` |
| M3 | claude.ai personal preferences: "Permission mode is bypassPermissions by default" becomes auto | matches `claude/CLAUDE.md` (Safety) |
| M4 | GUIDE L-13 (`/compact` with a handoff note; `/config` versus an editor change) | result recorded in GUIDE's "Last run" column, including whether `/config` fires ConfigChange |
| M5 | The macOS run (GUIDE L-2). It lifts the feature freeze and unblocks the macOS items in section 6 | GUIDE L-2 passes |

## 2. Security (first)

| # | Where | Problem | Done when |
|---|---|---|---|
| S1 | `claude/hooks/secret-guard.sh:15`, `:41`, `:74` | `GIT add -A` exits at the case-sensitive gates (15, 41); `git.exe add -A` (Git Bash) is skipped at 74 | `qa-hooks.sh` cases for both block |
| S2 | `secret-guard.sh:72`, `:102` | only `cd` moves the hook's cwd, not `pushd`; outside a repo `rev-parse` fails first, so even a literal secret path is not checked | `pushd repo && git add .env` blocks in `qa-hooks.sh` |
| S3 | `claude/settings.json` hooks | secret-guard watches Bash only; a commit through GitHub MCP (`push_files`, `create_or_update_file`) is not checked | an MCP matcher, or the limit written in GUIDE (Secret-guard hook) |
| S5 | `settings.json` deny, `autoMode.hard_deny`, `secret-guard` `is_secret` | three secret lists disagree, for example `*.key` is readable (some differences are accepted over-blocks in DECISIONS) | one list, or each remaining difference recorded as a decision |
| S6 | `scripts/dashboard/projects.py:318` (Windows) | a project hook path `\\host\share\x` makes `.exists()` contact that SMB host on every 10 s refresh | absolute, UNC and drive paths rejected as in `server.py` `ui_asset`; unit test |
| S7 | `settings.json` `extraKnownMarketplaces`, `enabledPlugins` | Ponytail and claude-mem install unpinned upstream code on every machine (DECISIONS "Third-party plugins are pinned through an own marketplace (pending)") | forks, `DevCrop/claude-plugins` with `sha`-pinned sources, and the `autoMode.environment` line changed in one PR |

## 3. Correctness

Bug fixes do not wait for the dashboard freeze, which covers new features only (DECISIONS 2026-10-11 "Dashboard structure").

| # | Where | Problem | Done when |
|---|---|---|---|
| C1 | `scripts/dashboard/inventory.py:218` `debug()` | a log line that is a list, or has a string `message`, raises; `/api/inventory` returns 500 for every side tab | type guards; unit test with those lines |
| C2 | `scripts/dashboard/usage.py:70` | duplicate requests are removed per file only; a resumed or forked session may count twice (not confirmed on real logs) | checked on real logs; dedupe across files if confirmed |
| C3 | `scripts/bootstrap.py:68-69` `found_values` | with no `~/Projects`, `check --write` stores `"projectRoots": []` from the `"default"` source, which then hides `~/Projects` for good | the default source is not written; test |
| C4 | `scripts/toolreg.py:182`, `scripts/dashboard/projects.py:52`, `:80` | `project-roots.txt` and `projects.txt` read as `utf-8`; a BOM (Notepad, PowerShell 5.1) breaks the first path | `utf-8-sig`; test |
| C5 | `scripts/toolreg.py` `shutil.which` | on Windows the "read-only" check runs a `git.exe` found in the current folder with `--version` | `os.chdir(REPO)` first, or cwd hits rejected |
| C6 | `scripts/toolreg.py:45` | `machine.json` is written in place; an interrupted write leaves a truncated file that reads as `{}` | temp file and `os.replace` |
| C7 | `scripts/toolreg.py` | wrong types in `machine.json`, such as `"bin": "x"` or `"disabled": 5`, crash `check` with exit 3 | types checked, the bad value reported |
| C8 | `scripts/setup-claude-mem.sh:17` | the backup `cp` is not checked; `settings.json` is replaced even when it failed | `cp ... || exit` |
| C9 | `scripts/dashboard/server.py:558` | a negative `Content-Length` blocks a handler thread (needs the token) | values below 0 rejected |
| C10 | `scripts/dashboard/fixes.py` `MemRedactOn` | offered when `settings.json` is missing or broken, then fails; the preview names `~/.claude-mem` even with `CLAUDE_MEM_DIR` set | preview and run agree; test |
| C11 | `scripts/apply.sh` manifest | files of a skill dropped from the copy list stay in `~/.claude/skills`, unreported | reported or removed |
| C12 | `scripts/dashboard/efficiency.py:160` | the efficiency hint names `qa` and `reviewer` (now Opus) as candidates to lower to Haiku and cites "Sonnet 76%": wrong since the 2026-10-12 lanes, not only stale | rewritten from the R2 measurement (text only, no new feature) |

## 4. Tests and CI

| # | Where | Problem | Done when |
|---|---|---|---|
| T1 | `.github/workflows/check.yml` bootstrap step | rc 1 is expected on the runner, so a regression that detects nothing also passes | `--json` asserts that git and python are found |
| T2 | `scripts/qa-role-agents.sh:39`, `:272` | BSD `sed -i` and a missing `timeout` break it on macOS | portable `sed -i` form; `gtimeout` fallback as in `bench.sh:54` |
| T3 | `scripts/qa-deny.sh` | a `runs` case also passes when the model never calls the tool | the tool call is asserted in the stream |

## 5. Decisions waiting for you

| # | Question | Context |
|---|---|---|
| D1 | Should `project-setup` propose a code intelligence plugin for typed projects? | DECISIONS 2026-10-12 "`project-setup` still recommends no plugin"; depends on S7 |
| D2 | Keep the chat-confirmation lines in `claude/CLAUDE.md` (Safety: "Before overwriting or deleting, show the target and get confirmation")? | since 2026-10-12 they are the remaining guard for `rm`, `branch -D`, `stash drop`/`clear` (DECISIONS "Ask rules cover push only", "Left to the classifier and the chat-confirmation lines"); dropping them reopens that |
| D3 | Bash sandbox on macOS and Linux only? | not adopted because native Windows lacks it (DECISIONS "Not adopted this round"); it is the OS-level backstop for what secret-guard and the deny rules cannot see |

## 6. Waiting on something outside this repo

On the macOS run (M5):

- Frozen features (DECISIONS 2026-10-12 "Dashboard feature freeze kept until the Mac run"): the tools tab, and the project search to depth 3.
- Deferred findings 6–10 of PR #91 (same entry): LaunchAgent PATH, `bootstrap.sh` installing git when present, the `bootstrap.ps1` terminal check, the "read-only" wording of `verify`, the codex clone target on macOS and Linux.

On the Codex side (codex-setup is maintained by Codex, `docs/codex-alignment.md`):
- The project path line in codex-setup `global/AGENTS.md` (DECISIONS "The project is found from the cwd", "Not yet").
- The handoff note rule, not yet compared with Codex's handoff guidance (`docs/codex-alignment.md`, "Not compared yet").

## 7. Measure

| # | What | When and how |
|---|---|---|
| R1 | Prompt cache TTL trial (DECISIONS 2026-10-11, PR #46) | due 2026-10-14 to 10-18: `/usage` Behavior flags and Attribution; drop `subagentPromptCacheTtl` if short subagents dominate |
| R2 | Cost and quality of the new model lanes, and advisor cost with Opus main | `bash scripts/bench.sh`, `QA_AGENT_MODEL` runs of `qa-role-agents.sh` (mind the effort caveat in DECISIONS "Model lanes"); count advisor calls in the main thread and in Haiku executors, which inherit the advisor and read the "consult it before done" rule (advisor doc) |
| R3 | `autoCompactWindow` 400000, AO numbers, a real Codex reviewer run in AO | DECISIONS "Cache reads are shown as their own cost" (Open) and "AO reviewer lane" (Not verified) |

## 8. Known limits (no action unless they bite)

- Deny rules: the accepted over-block and the forms not covered are in DECISIONS 2026-10-12 "Ask rules cover push only".
- Found in the 2026-10-12 reviews and left as is:
  - `compact-context.sh` without iconv drops the last, partial line of a cut note, so a single-line note over 8,000 bytes prints only the header.
  - `verify.sh` `fm_value` does not unescape quotes inside a quoted value (no file uses them).
  - `config-audit.sh` log rotation is not safe against two sessions rotating at the same moment.
