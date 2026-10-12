# Claude and Codex setups side by side

This repo (`claude/`, applied to `~/.claude`) and [DevCrop/codex-setup](https://github.com/DevCrop/codex-setup) (TRACE v1.2.4, applied to `~/.codex`; it touches `~/.agents/skills` only to retire old files) are two global setups on the same machines. Each tool loads only its own files, so nothing is shared automatically.

They are kept apart on purpose:
- Each file follows its own vendor's official docs.
- TRACE's `official-source-workflow.md` says not to mirror changes into another agent's files.
- The project layer is already shared: project `AGENTS.md` is the source, and a project `CLAUDE.md` starts with `@AGENTS.md` (skill `project-setup`).

This page lists where the two personal layers agree, where they differ, and which differences are deliberate.

Compared on 2026-10-12:
- Claude side: `claude/CLAUDE.md`, `claude/RTK.md`, `claude/skills/orchestrate/SKILL.md`.
- Codex side: `global/AGENTS.md` and `global/guides/*.md` in codex-setup at `c297240`.

## Same intent (keep both as they are)
| Rule | Claude (`claude/CLAUDE.md`) | Codex (`global/AGENTS.md`) |
|---|---|---|
| Language and honesty | Reply in Korean; separate evidence from inference | Respond in Korean; distinguish evidence from inference |
| Completion needs evidence | Confirm with a command, test or source; say what was not tested | Report checks actually performed and material limitations |
| Scope | Change only what the request names; list unrelated issues | Preserve unrelated user changes; keep project rules in the project |
| Repeated failure | Two attempts on the same error, then stop and ask | Reassess before retrying; never repeat an unchanged failed attempt |
| Destructive actions | Show the target and confirm before deleting or overwriting | Confirm exact targets and ownership before removing files |
| Credentials | Never read or commit `.credentials*` or `.env*` | Preserve credentials (`AGENTS.md`); exclude them when staging (`guides/github-workflow.md`) |
| Official sources | Read the current official source for anything that may have changed | `official-source-workflow.md` for durable guidance |
| Delegation | `orchestrate` skill: brief template, disjoint file scopes | `agent-orchestration.md`: handoff template, non-overlapping ownership |

## Different on purpose (no change)
| Topic | Claude | Codex | Why both stay |
|---|---|---|---|
| RTK | Transparent hook rewrites `git ...` to `rtk git ...`; every deny rule has an `rtk ` twin | Explicit runner `bin/trace_rtk.py`; no hook | Codex's native approval classifier does not unwrap RTK (TRACE `guides/rtk.md`). Claude's deny rules are tested with the rewrite (`qa-deny.sh`). |
| Ponytail | Always on (decision 2026-10-09, about 641 tokens a session) | Only when explicitly requested (`allow_implicit_invocation: false`) | Each setup recorded its own choice. Change either one only by a new decision. |
| Verification | A separate reviewer subagent; the author does not verify its own output | The parent reviews the affected diff | Claude has reviewer and qa role agents. In AO the Codex reviewer covers the cross-vendor check (below). |
| Parallel delegates | At most 3 | At most 2 children, no recursion | Local operating limits, not official values. Each fits its own tool's limits. |
| Model choice | Lanes: Haiku, Sonnet, Opus as advisor, Fable on request | Keep the user's selected model and effort; CLI profiles are optional | Claude routes by role; TRACE leaves the choice to the app. |
| Branch prefix | `claude/` (the Claude Code harness convention; not written in `claude/`) | `codex/` (`guides/github-workflow.md`) | Local reasoning: the prefix shows which tool made a branch. |

## Where the two meet: AO
When AO is used (still a candidate, `docs/DECISIONS.md`), its workers are Claude Code and, from 2026-10-12, its reviewer is configured as Codex: `reviewers[].harness = "codex"`, model `gpt-6.1-sol` (`docs/DECISIONS.md`).

The reviewer reads the project `AGENTS.md` and `~/.codex/AGENTS.md`. It never reads `~/.claude/CLAUDE.md`. So a rule that must hold for both the work and its review belongs in the project `AGENTS.md`:
- Project rules: commit format, test commands, done criteria.
- Personal rules that differ by tool stay in each tool's own file.

## Open points (user decides; nothing is changed by this page)
1. **Commit and test rules.** `claude/CLAUDE.md` asks for English Conventional Commits and a reproducing test for each bug fix. The Codex agreement has neither. To make the Codex reviewer check these, put them in each project's `AGENTS.md`, not in a global file.
2. **UTF-8.** The Codex agreement says "Use UTF-8 for text" (`global/AGENTS.md`); it gives no reason. Claude has no such rule and no recorded problem. Add one only after a failure is seen.
3. **Codex review quota.** The ChatGPT Codex GitHub review bot reported "usage limits for code reviews" on PR #74 (2026-10-12). Not checked: whether AO's Codex reviewer (the Codex CLI) draws on the same quota.

## Asks for the Codex side (codex-setup is maintained by Codex; this repo does not change it)
- Skills are deployed to `$CODEX_HOME/skills`. Codex source marks that path deprecated ("Deprecated user skills location (`$CODEX_HOME/skills`), kept for backward compatibility.", `codex-rs/ext/skills/src/host_roots.rs` at `openai/codex` `9f3d255`); the current location is `~/.agents/skills`. No `files` entry in `manifest.json` sets `root`, so `setup.py` defaults it to `codex` (only `retired` entries use `personal_skills`), while the README describes `~/.agents/skills` as the personal skill root.
- `setup.py verify` does not detect a legacy `[profiles.<name>]` table in `config.toml` with the same name as a `<name>.config.toml` profile file. The Codex loader refuses `--profile <name>` in that case (`codex-rs/config/src/loader/tests.rs`, `profile_v2_rejects_matching_legacy_profile_in_base_user_config`).
- Both findings come from reading source only. Recheck them against the official docs, which this cloud container cannot reach.
