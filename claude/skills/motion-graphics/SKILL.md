---
name: motion-graphics
description: 모션그래픽. Make motion graphics as code (HTML canvas, SVG, Remotion or HyperFrames) and render them to MP4 with a deterministic, frame-by-frame pipeline. Holds community findings collected daily from X.
when_to_use: Requests such as 모션그래픽 만들어줘, 쇼릴/런칭 영상/로고 리빌 만들어줘, 이징이나 타이밍 정해줘, render an animation to mp4, what are people on X doing with AI motion graphics.
---

Motion is code; a renderer turns it into video. Follow the render contract, then the loop.

## Render contract
- Every frame is a pure function of time: one `seek(t)` entry point. No `Math.random`, `Date`, `performance.now` or animation-frame state. Seeded noise only.
- Check it: render the same frame twice and compare hashes before the full render.
- Fix canvas size, fps and duration up front (default 1920x1080, 30 fps). Load fonts before frame 0.
- Name every motion with three values: name, duration in ms, easing (for example `rise-in, 600ms, ease-out-expo`). Never "make it snappier".
- Motion blur by averaging sub-frame samples; 4 samples strobe on fast moves, 12 do not. Quantize values that must not blur (counters) to the frame start.

## Loop
1. Brief: purpose, length, aspect, exclusions, and a beat sheet in seconds.
2. Lock tokens: palette, type, safe area, easing set.
3. Render a 3-second test, then build in passes: layout, type, motion, colour.
4. Extract stills at every scene boundary from the MP4 itself and inspect them. Revise by frame range.
5. Final render: frames from a headless browser (Playwright) piped as PNG into `ffmpeg -c:v libx264 -pix_fmt yuv420p`.
6. A separate reviewer checks the MP4 against the brief: container, scene timing, no black gaps, text at rest, no single-frame pops.

## References (read when needed)
- [references/insights.md](references/insights.md): curated patterns, tools and critiques with evidence counts. Read before planning a piece.
- [references/x-log.md](references/x-log.md): raw log of X posts, one row per URL. Read to find examples or check whether a claim has a source.

Both files are updated by the daily routine in `claude/routines/x-motion-digest.md`. Entries come from search snippets, not from the posts themselves, and are unverified unless marked otherwise.
