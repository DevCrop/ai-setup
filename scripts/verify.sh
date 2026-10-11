#!/usr/bin/env bash
# Read-only verification. Repo checks always; machine checks with --live.
# Usage: bash scripts/verify.sh [--live] [--full]
#   --live  compare the applied files in the Claude config directory with claude/, check tools and the Ponytail plugin
#   --full  also run scripts/qa-deny.sh (needs the claude CLI and uses the haiku model)
# Exit code 1 when any FAIL is printed. WARN is informational. Works on macOS bash and Git Bash on Windows.
set -u

repo="$(cd "$(dirname "$0")/.." && pwd)"
src="$repo/claude"
dest="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
live=0
full=0
for a in "$@"; do
  case "$a" in
    --live) live=1 ;;
    --full) full=1 ;;
    *) echo "usage: bash scripts/verify.sh [--live] [--full]" >&2; exit 2 ;;
  esac
done

fails=0
warns=0
pass() { printf 'PASS  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; fails=$((fails + 1)); }
warn() { printf 'WARN  %s\n' "$*"; warns=$((warns + 1)); }
skip() { printf 'SKIP  %s\n' "$*"; }

# Frontmatter lines (between the first two --- lines) of a markdown file.
# CR is stripped first: Git for Windows may check files out with CRLF line endings.
frontmatter() { tr -d '\r' < "$1" | awk 'NR==1 && $0!="---" {exit} /^---$/ {c++; next} c==1 {print} c>=2 {exit}'; }
# Top-level keys of that frontmatter.
fm_keys() { frontmatter "$1" | sed -n 's/^\([A-Za-z][A-Za-z_-]*\):.*/\1/p'; }
in_list() { case " $2 " in *" $1 "*) return 0 ;; esac; return 1; }

echo "== repo ($repo)"

# Field names from the Claude Code docs (sub-agents and skills pages). Unknown fields are ignored by
# Claude Code without an error, so a typo would silently do nothing: report them.
agent_keys="name description tools disallowedTools model permissionMode maxTurns skills mcpServers hooks memory background omitClaudeMd effort isolation color initialPrompt experimental"
skill_keys="name description when_to_use argument-hint arguments disable-model-invocation user-invocable allowed-tools disallowed-tools model effort context agent background hooks paths shell metadata license compatibility"

# 1. settings.json is valid JSON
if command -v jq >/dev/null 2>&1; then
  if jq empty "$src/settings.json" 2>/dev/null; then pass "settings.json is valid JSON"; else fail "settings.json is not valid JSON"; fi
elif command -v python3 >/dev/null 2>&1; then
  if python3 -c "import json,sys;json.load(open(sys.argv[1]))" "$src/settings.json" 2>/dev/null; then pass "settings.json is valid JSON"; else fail "settings.json is not valid JSON"; fi
else
  skip "settings.json JSON check (needs jq or python3)"
fi

# 2. shell syntax
syntax_ok=1
for f in "$repo"/scripts/*.sh; do bash -n "$f" 2>/dev/null || { fail "bash -n failed: ${f#$repo/}"; syntax_ok=0; }; done
[ "$syntax_ok" -eq 1 ] && pass "bash -n scripts/*.sh"

# 3. every Bash deny/ask pattern has its rtk twin

if out="$(bash "$repo/scripts/qa-deny.sh" --static 2>&1)"; then pass "$(printf '%s' "$out" | sed 's/^PASS  //')"; else fail "rtk twin check: $out"; fi

# 3a. status line cache segment: sample prompt_cache JSON (warm, expiring, cold, absent)
if out="$(bash "$repo/scripts/qa-statusline.sh" 2>&1)"; then pass "statusline cache segment"; else fail "statusline: $(printf '%s' "$out" | grep '^FAIL' | head -3)"; fi

# 3b. secret-guard hook: file present, referenced from settings.json, unit tests pass
if [ -f "$src/hooks/secret-guard.sh" ] && jq -e '[.hooks.PreToolUse[].hooks[].command] | any(contains("hooks/secret-guard.sh"))' "$src/settings.json" >/dev/null 2>&1; then
  if out="$(bash "$repo/scripts/qa-hooks.sh" 2>&1)"; then pass "secret-guard hook ($(printf '%s' "$out" | grep -c '^PASS') unit cases)"; else fail "secret-guard unit tests: $(printf '%s' "$out" | grep '^FAIL' | head -3)"; fi
else
  fail "secret-guard hook missing or not referenced in settings.json"
fi

# 4. settings that must stay on
# Default mode is bypassPermissions (decision 2026-10-10). Deny rules still apply in that mode (permission-modes doc), so they must exist;
# a leftover bypass lock would stop the mode from starting.
if command -v jq >/dev/null 2>&1; then
  jq -e '(.permissions.defaultMode == "bypassPermissions") and (.permissions.disableBypassPermissionsMode == null)' "$src/settings.json" >/dev/null 2>&1 \
    && pass "permissions.defaultMode is bypassPermissions and the bypass lock is absent" \
    || fail "permissions.defaultMode must be bypassPermissions with no disableBypassPermissionsMode"
  jq -e '(.permissions.deny | type == "array") and (.permissions.deny | length > 0)' "$src/settings.json" >/dev/null 2>&1 \
    && pass "permissions.deny is a non-empty list (deny rules still apply in bypass mode)" \
    || fail "permissions.deny is missing or empty"
else
  warn "bypass default and deny list not validated (needs jq)"
fi
# permissions.ask must be a non-empty array (a bare grep for "ask" would also match a comment or another key)
ask_ok=""
if command -v jq >/dev/null 2>&1; then
  jq -e '(.permissions.ask | type == "array") and (.permissions.ask | length > 0)' "$src/settings.json" >/dev/null 2>&1 && ask_ok=1 || ask_ok=0
elif command -v python3 >/dev/null 2>&1 && python3 -c "" >/dev/null 2>&1; then
  python3 -c "import json,sys;a=json.load(open(sys.argv[1])).get('permissions',{}).get('ask');sys.exit(0 if isinstance(a,list) and a else 1)" "$src/settings.json" 2>/dev/null && ask_ok=1 || ask_ok=0
fi
case "$ask_ok" in
  1) pass "permissions.ask is a non-empty list" ;;
  0) fail "permissions.ask is missing or empty" ;;
  *) grep -q '"ask"' "$src/settings.json" && warn "permissions.ask present (not validated: needs jq or python3)" || fail "permissions.ask is missing" ;;
esac

# 5. global CLAUDE.md size (docs: target under 200 lines)
lines="$(wc -l < "$src/CLAUDE.md" | tr -d ' ')"
[ "$lines" -le 200 ] && pass "claude/CLAUDE.md has $lines lines (limit 200)" || fail "claude/CLAUDE.md has $lines lines (limit 200)"

# 6. agents
for f in "$src"/agents/*.md; do
  [ -f "$f" ] || continue
  n="${f#$src/}"
  keys="$(fm_keys "$f")"
  [ -n "$keys" ] || { fail "$n: no frontmatter"; continue; }
  dup="$(printf '%s\n' "$keys" | sort | uniq -d | tr '\n' ' ')"
  [ -z "$dup" ] || fail "$n: duplicate frontmatter key(s): $dup"
  printf '%s\n' "$keys" | grep -qx name || fail "$n: missing name"
  printf '%s\n' "$keys" | grep -qx description || fail "$n: missing description"
  bad=""
  for k in $(printf '%s\n' "$keys" | sort -u); do in_list "$k" "$agent_keys" || bad="$bad $k"; done
  [ -z "$bad" ] || warn "$n: unknown frontmatter key(s):$bad (ignored by Claude Code)"
  [ -z "$dup" ] && [ -z "$bad" ] && pass "$n frontmatter"
done

# 7. skills
for d in "$src"/skills/*/; do
  [ -d "$d" ] || continue
  dn="$(basename "$d")"
  f="$d/SKILL.md"
  n="skills/$dn/SKILL.md"
  [ -f "$f" ] || { fail "$n: missing"; continue; }
  keys="$(fm_keys "$f")"
  dup="$(printf '%s\n' "$keys" | sort | uniq -d | tr '\n' ' ')"
  [ -z "$dup" ] || fail "$n: duplicate frontmatter key(s): $dup"
  name="$(frontmatter "$f" | sed -n 's/^name:[[:space:]]*//p')"
  [ "$name" = "$dn" ] || fail "$n: name '$name' differs from directory '$dn'"
  desc="$(frontmatter "$f" | sed -n 's/^description:[[:space:]]*//p')"
  if [ -z "$desc" ]; then
    fail "$n: description missing or not on one line"
  else
    len="$(printf '%s' "$desc" | wc -c | tr -d ' ')"
    [ "$len" -le 1536 ] || fail "$n: description is $len characters (listing cap 1536)"
  fi
  bad=""
  for k in $(printf '%s\n' "$keys" | sort -u); do in_list "$k" "$skill_keys" || bad="$bad $k"; done
  [ -z "$bad" ] || warn "$n: unknown frontmatter key(s):$bad (ignored by Claude Code)"
  [ -z "$dup" ] && [ -z "$bad" ] && [ "$name" = "$dn" ] && [ -n "$desc" ] && pass "$n frontmatter"
done

# 8. everything apply.sh copies exists
items="$(sed -n 's/^items="\(.*\)"$/\1/p' "$repo/scripts/apply.sh")"
[ -n "$items" ] || fail "could not read the items list from scripts/apply.sh"
missing=""
for item in $items; do [ -e "$src/$item" ] || missing="$missing $item"; done
[ -z "$missing" ] && pass "apply.sh items exist in claude/" || fail "apply.sh copies items that are not in claude/:$missing"

if [ "$live" -eq 1 ]; then
  echo "== machine ($dest)"
  if [ ! -d "$dest" ]; then
    # Stop here: running the claude CLI against a missing CLAUDE_CONFIG_DIR would create it.
    fail "config directory not found: $dest (run: bash scripts/apply.sh)"
    echo "== $fails FAIL, $warns WARN"
    exit 1
  fi

  # 9. applied files equal the repo (extra files in the config directory are ignored)
  for item in $items; do
    if [ ! -e "$dest/$item" ]; then fail "not applied: $item (run: bash scripts/apply.sh)"; continue; fi
    drift=""
    if [ -d "$src/$item" ]; then
      while IFS= read -r f; do
        rel="${f#$src/}"
        cmp -s "$f" "$dest/$rel" || drift="$drift $rel"
      done <<EOF
$(find "$src/$item" -type f)
EOF
    else
      if ! cmp -s "$src/$item" "$dest/$item"; then
        # settings.json: key order alone is not drift, and "env" is machine-local (apply.sh keeps it)
        if [ "$item" = "settings.json" ] && command -v jq >/dev/null 2>&1 \
           && [ "$(jq -S 'del(.env)' "$src/$item" 2>/dev/null)" = "$(jq -S 'del(.env)' "$dest/$item" 2>/dev/null)" ]; then
          :
        else
          drift=" $item"
        fi
      fi
    fi
    [ -z "$drift" ] && pass "in sync: $item" || fail "differs from claude/:$drift (apply.sh would overwrite; if the live copy has a change you want, move it into claude/ first)"
  done

  # 10. tools
  command -v jq >/dev/null 2>&1 && pass "jq on PATH" || fail "jq not on PATH (the status line needs it)"
  command -v rtk >/dev/null 2>&1 && pass "rtk on PATH ($(rtk --version 2>/dev/null | head -n 1))" || warn "rtk not on PATH: the hook is a no-op and Bash output is not filtered"
  command -v node >/dev/null 2>&1 && pass "node on PATH" || warn "node not on PATH (Ponytail hooks run on Node.js)"
  command -v gh >/dev/null 2>&1 && pass "gh on PATH" || warn "gh not on PATH"

  # 11. Ponytail plugin
  if command -v claude >/dev/null 2>&1; then
    pl="$(claude plugin list 2>&1)"
    # The ponytail entry only: from its line up to the next plugin id, so a neighbour's status is not read.
    block="$(printf '%s\n' "$pl" | awk '/ponytail@ponytail/ {f=1; print; next} f && /[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+/ {exit} f {print}' | head -n 8)"
    if [ -z "$block" ]; then
      fail "plugin ponytail@ponytail is not installed (claude plugin marketplace add DietrichGebert/ponytail; claude plugin install ponytail@ponytail)"
    elif printf '%s' "$block" | grep -qi 'disabled'; then
      fail "plugin ponytail@ponytail is installed but disabled"
      printf '%s\n' "$block" | sed 's/^/        /'
    elif printf '%s' "$block" | grep -qi 'enabled'; then
      pass "plugin ponytail@ponytail is installed and enabled"
    else
      warn "plugin ponytail@ponytail is listed but its status is unclear:"
      printf '%s\n' "$block" | sed 's/^/        /'
    fi
  else
    skip "plugin check (claude CLI not on PATH)"
  fi
  # The app keeps its own copy of the task body; apply.sh cannot sync it.
  task="$dest/scheduled-tasks/daily-claude-update/SKILL.md"
  if [ -f "$task" ]; then
    grep -q 'claude/routines/daily-update.md' "$task" && pass "scheduled task points at claude/routines/daily-update.md" || warn "scheduled task body is not the pointer body (re-paste claude/scheduled-tasks/daily-claude-update/SKILL.md in the app)"
  else
    warn "scheduled task daily-claude-update not found (create it in the app, see docs/GUIDE.md section 4)"
  fi
  if [ -f "$dest/.ponytail-active" ]; then pass "Ponytail flag file: $(head -n 1 "$dest/.ponytail-active")"; else warn "no .ponytail-active flag yet (written by the plugin's hooks in a new session)"; fi
fi

if [ "$full" -eq 1 ]; then
  echo "== deny and ask rules (qa-deny.sh)"
  if bash "$repo/scripts/qa-deny.sh"; then pass "qa-deny.sh"; else fail "qa-deny.sh"; fi
fi

echo "== $fails FAIL, $warns WARN"
[ "$fails" -eq 0 ]
