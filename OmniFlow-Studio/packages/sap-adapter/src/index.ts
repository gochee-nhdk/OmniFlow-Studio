// FM AUTO OPS — SAP Business One Web Client & SLD Adapter
// Fully configured with live SAP B1 SLD form elements:
//   - Server select: #sbo_dbserver
//   - Company select: #sbo_company (with #refresh_company)
//   - User ID: #sbo_user
//   - Password: #sbo_password
//   - Submit button: #logon_sbo_btn ("Log On")
//   - Error dialog: #messagebox .dialog_content

import { BrowserManager } from '@fm/browser-engine';

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
  | 'INVENTORY_STATUS';

export type SAPWorkflowAction =
  | 'LOGIN'
  | 'NAVIGATE'
  | 'EXPORT_EXCEL'
  | 'CHECK_SESSION';

export interface SAPLoginOptions {
  username: string;
  password: string;
  company?: string; // Company schema or display name configured by the user.
  server?: string;  // Database server configured by the user.
  autoTakeOverSession?: boolean;
  targetModule?: SAPTargetModule;
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

  // Fallback for mock environments (e.g. MockPage)
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

  private async navigateToTargetModule(page: any, targetModule: SAPLoginOptions['targetModule'], onProgress?: (msg: string) => void): Promise<void> {
    await page.bringToFront?.().catch?.(() => null);
    if (!targetModule || targetModule === 'HOME') return;
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => null);
    await page.waitForSelector('.sapMShellTitle, #shell-header, .sapUshellShellHead, nav[role="navigation"]', { timeout: 10000 }).catch(() => null);

    const config: Record<string, { parents: string[]; labels: string[]; readable: string }> = {
      PURCHASING_PO: { parents: ['Purchasing - A/P', 'Mua hàng - A/P', 'Purchasing', 'Phân hệ Mua hàng'], labels: ['Purchase Order', 'Purchase Orders', 'Create Purchase Order', 'Đơn đặt hàng mua', 'Đơn mua hàng'], readable: 'Đặt hàng (Purchase Order)' },
      PURCHASING_GRPO: { parents: ['Purchasing - A/P', 'Mua hàng - A/P', 'Purchasing'], labels: ['Goods Receipt PO', 'Goods Receipt POs', 'Nhập hàng từ PO', 'Phiếu nhập kho mua hàng'], readable: 'Nhập kho (Goods Receipt PO)' },
      PURCHASING_RETURN: { parents: ['Purchasing - A/P', 'Mua hàng - A/P', 'Purchasing'], labels: ['Goods Return', 'Goods Returns', 'Goods Return Request', 'Trả hàng mua', 'Xuất trả hàng nhà cung cấp'], readable: 'Xuất trả hàng (Goods Return)' },
      INVENTORY_STATUS: { parents: ['Inventory', 'Kho hàng', 'Tồn kho', 'Purchasing - A/P'], labels: ['Inventory Status', 'Inventory Reports', 'Items', 'Item Master Data', 'Báo cáo tồn kho', 'Danh mục hàng hóa'], readable: 'Kiểm tra tồn kho (Inventory Status)' },
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
          } catch { /* try the next matching element */ }
        }
      }
      return false;
    };

    let navigated = false;
    // Prefer an already-visible Fiori tile or menu entry.
    for (const label of target.labels) {
      if (await clickLabel(label)) {
        navigated = true;
        break;
      }
    }

    // Expand the appropriate application menu and find its child entry.
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

    // SAP Web Client deployments may expose only the shell menu search.
    if (!navigated) {
      for (const selector of ['input[placeholder*="Search" i]', 'input[placeholder*="Tìm" i]', '#shell-header input', '.sapUshellSearch input']) {
        const search = page.locator(selector).first();
        if (!(await search.isVisible({ timeout: 800 }).catch(() => false))) continue;
        for (const label of target.labels) {
          try {
            await search.fill(label);
            await search.press('Enter');
            await page.waitForTimeout(900);
            navigated = true;
            break;
          } catch { /* try another target alias */ }
        }
        if (navigated) break;
      }
    }

    if (navigated) onProgress?.(`Đã đăng nhập SAP và mở sẵn phân hệ nghiệp vụ: ${target.readable} trên tab trình duyệt.`);
    else onProgress?.(`Đã đăng nhập SAP; chưa tìm thấy menu ${targetModule} để điều hướng.`);
  }

  /**
   * Click the Excel export button in the current SAP list screen if available.
   * Works for Purchase Orders, Goods Return and other list views that expose
   * an export-to-spreadsheet action.
   */
  async exportCurrentListToExcel(page: any): Promise<boolean> {
    // Common SAP B1 / Fiori export selectors
    const exportSelectors = [
      'button[title*="Export to Excel" i]',
      'button[title*="Export to Spreadsheet" i]',
      'button[aria-label*="Export to Excel" i]',
      'button[aria-label*="Export to Spreadsheet" i]',
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
      const currentUrl = page.url();

      // Check for authenticated navigation menu
      const hasPurchasing = await page.locator(':text("Purchasing - A/P"), :text("Financials"), .sapMShellTitle').count() > 0;
      if (hasPurchasing) {
        return { authState: 'AUTHENTICATED', currentUrl };
      }

      // Check for SLD login form or standard password input
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
   * Perform SAP login with aggressive loop retry:
   * - Continuously reloads and re-attempts login
   * - Auto-confirms concurrent login warnings (takes over session)
   * - Stops immediately as soon as SAP workspace/Web Client is reached
   */
  async login(
    options: SAPLoginOptions,
    onProgress?: (msg: string) => void,
    maxRetries = 35
  ): Promise<{ success: boolean; authState: SAPAuthState; message: string }> {
    const page = await this.browserManager.getPage('SAP');

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        onProgress?.(`Kiểm tra phiên làm việc SAP (Lần ${attempt}/${maxRetries})...`);

        // Check if already in authenticated SAP workspace
        const hasPurchasing = await page.locator(':text("Purchasing - A/P"), :text("Purchasing"), #shell-header, .sapMShellTitle, div[title*="Purchasing"]').count().catch(() => 0);
        if (hasPurchasing > 0) {
          onProgress?.('Đã vào màn hình làm việc SAP thành công!');
          await this.navigateToTargetModule(page, options.targetModule, onProgress);
          return { success: true, authState: 'AUTHENTICATED', message: 'Đã vào màn hình làm việc SAP thành công.' };
        }

        const currentUrl = page.url();
        let parsedHost = '';
        try { parsedHost = new URL(this.sapUrl).host; } catch {}
        if (!currentUrl.includes(parsedHost) && !currentUrl.includes('dispatcher') && !currentUrl.includes('ControlCenter')) {
          onProgress?.(`Mở kết nối SAP: ${this.sapUrl}...`);
          await page.goto(this.sapUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        }

        // Check again if page redirected straight into Web Client
        await page.waitForTimeout(1200);
        const isAuthNow = await page.locator(':text("Purchasing - A/P"), :text("Purchasing"), #shell-header, .sapMShellTitle').count().catch(() => 0);
        if (isAuthNow > 0) {
          onProgress?.('Đã vào màn hình làm việc SAP thành công!');
          await this.navigateToTargetModule(page, options.targetModule, onProgress);
          return { success: true, authState: 'AUTHENTICATED', message: 'Đã vào màn hình làm việc SAP thành công.' };
        }

        // Wait for login form
        const hasForm = await page.waitForSelector('#sbo_user, input[type="password"]', { state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);

        if (!hasForm) {
          // If neither authenticated nor login form, reload link
          onProgress?.(`Chưa tải được form đăng nhập SAP, đang reload lại link (Lần ${attempt}/${maxRetries})...`);
          await page.goto(this.sapUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
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

        // 2. Asynchronous Settlement Wait for Company & Safe Refresh Guard
        const companySelect = page.locator('#sbo_company');
        const rawCompanyInput = (options.company || '').trim();
        if (await companySelect.isVisible().catch(() => false)) {
          // Deterministic wait for sbo_company options to settle
          let companyLoaded = false;
          if (dbServerLoaded) {
            companyLoaded = await waitForCondition(page, () => {
              const doc = (globalThis as any).document;
              const sel = doc?.getElementById('sbo_company');
              return Boolean(sel && sel.options && sel.options.length > 0);
            }, 3000);
          }

          // Safe Refresh Guard:
          // ONLY click #refresh_company if sbo_company has 0 options AND sbo_dbserver has a selected option
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
              // Extract schema code enclosed in parentheses, e.g. "Company Name (SCHEMA_CODE)" -> "SCHEMA_CODE"
              const schemaMatch = rawTarget.match(/\(([^)]+)\)/);
              const targetSchema = (schemaMatch ? schemaMatch[1].trim() : '').toLowerCase();

              const isPlaceholderOption = (val: string, txt: string) => {
                if (!val || val.trim() === '') return true;
                if (/^\s*(--)?\s*(chọn|select)\b/i.test(txt)) return true;
                return false;
              };

              let matchedIndex = -1;

              // Pass 1: Tier 1 (Schema code exact match) & Tier 2 (Text exact match case-insensitive)
              for (let i = 0; i < select.options.length; i++) {
                const opt = select.options[i];
                const rawVal = opt.value || '';
                const val = rawVal.trim().toLowerCase();
                const rawTxt = opt.textContent || opt.text || '';
                const txt = rawTxt.trim().toLowerCase();

                if (isPlaceholderOption(val, txt)) continue;

                const optSchemaMatch = rawTxt.match(/\(([^)]+)\)/);
                const optSchema = (optSchemaMatch ? optSchemaMatch[1].trim() : '').toLowerCase();

                // Tier 1: Schema code exact match against value or text schema
                if (targetSchema && (val === targetSchema || optSchema === targetSchema)) {
                  matchedIndex = i;
                  break;
                }
                if (val && val === lowerTarget) {
                  matchedIndex = i;
                  break;
                }

                // Tier 2: Text exact match (case-insensitive)
                if (txt && txt === lowerTarget) {
                  matchedIndex = i;
                  break;
                }
              }

              // Pass 2: Tier 3 (Bi-directional substring containment, case-insensitive)
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

            // Guard against unmatched company falling back silently to BEFORE_IMPORT1 or empty placeholder
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

        // Pre-Submit Assertion: Ensure neither field is blank before clicking Log On
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

        // 4. Logon Trigger & Scoped Modal Auto-Confirmation
        for (let waitSec = 0; waitSec < 8; waitSec++) {
          await page.waitForTimeout(1000);

          // Check if workspace reached already
          const reached = await page.locator(':text("Purchasing - A/P"), :text("Purchasing"), #shell-header, .sapMShellTitle, div[title*="Purchasing"]').count().catch(() => 0);
          if (reached > 0) {
            onProgress?.('Đã đăng nhập thành công vào màn hình làm việc SAP!');
            await this.navigateToTargetModule(page, options.targetModule, onProgress);
            return { success: true, authState: 'AUTHENTICATED', message: 'Đăng nhập SAP thành công, đã vào màn hình làm việc.' };
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
              // Early exit on fatal auth failure to avoid unnecessary retry cycles
              return {
                success: false,
                authState: 'AUTH_FAILED',
                message: `Đăng nhập SAP thất bại: ${dialogText.trim()}`,
              };
            }
          }
        }

        // 5. Final check for workspace landing
        const finalCheck = await page.locator(':text("Purchasing - A/P"), :text("Purchasing"), #shell-header, .sapMShellTitle, div[title*="Purchasing"]').count().catch(() => 0);
        if (finalCheck > 0) {
          onProgress?.('Đã vào màn hình làm việc SAP!');
          await this.navigateToTargetModule(page, options.targetModule, onProgress);
          return { success: true, authState: 'AUTHENTICATED', message: 'Đăng nhập SAP thành công.' };
        }

        // Still not authenticated: Reload link per user instructions
        onProgress?.(`Chưa vào được màn hình làm việc, đang reload lại link (Thử lại lần ${attempt + 1})...`);
        await page.goto(this.sapUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
        await page.waitForTimeout(2000);
      } catch (loopErr) {
        onProgress?.(`Lần thử ${attempt} gặp sự cố: ${(loopErr as Error).message}. Đang reload thử lại...`);
        await page.goto(this.sapUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
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
