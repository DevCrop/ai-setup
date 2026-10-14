# Ponytail 호출 가이드

Ponytail은 TRACE에서 명시적 호출 전용이다. 매 요청에 붙일 필요는 없다.
스킬을 고른 뒤 **대상, 원하는 작업, 유지할 조건, 완료 조건**을 적는다.

## 선택 방법

Codex CLI/IDE에서는 `$`로 스킬을 선택하거나 `/skills`를 사용한다.
ChatGPT에서는 `@`로 선택한다. 앱의 선택 UI는 버전에 따라 다를 수 있다.
Codex 데스크톱 앱에서 Ponytail을 선택하면 `SKILL.md`가 별도 스킬 첨부로
전달되는 것이 관찰되었다. 이는 명시적 로딩의 증거이며,
실제 코딩 성능까지 확인했다는 뜻은 아니다.

아래 예시는 요청 문구다. 선택기가 나타나면 해당 스킬 항목을 선택하고
뒤에 요청을 적는다. 스킬 이름을 코드 블록에 쓰거나 사용법을 질문하는 것과
스킬을 선택해 실행을 요청하는 것은 구분한다. 전체 `SKILL.md`를 매번 복사할 필요는 없다.

```text
$ponytail lite 이번 작업에만 적용해줘. src/styles/button.scss의 중복 선언을
기존 스타일 규칙에 맞춰 정리해줘. 화면과 반응형 동작은 유지해줘.

$ponytail full src/lib/parse.ts의 날짜 처리 오류를 수정해줘.
기존 헬퍼와 오류 처리 방식을 유지하고, 해당 오류가 해결됐는지 확인해줘.
```

프로젝트에 같은 역할의 문서가 있으면 그 경로를 지정한다.
새 디렉터리 구조를 만들기 위해 중복 파일을 추가하지 않는다.

## 언제 선택하는가

| 스킬 | 사용할 때 | 요청에 추가할 것 |
|---|---|---|
| Ponytail | 기존 구현 단순화, 중복 제거, 불필요한 추상화 검토 | 수정 범위와 유지해야 할 동작 |

Ponytail의 `lite/full/ultra`는 스킬의 접근 강도이며 모델의 추론 강도가 아니다.
`lite`는 요구사항을 수행하며 단순한 대안을 제시하고, `full`은 재사용과 최소
구현을 우선하며, `ultra`는 필요성 자체를 적극 검토한다. 기본값은 upstream의
`full`이다. 기능·검증·보안 요구사항을 생략하는 권한은 아니다.

Ponytail upstream에는 세션 지속 지시가 있지만 TRACE에서는 요청한 작업에
한정한다. 계속 적용하려면 다음 작업에서도 명시한다.
설명 요청에 스킬 이름이 등장했다고 구현을 시작하지 않는다.

## 설정과 확인

TRACE가 관리하는 Ponytail의 `agents/openai.yaml`에는
`policy.allow_implicit_invocation: false`가 있다. 원본 스킬과 버전은 유지하므로
명시적으로 사용할 때에는 상세 절차가 읽힌다. 이 정책은 다른 시스템·플러그인
스킬의 호출 방식을 바꾸지 않는다.

목록에 보이지 않으면 새 작업 또는 앱 재시작 후 확인하고,
`python -B scripts/setup.py verify`로 설치 파일을 검사한다. 파일 검사는 실제
스킬 실행 성공을 보장하지 않는다. 임의로 새 사본을 설치해 중복을 만들지 않는다.

근거: [OpenAI Build skills](https://learn.chatgpt.com/docs/build-skills),
[Astra 지침 가이드](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra),
[고정 Ponytail 원본](../vendor/ponytail/SKILL.md).
공식 호출 방식과 TRACE의 선택형·작업 한정 정책은 구분한다.
