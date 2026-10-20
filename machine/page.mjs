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
    if (d < 60) return Math.round(d) + '일 전 수정';
    if (d < 730) return Math.round(d / 30) + '개월 전 수정';
    return Math.round(d / 365) + '년 전 수정';
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

  // ---- header: scan info and one usage bar per drive ----
  const sk = data.skipped || {};
  $('meta').textContent =
    '스캔 ' + new Date(ref).toLocaleString('ko-KR') +
    (data.durationMs ? ' · ' + Math.round(data.durationMs / 1000) + '초 걸림' : '') +
    ' · 분석한 용량 ' + fmt(root.s) +
    ' · 읽지 못한 폴더 ' + (sk.unreadable || 0).toLocaleString('ko-KR') + '개, 바로가기(링크) ' + (sk.reparse || 0).toLocaleString('ko-KR') + '개는 건너뜀';
  (data.roots || []).forEach((r) => {
    const li = el('li', 'drive');
    li.appendChild(el('span', 'dn', r.path));
    const bar = el('div', 'bar');
    const fill = el('span');
    const known = r.total != null && r.free != null && r.total > 0;
    const pct = known ? Math.max(0, Math.min(100, ((r.total - r.free) / r.total) * 100)) : 0;
    fill.style.width = pct.toFixed(1) + '%';
    bar.appendChild(fill);
    bar.setAttribute('role', 'img');
    const txt = known
      ? '사용 ' + fmt(r.total - r.free) + ' / 전체 ' + fmt(r.total) + ' · 남은 공간 ' + fmt(r.free)
      : '용량 정보 없음';
    bar.setAttribute('aria-label', r.path + ' ' + txt);
    li.appendChild(bar);
    li.appendChild(el('span', 'dt num', txt));
    $('drives').appendChild(li);
  });

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
  let reveal = true; // tiles fade in once, on first paint
  const map = $('map');
  const tip = $('tip');
  const GAP = 1, HEAD = 20;

  // name 14-28px by tile size, size line beneath; hidden when the tile is too small to read
  function label(node, w, h) {
    if (w < 48 || h < 24) return null;
    const len = Math.max(3, Math.min(node.n.length, 18));
    const fs = Math.max(13, Math.min(Math.sqrt(w * h) / 7, 28, (w - 8) / (len * 0.62)));
    if (h < fs * 1.2 + 6) return null;
    const box = el('span', 'lab');
    const nm = el('span', 'nm', node.n);
    nm.style.fontSize = fs.toFixed(1) + 'px';
    box.appendChild(nm);
    if (h >= fs * 2.3 + 8 && w >= 56) {
      const sz = el('span', 'sz num', fmt(node.s));
      sz.style.fontSize = Math.max(13, fs * 0.78).toFixed(1) + 'px';
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
        // group: backdrop in the page color, header strip, then children
        const bg = el('div', 'gbg');
        bg.style.cssText = 'left:' + (r.x + GAP) + 'px;top:' + (r.y + GAP) + 'px;width:' + (r.w - 2 * GAP) + 'px;height:' + (r.h - 2 * GAP) + 'px';
        frag.appendChild(bg);
        const hd = addBox(frag, node, { x: r.x, y: r.y, w: r.w, h: HEAD + 2 * GAP }, 'ghead' + (level ? ' sub' : ''));
        hd.style.background = '';
        hd.style.color = '';
        hd.style.borderLeftColor = paint(node._h || 0).bg;
        hd.textContent = node.n + ' · ' + fmt(node.s);
        frag.appendChild(hd);
        layout(sub, { x: r.x + GAP, y: r.y + HEAD + 2 * GAP, w: r.w - 2 * GAP, h: r.h - HEAD - 3 * GAP }, level + 1);
      });
    };
    layout(kids, { x: 0, y: 0, w: W, h: H }, 0);
    if (reveal) {
      reveal = false;
      const els = frag.querySelectorAll('.tile');
      els.forEach((t, i) => { t.style.animationDelay = Math.round((i / els.length) * 120) + 'ms'; });
      map.classList.add('reveal');
      setTimeout(() => map.classList.remove('reveal'), 700);
    }
    map.appendChild(frag);
  }

  // ---- breadcrumb ----
  function crumbs() {
    const nav = $('crumbs');
    nav.textContent = '';
    const chain = [];
    for (let n = zoom; n; n = parent.get(n)) chain.unshift(n);
    $('up').disabled = zoom === root;
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
  $('up').addEventListener('click', () => { if (parent.get(zoom)) go(parent.get(zoom), null); });

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
  const TAG = { safe: '안전', check: '확인 필요', manual: '직접 판단' };
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
    $('total').textContent = '선택 ' + sel.size + '개 · ' + fmt(sumOf([...sel].map((id) => jById.get(id))));
    $('export').disabled = sel.size === 0;
  }

  // head (shrinks with an ellipsis) + tail (last folders, always visible) = a middle ellipsis; full path in title and on focus
  function pathEl(p) {
    const e = el('div', 'path');
    e.title = p;
    const i1 = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
    const i2 = Math.max(p.lastIndexOf('\\', i1 - 1), p.lastIndexOf('/', i1 - 1));
    const cut = i2 > 0 && p.length - i2 - 1 <= 36 ? i2 + 1 : i1 + 1;
    if (cut > 0 && cut < p.length) {
      e.appendChild(el('span', 'ph', p.slice(0, cut)));
      e.appendChild(el('span', 'pt', p.slice(cut)));
    } else {
      e.appendChild(el('span', 'pt', p));
    }
    return e;
  }

  const clampers = [];
  function buildItem(j) {
    const tier = tierOf(j);
    const li = el('li', 'item');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.id = ckId.get(j.id);
    cb.checked = sel.has(j.id);
    if (reportOnly(j)) cb.disabled = true;
    cb.addEventListener('change', () => { if (cb.checked) sel.add(j.id); else sel.delete(j.id); refreshTotal(); });
    const lab = el('label', 'nm1', j.label);
    lab.htmlFor = cb.id;
    const size = el('span', 'isz num', fmt(j.size));

    const meta = el('div', 'meta2');
    const left = el('span');
    left.appendChild(el('b', 'tag tag-' + tier, TAG[tier]));
    left.appendChild(document.createTextNode(' · ' + age(j.mtime)));
    meta.appendChild(left);
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
    meta.appendChild(find);

    const txt = j.effect || j.reason || '';
    const eff = el('div', 'eff');
    const body = el('p', 'efft clamp');
    body.appendChild(el('b', null, '지워도 되나요? '));
    body.appendChild(document.createTextNode(txt));
    eff.appendChild(body);
    const more = el('button', 'more', '더 보기');
    more.type = 'button';
    more.hidden = true;
    more.setAttribute('aria-expanded', 'false');
    more.addEventListener('click', () => {
      const open = body.classList.toggle('clamp') === false;
      more.textContent = open ? '접기' : '더 보기';
      more.setAttribute('aria-expanded', String(open));
    });
    eff.appendChild(more);
    clampers.push({ body, more });

    li.append(cb, lab, size, meta, pathEl(j.path), eff);
    if (reportOnly(j)) li.appendChild(el('p', 'hand', '직접 확인: ' + j.how));
    return li;
  }

  function renderList() {
    list.textContent = '';
    clampers.length = 0;
    let shown = 0;
    TIERS.forEach(([tier, title]) => {
      const items = sorted.filter((j) => tierOf(j) === tier && (!filter || j.category === filter));
      if (!items.length) return;
      shown += items.length;
      const sec = el('section', 'sec sec-' + tier);
      const h = el('h3', null, title);
      h.appendChild(el('span', 'sub num', items.length + '개 · ' + fmt(sumOf(items))));
      sec.appendChild(h);
      const ul = el('ul', 'items');
      items.forEach((j) => ul.appendChild(buildItem(j)));
      sec.appendChild(ul);
      list.appendChild(sec);
    });
    if (!shown) list.appendChild(el('p', 'none', '정리할 만한 항목을 찾지 못했습니다.'));
    // show "더 보기" only where the two-line clamp actually cuts the text
    clampers.forEach(({ body, more }) => { if (body.scrollHeight > body.clientHeight + 1) more.hidden = false; });
    refreshTotal();
  }

  // ---- category tabs (click = filter the panel) ----
  function renderCats() {
    const box = $('cats');
    box.textContent = '';
    const tot = new Map();
    junk.forEach((j) => tot.set(j.category, (tot.get(j.category) || 0) + j.size));
    if (!tot.size) return;
    const tab = (text, on, fn) => {
      const btn = el('button', 'tab', text);
      btn.type = 'button';
      btn.setAttribute('aria-pressed', String(on));
      btn.addEventListener('click', fn);
      box.appendChild(btn);
    };
    tab('전체', filter === null, () => { filter = null; renderCats(); renderList(); });
    [...tot].sort((x, y) => y[1] - x[1]).forEach(([c, v]) =>
      tab(catName(c) + ' ' + fmt(v), filter === c, () => { filter = filter === c ? null : c; renderCats(); renderList(); })
    );
  }

  // ---- plan export ----
  async function exportPlan() {
    const picked = junk.filter((j) => sel.has(j.id));
    const plan = {
      version: 1,
      createdAt: new Date().toISOString(),
      items: picked.map((j) => ({ id: j.id, category: j.category, tool: j.tool ?? null, path: j.path, size: j.size, safety: tierOf(j) })),
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

  $('copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('cmd').textContent);
      $('status').textContent = '명령을 복사했습니다.';
    } catch (_) {
      $('status').textContent = '복사하지 못했습니다. 명령을 직접 선택해 복사하세요.';
    }
  });

  // one click: tick exactly the safe, non-report items and export
  const autoItems = junk.filter(isAuto);
  const autoSum = fmt(sumOf(autoItems));
  $('auto-gb').textContent = autoSum;
  $('hero-v').textContent = autoSum;
  $('auto').disabled = autoItems.length === 0;
  $('auto').addEventListener('click', () => {
    sel.clear();
    autoItems.forEach((j) => sel.add(j.id));
    renderList();
    exportPlan();
  });
  renderCats();
  renderList();

  // ---- legend: stepped swatches, same ramp as the tiles ----
  const drawLegend = () => {
    readTheme();
    const box = $('swatches');
    box.textContent = '';
    [0, 0.15, 0.35, 0.55, 0.75, 1].forEach((h) => {
      const s = el('span');
      s.style.background = paint(h).bg;
      box.appendChild(s);
    });
  };

  // ---- start ----
  let raf = 0;
  new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(render); }).observe(map);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { drawLegend(); render(); });
  crumbs();
  drawLegend();
  render();
}

const NOISE =
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.04'/%3E%3C/svg%3E")`;

const CSS = `
:root{
  --bg:#F5F4EE;--surface:#FDFCF9;--rule:#E3E0D6;--text:#1F1E1D;--text-2:#4A4945;
  --accent:#B5532F;--on-accent:#FFFFFF;--safe:#3F7D4E;--check:#8F5E12;--manual:#6B6A66;
  --tile:#E9E6DB;--ink-dark:#141312;--ink-light:#FBFAF6;
  --heat0:#F0C9A8;--heat1:#D97757;--heat2:#B5452D;
  --noise:${NOISE};
  --serif:Georgia,"Times New Roman","Batang",serif;
  --sans:"Pretendard","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif;
  --mono:ui-monospace,"Cascadia Mono",Consolas,monospace;
}
@media (prefers-color-scheme:dark){
  :root{--bg:#1F1E1C;--surface:#2A2927;--rule:#3A3936;--text:#F2F0E8;--text-2:#C9C6BC;
    --accent:#D97757;--on-accent:#1F1E1D;--safe:#7DBE8C;--check:#E0B25A;--manual:#A8A69E;
    --tile:#34332F;--heat0:#8A5A3E;--heat1:#C4613F;--heat2:#A23B24}
}
*{box-sizing:border-box}
html,body{height:100%;margin:0}
body{display:flex;flex-direction:column;background:var(--bg) var(--noise);color:var(--text);font:15px/1.5 var(--sans)}
button{font:inherit;color:inherit;cursor:pointer}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.num{font-family:var(--serif);font-variant-numeric:tabular-nums}

.band{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:8px 32px;padding:16px 24px 10px}
h1{font:700 28px/1.2 var(--serif);margin:0}
.meta{margin:4px 0 0;color:var(--text-2);font-size:14px;max-width:100ch}
.hero{margin:0;text-align:right;line-height:1.1;display:flex;align-items:baseline;justify-content:flex-end;gap:12px}
.hero-k{font:600 18px var(--serif);color:var(--text-2)}
#hero-v{font:700 40px/1 var(--serif);font-variant-numeric:tabular-nums;color:var(--accent)}
.hero-cap{margin:4px 0 0;text-align:right;font-size:13px;color:var(--text-2)}
.drives{list-style:none;margin:0;padding:0 24px 12px;max-width:820px;width:100%}
.drive{display:grid;grid-template-columns:48px minmax(80px,1fr) auto;gap:4px 14px;align-items:center;min-height:26px;font-size:14px}
.dn{font:700 15px var(--serif)}
.bar{height:6px;background:var(--rule)}
.bar span{display:block;height:100%;background:var(--text-2)}
.dt{color:var(--text-2);font-size:14px}

.body{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) clamp(360px,30vw,460px);border-top:1px solid var(--rule)}
.mapcol{display:flex;flex-direction:column;min-height:0;min-width:0;padding:8px 16px 12px 24px}
.cats{display:flex;flex-wrap:wrap;align-items:center;gap:0 18px}
.tab{background:none;border:0;border-bottom:2px solid transparent;border-radius:0;padding:6px 2px;min-height:40px;font-size:15px;color:var(--text-2)}
.tab:hover{color:var(--text)}
.tab[aria-pressed="true"]{color:var(--text);font-weight:700;border-bottom-color:var(--accent)}
.navrow{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;min-height:44px}
.up{background:var(--surface);border:1px solid var(--rule);border-radius:2px;padding:6px 12px;min-height:44px;font-size:15px}
.up:disabled{opacity:.45;cursor:not-allowed}
#crumbs{display:flex;flex-wrap:wrap;align-items:center;gap:0 2px}
.crumb{background:none;border:0;padding:8px 4px;min-height:44px;font-size:15px;color:var(--accent);text-decoration:none}
.crumb:hover{text-decoration:underline}
.crumb[aria-current]{color:var(--text);font-weight:700;cursor:default;text-decoration:none}
.sep{color:var(--text-2)}
.map{position:relative;flex:1;min-height:320px;background:var(--bg);overflow:hidden}
.empty{color:var(--text);padding:24px;margin:0}
.gbg{position:absolute;background:var(--bg)}
.tile{position:absolute;margin:0;padding:0;border:0;color:var(--text);overflow:hidden;text-align:center;cursor:default;border-radius:0}
.tile.kids{cursor:zoom-in}
.tile.kids::after{content:"";position:absolute;right:0;bottom:0;border:5px solid transparent;border-right-color:currentColor;border-bottom-color:currentColor;opacity:.5}
.tile.syn{background-image:repeating-linear-gradient(45deg,rgba(127,127,127,.14) 0 6px,transparent 6px 12px)}
.tile:hover{outline:2px solid var(--text);outline-offset:-2px;z-index:2}
.tile:focus-visible{outline:2px solid var(--text);outline-offset:-2px;z-index:3}
.tile.hl{outline:3px solid var(--text);outline-offset:-3px;z-index:2;box-shadow:0 0 0 6px var(--bg) inset}
.ghead{background:var(--rule);color:var(--text-2);border-left:3px solid transparent;text-align:left;padding:0 8px;font-size:12px;line-height:20px;white-space:nowrap;text-overflow:ellipsis;font-weight:600}
.ghead.sub{font-weight:500}
.lab{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2px 4px;pointer-events:none}
.nm{font-weight:600;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sz{white-space:nowrap}
@keyframes pop{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:none}}
.reveal .tile,.reveal .gbg{animation:pop .28s ease-out both}
@media (prefers-reduced-motion:reduce){.reveal .tile,.reveal .gbg{animation:none}}
.legend{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:10px 0 0;color:var(--text-2);font-size:13px}
#swatches{display:flex;gap:2px}
#swatches span{display:block;width:30px;height:12px}

.side{display:flex;flex-direction:column;min-height:0;min-width:0;background:var(--surface);border-left:1px solid var(--rule)}
.side-top{padding:16px 20px 14px;border-bottom:1px solid var(--rule)}
.auto-expl{margin:0 0 10px;font-size:15px}
.btn{display:block;width:100%;border-radius:2px;padding:8px 14px;font-weight:700;font-size:16px;border:2px solid var(--accent)}
.btn-ol{background:transparent;color:var(--accent);min-height:44px}
.btn-pri{background:var(--accent);color:var(--on-accent);min-height:48px}
.btn:disabled{opacity:.45;cursor:not-allowed}
#junk-list{flex:1;min-height:120px;overflow:auto;padding:0 20px 12px}
.none{color:var(--text-2)}
.sec{margin-top:20px;border-left:3px solid var(--tier);padding-left:14px}
.sec-safe{--tier:var(--safe)}.sec-check{--tier:var(--check)}.sec-manual{--tier:var(--manual)}
.sec h3{display:flex;justify-content:space-between;align-items:baseline;gap:8px;font:700 18px/1.3 var(--serif);margin:0 0 2px}
.sec .sub{font-weight:400;font-size:15px;color:var(--text-2)}
.items{list-style:none;margin:0;padding:0}
.item{display:grid;grid-template-columns:22px minmax(0,1fr) auto;column-gap:12px;row-gap:3px;align-items:center;padding:14px 0;border-top:1px solid var(--rule)}
.item:first-child{border-top-color:transparent}
.item input{width:22px;height:22px;margin:0;accent-color:var(--accent)}
.nm1{font-size:16px;font-weight:600;min-width:0;overflow-wrap:anywhere;cursor:pointer}
.isz{font-size:18px;font-weight:700;white-space:nowrap}
.item>*{min-width:0;overflow-wrap:anywhere}
.meta2,.path,.eff,.hand{grid-column:2/4}
.meta2{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:13px;color:var(--text-2)}
.tag{font-weight:700}
.tag-safe{color:var(--safe)}.tag-check{color:var(--check)}.tag-manual{color:var(--manual)}
.find{background:none;border:0;padding:12px 0;margin:-12px 0;font-size:13px;color:var(--accent);text-decoration:underline;white-space:nowrap}
@media (hover:hover){.find{opacity:0}.item:hover .find,.item:focus-within .find,.find:focus-visible{opacity:1}}
.path{display:flex;min-width:0;font:12.5px/1.4 var(--mono);color:var(--text-2)}
.ph{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pt{flex:0 1 auto;min-width:0;max-width:75%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.item:focus-within .path{display:block;overflow-wrap:anywhere}
.item:focus-within .ph,.item:focus-within .pt{display:inline;white-space:normal;max-width:none}
.eff{font-size:14px;color:var(--text)}
.efft{margin:0}
.efft.clamp{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.more{background:none;border:0;padding:10px 0;margin:-6px 0;min-height:32px;font-size:13px;color:var(--accent);text-decoration:underline}
.hand{margin:0;font-size:14px;color:var(--text)}
.foot{position:sticky;bottom:0;background:var(--surface);border-top:1px solid var(--rule);padding:14px 20px 16px}
#total{margin:0 0 10px;font:700 22px/1.2 var(--serif);font-variant-numeric:tabular-nums}
.cmdrow{display:flex;gap:8px;margin-top:12px;align-items:stretch}
#cmd{flex:1;min-width:0;display:block;font:13px/1.4 var(--mono);background:var(--bg);border:1px solid var(--rule);padding:10px;overflow-x:auto;white-space:nowrap;user-select:all}
.copy{background:var(--surface);border:1px solid var(--text-2);border-radius:2px;padding:0 14px;min-height:44px;font-size:14px;font-weight:600}
.foot-note{margin:10px 0 0;font-size:13px;color:var(--text-2)}
#status{margin:6px 0 0;font-size:13px;color:var(--text);min-height:1.5em}
#tip{position:fixed;z-index:10;max-width:420px;pointer-events:none;background:#111;color:#F4F2EA;border:1px solid #555;border-radius:2px;padding:8px 10px;font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,.4)}
#tip[hidden]{display:none}
.tp{font-weight:700;word-break:break-all}
.tm{color:#C9C7BD}
.tj{margin-top:6px;padding-top:6px;border-top:1px solid #444}
@media (max-width:900px){
  html,body{height:auto}
  .band,.mapcol{padding-left:16px;padding-right:16px}
  .drives{padding:0 16px 12px}
  .hero{justify-content:flex-start}
  .hero-cap{text-align:left}
  .body{display:block}
  .map{height:60vh;flex:none}
  .side{border-left:0;border-top:1px solid var(--rule)}
  #junk-list{overflow:visible}
  .drive{grid-template-columns:48px minmax(60px,1fr)}
  .dt{grid-column:1/-1}
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
<header class="band">
  <div>
    <h1>이 PC의 디스크 지도</h1>
    <p id="meta" class="meta"></p>
  </div>
  <div>
    <p class="hero"><span class="hero-k">정리 가능</span><strong id="hero-v">0 B</strong></p>
    <p class="hero-cap">안전하게 지울 수 있는 용량</p>
  </div>
</header>
<ul id="drives" class="drives" aria-label="드라이브별 사용량"></ul>
<div class="body">
  <main class="mapcol">
    <div id="cats" class="cats" role="group" aria-label="종류별 정리 가능 용량 (누르면 오른쪽 목록이 그 종류만 보입니다)"></div>
    <div class="navrow">
      <button id="up" type="button" class="up">↑ 위로</button>
      <nav id="crumbs" aria-label="현재 위치"></nav>
    </div>
    <div id="map" class="map" role="group" aria-label="폴더 크기 지도. 상자가 클수록 용량이 큽니다"></div>
    <div class="legend"><span>정상</span><span id="swatches" aria-hidden="true"></span><span>정리 가능 높음</span><span>(주황~빨강일수록 지워도 안전한 용량이 많습니다)</span></div>
  </main>
  <aside class="side" aria-labelledby="side-h">
    <div class="side-top">
      <h2 id="side-h" hidden>정리할 수 있는 항목</h2>
      <p class="auto-expl">'삭제해도 되는 것'만 한 번에 골라 계획 파일을 저장합니다. 지금 고르면 <strong id="auto-gb" class="num">0 B</strong>입니다.</p>
      <button id="auto" type="button" class="btn btn-ol">안전한 것만 자동 선택</button>
    </div>
    <div id="junk-list"></div>
    <div class="foot">
      <p id="total">선택 0개 · 0 B</p>
      <button id="export" type="button" class="btn btn-pri">정리 계획 저장 (machine-plan.json)</button>
      <div class="cmdrow"><code id="cmd" tabindex="0">node machine/clean.mjs machine-plan.json</code><button id="copy" type="button" class="copy">복사</button></div>
      <p id="status" role="status"></p>
      <p class="foot-note">이 화면은 아무것도 지우지 않습니다. 터미널에서 위 명령을 실행하면 삭제 전에 한 번 더 확인합니다.</p>
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
