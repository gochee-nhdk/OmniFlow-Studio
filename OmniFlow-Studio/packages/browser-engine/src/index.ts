// Dedicated browser session manager for ERP/POS automation.
// The automation profile is persistent per Windows user, but isolated from the user's normal browser profile.

import { chromium, BrowserContext, Page, Download } from 'playwright';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { execSync } from 'child_process';

export type BrowserProfile = 'SAP' | 'POS';
export type BrowserSessionMode = 'not-started' | 'dedicated' | 'attached';

export function getProfileBase(userDataDir?: string): string {
  const appData = userDataDir || process.env['APP_DATA_DIR'] || process.env['PORTABLE_DATA_DIR'] || process.env['APPDATA'] || process.env['HOME'] || '.';
  return join(appData, 'browser-profiles');
}

export interface BrowserManagerOptions {
  downloadDir: string;
  /** Electron's per-user app data directory. The automation browser profile lives below it. */
  userDataDir?: string;
  headless?: boolean;
  /** Attaching to an existing browser is opt-in because it shares cookies, tabs, and profile state. */
  allowCdpAttach?: boolean;
  cdpPorts?: number[];
  onProgress?: (status: string) => void;
}

export class BrowserManager {
  private readonly contexts = new Map<BrowserProfile, BrowserContext>();
  private readonly profilePages = new Map<BrowserProfile, Page>();
  private sharedContext?: BrowserContext;
  private attachedOverCDP = false;
  private readonly downloadDir: string;
  private readonly profileBase: string;
  private readonly headless: boolean;
  private readonly onProgress?: (status: string) => void;
  private readonly cdpPorts: number[];
  private readonly allowCdpAttach: boolean;

  constructor(options: BrowserManagerOptions) {
    this.downloadDir = options.downloadDir;
    this.profileBase = getProfileBase(options.userDataDir);
    this.headless = options.headless ?? false;
    this.onProgress = options.onProgress;
    this.allowCdpAttach = options.allowCdpAttach ?? true;
    this.cdpPorts = options.cdpPorts && options.cdpPorts.length > 0 ? options.cdpPorts : [9222, 9223, 9229];
    mkdirSync(this.downloadDir, { recursive: true });
  }

  getSessionMode(): BrowserSessionMode {
    if (!this.sharedContext) return 'not-started';
    return this.attachedOverCDP ? 'attached' : 'dedicated';
  }

  private report(status: string): void {
    try { this.onProgress?.(status); } catch {}
  }

  private detectSystemDefaultBrowser(): { channel: 'chrome' | 'msedge' } {
    try {
      const result = execSync('reg query "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice" /v ProgId', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      if (/ChromeHTML/i.test(result)) return { channel: 'chrome' };
      if (/MSEdgeHTM/i.test(result)) return { channel: 'msedge' };
    } catch {}
    try {
      const processes = execSync('tasklist /NH', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      if (/chrome\.exe/i.test(processes)) return { channel: 'chrome' };
    } catch {}
    return { channel: 'msedge' };
  }

  private bindContextLifecycle(context: BrowserContext): void {
    context.on('close', () => {
      if (this.sharedContext === context) {
        this.sharedContext = undefined;
        this.attachedOverCDP = false;
        this.contexts.clear();
        this.profilePages.clear();
      }
    });
    context.on('dialog', async (dialog) => {
      this.report(`[BrowserManager] Dismissing an unexpected ${dialog.type()} dialog.`);
      await dialog.dismiss().catch(() => null);
    });
  }

  private async attachOrLaunchBrowser(): Promise<BrowserContext> {
    if (this.sharedContext) {
      try {
        const livePage = this.sharedContext.pages().find((page) => !page.isClosed());
        if (livePage) await livePage.evaluate(() => 1);
        else await this.sharedContext.newPage();
        return this.sharedContext;
      } catch {
        const staleContext = this.sharedContext;
        const wasAttached = this.attachedOverCDP;
        this.sharedContext = undefined;
        this.attachedOverCDP = false;
        this.contexts.clear();
        this.profilePages.clear();
        if (!wasAttached) await staleContext.close().catch(() => null);
        this.report('[BrowserManager] Browser session stopped responding; recovering the automation session.');
      }
    }

    if (this.allowCdpAttach) {
      for (const port of this.cdpPorts) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(800) });
          if (!response.ok) continue;
          const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
          const context = browser.contexts()[0] || await browser.newContext({ acceptDownloads: true });
          this.sharedContext = context;
          this.attachedOverCDP = true;
          this.bindContextLifecycle(context);
          this.report(`[BrowserManager] Explicitly attached to browser on CDP port ${port}; cookies and profile are shared.`);
          return context;
        } catch {}
      }
    }

    const profileDir = join(this.profileBase, 'omniflow-workspace');
    mkdirSync(profileDir, { recursive: true });
    const commonOptions = {
      headless: this.headless,
      acceptDownloads: true,
      downloadsPath: this.downloadDir,
      viewport: null,
      ignoreHTTPSErrors: true,
      locale: 'vi-VN',
      timezoneId: 'Asia/Ho_Chi_Minh',
      args: ['--remote-debugging-port=9222', '--start-maximized', '--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check'],
    };
    const preferred = this.detectSystemDefaultBrowser().channel;
    const candidates: Array<'chrome' | 'msedge' | undefined> = [preferred, preferred === 'msedge' ? 'chrome' : 'msedge', undefined];
    let lastError: unknown;
    for (const channel of candidates) {
      try {
        const context = await chromium.launchPersistentContext(profileDir, {
          ...commonOptions,
          ...(channel ? { channel } : {}),
        });
        this.sharedContext = context;
        this.attachedOverCDP = false;
        this.bindContextLifecycle(context);
        this.report(`[BrowserManager] Started an isolated ${channel || 'Chromium'} window with a persistent OmniFlow profile.`);
        return context;
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`Không thể mở trình duyệt automation riêng. Hãy đóng cửa sổ automation OmniFlow đang bị treo rồi thử lại. ${(lastError as Error)?.message || ''}`);
  }

  /** POS and SAP get separate task tabs inside one tool-owned, persistent browser profile. */
  async getContext(profile: BrowserProfile): Promise<BrowserContext> {
    const context = await this.attachOrLaunchBrowser();
    this.contexts.set(profile, context);
    return context;
  }

  async getPage(profile: BrowserProfile): Promise<Page> {
    const existing = this.profilePages.get(profile);
    if (existing && !existing.isClosed()) {
      try {
        await existing.evaluate(() => 1);
        await existing.bringToFront().catch(() => null);
        return existing;
      } catch {
        this.profilePages.delete(profile);
        this.report(`[BrowserManager] Replacing an unresponsive ${profile} tab.`);
      }
    }

    const context = await this.attachOrLaunchBrowser();
    const openPages = context.pages().filter((page) => !page.isClosed());
    const alreadyAssignedPages = new Set(this.profilePages.values());
    const blankPage = openPages.find((page) =>
      !alreadyAssignedPages.has(page) && /^about:blank$|^(chrome|edge):\/\/newtab\//i.test(page.url())
    );
    const page = blankPage || await context.newPage();
    this.profilePages.set(profile, page);
    this.contexts.set(profile, context);
    page.on('close', () => {
      if (this.profilePages.get(profile) === page) this.profilePages.delete(profile);
    });
    page.on('crash', () => {
      this.report(`[BrowserManager] ${profile} tab crashed; it will be recreated on the next operation.`);
    });
    await page.bringToFront().catch(() => null);
    return page;
  }

  async waitForDownload(page: Page, triggerAction: () => Promise<void>, timeoutMs = 60000): Promise<Download> {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: timeoutMs }),
      triggerAction(),
    ]);
    return download;
  }

  async saveDownload(download: Download, destPath: string): Promise<string> {
    await download.saveAs(destPath);
    const tempExtensions = ['.crdownload', '.tmp', '.part'];
    for (const ext of tempExtensions) {
      if (destPath.endsWith(ext)) throw new Error(`Download appears incomplete — file has temp extension: ${ext}`);
    }
    return destPath;
  }

  async closeContext(profile: BrowserProfile, closeTab = false): Promise<void> {
    // Stop releases task references. Tabs are kept visible unless the caller explicitly
    // requests closure or this is an isolated headless test context.
    if (!this.attachedOverCDP && (closeTab || this.headless)) {
      const ownedPage = this.profilePages.get(profile);
      if (ownedPage && !ownedPage.isClosed()) await ownedPage.close().catch(() => null);
    }
    this.profilePages.delete(profile);
    this.contexts.delete(profile);
  }

  /** Release tab handles but keep the managed browser/profile ready for the next automation. */
  async closeAll(closeTabs = false): Promise<void> {
    for (const profile of Array.from(this.contexts.keys())) await this.closeContext(profile, closeTabs);
  }

  /** Shutdown on app exit. For CDP connections, browser.close() only disconnects the socket —
   *  it does NOT close the user's browser window or tabs. */
  async shutdown(): Promise<void> {
    const context = this.sharedContext;
    const isAttached = this.attachedOverCDP;
    await this.closeAll();
    this.sharedContext = undefined;
    this.attachedOverCDP = false;
    if (context && !isAttached && this.headless) {
      await context.close().catch(() => null);
    } else if (context && isAttached) {
      // Disconnect CDP socket only — leaves user's browser/tabs alive on screen.
      await context.browser()?.close().catch(() => null);
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
