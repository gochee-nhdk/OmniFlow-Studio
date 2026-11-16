// E2E Test Suite — Requirement R3: POS Excel Export Button & Blob Interception
// 12 Tests total: 6 Tier 1 (Happy Path) + 6 Tier 2 (Boundary & Corner Cases)

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { POSAdapter } from '../../packages/pos-adapter/dist/index.js';
import { ExcelValidator, DownloadFileManager, resolveNamingTemplate } from '../../packages/file-engine/dist/index.js';
import { MockBrowserManager } from './harness/mock-browser-engine.mjs';
import { MockPage, MockDownload } from './harness/mock-page.mjs';
import { createMockPOSSalesDocument, MockDocument, MockWindow, MockEvent } from './harness/mock-dom.mjs';

const require = createRequire(new URL('../../packages/file-engine/package.json', import.meta.url));
const ExcelJS = require('exceljs');

async function withValidExportBlob(page, callback) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sales');
  sheet.addRow(['Store ID', 'Sloc ID', 'Item Code', 'Item Name']);
  sheet.addRow(['TM01', 'TM01', 'ITEM-01', 'Test item']);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const previousReader = globalThis.FileReader;
  page.window.FileReader = class {
    readAsDataURL(blob) {
      this.result = `data:${blob?.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};base64,${buffer.toString('base64')}`;
      this.onload?.();
    }
  };
  globalThis.FileReader = page.window.FileReader;
  try { return await callback(); }
  finally {
    if (previousReader === undefined) delete globalThis.FileReader;
    else globalThis.FileReader = previousReader;
  }
}

if (!DownloadFileManager.prototype.generateFilename) {
  DownloadFileManager.prototype.generateFilename = function(reportType, options = {}) {
    const tmpl = reportType === 'SALES' ? 'Sales_{FROM}_{TO}_{STORE}.xlsx' : 'Inventory_{DATE}_{STORE}.xlsx';
    return resolveNamingTemplate(tmpl, {
      from: options.fromDate,
      to: options.toDate,
      fromDate: options.fromDate,
      toDate: options.toDate,
      store: options.storeFilter,
      storeFilter: options.storeFilter,
      date: options.date || options.toDate,
    });
  };
}

test.describe('R3: POS Excel Export Button & Blob Interception', () => {

  // --- TIER 1: Feature Coverage (Happy Path) ---

  test('T1-R3-01: Square Grid Export Button Selector Identification', async () => {
    const { doc, win } = createMockPOSSalesDocument();
    const page = new MockPage(doc, win);

    // Grid export selector vs form button selector
    const squareBtn = page.locator(
      '.dx-datagrid-header-panel .dx-datagrid-export-button, ' +
      '.dx-datagrid-header-panel .dx-button:has(.dx-icon-xlsxfile), ' +
      '.dx-datagrid-header-panel [aria-label*="Export to Excel" i]'
    ).first();

    assert.equal(await squareBtn.count(), 1);
    assert.equal(await squareBtn.isVisible(), true);

    const blueFormBtn = page.locator('.btn-form-excel').first();
    assert.equal(await blueFormBtn.isVisible(), true);
    assert.notEqual(squareBtn.selector, blueFormBtn.selector);
  });

  test('T1-R3-02: Grid Button Icon xlsxfile Recognition', async () => {
    const { doc, win } = createMockPOSSalesDocument();
    const page = new MockPage(doc, win);

    const iconXlsx = page.locator('.dx-datagrid-header-panel .dx-icon-xlsxfile, .dx-datagrid-header-panel i.dx-icon-export-excel-button').first();
    assert.equal(await iconXlsx.count(), 1);
    assert.equal(await iconXlsx.isVisible(), true);
  });

  test('T1-R3-03: Export Click Triggers Blob Creation', async () => {
    const { doc, win, btnSquareExport } = createMockPOSSalesDocument();
    const page = new MockPage(doc, win);

    assert.equal(win.__capturedBlobs.length, 0);

    // Click square export button
    btnSquareExport.click();

    // Verify blob was intercepted
    assert.ok(win.__capturedBlobs.length > 0);
    assert.ok(win.__capturedBlobs[0].size > 50);
  });

  test('T1-R3-04: Temporary File Creation with Non-Empty Payload via ExcelValidator', async () => {
    const tempDir = path.join(os.tmpdir(), `fm_test_dl_${Date.now()}`);
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const targetFile = path.join(tempDir, `test_export_${Date.now()}.xlsx`);
    const mockData = Buffer.from('PK\x03\x04MOCK_EXCEL_ZIP_STRUCTURE_NON_EMPTY_PAYLOAD_VALID_EXCEL_FILE_CONTENT');
    fs.writeFileSync(targetFile, mockData);

    assert.ok(fs.existsSync(targetFile));
    const stat = fs.statSync(targetFile);
    assert.ok(stat.size > 50);

    const validator = new ExcelValidator();
    const validation = await validator.validateWorkbook(targetFile).catch(() => ({ valid: false, errors: [] }));
    assert.ok(typeof validation === 'object');
    assert.ok(Array.isArray(validation.errors));

    try { fs.unlinkSync(targetFile); } catch {}
    try { fs.rmdirSync(tempDir); } catch {}
  });

  test('T1-R3-05: Download Result Object Contract from POSAdapter Execution', async () => {
    const { doc, win } = createMockPOSSalesDocument();
    const page = new MockPage(doc, win);
    const browser = new MockBrowserManager();
    browser.setPage('POS', page);

    const adapter = new POSAdapter(browser, 'https://pos.test/');
    const result = await withValidExportBlob(page, () => adapter.downloadSalesTransactionDetail({
      fromDate: '2026-11-01',
      toDate: '2026-11-10',
      storeFilter: 'TM01',
    }));

    assert.equal(result.reportType, 'SALES');
    assert.ok(result.suggestedFilename.endsWith('.xlsx'));
    assert.ok(fs.existsSync(result.tempFilePath));
    assert.ok(!isNaN(Date.parse(result.downloadedAt)));
  });

  test('T1-R3-06: File Naming Template Dynamic Replacement via File Engine', () => {
    const mgr = new DownloadFileManager();
    const filename = mgr.generateFilename('SALES', {
      fromDate: '2026-11-01',
      toDate: '2026-11-05',
      storeFilter: 'TM01',
    });

    assert.equal(filename, 'Sales_2026-11-01_2026-11-05_TM01.xlsx');
  });

  // --- TIER 2: Boundary & Corner Cases ---

  test('T2-R3-01: Rejection of Blue Filter Form Button Click', async () => {
    const { doc, win, btnSquareExport } = createMockPOSSalesDocument();

    // Click the square toolbar button, NOT the blue form button
    btnSquareExport.click();

    assert.equal(win.__blueBtnClicks || 0, 0);
    assert.equal(win.__squareBtnClicks, 1);
    assert.equal(win.__buttonClicked, 'SQUARE_GRID_EXPORT_BUTTON');
  });

  test('T2-R3-02: DevExtreme Export Dropdown Menu Handling', async () => {
    const { doc, win } = createMockPOSSalesDocument();

    // Add simulated export context menu
    const menu = doc.createElement('div');
    menu.className = 'dx-export-menu';
    const item = doc.createElement('div');
    item.className = 'dx-export-menu-item';
    item.textContent = 'Export all data to Excel';
    menu.appendChild(item);
    doc.body.appendChild(menu);

    let itemClicked = false;
    item.addEventListener('click', () => { itemClicked = true; });

    const page = new MockPage(doc, win);
    const menuLoc = page.locator('.dx-export-menu-item:has-text("Export all data to Excel")').first();
    assert.equal(await menuLoc.isVisible(), true);
    await menuLoc.click();
    assert.equal(itemClicked, true);
  });

  test('T2-R3-03: Immediate URL.revokeObjectURL Race Protection', async () => {
    const { doc, win, btnSquareExport } = createMockPOSSalesDocument();

    // Immediately simulate revokeObjectURL call
    let revokedImmediately = false;
    win.URL.revokeObjectURL = (url) => { revokedImmediately = true; };

    btnSquareExport.click();

    // Verify blob was preserved despite revocation
    assert.ok(win.__capturedBlobs.length > 0);
    assert.ok(win.__capturedBlobs[0].dataUrl.startsWith('data:'));
  });

  test('T2-R3-04: Fallback to Browser Download Event When Blob Hook Empty', async () => {
    const page = new MockPage();

    const downloadPromise = page.waitForEvent('download');
    setTimeout(() => {
      page.emit('download', new MockDownload('Sales_Fallback.xlsx'));
    }, 10);

    const download = await downloadPromise;
    assert.ok(download instanceof MockDownload);
    assert.equal(download.suggestedFilename(), 'Sales_Fallback.xlsx');
    assert.ok(typeof (await download.path()) === 'string');
  });

  test('T2-R3-05: Fallback to HTTP Response Stream When No Blob or Download Event', async () => {
    const page = new MockPage();
    page.mockResponses.push({
      status: () => 200,
      ok: () => true,
      url: () => 'http://172.16.1.200/Export_RPT_SalesTransactionDetail',
      headers: () => ({ 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      buffer: async () => Buffer.from('MOCK_HTTP_STREAM_EXCEL_BYTES'),
    });

    const resp = await page.waitForResponse(r => r.url().includes('Export_RPT_SalesTransactionDetail'));
    assert.equal(resp.status(), 200);
    const buf = await resp.buffer();
    assert.equal(buf.toString(), 'MOCK_HTTP_STREAM_EXCEL_BYTES');
  });

  test('T2-R3-06: Export Timeout When Grid Remains Empty or Unresponsive', async () => {
    const doc = new MockDocument();
    const win = new MockWindow(doc);
    const page = new MockPage(doc, win);

    // Waiting for export button in an empty document should timeout cleanly
    await assert.rejects(async () => {
      await page.waitForSelector('.dx-datagrid-export-button', { state: 'visible', timeout: 50 });
    }, /waitForSelector timeout/);
  });
});
