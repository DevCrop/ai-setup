---
name: daily-claude-update
description: Daily check of Claude Code, RTK and Anthropic releases, changes to the official docs this setup depends on, setup health and tool health; writes a report with proposals. Never edits the Claude config directory, installs, commits or pushes.
---

Reference copy of the scheduled task body. Replace `<repo>` with the absolute path of this machine's ai-setup clone before using it.

Run the daily update routine defined in <repo>/claude/routines/daily-update.md. That file is the single source of truth for the steps and the output format; follow it exactly and do not rely on a copy of the steps anywhere else. Because the task reads the file from the clone, a `git pull` is enough to update the steps; only this pointer body needs re-pasting into the app when it changes.

Paths: the report goes to <repo>/reports/YYYY-MM-DD.md and the per-machine baseline is <repo>/state/last-seen.json (both gitignored).

Hard limits:
- Do not edit anything under the Claude config directory (CLAUDE_CONFIG_DIR or ~/.claude). Exception: the Ponytail hooks write their own `.ponytail-active` flag there; that is not an edit by this task.
- Do not run npm install, winget, brew, or rtk init.
- Do not git push or commit. Leave changes unstaged.
- Do not apply proposed config changes. Only propose them in the report, as a diff.
- Write only <repo>/reports/ and <repo>/state/last-seen.json.

Finish by stating the report path, the count of relevant items, the FAIL and WARN counts from verify.sh --live, and any tool that is outdated or unhealthy.
