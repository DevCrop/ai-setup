"""Projects: which folders to look at, the setup facts of one project, and the best-practice findings for it.

Everything here reads files of the projects under inspection. Only booleans, counts and finding texts leave: never file content.
A finding is {act: add|fix|remove, level, what, why, fix, src}. The rules come from the Claude Code docs pages memory, best-practices
and permissions (read 2026-10-10). To add a rule: write `rule_<name>(ctx)` (a generator of findings) and put it in RULES, in the order the
findings should appear. `spawn` (a process starter from procs.py) is passed in; nothing here starts a process on its own.
"""
import json, os, re
from pathlib import Path, PureWindowsPath

from fsutil import newest_file
from procs import which

SECRET_KEY = re.compile(r"authorization|token|secret|passw(or)?d|pwd|apikey|accesskey|privatekey|credential|cookie|signature", re.I)
SECRET_VALUE = re.compile(r"Bearer\s+\S{16,}|sk-\S{16,}|gh[pousr]_\S+|github_pat_\S+|xox\S-\S+|AKIA[0-9A-Z]{12,}|AIza\S{20,}|eyJ[A-Za-z0-9_-]{20,}"
                          r"|://[^/\s:@]+:[^/\s@]+@|[?&](?:api_?key|token|key|secret|password)=[^&\s]{8,}", re.I)
REFERENCE = re.compile(r"\$\{?\w")  # ${VAR} or $VAR anywhere in the value: the secret lives outside the file


def is_literal_secret(key, value):
    """A header, env, url or argument value written into a file instead of a ${VAR} reference, under a secret-looking name or shaped like a known token."""
    if not isinstance(value, str) or REFERENCE.search(value) or len(value) < 12 or value.isdigit():
        return False
    name = str(key)
    return bool(SECRET_KEY.search(re.sub(r"[-_\s]", "", name)) or re.search(r"(^|[-_])key$", name, re.I) or SECRET_VALUE.search(value))


def literal_secret_count(servers):
    n = 0
    for srv in (servers.values() if isinstance(servers, dict) else []):
        if not isinstance(srv, dict):
            continue
        for part in (srv.get("headers") or {}), (srv.get("env") or {}):
            n += sum(1 for k, v in (part.items() if isinstance(part, dict) else []) if is_literal_secret(k, v))
        if is_literal_secret("url", srv.get("url")):
            n += 1
        args = [a for a in (srv.get("args") if isinstance(srv.get("args"), list) else []) if isinstance(a, str)]
        for i, a in enumerate(args):
            flag, eq, val = a.lstrip("-").partition("=")
            if a.startswith("-") and eq and is_literal_secret(flag, val):
                n += 1
            elif a.startswith("-") and not eq and i + 1 < len(args) and is_literal_secret(flag, args[i + 1]):
                n += 1
    return n


def project_dirs(root, projects_dir):
    """Project roots to inspect: PROJECT_DIRS (path-separated) or state/projects.txt, one path per line."""
    raw = os.environ.get("PROJECT_DIRS", "")
    paths = [p for p in raw.split(os.pathsep) if p.strip()]
    f = root / "state" / "projects.txt"
    if not paths and f.is_file():
        paths = [l.strip() for l in f.read_text(encoding="utf-8-sig", errors="replace").splitlines() if l.strip() and not l.startswith("#")]
    return [Path(p).expanduser() for p in paths] or discover_projects(root, projects_dir)


def discover_projects(root, projects_dir, limit=30):
    """No list given: take the working folders Claude Code recorded in its session logs, plus sibling folders that look like projects."""
    skip = re.compile(r"appdata|[\\/]temp[\\/]|scratchpad|worktree|[\\/]\.claude|[\\/]ao[\\/]", re.I)
    cwds = []
    try:
        logdirs = list(projects_dir.iterdir()) if projects_dir.is_dir() else []
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
    rf = root / "state" / "project-roots.txt"  # per-machine folders that hold projects, one path per line (or PROJECT_ROOTS)
    try:
        lines = os.environ["PROJECT_ROOTS"].split(os.pathsep) if "PROJECT_ROOTS" in os.environ else rf.read_text(encoding="utf-8-sig", errors="replace").splitlines() if rf.is_file() else []
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


def project_setup(d, spawn):
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
        f["checks"] = practice_checks(d, f, al, cl, perm, rules, "\n".join(al + cl).lower(), cfg, spawn)
    return f


def finding(act, level, what, why, fix, src):
    return {"act": act, "level": level, "what": what, "why": why, "fix": fix, "src": src}


class Context:
    """What the rules look at: the project folder, the setup facts `f` (rules may add to it), the instruction lines, the project's own
    permissions and settings, and a way to ask git which files are tracked."""

    def __init__(self, d, f, al, cl, perm, rules, text, cfg, spawn):
        self.d, self.f, self.al, self.cl, self.perm, self.rules, self.text, self.spawn = d, f, al, cl, perm, rules, text, spawn
        self.cfg = cfg if isinstance(cfg, dict) else {}
        self.local = (d / "CLAUDE.local.md").is_file()

    def tracked(self, *pats):
        try:
            p = self.spawn(["git", "ls-files", "--", *pats], timeout=10, cwd=self.d)
            return [l for l in p.stdout.splitlines() if l.strip()] if p.returncode == 0 else []
        except Exception:
            return []


def rule_no_instructions(ctx):
    d, f, al, cl, perm, text, cfg, local = ctx.d, ctx.f, ctx.al, ctx.cl, ctx.perm, ctx.text, ctx.cfg, ctx.local
    if not (f["agents"] or f["claude"]):
        yield finding("add", "warn", "지침 파일 없음", "Claude는 매 세션 CLAUDE.md(또는 AGENTS.md)를 읽습니다. 없으면 빌드·테스트 명령과 프로젝트 규칙을 매번 추측합니다.", "AGENTS.md 또는 CLAUDE.md를 추가: 검증 명령, 기본값과 다른 스타일 규칙, 함정만 (/project-setup).", "memory")


def rule_missing_import(ctx):
    d, f, al, cl, perm, text, cfg, local = ctx.d, ctx.f, ctx.al, ctx.cl, ctx.perm, ctx.text, ctx.cfg, ctx.local
    if f["agents"] and f["claude"] and not f["imports"]:
        # A thin CLAUDE.md that names AGENTS.md (a shared book both tools read) may be deliberate: report it, but not as a defect.
        thin = "agents.md" in "\n".join(cl).lower() and f["claudeLines"] < 120
        yield finding("fix", "info" if thin else "bad", "CLAUDE.md가 @AGENTS.md를 가져오지 않음" + (" (얇은 진입점이 AGENTS.md를 언급함)" if thin else ""), "AGENTS.md와 CLAUDE.md가 둘 다 있으면 Claude는 CLAUDE.md만 읽습니다. AGENTS.md의 규칙은 import하거나 CLAUDE.md가 가리키는 문서에 있어야 Claude에게 전달됩니다.", ("의도한 구조(공유 문서로 안내)라면 그대로 두고, 아니면 " if thin else "") + "CLAUDE.md 첫 줄을 @AGENTS.md로 하고 Claude 전용 내용만 그 아래에 둡니다.", "memory")


def rule_local_blocks_agents(ctx):
    d, f, al, cl, perm, text, cfg, local = ctx.d, ctx.f, ctx.al, ctx.cl, ctx.perm, ctx.text, ctx.cfg, ctx.local
    if f["agents"] and not f["claude"] and local:
        yield finding("fix", "warn", "CLAUDE.local.md 때문에 AGENTS.md가 읽히지 않을 수 있음", "AGENTS.md는 CLAUDE.md와 CLAUDE.local.md가 모두 없을 때만 단독으로 로드됩니다.", "프로젝트 CLAUDE.md(첫 줄 @AGENTS.md)를 만들거나 CLAUDE.local.md 첫 줄에 @AGENTS.md를 넣습니다.", "memory")


def rule_duplicate_copy(ctx):
    d, f, al, cl, perm, text, cfg, local = ctx.d, ctx.f, ctx.al, ctx.cl, ctx.perm, ctx.text, ctx.cfg, ctx.local
    norm = lambda ls: [l.strip() for l in ls if l.strip()]
    if f["agents"] and f["claude"] and not f["imports"] and norm(al) == norm(cl):
        yield finding("remove", "warn", "CLAUDE.md가 AGENTS.md의 복사본", "같은 내용이 두 곳에 있으면 한쪽만 고쳐져 어긋납니다.", "CLAUDE.md를 @AGENTS.md 한 줄(+Claude 전용 몇 줄)로 줄입니다.", "memory")


def rule_long_claude(ctx):
    d, f, al, cl, perm, text, cfg, local = ctx.d, ctx.f, ctx.al, ctx.cl, ctx.perm, ctx.text, ctx.cfg, ctx.local
    if f["claudeLines"] > 200:
        yield finding("fix", "warn", "CLAUDE.md %d줄 (권장 200 이하)" % f["claudeLines"], "길수록 컨텍스트를 더 쓰고 지침이 묻혀 따르는 비율이 떨어집니다.", "영역별 규칙은 .claude/rules/<영역>.md(paths:)로 옮기고, 코드에서 알 수 있는 내용은 지웁니다 (/doctor가 제안).", "memory")


def rule_long_agents(ctx):
    d, f, al, cl, perm, text, cfg, local = ctx.d, ctx.f, ctx.al, ctx.cl, ctx.perm, ctx.text, ctx.cfg, ctx.local
    if f["agentsLines"] > 200 and not f["claude"]:
        yield finding("fix", "warn", "AGENTS.md %d줄 (Claude가 전부 로드)" % f["agentsLines"], "Claude는 AGENTS.md를 통째로 읽습니다. 200줄을 넘으면 같은 이유로 지침이 묻힙니다.", "Codex와 공유하는 정본이라 사용자가 판단: 영역 규칙을 .claude/rules/로 옮기거나 AGENTS.md를 줄입니다.", "memory")


def rule_placeholders(ctx):
    d, f, al, cl, perm, text, cfg, local = ctx.d, ctx.f, ctx.al, ctx.cl, ctx.perm, ctx.text, ctx.cfg, ctx.local
    ph = sum(l.count("[REPLACE:") for l in al + cl)
    if ph:
        yield finding("fix", "warn", "템플릿 자리표시자 [REPLACE:] %d개 남음" % ph, "채워지지 않은 자리표시자는 Claude에게 잘못된 지침이 됩니다.", "실제 값으로 채우거나 해당 줄을 지웁니다.", "best-practices")


def rule_project_settings(ctx):
    d, f, al, cl, perm, text, cfg, local = ctx.d, ctx.f, ctx.al, ctx.cl, ctx.perm, ctx.text, ctx.cfg, ctx.local
    if not f["settings"]:
        yield finding("add", "warn", ".claude/settings.json 없음", "팀원과 클라우드 세션은 ~/.claude를 읽지 않습니다. 프로젝트 쪽 deny가 없으면 .env 보호가 개인 설정에만 의존합니다.", "permissions.deny에 Read(**/.env*), Read(**/.credentials*)를 추가합니다.", "permissions")
    else:
        if not f["denyEnv"]:
            yield finding("add", "bad", "deny에 .env 읽기 차단이 없음", "deny는 모든 모드에서 적용되는 보호 규칙입니다.", "permissions.deny에 Read(**/.env*)를 추가합니다.", "permissions")
        if f["defaultMode"]:
            yield finding("remove", "bad", "프로젝트 settings에 bypassPermissions", "권한 확인을 끄는 모드를 프로젝트 파일로 팀 전체에 강제하는 것은 위험합니다. 이 모드는 사용자가 정할 일입니다.", "defaultMode 줄을 지웁니다.", "permissions")
        allow = perm.get("allow") if isinstance(perm.get("allow"), list) else []
        risky = [a for a in allow if isinstance(a, str) and re.match(r"Bash\((rm|sudo|git push|npm publish|npm install|npm ci|composer install)[ :)]", a)]
        if risky:
            yield finding("fix", "info", "allow에 삭제·설치·배포 명령 %d개" % len(risky), "문서의 allow 예시는 npm run test, git commit 같은 일상 명령입니다. 삭제·설치·push는 매번 확인하는 편이 안전합니다(판단 사항).", "팀이 정말 필요한 것만 남기고 나머지 allow를 지웁니다.", "permissions")


def rule_gitignore(ctx):
    d, f, al, cl, perm, text, cfg, local = ctx.d, ctx.f, ctx.al, ctx.cl, ctx.perm, ctx.text, ctx.cfg, ctx.local
    if not f["gitignore"]:
        has = (d / "CLAUDE.local.md").is_file() or (d / ".claude" / "settings.local.json").is_file()
        yield finding("add", "warn" if has else "info", ".gitignore에 로컬 파일 줄 누락", "CLAUDE.local.md와 settings.local.json은 개인용입니다. 커밋되면 개인 설정이 팀에 퍼집니다.", ".gitignore에 CLAUDE.local.md, .claude/settings.local.json을 추가합니다.", "memory")


def rule_tracked_env(ctx):
    d, f, al, cl, perm, text, cfg, local = ctx.d, ctx.f, ctx.al, ctx.cl, ctx.perm, ctx.text, ctx.cfg, ctx.local
    env = [t for t in ctx.tracked(".env", ".env.*", "**/.env", "**/.env.*") if not re.search(r"\.(example|sample|template|dist)$", t)]
    if env:
        yield finding("remove", "bad", "git에 .env 파일 %d개 추적 중" % len(env), "커밋된 비밀은 히스토리에 남습니다.", "git rm --cached 후 .gitignore에 추가하고, 노출된 값은 폐기합니다.", "permissions")


def rule_tracked_local(ctx):
    d, f, al, cl, perm, text, cfg, local = ctx.d, ctx.f, ctx.al, ctx.cl, ctx.perm, ctx.text, ctx.cfg, ctx.local
    if ctx.tracked("CLAUDE.local.md", ".claude/settings.local.json"):
        yield finding("remove", "warn", "개인용 로컬 파일이 git에 추적됨", "로컬 파일은 개인 설정입니다.", "git rm --cached 후 .gitignore에 추가합니다.", "memory")


def rule_verification(ctx):
    d, f, al, cl, perm, text, cfg, local = ctx.d, ctx.f, ctx.al, ctx.cl, ctx.perm, ctx.text, ctx.cfg, ctx.local
    names = []
    for fn in ("package.json", "composer.json"):
        try:
            names += list((json.loads((d / fn).read_text(encoding="utf-8")).get("scripts") or {}).keys())
        except Exception:
            pass
    for mk in ("Makefile", "makefile"):  # first hit only: on a case-insensitive disk (Windows, macOS) both spellings are the same file
        if (d / mk).is_file():
            names += re.findall(r"^([A-Za-z0-9_.-]+):", (d / mk).read_text(encoding="utf-8", errors="replace"), re.M)
            break
    checks = [c for c in names if re.search(r"(test|lint|typecheck|check|phpunit|stylelint|phpcs)", c, re.I)]
    ci = (d / ".github" / "workflows").is_dir()
    tool = any((d / n).is_file() for n in ("pyproject.toml", "pytest.ini", "tox.ini", "go.mod", "Cargo.toml"))  # built-in test runners
    f["verify"] = len(checks) + (1 if ci else 0) + (1 if tool else 0)
    if not checks and not ci and not tool:
        yield finding("add", "warn", "검증 명령을 찾지 못함", "Claude가 실행할 수 있는 검사가 없으면 '끝났다'는 Claude의 판단뿐이고 사용자가 검증 루프가 됩니다.", "테스트·lint·타입체크 중 하나를 스크립트로 만들고(마크업은 스크린샷 비교나 lint) 지침에 적습니다.", "best-practices")
    elif checks and (f["agents"] or f["claude"]) and not any(re.search(r"(?<![a-z0-9])" + re.escape(c.lower()) + r"(?![a-z0-9])", text) for c in checks):
        yield finding("add", "warn", "검증 명령이 지침에 적혀 있지 않음", "Claude는 어떤 명령이 이 프로젝트의 검사인지 추측해야 합니다.", "지침에 실제 명령 한 줄을 적습니다. 후보: " + ", ".join(checks[:3]), "best-practices")


def rule_container(ctx):
    d, f, al, cl, perm, text, cfg, local = ctx.d, ctx.f, ctx.al, ctx.cl, ctx.perm, ctx.text, ctx.cfg, ctx.local
    if (f["agents"] or f["claude"]) and any((d / n).is_file() for n in ("docker-compose.yml", "docker-compose.yaml", "compose.yaml")) and not re.search(r"docker|container|컨테이너|make up", text):
        yield finding("add", "info", "명령이 컨테이너/호스트 어디서 도는지 안 적혀 있음", "Claude는 환경 특이점을 코드에서 알 수 없습니다. 잘못된 곳에서 실행하면 실패합니다.", "지침에 한 줄: 검증 명령을 컨테이너에서 실행하는지, 호스트에서 실행하는지.", "best-practices")


def rule_rtk_twins(ctx):
    d, f, al, cl, perm, text, cfg, local = ctx.d, ctx.f, ctx.al, ctx.cl, ctx.perm, ctx.text, ctx.cfg, ctx.local
    # rtk twins: this machine's global setup evaluates permission rules on the rtk-rewritten command (ai-setup CLAUDE.md)
    if which("rtk"):
        miss = {}
        for kind in ("deny", "ask", "allow"):
            rs = [r for r in (perm.get(kind) if isinstance(perm.get(kind), list) else []) if isinstance(r, str) and r.startswith("Bash(")]
            have = set(rs)
            n = sum(1 for r in rs if not r.startswith("Bash(rtk ") and "Bash(rtk " + r[5:] not in have)
            if n:
                miss[kind] = n
        if miss:
            yield finding("add", "bad" if "deny" in miss else "warn", "rtk 쌍이 없는 Bash 규칙 (" + ", ".join("%s %d개" % kv for kv in miss.items()) + ")", "RTK가 git ...을 rtk git ...으로 바꾼 뒤 권한 규칙을 평가합니다. 쌍이 없으면 deny가 우회되고 allow가 적용되지 않습니다.", "각 Bash 규칙에 'Bash(rtk ...)' 쌍을 추가합니다 (/project-setup 7단계).", "ai-setup")


def rule_mcp(ctx):
    d, f, al, cl, perm, text, cfg, local = ctx.d, ctx.f, ctx.al, ctx.cl, ctx.perm, ctx.text, ctx.cfg, ctx.local
    mcp = d / ".mcp.json"
    if mcp.is_file():
        try:
            servers = (json.loads(mcp.read_text(encoding="utf-8")) or {}).get("mcpServers") or {}
        except Exception:
            servers = None
        if servers is None:
            yield finding("fix", "warn", ".mcp.json을 읽을 수 없음(JSON 오류)", "형식이 틀리면 팀 전체가 MCP 서버를 못 씁니다.", "JSON 문법을 고칩니다.", "mcp")
        else:
            lit = literal_secret_count(servers)
            if lit and ctx.tracked(".mcp.json"):
                yield finding("fix", "bad", ".mcp.json(git 추적)에 토큰이 값으로 적혀 있음 (%d개)" % lit, "문서는 ${VAR} 환경변수 확장으로 비밀을 파일 밖에 두도록 안내합니다. 커밋된 토큰은 히스토리에 남습니다.", "값을 ${API_KEY} 형태로 바꾸고 노출된 토큰은 폐기합니다.", "mcp")


def rule_skills(ctx):
    d, f, al, cl, perm, text, cfg, local = ctx.d, ctx.f, ctx.al, ctx.cl, ctx.perm, ctx.text, ctx.cfg, ctx.local
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
        yield finding("fix", "warn", "skills 문제 (500줄 초과 %d, description 없음 %d)" % (sk.count("길이"), sk.count("description")), "SKILL.md는 500줄 이하를 권장하고, description이 있어야 Claude가 언제 쓸지 판단합니다.", "긴 참고 자료는 별도 파일로 옮기고 frontmatter에 description을 씁니다.", "skills")


def rule_hooks(ctx):
    d, f, al, cl, perm, text, cfg, local = ctx.d, ctx.f, ctx.al, ctx.cl, ctx.perm, ctx.text, ctx.cfg, ctx.local
    hk = cfg.get("hooks") if isinstance(cfg.get("hooks"), dict) else {}
    gone = 0
    for groups in hk.values():
        for g in (groups if isinstance(groups, list) else []):
            for h in ((g.get("hooks") if isinstance(g, dict) else None) or []):
                cmd = str(h.get("command", "")) if isinstance(h, dict) else ""
                m = re.search(r"\"\$\{?CLAUDE_PROJECT_DIR\}?/([^\"]+)\"", cmd) or re.search(r"\$\{?CLAUDE_PROJECT_DIR\}?\"?/([\w./-]+)", cmd)  # quoted path may hold spaces
                rel = m.group(1) if m else ""
                # an absolute, UNC (//host, \\host) or drive path (C:) never reaches the filesystem: exists() could contact a network host
                # on every refresh. Other relative names (with +, @, spaces) are still checked.
                far = rel[:1] in "/\\" or ":" in rel or "$" in rel or PureWindowsPath(rel).anchor  # $VAR: unknown name
                if rel and not far and ".." not in re.split(r"[\\/]", rel) and not (d / rel).exists():
                    gone += 1
    if gone:
        yield finding("fix", "bad", "hook이 가리키는 프로젝트 스크립트가 없음 (%d개)" % gone, "없는 스크립트를 실행하는 hook은 매번 실패합니다.", "경로를 고치거나 hook을 지웁니다 (/hooks로 확인).", "hooks")


RULES = (
    rule_no_instructions,
    rule_missing_import,
    rule_local_blocks_agents,
    rule_duplicate_copy,
    rule_long_claude,
    rule_long_agents,
    rule_placeholders,
    rule_project_settings,
    rule_gitignore,
    rule_tracked_env,
    rule_tracked_local,
    rule_verification,
    rule_container,
    rule_rtk_twins,
    rule_mcp,
    rule_skills,
    rule_hooks,
)


def practice_checks(d, f, al, cl, perm, rules, text, cfg=None, spawn=None):
    """All findings for one project, in RULES order."""
    ctx = Context(d, f, al, cl, perm, rules, text, cfg, spawn)
    return [x for rule in RULES for x in rule(ctx)]


def collect(root, projects_dir, spawn):
    out = []
    for d in project_dirs(root, projects_dir):
        try:
            out.append(project_setup(d, spawn))
        except Exception:  # one unreadable project must not take the whole dashboard down
            out.append({"name": d.name, "found": True, "error": True})
    return out
