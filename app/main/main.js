// Electron entry: single instance, security switches, wires MonitorService and IpcRouter to the two windows.
import { app, clipboard, ipcMain, Menu, nativeTheme, Notification, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { MonitorService } from '../core/monitor-service.js';
import { CoreError } from '../core/errors.js';
import { execRunner } from '../core/fixes/apply-repo-fix.js';
import { NotificationPolicy } from '../core/notification-policy.js';
import { SettingsStore } from '../core/settings-store.js';
import { AutoUpdater } from '../core/updater.js';
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
    onDone: (r) => toast(policy.updated(r, Object.fromEntries(updater.steps.map((s) => [s.id, s.label])))),
  });
  const monitor = new MonitorService({ outDir, repo: REPO, runner, sourceDeps, policy, updater });
  const stripFile = path.join(outDir, 'strip.json');
  const strip = new StripWindow({
    load: () => { try { return JSON.parse(fs.readFileSync(stripFile, 'utf8')); } catch { return null; } },
    save: (pos) => { try { fs.writeFileSync(stripFile, JSON.stringify(pos)); } catch { /* position memory is a convenience */ } },
  });
  const main = new MainWindow(() => monitor.getViewFileUrl());
  const log = (line) => console.log(line);

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
      'settings:set': (patch) => { const s = settings.set(patch); nativeTheme.themeSource = s.theme; return s; },
    },
  });

  app.on('second-instance', () => main.open());
  app.on('window-all-closed', () => {}); // the strip is the app; closing Main must not quit
  app.on('before-quit', () => monitor.stop());
  app.on('web-contents-created', (_e, wc) => wc.on('will-attach-webview', (ev) => ev.preventDefault()));

  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('Claude Monitor'); // toasts need an app id on Windows
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    Menu.setApplicationMenu(null);
    router.register();
    let last = null;
    let relaunching = false;
    monitor.onChange((status) => {
      strip.send('status:changed', status);
      main.send('status:changed', status);
      toast(policy.decide(last, status, monitor.optimizer.findings()) ?? policy.digest(status, monitor.optimizer.findings()));
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
