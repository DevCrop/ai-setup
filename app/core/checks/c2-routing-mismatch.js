import { Check } from '../check.js';
import { Finding, idPart } from '../finding.js';

const SEVERITY = 'warn';

export class C2RoutingMismatch extends Check {
  id = 'C2';
  source = 'claude';

  run(snapshot) {
    const agents = this.data(snapshot)?.routing?.agents;
    if (!Array.isArray(agents)) return [];
    return agents.filter((a) => a?.verdict === 'mismatch' && typeof a.agentType === 'string').map((a) => new Finding({
      id: `C2:${idPart(a.agentType)}`, checkId: this.id, source: this.source, severity: SEVERITY,
      title: `${a.agentType} 에이전트가 기대와 다른 모델로 실행됐습니다`,
      detail: `최근 7일 실행 기록에서 이 에이전트가 기대 모델(${a.expected})과 다른 모델로 돌았습니다. 저장소 claude/agents 의 model 줄과 호출 방식을 확인하세요.`,
      evidence: [`expected: ${a.expected}`, ...(Array.isArray(a.models) ? a.models.slice(0, 10).map((m) => `${m?.model} x${Number(m?.messages) || 0}`) : [])],
    }));
  }
}
