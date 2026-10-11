"""Fails unless the dashboard starts processes in exactly one place (spawn() in procs.py, with creationflags).
Reads the syntax tree, so comments and docstrings never count and `import subprocess as sp` / `from subprocess import run` are caught.
Usage: python3 scripts/qa-spawn-guard.py <dashboard-dir>"""
import ast, sys
from pathlib import Path

PROC_OS = {"system", "popen", "startfile", "spawnl", "spawnv", "execv", "execl", "fork"}
calls, bad = [], []
for f in sorted(Path(sys.argv[1]).glob("*.py")):
    tree = ast.parse(f.read_text(encoding="utf-8"))
    aliases = {"subprocess"}
    for n in ast.walk(tree):
        if isinstance(n, ast.Import):
            aliases |= {a.asname or a.name for a in n.names if a.name == "subprocess"}
        if isinstance(n, ast.ImportFrom) and n.module == "subprocess":
            bad.append(f"{f.name}:{n.lineno} from subprocess import (call it as subprocess.run inside spawn())")
    for n in ast.walk(tree):
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and isinstance(n.func.value, ast.Name):
            v, a = n.func.value.id, n.func.attr
            if (v in aliases) or (v == "os" and a in PROC_OS):
                calls.append((f.name, n.lineno, any(k.arg == "creationflags" for k in n.keywords)))
if bad or len(calls) != 1 or not calls[0][2] or calls[0][0] != "procs.py":
    print("FAIL", bad or calls); sys.exit(1)
print("ok", calls)
