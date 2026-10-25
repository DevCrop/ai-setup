import { createHash } from 'node:crypto';
import { Check } from '../check.js';
import { Finding } from '../finding.js';
import { RemoveCodexProjectFix } from '../fixes/remove-codex-project-fix.js';

const SEVERITY = 'warn';

export class X1MissingTrustedProject extends Check {
  id = 'X1';
  source = 'codex';

  run(snapshot) {
    const projects = this.data(snapshot)?.config?.projects;
    const codexHome = snapshot.ctx.homes.codex;
    if (!Array.isArray(projects) || !codexHome) return [];
    return projects.filter((p) => p && p.exists === false && typeof p.path === 'string').map((p) => {
      const id = `X1:${createHash('sha1').update(p.path).digest('hex').slice(0, 12)}`;
      return new Finding({ recommended: true,
        id, checkId: this.id, source: this.source, severity: SEVERITY,
        title: '없는 폴더가 Codex 신뢰 프로젝트로 남아 있습니다',
        detail: 'config.toml 의 이 신뢰 프로젝트 경로가 사라졌습니다. 고치면 그 표만 지우고, 지우기 전에 백업을 만듭니다. 되돌리기로 복구할 수 있습니다.',
        evidence: [p.path],
        fix: new RemoveCodexProjectFix({ id, codexHome, projectPath: p.path, clock: this.deps.clock }),
      });
    });
  }
}
