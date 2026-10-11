#!/usr/bin/env python3
"""Local live dashboard for the global Claude setup. Read-only, stdlib only, 127.0.0.1 only.

Run: python3 scripts/dashboard/server.py [--port 8787]
Optional: PROJECT_DIRS or state/projects.txt lists project roots; the "프로젝트 셋업" dialog shows file presence, line counts, setting keys and script names.
Reads: git history, gh PR list, scripts/verify.sh --live, reports/*.md, claude/settings.json, the AO daemon (ao status, session ls, review ls; read-only),
and the tool-call names and timestamps of the newest session log in ~/.claude/projects.
It parses the log tail in memory but emits only tool names, times, a file basename, and a command's first word plus a plain subcommand
(never arguments, so a pasted token or `KEY=value` cannot leave the machine). Message text is never emitted.
"""
import json, os, re, secrets, shutil, subprocess, sys, threading, time, urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import inventory

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
CONFIG = Path(os.environ.get("CLAUDE_CONFIG_DIR", Path.home() / ".claude"))
PROJECTS = CONFIG / "projects"
CACHE = {}  # key -> (time, value)
REFRESHING = set()
LOCK = threading.Lock()


def find_bash():
    # On Windows, `bash` on PATH can be WSL's with another HOME; verify.sh needs Git Bash.
    for c in (os.environ.get("BASH"), "C:/Program Files/Git/bin/bash.exe", "C:/Program Files (x86)/Git/bin/bash.exe"):
        if c and Path(c).exists():
            return c
    return "bash"


BASH = find_bash()
ENV = {**os.environ, "HOME": os.environ.get("USERPROFILE", os.environ.get("HOME", ""))} if os.name == "nt" else None


def run(cmd, timeout=60):
    try:
        p = subprocess.run(cmd, cwd=ROOT, env=ENV, capture_output=True, text=True, timeout=timeout, encoding="utf-8", errors="replace")
        return p.stdout
    except Exception:
        return ""


def cached(key, ttl, fn, slow=False, placeholder=None):
    """Return the cached value. A slow source (verify.sh, gh) refreshes in a thread, so a request never waits on it."""
    now = time.time()
    with LOCK:
        hit = CACHE.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
        if slow:
            if key not in REFRESHING:
                REFRESHING.add(key)
                threading.Thread(target=refresh, args=(key, fn), daemon=True).start()
            return hit[1] if hit else placeholder
    return refresh(key, fn)


def refresh(key, fn):
    try:
        val = fn()
        with LOCK:
            CACHE[key] = (time.time(), val)
        return val
    finally:
        with LOCK:
            REFRESHING.discard(key)


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
    try:
        s = json.loads((ROOT / "claude" / "settings.json").read_text(encoding="utf-8"))
        p = s.get("permissions", {})
        ls = json.loads((CONFIG / "settings.json").read_text(encoding="utf-8"))
        live = ls.get("permissions", {})
        keys = ("autoCompactWindow", "promptCacheTtl", "subagentPromptCacheTtl")
        plugins = lambda d: sorted(k for k, v in (d.get("enabledPlugins") or {}).items() if v)
        return {"mode": p.get("defaultMode"), "deny": len(p.get("deny", [])), "ask": len(p.get("ask", [])),
                "liveMode": live.get("defaultMode"), "liveDeny": len(live.get("deny", [])), "liveAsk": len(live.get("ask", [])),
                "model": s.get("model"), "advisor": s.get("advisorModel"),
                "tune": {k: s.get(k) for k in keys}, "liveTune": {k: ls.get(k) for k in keys},
                "plugins": plugins(s), "livePlugins": plugins(ls)}
    except Exception:
        return {}


def reports():
    d = ROOT / "reports"
    items = []
    if d.is_dir():
        for f in sorted(d.glob("20*.md"), reverse=True)[:7]:
            items.append({"name": f.name, "mtime": datetime.fromtimestamp(f.stat().st_mtime, timezone.utc).isoformat(),
                          "text": f.read_text(encoding="utf-8", errors="replace")[:4000]})
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
        sessions.append({k: s.get(k) for k in ("id", "projectId", "role", "displayName", "status", "activity", "branch", "prs", "isTerminated", "lastActivityAt", "createdAt")})
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


def safe_command(cmd):
    """First word, plus the second only when it is a plain subcommand or script path (no '=', no leading '-')."""
    w = cmd.split()
    if not w:
        return ""
    head = os.path.basename(w[0])[:20]
    if len(w) > 1 and re.fullmatch(r"[A-Za-z0-9_./-]{1,40}", w[1]) and not w[1].startswith("-") and head in ("git", "gh", "bash", "python3", "python", "npm", "npx", "rtk", "winget"):
        return head + " " + w[1]
    return head


def session_events(limit=120):
    """Tool-call name, time and a safe target (file basename or command head) from the newest session log."""
    files = list(PROJECTS.glob("*/*.jsonl")) if PROJECTS.is_dir() else []
    if not files:
        return {"session": None, "events": []}
    f = max(files, key=lambda p: p.stat().st_mtime)
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
        ts = d.get("timestamp")
        if not ts:
            continue
        t = d.get("type")
        c = (d.get("message") or {}).get("content")
        if t == "assistant" and isinstance(c, list):
            for x in c:
                if x.get("type") == "tool_use":
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
    return {"session": f.stem[:8], "mtime": datetime.fromtimestamp(f.stat().st_mtime, timezone.utc).isoformat(), "events": events[-limit:]}


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
            log = max(d.glob("*.jsonl"), key=lambda f: f.stat().st_mtime)
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
        p = subprocess.run(["git", "ls-files", "--", *pats], cwd=d, env=ENV, capture_output=True, text=True, timeout=10)
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
            lit = 0
            for s in (servers.values() if isinstance(servers, dict) else []):
                for part in ((s.get("headers") if isinstance(s, dict) else None) or {}), ((s.get("env") if isinstance(s, dict) else None) or {}):
                    for k, v in (part.items() if isinstance(part, dict) else []):
                        if isinstance(v, str) and "${" not in v and not v.startswith("$") and len(v) >= 12 and (re.search(r"authorization|token$|(^|_)key$|secret|password", str(k), re.I) or re.search(r"(Bearer\s+\S{16,}|sk-\S{16,}|ghp_\S+|xox\S-\S+)", v)):
                            lit += 1
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
    """Sizes and ages of the prompt history, session logs and apply backups. Never reads their content."""
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
    try:
        bk = sorted(Path.home().glob(".claude-backup-*"))
        out.append(("기록", "apply 백업", "warn" if len(bk) > 15 else "ok", f"{len(bk)}개" + (f" · 가장 오래된 {bk[0].name[-15:]}" if bk else "") + (" · 15개 초과, 정리 검토" if len(bk) > 15 else ""), "오래된 ~/.claude-backup-* 폴더를 목록 확인 후 사용자 승인으로 삭제 [출처: 이 저장소 규칙]" if len(bk) > 15 else "", "prune-backups" if len(bk) > 15 else ""))
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


def _ver(text):
    m = re.search(r"(\d+)\.(\d+)\.(\d+)", text or "")
    return tuple(int(x) for x in m.groups()) if m else None


def _rtk_latest():
    try:
        req = urllib.request.Request("https://api.github.com/repos/rtk-ai/rtk/releases/latest", headers={"User-Agent": "claude-global-dashboard"})
        with urllib.request.urlopen(req, timeout=5) as r:
            return json.load(r).get("tag_name")
    except Exception:
        return None


def _rtk_installer():
    """Update command for this machine: winget on Windows, brew on macOS. None when neither exists."""
    if shutil.which("winget"):
        return ["winget", "upgrade", "--id", "rtk-ai.rtk", "--silent", "--accept-package-agreements", "--accept-source-agreements"]
    if shutil.which("brew"):
        return ["brew", "upgrade", "rtk"]
    return None


def tools_version_health():
    """RTK installed vs latest GitHub release. Network failure means 'not checked', never an error."""
    if not shutil.which("rtk"):
        return []
    cur = run(["rtk", "--version"], timeout=10).strip()
    latest = cached("rtk_latest", 3600, _rtk_latest, slow=True)
    a, b = _ver(cur), _ver(latest)
    if not a or not b:
        return [("도구", "RTK 버전", "ok", f"{cur or '?'} · 최신 버전 확인 못 함")]
    if a >= b:
        return [("도구", "RTK 버전", "ok", f"{cur} (최신)")]
    fixable = _rtk_installer() is not None
    return [("도구", "RTK 버전", "warn", f"{cur} → 최신 {latest}", "업데이트: " + " ".join(_rtk_installer() or ["수동 설치"]) + " [출처: 설치 방식(winget) 확인함, 릴리스 노트는 안 읽음]", "rtk-update" if fixable else "")]


def tools_health():
    ao = cached("ao", 8, ao_state, slow=True, placeholder={"available": bool(ao_bin()), "daemon": {"state": "loading"}, "sessions": []})
    items = []
    for name, fn in (("claude-mem", mem_health), ("기록", history_health), ("AO", lambda: ao_health(ao)), ("도구", tools_version_health)):
        try:
            items += fn()
        except Exception:  # one failing source must not take /api/state down
            items.append((name, "점검 실행", "warn", "이 항목을 읽는 중 오류가 났습니다"))
    return [{"group": i[0], "name": i[1], "level": i[2], "detail": i[3], "fix": str(i[4])[:300] if len(i) > 4 else "", "fixId": i[5] if len(i) > 5 else ""} for i in items]


KEEP_BACKUPS = 3
TOKEN = secrets.token_urlsafe(24)  # per start; a foreign page cannot read it (no CORS headers), so it cannot call /api/fix
FIXLOG = ROOT / "state" / "fix-log.jsonl"


def _backups():
    return sorted(d for d in Path.home().glob(".claude-backup-*") if d.is_dir() and not d.is_symlink() and re.fullmatch(r"\.claude-backup-\d{8}-\d{6}", d.name))


def fix_preview(fid):
    """What a fix would touch, without touching it. Only ids in this table can ever run."""
    if fid == "prune-backups":
        old = _backups()[:-KEEP_BACKUPS]
        return {"title": f"오래된 apply 백업 삭제 (최신 {KEEP_BACKUPS}개 유지)", "targets": [d.name for d in old], "reversible": False}
    if fid == "mem-redact-on":
        f = Path(os.environ.get("CLAUDE_MEM_DIR", Path.home() / ".claude-mem")) / "settings.json"
        on = False
        try:
            on = str(json.loads(f.read_text(encoding="utf-8")).get("CLAUDE_MEM_REDACT_ENABLED", "")).lower() == "true"
        except Exception:
            pass
        return {"title": "claude-mem 비밀 마스킹 켜기 (설정 파일을 백업한 뒤 CLAUDE_MEM_REDACT_ENABLED만 변경)", "targets": [] if on else ["~/.claude-mem/settings.json"], "reversible": True}
    if fid == "rtk-update":
        cmd = _rtk_installer()
        cur, latest = run(["rtk", "--version"], timeout=10).strip(), cached("rtk_latest", 3600, _rtk_latest)
        a, b = _ver(cur), _ver(latest)
        due = bool(cmd and a and b and a < b)
        return {"title": "RTK 업데이트 (설치 관리자가 새 버전으로 교체, 이전 버전 복구는 수동)", "targets": [f"{cur} -> {latest}: {' '.join(cmd)}"] if due else [], "reversible": False}
    return None


def fix_apply(fid, targets):
    pv = fix_preview(fid)
    if not pv or not pv["targets"]:
        return {"ok": False, "msg": "할 일이 없거나 알 수 없는 조치입니다."}
    if sorted(targets) != sorted(pv["targets"]):  # the user confirmed a list; it must still be the current one
        return {"ok": False, "msg": "대상이 바뀌었습니다. 미리보기를 다시 확인하세요."}
    if fid == "prune-backups":
        for name in pv["targets"]:
            shutil.rmtree(Path.home() / name)
        return {"ok": True, "msg": f"{len(pv['targets'])}개 삭제"}
    if fid == "mem-redact-on":
        f = Path(os.environ.get("CLAUDE_MEM_DIR", Path.home() / ".claude-mem")) / "settings.json"
        shutil.copy2(f, f.with_name(f.name + ".bak-" + datetime.now().strftime("%Y%m%d-%H%M%S")))
        d = json.loads(f.read_text(encoding="utf-8"))
        d["CLAUDE_MEM_REDACT_ENABLED"] = "true"
        f.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
        return {"ok": True, "msg": "켰습니다. claude-mem 워커를 다시 시작해야 적용될 수 있습니다."}
    if fid == "rtk-update":
        try:
            p = subprocess.run(_rtk_installer(), capture_output=True, text=True, timeout=300, encoding="utf-8", errors="replace")
        except (OSError, subprocess.TimeoutExpired) as e:
            return {"ok": False, "msg": "실행 실패: " + type(e).__name__}
        CACHE.pop("rtk_latest", None)
        return {"ok": p.returncode == 0, "msg": f"설치 관리자 종료 코드 {p.returncode}. 새 버전은 `rtk --version`으로 확인하세요."}
    return {"ok": False, "msg": "알 수 없는 조치"}


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


def state():
    return {
        "now": datetime.now(timezone.utc).isoformat(),
        "git": cached("git", 5, git_history),
        "tools": cached("tools", 10, tools_health),
        "fixlog": fix_log(),
        "token": TOKEN,
        "prs": cached("prs", 60, pull_requests, slow=True, placeholder=[]),
        "verify": cached("verify", 60, verify, slow=True, placeholder={"at": datetime.now(timezone.utc).isoformat(), "counts": {"PASS": 0, "FAIL": 0, "WARN": 0}, "lines": ["검증 실행 중..."]}),
        "settings": cached("settings", 5, settings),
        "reports": cached("reports", 30, reports),
        "ao": cached("ao", 8, ao_state, slow=True, placeholder={"available": True, "daemon": {"state": "loading"}, "sessions": []}),
        "activity": session_events(),
        "projects": cached("projects", 10, projects),
    }


def newest_session():
    files = list(PROJECTS.glob("*/*.jsonl")) if PROJECTS.is_dir() else []
    return max(files, key=lambda p: p.stat().st_mtime) if files else None


def inv():
    v = cached("verify", 60, verify, slow=True, placeholder={"counts": {}})
    ao = cached("ao", 8, ao_state, slow=True, placeholder={"projects": []})
    return {"orchestration": inventory.orchestration(ROOT), "routing": inventory.routing(ROOT, ao.get("projects", [])),
            "features": inventory.features(ROOT), "practices": inventory.practices(ROOT, CONFIG, v.get("counts")),
            "debug": inventory.debug(newest_session()), "agents": inventory.agents(ROOT)}


class H(BaseHTTPRequestHandler):
    def do_GET(self):
        # Refuse foreign Host headers (DNS rebinding against a local server).
        if self.headers.get("Host", "").split(":")[0] not in ("127.0.0.1", "localhost"):
            self.send_error(403)
            return
        if self.path.startswith("/api/state"):
            body, ctype = json.dumps(state()).encode(), "application/json"
        elif self.path.startswith("/api/inventory"):
            body, ctype = json.dumps(cached("inv", 15, inv)).encode(), "application/json"
        elif self.path in ("/", "/index.html"):
            body, ctype = (HERE / "index.html").read_bytes(), "text/html; charset=utf-8"
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        host_ok = self.headers.get("Host", "").split(":")[0] in ("127.0.0.1", "localhost")
        origin = self.headers.get("Origin", "")
        origin_ok = origin == "" or origin.split("://", 1)[-1].split(":")[0] in ("127.0.0.1", "localhost")
        if not (host_ok and origin_ok and self.path == "/api/fix" and self.headers.get("Content-Type", "").startswith("application/json")
                and secrets.compare_digest(self.headers.get("X-Dash-Token", ""), TOKEN)):
            self.send_error(403)
            return
        try:
            req = json.loads(self.rfile.read(min(int(self.headers.get("Content-Length", 0)), 20000)) or b"{}")
            fid = str(req.get("id", ""))
            if req.get("action") == "apply":
                targets = [str(t) for t in req.get("targets", [])]
                res = fix_apply(fid, targets)
                fix_log_write(fid, targets, res)
                CACHE.pop("tools", None)
            else:
                pv = fix_preview(fid)
                res = {"ok": bool(pv), **(pv or {"msg": "알 수 없는 조치"})}
        except Exception as e:
            res = {"ok": False, "msg": "요청 오류: " + type(e).__name__}
        body = json.dumps(res, ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    port = int(sys.argv[sys.argv.index("--port") + 1]) if "--port" in sys.argv else 8787
    print(f"dashboard on http://127.0.0.1:{port}")
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
