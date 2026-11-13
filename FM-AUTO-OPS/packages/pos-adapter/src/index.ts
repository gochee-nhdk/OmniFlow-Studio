// FM AUTO OPS — POS RPFO Automation Adapter
// Direct implementation based on verified DOM and reference screenshots

import { Page, Download } from 'playwright';
import { format, isValid } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { POS_SELECTORS } from './selectors';
import { BrowserManager } from '@fm/browser-engine';

const TIMEZONE = 'Asia/Ho_Chi_Minh';

export interface POSSessionState {
  isAuthenticated: boolean;
  dashboardVisible: boolean;
  currentUrl: string;
  detectedAt: string;
}

export interface InventoryDownloadOptions {
  storeFilter: string;
  outputDir: string;
  fileNameTemplate: string;
}

export interface SalesDownloadOptions {
  fromDate: string; // YYYY-MM-DD
  toDate: string;   // YYYY-MM-DD
  storeFilter: string;
  outputDir: string;
  fileNameTemplate: string;
}

export interface POSDownloadResult {
  reportType: 'INVENTORY' | 'SALES';
  suggestedFilename: string;
  tempFilePath: string;
  downloadedAt: string;
}

export class POSAdapter {
  private browserManager: BrowserManager;
  private baseUrl: string;

  constructor(browserManager: BrowserManager, baseUrl = 'http://172.16.1.200/') {
    this.browserManager = browserManager;
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  }

  /**
   * Check if the POS session is currently valid and dashboard is accessible.
   */
  async checkSession(): Promise<POSSessionState> {
    const page = await this.browserManager.getPage('POS');
    const currentUrl = page.url();

    if (!currentUrl.includes('/shop') && !currentUrl.startsWith(this.baseUrl)) {
      await page.goto(`${this.baseUrl}shop`, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null);
    }

    try {
      await page.waitForSelector(POS_SELECTORS.dashboard.pageIndicator.primary, {
        timeout: POS_SELECTORS.dashboard.pageIndicator.timeout,
        state: 'visible',
      });

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
        currentUrl: page.url(),
        detectedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Log into POS if session is expired.
   * Credentials come from CredentialManager — never hardcoded.
   */
  async login(username: string, password: string): Promise<boolean> {
    const page = await this.browserManager.getPage('POS');

    try {
      // Find user input
      const userInput = await page.waitForSelector(
        'input[type="text"], input[name="username"], input[name="user"], input[placeholder*="user" i]',
        { timeout: 10000 }
      );
      await userInput.fill(username);

      const passInput = await page.waitForSelector('input[type="password"]', { timeout: 5000 });
      await passInput.fill(password);

      const submitBtn = await page.waitForSelector(
        'button[type="submit"], button:has-text("Login"), button:has-text("Sign In"), input[type="submit"]',
        { timeout: 5000 }
      );
      await submitBtn.click();

      await page.waitForSelector(POS_SELECTORS.dashboard.pageIndicator.primary, {
        timeout: 20000,
        state: 'visible',
      });

      return true;
    } catch (error) {
      throw new Error(`POS login failed: ${(error as Error).message}`);
    }
  }

  /**
   * Navigate from anywhere to Inventory Onhand via MORE -> Report -> Inventory Onhand
   */
  async navigateToInventoryOnhand(): Promise<Page> {
    const page = await this.browserManager.getPage('POS');
    await this.ensureDashboard(page);

    // Click MORE
    await page.click(POS_SELECTORS.dashboard.moreButton.primary, {
      timeout: POS_SELECTORS.dashboard.moreButton.timeout,
    });

    // Wait for More modal
    await page.waitForSelector(POS_SELECTORS.moreModal.modal.primary, {
      timeout: POS_SELECTORS.moreModal.modal.timeout,
      state: 'visible',
    });

    // Click Report
    await page.click(POS_SELECTORS.moreModal.reportTile.primary, {
      timeout: POS_SELECTORS.moreModal.reportTile.timeout,
    });

    // Wait for submenu (back arrow confirms secondary view)
    await page.waitForSelector(POS_SELECTORS.reportMenu.backButton.primary, {
      timeout: POS_SELECTORS.reportMenu.backButton.timeout,
      state: 'visible',
    });

    // Click Inventory Onhand
    const invItem = page.locator(POS_SELECTORS.reportMenu.inventoryOnhandItem.primary);
    await invItem.scrollIntoViewIfNeeded();
    await invItem.click({ timeout: POS_SELECTORS.reportMenu.inventoryOnhandItem.timeout });

    // Verify target page loaded
    await page.waitForURL('**/admin/report/inventory-onhand', { timeout: 15000 });
    await page.waitForSelector(POS_SELECTORS.inventoryOnhand.pageTitle.primary, {
      timeout: 15000,
      state: 'visible',
    });

    return page;
  }

  /**
   * Navigate from anywhere to Sales Transaction Detail via MORE -> Report -> scroll -> Sales Transaction Detail
   */
  async navigateToSalesTransactionDetail(): Promise<Page> {
    const page = await this.browserManager.getPage('POS');
    await this.ensureDashboard(page);

    await page.click(POS_SELECTORS.dashboard.moreButton.primary, { timeout: 10000 });
    await page.waitForSelector(POS_SELECTORS.moreModal.modal.primary, { timeout: 8000, state: 'visible' });

    await page.click(POS_SELECTORS.moreModal.reportTile.primary, { timeout: 8000 });
    await page.waitForSelector(POS_SELECTORS.reportMenu.backButton.primary, { timeout: 8000, state: 'visible' });

    // Scroll modal to locate Sales Transaction Detail
    const salesItem = page.locator(POS_SELECTORS.reportMenu.salesTransactionDetailItem.primary);
    await salesItem.scrollIntoViewIfNeeded();
    await salesItem.click({ timeout: POS_SELECTORS.reportMenu.salesTransactionDetailItem.timeout });

    await page.waitForURL('**/admin/report/sales-transaction-detail', { timeout: 15000 });
    await page.waitForSelector(POS_SELECTORS.salesTransactionDetail.pageTitle.primary, {
      timeout: 15000,
      state: 'visible',
    });

    return page;
  }

  /**
   * Download Sales Transaction Detail as Excel file.
   * Excel button is CONFIRMED in screenshot.
   */
  async downloadSalesTransactionDetail(options: SalesDownloadOptions): Promise<POSDownloadResult> {
    const page = await this.navigateToSalesTransactionDetail();

    // Set Date filters (From Date, To Date)
    await this.setDateFilter(page, 'from', options.fromDate);
    await this.setDateFilter(page, 'to', options.toDate);

    // Set Store filter
    await this.setStoreFilter(page, options.storeFilter, 'sales');

    // Click Search
    await page.click(POS_SELECTORS.salesTransactionDetail.searchButton.primary, { timeout: 8000 });
    await this.waitForTableOrNoData(page, 'sales');

    // Ensure Excel button is visible
    const excelBtn = page.locator(POS_SELECTORS.salesTransactionDetail.excelButton.primary);
    await excelBtn.waitFor({ state: 'visible', timeout: 8000 });

    // Trigger download and catch browser download event
    const download = await this.browserManager.waitForDownload(
      page,
      async () => {
        await excelBtn.click();
      },
      60000
    );

    const tempPath = await download.path();
    if (!tempPath) {
      throw new Error('Download failed: Playwright received null temporary download path');
    }

    return {
      reportType: 'SALES',
      suggestedFilename: download.suggestedFilename(),
      tempFilePath: tempPath,
      downloadedAt: new Date().toISOString(),
    };
  }

  /**
   * Download Inventory Onhand.
   * Export mechanism discovery required on live DOM.
   */
  async downloadInventoryOnhand(options: InventoryDownloadOptions): Promise<POSDownloadResult> {
    const page = await this.navigateToInventoryOnhand();

    // Set Store filter
    await this.setStoreFilter(page, options.storeFilter, 'inventory');

    // Click Search
    await page.click(POS_SELECTORS.inventoryOnhand.searchButton.primary, { timeout: 8000 });
    await this.waitForTableOrNoData(page, 'inventory');

    // Live inspection of export button
    const hasExcelBtn = await page.locator('button:has-text("Excel")').count() > 0;
    if (hasExcelBtn) {
      const download = await this.browserManager.waitForDownload(
        page,
        async () => {
          await page.click('button:has-text("Excel")');
        },
        60000
      );

      const tempPath = await download.path();
      if (!tempPath) throw new Error('Download temp path was null');

      return {
        reportType: 'INVENTORY',
        suggestedFilename: download.suggestedFilename(),
        tempFilePath: tempPath,
        downloadedAt: new Date().toISOString(),
      };
    }

    // Inspect Report List button
    const hasReportList = await page.locator(POS_SELECTORS.inventoryOnhand.reportListButton.primary).count() > 0;
    if (hasReportList) {
      throw new Error(
        'BLOCKED: Inventory Onhand has no direct Excel button. "Report List" button is visible but requires live inspection to determine export flow.'
      );
    }

    throw new Error('BLOCKED: No export mechanism found on Inventory Onhand page.');
  }

  private async ensureDashboard(page: Page): Promise<void> {
    if (!page.url().includes('/shop')) {
      await page.goto(`${this.baseUrl}shop`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForSelector(POS_SELECTORS.dashboard.pageIndicator.primary, { timeout: 15000 });
    }
  }

  private async setDateFilter(page: Page, field: 'from' | 'to', isoDate: string): Promise<void> {
    const selector = field === 'from'
      ? POS_SELECTORS.salesTransactionDetail.fromDateInput.primary
      : POS_SELECTORS.salesTransactionDetail.toDateInput.primary;

    const input = page.locator(selector);
    const inputType = await input.getAttribute('type');

    if (inputType === 'date') {
      await input.fill(isoDate);
    } else {
      const date = new Date(isoDate);
      const formatted = format(date, 'dd/MM/yyyy');
      await input.clear();
      await input.fill(formatted);
    }

    await input.dispatchEvent('change');
  }

  private async setStoreFilter(page: Page, storeFilter: string, context: 'inventory' | 'sales'): Promise<void> {
    const selector = context === 'inventory'
      ? POS_SELECTORS.inventoryOnhand.storeDropdown.primary
      : POS_SELECTORS.salesTransactionDetail.storeDropdown.primary;

    const dropdown = page.locator(selector);
    const tagName = await dropdown.evaluate((el) => el.tagName.toLowerCase()).catch(() => 'unknown');

    if (tagName === 'select') {
      await dropdown.selectOption({ label: storeFilter }).catch(async () => {
        await dropdown.selectOption({ value: storeFilter });
      });
    } else {
      await dropdown.click();
      await page.click(`[role="option"]:has-text("${storeFilter}"), li:has-text("${storeFilter}")`);
    }
  }

  private async waitForTableOrNoData(page: Page, context: 'inventory' | 'sales'): Promise<void> {
    const tableSelector = context === 'inventory'
      ? POS_SELECTORS.inventoryOnhand.dataTable.primary
      : POS_SELECTORS.salesTransactionDetail.dataTable.primary;
    const noDataSelector = context === 'inventory'
      ? POS_SELECTORS.inventoryOnhand.noDataIndicator.primary
      : POS_SELECTORS.salesTransactionDetail.noDataIndicator.primary;

    await Promise.race([
      page.waitForSelector(tableSelector, { state: 'visible', timeout: 30000 }),
      page.waitForSelector(noDataSelector, { state: 'visible', timeout: 30000 }),
    ]);
  }

  static calculateDateRange(rule: string, fixedFrom?: string, fixedTo?: string): { from: string; to: string } {
    const now = toZonedTime(new Date(), TIMEZONE);
    const today = format(now, 'yyyy-MM-dd');

    switch (rule) {
      case 'TODAY':
        return { from: today, to: today };
      case 'YESTERDAY': {
        const y = new Date(now);
        y.setDate(y.getDate() - 1);
        const yStr = format(y, 'yyyy-MM-dd');
        return { from: yStr, to: yStr };
      }
      case 'LAST_7_DAYS': {
        const d = new Date(now);
        d.setDate(d.getDate() - 7);
        return { from: format(d, 'yyyy-MM-dd'), to: today };
      }
      case 'LAST_30_DAYS': {
        const d = new Date(now);
        d.setDate(d.getDate() - 30);
        return { from: format(d, 'yyyy-MM-dd'), to: today };
      }
      case 'FIXED_RANGE':
      case 'CUSTOM':
        if (!fixedFrom || !fixedTo) throw new Error('Date rule requires fixedFrom and fixedTo');
        return { from: fixedFrom, to: fixedTo };
      default:
        return { from: today, to: today };
    }
  }
}
