// Live monitoring: KPIs, pipeline, activity, events, AO workers, tool checks, history, alerts. Updated in place on every state tick.
import { Tab } from "../tab.js";
import { $, el, ago, hms } from "../dom.js";
import { Badge, Kpi, mk } from "../components.js";

const WRITE = new Set(["Edit", "Write", "NotebookEdit"]), READ = new Set(["Read", "Grep", "Glob", "ToolSearch", "WebFetch", "WebSearch"]);
const AOACT = { active: ["info", "ACTIVE"], idle: ["ok", "IDLE"], blocked: ["bad", "BLOCKED"], exited: ["", "EXITED"] };
const VERD = { approved: ["ok", "APPROVED"], changes_requested: ["bad", "CHANGES"] };
const toolTone = (e) => e.kind === "user" ? "ok" : WRITE.has(e.name) ? "accent" : e.name === "Bash" ? "warn" : READ.has(e.name) ? "" : "info";
const badge = (tone, text, pip) => mk(Badge, tone, text, pip);

function activeNode(events, now) {
  for (const e of events.filter((e) => now - new Date(e.at).getTime() < 90000).slice(-6).reverse()) {
    const t = (e.target || "").toLowerCase();
    if (/verify\.sh|qa-deny/.test(t)) return "verify"; if (/apply\.sh/.test(t)) return "apply";
    if (/gh pr merge|git merge/.test(t)) return "merge"; if (/gh pr|git push/.test(t)) return "pr";
    if (WRITE.has(e.name) || /git (add|commit|checkout|switch)/.test(t)) return "edit";
  }
  return null;
}

export class MonitorTab extends Tab {
  static id = "monitor";
  static icon = "activity";
  constructor(app) { super(app); this.seen = new Set(); this.firstEvents = true; }
  get needsInventory() { return false; }
  draw() { this.app.charts.reset(); if (this.app.last) this.onState(this.app.last); } // charts measured while hidden had the wrong size
  onState(s) { this.render(s); }

  render(s) {
    const now = new Date(s.now).getTime(), ctx = this.context(s, now);
    $("branch").textContent = s.git.branch || "—";
    $("mode").textContent = "mode " + (s.settings.liveMode || "default"); $("mode").className = "badge " + (s.settings.liveMode === "bypassPermissions" ? "warn" : "accent");
    this.kpis(s, ctx, now); this.pipeline(s, ctx, now); this.activity(s, ctx, now); this.events(s, ctx);
    this.aoWorkers(s, ctx, now); this.toolChecks(s); this.history(s, ctx, now); this.alerts(s, ctx);
  }

  // facts derived once per tick and shared by the panels
  context(s, now) {
    const prs = s.prs || [], ev = s.activity.events, ao = s.ao || { available: false }, aoS = ao.sessions || [], aoLive = aoS.filter((x) => !x.isTerminated);
    const v = s.verify.counts;
    return {
      v, st: s.settings, g: s.git, prs, ev, rep: (s.reports || [])[0], ao, aoS, aoLive,
      open: prs.filter((p) => p.state === "OPEN").length, merged: prs.filter((p) => p.state === "MERGED").length,
      health: v.FAIL ? "bad" : v.WARN ? "warn" : "ok", healthTxt: v.FAIL ? "FAIL" : v.WARN ? "WARN" : "PASS",
      tools: ev.filter((e) => e.kind === "tool"),
      aoBlocked: aoLive.filter((x) => x.activity === "blocked"),
      aoDown: ao.available && (ao.daemon || {}).state !== "ready" && (ao.daemon || {}).state !== "loading",
    };
  }

  kpis(s, c, now) {
    const { v, st, prs, ao, aoS, aoLive, aoBlocked, aoDown } = c;
    const recent = c.tools.filter((e) => now - new Date(e.at).getTime() < 600000).length, rulesOk = st.deny === st.liveDeny && st.ask === st.liveAsk;
    const aoPrs = aoS.flatMap((x) => x.prs || []), aoOk = aoPrs.filter((p) => p.verdict === "approved").length, aoActive = aoLive.some((x) => x.activity === "active");
    const k = (...a) => mk(Kpi, ...a);
    const aoKpi = !ao.available ? k("", "AO", "N/A", "—", "", "ao CLI를 찾지 못함")
      : aoDown ? k("bad", "AO", "DOWN", "—", "", "데몬 " + ((ao.daemon || {}).state || "?"))
      : k(aoBlocked.length ? "bad" : aoActive ? "info" : aoLive.length ? "ok" : "", "AO", aoBlocked.length ? "BLOCKED" : aoActive ? "ACTIVE" : aoLive.length ? "IDLE" : "NO SESSION", String(aoLive.length), "실행 세션", "전체 " + aoS.length + " · PR 승인 " + aoOk + "/" + aoPrs.length);
    $("kpis").replaceChildren(
      k(c.health, "설정 상태", c.healthTxt, v.FAIL + " FAIL", v.WARN + " WARN", "PASS " + v.PASS + " · " + ago(s.verify.at, now)),
      k(rulesOk ? "ok" : "warn", "권한 규칙", rulesOk ? "SYNCED" : "DRIFT", st.liveDeny + " / " + st.liveAsk, "deny / ask", "repo " + st.deny + " / " + st.ask),
      k(c.open ? "warn" : "ok", "PR", c.open ? c.open + " OPEN" : "CLEAR", String(c.merged), "머지됨", "최근 " + prs.length + "개 기준"),
      k(recent ? "info" : "", "최근 10분", recent ? "ACTIVE" : "IDLE", String(recent), "도구 호출", s.activity.session ? "세션 " + s.activity.session : "세션 로그 없음"),
      aoKpi);
  }

  pipeline(s, c, now) {
    const { v, st, g, ev, rep, open } = c, act = activeNode(ev, now), lastMerge = g.commits.find((x) => x.pr);
    const rulesOk = st.deny === st.liveDeny && st.ask === st.liveAsk;
    const tuneOk = JSON.stringify(st.tune) === JSON.stringify(st.liveTune) && JSON.stringify(st.plugins) === JSON.stringify(st.livePlugins);
    const sync = st.mode === st.liveMode && rulesOk && tuneOk;
    const steps = [
      ["edit", "수정", "claude/", g.dirty ? "변경 " + g.dirty + "건" : "깨끗함", g.dirty ? ["warn", "DIRTY"] : ["ok", "CLEAN"]],
      ["pr", "PR", "branch → GitHub", open + "개 열림", open ? ["warn", "OPEN"] : ["ok", "CLEAR"]],
      ["merge", "머지", "main", lastMerge ? "#" + lastMerge.pr + " · " + ago(lastMerge.at, now) : "—", ["ok", "DONE"]],
      ["apply", "적용", "apply.sh", sync ? "repo = live" : "repo ≠ live", sync ? ["ok", "SYNCED"] : ["bad", "DRIFT"]],
      ["live", "적용된 설정", "~/.claude", st.liveMode || "—", st.liveMode === "bypassPermissions" ? ["warn", "BYPASS"] : st.liveMode === "auto" ? ["accent", "AUTO"] : ["info", "DEFAULT"]],
      ["verify", "검증", "verify.sh", v.FAIL + " FAIL · " + v.WARN + " WARN", [c.health, c.healthTxt]],
      ["routine", "루틴", "매일 09:03", rep ? rep.name.replace(".md", "") : "—", rep ? ["ok", "RAN"] : ["warn", "NONE"]],
      ["report", "보고서", "reports/", (s.reports || []).length + "개", (s.reports || []).length ? ["info", "SAVED"] : ["", "EMPTY"]],
    ];
    $("pipe").replaceChildren(...steps.map(([id, nm, wh, vl, [tone, txt]]) => {
      const d = el("div", "step" + (id === act ? " active" : "")), n = el("div", "nm"); n.append(el("span", null, nm), id === act ? badge("accent", "NOW", true) : badge(tone, txt));
      d.append(n, el("div", "vl", vl), el("div", "wh", wh)); return d;
    }));
  }

  activity(s, c, now) {
    $("sessionNote").textContent = s.activity.session ? "마지막 기록 " + ago(s.activity.mtime, now) : "세션 로그 없음";
    const perMin = new Array(30).fill(0);
    c.tools.forEach((e) => { const m = Math.floor((now - new Date(e.at).getTime()) / 60000); if (m >= 0 && m < 30) perMin[29 - m]++; });
    this.app.charts.get("perMin", 30, "분당 도구 호출 수", [[0, "start", "-30분"], [14, "middle", "-15분"], [29, "end", "지금"]]).update(perMin, perMin.map((_, i) => (29 - i) + "분 전"), "회");
    const mix = {}; c.tools.forEach((e) => { mix[e.name] = (mix[e.name] || 0) + 1; });
    const top = Object.entries(mix).sort((a, b) => b[1] - a[1]), shown = top.slice(0, 4), rest = top.slice(4).reduce((a, b) => a + b[1], 0);
    if (rest) shown.push(["기타", rest]);
    const tot = shown.reduce((a, b) => a + b[1], 0) || 1, ops = [1, .75, .55, .4, .25];
    const bar = $("mixBar"); while (bar.children.length < shown.length) bar.append(el("i")); while (bar.children.length > shown.length) bar.lastChild.remove();
    shown.forEach(([, n], i) => { bar.children[i].style.width = (n / tot) * 100 + "%"; bar.children[i].style.opacity = ops[i]; });
    $("mixLegend").replaceChildren(...(shown.length ? shown.map(([n, k], i) => { const s2 = el("span"), d = el("span", null, "● "); d.style.color = "var(--accent)"; d.style.opacity = ops[i]; s2.append(d, document.createTextNode(n), el("b", "num", String(k))); return s2; }) : [el("span", "muted", "최근 도구 호출이 없습니다.")]));
  }

  // only rows not seen before animate in
  events(s, c) {
    const ev = c.ev;
    $("stream").replaceChildren(...(ev.length ? ev.slice(-8).reverse().map((e) => {
      const key = e.at + e.name + e.target, isNew = !this.seen.has(key) && !this.firstEvents; this.seen.add(key);
      const r = el("div", "row ev" + (isNew ? " new" : "")); r.append(el("time", null, hms(e.at)), badge(toolTone(e), e.kind === "user" ? "사용자" : e.name), el("span", "t muted", e.target)); return r;
    }) : [el("div", "empty", "세션 로그에서 이벤트를 찾지 못했습니다.")]));
    this.firstEvents = false;
  }

  // running first, newest first; the full list is in the dialog
  aoWorkers(s, c, now) {
    const { ao, aoS, aoLive, aoDown } = c;
    const rows = [...aoLive, ...aoS.filter((x) => x.isTerminated)].slice(0, 6).map((x) => {
      const [tone, txt] = AOACT[x.activity] || ["info", String(x.activity || x.status).toUpperCase()];
      const r = el("div", "row aw" + (x.isTerminated ? " gone" : "")), t = el("span", "t"); t.title = x.id + " · " + (x.branch || "");
      t.append(el("b", null, x.id), document.createTextNode(x.displayName || ""));
      const ch = el("span", "chips");
      (x.prs || []).slice(0, 2).forEach((p) => {
        ch.append(badge(p.ci === "passing" ? "ok" : p.ci === "failing" ? "bad" : "warn", "#" + p.number + " CI"));
        const v2 = VERD[p.verdict]; if (v2) ch.append(badge(v2[0], v2[1]));
      });
      if (!ch.children.length && x.lastActivityAt) ch.append(el("span", "muted", ago(x.lastActivityAt, now)));
      r.append(badge(tone, txt, x.activity === "active"), t, ch); return r;
    });
    $("aoNote").textContent = !ao.available ? "ao 없음" : aoDown ? "데몬 " + ((ao.daemon || {}).state || "?") : aoLive.length + " 실행 · " + (aoS.length - aoLive.length) + " 종료 · 데몬 " + (ao.daemon || {}).state;
    $("aoRows").replaceChildren(...(rows.length ? rows : [el("div", "empty", ao.available ? "AO 세션이 없습니다." : "AO를 찾지 못했습니다.")]));
  }

  toolChecks(s) {
    const tl = (s.tools || []).filter((x) => x.level !== "na"), bad = tl.filter((x) => x.level === "bad" || x.level === "warn");
    $("toolNote").textContent = bad.length ? bad.length + "건 확인 필요" : tl.length + "개 정상";
    $("toolRows").replaceChildren(...tl.map((x) => { const r = el("div", "row chk"), t = el("span", "t", x.group + " · " + x.name + " — " + x.detail + (x.fix ? " ▶ 조치: " + x.fix : "")); t.title = t.textContent; if (x.fix) t.style.whiteSpace = "normal"; r.append(badge(x.level, x.level === "ok" ? "OK" : x.level === "bad" ? "FAIL" : "WARN"), t); return r; }));
  }

  history(s, c, now) {
    $("prNote").textContent = c.open + " 열림 · " + c.merged + " 머지";
    const list = c.prs.slice(0, 5).map((p) => {
      const r = el("div", "row pr"), d = el("span", "d"); d.append(el("span", "add", "+" + p.additions), document.createTextNode(" "), el("span", "del", "−" + p.deletions));
      r.append(el("span", "num muted", "#" + p.number), badge(p.state === "OPEN" ? "warn" : "ok", p.state === "OPEN" ? "OPEN" : "MERGED"), el("span", "t", p.title), d); return r;
    });
    $("prs").replaceChildren(...(list.length ? list : [el("div", "empty", "PR 기록이 없습니다.")]));
    const days = new Array(14).fill(0), lb = [], d0 = new Date(now); d0.setHours(0, 0, 0, 0);
    c.g.commits.forEach((x) => { const d = Math.floor((d0.getTime() - new Date(x.at).setHours(0, 0, 0, 0)) / 86400000); if (d >= 0 && d < 14) days[13 - d]++; });
    for (let i = 13; i >= 0; i--) { const d = new Date(d0.getTime() - i * 86400000); lb.push((d.getMonth() + 1) + "/" + d.getDate()); }
    this.app.charts.get("perDay", 14, "날짜별 커밋 수", [[0, "start", lb[0]], [7, "middle", lb[7]], [13, "end", lb[13]]]).update(days, lb, "개");
  }

  // only what needs attention; the full text is in the dialog
  alerts(s, c) {
    const items = [], { ao, aoLive, aoBlocked, aoDown, rep, v } = c;
    s.verify.lines.filter((l) => /^(FAIL|WARN)/.test(l)).forEach((l) => items.push([l.split(" ")[0] === "FAIL" ? "bad" : "warn", l.split(" ")[0], l.replace(/^(FAIL|WARN)\s+/, "")]));
    if (aoDown) items.push(["bad", "AO DOWN", "AO 데몬 상태 " + ((ao.daemon || {}).state || "?")]);
    (s.tools || []).filter((x) => x.level === "bad").forEach((x) => items.push(["bad", x.group.toUpperCase(), x.name + " · " + x.detail]));
    aoBlocked.forEach((x) => items.push(["bad", "BLOCKED", x.id + " · 사용자 입력 대기"]));
    aoLive.flatMap((x) => x.prs || []).filter((p) => p.verdict === "changes_requested").forEach((p) => items.push(["warn", "REVIEW", "PR #" + p.number + " 수정 요청"]));
    ((rep || {}).text || "").split("\n").filter((l) => /OUTDATED/.test(l)).forEach((l) => items.push(["info", "UPDATE", l.split("|")[0].trim() + " · 업데이트 필요"]));
    $("chkNote").textContent = items.length ? items.length + "건" : "이상 없음";
    const rows = items.slice(0, 5).map(([tone, b, t]) => { const r = el("div", "row chk"), x = el("span", "t", t); x.title = t; r.append(badge(tone, b), x); return r; });
    if (!rows.length) { const r = el("div", "row chk"); r.append(badge("ok", "PASS"), el("span", "t", "검증 " + v.PASS + "개 통과, 알림 없음")); rows.push(r); }
    $("checks").replaceChildren(...rows);
  }
}
