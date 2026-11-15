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
import fs from 'fs';
import path from 'path';
import { DEFAULT_ENTERPRISE_PROFILES, EnterpriseProfile } from '@fm/shared-types';

interface LocalAppConfig {
  sapUrl?: string;
  sapServer?: string;
  sapCompany?: string;
  sapUser?: string;
  posUrl?: string;
  posUser?: string;
  sapHost?: string;
  sapPort?: number;
  posHost?: string;
  posPort?: number;
  endpoints?: Array<{ id: string; name: string; url: string; port: number }>;
}

function loadLocalAppConfig(): LocalAppConfig {
  const possiblePaths = [
    path.join(process.cwd(), 'app-config.local.json'),
    path.join(process.cwd(), 'OmniFlow-Studio', 'app-config.local.json'),
    path.join(__dirname, '..', '..', '..', '..', 'app-config.local.json'),
    path.join(__dirname, '..', '..', '..', '..', '..', 'app-config.local.json'),
  ];
  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
      }
    } catch {}
  }
  return {};
}

const localConfig = loadLocalAppConfig();

let db: FMDatabase | null = null;
let browserManager: BrowserManager | null = null;
let lastKnownSapReachable: boolean = false;
let lastKnownPosReachable: boolean = false;

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
  registerEnterpriseHandlers();
}

function getMergedAppSettings(): Record<string, any> {
  if (!db) return {};
  try { return JSON.parse(db.getSetting('app_settings') || '{}'); } catch { return {}; }
}

function getEnterpriseProfiles(): EnterpriseProfile[] {
  if (!db) return [...DEFAULT_ENTERPRISE_PROFILES];
  try {
    const stored = db.getSetting('enterprise_profiles');
    if (stored) return JSON.parse(stored) as EnterpriseProfile[];
  } catch {}
  return [...DEFAULT_ENTERPRISE_PROFILES];
}

function registerEnterpriseHandlers(): void {
  ipcMain.handle('enterprise:list', async () => {
    if (!db) return { profiles: DEFAULT_ENTERPRISE_PROFILES, activeId: DEFAULT_ENTERPRISE_PROFILES[0]?.id };
    const profiles = getEnterpriseProfiles();
    let activeId = db.getSetting('active_enterprise_id') || profiles.find((profile) => profile.isActive)?.id || profiles[0]?.id;
    return { profiles, activeId };
  });
  ipcMain.handle('enterprise:get-active', async () => {
    const profiles = getEnterpriseProfiles();
    const activeId = db?.getSetting('active_enterprise_id') || profiles.find((profile) => profile.isActive)?.id;
    return profiles.find((profile) => profile.id === activeId) || profiles[0] || null;
  });
  ipcMain.handle('enterprise:save', async (_event, profile: Partial<EnterpriseProfile>) => {
    if (!db) throw new Error('Database not initialized');
    const profiles = getEnterpriseProfiles();
    const saved = { ...profile, id: profile.id || `enterprise-${Date.now()}`, updatedAt: new Date().toISOString() } as EnterpriseProfile;
    const next = profiles.some((item) => item.id === saved.id)
      ? profiles.map((item) => item.id === saved.id ? { ...item, ...saved } : item)
      : [...profiles, { ...saved, createdAt: new Date().toISOString() }];
    db.setSetting('enterprise_profiles', JSON.stringify(next));
    return saved;
  });
  ipcMain.handle('enterprise:delete', async (_event, payload: { id: string }) => {
    if (!db) throw new Error('Database not initialized');
    const profiles = getEnterpriseProfiles().filter((profile) => profile.id !== payload.id);
    db.setSetting('enterprise_profiles', JSON.stringify(profiles));
    if (db.getSetting('active_enterprise_id') === payload.id) db.setSetting('active_enterprise_id', profiles[0]?.id || '');
    return { deleted: true };
  });
  ipcMain.handle('enterprise:setActive', async (_event, payload: { id: string }) => {
    if (!db) throw new Error('Database not initialized');
    const profiles = getEnterpriseProfiles().map((profile) => ({ ...profile, isActive: profile.id === payload.id }));
    db.setSetting('enterprise_profiles', JSON.stringify(profiles));
    db.setSetting('active_enterprise_id', payload.id);
    return { activeId: payload.id };
  });
}

function registerAgentHandlers(): void {
  ipcMain.handle('agent:status', async () => {
    const creds = db ? db.listCredentialMeta() : [];
    const hasSap = creds.some((c) => (c.accountName === 'SAP_MAIN' || c.account_name === 'SAP_MAIN') && c.username);
    const hasPos = creds.some((c) => (c.accountName === 'POS_MAIN' || c.account_name === 'POS_MAIN') && c.username);

    // If credentials are configured but server is not reachable, report DISCONNECTED
    let sapAuthState: 'NOT_CONFIGURED' | 'DISCONNECTED' | 'AUTHENTICATED' = 'NOT_CONFIGURED';
    if (hasSap) {
      sapAuthState = lastKnownSapReachable ? 'AUTHENTICATED' : 'DISCONNECTED';
    }

    let posAuthState: 'NOT_CONFIGURED' | 'DISCONNECTED' | 'AUTHENTICATED' = 'NOT_CONFIGURED';
    if (hasPos) {
      posAuthState = lastKnownPosReachable ? 'AUTHENTICATED' : 'DISCONNECTED';
    }

    return {
      deviceId: os.hostname(),
      deviceName: os.hostname(),
      isOnline: true,
      version: '1.0.0-windows',
      lastHeartbeat: new Date().toISOString(),
      currentStatus: 'IDLE',
      sapAuthState,
      posAuthState,
      browserReady: Boolean(browserManager),
    };
  });
}

function registerWorkflowHandlers(): void {
  ipcMain.handle('workflow:start', async (_event, rawPayload: {
    type: string;
    payload?: Record<string, any>;
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
      sapUrl?: string;
      sapBaseUrl?: string;
      sapServer?: string;
      sapCompany?: string;
      sapUser?: string;
      sapPassword?: string;
      sapOutputDir?: string;
      posBaseUrl?: string;
      posUrl?: string;
      baseUrl?: string;
      posUser?: string;
      posPassword?: string;
      sapAutoTakeOverSession?: boolean;
    };
  }) => {
    if (!db || !browserManager) throw new Error('Database or BrowserManager not ready');

    const payload = rawPayload as typeof rawPayload & { options?: Record<string, any> };
    const incomingOpts = payload.options || payload.payload || {};
    const savedSettings = getMergedAppSettings();
    const profileList = getEnterpriseProfiles();
    const activeProfileId = db.getSetting('active_enterprise_id') || profileList.find((profile) => profile.isActive)?.id;
    const activeProfile = profileList.find((profile) => profile.id === activeProfileId) || profileList[0];
    const opts: Record<string, any> = {
      ...savedSettings,
      fromDate: savedSettings.posSalesFromDate,
      toDate: savedSettings.posSalesToDate,
      storeFilter: Array.isArray(savedSettings.posSelectedSalesStores) ? savedSettings.posSelectedSalesStores.join(',') : undefined,
      inventorySlocFilter: Array.isArray(savedSettings.posSelectedInvSlocs) ? savedSettings.posSelectedInvSlocs.join(',') : undefined,
      inventoryItemFilter: savedSettings.posInvItem,
      salesOutputDir: savedSettings.posSalesDir || (activeProfile?.exportPath ? path.join(activeProfile.exportPath, 'Sales') : undefined),
      salesFileNameTemplate: savedSettings.posSalesFileName || activeProfile?.namingTemplate,
      inventoryOutputDir: savedSettings.posInvDir || (activeProfile?.exportPath ? path.join(activeProfile.exportPath, 'Inventory') : undefined),
      inventoryFileNameTemplate: savedSettings.posInvFileName,
      sapServer: savedSettings.sapServer || activeProfile?.server,
      sapCompany: savedSettings.sapCompany || activeProfile?.companyName || activeProfile?.companySchema,
      sapOutputDir: savedSettings.sapDir || (activeProfile?.exportPath ? path.join(activeProfile.exportPath, 'SAP') : undefined),
      sapAutoTakeOverSession: savedSettings.sapAutoTakeOverSession ?? false,
      sapTargetModule: savedSettings.sapTargetModule || 'HOME',
      orgCode: activeProfile?.code || activeProfile?.companySchema || 'ORG',
      ...incomingOpts,
    };

    const run = db.createWorkflowRun(payload.type);

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
          const appSettingsRaw = db.getSetting('app_settings');
          let appSettings: { posBaseUrl?: string; posUrl?: string; sapUrl?: string; sapServer?: string; sapCompany?: string } = {};
          try {
            if (appSettingsRaw) appSettings = JSON.parse(appSettingsRaw);
          } catch {}

          const posMeta = db.listCredentialMeta().find((m) => m.accountName === 'POS_MAIN' || m.account_name === 'POS_MAIN');
          const targetPosUrl = opts.posBaseUrl || opts.posUrl || opts.baseUrl || activeProfile?.posUrl || appSettings.posBaseUrl || appSettings.posUrl || (posMeta?.url && posMeta.url.trim() ? posMeta.url : null) || process.env.POS_URL || localConfig.posUrl || 'http://pos.enterprise.example.com/';
          const posAdapter = new POSAdapter(browserManager, targetPosUrl);

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
                // Insecure base64 fallback eliminated
              }
            }
          }
          const defaultPosUser = process.env.POS_USER || localConfig.posUser || 'STORE_ADMIN';
          const posUsername = opts.posUser || (posMeta ? String(posMeta.username || '') : defaultPosUser);
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
            const targetSalesDir = opts.salesOutputDir || opts.outputDir || path.join(os.homedir(), 'Documents', 'OmniFlow_Reports', 'Sales');

            broadcastStep(`POS: Tải Sales Detail (${fromD} → ${toD})`, 'RUNNING', 2);
            const result = await posAdapter.downloadSalesTransactionDetail({
              fromDate: fromD,
              toDate: toD,
              storeFilter: storeF,
              outputDir: targetSalesDir,
              fileNameTemplate: opts.salesFileNameTemplate || 'Sales_{FROM_DATE}_{TO_DATE}.xlsx',
              orgCode: opts.orgCode,
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
            const targetInvDir = opts.inventoryOutputDir || opts.outputDir || path.join(os.homedir(), 'Documents', 'OmniFlow_Reports', 'Inventory');
            broadcastStep(`POS: Tải Inventory Onhand (Kho: ${invStore})`, 'RUNNING', 3);
            try {
              const invResult = await posAdapter.downloadInventoryOnhand({
                storeFilter: invStore,
                slocFilter: opts.inventorySlocFilter,
                itemFilter: opts.inventoryItemFilter,
                outputDir: targetInvDir,
                fileNameTemplate: opts.inventoryFileNameTemplate || 'Inventory_Onhand_{TIMESTAMP}.xlsx',
              orgCode: opts.orgCode,
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
                // Insecure base64 fallback eliminated
              }
            }
          }
          const sapMeta = db.listCredentialMeta().find((m) => m.accountName === 'SAP_MAIN' || m.account_name === 'SAP_MAIN');
          const defaultSapUser = process.env.SAP_USER || localConfig.sapUser || 'ERP_USER';
          const sapUsername = opts.sapUser || (sapMeta ? String(sapMeta.username || '') : defaultSapUser);
          const appSettingsRaw = db.getSetting('app_settings');
          let appSettings: { sapServer?: string; sapCompany?: string; sapUrl?: string } = {};
          try {
            if (appSettingsRaw) appSettings = JSON.parse(appSettingsRaw);
          } catch {
            // Keep default
          }

          if (sapPassword) {
            const defaultSapServer = process.env.SAP_SERVER || localConfig.sapServer || 'SBO@sap-cluster.enterprise.example.com:30013';
            const defaultSapCompany = process.env.SAP_COMPANY || localConfig.sapCompany || 'ACME Global Retail Corp (ACME_ERP)';
            const targetServer = opts.sapServer || appSettings.sapServer || defaultSapServer;
            const targetCompany = opts.sapCompany || appSettings.sapCompany || defaultSapCompany;
            const targetSapUrl = opts.sapUrl || opts.sapBaseUrl || activeProfile?.erpUrl || appSettings.sapUrl || (sapMeta?.url && sapMeta.url.trim() ? sapMeta.url : null) || process.env.SAP_URL || localConfig.sapUrl || 'https://erp.enterprise.example.com:8100/dispatcher/';

            const sapAdapter = new SAPAdapter(
              browserManager,
              targetSapUrl,
              async (warningMsg) => {
                console.log('SAP Concurrent Login Auto-Confirm:', warningMsg);
                return false;
              }
            );

            const loginRes = await sapAdapter.login({
              username: sapUsername,
              password: sapPassword,
              server: targetServer,
              company: targetCompany,
              autoTakeOverSession: opts.sapAutoTakeOverSession === true,
              targetModule: opts.sapTargetModule || 'HOME',
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
    let hasPassword = false;
    try {
      const p = await credentialManager.getPassword(payload.accountName);
      if (p) hasPassword = true;
    } catch {
      // Fallback
    }

    if (!hasPassword) {
      const cached = db.getSetting(`cred_${payload.accountName}`);
      if (cached) {
        try {
          const decrypted = SecureStorage.decrypt(cached);
          if (decrypted) hasPassword = true;
        } catch {
          // Insecure base64 fallback eliminated
        }
      }
    }

    return {
      accountName: payload.accountName,
      username: meta?.username || '',
      application: meta?.application || '',
      url: meta?.url || '',
      hasPassword
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

  ipcMain.handle('settings:set', async (_event, newSettings: unknown) => {
    if (!db) throw new Error('Database not initialized');
    let existingSettings: Record<string, any> = {};
    const raw = db.getAllSettings();
    if (raw['app_settings']) {
      try {
        existingSettings = JSON.parse(raw['app_settings']);
      } catch {}
    }
    const merged = typeof newSettings === 'object' && newSettings !== null
      ? { ...existingSettings, ...newSettings }
      : newSettings;
    db.setSetting('app_settings', JSON.stringify(merged));
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
    const defaultEndpoints = localConfig.endpoints || [
      { id: 'sap-web', name: 'SAP Business One Web Client', url: process.env.SAP_URL || localConfig.sapUrl || 'https://erp.enterprise.example.com:8100/dispatcher/', port: 8100 },
      { id: 'sap-sld', name: 'SAP System Landscape Directory (SLD)', url: process.env.SAP_SLD_URL || 'https://sld.enterprise.example.com:40000/ControlCenter/sbo.html', port: 40000 },
      { id: 'pos-web', name: 'POS RPFO Web Application', url: process.env.POS_URL || localConfig.posUrl || 'http://pos.enterprise.example.com/', port: 80 },
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
    const sapHost = payload?.sapHost || process.env.SAP_HOST || localConfig.sapHost || 'erp.enterprise.example.com';
    const sapPort = payload?.sapPort || (process.env.SAP_PORT ? parseInt(process.env.SAP_PORT, 10) : undefined) || localConfig.sapPort || 8100;
    const posHost = payload?.posHost || process.env.POS_HOST || localConfig.posHost || 'pos.enterprise.example.com';
    const posPort = payload?.posPort || (process.env.POS_PORT ? parseInt(process.env.POS_PORT, 10) : undefined) || localConfig.posPort || 80;

    const [sapProbe, posProbe] = await Promise.all([
      probeEndpoint(`https://${sapHost}:${sapPort}/`, sapPort),
      probeEndpoint(`http://${posHost}:${posPort}/`, posPort),
    ]);

    lastKnownSapReachable = sapProbe.reachable;
    lastKnownPosReachable = posProbe.reachable;

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
    db?.clearErrors();
    return { cleared: true };
  });
}
