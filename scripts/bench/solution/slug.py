import re
import unicodedata


def slugify(text, max_len=None):
    if max_len is not None and max_len < 1:
        raise ValueError("max_len must be >= 1")
    s = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    if max_len is not None and len(s) > max_len:
        s = s[:max_len].rstrip("-")
    return s
