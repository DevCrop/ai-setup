import fs from 'node:fs';
import path from 'node:path';
import * as checkModules from './checks/index.js';
import { CoreError } from './errors.js';
import { BACKUP_NAME_RE } from './fix-journal.js';
import { Finding, SEVERITY_RANK } from './finding.js';
import { FixState } from './fix.js';
import { RemoveCodexTableFix } from './fixes/remove-codex-table-fix.js';

const MAX_FINDINGS = 200;
// A fix in one of these states survives a scan, so "되돌리기" stays visible after the finding itself is gone.
const KEEP = new Set([FixState.previewed, FixState.applying, FixState.applied, FixState.restoring, FixState.previewFailed, FixState.applyFailed, FixState.restoreFailed]);
// applied is final for a fix that cannot be restored (C1): nothing is left to show, and the next drift gets a fresh fix.
const keeps = (fix) => fix.previewing || (KEEP.has(fix.state) && !(fix.state === FixState.applied && !fix.restorable));
const BUSY = new Set([FixState.applying, FixState.restoring]);

const order = (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.source.localeCompare(b.source) || a.id.localeCompare(b.id);

export class Optimizer {
  #findings = [];
  #fixes = new Map(); // finding id -> { finding, fix }
  #subs = new Set();
  #sig = '';
  generatedAt = null;
  rev = 0;
  failedChecks = []; // ids of checks that threw in the last run

  // The registry is every export of checks/index.js; `deps` ({ runner, clock }) reaches the checks that build fixes.
  constructor({ checks, deps = {}, journal = null } = {}) {
    this.deps = deps;
    this.journal = journal;
    this.checks = checks ?? Object.values(checkModules).map((C) => new C(deps));
  }

  // The journal can also be given later (MonitorService does that for an optimizer it did not build).
  useJournal(journal) { this.journal = journal; }

  #log(findingId, action, extra = {}) {
    const f = this.#fixes.get(findingId)?.finding;
    if (!f || !this.journal) return;
    this.journal.record({ findingId, checkId: f.checkId, source: f.source, action, ...extra });
  }

  // After a restart: an X1/X4 fix that was applied, still has its backup file under <codexHome>/backups/claude-monitor/ and was not
  // restored later becomes a restorable fix in state `applied` again. Returns how many were brought back.
  resume({ codexHome }) {
    if (!this.journal || !codexHome) return 0;
    const latest = new Map();
    for (const e of this.journal.entries()) latest.set(e.findingId, e);
    let n = 0;
    for (const e of latest.values()) {
      if (!e.restorableAfterRestart || this.#fixes.has(e.findingId) || !['X1', 'X4'].includes(e.checkId)) continue;
      const backupPath = path.join(codexHome, 'backups', 'claude-monitor', e.backupName);
      if (!BACKUP_NAME_RE.test(e.backupName) || !fs.existsSync(backupPath)) continue;
      const fix = new RemoveCodexTableFix({ id: e.findingId, codexHome, parts: e.parts, clock: this.deps.clock });
      fix.resume({ backupPath, appliedHash: e.appliedHash });
      this.#adopt(fix);
      const finding = new Finding({
        id: e.findingId, checkId: e.checkId, source: e.source, severity: 'ok',
        title: '앱을 다시 시작하기 전에 적용한 수정입니다',
        detail: '되돌리기를 누르면 백업을 config.toml 로 복사해 돌려놓습니다. 그 사이 config.toml 이 바뀌었으면 되돌리지 않습니다.',
        evidence: [e.parts[e.parts.length - 1]], fix,
      });
      this.#fixes.set(e.findingId, { finding, fix });
      n++;
    }
    if (n) this.#changed();
    return n;
  }

  // Last `n` journal entries, newest first. `restorable` is true when this entry is the newest one of its finding,
  // it was an apply, and a restorable fix in state `applied` exists right now. Hashes and table parts stay inside.
  history(n = 50) {
    if (!this.journal) return [];
    const newest = new Map();
    for (const e of this.journal.entries()) newest.set(e.findingId, e);
    return this.journal.recent(n).map((e) => {
      const fix = this.getFix(e.findingId);
      return {
        at: e.at, findingId: e.findingId, checkId: e.checkId, source: e.source, action: e.action, backupName: e.backupName,
        restorableAfterRestart: e.restorableAfterRestart,
        restorable: e.action === 'applied' && newest.get(e.findingId) === e && !!fix && fix.restorable && fix.state === FixState.applied,
      };
    });
  }

  subscribe(cb) { this.#subs.add(cb); return () => this.#subs.delete(cb); }

  #changed() {
    this.rev++;
    for (const cb of this.#subs) { try { cb(); } catch { /* a broken listener must not stop a fix */ } }
  }

  #adopt(fix) {
    fix.guard = (f) => { if (this.busyFindingId() && this.busyFindingId() !== f.id) throw new CoreError('FIX_BUSY'); };
    fix.onChange = () => this.#changed();
  }

  run(snapshot) {
    const fresh = [];
    this.failedChecks = [];
    for (const c of this.checks) {
      try { fresh.push(...c.run(snapshot)); } catch { this.failedChecks.push(c.id); } // one broken check must not hide the others
    }
    const seen = new Set();
    const out = [];
    for (const f of fresh) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      const kept = this.#fixes.get(f.id)?.fix;
      if (f.fix && kept && (keeps(kept) || kept.state === FixState.restored)) {
        kept.rescan();
        f.fix = kept;
      } else if (f.fix) this.#adopt(f.fix);
      else if (kept && keeps(kept)) f.fix = kept; // the finding lives on without a fix of its own (C4 after apply): its applied fix stays restorable
      out.push(f);
    }
    // kept fixes whose finding is gone stay listed as "ok" so the user can still restore
    for (const [id, { finding, fix }] of this.#fixes) {
      // a running apply/restore stays even in `previewed` (its stale check), so the busy lock and the journal entry hold
      if (!seen.has(id) && (fix.running || (!fix.previewing && keeps(fix) && fix.state !== FixState.previewed))) out.push(finding.withSeverity('ok'));
    }
    this.#fixes = new Map(out.filter((f) => f.fix).map((f) => [f.id, { finding: f, fix: f.fix }]));
    this.#findings = out.sort(order).slice(0, MAX_FINDINGS);
    this.generatedAt = snapshot.generatedAt;
    const sig = this.#findings.map((f) => `${f.id}|${f.severity}|${f.fix?.state ?? ''}`).join(',');
    if (sig !== this.#sig) { this.#sig = sig; this.#changed(); }
    return this.#findings;
  }

  findings() { return [...this.#findings]; }

  // FindingDto[] of docs/api-claude-monitor.md section 2, already sorted.
  list() { return this.#findings.map((f) => f.toDto()); }

  getFix(findingId) { return this.#fixes.get(findingId)?.fix ?? null; }

  busyFindingId() {
    for (const { fix } of this.#fixes.values()) if (BUSY.has(fix.state) || fix.running) return fix.id;
    return null;
  }

  #need(findingId) {
    const fix = this.getFix(findingId);
    if (!fix) throw new CoreError('NOT_FOUND');
    return fix;
  }

  async preview(findingId) {
    const fix = this.#need(findingId);
    const { diff, previewId } = await fix.preview();
    return { findingId, diff, previewId, restorable: fix.restorable };
  }

  async apply(findingId, previewId) {
    const fix = this.#need(findingId);
    let r;
    try { r = await fix.apply(previewId); } catch (e) {
      if (e?.code === 'APPLY_FAILED') this.#log(findingId, 'applyFailed');
      throw e;
    }
    this.#log(findingId, 'applied', {
      backupName: r.backupPath ? path.basename(r.backupPath) : null, appliedHash: r.appliedHash ?? null, parts: Array.isArray(fix.parts) ? fix.parts : null,
    });
    return { findingId, fixState: fix.state, restorable: fix.restorable, backupName: r.backupPath ? path.basename(r.backupPath) : null };
  }

  async restore(findingId) {
    const fix = this.#need(findingId);
    try { await fix.restore(); } catch (e) {
      if (e?.code === 'RESTORE_FAILED') this.#log(findingId, 'restoreFailed');
      throw e;
    }
    this.#log(findingId, 'restored');
    return { findingId, fixState: fix.state };
  }
}
