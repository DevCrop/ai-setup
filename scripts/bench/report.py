"""Compare bench runs: cost by kind (input, cache write, cache read, output), wall time, peak context and hidden-test score per arm.

Usage: python3 scripts/bench/report.py <work-dir> [--projects ~/.claude/projects] [--out file.json]
A run is <work-dir>/<arm>-r<N>/ holding bench.json ({"arm", "rep", "marker"}) and repo/ (the project the agents worked in).
Its sessions are the transcripts under <projects>/*/*.jsonl that contain the run's marker, plus each one's subagents/*.jsonl.

Basis: tokens and timestamps are measured from the transcripts; amounts are list-price arithmetic (usage.PRICES), not a bill.
Wall time is first to last transcript timestamp across the run's sessions, so it leaves out the time before the first prompt
and anything that never reaches a transcript (an AO orchestrator session without the marker, session titles, hook classifiers).
Score: the hidden tests (scripts/bench/hidden) run against a copy of repo/; the agents never see them.
"""
import argparse
import json
import os
import shutil
import statistics
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "dashboard"))
import usage  # noqa: E402

ARMS = ("single", "subagents", "ao")
LABEL = {"single": "기본 (메인 혼자)", "subagents": "내장 병렬 (서브에이전트)", "ao": "AO 워커 병렬"}

GRADER = r"""
import json, sys, unittest
sys.path.insert(0, ".")
failed, total = set(), set()
class R(unittest.TextTestResult):
    def startTest(self, t): total.add(t.id()); super().startTest(t)
    def addFailure(self, t, e): failed.add(t.id()); super().addFailure(t, e)
    def addError(self, t, e): failed.add(getattr(t, "id", lambda: str(t))()); super().addError(t, e)
    def addSubTest(self, t, s, e):
        if e is not None: failed.add(t.id())
        super().addSubTest(t, s, e)
try:
    suite = unittest.defaultTestLoader.loadTestsFromName("_bench_hidden")
except Exception:
    print(json.dumps({"passed": 0, "total": 0, "error": "import failed"})); sys.exit(0)
n = suite.countTestCases()
import os
unittest.TextTestRunner(stream=open(os.devnull, "w"), resultclass=R).run(suite)
print(json.dumps({"passed": n - len(failed), "total": n}))
"""


def _ts(s):
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp() if isinstance(s, str) else None
    except ValueError:
        return None


def scan(path):
    """(first timestamp, last timestamp, peak context tokens of one request) for one transcript."""
    first = last = None
    peak = 0
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if '"timestamp"' not in line:
                    continue
                try:
                    d = json.loads(line)
                except ValueError:
                    continue
                if not isinstance(d, dict):
                    continue
                t = _ts(d.get("timestamp"))
                if t is not None:
                    first, last = (t if first is None else min(first, t)), (t if last is None else max(last, t))
                m = d.get("message") if isinstance(d.get("message"), dict) else {}
                u = m.get("usage") if isinstance(m.get("usage"), dict) else None
                if u:
                    peak = max(peak, usage._n(u.get("input_tokens")) + usage._n(u.get("cache_read_input_tokens")) + usage._n(u.get("cache_creation_input_tokens")))
    except OSError:
        pass
    return first, last, peak


def find_sessions(projects, marker):
    """Main transcripts that contain the marker. The marker is in the first prompt, so a plain substring test is enough."""
    hits = []
    for f in sorted(Path(projects).glob("*/*.jsonl")) if Path(projects).is_dir() else []:
        try:
            with open(f, encoding="utf-8", errors="replace") as fh:
                if any(marker in line for line in fh):
                    hits.append(f)
        except OSError:
            continue
    return hits


def grade(repo):
    """Hidden-test score for a copy of repo/ ({"passed", "total"}); the original is not touched."""
    if not Path(repo, "textkit").is_dir():
        return {"passed": 0, "total": 0, "error": "no textkit/ in repo"}
    with tempfile.TemporaryDirectory() as tmp:
        shutil.copytree(Path(repo, "textkit"), Path(tmp, "textkit"))
        shutil.copy(HERE / "hidden" / "test_hidden.py", Path(tmp, "_bench_hidden.py"))
        try:
            r = subprocess.run([sys.executable, "-I", "-c", GRADER], cwd=tmp, capture_output=True, text=True, timeout=120,
                               env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1", "PYTHONSAFEPATH": "1"})
            return json.loads(r.stdout.strip().splitlines()[-1])
        except (subprocess.TimeoutExpired, ValueError, IndexError):
            return {"passed": 0, "total": 0, "error": "grader did not finish"}


def run_row(run_dir, projects):
    meta = json.loads(Path(run_dir, "bench.json").read_text(encoding="utf-8"))
    mains = find_sessions(projects, meta["marker"])
    per, subs, first, last, peak = {}, 0, None, None, 0
    for f in mains:
        logs = [f] + sorted((f.with_suffix("") / "subagents").glob("agent-*.jsonl"))
        subs += len(logs) - 1
        for log in logs:
            usage._add(per, usage.read_log(log))
            a, b, p = scan(log)
            first = a if first is None or (a is not None and a < first) else first
            last = b if last is None or (b is not None and b > last) else last
            if log == f:
                peak = max(peak, p)  # the main thread's context; a subagent's is its own, smaller one
    split = dict.fromkeys(usage.KINDS, 0.0)
    cost, other = 0.0, 0
    for model, t in per.items():
        sp = usage.split(model, t)
        if sp is None:
            other += 1
            continue
        for k in usage.KINDS:
            split[k] += sp[k]
        cost += sum(sp.values())
    return {"arm": meta["arm"], "rep": meta.get("rep"), "dir": Path(run_dir).name, "sessions": len(mains), "subagents": subs,
            "costUSD": round(cost, 6), "split": {k: round(v, 6) for k, v in split.items()}, "models": sorted(per),
            "unpricedModels": other, "wallSec": round(last - first, 1) if first is not None and last is not None else None,
            "peakContext": peak, "score": grade(Path(run_dir, "repo"))}


def _stats(xs):
    xs = [x for x in xs if x is not None]
    if not xs:
        return None
    return {"mean": round(statistics.mean(xs), 6), "min": min(xs), "max": max(xs), "n": len(xs)}


def summarize(rows):
    arms = {}
    for arm in ARMS:
        rs = [r for r in rows if r["arm"] == arm and r["sessions"]]
        if not rs:
            continue
        pct = [100 * r["score"]["passed"] / r["score"]["total"] if r["score"].get("total") else 0 for r in rs]
        arms[arm] = {"label": LABEL[arm], "runs": len(rs), "costUSD": _stats([r["costUSD"] for r in rs]),
                     "split": {k: round(statistics.mean(r["split"][k] for r in rs), 6) for k in usage.KINDS},
                     "wallSec": _stats([r["wallSec"] for r in rs]), "peakContext": _stats([r["peakContext"] for r in rs]),
                     "scorePct": _stats(pct), "subagents": _stats([r["subagents"] for r in rs])}
    base = arms.get("single")
    if base:
        for a in arms.values():  # change against the single-agent arm, in percent of its mean
            a["vsSingle"] = {k: round((a[k]["mean"] / base[k]["mean"] - 1) * 100, 1) if a[k] and base[k] and base[k]["mean"] else None
                             for k in ("costUSD", "wallSec", "peakContext")}
    return arms


def collect(work, projects):
    runs = sorted(p for p in Path(work).glob("*-r*") if Path(p, "bench.json").is_file())
    rows = [run_row(p, projects) for p in runs]
    missing = [r["dir"] for r in rows if not r["sessions"]]
    return {"generated": datetime.now().astimezone().isoformat(timespec="seconds"), "prices": "usage.PRICES (official list, 2026-10-12)",
            "runs": rows, "arms": summarize(rows), "missing": missing}


def table(rep):
    out = ["| 방식 | 실행 | 비용(평균) | 캐시 읽기 비중 | 시간(평균) | 최대 컨텍스트 | 숨은 테스트 | 기본 대비 비용 / 시간 |", "|---|---|---|---|---|---|---|---|"]
    for arm, a in rep["arms"].items():
        tot = sum(a["split"].values())
        vs = a.get("vsSingle") or {}
        f = lambda v: "-" if v is None else f"{v:+.1f}%"
        out.append(f"| {a['label']} | {a['runs']} | ${a['costUSD']['mean']:.3f} | {(a['split']['read'] / tot * 100) if tot else 0:.0f}% | "
                   f"{(a['wallSec']['mean'] / 60) if a['wallSec'] else 0:.1f}분 | {int(a['peakContext']['mean']) if a['peakContext'] else 0:,} | "
                   f"{a['scorePct']['mean']:.0f}% | {f(vs.get('costUSD'))} / {f(vs.get('wallSec'))} |")
    if rep["missing"]:
        out.append(f"\n로그를 찾지 못한 실행(집계 제외): {', '.join(rep['missing'])}")
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("work")
    ap.add_argument("--projects", default=str(Path(os.environ.get("CLAUDE_CONFIG_DIR", Path.home() / ".claude")) / "projects"))
    ap.add_argument("--out")
    a = ap.parse_args()
    rep = collect(a.work, a.projects)
    if a.out:
        Path(a.out).parent.mkdir(parents=True, exist_ok=True)
        Path(a.out).write_text(json.dumps(rep, ensure_ascii=False, indent=1, allow_nan=False), encoding="utf-8")
    print(table(rep))


if __name__ == "__main__":
    main()
