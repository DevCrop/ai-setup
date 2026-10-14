#!/usr/bin/env bash
# Read-only verification. Repo checks always; machine checks with --live.
# Usage: bash scripts/verify.sh [--live] [--full]
#   --live  compare the applied files in the Claude config directory with claude/, check tools and the Ponytail plugin
#   --full  also run scripts/qa-deny.sh (needs the claude CLI and uses the haiku model)
# Exit code 1 when any FAIL is printed. WARN is informational. Works in Git Bash on Windows.
set -u

repo="$(cd "$(dirname "$0")/.." && pwd)"
src="$repo/claude"
dest="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
dest="${dest%/}"
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
info() { printf 'INFO  %s\n' "$*"; }

# Frontmatter lines (between the first two --- lines) of a markdown file.
# CR is stripped first: Git for Windows may check files out with CRLF line endings.
frontmatter() { tr -d '\r' < "$1" | awk 'NR==1 && $0!="---" {exit} /^---$/ {c++; next} c==1 {print} c>=2 {exit}'; }
# Top-level keys of that frontmatter.
fm_keys() { frontmatter "$1" | sed -n 's/^\([A-Za-z][A-Za-z_-]*\):.*/\1/p'; }
in_list() { case " $2 " in *" $1 "*) return 0 ;; esac; return 1; }
# Characters in UTF-8 text in any locale: bytes minus continuation bytes (wc -m counts bytes under LC_ALL=C).
chars() { printf '%s' "$1" | LC_ALL=C tr -d '\200-\277' | wc -c | tr -d ' '; }
# A one-line frontmatter scalar as YAML reads it: a quoted value loses its quotes and keeps any " #" inside them; an unquoted value
# loses a trailing " # comment". Trailing spaces go in both cases.
fm_value() {
  frontmatter "$1" | sed -n "s/^$2:[[:space:]]*//p" | sed 's/[[:space:]]*$//' | awk '
    /^"[^"]*"([[:space:]]+#.*)?$/ { sub(/^"/, ""); sub(/"([[:space:]]+#.*)?$/, ""); print; next }
    /^'"'"'[^'"'"']*'"'"'([[:space:]]+#.*)?$/ { sub(/^'"'"'/, ""); sub(/'"'"'([[:space:]]+#.*)?$/, ""); print; next }
    { sub(/[[:space:]]+#.*$/, ""); print }'
}
# fm_multiline <file> <key>: true when the key's value spans lines (a block marker such as | >- >2, or an indented continuation line).
fm_multiline() {
  # awk runs END after an exit in a rule, so the verdict is kept in m and END exits with it (m: 1 multi-line, 0 one line)
  frontmatter "$1" | awk -v k="$2" '
    found { m = ($0 ~ /^[[:space:]]+[^[:space:]]/); exit }
    index($0, k ":") == 1 { v = substr($0, length(k) + 2); sub(/^[[:space:]]+/, "", v); if (v ~ /^[|>][0-9+-]*([[:space:]]+#.*)?$/) { m = 1; exit } found = 1; next }
    END { exit !m }'
}

echo "== repo ($repo)"

# Field names from the Claude Code docs (sub-agents and skills pages). Unknown fields are ignored by
# Claude Code without an error, so a typo would silently do nothing: report them.
agent_keys="name description tools disallowedTools model permissionMode maxTurns skills mcpServers hooks memory background omitClaudeMd effort isolation color initialPrompt experimental"
skill_keys="name description when_to_use argument-hint arguments disable-model-invocation user-invocable allowed-tools disallowed-tools model effort context agent background hooks paths shell metadata license compatibility"

# 1. settings.json is valid JSON
if command -v jq >/dev/null 2>&1; then
  if jq empty "$src/settings.json" 2>/dev/null; then pass "settings.json is valid JSON"; else fail "settings.json is not valid JSON"; fi
elif command -v python3 >/dev/null 2>&1 && python3 -c "" >/dev/null 2>&1; then
  if python3 -c "import json,sys;json.load(open(sys.argv[1]))" "$src/settings.json" 2>/dev/null; then pass "settings.json is valid JSON"; else fail "settings.json is not valid JSON"; fi
else
  skip "settings.json JSON check (needs jq or python3)"
fi

# 2. shell syntax
syntax_ok=1
for f in "$repo"/scripts/*.sh "$src"/hooks/*.sh "$src"/statusline.sh; do bash -n "$f" 2>/dev/null || { fail "bash -n failed: ${f#$repo/}"; syntax_ok=0; }; done
[ "$syntax_ok" -eq 1 ] && pass "bash -n scripts/*.sh claude/hooks/*.sh claude/statusline.sh"

# 3. every Bash deny/ask pattern has its rtk twin

if out="$(bash "$repo/scripts/qa-deny.sh" --static 2>&1)"; then pass "$(printf '%s' "$out" | sed 's/^PASS  //')"; else fail "rtk twin check: $out"; fi
if out="$(bash "$repo/scripts/qa-deny.sh" --selftest-classify 2>&1)"; then pass "qa-deny result $(printf '%s' "$out" | tail -1 | sed 's/^PASS  //')"; else fail "qa-deny classifier: $(printf '%s' "$out" | tail -1)"; fi  # no pipe in the test: its exit code decides

# 3a, 3b: skipped when qa-apply.sh calls this script (they are slow and already ran in the outer run)
if [ -z "${QA_APPLY_RUNNING:-}" ]; then
  # 3a. status line cache segment: sample prompt_cache JSON (warm, expiring, cold, absent)
  if out="$(bash "$repo/scripts/qa-statusline.sh" 2>&1)"; then pass "statusline cache segment"; else fail "statusline: $(printf '%s' "$out" | grep '^FAIL' | head -3)"; fi
  if out="$(bash "$repo/scripts/qa-setup-claude-mem.sh" 2>&1)"; then pass "setup-claude-mem backs up before it writes"; else fail "setup-claude-mem: $(printf '%s' "$out" | grep '^FAIL' | head -3)"; fi

  # 3b. secret-guard hook: file present, referenced from settings.json, unit tests pass
  # both entries: Bash, and the GitHub MCP file writes (push_files, create_or_update_file) with onFailure block
  if [ -f "$src/hooks/secret-guard.sh" ] && jq -e '([.hooks.PreToolUse[] | select(.matcher == "Bash") | .hooks[].command] | any(contains("hooks/secret-guard.sh")))
       and ([.hooks.PreToolUse[] | select((.matcher // "") | test("push_files")) | .hooks[] | select(.onFailure == "block") | .command] | any(contains("hooks/secret-guard.sh")))' "$src/settings.json" >/dev/null 2>&1; then
    if out="$(bash "$repo/scripts/qa-hooks.sh" 2>&1)"; then pass "secret-guard hook ($(printf '%s' "$out" | grep -c '^PASS') unit cases)"; else fail "secret-guard unit tests: $(printf '%s' "$out" | grep '^FAIL' | head -3)"; fi
  else
    fail "secret-guard hook missing, or not referenced for Bash and for the GitHub MCP file writes in settings.json"
  fi

  # 3d. session hooks: compact-context.sh (SessionStart compact) and config-audit.sh (ConfigChange) present, referenced, unit tests pass
  if [ -f "$src/hooks/compact-context.sh" ] && [ -f "$src/hooks/config-audit.sh" ] \
     && jq -e '([.hooks.SessionStart[]? | select(.matcher == "compact") | .hooks[].command] | any(contains("hooks/compact-context.sh")))
               and ([.hooks.ConfigChange[]?.hooks[].command] | any(contains("hooks/config-audit.sh")))' "$src/settings.json" >/dev/null 2>&1; then
    if out="$(bash "$repo/scripts/qa-hooks-session.sh" 2>&1)"; then pass "session hooks ($(printf '%s' "$out" | grep -c '^PASS') unit cases)"; else fail "session hook unit tests: $(printf '%s' "$out" | grep '^FAIL' | head -3)"; fi
  else
    fail "compact-context.sh or config-audit.sh missing or not referenced in settings.json"
  fi
fi

# 3c. apply.sh scenarios in scratch directories (fresh, rerun, stale files, machine-only keys, owned keys, removed keys, no jq, bad JSON)
if [ -z "${QA_APPLY_RUNNING:-}" ]; then
  if command -v jq >/dev/null 2>&1; then
    if out="$(bash "$repo/scripts/qa-apply.sh" 2>&1)"; then pass "apply.sh scenarios ($(printf '%s' "$out" | grep -c '^PASS') cases)"; else fail "apply.sh scenarios: $(printf '%s' "$out" | grep '^FAIL' | head -3)"; fi
  else
    skip "apply.sh scenarios (needs jq)"
  fi
fi

# 4. settings that must stay on
# Default mode is auto (decision 2026-10-11, official recommendation; bypassPermissions is documented for isolated containers and VMs only).
# Deny and ask rules are the deterministic guard next to the classifier, so they must exist. autoMode arrays must keep "$defaults",
# otherwise the built-in classifier rules are dropped. permissions.allow stays empty (broad allow rules are suspended in auto mode anyway).
if command -v jq >/dev/null 2>&1; then
  jq -e '.permissions.defaultMode == "auto"' "$src/settings.json" >/dev/null 2>&1 \
    && pass "permissions.defaultMode is auto" \
    || fail "permissions.defaultMode must be auto"
  jq -e '.permissions.disableBypassPermissionsMode == "disable"' "$src/settings.json" >/dev/null 2>&1 \
    && pass "permissions.disableBypassPermissionsMode is disable (bypass stays for isolated containers, not this setup)" \
    || fail "permissions.disableBypassPermissionsMode must be \"disable\""
  # Model lanes (decision 2026-10-12): Opus main at medium effort, Haiku executors, Opus verifiers, no Sonnet or Fable in the repo.
  # `opus[1m]` is the spelling the CLI writes back (decision 2026-10-13); Opus 5.5 already runs at 1M, so it changes nothing else.
  jq -e '.model == "opus[1m]" and .modelSettings["claude-opus-5-5"].effortLevel == "medium"' "$src/settings.json" >/dev/null 2>&1 \
    && pass "main model is opus[1m] at medium effort" \
    || fail "settings.json model must be opus[1m] with modelSettings.claude-opus-5-5.effortLevel medium"
  # Reply style (decision 2026-10-13): the built-in Concise output style; the name is case-sensitive.
  jq -e '.outputStyle == "Concise"' "$src/settings.json" >/dev/null 2>&1 \
    && pass "outputStyle is Concise" \
    || fail "settings.json outputStyle must be Concise (case-sensitive)"
  # Weekly CI (decision 2026-10-13): check.yml also runs on a schedule and by hand.
  grep -q '^  schedule:' "$repo/.github/workflows/check.yml" && grep -q '^  workflow_dispatch:' "$repo/.github/workflows/check.yml" \
    && pass "check.yml runs weekly and by hand" \
    || fail "check.yml must keep its schedule and workflow_dispatch triggers"
  jq -e '(.skipDangerousModePermissionPrompt == null) and (.permissions.disableAutoMode == null) and (.disableAutoMode == null)' "$src/settings.json" >/dev/null 2>&1 \
    && pass "no skipDangerousModePermissionPrompt and no disableAutoMode" \
    || fail "settings.json sets skipDangerousModePermissionPrompt or disableAutoMode"
  jq -e '(.permissions.deny | type == "array") and (.permissions.deny | length > 0)' "$src/settings.json" >/dev/null 2>&1 \
    && pass "permissions.deny is a non-empty list (deny rules apply in every mode)" \
    || fail "permissions.deny is missing or empty"
  jq -e '(.permissions.allow | type == "array") and (.permissions.allow | length == 0)' "$src/settings.json" >/dev/null 2>&1 \
    && pass "permissions.allow is an empty list" \
    || fail "permissions.allow must be an explicit empty list"
  jq -e '(.autoMode | type == "object") and ([.autoMode | to_entries[] | select(.value | type == "array") | .value | index("$defaults") == null] | any | not)' "$src/settings.json" >/dev/null 2>&1 \
    && pass "every autoMode array keeps \"\$defaults\"" \
    || fail "autoMode is missing or an array lacks \"\$defaults\" (the built-in classifier rules would be dropped)"
  jq -e '.skillOverrides["auto-mode-setup"] == "off"' "$src/settings.json" >/dev/null 2>&1 \
    && pass "/auto-mode-setup is off (autoMode is owned by this repo)" \
    || fail "skillOverrides.auto-mode-setup must be \"off\""
else
  warn "auto mode settings and deny list not validated (needs jq)"
fi
# Superpowers is not adopted at any scope (docs/DECISIONS.md "Superpowers is not adopted at any scope"): the repo must not enable it.
if command -v jq >/dev/null 2>&1; then
  jq -e '[.enabledPlugins // {} | keys[] | select(startswith("superpowers@"))] | length == 0' "$src/settings.json" >/dev/null 2>&1 \
    && pass "settings.json does not enable Superpowers" \
    || fail "settings.json enables Superpowers (not adopted, decision 2026-10-11)"
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
# Weekly update PRs (decision 2026-10-13): updates.yml runs update-pins.py on a schedule and by hand.
upd="$repo/.github/workflows/updates.yml"
[ -f "$upd" ] && grep -q '^  schedule:' "$upd" && grep -q '^  workflow_dispatch:' "$upd" && grep -q 'scripts/update-pins.py --write' "$upd" \
  && pass "updates.yml runs update-pins.py weekly and by hand" \
  || fail "updates.yml must exist with schedule and workflow_dispatch triggers and run scripts/update-pins.py --write"

# 5. global CLAUDE.md size (docs: target under 200 lines)
lines="$(wc -l < "$src/CLAUDE.md" | tr -d ' ')"
[ "$lines" -le 200 ] && pass "claude/CLAUDE.md has $lines lines (limit 200)" || fail "claude/CLAUDE.md has $lines lines (limit 200)"

# 6. agents
agent_names=""
agent_desc_chars=0
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
  amodel="$(fm_value "$f" model)"
  case "$amodel" in haiku|opus|inherit|"") ;; *) fail "$n: model '$amodel' is outside the lanes (haiku executors, opus verifiers; decision 2026-10-12)" ;; esac
  # sub-agents doc: a name that starts with "-", contains ":" or is longer than 256 characters makes Claude Code skip the file
  aname="$(fm_value "$f" name)"
  case "$aname" in -*) fail "$n: name '$aname' starts with '-' (Claude Code skips the file, sub-agents doc)" ;; esac
  case "$aname" in *:*) fail "$n: name '$aname' contains ':' (reserved for plugin-scoped names, sub-agents doc)" ;; esac
  [ "$(chars "$aname")" -le 256 ] || fail "$n: name is longer than 256 characters (sub-agents doc)"
  agent_names="$agent_names$aname
"
  agent_desc_chars=$((agent_desc_chars + $(chars "$(fm_value "$f" description)")))
  [ -z "$dup" ] && [ -z "$bad" ] && pass "$n frontmatter"
done
dupnames="$(printf '%s' "$agent_names" | sed '/^$/d' | sort | uniq -d | tr '\n' ' ')"
[ -z "$dupnames" ] || fail "agent name used twice: $dupnames(names must be unique, sub-agents doc)"
# The doc warns at startup above 15,000 tokens of combined descriptions. A character is at most about one token for the text used here
# (English and Korean), so 15,000 characters is a conservative stand-in, not a token count.
if [ "$agent_desc_chars" -le 15000 ]; then pass "agent descriptions: $agent_desc_chars characters in total (startup warning at 15,000 tokens)"
else warn "agent descriptions: $agent_desc_chars characters in total, may pass the 15,000-token startup warning; move detail into the agent bodies"; fi

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
  name="$(fm_value "$f" name)"
  [ "$name" = "$dn" ] || fail "$n: name '$name' differs from directory '$dn'"
  desc="$(fm_value "$f" description)"
  fm_multiline "$f" description && desc=""
  wtu="$(fm_value "$f" when_to_use)"
  wtu_ok=1
  if printf '%s\n' "$keys" | grep -qx when_to_use; then
    if [ -z "$wtu" ] || fm_multiline "$f" when_to_use; then wtu_ok=0; wtu=""; fail "$n: when_to_use missing or not on one line (the length check reads one line)"; fi
  fi
  if [ -z "$desc" ]; then
    fail "$n: description missing or not on one line"
  else
    # description and when_to_use share one 1,536-character cap in the skill listing (skills doc); one space joins them only when both exist
    len="$(chars "$desc${wtu:+ $wtu}")"
    [ "$len" -le 1536 ] || fail "$n: description + when_to_use is $len characters (listing cap 1536)"
  fi
  lines="$(wc -l < "$f" | tr -d ' ')"
  [ "$lines" -le 500 ] || fail "$n: $lines lines, over 500 (skills doc: keep SKILL.md under 500 lines; move reference material to separate files)"
  bad=""
  for k in $(printf '%s\n' "$keys" | sort -u); do in_list "$k" "$skill_keys" || bad="$bad $k"; done
  [ -z "$bad" ] || warn "$n: unknown frontmatter key(s):$bad (ignored by Claude Code)"
  [ -z "$dup" ] && [ -z "$bad" ] && [ "$name" = "$dn" ] && [ -n "$desc" ] && [ "$wtu_ok" = 1 ] && pass "$n frontmatter"
done

# 8. everything apply.sh copies exists
items="$(sed -n 's/^items="\(.*\)"$/\1/p' "$repo/scripts/apply.sh")"
[ -n "$items" ] || fail "could not read the items list from scripts/apply.sh"
missing=""
for item in $items; do [ -e "$src/$item" ] || missing="$missing $item"; done
[ -z "$missing" ] && pass "apply.sh items exist in claude/" || fail "apply.sh copies items that are not in claude/:$missing"

# 8b. docs: every docs/*.md path that the docs, skills, agents and scripts mention exists (evidence.md and DECISIONS.md quote retired paths
#     on purpose and are skipped), and every plugin that settings.json enables is described in GUIDE.md
missing_refs=""
for f in README.md CLAUDE.md docs/GUIDE.md claude/CLAUDE.md claude/routines/*.md claude/skills/*/SKILL.md claude/agents/*.md scripts/*.sh scripts/*.py scripts/dashboard/*.py; do
  [ -f "$repo/$f" ] || continue
  case "$f" in scripts/qa-*) continue ;; esac  # QA scripts build fixture projects with their own docs/ files
  for ref in $(grep -o 'docs/[A-Za-z0-9._/-]*\.md' "$repo/$f" | sort -u); do
    [ -e "$repo/$ref" ] || missing_refs="$missing_refs $f->$ref"
  done
done
[ -z "$missing_refs" ] && pass "docs paths mentioned in the repo exist" || fail "mentioned docs files do not exist:$missing_refs"
if command -v jq >/dev/null 2>&1; then
  undoc=""
  jq -e '(.enabledPlugins // {}) | type == "object"' "$src/settings.json" >/dev/null 2>&1 || fail "enabledPlugins in claude/settings.json is not an object"
  for k in $(jq -r '.enabledPlugins // {} | keys[]' "$src/settings.json" 2>/dev/null | tr -d '\r'); do
    grep -qF "$k" "$repo/docs/GUIDE.md" || undoc="$undoc $k"
  done
  [ -z "$undoc" ] && pass "every enabled plugin is described in docs/GUIDE.md" || fail "plugins enabled in settings.json but not in docs/GUIDE.md:$undoc"
fi

if [ "$live" -eq 1 ]; then
  echo "== machine ($dest)"
  if [ ! -d "$dest" ]; then
    # Stop here: running the claude CLI against a missing CLAUDE_CONFIG_DIR would create it.
    fail "config directory not found: $dest (run: bash scripts/apply.sh)"
    echo "== $fails FAIL, $warns WARN"
    exit 1
  fi

  # 9. applied files equal the repo. settings.json is merged by apply.sh: only the keys this repo owns are compared (machine-only keys
  #    such as env or a plugin enabled by "claude plugin install" are INFO); a difference in an owned key is a WARN, because the
  #    live value (for example a rule added in /permissions) is not the repo's and the next apply.sh replaces it.
  for item in $items; do
    if [ ! -e "$dest/$item" ]; then fail "not applied: $item (run: bash scripts/apply.sh)"; continue; fi
    if [ "$item" = "settings.json" ]; then
      if ! command -v jq >/dev/null 2>&1; then skip "settings.json comparison (needs jq)"; continue; fi
      if ! jq -e 'type == "object"' "$dest/settings.json" >/dev/null 2>&1; then fail "$dest/settings.json is empty or not a JSON object (run: bash scripts/apply.sh)"; continue; fi
      if ! jq -e '(.top | type) == "array" and (.permissions | type) == "array"' "$repo/scripts/owned-keys.json" >/dev/null 2>&1; then fail "scripts/owned-keys.json is missing or malformed"; continue; fi
      owned_diff="$(jq -n -r --slurpfile l "$dest/settings.json" --slurpfile r "$src/settings.json" --slurpfile o "$repo/scripts/owned-keys.json" '
        def own_top: $o[0].top; def own_perm: $o[0].permissions;  # the keys apply.sh owns, one list for both scripts
        $l[0] as $l | $r[0] as $r
        | ([own_top[] as $k | select($l[$k] != $r[$k]) | $k]
           + [own_perm[] as $k | select((($l.permissions // {})[$k]) != (($r.permissions // {})[$k])) | "permissions." + $k]
           + [($r | keys[]) as $k | select(($k | IN(own_top[]) or $k == "permissions" or $k == "enabledPlugins" or $k == "modelSettings" or $k == "env") | not) | select($l[$k] != $r[$k]) | $k]
           + [($r.enabledPlugins // {} | to_entries[]) | select((($l.enabledPlugins // {})[.key]) != .value) | "enabledPlugins." + .key]
           + [($r.modelSettings // {} | to_entries[]) as $e | ($e.value | keys[]) as $f
              | (if ($l.modelSettings | type) == "object" then $l.modelSettings[$e.key] else null end) as $le
              | select(($le | type) != "object" or $le[$f] != $e.value[$f]) | "modelSettings." + $e.key + "." + $f])
        | join(", ")' 2>&1)" || { fail "$dest/settings.json has a key of the wrong type (apply.sh replaces it): $(printf '%s' "$owned_diff" | head -n 1)"; continue; }
      if [ -z "$owned_diff" ]; then pass "in sync: settings.json (keys owned by this repo)"
      else warn "settings.json differs from claude/settings.json in: $owned_diff (apply.sh restores the repo values; to keep a change, edit claude/settings.json first)"; fi
      stale_keys="$(jq -n -r --slurpfile l "$dest/settings.json" --slurpfile x "$repo/scripts/removed-keys.json" '$l[0] as $l | $x[0] | map(select(. as $p | ($l | getpath($p)) != null) | join(".")) | join(", ")' 2>/dev/null)"
      [ -z "$stale_keys" ] || warn "settings.json still has keys that scripts/removed-keys.json deletes: $stale_keys (run: bash scripts/apply.sh)"
      only_keys="$(jq -n -r --slurpfile l "$dest/settings.json" --slurpfile r "$src/settings.json" '$l[0] as $l | $r[0] as $r | (($l | keys) - ($r | keys)) | join(", ")' 2>/dev/null)"
      [ -z "$only_keys" ] || info "machine-only settings.json keys (kept by apply.sh): $only_keys"
      continue
    fi
    drift=""
    if [ -d "$src/$item" ]; then
      while IFS= read -r f; do
        rel="${f#$src/}"
        cmp -s "$f" "$dest/$rel" || drift="$drift $rel"
      done <<EOF
$(find "$src/$item" -type f)
EOF
    else
      cmp -s "$src/$item" "$dest/$item" || drift=" $item"
    fi
    [ -z "$drift" ] && pass "in sync: $item" || fail "differs from claude/:$drift (apply.sh would overwrite; if the live copy has a change you want, move it into claude/ first)"
  done
  # Files in the managed folders that this repo never applied are kept by apply.sh: show them, they are not an error.
  foreign=""
  for item in $items; do
    [ -d "$src/$item" ] || continue
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      [ -e "$src/$f" ] || foreign="$foreign $f"
    done <<EOF
$(cd "$dest" 2>/dev/null && find "$item" -type f 2>/dev/null)
EOF
  done
  [ -z "$foreign" ] || info "files in managed folders that are not from this repo (kept by apply.sh):$foreign"
  # 9b. config-changes.log (hooks/config-audit.sh): settings or skill changes recorded more than 2 minutes after the last apply.sh were
  #     made outside this repo. apply.sh itself triggers lines during a running session; the grace period skips those.
  clog="$dest/config-changes.log"
  # one-time migration (apply.sh): a PC applied before the ai-setup rename has only .claude-global-manifest until its next apply.sh
  [ -f "$dest/.ai-setup-manifest" ] || [ ! -f "$dest/.claude-global-manifest" ] \
    || warn "only the manifest under its pre-rename name exists; run apply.sh (it moves it to .ai-setup-manifest)"
  if [ -f "$clog" ] && [ -f "$dest/.ai-setup-manifest" ]; then
    applied_at="$(date -r "$dest/.ai-setup-manifest" +%s 2>/dev/null || echo 0)"
    later="$(awk -F '\t' -v t="$applied_at" '$1 ~ /^[0-9]+$/ && $1 > t + 120 {print $2 " " $3 " " $4}' "$clog" | tail -n 3)"
    if [ -n "$later" ]; then
      warn "config changed outside this repo after the last apply.sh (last 3 from $clog; move wanted changes into claude/, then apply):"
      printf '%s\n' "$later" | sed 's/^/        /'
    else
      pass "no config change recorded after the last apply.sh"
    fi
  fi

  # 10. tools
  command -v jq >/dev/null 2>&1 && pass "jq on PATH" || fail "jq not on PATH (the status line needs it)"
  command -v rtk >/dev/null 2>&1 && pass "rtk on PATH ($(rtk --version 2>/dev/null | head -n 1))" || warn "rtk not on PATH: the hook is a no-op and Bash output is not filtered"
  command -v node >/dev/null 2>&1 && pass "node on PATH" || warn "node not on PATH (Ponytail hooks run on Node.js)"
  command -v gh >/dev/null 2>&1 && pass "gh on PATH" || warn "gh not on PATH"

  # 10b. auto mode: version floor, effective classifier config, no disableAutoMode in live or project settings
  if command -v claude >/dev/null 2>&1; then
    cv="$(claude --version 2>/dev/null | head -n 1 | sed -n 's/^\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\).*/\1/p')"
    if [ -z "$cv" ]; then
      warn "could not read the claude version"
    elif [ "$(printf '%s\n' "$cv" | awk -F. '{ printf "%d", $1*1000000 + $2*1000 + $3 }')" -ge 2001295 ]; then
      pass "claude $cv (2.1.295 or newer: auto mode default, hook onFailure)"
    else
      fail "claude $cv is older than 2.1.295 (needed for auto mode as the default and for hook onFailure)"
    fi
    if command -v jq >/dev/null 2>&1; then
      am="$(CLAUDE_CONFIG_DIR="$dest" claude auto-mode config 2>&1)"
      miss=""
      for needle in "Organization: personal (DevCrop)" "Installing, updating, or adding Claude Code plugins" "Printing, copying, or sending the contents of real secret files"; do
        printf '%s' "$am" | grep -qF "$needle" || miss="$miss [$needle]"
      done
      [ -z "$miss" ] && pass "claude auto-mode config shows the repo's environment, soft_deny and hard_deny entries" \
        || fail "claude auto-mode config lacks entries from claude/settings.json:$miss (run: bash scripts/apply.sh)"
    fi
    if command -v jq >/dev/null 2>&1; then
      bad=""
      for f in "$dest/settings.json" ./.claude/settings.json ./.claude/settings.local.json; do
        [ -f "$f" ] && jq -e '(.permissions.disableAutoMode != null) or (.disableAutoMode != null)' "$f" >/dev/null 2>&1 && bad="$bad $f"
      done
      [ -z "$bad" ] && pass "no disableAutoMode in live or project settings" || fail "disableAutoMode is set in:$bad"
    fi
  else
    skip "auto mode live checks (claude CLI not on PATH)"
  fi

  # 11. Ponytail plugin
  if command -v claude >/dev/null 2>&1; then
    pl="$(claude plugin list 2>&1)"
    # The ponytail entry only: from its line up to the next plugin id, so a neighbour's status is not read.
    block="$(printf '%s\n' "$pl" | awk '/ponytail@ponytail/ {f=1; print; next} f && /[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+/ {exit} f {print}' | head -n 8)"
    if [ -z "$block" ]; then
      fail "plugin ponytail@ponytail is not installed (open one session so the pinned marketplace registers, then claude plugin install ponytail@ponytail)"
    elif printf '%s' "$block" | grep -qi 'disabled'; then
      fail "plugin ponytail@ponytail is installed but disabled"
      printf '%s\n' "$block" | sed 's/^/        /'
    elif printf '%s' "$block" | grep -qi 'enabled'; then
      pass "plugin ponytail@ponytail is installed and enabled"
    else
      warn "plugin ponytail@ponytail is listed but its status is unclear:"
      printf '%s\n' "$block" | sed 's/^/        /'
    fi
    if printf '%s\n' "$pl" | grep -q 'superpowers@'; then
      warn "plugin superpowers is installed on this machine (not adopted): claude plugin uninstall superpowers@claude-plugins-official"
    else
      pass "Superpowers is not installed"
    fi
  else
    skip "plugin check (claude CLI not on PATH)"
  fi
  # The app keeps its own copy of the task body; apply.sh cannot sync it.
  task="$dest/scheduled-tasks/daily-claude-update/SKILL.md"
  # The file outlives a deleted task, so a PASS here proves the body, not that the task is scheduled.
  if [ -f "$task" ]; then
    if grep -Eq '(^|[^A-Za-z])[A-Za-z]:[\\/]|/(Users|home)/|~/' "$task"; then
      warn "scheduled task body names an absolute path, which goes stale when the clone moves (re-paste claude/scheduled-tasks/daily-claude-update/SKILL.md and set the task's folder instead)"
    elif grep -q 'claude/routines/daily-update.md' "$task"; then
      pass "scheduled task file points at claude/routines/daily-update.md (the app's task list shows whether it is scheduled)"
    else
      warn "scheduled task body is not the pointer body (re-paste claude/scheduled-tasks/daily-claude-update/SKILL.md in the app)"
    fi
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
