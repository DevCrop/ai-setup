# Project setup guide

How to set up Claude Code for one project, on top of the global layer this repo installs. Run `/project-setup` in the project to do it; this page says what it should produce and why.

Sources (read 2026-10-18): [memory](https://code.claude.com/docs/en/memory), [settings](https://code.claude.com/docs/en/settings), [best practices](https://code.claude.com/docs/en/best-practices).

## Layers

| Layer | File | Shared via git | Holds |
|---|---|---|---|
| Global (this repo) | `~/.claude/CLAUDE.md`, `~/.claude/settings.json` | no | How Claude talks and works everywhere, permission mode, plugins, agents, skills |
| Project | `CLAUDE.md` (or `.claude/CLAUDE.md`), `.claude/settings.json`, `.claude/rules/` | yes | Commands, conventions and permissions of this project |
| Personal | `CLAUDE.local.md`, `.claude/settings.local.json` | no | Your own notes and overrides for this project |

Settings win from top to bottom: managed, `--settings`, project local, shared project, user. Instruction files do not override each other; all of them are loaded and joined, so when two contradict, Claude may follow either one.

## What goes in the project

1. **`CLAUDE.md`**, under 200 lines. Only what Claude cannot learn from the code or the global file: build, test and lint commands, conventions that differ from the defaults, real gotchas, and "run the check before reporting done". Never repeat the global rules. `/init` makes a first draft.
2. **`AGENTS.md`**, if the repo has one for other tools: keep it as the source. Claude reads it only when no `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` exists, so if you add any of them, start the `CLAUDE.md` with `@AGENTS.md`.
3. **`.claude/rules/<area>.md`** for rules that only matter for some files. Add `paths:` frontmatter so they load only when Claude touches those files.
4. **`.claude/settings.json`**:
   - `permissions.deny` for `Read(**/.env*)`, `Read(**/.credentials*)` and `Read(**/credentials.json)`. The global layer has no deny rules, and deny still blocks in bypass mode.
   - `permissions.allow` for read-only check commands (test, lint, typecheck); these matter in cloud sessions, which do not read `~/.claude`.
   - Never set `defaultMode`: `auto` and `bypassPermissions` are not honored from project settings, and putting them there drops you out of the global bypass mode.
5. **`.gitignore`**: `CLAUDE.local.md`, `.claude/settings.local.json` and `.claude/handoff.md`.

Leave out: plugins (they are global), hooks unless the project needs a hard gate, and anything a linter already enforces.

## Check

Open a new session in the project: `/context` should list the project `CLAUDE.md`, a long file is flagged at startup and in `/status`, `/doctor` suggests cuts, and `/doctor prompt-audit` looks for contradicting instructions.
