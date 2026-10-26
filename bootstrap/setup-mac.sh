#!/usr/bin/env bash
# macOS counterpart of bootstrap/setup.ps1: installs the tools, clones or updates this repo, applies claude/ to ~/.claude
# and installs the two plugins. Installs and connects only; it deletes nothing itself (apply.sh still removes files an
# earlier apply copied and the repo no longer has). Runs on the bash 3.2 that ships with macOS.
# Usage (new Mac, Terminal):
#   curl -fsSL https://raw.githubusercontent.com/DevCrop/ai-setup/main/bootstrap/setup-mac.sh -o /tmp/ai-setup-mac.sh && bash /tmp/ai-setup-mac.sh
# Options: --dry-run prints each step as "[dry-run] ..." and changes nothing. AI_SETUP_DIR sets the clone path
# (default ~/project/ai-setup). AI_SETUP_UNAME overrides `uname -s` (tests only).
set -u
dry=0
case "${1:-}" in --dry-run) dry=1 ;; "") ;; *) echo "usage: bash setup-mac.sh [--dry-run]" >&2; exit 2 ;; esac

[ "${AI_SETUP_UNAME:-$(uname -s)}" = Darwin ] || { echo "setup-mac: this is for macOS; on Windows use bootstrap/setup.ps1" >&2; exit 2; }

repo_url="https://github.com/DevCrop/ai-setup.git"
repo="${AI_SETUP_DIR:-$HOME/project/ai-setup}"
summary=""
note() { summary="$summary$(printf '%-22s %-8s %s' "$1" "$2" "$3")
"; echo "[$1] $2 $3"; }
run() { if [ "$dry" = 1 ]; then echo "[dry-run] $*"; else "$@"; fi; }
# A step that went through run() is only planned in a dry run.
if [ "$dry" = 1 ]; then done_=planned; else done_=ok; fi

# ---- Homebrew (its installer also installs the Xcode command line tools, which bring git)
for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do
  command -v brew >/dev/null 2>&1 || { [ -x "$b" ] && eval "$("$b" shellenv)"; }
done
if command -v brew >/dev/null 2>&1; then
  note brew ok "$(brew --version 2>/dev/null | head -n 1)"
elif [ "$dry" = 1 ]; then
  echo '[dry-run] /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
  note brew planned "install Homebrew (asks for your Mac password)"
else
  echo "[brew] installing Homebrew; it asks for your Mac login password"
  if /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"; then
    for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$b" ] && { eval "$("$b" shellenv)"; break; }; done
    # Keep brew on PATH in new terminals (zsh is the macOS default shell).
    if command -v brew >/dev/null 2>&1 && ! grep -qs 'brew shellenv' "$HOME/.zprofile"; then
      echo "eval \"\$($(command -v brew) shellenv)\"" >> "$HOME/.zprofile"
    fi
  fi
  if command -v brew >/dev/null 2>&1; then note brew ok "installed"; else note brew failed "see the installer output above"; fi
fi

# ---- git, jq, node, rtk
for f in git jq node rtk; do
  if command -v "$f" >/dev/null 2>&1; then note "$f" ok "already on PATH"; continue; fi
  if ! command -v brew >/dev/null 2>&1; then
    if [ "$dry" = 1 ]; then echo "[dry-run] brew install $f"; note "$f" planned "brew install $f"; else note "$f" failed "needs Homebrew"; fi
    continue
  fi
  if run brew install "$f"; then note "$f" "$done_" "brew install $f"; else note "$f" failed "brew install $f"; fi
done
# Another crate is also called rtk; the right one has `rtk gain`.
if [ "$dry" = 0 ] && command -v rtk >/dev/null 2>&1 && ! rtk gain >/dev/null 2>&1; then
  note rtk-check failed "rtk on PATH has no 'rtk gain': wrong package, see github.com/rtk-ai/rtk"
fi

# ---- Claude Code (official native installer, puts claude in ~/.local/bin)
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) PATH="$HOME/.local/bin:$PATH" ;; esac
if command -v claude >/dev/null 2>&1; then
  note claude ok "$(claude --version 2>/dev/null | head -n 1)"
elif [ "$dry" = 1 ]; then
  echo "[dry-run] curl -fsSL https://claude.ai/install.sh | bash"; note claude planned "native installer"
elif curl -fsSL https://claude.ai/install.sh | bash && command -v claude >/dev/null 2>&1; then
  note claude ok "installed"
else
  note claude failed "see https://code.claude.com/docs/en/setup"
fi

# ---- repo
if [ -d "$repo/.git" ]; then
  if [ -n "$(git -C "$repo" status --porcelain 2>/dev/null)" ]; then
    note repo ok "$repo has local changes; not pulled"
  elif run git -C "$repo" pull --ff-only; then
    note repo "$done_" "pulled $repo"
  else
    note repo failed "git pull --ff-only in $repo"
  fi
elif [ -e "$repo" ]; then
  note repo failed "$repo exists and is not a git clone; set AI_SETUP_DIR"
elif ! command -v git >/dev/null 2>&1 && [ "$dry" = 0 ]; then
  note repo failed "git is missing"
else
  run mkdir -p "$(dirname "$repo")"
  if run git clone "$repo_url" "$repo"; then note repo "$done_" "cloned to $repo"; else note repo failed "git clone"; fi
fi

# ---- apply claude/ to ~/.claude
if [ -f "$repo/scripts/apply.sh" ] && command -v jq >/dev/null 2>&1; then
  if [ "$dry" = 1 ]; then a=(--dry-run); else a=(); fi
  if bash "$repo/scripts/apply.sh" ${a[@]+"${a[@]}"}; then note apply "$done_" "$HOME/.claude updated"; else note apply failed "bash scripts/apply.sh"; fi
elif [ "$dry" = 1 ]; then
  echo "[dry-run] bash $repo/scripts/apply.sh"; note apply planned "after clone"
else
  note apply skipped "needs the repo and jq"
fi

# ---- plugins (need a logged-in claude; apply.sh has already added their marketplaces to settings.json)
if command -v claude >/dev/null 2>&1 || [ "$dry" = 1 ]; then
  for p in ponytail@ponytail claude-mem@thedotmack; do
    if run claude plugin install "$p"; then note "$p" "$done_" "installed"; else note "$p" failed "log in with 'claude', then re-run this script"; fi
  done
  if [ "$dry" = 1 ]; then
    run bash "$repo/scripts/setup-claude-mem.sh"
  elif [ -f "$repo/scripts/setup-claude-mem.sh" ] && bash "$repo/scripts/setup-claude-mem.sh"; then
    note claude-mem-cfg ok "observer model and redaction set"
  else
    note claude-mem-cfg failed "open and close one Claude Code session, then re-run"
  fi
else
  note plugins skipped "needs claude"
fi

echo
echo "step                   status   note"
printf '%s' "$summary"
echo
echo "By hand: run 'claude' once to log in, then re-run this script if a plugin step failed."
echo "Desktop app: Settings -> Claude Code -> turn on \"Allow bypass permissions mode\"."
case "$summary" in *" failed "*) exit 1 ;; esac
exit 0
