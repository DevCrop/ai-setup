import { Check } from '../check.js';
import { Finding, idPart } from '../finding.js';

const BIG = 200000;

// A live session whose last prompt carries over 200k tokens pays for all of them on every turn. From token counts only.
export class C10BigContext extends Check {
  id = 'C10';
  source = 'claude';

  run(snapshot) {
    const rows = this.data(snapshot)?.activity?.projects;
    if (!Array.isArray(rows)) return [];
    return rows.filter((p) => p.live === true && p.context >= BIG).map((p) => {
      const known = typeof p.projectName === 'string' && p.projectName !== '';
      const name = known ? p.projectName : '(폴더 없음)';
      return new Finding({
        id: `C10:${known ? idPart(name) : 'unknown'}`, checkId: this.id, source: this.source, severity: 'warn',
        title: `${name} 세션의 컨텍스트가 ${Math.round(p.context / 1000)}k 토큰입니다`,
        detail: '지금 작업 중인 세션이 매 턴마다 이만큼을 다시 읽습니다. 지금 단계가 끝났으면 /compact 하거나, 다른 작업으로 넘어가면 /clear 하세요.',
        evidence: [`컨텍스트 ${p.context.toLocaleString('en-US')} 토큰`, `오늘 출력 ${(p.output || 0).toLocaleString('en-US')} 토큰`],
      });
    });
  }
}
