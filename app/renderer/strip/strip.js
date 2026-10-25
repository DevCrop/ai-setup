(function () {
  'use strict';
  var api = window.monitor;
  var $ = function (id) { return document.getElementById(id); };
  var body = $('body');
  var DEFAULT_TIP = '누르면 열기 · 오른쪽 클릭: 메뉴';

  function f1(x) { return String(Math.round(x * 10) / 10); }
  function fmtOut(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '—';
    if (n >= 1e8) return f1(n / 1e8) + '억';
    if (n >= 1e6) return Math.round(n / 1e4) + '만';
    if (n >= 1e4) return f1(n / 1e4) + '만';
    return Math.round(n).toLocaleString('en-US');
  }
  function fmtTime(iso) {
    var d = iso ? new Date(iso) : null;
    if (!d || isNaN(d.getTime())) return '—';
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : 0; }

  // state -> [dot class, text]
  function stateView(s) {
    switch (s.state) {
      case 'ok': return ['ok', '정상'];
      case 'warn': return ['warn', '확인 필요 ' + num(s.counts && s.counts.warn)];
      case 'bad': return ['bad', '문제 ' + num(s.counts && s.counts.bad)];
      case 'stale': return ['idle', '모니터 멈춤'];
      case 'nodata': return ['idle', '데이터 없음'];
      case 'error': return ['bad', '수집 오류'];
      default: return ['idle', '시작 중'];
    }
  }

  function render(s) {
    var sv = stateView(s);
    $('dot').className = 'dot ' + sv[0];
    $('state').textContent = sv[1];
    var has = !!s.generatedAt;
    var r = s.routing;
    $('route').textContent = has && r && num(r.total) > 0 ? num(r.ok) + '/' + num(r.total) : '—';
    $('out').textContent = has ? fmtOut(s.todayOutput) : '—';
    var l = s.live;
    $('live').textContent = has && l ? '세션 ' + num(l.sessions) + (num(l.agents) > 0 ? ' · 에이전트 ' + num(l.agents) : '') : '—';
    var cs = s.codex && s.codex.state;
    var cc = cs === 'ok' || cs === 'warn' || cs === 'bad' ? cs : 'idle';
    $('cdot').className = 'dot ' + cc;
    $('ctxt').textContent = { ok: '정상', warn: '주의', bad: '문제', idle: '상태 없음' }[cc];
    $('time').textContent = fmtTime(s.generatedAt);
    body.title = DEFAULT_TIP;
  }

  function fail(res) {
    if (res && res.ok === false && res.error) body.title = res.error.message;
  }
  // Every API call resolves with an envelope; this only guards against a missing preload.
  function call(fn) {
    if (!api) return;
    Promise.resolve(fn()).then(fail, function () {});
  }

  if (!api) {
    $('state').textContent = '연결 안 됨';
    $('dot').className = 'dot bad';
    return;
  }

  body.addEventListener('click', function () { call(function () { return api.openMain(); }); });
  document.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    call(function () { return api.showStripMenu(); });
  });

  var pushed = false; // a push that arrives before the first getStatus answer is newer
  api.onStatusChanged(function (s) { if (s && typeof s === 'object') { pushed = true; render(s); } });
  Promise.resolve(api.getStatus()).then(function (res) {
    if (res && res.ok) { if (!pushed) render(res.data); }
    else {
      $('dot').className = 'dot bad';
      $('state').textContent = '상태 읽기 실패';
      fail(res);
    }
  });
})();
