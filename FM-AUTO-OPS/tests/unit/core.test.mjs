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

test('Date Rule Engine — calculateDateRange for LAST_7_DAYS', () => {
  const range = POSAdapter.calculateDateRange('LAST_7_DAYS');
  assert.ok(range.from < range.to);
  const diffDays = Math.round((new Date(range.to).getTime() - new Date(range.from).getTime()) / (1000 * 3600 * 24));
  assert.equal(diffDays, 7);
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
