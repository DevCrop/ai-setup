# Motion design principles

Craft rules from practitioners, collected by `claude/routines/x-motion-digest.md` (principles track). Use them when planning a piece and when reviewing a render.

Each entry has these fields:
- the rule, with numbers when the source gives them
- each source URL followed by `(read: full)` when the page itself was read or `(read: snippet)` when only a search snippet was seen
- `n=`: the number of independent sources (different authors or studios)

Conflicting sources are listed side by side under the rule; no side is picked here.

Last updated: 2026-10-14

## Timing and spacing
- UI-scale moves: small local changes 150–250 ms, larger screen transitions 300–500 ms; below ~100 ms reads as a glitch, ~500 ms+ starts to drag. n=2. Sources: https://www.nngroup.com/articles/animation-duration/ (read: snippet), https://valhead.com/2016/05/05/how-fast-should-your-ui-animations-be/ (read: snippet)
- Exits are shorter than entrances (for example 300 ms in, 200–250 ms out). n=1. Source: https://www.nngroup.com/articles/animation-duration/ (read: snippet)
- Longer travel or larger frames need longer durations. n=1. Source: https://www.nngroup.com/articles/animation-duration/ (read: snippet)

## Easing and curves
- Never leave motion linear; the easing choice is the main difference between cheap-looking and crafted motion. n=2. Sources: https://madegooddesigns.com/motion-design-principles/ (read: snippet), https://www.graduateschool.edu/learn/premiere-pro/animation-principles-motion (read: snippet)

## Anticipation, overshoot, follow-through

## Hierarchy and focal point
- Reveal one focal element at a time; when everything animates at once nothing is seen. Animate the most important element first, secondary elements follow staggered. n=3. Sources: https://madegooddesigns.com/motion-design-principles/ (read: snippet), https://www.toptal.com/designers/ux/motion-design-principles (read: snippet), https://artofstyleframe.com/blog/visual-hierarchy-motion-graphics/ (read: snippet)
- Pick one element to win attention per beat, promoted by size, then contrast, then depth. n=1. Source: https://artofstyleframe.com/blog/visual-hierarchy-motion-graphics/ (read: snippet)

## Transitions between scenes
- Keep continuity with shared-element transitions instead of letting elements teleport or blink. n=1. Source: https://madegooddesigns.com/motion-design-principles/ (read: snippet)

## Kinetic typography

## Rhythm and sync to music or voice

## Restraint and what looks cheap or generic
- Every animation must do a job; reserve motion for key moments. Secondary motion stays small enough not to compete with the primary move. n=2. Sources: https://madegooddesigns.com/motion-design-principles/ (read: snippet), https://uxcel.com/blog/12-principles-of-animation-a-guide-to-motion-design-133 (read: snippet)
- Motion cannot rescue weak foundations: typography, composition, silhouette and colour contrast come first. n=1. Source: https://madegooddesigns.com/motion-design-principles/ (read: snippet)
