// The only place that talks to the server.
export class Api {
  async json(url) { const r = await fetch(url, { cache: "no-store" }); return r.json(); }
  state() { return this.json("/api/state"); }
  inventory() { return this.json("/api/inventory"); }
  async fix(body, token) {
    const r = await fetch("/api/fix", { method: "POST", headers: { "Content-Type": "application/json", "X-Dash-Token": token || "" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(r.status);
    return r.json();
  }
}
