// UI QA for the dashboard: drives a real headless Chrome over the DevTools protocol (no extra packages, Node 22+).
// Usage: node scripts/qa-ui.mjs <base-url> <chrome-path>. Exit code = number of failures.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [base, chrome] = [process.argv[2], process.argv[3]];
const port = 9300 + Math.floor(Math.random() * 500), dir = mkdtempSync(join(tmpdir(), "qa-ui-"));
// Chrome refuses to start as root (containers, some CI images) without --no-sandbox; every other user keeps the sandbox.
const root = typeof process.getuid === "function" && process.getuid() === 0;
const proc = spawn(chrome, ["--headless=new", "--disable-gpu", "--no-first-run", ...(root ? ["--no-sandbox"] : []), `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (ok, name, detail = "") => { console.log((ok ? "PASS  " : "FAIL  ") + name + (ok ? "" : detail ? " — " + detail : "")); if (!ok) fails++; };

async function connect() {
  for (let i = 0; i < 60; i++) {
    try { const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json(); return t.webSocketDebuggerUrl; } catch { await sleep(250); }
  }
  throw new Error("Chrome did not start");
}
const ws = new WebSocket(await connect());
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(), problems = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); return; }
  if (d.method === "Runtime.exceptionThrown") problems.push("exception: " + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") problems.push("console.error: " + d.params.args.map((a) => a.value ?? a.description).join(" "));
  if (d.method === "Network.responseReceived" && d.params.response.status >= 400) problems.push("HTTP " + d.params.response.status + " " + d.params.response.url);
  if (d.method === "Network.loadingFailed" && !d.params.canceled) problems.push("request failed: " + d.params.errorText);
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "eval failed"); return r.result.result.value; };
// Poll a page expression until it is truthy (or give up after ms): waits for the thing a check needs instead of a fixed sleep.
const waitFor = async (expr, ms = 8000, step = 100) => { const t0 = Date.now(); for (;;) { try { if (await ev(expr)) return true; } catch {} if (Date.now() - t0 > ms) return false; await sleep(step); } };
const go = async (url, w = 1280, h = 900) => { await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 700 }); await send("Page.navigate", { url }); await sleep(300); await waitFor(`document.body.classList.contains("loaded")`, 20000); };
for (const d of ["Page", "Runtime", "Network"]) await send(d + ".enable");

const TABS = ["monitor", "dbg", "orch", "route", "feat", "eff", "prac", "log", "setup"];
const clickTab = async (t) => { await ev(`document.querySelector('.side button[data-tab="${t}"]').click()`); await sleep(1200); };

// colors: Claude palette has no blue/purple; scan every visible element's text, fill and border colors
const HUE_SCAN = `(() => {
  const bad = [], seen = new Set();
  const hue = (c) => { const m = c.match(/rgba?\\(([\\d.]+)[, ]+([\\d.]+)[, ]+([\\d.]+)(?:[, /]+([\\d.]+))?/); if (!m) return null; const [r, g, b] = [m[1], m[2], m[3]].map((x) => x / 255), a = m[4] === undefined ? 1 : +m[4];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (a < .2 || d < .12 || mx < .15) return null; let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = (h * 60 + 360) % 360; return { h, s: d / (mx || 1) }; };
  document.querySelectorAll("body *").forEach((e) => { const s = getComputedStyle(e); if (s.display === "none" || s.visibility === "hidden") return;
    for (const p of ["color", "backgroundColor", "borderTopColor", "fill", "stroke"]) { const v = s[p]; if (!v || seen.has(p + v)) continue; const h = hue(v); if (h && h.h > 195 && h.h < 300 && h.s > .18) { seen.add(p + v); bad.push(p + " " + v + " on <" + e.tagName.toLowerCase() + " class=" + (e.getAttribute("class") || "") + ">"); } } });
  return bad.slice(0, 5);
})()`;

console.log("== load and tabs");
await go(base + "/#monitor");
let loaded = false;
for (let i = 0; i < 40 && !loaded; i++) { loaded = await ev(`document.body.classList.contains("loaded")`); if (!loaded) await sleep(500); }
check(loaded, "first state arrived (body.loaded)");
for (const t of TABS) {
  await clickTab(t);
  const info = await ev(`(() => { const v = document.getElementById("v-${t}"); return { shown: !v.hidden, kids: v.children.length, text: v.innerText.length, cur: document.querySelector('.side button[aria-current="page"]')?.dataset.tab }; })()`);
  check(info.shown && info.kids > 0 && info.text > 20 && info.cur === t, `tab ${t} renders`, JSON.stringify(info));
}
check(problems.length === 0, "no console errors, exceptions or failed requests while loading all tabs", problems.slice(0, 3).join(" | "));

console.log("== layout");
for (const [w, h] of [[1280, 900], [900, 800], [390, 800]]) {
  await go(base + "/#monitor", w, h);
  for (const t of TABS) {
    await clickTab(t);
    const o = await ev(`(() => { const d = document.scrollingElement, v = document.getElementById("v-${t}"); const wide = [...v.querySelectorAll("*")].filter((e) => e.getBoundingClientRect().right > innerWidth + 1 && !e.closest(".dia, .code, pre, .rows .row.proj, .chart")).slice(0, 3).map((e) => e.tagName + "." + e.className); return { x: d.scrollWidth - d.clientWidth, wide }; })()`);
    check(o.x <= 1 && o.wide.length === 0, `${w}px ${t}: no horizontal overflow`, JSON.stringify(o));
  }
}

console.log("== colors and links");
await go(base + "/#prac");
for (const scheme of ["dark", "light"]) {
  await ev(`document.documentElement.dataset.theme = "${scheme}"`); await sleep(400);
  for (const t of ["monitor", "dbg", "orch", "route", "feat", "eff", "prac", "log", "setup"]) {
    await clickTab(t);
    const bad = await ev(HUE_SCAN);
    check(bad.length === 0, `${scheme} ${t}: no blue/purple`, bad.join("; "));
  }
}
await clickTab("prac");
const links = await ev(`[...document.querySelectorAll("#v-prac a")].map((a) => ({ t: a.target, r: a.rel, h: a.href, c: getComputedStyle(a).color, u: getComputedStyle(a).textDecorationLine }))`);
check(links.length >= 6 && links.every((l) => l.t === "_blank" && /noreferrer/.test(l.r) && /^https:\/\//.test(l.h) && l.u === "none" && l.c !== "rgb(0, 0, 238)"), "doc links: external, noreferrer, no default link style", JSON.stringify(links[0]));

console.log("== usage panel");
await clickTab("eff");
const up = await ev(`(() => { const p = document.querySelector("#v-eff .ubar"); const t = document.getElementById("v-eff").innerText; return { has: !!p, bad: /NaN|Infinity|undefined|\\$inf/.test(t), widths: [...document.querySelectorAll("#v-eff .ubar-fill")].map((f) => parseFloat(f.style.width)) }; })()`);
if (!up.has) console.log("SKIP  usage panel (no session logs on this machine, so the panel is not drawn)");
else check(!up.bad && up.widths.every((w) => w >= 0 && w <= 100), "usage panel: bars within 0-100% and no NaN/Infinity/undefined text", JSON.stringify(up));

console.log("== flow lines");
for (const t of ["log", "orch", "route"]) {
  await clickTab(t);
  const f = await ev(`(() => { const e = [...document.querySelectorAll("#v-${t} .flow-anim")]; const moving = e.filter((x) => getComputedStyle(x).animationName === "flowdash"); const mk = e.filter((x) => x.getAttribute("marker-end")); return { n: e.length, moving: moving.length, markers: mk.length, dash: e[0] && getComputedStyle(e[0]).strokeDasharray }; })()`);
  check(f.n > 0 && f.moving > 0 && f.markers === f.n, `${t}: flow edges animate and carry arrowheads`, JSON.stringify(f));
}
await clickTab("log");
const mismatch = await ev(`(() => { const bad = []; document.querySelectorAll("#v-log svg .flow-anim").forEach((line) => { let n = line.previousElementSibling; while (n && !(n.tagName === "circle" && /^dot-/.test(n.getAttribute("class") || ""))) n = n.previousElementSibling;
  const lv = n && n.getAttribute("class").slice(4), want = lv === "ok" || lv === "warn" || lv === "bad" ? "flow-" + lv : "flow-still"; if (!line.classList.contains(want)) bad.push(lv + " -> " + line.getAttribute("class")); }); return { bad, n: document.querySelectorAll("#v-log svg .flow-anim").length }; })()`);
check(mismatch.n > 0 && mismatch.bad.length === 0, "monitoring flow lines take the state of the node they leave", JSON.stringify(mismatch));

console.log("== interactions");
await ev(`document.getElementById("logsBtn").click()`); await waitFor(`document.getElementById("dlg").open && document.querySelectorAll("#dlgPre .ln").length > 0`);
check(await ev(`document.getElementById("dlg").open && document.querySelectorAll("#dlgPre .ln").length > 0`), "log dialog opens with lines");
await ev(`document.getElementById("tabA").click()`); await waitFor(`document.getElementById("tabA").getAttribute("aria-pressed") === "true"`);
check(await ev(`document.getElementById("tabA").getAttribute("aria-pressed") === "true"`), "log dialog tab switch");
await ev(`document.getElementById("dlgClose").click()`);
await ev(`document.getElementById("projBtn").click()`); await waitFor(`document.getElementById("pdlg").open`);
check(await ev(`document.getElementById("pdlg").open`), "project dialog opens");
await ev(`document.querySelector("#projRows .row.proj:not(.head)")?.click()`); await waitFor(`!!document.querySelector("#projRows .adv")`, 3000);
check(await ev(`!!document.querySelector("#projRows .adv")`) , "project row expands its advice");
check(await ev(`[...document.querySelectorAll("#projRows .adv a")].every((a) => a.target === "_blank" && /noreferrer/.test(a.rel))`), "advice doc links are external + noreferrer");
await ev(`document.getElementById("pdlgClose").click()`);
await ev(`(() => { const real = window.fetch; window.__fetchBeforeInv = real; const at = new Date().toISOString(); window.fetch = async (u, o) => { const r = await real(u, o); if (String(u).includes("/api/inventory")) { const d = await r.json(); d.debug.errors = [...d.debug.errors, { at, kind: "hook-block", tool: "QaProbe", detail: "probe.env" }]; d.debug.counts["hook-block"] = (d.debug.counts["hook-block"] || 0) + 1; return new Response(JSON.stringify(d), { headers: { "Content-Type": "application/json" } }); } return r; }; })()`);
await ev(`window.__dash.loadInventory()`); await clickTab("dbg"); await waitFor(`document.querySelectorAll("#v-dbg .erow").length > 0`);
await ev(`document.querySelector("#v-dbg .erow")?.click()`); await waitFor(`!!document.querySelector("#v-dbg .exp")`, 3000);
const ex = await ev(`({ rows: document.querySelectorAll("#v-dbg .erow").length, exp: !!document.querySelector("#v-dbg .exp"), text: document.querySelector("#v-dbg .exp")?.innerText || "", cur: window.__dash.curTab, probe: window.__dash.inv.debug.errors.some((e) => e.tool === "QaProbe") })`);
check(ex.rows > 0 && ex.probe && ex.exp && ex.text.includes("조치"), "error row expands to meaning and fix (injected probe error)", JSON.stringify(ex));
await ev(`window.fetch = window.__fetchBeforeInv`);
await clickTab("log");
await ev(`window.__dash.fixDialog.open("mem-redact-on")`); await waitFor(`!/불러오는 중/.test(document.getElementById("fixNote").textContent)`);
const fx = await ev(`({ open: document.getElementById("fixdlg").open, note: document.getElementById("fixNote").textContent, title: document.getElementById("fixTitle").textContent })`);
check(fx.open && fx.note.length > 5 && !/불러오는 중|요청 실패/.test(fx.note), "fix dialog previews a fix through the token-protected API (preview only, nothing applied)", JSON.stringify(fx));
await ev(`document.getElementById("fixClose").click()`);
await ev(`document.getElementById("theme").click()`);
check(await ev(`["light","dark"].includes(document.documentElement.dataset.theme)`), "theme toggle sets data-theme");

console.log("== realtime updates");
await go(base + "/#monitor");
const n0 = await ev(`performance.getEntriesByType("resource").filter((r) => r.name.includes("/api/state")).length`);
await sleep(7500);
const n1 = await ev(`performance.getEntriesByType("resource").filter((r) => r.name.includes("/api/state")).length`);
check(n1 - n0 >= 2, "polls /api/state every ~3s", `${n1 - n0} polls in 7.5s`);
check(await ev(`document.getElementById("liveText").textContent.startsWith("LIVE")`), "live badge says LIVE while polling works");
// feed a changed state through the page's own fetch and check the DOM follows
await ev(`(() => { window.__realFetch = window.fetch; window.fetch = async (u, o) => { const r = await window.__realFetch(u, o); if (String(u).includes("/api/state")) { const s = await r.json(); s.verify.counts.FAIL = 7; s.git.branch = "qa-realtime-branch"; s.activity.events = [...s.activity.events, { at: new Date().toISOString(), kind: "tool", name: "QaProbe", target: "realtime-probe" }]; return new Response(JSON.stringify(s), { headers: { "Content-Type": "application/json" } }); } return r; }; })()`);
await waitFor(`document.getElementById("branch").textContent === "qa-realtime-branch"`, 12000);
check(await ev(`document.getElementById("branch").textContent === "qa-realtime-branch"`), "changed state reaches the header within one poll");
check(await ev(`document.getElementById("kpis").innerText.includes("7 FAIL")`), "changed FAIL count reaches the KPI");
check(await ev(`document.getElementById("stream").innerText.includes("realtime-probe")`), "a new event appears in the live stream");
// no settings applied on this machine: the monitor must say so instead of showing SYNCED (a missing live file used to look in sync)
await ev(`(() => { const prev = window.fetch; window.__prevFetch = prev; window.fetch = async (u, o) => { const r = await prev(u, o); if (String(u).includes("/api/state")) { const s = await r.json(); s.settings = { ...s.settings, liveMissing: true }; return new Response(JSON.stringify(s), { headers: { "Content-Type": "application/json" } }); } return r; }; })()`);
await waitFor(`document.getElementById("kpis").innerText.includes("NOT APPLIED")`, 12000);
check(await ev(`document.getElementById("kpis").innerText.includes("NOT APPLIED") && !document.getElementById("kpis").innerText.includes("SYNCED")`), "a machine with no applied settings shows NOT APPLIED, not SYNCED");
check(await ev(`document.getElementById("mode").textContent.includes("적용본 없음")`), "the mode badge says there are no applied settings");
await ev(`window.fetch = window.__prevFetch`);
// server gone: the badge must say OFFLINE and keep the last frame
await ev(`window.fetch = async () => { throw new Error("offline"); }`);
await waitFor(`document.getElementById("liveText").textContent === "OFFLINE"`, 25000);
check(await ev(`document.getElementById("liveText").textContent === "OFFLINE" && document.getElementById("live").classList.contains("bad")`), "badge shows OFFLINE when polling fails");
check(await ev(`document.getElementById("kpis").children.length > 0`), "last frame stays on screen when offline");
await ev(`window.fetch = window.__realFetch`);
await waitFor(`document.getElementById("liveText").textContent.startsWith("LIVE")`, 12000);
check(await ev(`document.getElementById("liveText").textContent.startsWith("LIVE")`), "badge recovers to LIVE when polling returns");

check(problems.length === 0, "no console errors, exceptions or failed requests during the whole run", problems.slice(0, 3).join(" | "));
ws.close(); proc.kill(); try { rmSync(dir, { recursive: true, force: true }); } catch {}
console.log("failures: " + fails);
process.exit(fails ? 1 : 0);
