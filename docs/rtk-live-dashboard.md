# RTK 실시간 보기

파일 HTML은 저장 시점의 스냅샷이다. 실시간 보기는 사용자가 별도로 시작하는
표준 라이브러리 Python 서버와 동일한 보고 템플릿으로 제공한다. OpenAI 기능이나
실제 사용량 측정기가 아니며 RTK의 로컬 추정 집계를 보여 준다.

## 시작

Python 3.11 이상과 이미 검증된 TRACE RTK 설치가 필요하다. `CODEX_HOME`을
지정했다면 서버에도 그대로 전달된다. 아래 보고 폴더는 이 기능을 승인한 PC의
폴더로 바꾼다. 저장소 루트에서 실행한다.

```powershell
./scripts/start_rtk_dashboard.ps1 -ReportsDir 'C:\approved\reports'
```

보고 폴더에는 `rtk-efficiency.template.html`과
`assets/PretendardVariable.woff2`가 있어야 한다. 선택적인
`rtk-efficiency.json`의 `probe`는 마지막 실제 압축 검사 근거다. 없으면 미확인이다.
템플릿과 폰트는 `templates/reports`에서 해당 폴더로 복사할 수 있지만 기존 사용자
수정은 먼저 비교한다. 머신의 집계나 기존 성공 기록은 다른 PC로 복사하지 않는다.

런처는 숨김 서버를 시작하고 실제 준비 파일을 읽어 브라우저를 연다.
같은 보고 폴더의 살아 있는 동일 인스턴스는 재사용한다. `.rtk-live-ready.json`은
URL·프로세스 번호·인스턴스 식별자만 갖는 로컬 상태다. Git에 올리지 않는다.
같은 이름의 기존 파일이 TRACE 준비 기록 형식이 아니면 덮어쓰지 않고 중단한다.
재부팅 후에는 런처를 다시 실행한다. Windows 시작 프로그램이나 신규 자동화는
설치하지 않는다. 사용 종료 시 준비 파일의 번호와 실제 서버 프로세스를 확인한
후 그 서버만 종료할 수 있다. 탭을 닫으면 집계 조회는 멈추고 서버는 대기한다.

다른 플랫폼은 다음 명령으로 시작하고 터미널에 출력된 로컬 URL을 연다.

```text
python -B scripts/rtk_dashboard.py --reports-dir /approved/reports
```

## 데이터 흐름과 표시

1. 보고 화면이 보일 때 2초마다 `/api/rtk`를 읽는다. 조회 소요 시간 뒤 2초를
   기다리므로 정확히 매 2초 도착한다는 보장은 없다.
2. 서버가 기존 `CODEX_HOME/bin/trace_rtk.py`로 `gain --daily --format json`을 읽는다.
   러너의 기존 소유권·바이너리 해시 검사를 거친다. 새 진단 명령은 만들지 않는다.
3. 숫자·날짜 허용 필드만 반환한다. 프로젝트 경로·명령 이력·stderr는 보내지 않는다.
   여러 탭의 동시 요청은 2초 캐시와 직렬 수집으로 합친다.
4. 누적 수치·일별 차트·표·CSV가 함께 갱신된다. 정렬과 차트 선택은 유지된다.
   집계 시각은 초 단위 KST, RTK 기록 날짜는 별도로 표시한다.
5. 저장된 `probe.checked_at`은 그대로다. 집계를 읽었다고 새 압축 검사가
   통과한 것으로 표시하지 않는다. 실제 OpenAI 토큰·달러·구독 잔량은 환산하지 않는다.
6. 숨긴 탭과 일시정지는 조회를 쉬고, 다시 보이면 조회를 재개한다. 연결 실패는
   이전 값을 유지하고 오류 배지를 표시하며 최대 30초까지 재시도 간격을 늘린다.

실시간 조회는 메모리에서만 동작한다. 일일 정본·날짜별 집계와 저장 HTML을
덮어쓰지 않는다. 기존 등록된 점검은 그 호스트의 실제 일정대로 계속 수집한다.
이 기능이 없던 과거 날짜에 기록을 만들지 않는다.

## 범위와 검증

서버는 `127.0.0.1`에만 바인딩하고 임의 포트를 사용한다. 정확한 Host와
동일 Origin만 허용하며 외부 Origin·교차 사이트·임의 경로·쿼리·쓰기 요청을
거부한다. 디렉터리 목록, 파일 업로드, 임의 명령 실행, 공개 호스팅은 제공하지 않는다.
이는 공개 서비스용 서버가 아니다. 경로의 링크·Windows reparse point를 거부하고
기존 설정·훅·인증·권한·자동화 일정을 변경하지 않는다.

```text
python -B scripts/test_rtk_dashboard.py
node scripts/test_rtk_dashboard_client.cjs
python -B scripts/validate_repo.py
```

테스트는 수집 명령 고정, 캐시, 숫자·날짜 검증, 실패 시 오래된 값의 성공 처리 방지,
HTTP 경계, UI의 자동 갱신·숨김·일시정지·실패·동시 조회 방지를 확인한다.
DOM 대역을 쓴 스크립트 검사는 실제 브라우저 렌더링 증거와 구분한다.

설계 근거: [Python HTTP server](https://docs.python.org/3/library/http.server.html),
[Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API).
