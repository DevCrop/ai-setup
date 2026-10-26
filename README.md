# ai-setup

Source of truth for the global Claude Code setup (`~/.claude`). Edit `claude/` here, never `~/.claude` directly; `bash scripts/apply.sh` copies it over.

What it sets up: Ponytail (plugin), RTK (Bash hook + `RTK.md`), claude-mem (plugin), subagents (Opus works in the main loop and delegates only independent parallel parts, broad searches, verification, or when asked; Sonnet runs `designer`, `publisher` and `developer`, which keep lessons in their own memory; Haiku runs `explorer`; Opus runs `reviewer`; other one-off parts go to the built-in `general-purpose` with a per-call model) with their `orchestrate`, `spec-writing`, `design-spec`, `ui-baseline`, `frontend-design`, `publishing`, `developing` and `project-setup` skills, two session hooks (`compact-context`, `config-audit`) and the status line. There are no deny rules and no secret hook: permissions default to `bypassPermissions` (no prompts), so safety rests on the Safety lines of `claude/CLAUDE.md` alone. In the desktop app, also turn on Settings → Claude Code → "Allow bypass permissions mode".

The full setup before this was slimmed down (AO, Codex, dashboard, daily routine, deny rules, secret guard) is at tag `legacy-full`.

## Use

| Situation | Do this |
|---|---|
| Take the latest `main` | `git pull && bash scripts/apply.sh` (Git Bash on Windows, not PowerShell) |
| After a plugin pin changes | Apply, open and close one Claude Code session (it refreshes the local marketplace copy), then `claude plugin update ponytail@ponytail` and `claude plugin update claude-mem@thedotmack`, then start a new session. Apply alone does not upgrade plugins |
| Preview an apply | `bash scripts/apply.sh --dry-run` |
| Check the setup is working | `node scripts/monitor.mjs` writes one HTML page to the temp folder and prints its path; add `--watch` to refresh it every 10 s (it then also writes `status.json` next to the page). It reads local files and the local claude-mem worker only. The Claude Monitor desktop app in `app/` (Electron) shows that status as a small always-on-top strip above the Windows taskbar and opens a full window with Codex and optimizer tabs; `bootstrap/setup.ps1 -Only claude-monitor` installs it to start at login |
| Set up a project | Run `/project-setup` in it; `docs/project-setup.md` says what it should produce |
| Chat instructions (claude.ai, desktop chat) | Paste the block in `docs/chat-instructions.md` into Settings → Profile |
| New Mac | In Terminal: `curl -fsSL https://raw.githubusercontent.com/DevCrop/ai-setup/main/bootstrap/setup-mac.sh -o /tmp/ai-setup-mac.sh && bash /tmp/ai-setup-mac.sh` (`--dry-run` previews). It installs Homebrew if missing, then git, jq, node, rtk, bun (claude-mem needs it) and Claude Code, clones this repo to `~/project/ai-setup` (`AI_SETUP_DIR` changes it), applies, and installs the two plugins and updates them to the pinned version. Log in with `claude` and run it again if a plugin step failed. Claude Monitor is Windows only |
| New Windows PC | Run `bootstrap/setup.ps1` (one PowerShell line in `bootstrap/README.md`): installs the tools, clones this repo, applies, sets the work root and runs the modules. By hand: `git`, `jq`, `rtk` (`winget install rtk-ai.rtk`); plugins `ponytail@ponytail` and `claude-mem@thedotmack`, then `bash scripts/setup-claude-mem.sh`; then the first row |

Open a new Claude Code session after an apply: running sessions do not pick up changed settings or plugins.

## How apply works

- `settings.json` is merged key by key. The keys in `scripts/owned-keys.json` are owned: the repo value replaces the live one, and a key the repo lacks is deleted. Other repo keys take the repo value; machine-only keys are kept and reported. `scripts/removed-keys.json` lists keys that are deleted.
- Files are tracked in `~/.claude/.ai-setup-manifest`: a file that an earlier apply copied and the repo no longer has is deleted; a file that never came from this repo is kept and reported.

## Checks

`bash scripts/qa-apply.sh`, `qa-hooks-session.sh`, `qa-statusline.sh`, `qa-setup-claude-mem.sh`, `qa-monitor.sh`, `QA_MODE=selftest bash scripts/qa-role-agents.sh "$(mktemp -d)"` and `bash scripts/eval.sh selftest "$(mktemp -d)"` run without a model (CI runs them). `scripts/eval.sh run` and `judge` score the live setup on five fixed web-agency tasks (`evals/check.mjs` grades them) and compare two setups blind; see the script header. `qa-role-agents.sh` in real mode and `qa-project-setup.sh` need the claude CLI.

## Changing this repo

Branch from `main`, edit, run the matching check, open a PR. A separate reviewer subagent checks it against written criteria. Merge once CI is green, then apply on every machine.
