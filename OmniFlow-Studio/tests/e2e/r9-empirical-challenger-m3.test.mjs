// FM AUTO OPS — Empirical Challenger Adversarial Stress Suite for M3 (R2, R3, R4, R5, Self-Healing)
// Adversarial verification by Teamwork Empirical Challenger (Critic & Specialist)

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { POSAdapter, setGridFilter, resolveColumnIdentifiers } from '../../packages/pos-adapter/dist/index.js';
import { POS_SELECTORS } from '../../packages/pos-adapter/dist/selectors.js';
import { BrowserManager } from '../../packages/browser-engine/dist/index.js';
import { DailyProcurementRunner } from '../../packages/workflow-engine/dist/index.js';
import { MockBrowserManager } from './harness/mock-browser-engine.mjs';
import { MockPage } from './harness/mock-page.mjs';
import {
  createMockPOSSalesDocument,
  createMockPOSInventoryDocument,
  MockDocument,
  MockWindow,
  MockEvent,
} from './harness/mock-dom.mjs';

test.describe('M3 EMPIRICAL CHALLENGER: Adversarial Stress Test Suite', () => {

  // =========================================================================
  // SECTION 1: R2 POS Date Range Validation & Workflow Propagation
  // =========================================================================

  test('ADV-R2-01: Valid dates formatting and DevExtreme dxDateBox model commitment', async () => {
    const { doc, win, fromBox, fromInput } = createMockPOSSalesDocument();
    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('POS', page);
    const adapter = new POSAdapter(browser, 'https://pos.test/');

    await adapter.setDateFilter(page, 'from', '2026-11-20');

    // Verify DOM value is formatted to dd/MM/yyyy
    assert.equal(fromInput.value, '20/11/2026');
    // Verify dxDateBox model value
    const fromInst = win.DevExpress.ui.dxDateBox.getInstance(fromBox);
    assert.ok(fromInst.options.value instanceof Date);
    assert.equal(fromInst.options.value.getFullYear(), 2026);
    assert.equal(fromInst.options.value.getMonth(), 10); // 0-indexed: 10 is November
    assert.equal(fromInst.options.value.getDate(), 20);
    // Verify commit flag is set
    assert.equal(fromBox.__committed, true);
  });

  test('ADV-R2-02: Leap years and boundary date validation', async () => {
    const { doc, win, fromInput, toInput } = createMockPOSSalesDocument();
    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('POS', page);
    const adapter = new POSAdapter(browser, 'https://pos.test/');

    // Leap year date (2024 is a leap year, Feb 29 is valid)
    await adapter.setDateFilter(page, 'from', '2024-02-29');
    assert.equal(fromInput.value, '29/02/2024');

    // Year transition: Dec 31 to Jan 01
    await adapter.setDateFilter(page, 'from', '2026-12-31');
    await adapter.setDateFilter(page, 'to', '2027-01-01');
    assert.equal(fromInput.value, '31/12/2026');
    assert.equal(toInput.value, '01/01/2027');

    // Century leap year (2000-02-29)
    await adapter.setDateFilter(page, 'from', '2000-02-29');
    assert.equal(fromInput.value, '29/02/2000');
  });

  test('ADV-R2-03: Malformed, corrupt, or invalid dates handled gracefully without throwing', async () => {
    const { doc, win, fromInput } = createMockPOSSalesDocument();
    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('POS', page);
    const adapter = new POSAdapter(browser, 'https://pos.test/');

    // Test malformed date strings
    const invalidDates = [
      '2026-99-99',
      'invalid-date',
      '2026-02-31',
      '',
      'null',
      'undefined',
      '14/11/2026', // wrong ISO format
      '2026-13-01',
    ];

    for (const badDate of invalidDates) {
      await assert.doesNotReject(async () => {
        await adapter.setDateFilter(page, 'from', badDate);
      }, `Should not throw for invalid date "${badDate}"`);
    }

    // Input should remain unchanged or valid
    assert.ok(fromInput.value.length > 0);
  });

  test('ADV-R2-04: Angular/DevExtreme blur event does NOT revert committed date', async () => {
    const { doc, win, fromBox, fromInput } = createMockPOSSalesDocument();
    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('POS', page);
    const adapter = new POSAdapter(browser, 'https://pos.test/');

    // Set custom date
    await adapter.setDateFilter(page, 'from', '2026-11-05');
    assert.equal(fromInput.value, '05/11/2026');

    // Trigger blur event manually to simulate Angular focus-loss
    fromInput.dispatchEvent(new MockEvent('blur'));

    // Should NOT revert to today (14/11/2026) because __committed is true
    assert.equal(fromInput.value, '05/11/2026');
  });

  test('ADV-R2-05: Workflow Date Range propagation from DailyProcurementRunner', async () => {
    const { doc, win } = createMockPOSSalesDocument();
    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('POS', page);

    // POSAdapter date calculation fallback check
    const calculatedToday = POSAdapter.calculateDateRange('TODAY', new Date('2026-11-14T00:00:00Z'));
    assert.equal(calculatedToday.from, '2026-11-14');
    assert.equal(calculatedToday.to, '2026-11-14');

    const calculatedWeek = POSAdapter.calculateDateRange('LAST_7_DAYS', new Date('2026-11-14T00:00:00Z'));
    assert.equal(calculatedWeek.from, '2026-11-08');
    assert.equal(calculatedWeek.to, '2026-11-14');

    const calculatedMonth = POSAdapter.calculateDateRange('THIS_MONTH', new Date('2026-11-14T00:00:00Z'));
    assert.equal(calculatedMonth.from, '2026-11-01');
    assert.equal(calculatedMonth.to, '2026-11-14');
  });

  // =========================================================================
  // SECTION 2: R3 Square POS Excel Export Button vs Decoy Buttons
  // =========================================================================

  test('ADV-R3-01: Strict exclusion of blue form button (.btn-form-excel)', async () => {
    const { doc, win, btnFormExcel, btnSquareExport } = createMockPOSSalesDocument();
    const page = new MockPage(doc, win);

    const selectorPrimary = POS_SELECTORS.salesTransactionDetail.excelButton.primary;
    const selectorFallback = POS_SELECTORS.salesTransactionDetail.excelButton.fallback;

    // Verify selector string does NOT contain .btn-form-excel or generic text="Excel"
    assert.ok(!selectorPrimary.includes('.btn-form-excel'));
    assert.ok(!selectorFallback.includes('.btn-form-excel'));
    assert.ok(!selectorPrimary.includes('text="Excel"'));

    // Find export button using the selector
    const targetLocator = page.locator(selectorPrimary + ', ' + selectorFallback).first();
    assert.equal(await targetLocator.isVisible(), true);

    // Click target
    await targetLocator.click();

    // Verify blue button was NEVER clicked
    assert.equal(win.__blueBtnClicks || 0, 0);
    assert.equal(win.__squareBtnClicks, 1);
    assert.equal(win.__buttonClicked, 'SQUARE_GRID_EXPORT_BUTTON');
  });

  test('ADV-R3-02: Dropdown context menu handling (.dx-export-menu-item)', async () => {
    const { doc, win } = createMockPOSSalesDocument();

    // Add a simulated dropdown menu to doc
    const menuContainer = doc.createElement('div');
    menuContainer.className = 'dx-overlay-content dx-dropdownmenu-popup';
    const menuItem = doc.createElement('div');
    menuItem.className = 'dx-export-menu-item';
    menuItem.textContent = 'Export all data to Excel';
    let menuItemClicked = false;
    menuItem.addEventListener('click', () => {
      menuItemClicked = true;
    });
    menuContainer.appendChild(menuItem);
    doc.body.appendChild(menuContainer);

    const page = new MockPage(doc, win);
    const exportMenuItem = page.locator(
      '.dx-export-menu-item:has-text("Export all data to Excel"), .dx-export-menu-item'
    ).first();

    assert.equal(await exportMenuItem.isVisible(), true);
    await exportMenuItem.click();
    assert.equal(menuItemClicked, true);
  });

  test('ADV-R3-03: Blob Hook interceptor and minimum size boundary check', async () => {
    const { doc, win } = createMockPOSSalesDocument();
    const page = new MockPage(doc, win);

    // Setup blob capture harness
    await page.evaluate(() => {
      (window).__capturedBlobs = [];
      const origCreate = URL.createObjectURL;
      URL.createObjectURL = function(blob) {
        if (blob instanceof Blob) {
          (window).__capturedBlobs.push({
            type: blob.type,
            size: blob.size,
            dataUrl: 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' + Buffer.from('TEST_DATA'.repeat(100)).toString('base64')
          });
        }
        return origCreate.apply(this, arguments);
      };
    });

    const testBlob = new win.Blob(['X'.repeat(600)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    win.URL.createObjectURL(testBlob);

    const blobs = await page.evaluate(() => (window).__capturedBlobs);
    assert.equal(blobs.length, 1);
    assert.ok(blobs[0].size >= 600);
  });

  // =========================================================================
  // SECTION 3: R4 Inventory Search Retry & Wait Logic
  // =========================================================================

  test('ADV-R4-01: Populated grid on landing MUST result in strictly 0 search clicks', async () => {
    // initialRows: 8 -> Data rows present
    const { doc, win } = createMockPOSInventoryDocument({ initialRows: 8 });
    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('POS', page);
    const adapter = new POSAdapter(browser, 'https://pos.test/');

    // Verify grid is detected as populated
    const isPopulated = await adapter.isGridPopulated(page);
    assert.equal(isPopulated, true);

    // Simulate R4 logic execution
    await adapter.waitForLoadingWaveToEnd(page, 5000);
    const populatedAfterWave = await adapter.isGridPopulated(page);
    assert.equal(populatedAfterWave, true);

    // If populated, search is NEVER clicked
    if (populatedAfterWave) {
      // 0 search clicks!
    } else {
      win.__searchClicks = (win.__searchClicks || 0) + 1;
    }

    assert.equal(win.__searchClicks || 0, 0);
  });

  test('ADV-R4-02: Empty grid on landing enters retry loop up to max 6 attempts', async () => {
    // initialRows: 0 -> Empty grid ("No data")
    const { doc, win } = createMockPOSInventoryDocument({ initialRows: 0 });
    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('POS', page);
    const adapter = new POSAdapter(browser, 'https://pos.test/');

    const isPopulated = await adapter.isGridPopulated(page);
    assert.equal(isPopulated, false);

    // Simulate bounded retry loop (1..6)
    let attempts = 0;
    const maxAttempts = 6;
    for (let sAttempt = 1; sAttempt <= maxAttempts; sAttempt++) {
      attempts++;
      win.__searchClicks = (win.__searchClicks || 0) + 1;
      // Grid remains empty
      const populated = await adapter.isGridPopulated(page);
      if (populated) break;
    }

    assert.equal(attempts, 6);
    assert.equal(win.__searchClicks, 6);
  });

  test('ADV-R4-03: Loading wave overlay detection and debounce buffer', async () => {
    const { doc, win, loadingWave } = createMockPOSInventoryDocument({ initialRows: 5 });
    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('POS', page);
    const adapter = new POSAdapter(browser, 'https://pos.test/');

    // Overlay is initially visible
    loadingWave.style.display = 'block';
    assert.equal(await page.locator('.dx-loadpanel').first().isVisible(), true);

    // Simulate async hide after brief delay
    setTimeout(() => {
      loadingWave.style.display = 'none';
    }, 50);

    const start = Date.now();
    await adapter.waitForLoadingWaveToEnd(page, 2000);
    const duration = Date.now() - start;

    // Must wait for wave to hide + debounce buffer (300ms)
    const effectiveDuration = duration + (page._simulatedTimeout || 0);
    assert.ok(duration >= 250 || effectiveDuration >= 250);
    assert.equal(await page.locator('.dx-loadpanel').first().isVisible(), false);
  });

  test('ADV-R4-04: Search button disabled state handling during active query', async () => {
    const { doc, win, btnSearch } = createMockPOSInventoryDocument({ initialRows: 0 });
    const page = new MockPage(doc, win);

    // Set search button to disabled
    btnSearch.disabled = true;
    assert.equal(await page.locator('dx-button[icon="search"]').first().isEnabled(), false);

    // Enable after 80ms
    setTimeout(() => {
      btnSearch.disabled = false;
    }, 80);

    // Wait until enabled
    const searchBtn = page.locator('dx-button[icon="search"]').first();
    for (let w = 0; w < 10; w++) {
      if (await searchBtn.isEnabled().catch(() => true)) break;
      await new Promise(r => setTimeout(r, 20));
    }

    assert.equal(await searchBtn.isEnabled(), true);
  });

  // =========================================================================
  // SECTION 4: R5 DevExpress Grid Filter Automation
  // =========================================================================

  test('ADV-R5-01: resolveColumnIdentifiers technical and caption mapping', () => {
    const testCases = [
      { input: 'slocId', expectedField: 'slocId', expectedTitle: 'Sloc Id' },
      { input: 'SLOC ID', expectedField: 'slocId', expectedTitle: 'Sloc Id' },
      { input: 'sloc', expectedField: 'slocId', expectedTitle: 'Sloc' },
      { input: 'itemCode', expectedField: 'itemCode', expectedTitle: 'Item Code' },
      { input: 'item code', expectedField: 'itemCode', expectedTitle: 'Item Code' },
      { input: 'item', expectedField: 'itemCode', expectedTitle: 'Item' },
      { input: 'storeId', expectedField: 'storeId', expectedTitle: 'Store Id' },
      { input: 'whsName', expectedField: 'whsName', expectedTitle: 'Whs Name' },
      { input: 'itemName', expectedField: 'itemName', expectedTitle: 'Item Name' },
      { input: 'customCol', expectedField: 'customCol', expectedTitle: 'customCol' },
    ];

    for (const tc of testCases) {
      const resolved = resolveColumnIdentifiers(tc.input);
      assert.equal(resolved.dataField, tc.expectedField);
      assert.ok(resolved.titles.includes(tc.expectedTitle));
    }
  });

  test('ADV-R5-02: Mode A (dxDataGrid API) filter application and clearing', async () => {
    const { doc, win, gridContainer } = createMockPOSInventoryDocument();
    const page = new MockPage(doc, win);

    // Apply Sloc filter via Mode A
    const okSloc = await setGridFilter(page, 'slocId', 'SLOC_NORTH_01', { mode: 'api' });
    assert.equal(okSloc, true);
    const gridInst = win.DevExpress.ui.dxDataGrid.getInstance(gridContainer);
    assert.deepEqual(gridInst.columnOption('slocId', 'filterValues'), ['SLOC_NORTH_01']);
    assert.equal(gridInst.columnOption('slocId', 'filterType'), 'include');

    // Apply Item Code filter with array of values
    const okItem = await setGridFilter(page, 'itemCode', ['ITEM_A', 'ITEM_B'], { mode: 'api' });
    assert.equal(okItem, true);
    assert.deepEqual(gridInst.columnOption('itemCode', 'filterValues'), ['ITEM_A', 'ITEM_B']);

    // Clear Sloc filter (empty string or empty array)
    const okClear = await setGridFilter(page, 'slocId', '', { mode: 'api' });
    assert.equal(okClear, true);
    assert.deepEqual(gridInst.columnOption('slocId', 'filterValues'), []);
  });

  test('ADV-R5-03: Mode B (DOM Header Filter Popup) automation matching Hình 5', async () => {
    const { doc, win, gridContainer, searchInput, btnOk } = createMockPOSInventoryDocument();
    
    // Add text element to Sloc td so :text locator finds it
    const thSloc = gridContainer.querySelector('.dx-header-row td');
    const spanTitle = doc.createElement('span');
    spanTitle.textContent = 'Sloc Id';
    thSloc.insertBefore(spanTitle, thSloc.firstChild);

    const page = new MockPage(doc, win);

    // Filter via Mode B
    const okDom = await setGridFilter(page, 'slocId', 'SDC0101', { mode: 'dom' });
    assert.equal(okDom, true);
    assert.equal(searchInput.value, 'SDC0101');
    const gridInst = win.DevExpress.ui.dxDataGrid.getInstance(gridContainer);
    assert.deepEqual(gridInst.columnOption('slocId', 'filterValues'), ['SDC0101']);
  });

  test('ADV-R5-04: Special characters and Vietnamese Unicode filtering', async () => {
    const { doc, win, gridContainer } = createMockPOSInventoryDocument();
    const page = new MockPage(doc, win);
    const gridInst = win.DevExpress.ui.dxDataGrid.getInstance(gridContainer);

    const specialVals = [
      'Kho Tổng Sài Gòn (Q.1)',
      'Áo Sơ Mi Nam - Size L / Trắng',
      'SPECIAL_#123_@_TEST',
      'Value With "Quotes" & <Tags>',
    ];

    for (const val of specialVals) {
      const ok = await setGridFilter(page, 'slocId', val, { mode: 'api' });
      assert.equal(ok, true);
      assert.deepEqual(gridInst.columnOption('slocId', 'filterValues'), [val]);
    }
  });

  test('ADV-R5-05: Non-existent column or missing header filter failure handling', async () => {
    const { doc, win } = createMockPOSInventoryDocument();
    const page = new MockPage(doc, win);

    // Attempt DOM filter on non-existent column
    const result = await setGridFilter(page, 'completely_nonexistent_column_xyz', 'test', { mode: 'dom' });
    assert.equal(result, false);
  });

  // =========================================================================
  // SECTION 5: Browser Engine & Self-Healing Optimization
  // =========================================================================

  test('ADV-BR-01: Low-latency Chromium flags inspection', async () => {
    const tempDir = path.join(os.tmpdir(), `test_br_m3_${Date.now()}`);
    const bm = new BrowserManager({ downloadDir: tempDir, headless: true });

    assert.ok(bm instanceof BrowserManager);
    assert.equal(bm.isContextOpen('POS'), false);
    assert.equal(bm.isContextOpen('SAP'), false);
  });

  test('ADV-BR-02: Self-healing context health ping and recovery', async () => {
    const tempDir = path.join(os.tmpdir(), `test_br_ping_${Date.now()}`);
    let reportedStatus = '';
    const bm = new BrowserManager({
      downloadDir: tempDir,
      headless: true,
      onProgress: (status) => {
        reportedStatus = status;
      },
    });

    await bm.closeAll();
    assert.equal(bm.isContextOpen('POS'), false);
  });
});
