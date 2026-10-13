// Codex global setup (TRACE). Read-only: shows what TRACE's own `setup.py verify` and `plan` report; applying stays in Codex.
import { Tab } from "../tab.js";
import { el } from "../dom.js";
import { Badge, Panel, Note, Grid2, KeyValue, Command, Tiles, DocLink, mk } from "../components.js";

const ACTION = { keep: ["ok", "유지"], write: ["warn", "쓰기"], remove: ["warn", "삭제"], conflict: ["bad", "충돌"] };
const action = (a) => Object.hasOwn(ACTION, a) ? ACTION[a] : ["", a]; // own keys only: "constructor" is a plain label
const actionBadge = (a) => { const t = action(a); return mk(Badge, t[0], t[1]); };
const REPO = "https://github.com/DevCrop/ai-setup/tree/main/codex";
const repoLink = () => { const d = el("div"); d.append(mk(DocLink, REPO, "ai-setup/codex")); return d; }; // a bare chip would stretch across the panel
const commands = () => mk(Panel, "적용은 Codex 쪽에서", "이 화면은 읽기 전용",
  mk(Note, "이 레포의 codex/ 폴더에서 실행합니다. apply 전에 plan을 먼저 봅니다."),
  mk(Command, "python -B scripts/setup.py plan"), mk(Command, "python -B scripts/setup.py apply"), mk(Command, "python -B scripts/setup.py verify"),
  repoLink());

export class CodexTab extends Tab {
  static id = "codex";
  static icon = "term";
  draw(v) {
    const c = this.app.inv.codex;
    if (!c || c.loading) { v.replaceChildren(mk(Note, "Codex 셋업 점검을 실행하는 중입니다 (TRACE verify · plan). 잠시 후 다시 그립니다.")); return; }
    if (c.failed) { // the check itself broke: TRACE and the CLI were not looked at, so say neither "없음" nor how to clone
      v.replaceChildren(mk(Tiles, [["TRACE", "?", "warn"], ["Codex CLI", "?", "warn"]]),
        mk(Panel, c.reason || "점검 중 오류", "TRACE와 Codex CLI는 확인하지 못했습니다", mk(Note, "대시보드의 점검 코드가 실패했습니다. 60초 뒤 다시 시도합니다. 계속되면 server.py를 터미널에서 실행해 오류를 확인합니다.")));
      return;
    }
    const cli = c.codex || {}, cliTile = ["Codex CLI", cli.found ? (cli.version || "버전 못 읽음") : "없음", cli.found ? "" : "warn"];
    if (!c.available) {
      v.replaceChildren(
        mk(Tiles, [["TRACE", "없음", "warn"], cliTile]),
        mk(Panel, c.reason || "TRACE 체크아웃을 찾지 못했습니다", (c.tried || []).length ? "찾은 순서: " + c.tried.join(" → ") : "",
          mk(Note, "Codex 셋업은 이 레포의 codex/ 폴더입니다. 폴더가 없으면 이 레포를 최신으로 받습니다."),
          mk(Command, "git pull"),
          repoLink()));
      return;
    }
    const vf = c.verify, pl = c.plan, conflicts = pl ? (pl.counts.conflict || 0) : 0;
    const vTone = !vf ? "warn" : vf.status === "pass" ? "ok" : "bad";
    const tiles = mk(Tiles, [
      ["TRACE 버전", c.version || "?", "acc"],
      ["verify", vf ? vf.status.toUpperCase() : "실행 못 함", vTone],
      ["적용하면 바뀔 파일", pl ? pl.changeCount : "?", pl && pl.changeCount ? "warn" : "ok"],
      ["충돌", pl ? conflicts : "?", conflicts ? "bad" : "ok"],
      cliTile]);
    const verifyPanel = mk(Panel, "verify", "TRACE가 관리하는 파일이 매니페스트와 같은지",
      ...(vf ? [
        mk(KeyValue, "결과", mk(Badge, vTone, vf.status.toUpperCase())),
        ...(vf.errors.length ? vf.errors.map((e) => mk(KeyValue, e, mk(Badge, "bad", "다름"))) : [mk(Note, "관리 파일이 모두 매니페스트와 같습니다.")]),
        ...(vf.errorCount > vf.errors.length ? [mk(Note, "외 " + (vf.errorCount - vf.errors.length) + "건")] : []),
        ...(vf.unmanaged.length ? [el("div", "grp", "TRACE가 관리하지 않는 스킬"), ...vf.unmanaged.map((u) => mk(KeyValue, u, mk(Badge, "info", "검토")))] : []),
        mk(Note, "한계: " + (vf.limit || "TRACE가 밝힌 한계 없음"))]
      : [mk(Note, "verify를 실행하지 못했습니다: " + (c.verifyError || c.error || "원인 불명"))]));
    const planPanel = mk(Panel, "plan", "지금 apply하면 생기는 변화 (실행하지 않음)",
      ...(pl ? [
        mk(KeyValue, "요약", Object.entries(pl.counts).map(([a, n]) => action(a)[1] + " " + n).join(" · ") || "항목 없음"),
        ...(pl.changes.length ? pl.changes.map((r) => mk(KeyValue, r.path, actionBadge(r.action))) : [mk(Note, "바뀔 파일이 없습니다.")]),
        ...(pl.changeCount > pl.changes.length ? [mk(Note, "외 " + (pl.changeCount - pl.changes.length) + "건")] : [])]
      : [mk(Note, "plan을 실행하지 못했습니다: " + (c.planError || c.error || "원인 불명"))]));
    v.replaceChildren(
      mk(Note, "Codex 셋업의 판단 기준은 TRACE 자신의 점검입니다. 이 화면은 그 결과를 그대로 보여주고, 파일을 바꾸지 않습니다. 찾은 곳: " + c.source + " · Codex 홈: " + c.codexHome),
      tiles, mk(Grid2, verifyPanel, planPanel), commands());
  }
}
