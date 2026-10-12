"""Tool registry (tools.json) and per-machine settings (state/machine.json), shared by bootstrap.py and the dashboard.

Read-only: finds tools, versions, setup checkouts and project roots. Nothing here installs or writes, except write_machine().
Precedence for every per-machine value: environment variable > state/machine.json > legacy state/*.txt file > registry candidates.
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


def write_machine(found, repo=REPO):
    """Add detected values to state/machine.json. A value already there wins: the user may have set it by hand.
    A file that exists but does not parse is refused (ValueError): rewriting it from scratch would lose the hand edits in it."""
    f = repo / "state" / "machine.json"
    if f.exists():
        try:
            json.loads(f.read_text(encoding="utf-8-sig"))
        except ValueError:
            raise ValueError(str(f) + " is not valid JSON; fix it by hand first")
    m = load_machine(repo)
    for key, val in found.items():
        if isinstance(val, dict):
            cur = m.get(key) if isinstance(m.get(key), dict) else {}
            m[key] = {**val, **cur}
        elif key not in m:
            m[key] = val
    f.parent.mkdir(exist_ok=True)
    f.write_text(json.dumps(m, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
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


def find_bin(entry, machine, toks):
    """(path, where it came from). A path from the env var or machine.json that does not exist is reported, not silently skipped."""
    env = entry.get("env")
    if env and os.environ.get(env):
        p = os.environ[env]
        return (shutil.which(p) or (p if Path(p).exists() else None)), env
    mp = (machine.get("bin") or {}).get(entry["id"])
    if isinstance(mp, str) and mp:
        return (shutil.which(mp) or (mp if Path(mp).exists() else None)), "machine.json"
    names = [w for w in (shutil.which(n) for n in entry.get("bin", [])) if w]
    if len(names) > 1 and entry.get("version"):  # e.g. a Windows Store python3 stub ahead of a real python: take the first that answers
        for w in names:
            if run_version(w, entry["version"]):
                return w, "PATH"
    if names:
        return names[0], "PATH"
    for tpl in entry.get("paths", []):
        p = expand(tpl, toks)
        if p is not None and p.exists():
            return str(p), "path"
    return None, None


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
    if s.get("env") and os.environ.get(s["env"]):
        out.append((s["env"], Path(os.environ[s["env"]]).expanduser()))
    mc = (machine.get("checkout") or {}).get(entry["id"])
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
    elif isinstance(machine.get("projectRoots"), list):
        lines, src = [x for x in machine["projectRoots"] if isinstance(x, str)], "machine.json"
    else:
        f = repo / "state" / "project-roots.txt"
        try:
            lines, src = f.read_text(encoding="utf-8", errors="replace").splitlines(), "state/project-roots.txt"
        except OSError:
            d = Path(toks["HOME"]) / "Projects"
            return ([d] if d.is_dir() else []), "default"
    return [Path(l.strip()).expanduser() for l in lines if l.strip() and not l.strip().startswith("#")], src


def install_command(entry, platform=sys.platform):
    i = entry.get("install") or {}
    if platform.startswith("win") and i.get("winget"):
        return "winget install --id " + i["winget"] + " --exact"
    if platform == "darwin" and i.get("cask"):
        return "brew install --cask " + i["cask"]
    if platform == "darwin" and i.get("brew"):
        return "brew install " + i["brew"]
    return ("공식 안내: " + i["url"]) if i.get("url") else None


def detect(entry, machine=None, toks=None, repo=REPO, spawn=None):
    """Everything known about one tool on this machine, as plain JSON-able values."""
    machine = load_machine(repo) if machine is None else machine
    toks = tokens(repo) if toks is None else toks
    exe, via = find_bin(entry, machine, toks)
    version = None
    if exe and entry.get("version") and via != "path":  # a path candidate may be a GUI app; starting it to ask its version would open a window
        version = run_version(exe, entry["version"], spawn)
    out = {"id": entry["id"], "label": entry.get("label", entry["id"]), "kind": entry.get("kind", "tool"),
           "required": bool(entry.get("required")), "disabled": entry["id"] in (machine.get("disabled") or []),
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
                        "tried": [s for s, _ in tried], "parser": entry["setup"].get("parser")}
    return out


def detect_all(repo=REPO, spawn=None):
    machine, toks = load_machine(repo), tokens(repo)
    return [detect(e, machine, toks, repo, spawn) for e in load_registry(repo)]
