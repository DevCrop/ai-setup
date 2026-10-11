#!/usr/bin/env bash
# Offline check of claude/statusline.sh with sample prompt_cache JSON (warm, about to expire, cold, absent, not observed).
set -u
repo="$(cd "$(dirname "$0")/.." && pwd)"
sl="$repo/claude/statusline.sh"
now="$(date +%s)"
fail=0

# $1 name, $2 prompt_cache JSON (or empty), $3 expected substring ("" means no second line)
run() {
  local pc="" out
  [ -n "$2" ] && pc=", \"prompt_cache\": $2"
  out="$(printf '{"model":{"display_name":"Opus"},"context_window":{"used_percentage":12}%s}' "$pc" | bash "$sl" | sed 's/\x1b\[[0-9;]*m//g')"
  echo "[$1]"; echo "$out"
  case "$out" in "[Opus] 12% context"*) ;; *) echo "FAIL $1: first line changed"; fail=1 ;; esac
  if [ -z "$3" ]; then
    [ "$(printf '%s\n' "$out" | wc -l)" -eq 1 ] || { echo "FAIL $1: expected no cache line"; fail=1; }
  else
    case "$out" in *"$3"*) ;; *) echo "FAIL $1: missing '$3'"; fail=1 ;; esac
  fi
}

run warm  "{\"warm\":true,\"caching_observed\":true,\"ttl\":\"1h\",\"expires_at\":$((now+2280)),\"hit_ratio\":0.91,\"misses\":0}" "cache ● 1h ████░░ 38m left · hit 91% · misses 0"
run soon  "{\"warm\":true,\"caching_observed\":true,\"ttl\":\"1h\",\"expires_at\":$((now+240)),\"hit_ratio\":0.91,\"misses\":2}" "░░░░░ 4m left"
run cold  '{"warm":false,"caching_observed":true,"ttl":"1h","recache_tokens_if_cold":82400}' "cache ○ cold · next message re-caches 82k tokens"
run cause '{"warm":false,"caching_observed":true,"recache_tokens_if_cold":45000,"last_miss_cause":{"causes":["tools_changed"],"tools_added":2}}' "· miss: tools_changed"
run bare  '{"warm":true,"caching_observed":true}' "cache ●"
run none  '' ""
run unobs '{"warm":false,"caching_observed":false}' ""

# yellow below 20% of the TTL, green above
yellow="$(printf '{"prompt_cache":{"warm":true,"ttl":"1h","expires_at":%s}}' $((now+240)) | bash "$sl" | grep -c $'\x1b\[33m')"
green="$(printf '{"prompt_cache":{"warm":true,"ttl":"1h","expires_at":%s}}' $((now+2280)) | bash "$sl" | grep -c $'\x1b\[32m')"
[ "$yellow" -eq 1 ] && [ "$green" -eq 1 ] || { echo "FAIL colors yellow=$yellow green=$green"; fail=1; }

[ "$fail" -eq 0 ] && echo "statusline: ok" || echo "statusline: FAILED"
exit "$fail"
