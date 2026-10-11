import { Tab } from "../tab.js";
import { Badge, Panel, Grid2, KeyValue, Tiles, IconCard, CardGrid, mk } from "../components.js";

export class FeatTab extends Tab {
  static id = "feat";
  static icon = "list";
  draw(v) {
    const inv = this.app.inv, f = inv.features, cards = (items, ic) => mk(CardGrid, items.map((it) => mk(IconCard, it.name, it.desc, ic)));
    v.replaceChildren(
      mk(Tiles, [["에이전트", f.agents.length, "acc"], ["스킬", f.skills.length, "acc"], ["스크립트", f.scripts.length, ""], ["deny 규칙", f.deny, "warn"], ["ask 규칙", f.ask, ""], ["훅", f.hooks.length, "ok"]]),
      mk(Grid2,
        mk(Panel, "권한 · 훅", "settings.json", mk(KeyValue, "기본 모드", mk(Badge, "accent", f.mode || "?")), ...Object.entries(f.denyKinds).map(([k, n]) => mk(KeyValue, "deny · " + k, n + "개")), ...f.hooks.map((h) => mk(KeyValue, "PreToolUse 훅", h))),
        mk(Panel, "플러그인 · 기타", "", ...f.plugins.map((p) => mk(KeyValue, "플러그인", p)), mk(KeyValue, "상태줄", f.statusLine || "없음"), mk(KeyValue, "대시보드 화면", f.dashboard.join(" · ")))),
      mk(Panel, "스킬 " + f.skills.length, "claude/skills/", cards(f.skills, "star")),
      mk(Panel, "에이전트 " + inv.agents.length, "claude/agents/", cards(inv.agents.map((a) => ({ name: a.name + " · " + a.model, desc: a.desc })), "bot")),
      mk(Panel, "스크립트 " + f.scripts.length, "scripts/", cards(f.scripts, "term")),
      mk(Panel, "일일 루틴 단계 " + f.routine.length, "", ...f.routine.map((t) => mk(KeyValue, t))));
  }
}
