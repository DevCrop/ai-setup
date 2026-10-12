---
name: spec-writing
description: 기획. Interview the user, then write a self-contained spec to docs/spec-<topic>.md with goal, scope, screens and checkable acceptance criteria. Use before design or implementation of a new feature.
when_to_use: Requests such as 기획서 써줘, 스펙 정리해줘, 요구사항부터 정리하자, 새 기능 만들기 전에 기획, write a spec for this feature.
---

Run this in the main conversation (the user must answer questions; subagents cannot ask). Use plan mode while interviewing.

1. Restate the request in two lines. Ask only what the code and the request do not answer: target user, goal, what is out of scope, the hard constraints. Two to four questions at a time, with a recommended default for each.
2. Write the spec to `docs/spec-<topic>.md` (or the path the user names; create `docs/` if it is missing). Sections:
   - Goal and Users.
   - In scope and Out of scope.
   - Screens or flows, one line each, and the data each one needs.
   - API needs (what the client must get from the server), if any.
   - Acceptance criteria. Each one must be checkable by a command, a request or a file read. Rewrite any that is not.
   - Open questions.
3. Change request on an existing spec (the client asks for a change after delivery): update that spec file in place instead of writing a new one. Add a "Changes" entry with the date, what changed, and which screens, API and acceptance criteria it touches, and mark the old criteria it replaces. Do not widen the request.
4. Mark every assumption "Assumption:". Do not invent requirements the user did not give.
5. The file must stand alone: designer, publisher, frontend, backend and qa read it without this conversation. Name the files and interfaces involved.
