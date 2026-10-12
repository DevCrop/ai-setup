"""Facts about what RTK, claude-mem, AO and the model routing actually do for this setup. Numbers only come from the tools' own
counters or from files; anything we cannot read is reported as "unavailable" and never filled in with a guess.

Metric basis: measured (the tool's own counter or a file), estimated (the tool's own estimate, or arithmetic over measured values),
unavailable (no way to read it from here). To add a tool: subclass EfficiencySource and pass an instance to EfficiencyReport in server.py."""
import json, re, urllib.request
import usage
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from pathlib import Path


def metric(label, value, basis, note=""):
    return {"label": label, "value": value, "basis": basis, "note": note}


def unavailable(label, why):
    return metric(label, "측정 불가", "unavailable", why)


def _k(n):
    return f"{n / 1e6:.1f}M" if n >= 1e6 else f"{n / 1000:.1f}K" if n >= 1000 else str(int(n))


def _usd(x):
    return f"${x:.4f}" if x < 0.1 else f"${x:.2f}"


class EfficiencySource(ABC):
    name = ""   # tab key
    title = ""  # shown to the user

    @abstractmethod
    def collect(self):
        """{"metrics": [metric...], "caveats": [str...], "ideas": [str...]}; ideas must follow from the metrics above them."""


class EfficiencyReport:
    def __init__(self, *sources):
        self.sources = sources

    def collect(self):
        out = []
        for s in self.sources:
            try:
                d = s.collect()
            except Exception as e:  # one tool failing must not blank the others
                d = {"metrics": [], "caveats": ["읽는 중 오류가 났습니다: " + type(e).__name__], "ideas": []}
            out.append({"name": s.name, "title": s.title, **d})
        return {"at": datetime.now(timezone.utc).isoformat(), "sources": out}


class RtkEfficiency(EfficiencySource):
    name, title = "rtk", "RTK (명령 출력 압축)"
    ROW = re.compile(r"^\s*\d+\.\s+(.+?)\s{2,}(\d+)\s+([\d.]+)([KM]?)\s+([\d.]+)%", re.M)

    def __init__(self, runner):
        self.runner = runner

    def collect(self):
        raw = self.runner.run(["rtk", "gain", "-d", "-f", "json"], timeout=20)
        d = json.loads(raw)
        s, days = d["summary"], d.get("daily", [])
        saved, inp = s["total_saved"], s["total_input"]
        m = [metric("실행한 명령", f"{s['total_commands']:,}개", "measured", f"{days[0]['date']} ~ {days[-1]['date']} ({len(days)}일)" if days else ""),
             metric("절감한 토큰", f"{_k(saved)} ({s['avg_savings_pct']:.1f}%)", "estimated", f"입력 {_k(inp)} → 출력 {_k(s['total_output'])}. RTK가 크기로 추정한 값이며 청구 토큰이 아닙니다"),
             metric("명령당 지연", f"평균 {s['avg_time_ms']}ms", "measured")]
        caveats = ["RTK는 도구 출력만 줄입니다. 모델 입력 전체(대화, 시스템 프롬프트, 파일 읽기)에서 차지하는 비중은 측정하지 못했습니다."]
        ideas = []
        rows = [(a.strip(), int(n), float(v) * {"": 1, "K": 1e3, "M": 1e6}[u]) for a, n, v, u, _ in self.ROW.findall(self.runner.run(["rtk", "gain"], timeout=20))]
        if len(rows) >= 3 and saved:
            top = sorted((r[2] for r in rows), reverse=True)[:3]
            share = sum(top) / saved
            m.append(metric("상위 3개 명령의 절감 비중", f"{share * 100:.0f}%", "estimated", "rtk gain 표의 상위 명령 기준"))
            if share >= 0.3:
                ideas.append(f"절감의 {share * 100:.0f}%가 상위 3개 명령에서 나왔습니다. 평균 {s['avg_savings_pct']:.0f}%는 대표값이 아니니 일별 절감률도 같이 보세요.")
        rec = self.runner.run(["rtk", "gain", "--recalls"], timeout=20)
        el = rc = 0
        for e, r in re.findall(r"^\S+\s+(\d+)\s+(\d+)\s+\d+%", rec, re.M):
            el, rc = el + int(e), rc + int(r)
        if el:
            m.append(metric("재호출(recall)", f"{rc}/{el}회", "measured", "압축된 출력을 에이전트가 다시 요청한 횟수. 높으면 절감이 상쇄됩니다"))
            ideas.append("재호출이 없어 과도한 압축의 증거는 없습니다. 지금 설정을 유지해도 됩니다." if rc == 0 else f"재호출이 {rc}회 있습니다. 해당 필터의 상한을 늘리거나 RTK에 보고하세요.")
        if days:
            pct = [x["savings_pct"] for x in days if x["commands"] >= 100]
            if len(pct) >= 2:
                ideas.append(f"하루 100개 이상 실행한 날의 절감률은 {min(pct):.0f}%~{max(pct):.0f}%로 갈립니다. 하루 평균보다 명령 종류가 효과를 좌우합니다.")
        return {"metrics": m, "caveats": caveats, "ideas": ideas}


class MemEfficiency(EfficiencySource):
    name, title = "mem", "claude-mem (기억 저장과 주입)"

    def __init__(self, mem_dir, port=37777):
        self.mem_dir, self.port = Path(mem_dir), port

    def collect(self):
        with urllib.request.urlopen(f"http://127.0.0.1:{self.port}/api/stats", timeout=3) as r:
            db = json.load(r).get("database") or {}
        st = {}
        try:
            st = json.loads((self.mem_dir / "settings.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            pass
        obs = db.get("observations") or 0
        m = [metric("저장된 관찰", f"{obs:,}건", "measured", f"세션 {db.get('sessions')} · 요약 {db.get('summaries')} · DB {round((db.get('size') or 0) / 1048576, 1)}MB"),
             metric("관찰자 모델", st.get("CLAUDE_MEM_MODEL") or "?", "measured", "관찰을 만드는 모델. 세션마다 호출되어 토큰을 씁니다"),
             metric("세션 시작 때 주입", f"최대 {st.get('CLAUDE_MEM_CONTEXT_OBSERVATIONS', '?')}건", "measured", "CLAUDE_MEM_CONTEXT_OBSERVATIONS"),
             unavailable("절감 토큰", "워커 API가 토큰 수를 내놓지 않습니다. 세션 시작 문구의 '% savings'는 claude-mem 자체 추정입니다"),
             unavailable("관찰자가 쓴 토큰", "사용량 API가 없어 이 대시보드에서 읽을 수 없습니다")]
        first = db.get("firstObservationAt")
        ideas = []
        if first:
            try:
                hrs = max((datetime.now(timezone.utc) - datetime.fromisoformat(first.replace("Z", "+00:00"))).total_seconds() / 3600, 0.1)
                m.append(metric("관찰 생성 속도", f"{obs / hrs:.0f}건/시간", "estimated", f"첫 관찰 {first[:10]} 이후 평균"))
            except ValueError:
                pass
        ideas.append("절감 효과를 숫자로 보려면 관찰자 토큰 사용량과 주입 토큰을 claude-mem에서 받아와야 합니다. 지금은 비용과 효과 어느 쪽도 측정하지 못합니다.")
        return {"metrics": m, "caveats": ["'기억이 있어서 줄었다'는 주장은 이 데이터로 확인되지 않습니다. 저장량과 모델 설정만 사실입니다."], "ideas": ideas}


class AoEfficiency(EfficiencySource):
    name, title = "ao", "AO (병렬 에이전트 오케스트레이터)"

    def __init__(self, get_ao):
        self.get_ao = get_ao

    def collect(self):
        ao = self.get_ao() or {}
        ss = ao.get("sessions") or []
        run = sum(1 for s in ss if not s.get("isTerminated") and s.get("status") != "terminated")
        d = ao.get("daemon") or {}
        m = [metric("데몬", f"{d.get('state', '?')} · 포트 {d.get('port', '?')}", "measured", f"가동 {d.get('uptime', '?')}"),
             metric("세션", f"전체 {len(ss)} · 실행 {run} · 종료 {len(ss) - run}", "measured", f"프로젝트 {len(ao.get('projects') or [])}개"),
             unavailable("토큰 절감", "AO는 토큰을 줄이지 않습니다. 병렬 실행과 리뷰 격리가 목적이라 토큰 지표가 없습니다"),
             unavailable("리뷰 건수", "상태 API에 리뷰 집계가 없습니다")]
        ideas = []
        if ss and run == 0:
            ideas.append(f"지금 실행 중인 세션이 없고 종료된 {len(ss)}개만 남아 있습니다. 쓰지 않는 동안 데몬을 켜 둘 이유가 있는지 정하세요.")
        return {"metrics": m, "caveats": ["AO의 효과는 병렬화와 독립 리뷰 품질입니다. 이 화면의 숫자로는 그 효과를 판단할 수 없습니다."], "ideas": ideas}


class ModelEfficiency(EfficiencySource):
    name, title = "models", "모델 배치"

    def __init__(self, agents):
        self.agents = agents  # function returning inventory.agents()

    def collect(self):
        ag = self.agents()
        by = {}
        for a in ag:
            by.setdefault(a["model"], []).append(a["name"])
        m = [metric(f"{k} 에이전트", f"{len(v)}개", "measured", ", ".join(v)) for k, v in sorted(by.items())]
        m.append(unavailable("모델별 사용량과 비용", "세션 로그에서 모델별 토큰을 집계하지 않습니다"))
        ro = [a["name"] for a in ag if not re.search(r"Edit|Write", a["tools"]) and a["model"] != "haiku"]
        ideas = []
        if ro:  # the one measurement we have is written in docs/evidence.md ("모델 배치 재검토"); quote it, do not redo it from memory
            ideas.append("읽기 전용 에이전트(" + ", ".join(ro) + ")를 haiku로 낮추는 비교는 문서에 있습니다(2026-10-11, qa 4건 x 1회: 합계 0.75달러 대 1.03달러, 약 27% 절감). 검증 역할은 거짓 통과가 가장 비싼 실패라 표본이 3회 이상, reviewer 시나리오가 있을 때까지 바꾸지 않기로 했습니다. 전체 역할 QA 1회(2026-10-11)의 모델별 비용은 Sonnet 76%, Opus(advisor) 22%, Haiku 3%라, 서브에이전트를 더 haiku로 옮겨도 줄일 수 있는 몫은 작습니다.")
        return {"metrics": m, "caveats": ["Fable은 Max에서 같은 주간 한도의 최대 50% 몫이고 가장 빨리 소모되어 기본 라우팅에서 뺍니다(공식 지원 문서, 2026-10-11). 이 표에는 정의 파일에 적힌 모델만 보입니다."], "ideas": ideas}


BUILTIN_AGENTS = frozenset(("Explore", "Plan", "general-purpose", "claude", "claude-code-guide", "statusline-setup"))


class UsageEfficiency(EfficiencySource):
    name, title = "usage", "모델별 사용량과 절감 (세션 로그)"

    def __init__(self, projects_dir, agents):
        self.projects_dir, self.agents = projects_dir, agents  # agents: function returning inventory.agents()

    def collect(self):
        u, ran = usage.collect(self.projects_dir), usage.collect_agents(self.projects_dir)
        if not u["sessions"]:
            return {"metrics": [unavailable("모델별 사용량", "세션 로그에서 사용량을 읽지 못했습니다")], "caveats": [], "ideas": [], "data": None}
        by = u["models"]
        tok = lambda t: t["input"] + t["write5m"] + t["write1h"] + t["read"] + t["output"]
        m = [metric("집계한 세션", f"{u['sessions']}개", "measured", "메인 로그와 서브에이전트 로그, requestId로 중복 제거"),
             metric("실사용 비용(정가 환산)", f"${u['actualUSD']:.2f}", "estimated", "토큰은 로그 실측, 금액은 공식 정가 곱셈입니다. 구독 청구액이 아니라 한도 사용량의 상대 크기로 보세요"),
             metric("같은 토큰을 메인 모델로 돌렸다면", f"${u['baselineUSD']:.2f}", "estimated", "각 세션에서 출력을 가장 많이 쓴 모델의 정가로 다시 계산. 같은 토큰이 들었다는 가정입니다"),
             metric("모델 배치로 줄인 몫", f"${u['savedUSD']:.2f} ({(u['savedUSD'] / u['baselineUSD'] * 100) if u['baselineUSD'] else 0:.1f}%)", "estimated", "위 두 값의 차이")]
        for k, t in sorted(by.items(), key=lambda kv: -(kv[1]["costUSD"] or 0)):
            m.append(metric(f"{k} 사용", _usd(t["costUSD"]), "estimated", f"토큰 수는 로그 실측, 금액은 정가 곱셈. 토큰 {_k(tok(t))} · 출력 {_k(t['output'])} · 캐시 읽기 {_k(t['read'])}") if k != "other" else unavailable("other 모델 사용", f"단가표에 없는 모델이라 환산하지 않았습니다(토큰 {_k(tok(t))})"))
        defined = {a["name"].lower(): a["model"] for a in self.agents()}
        shown = {}  # an agent type name leaves the machine only if this repo defines it or it is a built-in; any other (a custom name can be a customer's) becomes "other"
        for k, v in ran.items():
            n = k.lower() if k.lower() in defined or k in BUILTIN_AGENTS else "other"
            if n in shown:
                shown[n] = {**shown[n], "calls": shown[n]["calls"] + v["calls"], "costUSD": shown[n]["costUSD"] + v["costUSD"], "models": sorted(set(shown[n]["models"]) | set(v["models"]))}
            else:
                shown[n] = v
        rows = []
        for name in sorted(set(defined) | set(shown)):
            r = shown.get(name)
            rows.append({"name": name, "defined": defined.get(name, "(여러 종류)" if name == "other" else "(내장)"), "actual": r["models"] if r else [], "calls": r["calls"] if r else 0, "costUSD": r["costUSD"] if r else 0})
        mism = [r["name"] for r in rows if r["actual"] and r["defined"] not in ("(상속)", "(내장)", "(여러 종류)") and not all(r["defined"].lower() in a for a in r["actual"])]
        ideas = []
        if mism:
            ideas.append("정의 파일의 모델과 실제 응답 모델이 다른 에이전트: " + ", ".join(mism) + ". 정의 파일이나 호출 때의 model 지정을 확인하세요.")
        if u["baselineUSD"]:
            share = u["savedUSD"] / u["baselineUSD"]
            ideas.append(f"모델 배치로 줄인 몫은 {share * 100:.1f}%입니다. " + ("이 로그에서는 비용 대부분이 메인 모델의 캐시 읽기와 출력이라, 서브에이전트 배치만 바꿔서는 이 비율이 크게 달라지지 않을 수 있습니다(세션이 늘면 다시 확인하세요)." if share < 0.15 else "배치를 바꾸는 효과가 큰 편이니 어느 에이전트가 기여했는지 아래 표에서 보세요."))
        return {"metrics": m, "ideas": ideas, "data": {"actualUSD": u["actualUSD"], "baselineUSD": u["baselineUSD"], "savedUSD": u["savedUSD"], "models": {k: {"costUSD": t["costUSD"], "output": t["output"]} for k, t in by.items()}, "agents": rows},
                "caveats": ["절감액은 '같은 토큰이 메인 모델에서도 들었다'는 가정의 계산입니다. 싼 모델이 같은 품질로 해냈는지는 로그로 알 수 없어 품질은 반영하지 않습니다.",
                            "트랜스크립트에 남지 않는 호출(세션 제목, 훅 분류기)은 집계되지 않습니다. 로그의 modelUsage 합계는 중간에 멈춘 사례가 있어 쓰지 않았습니다.",
                            "가격은 공식 가격표(2026-10-12 확인) 기준이며 Haiku 5.5의 10만 토큰 초과 요금 구간은 반영하지 않았습니다."]}
