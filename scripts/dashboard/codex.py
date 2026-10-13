"""Codex global setup (TRACE, the codex/ folder of this repo), read-only.

The dashboard does not judge the Codex setup; it shows what TRACE's own checks say. It runs `setup.py verify` and `setup.py plan`
(both read files only; apply/rollback stay in Codex) and `codex --version`. `setup.py doctor` is not run: it starts the Codex CLI
itself, outside spawn(), which would open a console window under pythonw.
The TRACE checkout, its marker files and the minimum Python come from tools.json (the codex and python entries) through toolreg. The checkout
is codex/ in this repo only (inRepo); TRACE_DIR and state/trace-dir.txt named the old separate clone and are not read.
"""
import json, os, sys
from collections import Counter
from pathlib import Path
from procs import toolreg, which

MAX_ITEMS = 40


def label(tpl):
    """A checkout candidate as the tab shows it: ${REPO}/codex -> 이 레포의 codex/."""
    return "이 레포의 %s/" % tpl[len("${REPO}/"):] if tpl.startswith("${REPO}/") else tpl


def manifest_version(d):
    try:
        v = json.loads((d / "manifest.json").read_text(encoding="utf-8")).get("version")
    except (OSError, ValueError, AttributeError):
        return None
    return v if isinstance(v, str) else None


def str_list(v):
    return [x for x in v if isinstance(x, str)] if isinstance(v, list) else []


def short(text, limit=200):
    return str(text).strip().splitlines()[0][:limit] if str(text).strip() else ""


class CodexSetup:
    def __init__(self, runner, root, python=sys.executable, py_version=sys.version_info[:2]):
        self.runner, self.root, self.python, self.py_version = runner, Path(root), python, py_version

    def find(self, entry):
        """(where it was found or None, the checkout or None, where it looked), as tools.json describes the codex setup."""
        d, source, tried = toolreg.find_checkout(entry, {}, toolreg.tokens(self.root), self.root)
        return (label(source) if source else None), d, [label(s) for s, _ in tried]

    def setup_json(self, d, command):
        """(parsed JSON or None, error text). Exit code 1 with JSON on stdout is a result (a failed verify, a conflict), not an error."""
        try:
            p = self.runner.spawn([self.python, "-B", str(d / "scripts" / "setup.py"), command], timeout=60, cwd=d)
        except Exception as e:
            return None, type(e).__name__
        try:
            return json.loads(p.stdout), ""
        except (ValueError, RecursionError):
            return None, short(p.stderr) or f"exit {p.returncode}, JSON 아님"

    def codex_cli(self):
        exe = which(os.environ.get("CODEX_BIN") or "codex")  # a CODEX_BIN that names no file is "not found", like no codex on PATH
        if not exe:
            return {"found": False, "version": None}
        try:
            out = self.runner.spawn([exe, "--version"], timeout=15).stdout
        except Exception:
            out = ""
        return {"found": True, "version": short(out, 60) or None}

    @staticmethod
    def verify_view(v):
        if not isinstance(v, dict):
            return None
        errors = [short(e, 160) for e in str_list(v.get("errors"))]
        unmanaged = [short(e, 160) for e in str_list(v.get("unmanaged_skill_findings"))]
        return {"status": v.get("status") if v.get("status") in ("pass", "fail") else "unknown",
                "errors": errors[:MAX_ITEMS], "errorCount": len(errors),
                "unmanaged": unmanaged[:MAX_ITEMS], "limit": short(v.get("limit") or "", 300)}

    @staticmethod
    def plan_view(p):
        if not isinstance(p, list):
            return None
        rows = [r for r in p if isinstance(r, dict) and isinstance(r.get("path"), str) and isinstance(r.get("action"), str)]
        changes = [{"path": r["path"][:160], "action": r["action"][:20]} for r in rows if r["action"] != "keep"]
        return {"counts": dict(Counter(r["action"][:20] for r in rows)), "changes": changes[:MAX_ITEMS], "changeCount": len(changes)}

    def state(self):
        """Never raises: the cache would otherwise keep serving "loading" and the tab would never show what went wrong."""
        try:
            return self._state()
        except Exception as e:
            return {"available": False, "failed": True, "codex": {}, "codexHome": "", "reason": "점검 중 오류: " + type(e).__name__, "tried": []}

    def _state(self):
        reg = {e["id"]: e for e in toolreg.load_registry()}
        source, d, tried = self.find(reg["codex"])
        base = {"available": False, "codex": self.codex_cli(), "codexHome": "CODEX_HOME" if os.environ.get("CODEX_HOME") else "~/.codex"}
        if d is None:
            return {**base, "reason": "TRACE 체크아웃을 찾지 못했습니다", "tried": tried}
        base.update({"available": True, "source": source, "version": manifest_version(d)})
        need = reg["python"].get("min")  # TRACE needs tomllib
        if not toolreg.version_ok("%d.%d" % self.py_version, need):
            return {**base, "error": "Python %d.%d: TRACE는 %s 이상이 필요합니다" % (*self.py_version, need)}
        v, verr = self.setup_json(d, "verify")
        p, perr = self.setup_json(d, "plan")
        return {**base, "verify": self.verify_view(v), "verifyError": verr, "plan": self.plan_view(p), "planError": perr}
