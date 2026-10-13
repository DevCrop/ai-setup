"""TRACE owned-file deployment. Python 3.11+, standard library only."""
from __future__ import annotations

import argparse
import base64
from contextlib import contextmanager, ExitStack
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tempfile
import tomllib

ROOT = Path(__file__).resolve().parents[1]


@contextmanager
def deployment_lock(state):
    """OS lock releases on process exit; no stale PID lock to delete."""
    state.mkdir(parents=True, exist_ok=True)
    path = safe(state, "deployment.lock")
    with path.open("a+b") as handle:
        if handle.tell() == 0:
            handle.write(b"0")
            handle.flush()
        handle.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            raise ValueError("Another deployment is active") from exc
        try:
            yield
        finally:
            handle.seek(0)
            if os.name == "nt":
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def digest(data):
    return hashlib.sha256(data).hexdigest() if data is not None else None


def read_json(path, default=None):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=".trace-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def save_json(path, value):
    atomic(path, (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode())


def safe(root, relative):
    """Reject traversal, Windows aliases and symlink/junction ancestors."""
    p = PurePosixPath(relative)
    if p.is_absolute() or not p.parts or any(x in ("..", ".") for x in p.parts):
        raise ValueError(f"Unsafe relative path: {relative}")
    if "\\" in relative or ":" in relative or any(x.endswith((" ", ".")) for x in p.parts):
        raise ValueError(f"Unsafe path spelling: {relative}")
    target = root.joinpath(*p.parts)
    for ancestor in [target, *target.parents]:
        # macOS ships these filesystem aliases. Permit only their exact system
        # destinations, not arbitrary user symlinks or linked deployment roots.
        if sys.platform == "darwin" and str(ancestor) in ("/var", "/tmp", "/etc"):
            if ancestor.resolve() == Path("/private") / ancestor.name:
                continue
        if ancestor.is_symlink() or (ancestor.exists() and getattr(ancestor.lstat(), "st_file_attributes", 0) & 0x400):
            raise ValueError(f"Linked path refused: {ancestor}")
    if target.exists() and not target.is_file():
        raise ValueError(f"Expected regular file: {target}")
    return target


def content(path):
    return path.read_bytes() if path.exists() else None


def default_state(home):
    if os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData/Local"))
    elif sys.platform == "darwin":
        base = Path.home() / "Library/Application Support"
    else:
        base = Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local/state"))
    return base / "TRACE-Setup" / hashlib.sha256(str(home).encode()).hexdigest()[:16]


def patch_agents(raw, updates):
    text = (raw or b"").decode("utf-8-sig").replace("\r\n", "\n")
    parsed = tomllib.loads(text)
    agents = parsed.get("agents", {})
    if not isinstance(agents, dict):
        raise ValueError("agents must be a TOML table")
    # Only manage the manifest's agent_settings keys; preserve all other settings verbatim.
    match = re.search(r"(?m)^\[agents\][ \t]*(?:#.*)?$", text)
    if not match:
        if agents:
            raise ValueError("Nonstandard agents table syntax; manual migration required")
        text = text.rstrip() + "\n\n[agents]\n"
        start = len(text)
        end = start
    else:
        start = match.end()
        nxt = re.search(r"(?m)^\s*\[", text[start:])
        end = start + nxt.start() if nxt else len(text)
    block = text[start:end]
    for key, value in updates.items():
        pattern = rf"(?m)^[ \t]*{re.escape(key)}[ \t]*=.*(?:\n|$)"
        line = "" if value is None else f"{key} = {json.dumps(value)}\n"
        if re.search(pattern, block):
            block = re.sub(pattern, lambda _: line, block)
        elif value is not None:
            block = block.rstrip() + "\n" + line
    result = (text[:start] + block + text[end:]).encode()
    actual = tomllib.loads(result.decode())
    expected_agents = dict(parsed.get("agents", {}))
    for key, value in updates.items():
        if value is None:
            expected_agents.pop(key, None)
        else:
            expected_agents[key] = value
    expected = dict(parsed)
    expected["agents"] = expected_agents
    if actual != expected:
        raise ValueError("Ambiguous TOML edit refused: non-managed values or table structure changed")
    return result


def target_key(entry):
    root = entry.get('root', 'codex')
    if root not in ('codex', 'personal_skills'):
        raise ValueError('Unknown target root: ' + root)
    if entry['target'].startswith('@'):
        raise ValueError('Reserved target prefix')
    return ('@personal/' if root == 'personal_skills' else '') + entry['target']


class Deployment:
    def __init__(self, source=ROOT, home=None, state=None, personal_skills=None):
        self.source = Path(source).absolute()
        self.home = Path(home or os.environ.get("CODEX_HOME", Path.home() / ".codex")).expanduser().absolute()
        self.state = Path(state or default_state(self.home)).absolute()
        self.personal_skills = Path(personal_skills or Path.home() / '.agents/skills').expanduser().absolute()
        if self.personal_skills == self.home or self.personal_skills in self.home.parents or self.home in self.personal_skills.parents:
            raise ValueError('Deployment roots must not overlap')
        safe(self.home, "config.toml")
        safe(self.state, "installed.json")
        self.manifest = read_json(self.source / "manifest.json")
        self.record = read_json(self.state / "installed.json", {"files": {}})
        if self.record.get("home", str(self.home)) != str(self.home):
            raise ValueError("State belongs to a different Codex home")
        if self.record.get('personal_skills', str(self.personal_skills)) != str(self.personal_skills):
            raise ValueError('State belongs to a different personal skills root')

    def path(self, key):
        if key.startswith('@personal/'):
            return safe(self.personal_skills, key[len('@personal/'):])
        if key.startswith('@'):
            raise ValueError('Unknown root in ownership record')
        return safe(self.home, key)

    def inventory(self):
        unmanaged = []
        for root, prefix in ((self.home / 'skills', 'skills/'), (self.personal_skills, '@personal/')):
            if root.is_symlink() or (root.exists() and getattr(root.lstat(), 'st_file_attributes', 0) & 0x400):
                unmanaged.append(prefix + '[linked root; not scanned]')
                continue
            if root.is_dir():
                for folder in root.iterdir():
                    if folder.name == '.system':
                        continue
                    key = prefix + folder.name + '/SKILL.md'
                    try:
                        skill = self.path(key)
                        if skill.is_file() and key not in self.record['files']:
                            unmanaged.append(key)
                        elif folder.is_dir() and not skill.is_file():
                            unmanaged.append(prefix + folder.name + '/[missing SKILL.md]')
                    except ValueError:
                        unmanaged.append(prefix + folder.name + '/[linked; not scanned]')
        return sorted(unmanaged)

    def desired(self):
        result = {}
        for entry in self.manifest["files"]:
            target = target_key(entry)
            self.path(target)
            if target in result:
                raise ValueError(f"Duplicate target: {target}")
            data = safe(self.source, entry["source"]).read_bytes()
            if entry.get("kind") != "upstream-skill":
                data.decode("utf-8")
            if target.endswith(".toml"):
                tomllib.loads(data.decode())
            result[target] = data
        raw = content(safe(self.home, "config.toml"))
        updates = {k: self.record.get("original_agents", {}).get(k)
                   for k in self.record.get("agent_settings", {}) if k not in self.manifest["agent_settings"]}
        updates.update(self.manifest["agent_settings"])
        result["config.toml"] = patch_agents(raw, updates)
        return result

    def plan(self, adopt=False):
        wanted = self.desired()
        changes = []
        for rel in sorted(set(wanted) | set(self.record["files"])):
            before = content(self.path(rel))
            after = wanted.get(rel)
            known = self.record["files"].get(rel)
            conflict = False
            if rel == "config.toml":
                current = tomllib.loads((before or b"").decode("utf-8-sig")).get("agents", {})
                expected = self.record.get("agent_settings")
                if expected:
                    conflict = any(current.get(k) != v for k, v in expected.items())
            elif known:
                conflict = digest(before) != known["sha256"]
            elif before is not None and before != after:
                conflict = not adopt
            changes.append({"path": rel, "before": digest(before), "after": digest(after),
                            "action": "conflict" if conflict else "keep" if before == after else "remove" if after is None else "write"})
        # Explicit legacy retirement only with previously reviewed fingerprints.
        for legacy in self.manifest.get("retired", []):
            rel = target_key(legacy)
            if legacy.get("owned_only") and rel not in wanted:
                # Owned removals already use the recorded hash above; unowned copies stay.
                continue
            if rel in wanted or rel in self.record["files"]:
                raise ValueError(f"Retired target collides with managed target: {rel}")
            before = content(self.path(rel))
            if before is not None:
                changes.append({"path": rel, "before": digest(before), "after": None,
                                "action": "remove" if digest(before) == legacy["sha256"] else "conflict"})
        return changes

    def _write(self, rel, data):
        path = self.path(rel)
        root = self.personal_skills if rel.startswith('@personal/') else self.home
        if data is None:
            if path.exists():
                path.unlink()
            # Prune only parents of an owned removed file, and only when empty.
            parent = path.parent
            while parent != root:
                try:
                    parent.rmdir()
                except OSError:
                    break
                parent = parent.parent
        else:
            atomic(path, data)

    def apply(self, adopt=False):
        if (self.state / "pending.json").exists():
            raise ValueError("Interrupted transaction: run recover first")
        changes = self.plan(adopt)
        if any(x["action"] == "conflict" for x in changes):
            raise ValueError("Conflicts detected; run plan and resolve local edits")
        wanted = self.desired()
        original_config = content(safe(self.home, "config.toml"))
        original_agents = dict(self.record.get("original_agents", {}))
        current_agents = tomllib.loads((original_config or b"").decode("utf-8-sig")).get("agents", {})
        for key in self.manifest["agent_settings"]:
            if key not in original_agents:
                original_agents[key] = current_agents.get(key)
        changed = [x for x in changes if x["action"] != "keep"]
        if not changed and self.record.get("version") == self.manifest["version"]:
            return {"status": "unchanged", "files": len(changes)}
        journal = {"home": str(self.home), "personal_skills": str(self.personal_skills), "record": self.record, "files": {}}
        for row in changed:
            before = content(self.path(row["path"]))
            if digest(before) != row["before"]:
                raise ValueError("File changed while planning")
            journal["files"][row["path"]] = {"before": None if before is None else base64.b64encode(before).decode(), "after": row["after"]}
        save_json(self.state / "pending.json", journal)
        try:
            for row in changed:
                if digest(content(self.path(row["path"]))) != row["before"]:
                    raise ValueError("Concurrent edit detected")
                self._write(row["path"], wanted.get(row["path"]))
            record = {"version": self.manifest["version"], "home": str(self.home),
                      "applied_at": datetime.now(timezone.utc).isoformat(),
                      "personal_skills": str(self.personal_skills),
                      "files": {p: {"sha256": digest(d)} for p, d in wanted.items()},
                      "agent_settings": self.manifest["agent_settings"],
                      "original_agents": original_agents,
                      "original_config": self.record.get("original_config", None if original_config is None else base64.b64encode(original_config).decode())}
            for p, data in wanted.items():
                if digest(content(self.path(p))) != digest(data):
                    raise ValueError(f"Post-write verification failed: {p}")
            save_json(self.state / "installed.json", record)
            os.replace(self.state / "pending.json", self.state / "previous.json")
            self.record = record
        except Exception:
            self.restore("pending.json")
            raise
        return {"status": "applied", "changed": len(changed)}

    def restore(self, name="previous.json"):
        path = self.state / name
        journal = read_json(path)
        if not journal or journal["home"] != str(self.home):
            raise ValueError("No matching restore point")
        if journal.get('personal_skills', str(self.personal_skills)) != str(self.personal_skills):
            raise ValueError('Restore point belongs to a different personal skills root')
        decoded = {p: None if v["before"] is None else base64.b64decode(v["before"]) for p, v in journal["files"].items()}
        for p, row in journal["files"].items():
            actual = digest(content(self.path(p)))
            if actual not in (row["after"], digest(decoded[p])):
                raise ValueError(f"Restore conflicts with local edits: {p}")
        for p, data in decoded.items():
            self._write(p, data)
        save_json(self.state / "installed.json", journal["record"])
        path.unlink()
        self.record = journal["record"]
        return {"status": "restored"}

    def verify(self):
        if (self.state / "pending.json").exists():
            raise ValueError("Interrupted transaction requires recovery")
        wanted = self.desired()
        errors = []
        if self.record.get("version") != self.manifest["version"]:
            errors.append("Installed version differs from manifest")
        if set(self.record["files"]) != set(wanted):
            errors.append("Ownership inventory differs from manifest")
        for p, data in wanted.items():
            actual = content(self.path(p))
            if p == "config.toml":
                parsed = tomllib.loads((actual or b"").decode("utf-8-sig"))
                if any(parsed.get("agents", {}).get(k) != v for k, v in self.manifest["agent_settings"].items()):
                    errors.append(p)
                profiles = parsed.get("profiles", {})
                for entry in self.manifest["files"]:
                    target = entry["target"]
                    if entry.get("root", "codex") == "codex" and "/" not in target and target.endswith(".config.toml"):
                        name = target[:-len(".config.toml")]
                        if isinstance(profiles, dict) and name in profiles:
                            errors.append(f"Legacy profile clash: config.toml profiles.{name} conflicts with {target}")
            elif actual != data:
                errors.append(p)
            elif self.record["files"].get(p, {}).get("sha256") != digest(data):
                errors.append("ownership-hash:" + p)
        for item in self.manifest.get("retired", []):
            key = target_key(item)
            if item.get("owned_only") and key not in self.record["files"]:
                continue
            if self.path(key).exists():
                errors.append("retired:" + key)
        return {"status": "pass" if not errors else "fail", "errors": errors,
                "unmanaged_skill_findings": self.inventory(),
                "limit": "Only manifest-owned files and retired targets are verified; app runtime exposure is separate."}

    def uninstall(self):
        if (self.state / "pending.json").exists():
            raise ValueError("Recover pending transaction first")
        if not self.record["files"]:
            return {"status": "unchanged", "reason": "No managed installation"}
        targets = {}
        for p, row in self.record["files"].items():
            actual = content(self.path(p))
            if p == "config.toml":
                parsed = tomllib.loads((actual or b"").decode("utf-8-sig"))
                if any(parsed.get("agents", {}).get(k) != v for k, v in self.record["agent_settings"].items()):
                    raise ValueError("Managed config keys modified")
                origin = self.record.get("original_config")
                origin_bytes = None if origin is None else base64.b64decode(origin)
                expected = patch_agents(origin_bytes, self.record["agent_settings"])
                if actual == expected:
                    targets[p] = origin_bytes
                else:
                    # Restore only keys we still own. Released keys may have
                    # subsequently been edited by the user.
                    targets[p] = patch_agents(actual, {k: self.record["original_agents"].get(k)
                                                       for k in self.record["agent_settings"]})
                    origin_parsed = tomllib.loads((origin_bytes or b"").decode("utf-8-sig"))
                    restored = tomllib.loads(targets[p].decode())
                    if "agents" not in origin_parsed and restored.get("agents") == {}:
                        cleaned = re.sub(r"(?m)^\[agents\][ \t]*(?:#.*)?\n(?:[ \t]*\n)*", "", targets[p].decode())
                        if tomllib.loads(cleaned) == {k: v for k, v in restored.items() if k != "agents"}:
                            targets[p] = cleaned.encode()
            else:
                if digest(actual) != row["sha256"]:
                    raise ValueError(f"Modified managed file: {p}")
                targets[p] = None
        journal = {"home": str(self.home), "personal_skills": str(self.personal_skills), "record": self.record, "files": {
            p: {"before": base64.b64encode(content(self.path(p))).decode(), "after": digest(data)} for p, data in targets.items()}}
        save_json(self.state / "pending.json", journal)
        try:
            for p, data in targets.items():
                before = base64.b64decode(journal["files"][p]["before"])
                if content(self.path(p)) != before:
                    raise ValueError(f"Concurrent edit detected during uninstall: {p}")
                self._write(p, data)
            for p, data in targets.items():
                if content(self.path(p)) != data:
                    raise ValueError(f"Uninstall verification failed: {p}")
            save_json(self.state / "installed.json", {"files": {}})
            os.replace(self.state / "pending.json", self.state / "previous.json")
            self.record = {"files": {}}
        except Exception:
            self.restore("pending.json")
            raise
        return {"status": "uninstalled", "limit": "Removed manifest-owned files, including bundled skills; preserved unmanaged files."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["plan", "apply", "verify", "rollback", "recover", "uninstall", "doctor"])
    parser.add_argument("--home", type=Path)
    parser.add_argument("--state", type=Path)
    parser.add_argument('--personal-skills', type=Path, help='Personal skill root; defaults to ~/.agents/skills independently of CODEX_HOME')
    parser.add_argument("--source", type=Path, default=ROOT)
    parser.add_argument("--adopt-existing", action="store_true", help="Adopt reviewed pre-existing target files on first install")
    parser.add_argument("--codex", help="Explicit CLI executable")
    args = parser.parse_args()
    try:
        dep = Deployment(args.source, args.home, args.state, args.personal_skills)
        if args.command == "doctor":
            exe = args.codex or shutil.which("codex")
            if not exe:
                raise ValueError("Codex CLI not on PATH; provide --codex with an executable path")
            proc = subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=15)
            result = {"codex_version": proc.stdout.strip(), "exit_code": proc.returncode,
                      "home_exists": dep.home.is_dir(), "python": sys.version.split()[0],
                      'unmanaged_skills': dep.inventory(),
                      'skill_roots': {'codex': str(dep.home), 'personal_skills': str(dep.personal_skills)}}
        elif args.command == "plan":
            result = dep.plan(args.adopt_existing)
        elif args.command in ("apply", "rollback", "recover", "uninstall"):
            # Different CODEX_HOME installs may share one personal skill root.
            with ExitStack() as locks:
                for lock_state in sorted({dep.state, default_state(dep.personal_skills)}, key=str):
                    locks.enter_context(deployment_lock(lock_state))
                dep = Deployment(args.source, args.home, args.state, args.personal_skills)
                if args.command == "apply":
                    result = dep.apply(args.adopt_existing)
                elif args.command in ("rollback", "recover"):
                    result = dep.restore("previous.json" if args.command == "rollback" else "pending.json")
                else:
                    result = dep.uninstall()
        else:
            result = getattr(dep, args.command)()
        print(json.dumps(result, ensure_ascii=False, indent=2))
        if isinstance(result, dict) and result.get("status") == "fail":
            return 1
        if isinstance(result, list) and any(r["action"] == "conflict" for r in result):
            return 1
        return 0
    except (ValueError, OSError, subprocess.SubprocessError) as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
