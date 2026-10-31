import { createHash } from 'node:crypto';
import { Check } from '../check.js';
import { Finding } from '../finding.js';

const BIG = 200000; // same as CTX_BIG in scripts/monitor-html.mjs

// A recently active session whose last prompt carries over 200k tokens pays for all of them on every turn. From token counts
// only. The id hashes the folder name (like X1) so Korean names do not collide and notify-state.json never holds the name.
export class C10BigContext extends Check {
  id = 'C10';
  source = 'claude';

  run(snapshot) {
    const rows = this.data(snapshot)?.activity?.projects;
    if (!Array.isArray(rows)) return [];
    return rows.filter((p) => p.context >= BIG).map((p) => {
      const known = typeof p.projectName === 'string' && p.projectName !== '';
      const name = known ? p.projectName : '(폴더 없음)';
      return new Finding({
        id: `C10:${known ? createHash('sha1').update(name).digest('hex').slice(0, 12) : 'unknown'}`, checkId: this.id, source: this.source, severity: 'warn',
        title: `${name} 세션의 컨텍스트가 ${Math.round(p.context / 1000)}k 토큰입니다`,
        detail: '지금 작업 중인 세션이 매 턴마다 이만큼을 다시 읽습니다. 지금 단계가 끝났으면 /compact 하거나, 다른 작업으로 넘어가면 /clear 하세요.',
        evidence: [`컨텍스트 ${p.context.toLocaleString('en-US')} 토큰`, `오늘 출력 ${(p.output || 0).toLocaleString('en-US')} 토큰`],
      });
    });
  }
}
