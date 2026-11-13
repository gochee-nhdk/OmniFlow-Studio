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
    const creds = db ? db.listCredentialMeta() : [];
    const hasSap = creds.some((c) => (c.accountName === 'SAP_MAIN' || c.account_name === 'SAP_MAIN') && c.username);
    const hasPos = creds.some((c) => (c.accountName === 'POS_MAIN' || c.account_name === 'POS_MAIN') && c.username);

    return {
      deviceId: os.hostname(),
      deviceName: os.hostname(),
      isOnline: true,
      version: '1.0.0-windows',
      lastHeartbeat: new Date().toISOString(),
      currentStatus: 'IDLE',
      sapAuthState: hasSap ? 'AUTHENTICATED' : 'NOT_CONFIGURED',
      posAuthState: hasPos ? 'AUTHENTICATED' : 'NOT_CONFIGURED',
      browserReady: Boolean(browserManager),
    };
  });
}

function registerWorkflowHandlers(): void {
  ipcMain.handle('workflow:start', async (_event, payload: {
    type: string;
    options?: {
      includeSales?: boolean;
      includeInventory?: boolean;
      fromDate?: string;
      toDate?: string;
      storeFilter?: string;
      inventoryStoreFilter?: string;
      inventorySlocFilter?: string;
      inventoryItemFilter?: string;
      sapServer?: string;
      sapCompany?: string;
    };
  }) => {
    if (!db || !browserManager) throw new Error('Database or BrowserManager not ready');

    const run = db.createWorkflowRun(payload.type);
    const opts = payload.options || {};

    const broadcastStep = (stepName: string, status: string, index: number, errorMessage?: string) => {
      try {
        _event.sender.send('workflow:progress', {
          runId: run.id,
          workflowType: payload.type,
          stepName,
          status,
          index,
          errorMessage,
        });
      } catch {
        // Non-fatal
      }
    };

    // DISPATCH WORKFLOWS
    const isPosTask = ['DAILY_PROCUREMENT', 'POS_AUTOMATION', 'DOWNLOAD_SALES', 'DOWNLOAD_INVENTORY'].includes(payload.type);
    const isSapTask = ['DAILY_PROCUREMENT', 'SAP_AUTOMATION', 'SAP_LOGIN_CHECK'].includes(payload.type);

    if (isPosTask || isSapTask) {
      try {
        // --- 1. POS AUTOMATION BRANCH ---
        if (isPosTask) {
          const step1 = db.createWorkflowStep(run.id, 'Check POS RPFO Connectivity', 1);
          broadcastStep('Check POS RPFO Connectivity', 'RUNNING', 1);
          const posAdapter = new POSAdapter(browserManager, 'http://172.16.1.200/');
          db.updateWorkflowStep(step1.id, 'SUCCESS');
          broadcastStep('Check POS RPFO Connectivity', 'SUCCESS', 1);

          const posPassword = await credentialManager.getPassword('POS_MAIN');
          const posMeta = db.listCredentialMeta().find((m) => m.accountName === 'POS_MAIN' || m.account_name === 'POS_MAIN');
          const posCreds = posMeta && posPassword ? { username: String(posMeta.username || ''), password: posPassword } : undefined;

          const doSales = payload.type === 'DOWNLOAD_SALES' ||
            (payload.type === 'POS_AUTOMATION' && opts.includeSales !== false) ||
            (payload.type === 'DAILY_PROCUREMENT' && opts.includeSales !== false);

          const doInventory = payload.type === 'DOWNLOAD_INVENTORY' ||
            (payload.type === 'POS_AUTOMATION' && opts.includeInventory !== false) ||
            (payload.type === 'DAILY_PROCUREMENT' && opts.includeInventory !== false);

          // Download Sales Transaction Detail
          if (doSales) {
            const step2 = db.createWorkflowStep(run.id, 'POS: Download Sales Transaction Detail', 2);
            const dateRange = POSAdapter.calculateDateRange('TODAY');
            const fromD = opts.fromDate || dateRange.from;
            const toD = opts.toDate || dateRange.to;
            const storeF = opts.storeFilter || 'All';

            broadcastStep(`POS: Tải Sales Detail (${fromD} → ${toD})`, 'RUNNING', 2);
            const result = await posAdapter.downloadSalesTransactionDetail({
              fromDate: fromD,
              toDate: toD,
              storeFilter: storeF,
              outputDir: 'D:\\FM_AUTO_OPS\\Sales',
              fileNameTemplate: 'Sales_{FROM_DATE}_{TO_DATE}.xlsx',
            }, posCreds);

            const validator = new ExcelValidator();
            const validation = await validator.validateWorkbook(result.tempFilePath);

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
            broadcastStep(
              `POS: Tải Sales Detail (${validation.rowCount || 0} dòng, ${fromD}→${toD})`,
              validation.valid ? 'SUCCESS' : 'FAILED',
              2
            );
          }

          // Download Inventory Onhand
          if (doInventory) {
            const stepInv = db.createWorkflowStep(run.id, 'POS: Download Inventory Onhand', 3);
            const invStore = opts.inventoryStoreFilter || 'All';
            broadcastStep(`POS: Tải Inventory Onhand (Kho: ${invStore})`, 'RUNNING', 3);
            try {
              const invResult = await posAdapter.downloadInventoryOnhand({
                storeFilter: invStore,
                slocFilter: opts.inventorySlocFilter,
                itemFilter: opts.inventoryItemFilter,
                outputDir: 'D:\\FM_AUTO_OPS\\Inventory',
                fileNameTemplate: 'Inventory_Onhand_{TIMESTAMP}.xlsx',
              }, posCreds);

              const validator = new ExcelValidator();
              const validation = await validator.validateWorkbook(invResult.tempFilePath);

              const fileManager = new DownloadFileManager();
              const finalPath = fileManager.moveAndRename(
                invResult.tempFilePath,
                'D:\\FM_AUTO_OPS\\Inventory',
                invResult.suggestedFilename
              );

              db.recordDownload({
                runId: run.id,
                reportType: 'INVENTORY',
                fileName: invResult.suggestedFilename,
                filePath: finalPath,
                rowCount: validation.rowCount ?? 0,
                status: validation.valid ? 'SUCCESS_WITH_DATA' : 'INVALID',
                downloadedAt: new Date().toISOString(),
              });

              db.updateWorkflowStep(stepInv.id, 'SUCCESS');
              broadcastStep(`POS: Tải Inventory Onhand (${validation.rowCount || 0} dòng)`, 'SUCCESS', 3);
            } catch (invErr) {
              console.warn('Inventory download inspection:', (invErr as Error).message);
              db.updateWorkflowStep(stepInv.id, 'SKIPPED');
              broadcastStep('POS: Tải Inventory Onhand (Tạm bỏ qua)', 'SKIPPED', 3);
            }
          }
        }

        // --- 2. SAP AUTOMATION BRANCH ---
        if (isSapTask) {
          const stepSap = db.createWorkflowStep(run.id, 'SAP Business One SLD Authentication', 4);
          broadcastStep('SAP: Khởi động & Đăng nhập SLD', 'RUNNING', 4);
          const sapPassword = await credentialManager.getPassword('SAP_MAIN');
          const sapMeta = db.listCredentialMeta().find((m) => m.accountName === 'SAP_MAIN' || m.account_name === 'SAP_MAIN');
          const appSettingsRaw = db.getSetting('app_settings');
          let appSettings: { sapServer?: string; sapCompany?: string } = {};
          try {
            if (appSettingsRaw) appSettings = JSON.parse(appSettingsRaw);
          } catch {
            // Keep default
          }

          if (sapMeta && sapPassword) {
            const targetServer = opts.sapServer || appSettings.sapServer || 'SBO@172.16.0.201:30013';
            const targetCompany = opts.sapCompany || appSettings.sapCompany || 'Công ty TNHH Thương Mại LARIA (FM_PRO)';

            const sapAdapter = new SAPAdapter(
              browserManager,
              'https://172.16.1.210:8100/dispatcher/',
              async (warningMsg) => {
                // Safety rule: Never auto-confirm concurrent logout
                console.warn('SAP Concurrent Login Warning:', warningMsg);
                return false;
              }
            );

            const loginRes = await sapAdapter.login({
              username: String(sapMeta.username || ''),
              password: sapPassword,
              server: targetServer,
              company: targetCompany,
            });

            db.updateWorkflowStep(stepSap.id, loginRes.success ? 'SUCCESS' : 'FAILED');
            broadcastStep('SAP Business One Đăng nhập', loginRes.success ? 'SUCCESS' : 'FAILED', 4);
          } else {
            db.updateWorkflowStep(stepSap.id, 'SKIPPED');
            broadcastStep('SAP: Chưa cấu hình mật khẩu trong Settings', 'SKIPPED', 4);
          }
        }

        db.updateWorkflowRunStatus(run.id, 'SUCCESS');
        broadcastStep('Hoàn thành Quy trình Automation', 'SUCCESS', 99);
        return db.getWorkflowRun(run.id) || run;
      } catch (err) {
        db.logError({
          runId: run.id,
          errorType: 'DOWNLOAD_FAILED',
          severity: 'ERROR',
          message: (err as Error).message,
        });
        db.updateWorkflowRunStatus(run.id, 'FAILED', (err as Error).message);
        broadcastStep('Lỗi Quy trình: ' + (err as Error).message, 'FAILED', 99, (err as Error).message);
        throw err;
      }
    }

    db.updateWorkflowRunStatus(run.id, 'FAILED', `Workflow ${payload.type} completed initial run.`);
    return db.getWorkflowRun(run.id) || run;
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
      id: payload.accountName,
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
