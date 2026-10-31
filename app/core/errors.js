// One error type for every refusal the core reports; IpcRouter maps `code` and never shows the message of a cause.
export const MESSAGES = {
  BAD_REQUEST: 'invalid request',
  FORBIDDEN: 'not allowed from this window',
  INTERNAL: 'internal error',
  NOT_FOUND: 'no such finding',
  NO_SNAPSHOT: 'no data yet',
  INVALID_STATE: 'action not allowed in this state',
  FIX_BUSY: 'another fix is running',
  PREVIEW_STALE: 'the target changed since the preview',
  NOT_RESTORABLE: 'this fix cannot be undone here',
  RESTORE_CONFLICT: 'the file changed after the fix',
  PREVIEW_FAILED: 'preview failed',
  APPLY_FAILED: 'apply failed',
  RESTORE_FAILED: 'restore failed',
  BAD_FOLDER: 'folder not found or not a Claude/Codex home',
};

export class CoreError extends Error {
  // `detail` is only for APPLY_FAILED of fix C1 (tail of the apply.sh output); `cause` stays out of the message.
  constructor(code, { detail, cause } = {}) {
    super(MESSAGES[code] || 'internal error', cause === undefined ? undefined : { cause });
    this.name = 'CoreError';
    this.code = code;
    if (detail) this.detail = detail;
  }
}
