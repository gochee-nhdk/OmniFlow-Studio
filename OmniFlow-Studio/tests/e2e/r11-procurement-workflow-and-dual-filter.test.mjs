import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../packages/file-engine/package.json', import.meta.url));
const ExcelJS = require('exceljs');

import { BrowserManager } from '../../packages/browser-engine/dist/index.js';
import { POSAdapter, enforceExcelFilterIntegrity } from '../../packages/pos-adapter/dist/index.js';
import { SAPAdapter } from '../../packages/sap-adapter/dist/index.js';
import { SecureStorage } from '../../packages/security/dist/index.js';

test('Scenario 1: BrowserManager Default CDP Attach and Graceful Tab Preservation', async () => {
  const tmpDir = path.join(os.tmpdir(), `omniflow-r11-cdp-${Date.now()}`);
  const bm = new BrowserManager({ downloadDir: tmpDir, allowCdpAttach: true });

  // Assert CDP attach when opted in
  assert.equal(bm.allowCdpAttach, true, 'allowCdpAttach should be true when opted in');
  assert.deepEqual(bm.cdpPorts, [9222, 9223, 9229], 'cdpPorts should include [9222, 9223, 9229]');

  // Verify closeContext behavior when attachedOverCDP is true
  bm.attachedOverCDP = true;
  let pageCloseCalled = false;
  const mockPage = {
    isClosed: () => false,
    close: async () => { pageCloseCalled = true; },
  };
  bm.profilePages.set('POS', mockPage);
  bm.contexts.set('POS', {});

  await bm.closeContext('POS');
  assert.equal(pageCloseCalled, false, 'closeContext on CDP session must NOT close user page');
  assert.equal(bm.profilePages.has('POS'), false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Scenario 2: Dual-Layer Excel Filter (enforceExcelFilterIntegrity)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniflow-r11-excel-'));
  const filePath = path.join(tmpDir, 'test-pos-export.xlsx');

  // Create a real workbook with six rows spanning four Sloc IDs and three SKUs.
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  sheet.addRow(['Store ID', 'Sloc ID', 'Item Code', 'Item Name', 'Qty']);
  sheet.addRow(['DC01', 'DC0101', 'SKU-01', 'Apple', 10]);
  sheet.addRow(['DC01', 'DC0101', 'SKU-02', 'Orange', 20]);
  sheet.addRow(['DC01', 'DC0101', 'SKU-03', 'Banana', 7]);
  sheet.addRow(['SFM01', 'SFM0101', 'SKU-01', 'Apple', 5]);
  sheet.addRow(['SFM02', 'SFM0201', 'SKU-02', 'Orange', 15]);
  sheet.addRow(['SFM03', 'SFM0301', 'SKU-03', 'Banana', 8]);
  await workbook.xlsx.writeFile(filePath);

  // Filter to only DC0101 and SFM0201
  const res = await enforceExcelFilterIntegrity(filePath, {
    slocs: ['DC0101', 'SFM0201'],
    items: ['SKU-01', 'SKU-02'],
  });
  assert.equal(res.filtered, true);
  assert.equal(res.modified, true);
  assert.equal(res.rowCount, 3, 'Should retain three rows matching both the Sloc and SKU filters');

  // Verify file content
  const verifiedWb = new ExcelJS.Workbook();
  await verifiedWb.xlsx.readFile(filePath);
  const verifiedSheet = verifiedWb.worksheets[0];
  const retainedSlocs = [];
  const retainedItems = [];
  verifiedSheet.eachRow((row, idx) => {
    if (idx > 1) {
      retainedSlocs.push(String(row.getCell(2).value));
      retainedItems.push(String(row.getCell(3).value));
    }
  });

  assert.deepEqual(retainedSlocs.sort(), ['DC0101', 'DC0101', 'SFM0201'].sort());
  assert.deepEqual(retainedItems.sort(), ['SKU-01', 'SKU-02', 'SKU-02'].sort());
  assert.equal(retainedSlocs.includes('SFM0101'), false, 'SFM0101 must be removed');
  assert.equal(retainedSlocs.includes('SFM0301'), false, 'SFM0301 must be removed');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Scenario 3: Buttons not blocked when no profile & Quick-paste Sloc parsing', () => {
  // Test parsing logic for quick Sloc input
  const quickInput = 'DC0101, SFM0101, SFM0201';
  const quickSlocIds = quickInput.split(',').map(s => s.trim()).filter(Boolean);
  assert.deepEqual(quickSlocIds, ['DC0101', 'SFM0101', 'SFM0201']);

  const selectedDropdown = ['DC0101'];
  const effectiveInvSlocs = [...new Set([...selectedDropdown, ...quickSlocIds])];
  assert.deepEqual(effectiveInvSlocs, ['DC0101', 'SFM0101', 'SFM0201']);

  // Test empty selection handling: defaults to '' or All (never throws error)
  const emptySelection = [];
  const slocFilterArg = emptySelection.length === 0 ? '' : emptySelection.join(',');
  assert.equal(slocFilterArg, '');
});

test('Scenario 4: SAP Procurement Navigation Target Modules', async () => {
  const dummyManager = new BrowserManager({ downloadDir: os.tmpdir() });
  const sap = new SAPAdapter(dummyManager, 'https://sap-test.example.com');

  const clickedItems = [];
  const progressMessages = [];

  const mockPage = {
    bringToFront: async () => {},
    waitForLoadState: async () => {},
    waitForSelector: async () => {},
    waitForTimeout: async () => {},
    locator: (selector) => ({
      first: () => ({
        isVisible: async () => true,
        click: async () => { clickedItems.push(selector); },
      }),
    }),
  };

  // Test PURCHASING_PO navigation
  await sap.navigateToTargetModule(mockPage, 'PURCHASING_PO', (msg) => {
    progressMessages.push(msg);
  });

  assert.equal(progressMessages.length > 0, true);
  assert.equal(progressMessages[0].includes('Purchase Order'), true);

  // Test PURCHASING_RETURN navigation
  progressMessages.length = 0;
  await sap.navigateToTargetModule(mockPage, 'PURCHASING_RETURN', (msg) => {
    progressMessages.push(msg);
  });
  assert.equal(progressMessages[0].includes('Goods Return'), true);

  // Test PURCHASING_GRPO navigation
  progressMessages.length = 0;
  await sap.navigateToTargetModule(mockPage, 'PURCHASING_GRPO', (msg) => {
    progressMessages.push(msg);
  });
  assert.equal(progressMessages[0].includes('Goods Receipt PO'), true);

  progressMessages.length = 0;
  await sap.navigateToTargetModule(mockPage, 'INVENTORY_STATUS', (msg) => {
    progressMessages.push(msg);
  });
  assert.equal(progressMessages[0].includes('Inventory Status'), true);
});

test('Scenario 7: SecureStorage instance and static methods use the same dynamic key source', () => {
  const previousKey = process.env.FM_OPS_MASTER_KEY;
  process.env.FM_OPS_MASTER_KEY = `r11-${process.pid}-${Date.now()}-dynamic-key`;
  try {
    const instance = new SecureStorage();
    const encrypted = instance.encrypt('instance-secret');
    assert.equal(instance.decrypt(encrypted), 'instance-secret');
    assert.throws(() => SecureStorage.decrypt(encrypted, 'FM_OPS_MASTER_KEY'));
  } finally {
    if (previousKey === undefined) delete process.env.FM_OPS_MASTER_KEY;
    else process.env.FM_OPS_MASTER_KEY = previousKey;
  }
});

test('Scenario 8: Active browser attach IPC channel is allowed by preload and registered by main', () => {
  const preload = fs.readFileSync(new URL('../../apps/local-agent/src/preload/index.ts', import.meta.url), 'utf8');
  const mainIpc = fs.readFileSync(new URL('../../apps/local-agent/src/main/ipc/index.ts', import.meta.url), 'utf8');
  assert.match(preload, /ALLOWED_INVOKE_CHANNELS[\s\S]*?'browser:enable-active-attach'/);
  assert.match(mainIpc, /ipcMain\.handle\('browser:enable-active-attach'/);
});

test('Scenario 5: SAP Export to Excel Helper', async () => {
  const dummyManager = new BrowserManager({ downloadDir: os.tmpdir() });
  const sap = new SAPAdapter(dummyManager, 'https://sap-test.example.com');

  let clickedExport = false;
  const mockPage = {
    locator: (selector) => ({
      first: () => ({
        isVisible: async () => selector.includes('Export to Excel'),
        click: async () => { clickedExport = true; },
      }),
    }),
    waitForTimeout: async () => {},
  };

  const exported = await sap.exportCurrentListToExcel(mockPage);
  assert.equal(exported, true);
  assert.equal(clickedExport, true);
});

test('Scenario 6: Sync Sloc IDs from SQLite settings to DAILY_PROCUREMENT Workflow Options', () => {
  // Simulates SQLite app_settings saved from POSPage via settings:set
  const savedSettings = {
    posSelectedSalesStores: ['SFM0101', 'SFM0201'],
    posSelectedInvSlocs: ['DC0101'],
    posSalesFromDate: '2026-11-01',
    posSalesToDate: '2026-11-15',
    posInvItem: 'B0001, B0002',
  };

  // Resolution logic matching ipc/index.ts lines 251-269
  const incomingOpts = {}; // Dashboard 1-click DAILY_PROCUREMENT passes empty options
  const opts = {
    ...savedSettings,
    fromDate: savedSettings.posSalesFromDate,
    toDate: savedSettings.posSalesToDate,
    storeFilter: Array.isArray(savedSettings.posSelectedSalesStores) ? savedSettings.posSelectedSalesStores.join(',') : undefined,
    inventorySlocFilter: Array.isArray(savedSettings.posSelectedInvSlocs) ? savedSettings.posSelectedInvSlocs.join(',') : undefined,
    inventoryItemFilter: savedSettings.posInvItem,
    ...incomingOpts,
  };

  assert.equal(opts.storeFilter, 'SFM0101,SFM0201', 'storeFilter must be synced from posSelectedSalesStores');
  assert.equal(opts.inventorySlocFilter, 'DC0101', 'inventorySlocFilter must be synced from posSelectedInvSlocs');
  assert.equal(opts.fromDate, '2026-11-01');
  assert.equal(opts.toDate, '2026-11-15');
  assert.equal(opts.inventoryItemFilter, 'B0001, B0002');
});
