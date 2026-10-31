import { Check } from '../check.js';
import { Finding } from '../finding.js';

// What the auto-updater left for the user: a restart, an npm ci it must not run itself, or a step that failed.
export class U3AutoUpdate extends Check {
  id = 'U3';
  source = 'updates';

  run(snapshot) {
    const a = snapshot?.ctx?.autoUpdate;
    if (!a) return [];
    const out = [];
    const f = (o) => out.push(new Finding({ checkId: this.id, source: this.source, ...o }));
    if (a.npmNeeded) {
      f({
        id: 'U3:npm', severity: 'warn', title: '앱 의존성이 바뀌었습니다',
        detail: '자동 업데이트로 받은 변경에 app/package.json 이 있습니다. 앱이 켜진 채로 npm ci 를 돌리면 Electron 이 깨지므로 앱은 직접 돌리지 않습니다. 앱을 끝낸 뒤 아래 명령을 실행하고 다시 켜세요.',
        evidence: ['명령: cd app && npm ci'],
      });
    } else if (a.restartNeeded) {
      f({
        id: 'U3:restart', severity: 'info', title: '앱을 다시 시작하면 새 버전이 적용됩니다',
        detail: '자동 업데이트로 앱 코드가 바뀌었습니다. 메인 창이 닫혀 있으면 앱이 스스로 다시 시작합니다.',
        evidence: [],
      });
    }
    for (const s of a.failed ?? []) {
      f({
        id: `U3:${s.step}`, severity: 'info', title: `자동 업데이트 실패: ${s.label}`,
        detail: '같은 대상은 6시간 뒤 다시 시도합니다. 아래 내용을 보고 직접 처리해도 됩니다.',
        evidence: s.note ? [s.note] : [],
      });
    }
    return out;
  }
}
