# Rule 1 examples: SCSS structure

Typical tree. Match the folder names the project already uses (`abstracts` or `abstract`, `layouts` or `layout`).

```
scss/
  abstracts/  _variables.scss _mixins.scss _functions.scss _index.scss
  base/       _reset.scss _typography.scss _index.scss
  layouts/    _header.scss _footer.scss _grid.scss _index.scss
  components/ _button.scss _tabs.scss _index.scss
  main.scss
```

## Adding an accordion

Do: one partial in `components/`, registered next to its neighbours.

```scss
// components/_accordion.scss
@use "../abstracts" as *;

.accordion { border-top: 1px solid $color-line; }
.accordion__trigger { width: 100%; padding: $space-3; text-align: left; }
.accordion__panel[hidden] { display: none; }
```

```scss
// components/_index.scss (the project forwards partials here)
@forward "button";
@forward "tabs";
@forward "accordion";
```

If the project registers partials in `main.scss` with `@use "components/tabs";`, add `@use "components/accordion";` there instead. If it uses `@import`, add an `@import` line; do not migrate it.

Don't:

```scss
// scss/accordion.scss       -- outside the structure
// css/accordion.css         -- parallel plain CSS
// abstracts/_accordion.scss -- abstracts emit no CSS
.accordion { border-top: 1px solid #ddd; } // hardcoded value where a token exists
```

## Where things go

| Style | Folder |
|---|---|
| a new color, spacing value, breakpoint mixin | `abstracts/` |
| `body`, `a`, heading defaults, reset | `base/` |
| site header, footer, page grid, section wrapper | `layouts/` |
| tabs, accordion, modal, card, button | `components/` |
