// Errors and debugging: counts by kind, a timeline, the error log with meaning and fix, and the commands to re-check.
import { Tab } from "../tab.js";
import { el, ico, ago, hms } from "../dom.js";
import { Badge, Panel, Note, Grid2, KeyValue, Command, Tiles, Donut, DonutBlock, mk } from "../components.js";
import { ErrorTimeline } from "../diagrams.js";

const KINDS = {
  "hook-block": { tone: "warn", ic: "shield", name: "훅 차단", color: "var(--warn)", mean: "secret-guard 훅이 비밀 파일이 들어가는 git add/commit/push나 GitHub MCP 파일 쓰기(push_files, create_or_update_file)를 막았습니다.", fix: "차단된 파일을 변경에서 빼거나 .gitignore에 넣고 다시 실행하세요. 템플릿이면 이름을 .example로 바꿉니다." },
  "hook-error": { tone: "bad", ic: "x", name: "훅 오류", color: "var(--bad)", mean: "훅 스크립트 자체가 실패했습니다(차단 exit 2가 아님).", fix: "bash scripts/qa-hooks.sh 와 verify.sh --live 로 훅 파일과 경로를 확인하세요." },
  permission: { tone: "warn", ic: "lock", name: "권한 거부", color: "var(--info)", mean: "deny/ask 규칙이나 권한 모드가 호출을 막았습니다.", fix: "규칙은 claude/settings.json 입니다. 정말 필요하면 사용자 확인 후 PR로 바꿉니다." },
  "tool-error": { tone: "info", ic: "dot", name: "도구 오류", color: "var(--faint)", mean: "명령이 0이 아닌 코드로 끝났거나 파일 없음 같은 일반 실패입니다.", fix: "원문은 세션 로그에 있습니다(대시보드는 본문을 보내지 않음). 같은 오류가 2번이면 멈추고 원인을 보고합니다." }
};
const kind = (k) => KINDS[k] || KINDS["tool-error"];

export class DbgTab extends Tab {
  static id = "dbg";
  static icon = "alert";
  constructor(app) { super(app); this.open = new Set(); this.filter = null; }
  draw(v) {
    const d = this.app.inv.debug, last = this.app.last, now = Date.now(), vf = ((last && last.verify) || {}).lines || [], vbad = vf.filter((l) => /^(FAIL|WARN)/.test(l));
    const total = Object.values(d.counts).reduce((a, b) => a + b, 0), rate = d.scanned ? Math.round(total / d.scanned * 1000) / 10 : 0;
    const blocked = ((last && last.ao && last.ao.sessions) || []).filter((x) => x.activity === "blocked" && !x.isTerminated);
    const lastErr = d.errors.length ? Math.max(...d.errors.map((e) => new Date(e.at).getTime())) : 0;
    const legend = el("div", "legend2");
    Object.entries(d.counts).forEach(([k, n]) => { const m = kind(k), r = el("div"), i = el("i"); i.style.background = m.color; r.append(i, document.createTextNode(m.name + " " + n + "건")); legend.append(r); });
    if (!total) legend.append(mk(Note, "도구 오류가 없습니다."));
    const tools = el("div", "legend2"); Object.entries(d.tools).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => tools.append(mk(KeyValue, k, n + "건")));
    const cmds = ["bash scripts/verify.sh --live      # 설정·적용 상태", "bash scripts/qa-hooks.sh             # secret-guard 단위 시험", "bash scripts/qa-deny.sh --static      # deny 규칙의 rtk 짝", "QA_MODE=selftest bash scripts/qa-role-agents.sh <dir>   # 채점기 자체 시험", "bash scripts/qa-dashboard.sh         # 이 대시보드 검사"];
    v.replaceChildren(
      mk(Tiles, [["도구 결과 스캔", d.scanned, ""], ["오류", total, total ? "warn" : "ok"], ["오류율", rate + "%", rate > 10 ? "bad" : ""], ["훅 차단", d.counts["hook-block"] || 0, d.counts["hook-block"] ? "warn" : ""], ["설정 FAIL/WARN", vbad.length, vbad.length ? "bad" : "ok"], ["마지막 오류", lastErr ? ago(new Date(lastErr).toISOString(), now) : "없음", ""]]),
      mk(Grid2, mk(Panel, "오류 종류", "비율", mk(DonutBlock, mk(Donut, d.counts, (k) => kind(k).color), legend)), mk(Panel, "시간대별", "최근 세션 로그", mk(ErrorTimeline, d.errors, (k) => kind(k).color))),
      mk(Panel, "로그 " + d.errors.length + "건", "클릭하면 의미와 조치 · 본문은 보내지 않고 분류만", this.chips(d, v), this.list(d, v, now)),
      mk(Grid2, mk(Panel, "도구별 오류", "", ...(Object.keys(d.tools).length ? [tools] : [mk(Note, "없음")])), mk(Panel, "설정 점검 FAIL/WARN", "verify --live", ...(vbad.length ? vbad.map((l) => mk(KeyValue, l)) : [mk(Note, "FAIL·WARN 없음")]))),
      mk(Panel, "AO 멈춤", "", ...(blocked.length ? blocked.map((x) => mk(KeyValue, x.id, mk(Badge, "warn", "사용자 입력 대기"))) : [mk(Note, "입력 대기 중인 워커 없음")])),
      mk(Panel, "디버깅 명령", "직접 실행", ...cmds.map((t) => mk(Command, t))));
  }
  chips(d, v) {
    const chips = el("div", "fchips"), all = el("button", "btn", "전체 " + d.errors.length); all.type = "button"; all.setAttribute("aria-pressed", this.filter === null);
    all.onclick = () => { this.filter = null; this.draw(v); }; chips.append(all);
    Object.keys(d.counts).forEach((k) => { const b = el("button", "btn", kind(k).name); b.type = "button"; b.setAttribute("aria-pressed", this.filter === k); b.onclick = () => { this.filter = this.filter === k ? null : k; this.draw(v); }; chips.append(b); });
    return chips;
  }
  list(d, v, now) {
    const list = el("div", "rows");
    d.errors.slice().reverse().filter((e) => !this.filter || e.kind === this.filter).forEach((e, idx) => {
      const m = kind(e.kind), key = e.at + e.tool + idx, b = el("button", "erow"); b.type = "button"; b.setAttribute("aria-expanded", this.open.has(key));
      const mid = el("span"); mid.append(el("b", null, e.tool + " "), mk(Badge, m.tone, m.name), el("span", "muted", e.detail ? "  " + e.detail : ""));
      const ic = el("span", "ico"); ic.append(ico(m.ic, 17)); ic.style.color = m.color; b.append(ic, mid, el("span", "muted", ago(e.at, now)));
      b.onclick = () => { this.open.has(key) ? this.open.delete(key) : this.open.add(key); this.draw(v); };
      list.append(b);
      if (this.open.has(key)) { const x = el("div", "exp"); x.append(el("p", null, "의미: " + m.mean), el("p", null, "조치: " + m.fix), el("div", "muted", "발생 시각 " + hms(e.at) + (e.detail ? " · 차단된 파일: " + e.detail : ""))); list.append(x); }
    });
    if (!list.children.length) list.append(mk(Note, "해당하는 오류가 없습니다."));
    return list;
  }
}
