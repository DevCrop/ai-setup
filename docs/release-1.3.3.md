# TRACE v1.3.3 — 서브에이전트 기본 모델과 Luna 탐색 에이전트

사용자 선택(2026-10-12, [Decision 004](decisions/004-subagent-models.md))으로
생성되는 서브에이전트의 기본 모델을 정한다. 부모 모델은 계속 사용자가 고른다.

- `config.toml` `[agents]`에 `default_subagent_model = "gpt-6.1-sol"`,
  `default_subagent_reasoning_effort = "medium"`을 관리 키로 추가한다. 이 두 키에 사용자
  값이 있으면 덮어쓰고 원래 값을 기록한다(rollback·uninstall이 되돌림). 다른 키는 보존한다.
- `agents/explorer.toml`: 읽기 전용(`sandbox_mode = "read-only"`) `explorer`
  커스텀 에이전트, `gpt-6-luna` / `high`. 같은 이름의 기본 explorer를 대체한다.
  사용자 소유 `agents/explorer.toml`이 이미 있으면 plan이 conflict로 멈추므로, 내용을
  확인해 옮기거나 지운 뒤 다시 plan한다.
- 근거: [Models](https://learn.chatgpt.com/docs/models),
  [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents),
  2026-10-12 확인. 측정한 순위가 아니다.

검증 결과(Windows, 격리된 임시 홈, 실제 `~/.codex/config.toml` 복사본):

- `python -B -m unittest discover -s scripts -p "test_*.py"`: 91개, `OK (skipped=4)`.
- `python -B scripts/validate_repo.py`: pass.
- 빈 상태에서 v1.3.3 plan/apply/verify/rollback: verify pass, rollback 뒤
  `config.toml` SHA-256 동일, `agents/` 제거됨.
- v1.3.2 적용 상태에서 v1.3.3 plan: 변경 4개(`agents/explorer.toml`, `config.toml`,
  두 가이드). apply·verify pass, rollback 뒤 `config.toml` 해시가 v1.3.2 상태와
  같고 v1.3.2 verify pass.

실제 Codex 세션에서 자식 스레드가 이 모델·effort로 실행되는지는 아직 확인하지 않았다.
