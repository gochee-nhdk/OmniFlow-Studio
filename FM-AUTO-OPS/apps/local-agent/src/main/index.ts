import { app, BrowserWindow } from 'electron';
import { join } from 'path';
import { mkdirSync, appendFileSync } from 'fs';
import { registerAll } from './ipc/index';

const LOG_DIR = 'D:\\FM_AUTO_OPS\\Logs';
const LOG_FILE = join(LOG_DIR, 'electron-main.log');

function log(msg: string): void {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
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

  const localHtmlPath = join(__dirname, '../../../web/dist/index.html');
  log(`Loading HTML from: ${localHtmlPath}`);

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    log(`RENDERER_CONSOLE [lvl=${level}] ${message} (${sourceId}:${line})`);
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    log(`RENDERER_LOAD_FAIL [code=${errorCode}] ${errorDescription} url=${validatedURL}`);
  });

  if (process.env['VITE_DEV'] === 'true') {
    mainWindow.loadURL('http://localhost:5173').catch(() => {
      mainWindow?.loadFile(localHtmlPath).catch((err) => log(`LoadFile error: ${err.message}`));
    });
  } else {
    mainWindow.loadFile(localHtmlPath).catch((err) => log(`LoadFile error: ${err.message}`));
  }

  mainWindow.once('ready-to-show', () => {
    log('ready-to-show event fired: showing window');
    mainWindow?.show();
    mainWindow?.focus();

    mainWindow?.webContents.executeJavaScript(`
      ({
        title: document.title,
        bodyHTML: document.getElementById('root')?.innerHTML?.slice(0, 300),
        url: window.location.href
      })
    `).then(info => {
      log('RENDERER_DOM: ' + JSON.stringify(info));
      setTimeout(() => {
        mainWindow?.webContents.capturePage().then(img => {
          require('fs').writeFileSync('D:\\FM_AUTO_OPS\\Temp\\electron-ui.png', img.toPNG());
          log('Window screenshot captured successfully: D:\\FM_AUTO_OPS\\Temp\\electron-ui.png');
        }).catch(err => log('CapturePage error: ' + (err as Error).message));
      }, 500);
    }).catch(err => {
      log('EXEC_JS_ERR: ' + (err as Error).message);
    });
  });

  mainWindow.on('closed', () => {
    log('mainWindow closed');
    mainWindow = null;
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
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  log('All windows closed. Quitting app.');
  app.quit();
});

app.on('before-quit', () => {
  log('App before-quit');
  if (mainWindow) {
    mainWindow.destroy();
  }
});
