import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeAtomic } from '../../scripts/monitor.mjs';
import { newer } from './checks/u1-claude-code-update.js';
import { readGuarded } from './guard.js';
import { maskHome } from './mask-home.js';
import { GIT_ENV } from './sources/update-source.js';

// A failed attempt at the same target waits this long, so a broken step never runs on every 10 s tick.
export const RETRY_MS = 6 * 60 * 60 * 1000;
const LOG_MAX = 50;
const NOTE_MAX = 300;
const SHA = /^[0-9a-f]{40}$/;
const STEP_ID = /^[a-z][a-zA-Z]{1,20}$/;
const short = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12);

// What the updater may act on, read from the last snapshot only: it adds no network call of its own.
export function updateFacts(snapshot) {
  const u = snapshot?.sources?.updates?.data;
  const c = snapshot?.sources?.claude?.data;
  const r = u?.repo;
  const off = (c?.plugins?.items ?? []).filter((i) => i?.status !== 'ok').map((i) => `${i.name}|${i.pinnedRef ?? i.pinnedSha ?? ''}`).sort();
  return {
    // the remote commit names the target, so one success is not retried and a newer remote is
    repoRemote: r && r.branch !== 'other' && r.behind !== 0 && SHA.test(r.remote ?? '') ? r.remote : null,
    claudeCode: u?.claudeCode && newer(u.claudeCode.latest, u.claudeCode.installed) ? u.claudeCode.latest : null,
    pluginsOff: off.length ? `off:${short(off.join(','))}` : null,
  };
}

class StepError extends Error {}

// Runs one command; a non-zero exit becomes a StepError with the masked tail of its output.
async function must(job, file, args, opts) {
  const r = await job.runner(file, args, opts);
  if (r.code !== 0) throw new StepError(job.mask(`${r.stdout}\n${r.stderr}`.trim()).slice(-NOTE_MAX) || `exit ${r.code}`);
  return r.stdout;
}

// One update action. due(job) returns a key naming the target of this attempt, or null when there is nothing to do;
// run(job) does it and returns a short note. An independent step still runs after an earlier one failed. A step whose due()
// reads the snapshot facts forgets its failure once it is no longer due (the user fixed it by hand).
export class UpdateStep {
  id = '';
  label = '';
  independent = false;
  fromFacts = true;

  constructor() { if (new.target === UpdateStep) throw new TypeError('UpdateStep is abstract'); }

  due(_job) { return null; }

  async run(_job) { throw new Error('not implemented'); }
}

// git pull --ff-only of main, only on a clean main checkout (untracked files are fine). Records the changed paths for the steps after it.
export class RepoPullStep extends UpdateStep {
  id = 'repo';
  label = '저장소 받기';

  due(job) { return job.facts.repoRemote; }

  async run(job) {
    const git = async (...a) => (await must(job, 'git', ['-C', job.repo, ...a], { timeout: 120000, env: GIT_ENV })).trim();
    if (await git('rev-parse', '--abbrev-ref', 'HEAD') !== 'main') throw new StepError('main 브랜치가 아니라 받지 않았습니다.');
    if (await git('status', '--porcelain', '--untracked-files=no')) throw new StepError('커밋하지 않은 변경이 있어 받지 않았습니다.');
    const from = await git('rev-parse', 'HEAD');
    await git('pull', '--ff-only', 'origin', 'main');
    const to = await git('rev-parse', 'HEAD');
    if (!SHA.test(from) || !SHA.test(to)) throw new StepError('커밋을 읽지 못했습니다.');
    job.head = to;
    job.changed = from === to ? [] : (await git('diff', '--name-only', `${from}..${to}`)).split('\n').map((s) => s.trim()).filter(Boolean);
    return `${from.slice(0, 7)} → ${to.slice(0, 7)}, 파일 ${job.changed.length}개`;
  }
}

// bash scripts/apply.sh, only when the pull changed claude/. C1 drift alone never triggers it: live edits stay the user's call.
export class ApplyStep extends UpdateStep {
  id = 'apply';
  label = '설정 반영';
  fromFacts = false; // due only right after a pull; a failure stays shown (C1 offers the same apply.sh by hand)

  due(job) { return job.head && job.changed.some((f) => f.startsWith('claude/')) ? job.head : null; }

  async run(job) {
    await must(job, 'bash', ['scripts/apply.sh'], { cwd: job.repo, timeout: 120000 });
    return 'apply.sh 완료';
  }
}

// bash scripts/install-plugins.sh when the pull changed claude/settings.json (the pins) or a plugin is off its pin.
// Keyed by the pin state, so one mismatch is tried once (and again only after RETRY_MS if it failed).
export class PluginStep extends UpdateStep {
  id = 'plugins';
  label = '플러그인';

  due(job) { return job.head && job.changed.includes('claude/settings.json') ? `pins:${job.head}` : job.facts.pluginsOff; }

  async run(job) {
    await must(job, 'bash', ['scripts/install-plugins.sh'], { cwd: job.repo, timeout: 600000 });
    return 'install-plugins.sh 완료';
  }
}

// claude update when the npm tag of the configured channel is newer than the installed version.
export class ClaudeCodeStep extends UpdateStep {
  id = 'claudeCode';
  label = 'Claude Code';
  independent = true;

  due(job) { return job.facts.claudeCode; }

  async run(job) {
    await must(job, 'claude', ['update'], { timeout: 300000 });
    return `${job.facts.claudeCode} 로 업데이트`;
  }
}

export const DEFAULT_STEPS = Object.freeze([RepoPullStep, ApplyStep, PluginStep, ClaudeCodeStep]);

function cleanState(j) {
  const ok = (e) => e && typeof e === 'object' && Number.isFinite(e.at) && typeof e.ok === 'boolean' && STEP_ID.test(e.step ?? '');
  const steps = {};
  for (const [id, v] of Object.entries(j?.steps && typeof j.steps === 'object' ? j.steps : {})) {
    if (STEP_ID.test(id) && typeof v?.key === 'string' && v.key.length <= 80 && Number.isFinite(v.at) && typeof v.ok === 'boolean') steps[id] = { key: v.key, at: v.at, ok: v.ok };
  }
  return {
    steps,
    log: (Array.isArray(j?.log) ? j.log : []).filter(ok).slice(-LOG_MAX).map((e) => ({ at: e.at, step: e.step, ok: e.ok, note: String(e.note ?? '').slice(0, NOTE_MAX) })),
    npmAt: Number.isFinite(j?.npmAt) ? j.npmAt : null,
  };
}

// Runs the due steps one after another in the background, at most one pass at a time. Off unless `enabled()` and a runner.
// State (userData/update-state.json): per step the last key, time and result, and a short log of masked notes.
export class AutoUpdater {
  #state;
  #running = null;
  restartNeeded = false; // this process runs older app code than the checkout now holds

  constructor({ file = null, repo = null, runner = null, enabled = () => false, isBusy = () => false, now = () => Date.now(), homeDir = os.homedir(), steps, onDone = null } = {}) {
    this.file = file;
    this.repo = repo;
    this.runner = runner;
    this.enabled = enabled;
    this.isBusy = isBusy;
    this.now = now;
    this.homeDir = homeDir;
    this.steps = steps ?? DEFAULT_STEPS.map((S) => new S());
    this.onDone = onDone;
    let j = null;
    try { if (file) j = JSON.parse(readGuarded(file, { maxBytes: 1 << 20 }).toString('utf8')); } catch { /* fresh start */ }
    this.#state = cleanState(j);
    // npm ci has run since the dependency change when node_modules' own lock file is newer
    if (this.#state.npmAt && repo) {
      try { if (fs.statSync(path.join(repo, 'app', 'node_modules', '.package-lock.json')).mtimeMs > this.#state.npmAt) this.#state.npmAt = null; } catch { /* still needed */ }
    }
  }

  get running() { return !!this.#running; }

  // Resolves when the pass that is running (if any) has ended.
  settle() { return this.#running ?? Promise.resolve(); }

  #save() {
    if (!this.file) return;
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); writeAtomic(this.file, JSON.stringify(this.#state)); } catch { /* kept in memory */ }
  }

  #key(step, job) {
    const key = step.due(job);
    if (typeof key !== 'string' || !key) return null;
    const last = this.#state.steps[step.id];
    if (last && last.key === key && (last.ok || this.now() - last.at < RETRY_MS)) return null;
    return key;
  }

  // Starts one background pass when a step is due; returns its promise, or null when nothing starts.
  consider(snapshot) {
    if (this.#running || !this.runner || !this.repo || !this.enabled() || this.isBusy()) return null;
    const job = { facts: updateFacts(snapshot), repo: this.repo, runner: this.runner, changed: [], head: null, mask: (t) => maskHome(t, this.homeDir) };
    let cleared = false;
    for (const s of this.steps) {
      if (s.fromFacts && this.#state.steps[s.id]?.ok === false && !s.due(job)) { delete this.#state.steps[s.id]; cleared = true; }
    }
    if (cleared) this.#save();
    if (!this.steps.some((s) => this.#key(s, job))) return null;
    this.#running = this.#pass(job).finally(() => { this.#running = null; });
    return this.#running;
  }

  async #pass(job) {
    const done = [];
    const failed = [];
    let blocked = false;
    for (const step of this.steps) {
      if (blocked && !step.independent) continue;
      const key = this.#key(step, job);
      if (!key) continue;
      let ok = true;
      let note;
      try { note = String(await step.run(job)); } catch (e) { ok = false; note = e instanceof StepError ? e.message : '실행하지 못했습니다.'; }
      const at = this.now();
      this.#state.steps[step.id] = { key: key.slice(0, 80), at, ok };
      this.#state.log = [...this.#state.log, { at, step: step.id, ok, note: note.slice(0, NOTE_MAX) }].slice(-LOG_MAX);
      (ok ? done : failed).push(step.id);
      if (!ok) blocked = true;
    }
    if (job.changed.some((f) => f.startsWith('app/'))) this.restartNeeded = true;
    if (job.changed.some((f) => /^app\/package(-lock)?\.json$/.test(f))) this.#state.npmAt = this.now();
    this.#save();
    const result = { done, failed, restartNeeded: this.restartNeeded, npmNeeded: !!this.#state.npmAt };
    try { this.onDone?.(result); } catch { /* a broken listener must not fail the pass */ }
    return result;
  }

  // Plain data for Status and the U3 check: switches, the failing steps with their last note, and the newest log lines.
  status() {
    const lastNote = (id) => [...this.#state.log].reverse().find((e) => e.step === id)?.note ?? '';
    return {
      enabled: !!this.enabled(),
      running: this.running,
      restartNeeded: this.restartNeeded,
      npmNeeded: !!this.#state.npmAt,
      failed: this.steps.filter((s) => this.#state.steps[s.id]?.ok === false).map((s) => ({ step: s.id, label: s.label, note: lastNote(s.id) })),
      log: this.#state.log.slice(-10).reverse(),
    };
  }
}
