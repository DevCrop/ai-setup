// Diagrams: each is a Component that renders from the inventory. Arrowheads are fixed-size chevrons (userSpaceOnUse) so they do not grow with line width.
import { Component } from "./components.js";
import { el, sv, SN, ico, hms } from "./dom.js";

let DID = 0;
// marker ids are per document, so every diagram gets its own copy (hidden views keep their SVGs)
function wrapDiagram(svg) {
  const u = "-" + (++DID);
  svg.querySelectorAll("marker").forEach((m) => { m.id += u; });
  svg.querySelectorAll("[marker-end]").forEach((e) => e.setAttribute("marker-end", e.getAttribute("marker-end").replace(/\)$/, u + ")")));
  const d = el("div", "dia"); d.append(svg); return d;
}
function addMarkers(svg) {
  const d = SN("defs");
  [["ah-call", "var(--accent)"], ["ah-ret", "var(--muted)"], ["ah-edge", "var(--faint)"]].forEach(([id, c]) => {
    const m = SN("marker", { id, viewBox: "0 0 10 10", refX: "8", refY: "5", markerWidth: "9", markerHeight: "9", markerUnits: "userSpaceOnUse", orient: "auto-start-reverse" });
    m.append(SN("path", { d: "M2 1.5 L7.5 5 L2 8.5", fill: "none", stroke: c, "stroke-width": "1.5", "stroke-linecap": "round", "stroke-linejoin": "round" })); d.append(m);
  });
  svg.append(d);
}

// One edge in a flow diagram. kind: call (solid accent), ret (dashed grey), edge (thin grey). Edges move (dashes travel along the line) unless tone is "off".
// tone: ok / warn / bad recolor and speed the flow; "off" is a static line for a missing or inactive link.
function flowEdge(tag, kind, tone, attrs) {
  return SN(tag, { ...attrs, class: kind + " flow-anim" + (tone ? " flow-" + tone : "") + (tone === "off" ? " flow-still" : ""), "marker-end": "url(#" + (kind === "call" ? "ah-call" : kind === "ret" ? "ah-ret" : "ah-edge") + ")" });
}

// Delegation as numbered step cards: who acts, what is sent, what comes back (a claim until the main thread checks it).
export class DelegationFlow extends Component {
  constructor(ctx) { super(); this.ctx = ctx; }
  render() {
    const { inv, agent } = this.ctx, r = inv.routing, mdl = (n) => agent(n).model;
    const who = (n, m, cls) => { const c = el("span", "actor" + (cls ? " " + cls : "") + (/haiku/i.test(m) ? " haiku" : "")); c.append(el("b", null, n)); if (m) c.append(el("small", null, m)); return c; };
    const main = () => who("메인", (r.main || "?") + " · " + (r.effort || "?"), "a-main"), adv = () => who("advisor", r.advisor || "?", "a-adv"), ag = (n) => who(n, mdl(n));
    const steps = [
      { a: [who("사용자", ""), main()], go: "요청 · 목표 · 완료 기준", back: "" },
      { a: [main()], go: "스펙과 디자인 스펙 작성", back: "", self: true },
      { a: [main(), adv()], go: "접근 확정 전 자문", back: "조언" },
      { a: [ag("backend"), ag("publisher")], go: "브리프 (각각)", back: "API 계약 + 테스트 결과 · 마크업 + 변경 파일", par: true },
      { a: [ag("frontend")], go: "브리프 + API 계약", back: "구현 보고 (주장)" },
      { a: [ag("qa")], go: "기준 + 변경 파일 목록만", back: "실행 증거" },
      { a: [ag("reviewer")], go: "기준 + 변경 파일 목록만", back: "검토 결과" },
      { a: [main(), adv()], go: "완료 선언 전 검토", back: "조언" },
      { a: [main(), who("사용자", "")], go: "", back: "증거를 확인한 뒤 완료 보고", fin: true }];
    const box = el("div", "steps");
    steps.forEach((st, k) => {
      const row = el("div", "fstep"), n = el("div", "fnum", String(k + 1)), card = el("div", "fcard"), head = el("div", "fwho");
      st.a.forEach((x, i) => { if (i) head.append(el("span", "farrow", st.par ? "+" : st.fin ? "→" : st.self ? "" : "⇄")); head.append(x); });
      if (st.par) head.append(el("span", "ftag", "병렬"));
      card.append(head);
      const body = el("div", "fmsg");
      if (st.go) { const l = el("div", "fline"); l.append(el("span", "fdir go", st.self ? "작성" : "보냄"), el("span", null, st.go)); body.append(l); }
      if (st.back) { const l = el("div", "fline"); l.append(el("span", "fdir back", st.fin ? "보고" : "돌려받음"), el("span", null, st.back)); body.append(l); }
      card.append(body); row.append(n, card); box.append(row);
    });
    return box;
  }
}

// State of one delegation: solid arrows are the normal path, the dashed elbow is the retry loop, the red box is the stop.
export class DelegationStates extends Component {
  render() {
    const W = 980, H = 200, S = [["브리프 작성", 40], ["실행", 228], ["보고 (주장)", 416], ["증거 확인", 604], ["완료", 800]], bw = 150;
    const svg = sv("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "위임 하나의 상태 다이어그램" });
    addMarkers(svg);
    svg.append(SN("circle", { cx: 8, cy: 50, r: 6, fill: "var(--fg)" }));
    svg.append(flowEdge("line", "call", "", { x1: 14, y1: 50, x2: S[0][1] - 2, y2: 50 }));
    S.forEach((st, i) => {
      const xx = st[1];
      svg.append(SN("rect", { x: xx, y: 26, width: bw, height: 48, rx: 24, class: "box" + (i === 4 ? " a" : i === 1 ? " m" : "") }));
      svg.append(SN("text", { x: xx + bw / 2, y: 55, "text-anchor": "middle", "font-weight": 600 }, st[0]));
      if (i < 4) svg.append(flowEdge("line", "call", "", { x1: xx + bw, y1: 50, x2: S[i + 1][1] - 2, y2: 50 }));
    });
    svg.append(SN("text", { x: 777, y: 40, "text-anchor": "middle", class: "msg" }, "[충족]"));
    svg.append(flowEdge("path", "ret", "", { d: "M679 74 V118 H303 V78" }));
    svg.append(SN("text", { x: 491, y: 110, "text-anchor": "middle", class: "msg r" }, "[증거 불충분] 재시도 · 같은 오류는 최대 2회"));
    svg.append(SN("rect", { x: 340, y: 150, width: 300, height: 36, rx: 18, class: "box", style: "stroke:var(--bad);fill:var(--bad-soft)" }));
    svg.append(SN("text", { x: 490, y: 173, "text-anchor": "middle", "font-weight": 600 }, "중단 · 정확한 오류와 누락 입력 보고"));
    svg.append(flowEdge("path", "call", "bad", { d: "M115 74 V168 H336" }));
    svg.append(SN("text", { x: 124, y: 140, class: "msg" }, "[입력 누락]"));
    svg.append(flowEdge("path", "ret", "bad", { d: "M679 118 V168 H644" }));
    svg.append(SN("text", { x: 688, y: 146, class: "msg r" }, "[2회 실패]"));
    return wrapDiagram(svg);
  }
}

// Model routing as a component diagram: request -> main conversation -> tiers of agents by model.
export class RoutingDiagram extends Component {
  constructor(ctx) { super(); this.ctx = ctx; }
  render() {
    const r = this.ctx.inv.routing, tiers = [["opus", "Opus", []], ["haiku", "Haiku", []], ["other", "상속·기타", []]];
    const put = (name, model, eff) => { const k = /opus/i.test(model) ? 0 : /haiku/i.test(model) ? 1 : 2; tiers[k][2].push([name, eff]); };
    put("advisor", r.advisor || "?", "검토·조언");
    r.agents.forEach((a) => put(a.name, a.model, a.effort));
    const shown = tiers.filter((t) => t[2].length), W = 980, CW = 128, per = 4, X = 384;
    let y = 16; const rows = shown.map((t) => { const h = 46 + Math.ceil(t[2].length / per) * 50; const o = { t, y, h }; y += h + 14; return o; });
    const H = Math.max(y, 190);
    const svg = sv("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "모델 라우팅 컴포넌트 다이어그램" });
    addMarkers(svg);
    svg.append(SN("rect", { x: 14, y: H / 2 - 98, width: 120, height: 56, rx: 10, class: "box" }));
    svg.append(SN("text", { x: 74, y: H / 2 - 74, "text-anchor": "middle", class: "sub" }, "«actor»"));
    svg.append(SN("text", { x: 74, y: H / 2 - 56, "text-anchor": "middle", "font-weight": 600 }, "요청"));
    svg.append(SN("rect", { x: 160, y: H / 2 - 40, width: 150, height: 80, rx: 12, class: "box m" }));
    svg.append(SN("text", { x: 235, y: H / 2 - 24, "text-anchor": "middle", class: "sub" }, "«orchestrator»"));
    svg.append(SN("text", { x: 235, y: H / 2 - 8, "text-anchor": "middle", "font-weight": 600 }, "메인 대화"));
    svg.append(SN("text", { x: 235, y: H / 2 + 9, "text-anchor": "middle", class: "sub" }, (r.main || "?") + " · " + (r.effort || "?")));
    svg.append(SN("text", { x: 235, y: H / 2 + 26, "text-anchor": "middle", class: "sub" }, "위임 여부를 먼저 판단"));
    svg.append(flowEdge("line", "edge", "", { x1: 134, y1: H / 2 - 70, x2: 200, y2: H / 2 - 42 }));
    rows.forEach((row) => {
      svg.append(SN("rect", { x: X, y: row.y, width: W - X - 14, height: row.h, rx: 12, class: "tier t-" + row.t[0] }));
      svg.append(SN("text", { x: X + 14, y: row.y + 24, "font-weight": 600 }, row.t[1]));
      svg.append(SN("text", { x: X + 14 + 8 * (row.t[1].length) + 24, y: row.y + 24, class: "sub" }, row.t[2].length + "개"));
      row.t[2].forEach((c, i) => {
        const cx = X + 14 + (i % per) * (CW + 10), cy = row.y + 36 + Math.floor(i / per) * 50;
        svg.append(SN("rect", { x: cx, y: cy, width: CW, height: 42, rx: 8, class: "box" + (c[0] === "advisor" ? " a" : "") }));
        const g = SN("g", { transform: "translate(" + (cx + 8) + "," + (cy + 6) + ")", style: "color:var(--faint)" }); g.append(ico(c[0] === "advisor" ? "bulb" : "bot", 14)); svg.append(g);
        svg.append(SN("text", { x: cx + CW / 2 + 6, y: cy + 18, "text-anchor": "middle", "font-weight": 600 }, c[0]));
        svg.append(SN("text", { x: cx + CW / 2, y: cy + 33, "text-anchor": "middle", class: "sub" }, c[1] ? "effort " + c[1] : ""));
      });
      svg.append(flowEdge("path", "edge" + (row.t[0] === "opus" ? " inh" : ""), "", { d: "M310 " + (H / 2) + " C350 " + (H / 2) + " 340 " + (row.y + row.h / 2) + " " + (X - 2) + " " + (row.y + row.h / 2) }));
      svg.append(SN("text", { x: 316, y: row.y + row.h / 2 - 8, class: "fl" }, row.t[0] === "opus" ? "«advise»" : "«delegate»"));
    });
    return wrapDiagram(svg);
  }
}

// Monitoring flow: each node is one real check, its dot is that check's current level. Rows follow the data path.
export class MonitoringFlow extends Component {
  constructor(tools) { super(); this.tl = tools; }
  render() {
    const tl = this.tl;
    const lv = (n) => { const x = tl.find((t) => t.name === n); return x ? x.level : "na"; }, dt = (n) => { const x = tl.find((t) => t.name === n); return x ? x.detail.split(" · ")[0] : "미설치"; };
    const rows = [
      ["기록 → 기억", [["프롬프트 기록", "프롬프트 기록"], ["세션 로그", "세션 로그"], ["claude-mem 워커", "워커"], ["observer", "관찰자(observer)"], ["DB", "DB"], ["마스킹", "비밀 마스킹(redact)"]]],
      ["병렬 작업(AO)", [["데몬", "데몬"], ["승인 대기", "승인 대기(blocked)"], ["멈춤", "멈춤(stuck)"], ["조용한 세션", "6시간 넘게 조용한 세션"], ["리뷰", "리뷰 없는 PR"], ["세션", "세션 합계"]]],
      ["도구", [["RTK", "RTK 버전"]]],
    ];
    const W = 980, NW = 128, NH = 52, GX = 36, X0 = 12, svg = sv("svg", { viewBox: "0 0 " + W + " " + (rows.length * 96 + 12), role: "img", "aria-label": "모니터링 흐름" });
    addMarkers(svg);
    rows.forEach((r, ri) => {
      const y = 22 + ri * 96; svg.append(SN("text", { x: X0, y: y - 8, class: "fl-l" }, r[0]));
      r[1].forEach((n, i) => {
        const x = X0 + i * (NW + GX), name = n[1], level = lv(name);
        svg.append(SN("rect", { x, y, width: NW, height: NH, rx: 8, class: "fl-n" }), SN("circle", { cx: x + 14, cy: y + 18, r: 4.5, class: "dot-" + level }),
          SN("text", { x: x + 26, y: y + 22, class: "fl-t" }, n[0]), SN("text", { x: x + 14, y: y + 41, class: "fl-s" }, dt(name).slice(0, 18)));
        if (i < r[1].length - 1) { const ax = x + NW + 3, ay = y + NH / 2, tone = level === "ok" || level === "warn" || level === "bad" ? level : "off"; svg.append(flowEdge("line", "edge", tone, { x1: ax, y1: ay, x2: ax + GX - 6, y2: ay })); } // the line takes the state of the node it leaves
      });
    });
    const w = wrapDiagram(svg); w.classList.add("flowbox"); return w;
  }
}

// Errors over time, stacked by kind.
export class ErrorTimeline extends Component {
  constructor(errors, colorOf) { super(); this.errs = errors; this.colorOf = colorOf; }
  render() {
    const errs = this.errs, W = 600, H = 70, svg = sv("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "시간대별 오류" });
    svg.setAttribute("style", "width:100%;height:auto;min-height:60px;min-width:0");
    const ts = errs.map((e) => new Date(e.at).getTime()).filter((t) => !isNaN(t));
    svg.append(SN("line", { x1: 0, y1: H - 16, x2: W, y2: H - 16, stroke: "var(--line)" }));
    if (!ts.length) return wrapDiagram(svg);
    const lo = Math.min(...ts), hi = Math.max(...ts, lo + 1), B = 30, bins = Array.from({ length: B }, () => ({})), bw = W / B;
    errs.forEach((e) => { const t = new Date(e.at).getTime(); if (isNaN(t)) return; const i = Math.min(B - 1, Math.floor((t - lo) / (hi - lo) * B)); bins[i][e.kind] = (bins[i][e.kind] || 0) + 1; });
    const mx = Math.max(1, ...bins.map((b) => Object.values(b).reduce((a, c) => a + c, 0)));
    bins.forEach((b, i) => { let y = H - 16; Object.entries(b).forEach(([k, n]) => { const h = (H - 26) * n / mx; y -= h; svg.append(SN("rect", { x: i * bw + 2, y, width: bw - 4, height: h, rx: 2, fill: this.colorOf(k) })); }); });
    svg.append(SN("text", { x: 0, y: H - 2, "font-size": 10, fill: "var(--faint)", style: "fill:var(--faint)" }, hms(new Date(lo).toISOString())));
    svg.append(SN("text", { x: W, y: H - 2, "font-size": 10, "text-anchor": "end", style: "fill:var(--faint)" }, hms(new Date(hi).toISOString())));
    return wrapDiagram(svg);
  }
}

