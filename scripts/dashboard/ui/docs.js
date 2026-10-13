// Where each check's evidence lives. One table, used by the practice cards and the project advice.
const BASE = "https://code.claude.com/docs/en/";
const SPECIAL = { hooks: BASE + "hooks-guide", "ai-setup": "https://github.com/DevCrop/ai-setup/blob/main/CLAUDE.md" };
export const docUrl = (src) => (Object.hasOwn(SPECIAL, src) ? SPECIAL[src] : BASE + encodeURIComponent(src));
export const docLabel = (src) => (src === "ai-setup" ? "저장소 CLAUDE.md" : "공식 문서");
