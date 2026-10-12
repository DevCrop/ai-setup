#!/usr/bin/env python3
"""One entry point to set up a machine from tools.json. Standard library only.

Usage: python scripts/bootstrap.py [check] [--write] [--json]
  check    read-only (default): every dependency and tool, its version, its setup checkout, the project roots,
           and the install command for anything missing. Exit 1 when a required item is missing or too old.
  --write  also record what was found in state/machine.json (values already there are kept).
  --json   print the result as JSON instead of lines.
Exit codes: 0 ok, 1 a required item is missing or too old, 2 state/machine.json is broken (--write refused), 3 crash.
"""
import argparse, json, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    import toolreg
except Exception:  # a broken toolreg.py must exit 3 (crash), not 1 ("required tool missing")
    import traceback
    traceback.print_exc()
    sys.exit(3)


def collect(repo=toolreg.REPO):
    machine, toks = toolreg.load_machine(repo), toolreg.tokens(repo)
    items = [toolreg.detect(e, machine, toks, repo) for e in toolreg.load_registry(repo)]
    roots, rsrc = toolreg.project_roots(machine, toks, repo)
    return {"items": items, "projectRoots": [str(r) for r in roots], "projectRootsSource": rsrc,
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
            out.append("       setup " + (s["checkout"] + " [" + s["source"] + "]" if s["checkout"] else "not found; tried " + " > ".join(s["tried"]) + "; clone " + s["repo"]))
    out.append("projects  " + (", ".join(r["projectRoots"]) or "none") + " [" + r["projectRootsSource"] + "]")
    out.append("missing required: " + (", ".join(r["missingRequired"]) or "none"))
    return out


def found_values(r):
    """What --write records: what was found by search or a legacy file. A value from an env var is for that shell only and is not kept."""
    co = {i["id"]: i["setup"]["checkout"] for i in r["items"]
          if i.get("setup") and i["setup"]["checkout"] and i["setup"]["source"] != "machine.json" and not i["setup"].get("fromEnv")}
    out = {"checkout": co}
    if r.get("projectRootsSource") in ("state/project-roots.txt", "default"):
        out["projectRoots"] = r["projectRoots"]
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("command", nargs="?", default="check", choices=["check"])
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    r = collect()
    if a.write:
        try:
            toolreg.write_machine(found_values(r))
        except ValueError as e:
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
