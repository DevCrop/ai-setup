import { Check } from '../check.js';
import { Finding } from '../finding.js';

const SEVERITY = 'info';
const MIN_COUNT = 3;

export class X2StaleBackups extends Check {
  id = 'X2';
  source = 'codex';

  run(snapshot) {
    const backups = this.data(snapshot)?.backups;
    if (!Array.isArray(backups) || backups.length < MIN_COUNT) return [];
    return [new Finding({
      id: 'X2:backups', checkId: this.id, source: this.source, severity: SEVERITY,
      title: `Codex 설정 백업 파일이 ${backups.length}개 쌓여 있습니다`,
      detail: '~/.codex 의 config.toml.bak* 파일이 많습니다. 필요 없는 것은 직접 지워도 됩니다(앱은 지우지 않습니다).',
      evidence: backups.slice(0, 20).map((b) => String(b.name)),
    })];
  }
}
