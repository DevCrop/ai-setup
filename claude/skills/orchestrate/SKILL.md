---
name: orchestrate
description: Use when deciding whether to delegate, when splitting work across subagents, or before delegating to a role agent (publisher, frontend, backend, qa), explorer, worker or reviewer.
when_to_use: Requests such as 서브에이전트로 나눠서 해줘, 에이전트한테 맡겨, 병렬 에이전트로 돌려, 이 작업 위임해도 돼, split this across subagents, delegate this to agents.
---

Work in the main loop by default: the main thread reads, plans and writes the code itself, loading skills (`frontend-design`, `ui-baseline`, ...) when a task needs them. Every handoff loses detail in the brief and the summary back, and each delegate pays a start-up cost (about 43K prompt tokens written to the cache in the one call measured). Delegate only a part that earns it.

1. Delegate when one of these holds, and only that part:
   - Independent parts that can run at the same time, own different files and need little from this conversation; each returns a compact result.
   - A broad search or read whose raw output would crowd the main context: `explorer`.
   - Verification: `reviewer` or `qa`, always a separate agent from the author.
   - The user asks for subagents or a parallel run.
2. Keep inline: small changes, parts that depend on each other in sequence or touch the same files, and anything that needs this conversation's context. If the brief would take longer to write than the change, do the change. Roles that need the user (기획, 디자인) stay inline: skills `spec-writing`, then `design-spec`. An explicit user request to delegate wins over this rule.
   - Inline or delegated, never guess a missing input (an API contract, a design spec, a criterion): get it from the user or a file in the repo, or stop and say what is missing.
3. Route a delegated part by what it touches:

   | Part | Agent |
   |---|---|
   | Static markup, CSS, templates | `publisher` |
   | Client logic, state, API calls | `frontend` |
   | Server code, API, database | `backend` |
   | Run it and check behavior | `qa` |
   | Diff against written criteria | `reviewer` |
   | One search question | `explorer` |
   | A change no role above fits | `worker` |

   When both `backend` and `frontend` are delegated, `backend` goes first and writes the contract file `docs/api-<topic>.md`; start `frontend` only once that file exists.

4. A delegate does not see this conversation. Brief it with: Task (one sentence), Files (paths it needs, the spec and design paths, the API contract file), Return format, Done criteria (checkable by a command or a file read), Out of scope. Delegates report in English; the main thread translates for the user.
5. At most 3 delegates at once, and no two may edit the same file.
   - Launch independent delegates in one message so they run at the same time.
   - Run a long delegate in the background and keep working; its report arrives as a message, so do not poll or sleep. In a non-interactive run (`claude -p`) it cannot ask for permission, so its tools must already be allowed.
   - If two delegates cannot be kept off the same files, give each `isolation: worktree` (a temporary git worktree), or split by file instead. The worktree branches from the default branch, so the delegate does not see uncommitted work.
6. Give `qa` and `reviewer` the criteria and the changed file list only, never the author's reasoning or a verdict to confirm.
7. A delegate's report is a claim. Check the evidence it cites before relaying it as done. If a delegate stops because an input is missing (an API contract, a design spec, a criterion), get that input from the user or from a file in the repo. Never invent it and put it in a new brief: that turns a guess into an instruction. If you cannot get it, report the stop and what is missing. A delegate cannot ask the user: it puts its open questions and the reason it stopped at the top of its report. A report from a delegate that used all its turns (maxTurns) is partial: do not relay it as done; split the part smaller or resume it (it continues where it stopped).
8. Model lanes:
   - Opus, the main thread at medium effort: plans, decides and does the inline work.
   - Haiku executes delegated parts whose files and steps the brief fixes exactly: `explorer` (read-only), `publisher`, `worker`.
   - Sonnet executes delegated parts that need judgment while coding: `frontend`, `backend`.
   - Opus verifies: `qa` and `reviewer` (a false pass costs more than the model saving). Fable only when the user picks it for one hard task (it draws from a capped share of the same weekly limit).
9. When a delegated part fails:
   - A Haiku executor fails the same criterion twice: give the same brief to the same agent with the per-call `model` set to `sonnet`.
   - Verification fails: send the reviewer's or qa's findings to the same executor once.
   - Sonnet fails the same criterion twice, or the resent part fails verification again: take the part over inline with the findings, once, and have a separate reviewer check it. If that fails too, stop and report the cause to the user.
