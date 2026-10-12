// Tool efficiency: every number carries where it came from (measured / estimated / unavailable); nothing here is a guess.
import { Tab } from "../tab.js";
import { el } from "../dom.js";
import { Badge, Panel, Note, Grid2, KeyValue, mk } from "../components.js";
import { UsagePanel } from "../usage-panel.js";

const BASIS = { measured: ["ok", "측정"], estimated: ["info", "추정"], unavailable: ["warn", "측정 불가"] };

export class EffTab extends Tab {
  static id = "eff";
  static icon = "bars";
  draw(v) {
    const e = this.app.inv.efficiency;
    if (!e) { v.replaceChildren(mk(Note, "효율 데이터를 읽지 못했습니다.")); return; }
    const cards = e.sources.map((s) => {
      const body = [];
      s.metrics.forEach((m) => { const t = BASIS[m.basis] || ["", m.basis], r = el("span"); r.append(document.createTextNode(m.value + " "), mk(Badge, t[0], t[1])); body.push(mk(KeyValue, m.label, r, m.note)); });
      s.caveats.forEach((c) => body.push(mk(Note, "한계: " + c)));
      if (s.ideas.length) { body.push(el("div", "grp", "개선안")); s.ideas.forEach((i) => body.push(mk(Note, "→ " + i))); }
      return mk(Panel, s.title, "", ...body);
    });
    const u = e.sources.find((s) => s.name === "usage" && s.data);
    v.replaceChildren(...(u ? [new UsagePanel(u.data).render()] : []), mk(Note, "도구가 스스로 센 값과 파일에서 읽은 값만 씁니다. '측정 불가'는 이 화면에서 읽을 방법이 없다는 뜻이며 값을 짐작해 채우지 않았습니다."), mk(Grid2, ...cards));
  }
}
