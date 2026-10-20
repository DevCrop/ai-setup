# Motion: a few deliberate moments instead of a static page or constant noise

Use when the page feels static, or when you are adding page-load, hover, scroll, or state-change animation.

Contents: Rule zero, Spend motion where it counts, Tokens, Animate only transform and opacity, Example, Scroll-triggered reveals, View Transitions, Reduced motion, Avoid, Quick check.

## Rule zero

If the project already has a motion system (duration/easing tokens, a motion library such as Motion for React, documented rules), follow it and stop reading. Everything below is the fallback when nothing exists. Use JS libraries only if the project already depends on them; CSS covers most needs.

## Spend motion where it counts

Pick three or four moments, not thirty:

1. One orchestrated page-load sequence: headline, supporting text, then media or call to action, each revealed in turn with `animation-delay`.
2. Hover and focus states on things that are actually interactive (lift, underline draw, color shift), not a hover effect on every card. Give `:focus-visible` the same care as `:hover`.
3. Scroll reveals for major sections only.
4. One transition for a real state or page change.

Everything else stays still. Restraint is what makes the moments read as intentional.

## Tokens

Define timing once and reuse it:

```css
:root {
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);   /* entrances */
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1); /* moves between states */
  --dur-fast: 180ms;   /* UI feedback: 150-250ms */
  --dur-enter: 600ms;  /* entrances: 400-800ms */
  --stagger: 80ms;
}
```

Use `ease-out` style curves for things arriving, shorter durations for things the user just triggered. Avoid `linear` except for progress indicators.

## Animate only transform and opacity

These run on the compositor and do not trigger layout. Do not animate `width`, `height`, `top`, `left`, `margin`, or `box-shadow` on large areas. Reserve space for revealing content so nothing shifts: the element should already occupy its final box and only translate or fade into view. Use `will-change` sparingly and only on elements that are about to animate.

## Example: staggered load with reduced-motion support

```css
.reveal {
  opacity: 0;
  transform: translateY(16px);
  animation: rise var(--dur-enter) var(--ease-out) forwards;
  animation-delay: calc(var(--i, 0) * var(--stagger));
}
@keyframes rise {
  to { opacity: 1; transform: none; }
}

.card {
  transition: transform var(--dur-fast) var(--ease-out),
              opacity var(--dur-fast) var(--ease-out);
}
.card:is(:hover, :focus-visible) { transform: translateY(-4px); }

@media (prefers-reduced-motion: reduce) {
  .reveal { animation: none; opacity: 1; transform: none; }
  .card { transition: none; }
  .card:is(:hover, :focus-visible) { transform: none; outline: 2px solid currentColor; }
}
```

Set the index in markup: `<h1 class="reveal" style="--i:0">`, `<p class="reveal" style="--i:1">`, and so on. Keep the total sequence under about a second.

## Scroll-triggered reveals

Preferred where supported, with a feature query so other browsers simply show content:

```css
@media (prefers-reduced-motion: no-preference) {
  @supports (animation-timeline: view()) {
    .on-scroll {
      animation: rise linear both;
      animation-timeline: view();
      animation-range: entry 0% cover 30%;
    }
  }
}
```

Fallback: an `IntersectionObserver` that adds an `.is-visible` class once, then calls `unobserve`. Make the hidden initial state apply only when JS is running (for example under a `.js` class on `<html>`), so content is never invisible if the script fails.

## View Transitions

For same-document state changes, wrap the DOM update:

```js
if (document.startViewTransition) document.startViewTransition(update);
else update();
```

For multi-page sites, `@view-transition { navigation: auto; }` opts in where supported. Name shared elements with `view-transition-name` and tune the default cross-fade with `::view-transition-old(root)` and `::view-transition-new(root)`. Unsupported browsers just navigate normally, so nothing is lost. Disable or shorten these under reduced motion too.

## Reduced motion

Honor `prefers-reduced-motion: reduce`. Remove parallax, large translations, auto-playing loops, and stagger. Keep state changes visible through color, outline, or an instant opacity change rather than removing the feedback. Reduced motion means less movement, not less information.

## Avoid

- Bounce or spring easing on everything.
- Infinite attention loops (pulsing buttons, endlessly floating icons). Loading spinners are the exception.
- Motion that delays reading or input: no waiting for an animation to finish before text is usable or a button responds.
- Animations that shift layout or cause scroll jumps.
- Scroll-jacking and parallax that fights the native scroll.
- Long entrance durations on repeat-use interfaces such as dashboards; keep them near 150-250ms.
- Different easings on every component. Use the tokens.

## Quick check

Reload the page with throttled CPU and with reduced motion enabled. Content should be readable and usable within about a second in both cases, and nothing should jump as it appears.
