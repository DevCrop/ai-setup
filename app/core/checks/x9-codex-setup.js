import { Check } from '../check.js';
import { Finding } from '../finding.js';

const STALE_DAYS = 14;
const SOFTWARE_HINT = 'codex-setup 저장소의 docs/software-updates.md 절차로 확인하세요. 이 앱은 Codex 셋업을 고치지 않습니다.';
const STALE_HINT = 'Codex 루틴이 검증 결과를 기록합니다. 루틴이 돌고 있는지 codex-setup 쪽에서 확인하세요. 이 앱은 Codex 셋업을 고치지 않습니다.';

// Health of the Codex setup as its own tool (TRACE Setup) recorded it. Absent on a PC without that tool, which is not a fault.
export class X9CodexSetup extends Check {
  id = 'X9';
  source = 'codex';

  run(snapshot) {
    const s = this.data(snapshot)?.setup;
    if (!s?.found) return [];
    const out = [];
    const add = (key, title, detail, evidence) => out.push(new Finding({ id: `X9:${key}`, checkId: this.id, source: this.source, severity: 'info', title, detail, evidence }));
    // software_updates.py writes verified, attention or failed.
    if (s.softwareStatus === 'attention' || s.softwareStatus === 'failed') add('software', 'Codex 셋업이 소프트웨어 점검을 요청했습니다', SOFTWARE_HINT, [`상태: ${s.softwareStatus}`]);
    const at = Date.parse(s.verifiedAt ?? '');
    if (Number.isFinite(at) && Date.parse(snapshot.generatedAt) - at > STALE_DAYS * 86400000) add('stale', `Codex 셋업을 ${STALE_DAYS}일 넘게 검증하지 않았습니다`, STALE_HINT, [`마지막 검증: ${s.verifiedAt}`]);
    return out;
  }
}
