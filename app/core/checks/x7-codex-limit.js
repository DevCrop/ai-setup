import { Check } from '../check.js';
import { Finding } from '../finding.js';

const WARN_AT = 80;
const pad = (n) => String(n).padStart(2, '0');
const stamp = (ms) => { const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const span = (min) => (!min ? '' : min % 1440 === 0 ? `${min / 1440}일` : min % 60 === 0 ? `${min / 60}시간` : `${min}분`);

// Codex usage limits as its own last token_count event reported them (primary and secondary window).
export class X7CodexLimit extends Check {
  id = 'X7';
  source = 'codex';

  run(snapshot) {
    const rate = this.data(snapshot)?.usage?.rate;
    if (!rate) return [];
    return [['primary', rate.primary], ['secondary', rate.secondary]].flatMap(([key, l]) => {
      if (!l || !(l.usedPercent >= WARN_AT)) return [];
      const win = span(l.windowMinutes);
      const reset = l.resetsAt ? stamp(l.resetsAt) : null;
      return [new Finding({
        id: `X7:${key}`, checkId: this.id, source: this.source, severity: 'warn',
        title: `Codex 사용 한도 ${Math.round(l.usedPercent)}%${win ? ` (${win} 창)` : ''}`,
        detail: `${l.usedPercent >= 100 ? '한도를 다 써서 Codex 요청이 막힙니다.' : '곧 한도에 닿습니다.'}${reset ? ` ${reset}에 다시 채워집니다.` : ''} 그때까지 큰 작업은 Claude 로 돌리거나 Codex 추론 단계를 낮추세요.`,
        evidence: [`사용: ${l.usedPercent}%`, ...(win ? [`창: ${win}`] : []), ...(reset ? [`재설정: ${reset}`] : [])],
      })];
    });
  }
}
