// node machine/scan.mjs [roots...] [--json <file>]
// Walks the disk, runs the junk detectors, renders machine-map.html via ./page.mjs.
process.env.UV_THREADPOOL_SIZE ||= '64'; // must be set before the first async fs call
const fs = await import('node:fs/promises');
const fsSync = await import('node:fs');
const os = await import('node:os');
const path = await import('node:path');
const { execFile } = await import('node:child_process');
const { walk, buildTree } = await import('./lib/walk.mjs');
const { detectAll, realGit, realProbe, realListInstalledApps } = await import('./lib/detectors.mjs');

const args = process.argv.slice(2);
let jsonOut = null;
const rootArgs = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--json') jsonOut = args[++i];
  else rootArgs.push(args[i]);
}
if (args.includes('--json') && !jsonOut) {
  console.error('--json needs a file path');
  process.exit(2);
}

function fixedDrives() {
  return new Promise((resolve) => {
    execFile('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | % DeviceID"],
      { windowsHide: true }, (err, out) => resolve(err ? [] : String(out).split(/\s+/).filter((d) => /^[A-Za-z]:$/.test(d)).map((d) => `${d}\\`)));
  });
}

const t0 = Date.now();
const drives = await fixedDrives();
const roots = rootArgs.length ? rootArgs.map((r) => path.resolve(r)) : drives;
if (!roots.length) {
  console.error('No roots: pass paths, or run on Windows where fixed drives can be listed.');
  process.exit(2);
}

const mb = (n) => (n / 1e9).toFixed(1);
const res = await walk(roots, {
  onProgress: (p) => console.error(`[scan] ${p.files} files, ${mb(p.bytes)} GB, ${p.dir}`),
});
console.error(`[scan] walk done: ${res.files} files, ${mb(res.bytes)} GB; running detectors`);

const home = os.homedir();
const env = {
  home,
  tmp: os.tmpdir(),
  localAppData: process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'),
  appData: process.env.APPDATA || path.join(home, 'AppData', 'Roaming'),
  windir: process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows',
  drives,
  probe: realProbe,
  idx: res.idx,
  sizeOf: res.sizeOf,
  git: realGit,
  listInstalledApps: realListInstalledApps,
};
const junk = await detectAll(env);

const rootInfo = [];
for (const r of res.rootNodes) {
  let total = null;
  let free = null;
  try {
    const s = await fs.statfs(r.p);
    total = s.blocks * s.bsize;
    free = s.bavail * s.bsize;
  } catch { /* unknown */ }
  rootInfo.push({ path: r.p, total, free });
}

const data = {
  version: 1,
  generatedAt: new Date().toISOString(),
  host: os.hostname(),
  durationMs: Date.now() - t0,
  roots: rootInfo,
  skipped: res.skipped,
  tree: buildTree(res.rootNodes, junk),
  junk,
};

if (jsonOut) {
  fsSync.writeFileSync(jsonOut, JSON.stringify(data), 'utf8');
  console.error(`[scan] JSON written: ${jsonOut}`);
}

let renderPage;
try {
  ({ renderPage } = await import('./page.mjs'));
} catch (e) {
  if (e?.code !== 'ERR_MODULE_NOT_FOUND') throw e; // a broken page.mjs must surface as-is
  console.error(`machine/page.mjs is missing, so no HTML was written.${jsonOut ? ` Raw data is in ${jsonOut}.` : ' Re-run with --json <file> to keep the data.'}`);
  process.exit(1);
}
const out = path.join(os.tmpdir(), 'machine-map.html');
fsSync.writeFileSync(out, renderPage(data), 'utf8');
console.log(out);
console.error(`[scan] done in ${((Date.now() - t0) / 1000).toFixed(1)} s, ${res.files} files, ${junk.length} junk items`);
