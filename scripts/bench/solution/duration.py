import re

_PART = re.compile(r"\s*(\d+)([dhms])")
_UNIT = {"d": 86400, "h": 3600, "m": 60, "s": 1}


def parse_duration(text):
    s, pos, total, last = text.rstrip(), 0, 0, -1
    if not s.strip():
        raise ValueError("empty duration")
    while pos < len(s):
        m = _PART.match(s, pos)
        if not m:
            raise ValueError("bad duration: %r" % text)
        i = "dhms".index(m.group(2))
        if i <= last:
            raise ValueError("unit out of order or repeated: %r" % text)
        total, last, pos = total + int(m.group(1)) * _UNIT[m.group(2)], i, m.end()
    return total
