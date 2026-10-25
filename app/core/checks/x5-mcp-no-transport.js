import { Check } from '../check.js';
import { Finding, idPart } from '../finding.js';

const SEVERITY = 'warn';

export class X5McpNoTransport extends Check {
  id = 'X5';
  source = 'codex';

  run(snapshot) {
    const servers = this.data(snapshot)?.config?.mcpList;
    if (!Array.isArray(servers)) return [];
    return servers.filter((s) => s && s.enabled === true && !s.transport).map((s) => new Finding({
      id: `X5:${idPart(s.name)}`, checkId: this.id, source: this.source, severity: SEVERITY,
      title: `켜진 MCP 서버 "${s.name}" 에 command 도 url 도 없습니다`,
      detail: 'config.toml 의 이 MCP 서버는 켜져 있지만 실행할 command 나 접속할 url 이 없어 시작되지 않습니다. 값을 채우거나 enabled = false 로 끄세요(앱은 고치지 않습니다).',
      evidence: [`mcp_servers.${s.name}`],
    }));
  }
}
