"""Small file-system helpers shared by the dashboard modules."""
import json, os
from pathlib import Path


def mtime(p):
    try:
        return p.stat().st_mtime
    except OSError:  # Claude Code rotated or deleted the file between the glob and now
        return -1.0


def newest_file(files):
    return max(files, key=mtime) if files else None


def read_json(path):
    """A JSON object from a file, or None when the file is missing, unreadable or not an object."""
    try:
        d = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return d if isinstance(d, dict) else None


def mem_dir():
    """Where claude-mem keeps its settings and database (CLAUDE_MEM_DIR overrides, as in the plugin)."""
    return Path(os.environ.get("CLAUDE_MEM_DIR", Path.home() / ".claude-mem"))
