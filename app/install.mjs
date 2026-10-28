// Installs Claude Monitor for the current Windows user: a Startup shortcut that runs the app at login, then starts it once.
// Usage: node app/install.mjs [--dry-run] [--no-start]   (bootstrap module "claude-monitor" runs it)
// Idempotent: npm ci runs only when Electron is missing or package-lock.json changed since the last install (stamp file),
// and then the running app is stopped first so npm can replace its files. The shortcut is rewritten in place.
// Remove: delete "Claude Monitor.lnk" in shell:startup.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
export const LINK_NAME = 'Claude Monitor.lnk';
export const LEGACY_LINKS = ['Claude monitor.lnk', 'claude-monitor.vbs']; // earlier status-bar starters this app replaces

// Pure: what to do, given the folders and what exists. Kept separate so it is testable without Windows.
export const STAMP = path.join('node_modules', '.claude-monitor-lock');

export function plan({ appDir, startupDir, exists, start, lockHash = null, stampHash = null }) {
  const exe = path.join(appDir, 'node_modules', 'electron', 'dist', 'electron.exe');
  const steps = [];
  if (!exists(exe) || lockHash !== stampHash) {
    steps.push({ kind: 'stop', target: exe }, { kind: 'deps', cwd: appDir, stamp: path.join(appDir, STAMP), lockHash });
  }
  for (const name of LEGACY_LINKS) {
    const p = path.join(startupDir, name);
    // Case-insensitive file systems see "Claude monitor.lnk" and LINK_NAME as one file; the new shortcut overwrites it instead.
    if (name.toLowerCase() !== LINK_NAME.toLowerCase() && exists(p)) steps.push({ kind: 'remove', path: p });
  }
  steps.push({ kind: 'shortcut', path: path.join(startupDir, LINK_NAME), target: exe, args: `"${appDir}"`, cwd: appDir });
  if (start) steps.push({ kind: 'start', target: exe, args: [appDir] });
  return { steps };
}

function startupDir() {
  return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
}

// Shortcuts need the Windows shell; values go in through environment variables, never into the script text.
function writeShortcut(s) {
  const ps = '$l=(New-Object -ComObject WScript.Shell).CreateShortcut($env:CM_LINK);$l.TargetPath=$env:CM_TARGET;$l.Arguments=$env:CM_ARGS;$l.WorkingDirectory=$env:CM_CWD;$l.Description="Claude Monitor";$l.Save()';
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { env: { ...process.env, CM_LINK: s.path, CM_TARGET: s.target, CM_ARGS: s.args, CM_CWD: s.cwd }, stdio: 'inherit' });
}

const sha = (file) => { try { return createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch { return null; } };
const readStamp = (file) => { try { return fs.readFileSync(file, 'utf8').trim(); } catch { return null; } };

// Stops only Electron processes started from this app's own electron.exe.
// Filters the full list: "Get-Process electron" with no match exits 1 even with -ErrorAction SilentlyContinue or Ignore.
export function stopApp(exe) {
  const ps = 'Get-Process | Where-Object { $_.Name -eq "electron" -and $_.Path -eq $env:CM_EXE } | Stop-Process -Force';
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { env: { ...process.env, CM_EXE: exe }, stdio: 'inherit' });
}

function installDeps(s) {
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--no-audit', '--no-fund'], { cwd: s.cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  // Electron 44 has no postinstall; its binary is fetched only by install.js. Without this the stamp would hide a missing electron.exe.
  execFileSync(process.execPath, [path.join(s.cwd, 'node_modules', 'electron', 'install.js')], { cwd: s.cwd, stdio: 'inherit' });
  if (s.lockHash) fs.writeFileSync(s.stamp, s.lockHash);
}

function main() {
  const argv = process.argv.slice(2);
  const dry = argv.includes('--dry-run');
  if (process.platform !== 'win32') { console.log('claude-monitor: Windows only, nothing to do'); return 0; }
  const p = plan({
    appDir: APP_DIR, startupDir: startupDir(), exists: fs.existsSync, start: !argv.includes('--no-start'),
    lockHash: sha(path.join(APP_DIR, 'package-lock.json')), stampHash: readStamp(path.join(APP_DIR, STAMP)),
  });
  const LINES = {
    stop: () => 'stop the running Claude Monitor', deps: () => 'npm ci in app/',
    remove: (s) => `remove old starter ${s.path}`, shortcut: (s) => `write shortcut ${s.path} -> ${s.target} ${s.args}`, start: () => 'start Claude Monitor',
  };
  for (const s of p.steps) {
    const line = LINES[s.kind](s);
    if (dry) { console.log(`[dry-run] ${line}`); continue; }
    if (s.kind === 'stop') stopApp(s.target);
    else if (s.kind === 'deps') installDeps(s);
    else if (s.kind === 'remove') fs.rmSync(s.path, { force: true });
    else if (s.kind === 'shortcut') writeShortcut(s);
    else spawn(s.target, s.args, { detached: true, stdio: 'ignore' }).unref();
    console.log(line);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = main();
