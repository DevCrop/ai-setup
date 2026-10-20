# machine — 이 PC의 디스크 지도와 안전한 정리

AI 설정(`claude/`)과는 별개인 PC 관리 도구입니다. Windows 10, Node 22, 의존성 없음.

## 쓰는 법

1. 지도 만들기 (읽기만 합니다)

   ```bash
   node machine/scan.mjs            # 모든 고정 드라이브
   node machine/scan.mjs D:/project # 특정 폴더만
   ```

   끝나면 `os.tmpdir()/machine-map.html` 경로를 출력합니다. 브라우저로 여세요.
   상자 크기 = 용량, 색 = 정리해도 되는 정도(회색 = 정상, 주황→빨강 = 정리 가능).
   상자를 누르면 들어가고, 위쪽 경로를 누르면 돌아옵니다.

2. 오른쪽 목록은 **삭제해도 되는 것 / 확인 후 삭제 / 직접 판단** 세 묶음이고, 항목마다 "지워도 되나요?" 설명이 붙습니다.
   - **자동 최적화 — 안전한 것만**: '삭제해도 되는 것'만 골라 바로 `machine-plan.json`으로 내보냅니다.
   - 직접 고르려면 체크한 뒤 **정리 계획 내보내기**.
   - 지도 위 카테고리 칩(브라우저 캐시, 패키지 캐시 …)을 누르면 그 종류만 보입니다.

   페이지는 아무것도 지우지 않습니다.

3. 정리하기

   ```bash
   node machine/clean.mjs machine-plan.json --dry-run   # 목록만 보기
   node machine/clean.mjs machine-plan.json             # 다시 확인 후 y 입력 시 실행
   ```

   `clean.mjs`는 각 항목을 다시 확인하고(아직 있는지, 크기, 보호 폴더인지) 전체 목록을 보여준 뒤 `y` 한 번을 받습니다.
   파일·폴더는 **휴지통으로 이동**하고, 패키지 캐시는 공식 명령(`npm cache clean --force`, `pnpm store prune` 등), 다 쓴 git 워크트리는 `git worktree remove`/`prune`으로 정리합니다.
   관리자 권한이 필요한 항목은 건너뜁니다. 휴지통으로 못 보내고 영구 삭제될 수 있는 경우(NTFS가 아닌 드라이브, 드라이브의 5%를 넘는 항목, 240자 넘는 경로)도 건너뜁니다.
   저장소 설정에 외부 프로그램을 실행하는 항목(filter·diff·merge 등)이 있거나 서브모듈이 있는 워크트리는 자동으로 다루지 않고 보고만 합니다.

## 찾아내는 것

임시 파일, 패키지 캐시(npm/pnpm/yarn/pip/uv/bun/NuGet/Gradle), 90일 넘게 안 건드린 프로젝트의 `node_modules`·`.venv`·빌드 결과, 주인 잃은 git 워크트리, 안 쓰는 Claude 플러그인 캐시 버전, 지운 앱이 남긴 AppData 폴더, 휴지통, 크래시 덤프, 브라우저 캐시, 그래픽 셰이더 캐시, 앱 캐시(Discord·Slack·VS Code 등)와 Windows 오류 보고서.
보고만 하는 것: Docker/WSL 디스크, Windows 업데이트 찌꺼기(관리자 권한 필요 — Windows '디스크 정리'의 '시스템 파일 정리'로), 다운로드 폴더의 오래된 큰 설치 파일.
기준과 데이터 형식은 [CONTRACT.md](CONTRACT.md)에 있습니다.

## 절대 건드리지 않는 곳

Windows(단 `Windows\Temp` 하위 제외), Program Files*, ProgramData, 문서·바탕화면·사진 등 사용자 폴더(OneDrive 포함), 살아 있는 저장소의 `.git`, `~/.claude`(오래된 플러그인 캐시 버전만 예외), `~/.claude-mem`, `.credentials`/`.env`가 들어 있는 모든 곳, 실행 중인 Claude 세션의 임시 폴더. 목록은 [lib/deny.mjs](lib/deny.mjs).

스캐너는 크기와 수정 시각만 읽고 파일 내용은 열지 않습니다. 예외는 `~/.claude/plugins/installed_plugins.json`과 워크트리의 `.git` 포인터 파일뿐입니다.

## 테스트

```bash
node --test "machine/**/*.test.mjs"
```

Node 22에서는 `node --test machine/`처럼 폴더를 주면 동작하지 않아 glob을 씁니다.
