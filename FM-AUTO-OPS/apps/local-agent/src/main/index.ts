import { app, BrowserWindow } from 'electron';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { registerAll } from './ipc/index';

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

let mainWindow: BrowserWindow | null = null;
const DATA_DIR = join(app.getPath('userData'), 'fm-auto-ops');
const DB_PATH = join(DATA_DIR, 'fmauto.sqlite');

function ensureDataDir(): void {
  mkdirSync(DATA_DIR, { recursive: true });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'FM AUTO OPS',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    titleBarStyle: 'default',
    show: false,
  });

  if (process.env['NODE_ENV'] === 'development' || !app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173').catch(() => {
      // If dev server isn't running yet, fallback
      mainWindow?.loadFile(join(__dirname, '../../../web/dist/index.html')).catch(() => null);
    });
  } else {
    mainWindow.loadFile(join(__dirname, '../../../web/dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  mainWindow.on('close', (event) => {
    event.preventDefault();
    mainWindow?.hide();
  });
}

app.whenReady().then(() => {
  ensureDataDir();
  registerAll(DB_PATH);
  createWindow();
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  // Stay resident in background on Windows
});

app.on('before-quit', () => {
  if (mainWindow) {
    mainWindow.destroy();
  }
});
