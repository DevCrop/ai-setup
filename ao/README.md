# AO 코드 프로젝트 셋업

AO(Orchestrator.inc) 프로젝트 등록과 설정을 `setup.py`로 적용한다. 프로젝트 규칙은 각 저장소의 AGENTS.md가 소유한다. 이 도구는 새 상주 프로세스, API 키, MCP/훅을 설치하지 않는다.

- 기준 버전: **AO 0.14.2** (고정. 올릴 때는 PR로 버전을 바꾸고 reset을 실행한다). 자동 업데이트에 기대지 않는다.
- Setup(postCreate)과 Cleanup(preRemove), Cue, `[AO local QA]` 규칙은 **Docker QA 프로젝트(compose 파일이 있는 저장소)에만** 생성된다. `package.json`만 있는 프로젝트(예: ai-setup)는 아무것도 생성하지 않는다. 이미 생성된 항목은 `apply`가 소유 항목(이 도구의 `qa.py`/`launch.ps1` 줄과 QA 규칙 블록)만 지우고, 사용자가 쓴 줄은 보존한다.
- 앱에 이미 만들어진 Cue는 `apply`가 지우지 않는다(삭제 API를 확인하지 못함). Project Settings에서 직접 지운다.

## 등록과 역할

`projects.json`은 이 머신의 로컬 등록부다(gitignore). 다른 PC에는 복사하지 말고 실제 경로를 다시 등록한다.

신규 프로젝트의 역할은 `setup.py`의 `LANES`로 정한다(`docs/DECISIONS.md` "Model lanes", "AO reviewer lane").

- 작업자: Claude `claude-haiku-5-5`, 권한 auto
- 감독: Claude `claude-opus-5-5`
- 리뷰어: Codex `gpt-6.1-sol`, effort high (리뷰 패스마다 `ao review trigger --effort high`로 건다)

이미 등록된 프로젝트의 역할은 보존한다. `python -B setup.py apply --lanes`일 때만 `LANES`로 바꾸며, 바꾸기 전 이전 값과 새 값을 출력한다. 자동 리뷰는 초기에 꺼 둔다. GitHub 게시에는 리뷰어 PC의 `gh auth login`이 필요하다.

전체 모델 ID를 쓴다. 0.13.7은 별칭 `haiku`를 `UNSUPPORTED_MODEL`로 거부했다(0.14.2에서는 재확인하지 않음).

## 사용 순서 (Docker QA 프로젝트)

1. AO에서 프로젝트를 고르고 작은 작업을 만든다. 작업별 Git 워크트리가 생기고 Setup은 `.env` 복사(Git이 무시하는 경우만)를 한다. Docker는 자동 실행하지 않는다.
2. 신규 워크트리에서 Node 검사가 필요하면 **의존성 준비 · 수동** Cue를 실행한다. 원본의 미커밋 변경은 자동 포함되지 않는다.
3. PHP QA는 **QA DB 사본 · 최초 1회** → **QA 시작 · 웹+DB** 순서로 실행한다. DB 사본은 중지된 개발 DB 볼륨을 읽기 전용으로 복사하며 원본을 수정하지 않는다.
4. 변경에 맞는 타입·단위·PHP 검사와 QA 주소의 화면 검사를 실행한다. `plan`으로 현재 워크트리가 마운트됐는지 확인한다.
5. 작업 후 **QA 종료 · 컨테이너 제거**를 실행한다. 이 도구가 만든 해당 워크트리 컨테이너만 제거하고 이미지와 DB 볼륨은 보존한다.

프로젝트 루트에서 Cue를 실행하면 원본 폴더가 대상이고, 작업 세션에 연결해 실행하면 그 세션의 워크트리가 대상이다.

## 컨테이너 정책

- 전역 예산은 Docker 엔진의 실행 컨테이너 2개다. 관련 없는 컨테이너도 계산한다. 넘치면 실행을 거절하고 다른 컨테이너를 자동 종료하지 않는다.
- 이 도구의 동시 실행은 파일 잠금으로 직렬화한다. 외부 터미널에서 직접 실행한 Docker는 제한을 우회할 수 있다.
- PHP QA는 웹 384 MiB, DB 512 MiB, 각 1 CPU. DB 사본은 임시 컨테이너 1개(128 MiB, 0.5 CPU)다.
- phpMyAdmin·Node·geoip 보조 서비스는 제외한다. 기존 Compose 파일은 바꾸지 않고 메모리에서 웹/DB 설정만 만들어 stdin으로 넘긴다. 비밀값을 파일이나 로그에 남기지 않는다.
- QA 시작은 이미지를 자동 다운로드·빌드하지 않는다. `mysql:8.0`(DB 사본)은 사전에 준비한다.
- DB 사본과 볼륨은 보존한다. 자동 prune, 볼륨/이미지 일괄 삭제는 하지 않는다.

## 워커 혼합 실행 (문서만, 설정은 바꾸지 않음)

기본 레인은 위와 같다(작업자 Claude, 리뷰어 Codex). 병렬 작업에서 Codex 작업자가 필요하면 **세션마다** 띄운다. 프로젝트 `worker` 설정은 바꾸지 않는다.

```powershell
ao spawn --agent codex --model gpt-6.1-sol --kind worker
```

- 근거: `ao spawn --agent`(같은 뜻의 `--harness`), `--model`, `--kind worker|orchestrator`는 공식 CLI 페이지에 있다. 프로젝트 기본값은 역할마다 harness 하나다(`configuration/projects`).
- 쓰기 작업에는 쓰지 않는다. 이전 실측에서 Codex 작업자는 `rm`을 승인 없이 실행했고 `git commit`이 `index.lock: Permission denied`로 실패했다(`docs/evidence.md` "AO 로컬 QA").
- 원인: `approval_policy = "on-request"`에서 샌드박스가 허용한 명령은 승인 없이 실행된다(공식 Approvals & security). 샌드박스 밖 명령(예: `git commit`)은 rules의 `prompt`로 승인 경로를 만들 수 있다([Rules](https://learn.chatgpt.com/docs/agent-configuration/rules)). 샌드박스 안의 `rm`은 rules로 막을 수 없고, `PreToolUse` 훅의 `permissionDecision: deny`가 공식 수단이다(공식 문서는 강제 경계가 아니라고 함).
- 미검증: AO 워커에서 훅이 실행되는지(AO는 `--dangerously-bypass-hook-trust`를 넘긴다), `prompt` 승인을 AO가 처리하는지, 헤드리스 세션에서 자동 리뷰어가 승인을 검토하는지, `git commit`이 워크트리에서 열리는지, `--model`에 전체 ID가 그대로 통과하는지. 이 다섯 가지를 디스포저블 프로젝트에서 실측하기 전에는 Codex 작업자에 쓰기 작업을 맡기지 않는다.
- 실측 전 권장 순서: 작은 작업 두 개(Claude 작업자 1, Codex 작업자 1)로 워크트리 격리, 권한, 커밋 결과를 확인한다.

## 직접 검사

```powershell
python -B -m unittest -v test_qa.py
python -B setup.py apply --help
python -B qa.py plan --project my-site --root '<실제 저장소 또는 해당 워크트리>'
python -B qa.py status --project my-site --root '<실제 저장소 또는 해당 워크트리>'
python -B qa.py php-lint routes/web.php --project my-site --root '<실제 저장소 또는 해당 워크트리>'
```

## 다른 PC와 경로

Python 3.11+, Git, Docker Desktop/Compose(PHP 프로젝트만), 기존 프로젝트 런타임, 로그인된 Codex/Claude CLI가 필요하다. 설치 위치는 PC마다 다르므로 `ao doctor`로 확인한다.

```powershell
python -B setup.py register --id my-site --path 'C:\Users\name\Projects\my-site' --image my-site-web:latest --port 18901 --db-source-volume my-site_db_data
python -B setup.py register --id my-app --path 'D:\Projects\my-app' --port 5173
python -B setup.py apply
```

`apply`는 실행 중인 AO의 루프백 포트를 읽고, 저장한 뒤 다시 읽어 확인한다. 전역 AO 설정은 건드리지 않는다. 기존 ID를 다른 폴더로 조용히 재연결하지 않는다. 설치 폴더를 옮기면 이 도구가 만든 옛 경로 항목은 `apply`가 소유 줄로 인식해 교체한다.

Git 저장소에 첫 커밋이 있어야 한다. 현재 선택된 브랜치를 신규 프로젝트의 기준으로 저장한다.

## 근거

- https://docs.orchestrator.inc/configuration/projects/ — 역할별 `agentConfig`, postCreate/preRemove, Cue, `set-config`의 전체 교체(effort를 버림). 이 도구는 API `PUT`을 쓴다.
- https://docs.orchestrator.inc/cli/ — `ao spawn`, `ao review trigger --effort`, `ao doctor`.
- https://github.com/OrchestratorInc/agent-orchestrator/releases — v0.14.2 릴리스 본문. 0.14.2 릴리스 본문은 Windows 따옴표나 `defaultBranch` 변경을 언급하지 않는다.
- https://docs.docker.com/reference/cli/docker/compose/ 와 `/up/` — `-f -`, `--no-deps`, `--no-build`, `--pull never`.

0.14.2에서 확인한 것: `defaultBranch`가 프로젝트의 최상위 필드에 있다(라이브 API GET). 미검증: 따옴표 없는 Setup 명령으로 워커 spawn이 성공하는지(실측 전). 0.13.7에서만 측정한 것(별칭 거부, 로컬 패치)은 0.14.2에서 다시 측정하지 않았다.
