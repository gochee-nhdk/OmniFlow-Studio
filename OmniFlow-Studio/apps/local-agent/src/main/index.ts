import { app, BrowserWindow } from 'electron';
import { join, resolve, dirname } from 'path';
import { mkdirSync, appendFileSync, existsSync } from 'fs';
import { LogRedactor } from '@fm/security';
import { registerAll, shutdownAutomationBrowser } from './ipc/index';

// 1. Detect portable data root directory (check process.env.PORTABLE_EXECUTABLE_DIR, process.env.OMNIFLOW_PORTABLE_DATA, or fallback to local ./data in app directory / exe directory)
function detectPortableDataDir(): string {
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return join(resolve(process.env.PORTABLE_EXECUTABLE_DIR), 'data');
  }
  if (process.env.OMNIFLOW_PORTABLE_DATA) {
    return resolve(process.env.OMNIFLOW_PORTABLE_DATA);
  }
  if (process.env.APP_DATA_DIR) {
    return resolve(process.env.APP_DATA_DIR);
  }
  if (process.env.PORTABLE_DATA_DIR) {
    return resolve(process.env.PORTABLE_DATA_DIR);
  }
  const appOrExeDir = app.isPackaged
    ? dirname(process.execPath)
    : process.cwd();
  return join(appOrExeDir, 'data');
}

const portableDataDir = detectPortableDataDir();

// Ensure portable root directory exists early
try {
  mkdirSync(portableDataDir, { recursive: true });
} catch {
  // Directory may already exist
}

// 2. Call app.setPath('userData', portableDataDir) before app.whenReady() so all Chromium, Electron, cookies, caches, IndexedDB, etc. live in ./data.
try {
  app.setPath('userData', portableDataDir);
} catch {
  // Ignore if unable to set path
}

// 3. Expose process.env.APP_DATA_DIR = portableDataDir
process.env.APP_DATA_DIR = portableDataDir;
process.env.PORTABLE_DATA_DIR = portableDataDir;

function log(msg: string): void {
  try {
    const logDir = join(portableDataDir, 'logs');
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
log(`Portable data directory configured at: ${portableDataDir}`);

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
// 4. Ensure DATA_DIR, DB_PATH (fmauto.sqlite), logDir, Temp downloadDir, and userDataDir all reside inside portableDataDir.
const DATA_DIR = existsSync(join(portableDataDir, 'fm-auto-ops', 'fmauto.sqlite'))
  ? join(portableDataDir, 'fm-auto-ops')
  : portableDataDir;
const DB_PATH = existsSync(join(portableDataDir, 'fm-auto-ops', 'fmauto.sqlite'))
  ? join(portableDataDir, 'fm-auto-ops', 'fmauto.sqlite')
  : join(portableDataDir, 'fmauto.sqlite');

function ensureDataDir(): void {
  mkdirSync(portableDataDir, { recursive: true });
  if (DATA_DIR !== portableDataDir) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  mkdirSync(join(portableDataDir, 'logs'), { recursive: true });
  mkdirSync(join(portableDataDir, 'Temp'), { recursive: true });
  log(`Data directory ensured: ${DATA_DIR}`);
  log(`Database path: ${DB_PATH}`);
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

  // Always open maximized immediately
  mainWindow.maximize();

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
    log('ready-to-show event fired: maximizing and showing window');
    mainWindow?.maximize();
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
