(function () {
  'use strict';
  var api = window.monitor;
  var $ = function (id) { return document.getElementById(id); };
  var TABS = ['ov', 'flow', 'orch', 'route', 'tok', 'sav', 'set', 'codex', 'rt', 'opt'];
  var SEV = { bad: '문제', warn: '주의', info: '정보', ok: '정상' };
  var SRC = { claude: 'Claude', codex: 'Codex', updates: '업데이트' };
  function srcName(s) { return SRC[s] || s; }
  var CLAUDE_NOTE = '저장소 claude/ 내용을 라이브 ~/.claude에 복사합니다(apply.sh). 되돌리기는 없습니다.';
  // C4 writes only the repo settings.json and can be restored, so the apply.sh note is not for it.
  function runsApplySh(f) { return f.source === 'claude' && f.id.indexOf('C4:') !== 0; }

  var status = null;       // last Status
  var findings = null;     // FindingDto[] | null (not loaded yet)
  var findingsErr = '';
  var ui = {};             // findingId -> { open, diff, previewId, err, detail }
  var pending = false;     // a fix call is in flight (before the status push says so)
  var lastRev = null;
  var seq = 0;
  var frameUrl = '';
  var tab = 'ov';
  var cx = null;           // CodexDetail | null
  var cxErr = '';
  var cxSeq = 0;
  var cxKey = null;        // findingsRev|generatedAt of the last fetch
  var cxDirty = false;     // codex tab changed while hidden
  var rt = null;           // RoutinesDetail | null
  var rtErr = '';
  var rtSeq = 0;
  var rtAt = 0;            // when routines were last fetched (ms)
  var picks = {};          // findingId -> true/false when the user set the batch checkbox; unset follows f.recommended
  function isOn(f) { return Object.prototype.hasOwnProperty.call(picks, f.id) ? picks[f.id] : !!f.recommended; }
  var hist = null;         // HistoryEntry[] | null
  var histErr = '';
  var histSeq = 0;
  var batch = null;        // 최적화하기 run, kept in memory so redraws never drop it
  var prefs = null;        // Settings | null (not loaded yet)
  var prefsErr = '';

  // ---- DOM helper: text only, never innerHTML ----
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function announce(t) { $('live').textContent = t; }
  function errText(res) {
    return res && res.error && res.error.message ? res.error.message : '알 수 없는 오류';
  }

  // ---- tabs ----
  function currentHash() {
    var h = location.hash.slice(1);
    return TABS.indexOf(h) < 0 ? 'ov' : h;
  }
  function selectTab() {
    tab = currentHash();
    var btns = $('tabs').querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].getAttribute('data-tab') === tab) btns[i].setAttribute('aria-current', 'page');
      else btns[i].removeAttribute('aria-current');
    }
    var mon = tab !== 'codex' && tab !== 'opt' && tab !== 'rt';
    $('v-frame').hidden = !mon;
    $('v-codex').hidden = tab !== 'codex';
    $('v-rt').hidden = tab !== 'rt';
    if (tab === 'rt') loadRoutines(true);
    $('v-opt').hidden = tab !== 'opt';
    if (mon) { setFrame(); }
    if (tab === 'codex' && cxDirty) renderCodex();
    $('stage').scrollTop = 0;
    var cur = $('tabs').querySelector('[aria-current]');
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }
  $('tabs').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-tab]');
    if (b) location.hash = b.getAttribute('data-tab');
  });
  window.addEventListener('hashchange', selectTab);

  // ---- monitor frame: only the hash changes after the first load ----
  function setFrame() {
    var f = $('frame');
    if (!frameUrl) { return; }
    var want = frameUrl + '#' + tab;
    if (f.hidden) f.hidden = false;
    if (f.getAttribute('src') !== want) f.setAttribute('src', want);
  }
  function loadFrameUrl() {
    if (frameUrl || !api) return;
    api.getViewHtml().then(function (res) {
      var m = $('frame-msg');
      if (res && res.ok && res.data && res.data.fileUrl) {
        frameUrl = res.data.fileUrl;
        m.hidden = true;
        if (tab !== 'codex' && tab !== 'opt' && tab !== 'rt') setFrame();
      } else {
        m.textContent = '모니터 화면을 불러오지 못했습니다: ' + errText(res);
        m.hidden = false;
      }
    });
  }

  // ---- Codex tab: KPI row + 8 cards, each long list scrolls inside its card ----
  var CX_MISSING = '이 PC에서 ~/.codex를 찾지 못했습니다.';
  function dash(v) { return v == null || v === '' ? '–' : String(v); }
  function bytes(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '–';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }
  function onoff(b) { return b ? '켜짐' : '꺼짐'; }
  function kpi(label, value, note) {
    var k = el('div', 'kpi');
    k.appendChild(el('div', 'k', label));
    k.appendChild(el('div', 'v', value));
    k.appendChild(el('div', 'n', note || ''));
    return k;
  }
  // card: panel with a header and one scrolling body; returns the body
  function card(root, key, title, hint) {
    var sec = el('section', 'panel');
    sec.setAttribute('aria-label', title);
    sec.setAttribute('data-card', key);
    var ph = el('div', 'ph');
    ph.appendChild(el('h2', null, title));
    if (hint) ph.appendChild(el('span', 'hint', hint));
    sec.appendChild(ph);
    var body = el('div', 'sc');
    sec.appendChild(body);
    root.appendChild(sec);
    return body;
  }
  function kvRow(k, v) {
    var r = el('div', 'kv');
    r.appendChild(el('span', null, k));
    var val = el('span', null, dash(v));
    val.title = dash(v);
    r.appendChild(val);
    return r;
  }
  function none(body, t) { body.appendChild(el('p', 'cap', t)); }
  // two-line list row: dot, main text, right text; sub line under it
  function crow(on, main, right, sub, mono) {
    var r = el('div', 'cr');
    var dot = el('span', 'dt' + (on === true ? ' ok' : on === 'warn' ? ' warn' : ''));
    dot.setAttribute('aria-hidden', 'true');
    r.appendChild(dot);
    var m = el('span', 'cn' + (mono ? ' mono' : ''), main);
    m.title = main;
    r.appendChild(m);
    r.appendChild(el('span', 'cv', right || ''));
    if (sub && sub.length) {
      var s2 = el('span', 'cs');
      sub.forEach(function (x) { s2.appendChild(typeof x === 'string' ? el('span', null, x) : x); });
      r.appendChild(s2);
    }
    return r;
  }
  function pill(t) { return el('span', 'u', t); }
  function subhead(body, t) { body.appendChild(el('h3', 'sub', t)); }
  function count(list, fn) { return list.filter(fn).length; }

  function codexKpis(c, d) {
    var band = el('div', 'band k6');
    var set = {};
    if (d) d.settings.forEach(function (x) { set[x.key] = x.value; });
    var model = d ? set.model : c.model;
    var eff = d ? set.model_reasoning_effort : c.reasoningEffort;
    var appr = d ? set.approval_policy : c.approval;
    var sbx = d ? set.sandbox_mode : c.sandbox;
    band.appendChild(kpi('모델 · 추론', dash(model), '추론 ' + dash(eff)));
    band.appendChild(kpi('승인 · 샌드박스', dash(appr), '샌드박스 ' + dash(sbx)));
    if (d) {
      band.appendChild(kpi('플러그인', count(d.plugins, function (p) { return p.enabled; }) + '/' + d.plugins.length, '켜짐 / 전체'));
      band.appendChild(kpi('MCP 서버', count(d.mcpServers, function (p) { return p.enabled; }) + '/' + d.mcpServers.length, '켜짐 / 전체'));
      band.appendChild(kpi('신뢰 프로젝트', String(d.projects.length), '없는 경로 ' + count(d.projects, function (p) { return !p.exists; }) + '개'));
      band.appendChild(kpi('세션 7일', String(d.sessions.last7d), '전체 ' + d.sessions.total));
    } else {
      band.appendChild(kpi('플러그인', dash(c.plugins), '켜짐'));
      band.appendChild(kpi('MCP 서버', dash(c.mcpServers), '켜짐'));
      band.appendChild(kpi('신뢰 프로젝트', dash(c.trustedProjects), '없는 경로 ' + (c.missingProjects || 0) + '개'));
      band.appendChild(kpi('세션 7일', dash(c.sessions7d), ''));
    }
    return band;
  }

  function cardSettings(root, d) {
    var b = card(root, 'set', '설정', d.state && SEV[d.state] ? '상태: ' + SEV[d.state] : '');
    if (d.note) b.appendChild(el('p', 'cap', d.note));
    if (!d.settings.length) none(b, '표시할 설정이 없습니다.');
    d.settings.forEach(function (x) { b.appendChild(kvRow(x.key, x.value)); });
    if (d.hooks && d.hooks.total) b.appendChild(kvRow('훅 켜짐/전체', d.hooks.enabled + '/' + d.hooks.total + (d.hooks.missing ? ' (없는 경로 ' + d.hooks.missing + ')' : '')));
  }
  function cardPlugins(root, d) {
    var b = card(root, 'plug', '플러그인', count(d.plugins, function (p) { return p.enabled; }) + '/' + d.plugins.length + ' 켜짐');
    if (!d.plugins.length) none(b, '플러그인이 없습니다.');
    d.plugins.forEach(function (p) { b.appendChild(crow(p.enabled, p.name, onoff(p.enabled), p.marketplace ? [p.marketplace] : null)); });
  }
  function cardMcp(root, d) {
    var b = card(root, 'mcp', 'MCP 서버', count(d.mcpServers, function (p) { return p.enabled; }) + '/' + d.mcpServers.length + ' 켜짐');
    if (!d.mcpServers.length) none(b, 'MCP 서버가 없습니다.');
    d.mcpServers.forEach(function (m) {
      var meta = [];
      if (m.transport) meta.push(pill(m.transport));
      if (m.hasEnv) meta.push(pill('env 있음'));
      if (m.startupTimeoutSec != null) meta.push('시작 ' + m.startupTimeoutSec + '초');
      if (m.toolTimeoutSec != null) meta.push('도구 ' + m.toolTimeoutSec + '초');
      b.appendChild(crow(m.enabled, m.name, onoff(m.enabled), meta));
    });
  }
  function cardProjects(root, d) {
    var miss = count(d.projects, function (p) { return !p.exists; });
    var b = card(root, 'proj', '신뢰 프로젝트', d.projects.length + '개' + (miss ? ' · 없는 경로 ' + miss : ''));
    if (!d.projects.length) none(b, '신뢰 프로젝트가 없습니다.');
    d.projects.forEach(function (p) {
      var meta = [dash(p.trustLevel)];
      if (!p.exists) meta.push(el('span', 'st warn', '없는 경로'));
      b.appendChild(crow(p.exists ? true : 'warn', p.path, '', meta, true));
    });
  }
  function cardAgents(root, d) {
    var b = card(root, 'agent', '에이전트 · 스킬', 'AGENTS.md ' + (d.agentsMd == null ? '없음' : bytes(d.agentsMd)));
    subhead(b, '에이전트 ' + d.agents.length);
    if (!d.agents.length) none(b, '에이전트 파일이 없습니다.');
    d.agents.forEach(function (a) { b.appendChild(crow(true, a.name, bytes(a.bytes), null, true)); });
    subhead(b, '스킬 ' + d.skills.length);
    if (!d.skills.length) none(b, '스킬이 없습니다.');
    var chips = el('div', 'chips');
    d.skills.forEach(function (n) { chips.appendChild(pill(n)); });
    b.appendChild(chips);
  }
  function cardSessions(root, d) {
    var s = d.sessions;
    var b = card(root, 'sess', '세션', '7일 ' + s.last7d + ' · 전체 ' + s.total + ' · 보관 ' + s.archived);
    var dates = Object.keys(s.byDate || {}).sort().slice(-7);
    if (!dates.length) { none(b, '최근 7일 세션이 없습니다.'); return; }
    var max = Math.max.apply(null, dates.map(function (k) { return s.byDate[k]; })) || 1;
    dates.forEach(function (k) {
      var r = el('div', 'br');
      r.appendChild(el('span', 'bl', k.slice(5)));
      var tr = el('span', 'bt');
      tr.setAttribute('aria-hidden', 'true');
      var fl = el('span', 'bf');
      fl.style.width = (s.byDate[k] / max * 100).toFixed(1) + '%'; // CSSOM, allowed by the style-src 'self' CSP
      tr.appendChild(fl);
      r.appendChild(tr);
      r.appendChild(el('span', 'bv', String(s.byDate[k])));
      b.appendChild(r);
    });
  }
  function cardRepo(root, d) {
    var b = card(root, 'repo', '저장소 정리', '작업트리 ' + d.worktrees);
    subhead(b, '로그 DB');
    if (!d.logs.length) none(b, '로그 파일이 없습니다.');
    d.logs.forEach(function (l) { b.appendChild(crow(true, l.name, bytes(l.bytes), null, true)); });
    subhead(b, '백업 ' + d.backups.length);
    if (!d.backups.length) none(b, '백업이 없습니다.');
    d.backups.forEach(function (x) { b.appendChild(crow(true, x.name, bytes(x.bytes), [dash(String(x.mtime || '').slice(0, 10))], true)); });
  }
  function cardOpt(root) {
    var list = (findings || []).filter(function (f) { return f.source === 'codex'; });
    var b = card(root, 'opt', 'Codex 최적화', findings ? '발견 ' + list.length + '건' : '');
    if (findings == null) none(b, findingsErr ? '불러오지 못했습니다: ' + findingsErr : '불러오는 중…');
    else if (!list.length) b.appendChild(runline('발견 0건 — 지금은 고칠 것이 없습니다.', false));
    else {
      var ul = el('ul', 'pitems');
      groupItems(list, true).forEach(function (g) { ul.appendChild(g); });
      b.appendChild(ul);
    }
    var nfix = count(list, batchable);
    b.parentNode.appendChild(btn(nfix ? '최적화하기 (' + nfix + '건) — 최적화 탭으로' : '최적화 탭에서 모두 보기', 'cx|goto-opt', function () { location.hash = 'opt'; }, nfix ? 'link go' : 'link'));
  }

  function renderCodex() {
    var root = $('v-codex');
    if (tab !== 'codex') { cxDirty = true; return; }
    cxDirty = false;
    var f = focusInfo(root);
    var scr = {};
    Array.prototype.forEach.call(root.querySelectorAll('[data-card] .sc'), function (n) { scr[n.parentNode.getAttribute('data-card')] = n.scrollTop; });
    root.replaceChildren();
    var c = status ? status.codex : null;
    var d = cx;
    var msg = '';
    if (!status || (c == null && !d && status.state === 'starting')) msg = '불러오는 중…';
    else if ((d && d.state === 'missing') || (!d && c && c.state === 'missing')) msg = CX_MISSING;
    else if (c == null && !d) msg = '데이터 없음';
    if (msg) { root.appendChild(el('p', 'msg', msg)); return; }
    root.appendChild(codexKpis(c, d));
    var grid = el('div', 'cxg');
    if (d) {
      cardSettings(grid, d); cardPlugins(grid, d); cardMcp(grid, d); cardProjects(grid, d);
      cardAgents(grid, d); cardSessions(grid, d); cardRepo(grid, d);
    } else {
      [['set', '설정'], ['plug', '플러그인'], ['mcp', 'MCP 서버'], ['proj', '신뢰 프로젝트'], ['agent', '에이전트 · 스킬'], ['sess', '세션'], ['repo', '저장소 정리']].forEach(function (n) {
        none(card(grid, n[0], n[1]), cxErr ? '자세한 정보를 불러오지 못했습니다: ' + cxErr : '불러오는 중…');
      });
    }
    cardOpt(grid);
    root.appendChild(grid);
    Array.prototype.forEach.call(root.querySelectorAll('[data-card] .sc'), function (n) { n.scrollTop = scr[n.parentNode.getAttribute('data-card')] || 0; });
    refocus(root, f);
  }
  function loadCodex() {
    if (!api || !api.getCodexDetail) return Promise.resolve();
    var my = ++cxSeq;
    return api.getCodexDetail().then(function (res) {
      if (my !== cxSeq) return;
      if (res && res.ok && res.data) { cx = res.data; cxErr = ''; }
      else { cxErr = errText(res); }
      renderCodex();
    }, function () { if (my === cxSeq) { cxErr = '요청을 처리하지 못했습니다'; renderCodex(); } });
  }

  // ---- 루틴 tab: report only; Claude and Codex schedules, plus Windows tasks and startup entries that run them ----
  var TRIG_KO = { event: '이벤트', time: '정한 시각', daily: '매일', weekly: '매주', monthly: '매월', idle: '유휴 시', registration: '등록 시', boot: '부팅 시', logon: '로그온 시', session: '세션 바뀔 때', other: '기타' };
  var STATE_KO = { ready: '대기', running: '실행 중', disabled: '꺼짐', queued: '대기열', unknown: '알 수 없음' };
  var ACCT_KO = { system: 'SYSTEM', service: '서비스', user: '사용자' };
  var LOC_KO = { run: 'Run 키', runonce: 'RunOnce 키', folder: '시작 폴더' };
  var AI_KO = { claude: 'Claude', codex: 'Codex' };
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function stamp(iso) {
    if (!iso) return '–';
    var d = new Date(iso);
    return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function every(dur) { // ISO 8601 duration like PT1H, PT30M, P1D
    var m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(dur || '');
    if (!m) return dur;
    return (m[1] ? m[1] + '일' : '') + (m[2] ? m[2] + '시간' : '') + (m[3] ? m[3] + '분' : '') + '마다';
  }
  function trig(t) { var p = t.split('/'); return (TRIG_KO[p[0]] || p[0]) + (p[1] ? ' · ' + every(p[1]) : ''); }
  // unique kinds, "기타" only when nothing else is known, at most three
  function trigs(list) {
    var seen = [];
    list.map(trig).forEach(function (x) { if (seen.indexOf(x) < 0) seen.push(x); });
    if (seen.length > 1) seen = seen.filter(function (x) { return x !== TRIG_KO.other; });
    return seen.length ? seen.slice(0, 3).join(', ') + (seen.length > 3 ? ' 외 ' + (seen.length - 3) : '') : '없음';
  }
  // RFC 5545 RRULE as Codex stores it, e.g. FREQ=DAILY;BYHOUR=8;BYMINUTE=0 -> 매일 08:00
  var FREQ_KO = { MINUTELY: ['매분', '분'], HOURLY: ['매시간', '시간'], DAILY: ['매일', '일'], WEEKLY: ['매주', '주'], MONTHLY: ['매월', '개월'], YEARLY: ['매년', '년'] };
  var DAY_KO = { MO: '월', TU: '화', WE: '수', TH: '목', FR: '금', SA: '토', SU: '일' };
  function rrule(r) {
    if (!r) return '–';
    var p = {};
    r.split(';').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) p[kv.slice(0, i)] = kv.slice(i + 1); });
    var f = FREQ_KO[p.FREQ];
    if (!f) return r;
    var n = Number(p.INTERVAL) > 1 ? p.INTERVAL + f[1] + '마다' : f[0];
    var days = p.BYDAY ? ' ' + p.BYDAY.split(',').map(function (d) { return DAY_KO[d.slice(-2)] || d; }).join('·') : '';
    var hs = p.BYHOUR ? p.BYHOUR.split(',') : [];
    var at = hs.length ? ' ' + hs.map(function (h) { return pad2(Number(h)) + ':' + pad2(Number(p.BYMINUTE || 0)); }).join(', ') : p.BYMINUTE && !hs.length ? ' ' + p.BYMINUTE + '분' : '';
    return n + days + at;
  }
  function stCell(text, cls) { return el('span', 'st ' + cls, text); }
  function taskState(t) {
    if (t.failed) return stCell('실패', 'bad');
    if (!t.enabled) return stCell('꺼짐', 'off');
    return stCell(STATE_KO[t.state] || t.state, t.state === 'running' ? 'ok' : 'idle');
  }
  // a table that scrolls sideways inside its own wrapper; the first cell of a row is its header
  function table(body, label, heads, rows) {
    var wrap = el('div', 'tw');
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', label);
    wrap.tabIndex = 0;
    var t = el('table', 'rt');
    t.appendChild(el('caption', 'sr', label));
    var hr = el('tr');
    heads.forEach(function (h) { var th = el('th', null, h); th.setAttribute('scope', 'col'); hr.appendChild(th); });
    var thead = el('thead'); thead.appendChild(hr); t.appendChild(thead);
    var tb = el('tbody');
    rows.forEach(function (r) {
      var tr = el('tr', r.cls || null);
      r.cells.forEach(function (c, i) {
        var td = el(i === 0 ? 'th' : 'td');
        if (i === 0) td.setAttribute('scope', 'row');
        if (c && typeof c === 'object') td.appendChild(c); else td.textContent = c == null || c === '' ? '–' : String(c);
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    wrap.appendChild(t);
    body.appendChild(wrap);
  }
  function nameCell(name, sub) {
    var w = el('span', 'nm');
    w.appendChild(el('span', 'n1', name));
    if (sub) w.appendChild(el('span', 'n2', sub));
    w.title = (sub || '') + name;
    return w;
  }
  function folderOf(t) { var i = t.path.lastIndexOf('\\'); return i > 0 ? t.path.slice(0, i + 1) : ''; }
  function byNext(a, b) { var x = a.nextRun || '9', y = b.nextRun || '9'; return x < y ? -1 : x > y ? 1 : a.name.localeCompare(b.name); }
  function active(a) { return a.status === 'active'; }
  function rtKpis(d) {
    var band = el('div', 'band k4');
    band.appendChild(kpi('Claude 예약 작업', String(d.claude.length), '~/.claude/scheduled-tasks'));
    band.appendChild(kpi('Codex 자동화', count(d.codex, active) + '/' + d.codex.length, '켜짐 / 전체'));
    var failed = count(d.tasks, function (t) { return t.failed; });
    var k = kpi('Windows 예약 작업', String(d.tasks.length), failed ? '실패 ' + failed + '건' : 'Claude·Codex를 실행하는 것');
    if (failed) k.classList.add('bad');
    band.appendChild(k);
    band.appendChild(kpi('시작 프로그램', count(d.startup, function (s) { return s.enabled !== false; }) + '/' + d.startup.length, '켜짐 / 전체'));
    return band;
  }
  function rtClaude(root, d) {
    var b = card(root, 'claude', 'Claude 예약 작업', d.claude.length + '개 · 일정과 실행 기록은 Claude 앱에');
    if (!d.claude.length) { none(b, '~/.claude/scheduled-tasks 에 작업이 없습니다.'); return; }
    d.claude.forEach(function (c) { b.appendChild(crow(true, c.name, '', c.description ? [c.description] : null)); });
  }
  function rtCodex(root, d) {
    var b = card(root, 'codex', 'Codex 자동화', count(d.codex, active) + '/' + d.codex.length + ' 켜짐');
    if (!d.codex.length) { none(b, '~/.codex/automations 에 자동화가 없습니다.'); return; }
    var list = d.codex.slice().sort(function (a, x) { return active(x) - active(a) || a.name.localeCompare(x.name); });
    table(b, 'Codex 자동화 목록', ['이름', '상태', '일정', '종류', '바뀐 때'], list.map(function (a) {
      var when = el('span', null, rrule(a.rrule));
      when.title = a.rrule;
      return { cls: active(a) ? null : 'off', cells: [nameCell(a.name, a.id.toLowerCase() !== a.name.toLowerCase() ? a.id : ''), active(a) ? stCell('켜짐', 'ok') : stCell(a.status || '알 수 없음', 'off'), when, a.kind, stamp(a.updatedAt)] };
    }));
  }
  function rtTasks(root, d) {
    var b = card(root, 'tasks', 'Windows 예약 작업', d.tasks.length + '개 · Claude·Codex를 실행하는 것만');
    if (d.windowsNote) b.appendChild(el('p', 'cap', d.windowsNote));
    if (!d.tasks.length) { if (!d.windowsNote) none(b, 'Claude나 Codex를 실행하는 예약 작업이 없습니다.'); return; }
    var list = d.tasks.slice().sort(function (a, x) { return (x.failed - a.failed) || byNext(a, x); });
    table(b, 'Windows 예약 작업 목록', ['이름', '도구', '상태', '언제', '마지막 실행', '결과', '다음 실행', '실행 파일', '계정'], list.map(function (t) {
      return { cls: t.failed ? 'bad' : !t.enabled ? 'off' : null, cells: [
        nameCell(t.name, folderOf(t)), AI_KO[t.ai], taskState(t), trigs(t.triggers),
        stamp(t.lastRun), t.lastResult, stamp(t.nextRun), t.exe, (ACCT_KO[t.account] || '–') + (t.elevated ? ' · 관리자' : ''),
      ] };
    }));
  }
  function rtStartup(root, d) {
    var b = card(root, 'start', '시작 프로그램', count(d.startup, function (s) { return s.enabled !== false; }) + '/' + d.startup.length + ' 켜짐');
    if (!d.startup.length) { none(b, d.windowsNote ? '–' : 'Claude나 Codex를 여는 시작 프로그램이 없습니다.'); return; }
    var list = d.startup.slice().sort(function (a, x) { return (a.enabled === false) - (x.enabled === false) || a.name.localeCompare(x.name); });
    table(b, '시작 프로그램 목록', ['이름', '도구', '상태', '위치', '대상', '실행 파일'], list.map(function (s) {
      return { cls: s.enabled === false ? 'off' : null, cells: [
        s.name, AI_KO[s.ai], s.enabled === false ? stCell('꺼짐', 'off') : stCell('켜짐', 'ok'), LOC_KO[s.location], s.scope === 'all' ? '모든 사용자' : '나', s.exe,
      ] };
    }));
  }
  function renderRoutines() {
    var root = $('v-rt');
    if (tab !== 'rt') return;
    var f = focusInfo(root);
    root.replaceChildren();
    var d = rt;
    if (!d) { root.appendChild(el('p', 'msg', rtErr ? '루틴을 불러오지 못했습니다: ' + rtErr : '불러오는 중…')); return; }
    if (d.status !== 'ok') { root.appendChild(el('p', 'msg', d.note || '루틴을 읽지 못했습니다.')); return; }
    root.appendChild(rtKpis(d));
    root.appendChild(el('p', 'cap', '보고만 합니다. 바꾸려면 Claude 앱의 예약 작업, Codex 앱의 자동화, Windows 작업 스케줄러를 쓰세요. 마지막 수집 ' + stamp(d.collectedAt) + ' (10분마다).'));
    var grid = el('div', 'rtg');
    rtClaude(grid, d); rtCodex(grid, d); rtTasks(grid, d); rtStartup(grid, d);
    root.appendChild(grid);
    refocus(root, f);
  }
  // force: the tab was just opened; otherwise at most once a minute (the source itself refreshes every 10 minutes)
  function loadRoutines(force) {
    if (!api || !api.getRoutines) return;
    if (!force && Date.now() - rtAt < 60000) return;
    rtAt = Date.now();
    var my = ++rtSeq;
    if (force) renderRoutines();
    api.getRoutines().then(function (res) {
      if (my !== rtSeq) return;
      if (res && res.ok && res.data) { rt = res.data; rtErr = ''; } else { rtErr = errText(res); rtAt = 0; }
      renderRoutines();
    }, function () { if (my === rtSeq) { rtErr = '요청을 처리하지 못했습니다'; rtAt = 0; renderRoutines(); } });
  }

  function focusInfo(root) {
    var ae = document.activeElement;
    if (!ae || !root.contains(ae)) return null;
    var row = ae.closest ? ae.closest('[data-row]') : null;
    return { key: ae.getAttribute('data-key'), rowId: row ? row.getAttribute('data-row') : null };
  }
  function refocus(root, f) {
    if (!f) return;
    var target = null;
    if (f.key) target = Array.prototype.filter.call(root.querySelectorAll('[data-key]'), function (n) { return n.getAttribute('data-key') === f.key && !n.disabled; })[0];
    if (!target && f.rowId) target = Array.prototype.filter.call(root.querySelectorAll('[data-row]'), function (n) { return n.getAttribute('data-row') === f.rowId; })[0];
    if (target) target.focus({ preventScroll: true });
  }
  function redraw() { renderOpt(); renderCodex(); }

  // ---- 최적화 panel ----
  function isBusy() { return pending || !!batch || !!(status && status.busyFindingId); }
  function state(id) { return ui[id] || (ui[id] = { open: false, diff: null, previewId: null, err: '', detail: '' }); }

  function diffBox(f, text) {
    var box = el('div', 'df');
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', '바뀔 내용');
    box.tabIndex = 0;
    text.split('\n').forEach(function (line) {
      var cls = 'c';
      if (f.source === 'codex' && line !== '' && line[0] !== '+' && line[0] !== '-') line = '- ' + line; // X1 sends the removed lines bare
      if (line[0] === '+') cls = 'a'; else if (line[0] === '-') cls = 'd';
      box.appendChild(el('div', cls, line === '' ? ' ' : line));
    });
    return box;
  }
  function btn(label, key, handler, cls, disabled) {
    var b = el('button', 'btn' + (cls ? ' ' + cls : ''), label);
    b.type = 'button';
    b.setAttribute('data-key', key);
    if (disabled) b.disabled = true;
    b.addEventListener('click', handler);
    return b;
  }
  function runline(text, live) {
    var p = el('p', 'runline');
    p.appendChild(el('span', live ? 'pip live' : 'dt ok'));
    p.lastChild.setAttribute('aria-hidden', 'true');
    p.appendChild(el('b', null, text));
    return p;
  }

  // one finding as a compact row: evidence (or title) left, state + small buttons right, error/diff under it
  function findingRow(f, showTitle, compact) {
    var s = state(f.id);
    var li = el('li', 'frow');
    li.setAttribute('data-row', f.id);
    li.tabIndex = -1;
    if (!compact && batchable(f)) {
      li.className += ' hasck';
      li.appendChild(checkbox(isOn(f), f.id + '|chk', '최적화 대상: ' + (showTitle ? f.title : (f.evidence && f.evidence.length ? f.evidence.join(' ') : f.title)), function (on) {
        picks[f.id] = on;
        redraw();
      }));
    }
    var label = showTitle ? f.title : (f.evidence && f.evidence.length ? f.evidence.join('  ·  ') : f.title);
    var fl = el('span', 'fl' + (showTitle ? '' : ' mono'), label);
    fl.title = label;
    li.appendChild(fl);
    var fs = f.fixState;
    var off = isBusy();
    var side = el('div', 'acts');
    var stt = null;
    if (fs === 'applying') stt = runline('적용 중', true);
    else if (fs === 'restoring') stt = runline('되돌리는 중', true);
    else if (fs === 'applied') stt = runline('적용됨', false);
    else if (fs === 'restored') stt = runline('되돌림 완료', false);
    else if (fs === 'applyFailed') stt = el('span', 'st bad', '적용 실패');
    else if (fs === 'restoreFailed') stt = el('span', 'st bad', '되돌리기 실패');
    else if (fs === 'previewFailed') stt = el('span', 'st bad', '미리보기 실패');
    if (stt) side.appendChild(stt);
    var canPreview = fs == null || fs === 'proposed' || fs === 'previewed' || fs === 'previewFailed' || fs === 'applyFailed';
    if (f.fixable) {
      if (canPreview) {
        var pb = btn('미리보기', f.id + '|preview', function () { onPreview(f); }, 'sm', off);
        pb.setAttribute('aria-expanded', s.open ? 'true' : 'false');
        side.appendChild(pb);
        if (s.open && s.previewId) side.appendChild(btn('적용', f.id + '|apply', function () { onApply(f); }, 'sm go', off));
      }
      if ((fs === 'applied' || fs === 'restoreFailed') && f.restorable) side.appendChild(btn('되돌리기', f.id + '|restore', function () { onRestore(f); }, 'sm', off));
    }
    li.appendChild(side);
    if (f.fixable) {
      if (s.err) li.appendChild(el('p', 'err', s.err));
      if (s.detail) li.appendChild(el('p', 'ev mono', s.detail));
      if (canPreview && s.open && s.diff != null) {
        if (runsApplySh(f)) li.appendChild(el('p', 'cap', CLAUDE_NOTE));
        li.appendChild(diffBox(f, s.diff));
      }
    }
    return li;
  }

  // findings sharing a checkId become one group: header once, one row per finding
  function groupItems(list, compact) {
    var order = [], by = {};
    list.forEach(function (f) {
      var k = f.source + '|' + f.checkId;
      if (!by[k]) { by[k] = []; order.push(k); }
      by[k].push(f);
    });
    var RANK = { bad: 0, warn: 1, info: 2, ok: 3 };
    return order.map(function (k) {
      var g = by[k], first = g[0];
      var same = g.every(function (f) { return f.title === first.title && f.detail === first.detail; });
      var sev = g.reduce(function (a, f) { return RANK[f.severity] < RANK[a] ? f.severity : a; }, first.severity);
      var li = el('li', 'grp');
      var head = el('div', 'head');
      var fixable = compact ? [] : g.filter(batchable);
      if (fixable.length) {
        var on = count(fixable, isOn);
        var gc = checkbox(on === fixable.length, first.source + '|' + first.checkId + '|chk', '그룹 전체 선택: ' + first.checkId, function (v) {
          fixable.forEach(function (f) { picks[f.id] = v; });
          redraw();
        });
        gc.indeterminate = on > 0 && on < fixable.length;
        head.appendChild(gc);
      }
      var dot = el('span', 'dt ' + (sev === 'info' ? '' : sev));
      dot.setAttribute('aria-hidden', 'true');
      head.appendChild(dot);
      head.appendChild(el('span', 'what', same ? first.title : srcName(first.source) + ' 점검 ' + first.checkId));
      head.appendChild(el('span', 'st ' + (sev === 'info' ? '' : sev), SEV[sev] || sev));
      head.appendChild(el('span', 'u', srcName(first.source)));
      if (g.length > 1) head.appendChild(el('span', 'u', g.length + '건'));
      if (g.every(function (f) { return !f.fixable; })) head.appendChild(el('span', 'only', '보고만'));
      li.appendChild(head);
      if (same) li.appendChild(el('p', 'ev', first.detail));
      var ul = el('ul', 'rows');
      g.forEach(function (f) {
        var row = findingRow(f, !same, compact);
        if (!same) row.appendChild(el('p', 'ev', f.detail));
        ul.appendChild(row);
      });
      li.appendChild(ul);
      return li;
    });
  }
  function summaryText(list) {
    var n = function (fn) { return list.filter(fn).length; };
    return 'Claude ' + n(function (f) { return f.source === 'claude'; }) + ' · Codex ' + n(function (f) { return f.source === 'codex'; }) +
      ' · 업데이트 ' + n(function (f) { return f.source === 'updates'; }) +
      ' · 문제 ' + n(function (f) { return f.severity === 'bad'; }) + ' · 주의 ' + n(function (f) { return f.severity === 'warn'; }) +
      ' · 정보 ' + n(function (f) { return f.severity === 'info'; });
  }

  // ---- 최적화하기: preview all checked fixes, apply them one by one, undo all ----
  function batchable(f) {
    if (!f.fixable) return false;
    var fs = f.fixState;
    if (fs === 'proposed' || fs === 'previewFailed' || fs === 'applyFailed') return true;
    return fs === 'previewed'; // a cached preview is reused; otherwise main issues a fresh previewId
  }
  function checkbox(on, key, label, change) {
    var c = el('input', 'ck');
    c.type = 'checkbox';
    c.checked = on;
    c.disabled = !!batch;
    c.setAttribute('data-key', key);
    c.setAttribute('aria-label', label);
    c.addEventListener('change', function () { change(c.checked); });
    return c;
  }
  function focusBatch() {
    var h = $('v-opt').querySelector('[data-bh]');
    if (h) h.focus({ preventScroll: true });
  }
  function fail1(res) {
    var d = res && res.error && res.error.detail ? ' (' + res.error.detail + ')' : '';
    return errText(res) + d;
  }

  function optBar() {
    var list = (findings || []).filter(batchable);
    var nc = count(list, function (f) { return f.source === 'claude'; });
    var nx = count(list, function (f) { return f.source === 'codex'; });
    var sel = count(list, isOn);
    var rec = count(list, function (f) { return f.recommended; });
    var bar = el('div', 'optbar');
    if (list.length) {
      bar.appendChild(el('span', 'cap', '고칠 수 있는 것 ' + list.length + '건 중 ' + sel + '건 선택 · Claude ' + nc + ' · Codex ' + nx));
      var lock = !!batch || isBusy();
      bar.appendChild(btn('권장만 (' + rec + ')', 'opt|rec', function () { list.forEach(function (f) { picks[f.id] = !!f.recommended; }); redraw(); }, 'sm', lock));
      bar.appendChild(btn('전체 선택', 'opt|all', function () { list.forEach(function (f) { picks[f.id] = true; }); redraw(); }, 'sm', lock));
      bar.appendChild(el('span', 'cap', '권장 항목은 백업·되돌리기가 되거나 저장소→라이브 동기화입니다. 선택한 것을 한 번에 미리보기한 뒤 적용합니다.'));
    }
    return bar;
  }

  function batchStart() {
    if (batch || isBusy()) return;
    var picked = (findings || []).filter(function (f) { return batchable(f) && isOn(f); });
    if (!picked.length) return;
    var b = batch = { phase: 'preview', i: 0, stop: '', restoring: false, ri: 0, rn: 0, items: picked.map(function (f) {
      return { id: f.id, source: f.source, title: f.title, ev: f.evidence && f.evidence.length ? f.evidence.join('  ·  ') : '', cached: f.fixState === 'previewed' && !!state(f.id).previewId,
        diff: null, previewId: null, restorable: false, err: '', out: '', backup: null, rs: '', rmsg: '' };
    }) };
    redraw(); focusBatch();
    batchPreview(b, 0);
  }
  function batchPreview(b, i) {
    if (batch !== b) return;
    if (i >= b.items.length) {
      b.phase = 'review'; b.i = 0;
      announce('변경 미리보기 준비됨');
      redraw(); focusBatch();
      return loadFindings();
    }
    b.i = i; redraw();
    var it = b.items[i], s = state(it.id);
    if (it.cached) { it.diff = s.diff; it.previewId = s.previewId; return batchPreview(b, i + 1); }
    return api.previewFix(it.id).then(function (res) {
      if (res && res.ok && res.data) {
        it.diff = res.data.diff; it.previewId = res.data.previewId; it.restorable = !!res.data.restorable;
        s.diff = it.diff; s.previewId = it.previewId; s.open = false; s.err = ''; s.detail = ''; // the row's own 미리보기 re-shows it
      } else it.err = '미리보기 실패: ' + fail1(res);
    }, function () { it.err = '미리보기 실패: 요청을 처리하지 못했습니다'; }).then(function () { return batchPreview(b, i + 1); });
  }
  function batchCancel() {
    if (!batch || batch.phase === 'preview' || batch.phase === 'apply' || batch.restoring) return;
    batch = null;
    redraw();
    loadFindings();
  }
  function batchApply() {
    var b = batch;
    if (!b || b.phase !== 'review') return;
    var todo = b.items.filter(function (x) { return x.previewId && !x.err; });
    if (!todo.length) return;
    b.phase = 'apply'; b.i = 0; b.rn = todo.length;
    announce('적용 중'); redraw(); focusBatch();
    (function next(k) {
      if (batch !== b) return;
      if (k >= todo.length) {
        b.phase = 'result';
        announce('적용 끝'); redraw(); focusBatch();
        return loadFindings();
      }
      b.i = k; redraw();
      var it = todo[k], s = state(it.id), stop = false;
      api.applyFix(it.id, it.previewId).then(function (res) {
        s.open = false; s.diff = null; s.previewId = null; s.err = ''; s.detail = '';
        if (res && res.ok) {
          it.out = 'applied';
          it.restorable = !!(res.data && res.data.restorable);
          it.backup = res.data && res.data.backupName ? res.data.backupName : null;
        } else {
          it.out = 'failed'; it.err = fail1(res);
          var code = res && res.error && res.error.code;
          if (code === 'PREVIEW_STALE' || code === 'FIX_BUSY') {
            stop = true;
            b.stop = '중단: ' + errText(res) + ' — 남은 항목은 적용하지 않았습니다.';
          }
        }
      }, function () { it.out = 'failed'; it.err = '요청을 처리하지 못했습니다'; }).then(function () {
        if (stop) {
          for (var j = k + 1; j < todo.length; j++) todo[j].out = 'skipped';
          return next(todo.length);
        }
        return next(k + 1);
      });
    })(0);
  }
  function batchRestore() {
    var b = batch;
    if (!b || b.phase !== 'result' || b.restoring) return;
    // newest first: each Codex restore checks the file hash right after its own apply, which a later apply changed
    var todo = b.items.filter(function (x) { return x.out === 'applied' && x.restorable && x.rs !== 'restored'; }).reverse();
    if (!todo.length) return;
    b.restoring = true; b.ri = 0; b.rn = todo.length;
    announce('되돌리는 중'); redraw();
    (function next(k) {
      if (batch !== b) return;
      if (k >= todo.length) {
        b.restoring = false;
        announce('되돌리기 끝'); redraw();
        return loadFindings();
      }
      b.ri = k; redraw();
      var it = todo[k];
      api.restoreFix(it.id).then(function (res) {
        if (res && res.ok) { it.rs = 'restored'; it.rmsg = ''; }
        else { it.rs = 'failed'; it.rmsg = fail1(res); }
      }, function () { it.rs = 'failed'; it.rmsg = '요청을 처리하지 못했습니다'; }).then(function () { next(k + 1); });
    })(0);
  }

  function batchItem(it, withDiff) {
    var li = el('li', 'bitem');
    var h = el('div', 'bh');
    h.appendChild(el('span', 'u', srcName(it.source)));
    h.appendChild(el('b', null, it.title));
    if (it.ev) h.appendChild(el('span', 'cap mono', it.ev));
    li.appendChild(h);
    if (it.err) li.appendChild(el('p', 'err', it.err));
    if (withDiff && it.diff != null && !it.err) li.appendChild(diffBox(it, it.diff));
    return li;
  }
  function itemStatus(it) {
    var li = batchItem(it, false);
    var t = null;
    if (it.rs === 'restored') t = el('span', 'st ok', '되돌림 완료');
    else if (it.rs === 'failed') t = el('span', 'st bad', '되돌리기 실패: ' + it.rmsg);
    else if (it.out === 'applied') t = el('span', 'st ok', it.restorable ? '적용됨' : '적용됨 · 되돌릴 수 없음');
    else if (it.out === 'failed') t = el('span', 'st bad', '적용 실패');
    else if (it.out === 'skipped') t = el('span', 'st', '건너뜀');
    else if (it.err) t = el('span', 'st bad', '제외');
    else if (it.previewId) t = el('span', 'st', '미리보기 완료');
    else t = el('span', 'st', '대기');
    li.firstChild.appendChild(t);
    return li;
  }

  function batchPanel() {
    var b = batch;
    var title = b.phase === 'apply' ? '적용 중' : b.phase === 'result' ? '최적화 결과' : '변경 미리보기';
    var sec = el('section', 'panel batch');
    sec.setAttribute('aria-label', title);
    var ph = el('div', 'ph');
    var h2 = el('h2', null, title);
    h2.tabIndex = -1;
    h2.setAttribute('data-bh', '1');
    ph.appendChild(h2);
    sec.appendChild(ph);
    var body = el('div', 'sc');
    var foot = el('div', 'bfoot');
    var ul = el('ul', 'bitems');
    var n = b.items.length;
    var ok = b.items.filter(function (x) { return x.previewId && !x.err; });
    var bad = b.items.filter(function (x) { return x.err && !x.out; });
    if (b.phase === 'preview') {
      body.appendChild(runline((b.i + 1) + '/' + n + ' 미리보기 중…', true));
      b.items.forEach(function (it) { ul.appendChild(itemStatus(it)); });
      body.appendChild(ul);
    } else if (b.phase === 'review') {
      ph.appendChild(el('span', 'hint', ok.length + '개 적용 가능' + (bad.length ? ' · 제외 ' + bad.length : '')));
      if (ok.some(runsApplySh)) body.appendChild(el('p', 'cap', 'Claude 항목: ' + CLAUDE_NOTE));
      b.items.forEach(function (it) { ul.appendChild(batchItem(it, true)); });
      body.appendChild(ul);
      foot.appendChild(btn('취소', 'batch|cancel', batchCancel));
      foot.appendChild(btn(ok.length + '개 적용', 'batch|apply', batchApply, 'prim', !ok.length));
    } else if (b.phase === 'apply') {
      body.appendChild(runline((b.i + 1) + '/' + b.rn + ' 적용 중…', true));
      b.items.forEach(function (it) { ul.appendChild(itemStatus(it)); });
      body.appendChild(ul);
    } else {
      var ap = b.items.filter(function (x) { return x.out === 'applied'; });
      var nf = b.items.filter(function (x) { return x.out === 'failed'; }).length;
      var names = ap.map(function (x) { return x.backup; }).filter(Boolean);
      var sum = '적용 ' + ap.length + ' · 실패 ' + nf + (bad.length ? ' · 제외 ' + bad.length : '') + ' · 백업 ' + (names.length ? names.join(', ') : '없음');
      body.appendChild(el('p', 'bsum', sum));
      if (b.stop) body.appendChild(el('p', 'err', b.stop));
      var rd = b.items.filter(function (x) { return x.rs; });
      if (rd.length) {
        var rok = count(rd, function (x) { return x.rs === 'restored'; });
        body.appendChild(el('p', 'bsum', '되돌림 ' + rok + ' · 실패 ' + (rd.length - rok)));
      }
      if (b.restoring) body.appendChild(runline((b.ri + 1) + '/' + b.rn + ' 되돌리는 중…', true));
      b.items.forEach(function (it) { ul.appendChild(itemStatus(it)); });
      body.appendChild(ul);
      var canUndo = ap.some(function (x) { return x.restorable && x.rs !== 'restored'; });
      foot.appendChild(btn('모두 되돌리기', 'batch|restore', batchRestore, null, !canUndo || b.restoring));
      foot.appendChild(btn('닫기', 'batch|close', batchCancel, 'prim', b.restoring));
    }
    sec.appendChild(body);
    if (foot.firstChild) sec.appendChild(foot);
    return sec;
  }


  // ---- 고침 기록 ----
  var ACT = { applied: '적용', restored: '되돌림', applyFailed: '적용 실패', restoreFailed: '되돌리기 실패' };
  function when(at) {
    var d = new Date(at);
    if (isNaN(d.getTime())) return dash(at);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function loadHistory() {
    if (!api || !api.listHistory) return Promise.resolve();
    var my = ++histSeq;
    return api.listHistory().then(function (res) {
      if (my !== histSeq) return;
      if (res && res.ok && res.data) { hist = res.data.entries || []; histErr = ''; }
      else if (hist == null) histErr = errText(res);
      renderOpt();
    }, function () { if (my === histSeq && hist == null) { histErr = '요청을 처리하지 못했습니다'; renderOpt(); } });
  }
  function onHistRestore(e) {
    pending = true; announce('되돌리는 중'); redraw();
    api.restoreFix(e.findingId).then(function (res) {
      if (res && res.ok) { histErr = ''; announce('되돌림 완료'); }
      else { histErr = '되돌리기 실패: ' + fail1(res); announce(histErr); }
      return done();
    });
  }
  function histPanel() {
    var sec = el('section', 'panel hist');
    sec.setAttribute('aria-label', '고침 기록');
    var ph = el('div', 'ph');
    ph.appendChild(el('h2', null, '고침 기록'));
    if (hist && hist.some(function (e) { return e.restorableAfterRestart; })) ph.appendChild(el('span', 'hint', '재시작 후에도 되돌릴 수 있음'));
    sec.appendChild(ph);
    var body = el('div', 'sc');
    if (histErr && !hist) body.appendChild(el('p', 'cap', '불러오지 못했습니다: ' + histErr));
    else if (hist == null) body.appendChild(el('p', 'cap', '불러오는 중…'));
    else if (!hist.length) body.appendChild(el('p', 'cap', '아직 적용한 고침이 없습니다.'));
    else {
      var ul = el('ul', 'hrows');
      hist.forEach(function (e) {
        var li = el('li', 'hrow');
        li.appendChild(el('span', 'ht', when(e.at)));
        li.appendChild(el('span', 'u', srcName(e.source)));
        li.appendChild(el('span', 'hc', e.checkId));
        li.appendChild(el('span', 'st' + (/Failed$/.test(e.action) ? ' bad' : ''), ACT[e.action] || e.action));
        var bk = el('span', 'hb mono', e.backupName || '');
        bk.title = e.backupName || '';
        li.appendChild(bk);
        if (e.restorable) li.appendChild(btn('되돌리기', 'hist|' + e.findingId + '|' + e.at, function () { onHistRestore(e); }, 'sm', isBusy()));
        ul.appendChild(li);
      });
      body.appendChild(ul);
    }
    if (histErr && hist) body.appendChild(el('p', 'err', histErr));
    sec.appendChild(body);
    return sec;
  }

  // ---- home: health score, updates, settings ----
  function scoreWord(h) {
    if (h == null) return '확인 중';
    return h >= 90 ? '상태 좋음' : h >= 70 ? '확인할 것이 조금 있음' : '정리가 필요함';
  }
  function tone(h) { return h == null ? 'none' : h >= 90 ? 'ok' : h >= 70 ? 'warn' : 'bad'; }
  function updateItems() {
    return (findings || []).filter(function (f) { return f.source === 'updates' || f.id === 'C3:plugins'; });
  }
  // One focal point: the score ring, the verdict, and the single primary action of the tab.
  function hero() {
    var h = status ? status.health : null;
    var c = status && status.counts ? status.counts : { warn: 0, bad: 0 };
    var sec = el('section', 'hero t-' + tone(h));
    sec.setAttribute('aria-label', '상태 요약');
    var ring = el('div', 'ring');
    ring.setAttribute('role', 'img');
    ring.setAttribute('aria-label', h == null ? '건강 점수 없음' : '건강 점수 ' + h + '점, 100점 만점');
    ring.style.setProperty('--p', String(h == null ? 0 : h)); // CSSOM, allowed by the style-src CSP
    ring.appendChild(el('span', 'num', h == null ? '–' : String(h)));
    sec.appendChild(ring);
    var txt = el('div', 'txt');
    txt.appendChild(el('h2', null, scoreWord(h)));
    var nu = updateItems().length;
    var bits = ['문제 ' + c.bad, '주의 ' + c.warn, '업데이트 ' + (prefs && !prefs.updateCheck ? '확인 꺼짐' : nu)];
    if (status && status.generatedAt) bits.push(when(status.generatedAt) + ' 확인');
    txt.appendChild(el('p', 'cap', bits.join(' · ')));
    sec.appendChild(txt);
    var act = el('div', 'act');
    var list = (findings || []).filter(batchable);
    var sel = count(list, isOn);
    var refresh = function () { api.refresh().then(function () { announce('다시 확인하는 중'); }); };
    if (list.length) {
      act.appendChild(btn('지금 최적화 (' + sel + '건)', 'opt|start', batchStart, 'prim', !sel || isBusy()));
      act.appendChild(btn('다시 확인', 'opt|refresh', refresh, 'sm'));
    } else {
      act.appendChild(btn('다시 확인', 'opt|refresh', refresh, 'prim'));
    }
    sec.appendChild(act);
    return sec;
  }
  function updatesPanel() {
    var list = updateItems();
    if (!list.length) return null;
    var sec = el('section', 'panel upd');
    sec.setAttribute('aria-label', '업데이트');
    var ph = el('div', 'ph');
    ph.appendChild(el('h2', null, '업데이트'));
    ph.appendChild(el('span', 'hint', '앱은 직접 실행하지 않습니다. 명령을 골라 복사해 터미널에서 실행하세요.'));
    sec.appendChild(ph);
    var ul = el('ul', 'pitems sc');
    ul.tabIndex = 0; // keyboard can scroll it: it holds no focusable item
    ul.setAttribute('aria-label', '업데이트 목록');
    list.forEach(function (f) {
      var li = el('li', 'urow');
      li.appendChild(el('span', 'what', f.title));
      (f.evidence || []).forEach(function (e) {
        if (e.indexOf('명령: ') === 0) li.appendChild(el('code', 'cmd', e.slice(4)));
        else if (e.indexOf('status:') !== 0) li.appendChild(el('span', 'cap', e));
      });
      ul.appendChild(li);
    });
    sec.appendChild(ul);
    return sec;
  }
  function savePrefs(patch) {
    api.setSettings(patch).then(function (res) {
      if (res && res.ok && res.data) { prefs = res.data; prefsErr = ''; announce('설정 저장됨'); }
      else { prefsErr = '저장 실패: ' + errText(res); announce(prefsErr); }
      renderOpt();
    }, function () { prefsErr = '저장 실패: 요청을 처리하지 못했습니다'; announce(prefsErr); renderOpt(); });
  }
  function prefsPanel() {
    var sec = el('section', 'panel prefs');
    sec.setAttribute('aria-label', '설정');
    var row = el('div', 'prow');
    row.appendChild(el('h2', null, '설정'));
    if (!prefs) { row.appendChild(el('span', 'cap', prefsErr || '불러오는 중…')); sec.appendChild(row); return sec; }
    function toggle(key, label) {
      var lab = el('label', 'pl');
      var c = checkbox(!!prefs[key], 'pref|' + key, label, function (v) { var p = {}; p[key] = v; savePrefs(p); });
      c.disabled = false;
      lab.appendChild(c);
      lab.appendChild(el('span', null, label));
      return lab;
    }
    function time(key, label) {
      var t = el('input', 'tm');
      t.type = 'time';
      t.value = prefs[key] || '';
      t.setAttribute('data-key', 'pref|' + key);
      t.setAttribute('aria-label', label);
      // Chromium fires change on every complete value while typing; save once on leaving the field, and only if it changed
      t.addEventListener('blur', function () { if (t.value !== (prefs[key] || '')) { var p = {}; p[key] = t.value || ''; savePrefs(p); } });
      return t;
    }
    row.appendChild(toggle('notify', '데스크톱 알림'));
    var q = el('fieldset', 'pl');
    q.appendChild(el('legend', null, '조용한 시간'));
    q.appendChild(time('quietStart', '조용한 시간 시작'));
    var dash1 = el('span', null, '–');
    dash1.setAttribute('aria-hidden', 'true');
    q.appendChild(dash1);
    q.appendChild(time('quietEnd', '조용한 시간 끝'));
    row.appendChild(q);
    row.appendChild(toggle('updateCheck', '업데이트 확인'));
    if (prefsErr) row.appendChild(el('span', 'cap bad', prefsErr));
    sec.appendChild(row);
    return sec;
  }
  function loadPrefs() {
    if (!api || !api.getSettings) return;
    api.getSettings().then(function (res) {
      if (res && res.ok && res.data) { prefs = res.data; prefsErr = ''; } else prefsErr = '설정을 읽지 못했습니다: ' + errText(res);
      renderOpt();
    }, function () { prefsErr = '설정을 읽지 못했습니다'; renderOpt(); });
  }

  function renderOpt() {
    var root = $('v-opt');
    var f = focusInfo(root);
    var tops = Array.prototype.map.call(root.querySelectorAll('.sc'), function (n) { return n.scrollTop; });
    root.replaceChildren();
    root.appendChild(hero());
    if (findings && count(findings, batchable)) root.appendChild(optBar());
    var up = updatesPanel();
    if (up) root.appendChild(up);
    if (batch) root.appendChild(batchPanel());
    var panel = el('section', 'panel');
    panel.setAttribute('aria-label', '발견 목록');
    var ph = el('div', 'ph');
    ph.appendChild(el('h2', null, '발견 목록'));
    if (findings) ph.appendChild(el('span', 'hint', '발견 ' + findings.length + '건 · ' + summaryText(findings)));
    panel.appendChild(ph);
    var body = el('div', 'sc');
    panel.appendChild(body);
    if (findings == null) {
      body.appendChild(el('p', 'cap', findingsErr ? '불러오지 못했습니다: ' + findingsErr : '불러오는 중…'));
    } else if (findings.length === 0) {
      body.appendChild(runline('발견 0건 — 지금은 고칠 것이 없습니다.', false));
    } else {
      var ul = el('ul', 'pitems');
      groupItems(findings).forEach(function (g) { ul.appendChild(g); });
      body.appendChild(ul);
    }
    root.appendChild(panel);
    root.appendChild(histPanel());
    root.appendChild(prefsPanel());
    Array.prototype.forEach.call(root.querySelectorAll('.sc'), function (n, i) { n.scrollTop = tops[i] || 0; });
    refocus(root, f);
  }

  function loadFindings() {
    if (!api) return Promise.resolve();
    loadHistory();
    var my = ++seq;
    return api.listFindings().then(function (res) {
      if (my !== seq) return;
      if (res && res.ok && res.data) { findings = res.data.findings || []; findingsErr = ''; }
      else if (findings == null) findingsErr = errText(res);
      redraw();
    });
  }

  function fail(f, res, label) {
    var s = state(f.id);
    s.err = label + ': ' + errText(res);
    s.detail = res && res.error && res.error.detail ? res.error.detail : '';
    announce(s.err);
  }
  function done() { pending = false; return loadFindings(); }

  function onPreview(f) {
    var s = state(f.id);
    if (s.open) { s.open = false; redraw(); return; }
    s.err = ''; s.detail = '';
    // previewed -> previewed is not allowed by the main process, so a cached preview is only re-shown
    if (s.diff != null && f.fixState === 'previewed') { s.open = true; redraw(); return; }
    pending = true; redraw();
    api.previewFix(f.id).then(function (res) {
      if (res && res.ok && res.data) { s.open = true; s.diff = res.data.diff; s.previewId = res.data.previewId; }
      else { s.open = false; fail(f, res, '미리보기 실패'); }
      return done();
    });
  }
  function onApply(f) {
    var s = state(f.id);
    s.err = ''; s.detail = '';
    pending = true; announce('적용 중'); redraw();
    api.applyFix(f.id, s.previewId).then(function (res) {
      if (res && res.ok) { s.open = false; s.diff = null; s.previewId = null; announce('적용됨'); }
      else {
        s.open = false; s.diff = null; s.previewId = null;
        fail(f, res, '적용 실패');
      }
      return done();
    });
  }
  function onRestore(f) {
    var s = state(f.id);
    s.err = ''; s.detail = '';
    pending = true; announce('되돌리는 중'); redraw();
    api.restoreFix(f.id).then(function (res) {
      if (res && res.ok) announce('되돌림 완료');
      else fail(f, res, '되돌리기 실패');
      return done();
    });
  }

  // ---- status ----
  function badge() {
    var n = status && status.counts ? (status.counts.warn || 0) + (status.counts.bad || 0) : 0;
    $('opt-badge').hidden = n <= 0;
    $('opt-count').textContent = String(n);
  }
  function onStatus(s) {
    if (!s || typeof s !== 'object') return;
    var prevBusy = status ? status.busyFindingId : null;
    var homeKey = function (x) { var c = x.counts || {}; return x.health + '|' + c.warn + '|' + c.bad; };
    var prevHome = status ? homeKey(status) : '';
    status = s;
    badge();
    loadFrameUrl();
    var key = s.findingsRev + '|' + s.generatedAt;
    if (key !== cxKey) { cxKey = key; loadCodex(); }
    if (s.findingsRev !== lastRev) { lastRev = s.findingsRev; loadFindings(); }
    else if (prevBusy !== s.busyFindingId) redraw();
    else if (prevHome !== homeKey(s) && !(document.activeElement && document.activeElement.classList.contains('tm'))) renderOpt(); // a finding became stable; never while a time is being typed
    else renderCodex();
    if (tab === 'rt') loadRoutines(false);
  }

  var copyTimer = 0;
  $('copy-sum').addEventListener('click', function () {
    var b = $('copy-sum'), m = $('copy-msg');
    if (!api || !api.copySummary) { m.textContent = '요약 복사를 쓸 수 없습니다'; return; }
    b.disabled = true;
    api.copySummary().then(function (res) {
      var ok = res && res.ok;
      b.textContent = ok ? '복사됨' : '요약 복사';
      m.textContent = ok ? '' : '복사 실패: ' + errText(res);
      announce(ok ? '요약을 복사했습니다' : m.textContent);
    }, function () { m.textContent = '복사 실패: 요청을 처리하지 못했습니다'; announce(m.textContent); }).then(function () {
      b.disabled = false;
      clearTimeout(copyTimer);
      copyTimer = setTimeout(function () { b.textContent = '요약 복사'; m.textContent = ''; }, 2000);
    });
  });

  selectTab();
  renderCodex();
  redraw();
  if (!api) {
    var m = $('frame-msg');
    m.textContent = '앱 연결(window.monitor)이 없습니다.';
    m.hidden = false;
    return;
  }
  api.onStatusChanged(onStatus);
  api.getStatus().then(function (res) {
    if (res && res.ok) { if (!status) onStatus(res.data); }
    else { $('v-codex').replaceChildren(el('p', 'msg', '상태를 읽지 못했습니다: ' + errText(res))); }
  });
  loadFindings();
  loadPrefs();
  loadFrameUrl();
})();
