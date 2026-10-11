#!/usr/bin/env python3
"""Unit tests for the dashboard logic that the shape checks in qa-dashboard.sh cannot see. No model calls, no network beyond 127.0.0.1.
Usage: python3 scripts/qa-dashboard-unit.py   (run first by scripts/qa-dashboard.sh)
Covers: the project checks on 29 fixture projects against scripts/qa-dashboard-golden.json (run with --update-golden after a deliberate change), settings() with a missing / broken live file, safe_command (what may leave the machine), the .mcp.json token detector,
TtlCache (single flight, failing sources), the AO PR field allow-list, a log with odd lines, and the HTTP guards (bad token, a failing source)."""
import http.client, json, os, shutil, subprocess, sys, tempfile, threading, time
from http.server import ThreadingHTTPServer
from pathlib import Path

tmp = Path(tempfile.mkdtemp(prefix="dash-unit-"))
cfg = tmp / "cfg"
cfg.mkdir()
os.environ["CLAUDE_CONFIG_DIR"] = str(cfg)
os.environ["HOME"] = os.environ["USERPROFILE"] = str(tmp)
sys.path.insert(0, str(Path(__file__).resolve().parent / "dashboard"))
import server
from cache import TtlCache

fails = []


def check(ok, name, detail=""):
    print(("PASS  " if ok else "FAIL  ") + name + ("" if ok else f" - {detail}"))
    if not ok:
        fails.append(name)


# ---- project checks: exact output on fixture projects (golden file) ----
def fixtures(base):
    """29 small projects, each built to trigger (or not trigger) one rule of the project checks."""
    made = {}
    def mk(name, files=None, git=False):
        d = base / name
        d.mkdir(parents=True)
        for rel, txt in (files or {}).items():
            f = d / rel
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_text(txt, encoding="utf-8")
        if git:
            env = dict(os.environ, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@t", GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@t")
            for cmd in (["init", "-q", "."], ["add", "-f", "."], ["commit", "-q", "-m", "x"]):
                subprocess.run(["git", *cmd], cwd=d, env=env, check=True, capture_output=True)
        made[name] = d
    ok_settings = json.dumps({"permissions": {"deny": ["Read(**/.env*)"]}})
    ignore = "CLAUDE.local.md\n.claude/settings.local.json\n"
    lines = lambda n, w="rule": "".join(f"{w} {i}\n" for i in range(n))
    mk("empty")
    mk("plain_claude", {"CLAUDE.md": "# p\nrun npm test\n"})
    mk("agents_only", {"AGENTS.md": "# a\n"})
    mk("agents_local", {"AGENTS.md": "# a\n", "CLAUDE.local.md": "mine\n"})
    mk("both_copy", {"AGENTS.md": "# a\nsame\n", "CLAUDE.md": "# a\n\nsame\n"})
    mk("both_thin", {"AGENTS.md": "# a\nbook\n", "CLAUDE.md": "see AGENTS.md\n"})
    mk("both_bad", {"AGENTS.md": "# a\nbook\n", "CLAUDE.md": "# c\nother\n"})
    mk("both_import", {"AGENTS.md": "# a\n", "CLAUDE.md": "@AGENTS.md\nextra\n"})
    mk("import_in_fence", {"AGENTS.md": "# a\n", "CLAUDE.md": "```\n@AGENTS.md\n```\n"})
    mk("long_claude", {"CLAUDE.md": lines(250)})
    mk("long_agents", {"AGENTS.md": lines(250)})
    mk("placeholders", {"CLAUDE.md": "[REPLACE: a]\n[REPLACE: b] [REPLACE: c]\n"})
    mk("settings_ok", {"CLAUDE.md": "npm test\n", ".claude/settings.json": ok_settings, ".gitignore": ignore, "package.json": '{"scripts":{"test":"x"}}'})
    mk("settings_bypass", {"CLAUDE.md": "x\n", ".claude/settings.json": json.dumps({"permissions": {"defaultMode": "bypassPermissions", "deny": [], "allow": ["Bash(rm -rf x)", "Bash(git push)", "Bash(npm install)", "Bash(npm test)", 5]}})})
    mk("settings_invalid", {"CLAUDE.md": "x\n", ".claude/settings.json": "{bad"})
    mk("settings_badtypes", {"CLAUDE.md": "x\n", ".claude/settings.json": json.dumps({"permissions": "oops", "hooks": 5})})
    mk("gitignore_local_files", {"CLAUDE.md": "x\n", "CLAUDE.local.md": "m\n", ".claude/settings.json": ok_settings})
    mk("git_tracked_env", {"CLAUDE.md": "x\n", ".env": "A=1\n", ".env.production": "B=2\n", ".env.example": "C=3\n", "CLAUDE.local.md": "m\n",
                           ".mcp.json": json.dumps({"mcpServers": {"s": {"env": {"API_KEY": "abcdefghijklmnop"}}}})}, git=True)
    mk("mcp_invalid", {"CLAUDE.md": "x\n", ".mcp.json": "{bad"})
    mk("mcp_clean", {"CLAUDE.md": "x\n", ".mcp.json": json.dumps({"mcpServers": {"s": {"env": {"API_KEY": "${API_KEY}"}}}})})
    mk("scripts_unmentioned", {"CLAUDE.md": "build it\n", "package.json": '{"scripts":{"test":"x","lint":"y","build":"z"}}', "Makefile": "check:\n\ttrue\n"})
    mk("scripts_mentioned", {"CLAUDE.md": "run npm test and lint\n", "package.json": '{"scripts":{"test":"x","lint":"y"}}'})
    mk("ci_only", {"CLAUDE.md": "x\n", ".github/workflows/ci.yml": "name: ci\n"})
    mk("tool_pyproject", {"CLAUDE.md": "x\n", "pyproject.toml": "[project]\n"})
    mk("docker_nomention", {"CLAUDE.md": "x\n", "docker-compose.yml": "services: {}\n", "package.json": '{"scripts":{"test":"x"}}'})
    mk("docker_mention", {"CLAUDE.md": "run tests in the container with npm test\n", "docker-compose.yml": "services: {}\n", "package.json": '{"scripts":{"test":"x"}}'})
    mk("rtk_twins", {"CLAUDE.md": "x\n", ".claude/settings.json": json.dumps({"permissions": {"deny": ["Read(**/.env*)", "Bash(rm -rf /)", "Bash(rtk rm -rf /)", "Bash(git push -f)"], "ask": ["Bash(git push)"], "allow": ["Bash(ls)", 7]}})})
    mk("skills_bad", {"CLAUDE.md": "x\n", ".claude/skills/long/SKILL.md": "---\nname: l\ndescription: d\n---\n" + lines(600), ".claude/skills/nodesc/SKILL.md": "---\nname: n\n---\nbody\n"})
    mk("hooks_missing", {"CLAUDE.md": "x\n", "scripts/here.sh": "true\n", ".claude/settings.json": json.dumps({"permissions": {"deny": ["Read(**/.env*)"]}, "hooks": {"PreToolUse": [{"hooks": [
        {"type": "command", "command": "bash \"$CLAUDE_PROJECT_DIR/scripts/gone.sh\""}, {"type": "command", "command": "bash $CLAUDE_PROJECT_DIR/scripts/here.sh"},
        {"type": "command", "command": "bash $CLAUDE_PROJECT_DIR/../x.sh"}, "junk"]}, "junk"]}})})
    return made


golden_path = Path(__file__).resolve().parent / "qa-dashboard-golden.json"
real_which = shutil.which
got = {}
fx = fixtures(tmp / "projects")
for mode in ("rtk", "nortk"):
    shutil.which = (lambda n, *a, **k: "/usr/bin/rtk" if n == "rtk" else real_which(n, *a, **k)) if mode == "rtk" else (lambda n, *a, **k: None if n == "rtk" else real_which(n, *a, **k))
    for name, d in fx.items():
        got[f"{name}|{mode}"] = server.project_setup(d)
shutil.which = real_which
if "--update-golden" in sys.argv:
    golden_path.write_text(json.dumps(got, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"wrote {golden_path} ({len(got)} cases)")
want = json.loads(golden_path.read_text(encoding="utf-8")) if golden_path.is_file() else {}
bad = [k for k in sorted(set(got) | set(want)) if got.get(k) != want.get(k)]
check(not bad, f"project checks match the golden file on {len(fx)} fixture projects x 2 (rtk on / off)", ", ".join(bad[:5]) or "golden file missing: run with --update-golden")
check(sum(len(v.get("checks", [])) for v in got.values()) > 100 and len({c["what"].split(" (")[0] for v in got.values() for c in v.get("checks", [])}) >= 20,
      "the fixtures reach at least 20 different findings (the golden file is not trivially empty)")

# ---- settings(): the live file is its own state ----
def live(text):
    p = cfg / "settings.json"
    if text is None:
        p.unlink(missing_ok=True)
    else:
        p.write_text(text, encoding="utf-8")
    return server.settings()


s = live(None)
check(s.get("liveMissing") is True and s.get("deny", 0) > 0 and "tune" in s and "liveTune" in s and "plugins" in s and "livePlugins" in s,
      "settings(): no live file -> liveMissing, repo half and all keys still present", s)
check(live("{bad").get("liveMissing") is True, "settings(): invalid JSON live file -> liveMissing")
check(live("[]").get("liveMissing") is True, "settings(): live JSON that is not an object -> liveMissing")
s = live(json.dumps({"permissions": {"deny": ["a", "b"], "ask": ["c"], "defaultMode": "auto"}, "enabledPlugins": {"x@y": True, "z@y": False}}))
check(s.get("liveMissing") is False and s["liveDeny"] == 2 and s["liveAsk"] == 1 and s["liveMode"] == "auto" and s["livePlugins"] == ["x@y"],
      "settings(): valid live file -> counts, mode and enabled plugins", s)
s = live(json.dumps({"permissions": "oops", "enabledPlugins": []}))
check("liveDeny" in s and s["livePlugins"] == [], "settings(): odd value types do not raise", s)

# ---- safe_command ----
cases = {
    "git log --oneline": "git log",
    "gh pr list": "gh pr",
    "rtk git status": "rtk git",
    "bash scripts/verify.sh --live": "bash verify.sh",
    "bash /Users/john/private-client/deploy.sh --x": "bash deploy.sh",
    "TOKEN=abc123def456 npm test": "npm test",
    "A=1 B=2 git status": "git status",
    "npm ghp_abcdefghijklmnopqrstuvwxyz0123456789": "npm",
    "npm sk-abcdefghijklmnopqrstuvwxyz": "npm",
    "npm AKIAABCDEFGHIJKLMNOP": "npm",
    "git eyJhbGciOiJIUzI1NiJ9abcdef": "git",
    "git " + "a" * 40: "git",
    "curl -H 'Authorization: Bearer x' https://u": "curl",
    "python3 -c 'print(1)'": "python3",
    '"C:\\Program Files\\x.exe" a': "",
    "": "",
    "   ": "",
}
for cmd, want in cases.items():
    got = server.safe_command(cmd)
    check(got == want, f"safe_command({cmd[:44]!r}) == {want!r}", repr(got))

# ---- .mcp.json token detector ----
secret_cases = [
    ("Authorization", "Bearer abcdefghijklmnop1234", True), ("x-api-key", "abcdefghijklmnop", True), ("apiKey", "abcdefghijkl", True),
    ("accessToken", "abcdefghijkl", True), ("API_KEY", "abcdefghijkl", True), ("DB_PASSWORD", "hunter2hunter2", True),
    ("note", "ghp_abcdefghijklmnopqrstuvwxyz0123456789", True), ("X-Amz", "AKIAABCDEFGHIJKLMNOP", True),
    ("API_KEY", "${API_KEY_VALUE}", False), ("API_KEY", "$API_KEY_VALUE", False), ("TOKEN", "short", False),
    ("MODE", "production-mode-xyz", False), ("max_tokens", "123456789012", False), ("API_KEY", 123456789012345, False),
]
for k, v, want in secret_cases:
    check(server.is_literal_secret(k, v) is want, f"is_literal_secret({k!r}, {str(v)[:20]!r}) is {want}")
servers = {"a": {"headers": {"Authorization": "Bearer abcdefghijklmnop1234"}, "env": {"OK": "${X}", "SECRET_X": "abcdefghijklmnop"}}, "b": "oops", "c": {"env": []}}
check(server.literal_secret_count(servers) == 2 and server.literal_secret_count(None) == 0, "literal_secret_count over headers and env, odd shapes tolerated")

# ---- TtlCache ----
c = TtlCache()
calls = []
def boom():
    calls.append(1)
    raise RuntimeError("x")
v1 = c.get("k", 60, boom, slow=True, placeholder="ph")
time.sleep(0.3)
v2 = c.get("k", 60, boom, slow=True, placeholder="ph")
time.sleep(0.2)
check(v1 == "ph" and v2 == "ph" and len(calls) == 1, "TtlCache: a failing slow source serves the placeholder and is retried once per ttl, not every call", (v1, v2, len(calls)))
c = TtlCache()
calls = []
def slowfn():
    calls.append(1)
    time.sleep(0.3)
    return len(calls)
out = []
ts = [threading.Thread(target=lambda: out.append(c.get("n", 60, slowfn))) for _ in range(8)]
[t.start() for t in ts]; [t.join() for t in ts]
check(len(calls) == 1 and len(set(out)) == 1 and len(out) == 8, "TtlCache: 8 concurrent requests share one computation", (len(calls), out))
c = TtlCache()
calls = []
def bad_once():
    calls.append(1)
    raise ValueError("normal source")
try:
    c.get("z", 60, bad_once)
    raised = False
except ValueError:
    raised = True
try:
    c.get("z", 60, bad_once)
except ValueError:
    pass
check(raised and len(calls) == 2, "TtlCache: a failing normal source raises to the caller and caches nothing", (raised, len(calls)))

# ---- AO: only allow-listed PR fields leave ----
def fake_ao(binary, args):
    if args[0] == "status":
        return {"state": "up"}
    if args[0] == "session":
        return {"data": [{"id": "s1", "projectId": "p", "prs": [{"number": 3, "url": "u", "ci": "passing", "state": "OPEN", "title": "SECRET TITLE", "body": "SECRET BODY"}, "junk"], "prompt": "SECRET PROMPT"}]}
    if args[0] == "review":
        return {"reviews": [{"prNumber": 3, "status": "done", "latestRun": {"verdict": "approved", "body": "SECRET REVIEW"}}]}
    return {"projects": []}
server.ao_bin = lambda: "ao"
server.ao_json = fake_ao
ao = server.ao_state()
blob = json.dumps(ao)
pr = ao["sessions"][0]["prs"][0]
check("SECRET" not in blob and set(pr) == {"number", "url", "ci", "state", "reviewStatus", "verdict"} and pr["verdict"] == "approved" and len(ao["sessions"][0]["prs"]) == 1,
      "ao_state(): PR objects carry only the allow-listed fields; prompts, titles and review bodies never leave", blob)

# ---- session log with odd lines / vanished files ----
logdir = cfg / "projects" / "p1"
logdir.mkdir(parents=True)
(logdir / "s.jsonl").write_text("\n".join([
    "[1,2]", '"str"', "not json", '{"timestamp":"t0","type":"user","message":{"content":"hello"}}',
    json.dumps({"timestamp": "t1", "type": "assistant", "message": {"content": ["text", {"type": "tool_use", "name": "Bash", "input": {"command": "TOKEN=abc123def456 git status"}}]}}),
]), encoding="utf-8")
server.PROJECTS = cfg / "projects"
ev = server.session_events()
check([e["target"] for e in ev["events"] if e["kind"] == "tool"] == ["git status"] and "abc123" not in json.dumps(ev), "session_events(): odd lines skipped; no env assignment in any event", ev)
check(server.newest_file([tmp / "gone.jsonl", logdir / "s.jsonl"]) == logdir / "s.jsonl" and server.newest_file([]) is None, "newest_file(): a file that vanished does not raise")

# ---- token compare and HTTP guards ----
check(server.token_ok(server.TOKEN) and not server.token_ok("") and not server.token_ok("\u00e9") and not server.token_ok(server.TOKEN + "x"), "token_ok(): right token only; non-ASCII is a wrong token, not a TypeError")
httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.H)
port = httpd.server_address[1]
threading.Thread(target=httpd.serve_forever, daemon=True).start()
def req(method, path, headers=None, body=None):
    h = http.client.HTTPConnection("127.0.0.1", port, timeout=20)
    h.request(method, path, body=body, headers=headers or {})
    r = h.getresponse()
    data = r.read()
    h.close()
    return r.status, data
st, _ = req("POST", "/api/fix", {"Content-Type": "application/json", "X-Dash-Token": "\u00e9"}, b"{}")
check(st == 403, "POST /api/fix with a non-ASCII token answers 403 (connection not dropped)", st)
st, _ = req("POST", "/api/fix", {"Content-Type": "application/json"}, b"{}")
check(st == 403, "POST /api/fix without a token answers 403", st)
real_state = server.state
server.state = lambda: (_ for _ in ()).throw(RuntimeError("boom"))
st, body = req("GET", "/api/state")
check(st == 500 and json.loads(body).get("ok") is False and json.loads(body).get("msg") == "RuntimeError", "a failing source answers 500 JSON, not a dropped connection", (st, body[:80]))
server.state = real_state
st, body = req("GET", "/api/state")
check(st == 200 and "settings" in json.loads(body), "GET /api/state is healthy again after the failure", st)
httpd.shutdown()

print(f"failures: {len(fails)}")
sys.exit(1 if fails else 0)
