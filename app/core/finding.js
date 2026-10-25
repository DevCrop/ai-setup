export const Severity = Object.freeze({ ok: 'ok', info: 'info', warn: 'warn', bad: 'bad' });
export const SEVERITY_RANK = Object.freeze({ bad: 0, warn: 1, info: 2, ok: 3 });

export const FINDING_ID_RE = /^[CX][0-9]{1,2}:[A-Za-z0-9._-]{1,64}$/;

const cut = (v, n) => { const s = String(v ?? ''); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

// Makes a free-form name safe for the tail of a finding id.
export const idPart = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64) || '_';

export class Finding {
  // recommended: the check vouches that its fix is safe to batch by default (backed up or a sanctioned sync).
  constructor({ id, checkId, source, severity, title, detail, evidence = [], fix = null, recommended = false }) {
    if (!FINDING_ID_RE.test(id)) throw new TypeError('bad finding id');
    if (!Object.hasOwn(Severity, severity)) throw new TypeError('bad severity');
    this.id = id;
    this.checkId = checkId;
    this.source = source;
    this.severity = severity;
    this.title = cut(title, 120);
    this.detail = cut(detail, 400);
    this.evidence = evidence.slice(0, 20).map((e) => cut(e, 260));
    this.fix = fix;
    this.recommended = !!recommended;
  }

  withSeverity(severity) { return new Finding({ ...this, severity }); }

  // FindingDto of docs/api-claude-monitor.md section 2.
  toDto() {
    return {
      id: this.id, checkId: this.checkId, source: this.source, severity: this.severity,
      title: this.title, detail: this.detail, evidence: [...this.evidence],
      fixable: !!this.fix, restorable: !!this.fix?.restorable, fixState: this.fix ? this.fix.state : null,
      recommended: !!this.fix && this.recommended,
    };
  }
}
