import { BrowserContext, Page, Locator } from 'playwright';
import { CURSOR_INJECTION_SCRIPT } from './cursor-script';

export interface VisualCursorOptions {
  enabled?: boolean;
  headless?: boolean;
  speed?: number;
}

export class VisualCursorManager {
  private static prototypesPatched = false;
  private static defaultOptions: VisualCursorOptions = {
    enabled: true,
    headless: false,
    speed: 1.0,
  };

  /**
   * Installs the visual cursor overlay into a Playwright BrowserContext.
   * Injects the isolated Shadow DOM cursor overlay script and patches
   * Locator and Page action prototypes to coordinate visual cursor gliding.
   */
  public static async install(context: BrowserContext, options?: VisualCursorOptions): Promise<void> {
    const opts: VisualCursorOptions = {
      ...this.defaultOptions,
      ...options,
    };

    (context as any).__omniflowCursorConfig = opts;

    if (opts.enabled === false) {
      return;
    }

    // Register script to run in every current and future document/frame
    await context.addInitScript(CURSOR_INJECTION_SCRIPT).catch(() => null);

    // Patch prototypes on any available page
    const existingPages = context.pages();
    for (const page of existingPages) {
      (page as any).__omniflowCursorConfig = opts;
      this.ensurePrototypesPatched(page);
      this.ensurePageOverlay(page);
    }

    context.on('page', (page) => {
      (page as any).__omniflowCursorConfig = opts;
      this.ensurePrototypesPatched(page);
      this.ensurePageOverlay(page);
    });
  }

  /**
   * Ensures the cursor overlay is present on an active page.
   */
  public static async ensurePageOverlay(page: Page): Promise<void> {
    if (page.isClosed()) return;
    try {
      await page.evaluate(CURSOR_INJECTION_SCRIPT).catch(() => null);
      await page.evaluate(() => {
        const c = (globalThis as any).__omniflowCursor;
        if (c && typeof c.ensureMounted === 'function') {
          c.ensureMounted();
        }
      }).catch(() => null);
    } catch {}
  }

  /**
   * Ensures Playwright's Locator and Page prototypes are patched for visual coordination.
   */
  public static ensurePrototypesPatched(page: Page): void {
    if (this.prototypesPatched || !page || page.isClosed()) {
      return;
    }

    try {
      const pageProto = Object.getPrototypeOf(page);
      const testLoc = page.locator(':root');
      const locatorProto = Object.getPrototypeOf(testLoc);

      if (!pageProto || !locatorProto) {
        return;
      }

      this.prototypesPatched = true;

      // 1. Patch Locator.prototype.click
      const origLocatorClick = locatorProto.click;
      locatorProto.click = async function (this: Locator, options?: any) {
        await VisualCursorManager.handleLocatorAction(this, 'click', options);
        return await origLocatorClick.call(this, options);
      };

      // 2. Patch Locator.prototype.hover
      const origLocatorHover = locatorProto.hover;
      locatorProto.hover = async function (this: Locator, options?: any) {
        await VisualCursorManager.handleLocatorAction(this, 'hover', options);
        return await origLocatorHover.call(this, options);
      };

      // 3. Patch Locator.prototype.fill
      const origLocatorFill = locatorProto.fill;
      locatorProto.fill = async function (this: Locator, value: string, options?: any) {
        await VisualCursorManager.handleLocatorAction(this, 'fill', { ...options, fillValue: value });
        try {
          return await origLocatorFill.call(this, value, options);
        } finally {
          await VisualCursorManager.afterLocatorAction(this, 'fill');
        }
      };

      // 4. Patch Page.prototype.click
      const origPageClick = pageProto.click;
      pageProto.click = async function (this: Page, selector: string, options?: any) {
        await VisualCursorManager.handlePageAction(this, selector, 'click', options);
        return await origPageClick.call(this, selector, options);
      };

      // 5. Patch Page.prototype.hover
      const origPageHover = pageProto.hover;
      pageProto.hover = async function (this: Page, selector: string, options?: any) {
        await VisualCursorManager.handlePageAction(this, selector, 'hover', options);
        return await origPageHover.call(this, selector, options);
      };

      // 6. Patch Page.prototype.fill
      const origPageFill = pageProto.fill;
      pageProto.fill = async function (this: Page, selector: string, value: string, options?: any) {
        await VisualCursorManager.handlePageAction(this, selector, 'fill', { ...options, fillValue: value });
        try {
          return await origPageFill.call(this, selector, value, options);
        } finally {
          await VisualCursorManager.afterPageAction(this, 'fill');
        }
      };

      // 7. Patch Page.prototype.setContent to auto-remount overlay on HTML replacements
      const origPageSetContent = pageProto.setContent;
      pageProto.setContent = async function (this: Page, html: string, options?: any) {
        const result = await origPageSetContent.call(this, html, options);
        await VisualCursorManager.ensurePageOverlay(this);
        return result;
      };
    } catch {
      // Prototype patching fallback
    }
  }

  public static isPatched(): boolean {
    return this.prototypesPatched;
  }

  public static resolveConfig(page?: Page): VisualCursorOptions {
    if (!page || page.isClosed()) {
      return { enabled: false };
    }
    const pageConfig = (page as any).__omniflowCursorConfig;
    if (pageConfig) {
      return pageConfig;
    }
    try {
      const context = page.context();
      const ctxConfig = context ? (context as any).__omniflowCursorConfig : null;
      if (ctxConfig) {
        return ctxConfig;
      }
    } catch {}
    return this.defaultOptions;
  }

  public static async handleLocatorAction(locator: Locator, actionType: 'click' | 'hover' | 'fill', options?: any): Promise<void> {
    try {
      const page = locator.page ? locator.page() : null;
      if (!page || page.isClosed()) return;

      const config = this.resolveConfig(page);
      if (config.enabled === false) return;

      await this.ensurePageOverlay(page);

      const isHeadless = config.headless === true;
      const actionTimeout = typeof options?.timeout === 'number' ? options.timeout : undefined;
      const probeTimeout = actionTimeout !== undefined
        ? Math.min(actionTimeout, isHeadless ? 300 : 1200)
        : (isHeadless ? 300 : 1200);

      await locator.scrollIntoViewIfNeeded({ timeout: probeTimeout }).catch(() => null);
      const box = await locator.boundingBox({ timeout: probeTimeout }).catch(() => null);
      if (!box || page.isClosed()) return;

      const targetX = Math.round(box.x + box.width / 2);
      const targetY = Math.round(box.y + box.height / 2);
      const glideOptions = isHeadless ? { duration: 0 } : { speed: config.speed || 1.0 };

      if (actionType === 'click') {
        await page.evaluate(({ x, y, rect, gOpts }) => {
          const c = (globalThis as any).__omniflowCursor;
          if (!c) return;
          c.highlightElement(rect);
          return c.glideTo(x, y, gOpts).then(() => {
            c.setStatus('⚡ Click');
            c.triggerClickRipple(x, y);
          });
        }, { x: targetX, y: targetY, rect: box, gOpts: glideOptions }).catch(() => null);

        if (!isHeadless) {
          await new Promise((resolve) => setTimeout(resolve, 60));
        }
      } else if (actionType === 'hover') {
        await page.evaluate(({ x, y, rect, gOpts }) => {
          const c = (globalThis as any).__omniflowCursor;
          if (!c) return;
          c.highlightElement(rect);
          return c.glideTo(x, y, gOpts).then(() => {
            c.setStatus('👁️ Hover');
          });
        }, { x: targetX, y: targetY, rect: box, gOpts: glideOptions }).catch(() => null);
      } else if (actionType === 'fill') {
        const isPassword = await locator.evaluate((el: any) => {
          const input = el;
          const type = (input.type || '').toLowerCase();
          const name = (input.name || '').toLowerCase();
          const id = (input.id || '').toLowerCase();
          const aria = (input.getAttribute('aria-label') || '').toLowerCase();
          const auto = (input.getAttribute('autocomplete') || '').toLowerCase();
          const pwdPattern = /\b(password|passwd|pwd|pin|secret)\b/i;
          return type === 'password' ||
                 el.getAttribute('data-secret') === 'true' ||
                 pwdPattern.test(name) ||
                 pwdPattern.test(id) ||
                 pwdPattern.test(aria) ||
                 auto.includes('password');
        }).catch(() => false);

        const val = typeof options?.fillValue === 'string' ? options.fillValue : '';

        await page.evaluate(({ x, y, rect, val, isPwd, gOpts }) => {
          const c = (globalThis as any).__omniflowCursor;
          if (!c) return;
          c.highlightElement(rect);
          return c.glideTo(x, y, gOpts).then(() => {
            c.showTypingBadge(val, isPwd);
          });
        }, { x: targetX, y: targetY, rect: box, val: val, isPwd: isPassword, gOpts: glideOptions }).catch(() => null);

        if (!isHeadless) {
          await new Promise((resolve) => setTimeout(resolve, 80));
        }
      }
    } catch {
      // Graceful degradation: never block execution
    }
  }

  public static async afterLocatorAction(locator: Locator, actionType: string): Promise<void> {
    try {
      const page = locator.page ? locator.page() : null;
      if (!page || page.isClosed()) return;

      const config = this.resolveConfig(page);
      if (config.enabled === false) return;

      if (actionType === 'fill') {
        await page.evaluate(() => {
          const c = (globalThis as any).__omniflowCursor;
          if (c) {
            c.hideTypingBadge();
            c.clearHighlight();
          }
        }).catch(() => null);
      }
    } catch {}
  }

  public static async handlePageAction(page: Page, selector: string, actionType: 'click' | 'hover' | 'fill', options?: any): Promise<void> {
    try {
      if (page.isClosed()) return;
      const locator = page.locator(selector);
      await this.handleLocatorAction(locator, actionType, options);
    } catch {}
  }

  public static async afterPageAction(page: Page, actionType: string): Promise<void> {
    try {
      if (page.isClosed()) return;
      const config = this.resolveConfig(page);
      if (config.enabled === false) return;

      if (actionType === 'fill') {
        await page.evaluate(() => {
          const c = (globalThis as any).__omniflowCursor;
          if (c) {
            c.hideTypingBadge();
            c.clearHighlight();
          }
        }).catch(() => null);
      }
    } catch {}
  }
}
