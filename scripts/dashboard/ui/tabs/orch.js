import { Tab } from "../tab.js";
import { el } from "../dom.js";
import { Badge, Panel, Note, Grid2, KeyValue, Fold, Tiles, Card, CardGrid, mk } from "../components.js";
import { DelegationFlow, DelegationStates } from "../diagrams.js";

export class OrchTab extends Tab {
  static id = "orch";
  static icon = "flow";
  draw(v) {
    const { inv, agent } = this.app, o = inv.orchestration, gates = el("div", "chips"), L = o.limits || {}, n = (v) => (v == null ? "?" : String(v));
    o.format.forEach((t) => gates.append(mk(Badge, "info", t)));
    const aux = [["explorer", "넓은 검색 전용(읽기 전용). 질문 하나에 10줄 이내로 답합니다."], ["worker", "다른 역할에 맞지 않는 독립된 단일 변경을 브리프대로 구현합니다."]]
      .map(([nm, t]) => mk(Card, nm + " · " + agent(nm).model, el("p", null, t)));
    aux.push(mk(Card, "AO (Orchestrator.inc)", el("p", null, "파일 범위가 겹치지 않는 긴 병렬 작업에만. 완료 기준과 push 금지는 --agent-rules에, push와 머지는 사람이 합니다.")));
    v.replaceChildren(
      mk(Tiles, [["에이전트", inv.agents.length, "acc"], ["규칙", o.rules.length, ""], ["동시 위임 상한", n(L.delegates), ""], ["재시도 상한", n(L.retries), "warn"]]),
      mk(Panel, "위임 흐름", "메인이 조율하고, 서브에이전트의 보고는 증거 확인 전까지 주장", mk(DelegationFlow, this.app), mk(Note, "\"돌려받음\"은 증거 확인 전까지 주장입니다. 모델·effort는 agents/*.md와 settings.json의 값입니다.")),
      mk(Panel, "위임 하나의 상태", "UML 상태 다이어그램", mk(DelegationStates, this.app)),
      mk(Grid2, mk(Panel, "브리프와 한도", "skills/orchestrate", gates, mk(Note, "동시 위임 최대 " + n(L.delegates) + "개 · 같은 파일 동시 수정 금지 · 같은 오류 " + n(L.retries) + "회 후 중단.")), mk(Panel, "보조 경로", "필요할 때만", mk(CardGrid, aux))),
      mk(Fold, "규칙 전문 " + o.rules.length + "개", o.rules.map((t) => mk(KeyValue, t))),
      mk(Fold, "무엇을 건드리면 어느 에이전트인가 (" + o.routes.length + ")", o.routes.map((x) => mk(KeyValue, x.part, mk(Badge, "accent", x.agent)))));
  }
}
