// Reusable view components. A component is a small object with props and one render() that returns a DOM node.
// Tabs are assembled from these; a new screen should need no new markup helpers. mk(Class, ...args) builds and renders in one step.
import { el, sv, SN, ico, $ } from "./dom.js";

export class Component {
  render() { throw new Error(this.constructor.name + ".render() is not implemented"); }
}
export const mk = (K, ...args) => new K(...args).render();

export class Badge extends Component {
  constructor(tone, text, pip) { super(); this.tone = tone; this.text = text; this.pip = pip; }
  render() { const b = el("span", "badge " + (this.tone || "")); if (this.pip) b.append(el("span", "pip")); b.append(document.createTextNode(this.text)); return b; }
}

// Official-doc link as a small outlined chip with an external-link icon (not a bare underlined URL).
export class DocLink extends Component {
  constructor(href, label) { super(); this.href = href; this.label = label || "공식 문서"; }
  render() { const a = el("a", "doclink"); a.href = this.href; a.target = "_blank"; a.rel = "noreferrer noopener"; a.append(el("span", null, this.label), ico("external", 12)); return a; }
}

export class Panel extends Component {
  constructor(title, hint, ...kids) { super(); this.title = title; this.hint = hint; this.kids = kids; }
  render() { const p = el("div", "panel"), h = el("div", "ph"); h.append(el("h2", null, this.title), el("span", "hint", this.hint || "")); p.append(h, ...this.kids); return p; }
}

export class Note extends Component {
  constructor(text) { super(); this.text = text; }
  render() { return el("p", "note", this.text); }
}

export class Command extends Component {
  constructor(text) { super(); this.text = text; }
  render() { return el("div", "cmd", this.text); }
}

export class Grid2 extends Component {
  constructor(...kids) { super(); this.kids = kids; }
  render() { const g = el("div", "grid2"); g.append(...this.kids); return g; }
}

export class KeyValue extends Component {
  constructor(a, b, sub) { super(); this.a = a; this.b = b; this.sub = sub; }
  render() {
    const d = el("div", "kv"); d.append(this.a instanceof Node ? this.a : el("span", null, this.a));
    const r = el("span"); if (this.b instanceof Node) r.append(this.b); else r.textContent = this.b == null ? "" : String(this.b);
    d.append(r); if (this.sub) d.append(el("div", "sub", this.sub)); return d;
  }
}

export class Tiles extends Component {
  constructor(items) { super(); this.items = items; } // [[label, value, tone], ...]
  render() { const t = el("div", "tiles"); this.items.forEach(([l, n, tone]) => { const c = el("div", "tile " + (tone || "")); c.append(el("div", "n", String(n)), el("div", "l", l)); t.append(c); }); return t; }
}

export class Fold extends Component {
  constructor(summary, kids) { super(); this.summary = summary; this.kids = kids; }
  render() { const d = el("details", "fold"); d.append(el("summary", null, this.summary), ...this.kids); return d; }
}

export class Card extends Component {
  constructor(title, ...kids) { super(); this.title = title; this.kids = kids; }
  render() { const c = el("div", "card"); c.append(el("b", null, this.title), ...this.kids); return c; }
}
export class CardGrid extends Component {
  constructor(cards) { super(); this.cards = cards; }
  render() { const g = el("div", "cards"); g.append(...this.cards); return g; }
}
export class IconCard extends Component {
  constructor(name, desc, icon) { super(); this.name = name; this.desc = desc; this.icon = icon; }
  render() { const c = el("div", "card"), h = el("div", "ch"); h.append(ico(this.icon || "dot", 16), el("b", null, this.name)); c.append(h, el("p", null, this.desc || "")); return c; }
}

// Monitoring KPI card.
export class Kpi extends Component {
  constructor(tone, label, state, value, unit, note) { super(); Object.assign(this, { tone, label, state, value, unit, note }); }
  render() {
    const c = el("div", "panel kpi"), k = el("div", "k"); k.append(el("span", null, this.label), mk(Badge, this.tone, this.state));
    const v = el("div", "v", this.value); if (this.unit) v.append(el("small", null, this.unit));
    c.append(k, v, el("div", "n", this.note)); return c;
  }
}

// Progress ring (n of total).
export class Ring extends Component {
  constructor(ok, total) { super(); this.ok = ok; this.total = total; }
  render() {
    const { ok, total } = this, C = 2 * Math.PI * 44, svg = sv("svg", { class: "ring", viewBox: "0 0 110 110", role: "img", "aria-label": "충족 " + ok + "/" + total });
    svg.append(SN("circle", { cx: 55, cy: 55, r: 44, fill: "none", stroke: "var(--line)", "stroke-width": 10 }));
    svg.append(SN("circle", { cx: 55, cy: 55, r: 44, fill: "none", stroke: ok === total ? "var(--ok)" : "var(--warn)", "stroke-width": 10, "stroke-linecap": "round", "stroke-dasharray": (C * ok / Math.max(total, 1)) + " " + C, transform: "rotate(-90 55 55)" }));
    svg.append(SN("text", { x: 55, y: 60, "text-anchor": "middle", "font-size": 22, "font-weight": 600 }, ok + "/" + total));
    return svg;
  }
}

// Segmented ring of counts by kind; colorOf(kind) gives each slice its color.
export class Donut extends Component {
  constructor(counts, colorOf) { super(); this.counts = counts; this.colorOf = colorOf; }
  render() {
    const counts = this.counts, sum = Object.values(counts).reduce((a, b) => a + b, 0), total = sum || 1, C = 2 * Math.PI * 40;
    const svg = sv("svg", { viewBox: "0 0 120 120", role: "img", "aria-label": "오류 종류 비율" });
    svg.append(SN("circle", { cx: 60, cy: 60, r: 40, fill: "none", stroke: "var(--line)", "stroke-width": 16 }));
    let off = 0;
    Object.entries(counts).forEach(([k, n]) => { const len = C * n / total; svg.append(SN("circle", { cx: 60, cy: 60, r: 40, fill: "none", stroke: this.colorOf(k), "stroke-width": 16, "stroke-dasharray": len + " " + (C - len), "stroke-dashoffset": -off, transform: "rotate(-90 60 60)" })); off += len; });
    svg.append(SN("text", { x: 60, y: 66, "text-anchor": "middle", "font-size": 20, "font-weight": 600 }, String(sum)));
    return svg;
  }
}

// Ring/Donut next to a legend block.
export class DonutBlock extends Component {
  constructor(figure, legend) { super(); this.figure = figure; this.legend = legend; }
  render() { const d = el("div", "donut"); d.append(this.figure, this.legend); return d; }
}

// Row of one flow node: a title, an optional chip, text and a tools line.
export class FlowNode extends Component {
  constructor(cls, title, chip, text, tools) { super(); Object.assign(this, { cls, title, chip, text, tools }); }
  render() { const d = el("div", "node " + (this.cls || "")), h = el("h3", null, this.title); if (this.chip) h.append(this.chip); d.append(h); if (this.text) d.append(el("p", null, this.text)); if (this.tools) d.append(el("div", "tools", this.tools)); return d; }
}
export class FlowRow extends Component {
  constructor(...kids) { super(); this.kids = kids; }
  render() { const r = el("div", "flowrow"); r.append(...this.kids); return r; }
}
export const arrow = () => el("span", "arrow");

// Bar chart built once and then updated in place so bars, gridlines and the end label animate to new values.
// The viewBox is the host's real pixel size, so the chart fills the width at any size (rebuild it when the host is resized or shown).
class BarChart extends Component {
  constructor(host, n, aria, ticks, tip) {
    super(); this.host = host; this.n = n; this.aria = aria; this.ticks = ticks; this.tip = tip;
    this.vals = []; this.labels = []; this.unit = "";
  }
  render() {
    const { host, n, tip } = this, W = Math.max(240, Math.round(host.clientWidth)), H = Math.max(70, Math.round(host.clientHeight)), L = 28, R = 8, T = 18, B = 20, bw = (W - L - R) / n;
    Object.assign(this, { W, H, L, T, B, bw });
    const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "xMidYMid meet", role: "img", "aria-label": this.aria });
    const grid = sv("g", { class: "grid" });
    this.gs = [0, 1, 2].map(() => { const g = sv("g"); g.append(sv("line", { x1: L, x2: W - R, y1: 0, y2: 0 }), sv("text", { x: L - 6, y: 3.5, "text-anchor": "end" })); grid.append(g); return g; });
    svg.append(grid);
    this.cursor = sv("line", { class: "cursor", y1: T, y2: H - B }); svg.append(this.cursor);
    this.rects = Array.from({ length: n }, (_, i) => { const r = sv("rect", { class: "bar", x: L + i * bw + 1.5, width: Math.max(1, bw - 3), rx: 2 }); svg.append(r); return r; });
    this.val = sv("text", { class: "val", "text-anchor": "middle", x: L + (n - 0.5) * bw }); svg.append(this.val);
    this.ticks.forEach(([i, a, txt]) => { const tx = sv("text", { x: a === "start" ? L + i * bw : a === "end" ? L + (i + 1) * bw : L + (i + 0.5) * bw, y: H - 4, "text-anchor": a }); tx.textContent = txt; svg.append(tx); });
    host.replaceChildren(svg);
    host.addEventListener("pointermove", (e) => {
      const b = svg.getBoundingClientRect(), x = ((e.clientX - b.left) / b.width) * W, i = Math.floor((x - L) / bw);
      this.rects.forEach((r) => r.classList.remove("hot"));
      if (i < 0 || i >= n || !this.vals.length) { host.classList.remove("hover"); tip.style.opacity = 0; return; }
      this.rects[i].classList.add("hot"); host.classList.add("hover"); this.cursor.setAttribute("x1", L + (i + 0.5) * bw); this.cursor.setAttribute("x2", L + (i + 0.5) * bw);
      tip.textContent = this.labels[i] + " · " + this.vals[i] + this.unit; tip.style.opacity = 1; tip.style.left = e.clientX + 12 + "px"; tip.style.top = e.clientY - 30 + "px";
    });
    host.addEventListener("pointerleave", () => { host.classList.remove("hover"); tip.style.opacity = 0; this.rects.forEach((r) => r.classList.remove("hot")); });
    return svg;
  }
  update(vals, labels, unit) {
    const { n, H, T, B } = this, top = Math.max(2, Math.ceil(Math.max(1, ...vals) / 2) * 2), y = (v) => T + (H - T - B) * (1 - v / top);
    [0, top / 2, top].forEach((t, k) => { this.gs[k].style.transform = `translateY(${y(t)}px)`; this.gs[k].lastChild.textContent = Math.round(t * 10) / 10; });
    this.rects.forEach((r, i) => { r.style.y = y(vals[i]) + "px"; r.style.height = Math.max(vals[i] ? 2 : 0, H - B - y(vals[i])) + "px"; r.classList.toggle("last", i === n - 1); });
    this.val.textContent = vals[n - 1] || ""; this.val.style.y = y(vals[n - 1]) - 5 + "px"; this.val.setAttribute("y", y(vals[n - 1]) - 5);
    this.vals = vals; this.labels = labels; this.unit = unit || "";
  }
}

// Charts keyed by host id; built lazily, dropped when the layout changes so they are re-measured.
export class ChartRegistry {
  constructor() { this.items = {}; this.tip = $("tip"); }
  get(id, n, aria, ticks) {
    if (!this.items[id]) { const c = new BarChart($(id), n, aria, ticks, this.tip); c.render(); this.items[id] = c; }
    return this.items[id];
  }
  reset() { this.items = {}; }
}

