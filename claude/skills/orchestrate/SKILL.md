---
name: orchestrate
description: Use when splitting work across subagents, before delegating to a role agent (publisher, frontend, backend, qa), explorer, worker or reviewer, or when deciding what to delegate.
when_to_use: Requests such as 서브에이전트로 나눠서 해줘, 에이전트한테 맡겨, 병렬 에이전트로 돌려, 이 작업 위임해도 돼, split this across subagents, delegate this to agents.
---

The main thread does not write or edit code: every code change goes to an executor. Reading, a one-file lookup, git and plain docs stay inline, because every delegate pays a start-up cost (about 43K prompt tokens written to the cache in the one call measured).

1. Split by context and file ownership, not by job title. Roles that depend on each other in sequence and need the user (기획, 디자인) stay in the main thread: skills `spec-writing`, then `design-spec`; `publisher` and `frontend` preload `ui-baseline` and `frontend-design`. Delegate only parts that own different files.
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
   - Run a long delegate in the background and keep working; its report arrives as a message, so do not poll or sleep. In a non-interactive run (`claude -p`) it cannot ask for permission, so its tools must already be allowed.
   - If two delegates cannot be kept off the same files, give each `isolation: worktree` (a temporary git worktree), or split by file instead. The worktree branches from the default branch, so the delegate does not see uncommitted work.
6. Give `qa` and `reviewer` the criteria and the changed file list only, never the author's reasoning or a verdict to confirm.
7. A delegate's report is a claim. Check the evidence it cites before relaying it as done. If a delegate stops because an input is missing (an API contract, a design spec, a criterion), get that input from the user or from a file in the repo. Never invent it and put it in a new brief: that turns a guess into an instruction. If you cannot get it, report the stop and what is missing. A delegate cannot ask the user: it puts its open questions and the reason it stopped at the top of its report. A report from a delegate that used all its turns (maxTurns) is partial: do not relay it as done; split the part smaller or resume it (it continues where it stopped).
8. Model lanes, with the roles kept apart:
   - Opus, the main thread at medium effort: plans, writes briefs and decides.
   - Haiku executes parts whose files and steps the brief fixes exactly: `explorer` (read-only), `publisher`, `worker`.
   - Sonnet executes parts that need judgment while coding: `frontend`, `backend`.
   - Opus verifies: `qa` and `reviewer` (a false pass costs more than the model saving). Fable only when the user picks it for one hard task (it draws from a capped share of the same weekly limit).
9. When a part fails:
   - A Haiku executor fails the same criterion twice: give the same brief to the same agent with the per-call `model` set to `sonnet`.
   - Verification fails: send the reviewer's or qa's findings to the same executor once.
   - Sonnet fails the same criterion twice, or the resent part fails verification again: stop and report the cause to the user. Do not take the part over inline.
