#!/usr/bin/env bash
# Unit-test claude/hooks/compact-context.sh (SessionStart, matcher compact) and claude/hooks/config-audit.sh (ConfigChange), no model calls.
# Both hooks must always exit 0 with nothing on stderr. Usage: bash scripts/qa-hooks-session.sh [hooks-dir]
# (a mutated copy of the hooks directory can be passed to prove the checks discriminate). Needs jq; without it every case is SKIP.
set -u
repo="$(cd "$(dirname "$0")/.." && pwd)"
hooks="${1:-$repo/claude/hooks}"
command -v jq >/dev/null 2>&1 || { echo "SKIP  jq not found"; exit 0; }
t="$(mktemp -d)"; trap 'rm -rf "$t"' EXIT
fail=0
ok() { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; fail=$((fail + 1)); }

# compact-context.sh: run <project dir or ""> <input json>; sets out, err, rc
compact() {
  local pd="$1" in="$2"
  if [ -n "$pd" ]; then
    out="$(printf '%s' "$in" | HOME="$t/home" CLAUDE_PROJECT_DIR="$pd" bash "$hooks/compact-context.sh" 2>"$t/err")"; rc=$?
  else
    out="$(printf '%s' "$in" | env -u CLAUDE_PROJECT_DIR HOME="$t/home" bash "$hooks/compact-context.sh" 2>"$t/err")"; rc=$?
  fi
  err="$(cat "$t/err")"
}
mkdir -p "$t/home/w/proj/.claude" "$t/home/w/proj/sub/deep" "$t/home/w/empty" "$t/home/.claude"
printf 'TASK: ship PR A\nNEXT: run qa-deny\n' > "$t/home/w/proj/.claude/handoff.md"
printf 'home note must never be read\n' > "$t/home/.claude/handoff.md"

compact "$t/home/w/proj" '{"source":"compact"}'
[ "$rc" = 0 ] && [ -z "$err" ] && printf '%s' "$out" | grep -q 'TASK: ship PR A' && printf '%s' "$out" | grep -q 'NEXT: run qa-deny' \
  && ok "compact: the project's handoff note is printed" || bad "compact: handoff note ($rc) [$out] [$err]"

compact "$t/home/w/proj/sub/deep" '{"source":"compact"}'
[ "$rc" = 0 ] && printf '%s' "$out" | grep -q 'TASK: ship PR A' && ok "compact: found from a subfolder of the project" || bad "compact: subfolder [$out]"

compact "$t/home/w/empty" '{"source":"compact"}'
[ "$rc" = 0 ] && [ -z "$err" ] && printf '%s' "$out" | grep -q '^Context was compacted. Keep the list of modified files' \
  && ! printf '%s' "$out" | grep -q 'home note' && ok "compact: no note gives the one-line reminder and never reads the home folder's .claude" \
  || bad "compact: no note [$out]"

compact "" "{\"source\":\"compact\",\"cwd\":\"$t/home/w/proj\"}"
[ "$rc" = 0 ] && printf '%s' "$out" | grep -q 'TASK: ship PR A' && ok "compact: falls back to the input cwd without CLAUDE_PROJECT_DIR" || bad "compact: cwd fallback [$out]"

compact "" 'not json {'
[ "$rc" = 0 ] && [ -z "$err" ] && printf '%s' "$out" | grep -q '^Context was compacted' && ok "compact: broken input gives the reminder, exit 0, no stderr" || bad "compact: broken input ($rc) [$out] [$err]"

mkdir -p "$t/home/w/big/.claude"
{ printf 'HEAD-LINE\n'; head -c 9000 /dev/zero | tr '\0' 'x'; printf '\nTAIL-MARK\n'; } > "$t/home/w/big/.claude/handoff.md"
compact "$t/home/w/big" '{"source":"compact"}'
n="$(printf '%s' "$out" | wc -c | tr -d ' ')"
[ "$rc" = 0 ] && printf '%s' "$out" | grep -q 'HEAD-LINE' && ! printf '%s' "$out" | grep -q 'TAIL-MARK' && [ "$n" -lt 10000 ] && [ "$n" -gt 7000 ] \
  && printf '%s' "$out" | grep -q 'first 8000 of' && printf '%s' "$out" | iconv -f UTF-8 -t UTF-8 >/dev/null 2>&1 && ok "compact: a 9 KB note is cut to 8000 bytes ($n bytes out, under the 10,000-character cap)" \
  || bad "compact: big note not cut ($n bytes)"

mkdir -p "$t/home/w/kor/.claude"
{ head -c 7999 /dev/zero | tr '\0' 'x'; printf '가나다\n'; } > "$t/home/w/kor/.claude/handoff.md"
compact "$t/home/w/kor" '{"source":"compact"}'
if command -v iconv >/dev/null 2>&1; then
  printf '%s' "$out" | iconv -f UTF-8 -t UTF-8 >/dev/null 2>&1 && ok "compact: a cut inside a Korean character leaves valid UTF-8" || bad "compact: invalid UTF-8 after the cut"
else
  echo "SKIP  compact: UTF-8 check (no iconv)"
fi
if [ "$(id -u 2>/dev/null)" = 0 ]; then
  echo "SKIP  compact: unreadable note (running as root, which reads any file)"
else
  mkdir -p "$t/home/w/locked/.claude"; printf 'x\n' > "$t/home/w/locked/.claude/handoff.md"; chmod 000 "$t/home/w/locked/.claude/handoff.md"
  if [ -r "$t/home/w/locked/.claude/handoff.md" ]; then echo "SKIP  compact: unreadable note (chmod has no effect here)"; fi
  compact "$t/home/w/locked" '{"source":"compact"}'
  chmod 644 "$t/home/w/locked/.claude/handoff.md"
  [ "$rc" = 0 ] && [ -z "$err" ] && ok "compact: an unreadable note still exits 0 with no stderr" || bad "compact: unreadable note ($rc) [$err]"
fi

mkdir -p "$t/home/w/proj/wt/.claude"; printf 'WORKTREE NOTE\n' > "$t/home/w/proj/wt/.claude/handoff.md"
compact "$t/home/w/proj" "{\"source\":\"compact\",\"cwd\":\"$t/home/w/proj/wt\"}"
printf '%s' "$out" | grep -q 'WORKTREE NOTE' && ok "compact: the input cwd (a worktree) wins over CLAUDE_PROJECT_DIR" || bad "compact: worktree cwd [$out]"
printf '%s' "$out" | grep -q 'last written [0-9]' && ok "compact: the note's modification time is printed" || bad "compact: no time [$out]"

# Git Bash makes a copy for ln -s unless MSYS=winsymlinks:native is set, so these cases run only where a real symlink was made.
ln -s "$t/home" "$t/homelink" 2>/dev/null
if [ -L "$t/homelink" ]; then
  out="$(printf '{}' | HOME="$t/homelink/" CLAUDE_PROJECT_DIR="$t/home/w/empty/" bash "$hooks/compact-context.sh" 2>/dev/null)"
  ! printf '%s' "$out" | grep -q 'home note' && ok "compact: a symlinked home with a trailing slash still stops the search" || bad "compact: home note read via symlink [$out]"
else
  echo "SKIP  compact: symlinked home (ln -s made no symlink here, as on Git Bash by default)"
fi
out="$(printf '{}' | HOME="$t/home/" CLAUDE_PROJECT_DIR="$t/home/w/empty/" bash "$hooks/compact-context.sh" 2>/dev/null)"
! printf '%s' "$out" | grep -q 'home note' && ok "compact: a trailing slash on HOME and the project dir still stops the search" || bad "compact: home note read with trailing slashes [$out]"

if command -v cygpath >/dev/null 2>&1; then
  wp="$(cygpath -w "$t/home/w/proj")"
  compact "$wp" '{}'
  printf '%s' "$out" | grep -q 'TASK: ship PR A' && ok "compact: a Windows-form project dir (cygpath) is found" || bad "compact: Windows path [$out]"
else
  echo "SKIP  compact: Windows-form path (no cygpath, not Git Bash)"
fi

# config-audit.sh: audit <config dir> <input json>; sets rc, err
audit() {
  printf '%s' "$2" | CLAUDE_CONFIG_DIR="$1" bash "$hooks/config-audit.sh" 2>"$t/err"; rc=$?
  err="$(cat "$t/err")"
}
cfg="$t/cfg"; mkdir -p "$cfg"
audit "$cfg" "{\"hook_event_name\":\"ConfigChange\",\"source\":\"user_settings\",\"file_path\":\"$cfg/settings.json\"}"
line="$(cat "$cfg/config-changes.log" 2>/dev/null)"
[ "$rc" = 0 ] && [ -z "$err" ] && printf '%s' "$line" | awk -F '\t' -v want="$cfg/settings.json" '$1 ~ /^[0-9]+$/ && $3 == "user_settings" && $4 == want {f=1} END {exit !f}' \
  && ok "audit: one tab-separated line (epoch, time, source, path)" || bad "audit: line [$line] ($rc) [$err]"

audit "$cfg" '{"source":"skills"}'
[ "$(wc -l < "$cfg/config-changes.log" | tr -d ' ')" = 2 ] && tail -n 1 "$cfg/config-changes.log" | awk -F '\t' '$3 == "skills" && $4 == "" {f=1} END {exit !f}' \
  && ok "audit: a change without file_path is logged with an empty path" || bad "audit: no file_path"

before="$(wc -l < "$cfg/config-changes.log" | tr -d ' ')"
audit "$cfg" 'not json {'; r1=$rc; e1=$err
audit "$cfg" '{"file_path":"x"}'; r2=$rc
audit "$cfg" '[1,2]'; r3=$rc
[ "$r1$r2$r3" = 000 ] && [ -z "$e1" ] && [ "$(wc -l < "$cfg/config-changes.log" | tr -d ' ')" = "$before" ] \
  && ok "audit: broken input, no source, or a non-object adds nothing and exits 0" || bad "audit: bad input ($r1$r2$r3) [$e1]"

n0="$(wc -l < "$cfg/config-changes.log" | tr -d ' ')"
audit "$cfg" '{"source":"skills","file_path":"/work/other-repo/.claude/skills/deploy/SKILL.md"}'
[ "$rc" = 0 ] && [ "$(wc -l < "$cfg/config-changes.log" | tr -d ' ')" = "$n0" ] && ok "audit: a project skill outside the config dir is not logged" || bad "audit: project skill logged"
audit "$cfg" "{\"source\":\"user_settings\",\"file_path\":\"$cfg/settings.json\\nINJECTED\\tX\"}"
[ "$rc" = 0 ] && [ "$(wc -l < "$cfg/config-changes.log" | tr -d ' ')" = "$((n0 + 1))" ] && tail -n 1 "$cfg/config-changes.log" | awk -F '\t' 'NF == 4 {f=1} END {exit !f}' \
  && ok "audit: a newline or tab inside file_path cannot add a line or a column" || bad "audit: injection ($(tail -n 2 "$cfg/config-changes.log"))"
mkdir -p "$t/dirlog/config-changes.log"
audit "$t/dirlog" '{"source":"user_settings"}'
[ "$rc" = 0 ] && [ -z "$err" ] && ok "audit: an unwritable log (a directory) still exits 0 with no stderr" || bad "audit: unwritable log ($rc) [$err]"
compact "$t/home/w/proj" "{\"source\":\"compact\",\"cwd\":\"$t/home/w/empty\"}"
printf '%s' "$out" | grep -q 'TASK: ship PR A' && ok "compact: a cwd without a note falls back to CLAUDE_PROJECT_DIR" || bad "compact: no fallback from a note-less cwd [$out]"
compact "" "{\"source\":\"compact\",\"cwd\":\"$t/home/w/proj/gone/wt\"}"  # no CLAUDE_PROJECT_DIR: only the cwd walk can find it
printf '%s' "$out" | grep -q 'TASK: ship PR A' && ok "compact: a removed cwd is skipped and its parents are still searched" || bad "compact: removed cwd [$out]"
mkdir -p "$t/realcfg"; ln -s "$t/realcfg" "$t/linkcfg" 2>/dev/null
if [ -L "$t/linkcfg" ]; then
  audit "$t/linkcfg" "{\"source\":\"user_settings\",\"file_path\":\"$t/realcfg/settings.json\"}"
  [ "$(wc -l < "$t/realcfg/config-changes.log" 2>/dev/null | tr -d ' ')" = 1 ] && ok "audit: a symlinked config dir reported by its real path is still logged" || bad "audit: symlinked config dir"
else
  echo "SKIP  audit: symlinked config dir (ln -s made no symlink here)"
fi
audit "$t/missing-dir" '{"source":"user_settings"}'
[ "$rc" = 0 ] && [ -z "$err" ] && [ ! -e "$t/missing-dir" ] && ok "audit: a missing config dir is not created, exit 0" || bad "audit: missing dir ($rc) [$err]"

big="$t/big"; mkdir -p "$big"
awk 'BEGIN { for (i = 0; i < 4000; i++) printf "%d\tT\tuser_settings\t/a/very/long/path/to/settings/file/number/%06d/settings.json\n", i, i }' > "$big/config-changes.log"
audit "$big" "{\"source\":\"user_settings\",\"file_path\":\"$big/last\"}"
[ "$rc" = 0 ] && [ "$(wc -l < "$big/config-changes.log" | tr -d ' ')" = 500 ] && tail -n 1 "$big/config-changes.log" | grep -q '/last$' \
  && ok "audit: a log over 256 KB keeps its last 500 lines, newest included" || bad "audit: rotation ($(wc -l < "$big/config-changes.log") lines)"

echo "failures: $fail"
exit "$fail"
