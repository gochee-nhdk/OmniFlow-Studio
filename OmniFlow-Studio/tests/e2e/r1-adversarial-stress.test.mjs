// Adversarial Stress & Empirical Verification Test Suite — Requirement R1 (SAP SLD Logon Automation)
// Authored by Challenger 1 (Adversarial Critic)

import test from 'node:test';
import assert from 'node:assert/strict';
import { SAPAdapter } from '../../packages/sap-adapter/dist/index.js';
import { MockBrowserManager } from './harness/mock-browser-engine.mjs';
import { MockPage } from './harness/mock-page.mjs';
import { createMockSAPSLDDocument, MockDocument, MockWindow, MockEvent } from './harness/mock-dom.mjs';

test.describe('R1 Adversarial Empirical Stress: SAP SLD Logon Automation', () => {

  // =========================================================================
  // 1. DYNAMIC ASYNCHRONOUS SETTLING DELAYS
  // =========================================================================

  test('ADV-R1-01: Asynchronous options arrival with 50ms delay', async () => {
    const { doc, win, selectCompany } = createMockSAPSLDDocument({
      initialCompanyOptions: [],
    });

    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('SAP', page);

    setTimeout(() => {
      const opt1 = doc.createElement('option');
      opt1.value = 'BEFORE_IMPORT1';
      opt1.textContent = 'Before Import';
      selectCompany.appendChild(opt1);

      const opt2 = doc.createElement('option');
      opt2.value = 'FM_PRO';
      opt2.textContent = 'Công ty TNHH Thương Mại LARIA (FM_PRO)';
      selectCompany.appendChild(opt2);
    }, 50);

    const adapter = new SAPAdapter(browser);
    const result = await adapter.login({
      username: 'manager',
      password: 'Password123!',
      company: 'FM_PRO',
    }, undefined, 3);

    assert.equal(result.success, true);
    assert.equal(result.authState, 'AUTHENTICATED');
    assert.equal(selectCompany.options[selectCompany.selectedIndex].value, 'FM_PRO');
  });

  test('ADV-R1-02: DB Server options arrival delayed after company select rendered', async () => {
    const { doc, win, selectCompany } = createMockSAPSLDDocument({
      servers: [], // initially 0 DB servers
      initialCompanyOptions: [
        { value: 'BEFORE_IMPORT1', text: 'Before Import' },
        { value: 'FM_PRO', text: 'Công ty TNHH Thương Mại LARIA (FM_PRO)' },
      ],
    });

    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('SAP', page);

    const dbServerSelect = doc.getElementById('sbo_dbserver');

    setTimeout(() => {
      const sOpt = doc.createElement('option');
      sOpt.value = 'SBO@172.16.0.201:30013';
      sOpt.textContent = 'SBO@172.16.0.201:30013';
      dbServerSelect.appendChild(sOpt);
      dbServerSelect.selectedIndex = 0;
    }, 60);

    const adapter = new SAPAdapter(browser);
    const result = await adapter.login({
      username: 'manager',
      password: 'Password123!',
      company: 'FM_PRO',
      server: 'SBO@172.16.0.201:30013',
    }, undefined, 4);

    assert.equal(result.success, true);
    assert.equal(selectCompany.options[selectCompany.selectedIndex].value, 'FM_PRO');
  });

  test('ADV-R1-03: Empty DB Server options — Safe Refresh Guard prevents click & hiding select', async () => {
    const { doc, win, selectCompany } = createMockSAPSLDDocument({
      servers: [], // 0 servers permanently
      initialCompanyOptions: [], // 0 company options permanently
    });

    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('SAP', page);

    const refreshBtn = doc.getElementById('refresh_company');
    let refreshClicked = false;
    refreshBtn.addEventListener('click', () => {
      refreshClicked = true;
    });

    const adapter = new SAPAdapter(browser);
    await adapter.login({
      username: 'manager',
      password: 'Password123!',
      company: 'FM_PRO',
    }, undefined, 1);

    // Refresh button should NOT be clicked when DB server has no selection
    assert.equal(refreshClicked, false, 'Safe Refresh Guard failed: refresh button was clicked when DB server was empty!');
    assert.notEqual(selectCompany.style.display, 'none', '#sbo_company was wrongly hidden');
  });

  // =========================================================================
  // 2. COMPANY STRING MATCHING STRESS (ALL CASINGS & SCHEMAS)
  // =========================================================================

  const companyVariants = [
    {
      name: 'Full Uppercase with schema parens',
      input: 'CÔNG TY TNHH THƯƠNG MẠI LARIA (FM_PRO)',
      expected: 'FM_PRO',
    },
    {
      name: 'Full Lowercase with schema parens',
      input: 'công ty tnhh thương mại laria (fm_pro)',
      expected: 'FM_PRO',
    },
    {
      name: 'Only schema code in parentheses',
      input: '(FM_PRO)',
      expected: 'FM_PRO',
    },
    {
      name: 'Schema code only without parentheses',
      input: 'FM_PRO',
      expected: 'FM_PRO',
    },
    {
      name: 'Lowercase schema code only',
      input: 'fm_pro',
      expected: 'FM_PRO',
    },
    {
      name: 'Whitespace padded schema code',
      input: '   (FM_PRO)   ',
      expected: 'FM_PRO',
    },
  ];

  for (const variant of companyVariants) {
    test(`ADV-R1-04: Company Matching Variant — ${variant.name}`, async () => {
      const { doc, win, selectCompany } = createMockSAPSLDDocument({
        initialCompanyOptions: [
          { value: 'BEFORE_IMPORT1', text: 'Before Import Database (BEFORE_IMPORT1)' },
          { value: 'FM_PRO', text: 'Công ty TNHH Thương Mại LARIA (FM_PRO)' },
          { value: 'SAMPLE_TEST', text: 'Sample Test Database (SAMPLE_TEST)' },
        ],
      });

      const page = new MockPage(doc, win);
      const browser = new MockBrowserManager();
      browser.setPage('SAP', page);

      const adapter = new SAPAdapter(browser);
      const result = await adapter.login({
        username: 'manager',
        password: 'Password123!',
        company: variant.input,
      }, undefined, 2);

      assert.equal(result.success, true);
      const selectedOpt = selectCompany.options[selectCompany.selectedIndex];
      assert.equal(selectedOpt.value, variant.expected, `Expected ${variant.expected} but selected ${selectedOpt.value} for input "${variant.input}"`);
      assert.notEqual(selectedOpt.value, 'BEFORE_IMPORT1', 'Must NEVER select BEFORE_IMPORT1');
    });
  }

  // =========================================================================
  // 3. EMPIRICAL VULNERABILITY REPRODUCTION: PLACEHOLDER OPTION HIJACK
  // =========================================================================

  test('ADV-R1-05 [BUG CONFIRMATION]: Empty placeholder option value="" causes false match in Pass 2', async () => {
    // When an option has value="" (e.g. "-- Chọn Công Ty --"), lowerTarget.includes(val)
    // in Pass 2 evaluates to string.includes(""), which is always true for any string!
    const { doc, win, selectCompany } = createMockSAPSLDDocument({
      initialCompanyOptions: [
        { value: '', text: '-- Chọn Công Ty / Select Company --' },
        { value: 'BEFORE_IMPORT1', text: 'Before Import Database (BEFORE_IMPORT1)' },
        { value: 'FM_PRO', text: 'Công ty TNHH Thương Mại LARIA (FM_PRO)' }
      ],
    });

    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('SAP', page);

    const adapter = new SAPAdapter(browser);
    await adapter.login({
      username: 'manager',
      password: 'Password123!',
      company: 'Công ty TNHH Thương Mại LARIA'
    }, undefined, 2);

    const selected = selectCompany.options[selectCompany.selectedIndex];
    // Verified remediation: selected.value is 'FM_PRO', NOT the empty placeholder ''
    const isBugPresent = (selected.value === '');
    assert.equal(isBugPresent, false, 'Remediated: empty placeholder is not selected');
  });

  // =========================================================================
  // 4. EMPIRICAL VULNERABILITY REPRODUCTION: UNMATCHED COMPANY BEFORE_IMPORT1 FALLBACK
  // =========================================================================

  test('ADV-R1-06 [BUG CONFIRMATION]: Non-existent or un-settled company silently logs into BEFORE_IMPORT1', async () => {
    const { doc, win, selectCompany } = createMockSAPSLDDocument({
      initialCompanyOptions: [
        { value: 'BEFORE_IMPORT1', text: 'Before Import Database (BEFORE_IMPORT1)' },
        { value: 'TEST_DB', text: 'Test DB (TEST_DB)' },
      ],
    });

    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('SAP', page);

    const adapter = new SAPAdapter(browser);
    const result = await adapter.login({
      username: 'manager',
      password: 'Password123!',
      company: 'NON_EXISTENT_COMPANY'
    }, undefined, 2);

    const selected = selectCompany.options[selectCompany.selectedIndex];
    // Demonstrates that adapter logs in anyway and stays on BEFORE_IMPORT1
    assert.equal(selected.value, 'BEFORE_IMPORT1', 'Bug confirmed: non-existent company falls back to BEFORE_IMPORT1 without guard');
  });

  // =========================================================================
  // 5. CREDENTIAL STABILIZATION PROTOCOL (MULTIPLE RAPID RESETS)
  // =========================================================================

  test('ADV-R1-07: Double rapid reset of credentials by simulated showLogonView()', async () => {
    const { doc, win, inputUser, inputPass } = createMockSAPSLDDocument({
      initialCompanyOptions: [{ value: 'FM_PRO', text: 'FM_PRO' }],
    });

    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('SAP', page);

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
      username: 'admin_super',
      password: 'StrongPassword456#',
      company: 'FM_PRO',
    }, undefined, 3);

    assert.equal(result.success, true);
    assert.equal(wipeCount, 2, 'Simulated wipes did not trigger 2 times');
    assert.equal(inputUser.value, 'admin_super');
    assert.equal(inputPass.value, 'StrongPassword456#');
  });

  test('ADV-R1-08: Pre-submit credential assertion verifies fields are not blank', async () => {
    const { doc, win, inputUser, inputPass, btnLogon } = createMockSAPSLDDocument({
      initialCompanyOptions: [{ value: 'FM_PRO', text: 'FM_PRO' }],
    });

    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('SAP', page);

    let submittedUser = null;
    let submittedPass = null;
    btnLogon.addEventListener('click', () => {
      submittedUser = inputUser.value;
      submittedPass = inputPass.value;
    });

    const adapter = new SAPAdapter(browser);
    await adapter.login({
      username: 'operator_1',
      password: 'OpsPassword999!',
      company: 'FM_PRO',
    }, undefined, 2);

    assert.equal(submittedUser, 'operator_1');
    assert.equal(submittedPass, 'OpsPassword999!');
  });

  // =========================================================================
  // 6. MODAL CONFIRMATION & SCOPING
  // =========================================================================

  test('ADV-R1-09: Scoped modal confirmation — decoy buttons outside modal are NOT clicked', async () => {
    const { doc, win, modalMsg, shellHeader } = createMockSAPSLDDocument({
      initialCompanyOptions: [{ value: 'FM_PRO', text: 'FM_PRO' }],
      triggerConcurrentOnSubmit: true,
      concurrentText: 'Another user has already logged in. Do you want to continue?',
    });

    const decoyYesBtn = doc.createElement('button');
    decoyYesBtn.textContent = 'Yes';
    decoyYesBtn.id = 'decoy_yes_btn';
    let decoyClicked = false;
    decoyYesBtn.addEventListener('click', () => { decoyClicked = true; });
    doc.body.appendChild(decoyYesBtn);

    const decoyContinueBtn = doc.createElement('button');
    decoyContinueBtn.textContent = 'Continue';
    decoyContinueBtn.id = 'decoy_continue_btn';
    let decoyContinueClicked = false;
    decoyContinueBtn.addEventListener('click', () => { decoyContinueClicked = true; });
    doc.body.appendChild(decoyContinueBtn);

    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('SAP', page);

    const adapter = new SAPAdapter(browser);
    const result = await adapter.login({
      username: 'manager',
      password: 'Password123!',
      company: 'FM_PRO',
    }, undefined, 2);

    assert.equal(result.success, true);
    assert.equal(result.authState, 'AUTHENTICATED');
    assert.equal(decoyClicked, false, 'Decoy Yes button OUTSIDE modal was clicked!');
    assert.equal(decoyContinueClicked, false, 'Decoy Continue button OUTSIDE modal was clicked!');
    assert.equal(modalMsg.style.display, 'none', 'Modal was not dismissed');
  });

  test('ADV-R1-10: Vietnamese concurrent session warning dialog ("Người dùng khác đã đăng nhập")', async () => {
    const { doc, win, modalMsg, shellHeader } = createMockSAPSLDDocument({
      initialCompanyOptions: [{ value: 'FM_PRO', text: 'FM_PRO' }],
      triggerConcurrentOnSubmit: true,
      concurrentText: 'Người dùng khác đã đăng nhập vào phiên làm việc. Bạn có muốn tiếp tục?',
    });

    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('SAP', page);

    const adapter = new SAPAdapter(browser);
    const result = await adapter.login({
      username: 'manager',
      password: 'Password123!',
      company: 'FM_PRO',
    }, undefined, 2);

    assert.equal(result.success, true);
    assert.equal(result.authState, 'AUTHENTICATED');
    assert.equal(modalMsg.style.display, 'none');
  });

  test('ADV-R1-11: Fatal Auth Failure early exit — terminates on attempt 1 with AUTH_FAILED', async () => {
    const { doc, win } = createMockSAPSLDDocument({
      initialCompanyOptions: [{ value: 'FM_PRO', text: 'FM_PRO' }],
      triggerConcurrentOnSubmit: true,
      concurrentText: 'Mật khẩu không đúng hoặc tài khoản đã bị khoá (locked).',
    });

    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('SAP', page);

    let progressCalls = 0;
    const adapter = new SAPAdapter(browser);
    const result = await adapter.login({
      username: 'wrong_user',
      password: 'wrong_password',
      company: 'FM_PRO',
    }, () => { progressCalls++; }, 25);

    assert.equal(result.success, false);
    assert.equal(result.authState, 'AUTH_FAILED');
    assert.match(result.message, /khoá/i);
    assert.ok(progressCalls < 10, `Expected early exit without 25 retries, but progress calls was ${progressCalls}`);
  });

  test('ADV-R1-12: Real Playwright waitForFunction compatibility', async () => {
    const { doc, win } = createMockSAPSLDDocument({
      initialCompanyOptions: [
        { value: 'FM_PRO', text: 'FM_PRO' },
      ],
    });

    const page = new MockPage(doc, win);
    let waitForFunctionCalled = false;
    page.waitForFunction = async (fn, opts) => {
      waitForFunctionCalled = true;
      return true;
    };

    const browser = new MockBrowserManager();
    browser.setPage('SAP', page);

    const adapter = new SAPAdapter(browser);
    const result = await adapter.login({
      username: 'manager',
      password: 'Password123!',
      company: 'FM_PRO',
    }, undefined, 2);

    assert.equal(result.success, true);
    assert.equal(waitForFunctionCalled, true, 'waitForFunction was not used when available');
  });
});
