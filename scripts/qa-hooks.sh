#!/usr/bin/env bash
# Unit-test claude/hooks/secret-guard.sh with no model calls: feed it PreToolUse JSON in a throwaway git repo.
# Usage: bash scripts/qa-hooks.sh [hook-path]   (a mutated copy can be passed to prove the checks discriminate)
set -u
repo="$(cd "$(dirname "$0")/.." && pwd)"
hook="${1:-$repo/claude/hooks/secret-guard.sh}"
t="$(mktemp -d)"; trap 'rm -rf "$t"' EXIT
export TMPDIR="$t"
r="$t/r"; mkdir "$r"; cd "$r" || exit 1
git init -q . && git config user.email a@b.c && git config user.name t
echo x > ok.txt; git add ok.txt; git commit -qm init
mkdir sub; echo s > sub/.env.local; echo s > .ENV.PROD; echo s > id_rsa.pub; echo s > .env.production.example; echo s > .credentials.json; echo s > .env.production; echo s > k.pem; echo s > .env.example; echo y > b.txt
echo s > id_ed25519; echo s > server.key; echo s > credentials.json; echo s > .npmrc; echo s > .netrc; echo s > p.diff; echo s > p.mbox
mkdir "$t/sp"; (cd "$t/sp" && git init -q . && git config user.email a@b.c && git config user.name t && mkdir "a b" && echo s > "a b/.env" && echo y > ok.txt)
mkdir other; (cd other && git init -q . && git config user.email a@b.c && git config user.name t && echo s > .env && echo y > ok2.txt)
fail=0
run() { # expect cmd
  out="$(jq -n --arg c "$2" --arg d "${CWD:-$r}" '{tool_name:"Bash",cwd:$d,tool_input:{command:$c}}' | bash "$hook" 2>&1)"; rc=$?
  if [ "$rc" = "$1" ]; then echo "PASS rc=$rc  $2"; else echo "FAIL want=$1 got=$rc  $2  [$out]"; fail=$((fail+1)); fi
}
# block (exit 2)
run 2 'git add -A'
run 2 'git add .'
run 2 'git add -f .credentials.json'
run 2 'git add -u .env.production'
run 2 'git add .env.production'
run 2 'git add k.pem'
run 2 'rtk git add -A'
run 2 "git -C $r add -A"
run 2 'GIT_AUTHOR_NAME=x git add -A'
run 2 'echo hi && git add -A'
run 2 "git -C $r/other add ."
run 2 'git add ".env.production"'
run 2 "git add 'k.pem'"
run 2 'git add sub'
run 2 'git add sub/'
run 2 'git add ./'
run 2 'git add .ENV.PROD'
run 2 'git add -vA'
run 2 'git add -fA'
run 2 'git --no-pager add -A'
run 2 'git stage -A'
run 2 '/usr/bin/git add -A'
run 2 '(git add -A)'
run 2 'bash -c "git add -A"'
run 2 'git add $(echo .env)'
run 2 'git add *.pem'
run 2 'git add :/'
run 2 '\git add -A'
run 2 "g''it add -A"
run 2 $'git add \\\n-A'
# secret names the first version missed
run 2 'git add id_ed25519'
run 2 'git add server.key'
run 2 'git add credentials.json'
run 2 'git add .npmrc'
run 2 'git add .netrc'
# a directory name with a space: git quotes it in non-NUL output, so the listing must be read with -z
CWD="$t/sp" run 2 'git add -A'
CWD="$t/sp" run 2 'git add .'
CWD="$t/sp" run 0 'git add ok.txt'
# obfuscation and indirection
run 2 $'g\\it add -A'
run 2 'printf .env | xargs git add'
run 2 'find . -name .env -exec git add {} \;'
run 2 'rtk git add .env.production'
# verbs that stage without "add"
run 2 'git update-index --add .env.production'
run 2 'git update-index --add --stdin'
run 2 'git mv k.pem moved.txt'
run 2 'git apply --index p.diff'
run 2 'git am p.mbox'
run 0 'git mv ok.txt ok-renamed.txt'
run 0 'git apply p.diff'
run 0 'git update-index --refresh'
# CR from Windows jq: a fake jq in front of PATH appends CR to every output line; multi-line commands must still be judged.
# Known gap: this case also passes with the CR strip removed (a reviewer proved the strip is needed with a separate fake jq), so it is a smoke test, not a proof.
mkdir -p "$t/bin"; real="$(command -v jq)"
printf '%s\n' '#!/bin/bash' "\"$real\" \"\$@\" | awk '{printf \"%s\\r\\n\", \$0}'" > "$t/bin/jq"; chmod +x "$t/bin/jq"
PATH="$t/bin:$PATH" run 2 "$(printf 'git add -A\ngit commit -m x')"
PATH="$t/bin:$PATH" run 0 'git status'

run 2 "$(printf 'git add -A
git commit -m x')"
run 2 "$(printf 'echo start
git add k.pem
echo done')"
mkdir "$t/clean"; (cd "$t/clean" && git init -q . && echo y > c.txt)
CWD="$t/clean" run 2 "cd $r && git add -A"
CWD="$t/clean" run 0 'git add -A'
TMPDIR=/nonexistent run 2 'git add -A'
# allow (exit 0)
run 0 'git commit -m "docs: never git add .env"'
run 0 'git add id_rsa.pub'
run 0 'git add .env.production.example'
run 0 'git add ok.txt'
run 0 'git add .env.example'
run 0 'git status'
run 0 'git log --oneline'
run 0 'ls -la'
run 0 'git branch'
run 0 'git diff'
run 0 'git add b.txt'
# commit/push with a tracked secret
git add -f .credentials.json 2>/dev/null
run 2 'git commit -m x'
run 2 'git push origin main'
# with an upstream, a tracked-but-already-pushed secret does not block unrelated pushes
git init -q --bare "$t/o.git" 2>/dev/null; git remote add origin "$t/o.git" 2>/dev/null; git branch -M main; git rm -q --cached .credentials.json; git commit -qm rm2; git add -f .credentials.json; git commit -qm addsecret; git push -q -u origin main 2>/dev/null; echo z > z.txt; git add z.txt; git commit -qm z
run 0 'git push'
git add -f k.pem; git commit -qm pem
run 2 'git push'
git reset -q --hard HEAD~1 2>/dev/null
echo w >> z.txt; git add -f .credentials.json 2>/dev/null; git commit -qam w2 2>/dev/null

git rm -q --cached .credentials.json
git add -f .env.production 2>/dev/null; git commit -qm env; echo changed >> .env.production
run 2 'git commit .env.production'
run 2 'git commit -m x .env.production'
run 2 'git commit -m "never add .env"'
git rm -q --cached .env.production; git commit -qm rm
run 0 'git commit -m x'
# Fail-closed: when the hook cannot judge a command that could stage files, it blocks; other commands still pass.
nojq="$t/nojq"; mkdir "$nojq"
for tool in bash cat tr sed grep basename git; do ln -s "$(command -v $tool)" "$nojq/$tool"; done
realbash="$(command -v bash)"
nojq_run() { # expect cmd
  json="$(jq -n --arg c "$2" --arg d "$r" '{tool_name:"Bash",cwd:$d,tool_input:{command:$c}}')"
  out="$(printf '%s' "$json" | PATH="$nojq" "$realbash" "$hook" 2>&1)"; rc=$?
  if [ "$rc" = "$1" ]; then echo "PASS rc=$rc  (no jq) $2"; else echo "FAIL want=$1 got=$rc  (no jq) $2  [$out]"; fail=$((fail+1)); fi
}
nojq_run 2 'git add .env'
nojq_run 2 "git commit -m x"
nojq_run 0 'git status'
nojq_run 0 'ls -la'
nogit="$t/nogit"; mkdir "$nogit"
for tool in bash cat tr sed grep basename jq; do ln -s "$(command -v $tool)" "$nogit/$tool"; done
nogit_run() { # expect cmd
  json="$(jq -n --arg c "$2" --arg d "$r" '{tool_name:"Bash",cwd:$d,tool_input:{command:$c}}')"
  out="$(printf '%s' "$json" | PATH="$nogit" "$realbash" "$hook" 2>&1)"; rc=$?
  if [ "$rc" = "$1" ]; then echo "PASS rc=$rc  (no git) $2"; else echo "FAIL want=$1 got=$rc  (no git) $2  [$out]"; fail=$((fail+1)); fi
}
nogit_run 2 'git add .env'
nogit_run 0 'git status'
nogit_run 0 'ls -la'
raw_run() { # expect raw-stdin
  out="$(printf '%s' "$2" | bash "$hook" 2>&1)"; rc=$?
  if [ "$rc" = "$1" ]; then echo "PASS rc=$rc  (raw) $2"; else echo "FAIL want=$1 got=$rc  (raw) $2  [$out]"; fail=$((fail+1)); fi
}
raw_run 2 'git add -A'
raw_run 0 'not json, just ls'
raw_run 0 '{"tool_name":"Read","tool_input":{"file_path":"/x/git/notes.txt"}}'
echo "failures: $fail"; [ "$fail" = 0 ]
