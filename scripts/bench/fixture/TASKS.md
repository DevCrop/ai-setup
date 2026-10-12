# Tasks

Three independent tasks. Each touches one module and its own test file only. Python 3 standard library only; no packages.
Run all tests with `python3 -m unittest discover -s tests -t .`.

## slug — `textkit/slug.py`, tests in `tests/test_slug.py`
`slugify(text, max_len=None) -> str`
- Normalize with `unicodedata.normalize("NFKD", text)`, drop every non-ASCII character, then lower-case.
- Every run of characters that are not `a-z` or `0-9` becomes one `-`. No leading or trailing `-`.
- If `max_len` is given (an int >= 1) and the slug is longer, cut it to `max_len` characters, then remove any trailing `-`.
- `max_len` < 1 raises `ValueError`. An input with no letters or digits returns `""`.
- Examples: `"Hello, World!"` -> `"hello-world"`; `"Crème brûlée"` -> `"creme-brulee"`; `slugify("a b c d", 4)` -> `"a-b"`.

## duration — `textkit/duration.py`, tests in `tests/test_duration.py`
`parse_duration(text) -> int` (seconds)
- Input is one or more `<integer><unit>` parts, units `d` (86400), `h` (3600), `m` (60), `s` (1), lower case only.
- Units must appear in that order (d, h, m, s), each at most once. Whitespace between parts is allowed and leading/trailing whitespace is ignored.
- Anything else raises `ValueError`: empty or blank input, a number without a unit, an unknown unit, a repeated or out-of-order unit, a sign or decimal point.
- Examples: `"1h30m"` -> `5400`; `" 2d 3s "` -> `172803`; `"0s"` -> `0`; `"90m"` -> `5400`.

## percentile — `textkit/stats.py`, tests in `tests/test_stats.py`
`percentile(values, p) -> float`
- Linear interpolation between closest ranks on the sorted values: rank `r = (n - 1) * p / 100`, result `v[floor(r)] + (v[ceil(r)] - v[floor(r)]) * (r - floor(r))`.
- `values` is any iterable of numbers; it is not modified. `p` is a number from 0 to 100 inclusive.
- Empty `values`, or `p` outside 0..100, raises `ValueError`.
- Examples: `percentile([1, 2, 3, 4], 50)` -> `2.5`; `percentile([5], 90)` -> `5.0`; `percentile([3, 1, 2], 0)` -> `1.0`.

## Done when
Each function meets its spec, has its own unit tests under `tests/`, and the full test command passes.
