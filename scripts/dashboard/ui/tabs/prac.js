// Practice checks against the official Claude Code docs: a summary ring, then one card per source with its doc link.
import { Tab } from "../tab.js";
import { el, ico } from "../dom.js";
import { Badge, DocLink, Panel, Note, Ring, Component, mk } from "../components.js";
import { docUrl, docLabel } from "../docs.js";

const ICON = { ok: "check", bad: "x", warn: "alert" }, LABEL = { ok: "충족", bad: "미충족" };

class PracticeSummary extends Component {
  constructor(items) { super(); this.items = items; }
  render() {
    const ok = this.items.filter((i) => i.level === "ok").length, bad = this.items.filter((i) => i.level === "bad").length, wrap = el("div", "psum"), stats = el("div", "stats");
    [["충족", ok, "ok"], ["미충족", bad, bad ? "bad" : ""]].forEach(([l, n, tone]) => { const s = el("div", "pstat " + tone); s.append(el("div", "n", String(n)), el("div", "l", l)); stats.append(s); });
    wrap.append(mk(Ring, ok, this.items.length), stats, mk(Note, "각 항목은 파일에서 바로 계산합니다. 근거는 공식 Claude Code 문서입니다."));
    return wrap;
  }
}

class PracticeItem extends Component {
  constructor(item) { super(); this.item = item; }
  render() {
    const i = this.item, r = el("div", "pitem"), mark = el("span", "i-" + i.level);
    mark.append(ico(ICON[i.level] || "dot", 14));
    r.append(mark, el("span", "what", i.what), mk(Badge, i.level, LABEL[i.level] || "확인"), el("div", "ev", i.evidence));
    return r;
  }
}

class PracticeGroup extends Component {
  constructor(src, items) { super(); this.src = src; this.items = items; }
  render() {
    const ok = this.items.filter((i) => i.level === "ok").length, g = el("section", "pgrp" + (ok < this.items.length ? " bad" : "")), h = el("header");
    h.append(el("h3", null, this.src), el("span", "cnt", ok + "/" + this.items.length), mk(DocLink, docUrl(this.src), docLabel(this.src)));
    g.append(h, ...this.items.map((i) => mk(PracticeItem, i)));
    return g;
  }
}

export class PracTab extends Tab {
  static id = "prac";
  static icon = "checkc";
  draw(v) {
    const items = this.app.inv.practices, groups = {};
    items.forEach((i) => { (groups[i.src] = groups[i.src] || []).push(i); });
    const grid = el("div", "pgrid"); grid.append(...Object.entries(groups).map(([src, list]) => mk(PracticeGroup, src, list)));
    v.replaceChildren(mk(Panel, "권장 기준 대비", items.length + "개 항목", mk(PracticeSummary, items)), grid);
  }
}
