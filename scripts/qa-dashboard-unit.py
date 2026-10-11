#!/usr/bin/env python3
"""Unit tests for the dashboard logic that the shape checks in qa-dashboard.sh cannot see. No model calls, no network beyond 127.0.0.1.
Usage: python3 scripts/qa-dashboard-unit.py   (run first by scripts/qa-dashboard.sh)
Covers: settings() with a missing / broken live file, safe_command (what may leave the machine), the .mcp.json token detector,
TtlCache (single flight, failing sources), the AO PR field allow-list, a log with odd lines, and the HTTP guards (bad token, a failing source)."""
import http.client, json, os, sys, tempfile, threading, time
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
