// FM AUTO OPS — SAP Business One Web Client Adapter
// STATUS: Login logic IMPLEMENTED; Selectors PENDING LIVE INSPECTION
// CRITICAL SAFETY RULE: NEVER automatically confirm concurrent login warnings.

import { Page } from 'playwright';
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
      if (!page.url().includes('172.16.1.210')) {
        await page.goto(this.sapUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      }

      await page.waitForTimeout(1000);
      const currentUrl = page.url();

      // Check for login indicators (standard SAP B1 Web Client forms)
      const hasPasswordField = await page.locator('input[type="password"]').count() > 0;
      if (hasPasswordField) {
        return { authState: 'LOGIN_REQUIRED', currentUrl };
      }

      // Check for authenticated navigation menu
      const hasPurchasing = await page.locator(':text("Purchasing - A/P"), :text("Financials")').count() > 0;
      if (hasPurchasing) {
        return { authState: 'AUTHENTICATED', currentUrl };
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
   * Perform SAP login with explicit concurrent login pause.
   */
  async login(username: string, password: string): Promise<{ success: boolean; authState: SAPAuthState; message: string }> {
    const page = await this.browserManager.getPage('SAP');

    try {
      // Find User Name
      const userInput = await page.waitForSelector(
        'input[name*="user" i], input[id*="user" i], input[placeholder*="user" i], input[type="text"]',
        { timeout: 10000 }
      );
      await userInput.fill(username);

      const passInput = await page.waitForSelector('input[type="password"]', { timeout: 5000 });
      await passInput.fill(password);

      const loginBtn = await page.waitForSelector(
        'button[type="submit"], button:has-text("Log On"), button:has-text("Login"), input[type="submit"]',
        { timeout: 5000 }
      );
      await loginBtn.click();

      // Check for concurrent login warning
      const warningLocator = page.locator(':text("Another user has already logged in"), :text("Your login will logout")');
      const hasWarning = await warningLocator.waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false);

      if (hasWarning) {
        const warningMsg = (await warningLocator.first().textContent()) || 'Another user is logged in to the company.';
        
        // PAUSE and ask user explicitly
        const userApproved = await this.onConcurrentLogin(warningMsg);
        if (!userApproved) {
          return {
            success: false,
            authState: 'CONCURRENT_LOGIN_WARNING',
            message: 'Concurrent login prompt rejected or cancelled by user.',
          };
        }

        // Only click confirm if user explicitly said yes
        const confirmBtn = page.locator('button:has-text("Yes"), button:has-text("Continue"), button:has-text("OK")');
        await confirmBtn.first().click();
      }

      // Verify dashboard
      await page.waitForSelector(':text("Purchasing - A/P"), #shell-header, .sapMShellTitle', {
        state: 'visible',
        timeout: 25000,
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
