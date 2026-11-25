// ============================================================
// OmniFlow Studio — Goal-Driven Screen-Aware Router
// Combines readPosScreenState + readSapScreenState + VLM Fallback
// ============================================================

import {
  cleanupPosOverlay,
  ensureAuthenticated,
  formatDateYmd,
  getPreviousWeekRange,
  navigateToReport,
  normalizePosBaseUrl,
  parseFilterValues,
  POS_INVENTORY_EXPORT_SELECTORS,
  POS_LOADING_WAIT_TIMEOUT_MS,
  POS_SALES_EXPORT_SELECTORS,
  PosDownloadResult,
  PosEngineConfig,
  PosLoginResult,
  PosProgressCallback,
  PosScreenState,
  readPosScreenState,
  resolveFilename,
  setDateFilter,
  setGridFilter,
  setStoreFilter,
  triggerExportAndCapture,
  triggerPosSearch,
  waitForLoadingWaveToEnd,
} from './pos-engine.js';
import {
  checkAndHandleAuthDialog,
  dismissSystemMessagesLog,
  fillAndSubmitLogonForm,
  navigateToStandardModule,
  openQueryManager,
  readSapScreenState,
  resolveDispatcherRootUrl,
  runQueryManagerAndExport,
  SapAutomationResult,
  SapEngineConfig,
  SapProgressCallback,
  SapScreenState,
} from './sap-engine.js';
import { runVlmFallback } from './browser-agent.js';

export interface ScreenRouterOptions {
  geminiApiKey?: string;
  maxIterations?: number;
  onStateTransition?: (info: { target: 'POS' | 'SAP'; screen: string; iteration: number }) => void;
}

const MAX_DEFAULT_ITERATIONS = 24;
const CONSECUTIVE_FAILURE_THRESHOLD = 2;

function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new Error('Workflow aborted by user'));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Workflow aborted by user'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('Workflow aborted by user');
  }
}

async function tryVlmRecovery(params: {
  tabId: number;
  goal: string;
  currentState: string;
  lastError?: string;
  consecutiveFailures: number;
  geminiApiKey?: string;
  signal?: AbortSignal;
}): Promise<{ recovered: boolean; aborted?: boolean; message: string }> {
  const { tabId, goal, currentState, lastError, consecutiveFailures, geminiApiKey, signal } = params;
  assertNotAborted(signal);

  try {
    const vlmRes = await runVlmFallback({
      tabId,
      goal,
      currentState,
      lastError,
      consecutiveFailures,
      apiKey: geminiApiKey,
    });

    if (vlmRes.action.action === 'abort') {
      return { recovered: false, aborted: true, message: vlmRes.action.reason || 'VLM requested abort' };
    }
    if (vlmRes.action.action === 'wait') {
      await sleepAbortable(Math.min(vlmRes.action.waitMs || 2500, 15000), signal);
      return { recovered: true, message: vlmRes.action.reason || 'VLM wait completed' };
    }
    if (vlmRes.action.action === 'done') {
      return { recovered: true, message: vlmRes.action.reason || 'VLM indicates goal reached' };
    }
    if (vlmRes.executed && vlmRes.outcome?.ok) {
      await sleepAbortable(800, signal);
      return { recovered: true, message: vlmRes.outcome.message };
    }
    return {
      recovered: false,
      message: vlmRes.outcome?.message || vlmRes.action.reason || 'VLM fallback did not execute cleanly',
    };
  } catch (err: any) {
    return { recovered: false, message: err?.message || 'VLM fallback unavailable' };
  }
}

// ============================================================
// POS Goal-Driven Screen Router
// ============================================================
export async function routePosLoginCheck(
  tabId: number,
  cfg: PosEngineConfig,
  onProgress: PosProgressCallback,
  signal?: AbortSignal,
  options: ScreenRouterOptions = {}
): Promise<PosLoginResult> {
  const maxIterations = options.maxIterations ?? 12;
  let consecutiveFailures = 0;
  let lastError: string | undefined;

  try {
    for (let iter = 1; iter <= maxIterations; iter++) {
      assertNotAborted(signal);
      const state: PosScreenState = await readPosScreenState(tabId);
      options.onStateTransition?.({ target: 'POS', screen: state.screen, iteration: iter });

      if (state.isLoading || state.screen === 'LOADING_DATA') {
        onProgress('POS đang tải dữ liệu, chờ hoàn tất...', 40);
        await waitForLoadingWaveToEnd(tabId, POS_LOADING_WAIT_TIMEOUT_MS, signal);
        consecutiveFailures = 0;
        continue;
      }

      if (state.screen === 'PAGE_NOT_FOUND') {
        onProgress('Điều hướng lại về trang chủ POS...', 20);
        await chrome.tabs.update(tabId, { url: normalizePosBaseUrl(cfg.posUrl) });
        await sleepAbortable(2000, signal);
        continue;
      }

      if (state.screen === 'LOGIN' || state.screen === 'SELECT_OUTLET') {
        try {
          onProgress('Đang đăng nhập & chọn Outlet POS...', 55);
          await ensureAuthenticated(tabId, cfg, onProgress, signal);
          consecutiveFailures = 0;
          lastError = undefined;
          continue;
        } catch (err: any) {
          consecutiveFailures++;
          lastError = err?.message || 'Lỗi đăng nhập POS';
          if (consecutiveFailures < CONSECUTIVE_FAILURE_THRESHOLD) {
            await sleepAbortable(1200, signal);
            continue;
          }
        }
      }

      if (
        state.screen === 'DASHBOARD' ||
        state.screen === 'INVENTORY_ONHAND' ||
        state.screen === 'SALES_DETAIL'
      ) {
        onProgress('Đăng nhập POS & Outlet hợp lệ!', 100);
        return {
          ok: true,
          url: state.url,
          message: `Đã xác nhận đăng nhập POS (${cfg.preferredOutlet || 'FM04'})`,
        };
      }

      // UNKNOWN, unexpected popup (MORE_MODAL / HEADER_FILTER_POPUP), or >= 2 consecutive failures
      const vlm = await tryVlmRecovery({
        tabId,
        goal: `Log into POS RPFO and reach dashboard for outlet ${cfg.preferredOutlet || 'FM04'}`,
        currentState: state.screen,
        lastError,
        consecutiveFailures,
        geminiApiKey: options.geminiApiKey,
        signal,
      });
      if (vlm.aborted) {
        return { ok: false, url: state.url, message: vlm.message };
      }
      if (!vlm.recovered) {
        consecutiveFailures++;
        lastError = vlm.message;
        if (consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD + 2) {
          return { ok: false, url: state.url, message: lastError || 'Không thể xác minh đăng nhập POS' };
        }
        await sleepAbortable(1500, signal);
      } else {
        consecutiveFailures = 0;
      }
    }

    return { ok: false, url: cfg.posUrl, message: lastError || 'Quá số bước kiểm tra đăng nhập POS' };
  } finally {
    await cleanupPosOverlay(tabId).catch(() => {});
  }
}

export async function routePosReportDownload(
  tabId: number,
  reportType: 'SALES' | 'INVENTORY',
  cfg: PosEngineConfig,
  onProgress: PosProgressCallback,
  signal?: AbortSignal,
  options: ScreenRouterOptions = {}
): Promise<PosDownloadResult> {
  const maxIterations = options.maxIterations ?? MAX_DEFAULT_ITERATIONS;
  const isSales = reportType === 'SALES';
  const targetScreen = isSales ? 'SALES_DETAIL' : 'INVENTORY_ONHAND';
  const reportName = isSales ? 'Sales Transaction Detail' : 'Inventory Onhand';
  const fallbackPath = isSales ? '/admin/report/sales-transaction-detail' : '/admin/report/inventory-onhand';
  const exportSelectors = isSales ? POS_SALES_EXPORT_SELECTORS : POS_INVENTORY_EXPORT_SELECTORS;

  const fallbackRange = getPreviousWeekRange(cfg.weekConvention);
  const fromDate = cfg.fromDate || fallbackRange.fromDate;
  const toDate = cfg.toDate || fallbackRange.toDate;
  const fallbackFilename = resolveFilename(
    cfg.fileNameTemplate || (isSales ? 'POS_Sales_{from}_{to}.xlsx' : 'POS_Inventory_{date}.xlsx'),
    {
      from: fromDate,
      to: toDate,
      date: formatDateYmd(new Date()),
      outlet: cfg.preferredOutlet || 'FM04',
    }
  );

  let consecutiveFailures = 0;
  let lastError: string | undefined;
  let hasSearched = false;

  try {
    for (let iter = 1; iter <= maxIterations; iter++) {
      assertNotAborted(signal);
      const state: PosScreenState = await readPosScreenState(tabId);
      options.onStateTransition?.({ target: 'POS', screen: state.screen, iteration: iter });

      if (state.isLoading || state.screen === 'LOADING_DATA') {
        onProgress(`[${reportType}] Đang tải dữ liệu POS (chờ tối đa 12 phút)...`, 55);
        await waitForLoadingWaveToEnd(tabId, POS_LOADING_WAIT_TIMEOUT_MS, signal);
        consecutiveFailures = 0;
        continue;
      }

      if (state.screen === 'PAGE_NOT_FOUND') {
        onProgress(`[${reportType}] Trang 404, quay lại POS...`, 15);
        await chrome.tabs.update(tabId, { url: normalizePosBaseUrl(cfg.posUrl) });
        await sleepAbortable(2000, signal);
        continue;
      }

      if (state.screen === 'LOGIN' || state.screen === 'SELECT_OUTLET') {
        try {
          onProgress(`[${reportType}] Đăng nhập POS & chọn Outlet...`, 20);
          await ensureAuthenticated(tabId, cfg, onProgress, signal);
          consecutiveFailures = 0;
          lastError = undefined;
          continue;
        } catch (err: any) {
          consecutiveFailures++;
          lastError = err?.message || 'Lỗi đăng nhập POS';
        }
      } else if (state.screen !== targetScreen && state.screen !== 'UNKNOWN' && !state.activeOverlayBlocking) {
        try {
          onProgress(`[${reportType}] Điều hướng tới ${reportName}...`, 30);
          await navigateToReport(tabId, reportName, fallbackPath, cfg.posUrl, onProgress, signal);
          hasSearched = false;
          consecutiveFailures = 0;
          lastError = undefined;
          continue;
        } catch (err: any) {
          consecutiveFailures++;
          lastError = err?.message || `Không thể mở ${reportName}`;
        }
      } else if (state.screen === targetScreen && !state.activeOverlayBlocking) {
        // Goal-driven shortcut: if grid already has rows, skip Search and jump straight to Filter/Export!
        if (state.gridRowCount > 0 && state.hasExportButton) {
          try {
            if (!isSales) {
              const slocs = parseFilterValues(cfg.slocFilter);
              if (slocs.length > 0) {
                onProgress(`[${reportType}] Bảng đã có ${state.gridRowCount} dòng — lọc ${slocs.length} SLOC...`, 78);
                await setGridFilter(tabId, 'SlocId', slocs, signal);
              }
              const items = parseFilterValues(cfg.itemFilter);
              if (items.length > 0) {
                onProgress(`[${reportType}] Lọc mã hàng...`, 82);
                await setGridFilter(tabId, 'ItemCode', items, signal);
              }
            } else {
              onProgress(`[${reportType}] Bảng đã có ${state.gridRowCount} dòng — nhảy thẳng tới Export Excel...`, 82);
            }

            const downloaded = await triggerExportAndCapture(
              tabId,
              exportSelectors,
              ['Excel', 'Export'],
              fallbackFilename,
              signal
            );
            if (downloaded) {
              onProgress(`[${reportType}] Xuất Excel thành công: ${downloaded.filename}`, 100);
              return {
                ok: true,
                downloadId: downloaded.downloadId,
                filename: downloaded.filename,
                message: `Đã tải ${downloaded.filename}`,
              };
            }
            consecutiveFailures++;
            lastError = 'Không bắt được tệp tải xuống sau khi nhấn Export';
          } catch (err: any) {
            consecutiveFailures++;
            lastError = err?.message || 'Lỗi khi lọc/xuất Excel';
          }
        } else if (!hasSearched) {
          // Grid is empty: apply search parameters & trigger Search
          try {
            onProgress(`[${reportType}] Thiết lập bộ lọc & tìm kiếm...`, 45);
            if (cfg.storeFilter) {
              await setStoreFilter(tabId, cfg.storeFilter, signal);
            }
            if (isSales) {
              await setDateFilter(tabId, 'from', fromDate);
              await setDateFilter(tabId, 'to', toDate);
            }
            const searched = await triggerPosSearch(tabId, 'Search', signal);
            if (!searched) {
              throw new Error('Không tìm thấy nút Search trên báo cáo POS');
            }
            hasSearched = true;
            onProgress(`[${reportType}] Đã bấm Search, chờ POS xử lý...`, 55);
            await waitForLoadingWaveToEnd(tabId, POS_LOADING_WAIT_TIMEOUT_MS, signal);
            consecutiveFailures = 0;
            lastError = undefined;
            continue;
          } catch (err: any) {
            consecutiveFailures++;
            lastError = err?.message || 'Lỗi khi thiết lập bộ lọc/Search';
          }
        } else {
          // Already searched, still 0 rows: check if export is available or report empty
          onProgress(`[${reportType}] Không có dữ liệu hiển thị sau khi tìm kiếm.`, 95);
          return {
            ok: true,
            message: `Báo cáo ${reportName} không có dữ liệu trong khoảng lọc đã chọn`,
          };
        }
      }

      // Trigger VLM fallback on UNKNOWN, unexpected popup/overlay, or 2 consecutive failures
      const shouldInvokeVlm =
        state.screen === 'UNKNOWN' ||
        state.activeOverlayBlocking ||
        state.screen === 'MORE_MODAL' ||
        state.screen === 'HEADER_FILTER_POPUP' ||
        consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD;

      if (shouldInvokeVlm) {
        onProgress(`[${reportType}] Gọi VLM Fallback xử lý màn hình (${state.screen})...`, 60);
        const vlm = await tryVlmRecovery({
          tabId,
          goal: `Navigate to ${reportName}, resolve any popup/overlay, and export Excel`,
          currentState: state.screen,
          lastError,
          consecutiveFailures,
          geminiApiKey: options.geminiApiKey,
          signal,
        });
        if (vlm.aborted) {
          return { ok: false, message: vlm.message };
        }
        if (vlm.recovered) {
          consecutiveFailures = 0;
          lastError = undefined;
          continue;
        }
        consecutiveFailures++;
        lastError = vlm.message;
      }

      if (consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD + 2) {
        return { ok: false, message: lastError || `Thất bại liên tiếp trên POS (${state.screen})` };
      }
      await sleepAbortable(1500, signal);
    }

    return { ok: false, message: lastError || `Quá số bước thực thi cho ${reportName}` };
  } finally {
    await cleanupPosOverlay(tabId).catch(() => {});
  }
}

// ============================================================
// SAP B1 Goal-Driven Screen Router
// ============================================================
export async function routeSapAutomation(
  tabId: number,
  cfg: SapEngineConfig,
  onProgress: SapProgressCallback,
  signal?: AbortSignal,
  options: ScreenRouterOptions = {}
): Promise<SapAutomationResult> {
  const maxIterations = options.maxIterations ?? MAX_DEFAULT_ITERATIONS;
  const queryCategory = cfg.queryCategory || 'Danh mục';
  const queryName = cfg.queryName || 'Danh sach item ncc pricelist_non_Asset';
  let consecutiveFailures = 0;
  let lastError: string | undefined;

  for (let iter = 1; iter <= maxIterations; iter++) {
    assertNotAborted(signal);
    const state: SapScreenState = await readSapScreenState(tabId);
    options.onStateTransition?.({ target: 'SAP', screen: state.screen, iteration: iter });

    if (state.isLoading || state.screen === 'INITIALIZING') {
      onProgress('SAP B1 đang khởi tạo/tải dữ liệu...', 30);
      await sleepAbortable(1500, signal);
      consecutiveFailures = 0;
      continue;
    }

    if (state.screen === 'SAML_ERROR') {
      onProgress('Phát hiện lỗi SAML, tải lại SAP Dispatcher...', 15);
      const rootUrl = resolveDispatcherRootUrl(cfg.sapUrl, state.url);
      await chrome.tabs.update(tabId, { url: rootUrl });
      await sleepAbortable(2500, signal);
      continue;
    }

    if (state.screen === 'SLD_LOGON') {
      try {
        onProgress('Đang đăng nhập SAP SLD Logon...', 20);
        const logonRes = await fillAndSubmitLogonForm(tabId, cfg, signal);
        if (!logonRes.ok) {
          throw new Error(logonRes.retryReason || 'Đăng nhập SAP SLD thất bại');
        }
        await sleepAbortable(2000, signal);
        consecutiveFailures = 0;
        lastError = undefined;
        continue;
      } catch (err: any) {
        consecutiveFailures++;
        lastError = err?.message || 'Lỗi SLD Logon';
      }
    } else if (state.screen === 'CONCURRENT_LOGIN') {
      try {
        onProgress('Xử lý hộp thoại trùng phiên SAP...', 28);
        const authRes = await checkAndHandleAuthDialog(tabId, cfg.autoTakeOverSession ?? true, signal);
        if (authRes.status === 'concurrent_blocked' || authRes.status === 'auth_failed') {
          return { ok: false, message: authRes.message || 'SAP từ chối đăng nhập' };
        }
        await sleepAbortable(1500, signal);
        consecutiveFailures = 0;
        lastError = undefined;
        continue;
      } catch (err: any) {
        consecutiveFailures++;
        lastError = err?.message || 'Lỗi xử lý trùng phiên SAP';
      }
    } else if (state.screen === 'SYSTEM_MESSAGES_LOG') {
      onProgress('Đóng System Messages Log...', 40);
      await dismissSystemMessagesLog(tabId, signal);
      await sleepAbortable(1000, signal);
      consecutiveFailures = 0;
      continue;
    } else if (state.screen === 'WORKSPACE_READY') {
      if (cfg.targetModule === 'HOME') {
        onProgress('SAP B1 Workspace đã sẵn sàng!', 100);
        return { ok: true, message: 'Đăng nhập SAP Business One thành công!' };
      }

      if (cfg.targetModule && cfg.targetModule !== 'QUERY_PRICELIST') {
        try {
          onProgress(`Điều hướng tới module ${cfg.targetModule}...`, 65);
          const ok = await navigateToStandardModule(tabId, cfg.targetModule, onProgress, signal);
          if (!ok) throw new Error(`Không thể mở module ${cfg.targetModule}`);
          onProgress(`Đã mở module ${cfg.targetModule}`, 100);
          return { ok: true, message: `Đã mở module ${cfg.targetModule}` };
        } catch (err: any) {
          consecutiveFailures++;
          lastError = err?.message || `Lỗi mở module ${cfg.targetModule}`;
        }
      } else {
        try {
          onProgress('Mở Query Manager trên SAP B1...', 55);
          const opened = await openQueryManager(tabId, signal);
          if (!opened) throw new Error('Không thể mở Query Manager');
          await sleepAbortable(1200, signal);
          consecutiveFailures = 0;
          lastError = undefined;
          continue;
        } catch (err: any) {
          consecutiveFailures++;
          lastError = err?.message || 'Lỗi mở Query Manager';
        }
      }
    } else if (
      state.screen === 'QUERY_MANAGER' ||
      state.screen === 'QUERY_RESULT' ||
      state.screen === 'SAVE_AS_DIALOG' ||
      state.screen === 'CURRENCY_DIALOG'
    ) {
      try {
        onProgress(`Thực thi Query "${queryName}" & xuất .xlsx...`, 75);
        const exportRes = await runQueryManagerAndExport(tabId, queryCategory, queryName, onProgress, signal);
        if (exportRes.ok) {
          onProgress(exportRes.message || 'Xuất Price List SAP thành công!', 100);
          return exportRes;
        }
        throw new Error(exportRes.message || 'Xuất Query Manager thất bại');
      } catch (err: any) {
        consecutiveFailures++;
        lastError = err?.message || 'Lỗi trong Query Manager / Export';
      }
    }

    // VLM fallback on UNKNOWN or >= 2 consecutive failures
    if (state.screen === 'UNKNOWN' || consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD) {
      onProgress(`Gọi VLM Fallback xử lý màn hình SAP (${state.screen})...`, 50);
      const vlm = await tryVlmRecovery({
        tabId,
        goal: `Navigate SAP B1 to ${cfg.targetModule || 'QUERY_PRICELIST'} (${queryName}) and export .xlsx`,
        currentState: state.screen,
        lastError,
        consecutiveFailures,
        geminiApiKey: options.geminiApiKey,
        signal,
      });
      if (vlm.aborted) {
        return { ok: false, message: vlm.message };
      }
      if (vlm.recovered) {
        consecutiveFailures = 0;
        lastError = undefined;
        continue;
      }
      consecutiveFailures++;
      lastError = vlm.message;
    }

    if (consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD + 2) {
      return { ok: false, message: lastError || `Thất bại liên tiếp trên SAP (${state.screen})` };
    }
    await sleepAbortable(1500, signal);
  }

  return { ok: false, message: lastError || 'Quá số bước thực thi SAP B1' };
}
