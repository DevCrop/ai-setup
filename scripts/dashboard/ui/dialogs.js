// Dialogs and the project table. Each dialog owns its DOM ids and redraws itself from the app state.
import { $, el } from "./dom.js";
import { Badge, DocLink, mk } from "./components.js";
import { docUrl, docLabel } from "./docs.js";

const ACT = { add: ["info", "추가"], fix: ["warn", "수정"], remove: ["bad", "제거"] };

// Project setup table: rows are projects, a row opens its advice. Used by the dialog and by the setup tab.
export class ProjectTable {
  constructor(app) { this.app = app; this.open = new Set(); }
  fill(rowsEl, hintEl) {
    const list = (this.app.last && this.app.last.projects) || [], b = (t, x) => mk(Badge, t, x);
    hintEl.textContent = list.length ? "읽기 전용: 파일 유무·줄 수·설정 키·스크립트 이름만 읽고 파일 내용은 보내지 않습니다. 행을 누르면 무엇을 추가·수정·제거할지 나옵니다." : "추적할 프로젝트가 없습니다. state/projects.txt에 경로를 한 줄씩 적거나 PROJECT_DIRS를 지정하세요.";
    const head = el("div", "row proj head"); ["프로젝트", "지침", "Claude 연결", "settings", "규칙", "개선"].forEach((t) => head.append(el("span", null, t)));
    const nodes = [];
    list.forEach((p) => {
      const cs = p.checks || [], bad = cs.filter((c) => c.level === "bad").length;
      const r = el("button", "row proj"); r.type = "button"; r.setAttribute("aria-expanded", this.open.has(p.name)); r.append(el("span", "nm", p.name));
      if (!p.found || p.error) { r.append(b("bad", p.error ? "읽기 실패" : "경로 없음")); nodes.push(r); return; }
      r.append(p.agents ? b("ok", "AGENTS " + p.agentsLines) : b("info", "AGENTS 없음"));
      r.append(!p.claude ? b(p.agents ? "ok" : "warn", p.agents ? "AGENTS 직접" : "지침 없음") : p.imports ? b("ok", "@AGENTS") : p.agents ? b("bad", "import 없음") : b(p.claudeLines > 200 ? "warn" : "ok", "CLAUDE " + p.claudeLines));
      r.append(!p.settings ? b("warn", "없음") : p.defaultMode ? b("bad", "bypass 모드") : p.denyEnv ? b("ok", ".env deny") : b("warn", "deny 없음"));
      r.append(b(p.rules ? "info" : "", p.rules + "개"));
      r.append(cs.length ? b(bad ? "bad" : "warn", cs.length + "건") : b("ok", "충족"));
      r.onclick = () => { this.open.has(p.name) ? this.open.delete(p.name) : this.open.add(p.name); this.fill(rowsEl, hintEl); };
      nodes.push(r);
      if (!this.open.has(p.name)) return;
      const box = el("div", "adv");
      cs.length || box.append(el("div", "empty", "확인한 모든 항목이 모범 사례를 따릅니다."));
      cs.forEach((c) => {
        const it = el("div", "it"), t = el("div", null); t.append(b(ACT[c.act][0], ACT[c.act][1]), el("b", null, " " + c.what));
        it.append(t, el("div", "muted", "왜: " + c.why), el("div", null, "조치: " + c.fix), mk(DocLink, docUrl(c.src), docLabel(c.src) + " · " + c.src));
        box.append(it);
      });
      nodes.push(box);
    });
    rowsEl.replaceChildren(...(list.length ? [head, ...nodes] : []));
  }
}

export function aoText(s) {
  const a = s.ao || {}; if (!a.available) return "ao CLI를 찾지 못했습니다 (AO_BIN으로 경로를 지정할 수 있습니다).";
  const head = "daemon " + ((a.daemon || {}).state || "?") + " · port " + ((a.daemon || {}).port || "?") + " · uptime " + ((a.daemon || {}).uptime || "?") + " · projects " + (a.projects || []).join(", ") + "\n\n";
  return head + (a.sessions || []).map((x) => [x.id, x.role, x.status + "/" + x.activity, x.branch || "-",
    (x.prs || []).map((p) => "#" + p.number + " ci=" + p.ci + " review=" + (p.verdict || p.review)).join(" ") || "-", x.lastActivityAt || ""].join(" | ")).join("\n");
}

// Project setup dialog (header button).
export class ProjectDialog {
  constructor(app) {
    this.app = app; this.dlg = $("pdlg"); this.table = app.projects;
    $("projBtn").onclick = () => { this.fill(); this.dlg.showModal(); };
    $("pdlgClose").onclick = () => this.dlg.close();
  }
  fill() { this.table.fill($("projRows"), $("projHint")); }
  refresh() { if (this.dlg.open) this.fill(); }
}

// Code-style log viewer: line numbers, level colouring, `code` spans, filter chips and copy. Text only (no innerHTML).
export class LogDialog {
  constructor(app) {
    this.app = app; this.dlg = $("dlg"); this.tab = "v"; this.filter = "ALL";
    $("logsBtn").onclick = () => { this.fill(); this.dlg.showModal(); };
    $("dlgClose").onclick = () => this.dlg.close();
    [["tabV", "v"], ["tabR", "r"], ["tabA", "a"]].forEach(([id, k]) => { $(id).onclick = () => { this.tab = k; this.fill(); }; });
  }
  refresh() { if (this.dlg.open) this.fill(); }
  tokens(text, parent) {
    text.split(/(`[^`]+`|\b(?:OUTDATED|FAIL|WARN|PASS|BLOCKED|EXPOSED)\b)/).forEach((t) => {
      if (!t) return; if (t[0] === "`" && t.length > 2) parent.append(el("span", "t-code", t.slice(1, -1)));
      else if (t === "FAIL" || t === "BLOCKED" || t === "EXPOSED") parent.append(el("span", "t-bad", t)); else if (t === "WARN" || t === "OUTDATED") parent.append(el("span", "t-warn", t)); else if (t === "PASS") parent.append(el("span", "t-ok", t));
      else parent.append(document.createTextNode(t));
    });
  }
  line(n, raw, kind, lv) {
    const row = el("div", "ln" + (lv === "FAIL" || lv === "WARN" ? " is-" + lv : "")), tx = el("div", "tx"); row.append(el("div", "no", String(n)), tx);
    const m = /^(FAIL|WARN|PASS)\s+(.*)$/.exec(raw);
    if (kind === "log" && m) { tx.append(el("span", "lv lv-" + m[1], m[1])); this.tokens(m[2], tx); }
    else if (kind === "md") { if (/^#{1,6}\s/.test(raw)) tx.append(el("span", "t-h", raw)); else if (/^\s*\|/.test(raw)) tx.append(el("span", "t-cell", raw)); else if (/^\s*(---|===)/.test(raw)) tx.append(el("span", "t-dim", raw)); else this.tokens(raw, tx); }
    else if (kind === "ao") { raw.split(" | ").forEach((c, i) => { if (i) tx.append(el("span", "t-dim", " │ ")); this.tokens(c, tx); }); }
    else this.tokens(raw, tx);
    return row;
  }
  fill() {
    const tab = this.tab, last = this.app.last;
    $("tabV").setAttribute("aria-pressed", tab === "v"); $("tabR").setAttribute("aria-pressed", tab === "r"); $("tabA").setAttribute("aria-pressed", tab === "a");
    const box = $("dlgPre"), chips = $("dlgChips"); if (!last) { box.replaceChildren(el("div", "empty", "데이터를 기다리는 중")); return; }
    const lines = tab === "v" ? last.verify.lines : tab === "a" ? aoText(last).split("\n") : (((last.reports[0] || {}).text) || "보고서가 아직 없습니다.").split("\n");
    const kind = tab === "v" ? "log" : tab === "a" ? "ao" : "md", lvl = (l) => (/^(FAIL|WARN|PASS)\b/.exec(l) || [])[1] || (tab === "v" ? "" : /\b(FAIL|OUTDATED|BLOCKED|EXPOSED)\b/.test(l) ? "FAIL" : /\bWARN\b/.test(l) ? "WARN" : "");
    const cnt = { ALL: lines.length, FAIL: 0, WARN: 0, PASS: 0 }; lines.forEach((l) => { const k = lvl(l); if (k === "FAIL") cnt.FAIL++; else if (k === "WARN") cnt.WARN++; else if (k === "PASS") cnt.PASS++; });
    if (!cnt[this.filter]) this.filter = "ALL";
    chips.replaceChildren(...["ALL", "FAIL", "WARN", "PASS"].filter((k) => k === "ALL" || cnt[k]).map((k) => { const b = el("button", "chip", k + " " + cnt[k]); b.type = "button"; b.setAttribute("aria-pressed", String(this.filter === k)); b.addEventListener("click", () => { this.filter = k; this.fill(); }); return b; }));
    const rows = []; lines.forEach((l, i) => { const k = lvl(l); if (this.filter === "ALL" || k === this.filter) rows.push(this.line(i + 1, l, kind, k)); });
    box.replaceChildren(...(rows.length ? rows : [el("div", "empty", "표시할 줄이 없습니다.")]));
    $("dlgMeta").textContent = rows.length + " / " + lines.length + "줄";
    $("dlgCopy").onclick = () => { const t = lines.join("\n"); (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => { $("dlgCopy").textContent = "복사됨"; setTimeout(() => { $("dlgCopy").textContent = "복사"; }, 1200); }, () => { $("dlgCopy").textContent = "복사 불가"; }); };
  }
}

// Fix dialog: preview first, apply only the previewed targets (the server refuses anything else).
export class FixDialog {
  constructor(app) {
    this.app = app; this.dlg = $("fixdlg");
    $("fixClose").addEventListener("click", () => { this.dlg.close(); if (app.curTab === "log") app.show("log"); });
  }
  get isOpen() { return this.dlg.open; }
  open(fixId) {
    const dlg = this.dlg, go = $("fixGo"), api = this.app.api, token = () => (this.app.last || {}).token || "";
    $("fixRes").textContent = ""; $("fixTargets").replaceChildren(); go.disabled = true; $("fixTitle").textContent = "조치 확인"; $("fixNote").textContent = "불러오는 중…";
    if (!dlg.open) dlg.showModal();
    api.fix({ id: fixId, action: "preview" }, token()).then((pv) => {
      $("fixTitle").textContent = pv.title || "조치 확인";
      if (!pv.ok || !(pv.targets || []).length) { $("fixNote").textContent = pv.msg || "할 일이 없습니다."; return; }
      $("fixNote").textContent = (pv.reversible ? "되돌릴 수 있는 변경입니다(설정 파일 백업 생성)." : "되돌릴 수 없습니다. 아래 대상만 삭제됩니다.") + " 확인 후 실행을 누르세요.";
      $("fixTargets").replaceChildren(...pv.targets.map((t) => { const r = el("div", "row chk"); r.append(mk(Badge, pv.reversible ? "info" : "warn", pv.reversible ? "변경" : "삭제"), el("span", "t nm", t)); return r; }));
      go.disabled = false;
      go.onclick = async () => {
        go.disabled = true;
        try { const res = await api.fix({ id: fixId, action: "apply", targets: pv.targets }, token()); $("fixRes").textContent = (res.ok ? "완료: " : "실패: ") + (res.msg || ""); $("fixRes").style.color = res.ok ? "var(--ok)" : "var(--bad)"; }
        catch (e) { $("fixRes").textContent = "요청 실패 (" + e.message + ")"; }
        this.app.tick();
      };
    }).catch((e) => { $("fixNote").textContent = "요청 실패 (" + e.message + "). 대시보드를 새로고침하세요."; });
  }
}
