// The "same tasks, three ways" comparison for the efficiency tab. Reads the `bench` source's `data` (from reports/bench/latest.json).
import { el } from "./dom.js";
import { Panel, Note, mk } from "./components.js";
import { splitBar, splitLegend } from "./usage-panel.js";

const usd = (x) => (x == null ? "-" : "$" + x.toFixed(3));
const mins = (s) => (s == null ? "-" : (s / 60).toFixed(1) + "분");
const pct = (v) => (v == null ? "-" : (v > 0 ? "+" : "") + v.toFixed(1) + "%");
const range = (st, f) => (st && st.n > 1 ? " (" + f(st.min) + "~" + f(st.max) + ")" : "");

export class BenchPanel {
  constructor(data) { this.d = data; }
  render() {
    const arms = Object.entries(this.d.arms), tbl = el("table", "utable"), head = el("tr");
    ["방식", "실행", "비용 평균", "시간 평균", "최대 컨텍스트", "숨은 테스트", "기본 대비 비용", "기본 대비 시간"].forEach((h) => head.append(el("th", null, h)));
    tbl.append(head);
    arms.forEach(([, a]) => {
      const tr = el("tr"), vs = a.vsSingle || {};
      tr.append(el("td", "nm", a.label), el("td", null, String(a.runs)),
        el("td", null, usd(a.costUSD && a.costUSD.mean) + range(a.costUSD, usd)),
        el("td", null, mins(a.wallSec && a.wallSec.mean) + range(a.wallSec, mins)),
        el("td", null, a.peakContext && a.peakContext.mean != null ? Math.round(a.peakContext.mean / 1000) + "K" : "-"),
        el("td", null, a.scorePct && a.scorePct.mean != null ? a.scorePct.mean.toFixed(0) + "%" : "-"),
        el("td", null, pct(vs.costUSD)), el("td", null, pct(vs.wallSec)));
      tbl.append(tr);
    });
    const splits = arms.flatMap(([, a]) => [el("div", "grp", a.label), splitBar(a.split), splitLegend(a.split)]);
    return mk(Panel, "같은 과제 비교 (기본 vs 서브에이전트 vs AO)", this.d.generated ? "측정 " + this.d.generated : "",
      tbl, el("div", "grp", "비용 구성 (실행 평균)"), ...splits,
      mk(Note, "'기본 대비'는 메인 혼자 실행한 평균과의 차이입니다. 병렬은 시간을 줄이는 대신 시작 비용(에이전트마다 시스템 프롬프트 캐시 쓰기)이 늘 수 있습니다. 숨은 테스트 점수가 같을 때만 비용·시간을 비교하세요."));
  }
}
