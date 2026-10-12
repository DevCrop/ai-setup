"""Per-model and per-agent token use, summed from the `message.usage` of every reply in the session logs (main logs and subagent logs).

Basis: token counts are measured from the logs. Cost is arithmetic at list prices (an estimate, not a bill). The "baseline" is what the same
tokens would have cost on each session's main model; it assumes the work needs the same tokens there, so it is an estimate too.
Not counted: calls that never reach a transcript (session titles, hook classifiers). The logs' own `modelUsage` totals are not used: in the
session checked on 2026-10-12 they stopped updating partway through and missed a subagent that ran afterwards.

A reply is logged once per content block with identical usage, so entries are de-duplicated by requestId (summing them would count a reply up to 4 times).
Only model names on PRICES leave this module; anything else is reported as "other" and is not repriced.

Prices (USD per million tokens): https://platform.claude.com/docs/en/about-claude/pricing, checked 2026-10-12. They reproduce the CLI's own
costUSD to the last digit on a real session (Sonnet 5.5 0.4052355, Haiku 5.5 0.0003061)."""
import json
from pathlib import Path

# model id -> (input, 5-minute cache write, 1-hour cache write, cache read, output). Haiku 5.5 prompts over 100K tokens cost more; per-request size is not modelled.
PRICES = {
    "claude-haiku-5-5": (0.10, 0.125, 0.20, 0.01, 0.50),
    "claude-sonnet-5-5": (2.0, 2.5, 4.0, 0.10, 10.0),
    "claude-opus-5-5": (4.0, 5.0, 8.0, 0.20, 20.0),
    "claude-fable-5-1": (10.0, 12.5, 20.0, 0.25, 50.0),
}
FIELDS = ("input", "write5m", "write1h", "read", "output")


def _n(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) and v >= 0 else 0


def _tokens(u):
    cc = u.get("cache_creation") if isinstance(u.get("cache_creation"), dict) else {}
    w5, w1 = _n(cc.get("ephemeral_5m_input_tokens")), _n(cc.get("ephemeral_1h_input_tokens"))
    if not (w5 or w1):  # no split in the log: the whole write is priced at the 1-hour rate (the one the CLI used when it did split)
        w1 = _n(u.get("cache_creation_input_tokens"))
    return dict(zip(FIELDS, (_n(u.get("input_tokens")), w5, w1, _n(u.get("cache_read_input_tokens")), _n(u.get("output_tokens")))))


def price(model, t):
    """USD for a token dict at `model`'s list price, or None when the model is not on PRICES."""
    p = PRICES.get(model)
    return None if not p else sum(t.get(f, 0) * r for f, r in zip(FIELDS, p)) / 1e6


_memo = {}  # path -> ((mtime_ns, size), {model: tokens}); a log that did not change is not read again


def read_log(path):
    """{model: tokens} for one log, de-duplicated by requestId."""
    try:
        st = Path(path).stat()
        key = (st.st_mtime_ns, st.st_size)
    except OSError:
        return {}
    hit = _memo.get(str(path))
    if hit and hit[0] == key:
        return hit[1]
    seen = {}
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            for i, line in enumerate(fh):
                if '"usage"' not in line:
                    continue
                try:
                    d = json.loads(line)
                except ValueError:
                    continue
                m = d.get("message") if isinstance(d.get("message"), dict) else {}
                if isinstance(m.get("usage"), dict) and m.get("model"):
                    seen[d.get("requestId") or d.get("uuid") or i] = (m["model"], _tokens(m["usage"]))
    except OSError:
        return {}
    out = {}
    for model, t in seen.values():
        name = model if model in PRICES else "other"
        row = out.setdefault(name, dict.fromkeys(FIELDS, 0))
        for f in FIELDS:
            row[f] += t[f]
    _memo[str(path)] = (key, out)
    return out


def _add(into, per_model):
    for name, t in per_model.items():
        row = into.setdefault(name, dict.fromkeys(FIELDS, 0))
        for f in FIELDS:
            row[f] += t[f]


def collect(projects_dir):
    """Totals over every session log under <projects_dir>/*/*.jsonl plus each one's <session>/subagents/*.jsonl."""
    base = Path(projects_dir)
    models, sessions, baseline, notrepriced = {}, 0, 0.0, 0
    for f in sorted(base.glob("*/*.jsonl")) if base.is_dir() else []:
        per = {k: dict(v) for k, v in read_log(f).items()}
        for sub in sorted((f.with_suffix("") / "subagents").glob("agent-*.jsonl")):
            _add(per, read_log(sub))
        if not per:
            continue
        sessions += 1
        _add(models, per)
        main = max((m for m in per if m in PRICES), key=lambda m: per[m]["output"], default=None)  # the model that wrote the most output carries the session
        for name, t in per.items():
            own = price(name, t)
            alt = price(main, t) if main else None
            if own is None or alt is None:
                notrepriced += 1
                baseline += own or 0.0
            else:
                baseline += alt
    out = {}
    for name, t in models.items():
        c = price(name, t)
        out[name] = {**t, "costUSD": None if c is None else round(c, 6)}
    actual = sum(v["costUSD"] or 0.0 for v in out.values())
    return {"sessions": sessions, "models": out, "actualUSD": round(actual, 6), "baselineUSD": round(baseline, 6),
            "savedUSD": round(baseline - actual, 6), "notRepriced": notrepriced}


def collect_agents(projects_dir):
    """One row per agent type that ran as a subagent: how often, which model really answered, tokens and list-price cost."""
    rows, base = {}, Path(projects_dir)
    for meta in base.glob("*/*/subagents/*.meta.json") if base.is_dir() else []:
        try:
            kind = json.loads(meta.read_text(encoding="utf-8")).get("agentType")
        except (OSError, ValueError):
            continue
        per = read_log(meta.with_name(meta.name[: -len(".meta.json")] + ".jsonl"))
        if not isinstance(kind, str) or not per:
            continue
        r = rows.setdefault(kind[:40], {"calls": 0, "models": set(), "costUSD": 0.0, **dict.fromkeys(FIELDS, 0)})
        r["calls"] += 1
        for name, t in per.items():
            r["models"].add(name)
            r["costUSD"] += price(name, t) or 0.0
            for f in FIELDS:
                r[f] += t[f]
    return {k: {**v, "models": sorted(v["models"]), "costUSD": round(v["costUSD"], 6)} for k, v in sorted(rows.items())}
