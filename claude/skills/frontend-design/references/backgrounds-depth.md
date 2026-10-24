# Surfaces and depth

Use when a page or section needs surface levels, depth, imagery or texture.

## Rule zero

If the project already has a background or surface policy (color and shadow tokens, documented elevation levels, a design system), follow it and stop reading. The guidance below applies when nothing exists. Match whatever you build to the chosen direction and domain. Start with tonal sections (alternating surface levels), real imagery and subtle tonal gradients. Glows, grain and patterns are optional seasoning for expressive domains only; leave them out of trust-heavy domains (medical, finance, legal, public services, B2B tools).

## Layered gradients (expressive domains only)

When an expressive direction calls for atmosphere, stack a few `background-image` layers, topmost first, over a base color. Derive every color from the palette tokens so the background belongs to the page.

```css
.hero {
  background-color: var(--bg);
  background-image:
    radial-gradient(60% 50% at 15% 10%, color-mix(in oklab, var(--accent) 28%, transparent), transparent 70%),
    radial-gradient(50% 40% at 90% 30%, color-mix(in oklab, var(--text) 10%, transparent), transparent 70%),
    conic-gradient(from 210deg at 70% 110%, var(--surface), transparent 40%);
}
```

Keep gradient stops low in opacity and few in number. A mesh effect comes from two to four soft radial gradients at different positions, not from saturated rainbows.

## Grain (expressive domains only)

A faint noise layer removes the digital smoothness of gradients. Generate it with an inline SVG, so no image file is needed:

```css
.grain { position: relative; isolation: isolate; }
.grain::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  opacity: 0.06;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}
```

Use the pseudo-element so the grain never intercepts clicks, and keep opacity between 0.03 and 0.08. Tile a small SVG rather than filtering a full-viewport element.

## Geometric patterns (expressive domains only)

Pure CSS patterns suit technical, editorial, or brutalist directions:

```css
.pattern {
  background-image:
    repeating-linear-gradient(45deg, transparent 0 11px, color-mix(in oklab, var(--text) 8%, transparent) 11px 12px),
    linear-gradient(var(--bg), var(--bg));
}
```

Grids (two perpendicular `linear-gradient` lines with `background-size`), dots (`radial-gradient` with a small size), and stripes cover most needs. Fade a pattern out toward content with a `mask-image` gradient.

## Depth

- Define three or four surface levels (base, raised, overlay) with a slightly different background each, rather than one color everywhere.
- Use one consistent shadow scale as tokens (`--shadow-1` through `--shadow-3`). Raise blur and offset together, and keep opacity low. Tint shadows with the background hue instead of pure black.
- Choose borders or shadows per component family, not both on everything. Borders feel crisp and flat; shadows feel soft and physical. A low-contrast 1px border with a small shadow is fine for cards; never a hard border with a soft shadow.
- Light comes from one direction. All shadows should fall the same way.

## Backdrop blur, sparingly

Use `backdrop-filter` for one or two floating layers such as a sticky header or a modal, with an opaque-enough fallback:

```css
.bar { background: color-mix(in oklab, var(--bg) 92%, transparent); }
@supports (backdrop-filter: blur(1px)) {
  .bar { background: color-mix(in oklab, var(--bg) 70%, transparent); backdrop-filter: blur(12px) saturate(1.2); }
}
```

## Performance

- Avoid very large blurred elements (`filter: blur(120px)` blobs); they are expensive to paint and can flicker on mobile. Prefer radial gradients, which are cheap.
- Avoid `background-attachment: fixed` and full-screen fixed layers that repaint on scroll. A `position: fixed` pseudo-element with `will-change: transform` is safer if you need a persistent backdrop.
- Prefer CSS gradients and SVG over large raster images. If an image is needed, size and compress it for the viewport.
- Test on a mid-range phone or with CPU throttling and scroll the page.

## Readability

Text contrast must hold over the worst spot of the background, not the average. Check WCAG AA (4.5:1 body text). Over photos or busy patterns, add a scrim: a gradient overlay such as `linear-gradient(to top, rgb(0 0 0 / .65), transparent 60%)`, or give the text block its own solid or semi-opaque surface.

## Avoid

- The default purple-to-blue gradient hero on white or near-black.
- Glassmorphism on every card; it flattens hierarchy and hurts contrast.
- Grain or patterns strong enough to lower text contrast or create visual vibration.
- Orbs, blobs, glowing suns and abstract CSS illustrations.
- Mixing several shadow styles and several border radii without a scale.
