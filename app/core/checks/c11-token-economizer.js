import { Check } from '../check.js';
import { Finding, idPart } from '../finding.js';

const MAX_OVERHEAD = 0.05;

// Suggestions from TokenEconomizer's own state: a slow hook launcher, a waiting tool-prune proposal, a costly overhead.
export class C11TokenEconomizer extends Check {
  id = 'C11';
  source = 'claude';

  run(snapshot) {
    const te = this.data(snapshot)?.tokenEconomizer;
    if (!te || te.status !== 'ok') return [];
    const out = [];
    if (te.fastHook === false) out.push(new Finding({
      id: 'C11:slow-hook', checkId: this.id, source: this.source, severity: 'info',
      title: 'TokenEconomizer 훅이 Python을 매번 찾고 있습니다',
      detail: '도구를 쓸 때마다 약 0.2초가 더 걸립니다. bash scripts/install-plugins.sh 를 다시 실행해 Python 경로(TE_PYTHON)를 지정하세요.',
    }));
    for (const r of Array.isArray(te.repos) ? te.repos : []) {
      const label = typeof r.label === 'string' ? r.label : '?';
      if (r.proposed > 0) out.push(new Finding({
        id: `C11:prune-${idPart(label)}`, checkId: this.id, source: this.source, severity: 'info',
        title: `${label}: 안 쓰는 도구 ${r.proposed}개를 빼자는 제안이 있습니다`,
        detail: '빼면 세션마다 도구 설명을 덜 읽습니다. 그 저장소에서 /tokeneconomizer:toolprune 으로 목록을 보고 적용하세요.',
        evidence: [`세션 ${r.sessions}개 관찰`],
      }));
      if (r.effectiveTokens > 0 && r.overheadTokens / r.effectiveTokens > MAX_OVERHEAD) out.push(new Finding({
        id: `C11:overhead-${idPart(label)}`, checkId: this.id, source: this.source, severity: 'info',
        title: `${label}: TokenEconomizer 자체 비용이 ${Math.round((r.overheadTokens / r.effectiveTokens) * 100)}%입니다`,
        detail: '플러그인이 스스로 쓰는 모델 호출이 아끼는 양보다 클 수 있습니다. /tokeneconomizer:config 로 마이크로스킬을 envfacts 나 off 로 낮추세요.',
        evidence: [`오버헤드 ${r.overheadTokens.toLocaleString('en-US')} / ${r.effectiveTokens.toLocaleString('en-US')} 토큰`],
      }));
    }
    return out;
  }
}
