---
name: daily-claude-update
description: Daily check of Claude Code, RTK and Anthropic releases, changes to the official docs this setup depends on, setup health and tool health; writes a report with proposals. Never edits the Claude config directory, installs, commits or pushes.
---

Paste this body into the app as is and set the task's folder to this machine's ai-setup clone; the folder is the only place the path lives.

Run the daily update routine defined in claude/routines/daily-update.md in the working folder. That file is the single source of truth for the steps, the limits and the output format; follow it exactly. If the file is not there, the task folder is wrong: stop and report that, and write nothing.
