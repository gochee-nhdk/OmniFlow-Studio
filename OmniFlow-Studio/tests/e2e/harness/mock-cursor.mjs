// Visual Cursor Simulation Harness for OmniFlow-Studio E2E Tests
// Implements client-side Shadow DOM overlay script and Node-side interaction wrappers
// Strictly conforms to PROJECT.md § Visual Agent In-Browser Cursor Simulation

export const CURSOR_HOST_ID = 'omniflow-cursor-host';
export const CURSOR_ID = 'omniflow-cursor';
export const TYPING_BADGE_ID = 'omniflow-typing-badge';

export const CURSOR_SCRIPT_SOURCE = `
(function(win, doc) {
  const window = win || (typeof globalThis !== 'undefined' ? globalThis.window : this);
  const document = doc || window.document;
  if (!window || !document) return;

  if (window.__omniflowCursorInstalled) return;
  window.__omniflowCursorInstalled = true;

  let host = document.getElementById('${CURSOR_HOST_ID}');
  if (!host) {
    host = document.createElement('div');
    host.id = '${CURSOR_HOST_ID}';
    host.style.position = 'fixed';
    host.style.top = '0';
    host.style.left = '0';
    host.style.width = '0';
    host.style.height = '0';
    host.style.zIndex = '2147483647';
    host.style.pointerEvents = 'none';
    (document.body || document.documentElement || document).appendChild(host);
  }

  const shadow = host.shadowRoot || host.attachShadow({ mode: 'open' });

  // Styles
  const style = document.createElement('style');
  style.textContent = \`
    #\${'${CURSOR_ID}'} {
      position: fixed;
      top: 0;
      left: 0;
      width: 24px;
      height: 24px;
      pointer-events: none;
      z-index: 2147483647;
      transform: translate(0px, 0px);
      transition: transform 200ms cubic-bezier(0.25, 1, 0.5, 1);
      filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
    }
    #\${'${TYPING_BADGE_ID}'} {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      background: rgba(30, 41, 59, 0.9);
      color: #38bdf8;
      border: 1px solid #0284c7;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-family: monospace;
      pointer-events: none;
      z-index: 2147483647;
      box-shadow: 0 2px 6px rgba(0,0,0,0.25);
      white-space: nowrap;
    }
    .omniflow-ripple {
      position: fixed;
      border: 2px solid #ef4444;
      background: rgba(239, 68, 68, 0.2);
      border-radius: 50%;
      pointer-events: none;
      z-index: 2147483646;
      animation: omniflow-ripple-anim 350ms ease-out forwards;
    }
    @keyframes omniflow-ripple-anim {
      0% { width: 0px; height: 0px; opacity: 1; transform: translate(-50%, -50%) scale(0.2); }
      100% { width: 44px; height: 44px; opacity: 0; transform: translate(-50%, -50%) scale(1.6); }
    }
  \`;
  shadow.appendChild(style);

  // SVG Cursor Pointer
  const cursor = (typeof document.createElementNS === 'function')
    ? document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    : document.createElement('svg');
  cursor.id = '${CURSOR_ID}';
  cursor.setAttribute('viewBox', '0 0 24 24');
  cursor.setAttribute('width', '24');
  cursor.setAttribute('height', '24');
  cursor.innerHTML = '<path fill="#ff3b30" stroke="#ffffff" stroke-width="1.5" d="M3 3l7 18 3-7 7-3L3 3z"/>';
  shadow.appendChild(cursor);

  // Typing Badge
  const typingBadge = document.createElement('div');
  typingBadge.id = '${TYPING_BADGE_ID}';
  typingBadge.textContent = '';
  shadow.appendChild(typingBadge);

  let currentX = 0;
  let currentY = 0;
  let rippleCounter = 0;
  let isHeadless = false;

  window.__omniflowCursor = {
    setHeadless(headless) {
      isHeadless = Boolean(headless);
      cursor.style.transition = isHeadless ? 'none' : 'transform 200ms cubic-bezier(0.25, 1, 0.5, 1)';
    },
    moveTo(x, y) {
      currentX = x;
      currentY = y;
      cursor.style.transform = 'translate(' + x + 'px, ' + y + 'px)';
      cursor.style.display = 'block';
    },
    click(x, y) {
      this.moveTo(x, y);
      const ripple = document.createElement('div');
      ripple.className = 'omniflow-ripple';
      ripple.style.left = x + 'px';
      ripple.style.top = y + 'px';
      shadow.appendChild(ripple);
      rippleCounter++;
      const cleanup = () => {
        if (ripple.parentNode) ripple.parentNode.removeChild(ripple);
      };
      if (isHeadless) {
        cleanup();
      } else {
        setTimeout(cleanup, 360);
      }
    },
    showTyping(text, isPassword = false) {
      const displayContent = isPassword ? '●'.repeat(text.length) : text;
      typingBadge.textContent = '[' + text.length + '] ' + displayContent;
      typingBadge.style.display = 'block';
      typingBadge.style.left = (currentX + 22) + 'px';
      typingBadge.style.top = (currentY + 22) + 'px';
    },
    hideTyping() {
      typingBadge.style.display = 'none';
      typingBadge.textContent = '';
    },
    getState() {
      const ripples = shadow.querySelectorAll ? shadow.querySelectorAll('.omniflow-ripple') : shadow.children.filter(c => c.className === 'omniflow-ripple');
      return {
        installed: true,
        hostId: '${CURSOR_HOST_ID}',
        cursorId: '${CURSOR_ID}',
        hasShadow: Boolean(host.shadowRoot),
        x: currentX,
        y: currentY,
        cursorVisible: cursor.style.display !== 'none',
        typingVisible: typingBadge.style.display !== 'none',
        typingText: typingBadge.textContent,
        rippleCount: ripples ? ripples.length : 0,
        totalRipplesCreated: rippleCounter,
        isHeadless,
      };
    }
  };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis.window : this), typeof document !== 'undefined' ? document : (typeof globalThis !== 'undefined' ? globalThis.document : null));
`;

export class VisualCursorManager {
  /**
   * Install the visual cursor overlay script into a browser page or context.
   */
  static async install(page, options = {}) {
    const headless = options.headless ?? true;

    if (page && page.window) {
      // MockPage or simulated window
      const win = page.window;
      const doc = page.document || win.document;
      const fn = new Function('window', 'document', CURSOR_SCRIPT_SOURCE);
      fn(win, doc);
      if (win.__omniflowCursor) {
        win.__omniflowCursor.setHeadless(headless);
      }
      return;
    }

    if (typeof page.addInitScript === 'function') {
      await page.addInitScript(CURSOR_SCRIPT_SOURCE);
    }

    if (typeof page.evaluate === 'function') {
      await page.evaluate((script) => {
        const doc = (globalThis).document;
        if (doc) {
          const fn = new Function('window', 'document', script);
          fn(globalThis.window || doc.defaultView, doc);
        }
      }, CURSOR_SCRIPT_SOURCE).catch(() => null);

      await page.evaluate((h) => {
        if ((globalThis).window?.__omniflowCursor) {
          (globalThis).window.__omniflowCursor.setHeadless(h);
        }
      }, headless).catch(() => null);
    }
  }

  /**
   * Glides the simulated cursor to the center of target element.
   * Auto-scrolls into view if element is offscreen.
   */
  static async glideTo(page, selectorOrLocator, options = {}) {
    if (page && page.window && page.window.__omniflowCursor) {
      let bbox = null;
      if (typeof selectorOrLocator === 'string') {
        const el = page.document?.querySelector(selectorOrLocator);
        if (el) {
          if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const r = el.getBoundingClientRect();
          bbox = { x: r.x + r.width / 2, y: r.y + r.height / 2, scrolled: Boolean(el.__scrolledIntoView) };
        }
      } else if (selectorOrLocator) {
        if (typeof selectorOrLocator.scrollIntoView === 'function') selectorOrLocator.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const r = typeof selectorOrLocator.getBoundingClientRect === 'function' ? selectorOrLocator.getBoundingClientRect() : null;
        if (r) bbox = { x: r.x + r.width / 2, y: r.y + r.height / 2, scrolled: Boolean(selectorOrLocator.__scrolledIntoView) };
      }
      const x = bbox?.x ?? options.x ?? 150;
      const y = bbox?.y ?? options.y ?? 150;
      page.window.__omniflowCursor.moveTo(x, y);
      return { x, y, scrolled: bbox?.scrolled ?? false };
    }

    let bbox = null;
    if (typeof selectorOrLocator === 'string') {
      bbox = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, scrolled: Boolean(el.__scrolledIntoView) };
      }, selectorOrLocator).catch(() => null);
    } else if (selectorOrLocator && typeof selectorOrLocator.boundingBox === 'function') {
      const box = await selectorOrLocator.boundingBox().catch(() => null);
      if (box) bbox = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }

    const x = bbox?.x ?? options.x ?? 150;
    const y = bbox?.y ?? options.y ?? 150;

    await page.evaluate(({ cx, cy }) => {
      if ((globalThis).window?.__omniflowCursor) {
        (globalThis).window.__omniflowCursor.moveTo(cx, cy);
      }
    }, { cx: x, cy: y }).catch(() => null);

    return { x, y, scrolled: bbox?.scrolled ?? false };
  }

  /**
   * Performs smooth cursor glide, triggers click ripple, and invokes native click.
   */
  static async clickWithCursor(page, selectorOrLocator) {
    const coords = await this.glideTo(page, selectorOrLocator);

    if (page && page.window && page.window.__omniflowCursor) {
      page.window.__omniflowCursor.click(coords.x, coords.y);
      if (typeof selectorOrLocator === 'string') {
        const el = page.document?.querySelector(selectorOrLocator);
        if (el && typeof el.click === 'function') el.click();
      } else if (selectorOrLocator && typeof selectorOrLocator.click === 'function') {
        selectorOrLocator.click();
      }
      return coords;
    }

    await page.evaluate(({ cx, cy }) => {
      if ((globalThis).window?.__omniflowCursor) {
        (globalThis).window.__omniflowCursor.click(cx, cy);
      }
    }, { cx: coords.x, cy: coords.y }).catch(() => null);

    // Trigger native click
    if (typeof selectorOrLocator === 'string') {
      const loc = page.locator ? page.locator(selectorOrLocator) : null;
      if (loc && typeof loc.click === 'function') await loc.click().catch(() => null);
      else await page.evaluate((sel) => document.querySelector(sel)?.click(), selectorOrLocator).catch(() => null);
    } else if (selectorOrLocator && typeof selectorOrLocator.click === 'function') {
      await selectorOrLocator.click().catch(() => null);
    }

    return coords;
  }

  /**
   * Glides to element, reveals typing indicator (with password masking), fills text, then hides badge.
   */
  static async fillWithCursor(page, selectorOrLocator, text, isPassword = false) {
    const coords = await this.glideTo(page, selectorOrLocator);

    // Detect password field if selector is string
    let masked = isPassword;
    if (typeof selectorOrLocator === 'string' && (selectorOrLocator.includes('password') || selectorOrLocator.includes('txtPass'))) {
      masked = true;
    }

    if (page && page.window && page.window.__omniflowCursor) {
      page.window.__omniflowCursor.showTyping(text, masked);
      if (typeof selectorOrLocator === 'string') {
        const el = page.document?.querySelector(selectorOrLocator);
        if (el) {
          el.value = text;
          if (typeof el.dispatchEvent === 'function') {
            const MockEvt = (globalThis).Event || Object;
            try { el.dispatchEvent(new MockEvt('input', { bubbles: true })); } catch {}
            try { el.dispatchEvent(new MockEvt('change', { bubbles: true })); } catch {}
          }
        }
      } else if (selectorOrLocator && typeof selectorOrLocator.fill === 'function') {
        selectorOrLocator.fill(text);
      }
      page.window.__omniflowCursor.hideTyping();
      return coords;
    }

    await page.evaluate(({ val, isPw }) => {
      if ((globalThis).window?.__omniflowCursor) {
        (globalThis).window.__omniflowCursor.showTyping(val, isPw);
      }
    }, { val: text, isPw: masked }).catch(() => null);

    // Native fill
    if (typeof selectorOrLocator === 'string') {
      const loc = page.locator ? page.locator(selectorOrLocator) : null;
      if (loc && typeof loc.fill === 'function') await loc.fill(text).catch(() => null);
      else {
        await page.evaluate(({ sel, val }) => {
          const el = document.querySelector(sel);
          if (el) {
            el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, { sel: selectorOrLocator, val: text }).catch(() => null);
      }
    } else if (selectorOrLocator && typeof selectorOrLocator.fill === 'function') {
      await selectorOrLocator.fill(text).catch(() => null);
    }

    // Hide badge
    await page.evaluate(() => {
      if ((globalThis).window?.__omniflowCursor) {
        (globalThis).window.__omniflowCursor.hideTyping();
      }
    }).catch(() => null);

    return coords;
  }

  /**
   * Retrieve state of the in-browser cursor overlay.
   */
  static async getState(page) {
    if (page && page.window && page.window.__omniflowCursor) {
      return page.window.__omniflowCursor.getState();
    }
    return page.evaluate(() => {
      return (globalThis).window?.__omniflowCursor ? (globalThis).window.__omniflowCursor.getState() : null;
    }).catch(() => null);
  }
}
