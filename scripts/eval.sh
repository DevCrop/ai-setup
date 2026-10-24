#!/usr/bin/env bash
# Eval suite for the live global setup (~/.claude): five fixed web-agency tasks run with `claude -p`, graded by
# evals/check.mjs (deterministic) and, for a before/after comparison, by a blind pairwise Opus judge.
# Usage:
#   bash scripts/eval.sh run <label> <work-dir> [runs]      run every case <runs> times (default 2) against the live setup
#   bash scripts/eval.sh judge <work-dir> <labelA> <labelB> blind pairwise judge of run 1 per case
#   bash scripts/eval.sh selftest <work-dir>                 grader checks on fixtures, no model calls
# Runs use --permission-mode auto (the classifier guards them), a fresh git fixture per run under <work-dir>, and
# prompts that forbid installs, pushes and network sends. Nothing stops a model from writing elsewhere: run it where
# that is acceptable. Costs tokens: 5 cases x runs, plus 5 judge calls per comparison.
set -u
repo="$(cd "$(dirname "$0")/.." && pwd -W 2>/dev/null || pwd)"
mode="${1:?usage: see header}"; shift
CASES="publish-landing accordion rest-db dashboard-cors bugfix"
RULES="설치(npm/pip 등), git push, 외부 네트워크 전송은 하지 마. 사용자에게 되묻지 말고 바로 진행해."

mk() { # fixture: an agency site with an SCSS tree, a TS class and a small Node server on node:sqlite
  d="$1"; rm -rf "$d"; mkdir -p "$d"/{scss/{abstracts,base,layouts,components},ts/components,server,docs} && cd "$d" || exit 1
  git init -q
  printf '<!doctype html>\n<html lang="ko">\n<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Acme 치과</title><link rel="stylesheet" href="css/main.css"></head>\n<body>\n<header class="header"><a class="header__logo" href="/">Acme 치과</a></header>\n<main id="main"></main>\n<script type="module" src="ts/main.ts"></script>\n</body>\n</html>\n' > index.html
  printf '$color-text: #1a1a1a;\n$color-bg: #ffffff;\n$color-accent: #0b5cad;\n$space-2: 8px;\n$space-4: 16px;\n' > scss/abstracts/_variables.scss
  printf '@use "../abstracts/variables" as *;\n*,*::before,*::after{box-sizing:border-box}\nbody{margin:0;color:$color-text;background:$color-bg}\n' > scss/base/_reset.scss
  printf '@use "../abstracts/variables" as *;\n.header{padding:$space-4}\n' > scss/layouts/_header.scss
  printf '@use "../abstracts/variables" as *;\n.button{padding:$space-2 $space-4;background:$color-accent;color:$color-bg}\n' > scss/components/_button.scss
  printf '@use "abstracts/variables";\n@use "base/reset";\n@use "layouts/header";\n@use "components/button";\n' > scss/main.scss
  printf 'export interface TabsOptions { activeClass?: string }\n\nexport class Tabs {\n  private root: HTMLElement;\n  private options: Required<TabsOptions>;\n\n  constructor(root: HTMLElement, options: TabsOptions = {}) {\n    this.root = root;\n    this.options = { activeClass: "is-active", ...options };\n  }\n\n  init(): void {\n    this.root.addEventListener("click", this.onClick);\n  }\n\n  destroy(): void {\n    this.root.removeEventListener("click", this.onClick);\n  }\n\n  private onClick = (e: Event): void => {\n    const tab = (e.target as HTMLElement).closest<HTMLElement>("[role=tab]");\n    if (tab) tab.classList.add(this.options.activeClass);\n  };\n}\n' > ts/components/Tabs.ts
  printf 'import { Tabs } from "./components/Tabs";\n\ndocument.querySelectorAll<HTMLElement>("[data-tabs]").forEach((el) => new Tabs(el).init());\n' > ts/main.ts
  printf "import { DatabaseSync } from 'node:sqlite';\n\nexport function openDb() {\n  const db = new DatabaseSync(':memory:');\n  db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');\n  db.prepare('INSERT INTO items (name) VALUES (?)').run('스케일링');\n  return db;\n}\n" > server/db.mjs
  printf "import { createServer } from 'node:http';\nimport { openDb } from './db.mjs';\n\nexport function createApp(db = openDb()) {\n  return createServer((req, res) => {\n    if (req.method === 'GET' && req.url === '/api/items') {\n      res.writeHead(200, { 'Content-Type': 'application/json' });\n      return res.end(JSON.stringify(db.prepare('SELECT id, name FROM items').all()));\n    }\n    res.writeHead(404).end();\n  });\n}\n" > server/app.mjs
  printf "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { createApp } from './app.mjs';\n\ntest('GET /api/items lists items', async () => {\n  const app = createApp().listen(0);\n  const { port } = app.address();\n  const res = await fetch(\`http://127.0.0.1:\${port}/api/items\`);\n  assert.equal(res.status, 200);\n  assert.equal((await res.json()).length, 1);\n  app.close();\n});\n" > server/app.test.mjs
  printf "// Cart total in won. lines: [{ price, qty }]\nexport function total(lines) {\n  return lines.reduce((sum, l) => sum + l.price, 0);\n}\n" > server/cart.mjs
  printf '# Design: landing\n- Sections: hero (h1 "편안한 치과 진료", sub copy, CTA button "예약하기"), features (3 cards: 무통 마취, 야간 진료, 주차 가능).\n- Tokens: use the variables in scss/abstracts/_variables.scss only.\n- Layout: one column under 768px, features in 3 columns above.\n' > docs/design-landing.md
  printf '# Design: FAQ accordion\n- 3 questions under the heading "자주 묻는 질문"; one panel open at a time; keyboard operable.\n- Tokens: abstracts variables only.\n' > docs/design-accordion.md
  git -c core.autocrlf=false add -A && git -c core.autocrlf=false -c user.email=e@e -c user.name=e commit -qm init
}

prompt() { case "$1" in
  publish-landing) echo "docs/design-landing.md 대로 index.html의 main에 히어로와 특징 섹션을 퍼블리싱해줘. 스타일은 기존 scss 구조에 맞춰." ;;
  accordion) echo "docs/design-accordion.md 대로 FAQ 아코디언을 index.html에 추가하고 동작은 TS로 만들어줘." ;;
  rest-db) echo "server에 POST /api/orders를 추가해줘. 같은 요청이 두 번 와도 주문은 한 번만 생겨야 해. 테스트도 쓰고 node --test 'server/**/*.test.mjs'로 통과시켜. 끝내기 전에 별도 서브에이전트에게 검토받아." ;;
  dashboard-cors) echo "대시보드 화면(dashboard.html)과 통계 API(GET /api/stats, server/)를 서브에이전트 두 개로 동시에 나눠서 만들어줘. 화면은 http://localhost:5173 에서 API를 호출하니 CORS도 맞추고, 테스트는 node --test 'server/**/*.test.mjs'로 통과시켜." ;;
  bugfix) echo "장바구니 합계(server/cart.mjs)가 수량을 반영하지 않는 버그가 있어. 고쳐줘." ;;
esac; }

case "$mode" in
run)
  label="${1:?label}"; work="${2:?work-dir}"; runs="${3:-2}"
  command -v claude >/dev/null || { echo "needs the claude CLI" >&2; exit 2; }
  out="$work/$label"; mkdir -p "$out/_out"; out="$(cd "$out" && pwd -W 2>/dev/null || pwd)"
  to="$(command -v timeout || true)"
  for r in $(seq 1 "$runs"); do
    for c in $CASES; do
      ( mk "$out/$c-$r" >/dev/null && cd "$out/$c-$r" && ${to:+"$to" 1500} claude -p "$(prompt "$c") $RULES" --permission-mode auto \
          --output-format stream-json --verbose --max-turns 40 --no-session-persistence > "$out/_out/$c-$r.jsonl" 2> "$out/_out/$c-$r.err" ) &
    done
    wait
  done
  total=0; max=0
  for r in $(seq 1 "$runs"); do for c in $CASES; do
    node "$repo/evals/check.mjs" "$c" "$out/$c-$r" "$out/_out/$c-$r.jsonl" | tee "$out/_out/$c-$r.check"
    s="$(sed -n 's/^score \([0-9]*\)\/\([0-9]*\)$/\1 \2/p' "$out/_out/$c-$r.check")"; [ -n "$s" ] || { [ "$c" = bugfix ] && s="0 4" || s="0 6"; }; total=$((total + ${s% *})); max=$((max + ${s#* }))
  done; done
  printf '{"label":"%s","runs":%s,"score":%s,"max":%s}\n' "$label" "$runs" "$total" "$max" | tee "$out/summary.json"
  ;;
judge)
  work="${1:?work-dir}"; a="${2:?labelA}"; b="${3:?labelB}"; wins_a=0; wins_b=0; ties=0; none=0
  diffof() { ( cd "$1" 2>/dev/null || { echo "(no run dir)"; exit 0; }; git add -A -N . 2>/dev/null; git diff HEAD -- . ':!*.jsonl' | head -c 40000 ); }
  for c in $CASES; do
    if [ $((RANDOM % 2)) -eq 0 ]; then x="$a"; y="$b"; else x="$b"; y="$a"; fi
    p="두 결과물(X, Y)은 같은 과제를 다른 설정으로 수행한 git diff다. 어느 쪽인지 추측하지 말고 품질만 비교해라.
과제: $(prompt "$c")
기준: 요구사항 충족, 웹표준·접근성, 기존 구조 준수(SCSS 폴더, TS 클래스 패턴), 보안(파라미터 쿼리, CORS 허용 목록), 테스트, 불필요한 코드 없음.
마지막 줄에 JSON 한 줄만: {\"winner\":\"X|Y|tie\",\"x\":0-10,\"y\":0-10,\"why\":\"한 문장\"}
=== X ===
$(diffof "$work/$x/$c-1")
=== Y ===
$(diffof "$work/$y/$c-1")"
    v="$(printf '%s' "$p" | claude -p --model opus --tools "" --max-turns 1 --no-session-persistence 2>>"$work/judge.err" | grep -o '{[[:space:]]*"winner"[^}]*}' | tail -1)"
    w="$(printf '%s' "$v" | sed -n 's/.*"winner"[[:space:]]*:[[:space:]]*"\([XYtie]*\)".*/\1/p')"
    case "$w" in X) [ "$x" = "$a" ] && wins_a=$((wins_a + 1)) || wins_b=$((wins_b + 1)) ;; Y) [ "$y" = "$a" ] && wins_a=$((wins_a + 1)) || wins_b=$((wins_b + 1)) ;; tie) ties=$((ties + 1)) ;; *) none=$((none + 1)); echo "INFO  $c: judge gave no verdict (see judge.err)" ;; esac
    echo "JUDGE $c: X=$x Y=$y $v"
  done
  printf '{"a":"%s","b":"%s","wins_a":%s,"wins_b":%s,"ties":%s,"none":%s}\n' "$a" "$b" "$wins_a" "$wins_b" "$ties" "$none" | tee "$work/judge-$a-vs-$b.json"
  ;;
selftest)
  work="${1:?work-dir}"; mkdir -p "$work" && work="$(cd "$work" && pwd -W 2>/dev/null || pwd)"; fails=0; : > "$work/empty.jsonl"
  score() { node "$repo/evals/check.mjs" "$1" "$2" "$3" | sed -n 's/^score //p'; }
  for c in $CASES; do  # an untouched fixture must not get full marks
    mk "$work/bare-$c" >/dev/null; s="$(score "$c" "$work/bare-$c" "$work/empty.jsonl")"
    [ "${s%/*}" != "${s#*/}" ] && echo "PASS  bare $c scores $s" || { echo "FAIL  bare $c scores $s"; fails=$((fails + 1)); }
  done
  d="$work/good-bugfix"; mk "$d" >/dev/null  # a correct fix with a regression test must get full marks
  # node:sqlite needs Node 22.13+ and CI runners may be older: drop that test and commit it, so only the fix shows as changed
  git -C "$d" rm -q server/app.test.mjs && git -C "$d" -c user.email=e@e -c user.name=e commit -qm "drop sqlite test"
  printf "export function total(lines) {\n  return lines.reduce((sum, l) => sum + l.price * l.qty, 0);\n}\n" > "$d/server/cart.mjs"
  printf "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { total } from './cart.mjs';\ntest('total multiplies by qty', () => assert.equal(total([{ price: 100, qty: 3 }]), 300));\n" > "$d/server/cart.test.mjs"
  s="$(score bugfix "$d" "$work/empty.jsonl")"; [ "${s%/*}" = "${s#*/}" ] && echo "PASS  good bugfix scores $s" || { echo "FAIL  good bugfix scores $s"; fails=$((fails + 1)); }
  d="$work/good-landing"; mk "$d" >/dev/null
  printf '<!doctype html>\n<html lang="ko"><head><meta charset="utf-8"><title>t</title></head><body><main><section class="hero"><h1>편안한 치과 진료</h1><a class="button" href="#r">예약하기</a></section></main></body></html>\n' > "$d/index.html"
  printf '@use "../abstracts/variables" as *;\n.hero{padding:$space-4;color:$color-text}\n' > "$d/scss/components/_hero.scss"; printf '@use "components/hero";\n' >> "$d/scss/main.scss"
  s="$(score publish-landing "$d" "$work/empty.jsonl")"; [ "${s%/*}" = "${s#*/}" ] && echo "PASS  good landing scores $s" || { echo "FAIL  good landing scores $s"; fails=$((fails + 1)); }
  d="$work/bad-sql"; mk "$d" >/dev/null  # SQL built from a template literal must be caught
  printf "export const q = (id) => db.prepare(\`SELECT * FROM orders WHERE id = \${id}\`);\n" > "$d/server/bad.mjs"
  node "$repo/evals/check.mjs" rest-db "$d" "$work/empty.jsonl" | grep -q '^FAIL  rest-db: no SQL built from strings' && echo "PASS  string-built SQL is caught" || { echo "FAIL  string-built SQL not caught"; fails=$((fails + 1)); }
  printf '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"a","name":"Agent","input":{"subagent_type":"reviewer"}}]}}\n' > "$work/one-agent.jsonl"
  node "$repo/evals/check.mjs" rest-db "$d" "$work/one-agent.jsonl" | grep -q '^PASS  rest-db: a subagent' && echo "PASS  Agent call is counted" || { echo "FAIL  Agent call not counted"; fails=$((fails + 1)); }
  echo "== selftest: $fails FAIL"; [ "$fails" -eq 0 ]
  ;;
*) echo "unknown mode: $mode" >&2; exit 2 ;;
esac
