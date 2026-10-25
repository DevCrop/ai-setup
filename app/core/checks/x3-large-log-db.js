import { Check } from '../check.js';
import { Finding } from '../finding.js';

const SEVERITY = 'warn';
export const LIMIT_BYTES = 500 * 1024 * 1024;

export class X3LargeLogDb extends Check {
  id = 'X3';
  source = 'codex';

  run(snapshot) {
    const logs = this.data(snapshot)?.logs;
    if (!Array.isArray(logs)) return [];
    const big = logs.filter((l) => Number(l.size) >= LIMIT_BYTES);
    if (!big.length) return [];
    return [new Finding({
      id: 'X3:logs', checkId: this.id, source: this.source, severity: SEVERITY,
      title: `Codex 로그 DB 가 500MB 를 넘습니다 (${big.length}개)`,
      detail: '~/.codex 의 logs_*.sqlite 가 큽니다. Codex 를 끈 뒤 직접 정리하세요(앱은 지우지 않습니다).',
      evidence: big.slice(0, 20).map((l) => `${l.name} ${Math.round(l.size / 1024 / 1024)} MB`),
    })];
  }
}
