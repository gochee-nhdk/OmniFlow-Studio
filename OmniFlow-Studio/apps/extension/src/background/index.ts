// ============================================================
// OmniFlow Studio — Standalone Extension Background Service Worker (MV3)
// 100% Browser-Native Automation (Zero Local Agent / WebSocket Dependency)
// ============================================================

import {
  AgentStatus,
  DEFAULT_CONFIG,
  DownloadHistoryItem,
  ExtensionConfig,
  ExtensionMessage,
  ExtensionResponse,
  WorkflowProgress,
  WorkflowType,
} from '../types.js';
import {
  appendLog,
  clearCheckpoint,
  clearLogs,
  getCheckpoint,
  getConfig,
  getDownloads,
  getLogs,
  recordDownload,
  saveCheckpoint,
  saveConfig,
} from '../shared/storage.js';
import { PosEngineConfig } from '../engines/pos-engine.js';
import { SapEngineConfig, SapTargetModule } from '../engines/sap-engine.js';
import {
  routePosLoginCheck,
  routePosReportDownload,
  routeSapAutomation,
} from '../engines/screen-router.js';
import { removeCursorOverlay } from '../engines/cursor-overlay.js';
import { actOnPage, inspectPage } from '../engines/browser-agent.js';

// ============================================================
// State Management
// ============================================================
let currentConfig: ExtensionConfig = { ...DEFAULT_CONFIG };
let activeAbortController: AbortController | null = null;
let currentProgress: WorkflowProgress | null = null;
const recordedDownloadIds = new Set<number>();
const activeAutomationTabIds = new Set<number>();

let currentStatus: AgentStatus = {
  isOnline: true,
  mode: 'STANDALONE',
  version: '2.1.0',
  currentStatus: 'IDLE',
  lastHeartbeat: new Date().toISOString(),
  posReachable: false,
  sapReachable: false,
  activeJobsCount: 0,
};

// ============================================================
// Badge Management
// ============================================================
function updateBadge(state: 'READY' | 'RUNNING', label?: string) {
  try {
    if (state === 'RUNNING') {
      chrome.action.setBadgeText({ text: label || 'RUN' });
      chrome.action.setBadgeBackgroundColor({ color: '#3B82F6' });
      chrome.action.setTitle({
        title: `OmniFlow Studio: Đang thực thi (${currentProgress?.workflowType || 'Workflow'})...`,
      });
    } else {
      chrome.action.setBadgeText({ text: 'ON' });
      chrome.action.setBadgeBackgroundColor({ color: '#10B981' });
      chrome.action.setTitle({
        title: 'OmniFlow Studio: Sẵn sàng (Standalone v2.1.0)',
      });
    }
  } catch (err) {
    console.warn('[Badge Error]', err);
  }
}

function broadcast(type: string, payload: any) {
  chrome.runtime.sendMessage({ type, payload }).catch(() => {
    // Ignore when no UI listener (popup/sidepanel) is open
  });
  for (const tabId of activeAutomationTabIds) {
    chrome.tabs.sendMessage(tabId, { type, payload }).catch(() => {
      // Ignore if content script is not injected on tab
    });
  }
}

async function logEvent(
  level: 'info' | 'warn' | 'error' | 'success',
  message: string,
  source = 'background'
) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    source,
  };
  await appendLog(entry);
  broadcast('NEW_LOG_ENTRY', entry);
}

// ============================================================
// Latency / Ping Check
// ============================================================
async function pingUrl(
  url: string,
  timeoutMs = 3000
): Promise<{ reachable: boolean; latencyMs: number }> {
  if (!url) return { reachable: false, latencyMs: -1 };
  const start = performance.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    await fetch(url, {
      method: 'HEAD',
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return { reachable: true, latencyMs: Math.round(performance.now() - start) };
  } catch {
    clearTimeout(timeoutId);
    const latency = Math.round(performance.now() - start);
    if (latency > 0 && latency < timeoutMs) {
      return { reachable: true, latencyMs: latency };
    }
    return { reachable: false, latencyMs: -1 };
  }
}

async function checkNetworkPings() {
  currentConfig = await getConfig();
  const [pos, sap] = await Promise.all([
    pingUrl(currentConfig.posUrl),
    pingUrl(currentConfig.sapUrl),
  ]);

  currentStatus.posReachable = pos.reachable;
  currentStatus.posLatencyMs = pos.latencyMs;
  currentStatus.sapReachable = sap.reachable;
  currentStatus.sapLatencyMs = sap.latencyMs;
  currentStatus.lastHeartbeat = new Date().toISOString();

  broadcast('NETWORK_METRICS_UPDATED', { pos, sap });
  broadcast('AGENT_STATUS_UPDATED', currentStatus);
}

// ============================================================
// Tab & Config Helpers
// ============================================================
async function waitForTabComplete(tabId: number, timeoutMs = 15000): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === 'complete') return;

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, timeoutMs);

    const listener = (updatedId: number, changeInfo: { status?: string }) => {
      if (updatedId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function cleanupAllCursorOverlays(): Promise<void> {
  const tabIds = new Set<number>(activeAutomationTabIds);
  try {
    const hostnames: string[] = [];
    for (const rawUrl of [currentConfig.posUrl, currentConfig.sapUrl]) {
      try {
        if (rawUrl) hostnames.push(new URL(rawUrl).hostname.toLowerCase());
      } catch {
        // Ignore invalid URL
      }
    }
    const tabs = await chrome.tabs.query({ currentWindow: true });
    for (const t of tabs) {
      if (t.id == null || !t.url) continue;
      try {
        const host = new URL(t.url).hostname.toLowerCase();
        if (hostnames.includes(host)) {
          tabIds.add(t.id);
        }
      } catch {
        // Ignore non-http URLs
      }
    }
  } catch {
    // Ignore tab query errors
  }

  activeAutomationTabIds.clear();
  if (tabIds.size === 0) return;

  await Promise.allSettled(
    Array.from(tabIds).map((id) => removeCursorOverlay(id).catch(() => {}))
  );
}

async function findOrOpenTab(targetUrl: string, trackForAutomation = true): Promise<number> {
  let origin = '';
  let hostname = '';
  try {
    const parsed = new URL(targetUrl);
    origin = parsed.origin;
    hostname = parsed.hostname.toLowerCase();
  } catch {
    throw new Error(`URL không hợp lệ: ${targetUrl}`);
  }

  const matchesTab = (t: chrome.tabs.Tab): boolean => {
    if (t.id == null || !t.url) return false;
    if (t.url.startsWith(origin)) return true;
    try {
      return new URL(t.url).hostname.toLowerCase() === hostname;
    } catch {
      return false;
    }
  };

  const currentWindowTabs = await chrome.tabs.query({ currentWindow: true });
  const existing =
    currentWindowTabs.find((t) => t.active && matchesTab(t)) ||
    currentWindowTabs.find((t) => matchesTab(t));

  if (existing?.id != null) {
    if (trackForAutomation) {
      activeAutomationTabIds.add(existing.id);
      chrome.tabs.sendMessage(existing.id, { type: 'START_KEEPALIVE' }).catch(() => {});
    }
    if (!existing.active) {
      await chrome.tabs.update(existing.id, { active: true });
    }
    await waitForTabComplete(existing.id, 15000);
    return existing.id;
  }

  const created = await chrome.tabs.create({ url: targetUrl, active: true });
  if (created.id == null) {
    throw new Error(`Không thể mở tab mới cho ${targetUrl}`);
  }
  if (trackForAutomation) {
    activeAutomationTabIds.add(created.id);
    chrome.tabs.sendMessage(created.id, { type: 'START_KEEPALIVE' }).catch(() => {});
  }
  await waitForTabComplete(created.id, 15000);
  return created.id;
}

function formatDateYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function resolveDates(cfg: ExtensionConfig, params: Record<string, any> = {}): { fromDate: string; toDate: string } {
  if (params.fromDate && params.toDate) {
    return { fromDate: String(params.fromDate), toDate: String(params.toDate) };
  }
  const now = new Date();
  const today = formatDateYmd(now);
  const rule = (params.dateRule || cfg.dateRule || 'TODAY').toUpperCase();

  if (rule === 'YESTERDAY') {
    const yest = new Date(now);
    yest.setDate(yest.getDate() - 1);
    const ymd = formatDateYmd(yest);
    return { fromDate: ymd, toDate: ymd };
  }
  if (rule === 'PREVIOUS_WEEK') {
    const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const convention = params.weekConvention || cfg.weekConvention || 'mon-sun';
    const daysSinceWeekStart =
      convention === 'sun-sat'
        ? todayDate.getDay()
        : (todayDate.getDay() + 6) % 7;
    const start = new Date(todayDate);
    start.setDate(todayDate.getDate() - daysSinceWeekStart - 7);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { fromDate: formatDateYmd(start), toDate: formatDateYmd(end) };
  }
  if (rule === 'CUSTOM') {
    return {
      fromDate: params.customFromDate || cfg.customFromDate || today,
      toDate: params.customToDate || cfg.customToDate || today,
    };
  }
  return { fromDate: today, toDate: today };
}

function buildPosEngineConfig(cfg: ExtensionConfig, params: Record<string, any> = {}): PosEngineConfig {
  const { fromDate, toDate } = resolveDates(cfg, params);
  const slocs = Array.isArray(params.slocs)
    ? params.slocs
    : Array.isArray(cfg.posSlocFilter)
      ? cfg.posSlocFilter
      : [];

  return {
    posUrl: cfg.posUrl,
    username: params.posUsername || cfg.posUsername,
    password: params.posPassword ?? cfg.posPassword,
    preferredOutlet: params.outlet || cfg.posPreferredOutlet || 'FM04',
    fromDate,
    toDate,
    weekConvention: params.weekConvention || cfg.weekConvention || 'mon-sun',
    storeFilter: params.storeFilter || cfg.posPreferredOutlet || 'FM04',
    slocFilter: slocs.join(','),
    itemFilter: params.itemFilter ?? cfg.posItemFilter ?? '',
  };
}

function resolveSapModule(raw?: string): SapTargetModule {
  const valid: SapTargetModule[] = [
    'HOME',
    'PURCHASING_PO',
    'PURCHASING_GRPO',
    'PURCHASING_RETURN',
    'INVENTORY_STATUS',
    'QUERY_PRICELIST',
  ];
  if (raw && valid.includes(raw as SapTargetModule)) {
    return raw as SapTargetModule;
  }
  return 'QUERY_PRICELIST';
}

function buildSapEngineConfig(cfg: ExtensionConfig, params: Record<string, any> = {}): SapEngineConfig {
  return {
    sapUrl: cfg.sapUrl,
    username: params.sapUsername || cfg.sapUsername,
    password: params.sapPassword ?? cfg.sapPassword,
    company: params.sapCompany || cfg.sapCompany || 'Công ty TNHH Thương Mại LARIA (FM_PRO)',
    server: undefined,
    autoTakeOverSession: params.autoTakeOverSession ?? cfg.autoTakeOverSession ?? true,
    targetModule: resolveSapModule(params.sapTargetModule || cfg.sapTargetModule),
  };
}

// ============================================================
// Download Recording
// ============================================================
async function saveRecordedDownload(
  downloadId: number | undefined,
  filename: string | undefined,
  reportType: 'INVENTORY' | 'SALES' | 'SAP',
  status: 'SUCCESS' | 'FAILED' | 'PARTIAL' = 'SUCCESS'
) {
  if (!filename && downloadId == null) return;
  let fileSizeBytes: number | undefined;
  let resolvedName = filename || `download_${downloadId}`;

  if (downloadId != null) {
    recordedDownloadIds.add(downloadId);
    try {
      const items = await chrome.downloads.search({ id: downloadId });
      if (items[0]) {
        resolvedName = items[0].filename || resolvedName;
        fileSizeBytes = items[0].fileSize > 0 ? items[0].fileSize : items[0].bytesReceived;
      }
    } catch {
      // Ignore search error
    }
  }

  const baseName = resolvedName.split(/[/\\]/).pop() || resolvedName;
  const item: DownloadHistoryItem = {
    id: downloadId != null ? `dl_${downloadId}` : `dl_${Date.now()}`,
    downloadId,
    fileName: baseName,
    reportType,
    filePath: resolvedName,
    fileSizeBytes,
    status,
    downloadedAt: new Date().toISOString(),
  };

  await recordDownload(item);
  broadcast('DOWNLOAD_RECORDED', item);
}

chrome.downloads.onChanged.addListener((delta) => {
  if (delta.state?.current !== 'complete') return;
  if (recordedDownloadIds.has(delta.id)) return;

  (async () => {
    try {
      const items = await chrome.downloads.search({ id: delta.id });
      const dl = items[0];
      if (!dl) return;

      const lower = `${dl.filename || ''} ${dl.url || ''}`.toLowerCase();
      const cfgPosHost = (() => {
        try { return new URL(currentConfig.posUrl).hostname.toLowerCase(); } catch { return ''; }
      })();
      const cfgSapHost = (() => {
        try { return new URL(currentConfig.sapUrl).hostname.toLowerCase(); } catch { return ''; }
      })();

      const isRelevant =
        (cfgPosHost && lower.includes(cfgPosHost)) ||
        (cfgSapHost && lower.includes(cfgSapHost)) ||
        lower.includes('sales') ||
        lower.includes('inventory') ||
        lower.includes('pricelist') ||
        lower.includes('rpfo');

      if (!isRelevant) return;

      let reportType: 'INVENTORY' | 'SALES' | 'SAP' = 'SAP';
      if (lower.includes('inventory') || lower.includes('ton') || lower.includes('stock')) {
        reportType = 'INVENTORY';
      } else if (lower.includes('sales') || lower.includes('doanh')) {
        reportType = 'SALES';
      }

      await saveRecordedDownload(dl.id, dl.filename, reportType, 'SUCCESS');
    } catch {
      // Ignore
    }
  })();
});

// ============================================================
// Workflow Execution Engine
// ============================================================
function emitProgress(
  runId: string,
  workflowType: WorkflowType,
  step: string,
  percent: number,
  status: WorkflowProgress['status'] = 'RUNNING',
  stepIndex?: number,
  totalSteps?: number,
  message?: string
) {
  const clamped = Math.min(100, Math.max(0, Math.round(percent)));
  currentProgress = {
    runId,
    workflowType,
    step,
    stepIndex,
    totalSteps,
    percent: clamped,
    status,
    message,
    timestamp: new Date().toISOString(),
  };

  if (status === 'RUNNING' || status === 'INITIALIZING') {
    updateBadge('RUNNING', `${clamped}%`);
    void saveCheckpoint({
      runId,
      workflowType,
      stage: step,
      stepIndex: stepIndex ?? 0,
      totalSteps: totalSteps ?? 5,
      percent: clamped,
      updatedAt: new Date().toISOString(),
    });
  } else {
    updateBadge('READY');
    void clearCheckpoint();
  }

  broadcast('WORKFLOW_PROGRESS', currentProgress);
}

async function executeWorkflowAsync(
  runId: string,
  workflowType: WorkflowType,
  params: Record<string, any>,
  signal: AbortSignal
) {
  const cfg = await getConfig();
  currentConfig = cfg;

  try {
    await logEvent('info', `Bắt đầu quy trình: ${workflowType}`, 'workflow');

    if (workflowType === 'CONNECTION_TEST') {
      emitProgress(runId, workflowType, 'Đang kiểm tra kết nối POS & SAP...', 30, 'RUNNING', 1, 2);
      await checkNetworkPings();
      emitProgress(runId, workflowType, 'Kiểm tra kết nối hoàn tất', 100, 'SUCCESS', 2, 2);
      currentStatus.currentStatus = 'SUCCESS';
      broadcast('WORKFLOW_COMPLETED', { runId, workflowType });
      return;
    }

    if (workflowType === 'POS_LOGIN_CHECK') {
      emitProgress(runId, workflowType, 'Mở trang POS RPFO...', 5, 'RUNNING', 1, 3);
      const tabId = await findOrOpenTab(cfg.posUrl);
      const res = await routePosLoginCheck(
        tabId,
        buildPosEngineConfig(cfg, params),
        (step, pct) => emitProgress(runId, workflowType, step, pct, 'RUNNING', 2, 3),
        signal,
        { geminiApiKey: cfg.geminiApiKey }
      );
      if (!res.ok) throw new Error(res.message);
      emitProgress(runId, workflowType, res.message, 100, 'SUCCESS', 3, 3, res.message);
      await logEvent('success', `POS Login Check: ${res.message}`, 'pos-engine');
      currentStatus.currentStatus = 'SUCCESS';
      broadcast('WORKFLOW_COMPLETED', { runId, workflowType, result: res });
      return;
    }

    if (workflowType === 'DOWNLOAD_SALES') {
      emitProgress(runId, workflowType, 'Mở trang POS RPFO...', 5, 'RUNNING', 1, 3);
      const tabId = await findOrOpenTab(cfg.posUrl);
      const res = await routePosReportDownload(
        tabId,
        'SALES',
        buildPosEngineConfig(cfg, params),
        (step, pct) => emitProgress(runId, workflowType, step, pct, 'RUNNING', 2, 3),
        signal,
        { geminiApiKey: cfg.geminiApiKey }
      );
      if (!res.ok) throw new Error(res.message);
      await saveRecordedDownload(res.downloadId, res.filename, 'SALES', 'SUCCESS');
      emitProgress(runId, workflowType, res.message, 100, 'SUCCESS', 3, 3, res.message);
      await logEvent('success', `Doanh số POS: ${res.filename || res.message}`, 'pos-engine');
      currentStatus.currentStatus = 'SUCCESS';
      broadcast('WORKFLOW_COMPLETED', { runId, workflowType, result: res });
      return;
    }

    if (workflowType === 'DOWNLOAD_INVENTORY') {
      emitProgress(runId, workflowType, 'Mở trang POS RPFO...', 5, 'RUNNING', 1, 3);
      const tabId = await findOrOpenTab(cfg.posUrl);
      const res = await routePosReportDownload(
        tabId,
        'INVENTORY',
        buildPosEngineConfig(cfg, params),
        (step, pct) => emitProgress(runId, workflowType, step, pct, 'RUNNING', 2, 3),
        signal,
        { geminiApiKey: cfg.geminiApiKey }
      );
      if (!res.ok) throw new Error(res.message);
      await saveRecordedDownload(res.downloadId, res.filename, 'INVENTORY', 'SUCCESS');
      emitProgress(runId, workflowType, res.message, 100, 'SUCCESS', 3, 3, res.message);
      await logEvent('success', `Tồn kho POS: ${res.filename || res.message}`, 'pos-engine');
      currentStatus.currentStatus = 'SUCCESS';
      broadcast('WORKFLOW_COMPLETED', { runId, workflowType, result: res });
      return;
    }

    if (workflowType === 'POS_AUTOMATION') {
      const posCfg = buildPosEngineConfig(cfg, params);
      emitProgress(runId, workflowType, 'Mở trang POS RPFO...', 5, 'RUNNING', 1, 4);
      const tabId = await findOrOpenTab(cfg.posUrl);

      const salesRes = await routePosReportDownload(
        tabId,
        'SALES',
        posCfg,
        (step, pct) => emitProgress(runId, workflowType, `[Doanh số] ${step}`, 5 + pct * 0.45, 'RUNNING', 2, 4),
        signal,
        { geminiApiKey: cfg.geminiApiKey }
      );
      if (!salesRes.ok) throw new Error(salesRes.message);
      await saveRecordedDownload(salesRes.downloadId, salesRes.filename, 'SALES', 'SUCCESS');

      const invRes = await routePosReportDownload(
        tabId,
        'INVENTORY',
        posCfg,
        (step, pct) => emitProgress(runId, workflowType, `[Tồn kho] ${step}`, 50 + pct * 0.48, 'RUNNING', 3, 4),
        signal,
        { geminiApiKey: cfg.geminiApiKey }
      );
      if (!invRes.ok) throw new Error(invRes.message);
      await saveRecordedDownload(invRes.downloadId, invRes.filename, 'INVENTORY', 'SUCCESS');

      emitProgress(runId, workflowType, 'Hoàn tất tải Doanh số & Tồn kho POS', 100, 'SUCCESS', 4, 4);
      await logEvent('success', 'POS Automation hoàn tất (Sales + Inventory).', 'pos-engine');
      currentStatus.currentStatus = 'SUCCESS';
      broadcast('WORKFLOW_COMPLETED', { runId, workflowType, salesRes, invRes });
      return;
    }

    if (workflowType === 'SAP_AUTOMATION' || workflowType === 'SAP_LOGIN_CHECK') {
      emitProgress(runId, workflowType, 'Mở trang SAP Business One...', 5, 'RUNNING', 1, 3);
      const tabId = await findOrOpenTab(cfg.sapUrl);
      const sapCfg = buildSapEngineConfig(cfg, params);
      if (workflowType === 'SAP_LOGIN_CHECK') {
        sapCfg.targetModule = 'HOME';
      }
      const res = await routeSapAutomation(
        tabId,
        sapCfg,
        (step, pct) => emitProgress(runId, workflowType, step, pct, 'RUNNING', 2, 3),
        signal,
        { geminiApiKey: cfg.geminiApiKey }
      );
      if (!res.ok) throw new Error(res.message);
      if (res.filename || res.downloadId != null) {
        await saveRecordedDownload(res.downloadId, res.filename, 'SAP', 'SUCCESS');
      }
      emitProgress(runId, workflowType, res.message, 100, 'SUCCESS', 3, 3, res.message);
      await logEvent('success', `SAP B1: ${res.filename || res.message}`, 'sap-engine');
      currentStatus.currentStatus = 'SUCCESS';
      broadcast('WORKFLOW_COMPLETED', { runId, workflowType, result: res });
      return;
    }

    if (workflowType === 'DAILY_PROCUREMENT') {
      const posCfg = buildPosEngineConfig(cfg, params);
      const sapCfg = buildSapEngineConfig(cfg, params);

      emitProgress(runId, workflowType, 'Bước 1/3: Mở POS & tải Doanh số...', 2, 'RUNNING', 1, 5);
      const posTabId = await findOrOpenTab(cfg.posUrl);

      const salesRes = await routePosReportDownload(
        posTabId,
        'SALES',
        posCfg,
        (step, pct) => emitProgress(runId, workflowType, `[1/3 Doanh số] ${step}`, 2 + pct * 0.33, 'RUNNING', 2, 5),
        signal,
        { geminiApiKey: cfg.geminiApiKey }
      );
      if (!salesRes.ok) throw new Error(`POS Sales thất bại: ${salesRes.message}`);
      await saveRecordedDownload(salesRes.downloadId, salesRes.filename, 'SALES', 'SUCCESS');

      emitProgress(runId, workflowType, 'Bước 2/3: Tải Tồn kho POS (12 Kho)...', 35, 'RUNNING', 3, 5);
      const invRes = await routePosReportDownload(
        posTabId,
        'INVENTORY',
        posCfg,
        (step, pct) => emitProgress(runId, workflowType, `[2/3 Tồn kho] ${step}`, 35 + pct * 0.35, 'RUNNING', 3, 5),
        signal,
        { geminiApiKey: cfg.geminiApiKey }
      );
      if (!invRes.ok) throw new Error(`POS Inventory thất bại: ${invRes.message}`);
      await saveRecordedDownload(invRes.downloadId, invRes.filename, 'INVENTORY', 'SUCCESS');

      emitProgress(runId, workflowType, 'Bước 3/3: Mở SAP B1 & xuất Price List...', 70, 'RUNNING', 4, 5);
      const sapTabId = await findOrOpenTab(cfg.sapUrl);
      const sapRes = await routeSapAutomation(
        sapTabId,
        sapCfg,
        (step, pct) => emitProgress(runId, workflowType, `[3/3 SAP B1] ${step}`, 70 + pct * 0.29, 'RUNNING', 4, 5),
        signal,
        { geminiApiKey: cfg.geminiApiKey }
      );
      if (!sapRes.ok) throw new Error(`SAP Automation thất bại: ${sapRes.message}`);
      if (sapRes.filename || sapRes.downloadId != null) {
        await saveRecordedDownload(sapRes.downloadId, sapRes.filename, 'SAP', 'SUCCESS');
      }

      emitProgress(runId, workflowType, 'Daily Procurement hoàn thành 100%!', 100, 'SUCCESS', 5, 5);
      await logEvent('success', 'Daily Procurement (Sales -> Inventory -> SAP) hoàn tất!', 'workflow');
      currentStatus.currentStatus = 'SUCCESS';
      broadcast('WORKFLOW_COMPLETED', { runId, workflowType, salesRes, invRes, sapRes });
      return;
    }

    throw new Error(`Workflow không được hỗ trợ: ${workflowType}`);
  } catch (err: any) {
    const isCancelled = signal.aborted || /cancelled|aborted|dừng/i.test(err?.message || '');
    if (isCancelled) {
      currentStatus.currentStatus = 'CANCELLED';
      emitProgress(runId, workflowType, 'Đã dừng quy trình theo yêu cầu', currentProgress?.percent || 0, 'CANCELLED');
      await logEvent('warn', `Quy trình ${workflowType} đã bị dừng.`, 'workflow');
      broadcast('WORKFLOW_FAILED', { runId, workflowType, error: 'Cancelled by user' });
    } else {
      const msg = err?.message || 'Lỗi không xác định';
      currentStatus.currentStatus = 'FAILED';
      emitProgress(runId, workflowType, `Lỗi: ${msg}`, currentProgress?.percent || 0, 'FAILED', undefined, undefined, msg);
      await logEvent('error', `Quy trình ${workflowType} thất bại: ${msg}`, 'workflow');
      broadcast('WORKFLOW_FAILED', { runId, workflowType, error: msg });
    }
  } finally {
    await cleanupAllCursorOverlays();
    activeAbortController = null;
    currentStatus.activeJobsCount = 0;
    currentStatus.currentWorkflow = undefined;
    updateBadge('READY');
    setTimeout(() => {
      if (!activeAbortController) {
        currentProgress = null;
        broadcast('WORKFLOW_RESET', null);
      }
    }, 6000);
  }
}

async function triggerWorkflow(
  workflowType: WorkflowType,
  params: Record<string, any> = {}
): Promise<ExtensionResponse> {
  if (activeAbortController) {
    return {
      success: false,
      error: 'Đang có quy trình thực thi. Vui lòng nhấn Dừng trước khi chạy tác vụ mới.',
    };
  }

  const runId = `run_${Date.now()}`;
  activeAbortController = new AbortController();
  currentStatus.currentWorkflow = workflowType;
  currentStatus.currentStatus = 'RUNNING';
  currentStatus.activeJobsCount = 1;

  emitProgress(runId, workflowType, 'Khởi tạo quy trình...', 2, 'INITIALIZING', 0, 5);
  void executeWorkflowAsync(runId, workflowType, params, activeAbortController.signal);

  return { success: true, data: { runId, workflowType, mode: 'STANDALONE' } };
}

// ============================================================
// Internal Message Listener
// ============================================================
chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  (async () => {
    try {
      switch (message.action) {
        case 'GET_STATUS': {
          currentStatus.isOnline = true;
          currentStatus.mode = 'STANDALONE';
          currentStatus.version = '2.1.0';
          currentStatus.lastHeartbeat = new Date().toISOString();
          sendResponse({
            success: true,
            data: {
              isOnline: true,
              status: currentStatus,
              progress: currentProgress,
              config: currentConfig,
            },
          });
          break;
        }

        case 'TRIGGER_WORKFLOW': {
          const result = await triggerWorkflow(message.workflowType, message.params);
          sendResponse(result);
          break;
        }

        case 'ABORT_WORKFLOW':
        case 'STOP_WORKFLOW': {
          if (activeAbortController) {
            activeAbortController.abort();
            activeAbortController = null;
          }
          await cleanupAllCursorOverlays();
          currentStatus.currentStatus = 'CANCELLED';
          currentStatus.activeJobsCount = 0;
          currentStatus.currentWorkflow = undefined;
          updateBadge('READY');
          if (currentProgress) {
            currentProgress.status = 'CANCELLED';
            currentProgress.step = 'Đã dừng quy trình';
            broadcast('WORKFLOW_PROGRESS', currentProgress);
          }
          sendResponse({ success: true });
          break;
        }

        case 'PING_TARGETS':
        case 'PING_SERVERS': {
          await checkNetworkPings();
          sendResponse({
            success: true,
            data: {
              posReachable: currentStatus.posReachable,
              posLatencyMs: currentStatus.posLatencyMs,
              sapReachable: currentStatus.sapReachable,
              sapLatencyMs: currentStatus.sapLatencyMs,
            },
          });
          break;
        }

        case 'OPEN_SIDEPANEL': {
          try {
            if (chrome.sidePanel?.open) {
              const win = await chrome.windows.getCurrent();
              if (win?.id != null) {
                await chrome.sidePanel.open({ windowId: win.id });
                sendResponse({ success: true });
                break;
              }
            }
            await chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel/index.html') });
            sendResponse({ success: true, data: { fallback: 'tab' } });
          } catch {
            await chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel/index.html') });
            sendResponse({ success: true, data: { fallback: 'tab' } });
          }
          break;
        }

        case 'OPEN_TARGET_TAB': {
          const cfg = await getConfig();
          const url =
            message.url ||
            (message.target === 'SAP' ? cfg.sapUrl : cfg.posUrl);
          const tabId = await findOrOpenTab(url);
          sendResponse({ success: true, data: { tabId, url } });
          break;
        }

        case 'GET_CONFIG': {
          const cfg = await getConfig();
          currentConfig = cfg;
          sendResponse({ success: true, data: cfg });
          break;
        }

        case 'SAVE_CONFIG': {
          currentConfig = await saveConfig(message.config);
          setupPingAlarm(currentConfig.pingIntervalSec);
          await checkNetworkPings();
          sendResponse({ success: true, data: currentConfig });
          break;
        }

        case 'GET_LOGS': {
          const logs = await getLogs();
          sendResponse({ success: true, data: logs });
          break;
        }

        case 'CLEAR_LOGS': {
          await clearLogs();
          sendResponse({ success: true });
          break;
        }

        case 'GET_DOWNLOADS': {
          const items = await getDownloads();
          sendResponse({ success: true, data: items });
          break;
        }

        case 'AGENT_INSPECT': {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab?.id == null) throw new Error('Không tìm thấy tab đang hoạt động.');
          const [result] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: inspectPage,
          });
          sendResponse({ success: true, data: { tabId: tab.id, snapshot: result?.result } });
          break;
        }

        case 'AGENT_SCREENSHOT': {
          const win = await chrome.windows.getCurrent();
          const dataUrl = await chrome.tabs.captureVisibleTab(win.id, { format: 'jpeg', quality: 55 });
          sendResponse({ success: true, data: { dataUrl } });
          break;
        }

        case 'AGENT_ACT': {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab?.id == null || tab.id !== message.tabId) throw new Error('Tab đã đổi sau khi quét; hãy quét lại trước khi thao tác.');
          const [result] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: actOnPage,
            args: [message.index, message.operation, message.value, message.expectedLabel],
          });
          const outcome = result?.result;
          sendResponse({ success: Boolean(outcome?.ok), data: outcome, error: outcome?.ok ? undefined : outcome?.message });
          break;
        }

        default:
          sendResponse({ success: false, error: 'Unknown action' });
      }
    } catch (err: any) {
      sendResponse({ success: false, error: err?.message || 'Internal error' });
    }
  })();

  return true;
});

// ============================================================
// MV3 Keep-Alive Port Listener (prevents SW idle during 6-12m waits)
// ============================================================
const keepAlivePorts = new Set<chrome.runtime.Port>();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'omniflow-keepalive') return;
  keepAlivePorts.add(port);
  port.onMessage.addListener((msg) => {
    if (msg?.type === 'PING') {
      try {
        port.postMessage({ type: 'PONG', ts: Date.now() });
      } catch {
        // Ignore closed port
      }
    }
  });
  port.onDisconnect.addListener(() => {
    keepAlivePorts.delete(port);
  });
});

// ============================================================
// Periodic Ping Alarm & Startup
// ============================================================
function setupPingAlarm(intervalSec = 30) {
  const periodInMinutes = Math.max(0.5, (intervalSec || 30) / 60);
  chrome.alarms.create('omniflow_ping_targets', { periodInMinutes });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'omniflow_ping_targets') {
    void checkNetworkPings();
  }
});

(async () => {
  currentConfig = await getConfig();
  updateBadge('READY');
  setupPingAlarm(currentConfig.pingIntervalSec);
  const lastCheckpoint = await getCheckpoint();
  if (lastCheckpoint && !activeAbortController) {
    await logEvent(
      'warn',
      `Phát hiện checkpoint gián đoạn (${lastCheckpoint.workflowType} @ ${lastCheckpoint.percent}% - ${lastCheckpoint.stage}). Đã dọn dẹp trạng thái.`,
      'background'
    );
    await clearCheckpoint();
  }
  await logEvent('info', 'OmniFlow Studio Standalone Extension v2.1.0 đã sẵn sàng.', 'background');
  await checkNetworkPings();
})();
