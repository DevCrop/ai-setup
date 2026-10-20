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
  { id: 'ov', grp: '요약', label: '개요' },
  { id: 'orch', grp: '구조', label: '오케스트레이션' },
  { id: 'route', grp: null, label: '모델 라우팅' },
  { id: 'tok', grp: '사용량', label: '토큰' },
  { id: 'sav', grp: null, label: '절감 효과' },
  { id: 'set', grp: '상태', label: '설정 상태' },
];


// Bus rules for a tree with n columns: the first node of a row starts the bus at the trunk, the last ends it at its centre,
// and a first-in-row node that is not in the last row also draws the trunk down to the next row.
function treeCss(n, scope) {
  const s = `${scope} .nd`;
  return `${s}:nth-child(${n}n+1)::before { left: -19px; } ${s}:nth-child(${n}n)::before, ${s}:last-child::before { right: 50%; } ` +
    `${s}:nth-child(${n}n+1):not(:nth-last-child(-n+${n})) .tr { display: block; }`;
}

const CSS = `
/* 1 tokens (legacy dashboard). Colour budget: accent only for brand, active nav, live dots and the Opus data colour; the rest is grey. */
:root {
  --bg: #faf9f5; --panel: #ffffff; --line: #e8e6dc; --line-strong: #d3d0c3; --fg: #141413; --muted: #5e5d59; --faint: #7a786f;
  --accent: #d77757; --accent-ink: #b9532f;
  --warn: #8f6420; --bad: #b04a38;
  --f-opus: #d77757; --f-sonnet: #7391b3; --f-haiku: #74a085; --f-other: #a09c92; --hatch: rgba(255, 255, 255, .55);
  --sans: "Pretendard Variable", Pretendard, -apple-system, "Segoe UI", "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif;
  --serif: "Source Serif 4", "Noto Serif KR", Georgia, "Batang", serif;
  --mono: ui-monospace, "Cascadia Mono", "Cascadia Code", Consolas, "D2Coding", "Malgun Gothic", Menlo, monospace;
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-5: 24px; --sp-6: 32px;
  --gap: 16px; --pad: 16px; --edge: 24px; --max: 1440px; --ctl: 36px;
  --r-sm: 6px; --r-md: 8px; --r-lg: 12px;
  --t-xs: 12px; --t-sm: 13px; --t-md: 14px; --t-lg: 16px; --t-h1: 20px;
  --lh: 1.6; --ease: cubic-bezier(.22, .61, .36, 1);
}
@media (max-width: 760px) { :root { --gap: 12px; --pad: 12px; --edge: 16px; --ctl: 40px; } }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #1f1e1d; --panel: #262624; --line: #3a3936; --line-strong: #4a4945; --fg: #e9e7df; --muted: #b7b4aa; --faint: #918f86;
  --accent-ink: #eb9575; --warn: #d9a85a; --bad: #e0816f;
  --f-sonnet: #8aa9cc; --f-haiku: #86b497; --f-other: #a39e94; --hatch: rgba(0, 0, 0, .35); color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #1f1e1d; --panel: #262624; --line: #3a3936; --line-strong: #4a4945; --fg: #e9e7df; --muted: #b7b4aa; --faint: #918f86;
  --accent-ink: #eb9575; --warn: #d9a85a; --bad: #e0816f;
  --f-sonnet: #8aa9cc; --f-haiku: #86b497; --f-other: #a39e94; --hatch: rgba(0, 0, 0, .35); color-scheme: dark; }

/* 2 base */
* { box-sizing: border-box; }
html, body { height: 100%; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 400 var(--t-md)/var(--lh) var(--sans); font-variant-numeric: tabular-nums; -webkit-text-size-adjust: 100%; }
button { font: inherit; cursor: pointer; }
a { color: var(--fg); text-decoration: underline; text-underline-offset: 2px; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.view[hidden] { display: none !important; }
.hatch { background-image: repeating-linear-gradient(45deg, transparent 0 4px, var(--hatch) 4px 8px); }
.f-opus { --fc: var(--f-opus); } .f-sonnet { --fc: var(--f-sonnet); } .f-haiku { --fc: var(--f-haiku); } .f-other { --fc: var(--f-other); }

/* 3 layout: sidebar + header + one scrolling stage; below 1100 the sidebar is a tab bar under the header */
.app { display: grid; grid-template-columns: 208px minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); grid-template-areas: "side top" "side stage"; min-height: 100%; }
@media (min-width: 1100px) { .app { height: 100%; } .stage { overflow-y: auto; } }
.side { grid-area: side; background: var(--panel); border-right: 1px solid var(--line); padding: var(--sp-4) var(--sp-3); display: flex; flex-direction: column; gap: 2px; align-content: start; overflow-y: auto; }
.side .grp { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--faint); padding: var(--sp-4) var(--sp-3) var(--sp-1); }
.side .grp:first-child { padding-top: var(--sp-1); }
.side button { display: flex; align-items: center; min-height: 32px; text-align: left; font-size: var(--t-sm); color: var(--muted); background: none; border: 0; border-radius: var(--r-sm); padding: 0 var(--sp-3); }
.side button:hover { color: var(--fg); background: var(--bg); }
.side button[aria-current="page"] { color: var(--fg); background: var(--bg); box-shadow: inset 2px 0 0 var(--accent); }
.top { grid-area: top; position: sticky; top: 0; z-index: 5; display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3) var(--sp-4); padding: var(--sp-3) var(--edge); background: var(--bg); border-bottom: 1px solid var(--line); min-width: 0; }
.brand { display: flex; align-items: center; gap: var(--sp-3); min-width: 0; }
.mark { color: var(--accent); font-size: var(--t-lg); }
.brand h1 { margin: 0; font-family: var(--serif); font-size: var(--t-h1); font-weight: 500; line-height: 1.3; white-space: nowrap; }
.meta { display: flex; align-items: center; gap: var(--sp-3); min-width: 0; }
.meta time { font-size: var(--t-xs); color: var(--muted); white-space: nowrap; }
.stage { grid-area: stage; min-width: 0; min-height: 0; padding: var(--gap) var(--edge) var(--edge); }
.view { width: 100%; max-width: var(--max); margin-inline: auto; display: flex; flex-direction: column; gap: var(--gap); min-width: 0; }
.col { display: flex; flex-direction: column; gap: var(--gap); min-width: 0; }
.kpis { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: var(--gap); }
.ov { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gap); align-items: start; }
.grid2 { display: grid; gap: var(--gap); grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); align-items: start; }
@media (max-width: 1099px) {
  .app { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto; grid-template-areas: "top" "side" "stage"; }
  .side { position: sticky; top: 0; z-index: 6; flex-direction: row; overflow-x: auto; border-right: 0; border-bottom: 1px solid var(--line); padding: var(--sp-1) var(--edge); gap: var(--sp-1); scrollbar-width: thin; }
  .side .grp { display: none; }
  .side button { white-space: nowrap; flex: none; min-height: 36px; }
  .side button[aria-current="page"] { box-shadow: inset 0 -2px 0 var(--accent); }
  .top { position: static; }
  .kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 760px) {
  .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .kpis > :last-child:nth-child(odd) { grid-column: 1 / -1; }
  .ov { grid-template-columns: minmax(0, 1fr); }
  .top { flex-wrap: nowrap; gap: var(--sp-2); padding: var(--sp-2) var(--edge); }
  .brand { gap: var(--sp-2); }
  .brand h1 { font-size: 16px; overflow: hidden; text-overflow: ellipsis; }
  .meta { gap: var(--sp-2); flex: none; }
  .meta time { font-size: 11px; }
  .meta .btn { min-height: 32px; padding: 0 var(--sp-2); }
  .kpi .v { font-size: 22px; }
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
@media (prefers-reduced-motion: reduce) { .live .pip, .pip.live { animation: none !important; } }
.dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--fc, var(--faint)); flex: none; }
.fc { display: inline-flex; align-items: center; gap: 6px; font-size: var(--t-xs); color: var(--fg); white-space: nowrap; }
.btn { display: inline-flex; align-items: center; justify-content: center; min-height: var(--ctl); font-size: var(--t-sm); color: var(--fg); background: var(--panel); border: 1px solid var(--line); border-radius: var(--r-md); padding: var(--sp-1) var(--sp-3); }
.btn:hover { border-color: var(--faint); }

.panel { background: var(--panel); border: 1px solid var(--line); border-radius: var(--r-lg); padding: var(--pad); min-width: 0; display: flex; flex-direction: column; gap: var(--sp-3); overflow: hidden; }
.ph { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: var(--sp-1) var(--sp-3); }
.ph h2 { margin: 0; font-family: var(--serif); font-size: var(--t-lg); font-weight: 500; line-height: 1.4; }
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
.kpi { border: 1px solid var(--line); border-radius: var(--r-lg); background: var(--panel); padding: var(--sp-4); display: grid; gap: var(--sp-1); align-content: start; min-width: 0; }
.kpi .k { font-size: var(--t-xs); color: var(--muted); }
.kpi .v { font-size: 24px; font-weight: 500; line-height: 1.2; overflow-wrap: anywhere; }
.kpi .v.bad { color: var(--bad); }
.kpi .n { font-size: var(--t-xs); color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
@media (max-width: 760px) { .kpi { padding: var(--sp-3); } }

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
.ubars { display: grid; gap: var(--sp-3); }

.pitems { display: flex; flex-direction: column; }
.pitem { display: grid; grid-template-columns: 6px minmax(0, 1fr) auto; gap: 2px var(--sp-3); padding: var(--sp-3) 0; border-bottom: 1px solid var(--line); align-items: center; font-size: var(--t-sm); min-width: 0; }
.pitem:first-child { padding-top: 0; } .pitem:last-child { border-bottom: 0; padding-bottom: 0; }
.pitem .what { overflow-wrap: anywhere; font-weight: 500; min-width: 0; }
.pitem .ev { grid-column: 2 / -1; color: var(--muted); font-size: var(--t-xs); overflow-wrap: anywhere; min-width: 0; }
.dt { width: 6px; height: 6px; border-radius: 50%; background: var(--line-strong); }
.dt.warn { background: var(--warn); } .dt.bad { background: var(--bad); }

.rt { display: grid; grid-template-columns: minmax(96px, 1.1fr) 104px minmax(100px, 3fr) 64px 76px; gap: var(--sp-1) var(--sp-3); align-items: center; padding: var(--sp-2) 0; border-bottom: 1px solid var(--line); font-size: var(--t-sm); min-width: 0; }
.rt:first-child { padding-top: 0; } .rt:last-child { border-bottom: 0; padding-bottom: 0; }
.rt .nm { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.rt .runs { font-size: var(--t-xs); color: var(--muted); white-space: nowrap; }
.rt .st { justify-self: start; }
.exp { display: inline-flex; align-items: center; gap: 6px; font-size: var(--t-xs); color: var(--muted); white-space: nowrap; }
@media (max-width: 640px) {
  .rt { grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "nm vd" "ch rn" "bar bar"; }
  .rt .nm { grid-area: nm; } .rt .st { grid-area: vd; justify-self: end; } .rt .exp { grid-area: ch; } .rt .runs { grid-area: rn; text-align: right; } .rt .stack { grid-area: bar; }
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
.stk { display: flex; flex-direction: column; justify-content: flex-end; border-bottom: 1px solid var(--line-strong); }
.stk .cv-v { font-size: 11px; line-height: 14px; color: var(--muted); text-align: center; white-space: nowrap; }
.stk .sg { background-color: var(--fc); display: block; flex: none; width: 100%; max-width: 44px; margin-inline: auto; min-height: 1px; }
.stk .sg:first-of-type { border-radius: 3px 3px 0 0; }
.cd .cl { font-size: 11px; line-height: 14px; color: var(--muted); text-align: center; white-space: nowrap; }

/* 5 views: orchestration flowchart. Neutral root and node cards; 1px grey connectors: a stem, a trunk on the left, a bus per row, a tick into each node. */
.tree { min-width: 0; }
.root { display: flex; align-items: center; flex-wrap: wrap; gap: var(--sp-3); width: max-content; max-width: 100%; padding: 10px var(--sp-3); border: 1px solid var(--line); border-radius: 10px; background: var(--panel); font-size: var(--t-sm); }
.root b { font-weight: 500; }
.n3 { font-size: var(--t-xs); color: var(--muted); overflow-wrap: anywhere; }
.n3.diff { color: var(--warn); }
.stem { position: relative; height: 28px; width: 1px; margin-left: 15px; background: var(--line-strong); }
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
.nd.run::before { background: repeating-linear-gradient(to right, var(--accent) 0 4px, transparent 4px 8px) 0 0 / 8px 1px repeat-x; }
.nd.run::after { background: repeating-linear-gradient(to bottom, var(--accent) 0 4px, transparent 4px 8px) 0 0 / 1px 8px repeat-y; }
.nd.run .ah { border-top-color: var(--accent); }
@media (max-width: 640px) { ${treeCss(2, '.nodes:not(.cmp)')} }
@media (min-width: 641px) and (max-width: 1099px) { .nodes:not(.cmp) { --n: 3; } ${treeCss(3, '.nodes:not(.cmp)')} }
@media (min-width: 1100px) { .nodes:not(.cmp) { --n: 4; } ${treeCss(4, '.nodes:not(.cmp)')} }
${treeCss(2, '.nodes.cmp')}
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
@keyframes ndin { from { opacity: 0; transform: translateY(8px); } }
@keyframes draw { from { stroke-dashoffset: var(--a); } }
@keyframes dashx { to { background-position: 8px 0; } }
@keyframes dashy { to { background-position: 0 8px; } }
@media (prefers-reduced-motion: no-preference) {
  .view.fade { animation: fadein .15s ease; }
  .anim .stack i, .anim .ubar-fill { transform-origin: left; animation: grow .6s var(--ease) both; animation-delay: calc(var(--i, 0) * 60ms); }
  .anim .stk .sg { transform-origin: bottom; animation: growy .6s var(--ease) both; animation-delay: calc(var(--i, 0) * 50ms); }
  .anim .cv-v { animation: fadein .4s .5s both; }
  .anim .ring .fg { animation: draw .9s var(--ease) both; }
  .anim .root { animation: ndin .4s var(--ease) both; }
  .anim .stem { transform-origin: top; animation: growy .3s .15s var(--ease) both; }
  .anim .nd { animation: ndin .4s var(--ease) both; animation-delay: calc(var(--i, 0) * 50ms + 120ms); }
  .anim .nd::before { transform-origin: left; animation: grow .35s var(--ease) both; animation-delay: calc(var(--i, 0) * 50ms + 80ms); }
  .anim .nd::after, .anim .nd .tr { transform-origin: top; animation: growy .3s var(--ease) both; animation-delay: calc(var(--i, 0) * 50ms + 120ms); }
  .nd.run::before { animation: dashx 2.4s linear infinite; }
  .nd.run::after { animation: dashy 2.4s linear infinite; }
  .anim .nd.run::before { animation: grow .35s var(--ease) both, dashx 2.4s linear infinite; animation-delay: calc(var(--i, 0) * 50ms + 80ms), 0s; }
  .anim .nd.run::after { animation: growy .3s var(--ease) both, dashy 2.4s linear infinite; animation-delay: calc(var(--i, 0) * 50ms + 120ms), 0s; }
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
  return `<section class="panel"><div class="ph"><h2>${esc(title)}</h2>` +
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
    total, bg, mainFam, subFam,
    // Execution share: Sonnet/Haiku subagents over main + all subagents; claude-mem and sdk are excluded.
    share: execTotal > 0 ? (subFam('sonnet') + subFam('haiku')) / execTotal : NaN,
  };
}

function delegationBlock(sv) {
  const m = delegationModel(sv);
  if (!(m.total > 0)) return noData();
  const parts = [
    ...FAMILY_ORDER.map((f) => ({ fam: f, value: m.mainFam(f), name: `메인 ${famLabel(f)}` })),
    ...SUB_ORDER.map((f) => ({ fam: f, value: m.subFam(f), name: `서브에이전트 ${famLabel(f)}` })),
    { fam: 'other', value: m.bg, hatch: true, name: '백그라운드 claude-mem·SDK' },
  ];
  const p = (v) => `${fixed1((v / m.total) * 100)}%`;
  const mainTxt = FAMILY_ORDER.filter((f) => m.mainFam(f) > 0).map((f) => `<span class="sp">${sw(f)}${famLabel(f)} ${p(m.mainFam(f))}</span>`).join('') || DASH;
  const subTxt = SUB_ORDER.filter((f) => f !== 'other' || m.subFam(f) > 0)
    .map((f) => `<span class="sp">${sw(f)}${famLabel(f)} ${p(m.subFam(f))}</span>`).join('');
  return stack(parts, '출력 토큰 분포') +
    `<div class="dlines"><div><b>메인</b><span class="sps">${mainTxt}</span></div>` +
    `<div><b>서브에이전트</b><span class="sps">${subTxt}</span></div>` +
    `<div><b>백그라운드</b><span class="sps"><span class="sp">${sw('other', true)}claude-mem·SDK ${p(m.bg)} (빗금)</span></span></div></div>`;
}

// ---------- KPI row ----------

function kpi(label, value, note, cls) {
  return `<div class="kpi"><div class="k">${esc(label)}</div><div class="v${cls ? ` ${cls}` : ''}">${value}</div><div class="n" title="${note}">${note}</div></div>`;
}

function kpiRow(d) {
  const sv = isObj(d.savings) ? d.savings : {};
  const rtk = isObj(sv.rtk) ? sv.rtk : {};
  const cache = isObj(sv.cache) ? sv.cache : {};
  const mem = isObj(d.claudeMem) ? d.claudeMem : {};
  const share = delegationModel(sv).share;
  const agents = arr(isObj(d.routing) ? d.routing.agents : null).filter((a) => typeof a.expected === 'string' && a.expected !== '');
  const okN = agents.filter((a) => a.verdict === 'ok').length;
  const up = reach(mem);
  return `<div class="kpis">` +
    kpi('RTK 절감 토큰 (7일)', compactKo(rtk.saved7d), `전체 ${compactKo(rtk.savedAll)} · ${pctValue(rtk.savedPct)}`) +
    kpi('캐시 적중률 (7일)', pct01(cache.hitRate7d), `≈ 입력 ${compactKo(cache.savedInputTokens7d)} 미청구`) +
    kpi('실행 위임 비율', pct01(share), '메인+서브 출력 중 Sonnet·Haiku 서브에이전트 비율') +
    kpi('라우팅 일치', agents.length ? `${okN}/${agents.length}` : DASH, '기대 모델이 있는 에이전트 기준') +
    kpi('claude-mem 상태', up.label, `워커 ${txt(mem.version)}`, up.st === 'missing' ? 'bad' : '') + `</div>`;
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
  const root = `<div class="root"><b>메인 스레드</b>${top ? famDot(mf) : DASH}` +
    `<span class="n3">계획 · 조율</span>${sess.live === true ? '<span class="pip live" title="진행 중"></span>' : ''}</div>`;
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
    `<li class="lg"><span class="pip live" aria-hidden="true"></span>진행 중 (점선 흐름)</li>` +
    `${FAM_ITEMS}</ul><p class="cap">계획 = 메인(Opus) → 실행 = Sonnet·Haiku → 검증 = Opus (reviewer·qa)</p>`;
}

// ---------- Tokens ----------

function tokenGroups(days) {
  const by = new Map();
  for (const r of days) {
    const key = typeof r.date === 'string' ? r.date : '';
    if (!by.has(key)) by.set(key, { date: key, fam: { opus: 0, sonnet: 0, haiku: 0, other: 0 }, total: 0 });
    const g = by.get(key);
    const out = nz(r.output);
    g.fam[family(r.model)] += out;
    g.total += out;
  }
  return [...by.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// Stacked columns by family in a fixed-height box; y max = tallest total + 10%.
function colChart(groups, h, label) {
  const max = Math.max(0, ...groups.map((g) => g.total));
  if (!(max > 0 && Number.isFinite(max))) return noData();
  const cols = groups.map((g, gi) => {
    const segs = [...FAMILY_ORDER].reverse()
      .filter((f) => g.fam[f] > 0)
      .map((f) => `<i class="sg f-${f}" style="height:${((g.fam[f] / (max * 1.1)) * h).toFixed(1)}px" title="${esc(`${famLabel(f)} ${fmtInt(g.fam[f])}`)}"></i>`).join('');
    const day = g.date ? g.date.slice(5).replace('-', '/') : DASH;
    return `<div class="cd" style="--i:${gi}"><div class="stk" style="height:${h}px"><span class="cv-v">${compactKo(g.total)}</span>${segs}</div><span class="cl">${esc(day)}</span></div>`;
  }).join('');
  const dayKo = (d) => { const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(d); return m ? `${Number(m[1])}월 ${Number(m[2])}일` : DASH; };
  const sum = `${label}: ${groups.map((g) => `${dayKo(g.date)} ${compactKo(g.total)}`).join(', ')}`;
  return `<div class="cols" role="img" aria-label="${esc(sum)}">${cols}</div>`;
}

const FAM_ITEMS = FAMILY_ORDER.map((f) => `<li class="lg">${sw(f)}${famLabel(f)}</li>`).join('');
const FAM_LEGEND = `<ul class="legend">${FAM_ITEMS}</ul>`;

function tokenTable(days, t) {
  const rows = days.map((r) => `<tr>${td(txt(r.date))}${td(txt(r.model))}${td(fmtInt(r.input), 1)}${td(fmtInt(r.output), 1)}` +
    `${td(fmtInt(r.cacheRead), 1)}${td(fmtInt(r.cacheCreation), 1)}${td(pct01(r.hitRate), 1)}</tr>`);
  rows.push(`<tr>${td('합계')}${td('전체 모델')}${td(fmtInt(t.input), 1)}${td(fmtInt(t.output), 1)}` +
    `${td(fmtInt(t.cacheRead), 1)}${td(fmtInt(t.cacheCreation), 1)}${td(pct01(t.hitRate), 1)}</tr>`);
  return table(['날짜', '모델', '입력', '출력', '캐시 읽기', '캐시 생성', '적중률'], rows);
}

// ---------- Views ----------

function groupStatus(items) {
  if (items.length === 0) return 'missing';
  if (items.some((i) => i.status === 'missing')) return 'missing';
  return items.every((i) => i.status === 'ok') ? 'ok' : 'warn';
}

function overviewChecklist(d) {
  const plugins = arr(isObj(d.plugins) ? d.plugins.items : null);
  const hooks = arr(isObj(d.hooks) ? d.hooks.items : null);
  const mem = isObj(d.claudeMem) ? d.claudeMem : null;
  const count = (items) => `${items.filter((i) => i.status === 'ok').length}/${items.length} 정상`;
  const up = mem ? reach(mem) : null;
  return `<div class="pitems">` +
    checkRow(groupStatus(plugins), '플러그인', plugins.length ? count(plugins) : '데이터 없음') +
    checkRow(groupStatus(hooks), '훅', hooks.length ? count(hooks) : '데이터 없음') +
    checkRow(up ? up.st : 'missing', 'claude-mem 워커', up ? `${up.label} · 버전 ${txt(mem.version)}` : '데이터 없음') +
    `</div>`;
}

function viewOverview(d) {
  const orch = isObj(d.orchestration) ? d.orchestration : null;
  const first = orch ? arr(orch.sessions)[0] : undefined;
  const tk = isObj(d.tokens) ? d.tokens : null;
  const left = panel('실행 위임', d.savings, (s) => delegationBlock(s), { hint: '최근 7일 출력 토큰 · 전체 대비' }) +
    panel('일별 출력 토큰', tk, (s) => {
      const days = arr(s.days);
      if (days.length === 0) return noData();
      return colChart(tokenGroups(days), 96, '최근 7일 일별 출력 토큰, 계열별 누적') + FAM_LEGEND;
    }, { hint: '최근 7일' });
  const right = panel('최근 세션 흐름', orch, () => (first ? sessionBlock(first, 4, true) : noData()), { hint: '가장 최근 세션' }) +
    panel('상태 점검', {}, () => overviewChecklist(d));
  return `${kpiRow(d)}<div class="ov"><div class="col">${left}</div><div class="col">${right}</div></div>`;
}

function viewOrchestration(d) {
  return panel('오케스트레이션', d.orchestration, (s) => {
    const all = arr(s.sessions);
    const block = (x) => sessionBlock(x, 6, false);
    const older = all.slice(3);
    return flowLegend() + all.slice(0, 3).map(block).join('') +
      (older.length ? details(`이전 세션 ${older.length}개`, older.map(block).join('')) : '');
  }, { hint: '최근 7일 · 최신순 · 계획·검증 Opus, 실행 Sonnet/Haiku', isEmpty: (s) => arr(s.sessions).length === 0 });
}

function agentRow(a) {
  const parts = familyParts(arr(a.models));
  const name = typeof a.agentType === 'string' ? a.agentType : '';
  const exp = typeof a.expected === 'string' && a.expected !== '' ? a.expected : '';
  const ef = family(exp);
  const expHtml = !exp ? `<span class="exp">${DASH}</span>` : ef === 'other' ? `<span class="exp">기대 ${esc(exp)}</span>` : `<span class="exp f-${ef}"><i class="dot"></i>기대 ${famLabel(ef)}</span>`;
  const bar = stack(parts, `${name} 실제 메시지`) || '<span class="cap">데이터 없음</span>';
  return `<div class="rt"><span class="nm" title="${esc(name)}">${txt(a.agentType)}</span>` +
    `${expHtml}${bar}` +
    `<span class="runs">실행 ${fmtInt(a.runs)}</span>${verdictBadge(a.verdict)}</div>`;
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
    return `<h3 class="sub">서브에이전트 (기대 모델 대비 실제 메시지)</h3>` + FAM_LEGEND +
      (rest.length ? `<div>${rest.map(agentRow).join('')}</div>` : noData()) +
      (na.length ? details(`해당 없음 에이전트 ${na.length}개`, `<div>${na.map(agentRow).join('')}</div>`) : '') +
      mainBlock + bgBlock + details('메인 스레드 정확한 수치', exact);
  }, { hint: Number.isFinite(d.routing?.windowDays) ? `최근 ${d.routing.windowDays}일` : '최근 7일' });
}

function viewTokens(d) {
  return panel('토큰 (최근 7일)', d.tokens, (s) => {
    const days = arr(s.days);
    if (days.length === 0) return noData();
    const t = isObj(s.totals) ? s.totals : {};
    const chart = `<h3 class="sub">일별 출력 토큰 (계열별)</h3>` + colChart(tokenGroups(days), 160, '최근 7일 일별 출력 토큰, 계열별 누적') + FAM_LEGEND;
    const side = `<div class="donut">${ring(t.hitRate, pct01(t.hitRate), '캐시 적중률')}` +
      `<div><p class="big">${pct01(t.hitRate)}</p><p class="cap">캐시 적중률 (7일)</p></div></div>` +
      `<div class="tiles">` +
      [['입력', t.input], ['출력', t.output], ['캐시 읽기', t.cacheRead], ['캐시 생성', t.cacheCreation]]
        .map(([l, v]) => `<div class="tile"><span class="n">${compactKo(v)}</span><span class="l">${l}</span></div>`).join('') + `</div>`;
    return `<div class="grid2"><div class="col">${chart}</div><div class="col">${side}</div></div>` +
      details('정확한 수치 (표)', tokenTable(days, t));
  }, { hint: '로컬 날짜 · 메시지 ID로 중복 제거' });
}

function ubar(label, frac, value, wide) {
  const w = clamp(Number.isFinite(frac) ? frac : 0, 0, 1) * 100;
  return `<div class="ubar${wide ? ' wide' : ''}"><span class="ubar-l" title="${label}">${label}</span>` +
    `<span class="ubar-track" aria-hidden="true"><span class="ubar-fill" style="width:${w.toFixed(1)}%"></span></span>` +
    `<span class="ubar-v">${value}</span></div>`;
}

function rtkPanel(d) {
  const rtkTop = isObj(d.rtk) ? d.rtk : {};
  return panel('RTK', d.rtk, (s) => {
    const sum = isObj(s.summary) ? s.summary : {};
    const cmds = arr(s.topCommands);
    const vals = cmds.map((c) => parseSaved(c.saved));
    const max = Math.max(0, ...vals);
    const bars = (from, to) => cmds.slice(from, to).map((c, i) =>
      ubar(txt(c.command), max > 0 ? vals[from + i] / max : 0, `${txt(c.saved)} · ${txt(c.pct)}`)).join('');
    const frac = Number.isFinite(sum.savedPct) ? sum.savedPct / 100 : null;
    return `<div class="donut">${ring(frac, pctValue(sum.savedPct), '절감률')}` +
      `<div><p class="big">${compactKo(sum.savedTokens)}</p><p class="cap">절감 토큰 · 명령 ${fmtInt(sum.commands)}개</p></div></div>` +
      `<h3 class="sub">상위 명령 (절감 토큰)</h3>` +
      (cmds.length ? `<div class="ubars">${bars(0, 5)}</div>` : noData()) +
      (cmds.length > 5 ? details(`나머지 명령 ${cmds.length - 5}개`, `<div class="ubars">${bars(5, cmds.length)}</div>`) : '');
  }, { hint: Object.keys(rtkTop).length ? 'RTK가 줄인 명령 출력' : '' });
}

function viewSavings(d) {
  const sv = isObj(d.savings) ? d.savings : null;
  const sub = (k) => (sv && isObj(sv[k]) ? sv[k] : null);
  const cache = panel('캐시', sub('cache'), (s) => {
    const hit = s.hitRate7d;
    return `<div class="donut">${ring(hit, pct01(hit), '캐시 적중률')}` +
      `<div><p class="big">≈ ${compactKo(s.savedInputTokens7d)}</p><p class="cap">전체 가격으로 청구되지 않은 입력 토큰 (7일)</p>` +
      `<p class="cap">캐시 읽기 ${fmtInt(s.cacheRead7d)}</p></div></div>`;
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
  const del = panel('실행 위임', d.savings, (s) => delegationBlock(s),
    { hint: '최근 7일 출력 토큰, 전체 대비 비율' });
  return `<div class="grid2"><div class="col">${rtkPanel(d)}${del}</div><div class="col">${cache}${mem}${pony}</div></div>`;
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
var btns=document.querySelectorAll('.side button');
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
try{var ac=document.querySelector('.side button[aria-current]');if(ac)ac.scrollIntoView({inline:'nearest',block:'nearest'})}catch(e){}
var tb=document.getElementById('theme');
if(tb)tb.addEventListener('click',function(){var r=document.documentElement;
var cur=r.getAttribute('data-theme')||(window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
var next=cur==='dark'?'light':'dark';r.setAttribute('data-theme',next);
try{localStorage.setItem('monitor-theme',next)}catch(e){}});
})();`;

function sideNav() {
  let html = '';
  for (const t of TABS) {
    if (t.grp) html += `<div class="grp">${esc(t.grp)}</div>`;
    html += `<button type="button" data-tab="${t.id}"${t.id === 'ov' ? ' aria-current="page"' : ''}>${esc(t.label)}</button>`;
  }
  return `<nav class="side" aria-label="화면 탭">${html}</nav>`;
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
  const mode = sec ? `<span class="st live"><span class="pip"></span>실시간 · ${sec}초마다</span>` : badge('info', '스냅샷');
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
<div class="app">
${sideNav()}
<header class="top">
<div class="brand"><span class="mark" aria-hidden="true">✻</span><h1>클로드 설정 모니터</h1></div>
<div class="meta"><time>${esc(fmtKo(d.generatedAt, true))}</time>${mode}<button class="btn" id="theme" type="button" aria-label="테마 전환 (밝게/어둡게)">테마</button></div>
</header>
<main class="stage" id="stage">
${sections}
</main>
</div>
<script>${BODY_SCRIPT}${sec ? `setTimeout(function(){location.reload()},${sec * 1000});` : ''}</script>
</body>
</html>
`;
}
