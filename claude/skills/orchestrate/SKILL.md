---
name: orchestrate
description: Use when splitting work across subagents, before delegating to a role agent (publisher, frontend, backend, qa), explorer, worker or reviewer, or when deciding whether to delegate at all.
---

Default to one agent. Delegate only when the part does not block the main thread's next step, or its output is large and mostly irrelevant to it. Otherwise work inline.

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
4. A delegate does not see this conversation. Brief it with: Task (one sentence), Files (paths it needs, the spec and design paths, the API contract file), Return format, Done criteria (checkable by a command or a file read), Out of scope.
5. At most 3 delegates at once, and no two may edit the same file. Each owns one unit: a feature slice with its tests, one search question, or one verification.
6. Give `qa` and `reviewer` the criteria and the changed file list only, never the author's reasoning or a verdict to confirm.
7. A delegate's report is a claim. Check the evidence it cites before relaying it as done. If a delegate stops because an input is missing (an API contract, a design spec, a criterion), get that input from the user or from a file in the repo. Never invent it and put it in a new brief: that turns a guess into an instruction. If you cannot get it, report the stop and what is missing.
8. Model lanes: Haiku 5.5 for high-volume, well-defined work (explorer, publisher: static markup from a spec); Sonnet for code that must be correct (backend, frontend, worker) and for verifiers (qa, reviewer: a false pass costs more than the model saving); Opus only as advisor; Fable only when the user picks it for one hard task (it draws from a capped share of the same weekly limit).

## AO (Orchestrator.inc) instead of subagents
- Use it only for long parallel work with disjoint file scopes; otherwise use the subagents above.
- Put the done criteria and "never push" in `--agent-rules`; permissions come from `--permission`, and deny/ask rules still apply to workers.
- Trigger `ao review` before ending a worker session (an ended session cannot be reviewed); a person pushes and merges.
- Details and measurements: `docs/NEXT-MACHINE.md` section 13 in the claude-global repository (it is not copied to `~/.claude`).
