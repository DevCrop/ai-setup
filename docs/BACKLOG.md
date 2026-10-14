# Backlog

Open work, by priority. Each row names where it is and what proves it done; delete the row in the PR that does it, and record any decision in `docs/DECISIONS.md`. Steps that GUIDE's local checklist already owns are referenced by their ID, not repeated.

## 1. Only you can do these (per machine)

| # | Do | Done when |
|---|---|---|
| M4 | GUIDE L-13 (`/compact` with a handoff note; `/config` versus an editor change) | result recorded in GUIDE's "Last run" column, including whether `/config` fires ConfigChange |

## 2. Security (first)

None open.

## 3. Correctness

None open.

## 4. Tests and CI

| # | Where | What | Done when |
|---|---|---|---|
| T4 | the whole repo, at `Projects\ai-setup` | full check at the new path, judged by a QA subagent: `bootstrap.py check` (no stray WARN), `verify.sh --live --full`, a second `apply.sh` replaces nothing, `qa-bootstrap.py`, `qa-dashboard.sh`, `qa-ui.sh`, the dashboard Codex tab shows `codex/`, `codex/scripts/setup.py verify`, `ao/` unittest, a deny test through an AO worker (from a temporary repo with no remote, `rm -rf ~/__qa_nonexistent__` must be blocked, as in `qa-deny.sh`; then `ao stop`), one manual run of the scheduled task (after the user re-creates it in the app; it was removed on 2026-10-14) | every check passes; GUIDE "Last run" cells filled |

## 5. Decisions waiting for you

None open.

## 6. Waiting on something outside this repo

AO (`ao/`), checked on the local PC (AO runs only there):
- Upgrade check: AO v0.14.0 (published 2026-10-14) is not yet tested here. Run `ao doctor` and a small-task Setup on 0.14.0, then check whether the local 0.13.7 patch (`~/.ao/backups`) and the `haiku` alias workaround are still needed. Then update the baseline in `ao/README.md` and DECISIONS "AO reviewer lane".
- Install path: after the 0.14.0 rename to Orchestrator.inc, confirm that `tools.json` `resources/daemon/ao.exe` still matches the installed app on each PC.
- Not confirmed in the official docs: `ao project set-config --permission`, the model alias behavior, and `reviewers[].agentConfig.effort` (DECISIONS "AO reviewer lane", Not verified).

Codex setup (`codex/`):
- The project path line in `codex/global/AGENTS.md` (DECISIONS "The project is found from the cwd", Open).
- Whether Codex gets a session handoff note rule like `claude/CLAUDE.md` (`docs/codex-alignment.md`, "Open differences" 2).
- Codex subagent models: confirm in a live `codex exec` run, after `setup.py apply`, that the custom `explorer` agent file is loaded (effort high, sandbox read-only, its developer instructions); its model `gpt-6.1-sol` alone does not tell it from the built-in one (`codex/docs/decisions/004-subagent-models.md`).
- The first PC's checkout is now `Projects\ai-setup`, the single checkout the Codex docs (`codex/docs/install-another-windows-pc.md`) name. The Codex automations were removed on 2026-10-14 (backup `~/codex-automations-backup-2026-10-14`); the user re-adds them in the Codex app. Still to do: archive DevCrop/codex-setup and delete the old clone `Documents\ChatGPT\글로벌 셋업\codex-setup` (each with approval).

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
