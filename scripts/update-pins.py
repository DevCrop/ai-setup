#!/usr/bin/env python3
"""Report newer upstream releases for the pinned items and the newest release of the unpinned tools.
With --write, move the pins up and record the newest releases; the weekly workflow (.github/workflows/updates.yml)
turns that diff into one PR. Nothing is installed anywhere.

Pinned items:
  claude/settings.json extraKnownMarketplaces  plugin `ref` (release tag) and `sha` (its commit), newest tag from git ls-remote
  codex/versions.lock.json skills              commit, version, vendored files (codex/vendor/<name>/) and their sha256
  codex/versions.lock.json tools.rtk           version, release_url, reviewed_at, and url + sha256 of each asset already locked
                                               (each needs a sha256 release digest equal to the downloaded bytes)
A plugin and a Codex skill with the same name (Ponytail) move together to the same tag, or not at all.
Unpinned tools: docs/tool-versions.json records the newest release seen (version, date); a change lists in the PR.
Python is the newest patch of the minor that tools.json's winget id installs. A version that is not a plain
version string is a failed source.

Usage: python3 scripts/update-pins.py [--write] [--root DIR]
Exit: 0 every source answered; 2 at least one source failed (the others are still reported and, with --write, written); 1 crash.
Standard library only, Python 3.11+. Uses $GITHUB_TOKEN for the GitHub API when it is set."""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

REPO = Path(__file__).resolve().parents[1]
SEMVER = re.compile(r"v?(\d+)\.(\d+)\.(\d+)")
GITHUB_API = "https://api.github.com/repos/"
SEEN_VERSION = re.compile(r"[0-9][0-9A-Za-z.+-]{0,40}")
SEEN_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")

# Unpinned tools: id -> (label, kind, where). The order is the order in docs/tool-versions.json and the report.
SEEN = {
    "claude": ("Claude Code", "npm", "@anthropic-ai/claude-code"),
    "codex": ("Codex CLI", "github", "openai/codex"),
    "git": ("Git for Windows", "github", "git-for-windows/git"),
    "jq": ("jq", "github", "jqlang/jq"),
    "gh": ("GitHub CLI", "github", "cli/cli"),
    "node": ("Node.js LTS", "node", "https://nodejs.org/dist/index.json"),
    "python": ("Python", "python", "https://raw.githubusercontent.com/actions/python-versions/main/versions-manifest.json"),
    "ao": ("Agent Orchestrator", "github", "OrchestratorInc/agent-orchestrator"),
}
SEEN_DOC = ("Newest upstream release seen for tools this repo does not pin; not what any PC has installed. "
            "Written by scripts/update-pins.py --write (weekly, .github/workflows/updates.yml); a changed version "
            "shows in that workflow's PR so each PC can run winget upgrade.")


class Net:
    """Network access. Tests pass an object with the same four methods."""

    def __init__(self):
        self.token = os.environ.get("GITHUB_TOKEN") or ""

    def tags(self, url):
        """`git ls-remote --tags` output for a repository URL."""
        env = dict(os.environ, GIT_TERMINAL_PROMPT="0")
        r = subprocess.run(["git", "ls-remote", "--tags", url], capture_output=True, text=True, timeout=90, env=env)
        if r.returncode:
            raise RuntimeError(f"git ls-remote exit {r.returncode}: {r.stderr.strip()[:200]}")
        return r.stdout

    def _get(self, url, limit):
        headers = {"User-Agent": "ai-setup-update-pins/1"}
        if url.startswith("https://api.github.com/"):
            headers["Accept"] = "application/vnd.github+json"
            if self.token:
                headers["Authorization"] = "Bearer " + self.token
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60) as resp:
            data = resp.read(limit + 1)
        if len(data) > limit:
            raise ValueError(f"response larger than {limit} bytes")
        return data

    def json(self, url):
        return json.loads(self._get(url, 32_000_000))

    def bytes(self, url):
        return self._get(url, 64_000_000)

    def tree(self, url, commit, path):
        """Files under `path` at `commit`, as {path relative to `path`: bytes}. Fetches that one commit; no checkout."""
        env = dict(os.environ, GIT_TERMINAL_PROMPT="0", GIT_LFS_SKIP_SMUDGE="1")
        with tempfile.TemporaryDirectory(prefix="update-pins-") as d:
            def git(*args, text=True):
                r = subprocess.run(["git", "-C", d, *args], capture_output=True, text=text, timeout=180, env=env)
                if r.returncode:
                    raise RuntimeError(f"git {args[0]} exit {r.returncode}")
                return r.stdout
            git("init", "-q")
            git("fetch", "-q", "--depth", "1", url, commit)
            out = {}
            for line in git("ls-tree", "-r", "-z", "--full-tree", commit, "--", path).split("\0"):
                if not line:
                    continue
                meta, name = line.split("\t", 1)
                mode, kind, blob = meta.split()
                if kind != "blob" or mode not in ("100644", "100755"):
                    raise ValueError(f"unexpected entry {mode} {kind} {plain(name)}")
                out[PurePosixPath(name).relative_to(path).as_posix()] = git("cat-file", "blob", blob, text=False)
            return out


def semver(tag):
    m = SEMVER.fullmatch(tag or "")
    return tuple(map(int, m.groups())) if m else None


def tag_commits(ls_remote):
    """{tag: commit} from `git ls-remote --tags` output. An annotated tag's peeled `^{}` line (the commit) wins
    over the tag object's own sha, whatever the line order."""
    plain, peeled = {}, {}
    for line in ls_remote.splitlines():
        parts = line.split()
        if len(parts) != 2 or not parts[1].startswith("refs/tags/"):
            continue
        sha, name = parts[0], parts[1][len("refs/tags/"):]
        if name.endswith("^{}"):
            peeled[name[:-3]] = sha
        else:
            plain[name] = sha
    return {**plain, **peeled}


def newest_stable(tags):
    stable = [t for t in tags if semver(t)]
    return max(stable, key=semver) if stable else None


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def load(path, default=None):
    if default is not None and not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def dump(data):
    return (json.dumps(data, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def plain(value):
    """An upstream string quoted in the report (the PR body): characters outside [0-9A-Za-z.+_-] become '?'."""
    return "'" + re.sub(r"[^0-9A-Za-z.+_-]", "?", str(value)[:60]) + "'"


def short(sha):
    return (sha or "")[:7]


class Run:
    def __init__(self, root, net, today):
        self.root, self.net, self.today = Path(root), net, today
        self.pins, self.seen, self.errors, self.notes = [], [], [], []
        self.writes = {}  # path relative to root -> bytes

    def error(self, item, exc):
        msg = exc if isinstance(exc, str) else f"{type(exc).__name__}: {str(exc)[:200]}"
        msg = re.sub(r"[^0-9A-Za-z.+_:/ ()'?=,-]", "?", msg)  # exception text can carry upstream text into the PR body
        self.errors.append(f"{item}: {msg}")

    def pin(self, label, current, newest, action):
        self.pins.append((label, current, newest, action))

    # ---- plugins and Codex skills (git tags) ----
    def check_tagged(self, settings, lock):
        """Plugins (settings.json) and Codex skills (versions.lock.json), newest stable tag from git. Edits both in place."""
        plugins = {}
        for market in (settings.get("extraKnownMarketplaces") or {}).values():
            for p in (market.get("source") or {}).get("plugins") or []:
                src = p.get("source") or {}
                if {"url", "ref", "sha"} <= set(src):
                    plugins[p["name"]] = src
        skills = {s["name"]: s for s in lock.get("skills", [])}
        for name in sorted(set(plugins) | set(skills)):
            plugin, skill = plugins.get(name), skills.get(name)
            pins = []
            if plugin:
                pins.append(("plugin", f"{name} plugin (claude/settings.json)", plugin["ref"], plugin["sha"]))
            if skill:
                pins.append(("skill", f"{name} Codex skill (codex/versions.lock.json)", "v" + skill["version"], skill["commit"]))
            labels = " + ".join(p[1] for p in pins)
            url = plugin["url"] if plugin else f"https://github.com/{skill['repository']}.git"
            try:
                tags = tag_commits(self.net.tags(url))
                newest = newest_stable(tags)
                if not newest:
                    raise ValueError("no stable vX.Y.Z tag")
            except Exception as exc:
                self.error(labels, exc)
                for _, label, cur, _ in pins:
                    self.pin(label, cur, "?", "source failed")
                continue
            for _, label, cur, sha in pins:
                if cur in tags and tags[cur] != sha:
                    self.notes.append(f"{label}: tag {cur} now points at {short(tags[cur])}, the pin has {short(sha)}; "
                                      "left as is, review by hand")
            behind = [p for p in pins if semver(p[2]) is None or semver(p[2]) < semver(newest)]
            for kind, label, cur, _ in pins:
                if not any(b[0] == kind for b in behind):
                    self.pin(label, cur, newest, "up to date" if semver(cur) == semver(newest) else "newer than upstream; left as is")
            if not behind:
                continue
            commit = tags[newest]
            if skill and any(b[0] == "skill" for b in behind):
                try:
                    files = self.net.tree(url, commit, skill["path"])
                    for rel in files:
                        p = PurePosixPath(rel)
                        if p.is_absolute() or ".." in p.parts or not p.parts:
                            raise ValueError(f"unsafe path {plain(rel)}")
                except Exception as exc:
                    self.error(labels, exc)
                    for _, label, cur, _ in behind:
                        self.pin(label, cur, newest, "not updated (source failed; pins stay together)")
                    continue
                if set(files) != set(skill["files"]):
                    added = [plain(x) for x in sorted(set(files) - set(skill["files"]))]
                    removed = [plain(x) for x in sorted(set(skill["files"]) - set(files))]
                    self.notes.append(f"{name}: upstream {newest} changes the skill's file set (added {added or 'none'}, "
                                      f"removed {removed or 'none'}); update codex/vendor/{name}/, codex/manifest.json and "
                                      "the lock by hand")
                    for _, label, cur, _ in behind:
                        self.pin(label, cur, newest, "not updated (file set changed; pins stay together)")
                    continue
                hashes = {rel: sha256(data) for rel, data in sorted(files.items())}
                if hashes != skill["files"]:
                    self.notes.append(f"{name}: vendored files change in {newest}; review codex/vendor/{name}/ and "
                                      "whether codex/ needs a TRACE release note (codex/docs/release-*.md)")
                for rel, data in files.items():
                    self.writes[f"codex/vendor/{name}/{rel}"] = data
                skill.update(commit=commit, version=newest.lstrip("v"), files=hashes)
            if plugin and any(b[0] == "plugin" for b in behind):
                plugin.update(ref=newest, sha=commit)
            for _, label, cur, _ in behind:
                self.pin(label, cur, newest, f"move to {newest} ({short(commit)})")

    # ---- RTK release assets ----
    def check_rtk(self, lock):
        """RTK in versions.lock.json: newest GitHub release, each locked asset downloaded and hashed. Edits the lock in place."""
        rtk = (lock.get("tools") or {}).get("rtk")
        if not rtk:
            return
        label = "RTK (codex/versions.lock.json)"
        cur = "v" + rtk["version"]
        try:
            rel = self.net.json(f"{GITHUB_API}{rtk['repository']}/releases/latest")
            tag = rel.get("tag_name", "")
            if not semver(tag) or not tag.startswith("v") or rel.get("draft") or rel.get("prerelease"):
                raise ValueError(f"latest release {plain(tag)} is not a stable vX.Y.Z")
            if semver(tag) <= semver(cur):
                self.pin(label, cur, tag, "up to date" if semver(tag) == semver(cur) else "newer than upstream; left as is")
                return
            # The Codex side's rules on the release as GitHub returned it (codex/scripts/tools.py release_plan): stable tag,
            # newer, and every locked platform present once at the expected URL with a sha256 release digest; it raises otherwise.
            sys.path.insert(0, str(REPO / "codex" / "scripts"))
            from tools import release_plan
            plan = release_plan(rel, rtk)
            if plan["status"] != "candidate":
                raise ValueError(f"release_plan says {plan['status']}")
            assets = plan["assets"]  # only the platforms already locked
            for name, a in assets.items():
                if sha256(self.net.bytes(a["url"])) != a["sha256"]:
                    raise ValueError(f"{name}: downloaded sha256 differs from the release digest")
        except Exception as exc:
            self.error(label, exc)
            self.pin(label, cur, "?", "source failed")
            return
        rtk.update(version=tag[1:], release_url=plan["release_url"], reviewed_at=self.today, assets=assets)
        self.pin(label, cur, tag, f"move to {tag} ({len(assets)} assets hashed)")

    # ---- unpinned tools ----
    def github_latest(self, repo):
        rel = self.net.json(f"{GITHUB_API}{repo}/releases/latest")
        version = re.sub(r"^[^0-9]*", "", rel.get("tag_name") or "")
        if not version:
            raise ValueError(f"tag {plain(rel.get('tag_name'))} has no version")
        return version, (rel.get("published_at") or "")[:10] or None

    def fetch_seen(self, kind, where, winget_id=None):
        if kind == "github":
            return self.github_latest(where)
        if kind == "npm":
            doc = self.net.json("https://registry.npmjs.org/" + where)
            version = doc["dist-tags"]["latest"]
            return version, (doc.get("time", {}).get(version) or "")[:10] or None
        if kind == "node":
            lts = [r for r in self.net.json(where) if r.get("lts") and semver(r["version"])]
            best = max(lts, key=lambda r: semver(r["version"]))
            return best["version"].lstrip("v"), best.get("date")
        if kind == "python":
            # winget id Python.Python.3.13 installs only 3.13.x, so record the newest patch of that minor, not the newest 3.x.
            m = re.fullmatch(r"Python\.Python\.3\.(\d+)", winget_id or "")
            if not m:
                raise ValueError(f"tools.json has no Python.Python.3.N winget id (got {winget_id!r})")
            minor = int(m.group(1))
            stable = [r for r in self.net.json(where)
                      if r.get("stable") and semver(r.get("version")) and semver(r["version"])[:2] == (3, minor)]
            if not stable:
                raise ValueError(f"no stable 3.{minor}.x in the manifest")
            best = max(stable, key=lambda r: semver(r["version"]))
            date = None
            tag = (best.get("release_url") or "").rsplit("/", 1)[-1]
            if tag:  # the manifest has no date; the build's release has one (best effort)
                try:
                    date = (self.net.json(f"{GITHUB_API}actions/python-versions/releases/tags/{tag}").get("published_at") or "")[:10] or None
                except Exception:
                    pass
            return best["version"], date
        raise ValueError(f"unknown kind {kind}")

    def check_seen(self, record, winget):
        tools = record.setdefault("tools", {})
        for tid, (label, kind, where) in SEEN.items():
            old = tools.get(tid) or {}
            try:
                version, date = self.fetch_seen(kind, where, winget.get(tid))
                # Both go into docs/tool-versions.json and the PR body's Markdown table, so only plain values pass.
                if not isinstance(version, str) or not SEEN_VERSION.fullmatch(version):
                    raise ValueError(f"unexpected version string {plain(version)}")
                if not (isinstance(date, str) and SEEN_DATE.fullmatch(date)):
                    date = None
            except Exception as exc:
                self.error(label, exc)
                self.seen.append((label, old.get("version"), "?", None, "source failed", winget.get(tid)))
                continue
            was = old.get("version")
            if was == version and not date:
                date = old.get("date")  # a date that was found once is kept when a later lookup has none
            new = {"label": label, "version": version, "date": date, "source": where}
            tools[tid] = new
            self.seen.append((label, was, version, date, "new release" if was and was != version else
                              "first record" if not was else "unchanged", winget.get(tid)))
        record["tools"] = {k: tools[k] for k in [*SEEN, *[k for k in tools if k not in SEEN]] if k in tools}

    # ---- whole run ----
    def check(self):
        settings_rel, lock_rel, seen_rel = "claude/settings.json", "codex/versions.lock.json", "docs/tool-versions.json"
        settings = load(self.root / settings_rel)
        lock = load(self.root / lock_rel)
        record = load(self.root / seen_rel, {"_doc": SEEN_DOC, "tools": {}})
        winget = {}
        if (self.root / "tools.json").exists():
            for t in load(self.root / "tools.json").get("tools", []):
                if (t.get("install") or {}).get("winget"):
                    winget[t["id"]] = t["install"]["winget"]
        self.check_tagged(settings, lock)
        self.check_rtk(lock)
        self.check_seen(record, winget)
        for rel, data in ((settings_rel, settings), (lock_rel, lock), (seen_rel, record)):
            self.writes[rel] = dump(data)
        self.writes = {rel: data for rel, data in self.writes.items()
                       if not (self.root / rel).exists() or (self.root / rel).read_bytes() != data}
        return self

    def write(self):
        for rel, data in sorted(self.writes.items()):
            path = self.root / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)

    def report(self, wrote):
        out = ["## Pinned versions", "", "| Item | Pinned | Newest | Result |", "|---|---|---|---|"]
        out += [f"| {a} | {b} | {c} | {d} |" for a, b, c, d in self.pins]
        out += ["", "## Newest releases of unpinned tools (docs/tool-versions.json)", "",
                "| Tool | Recorded | Newest | Released | Change | winget id |", "|---|---|---|---|---|---|"]
        out += [f"| {a} | {b or '-'} | {c} | {d or '-'} | {e} | {f'`{w}`' if w else '-'} |" for a, b, c, d, e, w in self.seen]
        upgrades = [(a, c, w) for a, b, c, d, e, w in self.seen if e == "new release"]
        if upgrades:
            out += ["", "New releases to install on each PC (nothing is installed by this workflow):"]
            out += [f"- {a} {c}: " + (f"`winget upgrade --id {w} --exact`" if w else "update by hand") for a, c, w in upgrades]
        if self.notes:
            out += ["", "## Notes", ""] + [f"- {n}" for n in self.notes]
        if self.errors:
            out += ["", "## Sources that failed (their entries were left as they were)", ""] + [f"- {e}" for e in self.errors]
        files = sorted(self.writes)
        out += ["", "## Files", ""]
        out += [f"- `{f}`" for f in files] if files else ["- none changed"]
        if files:
            out += ["", "Written." if wrote else "Report only; run with --write to change these files."]
        out += ["", "After merge, on each PC: `git pull && bash scripts/apply.sh && bash scripts/verify.sh --live`; when a plugin "
                "pin moved, back up `~/.claude-mem` and run `claude plugin update <id>` in a new session (docs/GUIDE.md); "
                "for the Codex skill or RTK, `codex/scripts/setup.py` plan/apply and `codex/scripts/tools.py install-rtk` as in codex/README.md."]
        return "\n".join(out) + "\n"


def main(argv=None, net=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--write", action="store_true", help="edit the pinned files and docs/tool-versions.json")
    ap.add_argument("--root", default=str(REPO), help="repository root (tests)")
    args = ap.parse_args(argv)
    run = Run(args.root, net or Net(), datetime.now(timezone.utc).date().isoformat()).check()
    if args.write:
        run.write()
    sys.stdout.write(run.report(args.write))
    return 2 if run.errors else 0


if __name__ == "__main__":
    sys.exit(main())
