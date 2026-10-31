import { Check } from '../check.js';
import { Finding } from '../finding.js';
import { ApplyRepoFix, execRunner } from '../fixes/apply-repo-fix.js';

const SEVERITY = 'warn';

export class C1ConfigDrift extends Check {
  id = 'C1';
  source = 'claude';

  run(snapshot) {
    const setup = this.data(snapshot)?.setup;
    const n = Number(setup?.driftCount) || 0;
    if (n <= 0) return [];
    const drift = Array.isArray(setup.drift) ? setup.drift : [];
    return [new Finding({ recommended: true,
      id: 'C1:drift', checkId: this.id, source: this.source, severity: SEVERITY,
      title: `저장소와 ~/.claude 설정이 다릅니다 (${n}개)`,
      detail: '저장소 claude/ 와 라이브 ~/.claude 의 에이전트·스킬 파일이 다릅니다. 적용하면 저장소 내용이 라이브로 복사됩니다(apply.sh). apply.sh 는 백업을 남기지 않아 되돌리기가 없고, git 이 기록입니다.',
      evidence: drift.slice(0, 10).map((d) => `${d?.kind === 'missing' ? 'missing' : 'differs'}: ${String(d?.path ?? '')}`),
      fix: new ApplyRepoFix({ id: 'C1:drift', repo: snapshot.ctx.repo, runner: this.deps.runner ?? execRunner, claudeHome: snapshot.ctx.homes?.claude ?? null }),
    })];
  }
}
