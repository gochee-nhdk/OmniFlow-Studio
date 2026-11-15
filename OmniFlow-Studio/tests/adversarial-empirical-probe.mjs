import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

import { SAPAdapter } from '../packages/sap-adapter/dist/index.js';
import { POSAdapter, setGridFilter } from '../packages/pos-adapter/dist/index.js';
import { SecureStorage, LogRedactor } from '../packages/security/dist/index.js';
import { FMDatabase } from '../packages/database/dist/index.js';

import {
  createMockSAPSLDDocument,
  createMockPOSSalesDocument,
  createMockPOSInventoryDocument,
} from './e2e/harness/mock-dom.mjs';
import { MockPage } from './e2e/harness/mock-page.mjs';
import { MockBrowserManager } from './e2e/harness/mock-browser-engine.mjs';

test.describe('EMPIRICAL ADVERSARIAL VERIFICATION PROBE (R1 - R6)', () => {

  // =========================================================================
  // 1. SAP SLD Logon (R1): Empty Option Hijack & BEFORE_IMPORT1 Fallback Guard
  // =========================================================================

  test('R1 Adversarial Probe 1: Empty option value="" is NOT hijacked by Pass 2 substring matching', async () => {
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

    const adapter = new SAPAdapter(browser, 'https://sap.test/dispatcher/');
    await adapter.login({
      username: 'manager',
      password: 'Password123!',
      company: 'Công ty TNHH Thương Mại LARIA'
    }, undefined, 2);

    const selected = selectCompany.options[selectCompany.selectedIndex];
    assert.equal(selected.value, 'FM_PRO', 'Empty option value="" must NOT be hijacked; FM_PRO must be selected');
    assert.notEqual(selected.value, '', 'Selected value must never be empty placeholder');
  });

  test('R1 Adversarial Probe 2: BEFORE_IMPORT1 fallback is strictly blocked when another company was requested', async () => {
    const { doc, win, selectCompany } = createMockSAPSLDDocument({
      initialCompanyOptions: [
        { value: 'BEFORE_IMPORT1', text: 'Before Import Database (BEFORE_IMPORT1)' },
        { value: 'TEST_DB', text: 'Test DB (TEST_DB)' },
      ],
    });

    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('SAP', page);

    let progressMessages = [];
    const adapter = new SAPAdapter(browser, 'https://sap.test/dispatcher/');
    const result = await adapter.login({
      username: 'manager',
      password: 'Password123!',
      company: 'UNKNOWN_REQUESTED_COMPANY'
    }, (msg) => progressMessages.push(msg), 2);

    // Verify it refused to log into BEFORE_IMPORT1
    const blockedMsg = progressMessages.some(m => m.includes('Tránh đăng nhập nhầm vào BEFORE_IMPORT1'));
    assert.equal(blockedMsg, true, 'Must log warning and block login into BEFORE_IMPORT1');
    assert.equal(result.success, false, 'Login must fail when requested company is missing; never succeed on BEFORE_IMPORT1');
  });

  // =========================================================================
  // 2. POS Date Range & Export (R2-R3): Invariance on Search & Button Disambiguation
  // =========================================================================

  test('R2 Adversarial Probe: Date range does not reset to today on search trigger', async () => {
    const { doc, win, fromInput, toInput, btnSearch } = createMockPOSSalesDocument();
    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('POS', page);

    const adapter = new POSAdapter(browser, 'https://pos.test/');
    await adapter.setDateFilter(page, 'from', '2026-11-01');
    await adapter.setDateFilter(page, 'to', '2026-11-10');

    assert.equal(fromInput.value, '01/11/2026');
    assert.equal(toInput.value, '10/11/2026');

    // Trigger search
    await btnSearch.click();

    // Verify dates remain preserved
    assert.equal(fromInput.value, '01/11/2026', 'From date must not reset to today after search');
    assert.equal(toInput.value, '10/11/2026', 'To date must not reset to today after search');
  });

  test('R3 Adversarial Probe: Square Excel export button is clicked and blue .btn-form-excel is avoided', async () => {
    const { doc, win, btnSquareExport, btnFormExcel } = createMockPOSSalesDocument();
    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('POS', page);

    let clickedButton = null;
    btnSquareExport.addEventListener('click', () => { clickedButton = 'SQUARE_EXCEL'; });
    btnFormExcel.addEventListener('click', () => { clickedButton = 'BLUE_FORM_EXCEL'; });

    // Target the export button using the production primary selector
    const selector = '.dx-datagrid-header-panel .dx-datagrid-export-button, .dx-datagrid-header-panel .dx-button:has(.dx-icon-xlsxfile)';
    const exportBtn = page.locator(selector).first();
    assert.equal(await exportBtn.isVisible(), true);
    await exportBtn.click();

    assert.equal(clickedButton, 'SQUARE_EXCEL', 'Must click square xlsx grid export button');
    assert.notEqual(clickedButton, 'BLUE_FORM_EXCEL', 'Must strictly avoid clicking blue .btn-form-excel');
  });

  // =========================================================================
  // 3. Inventory Search Wait & Retry (R4): 0 Clicks on Populated Grid
  // =========================================================================

  test('R4 Adversarial Probe: 0 search clicks on populated grid after wave wait', async () => {
    const { doc, win, btnSearch } = createMockPOSInventoryDocument({ initialRows: 10 });
    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('POS', page);

    let searchClicks = 0;
    btnSearch.addEventListener('click', () => { searchClicks++; });

    const adapter = new POSAdapter(browser, 'https://pos.test/');
    const isPopulated = await adapter.isGridPopulated(page);
    assert.equal(isPopulated, true, 'Grid must be detected as populated');

    // Execute inventory export flow
    await adapter.downloadInventoryOnhand(page, {
      storeFilter: 'All',
      slocFilter: 'SDC0101',
    });

    assert.equal(searchClicks, 0, 'Must perform exactly 0 search clicks when grid already has data');
  });

  // =========================================================================
  // 4. DevExpress Grid Filter (R5): Mode A and Mode B
  // =========================================================================

  test('R5 Adversarial Probe: DevExpress Grid Filter via Mode A API and Mode B DOM popup', async () => {
    const { doc, win, gridContainer, searchInput } = createMockPOSInventoryDocument({ initialRows: 4 });

    // Add span title child to Sloc td to emulate DevExpress DOM structure
    const thSloc = gridContainer.querySelector('.dx-header-row td');
    const spanTitle = doc.createElement('span');
    spanTitle.className = 'dx-datagrid-text-content';
    spanTitle.textContent = 'Sloc Id';
    thSloc.insertBefore(spanTitle, thSloc.firstChild);

    const page = new MockPage(doc, win);

    // Mode A: API
    const apiSuccess = await setGridFilter(page, 'slocId', 'SDC0101', { mode: 'api' });
    assert.equal(apiSuccess, true, 'Mode A DevExtreme API filter must succeed');

    // Mode B: DOM
    const domSuccess = await setGridFilter(page, 'slocId', 'SDC0101', { mode: 'dom' });
    assert.equal(domSuccess, true, 'Mode B DOM popup filter must succeed');
    assert.equal(searchInput.value, 'SDC0101');
  });

  // =========================================================================
  // 5. Security Hardening (R6): SQLite Audit & Spaced Passwords
  // =========================================================================

  test('R6 Adversarial Probe: Live SQLite audit table scrub and quoted password with spaces', () => {
    const tempDb = join(tmpdir(), `adversarial-probe-${Date.now()}.sqlite`);
    try {
      const db = new FMDatabase(tempDb);

      // 1. Insert credentials object into db.audit()
      db.audit('credentials:test', 'auth_target', {
        account: 'SAP_PRODUCTION',
        password: 'my secret 123',
        authHeader: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLeak',
      });

      // Inspect SQLite raw disk records
      const row = db['db'].prepare('SELECT * FROM audit_logs').get();
      assert.ok(row, 'Audit row must exist in SQLite database');

      assert.equal(row.details.includes('my secret 123'), false, 'Plaintext password must NOT leak in SQLite audit_logs table');
      assert.equal(row.details.includes('eyJhbGci'), false, 'JWT token must NOT leak in SQLite audit_logs table');
      assert.ok(row.details.includes('[REDACTED]'), 'Details must contain [REDACTED]');

      // 2. Test quoted passwords with spaces across various formats
      const testCases = [
        'Connecting with password="my secret 123" to host',
        "Connecting with password='my secret 123' to host",
        'URL: https://user:my%20secret%20123@host:8080/path',
        'Payload: {"user":"admin","password":"my secret 123"}',
        'Params: sbo_password="my secret 123" --verbose',
      ];

      for (const tc of testCases) {
        const redacted = LogRedactor.redact(tc);
        assert.equal(
          redacted.includes('my secret 123'),
          false,
          `Password with spaces leaked in string: "${tc}" -> got: "${redacted}"`
        );
      }

      db.close();
    } finally {
      if (existsSync(tempDb)) {
        try { rmSync(tempDb, { force: true }); } catch {}
      }
    }
  });

});
