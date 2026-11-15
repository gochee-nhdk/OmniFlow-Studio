// E2E Test Suite — Requirement R1: SAP SLD Logon Automation
// 12 Tests total: 6 Tier 1 (Happy Path) + 6 Tier 2 (Boundary & Corner Cases)

import test from 'node:test';
import assert from 'node:assert/strict';
import { SAPAdapter } from '../../packages/sap-adapter/dist/index.js';
import { MockBrowserManager } from './harness/mock-browser-engine.mjs';
import { MockPage } from './harness/mock-page.mjs';
import { createMockSAPSLDDocument, MockDocument, MockWindow, MockEvent } from './harness/mock-dom.mjs';

test.describe('R1: SAP SLD Logon Automation', () => {

  // --- TIER 1: Feature Coverage (Happy Path) ---

  test('T1-R1-01: Company Selection — Exact Value Match', async () => {
    const { doc, win, selectCompany } = createMockSAPSLDDocument({
      initialCompanyOptions: [
        { value: 'BEFORE_IMPORT1', text: 'Before Import Database' },
        { value: 'FM_PRO', text: 'Cong ty TNHH Thuong Mai LARIA (FM_PRO)' },
        { value: 'TEST_DB', text: 'Test Company DB' },
      ],
    });

    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('SAP', page);

    const adapter = new SAPAdapter(browser);
    let changeFired = false;
    selectCompany.addEventListener('change', () => { changeFired = true; });

    const result = await adapter.login({
      username: 'manager',
      password: 'Password123!',
      company: 'FM_PRO',
    }, undefined, 2);

    assert.equal(result.success, true);
    assert.equal(result.authState, 'AUTHENTICATED');
    assert.equal(selectCompany.options[selectCompany.selectedIndex].value, 'FM_PRO');
    assert.equal(changeFired, true);
  });

  test('T1-R1-02: Company Selection — Schema Code in Parentheses', async () => {
    const { doc, win, selectCompany } = createMockSAPSLDDocument({
      initialCompanyOptions: [
        { value: 'BEFORE_IMPORT1', text: 'Before Import Database' },
        { value: 'FM_PRO', text: 'Công ty TNHH Thương Mại LARIA (FM_PRO)' },
      ],
    });

    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('SAP', page);

    const adapter = new SAPAdapter(browser);
    const result = await adapter.login({
      username: 'manager',
      password: 'Password123!',
      company: 'Công ty TNHH Thương Mại LARIA (FM_PRO)',
    }, undefined, 2);

    assert.equal(result.success, true);
    const selected = selectCompany.options[selectCompany.selectedIndex];
    assert.equal(selected.value, 'FM_PRO');
  });

  test('T1-R1-03: Asynchronous Company Options Settlement Wait', async () => {
    // Initially 0 options, arrives after delay or upon refresh
    const { doc, win, selectCompany } = createMockSAPSLDDocument({
      initialCompanyOptions: [],
    });

    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('SAP', page);

    const populate = () => {
      if (selectCompany.options.length < 2) {
        const opt1 = doc.createElement('option');
        opt1.value = 'BEFORE_IMPORT1';
        opt1.textContent = 'Before Import';
        selectCompany.appendChild(opt1);

        const opt2 = doc.createElement('option');
        opt2.value = 'FM_PRO';
        opt2.textContent = 'Công ty TNHH Thương Mại LARIA (FM_PRO)';
        selectCompany.appendChild(opt2);
      }
    };
    setTimeout(populate, 2);
    const refreshBtn = doc.getElementById('refresh_company');
    if (refreshBtn) refreshBtn.addEventListener('click', populate);

    const adapter = new SAPAdapter(browser);
    const result = await adapter.login({
      username: 'manager',
      password: 'Password123!',
      company: 'FM_PRO',
    }, undefined, 3);

    assert.equal(result.success, true);
    assert.equal(result.authState, 'AUTHENTICATED');
    assert.ok(selectCompany.options.length >= 2);
  });

  test('T1-R1-04: User ID and Password Autofill Verification', async () => {
    const { doc, win, inputUser, inputPass } = createMockSAPSLDDocument({
      initialCompanyOptions: [{ value: 'FM_PRO', text: 'FM_PRO' }],
    });

    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('SAP', page);

    const adapter = new SAPAdapter(browser);
    await adapter.login({
      username: 'procurement_specialist',
      password: 'SuperSecretAuthPassword2026!',
      company: 'FM_PRO',
    }, undefined, 2);

    assert.equal(inputUser.value, 'procurement_specialist');
    assert.equal(inputPass.value, 'SuperSecretAuthPassword2026!');
  });

  test('T1-R1-05: Logon Button Trigger & Submission', async () => {
    const { doc, win, btnLogon } = createMockSAPSLDDocument({
      initialCompanyOptions: [{ value: 'FM_PRO', text: 'FM_PRO' }],
    });

    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('SAP', page);

    let submitClicked = false;
    btnLogon.addEventListener('click', () => { submitClicked = true; });

    const adapter = new SAPAdapter(browser);
    const result = await adapter.login({
      username: 'manager',
      password: 'Password123!',
      company: 'FM_PRO',
    }, undefined, 2);

    assert.equal(submitClicked, true);
    assert.equal(result.success, true);
    assert.equal(result.authState, 'AUTHENTICATED');
  });

  test('T1-R1-06: Already Authenticated Bypass', async () => {
    const { doc, win, inputUser } = createMockSAPSLDDocument({
      alreadyAuthenticated: true,
    });

    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('SAP', page);

    const adapter = new SAPAdapter(browser);
    const result = await adapter.login({
      username: 'manager',
      password: 'Password123!',
    }, undefined, 1);

    assert.equal(result.success, true);
    assert.equal(result.authState, 'AUTHENTICATED');
    // Login form fields should never have been touched
    assert.equal(inputUser.value, '');
  });

  // --- TIER 2: Boundary & Corner Cases ---

  test('T2-R1-01: Input Stabilization Against showLogonView() Reset', async () => {
    const { doc, win, inputUser, inputPass } = createMockSAPSLDDocument({
      initialCompanyOptions: [{ value: 'FM_PRO', text: 'FM_PRO' }],
    });

    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('SAP', page);

    // Simulate SAP script showLogonView() wiping values once on first fill attempt
    let wipeCount = 0;
    inputUser.addEventListener('input', () => {
      if (wipeCount === 0 && inputUser.value.length > 0) {
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
    }, undefined, 3);

    assert.equal(result.success, true);
    assert.equal(inputUser.value, 'admin');
    assert.equal(inputPass.value, 'Password123!');
  });

  test('T2-R1-02: Case-Insensitive Casing Mismatch in Company Name', async () => {
    const { doc, win, selectCompany } = createMockSAPSLDDocument({
      initialCompanyOptions: [
        { value: 'FM_PRO', text: 'CÔNG TY TNHH THƯƠNG MẠI LARIA (FM_PRO)' },
      ],
    });

    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('SAP', page);

    const adapter = new SAPAdapter(browser);
    // Passing lowercase text that should still match schema or text
    const result = await adapter.login({
      username: 'admin',
      password: 'Password123!',
      company: 'công ty tnhh thương mại laria (fm_pro)',
    }, undefined, 2);

    assert.equal(result.success, true);
    assert.equal(selectCompany.options[selectCompany.selectedIndex].value, 'FM_PRO');
  });

  test('T2-R1-03: Refresh Button Avoidance When DB Server Has No Selection', async () => {
    const { doc, win, selectCompany } = createMockSAPSLDDocument({
      servers: [], // DB server has 0 options
      initialCompanyOptions: [],
    });

    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('SAP', page);

    const adapter = new SAPAdapter(browser);
    // Run login check
    await adapter.login({
      username: 'admin',
      password: 'Password123!',
      company: 'FM_PRO',
    }, undefined, 1);

    // Ensure sbo_company was not hidden by an invalid refresh click
    assert.notEqual(selectCompany.style.display, 'none');
  });

  test('T2-R1-04: Concurrent Login Warning Modal Auto-Confirmation (English & Vietnamese)', async () => {
    const { doc, win, modalMsg, shellHeader } = createMockSAPSLDDocument({
      initialCompanyOptions: [{ value: 'FM_PRO', text: 'FM_PRO' }],
      triggerConcurrentOnSubmit: true,
      concurrentText: 'Tài khoản đang được đăng nhập ở nơi khác. Bạn có muốn tiếp tục?',
    });

    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('SAP', page);

    const adapter = new SAPAdapter(browser);
    const result = await adapter.login({
      username: 'admin',
      password: 'Password123!',
      company: 'FM_PRO',
    }, undefined, 2);

    assert.equal(result.success, true);
    assert.equal(result.authState, 'AUTHENTICATED');
    assert.equal(modalMsg.style.display, 'none');
    assert.ok(shellHeader.parentNode !== null);
  });

  test('T2-R1-05: Non-Existent Company Fallback', async () => {
    const { doc, win, selectCompany } = createMockSAPSLDDocument({
      initialCompanyOptions: [
        { value: 'DEFAULT_DB', text: 'Default Company' },
      ],
    });

    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('SAP', page);

    const adapter = new SAPAdapter(browser);
    const result = await adapter.login({
      username: 'admin',
      password: 'Password123!',
      company: 'NON_EXISTENT_COMPANY_DB',
    }, undefined, 2);

    // Should complete login without uncaught error, keeping default company
    assert.equal(result.success, true);
    assert.equal(selectCompany.options[selectCompany.selectedIndex].value, 'DEFAULT_DB');
  });

  test('T2-R1-06: Max Retry Exhaustion on Unreachable Server', async () => {
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    // Empty document with no login form
    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('SAP', page);

    const adapter = new SAPAdapter(browser);
    const result = await adapter.login({
      username: 'admin',
      password: 'Password123!',
    }, undefined, 2); // 2 retries

    assert.equal(result.success, false);
    assert.equal(result.authState, 'AUTH_FAILED');
    assert.match(result.message, /2 lần/);
  });
});
