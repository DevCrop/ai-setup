#!/usr/bin/env bash
# Status line: the original one-line summary, then a prompt-cache countdown line.
# Fields: https://code.claude.com/docs/en/statusline#prompt-cache-fields (Claude Code 2.1.251+).
# The cache line is empty (and not printed) until prompt_cache exists or when caching is not observed.
input="$(cat)"

printf '%s' "$input" | jq -r '"[\(.model.display_name)] \(.context_window.used_percentage // 0)% context"' 2>/dev/null

cache="$(printf '%s' "$input" | jq -r '
  def c(n; s): "\u001b[\(n)m\(s)\u001b[0m";
  def k: if . < 1000 then "\(.)" else "\((. / 1000) | round)k" end;
  .prompt_cache as $p
  | select($p != null and $p.caching_observed != false)
  | ([ $p.last_miss_cause.causes? // empty | join(",") ] | first // "") as $cause
  | if $p.warm == true then
      ({"5m": 300, "1h": 3600}[$p.ttl // ""]) as $ttl
      | (if $p.expires_at then ([$p.expires_at - now, 0] | max) else null end) as $left
      | (if $left != null and $ttl then ($left / $ttl) else null end) as $frac
      | (if $frac != null and $frac < 0.2 then 33 else 32 end) as $col
      | [ "cache ●",
          ($p.ttl // empty),
          (if $frac != null then (([($frac * 6) | round, 6] | min) as $n | "\(("█" * $n) // "")\(("░" * (6 - $n)) // "")") else empty end),
          (if $left != null then "\(($left / 60) | ceil)m left" else empty end)
        ] | join(" ")
      | c($col; .)
      | . + (([ (if $p.hit_ratio != null then "hit \(($p.hit_ratio * 100) | round)%" else empty end),
                (if $p.misses != null then "misses \($p.misses)" else empty end) ] | join(" · ")) as $t
             | if $t != "" then " · " + $t else "" end)
    else
      c(31; "cache ○ cold"
        + (if $p.recache_tokens_if_cold != null then " · next message re-caches \($p.recache_tokens_if_cold | k) tokens" else "" end)
        + (if $cause != "" then " · miss: \($cause)" else "" end))
    end' 2>/dev/null)"

[ -n "$cache" ] && printf '%s\n' "$cache"
exit 0
