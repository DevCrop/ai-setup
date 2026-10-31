import { Check } from '../check.js';
import { Finding } from '../finding.js';

const parts = (v) => v.split('.').map(Number);
export const newer = (a, b) => { const x = parts(a); const y = parts(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };

export class U1ClaudeCodeUpdate extends Check {
  id = 'U1';
  source = 'updates';

  run(snapshot) {
    const c = this.data(snapshot)?.claudeCode;
    if (!c || !newer(c.latest, c.installed)) return [];
    return [new Finding({
      id: 'U1:claude-code', checkId: this.id, source: this.source, severity: 'info',
      title: `Claude Code 새 버전 ${c.latest} 이 있습니다`,
      detail: `설치된 버전은 ${c.installed}, ${c.channel} 채널의 최신은 ${c.latest} 입니다. Claude Code 는 스스로 업데이트하기도 합니다. 바로 받으려면 아래 명령을 실행하세요.`,
      evidence: [`설치: ${c.installed}`, `최신(${c.channel}): ${c.latest}`, '명령: claude update'],
    })];
  }
}
