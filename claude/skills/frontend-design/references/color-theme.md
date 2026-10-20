# Color and theme for cohesive interfaces

Use when defining a palette, theme tokens, dark mode, or interactive state colors, or when output drifts toward a generic look.

Contents: Rule zero, Commit to one theme, Borrow from a named aesthetic, Light and dark, Derive states, Contrast and meaning, Avoid, Token example.

## Rule zero

If the project already has color tokens or a brand palette, use them. Apply the ideas below only to how they are combined: dominance, accent placement, state derivation, contrast.

## Commit to one theme

Define everything as CSS custom properties and reference only tokens in components. A cohesive theme has one dominant color family plus one sharp accent, not an evenly spread palette of five equal hues.

- Roughly 60-70% of the surface is the dominant neutral/base, 20-30% supporting tones, under 10% accent.
- Accent is used rarely and on purpose: primary action, key number, focus ring. If everything is highlighted, nothing is.
- Tint your neutrals toward the dominant hue (a warm paper, a cool ink) instead of pure gray.

Core tokens: `--bg`, `--surface`, `--text`, `--muted`, `--accent`, `--accent-ink` (text color on top of accent), plus `--border`.

## Borrow from a named aesthetic

Pick a reference and translate it into tokens. This beats inventing colors from nothing.

- IDE themes (Solarized, Gruvbox, Nord, Dracula): dark base, one or two syntax-like accents.
- Print / editorial: warm off-white paper (`#f4efe6`), near-black ink, one red or ochre accent.
- Brutalism: flat white or acid yellow, hard black borders, one loud accent, no gradients.
- Retro computing: phosphor green or amber on near-black, monospace, scanline restraint.
- Nature palettes: moss, clay, bark, sky; low saturation with one saturated flower accent.

Write the source in a comment ("Gruvbox-inspired") so the choice stays traceable.

## Light and dark

Define both themes. Dark mode is not inverted light mode: lower the saturation of accents, raise their lightness, use a surface a few steps above `--bg` for elevation rather than shadows, and avoid pure `#000`.

Follow the OS by default and allow a manual override:

```css
:root { color-scheme: light dark; /* light tokens */ }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { /* dark tokens */ } }
:root[data-theme="dark"] { /* dark tokens */ }
```

Keep the dark tokens in one place (a shared selector or a single layer) so the media query and the override do not drift apart.

## Derive states, do not hand-pick them

Use `color-mix()` or `oklch()` so hover, active and disabled follow one rule everywhere:

- Hover: mix 12% of `--text` (or darken lightness by 0.05 in oklch).
- Active: mix 20%.
- Disabled: mix with `--bg` at 55% and drop the shadow.
- Focus: a 2px outline in `--accent`, offset 2px; never remove it without a replacement.

oklch is perceptually even, so equal lightness steps look equal across hues. Build a tint ramp by changing only L, keeping C and H.

## Contrast and meaning

- Body text needs 4.5:1 against its background; large text (18px+ or 14px bold) and UI borders/icons need 3:1. Check `--muted` and `--accent` on `--bg`, and `--accent-ink` on `--accent`.
- Never carry meaning by color alone: pair error/success with an icon, label or underline.
- Test in grayscale once; if hierarchy collapses, it relied on hue.

## Avoid

- Purple-to-blue gradient on a white page. It is the single most recognizable default.
- Pure `#000` text on pure `#fff` everywhere; soften both (e.g. ink `#16130f` on paper `#f6f2ea`).
- A rainbow of accents with equal weight, or a different color per section.
- Gray text so light it fails 4.5:1 for the sake of "elegance".

## Token example

Illustrative only: it shows the structure, not a palette to reuse. Pick your own source for each project.

```css
:root {
  color-scheme: light dark;
  /* Nord-inspired: cool snow base, polar-night ink, one frost-blue accent */
  --bg: #eceff4;
  --surface: #f7f8fb;
  --text: #2e3440;
  --muted: #4c566a;
  --border: color-mix(in oklch, var(--text) 18%, var(--bg));
  --accent: #4c6a92;
  --accent-ink: #ffffff;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #2e3440;
    --surface: #3b4252;
    --text: #eceff4;
    --muted: #c0c8d6;
    --accent: #88c0d0; /* lighter, less saturated */
    --accent-ink: #2e3440;
  }
}
:root[data-theme="dark"] { /* the same dark tokens as above */ }

.btn { background: var(--accent); color: var(--accent-ink); }
.btn:hover { background: color-mix(in oklch, var(--accent), var(--text) 12%); }
.btn:active { background: color-mix(in oklch, var(--accent), var(--text) 20%); }
.btn:disabled { background: color-mix(in oklch, var(--accent), var(--bg) 55%); }
.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
```

Tailwind: map these variables in `theme.extend.colors` (`bg: "var(--bg)"`) so utilities stay on the tokens.
