# Unit checks of the dashboard fix allow-list on a throwaway HOME. Usage: python3 scripts/qa-fix.py <repo>
import os, sys, tempfile, json, pathlib
t = tempfile.mkdtemp(prefix="fx")
os.environ["USERPROFILE"] = os.environ["HOME"] = t
os.environ["CLAUDE_MEM_DIR"] = t + "/mem"
sys.path.insert(0, sys.argv[1] + "/scripts/dashboard")
import server
from fixes import Fix, FixRegistry
h = pathlib.Path(t)
(h / "mem").mkdir(); (h / "mem/settings.json").write_text('{"CLAUDE_MEM_REDACT_ENABLED":"false","X":"1"}')
# registry rules on a dummy fix: a confirmed list must equal the current preview, unknown ids never run, run() gets the preview's targets
class Dummy(Fix):
    id = "dummy"
    calls = []
    def preview(self): return {"title": "d", "targets": ["a", "b"], "reversible": True}
    def run(self, targets): self.calls.append(targets); return {"ok": True, "msg": "ok"}
reg = FixRegistry(); dummy = reg.register(Dummy())
assert not reg.apply("dummy", ["x"])["ok"] and dummy.calls == []                  # stale/foreign list refused
assert not reg.apply("rm-rf", [])["ok"] and reg.preview("rm-rf") is None          # unknown id refused
assert reg.apply("dummy", ["b", "a"])["ok"] and dummy.calls == [["a", "b"]], dummy.calls
assert sorted(server.FIXES._fixes) == ["mem-redact-on", "rtk-update"], sorted(server.FIXES._fixes)  # nothing else can ever run
r = server.FIXES.apply("mem-redact-on", ["~/mem/settings.json"]); assert r["ok"], r  # the CLAUDE_MEM_DIR file, shown under ~
d = json.loads((h / "mem/settings.json").read_text()); assert d == {"CLAUDE_MEM_REDACT_ENABLED": "true", "X": "1"}, d
assert len(list((h / "mem").glob("settings.json.bak-*"))) == 1
assert server.FIXES.preview("mem-redact-on")["targets"] == []                      # already on: nothing to do
# rtk-update: runs only the fixed installer command, only for the confirmed target, and never the real one in this test
seen = []
class P:  returncode = 0
rtk = server.FIXES._fixes["rtk-update"]
rtk.latest = lambda: "v99.0.0"; server.CACHE.drop("rtk_latest")
rtk.installer = lambda: ["fake-installer", "--x"]
rtk.runner = type("R", (), {"run": staticmethod(lambda cmd, timeout=60: "rtk 1.0.0"), "spawn": staticmethod(lambda cmd, timeout=60, cwd=None: (seen.append(cmd), P())[1])})
pv = server.FIXES.preview("rtk-update"); assert len(pv["targets"]) == 1 and "fake-installer" in pv["targets"][0], pv
assert not server.FIXES.apply("rtk-update", ["rtk 1.0.0 -> v9: other"])["ok"] and seen == []
assert server.FIXES.apply("rtk-update", pv["targets"])["ok"] and seen == [["fake-installer", "--x"]], seen
print("fix tests ok")
