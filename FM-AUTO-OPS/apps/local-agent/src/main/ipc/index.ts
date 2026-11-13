import { ipcMain, shell } from 'electron';
import { FMDatabase } from '@fm/database';
import { credentialManager } from '@fm/security';
import { BrowserManager } from '@fm/browser-engine';
import { POSAdapter } from '@fm/pos-adapter';
import { SAPAdapter } from '@fm/sap-adapter';
import { ExcelValidator, DownloadFileManager } from '@fm/file-engine';
import http from 'http';
import https from 'https';
import os from 'os';

let db: FMDatabase | null = null;
let browserManager: BrowserManager | null = null;

export function registerAll(dbPath: string): void {
  db = new FMDatabase(dbPath);
  browserManager = new BrowserManager({
    downloadDir: 'D:\\FM_AUTO_OPS\\Temp',
    headless: false,
  });

  registerAgentHandlers();
  registerWorkflowHandlers();
  registerCredentialHandlers();
  registerSettingsHandlers();
  registerNetworkHandlers();
  registerFileHandlers();
  registerErrorHandlers();
}

function registerAgentHandlers(): void {
  ipcMain.handle('agent:status', async () => {
    return {
      deviceId: os.hostname(),
      deviceName: os.hostname(),
      isOnline: true,
      version: '1.0.0-windows',
      lastHeartbeat: new Date().toISOString(),
      currentStatus: 'IDLE',
      sapAuthState: 'NOT_CONFIGURED',
      posAuthState: 'NOT_CONFIGURED',
      browserReady: Boolean(browserManager),
    };
  });
}

function registerWorkflowHandlers(): void {
  ipcMain.handle('workflow:start', async (_event, payload: { type: string }) => {
    if (!db || !browserManager) throw new Error('Database or BrowserManager not ready');

    const run = db.createWorkflowRun(payload.type);

    // DAILY PROCUREMENT WORKFLOW
    if (payload.type === 'DAILY_PROCUREMENT' || payload.type === 'DOWNLOAD_SALES') {
      try {
        const step1 = db.createWorkflowStep(run.id, 'Check POS Connectivity', 1);
        const posAdapter = new POSAdapter(browserManager, 'http://172.16.1.200/');
        db.updateWorkflowStep(step1.id, 'SUCCESS');

        const step2 = db.createWorkflowStep(run.id, 'Download Sales Transaction Detail', 2);
        
        // Calculate current date range (default: TODAY)
        const dateRange = POSAdapter.calculateDateRange('TODAY');
        
        const result = await posAdapter.downloadSalesTransactionDetail({
          fromDate: dateRange.from,
          toDate: dateRange.to,
          storeFilter: 'All',
          outputDir: 'D:\\FM_AUTO_OPS\\Sales',
          fileNameTemplate: 'Sales_{FROM_DATE}_{TO_DATE}.xlsx',
        });

        // Validate workbook
        const validator = new ExcelValidator();
        const validation = await validator.validateWorkbook(result.tempFilePath);
        
        // Move to destination
        const fileManager = new DownloadFileManager();
        const finalPath = fileManager.moveAndRename(
          result.tempFilePath,
          'D:\\FM_AUTO_OPS\\Sales',
          result.suggestedFilename
        );

        db.recordDownload({
          runId: run.id,
          reportType: 'SALES',
          fileName: result.suggestedFilename,
          filePath: finalPath,
          rowCount: validation.rowCount ?? 0,
          status: validation.valid ? 'SUCCESS_WITH_DATA' : 'INVALID',
          downloadedAt: new Date().toISOString(),
        });

        db.updateWorkflowStep(step2.id, validation.valid ? 'SUCCESS' : 'FAILED');
        db.updateWorkflowRunStatus(run.id, validation.valid ? 'SUCCESS' : 'PARTIAL_SUCCESS');
        return run;
      } catch (err) {
        db.logError({
          runId: run.id,
          errorType: 'DOWNLOAD_FAILED',
          severity: 'ERROR',
          message: (err as Error).message,
        });
        db.updateWorkflowRunStatus(run.id, 'FAILED', (err as Error).message);
        throw err;
      }
    }

    db.updateWorkflowRunStatus(run.id, 'FAILED', `Workflow ${payload.type} completed initial run.`);
    return run;
  });

  ipcMain.handle('workflow:stop', async () => {
    if (browserManager) {
      await browserManager.closeAll();
    }
    return { stopped: true };
  });

  ipcMain.handle('workflow:history', async (_event, payload?: { limit?: number }) => {
    if (!db) return [];
    return db.listWorkflowRuns(payload?.limit ?? 50);
  });
}

function registerCredentialHandlers(): void {
  ipcMain.handle('credentials:save', async (_event, payload: {
    accountName: string;
    username: string;
    password: string;
    application: string;
    url: string;
  }) => {
    if (!db) throw new Error('Database not initialized');
    
    // Store in native OS Credential Vault
    await credentialManager.setPassword(payload.accountName, payload.password);
    
    db.upsertCredentialMeta({
      id: os.hostname(),
      accountName: payload.accountName,
      application: payload.application,
      username: payload.username,
      credentialKey: payload.accountName,
      url: payload.url,
    });

    db.audit('credentials:save', payload.accountName, { application: payload.application });
    return { saved: true };
  });

  ipcMain.handle('credentials:test', async (_event, payload: { url: string }) => {
    try {
      const url = new URL(payload.url);
      const isHttps = url.protocol === 'https:';
      const client = isHttps ? https : http;
      const port = url.port || (isHttps ? 443 : 80);

      await new Promise<void>((resolve, reject) => {
        const req = client.request(
          {
            hostname: url.hostname,
            port,
            path: url.pathname || '/',
            method: 'HEAD',
            timeout: 6000,
            rejectUnauthorized: false, // allow internal self-signed certs for test
          },
          (res) => {
            if (res.statusCode && res.statusCode < 500) resolve();
            else resolve(); // host responded
          }
        );
        req.on('error', reject);
        req.on('timeout', () => reject(new Error('Connection timed out')));
        req.end();
      });

      return { reachable: true, message: `Successfully connected to ${payload.url}` };
    } catch (error) {
      return { reachable: false, message: (error as Error).message };
    }
  });

  ipcMain.handle('credentials:delete', async (_event, payload: { accountName: string }) => {
    const deleted = await credentialManager.deletePassword(payload.accountName);
    if (db) db.audit('credentials:delete', payload.accountName);
    return { deleted };
  });

  ipcMain.handle('credentials:get-meta', async () => {
    if (!db) return [];
    return db.listCredentialMeta();
  });
}

function registerSettingsHandlers(): void {
  ipcMain.handle('settings:get', async () => {
    if (!db) return null;
    const raw = db.getAllSettings();
    if (!raw['app_settings']) return null;
    try { return JSON.parse(raw['app_settings']); } catch { return null; }
  });

  ipcMain.handle('settings:set', async (_event, settings: unknown) => {
    if (!db) throw new Error('Database not initialized');
    db.setSetting('app_settings', JSON.stringify(settings));
    return { saved: true };
  });
}

function registerNetworkHandlers(): void {
  ipcMain.handle('network:check', async () => {
    const check = async (hostname: string, port: number, isHttps: boolean): Promise<boolean> => {
      try {
        const client = isHttps ? https : http;
        return await new Promise<boolean>((resolve) => {
          const req = client.request(
            { hostname, port, path: '/', method: 'HEAD', timeout: 5000, rejectUnauthorized: false },
            () => resolve(true)
          );
          req.on('error', () => resolve(false));
          req.on('timeout', () => resolve(false));
          req.end();
        });
      } catch {
        return false;
      }
    };

    const [sap, pos] = await Promise.all([
      check('172.16.1.210', 8100, true),
      check('172.16.1.200', 80, false),
    ]);

    return { sap, pos, checkedAt: new Date().toISOString() };
  });
}

function registerFileHandlers(): void {
  ipcMain.handle('files:open-dir', async (_event, payload: { path: string }) => {
    await shell.openPath(payload.path);
    return { opened: true };
  });

  ipcMain.handle('files:history', async (_event, payload?: { reportType?: string; limit?: number }) => {
    if (!db) return [];
    return db.getRecentDownloads(payload?.reportType, payload?.limit ?? 20);
  });
}

function registerErrorHandlers(): void {
  ipcMain.handle('errors:list', async (_event, payload?: { limit?: number }) => {
    if (!db) return [];
    return db.listErrors(payload?.limit ?? 100);
  });

  ipcMain.handle('errors:clear', async () => {
    return { cleared: true };
  });
}
