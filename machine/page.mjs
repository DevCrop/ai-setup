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

  // ---- tree preparation: parent links, junk lookup ----
  // _hot = score of junk that IS this folder (only those tiles get a heat fill);
  // _rc/_cnt = reclaimable bytes / junk count inside the subtree (ancestors get a dot and a caption instead)
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
    let rc = 0, cnt = 0;
    for (const c of n.c || []) {
      prep(c, n, d + 1);
      rc += c._rc; cnt += c._cnt;
    }
    n._own = own || null;
    n._hot = ownBest;
    n._rc = own ? Math.min(n.s, ownSize) : rc; // own junk already contains its descendants
    n._cnt = cnt + (own ? own.length : 0);
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

  // ---- header: scan info, and one compact card per drive ----
  const sk = data.skipped || {};
  $('meta').textContent =
    '스캔 ' + new Date(ref).toLocaleString('ko-KR') +
    (data.durationMs ? ' · ' + Math.round(data.durationMs / 1000) + '초 걸림' : '') +
    ' · 읽지 못한 폴더 ' + (sk.unreadable || 0).toLocaleString('ko-KR') + '개는 건너뜀';
  (data.roots || []).forEach((r) => {
    const card = el('li', 'drive');
    const known = r.total != null && r.free != null && r.total > 0;
    const top = el('div', 'drive-top');
    top.appendChild(el('b', 'dn', r.path));
    top.appendChild(el('span', 'df num', known ? fmt(r.free) + ' 남음' : '용량 정보 없음'));
    card.appendChild(top);
    const bar = el('div', 'bar');
    const fill = el('span');
    fill.style.width = (known ? Math.max(0, Math.min(100, ((r.total - r.free) / r.total) * 100)) : 0).toFixed(1) + '%';
    bar.appendChild(fill);
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', r.path + (known ? ' 사용 ' + fmt(r.total - r.free) + ' / 전체 ' + fmt(r.total) + ', 남은 공간 ' + fmt(r.free) : ' 용량 정보 없음'));
    card.appendChild(bar);
    $('drives').appendChild(card);
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
    if (rem > n.s * 0.01) kids.push({ n: '(이 폴더의 파일)', p: null, s: rem, m: n.m, _hot: 0, _rc: 0, _cnt: 0, syn: true });
    return kids;
  };

  let zoom = root;
  let hl = null;
  let view = [];
  let reveal = true; // tiles fade in once, on first paint
  const map = $('map');
  const tip = $('tip');
  const GAP = 1.5, HEAD = 22; // 3px between tiles

  // ancestor of junk: neutral tile with a dot and a caption (not a fill)
  const inside = (node) => !node._own && node._rc > 0;

  // name 14-28px by tile size, size beneath; hidden when the tile is too small to read
  function label(node, w, h) {
    if (w < 48 || h < 24) return null;
    const len = Math.max(3, Math.min(node.n.length, 18));
    const fs = Math.max(13, Math.min(Math.sqrt(w * h) / 7, 28, (w - 8) / (len * 0.62)));
    if (h < fs * 1.2 + 6) return null;
    const box = el('span', 'lab');
    const nm = el('span', 'nm', node.n);
    nm.style.fontSize = fs.toFixed(1) + 'px';
    box.appendChild(nm);
    const szh = Math.max(13, fs * 0.78);
    if (h >= fs * 1.3 + szh * 1.3 + 8 && w >= 56) {
      const sz = el('span', 'sz num', fmt(node.s));
      sz.style.fontSize = szh.toFixed(1) + 'px';
      box.appendChild(sz);
      if (inside(node) && w >= 110 && h >= fs * 1.3 + szh * 2.6 + 12) {
        box.appendChild(el('span', 'cap', '정리 가능 ' + fmt(node._rc)));
      }
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
    const pc = paint(node._own ? node._hot : 0);
    b.style.background = pc.bg;
    b.style.color = pc.fg;
    b.setAttribute('aria-label', aria(node));
    if (node.c && node.c.length) b.classList.add('kids');
    if (node.syn) b.classList.add('syn');
    if (node._own) b.classList.add('junk');
    if (inside(node) && r.w >= 40 && r.h >= 40) b.classList.add('has');
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
    const MINW = [70, 120], MINH = [48, 64];
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
        // group: its name sits as plain text above the group's tiles
        const hd = addBox(frag, node, { x: r.x, y: r.y, w: r.w, h: HEAD + 2 * GAP }, 'ghead' + (level ? ' sub' : ''));
        hd.style.background = '';
        hd.style.color = '';
        hd.textContent = node.n + ' · ' + fmt(node.s);
        frag.appendChild(hd);
        layout(sub, { x: r.x, y: r.y + HEAD + GAP, w: r.w, h: r.h - HEAD - GAP }, level + 1);
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
    'ai-old-version': 'AI 도구 옛 버전', 'ai-temp': 'AI 도구 임시 파일', 'editor-state': '편집기 작업 기록', 'ai-history': '대화·작업 기록',
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
    $('sel-n').textContent = '선택 ' + sel.size + '개';
    $('total').textContent = fmt(sumOf([...sel].map((id) => jById.get(id))));
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
    const left = el('span', 'meta-l');
    left.appendChild(el('b', 'tag tag-' + tier, TAG[tier]));
    left.appendChild(document.createTextNode(' ' + age(j.mtime)));
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
      const sec = el('section', 'sec');
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

  // ---- category chips: one row = 전체 + top 5, the rest behind a "+N" popover ----
  const pop = $('pop');
  const closePop = () => {
    pop.hidden = true;
    const b = $('morechip');
    if (b) b.setAttribute('aria-expanded', 'false');
  };
  function pick(c) {
    filter = c;
    closePop();
    renderCats();
    renderList();
  }
  function renderCats(shown = 5) {
    const box = $('cats');
    box.textContent = '';
    pop.textContent = '';
    const tot = new Map();
    junk.forEach((j) => tot.set(j.category, (tot.get(j.category) || 0) + j.size));
    if (!tot.size) return;
    const all = [...tot].sort((x, y) => y[1] - x[1]);
    const chip = (parentEl, cls, name, size, on, fn) => {
      const btn = el('button', cls);
      btn.type = 'button';
      btn.setAttribute('aria-pressed', String(on));
      btn.appendChild(el('span', null, name));
      if (size != null) btn.appendChild(el('span', 'csz num', size));
      btn.addEventListener('click', fn);
      parentEl.appendChild(btn);
      return btn;
    };
    chip(box, 'chip', '전체', null, filter === null, () => pick(null));
    all.slice(0, shown).forEach(([c, v]) => chip(box, 'chip', catName(c), fmt(v), filter === c, () => pick(filter === c ? null : c)));
    const rest = all.slice(shown);
    if (rest.length) {
      const m = chip(box, 'chip', '+' + rest.length, null, rest.some(([c]) => c === filter), () => {
        if (!pop.hidden) { closePop(); return; }
        pop.hidden = false;
        m.setAttribute('aria-expanded', 'true');
        const r = m.getBoundingClientRect();
        pop.style.top = r.bottom + 6 + 'px';
        pop.style.left = Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8)) + 'px';
      });
      m.id = 'morechip';
      m.setAttribute('aria-label', '다른 종류 ' + rest.length + '개 더 보기');
      m.setAttribute('aria-expanded', 'false');
      m.setAttribute('aria-controls', 'pop');
      rest.forEach(([c, v]) => chip(pop, 'pitem', catName(c), fmt(v), filter === c, () => pick(filter === c ? null : c)));
    }
    // desktop: keep the chips on one row without a scrollbar by moving the smallest into the popover
    if (innerWidth > 900 && shown > 1 && box.scrollWidth > box.clientWidth + 1) renderCats(shown - 1);
  }
  document.addEventListener('click', (e) => { if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('#morechip')) closePop(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) { closePop(); const b = $('morechip'); if (b) b.focus(); } });

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
    [0.1, 0.3, 0.5, 0.7, 0.9].forEach((h) => {
      const s = el('span');
      s.style.background = paint(h).bg;
      box.appendChild(s);
    });
  };

  // ---- start ----
  let raf = 0;
  new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { render(); closePop(); renderCats(); }); }).observe(map);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { drawLegend(); render(); });
  crumbs();
  drawLegend();
  render();
}

const CSS = `
:root{
  --bg:#FAF9F5;--surface:#FFFFFF;--surface-2:#F5F4EE;--border:#E8E6DC;--text:#141413;--text-2:#5E5D59;
  --accent:#B95A37;--on-accent:#FFFFFF;--accent-ink:#A24826;--accent-soft:#F3E3DA;
  --safe:#2F6B3E;--safe-soft:#E4F0E6;--check:#8A5A0F;--check-soft:#F8EBCF;--manual:#5E5D59;--manual-soft:#EEECE5;
  --tile:#EFEDE6;--ink-dark:#141312;--ink-light:#FBFAF6;
  --heat0:#F0C9A8;--heat1:#D97757;--heat2:#B5452D;
  --display:"Tiempos Headline","Copernicus",Georgia,"Batang",serif;
  --sans:"Pretendard","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif;
  --mono:ui-monospace,"Cascadia Mono",Consolas,monospace;
  --shadow:0 1px 2px rgba(0,0,0,.04);
}
@media (prefers-color-scheme:dark){
  :root{--bg:#262624;--surface:#30302E;--surface-2:#2B2A28;--border:#3D3C38;--text:#F5F4EE;--text-2:#C2C0B6;
    --accent:#D97757;--on-accent:#1F1E1D;--accent-ink:#EE9A78;--accent-soft:#4A3329;
    --safe:#8FD19E;--safe-soft:#26402C;--check:#E6BE6C;--check-soft:#473714;--manual:#C2C0B6;--manual-soft:#3A3935;
    --tile:#34332F;--heat0:#8A5A3E;--heat1:#C4613F;--heat2:#A23B24}
}
*{box-sizing:border-box}
html,body{height:100%;margin:0}
body{display:flex;flex-direction:column;background:var(--bg);color:var(--text);font:15px/1.5 var(--sans)}
button{font:inherit;color:inherit;cursor:pointer}
:focus-visible{outline:2px solid var(--accent-ink);outline-offset:2px}
.num{font-variant-numeric:tabular-nums}

.band{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:16px 32px;padding:20px 24px 16px}
.brand{display:flex;align-items:center;gap:14px;min-width:0}
.mark{flex:none;color:var(--accent)}
h1{font:500 26px/1.25 var(--display);margin:0}
.meta{margin:2px 0 0;color:var(--text-2);font-size:13px}
.stats{display:flex;flex-wrap:wrap;align-items:stretch;gap:12px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow)}
.hero{padding:10px 18px 12px;min-width:200px}
.hero-k{display:block;font-size:13px;color:var(--text-2)}
#hero-v{display:block;font:500 44px/1.05 var(--display);font-variant-numeric:tabular-nums;color:var(--accent-ink)}
.drives{display:flex;flex-wrap:wrap;gap:12px;list-style:none;margin:0;padding:0}
.drive{min-width:150px;padding:12px 16px;display:flex;flex-direction:column;justify-content:center;gap:8px;background:var(--surface);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow)}
.drive-top{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.dn{font-size:15px}
.df{font-size:13px;color:var(--text-2)}
.bar{height:6px;border-radius:999px;background:var(--surface-2);box-shadow:inset 0 0 0 1px var(--border);overflow:hidden}
.bar span{display:block;height:100%;border-radius:999px;background:var(--accent)}

.body{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) clamp(360px,30vw,460px);gap:16px;padding:0 24px 20px}
.mapcol{display:flex;flex-direction:column;min-height:0;min-width:0}
.cats{display:flex;flex-wrap:nowrap;gap:8px;overflow-x:auto;padding:2px 0 10px;scrollbar-width:thin}
.chip,.pitem{display:inline-flex;align-items:center;gap:8px;flex:none;white-space:nowrap;min-height:44px;padding:0 16px;font-size:14px;color:var(--text);background:var(--surface-2);border:1px solid var(--border);border-radius:999px}
.chip:hover,.pitem:hover{border-color:var(--text-2)}
.chip[aria-pressed="true"],.pitem[aria-pressed="true"]{background:var(--accent-soft);border-color:var(--accent);color:var(--accent-ink);font-weight:600}
.csz{color:var(--text-2);font-weight:400}
.chip[aria-pressed="true"] .csz,.pitem[aria-pressed="true"] .csz{color:var(--accent-ink)}
.pop{position:fixed;z-index:20;display:flex;flex-direction:column;gap:4px;padding:8px;max-height:60vh;overflow:auto;background:var(--surface);border:1px solid var(--border);border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,.12)}
.pop[hidden]{display:none}
.pitem{justify-content:space-between;border-radius:8px;background:transparent;border-color:transparent}
.navrow{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;min-height:44px}
.up{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:0 14px;min-height:44px;font-size:14px}
.up:disabled{opacity:.45;cursor:not-allowed}
#crumbs{display:flex;flex-wrap:wrap;align-items:center;gap:0 2px}
.crumb{background:none;border:0;padding:8px 6px;min-height:44px;font-size:15px;color:var(--accent-ink);border-radius:8px}
.crumb:hover{text-decoration:underline}
.crumb[aria-current]{color:var(--text);font-weight:600;cursor:default;text-decoration:none}
.sep{color:var(--text-2)}
.map{position:relative;flex:1;min-height:320px;overflow:hidden}
.empty{color:var(--text);padding:24px;margin:0}
.tile{position:absolute;margin:0;padding:0;border:0;color:var(--text);overflow:hidden;text-align:center;cursor:default;border-radius:6px}
.tile.kids{cursor:zoom-in}
.tile.kids:hover .nm::after{content:" ›"}
.tile.syn{background-image:repeating-linear-gradient(45deg,rgba(127,127,127,.12) 0 6px,transparent 6px 12px)}
.tile:hover{outline:1.5px solid var(--accent);outline-offset:-1.5px;z-index:2}
.tile.junk:hover{outline-color:var(--text)}
.tile:focus-visible{outline:2px solid var(--text);outline-offset:-2px;z-index:3}
.tile.hl{outline:3px solid var(--text);outline-offset:-3px;z-index:2}
.tile.has::before,.dotmark{content:"";width:8px;height:8px;border-radius:50%;background:var(--accent)}
.tile.has::before{position:absolute;top:8px;right:8px}
.ghead{background:transparent;color:var(--text-2);border-radius:4px;text-align:left;padding:0 4px;font-size:12px;line-height:22px;white-space:nowrap;text-overflow:ellipsis;font-weight:500}
.ghead:hover{outline-offset:-1px}
.lab{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2px 6px;pointer-events:none}
.nm{font-weight:600;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sz{white-space:nowrap}
.cap{display:inline-flex;align-items:center;gap:6px;margin-top:3px;font-size:13px;white-space:nowrap}
.cap::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--accent)}
@keyframes pop{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:none}}
.reveal .tile{animation:pop .28s ease-out both}
@media (prefers-reduced-motion:reduce){.reveal .tile{animation:none}}
.legend{display:flex;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:6px 10px;padding:10px 0 0;color:var(--text-2);font-size:13px}
#swatches{display:flex;gap:3px}
#swatches span{display:block;width:26px;height:10px;border-radius:3px}
.legend .dotmark{display:inline-block;margin-right:6px;vertical-align:baseline}

.side{display:flex;flex-direction:column;min-height:0;min-width:0;background:var(--surface);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow);overflow:hidden}
.side-top{padding:20px 20px 16px}
.auto-expl{margin:0 0 12px;font-size:15px}
.btn{display:block;width:100%;border-radius:8px;padding:8px 16px;font-weight:600;font-size:16px;border:1.5px solid var(--accent)}
.btn-ol{background:transparent;color:var(--accent-ink);border-color:var(--accent);min-height:44px}
.btn-ol:hover{background:var(--accent-soft)}
.btn-pri{background:var(--accent);color:var(--on-accent);min-height:48px}
.btn-pri:hover{filter:brightness(.95)}
.btn:disabled{opacity:.45;cursor:not-allowed}
#junk-list{flex:1;min-height:120px;overflow:auto;padding:0 12px 8px}
.none{color:var(--text-2);padding:0 8px}
.sec{margin-top:12px}
.sec h3{display:flex;justify-content:space-between;align-items:baseline;gap:8px;font:500 17px/1.3 var(--display);margin:0;padding:10px 8px 6px}
.sec .sub{font:400 13px var(--sans);color:var(--text-2)}
.items{list-style:none;margin:0;padding:0}
.item{display:grid;grid-template-columns:22px minmax(0,1fr) auto;column-gap:12px;row-gap:3px;align-items:center;padding:14px 8px;border-radius:12px}
.item:hover,.item:focus-within{background:var(--surface-2)}
.item input{width:22px;height:22px;margin:0;accent-color:var(--accent)}
.item>*{min-width:0;overflow-wrap:anywhere}
.nm1{font-size:16px;font-weight:600;cursor:pointer}
.isz{font-size:15px;font-weight:600;white-space:nowrap}
.meta2,.path,.eff,.hand{grid-column:2/4}
.meta2{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:13px;color:var(--text-2)}
.tag{display:inline-block;padding:1px 9px;border-radius:999px;font-size:13px;font-weight:600;margin-right:4px}
.tag-safe{color:var(--safe);background:var(--safe-soft)}
.tag-check{color:var(--check);background:var(--check-soft)}
.tag-manual{color:var(--manual);background:var(--manual-soft)}
.find{background:none;border:0;padding:12px 4px;margin:-12px 0;min-height:44px;font-size:13px;color:var(--accent-ink);text-decoration:underline;white-space:nowrap;border-radius:8px}
@media (hover:hover){.find{opacity:0}.item:hover .find,.item:focus-within .find,.find:focus-visible{opacity:1}}
.path{display:flex;font:12.5px/1.4 var(--mono);color:var(--text-2)}
.ph{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pt{flex:0 1 auto;min-width:0;max-width:75%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.item:focus-within .path{display:block;overflow-wrap:anywhere}
.item:focus-within .ph,.item:focus-within .pt{display:inline;white-space:normal;max-width:none}
.eff{font-size:14px;color:var(--text)}
.efft{margin:0}
.efft.clamp{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.more{background:none;border:0;padding:10px 0;margin:-12px 0;min-height:44px;font-size:13px;color:var(--accent-ink);text-decoration:underline;border-radius:8px}
.hand{margin:0;font-size:14px;color:var(--text)}
.foot{background:var(--surface);border-top:1px solid var(--border);padding:16px 20px 20px}
.tot{display:flex;justify-content:space-between;align-items:baseline;margin:0 0 12px}
#sel-n{font-size:13px;color:var(--text-2)}
#total{font:500 24px/1.2 var(--display);font-variant-numeric:tabular-nums}
.cmdrow{display:flex;gap:8px;margin-top:12px;align-items:stretch}
#cmd{flex:1;min-width:0;display:block;font:12.5px/1.4 var(--mono);background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:12px 10px;overflow-x:auto;scrollbar-width:none;white-space:nowrap;user-select:all}
.copy{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:0 16px;min-height:44px;font-size:14px;font-weight:600}
.copy:hover{border-color:var(--text-2)}
.foot-note{margin:10px 0 0;font-size:13px;color:var(--text-2)}
#status{margin:6px 0 0;font-size:13px;color:var(--text);min-height:1.5em}
#tip{position:fixed;z-index:30;max-width:420px;pointer-events:none;background:#1F1E1D;color:#F5F4EE;border:1px solid #4A4945;border-radius:8px;padding:10px 12px;font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,.3)}
#tip[hidden]{display:none}
.tp{font-weight:600;word-break:break-all}
.tm{color:#C9C7BD}
.tj{margin-top:6px;padding-top:6px;border-top:1px solid #4A4945}
@media (max-width:900px){
  html,body{height:auto}
  .band{padding:16px 16px 12px}
  .stats{width:100%}
  .hero{flex:1 1 100%}
  .drive{flex:1 1 140px}
  .body{display:block;padding:0 16px 16px}
  .map{height:60vh;flex:none}
  .side{margin-top:16px}
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
<header class="band">
  <div class="brand">
    <svg class="mark" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 1.5v6.5M12 16v6.5M1.5 12H8M16 12h6.5M4.6 4.6l4.6 4.6M14.8 14.8l4.6 4.6M19.4 4.6l-4.6 4.6M9.2 14.8l-4.6 4.6"/></svg>
    <div>
      <h1>이 PC의 디스크 지도</h1>
      <p id="meta" class="meta"></p>
    </div>
  </div>
  <div class="stats">
    <div class="card hero">
      <span class="hero-k">정리 가능 · 안전하게 지울 수 있는 용량</span>
      <strong id="hero-v">0 B</strong>
    </div>
    <ul id="drives" class="drives" aria-label="드라이브별 사용량"></ul>
  </div>
</header>
<div class="body">
  <main class="mapcol">
    <div id="cats" class="cats" role="group" aria-label="종류별 정리 가능 용량 (누르면 오른쪽 목록이 그 종류만 보입니다)"></div>
    <div class="navrow">
      <button id="up" type="button" class="up">↑ 위로</button>
      <nav id="crumbs" aria-label="현재 위치"></nav>
    </div>
    <div id="map" class="map" role="group" aria-label="폴더 크기 지도. 상자가 클수록 용량이 큽니다"></div>
    <div class="legend"><span class="dotmark" aria-hidden="true"></span><span>안에 정리할 것이 있는 폴더</span><span>옅음</span><span id="swatches" aria-hidden="true"></span><span>진함 = 지워도 되는 정도</span></div>
  </main>
  <aside class="side" aria-labelledby="side-h">
    <div class="side-top">
      <h2 id="side-h" hidden>정리할 수 있는 항목</h2>
      <p class="auto-expl">'삭제해도 되는 것'만 한 번에 골라 계획 파일을 저장합니다.</p>
      <button id="auto" type="button" class="btn btn-ol">안전한 것만 자동 선택</button>
    </div>
    <div id="junk-list"></div>
    <div class="foot">
      <p class="tot"><span id="sel-n">선택 0개</span><strong id="total">0 B</strong></p>
      <button id="export" type="button" class="btn btn-pri">정리 계획 저장</button>
      <div class="cmdrow"><code id="cmd" tabindex="0">node machine/clean.mjs machine-plan.json</code><button id="copy" type="button" class="copy">복사</button></div>
      <p id="status" role="status"></p>
      <p class="foot-note">이 화면은 아무것도 지우지 않습니다. 위 명령은 삭제 전에 한 번 더 확인합니다.</p>
    </div>
  </aside>
</div>
<div id="pop" class="pop" role="group" aria-label="나머지 종류" hidden></div>
<div id="tip" role="tooltip" hidden></div>
<script id="scan-data" type="application/json">${escapeJson(data)}</script>
<script>(${client.toString()})();</script>
</body>
</html>
`;
}
