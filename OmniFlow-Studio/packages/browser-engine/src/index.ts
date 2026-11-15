// FM AUTO OPS — Browser Manager
// Manages separate persistent Chromium contexts for SAP and POS.
// Prevents session cross-contamination between applications.

import { chromium, BrowserContext, Page, Download } from 'playwright';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';

export type BrowserProfile = 'SAP' | 'POS';

function getProfileBase(): string {
  const appData = process.env['APPDATA'] ?? process.env['HOME'] ?? '.';
  return join(appData, 'FM-AUTO-OPS', 'browser-profiles');
}

export interface BrowserManagerOptions {
  downloadDir: string;
  headless?: boolean;
  onProgress?: (status: string) => void;
}

export class BrowserManager {
  private contexts: Map<BrowserProfile, BrowserContext> = new Map();
  private readonly downloadDir: string;
  private readonly headless: boolean;
  private readonly onProgress?: (status: string) => void;

  constructor(options: BrowserManagerOptions) {
    this.downloadDir = options.downloadDir;
    this.headless = options.headless ?? false;
    this.onProgress = options.onProgress;
    if (!existsSync(this.downloadDir)) {
      mkdirSync(this.downloadDir, { recursive: true });
    }
  }

  private report(status: string): void {
    if (this.onProgress) {
      try { this.onProgress(status); } catch {}
    }
  }

  /**
   * Get or create a persistent browser context for the given profile.
   * SAP and POS use completely separate browser profiles.
   */
  async getContext(profile: BrowserProfile): Promise<BrowserContext> {
    const existing = this.contexts.get(profile);
    if (existing) {
      try {
        const pages = existing.pages().filter(p => !p.isClosed());
        if (pages.length > 0) {
          // Ping the active page to verify context is healthy
          await pages[0].evaluate(() => 1);
          return existing;
        }
      } catch {
        // Stale or dead context
        this.report(`[BrowserManager] Stale context detected for ${profile}, recovering...`);
      }
      try {
        await existing.close();
      } catch {}
      this.contexts.delete(profile);
      await new Promise(r => setTimeout(r, 150));
    }

    const profileDir = join(getProfileBase(), profile.toLowerCase());
    mkdirSync(profileDir, { recursive: true });

    const launchOptions = {
      headless: this.headless,
      acceptDownloads: true,
      downloadsPath: this.downloadDir,
      viewport: null, // use full browser window size
      ignoreHTTPSErrors: true,
      args: [
        '--start-maximized',
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-breakpad',
        '--disable-component-update',
        '--disable-default-apps',
        '--disable-domain-reliability',
        '--disable-ipc-flooding-protection',
        '--disable-renderer-backgrounding',
        '--disable-sync',
        '--force-color-profile=srgb',
        '--metrics-recording-only',
        '--password-store=basic',
      ],
      locale: 'vi-VN',
      timezoneId: 'Asia/Ho_Chi_Minh',
    };

    let context: BrowserContext;
    try {
      // Launch using system default browser Microsoft Edge first
      context = await chromium.launchPersistentContext(profileDir, {
        ...launchOptions,
        channel: 'msedge',
      });
    } catch {
      try {
        // Fallback to Google Chrome
        context = await chromium.launchPersistentContext(profileDir, {
          ...launchOptions,
          channel: 'chrome',
        });
      } catch {
        // Fallback to bundled Chromium
        context = await chromium.launchPersistentContext(profileDir, launchOptions);
      }
    }

    context.on('close', () => {
      this.report(`[BrowserManager] Context closed for ${profile}`);
      this.contexts.delete(profile);
    });

    context.on('page', (page) => {
      page.on('crash', () => {
        console.warn(`[BrowserManager] Page crash detected on ${profile}`);
        this.report(`[BrowserManager] Page crash on ${profile}, preparing self-healing reconnection`);
      });
    });

    context.on('dialog', async (dialog) => {
      console.log(`[BrowserManager] Unexpected dialog on ${profile}: ${dialog.type()} — "${dialog.message()}"`);
      await dialog.dismiss().catch(() => null);
    });

    this.contexts.set(profile, context);
    return context;
  }

  /**
   * Get the active or new page in the given profile context with automatic retry and recovery.
   */
  async getPage(profile: BrowserProfile): Promise<Page> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const context = await this.getContext(profile);
        const pages = context.pages().filter(p => !p.isClosed());
        if (pages.length > 0) {
          const page = pages[0];
          await page.evaluate(() => 1).catch(() => null);
          if (!page.isClosed()) {
            return page;
          }
        }
        return await context.newPage();
      } catch (err) {
        console.warn(`[BrowserManager] getPage attempt ${attempt + 1} failed for ${profile}:`, (err as Error).message);
        this.report(`[BrowserManager] Self-healing retry ${attempt + 1}/3 for ${profile}`);
        await this.closeContext(profile).catch(() => null);
        this.contexts.delete(profile);
        await new Promise(r => setTimeout(r, 200));
      }
    }

    // Final attempt after cleanup
    const context = await this.getContext(profile);
    const pages = context.pages().filter(p => !p.isClosed());
    if (pages.length > 0) return pages[0];
    return await context.newPage();
  }

  /**
   * Wait for a file download triggered by a user action.
   * Uses Playwright's download event.
   */
  async waitForDownload(
    page: Page,
    triggerAction: () => Promise<void>,
    timeoutMs = 60000
  ): Promise<Download> {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: timeoutMs }),
      triggerAction(),
    ]);
    return download;
  }

  /**
   * Save a download to the specified destination.
   */
  async saveDownload(download: Download, destPath: string): Promise<string> {
    await download.saveAs(destPath);
    const tempExtensions = ['.crdownload', '.tmp', '.part'];
    for (const ext of tempExtensions) {
      if (destPath.endsWith(ext)) {
        throw new Error(`Download appears incomplete — file has temp extension: ${ext}`);
      }
    }
    return destPath;
  }

  async closeContext(profile: BrowserProfile): Promise<void> {
    const context = this.contexts.get(profile);
    if (context) {
      try {
        await context.close();
      } catch {
        // Already closed
      }
      this.contexts.delete(profile);
    }
  }

  async closeAll(): Promise<void> {
    for (const profile of Array.from(this.contexts.keys())) {
      await this.closeContext(profile);
    }
  }

  isContextOpen(profile: BrowserProfile): boolean {
    return this.contexts.has(profile);
  }

  async restartContext(profile: BrowserProfile): Promise<BrowserContext> {
    await this.closeContext(profile);
    return this.getContext(profile);
  }
}
