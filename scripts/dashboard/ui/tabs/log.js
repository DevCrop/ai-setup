// Log and fixes: what needs action, the fix history, every check. Fixes run only from the server's allow-list, after a confirm dialog.
import { Tab } from "../tab.js";
import { el } from "../dom.js";
import { Badge, Panel, mk } from "../components.js";
import { MonitoringFlow } from "../diagrams.js";

const LV = { ok: "정상", warn: "확인", bad: "오류" };

export class LogTab extends Tab {
  static id = "log";
  static icon = "list";
  get needsInventory() { return false; }
  get redrawOnState() { return !this.app.fixDialog.isOpen; }
  draw(v) {
    const s = this.app.last; if (!s) { v.replaceChildren(el("p", "note", "데이터를 기다리는 중…")); return; }
    const tl = (s.tools || []).filter((x) => x.level !== "na"), need = tl.filter((x) => x.level === "warn" || x.level === "bad");
    const head = el("div", "kpis"), kpi = (tone, lab, n) => { const k = el("div", "kpi " + tone); k.append(el("div", "l", lab), el("div", "v", String(n))); return k; };
    head.append(kpi(need.some((x) => x.level === "bad") ? "bad" : need.length ? "warn" : "ok", "조치 필요", need.length), kpi("ok", "정상", tl.length - need.length), kpi("", "조치 기록", (s.fixlog || []).length));
    const todo = el("div", "rows");
    if (!need.length) todo.append(el("div", "empty", "조치가 필요한 항목이 없습니다."));
    need.forEach((x) => {
      const c = el("div", "logcard " + x.level), h = el("div", "lh"); h.append(mk(Badge, x.level, LV[x.level]), el("b", null, x.group + " · " + x.name));
      c.append(h, el("p", "muted", x.detail));
      if (x.fix) { const f = el("p", "fixtxt"); f.append(el("span", "fixlab", "해결 방법 "), document.createTextNode(x.fix)); c.append(f); }
      if (x.fixId) { const b = el("button", "btn", "해결…"); b.type = "button"; b.addEventListener("click", () => this.app.fixDialog.open(x.fixId)); c.append(b); }
      else if (x.fix) c.append(el("span", "hint", "자동 실행 불가 — 직접 처리"));
      todo.append(c);
    });
    const hist = el("div", "rows");
    if (!(s.fixlog || []).length) hist.append(el("div", "empty", "아직 실행한 조치가 없습니다."));
    (s.fixlog || []).slice(0, 30).forEach((e) => { const r = el("div", "row logrow"); r.append(mk(Badge, e.ok ? "ok" : "bad", e.ok ? "완료" : "실패"), el("span", "when muted", new Date(e.at).toLocaleString("ko-KR")), el("span", "t", e.id + " · " + (e.msg || "") + ((e.targets || []).length ? " (" + e.targets.length + "건)" : ""))); hist.append(r); });
    const all = el("div", "rows");
    tl.forEach((x) => { const r = el("div", "row chk"), t = el("span", "t", x.group + " · " + x.name + " — " + x.detail); t.title = t.textContent; r.append(mk(Badge, x.level, LV[x.level]), t); all.append(r); });
    v.replaceChildren(head, mk(Panel, "모니터링 흐름", "점의 색이 지금 상태입니다", mk(MonitoringFlow, tl), this.groupBars(tl)), mk(Panel, "조치 필요", "버튼은 허용 목록의 안전한 조치만 실행합니다", todo), mk(Panel, "조치 기록", "state/fix-log.jsonl", hist), mk(Panel, "전체 점검", tl.length + "개", all));
  }
  groupBars(tl) {
    const g = {}; tl.forEach((x) => { const o = g[x.group] || (g[x.group] = { ok: 0, warn: 0, bad: 0 }); o[x.level === "ok" ? "ok" : x.level === "bad" ? "bad" : "warn"]++; });
    const box = el("div", "rows");
    Object.keys(g).forEach((k) => {
      const o = g[k], n = o.ok + o.warn + o.bad, r = el("div", "sbar"), tr = el("div", "tr");
      [["o", o.ok], ["w", o.warn], ["b", o.bad]].forEach(([c, v]) => { if (v) { const i = el("i", c); i.style.width = (v / n * 100) + "%"; tr.append(i); } });
      r.append(el("span", null, k), tr, el("span", "n", o.ok + "/" + n + " 정상")); box.append(r);
    });
    return box;
  }
}
