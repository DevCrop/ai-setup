# Backlog

Open work after the 2026-10-12 round (PRs #95 to #98). One line per item, with where it is and what proves it done. When an item is done, delete its line in the PR that does it; a decision goes to `docs/DECISIONS.md`. Every item below was checked against `main` (0b43ae0) on 2026-10-12.

## 1. Only you can do these (manual, per machine)

| # | Do | Done when |
|---|---|---|
| M1 | On each PC: `git pull && bash scripts/apply.sh && bash scripts/verify.sh --live --full` | `0 FAIL`; `--full` runs the 30 live `qa-deny.sh` cases with the real RTK hook (never run with RTK yet) |
| M2 | Claude app, Scheduled settings of `daily-claude-update`: pick **Opus** (decision 2026-10-12) | the next run session shows `claude-opus-5-5` |
| M3 | claude.ai personal preferences: change "Permission mode is bypassPermissions by default" to auto | the text matches `claude/CLAUDE.md` (Safety) |
| M4 | GUIDE local check L-13: `/compact` in a project with `.claude/handoff.md`; change a setting in `/config` and in an editor, then `verify.sh --live` | the note is quoted after compaction; record whether `/config` fires ConfigChange (unverified) |
| M5 | macOS run of the quick path (lifts the dashboard freeze, DECISIONS 2026-10-12) | GUIDE L-2 passes; iconv, BSD `sed`/`tr`/`date -r` behave |

## 2. Security (fix first)

| # | Where | Problem | Done when |
|---|---|---|---|
| S1 | `claude/hooks/secret-guard.sh:74` | `git.exe add -A` (Git Bash) and `GIT add` on a case-insensitive disk are not recognised as git | `qa-hooks.sh` cases for both block |
| S2 | `secret-guard.sh` | only `cd` moves its idea of the cwd, not `pushd`; outside a repo it skips even a literal secret path | `pushd repo && git add .env` blocks in `qa-hooks.sh` |
| S3 | `claude/settings.json` hooks | secret-guard watches Bash only: a commit through GitHub MCP (`push_files`, `create_or_update_file`) is not checked | a decision: an MCP matcher, or the limit written in GUIDE |
| S4 | `settings.json` `Read(**/...)` deny | per the permissions doc a pattern without `/`, `~/` or `//` is relative to the cwd, so `~/.ssh/id_rsa`, `~/.netrc` may not be covered (not verified) | read the current permissions doc; add `~/` forms if needed; a `claude -p` probe |
| S5 | `settings.json` deny, `autoMode.hard_deny`, `secret-guard` `is_secret` | three secret lists disagree (`*.key` readable, `.env.example` not) | one list, or the differences written as decisions |
| S6 | `scripts/dashboard/projects.py:318` (Windows) | a project hook path `\\host\share\x` makes `.exists()` contact an SMB host every 10 s | absolute, UNC and drive paths rejected as in `server.py` `ui_asset`; unit test |

## 3. Correctness

| # | Where | Problem | Done when |
|---|---|---|---|
| C1 | `scripts/dashboard/inventory.py:218` `debug()` | one log line that is a list, or a string `message`, raises; `/api/inventory` returns 500 for every side tab | type guards; a unit test with those lines |
| C2 | `scripts/dashboard/usage.py:70` | duplicate requests are removed per file only; a resumed or forked session may count twice (not confirmed on real logs) | check real logs; dedupe across files if confirmed |
| C3 | `scripts/toolreg.py:185` | `check --write` with no `~/Projects` stores `"projectRoots": []`, which then hides `~/Projects` forever | empty or default roots not written; test |
| C4 | `scripts/toolreg.py:182`, `scripts/dashboard/projects.py:52,80` | `project-roots.txt` / `projects.txt` read as `utf-8`; a BOM (Notepad, PowerShell 5.1) breaks the first path | `utf-8-sig`; test |
| C5 | `scripts/toolreg.py` `shutil.which` | on Windows the "read-only" check can run `git.exe` from the current folder with `--version` | `os.chdir(REPO)` first or reject cwd hits |
| C6 | `scripts/toolreg.py:45` | `machine.json` written in place; an interrupted write leaves a truncated file read as `{}` | temp file + `os.replace` |
| C7 | `scripts/toolreg.py` | wrong value types in `machine.json` (`"bin": []`, `"disabled": 5`) crash with exit 3 | types checked, bad value reported |
| C8 | `scripts/setup-claude-mem.sh:17` | the backup `cp` is not checked; `settings.json` is replaced even if it failed | `cp ... || exit` |
| C9 | `scripts/dashboard/server.py:558` | a negative `Content-Length` blocks a handler thread (needs the token) | reject < 0 |
| C10 | `scripts/dashboard/fixes.py` mem-redact | offered when `settings.json` is missing or broken, then fails; preview names `~/.claude-mem` even with `CLAUDE_MEM_DIR` set | preview and run agree; test |
| C11 | `scripts/apply.sh` | a skill dropped from the copy list leaves its earlier files in `~/.claude/skills` unreported | reported or removed via the manifest |

Dashboard items (S6, C1, C2, C9, C10) wait for the freeze to lift unless they are security or a crash: S6 and C1 should not wait.

## 4. Tests and CI

| # | Where | Problem | Done when |
|---|---|---|---|
| T1 | `.github/workflows/check.yml` bootstrap step | rc 1 is expected on the runner, so a regression where nothing is detected also passes | `--json` asserts git and python are found |
| T2 | `scripts/qa-role-agents.sh:39`, `:272` | BSD `sed -i` and a missing `timeout` break it on macOS | `sed -i.bak` form; `gtimeout` fallback as in `bench.sh` |
| T3 | `scripts/qa-deny.sh` | a `runs` case also passes when the model never calls the tool | the tool call is asserted in the stream |

## 5. Decisions waiting for you

| # | Question | Context |
|---|---|---|
| D1 | Propose a code intelligence plugin in `project-setup` for typed projects? | best-practices and costs pages suggest it; `project-setup` step 9 forbids recommending plugins and plugin pinning is pending (DECISIONS 2026-10-12) |
| D2 | Keep the chat confirmation for deletes in `claude/CLAUDE.md` (Safety)? | ask rules now prompt only for push; the classifier reads that line, so mass deletes may still be confirmed in chat |
| D3 | Bash sandbox on macOS and Linux only? | rejected because native Windows lacks it (DECISIONS); it is the OS-level backstop for what secret-guard and deny rules cannot see |

## 6. Measure

| # | What | How |
|---|---|---|
| R1 | Cost and quality of the new model lanes (Opus main and verifiers, Haiku executors) | `bash scripts/bench.sh`, `QA_AGENT_MODEL` runs of `qa-role-agents.sh`; mind the effort caveat in DECISIONS; 2026-10-11 had a Haiku `backend` failure |
| R2 | Advisor cost with Opus main | count advisor calls per session (one cost about 3.6 main calls, `docs/evidence.md`) |
| R3 | Dashboard efficiency hint (`scripts/dashboard/efficiency.py`) still describes the Sonnet lanes | rewrite after R1, when the freeze lifts |

## 7. Known limits, accepted (no action unless they bite)

- `git -C`/`git -c` commands whose text contains a denied tail are denied (DECISIONS 2026-10-12): use `cd <dir> && git ...` or `git commit -F <file>`.
- Not covered by deny rules: `REQUIREFORCE` spellings, `git --no-pager -c ...`, `git reset HEAD --hard`, a repo whose own config sets `clean.requireForce=false`.
- `compact-context.sh` without iconv drops the last, partial line of a cut note; a single-line note over 8,000 bytes prints only the header.
- `verify.sh` `fm_value`: escaped quotes inside a quoted value are not unescaped (no file uses them).
- `config-audit.sh` log rotation is not safe against two sessions rotating at the same moment.
