# Unit checks of the dashboard fix allow-list on a throwaway HOME. Usage: python3 scripts/qa-fix.py <repo>
import os, sys, tempfile, json, pathlib
t = tempfile.mkdtemp(prefix="fx")
os.environ["USERPROFILE"] = os.environ["HOME"] = t
os.environ["CLAUDE_MEM_DIR"] = t + "/mem"
sys.path.insert(0, sys.argv[1] + "/scripts/dashboard")
import server
h = pathlib.Path(t)
for i in range(6): (h / f".claude-backup-20261011-00000{i}").mkdir()
(h / ".claude-backup-notes").mkdir()           # wrong name: must never be a target
(h / "mem").mkdir(); (h / "mem/settings.json").write_text('{"CLAUDE_MEM_REDACT_ENABLED":"false","X":"1"}')
pv = server.fix_preview("prune-backups"); assert len(pv["targets"]) == 3 and ".claude-backup-notes" not in pv["targets"], pv
assert not server.fix_apply("prune-backups", ["x"])["ok"]                       # stale/foreign list refused
assert not server.fix_apply("rm-rf", [])["ok"] and server.fix_preview("rm-rf") is None  # unknown id refused
assert server.fix_apply("prune-backups", pv["targets"])["ok"] and len(server._backups()) == 3
assert (h / ".claude-backup-notes").exists()
r = server.fix_apply("mem-redact-on", ["~/.claude-mem/settings.json"]); assert r["ok"], r
d = json.loads((h / "mem/settings.json").read_text()); assert d == {"CLAUDE_MEM_REDACT_ENABLED": "true", "X": "1"}, d
assert len(list((h / "mem").glob("settings.json.bak-*"))) == 1
assert server.fix_preview("mem-redact-on")["targets"] == []                      # already on: nothing to do
print("fix tests ok")
