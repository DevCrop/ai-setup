# 공유 가능한 보고 UI 템플릿

노션처럼 담백한 사이드바·차트·배지·근거 카드 UI와 Pretendard 폰트를 제공한다.
현재 호스트의 실제 집계·개인 개선 기록·스크린샷은 포함하지 않는다.
이 파일들은 설치 manifest 대상이 아니며 `setup.py`가 각 PC의 보고서를 생성하거나
예약 작업을 추가하지 않는다. 호스트가 별도로 승인한 보고 경로·기존 루틴에서 사용한다.

| 파일 | 데이터 자리 | 목적 |
|---|---|---|
| `rtk-efficiency.template.html` | `__RTK_REPORT_DATA__` 한 개 | 일별 추정치·출력 바이트·압축 경로·명령 예시·검증 한계 |
| `adaptive-routine.template.html` | `__ROUTINE_REPORT_DATA__` 한 개 | 선호/교훈·검토 상태·시점·브라우저/앱·오류·현재 흐름 |
| `assets/PretendardVariable.woff2` | 데이터 없음 | 오프라인 폰트 |
| `assets/Pretendard-LICENSE.txt` | 데이터 없음 | 원본 SIL Open Font License와 저작권 |

두 보고서를 같은 폴더의 `rtk-efficiency.html`, `adaptive-routine.html`로 저장하면
상호 링크가 연결된다. `assets`도 같은 상대 위치에 둔다. 로컬 파일 열기를 지원하지 않는
검증 도구의 정책을 우회하지 말고 실제 화면 검증은 미확인으로 구분한다.

개선 루틴 FLOW는 활성 작업과 등록된 정기 점검의 두 진입점, 여덟 단계와
변경 없음/승인 밖·충돌/실패·복구/완료·게시 구분을 설명한다. 특정 호스트의
08:00이나 성공 기록을 정적 기본값으로 복제하지 않는다. 공유 절차는
[최종 루틴 문서](../../docs/codex-routine-share.md)를 따른다.

## 데이터 계약

RTK 보고 데이터의 top-level 필드는 `collected_at`, `collection_date_kst`,
`rtk_record_date_basis`, `summary`, `daily`, `probe`, `arithmetic_difference`,
`openai_usage_measured`다. 실제 사용량을 측정하지 않았다면 마지막 값은 `false`다.

- `summary`: `total_commands`, `total_input`, `total_output`, `total_saved`,
  `avg_savings_pct`. RTK의 실제 집계 값이며 추정치로 표시한다.
- `daily`: 실제 수집한 `date`, `commands`, `input_tokens`, `output_tokens`,
  `saved_tokens`, `savings_pct`의 배열. 실행하지 못한 날짜는 새 0 행을 만들지 않는다.
- `probe`: `checked_at`, `raw_bytes`, `filtered_bytes`, `raw_exit`, `filtered_exit`,
  `required_evidence_preserved`, `recorded_invocation_delta` 등 해당 검사의 실제 근거.
  이전 성공 근거를 재사용하면 검사 시각은 그대로 둔다.
- 기록이 없으면 `summary`/`probe`는 빈 객체, `daily`는 빈 배열, 수집 시각과 숫자는
  `null` 또는 생략한다. 공유 템플릿은 이를 미수집/미확인으로 표시한다.
  null을 성공·0·완료 배지로 만들지 않는다. 실제 기록 배열에는 정상적인 숫자와 날짜만 넣는다.

개선 루틴 데이터는 `preferences`, `lessons`, `checks`, `sources`,
`timing_policy.rows`의 배열과 독립적인 `last_review_at`, `last_apply_at`,
`last_verify_at`, `reported_at`을 포함한다. 미실행 시각은 `null`이다.
현재 PC의 `host_schedule.label`/`note`를 실제 등록된 일정으로 채우며 없으면 미등록이다.
예시 일정을 다른 PC의 등록 사실로 복사하지 않는다.

선택 필드는 `browser_workflow.routes`, `incident_summary`, `flow_review`,
`publication`이다. 라우트별 상태·실행 검증 시각·범위·제약을 별도로 둔다.
`publication`의 `applied`, `verified`, `committed`, `published`는 해당 단계의
실제 증거가 있어야 `true`다. 도식 논리 검사와 실제 UI 실행은 서로 다른 근거다.
선호의 `id/label/value/scope/status/evidence/target`, 교훈의
`id/label/change/cause/status/evidence/acceptance`는 허용 목록 요약이다.
고객 자료·내부 경로·원문 대화·명령 인자·프로필·비밀을 넣지 않는다.

정본은 각 PC의 비공개 `routine-review.json`이다. 보고서는 요약 투영이며
승인·권한 저장소나 원시 이력 백업이 아니다. 공개 템플릿의 정적인 사용 설명은
실제 스킬 호출이나 압축 검증을 수행했다는 증거가 아니다.

## 안전한 생성과 검증

1. 승인된 현재 호스트 데이터만 수집한다. RTK 집계·바이트·실제 OpenAI 사용량을 구분한다.
2. 같은 날짜 스냅샷을 교체하며 중복 합산하지 않는다. 시간대 미확인은 유지한다.
3. JSON 직렬화 후 `</`를 `<\/`로 바꾸고 해당 데이터 자리를 한 번만 치환한다.
   HTML 소스를 문자열로 임의 구성하거나 원시 로그를 삽입하지 않는다.
4. 데이터 자리 미잔존, 임베디드 JSON 동일성, 고유 ID/내부 앵커, 폰트 상대 경로를 확인한다.
5. 수치·차트·정렬·필터·미수집 상태와 현재 검사/과거 근거 분리를 영향 범위에서 확인한다.
6. 실제 화면을 확인할 수 없다면 데이터·스크립트 검사와 화면 검증을 구분해 기록한다.

표시 시간대는 이 템플릿의 KST 기준이다. 다른 시간대를 원하면 별도로 검토해 변경한다.
각 호스트에 수집 코드·새 이벤트 감시기·권한을 자동 설치하지 않는다.
사용 방법은 [인수인계](../../docs/setup-handoff-20261008.md)를 함께 읽는다.

## 선택적 실시간 보기

명시적으로 승인한 호스트는 [실시간 보기](../../docs/rtk-live-dashboard.md)의
루프백 러너를 별도로 시작할 수 있다. `live.enabled=true`인 루프백 화면만
2초 조회·일시정지·탭 숨김 대기를 사용한다. 파일 HTML은 저장 스냅샷이다.
집계의 수집 시각을 갱신해도 기존 `probe.checked_at`은 보존한다.
실시간 조회는 일일 정본과 파일을 쓰지 않으며 새로운 검증 호출을 만들지 않는다.
연결 오류는 이전 수치를 유지하고 오래된 값임을 표시한다. 자동 시작·예약 작업은
추가하지 않는다. 각 PC의 호스트 승인과 검증된 RTK 러너가 필요하다.
