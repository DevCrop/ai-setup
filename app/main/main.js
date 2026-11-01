// Electron entry: single instance, security switches, wires MonitorService and IpcRouter to the two windows.
import { app, clipboard, ipcMain, Menu, nativeTheme, Notification, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { MonitorService } from '../core/monitor-service.js';
import { CoreError } from '../core/errors.js';
import { execRunner } from '../core/fixes/apply-repo-fix.js';
import { NotificationPolicy } from '../core/notification-policy.js';
import { normHome, resolveHomes, SettingsStore, validHome } from '../core/settings-store.js';
import { AutoUpdater } from '../core/updater.js';
import { AppLog, errText } from '../core/app-log.js';
import { httpsJson } from '../core/sources/update-source.js';
import { IpcRouter } from './ipc-router.js';
import { StripWindow, MainWindow } from './windows.js';
import { gitBash } from './placement.js';

const REPO = path.resolve(import.meta.dirname, '..', '..');

const BASH = process.platform === 'win32' ? gitBash(process.env, fs.existsSync) : 'bash';
const runner = (file, args, opts) => execRunner(file === 'bash' ? BASH : file, args, opts);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  const outDir = app.getPath('userData');
  const appLog = new AppLog({ dir: path.join(outDir, 'logs') });
  // A background app has no console: anything unexpected goes to userData/logs/app.log, and the app keeps running.
  process.on('uncaughtException', (e) => appLog.error(`uncaught ${errText(e)}`));
  process.on('unhandledRejection', (e) => appLog.error(`unhandled rejection ${errText(e)}`));
  appLog.info(`start version=${app.getVersion()} electron=${process.versions.electron}`);
  const settings = new SettingsStore({ file: path.join(outDir, 'settings.json') });
  // One switch for every window and the monitor iframe: prefers-color-scheme follows themeSource.
  nativeTheme.themeSource = settings.get().theme;
  const policy = new NotificationPolicy({ file: path.join(outDir, 'notify-state.json'), settings: () => settings.get() });
  const sourceDeps = { runner, fetchJson: (url) => httpsJson(url), updateCheck: () => settings.get().updateCheck };
  const toast = (notice) => {
    if (!notice || !Notification.isSupported()) return;
    const n = new Notification({ ...notice, silent: true });
    n.on('click', () => main.open('opt'));
    n.show();
  };
  // Acts only on facts the update check found, so turning the check off also stops it.
  const updater = new AutoUpdater({
    file: path.join(outDir, 'update-state.json'), repo: REPO, runner,
    enabled: () => settings.get().autoUpdate && settings.get().updateCheck,
    applySetup: () => settings.get().applySetup,
    claudeHome: () => monitor.homes.claude,
    onDone: (r) => {
      appLog.info(`update done=${r.done.join(',') || '-'} failed=${r.failed.join(',') || '-'} restart=${r.restartNeeded} npm=${r.npmNeeded}`);
      toast(policy.updated(r, Object.fromEntries(updater.steps.map((s) => [s.id, s.label]))));
    },
  });
  const monitor = new MonitorService({ outDir, repo: REPO, homes: resolveHomes(settings.get()), refreshSec: settings.get().idleSec, runner, sourceDeps, policy, updater });
  let relaunching = false; // set once a restart is on its way, so a late status push cannot start a second one
  let seen = false; // main window on screen: refresh at the live period
  const pace = () => monitor.setRefreshSec(seen ? settings.get().liveSec : settings.get().idleSec);
  const stripFile = path.join(outDir, 'strip.json');
  const strip = new StripWindow({
    load: () => { try { return JSON.parse(fs.readFileSync(stripFile, 'utf8')); } catch { return null; } },
    save: (pos) => { try { fs.writeFileSync(stripFile, JSON.stringify(pos)); } catch { /* position memory is a convenience */ } },
  });
  const main = new MainWindow(() => monitor.getViewFileUrl(), (on) => { seen = on; pace(); });
  const log = (line) => appLog.warn(line);

  const quit = () => {
    if (monitor.optimizer.busyFindingId() || updater.running) throw new CoreError('FIX_BUSY');
    setImmediate(() => app.quit());
    return { quitting: true };
  };

  const stripMenu = Menu.buildFromTemplate([
    { label: '열기', click: () => main.open() },
    { label: '지금 새로 읽기', click: () => monitor.refresh() },
    { label: '오른쪽 아래로', click: () => strip.moveToCorner() },
    { label: '요약 복사', click: () => clipboard.writeText(monitor.summaryText()) },
    { type: 'separator' },
    { label: '끝내기', click: () => { try { quit(); } catch { /* a fix is running; keep the app */ } } },
  ]);

  const router = new IpcRouter({
    ipcMain,
    log,
    senderRole: (event) => (strip.owns(event) ? 'strip' : main.owns(event) ? 'main' : null),
    handlers: {
      'status:get': () => monitor.status(),
      'app:open-main': ({ tab }) => { main.open(tab); return { opened: true }; },
      'app:refresh': () => monitor.refresh(),
      'app:quit': quit,
      'app:strip-menu': () => { stripMenu.popup({ window: strip.win }); return { shown: true }; },
      'view:html': () => {
        const fileUrl = monitor.getViewFileUrl();
        if (!fileUrl) throw new CoreError('NO_SNAPSHOT');
        return { fileUrl, generatedAt: monitor.status().generatedAt };
      },
      'findings:list': () => {
        const { generatedAt } = monitor.optimizer;
        if (!generatedAt) throw new CoreError('NO_SNAPSHOT');
        return { generatedAt, findings: monitor.optimizer.list() };
      },
      'codex:detail': () => monitor.codexDetail(),
      'routines:detail': () => monitor.routinesDetail(),
      'history:list': () => ({ entries: monitor.history() }),
      'app:copy-summary': () => { clipboard.writeText(monitor.summaryText()); return { copied: true }; },
      'fix:preview': ({ findingId }) => monitor.optimizer.preview(findingId),
      'fix:apply': ({ findingId, previewId }) => monitor.optimizer.apply(findingId, previewId),
      'fix:restore': ({ findingId }) => monitor.optimizer.restore(findingId),
      'settings:get': () => settings.get(),
      'settings:set': (patch) => {
        const before = settings.get();
        for (const k of ['claudeHome', 'codexHome']) if (Object.hasOwn(patch, k)) patch[k] = normHome(patch[k]);
        const moved = ['claudeHome', 'codexHome'].some((k) => Object.hasOwn(patch, k) && patch[k] !== before[k]);
        // new folders mean new caches, journal paths and sources: a clean restart, never while a fix or update runs
        if (moved && (monitor.optimizer.busyFindingId() || updater.running)) throw new CoreError('FIX_BUSY');
        for (const k of ['claudeHome', 'codexHome']) if (Object.hasOwn(patch, k) && !validHome(k, patch[k])) throw new CoreError('BAD_FOLDER');
        const s = settings.set(patch);
        nativeTheme.themeSource = s.theme;
        pace();
        if (moved) { relaunching = true; appLog.info('folders changed, restarting'); setImmediate(() => { app.relaunch(); app.quit(); }); }
        return s;
      },
    },
  });

  app.on('second-instance', () => main.open());
  app.on('window-all-closed', () => {}); // the strip is the app; closing Main must not quit
  app.on('before-quit', () => monitor.stop());
  app.on('web-contents-created', (_e, wc) => wc.on('will-attach-webview', (ev) => ev.preventDefault()));
  // A crashed page is logged and reloaded, at most 3 times in 10 minutes so a page that crashes at load cannot spin.
  const reloads = [];
  app.on('render-process-gone', (_e, wc, d) => {
    appLog.error(`renderer gone reason=${d?.reason} code=${d?.exitCode} page=${strip.isAlive() && wc === strip.win.webContents ? 'strip' : main.isAlive() && wc === main.win.webContents ? 'main' : 'other'}`);
    const now = Date.now();
    while (reloads.length && now - reloads[0] > 600000) reloads.shift();
    if (d?.reason === 'clean-exit' || reloads.length >= 3 || wc.isDestroyed()) return;
    reloads.push(now);
    wc.reload();
  });
  app.on('child-process-gone', (_e, d) => { if (d?.reason !== 'clean-exit') appLog.warn(`child gone type=${d?.type} reason=${d?.reason}`); });

  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('Claude Monitor'); // toasts need an app id on Windows
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    Menu.setApplicationMenu(null);
    router.register();
    let last = null;
    monitor.onChange((status) => {
      strip.send('status:changed', status);
      main.send('status:changed', status);
      toast(policy.decide(last, status, monitor.optimizer.findings()) ?? policy.digest(status, monitor.optimizer.findings()));
      if (status.state !== last?.state && (status.state === 'error' || status.state === 'stale' || last?.state === 'error')) appLog.warn(`state ${last?.state ?? '-'} -> ${status.state}`);
      last = status;
      // New app code came in with a pull: restart while nobody is looking (main window closed, no fix or update running).
      if (!relaunching && updater.restartNeeded && !updater.status().npmNeeded && !main.isAlive() && !updater.running && !monitor.optimizer.busyFindingId()) {
        relaunching = true; // a late status push during quit must not start a second instance
        app.relaunch();
        app.quit();
      }
    });
    strip.create();
    monitor.start();
  });
}
