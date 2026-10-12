#!/usr/bin/env python3
"""Unit tests for scripts/toolreg.py and scripts/bootstrap.py. No network, no installs; a scratch repo with its own tools.json.
Usage: python3 scripts/qa-bootstrap.py"""
import json, os, sys, tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import toolreg, bootstrap

fails = []


def check(ok, name, detail=""):
    print(("PASS  " if ok else "FAIL  ") + name + ("" if ok else f" - {detail}"))
    if not ok:
        fails.append(name)


tmp = Path(tempfile.mkdtemp(prefix="boot-unit-"))
repo = tmp / "repo"
(repo / "state").mkdir(parents=True)
for k in ("QA_BIN", "QA_DIR", "PROJECT_ROOTS"):
    os.environ.pop(k, None)


def mkcheckout(d):
    (d / "scripts").mkdir(parents=True, exist_ok=True)
    (d / "scripts" / "setup.py").write_text("", encoding="utf-8")
    (d / "manifest.json").write_text("{}", encoding="utf-8")
    return d


ENTRY = {"id": "qa", "label": "QA", "kind": "tool", "required": True, "bin": ["no-such-bin-qa-xyz"], "env": "QA_BIN",
         "version": ["--version"], "min": "3.0", "install": {"winget": "QA.Tool", "brew": "qatool", "url": "https://example.invalid"},
         "setup": {"repo": "https://example.invalid/qa", "env": "QA_DIR", "legacy": "state/qa-dir.txt",
                   "candidates": ["${DOCUMENTS}/글로벌 셋업/qa", "${REPO_PARENT}/qa"], "marker": ["scripts/setup.py", "manifest.json"]}}
toks = {"HOME": str(tmp), "DOCUMENTS": str(tmp / "docs"), "REPO": str(repo), "REPO_PARENT": str(tmp)}

# ---- tokens ----
check(toolreg.expand("${REPO_PARENT}/x", toks) == tmp / "x", "expand: known token")
check(toolreg.expand("${LOCALAPPDATA}/x", toks) is None, "expand: a token this machine lacks drops the candidate")
check(toolreg.documents_dir().name != "", "documents_dir returns a folder name")

# ---- versions ----
check(toolreg.parse_version("git version 2.55.0.windows.4") == "2.55.0", "parse_version: git")
check(toolreg.parse_version("v22.23.3") == "22.23.3", "parse_version: node v-prefix")
check(toolreg.parse_version("2.1.296 (Claude Code)") == "2.1.296", "parse_version: claude")
check(toolreg.parse_version("built 2026 version 1.2.3") == "1.2.3", "parse_version: a dotted version beats an earlier bare number")
check(toolreg.version_ok("22.1", "22") and not toolreg.version_ok("21.9.9", "22"), "version_ok: major-only minimum")
check(toolreg.version_ok("2.1.295", "2.1.295") and not toolreg.version_ok("2.1.292", "2.1.295"), "version_ok: patch boundary")
check(not toolreg.version_ok(None, "3.11") and toolreg.version_ok(None, None), "version_ok: unknown version")

# ---- install command per platform ----
check(toolreg.install_command(ENTRY, "win32") == "winget install --id QA.Tool --exact", "install: winget on Windows")
check(toolreg.install_command(ENTRY, "darwin") == "brew install qatool", "install: brew on macOS")
check(toolreg.install_command({"install": {"cask": "c", "brew": "b"}}, "darwin") == "brew install --cask c", "install: cask wins on macOS")
check(toolreg.install_command(ENTRY, "linux").endswith("https://example.invalid"), "install: URL elsewhere")
check(toolreg.install_command({"id": "x"}, "win32") is None, "install: nothing known")

# ---- checkout precedence: env > machine.json > legacy file > candidates ----
cand = mkcheckout(tmp / "docs" / "글로벌 셋업" / "qa")
legacy = mkcheckout(tmp / "legacy-qa")
mach = mkcheckout(tmp / "machine-qa")
envd = mkcheckout(tmp / "env-qa")
d, src, _ = toolreg.find_checkout(ENTRY, {}, toks, repo)
check(d == cand and src.startswith("${DOCUMENTS}"), "checkout: candidate with a non-ASCII path", f"{d} {src}")
(repo / "state" / "qa-dir.txt").write_text(str(legacy) + "\n", encoding="utf-8")
d, src, _ = toolreg.find_checkout(ENTRY, {}, toks, repo)
check(d == legacy and src == "state/qa-dir.txt", "checkout: legacy file beats candidates", f"{d} {src}")
d, src, _ = toolreg.find_checkout(ENTRY, {"checkout": {"qa": str(mach)}}, toks, repo)
check(d == mach and src == "machine.json", "checkout: machine.json beats legacy file", f"{d} {src}")
os.environ["QA_DIR"] = str(envd)
d, src, _ = toolreg.find_checkout(ENTRY, {"checkout": {"qa": str(mach)}}, toks, repo)
check(d == envd and src == "QA_DIR", "checkout: env var beats machine.json", f"{d} {src}")
os.environ["QA_DIR"] = str(tmp / "nowhere")
d, src, _ = toolreg.find_checkout(ENTRY, {}, toks, repo)
check(d == legacy, "checkout: an env var naming no checkout falls through to the next source", f"{d}")
del os.environ["QA_DIR"]
(repo / "state" / "qa-dir.txt").write_text(str(legacy), encoding="utf-16")
d, _, _ = toolreg.find_checkout(ENTRY, {}, toks, repo)
check(d == cand, "checkout: a UTF-16 legacy file is not read as a path", f"{d}")
(repo / "state" / "qa-dir.txt").unlink()
bare = dict(ENTRY, setup=dict(ENTRY["setup"], candidates=["${REPO_PARENT}/absent"]))
d, src, tried = toolreg.find_checkout(bare, {}, toks, repo)
check(d is None and tried and tried[-1][0] == "${REPO_PARENT}/absent", "checkout: none found lists what was tried")

# ---- binaries ----
r = toolreg.detect(ENTRY, {}, toks, repo)
check(not r["found"] and not r["versionOk"] and r["install"], "detect: missing binary is not ok and has an install hint")
os.environ["QA_BIN"] = sys.executable
r = toolreg.detect(ENTRY, {}, toks, repo)
check(r["found"] and r["via"] == "QA_BIN" and r["version"] and r["versionOk"], "detect: env var binary, version read and compared", json.dumps(r))
os.environ["QA_BIN"] = str(tmp / "missing.exe")
r = toolreg.detect(ENTRY, {"bin": {"qa": sys.executable}}, toks, repo)
check(not r["found"] and r["via"] == "QA_BIN", "detect: an env var naming no file is reported as not found, not skipped")
del os.environ["QA_BIN"]
r = toolreg.detect(ENTRY, {"bin": {"qa": sys.executable}}, toks, repo)
check(r["found"] and r["via"] == "machine.json", "detect: machine.json binary")
gui = tmp / "App.exe"
gui.write_text("", encoding="utf-8")
r = toolreg.detect({"id": "g", "bin": ["no-such-bin-g"], "paths": [str(gui)], "version": ["--version"]}, {}, toks, repo)
check(r["found"] and r["via"] == "path" and r["version"] is None and r["versionOk"], "detect: a path candidate is not started to read a version")
r = toolreg.detect(ENTRY, {"disabled": ["qa"]}, toks, repo)
check(r["disabled"], "detect: disabled in machine.json")

# ---- project roots ----
(tmp / "Projects").mkdir()
roots, src = toolreg.project_roots({}, toks, repo)
check(roots == [tmp / "Projects"] and src == "default", "roots: default ~/Projects when nothing is set", f"{roots} {src}")
(repo / "state" / "project-roots.txt").write_text("# comment\n" + str(tmp / "a") + "\n", encoding="utf-8")
roots, src = toolreg.project_roots({}, toks, repo)
check(roots == [tmp / "a"] and src == "state/project-roots.txt", "roots: legacy file, comments skipped")
roots, src = toolreg.project_roots({"projectRoots": [str(tmp / "b")]}, toks, repo)
check(roots == [tmp / "b"] and src == "machine.json", "roots: machine.json beats legacy file")
os.environ["PROJECT_ROOTS"] = str(tmp / "c")
roots, src = toolreg.project_roots({"projectRoots": [str(tmp / "b")]}, toks, repo)
check(roots == [tmp / "c"] and src == "PROJECT_ROOTS", "roots: env var wins")
del os.environ["PROJECT_ROOTS"]

# ---- machine.json: --write keeps values already there, and the file is UTF-8 ----
(repo / "state" / "machine.json").write_text(json.dumps({"checkout": {"qa": "C:/hand/set"}, "projectRoots": ["X"], "disabled": ["cursor"]}), encoding="utf-8")
m = toolreg.write_machine({"checkout": {"qa": str(cand), "other": "D:/글로벌"}, "projectRoots": ["Y"]}, repo)
check(m["checkout"] == {"qa": "C:/hand/set", "other": "D:/글로벌"} and m["projectRoots"] == ["X"] and m["disabled"] == ["cursor"],
      "write_machine: existing values win, new keys are added", json.dumps(m, ensure_ascii=False))
check("글로벌" in (repo / "state" / "machine.json").read_text(encoding="utf-8"), "write_machine: written as UTF-8")
(repo / "state" / "machine.json").write_text("not json", encoding="utf-8")
check(toolreg.load_machine(repo) == {}, "load_machine: a broken file reads as empty")
try:
    toolreg.write_machine({"projectRoots": ["Z"]}, repo)
    check(False, "write_machine: refuses to overwrite a broken file")
except ValueError:
    check((repo / "state" / "machine.json").read_text(encoding="utf-8") == "not json", "write_machine: refuses to overwrite a broken file")

# ---- bootstrap on the real registry ----
reg = toolreg.load_registry()
ids = [e["id"] for e in reg]
check(len(ids) == len(set(ids)), "tools.json: ids are unique")
check(all(e.get("kind") in ("dep", "tool") and e.get("label") for e in reg), "tools.json: every entry has kind and label")
check(all(e["setup"].get("repo") and e["setup"].get("marker") and e["setup"].get("verify") for e in reg if e.get("setup")), "tools.json: every setup has repo, marker and verify")
check(not any(":\\" in json.dumps(e) or "/Users/" in json.dumps(e) or "/home/" in json.dumps(e) for e in reg), "tools.json: no path inside one user's home")
r = bootstrap.collect()
check({"items", "projectRoots", "missingRequired"} <= set(r) and len(r["items"]) == len(reg), "bootstrap.collect: shape")
out = bootstrap.lines({"items": [dict(toolreg.detect(ENTRY, {}, toks, repo))], "projectRoots": [], "projectRootsSource": "default", "missingRequired": ["qa"]})
check(out[0].startswith("MISS qa") and "install: " in out[0], "bootstrap.lines: missing required prints MISS and the install command", out[0])
check(out[-1] == "missing required: qa", "bootstrap.lines: summary names what is missing")
fv = bootstrap.found_values({"items": [{"id": "a", "setup": {"checkout": "P", "source": "${REPO}"}}, {"id": "b", "setup": {"checkout": "Q", "source": "machine.json"}},
                                      {"id": "c", "setup": {"checkout": "S", "source": "QA_DIR", "fromEnv": True}}], "projectRoots": ["R"], "projectRootsSource": "default"})
check(fv == {"checkout": {"a": "P"}, "projectRoots": ["R"]}, "bootstrap.found_values: keeps searched values, not machine.json or env ones", json.dumps(fv))
fv = bootstrap.found_values({"items": [], "projectRoots": ["R"], "projectRootsSource": "PROJECT_ROOTS"})
check("projectRoots" not in fv, "bootstrap.found_values: project roots from an env var are not recorded")
os.environ["QA_DIR"] = str(envd)
check(toolreg.detect(ENTRY, {}, toks, repo)["setup"]["fromEnv"], "detect: a checkout from the env var is marked fromEnv")
del os.environ["QA_DIR"]
stub = dict(ENTRY, env=None, bin=["no-such-bin-qa-xyz", Path(sys.executable).stem])
check(toolreg.detect(stub, {}, toks, repo)["found"], "detect: PATH names are tried in order")

print(("FAIL " + str(len(fails))) if fails else "ALL PASS")
sys.exit(1 if fails else 0)
