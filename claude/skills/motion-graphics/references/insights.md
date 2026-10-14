# Motion-graphics insights

Curated from `x-log.md` and checked against our own renders. Each item: the claim, how many independent X sources back it (`n=`), and whether we reproduced it (`ours:`). The daily routine updates counts and adds items; it removes an item only when newer evidence contradicts it, and says so in the run report.

Last updated: 2026-10-14

## Pipeline
- Models write code, not video; a renderer makes the MP4. Common forms: single HTML file with canvas/SVG/CSS, Three.js, Remotion (React), HyperFrames (HTML-first CLI). n=6. ours: yes (canvas + Playwright + ffmpeg, 450 frames in about 40 s at 12 blur samples).
- Anthropic ships its own code-based path: Claude Motion (beta, Team/Enterprise) writes animations as code with editable text, numbers and timing, MP4 export. n=1 (official post, snippet only).
- Without a renderer you get a web page you have to screen-record. n=2.
- Remotion fits series and templates (official skill `npx skills add remotion-dev/skills`); plain HTML fits one-offs; Opus tends to pick zero-dependency HTML on its own. n=3.
- For editable After Effects output, MCP bridges exist (Higgsfield connector, open-source AE MCP servers). n=2. ours: not tried (needs AE).

## Prompting and harness
- "The prompt is 10%, the harness is 90%": put a render contract in CLAUDE.md before prompting. n=2.
- Deterministic frames: one `seek(t)`/`renderAt(t)`, no random, no clock; verify by rendering one frame twice. n=3. ours: yes, hashes identical.
- Showreel prompts that name a genre and ask to "go all out" are run at High or Max reasoning effort. n=3.
- Name a reference style instead of describing it. n=2.
- Give real UI kit, brand colours and fonts so the model does not invent product UI. n=2.
- Short test render (about 3 s) before the full piece. n=2.
- Revise by frame range, not vague notes. n=2.
- Fix a small easing set as tokens and reuse it everywhere: Lucian UX/UI uses `--ux-ease: cubic-bezier(.2,.8,.2,1)` (57 uses across 200 elements) and `--ux-spring: cubic-bezier(.34,1.45,.64,1)` for overshoot. n=1 (repo read directly, not a snippet).
- When porting or revising motion, keep the given motion values (durations, curves, delays) as they are, do not guess a new design, keep a reduced-motion path, and end with a report of what was checked and what was not. Source: the Lucian UX/UI copy-prompt template (`src/gallery/gallery.js`). n=1 (repo read directly).
- Specify motion as name + duration + easing (motion-reference.takayustudio.jp style vocabulary). n=1. ours: used in the easing-lane scene.

## Quality and critique
- "One prompt" posts usually hide the follow-ups; real runs report 3 revisions / 43 min or heavy steering. n=4.
- AI launch videos look alike; premium quality is rare. n=1 (practitioner).
- Frame-level review finds defects that look fine at a glance. ours: first render had 6 defects (word overlap, blur strobing, black opening, unfaded last frame, residue at a scene change, tiny opening subject).
- 4 motion-blur samples strobe on fast moves; 12 look smooth. ours: yes.

## Open questions
- Which renderer gives the best quality per minute: HyperFrames vs Remotion vs plain HTML.
- How the viral showreels were actually steered (prompts after the first one).
