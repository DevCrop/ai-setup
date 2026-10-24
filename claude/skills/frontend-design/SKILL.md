---
name: frontend-design
description: 프론트엔드 디자인. Gives distinctive, production-grade visual direction (type, color, motion, background, layout) for any web UI being built or restyled — pages, landing pages, dashboards, components, HTML artifacts — so it does not look like generic AI output. Use it whenever frontend code with a visible look is written.
when_to_use: Requests such as 랜딩 페이지 만들어줘, 화면 디자인 예쁘게, UI 리디자인, 대시보드 만들어줘, 컴포넌트 스타일 다듬어줘, 웹페이지 만들어줘, make this look better, build a landing page, restyle this dashboard, design a component.
---

Left alone, you drift to the statistically safe center of web design. Make deliberate choices that fit the audience instead, and write them as real CSS or framework code.

## Precedence

1. The brief, then the project's own design system (tokens, brand fonts, components, `docs/design-*.md` from the `design-spec` skill). Work inside them; never override brand tokens.
2. Accessibility and semantics from `ui-baseline` beat aesthetics.
3. This skill fills the gaps.

## Before coding

Ground the design in the subject and audience, and let them set the volume:

- Trust-heavy domains (medical, finance, legal, public services, B2B tools): calm and restrained. Distinction comes from type quality, spacing and one precise accent, not from loud display faces, giant shapes or heavy motion.
- Expressive domains (food, fashion, events, portfolios, launches): bolder moves fit.

Name one direction in a line (refined minimal, warm editorial, quiet clinical, brutalist, retro-futurist, soft organic, playful). Sketch a short token plan (palette, type roles, layout), check it against the generic default you would have produced, then build. Put the boldest move in one spot; keep the rest calm. In trust-heavy domains even that move stays modest: no oversized shapes or display-size headlines.

## Typography

Pick a characterful display face with a refined body face, chosen for the content's mood. Use clear jumps in size and weight rather than timid steps; go extreme only where the domain is expressive. Details: `references/typography.md`.

## Color & theme

One cohesive theme in CSS custom properties: a dominant color with a sharp accent, borrowed from a real source (an IDE theme, a print era, a material). Vary light and dark between projects. Details: `references/color-theme.md`.

## Motion

One orchestrated page-load reveal with staggered delays beats scattered micro-effects. CSS first; a motion library only when the project already uses one. Details: `references/motion.md`.

## Backgrounds & depth

Build atmosphere with layered gradients, grain, patterns or surfaces that suit the direction, not a flat fill. Details: `references/backgrounds-depth.md`.

Load only the reference you need.

## Avoid

- Inter, Roboto, Arial, Open Sans, Lato or bare system fonts as the design choice.
- Purple gradient on white; timid, evenly spread palettes.
- Flat single-colour backgrounds; scattered hover effects on every card.
- Cookie-cutter layouts and template chrome: hero plus three identical rounded cards, tracked-caps eyebrows on every section, automatic 01/02/03 numbering.

Do not converge on a new default either (Space Grotesk every time, the same cream-and-serif look). Vary fonts, themes and layouts between generations. Before calling it done, view it at 320px (the `ui-baseline` minimum) and desktop widths: nothing may scroll horizontally (decorative shapes, rotated or bleeding sections included; clip them with `overflow-x: clip` on their container), and fix what looks generic or too loud for the domain. With no browser or screenshot tool, report that check as not done.
