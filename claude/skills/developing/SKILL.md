---
name: developing
description: 개발. House rules for developer work — REST API, backend, database, dashboard data, CORS, payments and website features — covering the security baseline, payment idempotency with UML first, and strict OOP/SOLID review. Use whenever server, API, data or payment code is written or reviewed.
when_to_use: Requests such as 개발해줘, API 만들어줘, 백엔드 구현, 엔드포인트 추가, DB 스키마, 대시보드 데이터, 결제 기능, 결제 연동, 웹훅, 보안 점검, CORS 설정, SQL 인젝션, 로그인 구현, 코드리뷰, SOLID, 리팩터링, build an API, add an endpoint, payment integration, webhook, security check, CORS, code review, SOLID.
---

House rules for developer work. Precedence: the project's own conventions, then these rules, then generic advice. The global rules (`~/.claude/CLAUDE.md`: secrets, destructive actions, a test with each fix, Ponytail) and the `developer` agent's rules still apply; they are not repeated here. Each rule has Do, Don't and a Check; examples are in `references/`.

## 1. Security baseline
- Do: CORS from a fixed origin allowlist, preflight (`OPTIONS`) answered; SQL only via parameters or the ORM; validate input at the trust boundary (type, length, range); encode output (no raw HTML from user data); CSRF tokens when auth is a cookie session; passwords hashed with argon2 or bcrypt; secrets only in `.env`; rate limits on login and payment endpoints; production errors without stack traces.
- Don't: `Access-Control-Allow-Origin: *` with credentials, or echoing any `Origin` back; SQL built with string concatenation or f-strings; logging tokens, passwords or personal data.
- Check: the curl probes in `references/security.md` — allowed vs blocked Origin preflight, a SQL-injection probe that returns 4xx or an empty result, and 401 for a missing or invalid token.

## 2. Payments: idempotency, UML first
- Do: before code, write `docs/arch-<topic>.md` with a Mermaid `classDiagram` and a `stateDiagram-v2` for payment status; the code follows it, and a change to the design changes the diagram first. Every payment-creating request carries an `Idempotency-Key`, stored with a unique constraint per caller (`UNIQUE (user_id, key)`); a retry with the same key and body returns the first result, a different body is rejected. The gateway webhook verifies its signature and is idempotent by event id. Amounts are integer minor units (원, cents) or a decimal type. Status changes go through one transition table; anything else is rejected.
- Don't: float amounts; charge before the key is stored; update status with a bare `UPDATE ... SET status=?` outside the state machine; trust a webhook body without its signature.
- Check: a test sends the same key twice and gets one charge and the same response; a test delivers the same webhook twice and gets one state change. Examples: `references/payments.md`.

## 3. OOP and SOLID, strict review
- Do: keep domain logic pure; I/O, DB, network and the clock live at the edges and are passed in. Name every side effect of a change. Review with `references/review-checklist.md`: one check per SOLID principle, what else the change touches (callers, shared state, migrations), backward compatibility, transaction boundaries.
- Don't: add an interface, layer or factory with one implementation and no test that needs the seam. SOLID never overrides Ponytail: an abstraction needs a second real implementation or a test seam.
- Check: every finding that is not cosmetic is blocking. When briefing `reviewer`, include the checklist as criteria.

## 4. Engineering hygiene
- Do: write the API contract first in `docs/api-<topic>.md`. Migrations are reversible (up and down) and run in a transaction. Structured logs (JSON or key=value) without personal data. Tests per layer: unit for the domain, integration against a local or test DB.
- Don't: run a destructive migration (drop, truncate, data delete) without the user's confirmation; a delegated agent writes the file and reports it instead. Never point tests at a production DB.
- Check: the contract file exists before the endpoint; each migration has a down step; `grep` the log calls for email, phone and token fields.

## Adding a rule
Append `## 5. <name>` with Do, Don't and Check lines, and if it needs examples, add `references/<slug>.md` and name it in the rule.
