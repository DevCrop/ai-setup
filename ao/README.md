# AO 코드 프로젝트 셋업

공통 실행 도구는 이 폴더 한 곳에서 관리한다. 프로젝트 규칙은 각 저장소의 AGENTS.md가 소유한다. 새 상주 프로세스, 자동 모델 변경, API 키, 추가 MCP/훅은 설치하지 않는다.

이 폴더는 2026-10-13 비공개 레포 DevCrop/ao-work-history의 `setup/`(커밋 `371fe7f`)에서 옮겼다. 다른 머신은 아래 "다른 PC / 다른 경로"를 따른다.

## 이 머신의 등록부

`projects.json`은 이 머신의 로컬 등록부다(gitignore, 공개 레포에 올리지 않는다). C 또는 D 드라이브에 있는 실제 저장소를 등록하며, 빈 동명 폴더를 실제 코드 저장소로 취급하지 않는다. 다른 PC에는 이 파일을 복사하지 말고 실제 경로를 다시 등록한다.

신규 프로젝트의 역할은 `setup.py`의 `LANES`로 정해진다(`docs/DECISIONS.md` 2026-10-12·13): 작업자는 Claude `claude-haiku-5-5`(권한 auto), 감독은 Claude `claude-opus-5-5`, 리뷰어는 Codex `gpt-6.1-sol`(effort high). AO 0.13.7은 `haiku` 같은 별칭을 거부하므로 전체 모델 ID를 쓴다. Codex 작업자는 `rm`을 승인 없이 실행하고 커밋하지 못한 실측(2026-10-13)이 있어 쓰지 않는다. 이미 등록된 프로젝트의 역할·권한·기존 스크립트는 보존하며, `python -B setup.py apply --lanes`로 명시하면 역할 세 필드만 `LANES`로 바꾼다(다른 설정은 유지); 바꾸기 전 프로젝트별 이전 값과 새 값을 출력한다. 역할 수준 권한이 프로젝트 전체 권한보다 우선하므로 앱에서 정한 프로젝트 전체 권한은 작업자(worker) 세션에서 auto로 덮인다. 같은 도구 경로에서 다시 적용하면 관리하는 규칙과 Cue를 중복 생성하지 않는다. 자동 리뷰는 초기 비활성이다. 리뷰는 `ao review trigger <세션> --effort high`로 걸고, 리뷰어 PC에서 `gh auth login`이 되어 있어야 GitHub에 게시된다(안 되면 `ao review ls --json`의 지적을 `ao send`로 전달).

## 사용 순서

1. AO에서 코드 프로젝트를 고르고 작은 작업을 만든다. 작업별 Git 워크트리가 생기며 Setup은 Git 소속 검증과 Git이 무시하는 `.env` 준비만 한다. Docker와 npm 설치를 자동 실행하지 않는다.
2. 신규 워크트리에서 Node 검사가 필요하면 **의존성 준비 · 수동** Cue를 실행한다. 각 워크트리에 자체 node_modules를 설치한다. 원본의 미커밋 변경은 신규 워크트리에 자동 포함되지 않는다.
3. PHP QA는 현재 워크트리에서 **QA DB 사본 · 최초 1회** → **QA 시작 · 웹+DB** 순서로 실행한다. DB 사본은 중지된 개발 DB 볼륨을 읽기 전용으로 복사하며 원본 DB를 수정하지 않는다. 신규 워크트리는 자체 DB 사본을 가진다. 최초 스키마 생성 방식은 해당 프로젝트의 기존 설치/마이그레이션 절차를 따른다.
4. 변경에 맞는 타입·단위·PHP 검사와 해당 QA 주소의 화면 검사를 실행한다. 주소가 같아도 현재 워크트리가 마운트됐는지 `plan` 결과로 확인한다. 전체 이미지 압축·전체 빌드를 매번 실행하지 않는다.
5. 작업 후 **QA 종료 · 컨테이너 제거**를 실행한다. 이 도구가 만든 해당 워크트리 컨테이너만 중지·제거한다. 이미지와 DB 볼륨은 보존한다. AO의 영구 워크트리 제거 전 Cleanup에도 연결돼 있다. 앱 종료만으로 Cleanup이 실행되지는 않는다.

프로젝트 Cue를 프로젝트 루트에서 실행하면 원본 폴더가 대상이다. 작업 세션에 연결해 실행하면 그 세션의 워크트리가 대상이다. 다른 프로젝트의 QA가 실행 중이면 먼저 해당 프로젝트의 종료 Cue로 정리한다.

## 컨테이너/RAM 정책

- 전역 예산은 현재 Docker 엔진의 전체 실행 컨테이너 2개다. 관련 없는 컨테이너도 계산한다. 수용할 수 없으면 실행을 거절하고, 다른 컨테이너를 자동 종료하지 않는다.
- 이 도구의 동시 실행은 파일 잠금으로 직렬화한다. Docker 자체에는 이 도구가 설정할 수 있는 전역 컨테이너 개수 제한이 없다. 외부 터미널/다른 도구에서 직접 Docker를 실행하면 제한을 우회할 수 있다. AO 작업에서는 QA Cue를 사용한다.
- PHP QA는 웹 384 MiB, DB 512 MiB, 각각 1 CPU 한도. DB 사본은 임시 컨테이너 1개, 128 MiB/0.5 CPU다. Docker VM 자체의 메모리는 별도다.
- phpMyAdmin·Node·geoip 보조 서비스는 QA 스택에서 제외한다. 기존 Compose 파일을 변경하지 않고 메모리에서 웹/DB 설정만 생성해 stdin으로 전달한다. 환경변수/비밀번호를 생성 파일이나 로그에 저장하지 않는다.
- QA 시작은 자동 이미지 다운로드·빌드를 하지 않는다. DB 사본 단계는 `mysql:8.0`을 사용하며 `--pull never`가 없으므로 이 이미지도 사전에 명시적으로 준비한다. 해당 프로젝트와 호환되는 웹/DB 이미지를 사용한다. Dockerfile/런타임 의존성이 바뀌면 프로젝트의 기존 빌드 절차로 이미지를 갱신한다.
- DB 사본과 볼륨은 명시적으로 보존한다. 자동 prune, 볼륨/이미지 일괄 삭제는 하지 않는다.

## 다른 PC / 다른 경로

Python 3.11+, Git, Docker Desktop/Compose(PHP 프로젝트만), 기존 프로젝트 런타임과 로그인된 Codex/Claude CLI가 필요하다. 이 레포를 clone하면 이 도구는 `ao/`에 있다. 현재 머신의 projects.json을 복사하지 않는다. 새 프로젝트의 모델은 `setup.py`의 `LANES`로 고정된다(기존 프로젝트는 `--lanes`일 때만 바뀐다). 예산 잠금과 DB 복사 완료 기록은 사용자 홈의 `.ao/local-qa` 한 곳을 공유하며 AO_DATA_DIR가 다른 작업자도 같은 한도를 적용한다.

```powershell
python -B setup.py register --id my-site --path 'C:\Users\name\Projects\my-site' --image my-site-web:latest --port 18901 --db-source-volume my-site_db_data
python -B setup.py register --id portfolio --path 'D:\project\portfolio' --port 5173
python -B setup.py apply
```

`apply`는 현재 AO running.json의 루프백 포트를 읽고 프로젝트/스크립트/Cue를 저장한 뒤 다시 읽어 확인한다. 전역 AO 설정은 적용하지 않는다. Python 및 이 도구의 실제 위치로 명령을 생성한다. 설치 폴더를 옮겼으면 이 도구가 만든 옛 경로의 Setup/Cleanup을 확인·정리하고 새 위치에서 apply한다. 이전 위치 항목이 자동 제거된다고 가정하지 않는다. Git 저장소에 첫 커밋이 있어야 한다. 기존 ID를 다른 폴더로 조용히 재연결하지 않는다. 경로 이동은 등록부와 AO 프로젝트 경로를 함께 검토해야 한다.

현재 선택된 브랜치를 신규 프로젝트의 기준으로 저장한다. 통합 기준 브랜치가 바뀌면 AO Project Settings의 Default branch도 갱신한다. 고객 운영 DB를 QA 입력으로 등록하지 않는다.

## 직접 검사

```powershell
python -B -m unittest -v test_qa.py
python -B qa.py plan --project my-site --root '<실제 저장소 또는 해당 워크트리>'
python -B qa.py status --project my-site --root '<실제 저장소 또는 해당 워크트리>'
python -B qa.py php-lint routes/web.php --project my-site --root '<실제 저장소 또는 해당 워크트리>'
```

## 근거와 로컬 정책

2026-10-11 확인. AO 설치 버전 0.13.7, Compose 2.34.0. 프로젝트/Cue와 수명주기는 설치 버전의 소스 계약을 기준으로 사용한다. 컨테이너 예산·RAM·수동 설치는 이 사용자의 로컬 정책이며 AO/Docker의 기본 기능이라고 주장하지 않는다.

- https://docs.orchestrator.inc/configuration/projects/ — DB 기반 프로젝트 설정, 역할별 모델/effort, postCreate/preRemove, Cue, CLI 전체 설정 교체 주의.
- https://docs.docker.com/reference/cli/docker/compose/ — -f - stdin, project-directory, 독립 project name, parallel 옵션.
- https://docs.docker.com/reference/cli/docker/compose/up/ — --no-deps, --no-build, --pull never.
- https://learn.chatgpt.com/docs/environments/git-worktrees — 작업별 체크아웃과 Handoff.
- https://learn.chatgpt.com/docs/codex/cli — 사용자 설치 CLI와 로그인. 이 머신의 구버전 npm 중복 설치 제거는 AO의 잘못된 바이너리 선택을 해결하기 위한 로컬 정리다.

과거 확인 결과와 미검증 항목은 비공개 레포 DevCrop/ao-work-history의 `evidence/QA-RESULTS.md`에 있다. 설정 저장 성공은 렌더링이나 전체 사이트 기능 검증을 뜻하지 않는다.

## 이 머신의 AO 실행 파일 수정

AO 0.13.7에 Codex 진단용 바이너리 선택과 Windows Setup/Cleanup의 따옴표 경로 처리 수정을 적용했다. 원본과 수정 전 실행 파일은 사용자 홈 `.ao/backups`에 보존했다. AO 자동 업데이트는 이 로컬 수정을 덮어쓸 수 있으므로 업데이트 후 `ao doctor`와 작은 작업의 Setup을 다시 확인한다. 다른 PC에 이 실행 파일을 그대로 복사하지 말고 해당 설치 버전에서 문제가 재현되는지 먼저 확인한다.

현재 사용자 PATH에 설치된 AO의 `resources/daemon` 폴더를 추가했다. 이미 열린 앱/터미널은 이전 환경을 유지할 수 있다. AO 작업자 자체는 설치된 실행 파일 경로를 세션 PATH에 넣는다. 다른 PC에서는 그 PC의 설치 경로와 `ao doctor` 결과를 확인하며 이 머신의 C 경로를 복사하지 않는다.

큰 저장소는 워크트리 생성 자체가 무거울 수 있다. 한 대형 PHP 저장소의 전체 체크아웃 시험은 약 1.7 GiB까지 Git 메모리를 사용했다. 런타임 QA는 한 프로젝트씩 수행하고, 통합 담당 1개와 분리된 구현 작업 1개부터 시작한다. 이 도구가 Git 체크아웃의 메모리까지 제한하는 것은 아니다.
