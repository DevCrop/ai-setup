import { Tab } from "../tab.js";
import { el } from "../dom.js";
import { Panel, mk } from "../components.js";

export class SetupTab extends Tab {
  static id = "setup";
  static icon = "folder";
  get needsInventory() { return false; }
  get redrawOnState() { return true; }
  draw(v) {
    const rows = el("div", "rows"), hint = el("span", "hint");
    v.replaceChildren(mk(Panel, "프로젝트 셋업 점검", "", hint, rows));
    this.app.projects.fill(rows, hint);
  }
}
