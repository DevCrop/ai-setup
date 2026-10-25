import { createHash } from 'node:crypto';
import { Check } from '../check.js';
import { Finding } from '../finding.js';
import { RemoveCodexTableFix } from '../fixes/remove-codex-table-fix.js';

const SEVERITY = 'warn';

export class X4MissingHookState extends Check {
  id = 'X4';
  source = 'codex';

  run(snapshot) {
    const hooks = this.data(snapshot)?.config?.hookList;
    const codexHome = snapshot.ctx.homes.codex;
    if (!Array.isArray(hooks) || !codexHome) return [];
    return hooks.filter((h) => h && h.exists === false && typeof h.key === 'string').map((h) => {
      const id = `X4:${createHash('sha1').update(h.key).digest('hex').slice(0, 12)}`;
      return new Finding({ recommended: true,
        id, checkId: this.id, source: this.source, severity: SEVERITY,
        title: '없는 파일을 가리키는 Codex 훅 상태가 남아 있습니다',
        detail: 'config.toml 의 [hooks.state] 표가 가리키는 파일이 사라졌습니다. 고치면 그 표만 지우고, 지우기 전에 백업을 만듭니다. 되돌리기로 복구할 수 있습니다.',
        evidence: [h.key],
        fix: new RemoveCodexTableFix({ id, codexHome, parts: ['hooks', 'state', h.key], clock: this.deps.clock }),
      });
    });
  }
}
