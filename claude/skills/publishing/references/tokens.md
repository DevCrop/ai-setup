# Rules 4, 5, 6 and 8 examples: fluid(), color and type variables, balance

Read the project's `abstracts/` first: the real name, signature and units of `fluid()` and the names of its color and type variables win over everything below. The `fluid($min, $max)` function shown here is only an illustration. If the project's `fluid` is a mixin (`@include fluid(font-size, 14px, 16px)`), use it that way, and the type "variables" of rule 6 become whatever the project pairs with it (type mixins or a map).

## The abstracts side

```scss
// abstracts/_mixins.scss (already in the project; do not write a second one)
@use "sass:math";
@function fluid($min, $max, $from: 360px, $to: 1440px) {
  $slope: math.div($max - $min, $to - $from);
  @return clamp(#{$min}, #{$min - $slope * $from} + #{$slope * 100}vw, #{$max});
}

// abstracts/_variables.scss
@use "mixins" as *;

$color-text: #222;
$color-line: #d9d9d9;
$color-accent: #0a5cff;

$font-size-body: fluid(14px, 16px);
$font-size-h2:   fluid(22px, 32px);
$line-height-body: 1.6;

$space-3: fluid(12px, 16px); // spacing variables are fluid too; use them, or fluid() inline for a one-off gap
```

A new color or type size is added here first, then used.

## A component partial

Do:

```scss
@use "../abstracts" as *;

.accordion__trigger {
  padding: fluid(12px, 20px) fluid(16px, 24px);
  font-size: $font-size-body;
  color: $color-text;
  border-bottom: 1px solid $color-line;
}
.accordion__trigger[aria-expanded="true"] { color: $color-accent; }
```

Don't:

```scss
.accordion__trigger {
  padding: 16px 24px;                         // fixed size: use fluid()
  font-size: clamp(14px, 1.2vw, 16px);        // hand-made clamp and one-off type size
  color: #222;                                // raw color: use $color-text
  border-bottom: 1px solid rgba(0, 0, 0, .1); // raw color: add a variable first
}
```

Fine as they are: `1px` borders, `0`, percentages, `transparent`, `currentColor`, `inherit`, and values the design keeps fixed at every width (an icon box, a hairline).

## Rule 8: title and body balance

Check from the inside out: a card's title against its body, then a section title against its lead, then the page title against everything. Each step up is larger through the type variables, and the steps hold at mobile and PC widths.

```scss
$font-size-body:  fluid(14px, 16px); // card body, section lead
$font-size-h3:    fluid(17px, 20px); // card title
$font-size-h2:    fluid(22px, 32px); // section title
$font-size-h1:    fluid(28px, 48px); // page title
```

Don't: a card title as large as the section title, a lead larger than its title on mobile, or a one-off size to make a single block "fit". Fix the variable or the copy's line break (rule 9) instead.
