# 인계 노트: codex-setup(TRACE) 확인 요청 2건

작성 2026-10-12, Claude Code(클라우드 세션). 대상 레포 `DevCrop/codex-setup` `c297240`(v1.2.4).

## 이 노트에 대해
- Claude 쪽에서 codex-setup을 읽기 전용으로 점검하다 발견한 2건입니다.
- 근거는 OpenAI Codex 오픈소스(`openai/codex` 커밋 `9f3d255`, 2026-10-11)의 코드와 테스트입니다. 공식 문서 사이트(`developers.openai.com`, `learn.chatgpt.com`)는 이 클라우드 환경에서 막혀 있어(403) 확인하지 못했습니다.
- 그래서 둘 다 **공식 문서로 다시 확인한 뒤** 고칠지 판단해 주세요.
- 수정은 TRACE의 정상 절차를 따릅니다: plan, 버전, 매니페스트 해시, 테스트, 릴리스 태그.
- Claude 쪽은 이 레포에 쓰기 권한이 없고 수정하지 않았습니다. Claude 쪽 대조 문서는 `DevCrop/claude-global`의 `docs/codex-alignment.md`입니다.

## 1. 스킬이 deprecated 경로에 설치됨

**사실**
- `manifest.json`의 `files` 항목은 하나도 `root`를 지정하지 않습니다. 그래서 `scripts/setup.py:154`의 `entry.get('root', 'codex')`에 의해 모두 Codex 홈에 설치됩니다.
  - `personal_skills`는 `retired` 항목에만 있습니다(`manifest.json:587, 593, 609, 615`).
  - 결과적으로 ponytail과 archify 스킬(`files` 117개 중 `skills/` 아래 107개: archify 105, ponytail 2)이 `$CODEX_HOME/skills/`(기본 `~/.codex/skills/`)에 들어갑니다.
- 2026-10-12에 임시 HOME에서 `setup.py apply`를 실행해 `home/skills/archify`, `home/skills/ponytail`이 생기는 것을 확인했습니다.
- Codex 소스 `codex-rs/ext/skills/src/host_roots.rs:96-97`의 주석은 이렇습니다:
  > Deprecated user skills location (`$CODEX_HOME/skills`), kept for backward compatibility.
- 같은 함수에서 `~/.agents/skills`도 사용자 스킬 루트로 함께 읽습니다(`host_roots.rs:105` `home_dir.join(AGENTS_DIR_NAME).join(SKILLS_DIR_NAME)`, 상수는 `host_roots.rs:24-25`의 `".agents"`, `"skills"`). 이것이 현행 위치라는 것은 추론이며 공식 문서로 확인이 필요합니다.
- README(`README.md:23-24`)는 `~/.agents/skills`를 개인 스킬 루트로 설명하지만, 번들 스킬은 Codex 홈에 설치됩니다.

**영향 (추론)**
- 지금은 하위 호환으로 동작합니다.
- 다만 향후 Codex 버전에서 이 경로를 읽지 않게 되면, 두 스킬이 조용히 사라질 수 있습니다.

**확인 요청**
1. 공식 skills 문서에서 사용자 스킬 위치와 deprecated 여부를 확인해 주세요.
2. 맞다면 스킬 항목의 대상 루트를 `personal_skills`(`~/.agents/skills`)로 옮길지 결정해 주세요.
3. 옮긴다면 다음을 같이 확인해야 합니다.
   - 기존 설치본(`~/.codex/skills/...`)을 소유권 기록 기준으로 정리하는 경로(`retired`)
   - `agents/openai.yaml`의 `allow_implicit_invocation: false`가 새 위치에서도 적용되는지
   - `verify`, `inventory`의 스킬 스캔 결과

**완료 기준**
- 새 위치에서 `setup.py plan`, `apply`, `verify`가 pass합니다.
- 새 세션에서 `$ponytail`과 `$archify`가 명시 호출로만 동작하고, 기존 경로에는 TRACE 소유 파일이 남지 않습니다.

## 2. legacy `[profiles.<name>]` 충돌을 verify가 못 잡음

**사실**
- TRACE는 프로필을 별도 파일로 둡니다: `sol.config.toml`, `astra.config.toml`, `astra-deep.config.toml`. 이건 Codex의 현행 방식(`--profile <name>` + `<name>.config.toml`)입니다.
- Codex 소스 `codex-rs/config/src/loader/tests.rs:798`의 테스트 `profile_v2_rejects_matching_legacy_profile_in_base_user_config`가 이 동작을 고정합니다. 기본 `config.toml`에 같은 이름의 `[profiles.work]` 테이블이 있고 `work.config.toml`이 함께 있으면, `--profile work` 로드가 오류로 거부됩니다.
- `codex-rs/app-server/src/config_manager_service.rs:293`은 `profiles` 테이블을 "legacy config profile tables"라고 부르고, app-server의 config 쓰기에서 `profiles` 키 쓰기를 거부합니다.
- TRACE의 `setup.py verify`는 `config.toml`의 `[agents]` 키만 비교합니다. `[profiles.sol]`처럼 TRACE 프로필과 이름이 같은 legacy 테이블이 있는지는 검사하지 않습니다.

**영향 (추론)**
- 예전 방식으로 `[profiles.sol]`을 써 둔 머신에서는 `codex --profile sol`이 실패합니다. 그런데 `verify`는 pass로 나옵니다.
- 실제 머신에 그런 테이블이 있는지는 모릅니다.

**확인 요청**
1. 공식 config 문서에서 legacy profiles와 profile v2의 관계를 확인해 주세요.
2. `setup.py verify`(또는 `doctor`)에 경고를 추가할지 결정해 주세요. 조건은 `config.toml`에 `profiles.<name>`이 있고, 그 `<name>`이 TRACE가 관리하는 `<name>.config.toml`과 같은 경우입니다.
   - 사용자 소유인 `config.toml`의 내용은 삭제하거나 고치지 않습니다. 보고만 합니다.

**재현 (임시 HOME에서, 실제 `~/.codex` 금지)**
`setup.py`는 `--state`와 별도로 `default_state(personal_skills)`에 잠금 파일을 만들기 때문에(`setup.py:445-446`, `$XDG_STATE_HOME` 또는 `~/.local/state`), `HOME`과 `XDG_STATE_HOME`도 임시 경로로 바꿉니다.
```text
export HOME=<tmp>/home XDG_STATE_HOME=<tmp>/xdg
python3 -B scripts/setup.py apply --home <tmp>/codex --personal-skills <tmp>/skills --state <tmp>/state
# <tmp>/codex/config.toml 에 아래 두 줄 추가
[profiles.sol]
model = "gpt-6.1-sol"
CODEX_HOME=<tmp>/codex codex --profile sol   # 예상: 로드 거부 (위 테스트 기준, 실제 실행은 미확인)
python3 -B scripts/setup.py verify --home <tmp>/codex --personal-skills <tmp>/skills --state <tmp>/state   # 현재: pass
```

**완료 기준**
- 위 재현에서 `verify` 또는 `doctor`가 충돌을 보고합니다.
- 충돌이 없는 설치에서는 결과가 지금과 같습니다.
- `config.toml`의 사용자 내용은 그대로입니다.

## 범위 밖 (하지 말 것)
- 자격증명, `auth.json`, 사용자 모델·MCP·권한 설정 변경
- 실제 `~/.codex`에 대한 apply. 재현과 검증은 임시 경로에서만 합니다.
- Claude 쪽 파일(`~/.claude`, `claude-global`) 수정
