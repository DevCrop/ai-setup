---
name: ui-baseline
description: Shared UI baseline for the publisher agent (semantic HTML, responsive, accessibility, token rules). Preloaded by those agents.
user-invocable: false
---

Baseline for every UI change, whoever makes it. The project's own tokens, naming and lint config win over anything here.

- Semantic elements first (`button`, `nav`, `main`, `label` bound to inputs); no `div` with click handlers.
- Reuse existing tokens and classes; no new hardcoded color, size or breakpoint when a token exists.
- Mobile first. Check the widths the design spec lists; nothing scrolls horizontally at 320px.
- Every interactive element is keyboard reachable with a visible focus style, and has an accessible name.
- Text contrast at least 4.5:1 (3:1 for large text); touch targets at least 44px.
- Images have `alt` (empty when decorative). Do not convey meaning by color alone.
- Cover every state the design spec lists; for a state it omits, pick the simplest option and record it as an assumption.
