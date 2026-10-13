"""One-click fixes. A fix is a class with a preview and a run; only classes registered in a FixRegistry can ever run.
To add a fix: subclass Fix, give it an id, register an instance in server.py. Nothing else changes."""
import json, os, re, shutil, subprocess, threading, urllib.request
from abc import ABC, abstractmethod
from datetime import datetime
from pathlib import Path

from fsutil import mem_dir
from procs import which


class Fix(ABC):
    id = ""

    @abstractmethod
    def preview(self):
        """What the fix would touch, without touching it: {"title", "targets", "reversible"}."""

    @abstractmethod
    def run(self, targets):
        """Do it. Called only with the targets the user confirmed and that still match preview()."""


class FixRegistry:
    def __init__(self):
        self._fixes = {}
        self._lock = threading.Lock()  # two simultaneous applies must not both pass the target check

    def register(self, fix):
        self._fixes[fix.id] = fix
        return fix

    def preview(self, fid):
        fix = self._fixes.get(fid)
        return fix.preview() if fix else None

    def apply(self, fid, targets):
        with self._lock:
            return self._apply(fid, targets)

    def _apply(self, fid, targets):
        pv = self.preview(fid)
        if not pv or not pv["targets"]:
            return {"ok": False, "msg": "할 일이 없거나 알 수 없는 조치입니다."}
        if sorted(targets) != sorted(pv["targets"]):  # the user confirmed a list; it must still be the current one
            return {"ok": False, "msg": "대상이 바뀌었습니다. 미리보기를 다시 확인하세요."}
        return self._fixes[fid].run(pv["targets"])


class MemRedactOn(Fix):
    id = "mem-redact-on"

    @staticmethod
    def settings_file():
        return mem_dir() / "settings.json"

    @classmethod
    def label(cls):
        """The settings file as the user sees it: ~/... under the home folder, else the full path (CLAUDE_MEM_DIR may point anywhere)."""
        f = cls.settings_file()
        try:
            return "~/" + f.relative_to(Path.home()).as_posix()
        except ValueError:
            return str(f)

    def preview(self):
        title = "claude-mem 비밀 마스킹 켜기 (설정 파일을 백업한 뒤 CLAUDE_MEM_REDACT_ENABLED만 변경)"
        try:
            d = json.loads(self.settings_file().read_text(encoding="utf-8"))
        except Exception:
            d = None
        if not isinstance(d, dict):  # missing or broken: run() would fail, so there is nothing to offer
            return {"title": title + " - 설정 파일이 없거나 읽을 수 없어 할 일이 없습니다", "targets": [], "reversible": True}
        on = str(d.get("CLAUDE_MEM_REDACT_ENABLED", "")).lower() == "true"
        return {"title": title, "targets": [] if on else [self.label()], "reversible": True}

    def run(self, targets):
        f = self.settings_file()
        shutil.copy2(f, f.with_name(f.name + ".bak-" + datetime.now().strftime("%Y%m%d-%H%M%S")))
        d = json.loads(f.read_text(encoding="utf-8"))
        d["CLAUDE_MEM_REDACT_ENABLED"] = "true"
        f.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
        return {"ok": True, "msg": "켰습니다. claude-mem 워커를 다시 시작해야 적용될 수 있습니다."}


class RtkUpdate(Fix):
    id = "rtk-update"

    def __init__(self, runner, cache):
        self.runner, self.cache = runner, cache

    @staticmethod
    def parse_version(text):
        m = re.search(r"(\d+)\.(\d+)\.(\d+)", text or "")
        return tuple(int(x) for x in m.groups()) if m else None

    @staticmethod
    def latest():
        try:
            req = urllib.request.Request("https://api.github.com/repos/rtk-ai/rtk/releases/latest", headers={"User-Agent": "ai-setup-dashboard"})
            with urllib.request.urlopen(req, timeout=5) as r:
                return json.load(r).get("tag_name")
        except Exception:
            return None

    @staticmethod
    def installer():
        """Update command for this machine: winget on Windows, brew on macOS. None when neither exists."""
        if which("winget"):
            return ["winget", "upgrade", "--id", "rtk-ai.rtk", "--silent", "--accept-package-agreements", "--accept-source-agreements"]
        if which("brew"):
            return ["brew", "upgrade", "rtk"]
        return None

    def preview(self):
        cmd = self.installer()
        cur, latest = self.runner.run(["rtk", "--version"], timeout=10).strip(), self.cache.get("rtk_latest", 3600, self.latest)
        a, b = self.parse_version(cur), self.parse_version(latest)
        due = bool(cmd and a and b and a < b)
        return {"title": "RTK 업데이트 (설치 관리자가 새 버전으로 교체, 이전 버전 복구는 수동)", "targets": [f"{cur} -> {latest}: {' '.join(cmd)}"] if due else [], "reversible": False}

    def run(self, targets):
        cmd = self.installer()
        if not cmd:
            return {"ok": False, "msg": "설치 관리자(winget 또는 brew)를 찾을 수 없습니다."}
        try:
            p = self.runner.spawn(cmd, timeout=300)
        except (OSError, subprocess.TimeoutExpired) as e:
            return {"ok": False, "msg": "실행 실패: " + type(e).__name__}
        self.cache.drop("rtk_latest")
        return {"ok": p.returncode == 0, "msg": f"설치 관리자 종료 코드 {p.returncode}. 새 버전은 `rtk --version`으로 확인하세요."}
