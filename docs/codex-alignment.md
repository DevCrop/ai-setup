# Claude and Codex setups side by side

`claude/` (applied to `~/.claude` by `scripts/apply.sh`) and `codex/` (the Codex setup TRACE, applied to `~/.codex` by its own `setup.py`; its bundled skills go to `~/.agents/skills`) are two global setups on the same machines. Each tool loads only its own files, so nothing is shared automatically.

They are kept apart on purpose:
- Each file follows its own vendor's official docs.
- TRACE's `official-source-workflow.md` says not to mirror changes into another agent's files.
- The project layer is already shared: project `AGENTS.md` is the source, and a project `CLAUDE.md` starts with `@AGENTS.md` (skill `project-setup`).

Compared files: `claude/CLAUDE.md`, `claude/RTK.md`, `claude/skills/orchestrate/SKILL.md` against `codex/global/AGENTS.md`, `codex/global/guides/*.md`, `codex/global/agents/explorer.toml` and `codex/global/skill-policy/openai.yaml`. Re-read both sides when either changes.

## Same intent (keep both as they are)
| Rule | Claude (`claude/CLAUDE.md`) | Codex (`codex/global/AGENTS.md`) |
|---|---|---|
| Language and honesty | Reply in Korean; separate evidence from inference | Respond in Korean; distinguish evidence from inference |
| Completion needs evidence | Confirm with a command, test or source; say what was not tested | Report checks actually performed and material limitations |
| Scope | Change only what the request names; list unrelated issues | Preserve unrelated user changes; keep project rules in the project |
| Repeated failure | Two attempts on the same error, then stop and ask | Retry only with new evidence |
| Destructive actions | Show the target and confirm before deleting or overwriting | Confirm exact targets and ownership before removing files |
| Credentials | Never read or commit `.credentials*` or `.env*` | Preserve credentials (`AGENTS.md`); exclude them when staging (`guides/github-workflow.md`) |
| Official sources | Read the current official source for anything that may have changed | `guides/official-source-workflow.md` for durable guidance |
| Delegation | `orchestrate` skill: brief template, disjoint file scopes | `guides/agent-orchestration.md`: handoff template, non-overlapping ownership |

## Different on purpose (no change)
| Topic | Claude | Codex | Why both stay |
|---|---|---|---|
| RTK | Transparent hook rewrites `git ...` to `rtk git ...`; every deny rule has an `rtk ` twin | Explicit runner `bin/trace_rtk.py`; no hook | Codex's native approval classifier does not unwrap RTK (`guides/rtk.md`). Claude's deny rules are tested with the rewrite (`qa-deny.sh`). |
| Ponytail | Always on (about 641 tokens a session) | Only when explicitly requested (`allow_implicit_invocation: false`) | Each setup records its own choice. Change either one only by a new decision. |
| Verification | A separate reviewer subagent; the author does not verify its own output | The parent reviews the affected diff and owns integration and verification | Claude has reviewer and qa role agents. In AO the Codex reviewer covers the cross-vendor check (below). |
| Parallel delegates | At most 3 | At most 2 children, no recursion | Local operating limits, not official values. Each fits its own tool's limits. |
| Model choice | Lanes: Opus main and verifiers (medium effort main), Haiku executors, Fable on request; no Sonnet | Keep the user's selected model and effort; children default to GPT-6.1 Sol medium, the `explorer` agent to Sol high; CLI profiles are optional | Claude routes by role; TRACE leaves the parent's choice to the user. |
| Branch prefix | `claude/` (the Claude Code harness convention; not written in `claude/`) | `codex/` (`guides/github-workflow.md`) | The prefix shows which tool made a branch. |

## Where the two meet: AO
When AO is used (a candidate, not the default: `docs/DECISIONS.md`), its workers are Claude Code and its reviewer is Codex: `reviewers[].harness = "codex"`, model `gpt-6.1-sol` (`docs/DECISIONS.md`, "AO reviewer lane").

The reviewer reads the project `AGENTS.md` and `~/.codex/AGENTS.md`. It never reads `~/.claude/CLAUDE.md`. So a rule that must hold for both the work and its review belongs in the project `AGENTS.md`:
- Project rules: commit format, test commands, done criteria.
- Personal rules that differ by tool stay in each tool's own file.

## Open differences (user decides; nothing is changed by this page)
1. **Project path rule.** `claude/CLAUDE.md` (Working method) finds the project from the cwd by its marks under a per-machine work root; `codex/global/AGENTS.md` only says to resolve the active root. Adding the same line there makes both agents find the project the same way (BACKLOG section 6).
2. **Handoff note.** `claude/CLAUDE.md` (Context and handoff) writes `.claude/handoff.md` before `/clear` or a new session and posts it on the work's open PR. Codex has no session handoff rule; its handoff template is for delegation only (`guides/agent-orchestration.md`).
3. **Commit and test rules.** `claude/CLAUDE.md` asks for English Conventional Commits and a reproducing test for each bug fix. The Codex agreement has neither. To make the Codex reviewer check these, put them in each project's `AGENTS.md`, not in a global file.
4. **UTF-8.** The Codex agreement says "Use UTF-8 for text"; it gives no reason. Claude has no such rule and no recorded problem. Add one only after a failure is seen.
5. **Codex review quota.** The ChatGPT Codex GitHub review bot can report "usage limits for code reviews". Not checked: whether AO's Codex reviewer (the Codex CLI) draws on the same quota.
