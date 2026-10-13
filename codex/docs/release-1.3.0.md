# TRACE v1.3.0 — 안정 스킬과 통합 루틴

2026-10-12 기준. 이전 ZIP v1.2.4 이후 검토한 작업 흐름, 공유 설치 문서,
개인 Computer Use 지침, 선택형 RTK 실시간 화면과 안정 스킬을 하나의 재현 가능한
배포에 묶는다. TRACE와 두 스킬·RTK는 OpenAI 공식 제품이 아닌 개인/제3자 구성이다.

## 정확한 구성과 선택 이유

| 구성 | 고정 기준 | 이유 |
|---|---|---|
| Codex CLI 검토 기준 | 0.162.1 | 이 호스트의 공식 안정 설치와 공유 검토 기준을 일치시킨다. setup.py가 CLI를 자동 설치하지 않는다. |
| RTK | 0.51.0 | 기존 안정 자산과 해시를 유지한다. 필요한 지원 진단에 사용하고 최종 검증은 원본으로 수행한다. |
| Archify | 3.0.1 / `2ab3cae7ac2c2a55d7386ca789d03c4fcd31816c` | 개발 브랜치 전체 대신 공식 안정 ZIP의 106개 파일만 포함한다. |
| Ponytail | 5.1.0 / `9cc65d03aa2da1db7121b912d03596409ee340b8` | 기존 주 스킬 하나만 갱신한다. 별도 debt 스킬·플러그인·훅은 설치하지 않는다. |

[Archify 릴리스](https://github.com/tt-a1i/archify/releases/tag/v3.0.1)의 ZIP SHA-256:
`b0b23bd28db314f04ca8ab9620fe20f8c1ac6474a3546bd8fe4679508aa1b7f5`.
[Ponytail 릴리스](https://github.com/dietrichgebert/ponytail/releases/tag/v5.1.0)의
고정 커밋 SKILL.md SHA-256:
`ba68ff26239c3c3b05b2a9a47ee0d9a6b93a69639a2555ec87a5d44bffaf2f0c`.
원본 지침은 변경하지 않았으며 각 파일의 해시는 versions.lock.json에 있다.

Archify는 finalize/deliver 영수증에 업데이트 상태를 포함한다. 제한 시간과 출력
상한이 있고 원격 내용으로 설치를 실행하지 않는다. finalize의 내부 deliver에서
중복 확인을 막는다. 캐시는 현재/이전 확인·접근 실패를 구분하며, 알림 유예·무시는
사용자의 명시 요청에만 수행한다. Ponytail은 기존 코드→표준 기능→설치된 의존성→
최소 구현 순으로 선택하되 요청 기능·보안·접근성·오류 처리를 유지한다.

두 스킬 모두 `allow_implicit_invocation: false`를 유지한다.
`$archify`, `$ponytail`로 해당 작업에서 명시 호출한다. Ponytail 원본의 세션 지속
문구보다 글로벌 합의의 요청 작업 한정 규칙을 우선한다. 이는 파일 정책이며 모든
데스크톱 세션의 실제 호출이나 모델 준수를 보장하지 않는다.
[공식 스킬 문서](https://learn.chatgpt.com/docs/build-skills)를 기준으로 정책을 구분했다.

## 설치·업그레이드

[Windows 상세 설치](install-another-windows-pc.md)에 따라 Python 3.11+, Git,
Archify용 Node.js 18+를 준비한다. ZIP은 GitHub v1.3.0 릴리스의
`codex-setup-v1.3.0.zip`을 사용하고 다운로드 SHA-256을 릴리스 자산 digest와 비교한다.
압축을 푼 저장소 루트에서 실행한다.

```text
python -B scripts/setup.py plan
python -B scripts/setup.py apply
python -B scripts/setup.py verify
python -B scripts/setup.py apply
```

충돌이 있으면 중지하고 사용자 수정부터 검토한다. 기존 루트·상태 저장소를 유지한다.
두 번째 apply는 변경 없음이어야 하며 이전 복구점을 교체하지 않아야 한다.
필요한 복구는 `python -B scripts/setup.py rollback`으로 수행한다. 인증·대화 기록을
다른 PC로 복사하지 않고 각 PC에서 공식 로그인한다. GitHub CLI 인증이 필요한
호스트는 `gh auth login --hostname github.com --git-protocol https --web` 및
`gh auth status`를 사용한다. 토큰을 문서나 저장소에 넣지 않는다.

## 루틴 반영과 검증 범위

기존 호스트 자동화만 업데이트하며 각 호스트의 실제 일정·권한·알림 정책을 유지한다.
이 요청 호스트는 매일 08:00 Asia/Seoul이다. 설치만으로 다른 PC에 이 일정이나
모니터링 소유권을 넘기지 않는다. 별도 주간 node_modules 정책도 유지한다.
이번 스킬 교체와 ZIP 게시 승인을 미래의 무제한 자동 스킬 설치·게시 승인으로
확대하지 않는다. 관련 변경과 오류가 없으면 동일한 성공 증거를 재사용한다.

Archify 3.0.1은 격리 출력 폴더의 기존 workflow 예제를 실제 finalize로 실행해
validate/deliver/check/browser-check 네 게이트와 안정 업데이트 확인을 통과했다.
이는 패키지 자체의 브라우저 게이트이며 Codex 브라우저 도구 초기화와는 별개다.
시각적 완성도에 대한 사람의 화면 검수는 수행하지 않았다. Ponytail은 실행 파일이
아닌 지침이므로 해시·배포·명시 호출 정책·전역 적용 범위를 검사하며 모델 성능
벤치마크나 행동 보장으로 표현하지 않는다.

릴리스 검증은 저장소 검사, Python/JavaScript 기존 테스트, 실제 ZIP의 격리 설치·
반복·이전 버전 마이그레이션·제거·복구로 구성한다. 최종 태그 커밋과 공개 ZIP 해시,
실제 검사 결과는 호스트의 private release-verification.json 영수증에 결합한다.
CI 통과·로컬 적용·원격 병합·태그·공개 ZIP 검증은 각각 완료 후에 기록한다.
다른 물리 PC에서의 실제 실행, 모든 프로젝트의 성공, RTK 추정치의 구독 요금 환산은
검증 범위가 아니다. 과거 원인 미확인 오류와 RTK 산술 차이는 별도로 보존한다.

로컬 검사: 기존 Python 83건 중 79건 통과·Windows 환경상 4건 건너뜀,
JavaScript RTK 화면 검사와 저장소 무결성 검사 통과. 실제 글로벌 설치는
충돌 없이 16개 소유 파일을 갱신했고 verify와 반복 apply(변경 없음)를 통과했다.
모델/effort·설정·훅·Codex 인증·주간 정리 파일의 바이트를 보존했다.
