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
    mkrun("single", 1, "BENCH-single-1", True)
    big = dict(input_tokens=10, cache_read_input_tokens=190000, cache_creation_input_tokens=10000, output_tokens=1000,
               cache_creation={"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 10000})
    (proj / "s1.jsonl").write_text("\n".join([json.dumps({"timestamp": "2026-10-12T00:00:00Z", "type": "user", "message": {"content": "[BENCH-single-1] Do it"}}),
                                              line("a", "2026-10-12T00:00:50Z", **big), line("a", "2026-10-12T00:00:50Z", **big),
                                              line("b", "2026-10-12T00:01:40Z", input_tokens=10, output_tokens=10)]) + "\n", encoding="utf-8")
    # subagents: main 60 s plus a Haiku subagent that ends later (wall time must include it); stub left unsolved
    mkrun("subagents", 1, "BENCH-sub-1", False)
    (proj / "s2.jsonl").write_text("\n".join([json.dumps({"timestamp": "2026-10-12T01:00:00Z", "type": "user", "message": {"content": [{"type": "text", "text": "[BENCH-sub-1] Do it"}]}}),
                                              line("c", "2026-10-12T01:01:00Z", input_tokens=10, cache_read_input_tokens=50000, output_tokens=100)]) + "\n", encoding="utf-8")
    (proj / "s2" / "subagents").mkdir(parents=True)
    (proj / "s2" / "subagents" / "agent-1.jsonl").write_text(line("d", "2026-10-12T01:02:00Z", "claude-haiku-5-5", input_tokens=5, cache_read_input_tokens=900000, output_tokens=5) + "\n", encoding="utf-8")
    # a run whose marker is in no transcript: listed as missing, kept out of the averages
    mkrun("ao", 1, "BENCH-ao-nowhere", True)
    # an unrelated session must not be counted, even when it quotes a marker in a later message or a tool result
    (proj / "s3.jsonl").write_text("\n".join([json.dumps({"timestamp": "2026-10-12T02:00:00Z", "type": "user", "message": {"content": "run the bench"}}),
                                              json.dumps({"timestamp": "2026-10-12T02:00:01Z", "type": "user", "message": {"content": "what does [BENCH-single-1] mean?"}}),
                                              json.dumps({"timestamp": "2026-10-12T02:00:02Z", "type": "user", "message": {"content": [{"type": "tool_result", "content": "[BENCH-ao-nowhere] x"}]}}),
                                              line("e", "2026-10-12T02:00:03Z", output_tokens=99999)]) + "\n", encoding="utf-8")
    # two runs in one session file (a leaked session id): each counts only its own span and its own subagents
    mkrun("single", 2, "BENCH-single-2", True)
    mkrun("single", 3, "BENCH-single-3", True)
    (proj / "s4.jsonl").write_text("\n".join([json.dumps({"timestamp": "2026-10-12T03:00:00Z", "type": "user", "message": {"content": "[BENCH-single-2] Do it"}}),
                                              line("f", "2026-10-12T03:00:10Z", output_tokens=1000),
                                              json.dumps({"timestamp": "2026-10-12T03:10:00Z", "type": "user", "message": {"content": "[BENCH-single-3] Do it"}}),
                                              line("g", "2026-10-12T03:10:30Z", output_tokens=3000)]) + "\n", encoding="utf-8")
    (proj / "s4" / "subagents").mkdir(parents=True)
    (proj / "s4" / "subagents" / "agent-x.jsonl").write_text(line("h", "2026-10-12T03:10:20Z", output_tokens=500) + "\n", encoding="utf-8")
    # AO-like: three worker sessions with the same marker; wall time spans all of them
    mkrun("ao", 2, "BENCH-ao-2", True)
    for i, (a, b) in enumerate((("00", "40"), ("05", "50"), ("10", "30"))):
        (proj / f"w{i}.jsonl").write_text("\n".join([json.dumps({"timestamp": f"2026-10-12T04:00:{a}Z", "type": "user", "message": {"content": "<agent-rules>never push</agent-rules>\n[BENCH-ao-2] Do only task"}}),
                                                     line(f"w{i}", f"2026-10-12T04:00:{b}Z", output_tokens=100)]) + "\n", encoding="utf-8")

    (work / "subagents-r1" / "stream.jsonl").write_text('{"type": "result", "total_cost_usd": 0.5}\n{"type": "result", "total_cost_usd": 0.9}\nnot json\n', encoding="utf-8")
    # damaged bench.json files are skipped and named, never raised
    for name, body in (("single-r8", "{broken"), ("single-r9", '{"arm": "single", "rep": 9}')):
        (work / name).mkdir()
        (work / name / "bench.json").write_text(body, encoding="utf-8")
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
    check(sub["cliCostUSD"] == 0.9 and s["cliCostUSD"] is None, "CLI cost: the last result event of stream.jsonl, None without one", (sub["cliCostUSD"], s["cliCostUSD"]))
    check("차이 5% 초과" in report.table(rep), "table flags a log cost far from the CLI's own", report.table(rep))
    check(rep["missing"] == ["ao-r1"] and rep["arms"]["ao"]["runs"] == 1, "a run with no transcript is reported missing, not averaged as zero", rep["missing"])
    check(all(r["costUSD"] < 0.1 for r in rep["runs"]) and s["sessions"] == 1, "a session that only quotes a marker is not counted", [(r["dir"], r["sessions"], r["costUSD"]) for r in rep["runs"]])
    r2, r3 = rows["single-r2"], rows["single-r3"]
    check(abs(r2["costUSD"] - 0.01) < 1e-9 and r2["subagents"] == 0 and r2["wallSec"] == 10.0, "shared session file: the first run counts only its own span", r2)
    check(abs(r3["costUSD"] - 0.035) < 1e-9 and r3["subagents"] == 1, "shared session file: the subagent belongs to the run it started in", r3)
    a2 = rows["ao-r2"]
    check(a2["sessions"] == 3 and a2["wallSec"] == 50.0 and abs(a2["costUSD"] - 0.003) < 1e-9, "several sessions with one marker: costs add up, wall time spans them all", a2)
    vs = rep["arms"]["subagents"]["vsSingle"]
    check(rep["arms"]["single"]["vsSingle"]["costUSD"] == 0.0 and vs["wallSec"] is not None, "vsSingle: percent change against the single arm", vs)
    json.dumps(rep, allow_nan=False)
    check(sorted(rep["invalid"]) == ["single-r8", "single-r9"], "damaged bench.json: run skipped and listed as invalid", rep["invalid"])
    check(rows["ao-r2"]["sessions"] == 3, "a prompt wrapped by the tool (text before the marker) still matches", rows["ao-r2"]["sessions"])
    part = tmp / "part"
    shutil.copytree(HERE / "fixture", part)
    for f in (HERE / "solution").glob("*.py"):
        shutil.copy(f, part / "textkit" / f.name)
    (part / "textkit" / "duration.py").write_text("def parse_duration(:\n", encoding="utf-8")
    g = report.grade(part)
    check(g["total"] == 16 and 0 < g["passed"] < 16, "a broken module fails only its own hidden tests", g)
    import subprocess
    r = subprocess.run([sys.executable, str(HERE / "report.py"), str(tmp / "empty"), "--projects", str(tmp / "projects"), "--out", str(tmp / "out.json")], capture_output=True, text=True)
    check(r.returncode != 0 and not (tmp / "out.json").exists(), "an empty work dir exits non-zero and writes nothing", (r.returncode, r.stderr[-200:]))
    t = report.table(rep)
    check("ao-r1" in t and "기본 (메인 혼자)" in t, "table names the arms and the missing run", t)
finally:
    shutil.rmtree(tmp, ignore_errors=True)

print(f"failures: {len(fails)}")
sys.exit(1 if fails else 0)
