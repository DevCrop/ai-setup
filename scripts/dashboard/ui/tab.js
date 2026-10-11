// A screen. To add one: subclass Tab, set id, add a <section id="v-<id>"> and a sidebar button in index.html, and list the class in tabs/index.js.
export class Tab {
  static id = "";
  static icon = "dot";
  constructor(app) { this.app = app; }
  get id() { return this.constructor.id; }
  get view() { return document.getElementById("v-" + this.id); }
  get needsInventory() { return true; }   // drawn from /api/inventory (files + newest session log)
  get redrawOnState() { return false; }   // redraw when fresh live state arrives
  draw(view) { throw new Error(this.constructor.name + ".draw() is not implemented"); }
  onState(state) {}                        // called with every live state (even while hidden)
}
