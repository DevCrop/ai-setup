import { createHash } from 'node:crypto';
import { Check } from '../check.js';
import { Finding } from '../finding.js';

const SHARE = 0.6; // of the model's context window
const k = (n) => `${Math.round(n / 1000)}K`;

// A Codex session that worked in the last 15 minutes and whose last request filled most of the context window.
export class X8CodexBigContext extends Check {
  id = 'X8';
  source = 'codex';

  run(snapshot) {
    const live = this.data(snapshot)?.usage?.live ?? [];
    const seen = new Set();
    return live.filter((s) => s.window && s.tokens >= SHARE * s.window).flatMap((s) => {
      const id = `X8:${createHash('sha1').update(String(s.projectName)).digest('hex').slice(0, 12)}`;
      if (seen.has(id)) return [];
      seen.add(id);
      return [new Finding({
        id, checkId: this.id, source: this.source, severity: 'info',
        title: `Codex 세션 문맥이 큽니다: ${s.projectName}`,
        detail: `최근 15분 안에 작업한 Codex 세션의 마지막 요청이 ${k(s.tokens)} 토큰으로 창(${k(s.window)})의 ${Math.round((s.tokens / s.window) * 100)}%입니다. 요청마다 이만큼 다시 읽으니 한도가 빨리 줄어듭니다. 주제가 바뀌었으면 새 세션을 여세요.`,
        evidence: [`문맥: ${s.tokens}`, `창: ${s.window}`],
      })];
    });
  }
}
