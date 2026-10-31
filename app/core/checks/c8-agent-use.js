import { Check } from '../check.js';
import { Finding } from '../finding.js';

const PRICEY = /opus|fable/;

// Subagent use over the window: repo agents that never ran, and agents without a repo model that ran on the expensive families.
export class C8AgentUse extends Check {
  id = 'C8';
  source = 'claude';

  run(snapshot) {
    const agents = this.data(snapshot)?.routing?.agents;
    if (!Array.isArray(agents)) return [];
    const out = [];
    const unused = agents.filter((a) => a.expected && a.runs === 0).map((a) => a.agentType);
    if (unused.length) out.push(new Finding({
      id: 'C8:unused', checkId: this.id, source: this.source, severity: 'info',
      title: `최근 7일 한 번도 안 쓴 에이전트가 ${unused.length}개 있습니다`,
      detail: '정의는 있지만 위임되지 않았습니다. 일이 없었으면 괜찮습니다. 넓은 검색처럼 이 에이전트가 맡을 일을 메인이 직접 하고 있다면 위임 규칙(orchestrate)을 확인하세요.',
      evidence: unused.slice(0, 20),
    }));
    // One finding for all of them: project-local agents (outside this repo) would otherwise flood the list.
    const pricey = agents.filter((a) => !a.expected && a.runs)
      .map((a) => ({ a, n: (a.models ?? []).filter((m) => PRICEY.test(String(m.model).toLowerCase())).reduce((s, m) => s + (m.messages || 0), 0) }))
      .filter((x) => x.n > 0).sort((x, y) => y.n - x.n);
    if (pricey.length) out.push(new Finding({
      id: 'C8:untyped', checkId: this.id, source: this.source, severity: 'info',
      title: `모델이 정해지지 않은 에이전트 ${pricey.length}개가 Opus·Fable 로 돌았습니다`,
      detail: '저장소에 모델이 정해지지 않은 에이전트(general-purpose, 프로젝트 전용 에이전트 등)는 메인 모델을 따라갑니다. 위임 규칙은 호출마다 Haiku 나 Sonnet 을 지정하라고 합니다.',
      evidence: pricey.slice(0, 20).map(({ a, n }) => `${a.agentType}: 실행 ${a.runs}회, Opus·Fable ${n}건`),
    }));
    return out;
  }
}
