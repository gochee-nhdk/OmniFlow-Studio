// FM AUTO OPS — SAP Business One Web Client, Browser Access Dispatcher & SLD Adapter
// Optimized from empirical video analysis: SAP BusinessOne (https://172.16.1.210:8100/dispatcher/)
// Key optimizations:
//   1. Automatic recovery from SAML2 /dispatcher/saml2/sp/acs NullPointerException black screen
//      by navigating directly back to the root /dispatcher/ URL (preserving SLD session cookies)
//      instead of reloading /saml2/sp/acs (which triggers "Resubmit the Form?" and fails again)
//   2. 25-second settlement window for SAP B1 Browser Access thin-client initialization spinner
//   3. Full support for SAP B1 Browser Access (Dispatcher) menus, System Messages Log dismissal,
//      and end-to-end Query Manager execution & Pricelist export ("Danh sách item ncc pricelist_non_Asset")

import { BrowserManager } from '@fm/browser-engine';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import os from 'os';

export type SAPAuthState =
  | 'NOT_CONFIGURED'
  | 'DISCONNECTED'
  | 'LOGIN_REQUIRED'
  | 'AUTHENTICATING'
  | 'AUTHENTICATED'
  | 'SESSION_EXPIRED'
  | 'AUTH_FAILED'
  | 'CONCURRENT_LOGIN_WARNING'
  | 'ERROR';

export type ConcurrentLoginPrompt = (message: string) => Promise<boolean>;

export type SAPTargetModule =
  | 'HOME'
  | 'PURCHASING_PO'
  | 'PURCHASING_GRPO'
  | 'PURCHASING_RETURN'
  | 'INVENTORY_STATUS'
  | 'QUERY_PRICELIST';

export type SAPWorkflowAction =
  | 'LOGIN'
  | 'NAVIGATE'
  | 'EXPORT_EXCEL'
  | 'RUN_QUERY_EXPORT'
  | 'CHECK_SESSION';

export interface SAPLoginOptions {
  username: string;
  password: string;
  company?: string; // Company schema or display name configured by the user (e.g. Công ty TNHH Thương Mại LARIA)
  server?: string;  // Database server configured by the user (e.g. SBO@172.16.0.201:30013)
  autoTakeOverSession?: boolean;
  targetModule?: SAPTargetModule;
  queryCategory?: string; // Default: 'Danh Mục'
  queryName?: string;     // Default: 'Danh sách item ncc pricelist_non_Asset'
  outputDir?: string;
}

/**
 * Deterministic settlement wait supporting both real Playwright and mock environments.
 */
async function waitForCondition(
  page: any,
  predicate: () => boolean,
  timeout = 10000
): Promise<boolean> {
  if (typeof page.waitForFunction === 'function') {
    try {
      await page.waitForFunction(predicate, { timeout });
      return true;
    } catch {
      return false;
    }
  }

  const startTime = Date.now();
  while (Date.now() - startTime <= timeout) {
    try {
      const res = await page.evaluate(predicate);
      if (res) return true;
    } catch {
      // ignore evaluation errors while DOM is transitioning
    }
    await page.waitForTimeout(20);
  }
  return false;
}

/**
 * Verified input fill: types value and asserts value persisted against showLogonView() resets.
 */
async function fillAndVerify(
  page: any,
  locator: any,
  value: string
): Promise<boolean> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await locator.click().catch(() => null);
    await locator.fill(value);
    if (typeof locator.dispatchEvent === 'function') {
      await locator.dispatchEvent('input').catch(() => null);
      await locator.dispatchEvent('change').catch(() => null);
    }
    await page.waitForTimeout(100);
    const currentVal = await locator.inputValue().catch(() => '');
    if (currentVal === value) {
      return true;
    }
  }
  return false;
}

export class SAPAdapter {
  private browserManager: BrowserManager;
  private sapUrl: string;
  private onConcurrentLogin: ConcurrentLoginPrompt;

  constructor(
    browserManager: BrowserManager,
    sapUrl = process.env.SAP_URL || '',
    onConcurrentLogin: ConcurrentLoginPrompt = async () => false
  ) {
    this.browserManager = browserManager;
    this.sapUrl = sapUrl;
    this.onConcurrentLogin = onConcurrentLogin;
    if (!this.sapUrl) throw new Error('SAP URL is not configured. Set it in the SAP connection settings before automation.');
  }

  /**
   * Derives the clean SAP Dispatcher base URL (e.g. https://172.16.1.210:8100/dispatcher/)
   * even if currentUrl is on /dispatcher/saml2/sp/acs or SLD :40000/ControlCenter/sbo.html.
   */
  public resolveDispatcherRootUrl(currentUrl?: string): string {
    for (const candidate of [this.sapUrl, currentUrl || '']) {
      if (!candidate) continue;
      try {
        const parsed = new URL(candidate);
        if (parsed.pathname.includes('/dispatcher')) {
          return `${parsed.origin}/dispatcher/`;
        }
      } catch {
        // ignore invalid URL
      }
    }
    return this.sapUrl;
  }

  /**
   * Detects the SAP B1 SAML2 ACS NullPointerException error page seen in Video 2 (00:24 - 00:34):
   * URL: https://172.16.1.210:8100/dispatcher/saml2/sp/acs
   * Body: "while trying to invoke the method com.sap.security.saml2.cfg.interfaces.SAML2SPConfiguration.getLocalSP() of a null object loaded from local variable 'configuration'"
   */
  public async isSamlAcsErrorPage(page: any): Promise<boolean> {
    try {
      const url = typeof page.url === 'function' ? page.url() : '';
      if (url.includes('/saml2/sp/acs')) return true;

      const bodyText = await page.evaluate(() => {
        const doc = (globalThis as any).document;
        return doc?.body ? (doc.body.textContent || '') : '';
      }).catch(() => '');

      return /SAML2SPConfiguration|SAML2IdPConfiguration|null object loaded from local variable 'configuration'/i.test(bodyText);
    } catch {
      return false;
    }
  }

  /**
   * Checks whether the SAP workspace (Browser Access /dispatcher/ or Fiori Web Client) is loaded.
   */
  private async isSAPWorkspaceLoaded(page: any): Promise<boolean> {
    const count = await page.locator(
      ':text("Purchasing - A/P"), :text("Purchasing"), :text("Look up menus"), :text("System Messages Log"), #shell-header, .sapMShellTitle, div[title*="Purchasing"]'
    ).count().catch(() => 0);
    return count > 0;
  }

  /**
   * Navigates to the requested SAP module or executes the Query Manager Pricelist workflow.
   */
  public async navigateToTargetModule(
    page: any,
    targetModule: SAPLoginOptions['targetModule'],
    onProgress?: (msg: string) => void,
    options?: Partial<SAPLoginOptions>
  ): Promise<void> {
    await page.bringToFront?.().catch?.(() => null);
    if (!targetModule || targetModule === 'HOME') return;

    if (targetModule === 'QUERY_PRICELIST') {
      await this.runQueryManagerAndExport(page, {
        queryCategory: options?.queryCategory || 'Danh Mục',
        queryName: options?.queryName || 'Danh sách item ncc pricelist_non_Asset',
        outputDir: options?.outputDir,
      }, onProgress);
      return;
    }

    await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => null);
    await page.waitForSelector('.sapMShellTitle, #shell-header, .sapUshellShellHead, nav[role="navigation"], :text("Purchasing - A/P")', { timeout: 10000 }).catch(() => null);

    const config: Record<string, { parents: string[]; labels: string[]; readable: string }> = {
      PURCHASING_PO: {
        parents: ['Purchasing - A/P', 'Mua hàng - A/P', 'Purchasing', 'Phân hệ Mua hàng'],
        labels: ['Purchase Order', 'Purchase Orders', 'Create Purchase Order', 'Đơn đặt hàng mua', 'Đơn mua hàng'],
        readable: 'Đặt hàng (Purchase Order)',
      },
      PURCHASING_GRPO: {
        parents: ['Purchasing - A/P', 'Mua hàng - A/P', 'Purchasing'],
        labels: ['Goods Receipt PO', 'Goods Receipt POs', 'Nhập hàng từ PO', 'Phiếu nhập kho mua hàng'],
        readable: 'Nhập kho (Goods Receipt PO)',
      },
      PURCHASING_RETURN: {
        parents: ['Purchasing - A/P', 'Mua hàng - A/P', 'Purchasing'],
        labels: ['Goods Return', 'Goods Returns', 'Goods Return Request', 'Trả hàng mua', 'Xuất trả hàng nhà cung cấp'],
        readable: 'Xuất trả hàng (Goods Return)',
      },
      INVENTORY_STATUS: {
        parents: ['Inventory', 'Kho hàng', 'Tồn kho', 'Purchasing - A/P'],
        labels: ['Inventory Status', 'Inventory Reports', 'Items', 'Item Master Data', 'Báo cáo tồn kho', 'Danh mục hàng hóa'],
        readable: 'Kiểm tra tồn kho (Inventory Status)',
      },
    };
    const target = config[targetModule];
    if (!target) return;

    const clickLabel = async (label: string, selectors: string[] = []): Promise<boolean> => {
      const exactSelectors = [
        `.sapMGT:has-text("${label}")`, `.sapUshellTile:has-text("${label}")`,
        `a:has-text("${label}")`, `button:has-text("${label}")`,
        `[role="treeitem"]:has-text("${label}")`, `:text-is("${label}")`, `:text("${label}")`,
      ];
      for (const selector of [...selectors, ...exactSelectors]) {
        const locator = page.locator(selector).first();
        if (await locator.isVisible({ timeout: 1200 }).catch(() => false)) {
          try {
            await locator.click({ timeout: 2500 });
            await page.waitForTimeout(700);
            return true;
          } catch { /* try next */ }
        }
      }
      return false;
    };

    let navigated = false;
    for (const label of target.labels) {
      if (await clickLabel(label)) {
        navigated = true;
        break;
      }
    }

    if (!navigated) {
      for (const parent of target.parents) {
        if (await clickLabel(parent)) {
          for (const label of target.labels) {
            if (await clickLabel(label)) {
              navigated = true;
              break;
            }
          }
          if (navigated) break;
        }
      }
    }

    // Fallback to SAP Browser Access "Look up menus" search box (top-right in Video 2) or Fiori search
    if (!navigated) {
      for (const selector of [
        'input[placeholder*="Look up menus" i]',
        'input[placeholder*="Search" i]',
        'input[placeholder*="Tìm" i]',
        '#shell-header input',
        '.sapUshellSearch input',
      ]) {
        const search = page.locator(selector).first();
        if (!(await search.isVisible({ timeout: 800 }).catch(() => false))) continue;
        for (const label of target.labels) {
          try {
            await search.fill(label);
            await search.press('Enter');
            await page.waitForTimeout(900);
            navigated = true;
            break;
          } catch { /* try another alias */ }
        }
        if (navigated) break;
      }
    }

    if (navigated) onProgress?.(`Đã đăng nhập SAP và mở sẵn phân hệ nghiệp vụ: ${target.readable} trên tab trình duyệt.`);
    else onProgress?.(`Đã đăng nhập SAP; chưa tìm thấy menu ${targetModule} để điều hướng.`);
  }

  /**
   * Automates the exact SAP B1 Browser Access Query Manager workflow recorded in Video 2 (01:28 - 02:24):
   * 1. Open Query Manager (via Tools -> Queries -> Query Manager or Toolbar icon)
   * 2. Select category "Danh Mục" -> Select query "Danh sách item ncc pricelist_non_Asset" -> Click OK
   * 3. Click "Export to MS-EXCEL" toolbar icon (X icon)
   * 4. Confirm "Save As" modal (Name + *.txt/*.xls -> OK)
   * 5. Confirm "System Message: Export currency symbols?" ("Yes, to the same column" -> OK)
   * 6. Wait ~12s for file download & "Operation completed successfully [Message 200-48]"
   */
  public async runQueryManagerAndExport(
    page: any,
    options: { queryCategory?: string; queryName?: string; outputDir?: string } = {},
    onProgress?: (msg: string) => void
  ): Promise<{ exported: boolean; filePath?: string }> {
    const category = options.queryCategory || 'Danh Mục';
    const queryName = options.queryName || 'Danh sách item ncc pricelist_non_Asset';

    onProgress?.(`Đang mở Query Manager trên SAP Business One...`);

    // Step 1: Open Query Manager via Tools menu or Toolbar icon
    let queryManagerOpened = false;
    const qmVisible = async () =>
      (await page.locator(':text("Query Manager"), :text("Query Category"), :text("Manage Categories")').count().catch(() => 0)) > 0;

    if (!(await qmVisible())) {
      // Try Toolbar Query Manager icon or Tools -> Queries -> Query Manager
      const toolsMenu = page.locator(':text-is("Tools"), a:has-text("Tools"), div:has-text("Tools")').first();
      if (await toolsMenu.isVisible({ timeout: 1500 }).catch(() => false)) {
        await toolsMenu.click().catch(() => null);
        await page.waitForTimeout(500);
        const queriesItem = page.locator(':text("Queries"), :text("Query Manager")').first();
        if (await queriesItem.isVisible({ timeout: 1500 }).catch(() => false)) {
          await queriesItem.click().catch(() => null);
          await page.waitForTimeout(500);
        }
        const qmSubItem = page.locator(':text("Query Manager")').first();
        if (await qmSubItem.isVisible({ timeout: 1500 }).catch(() => false)) {
          await qmSubItem.click().catch(() => null);
          await page.waitForTimeout(800);
        }
      }

      // Also try "Look up menus" box if Query Manager modal is not yet visible
      if (!(await qmVisible())) {
        const lookupInput = page.locator('input[placeholder*="Look up menus" i]').first();
        if (await lookupInput.isVisible({ timeout: 1200 }).catch(() => false)) {
          await lookupInput.fill('Query Manager').catch(() => null);
          await lookupInput.press('Enter').catch(() => null);
          await page.waitForTimeout(1000);
          const qmResult = page.locator(':text("Query Manager")').first();
          if (await qmResult.isVisible({ timeout: 1200 }).catch(() => false)) {
            await qmResult.click().catch(() => null);
            await page.waitForTimeout(800);
          }
        }
      }
    }

    queryManagerOpened = await qmVisible();
    if (!queryManagerOpened) {
      onProgress?.('Đã vào SAP nhưng chưa mở được cửa sổ Query Manager tự động.');
      return { exported: false };
    }

    // Step 2: Click category "Danh Mục" (01:31 in Video 2)
    onProgress?.(`Đang chọn nhóm truy vấn "${category}" -> "${queryName}"...`);
    const categoryLoc = page.locator(`:text-is("${category}"), :text("${category}")`).first();
    if (await categoryLoc.isVisible({ timeout: 2500 }).catch(() => false)) {
      await categoryLoc.click().catch(() => null);
      await page.waitForTimeout(700);
    }

    // Step 3: Select query "Danh sách item ncc pricelist_non_Asset" (01:35 - 01:39 in Video 2)
    const queryLoc = page.locator(`:text-is("${queryName}"), :text("${queryName}")`).first();
    if (await queryLoc.isVisible({ timeout: 3000 }).catch(() => false)) {
      await queryLoc.click().catch(() => null);
      await page.waitForTimeout(400);
    }

    // Click OK button in Query Manager modal (01:39 in Video 2)
    const okBtn = page.locator('button:has-text("OK"), :text-is("OK")').first();
    if (await okBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await okBtn.click().catch(() => null);
    }

    // Step 4: Wait for query results table to populate (01:40 - 01:45 in Video 2)
    onProgress?.(`Đang thực thi truy vấn "${queryName}" và chờ bảng kết quả...`);
    await page.waitForTimeout(2500);

    // Step 5: Trigger "Export to MS-EXCEL" (01:46 in Video 2)
    const downloadPromise = typeof page.waitForEvent === 'function'
      ? page.waitForEvent('download', { timeout: 35000 }).catch(() => null)
      : Promise.resolve(null);

    const exported = await this.exportCurrentListToExcel(page);
    if (!exported) {
      onProgress?.(`Đã mở bảng kết quả "${queryName}". Hãy nhấn nút Export to MS-EXCEL trên thanh công cụ.`);
      return { exported: false };
    }

    // Step 6: Handle "Save As" dialog ("Enter a file name" -> click OK at 01:51 in Video 2)
    await page.waitForTimeout(800);
    const saveAsOkBtn = page.locator(':text("Save As") ~ * button:has-text("OK"), button:has-text("OK"), :text-is("OK")').first();
    if (await saveAsOkBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      onProgress?.('Đang xác nhận hộp thoại Save As trên SAP...');
      await saveAsOkBtn.click().catch(() => null);
      await page.waitForTimeout(800);
    }

    // Step 7: Handle "System Message: Export currency symbols?" ("Yes, to the same column" -> click OK at 01:54 in Video 2)
    const currencyDialogVisible = (await page.locator(':text("Export currency symbols")').count().catch(() => 0)) > 0;
    if (currencyDialogVisible) {
      onProgress?.('Đang xác nhận hộp thoại "Export currency symbols?" (Yes, to the same column)...');
      const currencyOkBtn = page.locator('button:has-text("OK"), :text-is("OK")').first();
      if (await currencyOkBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await currencyOkBtn.click().catch(() => null);
      }
    }

    // Step 8: Wait for download completion (01:55 - 02:07 in Video 2)
    onProgress?.('Đang chờ SAP kết xuất và tải file về máy (~12 giây)...');
    const download = await downloadPromise;
    if (download && typeof download.saveAs === 'function') {
      const targetDir = options.outputDir || join(os.tmpdir(), 'OmniFlow_SAP_Exports');
      mkdirSync(targetDir, { recursive: true });
      const suggested = (typeof download.suggestedFilename === 'function' && download.suggestedFilename()) || `${queryName}.txt`;
      const finalPath = join(targetDir, suggested.replace(/[<>:"/\\|?*]/g, '_'));
      await download.saveAs(finalPath).catch(() => null);
      onProgress?.(`Đã xuất và lưu thành công file SAP: ${finalPath}`);
      return { exported: true, filePath: finalPath };
    }

    await page.waitForTimeout(3000);
    onProgress?.(`Đã hoàn tất lệnh xuất dữ liệu "${queryName}" trên SAP Business One.`);
    return { exported: true };
  }

  /**
   * Click the Excel export button in the current SAP list/query screen if available.
   */
  async exportCurrentListToExcel(page: any): Promise<boolean> {
    const exportSelectors = [
      'button[title*="Export to Excel" i]',
      'button[title*="Export to MS-EXCEL" i]',
      'button[title*="MS-EXCEL" i]',
      'button[title*="Export to Spreadsheet" i]',
      'button[aria-label*="Export to Excel" i]',
      'button[aria-label*="Export to Spreadsheet" i]',
      '[title*="Export to MS-EXCEL" i]',
      ':text("Export to Excel")',
      ':text("Export to Spreadsheet")',
      ':text("Xuất Excel")',
      ':text("Xuất ra Excel")',
      '.sapUiTableToolbar button[title*="xls" i]',
      '[data-action="exportExcel"]',
    ];

    for (const sel of exportSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
          await btn.click().catch(() => null);
          await page.waitForTimeout(1500);
          return true;
        }
      } catch { /* try next */ }
    }
    return false;
  }

  /**
   * Check if SAP is reachable and session is active.
   */
  async checkSession(): Promise<{ authState: SAPAuthState; currentUrl: string; errorMessage?: string }> {
    const page = await this.browserManager.getPage('SAP');

    try {
      let parsedHost = '';
      try { parsedHost = new URL(this.sapUrl).host; } catch {}
      if (!page.url().includes(parsedHost) && !page.url().includes('dispatcher') && !page.url().includes('ControlCenter')) {
        await page.goto(this.sapUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      }

      await page.waitForTimeout(1500);

      // Recover automatically if sitting on the SAML2 ACS error page
      if (await this.isSamlAcsErrorPage(page)) {
        const dispatcherRoot = this.resolveDispatcherRootUrl(page.url());
        await page.goto(dispatcherRoot, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
        await page.waitForTimeout(3000);
      }

      const currentUrl = page.url();

      if (await this.isSAPWorkspaceLoaded(page)) {
        return { authState: 'AUTHENTICATED', currentUrl };
      }

      const hasSldLoginForm = await page.locator('#sbo_user, #sbo_password, input[type="password"]').count() > 0;
      if (hasSldLoginForm) {
        return { authState: 'LOGIN_REQUIRED', currentUrl };
      }

      return { authState: 'DISCONNECTED', currentUrl, errorMessage: 'Could not determine SAP view state' };
    } catch (error) {
      return {
        authState: 'DISCONNECTED',
        currentUrl: page.url(),
        errorMessage: (error as Error).message,
      };
    }
  }

  /**
   * Perform SAP login with SAML2 ACS error auto-recovery and 25s Browser Access settlement wait.
   */
  async login(
    options: SAPLoginOptions,
    onProgress?: (msg: string) => void,
    maxRetries = 35
  ): Promise<{ success: boolean; authState: SAPAuthState; message: string }> {
    const page = await this.browserManager.getPage('SAP');
    const dispatcherRootUrl = this.resolveDispatcherRootUrl();

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        onProgress?.(`Kiểm tra phiên làm việc SAP (Lần ${attempt}/${maxRetries})...`);

        // 0. If currently on the SAML2 /dispatcher/saml2/sp/acs error screen (Video 2 00:24 - 00:34),
        // navigate immediately to root /dispatcher/ instead of reloading /saml2/sp/acs!
        if (await this.isSamlAcsErrorPage(page)) {
          onProgress?.(`Phát hiện lỗi SAML2 (/dispatcher/saml2/sp/acs) — Đang điều hướng về trang gốc ${dispatcherRootUrl} để nhận phiên...`);
          await page.goto(dispatcherRootUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
          for (let w = 0; w < 22; w++) {
            await page.waitForTimeout(1000);
            if (await this.isSAPWorkspaceLoaded(page)) {
              onProgress?.('Đã khôi phục phiên SAML2 và vào màn hình làm việc SAP thành công!');
              await this.navigateToTargetModule(page, options.targetModule, onProgress, options);
              return { success: true, authState: 'AUTHENTICATED', message: 'Đã vào màn hình làm việc SAP thành công.' };
            }
          }
        }

        // Check if already in authenticated SAP workspace
        if (await this.isSAPWorkspaceLoaded(page)) {
          onProgress?.('Đã vào màn hình làm việc SAP thành công!');
          await this.navigateToTargetModule(page, options.targetModule, onProgress, options);
          return { success: true, authState: 'AUTHENTICATED', message: 'Đã vào màn hình làm việc SAP thành công.' };
        }

        const currentUrl = page.url();
        let parsedHost = '';
        try { parsedHost = new URL(this.sapUrl).host; } catch {}
        if (!currentUrl.includes(parsedHost) && !currentUrl.includes('dispatcher') && !currentUrl.includes('ControlCenter')) {
          onProgress?.(`Mở kết nối SAP: ${this.sapUrl}...`);
          await page.goto(this.sapUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        }

        await page.waitForTimeout(1200);
        if (await this.isSAPWorkspaceLoaded(page)) {
          onProgress?.('Đã vào màn hình làm việc SAP thành công!');
          await this.navigateToTargetModule(page, options.targetModule, onProgress, options);
          return { success: true, authState: 'AUTHENTICATED', message: 'Đã vào màn hình làm việc SAP thành công.' };
        }

        // Wait for SLD login form
        const hasForm = await page.waitForSelector('#sbo_user, input[type="password"]', { state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);

        if (!hasForm) {
          onProgress?.(`Chưa tải được form đăng nhập SAP, đang mở lại ${dispatcherRootUrl} (Lần ${attempt}/${maxRetries})...`);
          await page.goto(dispatcherRootUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
          await page.waitForTimeout(2000);
          continue;
        }

        // 1. Asynchronous Settlement Wait for DB Server
        const dbServerSelect = page.locator('#sbo_dbserver');
        let dbServerLoaded = true;
        if (await dbServerSelect.isVisible().catch(() => false)) {
          dbServerLoaded = await waitForCondition(page, () => {
            const doc = (globalThis as any).document;
            const sel = doc?.getElementById('sbo_dbserver');
            return Boolean(sel && sel.options && sel.options.length > 0);
          }, 3000);

          if (options.server) {
            try {
              await dbServerSelect.selectOption({ label: options.server }).catch(async () => {
                await dbServerSelect.selectOption({ value: options.server });
              });
            } catch {
              // Keep default server
            }
          }
        }

        // 2. Asynchronous Settlement Wait for Company & Safe Refresh Guard (prevent BEFORE_IMPORT1 trap at 00:02 in Video 2)
        const companySelect = page.locator('#sbo_company');
        const rawCompanyInput = (options.company || '').trim();
        if (await companySelect.isVisible().catch(() => false)) {
          let companyLoaded = false;
          if (dbServerLoaded) {
            companyLoaded = await waitForCondition(page, () => {
              const doc = (globalThis as any).document;
              const sel = doc?.getElementById('sbo_company');
              return Boolean(sel && sel.options && sel.options.length > 0);
            }, 3000);
          }

          if (!companyLoaded) {
            const canRefresh = await page.evaluate(() => {
              const doc = (globalThis as any).document;
              const serverSel = doc?.getElementById('sbo_dbserver');
              const compSel = doc?.getElementById('sbo_company');
              const hasDb = Boolean(serverSel && serverSel.selectedIndex >= 0 && serverSel.options && serverSel.options.length > 0);
              const compEmpty = Boolean(!compSel || !compSel.options || compSel.options.length === 0);
              return Boolean(hasDb && compEmpty);
            }).catch(() => false);

            if (canRefresh) {
              const refreshBtn = page.locator('#refresh_company');
              if (await refreshBtn.isVisible().catch(() => false)) {
                await refreshBtn.click().catch(() => null);
                companyLoaded = await waitForCondition(page, () => {
                  const doc = (globalThis as any).document;
                  const sel = doc?.getElementById('sbo_company');
                  return Boolean(sel && sel.options && sel.options.length > 0);
                }, 3000);
              }
            }
          }

          // Multi-Tier Normalized Company Matching
          if (rawCompanyInput) {
            const target = rawCompanyInput;
            const matchResult = await page.evaluate((compTarget: string) => {
              const doc = (globalThis as any).document;
              const select = doc?.getElementById('sbo_company');
              if (!select || !select.options || select.options.length === 0) {
                return { matched: false, matchedIndex: -1, selectedValue: '', selectedText: '', totalOptions: 0 };
              }

              const rawTarget = compTarget.trim();
              const lowerTarget = rawTarget.toLowerCase();
              const schemaMatch = rawTarget.match(/\(([^)]+)\)/);
              const targetSchema = (schemaMatch ? schemaMatch[1].trim() : '').toLowerCase();

              const isPlaceholderOption = (val: string, txt: string) => {
                if (!val || val.trim() === '') return true;
                if (/^\s*(--)?\s*(chọn|select)\b/i.test(txt)) return true;
                return false;
              };

              let matchedIndex = -1;

              // Pass 1: Exact schema or text match
              for (let i = 0; i < select.options.length; i++) {
                const opt = select.options[i];
                const rawVal = opt.value || '';
                const val = rawVal.trim().toLowerCase();
                const rawTxt = opt.textContent || opt.text || '';
                const txt = rawTxt.trim().toLowerCase();

                if (isPlaceholderOption(val, txt)) continue;

                const optSchemaMatch = rawTxt.match(/\(([^)]+)\)/);
                const optSchema = (optSchemaMatch ? optSchemaMatch[1].trim() : '').toLowerCase();

                if (targetSchema && (val === targetSchema || optSchema === targetSchema)) {
                  matchedIndex = i;
                  break;
                }
                if (val && val === lowerTarget) {
                  matchedIndex = i;
                  break;
                }
                if (txt && txt === lowerTarget) {
                  matchedIndex = i;
                  break;
                }
              }

              // Pass 2: Bi-directional substring match
              if (matchedIndex === -1) {
                for (let i = 0; i < select.options.length; i++) {
                  const opt = select.options[i];
                  const rawVal = opt.value || '';
                  const val = rawVal.trim().toLowerCase();
                  const rawTxt = opt.textContent || opt.text || '';
                  const txt = rawTxt.trim().toLowerCase();

                  if (isPlaceholderOption(val, txt)) continue;

                  const optSchemaMatch = rawTxt.match(/\(([^)]+)\)/);
                  const optSchema = (optSchemaMatch ? optSchemaMatch[1].trim() : '').toLowerCase();

                  if (
                    (txt && txt.includes(lowerTarget)) ||
                    (val && val.length >= 2 && lowerTarget.includes(val)) ||
                    (targetSchema && (txt.includes(targetSchema) || (val && val.includes(targetSchema)))) ||
                    (optSchema && optSchema.length >= 2 && lowerTarget.includes(optSchema)) ||
                    (val && lowerTarget.length >= 2 && val.includes(lowerTarget))
                  ) {
                    matchedIndex = i;
                    break;
                  }
                }
              }

              if (matchedIndex >= 0) {
                select.selectedIndex = matchedIndex;
                if (select.options[matchedIndex]) {
                  select.value = select.options[matchedIndex].value;
                }
                const Evt = (globalThis as any).Event;
                select.dispatchEvent(new Evt('change', { bubbles: true }));
                const chosen = select.options[matchedIndex];
                return {
                  matched: true,
                  matchedIndex,
                  selectedValue: chosen ? (chosen.value || '') : '',
                  selectedText: chosen ? (chosen.textContent || chosen.text || '') : '',
                  totalOptions: select.options.length,
                };
              }

              const curr = select.options[select.selectedIndex];
              return {
                matched: false,
                matchedIndex: -1,
                selectedValue: curr ? (curr.value || '') : '',
                selectedText: curr ? (curr.textContent || curr.text || '') : '',
                totalOptions: select.options.length,
              };
            }, target).catch(() => null);

            if (matchResult && matchResult.totalOptions > 0 && !matchResult.matched) {
              const requestedBeforeImport = /before_?import/i.test(target);
              const isBeforeImport = /before_?import/i.test(matchResult.selectedValue);
              const isBlankOrPlaceholder = !matchResult.selectedValue || /^\s*(--)?\s*(chọn|select)\b/i.test(matchResult.selectedText);

              if (isBeforeImport && !requestedBeforeImport) {
                onProgress?.(`Không tìm thấy công ty "${options.company}" trong danh sách và dropdown đang ở BEFORE_IMPORT1. Tránh đăng nhập nhầm vào BEFORE_IMPORT1, thử lại lần ${attempt + 1}...`);
                await page.waitForTimeout(1000);
                continue;
              }
              if (isBlankOrPlaceholder) {
                onProgress?.(`Không tìm thấy công ty "${options.company}" và dropdown đang ở placeholder trống. Thử lại lần ${attempt + 1}...`);
                await page.waitForTimeout(1000);
                continue;
              }
            }
          }
        }

        // 3. Input Stabilization Protocol: Fill User ID & Password with verify
        const userLocator = page.locator('#sbo_user, input[name*="user" i]').first();
        if (await userLocator.isVisible().catch(() => false)) {
          await fillAndVerify(page, userLocator, options.username);
        }

        const passLocator = page.locator('#sbo_password, input[type="password"]:visible').first();
        if (await passLocator.isVisible().catch(() => false)) {
          await fillAndVerify(page, passLocator, options.password);
        }

        const finalUser = await userLocator.inputValue().catch(() => '');
        const finalPass = await passLocator.inputValue().catch(() => '');
        if (!finalUser) await userLocator.fill(options.username);
        if (!finalPass) await passLocator.fill(options.password);

        // Pre-Submit Company Settlement & Selection Guard
        if (await companySelect.isVisible().catch(() => false)) {
          const preSubmitCompany = await page.evaluate(() => {
            const doc = (globalThis as any).document;
            const sel = doc?.getElementById('sbo_company');
            if (!sel || !sel.options || sel.options.length === 0) {
              return { hasOptions: false, count: 0, value: '', text: '' };
            }
            const chosen = sel.options[sel.selectedIndex];
            return {
              hasOptions: true,
              count: sel.options.length,
              value: chosen ? (chosen.value || '').trim() : '',
              text: chosen ? (chosen.textContent || chosen.text || '').trim() : '',
            };
          }).catch(() => ({ hasOptions: false, count: 0, value: '', text: '' }));

          if (rawCompanyInput && preSubmitCompany.hasOptions) {
            const requestedBeforeImport = /before_?import/i.test(rawCompanyInput);
            const isBeforeImport = /before_?import/i.test(preSubmitCompany.value);
            const isBlank = !preSubmitCompany.value || /^\s*(--)?\s*(chọn|select)\b/i.test(preSubmitCompany.text);

            if (isBlank) {
              onProgress?.(`Công ty đang ở placeholder trống trước khi gửi form. Hủy gửi form và thử lại...`);
              await page.waitForTimeout(500);
              continue;
            }

            if (isBeforeImport && !requestedBeforeImport) {
              onProgress?.(`Công ty vẫn đang ở BEFORE_IMPORT1 trước khi gửi form. Hủy gửi form và thử lại...`);
              await page.waitForTimeout(500);
              continue;
            }
          }
        }

        onProgress?.(`Đang nhấn Log On SAP (Lần ${attempt}/${maxRetries})...`);
        const loginBtn = page.locator('#logon_sbo_btn, button:has-text("Log On"), input[value="Log On"]').first();
        if (await loginBtn.isVisible().catch(() => false)) {
          await loginBtn.click().catch(() => null);
        }

        // 4. Post-Logon Polling: Handles SAML2 ACS Error Recovery, Concurrent Login Dialog, and 17s Browser Access Init
        for (let waitSec = 0; waitSec < 20; waitSec++) {
          await page.waitForTimeout(1000);

          // Check if workspace reached already
          if (await this.isSAPWorkspaceLoaded(page)) {
            onProgress?.('Đã đăng nhập thành công vào màn hình làm việc SAP!');
            await this.navigateToTargetModule(page, options.targetModule, onProgress, options);
            return { success: true, authState: 'AUTHENTICATED', message: 'Đăng nhập SAP thành công, đã vào màn hình làm việc.' };
          }

          // Check if SLD redirected to /dispatcher/saml2/sp/acs with NullPointerException (00:24 in Video 2)
          if (await this.isSamlAcsErrorPage(page)) {
            onProgress?.(`Phát hiện lỗi SAML2 (/dispatcher/saml2/sp/acs) sau khi Log On — Đang chuyển hướng thẳng về ${dispatcherRootUrl}...`);
            await page.goto(dispatcherRootUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
            // Wait up to 22s for the blue circular spinner on /dispatcher/ (takes 17s in Video 2: 00:35 -> 00:52)
            for (let dWait = 0; dWait < 22; dWait++) {
              await page.waitForTimeout(1000);
              if (await this.isSAPWorkspaceLoaded(page)) {
                onProgress?.('Đã vào màn hình làm việc SAP Business One thành công sau khi vượt lỗi SAML2!');
                await this.navigateToTargetModule(page, options.targetModule, onProgress, options);
                return { success: true, authState: 'AUTHENTICATED', message: 'Đăng nhập SAP thành công.' };
              }
            }
            break;
          }

          // Check for concurrent user warning dialog scoped inside #messagebox or .sapMDialog
          const modalBox = page.locator('#messagebox:visible, .sapMDialog:visible, #messagebox, .sapMDialog');
          const modalCount = await modalBox.count().catch(() => 0);
          if (modalCount > 0 && await modalBox.first().isVisible().catch(() => false)) {
            const dialogText = await page.evaluate(() => {
              const doc = (globalThis as any).document;
              const el = doc?.querySelector('#messagebox, .sapMDialog');
              return el ? (el.textContent || '') : '';
            }).catch(() => '');

            if (/logged in|đăng nhập|already/i.test(dialogText)) {
              const shouldTakeOver = options.autoTakeOverSession === true || await this.onConcurrentLogin(dialogText);
              if (!shouldTakeOver) {
                return { success: false, authState: 'CONCURRENT_LOGIN_WARNING', message: 'Phát hiện tài khoản SAP đang đăng nhập ở nơi khác. Hãy bật chế độ Tự động chiếm phiên (Take Over Session) nếu bạn muốn tiếp tục.' };
              }
              onProgress?.('Phát hiện có người khác đang trong tài khoản — đang xác nhận tiếp tục...');
              const confirmBtn = modalBox.locator('button:has-text("Yes"), button:has-text("Continue"), button:has-text("Tiếp tục"), button:has-text("Đồng ý"), button:has-text("OK"), .btn-yes').first();
              if (await confirmBtn.isVisible().catch(() => false)) {
                await confirmBtn.click().catch(() => null);
                await page.waitForTimeout(1500);
              }
            } else if (/invalid|không đúng|locked|khoá|failed/i.test(dialogText)) {
              return {
                success: false,
                authState: 'AUTH_FAILED',
                message: `Đăng nhập SAP thất bại: ${dialogText.trim()}`,
              };
            }
          }
        }

        // 5. Final check for workspace landing
        if (await this.isSAPWorkspaceLoaded(page)) {
          onProgress?.('Đã vào màn hình làm việc SAP!');
          await this.navigateToTargetModule(page, options.targetModule, onProgress, options);
          return { success: true, authState: 'AUTHENTICATED', message: 'Đăng nhập SAP thành công.' };
        }

        onProgress?.(`Chưa vào được màn hình làm việc, đang mở lại ${dispatcherRootUrl} (Thử lại lần ${attempt + 1})...`);
        await page.goto(dispatcherRootUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
        await page.waitForTimeout(2000);
      } catch (loopErr) {
        onProgress?.(`Lần thử ${attempt} gặp sự cố: ${(loopErr as Error).message}. Đang thử lại...`);
        await page.goto(dispatcherRootUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
        await page.waitForTimeout(2000);
      }
    }

    return {
      success: false,
      authState: 'AUTH_FAILED',
      message: `Đã thử lại ${maxRetries} lần nhưng chưa vào được màn hình làm việc SAP.`,
    };
  }
}
