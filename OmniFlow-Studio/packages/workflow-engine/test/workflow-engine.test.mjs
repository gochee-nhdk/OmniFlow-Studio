import test from 'node:test';
import assert from 'node:assert/strict';
import { DailyProcurementRunner, getDefaultReportsDir } from '../dist/index.js';
import { FMDatabase } from '@fm/database';
import { resolveNamingTemplate } from '@fm/file-engine';
import { POSAdapter } from '@fm/pos-adapter';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

function createTempDb() {
  const dbPath = path.join(os.tmpdir(), `test-wf-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  const db = new FMDatabase(dbPath);
  const cleanup = () => {
    try {
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
      const wal = dbPath + '-wal';
      const shm = dbPath + '-shm';
      if (fs.existsSync(wal)) fs.unlinkSync(wal);
      if (fs.existsSync(shm)) fs.unlinkSync(shm);
    } catch {}
  };
  return { db, dbPath, cleanup };
}

function createMockBrowserManager() {
  return {
    getPage: async (profile) => ({
      url: () => 'https://172.16.1.210:8100/dispatcher/',
      goto: async () => {},
      evaluate: async () => ({}),
      bringToFront: async () => {},
      waitForSelector: async () => true,
      locator: () => ({
        count: async () => 1,
        first: () => ({ isVisible: async () => true }),
      }),
      on: () => {},
      isClosed: () => false,
    }),
    getContext: async () => ({
      pages: () => [],
      newPage: async () => ({}),
    }),
    closeAll: async () => {},
    shutdown: async () => {},
    setAllowCdpAttach: () => {},
  };
}

test('WE-01: getDefaultReportsDir generates valid directory paths', () => {
  const base = getDefaultReportsDir();
  assert.ok(base.includes('reports'), 'Base reports dir must contain reports');
  const salesDir = getDefaultReportsDir('Sales');
  assert.ok(salesDir.endsWith(path.join('reports', 'Sales')), 'Sales subdir must be nested');
  const invDir = getDefaultReportsDir('Inventory');
  assert.ok(invDir.endsWith(path.join('reports', 'Inventory')), 'Inventory subdir must be nested');
});

test('WE-02: File template token resolution with {{fromDate}}, {{toDate}}, {{timestamp}}', () => {
  const resolvedSales = resolveNamingTemplate('Sales_{{fromDate}}_{{toDate}}.xlsx', {
    fromDate: '2026-11-01',
    toDate: '2026-11-18',
  });
  assert.equal(resolvedSales, 'Sales_2026-11-01_2026-11-18.xlsx');

  const resolvedInv = resolveNamingTemplate('Inventory_Onhand_{{timestamp}}.xlsx', {
    timestamp: '20261118_120000',
  });
  assert.equal(resolvedInv, 'Inventory_Onhand_20261118_120000.xlsx');
});

test('WE-03: DailyProcurementRunner aborts immediately when signal is pre-aborted', async () => {
  const { db, cleanup } = createTempDb();
  const mockBm = createMockBrowserManager();
  const controller = new AbortController();
  controller.abort();

  const runner = new DailyProcurementRunner({
    browserManager: mockBm,
    db,
    signal: controller.signal,
  });

  const result = await runner.run();
  assert.equal(result.success, false);
  assert.equal(result.status, 'FAILED');
  assert.ok(result.errors.some((e) => e.includes('cancelled by user')));

  // Verify that an error was logged to the database
  const errors = db.listErrors(10);
  assert.ok(errors.length > 0, 'Database must record critical failure');
  assert.equal(errors[0].severity, 'CRITICAL');

  cleanup();
});

test('WE-04: DailyProcurementRunner accepts credentials and enterprise options', async () => {
  const { db, cleanup } = createTempDb();
  const mockBm = createMockBrowserManager();
  const stepChanges = [];

  const runner = new DailyProcurementRunner({
    browserManager: mockBm,
    db,
    posUrl: 'http://127.0.0.1:9999/home',
    posCredentials: {
      username: 'pos_test_user',
      password: 'pos_test_password',
    },
    sapCredentials: {
      username: 'sap_test_user',
      password: 'sap_test_password',
      server: '172.16.1.210',
      company: 'TEST_COMPANY',
    },
    orgCode: 'FM_STORE_01',
    dateRangeRule: 'LAST_7_DAYS',
    onStepChange: (name, status, err) => {
      stepChanges.push({ name, status, err });
    },
  });

  assert.ok(runner, 'Runner initialized successfully with credentials');
  cleanup();
});

test('WE-05: Step catches log errors to SQLite error table via db.logError', async () => {
  const { db, cleanup } = createTempDb();
  const mockBm = createMockBrowserManager();

  // Point to unreachable localhost port so POS step fails
  const runner = new DailyProcurementRunner({
    browserManager: mockBm,
    db,
    posUrl: 'http://127.0.0.1:54321/home',
    sapUrl: 'https://127.0.0.1:54321/dispatcher/',
  });

  const result = await runner.run();
  assert.equal(result.success, false);
  assert.equal(result.status, 'FAILED');
  assert.ok(result.errors.length > 0, 'Errors must be populated');

  // Verify errors were logged to the error table
  const dbErrors = db.listErrors(50);
  assert.ok(dbErrors.length > 0, 'Step catches must write to error log table in SQLite');
  assert.ok(dbErrors.some((e) => e.errorType === 'DOWNLOAD_FAILED' || e.errorType === 'AUTH_ERROR'));

  cleanup();
});

test('WE-06: Date range calculation handles dynamic rules', () => {
  const today = POSAdapter.calculateDateRange('TODAY');
  assert.ok(today.from && today.to);

  const last7 = POSAdapter.calculateDateRange('LAST_7_DAYS');
  assert.ok(last7.from < last7.to);

  const yesterday = POSAdapter.calculateDateRange('YESTERDAY');
  assert.ok(yesterday.from <= yesterday.to);
});
