import { Check } from '../check.js';
import { Finding } from '../finding.js';

// warn section -> warn, missing section -> bad (same order as summarize()).
const SEVERITY = { warn: 'warn', missing: 'bad' };
const SECTIONS = {
  plugins: ['플러그인', '플러그인 설치·버전과 켜짐 상태를 확인하고 필요하면 저장소 설정대로 다시 설치하세요.'],
  hooks: ['훅', '~/.claude/settings.json 의 훅 항목과 스크립트 경로를 확인하세요.'],
  claudeMem: ['claude-mem', 'claude-mem 워커가 켜져 있는지 확인하고 꺼져 있으면 시작하세요.'],
  rtk: ['RTK', 'rtk 가 PATH 에 있는지, rtk gain 이 동작하는지 확인하세요.'],
};

export class C3SectionHealth extends Check {
  id = 'C3';
  source = 'claude';

  run(snapshot) {
    const d = this.data(snapshot);
    if (!d) return [];
    return Object.entries(SECTIONS).flatMap(([section, [label, next]]) => {
      const st = d[section]?.status;
      if (st === 'ok') return [];
      const key = st === 'warn' ? 'warn' : 'missing';
      return [new Finding({
        id: `C3:${section}`, checkId: this.id, source: this.source, severity: SEVERITY[key],
        title: `${label} 구역이 ${key === 'warn' ? '확인 필요' : '없음'} 상태입니다`,
        detail: `${label} 점검 결과가 ${key === 'warn' ? '경고' : '없음'}입니다. 다음 할 일: ${next}`,
        evidence: [`status: ${key}`],
      })];
    });
  }
}
