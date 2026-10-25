import { Check } from '../check.js';
import { Finding } from '../finding.js';

const SEVERITY = 'warn';
const SCOPE_KO = { live: '라이브', repo: '저장소' };

// C5: a hook in settings.json runs a script file that is not there. Report only; the command text is never in the finding.
export class C5MissingHookScript extends Check {
  id = 'C5';
  source = 'claude';

  run(snapshot) {
    const list = this.data(snapshot)?.missingHookScripts;
    if (!Array.isArray(list) || !list.length) return [];
    return [new Finding({
      id: 'C5:hook-scripts', checkId: this.id, source: this.source, severity: SEVERITY,
      title: `없는 스크립트를 실행하는 훅이 ${list.length}개 있습니다`,
      detail: 'settings.json 의 훅 명령이 가리키는 스크립트 파일이 없어 그 훅은 실패합니다. 파일을 만들거나, 훅을 지우거나, 저장소 claude/ 를 고친 뒤 apply.sh 로 반영하세요. 자동 수정은 없습니다.',
      evidence: list.slice(0, 20).map((h) => `${SCOPE_KO[h.scope] ?? h.scope} ${h.event}: ${h.path}`),
    })];
  }
}
