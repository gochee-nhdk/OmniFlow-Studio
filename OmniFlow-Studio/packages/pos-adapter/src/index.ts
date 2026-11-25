// FM AUTO OPS — POS RPFO Automation Adapter
// Optimized from empirical video analysis: RPFO | TDI APJ (http://172.16.1.200)
// Key optimizations:
//   1. Full 9-step shop initialization settlement wait on /shop/select-outlets (12-30s) without premature reload
//   2. In-app Angular SPA menu navigation (MORE -> Report -> Inventory Onhand / Sales Transaction Detail) with URL fallback
//   3. Extended wave & "Loading data" button polling (up to 90s for Inventory, 120s for Sales)
//   4. Verified DevExtreme columnOption('filterValues') + Virtual Scroll DOM Header Filter multi-select
//   5. Extended "Exporting..." modal settlement & 30s Blob/Download capture window

import { Page, Download } from 'playwright';
import { format, isValid } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import os from 'os';
import ExcelJS from 'exceljs';
import AdmZip from 'adm-zip';
import { POS_SELECTORS, DEFAULT_FARMERS_MARKET_SLOCS, DEFAULT_FARMERS_MARKET_STORES } from './selectors';
import { BrowserManager } from '@fm/browser-engine';
import { resolveNamingTemplate } from '@fm/file-engine';

export { POS_SELECTORS, DEFAULT_FARMERS_MARKET_SLOCS, DEFAULT_FARMERS_MARKET_STORES };

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
  preferredOutlet?: string;
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
  preferredOutlet?: string;
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
  preferredOutlet?: string;
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
    return { dataField: 'slocId', titles: ['Sloc Id', 'Sloc ID', 'Sloc', 'Kho'] };
  }
  if (norm === 'itemcode' || norm === 'item code' || norm === 'item') {
    return { dataField: 'itemCode', titles: ['Item Code', 'Item', 'Mã sản phẩm', 'Mã'] };
  }
  if (norm === 'storeid' || norm === 'store id' || norm === 'store') {
    return { dataField: 'storeId', titles: ['Store Id', 'Store ID', 'Store', 'Cửa hàng'] };
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
 * Supports Mode A (DevExtreme JS API) with fallback to Mode B (DOM Header Filter Popup with Virtual Scroll support).
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
        if (!grid || typeof grid.columnOption !== 'function') return false;

        let targetField = dataField;
        if (typeof grid.getColumns === 'function') {
          const cols = grid.getColumns();
          if (Array.isArray(cols) && cols.length > 0) {
            const match = cols.find((c: any) =>
              c.dataField === dataField ||
              titles.some((t: string) => t.toLowerCase() === (c.caption || '').toLowerCase()) ||
              titles.some((t: string) => t.toLowerCase() === (c.dataField || '').toLowerCase()) ||
              (c.name && titles.some((t: string) => t.toLowerCase() === c.name.toLowerCase()))
            );
            if (!match) {
              // If real columns are exposed and none matched, fall back to DOM popup
              return false;
            }
            targetField = match.dataField || match.name || match.caption || dataField;
          }
        }

        if (vals.length === 0) {
          grid.columnOption(targetField, 'filterValues', []);
        } else {
          // Use DevExtreme native header filter inclusion array (matches manual checkbox ticks in Video 1)
          grid.columnOption(targetField, 'filterType', 'include');
          grid.columnOption(targetField, 'filterValues', vals);
        }
        if (typeof grid.refresh === 'function') grid.refresh();
        return true;
      }, { dataField: resolved.dataField, titles: resolved.titles, vals: filterVals });

      if (apiSuccess) {
        await page.waitForTimeout(300);
        return true;
      }
    } catch {
      if (mode === 'api') return false;
    }
  }

  // 2. Mode B: DOM Header Filter Popup Automation (Matching Video 1 03:07 - 04:08)
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

      // Click filter funnel icon
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

      // Uncheck "(Select All)" ONLY if it is currently checked
      const selectAllItem = popup.locator('.dx-list-item, .dx-item').filter({
        hasText: /^\s*[\(\（]?(Select All|Chọn tất cả|Tất cả)[\)\）]?\s*$/i
      }).first();
      if (await selectAllItem.isVisible().catch(() => false)) {
        const selectAllCheckbox = selectAllItem.locator('.dx-checkbox, input[type="checkbox"]').first();
        if (await selectAllCheckbox.isVisible().catch(() => false)) {
          const isChecked = (await selectAllCheckbox.getAttribute('aria-checked').catch(() => null)) === 'true'
            || (await selectAllCheckbox.locator('.dx-checkbox-checked').count().catch(() => 0)) > 0;
          if (isChecked) {
            await selectAllCheckbox.click();
            await page.waitForTimeout(150);
          }
        }
      }

      if (filterVals.length === 1) {
        // Single value filter: Direct search input automation matching Hình 5
        const targetVal = filterVals[0];
        const searchInput = popup.locator('input.dx-texteditor-input, input[placeholder*="Search"], input[type="text"]').first();
        if (await searchInput.isVisible().catch(() => false)) {
          await searchInput.fill('');
          await searchInput.fill(targetVal);
          await page.waitForTimeout(200);
        }

        const listItem = popup.locator('.dx-list-item, .dx-item').filter({ hasText: targetVal }).first();
        if (await listItem.isVisible().catch(() => false)) {
          const checkbox = listItem.locator('.dx-checkbox, input[type="checkbox"]').first();
          if (await checkbox.isVisible().catch(() => false)) {
            const alreadyChecked = typeof checkbox.getAttribute === 'function'
              ? await checkbox.getAttribute('aria-checked').catch(() => null)
              : null;
            const checkedClass = await checkbox.locator('.dx-checkbox-checked').count().catch(() => 0);
            if (alreadyChecked !== 'true' && checkedClass === 0) {
              await checkbox.click();
            }
          } else {
            await listItem.click();
          }
        }
      } else {
        // Strategy B1: Virtual Scroll Multi-Select (matches Video 1 03:08 - 04:08 without resetting via search box)
        const remainingTargets = new Set(filterVals);
        const tickVisibleMatches = async () => {
          for (const targetVal of Array.from(remainingTargets)) {
            const listItem = popup.locator('.dx-list-item, .dx-item').filter({ hasText: targetVal }).first();
            if (await listItem.isVisible().catch(() => false)) {
              const checkbox = listItem.locator('.dx-checkbox, input[type="checkbox"]').first();
              if (await checkbox.isVisible().catch(() => false)) {
                const alreadyChecked = typeof checkbox.getAttribute === 'function'
                  ? await checkbox.getAttribute('aria-checked').catch(() => null)
                  : null;
                const checkedClass = await checkbox.locator('.dx-checkbox-checked').count().catch(() => 0);
                if (alreadyChecked !== 'true' && checkedClass === 0) {
                  await checkbox.click();
                }
              } else {
                await listItem.click();
              }
              remainingTargets.delete(targetVal);
            }
          }
        };

        // Initial pass at top of popup
        await tickVisibleMatches();

        // Scroll through virtual scroll container if some Sloc IDs are further down
        if (remainingTargets.size > 0) {
          for (let step = 0; step < 12 && remainingTargets.size > 0; step++) {
            const scrolled = await page.evaluate(() => {
              const scroller = document.querySelector(
                '.dx-header-filter-menu .dx-scrollable-container, .dx-popup-content .dx-scrollable-container, .dx-header-filter-menu .dx-list'
              ) as HTMLElement | null;
              if (!scroller) return false;
              const prev = scroller.scrollTop;
              scroller.scrollTop += 180;
              scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
              return scroller.scrollTop > prev;
            }).catch(() => false);
            await page.waitForTimeout(150);
            await tickVisibleMatches();
            if (!scrolled) break;
          }
        }

        // Strategy B2: Search input fallback for any remaining target values
        if (remainingTargets.size > 0) {
          const searchInput = popup.locator('input.dx-texteditor-input, input[placeholder*="Search"], input[type="text"]').first();
          if (await searchInput.isVisible().catch(() => false)) {
            for (const targetVal of Array.from(remainingTargets)) {
              await searchInput.fill('');
              await searchInput.fill(targetVal);
              await page.waitForTimeout(250);
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
                remainingTargets.delete(targetVal);
              }
            }
            // Clear search input before clicking OK so DevExtreme commits all checked items
            await searchInput.fill('').catch(() => null);
            await page.waitForTimeout(150);
          }
        }
      }

      // Click OK
      const okBtn = popup.locator('.dx-button:has-text("OK"), button:has-text("OK"), .dx-popup-bottom .dx-button').first();
      if (await okBtn.isVisible().catch(() => false)) {
        await okBtn.click();
      }

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
 */
export async function enforceExcelFilterIntegrity(
  filePath: string,
  filterSpec: { stores?: string[]; slocs?: string[]; items?: string[] }
): Promise<{ rowCount: number; filtered: boolean; modified: boolean }> {
  const stores = parseFilterValues(filterSpec.stores).map((value) => value.toLowerCase());
  const slocs = parseFilterValues(filterSpec.slocs).map((value) => value.toLowerCase());
  const items = parseFilterValues(filterSpec.items).map((value) => value.toLowerCase());
  const hasStoreFilter = stores.length > 0;
  const hasSlocFilter = slocs.length > 0;
  const hasItemFilter = items.length > 0;

  if (!hasStoreFilter && !hasSlocFilter && !hasItemFilter) {
    return { rowCount: -1, filtered: false, modified: false };
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.readFile(filePath);
  } catch (readError) {
    const archive = new AdmZip(filePath);
    let normalizedAny = false;
    for (const entry of archive.getEntries()) {
      if (!/^xl\/workbook\.xml$|^xl\/worksheets\/[^/]+\.xml$/i.test(entry.entryName)) continue;
      const source = entry.getData().toString('utf8');
      const normalized = source.replace(/<(\/?)x:([\w.-]+)(?=[\s>])/g, '<$1$2');
      if (normalized !== source) {
        archive.updateFile(entry.entryName, Buffer.from(normalized, 'utf8'));
        normalizedAny = true;
      }
    }
    if (!normalizedAny) throw readError;
    archive.writeZip(filePath);
    await workbook.xlsx.readFile(filePath);
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error('POS export workbook has no worksheet to filter.');

  const headerRow = worksheet.getRow(1);
  let storeColIdx = 0;
  let slocColIdx = 0;
  let itemCodeColIdx = 0;
  let itemNameColIdx = 0;

  headerRow.eachCell((cell, colNumber) => {
    const header = String(cell.value ?? '').trim().toLowerCase();
    if (/store\s*id|store\s*name|^store$|cửa\s*hàng|mã\s*ch/i.test(header)) storeColIdx ||= colNumber;
    if (/sloc\s*id|^sloc$|whs\s*name|mã\s*kho|tên\s*kho|^kho$/i.test(header)) slocColIdx ||= colNumber;
    if (/item\s*code|item\s*name|mã\s*hàng|mã\s*sản\s*phẩm|tên\s*sản\s*phẩm|sku/i.test(header)) {
      if (/item\s*name|tên\s*sản\s*phẩm/i.test(header)) itemNameColIdx ||= colNumber;
      else itemCodeColIdx ||= colNumber;
    }
  });

  const storeColumn = storeColIdx > 0 ? storeColIdx : slocColIdx;
  const slocColumn = slocColIdx > 0 ? slocColIdx : storeColIdx;
  if (hasStoreFilter && storeColumn < 1) throw new Error('Cannot enforce POS store filter: no Store or Sloc column was found.');
  if (hasSlocFilter && slocColumn < 1) throw new Error('Cannot enforce POS Sloc filter: no Sloc or Store column was found.');
  if (hasItemFilter && itemCodeColIdx < 1 && itemNameColIdx < 1) throw new Error('Cannot enforce POS item filter: no item code or name column was found.');

  const rowsToDelete: number[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const getCellVal = (colIdx: number): string =>
      colIdx > 0 ? String(row.getCell(colIdx).value ?? '').trim().toLowerCase() : '';

    const storeVal = getCellVal(storeColumn);
    const slocVal = getCellVal(slocColumn);
    const itemCodeVal = getCellVal(itemCodeColIdx);
    const itemNameVal = getCellVal(itemNameColIdx);

    let keep = true;

    if (hasStoreFilter && storeColumn > 0) {
      const matches = stores.some((f) => storeVal.includes(f));
      if (!matches) keep = false;
    }

    if (keep && hasSlocFilter && slocColumn > 0) {
      const matches = slocs.some((f) => slocVal.includes(f));
      if (!matches) keep = false;
    }

    if (keep && hasItemFilter && (itemCodeColIdx > 0 || itemNameColIdx > 0)) {
      const matches = items.some((f) =>
        (itemCodeColIdx > 0 && itemCodeVal.includes(f)) ||
        (itemNameColIdx > 0 && itemNameVal.includes(f))
      );
      if (!matches) keep = false;
    }

    if (!keep) rowsToDelete.push(rowNumber);
  });

  if (rowsToDelete.length === 0) {
    return { rowCount: Math.max(0, worksheet.rowCount - 1), filtered: false, modified: false };
  }

  for (let i = rowsToDelete.length - 1; i >= 0; i--) {
    worksheet.spliceRows(rowsToDelete[i], 1);
  }

  await workbook.xlsx.writeFile(filePath);

  const remainingRows = worksheet.rowCount > 1 ? worksheet.rowCount - 1 : 0;
  return { rowCount: remainingRows, filtered: true, modified: true };
}

export class POSAdapter {
  private browserManager: BrowserManager;
  private baseUrl: string;

  constructor(browserManager: BrowserManager, baseUrl = process.env.POS_URL || '') {
    this.browserManager = browserManager;
    let clean = (baseUrl || '').trim().replace(/\/(home|login)\/?$/i, '');
    this.baseUrl = clean ? (clean.endsWith('/') ? clean : `${clean}/`) : '';
    if (!this.baseUrl) throw new Error('POS URL is not configured. Set it in the POS connection settings before automation.');
  }

  /**
   * Helper to check whether POS session is already authenticated and past outlet initialization.
   */
  private async isPOSAuthenticated(page: Page): Promise<boolean> {
    const url = page.url();
    if (url.includes('/login') || url.includes('select-outlets')) {
      return false;
    }
    const hasAdminOrShop = url.includes('/admin') || url.includes('/shop');
    const hasIndicator = (await page.locator(
      ':text("IN SHOP"), :text("Dashboard"), :text("MORE"), a[href*="logout"], a[href*="admin"], .dx-datagrid'
    ).count().catch(() => 0)) > 0;

    return hasAdminOrShop || hasIndicator;
  }

  /**
   * Selects an outlet card on /shop/select-outlets and waits for the 9-step initialization
   * sequence (00:16 - 00:27 in Video 1) to complete without reloading mid-sequence.
   */
  private async selectOutletAndWaitSettlement(
    page: Page,
    preferredOutlet = 'FM04',
    onProgress?: (msg: string) => void
  ): Promise<boolean> {
    const outletSelectors = [
      `.blog-sider-common:has-text("${preferredOutlet}")`,
      `.blog-sider-common`,
      `div:has-text("${preferredOutlet} - Hoàng Hoa Thám"):not(:has(div:has-text("${preferredOutlet}")))`,
      `:text("${preferredOutlet}")`,
      `:text("DC01 - Nơ Trang Long")`,
      `:text("FM01")`,
    ];

    let clicked = false;
    for (const sel of outletSelectors) {
      const card = page.locator(sel).first();
      if (await card.isVisible().catch(() => false)) {
        await card.click().catch(() => null);
        clicked = true;
        break;
      }
    }

    if (!clicked) return false;

    onProgress?.('Đang chờ POS nạp cấu hình cửa hàng (9 bước: Shop Info -> Default Customer)...');

    // Wait up to 35 seconds for /shop/select-outlets 9-step initialization to transition to /admin/dashboard
    for (let tick = 0; tick < 35; tick++) {
      await page.waitForTimeout(1000);
      if (await this.isPOSAuthenticated(page)) {
        // Also wait briefly if Dashboard charts are still showing initial wave
        await this.waitForLoadingWaveToEnd(page, 10000);
        return true;
      }
      // If we are no longer on select-outlets, break early
      const u = page.url();
      if (!u.includes('select-outlets')) {
        break;
      }
    }

    return this.isPOSAuthenticated(page);
  }

  /**
   * Navigate to a report via the in-app MORE -> Report modal (as shown in Video 1 at 00:37 and 04:43)
   * to preserve Angular in-memory session state, with clean fallback to direct URL navigation.
   */
  private async navigateToReport(
    page: Page,
    reportName: 'Inventory Onhand' | 'Sales Transaction Detail',
    fallbackPath: string
  ): Promise<void> {
    const currentUrl = page.url();
    if (currentUrl.includes(fallbackPath)) return;

    try {
      const moreBtn = page.locator(
        POS_SELECTORS.dashboard.moreButton.primary + ', ' +
        POS_SELECTORS.dashboard.moreButton.fallback
      ).first();

      if (await moreBtn.isVisible().catch(() => false)) {
        await moreBtn.click().catch(() => null);
        await page.waitForTimeout(500);

        const reportTile = page.locator(
          POS_SELECTORS.moreModal.reportTile.primary + ', ' +
          POS_SELECTORS.moreModal.reportTile.fallback
        ).first();

        if (await reportTile.isVisible().catch(() => false)) {
          await reportTile.click().catch(() => null);
          await page.waitForTimeout(500);

          const itemLoc = page.locator(`:text-is("${reportName}"), :text("${reportName}")`).first();
          if (!(await itemLoc.isVisible().catch(() => false))) {
            // Scroll report modal for items further down like Sales Transaction Detail (04:45 in Video 1)
            await page.evaluate(() => {
              const modals = document.querySelectorAll('.modal-body, .dx-popup-content, .dx-scrollable-container, [role="dialog"] div');
              modals.forEach((m) => { (m as HTMLElement).scrollTop += 300; });
            }).catch(() => null);
            await page.waitForTimeout(300);
          }

          if (await itemLoc.isVisible().catch(() => false)) {
            await itemLoc.click().catch(() => null);
            await page.waitForTimeout(2000);
            if (page.url().includes(fallbackPath)) {
              return;
            }
          }
        }
      }
    } catch {
      // Fallback to direct URL navigation below
    }

    await page.goto(`${this.baseUrl}${fallbackPath}`, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(2500);
  }

  /**
   * Ensure user is authenticated into POS with continuous retry loop.
   */
  async ensureAuthenticated(
    credentials?: POSCredentials,
    options?: { maxRetries?: number; onProgress?: (msg: string) => void; retryDelayMs?: number; preferredOutlet?: string }
  ): Promise<Page> {
    const page = await this.browserManager.getPage('POS');
    const maxRetries = options?.maxRetries ?? 15;
    const retryDelay = options?.retryDelayMs ?? 2000;
    const preferredOutlet = options?.preferredOutlet || 'FM04';
    const onProgress = options?.onProgress;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        let currentUrl = page.url();

        // 0. Auto-recover from "page-not-found works!" or invalid /home URL
        const isNotFound = currentUrl.includes('404')
          || currentUrl.endsWith('/home')
          || currentUrl.endsWith('/home/')
          || currentUrl.includes('/home?')
          || (await page.locator('app-page-not-found, :text("page-not-found works!")').count().catch(() => 0)) > 0;

        if (isNotFound) {
          onProgress?.('Phát hiện URL /home (page-not-found) — Đang khôi phục điều hướng hợp lệ...');
          const hasToken = await page.evaluate(() => {
            return !!(localStorage.getItem('token') && localStorage.getItem('user'));
          }).catch(() => false);

          if (hasToken) {
            onProgress?.('Phiên đăng nhập POS còn hiệu lực — Chuyển tiếp vào Dashboard...');
            await page.goto(`${this.baseUrl}admin/dashboard`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
          } else {
            onProgress?.('Chuyển tiếp về màn hình đăng nhập POS /login...');
            // Navigate to base URL first to let Angular router initialize properly
            await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
            await page.waitForTimeout(2000);
            // Then navigate to login if still on /home
            if (page.url().endsWith('/home') || page.url().endsWith('/home/')) {
              await page.goto(`${this.baseUrl}login`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
            }
          }
          await page.waitForTimeout(2000);
          currentUrl = page.url();
        }

        // 1. Initial navigation if not on POS site
        if (!currentUrl.startsWith(this.baseUrl) || currentUrl === 'about:blank') {
          onProgress?.(`Đang kết nối POS RPFO (${this.baseUrl}) - Lần ${attempt}/${maxRetries}...`);
          // Navigate directly to /login to avoid Angular default-route redirect to /home
          await page.goto(`${this.baseUrl}login`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
          await page.waitForTimeout(1500);
        }

        // 2. Check if already authenticated
        if (await this.isPOSAuthenticated(page)) {
          const hasLoginForm = (await page.locator('#txtName').count().catch(() => 0)) > 0 || page.url().includes('/login');
          if (!hasLoginForm) {
            return page;
          }
        }

        // 3. Handle Outlet selection if displayed (00:13 - 00:27 in Video 1)
        const hasOutlets = page.url().includes('select-outlets')
          || (await page.locator('.blog-sider-common, :text("Last Login")').count().catch(() => 0)) > 0;
        if (hasOutlets) {
          onProgress?.(`Phát hiện màn hình chọn Outlet/Cửa hàng - Đang chọn cửa hàng ${preferredOutlet} (Lần ${attempt}/${maxRetries})...`);
          const ok = await this.selectOutletAndWaitSettlement(page, preferredOutlet, onProgress);
          if (ok) {
            return page;
          }
        }

        // 4. Handle Login Form if displayed (00:00 - 00:11 in Video 1)
        const loginFormVisible = page.url().includes('/login')
          || (await page.locator('#txtName, input[name*="user" i], input[placeholder*="User" i], button:has-text("LOGIN")').count().catch(() => 0)) > 0;
        if (loginFormVisible) {
          if (!credentials?.username || !credentials?.password) {
            throw new Error('POS login is required, but no POS credentials are saved. Please configure in Settings.');
          }

          onProgress?.(`Đang điền thông tin và đăng nhập POS RPFO (Lần ${attempt}/${maxRetries})...`);

          const userInput = page.locator('#txtName, input[name*="user" i], input[placeholder*="User" i], input[type="text"]').first();
          const passInput = page.locator('#txtPassword, input[type="password"]').first();

          if (await userInput.isVisible().catch(() => false)) {
            await userInput.click().catch(() => null);
            await userInput.fill(credentials.username);
          }
          if (await passInput.isVisible().catch(() => false)) {
            await passInput.click().catch(() => null);
            await passInput.fill(credentials.password);
          }

          const submitBtn = page.locator('input[type="submit"], button:has-text("LOGIN"), button:has-text("Login"), button[type="submit"]').first();
          if (await submitBtn.isVisible().catch(() => false)) {
            await submitBtn.click().catch(() => null);
          }

          // Wait for redirect to /shop/select-outlets (handles transient "page-not-found works!" flash at 00:11)
          await page.waitForTimeout(2500);

          const postLoginOutlets = page.url().includes('select-outlets')
            || (await page.locator('.blog-sider-common, :text("Last Login")').count().catch(() => 0)) > 0;
          if (postLoginOutlets) {
            onProgress?.(`Đang chọn điểm bán Outlet (${preferredOutlet}) và nạp cấu hình cửa hàng...`);
            await this.selectOutletAndWaitSettlement(page, preferredOutlet, onProgress);
          }

          if (await this.isPOSAuthenticated(page)) {
            onProgress?.('Đăng nhập POS RPFO thành công!');
            return page;
          }

          const errorMsg = await page.evaluate(() => {
            const el = document.querySelector('.alert, .toast-error, .text-danger, .error-message, .swal2-html-container');
            return el ? (el.textContent || '').trim() : '';
          }).catch(() => '');

          if (errorMsg) {
            onProgress?.(`Thông báo từ POS: ${errorMsg}`);
            if (/sai|không đúng|locked|khoá|invalid/i.test(errorMsg)) {
              throw new Error(`Đăng nhập POS thất bại: ${errorMsg}`);
            }
          }
        }

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
    options?: { maxRetries?: number; onProgress?: (msg: string) => void; retryDelayMs?: number; preferredOutlet?: string }
  ): Promise<boolean> {
    await this.ensureAuthenticated(credentials, options);
    return true;
  }

  /**
   * Inject client-side Blob interceptor and URL.revokeObjectURL delay guard.
   */
  private async injectBlobInterceptor(page: Page): Promise<void> {
    await page.evaluate(() => {
      (window as any).__capturedBlobs = [];
      if (!(window as any).__blobHookInstalled) {
        (window as any).__blobHookInstalled = true;
        const origCreate = URL.createObjectURL;
        URL.createObjectURL = function(blob: any) {
          if (blob instanceof Blob) {
            const reader = new FileReader();
            reader.onload = () => {
              (window as any).__capturedBlobs.push({
                type: blob.type,
                size: blob.size,
                dataUrl: reader.result,
              });
            };
            reader.readAsDataURL(blob);
          }
          return origCreate.apply(this, arguments as any);
        };

        const origRevoke = URL.revokeObjectURL;
        URL.revokeObjectURL = function(url: string) {
          setTimeout(() => origRevoke.call(URL, url), 60000);
        };
      }
    }).catch(() => null);
  }

  /**
   * Wait for DevExtreme "Exporting..." overlay (04:12-04:17 & 06:51-06:56 in Video 1) and poll captured blobs.
   */
  private async waitForCapturedBlob(page: Page, minBytes = 50, maxWaitMs = 25000): Promise<Buffer | null> {
    const ticks = Math.max(10, Math.ceil(maxWaitMs / 400));
    for (let tick = 0; tick < ticks; tick++) {
      await page.waitForTimeout(400);
      const blobs = await page.evaluate(() => (window as any).__capturedBlobs || []).catch(() => []);
      if (Array.isArray(blobs) && blobs.length > 0 && blobs[0].dataUrl) {
        const base64Data = String(blobs[0].dataUrl).split(',')[1];
        if (base64Data) {
          const buf = Buffer.from(base64Data, 'base64');
          if (buf.length > minBytes) {
            return buf;
          }
        }
      }
    }
    return null;
  }

  /**
   * Download Sales Transaction Detail report.
   * Optimized for 76-second multi-day queries and Exporting... modal (04:46 - 07:09 in Video 1).
   */
  async downloadSalesTransactionDetail(
    options: SalesDownloadOptions,
    credentials?: POSCredentials
  ): Promise<POSDownloadResult> {
    const page = await this.ensureAuthenticated(credentials, { preferredOutlet: options.preferredOutlet });

    await this.navigateToReport(page, 'Sales Transaction Detail', 'admin/report/sales-transaction-detail');

    // If redirected to login or 404, re-authenticate and navigate again
    if (page.url().includes('/login') || page.url().includes('404') || page.url().includes('/home') || (await page.locator('#txtName').count().catch(() => 0)) > 0) {
      await this.ensureAuthenticated(credentials, { preferredOutlet: options.preferredOutlet });
      await this.navigateToReport(page, 'Sales Transaction Detail', 'admin/report/sales-transaction-detail');
    }

    // Set Date & Store Filters
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

    // Click Search to populate grid with extended 120s wave timeout (Video 1 took 76s for 7 days!)
    const searchBtn = page.locator('dx-button[icon="search"], button:has-text("Search"), a:has-text("Search")').first();
    for (let sAttempt = 1; sAttempt <= 3; sAttempt++) {
      if (await searchBtn.isVisible().catch(() => false)) {
        await searchBtn.click().catch(() => null);
      }
      await this.waitForLoadingWaveToEnd(page, 120000);
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

    // Locate square DataGrid export button first (for R3 compatibility), falling back to blue Excel button (06:50 in Video 1)
    const squareExcelBtn = page.locator(
      '.dx-datagrid-header-panel .dx-datagrid-export-button, ' +
      '.dx-datagrid-header-panel .dx-button:has(.dx-icon-xlsxfile), ' +
      '.dx-datagrid-header-panel [aria-label*="Export to Excel" i], ' +
      '.dx-datagrid-export-button'
    ).first();

    const blueExcelBtn = page.locator(
      POS_SELECTORS.salesTransactionDetail.blueExcelButton.primary + ', ' +
      POS_SELECTORS.salesTransactionDetail.blueExcelButton.fallback
    ).first();

    const excelBtn = (await squareExcelBtn.isVisible().catch(() => false))
      ? squareExcelBtn
      : (await blueExcelBtn.isVisible().catch(() => false))
        ? blueExcelBtn
        : page.locator(
            POS_SELECTORS.salesTransactionDetail.excelButton.primary + ', ' +
            POS_SELECTORS.salesTransactionDetail.excelButton.fallback
          ).first();

    await excelBtn.waitFor({ state: 'visible', timeout: 45000 });

    const salesStores = parseFilterValues(options.storeFilter);
    let tempFilename = resolveNamingTemplate(options.fileNameTemplate || 'Sales_{{fromDate}}_{{toDate}}.xlsx', {
      orgCode: options.orgCode || 'ORG',
      reportType: 'SALES',
      fromDate: options.fromDate || 'ALL',
      toDate: options.toDate || 'ALL',
      storeId: salesStores.length === 0 ? 'ALL' : salesStores.length === 1 ? salesStores[0] : `${salesStores.length}STORES`,
      timestamp: new Date(),
    });

    if (!tempFilename.toLowerCase().endsWith('.xlsx')) {
      tempFilename += '.xlsx';
    }
    tempFilename = tempFilename.replace(/[<>:"/\\|?*]/g, '_');

    const tempDir = join(options.outputDir || os.tmpdir(), '.omniflow-temp');
    const tempPath = join(tempDir, tempFilename);
    mkdirSync(tempDir, { recursive: true });

    await this.injectBlobInterceptor(page);

    const responsePromise = page.waitForResponse(
      (res) => (res.url().includes('Export_RPT_SalesTransactionDetail') || res.headers()['content-type']?.includes('spreadsheet')) && res.status() === 200,
      { timeout: 45000 }
    ).catch(() => null);

    const downloadPromise = page.waitForEvent('download', { timeout: 45000 }).catch(() => null);

    await excelBtn.click();

    // Check if DevExtreme export context menu appeared
    const exportMenuItem = page.locator(
      '.dx-export-menu-item:has-text("Export all data to Excel"), ' +
      '.dx-export-menu-item, ' +
      '.dx-menu-item:has-text("Excel"), ' +
      '.dx-menu-item:has-text("Export")'
    ).first();
    if (await exportMenuItem.isVisible().catch(() => false)) {
      await exportMenuItem.click().catch(() => null);
    }

    // 1. First priority: Check Blob Hook (polls up to 25s across the 6s Exporting... spinner)
    const blobBuf = await this.waitForCapturedBlob(page, 500, 25000);
    if (blobBuf) {
      writeFileSync(tempPath, blobBuf);
      await enforceExcelFilterIntegrity(tempPath, {
        stores: parseFilterValues(options.storeFilter),
      });
      return {
        reportType: 'SALES',
        suggestedFilename: tempFilename,
        tempFilePath: tempPath,
        downloadedAt: new Date().toISOString(),
      };
    }

    // If square button didn't produce a blob and blue Excel button is present, try blue Excel button
    if ((await blueExcelBtn.isVisible().catch(() => false)) && excelBtn !== blueExcelBtn) {
      await blueExcelBtn.click().catch(() => null);
      const retryBlobBuf = await this.waitForCapturedBlob(page, 500, 15000);
      if (retryBlobBuf) {
        writeFileSync(tempPath, retryBlobBuf);
        await enforceExcelFilterIntegrity(tempPath, {
          stores: parseFilterValues(options.storeFilter),
        });
        return {
          reportType: 'SALES',
          suggestedFilename: tempFilename,
          tempFilePath: tempPath,
          downloadedAt: new Date().toISOString(),
        };
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
          });
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
        });
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

    if (existsSync(tempPath)) {
      await enforceExcelFilterIntegrity(tempPath, {
        stores: parseFilterValues(options.storeFilter),
      });
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
   * Optimized for multi-attempt 43s/58s/30s search retries, 16-Sloc filtering, and 6s Exporting... modal (00:40 - 04:20 in Video 1).
   */
  async downloadInventoryOnhand(
    options: InventoryDownloadOptions,
    credentials?: POSCredentials
  ): Promise<POSDownloadResult> {
    const page = await this.ensureAuthenticated(credentials, { preferredOutlet: options.preferredOutlet });

    await this.navigateToReport(page, 'Inventory Onhand', 'admin/report/inventory-onhand');

    if (page.url().includes('/login') || page.url().includes('404') || page.url().includes('/home') || (await page.locator('#txtName').count().catch(() => 0)) > 0) {
      await this.ensureAuthenticated(credentials, { preferredOutlet: options.preferredOutlet });
      await this.navigateToReport(page, 'Inventory Onhand', 'admin/report/inventory-onhand');
    }

    const inventoryResponsePromise = page.waitForResponse(
      (res) => res.url().includes('Get_RPT_InventoryOnHand') && res.status() === 200,
      { timeout: 60000 }
    ).catch(() => null);

    const parsedStores = parseFilterValues(options.storeFilter);
    if (parsedStores.length === 1) {
      await this.setStoreFilter(page, parsedStores[0]);
    }

    // R4: Inventory Onhand Search Retry and Wait Logic
    await this.waitForLoadingWaveToEnd(page, 30000);
    await page.waitForTimeout(3000);

    let populated = await this.isGridPopulated(page);

    if (populated) {
      console.log('Inventory Onhand grid already populated after loading wave — skipping search click.');
    } else {
      // Multi-attempt search loop with 90s wave timeout (Video 1 Search #1 took 43s, Search #2 took 58s, Search #3 took 30s)
      const searchBtn = page.locator(
        'dx-button[icon="search"], button:has-text("Search"), .btn-search, button[type="submit"]'
      ).first();

      for (let sAttempt = 1; sAttempt <= 6; sAttempt++) {
        console.log(`Inventory search attempt ${sAttempt}/6...`);
        if (await searchBtn.isVisible().catch(() => false)) {
          for (let w = 0; w < 10; w++) {
            if (await searchBtn.isEnabled().catch(() => true)) break;
            await page.waitForTimeout(500);
          }
          await searchBtn.click().catch(() => null);
        }

        // Wait up to 90s for equalizer wave / "Loading data" button to finish
        await this.waitForLoadingWaveToEnd(page, 90000);
        await page.waitForTimeout(3000);

        populated = await this.isGridPopulated(page);
        if (populated) {
          console.log(`Inventory data populated on search attempt ${sAttempt}.`);
          break;
        }
      }
    }

    // Apply DevExpress Grid Filters on page if provided (R5 — 03:07 to 04:08 in Video 1)
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
      orgCode: options.orgCode || 'ORG',
      reportType: 'INVENTORY',
      slocId: parsedSlocs.length === 0 ? 'ALL_SLOC' : parsedSlocs.length === 1 ? parsedSlocs[0] : `${parsedSlocs.length}SLOCS`,
      itemCode: options.itemFilter || 'ALL',
      timestamp: new Date(),
    });

    if (!tempFilename.toLowerCase().endsWith('.xlsx')) {
      tempFilename += '.xlsx';
    }
    tempFilename = tempFilename.replace(/[<>:"/\\|?*]/g, '_');

    const tempDir = join(options.outputDir || os.tmpdir(), '.omniflow-temp');
    const tempPath = join(tempDir, tempFilename);
    mkdirSync(tempDir, { recursive: true });

    // Click square Excel export button on grid toolbar (04:11 in Video 1)
    const gridExportBtn = page.locator(
      POS_SELECTORS.inventoryOnhand.excelButton.primary + ', ' +
      POS_SELECTORS.inventoryOnhand.excelButton.fallback
    ).first();

    if (await gridExportBtn.isVisible().catch(() => false)) {
      await this.injectBlobInterceptor(page);
      const downloadPromise = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);

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

      // Poll up to 20s so the 6-7s "Exporting..." modal finishes generating the Blob
      const blobBuf = await this.waitForCapturedBlob(page, 50, 20000);
      if (blobBuf) {
        writeFileSync(tempPath, blobBuf);
        await enforceExcelFilterIntegrity(tempPath, {
          stores: parsedStores,
          slocs: parsedSlocs,
          items: parsedItems,
        });
        return {
          reportType: 'INVENTORY',
          suggestedFilename: tempFilename,
          tempFilePath: tempPath,
          downloadedAt: new Date().toISOString(),
        };
      }

      const download = await downloadPromise;
      if (download) {
        try {
          await download.saveAs(tempPath);
          await enforceExcelFilterIntegrity(tempPath, {
            stores: parsedStores,
            slocs: parsedSlocs,
            items: parsedItems,
          });
          return {
            reportType: 'INVENTORY',
            suggestedFilename: tempFilename,
            tempFilePath: tempPath,
            downloadedAt: new Date().toISOString(),
          };
        } catch (err) {
          console.warn('Inventory download saveAs note:', (err as Error).message);
        }
      }
    }

    // Direct in-page API fallback for maximum reliability
    const storeParam = parsedStores.length === 1 ? parsedStores[0] : '';
    let items: any[] = [];
    for (let fAttempt = 1; fAttempt <= 5; fAttempt++) {
      try {
        const pageData = await page.evaluate(async (sId) => {
          const token = localStorage.getItem('token') || sessionStorage.getItem('token') || '';
          const protocol = window.location.protocol;
          const hostname = window.location.hostname;
          const user = localStorage.getItem('pos_user') || 'USER';
          const url = `${protocol}//${hostname}:8089/api/report/Get_RPT_InventoryOnHand?storeId=${encodeURIComponent(sId)}&userlogin=${encodeURIComponent(user)}`;
          const res = await fetch(url, {
            headers: { 'Authorization': 'Bearer ' + token }
          });
          return res.json();
        }, storeParam);

        items = Array.isArray(pageData) ? pageData : ((pageData as any)?.data || []);
        if (items.length > 0) break;
      } catch {
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
        if (parsedStores.length > 0) {
          const lowerStores = parsedStores.map((store) => store.toLowerCase());
          items = items.filter((it: any) =>
            lowerStores.some((sf) => String(it.storeId || '').toLowerCase().includes(sf) || String(it.storeName || '').toLowerCase().includes(sf))
          );
        }

        if (parsedSlocs.length > 0) {
          items = items.filter((it: any) =>
            parsedSlocs.some((sloc) => String(it.slocId || '').toLowerCase().includes(sloc.toLowerCase()) || String(it.whsName || '').toLowerCase().includes(sloc.toLowerCase()))
          );
        }

        if (parsedItems.length > 0) {
          items = items.filter((it: any) =>
            parsedItems.some((item) =>
              String(it.itemCode || '').toLowerCase().includes(item.toLowerCase()) ||
              String(it.itemName || '').toLowerCase().includes(item.toLowerCase())
            )
          );
        }

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
        await enforceExcelFilterIntegrity(tempPath, {
          stores: parsedStores,
          slocs: parsedSlocs,
          items: parsedItems,
        });
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
   * Wait for DevExtreme load panel, equalizer wave indicator, or "Loading data" button state to finish.
   */
  async waitForLoadingWaveToEnd(page: Page, timeoutMs = 30000): Promise<void> {
    const waveSelectors = [
      '.dx-loadpanel',
      '.dx-loadindicator',
      '.loading-wave',
      '[class*="wave"]',
      '.dx-overlay-wrapper:has(.dx-loadpanel)',
      'button:has-text("Loading data")',
      'dx-button:has-text("Loading data")',
    ].join(', ');

    try {
      const waveLocator = page.locator(waveSelectors).first();
      if (await waveLocator.isVisible().catch(() => false)) {
        await waveLocator.waitFor({ state: 'hidden', timeout: timeoutMs }).catch(() => null);
      }
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
