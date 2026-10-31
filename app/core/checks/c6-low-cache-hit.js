import { Check } from '../check.js';
import { Finding } from '../finding.js';

const MIN_SHARE = 0.1;   // the role/model makes at least 10% of the window's output
const MIN_OUTPUT = 50000; // and enough tokens to matter
const MAX_HIT = 0.5;
const ROLE_KO = { main: '메인', subagent: '서브에이전트', 'claude-mem': 'claude-mem', sdk: 'SDK' };
const pct = (x) => `${Math.round(x * 100)}%`;

// The overall hit rate can hide one costly role that misses the cache (seen: claude-mem on haiku). Report only, from token counts.
export class C6LowCacheHit extends Check {
  id = 'C6';
  source = 'claude';

  run(snapshot) {
    const rows = this.data(snapshot)?.tokens?.byRole;
    if (!Array.isArray(rows)) return [];
    const total = rows.reduce((s, r) => s + (r.output || 0), 0);
    if (!total) return [];
    return rows.filter((r) => r.output >= MIN_OUTPUT && r.output / total >= MIN_SHARE && r.hitRate < MAX_HIT).map((r) => new Finding({
      id: `C6:${r.role}-${r.family}`, checkId: this.id, source: this.source, severity: 'info',
      title: `${ROLE_KO[r.role] ?? r.role} ${r.family} 의 캐시 적중률이 낮습니다 (${pct(r.hitRate)})`,
      detail: `최근 7일 출력의 ${pct(r.output / total)}를 차지하는데 캐시 적중률이 ${pct(MAX_HIT)} 미만입니다. 같은 앞부분을 반복해서 새로 읽고 있다는 뜻이라 비용이 더 듭니다. 이 역할의 모델이나 호출 방식을 확인하세요.`,
      evidence: [`출력 ${r.output.toLocaleString('en-US')} 토큰 (${pct(r.output / total)})`, `캐시 적중률 ${pct(r.hitRate)}`],
    }));
  }
}
