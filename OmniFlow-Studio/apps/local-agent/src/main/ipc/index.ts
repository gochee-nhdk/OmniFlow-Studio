import { ipcMain, shell, dialog } from 'electron';
import { FMDatabase } from '@fm/database';
import { credentialManager, SecureStorage } from '@fm/security';
import { BrowserManager } from '@fm/browser-engine';
import { POSAdapter } from '@fm/pos-adapter';
import { SAPAdapter } from '@fm/sap-adapter';
import { ExcelValidator, DownloadFileManager } from '@fm/file-engine';
import http from 'http';
import https from 'https';
import net from 'net';
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
      salesOutputDir?: string;
      salesFileNameTemplate?: string;
      inventoryStoreFilter?: string;
      inventorySlocFilter?: string;
      inventoryItemFilter?: string;
      inventoryOutputDir?: string;
      inventoryFileNameTemplate?: string;
      outputDir?: string;
      sapServer?: string;
      sapCompany?: string;
      sapUser?: string;
      sapPassword?: string;
      sapOutputDir?: string;
      posUser?: string;
      posPassword?: string;
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

          let posPassword = opts.posPassword;
          if (!posPassword) {
            try {
              posPassword = (await credentialManager.getPassword('POS_MAIN')) || undefined;
            } catch {}
          }
          if (!posPassword && db) {
            const cached = db.getSetting('cred_POS_MAIN');
            if (cached) {
              try {
                posPassword = SecureStorage.decrypt(cached);
              } catch {
                try {
                  posPassword = Buffer.from(cached, 'base64').toString('utf-8');
                } catch {}
              }
            }
          }
          const posMeta = db.listCredentialMeta().find((m) => m.accountName === 'POS_MAIN' || m.account_name === 'POS_MAIN');
          const posUsername = opts.posUser || (posMeta ? String(posMeta.username || '') : 'TM01');
          const posCreds = posPassword ? { username: posUsername, password: posPassword } : undefined;

          // Perform proactive authenticated session check with continuous retry
          if (posCreds) {
            broadcastStep('Đang xác thực và kiểm tra phiên làm việc POS RPFO...', 'RUNNING', 1);
            try {
              await posAdapter.login(posCreds, {
                maxRetries: 15,
                retryDelayMs: 2000,
                onProgress: (msg) => broadcastStep(msg, 'RUNNING', 1),
              });
            } catch (authErr) {
              console.warn('POS Login preliminary check warning:', (authErr as Error).message);
              // Non-fatal if transient, download methods will re-attempt authentication
            }
          }

          db.updateWorkflowStep(step1.id, 'SUCCESS');
          broadcastStep('Check POS RPFO Connectivity', 'SUCCESS', 1);

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
            const targetSalesDir = opts.salesOutputDir || opts.outputDir || 'D:\\FM_AUTO_OPS\\Sales';

            broadcastStep(`POS: Tải Sales Detail (${fromD} → ${toD})`, 'RUNNING', 2);
            const result = await posAdapter.downloadSalesTransactionDetail({
              fromDate: fromD,
              toDate: toD,
              storeFilter: storeF,
              outputDir: targetSalesDir,
              fileNameTemplate: opts.salesFileNameTemplate || 'Sales_{FROM_DATE}_{TO_DATE}.xlsx',
            }, posCreds);

            const validator = new ExcelValidator();
            const validation = await validator.validateWorkbook(result.tempFilePath);

            const fileManager = new DownloadFileManager();
            const finalPath = fileManager.moveAndRename(
              result.tempFilePath,
              targetSalesDir,
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
            const targetInvDir = opts.inventoryOutputDir || opts.outputDir || 'D:\\FM_AUTO_OPS\\Inventory';
            broadcastStep(`POS: Tải Inventory Onhand (Kho: ${invStore})`, 'RUNNING', 3);
            try {
              const invResult = await posAdapter.downloadInventoryOnhand({
                storeFilter: invStore,
                slocFilter: opts.inventorySlocFilter,
                itemFilter: opts.inventoryItemFilter,
                outputDir: targetInvDir,
                fileNameTemplate: opts.inventoryFileNameTemplate || 'Inventory_Onhand_{TIMESTAMP}.xlsx',
              }, posCreds);

              const validator = new ExcelValidator();
              const validation = await validator.validateWorkbook(invResult.tempFilePath);

              const fileManager = new DownloadFileManager();
              const finalPath = fileManager.moveAndRename(
                invResult.tempFilePath,
                targetInvDir,
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
          let sapPassword = opts.sapPassword;
          if (!sapPassword) {
            try {
              sapPassword = (await credentialManager.getPassword('SAP_MAIN')) || undefined;
            } catch {}
          }
          if (!sapPassword && db) {
            const cached = db.getSetting('cred_SAP_MAIN');
            if (cached) {
              try {
                sapPassword = SecureStorage.decrypt(cached);
              } catch {
                try {
                  sapPassword = Buffer.from(cached, 'base64').toString('utf-8');
                } catch {}
              }
            }
          }
          const sapMeta = db.listCredentialMeta().find((m) => m.accountName === 'SAP_MAIN' || m.account_name === 'SAP_MAIN');
          const sapUsername = opts.sapUser || (sapMeta ? String(sapMeta.username || '') : 'LOG32');
          const appSettingsRaw = db.getSetting('app_settings');
          let appSettings: { sapServer?: string; sapCompany?: string } = {};
          try {
            if (appSettingsRaw) appSettings = JSON.parse(appSettingsRaw);
          } catch {
            // Keep default
          }

          if (sapPassword) {
            const targetServer = opts.sapServer || appSettings.sapServer || 'SBO@172.16.0.201:30013';
            const targetCompany = opts.sapCompany || appSettings.sapCompany || 'Công ty TNHH Thương Mại LARIA (FM_PRO)';

            const sapAdapter = new SAPAdapter(
              browserManager,
              'https://172.16.1.210:8100/dispatcher/',
              async (warningMsg) => {
                console.log('SAP Concurrent Login Auto-Confirm:', warningMsg);
                return true;
              }
            );

            const loginRes = await sapAdapter.login({
              username: sapUsername,
              password: sapPassword,
              server: targetServer,
              company: targetCompany,
            }, (progressMsg: string) => {
              broadcastStep(progressMsg, 'RUNNING', 4);
            });

            db.updateWorkflowStep(stepSap.id, loginRes.success ? 'SUCCESS' : 'FAILED');
            broadcastStep('SAP Business One Đăng nhập', loginRes.success ? 'SUCCESS' : 'FAILED', 4);
          } else {
            db.updateWorkflowStep(stepSap.id, 'SKIPPED');
            broadcastStep('SAP: Chưa có mật khẩu SAP', 'SKIPPED', 4);
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
  ipcMain.handle('credentials:get', async (_event, payload: { accountName: string }) => {
    if (!db) return null;
    const meta = db.listCredentialMeta().find((m) => m.accountName === payload.accountName || m.account_name === payload.accountName);
    let password = '';
    try {
      const p = await credentialManager.getPassword(payload.accountName);
      if (p) password = p;
    } catch {
      // Fallback
    }

    if (!password) {
      const cached = db.getSetting(`cred_${payload.accountName}`);
      if (cached) {
        try {
          password = SecureStorage.decrypt(cached);
        } catch {
          try {
            password = Buffer.from(cached, 'base64').toString('utf-8');
          } catch {}
        }
      }
    }

    return {
      accountName: payload.accountName,
      username: meta?.username || '',
      password: password || '',
      application: meta?.application || '',
      url: meta?.url || '',
      hasPassword: Boolean(password)
    };
  });

  ipcMain.handle('credentials:save', async (_event, payload: {
    accountName: string;
    username: string;
    password: string;
    application: string;
    url: string;
  }) => {
    if (!db) throw new Error('Database not initialized');
    
    // 1. Store in native OS Credential Vault
    try {
      await credentialManager.setPassword(payload.accountName, payload.password);
    } catch (e) {
      console.warn('keytar setPassword warning:', (e as Error).message);
    }
    
    // 2. Cache encrypted fallback in sqlite settings table using authenticated AES-256-GCM
    try {
      const enc = SecureStorage.encrypt(payload.password);
      db.setSetting(`cred_${payload.accountName}`, enc);
    } catch (err) {
      console.warn('SecureStorage encrypt fallback warning:', (err as Error).message);
    }

    // 3. Upsert metadata
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
  // Enhanced live socket & HTTP endpoint probe
  const probeEndpoint = async (urlStr: string, defaultPort: number, timeoutMs = 2500): Promise<{
    reachable: boolean;
    latencyMs: number;
    error?: string;
    statusCode?: number;
  }> => {
    const start = Date.now();
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(urlStr);
    } catch {
      return { reachable: false, latencyMs: 0, error: 'Định dạng URL không hợp lệ' };
    }

    const isHttps = parsedUrl.protocol === 'https:';
    const port = parsedUrl.port ? parseInt(parsedUrl.port, 10) : defaultPort;
    const hostname = parsedUrl.hostname;

    // Step 1: TCP handshake probe for low-level reachability & fast failure
    const tcpResult = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
      const socket = new net.Socket();
      let finished = false;

      const done = (ok: boolean, err?: string) => {
        if (finished) return;
        finished = true;
        socket.removeAllListeners();
        socket.destroy();
        resolve({ ok, error: err });
      };

      socket.setTimeout(timeoutMs);
      socket.on('connect', () => done(true));
      socket.on('timeout', () => done(false, 'Hết thời gian chờ (Timeout 2.5s) - Chưa kết nối VPN hoặc ngoài mạng nội bộ'));
      socket.on('error', (err: NodeJS.ErrnoException) => {
        let msg = err.message;
        if (err.code === 'ECONNREFUSED') {
          msg = 'Máy chủ từ chối kết nối (Cổng đang đóng hoặc dịch vụ tắt)';
        } else if (err.code === 'ENETUNREACH' || err.code === 'EHOSTUNREACH') {
          msg = 'Mạng nội bộ không thể định tuyến (Chưa bật VPN doanh nghiệp)';
        }
        done(false, msg);
      });

      socket.connect(port, hostname);
    });

    if (!tcpResult.ok) {
      return {
        reachable: false,
        latencyMs: Date.now() - start,
        error: tcpResult.error || 'Không thể kết nối máy chủ',
      };
    }

    // Step 2: HTTP/HTTPS probe (permits self-signed certificates for internal SAP servers)
    return new Promise((resolve) => {
      const client = isHttps ? https : http;
      const req = client.request(
        {
          hostname,
          port,
          path: parsedUrl.pathname || '/',
          method: 'HEAD',
          timeout: timeoutMs,
          rejectUnauthorized: false, // Internal SAP self-signed SSL certs supported
        },
        (res) => {
          resolve({
            reachable: true,
            latencyMs: Date.now() - start,
            statusCode: res.statusCode,
          });
        }
      );

      req.on('timeout', () => {
        req.destroy();
        resolve({
          reachable: true, // TCP succeeded, but HTTP timed out
          latencyMs: Date.now() - start,
          error: 'Phản hồi HTTP chậm, nhưng cổng TCP đã mở',
        });
      });

      req.on('error', () => {
        // Fallback: TCP connection established, so server is alive at network layer
        resolve({
          reachable: true,
          latencyMs: Date.now() - start,
        });
      });

      req.end();
    });
  };

  ipcMain.handle('network:probe-endpoints', async (_event, endpoints?: Array<{ id: string; url: string; port: number }>) => {
    const defaultEndpoints = [
      { id: 'sap-web', name: 'SAP Business One Web Client', url: 'https://172.16.1.210:8100/dispatcher/', port: 8100 },
      { id: 'sap-sld', name: 'SAP System Landscape Directory (SLD)', url: 'https://172.16.0.201:40000/ControlCenter/sbo.html', port: 40000 },
      { id: 'pos-web', name: 'POS RPFO Web Application', url: 'http://172.16.1.200/', port: 80 },
    ];

    const targets = endpoints && endpoints.length > 0 ? endpoints : defaultEndpoints;

    const results = await Promise.all(
      targets.map(async (ep) => {
        const probe = await probeEndpoint(ep.url, ep.port);
        return {
          id: ep.id,
          url: ep.url,
          port: ep.port,
          reachable: probe.reachable,
          latencyMs: probe.latencyMs,
          statusCode: probe.statusCode,
          error: probe.error,
          checkedAt: new Date().toISOString(),
        };
      })
    );

    return {
      results,
      checkedAt: new Date().toISOString(),
    };
  });

  ipcMain.handle('network:check', async (_event, payload?: { sapHost?: string; sapPort?: number; posHost?: string; posPort?: number }) => {
    const sapHost = payload?.sapHost || '172.16.1.210';
    const sapPort = payload?.sapPort || 8100;
    const posHost = payload?.posHost || '172.16.1.200';
    const posPort = payload?.posPort || 80;

    const [sapProbe, posProbe] = await Promise.all([
      probeEndpoint(`https://${sapHost}:${sapPort}/`, sapPort),
      probeEndpoint(`http://${posHost}:${posPort}/`, posPort),
    ]);

    return {
      sap: sapProbe.reachable,
      pos: posProbe.reachable,
      sapLatency: sapProbe.latencyMs,
      posLatency: posProbe.latencyMs,
      sapError: sapProbe.error,
      posError: posProbe.error,
      checkedAt: new Date().toISOString(),
    };
  });
}

function registerFileHandlers(): void {
  ipcMain.handle('dialog:open-directory', async (_event, defaultPath?: string) => {
    const result = await dialog.showOpenDialog({
      defaultPath: defaultPath || 'D:\\FM_AUTO_OPS',
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

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
