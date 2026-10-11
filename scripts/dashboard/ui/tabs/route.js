import { Tab } from "../tab.js";
import { el } from "../dom.js";
import { Badge, Panel, Note, Grid2, KeyValue, Command, Tiles, FlowNode, FlowRow, arrow, mk } from "../components.js";
import { RoutingDiagram } from "../diagrams.js";

export class RouteTab extends Tab {
  static id = "route";
  static icon = "route";
  draw(v) {
    const r = this.app.inv.routing, ao = r.ao || [];
    v.replaceChildren(
      mk(Tiles, [["메인 모델", r.main || "?", "acc"], ["advisor", r.advisor || "?", "acc"], ["서브에이전트", r.agents.length, ""], ["Haiku 사용", r.agents.filter((a) => /haiku/i.test(a.model)).length, "ok"], ["AO 프로젝트", ao.length, ""]]),
      mk(Panel, "모델 라우팅 (UML 컴포넌트)", "점선은 advisor가 메인과 서브에이전트에 상속·적용됨", mk(RoutingDiagram, this.app), mk(Note, "각 에이전트는 frontmatter의 model이 우선이고, 없으면 메인을 상속합니다.")),
      mk(Grid2,
        mk(Panel, "AO 경로", ao.length ? ao.length + "개 프로젝트" : "데몬 중지 또는 없음",
          mk(FlowRow, mk(FlowNode, "n-side", "AO 워커", mk(Badge, "info", "--model"), "프로젝트 설정의 모델"), arrow(), mk(FlowNode, "n-side", "AO 리뷰어", mk(Badge, "info", "--reviewer"), "실제 사용 모델 필드는 AO 출력에 없어 확인 불가")),
          ao.length ? el("div", "note", ao.join(", ")) : mk(Note, "프로젝트 id는 AO 데몬이 켜져 있을 때만 읽습니다."),
          mk(Command, "ao project set-config <id> --model <m> --reviewer <m> --permission <mode>")),
        mk(Panel, "메인 설정", "claude/settings.json", mk(KeyValue, "effortLevel", r.effort || "?"), mk(KeyValue, "autoCompactWindow", r.autoCompact || "기본"), mk(KeyValue, "promptCacheTtl", r.cacheTtl || "기본"), mk(KeyValue, "subagentPromptCacheTtl", r.subagentCacheTtl || "기본"), mk(KeyValue, "플러그인", (r.plugins || []).join(", ") || "없음"), mk(KeyValue, "일일 루틴", r.routine || "모델 줄 없음"))),
      mk(Panel, "비용 메모", "공식 문서·측정", ...r.notes.map((t) => mk(KeyValue, t))));
  }
}
