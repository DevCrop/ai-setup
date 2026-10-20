// Renders the scan data (see machine/CONTRACT.md) into ONE self-contained HTML string.
// The page only reads the data and exports a plan JSON; it never deletes anything.

// Runs in the browser. Stringified into the page, so it must not reference module scope.
function client() {
  const data = JSON.parse(document.getElementById('scan-data').textContent);
  const $ = (id) => document.getElementById(id);
  const root = data.tree;
  const junk = data.junk || [];
  const ref = Date.parse(data.generatedAt) || Date.now();

  // ---- formatting helpers ----
  const fmt = (b) => {
    if (!(b > 0)) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
    const v = b / Math.pow(1024, i);
    return (i === 0 ? v.toFixed(0) : v.toFixed(v >= 100 ? 0 : 1)) + ' ' + u[i];
  };
  const date = (m) => (m ? new Date(m).toISOString().slice(0, 10) : '알 수 없음');
  const age = (m) => {
    if (!m) return '수정일 모름';
    const d = (ref - m) / 864e5;
    if (d < 1) return '오늘 수정';
    if (d < 60) return Math.round(d) + '일 전';
    if (d < 730) return Math.round(d / 30) + '개월 전';
    return Math.round(d / 365) + '년 전';
  };
  // ---- theme: colors come from CSS custom properties so light/dark share one code path ----
  const cssv = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const rgb = (hex) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    const v = m ? parseInt(m[1], 16) : 0;
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  };
  const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
  const lin = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const css = (c) => 'rgb(' + c.map(Math.round).join(',') + ')';
  let T = null;
  const readTheme = () => {
    T = {
      tile: rgb(cssv('--tile')),
      heat: [rgb(cssv('--heat0')), rgb(cssv('--heat1')), rgb(cssv('--heat2'))],
      dark: rgb(cssv('--ink-dark')),
      light: rgb(cssv('--ink-light')),
    };
  };
  // heat 0..1 -> {bg, fg}; the background is nudged until the label reaches 4.5:1
  const paint = (h) => {
    if (!T) readTheme();
    let bg = h < 0.03 ? T.tile : h < 0.5 ? mix(T.heat[0], T.heat[1], h / 0.5) : mix(T.heat[1], T.heat[2], (h - 0.5) / 0.5);
    const ink = ratio(bg, T.dark) >= ratio(bg, T.light) ? T.dark : T.light;
    for (let i = 0; i < 30 && ratio(bg, ink) < 4.55; i++) bg = mix(bg, ink === T.dark ? [255, 255, 255] : [0, 0, 0], 0.05);
    return { bg: css(bg), fg: css(ink) };
  };
  const key = (p) => (p || '').toLowerCase();
  // true when path b is a or inside a (both lower-cased)
  const contains = (a, b) =>
    !!a && (b === a || (b.startsWith(a) && (/[\\/]$/.test(a) || /[\\/]/.test(b[a.length] || ''))));
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  // ---- tree preparation: parent links, junk lookup, heat ----
  const byPath = new Map();
  junk.forEach((j) => {
    const k = key(j.path);
    if (!byPath.has(k)) byPath.set(k, []);
    byPath.get(k).push(j);
  });
  const parent = new Map();
  (function prep(n, par, d) {
    parent.set(n, par);
    n._d = d;
    const own = n.p ? byPath.get(key(n.p)) : null;
    let ownBest = 0;
    let ownSize = 0;
    if (own) own.forEach((j) => { ownBest = Math.max(ownBest, j.score); ownSize += j.size; });
    let rc = 0, best = 0, cnt = 0;
    for (const c of n.c || []) {
      prep(c, n, d + 1);
      rc += c._rc; best = Math.max(best, c._best); cnt += c._cnt;
    }
    n._own = own || null;
    n._rc = own ? Math.min(n.s, ownSize) : rc; // own junk already contains its descendants
    n._best = Math.max(best, ownBest);
    n._cnt = cnt + (own ? own.length : 0);
    n._h = Math.max(ownBest, n.s > 0 ? (n._rc / n.s) * n._best : 0);
  })(root, null, 0);

  // deepest node whose path contains the given path
  const locate = (path) => {
    const k = key(path);
    let n = root;
    for (;;) {
      const next = (n.c || []).find((c) => c.p && contains(key(c.p), k));
      if (!next) return n;
      n = next;
    }
  };

  // ---- header summary ----
  const sum = $('summary');
  const addSum = (t) => sum.appendChild(el('span', 'chip', t));
  addSum('스캔 시각 ' + new Date(ref).toLocaleString('ko-KR') + (data.durationMs ? ' (' + Math.round(data.durationMs / 1000) + '초 걸림)' : ''));
  (data.roots || []).forEach((r) => {
    addSum(
      r.total != null && r.free != null
        ? r.path + ' 사용 ' + fmt(r.total - r.free) + ' / 전체 ' + fmt(r.total) + ' (남은 공간 ' + fmt(r.free) + ')'
        : r.path + ' 용량 정보 없음'
    );
  });
  const sk = data.skipped || {};
  addSum('읽지 못한 폴더 ' + (sk.unreadable || 0).toLocaleString('ko-KR') + '개, 바로가기(링크) ' + (sk.reparse || 0).toLocaleString('ko-KR') + '개는 건너뜀');

  // ---- squarified treemap ----
  // items: [{v}] sorted by v desc; returns rects [{x,y,w,h}] in the same order
  function squarify(vals, x, y, w, h) {
    const total = vals.reduce((a, b) => a + b, 0);
    const out = [];
    if (!(total > 0) || w <= 0 || h <= 0) return vals.map(() => ({ x, y, w: 0, h: 0 }));
    const k = (w * h) / total;
    const areas = vals.map((v) => v * k);
    let i = 0;
    while (i < areas.length) {
      const side = Math.min(w, h);
      const worst = (s, mx, mn) => Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
      let s = areas[i], mx = areas[i], mn = areas[i], j = i + 1;
      while (j < areas.length) {
        const ns = s + areas[j];
        const nmx = Math.max(mx, areas[j]), nmn = Math.min(mn, areas[j]);
        if (worst(ns, nmx, nmn) > worst(s, mx, mn)) break;
        s = ns; mx = nmx; mn = nmn; j++;
      }
      if (w >= h) {
        const cw = s / h;
        let cy = y;
        for (let t = i; t < j; t++) { const ch = areas[t] / cw; out.push({ x, y: cy, w: cw, h: ch }); cy += ch; }
        x += cw; w -= cw;
      } else {
        const rh = s / w;
        let cx = x;
        for (let t = i; t < j; t++) { const cw = areas[t] / rh; out.push({ x: cx, y, w: cw, h: rh }); cx += cw; }
        y += rh; h -= rh;
      }
      i = j;
    }
    return out;
  }

  // children plus a pseudo tile for the folder's own files so area stays proportional to size
  const withOwn = (n) => {
    const kids = (n.c || []).filter((c) => c.s > 0);
    const rem = n.s - (n.c || []).reduce((a, c) => a + c.s, 0);
    if (rem > n.s * 0.01) kids.push({ n: '(이 폴더의 파일)', p: null, s: rem, m: n.m, _h: 0, _rc: 0, _cnt: 0, syn: true });
    return kids;
  };

  let zoom = root;
  let hl = null;
  let view = [];
  const map = $('map');
  const tip = $('tip');
  const GAP = 1, HEAD = 18;

  function label(node, w, h) {
    if (w < 34 || h < 20) return null;
    const len = Math.max(4, Math.min(node.n.length, 18));
    const fs = Math.max(9, Math.min(Math.sqrt(w * h) / 7, 30, (w - 8) / (len * 0.62)));
    if (h < fs * 1.2 + 4) return null;
    const box = el('span', 'lab');
    const nm = el('span', 'nm', node.n);
    nm.style.fontSize = fs.toFixed(1) + 'px';
    box.appendChild(nm);
    if (h >= fs * 2.3 + 6) {
      const sz = el('span', 'sz', fmt(node.s));
      sz.style.fontSize = (fs * 0.8).toFixed(1) + 'px';
      box.appendChild(sz);
    }
    return box;
  }

  function aria(node) {
    let t = node.n + ', ' + fmt(node.s);
    if (node._cnt) t += ', 정리 가능한 항목 ' + node._cnt + '개 포함';
    if (node.c && node.c.length) t += ', 누르면 안으로 들어갑니다';
    return t;
  }

  function addBox(frag, node, r, cls) {
    const b = el('button', 'tile ' + cls);
    b.type = 'button';
    b.dataset.i = String(view.length);
    view.push(node);
    b.style.left = r.x + GAP + 'px';
    b.style.top = r.y + GAP + 'px';
    b.style.width = Math.max(0, r.w - 2 * GAP) + 'px';
    b.style.height = Math.max(0, r.h - 2 * GAP) + 'px';
    const pc = paint(node._h || 0);
    b.style.background = pc.bg;
    b.style.color = pc.fg;
    b.setAttribute('aria-label', aria(node));
    if (node.c && node.c.length) b.classList.add('kids');
    if (node.syn) b.classList.add('syn');
    if (node === hl) b.classList.add('hl');
    return b;
  }

  function render() {
    const W = map.clientWidth, H = map.clientHeight;
    readTheme();
    map.textContent = '';
    view = [];
    const kids = withOwn(zoom);
    if (!kids.length || W < 10 || H < 10) {
      map.appendChild(el('p', 'empty', '이 위치에는 더 보여줄 폴더가 없습니다.'));
      return;
    }
    const frag = document.createDocumentFragment();
    // level 0 = groups, level 1 = sub-groups (only when big enough), level 2 = leaf tiles
    const MINW = [70, 120], MINH = [44, 60];
    const layout = (nodes, box, level) => {
      const rs = squarify(nodes.map((k) => k.s), box.x, box.y, box.w, box.h);
      nodes.forEach((node, i) => {
        const r = rs[i];
        if (r.w < 3 || r.h < 3) return;
        const sub = level < 2 && node.c && node.c.length && r.w >= MINW[level] && r.h >= MINH[level] ? withOwn(node) : null;
        if (!sub || !sub.length) {
          const t = addBox(frag, node, r, 'leaf');
          const l = label(node, r.w - 2 * GAP, r.h - 2 * GAP);
          if (l) t.appendChild(l);
          frag.appendChild(t);
          return;
        }
        // group: dark backdrop, header strip, then children
        const bg = el('div', 'gbg' + (level ? ' sub' : ''));
        bg.style.cssText = 'left:' + (r.x + GAP) + 'px;top:' + (r.y + GAP) + 'px;width:' + (r.w - 2 * GAP) + 'px;height:' + (r.h - 2 * GAP) + 'px';
        frag.appendChild(bg);
        const hd = addBox(frag, node, { x: r.x, y: r.y, w: r.w, h: HEAD + 2 * GAP }, 'ghead' + (level ? ' sub' : ''));
        hd.style.background = '';
        hd.style.color = '';
        hd.style.borderLeftColor = paint(node._h || 0).bg;
        hd.textContent = node.n + '  ·  ' + fmt(node.s);
        frag.appendChild(hd);
        layout(sub, { x: r.x + GAP, y: r.y + HEAD + 2 * GAP, w: r.w - 2 * GAP, h: r.h - HEAD - 3 * GAP }, level + 1);
      });
    };
    layout(kids, { x: 0, y: 0, w: W, h: H }, 0);
    map.appendChild(frag);
  }

  // ---- breadcrumb ----
  function crumbs() {
    const nav = $('crumbs');
    nav.textContent = '';
    const chain = [];
    for (let n = zoom; n; n = parent.get(n)) chain.unshift(n);
    chain.forEach((n, i) => {
      if (i) nav.appendChild(el('span', 'sep', '›'));
      const b = el('button', 'crumb', n === root ? 'PC' : n.n);
      b.type = 'button';
      if (n === zoom) b.setAttribute('aria-current', 'location');
      b.addEventListener('click', () => go(n, null));
      nav.appendChild(b);
    });
  }

  function go(node, highlight) {
    zoom = node;
    hl = highlight;
    crumbs();
    render();
  }

  // ---- tooltip ----
  function showTip(node, x, y) {
    tip.textContent = '';
    tip.appendChild(el('div', 'tp', node.p || node.n));
    tip.appendChild(el('div', 'tm', fmt(node.s) + ' · 마지막 수정 ' + date(node.m)));
    (node._own || []).forEach((j) => {
      const d = el('div', 'tj');
      d.appendChild(el('strong', null, j.label + ' (정리 가능성 ' + Math.round(j.score * 100) + '%)'));
      d.appendChild(el('div', null, j.reason));
      d.appendChild(el('div', null, (j.action === 'report' ? '직접 확인: ' : '정리 방법: ') + j.how));
      tip.appendChild(d);
    });
    const below = node._cnt - (node._own ? node._own.length : 0);
    if (below > 0) tip.appendChild(el('div', 'tm', '안쪽에 정리 가능한 항목 ' + below + '개 (약 ' + fmt(node._rc) + ')'));
    tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.max(4, Math.min(x + 14, innerWidth - w - 8)) + 'px';
    tip.style.top = Math.max(4, y + 18 + h > innerHeight ? y - h - 10 : y + 18) + 'px';
  }
  const nodeOf = (e) => {
    const t = e.target.closest && e.target.closest('[data-i]');
    return t ? { t, node: view[+t.dataset.i] } : null;
  };
  map.addEventListener('mousemove', (e) => {
    const o = nodeOf(e);
    if (o) showTip(o.node, e.clientX, e.clientY); else tip.hidden = true;
  });
  map.addEventListener('mouseleave', () => { tip.hidden = true; });
  map.addEventListener('focusin', (e) => {
    const o = nodeOf(e);
    if (!o) return;
    const r = o.t.getBoundingClientRect();
    showTip(o.node, r.left + 8, r.top + 8);
  });
  map.addEventListener('focusout', () => { tip.hidden = true; });
  map.addEventListener('click', (e) => {
    const o = nodeOf(e);
    if (o && o.node.c && o.node.c.length) { tip.hidden = true; go(o.node, null); }
  });

  // ---- junk side panel ----
  const CATS = {
    temp: '임시 파일', 'pkg-cache': '패키지 캐시', 'dev-artifact': '개발 폴더', 'orphan-worktree': '끝난 작업 폴더',
    'plugin-cache': '플러그인 캐시', 'appdata-orphan': '앱 데이터 찌꺼기', 'recycle-bin': '휴지통', 'crash-dump': '오류 덤프',
    'vm-disk': '가상 디스크', 'browser-cache': '브라우저 캐시', 'shader-cache': '그래픽 캐시', 'app-cache': '앱 캐시',
    'system-cleanup': '윈도우 시스템 파일', 'old-download': '오래된 다운로드',
  };
  const catName = (c) => CATS[c] || c;
  const TIERS = [['safe', '삭제해도 되는 것'], ['check', '확인 후 삭제'], ['manual', '직접 판단']];
  // older scans have no "safety": derive it from the score
  const tierOf = (j) => (j.safety === 'safe' || j.safety === 'check' || j.safety === 'manual' ? j.safety : j.score >= 0.8 ? 'safe' : j.score >= 0.5 ? 'check' : 'manual');
  const reportOnly = (j) => j.action === 'report';
  const isAuto = (j) => tierOf(j) === 'safe' && !reportOnly(j);
  const sel = new Set(junk.filter(isAuto).map((j) => j.id));
  let filter = null;
  const list = $('junk-list');
  const jById = new Map(junk.map((j) => [j.id, j]));
  const sorted = junk.slice().sort((x, y) => y.size - x.size);
  const ckId = new Map(sorted.map((j, i) => [j.id, 'ck-' + i]));
  // an item inside another item of the same set is already counted by the outer one
  const sumOf = (items) =>
    items
      .filter((x) => !items.some((y) => y !== x && key(y.path) !== key(x.path) && contains(key(y.path), key(x.path))))
      .reduce((n, j) => n + j.size, 0);

  function refreshTotal() {
    $('total').textContent = fmt(sumOf([...sel].map((id) => jById.get(id))));
    $('export').disabled = sel.size === 0;
  }

  function buildItem(j) {
    const li = el('li', 'item');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.id = ckId.get(j.id);
    cb.checked = sel.has(j.id);
    if (reportOnly(j)) cb.disabled = true;
    cb.addEventListener('change', () => { if (cb.checked) sel.add(j.id); else sel.delete(j.id); refreshTotal(); });
    const lab = el('label');
    lab.htmlFor = cb.id;
    const head = el('span', 'ih');
    head.appendChild(el('span', 'cat', j.label));
    head.appendChild(el('span', 'isz', fmt(j.size)));
    lab.appendChild(head);
    lab.appendChild(el('span', 'ipath', j.path));
    lab.appendChild(el('span', 'imeta', catName(j.category) + ' · ' + age(j.mtime) + (reportOnly(j) ? ' · 직접 확인: ' + j.how : '')));
    const find = el('button', 'find', '지도에서 보기');
    find.type = 'button';
    find.setAttribute('aria-label', j.label + ' 위치를 지도에서 보기');
    find.addEventListener('click', () => {
      const node = locate(j.path);
      let z = node;
      while (z && z._d > 0 && z._d > Math.max(0, node._d - 2)) z = parent.get(z);
      go(z || root, node);
      map.scrollIntoView({ block: 'nearest' });
    });
    const txt = j.effect || j.reason || '';
    const eff = el('div', 'eff');
    const body = el('span', 'efft', '지워도 되나요? ' + txt);
    eff.appendChild(body);
    if (txt.length > 60) {
      body.classList.add('clamp');
      const more = el('button', 'more', '더 보기');
      more.type = 'button';
      more.setAttribute('aria-expanded', 'false');
      more.addEventListener('click', () => {
        const open = body.classList.toggle('clamp') === false;
        more.textContent = open ? '접기' : '더 보기';
        more.setAttribute('aria-expanded', String(open));
      });
      eff.appendChild(more);
    }
    li.append(cb, lab, find, eff);
    return li;
  }

  function renderList() {
    list.textContent = '';
    let shown = 0;
    TIERS.forEach(([tier, title]) => {
      const items = sorted.filter((j) => tierOf(j) === tier && (!filter || j.category === filter));
      if (!items.length) return;
      shown += items.length;
      const sec = el('section', 'sec sec-' + tier);
      const h = el('h3', null, title);
      h.appendChild(el('span', 'sub', items.length + '개 · ' + fmt(sumOf(items))));
      sec.appendChild(h);
      const ul = el('ul', 'items');
      items.forEach((j) => ul.appendChild(buildItem(j)));
      sec.appendChild(ul);
      list.appendChild(sec);
    });
    if (!shown) list.appendChild(el('p', 'none', '정리할 만한 항목을 찾지 못했습니다.'));
    refreshTotal();
  }

  // ---- per-category summary strip (click = filter the panel) ----
  function renderCats() {
    const box = $('cats');
    box.textContent = '';
    const tot = new Map();
    junk.forEach((j) => tot.set(j.category, (tot.get(j.category) || 0) + j.size));
    if (!tot.size) return;
    const chip = (text, on, fn) => {
      const btn = el('button', 'cchip', text);
      btn.type = 'button';
      btn.setAttribute('aria-pressed', String(on));
      btn.addEventListener('click', fn);
      box.appendChild(btn);
    };
    chip('전체', filter === null, () => { filter = null; renderCats(); renderList(); });
    [...tot].sort((x, y) => y[1] - x[1]).forEach(([c, n]) =>
      chip(catName(c) + ' ' + fmt(n), filter === c, () => { filter = filter === c ? null : c; renderCats(); renderList(); })
    );
  }

  // ---- plan export ----
  async function exportPlan() {
    const picked = junk.filter((j) => sel.has(j.id));
    const plan = {
      version: 1,
      createdAt: new Date().toISOString(),
      items: picked.map((j) => ({ id: j.id, category: j.category, tool: j.tool ?? null, path: j.path, size: j.size })),
    };
    const text = JSON.stringify(plan, null, 2);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = 'machine-plan.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    const msg = 'machine-plan.json 파일을 저장했습니다 (' + plan.items.length + '개 항목, ' + fmt(sumOf(picked)) + ').';
    $('status').textContent = msg; // shown before the clipboard call, which may hang on a permission prompt
    try {
      await navigator.clipboard.writeText(text);
      $('status').textContent = msg + ' 내용을 클립보드에도 복사했습니다.';
    } catch (_) { /* clipboard may be unavailable on file:// pages */ }
  }
  $('export').addEventListener('click', exportPlan);

  // one click: tick exactly the safe, non-report items and export
  const autoItems = junk.filter(isAuto);
  $('auto-gb').textContent = fmt(sumOf(autoItems));
  $('auto').disabled = autoItems.length === 0;
  $('auto').addEventListener('click', () => {
    sel.clear();
    autoItems.forEach((j) => sel.add(j.id));
    renderList();
    exportPlan();
  });
  renderCats();
  renderList();

  // ---- legend ----
  const drawLegend = () => {
    readTheme();
    $('legend-bar').style.background = 'linear-gradient(90deg,' + [0, 0.25, 0.5, 0.75, 1].map((h) => paint(h).bg).join(',') + ')';
  };

  // ---- start ----
  let raf = 0;
  new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(render); }).observe(map);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { drawLegend(); render(); });
  crumbs();
  drawLegend();
  render();
}

const CSS = `
:root{
  --bg:#F5F4EE;--fg:#1F1E1D;--muted:#5E5D59;--panel:#FAF9F5;--line:#E8E6DC;
  --accent:#D97757;--accent-fg:#1F1E1D;
  --tile:#E3E0D3;--ghead:#D6D2C2;--ghead2:#DDD9CA;--ink-dark:#141312;--ink-light:#FBFAF6;
  --heat0:#F0C9A8;--heat1:#D97757;--heat2:#B5452D;
  --serif:"Tiempos Headline","Tiempos Text",Georgia,"Noto Serif KR","Batang",serif;
  --sans:system-ui,-apple-system,"Segoe UI","Malgun Gothic","Apple SD Gothic Neo",sans-serif;
}
@media (prefers-color-scheme:dark){
  :root{--bg:#262624;--fg:#F0EEE6;--muted:#B5B3AA;--panel:#30302E;--line:#47473F;
    --tile:#3A3936;--ghead:#45443F;--ghead2:#3F3E3A;--heat0:#8A5A3E;--heat1:#C4613F;--heat2:#A23B24}
}
*{box-sizing:border-box}
html,body{height:100%;margin:0}
body{display:flex;flex-direction:column;background:var(--bg);color:var(--fg);font:14px/1.45 var(--sans)}
button{font:inherit;color:inherit;cursor:pointer}
:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.top{padding:12px 16px 6px}
h1{font:600 24px/1.2 var(--serif);margin:0 0 6px}
h2{font:600 18px/1.2 var(--serif);margin:0 0 8px}
.summary{margin:0;display:flex;flex-wrap:wrap;gap:4px 14px;color:var(--muted);font-size:13px}
.chip{overflow-wrap:anywhere}
.body{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:12px;padding:0 16px 12px}
.mapcol{display:flex;flex-direction:column;min-height:0;min-width:0}
#crumbs{display:flex;flex-wrap:wrap;align-items:center;gap:2px;padding:4px 0;min-height:44px}
.crumb{background:none;border:0;padding:8px 6px;min-height:44px;border-radius:6px;color:var(--fg);text-decoration:underline}
.crumb[aria-current]{text-decoration:none;font-weight:700}
.sep{color:var(--muted)}
.map{position:relative;flex:1;min-height:320px;background:var(--bg);overflow:hidden}
.empty{color:var(--fg);padding:24px;margin:0}
.gbg{position:absolute;background:var(--bg)}
.tile{position:absolute;margin:0;padding:0;border:0;color:var(--fg);overflow:hidden;text-align:center;cursor:default;border-radius:0}
.tile.kids{cursor:zoom-in}
.tile.kids::after{content:"";position:absolute;right:0;bottom:0;border:5px solid transparent;border-right-color:currentColor;border-bottom-color:currentColor;opacity:.5}
.tile.syn{background-image:repeating-linear-gradient(45deg,rgba(127,127,127,.14) 0 6px,transparent 6px 12px)}
.tile:hover{filter:brightness(.94)}
.tile:focus-visible{outline:3px solid var(--fg);outline-offset:-3px;z-index:3}
.tile.hl{outline:3px solid var(--fg);outline-offset:-3px;z-index:2;box-shadow:0 0 0 6px var(--bg) inset}
.ghead{background:var(--ghead);color:var(--fg);border-left:4px solid transparent;text-align:left;padding:0 6px;font-size:11px;line-height:18px;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap;text-overflow:ellipsis;font-weight:600}
.ghead.sub{background:var(--ghead2);font-size:10px;font-weight:500}
.lab{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2px 4px;pointer-events:none}
.nm{font-weight:600;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sz{white-space:nowrap}
.legend{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:8px 0 0;color:var(--muted);font-size:12px}
#legend-bar{flex:0 1 280px;height:12px;border-radius:6px;border:1px solid var(--line)}
.side{display:flex;flex-direction:column;min-height:0;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px}
.hint{margin:4px 0 8px;color:var(--muted);font-size:13px}
#junk-list{flex:1;min-height:120px;overflow:auto}
.items{list-style:none;margin:0;padding:0}
.sec h3{font:600 15px/1.3 var(--serif);margin:10px 0 2px;display:flex;justify-content:space-between;gap:8px;align-items:baseline}
.sec .sub{font:12px var(--sans);color:var(--muted)}
.none{color:var(--muted)}
.eff{grid-column:2/4;font-size:12px;color:var(--muted)}
.efft.clamp{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.more{background:none;border:0;padding:6px 0;min-height:44px;color:var(--fg);text-decoration:underline;font-size:12px}
.btn.big{font-size:16px;min-height:52px}
.auto-note{margin:6px 0 4px}
.cats{display:flex;gap:6px;overflow-x:auto;padding:4px 0}
.cchip{flex:none;white-space:nowrap;min-height:44px;padding:4px 12px;border:1px solid var(--line);border-radius:999px;background:var(--panel);font-size:13px}
.cchip[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:var(--accent-fg);font-weight:700}
.item{display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:6px;align-items:start;padding:8px 0;border-top:1px solid var(--line);min-height:44px}
.item input{width:20px;height:20px;margin:2px 0 0;accent-color:var(--accent)}
.item input:disabled+label{opacity:.85}
.item label{display:block;cursor:pointer;min-width:0}
.ih{display:flex;justify-content:space-between;gap:8px;font-weight:600}
.isz{white-space:nowrap}
.ipath{display:block;color:var(--muted);font-size:12px;word-break:break-all}
.imeta{display:block;color:var(--muted);font-size:12px}
.find,.btn{background:transparent;border:1px solid var(--line);border-radius:8px;padding:6px 10px;min-height:44px}
.find{font-size:12px}
.btn{background:var(--accent);color:var(--accent-fg);border-color:var(--accent);font-weight:700;width:100%}
.btn:disabled{opacity:.5;cursor:not-allowed}
.foot{border-top:1px solid var(--line);padding-top:10px;margin-top:6px}
.totalrow{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px}
#total{font:700 20px var(--serif)}
.note,#status{margin:8px 0 0;color:var(--muted);font-size:12px}
code{font-family:ui-monospace,Consolas,monospace;background:rgba(127,127,127,.18);padding:1px 4px;border-radius:4px}
#tip{position:fixed;z-index:10;max-width:420px;pointer-events:none;background:#111;color:#F4F2EA;border:1px solid #555;border-radius:6px;padding:8px 10px;font-size:12px;box-shadow:0 4px 16px rgba(0,0,0,.4)}
#tip[hidden]{display:none}
.tp{font-weight:700;word-break:break-all}
.tm{color:#C9C7BD}
.tj{margin-top:6px;padding-top:6px;border-top:1px solid #444}
@media (max-width:860px){
  html,body{height:auto}
  .body{display:block}
  .map{height:70vh;flex:none}
  .side{margin-top:12px}
  #junk-list{overflow:visible}
}
`;

const escapeJson = (data) => JSON.stringify(data).replace(/</g, '\\u003c');

export function renderPage(data) {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>이 PC의 디스크 지도</title>
<style>${CSS}</style>
</head>
<body>
<header class="top">
  <h1>이 PC의 디스크 지도</h1>
  <p id="summary" class="summary"></p>
</header>
<div class="body">
  <main class="mapcol">
    <div id="cats" class="cats" role="group" aria-label="종류별 정리 가능 용량 (누르면 오른쪽 목록이 그 종류만 보입니다)"></div>
    <nav id="crumbs" aria-label="현재 위치"></nav>
    <div id="map" class="map" role="group" aria-label="폴더 크기 지도. 상자가 클수록 용량이 큽니다"></div>
    <div class="legend"><span>정상</span><span id="legend-bar" aria-hidden="true"></span><span>정리 가능 높음</span><span>(주황~빨강일수록 지워도 안전한 용량이 많습니다)</span></div>
  </main>
  <aside class="side" aria-labelledby="side-h">
    <h2 id="side-h">정리할 수 있는 항목</h2>
    <button id="auto" type="button" class="btn big">자동 최적화 — 안전한 것만</button>
    <p class="note auto-note"><strong id="auto-gb">0 B</strong>를 비울 수 있습니다. 누르면 계획 파일을 바로 저장합니다. 터미널에서 <code>node machine/clean.mjs &lt;파일&gt;</code> 실행 — 실제 삭제 전 한 번 더 확인합니다.</p>
    <p class="hint">'삭제해도 되는 것'만 처음에 체크돼 있습니다. 직접 고르려면 체크한 뒤 아래 버튼을 누르세요. 이 화면은 아무것도 지우지 않습니다.</p>
    <div id="junk-list"></div>
    <div class="foot">
      <div class="totalrow"><span>정리 가능 용량</span><strong id="total">0 B</strong></div>
      <button id="export" type="button" class="btn">정리 계획 내보내기</button>
      <p id="status" role="status"></p>
      <p class="note">터미널에서 <code>node machine/clean.mjs &lt;파일&gt;</code> 실행 — 실제 삭제 전 한 번 더 확인합니다.</p>
    </div>
  </aside>
</div>
<div id="tip" role="tooltip" hidden></div>
<script id="scan-data" type="application/json">${escapeJson(data)}</script>
<script>(${client.toString()})();</script>
</body>
</html>
`;
}
