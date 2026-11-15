import { app, BrowserWindow } from 'electron';
import { join } from 'path';
import { mkdirSync, appendFileSync, existsSync } from 'fs';
import { LogRedactor } from '@fm/security';
import { registerAll, shutdownAutomationBrowser } from './ipc/index';

function log(msg: string): void {
  try {
    const logDir = join(app.getPath('userData'), 'logs');
    const logFile = join(logDir, 'electron-main.log');
    mkdirSync(logDir, { recursive: true });
    const redacted = LogRedactor.redact(msg);
    appendFileSync(logFile, `[${new Date().toISOString()}] ${redacted}\n`);
  } catch {
    // Ignore logging errors
  }
}

process.on('uncaughtException', (error) => {
  log(`UNCAUGHT_EXCEPTION: ${error.stack || error.message}`);
});

process.on('unhandledRejection', (reason) => {
  log(`UNHANDLED_REJECTION: ${reason}`);
});

log('Electron main process starting up');

let isBrowserShutdownComplete = false;
let isBrowserShutdownInProgress = false;
app.on('before-quit', (event) => {
  if (isBrowserShutdownComplete || isBrowserShutdownInProgress) return;
  event.preventDefault();
  isBrowserShutdownInProgress = true;
  void shutdownAutomationBrowser().finally(() => {
    isBrowserShutdownComplete = true;
    app.quit();
  });
});

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  log('Another instance is already running. Focusing existing instance and quitting new process.');
  app.quit();
  process.exit(0);
}

let mainWindow: BrowserWindow | null = null;
const DATA_DIR = join(app.getPath('userData'), 'fm-auto-ops');
const DB_PATH = join(DATA_DIR, 'fmauto.sqlite');

function ensureDataDir(): void {
  mkdirSync(DATA_DIR, { recursive: true });
  log(`Data directory ensured: ${DATA_DIR}`);
}

function createWindow(): void {
  log('Creating main BrowserWindow...');
  const iconCandidate = join(__dirname, '../../../../assets/app-icon.ico');
  const iconPath = existsSync(iconCandidate) ? iconCandidate : '';

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'FM AUTO OPS',
    icon: existsSync(iconPath) ? iconPath : undefined,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    titleBarStyle: 'default',
    show: true, // Visible immediately — never hidden
  });

  const candidates = [
    join(__dirname, '../../../web/dist/index.html'),
    join(__dirname, '../../web/dist/index.html'),
    join(process.resourcesPath || '', 'web/dist/index.html'),
  ];
  const localHtmlPath = candidates.find(p => existsSync(p));
  log(`Loading HTML from: ${localHtmlPath}`);

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    log(`RENDERER_CONSOLE [lvl=${level}] ${message} (${sourceId}:${line})`);
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    log(`RENDERER_LOAD_FAIL [code=${errorCode}] ${errorDescription} url=${validatedURL}`);
  });

  if (process.env['VITE_DEV'] === 'true') {
    mainWindow.loadURL('http://localhost:5173').catch(() => {
      if (localHtmlPath) mainWindow?.loadFile(localHtmlPath).catch((err) => log(`LoadFile error: ${err.message}`));
    });
  } else if (localHtmlPath) {
    mainWindow.loadFile(localHtmlPath).catch((err) => log(`LoadFile error: ${err.message}`));
  } else {
    log('Application UI was not found in the packaged or development locations.');
  }

  // Ensure window is in front and active
  mainWindow.show();
  mainWindow.focus();

  mainWindow.once('ready-to-show', () => {
    log('ready-to-show event fired: showing window');
    mainWindow?.show();
    mainWindow?.focus();
  });

  mainWindow.on('closed', () => {
    log('mainWindow closed — quitting application process cleanly');
    mainWindow = null;
    app.quit();
  });
}

app.whenReady().then(() => {
  log('app.whenReady fired');
  try {
    ensureDataDir();
    log(`Registering IPC handlers with DB_PATH: ${DB_PATH}`);
    registerAll(DB_PATH);
    log('IPC handlers registered successfully');
    createWindow();
  } catch (err: unknown) {
    const error = err as Error;
    log(`FATAL error in whenReady: ${error.stack || error.message}`);
  }
});

app.on('second-instance', () => {
  log('second-instance triggered: restoring and focusing main window');
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else {
    log('mainWindow was destroyed or null on second-instance: recreating window');
    createWindow();
  }
});

app.on('window-all-closed', () => {
  log('All windows closed. Quitting app process.');
  app.quit();
});

app.on('before-quit', () => {
  log('App before-quit');
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy();
  }
});

app.on('will-quit', () => {
  log('App will-quit: exiting process cleanly');
  process.exit(0);
});
