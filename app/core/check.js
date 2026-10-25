// A check reads a Snapshot and returns Findings. Clock, paths and env come from the snapshot, never from the check.
export class Check {
  id = '';
  source = '';

  constructor(deps = {}) {
    if (new.target === Check) throw new TypeError('Check is abstract');
    this.deps = deps;
  }

  run(_snapshot) { throw new Error('not implemented'); }

  // data of this check's source, or null when the source gave none
  data(snapshot) { return snapshot?.sources?.[this.source]?.data ?? null; }
}
