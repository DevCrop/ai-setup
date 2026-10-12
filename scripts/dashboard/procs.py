"""The only place the dashboard starts a process (scripts/qa-spawn-guard.py fails on any other).
pythonw has no console, so a console child (bash, git, gh, rtk) would open its own window on every refresh unless it is hidden."""
import os, shutil, subprocess
from pathlib import Path


def which(name, windows=None):
    """shutil.which, except on Windows a hit in the current folder that is not on PATH: Windows searches the current folder first, so a
    rtk.exe or codex.exe lying in the folder the dashboard was started from would be run on every refresh (same rule as toolreg.which)."""
    w = shutil.which(name)
    if windows is None:
        windows = os.name == "nt"
    if not w or not windows:
        return w
    try:
        parent, cwd = Path(w).resolve().parent, Path.cwd().resolve()
        on_path = {Path(p).resolve() for p in os.environ.get("PATH", "").split(os.pathsep) if p}
    except OSError:
        return w
    return None if parent == cwd and cwd not in on_path else w


def resolve(cmd, windows=None):
    """cmd with a bare program name replaced by its path from which(); a name found nowhere else raises FileNotFoundError. CreateProcess
    would otherwise also search the current folder for the bare name."""
    if not cmd or os.sep in cmd[0] or "/" in cmd[0]:
        return list(cmd)
    w = which(cmd[0], windows)
    if not w:
        raise FileNotFoundError(cmd[0])
    return [w, *cmd[1:]]


def find_bash():
    # On Windows, `bash` on PATH can be WSL's with another HOME; verify.sh needs Git Bash.
    for c in (os.environ.get("BASH"), "C:/Program Files/Git/bin/bash.exe", "C:/Program Files (x86)/Git/bin/bash.exe"):
        if c and Path(c).exists():
            return c
    return "bash"


BASH = find_bash()
ENV = {**os.environ, "HOME": os.environ.get("USERPROFILE", os.environ.get("HOME", ""))} if os.name == "nt" else None


class ProcessRunner:
    def __init__(self, cwd, env=ENV):
        self.cwd, self.env = cwd, env

    def spawn(self, cmd, timeout=60, cwd=None):
        flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        return subprocess.run(resolve(cmd), cwd=cwd or self.cwd, env=self.env, capture_output=True, text=True, timeout=timeout, encoding="utf-8", errors="replace", creationflags=flags)

    def run(self, cmd, timeout=60):
        """stdout of the command, or "" on any failure: a missing tool must not take a panel down."""
        try:
            return self.spawn(cmd, timeout).stdout
        except Exception:
            return ""
