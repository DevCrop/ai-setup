// Application shell: owns the shared state (live state, inventory), the router, the polling loops and the dialogs. Tabs get `app` and read from it.
import { $, el, ico } from "./dom.js";
import { Api } from "./api.js";
import { ChartRegistry } from "./components.js";
import { ProjectTable, ProjectDialog, LogDialog, FixDialog } from "./dialogs.js";
import { TAB_CLASSES } from "./tabs/index.js";

class App {
  constructor() {
    this.api = new Api();
    this.last = null;          // newest /api/state
    this.inv = null;           // newest /api/inventory
    this.curTab = "monitor";
    this.lastOk = 0;
    this.charts = new ChartRegistry();
    this.projects = new ProjectTable(this);
    this.tabs = TAB_CLASSES.map((K) => new K(this));
    this.agent = this.agent.bind(this);
  }

  start() {
    this.initTheme();
    this.projectDialog = new ProjectDialog(this); this.logDialog = new LogDialog(this); this.fixDialog = new FixDialog(this);
    this.navIcons();
    document.querySelectorAll(".side button").forEach((b) => { b.onclick = () => this.show(b.dataset.tab); });
    addEventListener("hashchange", () => this.show((location.hash || "").slice(1)));
    let rz; addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { this.charts.reset(); if (this.last) this.tab("monitor").onState(this.last); }, 150); });
    this.show((location.hash || "").slice(1));
    this.tick(); setInterval(() => this.tick(), 3000);
    setInterval(() => { if (this.tab(this.curTab).needsInventory) this.loadInventory(); }, 15000);
  }

  tab(id) { return this.tabs.find((t) => t.id === id); }
  agent(name) { return ((this.inv || {}).agents || []).find((x) => x.name === name) || { name, model: "?", effort: "?", tools: "?", desc: "정의 파일이 없습니다" }; }

  initTheme() {
    try { const t = localStorage.getItem("theme"); if (t) document.documentElement.dataset.theme = t; } catch (e) {}
    $("theme").onclick = () => {
      const dark = getComputedStyle(document.documentElement).colorScheme.includes("dark"), next = dark ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem("theme", next); } catch (e) {}
    };
  }

  navIcons() {
    this.tabs.forEach((t) => { const b = document.querySelector('.side button[data-tab="' + t.id + '"] .ic'); if (b) b.replaceChildren(ico(t.constructor.icon || "dot", 17)); });
  }

  show(id) {
    if (!this.tabs.some((t) => t.id === id)) id = "monitor";
    this.curTab = id;
    this.tabs.forEach((t) => { t.view.hidden = t.id !== id; });
    document.querySelectorAll(".side button").forEach((b) => { b.dataset.tab === id ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current"); });
    try { history.replaceState(null, "", "#" + id); } catch (e) {}
    const t = this.tab(id);
    if (t.needsInventory && !this.inv) { t.view.replaceChildren(el("p", "note", "데이터를 기다리는 중…")); this.loadInventory(); return; }
    t.draw(t.view);
  }

  async loadInventory() {
    try { this.inv = await this.api.inventory(); } catch (e) { return; }
    if (this.tab(this.curTab).needsInventory) this.show(this.curTab);
  }

  async tick() {
    try {
      this.last = await this.api.state();
      this.tab("monitor").onState(this.last);
      this.lastOk = Date.now(); document.body.classList.add("loaded");
      this.logDialog.refresh(); this.projectDialog.refresh();
      const cur = this.tab(this.curTab);
      if (cur.redrawOnState) this.show(this.curTab);
    } catch (e) { /* keep the last frame */ }
    const fresh = Date.now() - this.lastOk < 8000;
    $("live").className = "badge live " + (fresh ? "ok" : "bad"); $("liveText").textContent = fresh ? "LIVE · 3s" : "OFFLINE";
  }
}

const app = new App();
window.__dash = app; // read-only handle for the UI QA script
app.start();
