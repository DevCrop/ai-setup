---
name: frontend-design
description: 프론트엔드 디자인. Gives distinctive, production-grade visual direction (type, color, motion, background, layout) for any web UI being built or restyled — pages, landing pages, dashboards, components, HTML artifacts — so it does not look like generic AI output. Use it whenever frontend code with a visible look is written.
when_to_use: Requests such as 랜딩 페이지 만들어줘, 화면 디자인 예쁘게, UI 리디자인, 대시보드 만들어줘, 컴포넌트 스타일 다듬어줘, 웹페이지 만들어줘, make this look better, build a landing page, restyle this dashboard, design a component.
---

Left alone, you drift to the statistically safe center of web design. Make deliberate choices that fit the audience, hold every page to a craft floor whatever its style, and write the result as real CSS or framework code.

## Precedence

1. The brief, then the project's own design system (tokens, brand fonts, components, `docs/design-*.md` from the `design-spec` skill). Work inside them; never override brand tokens.
2. Accessibility and semantics from `ui-baseline` beat aesthetics.
3. This skill fills the gaps.

## Before coding

Ground the design in the subject and audience, and let them set the volume:

- Trust-heavy domains (medical, finance, legal, public services, B2B tools): calm and restrained. Distinction comes from type quality, spacing and one precise accent, not from loud display faces, giant shapes or heavy motion.
- Expressive domains (food, fashion, events, portfolios, launches): bolder moves fit.

Name one direction in a line (refined minimal, warm editorial, quiet clinical, brutalist, retro-futurist, soft organic, playful). Sketch a short token plan (palette, type roles, spacing steps, grid), check it against the generic default you would have produced, then build. Put the boldest move in one spot; keep the rest calm. In trust-heavy domains even that move stays modest: no oversized shapes or display-size headlines.

## Craft floor

Style varies; the floor does not. One spacing scale, one grid, at most two families on a defined type scale, readable line length, one primary action per view, one radius/shadow/border system, real content and image slots instead of decoration, and every interactive state. Details and the finishing pass: `references/craft-floor.md` (read it before any UI edit; it is the one reference that is always loaded).

## Type, color, motion, surfaces

- Type: a characterful display face with a refined body face; clear size jumps, extreme only where the domain is expressive. `references/typography.md`
- Color: one cohesive theme in CSS custom properties, a dominant color with one sharp accent, borrowed from a real source. `references/color-theme.md`
- Motion: one orchestrated entrance beats scattered effects; CSS first. `references/motion.md`
- Surfaces: tonal sections, subtle gradients or real imagery give depth; grain and glows are seasoning, not a default. `references/backgrounds-depth.md`

Load only the reference you need.

## Avoid

- Inter, Roboto, Arial, Open Sans, Lato or bare system fonts as the design choice; purple gradient on white; timid, evenly spread palettes.
- Template chrome: hero plus three identical rounded cards, tracked-caps eyebrows on every section, automatic 01/02/03 numbering, hover effects on every card.
- Second-wave tells: a small label (eyebrow) above the headline, one word of the headline in the accent color, italic or underlined, comma-split two-line slogans, "three promises" sections, glowing suns, orbs and abstract CSS illustrations, offset outline frames, grain on everything, the same cream-and-serif look, Space Grotesk every time.
- The default hero: headline left, rounded info card right. Break it when the content allows.

Vary fonts, themes and layouts between generations. Finish with the polish pass in `references/craft-floor.md`, including the 320px (the `ui-baseline` minimum) and desktop check; with no browser or screenshot tool, report that check as not done.
