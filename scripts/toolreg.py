"""Tool registry (tools.json) and per-machine settings (state/machine.json), shared by bootstrap.py and the dashboard.

Read-only: finds tools, versions, setup checkouts and project roots. Nothing here installs or writes, except write_machine().
Precedence for every per-machine value: environment variable > state/machine.json > legacy state/*.txt file > registry candidates;
a setup marked inRepo (a folder of this repo) uses only its candidates.
Files are read and written as UTF-8 on purpose: candidate paths hold non-ASCII names and the Windows default code page is not UTF-8.
"""
import json, os, re, shutil, subprocess, sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent


def load_registry(repo=REPO):
    return json.loads((repo / "tools.json").read_text(encoding="utf-8"))["tools"]


def load_machine(repo=REPO):
    f = repo / "state" / "machine.json"
    try:
        m = json.loads(f.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        return {}
    return m if isinstance(m, dict) else {}


# The shape each machine.json key must have; a value of another type is ignored (and reported), never a crash.
MACHINE_TYPES = {"bin": dict, "checkout": dict, "disabled": list, "projectRoots": list}


def machine_problems(machine):
    """One line per key whose value has the wrong type, for bootstrap check to show."""
    return ["%s is %s, expected %s; ignored" % (k, type(machine[k]).__name__, t.__name__)
            for k, t in MACHINE_TYPES.items() if k in machine and not isinstance(machine[k], t)]


def _mget(machine, key):
    """machine[key] when it has the expected type, else an empty value of that type."""
    v = machine.get(key)
    return v if isinstance(v, MACHINE_TYPES[key]) else MACHINE_TYPES[key]()


def which(name, windows=None):
    """shutil.which, except on Windows a bare name found in the current folder (not on PATH) is skipped in favour of the next copy on
    PATH, or None: Windows searches the current folder first, so a stray binary there would be run. Explicit paths pass unchanged."""
    w = shutil.which(name)
    if windows is None:
        windows = os.name == "nt"
    if not w or not windows or os.sep in name or "/" in name:  # POSIX searches the cwd only when PATH asks; only a bare name makes Windows search it
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


def write_machine(found, repo=REPO):
    """Add detected values to state/machine.json. A value already there wins: the user may have set it by hand.
    A file that exists but does not parse is refused (ValueError): rewriting it from scratch would lose the hand edits in it."""
    f = repo / "state" / "machine.json"
    if f.exists():
        try:
            ok = isinstance(json.loads(f.read_text(encoding="utf-8-sig")), dict)
        except ValueError:
            ok = False
        if not ok:
            raise ValueError(str(f) + " is not a JSON object; fix it by hand first")
    m = load_machine(repo)
    for key, val in found.items():
        if key in m and not isinstance(m[key], type(val)):  # a wrong type is the user's to fix: it stays and keeps being reported
            continue
        if isinstance(val, dict):
            cur = m.get(key) if isinstance(m.get(key), dict) else {}
            m[key] = {**val, **cur}
        elif key not in m:
            m[key] = val
    f.parent.mkdir(exist_ok=True)
    tmp = f.with_name(f.name + ".tmp")  # written whole, then swapped in: an interrupted write never leaves a truncated machine.json
    try:
        tmp.write_text(json.dumps(m, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(tmp, f)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    return m


def documents_dir():
    """The user's Documents folder. On Windows it is a known folder that may be moved (OneDrive, another drive), so ask the shell."""
    if os.name == "nt":
        try:
            import ctypes
            buf = ctypes.create_unicode_buffer(260)
            if ctypes.windll.shell32.SHGetFolderPathW(None, 5, None, 0, buf) == 0 and buf.value:  # 5 = CSIDL_PERSONAL
                return Path(buf.value)
        except (OSError, AttributeError):
            pass
    return Path.home() / "Documents"


def tokens(repo=REPO):
    t = {"HOME": str(Path.home()), "DOCUMENTS": str(documents_dir()), "REPO": str(repo), "REPO_PARENT": str(repo.parent)}
    if os.environ.get("LOCALAPPDATA"):
        t["LOCALAPPDATA"] = os.environ["LOCALAPPDATA"]
    return t


def expand(s, toks):
    """A path template with ${TOKEN}s, or None when it uses a token this machine lacks (LOCALAPPDATA off Windows)."""
    missing = [k for k in re.findall(r"\$\{(\w+)\}", s) if k not in toks]
    return None if missing else Path(re.sub(r"\$\{(\w+)\}", lambda m: toks[m.group(1)], s))


def parse_version(text):
    m = re.search(r"\d+(?:\.\d+)+", text or "") or re.search(r"\d+", text or "")  # a dotted number first: a date or build number may come before it
    return m.group(0) if m else None


def version_ok(found, minimum):
    if not minimum:
        return True
    if not found:
        return False
    num = lambda v: tuple(int(x) for x in v.split("."))
    a, b = num(found), num(minimum)
    n = max(len(a), len(b))
    return a + (0,) * (n - len(a)) >= b + (0,) * (n - len(b))


def run_version(exe, args, spawn=None):
    try:
        if spawn:
            p = spawn([exe, *args], timeout=15)
        else:
            p = subprocess.run([exe, *args], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=15)
        return parse_version((p.stdout or "") + " " + (p.stderr or ""))
    except Exception:  # a broken binary is "found, version unknown", not a crash of the whole check
        return None


def find_bin(entry, machine, toks, spawn=None):
    """(path, where it came from, version if it was already read). A path from the env var or machine.json that does not exist is reported, not silently skipped."""
    env = entry.get("env")
    if env and os.environ.get(env):
        p = os.environ[env]
        return (which(p) or (p if Path(p).exists() else None)), env, None
    mp = _mget(machine, "bin").get(entry["id"])
    if isinstance(mp, str) and mp:
        return (which(mp) or (mp if Path(mp).exists() else None)), "machine.json", None
    names = [w for w in (which(n) for n in entry.get("bin", [])) if w]
    if len(names) > 1 and entry.get("version"):  # e.g. a Windows Store python3 stub ahead of a real python: take the first that answers
        for w in names:
            v = run_version(w, entry["version"], spawn)
            if v:
                return w, "PATH", v
    if names:
        return names[0], "PATH", None
    for tpl in entry.get("paths", []):
        p = expand(tpl, toks)
        if p is not None and p.exists():
            return str(p), "path", None
    return None, None, None


def is_checkout(d, markers):
    return d is not None and d.is_dir() and all((d / m).exists() for m in markers)


def first_line(p):
    """A BOM is dropped; a file in another encoding (UTF-16 from PowerShell 5.1) gives a path that is simply not found."""
    try:
        return p.read_text(encoding="utf-8-sig", errors="replace").strip().splitlines()[0].strip()
    except (OSError, IndexError):
        return ""


def checkout_candidates(entry, machine, toks, repo=REPO):
    """(where it came from, path) in the order they are tried."""
    s = entry.get("setup") or {}
    out = []
    if s.get("inRepo"):
        return [(tpl, p) for tpl in s.get("candidates", []) for p in [expand(tpl, toks)] if p is not None]
    if s.get("env") and os.environ.get(s["env"]):
        out.append((s["env"], Path(os.environ[s["env"]]).expanduser()))
    mc = _mget(machine, "checkout").get(entry["id"])
    if isinstance(mc, str) and mc:
        out.append(("machine.json", Path(mc).expanduser()))
    if s.get("legacy"):
        line = first_line(repo / s["legacy"])
        if line:
            out.append((s["legacy"], Path(line).expanduser()))
    for tpl in s.get("candidates", []):
        p = expand(tpl, toks)
        if p is not None:
            out.append((tpl, p))
    return out


def ignored_overrides(entry, machine, repo=REPO):
    """For an inRepo setup: the overrides that are set but not used (they named the old separate clone)."""
    s = entry.get("setup") or {}
    if not s.get("inRepo"):
        return []
    out = [s["env"]] if s.get("env") and os.environ.get(s["env"]) else []
    mc = _mget(machine, "checkout").get(entry["id"])
    if isinstance(mc, str) and mc:
        out.append("machine.json checkout." + entry["id"])
    if s.get("legacy") and first_line(repo / s["legacy"]):
        out.append(s["legacy"])
    return out


def find_checkout(entry, machine, toks, repo=REPO):
    tried = checkout_candidates(entry, machine, toks, repo)
    for source, d in tried:
        if is_checkout(d, entry["setup"].get("marker", [])):
            return d, source, tried
    return None, None, tried


def home_dir(entry, toks):
    h = entry.get("home") or {}
    if h.get("env") and os.environ.get(h["env"]):
        return Path(os.environ[h["env"]])
    return expand(h["default"], toks) if h.get("default") else None


def project_roots(machine, toks, repo=REPO):
    """Folders that hold projects. PROJECT_ROOTS > machine.json projectRoots > state/project-roots.txt > ${HOME}/Projects if it exists."""
    if "PROJECT_ROOTS" in os.environ:
        lines, src = os.environ["PROJECT_ROOTS"].split(os.pathsep), "PROJECT_ROOTS"
    elif isinstance(machine.get("projectRoots"), list):  # another type is reported by machine_problems and falls through
        lines, src = [x for x in machine["projectRoots"] if isinstance(x, str)], "machine.json"
    else:
        f = repo / "state" / "project-roots.txt"
        try:
            lines, src = f.read_text(encoding="utf-8-sig", errors="replace").splitlines(), "state/project-roots.txt"  # -sig: Notepad BOM
        except OSError:
            d = Path(toks["HOME"]) / "Projects"
            return ([d] if d.is_dir() else []), "default"
    return [Path(l.strip()).expanduser() for l in lines if l.strip() and not l.strip().startswith("#")], src


def install_argv(entry, platform=sys.platform):
    """The package-manager command that installs this entry here, or None when only a manual URL is known."""
    i = entry.get("install") or {}
    if platform.startswith("win") and i.get("winget"):
        return ["winget", "install", "--id", i["winget"], "--exact", "--no-upgrade"]
    # without this, brew install upgrades a formula or cask that is installed but outdated
    if platform == "darwin" and i.get("cask"):
        return ["env", "HOMEBREW_NO_INSTALL_UPGRADE=1", "brew", "install", "--cask", i["cask"]]
    if platform == "darwin" and i.get("brew"):
        return ["env", "HOMEBREW_NO_INSTALL_UPGRADE=1", "brew", "install", i["brew"]]
    return None


def upgrade_command(entry, platform=sys.platform):
    """The command that upgrades an installed entry: shown for a version that is too old, never run by bootstrap."""
    i = entry.get("install") or {}
    if platform.startswith("win") and i.get("winget"):
        return "winget upgrade --id %s --exact" % i["winget"]
    if platform == "darwin" and i.get("cask"):
        return "brew upgrade --cask " + i["cask"]
    if platform == "darwin" and i.get("brew"):
        return "brew upgrade " + i["brew"]
    return ("공식 안내: " + i["url"]) if i.get("url") else None


def install_command(entry, platform=sys.platform):
    argv = install_argv(entry, platform)
    if argv:
        return " ".join(argv)
    url = (entry.get("install") or {}).get("url")
    return ("공식 안내: " + url) if url else None


def detect(entry, machine=None, toks=None, repo=REPO, spawn=None):
    """Everything known about one tool on this machine, as plain JSON-able values."""
    machine = load_machine(repo) if machine is None else machine
    toks = tokens(repo) if toks is None else toks
    exe, via, version = find_bin(entry, machine, toks, spawn)
    if exe and not version and entry.get("version") and via != "path":  # a path candidate may be a GUI app; starting it to ask its version would open a window
        version = run_version(exe, entry["version"], spawn)
    out = {"id": entry["id"], "label": entry.get("label", entry["id"]), "kind": entry.get("kind", "tool"),
           "required": bool(entry.get("required")), "disabled": entry["id"] in _mget(machine, "disabled"),
           "found": bool(exe), "path": exe, "via": via, "version": version, "min": entry.get("min"),
           "versionOk": version_ok(version, entry.get("min")) if exe and version else (not entry.get("min") if exe else False),
           "install": install_command(entry), "note": entry.get("note", "")}
    h = home_dir(entry, toks)
    if h is not None:
        out["home"] = str(h)
        out["homeExists"] = h.is_dir()
    if entry.get("setup"):
        d, source, tried = find_checkout(entry, machine, toks, repo)
        out["setup"] = {"repo": entry["setup"]["repo"], "checkout": str(d) if d else None, "source": source,
                        "fromEnv": bool(source) and source == entry["setup"].get("env"),
                        "tried": [s for s, _ in tried], "parser": entry["setup"].get("parser"),
                        "inRepo": bool(entry["setup"].get("inRepo")), "ignored": ignored_overrides(entry, machine, repo)}
    return out


def detect_all(repo=REPO, spawn=None):
    machine, toks = load_machine(repo), tokens(repo)
    return [detect(e, machine, toks, repo, spawn) for e in load_registry(repo)]
