---
name: orchestrate
description: Use when deciding whether to delegate, when splitting work across subagents, or before delegating to a role agent (designer, publisher, developer), explorer or reviewer.
when_to_use: Requests such as 서브에이전트로 나눠서 해줘, 에이전트한테 맡겨, 병렬 에이전트로 돌려, 이 작업 위임해도 돼, split this across subagents, delegate this to agents.
---

Work in the main loop by default: the main thread reads, plans and writes the code itself, loading skills (`publishing`, `developing`, `frontend-design`, ...) when a task needs them. Every handoff loses detail in the brief and the summary back, and each delegate pays a start-up cost (about 43K prompt tokens written to the cache in the one call measured). Delegate only a part that earns it.

1. Delegate when one of these holds, and only that part:
   - Independent parts that can run at the same time, own different files and need little from this conversation; each returns a compact result.
   - A broad search or read whose raw output would crowd the main context: `explorer`.
   - Verification: `reviewer`, always a separate agent from the author. Every delegated code change gets a `reviewer` call before it is reported done.
   - The user asks for subagents or a parallel run.
2. Keep inline: small changes, parts that depend on each other in sequence or touch the same files, and anything that needs this conversation's context. If the brief would take longer to write than the change, do the change. 기획 needs the user, so it stays inline with the `spec-writing` skill; the client's design direction is set inline with the user before `designer` runs. An explicit user request to delegate wins over this rule.
   - Inline or delegated, never guess a missing input (an API contract, a design spec, a criterion): get it from the user or a file in the repo, or stop and say what is missing.
3. Route a delegated part by what it touches:

   | Part | Agent |
   |---|---|
   | Figma frames or a spec into `docs/design-<topic>.md` | `designer` |
   | Markup, SCSS/CSS, templates, UI-interaction TS (tabs, accordion, modal, slider) | `publisher` |
   | Server, API, database, CORS, payments, client data code (fetch, state, business logic) | `developer` |
   | Run it and check it against written criteria | `reviewer` |
   | One search question | `explorer` |
   | A change no role above fits | `general-purpose` |

   Order and hand-off are through files, never agent to agent: `designer` writes `docs/design-<topic>.md` before `publisher` starts; `developer` writes `docs/api-<topic>.md` (and `docs/arch-<topic>.md` for payments) before client code that calls it. Run `publisher` and `developer` at the same time only when the design spec and the contract both exist.

4. A delegate does not see this conversation. Brief it with: Task (one sentence), Files (paths it needs, the spec, design and contract paths), Return format, Done criteria (checkable by a command or a file read), Out of scope. Delegates report in English; the main thread translates for the user.
   - A `general-purpose` brief also says: do not commit, push or install packages even if asked, not even inside a longer command; do not touch `.env*` or credentials, exclude them from every search (`grep -rn --exclude='.env*'`), never print them with cat, head or an unexcluded recursive search, and if output shows them anyway, do not repeat it and say so; return Changed files, Commands run, Done criteria (met, not met or unverified with evidence) and Open issues. Set its `model` per call (Haiku for a fixed mechanical change, Sonnet when it needs judgment).
5. At most 3 delegates at once, and no two may edit the same file.
   - Launch independent delegates in one message so they run at the same time.
   - Run a long delegate in the background and keep working; its report arrives as a message, so do not poll or sleep. In a non-interactive run (`claude -p`) it cannot ask for permission, so its tools must already be allowed.
   - If two delegates cannot be kept off the same files, give each `isolation: worktree` (a temporary git worktree), or split by file instead. The worktree branches from the default branch, so the delegate does not see uncommitted work.
6. Give `reviewer` the criteria and the changed file list only, never the author's reasoning or a verdict to confirm. For a code change, add the `developing` skill's `references/review-checklist.md` to the criteria; for markup, the `publishing` rules.
7. A delegate's report is a claim. Check the evidence it cites before relaying it as done.
   - A delegate cannot ask the user: it puts open questions and the reason it stopped at the top of its report. Relay the question to the user, or answer it from a file in the repo, then resume the same delegate with SendMessage. Never invent the missing input and put it in a new brief: that turns a guess into an instruction. If you cannot get it, report the stop and what is missing.
   - A report from a delegate that used all its turns (maxTurns) is partial: do not relay it as done; split the part smaller or resume it.
8. Model lanes:
   - Opus, the main thread at medium effort: plans, decides, relays questions and does the inline work.
   - Haiku executes read-only searches: `explorer`.
   - Sonnet executes delegated parts that need judgment: `designer`, `publisher`, `developer`.
   - Opus verifies: `reviewer` (a false pass costs more than the model saving). Fable only when the user picks it for one hard task (it draws from a capped share of the same weekly limit).
9. When a delegated part fails:
   - Verification fails: send the reviewer's findings to the same executor once (SendMessage), then review again.
   - The same criterion fails twice, or the resent part fails review again: take the part over inline with the findings, once, and have a separate reviewer check it. If that fails too, stop and report the cause to the user.
10. Learning: `designer`, `publisher` and `developer` keep lessons in their own memory (`~/.claude/agent-memory/<name>/`). A lesson that should bind every project becomes a rule in its skill through a PR, never by editing memory into a rule silently.
