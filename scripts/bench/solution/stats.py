import math


def percentile(values, p):
    v = sorted(values)
    if not v or not 0 <= p <= 100:
        raise ValueError("need values and 0 <= p <= 100")
    r = (len(v) - 1) * p / 100
    lo, hi = math.floor(r), math.ceil(r)
    return float(v[lo] + (v[hi] - v[lo]) * (r - lo))
