import { app, BrowserWindow, dialog, Menu } from 'electron';
import path from 'path';
import { initDatabase } from './database';
import { registerIpcHandlers } from './ipc';
import { autoUpdater } from 'electron-updater';

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
    },
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
function setupAutoUpdater() {
  if (isDev) return; // Skip in dev mode

  // Don't download automatically — ask user first
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    dialog
      .showMessageBox(mainWindow!, {
        type: 'info',
        title: 'Update Available',
        message: `Version ${info.version} is available.`,
        detail: 'Would you like to download and install it? The app will restart when the update is ready.',
        buttons: ['Download Update', 'Later'],
        defaultId: 0,
        cancelId: 1,
      })
      .then((result) => {
        if (result.response === 0) {
          autoUpdater.downloadUpdate();
          // Notify the renderer to show a progress indicator
          mainWindow?.webContents.send('update:downloading');
        }
      });
  });

  autoUpdater.on('update-downloaded', () => {
    dialog
      .showMessageBox(mainWindow!, {
        type: 'info',
        title: 'Update Ready',
        message: 'Update has been downloaded.',
        detail: 'The application will restart to apply the update.',
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
        cancelId: 1,
      })
      .then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
  });

  autoUpdater.on('error', (err) => {
    console.error('Auto-update error:', err);
    // Don't bother the user with update errors — just log them
  });

  // Check for updates 3 seconds after launch (non-blocking)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 3000);
}

app.whenReady().then(() => {
  try {
    initDatabase();
    registerIpcHandlers();
  } catch (err: any) {
    console.error('Failed to initialize:', err);
    dialog.showErrorBox('Startup Error', err.message || String(err));
  }
  buildMenu();
  createWindow();
  setupAutoUpdater();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
