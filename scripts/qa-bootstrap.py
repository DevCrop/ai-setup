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
check(toolreg.install_command(ENTRY, "win32") == "winget install --id QA.Tool --exact --no-upgrade", "install: winget on Windows, never upgrades")
check(toolreg.install_command(ENTRY, "darwin") == "env HOMEBREW_NO_INSTALL_UPGRADE=1 brew install qatool", "install: brew on macOS, never upgrades")
check(toolreg.install_command({"install": {"cask": "c", "brew": "b"}}, "darwin") == "env HOMEBREW_NO_INSTALL_UPGRADE=1 brew install --cask c", "install: cask wins on macOS")
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

# ---- BACKLOG C3: the "default" project root is not written by --write (it would hide ~/Projects for good once empty) ----
r0 = {"items": [], "projectRoots": [], "projectRootsSource": "default"}
check("projectRoots" not in bootstrap.found_values(r0), "found_values: a default project root is not recorded", bootstrap.found_values(r0))
r0 = {"items": [], "projectRoots": [str(tmp / "a")], "projectRootsSource": "state/project-roots.txt"}
check(bootstrap.found_values(r0).get("projectRoots") == [str(tmp / "a")], "found_values: the legacy file is still migrated")

# ---- BACKLOG C4: a BOM (Notepad, PowerShell 5.1) does not break the first path ----
(repo / "state" / "project-roots.txt").write_text("\ufeff" + str(tmp / "a") + "\n", encoding="utf-8")
roots, src = toolreg.project_roots({}, toks, repo)
check(roots == [tmp / "a"], "roots: a BOM in project-roots.txt is dropped", roots)
import importlib.util
spec = importlib.util.spec_from_file_location("dashprojects", str(Path(__file__).resolve().parent / "dashboard" / "projects.py"))
sys.path.insert(0, str(Path(__file__).resolve().parent / "dashboard"))
dp = importlib.util.module_from_spec(spec); spec.loader.exec_module(dp)
(repo / "state" / "projects.txt").write_text("\ufeff" + str(tmp / "a") + "\n", encoding="utf-8")
os.environ.pop("PROJECT_DIRS", None)
listed = [str(x) for x in dp.project_dirs(repo, tmp / "no-logs")]
check(listed == [str(tmp / "a")], "dashboard projects.txt: a BOM is dropped", listed)
(repo / "state" / "projects.txt").unlink()
(tmp / "a" / "p1").mkdir(parents=True, exist_ok=True)
(repo / "state" / "project-roots.txt").write_text("\ufeff" + str(tmp / "a") + "\n", encoding="utf-8")
os.environ.pop("PROJECT_ROOTS", None)
listed = [str(x) for x in dp.discover_projects(repo, tmp / "no-logs")]
check(listed == [str(tmp / "a" / "p1")], "dashboard project-roots.txt: a BOM is dropped", listed)
(repo / "state" / "project-roots.txt").unlink()

# ---- BACKLOG C5: a git.exe in the current folder is not taken for the tool unless that folder is on PATH ----
here = tmp / "cwdbin"; here.mkdir()
fake = here / ("git.exe" if os.name == "nt" else "git")
fake.write_text("", encoding="utf-8")
real_which, oldcwd = toolreg.shutil.which, os.getcwd()
os.chdir(here)
toolreg.shutil.which = lambda n, *a, **k: str(fake) if n in ("git", "git.exe") else real_which(n, *a, **k)
try:
    check(toolreg.which("git") == str(fake) if os.name != "nt" else True, "which: POSIX keeps shutil.which (it searches the cwd only when PATH asks)")
    # the guard is for Windows, which searches the current folder first
    check(toolreg.which("git", windows=True) is None, "which: a hit in the current folder (not on PATH) is refused")
    os.environ["PATH"] = str(here) + os.pathsep + os.environ.get("PATH", "")
    check(toolreg.which("git", windows=True) == str(fake), "which: the current folder counts when it is on PATH")
finally:
    os.environ["PATH"] = os.environ["PATH"].split(os.pathsep, 1)[1]
    toolreg.shutil.which = real_which
    os.chdir(oldcwd)

# ---- BACKLOG C6: machine.json is replaced in one step (temp file + os.replace) ----
(repo / "state" / "machine.json").write_text("{}", encoding="utf-8")
seen_replace = []
real_replace = toolreg.os.replace
toolreg.os.replace = lambda a, b: (seen_replace.append((str(a), str(b))), real_replace(a, b))[1]
try:
    toolreg.write_machine({"projectRoots": ["W"]}, repo)
finally:
    toolreg.os.replace = real_replace
check(len(seen_replace) == 1 and seen_replace[0][1] == str(repo / "state" / "machine.json") and toolreg.load_machine(repo).get("projectRoots") == ["W"]
      and not list((repo / "state").glob("*.tmp*")), "write_machine: written through a temp file and os.replace", seen_replace)

# ---- BACKLOG C7: wrong types in machine.json are reported and ignored, never a crash ----
bad = {"bin": "x", "checkout": ["y"], "disabled": 5, "projectRoots": "z"}
try:
    r = toolreg.detect(ENTRY, bad, toks, repo)
    roots, src = toolreg.project_roots(bad, toks, repo)
    probs = toolreg.machine_problems(bad)
    check(not r["disabled"] and src != "machine.json" and sorted(p.split(" ")[0] for p in probs) == ["bin", "checkout", "disabled", "projectRoots"],
          "machine.json wrong types: ignored and each bad key reported", probs)
except Exception as e:
    check(False, "machine.json wrong types: ignored and each bad key reported", repr(e))
(repo / "state" / "machine.json").write_text(json.dumps(bad), encoding="utf-8")
(repo / "tools.json").write_text(json.dumps({"tools": [ENTRY]}), encoding="utf-8")
try:
    rep = bootstrap.collect(repo)
    check(len(rep.get("machineProblems", [])) == 4 and any("machine.json" in l for l in bootstrap.lines(rep)), "bootstrap check: bad machine.json values are shown, not a crash", rep.get("machineProblems"))
except Exception as e:
    check(False, "bootstrap check: bad machine.json values are shown, not a crash", repr(e))
(repo / "state" / "machine.json").unlink()
(repo / "tools.json").unlink()
(repo / "state" / "machine.json").write_text(json.dumps({"checkout": ["hand"]}), encoding="utf-8")
m = toolreg.write_machine({"checkout": {"codex": "/x"}, "projectRoots": ["P"]}, repo)
check(m["checkout"] == ["hand"] and m["projectRoots"] == ["P"], "write_machine: a wrong-typed key stays for the user to fix, other keys are added", m)
real_replace = toolreg.os.replace
toolreg.os.replace = lambda a, b: (_ for _ in ()).throw(PermissionError("held open"))
try:
    toolreg.write_machine({"projectRoots": ["Q"]}, repo)
    check(False, "write_machine: a failed swap raises and leaves no temp file")
except PermissionError:
    check(not list((repo / "state").glob("*.tmp")) and json.loads((repo / "state" / "machine.json").read_text(encoding="utf-8"))["projectRoots"] == ["P"],
          "write_machine: a failed swap raises and leaves no temp file")
finally:
    toolreg.os.replace = real_replace
(repo / "state" / "machine.json").unlink()

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
check(fv == {"checkout": {"a": "P"}}, "bootstrap.found_values: keeps searched values, not machine.json, env or default ones", json.dumps(fv))
fv = bootstrap.found_values({"items": [], "projectRoots": ["R"], "projectRootsSource": "PROJECT_ROOTS"})
check("projectRoots" not in fv, "bootstrap.found_values: project roots from an env var are not recorded")
os.environ["QA_DIR"] = str(envd)
check(toolreg.detect(ENTRY, {}, toks, repo)["setup"]["fromEnv"], "detect: a checkout from the env var is marked fromEnv")
del os.environ["QA_DIR"]
# two PATH names both exist: the first is a stub that prints no version (like the Windows Store python3), the second answers
bindir = tmp / "bin"
bindir.mkdir()
for name, body in (("qa-stub-xyz", ""), ("qa-real-xyz", "echo qa 1.2.3")):
    if os.name == "nt":
        (bindir / (name + ".cmd")).write_text("@echo off\r\n" + body + "\r\nexit /b 0\r\n", encoding="utf-8")
    else:
        f = bindir / name
        f.write_text("#!/bin/sh\n" + body + "\nexit 0\n", encoding="utf-8")
        f.chmod(0o755)
calls = []
def spawn(cmd, timeout):
    calls.append(cmd[0])
    import subprocess
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
old_path = os.environ["PATH"]
os.environ["PATH"] = str(bindir) + os.pathsep + old_path
two = dict(ENTRY, env=None, min=None, bin=["qa-stub-xyz", "qa-real-xyz"])
r = toolreg.detect(two, {}, toks, repo, spawn)
os.environ["PATH"] = old_path
check(r["found"] and "qa-real-xyz" in r["path"] and r["version"] == "1.2.3", "detect: a stub first on PATH is skipped for the name that answers --version", json.dumps(r))
check(len(calls) == 2, "detect: each name's version is asked once, through the injected spawn", str(calls))
(repo / "state" / "machine.json").write_text("[]", encoding="utf-8")
try:
    toolreg.write_machine({"projectRoots": ["Z"]}, repo)
    check(False, "write_machine: refuses a file that is valid JSON but not an object")
except ValueError:
    check((repo / "state" / "machine.json").read_text(encoding="utf-8") == "[]", "write_machine: refuses a file that is valid JSON but not an object")

# ---- install / clone / apply / verify / autostart with fake ask and run (nothing is installed or written outside tmp) ----
def item(id_, found=False, required=False, disabled=False, setup=None, label=None, versionOk=True, version=None, min_=None):
    return {"id": id_, "label": label or id_, "found": found, "required": required, "disabled": disabled, "install": None,
            "versionOk": versionOk, "version": version, "min": min_, **({"setup": setup} if setup else {})}

yes, no = (lambda q: True), (lambda q: False)
ran = []
def fake_run(rc=0):
    def f(cmd, cwd=None):
        ran.append((list(map(str, cmd)), cwd))
        return rc
    return f

check(toolreg.install_argv({"install": {"winget": "A.B"}}, "win32") == ["winget", "install", "--id", "A.B", "--exact", "--no-upgrade"], "install_argv: winget argv")
check(toolreg.install_argv({"install": {"url": "u"}}, "win32") is None, "install_argv: URL only gives no argv")
ents = {"a": {"id": "a", "install": {"winget": "A.A"}}, "b": {"id": "b", "install": {"url": "https://x"}}, "c": {"id": "c", "install": {"winget": "C.C"}}}
r = {"items": [item("a", required=True), item("b", required=True), item("c", found=True), item("d", disabled=True)]}
ents["d"] = {"id": "d", "install": {"winget": "D.D"}}
ran.clear()
rc = bootstrap.cmd_install(r, ents, ask=yes, run=fake_run(0), platform="win32")
check(ran == [(["winget", "install", "--id", "A.A", "--exact", "--no-upgrade"], None)], "install: only missing, enabled items with a package are run", str(ran))
check(rc == 1, "install: a required item with only a URL counts as not done")
ran.clear()
rc = bootstrap.cmd_install({"items": [item("a", required=True)]}, ents, ask=no, run=fake_run(0), platform="win32")
check(ran == [] and rc == 1, "install: declining a required item runs nothing and exits 1")
rc = bootstrap.cmd_install({"items": [item("a")]}, ents, ask=yes, run=fake_run(5), platform="win32")
check(rc == 1, "install: a failing installer exits 1")
check(bootstrap.cmd_install({"items": [item("c", found=True)]}, ents, ask=yes, run=fake_run(0)) == 0, "install: nothing missing exits 0")
ran.clear()
rc = bootstrap.cmd_install({"items": [item("c", found=True, required=True, versionOk=False, version="18.0", min_="22")]}, ents, ask=yes, run=fake_run(0), platform="win32")
check(rc == 1 and ran == [], "install: a required item that is too old is reported, not upgraded, and exits 1")
check(toolreg.upgrade_command({"install": {"winget": "A.B"}}, "win32") == "winget upgrade --id A.B --exact"
      and toolreg.upgrade_command({"install": {"cask": "c", "brew": "b"}}, "darwin") == "brew upgrade --cask c"
      and toolreg.upgrade_command({"install": {"brew": "b"}}, "darwin") == "brew upgrade b"
      and toolreg.upgrade_command({"install": {"url": "u"}}, "win32") == "공식 안내: u", "upgrade_command: an upgrade, not the no-upgrade install")
import io, contextlib
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    bootstrap.cmd_install({"items": [item("c", found=True, required=True, versionOk=False, version="18.0", min_="22")]}, ents, ask=yes, run=fake_run(0), platform="win32")
check("upgrade by hand: winget upgrade --id C.C --exact" in buf.getvalue(), "install: a too-old item is told the upgrade command", buf.getvalue())
rc = bootstrap.cmd_install({"items": [item("c", found=True, versionOk=False, version="1", min_="2")]}, ents, ask=yes, run=fake_run(0), platform="win32")
check(rc == 0 and ran == [], "install: an optional item that is too old is reported only")

cl_ent = {"id": "s", "setup": {"repo": "https://example.invalid/s", "candidates": ["${LOCALAPPDATA}/no", "${REPO_PARENT}/clone-s"]}}
ran.clear()
rc = bootstrap.cmd_clone({"items": [item("s", setup={"checkout": None, "repo": "https://example.invalid/s"})]}, {"s": cl_ent}, ask=yes, run=fake_run(0), toks=toks)
check(rc == 0 and ran and ran[0][0] == ["git", "clone", "https://example.invalid/s", str(tmp / "clone-s")], "clone: first usable candidate, git clone", str(ran))
(tmp / "clone-s").mkdir(exist_ok=True)
(tmp / "clone-s" / "x").write_text("x", encoding="utf-8")
ran.clear()
rc = bootstrap.cmd_clone({"items": [item("s", setup={"checkout": None, "repo": "r"})]}, {"s": cl_ent}, ask=yes, run=fake_run(0), toks=toks)
check(rc == 1 and ran == [], "clone: never into a non-empty folder")
(tmp / "clone-f").write_text("x", encoding="utf-8")
cl_f = {"id": "s", "setup": {"repo": "r", "candidates": ["${REPO_PARENT}/clone-f"]}}
rc = bootstrap.cmd_clone({"items": [item("s", setup={"checkout": None, "repo": "r"})]}, {"s": cl_f}, ask=yes, run=fake_run(0), toks=toks)
check(rc == 1 and ran == [], "clone: a file at the target path is refused, not a crash")
rc = bootstrap.cmd_clone({"items": [item("s", setup={"checkout": None, "repo": "r"})]}, {"s": {"id": "s", "setup": {"repo": "r", "candidates": ["${REPO_PARENT}/clone-new"]}}}, ask=no, run=fake_run(0), toks=toks)
check(rc == 1 and ran == [], "clone: declining exits 1")

PLAN = json.dumps([{"path": "a", "action": "keep"}, {"path": "b", "action": "write"}])
check(bootstrap.summarize("trace", 0, PLAN, "")[:2] == ["plan: keep 1, write 1", "  write b"], "summarize: TRACE plan counts and changes")
check(bootstrap.summarize("trace", 1, json.dumps({"status": "fail", "errors": ["e1"]}), "")[0] == "verify: fail, 1 errors", "summarize: TRACE verify")
check(bootstrap.summarize("trace", 1, "boom", "trace")[0].startswith("exit 1, not JSON"), "summarize: non-JSON output is reported")
check(bootstrap.verify_passed("trace", 1, json.dumps({"status": "pass"})) and not bootstrap.verify_passed("trace", 0, "x"), "verify_passed: TRACE status, not exit code")
check(bootstrap.verify_passed("lines", 0, "") and not bootstrap.verify_passed("lines", 1, ""), "verify_passed: lines uses the exit code")
tr = {"id": "t", "setup": {"python": True, "plan": ["scripts/setup.py", "plan"], "apply": ["scripts/setup.py", "apply"], "verify": ["scripts/setup.py", "verify"], "parser": "trace"}}
check(bootstrap.setup_argv(tr, "apply") == [sys.executable, "-B", "scripts/setup.py", "apply"], "setup_argv: python setups run under this interpreter")
sh_ = {"id": "c", "setup": {"apply": ["bash", "scripts/apply.sh"]}}
check(bootstrap.setup_argv(sh_, "apply")[1:] == ["scripts/apply.sh"] and "bash" in bootstrap.setup_argv(sh_, "apply")[0].lower(), "setup_argv: bash is resolved")
caps = []
def fake_capture(out, rc=0):
    def f(cmd, cwd=None):
        caps.append(cmd)
        return rc, out, ""
    return f
ran.clear()
r = {"items": [item("t", setup={"checkout": str(tmp), "repo": "r"}, label="T")]}
rc = bootstrap.cmd_apply(r, {"t": tr}, ask=no, run=fake_run(0), capture=fake_capture(PLAN))
check(ran == [] and caps and caps[-1][-1] == "plan" and rc == 1, "apply: plan is shown, declining runs nothing and exits 1")
rc = bootstrap.cmd_apply(r, {"t": tr}, ask=yes, run=fake_run(0), capture=fake_capture(PLAN))
check(ran and ran[-1][0][-1] == "apply" and ran[-1][1] == str(tmp) and rc == 0, "apply: confirmed apply runs in the checkout")
rc = bootstrap.cmd_apply(r, {"t": tr}, ask=yes, run=fake_run(2), capture=fake_capture(PLAN))
check(rc == 1, "apply: a failing apply exits 1")
ran.clear()
rc = bootstrap.cmd_apply(r, {"t": tr}, ask=yes, run=fake_run(0), capture=fake_capture(PLAN, 3))
check(rc == 1 and ran == [], "apply: a failed plan is not applied and exits 1")
check(bootstrap.cmd_apply({"items": [item("t", setup={"checkout": None, "repo": "r"})]}, {"t": tr}, ask=yes, run=fake_run(0)) == 1, "apply: no checkout exits 1 and points to clone")
rc = bootstrap.cmd_verify(r, {"t": tr}, capture=fake_capture(json.dumps({"status": "pass", "errors": []}), 0))
check(rc == 0, "verify: TRACE pass")
rc = bootstrap.cmd_verify(r, {"t": tr}, capture=fake_capture(json.dumps({"status": "fail", "errors": ["x"]}), 1))
check(rc == 1, "verify: TRACE fail exits 1")

saved = sys.stdin
import io
sys.stdin = io.StringIO("")
check(bootstrap.ask("q") is False, "ask: no terminal means no")
sys.stdin = saved

pyw = tmp / "py" / "pythonw.exe"
pyw.parent.mkdir()
pyw.write_text("", encoding="utf-8")
path, data, undo = bootstrap.autostart_plan("win32", repo=Path("C:/r/claude-global"), python=str(pyw.with_name("python.exe")), appdata=str(tmp / "ad"))
check(path == tmp / "ad" / "Microsoft/Windows/Start Menu/Programs/Startup/claude-dashboard.vbs" and str(pyw).encode() in data and data.startswith(b"'"), "autostart: Windows .vbs in Startup with pythonw")
_, data, _ = bootstrap.autostart_plan("win32", repo=Path("C:/작업/claude-global"), python=str(pyw.with_name("python.exe")), appdata=str(tmp / "ad"))
check(data[:2] == b"\xff\xfe" and "작업" in data.decode("utf-16"), "autostart: a non-ASCII path is written as UTF-16 with BOM (WSH reads that)")
path, why, _ = bootstrap.autostart_plan("win32", repo=Path("C:/r"), python=str(tmp / "nopy" / "python.exe"), appdata=str(tmp / "ad"))
check(path is None and "pythonw" in why, "autostart: no pythonw is refused")
path, data, _ = bootstrap.autostart_plan("darwin", repo=Path("/r/claude-global"), python="/usr/bin/python3", home=str(tmp))
import plistlib
pl = plistlib.loads(data)
check(path == tmp / "Library/LaunchAgents/com.claude-global.dashboard.plist" and pl["RunAtLoad"] and pl["ProgramArguments"][1].endswith("server.py"), "autostart: macOS LaunchAgent plist")
check(bootstrap.autostart_plan("linux")[0] is None, "autostart: other systems are told how to start it by hand")
target = tmp / "as" / "x.vbs"
check(bootstrap.cmd_autostart(ask=no, plan=(target, b"new", "u")) == 1 and not target.exists(), "autostart: declining writes nothing")
check(bootstrap.cmd_autostart(ask=yes, plan=(target, b"new", "u")) == 0 and target.read_bytes() == b"new", "autostart: confirmed write")
check(bootstrap.cmd_autostart(ask=lambda q: 1 / 0, plan=(target, b"new", "u")) == 0, "autostart: same content is unchanged and does not ask")

print(("FAIL " + str(len(fails))) if fails else "ALL PASS")
sys.exit(1 if fails else 0)
