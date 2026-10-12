#!/usr/bin/env bash
# Checks the live dashboard server on a random local port: state keys, AO session field allowlist, foreign Host refused.
# No model calls. Needs python3, curl, jq. Usage: bash scripts/qa-dashboard.sh
set -u
repo="$(cd "$(dirname "$0")/.." && pwd)"
py="$(command -v python3 || command -v python)"
# Logic checks first (settings with a missing live file, what may leave the machine, cache, token): a shape check below must not hide them.
"$py" "$repo/scripts/qa-dashboard-unit.py" || { echo "FAIL  scripts/qa-dashboard-unit.py"; exit 1; }
port=$((20000 + RANDOM % 20000))
"$py" "$repo/scripts/dashboard/server.py" --port "$port" >/dev/null 2>&1 &
pid=$!; trap 'kill $pid 2>/dev/null' EXIT
fail=0; pass() { echo "PASS  $*"; }; bad() { echo "FAIL  $*"; fail=$((fail+1)); }
for _ in $(seq 1 30); do curl -s -o /dev/null "http://127.0.0.1:$port/api/state" && break; sleep 1; done
s="$(curl -s -m 60 "http://127.0.0.1:$port/api/state")"
[ -n "$s" ] && printf '%s' "$s" | jq empty 2>/dev/null && pass "/api/state is JSON" || { bad "/api/state is not JSON"; exit 1; }
# shellcheck disable=SC2043  # one key today; the loop stays so a key is one word to add
for k in ao; do printf '%s' "$s" | jq -e "has(\"$k\")" >/dev/null && pass "state has $k" || bad "state lacks $k"; done
[ "$(printf '%s' "$s" | jq -r '.ao | has("available")')" = true ] && pass "ao.available present" || bad "ao.available missing"
# Session objects may carry only these keys (never prompts or review bodies).
extra="$(printf '%s' "$s" | jq -r '[.ao.sessions[]? | keys[]] | unique - ["id","projectId","role","displayName","status","activity","branch","prs","isTerminated","lastActivityAt","createdAt"] | join(",")')"
n="$(printf '%s' "$s" | jq '.ao.sessions | length')"
if [ "$n" = 0 ]; then echo "SKIP  ao.sessions allowlist (no AO sessions right now, so nothing to check)"
elif [ -z "$extra" ]; then pass "ao.sessions keys are within the allowlist ($n sessions)"; else bad "ao.sessions has extra keys: $extra"; fi
iv="$(curl -s -m 60 "http://127.0.0.1:$port/api/inventory")"
for k in orchestration routing features practices debug agents efficiency codex; do printf '%s' "$iv" | jq -e "has(\"$k\")" >/dev/null 2>&1 && pass "inventory has $k" || bad "inventory lacks $k"; done
# efficiency: every metric states where it came from, and an unreadable number is never a number
bb="$(printf '%s' "$iv" | jq -r '[.efficiency.sources[]?.metrics[]? | select(.basis != "measured" and .basis != "estimated" and .basis != "unavailable")] | length')"
ub="$(printf '%s' "$iv" | jq -r '[.efficiency.sources[]?.metrics[]? | select(.basis == "unavailable" and .value != "측정 불가")] | length')"
ns="$(printf '%s' "$iv" | jq -r '[.efficiency.sources[]?.name] | length')"
[ "$bb" = 0 ] && [ "$ub" = 0 ] && [ "$ns" -ge 4 ] && pass "efficiency: $ns tools, every metric has a basis, unavailable ones carry no number" || bad "efficiency: bad basis $bb, unavailable-with-number $ub, sources $ns"
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
# tools health: fixed keys only, levels in the allowed set, claude-mem, history and AO groups present
printf '%s' "$s" | jq -e '[.tools[] | select((keys|sort) != ["detail","fix","fixId","group","level","name"] or (.level|IN("ok","warn","bad","na")|not))] | length == 0' >/dev/null && pass "tools items have fixed keys and valid levels" || bad "tools items malformed"
printf '%s' "$s" | jq -e '[.tools[].group] | (index("claude-mem") != null) and (index("기록") != null) and (index("AO") != null)' >/dev/null && pass "tools cover claude-mem, history and AO" || bad "tools groups missing"
# auto-detect: a session log with a real cwd is found, a log-less folder next to it does not hide it
ad="$(mktemp -d "$repo/.qa-ad.XXXXXX")"; ad="$(cd "$ad" && pwd -W 2>/dev/null || pwd)"; mkdir -p "$ad/cfg/projects/empty" "$ad/cfg/projects/p1" "$ad/work/app"; : > "$ad/work/app/CLAUDE.md"
printf '{"cwd":"%s"}
' "$ad/work/app" > "$ad/cfg/projects/p1/s.jsonl"
# shellcheck disable=SC1007  # PROJECT_ROOTS= is an intentional empty value
r="$(PROJECT_ROOTS= CLAUDE_CONFIG_DIR="$ad/cfg" "$py" -c "import sys;sys.path.insert(0,sys.argv[1]);import server;print([p.name for p in server.discover_projects()])" "$repo/scripts/dashboard")"
[ "$r" = "['app']" ] && pass "project auto-detect finds the session cwd" || bad "project auto-detect gave: $r"
rm -rf "$ad"
# fix endpoint: no token, wrong token, foreign Origin and foreign Host are all refused; the allow-list logic passes its unit checks
tok="$(printf '%s' "$s" | jq -r .token)"; u="http://127.0.0.1:$port/api/fix"; j='{"id":"mem-redact-on","action":"preview"}'
c1="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d "$j" "$u")"
c2="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H 'X-Dash-Token: nope' -d "$j" "$u")"
c3="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H "X-Dash-Token: $tok" -H 'Origin: http://evil.example' -d "$j" "$u")"
c4="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: text/plain' -H "X-Dash-Token: $tok" -d "$j" "$u")"
c5="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H "X-Dash-Token: $tok" -d "$j" "$u")"
[ "$c1$c2$c3$c4$c5" = 403403403403200 ] && pass "fix endpoint refuses no/wrong token, foreign origin, wrong content type; accepts a valid preview" || bad "fix endpoint codes: $c1 $c2 $c3 $c4 $c5"
"$py" "$repo/scripts/qa-fix.py" "$repo" >/dev/null 2>&1 && pass "fix allow-list unit checks" || bad "scripts/qa-fix.py failed"
# no console windows: a process may only start through spawn() (CREATE_NO_WINDOW); a bare subprocess call or os.system would flash a window under pythonw
"$py" "$repo/scripts/qa-spawn-guard.py" "$repo/scripts/dashboard" >/dev/null 2>&1 && pass "the dashboard starts processes only through spawn() with CREATE_NO_WINDOW" || bad "a process is started outside spawn() or without creationflags (python3 scripts/qa-spawn-guard.py scripts/dashboard)"
code="$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: evil.example' "http://127.0.0.1:$port/api/state")"
[ "$code" = 403 ] && pass "foreign Host refused (403)" || bad "foreign Host got $code"
code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/")"
[ "$code" = 200 ] && pass "index served" || bad "index got $code"
# static UI files: only ui/*.js and ui/*.css are served; traversal, other types and foreign Host are refused
c1="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/ui/app.js")"
c2="$(curl -s -o /dev/null -w '%{http_code}' --path-as-is "http://127.0.0.1:$port/ui/../server.py")"
c3="$(curl -s -o /dev/null -w '%{http_code}' --path-as-is "http://127.0.0.1:$port/ui/%2e%2e/server.py")"
c4="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/ui/nope.py")"
c5="$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: evil.example' "http://127.0.0.1:$port/ui/app.js")"
c6="$(curl -s -o /dev/null -w '%{http_code}' --path-as-is "http://127.0.0.1:$port/ui///nohost/share/x.js")"
c7="$(curl -s -o /dev/null -w '%{http_code}' --path-as-is "http://127.0.0.1:$port/ui/a:b.js")"
[ "$c1$c2$c3$c4$c5$c6$c7" = 200404404404403404404 ] && pass "ui files served; traversal, UNC-style, drive-letter, wrong type and foreign Host refused" || bad "ui static codes: $c1 $c2 $c3 $c4 $c5 $c6 $c7"
echo "failures: $fail"; [ "$fail" = 0 ]
