# Backlog

Open work, by priority. Each row names where it is and what proves it done; delete the row in the PR that does it, and record any decision in `docs/DECISIONS.md`. Steps that GUIDE's local checklist already owns are referenced by their ID, not repeated.

## 1. Only you can do these (per machine)

| # | Do | Done when |
|---|---|---|
| M4 | GUIDE L-13 (`/compact` with a handoff note; `/config` versus an editor change) | result recorded in GUIDE's "Last run" column, including whether `/config` fires ConfigChange |
| M6 | Move the local folder `Projects\claude-global` to `Projects\ai-setup` (the repository's name; `Move-Item` fails while the folder is in use). Reboot, open no Claude app, editor or terminal, then in a new PowerShell: stop python/pythonw/bash whose command line has `Projects\claude-global`, `Move-Item`, `python scripts\bootstrap.py autostart`, start the dashboard `.vbs`. Then change every `Projects\claude-global` path in the `daily-claude-update` scheduled task (5 in its body) to the new folder. Then start a new Claude session there for T4 | the folder opens as `Projects\ai-setup`, the dashboard answers on 127.0.0.1:8787, the scheduled task names only the new path |

## 2. Security (first)

None open.

## 3. Correctness

None open.

## 4. Tests and CI

| # | Where | What | Done when |
|---|---|---|---|
| T4 | the whole repo, after M6 | full check at the new path, judged by a QA subagent: `bootstrap.py check` (no stray WARN), `verify.sh --live --full`, a second `apply.sh` replaces nothing, `qa-bootstrap.py`, `qa-dashboard.sh`, `qa-ui.sh`, the dashboard Codex tab shows `codex/`, `codex/scripts/setup.py verify`, `ao/` unittest, a deny test through an AO worker (from a temporary repo with no remote, `rm -rf ~/__qa_nonexistent__` must be blocked, as in `qa-deny.sh`; then `ao stop`), one manual run of the scheduled task | every check passes; GUIDE "Last run" cells filled |

## 5. Decisions waiting for you

None open.

## 6. Waiting on something outside this repo

Codex setup (`codex/`):
- The project path line in `codex/global/AGENTS.md` (DECISIONS "The project is found from the cwd", Open).
- Whether Codex gets a session handoff note rule like `claude/CLAUDE.md` (`docs/codex-alignment.md`, "Open differences" 2).
- Codex subagent models: confirm in a live `codex exec` run, after `setup.py apply`, that the custom `explorer` agent file is loaded (effort high, sandbox read-only, its developer instructions); its model `gpt-6.1-sol` alone does not tell it from the built-in one (`codex/docs/decisions/004-subagent-models.md`).
- After the local folder moves to `Projects\ai-setup`: re-render the Codex 08:00 routine with `codex/scripts/render_heartbeat.py` (its prompt holds the checkout path), run `bootstrap.py check --write`, then archive DevCrop/codex-setup and delete the old clone `Documents\ChatGPT\글로벌 셋업\codex-setup` (each with approval).

## 7. Measure

| # | What | When and how |
|---|---|---|
| R1 | Prompt cache TTL trial (DECISIONS "Prompt cache TTL 1 hour") | due 2026-10-14 to 10-18: `/usage` Behavior flags and Attribution; drop `subagentPromptCacheTtl` if short subagents dominate |
| R2 | Cost and quality of the new model lanes, and advisor cost with Opus main | `bash scripts/bench.sh`, `QA_AGENT_MODEL` runs of `qa-role-agents.sh` (mind the effort caveat in DECISIONS "Model lanes"); count advisor calls in the main thread and in Haiku executors, which inherit the advisor and read the "consult it before done" rule (advisor doc); then put the measured numbers in the efficiency hint (`scripts/dashboard/efficiency.py`, `ModelEfficiency`) |
| R3 | `autoCompactWindow` 400000, AO numbers, Codex review quality against a Claude reviewer (one Codex run is measured: evidence "AO 로컬 QA") | DECISIONS "Cache reads are shown as their own cost" (Open) and "AO reviewer lane" (Not verified) |

## 8. Known limits (no action unless they bite)

- Deny rules: the accepted over-block and the forms not covered are in DECISIONS "Ask rules cover push only".
- Two Windows review findings left open: `bootstrap.ps1` has no terminal check before a write (DECISIONS "Installs only what is missing"); `verify` is described as read-only although the claude CLI it runs may rewrite `settings.json` (GUIDE section 1).
- Left as is:
  - `compact-context.sh` without iconv drops the last, partial line of a cut note, so a single-line note over 8,000 bytes prints only the header.
  - `verify.sh` `fm_value` does not unescape quotes inside a quoted value (no file uses them).
  - `config-audit.sh` log rotation is not safe against two sessions rotating at the same moment.
