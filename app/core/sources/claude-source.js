import os from 'node:os';
import path from 'node:path';
import { collect, summarize } from '../../../scripts/monitor.mjs';
import { planAdoption } from '../fixes/adopt-live-keys-fix.js';
import { findMissingHookScripts } from '../hook-scripts.js';
import { readGuarded } from '../guard.js';
import { Source, guardSource } from '../source.js';

// Top-level key names of the live settings.json that the repo's claude/settings.json does not have, and the subset the C4 fix may copy.
// Names only, never values (planAdoption reads key names at any depth, never string values).
function liveKeys(home, repo) {
  const read = (file) => {
    try {
      const j = JSON.parse(readGuarded(file, { maxBytes: 1 << 20 }).toString('utf8').replace(/^﻿/, ''));
      return j && typeof j === 'object' && !Array.isArray(j) ? j : null;
    } catch { return null; }
  };
  const live = read(path.join(home, 'settings.json'));
  const mine = read(path.join(repo, 'claude', 'settings.json'));
  // family of the live main model (opus/sonnet/haiku/fable), for the main-model check
  const m = typeof live?.model === 'string' ? (live.model.toLowerCase().match(/opus|sonnet|haiku|fable/) || [null])[0] : null;
  if (!live || !mine) return { liveOnlyKeys: [], adoptableKeys: [], mainModel: m };
  const cut = (keys) => keys.sort().slice(0, 50);
  return {
    liveOnlyKeys: cut(Object.keys(live).filter((k) => !Object.hasOwn(mine, k) && k.length <= 80)),
    adoptableKeys: cut(planAdoption(live, mine).adopt),
    mainModel: m,
  };
}

// Hook scripts that settings.json (live and repo) points to but that do not exist: scope, event and path only, never the command.
function hookScripts(ctx) {
  const claudeHome = ctx.homes.claude;
  const home = ctx.env?.HOME || ctx.env?.USERPROFILE || os.homedir();
  return findMissingHookScripts([
    { scope: 'live', file: path.join(claudeHome, 'settings.json') },
    ...(ctx.repo ? [{ scope: 'repo', file: path.join(ctx.repo, 'claude', 'settings.json') }] : []),
  ], { home, claudeHome });
}

export class ClaudeSource extends Source {
  id = 'claude';
  label = 'Claude';

  // collectFn is the seam for tests; the default is collect() of scripts/monitor.mjs, unchanged.
  #memo = {}; // slow-moving results collect() may reuse between runs (rtk)

  constructor({ collectFn = collect } = {}) {
    super();
    this.collectFn = collectFn;
  }

  invalidate() { this.#memo = {}; }

  async collect(ctx) {
    return guardSource(async () => {
      const data = await this.collectFn({ home: ctx.homes.claude, repo: ctx.repo, env: ctx.env, cache: ctx.cache, memo: this.#memo, refreshSec: ctx.refreshSec, now: new Date(ctx.now).toISOString() });
      const summary = summarize(data);
      return { status: summary.status, note: '', data: { ...data, summary, ...liveKeys(ctx.homes.claude, ctx.repo), missingHookScripts: hookScripts(ctx) } };
    });
  }
}
