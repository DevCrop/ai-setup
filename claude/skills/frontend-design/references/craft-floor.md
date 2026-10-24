# Craft floor and polish pass

Read before any UI edit. The floor is style-free: a brutalist page and a quiet clinic page both meet it. The brief, the project's design system and `ui-baseline` win over anything here; where they define a value, use it instead of the defaults below.

Contents: Floor, Copy, Polish pass.

The idea of a style-free quality floor plus a finishing pass comes from impeccable (github.com/pbakaus/impeccable, Apache-2.0); the wording here is original.

## Floor

Spacing and grid
- One spacing scale on a 4px or 8px base (for example 4, 8, 12, 16, 24, 32, 48, 64, 96, 128). Every margin, padding and gap comes from it; no 13px or 37px.
- One grid: a max content width (about 1120-1280px), fixed side gutters (16-24px mobile, 32-64px desktop) and columns that edges line up to. Section spacing is larger than spacing inside a section, so grouping reads at a glance.
- Generous whitespace is a feature. When a section feels crowded, remove an element before shrinking the gaps.

Type
- At most two families (a third only for code or tabular figures). Define 5-7 size steps as tokens and use nothing in between.
- Body 16-18px, line-height 1.5-1.7 (Korean 1.6-1.8), line length 60-75ch (Korean about 35-45 characters per line).
- Headings: tighter line-height (display 1.0-1.1, other headings 1.1-1.3) and weight or size contrast with the body; never more than three heading levels on one screen.
- Korean: `word-break: keep-all` with `overflow-wrap: anywhere`; no negative tracking on Korean body text.

Hierarchy
- One primary action per view, visibly stronger than the rest; secondary actions look secondary.
- Each section has one job and one focal point. If everything is emphasised, nothing is.
- Tool screens (dashboards, admin, editors): density and scanability first. Show as many rows as stay readable, align numbers with tabular figures, and keep IDs and secondary text at readable contrast.
- Details from the domain beat decoration: a live open/closed status, a struck-through cancelled order, a seal or stamp a law firm really uses.

Components and surfaces
- One radius scale (for example 0, 4, 8, or fully round for pills) and one shadow or border system per component family; a low-contrast 1px border with a small shadow is fine, a hard border with a soft shadow is not.
- Icons from one set, one stroke width, sized to the text they sit beside.
- Images keep a fixed aspect ratio (`aspect-ratio`, `object-fit: cover`). Without real assets, use a neutral placeholder labelled with what belongs there ("photo: clinic waiting room") instead of filling the gap with decoration.

States and edges
- Hover, focus-visible, active, disabled, loading, empty and error for every interactive element that can have them.
- Long text, long numbers and missing data do not break the layout.

## Copy

Copy is part of the design, and generic copy reads as AI faster than any color.
- Say concrete things about this business: opening hours, what makes it different, a real next step. No slogans that would fit any company.
- Avoid comma-split two-line slogans, rhetorical questions as headlines, and highlighting one word of the headline.
- Buttons name the action ("진료 예약", "Book a table"), not "Learn more".

## Polish pass

Run it after the page works, before calling it done.
1. System: list the spacing, type, color and radius values actually used. Replace anything off-scale with the nearest token.
2. Look: view the rendered page at 320px, at desktop width (about 1440px) and at any widths the design spec lists. Nothing scrolls horizontally; decorative or bleeding elements are clipped on their container with `overflow-x: clip`.
3. Triage: note what looks generic, crowded, misaligned or too loud for the domain. Fix the biggest problem first; one round of fixes, then look again.
4. Details: alignment to the grid, consistent gaps between repeated items, optical balance of icons and text, no orphaned single words in headings, focus styles visible.
5. Tells: check the page against the Avoid list in SKILL.md and remove any that slipped in, unless the brief asked for it.

With no browser or screenshot tool, do steps 1, 4 and 5 from the code and report step 2 as not done.
