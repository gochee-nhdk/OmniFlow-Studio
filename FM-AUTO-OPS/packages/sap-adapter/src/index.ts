// FM AUTO OPS — SAP Business One Web Client & SLD Adapter
// Fully configured with live SAP B1 SLD form elements:
//   - Server select: #sbo_dbserver
//   - Company select: #sbo_company (with #refresh_company)
//   - User ID: #sbo_user
//   - Password: #sbo_password
//   - Submit button: #logon_sbo_btn ("Log On")
//   - Error dialog: #messagebox .dialog_content
// CRITICAL SAFETY RULE: NEVER automatically confirm concurrent login warnings.

import { BrowserManager } from '@fm/browser-engine';

export type SAPAuthState =
  | 'NOT_CONFIGURED'
  | 'DISCONNECTED'
  | 'LOGIN_REQUIRED'
  | 'AUTHENTICATING'
  | 'AUTHENTICATED'
  | 'SESSION_EXPIRED'
  | 'AUTH_FAILED'
  | 'CONCURRENT_LOGIN_WARNING' // ALWAYS pauses workflow — requires human confirmation
  | 'ERROR';

export type ConcurrentLoginPrompt = (message: string) => Promise<boolean>;

export interface SAPLoginOptions {
  username: string;
  password: string;
  company?: string; // Schema or Company Name, e.g. "FM_PRO" or "Công ty TNHH Thương Mại LARIA (FM_PRO)"
  server?: string;  // e.g. "SBO@172.16.0.201:30013"
}

export class SAPAdapter {
  private browserManager: BrowserManager;
  private sapUrl: string;
  private onConcurrentLogin: ConcurrentLoginPrompt;

  constructor(
    browserManager: BrowserManager,
    sapUrl = 'https://172.16.1.210:8100/dispatcher/',
    onConcurrentLogin: ConcurrentLoginPrompt = async () => false
  ) {
    this.browserManager = browserManager;
    this.sapUrl = sapUrl;
    this.onConcurrentLogin = onConcurrentLogin;
  }

  /**
   * Check if SAP is reachable and session is active.
   */
  async checkSession(): Promise<{ authState: SAPAuthState; currentUrl: string; errorMessage?: string }> {
    const page = await this.browserManager.getPage('SAP');

    try {
      if (!page.url().includes('172.16.1.210') && !page.url().includes('172.16.0.201')) {
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
   * Perform SAP login with exact SLD selectors and explicit concurrent login safety pause.
   */
  async login(options: SAPLoginOptions): Promise<{ success: boolean; authState: SAPAuthState; message: string }> {
    const page = await this.browserManager.getPage('SAP');

    try {
      const currentUrl = page.url();
      if (!currentUrl.includes('172.16.1.210') && !currentUrl.includes('172.16.0.201')) {
        await page.goto(this.sapUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      }

      // Wait for login form to load (supports SLD redirect or inline form)
      await page.waitForSelector('#sbo_user, input[type="password"]', { state: 'visible', timeout: 20000 });

      // 1. Select Server if #sbo_dbserver exists and server option provided
      const dbServerSelect = page.locator('#sbo_dbserver');
      if (await dbServerSelect.isVisible().catch(() => false)) {
        if (options.server) {
          try {
            await dbServerSelect.selectOption({ label: options.server }).catch(async () => {
              await dbServerSelect.selectOption({ value: options.server });
            });
          } catch {
            // Keep default server if selection fails
          }
        }
      }

      // 2. Select Company if #sbo_company exists and company option provided
      const companySelect = page.locator('#sbo_company');
      if (await companySelect.isVisible().catch(() => false)) {
        // Wait for company options to load (may take a moment via AJAX)
        await page.waitForTimeout(1000);
        
        // If empty, click refresh button
        const optionCount = await companySelect.locator('option').count();
        if (optionCount <= 1) {
          const refreshBtn = page.locator('#refresh_company');
          if (await refreshBtn.isVisible().catch(() => false)) {
            await refreshBtn.click().catch(() => null);
            await page.waitForTimeout(1500);
          }
        }

        if (options.company) {
          const target = options.company.trim();
          try {
            // Try selecting by exact label or value
            const matched = await page.evaluate((comp: string) => {
              const doc = (globalThis as unknown as { document: { getElementById: (id: string) => { options: Array<{ value: string; text: string }>; selectedIndex: number; dispatchEvent: (e: unknown) => void } | null } }).document;
              const select = doc.getElementById('sbo_company');
              if (!select) return false;
              for (let i = 0; i < select.options.length; i++) {
                const opt = select.options[i];
                if (opt.value === comp || opt.text === comp || opt.text.includes(comp) || opt.value.includes(comp)) {
                  select.selectedIndex = i;
                  return true;
                }
              }
              return false;
            }, target);

            if (!matched) {
              await companySelect.selectOption({ label: target }).catch(() => null);
            }
          } catch {
            // Fallback: keep current selection
          }
        }
      }

      // 3. Fill User ID
      const userLocator = page.locator('#sbo_user, input[name*="user" i], input[type="text"]:visible');
      await userLocator.first().fill(options.username);

      // 4. Fill Password
      const passLocator = page.locator('#sbo_password, input[type="password"]:visible');
      await passLocator.first().fill(options.password);

      // 5. Click Log On button
      const loginBtn = page.locator('#logon_sbo_btn, button:has-text("Log On"), input[value="Log On"]');
      await loginBtn.first().click();

      // 6. Check for Error dialog (#messagebox)
      const errorMsgBox = page.locator('#messagebox');
      const hasErrorDialog = await errorMsgBox.waitFor({ state: 'visible', timeout: 3500 }).then(() => true).catch(() => false);
      if (hasErrorDialog) {
        const errorText = await page.locator('#messagebox .dialog_content').textContent().catch(() => 'SAP Login Failed');
        return {
          success: false,
          authState: 'AUTH_FAILED',
          message: `SAP SLD Error: ${errorText?.trim() || 'Authentication failed'}`,
        };
      }

      // 7. Check for Concurrent Login Warning
      const warningLocator = page.locator(':text("Another user has already logged in"), :text("Your login will logout"), :text("đã đăng nhập")');
      const hasWarning = await warningLocator.waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false);

      if (hasWarning) {
        const warningMsg = (await warningLocator.first().textContent()) || 'Another user is logged in to the company.';

        // STRICT SAFETY: Pause and ask user explicitly
        const userApproved = await this.onConcurrentLogin(warningMsg);
        if (!userApproved) {
          return {
            success: false,
            authState: 'CONCURRENT_LOGIN_WARNING',
            message: 'Concurrent login prompt rejected or cancelled by user.',
          };
        }

        // Only click confirm if user explicitly approved
        const confirmBtn = page.locator('button:has-text("Yes"), button:has-text("Continue"), button:has-text("OK")');
        await confirmBtn.first().click();
      }

      // 8. Verify authenticated state (landing in Web Client)
      await page.waitForSelector(':text("Purchasing - A/P"), #shell-header, .sapMShellTitle, div[title*="Purchasing"]', {
        state: 'visible',
        timeout: 30000,
      });

      return { success: true, authState: 'AUTHENTICATED', message: 'SAP login successful.' };
    } catch (error) {
      return {
        success: false,
        authState: 'AUTH_FAILED',
        message: `SAP login failed: ${(error as Error).message}`,
      };
    }
  }
}
