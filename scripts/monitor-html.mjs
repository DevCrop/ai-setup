// Renders the monitor data contract (v1 + v2 + background roles) to one self-contained Korean HTML page.
// Design system: the legacy dashboard (tokens, app shell, panel/badge/tile/kpi/stack/rows). One view is visible at a time.
// Every string taken from data goes through esc(). Attributes only receive esc()'d text or fixed tokens.
// shortcut: charts are hand-drawn HTML/SVG with fixed geometry, no chart library; upgrade only if a chart needs zoom or hover.
// shortcut: the flowchart tree uses CSS columns (2/3/4 per row by width), not measured layout; rows stay aligned because grid rows stretch.

const DASH = '–';

const STATUS = {
  ok: { cls: 'ok', label: '정상' },
  warn: { cls: 'warn', label: '주의' },
  missing: { cls: 'bad', label: '없음' },
};

const VERDICT = {
  ok: { cls: 'ok', label: '일치' },
  mismatch: { cls: 'warn', label: '불일치' },
  override: { cls: 'info', label: '수동 지정' },
  'n/a': { cls: 'info', label: '해당 없음' },
  'no data': { cls: 'info', label: '데이터 없음' },
};

const FAMILIES = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', other: '기타' };
const FAMILY_ORDER = ['opus', 'sonnet', 'haiku', 'other'];
const SUB_ORDER = ['sonnet', 'haiku', 'opus', 'other'];
const ROLE_LABEL = { main: '메인', subagent: '서브에이전트', 'claude-mem': 'claude-mem 관찰자', sdk: 'SDK' };

const TABS = [
  { id: 'ov', label: '개요' },
  { id: 'orch', label: '오케스트레이션' },
  { id: 'route', label: '모델 라우팅' },
  { id: 'tok', label: '토큰' },
  { id: 'sav', label: '절감 효과' },
  { id: 'set', label: '설정 상태' },
];


// Bus rules for a tree with n columns: the first node of a row starts the bus at the trunk, the last ends it at its centre,
// and a first-in-row node that is not in the last row also draws the trunk down to the next row.
function treeCss(n, scope) {
  const s = `${scope} .nd`;
  return `${s}:nth-child(${n}n+1)::before { left: -19px; } ${s}:nth-child(${n}n)::before, ${s}:last-child::before { right: 50%; } ` +
    `${s}:nth-child(${n}n+1):not(:nth-last-child(-n+${n})) .tr { display: block; }`;
}

const CSS = `
/* 1 tokens. Quiet instrument panel: paper in light, warm graphite in dark. Accent only for brand, live dots, the donut subagent arc and the Opus data colour. */
:root {
  --bg: #faf9f5; --panel: #ffffff; --raise: #ffffff; --line: #e8e6dc; --line-strong: #d3d0c3; --fg: #141413; --muted: #5e5d59; --faint: #7a786f;
  --accent: #d77757; --accent-ink: #b9532f; --fill: #f0eee6; --hl: rgba(215, 119, 87, .10); --glow: 4%; --shadow: 0 1px 2px rgba(20, 20, 19, .04);
  --warn: #8f6420; --bad: #b04a38; --ok: #3f7a55;
  --f-opus: #d77757; --f-sonnet: #7391b3; --f-haiku: #74a085; --f-other: #a09c92; --hatch: rgba(255, 255, 255, .55);
  --sans: "Pretendard Variable", Pretendard, -apple-system, "Segoe UI", "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif;
  --serif: "Source Serif 4", "Noto Serif KR", Georgia, "Batang", serif;
  --mono: ui-monospace, "Cascadia Mono", "Cascadia Code", Consolas, "D2Coding", "Malgun Gothic", Menlo, monospace;
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-5: 24px; --sp-6: 32px;
  --gap: 16px; --pad: 20px; --edge: 24px; --max: 1200px; --ctl: 36px;
  --r-sm: 6px; --r-md: 8px; --r-lg: 12px;
  --t-xs: 12px; --t-sm: 13px; --t-md: 14px; --t-lg: 16px;
  --lh: 1.6; --ease: cubic-bezier(.22, .61, .36, 1);
}
@media (max-width: 760px) { :root { --pad: 14px; --edge: 16px; --ctl: 40px; } }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #1f1e1d; --panel: #262624; --raise: #403f3b; --line: #3a3936; --line-strong: #4a4945; --fg: #e9e7df; --muted: #b7b4aa; --faint: #918f86;
  --accent-ink: #eb9575; --warn: #d9a85a; --bad: #e0816f; --ok: #86b497; --fill: #33322f; --hl: rgba(215, 119, 87, .12); --glow: 6%; --shadow: none;
  --f-sonnet: #8aa9cc; --f-haiku: #86b497; --f-other: #a39e94; --hatch: rgba(0, 0, 0, .35); color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #1f1e1d; --panel: #262624; --raise: #403f3b; --line: #3a3936; --line-strong: #4a4945; --fg: #e9e7df; --muted: #b7b4aa; --faint: #918f86;
  --accent-ink: #eb9575; --warn: #d9a85a; --bad: #e0816f; --ok: #86b497; --fill: #33322f; --hl: rgba(215, 119, 87, .12); --glow: 6%; --shadow: none;
  --f-sonnet: #8aa9cc; --f-haiku: #86b497; --f-other: #a39e94; --hatch: rgba(0, 0, 0, .35); color-scheme: dark; }

/* 2 base */
* { box-sizing: border-box; }
html { min-height: 100%; background-color: var(--bg);
  background-image: radial-gradient(ellipse 70% 480px at 50% 0, color-mix(in srgb, var(--accent) var(--glow), transparent), transparent), url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.03'/%3E%3C/svg%3E");
  background-repeat: no-repeat, repeat; }
body { margin: 0; min-height: 100vh; color: var(--fg); font: 400 var(--t-md)/var(--lh) var(--sans); font-variant-numeric: tabular-nums; -webkit-text-size-adjust: 100%; }
button { font: inherit; cursor: pointer; }
a { color: var(--fg); text-decoration: underline; text-underline-offset: 2px; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.view[hidden] { display: none !important; }
.hatch { background-image: repeating-linear-gradient(45deg, transparent 0 4px, var(--hatch) 4px 8px); }
.f-opus { --fc: var(--f-opus); } .f-sonnet { --fc: var(--f-sonnet); } .f-haiku { --fc: var(--f-haiku); } .f-other { --fc: var(--f-other); }

/* 3 layout: one sticky top bar (brand, segmented tabs, live status) above one centred column */
.top { position: sticky; top: 0; z-index: 5; background: color-mix(in srgb, var(--bg) 86%, transparent); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); border-bottom: 1px solid var(--line); }
.topin { max-width: calc(var(--max) + 2 * var(--edge)); margin-inline: auto; padding: var(--sp-3) var(--edge); display: grid; grid-template-columns: auto minmax(0, 1fr) auto; grid-template-areas: "brand tabs meta"; align-items: center; gap: var(--sp-3) var(--sp-5); min-width: 0; }
.brand { grid-area: brand; display: flex; align-items: center; gap: var(--sp-2); min-width: 0; }
.mark { color: var(--accent); font-family: var(--serif); font-size: var(--t-lg); }
.brand h1 { margin: 0; font-size: 17px; font-weight: 600; letter-spacing: -.01em; line-height: 1.3; white-space: nowrap; }
.tabs { grid-area: tabs; justify-self: start; display: flex; gap: 2px; max-width: 100%; min-width: 0; overflow-x: auto; background: var(--fill); border-radius: var(--r-md); padding: 3px; scrollbar-width: none; }
.tabs button { flex: none; white-space: nowrap; min-height: 32px; font-size: var(--t-sm); color: var(--muted); background: none; border: 0; border-radius: var(--r-sm); padding: 0 var(--sp-3); transition: background-color .15s, color .15s; }
.tabs button:hover { color: var(--fg); }
.tabs button[aria-current="page"] { color: var(--fg); font-weight: 500; background: var(--raise); box-shadow: 0 1px 2px rgba(20, 20, 19, .12), 0 0 0 1px var(--line); }
.tabs button:focus-visible { outline-offset: -2px; }
.meta { grid-area: meta; display: flex; align-items: center; gap: var(--sp-3); min-width: 0; }
.meta time { font-size: var(--t-xs); color: var(--muted); white-space: nowrap; }
.prog { position: absolute; left: 0; bottom: -1px; width: 100%; height: 2px; background: var(--accent); transform: scaleX(0); transform-origin: left; pointer-events: none; }
.stage { padding: var(--gap) var(--edge) var(--sp-5); min-width: 0; }
.view { width: 100%; max-width: var(--max); margin-inline: auto; display: flex; flex-direction: column; gap: var(--gap); min-width: 0; }
.col { display: flex; flex-direction: column; gap: var(--gap); min-width: 0; }
.g12 { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: var(--gap); align-items: stretch; }
.c8 { grid-column: span 8; } .c4 { grid-column: span 4; }
.g22 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gap); align-items: stretch; }
.grid2 { display: grid; gap: var(--gap); grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); align-items: start; }
.band { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: var(--r-lg); overflow: hidden; box-shadow: var(--shadow); }
.band.k4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
@media (max-width: 1239px) {
  .topin { grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "brand meta" "tabs tabs"; gap: var(--sp-2) var(--sp-4); }
  .tabs { justify-self: stretch; }
  .tabs button { min-height: 40px; }
}
@media (max-width: 899px) {
  .g12, .g22 { grid-template-columns: minmax(0, 1fr); }
  .c8, .c4 { grid-column: 1 / -1; }
  .band, .band.k4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .band > :last-child:nth-child(odd) { grid-column: 1 / -1; }
}
@media (max-width: 760px) {
  .topin { padding: var(--sp-2) var(--edge); }
  .meta { gap: var(--sp-2); }
  .meta time { font-size: 11px; }
  .lcw { display: none; }
  .cd .cl { font-size: 10px; } .cd .cv-v { font-size: 9px; letter-spacing: -.02em; } .sh { flex-wrap: wrap; } .yax { width: 3em; font-size: 10px; }
  .meta .btn { min-height: 32px; padding: 0 var(--sp-2); }
  .kpi .v { font-size: 26px; }
  .dlines { font-size: var(--t-xs); }
  .dlines b { min-width: 5em; }
}

/* 4 components */
.st { display: inline-flex; align-items: center; gap: 6px; font-size: var(--t-xs); color: var(--muted); white-space: nowrap; }
.st.warn { color: var(--warn); } .st.bad { color: var(--bad); }
.st.warn::before, .st.bad::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: none; }
.st.live .pip { color: var(--accent); }
.pip.live { color: var(--accent); }
.pip { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: none; }
.live .pip, .pip.live { animation: pulse 1.6s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: .25; } }
@media (prefers-reduced-motion: reduce) { .live .pip, .pip.live { animation: none !important; } .prog { display: none; } .dl, .kpi, .tabs button { transition: none; } }
.dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--fc, var(--faint)); flex: none; }
.fc { display: inline-flex; align-items: center; gap: 6px; font-size: var(--t-xs); color: var(--fg); white-space: nowrap; }
.btn { display: inline-flex; align-items: center; justify-content: center; min-height: var(--ctl); font-size: var(--t-sm); color: var(--fg); background: var(--panel); border: 1px solid var(--line); border-radius: var(--r-md); padding: var(--sp-1) var(--sp-3); }
.btn:hover { border-color: var(--faint); }

.panel { background: var(--panel); border: 1px solid var(--line); border-radius: var(--r-lg); box-shadow: var(--shadow); padding: var(--pad); min-width: 0; display: flex; flex-direction: column; gap: var(--sp-3); overflow: hidden; }
.panel > .donut { margin-block: auto; }
.ph { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: var(--sp-1) var(--sp-3); }
.ph h2 { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: -.01em; line-height: 1.4; }
.ph .hint { font-size: var(--t-xs); color: var(--muted); min-width: 0; text-align: right; }
.ph .rt-end { display: flex; align-items: baseline; gap: var(--sp-3); min-width: 0; }
.cap { margin: 0; color: var(--muted); font-size: var(--t-xs); }
.empty { color: var(--faint); font-size: var(--t-sm); padding: var(--sp-2) 0; margin: 0; }
h3.sub { margin: 0; font-size: var(--t-xs); font-weight: 500; color: var(--muted); }
details.fold { border-top: 1px solid var(--line); padding: var(--sp-2) 0 0; min-width: 0; }
details.fold summary { cursor: pointer; font-size: var(--t-xs); color: var(--muted); min-height: 28px; display: flex; align-items: center; }
details.fold[open] summary { margin-bottom: var(--sp-3); }

.tiles { display: grid; gap: var(--sp-3) var(--sp-4); grid-template-columns: repeat(2, minmax(0, 1fr)); }
.tile { display: grid; gap: 2px; align-content: start; min-width: 0; }
.tile .n { font-size: 20px; font-weight: 500; line-height: 1.25; overflow-wrap: anywhere; }
.tile .l { font-size: var(--t-xs); color: var(--muted); }
.kpi { background: var(--panel); padding: var(--pad); display: flex; flex-direction: column; gap: var(--sp-1); min-width: 0; transition: background-color 1.2s ease; }
.kpi.hot { background: var(--hl); transition: none; }
.kpi .k { font-size: var(--t-xs); color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vr { display: flex; align-items: baseline; flex-wrap: wrap; gap: 0 var(--sp-2); min-width: 0; }
.kpi .v { font-size: 30px; font-weight: 600; letter-spacing: -.02em; line-height: 1.2; overflow-wrap: anywhere; }
.kpi .v.bad { color: var(--bad); }
.dl { font-size: var(--t-xs); color: var(--muted); opacity: 0; transition: opacity .4s; white-space: nowrap; }
.dl:empty { display: none; } .dl.on { opacity: 1; } .dl.pos { color: var(--ok); } .dl.neg { color: var(--warn); }
.ft { display: flex; align-items: flex-end; justify-content: space-between; gap: var(--sp-2); margin-top: auto; padding-top: var(--sp-1); min-width: 0; }
.kpi .n { font-size: var(--t-xs); color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.sl { display: flex; align-items: center; justify-content: flex-end; flex: none; gap: var(--sp-2); }
.sl svg { flex: none; margin-left: auto; overflow: visible; }
.sl polyline { fill: none; stroke: var(--faint); stroke-width: 1.5; stroke-linejoin: round; stroke-linecap: round; }
.tile .sl { justify-content: flex-start; margin-top: var(--sp-1); min-height: 16px; }
.mb { height: 4px; border-radius: 2px; background: var(--line); overflow: hidden; margin: var(--sp-1) 0; }
.mb i { display: block; height: 100%; border-radius: 2px; background: var(--faint); }
.runline { display: flex; align-items: center; gap: var(--sp-2); margin: 0; font-size: var(--t-xs); color: var(--muted); }
.runline b { font-weight: 500; color: var(--fg); }
.runline .pip { color: var(--accent); }
.lrow { display: grid; grid-template-columns: 6px minmax(0, 1fr) auto; gap: var(--sp-3); align-items: center; min-height: 32px; font-size: var(--t-sm); border-bottom: 1px solid var(--line); }
.lrow:last-child { border-bottom: 0; }
.lrow .ln { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.lrow .lv { font-size: var(--t-xs); color: var(--muted); white-space: nowrap; } .lrow .lv.warn { color: var(--warn); } .lrow .lv.bad { color: var(--bad); }

.stack { display: flex; height: 8px; border-radius: 4px; overflow: hidden; gap: 2px; background: var(--line); }
.stack i { display: block; height: 100%; background-color: var(--fc); }
.stack.mute { opacity: .6; }
.legend { display: flex; flex-wrap: wrap; gap: var(--sp-1) var(--sp-3); font-size: var(--t-xs); color: var(--muted); margin: 0; padding: 0; list-style: none; align-items: center; }
.legend b { font-weight: 500; color: var(--fg); margin-left: var(--sp-1); }
.legend .lg { display: inline-flex; align-items: center; gap: 6px; }
i.sw { background-color: var(--fc); display: inline-block; width: 8px; height: 8px; border-radius: 2px; flex: none; }
.dlines { display: grid; gap: var(--sp-1); font-size: var(--t-sm); }
.dlines > div { display: flex; align-items: baseline; gap: var(--sp-3); }
.dlines .sps { display: flex; flex-wrap: wrap; gap: 2px var(--sp-3); min-width: 0; }
.dlines .sp { display: inline-flex; align-items: center; gap: 6px; }
.dlines b { min-width: 6.5em; font-weight: 400; color: var(--muted); flex: none; }

.donut { display: flex; align-items: center; gap: var(--sp-4); flex-wrap: wrap; }
.ring { width: 96px; height: 96px; flex: none; }
.ring .tr { stroke: var(--line); } .ring .fg { stroke: var(--accent); }
.ring text { font-family: var(--sans); fill: var(--fg); font-size: 22px; font-weight: 500; }
.big { font-size: 24px; font-weight: 500; line-height: 1.2; margin: 0; overflow-wrap: anywhere; }

.ubar { display: grid; grid-template-columns: minmax(90px, 150px) minmax(0, 1fr) auto; gap: var(--sp-3); align-items: center; font-size: var(--t-sm); }
.ubar-l { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.ubar-track { height: 6px; background: var(--line); border-radius: 3px; overflow: hidden; }
.ubar-fill { display: block; height: 100%; border-radius: 3px; background: var(--faint); }
.ubar-v { font-size: var(--t-xs); color: var(--muted); text-align: right; white-space: nowrap; }
.ubar.rtk { grid-template-columns: minmax(90px, 150px) minmax(0, 1fr) 11ch; }
.ubar-v b { font-weight: 500; color: var(--fg); } .ubar-v i { font-style: normal; }
.ubars { display: grid; gap: var(--sp-3); }

.pitems { display: flex; flex-direction: column; }
.pitem { display: grid; grid-template-columns: 6px minmax(0, 1fr) auto; gap: 2px var(--sp-3); padding: var(--sp-3) 0; border-bottom: 1px solid var(--line); align-items: center; font-size: var(--t-sm); min-width: 0; }
.pitem:first-child { padding-top: 0; } .pitem:last-child { border-bottom: 0; padding-bottom: 0; }
.pitem .what { overflow-wrap: anywhere; font-weight: 500; min-width: 0; }
.pitem .ev { grid-column: 2 / -1; color: var(--muted); font-size: var(--t-xs); overflow-wrap: anywhere; min-width: 0; }
.dt { width: 6px; height: 6px; border-radius: 50%; background: var(--line-strong); }
.dt.ok { background: var(--ok); } .dt.warn { background: var(--warn); } .dt.bad { background: var(--bad); }

@media (max-width: 640px) {
  .ubar.wide { grid-template-columns: minmax(64px, 90px) minmax(0, 1fr); }
  .ubar.wide .ubar-v { grid-column: 1 / -1; text-align: left; white-space: normal; }
}
.kv { display: grid; grid-template-columns: fit-content(45%) minmax(0, 1fr); gap: var(--sp-1) var(--sp-3); align-items: baseline; padding: var(--sp-2) 0; border-bottom: 1px solid var(--line); font-size: var(--t-sm); min-width: 0; }
.kv:first-child { padding-top: 0; } .kv:last-child { border-bottom: 0; padding-bottom: 0; }
.kv > span:first-child { color: var(--muted); }
.kv > span:nth-child(2) { text-align: right; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.tw { overflow-x: auto; border: 1px solid var(--line); border-radius: var(--r-md); }
.utable { width: max-content; min-width: 100%; border-collapse: collapse; font-size: var(--t-xs); }
.utable th, .utable td { text-align: left; padding: 6px var(--sp-3); border-bottom: 1px solid var(--line); white-space: nowrap; }
.utable th { color: var(--muted); font-weight: 400; }
.utable td.num { text-align: right; } .utable tr:last-child td { border-bottom: 0; font-weight: 500; }

.cols { display: flex; gap: var(--sp-2); align-items: flex-end; }
.cd { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; align-items: stretch; gap: 4px; }
.stk { position: relative; display: flex; flex-direction: column; justify-content: flex-end; border-bottom: 1px solid var(--line-strong); }
.stk .sg { background-color: var(--fc); display: block; flex: none; width: 100%; max-width: 44px; margin-inline: auto; min-height: 1px; }
.stk .sg:first-of-type { border-radius: 3px 3px 0 0; }
.cd .cl { font-size: 11px; line-height: 14px; color: var(--muted); text-align: center; white-space: nowrap; }
.cd .cv-v { display: block; color: var(--fg); }

.dn { width: 120px; height: 120px; flex: none; }
.dn circle { fill: none; stroke-width: 14; stroke: var(--fc); } .dn circle.tr { stroke: var(--line); }
.dn .dv { fill: var(--fg); font-size: 22px; font-weight: 500; } .dn .dk { fill: var(--muted); font-size: 11px; }
.d-main { --fc: var(--faint); } .d-sub { --fc: var(--accent); } .d-bg { --fc: color-mix(in srgb, var(--faint) 50%, var(--panel)); }
.dlg { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--sp-2); font-size: var(--t-sm); flex: 1 1 180px; min-width: 0; }
.dlg li { display: grid; grid-template-columns: 8px minmax(0, 1fr) auto auto; gap: var(--sp-2); align-items: center; }
.dlg .nm { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dlg b { font-weight: 500; text-align: right; } .dlg .tk { font-size: var(--t-xs); color: var(--muted); min-width: 4.5em; text-align: right; }

.chart { display: flex; gap: var(--sp-2); align-items: flex-start; }
.chart .cols { flex: 1 1 0; min-width: 0; }
.yax { display: flex; flex-direction: column; justify-content: space-between; margin-top: -7px; font-size: 11px; line-height: 14px; color: var(--muted); width: 3.4em; flex: none; }
.hl { position: absolute; left: 50%; top: 0; width: calc(100% + var(--sp-2)); height: 100%; overflow: visible; pointer-events: none; }
.hl line { stroke: var(--fg); stroke-width: 1.5; opacity: .6; }
.hl circle { fill: var(--panel); stroke: var(--fg); stroke-width: 1.5; pointer-events: all; }
.hl circle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
i.sw.ln { width: 14px; height: 2px; border-radius: 1px; background-color: var(--fg); }

.mx { display: grid; }
.mr { display: grid; grid-template-columns: minmax(0, 1fr) repeat(3, minmax(64px, 112px)); gap: var(--sp-1); align-items: stretch; border-bottom: 1px solid var(--line); min-width: 0; }
.mr > .who { padding: var(--sp-2) 0; align-self: center; }
.mr.mh { font-size: var(--t-xs); color: var(--muted); } .mr.mh span { padding: 0 var(--sp-2) var(--sp-1); }
.mr:last-child { border-bottom: 0; padding-bottom: 0; }
.who { display: grid; gap: 2px; min-width: 0; }
.who .nm { font-size: var(--t-sm); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.who .sb { display: flex; flex-wrap: wrap; align-items: center; gap: 0 var(--sp-2); font-size: var(--t-xs); color: var(--muted); }
.mc { display: flex; flex-direction: column; justify-content: center; gap: 5px; padding: var(--sp-2); font-size: var(--t-xs); }
.mc.ex { background: color-mix(in srgb, var(--fc) 9%, transparent); box-shadow: inset 0 2px 0 var(--fc); }
.mp { font-weight: 600; color: var(--fg); line-height: 1; }
.mc.z .mp { font-weight: 400; color: var(--faint); }
.mb { display: block; height: 4px; border-radius: 2px; background: var(--fill); overflow: hidden; }
.mb i { display: block; height: 100%; border-radius: 2px; background: var(--fc); }
.mc.mm .mp { color: var(--warn); }
.mc.mm .mb i { background: repeating-linear-gradient(-45deg, var(--warn) 0 3px, color-mix(in srgb, var(--warn) 45%, transparent) 3px 5px); }
@media (max-width: 640px) {
  .mr { grid-template-columns: minmax(0, 1fr) repeat(3, 56px); gap: 2px; }
  .mc { padding: var(--sp-2) 6px; }
}

/* 5 views: orchestration flowchart. Neutral root and node cards; 1px grey connectors: a stem, a trunk on the left, a bus per row, a tick into each node. */
.tree { min-width: 0; }
.root { display: flex; align-items: center; flex-wrap: wrap; gap: var(--sp-2); width: max-content; max-width: 100%; padding: var(--sp-1) var(--sp-3); border: 1px solid var(--line); border-radius: 999px; background: var(--fill); font-size: var(--t-sm); }
.root b { font-weight: 500; }
.n3 { font-size: var(--t-xs); color: var(--muted); overflow-wrap: anywhere; }
.n3.diff { color: var(--warn); }
.stem { position: relative; height: 28px; width: 1px; margin-left: 24px; background: var(--line-strong); }
.stem span { position: absolute; left: 10px; top: 4px; font-size: 11px; color: var(--muted); white-space: nowrap; }
.nodes { --n: 2; display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); column-gap: 16px; row-gap: 28px; margin: 14px 0 0 32px; }
.nd { position: relative; display: flex; flex-direction: column; gap: 4px; padding: 10px var(--sp-3); border: 1px solid var(--line); border-radius: 10px; background: var(--panel); min-width: 0; }
.nd .n1 { display: flex; align-items: center; gap: 6px; min-width: 0; }
.nd .no { color: var(--faint); font-size: var(--t-xs); flex: none; }
.nd .nm { font-weight: 500; font-size: var(--t-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.nd .n2 { display: flex; flex-wrap: wrap; align-items: center; gap: 4px var(--sp-3); }
.nd::before { content: ""; position: absolute; top: -16px; left: -10px; right: -9px; height: 1px; background: var(--line-strong); pointer-events: none; }
.nd::after { content: ""; position: absolute; top: -16px; left: 50%; width: 1px; height: 10px; background: var(--line-strong); pointer-events: none; }
.nd .ah { position: absolute; top: -6px; left: calc(50% - 4px); border: 4px solid transparent; border-top: 5px solid var(--line-strong); border-bottom: 0; }
.nd .tr { display: none; position: absolute; top: -16px; bottom: -16px; left: -19px; width: 1px; background: var(--line-strong); pointer-events: none; }
@media (max-width: 640px) { ${treeCss(2, '.nodes:not(.cmp)')} }
@media (min-width: 641px) and (max-width: 1099px) { .nodes:not(.cmp) { --n: 3; } ${treeCss(3, '.nodes:not(.cmp)')} }
@media (min-width: 1100px) { .nodes:not(.cmp) { --n: 4; } ${treeCss(4, '.nodes:not(.cmp)')} }
@media (max-width: 1099px) { ${treeCss(2, '.nodes.cmp')} }
@media (min-width: 1100px) { .nodes.cmp { --n: 4; } ${treeCss(4, '.nodes.cmp')} }
.sess { display: flex; flex-direction: column; gap: var(--sp-3); min-width: 0; }
.sess + .sess { border-top: 1px solid var(--line); padding-top: var(--sp-5); }
.sh { display: flex; flex-wrap: nowrap; align-items: center; gap: var(--sp-1) var(--sp-3); min-width: 0; font-size: var(--t-sm); }
.sh .sid { font-family: var(--mono); font-size: var(--t-xs); color: var(--muted); }
.sh .pj { color: var(--fg); font-weight: 500; flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.sh .rg { color: var(--muted); font-size: var(--t-xs); white-space: nowrap; flex: none; }
.sh .sid, .sh .st { flex: none; }
.more { font-size: var(--t-xs); color: var(--muted); margin: 0; }

/* Motion: entrance only when a tab is shown for the first time in this browser session (script adds .anim); all off for reduced motion. */
@keyframes grow { from { transform: scaleX(0); } }
@keyframes growy { from { transform: scaleY(0); } }
@keyframes fadein { from { opacity: 0; } }
@keyframes prog { to { transform: scaleX(1); } }
@keyframes ndin { from { opacity: 0; transform: translateY(8px); } }
@keyframes draw { from { stroke-dashoffset: var(--a); } }
@media (prefers-reduced-motion: no-preference) {
  .view.fade { animation: fadein .15s ease; }
  .anim .dn { animation: fadein .5s both; }
  .anim .hl { animation: fadein .4s .6s both; }
  .prog { animation: prog linear forwards; }
  .anim .stack i, .anim .ubar-fill, .anim .mb i { transform-origin: left; animation: grow .6s var(--ease) both; animation-delay: calc(var(--i, 0) * 60ms); }
  .anim .stk .sg { transform-origin: bottom; animation: growy .6s var(--ease) both; animation-delay: calc(var(--i, 0) * 50ms); }
  .anim .cv-v { animation: fadein .4s .5s both; }
  .anim .ring .fg { animation: draw .9s var(--ease) both; }
  .anim .root { animation: ndin .4s var(--ease) both; }
  .anim .stem { transform-origin: top; animation: growy .3s .15s var(--ease) both; }
  .anim .nd { animation: ndin .4s var(--ease) both; animation-delay: calc(var(--i, 0) * 50ms + 120ms); }
  .anim .nd::before { transform-origin: left; animation: grow .35s var(--ease) both; animation-delay: calc(var(--i, 0) * 50ms + 80ms); }
  .anim .nd::after, .anim .nd .tr { transform-origin: top; animation: growy .3s var(--ease) both; animation-delay: calc(var(--i, 0) * 50ms + 120ms); }
}
`;

// Lookup that ignores inherited keys such as "constructor".
function pick(map, key, fallback) {
  return typeof key === 'string' && Object.hasOwn(map, key) ? map[key] : fallback;
}

function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function arr(v) {
  return Array.isArray(v) ? v.filter(isObj) : [];
}

// The one escape helper: every data string goes through here.
function esc(v) {
  if (v !== null && typeof v === 'object') return '';
  let str;
  try {
    str = String(v ?? '');
  } catch {
    return '';
  }
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function txt(v) {
  return esc(v) || DASH;
}

function nz(v) {
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function fmtInt(v) {
  return Number.isFinite(v) ? String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : DASH;
}

function fixed1(x) {
  return String(Number(x.toFixed(1)));
}

// Korean large-number style: 만 (10^4) and 억 (10^8).
function compactKo(v) {
  if (!Number.isFinite(v)) return DASH;
  const a = Math.abs(v);
  if (a >= 1e8) return `${fixed1(v / 1e8)}억`;
  if (a >= 1e4) return `${fixed1(v / 1e4)}만`;
  return fmtInt(v);
}

function pct01(v) {
  return Number.isFinite(v) ? `${fixed1(v * 100)}%` : DASH;
}

function pctValue(v) {
  return Number.isFinite(v) ? `${fixed1(v)}%` : DASH;
}

function parseTime(iso) {
  return typeof iso === 'string' ? Date.parse(iso) : NaN;
}

// "10월 19일 23:14" (withDate) or "23:14". Built from fixed parts only.
function fmtKo(iso, withDate) {
  const t = new Date(parseTime(iso));
  if (Number.isNaN(t.getTime())) return DASH;
  const p = (n) => String(n).padStart(2, '0');
  const hm = `${p(t.getHours())}:${p(t.getMinutes())}`;
  return withDate ? `${t.getMonth() + 1}월 ${t.getDate()}일 ${hm}` : hm;
}

// "HH:MM:SS" in local time, or the dash.
function fmtHms(iso) {
  const t = new Date(parseTime(iso));
  if (Number.isNaN(t.getTime())) return DASH;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`;
}

// "10월 19일 22:59–23:31", or both dates when the session spans days.
function rangeKo(s, e) {
  const a = new Date(parseTime(s));
  const b = new Date(parseTime(e));
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return DASH;
  return a.toDateString() === b.toDateString()
    ? `${fmtKo(s, true)}–${fmtKo(e, false)}`
    : `${fmtKo(s, true)} – ${fmtKo(e, true)}`;
}

// Parses "4.7M" / "976.8K" / "812" into a token count; used only for bar lengths.
function parseSaved(v) {
  if (Number.isFinite(v)) return nz(v);
  if (typeof v !== 'string') return 0;
  const m = /^\s*([\d.]+)\s*([KMG]?)/i.exec(v);
  if (!m) return 0;
  const n = parseFloat(m[1]) * { '': 1, K: 1e3, M: 1e6, G: 1e9 }[m[2].toUpperCase()];
  return Number.isFinite(n) ? n : 0;
}

function family(model) {
  const m = typeof model === 'string' ? model.toLowerCase() : '';
  if (m.includes('opus')) return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku')) return 'haiku';
  return 'other';
}

function famLabel(fam) {
  return pick(FAMILIES, fam, FAMILIES.other);
}

function badge(cls, label) {
  return `<span class="st ${cls}">${esc(label)}</span>`;
}

function statusOf(status) {
  return pick(STATUS, status, STATUS.missing);
}

function verdictBadge(verdict) {
  const v = pick(VERDICT, verdict, { cls: 'info', label: DASH });
  return badge(v.cls, v.label);
}

function liveBadge() {
  return `<span class="st live"><span class="pip"></span>실시간</span>`;
}

// One mapping from claudeMem.reachable to its label and checklist status.
function reach(m) {
  return m.reachable === true ? { label: '연결됨', st: 'ok' } : m.reachable === false ? { label: '연결 안 됨', st: 'missing' } : { label: DASH, st: 'warn' };
}

function noData() {
  return '<p class="empty">데이터 없음</p>';
}

// Wraps one panel. A missing or non-object section, or a body that throws, gets the 없음 badge and "데이터 없음".
// A section without its own status (a sub-object such as savings.rtk) counts as ok.
function panel(title, sec, body, o = {}) {
  const s = isObj(sec) ? sec : null;
  let status = s ? (typeof s.status === 'string' ? s.status : 'ok') : 'missing';
  let content;
  if (!s || (o.isEmpty && o.isEmpty(s))) {
    status = 'missing';
    content = noData();
  } else {
    try {
      content = body(s);
    } catch {
      status = 'missing';
      content = noData();
    }
  }
  const st = statusOf(status);
  const hint = o.hint ? `<span class="hint">${esc(o.hint)}</span>` : '';
  const flag = status === 'ok' ? '' : badge(st.cls, st.label);
  return `<section class="panel${o.cls ? ` ${o.cls}` : ''}"><div class="ph"><h2>${esc(title)}</h2>` +
    `<span class="rt-end">${hint}${flag}</span></div>${content}</section>`;
}

function ring(frac, text, label) {
  const C = 2 * Math.PI * 48;
  const f = Number.isFinite(frac) ? clamp(frac, 0, 1) : 0;
  return `<svg class="ring" viewBox="0 0 120 120" role="img" aria-label="${esc(`${label} ${text}`)}">` +
    `<circle class="tr" cx="60" cy="60" r="48" fill="none" stroke-width="5"/>` +
    `<circle class="fg" cx="60" cy="60" r="48" fill="none" stroke-width="5" stroke-linecap="round" ` +
    `stroke-dasharray="${(C * f).toFixed(2)} ${C.toFixed(2)}" style="--a:${(C * f).toFixed(2)}" transform="rotate(-90 60 60)"/>` +
    `<text x="60" y="68" text-anchor="middle">${esc(text)}</text></svg>`;
}

function sw(fam, hatch) {
  return `<i class="sw f-${fam}${hatch ? ' hatch' : ''}" aria-hidden="true"></i>`;
}

// Stacked 8px bar. parts: [{fam, value, hatch?}]. label is plain text (escaped here).
function stack(parts, label, mute) {
  const live = parts.filter((p) => p.value > 0);
  const total = live.reduce((a, p) => a + p.value, 0);
  if (!(total > 0 && Number.isFinite(total))) return '';
  const segs = live
    .map((p, i) => `<i class="f-${p.fam}${p.hatch ? ' hatch' : ''}" style="width:${((p.value / total) * 100).toFixed(2)}%;--i:${i}"></i>`)
    .join('');
  const sum = `${label}: ${live.map((p) => `${p.name ?? famLabel(p.fam)} ${fmtInt(p.value)}`).join(', ')}`;
  return `<div class="stack${mute ? ' mute' : ''}" role="img" aria-label="${esc(sum)}" title="${esc(sum)}">${segs}</div>`;
}

function famLegend(parts, unit = '') {
  return `<ul class="legend">${parts.filter((p) => p.value > 0)
    .map((p) => `<li class="lg">${sw(p.fam, p.hatch)}${famLabel(p.fam)}<b>${fmtInt(p.value)}${unit}</b></li>`).join('')}</ul>`;
}

function familyParts(items, valueKey = 'messages') {
  const acc = {};
  for (const it of items) {
    const f = family(it.model);
    acc[f] = (acc[f] || 0) + nz(it[valueKey]);
  }
  return FAMILY_ORDER.filter((f) => acc[f] !== undefined).map((f) => ({ fam: f, value: acc[f] }));
}

function details(summary, html) {
  return `<details class="fold"><summary>${esc(summary)}</summary>${html}</details>`;
}

function table(headers, rows) {
  if (rows.length === 0) return noData();
  return `<div class="tw"><table class="utable"><thead><tr>${headers.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead>` +
    `<tbody>${rows.join('')}</tbody></table></div>`;
}

function td(html, num) {
  return `<td${num ? ' class="num"' : ''}>${html}</td>`;
}

function checkRow(status, name, detail) {
  const st = statusOf(status);
  return `<div class="pitem"><span class="dt ${st.cls}" aria-hidden="true"></span>` +
    `<span class="what">${name}</span>${badge(st.cls, st.label)}` +
    `<span class="ev">${detail}</span></div>`;
}

// ---------- Delegation ----------

// Share of output tokens: main / subagent / background (claude-mem, sdk) by model family.
function delegationModel(sv) {
  const rows = arr(sv.delegation).filter((r) => Number.isFinite(r.output7d) && r.output7d > 0);
  const sum = (pred, fam) => rows.filter((r) => pred(r.role) && (!fam || family(r.family) === fam)).reduce((a, r) => a + r.output7d, 0);
  const isMain = (r) => r === 'main';
  const isSub = (r) => r === 'subagent';
  const isBg = (r) => !isMain(r) && !isSub(r);
  const total = rows.reduce((a, r) => a + r.output7d, 0);
  const subFam = (f) => sum(isSub, f);
  const mainFam = (f) => sum(isMain, f);
  const bg = sum(isBg);
  const execTotal = sum(isMain) + sum(isSub);
  return {
    total, bg, mainFam, subFam, main: sum(isMain), sub: sum(isSub),
    // Execution share: Sonnet/Haiku subagents over main + all subagents; claude-mem and sdk are excluded.
    share: execTotal > 0 ? (subFam('sonnet') + subFam('haiku')) / execTotal : NaN,
  };
}

// Donut of main / subagent / background output tokens. Arcs are stroke-dasharray segments of one circle.
function donut(segs, total, centre, label, aria) {
  const R = 46;
  const C = 2 * Math.PI * R;
  let off = 0;
  const arcs = segs.filter((g) => g.value > 0).map((g) => {
    const len = (g.value / total) * C;
    const gap = len > 3 ? 1.5 : 0;
    const el = `<circle class="d-${g.k}" cx="60" cy="60" r="${R}" stroke-dasharray="${(len - gap).toFixed(2)} ${(C - len + gap).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 60 60)"><title>${esc(`${g.name} ${pct01(g.value / total)}`)}</title></circle>`;
    off += len;
    return el;
  }).join('');
  return `<svg class="dn" viewBox="0 0 120 120" role="img" aria-label="${esc(aria)}"><circle class="tr" cx="60" cy="60" r="${R}"/>${arcs}` +
    `<text class="dv" x="60" y="60" text-anchor="middle">${esc(centre)}</text><text class="dk" x="60" y="78" text-anchor="middle">${esc(label)}</text></svg>`;
}

function delegationBlock(sv) {
  const m = delegationModel(sv);
  if (!(m.total > 0)) return noData();
  const segs = [
    { k: 'main', name: '메인', value: m.main },
    { k: 'sub', name: '서브에이전트', value: m.sub },
    { k: 'bg', name: '백그라운드 (claude-mem·SDK)', value: m.bg },
  ];
  const subPct = pct01(m.sub / m.total);
  const aria = `실행 위임, 7일 출력 토큰: ${segs.map((g) => `${g.name} ${pct01(g.value / m.total)} (${compactKo(g.value)})`).join(', ')}`;
  const legend = `<ul class="dlg">${segs.map((g) => `<li><i class="sw d-${g.k}" aria-hidden="true"></i><span class="nm" title="${esc(g.name)}">${esc(g.name)}</span>` +
    `<b>${pct01(g.value / m.total)}</b><span class="tk">${compactKo(g.value)}</span></li>`).join('')}</ul>`;
  const p = (v) => `${fixed1((v / m.total) * 100)}%`;
  const mainTxt = FAMILY_ORDER.filter((f) => m.mainFam(f) > 0).map((f) => `<span class="sp">${sw(f)}${famLabel(f)} ${p(m.mainFam(f))}</span>`).join('') || DASH;
  const subTxt = SUB_ORDER.filter((f) => f !== 'other' || m.subFam(f) > 0)
    .map((f) => `<span class="sp">${sw(f)}${famLabel(f)} ${p(m.subFam(f))}</span>`).join('');
  const fams = `<div class="dlines"><div><b>메인</b><span class="sps">${mainTxt}</span></div><div><b>서브에이전트</b><span class="sps">${subTxt}</span></div></div>`;
  return `<div class="donut">${donut(segs, m.total, subPct, '서브에이전트', aria)}${legend}</div>` +
    (Number.isFinite(m.share) ? `<p class="cap">실행 위임 비율 ${pct01(m.share)} = 메인+서브 출력 중 Sonnet·Haiku 서브에이전트</p>` : '') +
    details('모델별 비율', fams);
}

// ---------- KPI row ----------

// o.key/o.u: live-delta hook (u "p" = percentage points, "n" = count); o.bar: 0..1 mini bar. note is trusted HTML built from numbers or esc() text.
function kpi(label, value, note, cls, o = {}) {
  const hook = o.key ? ` data-m="${o.key}" data-u="${o.u || 'n'}"` : '';
  const bar = Number.isFinite(o.bar) ? `<div class="mb" role="img" aria-label="${esc(`${label} ${value}`)}"><i style="width:${(clamp(o.bar, 0, 1) * 100).toFixed(1)}%;--i:0"></i></div>` : '';
  return `<div class="kpi"${hook}><div class="k" title="${esc(label)}">${esc(label)}</div><div class="vr"><div class="v${cls ? ` ${cls}` : ''}">${value}</div><span class="dl" aria-hidden="true"></span></div>` +
    `${bar}<div class="ft"><div class="n" title="${note}">${note}</div><div class="sl"></div></div></div>`;
}

// The three live cards shared by the Overview row and the Savings row; withBar adds the mini bar.
function coreKpis(d, withBar) {
  const sv = isObj(d.savings) ? d.savings : {};
  const rtk = isObj(sv.rtk) ? sv.rtk : {};
  const cache = isObj(sv.cache) ? sv.cache : {};
  const share = delegationModel(sv).share;
  const bar = (v) => (withBar ? v : NaN);
  return kpi('RTK 절감 토큰 (7일)', compactKo(rtk.saved7d), `전체 ${compactKo(rtk.savedAll)} · ${pctValue(rtk.savedPct)}`, '', { key: 'rtk', u: 'n', bar: bar(Number.isFinite(rtk.savedPct) ? rtk.savedPct / 100 : NaN) }) +
    kpi('캐시 적중률 (7일)', pct01(cache.hitRate7d), `≈ 입력 ${compactKo(cache.savedInputTokens7d)} 미청구`, '', { key: 'hit', u: 'p', bar: bar(cache.hitRate7d) }) +
    kpi('실행 위임 비율', pct01(share), '메인+서브 출력 중 Sonnet·Haiku 서브에이전트 비율', '', { key: 'share', u: 'p', bar: bar(share) });
}

function kpiRow(d) {
  const mem = isObj(d.claudeMem) ? d.claudeMem : {};
  const agents = arr(isObj(d.routing) ? d.routing.agents : null).filter((a) => typeof a.expected === 'string' && a.expected !== '');
  const okN = agents.filter((a) => a.verdict === 'ok').length;
  const up = reach(mem);
  return `<div class="kpis band">` +
    coreKpis(d, false) +
    kpi('라우팅 일치', agents.length ? `${okN}/${agents.length}` : DASH, '기대 모델이 있는 에이전트 기준') +
    kpi('claude-mem 상태', up.label, `워커 ${txt(mem.version)}`, up.st === 'missing' ? 'bad' : '') + `</div>`;
}

// Four small cards for the Savings tab: value, one mini bar, one short note.
function savingsKpis(d) {
  const sv = isObj(d.savings) ? d.savings : {};
  const pony = isObj(sv.ponytail) ? sv.ponytail : {};
  const outPct = Number.isFinite(pony.outputTokensPct) ? clamp(pony.outputTokensPct, 0, 100) : NaN;
  return `<div class="kpis band k4">` +
    coreKpis(d, true) +
    kpi('Ponytail 출력 토큰', Number.isFinite(outPct) ? pctValue(outPct) : DASH, Number.isFinite(outPct) ? `기준선 대비 ▼${fixed1(100 - outPct)}%` : DASH, '', { bar: Number.isFinite(outPct) ? outPct / 100 : NaN }) +
    `</div>`;
}

// Running-now summary chip (global over all sessions). data-m lets the live script flash it when the count changes.
function runInfo(d) {
  const sessions = arr(isObj(d.orchestration) ? d.orchestration.sessions : null);
  const run = sessions.reduce((a, x) => a + arr(x.agents).filter((g) => g.live === true).length, 0);
  return { run, live: sessions.filter((x) => x.live === true).length };
}

function runChip(d) {
  const r = runInfo(d);
  return `<p class="runline"><span class="pip${r.run > 0 ? ' live' : ''}" aria-hidden="true"></span><span>지금 실행 중 <b>${r.run}</b> · 세션 ${r.live}</span></p>`;
}

// ---------- Flowchart (root node, stem, tree of subagent nodes) ----------

function durKo(a, b) {
  const s = parseTime(a);
  const e = parseTime(b);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return '';
  const m = Math.round((e - s) / 60000);
  if (m < 1) return '1분 미만';
  return m >= 60 ? `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}` : `${m}분`;
}

// Family as a 6px colour dot followed by plain text.
function famDot(f) {
  return `<span class="fc f-${f}"><i class="dot"></i>${famLabel(f)}</span>`;
}

// Plan = main thread, execute = subagents, verify = reviewer/qa style agents.
function phaseOf(a) {
  return typeof a.agentType === 'string' && /review|qa|verif/i.test(a.agentType) ? '검증' : '실행';
}

function node(a, no, idx) {
  const f = family(a.model);
  const exp = typeof a.expected === 'string' ? a.expected : '';
  const live = a.live === true;
  const meta = [phaseOf(a), live ? '진행 중' : durKo(a.start, a.end), Number.isFinite(a.messages) ? `${fmtInt(a.messages)}건` : '']
    .filter(Boolean).join(' · ');
  return `<div class="nd${live ? ' run' : ''}" style="--i:${idx}"><span class="ah"></span><span class="tr"></span>` +
    `<div class="n1"><span class="no">${no}</span>${live ? '<span class="pip live" title="진행 중"></span>' : ''}` +
    `<span class="nm" title="${esc(a.agentType ?? '')}">${txt(a.agentType)}</span></div>` +
    `<div class="n2">${famDot(f)}${verdictBadge(a.verdict)}</div>` +
    `<div class="n3">${esc(meta)}</div>` +
    `${exp && family(exp) !== f ? `<div class="n3 diff">기대 ${esc(exp)} → 실제 ${f === 'other' ? esc(a.model ?? DASH) : f}</div>` : ''}</div>`;
}

function tree(root, list, cmp) {
  if (list.length === 0) return `<div class="tree">${root}<p class="cap">서브에이전트 없음</p></div>`;
  return `<div class="tree">${root}<div class="stem"><span>위임</span></div>` +
    `<div class="nodes${cmp ? ' cmp' : ''}">${list.map((x, i) => node(x.a, x.no, i)).join('')}</div></div>`;
}

function sessionHead(sess) {
  const id = typeof sess.sessionId === 'string' ? sess.sessionId.slice(0, 8) : '';
  const label = txt(sess.projectName);
  return `<div class="sh"><span class="sid">${txt(id)}</span><span class="pj" title="${label}">${label}</span>` +
    `<span class="rg">${esc(rangeKo(sess.start, sess.end))}</span>${sess.live === true ? liveBadge() : ''}</div>`;
}

// Nodes are numbered in start-time order. When there are more than maxNodes, the running and most recent ones are drawn
// and the rest go into details (or a link in the compact variant).
function sessionBlock(sess, maxNodes, compact) {
  const models = arr(isObj(sess.main) ? sess.main.models : null).filter((m) => Number.isFinite(m.messages));
  const top = models.reduce((best, m) => (best === null || m.messages > best.messages ? m : best), null);
  const mf = top ? family(top.model) : 'other';
  const root = `<div class="root"><b>메인 스레드</b><span class="n3">·</span>${top ? famDot(mf) : DASH}</div>`;
  const tv = (v, d) => (Number.isFinite(v) ? v : d);
  const items = arr(sess.agents).map((a, i) => ({ a, i, t: parseTime(a.start) }))
    .sort((x, y) => tv(x.t, 1e18) - tv(y.t, 1e18) || x.i - y.i)
    .map((x, k) => ({ ...x, no: k + 1 }));
  const keep = new Set([...items]
    .sort((x, y) => (y.a.live === true) - (x.a.live === true) || tv(y.t, -1e18) - tv(x.t, -1e18) || x.i - y.i)
    .slice(0, maxNodes).map((x) => x.i));
  const shown = items.filter((x) => keep.has(x.i));
  const rest = items.filter((x) => !keep.has(x.i));
  let body = tree(root, shown, compact);
  if (rest.length) {
    body += compact
      ? `<p class="more">서브에이전트 ${rest.length}개 더 · <a href="#orch">오케스트레이션 탭</a></p>`
      : details(`+${rest.length}개 서브에이전트 더 보기`, tree(root, rest, false));
  }
  return `<div class="sess">${sessionHead(sess)}${body}</div>`;
}

function flowLegend() {
  return `<ul class="legend" aria-label="범례"><li class="lg"><span aria-hidden="true">↓</span>위임</li>` +
    `<li class="lg"><span class="pip live" aria-hidden="true"></span>진행 중</li>` +
    `${FAM_ITEMS}</ul><p class="cap">계획 = 메인(Opus) → 실행 = Sonnet·Haiku → 검증 = Opus (reviewer·qa)</p>`;
}

// ---------- Tokens ----------

function tokenGroups(days) {
  const by = new Map();
  for (const r of days) {
    const key = typeof r.date === 'string' ? r.date : '';
    if (!by.has(key)) by.set(key, { date: key, fam: { opus: 0, sonnet: 0, haiku: 0, other: 0 }, total: 0, inp: 0, cr: 0, cc: 0 });
    const g = by.get(key);
    const out = nz(r.output);
    g.fam[family(r.model)] += out;
    g.total += out;
    g.inp += nz(r.input);
    g.cr += nz(r.cacheRead);
    g.cc += nz(r.cacheCreation);
  }
  return [...by.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// Day cache hit rate (0..1) from the summed token counts; NaN when the day has no input.
function dayHit(g) {
  const den = g.inp + g.cr + g.cc;
  return den > 0 ? g.cr / den : NaN;
}

function dayKo(d) {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(d);
  return m ? `${Number(m[1])}월 ${Number(m[2])}일` : DASH;
}

// Stacked columns by family in a fixed-height box (y max = tallest total + 10%), plus a thin cache-hit line on a right 0-100% axis.
// The line is drawn per column as a segment from this column's centre to the next one, so it stays aligned with the flex layout.
function colChart(groups, h, label) {
  const max = Math.max(0, ...groups.map((g) => g.total));
  if (!(max > 0 && Number.isFinite(max))) return noData();
  const hits = groups.map(dayHit);
  const anyHit = hits.some(Number.isFinite);
  const y = (v) => (h * (1 - clamp(v, 0, 1))).toFixed(1);
  const cols = groups.map((g, gi) => {
    const segs = [...FAMILY_ORDER].reverse()
      .filter((f) => g.fam[f] > 0)
      .map((f) => `<i class="sg f-${f}" style="height:${((g.fam[f] / (max * 1.1)) * h).toFixed(1)}px" title="${esc(`${famLabel(f)} ${fmtInt(g.fam[f])}`)}"></i>`).join('');
    const day = g.date ? g.date.slice(5).replace('-', '/') : DASH;
    const hv = hits[gi];
    let line = '';
    if (Number.isFinite(hv)) {
      const seg = Number.isFinite(hits[gi + 1]) ? `<line x1="0" y1="${y(hv)}" x2="100%" y2="${y(hits[gi + 1])}"/>` : '';
      line = `<svg class="hl">${seg}<circle cx="0" cy="${y(hv)}" r="3.5" tabindex="0"><title>${esc(`${dayKo(g.date)} 캐시 적중률 ${pct01(hv)} · 출력 ${compactKo(g.total)}`)}</title></circle></svg>`;
    }
    return `<div class="cd" data-d="${esc(g.date)}" style="--i:${gi}"><div class="stk" style="height:${h}px">${segs}${line}</div>` +
      `<span class="cl">${esc(day)}<span class="cv-v">${compactKo(g.total)}</span></span></div>`;
  }).join('');
  const sum = `${label}: ${groups.map((g, i) => `${dayKo(g.date)} ${compactKo(g.total)}${Number.isFinite(hits[i]) ? ` 적중률 ${pct01(hits[i])}` : ''}`).join(', ')}`;
  const axis = anyHit ? `<div class="yax" style="height:${h + 14}px" aria-hidden="true"><span>100%</span><span>50%</span><span>0%</span></div>` : '';
  return `<div class="chart"><div class="cols" role="group" aria-label="${esc(sum)}">${cols}</div>${axis}</div>`;
}

const FAM_ITEMS = FAMILY_ORDER.map((f) => `<li class="lg">${sw(f)}${famLabel(f)}</li>`).join('');
const TOK_LEGEND = `<ul class="legend">${FAM_ITEMS}<li class="lg"><i class="sw ln" aria-hidden="true"></i>캐시 적중률 (우축)</li></ul>`;

function tokenTable(days, t) {
  const rows = days.map((r) => `<tr>${td(txt(r.date))}${td(txt(r.model))}${td(fmtInt(r.input), 1)}${td(fmtInt(r.output), 1)}` +
    `${td(fmtInt(r.cacheRead), 1)}${td(fmtInt(r.cacheCreation), 1)}${td(pct01(r.hitRate), 1)}</tr>`);
  rows.push(`<tr>${td('합계')}${td('전체 모델')}${td(fmtInt(t.input), 1)}${td(fmtInt(t.output), 1)}` +
    `${td(fmtInt(t.cacheRead), 1)}${td(fmtInt(t.cacheCreation), 1)}${td(pct01(t.hitRate), 1)}</tr>`);
  return table(['날짜', '모델', '입력', '출력', '캐시 읽기', '캐시 생성', '적중률'], rows);
}

// ---------- Views ----------

// Compact status list: one line per item (dot, name, state on the right).
function overviewChecklist(d) {
  const plugins = arr(isObj(d.plugins) ? d.plugins.items : null);
  const hooks = arr(isObj(d.hooks) ? d.hooks.items : null);
  const mem = isObj(d.claudeMem) ? d.claudeMem : null;
  const row = (status, name, state) => {
    const st = statusOf(status);
    return `<div class="lrow"><span class="dt ${st.cls}" aria-hidden="true"></span><span class="ln" title="${name}">${name}</span><span class="lv ${st.cls}">${state}</span></div>`;
  };
  const items = (list, label) => (list.length ? list.map((i) => row(i.status, txt(i.name), esc(statusOf(i.status).label))).join('') : row('missing', label, '데이터 없음'));
  const up = mem ? reach(mem) : null;
  return `<div class="pitems">` + items(plugins, '플러그인') + items(hooks, '훅') +
    row(up ? up.st : 'missing', 'claude-mem 워커', up ? `${esc(up.label)} · ${txt(mem.version)}` : '데이터 없음') + `</div>`;
}

function viewOverview(d) {
  const orch = isObj(d.orchestration) ? d.orchestration : null;
  const first = orch ? arr(orch.sessions)[0] : undefined;
  const tk = isObj(d.tokens) ? d.tokens : null;
  const daily = panel('일별 출력 토큰', tk, (s) => {
    const days = arr(s.days);
    if (days.length === 0) return noData();
    return colChart(tokenGroups(days), 128, '최근 7일 일별 출력 토큰, 계열별 누적') + TOK_LEGEND;
  }, { hint: '최근 7일', cls: 'c8' });
  const deleg = panel('실행 위임', d.savings, (s) => delegationBlock(s), { hint: '7일 출력 토큰', cls: 'c4' });
  const flow = panel('최근 세션 흐름', orch, () => (first ? runChip(d) + sessionBlock(first, 4, true) : noData()), { hint: '가장 최근 세션', cls: 'c8' });
  const check = panel('상태 점검', {}, () => overviewChecklist(d), { cls: 'c4' });
  return `${kpiRow(d)}<div class="g12">${daily}${deleg}${flow}${check}</div>`;
}

function viewOrchestration(d) {
  return panel('오케스트레이션', d.orchestration, (s) => {
    const all = arr(s.sessions);
    const block = (x) => sessionBlock(x, 6, false);
    const older = all.slice(3);
    return runChip(d) + flowLegend() + all.slice(0, 3).map(block).join('') +
      (older.length ? details(`이전 세션 ${older.length}개`, older.map(block).join('')) : '');
  }, { hint: '최근 7일 · 최신순 · 계획·검증 Opus, 실행 Sonnet/Haiku', isEmpty: (s) => arr(s.sessions).length === 0 });
}

// Expected-vs-actual matrix: one row per agent, columns Opus / Sonnet / Haiku. Bar length = share of the agent's messages.
const MX_FAMS = ['opus', 'sonnet', 'haiku'];

function matrixRow(a) {
  const name = typeof a.agentType === 'string' ? a.agentType : '';
  const exp = typeof a.expected === 'string' ? a.expected : '';
  const ef = exp ? family(exp) : 'other';
  const msgs = { opus: 0, sonnet: 0, haiku: 0, other: 0 };
  for (const m of arr(a.models)) msgs[family(m.model)] += nz(m.messages);
  const total = FAMILY_ORDER.reduce((x, f) => x + msgs[f], 0);
  const pc = (v) => (v <= 0 || total <= 0 ? DASH : v / total < 0.005 ? '<1%' : `${Math.round((v / total) * 100)}%`);
  const cells = MX_FAMS.map((f) => {
    const v = msgs[f];
    const mm = f !== ef && v > 0 && ef !== 'other';
    const w = v > 0 ? Math.max(3, Math.round((v / total) * 100)) : 0;
    return `<span class="mc f-${f}${f === ef ? ' ex' : ''}${mm ? ' mm' : ''}${v > 0 ? '' : ' z'}"><span class="mp">${pc(v)}</span><span class="mb"><i style="width:${w}%"></i></span></span>`;
  }).join('');
  const verdict = pick(VERDICT, a.verdict, { cls: 'info', label: DASH });
  const aria = `${name || DASH}, 기대 ${ef === 'other' ? DASH : famLabel(ef)}, ${MX_FAMS.map((f) => `${famLabel(f)} ${pc(msgs[f])}`).join(', ')}${msgs.other > 0 ? `, 기타 ${pc(msgs.other)}` : ''}, 실행 ${fmtInt(a.runs)}회, ${verdict.label}`;
  return `<div class="mr" role="img" aria-label="${esc(aria)}"><span class="who"><span class="nm" title="${esc(name)}">${txt(a.agentType)}</span>` +
    `<span class="sb">실행 ${fmtInt(a.runs)} ${badge(verdict.cls, verdict.label)}${msgs.other > 0 ? `<span>기타 ${pc(msgs.other)}</span>` : ''}</span></span>${cells}</div>`;
}

function matrix(list, bare) {
  const head = `<div class="mr mh" aria-hidden="true"><span></span>${MX_FAMS.map((f) => `<span class="f-${f}">${famDot(f)}</span>`).join('')}</div>`;
  return `<div class="mx">${head}${list.map(matrixRow).join('')}</div>` +
    (bare ? '' : `<p class="cap">막대 = 에이전트 메시지 중 비율 · 옅은 칸 = 기대 모델 · 빗금 황갈색 = 기대와 다른 모델</p>`);
}

function viewRouting(d) {
  return panel('모델 라우팅', d.routing, (s) => {
    const agents = arr(s.agents);
    const isNa = (a) => a.verdict === 'n/a';
    const main = arr(s.mainThread);
    const mainParts = familyParts(main);
    const bgItems = arr(s.background).map((b) => ({ fam: family(b.model), value: nz(b.messages), role: b.role })).filter((p) => p.value > 0);
    const bgParts = bgItems.map((p) => ({ fam: p.fam, value: p.value, hatch: true, name: `${pick(ROLE_LABEL, p.role, '기타')} ${famLabel(p.fam)}` }));
    const mainBar = stack(mainParts, '메인 스레드 메시지');
    const mainBlock = `<h3 class="sub">메인 스레드 (메시지)</h3>` + (mainBar ? mainBar + famLegend(mainParts) : noData());
    const bgBlock = bgParts.length
      ? `<h3 class="sub">백그라운드 (claude-mem 관찰자, SDK)</h3>` + stack(bgParts, '백그라운드 메시지', true) +
        `<ul class="legend">${bgItems.map((p) => `<li class="lg">${sw(p.fam, true)}${esc(pick(ROLE_LABEL, p.role, '기타'))} · ${famLabel(p.fam)}<b>${fmtInt(p.value)}</b></li>`).join('')}</ul>`
      : '';
    const na = agents.filter(isNa);
    const rest = agents.filter((a) => !isNa(a));
    const exact = table(['진입점', '모델', '메시지'], main.map((r) => `<tr>${td(txt(r.entrypoint))}${td(txt(r.model))}${td(fmtInt(r.messages), 1)}</tr>`));
    return `<h3 class="sub">서브에이전트 (기대 모델 대비 실제 메시지)</h3>` +
      (rest.length ? matrix(rest) : noData()) +
      (na.length ? details(`해당 없음 에이전트 ${na.length}개`, matrix(na, true)) : '') +
      mainBlock + bgBlock + details('메인 스레드 정확한 수치', exact);
  }, { hint: Number.isFinite(d.routing?.windowDays) ? `최근 ${d.routing.windowDays}일` : '최근 7일' });
}

function viewTokens(d) {
  return panel('토큰 (최근 7일)', d.tokens, (s) => {
    const days = arr(s.days);
    if (days.length === 0) return noData();
    const t = isObj(s.totals) ? s.totals : {};
    const chart = `<h3 class="sub">일별 출력 토큰 (계열별)</h3>` + colChart(tokenGroups(days), 160, '최근 7일 일별 출력 토큰, 계열별 누적') + TOK_LEGEND;
    const side = `<div class="donut">${ring(t.hitRate, pct01(t.hitRate), '캐시 적중률')}` +
      `<div><p class="big">${pct01(t.hitRate)}</p><p class="cap">캐시 적중률 (7일)</p></div></div>` +
      `<div class="tiles">` +
      [['입력', t.input], ['출력', t.output, 'out'], ['캐시 읽기', t.cacheRead], ['캐시 생성', t.cacheCreation]]
        .map(([l, v, k]) => `<div class="tile"${k ? ` data-m="${k}" data-u="n"` : ''}><span class="n">${compactKo(v)}</span><span class="l">${l}</span>${k ? '<div class="sl"><span class="dl" aria-hidden="true"></span></div>' : ''}</div>`).join('') + `</div>`;
    return `<div class="grid2"><div class="col">${chart}</div><div class="col">${side}</div></div>` +
      details('정확한 수치 (표)', tokenTable(days, t));
  }, { hint: '로컬 날짜 · 메시지 ID로 중복 제거' });
}

function ubar(label, frac, value, wide, cls) {
  const w = clamp(Number.isFinite(frac) ? frac : 0, 0, 1) * 100;
  return `<div class="ubar${wide ? ' wide' : ''}${cls ? ` ${cls}` : ''}"><span class="ubar-l" title="${label}">${label}</span>` +
    `<span class="ubar-track" aria-hidden="true"><span class="ubar-fill" style="width:${w.toFixed(1)}%"></span></span>` +
    `<span class="ubar-v">${value}</span></div>`;
}

function rtkPanel(d) {
  return panel('RTK', d.rtk, (s) => {
    const sum = isObj(s.summary) ? s.summary : {};
    const cmds = arr(s.topCommands).sort((a, b) => parseSaved(b.saved) - parseSaved(a.saved));
    const vals = cmds.map((c) => parseSaved(c.saved));
    const max = Math.max(0, ...vals);
    const bars = (from, to) => cmds.slice(from, to).map((c, i) =>
      ubar(txt(c.command), max > 0 ? vals[from + i] / max : 0, `<b>${txt(c.saved)}</b> <i>${txt(c.pct)}</i>`, false, 'rtk')).join('');
    const frac = Number.isFinite(sum.savedPct) ? sum.savedPct / 100 : null;
    return `<div class="donut">${ring(frac, pctValue(sum.savedPct), '절감률')}` +
      `<div><p class="big">${compactKo(sum.savedTokens)}</p><p class="cap">절감 토큰 · 명령 ${fmtInt(sum.commands)}개</p></div></div>` +
      `<h3 class="sub">상위 명령 (절감 토큰)</h3>` +
      (cmds.length ? `<div class="ubars">${bars(0, 5)}</div>` : noData()) +
      (cmds.length > 5 ? details(`나머지 명령 ${cmds.length - 5}개`, `<div class="ubars">${bars(5, cmds.length)}</div>`) : '');
  }, { hint: isObj(d.rtk) && Object.keys(d.rtk).length ? 'RTK가 줄인 명령 출력' : '' });
}

function viewSavings(d) {
  const sv = isObj(d.savings) ? d.savings : null;
  const sub = (k) => (sv && isObj(sv[k]) ? sv[k] : null);
  const cache = panel('캐시', sub('cache'), (s) => {
    const hit = s.hitRate7d;
    return `<div class="donut">${ring(hit, pct01(hit), '캐시 적중률')}` +
      `<div><p class="big">≈ ${compactKo(s.savedInputTokens7d)}</p><p class="cap">미청구 입력 토큰 (7일)</p></div></div>` +
      `<div class="tiles"><div class="tile"><span class="n">${compactKo(s.cacheRead7d)}</span><span class="l">캐시 읽기</span></div>` +
      `<div class="tile"><span class="n">${pct01(hit)}</span><span class="l">적중률</span></div></div>`;
  }, { hint: '이 PC 측정' });
  const mem = panel('claude-mem', sub('claudeMem'), (s) => {
    const since = fmtKo(s.since, true);
    return `<div class="tiles" style="grid-template-columns:repeat(3,minmax(0,1fr))">` +
      [['관측 기록', s.observations], ['세션', s.sessions], ['요약', s.summaries]]
        .map(([l, v]) => `<div class="tile"><span class="n">${fmtInt(v)}</span><span class="l">${l}</span></div>`).join('') + `</div>` +
      (since === DASH ? '' : `<p class="cap">${esc(since)} 이후</p>`);
  }, { hint: '워커 통계' });
  const pony = panel('Ponytail', sub('ponytail'), (s) => {
    const lines = [['줄 수', s.linesPct], ['출력 토큰', s.outputTokensPct], ['비용', s.costPct], ['시간', s.timePct]]
      .map(([l, v]) => (Number.isFinite(v)
        ? ubar(l, clamp(v, 0, 100) / 100, `기준선 대비 ${fixed1(clamp(v, 0, 100))}% · ▼${fixed1(100 - clamp(v, 0, 100))}%`, true)
        : ubar(l, 0, DASH, true))).join('');
    const on = s.enabled === true ? badge('ok', '활성') : s.enabled === false ? badge('info', '비활성') : badge('info', '알 수 없음');
    return `<div>${on}</div><div class="ubars">${lines}</div>` +
      `<p class="cap">공개 벤치마크 수치, 이 PC 측정 아님 · ${txt(s.source)}</p>`;
  }, { hint: '기준선 = 스킬 없는 실행' });
    return `${savingsKpis(d)}<div class="g22">${rtkPanel(d)}${pony}${cache}${mem}</div>`;
}

function viewSettings(d) {
  const mark = (v) => (v === true ? '✓' : v === false ? '✕' : DASH);
  const plugins = panel('플러그인', d.plugins, (s) => `<div class="pitems">${arr(s.items).map((i) => {
    const a = typeof i.installedSha === 'string' ? i.installedSha.slice(0, 8) : '';
    const b = typeof i.pinnedSha === 'string' ? i.pinnedSha.slice(0, 8) : '';
    const sha = a && b ? (a === b ? '해시 ✓' : '해시 ✕') : '해시 –';
    const on = i.enabled === true ? '활성' : i.enabled === false ? '비활성' : '활성 –';
    return checkRow(i.status, txt(i.name), `${on} · 설치 ${txt(i.installedVersion)} · 고정 ${txt(i.pinnedRef)} · ${sha}`);
  }).join('')}</div>`, { hint: '설치 vs 고정', isEmpty: (s) => arr(s.items).length === 0 });
  const hooks = panel('훅', d.hooks, (s) => `<div class="pitems">${arr(s.items).map((i) =>
    checkRow(i.status, txt(i.name), `파일 ${mark(i.fileExists)} · 등록 ${mark(i.registered)}`)).join('')}</div>`,
  { hint: '파일 · 등록', isEmpty: (s) => arr(s.items).length === 0 });
  const mem = panel('claude-mem 워커', d.claudeMem, (s) => {
    const up = reach(s);
    const url = typeof s.url === 'string' ? s.url : '';
    return `<div class="pitems">${checkRow(up.st, '워커 상태', `${up.label} · 버전 ${txt(s.version)}`)}</div>` +
      `<div class="kv"><span>주소</span><span title="${esc(url)}">${txt(url)}</span></div>` +
      `<div class="kv"><span>포트 출처</span><span>${txt(s.portSource)}</span></div>`;
  });
  return `<div class="grid2"><div class="col">${plugins}</div><div class="col">${hooks}</div><div class="col">${mem}</div></div>`;
}

// ---------- Page ----------

const HEAD_SCRIPT = `try{var t=localStorage.getItem('monitor-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;

// Tabs follow location.hash (ids are not element ids, so the browser never jumps); the theme choice is stored in localStorage.
const BODY_SCRIPT = String.raw`(function(){
var ids=${JSON.stringify(TABS.map((t) => t.id))};
var btns=document.querySelectorAll('.tabs button');
var reduce=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
// First visit of a tab in this browser session plays the entrance animation; reloads and revisits render static.
function seen(id){if(/[?&]static/.test(location.search))return true;try{var s=sessionStorage.getItem('monitor-seen')||'';if((','+s+',').indexOf(','+id+',')>=0)return true;sessionStorage.setItem('monitor-seen',s?s+','+id:id);return false}catch(e){return true}}
function countUp(v){v.querySelectorAll('.kpi .v').forEach(function(e){
var t=e.textContent,m=/^([\d,]*\.?\d+)(.*)$/.exec(t);if(!m)return;
var raw=m[1],n=parseFloat(raw.replace(/,/g,'')),dec=(raw.split('.')[1]||'').length,comma=raw.indexOf(',')>=0,t0=null;
function fmt(x){var s=x.toFixed(dec);return comma?s.replace(/\B(?=(\d{3})+(?!\d))/g,','):s}
function step(ts){if(t0===null)t0=ts;var p=Math.min(1,(ts-t0)/700);
if(p<1){e.textContent=fmt(n*(1-Math.pow(1-p,3)))+m[2];requestAnimationFrame(step)}else e.textContent=t}
e.textContent=fmt(0)+m[2];requestAnimationFrame(step)})}
function show(user){var h=location.hash.slice(1);if(ids.indexOf(h)<0)h=ids[0];
ids.forEach(function(i){var v=document.getElementById('v-'+i);if(v)v.hidden=(i!==h)});
btns.forEach(function(b){if(b.getAttribute('data-tab')===h)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});
var v=document.getElementById('v-'+h);if(!v||reduce)return;
if(!seen(h)){v.classList.add('anim');if(h==='ov')countUp(v)}
else if(user){v.classList.remove('fade');void v.offsetWidth;v.classList.add('fade')}}
function top(){var s=document.getElementById('stage');if(s)s.scrollTop=0;window.scrollTo(0,0)}
btns.forEach(function(b){b.addEventListener('click',function(){location.hash=b.getAttribute('data-tab')})});
window.addEventListener('hashchange',function(){show(true);top()});
show(false);
try{var ac=document.querySelector('.tabs button[aria-current]');if(ac)ac.scrollIntoView({inline:'nearest',block:'nearest'})}catch(e){}
var tb=document.getElementById('theme');
if(tb)tb.addEventListener('click',function(){var r=document.documentElement;
var cur=r.getAttribute('data-theme')||(window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
var next=cur==='dark'?'light':'dark';r.setAttribute('data-theme',next);
try{localStorage.setItem('monitor-theme',next)}catch(e){}});
})();`;

// Key numbers for the live script. Numbers only (NaN becomes null); day keys must look like YYYY-MM-DD.
function metrics(d) {
  const sv = isObj(d.savings) ? d.savings : {};
  const tk = isObj(d.tokens) ? d.tokens : {};
  const n = (v) => (Number.isFinite(v) ? v : null);
  const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
  const days = {};
  for (const g of tokenGroups(arr(tk.days))) if (/^\d{4}-\d{2}-\d{2}$/.test(g.date)) days[g.date] = g.total;
  const ri = runInfo(d);
  return {
    rtk: n(isObj(sv.rtk) ? sv.rtk.saved7d : null),
    out: n(isObj(tk.totals) ? tk.totals.output : null),
    hit: r1((isObj(sv.cache) ? sv.cache.hitRate7d : NaN) * 100),
    share: r1(delegationModel(sv).share * 100),
    live: ri.live, run: ri.run, days,
  };
}

// JSON for a <script type="application/json">: "<" is escaped so "</script>" can never close the tag.
function metricsJson(d) {
  let m;
  try {
    m = metrics(d);
  } catch {
    m = {};
  }
  return JSON.stringify(m).replace(/</g, '\\u003c');
}

// Live changes: compares the JSON blob with the previous snapshot (sessionStorage, last 30) and shows deltas, a glow and sparklines.
const LIVE_SCRIPT = String.raw`try{(function(){
var el=document.getElementById('m');if(!el)return;
var cur;try{cur=JSON.parse(el.textContent)}catch(e){return}
if(!cur||typeof cur!=='object')return;
var reduce=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
var KEYS=['rtk','out','hit','share','live','run'];
var hist=[];try{hist=JSON.parse(sessionStorage.getItem('monitor-hist')||'[]');if(!Array.isArray(hist))hist=[];hist=hist.filter(function(h){return h&&typeof h==='object'})}catch(e){hist=[]}
var prev=hist.length?hist[hist.length-1]:null;if(!prev||typeof prev!=='object')prev=null;
function num(v){return typeof v==='number'&&isFinite(v)}
function f1(x){return String(Math.round(x*10)/10)}
function ko(a){return a>=1e8?f1(a/1e8)+'억':a>=1e4?f1(a/1e4)+'만':String(Math.round(a))}
function delta(u,a,b){var d=a-b;
if(u==='p'){d=Math.round(d*10)/10;return d?(d>0?'▲':'▼')+f1(Math.abs(d))+'%p':''}
d=Math.round(d);return d?(d>0?'+':'-')+ko(Math.abs(d)):''}
var changed=false,i;
if(prev){for(i=0;i<KEYS.length;i++){if(cur[KEYS[i]]!==prev[KEYS[i]])changed=true}
var pd=prev.days||{},cd=cur.days||{};for(var k in cd){if(cd[k]!==pd[k])changed=true}}
function flash(n){if(reduce)return;n.classList.add('hot');setTimeout(function(){n.classList.remove('hot')},300)}
function spark(box,key){
var pts=hist.concat([cur]).map(function(h){return h[key]}).filter(num);
if(pts.length<2||!box)return;
var lo=Math.min.apply(null,pts),hi=Math.max.apply(null,pts),r=hi-lo,ns='http://www.w3.org/2000/svg';
var xy=pts.map(function(v,j){return (j*(64/(pts.length-1))).toFixed(1)+','+(r?(14-(v-lo)/r*12):8).toFixed(1)}).join(' ');
var old=box.querySelector('svg');if(old)box.removeChild(old);
var s=document.createElementNS(ns,'svg');s.setAttribute('width','64');s.setAttribute('height','16');s.setAttribute('viewBox','0 0 64 16');
s.setAttribute('role','img');s.setAttribute('aria-label','최근 '+pts.length+'회 추이: '+f1(pts[0])+' → '+f1(pts[pts.length-1]));
var p=document.createElementNS(ns,'polyline');p.setAttribute('points',xy);s.appendChild(p);box.appendChild(s)}
var nodes=document.querySelectorAll('[data-m]');
for(i=0;i<nodes.length;i++){(function(n){var key=n.getAttribute('data-m'),u=n.getAttribute('data-u');
var a=cur[key],b=prev?prev[key]:null,t='';
if(prev&&num(a)&&num(b)&&a!==b){t=u?delta(u,a,b):'';if(t&&n.classList.contains('kpi'))flash(n)}
var dl=n.querySelector('.dl');
if(dl&&t){dl.textContent=t;dl.className+=a>b?' pos':' neg';if(reduce)dl.className+=' on';else requestAnimationFrame(function(){requestAnimationFrame(function(){dl.className+=' on'})})}
spark(n.querySelector('.sl'),key)})(nodes[i])}
hist.push(cur);if(hist.length>30)hist=hist.slice(-30);
try{sessionStorage.setItem('monitor-hist',JSON.stringify(hist))}catch(e){}
var lc=document.getElementById('lc');
if(lc){var t2=null;try{t2=sessionStorage.getItem('monitor-lc')}catch(e){}
if(changed){var n=new Date(),p2=function(x){return String(x).padStart(2,'0')};t2=p2(n.getHours())+':'+p2(n.getMinutes())+':'+p2(n.getSeconds());
try{sessionStorage.setItem('monitor-lc',t2)}catch(e){}}
if(t2)lc.textContent=t2}
})()}catch(e){}`;

function tabsNav() {
  const html = TABS.map((t) => `<button type="button" data-tab="${t.id}"${t.id === 'ov' ? ' aria-current="page"' : ''}>${esc(t.label)}</button>`).join('');
  return `<nav class="tabs" aria-label="화면 탭">${html}</nav>`;
}

// Runs a view builder; a throw becomes "데이터 없음" so one bad field never blanks the page.
function safe(fn, d) {
  try {
    return fn(d);
  } catch {
    return noData();
  }
}

export function render(data) {
  const d = isObj(data) ? data : {};
  const sec = Number.isFinite(d.refreshSec) && d.refreshSec > 0 ? Math.min(86400, Math.max(1, Math.round(d.refreshSec))) : 0;
  const mode = sec ? `<span class="st live"><span class="pip"></span>실시간 · ${sec}초마다<span class="lcw">&nbsp;· 마지막 변경 <span id="lc">${esc(fmtHms(d.generatedAt))}</span></span></span>` : badge('info', '스냅샷');
  const views = [viewOverview, viewOrchestration, viewRouting, viewTokens, viewSavings, viewSettings];
  const sections = TABS.map((t, i) =>
    `<section class="view" id="v-${t.id}" aria-label="${esc(t.label)}"${i === 0 ? '' : ' hidden'}>${safe(views[i], d)}</section>`).join('\n');
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>클로드 설정 모니터</title>
<style>${CSS}</style>
<script>${HEAD_SCRIPT}</script>
<noscript><style>.view[hidden]{display:flex !important}</style></noscript>
</head>
<body>
<header class="top">
<div class="topin">
<div class="brand"><span class="mark" aria-hidden="true">✻</span><h1>클로드 설정 모니터</h1></div>
${tabsNav()}
<div class="meta">${sec ? '' : `<time>${esc(fmtKo(d.generatedAt, true))}</time>`}${mode}<button class="btn" id="theme" type="button" aria-label="테마 전환 (밝게/어둡게)">테마</button></div>
</div>
${sec ? `<i class="prog" style="animation-duration:${sec}s" aria-hidden="true"></i>` : ''}
</header>
<main class="stage" id="stage">
${sections}
</main>
<script type="application/json" id="m">${metricsJson(d)}</script>
<script>${sec ? `setTimeout(function(){location.reload()},${sec * 1000});` : ''}${BODY_SCRIPT}${LIVE_SCRIPT}</script>
</body>
</html>
`;
}
