import { Check } from '../check.js';
import { Finding } from '../finding.js';
import { AdoptLiveKeysFix } from '../fixes/adopt-live-keys-fix.js';

const SEVERITY = 'info';
const ID = 'C4:live-only';

export class C4LiveOnlyKeys extends Check {
  id = 'C4';
  source = 'claude';

  run(snapshot) {
    const d = this.data(snapshot);
    const keys = d?.liveOnlyKeys;
    if (!Array.isArray(keys) || !keys.length) return [];
    const adoptable = Array.isArray(d.adoptableKeys) ? d.adoptableKeys : [];
    const { repo, homes } = snapshot.ctx;
    const canFix = adoptable.length > 0 && !!repo && !!homes?.claude;
    const skipped = keys.length - adoptable.length;
    const skip = skipped > 0 ? `(비밀값이 들어 있을 수 있는 ${skipped}개는 제외)` : '';
    const detail = canFix
      ? `저장소 claude/settings.json 에 없는 최상위 키입니다. 고치기를 누르면 키 ${adoptable.length}개를 저장소 파일 끝에 추가합니다${skip}. 라이브 ~/.claude 는 건드리지 않고, 이후 C1 차이를 보고 apply.sh 로 반영하세요.`
      : adoptable.length === 0
        ? '저장소 claude/settings.json 에 없는 최상위 키입니다. 모두 비밀값이 들어 있을 수 있는 키(env, 이름에 key/token/secret/password 포함 등)라 자동으로 가져오지 않습니다. 필요하면 저장소 claude/ 에 직접 추가하세요(저장소 변경). 라이브 파일은 직접 고치지 않습니다.'
        : '저장소 claude/settings.json 에 없는 최상위 키입니다. 저장소 경로를 알 수 없어 자동으로 가져올 수 없습니다. 필요하면 저장소 claude/ 에 직접 추가하세요(저장소 변경).';
    const names = keys.map(String);
    const left = names.filter((k) => !adoptable.includes(k));
    const evidence = [
      ...(adoptable.length ? [`가져올 키: ${adoptable.join(' · ')}`] : []),
      ...(left.length ? [`제외(비밀 가능): ${left.join(' · ')}`] : []),
    ];
    return [new Finding({
      id: ID, checkId: this.id, source: this.source, severity: SEVERITY,
      title: `라이브 settings.json 에만 있는 키가 ${keys.length}개 있습니다`,
      detail,
      evidence,
      fix: canFix ? new AdoptLiveKeysFix({ id: ID, repo, claudeHome: homes.claude }) : null,
    })];
  }
}
