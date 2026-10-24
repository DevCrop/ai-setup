---
name: publishing
description: 퍼블리싱. House publishing rules for markup, SCSS and UI interaction code (tabs, accordion, modal, slider) in any web project. Use whenever HTML, SCSS/CSS or interaction TS is written or changed, inline or by the publisher and frontend agents.
when_to_use: Requests such as 퍼블리싱 해줘, 마크업 짜줘, SCSS 추가, 스타일 수정, 인터랙션 붙여줘, 탭 / 아코디언 / 모달 / 슬라이더 만들어줘, 컴포넌트 퍼블리싱, 화면 퍼블리싱, write the markup, add SCSS for this section, add an accordion, build a tab component, publish this page.
---

The house rules for publishing work. Precedence: the project's own conventions first, then these rules, then the generic skills `ui-baseline` (semantics, responsive, accessibility) and `frontend-design` (visual direction); do not restate those.

Before writing, read the SCSS entry file, `abstracts/` (its `fluid()`, color and type variables), one component partial, one TS component and one page of markup. Copy what they do. Each rule below is the user's line verbatim, then what it means; the reference file has the Do and Don't examples.

## Rules

1. **SCSS는 기존 파일링 구조 그대로 쓴다 ( ABSTRACT, BASE , LAYOUTS, COMPONENTS )**
   Each new style goes in the matching folder (abstracts emit no CSS; components get one partial each) and is registered in the existing entry or `_index.scss` the way its neighbours are; never migrate `@import`. A different existing structure wins; never a parallel tree. `references/scss.md`
2. **TS의 경우 객체지향적으로 확장한다 ( 기본 PONYTAIL 및 기본 지침 준수 )**
   One class per component or interaction: constructor(root, options), `init()`, `destroy()`, in the project's layout. Extend an existing base only for a second real use that exists now. Client state, API calls and business logic belong to `frontend`; React, Vue or Svelte follow the framework. `references/ts.md`
3. **HTML 형식은 깔끔하게 웹표준에 맞추어 작성한다 ( 인터렉션일 경우 이를 유연하게 수정 )**
   Valid, semantic HTML per `ui-baseline`, with landmarks and heading order; no inline `style=`, `onclick=` or `<script>`. Interactive parts may add wrappers, the project's JS hooks and ARIA states, and stay valid. `references/html.md`
4. **FLUID ( ) 사용 필수 => MIXIN에 있는거**
   Size type, spacing and layout dimensions with the project's own `fluid()` from `abstracts/`, in the form it is defined there (function or mixin). No fixed size or hand-made `clamp()` where it applies, and never a second `fluid()`; if the project has none, say so and ask. `references/tokens.md`
5. **색깔은 무조건 COLOR 변수로**
   Every color is a color variable from `abstracts/`; a new color is added there first. No hex, `rgb()`, `hsl()` or named colors in partials (`transparent`, `currentColor`, `inherit` are fine). `references/tokens.md`
6. **타이포도 무조건 변수로 FLUID 셋업 필**
   Font sizes are type variables in `abstracts/` set up with `fluid()` (line heights are variables too); partials use only those. `references/tokens.md`
7. **같은 것끼리 묶기**
   Wrap every group of like things: section = head (title + lead) + content; card list = the cards; card = media + text (title + body). Use the semantic element that fits each wrapper (`header`, `ul`/`li`, `article`), `div` only for a pure group. `references/html.md`
8. **제목과 본문 간의 균형 > 섹션 제목·본문 간의 균형 > 전체 페이지 제목·본문의 균형**
   Check balance inside each block first, then each section, then the whole page: title and body sizes step consistently through the type variables at every width. `references/tokens.md`
9. **br 및 모바일 br로 체크 ( 줄바꿈 매우 중요 )**
   Put the design's line breaks in with `<br>`, and mobile-only or PC-only breaks with the project's br classes; check every break at mobile and PC widths. `references/html.md`

## Adding a rule

Append the next number in the same shape: the user's line verbatim in bold, one short paragraph, and a pointer to the reference file that holds its examples (a new `references/<topic>.md` only if no existing one fits). Keep this body under 4000 bytes (`scripts/qa-apply.sh` checks it): details and examples go in references.
