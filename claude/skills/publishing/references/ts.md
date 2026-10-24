# Rule 2 examples: TS interaction classes

Follow the project's existing component first: its folder, file naming, export style and how components are started. The shape below is the default when there is nothing to copy.

## A component class

```ts
// ts/components/Accordion.ts
type AccordionOptions = { single?: boolean };

export class Accordion {
  private triggers: HTMLButtonElement[];

  constructor(root: HTMLElement, private options: AccordionOptions = {}) {
    this.triggers = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-accordion-trigger]"));
  }

  init(): void {
    this.triggers.forEach((t) => t.addEventListener("click", this.onClick));
  }

  destroy(): void {
    this.triggers.forEach((t) => t.removeEventListener("click", this.onClick));
  }

  private onClick = (e: MouseEvent): void => {
    const trigger = e.currentTarget as HTMLButtonElement;
    const open = trigger.getAttribute("aria-expanded") !== "true";
    if (open && this.options.single) this.triggers.forEach((t) => t !== trigger && this.toggle(t, false));
    this.toggle(trigger, open);
  };

  private toggle(trigger: HTMLButtonElement, open: boolean): void {
    trigger.setAttribute("aria-expanded", String(open));
    document.getElementById(trigger.getAttribute("aria-controls")!)!.hidden = !open;
  }
}
```

Start it the way the project starts its other components, for example:

```ts
document.querySelectorAll<HTMLElement>("[data-accordion]").forEach((el) => new Accordion(el).init());
```

## Extending

Do: extend or compose an existing base only when a second real use exists now. If `Tabs` and the new `Accordion` both need the same keyboard handling today, move it into one shared helper they both use.

Don't:

```ts
// a base class with one subclass "for later"
abstract class BaseComponent<T> { /* lifecycle hooks nobody calls */ }
// options nobody asked for
new Accordion(el, { animation: "slide", duration: 300, onOpen, onClose, a11y: true });
// a free-floating function file when the project uses classes
export function initAccordion() { ... }
// API calls or app state inside a UI class: that belongs to developer
fetch("/api/faq").then(...);
```

In a React, Vue or Svelte project, write a framework component in the project's style; this rule does not apply.
