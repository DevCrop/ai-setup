# bootstrap — 새 PC 한 번에 설정

새 Windows PC에서 파일 하나(`setup.ps1`)를 실행하면 도구 설치, 이 저장소 받기, 전역 Claude 설정(`~/.claude`), 프로젝트 작업 폴더, 기능 모듈까지 차례로 맞춥니다. 설치하고 연결만 합니다. `setup.ps1` 자신은 아무것도 지우지 않습니다(단, `ai-setup` 모듈의 `apply.sh`는 예전에 복사했다가 저장소에서 빠진 파일과 `scripts/removed-keys.json`의 설정 키를 지웁니다).

## 새 PC에서 실행

PowerShell을 열고(관리자 아님) 한 줄을 붙여 넣습니다. 실행 정책은 이 프로세스에서만 우회합니다(PC 설정은 그대로).

```powershell
[Net.ServicePointManager]::SecurityProtocol = 'Tls12'; irm https://raw.githubusercontent.com/DevCrop/ai-setup/main/bootstrap/setup.ps1 -OutFile $env:TEMP\ai-setup.ps1; powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\ai-setup.ps1
```

먼저 무엇을 할지만 보려면 끝에 `-DryRun`을 붙입니다(저장소를 아직 받지 않은 새 PC에서는 모듈 단계가 "clone 뒤에 생김"으로 건너뛰어집니다). 이미 저장소가 있으면 `powershell -NoProfile -ExecutionPolicy Bypass -File bootstrap\setup.ps1`로 바로 실행해도 됩니다.

## 하는 일 (순서대로)

1. 도구: Git(Git Bash 포함), Node.js LTS, jq, rtk는 `winget`으로, Claude Code는 공식 설치 명령(`irm https://claude.ai/install.ps1 | iex`)으로 설치합니다. 이미 있으면 버전만 출력하고 넘어갑니다. winget이 약관 동의를 요구하면 자동으로 동의합니다. Git과 Node.js는 PC 전체에 설치되므로 Windows가 관리자 확인 창(UAC)을 띄울 수 있습니다.
2. `repo`: `https://github.com/DevCrop/ai-setup.git`을 `-RepoPath`(기본 `D:\project\ai-setup`, D: 드라이브가 없으면 `$HOME\project\ai-setup`)에 받습니다. 이미 있으면 변경 사항이 없을 때만 `git pull --ff-only`, 있으면 경고만 하고 계속합니다.
3. `workroot`: 프로젝트(`<client>/<stage>/<name>`)가 들어갈 작업 폴더를 묻고(기본 `D:\work` 또는 `$HOME\work`) 만든 뒤 `$HOME\.ai-setup\machine.json`에 저장합니다. 작업 폴더가 필요한 모듈은 이 파일을 읽으면 됩니다(지금 읽는 모듈은 없음). 저장소에는 들어가지 않습니다. `-WorkRoot`를 주면 저장된 값보다 우선합니다.
4. 모듈: `bootstrap/modules.json`에 적힌 순서대로 실행합니다.
   - `ai-setup`: Git Bash로 `bash scripts/apply.sh` (전역 Claude 설정 복사, `CLAUDE_CONFIG_DIR`가 있으면 그 경로)
   - `claude-plugins`: `ponytail@ponytail`, `claude-mem@thedotmack` 설치 후 `bash scripts/setup-claude-mem.sh`
   - `monitor`: `node scripts/monitor.mjs` (설정 상태 페이지 경로 출력)
   - `machine`: `node machine/scan.mjs` (디스크 지도, 읽기만 함, 몇 분 걸릴 수 있음)
   - `claude-monitor`: `node app/install.mjs`가 Claude Monitor 앱(Electron)을 받고(Electron이 없거나 `package-lock.json`이 바뀌었을 때만, 켜져 있는 앱을 먼저 끈 뒤 `npm ci`) 시작 프로그램에 바로 가기(`Claude Monitor.lnk`)를 둔 뒤 한 번 켭니다. 작업 표시줄 위 작은 상태 막대가 항상 떠 있고, 누르면 앱 창이 열립니다. 이미 bootstrap을 돌린 PC는 `-Only claude-monitor`로 한 번만 실행하면 됩니다. 끄려면 상태 막대 오른쪽 클릭 → 끝내기, 자동 시작을 없애려면 시작 프로그램 폴더(`shell:startup`)에서 바로 가기를 지웁니다.

끝에 단계별 표(step, status ok/skipped/failed, note)를 보여 줍니다. 한 단계가 실패해도 나머지는 계속하고, 뒤 단계가 그 단계에 기대는 경우만 건너뜁니다.

## 옵션

| 옵션 | 뜻 |
|---|---|
| `-DryRun` | 할 일을 `[dry-run]` 줄로 보여 주기만 하고 아무것도 바꾸지 않음 |
| `-Only a,b` / `-Skip a,b` | 이름(`git`, `node`, `jq`, `rtk`, `claude`, `repo`, `workroot`, 모듈 이름)으로 고르기. 없는 이름이면 아무것도 하지 않고 멈춤 |
| `-NonInteractive` | 묻지 않고 기본값 사용 |
| `-RepoPath`, `-WorkRoot` | 기본 경로 바꾸기 |

예: 로그인 뒤 플러그인만 다시 — `-Only claude-plugins`.

## 손으로 해야 하는 것

1. Claude 로그인: 새 터미널에서 `claude`를 실행해 브라우저로 로그인합니다.
2. 플러그인: 로그인 전이라 `claude-plugins`가 실패했으면, Claude Code 세션을 한 번 열었다 닫은 뒤 `-Only claude-plugins`로 다시 실행합니다. `setup-claude-mem.sh`는 claude-mem이 한 번 실행돼 `~/.claude-mem/settings.json`을 만든 뒤에야 성공합니다.
3. 데스크톱 앱: 설정 → Claude Code → "권한 우회 모드 허용"을 켭니다.
4. 채팅 개인 지침: `docs/chat-instructions.md`의 블록을 claude.ai 설정 → 프로필에 붙여 넣습니다.

## 기능 추가

`modules.json`에 항목 하나를 넣으면 됩니다. `setup.ps1`은 고치지 않습니다.

```json
{ "name": "my-tool", "description": "무엇을 하는지", "check": "scripts/my-tool.mjs",
  "run": [["node", "scripts/my-tool.mjs"]], "optional": true }
```

- `check`: 저장소 기준 파일 경로. 없으면 "not available yet"으로 건너뜀(`""`이면 항상 실행)
- `run`: 차례로 실행할 명령(첫 단어는 `bash`, `node`, `claude`, `git`, `npm` 중 하나, `bash`는 Git Bash)
- `optional`: `false`면 실패 시 뒤 모듈을 건너뜀

## 검사

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File bootstrap\test-setup.ps1
```

`modules.json` 모양을 검사하고 `setup.ps1 -DryRun -NonInteractive`를 돌려 계획과 요약을 확인합니다. 아무것도 설치하지 않으며, 쓰는 것은 `%TEMP%\ai-setup-bootstrap-test`의 테스트용 파일뿐입니다(다음 실행 때 덮어씀).
