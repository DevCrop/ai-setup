# 다른 Windows PC에 동일한 글로벌 셋업 적용하기

2026-10-08 기준 `codex/global-setup-handoff-20261008` 브랜치용 상세 안내다.
설정 이유는 [인수인계 문서](setup-handoff-20261008.md), 실행 경계는
[운영 계약](operations.md)을 함께 읽는다. 아래 명령은 단계별로 실행하며
오류가 나면 그 단계에서 멈추고 실제 상태를 확인한다.

**동일하게 전달하는 것**은 작업 규칙·가이드·고정 스킬·RTK 검증 방식·루틴 절차·보고
디자인이다. 계정 로그인, PC 경로, 설치 영수증, 개인 기록, 프로젝트 소스와 자동화
등록은 새 PC에서 별도로 완료한다. 폴더 생성과 소스 설치가 자동화 등록 성공을 뜻하지 않는다.

## 1. 설치할 것과 설치하지 않아도 되는 것

| 항목 | 필요 여부 | 새 PC에서의 선택 |
|---|---|---|
| Git | 필수 | 공식 Git for Windows; 이미 정상 설치됐으면 유지 |
| Python | 필수 | 3.11 이상; 이 저장소의 CI 기준은 3.11/3.14 |
| Codex 데스크톱 앱 | 앱·예약 루틴·UI 사용 시 필요 | 공식 Windows 앱을 설치하고 본인 계정으로 로그인 |
| Codex CLI | CLI 확인·운영에 필요 | 기존 정상 설치는 유지; 아래 npm 방식 또는 공식 standalone 중 한 방식 |
| Node.js/npm | 이 문서의 npm CLI 설치·Archify 사용 시 필요 | 같은 날짜 검증 환경을 재현하려면 Node 22.23.3/npm 10.9.9 |
| RTK | 출력 축약 사용 시 설치 | TRACE의 고정 자산 설치기가 해당 OS/CPU 해시·버전 검증 |
| Chrome/공식 확장 | Chrome 조작을 사용할 때 | 앱의 공식 연결 절차로 설치/연결; 기존 프로필과 권한 보존 |
| 공식 Computer Use 플러그인 | 앱/브라우저 도구를 실제 사용할 때 | 해당 계정·앱에서 지원되는 공식 경로로 활성화 |
| Corepack/tsx/TypeScript | 프로젝트가 요구할 때만 | 프로젝트 버전·README 우선. 글로벌 설치는 기본 요구 사항 아님 |
| OpenAI Python/Node SDK·API 키 | 이 셋업에는 불필요 | ChatGPT 로그인 사용; API 기반 프로젝트는 해당 프로젝트에서 별도 구성 |
| `pip install`/루트 `npm install` | TRACE 설치에는 불필요 | 설치/검증 스크립트는 Python 표준 라이브러리 사용 |

원래 PC의 런타임 확인값은 CLI 0.161.0, RTK 0.51.0, Node 22.23.3,
npm 10.9.9, Corepack 0.36.0, tsx 4.23.15, TypeScript 7.0.2였다.
이는 날짜가 있는 재현 기준이며 앞으로도 최신이라는 뜻은 아니다. 기존 호환 도구를
무조건 다운그레이드하거나 앱 내장 런타임·프로젝트 의존성을 일괄 교체하지 않는다.

## 2. 필수 도구 설치와 실행 확인

기존 설치가 있으면 먼저 다음 명령을 확인한다. 없는 명령은 실패할 수 있으며
아래 설치 절차에서 해당 항목만 설치한다.

```powershell
git --version
python --version
node --version
npm.cmd --version
codex --version
```

### Git가 없다면

[Git 공식 Windows 안내](https://git-scm.com/install/windows)의 설치기를 쓰거나,
WinGet이 제공되는 Windows에서 실행한다.

```powershell
winget install --id Git.Git -e --source winget
```

설치 후 새 PowerShell을 열어 `git --version`을 확인한다. WinGet이 없는 PC에서는
공식 설치기의 x64/ARM64를 실제 CPU에 맞춰 선택한다.

### Python이 없거나 3.11 미만이라면

[Python 공식 Windows 안내](https://docs.python.org/3/using/windows.html)의
Python Install Manager를 설치한다. WinGet을 쓰는 예는 다음과 같다.

```powershell
winget install 9NQ7512CXL7T -e --accept-package-agreements --disable-interactivity
```

새 PowerShell에서 새 설치 관리자가 제공하는 명령인지 확인한 다음 실행한다.
기존 legacy `py`와의 이름 충돌을 피하기 위해 설치 관리자 명령은 `pymanager`로 적었다.

```powershell
pymanager install 3.14
py -3.14 --version
python --version
```

이후 예제는 정상적인 Python 3.11 이상이 `python`으로 실행된다고 가정한다.
`python`이 다른 런타임을 가리키면 이후의 `python`을 `py -3.14`로 일관되게 바꾼다.
Python 실행 경로만 필요하면 `python -c "import sys; print(sys.executable)"`로 확인한다.
정상인 기존 Python을 삭제하거나 다른 프로젝트의 가상환경을 수정할 필요는 없다.

### Node.js/npm이 필요하고 아직 없다면

[Node 22.23.3 공식 배포](https://nodejs.org/en/download/archive/v22.23.3)에서
Windows x64/ARM64 MSI를 선택한다. 해당 설치기는 npm 10.9.9를 포함한다.
설치 전 파일의 SHA-256을 공식 [SHASUMS256](https://nodejs.org/dist/v22.23.3/SHASUMS256.txt)와
비교한다. 내려받은 파일의 실제 위치와 CPU에 맞는 이름을 사용한다.

```powershell
$traceNodeInstaller = Join-Path $env:USERPROFILE 'Downloads\node-v22.23.3-x64.msi'
Get-FileHash -LiteralPath $traceNodeInstaller -Algorithm SHA256
```

이 문서 검토 시 x64 MSI의 공식 SHA-256은
`1c0efc8449987e7da5d184786a0a96da83ffa11d334421201e5c09b93017cb8d`였다.
ARM64나 다른 버전에는 이 값을 사용하지 않는다. 일치하는 설치기를 직접 실행한 후
새 터미널에서 `node --version`, `npm.cmd --version`을 확인한다.
이미 다른 버전/설치 관리자가 있으면 경로·프로젝트 호환성을 먼저 검토한다.

### Codex CLI와 앱

[OpenAI 공식 CLI 안내](https://learn.chatgpt.com/docs/codex/cli)의 설치 방식 중
하나를 선택한다. Node/npm 경로로 이 브랜치의 검토 기준을 재현하는 예는 다음과 같다.
`@openai/codex@0.161.0`의 npm 배포 존재와 integrity 메타데이터를 확인했다.

```powershell
npm.cmd install --global @openai/codex@0.161.0
if ($LASTEXITCODE -ne 0) { throw 'Codex CLI 설치 실패' }
codex --version
```

이미 standalone Codex가 있으면 npm으로 중복 설치하지 않는다. 두 경로가 존재하면
`Get-Command codex -All`로 실제 실행 파일을 구분하고 설치 소유자를 확인한다.
공식 standalone installer를 선택한 경우 현재 공식 스크립트와 무결성 검증을 검토한
후 지원되는 PowerShell에서 실행한다. 과거 legacy PowerShell의 Get-FileHash 실패를
같은 방식으로 반복하거나 전역 실행 정책을 완화하지 않는다.

[OpenAI 공식 Windows 앱 안내](https://learn.chatgpt.com/docs/windows/windows-app)를
따라 데스크톱 앱을 설치한다. CLI 설치가 앱 설치를 대신하지 않는다.
[공식 로그인 절차](https://learn.chatgpt.com/docs/auth)에 따라 각 PC에서 로그인한다.

```powershell
codex login
codex login status
```

기존 PC의 `auth.json`, 비밀, 대화 데이터베이스, 브라우저 프로필을 가져오지 않는다.
앱에서도 같은 의도한 계정/워크스페이스인지 확인한다.
기존 모델·추론 선택은 보존한다. 원래 사용자의 선택은 `gpt-6.1-sol / medium`이다.
새 계정에서 사용할 수 없다면 그 제약을 알리고 자동으로 다른 모델을 선택하지 않는다.

## 3. Projects·ChatGPT 폴더가 없으면 준비하기

**Projects는 폴더이며 TRACE 필수 설정 파일이 아니다.** 프로젝트를 아직 가져오지
않았어도 작업 루트는 만들 수 있다. 실제 프로젝트의 `package.json`이나 lockfile을
가짜로 만들지 않으며 모든 프로젝트에 같은 `AGENTS.md`를 복사하지 않는다.

아래 코드는 사용자 홈의 `Projects`, Windows가 반환하는 문서 위치의 `ChatGPT`,
그 하위 `글로벌 셋업`을 없을 때만 만든다. 문서 폴더는 OneDrive 등으로 이동될 수 있다.
이 변수들은 다음 단계에서도 사용하므로 같은 PowerShell에서 계속 실행한다.

```powershell
$traceProjectsRoot = Join-Path $env:USERPROFILE 'Projects'
$traceDocumentsRoot = [Environment]::GetFolderPath('MyDocuments')
if ([string]::IsNullOrWhiteSpace($traceDocumentsRoot)) {
    throw '문서 폴더 경로를 확인할 수 없습니다. 사용할 실제 경로를 먼저 지정하세요.'
}
$traceChatGptRoot = Join-Path $traceDocumentsRoot 'ChatGPT'
$traceSetupParent = Join-Path $traceChatGptRoot '글로벌 셋업'
$traceCheckout = Join-Path $traceSetupParent 'codex-setup'

foreach ($tracePath in @($traceProjectsRoot, $traceChatGptRoot, $traceSetupParent)) {
    if (Test-Path -LiteralPath $tracePath) {
        if (-not (Test-Path -LiteralPath $tracePath -PathType Container)) {
            throw "폴더 위치에 파일이 있습니다: $tracePath"
        }
    } else {
        [System.IO.Directory]::CreateDirectory($tracePath) | Out-Null
    }
}
```

다른 작업 드라이브를 쓰려면 실행 전에 `$traceProjectsRoot`/`$traceSetupParent`를
실제 선택 경로로 지정한다. 원래 PC의 사용자명·드라이브·절대경로를 복사하지 않는다.
폴더를 만들었다고 자동 프로젝트 등록이나 정리 권한이 생기지 않는다.
링크/junction 경로는 설치기의 안전 검사에서 충돌할 수 있으므로 우회하지 않는다.

## 4. 정확한 브랜치 가져오기

아래 코드는 새 체크아웃 전용이다. `codex-setup`이 이미 있으면 중단하며 삭제하지 않는다.

설치할 커밋의 [최종 공유 루틴](codex-routine-share.md)도 읽는다. 현재 브랜치는
활성 프로젝트 도구 선택·매 지원 진단의 RTK 러너·히스토리 기반 회고 지침을 포함한다.
기존 훅 설정·개인 집계·자동화 권한은 설치로 복제되지 않는다.

```powershell
if (Test-Path -LiteralPath $traceCheckout) {
    throw '체크아웃 경로가 이미 있습니다. 아래의 기존 체크아웃 절차로 확인하세요.'
}
git clone --branch codex/global-setup-handoff-20261008 --single-branch `
    https://github.com/DevCrop/codex-setup.git $traceCheckout
if ($LASTEXITCODE -ne 0) { throw 'Git clone 실패' }
Set-Location -LiteralPath $traceCheckout
git branch --show-current
git rev-parse HEAD
git status --short
```

기존 체크아웃은 경로·원격·브랜치와 작업 변경을 먼저 확인한다. **아래 갱신은 해당
브랜치이고 작업 폴더가 깨끗하며 새 원격 변경을 검토한 경우에만** 실행한다.

```powershell
Set-Location -LiteralPath $traceCheckout
git remote -v
git branch --show-current
git status --short
git fetch origin codex/global-setup-handoff-20261008
if ($LASTEXITCODE -ne 0) { throw 'Git fetch 실패' }
git log --oneline HEAD..FETCH_HEAD
git diff HEAD..FETCH_HEAD -- README.md docs global manifest.json templates versions.lock.json scripts
```

검토한 상태가 맞을 때 `git merge --ff-only FETCH_HEAD`로 갱신한다.
원격 추적 ref가 없는 single-branch 환경에서도 실제 fetch 결과를 사용한다.
로컬 수정·다른 브랜치·분기된 커밋이 있으면 보존하고 먼저 충돌을 해결한다.
`reset --hard`, `clean`, 폴더 삭제로 문제를 숨기지 않는다.
실제로 설치한 커밋은 기록한다. PR #15가 아직 merge되지 않았으면 main이나 v1.2.4만
가져와서는 이 브랜치의 추가 설정이 전달되지 않는다.

## 5. 검사한 다음 글로벌 설정 설치

이 단계는 TRACE 체크아웃에서 실행한다. 명령별 실패 시 다음 단계로 진행하지 않는다.

```powershell
$env:PYTHONIOENCODING = 'utf-8'
python -B -m unittest discover -s scripts -p 'test_*.py' -v
if ($LASTEXITCODE -ne 0) { throw '저장소 테스트 실패' }
python -B scripts/validate_repo.py
if ($LASTEXITCODE -ne 0) { throw '저장소 무결성 검사 실패' }
python -B scripts/setup.py plan
if ($LASTEXITCODE -ne 0) { throw '설치 계획 충돌 또는 실패' }
```

`plan`의 실제 변경 대상과 충돌을 읽고 승인된 내용만 적용한다.

```powershell
python -B scripts/setup.py apply
if ($LASTEXITCODE -ne 0) { throw '글로벌 설정 적용 실패' }
python -B scripts/setup.py verify
if ($LASTEXITCODE -ne 0) { throw '설치 파일 검증 실패' }
python -B scripts/setup.py apply
if ($LASTEXITCODE -ne 0) { throw '재적용 실패' }
python -B scripts/setup.py doctor
```

`verify`는 pass, 두 번째 `apply`는 unchanged여야 한다. 최초의 기존 비관리 규칙을
인수하려면 `plan --adopt-existing`으로 내용을 비교한 뒤 검토한 `apply --adopt-existing`만
사용한다. 이미 관리 중인 파일의 사용자 수정은 이 옵션으로 덮어쓸 수 없다.

| 설치 위치 | 결정 방식 | 생성·보존 동작 |
|---|---|---|
| Codex 홈 | `CODEX_HOME`; 없으면 사용자 홈 `.codex`; `--home` | 설치기가 필요한 관리 파일의 부모 경로 생성; 인증/기존 설정 보존 |
| 개인 UI 스킬 | 사용자 홈 `.agents/skills`; `--personal-skills` | 스킬 폴더 생성; Codex 홈 변경과 독립 |
| Ponytail·Archify | Codex 홈의 `skills` | 해시 고정 원본과 명시 호출 정책을 같은 설치기로 관리 |
| 상태·한 개의 이전 복구점 | 해당 홈에 대응하는 사용자별 비공개 상태; `--state` | 다른 PC의 상태 복사 금지 |

한 컴퓨터에서 여러 홈을 쓰는 경우 설치/검증/복구 모두 같은 세 경로를 사용한다.
옵션 경로 지정은 `setup.py --help`를 확인하며 관련 도구에도 같은 상태 경계를 유지한다.
`.codex`·`.agents`를 통째로 복사하는 방식은 사용하지 않는다.

## 6. RTK 설치와 실제 경로 확인

RTK는 TRACE 파일 설치만으로 설치되지 않는다. 출력 축약을 사용할 새 PC에서 별도 설치한다.
해당 브랜치가 고정한 플랫폼 자산의 SHA-256·버전을 검사하며 임의 PATH/훅을 추가하지 않는다.

```powershell
python -B scripts/tools.py install-rtk
if ($LASTEXITCODE -ne 0) { throw 'RTK 설치 실패' }
python -B scripts/tools.py verify
if ($LASTEXITCODE -ne 0) { throw 'RTK 소유권/해시 검증 실패' }
python -B scripts/tools.py run git status
if ($LASTEXITCODE -ne 0) { throw '읽기 전용 RTK 실행 실패' }
```

처음 설치한 새 환경의 관련 읽기 전용 비교가 필요하면 다음 검사를 수행한다.
임시 fixture와 지정 저장소의 상태/이력을 확인하며 프로젝트 소스를 쓰거나 빌드하지 않는다.

```powershell
python -B scripts/verify_rtk.py --project $traceCheckout
if ($LASTEXITCODE -ne 0) { throw 'RTK 실행 증거 검사 실패' }
python -B scripts/tools.py run gain --daily --format json
```

테스트 호출도 RTK 집계에 포함된다. 같은 도구·범위의 성공 증거를 매일 다시 만들지 않는다.
새 PC의 집계가 없거나 기록이 실패하면 미수집/미확인이다. 원래 PC의 숫자를 복사하지 않는다.
RTK 토큰 추정치·출력 바이트·실제 OpenAI 사용량을 구분한다. 기존 별도 RTK 훅은
확인·보존하며 `rtk init -g`를 설치 완료의 지름길로 사용하지 않는다.

## 7. 프로젝트가 없을 때와 프로젝트 의존성

Projects가 비어 있으면 그대로 둬도 글로벌 규칙과 개인 스킬을 사용할 수 있다.
작업할 실제 저장소가 정해지면 Projects 아래 선택한 폴더에 clone하거나 기존 소스를
가져온다. 글로벌 셋업 저장소를 앱 프로젝트처럼 실행하거나 루트에서 무조건 npm 설치하지 않는다.

실제 프로젝트 루트에서 README·기존 AGENTS·`package.json`의 `engines`와
`packageManager`, lockfile, 환경 파일 예시를 먼저 확인한다.

| 확인한 프로젝트 상태 | 해당 프로젝트에서 실행할 설치 예 | 조건 |
|---|---|---|
| npm 프로젝트와 유효한 `package-lock.json` | `npm.cmd ci` | 지정 Node/npm, 정상 lockfile; 임의로 lockfile 갱신하지 않음 |
| pnpm 프로젝트와 `pnpm-lock.yaml` | `pnpm install --frozen-lockfile` | 명시된 pnpm 버전/워크스페이스 루트 |
| Yarn 2+와 해당 설정/lockfile | `yarn install --immutable` | 프로젝트가 지정한 Yarn 버전 |
| Yarn 1 | `yarn install --frozen-lockfile` | v1인지 확인한 경우만 |
| manifest/lockfile 없음 | 설치 중단·실제 프로젝트 구조 확인 | package.json·lockfile을 셋업용으로 지어내지 않음 |
| Python 프로젝트 | 프로젝트가 지정한 venv/uv/pip 절차 | 해당 lock/의존성·Python 버전 우선; 글로벌 pip 설치하지 않음 |

설치 전 프로젝트별로 package manager가 있는지 확인한다. Corepack 또는 별도 관리자를
쓰는 프로젝트라면 해당 버전의 공식 절차와 프로젝트의 지정 버전을 따른다.
TypeScript는 프로젝트의 로컬 버전을 우선한다. 원래 PC의 글로벌 tsx/TypeScript를
설치한다고 로컬 패키지나 프로젝트 빌드가 재현되는 것은 아니다.

새 프로젝트에서 AGENTS가 없다면 실제 소스·실행법·검사 명령을 확인한 뒤 해당 프로젝트
전용 문서만 작성한다. `.env`는 환경 예시와 서비스 접근 권한에 따라 새 PC에서 준비하며
비밀 값을 저장소나 이 문서에 올리지 않는다. 프로젝트별 실행/검증 명령은 실제 README를
따르고 존재하지 않는 `dev`, `build`, `test` 스크립트를 가정하지 않는다.
[프로젝트 작성 가이드](../templates/project/README.md)를 검토용으로 사용한다.

## 8. 새 세션과 UI 스킬 확인

앱에서 새 세션을 열고 먼저 다음처럼 요청한다.

> 현재 설치된 글로벌 규칙과 이 작업 폴더의 규칙을 확인해줘. 선택한 모델/effort는
> 보존하고 로딩된 근거와 검증하지 못한 범위를 구분해줘.

Projects와 ChatGPT에서 각각 확인한다. 기존 `AGENTS.override.md` 또는 더 가까운 프로젝트
규칙이 있으면 우선순위를 읽고 보존한다. 임의 모델 호출 벤치마크는 필요하지 않다.

UI 도구를 실제 사용하는 경우에만 `$computer-use-workflow`를 명시하고 공식 도구가
제공되는지 확인한다. 내장 브라우저·지정 Chrome·Windows 앱의 작은 승인된 조작을
각각 검증한다. 파일 검사, 스킬 발견, 실제 호출, 화면 성공은 별개다.
계정/클라이언트에서 없는 기능은 미지원으로 남기며 개인 스킬로 권한이 생기지 않는다.
Ponytail·Archify는 필요한 작업에서 `$ponytail`/`$archify`를 명시한다.
Archify의 기본 런타임은 Node이며, 설치된 패키지의 현재 절차를 읽고 실행한다.

## 9. 오전 8시 루틴을 새 PC에 등록하기

저장소는 프롬프트 템플릿과 렌더러를 제공한다. 앱의 자동화는 파일을 복사한다고
등록되지 않는다. 기존 PC의 자동화 ID·스레드·호스트 승인을 새 PC로 이전하지 않는다.

새 PC에서 사용자가 명시 승인한 범위만 그 PC의 비공개 `routine-review.json`에
기록한다. 기존 상태가 없으면 설치기가 사용하는 CODEX_HOME-aware 상태 위치에 하나의
현재 기록을 준비한다. 원래 PC의 ledger를 복사하거나 임의로 승인된 것으로 만들지 않는다.
호환 자동 업데이트 승인 기록의 필수 항목은 다음과 같다.

| 항목 | 실제로 기록할 값 |
|---|---|
| `mode` | 사람에게 승인받은 경우만 `compatible-global-stable-tools` |
| `automation_id` | 이 PC에서 생성/선택한 실제 자동화 ID |
| `host_identity` | 이 PC의 실제 `platform.node()` 결과 |
| `approved_on` | 실제 승인일 |
| `schedule` | 실제 등록·확인한 매일 08:00 Asia/Seoul 일정 |
| `scope` | 호환 작은 지침·안정 CLI/RTK, 보존 대상과 금지 범위 |

계정·폴더·설치가 같아도 이 승인 기록이 없거나 호스트/ID가 다르면 렌더러는
review-only다. 이는 TRACE의 운영 제약이며 플랫폼 보안 권한을 대신하지 않는다.

앱의 Codex에서 아래 요청을 **새 PC의 사용자가 직접** 전달하면 설치/일정/승인 범위가
명확해진다. 기존 루틴이 있으면 업데이트하고 없으면 하나만 등록하도록 했다.

> 이 PC에서 docs/install-another-windows-pc.md를 따라 실제 경로와 의존성을 확인하고
> 동일한 글로벌 셋업을 적용해줘. Projects와 문서의 ChatGPT 폴더는 없을 때만 만들어줘.
> 기존 모델/effort·인증·MCP·권한·훅·프로젝트 소스는 보존해줘. 이 PC에서만 기존 루틴을
> 매일 오전 8시 Asia/Seoul로 업데이트하고, 없으면 이 대화에 하나의 heartbeat를 등록해줘.
> 공식 근거 검토 후 호환되는 작은 글로벌 지침과 안정 Codex CLI/RTK 업데이트를 승인한다.
> 새 실행 로직·플러그인·권한 확대·원격 게시·프로젝트 소스 수정은 자동 확대하지 말아줘.
> 실제 자동화 ID와 이 PC의 호스트·승인일·범위를 현재 비공개 기록에 남기고 기존 렌더러의
> 프롬프트를 검토해 반영해줘. 작업 중 관찰한 오류는 기록·원인·복구·원래 경로 검증까지
> 처리해줘. 새 PC의 집계만 쓰고 변경·새 실패·사용자 조치가 필요할 때만 알려줘.
> 다른 PC의 모니터 소유권과 별도 주간 의존성 정리는 바꾸지 말아줘. 파일·실행·일정·
> 미검증 상태를 각각 보고해줘.

실제 자동화 ID를 확인한 후 공통 프롬프트를 렌더링한다.

```powershell
$traceAutomationId = Read-Host '이 PC의 실제 기존/신규 자동화 ID'
python -B scripts/render_heartbeat.py --automation-id $traceAutomationId
if ($LASTEXITCODE -ne 0) { throw '루틴 프롬프트 렌더링 실패' }
```

렌더링 결과를 검토해 앱의 공식 자동화 도구로 반영한다. 도구가 반환한 ACTIVE,
매일 08:00, 시간대, 대상 스레드·호스트·알림 설정을 실제로 다시 읽는다.
렌더러 자체는 스케줄러를 생성/변경하지 않는다. 첫 실행의 수집·검토·적용·검증 결과를
기록하고 아직 실행하지 않은 날짜를 성공으로 만들지 않는다.
PC/앱 가용성에 따라 실행되지 못할 수 있다.

## 10. 주간 정리와 보고 UI는 별도 완료 항목

원래 PC의 주간 node_modules 정리는 Projects 내부, 7일 미작업 기준과 네 종류 보호를
유지한다. 새 PC는 실제 작업 경로·보호 프로젝트·진행 중 작업을 확인하고 **별도로 승인·등록**한다.
처음에는 scan/후보 검토부터 하며 폴더 생성이나 글로벌 설치를 삭제 승인으로 해석하지 않는다.
저장소의 선택적 등록 프로젝트 45일 정책으로 7일 규칙을 대체하지 않는다.

보고 UI를 쓸 경우 설치 부모 폴더 아래의 `reports`처럼 승인된 결과 폴더를 없을 때만
생성하고 `templates/reports/`의 템플릿 두 개와 `assets`를 가져온다.
[데이터·생성 계약](../templates/reports/README.md)을 따라 **새 PC의 실제 수집 결과**로
JSON/HTML을 갱신한다. 템플릿의 데이터 자리만 복사한 HTML은 완성 보고서가 아니다.
집계가 없으면 미수집, 루틴이 없으면 미등록으로 표시한다. 폰트 라이선스를 보존한다.

실시간 화면이 필요하면 [별도 실행 안내](rtk-live-dashboard.md)를 따른다.
Python 서버는 검증된 TRACE 러너로 실제 새 PC 집계만 읽고 `127.0.0.1`에서
화면이 보일 때 약 2초 간격으로 갱신한다. 숨김·일시정지·연결 실패는 별도 표시한다.
검사 시각은 이전 `probe` 근거를 보존한다. 새 자동화·시작 프로그램·훅은 추가하지
않으며 재부팅 후 런처를 다시 실행한다. 원래 PC의 준비 파일·PID·URL은 복사하지 않는다.

## 11. 실패했을 때 확인할 순서

| 증상 | 다음 확인·처리 |
|---|---|
| Python/Git/Node/CLI 명령 없음 | 새 터미널·실제 설치·Get-Command 경로 확인; 현재 도구 소유자 구분 |
| npm PowerShell 스크립트 실행 차단 | `npm.cmd` 사용; 전역 실행 정책 완화로 우회하지 않음 |
| clone 경로가 이미 있음 | 기존 원격/브랜치/수정 확인; 삭제하지 않음 |
| 설치 plan 충돌 | 기존 사용자 파일과 소유권 비교; 강제 덮어쓰기 금지 |
| junction/링크·읽기 실패 | 경로와 접근을 확인하고 보존; 미사용/설치 완료로 취급하지 않음 |
| 적용 중단·pending transaction | 동일 홈/개인 루트/상태로 `setup.py recover` 후 verify |
| 승인된 이전 상태로 복구 필요 | `setup.py rollback`; 복구한 소스 버전으로 verify |
| RTK SHA/소유권 불일치 | 설치 영수증·파일 확인; 수정본 덮어쓰거나 `rtk init`으로 숨기지 않음 |
| 앱/브라우저 실패 | 공식 런타임·프로필·현재 관찰 확인; 원인 가설/권한 제한과 실제 복구 구분 |
| 루틴 정상처럼 보이나 데이터 없음 | 등록·호스트 가용성·실제 실행·기록 쓰기 성공을 각각 확인 |

## 12. 완료 체크리스트와 전달할 결과

- [ ] 의도한 Git 브랜치·실제 커밋을 확인했다.
- [ ] Python/Git/선택한 CLI 경로가 정상이고 필요한 Node/npm만 준비했다.
- [ ] Projects·ChatGPT·셋업 폴더가 존재하며 기존 파일을 보존했다.
- [ ] 저장소 테스트/무결성, plan/apply/verify, 반복 unchanged를 확인했다.
- [ ] 새 PC에서 로그인했고 모델/effort·인증·MCP·권한·훅을 보존했다.
- [ ] 개인 스킬 파일 검사와 새 세션 발견을 구분해 확인했다.
- [ ] RTK를 사용할 경우 새 PC의 소유권·해시·읽기 전용 실행을 검증했다.
- [ ] 실제 프로젝트 의존성은 해당 manifest/lock/지정 manager로 설치했다.
- [ ] 새 PC 자동화의 실제 ID·호스트 승인·08:00 일정·첫 실행 상태를 확인했다.
- [ ] 주간 정리와 보고서는 별도 승인/등록/데이터 완료 여부를 표시했다.
- [ ] 미지원 UI·미수집·미실행·skip·실패를 완료로 바꾸지 않았다.

결과는 커밋, OS/Python, pass/skip/fail, 설치/재적용, 실제 도구 버전, 스킬 발견/실행,
루틴 등록/첫 실행, 남은 제약만 정제해 전달한다. 비밀·로그 원문·개인 기록은 공유하지 않는다.
문서 검증과 원래 PC/CI 검증은 다른 사용자의 새 PC 설치 성공과 별개다.

### 이 문서의 검증 범위 — 2026-10-08

- PowerShell 예제 15개의 구문 분석이 통과했다. 다운로드·로그인·설치 명령을 모두 실행했다는 뜻은 아니다.
- 폴더 생성 예제를 격리된 경로에서 실행해 신규 생성, 반복 실행과 기존 파일 보존, 같은 위치의 파일 충돌 차단, 문서 경로 미확인 시 중단을 확인했다.
- 별도 Codex 홈·개인 스킬·상태 경로에서 `plan → apply → verify → apply`를 실행했다. 최초 적용, 검증 pass, 재적용 unchanged를 확인했고 기존 파일과 모델 설정을 보존했다.
- 저장소 무결성·문서 링크 검사와 변경 diff 검사를 수행했다. 다른 PC의 계정 로그인, 실제 스킬 호출, 의존성 설치, 자동화 등록·실행은 해당 PC에서 위 체크리스트로 별도 확인해야 한다.
