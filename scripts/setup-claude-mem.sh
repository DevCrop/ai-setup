#!/usr/bin/env bash
# Machine-local claude-mem settings (lives in ~/.claude-mem, outside this repo, so apply.sh does not carry it).
# Sets only two keys: the observer model (cheap, current Haiku) and secret redaction. Idempotent; backs up first.
# Usage: bash scripts/setup-claude-mem.sh [--check]   (--check only reports, changes nothing)
set -u
dir="${CLAUDE_MEM_DIR:-$HOME/.claude-mem}"
f="$dir/settings.json"
model="${CLAUDE_MEM_MODEL_WANTED:-claude-haiku-5-5}"
command -v jq >/dev/null || { echo "FAIL  jq not on PATH"; exit 1; }
[ -f "$f" ] || { echo "FAIL  $f not found. Install the plugin, start one Claude Code session so the worker creates it, then re-run."; exit 1; }
cur_model="$(jq -r '.CLAUDE_MEM_MODEL // ""' "$f")"
cur_redact="$(jq -r '.CLAUDE_MEM_REDACT_ENABLED // ""' "$f")"
echo "observer model : $cur_model (want $model)"
echo "redaction      : $cur_redact (want true)"
if [ "$cur_model" = "$model" ] && [ "$cur_redact" = "true" ]; then echo "OK  already set"; exit 0; fi
[ "${1:-}" = "--check" ] && { echo "DIFF  run without --check to apply"; exit 2; }
cp "$f" "$f.bak-$(date +%Y%m%d-%H%M%S)"
tmp="$(mktemp)"
jq --arg m "$model" '.CLAUDE_MEM_MODEL = $m | .CLAUDE_MEM_REDACT_ENABLED = "true"' "$f" > "$tmp" && mv "$tmp" "$f" || { rm -f "$tmp"; echo "FAIL  could not write $f"; exit 1; }
echo "OK  updated $f (backup next to it). The worker reads it live; if values do not show in 'curl -s http://127.0.0.1:37777/api/settings', restart the worker."
