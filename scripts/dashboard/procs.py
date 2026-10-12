"""The only place the dashboard starts a process (scripts/qa-spawn-guard.py fails on any other).
pythonw has no console, so a console child (bash, git, gh, rtk) would open its own window on every refresh unless it is hidden."""
import os, shutil, subprocess
from pathlib import Path


def which(name, windows=None):
    """shutil.which, except on Windows a bare name found in the current folder (not on PATH) is skipped in favour of the next copy on
    PATH, or None: Windows searches the current folder first, so a stray binary there would be run. Explicit paths pass unchanged."""
    w = shutil.which(name)
    if windows is None:
        windows = os.name == "nt"
    if not w or not windows or os.sep in name or "/" in name:  # only a bare name makes Windows search the current folder
        return w
    try:
        cwd = Path.cwd().resolve()
        if Path(w).resolve().parent != cwd:
            return w
        dirs = [p for p in os.environ.get("PATH", "").split(os.pathsep) if p]
        if any(Path(p).resolve() == cwd for p in dirs):
            return w  # the current folder is on PATH on purpose
        for p in dirs:  # a good copy further down PATH still counts (shutil.which(path=...) would add the cwd again, so ask per entry)
            r = shutil.which(name, path=p)
            if r and Path(r).resolve().parent != cwd:
                return r
    except OSError:
        return w
    return None


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
