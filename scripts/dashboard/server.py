#!/usr/bin/env python3
"""Local live dashboard for the global Claude setup. Read-only, stdlib only, 127.0.0.1 only.

Run: python3 scripts/dashboard/server.py [--port 8787]
Optional: PROJECT_DIRS or state/projects.txt lists projects; PROJECT_ROOTS or state/project-roots.txt lists parent folders whose sub-folders are all projects; the "프로젝트 셋업" dialog shows file presence, line counts, setting keys and script names.
Reads: git history, gh PR list, scripts/verify.sh --live, reports/*.md, claude/settings.json, the AO daemon (ao status, session ls, review ls; read-only),
and the tool-call names and timestamps of the newest session log in ~/.claude/projects.
It parses the log tail in memory but emits only tool names, times, a file basename, and a command's first word plus a plain subcommand
(never arguments, so a pasted token or `KEY=value` cannot leave the machine). Message text is never emitted.
"""
import hmac, json, os, re, secrets, shutil, sys, time, urllib.request
from dataclasses import dataclass
from typing import Any, Callable
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import inventory
import privacy
import projects as projects_mod
from fsutil import mem_dir, mtime as _mtime, newest_file, read_json as _read_json
from efficiency import AoEfficiency, EfficiencyReport, MemEfficiency, ModelEfficiency, RtkEfficiency, UsageEfficiency
from cache import TtlCache
from fixes import FixRegistry, MemRedactOn, RtkUpdate
from procs import BASH, ProcessRunner

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
CONFIG = Path(os.environ.get("CLAUDE_CONFIG_DIR", Path.home() / ".claude"))
PROJECTS = CONFIG / "projects"
RUNNER = ProcessRunner(ROOT)
CACHE = TtlCache()
spawn, run, cached = RUNNER.spawn, RUNNER.run, CACHE.get  # call sites below keep their short names


def git_history():
    out = run(["git", "log", "-60", "--date=iso-strict", "--pretty=format:%h\x1f%ad\x1f%s\x1f%an"])
    commits = []
    for line in out.splitlines():
        h, ad, s, an = (line.split("\x1f") + ["", "", "", ""])[:4]
        merge = re.match(r"Merge pull request #(\d+) from \S+", s)
        commits.append({"hash": h, "at": ad, "subject": s, "author": an, "pr": int(merge.group(1)) if merge else None})
    return {"commits": commits, "branch": run(["git", "branch", "--show-current"]).strip(),
            "dirty": len([l for l in run(["git", "status", "--short"]).splitlines() if l.strip()])}


def pull_requests():
    out = run(["gh", "pr", "list", "--state", "all", "--limit", "30", "--json", "number,title,state,createdAt,mergedAt,additions,deletions,changedFiles"])
    try:
        return json.loads(out)
    except Exception:
        return []


def verify():
    out = run([BASH, "-l", "scripts/verify.sh", "--live"], timeout=120)
    lines = [re.sub(r"\x1b\[[0-9;]*m", "", l) for l in out.splitlines() if l.strip()]
    counts = {"PASS": 0, "FAIL": 0, "WARN": 0}
    for l in lines:
        k = l.split(" ", 1)[0]
        if k in counts:
            counts[k] += 1
    return {"at": datetime.now(timezone.utc).isoformat(), "counts": counts, "lines": lines[-80:]}


def settings():
    s = _read_json(ROOT / "claude" / "settings.json")
    if s is None:
        return {}
    ls = _read_json(CONFIG / "settings.json")  # None: nothing applied on this machine yet (the UI says so instead of showing SYNCED)
    perm = lambda d: d.get("permissions") if isinstance(d.get("permissions"), dict) else {}
    p, live = perm(s), perm(ls or {})
    keys = ("autoCompactWindow", "promptCacheTtl", "subagentPromptCacheTtl")
    plugins = lambda d: sorted(k for k, v in (d.get("enabledPlugins") or {}).items() if v) if isinstance(d.get("enabledPlugins"), dict) else []
    n = lambda d, k: len(d.get(k) or [])
    ls = ls or {}
    return {"mode": p.get("defaultMode"), "deny": n(p, "deny"), "ask": n(p, "ask"),
            "liveMissing": not ls, "liveMode": live.get("defaultMode"), "liveDeny": n(live, "deny"), "liveAsk": n(live, "ask"),
            "model": s.get("model"), "advisor": s.get("advisorModel"),
            "tune": {k: s.get(k) for k in keys}, "liveTune": {k: ls.get(k) for k in keys},
            "plugins": plugins(s), "livePlugins": plugins(ls)}


def reports():
    d = ROOT / "reports"
    items = []
    if d.is_dir():
        for f in sorted(d.glob("20*.md"), reverse=True)[:7]:
            try:
                items.append({"name": f.name, "mtime": datetime.fromtimestamp(f.stat().st_mtime, timezone.utc).isoformat(),
                              "text": f.read_text(encoding="utf-8", errors="replace")[:4000]})
            except OSError:
                continue
    return items


def ao_bin():
    for c in (os.environ.get("AO_BIN"), str(Path(os.environ.get("LOCALAPPDATA", "")) / "Programs/agent-orchestrator/resources/daemon/ao.exe"), shutil.which("ao")):
        if c and Path(c).exists():
            return c
    return None


def ao_json(binary, args):
    try:
        return json.loads(run([binary, *args], timeout=20))
    except Exception:
        return None


PR_KEYS = ("number", "ci", "state")  # no url: it names the organisation and the repository


def _scalar(v, limit=40):
    """A short plain value or None: a nested object or list that AO adds later must not pass through."""
    return v[:limit] if isinstance(v, str) else v if isinstance(v, (int, bool)) or v is None else None


def ao_state():
    """AO daemon and worker sessions. Read-only calls only (status, session ls, review ls); prompts and review bodies are never emitted."""
    binary = ao_bin()
    if not binary:
        return {"available": False}
    st = ao_json(binary, ["status", "--json"])
    if not st:
        return {"available": True, "daemon": {"state": "down"}, "sessions": []}
    raw = (ao_json(binary, ["session", "ls", "--all", "--include-terminated", "--json"]) or {}).get("data") or []
    sessions = []
    for s in raw:
        row = {k: s.get(k) for k in ("id", "projectId", "role", "displayName", "status", "activity", "branch", "isTerminated", "lastActivityAt", "createdAt")}
        row["prs"] = [{k: _scalar(p.get(k)) for k in PR_KEYS} for p in (s.get("prs") or []) if isinstance(p, dict)]  # nothing else AO puts on a PR leaves the machine
        sessions.append(row)
    sessions.sort(key=lambda s: s.get("lastActivityAt") or "", reverse=True)
    for s in [s for s in sessions if s["prs"]][:10]:
        rv = ao_json(binary, ["review", "ls", s["id"], "--json"]) or {}
        by_pr = {r.get("prNumber"): r for r in rv.get("reviews", [])}
        for p in s["prs"]:
            r = by_pr.get(p.get("number"))
            if r:
                p["reviewStatus"] = _scalar(r.get("status"))
                p["verdict"] = _scalar((r.get("latestRun") or {}).get("verdict") if isinstance(r.get("latestRun"), dict) else None)
    return {"available": True, "daemon": {k: st.get(k) for k in ("state", "uptime", "port", "health", "ready")}, "sessions": sessions[:40],
            "projects": [p.get("id") for p in (ao_json(binary, ["project", "ls", "--json"]) or {}).get("projects", [])]}


SCRIPTS = privacy.repo_scripts(ROOT)


def safe_command(cmd):
    return privacy.safe_command(cmd, SCRIPTS)


def _event(line):
    """The events of one log line (tool name, time and a safe target), or []. Message text and tool arguments are never copied."""
    d = json.loads(line)
    if not isinstance(d, dict):
        return []
    ts, t = d.get("timestamp"), d.get("type")
    msg = d.get("message") if isinstance(d.get("message"), dict) else {}
    c = msg.get("content")
    out = []
    if not ts:
        return out
    if t == "assistant" and isinstance(c, list):
        for x in c:
            if isinstance(x, dict) and x.get("type") == "tool_use":
                inp = x.get("input") if isinstance(x.get("input"), dict) else {}
                target = ""
                if inp.get("file_path"):
                    target = privacy.file_target(inp["file_path"])
                elif inp.get("command"):
                    target = safe_command(str(inp["command"]))
                elif inp.get("pattern"):
                    target = "search"
                out.append({"at": ts, "kind": "tool", "name": str(x.get("name", "?")).split("__")[-1], "target": target})
    elif t == "user" and isinstance(c, str) and not c.startswith("<"):
        out.append({"at": ts, "kind": "user", "name": "user message", "target": ""})
    return out


def session_events(limit=120):
    """Tool-call name, time and a safe target (file basename or command head) from the newest session log."""
    files = list(PROJECTS.glob("*/*.jsonl")) if PROJECTS.is_dir() else []
    if not files:
        return {"session": None, "events": []}
    f = newest_file(files)
    mt = _mtime(f)
    if mt < 0:
        return {"session": None, "events": []}
    try:
        with open(f, "rb") as fh:
            fh.seek(0, 2)
            size = fh.tell()
            fh.seek(max(0, size - 1_500_000))
            raw = fh.read().decode("utf-8", errors="replace").splitlines()
    except Exception:
        return {"session": None, "events": []}
    events = []
    for line in raw:
        try:
            ev = _event(line)
        except Exception:  # one odd line must not make every poll fail
            continue
        if ev:
            events.extend(ev)
    return {"session": f.stem[:8], "mtime": datetime.fromtimestamp(mt, timezone.utc).isoformat(), "events": events[-limit:]}


# ---- projects (the checks themselves live in projects.py; these keep the old names and read the module's paths at call time) ----
is_literal_secret = projects_mod.is_literal_secret
literal_secret_count = projects_mod.literal_secret_count


def project_dirs():
    return projects_mod.project_dirs(ROOT, PROJECTS)


def discover_projects(limit=30):
    return projects_mod.discover_projects(ROOT, PROJECTS, limit)


def project_setup(d):
    return projects_mod.project_setup(d, spawn)


def projects():
    return projects_mod.collect(ROOT, PROJECTS, spawn)


def _age(ms_or_ts, now=None):
    """Seconds since an epoch-millisecond number or an ISO string; None when unknown."""
    try:
        now = now or time.time()
        if isinstance(ms_or_ts, (int, float)):
            return max(0, now - ms_or_ts / 1000)
        return max(0, now - datetime.fromisoformat(str(ms_or_ts).replace("Z", "+00:00")).timestamp())
    except Exception:
        return None


def _span(sec):
    sec = sec if isinstance(sec, (int, float)) else None
    return "?" if sec is None else f"{int(sec // 86400)}일" if sec >= 86400 else f"{int(sec // 3600)}시간" if sec >= 3600 else f"{int(sec // 60)}분"


def mem_health(now=None):
    """claude-mem worker, database, observer and redaction. Numbers and flags only; no observation text."""
    out = []
    mem = mem_dir()
    port = 37777
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=2) as r:
            h = json.load(r)
        ai = (h.get("ai") or {}).get("lastInteraction") or {}
        out.append(("claude-mem", "워커", "ok" if h.get("status") == "ok" and h.get("initialized") else "bad",
                    f"v{str(h.get('version'))[:20]} · 가동 {_span(h.get('uptime'))} · MCP {'준비' if h.get('mcpReady') else '미준비'}"))
        age = _age(ai.get("timestamp"), now)
        out.append(("claude-mem", "마지막 AI 호출", "ok" if ai.get("success") else "warn", f"{_span(age)} 전 · {'성공' if ai.get('success') else '실패'}", "" if ai.get("success") else "`claude auth status` 로 로그인 확인, 필요하면 `claude auth login`"))
    except Exception:
        out.append(("claude-mem", "워커", "bad", "127.0.0.1:37777 응답 없음 (플러그인 비활성 또는 중지)", "Claude Code를 다시 시작한다. 계속 안 되면 `claude plugin list`로 claude-mem@thedotmack 활성 여부 확인 [출처: 미확인, 일반 절차]"))
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/stats", timeout=2) as r:
            d = (json.load(r).get("database") or {})
        out.append(("claude-mem", "DB", "ok", f"관찰 {d.get('observations')}건 · 세션 {d.get('sessions')} · 요약 {d.get('summaries')} · {round((d.get('size') or 0) / 1048576, 1)}MB"))
    except Exception:
        pass
    try:
        o = json.loads((mem / "observer-health.json").read_text(encoding="utf-8"))
        fails = o.get("consecutiveFailures") or 0
        ok_age = _age(o.get("lastSuccessAt"), now)
        err_age = _age(o.get("lastErrorAt"), now)
        recovered = (o.get("lastSuccessAt") or 0) > (o.get("lastErrorAt") or 0)
        lvl = "bad" if fails >= 3 or o.get("quotaCooldown") else "warn" if fails or (o.get("lastErrorAt") and not recovered) else "ok"
        detail = f"연속 실패 {fails} · 마지막 성공 {_span(ok_age)} 전"
        if o.get("lastErrorKind"):
            detail += f" · 마지막 오류 {str(o.get('lastErrorKind'))[:40]} ({_span(err_age)} 전{', 복구됨' if recovered else ''})"
        if o.get("quotaCooldown"):
            detail += " · 쿼터 대기 중"
        fix = str(o.get("lastErrorAction"))[:300] if lvl != "ok" and o.get("lastErrorAction") else ""  # claude-mem's own guidance, verbatim
        out.append(("claude-mem", "관찰자(observer)", lvl, detail, fix or ""))
    except Exception:
        out.append(("claude-mem", "관찰자(observer)", "warn", "observer-health.json 없음"))
    try:
        st = json.loads((mem / "settings.json").read_text(encoding="utf-8"))
        on = str(st.get("CLAUDE_MEM_REDACT_ENABLED", "")).lower() == "true"
        out.append(("claude-mem", "비밀 마스킹(redact)", "ok" if on else "warn", "켜짐" if on else "꺼짐 (CLAUDE_MEM_REDACT_ENABLED)", "" if on else "~/.claude-mem/settings.json 의 CLAUDE_MEM_REDACT_ENABLED 를 \"true\" 로 [출처: docs/review-claude-mem.md]", "" if on else "mem-redact-on"))
    except Exception:
        pass
    return out


def history_health(now=None):
    """Sizes and ages of the prompt history and session logs. Never reads their content."""
    out = []
    try:
        h = CONFIG / "history.jsonl"
        n = sum(1 for _ in open(h, "rb")) if h.is_file() else 0  # counted line by line, never decoded
        age = _age(h.stat().st_mtime * 1000, now) if h.is_file() else None
        out.append(("기록", "프롬프트 기록", "ok" if h.is_file() else "warn", f"{n}줄 · {round(h.stat().st_size / 1024, 1) if h.is_file() else 0}KB · 마지막 기록 {_span(age)} 전"))
    except Exception:
        pass
    try:
        logs = list(PROJECTS.glob("*/*.jsonl")) if PROJECTS.is_dir() else []
        total = sum(f.stat().st_size for f in logs)
        mb = total / 1048576
        out.append(("기록", "세션 로그", "warn" if mb > 500 else "ok", f"{len(logs)}개 · {round(mb, 1)}MB" + (" · 500MB 초과, 정리 검토" if mb > 500 else ""), "Claude Code의 cleanupPeriodDays 설정으로 보관 기간을 줄인다 [출처: 공식 settings 문서, 이번에 재확인 안 함]" if mb > 500 else ""))
    except Exception:
        pass
    return out


def ao_health(ao, now=None):
    """Detail checks over ao_state(): daemon, blocked or stuck workers, finished PRs with no review, stale live sessions."""
    if not ao.get("available"):
        return [("AO", "설치", "na", "ao CLI 없음 (이 PC에는 미설치)")]
    d = ao.get("daemon") or {}
    out = [("AO", "데몬", "ok" if d.get("state") in ("running", "ready") else "bad" if d.get("state") == "down" else "warn",
            f"{d.get('state')} · 포트 {d.get('port')} · 가동 {d.get('uptime')}", "`ao status`로 확인 후 `ao doctor` 실행 [출처: AO 문서 계획서, 미확인]" if d.get("state") == "down" else "")]
    ss = ao.get("sessions") or []
    live = [x for x in ss if not x.get("isTerminated")]
    for key, lvl, label in (("blocked", "bad", "승인 대기(blocked)"), ("stuck", "warn", "멈춤(stuck)")):
        n = [x for x in live if x.get("activity") == key]
        out.append(("AO", label, lvl if n else "ok", f"{len(n)}개" + (": " + ", ".join(str(x.get("id")) for x in n[:3]) if n else ""), "AO 세션을 열어 승인/답변을 직접 입력 (사람만 가능)" if n and key == "blocked" else "AO 세션 상태를 확인하고 필요하면 종료 후 재시작 [미확인]" if n else ""))
    stale = [x for x in live if (_age(x.get("lastActivityAt"), now) or 0) > 6 * 3600]
    out.append(("AO", "6시간 넘게 조용한 세션", "warn" if stale else "ok", f"{len(stale)}개", "끝난 세션이면 종료 처리" if stale else ""))
    noreview = [x for x in ss if any(p.get("number") and not p.get("reviewStatus") for p in (x.get("prs") or []))]
    out.append(("AO", "리뷰 없는 PR", "warn" if noreview else "ok", f"{len(noreview)}개 세션", "`ao review` 로 리뷰어 실행 [미확인]" if noreview else ""))
    out.append(("AO", "세션 합계", "ok", f"실행 {len(live)} · 종료 {len(ss) - len(live)} · 프로젝트 {len(ao.get('projects') or [])}"))
    return out


def tools_version_health():
    """RTK installed vs latest GitHub release. Network failure means 'not checked', never an error."""
    if not shutil.which("rtk"):
        return []
    cur = run(["rtk", "--version"], timeout=10).strip()
    latest = cached("rtk_latest", 3600, RtkUpdate.latest, slow=True)
    a, b = RtkUpdate.parse_version(cur), RtkUpdate.parse_version(latest)
    if not a or not b:
        return [("도구", "RTK 버전", "ok", f"{cur or '?'} · 최신 버전 확인 못 함")]
    if a >= b:
        return [("도구", "RTK 버전", "ok", f"{cur} (최신)")]
    fixable = RtkUpdate.installer() is not None
    return [("도구", "RTK 버전", "warn", f"{cur} → 최신 {latest}", "업데이트: " + " ".join(RtkUpdate.installer() or ["수동 설치"]) + " [출처: 설치 방식(winget) 확인함, 릴리스 노트는 안 읽음]", "rtk-update" if fixable else "")]


def tools_health():
    ao = SOURCES["ao"].read({"available": bool(ao_bin()), "daemon": {"state": "loading"}, "sessions": []})
    items = []
    for name, fn in (("claude-mem", mem_health), ("기록", history_health), ("AO", lambda: ao_health(ao)), ("도구", tools_version_health)):
        try:
            items += fn()
        except Exception:  # one failing source must not take /api/state down
            items.append((name, "점검 실행", "warn", "이 항목을 읽는 중 오류가 났습니다"))
    return [{"group": i[0], "name": i[1], "level": i[2], "detail": i[3], "fix": str(i[4])[:300] if len(i) > 4 else "", "fixId": i[5] if len(i) > 5 else ""} for i in items]


TOKEN = secrets.token_urlsafe(24)  # per start; a foreign page cannot read it (no CORS headers), so it cannot call /api/fix
FIXLOG = ROOT / "state" / "fix-log.jsonl"
FIXES = FixRegistry()  # only fixes registered here can ever run
FIXES.register(MemRedactOn())
RTK = FIXES.register(RtkUpdate(RUNNER, CACHE))


def fix_log_write(fid, targets, res):
    try:
        FIXLOG.parent.mkdir(exist_ok=True)
        with open(FIXLOG, "a", encoding="utf-8") as fh:
            fh.write(json.dumps({"at": datetime.now(timezone.utc).isoformat(), "id": fid, "targets": targets, "ok": res.get("ok"), "msg": res.get("msg")}, ensure_ascii=False) + "\n")
    except OSError:
        pass


def fix_log(limit=100):
    try:
        lines = FIXLOG.read_text(encoding="utf-8").splitlines()[-limit:]
        return [json.loads(l) for l in lines][::-1]
    except (OSError, ValueError):
        return []


_KEEP = object()  # Source.read(): "use the source's own placeholder"


@dataclass(frozen=True)
class Source:
    """One /api/state section. To add a section: write a function that returns it and append a Source below."""
    key: str
    ttl: float
    fn: Callable
    slow: bool = False
    placeholder: Any = None  # a value, or a function returning one (read on every call)

    def read(self, placeholder=_KEEP):
        """The cached value. A caller that needs a different "still loading" value than the state view passes its own."""
        ph = self.placeholder if placeholder is _KEEP else placeholder
        ph = ph() if callable(ph) else ph
        return CACHE.get(self.key, self.ttl, self.fn, self.slow, ph)


def _now():
    return datetime.now(timezone.utc).isoformat()


STATE_SOURCES = (
    Source("git", 5, git_history),
    Source("tools", 10, tools_health),
    Source("prs", 60, pull_requests, slow=True, placeholder=[]),
    Source("verify", 60, verify, slow=True, placeholder=lambda: {"at": _now(), "counts": {"PASS": 0, "FAIL": 0, "WARN": 0}, "lines": ["검증 실행 중..."]}),
    Source("settings", 5, settings),
    Source("reports", 30, reports),
    Source("ao", 8, ao_state, slow=True, placeholder={"available": True, "daemon": {"state": "loading"}, "sessions": []}),
    Source("projects", 10, projects),
)


SOURCES = {s.key: s for s in STATE_SOURCES}  # one definition (ttl, slow, function) per source, read by key anywhere


def state():
    return {"now": _now(), "fixlog": fix_log(), "token": TOKEN, "activity": session_events(), **{s.key: s.read() for s in STATE_SOURCES}}


def newest_session():
    files = list(PROJECTS.glob("*/*.jsonl")) if PROJECTS.is_dir() else []
    return newest_file(files)


MEM_DIR = mem_dir()
EFFICIENCY = EfficiencyReport(  # add a tool by adding a source here
    RtkEfficiency(RUNNER),
    MemEfficiency(MEM_DIR),
    AoEfficiency(lambda: SOURCES["ao"].read({})),
    ModelEfficiency(lambda: inventory.agents(ROOT)),
    UsageEfficiency(PROJECTS, lambda: inventory.agents(ROOT)),
)


# /api/inventory sections. Each takes the shared inputs {"verify", "ao"} and returns its part; add a section by adding a line.
INVENTORY = {
    "orchestration": lambda c: inventory.orchestration(ROOT),
    "routing": lambda c: inventory.routing(ROOT, c["ao"].get("projects", [])),
    "features": lambda c: inventory.features(ROOT),
    "practices": lambda c: inventory.practices(ROOT, CONFIG, c["verify"].get("counts")),
    "debug": lambda c: inventory.debug(newest_session()),
    "agents": lambda c: inventory.agents(ROOT),
    "efficiency": lambda c: cached("efficiency", 120, EFFICIENCY.collect),
}


def inv():
    c = {"verify": SOURCES["verify"].read({"counts": {}}), "ao": SOURCES["ao"].read({"projects": []})}
    return {name: build(c) for name, build in INVENTORY.items()}


def _json(obj, **kw):
    return json.dumps(obj, **kw).encode(), "application/json"


# GET routes: (matches(path), body()) -> (bytes, content type). First match wins; no match is a 404.
GET_ROUTES = (
    (lambda p: p.startswith("/api/state"), lambda: _json(state())),
    (lambda p: p.startswith("/api/inventory"), lambda: _json(cached("inv", 15, inv))),
    (lambda p: p in ("/", "/index.html"), lambda: ((HERE / "index.html").read_bytes(), "text/html; charset=utf-8")),
)


UI_DIR = HERE / "ui"
UI_TYPES = {".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8"}


UI_PATH = re.compile(r"^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*(?:/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)*$")


def ui_asset(path):
    """(body, content-type) for /ui/<file>.js|.css, else None. The name must match a strict pattern (no leading slash, backslash, colon or '..' segment)
    before any filesystem call, so a UNC-style path like /ui///host/share/x.js never reaches Path.resolve() and cannot trigger a network lookup."""
    p = path.split("?", 1)[0]
    if not p.startswith("/ui/"):
        return None
    rel = p[4:]
    if not UI_PATH.match(rel) or ".." in rel.split("/"):
        return None
    target = (UI_DIR / rel).resolve()
    if UI_DIR.resolve() not in target.parents or target.suffix not in UI_TYPES or not target.is_file():
        return None
    return target.read_bytes(), UI_TYPES[target.suffix]


def token_ok(value):
    """Constant-time compare on bytes: a non-ASCII header value is a wrong token, not a TypeError."""
    return hmac.compare_digest(value.encode("utf-8", "replace"), TOKEN.encode())


def local_host(value):
    return value.split(":")[0] in ("127.0.0.1", "localhost")


class H(BaseHTTPRequestHandler):
    def _send(self, body, ctype):
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _guarded(self, handler):
        try:
            handler()
        except Exception as e:  # a bug in one source must answer 500, not drop the socket with a traceback
            try:
                body = json.dumps({"ok": False, "msg": type(e).__name__}).encode()
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)
            except Exception:
                pass

    def do_GET(self):
        self._guarded(self._get)

    def do_POST(self):
        self._guarded(self._post)

    def _get(self):
        # Refuse foreign Host headers (DNS rebinding against a local server).
        if not local_host(self.headers.get("Host", "")):
            self.send_error(403)
            return
        asset = ui_asset(self.path)
        if asset:
            self._send(*asset)
            return
        for matches, body in GET_ROUTES:
            if matches(self.path):
                self._send(*body())
                return
        self.send_error(404)

    def _post(self):
        origin = self.headers.get("Origin", "")
        if not (local_host(self.headers.get("Host", "")) and (origin == "" or local_host(origin.split("://", 1)[-1])) and self.path == "/api/fix"
                and self.headers.get("Content-Type", "").startswith("application/json") and token_ok(self.headers.get("X-Dash-Token", ""))):
            self.send_error(403)
            return
        try:
            req = json.loads(self.rfile.read(min(int(self.headers.get("Content-Length", 0)), 20000)) or b"{}")
            fid = str(req.get("id", ""))
            if req.get("action") == "apply":
                targets = [str(t) for t in req.get("targets", [])]
                res = FIXES.apply(fid, targets)
                fix_log_write(fid, targets, res)
                CACHE.drop("tools")
            else:
                pv = FIXES.preview(fid)
                res = {"ok": bool(pv), **(pv or {"msg": "알 수 없는 조치"})}
        except Exception as e:
            res = {"ok": False, "msg": "요청 오류: " + type(e).__name__}
        self._send(*_json(res, ensure_ascii=False))

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    port = int(sys.argv[sys.argv.index("--port") + 1]) if "--port" in sys.argv else 8787
    print(f"dashboard on http://127.0.0.1:{port}")
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
