// FM AUTO OPS — Browser Manager
// Manages separate persistent Chromium contexts for SAP and POS.
// Prevents session cross-contamination between applications.

import { chromium, BrowserContext, Page, Download } from 'playwright';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { execSync } from 'child_process';

export type BrowserProfile = 'SAP' | 'POS';

function getProfileBase(): string {
  const appData = process.env['APPDATA'] ?? process.env['HOME'] ?? '.';
  return join(appData, 'FM-AUTO-OPS', 'browser-profiles');
}

export interface BrowserManagerOptions {
  downloadDir: string;
  headless?: boolean;
  cdpPorts?: number[];
  onProgress?: (status: string) => void;
}

export class BrowserManager {
  private contexts: Map<BrowserProfile, BrowserContext> = new Map();
  private profilePages = new Map<BrowserProfile, Page>();
  private sharedContext?: BrowserContext;
  private attachedOverCDP = false;
  private readonly downloadDir: string;
  private readonly headless: boolean;
  private readonly onProgress?: (status: string) => void;
  private readonly cdpPorts: number[];

  constructor(options: BrowserManagerOptions) {
    this.downloadDir = options.downloadDir;
    this.headless = options.headless ?? false;
    this.onProgress = options.onProgress;
    this.cdpPorts = options.cdpPorts || [9222, 9223, 9229];
    if (!existsSync(this.downloadDir)) {
      mkdirSync(this.downloadDir, { recursive: true });
    }
  }

  private report(status: string): void {
    if (this.onProgress) {
      try { this.onProgress(status); } catch {}
    }
  }

  private detectSystemDefaultBrowser(): { channel: 'chrome' | 'msedge'; exeName: string } {
    try {
      const result = execSync('reg query "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice" /v ProgId', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      if (/ChromeHTML/i.test(result)) return { channel: 'chrome', exeName: 'chrome.exe' };
      if (/MSEdgeHTM/i.test(result)) return { channel: 'msedge', exeName: 'msedge.exe' };
    } catch {}
    try {
      const processes = execSync('tasklist /NH', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      if (/chrome\.exe/i.test(processes)) return { channel: 'chrome', exeName: 'chrome.exe' };
    } catch {}
    return { channel: 'msedge', exeName: 'msedge.exe' };
  }

  private async attachOrLaunchBrowser(): Promise<BrowserContext> {
    if (this.sharedContext) return this.sharedContext;
    for (const port of this.cdpPorts) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(800) });
        if (!response.ok) continue;
        const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
        this.sharedContext = browser.contexts()[0] || await browser.newContext({ acceptDownloads: true });
        this.attachedOverCDP = true;
        this.report(`[BrowserManager] Attached to active browser on CDP port ${port}`);
        return this.sharedContext;
      } catch {}
    }
    const detected = this.detectSystemDefaultBrowser();
    const profileDir = join(getProfileBase(), 'unified-workspace');
    mkdirSync(profileDir, { recursive: true });
    this.sharedContext = await chromium.launchPersistentContext(profileDir, {
      headless: this.headless,
      channel: detected.channel,
      acceptDownloads: true,
      downloadsPath: this.downloadDir,
      viewport: null,
      ignoreHTTPSErrors: true,
      locale: 'vi-VN',
      timezoneId: 'Asia/Ho_Chi_Minh',
      args: ['--remote-debugging-port=9222', '--start-maximized', '--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check'],
    });
    this.attachedOverCDP = false;
    return this.sharedContext;
  }

  /**
   * Get or create a persistent browser context for the given profile.
   * SAP and POS use completely separate browser profiles.
   */
  async getContext(profile: BrowserProfile): Promise<BrowserContext> {
    if (this.sharedContext) {
      this.contexts.set(profile, this.sharedContext);
      return this.sharedContext;
    }
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

    return this.attachOrLaunchBrowser();

    /* legacy per-profile launch retained below for source history */
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
    const existing = this.profilePages.get(profile);
    if (existing && !existing.isClosed()) {
      await existing.bringToFront().catch(() => null);
      return existing;
    }
    const context = await this.attachOrLaunchBrowser();
    const openPages = context.pages().filter((page) => !page.isClosed());
    let page: Page;
    if (openPages.length === 1 && /^about:blank$|^(chrome|edge):\/\/newtab\//i.test(openPages[0].url())) {
      page = openPages[0];
    } else {
      page = await context.newPage();
    }
    this.profilePages.set(profile, page);
    await page.bringToFront().catch(() => null);
    this.contexts.set(profile, context);
    return page;
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
    const ownedPage = this.profilePages.get(profile);
    if (ownedPage && !ownedPage.isClosed()) await ownedPage.close().catch(() => null);
    this.profilePages.delete(profile);
    const context = this.contexts.get(profile);
    if (this.attachedOverCDP || context === this.sharedContext) {
      this.contexts.delete(profile);
      return;
    }
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
