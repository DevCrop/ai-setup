import fs from 'node:fs';
import { writeAtomic } from '../../scripts/monitor.mjs';
import { SEVERITY_RANK } from './finding.js';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
// How long a finding must stay before it counts (strip, state, score, toast), and how long one toast covers it.
const MIN_AGE = { C1: 30 * MIN };
const COOLDOWN = { C2: 7 * DAY };
const TOAST_GAP = HOUR;
const KEEP_NOTIFIED = 7 * DAY;
const DIGEST_HOUR = 18; // the daily summary goes out on the first quiet run from 18:00 local time
const MAX_IDS = 500;

export const minAgeMs = (checkId) => MIN_AGE[checkId] ?? 3 * MIN;
export const cooldownMs = (checkId) => COOLDOWN[checkId] ?? DAY;

const minutes = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

// Quiet hours may wrap midnight (22:00-07:00). Off when either end is empty or both are equal.
export function inQuietHours(settings, nowMs) {
  const { quietStart: a, quietEnd: b } = settings ?? {};
  if (!a || !b || a === b) return false;
  const d = new Date(nowMs);
  const m = d.getHours() * 60 + d.getMinutes();
  const s = minutes(a); const e = minutes(b);
  return s < e ? m >= s && m < e : m >= s || m < e;
}

const NO_DIGEST = new Set(['starting', 'stale', 'nodata', 'error']);
const sevOf = (f) => f.severity === 'bad' || f.severity === 'warn';

// Decides which findings are stable (seen long enough) and when a desktop toast goes out.
// State on disk (notify-state.json): finding ids with last-notified times only, never evidence. First-seen times stay in
// memory: after a restart a finding waits its min age again, so time the app was off never counts as time seen.
export class NotificationPolicy {
  #file;
  #now;
  #settings;
  #seen = {};      // id -> first seen ms (warn/bad findings present in the last run), memory only
  #notified = {};  // id -> { at, sev }
  #lastToast = 0;
  #lastDigest = ''; // local date of the last daily summary
  #errorShown = false;

  constructor({ file = null, now = () => Date.now(), settings = () => ({ notify: true }) } = {}) {
    this.#file = file;
    this.#now = now;
    this.#settings = settings;
    if (file) {
      try {
        const j = JSON.parse(fs.readFileSync(file, 'utf8'));
        const nums = (o) => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).filter(([, v]) => Number.isFinite(v)).slice(0, MAX_IDS));
        for (const [id, v] of Object.entries(j.notified && typeof j.notified === 'object' ? j.notified : {}).slice(0, MAX_IDS)) {
          if (Number.isFinite(v?.at) && (v.sev === 'warn' || v.sev === 'bad')) this.#notified[id] = { at: v.at, sev: v.sev };
        }
        if (Number.isFinite(j.lastToast)) this.#lastToast = j.lastToast;
        if (typeof j.lastDigest === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(j.lastDigest)) this.#lastDigest = j.lastDigest;
      } catch { /* a fresh start */ }
    }
  }

  #save() {
    if (!this.#file) return;
    try { writeAtomic(this.#file, JSON.stringify({ notified: this.#notified, lastToast: this.#lastToast, lastDigest: this.#lastDigest })); } catch { /* toast memory is a convenience */ }
  }

  // Called after each finished run with the whole finding list. A finding that leaves and comes back starts its age again,
  // unless its source could not be read this run (`unread` source ids): then nothing is known and its age is kept.
  observe(findings, unread = []) {
    const now = this.#now();
    const ids = new Set(findings.filter(sevOf).map((f) => f.id));
    const skip = new Set(unread);
    const sourceOf = this.#sourceOf;
    for (const f of findings) sourceOf[f.id] = f.source;
    for (const id of Object.keys(this.#seen)) if (!ids.has(id) && !skip.has(sourceOf[id])) delete this.#seen[id];
    for (const id of ids) if (!Object.hasOwn(this.#seen, id)) this.#seen[id] = now;
    let changed = false;
    for (const [id, v] of Object.entries(this.#notified)) if (now - v.at > KEEP_NOTIFIED) { delete this.#notified[id]; changed = true; }
    if (changed) this.#save();
  }

  #sourceOf = {};

  // warn/bad findings count only once they lasted minAge; ok and info always pass (they are never counted anyway).
  isStable(f) {
    if (!sevOf(f)) return true;
    const at = this.#seen[f.id];
    return at !== undefined && this.#now() - at >= minAgeMs(f.checkId);
  }

  // Toast text or null. `status` is the new Status, `prev` the one before; `findings` the current list.
  decide(prev, status, findings) {
    const s = this.#settings() ?? {};
    const now = this.#now();
    if (status?.state !== 'error') this.#errorShown = false;
    if (s.notify === false || inQuietHours(s, now)) return null; // held back, nothing marked: it comes later
    if (status?.state === 'error' && prev && !this.#errorShown) {
      this.#errorShown = true;
      return { title: 'Claude Monitor: 수집 오류', body: '설정을 3번 연속 읽지 못했습니다.' };
    }
    const due = findings.filter((f) => sevOf(f) && this.isStable(f)).filter((f) => {
      const n = this.#notified[f.id];
      return !n || now - n.at >= cooldownMs(f.checkId) || SEVERITY_RANK[f.severity] < SEVERITY_RANK[n.sev];
    });
    if (!due.length || now - this.#lastToast < TOAST_GAP) return null;
    for (const f of due) this.#notified[f.id] = { at: now, sev: f.severity };
    this.#lastToast = now;
    this.#save();
    const bad = due.filter((f) => f.severity === 'bad');
    const first = (bad[0] ?? due[0]).title;
    const more = due.length > 1 ? ` 외 ${due.length - 1}건` : '';
    return bad.length
      ? { title: 'Claude Monitor: 문제', body: `${first}${more}. 눌러서 확인하세요.` }
      : { title: 'Claude Monitor: 확인 필요', body: `${first}${more}.` };
  }

  // Once a day from DIGEST_HOUR: what today's work was, what it saved and how many suggestions wait. Counts only, so it is
  // safe on a lock screen. Held back by notify off or quiet hours like any toast; a day with no output sends nothing.
  digest(status, findings) {
    const s = this.#settings() ?? {};
    const now = this.#now();
    const d = new Date(now);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (s.notify === false || inQuietHours(s, now) || d.getHours() < DIGEST_HOUR || this.#lastDigest === day) return null;
    if (NO_DIGEST.has(status?.state) || !(status?.todayOutput > 0)) return null;
    this.#lastDigest = day;
    this.#save();
    const k = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));
    const tips = findings.filter((f) => f.severity !== 'ok').length; // not only stable ones: right after a restart they still wait
    const parts = [
      status.todayProjects > 0 ? `프로젝트 ${status.todayProjects}곳` : null,
      `출력 ${k(status.todayOutput)} 토큰`,
      status.todaySavedInput > 0 ? `캐시로 입력 ${k(status.todaySavedInput)} 절약` : null,
      tips ? `개선 제안 ${tips}건` : '개선 제안 없음',
    ].filter(Boolean);
    return { title: 'Claude Monitor: 오늘 요약', body: `${parts.join(' · ')}.` };
  }
}
