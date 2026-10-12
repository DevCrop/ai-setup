---
name: orchestrate
description: Use when splitting work across subagents, before delegating to a role agent (publisher, frontend, backend, qa), explorer, worker or reviewer, or when deciding whether to delegate at all.
when_to_use: Requests such as 나눠서 해줘, 서브에이전트로 돌려, 병렬로 처리해, 이거 위임해도 돼, split this across agents, use subagents for this.
---

Default to one agent. Delegate only when the part does not block the main thread's next step, or its output is large and mostly irrelevant to it. Otherwise work inline. Every delegate also pays a start-up cost: about 43K prompt tokens written to the cache in the one call measured (2026-10-12, `docs/evidence.md` in the claude-global repository), so a one-file lookup or a short edit is cheaper inline.

1. Split by context and file ownership, not by job title. Roles that depend on each other in sequence and need the user (기획, 디자인) stay in the main thread: skills `spec-writing`, then `design-spec`. Delegate only parts that own different files.
2. Route by what the part touches:

   | Part | Agent |
   |---|---|
   | Static markup, CSS, templates | `publisher` |
   | Client logic, state, API calls | `frontend` |
   | Server code, API, database | `backend` |
   | Run it and check behavior | `qa` |
   | Diff against written criteria | `reviewer` |
   | One search question | `explorer` |
   | A change no role above fits | `worker` |

3. Usual order: spec, design, then `backend` and `publisher` together, then `frontend` (it needs the contract file `docs/api-<topic>.md` that `backend` writes), then `qa`, then `reviewer`.
4. A delegate does not see this conversation. Brief it with: Task (one sentence), Files (paths it needs, the spec and design paths, the API contract file), Return format, Done criteria (checkable by a command or a file read), Out of scope. Delegates report in English; the main thread translates for the user.
5. At most 3 delegates at once, and no two may edit the same file. Each owns one unit: a feature slice with its tests, one search question, or one verification.
   - Launch independent delegates in one message so they run at the same time.
   - Run a long delegate in the background and keep working; its report arrives as a message, so do not poll or sleep. In a non-interactive run (`claude -p`) it cannot ask for permission, so its tools must already be allowed (`docs/evidence.md`).
   - If two delegates cannot be kept off the same files, give each `isolation: worktree` (a temporary git worktree), or split by file instead. The worktree branches from the default branch, so the delegate does not see uncommitted work.
6. Give `qa` and `reviewer` the criteria and the changed file list only, never the author's reasoning or a verdict to confirm.
7. A delegate's report is a claim. Check the evidence it cites before relaying it as done. If a delegate stops because an input is missing (an API contract, a design spec, a criterion), get that input from the user or from a file in the repo. Never invent it and put it in a new brief: that turns a guess into an instruction. If you cannot get it, report the stop and what is missing. A delegate cannot ask the user: it puts its open questions and the reason it stopped at the top of its report. A report from a delegate that used all its turns (maxTurns) is partial: do not relay it as done; split the part smaller, resume it (it continues where it stopped) or do it inline.
8. Model lanes (decision 2026-10-12, no Sonnet): the main thread runs on Opus at medium effort and orchestrates; Haiku executes (explorer, publisher, worker, backend, frontend), so give it a brief with exact files and checkable done criteria; Opus verifies (qa, reviewer: a false pass costs more than the model saving) and advises; Fable only when the user picks it for one hard task (it draws from a capped share of the same weekly limit). When a Haiku executor fails the same criterion twice, do the part inline on Opus instead of a third try. Codex (`gpt-6.1-sol`) only as the AO PR reviewer, so the reviewer is a different vendor from the Claude author; never as a worker.

## AO (Orchestrator.inc) instead of subagents
- Use it only for long parallel work with disjoint file scopes; otherwise use the subagents above.
- Put the done criteria and "never push" in `--agent-rules`; permissions come from the project config: `ao project set-config <id> --permission auto` (values: default, accept-edits, auto, bypass-permissions; `set-config` replaces the whole project config, so round-trip `ao project get --json` first). Deny/ask rules apply to workers in every mode.
- Reviewer: Codex. `ao project set-config <id> --config-json "$(ao project get <id> --json | jq -c '(.project.config // {}) + {reviewers: [{harness: "codex", agentConfig: {model: "gpt-6.1-sol"}}]}')"`. Send only `.project.config`: `set-config` ignores unknown keys, so the whole `get` output, or `{"config": ...}`, silently replaces the config with an empty one. `--reviewer` takes a harness name, not a model. One pass only: `ao review trigger <session> --harness codex --model gpt-6.1-sol` (`--effort` too; the config cannot carry reviewer effort through the CLI). The Codex CLI must be installed and logged in on that machine.
- Trigger `ao review` before ending a worker session (an ended session cannot be reviewed); a person pushes and merges.
- Details and measurements: `docs/evidence.md` ("Orchestrator.inc(AO) 도입 검토") in the claude-global repository (it is not copied to `~/.claude`).
