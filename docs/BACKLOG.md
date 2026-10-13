# Backlog

Open work, by priority. Each row names where it is and what proves it done; delete the row in the PR that does it, and record any decision in `docs/DECISIONS.md`. Steps that GUIDE's local checklist already owns are referenced by their ID, not repeated. Every row was checked against `main` 0b43ae0 on 2026-10-12.

## 1. Only you can do these (per machine)

| # | Do | Done when |
|---|---|---|
| M4 | GUIDE L-13 (`/compact` with a handoff note; `/config` versus an editor change) | result recorded in GUIDE's "Last run" column, including whether `/config` fires ConfigChange |
| M6 | Move the local folder `Projects\claude-global` to `Projects\ai-setup` (the repo rename, DECISIONS 2026-10-13; postponed that day because `Move-Item` failed with the folder in use). Reboot, open no Claude app, editor or terminal, then in a new PowerShell: stop python/pythonw/bash whose command line has `Projects\claude-global`, `Move-Item`, `python scripts\bootstrap.py autostart`, start the dashboard `.vbs`. Then change every `Projects\claude-global` path in the `daily-claude-update` scheduled task (5 in its body) to the new folder; the task was set back to the old path. Then start a new Claude session there for T4 | the folder opens as `Projects\ai-setup`, the dashboard answers on 127.0.0.1:8787, the scheduled task names only the new path |

## 2. Security (first)

None open (S5 and S7 closed on 2026-10-13, DECISIONS "one secret list" and "Third-party plugins are pinned").

## 3. Correctness

| # | Where | Problem | Done when |
|---|---|---|---|
| C12 | `scripts/dashboard/efficiency.py:160` | the efficiency hint names `qa` and `reviewer` (now Opus) as candidates to lower to Haiku and cites "Sonnet 76%": wrong since the 2026-10-12 lanes, not only stale | rewritten from the R2 measurement (text only, no new feature) |

## 4. Tests and CI

| # | Where | What | Done when |
|---|---|---|---|
| T4 | the whole repo, after M6 | full check at the new path, judged by a QA subagent: `bootstrap.py check` (no stray WARN), `verify.sh --live --full`, a second `apply.sh` replaces nothing, `qa-bootstrap.py`, `qa-dashboard.sh`, `qa-ui.sh`, the dashboard Codex tab shows `codex/`, `codex/scripts/setup.py verify`, `ao/` unittest, a deny test through an AO worker (from a temporary repo with no remote, `rm -rf ~/__qa_nonexistent__` must be blocked, as in `qa-deny.sh`; then `ao stop`), one manual run of the scheduled task | every check passes; GUIDE "Last run" cells filled |

## 5. Decisions waiting for you

None open (D1-D3 settled on 2026-10-13, DECISIONS "two Windows PCs").

## 6. Waiting on something outside this repo

Codex setup (moving into `codex/` of this repository, DECISIONS 2026-10-13 "one repository"):
- The project path line in `codex/global/AGENTS.md` (DECISIONS "The project is found from the cwd", "Not yet").
- The handoff note rule, not yet compared with Codex's handoff guidance (`docs/codex-alignment.md`, "Not compared yet").
- Codex v1.3.3 subagent models: applied to `~/.codex` on 2026-10-13 (`apply --adopt-existing`, then `verify` pass and a second `apply` unchanged). `explorer` moved from `gpt-6-luna` to `gpt-6.1-sol` on 2026-10-13 (decision 004). A live `codex exec` that day recorded Sol for `explorer` while the file still named Luna, so the custom agent file may not be loaded: after `setup.py apply`, confirm in a live run that `explorer` follows the custom file (effort high, sandbox read-only, its developer instructions); the model alone no longer tells it from the built-in one.
- After the local folder moves to `Projects\ai-setup`: re-render the Codex 08:00 routine with `codex/scripts/render_heartbeat.py` (its prompt holds the checkout path), run `bootstrap.py check --write`, then archive DevCrop/codex-setup and delete the old clone `Documents\ChatGPT\글로벌 셋업\codex-setup` (each with approval).

## 7. Measure

| # | What | When and how |
|---|---|---|
| R1 | Prompt cache TTL trial (DECISIONS 2026-10-11, PR #46) | due 2026-10-14 to 10-18: `/usage` Behavior flags and Attribution; drop `subagentPromptCacheTtl` if short subagents dominate |
| R2 | Cost and quality of the new model lanes, and advisor cost with Opus main | `bash scripts/bench.sh`, `QA_AGENT_MODEL` runs of `qa-role-agents.sh` (mind the effort caveat in DECISIONS "Model lanes"); count advisor calls in the main thread and in Haiku executors, which inherit the advisor and read the "consult it before done" rule (advisor doc) |
| R3 | `autoCompactWindow` 400000, AO numbers, Codex review quality against a Claude reviewer (the first Codex run is done: evidence "AO 로컬 QA", 2026-10-12) | DECISIONS "Cache reads are shown as their own cost" (Open) and "AO reviewer lane" (Not verified) |

## 8. Known limits (no action unless they bite)

- Deny rules: the accepted over-block and the forms not covered are in DECISIONS 2026-10-12 "Ask rules cover push only".
- Deferred findings of PR #91 kept for Windows (DECISIONS "two Windows PCs"): the `bootstrap.ps1` terminal check, the "read-only" wording of `verify`.
- Found in the 2026-10-12 reviews and left as is:
  - `compact-context.sh` without iconv drops the last, partial line of a cut note, so a single-line note over 8,000 bytes prints only the header.
  - `verify.sh` `fm_value` does not unescape quotes inside a quoted value (no file uses them).
  - `config-audit.sh` log rotation is not safe against two sessions rotating at the same moment.
