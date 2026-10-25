import { CoreError } from './errors.js';

export const FixState = Object.freeze({
  proposed: 'proposed', previewed: 'previewed', applying: 'applying', applied: 'applied', restoring: 'restoring',
  restored: 'restored', previewFailed: 'previewFailed', applyFailed: 'applyFailed', restoreFailed: 'restoreFailed',
});
const S = FixState;

// The one transition table (arch section 2). `by` is the user action that starts the move, or "system".
export const TRANSITIONS = Object.freeze([
  [S.proposed, S.previewed, 'preview'], [S.previewFailed, S.previewed, 'preview'], [S.applyFailed, S.previewed, 'preview'],
  [S.proposed, S.previewFailed, 'system'],
  [S.previewed, S.proposed, 'system'],
  [S.previewed, S.previewed, 'preview'], // a reopened window has lost the previewId: preview again, the old id stops working
  [S.previewed, S.applying, 'apply'],
  [S.applying, S.applied, 'system'], [S.applying, S.applyFailed, 'system'],
  [S.applied, S.restoring, 'restore'],
  [S.restoring, S.restored, 'system'], [S.restoring, S.restoreFailed, 'system'], [S.restoreFailed, S.applied, 'system'],
  [S.restored, S.proposed, 'system'],
].map(([from, to, by]) => Object.freeze({ from, to, by })));

export const MAX_DIFF = 20000;
const truncate = (s) => (s.length > MAX_DIFF ? `${s.slice(0, MAX_DIFF)}\n[... truncated]` : s);
const wrap = (e, code) => (e instanceof CoreError && (e.code === code || e.code === 'RESTORE_CONFLICT') ? e : new CoreError(code, { cause: e }));

// Template: preview/apply/restore enforce the table, then call the do* of the subclass.
export class Fix {
  state = S.proposed;
  guard = null; // set by Optimizer: throws FIX_BUSY while another fix applies or restores
  onChange = null; // set by Optimizer: called after every state change
  #previewId = null;
  #applyResult = null;
  #running = false; // true from the entry of apply()/restore() to its end, so the lock also covers the stale-check preview

  constructor(id) {
    if (new.target === Fix) throw new TypeError('Fix is abstract');
    this.id = id;
  }

  get restorable() { return false; }
  get running() { return this.#running; }
  get backupPath() { return this.#applyResult?.backupPath ?? null; }

  #to(next, by) {
    if (!TRANSITIONS.some((t) => t.from === this.state && t.to === next && t.by === by)) throw new CoreError('INVALID_STATE');
    this.state = next;
    this.onChange?.(this);
  }

  #start(action) {
    this.guard?.(this);
    if (!TRANSITIONS.some((t) => t.from === this.state && t.by === action)) throw new CoreError('INVALID_STATE');
    if (this.#running) throw new CoreError('FIX_BUSY'); // an apply/restore of this fix is still in flight (state not moved yet)
  }

  async preview() {
    this.#start('preview');
    let r;
    try {
      r = await this.doPreview();
    } catch (e) {
      if (this.state === S.proposed) this.#to(S.previewFailed, 'system'); // from a failed or previewed state the state stays
      this.#previewId = null;
      throw wrap(e, 'PREVIEW_FAILED');
    }
    this.#previewId = r.previewId;
    this.#to(S.previewed, 'preview');
    return { diff: truncate(String(r.diff)), previewId: r.previewId };
  }

  async apply(previewId) {
    this.#start('apply');
    this.#running = true;
    try { return await this.#apply(previewId); } finally { this.#running = false; }
  }

  async #apply(previewId) {
    // guard of previewed -> applying: the sent id is the last one given out and the target still hashes to it
    let current = null;
    if (previewId === this.#previewId) { try { current = (await this.doPreview()).previewId; } catch { /* treated as stale */ } }
    if (current !== previewId) {
      this.#to(S.proposed, 'system');
      throw new CoreError('PREVIEW_STALE');
    }
    this.#to(S.applying, 'apply');
    try {
      const r = (await this.doApply(previewId)) ?? {};
      this.#applyResult = r;
      this.#to(S.applied, 'system');
      return r;
    } catch (e) {
      this.#to(S.applyFailed, 'system');
      throw wrap(e, 'APPLY_FAILED');
    }
  }

  async restore() {
    if (!this.restorable) throw new CoreError('NOT_RESTORABLE');
    this.guard?.(this);
    if (this.state === S.restoreFailed) this.#to(S.applied, 'system'); // the live file is unchanged: back to applied, then try again
    this.#start('restore');
    this.#running = true;
    try { return await this.#restore(); } finally { this.#running = false; }
  }

  async #restore() {
    try { await this.checkRestore(); } catch (e) { throw wrap(e, 'RESTORE_FAILED'); } // RESTORE_CONFLICT passes through; the state stays applied
    this.#to(S.restoring, 'restore');
    try {
      await this.doRestore();
      this.#to(S.restored, 'system');
      return { restored: true };
    } catch (e) {
      this.#to(S.restoreFailed, 'system');
      throw wrap(e, 'RESTORE_FAILED');
    }
  }

  // After an app restart: puts a fix that was applied in an earlier session back into `applied` (outside the table on purpose;
  // the journal holds what restore needs). Only a fresh fix may do this.
  resumeApplied(result) {
    if (this.state !== S.proposed || !this.restorable) throw new CoreError('INVALID_STATE');
    this.#applyResult = result;
    this.state = S.applied;
  }

  // The next scan found the problem again after a restore.
  rescan() {
    if (this.state !== S.restored) return;
    this.#previewId = null;
    this.#to(S.proposed, 'system');
  }

  async doPreview() { throw new Error('not implemented'); }
  async doApply(_previewId) { throw new Error('not implemented'); }
  async checkRestore() { /* subclasses throw RESTORE_CONFLICT when the target changed after apply */ }
  async doRestore() { throw new CoreError('NOT_RESTORABLE'); }
}
