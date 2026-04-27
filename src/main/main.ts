import 'dotenv/config';
import { app, BrowserWindow, dialog, Menu, shell } from 'electron';
import path from 'path';
import { initDatabase, getDb } from './database';
import { registerIpcHandlers } from './ipc';
import { autoUpdater } from 'electron-updater';
import { processRecurringTemplates } from './services/recurring-processor';
import { runNotificationChecks } from './services/notification-engine';
import { runAlertRules } from './crons/alerts';
import { initQueue, connectWebSocket } from './sync';

const isDev = process.env.NODE_ENV === 'development';
let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#0a0a0a',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // SECURITY: sandbox the main renderer too — preload runs with the
      // limited Electron API surface, and the renderer cannot require Node
      // modules even if a preload bug leaks something. webSecurity stays on
      // (default) so file:// fetches and CORS are enforced.
      sandbox: true,
    },
  });

  // SECURITY: Block any in-app navigation to a non-app origin. Without this
  // an injected link or stale redirect could pull the renderer to an
  // attacker-controlled origin while keeping it inside the Electron window
  // (which has IPC access via the preload bridge).
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = url.startsWith('http://localhost:5173')
      || url.startsWith('file://')
      || url.startsWith('devtools://');
    if (!allowed) {
      event.preventDefault();
      shell.openExternal(url).catch(() => {});
    }
  });
  // SECURITY: Force window.open / target=_blank to open in the OS browser
  // rather than a child Electron window (which would inherit nodeIntegration
  // settings unless explicitly overridden).
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function buildMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        ...(isDev ? [{ role: 'toggleDevTools' as const }] : []),
        { type: 'separator' as const },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' as const },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { role: 'close' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Auto-updater ──────────────────────────────────────────────
// Silent auto-update: downloads in background, installs on quit.
// No prompts, no interruptions. User always gets the latest version.
function setupAutoUpdater() {
  if (isDev) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    console.log(`Update available: v${info.version} — downloading silently...`);
    mainWindow?.webContents.send('update:downloading', info.version);
  });

  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('update:progress', Math.round(progress.percent));
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`Update v${info.version} downloaded — will install on next quit.`);
    mainWindow?.webContents.send('update:ready', info.version);
  });

  autoUpdater.on('error', (err) => {
    console.error('Auto-update error:', err);
  });

  // Check on launch (after 3s), then every 2 hours
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 3000);

  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 2 * 60 * 60 * 1000);
}

// ── Background Services ────────────────────────────────────
let recurringInterval: ReturnType<typeof setInterval> | null = null;
let notificationInterval: ReturnType<typeof setInterval> | null = null;
let alertRulesInterval: ReturnType<typeof setInterval> | null = null;

function startBackgroundServices() {
  // Run immediately on startup (non-blocking)
  setTimeout(() => {
    try {
      const recurResult = processRecurringTemplates();
      console.log(`Recurring processor: ${recurResult.processed} templates processed, ${recurResult.invoicesCreated} invoices, ${recurResult.expensesCreated} expenses`);
    } catch (err) {
      console.error('Recurring processor startup error:', err);
    }

    try {
      const notifResult = runNotificationChecks();
      console.log(`Notification engine: ${notifResult.overdueNotifications} overdue, ${notifResult.budgetAlerts} budget alerts, ${notifResult.reconciliationAlerts} reconciliation alerts`);
    } catch (err) {
      console.error('Notification engine startup error:', err);
    }

    try {
      const { getDb } = require('./database');
      runAlertRules(getDb());
    } catch (err) {
      console.error('Alert rules startup error:', err);
    }
  }, 2000);

  // Recurring templates: check every 60 minutes
  recurringInterval = setInterval(() => {
    try {
      processRecurringTemplates();
    } catch (err) {
      console.error('Recurring processor interval error:', err);
    }
  }, 60 * 60 * 1000);

  // Notification checks: every 30 minutes
  notificationInterval = setInterval(() => {
    try {
      runNotificationChecks();
    } catch (err) {
      console.error('Notification engine interval error:', err);
    }
  }, 30 * 60 * 1000);

  // Alert rules: every 24 hours (nightly)
  alertRulesInterval = setInterval(() => {
    try {
      const { getDb } = require('./database');
      runAlertRules(getDb());
    } catch (err) {
      console.error('Alert rules interval error:', err);
    }
  }, 24 * 60 * 60 * 1000);
}

function stopBackgroundServices() {
  if (recurringInterval) {
    clearInterval(recurringInterval);
    recurringInterval = null;
  }
  if (notificationInterval) {
    clearInterval(notificationInterval);
    notificationInterval = null;
  }
  if (alertRulesInterval) {
    clearInterval(alertRulesInterval);
    alertRulesInterval = null;
  }
}

app.whenReady().then(() => {
  try {
    initDatabase();
    registerIpcHandlers();
  } catch (err: any) {
    console.error('Failed to initialize:', err);
    dialog.showErrorBox('Startup Error', err.message || String(err));
  }
  // Sync client — init queue before createWindow to avoid race with IPC handlers
  const dbInstance = require('./database').getDb();
  buildMenu();
  createWindow();
  setupAutoUpdater();
  startBackgroundServices();
  initQueue(dbInstance);
  connectWebSocket((event) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;

    if (event.type === 'invoice:paid') {
      const { invoiceId, companyId, amount, stripePaymentId } = event as any;
      try {
        dbInstance.prepare(`UPDATE invoices SET status = 'paid' WHERE id = ?`).run(invoiceId);
        win.webContents.send('sync:invoice-paid', { invoiceId, companyId, amount, stripePaymentId });
      } catch (e) {
        console.error('Failed to apply remote payment:', e);
      }
    }

    if (event.type === 'notification:create') {
      win.webContents.send('notification:push', event);
    }
  });
});

app.on('window-all-closed', () => {
  stopBackgroundServices();
  if (process.platform !== 'darwin') app.quit();
});

// Flush WAL and close DB cleanly before the process exits (covers macOS Cmd+Q
// and Windows/Linux close — fires before window-all-closed on quit).
app.on('before-quit', () => {
  try {
    const db = getDb();
    db.pragma('optimize');
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
  } catch (_) {
    // DB may already be closed or not yet initialized — safe to ignore
  }
});

app.on('activate', () => {
  if (mainWindow === null && app.isReady()) createWindow();
});
