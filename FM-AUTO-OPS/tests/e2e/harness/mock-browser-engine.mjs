// FM AUTO OPS — Mock BrowserManager Engine
// Provides isolated, persistent MockPage contexts for 'SAP' and 'POS' profiles.

import { MockPage } from './mock-page.mjs';

export class MockBrowserManager {
  constructor() {
    this._pages = new Map();
  }

  async getPage(profile = 'DEFAULT') {
    if (!this._pages.has(profile)) {
      const page = new MockPage();
      this._pages.set(profile, page);
    }
    return this._pages.get(profile);
  }

  setPage(profile, page) {
    this._pages.set(profile, page);
  }

  hasPage(profile) {
    return this._pages.has(profile);
  }

  async reset() {
    this._pages.clear();
  }

  async close() {
    this._pages.clear();
  }
}
