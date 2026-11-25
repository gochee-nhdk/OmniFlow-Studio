// FM AUTO OPS — High-Fidelity Playwright Page & Locator Mock Engine
// Accurately simulates Playwright's Page, Locator, and Event interfaces for opaque-box testing.

import { MockDocument, MockWindow, MockEvent, MockCustomEvent } from './mock-dom.mjs';

export class MockDownload {
  constructor(filename = 'report.xlsx', buffer = Buffer.from('MOCK_EXCEL_XLSX_DOWNLOAD_BUFFER_DATA_PAYLOAD_TESTING')) {
    this._filename = filename;
    this._buffer = buffer;
  }

  suggestedFilename() {
    return this._filename;
  }

  async path() {
    return `D:\\FM_AUTO_OPS\\Temp\\${this._filename}`;
  }

  async saveAs(destPath) {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(destPath, this._buffer);
  }
}

export class MockLocator {
  constructor(page, selector, elementsResolver = null) {
    this.page = page;
    this.selector = selector;
    this._elementsResolver = elementsResolver;
  }

  _getElements() {
    if (this._elementsResolver) {
      return this._elementsResolver();
    }
    return this.page.document.querySelectorAll(this.selector);
  }

  async count() {
    return this._getElements().length;
  }

  first() {
    return new MockLocator(this.page, `${this.selector}:first`, () => {
      const els = this._getElements();
      return els.slice(0, 1);
    });
  }

  last() {
    return new MockLocator(this.page, `${this.selector}:last`, () => {
      const els = this._getElements();
      return els.length > 0 ? [els[els.length - 1]] : [];
    });
  }

  nth(index) {
    return new MockLocator(this.page, `${this.selector}:nth(${index})`, () => {
      const els = this._getElements();
      return index >= 0 && index < els.length ? [els[index]] : [];
    });
  }

  async isVisible() {
    const els = this._getElements();
    if (els.length === 0) return false;
    const el = els[0];
    let cur = el;
    while (cur) {
      if (cur.style && (cur.style.display === 'none' || cur.style.visibility === 'hidden')) {
        return false;
      }
      cur = cur.parentNode;
    }
    return true;
  }

  async isEnabled() {
    const els = this._getElements();
    if (els.length === 0) return false;
    return !els[0].disabled;
  }

  async isChecked() {
    const els = this._getElements();
    if (els.length === 0) return false;
    return Boolean(els[0].checked);
  }

  async fill(value) {
    const els = this._getElements();
    if (els.length === 0) {
      throw new Error(`Timeout waiting for locator("${this.selector}") to be filled`);
    }
    const el = els[0];
    if (el.disabled) {
      throw new Error(`Cannot fill disabled element locator("${this.selector}")`);
    }
    let cur = el;
    while (cur) {
      if (cur.style && (cur.style.display === 'none' || cur.style.visibility === 'hidden')) {
        throw new Error(`Cannot fill hidden element locator("${this.selector}")`);
      }
      cur = cur.parentNode;
    }
    el.value = String(value);
    el.dispatchEvent(new MockEvent('input', { bubbles: true }));
    el.dispatchEvent(new MockEvent('change', { bubbles: true }));
  }

  async click(options = {}) {
    const els = this._getElements();
    if (els.length === 0) {
      throw new Error(`Timeout waiting for locator("${this.selector}") to click`);
    }
    const el = els[0];
    el.click();
  }

  async inputValue() {
    const els = this._getElements();
    if (els.length === 0) return '';
    return els[0].value || '';
  }

  async selectOption(values) {
    const els = this._getElements();
    if (els.length === 0) {
      throw new Error(`Timeout waiting for select locator("${this.selector}")`);
    }
    const select = els[0];
    let target = '';
    if (typeof values === 'string') {
      target = values;
    } else if (values && values.value) {
      target = values.value;
    } else if (values && values.label) {
      target = values.label;
    }

    const options = select.options || [];
    let matchedIndex = -1;
    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      if (opt.value === target || opt.textContent === target || opt.textContent.includes(target)) {
        matchedIndex = i;
        break;
      }
    }

    if (matchedIndex === -1) {
      throw new Error(`selectOption failed: option "${target}" not found in select locator("${this.selector}")`);
    }

    select.selectedIndex = matchedIndex;
    select.value = options[matchedIndex].value;
    select.dispatchEvent(new MockEvent('change', { bubbles: true }));
  }

  async waitFor(options = {}) {
    const state = options.state || 'visible';
    const timeout = options.timeout ?? 30000;
    const startTime = Date.now();

    while (Date.now() - startTime <= timeout) {
      const visible = await this.isVisible();
      if (state === 'visible' && visible) return;
      if (state === 'hidden' && !visible) return;
      if (state === 'attached' && this._getElements().length > 0) return;
      if (state === 'detached' && this._getElements().length === 0) return;
      await this.page.waitForTimeout(50);
    }
    throw new Error(`Timeout ${timeout}ms waiting for locator("${this.selector}") state "${state}"`);
  }

  filter(options = {}) {
    return new MockLocator(this.page, `${this.selector}:filter`, () => {
      const els = this._getElements();
      return els.filter(el => {
        if (options.hasText) {
          const text = el.textContent || '';
          if (options.hasText instanceof RegExp) {
            if (!options.hasText.test(text)) return false;
          } else if (!text.toLowerCase().includes(String(options.hasText).toLowerCase())) {
            return false;
          }
        }
        if (options.has) {
          // options.has is another locator or selector
          if (typeof options.has === 'string') {
            if (!el.querySelector(options.has)) return false;
          }
        }
        return true;
      });
    });
  }

  locator(subSelector) {
    return new MockLocator(this.page, `${this.selector} ${subSelector}`, () => {
      const parents = this._getElements();
      const results = [];
      for (const p of parents) {
        const found = p.querySelectorAll(subSelector);
        results.push(...found);
      }
      return results;
    });
  }

  async press(key) {
    const els = this._getElements();
    if (els.length > 0) {
      els[0].dispatchEvent(new MockCustomEvent('keydown', { bubbles: true, detail: { key } }));
      els[0].dispatchEvent(new MockCustomEvent('keyup', { bubbles: true, detail: { key } }));
    }
  }
}

export class MockPage {
  constructor(document = null, window = null) {
    this.document = document || new MockDocument();
    this.window = window || new MockWindow(this.document);
    this.document.window = this.window;
    this._url = 'about:blank';
    this.eventListeners = new Map();
    this.navigationHooks = [];
    this.mockResponses = [];

    // Keyboard mock
    this.keyboard = {
      press: async (key) => {
        // Find focused or active element
        const active = this.document.querySelector(':focus') || this.document.body;
        active.dispatchEvent(new MockCustomEvent('keydown', { bubbles: true, detail: { key } }));
        if (key === 'Enter') {
          active.dispatchEvent(new MockEvent('change', { bubbles: true }));
        }
      },
      type: async (text, options = {}) => {
        const active = this.document.querySelector(':focus') || this.document.body;
        if (active.tagName === 'INPUT') {
          active.value += text;
          active.dispatchEvent(new MockEvent('input', { bubbles: true }));
        }
      },
    };
  }

  url() {
    return this._url;
  }

  async goto(targetUrl, options = {}) {
    this._url = targetUrl;
    this.window.location.href = targetUrl;
    for (const hook of this.navigationHooks) {
      await hook(targetUrl, this);
    }
    return null;
  }

  locator(selector) {
    return new MockLocator(this, selector);
  }

  async waitForSelector(selector, options = {}) {
    const rawTimeout = options.timeout ?? 30000;
    const timeout = Math.min(rawTimeout, 150);
    const state = options.state || 'visible';
    const startTime = Date.now();

    while (Date.now() - startTime <= timeout) {
      const loc = this.locator(selector);
      const count = await loc.count();
      const visible = await loc.isVisible();

      if (state === 'visible' && count > 0 && visible) {
        return loc.first();
      }
      if (state === 'attached' && count > 0) {
        return loc.first();
      }
      if (state === 'hidden' && (!count || !visible)) {
        return null;
      }
      if (state === 'detached' && count === 0) {
        return null;
      }
      await this.waitForTimeout(50);
    }
    throw new Error(`waitForSelector timeout ${timeout}ms for "${selector}"`);
  }

  async waitForTimeout(ms) {
    this._simulatedTimeout = (this._simulatedTimeout || 0) + ms;
    if (this.unclampedTimeouts) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }
    // Accelerate large timeouts (>= 500ms) to 5ms for rapid testing, while allowing micro-timers to settle on smaller delays
    const effectiveDelay = (ms >= 500) ? 5 : Math.min(ms, 100);
    return new Promise(resolve => setTimeout(resolve, effectiveDelay));
  }

  async waitForResponse(predicate, options = {}) {
    for (const resp of this.mockResponses) {
      if (typeof predicate === 'function' && predicate(resp)) {
        return resp;
      }
      if (typeof predicate === 'string' && resp.url().includes(predicate)) {
        return resp;
      }
    }

    const rawTimeout = options.timeout ?? 30000;
    const timeout = Math.min(rawTimeout, 200);
    return new Promise((resolve, reject) => {
      let timer = null;
      const handler = (resp) => {
        const matches = (typeof predicate === 'function' && predicate(resp)) ||
                        (typeof predicate === 'string' && resp.url().includes(predicate));
        if (matches) {
          if (timer) clearTimeout(timer);
          this.removeListener('response', handler);
          resolve(resp);
        }
      };
      this.on('response', handler);
      timer = setTimeout(() => {
        this.removeListener('response', handler);
        reject(new Error(`waitForResponse timed out after ${timeout}ms for predicate`));
      }, timeout);
    });
  }

  setMockDownload(filename, buffer) {
    this._mockDownload = new MockDownload(filename, buffer);
    return this._mockDownload;
  }

  async waitForEvent(eventName, options = {}) {
    if (eventName === 'download' && this._mockDownload) {
      return this._mockDownload;
    }
    const rawTimeout = options.timeout ?? 30000;
    const timeout = Math.min(rawTimeout, 200);
    return new Promise((resolve, reject) => {
      let timer = null;
      const handler = (arg) => {
        if (timer) clearTimeout(timer);
        resolve(arg instanceof MockDownload ? arg : (arg || new MockDownload()));
      };
      this.once(eventName, handler);
      timer = setTimeout(() => {
        this.removeListener(eventName, handler);
        reject(new Error(`waitForEvent("${eventName}") timed out after ${timeout}ms`));
      }, timeout);
    });
  }

  async evaluate(fn, ...args) {
    const sandbox = {
      window: this.window,
      document: this.document,
      globalThis: this.window,
      URL: this.window.URL,
      Blob: this.window.Blob,
      FileReader: this.window.FileReader,
      Event: MockEvent,
      CustomEvent: MockCustomEvent,
      format: (d, f) => {
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        return `${dd}/${mm}/${d.getFullYear()}`;
      },
    };

    if (typeof fn === 'function') {
      const boundFn = fn.bind(sandbox.window);
      // Run with global scope context
      const prevWindow = globalThis.window;
      const prevDoc = globalThis.document;
      const prevEvent = globalThis.Event;
      try {
        globalThis.window = this.window;
        globalThis.document = this.document;
        globalThis.Event = MockEvent;
        return await boundFn(...args);
      } finally {
        globalThis.window = prevWindow;
        globalThis.document = prevDoc;
        globalThis.Event = prevEvent;
      }
    } else if (typeof fn === 'string') {
      const prevWindow = globalThis.window;
      const prevDoc = globalThis.document;
      const prevEvent = globalThis.Event;
      try {
        globalThis.window = this.window;
        globalThis.document = this.document;
        globalThis.Event = MockEvent;
        const evalFn = new Function('window', 'document', `with(window) { return (${fn}); }`);
        return evalFn(this.window, this.document);
      } finally {
        globalThis.window = prevWindow;
        globalThis.document = prevDoc;
        globalThis.Event = prevEvent;
      }
    }
  }

  async fill(selector, text) {
    const loc = this.locator(selector).first();
    await loc.fill(text);
  }

  async click(selector, options = {}) {
    const loc = this.locator(selector).first();
    await loc.click(options);
  }

  on(event, handler) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event).push(handler);
  }

  once(event, handler) {
    const wrapper = (...args) => {
      this.removeListener(event, wrapper);
      handler(...args);
    };
    this.on(event, wrapper);
  }

  removeListener(event, handler) {
    const list = this.eventListeners.get(event);
    if (list) {
      const idx = list.indexOf(handler);
      if (idx !== -1) list.splice(idx, 1);
    }
  }

  emit(event, ...args) {
    const list = this.eventListeners.get(event) || [];
    for (const h of list) {
      h(...args);
    }
  }
}
