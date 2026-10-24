# Typography for distinctive interfaces

Use when choosing fonts, building a type scale, or when output starts to look like generic default-font UI.

## Rule zero

If the project already has brand fonts or type tokens, use them. Apply the ideas below only to how they are combined: size contrast, weight, tracking, rhythm, measure.

## Fonts to avoid as defaults

- Inter, Roboto, Arial, Helvetica, Open Sans, Lato, and `system-ui` / `-apple-system` stacks. They are neutral by design, so every page set in them looks the same. They are fine when the brief demands a native-feeling tool UI; they are not a design decision.
- Overused "safe alternatives": Space Grotesk, Poppins, DM Sans, Montserrat. They became the new default and carry the same sameness.
- Rule of thumb: if you reach for a font without a reason tied to the content's mood, you are converging on the default. Pick a font because of what the page is about, then justify it in one sentence.

## Pairing strategy

Pair one characterful display face with one refined, readable body face. Create contrast on at least two axes: weight, width, serif vs sans, or size.

| Aesthetic | Display | Body |
|---|---|---|
| Editorial / literary | Fraunces, Playfair Display, Newsreader | Source Serif 4, Literata, or a quiet sans like Instrument Sans |
| Technical / geometric | JetBrains Mono, IBM Plex Mono | IBM Plex Sans, Geist |
| Humanist / warm | Recoleta-style soft serifs, Gambetta, Young Serif | Figtree, Nunito Sans, Source Sans 3 |
| Brutalist / poster | Archivo (wide, black weight), Anton, Bricolage Grotesque | Archivo Narrow, IBM Plex Sans |

Avoid pairing two similar faces (two geometric sans). Either commit to contrast or use one family with a wide weight range.

### Korean content

- Latin-only fonts have no Hangul. The browser silently falls back to a system face, breaking the design. If the content is Korean, choose a Hangul-capable font and put it in the stack explicitly.
- Sans: Pretendard (best default for UI), Noto Sans KR, IBM Plex Sans KR.
- Serif / editorial: Noto Serif KR, Nanum Myeongjo, Gowun Batang (softer, literary), Gowun Dodum.
- Mixed pages: list the Latin display font first, then the Hangul font, so each script gets a deliberate face: `font-family: "Fraunces", "Noto Serif KR", serif;`
- Hangul needs slightly more line-height (1.6-1.8 body) and no negative tracking on body text. Use `word-break: keep-all` so words do not split mid-syllable-group.

## Loading

Google Fonts, with preconnect and swap:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;700&family=Source+Sans+3:wght@400;600&display=swap" rel="stylesheet">
```

Self-hosted (faster, private, no third-party request):

```css
@font-face {
  font-family: "Fraunces";
  src: url("/fonts/Fraunces-var.woff2") format("woff2");
  font-weight: 100 900;
  font-display: swap;
}
```

- Limit to 2 families and 2-3 weights each. Prefer variable fonts: one file, many weights.
- Request only the weights and axes you use. Preload the one font used above the fold.
- Korean fonts are large; use subset or `unicode-range` builds (Pretendard has dynamic-subset CSS).

## Scale and rhythm

- Fluid sizes with `clamp(min, preferred, max)`; avoid a stack of media queries for type.
- Size contrast follows the domain: about 2.5-4x the body in trust-heavy domains, 4-8x where the domain is expressive. Timid scales (1.1 ratio) read as templates.
- Tight tracking on large display (`-0.02em` to `-0.04em`), neutral on body, wide (`0.08em`+) on small uppercase labels.
- Line-height shrinks as size grows: display 1.0-1.1, headings 1.2, body 1.5-1.7.
- Measure: keep paragraphs at `max-width: 60-75ch`.
- Tables and prices: `font-variant-numeric: tabular-nums` so columns align; `oldstyle-nums` suits editorial body.

## Example

Illustrative only: it shows the structure, not fonts to reuse. Choose faces for each project's content.

```css
:root {
  --font-display: "Bricolage Grotesque", "Pretendard", sans-serif;
  --font-body: "IBM Plex Sans", "Pretendard", sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;

  --step-0: clamp(1rem, 0.95rem + 0.25vw, 1.125rem);
  --step-3: clamp(1.75rem, 1.2rem + 2.5vw, 3rem);
  --step-6: clamp(3rem, 1.5rem + 8vw, 8rem);
}

body { font: 400 var(--step-0)/1.6 var(--font-body); word-break: keep-all; overflow-wrap: anywhere; }
h1 {
  font: 800 var(--step-6)/1 var(--font-display);
  letter-spacing: -0.035em;
  text-wrap: balance;
}
h2 { font: 600 var(--step-3)/1.15 var(--font-display); letter-spacing: -0.02em; }
p { max-width: 68ch; }
td.num { font-variant-numeric: tabular-nums; font-family: var(--font-mono); }
.eyebrow { font-size: 0.75rem; letter-spacing: 0.12em; text-transform: uppercase; }
```

Tailwind: define the same values in `theme.extend.fontFamily` / `fontSize` rather than using the default `font-sans`.
