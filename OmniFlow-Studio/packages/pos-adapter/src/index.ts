// FM AUTO OPS — POS RPFO Automation Adapter
// Direct implementation based on verified DOM and live network inspection
// Verified login form: #txtName, #txtPassword, input[type="submit"]
// Verified outlet select: .blog-sider-common -> /admin/dashboard
// Verified reports: /admin/report/sales-transaction-detail & /admin/report/inventory-onhand

import { Page, Download } from 'playwright';
import { format, isValid } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import os from 'os';
import ExcelJS from 'exceljs';
import { POS_SELECTORS } from './selectors';
import { BrowserManager } from '@fm/browser-engine';
import { resolveNamingTemplate } from '@fm/file-engine';

const TIMEZONE = 'Asia/Ho_Chi_Minh';

export interface POSSessionState {
  isAuthenticated: boolean;
  dashboardVisible: boolean;
  currentUrl: string;
  detectedAt: string;
}

export interface InventoryDownloadOptions {
  storeFilter?: string;
  slocFilter?: string;
  itemFilter?: string;
  outputDir?: string;
  fileNameTemplate?: string;
  orgCode?: string;
}

export interface SalesDownloadOptions {
  fromDate?: string; // YYYY-MM-DD
  toDate?: string;   // YYYY-MM-DD
  storeFilter?: string;
  outputDir?: string;
  fileNameTemplate?: string;
  orgCode?: string;
  inventorySlocFilter?: string;
  inventoryItemFilter?: string;
}

export function parseFilterValues(raw?: string | string[]): string[] {
  const values = raw == null ? [] : Array.isArray(raw) ? raw : String(raw).split(/[,;]+/);
  return values.map((value) => String(value).trim())
    .filter((value) => value.length > 0 && !['all', 'all_sloc'].includes(value.toLowerCase()));
}

export interface POSDownloadResult {
  reportType: 'INVENTORY' | 'SALES';
  suggestedFilename: string;
  tempFilePath: string;
  downloadedAt: string;
}

export interface POSCredentials {
  username: string;
  password: string;
}

export interface POSLoginOptions extends POSCredentials {
  maxRetries?: number;
  retryDelayMs?: number;
  onProgress?: (msg: string) => void;
}

export interface GridFilterOptions {
  mode?: 'auto' | 'api' | 'dom';
  timeout?: number;
}

/**
 * Resolves column field alias, technical name, and caption titles.
 */
export function resolveColumnIdentifiers(columnField: string): { dataField: string; titles: string[] } {
  const norm = columnField.trim().toLowerCase();
  if (norm === 'slocid' || norm === 'sloc id' || norm === 'sloc') {
    return { dataField: 'slocId', titles: ['Sloc Id', 'Sloc', 'Kho'] };
  }
  if (norm === 'itemcode' || norm === 'item code' || norm === 'item') {
    return { dataField: 'itemCode', titles: ['Item Code', 'Item', 'Mã sản phẩm', 'Mã'] };
  }
  if (norm === 'storeid' || norm === 'store id' || norm === 'store') {
    return { dataField: 'storeId', titles: ['Store Id', 'Store', 'Cửa hàng'] };
  }
  if (norm === 'whsname' || norm === 'whs name') {
    return { dataField: 'whsName', titles: ['Whs Name', 'Tên kho'] };
  }
  if (norm === 'itemname' || norm === 'item name') {
    return { dataField: 'itemName', titles: ['Item Name', 'Tên sản phẩm'] };
  }
  return { dataField: columnField, titles: [columnField] };
}

/**
 * Filter DevExpress DataGrid by column and value.
 * Supports Mode A (DevExtreme JS API) with fallback to Mode B (DOM Header Filter Popup matching Hình 5).
 */
export async function setGridFilter(
  page: Page,
  columnField: string,
  value: string | string[],
  options?: GridFilterOptions
): Promise<boolean> {
  const mode = options?.mode || 'auto';
  const resolved = resolveColumnIdentifiers(columnField);
  const filterVals = parseFilterValues(value);

  // 1. Mode A: DevExtreme dxDataGrid API (with jQuery fallback for Angular DevExtreme)
  if (mode === 'auto' || mode === 'api') {
    try {
      const apiSuccess = await page.evaluate(({ dataField, titles, vals }) => {
        const gridEl = document.querySelector('.dx-datagrid');
        if (!gridEl) return false;

        // Try DevExpress global first, then jQuery wrapper
        let grid: any = null;
        const devExpress = (window as any).DevExpress;
        if (devExpress?.ui?.dxDataGrid) {
          grid = devExpress.ui.dxDataGrid.getInstance(gridEl);
        }
        if (!grid) {
          const jq = (window as any).jQuery;
          if (jq) {
            try { grid = jq(gridEl).dxDataGrid('instance'); } catch { /* ignore */ }
          }
        }
        if (!grid) return false;

        let targetField = dataField;
        if (typeof grid.getColumns === 'function') {
          const cols = grid.getColumns();
          const match = cols.find((c: any) =>
            c.dataField === dataField ||
            titles.some((t: string) => t.toLowerCase() === (c.caption || '').toLowerCase()) ||
            titles.some((t: string) => t.toLowerCase() === (c.dataField || '').toLowerCase()) ||
            (c.name && titles.some((t: string) => t.toLowerCase() === c.name.toLowerCase()))
          );
          if (match) {
            targetField = match.dataField || match.name || match.caption || dataField;
          }
        }

        if (vals.length === 0) {
          grid.columnOption(targetField, 'filterValues', []);
        } else {
          // Build filter expression
          const filterExpr = vals.length === 1
            ? [targetField, '=', vals[0]]
            : vals.flatMap((v: string, idx: number) => idx === 0 ? [[targetField, '=', v]] : ['or', [targetField, '=', v]]);
          try { grid.filter(filterExpr); } catch { /* non-fatal */ }
          grid.columnOption(targetField, 'filterValues', vals);
          grid.columnOption(targetField, 'filterType', 'include');
        }
        if (typeof grid.refresh === 'function') grid.refresh();
        return true;
      }, { dataField: resolved.dataField, titles: resolved.titles, vals: filterVals });

      if (apiSuccess) {
        await page.waitForTimeout(200);
        await page.waitForTimeout(200);
        return true;
      }
    } catch {
      if (mode === 'api') return false;
    }
  }

  // 2. Mode B: DOM Header Filter Popup Automation (Matching Hình 5)
  if (mode === 'auto' || mode === 'dom') {
    try {
      let headerCell: any = null;
      for (const title of resolved.titles) {
        const loc = page.locator('.dx-header-row td, .dx-datagrid-headers th, .dx-datagrid-headers td')
          .filter({ hasText: title })
          .first();
        if (await loc.isVisible().catch(() => false)) {
          headerCell = loc;
          break;
        }
      }

      if (!headerCell) {
        const fallbackLoc = page.locator(`.dx-header-row td[data-field="${resolved.dataField}"]`).first();
        if (await fallbackLoc.isVisible().catch(() => false)) {
          headerCell = fallbackLoc;
        }
      }

      if (!headerCell) return false;

      // Click filter icon
      const filterIcon = headerCell.locator('.dx-header-filter').first();
      if (!(await filterIcon.isVisible().catch(() => false))) {
        return false;
      }
      await filterIcon.click();

      // Wait for popup menu
      const popup = page.locator(
        '.dx-header-filter-menu, .dx-overlay-content:has(.dx-header-filter-menu), .dx-popup-content:has(input[placeholder*="Search"]), .dx-header-filter-menu-search'
      ).first();
      await popup.waitFor({ state: 'visible', timeout: 5000 });

      // Uncheck "(Select All)" / "(Chọn tất cả)" first to deselect all existing selections
      const selectAllItem = popup.locator('.dx-list-item, .dx-item').filter({
        hasText: /^\s*[\(\（]?(Select All|Chọn tất cả|Tất cả)[\)\）]?\s*$/i
      }).first();
      if (await selectAllItem.isVisible().catch(() => false)) {
        const selectAllCheckbox = selectAllItem.locator('.dx-checkbox, input[type="checkbox"]').first();
        if (await selectAllCheckbox.isVisible().catch(() => false)) {
          const isChecked = (await selectAllCheckbox.getAttribute('aria-checked').catch(() => null)) === 'true'
            || (await selectAllCheckbox.locator('.dx-checkbox-checked').count().catch(() => 0)) > 0;
          if (isChecked) await selectAllCheckbox.click();
        } else {
          await selectAllItem.click();
        }
        await page.waitForTimeout(150);
      }

      for (const targetVal of filterVals) {
        // Clear search box and type the value
        const searchInput = popup.locator('input.dx-texteditor-input, input[placeholder*="Search"], input[type="text"]').first();
        if (await searchInput.isVisible().catch(() => false)) {
          await searchInput.fill('');
          await searchInput.fill(targetVal);
          await page.waitForTimeout(250);
        }

        const listItem = popup.locator('.dx-list-item, .dx-item').filter({ hasText: targetVal }).first();
        if (await listItem.isVisible().catch(() => false)) {
          const checkbox = listItem.locator('.dx-checkbox, input[type="checkbox"]').first();
          if (await checkbox.isVisible().catch(() => false)) {
            const alreadyChecked = typeof checkbox.getAttribute === 'function'
              ? await checkbox.getAttribute('aria-checked').catch(() => null)
              : null;
            const checkedClass = await checkbox.locator('.dx-checkbox-checked').count().catch(() => 0);
            if (alreadyChecked !== 'true' && checkedClass === 0) await checkbox.click();
          } else {
            await listItem.click();
          }
        }
      }

      // Click OK
      const okBtn = popup.locator('.dx-button:has-text("OK"), button:has-text("OK"), .dx-popup-bottom .dx-button').first();
      if (await okBtn.isVisible().catch(() => false)) {
        await okBtn.click();
      }

      // Wait for popup and loadpanel to hide, then wait for loading wave to complete
      await popup.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => null);
      await page.waitForSelector('.dx-loadpanel:visible', { state: 'hidden', timeout: 25000 }).catch(() => null);
      await page.waitForTimeout(300);

      return true;
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Tier-2 Filter: Post-download Excel integrity enforcement.
 * Removes rows that don't match the specified filter criteria.
 * This is a safety net to guarantee exported data matches the requested filters
 * regardless of whether the in-app grid filters were applied correctly.
 */
export async function enforceExcelFilterIntegrity(
  filePath: string,
  filterSpec: { stores?: string[]; slocs?: string[]; items?: string[] }
): Promise<{ rowCount: number; filtered: boolean }> {
  const hasStoreFilter = (filterSpec.stores?.length ?? 0) > 0;
  const hasSlocFilter = (filterSpec.slocs?.length ?? 0) > 0;
  const hasItemFilter = (filterSpec.items?.length ?? 0) > 0;

  if (!hasStoreFilter && !hasSlocFilter && !hasItemFilter) {
    return { rowCount: -1, filtered: false };
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) return { rowCount: 0, filtered: false };

  // Find header row (row 1) and locate relevant column indices
  const headerRow = worksheet.getRow(1);
  let storeColIdx = -1;
  let slocColIdx = -1;
  let itemCodeColIdx = -1;
  let itemNameColIdx = -1;

  headerRow.eachCell((cell, colNumber) => {
    const header = String(cell.value ?? '').trim().toLowerCase();
    if (['store id', 'storeid', 'cửa hàng'].includes(header)) storeColIdx = colNumber;
    else if (['sloc id', 'slocid', 'mã kho'].includes(header)) slocColIdx = colNumber;
    else if (['item code', 'itemcode', 'mã hàng'].includes(header)) itemCodeColIdx = colNumber;
    else if (['item name', 'itemname', 'tên hàng'].includes(header)) itemNameColIdx = colNumber;
  });

  const storeFiltersLC = (filterSpec.stores ?? []).map((s) => s.toLowerCase());
  const slocFiltersLC = (filterSpec.slocs ?? []).map((s) => s.toLowerCase());
  const itemFiltersLC = (filterSpec.items ?? []).map((s) => s.toLowerCase());

  // Collect row numbers to delete (iterate in reverse to preserve indices)
  const rowsToDelete: number[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // skip header

    const getCellVal = (colIdx: number): string =>
      colIdx > 0 ? String(row.getCell(colIdx).value ?? '').trim().toLowerCase() : '';

    const storeVal = getCellVal(storeColIdx);
    const slocVal = getCellVal(slocColIdx);
    const itemCodeVal = getCellVal(itemCodeColIdx);
    const itemNameVal = getCellVal(itemNameColIdx);

    let keep = true;

    if (hasStoreFilter && storeColIdx > 0) {
      const matches = storeFiltersLC.some((f) => storeVal.includes(f));
      if (!matches) keep = false;
    }

    if (keep && hasSlocFilter && slocColIdx > 0) {
      const matches = slocFiltersLC.some((f) => slocVal.includes(f));
      if (!matches) keep = false;
    }

    if (keep && hasItemFilter && (itemCodeColIdx > 0 || itemNameColIdx > 0)) {
      const matches = itemFiltersLC.some((f) =>
        (itemCodeColIdx > 0 && itemCodeVal.includes(f)) ||
        (itemNameColIdx > 0 && itemNameVal.includes(f))
      );
      if (!matches) keep = false;
    }

    if (!keep) rowsToDelete.push(rowNumber);
  });

  // Delete rows in reverse order to keep indices stable
  for (let i = rowsToDelete.length - 1; i >= 0; i--) {
    worksheet.spliceRows(rowsToDelete[i], 1);
  }

  await workbook.xlsx.writeFile(filePath);

  const remainingRows = worksheet.rowCount > 1 ? worksheet.rowCount - 1 : 0;
  return { rowCount: remainingRows, filtered: true };
}

export class POSAdapter {
  private browserManager: BrowserManager;
  private baseUrl: string;

  constructor(browserManager: BrowserManager, baseUrl = process.env.POS_URL || '') {
    this.browserManager = browserManager;
    this.baseUrl = baseUrl ? (baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`) : '';
    if (!this.baseUrl) throw new Error('POS URL is not configured. Set it in the POS connection settings before automation.');
  }

  /**
   * Helper to check whether POS session is already authenticated and ready.
   */
  private async isPOSAuthenticated(page: Page): Promise<boolean> {
    const url = page.url();
    // If on login or select outlets, definitely not yet authenticated
    if (url.includes('/home') || url.includes('select-outlets')) {
      return false;
    }
    // Check if dashboard or admin or shop indicator is visible
    const hasAdminOrShop = url.includes('/admin') || url.includes('/shop');
    const hasIndicator = (await page.locator(
      ':text("IN SHOP"), :text("Dashboard"), .blog-sider-common, a[href*="logout"], a[href*="admin"], .dx-datagrid'
    ).count().catch(() => 0)) > 0;

    return hasAdminOrShop || hasIndicator;
  }

  /**
   * Ensure user is authenticated into POS with continuous retry loop.
   * Handles transient network errors, redirects, session kickouts, and outlet selection.
   */
  async ensureAuthenticated(
    credentials?: POSCredentials,
    options?: { maxRetries?: number; onProgress?: (msg: string) => void; retryDelayMs?: number }
  ): Promise<Page> {
    const page = await this.browserManager.getPage('POS');
    const maxRetries = options?.maxRetries ?? 15;
    const retryDelay = options?.retryDelayMs ?? 2000;
    const onProgress = options?.onProgress;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const currentUrl = page.url();

        // 1. Initial navigation if not on POS site
        if (!currentUrl.startsWith(this.baseUrl) || currentUrl === 'about:blank') {
          onProgress?.(`Đang kết nối POS RPFO (${this.baseUrl}) - Lần ${attempt}/${maxRetries}...`);
          await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
          await page.waitForTimeout(1500);
        }

        // 2. Check if already authenticated
        if (await this.isPOSAuthenticated(page)) {
          const hasLoginForm = page.url().includes('/home') || (await page.locator('#txtName').count().catch(() => 0)) > 0;
          if (!hasLoginForm) {
            return page;
          }
        }

        // 3. Handle Outlet selection if displayed
        const hasOutlets = page.url().includes('select-outlets') || (await page.locator('.blog-sider-common').count().catch(() => 0)) > 0;
        if (hasOutlets) {
          onProgress?.(`Phát hiện màn hình chọn Outlet/Cửa hàng - Đang chọn cửa hàng (Lần ${attempt}/${maxRetries})...`);
          const outletCard = page.locator('.blog-sider-common').first();
          if (await outletCard.isVisible().catch(() => false)) {
            await outletCard.click().catch(() => null);
            await page.waitForTimeout(3000);
          }
          if (await this.isPOSAuthenticated(page)) {
            return page;
          }
        }

        // 4. Handle Login Form if displayed
        const loginFormVisible = page.url().includes('/home') || (await page.locator('#txtName, input[name*="user" i]').count().catch(() => 0)) > 0;
        if (loginFormVisible) {
          if (!credentials?.username || !credentials?.password) {
            throw new Error('POS login is required, but no POS credentials are saved. Please configure in Settings.');
          }

          onProgress?.(`Đang điền thông tin và đăng nhập POS RPFO (Lần ${attempt}/${maxRetries})...`);

          const userInput = page.locator('#txtName, input[name*="user" i]').first();
          const passInput = page.locator('#txtPassword, input[type="password"]').first();

          if (await userInput.isVisible().catch(() => false)) {
            await userInput.click().catch(() => null);
            await userInput.fill(credentials.username);
          }
          if (await passInput.isVisible().catch(() => false)) {
            await passInput.click().catch(() => null);
            await passInput.fill(credentials.password);
          }

          const submitBtn = page.locator('input[type="submit"], button:has-text("Login"), button[type="submit"]').first();
          if (await submitBtn.isVisible().catch(() => false)) {
            await submitBtn.click().catch(() => null);
          }

          // Wait settlement
          await page.waitForTimeout(3000);

          // Check if outlet selection screen appears immediately after login
          const postLoginOutlets = page.url().includes('select-outlets') || (await page.locator('.blog-sider-common').count().catch(() => 0)) > 0;
          if (postLoginOutlets) {
            onProgress?.('Đang hoàn tất chọn điểm bán Outlet sau đăng nhập...');
            const outletCard = page.locator('.blog-sider-common').first();
            if (await outletCard.isVisible().catch(() => false)) {
              await outletCard.click().catch(() => null);
              await page.waitForTimeout(3000);
            }
          }

          // Check if now successfully authenticated
          if (await this.isPOSAuthenticated(page)) {
            onProgress?.('Đăng nhập POS RPFO thành công!');
            return page;
          }

          // Check for error toast or alert
          const errorMsg = await page.evaluate(() => {
            const el = document.querySelector('.alert, .toast-error, .text-danger, .error-message');
            return el ? (el.textContent || '').trim() : '';
          }).catch(() => '');

          if (errorMsg) {
            onProgress?.(`Thông báo từ POS: ${errorMsg}`);
            if (/sai|không đúng|locked|khoá|invalid/i.test(errorMsg)) {
              // Fatal auth failure early exit
              throw new Error(`Đăng nhập POS thất bại: ${errorMsg}`);
            }
          }
        }

        // If not authenticated yet and not reached max retries, reload and retry
        if (attempt < maxRetries) {
          onProgress?.(`Chưa vào được trang POS, đang tải lại trang để thử lại (Lần ${attempt + 1}/${maxRetries})...`);
          await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
          await page.waitForTimeout(retryDelay);
        }
      } catch (err) {
        const errorText = (err as Error).message;
        if (/không đúng|locked|khoá|invalid|no POS credentials/i.test(errorText)) {
          throw err;
        }
        onProgress?.(`Lần thử đăng nhập POS ${attempt} gặp lỗi mạng/kết nối: ${errorText}. Thử lại...`);
        if (attempt >= maxRetries) {
          throw err;
        }
        await page.waitForTimeout(retryDelay);
      }
    }

    if (await this.isPOSAuthenticated(page)) {
      return page;
    }

    throw new Error(`Đã thử đăng nhập POS liên tục ${maxRetries} lần nhưng chưa vào được hệ thống.`);
  }

  /**
   * Check if the POS session is currently valid.
   */
  async checkSession(credentials?: POSCredentials): Promise<POSSessionState> {
    try {
      const page = await this.ensureAuthenticated(credentials, { maxRetries: 2 });
      return {
        isAuthenticated: true,
        dashboardVisible: true,
        currentUrl: page.url(),
        detectedAt: new Date().toISOString(),
      };
    } catch {
      return {
        isAuthenticated: false,
        dashboardVisible: false,
        currentUrl: '',
        detectedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Log into POS with continuous retry loop until entered or maxRetries.
   */
  async login(
    credentials: POSCredentials,
    options?: { maxRetries?: number; onProgress?: (msg: string) => void; retryDelayMs?: number }
  ): Promise<boolean> {
    await this.ensureAuthenticated(credentials, options);
    return true;
  }

  /**
   * Download Sales Transaction Detail report.
   */
  async downloadSalesTransactionDetail(
    options: SalesDownloadOptions,
    credentials?: POSCredentials
  ): Promise<POSDownloadResult> {
    const page = await this.ensureAuthenticated(credentials);

    // Direct navigation to sales-transaction-detail
    await page.goto(`${this.baseUrl}admin/report/sales-transaction-detail`, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(3000);

    // If redirected to login, re-authenticate and navigate again
    if (page.url().includes('/home') || (await page.locator('#txtName').count()) > 0) {
      await this.ensureAuthenticated(credentials);
      await page.goto(`${this.baseUrl}admin/report/sales-transaction-detail`, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForTimeout(3000);
    }

    // Set Date Filter if provided
    try {
      if (options.fromDate) await this.setDateFilter(page, 'from', options.fromDate);
      if (options.toDate) await this.setDateFilter(page, 'to', options.toDate);
      const selectedStores = parseFilterValues(options.storeFilter);
      if (selectedStores.length === 1) {
        await this.setStoreFilter(page, selectedStores[0]);
      }
    } catch (e) {
      console.warn('Date/Store filter setting note:', (e as Error).message);
    }

    // Click Search to populate grid with auto-retry if 0 rows returned
    const searchBtn = page.locator('dx-button[icon="search"], button:has-text("Search"), a:has-text("Search")').first();
    for (let sAttempt = 1; sAttempt <= 3; sAttempt++) {
      if (await searchBtn.isVisible().catch(() => false)) {
        await searchBtn.click().catch(() => null);
      }
      await this.waitForLoadingWaveToEnd(page, 45000);
      await page.waitForTimeout(1500);

      const rowCount = await page.locator('.dx-datagrid-rowsview .dx-data-row').count().catch(() => 0);
      const isNoData = await page.locator(':text("No data")').isVisible().catch(() => false);
      if (rowCount > 0 && !isNoData) {
        break;
      }
    }

    const parsedStores = parseFilterValues(options.storeFilter);
    if (parsedStores.length > 1) {
      const applied = await this.setGridFilter(page, 'storeId', parsedStores).catch(() => false);
      if (!applied) await this.setGridFilter(page, 'slocId', parsedStores).catch(() => false);
    }

    // Wait for Search to finish and square Excel export button becomes visible (Hình 3)
    const excelBtn = page.locator(
      POS_SELECTORS.salesTransactionDetail.excelButton.primary + ', ' +
      POS_SELECTORS.salesTransactionDetail.excelButton.fallback
    ).first();
    await excelBtn.waitFor({ state: 'visible', timeout: 45000 });

    const salesStores = parseFilterValues(options.storeFilter);
    let tempFilename = resolveNamingTemplate(options.fileNameTemplate || 'Sales_{{fromDate}}_{{toDate}}.xlsx', {
      orgCode: options.orgCode || 'ORG', reportType: 'SALES', fromDate: options.fromDate || 'ALL',
      toDate: options.toDate || 'ALL', storeId: salesStores.length === 0 ? 'ALL' : salesStores.length === 1 ? salesStores[0] : `${salesStores.length}STORES`, timestamp: new Date(),
    });

    if (!tempFilename.toLowerCase().endsWith('.xlsx')) {
      tempFilename += '.xlsx';
    }
    tempFilename = tempFilename.replace(/[<>:"/\\|?*]/g, '_');

    const tempDir = join(options.outputDir || os.tmpdir(), '.omniflow-temp');
    const tempPath = join(tempDir, tempFilename);
    mkdirSync(tempDir, { recursive: true });

    // Inject Blob Hook into the page to capture client-side generated Excel blob before immediate revocation
    await page.evaluate(() => {
      (window as any).__capturedBlobs = [];
      const origCreate = URL.createObjectURL;
      URL.createObjectURL = function(blob: any) {
        if (blob instanceof Blob) {
          const reader = new FileReader();
          reader.onload = () => {
            (window as any).__capturedBlobs.push({
              type: blob.type,
              size: blob.size,
              dataUrl: reader.result
            });
          };
          reader.readAsDataURL(blob);
        }
        return origCreate.apply(this, arguments as any);
      };

      const origRevoke = URL.revokeObjectURL;
      URL.revokeObjectURL = function(url: string) {
        setTimeout(() => origRevoke.call(URL, url), 30000);
      };
    });

    // Capture either direct backend export stream OR browser download event OR blob hook
    const responsePromise = page.waitForResponse(
      (res) => (res.url().includes('Export_RPT_SalesTransactionDetail') || res.headers()['content-type']?.includes('spreadsheet')) && res.status() === 200,
      { timeout: 30000 }
    ).catch(() => null);

    const downloadPromise = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);

    await excelBtn.click();

    // Check if DevExtreme export context menu appeared (Mode B / Dropdown)
    const exportMenuItem = page.locator(
      '.dx-export-menu-item:has-text("Export all data to Excel"), ' +
      '.dx-export-menu-item, ' +
      '.dx-menu-item:has-text("Excel"), ' +
      '.dx-menu-item:has-text("Export")'
    ).first();
    if (await exportMenuItem.isVisible().catch(() => false)) {
      await exportMenuItem.click().catch(() => null);
    }

    // 1. First priority: Check Blob Hook (most reliable for client-side DevExpress export)
    for (let tick = 0; tick < 20; tick++) {
      await page.waitForTimeout(500);
      const blobs = await page.evaluate(() => (window as any).__capturedBlobs || []);
      if (blobs.length > 0 && blobs[0].dataUrl) {
        const base64Data = (blobs[0].dataUrl as string).split(',')[1];
        if (base64Data) {
          const buf = Buffer.from(base64Data, 'base64');
          if (buf.length > 500) {
            writeFileSync(tempPath, buf);
            await enforceExcelFilterIntegrity(tempPath, {
              stores: parseFilterValues(options.storeFilter),
            }).catch(() => null);
            return {
              reportType: 'SALES',
              suggestedFilename: tempFilename,
              tempFilePath: tempPath,
              downloadedAt: new Date().toISOString(),
            };
          }
        }
      }
    }

    // 2. Second priority: Direct HTTP response body
    const resp = await responsePromise;
    if (resp) {
      try {
        const buf = await resp.body();
        if (buf.length > 500) {
          writeFileSync(tempPath, buf);
          await enforceExcelFilterIntegrity(tempPath, {
            stores: parseFilterValues(options.storeFilter),
          }).catch(() => null);
          return {
            reportType: 'SALES',
            suggestedFilename: tempFilename,
            tempFilePath: tempPath,
            downloadedAt: new Date().toISOString(),
          };
        }
      } catch (err) {
        console.warn('Direct response body capture note:', (err as Error).message);
      }
    }

    // 3. Third priority: Playwright download event
    const download = await downloadPromise;
    if (download) {
      try {
        await download.saveAs(tempPath);
        await enforceExcelFilterIntegrity(tempPath, {
          stores: parseFilterValues(options.storeFilter),
        }).catch(() => null);
        return {
          reportType: 'SALES',
          suggestedFilename: tempFilename,
          tempFilePath: tempPath,
          downloadedAt: new Date().toISOString(),
        };
      } catch (err) {
        console.warn('Download saveAs note:', (err as Error).message);
      }
    }

    // If file was written via response, check if it exists
    if (existsSync(tempPath)) {
      await enforceExcelFilterIntegrity(tempPath, {
        stores: parseFilterValues(options.storeFilter),
      }).catch(() => null);
      return {
        reportType: 'SALES',
        suggestedFilename: tempFilename,
        tempFilePath: tempPath,
        downloadedAt: new Date().toISOString(),
      };
    }

    throw new Error('Failed to capture Sales Transaction Detail export file.');
  }

  /**
   * Download Inventory Onhand report.
   */
  async downloadInventoryOnhand(
    options: InventoryDownloadOptions,
    credentials?: POSCredentials
  ): Promise<POSDownloadResult> {
    const page = await this.ensureAuthenticated(credentials);

    await page.goto(`${this.baseUrl}admin/report/inventory-onhand`, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(3000);

    // If redirected to login, re-authenticate and navigate again
    if (page.url().includes('/home') || (await page.locator('#txtName').count()) > 0) {
      await this.ensureAuthenticated(credentials);
      await page.goto(`${this.baseUrl}admin/report/inventory-onhand`, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForTimeout(3000);
    }

    // Setup listener for inventory data response
    const inventoryResponsePromise = page.waitForResponse(
      (res) => res.url().includes('Get_RPT_InventoryOnHand') && res.status() === 200,
      { timeout: 35000 }
    ).catch(() => null);

    // Apply store filter on page if provided
    const parsedStores = parseFilterValues(options.storeFilter);
    if (parsedStores.length === 1) {
      await this.setStoreFilter(page, parsedStores[0]);
    }

    // R4: Inventory Onhand Search Retry and Wait Logic
    // Step 1: Wait for initial loading wave to complete
    await this.waitForLoadingWaveToEnd(page, 30000);

    // Step 2: Wait ~3 seconds (mandatory settling window per requirement)
    await page.waitForTimeout(3000);

    // Step 3: Check if data is already populated upon landing (Matching Hình 4)
    let populated = await this.isGridPopulated(page);

    if (populated) {
      // Data already loaded — DO NOT click Search! (0 search clicks)
      console.log('Inventory Onhand grid already populated after loading wave — skipping search click.');
    } else {
      // Step 4: Grid empty after initial load settlement — retry loop (up to 6 attempts)
      const searchBtn = page.locator(
        'dx-button[icon="search"], button:has-text("Search"), .btn-search, button[type="submit"]'
      ).first();

      for (let sAttempt = 1; sAttempt <= 6; sAttempt++) {
        console.log(`Inventory search attempt ${sAttempt}/6...`);
        if (await searchBtn.isVisible().catch(() => false)) {
          // Wait if search button is temporarily disabled during query
          for (let w = 0; w < 10; w++) {
            if (await searchBtn.isEnabled().catch(() => true)) break;
            await page.waitForTimeout(500);
          }
          await searchBtn.click().catch(() => null);
        }

        // Wait for loading wave indicator to complete
        await this.waitForLoadingWaveToEnd(page, 45000);

        // Wait ~3 seconds
        await page.waitForTimeout(3000);

        // Check if data arrived
        populated = await this.isGridPopulated(page);
        if (populated) {
          console.log(`Inventory data populated on search attempt ${sAttempt}.`);
          break;
        }
      }
    }

    // Apply DevExpress Grid Filters on page if provided (R5)
    const parsedSlocs = parseFilterValues(options.slocFilter);
    if (parsedSlocs.length) {
      await this.setGridFilter(page, 'slocId', parsedSlocs).catch((err) => {
        console.warn('Grid filter slocId note:', (err as Error).message);
      });
    }

    const parsedItems = parseFilterValues(options.itemFilter);
    if (parsedItems.length) {
      await this.setGridFilter(page, 'itemCode', parsedItems).catch((err) => {
        console.warn('Grid filter itemCode note:', (err as Error).message);
      });
    }

    let tempFilename = resolveNamingTemplate(options.fileNameTemplate || 'Inventory_{{slocId}}_{{timestamp}}.xlsx', {
      orgCode: options.orgCode || 'ORG', reportType: 'INVENTORY',
      slocId: parsedSlocs.length === 0 ? 'ALL_SLOC' : parsedSlocs.length === 1 ? parsedSlocs[0] : `${parsedSlocs.length}SLOCS`,
      itemCode: options.itemFilter || 'ALL', timestamp: new Date(),
    });

    if (!tempFilename.toLowerCase().endsWith('.xlsx')) {
      tempFilename += '.xlsx';
    }
    tempFilename = tempFilename.replace(/[<>:"/\\|?*]/g, '_');

    const tempDir = join(options.outputDir || os.tmpdir(), '.omniflow-temp');
    const tempPath = join(tempDir, tempFilename);
    mkdirSync(tempDir, { recursive: true });

    // Try square Excel export button on grid toolbar first (matching Hình 3 & 4)
    const gridExportBtn = page.locator(
      POS_SELECTORS.inventoryOnhand.excelButton.primary + ', ' +
      POS_SELECTORS.inventoryOnhand.excelButton.fallback
    ).first();

    if (await gridExportBtn.isVisible().catch(() => false)) {
      await page.evaluate(() => {
        (window as any).__capturedBlobs = (window as any).__capturedBlobs || [];
        const origCreate = URL.createObjectURL;
        URL.createObjectURL = function(blob: any) {
          if (blob instanceof Blob) {
            const reader = new FileReader();
            reader.onload = () => {
              (window as any).__capturedBlobs.push({
                type: blob.type,
                size: blob.size,
                dataUrl: reader.result
              });
            };
            reader.readAsDataURL(blob);
          }
          return origCreate.apply(this, arguments as any);
        };
      }).catch(() => null);

      await gridExportBtn.click().catch(() => null);

      const exportMenuItem = page.locator(
        '.dx-export-menu-item:has-text("Export all data to Excel"), ' +
        '.dx-export-menu-item, ' +
        '.dx-menu-item:has-text("Excel"), ' +
        '.dx-menu-item:has-text("Export")'
      ).first();
      if (await exportMenuItem.isVisible().catch(() => false)) {
        await exportMenuItem.click().catch(() => null);
      }

      for (let tick = 0; tick < 10; tick++) {
        await page.waitForTimeout(300);
        const blobs = await page.evaluate(() => (window as any).__capturedBlobs || []).catch(() => []);
        if (blobs.length > 0 && blobs[0].dataUrl) {
          const base64Data = (blobs[0].dataUrl as string).split(',')[1];
          if (base64Data) {
            const buf = Buffer.from(base64Data, 'base64');
            if (buf.length > 50) {
              writeFileSync(tempPath, buf);
              return {
                reportType: 'INVENTORY',
                suggestedFilename: tempFilename,
                tempFilePath: tempPath,
                downloadedAt: new Date().toISOString(),
              };
            }
          }
        }
      }
    }

    // Direct in-page fetch for maximum reliability with retry loop
    const storeParam = parsedStores.length === 1 ? parsedStores[0] : '';
    let items: any[] = [];
    for (let fAttempt = 1; fAttempt <= 5; fAttempt++) {
      try {
        const pageData = await page.evaluate(async (sId) => {
          const token = localStorage.getItem('token') || sessionStorage.getItem('token') || '';
          const origin = window.location.origin;
          const user = localStorage.getItem('pos_user') || 'USER';
          const url = `${origin}:8089/api/report/Get_RPT_InventoryOnHand?storeId=${encodeURIComponent(sId)}&userlogin=${encodeURIComponent(user)}`;
          const res = await fetch(url, {
            headers: { 'Authorization': 'Bearer ' + token }
          });
          return res.json();
        }, storeParam);

        items = Array.isArray(pageData) ? pageData : ((pageData as any)?.data || []);
        if (items.length > 0) break;
      } catch {
        // Fallback to intercepted response
        const invResp = await inventoryResponsePromise;
        if (invResp) {
          const jsonData = await invResp.json();
          items = Array.isArray(jsonData) ? jsonData : (jsonData?.data || []);
          if (items.length > 0) break;
        }
      }
      await page.waitForTimeout(2000);
    }

    if (items.length >= 0) {
      try {
        // Apply Store filter
        if (parsedStores.length > 0) {
          const lowerStores = parsedStores.map((store) => store.toLowerCase());
          items = items.filter((it: any) =>
            lowerStores.some((sf) => String(it.storeId || '').toLowerCase().includes(sf) || String(it.storeName || '').toLowerCase().includes(sf))
          );
        }

        // Apply Sloc / Kho filter
        if (parsedSlocs.length > 0) {
          items = items.filter((it: any) =>
            parsedSlocs.some((sloc) => String(it.slocId || '').toLowerCase().includes(sloc.toLowerCase()) || String(it.whsName || '').toLowerCase().includes(sloc.toLowerCase()))
          );
        }

        // Apply Item / Sản phẩm filter
        if (parsedItems.length > 0) {
          items = items.filter((it: any) =>
            parsedItems.some((item) =>
              String(it.itemCode || '').toLowerCase().includes(item.toLowerCase()) ||
              String(it.itemName || '').toLowerCase().includes(item.toLowerCase())
            )
          );
        }
        
        // Build Excel Workbook
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Inventory Onhand');
        
        worksheet.columns = [
          { header: 'Store Id', key: 'storeId', width: 14 },
          { header: 'Store Name', key: 'storeName', width: 28 },
          { header: 'Sloc Id', key: 'slocId', width: 14 },
          { header: 'Whs Name', key: 'whsName', width: 28 },
          { header: 'Item Code', key: 'itemCode', width: 18 },
          { header: 'Item Name', key: 'itemName', width: 36 },
          { header: 'UoM', key: 'inventoryUOM', width: 12 },
          { header: 'Quantity', key: 'quantity', width: 16 },
        ];

        // Format header
        const headerRow = worksheet.getRow(1);
        headerRow.font = { bold: true, color: { argb: 'FF1E293B' } };
        headerRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF1F5F9' }
        };

        for (const item of items) {
          worksheet.addRow({
            storeId: item.storeId,
            storeName: item.storeName,
            slocId: item.slocId,
            whsName: item.whsName,
            itemCode: item.itemCode,
            itemName: item.itemName,
            inventoryUOM: item.inventoryUOM || item.uomCode || item.uom,
            quantity: item.quantity ?? 0
          });
        }

        await workbook.xlsx.writeFile(tempPath);
        return {
          reportType: 'INVENTORY',
          suggestedFilename: tempFilename,
          tempFilePath: tempPath,
          downloadedAt: new Date().toISOString(),
        };
      } catch (e) {
        console.warn('Inventory JSON conversion note:', (e as Error).message);
      }
    }

    throw new Error('Inventory Onhand data could not be retrieved.');
  }

  /**
   * Set POS date filter (from or to).
   * Supports DevExtreme dxDateBox API with DOM event synchronization without resetting.
   */
  async setDateFilter(page: Page, field: 'from' | 'to', isoDate: string): Promise<void> {
    try {
      const parts = isoDate.split('-').map(Number);
      const date = parts.length === 3 ? new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0) : new Date(NaN);
      if (!isValid(date) || isNaN(date.getTime())) {
        console.warn(`setDateFilter: Invalid date "${isoDate}" provided for ${field}`);
        return;
      }
      const formatted = format(date, 'dd/MM/yyyy');
      const targetIndex = field === 'from' ? 0 : 1;

      // Mode A: DevExtreme dxDateBox widget API + DOM property sync
      try {
        const apiSuccess = await page.evaluate(({ index, year, month, day, formattedStr }) => {
          const boxes = document.querySelectorAll('dx-date-box, .dx-datebox');
          const box = boxes[index] as any;
          if (!box) return false;

          const targetDate = new Date(year, month - 1, day, 12, 0, 0);
          const devExpress = (window as any).DevExpress;
          if (devExpress?.ui?.dxDateBox) {
            const inst = devExpress.ui.dxDateBox.getInstance(box);
            if (inst && typeof inst.option === 'function') {
              inst.option('value', targetDate);
            }
          }
          box.__committed = true;

          const input = box.querySelector('input.dx-texteditor-input, input') as HTMLInputElement | null;
          if (input) {
            input.value = formattedStr;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
            input.dispatchEvent(new Event('blur', { bubbles: false }));
          }
          return true;
        }, { index: targetIndex, year: parts[0], month: parts[1], day: parts[2], formattedStr: formatted });

        if (apiSuccess) {
          await page.waitForTimeout(100);
          return;
        }
      } catch {
        // Fallback to DOM actions below
      }

      // Mode B: Playwright DOM locator fallback with events
      const dateBox = page.locator('dx-date-box, .dx-datebox').nth(targetIndex);
      if (await dateBox.isVisible().catch(() => false)) {
        const input = dateBox.locator('input.dx-texteditor-input, input').first();
        if (await input.isVisible().catch(() => false)) {
          await input.click().catch(() => null);
          await page.keyboard.press('Control+A').catch(() => null);
          await page.keyboard.press('Backspace').catch(() => null);
          await page.keyboard.type(formatted, { delay: 30 }).catch(() => null);
          await page.keyboard.press('Enter').catch(() => null);
          await page.keyboard.press('Tab').catch(() => null);
          await page.waitForTimeout(300);
        }
      }
    } catch (e) {
      console.warn(`setDateFilter error for ${field}:`, (e as Error).message);
    }
  }

  /**
   * Filter DevExpress DataGrid on the page.
   * Public interface contract per PROJECT.md / SCOPE.md.
   */
  async setGridFilter(
    page: Page,
    columnField: string,
    value: string | string[],
    options?: GridFilterOptions
  ): Promise<boolean> {
    const applied = await setGridFilter(page, columnField, value, options);
    if (applied) await this.waitForLoadingWaveToEnd(page, 20000);
    return applied;
  }

  /**
   * Check if DataGrid rows are already populated and "No data" is not displayed.
   */
  async isGridPopulated(page: Page): Promise<boolean> {
    try {
      const isNoData = await page.locator('.dx-datagrid-nodata, :text("No data"):visible, .no-data:visible')
        .first()
        .isVisible()
        .catch(() => false);
      if (isNoData) return false;

      const rowCount = await page.locator('.dx-datagrid-rowsview tr.dx-data-row, .dx-datagrid-rowsview .dx-data-row')
        .count()
        .catch(() => 0);
      return rowCount > 0;
    } catch {
      return false;
    }
  }

  /**
   * Wait for DevExtreme load panel / equalizer wave indicator overlay to detach/hide.
   */
  async waitForLoadingWaveToEnd(page: Page, timeoutMs = 30000): Promise<void> {
    const waveSelectors = [
      '.dx-loadpanel',
      '.dx-loadindicator',
      '.loading-wave',
      '[class*="wave"]',
      '.dx-overlay-wrapper:has(.dx-loadpanel)',
    ].join(', ');

    try {
      const waveLocator = page.locator(waveSelectors).first();
      if (await waveLocator.isVisible().catch(() => false)) {
        await waveLocator.waitFor({ state: 'hidden', timeout: timeoutMs }).catch(() => null);
      }
      // Small debounce for staggered chunk settlement (Hình 4)
      await page.waitForTimeout(300);
      if (await waveLocator.isVisible().catch(() => false)) {
        await waveLocator.waitFor({ state: 'hidden', timeout: timeoutMs }).catch(() => null);
      }
    } catch (e) {
      console.warn('waitForLoadingWaveToEnd note:', (e as Error).message);
    }
  }

  private async setStoreFilter(page: Page, storeFilter: string): Promise<void> {
    if (!storeFilter || storeFilter === 'All') return;
    try {
      const selectBox = page.locator('dx-select-box').first();
      if (await selectBox.isVisible().catch(() => false)) {
        await selectBox.click();
        await page.waitForTimeout(500);
        const option = page.locator(`.dx-item:has-text("${storeFilter}")`).first();
        if (await option.isVisible().catch(() => false)) {
          await option.click();
        }
      }
    } catch (e) {
      console.warn('setStoreFilter note:', (e as Error).message);
    }
  }

  static calculateDateRange(
    rule: 'TODAY' | 'YESTERDAY' | 'LAST_7_DAYS' | 'THIS_MONTH' | string,
    referenceDate: Date = new Date()
  ): { from: string; to: string } {
    const now = toZonedTime(referenceDate, TIMEZONE);
    const today = format(now, 'yyyy-MM-dd');

    switch (rule) {
      case 'TODAY':
        return { from: today, to: today };
      case 'YESTERDAY': {
        const d = new Date(now);
        d.setDate(d.getDate() - 1);
        const y = format(d, 'yyyy-MM-dd');
        return { from: y, to: y };
      }
      case 'LAST_7_DAYS': {
        const d = new Date(now);
        d.setDate(d.getDate() - 6);
        return { from: format(d, 'yyyy-MM-dd'), to: today };
      }
      case 'THIS_MONTH': {
        const d = new Date(now);
        d.setDate(1);
        const start = format(d, 'yyyy-MM-dd');
        return { from: start, to: today };
      }
      default:
        return { from: today, to: today };
    }
  }
}
