"""What may leave the machine. The dashboard reads session logs; everything it shows from them passes through here.

Rule: a name leaves only when it is on a list this module owns. Anything else is shown as a class ("other") or not at all.
- file_target: the base name of a file path (either separator style), never a directory.
- safe_command: a known program name, plus a known subcommand or one of this repo's own script names. Never an argument, a value, a
  path, an environment assignment or a name that is not on the lists below.
"""
import re, shlex
from pathlib import Path

# Programs that are shown by name. A script or tool that is not here becomes "other" (a local script name can be a customer's name).
KNOWN_PROGRAMS = frozenset("""
git gh npm npx pnpm yarn bun deno node python python3 pip pip3 bash sh zsh pwsh powershell cmd rtk winget brew apt apt-get
ls cat cd cp mv rm mkdir rmdir touch grep rg find sed awk curl wget jq head tail sort uniq wc echo printf diff tar zip unzip
chmod chown ps kill sleep docker docker-compose make cargo go ruby php composer java mvn gradle dotnet code claude ao ssh scp
rsync tee xargs env export pwd date which command test true false timeout time sudo tree stat file du df open less more nl
""".split())

# Subcommands that are shown after the program. Anything else shows the program alone.
KNOWN_SUBCOMMANDS = {
    "git": frozenset("""status log diff show add commit push pull fetch merge rebase checkout switch branch stash reset restore clean clone init
        tag remote config cherry-pick revert worktree ls-files rev-parse blame bisect submodule apply am mv rm describe shortlog reflog gc
        grep format-patch update-index diff-tree cat-file""".split()),
    "gh": frozenset("pr issue repo run release workflow auth api gist search label status browse extension secret variable cache".split()),
    "npm": frozenset("install i ci test run start build publish version update audit ls list init pack link exec outdated prune cache view whoami".split()),
    "rtk": frozenset("git gain hook init proxy telemetry".split()),
    "winget": frozenset("install upgrade list search uninstall".split()),
}
# bash/python scripts are shown only when they are files of this repo's scripts/ folder (verify.sh, apply.sh, ...).
SCRIPT_HEADS = frozenset(("bash", "sh", "python", "python3"))

TOKEN_SHAPE = re.compile(r"^(gh[pousr]_|github_pat_|sk[-_]|xox[a-z]-|AKIA|AIza|eyJ|npm_)", re.I)
_SEPARATORS = re.compile(r"[\\/]")


def base_name(path):
    """Last path component for both separator styles (a Windows path read on Linux, as in CI, stays a base name)."""
    return _SEPARATORS.split(str(path).rstrip("\\/"))[-1]


def file_target(path):
    return base_name(path)[:80]


def repo_scripts(root):
    """Names of the files in <root>/scripts (verify.sh, apply.sh, qa-*.sh, ...)."""
    d = Path(root) / "scripts"
    try:
        return frozenset(p.name for p in d.iterdir() if p.is_file())
    except OSError:
        return frozenset()


def safe_command(cmd, scripts=frozenset()):
    """'git status', 'gh pr', 'bash verify.sh', 'ls', or 'other' / '' - never an argument."""
    try:
        w = shlex.split(cmd)
    except ValueError:  # an unclosed quote: we cannot tell where the program ends
        return ""
    while w and re.match(r"[A-Za-z_][A-Za-z0-9_]*=", w[0]):  # leading NAME=value assignments never leave the machine
        w = w[1:]
    if not w:
        return ""
    head = base_name(w[0])
    if not re.fullmatch(r"[A-Za-z0-9_.+-]{1,24}", head):
        return ""
    head = head[:-4] if head.lower().endswith(".exe") else head
    if head not in KNOWN_PROGRAMS:
        return "other"
    if len(w) > 1:
        second = w[1]
        if head in SCRIPT_HEADS:
            name = base_name(second)
            if name in scripts:
                return head + " " + name
        elif second in KNOWN_SUBCOMMANDS.get(head, ()) and not TOKEN_SHAPE.match(second):
            return head + " " + second
    return head
