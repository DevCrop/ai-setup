# ai-setup

Source of truth for the global Claude Code setup (`~/.claude` on each machine). Edit `claude/` here, never `~/.claude` directly; `bash scripts/apply.sh` copies it over.

## What do you want to do?

| Situation | Do this | Done when |
|---|---|---|
| **A machine that is already set up: take the latest `main`** | `git pull && bash scripts/apply.sh && bash scripts/verify.sh --live` (Git Bash on Windows, not PowerShell: its `bash` is WSL) | the last line says `0 FAIL, 0 WARN` |
| **A new machine** | the "Quick path" table in [docs/GUIDE.md](docs/GUIDE.md) (about 15 minutes), then the checklist below | `verify.sh --live` says `0 FAIL`, checklist ticked |
| **You changed `claude/`** | branch, PR, reviewer, CI green, merge (see "Changing this repo"), then the first row on every machine | same as the first row |
| **You changed permissions or hooks** | `bash scripts/verify.sh --full` on every machine that has RTK | `qa-deny.sh` prints PASS for all cases |
| **Something looks wrong** | [Where to check what](#where-to-check-what), then "Troubleshooting and traps" in docs/GUIDE.md | |

After `git pull` (and `apply.sh`), restart the dashboard if it runs, so it reads the new code. Windows (PowerShell):

```powershell
Get-NetTCPConnection -LocalPort 8787 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
Start-Process pythonw -ArgumentList 'scripts\dashboard\server.py' -WindowStyle Hidden -WorkingDirectory C:\path\to\ai-setup
```

Then open http://127.0.0.1:8787 (it should answer 200). Open a new Claude Code session too: running sessions do not pick up changed settings or plugins.

## Checklist for a new machine (things only you can do)

`apply.sh` and the scripts cannot do these. Details: sections 0, 1 and 1b of [docs/GUIDE.md](docs/GUIDE.md).

| # | What | How you check it |
|---|---|---|
| 1 | Claude Code 2.1.295 or newer, logged in (`claude auth login`). Credentials are never in this repo | `claude --version`; `bash scripts/qa-deny.sh` fails its CLI cases when logged out (seen 2026-10-12) |
| 2 | `git`, `jq` (also needed by the status line), `node` 22+, `python` or `python3`, `gh`; `rtk` recommended (`winget install rtk-ai.rtk`) | `python3 scripts/bootstrap.py check` ends with `missing required: none` |
| 3 | Plugins: `ponytail@ponytail` (always on) and `claude-mem@thedotmack`, then `bash scripts/setup-claude-mem.sh` | `claude plugin list`; the script prints `OK` |
| 4 | Scheduled task `daily-claude-update`: create it in the Claude app from `claude/scheduled-tasks/daily-claude-update/SKILL.md` (replace `<repo>` with this clone's path). In the app's Scheduled settings pick **Opus** and permission mode **auto**: no script or tool can set either | run it once; `reports/YYYY-MM-DD.md` appears; the run session shows the model |
| 5 | Project folder for the dashboard: `"projectRoots": ["C:\\Users\\you\\Projects"]` in `state/machine.json` (the file `python3 scripts/bootstrap.py check --write` creates; per machine, gitignored), or env `PROJECT_ROOTS`; without either, `~/Projects` is used when it exists | `bootstrap.py check` prints `projects <your folders> [machine.json]` and the dashboard project list shows your projects. It lists one level below each root: with the `<client>/<stage>/<name>` layout, list the stage folders, not the work root |
| 6 | Dashboard autostart (optional): `python3 scripts/bootstrap.py autostart` (Windows Startup `.vbs` with pythonw; shows the file and asks first); delete the file to undo | after a reboot http://127.0.0.1:8787 answers |
| 7 | Leave `desktop-commander@synced` disabled and VS Code `claudeCode.initialPermissionMode` unset | `verify.sh --live` has no WARN for `desktop-commander`; the VS Code setting is checked by looking at it, no script reads it |

Each machine keeps its own `reports/`, `state/` and claude-mem data; none of it is committed.

## Where to check what

| Question | Where |
|---|---|
| Is this machine equal to the repo? | `bash scripts/verify.sh --live` (applied files, owned settings keys, tools, Ponytail) |
| Do the deny rules still block dangerous commands with RTK active? | `bash scripts/qa-deny.sh` (throwaway repo, haiku, needs a logged-in `claude`; `--static` only checks that every deny pattern has its `rtk ` twin, no CLI) or `verify.sh --full` |
| Does the secret guard work? | `bash scripts/qa-hooks.sh` (no model calls; pass a mutated copy to prove the checks discriminate) |
| Do the session hooks work? | `bash scripts/qa-hooks-session.sh` (compact-context and config-audit; no model calls; pass a mutated copy of `claude/hooks/` the same way) |
| Is the dashboard healthy? | `bash scripts/qa-dashboard.sh` (API, security) and `bash scripts/qa-ui.sh` (headless Chrome, every tab); both end with `failures: 0` |
| Do the role agents route and refuse correctly? | `bash scripts/qa-role-agents.sh <work-dir> [case]` (costs tokens; `QA_MODE=selftest` is free) |
| What changed upstream (Claude Code, RTK, docs)? | `reports/YYYY-MM-DD.md`, written by the daily routine |
| Which tools are used and what do they save? | dashboard tab "도구 효율" (every number is labelled measured, estimated or unavailable) |
| Single vs subagents vs AO, same task | `bash scripts/bench.sh run <work> single 3` (and `subagents 3`; AO arm in docs/GUIDE.md), then `bench.sh report <work>`; the dashboard panel "같은 과제 비교" reads `reports/bench/latest.json` |
| Is claude-mem working? | `curl -s http://127.0.0.1:37777/api/health` and the dashboard panel "도구 점검" |
| Why was a decision made, how do I undo it? | [docs/DECISIONS.md](docs/DECISIONS.md); measurements in [docs/evidence.md](docs/evidence.md) |
| What is still open, and what must I do by hand? | [docs/BACKLOG.md](docs/BACKLOG.md) (section 1 is yours) |

## Changing this repo

1. Branch from `main`, edit `claude/` or `scripts/`, run the check that matches the change (table above).
2. Open a PR. A separate reviewer subagent checks it against written criteria; the author does not verify its own work.
3. CI must be green on linux and windows. Then merge (Claude merges once CI is green and the reviewer has no open findings).
4. Every machine: `git pull && bash scripts/apply.sh && bash scripts/verify.sh --live`.

Rules that bite: every Bash deny pattern needs an `rtk `-prefixed twin (RTK rewrites `git ...` before permission rules run); `claude/CLAUDE.md` stays under 200 lines; never commit `reports/`, `state/`, credentials or `.env*`.

## Windows traps seen in practice

- PowerShell's `bash` is WSL and its `curl` is `Invoke-WebRequest`: use Git Bash and `curl.exe`.
- A Microsoft Store `python3` stub (an app-execution alias) exits without running Python. The QA scripts now fall back to `python`; remove the alias in Settings if you want `python3` itself.
- `jq` installed with winget was not on the PATH of an already-open Git Bash (seen 2026-10-12): restart the terminal or the app.
- Git has no identity until you set one (`git config --global user.name` / `user.email`); a merge then fails with "unable to auto-detect email" (seen 2026-10-12).
- Bulk `rm -rf` of folders was refused here by the permission rules or the auto-mode classifier: delete bench or temp folders yourself.

## Layout

- `claude/CLAUDE.md`, `claude/RTK.md`, `claude/settings.json`, `claude/statusline.sh` — global rules, RTK note, settings (merged key by key), status line
- `claude/agents/` — subagents `explorer`, `reviewer`, `worker`, `publisher`, `frontend`, `backend`, `qa`
- `claude/skills/` — `orchestrate`, `project-setup`, `spec-writing`, `design-spec`, `ui-baseline`
- `claude/hooks/secret-guard.sh` — PreToolUse hook: blocks `git add/stage/commit/push/update-index/mv/apply --index/am` of secret-looking files (the list is `is_secret` in the script); fails closed when it cannot judge
- `claude/hooks/compact-context.sh`, `claude/hooks/config-audit.sh` — SessionStart (compact) hook that re-injects the project's handoff note, and ConfigChange hook that logs edits to `~/.claude` for `verify.sh --live` (never block)
- `claude/routines/`, `claude/scheduled-tasks/` — daily update routine and the scheduled task body
- `docs/` — `GUIDE.md` (start here), `DECISIONS.md`, `BACKLOG.md` (open work), `evidence.md` (Korean originals kept verbatim), `codex-alignment.md`, `review-claude-mem.md`
- `tools.json`, `scripts/toolreg.py`, `scripts/bootstrap.py` (+ `bootstrap.ps1` for a bare machine) — tool registry and the machine setup entry point
- `scripts/apply.sh`, `verify.sh`, `docs-watch.sh`, `setup-claude-mem.sh`, `bench.sh` — apply, read-only checks, docs diff for the routine, claude-mem settings, benchmark harness
- `scripts/qa-*.sh` — QA suites (hooks, deny rules, dashboard API and UI, role agents, project setup, statusline)
- `scripts/dashboard/` — local dashboard (`server.py` + `ui/` ES modules), `http://127.0.0.1:8787`
- `state/`, `reports/` — per-machine values (`state/machine.json` from `bootstrap.py check --write`, and the older `project-roots.txt`, still read when machine.json has no `projectRoots`), the daily routine's baseline (`state/last-seen.json`) and reports (gitignored)

Runtime data (credentials, session history, auto-memory, plugins, caches) is never stored here. See `.gitignore`. Scope: local machines only; cloud sessions read the project's own `.claude/`, not `~/.claude/`.

## How `apply.sh` behaves

Needs `jq`; run in Git Bash. It copies `CLAUDE.md`, `RTK.md`, `settings.json`, `statusline.sh`, `agents/`, `hooks/`, `routines/` and the listed `skills/*` into `~/.claude/` (or `CLAUDE_CONFIG_DIR`). `settings.json` is merged: keys this repo owns (permissions, `autoMode`, hooks, status line, marketplaces, `skillOverrides`) take the repo value; keys that exist only on the machine are kept and reported; files an earlier apply copied and the repo no longer has are removed. There is no backup: to go back, check out the older commit and run `apply.sh` again. On Windows Git Bash `$HOME` must equal `%USERPROFILE%`, otherwise set `CLAUDE_CONFIG_DIR`.

## Status

- **Windows, first machine:** applied and checked 2026-10-10 and 2026-10-11 (PRs up to #69). A real `claude -p` session in `bypassPermissions` with RTK on had `git add -A` blocked by the secret-guard hook (2026-10-10).
- **Windows, second machine (fresh clone of `main`, 2026-10-12, PRs up to #88):** `verify.sh --live` 0 FAIL, 0 WARN; `qa-deny.sh` all 26 cases pass after `claude` login; `qa-dashboard.sh` and `qa-ui.sh` `failures: 0`; role-agent QA run, python-launcher fix in #83, scenario fixes in #86 and #87; benchmark single vs subagents vs AO, 3 runs each, all hidden tests 100% (results in the dashboard panel "같은 과제 비교"; `reports/bench/` is not committed).
- **Not recorded elsewhere:** the second-machine results above are from the operator's runs and are not in `docs/evidence.md`; the "Last run" column of the local test checklist in `docs/GUIDE.md` is still empty.
- **Not run:** a reboot test of the dashboard autostart, Opus/auto mode of the scheduled task (set by hand in the app).
