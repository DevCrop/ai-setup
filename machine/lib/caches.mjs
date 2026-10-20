// Shared by scan.mjs and clean.mjs so plan paths match what the cleaner re-resolves.
import path from 'node:path';

const W = path.win32;
export const CACHE_TOOLS = ['npm', 'pnpm', 'yarn', 'pip', 'uv', 'bun', 'nuget', 'gradle'];

// resolve: fixed read-only argv that prints the real cache dir; fallback: official default location.
const SPEC = {
  npm: { resolve: ['npm', 'config', 'get', 'cache'], fallback: (e) => W.join(e.localAppData || '', 'npm-cache') },
  pnpm: { resolve: ['pnpm', 'store', 'path'], fallback: (e) => W.join(e.localAppData || '', 'pnpm', 'store') },
  yarn: { resolve: ['yarn', 'cache', 'dir'], fallback: (e) => W.join(e.localAppData || '', 'Yarn', 'Cache') },
  pip: { resolve: ['pip', 'cache', 'dir'], fallback: (e) => W.join(e.localAppData || '', 'pip', 'cache') },
  uv: { resolve: ['uv', 'cache', 'dir'], fallback: (e) => W.join(e.localAppData || '', 'uv', 'cache') },
  bun: { resolve: ['bun', 'pm', 'cache'], fallback: (e) => W.join(e.home, '.bun', 'install', 'cache') },
  nuget: { fallback: (e) => W.join(e.home, '.nuget', 'packages') },
  gradle: { fallback: (e) => W.join(e.home, '.gradle', 'caches') },
};

/**
 * @param {string} tool one of CACHE_TOOLS
 * @param {{probe: (argv:string[]) => Promise<{code:number, stdout:string}>, env: {home:string, localAppData?:string}}} o
 * @returns {Promise<string|null>} absolute path, or null for an unknown tool / unusable env
 */
export async function resolveCacheDir(tool, { probe, env }) {
  const spec = Object.hasOwn(SPEC, tool) ? SPEC[tool] : null;
  if (!spec) return null;
  if (spec.resolve) {
    try {
      const r = await probe(spec.resolve);
      const line = (r?.stdout || '').split(/\r?\n/).map((l) => l.trim()).find(Boolean);
      if (r?.code === 0 && /^[a-z]:[\\/]/i.test(line || '')) return line;
    } catch { /* tool missing: use the default */ }
  }
  if (!env?.home || (!env.localAppData && !['bun', 'nuget', 'gradle'].includes(tool))) return null;
  return spec.fallback(env);
}
