#!/usr/bin/env python3
"""Unit tests for scripts/check-updates.py. No network: a fake fetcher and a scratch repo per case.
Usage: python3 scripts/qa-check-updates.py"""
import contextlib, hashlib, importlib.util, io, json, shutil, sys, tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("check_updates", HERE / "check-updates.py")
cu = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cu)

fails = []
scratch = []


def check(ok, name, detail=""):
    print(("PASS  " if ok else "FAIL  ") + name + ("" if ok else f" - {detail}"))
    if not ok:
        fails.append(name)


def h(data):
    return hashlib.sha256(data).hexdigest()


PT_URL = "https://github.com/DietrichGebert/ponytail.git"
CM_URL = "https://github.com/thedotmack/claude-mem.git"
RTK_API = "https://api.github.com/repos/rtk-ai/rtk/releases/latest"
RTK_DL = "https://github.com/rtk-ai/rtk/releases/download/"
LOCKED = ["rtk-x86_64-pc-windows-msvc.zip", "rtk-x86_64-unknown-linux-musl.tar.gz"]
OLD_SKILL = b"old skill\n"
NEW_SKILL = b"new skill v5.3.0\n"
A, B, C, D, E, F = ("a" * 40, "b" * 40, "c" * 40, "d" * 40, "e" * 40, "f" * 40)


def plugin(name, url, ref, sha):
    return {"source": {"source": "settings", "name": name, "plugins": [
        {"name": name, "source": {"source": "url", "url": url, "ref": ref, "sha": sha}}]}}


def make_repo(pt_plugin=("v5.2.0", A), pt_skill=("5.2.0", A), cm=("v13.37.0", B), rtk="0.51.0"):
    root = Path(tempfile.mkdtemp(prefix="cu-unit-"))
    scratch.append(root)
    (root / "claude").mkdir()
    (root / "docs").mkdir()
    (root / "codex/vendor/ponytail").mkdir(parents=True)
    (root / "codex/vendor/ponytail/SKILL.md").write_bytes(OLD_SKILL)
    settings = {"model": "x", "extraKnownMarketplaces": {
        "ponytail": plugin("ponytail", PT_URL, *pt_plugin),
        "thedotmack": plugin("claude-mem", CM_URL, *cm)}}
    (root / "claude/settings.json").write_bytes(cu.dump(settings))
    lock = {"schema_version": 1,
            "skills": [{"name": "ponytail", "repository": "dietrichgebert/ponytail", "commit": pt_skill[1],
                        "path": "skills/ponytail", "files": {"SKILL.md": h(OLD_SKILL)}, "version": pt_skill[0]}],
            "tools": {"rtk": {"version": rtk, "repository": "rtk-ai/rtk",
                              "release_url": f"https://github.com/rtk-ai/rtk/releases/tag/v{rtk}", "reviewed_at": "2026-10-07",
                              "assets": {n: {"url": f"{RTK_DL}v{rtk}/{n}", "sha256": "0" * 64} for n in LOCKED}}}}
    (root / "codex/versions.lock.json").write_bytes(cu.dump(lock))
    (root / "tools.json").write_text(json.dumps({"tools": [{"id": "git", "install": {"winget": "Git.Git"}},
                                                            {"id": "python", "install": {"winget": "Python.Python.3.13"}},
                                                            {"id": "ao", "install": {"url": "x"}}]}), encoding="utf-8")
    seen = {"_doc": "d", "tools": {"git": {"label": "Git for Windows", "version": "2.50.0.windows.1", "date": "2026-09-01",
                                           "source": "git-for-windows/git"},
                                   "python": {"label": "Python", "version": "3.13.12", "date": "2026-10-01",
                                              "source": cu.SEEN["python"][2]}}}
    (root / "docs/tool-versions.json").write_bytes(cu.dump(seen))
    return root


def ls(*pairs):
    return "".join(f"{sha}\trefs/tags/{name}\n" for name, sha in pairs)


class Fake:
    def __init__(self, tags=None, json_=None, bytes_=None, trees=None, fail=()):
        self.tagsd, self.jsond, self.bytesd, self.trees, self.fail = tags or {}, json_ or {}, bytes_ or {}, trees or {}, set(fail)
        self.downloads = []

    def _maybe_fail(self, key):
        if key in self.fail:
            raise OSError("simulated network error")

    def tags(self, url):
        self._maybe_fail(url)
        return self.tagsd[url]

    def json(self, url):
        self._maybe_fail(url)
        if url not in self.jsond:
            raise OSError("no such url in fake: " + url)
        return self.jsond[url]

    def bytes(self, url):
        self._maybe_fail(url)
        self.downloads.append(url)
        return self.bytesd[url]

    def tree(self, url, commit, path):
        self._maybe_fail(("tree", url))
        return self.trees[(url, commit)]


def gh(repo, tag, date="2026-10-10T00:00:00Z"):
    return {f"https://api.github.com/repos/{repo}/releases/latest": {"tag_name": tag, "published_at": date}}


def seen_sources(git_tag="v2.51.0.windows.1"):
    j = {}
    j.update(gh("openai/codex", "rust-v0.170.0"))
    j.update(gh("git-for-windows/git", git_tag))
    j.update(gh("jqlang/jq", "jq-1.8.1"))
    j.update(gh("cli/cli", "v2.80.0"))
    j.update(gh("OrchestratorInc/agent-orchestrator", "v1.2.3"))
    j["https://registry.npmjs.org/@anthropic-ai/claude-code"] = {"dist-tags": {"latest": "2.1.296", "stable": "2.1.287"},
                                                                  "time": {"2.1.296": "2026-10-09T01:02:03Z"}}
    j["https://nodejs.org/dist/index.json"] = [{"version": "v26.11.1", "date": "2026-10-07", "lts": False},
                                               {"version": "v24.21.0", "date": "2026-09-07", "lts": "Krypton"},
                                               {"version": "v22.30.0", "date": "2026-09-01", "lts": "Jod"}]
    j[cu.SEEN["python"][2]] = [{"version": "3.16.0-alpha.1", "stable": False},
                               {"version": "3.15.0", "stable": True, "release_url": "https://github.com/actions/python-versions/releases/tag/3.15.0-1"},
                               {"version": "3.14.9", "stable": True},
                               {"version": "3.13.12", "stable": True, "release_url": "https://github.com/actions/python-versions/releases/tag/3.13.12-1"},
                               {"version": "3.13.13-rc.1", "stable": False},
                               {"version": "3.13.9", "stable": True}]
    return j


def rtk_release(tag="v0.52.0", extra=True, digest=True):
    names = LOCKED + (["rtk-aarch64-apple-darwin.tar.gz"] if extra else [])
    return {"tag_name": tag, "draft": False, "prerelease": False,
            "assets": [{"name": n, "browser_download_url": f"{RTK_DL}{tag}/{n}",
                        **({"digest": "sha256:" + h(n.encode())} if digest else {})} for n in names]}


def full_fake(**over):
    tags = {PT_URL: ls(("v5.2.0", A), ("v5.3.0", C), ("v5.3.0-rc.1", D)),
            CM_URL: ls(("v13.37.0", E), ("v13.37.0^{}", B), ("v13.39.0", F), ("v13.39.0^{}", D))}
    j = seen_sources()
    j[RTK_API] = rtk_release()
    b = {f"{RTK_DL}v0.52.0/{n}": n.encode() for n in LOCKED + ["rtk-aarch64-apple-darwin.tar.gz"]}
    trees = {(PT_URL, C): {"SKILL.md": NEW_SKILL}}
    args = dict(tags=tags, json_=j, bytes_=b, trees=trees)
    args.update(over)
    return Fake(**args)


def run(root, net, write=True):
    r = cu.Run(root, net, "2026-10-13").check()
    if write:
        r.write()
    return r


def settings_pin(root, name):
    s = json.loads((root / "claude/settings.json").read_text(encoding="utf-8"))
    for m in s["extraKnownMarketplaces"].values():
        for p in m["source"]["plugins"]:
            if p["name"] == name:
                return p["source"]["ref"], p["source"]["sha"]


def lock(root):
    return json.loads((root / "codex/versions.lock.json").read_text(encoding="utf-8"))


# ---- tag parsing ----
t = cu.tag_commits(ls(("v1.0.0", A), ("v1.0.0^{}", B)))
check(t == {"v1.0.0": B}, "peel: annotated tag resolves to the ^{} commit", t)
t = cu.tag_commits(ls(("v1.0.0^{}", B), ("v1.0.0", A), ("v0.9.0", C)))
check(t == {"v1.0.0": B, "v0.9.0": C}, "peel: ^{} line wins whatever the order; lightweight tag keeps its sha", t)
check(cu.newest_stable(["v1.9.0", "v1.10.0", "v2.0.0-rc.1", "latest", "1.10.1"]) == "1.10.1", "newest: numeric order, prereleases and names ignored")
check(cu.newest_stable(["nightly"]) is None, "newest: no stable tag gives None")
r = cu.Run(".", None, "2026-10-13"); r.error("x", ValueError("bad [link](http://e) @someone `cmd` <b>"))
check(not any(c in r.errors[0] for c in "[]@`<>"), "error(): upstream text in an exception cannot carry Markdown, mentions or HTML into the PR body", r.errors)

# ---- newer tags: pins, sha and vendored files updated ----
root = make_repo()
net = full_fake()
r = run(root, net)
check(settings_pin(root, "claude-mem") == ("v13.39.0", D), "plugin: claude-mem moves to the newest tag's peeled commit", settings_pin(root, "claude-mem"))
check(settings_pin(root, "ponytail") == ("v5.3.0", C), "plugin: ponytail moves to v5.3.0 (rc tag ignored)", settings_pin(root, "ponytail"))
sk = lock(root)["skills"][0]
check((sk["version"], sk["commit"], sk["files"]) == ("5.3.0", C, {"SKILL.md": h(NEW_SKILL)}), "skill: lock version, commit and sha256 follow", sk)
check((root / "codex/vendor/ponytail/SKILL.md").read_bytes() == NEW_SKILL, "skill: vendored SKILL.md replaced with upstream bytes")
check(settings_pin(root, "ponytail")[0].lstrip("v") == sk["version"] and settings_pin(root, "ponytail")[1] == sk["commit"],
      "ponytail: plugin and Codex skill pins are equal after the update")
s = json.loads((root / "claude/settings.json").read_text(encoding="utf-8"))
check(s["model"] == "x" and list(s) == ["model", "extraKnownMarketplaces"], "settings: other keys and key order kept")
check(any("vendored files change" in n for n in r.notes), "skill: changed vendored bytes noted for a TRACE release review", r.notes)
check(not r.errors, "newer: no source errors", r.errors)

# ---- RTK: asset hashing, only locked names ----
rtk = lock(root)["tools"]["rtk"]
check(rtk["version"] == "0.52.0" and rtk["release_url"] == "https://github.com/rtk-ai/rtk/releases/tag/v0.52.0"
      and rtk["reviewed_at"] == "2026-10-13", "rtk: version, release_url and reviewed_at updated", rtk)
check(sorted(rtk["assets"]) == sorted(LOCKED), "rtk: only the asset names already locked are kept", sorted(rtk["assets"]))
check(all(a["sha256"] == h(n.encode()) and a["url"] == f"{RTK_DL}v0.52.0/{n}" for n, a in rtk["assets"].items()),
      "rtk: sha256 computed from the downloaded bytes, url points at the new tag", rtk["assets"])
check(sorted(net.downloads) == sorted(f"{RTK_DL}v0.52.0/{n}" for n in LOCKED), "rtk: the unlocked platform asset is never downloaded", net.downloads)

root = make_repo()
bad = rtk_release()
bad["assets"][0]["digest"] = "sha256:" + "9" * 64
r = run(root, full_fake(json_={**seen_sources(), RTK_API: bad}))
check(lock(root)["tools"]["rtk"]["version"] == "0.51.0" and any("RTK" in e and "digest" in e for e in r.errors),
      "rtk: a download that differs from the release digest is refused and reported", r.errors)
root = make_repo()
r = run(root, full_fake(json_={**seen_sources(), RTK_API: {**rtk_release(), "assets": rtk_release()["assets"][1:]}}))
check(lock(root)["tools"]["rtk"]["version"] == "0.51.0" and any("RTK" in e for e in r.errors),
      "rtk: a release missing a locked platform is refused", r.errors)
root = make_repo()
r = run(root, full_fake(json_={**seen_sources(), RTK_API: {**rtk_release("v0.53.0-rc.1"), "prerelease": True}}))
check(lock(root)["tools"]["rtk"]["version"] == "0.51.0" and r.errors, "rtk: a prerelease is refused")

# ---- same version: no change ----
root = make_repo(pt_plugin=("v5.3.0", C), pt_skill=("5.3.0", C), cm=("v13.39.0", D), rtk="0.52.0")
r0 = run(root, full_fake(json_={**seen_sources(), RTK_API: rtk_release("v0.52.0")}), write=False)
# record the seen tools once, then a second run must find nothing to write
run(root, full_fake(json_={**seen_sources(), RTK_API: rtk_release("v0.52.0")}))
before = {p: p.read_bytes() for p in root.rglob("*") if p.is_file()}
net = full_fake(json_={**seen_sources(), RTK_API: rtk_release("v0.52.0")})
r = run(root, net)
after = {p: p.read_bytes() for p in root.rglob("*") if p.is_file()}
check(r.writes == {} and before == after, "same version: nothing written", sorted(r.writes))
check(all(row[3] == "up to date" for row in r.pins), "same version: every pin reported up to date", r.pins)
check(net.downloads == [], "same version: no RTK asset downloaded", net.downloads)
check(not any(k.startswith("codex/vendor") for k in r0.writes), "same version: vendored files not fetched or rewritten", sorted(r0.writes))
check("none changed" in r.report(True), "same version: report says no file changed")

# ---- one failing source is reported, the others still update ----
root = make_repo()
net = full_fake(fail={CM_URL, "https://nodejs.org/dist/index.json", RTK_API})
r = run(root, net)
check(settings_pin(root, "claude-mem") == ("v13.37.0", B), "failing source: claude-mem pin left as it was")
check(settings_pin(root, "ponytail") == ("v5.3.0", C), "failing source: ponytail still updated")
check(lock(root)["tools"]["rtk"]["version"] == "0.51.0", "failing source: rtk left as it was")
check(len(r.errors) == 3 and any("claude-mem" in e for e in r.errors) and any("Node.js" in e for e in r.errors)
      and any("RTK" in e for e in r.errors), "failing source: each failure listed with its item", r.errors)
tv = json.loads((root / "docs/tool-versions.json").read_text(encoding="utf-8"))["tools"]
check("node" not in tv and tv["git"]["version"] == "2.51.0.windows.1", "failing source: other seen tools still recorded", tv.get("git"))
rep = r.report(True)
check("Sources that failed" in rep and "simulated network error" in rep, "failing source: report has the failure section")
out = io.StringIO()
with contextlib.redirect_stdout(out):
    rc = cu.main(["--root", str(make_repo())], net=full_fake(fail={CM_URL}))
check(rc == 2, "failing source: exit code 2", rc)
with contextlib.redirect_stdout(io.StringIO()):
    rc = cu.main(["--root", str(make_repo())], net=full_fake())
check(rc == 0, "all sources answer: exit code 0", rc)
root = make_repo()
with contextlib.redirect_stdout(io.StringIO()):
    cu.main(["--root", str(root)], net=full_fake())
check(settings_pin(root, "ponytail") == ("v5.2.0", A), "report mode: nothing written without --write")

# ---- both Ponytail pins stay equal ----
root = make_repo()
r = run(root, full_fake(fail={("tree", PT_URL)}))
check(settings_pin(root, "ponytail") == ("v5.2.0", A) and lock(root)["skills"][0]["version"] == "5.2.0",
      "ponytail: skill fetch fails, so the plugin is not moved either", (settings_pin(root, "ponytail"), r.errors))
check(any("ponytail" in e for e in r.errors), "ponytail: the skill fetch failure is reported", r.errors)
root = make_repo(pt_plugin=("v5.3.0", C), pt_skill=("5.2.0", A))
r = run(root, full_fake())
sk = lock(root)["skills"][0]
check(settings_pin(root, "ponytail") == ("v5.3.0", C) and (sk["version"], sk["commit"]) == ("5.3.0", C),
      "ponytail: a skill behind the plugin catches up to the same tag", sk)
root = make_repo()
r = run(root, full_fake(trees={(PT_URL, C): {"SKILL.md": NEW_SKILL, "references/x.md": b"x"}}))
check(settings_pin(root, "ponytail") == ("v5.2.0", A) and lock(root)["skills"][0]["version"] == "5.2.0"
      and not (root / "codex/vendor/ponytail/references").exists(),
      "ponytail: a changed upstream file set blocks both pins and is noted", r.notes)
check(any("file set" in n for n in r.notes), "ponytail: file-set note names what to update by hand", r.notes)
root = make_repo()
r = run(root, full_fake(trees={(PT_URL, C): {"../escape.md": b"x"}}))
check(settings_pin(root, "ponytail") == ("v5.2.0", A) and r.errors, "ponytail: an unsafe upstream path is refused", r.errors)

# ---- moved tag is noted, never applied ----
root = make_repo(pt_plugin=("v5.3.0", A), pt_skill=("5.3.0", A))
r = run(root, full_fake())
check(settings_pin(root, "ponytail") == ("v5.3.0", A) and any("now points at" in n for n in r.notes),
      "moved tag: same version at another commit is noted and left as is", r.notes)

# ---- unpinned tools ----
root = make_repo()
r = run(root, full_fake())
tv = json.loads((root / "docs/tool-versions.json").read_text(encoding="utf-8"))["tools"]
check(list(tv) == list(cu.SEEN), "seen: tools in the registry order", list(tv))
check(tv["codex"]["version"] == "0.170.0" and tv["jq"]["version"] == "1.8.1" and tv["gh"]["version"] == "2.80.0",
      "seen: tag prefixes (rust-v, jq-, v) stripped", (tv["codex"], tv["jq"], tv["gh"]))
check(tv["claude"] == {"label": "Claude Code", "version": "2.1.296", "date": "2026-10-09", "source": "@anthropic-ai/claude-code"},
      "seen: Claude Code from npm latest with its publish date", tv["claude"])
check(tv["node"]["version"] == "24.21.0" and tv["node"]["date"] == "2026-09-07", "seen: Node.js newest LTS, not Current", tv["node"])
check(tv["python"]["version"] == "3.13.12" and tv["python"]["date"] == "2026-10-01",
      "seen: Python newest patch of the minor tools.json's winget id installs (3.13, not 3.15); "
      "a date found earlier is kept when the lookup has none", tv["python"])
root = make_repo()
tj = json.loads((root / "tools.json").read_text(encoding="utf-8"))
tj["tools"] = [t for t in tj["tools"] if t["id"] != "python"]
(root / "tools.json").write_text(json.dumps(tj), encoding="utf-8")
r = run(root, full_fake())
tv = json.loads((root / "docs/tool-versions.json").read_text(encoding="utf-8"))["tools"]
check(tv["python"]["version"] == "3.13.12" and any("Python" in e and "winget" in e for e in r.errors),
      "seen: no Python.Python.3.N winget id in tools.json is a failed source, the record is kept", r.errors)
rep = r.report(True)
check("Git for Windows 2.51.0.windows.1: `winget upgrade --id Git.Git --exact`" in rep, "seen: a new release lists its winget upgrade line", rep)
check("Agent Orchestrator 1.2.3" not in rep.split("New releases to install")[1].split("\n\n")[0],
      "seen: a first record is not listed as an upgrade")

# ---- unpinned tools: version and date strings are validated before they reach the file or the PR body ----
root = make_repo()
j = seen_sources(git_tag="v2.52.0 | [x](https://evil) |")
j.update(gh("cli/cli", "v2.80.0\n## injected"))
j["https://registry.npmjs.org/@anthropic-ai/claude-code"] = {"dist-tags": {"latest": "<b>2.1.297</b>"}, "time": {}}
j.update(gh("jqlang/jq", "jq-1.8.2", date="|x|2026-10"))
j[RTK_API] = rtk_release()
r = run(root, full_fake(json_=j))
tv = json.loads((root / "docs/tool-versions.json").read_text(encoding="utf-8"))["tools"]
rep = r.report(True)
check(tv["git"]["version"] == "2.50.0.windows.1" and "gh" not in tv and "claude" not in tv,
      "seen: an unexpected version string is not written", (tv.get("git"), tv.get("gh"), tv.get("claude")))
check(sum(any(e.startswith(lbl + ":") for e in r.errors) for lbl in ("Git for Windows", "GitHub CLI", "Claude Code")) == 3,
      "seen: each unexpected version string is a failed source", r.errors)
check("](https://evil)" not in rep and "\n## injected" not in rep and "<b>" not in rep and "| [x]" not in rep,
      "seen: a rejected version string reaches the report without its markup", rep)
check(tv["jq"]["version"] == "1.8.2" and tv["jq"]["date"] is None, "seen: a malformed date is dropped, the version kept", tv["jq"])
with contextlib.redirect_stdout(io.StringIO()):
    rc = cu.main(["--root", str(make_repo())], net=full_fake(json_=j))
check(rc == 2, "seen: a rejected version string exits 2", rc)

# ---- RTK: every locked asset needs its release digest ----
root = make_repo()
r = run(root, full_fake(json_={**seen_sources(), RTK_API: rtk_release(digest=False)}))
check(lock(root)["tools"]["rtk"]["version"] == "0.51.0" and any(e.startswith("RTK") for e in r.errors),
      "rtk: a release without asset digests is refused and reported", r.errors)
root = make_repo()
nodig = rtk_release()
del nodig["assets"][1]["digest"]
net = full_fake(json_={**seen_sources(), RTK_API: nodig})
r = run(root, net)
check(lock(root)["tools"]["rtk"]["version"] == "0.51.0" and any(e.startswith("RTK") for e in r.errors),
      "rtk: one locked asset without a digest refuses the whole move", r.errors)
root = make_repo()
odd = rtk_release()
odd["assets"][0]["digest"] = "sha512:" + h(LOCKED[0].encode())
r = run(root, full_fake(json_={**seen_sources(), RTK_API: odd}))
check(lock(root)["tools"]["rtk"]["version"] == "0.51.0" and any(e.startswith("RTK") for e in r.errors),
      "rtk: a digest that is not sha256 is refused", r.errors)
with contextlib.redirect_stdout(io.StringIO()):
    rc = cu.main(["--root", str(make_repo())], net=full_fake(json_={**seen_sources(), RTK_API: rtk_release(digest=False)}))
check(rc == 2, "rtk: a missing digest exits 2", rc)

for d in scratch:
    shutil.rmtree(d, ignore_errors=True)
print(f"\n{len(fails)} FAIL" if fails else "\nall passed")
sys.exit(1 if fails else 0)
