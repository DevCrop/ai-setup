// DOM and SVG primitives. Text goes in through textContent only (no innerHTML), so data from the server can never become markup.
export const $ = (id) => document.getElementById(id);
export const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const NS = "http://www.w3.org/2000/svg";
export const sv = (n, a) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); return e; };
export const SN = (tag, attrs, text) => { const e = sv(tag, attrs || {}); if (text != null) e.textContent = text; return e; };

export const ago = (iso, now) => { const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  return s < 60 ? s + "초 전" : s < 3600 ? Math.floor(s / 60) + "분 전" : s < 86400 ? Math.floor(s / 3600) + "시간 전" : Math.floor(s / 86400) + "일 전"; };
export const hms = (iso) => { const d = new Date(iso), p = (n) => String(n).padStart(2, "0"); return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds()); };

const PATHS = {
  activity: "M22 12h-4l-3 9L9 3l-3 9H2", alert: "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z M12 9v4 M12 17h.01",
  bars: "M4 20V10 M10 20V4 M16 20v-7 M22 20H2",
  flow: "M6 3v12 M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M18 9a9 9 0 0 1-9 9",
  route: "M16 3h5v5 M4 20 21 3 M21 16v5h-5 M15 15l6 6 M4 4l5 5", list: "M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01",
  check: "M20 6 9 17l-5-5", checkc: "M22 11.1V12a10 10 0 1 1-5.9-9.1 M22 4 12 14l-3-3", x: "M18 6 6 18 M6 6l12 12",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", bot: "M12 8V4H8 M4 8h16v12H4z M2 14h2 M20 14h2 M15 13v2 M9 13v2",
  star: "M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6.1L12 16.6 6.6 19.6l1.2-6.1L3.3 9.3l6.1-.7z", term: "M4 17l6-6-6-6 M12 19h8",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z", user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  lock: "M5 11h14v10H5z M8 11V7a4 4 0 0 1 8 0v4", dot: "M12 12h.01", external: "M7 17 17 7 M8 7h9v9",
  bulb: "M9 18h6 M10 22h4 M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z"
};
export const ico = (name, size, color) => { const e = sv("svg", { viewBox: "0 0 24 24", width: size || 16, height: size || 16, fill: "none", stroke: color || "currentColor", "stroke-width": 1.8, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", class: "svgi" }); e.append(sv("path", { d: PATHS[name] || PATHS.dot })); return e; };
