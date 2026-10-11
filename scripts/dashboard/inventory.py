"""Read-only inventory for the dashboard's side tabs: orchestration, model routing, features, practice checks, debug.
Everything comes from files in this repo and the newest session log. It emits names, numbers and the repo's own
metadata; tool-result text is classified in memory and never emitted (only a fixed kind plus secret-guard's file names)."""
import json, os, re
from pathlib import Path

AGENT_KEYS = {"name", "description", "tools", "disallowedTools", "model", "permissionMode", "maxTurns", "skills", "mcpServers", "hooks",
              "memory", "background", "effort", "isolation", "color", "initialPrompt", "omitClaudeMd"}


def _read(p):
    try:
        return Path(p).read_text(encoding="utf-8", errors="replace")
    except Exception:
        return ""


def _fm(text):
    out, lines = {}, text.replace("\r", "").split("\n")
    if not lines or lines[0].strip() != "---":
        return out
    for l in lines[1:]:
        if l.strip() == "---":
            break
        m = re.match(r"^([A-Za-z][\w-]*):\s*(.*)$", l)
        if m:
            out[m.group(1)] = m.group(2).strip()
    return out


def _settings(root):
    try:
        return json.loads(_read(root / "claude" / "settings.json"))
    except Exception:
        return {}


def agents(root):
    out = []
    for f in sorted((root / "claude" / "agents").glob("*.md")):
        m = _fm(_read(f))
        out.append({"name": m.get("name", f.stem), "model": m.get("model", "(상속)"), "effort": m.get("effort", "(상속)"),
                    "tools": m.get("tools", "(전체)"), "skills": m.get("skills", ""), "desc": m.get("description", "")[:600],
                    "badKeys": sorted(set(m) - AGENT_KEYS)})
    return out


def orchestration(root):
    text = _read(root / "claude" / "skills" / "orchestrate" / "SKILL.md").replace("\r", "")
    body = text.split("---", 2)[-1].strip().split("\n")
    rules = [re.sub(r"\s+", " ", l.strip())[:300] for l in body if re.match(r"^\d+\.\s", l.strip())]
    routes = []
    for l in body:
        c = [x.strip() for x in l.strip().strip("|").split("|")]
        if l.strip().startswith("|") and len(c) == 2 and c[0] != "Part" and not set(c[0]) <= set("-"):
            routes.append({"part": c[0], "agent": c[1]})
    first = next((l.strip() for l in body if l.strip()), "")
    claude = _read(root / "claude" / "CLAUDE.md").replace("\r", "").split("\n")
    sec, on = [], False
    for l in claude:
        if l.startswith("## "):
            on = l.strip() == "## Orchestration"
        elif on and l.strip().startswith("- "):
            sec.append(l.strip()[2:][:500])
    return {"default": first[:300], "rules": rules, "routes": routes, "global": sec,
            "format": ["위임 브리프: Task(한 문장) · Files(경로·스펙·API 계약) · Return format · Done criteria(명령으로 확인 가능)",
                       "동시 위임 최대 3개, 같은 파일을 두 에이전트가 수정하지 않는다",
                       "qa와 reviewer에는 기준과 변경 파일 목록만 준다(작성자의 추론·판정 금지)",
                       "서브에이전트 보고는 주장이다: 인용한 증거를 확인한 뒤 완료로 전달"]}


def routing(root, ao_projects):
    s = _settings(root)
    routine = next((l.strip() for l in _read(root / "claude" / "routines" / "daily-update.md").split("\n") if l.startswith("Model:")), "")
    return {"main": s.get("model"), "effort": s.get("effortLevel"), "advisor": s.get("advisorModel"), "autoCompact": s.get("autoCompactWindow"),
            "agents": [{"name": a["name"], "model": a["model"], "effort": a["effort"]} for a in agents(root)],
            "routine": routine[:200], "ao": ao_projects,
            "notes": ["서브에이전트는 설정된 advisor를 상속한다(공식 advisor 문서): 위임이 많으면 Opus 입력 토큰이 늘어난다",
                      "대량·정형 서브에이전트 작업은 Haiku(explorer)로 보낸다",
                      "AO 워커·리뷰어 모델은 AO 프로젝트 설정(--model, --reviewer)이며 AO 출력에는 실제 사용 모델 필드가 없다"]}


def features(root):
    s = _settings(root)
    p = s.get("permissions", {})
    hooks = [h.get("command", "") for e in s.get("hooks", {}).get("PreToolUse", []) for h in e.get("hooks", [])]
    skills = []
    for d in sorted((root / "claude" / "skills").glob("*/SKILL.md")):
        m = _fm(_read(d))
        skills.append({"name": m.get("name", d.parent.name), "desc": m.get("description", "")[:600]})
    scripts = []
    for f in sorted((root / "scripts").glob("*.sh")):
        head = [l[1:].strip() for l in _read(f).split("\n")[1:6] if l.startswith("#")]
        scripts.append({"name": f.name, "desc": (head[0] if head else "")[:600]})
    routine = [re.sub(r"\s+", " ", l)[:300] for l in _read(root / "claude" / "routines" / "daily-update.md").split("\n") if re.match(r"^\d+[a-z]?\.\s", l)]
    deny = p.get("deny", [])
    cat = {"파괴적 rm": len([r for r in deny if "rm -" in r]), "force push": len([r for r in deny if "push" in r]),
           "reset/clean/checkout/restore": len([r for r in deny if re.search(r"reset|clean|checkout|restore", r)]),
           "비밀 읽기(Read)": len([r for r in deny if r.startswith("Read(")])}
    return {"hooks": hooks, "deny": len(deny), "ask": len(p.get("ask", [])), "mode": p.get("defaultMode"), "denyKinds": cat,
            "agents": [a["name"] for a in agents(root)], "skills": skills, "scripts": scripts, "routine": routine,
            "plugins": [k for k, v in s.get("enabledPlugins", {}).items() if v], "statusLine": bool(s.get("statusLine")),
            "dashboard": ["활동·실시간 이벤트", "AO 워커", "변경 이력(PR)", "점검과 알림", "프로젝트 셋업", "사이드 탭 7종"]}


def practices(root, config, verify_counts):
    """Each item: what, source doc, level, evidence. Computed from files, not from claims."""
    items = []

    def add(src, what, ok, ev, level=None):
        items.append({"src": src, "what": what, "level": level or ("ok" if ok else "bad"), "evidence": ev})
    s = _settings(root)
    p = s.get("permissions", {})
    n = len(_read(root / "claude" / "CLAUDE.md").replace("\r", "").rstrip("\n").split("\n"))
    add("memory", "전역 CLAUDE.md 200줄 이하", n <= 200, f"{n}줄")
    add("permissions", "deny 규칙이 있다", bool(p.get("deny")), f"deny {len(p.get('deny', []))}, ask {len(p.get('ask', []))}")
    add("permissions", "비밀 파일 Read를 deny한다", any(r.startswith("Read(") and ".env" in r for r in p.get("deny", [])), "Read(**/.env*) 포함 여부")
    rules = p.get("deny", []) + p.get("ask", [])
    bash = [r for r in rules if r.startswith("Bash(") and not r.startswith("Bash(rtk ")]
    twins = [r for r in bash if r.replace("Bash(", "Bash(rtk ", 1) not in rules]
    add("permissions", "모든 Bash 규칙에 rtk 짝이 있다(RTK가 명령을 다시 쓰므로)", not twins, f"짝 없는 규칙 {len(twins)}개")
    add("permission-modes", "기본 모드 bypassPermissions + deny/ask 유지(2026-10-10 결정)", p.get("defaultMode") == "bypassPermissions", str(p.get("defaultMode")))
    hooks = [h.get("command", "") for e in s.get("hooks", {}).get("PreToolUse", []) for h in e.get("hooks", [])]
    g = (root / "claude" / "hooks" / "secret-guard.sh").is_file() and any("secret-guard.sh" in h for h in hooks)
    add("hooks", "secret-guard 훅이 파일로 있고 설정에서 참조된다", g, f"PreToolUse 훅 {len(hooks)}개")
    add("hooks", "훅 경로에 머신 경로 하드코딩이 없다", all("CLAUDE_CONFIG_DIR" in h or h.startswith("rtk ") for h in hooks), "; ".join(h[:60] for h in hooks))
    bad = [a["name"] for a in agents(root) if a["badKeys"]]
    add("sub-agents", "에이전트 frontmatter에 알 수 없는 키가 없다", not bad, ", ".join(bad) or f"{len(agents(root))}개 정상")
    long = []
    for d in (root / "claude" / "skills").glob("*/SKILL.md"):
        m = _fm(_read(d))
        if len(m.get("description", "")) > 1536 or m.get("name") != d.parent.name:
            long.append(d.parent.name)
    add("skills", "스킬 name=디렉터리, description 1536자 이하", not long, ", ".join(long) or "전부 정상")
    add("settings", "저장소 settings.json에 머신 전용 env가 없다", "env" not in s, "env 키 " + ("있음" if "env" in s else "없음"))
    try:
        live = json.loads(_read(config / "settings.json"))
        same = {k: v for k, v in live.items() if k != "env"} == {k: v for k, v in s.items() if k != "env"}
        add("settings", "적용본(~/.claude)이 저장소와 같다(env 제외)", same, "일치" if same else "차이 있음: apply.sh 필요")
    except Exception:
        add("settings", "적용본(~/.claude)이 저장소와 같다(env 제외)", False, "적용본을 읽지 못함", "warn")
    c = verify_counts or {}
    add("best-practices", "verify.sh --live 결과", c.get("FAIL", 0) == 0, f"PASS {c.get('PASS', 0)} · FAIL {c.get('FAIL', 0)} · WARN {c.get('WARN', 0)}")
    return items


def _kind(text):
    if "secret-guard: blocked" in text:
        return "hook-block"
    if re.search(r"hook (error|failed)|PreToolUse:.*error", text, re.I):
        return "hook-error"
    if re.search(r"denied|permission|not allowed|requires approval|blocked", text, re.I):
        return "permission"
    return "tool-error"


def debug(session_file):
    """Classified tool errors of the newest session log. Text is matched in memory; only kind, tool and times leave."""
    out = {"errors": [], "counts": {}, "tools": {}, "scanned": 0}
    if not session_file:
        return out
    try:
        with open(session_file, "rb") as fh:
            fh.seek(0, 2)
            size = fh.tell()
            fh.seek(max(0, size - 3_000_000))
            raw = fh.read().decode("utf-8", errors="replace").splitlines()
    except Exception:
        return out
    names = {}
    for line in raw:
        try:
            d = json.loads(line)
        except Exception:
            continue
        c = (d.get("message") or {}).get("content")
        if not isinstance(c, list):
            continue
        for x in c:
            if x.get("type") == "tool_use":
                names[x.get("id")] = str(x.get("name", "?")).split("__")[-1]
            elif x.get("type") == "tool_result":
                out["scanned"] += 1
                if not x.get("is_error"):
                    continue
                body = x.get("content")
                text = body if isinstance(body, str) else " ".join(str(y.get("text", "")) for y in body if isinstance(y, dict)) if isinstance(body, list) else ""
                k = _kind(text)
                tool = names.get(x.get("tool_use_id"), "?")
                detail = ""
                if k == "hook-block":
                    m = re.search(r"included:(.*)", text)
                    pat = re.compile(r"^(\.credentials|\.env($|\.)|\.claude\.json$|history\.jsonl$|id_rsa)|\.pem$", re.I)
                    files = [os.path.basename(t) for t in (m.group(1).split()[:4] if m else [])]
                    detail = ", ".join(n for n in files if pat.search(n))  # only secret-looking names leave, never other words
                out["counts"][k] = out["counts"].get(k, 0) + 1
                out["tools"][tool] = out["tools"].get(tool, 0) + 1
                out["errors"].append({"at": d.get("timestamp"), "tool": tool, "kind": k, "detail": detail})
    out["errors"] = out["errors"][-60:]
    return out
