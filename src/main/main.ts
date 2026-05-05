import 'dotenv/config';
import { app, BrowserWindow, dialog, Menu, shell } from 'electron';
import path from 'path';
import { initDatabase, getDb } from './database';
import { registerIpcHandlers } from './ipc';
import { autoUpdater } from 'electron-updater';
import { processRecurringTemplates } from './services/recurring-processor';
import { runNotificationChecks } from './services/notification-engine';
import { runAlertRules } from './crons/alerts';
import { runOverdueCheck } from './crons/overdue-checker';
import { runTrashPurge } from './crons/trash-purge';
import { runIntegrityCheck, runVacuum } from './crons/integrity-check';
import { initQueue, connectWebSocket } from './sync';

const isDev = process.env.NODE_ENV === 'development';
let mainWindow: BrowserWindow | null = null;

// CONCURRENCY: enforce single-instance — two app instances racing on the same
// SQLite file conflicts despite WAL (only one writer allowed at a time), and
// cron timers/intervals would also double-fire.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// CONCURRENCY: only allow http(s) URLs through to the OS shell — blocks
// file://, mailto:, javascript:, etc. that could be used to exfiltrate or
// open arbitrary files. mailto is intentionally handled by dedicated handlers.
function safeOpenExternal(url: string): void {
  if (typeof url !== 'string') return;
  if (!/^https?:\/\//i.test(url)) return;
  shell.openExternal(url).catch(() => {});
}

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
      safeOpenExternal(url);
    }
  });
  // SECURITY: Force window.open / target=_blank to open in the OS browser
  // rather than a child Electron window (which would inherit nodeIntegration
  // settings unless explicitly overridden).
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    safeOpenExternal(url);
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

  // CONCURRENCY: broadcast updater status to ALL renderer windows, not just
  // mainWindow. If a second window is opened, it should still see the update
  // banner.
  const broadcast = (channel: string, payload: any) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send(channel, payload);
    }
  };

  autoUpdater.on('update-available', (info) => {
    console.log(`Update available: v${info.version} — downloading silently...`);
    broadcast('update:downloading', info.version);
  });

  autoUpdater.on('download-progress', (progress) => {
    broadcast('update:progress', Math.round(progress.percent));
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`Update v${info.version} downloaded — will install on next quit.`);
    broadcast('update:ready', info.version);
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
let overdueCheckInterval: ReturnType<typeof setInterval> | null = null;
let trashPurgeInterval: ReturnType<typeof setInterval> | null = null;
let integrityCheckInterval: ReturnType<typeof setInterval> | null = null;
let vacuumInterval: ReturnType<typeof setInterval> | null = null;
// CONCURRENCY: periodic WAL checkpoint — without this the -wal sidecar file
// can grow unbounded under heavy write load (auto-backup runs every 30s of
// activity but only checkpoints once on each backup).
let walCheckpointInterval: ReturnType<typeof setInterval> | null = null;

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

    // P1.7 — Auto-flip stale 'sent' invoices/bills to 'overdue' so PDFs
    // exported afterward render the OVERDUE stamp correctly. Runs at
    // startup + every 6 hours below.
    try {
      const overdueResult = runOverdueCheck();
      if (overdueResult.invoicesFlipped > 0 || overdueResult.billsFlipped > 0) {
        console.log(`Overdue checker: flipped ${overdueResult.invoicesFlipped} invoices and ${overdueResult.billsFlipped} bills to overdue across ${overdueResult.companiesScanned} companies`);
      }
      if (overdueResult.errors.length) console.warn('Overdue checker errors:', overdueResult.errors);
    } catch (err) {
      console.error('Overdue checker startup error:', err);
    }

    // P1.13 — Physically purge soft-deleted records older than the
    // retention window (default 30 days, per-company configurable).
    try {
      const purgeResult = runTrashPurge();
      if (purgeResult.totalPurged > 0) {
        console.log(`Trash purge: physically removed ${purgeResult.totalPurged} expired records across ${purgeResult.companiesScanned} companies`, purgeResult.byTable);
      }
      if (purgeResult.errors.length) console.warn('Trash purge errors:', purgeResult.errors);
    } catch (err) {
      console.error('Trash purge startup error:', err);
    }

    // P1.15+P1.16+P1.17 — Integrity check at startup (skipping the
    // expensive orphan scan; it runs nightly via the interval below).
    try {
      const ic = runIntegrityCheck({ skipOrphanScan: true });
      if (!ic.ok) {
        console.warn('[integrity] startup check found issues:', {
          schemaDrift: ic.schemaDrift,
          pragmaIntegrity: ic.pragmaIntegrity,
          fkViolations: ic.pragmaFkCheck.length,
        });
      }
    } catch (err) {
      console.error('Integrity check startup error:', err);
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

  // Auto-overdue checker: every 6 hours. More frequent than the
  // 24h alert cron because users print PDFs throughout the day —
  // a 6h cycle ensures the OVERDUE stamp appears by next print
  // session even if an invoice tipped over due-date midday.
  overdueCheckInterval = setInterval(() => {
    try {
      const r = runOverdueCheck();
      if (r.invoicesFlipped > 0 || r.billsFlipped > 0) {
        console.log(`Overdue checker (6h): ${r.invoicesFlipped} invoices, ${r.billsFlipped} bills flipped`);
      }
    } catch (err) {
      console.error('Overdue checker interval error:', err);
    }
  }, 6 * 60 * 60 * 1000);

  // Trash auto-purge: every 24 hours (nightly). Daily cadence is
  // sufficient since the retention window is days, not hours.
  trashPurgeInterval = setInterval(() => {
    try {
      const r = runTrashPurge();
      if (r.totalPurged > 0) {
        console.log(`Trash purge (24h): physically removed ${r.totalPurged} expired records`);
      }
    } catch (err) {
      console.error('Trash purge interval error:', err);
    }
  }, 24 * 60 * 60 * 1000);

  // P1.17 — Full integrity check nightly (every 24h). Includes the
  // expensive orphan-FK scan that we skip at startup. Surfaces issues
  // to console for now; future enhancement: emit a desktop notification.
  integrityCheckInterval = setInterval(() => {
    try {
      const ic = runIntegrityCheck();
      if (!ic.ok) {
        console.warn('[integrity] nightly check found issues:', {
          schemaDrift: ic.schemaDrift,
          orphanCount: Object.keys(ic.orphans).length,
          fkViolations: ic.pragmaFkCheck.length,
          ms: ic.durationMs,
        });
      }
    } catch (err) {
      console.error('Integrity check interval error:', err);
    }
  }, 24 * 60 * 60 * 1000);

  // P1.17 — VACUUM weekly. Heavier op (rewrites the whole DB file)
  // so we don't run it daily. Reclaims space and rebalances B-tree
  // pages after lots of deletes/updates. 7d × 24h = 604800000ms.
  vacuumInterval = setInterval(() => {
    try {
      const r = runVacuum();
      if (r.ok) {
        const reclaimed = Math.max(0, r.sizeBefore - r.sizeAfter);
        console.log(`[vacuum] weekly: ${reclaimed} bytes reclaimed (${r.sizeBefore} → ${r.sizeAfter})`);
      } else if (r.error) {
        console.warn('[vacuum] failed:', r.error);
      }
    } catch (err) {
      console.error('Vacuum interval error:', err);
    }
  }, 7 * 24 * 60 * 60 * 1000);

  // CONCURRENCY: WAL checkpoint every 5 minutes to bound -wal file growth.
  // TRUNCATE mode resets the WAL to zero bytes if no readers are mid-txn.
  walCheckpointInterval = setInterval(() => {
    try {
      getDb().pragma('wal_checkpoint(TRUNCATE)');
    } catch (err) {
      // DB may be reinitializing — safe to skip a tick
    }
  }, 5 * 60 * 1000);
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
  if (overdueCheckInterval) {
    clearInterval(overdueCheckInterval);
    overdueCheckInterval = null;
  }
  if (trashPurgeInterval) {
    clearInterval(trashPurgeInterval);
    trashPurgeInterval = null;
  }
  if (integrityCheckInterval) {
    clearInterval(integrityCheckInterval);
    integrityCheckInterval = null;
  }
  if (vacuumInterval) {
    clearInterval(vacuumInterval);
    vacuumInterval = null;
  }
  if (walCheckpointInterval) {
    clearInterval(walCheckpointInterval);
    walCheckpointInterval = null;
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
    // CONCURRENCY: broadcast push events to ALL open windows so multi-window
    // sessions stay in sync. Previously only the first window got notified.
    const allWindows = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
    if (allWindows.length === 0) return;

    if (event.type === 'invoice:paid') {
      const { invoiceId, companyId, amount, stripePaymentId } = event as any;
      try {
        dbInstance.prepare(`UPDATE invoices SET status = 'paid' WHERE id = ?`).run(invoiceId);
        for (const w of allWindows) {
          w.webContents.send('sync:invoice-paid', { invoiceId, companyId, amount, stripePaymentId });
        }
      } catch (e) {
        console.error('Failed to apply remote payment:', e);
      }
    }

    if (event.type === 'notification:create') {
      for (const w of allWindows) {
        w.webContents.send('notification:push', event);
      }
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
