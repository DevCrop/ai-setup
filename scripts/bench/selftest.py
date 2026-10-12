"""Checks report.py on synthetic runs and transcripts (no model calls). Exit 1 on any failure."""
import json
import shutil
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import report  # noqa: E402

fails = []


def check(ok, what, got=None):
    print(("PASS  " if ok else "FAIL  ") + what + ("" if ok else f"   got: {got!r}"))
    ok or fails.append(what)


def line(rid, ts, model="claude-sonnet-5-5", text=None, **u):
    d = {"timestamp": ts, "requestId": rid, "message": {"model": model, "usage": u}}
    if text:
        d["message"]["content"] = text
    return json.dumps(d)


tmp = Path(tempfile.mkdtemp())
try:
    work, proj = tmp / "work", tmp / "projects" / "p"
    proj.mkdir(parents=True)

    def mkrun(arm, rep, marker, solved):
        d = work / f"{arm}-r{rep}"
        shutil.copytree(HERE / "fixture", d / "repo")
        if solved:
            for f in (HERE / "solution").glob("*.py"):
                shutil.copy(f, d / "repo" / "textkit" / f.name)
        (d / "bench.json").write_text(json.dumps({"arm": arm, "rep": rep, "marker": marker}), encoding="utf-8")

    # single: one session, 100 s, a reply logged twice (counts once), context peaks at 200K
    mkrun("single", 1, "MK-single-1", True)
    big = dict(input_tokens=10, cache_read_input_tokens=190000, cache_creation_input_tokens=10000, output_tokens=1000,
               cache_creation={"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 10000})
    (proj / "s1.jsonl").write_text("\n".join([json.dumps({"timestamp": "2026-10-12T00:00:00Z", "type": "user", "message": {"content": "[MK-single-1] go"}}),
                                              line("a", "2026-10-12T00:00:50Z", **big), line("a", "2026-10-12T00:00:50Z", **big),
                                              line("b", "2026-10-12T00:01:40Z", input_tokens=10, output_tokens=10)]) + "\n", encoding="utf-8")
    # subagents: main 60 s plus a Haiku subagent that ends later (wall time must include it); stub left unsolved
    mkrun("subagents", 1, "MK-sub-1", False)
    (proj / "s2.jsonl").write_text("\n".join([json.dumps({"timestamp": "2026-10-12T01:00:00Z", "message": {"content": "[MK-sub-1] go"}}),
                                              line("c", "2026-10-12T01:01:00Z", input_tokens=10, cache_read_input_tokens=50000, output_tokens=100)]) + "\n", encoding="utf-8")
    (proj / "s2" / "subagents").mkdir(parents=True)
    (proj / "s2" / "subagents" / "agent-1.jsonl").write_text(line("d", "2026-10-12T01:02:00Z", "claude-haiku-5-5", input_tokens=5, cache_read_input_tokens=900000, output_tokens=5) + "\n", encoding="utf-8")
    # a run whose marker is in no transcript: listed as missing, kept out of the averages
    mkrun("ao", 1, "MK-ao-nowhere", True)
    # an unrelated session must not be counted
    (proj / "s3.jsonl").write_text(line("e", "2026-10-12T02:00:00Z", output_tokens=99999) + "\n", encoding="utf-8")

    rep = report.collect(work, tmp / "projects")
    rows = {r["dir"]: r for r in rep["runs"]}
    s, sub = rows["single-r1"], rows["subagents-r1"]
    exp = (10 * 2 + 190000 * 0.10 + 10000 * 4 + 1000 * 10 + 10 * 2 + 10 * 10) / 1e6
    check(abs(s["costUSD"] - exp) < 1e-9, "single: cost = list prices x de-duplicated tokens", s)
    check(abs(s["split"]["read"] - 0.019) < 1e-9 and abs(s["split"]["write"] - 0.04) < 1e-9, "single: cache read and cache write are split out", s["split"])
    check(s["wallSec"] == 100.0 and s["peakContext"] == 200010, "single: wall time from timestamps, peak context of one request", (s["wallSec"], s["peakContext"]))
    check(s["score"] == {"passed": 16, "total": 16}, "single: the reference solution passes every hidden test", s["score"])
    check(sub["wallSec"] == 120.0 and sub["subagents"] == 1, "subagents: wall time runs to the subagent's last entry", (sub["wallSec"], sub["subagents"]))
    check(sub["peakContext"] == 50010, "subagents: peak context is the main thread's, not the subagent's", sub["peakContext"])
    check("claude-haiku-5-5" in sub["models"] and sub["score"]["passed"] == 0, "subagents: subagent model counted; the stub scores 0", (sub["models"], sub["score"]))
    check(rep["missing"] == ["ao-r1"] and "ao" not in rep["arms"], "a run with no transcript is reported missing, not averaged as zero", rep["missing"])
    check(all(r["costUSD"] < 0.1 for r in rep["runs"]), "an unrelated session is not counted", [r["costUSD"] for r in rep["runs"]])
    vs = rep["arms"]["subagents"]["vsSingle"]
    check(vs["wallSec"] == 20.0 and rep["arms"]["single"]["vsSingle"]["costUSD"] == 0.0, "vsSingle: percent change against the single arm", vs)
    json.dumps(rep, allow_nan=False)
    t = report.table(rep)
    check("ao-r1" in t and "기본 (메인 혼자)" in t, "table names the arms and the missing run", t)
finally:
    shutil.rmtree(tmp, ignore_errors=True)

print(f"failures: {len(fails)}")
sys.exit(1 if fails else 0)
