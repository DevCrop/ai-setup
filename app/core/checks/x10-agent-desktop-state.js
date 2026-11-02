import { Check } from '../check.js';
import { Finding } from '../finding.js';

// Codex's sandbox setup grants its users read access inside the profile, and agent-desktop then refuses a state folder there (docs/agent-desktop.md).
export class X10AgentDesktopState extends Check {
  id = 'X10';
  source = 'codex';

  run(snapshot) {
    const a = this.data(snapshot)?.sharedAgentDesktop;
    if (!a?.installed || !a.stateInProfile) return [];
    return [new Finding({
      id: 'X10:state', checkId: this.id, source: this.source, severity: 'warn',
      title: 'agent-desktop 상태 폴더가 사용자 프로필 안에 있습니다',
      detail: 'Codex가 있는 PC에서는 스냅샷이 실패할 수 있습니다. AGENT_DESKTOP_HOME 을 프로필 밖 폴더로 정하세요 (docs/agent-desktop.md).',
      evidence: ['AGENT_DESKTOP_HOME: 프로필 안 또는 미설정'],
    })];
  }
}
