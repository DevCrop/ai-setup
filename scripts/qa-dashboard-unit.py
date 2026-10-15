#!/usr/bin/env python3
"""Unit tests for the dashboard logic that the shape checks in qa-dashboard.sh cannot see. No model calls, no network beyond 127.0.0.1.
Usage: python3 scripts/qa-dashboard-unit.py   (run first by scripts/qa-dashboard.sh)
Covers: the Codex setup source (TRACE verify and plan through a stub setup.py), the project checks on 29 fixture projects against scripts/qa-dashboard-golden.json (run with --update-golden after a deliberate change), settings() with a missing / broken live file, safe_command (what may leave the machine), the .mcp.json token detector,
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
import projects
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
        got[f"{name}|{mode}"] = projects.project_setup(d, server.spawn)
shutil.which = real_which
if "--update-golden" in sys.argv:
    golden_path.write_text(json.dumps(got, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"wrote {golden_path} ({len(got)} cases)")
want = json.loads(golden_path.read_text(encoding="utf-8")) if golden_path.is_file() else {}
bad = [k for k in sorted(set(got) | set(want)) if got.get(k) != want.get(k)]
check(not bad, f"project checks match the golden file on {len(fx)} fixture projects x 2 (rtk on / off)", ", ".join(bad[:5]) or "golden file missing: run with --update-golden")
# Windows disks ignore case: "makefile" then names the same file as "Makefile" and its targets must not be counted twice.
_is_file, _read_text = Path.is_file, Path.read_text
mf = fx["scripts_unmentioned"]
Path.is_file = lambda self: True if self.name == "makefile" and (self.parent / "Makefile").exists() else _is_file(self)
Path.read_text = lambda self, *a, **k: _read_text(self.parent / "Makefile" if self.name == "makefile" else self, *a, **k)
try:
    ci_disk = projects.project_setup(mf, server.spawn)
finally:
    Path.is_file, Path.read_text = _is_file, _read_text
check(ci_disk == projects.project_setup(mf, server.spawn), "project checks do not change on a case-insensitive disk (Makefile counted once)")
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

# ---- safe_command: only known programs, known subcommands and this repo's own scripts leave ----
cases = {
    "git log --oneline": "git log", "gh pr list": "gh pr", "rtk git status": "rtk git", "npm test": "npm test", "ls -la": "ls",
    "git\tstatus": "git status", "git.exe status": "git status", "docker run -e SECRET=x img": "docker",
    "bash scripts/verify.sh --live": "bash verify.sh", "python3 scripts/qa-fix.py x": "python3 qa-fix.py",
    "TOKEN=abc123def456 npm test": "npm test", "A=1 B=2 git status": "git status",
    "TOKEN='abc def ghi' ls": "ls", "MSG='fix CANARYsecret now' git commit": "git commit", "TOKEN='unclosed ls": "",
    "bash /Users/john/private-client/deploy.sh --x": "bash", "bash CANARY56client-deploy.sh": "bash", "python3 my_password_is_x.py": "python3",
    "npx CANARY32tool": "npx", "python3 -c 'print(1)'": "python3", "curl -H 'Authorization: Bearer x' https://u": "curl",
    "npm ghp_abcdefghijklmnopqrstuvwxyz0123456789": "npm", "npm sk-abcdefghijklmnopqrstuvwxyz": "npm", "npm abc123def456ghi789": "npm",
    "npm AKIAABCDEFGHIJKLMNOP": "npm", "git eyJhbGciOiJIUzI1NiJ9abcdef": "git", "git " + "a" * 40: "git", "git hunter2": "git",
    "git sk_live_abcdefghijklmnop": "git", "git 123456": "git",
    "./CANARY44 x": "other", "$HOME/x/tool": "other", "password123 git": "other", '"C:\\Program Files\\x.exe" a': "other",
    "": "", "   ": "",
}
for cmd, want in cases.items():
    got = server.safe_command(cmd)
    check(got == want, f"safe_command({cmd[:44]!r}) == {want!r}", repr(got))
import privacy
check(privacy.file_target("C:\\Users\\NAME\\a.txt") == "a.txt" and privacy.file_target("/x/y/b.txt") == "b.txt" and privacy.file_target("dir/") == "dir",
      "file_target(): base name for both path styles, never a directory")

# ---- .mcp.json token detector ----
secret_cases = [
    ("Authorization", "Bearer abcdefghijklmnop1234", True), ("x-api-key", "abcdefghijklmnop", True), ("apiKey", "abcdefghijkl", True),
    ("accessToken", "abcdefghijkl", True), ("API_KEY", "abcdefghijkl", True), ("DB_PASSWORD", "hunter2hunter2", True),
    ("note", "ghp_abcdefghijklmnopqrstuvwxyz0123456789", True), ("X-Amz", "AKIAABCDEFGHIJKLMNOP", True),
    ("API_KEY", "${API_KEY_VALUE}", False), ("API_KEY", "$API_KEY_VALUE", False), ("TOKEN", "short", False),
    ("MODE", "production-mode-xyz", False), ("max_tokens", "123456789012", False), ("API_KEY", 123456789012345, False),
]
for k, v, want in secret_cases:
    check(projects.is_literal_secret(k, v) is want, f"is_literal_secret({k!r}, {str(v)[:20]!r}) is {want}")
for k, v, want in [("Authorization", "Bearer $TOKEN", False), ("Cookie", "session=abcdefghijklmnop", True), ("passwd", "hunter2hunter2", True),
                   ("Signature", "abcdefghijklmnop", True), ("url", "postgres://u:p4ssw0rd@h/db", True), ("url", "https://h/mcp?api_key=abcdefghij1234", True),
                   ("url", "https://mcp.example.com/v1", False), ("note", "uses ${HOME}/x and more text", False)]:
    check(projects.is_literal_secret(k, v) is want, f"is_literal_secret({k!r}, {v[:24]!r}) is {want}")
check(projects.literal_secret_count({"s": {"args": ["--token", "abcdefghijklmnop"]}}) == 1 and projects.literal_secret_count({"s": {"args": ["--token=abcdefghijklmnop"]}}) == 1
      and projects.literal_secret_count({"s": {"args": ["--port", "8080", "x"]}}) == 0 and projects.literal_secret_count({"s": {"url": "https://u:pw12345678@h/x"}}) == 1,
      "literal_secret_count() also reads url and --flag arguments")
servers = {"a": {"headers": {"Authorization": "Bearer abcdefghijklmnop1234"}, "env": {"OK": "${X}", "SECRET_X": "abcdefghijklmnop"}}, "b": "oops", "c": {"env": []}}
check(projects.literal_secret_count(servers) == 2 and projects.literal_secret_count(None) == 0, "literal_secret_count over headers and env, odd shapes tolerated")

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
import cache as _cm
_cm.FAIL_WINDOW = 0.1
time.sleep(0.2)
try:
    c.get("z", 60, bad_once)
except ValueError:
    pass
_cm.FAIL_WINDOW = 2.0
check(raised and len(calls) == 2, "TtlCache: a failing normal source raises to the caller, caches no value and is retried after the failure window", (raised, len(calls)))

import cache as cache_mod
class NoThread:
    def __init__(self, *a, **k): pass
    def start(self): raise RuntimeError("can't start new thread")
real_thread = cache_mod.threading.Thread
cache_mod.threading.Thread = NoThread
c = TtlCache()
v1 = c.get("t", 60, lambda: "real", slow=True, placeholder="ph")
cache_mod.threading.Thread = real_thread
v2 = c.get("t", 60, lambda: "real", slow=True, placeholder="ph")
time.sleep(0.3)
v3 = c.get("t", 60, lambda: "real", slow=True, placeholder="ph")
check(v1 == "ph" and v2 == "ph" and v3 == "real", "TtlCache: a thread that cannot start does not wedge the key", (v1, v2, v3))
c = TtlCache()
calls = []
def slow_fail():
    calls.append(1)
    time.sleep(0.3)
    raise OSError("down")
res = []
def waiter():
    try:
        c.get("f", 60, slow_fail)
    except OSError:
        res.append("raised")
ts = [threading.Thread(target=waiter) for _ in range(5)]
[t.start() for t in ts]; [t.join() for t in ts]
check(len(calls) == 1 and res == ["raised"] * 5, "TtlCache: 5 callers queued behind a failing source share its one failure", (len(calls), res))

# ---- AO: only allow-listed PR fields leave ----
def fake_ao(binary, args):
    if args[0] == "status":
        return {"state": "up"}
    if args[0] == "session":
        return {"data": [{"id": "s1", "projectId": "p", "prs": [{"number": 3, "url": "https://github.com/SECRETORG/repo/pull/3", "ci": "passing", "state": "OPEN", "title": "SECRET TITLE", "body": "SECRET BODY"}, {"number": 4, "ci": {"log": "SECRETNESTED"}}, "junk"], "prompt": "SECRET PROMPT"}]}
    if args[0] == "review":
        return {"reviews": [{"prNumber": 3, "status": "done", "latestRun": {"verdict": "approved", "body": "SECRET REVIEW"}}]}
    return {"projects": []}
server.ao_bin = lambda: "ao"
server.ao_json = fake_ao
ao = server.ao_state()
blob = json.dumps(ao)
pr = ao["sessions"][0]["prs"][0]
check("SECRET" not in blob and set(pr) == {"number", "ci", "state", "reviewStatus", "verdict"} and pr["verdict"] == "approved" and len(ao["sessions"][0]["prs"]) == 2 and ao["sessions"][0]["prs"][1]["ci"] is None,
      "ao_state(): PR objects carry only the allow-listed fields; prompts, titles and review bodies never leave", blob)

# ---- session log with odd lines / vanished files ----
logdir = cfg / "projects" / "p1"
logdir.mkdir(parents=True)
(logdir / "s.jsonl").write_text("\n".join([
    "[1,2]", '"str"', "not json", '{"timestamp":"t","type":"assistant","message":"str"}', '{"timestamp":"t","type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":["x"]}]}}',
    '{"timestamp":"t","type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"C:\\\\Users\\\\NAME\\\\a.txt"}}]}}', '{"timestamp":"t0","type":"user","message":{"content":"hello"}}',
    json.dumps({"timestamp": "t1", "type": "assistant", "message": {"content": ["text", {"type": "tool_use", "name": "Bash", "input": {"command": "TOKEN=abc123def456 git status"}}]}}),
]), encoding="utf-8")
server.PROJECTS = cfg / "projects"
ev = server.session_events()
check([e["target"] for e in ev["events"] if e["kind"] == "tool"] == ["", "a.txt", "git status"] and "abc123" not in json.dumps(ev) and "NAME" not in json.dumps(ev),
      "session_events(): odd lines skipped, nothing but tool name, time and base name/safe command in any event", ev)
check(server.newest_file([tmp / "gone.jsonl", logdir / "s.jsonl"]) == logdir / "s.jsonl" and server.newest_file([]) is None, "newest_file(): a file that vanished does not raise")

# ---- Codex setup (TRACE): codex/ in this repo only, its verify and plan shown as reported ----
import codex
croot = tmp / "c root" / "ai-setup"  # a space in the path, as on Windows user folders
croot.mkdir(parents=True)
cx = codex.CodexSetup(server.RUNNER, croot)
s = cx.state()
check(s["available"] is False and s["tried"] == ["이 레포의 codex/"] and "codex" in s, "codex: no codex/ folder -> not available, lists where it looked", s)
trace = croot / "codex"
(trace / "scripts").mkdir(parents=True)
(trace / "manifest.json").write_text(json.dumps({"version": "9.9.9", "files": []}), encoding="utf-8")
stub = trace / "scripts" / "setup.py"
def stub_says(verify, plan):
    stub.write_text("import json, sys\nout = {'verify': %r, 'plan': %r}[sys.argv[1]]\n"
                    "if isinstance(out, str):\n    sys.stderr.write(out + '\\n'); sys.exit(1)\n"
                    "print(json.dumps(out)); sys.exit(0 if not isinstance(out, dict) or out.get('status') == 'pass' else 1)\n" % (verify, plan), encoding="utf-8")
stub_says({"status": "fail", "errors": ["AGENTS.md", "ownership-hash:guides/rtk.md"], "unmanaged_skill_findings": ["skills/mine/SKILL.md"], "limit": "files only"},
          [{"path": "AGENTS.md", "action": "conflict", "before": "a", "after": "b"}, {"path": "guides/rtk.md", "action": "write"}, {"path": "sol.config.toml", "action": "keep"}])
s = cx.state()
check(s["available"] and s["source"] == "이 레포의 codex/" and s["version"] == "9.9.9", "codex: the codex/ folder of this repo is used", s)
check(s["verify"] == {"status": "fail", "errors": ["AGENTS.md", "ownership-hash:guides/rtk.md"], "errorCount": 2, "unmanaged": ["skills/mine/SKILL.md"], "limit": "files only"} and s["verifyError"] == "",
      "codex: a failed verify (exit 1 with JSON) is shown as TRACE reported it, not as an error", s)
check(s["plan"] == {"counts": {"conflict": 1, "write": 1, "keep": 1}, "changes": [{"path": "AGENTS.md", "action": "conflict"}, {"path": "guides/rtk.md", "action": "write"}], "changeCount": 2}
      and "before" not in json.dumps(s["plan"]), "codex: plan counts every action, lists only changes, drops hashes", s)
stub_says("Interrupted transaction requires recovery", [])
s = cx.state()
check(s["verify"] is None and s["verifyError"] == "Interrupted transaction requires recovery" and s["plan"]["changeCount"] == 0,
      "codex: a setup.py error shows its message, an empty plan shows no changes", s)
s = codex.CodexSetup(server.RUNNER, croot, py_version=(3, 10)).state()
check(s["available"] and "verify" not in s and "3.11" in s["error"], "codex: Python older than 3.11 is reported, setup.py is not run", s)
stub_says({"status": "pass", "errors": 5, "unmanaged_skill_findings": "abc"}, [{"path": 1, "action": "write"}, {"path": "x", "action": "constructor"}, "junk"])
s = cx.state()
check(s["verify"]["errors"] == [] and s["verify"]["unmanaged"] == [] and s["plan"] == {"counts": {"constructor": 1}, "changes": [{"path": "x", "action": "constructor"}], "changeCount": 1},
      "codex: wrong field types from setup.py are dropped, not iterated or raised", s)
stub.write_text("print('not json')\n", encoding="utf-8")
s = cx.state()
check(s["verify"] is None and s["verifyError"] == "exit 0, JSON 아님" and s["plan"] is None, "codex: non-JSON output is an error message, not a crash", s)
stub.write_text("print('[' * 100000)\n", encoding="utf-8")
s = cx.state()
check(s["verify"] is None and s["verifyError"], "codex: deeply nested output does not raise out of state()", s.get("verifyError"))
os.environ["CODEX_BIN"] = str(tmp / "no-such-codex")
check(cx.codex_cli() == {"found": False, "version": None}, "codex: CODEX_BIN naming a missing file is reported as not found")
os.environ.pop("CODEX_BIN", None)
real_find = cx.find
cx.find = lambda *a: (_ for _ in ()).throw(RuntimeError("boom"))
s = cx.state()
check(s["available"] is False and s.get("failed") is True and "RuntimeError" in s["reason"], "codex: an unexpected error becomes a reason on screen, not an endless 'loading'", s)
cx.find = real_find

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

# ---- usage.py: tokens from the logs, de-duplicated by requestId, repriced on the session's main model ----
import usage
ud = tmp / "projects" / "p"
(ud / "s1" / "subagents").mkdir(parents=True)
def _ln(rid, model, **u):
    return json.dumps({"requestId": rid, "message": {"model": model, "usage": u}})
sonnet = dict(input_tokens=1000, output_tokens=2000, cache_read_input_tokens=100000, cache_creation_input_tokens=10000, cache_creation={"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 10000})
(ud / "s1.jsonl").write_text("\n".join([_ln("a", "claude-sonnet-5-5", **sonnet)] * 3 + ["not json", '{"usage": 1}', _ln("z", "gpt-x", input_tokens=5, output_tokens=5)]) + "\n", encoding="utf-8")
(ud / "s1" / "subagents" / "agent-1.jsonl").write_text(_ln("b", "claude-haiku-5-5", input_tokens=2000, output_tokens=500, cache_creation_input_tokens=0) + "\n", encoding="utf-8")
(ud / "s1" / "subagents" / "agent-1.meta.json").write_text(json.dumps({"agentType": "explorer", "model": "haiku"}), encoding="utf-8")
u = usage.collect(tmp / "projects")
sm = u["models"]["claude-sonnet-5-5"]
check(sm["output"] == 2000 and sm["read"] == 100000, "usage: a reply logged three times counts once", sm)
check(abs(sm["costUSD"] - (1000 * 2 + 2000 * 10 + 100000 * 0.10 + 10000 * 4) / 1e6) < 1e-9, "usage: Sonnet cost = list prices x tokens (1h cache write)", sm["costUSD"])
check("other" in u["models"] and u["models"]["other"]["costUSD"] is None, "usage: an unknown model is 'other' and carries no price", list(u["models"]))
hk = usage.price("claude-haiku-5-5", {"input": 2000, "output": 500})
alt = usage.price("claude-sonnet-5-5", {"input": 2000, "output": 500})
check(abs(u["savedUSD"] - (alt - hk)) < 1e-9 and u["sessions"] == 1, "usage: saving = Haiku tokens repriced on the session's main model minus their real cost", u)
check(set(usage.collect_agents(tmp / "projects")) == {"explorer"} and usage.collect_agents(tmp / "projects")["explorer"]["models"] == ["claude-haiku-5-5"], "usage: subagent rows carry the model that really answered")
# BACKLOG C2: a forked or resumed session copies earlier replies into its own file with the same requestId (seen 2026-10-13 with
# claude -p --resume --fork-session); they count once across files
fd = tmp / "forkproj" / "p"
fd.mkdir(parents=True)
(fd / "orig.jsonl").write_text("\n".join([_ln("r1", "claude-sonnet-5-5", input_tokens=10, output_tokens=100), _ln("r2", "claude-sonnet-5-5", input_tokens=10, output_tokens=100)]) + "\n", encoding="utf-8")
(fd / "fork.jsonl").write_text("\n".join([_ln("r1", "claude-sonnet-5-5", input_tokens=10, output_tokens=100), _ln("r2", "claude-sonnet-5-5", input_tokens=10, output_tokens=100), _ln("r3", "claude-sonnet-5-5", input_tokens=10, output_tokens=100)]) + "\n", encoding="utf-8")
fu = usage.collect(tmp / "forkproj")
check(fu["models"]["claude-sonnet-5-5"]["output"] == 300 and fu["sessions"] == 2, "usage: replies copied into a forked session count once", fu["models"])
# the session's main model comes from its full logs: a fork that sorts first must not take the original's main-model replies
sd = tmp / "forkmain" / "p"
(sd / "b-orig" / "subagents").mkdir(parents=True)
(sd / "b-orig.jsonl").write_text("\n".join([_ln("m1", "claude-sonnet-5-5", output_tokens=1000), _ln("m2", "claude-sonnet-5-5", output_tokens=1000)]) + "\n", encoding="utf-8")
(sd / "b-orig" / "subagents" / "agent-x.jsonl").write_text(_ln("h1", "claude-haiku-5-5", output_tokens=500) + "\n", encoding="utf-8")
(sd / "b-orig" / "subagents" / "agent-x.meta.json").write_text(json.dumps({"agentType": "explorer"}), encoding="utf-8")
(sd / "a-fork.jsonl").write_text("\n".join([_ln("m1", "claude-sonnet-5-5", output_tokens=1000), _ln("m2", "claude-sonnet-5-5", output_tokens=1000), _ln("m3", "claude-sonnet-5-5", output_tokens=1000)]) + "\n", encoding="utf-8")
mu = usage.collect(tmp / "forkmain")
want = usage.price("claude-sonnet-5-5", {"output": 500}) - usage.price("claude-haiku-5-5", {"output": 500})
check(abs(mu["savedUSD"] - want) < 1e-9 and mu["models"]["claude-haiku-5-5"]["output"] == 500, "usage: a fork sorting first keeps the original's main model for the saving", mu)
(sd / "a-fork" / "subagents").mkdir(parents=True)
(sd / "a-fork" / "subagents" / "agent-x.jsonl").write_text(_ln("h1", "claude-haiku-5-5", output_tokens=500) + "\n", encoding="utf-8")  # a fork that copied the subagent log
(sd / "a-fork" / "subagents" / "agent-x.meta.json").write_text(json.dumps({"agentType": "explorer"}), encoding="utf-8")
ag = usage.collect_agents(tmp / "forkmain")
check(ag["explorer"]["calls"] == 1 and ag["explorer"]["output"] == 500, "usage: a subagent log copied into a fork counts once per agent row", ag)
(sd / "a-fork" / "subagents" / "agent-x.meta.json").write_text(json.dumps({"agentType": 5}), encoding="utf-8")  # damaged, sorts first
ag = usage.collect_agents(tmp / "forkmain")
check(ag.get("explorer", {}).get("calls") == 1, "usage: a damaged meta file does not hide the valid copy of the same agent", ag)
nd = tmp / "noridproj" / "p"
nd.mkdir(parents=True)
line = json.dumps({"message": {"model": "claude-sonnet-5-5", "usage": {"input_tokens": 1, "output_tokens": 7}}})
(nd / "a.jsonl").write_text(line + "\n", encoding="utf-8"); (nd / "b.jsonl").write_text(line + "\n", encoding="utf-8")
check(usage.collect(tmp / "noridproj")["models"]["claude-sonnet-5-5"]["output"] == 14, "usage: lines without a requestId are not merged across files", usage.collect(tmp / "noridproj"))
check(usage.collect(tmp / "nowhere")["sessions"] == 0 and usage.collect_agents(tmp / "nowhere") == {}, "usage: a missing projects folder is empty, not an error")

import efficiency
(ud / "s1" / "subagents" / "agent-2.meta.json").write_text(json.dumps({"agentType": "AcmeCorp-internal"}), encoding="utf-8")
(ud / "s1" / "subagents" / "agent-2.jsonl").write_text(_ln("c", "claude-haiku-5-5", input_tokens=1, output_tokens=1) + "\n", encoding="utf-8")
ue = efficiency.UsageEfficiency(tmp / "projects", lambda: [{"name": "explorer", "model": "haiku"}]).collect()
check("Acme" not in json.dumps(ue) and "other" in [a["name"] for a in ue["data"]["agents"]], "usage: a custom agent type name is shown as 'other', never by name", [a["name"] for a in ue["data"]["agents"]])

# hostile logs: nothing here may raise, and no non-finite or absurd number may reach the output
hd = tmp / "hostile" / "p"
(hd / "s1" / "subagents").mkdir(parents=True)
(hd / "s1.jsonl").write_text("\n".join(['"usage"', "[1,2]", json.dumps({"requestId": ["x"], "message": {"model": "claude-sonnet-5-5", "usage": {"output_tokens": 5}}}),
    json.dumps({"requestId": "r", "message": {"model": ["claude-sonnet-5-5"], "usage": {"output_tokens": 5}}}),
    '{"requestId": "big", "message": {"model": "claude-sonnet-5-5", "usage": {"output_tokens": 1e999, "input_tokens": 1e30, "cache_read_input_tokens": -5}}}',
    _ln("ok", "claude-sonnet-5-5", output_tokens=7)]) + "\n", encoding="utf-8")
(hd / "s1" / "subagents" / "agent-1.meta.json").write_text("[1]", encoding="utf-8")
(hd / "s1" / "subagents" / "agent-2.meta.json").write_text(json.dumps({"agentType": 5}), encoding="utf-8")
try:
    hu, ha = usage.collect(tmp / "hostile"), usage.collect_agents(tmp / "hostile")
    dumped = json.dumps(hu, allow_nan=False) + json.dumps(ha, allow_nan=False)  # raises on NaN or Infinity
    check(hu["models"]["claude-sonnet-5-5"]["output"] == 12 and ha == {}, "usage: damaged lines, odd types and absurd numbers are skipped, never raised or passed on", hu)
except Exception as ex:
    check(False, "usage: damaged logs must not raise", repr(ex))
ue2 = efficiency.UsageEfficiency(tmp / "projects", lambda: []).collect()
check(all(m["value"] == "측정 불가" for m in ue2["metrics"] if m["basis"] == "unavailable"), "usage: an unavailable metric carries no number")

# ---- cost split and the bench comparison source ----
sp = usage.split("claude-sonnet-5-5", {"input": 1000, "write5m": 100, "write1h": 10000, "read": 100000, "output": 2000})
check(sp and abs(sp["read"] - 0.01) < 1e-12 and abs(sp["write"] - (100 * 2.5 + 10000 * 4) / 1e6) < 1e-12 and usage.split("gpt-x", {}) is None, "usage: split prices each kind; both cache-write rates are one 'write'", sp)
check(abs(sum(u["split"].values()) - u["actualUSD"]) < 1e-5, "usage: the split adds up to the actual cost", (u["split"], u["actualUSD"]))
bp = tmp / "bench.json"
be = efficiency.BenchEfficiency(bp).collect()
check(be["data"] is None and be["metrics"][0]["basis"] == "unavailable", "bench: no report yet is 'unavailable', not zeros")
bp.write_text(json.dumps({"generated": "x", "missing": ["ao-r2"], "arms": {"single": {"runs": 3, "costUSD": {"mean": 0.5, "min": 0.4, "max": 0.6, "n": 3}, "wallSec": {"mean": 600}, "scorePct": {"mean": 100}, "split": {"read": 0.3, "write": 0.1, "output": 0.1, "input": 0}, "vsSingle": {"costUSD": 0.0}},
    "evil-arm": {"runs": 1}, "ao": {"runs": "3", "costUSD": {"mean": float("nan")}, "split": {"read": 1e999}}}}).replace("NaN", "1e999"), encoding="utf-8")
be = efficiency.BenchEfficiency(bp).collect()
json.dumps(be, allow_nan=False)
check(set(be["data"]["arms"]) == {"single", "ao"} and be["data"]["arms"]["ao"]["runs"] == 0 and be["data"]["arms"]["ao"]["split"]["read"] == 0, "bench: unknown arms dropped, non-numbers and non-finite values zeroed or nulled", be["data"]["arms"])
check(len(be["metrics"]) == 1 and "빠진 실행 1개" in be["caveats"][0], "bench: one metric per arm with a cost; missing runs are named in the caveats", be["metrics"])
bp.write_text(json.dumps({"arms": {"single": {"runs": 1, "costUSD": {"mean": 1}, "split": {"read": 2, "write": -1}}}}), encoding="utf-8")
check(efficiency.BenchEfficiency(bp).collect()["data"]["arms"]["single"]["split"]["write"] == 0, "bench: a negative split value is clamped to 0")
bp.write_text("{broken", encoding="utf-8")
check(efficiency.BenchEfficiency(bp).collect()["data"] is None, "bench: a damaged report is 'unavailable', never raised")

import inventory
me = inventory.main_effort
check(me({"model": "opus", "effortLevel": "high", "modelSettings": {"claude-opus-5-5": {"effortLevel": "medium"}}}) == "medium", "routing effort: the main model's entry wins over the top-level level")
check(me({"model": "opus", "modelSettings": {"claude-opus-4-6": {"effortLevel": "low"}, "claude-opus-5-5": {"effortLevel": "medium"}}}) == "medium", "routing effort: an alias picks the newest matching entry, not the first")
check(me({"model": "claude-opus-4-6", "modelSettings": {"claude-opus-4-6": {"effortLevel": "low"}, "claude-opus-5-5": {"effortLevel": "medium"}}}) == "low", "routing effort: a full model ID matches only itself")
check(me({"model": "opus[1m]", "effortLevel": "high", "modelSettings": {"claude-opus-5-5": {"effortLevel": "medium"}}}) == "medium", "routing effort: an alias with [1m] matches the same entry")
check(me({"model": "claude-opus-5-5[1M]", "effortLevel": "high", "modelSettings": {"claude-opus-5-5": {"effortLevel": "low"}}}) == "low", "routing effort: a full ID with [1M] matches its entry")
check(me({"model": "OPUS[1M]", "effortLevel": "high", "modelSettings": {"claude-opus-5-5": {"effortLevel": "medium"}}}) == "medium", "routing effort: casing does not matter")
check(me({"model": "claude-opus-5-5", "effortLevel": "high", "modelSettings": {"Claude-Opus-5-5": {"effortLevel": "low"}}}) == "low", "routing effort: a key with capitals still matches")
check(me({"model": "opus", "effortLevel": "high", "modelSettings": {"claude-sonnet-5-5": {"effortLevel": "low"}}}) == "high", "routing effort: no entry for the main model falls back to the top-level level")
odd = [me({"model": "opus", "effortLevel": "high", "modelSettings": v}) for v in ("x", [1], None, {"claude-opus-5-5": "high"}, {"claude-opus-5-5": {"effortLevel": ["x"]}})] + [me({"model": 5, "modelSettings": {}})]
check(odd == ["high"] * 5 + [None], "routing effort: odd types fall back, never raise or pass a non-string through", odd)

# ---- orchestration limits: read from the prose that states them; missing text gives None, never a guessed number ----
lr = Path(tempfile.mkdtemp())
(lr / "claude" / "skills" / "orchestrate").mkdir(parents=True)
(lr / "claude" / "skills" / "orchestrate" / "SKILL.md").write_text("---\nname: x\n---\n5. At most 4 delegates at once, and no two may edit the same file.\n", encoding="utf-8")
(lr / "claude" / "CLAUDE.md").write_text("- Retry limit: three attempts on the same error.\n", encoding="utf-8")
check(inventory.limits(lr) == {"delegates": 4, "retries": 3}, "limits: numbers come from the prose, words too", inventory.limits(lr))
(lr / "claude" / "CLAUDE.md").write_text("nothing here\n", encoding="utf-8")
check(inventory.limits(lr) == {"delegates": 4, "retries": None}, "limits: a missing sentence is None, never a guessed value", inventory.limits(lr))
check(inventory.limits(Path(tempfile.mkdtemp())) == {"delegates": None, "retries": None}, "limits: no files at all is None for both")
real = inventory.limits(Path(__file__).resolve().parent.parent)
check(real["delegates"] == 3 and real["retries"] == 2, "limits: the repo's own prose gives 3 and 2 today", real)

# ---- BACKLOG C1: debug() survives odd log lines (a list, a string message, non-dict content items, unhashable ids) ----
import inventory
dbg_log = tmp / "dbg.jsonl"
dbg_log.write_text("\n".join([
    "[1,2]", '"str"', '{"message":"str"}', '{"message":{"content":["text", 5, null]}}',
    '{"message":{"content":[{"type":"tool_use","id":["x"],"name":"Bash"}]}}',
    '{"message":{"content":[{"type":"tool_result","tool_use_id":{"a":1},"is_error":true,"content":"boom"}]}}',
    json.dumps({"timestamp": "t", "message": {"content": [{"type": "tool_use", "id": "u1", "name": "mcp__x__Read"}]}}),
    json.dumps({"timestamp": "t", "message": {"content": [{"type": "tool_result", "tool_use_id": "u1", "is_error": True, "content": [{"text": "File does not exist"}]}]}}),
]), encoding="utf-8")
try:
    dres = inventory.debug(dbg_log)
    check(dres["scanned"] == 2 and dres["tools"].get("Read") == 1, "debug(): odd lines are skipped, real tool errors still counted", dres)
except Exception as e:
    check(False, "debug(): odd lines are skipped, real tool errors still counted", repr(e))

# ---- BACKLOG C9: a negative Content-Length is refused, not read to EOF ----
httpd2 = ThreadingHTTPServer(("127.0.0.1", 0), server.H)
port2 = httpd2.server_address[1]
threading.Thread(target=httpd2.serve_forever, daemon=True).start()
import socket
sk = socket.create_connection(("127.0.0.1", port2), timeout=5)
sk.sendall(("POST /api/fix HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nContent-Type: application/json\r\nX-Dash-Token: %s\r\nContent-Length: -1\r\n\r\n{}" % (port2, server.TOKEN)).encode())
try:
    first = sk.recv(200).decode("latin-1")
    check(first.startswith("HTTP/1.") and " 400 " in first.split("\r\n")[0], "POST with Content-Length -1 answers 400 at once", first[:40])
except socket.timeout:
    check(False, "POST with Content-Length -1 answers 400 at once", "timed out: the handler is reading to EOF")
sk.close()
server.H.timeout, old_to = 1, server.H.timeout
sk = socket.create_connection(("127.0.0.1", port2), timeout=8)
sk.sendall(("POST /api/fix HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nContent-Type: application/json\r\nX-Dash-Token: %s\r\nContent-Length: 99999\r\n\r\n{}" % (port2, server.TOKEN)).encode())
try:
    sk.recv(200)
    check(True, "an overstated Content-Length times out on the server side, not on the client")
except socket.timeout:
    check(False, "an overstated Content-Length times out on the server side, not on the client", "client waited 8 s")
sk.close()
server.H.timeout = old_to
check(old_to == 10, "the request handler bounds socket reads (timeout 10 s)", old_to)
httpd2.shutdown()

# ---- BACKLOG C13: the dashboard reads project roots as bootstrap does (toolreg.project_roots: env > machine.json > txt > ~/Projects) ----
proot = tmp / "c13repo"
(proot / "state").mkdir(parents=True)
mroot = tmp / "c13roots"
(mroot / "fromjson").mkdir(parents=True)
(proot / "state" / "machine.json").write_text(json.dumps({"projectRoots": [str(mroot)]}), encoding="utf-8")
# its own home: on a case-insensitive disk (Windows) tmp/Projects is the same folder as the fixtures in tmp/projects
chome = tmp / "c13home"
old_pr = os.environ.pop("PROJECT_ROOTS", None)
old_home = os.environ["HOME"], os.environ["USERPROFILE"]
try:
    listed = [p.name for p in projects.discover_projects(proot, tmp / "no-logs")]
    check(listed == ["fromjson"], "discover_projects(): machine.json projectRoots is read when there is no project-roots.txt", listed)
    (proot / "state" / "machine.json").unlink()
    (chome / "Projects" / "fromhome").mkdir(parents=True)
    os.environ["HOME"] = os.environ["USERPROFILE"] = str(chome)
    listed = [p.name for p in projects.discover_projects(proot, tmp / "no-logs")]
    check(listed == ["fromhome"], "discover_projects(): ~/Projects is the default root, as in bootstrap", listed)
finally:
    os.environ["HOME"], os.environ["USERPROFILE"] = old_home
    if old_pr is not None:
        os.environ["PROJECT_ROOTS"] = old_pr

# ---- BACKLOG C10: MemRedactOn offers nothing when its settings file is missing or broken, and names the real file ----
import fixes
memd = tmp / "memdir"
os.environ["CLAUDE_MEM_DIR"] = str(memd)
mr = fixes.MemRedactOn()
check(mr.preview()["targets"] == [], "mem-redact-on: missing settings file is not offered", mr.preview())
memd.mkdir()
(memd / "settings.json").write_text("{broken", encoding="utf-8")
check(mr.preview()["targets"] == [], "mem-redact-on: broken settings file is not offered", mr.preview())
(memd / "settings.json").write_text("[1]", encoding="utf-8")
check(mr.preview()["targets"] == [], "mem-redact-on: a settings file that is not an object is not offered", mr.preview())
(memd / "settings.json").write_text("{}", encoding="utf-8")
pv = mr.preview()
check(pv["targets"] == ["~/memdir/settings.json"] and fixes.MemRedactOn.label() == "~/memdir/settings.json", "mem-redact-on: the preview names the CLAUDE_MEM_DIR file", pv)
r = fixes.FixRegistry(); r.register(mr)
res = r.apply("mem-redact-on", pv["targets"])
check(res["ok"] and json.loads((memd / "settings.json").read_text(encoding="utf-8")).get("CLAUDE_MEM_REDACT_ENABLED") == "true", "mem-redact-on: preview and run agree on that file", res)
del os.environ["CLAUDE_MEM_DIR"]

# ---- BACKLOG S6: a hook path that is absolute, UNC or a drive path never reaches the filesystem ----
import pathlib, types
seen = []
real_exists = pathlib.Path.exists
pathlib.Path.exists = lambda self, *a, **k: (seen.append(str(self)), real_exists(self, *a, **k))[1]
try:
    hooks = {"PreToolUse": [{"hooks": [{"command": c} for c in (
        '"$CLAUDE_PROJECT_DIR//host/share/x.sh"', '"$CLAUDE_PROJECT_DIR/\\\\host\\share\\x.sh"', '"$CLAUDE_PROJECT_DIR/C:/x.sh"',
        '"$CLAUDE_PROJECT_DIR/c:x.sh"', '"$CLAUDE_PROJECT_DIR/missing dir/x.sh"', '"$CLAUDE_PROJECT_DIR/pre+commit@v2.sh"')]}]}
    pd = tmp / "hookproj"; pd.mkdir()
    ctx = types.SimpleNamespace(d=pd, f={}, al="", cl="", perm={}, text="", cfg={"hooks": hooks}, local={})
    got = list(projects.rule_hooks(ctx))
finally:
    pathlib.Path.exists = real_exists
check(not any("host" in p or ":" in p.replace(str(tmp), "") for p in seen), "rule_hooks(): UNC, absolute and drive paths are not passed to exists()", seen)
check(len(got) == 1 and "(2" in got[0]["what"] and any(p.endswith("pre+commit@v2.sh") for p in seen), "rule_hooks(): relative missing scripts count, also names with + and @", got)

# ---- BACKLOG C14: on Windows a binary in the dashboard's current folder is never taken for a tool (codex, ao, rtk, winget) ----
import procs, shutil as _sh
here = tmp / "cwdbin"; here.mkdir(exist_ok=True)
fake = here / "rtk"
fake.write_text("", encoding="utf-8"); fake.chmod(0o755)
real_which, oldcwd, oldpath = _sh.which, os.getcwd(), os.environ.get("PATH", "")
os.chdir(here)
_sh.which = lambda n, *a, **k: str(fake) if n == "rtk" else real_which(n, *a, **k)
try:
    check(procs.which("rtk", windows=True) is None, "procs.which: a hit in the current folder (not on PATH) is refused on Windows")
    check(procs.which("rtk", windows=False) == str(fake), "procs.which: POSIX keeps shutil.which")
    try:
        procs.resolve(["rtk", "--version"], windows=True)
        check(False, "procs.resolve: a bare name found only in the current folder is not started")
    except FileNotFoundError:
        check(True, "procs.resolve: a bare name found only in the current folder is not started")
    os.environ["PATH"] = str(here) + os.pathsep + oldpath
    check(procs.resolve(["rtk", "--version"], windows=True) == [str(fake), "--version"], "procs.resolve: the current folder counts when it is on PATH")
    check(procs.resolve(["/x/y/tool", "a"], windows=True) == ["/x/y/tool", "a"], "procs.resolve: a command with a path is left alone")
    os.environ["PATH"] = oldpath
    # shutil.which is faked for the full path too: on Windows an extension-less file is not executable, and this checks procs' rule only
    _sh.which = lambda n, *a, **k: str(fake) if n in ("rtk", str(fake)) else real_which(n, *a, **k)
    check(procs.which(str(fake), windows=True) == str(fake), "procs.which: an explicit path in the current folder is honoured")
    other = tmp / "pathbin"; other.mkdir(exist_ok=True); good = other / "rtk"; good.write_text("", encoding="utf-8"); good.chmod(0o755)
    os.environ["PATH"] = str(other) + os.pathsep + oldpath
    _sh.which = lambda n, *a, path=None, **k: (str(good) if path == str(other) else None) if path is not None else (str(fake) if n == "rtk" else real_which(n, *a, **k))
    check(procs.which("rtk", windows=True) == str(good), "procs.which: a copy further down PATH is used when the current-folder hit is refused")
finally:
    os.environ["PATH"] = oldpath
    _sh.which = real_which
    os.chdir(oldcwd)
import ast
src = {f.name: (Path(__file__).resolve().parent / "dashboard" / f.name).read_text(encoding="utf-8") for f in (Path(__file__).resolve().parent / "dashboard").glob("*.py")}
direct = [n for n, t in src.items() if n != "procs.py" and "shutil.which(" in t]
check(direct == [], "dashboard modules look tools up through procs.which, not shutil.which", direct)
check(procs.which is procs.toolreg.which and "def which" not in src["procs.py"], "procs.which is toolreg.which (one implementation)")
# toolreg.detect/run_version start a process without the dashboard's no-console spawn, and qa-spawn-guard only scans dashboard/
unguarded = [n for n, t in src.items() if "toolreg.detect" in t or "run_version" in t]
check(unguarded == [], "dashboard modules do not call toolreg.detect or run_version (they spawn without the no-console guard)", unguarded)

print(f"failures: {len(fails)}")
sys.exit(1 if fails else 0)
