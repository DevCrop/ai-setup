#!/usr/bin/env python3
"""One entry point to set up a machine from tools.json. Standard library only.

Usage: python scripts/bootstrap.py [check|install|apply|verify|autostart] [--write] [--json]
  check      read-only (default): every dependency and tool, its version, its setup checkout, the project roots,
             and the install command for anything missing. Exit 1 when a required item is missing or too old.
    --write  also record what was found in state/machine.json (values already there are kept).
    --json   print the result as JSON instead of lines.
  install    for each missing item: show the winget command, ask y/N, run it. Installed items are skipped, never upgraded.
  apply      for each tool with a setup checkout: show its plan (or dry run), ask, then run that tool's own apply.
  verify     run every setup's own verify and summarize. Read-only.
  autostart  write the dashboard login launcher (Windows Startup .vbs) after showing it and asking.
Everything that writes asks first on the terminal and refuses when stdin is not a terminal (CI, pipes).
Exit codes: 0 ok, 1 something missing, failed or declined, 2 state/machine.json is broken (--write refused), 3 crash.
"""
import argparse, json, os, subprocess, sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE / "dashboard")]
try:
    import toolreg
    from procs import find_bash, ENV
except Exception:  # a broken toolreg.py must exit 3 (crash), not 1 ("required tool missing")
    import traceback
    traceback.print_exc()
    sys.exit(3)


def collect(repo=toolreg.REPO):
    machine, toks = toolreg.load_machine(repo), toolreg.tokens(repo)
    items = [toolreg.detect(e, machine, toks, repo) for e in toolreg.load_registry(repo)]
    roots, rsrc = toolreg.project_roots(machine, toks, repo)
    return {"items": items, "projectRoots": [str(r) for r in roots], "projectRootsSource": rsrc, "machineProblems": toolreg.machine_problems(machine),
            "missingRequired": [i["id"] for i in items if i["required"] and not i["disabled"] and not (i["found"] and i["versionOk"])]}


def status(i):
    if i["disabled"]:
        return "OFF "
    if not i["found"]:
        return "MISS" if i["required"] else "--  "
    return "OK  " if i["versionOk"] else "OLD "


def lines(r):
    out = []
    for i in r["items"]:
        ver = i["version"] or ("?" if i["found"] else "")
        need = (" (needs " + i["min"] + "+)") if i["min"] and i["found"] and not i["versionOk"] else ""
        where = (i["path"] + " [" + i["via"] + "]") if i["found"] else ("install: " + i["install"] if i["install"] else "not found")
        out.append("%s %-7s %-10s %s%s" % (status(i), i["id"], ver, where, need))
        s = i.get("setup")
        if s:
            out.append("       setup " + (s["checkout"] + " [" + s["source"] + "]" if s["checkout"]
                                        else "not found; tried " + " > ".join(s["tried"]) + ("; this checkout of " + s["repo"] + " lacks it" if s.get("inRepo") else "; git clone " + s["repo"] + ", then check --write")))
            if s.get("ignored"):
                out.append("       WARN ignored (the folder is part of this repo now; remove them): " + ", ".join(s["ignored"]))
    out.append("projects  " + (", ".join(r["projectRoots"]) or "none") + " [" + r["projectRootsSource"] + "]")
    out.append("missing required: " + (", ".join(r["missingRequired"]) or "none"))
    for p in r.get("machineProblems", []):
        out.append("state/machine.json: " + p)
    return out


def found_values(r):
    """What --write records: what was found by search or a legacy file. A value from an env var is for that shell only and is not kept."""
    co = {i["id"]: i["setup"]["checkout"] for i in r["items"]
          if i.get("setup") and i["setup"]["checkout"] and i["setup"]["source"] != "machine.json" and not i["setup"].get("fromEnv") and not i["setup"].get("inRepo")}
    out = {"checkout": co}
    # the legacy file is migrated; the default (~/Projects when it exists) is not written: an empty list recorded once would hide
    # ~/Projects for good after it is created
    if r.get("projectRootsSource") == "state/project-roots.txt":
        out["projectRoots"] = r["projectRoots"]
    return out


def ask(question):
    """y/N on the terminal. Without a terminal the answer is no: nothing that writes runs unattended."""
    if not sys.stdin.isatty():
        print("refused (no terminal to ask): " + question)
        return False
    try:
        return input(question + " [y/N] ").strip().lower() in ("y", "yes")
    except EOFError:  # Windows reports NUL as a terminal; end of input is a no
        print("\nrefused (no answer)")
        return False


def run(cmd, cwd=None):
    """Run with output streamed to the terminal; the exit code, or 127 when the program is not there."""
    print("$ " + " ".join(str(c) for c in cmd), flush=True)
    try:
        return subprocess.run(cmd, cwd=cwd, env=ENV).returncode
    except OSError as e:
        print("could not start: " + str(e))
        return 127


def capture(cmd, cwd=None):
    try:
        p = subprocess.run(cmd, cwd=cwd, env=ENV, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=600)
        return p.returncode, p.stdout, p.stderr
    except (OSError, subprocess.TimeoutExpired) as e:
        return 127, "", type(e).__name__ + ": " + str(e)


def entries_by_id(repo=toolreg.REPO):
    return {e["id"]: e for e in toolreg.load_registry(repo)}


def setup_argv(entry, key):
    """A setup command as argv: python setups run under this interpreter, "bash" means Git Bash on Windows (not WSL's)."""
    cmd = list(entry["setup"][key])
    if entry["setup"].get("python"):
        return [sys.executable, "-B", *cmd]
    if cmd and cmd[0] == "bash":
        return [find_bash(), *cmd[1:]]
    return cmd


def summarize(parser, rc, out, err, limit=20):
    """Lines that show what a plan or verify said. trace: TRACE's JSON; lines: the output as is."""
    if parser == "trace":
        try:
            data = json.loads(out)
        except ValueError:
            return ["exit %d, not JSON: %s" % (rc, (err or out).strip()[:300])]
        if isinstance(data, list):  # plan: one row per file
            rows = [r for r in data if isinstance(r, dict)]
            counts = Counter(str(r.get("action")) for r in rows)
            changes = [r for r in rows if r.get("action") != "keep"]
            return (["plan: " + (", ".join("%s %d" % kv for kv in sorted(counts.items())) or "nothing")]
                    + ["  %s %s" % (r.get("action"), r.get("path")) for r in changes[:limit]]
                    + (["  ... and %d more" % (len(changes) - limit)] if len(changes) > limit else []))
        if isinstance(data, dict):  # verify
            errors = [e for e in data.get("errors") or [] if isinstance(e, str)]
            return (["verify: %s, %d errors" % (data.get("status"), len(errors))] + ["  " + e for e in errors[:limit]]
                    + (["  ... and %d more" % (len(errors) - limit)] if len(errors) > limit else []))
        return ["exit %d, unexpected JSON" % rc]
    text = (out + err).strip().splitlines()
    return text[-limit:] if len(text) > limit else text


def verify_passed(parser, rc, out):
    if parser == "trace":
        try:
            return json.loads(out).get("status") == "pass"
        except (ValueError, AttributeError):
            return False
    return rc == 0


def cmd_install(r, entries, ask=ask, run=run, platform=sys.platform):
    todo = [i for i in r["items"] if not i["found"] and not i["disabled"]]
    old = [i for i in r["items"] if i["found"] and not i["versionOk"] and not i["disabled"]]
    bad = done = 0
    for i in old:  # never upgraded here: an upgrade can break what already uses the old version
        print("%s: too old (%s, needs %s+); upgrade by hand: %s" % (i["id"], i["version"] or "?", i["min"],
                                                                   toolreg.upgrade_command(entries[i["id"]], platform) or "no source known"))
        bad += i["required"]
    if not todo:
        print("nothing to install")
        return 1 if bad else 0
    for i in todo:
        argv = toolreg.install_argv(entries[i["id"]], platform)
        if not argv:
            print("%s: no package for this system; install by hand: %s" % (i["id"], i["install"] or "no source known"))
            bad += i["required"]
            continue
        if ask("install %s%s with: %s ?" % (i["label"], " (required)" if i["required"] else "", " ".join(argv))):
            rc = run(argv)
            print("%s: %s" % (i["id"], "installed" if rc == 0 else "install failed (exit %d)" % rc))
            bad += rc != 0
            done += rc == 0
        else:
            bad += i["required"]
    if done:
        print("open a new terminal so PATH picks up what was installed, then run: python scripts/bootstrap.py check")
    return 1 if bad else 0


def cmd_apply(r, entries, ask=ask, run=run, capture=capture):
    todo = [i for i in r["items"] if i.get("setup") and i["setup"]["checkout"] and not i["disabled"] and entries[i["id"]]["setup"].get("apply")]
    bad = 0
    for i in todo:
        e, d = entries[i["id"]], i["setup"]["checkout"]
        print("== %s (%s)" % (i["label"], d))
        if e["setup"].get("plan"):
            rc, out, err = capture(setup_argv(e, "plan"), cwd=d)
            print("\n".join(summarize(e["setup"].get("parser"), rc, out, err)))
            if rc != 0:
                print("%s: plan failed (exit %d); not applied" % (i["id"], rc))
                bad += 1
                continue
        else:
            print("this setup has no plan step; apply writes without a preview")
        if ask("apply %s now?" % i["label"]):
            rc = run(setup_argv(e, "apply"), cwd=d)
            print("%s: %s" % (i["id"], "applied" if rc == 0 else "apply failed (exit %d)" % rc))
            bad += rc != 0
        else:
            bad += 1
    if not todo:
        print("no setup checkout found; run: python scripts/bootstrap.py check")
        return 1
    return 1 if bad else 0


def cmd_verify(r, entries, capture=capture):
    bad = 0
    for i in r["items"]:
        s = entries[i["id"]].get("setup")
        if not s or i["disabled"]:
            continue
        if not i["setup"]["checkout"]:
            print("%-7s no checkout" % i["id"])
            bad += i["required"]
            continue
        rc, out, err = capture(setup_argv(entries[i["id"]], "verify"), cwd=i["setup"]["checkout"])
        ok = verify_passed(s.get("parser"), rc, out)
        tail = summarize(s.get("parser"), rc, out, err, limit=5)
        print("%-7s %s  %s" % (i["id"], "PASS" if ok else "FAIL", tail[-1] if s.get("parser") != "trace" and tail else ""))
        if not ok:
            print("\n".join("        " + l for l in tail))
        bad += not ok
    return 1 if bad else 0


def autostart_plan(platform=sys.platform, repo=toolreg.REPO, python=sys.executable, appdata=None):
    """(file to write, its bytes, how it is undone) for this system, or (None, reason, None)."""
    if platform.startswith("win"):
        pyw = Path(python).with_name("pythonw.exe")
        if not pyw.exists():
            return None, "pythonw.exe not found next to " + python, None
        appdata = appdata or os.environ.get("APPDATA")
        if not appdata:
            return None, "APPDATA is not set", None
        text = ("' Starts the ai-setup dashboard hidden at login. Delete this file to turn autostart off. Written by scripts/bootstrap.py autostart.\r\n"
                'Set sh = CreateObject("WScript.Shell")\r\n'
                'sh.CurrentDirectory = "%s"\r\n'
                'sh.Run """%s"" scripts\\dashboard\\server.py", 0, False\r\n') % (repo, pyw)
        try:
            data = text.encode("ascii")
        except UnicodeEncodeError:  # WSH reads a non-ASCII script only as UTF-16 with a BOM
            data = text.encode("utf-16")
        return Path(appdata) / "Microsoft/Windows/Start Menu/Programs/Startup/claude-dashboard.vbs", data, "delete the file"
    return None, "no autostart support for %s; start python3 scripts/dashboard/server.py from your login session" % platform, None


def cmd_autostart(ask=ask, plan=None):
    path, data, undo = plan or autostart_plan()
    if path is None:
        print(data)
        return 1
    old = path.read_bytes() if path.exists() else None
    if old == data:
        print("unchanged: " + str(path))
        return 0
    print("file: " + str(path) + ("  (replaces the current one)" if old is not None else "  (new)"))
    if old is not None:
        print("--- current\n" + old.decode("utf-16" if old[:2] in (b"\xff\xfe", b"\xfe\xff") else "utf-8", "replace"))
    print("--- new\n" + data.decode("utf-16" if data[:2] in (b"\xff\xfe", b"\xfe\xff") else "utf-8", "replace"))
    if not ask("write it? (undo: %s)" % undo):
        return 1
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    print("written; it runs at the next login")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("command", nargs="?", default="check", choices=["check", "install", "apply", "verify", "autostart"])
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    if a.command == "autostart":
        return cmd_autostart()
    r = collect()
    if a.command != "check":
        return {"install": cmd_install, "apply": cmd_apply, "verify": cmd_verify}[a.command](r, entries_by_id())
    if a.write:
        try:
            toolreg.write_machine(found_values(r))
        except (ValueError, OSError) as e:  # a broken file, a full disk, a file held open by an editor
            print("not written: " + str(e), file=sys.stderr)
            return 2
    if a.json:
        print(json.dumps(r, ensure_ascii=False, indent=2))
    else:
        print("\n".join(lines(r)))
    return 1 if r["missingRequired"] else 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")  # paths hold Korean names; a cp949 console would otherwise crash on print
    try:
        sys.exit(main())
    except Exception:  # exit 1 means "a required tool is missing"; a crash must not look like that to CI
        import traceback
        traceback.print_exc()
        sys.exit(3)
