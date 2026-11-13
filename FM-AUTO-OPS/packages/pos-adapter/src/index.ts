// FM AUTO OPS — POS RPFO Automation Adapter
// Direct implementation based on verified DOM and live network inspection
// Verified login form: #txtName, #txtPassword, input[type="submit"]
// Verified outlet select: .blog-sider-common -> /admin/dashboard
// Verified reports: /admin/report/sales-transaction-detail & /admin/report/inventory-onhand

import { Page, Download } from 'playwright';
import { format, isValid } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import ExcelJS from 'exceljs';
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
  storeFilter?: string;
  outputDir?: string;
  fileNameTemplate?: string;
}

export interface SalesDownloadOptions {
  fromDate?: string; // YYYY-MM-DD
  toDate?: string;   // YYYY-MM-DD
  storeFilter?: string;
  outputDir?: string;
  fileNameTemplate?: string;
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

export class POSAdapter {
  private browserManager: BrowserManager;
  private baseUrl: string;

  constructor(browserManager: BrowserManager, baseUrl = 'http://172.16.1.200/') {
    this.browserManager = browserManager;
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  }

  /**
   * Ensure user is authenticated into POS and shop/admin session is active.
   */
  async ensureAuthenticated(credentials?: POSCredentials): Promise<Page> {
    const page = await this.browserManager.getPage('POS');
    const currentUrl = page.url();

    if (!currentUrl.startsWith(this.baseUrl) || currentUrl === 'about:blank') {
      await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForTimeout(1500);
    }

    // 1. Check if login form is displayed
    const hasLoginForm = page.url().includes('/home') || (await page.locator('#txtName').count()) > 0;
    if (hasLoginForm) {
      if (!credentials?.username || !credentials?.password) {
        throw new Error('POS login is required, but no POS credentials are saved. Please configure in Settings.');
      }

      await page.fill('#txtName', credentials.username);
      await page.fill('#txtPassword', credentials.password);
      await page.locator('input[type="submit"], button:has-text("Login")').first().click();
      await page.waitForTimeout(3000);
    }

    // 2. Check if outlet selection is required
    const hasOutlets = page.url().includes('select-outlets') || (await page.locator('.blog-sider-common').count()) > 0;
    if (hasOutlets) {
      const outletCard = page.locator('.blog-sider-common').first();
      if (await outletCard.isVisible().catch(() => false)) {
        await outletCard.click();
        await page.waitForTimeout(4000);
      }
    }

    return page;
  }

  /**
   * Check if the POS session is currently valid.
   */
  async checkSession(credentials?: POSCredentials): Promise<POSSessionState> {
    try {
      const page = await this.ensureAuthenticated(credentials);
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
   * Log into POS if session is expired.
   */
  async login(credentials: POSCredentials): Promise<boolean> {
    await this.ensureAuthenticated(credentials);
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
      if (options.storeFilter && options.storeFilter !== 'All') {
        await this.setStoreFilter(page, options.storeFilter, 'sales');
      }
    } catch (e) {
      console.warn('Date/Store filter setting note:', (e as Error).message);
    }

    // Click Search to populate grid
    const searchBtn = page.locator('button:has-text("Search"), a:has-text("Search"), :text("Search")').first();
    if (await searchBtn.isVisible().catch(() => false)) {
      await searchBtn.click().catch(() => null);
      await page.waitForTimeout(3000);
    }

    // Locate Excel button
    const excelBtn = page.locator('button:has-text("Excel"), .dx-button:has-text("Excel"), :text("Excel")').first();
    await excelBtn.waitFor({ state: 'visible', timeout: 15000 });

    const tempFilename = `Sales_${format(new Date(), 'yyyyMMdd_HHmmss')}_TM01.xlsx`;
    const tempPath = `D:\\FM_AUTO_OPS\\Temp\\${tempFilename}`;
    if (!existsSync('D:\\FM_AUTO_OPS\\Temp')) {
      mkdirSync('D:\\FM_AUTO_OPS\\Temp', { recursive: true });
    }

    // Capture either direct backend export stream OR browser download event
    const responsePromise = page.waitForResponse(
      (res) => res.url().includes('Export_RPT_SalesTransactionDetail') && res.status() === 200,
      { timeout: 40000 }
    ).catch(() => null);

    const downloadPromise = page.waitForEvent('download', { timeout: 40000 }).catch(() => null);

    await excelBtn.click();

    const [resp, download] = await Promise.all([responsePromise, downloadPromise]);

    if (resp) {
      try {
        const buf = await resp.body();
        if (buf.length > 500) {
          writeFileSync(tempPath, buf);
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

    if (download) {
      try {
        await download.saveAs(tempPath);
        return {
          reportType: 'SALES',
          suggestedFilename: download.suggestedFilename() || tempFilename,
          tempFilePath: tempPath,
          downloadedAt: new Date().toISOString(),
        };
      } catch (err) {
        console.warn('Download saveAs note:', (err as Error).message);
      }
    }

    // If file was written via response, check if it exists
    if (existsSync(tempPath)) {
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

    // Click Search
    const searchBtn = page.locator('button:has-text("Search"), dx-button[icon="search"], :text("Search")').first();
    if (await searchBtn.isVisible().catch(() => false)) {
      await searchBtn.click().catch(() => null);
    }

    const invResp = await inventoryResponsePromise;
    const tempFilename = `Inventory_Onhand_${format(new Date(), 'yyyyMMdd_HHmmss')}.xlsx`;
    const tempPath = `D:\\FM_AUTO_OPS\\Temp\\${tempFilename}`;
    if (!existsSync('D:\\FM_AUTO_OPS\\Temp')) {
      mkdirSync('D:\\FM_AUTO_OPS\\Temp', { recursive: true });
    }

    if (invResp) {
      try {
        const jsonData = await invResp.json();
        const items = Array.isArray(jsonData) ? jsonData : (jsonData?.data || []);
        
        // Build Excel Workbook
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Inventory Onhand');
        
        worksheet.columns = [
          { header: 'Store Id', key: 'storeId', width: 12 },
          { header: 'Store Name', key: 'storeName', width: 25 },
          { header: 'Sloc Id', key: 'slocId', width: 12 },
          { header: 'Whs Name', key: 'whsName', width: 25 },
          { header: 'Item Code', key: 'itemCode', width: 18 },
          { header: 'Item Name', key: 'itemName', width: 30 },
          { header: 'UoM', key: 'uom', width: 10 },
          { header: 'Quantity', key: 'quantity', width: 14 },
          { header: 'BeginQty', key: 'beginQty', width: 14 },
          { header: 'In Qty', key: 'inQty', width: 14 },
          { header: 'Out Qty', key: 'outQty', width: 14 },
          { header: 'End Qty', key: 'endQty', width: 14 },
        ];

        for (const item of items) {
          worksheet.addRow(item);
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

  private async setDateFilter(page: Page, field: 'from' | 'to', isoDate: string): Promise<void> {
    const input = page.locator(field === 'from' ? 'input[name*="from" i], input[placeholder*="from" i], input:nth-of-type(1)' : 'input[name*="to" i], input[placeholder*="to" i], input:nth-of-type(2)').first();
    if (await input.isVisible().catch(() => false)) {
      const date = new Date(isoDate);
      const formatted = format(date, 'dd/MM/yyyy');
      await input.fill(formatted).catch(() => null);
    }
  }

  private async setStoreFilter(page: Page, storeFilter: string, _context: 'inventory' | 'sales'): Promise<void> {
    const dropdown = page.locator('select, .dx-selectbox').first();
    if (await dropdown.isVisible().catch(() => false)) {
      await dropdown.selectOption({ label: storeFilter }).catch(() => null);
    }
  }

  static calculateDateRange(rule: 'TODAY' | 'YESTERDAY' | 'LAST_7_DAYS' | 'THIS_MONTH'): { from: string; to: string } {
    const now = toZonedTime(new Date(), TIMEZONE);
    const today = format(now, 'yyyy-MM-dd');

    switch (rule) {
      case 'TODAY':
        return { from: today, to: today };
      case 'YESTERDAY': {
        const d = new Date(now);
        d.setDate(d.getDate() - 1);
        const y = format(toZonedTime(d, TIMEZONE), 'yyyy-MM-dd');
        return { from: y, to: y };
      }
      case 'LAST_7_DAYS': {
        const d = new Date(now);
        d.setDate(d.getDate() - 6);
        return { from: format(toZonedTime(d, TIMEZONE), 'yyyy-MM-dd'), to: today };
      }
      case 'THIS_MONTH': {
        const start = format(new Date(now.getFullYear(), now.getMonth(), 1), 'yyyy-MM-dd');
        return { from: start, to: today };
      }
      default:
        return { from: today, to: today };
    }
  }
}
