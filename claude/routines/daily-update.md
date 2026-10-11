# Daily update routine

Purpose: track Claude Code, RTK and Anthropic releases and changes to the official docs this setup depends on, check that the applied setup matches this repository and the installed tools are actually in use, report what matters, and propose setup changes. This routine only reads and reports. It never changes `~/.claude` and never installs anything on its own. An update is reported with its exact command and applied by the user.

Model: Sonnet (target). Run once per day.

Note: the scheduled task has no model field, so it runs on the app default. The first manual run (2026-10-09) ran on Haiku by decision. The first automatic run showed `claude-sonnet-5-5`, but whether that came from a setting or the default is unknown. Set Sonnet explicitly in the app's Scheduled settings and check the model shown in the run session.

## Steps

1. Read the installed version: `claude --version`.
2. Read the official changelog with WebFetch: `https://code.claude.com/docs/en/changelog`. Extract entries newer than `latest_changelog_version` in `state/last-seen.json`. If the file is missing, use the 10 most recent entries.
3. Read `https://www.anthropic.com/news` and list posts from the last 24 hours that concern Claude Code, models, skills, hooks, or subagents.
4. Optional signal only: search X for Claude Code and Claude Dev posts. x.com returns HTTP 402 to automated fetches, so use search snippets and do not rely on them. Official sources decide.
5. For each new item, classify it as: relevant to our setup, informational, or ignore. For relevant items, state the affected file in `claude/` and the proposed change.
6. Tool versions. Claude Code: installed (`claude --version`) against latest (`npm view @anthropic-ai/claude-code version`, cross-checked with the newest changelog entry; if `npm` is not installed, which is normal for the native installer, use the newest changelog entry alone). RTK: installed (`rtk --version`) against latest (`https://github.com/rtk-ai/rtk/releases/latest`). For each outdated tool, write the update command (npm, `winget upgrade rtk-ai.rtk` or `brew upgrade rtk`) in the report without running it.
   Optional tools, tracked whether or not they are installed:
   - Archify: latest = the release tag at `https://github.com/tt-a1i/archify/releases/latest`. Installed = `~/.claude/skills/archify/` exists. Its SKILL.md records only major.minor (for example `3.0` for release 3.0.1), so compare major.minor only and never report a patch-level gap as outdated. To settle the exact release, compare file hashes with the upstream tree (`gh api repos/tt-a1i/archify/git/trees/main?recursive=1`, each blob against `git hash-object`); on 2026-10-09 all 315 files matched v3.0.1. The README does not say where its installer writes files, so a missing folder means "not found", not proof of absence. The README gives no update command and says updates are never automatic; report re-running `npx skills add tt-a1i/archify -g` as unverified.
   - Ponytail: latest = `version` in `https://raw.githubusercontent.com/DietrichGebert/ponytail/main/.claude-plugin/plugin.json` (the repo publishes no release tags). Installed = an entry named `ponytail` in `~/.claude/plugins/installed_plugins.json`, enabled = `"ponytail@ponytail": true` under `enabledPlugins` in `settings.json`. Update path from install guides, unverified in the README: `/plugin marketplace update ponytail`, then `/reload-plugins`.
   - Never install or update either one. Ponytail is always on by decision (2026-10-09): it is expected to be installed and enabled, so "not installed" or "disabled" is reported as unhealthy. Archify is installed only when the user asks for a diagram, after reading its SKILL.md; "not installed, latest x.y.z" is normal for it. Report the changelog entries since the last run that matter to us.
7. Setup and tool health, read-only. Run `bash scripts/verify.sh --live` and copy its FAIL and WARN lines into the report; it checks the repo (JSON, shell syntax, rtk twins, auto default mode, `autoMode` arrays that keep `"$defaults"`, an empty `permissions.allow`, non-empty deny and ask lists, `CLAUDE.md` length, agent and skill frontmatter), that every file `apply.sh` copies equals the applied copy in the Claude config directory (`CLAUDE_CONFIG_DIR` or `~/.claude`), that `jq`, `rtk`, `node` and `gh` are on PATH, and that the Ponytail plugin is installed and enabled, that `claude` is 2.1.295 or newer, and that `claude auto-mode config` shows the repo's `autoMode` entries. A difference is reported, not fixed. Its Ponytail flag file in the config directory is the plugin's own write, not an edit by this routine.
   - RTK in use: `rtk gain` total commands against `rtk_total_commands` in `state/last-seen.json`. An unchanged count since the last run is a signal, not proof, because no Bash may have run. Say which it is when unknown.
7a. AO (Agent Orchestrator), read-only, skipped with "AO not installed" when the CLI is missing. The CLI is `ao` on PATH or `%LOCALAPPDATA%\Programs\agent-orchestrator\resources\daemon\ao.exe`. Run `ao version`, `ao status --json` and `ao doctor`, and compare the version with the latest in `https://docs.orchestrator.inc/changelog/`. Report only; never update AO (an auto-update once emptied its install folder) and never start or kill sessions.
7b. Repository exposure, read-only, needs `gh`. For each public repository from `gh repo list <owner> --limit 1000 --visibility public --json name`, list root file names with `gh api repos/<owner>/<repo>/contents --jq '.[].name'` and compare them with the secret name patterns used by `claude/hooks/secret-guard.sh` (`.credentials*`, `.env`, `.env.*`, `id_rsa*`, case-insensitive, except names ending in `.example`, `.sample`, `.template` or `id_rsa*.pub`, `.claude.json`, `history.jsonl`, `*.pem`). Read file names only, never contents. A match goes at the very top of the report as `EXPOSED <repo> <file name>`; say "not checked" if `gh` is not logged in.
7b. Tool health, read-only. Run `curl -s http://127.0.0.1:8787/api/state` when the dashboard is up and copy every `tools` item whose level is `warn` or `bad` (claude-mem worker and observer, prompt history and session-log sizes, apply backups, AO daemon and workers) with its `fix` text into the report. If the dashboard is down, read `~/.claude-mem/observer-health.json` and `curl -s http://127.0.0.1:37777/api/health` directly and say so. A `fix` is a proposal: do not run it, and mark its source as given in the text (`미확인` means not checked against an official page).
7c. Tool efficiency facts, read-only. When the dashboard is up, read `curl -s http://127.0.0.1:8787/api/inventory` and copy `.efficiency.sources[]` into the report as `tool | metric | value | basis` (basis is measured, estimated or unavailable; copy it, never upgrade an estimate to a measurement and never fill an unavailable metric with a number). Compare RTK `saved_tokens` with `rtk_total_saved` in `state/last-seen.json`. If the dashboard is down, run `rtk gain -f json` and say the other tools were not read. Quote each source's `ideas` as proposals only.
8. Official docs watch. Run `bash scripts/docs-watch.sh --update`. It fetches the pages this setup depends on (best-practices, memory, skills, sub-agents, permissions, plugins, settings, hooks-guide, permission-modes, auto-mode-config, agent-teams, monitoring-usage, worktrees) and prints NEW (first run on this machine: baseline, no analysis), SAME, or CHANGED with a short line diff. For each CHANGED page read the diff, and fetch the page only when the diff is not enough. Classify each change as relevant (affects `claude/settings.json`, `claude/CLAUDE.md`, an agent, a skill, a script or this routine), informational, or ignore. For a relevant change state the affected file and the proposed change with the page URL.
9. Write `reports/YYYY-MM-DD.md` in this repository (a second run on the same day overwrites it; the latest run wins) with: tool versions, new items, setup health, docs watch, proposed changes, and what was not verified.
10. Update `state/last-seen.json` with these exact keys, writing a key only if its value was read this run: `checked_on`, `installed_cli`, `latest_changelog_version`, `latest_changelog_date`, `latest_cli_npm`, `installed_rtk`, `latest_rtk_version`, `rtk_total_commands`, `rtk_total_saved`, `latest_archify_version`, `latest_ponytail_version`, `ao_version`, `exposed_repos` (names of repositories with a match, empty list when none).
11. Do not edit the Claude config directory, do not install anything, do not commit or push. This routine writes only `reports/` (including the docs cache) and `state/last-seen.json`. A proposed change is applied only after the user approves it in chat.

## Output format

```
Date: YYYY-MM-DD
Claude Code: installed x.y.z | latest x.y.z | update command (if outdated)
RTK: installed x.y.z | latest x.y.z | update command (if outdated)
Archify: not installed or x.y.z | latest x.y.z | changes since last run
Ponytail: installed x.y.z, enabled yes/no (or NOT INSTALLED, unhealthy) | latest x.y.z | changes since last run
EXPOSED: repo | file name (only when found, first line of the report)
AO: not installed or x.y.z | latest x.y.z | doctor result (report only)
Setup health: verify.sh --live | N FAIL, N WARN | the FAIL and WARN lines
- rtk in use | commands today vs last run | signal or unknown
Tool efficiency:
- tool | metric | value | measured, estimated or unavailable
Docs watch:
- page | NEW, SAME or CHANGED | relevance to us
Relevant:
- item | affected file | proposed change | source URL
Informational:
- item | source URL
Not verified:
- item | reason
```

## Scheduling

Created on the first machine on 2026-10-09. On a new machine, create it in the app's scheduled tasks from `claude/scheduled-tasks/daily-claude-update/SKILL.md` after replacing `<repo>`, and enable it on every machine that should be checked. Each machine keeps its own `reports/` and `state/last-seen.json` (both gitignored), so counters such as `rtk_total_commands` are only ever compared with the same machine's previous run. A missing file or key means "unknown", not a failure.
