import { Check } from '../check.js';
import { Finding } from '../finding.js';

export class U2RepoBehind extends Check {
  id = 'U2';
  source = 'updates';

  run(snapshot) {
    const r = this.data(snapshot)?.repo;
    if (!r || r.behind === 0) return [];
    const n = r.behind === null ? '새' : `${r.behind}개의`;
    return [new Finding({
      id: 'U2:repo', checkId: this.id, source: this.source, severity: 'info',
      title: `ai-setup 저장소에 받지 않은 ${n} 커밋이 있습니다`,
      detail: '원격 main 에 이 PC 가 아직 받지 않은 변경이 있습니다. 받은 뒤 apply.sh 로 ~/.claude 에 반영하세요. 앱은 직접 받지 않습니다.',
      evidence: [r.behind === null ? '뒤처진 커밋 수: 알 수 없음(아직 fetch 안 함)' : `뒤처진 커밋: ${r.behind}`, '명령: git pull', '명령: bash scripts/apply.sh'],
    })];
  }
}
