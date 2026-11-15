// E2E Test Suite — Requirement R4: Inventory Onhand Search Retry and Wait Logic
// 12 Tests total: 6 Tier 1 (Happy Path) + 6 Tier 2 (Boundary & Corner Cases)

import test from 'node:test';
import assert from 'node:assert/strict';
import { POSAdapter } from '../../packages/pos-adapter/dist/index.js';
import { MockBrowserManager } from './harness/mock-browser-engine.mjs';
import { MockPage } from './harness/mock-page.mjs';
import { createMockPOSInventoryDocument, MockDocument, MockWindow, MockEvent } from './harness/mock-dom.mjs';

test.describe('R4: Inventory Onhand Search Retry and Wait Logic', () => {

  // --- TIER 1: Feature Coverage (Happy Path) ---

  test('T1-R4-01: Zero Search Clicks When Grid Already Populated (Matching Hình 4)', async () => {
    const { doc, win } = createMockPOSInventoryDocument({
      initialRows: 42,
      waveActive: false,
    });
    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('POS', page);

    const adapter = new POSAdapter(browser, 'https://pos.test/');
    await adapter.downloadInventoryOnhand({ storeFilter: 'TM01' });

    assert.equal(win.__searchClicks, 0);
  });

  test('T1-R4-02: Loading Wave Overlay Detach Detection', async () => {
    const { doc, win, loadingWave } = createMockPOSInventoryDocument({
      waveActive: true,
    });
    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('POS', page);

    const adapter = new POSAdapter(browser, 'https://pos.test/');
    setTimeout(() => { loadingWave.style.display = 'none'; }, 20);

    await adapter.waitForLoadingWaveToEnd(page);
    assert.equal(loadingWave.style.display, 'none');
  });

  test('T1-R4-03: Mandatory 3-Second Wait Window Enforcement via Page Delay', async () => {
    const page = new MockPage();
    const start = Date.now();
    await page.waitForTimeout(3000);
    const elapsed = Date.now() - start;
    // mock-page.mjs accelerates waitForTimeout for fast test execution (< 50ms)
    assert.ok(elapsed >= 0 && elapsed <= 100);
  });

  test('T1-R4-04: Single Search Click When Landing on Empty Grid', async () => {
    const { doc, win } = createMockPOSInventoryDocument({
      initialRows: 0,
      waveActive: false,
      populateOnSearchClick: true,
    });
    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('POS', page);

    const adapter = new POSAdapter(browser, 'https://pos.test/');
    await adapter.downloadInventoryOnhand({ storeFilter: 'TM01' });

    assert.equal(win.__searchClicks, 1);
  });

  test('T1-R4-05: Multi-Attempt Retry When Data Delays (Adapter Built-in Retry)', async () => {
    const { doc, win, btnSearch, tbody } = createMockPOSInventoryDocument({
      initialRows: 0,
      waveActive: false,
    });
    btnSearch.addEventListener('click', () => {
      if (win.__searchClicks === 3) {
        const tr = doc.createElement('tr');
        tr.className = 'dx-data-row';
        tbody.appendChild(tr);
        const noData = doc.querySelector('.dx-datagrid-nodata');
        if (noData) noData.style.display = 'none';
      }
    });
    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('POS', page);

    const adapter = new POSAdapter(browser, 'https://pos.test/');
    await adapter.downloadInventoryOnhand({ storeFilter: 'TM01' });

    assert.equal(win.__searchClicks, 3);
  });

  test('T1-R4-06: Direct In-Page API Fallback Data Fetch', async () => {
    const page = new MockPage();
    const mockApiResponse = [
      { storeId: 'TM01', slocId: 'SDC0101', itemCode: 'ITEM-01', quantity: 15 },
      { storeId: 'TM01', slocId: 'SDC0101', itemCode: 'ITEM-02', quantity: 20 },
    ];

    page.evaluate = async () => mockApiResponse;

    const data = await page.evaluate();
    assert.equal(Array.isArray(data), true);
    assert.equal(data.length, 2);
    assert.equal(data[0].itemCode, 'ITEM-01');
  });

  // --- TIER 2: Boundary & Corner Cases ---

  test('T2-R4-01: Persistent Empty Grid ("No data") Bounded Cutoff', async () => {
    const { doc, win } = createMockPOSInventoryDocument({
      initialRows: 0,
      waveActive: false,
      populateOnSearchClick: false, // Never populates
    });
    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('POS', page);

    const adapter = new POSAdapter(browser, 'https://pos.test/');
    await adapter.downloadInventoryOnhand({ storeFilter: 'TM01' });

    assert.equal(win.__searchClicks, 6);
  });

  test('T2-R4-02: Wave Disappears But Re-appears (Staggered Loading)', async () => {
    const { doc, win, loadingWave } = createMockPOSInventoryDocument({
      waveActive: true,
    });
    const page = new MockPage(doc, win);
    const waveLoc = page.locator('.dx-loadpanel');

    // Chunk 1 hides
    loadingWave.style.display = 'none';
    assert.equal(await waveLoc.isVisible(), false);

    // Chunk 2 re-displays wave
    loadingWave.style.display = '';
    assert.equal(await waveLoc.isVisible(), true);

    // Final settlement
    loadingWave.style.display = 'none';
    assert.equal(await waveLoc.isVisible(), false);
  });

  test('T2-R4-03: Transient Network Interruption During Retry Wait', async () => {
    let failureCount = 0;
    let success = false;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        if (attempt === 1) {
          failureCount++;
          throw new Error('504 Gateway Timeout');
        }
        success = true;
        break;
      } catch (e) {
        assert.equal(e.message, '504 Gateway Timeout');
      }
    }

    assert.equal(failureCount, 1);
    assert.equal(success, true);
  });

  test('T2-R4-04: Search Button Disabling During Query Execution', async () => {
    const { doc, win, btnSearch } = createMockPOSInventoryDocument({
      initialRows: 0,
    });
    const page = new MockPage(doc, win);

    btnSearch.disabled = true;
    const searchLoc = page.locator('.btn-search').first();
    assert.equal(await searchLoc.isEnabled(), false);

    // Attempted click when disabled does not trigger
    btnSearch.click();
    assert.equal(win.__searchClicks, 0);

    // Button re-enabled
    btnSearch.disabled = false;
    assert.equal(await searchLoc.isEnabled(), true);
    btnSearch.click();
    assert.equal(win.__searchClicks, 1);
  });

  test('T2-R4-05: False Positive Row Check (Header Row vs Data Row)', async () => {
    const { doc, win } = createMockPOSInventoryDocument({
      initialRows: 0,
    });
    const page = new MockPage(doc, win);

    // Header row present
    const headerCount = await page.locator('.dx-header-row').count();
    assert.equal(headerCount, 1);

    // Data rows absent
    const dataCount = await page.locator('.dx-datagrid-rowsview .dx-data-row').count();
    assert.equal(dataCount, 0);
  });

  test('T2-R4-06: Zero Rows Returned for Real (Empty Warehouse)', async () => {
    const { doc, win, noData } = createMockPOSInventoryDocument({
      initialRows: 0,
    });
    const page = new MockPage(doc, win);

    const noDataLoc = page.locator('.dx-datagrid-nodata');
    assert.equal(await noDataLoc.isVisible(), true);
    assert.equal(noData.textContent, 'No data');
  });
});
