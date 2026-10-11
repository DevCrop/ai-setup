#!/usr/bin/env bash
# Checks the live dashboard server on a random local port: state keys, AO session field allowlist, foreign Host refused.
# No model calls. Needs python3, curl, jq. Usage: bash scripts/qa-dashboard.sh
set -u
repo="$(cd "$(dirname "$0")/.." && pwd)"
py="$(command -v python3 || command -v python)"
port=$((20000 + RANDOM % 20000))
"$py" "$repo/scripts/dashboard/server.py" --port "$port" >/dev/null 2>&1 &
pid=$!; trap 'kill $pid 2>/dev/null' EXIT
fail=0; pass() { echo "PASS  $*"; }; bad() { echo "FAIL  $*"; fail=$((fail+1)); }
for i in $(seq 1 30); do curl -s -o /dev/null "http://127.0.0.1:$port/api/state" && break; sleep 1; done
s="$(curl -s -m 60 "http://127.0.0.1:$port/api/state")"
[ -n "$s" ] && printf '%s' "$s" | jq empty 2>/dev/null && pass "/api/state is JSON" || { bad "/api/state is not JSON"; exit 1; }
for k in ao; do printf '%s' "$s" | jq -e "has(\"$k\")" >/dev/null && pass "state has $k" || bad "state lacks $k"; done
[ "$(printf '%s' "$s" | jq -r '.ao | has("available")')" = true ] && pass "ao.available present" || bad "ao.available missing"
# Session objects may carry only these keys (never prompts or review bodies).
extra="$(printf '%s' "$s" | jq -r '[.ao.sessions[]? | keys[]] | unique - ["id","projectId","role","displayName","status","activity","branch","prs","isTerminated","lastActivityAt","createdAt"] | join(",")')"
n="$(printf '%s' "$s" | jq '.ao.sessions | length')"
if [ "$n" = 0 ]; then echo "SKIP  ao.sessions allowlist (no AO sessions right now, so nothing to check)"
elif [ -z "$extra" ]; then pass "ao.sessions keys are within the allowlist ($n sessions)"; else bad "ao.sessions has extra keys: $extra"; fi
iv="$(curl -s -m 60 "http://127.0.0.1:$port/api/inventory")"
for k in orchestration routing features practices debug agents; do printf '%s' "$iv" | jq -e "has(\"$k\")" >/dev/null 2>&1 && pass "inventory has $k" || bad "inventory lacks $k"; done
ek="$(printf '%s' "$iv" | jq -r '[.debug.errors[]? | keys[]] | unique - ["at","tool","kind","detail"] | join(",")')"
[ -z "$ek" ] && pass "debug.errors carry only at/tool/kind/detail (no tool-result text)" || bad "debug.errors has extra keys: $ek"
[ "$(printf '%s' "$iv" | jq '[.practices[] | select(.level != "ok" and .level != "bad" and .level != "warn")] | length')" = 0 ] && pass "practices levels are ok/bad/warn" || bad "practices has an unknown level"
# regression: a secret-guard block followed by more tool calls must not crash debug()
lg="$(mktemp)"; printf '%s
' '{"timestamp":"t1","message":{"content":[{"type":"tool_use","id":"a","name":"Bash"}]}}' '{"timestamp":"t2","message":{"content":[{"type":"tool_result","tool_use_id":"a","is_error":true,"content":"secret-guard: blocked. Secret-looking files would be included: .env.production"}]}}' '{"timestamp":"t3","message":{"content":[{"type":"tool_use","id":"b","name":"Read"},{"type":"tool_result","tool_use_id":"b","is_error":true,"content":"boom"}]}}' > "$lg"
r="$("$py" -c "import sys,json;sys.path.insert(0,sys.argv[1]);import inventory;d=inventory.debug(sys.argv[2]);print(json.dumps([e['kind']+':'+e['detail'] for e in d['errors']]))" "$repo/scripts/dashboard" "$lg" 2>&1)"; rm -f "$lg"
[ "$r" = '["hook-block:.env.production", "tool-error:"]' ] && pass "debug() survives a hook block followed by more tool calls" || bad "debug() regression: $r"
for k in tune liveTune plugins livePlugins; do printf '%s' "$s" | jq -e ".settings | has(\"$k\")" >/dev/null && pass "settings has $k" || bad "settings lacks $k"; done
printf '%s' "$iv" | jq -e '.routing | has("cacheTtl") and has("subagentCacheTtl") and has("plugins")' >/dev/null && pass "routing has cacheTtl/subagentCacheTtl/plugins" || bad "routing lacks TTL or plugin fields"
# regression: an agent that preloads skills as a YAML list ("skills:" then "  - name") must show them, not an empty cell
for f in "$repo"/claude/agents/*.md; do
  grep -q '^skills:[[:space:]]*$' "$f" || continue
  a="$(basename "$f" .md)"; want="$(awk '/^skills:/{on=1;next} on&&/^[[:space:]]+-[[:space:]]/{sub(/^[[:space:]]+-[[:space:]]+/,"");print;next} on{exit}' "$f" | head -n1)"
  got="$(printf '%s' "$iv" | jq -r --arg a "$a" '.agents[] | select(.name==$a) | .skills')"
  case "$got" in *"$want"*) pass "inventory shows the preloaded skill of $a ($want)";; *) bad "inventory skills cell of $a is [$got], expected to contain [$want]";; esac
done
code="$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: evil.example' "http://127.0.0.1:$port/api/state")"
[ "$code" = 403 ] && pass "foreign Host refused (403)" || bad "foreign Host got $code"
code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/")"
[ "$code" = 200 ] && pass "index served" || bad "index got $code"
echo "failures: $fail"; [ "$fail" = 0 ]
