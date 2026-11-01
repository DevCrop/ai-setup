import { Check } from '../check.js';
import { Finding } from '../finding.js';

const STALE_DAYS = 14;
const FIX_HINT = 'codex-setup 저장소에서 python -B scripts/setup.py verify 를 실행하세요. 이 앱은 Codex 셋업을 고치지 않습니다.';

// Health of the Codex setup as its own tool (TRACE Setup) recorded it. Absent on a PC without that tool, which is not a fault.
export class X9CodexSetup extends Check {
  id = 'X9';
  source = 'codex';

  run(snapshot) {
    const s = this.data(snapshot)?.setup;
    if (!s?.found) return [];
    const out = [];
    const add = (key, title, evidence) => out.push(new Finding({ id: `X9:${key}`, checkId: this.id, source: this.source, severity: 'info', title, detail: FIX_HINT, evidence }));
    if (s.recordedVersion && s.version && s.recordedVersion !== s.version) add('version', `Codex 셋업 기록이 설치본과 다릅니다 (${s.recordedVersion} / ${s.version})`, [`설치본: ${s.version}`, `점검 기록: ${s.recordedVersion}`]);
    if (s.softwareStatus && s.softwareStatus !== 'ok') add('software', 'Codex 셋업이 소프트웨어 점검을 요청했습니다', [`상태: ${s.softwareStatus}`]);
    const at = Date.parse(s.verifiedAt ?? '');
    if (Number.isFinite(at) && Date.parse(snapshot.generatedAt) - at > STALE_DAYS * 86400000) add('stale', `Codex 셋업을 ${STALE_DAYS}일 넘게 검증하지 않았습니다`, [`마지막 검증: ${s.verifiedAt}`]);
    return out;
  }
}
