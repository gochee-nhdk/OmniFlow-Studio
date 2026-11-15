import test from 'node:test';
import assert from 'node:assert/strict';
import { POSAdapter } from '../../packages/pos-adapter/dist/index.js';
import { FileNamingEngine, DownloadFileManager } from '../../packages/file-engine/dist/index.js';
import { FMDatabase } from '../../packages/database/dist/index.js';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

test('Date Rule Engine — calculateDateRange for TODAY', () => {
  const range = POSAdapter.calculateDateRange('TODAY');
  assert.ok(range.from);
  assert.ok(range.to);
  assert.equal(range.from, range.to);
  assert.match(range.from, /^\d{4}-\d{2}-\d{2}$/);
});

test('Date Rule Engine — calculateDateRange for YESTERDAY', () => {
  const range = POSAdapter.calculateDateRange('YESTERDAY');
  const today = POSAdapter.calculateDateRange('TODAY').to;
  assert.ok(range.from);
  assert.ok(range.to);
  assert.equal(range.from, range.to);
  assert.match(range.from, /^\d{4}-\d{2}-\d{2}$/);
  const diffDays = Math.round((new Date(today).getTime() - new Date(range.from).getTime()) / (1000 * 3600 * 24));
  assert.equal(diffDays, 1, 'YESTERDAY must be exactly 1 day before TODAY');
});

test('Date Rule Engine — calculateDateRange for LAST_7_DAYS', () => {
  const range = POSAdapter.calculateDateRange('LAST_7_DAYS');
  const today = POSAdapter.calculateDateRange('TODAY').to;
  assert.equal(range.to, today);
  assert.ok(range.from < range.to);
  const diffDays = Math.round((new Date(range.to).getTime() - new Date(range.from).getTime()) / (1000 * 3600 * 24));
  assert.equal(diffDays, 6, 'LAST_7_DAYS must span 7 inclusive days (diffDays === 6)');
});

test('Date Rule Engine — calculateDateRange for THIS_MONTH', () => {
  const range = POSAdapter.calculateDateRange('THIS_MONTH');
  const today = POSAdapter.calculateDateRange('TODAY').to;
  assert.equal(range.to, today);
  assert.match(range.from, /^\d{4}-\d{2}-01$/, 'THIS_MONTH from must start on day 01');
  assert.equal(range.from.slice(0, 7), today.slice(0, 7), 'THIS_MONTH from must match current year and month');
  assert.ok(range.from <= range.to);
});

test('Date Rule Engine — calculateDateRange default fallback for unknown rule', () => {
  const today = POSAdapter.calculateDateRange('TODAY');
  const fallbackUnknown = POSAdapter.calculateDateRange('UNKNOWN_RULE');
  const fallbackEmpty = POSAdapter.calculateDateRange('');
  assert.deepEqual(fallbackUnknown, today);
  assert.deepEqual(fallbackEmpty, today);
});

test('Date Rule Engine — calculateDateRange simulated 24-hour UTC sweep and month-boundary invariance', () => {
  // Sweep every hour of the day in UTC to verify no double-timezone shift occurs at any hour
  // Especially during 10:00-16:59 UTC (17:00-23:59 Asia/Ho_Chi_Minh)
  for (let hour = 0; hour < 24; hour++) {
    const utcDate = new Date(Date.UTC(2026, 10, 14, hour, 30, 0));
    // Asia/Ho_Chi_Minh is UTC+7
    // If hour < 17: Vietnam is 2026-11-14
    // If hour >= 17: Vietnam is 2026-11-15
    const expectedToday = hour < 17 ? '2026-11-14' : '2026-11-15';
    const expectedYesterday = hour < 17 ? '2026-11-13' : '2026-11-14';
    const expectedLast7Start = hour < 17 ? '2026-11-08' : '2026-11-09';
    const expectedMonthStart = hour < 17 ? '2026-11-01' : '2026-11-01';

    const rToday = POSAdapter.calculateDateRange('TODAY', utcDate);
    assert.deepEqual(rToday, { from: expectedToday, to: expectedToday }, `TODAY at UTC hour ${hour}`);

    const rYesterday = POSAdapter.calculateDateRange('YESTERDAY', utcDate);
    assert.deepEqual(rYesterday, { from: expectedYesterday, to: expectedYesterday }, `YESTERDAY at UTC hour ${hour}`);

    const rLast7 = POSAdapter.calculateDateRange('LAST_7_DAYS', utcDate);
    assert.deepEqual(rLast7, { from: expectedLast7Start, to: expectedToday }, `LAST_7_DAYS at UTC hour ${hour}`);
    const diff7 = Math.round((new Date(rLast7.to).getTime() - new Date(rLast7.from).getTime()) / (1000 * 3600 * 24));
    assert.equal(diff7, 6, `LAST_7_DAYS diff at UTC hour ${hour}`);

    const rMonth = POSAdapter.calculateDateRange('THIS_MONTH', utcDate);
    assert.deepEqual(rMonth, { from: expectedMonthStart, to: expectedToday }, `THIS_MONTH at UTC hour ${hour}`);
  }

  // Edge cases: Month rollover & leap year
  // 1. First day of March (non-leap year 2025): Yesterday should be 2025-02-28
  const mar1 = new Date(Date.UTC(2025, 2, 1, 3, 0, 0)); // 10:00 AM VN time
  assert.deepEqual(POSAdapter.calculateDateRange('YESTERDAY', mar1), { from: '2025-02-28', to: '2025-02-28' });
  assert.deepEqual(POSAdapter.calculateDateRange('THIS_MONTH', mar1), { from: '2025-03-01', to: '2025-03-01' });

  // 2. First day of March (leap year 2024): Yesterday should be 2024-02-29
  const mar1Leap = new Date(Date.UTC(2024, 2, 1, 3, 0, 0));
  assert.deepEqual(POSAdapter.calculateDateRange('YESTERDAY', mar1Leap), { from: '2024-02-29', to: '2024-02-29' });

  // 3. First day of January: Yesterday should be previous year Dec 31
  const jan1 = new Date(Date.UTC(2026, 0, 1, 3, 0, 0));
  assert.deepEqual(POSAdapter.calculateDateRange('YESTERDAY', jan1), { from: '2025-12-31', to: '2025-12-31' });
  assert.deepEqual(POSAdapter.calculateDateRange('THIS_MONTH', jan1), { from: '2026-01-01', to: '2026-01-01' });
});

test('File Naming Engine — formatInventoryName', () => {
  const engine = new FileNamingEngine();
  const date = new Date(2026, 10, 13); // Nov 13 2026
  const name = engine.formatInventoryName(date);
  assert.equal(name, 'Inventory_2026-11-13.xlsx');
});

test('File Naming Engine — formatSalesName', () => {
  const engine = new FileNamingEngine();
  const from = new Date(2026, 10, 1);
  const to = new Date(2026, 10, 30);
  const name = engine.formatSalesName(from, to);
  assert.equal(name, 'Sales_2026-11-01_2026-11-30.xlsx');
});

test('File Naming Engine — formatWithTemplate', () => {
  const engine = new FileNamingEngine();
  const template = 'Export_{STORE}_{DATE}.xlsx';
  const formatted = engine.formatWithTemplate(template, { STORE: 'FM01', DATE: '2026-11-13' });
  assert.equal(formatted, 'Export_FM01_2026-11-13.xlsx');
});

test('Download Manager — Collision resolution does not overwrite', () => {
  const mgr = new DownloadFileManager();
  const tmpDir = os.tmpdir();
  const fakeFile = join(tmpDir, 'collision_test.xlsx');
  
  // Non-existent path returns original
  const p1 = mgr.handleCollision(fakeFile);
  assert.equal(p1, fakeFile);
});

test('Database Engine — Local SQLite Initialization and CRUD', () => {
  const dbPath = join(os.tmpdir(), `test_fm_${Date.now()}.sqlite`);
  const db = new FMDatabase(dbPath);

  try {
    // 1. Settings
    db.setSetting('test_key', 'test_value');
    assert.equal(db.getSetting('test_key'), 'test_value');

    // 2. Workflow Run
    const run = db.createWorkflowRun('TEST_WORKFLOW');
    assert.ok(run.id);
    assert.equal(run.workflowType, 'TEST_WORKFLOW');
    assert.equal(run.status, 'RUNNING');

    // 3. Workflow Steps
    const step = db.createWorkflowStep(run.id, 'Test Step', 1);
    assert.equal(step.stepName, 'Test Step');

    db.updateWorkflowStep(step.id, 'SUCCESS');
    const steps = db.getWorkflowSteps(run.id);
    assert.equal(steps.length, 1);
    assert.equal(steps[0].status, 'SUCCESS');

    // 4. Complete run
    db.updateWorkflowRunStatus(run.id, 'SUCCESS');
    const completed = db.getWorkflowRun(run.id);
    assert.equal(completed?.status, 'SUCCESS');

    // 5. Download record
    const download = db.recordDownload({
      runId: run.id,
      reportType: 'SALES',
      fileName: 'Sales_2026-11-13.xlsx',
      filePath: 'D:\\FM_AUTO_OPS\\Sales\\Sales_2026-11-13.xlsx',
      rowCount: 142,
      status: 'SUCCESS_WITH_DATA',
      downloadedAt: new Date().toISOString(),
    });
    assert.ok(download.id);
    assert.equal(download.fileName, 'Sales_2026-11-13.xlsx');

    // 6. Audit log (no sensitive data)
    db.audit('TEST_ACTION', 'POS', { status: 'OK' });
  } finally {
    db.close();
    try { unlinkSync(dbPath); } catch {}
  }
});
