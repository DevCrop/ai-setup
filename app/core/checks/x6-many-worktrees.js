import { Check } from '../check.js';
import { Finding } from '../finding.js';

const SEVERITY = 'info';
export const MAX_COUNT = 20;
export const MAX_AGE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export class X6ManyWorktrees extends Check {
  id = 'X6';
  source = 'codex';

  run(snapshot) {
    const w = this.data(snapshot)?.worktrees;
    if (!w || !(w.count > 0)) return [];
    const days = Number.isFinite(w.oldestMtimeMs) ? Math.max(0, Math.floor((Date.parse(snapshot.generatedAt) - w.oldestMtimeMs) / DAY_MS)) : 0;
    const old = Number.isFinite(w.oldestMtimeMs) && Date.parse(snapshot.generatedAt) - w.oldestMtimeMs > MAX_AGE_DAYS * DAY_MS;
    if (w.count < MAX_COUNT && !old) return [];
    return [new Finding({
      id: 'X6:worktrees', checkId: this.id, source: this.source, severity: SEVERITY,
      title: `Codex worktree 가 ${w.count}개 쌓여 있습니다 (가장 오래된 것 ${days}일)`,
      detail: '~/.codex/worktrees 에 항목이 많거나 30일이 넘은 것이 있습니다. 필요 없는 것은 직접 지워도 됩니다(앱은 지우지 않습니다).',
      evidence: [`항목 ${w.count}개`, `가장 오래된 것 ${days}일`],
    })];
  }
}
