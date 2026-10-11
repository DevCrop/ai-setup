# Unit checks of the dashboard fix allow-list on a throwaway HOME. Usage: python3 scripts/qa-fix.py <repo>
import os, sys, tempfile, json, pathlib
t = tempfile.mkdtemp(prefix="fx")
os.environ["USERPROFILE"] = os.environ["HOME"] = t
os.environ["CLAUDE_MEM_DIR"] = t + "/mem"
sys.path.insert(0, sys.argv[1] + "/scripts/dashboard")
import server
from fixes import PruneBackups
h = pathlib.Path(t)
for i in range(6): (h / f".claude-backup-20261011-00000{i}").mkdir()
(h / ".claude-backup-notes").mkdir()           # wrong name: must never be a target
(h / "mem").mkdir(); (h / "mem/settings.json").write_text('{"CLAUDE_MEM_REDACT_ENABLED":"false","X":"1"}')
pv = server.FIXES.preview("prune-backups"); assert len(pv["targets"]) == 3 and ".claude-backup-notes" not in pv["targets"], pv
assert not server.FIXES.apply("prune-backups", ["x"])["ok"]                       # stale/foreign list refused
assert not server.FIXES.apply("rm-rf", [])["ok"] and server.FIXES.preview("rm-rf") is None  # unknown id refused
assert server.FIXES.apply("prune-backups", pv["targets"])["ok"] and len(PruneBackups.backups()) == 3
assert (h / ".claude-backup-notes").exists()
r = server.FIXES.apply("mem-redact-on", ["~/.claude-mem/settings.json"]); assert r["ok"], r
d = json.loads((h / "mem/settings.json").read_text()); assert d == {"CLAUDE_MEM_REDACT_ENABLED": "true", "X": "1"}, d
assert len(list((h / "mem").glob("settings.json.bak-*"))) == 1
assert server.FIXES.preview("mem-redact-on")["targets"] == []                      # already on: nothing to do
# rtk-update: runs only the fixed installer command, only for the confirmed target, and never the real one in this test
seen = []
class P:  returncode = 0
rtk = server.RTK
rtk.latest = lambda: "v99.0.0"; server.CACHE.drop("rtk_latest")
rtk.installer = lambda: ["fake-installer", "--x"]
rtk.runner = type("R", (), {"run": staticmethod(lambda cmd, timeout=60: "rtk 1.0.0"), "spawn": staticmethod(lambda cmd, timeout=60, cwd=None: (seen.append(cmd), P())[1])})
pv = server.FIXES.preview("rtk-update"); assert len(pv["targets"]) == 1 and "fake-installer" in pv["targets"][0], pv
assert not server.FIXES.apply("rtk-update", ["rtk 1.0.0 -> v9: other"])["ok"] and seen == []
assert server.FIXES.apply("rtk-update", pv["targets"])["ok"] and seen == [["fake-installer", "--x"]], seen
print("fix tests ok")
