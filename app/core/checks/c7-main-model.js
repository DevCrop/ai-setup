import { Check } from '../check.js';
import { Finding } from '../finding.js';

const FAMILY_RE = /opus|sonnet|haiku|fable/;
const MAX_OTHER = 0.2;

// Main-thread messages of the window on another family than the live settings.json model. /model switches are normal, so info only.
export class C7MainModel extends Check {
  id = 'C7';
  source = 'claude';

  run(snapshot) {
    const d = this.data(snapshot);
    const want = d?.mainModel;
    const rows = d?.routing?.mainThread;
    if (!want || !Array.isArray(rows)) return [];
    const by = {};
    for (const r of rows) { const f = (String(r.model).toLowerCase().match(FAMILY_RE) || ['other'])[0]; by[f] = (by[f] ?? 0) + (r.messages || 0); }
    const total = Object.values(by).reduce((s, n) => s + n, 0);
    const other = total - (by[want] ?? 0);
    if (!total || other / total < MAX_OTHER) return [];
    return [new Finding({
      id: 'C7:main-model', checkId: this.id, source: this.source, severity: 'info',
      title: `메인 대화의 ${Math.round((other / total) * 100)}%가 설정 모델(${want})이 아닌 모델로 돌았습니다`,
      detail: '최근 7일 메인 대화 메시지를 모델 계열별로 셌습니다. /model 로 바꾼 것이면 괜찮습니다. 의도하지 않았다면 settings.json 의 model 과 세션 시작 옵션을 확인하세요.',
      evidence: Object.entries(by).sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f}: ${n}건`),
    })];
  }
}
