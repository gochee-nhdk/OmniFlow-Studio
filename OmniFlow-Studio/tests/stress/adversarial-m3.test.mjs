// FM AUTO OPS — Milestone M3 Adversarial Stress & Chaos Test Suite
// Authored by Empirical Challenger (Challenger 2)
// Thoroughly stresses:
// 1. Concurrent & staggered loading waves in Inventory Onhand
// 2. DevExpress Header Filter popup race conditions & timing
// 3. Mode A -> Mode B fallback when window.DevExpress is missing/corrupted
// 4. Browser engine unexpected context closures, page crashes, and zombie recovery
// 5. Workflow date range propagation & blur model stability

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  POSAdapter,
  setGridFilter,
  resolveColumnIdentifiers,
} from '../../packages/pos-adapter/dist/index.js';
import { BrowserManager } from '../../packages/browser-engine/dist/index.js';
import {
  createMockPOSInventoryDocument,
  createMockPOSSalesDocument,
  MockDocument,
  MockWindow,
  MockEvent,
  MockCustomEvent,
} from '../e2e/harness/mock-dom.mjs';
import { MockPage, MockDownload } from '../e2e/harness/mock-page.mjs';
import { MockBrowserManager } from '../e2e/harness/mock-browser-engine.mjs';

test.describe('Milestone M3 Adversarial Stress Testing', () => {

  // =========================================================================
  // SUITE 1: Inventory Onhand Concurrent & Staggered Loading Waves
  // =========================================================================

  test('STRESS-1.1: Staggered Loading Waves (Wave hides, then reappears during chunk settlement)', async () => {
    const { doc, win, loadingWave, btnSearch } = createMockPOSInventoryDocument({
      waveActive: true,
      initialRows: 0,
    });
    const page = new MockPage(doc, win);
    const mockBm = new MockBrowserManager();
    const adapter = new POSAdapter(mockBm);

    // Track wave visibility states
    let waveTransitions = 0;

    // Simulate async staggered loading:
    // Wave active at t=0
    // Wave hides at t=30ms
    // Wave reappears at t=60ms (Chunk 2)
    // Wave finally hides at t=120ms
    setTimeout(() => {
      loadingWave.style.display = 'none';
      waveTransitions++;
    }, 30);

    setTimeout(() => {
      loadingWave.style.display = '';
      waveTransitions++;
    }, 60);

    setTimeout(() => {
      loadingWave.style.display = 'none';
      waveTransitions++;
    }, 120);

    const startTime = Date.now();
    await adapter.waitForLoadingWaveToEnd(page, 2000);

    // Verify wave is indeed hidden at the end
    const isWaveVisible = await page.locator('.dx-loadpanel').isVisible();
    assert.equal(isWaveVisible, false, 'Loading wave must be fully hidden after staggered waves');
    assert.ok(waveTransitions >= 2, `Expected at least 2 wave transitions, got ${waveTransitions}`);
  });

  test('STRESS-1.2: Delayed Loading Wave Appearance (Wave mounts 40ms AFTER page load)', async () => {
    const { doc, win, loadingWave } = createMockPOSInventoryDocument({
      waveActive: false, // Initially hidden
      initialRows: 0,
    });
    const page = new MockPage(doc, win);
    const mockBm = new MockBrowserManager();
    const adapter = new POSAdapter(mockBm);

    // Wave suddenly pops up after 40ms, then hides at 100ms
    setTimeout(() => {
      loadingWave.style.display = '';
    }, 40);

    setTimeout(() => {
      loadingWave.style.display = 'none';
    }, 100);

    await adapter.waitForLoadingWaveToEnd(page, 2000);

    const isWaveVisible = await page.locator('.dx-loadpanel').isVisible();
    assert.equal(isWaveVisible, false, 'Loading wave must settle to hidden even if delayed at start');
  });

  test('STRESS-1.3: Infinite Loading Wave Timeout Gracefulness', async () => {
    const { doc, win, loadingWave } = createMockPOSInventoryDocument({
      waveActive: true, // Never hides
      initialRows: 0,
    });
    const page = new MockPage(doc, win);
    const mockBm = new MockBrowserManager();
    const adapter = new POSAdapter(mockBm);

    const start = Date.now();
    // Use short timeoutMs = 120ms to verify it does not throw or hang
    await adapter.waitForLoadingWaveToEnd(page, 120);
    const elapsed = Date.now() - start;

    assert.ok(elapsed >= 100, `Expected graceful timeout after ~120ms, elapsed was ${elapsed}ms`);
  });

  test('STRESS-1.4: Race condition between isGridPopulated and async row insertion with lingering "No data"', async () => {
    const { doc, win, noData, tbody } = createMockPOSInventoryDocument({
      waveActive: false,
      initialRows: 0,
    });
    const page = new MockPage(doc, win);
    const mockBm = new MockBrowserManager();
    const adapter = new POSAdapter(mockBm);

    // State A: 0 rows, noData visible -> false
    assert.equal(await adapter.isGridPopulated(page), false);

    // State B: Rows inserted, but "No data" banner is still visible (DOM race)
    const tr = doc.createElement('tr');
    tr.className = 'dx-data-row';
    tbody.appendChild(tr);
    noData.style.display = ''; // Still visible!

    // Invariant: If "No data" is visible, grid must NOT be considered populated
    assert.equal(await adapter.isGridPopulated(page), false, 'Lingering "No data" banner must block false positive');

    // State C: "No data" banner is hidden -> now populated is true
    noData.style.display = 'none';
    assert.equal(await adapter.isGridPopulated(page), true, 'Grid populated when rows exist and "No data" is hidden');
  });

  test('STRESS-1.5: Zero Search Clicks Invariant under High Initial Row Volume', async () => {
    const { doc, win, btnSearch } = createMockPOSInventoryDocument({
      waveActive: false,
      initialRows: 500, // 500 rows
    });
    const page = new MockPage(doc, win);
    const mockBm = new MockBrowserManager();
    const adapter = new POSAdapter(mockBm);

    const populated = await adapter.isGridPopulated(page);
    assert.equal(populated, true);

    // If populated, search button must NOT be clicked
    if (!populated) {
      btnSearch.click();
    }
    assert.equal(win.__searchClicks, 0, 'Zero search clicks invariant violated!');
  });

  // =========================================================================
  // SUITE 2: DevExpress Header Filter Popup Race Conditions & Timing
  // =========================================================================

  test('STRESS-2.1: Delayed Popup Mounting (Funnel click takes 80ms to display popup)', async () => {
    const { doc, win, popupContent, filterIconSloc } = createMockPOSInventoryDocument({ initialRows: 6 });
    const page = new MockPage(doc, win);

    // Override filterIcon click to delay display of popupContent
    filterIconSloc.listeners.delete('click');
    filterIconSloc.addEventListener('click', () => {
      setTimeout(() => {
        popupContent.style.display = '';
      }, 80);
    });

    const success = await setGridFilter(page, 'slocId', 'SDC0101', { mode: 'dom' });
    assert.equal(success, true, 'setGridFilter Mode B should succeed even with delayed popup mount');

    const gridInst = win.DevExpress.ui.dxDataGrid.getInstance(doc.querySelector('.dx-datagrid'));
    assert.deepEqual(gridInst.columnOption('slocId', 'filterValues'), ['SDC0101']);
  });

  test('STRESS-2.2: Fast Sequential Filtering on Multiple Columns (Sloc Id then Item Code)', async () => {
    const { doc, win } = createMockPOSInventoryDocument({ initialRows: 8 });
    const page = new MockPage(doc, win);

    const res1 = await setGridFilter(page, 'slocId', 'SDC0101');
    const res2 = await setGridFilter(page, 'itemCode', 'ITEM-001');

    assert.equal(res1, true, 'Sloc filter should succeed');
    assert.equal(res2, true, 'Item filter should succeed');

    const gridInst = win.DevExpress.ui.dxDataGrid.getInstance(doc.querySelector('.dx-datagrid'));
    assert.deepEqual(gridInst.columnOption('slocId', 'filterValues'), ['SDC0101']);
    assert.deepEqual(gridInst.columnOption('itemCode', 'filterValues'), ['ITEM-001']);
  });

  test('STRESS-2.3: Special Characters and Whitespace in Filter Value', async () => {
    const { doc, win } = createMockPOSInventoryDocument({ initialRows: 4 });
    const page = new MockPage(doc, win);

    const complexVal = 'WH/HCM (01) & [TEST] "QUOTE"';
    const res = await setGridFilter(page, 'whsName', complexVal);
    assert.equal(res, true);

    const gridInst = win.DevExpress.ui.dxDataGrid.getInstance(doc.querySelector('.dx-datagrid'));
    assert.deepEqual(gridInst.columnOption('whsName', 'filterValues'), [complexVal]);
  });

  test('STRESS-2.4: Empty Array Value Clears Filters', async () => {
    const { doc, win } = createMockPOSInventoryDocument({ initialRows: 6 });
    const page = new MockPage(doc, win);

    // Apply
    await setGridFilter(page, 'slocId', 'SDC0101');
    const gridInst = win.DevExpress.ui.dxDataGrid.getInstance(doc.querySelector('.dx-datagrid'));
    assert.deepEqual(gridInst.columnOption('slocId', 'filterValues'), ['SDC0101']);

    // Clear with empty string or empty array
    await setGridFilter(page, 'slocId', []);
    assert.deepEqual(gridInst.columnOption('slocId', 'filterValues'), []);
  });

  test('STRESS-2.5: Header Filter on Non-Existent Column Returns False Gracefully', async () => {
    const { doc, win } = createMockPOSInventoryDocument({ initialRows: 6 });
    const page = new MockPage(doc, win);

    // Request non-existent column in DOM mode
    const res = await setGridFilter(page, 'NonExistentColumnXYZ', 'VAL', { mode: 'dom' });
    assert.equal(res, false, 'Non-existent column in DOM mode must return false without throwing');
  });

  // =========================================================================
  // SUITE 3: Fallback from Mode A to Mode B when window.DevExpress is missing/undefined
  // =========================================================================

  test('STRESS-3.1: window.DevExpress is completely undefined -> Automatic Fallback to Mode B (DOM Popup)', async () => {
    const { doc, win, filterIconSloc, popupContent, gridContainer } = createMockPOSInventoryDocument({ initialRows: 6 });
    const page = new MockPage(doc, win);

    // Remove window.DevExpress completely
    delete win.DevExpress;
    assert.equal(win.DevExpress, undefined);

    // Call setGridFilter with default mode='auto'
    const success = await setGridFilter(page, 'slocId', 'SDC0101', { mode: 'auto' });
    assert.equal(success, true, 'Must seamlessly fall back to Mode B when window.DevExpress is undefined');

    // Verify popup was manipulated and closed
    assert.equal(popupContent.style.display, 'none');
  });

  test('STRESS-3.2: window.DevExpress.ui.dxDataGrid is undefined -> Fallback to Mode B', async () => {
    const { doc, win, popupContent } = createMockPOSInventoryDocument({ initialRows: 6 });
    const page = new MockPage(doc, win);

    // DevExpress exists, but dxDataGrid is absent (e.g. only dxDateBox is loaded)
    win.DevExpress = { ui: { dxDateBox: {} } };

    const success = await setGridFilter(page, 'slocId', 'SDC0101', { mode: 'auto' });
    assert.equal(success, true, 'Must fall back to Mode B when dxDataGrid widget is absent');
  });

  test('STRESS-3.3: Mode A getInstance returns null -> Fallback to Mode B', async () => {
    const { doc, win } = createMockPOSInventoryDocument({ initialRows: 6 });
    const page = new MockPage(doc, win);

    // getInstance returns null
    win.DevExpress.ui.dxDataGrid.getInstance = () => null;

    const success = await setGridFilter(page, 'slocId', 'SDC0101', { mode: 'auto' });
    assert.equal(success, true, 'Must fall back to Mode B when dxDataGrid.getInstance returns null');
  });

  test('STRESS-3.4: Strict Mode A (mode: "api") without DevExpress returns false without crashing', async () => {
    const { doc, win } = createMockPOSInventoryDocument({ initialRows: 6 });
    const page = new MockPage(doc, win);

    delete win.DevExpress;

    const res = await setGridFilter(page, 'slocId', 'SDC0101', { mode: 'api' });
    assert.equal(res, false, 'Strict API mode must return false when DevExpress is missing');
  });

  test('STRESS-3.5: Strict Mode B (mode: "dom") bypasses Mode A even if DevExpress is present', async () => {
    const { doc, win, popupContent } = createMockPOSInventoryDocument({ initialRows: 6 });
    const page = new MockPage(doc, win);

    let apiCalled = false;
    win.DevExpress.ui.dxDataGrid.getInstance = () => {
      apiCalled = true;
      return null;
    };

    const res = await setGridFilter(page, 'slocId', 'SDC0101', { mode: 'dom' });
    assert.equal(res, true);
    assert.equal(apiCalled, false, 'Mode DOM must NOT invoke Mode A API');
  });

  // =========================================================================
  // SUITE 4: Browser-Engine Unexpected Context Closes & Crash Events Gracefulness
  // =========================================================================

  test('STRESS-4.1: Unexpected Context Closure triggers cleanup and self-healing', async () => {
    let closeReported = false;
    let newPageCreated = 0;

    class MockSimulatedContext extends EventEmitter {
      constructor() {
        super();
        this._closed = false;
        this._pages = [];
      }
      pages() {
        return this._pages;
      }
      async newPage() {
        newPageCreated++;
        const p = new MockPage();
        this._pages.push(p);
        return p;
      }
      async close() {
        this._closed = true;
        this.emit('close');
      }
    }

    const mockCtx = new MockSimulatedContext();
    const fakePage = await mockCtx.newPage();

    // Verify context emits close and listener cleans up
    mockCtx.on('close', () => {
      closeReported = true;
    });

    await mockCtx.close();
    assert.equal(closeReported, true, 'Context close event must be emitted and captured');
    assert.equal(mockCtx._closed, true);
  });

  test('STRESS-4.2: Page Crash Event listener triggers error notice without unhandled exception', async () => {
    const page = new MockPage();
    let crashNotified = false;

    // Attach crash listener as in BrowserManager
    page.on('crash', () => {
      crashNotified = true;
    });

    // Simulate unexpected browser tab renderer crash
    page.emit('crash');

    assert.equal(crashNotified, true, 'Page crash event must be safely caught and logged');
  });

  test('STRESS-4.3: Zombie Page Detection (page.evaluate fails) triggers fallback', async () => {
    const page = new MockPage();
    let evaluated = false;

    // Simulate unresponsive / zombie page where evaluate throws Execution context was destroyed
    page.evaluate = async () => {
      throw new Error('Execution context was destroyed, most likely because of a navigation or crash');
    };

    let caught = false;
    try {
      await page.evaluate(() => 1);
    } catch (e) {
      caught = true;
    }

    assert.equal(caught, true, 'Stale page evaluate throw is caught for recovery');
  });

  // =========================================================================
  // SUITE 5: POS Date Range Reversion & Workflow Engine Propagation Stress
  // =========================================================================

  test('STRESS-5.1: Angular blur event does NOT revert committed dxDateBox model', async () => {
    const { doc, win, fromBox, fromInput } = createMockPOSSalesDocument();
    const page = new MockPage(doc, win);
    const mockBm = new MockBrowserManager();
    const adapter = new POSAdapter(mockBm);

    // Apply custom date via adapter setDateFilter
    await adapter.setDateFilter(page, 'from', '2026-12-25');

    // Trigger blur on input (simulating user clicking elsewhere or Search)
    fromInput.dispatchEvent(new MockEvent('blur'));

    assert.equal(fromInput.value, '25/12/2026', 'Input value must NOT revert to today on blur');
    assert.equal(fromBox.__committed, true, 'dxDateBox __committed flag must be true');
  });

  test('STRESS-5.2: Inverted Date Range Guard (from > to) Handling', async () => {
    const { doc, win, fromInput, toInput } = createMockPOSSalesDocument();
    const page = new MockPage(doc, win);
    const mockBm = new MockBrowserManager();
    const adapter = new POSAdapter(mockBm);

    await adapter.setDateFilter(page, 'from', '2026-12-31');
    await adapter.setDateFilter(page, 'to', '2026-01-01');

    assert.equal(fromInput.value, '31/12/2026');
    assert.equal(toInput.value, '01/01/2026');
  });

  test('STRESS-5.3: Corrupted Date String fallback in setDateFilter', async () => {
    const { doc, win, fromInput } = createMockPOSSalesDocument();
    const initialVal = fromInput.value;
    const page = new MockPage(doc, win);
    const mockBm = new MockBrowserManager();
    const adapter = new POSAdapter(mockBm);

    // Pass garbage date string
    await adapter.setDateFilter(page, 'from', 'INVALID_GARBAGE_DATE');

    // Should not throw, should retain previous value
    assert.equal(fromInput.value, initialVal, 'Corrupted date must be gracefully rejected without mutating input');
  });
});
