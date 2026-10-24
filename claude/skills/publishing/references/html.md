# Rules 3, 7 and 9 examples: standards-valid HTML, grouping, line breaks

## Page skeleton

```html
<header class="site-header">
  <nav aria-label="주 메뉴">
    <ul>
      <li><a href="/about">회사소개</a></li>
      <li><a href="/contact">문의하기</a></li>
    </ul>
  </nav>
</header>
<main>
  <h1>자주 묻는 질문</h1>
  <section aria-labelledby="faq-shipping">
    <h2 id="faq-shipping">배송</h2>
    ...
  </section>
</main>
<footer class="site-footer">...</footer>
```

Don't:

```html
<div class="header"><div class="menu"><div onclick="go('/about')">회사소개</div></div></div>
<div class="title" style="font-size:32px">자주 묻는 질문</div>  <!-- not a heading, inline style -->
<h1>...</h1><h3>...</h3>                                          <!-- skipped level -->
<img src="logo.png">                                              <!-- no alt -->
<a href="#" class="btn-open">열기</a>                              <!-- an action, use button -->
```

## Interactive markup: accordion

The markup flexes for the interaction (JS hooks, ARIA state, wrappers) and stays valid.

```html
<div class="accordion" data-accordion>
  <h3 class="accordion__heading">
    <button type="button" class="accordion__trigger" data-accordion-trigger
            aria-expanded="false" aria-controls="faq-1">배송은 얼마나 걸리나요?</button>
  </h3>
  <div class="accordion__panel" id="faq-1" hidden>
    <p>결제 후 2~3일 안에 도착합니다.</p>
  </div>
</div>
```

- The trigger is a `button` inside a heading, so it is reachable by keyboard and listed in the heading outline.
- `aria-expanded` and `hidden` start in the closed state; the TS class flips both.
- Use the project's hook convention: `data-*` attributes here, or `js-` classes if that is what the project uses. Do not reuse styling classes as JS hooks when the project separates them.

Similar ARIA for other interactions: tabs use `role="tablist"`, `role="tab"` with `aria-selected` and `aria-controls`, and `role="tabpanel"`; a modal uses `<dialog>` or `role="dialog"` with `aria-modal="true"` and `aria-labelledby`.

## Rule 7: wrap like with like

Every level gets its own wrapper: the section, its head (title + lead), its content, the card list, each card, and inside a card the media and the text (title + body). Class names follow the project's convention (BEM shown).

```html
<section class="feature" aria-labelledby="feature-title">
  <header class="feature__head">
    <h2 class="feature__title" id="feature-title">서비스 특징</h2>
    <p class="feature__lead">필요한 것만 담았습니다.</p>
  </header>
  <div class="feature__content">
    <ul class="card-list">
      <li class="card-list__item">
        <article class="card">
          <div class="card__media"><img src="a.jpg" alt="상담 장면"></div>
          <div class="card__text">
            <h3 class="card__title">1:1 상담</h3>
            <p class="card__body">전문가가 직접 답합니다.</p>
          </div>
        </article>
      </li>
    </ul>
  </div>
</section>
```

Don't: title, lead, images and card text as loose siblings of one `div`, or a card whose image and text sit unwrapped next to each other. The groups are what let spacing, alignment and the mobile stack be set per group in SCSS.

## Rule 9: line breaks

Put the design's line breaks in the markup, and check each one at mobile and PC widths.

```html
<h2 class="feature__title">필요한 것만<br> 담았습니다</h2>
<p class="feature__lead">처음 오신 분도 쉽게<br class="mo-only"> 시작할 수 있습니다.</p>
```

```scss
// base/ or the project's utility partial, if the classes are not there yet
.mo-only { @media (min-width: $bp-pc) { display: none; } }
.pc-only { @media (max-width: $bp-pc - 1) { display: none; } }
```

- Use the project's existing br classes (`mo-only`, `br-mo`, `m-br` ...); add them only if none exist.
- Keep a space after `<br>` so the words do not join when the break is hidden.
- Don't break lines with `&nbsp;` runs, extra spaces, fixed widths on text, or one `<p>` per line.
