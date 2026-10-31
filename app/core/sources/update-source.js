import fs from 'node:fs';
import path from 'node:path';
import { Source } from '../source.js';

const TTL_MS = 6 * 60 * 60 * 1000;
const SEMVER = /^\d{1,4}\.\d{1,4}\.\d{1,6}$/;
const SHA = /^[0-9a-f]{40}$/;
const DIST_TAGS = 'https://registry.npmjs.org/-/package/@anthropic-ai/claude-code/dist-tags';
// git must never open a credential window or prompt in the background.
const GIT_ENV = { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };

// HTTPS GET of a small JSON document, registry.npmjs.org only, 5 s limit. Used by main.js; tests pass their own fetchJson.
export async function httpsJson(url, fetchFn = globalThis.fetch) {
  if (!url.startsWith('https://registry.npmjs.org/')) throw new Error('host not allowed');
  const res = await fetchFn(url, { signal: AbortSignal.timeout(5000), redirect: 'error', headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`http ${res.status}`);
  const text = await res.text();
  if (text.length > 65536) throw new Error('too large');
  return JSON.parse(text);
}

function channelOf(claudeHome) {
  try { return JSON.parse(fs.readFileSync(path.join(claudeHome, 'settings.json'), 'utf8')).autoUpdatesChannel === 'stable' ? 'stable' : 'latest'; } catch { return 'latest'; }
}

// Report-only update facts, refreshed in the background at most every 6 hours. collect() never waits for the network:
// it returns the last result (or null) and starts a refresh when that is old. Inert unless runner, fetchJson and enabled are given.
export class UpdateSource extends Source {
  id = 'updates';
  label = '업데이트';
  #cache = null; // { at, data }
  #inflight = null;

  constructor({ runner = null, fetchJson = null, updateCheck = () => false, ttlMs = TTL_MS } = {}) {
    super();
    this.runner = runner;
    this.fetchJson = fetchJson;
    this.updateCheck = updateCheck;
    this.ttlMs = ttlMs;
  }

  async collect(ctx) {
    if (!this.runner || !this.fetchJson || !this.updateCheck()) return { status: 'missing', note: 'update check off', data: null };
    if (!this.#inflight && (!this.#cache || ctx.now - this.#cache.at >= this.ttlMs)) {
      const at = ctx.now;
      this.#inflight = this.refresh(ctx).then((data) => { this.#cache = { at, data }; }, () => { this.#cache = { at, data: null }; })
        .finally(() => { this.#inflight = null; });
    }
    return { status: this.#cache?.data ? 'ok' : 'missing', note: '', data: this.#cache?.data ?? null };
  }

  // Exposed for tests: resolves when a background refresh started by collect() has finished.
  settle() { return this.#inflight ?? Promise.resolve(); }

  async refresh(ctx) {
    const [claudeCode, repo] = await Promise.all([this.#claudeCode(ctx).catch(() => null), this.#repo(ctx).catch(() => null)]);
    return { claudeCode, repo };
  }

  async #claudeCode(ctx) {
    const v = await this.runner('claude', ['--version'], { timeout: 10000 });
    const installed = v.code === 0 ? /(\d+\.\d+\.\d+)/.exec(v.stdout)?.[1] : null;
    if (!installed) return null;
    const channel = channelOf(ctx.homes.claude);
    const latest = (await this.fetchJson(DIST_TAGS))?.[channel];
    if (typeof latest !== 'string' || !SEMVER.test(latest)) return null;
    return { installed, latest, channel };
  }

  async #repo(ctx) {
    if (!ctx.repo) return null;
    const git = (...args) => this.runner('git', ['-C', ctx.repo, ...args], { timeout: 15000, env: GIT_ENV });
    const remote = /^([0-9a-f]{40})\s/.exec((await git('ls-remote', 'origin', 'refs/heads/main')).stdout)?.[1];
    const head = (await git('rev-parse', 'HEAD')).stdout.trim();
    if (!remote || !SHA.test(head)) return null;
    if (remote === head) return { behind: 0 };
    // The remote commit is known locally: count exactly. Unknown: the remote has commits this checkout has not fetched.
    if ((await git('cat-file', '-e', `${remote}^{commit}`)).code !== 0) return { behind: null };
    const n = Number((await git('rev-list', '--count', `HEAD..${remote}`)).stdout.trim());
    return { behind: Number.isFinite(n) ? n : null };
  }
}
