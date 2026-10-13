# TRACE v1.3.2 — 개인 스킬 경로와 legacy 프로필 충돌 검사

v1.3.1의 번들 Archify·Ponytail을 `$CODEX_HOME/skills`에서 개인 스킬 루트
(`~/.agents/skills`, 또는 `--personal-skills`)로 옮긴다.
[공식 스킬 문서](https://learn.chatgpt.com/docs/build-skills)를 2026-10-12에
열어 현재 USER 경로와 명시 호출 정책을 확인했다. 문서의 현재 경로와
리뷰어가 인용한 소스의 이전 경로 deprecated 주석은 구분한다.

- 이전 경로 109개 retirement 항목은 소유권 기록이 있고 기록 해시와 같은
  파일만 제거한다. 미소유 파일은 동일한 바이트여도 남기며, 소유 파일의
  사용자 수정은 업그레이드를 차단한다. 기존 fingerprint retirement는 유지한다.
- 두 스킬의 `agents/openai.yaml`과 `allow_implicit_invocation: false`를 유지한다.
- `verify`는 기본 `config.toml`의 `profiles.<name>`과 TRACE 관리
  `<name>.config.toml`이 겹치면 실패와 충돌 이름을 보고한다. 사용자 설정을
  수정하지 않는다. 별도 CLI·inventory 검사인 `doctor`는 이 검사를 공유하지 않는다.
- 번들 원본·CLI·RTK 핀은 그대로이므로 `versions.lock.json` 변경은 없다.

기존 설치에서는 동일한 루트·상태로 `plan`을 검토한 뒤 `apply`, `verify`를
실행한다. 테스트는 USERPROFILE·HOME·LOCALAPPDATA·XDG_STATE_HOME·CODEX_HOME을
새 임시 디렉터리 아래로 설정하고 `--home`, `--personal-skills`, `--state`를
명시한다. 실제 사용자 홈·인증·모델·MCP·권한·일정은 검증 대상으로 쓰지 않는다.

검증 결과(Windows, 격리된 임시 홈):

- `python -B -m unittest discover -s scripts -p "test_*.py" -v`: 91개,
  `OK (skipped=4)`; 링크 생성 권한 제한 3개와 POSIX 특수 파일 검사 1개 제외.
  최초 실행은 CPU 아키텍처 환경 누락으로 도구 테스트 3개가 실패했다.
  Node에서 실제 x64를 확인하고 검증 자식 환경에만 AMD64를 설정한 뒤 통과했다.
- `node scripts/test_rtk_dashboard_client.cjs`: PASS, 종료 코드 0.
- `python -B scripts/validate_repo.py`: pass, 관리 파일 122·참조 55·스킬 3.
- v1.3.1 실제 payload 적용 후 v1.3.2 plan/apply/verify: 모두 종료 코드 0,
  충돌 0·변경 218개·verify pass. 두 스킬의 이전 디렉터리 없음, 새 정책 유지.
- `[profiles.sol]` 재현: verify fail, 종료 코드 1, 충돌 이름 보고, 설정 해시 불변.
- 이전 payload와 retirement SHA-256 109개 대조 및 버전 lock 불변 확인.

실제 Codex 새 세션의 스킬 노출·명시 호출과 profile 로더 실행은 검증하지 않았다.
태그·원격 릴리스·push·PR·merge는 이번 작업에 포함하지 않는다.
