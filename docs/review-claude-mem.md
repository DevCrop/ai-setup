# Review: Claude-Mem 소개글 (X, 2026-09-13)

검토일 2026-10-11 (설치 결과 추가 같은 날). 출처: [GitHub 저장소](https://github.com/thedotmack/claude-mem), README(main), GitHub API. 이 문서는 소개글의 주장 검증과 이 설정(claude-global)과의 적합성만 다룬다. 

## 1. 주장 검증

| 주장 | 결과 | 근거 |
|---|---|---|
| 스타 93.7k | 사실 (현재 99.3k) | API `stargazers_count` 99315 |
| 설치 `npx claude-mem install` | 사실 | README. 단 `npm install -g`는 SDK만 설치하고 훅/워커는 등록 안 함 |
| 작업 기록을 요약·저장해 다음 세션에 재사용, 검색 후 필요한 것만 상세 조회 | 부분 확인 | README: 관찰 자동 캡처, 요약, `search` 도구(타입/날짜/프로젝트 필터). 절감 효과 수치는 제시 안 됨 |
| "Claude Mem → Grok Mem 으로 개명, README 맨 위에 적혀 있음" | **확인 안 됨** | README 상단과 전문 grep에 "Grok Mem" 문구 없음. 제목은 여전히 Claude-Mem. 존재하는 건 `--ide grok-bot` 설치 대상(Grok Bot용 추가 지원) |
| Claude Code 지원은 유지 | 사실 | README에서 Claude Code가 주 대상 |
| 프로젝트별 분리, 전체 삭제·수정 가능 | **README에서 확인 안 됨** | 검색 필터에 project가 있고 웹 뷰어가 있으나, 삭제/수정 절차는 README에 없음. docs.claude-mem.ai 확인 필요 |
| 토큰이 "확 줄어든다" | **미검증** | 저자 체감. 아래 3번 참고 |

판단: 사실 확인된 부분(스타, 설치, 기능 개요)은 맞고, 개명 주장은 현재 출처로는 틀리거나 오해로 보인다(Grok Bot 지원 추가를 개명으로 읽었을 가능성 — 추정).

## 2. 소개글이 말하지 않은 것

- 로그인 필요: 설치 후 브라우저 이메일 로그인으로 메모리 키를 발급받고, 30일 무료체험 후 Anthropic 플랜으로 자동 전환(README). "무료 플러그인" 인상과 다르다.
- 관찰자(observer)가 LLM을 호출해 요약을 만든다. 제공자는 claude-mem 호스팅 / OpenRouter·Gemini 키 / 내 Anthropic 플랜 중 선택. 플랜 사용 시 요약 생성 자체가 토큰을 쓴다 → "토큰 절약"은 순효과이며 저자 수치가 없다.
- Cloud Sync가 cmem.ai로 기억을 백업한다(옵션 여부는 docs 확인 필요). 전송 데이터 범위는 README에 명시 없음.
- 상시 구성요소: 훅 5종, Bun 기반 로컬 워커(HTTP + 웹 뷰어), SQLite, Chroma.
- 라이선스: GitHub API와 LICENSE 파일은 Apache-2.0. 일부 제3자 목록은 AGPL-3.0로 표기(불일치, 저장소 기준 Apache-2.0).

## 3. 이 설정과의 충돌·위험

1. PostToolUse가 모든 도구 출력을 캡처한다. 이 설정은 `.env*`/`.credentials*` 읽기를 금지하지만, 그 외 출력에 섞인 비밀값이 저장·(클라우드 사용 시) 전송될 수 있다. `<private>` 태그는 사용자가 직접 감싸야 한다.
2. RTK가 PreToolUse에서 명령을 `rtk ...`로 재작성하므로(CLAUDE.md 규칙), 캡처되는 출력은 압축된 결과다. 훅 간 상호작용은 미검증.
3. 이 저장소의 원칙은 "설정 소스는 `claude/`, `~/.claude` 직접 수정 금지, apply.sh로 반영". 플러그인은 `settings.json`의 `enabledPlugins`와 외부 홈 디렉터리(`~/.claude-mem`)를 건드리므로 소스 관리 범위 밖 상태가 생긴다.
4. 기존 자체 메모리(auto memory, CLAUDE.md, handoff 노트 규칙)와 역할이 겹친다. 중복 주입은 오히려 컨텍스트를 늘릴 수 있다.

## 4. 권고

- 지금 바로 `claude/settings.json`에 추가하지 않는다. 근거: 효과 수치 없음, 로그인·클라우드·LLM 호출 비용 불명, 비밀값 캡처 위험.
- 시험하려면: 별도 머신/프로젝트에서 provider를 로컬 또는 본인 키로 지정하고 `CLAUDE_MEM_ONLINE_OPTIN=false`(README 명시)로 로그인과 클라우드를 끈 뒤, 같은 작업을 2회 반복해 토큰 사용량을 비교한다.
- 채택 전 확인할 것: (a) docs.claude-mem.ai의 삭제/수정/프로젝트 분리, (b) Cloud Sync 기본값과 전송 범위, (c) RTK 훅과의 공존, (d) `qa-deny.sh` 통과 여부.

## 검증하지 못한 것

설치·실행 테스트, docs.claude-mem.ai 본문, 토큰 절감 실측, 릴리스 노트(WebFetch에서 Releases 비어 있음).

## 5. 설치 결과 (2026-10-11, Windows 10)

- 공식 마켓(`claude-plugins-official`)에는 없다. 제작자 마켓 `thedotmack`을 추가해야 한다 (제3자 신뢰).
- `npx claude-mem install`: 설치 중 `bun install`이 `spawn EINVAL`로 실패, 의존성 없는 반쪽 설치가 남음. 원인은 미확인 (Windows의 Node spawn 제한으로 추정). `--help`를 줘도 실제 설치가 실행되니 주의.
- `claude plugin marketplace add thedotmack/claude-mem` + `claude plugin install claude-mem@thedotmack`: 성공, 13.35.0, 의존성 설치됨.
- 제거 시 chroma-mcp 프로세스(`--data-dir ~/.claude-mem/chroma`)가 파일을 잡고 있어 먼저 종료해야 `~/.claude-mem` 삭제 가능. PowerShell에서는 `rm -rf`가 아니라 `Remove-Item -Recurse -Force`.
- 재시작 후 워커 정상 (`127.0.0.1:37777`, status ok). 기본 provider는 `claude`이고 Claude Code OAuth 토큰을 자격증명 저장소에서 읽어 사용. Cloud Sync 토큰은 비어 있음(미로그인). 첫 요약 생성 성공, `mem_search`로 조회됨.
- 이 저장소 반영: `claude/settings.json`에 마켓과 `enabledPlugins`를 추가함. 이 브랜치를 머지하고 apply.sh를 실행해야 유지된다. 그 전에 apply.sh가 돌면 항목이 제거되어 플러그인이 `disabled`가 됨 (실제로 발생).

## 6. 아직 남은 검증

토큰 사용량 비교(미측정), RTK 훅과의 공존, `qa-deny.sh` 통과, Cloud Sync 전송 범위, 삭제·프로젝트 분리 절차, 저장된 관찰에 비밀값이 섞이는지 점검.
