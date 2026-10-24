---
name: design-spec
description: 디자인. Turn a spec into a design spec at docs/design-<topic>.md with tokens, per-screen layout, component states and accessibility values. Use after the spec and before markup is written.
when_to_use: Requests such as 디자인 스펙 문서 만들어줘, 디자인 시안이나 스타일 가이드 정리해줘, 디자인 토큰이랑 컴포넌트 상태 정의, write the design spec before markup.
---

Run this in the main conversation after the spec exists. Output is a document, not code.

1. Read the spec and the project's existing tokens and components first. Reuse them; propose a new token only when none fits.
2. Write `docs/design-<topic>.md` (or the path the user names; create `docs/` if it is missing). Sections:
   - Tokens used or added: color, type scale, spacing, radius, as concrete values (hex, px or rem).
   - Layout per screen at mobile and desktop widths, with the breakpoint values.
   - Components with their states: default, hover, focus, active, disabled, error, empty, loading.
   - Accessibility: text contrast ratios against WCAG AA (state the numbers), focus order, touch target size.
   - Assets needed.
3. Use numbers, not adjectives. List every value you invented that the project did not already define.
4. Do not write markup or logic here; publisher and developer implement from this file.
