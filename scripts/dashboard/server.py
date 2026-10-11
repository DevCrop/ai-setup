#!/usr/bin/env python3
"""Local live dashboard for the global Claude setup. Read-only, stdlib only, 127.0.0.1 only.

Run: python3 scripts/dashboard/server.py [--port 8787]
Optional: PROJECT_DIRS or state/projects.txt lists project roots; the "프로젝트 셋업" dialog shows file presence, line counts, setting keys and script names.
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
from efficiency import AoEfficiency, EfficiencyReport, MemEfficiency, ModelEfficiency, RtkEfficiency
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


def _read_json(path):
    """A JSON object from a file, or None when the file is missing, unreadable or not an object."""
    try:
        d = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return d if isinstance(d, dict) else None


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


PR_KEYS = ("number", "url", "ci", "state")


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
        row["prs"] = [{k: p.get(k) for k in PR_KEYS} for p in (s.get("prs") or []) if isinstance(p, dict)]  # nothing else AO puts on a PR leaves the machine
        sessions.append(row)
    sessions.sort(key=lambda s: s.get("lastActivityAt") or "", reverse=True)
    for s in [s for s in sessions if s["prs"]][:10]:
        rv = ao_json(binary, ["review", "ls", s["id"], "--json"]) or {}
        by_pr = {r.get("prNumber"): r for r in rv.get("reviews", [])}
        for p in s["prs"]:
            r = by_pr.get(p.get("number"))
            if r:
                p["reviewStatus"] = r.get("status")
                p["verdict"] = (r.get("latestRun") or {}).get("verdict")
    return {"available": True, "daemon": {k: st.get(k) for k in ("state", "uptime", "port", "health", "ready")}, "sessions": sessions[:40],
            "projects": [p.get("id") for p in (ao_json(binary, ["project", "ls", "--json"]) or {}).get("projects", [])]}


SUBCOMMAND_HEADS = ("git", "gh", "bash", "python3", "python", "npm", "npx", "rtk", "winget")
TOKEN_SHAPE = re.compile(r"^(gh[pousr]_|github_pat_|sk-|xox[a-z]-|AKIA|AIza|eyJ)", re.I)


def safe_command(cmd):
    """First word, plus the second only when it is a short plain subcommand or a script's base name: never a path, a flag, a value with '='
    or anything shaped like a token."""
    w = cmd.split()
    while w and re.match(r"[A-Za-z_][A-Za-z0-9_]*=", w[0]):  # leading NAME=value assignments never leave the machine
        w = w[1:]
    if not w:
        return ""
    head = os.path.basename(w[0])[:20]
    if not re.fullmatch(r"[A-Za-z0-9_.+-]+", head):  # a quote, a redirect or an expansion in the first word: say nothing about it
        return ""
    if len(w) > 1 and head in SUBCOMMAND_HEADS and re.fullmatch(r"[A-Za-z0-9_./-]{1,40}", w[1]) and not w[1].startswith("-") and not TOKEN_SHAPE.match(w[1]):
        sub = os.path.basename(w[1].rstrip("/"))
        if 0 < len(sub) <= 24:
            return head + " " + sub
    return head


def _mtime(p):
    try:
        return p.stat().st_mtime
    except OSError:  # Claude Code rotated or deleted the file between the glob and now
        return -1.0


def newest_file(files):
    return max(files, key=_mtime) if files else None


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
            d = json.loads(line)
        except Exception:
            continue
        if not isinstance(d, dict):
            continue
        ts = d.get("timestamp")
        if not ts:
            continue
        t = d.get("type")
        c = (d.get("message") or {}).get("content")
        if t == "assistant" and isinstance(c, list):
            for x in c:
                if isinstance(x, dict) and x.get("type") == "tool_use":
                    inp = x.get("input") or {}
                    target = ""
                    if inp.get("file_path"):
                        target = os.path.basename(str(inp["file_path"]))
                    elif inp.get("command"):
                        target = safe_command(str(inp["command"]))
                    elif inp.get("pattern"):
                        target = "search"
                    events.append({"at": ts, "kind": "tool", "name": str(x.get("name", "?")).split("__")[-1], "target": target})
        elif t == "user" and isinstance(c, str) and not c.startswith("<"):
            events.append({"at": ts, "kind": "user", "name": "user message", "target": ""})
    return {"session": f.stem[:8], "mtime": datetime.fromtimestamp(mt, timezone.utc).isoformat(), "events": events[-limit:]}


SECRET_KEY = re.compile(r"authorization|token|secret|password|apikey|accesskey|privatekey|credential", re.I)
SECRET_VALUE = re.compile(r"Bearer\s+\S{16,}|sk-\S{16,}|gh[pousr]_\S+|github_pat_\S+|xox\S-\S+|AKIA[0-9A-Z]{12,}|AIza\S{20,}|eyJ[A-Za-z0-9_-]{20,}")


def is_literal_secret(key, value):
    """A header or env value written into a file instead of a ${VAR} reference, under a secret-looking name or shaped like a known token."""
    if not isinstance(value, str) or "${" in value or value.startswith("$") or len(value) < 12 or value.isdigit():
        return False
    name = str(key)
    return bool(SECRET_KEY.search(re.sub(r"[-_\s]", "", name)) or re.search(r"(^|[-_])key$", name, re.I) or SECRET_VALUE.search(value))


def literal_secret_count(servers):
    n = 0
    for srv in (servers.values() if isinstance(servers, dict) else []):
        for part in ((srv.get("headers") if isinstance(srv, dict) else None) or {}), ((srv.get("env") if isinstance(srv, dict) else None) or {}):
            n += sum(1 for k, v in (part.items() if isinstance(part, dict) else []) if is_literal_secret(k, v))
    return n


def project_dirs():
    """Project roots to inspect: PROJECT_DIRS (path-separated) or state/projects.txt, one path per line."""
    raw = os.environ.get("PROJECT_DIRS", "")
    paths = [p for p in raw.split(os.pathsep) if p.strip()]
    f = ROOT / "state" / "projects.txt"
    if not paths and f.is_file():
        paths = [l.strip() for l in f.read_text(encoding="utf-8", errors="replace").splitlines() if l.strip() and not l.startswith("#")]
    return [Path(p).expanduser() for p in paths] or discover_projects()


def discover_projects(limit=30):
    """No list given: take the working folders Claude Code recorded in its session logs, plus sibling folders that look like projects."""
    skip = re.compile(r"appdata|[\\/]temp[\\/]|scratchpad|worktree|[\\/]\.claude|[\\/]ao[\\/]", re.I)
    cwds = []
    try:
        logdirs = list(PROJECTS.iterdir()) if PROJECTS.is_dir() else []
    except OSError:
        logdirs = []
    for d in logdirs:
        try:
            log = newest_file(list(d.glob("*.jsonl")))
            if log is None:
                continue
            with open(log, encoding="utf-8", errors="replace") as fh:
                m = re.search(r'"cwd":"((?:[^"\\]|\\.)*)"', fh.read(65536))
            c = json.loads('"' + m.group(1) + '"') if m else ""
            if c and not skip.search(c) and Path(c).is_dir():
                cwds.append(Path(c))
        except (OSError, ValueError):  # a folder with no log or an odd line must not hide the others
            pass
    found = {str(c): c for c in cwds}
    marks = (".git", "CLAUDE.md", "AGENTS.md", ".claude")
    rf = ROOT / "state" / "project-roots.txt"  # per-machine folders that hold projects, one path per line (or PROJECT_ROOTS)
    try:
        lines = os.environ["PROJECT_ROOTS"].split(os.pathsep) if "PROJECT_ROOTS" in os.environ else rf.read_text(encoding="utf-8", errors="replace").splitlines() if rf.is_file() else []
    except OSError:
        lines = []
    roots = [Path(l.strip()) for l in lines if l.strip() and not l.startswith("#")]
    for parent in {c.parent for c in cwds if c.parent != c.parent.parent} | {r for r in roots if r != r.parent}:  # one level only, never a drive root
        try:
            for sub in parent.iterdir():
                if sub.is_dir() and not sub.name.startswith(".") and (parent in roots or any((sub / m).exists() for m in marks)):  # a declared root lists every folder
                    found.setdefault(str(sub), sub)
        except OSError:
            pass
    first = {str(c) for c in cwds}  # session-log folders survive the cap; sibling scans fill the rest
    return sorted(found.values(), key=lambda x: (str(x) not in first, str(x).lower()))[:limit]


def project_setup(d):
    """Setup facts of one project as booleans and counts. File contents never leave this function."""
    def lines(p):
        try:
            return p.read_text(encoding="utf-8", errors="replace").splitlines()
        except Exception:
            return []
    agents = d / "AGENTS.md"
    claude = d / "CLAUDE.md" if (d / "CLAUDE.md").is_file() else d / ".claude" / "CLAUDE.md"  # both are project files (memory doc)
    cl = lines(claude)
    fence, imports = False, False
    for l in cl:  # an @import counts anywhere outside a code fence
        if l.lstrip().startswith("```"):
            fence = not fence
        elif not fence and re.search(r"(?<![\w])@(\./|\.\./)?AGENTS\.md(?![\w.])", re.sub(r"`[^`]*`", "", l)):
            imports = True
    try:
        cfg = json.loads((d / ".claude" / "settings.json").read_text(encoding="utf-8"))
    except Exception:
        cfg = None
    perm = cfg.get("permissions") if isinstance(cfg, dict) else None
    perm = perm if isinstance(perm, dict) else {}
    deny = [r for r in perm.get("deny", []) if isinstance(r, str)] if isinstance(perm.get("deny"), list) else []
    gi = "\n".join(lines(d / ".gitignore"))
    rules = list((d / ".claude" / "rules").rglob("*.md")) if (d / ".claude" / "rules").is_dir() else []
    al = lines(agents)
    f = {"name": d.name, "found": d.is_dir(),
         "agents": agents.is_file(), "agentsLines": len(al),
         "claude": claude.is_file(), "claudeLines": len(cl), "imports": imports,
         "settings": cfg is not None, "denyEnv": any(re.search(r"Read\(.*\.env", r) for r in deny),
         "defaultMode": perm.get("defaultMode") == "bypassPermissions", "rules": len(rules),
         "gitignore": "CLAUDE.local.md" in gi and "settings.local.json" in gi}
    if d.is_dir():
        f["checks"] = practice_checks(d, f, al, cl, perm, rules, "\n".join(al + cl).lower(), cfg)
    return f


def git_tracked(d, *pats):
    try:
        p = spawn(["git", "ls-files", "--", *pats], timeout=10, cwd=d)
        return [l for l in p.stdout.splitlines() if l.strip()] if p.returncode == 0 else []
    except Exception:
        return []


def practice_checks(d, f, al, cl, perm, rules, text, cfg=None):
    """Best-practice gaps as {act: add|fix|remove, level, what, why, fix, src}. Rules come from the Claude Code docs pages
    memory, best-practices and permissions (read 2026-10-10). Only the finding text leaves this function, never file content."""
    out = []

    def add(act, level, what, why, fix, src):
        out.append({"act": act, "level": level, "what": what, "why": why, "fix": fix, "src": src})
    local = (d / "CLAUDE.local.md").is_file()
    if not (f["agents"] or f["claude"]):
        add("add", "warn", "지침 파일 없음", "Claude는 매 세션 CLAUDE.md(또는 AGENTS.md)를 읽습니다. 없으면 빌드·테스트 명령과 프로젝트 규칙을 매번 추측합니다.", "AGENTS.md 또는 CLAUDE.md를 추가: 검증 명령, 기본값과 다른 스타일 규칙, 함정만 (/project-setup).", "memory")
    if f["agents"] and f["claude"] and not f["imports"]:
        # A thin CLAUDE.md that names AGENTS.md (a shared book both tools read) may be deliberate: report it, but not as a defect.
        thin = "agents.md" in "\n".join(cl).lower() and f["claudeLines"] < 120
        add("fix", "info" if thin else "bad", "CLAUDE.md가 @AGENTS.md를 가져오지 않음" + (" (얇은 진입점이 AGENTS.md를 언급함)" if thin else ""), "AGENTS.md와 CLAUDE.md가 둘 다 있으면 Claude는 CLAUDE.md만 읽습니다. AGENTS.md의 규칙은 import하거나 CLAUDE.md가 가리키는 문서에 있어야 Claude에게 전달됩니다.", ("의도한 구조(공유 문서로 안내)라면 그대로 두고, 아니면 " if thin else "") + "CLAUDE.md 첫 줄을 @AGENTS.md로 하고 Claude 전용 내용만 그 아래에 둡니다.", "memory")
    if f["agents"] and not f["claude"] and local:
        add("fix", "warn", "CLAUDE.local.md 때문에 AGENTS.md가 읽히지 않을 수 있음", "AGENTS.md는 CLAUDE.md와 CLAUDE.local.md가 모두 없을 때만 단독으로 로드됩니다.", "프로젝트 CLAUDE.md(첫 줄 @AGENTS.md)를 만들거나 CLAUDE.local.md 첫 줄에 @AGENTS.md를 넣습니다.", "memory")
    norm = lambda ls: [l.strip() for l in ls if l.strip()]
    if f["agents"] and f["claude"] and not f["imports"] and norm(al) == norm(cl):
        add("remove", "warn", "CLAUDE.md가 AGENTS.md의 복사본", "같은 내용이 두 곳에 있으면 한쪽만 고쳐져 어긋납니다.", "CLAUDE.md를 @AGENTS.md 한 줄(+Claude 전용 몇 줄)로 줄입니다.", "memory")
    if f["claudeLines"] > 200:
        add("fix", "warn", "CLAUDE.md %d줄 (권장 200 이하)" % f["claudeLines"], "길수록 컨텍스트를 더 쓰고 지침이 묻혀 따르는 비율이 떨어집니다.", "영역별 규칙은 .claude/rules/<영역>.md(paths:)로 옮기고, 코드에서 알 수 있는 내용은 지웁니다 (/doctor가 제안).", "memory")
    if f["agentsLines"] > 200 and not f["claude"]:
        add("fix", "warn", "AGENTS.md %d줄 (Claude가 전부 로드)" % f["agentsLines"], "Claude는 AGENTS.md를 통째로 읽습니다. 200줄을 넘으면 같은 이유로 지침이 묻힙니다.", "Codex와 공유하는 정본이라 사용자가 판단: 영역 규칙을 .claude/rules/로 옮기거나 AGENTS.md를 줄입니다.", "memory")
    ph = sum(l.count("[REPLACE:") for l in al + cl)
    if ph:
        add("fix", "warn", "템플릿 자리표시자 [REPLACE:] %d개 남음" % ph, "채워지지 않은 자리표시자는 Claude에게 잘못된 지침이 됩니다.", "실제 값으로 채우거나 해당 줄을 지웁니다.", "best-practices")
    if not f["settings"]:
        add("add", "warn", ".claude/settings.json 없음", "팀원과 클라우드 세션은 ~/.claude를 읽지 않습니다. 프로젝트 쪽 deny가 없으면 .env 보호가 개인 설정에만 의존합니다.", "permissions.deny에 Read(**/.env*), Read(**/.credentials*)를 추가합니다.", "permissions")
    else:
        if not f["denyEnv"]:
            add("add", "bad", "deny에 .env 읽기 차단이 없음", "deny는 모든 모드에서 적용되는 보호 규칙입니다.", "permissions.deny에 Read(**/.env*)를 추가합니다.", "permissions")
        if f["defaultMode"]:
            add("remove", "bad", "프로젝트 settings에 bypassPermissions", "권한 확인을 끄는 모드를 프로젝트 파일로 팀 전체에 강제하는 것은 위험합니다. 이 모드는 사용자가 정할 일입니다.", "defaultMode 줄을 지웁니다.", "permissions")
        allow = perm.get("allow") if isinstance(perm.get("allow"), list) else []
        risky = [a for a in allow if isinstance(a, str) and re.match(r"Bash\((rm|sudo|git push|npm publish|npm install|npm ci|composer install)[ :)]", a)]
        if risky:
            add("fix", "info", "allow에 삭제·설치·배포 명령 %d개" % len(risky), "문서의 allow 예시는 npm run test, git commit 같은 일상 명령입니다. 삭제·설치·push는 매번 확인하는 편이 안전합니다(판단 사항).", "팀이 정말 필요한 것만 남기고 나머지 allow를 지웁니다.", "permissions")
    if not f["gitignore"]:
        has = (d / "CLAUDE.local.md").is_file() or (d / ".claude" / "settings.local.json").is_file()
        add("add", "warn" if has else "info", ".gitignore에 로컬 파일 줄 누락", "CLAUDE.local.md와 settings.local.json은 개인용입니다. 커밋되면 개인 설정이 팀에 퍼집니다.", ".gitignore에 CLAUDE.local.md, .claude/settings.local.json을 추가합니다.", "memory")
    env = [t for t in git_tracked(d, ".env", ".env.*", "**/.env", "**/.env.*") if not re.search(r"\.(example|sample|template|dist)$", t)]
    if env:
        add("remove", "bad", "git에 .env 파일 %d개 추적 중" % len(env), "커밋된 비밀은 히스토리에 남습니다.", "git rm --cached 후 .gitignore에 추가하고, 노출된 값은 폐기합니다.", "permissions")
    if git_tracked(d, "CLAUDE.local.md", ".claude/settings.local.json"):
        add("remove", "warn", "개인용 로컬 파일이 git에 추적됨", "로컬 파일은 개인 설정입니다.", "git rm --cached 후 .gitignore에 추가합니다.", "memory")
    names = []
    for fn in ("package.json", "composer.json"):
        try:
            names += list((json.loads((d / fn).read_text(encoding="utf-8")).get("scripts") or {}).keys())
        except Exception:
            pass
    for mk in ("Makefile", "makefile"):
        if (d / mk).is_file():
            names += re.findall(r"^([A-Za-z0-9_.-]+):", (d / mk).read_text(encoding="utf-8", errors="replace"), re.M)
    checks = [c for c in names if re.search(r"(test|lint|typecheck|check|phpunit|stylelint|phpcs)", c, re.I)]
    ci = (d / ".github" / "workflows").is_dir()
    tool = any((d / n).is_file() for n in ("pyproject.toml", "pytest.ini", "tox.ini", "go.mod", "Cargo.toml"))  # built-in test runners
    f["verify"] = len(checks) + (1 if ci else 0) + (1 if tool else 0)
    if not checks and not ci and not tool:
        add("add", "warn", "검증 명령을 찾지 못함", "Claude가 실행할 수 있는 검사가 없으면 '끝났다'는 Claude의 판단뿐이고 사용자가 검증 루프가 됩니다.", "테스트·lint·타입체크 중 하나를 스크립트로 만들고(마크업은 스크린샷 비교나 lint) 지침에 적습니다.", "best-practices")
    elif checks and (f["agents"] or f["claude"]) and not any(re.search(r"(?<![a-z0-9])" + re.escape(c.lower()) + r"(?![a-z0-9])", text) for c in checks):
        add("add", "warn", "검증 명령이 지침에 적혀 있지 않음", "Claude는 어떤 명령이 이 프로젝트의 검사인지 추측해야 합니다.", "지침에 실제 명령 한 줄을 적습니다. 후보: " + ", ".join(checks[:3]), "best-practices")
    if (f["agents"] or f["claude"]) and any((d / n).is_file() for n in ("docker-compose.yml", "docker-compose.yaml", "compose.yaml")) and not re.search(r"docker|container|컨테이너|make up", text):
        add("add", "info", "명령이 컨테이너/호스트 어디서 도는지 안 적혀 있음", "Claude는 환경 특이점을 코드에서 알 수 없습니다. 잘못된 곳에서 실행하면 실패합니다.", "지침에 한 줄: 검증 명령을 컨테이너에서 실행하는지, 호스트에서 실행하는지.", "best-practices")
    cfg = cfg if isinstance(cfg, dict) else {}
    # rtk twins: this machine's global setup evaluates permission rules on the rtk-rewritten command (claude-global CLAUDE.md)
    if shutil.which("rtk"):
        miss = {}
        for kind in ("deny", "ask", "allow"):
            rs = [r for r in (perm.get(kind) if isinstance(perm.get(kind), list) else []) if isinstance(r, str) and r.startswith("Bash(")]
            have = set(rs)
            n = sum(1 for r in rs if not r.startswith("Bash(rtk ") and "Bash(rtk " + r[5:] not in have)
            if n:
                miss[kind] = n
        if miss:
            add("add", "bad" if "deny" in miss else "warn", "rtk 쌍이 없는 Bash 규칙 (" + ", ".join("%s %d개" % kv for kv in miss.items()) + ")", "RTK가 git ...을 rtk git ...으로 바꾼 뒤 권한 규칙을 평가합니다. 쌍이 없으면 deny가 우회되고 allow가 적용되지 않습니다.", "각 Bash 규칙에 'Bash(rtk ...)' 쌍을 추가합니다 (/project-setup 7단계).", "claude-global")
    mcp = d / ".mcp.json"
    if mcp.is_file():
        try:
            servers = (json.loads(mcp.read_text(encoding="utf-8")) or {}).get("mcpServers") or {}
        except Exception:
            servers = None
        if servers is None:
            add("fix", "warn", ".mcp.json을 읽을 수 없음(JSON 오류)", "형식이 틀리면 팀 전체가 MCP 서버를 못 씁니다.", "JSON 문법을 고칩니다.", "mcp")
        else:
            lit = literal_secret_count(servers)
            if lit and git_tracked(d, ".mcp.json"):
                add("fix", "bad", ".mcp.json(git 추적)에 토큰이 값으로 적혀 있음 (%d개)" % lit, "문서는 ${VAR} 환경변수 확장으로 비밀을 파일 밖에 두도록 안내합니다. 커밋된 토큰은 히스토리에 남습니다.", "값을 ${API_KEY} 형태로 바꾸고 노출된 토큰은 폐기합니다.", "mcp")
    sk = []
    for p in sorted((d / ".claude" / "skills").glob("*/SKILL.md")) if (d / ".claude" / "skills").is_dir() else []:
        try:
            t = p.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        if len(t.splitlines()) > 500:
            sk.append("길이")
        if not re.match(r"---\s*\n(?:.*\n)*?description:", t):
            sk.append("description")
    if sk:
        add("fix", "warn", "skills 문제 (500줄 초과 %d, description 없음 %d)" % (sk.count("길이"), sk.count("description")), "SKILL.md는 500줄 이하를 권장하고, description이 있어야 Claude가 언제 쓸지 판단합니다.", "긴 참고 자료는 별도 파일로 옮기고 frontmatter에 description을 씁니다.", "skills")
    hk = cfg.get("hooks") if isinstance(cfg.get("hooks"), dict) else {}
    gone = 0
    for groups in hk.values():
        for g in (groups if isinstance(groups, list) else []):
            for h in ((g.get("hooks") if isinstance(g, dict) else None) or []):
                cmd = str(h.get("command", "")) if isinstance(h, dict) else ""
                m = re.search(r"\"\$\{?CLAUDE_PROJECT_DIR\}?/([^\"]+)\"", cmd) or re.search(r"\$\{?CLAUDE_PROJECT_DIR\}?\"?/([\w./-]+)", cmd)  # quoted path may hold spaces
                if m and ".." not in m.group(1) and not (d / m.group(1)).exists():
                    gone += 1
    if gone:
        add("fix", "bad", "hook이 가리키는 프로젝트 스크립트가 없음 (%d개)" % gone, "없는 스크립트를 실행하는 hook은 매번 실패합니다.", "경로를 고치거나 hook을 지웁니다 (/hooks로 확인).", "hooks")
    return out


def projects():
    out = []
    for d in project_dirs():
        try:
            out.append(project_setup(d))
        except Exception:  # one unreadable project must not take the whole dashboard down
            out.append({"name": d.name, "found": True, "error": True})
    return out


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
    mem = Path(os.environ.get("CLAUDE_MEM_DIR", Path.home() / ".claude-mem"))
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
    ao = cached("ao", 8, ao_state, slow=True, placeholder={"available": bool(ao_bin()), "daemon": {"state": "loading"}, "sessions": []})
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


@dataclass(frozen=True)
class Source:
    """One /api/state section. To add a section: write a function that returns it and append a Source below."""
    key: str
    ttl: float
    fn: Callable
    slow: bool = False
    placeholder: Any = None  # a value, or a function returning one (read on every call)

    def read(self):
        ph = self.placeholder() if callable(self.placeholder) else self.placeholder
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


def state():
    return {"now": _now(), "fixlog": fix_log(), "token": TOKEN, "activity": session_events(), **{s.key: s.read() for s in STATE_SOURCES}}


def newest_session():
    files = list(PROJECTS.glob("*/*.jsonl")) if PROJECTS.is_dir() else []
    return newest_file(files)


MEM_DIR = Path(os.environ.get("CLAUDE_MEM_DIR", Path.home() / ".claude-mem"))
EFFICIENCY = EfficiencyReport(  # add a tool by adding a source here
    RtkEfficiency(RUNNER),
    MemEfficiency(MEM_DIR),
    AoEfficiency(lambda: cached("ao", 8, ao_state, slow=True, placeholder={})),
    ModelEfficiency(lambda: inventory.agents(ROOT)),
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
    c = {"verify": cached("verify", 60, verify, slow=True, placeholder={"counts": {}}), "ao": cached("ao", 8, ao_state, slow=True, placeholder={"projects": []})}
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
