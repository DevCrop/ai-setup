// Disk walker: builds a full in-memory directory tree (files are only summed), then prunes it for the page.
import fs from 'node:fs/promises';
import path from 'node:path';

export const ART_NAMES = new Set(['node_modules', '.venv', 'venv', 'dist', 'build', '.next', 'target']);
const PROJECT_MARKERS = new Set(['package.json', 'pyproject.toml', 'cargo.toml']);

// Case-insensitive on Windows; used for every path comparison.
export const pkey = (p) => (process.platform === 'win32' ? path.normalize(p).toLowerCase() : path.normalize(p));

function limiter(max) {
  let active = 0;
  const q = [];
  const next = () => {
    while (active < max && q.length) {
      active++;
      const { fn, res, rej } = q.shift();
      fn().then(res, rej).finally(() => { active--; next(); });
    }
  };
  return (fn) => new Promise((res, rej) => { q.push({ fn, res, rej }); next(); });
}

/**
 * Walk roots with bounded concurrency. Never throws on unreadable entries.
 * Returns { rootNodes, skipped, files, bytes, idx, sizeOf }.
 * Internal node: { name, p, s, m, ms, kids, proj, art }
 *   s = subtree bytes, m = newest file mtime, ms = newest mtime excluding artifact subtrees.
 */
export async function walk(roots, { concurrency = 64, onProgress, progressMs = 2000, bigBytes = 100 * 1024 * 1024 } = {}) {
  const lim = limiter(concurrency);
  const skipped = { unreadable: 0, reparse: 0 };
  const idx = { gitFiles: [], repos: [], artifacts: [], files: [], big: [] };
  const linked = new Set();
  const st = { files: 0, bytes: 0, dir: '' };
  const timer = onProgress ? setInterval(() => onProgress({ ...st }), progressMs) : null;
  timer?.unref();

  async function visit(node, inArt) {
    st.dir = node.p;
    let ents;
    try {
      ents = await lim(() => fs.readdir(node.p, { withFileTypes: true }));
    } catch {
      skipped.unreadable++;
      return;
    }
    const dirs = [];
    const files = [];
    for (const e of ents) {
      if (e.isSymbolicLink()) { skipped.reparse++; continue; }
      const lower = e.name.toLowerCase();
      if (e.isDirectory()) {
        if (lower === '.git') { node.proj = true; idx.repos.push(node.p); }
        dirs.push(e);
      } else if (e.isFile()) {
        if (PROJECT_MARKERS.has(lower)) node.proj = true;
        if (lower === '.git') { node.proj = true; idx.gitFiles.push(node.p); }
        files.push(e);
      }
    }
    let own = 0;
    let ownM = 0;
    await Promise.all([
      ...files.map((e) => lim(async () => {
        const fp = path.join(node.p, e.name);
        try {
          const s = await fs.lstat(fp, { bigint: true });
          if (s.isSymbolicLink()) { skipped.reparse++; return; }
          const mt = Number(s.mtimeMs);
          if (mt > ownM) ownM = mt;
          st.files++;
          // Hard links (pnpm stores, WinSxS) are counted once: later links to the same dev:ino add no bytes.
          let size = Number(s.size);
          if (s.nlink > 1n) {
            const id = `${s.dev}:${s.ino}`;
            if (linked.has(id)) size = 0;
            else linked.add(id);
          }
          own += size;
          st.bytes += size;
          const ext = path.extname(e.name).toLowerCase();
          if (size >= bigBytes) idx.big.push({ path: fp, size, mtime: mt });
          if (size && (ext === '.dmp' || ext === '.vhdx')) idx.files.push({ path: fp, size, mtime: mt });
        } catch {
          skipped.unreadable++;
        }
      })),
      ...dirs.map((e) => {
        const isArt = ART_NAMES.has(e.name.toLowerCase());
        const kid = { name: e.name, p: path.join(node.p, e.name), s: 0, m: 0, ms: 0, kids: [], proj: false, art: isArt };
        node.kids.push(kid);
        if (isArt && !inArt) idx.artifacts.push({ node: kid, parent: node });
        return visit(kid, inArt || isArt);
      }),
    ]);
    node.s = own;
    node.m = ownM;
    node.ms = ownM;
    for (const k of node.kids) {
      node.s += k.s;
      if (k.m > node.m) node.m = k.m;
      if (!k.art && k.ms > node.ms) node.ms = k.ms;
    }
  }

  const rootNodes = [];
  try {
    for (const r of roots) {
      const p = path.resolve(r);
      const node = { name: p, p, s: 0, m: 0, ms: 0, kids: [], proj: false, art: false };
      rootNodes.push(node);
    }
    await Promise.all(rootNodes.map((n) => visit(n, false)));
  } finally {
    if (timer) clearInterval(timer);
  }

  return { rootNodes, skipped, files: st.files, bytes: st.bytes, idx, sizeOf: makeSizeOf(rootNodes) };
}

/** Look up an internal node by absolute path: returns {s, m, ms, node} or null if outside the walked roots. */
export function makeSizeOf(rootNodes) {
  return (p) => {
    const k = pkey(p);
    const root = rootNodes.find((r) => {
      const rk = pkey(r.p);
      return k === rk || k.startsWith(rk.endsWith(path.sep) ? rk : rk + path.sep);
    });
    if (!root) return null;
    let node = root;
    const rest = k === pkey(root.p) ? [] : path.relative(root.p, path.resolve(p)).split(path.sep);
    for (const part of rest) {
      const pk = pkey(part);
      node = node.kids.find((c) => pkey(c.name) === pk);
      if (!node) return null;
    }
    return { s: node.s, m: node.m, ms: node.ms, node };
  };
}

/** Contract tree: synthetic "PC" root, depth limit, 0.1%/40-children pruning, junk paths kept at full depth. */
export function buildTree(rootNodes, junk = [], { depth = 5, minFrac = 0.001, maxKids = 40 } = {}) {
  const junkIdx = new Map();
  const anc = new Set();
  junk.forEach((j, i) => {
    const k = pkey(j.path);
    if (!junkIdx.has(k)) junkIdx.set(k, []);
    junkIdx.get(k).push(i);
    for (let d = path.dirname(path.normalize(j.path)); ; d = path.dirname(d)) {
      anc.add(pkey(d));
      if (path.dirname(d) === d) break;
    }
  });

  function conv(node, d, rootS) {
    const k = pkey(node.p);
    const out = { n: node.name, p: node.p, s: node.s, m: node.m };
    const j = junkIdx.get(k);
    if (j) out.j = j;
    if (!(d < depth || anc.has(k)) || !node.kids.length) return out;
    const sorted = [...node.kids].sort((a, b) => b.s - a.s);
    const c = [];
    let restN = 0;
    let restS = 0;
    let restM = 0;
    sorted.forEach((kid, i) => {
      const kk = pkey(kid.p);
      if ((i < maxKids && kid.s > 0 && kid.s >= minFrac * rootS) || anc.has(kk) || junkIdx.has(kk)) {
        c.push(conv(kid, d + 1, rootS));
      } else {
        restN++;
        restS += kid.s;
        if (kid.m > restM) restM = kid.m;
      }
    });
    if (restN) c.push({ n: `(기타 ${restN}개)`, p: null, s: restS, m: restM });
    c.sort((a, b) => b.s - a.s);
    if (c.length) out.c = c;
    return out;
  }

  const c = rootNodes.map((r) => conv(r, 0, r.s)).sort((a, b) => b.s - a.s);
  return { n: 'PC', p: '', s: c.reduce((t, x) => t + x.s, 0), m: c.reduce((t, x) => Math.max(t, x.m), 0), c };
}
