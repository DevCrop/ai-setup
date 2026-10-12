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
run 2 'git add $(cat list2)'
run 2 'git add $(git ls-files -o)'
run 2 'f=.env; git add $f'
run 2 'git add .aws/credentials'
run 2 'git add .pgpass'
run 2 'git add .htpasswd'
run 2 'git add key.pem.bak'
CWD="$t/clean" run 0 "$(printf 'git add c.txt && git commit -m "$(cat <<'"'"'MSG'"'"'\nmessage\nMSG\n)"')"
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
# an upper-case GIT (case-insensitive file systems run it) and git.exe (Git Bash) are git too, also behind a Windows backslash path
run 2 'GIT add -A'
run 2 'Git add .env.production'
run 2 'git.exe add -A'
run 2 'GIT.EXE add k.pem'
run 2 "/c/Program\ Files/Git/cmd/git.exe add -A"
run 2 '"C:\Program Files\Git\cmd\git.exe" add -A'
run 2 "'C:\Git\cmd\git.exe' add k.pem"
run 2 'C:\\Git\\cmd\\git.exe add -A'
run 0 'GIT status'
run 0 'git.exe add ok.txt'
# pushd moves the directory like cd (options, -- and builtin skipped); a literal secret path is judged even when the directory is not a repo
CWD="$t" run 2 "pushd $r && git add .env.production"
CWD="$t" run 2 "pushd $r >/dev/null; git add -A"
CWD="$t" run 2 'git add .env'
CWD="$t" run 2 'cd "$SOMEWHERE" && git add k.pem'
CWD="$t" run 0 "pushd $t/clean && git add -A"
CWD="$t" run 0 'git add ok.txt'
CWD="$t" run 2 "cd -P $r && git add -A"
CWD="$t" run 2 "builtin cd $r && git add -A"
CWD="$t" run 2 "pushd -- $r && git add -A"
CWD="$t" run 0 "pushd -n $r && git add -A"
# a broad add where the hook cannot ask git (git init in the same command, a directory it cannot follow) is judged from the files on disk
mkdir "$t/nr" "$t/nrclean"; echo s > "$t/nr/.env"; echo y > "$t/nr/a.txt"; echo y > "$t/nrclean/a.txt"; printf '.env\n' > "$t/nrclean/.gitignore"; echo s > "$t/nrclean/.env"
CWD="$t/nr" run 2 'git init && git add -A && git commit -m init'
CWD="$t" run 2 "mkdir -p $t/nr && cd $t/nr && git init && git add ."
CWD="$t/nrclean" run 0 'git init && git add -A'
CWD="$t/nr" TMPDIR=/nonexistent run 2 'git init && git add -A'
CWD="$r" run 2 'cd "$X" && git add -A'
CWD="$r" run 2 "cd $r/missing && git add -A"
CWD="$t/clean" run 0 "cd $r/missing && git add c.txt"
CWD="$t/clean" run 2 'cd "$X" && git add -A'
CWD="$t/clean" run 2 "cd $t/nope && git add -A"
# cd with no argument goes home; cd -, pushd +N/-N, bare pushd and popd move somewhere the hook does not track
HOME="$r" CWD="$t/clean" run 2 'cd && git add -A'
CWD="$t/clean" run 2 'cd - && git add -A'
CWD="$t/clean" run 2 "pushd $r; pushd $t/clean; pushd +1 && git add -A"
CWD="$r" run 2 "pushd $t/clean; popd; git add -A"
CWD="$t/clean" run 2 'cd "$X" && git commit -am x'
# a broad add from a subdirectory stages the whole tree, so a secret at the root counts
mkdir -p "$r/deep/er"
CWD="$r/deep/er" run 2 'git add -A'
CWD="$r" run 2 'cd deep && git add -A'
CWD="$r" run 2 'git -C deep add -u'
CWD="$t/clean" run 0 "cd $r/deep && git add ok-in-deep.txt"
# speed: a broad add over many files stays inside the 30 s hook timeout
mkdir "$t/big"; (cd "$t/big" && for i in $(seq 1 60); do mkdir d$i; for j in $(seq 1 300); do : > d$i/f$j.txt; done; done; echo s > d60/.env)
s0=$(date +%s); CWD="$t/big" run 2 'git init && git add -A'; el=$(( $(date +%s) - s0 ))
lim="${QA_HOOKS_TIME_LIMIT:-20}"  # under the 30 s hook timeout, with room for slow runners (Git Bash starts processes slowly)
if [ "$el" -le "$lim" ]; then echo "PASS 18000 files judged in ${el}s"; else echo "FAIL 18000 files took ${el}s (limit $lim)"; fail=$((fail+1)); fi
# expansion where the option or verb belongs, ANSI-C quoting, --git-dir/--work-tree and GIT_DIR from a directory that is not a repo
run 2 'git${IFS}add${IFS}-A'
run 2 'git$IFS add -A'
run 2 'git -C "$PWD" add -A'
run 2 'git -C"$PWD" add -A'
run 2 "git -C \$(pwd) add -A"
run 2 "\$'\\x67it' add -A"
run 2 "git \$'\\x61dd' -A"
run 2 "\$'\\147\\151\\164' add -A"
CWD="$t" run 2 "git --git-dir=$r/.git --work-tree=$r add -A"
CWD="$t" run 2 "git --git-dir $r/.git --work-tree $r add -A"
CWD="$t" run 2 "GIT_DIR=$r/.git GIT_WORK_TREE=$r git add -A"
run 2 'git --work-tree="$PWD" add -A'
run 2 'git --git-dir="$PWD/.git" add -A'
run 2 'git --git-dir=.git --work-tree="$PWD" add -A'
run 2 'GIT_DIR="$PWD/.git" git add -A'
run 2 'git ${x:-add} -A'
run 0 'git -C "$PWD" status'
run 0 'git -C "$PWD" log --oneline'
CWD="$t" run 0 'git status'
run 0 "echo \$'a\\tb'"
run 0 'git${IFS}status'
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
# The no-jq / no-git cases fake a PATH with links to single tools. Git Bash copies the .exe files without msys-2.0.dll, so grep/sed cannot
# run there and the result says nothing about the hook: skip on MSYS/MINGW (checklist L-1 covers jq-less Windows by hand).
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) echo "SKIP  no-jq / no-git simulation (Git Bash cannot fake a reduced PATH)" ;;
  *)
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
    ;;
esac
raw_run() { # expect raw-stdin
  out="$(printf '%s' "$2" | bash "$hook" 2>&1)"; rc=$?
  if [ "$rc" = "$1" ]; then echo "PASS rc=$rc  (raw) $2"; else echo "FAIL want=$1 got=$rc  (raw) $2  [$out]"; fail=$((fail+1)); fi
}
raw_run 2 'git add -A'
raw_run 0 'not json, just ls'
raw_run 0 '{"tool_name":"Read","tool_input":{"file_path":"/x/git/notes.txt"}}'
# GitHub MCP writes (push_files, create_or_update_file) are judged by the file paths they carry, with or without a plugin prefix
runmcp() { # expect tool_name tool_input_json
  out="$(jq -n --arg t "$2" --argjson i "$3" '{tool_name:$t,cwd:"/",tool_input:$i}' | bash "$hook" 2>&1)"; rc=$?
  if [ "$rc" = "$1" ]; then echo "PASS rc=$rc  $2 $3"; else echo "FAIL want=$1 got=$rc  $2 $3  [$out]"; fail=$((fail+1)); fi
}
runmcp 2 mcp__github__push_files '{"owner":"o","repo":"r","branch":"b","message":"m","files":[{"path":"src/a.js","content":"x"},{"path":"config/.env","content":"S=1"}]}'
runmcp 2 mcp__github__create_or_update_file '{"owner":"o","repo":"r","branch":"b","message":"m","path":"keys/server.KEY","content":"x"}'
runmcp 2 mcp__plugin_engineering_github__push_files '{"files":[{"path":"id_rsa","content":"x"}]}'
runmcp 0 mcp__github__push_files '{"files":[{"path":"src/a.js","content":"x"},{"path":".env.example","content":"S="}]}'
runmcp 0 mcp__github__create_or_update_file '{"path":"README.md","content":"git add .env"}'
runmcp 0 mcp__github__search_code '{"query":".env"}'
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) ;; *)  # without jq a GitHub file write cannot be judged: blocked
  out="$(printf '%s' '{"tool_name":"mcp__github__push_files","tool_input":{"files":[{"path":"a.txt"}]}}' | PATH="$nojq" "$realbash" "$hook" 2>&1)"; rc=$?
  if [ "$rc" = 2 ]; then echo "PASS rc=2  (no jq) mcp push_files"; else echo "FAIL want=2 got=$rc  (no jq) mcp push_files [$out]"; fail=$((fail+1)); fi ;;
esac
echo "failures: $fail"; [ "$fail" = 0 ]
