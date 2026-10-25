import { RemoveCodexTableFix } from './remove-codex-table-fix.js';

// X1: removes exactly one [projects.'<path>'] table.
export class RemoveCodexProjectFix extends RemoveCodexTableFix {
  constructor({ id, codexHome, projectPath, clock }) { super({ id, codexHome, parts: ['projects', projectPath], clock }); }
}
