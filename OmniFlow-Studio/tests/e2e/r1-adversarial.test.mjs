// Adversarial Test Harness — Challenger 2 (Milestone M2)
// Testing SAP SLD Logon Automation under adversarial conditions

import test from 'node:test';
import assert from 'node:assert/strict';
import { SAPAdapter } from '../../packages/sap-adapter/dist/index.js';
import { MockBrowserManager } from './harness/mock-browser-engine.mjs';
import { MockPage } from './harness/mock-page.mjs';
import { createMockSAPSLDDocument, MockDocument, MockWindow, MockEvent } from './harness/mock-dom.mjs';

test.describe('Adversarial & Edge Case Verification — SAP SLD Logon', () => {

  // =========================================================================
  // SCENARIO 1: High-load / Slow Network (Company list retrieval delayed)
  // =========================================================================

  test('ADV-01: Slow network company list settlement with Playwright waitForFunction (3000ms delay)', async () => {
    const { doc, win, selectCompany } = createMockSAPSLDDocument({
      initialCompanyOptions: [],
    });

    const page = new MockPage(doc, win);
    // Playwright standard waitForFunction implementation
    page.waitForFunction = async (predicate, options = {}) => {
      const timeout = options.timeout ?? 10000;
      const startTime = Date.now();
      while (Date.now() - startTime <= timeout) {
        const result = await page.evaluate(predicate);
        if (result) return true;
        // Small async pause
        await new Promise(r => setTimeout(r, 50));
      }
      throw new Error(`waitForFunction timed out after ${timeout}ms`);
    };

    const browser = new MockBrowserManager();
    browser.setPage('SAP', page);

    // Simulate slow network: company list arrives after 3000ms
    setTimeout(() => {
      const opt1 = doc.createElement('option');
      opt1.value = 'BEFORE_IMPORT1';
      opt1.textContent = 'Before Import';
      selectCompany.appendChild(opt1);

      const opt2 = doc.createElement('option');
      opt2.value = 'FM_PRO';
      opt2.textContent = 'Công ty TNHH Thương Mại LARIA (FM_PRO)';
      selectCompany.appendChild(opt2);
    }, 3000);

    const adapter = new SAPAdapter(browser);
    const startTime = Date.now();
    const result = await adapter.login({
      username: 'manager',
      password: 'Password123!',
      company: 'FM_PRO',
    }, undefined, 2);

    const duration = Date.now() - startTime;
    assert.equal(result.success, true);
    assert.equal(result.authState, 'AUTHENTICATED');
    assert.equal(selectCompany.options[selectCompany.selectedIndex].value, 'FM_PRO');
    assert.ok(duration >= 3000, `Expected duration >= 3000ms, got ${duration}ms`);
  });

  // =========================================================================
  // SCENARIO 2: Non-existent company handling and graceful fallback
  // =========================================================================

  test('ADV-02A: Non-existent company does not throw uncaught error and falls back gracefully', async () => {
    const { doc, win, selectCompany } = createMockSAPSLDDocument({
      initialCompanyOptions: [
        { value: 'DEFAULT_COMPANY', text: 'Default SAP Company' },
        { value: 'BRANCH_01', text: 'Branch 01 (BR01)' },
      ],
    });

    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('SAP', page);

    const adapter = new SAPAdapter(browser);
    const result = await adapter.login({
      username: 'admin',
      password: 'Password123!',
      company: 'TOTALLY_NON_EXISTENT_COMPANY_XYZ',
    }, undefined, 2);

    assert.equal(result.success, true);
    assert.equal(result.authState, 'AUTHENTICATED');
    // Fallback: retains initial selectedIndex (default company)
    assert.equal(selectCompany.selectedIndex, 0);
    assert.equal(selectCompany.options[selectCompany.selectedIndex].value, 'DEFAULT_COMPANY');
  });

  test('ADV-02B: Non-existent company with completely empty options does not throw', async () => {
    const { doc, win, selectCompany } = createMockSAPSLDDocument({
      initialCompanyOptions: [],
    });

    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('SAP', page);

    const adapter = new SAPAdapter(browser);
    const result = await adapter.login({
      username: 'admin',
      password: 'Password123!',
      company: 'SOME_COMPANY',
    }, undefined, 1);

    // Should proceed to login attempt without crashing
    assert.equal(result.success, true);
    assert.equal(result.authState, 'AUTHENTICATED');
  });

  test('ADV-02C: Empty string or whitespace company input does not crash', async () => {
    const { doc, win, selectCompany } = createMockSAPSLDDocument({
      initialCompanyOptions: [
        { value: 'COMPANY_1', text: 'Company 1' },
      ],
    });

    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('SAP', page);

    const adapter = new SAPAdapter(browser);
    const result = await adapter.login({
      username: 'admin',
      password: 'Password123!',
      company: '   ',
    }, undefined, 1);

    assert.equal(result.success, true);
    assert.equal(selectCompany.selectedIndex, 0);
  });

  // =========================================================================
  // SCENARIO 3: Immediate fatal auth failure handling (early return)
  // =========================================================================

  test('ADV-03A: Immediate fatal auth failure on invalid password (no 35 retries)', async () => {
    const { doc, win, modalMsg } = createMockSAPSLDDocument({
      initialCompanyOptions: [{ value: 'FM_PRO', text: 'FM_PRO' }],
      triggerConcurrentOnSubmit: true,
      concurrentText: 'Invalid user name or password. Please try again.',
    });

    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('SAP', page);

    const progressLogs = [];
    const adapter = new SAPAdapter(browser);
    const startTime = Date.now();

    const result = await adapter.login({
      username: 'wrong_user',
      password: 'wrong_password',
      company: 'FM_PRO',
    }, (msg) => progressLogs.push(msg), 35); // Max retries set to 35

    const duration = Date.now() - startTime;

    assert.equal(result.success, false);
    assert.equal(result.authState, 'AUTH_FAILED');
    assert.match(result.message, /Invalid user name or password/i);

    // Verify it returned IMMEDIATELY on attempt 1, without executing 35 retry cycles
    const retryLogs = progressLogs.filter(msg => msg.includes('Thử lại lần') || msg.includes('reload lại link'));
    assert.equal(retryLogs.length, 0, 'Must NOT execute retry cycles on fatal auth failure');
    // Ensure duration was short (under 5 seconds, not 35 * retry time)
    assert.ok(duration < 5000, `Expected fast exit under 5000ms, took ${duration}ms`);
  });

  test('ADV-03B: Immediate fatal auth failure on account locked (Vietnamese dialog)', async () => {
    const { doc, win, modalMsg } = createMockSAPSLDDocument({
      initialCompanyOptions: [{ value: 'FM_PRO', text: 'FM_PRO' }],
      triggerConcurrentOnSubmit: true,
      concurrentText: 'Tài khoản người dùng đã bị khoá. Vui lòng liên hệ quản trị viên hệ thống.',
    });

    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('SAP', page);

    const progressLogs = [];
    const adapter = new SAPAdapter(browser);

    const result = await adapter.login({
      username: 'locked_user',
      password: 'any_password',
      company: 'FM_PRO',
    }, (msg) => progressLogs.push(msg), 35);

    assert.equal(result.success, false);
    assert.equal(result.authState, 'AUTH_FAILED');
    assert.match(result.message, /bị khoá/i);

    const retryLogs = progressLogs.filter(msg => msg.includes('Thử lại lần'));
    assert.equal(retryLogs.length, 0, 'Must NOT retry when account is locked');
  });

  test('ADV-03C: Immediate fatal auth failure on authentication failed keyword', async () => {
    const { doc, win, modalMsg } = createMockSAPSLDDocument({
      initialCompanyOptions: [{ value: 'FM_PRO', text: 'FM_PRO' }],
      triggerConcurrentOnSubmit: true,
      concurrentText: 'Logon failed: database connection refused by SAP server.',
    });

    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('SAP', page);

    const adapter = new SAPAdapter(browser);
    const result = await adapter.login({
      username: 'manager',
      password: 'pwd',
      company: 'FM_PRO',
    }, undefined, 35);

    assert.equal(result.success, false);
    assert.equal(result.authState, 'AUTH_FAILED');
    assert.match(result.message, /failed/i);
  });

  // =========================================================================
  // SCENARIO 4: Additional edge cases (normalization, multi-casing, spacing)
  // =========================================================================

  test('ADV-04: Tier 3 Bidirectional matching with partial names and varying casing', async () => {
    const { doc, win, selectCompany } = createMockSAPSLDDocument({
      initialCompanyOptions: [
        { value: 'DEF_DB', text: 'Default' },
        { value: 'FM_PRO_2026', text: 'Cty Thuong Mai Laria HCM (FM_PRO_2026)' },
      ],
    });

    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('SAP', page);

    const adapter = new SAPAdapter(browser);
    // User provides just the schema substring without parenthesis
    const result = await adapter.login({
      username: 'manager',
      password: 'Password123!',
      company: 'fm_pro_2026',
    }, undefined, 2);

    assert.equal(result.success, true);
    assert.equal(selectCompany.options[selectCompany.selectedIndex].value, 'FM_PRO_2026');
  });

  test('ADV-05: Schema extraction disambiguation when common prefix exists', async () => {
    const { doc, win, selectCompany } = createMockSAPSLDDocument({
      initialCompanyOptions: [
        { value: 'FM_PRO_CN1', text: 'Công ty TNHH Thương Mại LARIA Chi Nhánh 1 (FM_PRO_CN1)' },
        { value: 'FM_PRO', text: 'Công ty TNHH Thương Mại LARIA (FM_PRO)' },
      ],
    });

    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('SAP', page);

    const adapter = new SAPAdapter(browser);
    // Target is exactly the main company (FM_PRO), not the branch that appears first
    const result = await adapter.login({
      username: 'manager',
      password: 'Password123!',
      company: 'Công ty TNHH Thương Mại LARIA (FM_PRO)',
    }, undefined, 2);

    assert.equal(result.success, true);
    assert.equal(selectCompany.options[selectCompany.selectedIndex].value, 'FM_PRO');
  });

  test('ADV-06: Repeated input wiping stress test (up to 2 resets before stabilization)', async () => {
    const { doc, win, inputUser, inputPass } = createMockSAPSLDDocument({
      initialCompanyOptions: [{ value: 'FM_PRO', text: 'FM_PRO' }],
    });

    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('SAP', page);

    // Simulate script that resets inputs 2 times
    let wipeCount = 0;
    inputUser.addEventListener('input', () => {
      if (wipeCount < 2 && inputUser.value.length > 0) {
        wipeCount++;
        queueMicrotask(() => {
          inputUser.value = '';
          inputPass.value = '';
        });
      }
    });

    const adapter = new SAPAdapter(browser);
    const result = await adapter.login({
      username: 'admin',
      password: 'Password123!',
      company: 'FM_PRO',
    }, undefined, 2);

    assert.equal(result.success, true);
    assert.equal(inputUser.value, 'admin');
    assert.equal(inputPass.value, 'Password123!');
  });

  test('ADV-07: Error resilience when page.goto throws transient exception', async () => {
    const { doc, win } = createMockSAPSLDDocument({
      initialCompanyOptions: [{ value: 'FM_PRO', text: 'FM_PRO' }],
    });

    const page = new MockPage(doc, win);
    let gotoAttempts = 0;
    const originalGoto = page.goto.bind(page);
    page.goto = async (url, opts) => {
      gotoAttempts++;
      if (gotoAttempts === 1) {
        throw new Error('ERR_CONNECTION_RESET');
      }
      return originalGoto(url, opts);
    };

    const browser = new MockBrowserManager();
    browser.setPage('SAP', page);

    const logs = [];
    const adapter = new SAPAdapter(browser);
    const result = await adapter.login({
      username: 'admin',
      password: 'Password123!',
      company: 'FM_PRO',
    }, (msg) => logs.push(msg), 3);

    // It catches the error on attempt 1 and recovers on attempt 2
    assert.equal(result.success, true);
    assert.equal(result.authState, 'AUTHENTICATED');
    assert.ok(logs.some(m => m.includes('ERR_CONNECTION_RESET') || m.includes('gặp sự cố')));
  });

  test('ADV-08: CheckSession state machine verification', async () => {
    // 1. Login required
    const { doc, win } = createMockSAPSLDDocument({
      initialCompanyOptions: [{ value: 'FM_PRO', text: 'FM_PRO' }],
    });
    const page = new MockPage(doc, win);
    page._url = 'https://172.16.1.210:8100/dispatcher/';
    const browser = new MockBrowserManager();
    browser.setPage('SAP', page);

    const adapter = new SAPAdapter(browser);
    const s1 = await adapter.checkSession();
    assert.equal(s1.authState, 'LOGIN_REQUIRED');

    // 2. Already Authenticated
    const { doc: docAuth, win: winAuth } = createMockSAPSLDDocument({
      alreadyAuthenticated: true,
    });
    const pageAuth = new MockPage(docAuth, winAuth);
    pageAuth._url = 'https://172.16.1.210:8100/dispatcher/';
    browser.setPage('SAP', pageAuth);

    const s2 = await adapter.checkSession();
    assert.equal(s2.authState, 'AUTHENTICATED');
  });

});
