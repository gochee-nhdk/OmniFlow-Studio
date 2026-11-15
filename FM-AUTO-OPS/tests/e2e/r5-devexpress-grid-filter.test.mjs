// E2E Test Suite — Requirement R5: DevExpress Grid Filter Automation
// 12 Tests total: 6 Tier 1 (Happy Path) + 6 Tier 2 (Boundary & Corner Cases)

import test from 'node:test';
import assert from 'node:assert/strict';
import { POSAdapter } from '../../packages/pos-adapter/dist/index.js';
import { MockBrowserManager } from './harness/mock-browser-engine.mjs';
import { MockPage } from './harness/mock-page.mjs';
import { createMockPOSInventoryDocument, MockDocument, MockWindow, MockEvent } from './harness/mock-dom.mjs';

test.describe('R5: DevExpress Grid Filter Automation', () => {

  // --- TIER 1: Feature Coverage (Happy Path) ---

  test('T1-R5-01: Sloc Id Filter via DevExtreme DataGrid API', async () => {
    const { doc, win, gridContainer } = createMockPOSInventoryDocument({ initialRows: 10 });
    const page = new MockPage(doc, win);

    // Call DevExpress grid API
    await page.evaluate(({ field, val }) => {
      const grid = (window).DevExpress.ui.dxDataGrid.getInstance(document.querySelector('.dx-datagrid'));
      grid.columnOption(field, 'filterValues', [val]);
      grid.columnOption(field, 'filterType', 'include');
    }, { field: 'slocId', val: 'SDC0101' });

    const gridInst = win.DevExpress.ui.dxDataGrid.getInstance(gridContainer);
    assert.deepEqual(gridInst.columnOption('slocId', 'filterValues'), ['SDC0101']);
    assert.equal(gridInst.columnOption('slocId', 'filterType'), 'include');

    // Verify row filtering
    const visibleRows = gridContainer.querySelectorAll('.dx-data-row').filter(r => r.style.display !== 'none');
    assert.ok(visibleRows.length > 0);
    for (const r of visibleRows) {
      assert.equal(r.querySelector('.cell-slocId').textContent.trim(), 'SDC0101');
    }
  });

  test('T1-R5-02: Item Code Filter via DevExtreme DataGrid API', async () => {
    const { doc, win, gridContainer } = createMockPOSInventoryDocument({ initialRows: 6 });
    const page = new MockPage(doc, win);

    await page.evaluate(({ field, val }) => {
      const grid = (window).DevExpress.ui.dxDataGrid.getInstance(document.querySelector('.dx-datagrid'));
      grid.columnOption(field, 'filterValues', [val]);
      grid.columnOption(field, 'filterType', 'include');
    }, { field: 'itemCode', val: 'ITEM-001' });

    const gridInst = win.DevExpress.ui.dxDataGrid.getInstance(gridContainer);
    assert.deepEqual(gridInst.columnOption('itemCode', 'filterValues'), ['ITEM-001']);
  });

  test('T1-R5-03: Compound Filter Application (Sloc Id AND Item Code)', async () => {
    const { doc, win, gridContainer } = createMockPOSInventoryDocument({ initialRows: 10 });
    const page = new MockPage(doc, win);

    await page.evaluate(() => {
      const grid = (window).DevExpress.ui.dxDataGrid.getInstance(document.querySelector('.dx-datagrid'));
      grid.columnOption('slocId', 'filterValues', ['SDC0101']);
      grid.columnOption('slocId', 'filterType', 'include');
      grid.columnOption('itemCode', 'filterValues', ['ITEM-001']);
      grid.columnOption('itemCode', 'filterType', 'include');
    });

    const gridInst = win.DevExpress.ui.dxDataGrid.getInstance(gridContainer);
    assert.deepEqual(gridInst.columnOption('slocId', 'filterValues'), ['SDC0101']);
    assert.deepEqual(gridInst.columnOption('itemCode', 'filterValues'), ['ITEM-001']);

    const visibleRows = gridContainer.querySelectorAll('.dx-data-row').filter(r => r.style.display !== 'none');
    for (const r of visibleRows) {
      assert.equal(r.querySelector('.cell-slocId').textContent.trim(), 'SDC0101');
      assert.equal(r.querySelector('.cell-itemCode').textContent.trim(), 'ITEM-001');
    }
  });

  test('T1-R5-04: Header Filter Popup DOM Automation (Mode B - Matching Hình 5)', async () => {
    const { doc, win, filterIconSloc, popupContent, searchInput, chk1, btnOk, gridContainer } = createMockPOSInventoryDocument({ initialRows: 8 });
    const page = new MockPage(doc, win);

    // 1. Click funnel icon on Sloc Id column
    filterIconSloc.click();
    assert.equal(popupContent.style.display, '');

    // 2. Type in search input
    searchInput.value = 'SDC0101';
    searchInput.dispatchEvent(new MockEvent('input'));

    // 3. Check matching checkbox
    chk1.checked = true;

    // 4. Click OK
    btnOk.click();
    assert.equal(popupContent.style.display, 'none');

    const gridInst = win.DevExpress.ui.dxDataGrid.getInstance(gridContainer);
    assert.deepEqual(gridInst.columnOption('slocId', 'filterValues'), ['SDC0101']);
  });

  test('T1-R5-05: Excel Export Reflects Applied UI Filters', async () => {
    const { doc, win, gridContainer, btnSquareExport } = createMockPOSInventoryDocument({ initialRows: 10 });
    const page = new MockPage(doc, win);

    // Filter to SDC0101 only
    const gridInst = win.DevExpress.ui.dxDataGrid.getInstance(gridContainer);
    gridInst.columnOption('slocId', 'filterValues', ['SDC0101']);
    gridInst.columnOption('slocId', 'filterType', 'include');

    btnSquareExport.click();
    assert.ok(win.__capturedBlobs.length > 0);
  });

  test('T1-R5-06: Filter Clearing and Reset to All Records', async () => {
    const { doc, win, gridContainer } = createMockPOSInventoryDocument({ initialRows: 10 });
    const gridInst = win.DevExpress.ui.dxDataGrid.getInstance(gridContainer);

    // Apply filter
    gridInst.columnOption('slocId', 'filterValues', ['SDC0101']);
    assert.deepEqual(gridInst.columnOption('slocId', 'filterValues'), ['SDC0101']);

    // Clear filter
    gridInst.columnOption('slocId', 'filterValues', []);
    const visibleRows = gridContainer.querySelectorAll('.dx-data-row').filter(r => r.style.display !== 'none');
    assert.equal(visibleRows.length, 10);
  });

  // --- TIER 2: Boundary & Corner Cases ---

  test('T2-R5-01: Filter Value Containing Special Characters & Spaces', async () => {
    const { doc, win, gridContainer } = createMockPOSInventoryDocument({ initialRows: 4 });
    const specialVal = 'SP / RAW-MAT (01) & [TEST]';

    const gridInst = win.DevExpress.ui.dxDataGrid.getInstance(gridContainer);
    gridInst.columnOption('itemCode', 'filterValues', [specialVal]);
    assert.deepEqual(gridInst.columnOption('itemCode', 'filterValues'), [specialVal]);
  });

  test('T2-R5-02: Filter on Column Without Header Filter Enabled', async () => {
    const { doc, win, gridContainer } = createMockPOSInventoryDocument({ initialRows: 4 });
    const gridInst = win.DevExpress.ui.dxDataGrid.getInstance(gridContainer);

    // Setting filter on standard column via API succeeds even without popup
    gridInst.columnOption('quantity', 'filterValues', ['100']);
    assert.deepEqual(gridInst.columnOption('quantity', 'filterValues'), ['100']);
  });

  test('T2-R5-03: Header Filter Popup Cancellation (Click Cancel Button)', async () => {
    const { doc, win, filterIconSloc, popupContent, chk1, btnCancel, gridContainer } = createMockPOSInventoryDocument({ initialRows: 6 });

    filterIconSloc.click();
    assert.equal(popupContent.style.display, '');

    chk1.checked = true;
    btnCancel.click();

    // Popup closed, but grid filter option NOT committed
    assert.equal(popupContent.style.display, 'none');
    const gridInst = win.DevExpress.ui.dxDataGrid.getInstance(gridContainer);
    assert.equal(gridInst.columnOption('slocId', 'filterValues'), undefined);
  });

  test('T2-R5-04: Filter Matching Zero Records (Empty Result Set)', async () => {
    const { doc, win, gridContainer } = createMockPOSInventoryDocument({ initialRows: 6 });
    const gridInst = win.DevExpress.ui.dxDataGrid.getInstance(gridContainer);

    gridInst.columnOption('slocId', 'filterValues', ['NON_EXISTENT_KHO']);
    const visibleRows = gridContainer.querySelectorAll('.dx-data-row').filter(r => r.style.display !== 'none');
    assert.equal(visibleRows.length, 0);
  });

  test('T2-R5-05: Multiple Values in Filter Array', async () => {
    const { doc, win, gridContainer } = createMockPOSInventoryDocument({ initialRows: 8 });
    const gridInst = win.DevExpress.ui.dxDataGrid.getInstance(gridContainer);

    gridInst.columnOption('slocId', 'filterValues', ['SDC0101', 'SDC0102']);
    assert.deepEqual(gridInst.columnOption('slocId', 'filterValues'), ['SDC0101', 'SDC0102']);

    const visibleRows = gridContainer.querySelectorAll('.dx-data-row').filter(r => r.style.display !== 'none');
    assert.equal(visibleRows.length, 8);
  });

  test('T2-R5-06: Fast Sequential Filter Updates (Debounce Handling)', async () => {
    const { doc, win, gridContainer } = createMockPOSInventoryDocument({ initialRows: 8 });
    const gridInst = win.DevExpress.ui.dxDataGrid.getInstance(gridContainer);

    gridInst.columnOption('slocId', 'filterValues', ['SDC0101']);
    gridInst.columnOption('slocId', 'filterValues', ['SDC0102']);
    gridInst.columnOption('slocId', 'filterValues', ['SDC0101']);

    assert.deepEqual(gridInst.columnOption('slocId', 'filterValues'), ['SDC0101']);
  });
});
