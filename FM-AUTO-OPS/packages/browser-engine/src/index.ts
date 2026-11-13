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
}

export class BrowserManager {
  private contexts: Map<BrowserProfile, BrowserContext> = new Map();
  private readonly downloadDir: string;
  private readonly headless: boolean;

  constructor(options: BrowserManagerOptions) {
    this.downloadDir = options.downloadDir;
    this.headless = options.headless ?? false;
    if (!existsSync(this.downloadDir)) {
      mkdirSync(this.downloadDir, { recursive: true });
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
        existing.pages();
        return existing;
      } catch {
        this.contexts.delete(profile);
      }
    }

    const profileDir = join(getProfileBase(), profile.toLowerCase());
    mkdirSync(profileDir, { recursive: true });

    const launchOptions = {
      headless: this.headless,
      acceptDownloads: true,
      downloadsPath: this.downloadDir,
      viewport: { width: 1280, height: 900 },
      ignoreHTTPSErrors: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
      ],
      locale: 'vi-VN',
      timezoneId: 'Asia/Ho_Chi_Minh',
    };

    let context: BrowserContext;
    try {
      context = await chromium.launchPersistentContext(profileDir, launchOptions);
    } catch (launchErr: unknown) {
      const err = launchErr as Error;
      if (err.message?.includes("Executable doesn't exist") || err.message?.includes('playwright install')) {
        // Fallback to native Windows Microsoft Edge
        context = await chromium.launchPersistentContext(profileDir, {
          ...launchOptions,
          channel: 'msedge',
        });
      } else {
        throw launchErr;
      }
    }

    context.on('dialog', async (dialog) => {
      console.log(`[BrowserManager] Unexpected dialog on ${profile}: ${dialog.type()} — "${dialog.message()}"`);
      await dialog.dismiss().catch(() => null);
    });

    this.contexts.set(profile, context);
    return context;
  }

  /**
   * Get the active or new page in the given profile context.
   */
  async getPage(profile: BrowserProfile): Promise<Page> {
    const context = await this.getContext(profile);
    const pages = context.pages();
    if (pages.length > 0) return pages[0];
    return context.newPage();
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
