// The "how much did the model placement save" view for the efficiency tab. Reads the `usage` source's `data`; every amount is a list-price estimate.
import { el } from "./dom.js";
import { Badge, Panel, Note, Tiles, mk } from "./components.js";

const usd = (x) => (x < 0.1 ? "$" + x.toFixed(4) : "$" + x.toFixed(2));
const SHORT = (m) => m.replace(/^claude-/, "");

const KIND_LABEL = { read: "캐시 읽기", write: "캐시 쓰기", output: "출력", input: "입력" };

// One stacked bar of the cost kinds, each segment's width its share of the total. Exported for the bench panel.
export function splitBar(split) {
  const total = Object.values(split || {}).reduce((a, b) => a + (b || 0), 0), t = el("div", "ubar-track ustack");
  Object.keys(KIND_LABEL).forEach((k) => {
    const v = (split && split[k]) || 0, f = el("div", "ubar-fill k-" + k);
    f.style.width = total ? (v / total) * 100 + "%" : "0%";
    f.title = KIND_LABEL[k] + " " + usd(v);
    t.append(f);
  });
  return t;
}

export function splitLegend(split) {
  const total = Object.values(split || {}).reduce((a, b) => a + (b || 0), 0), r = el("div", "ulegend");
  Object.keys(KIND_LABEL).forEach((k) => {
    const v = (split && split[k]) || 0;
    r.append(el("span", "k-" + k, KIND_LABEL[k] + " " + (total ? Math.round((v / total) * 100) : 0) + "% · " + usd(v)));
  });
  return r;
}

function bar(label, value, max, cls, text) {
  const r = el("div", "ubar"), t = el("div", "ubar-track"), f = el("div", "ubar-fill " + cls);
  f.style.width = max ? Math.max(value ? 1.5 : 0, (value / max) * 100) + "%" : "0%";
  t.append(f);
  r.append(el("span", "ubar-l", label), t, el("span", "ubar-v", text));
  return r;
}

export class UsagePanel {
  constructor(data) { this.d = data; }
  render() {
    const d = this.d, max = Math.max(d.baselineUSD, d.actualUSD), pct = d.baselineUSD ? (d.savedUSD / d.baselineUSD) * 100 : 0;
    const models = Object.entries(d.models).sort((a, b) => (b[1].costUSD || 0) - (a[1].costUSD || 0));
    const mmax = Math.max(0, ...models.map(([, t]) => t.costUSD || 0));
    const tbl = el("table", "utable"), head = el("tr");
    ["에이전트", "정의 파일의 모델", "실제 응답 모델", "호출", "금액(정가)"].forEach((h) => head.append(el("th", null, h)));
    tbl.append(head);
    d.agents.forEach((a) => {
      const tr = el("tr", a.calls ? "" : "idle"), ok = !a.actual.length || ["(상속)", "(내장)", "(여러 종류)"].includes(a.defined) || a.actual.every((m) => m.includes(a.defined.toLowerCase()));
      const act = el("td"); a.actual.length ? (act.append(a.actual.map(SHORT).join(", ") + " "), act.append(mk(Badge, ok ? "ok" : "warn", ok ? "일치" : "불일치"))) : act.append("실행 기록 없음");
      tr.append(el("td", "nm", a.name), el("td", null, a.defined), act, el("td", null, String(a.calls)), el("td", null, a.calls ? usd(a.costUSD) : "-"));
      tbl.append(tr);
    });
    return mk(Panel, "모델 배치 절감 (추정)", "공식 정가 × 로그 토큰",
      mk(Tiles, [["실사용(정가 환산)", usd(d.actualUSD), "acc"], ["메인 모델로만 돌렸다면", usd(d.baselineUSD), ""], ["줄인 몫", usd(d.savedUSD) + " · " + pct.toFixed(1) + "%", pct > 0 ? "ok" : ""]]),
      ...(d.split ? [el("div", "grp", "비용 구성 (어디에 돈이 드나)"), splitBar(d.split), splitLegend(d.split)] : []),
      el("div", "grp", "같은 토큰의 비용 비교"),
      bar("실제 배치", d.actualUSD, max, "acc", usd(d.actualUSD)),
      bar("메인 모델만", d.baselineUSD, max, "base", usd(d.baselineUSD)),
      el("div", "grp", "모델별 비용"),
      ...models.map(([m, t]) => bar(SHORT(m), t.costUSD || 0, mmax, "acc", usd(t.costUSD || 0))),
      el("div", "grp", "에이전트: 정의 대 실제"),
      tbl,
      mk(Note, "'메인 모델만'은 같은 토큰이 메인 모델에서도 들었다는 가정의 계산입니다. 품질 차이는 반영하지 않으며, 구독에서는 청구액이 아니라 한도 사용량의 상대 크기입니다. 금액은 세션 로그(트랜스크립트) 기준이라, 서브에이전트 호출은 CLI 집계 비용보다 적게 잡힐 수 있습니다(벤치마크에서 낮게 나온 적이 있으며 원인은 확인하지 못했습니다)."));
  }
}
