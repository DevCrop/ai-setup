import { Check } from '../check.js';
import { Finding } from '../finding.js';

const FACTOR = 3;
const MIN_TODAY = 100000;
const pad = (n) => String(n).padStart(2, '0');
const day = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

// Today's output tokens against the median of the other days of the window.
export class C9TokenSpike extends Check {
  id = 'C9';
  source = 'claude';

  run(snapshot) {
    const rows = this.data(snapshot)?.tokens?.days;
    if (!Array.isArray(rows)) return [];
    const by = {};
    for (const r of rows) by[r.date] = (by[r.date] ?? 0) + (r.output || 0);
    const today = day(Date.parse(snapshot.generatedAt));
    const now = by[today] ?? 0;
    const past = Object.entries(by).filter(([d]) => d < today).map(([, n]) => n).sort((a, b) => a - b);
    if (past.length < 3 || now < MIN_TODAY) return [];
    const mid = past[Math.floor(past.length / 2)];
    if (!mid || now < FACTOR * mid) return [];
    return [new Finding({
      id: 'C9:today', checkId: this.id, source: this.source, severity: 'info',
      title: `오늘 출력 토큰이 평소의 ${Math.round(now / mid)}배입니다`,
      detail: `오늘 출력이 지난 ${past.length}일 중앙값의 ${FACTOR}배를 넘었습니다. 큰 작업이면 괜찮습니다. 아니라면 반복 실행되는 에이전트나 긴 루프가 없는지 확인하세요.`,
      evidence: [`오늘 ${now.toLocaleString('en-US')} 토큰`, `중앙값 ${mid.toLocaleString('en-US')} 토큰`],
    })];
  }
}
