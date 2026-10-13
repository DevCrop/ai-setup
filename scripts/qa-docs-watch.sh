#!/usr/bin/env bash
# Offline test for scripts/docs-watch.sh: a fake curl on PATH serves fixture pages, and a copy of the script runs in a scratch repo,
# so nothing touches the network or this repo's reports/. Checks: no --update writes nothing (not even reports/), --update fills the
# cache, a changed page is reported without --update and left uncached, an HTML error page and a failed fetch are FETCH-FAIL.
# Usage: bash scripts/qa-docs-watch.sh
set -u
here="$(cd "$(dirname "$0")" && pwd)"
t="$(mktemp -d "${TMPDIR:-/tmp}/qa-docs-watch.XXXXXX")"
trap 'rm -rf "$t"' EXIT
fails=0
pass() { printf 'PASS  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; fails=$((fails + 1)); }

mkdir -p "$t/repo/scripts" "$t/bin" "$t/pages"
cp "$here/docs-watch.sh" "$t/repo/scripts/"
# fake curl: the page for a URL is $QA_PAGES/<URL with / and : turned into _>; a missing page fails like curl -f on a 404
cat > "$t/bin/curl" <<'FAKE'
#!/usr/bin/env bash
url=""; out=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift ;;
    http*) url="$1" ;;
  esac
  shift
done
f="$QA_PAGES/$(printf '%s' "$url" | tr '/:' '__')"
[ -f "$f" ] || exit 22
cp "$f" "$out"
FAKE
chmod +x "$t/bin/curl"
page() { printf '%s\n' "$2" > "$t/pages/$(printf '%s' "$1" | tr '/:' '__')"; }
code=https://code.claude.com/docs/en
page "$code/memory.md" "# Memory"
page "$code/skills.md" "# Skills"
page "$code/hooks.md" "<!doctype html><html>error</html>"
# every other page: a failed fetch
run() { (cd "$t" && PATH="$t/bin:$PATH" QA_PAGES="$t/pages" bash "$t/repo/scripts/docs-watch.sh" "$@"); }
cache="$t/repo/reports/docs-cache"

out="$(run)"; rc=$?
[ "$rc" -eq 0 ] && pass "exit 0 without --update" || fail "exit $rc without --update"
[ ! -e "$t/repo/reports" ] && pass "no --update: nothing written, not even reports/" || fail "no --update created $(find "$t/repo/reports" | head -3)"
printf '%s\n' "$out" | grep -q '^NEW      memory ' && pass "a page with no cache is NEW" || fail "memory not NEW: $out"
printf '%s\n' "$out" | grep -q '^FETCH-FAIL hooks (.*returned HTML' && pass "an HTML page is FETCH-FAIL" || fail "hooks HTML not FETCH-FAIL: $out"
printf '%s\n' "$out" | grep -q '^FETCH-FAIL settings ' && pass "a failed fetch is FETCH-FAIL" || fail "settings not FETCH-FAIL: $out"

run --update > /dev/null
[ -f "$cache/memory.md" ] && [ -f "$cache/skills.md" ] && pass "--update caches fetched pages" || fail "--update did not cache: $(ls "$cache" 2>&1)"
[ ! -e "$cache/hooks.md" ] && [ ! -e "$cache/settings.md" ] && pass "--update caches no HTML or failed page" || fail "bad page cached"

page "$code/memory.md" "# Memory v2"
out="$(run)"
printf '%s\n' "$out" | grep -q '^CHANGED  memory ' && printf '%s\n' "$out" | grep -q '^    > # Memory v2' && pass "a changed page is CHANGED with its diff" || fail "memory not CHANGED: $out"
printf '%s\n' "$out" | grep -q '^SAME     skills$' && pass "an unchanged page is SAME" || fail "skills not SAME: $out"
grep -qx '# Memory' "$cache/memory.md" && pass "no --update leaves the cache as it was" || fail "cache changed without --update"
run --update > /dev/null
grep -qx '# Memory v2' "$cache/memory.md" && pass "--update moves the cache to the new page" || fail "cache not updated by --update"

[ "$fails" -eq 0 ] || { echo "$fails failed"; exit 1; }
echo "all passed"
