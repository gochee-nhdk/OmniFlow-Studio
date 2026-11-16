import { app, ipcMain, shell, dialog, safeStorage } from 'electron';
import { FMDatabase } from '@fm/database';
import { credentialManager, SecureStorage, createEncryptedVault, restoreEncryptedVault } from '@fm/security';
import { BrowserManager } from '@fm/browser-engine';
import { POSAdapter, parseFilterValues } from '@fm/pos-adapter';
import { SAPAdapter } from '@fm/sap-adapter';
import { ExcelValidator, DownloadFileManager } from '@fm/file-engine';
import http from 'http';
import https from 'https';
import net from 'net';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { EnterpriseProfile } from '@fm/shared-types';

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
    ...(process.env.APP_DATA_DIR ? [path.join(process.env.APP_DATA_DIR, 'app-config.local.json')] : []),
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

function getDefaultReportsDir(subDir: string): string {
  const baseDir = process.env.PORTABLE_EXECUTABLE_DIR || process.env.APP_DATA_DIR || process.cwd();
  return subDir ? path.join(baseDir, 'reports', subDir) : path.join(baseDir, 'reports');
}

const localConfig = loadLocalAppConfig();

let db: FMDatabase | null = null;
let browserManager: BrowserManager | null = null;
let activeWorkflowRunId: string | null = null;
let stopRequestedWorkflowRunId: string | null = null;
let lastKnownSapReachable: boolean = false;
let lastKnownPosReachable: boolean = false;

const SAFE_STORAGE_CREDENTIAL_PREFIX = 'electron-safe-storage:v1:';

function encryptLocalCredential(password: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return SAFE_STORAGE_CREDENTIAL_PREFIX + safeStorage.encryptString(password).toString('base64');
  }
  return SecureStorage.encrypt(password);
}

function decryptLocalCredential(stored: string): string {
  if (stored.startsWith(SAFE_STORAGE_CREDENTIAL_PREFIX)) {
    if (safeStorage.isEncryptionAvailable()) {
      try {
        const encrypted = Buffer.from(stored.slice(SAFE_STORAGE_CREDENTIAL_PREFIX.length), 'base64');
        return safeStorage.decryptString(encrypted);
      } catch {
        // Fall back to SecureStorage if DPAPI fails (e.g. when app folder is moved to another Windows machine)
        try {
          return SecureStorage.decrypt(stored.slice(SAFE_STORAGE_CREDENTIAL_PREFIX.length));
        } catch {
          return SecureStorage.decrypt(stored);
        }
      }
    }
    // If safeStorage is not available in this session, fall back to SecureStorage
    try {
      return SecureStorage.decrypt(stored.slice(SAFE_STORAGE_CREDENTIAL_PREFIX.length));
    } catch {
      return SecureStorage.decrypt(stored);
    }
  }
  // Backward compatibility for encrypted credentials saved by older app versions.
  return SecureStorage.decrypt(stored);
}

export function registerAll(dbPath: string): void {
  db = new FMDatabase(dbPath);
  const portableDataDir = process.env.APP_DATA_DIR || app.getPath('userData');
  const tempDownloadDir = path.join(portableDataDir, 'Temp');
  try {
    fs.mkdirSync(tempDownloadDir, { recursive: true });
  } catch {}

  browserManager = new BrowserManager({
    downloadDir: tempDownloadDir,
    userDataDir: portableDataDir,
    headless: false,
    allowCdpAttach: false,
    cdpPorts: [9222, 9223, 9229],
  });

  registerAgentHandlers();
  registerWorkflowHandlers();
  registerCredentialHandlers();
  registerSettingsHandlers();
  registerNetworkHandlers();
  registerFileHandlers();
  registerErrorHandlers();
  registerEnterpriseHandlers();
  registerVaultHandlers();
}

export async function shutdownAutomationBrowser(): Promise<void> {
  if (activeWorkflowRunId && browserManager) {
    stopRequestedWorkflowRunId = activeWorkflowRunId;
    await browserManager.closeAll();
    const deadline = Date.now() + 8000;
    while (activeWorkflowRunId && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  await browserManager?.shutdown();
}

function getMergedAppSettings(): Record<string, any> {
  if (!db) return {};
  try { return JSON.parse(db.getSetting('app_settings') || '{}'); } catch { return {}; }
}

function getEnterpriseProfiles(): EnterpriseProfile[] {
  if (!db) return [];
  try {
    const stored = db.getSetting('enterprise_profiles');
    if (stored) return JSON.parse(stored) as EnterpriseProfile[];
  } catch {}
  return [];
}

function registerEnterpriseHandlers(): void {
  ipcMain.handle('enterprise:list', async () => {
    if (!db) return { profiles: [], activeId: '' };
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

  ipcMain.handle('browser:enable-active-attach', async () => {
    try {
      const { exec } = await import('child_process');
      let channel = 'msedge';
      try {
        const { execSync } = await import('child_process');
        const regOut = execSync('reg query "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice" /v ProgId', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        if (/ChromeHTML/i.test(regOut)) channel = 'chrome';
      } catch {}
      const exe = channel === 'chrome' ? 'chrome.exe' : 'msedge.exe';
      exec(`start ${exe} --remote-debugging-port=9222 --restore-last-session`);
      return { success: true, message: `Đã kích hoạt chế độ gắn kết trình duyệt (${exe}) cổng 9222.` };
    } catch (e: any) {
      return { success: false, error: e?.message || String(e) };
    }
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
    if (activeWorkflowRunId) throw new Error('An automation is already running. Stop it and wait for it to finish first.');

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
      storeFilter: savedSettings.posSalesStoreFilterEnabled === false
        ? 'All'
        : [...new Set([
            ...(Array.isArray(savedSettings.posSelectedSalesStores) ? savedSettings.posSelectedSalesStores : []),
            ...parseFilterValues(savedSettings.posCustomSlocInput),
          ])].join(',') || 'All',
      inventorySlocFilter: [...new Set([
        ...(Array.isArray(savedSettings.posSelectedInvSlocs) ? savedSettings.posSelectedInvSlocs : []),
        ...parseFilterValues(savedSettings.posCustomSlocInput),
      ])].join(','),
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
    activeWorkflowRunId = run.id;
    stopRequestedWorkflowRunId = null;
    const assertNotStopped = () => {
      if (stopRequestedWorkflowRunId === run.id) throw new Error('Workflow stopped by user.');
    };

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
          assertNotStopped();
          const step1 = db.createWorkflowStep(run.id, 'Check POS RPFO Connectivity', 1);
          broadcastStep('Check POS RPFO Connectivity', 'RUNNING', 1);
          const appSettingsRaw = db.getSetting('app_settings');
          let appSettings: { posBaseUrl?: string; posUrl?: string; sapUrl?: string; sapServer?: string; sapCompany?: string } = {};
          try {
            if (appSettingsRaw) appSettings = JSON.parse(appSettingsRaw);
          } catch {}

          const posMeta = db.listCredentialMeta().find((m) => m.accountName === 'POS_MAIN' || m.account_name === 'POS_MAIN');
          const targetPosUrl = opts.posBaseUrl || opts.posUrl || opts.baseUrl || activeProfile?.posUrl || appSettings.posBaseUrl || appSettings.posUrl || (posMeta?.url && posMeta.url.trim() ? posMeta.url : null) || process.env.POS_URL || localConfig.posUrl || '';
          if (!targetPosUrl) throw new Error('Chưa cấu hình URL POS. Hãy nhập URL trong mục kết nối POS trước khi chạy automation.');
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
              posPassword = decryptLocalCredential(cached);
              } catch {
                // Insecure base64 fallback eliminated
              }
            }
          }
          const defaultPosUser = process.env.POS_USER || localConfig.posUser || '';
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
          assertNotStopped();

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
            const targetSalesDir = opts.salesOutputDir || opts.outputDir || getDefaultReportsDir('Sales');

            broadcastStep(`POS: Tải Sales Detail (${fromD} → ${toD})`, 'RUNNING', 2);
            const result = await posAdapter.downloadSalesTransactionDetail({
              fromDate: fromD,
              toDate: toD,
              storeFilter: storeF,
              outputDir: targetSalesDir,
              fileNameTemplate: opts.salesFileNameTemplate || 'Sales_{FROM_DATE}_{TO_DATE}.xlsx',
              orgCode: opts.orgCode,
            }, posCreds);
            assertNotStopped();

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
            assertNotStopped();
            const stepInv = db.createWorkflowStep(run.id, 'POS: Download Inventory Onhand', 3);
            const invStore = opts.inventoryStoreFilter || 'All';
            const targetInvDir = opts.inventoryOutputDir || opts.outputDir || getDefaultReportsDir('Inventory');
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
              if (stopRequestedWorkflowRunId === run.id) throw invErr;
              console.warn('Inventory download inspection:', (invErr as Error).message);
              db.updateWorkflowStep(stepInv.id, 'SKIPPED');
              broadcastStep('POS: Tải Inventory Onhand (Tạm bỏ qua)', 'SKIPPED', 3);
            }
          }
        }

        // --- 2. SAP AUTOMATION BRANCH ---
        if (isSapTask) {
          assertNotStopped();
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
                sapPassword = decryptLocalCredential(cached);
              } catch {
                // Insecure base64 fallback eliminated
              }
            }
          }
          const sapMeta = db.listCredentialMeta().find((m) => m.accountName === 'SAP_MAIN' || m.account_name === 'SAP_MAIN');
          const defaultSapUser = process.env.SAP_USER || localConfig.sapUser || '';
          const sapUsername = opts.sapUser || (sapMeta ? String(sapMeta.username || '') : defaultSapUser);
          const appSettingsRaw = db.getSetting('app_settings');
          let appSettings: { sapServer?: string; sapCompany?: string; sapUrl?: string } = {};
          try {
            if (appSettingsRaw) appSettings = JSON.parse(appSettingsRaw);
          } catch {
            // Keep default
          }

          if (sapPassword) {
            const defaultSapServer = process.env.SAP_SERVER || localConfig.sapServer || '';
            const defaultSapCompany = process.env.SAP_COMPANY || localConfig.sapCompany || '';
            const targetServer = opts.sapServer || appSettings.sapServer || defaultSapServer;
            const targetCompany = opts.sapCompany || appSettings.sapCompany || defaultSapCompany;
            const targetSapUrl = opts.sapUrl || opts.sapBaseUrl || activeProfile?.erpUrl || appSettings.sapUrl || (sapMeta?.url && sapMeta.url.trim() ? sapMeta.url : null) || process.env.SAP_URL || localConfig.sapUrl || '';
            if (!targetSapUrl) throw new Error('Chưa cấu hình URL SAP. Hãy nhập URL trong mục kết nối SAP trước khi chạy automation.');
            if (!targetServer || !targetCompany || !sapUsername) throw new Error('Thiếu Server, Company Database hoặc User ID SAP. Hãy hoàn tất cấu hình trước khi chạy automation.');

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
            assertNotStopped();

            db.updateWorkflowStep(stepSap.id, loginRes.success ? 'SUCCESS' : 'FAILED');
            broadcastStep('SAP Business One Đăng nhập', loginRes.success ? 'SUCCESS' : 'FAILED', 4);
          } else {
            db.updateWorkflowStep(stepSap.id, 'SKIPPED');
            broadcastStep('SAP: Chưa có mật khẩu SAP', 'SKIPPED', 4);
          }
        }

        assertNotStopped();
        db.updateWorkflowRunStatus(run.id, 'SUCCESS');
        broadcastStep('Hoàn thành Quy trình Automation', 'SUCCESS', 99);
        activeWorkflowRunId = null;
        stopRequestedWorkflowRunId = null;
        return db.getWorkflowRun(run.id) || run;
      } catch (err) {
        if (stopRequestedWorkflowRunId === run.id) {
          db.updateWorkflowRunStatus(run.id, 'CANCELLED', 'Dừng theo yêu cầu người dùng.');
          broadcastStep('Automation đã dừng theo yêu cầu.', 'CANCELLED', 99);
          activeWorkflowRunId = null;
          stopRequestedWorkflowRunId = null;
          return db.getWorkflowRun(run.id) || run;
        }
        db.logError({
          runId: run.id,
          errorType: 'DOWNLOAD_FAILED',
          severity: 'ERROR',
          message: (err as Error).message,
        });
        db.updateWorkflowRunStatus(run.id, 'FAILED', (err as Error).message);
        broadcastStep('Lỗi Quy trình: ' + (err as Error).message, 'FAILED', 99, (err as Error).message);
        activeWorkflowRunId = null;
        stopRequestedWorkflowRunId = null;
        throw err;
      }
    }

    db.updateWorkflowRunStatus(run.id, 'FAILED', `Workflow ${payload.type} completed initial run.`);
    activeWorkflowRunId = null;
    return db.getWorkflowRun(run.id) || run;
  });

  ipcMain.handle('workflow:stop', async () => {
    if (!activeWorkflowRunId) return { stopped: false };
    stopRequestedWorkflowRunId = activeWorkflowRunId;
    if (browserManager) {
      await browserManager.closeAll();
    }
    return { stopped: true, runId: activeWorkflowRunId };
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
          const decrypted = decryptLocalCredential(cached);
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

    // Do not report success unless at least one durable credential store confirms the write.
    let nativeStored = false;
    let encryptedStored = false;
    const storageErrors: string[] = [];

    // 1. Store and verify in the current OS user's credential vault.
    try {
      await credentialManager.setPassword(payload.accountName, payload.password);
      nativeStored = (await credentialManager.getPassword(payload.accountName)) === payload.password;
      if (!nativeStored) storageErrors.push('Windows Credential Manager did not confirm the saved password.');
    } catch (error) {
      storageErrors.push(`Windows Credential Manager: ${(error as Error).message}`);
    }

    // 2. Keep an authenticated, machine-key-encrypted fallback in this user's local database.
    try {
      const enc = encryptLocalCredential(payload.password);
      db.setSetting(`cred_${payload.accountName}`, enc);
      const stored = db.getSetting(`cred_${payload.accountName}`);
      encryptedStored = Boolean(stored && decryptLocalCredential(stored) === payload.password);
      if (!encryptedStored) storageErrors.push('Encrypted local storage did not confirm the saved password.');
    } catch (error) {
      storageErrors.push(`Encrypted local storage: ${(error as Error).message}`);
    }

    if (!nativeStored && !encryptedStored) {
      throw new Error(`Mật khẩu chưa được lưu. ${storageErrors.join(' ')}`);
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
    return { saved: true, storedIn: [nativeStored ? 'os-vault' : null, encryptedStored ? 'local-database' : null].filter(Boolean) };
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
    const targets = endpoints ?? localConfig.endpoints ?? [];

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
    const profileList = getEnterpriseProfiles();
    const activeId = db?.getSetting('active_enterprise_id') || profileList.find((profile) => profile.isActive)?.id;
    const activeProfile = profileList.find((profile) => profile.id === activeId) || profileList[0];
    const settings = getMergedAppSettings();
    const sapUrl = payload?.sapHost
      ? `https://${payload.sapHost}:${payload.sapPort || 8100}/`
      : settings.sapUrl || activeProfile?.erpUrl || process.env.SAP_URL || localConfig.sapUrl || '';
    const posUrl = payload?.posHost
      ? `http://${payload.posHost}:${payload.posPort || 80}/`
      : settings.posBaseUrl || settings.posUrl || activeProfile?.posUrl || process.env.POS_URL || localConfig.posUrl || '';
    const parsePort = (value: string, fallback: number) => {
      try { const parsed = new URL(value); return Number(parsed.port) || fallback; } catch { return fallback; }
    };
    const [sapProbe, posProbe] = await Promise.all([
      sapUrl ? probeEndpoint(sapUrl, parsePort(sapUrl, 443)) : Promise.resolve({ reachable: false, latencyMs: 0, error: 'Chưa cấu hình URL SAP' }),
      posUrl ? probeEndpoint(posUrl, parsePort(posUrl, 80)) : Promise.resolve({ reachable: false, latencyMs: 0, error: 'Chưa cấu hình URL POS' }),
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
  ipcMain.handle('app:get-paths', async () => {
    const userData = process.env.APP_DATA_DIR || app.getPath('userData');
    return {
      documents: app.getPath('documents'),
      downloads: app.getPath('downloads'),
      userData,
      temp: path.join(userData, 'Temp'),
      logs: path.join(userData, 'logs'),
    };
  });

  ipcMain.handle('dialog:open-directory', async (_event, defaultPath?: string) => {
    const result = await dialog.showOpenDialog({
      defaultPath: defaultPath || app.getPath('documents'),
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

function registerVaultHandlers(): void {
  ipcMain.handle('vault:export', async (_event, payload?: string | {
    passphrase?: string;
    saveToFile?: boolean;
    targetPath?: string;
  }) => {
    if (!db) throw new Error('Database not initialized');
    const passphrase = (typeof payload === 'string' ? payload : payload?.passphrase)?.trim();
    if (!passphrase) {
      throw new Error('Mật khẩu bảo vệ vault không được để trống');
    }

    const userData = process.env.APP_DATA_DIR || app.getPath('userData');
    const backupsDir = path.join(userData, 'backups');
    try {
      fs.mkdirSync(backupsDir, { recursive: true });
    } catch {}

    // 1. Gather all settings & enterprise profiles
    const allSettings = db.getAllSettings();
    const enterpriseProfiles = getEnterpriseProfiles();
    const activeEnterpriseId = db.getSetting('active_enterprise_id') || enterpriseProfiles.find((p) => p.isActive)?.id || '';

    // 2. Gather credentials (metadata + decryptable password payload for portable cross-machine restoration)
    const credMetas = db.listCredentialMeta();
    const credentials: Array<{
      accountName: string;
      username: string;
      application?: string;
      url?: string;
      password?: string;
      encryptedLocal?: string;
    }> = [];

    for (const meta of credMetas) {
      const acc = meta.accountName || (meta as any).account_name;
      let pwd = '';
      try {
        pwd = (await credentialManager.getPassword(acc)) || '';
      } catch {}
      if (!pwd) {
        const cached = db.getSetting(`cred_${acc}`);
        if (cached) {
          try {
            pwd = decryptLocalCredential(cached);
          } catch {}
        }
      }
      credentials.push({
        accountName: acc,
        username: meta.username || '',
        application: meta.application || '',
        url: meta.url || '',
        password: pwd || undefined,
        encryptedLocal: db.getSetting(`cred_${acc}`) || undefined,
      });
    }

    // Include any standalone cred_* in allSettings if not already in credMetas
    for (const [key, value] of Object.entries(allSettings)) {
      if (key.startsWith('cred_')) {
        const acc = key.slice(5);
        if (!credentials.some((c) => c.accountName === acc)) {
          let pwd = '';
          try {
            pwd = decryptLocalCredential(value);
          } catch {}
          credentials.push({
            accountName: acc,
            username: '',
            password: pwd || undefined,
            encryptedLocal: value,
          });
        }
      }
    }

    const vaultPayload = {
      appName: 'OmniFlow Studio',
      format: 'OMNIFLOW_VAULT_BACKUP',
      version: 1,
      exportedAt: new Date().toISOString(),
      activeEnterpriseId,
      enterpriseProfiles,
      settings: allSettings,
      credentials,
    };

    const vaultString = createEncryptedVault(vaultPayload, passphrase);

    // Auto-backup snapshot to <userData>/backups/
    const dateStamp = new Date().toISOString().replace(/[:.]/g, '-');
    const snapshotFileName = `omniflow-vault-backup-${dateStamp}.ofvault`;
    const snapshotPath = path.join(backupsDir, snapshotFileName);
    try {
      fs.writeFileSync(snapshotPath, vaultString, 'utf8');
    } catch (err) {
      console.warn('Auto-backup snapshot write warning:', err);
    }

    let savedFilePath: string | null = null;
    const saveToFile = typeof payload === 'object' && payload?.saveToFile;
    const targetPath = typeof payload === 'object' && payload?.targetPath;

    if (targetPath) {
      fs.writeFileSync(targetPath, vaultString, 'utf8');
      savedFilePath = targetPath;
    } else if (saveToFile) {
      const saveDialogRes = await dialog.showSaveDialog({
        title: 'Xuất Bản Sao Lưu Mã Hóa (.ofvault)',
        defaultPath: path.join(app.getPath('documents') || userData, `OmniFlow_Backup_${dateStamp}.ofvault`),
        filters: [
          { name: 'OmniFlow Encrypted Vault', extensions: ['ofvault', 'vault'] },
          { name: 'Tất cả tập tin', extensions: ['*'] },
        ],
      });
      if (!saveDialogRes.canceled && saveDialogRes.filePath) {
        fs.writeFileSync(saveDialogRes.filePath, vaultString, 'utf8');
        savedFilePath = saveDialogRes.filePath;
      }
    }

    return {
      success: true,
      vaultString,
      filePath: savedFilePath,
      snapshotPath,
      stats: {
        settingsCount: Object.keys(allSettings).length,
        profilesCount: enterpriseProfiles.length,
        credentialsCount: credentials.length,
      },
    };
  });

  ipcMain.handle('vault:import', async (_event, payload?: {
    passphrase?: string;
    vaultString?: string;
    filePath?: string;
    selectFile?: boolean;
  } | string) => {
    if (!db) throw new Error('Database not initialized');
    let passphrase = '';
    let vaultString = '';
    let filePath = '';
    let selectFile = false;

    if (typeof payload === 'string') {
      passphrase = payload;
    } else if (payload && typeof payload === 'object') {
      passphrase = (payload.passphrase || '').trim();
      vaultString = payload.vaultString || '';
      filePath = payload.filePath || '';
      selectFile = payload.selectFile || false;
    }

    if (!passphrase) {
      throw new Error('Mật khẩu giải mã vault không được để trống');
    }

    if (selectFile || (!vaultString && !filePath)) {
      const openDialogRes = await dialog.showOpenDialog({
        title: 'Chọn tập tin sao lưu OmniFlow Vault (.ofvault)',
        filters: [
          { name: 'OmniFlow Encrypted Vault', extensions: ['ofvault', 'vault'] },
          { name: 'Tất cả tập tin', extensions: ['*'] },
        ],
        properties: ['openFile'],
      });
      if (openDialogRes.canceled || openDialogRes.filePaths.length === 0) {
        return { success: false, cancelled: true };
      }
      filePath = openDialogRes.filePaths[0];
    }

    if (filePath && !vaultString) {
      if (!fs.existsSync(filePath)) {
        throw new Error(`Tập tin sao lưu không tồn tại: ${filePath}`);
      }
      vaultString = fs.readFileSync(filePath, 'utf8').trim();
    }

    if (!vaultString) {
      throw new Error('Nội dung tập tin sao lưu trống hoặc không hợp lệ');
    }

    const decryptedData = restoreEncryptedVault<any>(vaultString, passphrase);
    if (!decryptedData || typeof decryptedData !== 'object') {
      throw new Error('Dữ liệu sao lưu không đúng định dạng');
    }

    let restoredSettings = 0;
    let restoredProfiles = 0;
    let restoredCredentials = 0;

    // 1. Restore settings
    if (decryptedData.settings && typeof decryptedData.settings === 'object') {
      for (const [k, v] of Object.entries(decryptedData.settings)) {
        db.setSetting(k, typeof v === 'string' ? v : JSON.stringify(v));
        restoredSettings++;
      }
    }

    // 2. Restore enterprise profiles
    if (Array.isArray(decryptedData.enterpriseProfiles)) {
      db.setSetting('enterprise_profiles', JSON.stringify(decryptedData.enterpriseProfiles));
      restoredProfiles = decryptedData.enterpriseProfiles.length;
    }
    if (decryptedData.activeEnterpriseId) {
      db.setSetting('active_enterprise_id', decryptedData.activeEnterpriseId);
    }

    // 3. Restore credentials
    if (Array.isArray(decryptedData.credentials)) {
      for (const cred of decryptedData.credentials) {
        if (!cred.accountName) continue;
        db.upsertCredentialMeta({
          id: cred.accountName,
          accountName: cred.accountName,
          application: cred.application || '',
          username: cred.username || '',
          credentialKey: cred.accountName,
          url: cred.url || '',
        });

        if (cred.password) {
          try {
            await credentialManager.setPassword(cred.accountName, cred.password);
          } catch {}
          try {
            const enc = encryptLocalCredential(cred.password);
            db.setSetting(`cred_${cred.accountName}`, enc);
          } catch {}
        } else if (cred.encryptedLocal) {
          db.setSetting(`cred_${cred.accountName}`, cred.encryptedLocal);
        }
        restoredCredentials++;
      }
    }

    return {
      success: true,
      restoredFrom: filePath || 'raw-string',
      stats: {
        restoredSettings,
        restoredProfiles,
        restoredCredentials,
      },
    };
  });
}
