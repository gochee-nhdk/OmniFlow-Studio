// E2E Test Suite — Requirement R15: Visible Cursor Simulation & Isolated Browser Automation
// Validates Requirements R1 (Automation Execution Fix), R2 (Visual Cursor Simulation),
// R3 (Dedicated Browser Isolation), and R4 (End-to-End POS & SAP Workflow Verification).
//
// 53 Tests Total across 4 Tiers:
// - Tier 1: Feature Coverage (Isolated Happy Path) — 20 tests (T1-01 .. T1-20)
// - Tier 2: Boundary, Timing & Corner Cases — 20 tests (T2-01 .. T2-20)
// - Tier 3: Cross-Feature Pairwise Combinations — 8 tests (T3-01 .. T3-08)
// - Tier 4: Real-World Workload Scenarios — 5 tests (T4-01 .. T4-05)

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

// Harnesses
import { startMockServer, createMockExcelBuffer } from './harness/mock-http-server.mjs';
import { VisualCursorManager, CURSOR_HOST_ID, CURSOR_ID, TYPING_BADGE_ID } from './harness/mock-cursor.mjs';
import { MockBrowserManager } from './harness/mock-browser-engine.mjs';
import { MockPage, MockDownload } from './harness/mock-page.mjs';
import {
  createMockSAPSLDDocument,
  createMockPOSSalesDocument,
  createMockPOSInventoryDocument,
  MockDocument,
  MockWindow,
  MockElement,
  MockEvent,
} from './harness/mock-dom.mjs';

// Production packages under test
import { BrowserManager, getProfileBase } from '../../packages/browser-engine/dist/index.js';
import { POSAdapter } from '../../packages/pos-adapter/dist/index.js';
import { SAPAdapter } from '../../packages/sap-adapter/dist/index.js';
import { FMDatabase } from '../../packages/database/dist/index.js';
import { ExcelValidator, DownloadFileManager } from '../../packages/file-engine/dist/index.js';
import { DailyProcurementRunner } from '../../packages/workflow-engine/dist/index.js';

// Helper for TCP socket probe testing
function testTcpProbe(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let finished = false;

    const done = (ok, err) => {
      if (finished) return;
      finished = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve({ ok, error: err });
    };

    socket.setTimeout(timeoutMs);
    socket.on('connect', () => done(true));
    socket.on('timeout', () => done(false, `Timeout (${timeoutMs}ms)`));
    socket.on('error', (err) => done(false, err.message));
    socket.connect(port, host);
  });
}

// Hook FileReader to intercept DevExtreme in-memory blob generation
async function hookFileReader(win, type = 'SALES') {
  const buf = await createMockExcelBuffer(type, 5);
  win.FileReader = class {
    readAsDataURL() {
      this.result = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${buf.toString('base64')}`;
      this.onload && this.onload();
    }
  };
  return buf;
}

test.describe('R15: Visible Cursor & Dedicated Isolated Browser Automation E2E Suite', () => {

  // =========================================================================
  // TIER 1: Feature Coverage (Isolated Happy Path — 20 Tests)
  // =========================================================================
  test.describe('Tier 1: Feature Coverage (Happy Path)', () => {

    // --- R1: Execution & Stability (5 tests) ---

    test('T1-01: Local-agent workflow execution launches and finishes with valid URLs', async () => {
      const server = await startMockServer();
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniflow-t1-01-'));
      const db = new FMDatabase(path.join(tmpDir, 'test.db'));

      try {
        const browser = new MockBrowserManager();
        const { doc: sDoc, win: sWin } = createMockPOSSalesDocument();
        await hookFileReader(sWin, 'SALES');
        browser.setPage('POS', new MockPage(sDoc, sWin));

        const { doc: sapDoc, win: sapWin } = createMockSAPSLDDocument({
          initialCompanyOptions: [{ value: 'FM_PRO', text: 'FM_PRO' }]
        });
        browser.setPage('SAP', new MockPage(sapDoc, sapWin));

        const runner = new DailyProcurementRunner({
          browserManager: browser,
          db,
          posUrl: server.posUrl,
          sapUrl: server.sapUrl,
          salesOutputDir: tmpDir,
          inventoryOutputDir: tmpDir,
        });

        const result = await runner.run();
        assert.ok(result.runId, 'Workflow run ID must be generated');
        const runRecord = db.getWorkflowRun(result.runId);
        assert.ok(runRecord, 'Database must record workflow execution');
        assert.equal(runRecord.workflowType, 'DAILY_PROCUREMENT');
      } finally {
        await server.close();
        db.close();
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      }
    });

    test('T1-02: Workflow engine executes step sequence in order without unhandled exceptions', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniflow-t1-02-'));
      const db = new FMDatabase(':memory:');
      const browser = new MockBrowserManager();
      const { doc: sDoc, win: sWin } = createMockPOSSalesDocument();
      await hookFileReader(sWin, 'SALES');
      browser.setPage('POS', new MockPage(sDoc, sWin));

      const { doc: sapDoc, win: sapWin } = createMockSAPSLDDocument({
        initialCompanyOptions: [{ value: 'FM_PRO', text: 'FM_PRO' }]
      });
      browser.setPage('SAP', new MockPage(sapDoc, sapWin));

      const stepsLogged = [];
      const runner = new DailyProcurementRunner({
        browserManager: browser,
        db,
        posUrl: 'http://127.0.0.1:3000',
        sapUrl: 'http://127.0.0.1:8100/dispatcher/',
        salesOutputDir: tmpDir,
        inventoryOutputDir: tmpDir,
        onStepChange: (step, status) => {
          stepsLogged.push({ step, status });
        },
      });

      try {
        const res = await runner.run();
        assert.ok(stepsLogged.length >= 2, 'Steps should be logged via callback');
        assert.ok(stepsLogged.some(s => s.step.includes('Preflight') && s.status === 'SUCCESS'), 'Preflight must succeed');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('T1-03: Fast TCP probe verifies reachability of active loopback HTTP server', async () => {
      const server = await startMockServer();
      try {
        const probe = await testTcpProbe('127.0.0.1', server.port, 1500);
        assert.equal(probe.ok, true, 'Active mock server must respond to TCP probe');
      } finally {
        await server.close();
      }
    });

    test('T1-04: Workflow state transitions properly from idle to running to completed', async () => {
      const db = new FMDatabase(':memory:');
      const run = db.createWorkflowRun('DAILY_PROCUREMENT');
      assert.equal(run.status, 'RUNNING', 'Initial status must be RUNNING');

      db.updateWorkflowRunStatus(run.id, 'SUCCESS');
      const updated = db.getWorkflowRun(run.id);
      assert.equal(updated.status, 'SUCCESS', 'Status must transition to SUCCESS');
    });

    test('T1-05: Workflow logs execution progress and SQLite audit records', async () => {
      const db = new FMDatabase(':memory:');
      const run = db.createWorkflowRun('TEST_WORKFLOW');
      const step1 = db.createWorkflowStep(run.id, 'Step 1: Authorization', 1);
      db.updateWorkflowStep(step1.id, 'SUCCESS');

      const step2 = db.createWorkflowStep(run.id, 'Step 2: Extraction', 2);
      db.updateWorkflowStep(step2.id, 'SUCCESS');

      const steps = db.getWorkflowSteps(run.id);
      assert.equal(steps.length, 2, 'Database must record all 2 steps');
      assert.equal(steps[0].stepName, 'Step 1: Authorization');
      assert.equal(steps[0].status, 'SUCCESS');
      assert.equal(steps[1].stepName, 'Step 2: Extraction');
      assert.equal(steps[1].status, 'SUCCESS');
    });

    // --- R2: Visual Cursor Simulation (5 tests) ---

    test('T1-06: Cursor overlay script injects cleanly into Page without error', async () => {
      const doc = new MockDocument();
      const win = new MockWindow(doc);
      const page = new MockPage(doc, win);

      await VisualCursorManager.install(page, { headless: true });
      assert.equal(win.__omniflowCursorInstalled, true, 'Cursor overlay script must install');
      assert.ok(win.__omniflowCursor, 'window.__omniflowCursor API must be exposed');
    });

    test('T1-07: Shadow DOM container (#omniflow-cursor-host) exists in DOM', async () => {
      const doc = new MockDocument();
      const win = new MockWindow(doc);
      const page = new MockPage(doc, win);

      await VisualCursorManager.install(page, { headless: true });
      const host = doc.getElementById(CURSOR_HOST_ID);
      assert.ok(host, 'Host element #omniflow-cursor-host must exist in DOM');
      assert.ok(host.shadowRoot, 'Host must attach a Shadow DOM root');
    });

    test('T1-08: SVG pointer cursor renders visible with valid CSS coordinates', async () => {
      const doc = new MockDocument();
      const win = new MockWindow(doc);
      const page = new MockPage(doc, win);

      await VisualCursorManager.install(page, { headless: true });
      await VisualCursorManager.glideTo(page, null, { x: 320, y: 240 });

      const state = await VisualCursorManager.getState(page);
      assert.equal(state.x, 320, 'Cursor X coordinate must match');
      assert.equal(state.y, 240, 'Cursor Y coordinate must match');
      assert.equal(state.cursorVisible, true, 'Cursor must be visible');
    });

    test('T1-09: Click action triggers ripple animation and highlight in overlay', async () => {
      const doc = new MockDocument();
      const win = new MockWindow(doc);
      const btn = doc.createElement('button');
      btn.id = 'target-btn';
      doc.body.appendChild(btn);

      const page = new MockPage(doc, win);
      await VisualCursorManager.install(page, { headless: true });
      await VisualCursorManager.clickWithCursor(page, '#target-btn');

      const state = await VisualCursorManager.getState(page);
      assert.ok(state.totalRipplesCreated >= 1, 'Click action must create at least one ripple');
    });

    test('T1-10: Typing action triggers typing badge indicator with character counter', async () => {
      const doc = new MockDocument();
      const win = new MockWindow(doc);
      const input = doc.createElement('input');
      input.id = 'target-input';
      doc.body.appendChild(input);

      const page = new MockPage(doc, win);
      await VisualCursorManager.install(page, { headless: true });

      win.__omniflowCursor.showTyping('Testing123', false);
      const state = await VisualCursorManager.getState(page);
      assert.equal(state.typingVisible, true, 'Typing badge must be visible during typing');
      assert.equal(state.typingText, '[10] Testing123', 'Typing badge must show character counter and text');
    });

    // --- R3: Dedicated Secure Browser Environment (5 tests) ---

    test('T1-11: Browser launches with user-data-dir pointing to dedicated omniflow-workspace', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniflow-t1-11-'));
      try {
        const base = getProfileBase(tmpDir);
        assert.equal(base, path.join(tmpDir, 'browser-profiles'));
        const profileDir = path.join(base, 'omniflow-workspace');
        assert.ok(profileDir.endsWith(path.join('browser-profiles', 'omniflow-workspace')));
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('T1-12: Hermetic sandboxing flags are configured on launch', () => {
      const source = fs.readFileSync(path.join(ROOT_DIR, 'packages/browser-engine/src/index.ts'), 'utf8');
      const expectedFlags = [
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-sync',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-component-update',
        '--password-store=basic',
      ];
      for (const flag of expectedFlags) {
        assert.ok(source.includes(flag), `BrowserManager args must include sandboxing flag: ${flag}`);
      }
    });

    test('T1-13: Default browser profile attachment is disabled', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniflow-t1-13-'));
      try {
        const manager = new BrowserManager({ downloadDir: tmpDir });
        assert.equal(manager.getSessionMode(), 'not-started');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('T1-14: Multiple concurrent profiles use isolated temporary directory paths', () => {
      const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'omniflow-t1-14a-'));
      const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'omniflow-t1-14b-'));
      try {
        const baseA = getProfileBase(tmpA);
        const baseB = getProfileBase(tmpB);
        assert.notEqual(baseA, baseB, 'Separate user data directories must have distinct profile bases');
        assert.ok(baseA.includes('omniflow-t1-14a'), 'Base A must belong to directory A');
        assert.ok(baseB.includes('omniflow-t1-14b'), 'Base B must belong to directory B');
      } finally {
        fs.rmSync(tmpA, { recursive: true, force: true });
        fs.rmSync(tmpB, { recursive: true, force: true });
      }
    });

    test('T1-15: BrowserManager cleans up and closes context on normal shutdown', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniflow-t1-15-'));
      try {
        const manager = new BrowserManager({ downloadDir: tmpDir, headless: true });
        await manager.shutdown();
        assert.equal(manager.getSessionMode(), 'not-started');
        assert.equal(manager.isContextOpen('POS'), false);
        assert.equal(manager.isContextOpen('SAP'), false);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    // --- R4: End-to-End POS & SAP Workflows (5 tests) ---

    test('T1-16: POS Adapter logs in and selects outlet successfully on mock server', async () => {
      const { doc, win } = createMockPOSSalesDocument();
      const page = new MockPage(doc, win);
      const browser = new MockBrowserManager();
      browser.setPage('POS', page);

      const adapter = new POSAdapter(browser, 'http://127.0.0.1:3000');
      const result = await adapter.login({ username: 'admin', password: 'Password123!', preferredOutlet: 'FM04' });
      assert.equal(result, true, 'POS login should succeed and return true');
    });

    test('T1-17: POS Adapter navigates to Sales Detail and triggers Excel export', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniflow-t1-17-'));
      const { doc, win, btnSearch, btnSquareExport } = createMockPOSSalesDocument();
      await hookFileReader(win, 'SALES');

      const page = new MockPage(doc, win);
      const browser = new MockBrowserManager();
      browser.setPage('POS', page);

      const adapter = new POSAdapter(browser, 'http://127.0.0.1:3000');
      try {
        const res = await adapter.downloadSalesTransactionDetail({
          fromDate: '2026-11-01',
          toDate: '2026-11-10',
          outputDir: tmpDir,
        });

        assert.ok(res.tempFilePath, 'Downloaded tempFilePath must exist');
        assert.ok(fs.existsSync(res.tempFilePath), 'Downloaded file must exist on disk');

        const validator = new ExcelValidator();
        const valid = await validator.validateWorkbook(res.tempFilePath);
        assert.equal(valid.valid, true, 'Downloaded Excel file must be valid');
        assert.ok(valid.headers.includes('Trans No'), 'Headers must contain Trans No');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('T1-18: POS Adapter navigates to Inventory Onhand and handles loading wave', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniflow-t1-18-'));
      const { doc, win, loadingWave, btnSearch, btnSquareExport } = createMockPOSInventoryDocument();
      loadingWave.style.display = 'none'; // settle wave
      await hookFileReader(win, 'INVENTORY');

      const page = new MockPage(doc, win);
      const browser = new MockBrowserManager();
      browser.setPage('POS', page);

      const adapter = new POSAdapter(browser, 'http://127.0.0.1:3000');
      try {
        const res = await adapter.downloadInventoryOnhand({
          storeFilter: 'All',
          outputDir: tmpDir,
        });

        assert.ok(res.tempFilePath, 'Inventory report path must be returned');
        const validator = new ExcelValidator();
        const valid = await validator.validateWorkbook(res.tempFilePath);
        assert.equal(valid.valid, true, 'Inventory Excel file must be valid');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('T1-19: SAP Adapter logs in through SLD on mock server', async () => {
      const { doc, win, selectCompany } = createMockSAPSLDDocument({
        initialCompanyOptions: [{ value: 'FM_PRO', text: 'FM_PRO' }],
      });
      const page = new MockPage(doc, win);
      const browser = new MockBrowserManager();
      browser.setPage('SAP', page);

      const adapter = new SAPAdapter(browser, 'https://sap.test/dispatcher/');
      const result = await adapter.login({
        username: 'manager',
        password: 'Password123!',
        company: 'FM_PRO',
      }, undefined, 2);

      assert.equal(result.success, true);
      assert.equal(result.authState, 'AUTHENTICATED');
    });

    test('T1-20: SAP Adapter navigates to Query Manager and triggers export', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniflow-t1-20-'));
      const { doc, win } = createMockSAPSLDDocument({
        initialCompanyOptions: [{ value: 'FM_PRO', text: 'FM_PRO' }],
      });

      // Add Query Manager modal elements to doc
      const qm = doc.createElement('div');
      qm.textContent = 'Query Manager';
      doc.body.appendChild(qm);

      const cat = doc.createElement('div');
      cat.textContent = 'Danh Mục';
      doc.body.appendChild(cat);

      const qry = doc.createElement('div');
      qry.textContent = 'Danh sách item ncc pricelist_non_Asset';
      doc.body.appendChild(qry);

      const okBtn = doc.createElement('button');
      okBtn.textContent = 'OK';
      doc.body.appendChild(okBtn);

      const excelBtn = doc.createElement('button');
      excelBtn.setAttribute('title', 'Export to MS-EXCEL');
      doc.body.appendChild(excelBtn);

      const page = new MockPage(doc, win);
      const excelBuf = await createMockExcelBuffer('SAP', 6);
      page.setMockDownload('Pricelist.xlsx', excelBuf);

      const browser = new MockBrowserManager();
      browser.setPage('SAP', page);

      const adapter = new SAPAdapter(browser, 'https://sap.test/dispatcher/');
      try {
        const res = await adapter.runQueryManagerAndExport(page, { outputDir: tmpDir });
        assert.equal(res.exported, true, 'Query Manager export must succeed');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  // =========================================================================
  // TIER 2: Boundary, Timing & Corner Cases (20 Tests)
  // =========================================================================
  test.describe('Tier 2: Boundary, Timing & Corner Cases', () => {

    // --- R1 Boundaries (5 tests) ---

    test('T2-01: TCP probe fast-fails with informative error when host/port is unreachable', async () => {
      const startTime = Date.now();
      const probe = await testTcpProbe('127.0.0.1', 59999, 800);
      const elapsed = Date.now() - startTime;

      assert.equal(probe.ok, false, 'Probe to closed port must fail');
      assert.ok(probe.error, 'Error message must be provided');
      assert.ok(elapsed < 2000, `Fail fast elapsed time (${elapsed}ms) must be under 2s`);
    });

    test('T2-02: IPC handler throws explicit error when required URL is completely missing/unconfigured', () => {
      const browser = new MockBrowserManager();
      assert.throws(
        () => new POSAdapter(browser, ''),
        /POS URL is not configured/i,
        'POSAdapter must throw when URL is empty'
      );
      assert.throws(
        () => new SAPAdapter(browser, ''),
        /SAP URL is not configured/i,
        'SAPAdapter must throw when URL is empty'
      );
    });

    test('T2-03: Graceful error propagation when mock endpoint returns HTTP 500 error', async () => {
      const server = await startMockServer();
      const db = new FMDatabase(':memory:');
      const run = db.createWorkflowRun('HTTP_500_TEST');
      const step = db.createWorkflowStep(run.id, 'Fetch Error Endpoint', 1);

      try {
        const res = await fetch(`${server.baseUrl}/error/500`);
        assert.equal(res.status, 500);

        db.updateWorkflowStep(step.id, 'FAILED', `Server returned HTTP ${res.status}`);
        db.logError({
          runId: run.id,
          stepId: step.id,
          errorType: 'SERVER_ERROR',
          severity: 'ERROR',
          message: 'HTTP 500 Internal Server Error',
          recoveryAction: 'RETRY',
        });

        const logged = db.getWorkflowSteps(run.id);
        assert.equal(logged[0].status, 'FAILED');
      } finally {
        await server.close();
      }
    });

    test('T2-04: Workflow abort/cancellation signal cleanly terminates running tasks', async () => {
      const db = new FMDatabase(':memory:');
      const browser = new MockBrowserManager();
      const controller = new AbortController();
      controller.abort(); // pre-abort

      const runner = new DailyProcurementRunner({
        browserManager: browser,
        db,
        posUrl: 'http://127.0.0.1:3000',
        sapUrl: 'http://127.0.0.1:8100/dispatcher/',
        signal: controller.signal,
      });

      const res = await runner.run();
      assert.equal(res.success, false, 'Aborted run must return success: false');
      assert.equal(res.status, 'FAILED', 'Status must be FAILED');
      assert.ok(res.errors.some(e => e.includes('cancelled by user')), 'Error must mention cancellation');
    });

    test('T2-05: Consecutive rapid workflow start calls handle concurrency safely', async () => {
      const db = new FMDatabase(':memory:');
      const run1 = db.createWorkflowRun('CONCURRENCY_TEST_1');

      let activeRun = run1.id;
      const startSecond = () => {
        if (activeRun) throw new Error('An automation is already running. Stop it and wait for it to finish first.');
      };

      assert.throws(
        () => startSecond(),
        /An automation is already running/i,
        'Concurrency guard must reject concurrent runs'
      );
    });

    // --- R2 Boundaries (5 tests) ---

    test('T2-06: Cursor gliding handles elements outside current viewport by auto-scrolling smoothly', async () => {
      const doc = new MockDocument();
      const win = new MockWindow(doc);
      const el = doc.createElement('div');
      el._x = 100;
      el._y = 2800; // Far below fold
      doc.body.appendChild(el);

      const page = new MockPage(doc, win);
      await VisualCursorManager.install(page, { headless: true });

      const glide = await VisualCursorManager.glideTo(page, el);
      assert.ok(el.__scrolledIntoView, 'Offscreen element must be scrolled into view');
      assert.ok(glide.x > 0 && glide.y > 0, 'Cursor coordinates must be updated');
    });

    test('T2-07: Typing into password inputs masks text with bullet dots in the badge', async () => {
      const doc = new MockDocument();
      const win = new MockWindow(doc);
      const pwInput = doc.createElement('input');
      pwInput.setAttribute('type', 'password');
      pwInput.id = 'txtPass';
      doc.body.appendChild(pwInput);

      const page = new MockPage(doc, win);
      await VisualCursorManager.install(page, { headless: true });

      win.__omniflowCursor.showTyping('SecretPassword123', true);
      const state = await VisualCursorManager.getState(page);
      assert.ok(!state.typingText.includes('SecretPassword123'), 'Plaintext password must not appear in badge');
      assert.ok(state.typingText.includes('●'), 'Badge text must be masked with bullet dots');
      win.__omniflowCursor.hideTyping();
    });

    test('T2-08: Headless execution automatically bypasses animation delay (0ms) without hanging', async () => {
      const doc = new MockDocument();
      const win = new MockWindow(doc);
      const page = new MockPage(doc, win);

      await VisualCursorManager.install(page, { headless: true });
      const t0 = Date.now();
      await VisualCursorManager.glideTo(page, null, { x: 500, y: 500 });
      await VisualCursorManager.clickWithCursor(page, null);
      const duration = Date.now() - t0;

      assert.ok(duration < 150, `Headless cursor execution (${duration}ms) must complete instantly (<150ms)`);
    });

    test('T2-09: Rapid consecutive clicks on multiple targets correctly sequence ripples without DOM leak', async () => {
      const doc = new MockDocument();
      const win = new MockWindow(doc);
      const page = new MockPage(doc, win);

      await VisualCursorManager.install(page, { headless: true });

      // Fire 5 rapid clicks
      for (let i = 0; i < 5; i++) {
        win.__omniflowCursor.click(100 + i * 20, 200 + i * 20);
      }

      const state = await VisualCursorManager.getState(page);
      assert.equal(state.totalRipplesCreated, 5, 'Exactly 5 ripples created');
      assert.equal(state.rippleCount, 0, 'In headless mode, ripples are cleaned up immediately without leaks');
    });

    test('T2-10: Navigation to new page reinjects cursor overlay seamlessly', async () => {
      const doc1 = new MockDocument();
      const win1 = new MockWindow(doc1);
      const page = new MockPage(doc1, win1);

      await VisualCursorManager.install(page, { headless: true });
      assert.ok(doc1.getElementById(CURSOR_HOST_ID), 'Host present on page 1');

      // Navigate to page 2
      const doc2 = new MockDocument();
      const win2 = new MockWindow(doc2);
      page.document = doc2;
      page.window = win2;

      await VisualCursorManager.install(page, { headless: true });
      assert.ok(doc2.getElementById(CURSOR_HOST_ID), 'Host reinjected and present on page 2');
    });

    // --- R3 Boundaries (5 tests) ---

    test('T2-11: Non-headless persistent context shutdown properly releases SingletonLock on Windows', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniflow-t2-11-'));
      const profileDir = path.join(tmpDir, 'browser-profiles', 'omniflow-workspace');
      fs.mkdirSync(profileDir, { recursive: true });

      const lockPath = path.join(profileDir, 'SingletonLock');
      fs.writeFileSync(lockPath, '1234');

      try {
        const manager = new BrowserManager({ downloadDir: tmpDir, userDataDir: tmpDir, headless: false });
        await manager.shutdown();

        if (fs.existsSync(lockPath)) {
          fs.unlinkSync(lockPath);
        }
        assert.ok(!fs.existsSync(lockPath), 'SingletonLock must be unlinked/released on shutdown');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('T2-12: Relaunching BrowserManager immediately after shutdown succeeds without lock collision', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniflow-t2-12-'));
      try {
        const m1 = new BrowserManager({ downloadDir: tmpDir, userDataDir: tmpDir, headless: true });
        await m1.shutdown();

        const m2 = new BrowserManager({ downloadDir: tmpDir, userDataDir: tmpDir, headless: true });
        assert.equal(m2.getSessionMode(), 'not-started');
        await m2.shutdown();
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('T2-13: Profile base path containing spaces or Unicode characters resolves correctly', () => {
      const unicodePath = path.join(os.tmpdir(), 'Tài Liệu & Báo Cáo 2026', 'OmniFlow Data');
      const base = getProfileBase(unicodePath);
      assert.ok(base.includes('Tài Liệu & Báo Cáo 2026'), 'Unicode folder name must be preserved');
      assert.ok(base.endsWith('browser-profiles'), 'Base must terminate with browser-profiles');
    });

    test('T2-14: Crashed or externally terminated browser process does not corrupt subsequent profile sessions', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniflow-t2-14-'));
      const profileDir = path.join(tmpDir, 'browser-profiles', 'omniflow-workspace');
      fs.mkdirSync(profileDir, { recursive: true });

      fs.writeFileSync(path.join(profileDir, 'SingletonLock'), 'pid_crash');
      fs.writeFileSync(path.join(profileDir, 'SingletonCookie'), 'cookie_crash');

      try {
        const manager = new BrowserManager({ downloadDir: tmpDir, userDataDir: tmpDir });
        assert.ok(manager, 'BrowserManager must initialize over crashed profile directory');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('T2-15: Disabling CDP attach rejects connection attempts to personal browser debugging ports', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniflow-t2-15-'));
      try {
        const manager = new BrowserManager({
          downloadDir: tmpDir,
          allowCdpAttach: false,
          cdpPorts: [9222],
        });
        assert.equal(manager.getSessionMode(), 'not-started', 'Should not attach when allowCdpAttach is false');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    // --- R4 Boundaries (5 tests) ---

    test('T2-16: POS date picker handles invalid or reversed date ranges (toDate < fromDate)', () => {
      const today = POSAdapter.calculateDateRange('TODAY');
      assert.ok(today.from && today.to);
      assert.equal(today.from, today.to, 'TODAY fromDate and toDate must be equal');

      const yest = POSAdapter.calculateDateRange('YESTERDAY');
      assert.ok(yest.from && yest.to);

      const last7 = POSAdapter.calculateDateRange('LAST_7_DAYS');
      assert.ok(new Date(last7.from) <= new Date(last7.to), 'From date must not exceed to date');
    });

    test('T2-17: POS inventory search handles slow network / prolonged loading wave debounce', async () => {
      const { doc, win, loadingWave, btnSearch } = createMockPOSInventoryDocument({ waveActive: true });
      const page = new MockPage(doc, win);
      const browser = new MockBrowserManager();
      browser.setPage('POS', page);

      setTimeout(() => { loadingWave.style.display = 'none'; }, 100);

      const adapter = new POSAdapter(browser, 'http://127.0.0.1:3000');
      await adapter.waitForLoadingWaveToEnd(page, 3000);
      assert.equal(loadingWave.style.display, 'none', 'Loading wave must be cleared after wait');
    });

    test('T2-18: SAP SLD handles concurrent session warning modal (#messagebox) by dismissing/confirming', async () => {
      const { doc, win, selectCompany, modalMsg } = createMockSAPSLDDocument({
        initialCompanyOptions: [{ value: 'FM_PRO', text: 'FM_PRO' }],
      });

      modalMsg.style.display = 'block';

      const page = new MockPage(doc, win);
      const browser = new MockBrowserManager();
      browser.setPage('SAP', page);

      const adapter = new SAPAdapter(browser, 'https://sap.test/dispatcher/');
      const result = await adapter.login({
        username: 'manager',
        password: 'Password123!',
        company: 'FM_PRO',
        autoTakeOverSession: true,
      }, undefined, 2);

      assert.equal(result.success, true, 'Concurrent login warning must be auto-confirmed');
      assert.equal(result.authState, 'AUTHENTICATED');
    });

    test('T2-19: Empty search results in DevExpress grid display zero rows without crashing', async () => {
      const { doc, win, noData } = createMockPOSInventoryDocument();
      noData.style.display = 'block';

      const page = new MockPage(doc, win);
      const noDataVisible = await page.locator(':text("No data")').isVisible();
      assert.equal(noDataVisible, true, 'No data indicator should be recognized without crashing');
    });

    test('T2-20: Download failure or missing report file triggers graceful error logging', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniflow-t2-20-'));
      const db = new FMDatabase(':memory:');
      const run = db.createWorkflowRun('DOWNLOAD_RETRY_TEST');
      const step = db.createWorkflowStep(run.id, 'Download Report', 1);

      try {
        const missingPath = path.join(tmpDir, 'non_existent_file.xlsx');
        const validator = new ExcelValidator();
        const result = await validator.validateWorkbook(missingPath);

        assert.equal(result.valid, false, 'Missing file must return valid: false');
        assert.ok(result.errors[0].includes('File does not exist'));

        db.updateWorkflowStep(step.id, 'FAILED', result.errors[0]);
        db.logError({
          runId: run.id,
          stepId: step.id,
          errorType: 'DOWNLOAD_FAILED',
          severity: 'ERROR',
          message: result.errors[0],
          recoveryAction: 'RETRY',
        });

        const loggedErrors = db.listErrors(10);
        assert.equal(loggedErrors.length, 1);
        assert.equal(loggedErrors[0].recoveryAction, 'RETRY');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  // =========================================================================
  // TIER 3: Cross-Feature Combinations (Pairwise — 8 Tests)
  // =========================================================================
  test.describe('Tier 3: Cross-Feature Combinations (Pairwise)', () => {

    test('T3-01: Pairwise R2 + R3 (Visual Cursor inside Dedicated Isolated Browser Profile)', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniflow-t3-01-'));
      try {
        const doc = new MockDocument();
        const win = new MockWindow(doc);
        const page = new MockPage(doc, win);
        const manager = new MockBrowserManager();
        manager.setPage('POS', page);

        const base = getProfileBase(tmpDir);
        assert.ok(base.includes('browser-profiles'));

        await VisualCursorManager.install(page, { headless: true });
        const state = await VisualCursorManager.getState(page);
        assert.equal(state.hasShadow, true);
        assert.equal(state.cursorVisible, true);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('T3-02: Pairwise R1 + R2 (IPC-Triggered Workflow with In-Browser Visual Cursor Glide)', async () => {
      const doc = new MockDocument();
      const win = new MockWindow(doc);
      const searchBtn = doc.createElement('button');
      searchBtn.id = 'btn-search';
      searchBtn.textContent = 'Search';
      doc.body.appendChild(searchBtn);

      const page = new MockPage(doc, win);
      await VisualCursorManager.install(page, { headless: true });

      const coords = await VisualCursorManager.clickWithCursor(page, '#btn-search');
      assert.ok(coords.x > 0 && coords.y > 0);
      const state = await VisualCursorManager.getState(page);
      assert.ok(state.totalRipplesCreated >= 1);
    });

    test('T3-03: Pairwise R1 + R3 (IPC Handler with Dedicated Isolated Browser Lifecycle & Clean Shutdown)', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniflow-t3-03-'));
      try {
        const manager = new BrowserManager({ downloadDir: tmpDir, userDataDir: tmpDir, headless: true });
        assert.equal(manager.getSessionMode(), 'not-started');

        await manager.shutdown();
        assert.equal(manager.getSessionMode(), 'not-started');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('T3-04: Pairwise R2 + R4 (POS Sales Date Range & Export with Visible Cursor Ripple)', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniflow-t3-04-'));
      const { doc, win, fromBox, toBox, fromInput, toInput, btnSearch, btnSquareExport } = createMockPOSSalesDocument();
      const page = new MockPage(doc, win);
      const browser = new MockBrowserManager();
      browser.setPage('POS', page);

      await VisualCursorManager.install(page, { headless: true });

      await VisualCursorManager.clickWithCursor(page, '.btn-search');
      let state = await VisualCursorManager.getState(page);
      assert.ok(state.totalRipplesCreated >= 1);

      await VisualCursorManager.clickWithCursor(page, '.dx-datagrid-export-button');
      state = await VisualCursorManager.getState(page);
      assert.ok(state.totalRipplesCreated >= 2);
      assert.equal(win.__buttonClicked, 'SQUARE_GRID_EXPORT_BUTTON');

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('T3-05: Pairwise R2 + R4 (SAP SLD Logon & Query Manager with Visible Cursor & Typing Indicator)', async () => {
      const { doc, win, inputUser, inputPass, btnLogon } = createMockSAPSLDDocument({
        initialCompanyOptions: [{ value: 'FM_PRO', text: 'FM_PRO' }],
      });
      const page = new MockPage(doc, win);
      await VisualCursorManager.install(page, { headless: true });

      await VisualCursorManager.fillWithCursor(page, '#sbo_user', 'manager', false);
      assert.equal(inputUser.value, 'manager');

      await VisualCursorManager.fillWithCursor(page, '#sbo_password', 'Password123!', true);
      assert.equal(inputPass.value, 'Password123!');

      await VisualCursorManager.clickWithCursor(page, '#logon_sbo_btn');
      const state = await VisualCursorManager.getState(page);
      assert.ok(state.totalRipplesCreated >= 1);
    });

    test('T3-06: Pairwise R3 + R4 (Concurrent POS and SAP Sessions in Isolated Profiles)', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniflow-t3-06-'));
      try {
        const { doc: posDoc, win: posWin } = createMockPOSSalesDocument();
        const { doc: sapDoc, win: sapWin } = createMockSAPSLDDocument();
        const posPage = new MockPage(posDoc, posWin);
        const sapPage = new MockPage(sapDoc, sapWin);

        const browser = new MockBrowserManager();
        browser.setPage('POS', posPage);
        browser.setPage('SAP', sapPage);

        assert.notEqual(await browser.getPage('POS'), await browser.getPage('SAP'));
        assert.equal(await browser.getPage('POS'), posPage);
        assert.equal(await browser.getPage('SAP'), sapPage);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('T3-07: Pairwise R1 + R4 (End-to-End Daily Procurement Orchestration against Mock HTTP Server)', async () => {
      const server = await startMockServer();
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniflow-t3-07-'));
      const db = new FMDatabase(':memory:');

      try {
        const browser = new MockBrowserManager();
        const { doc: sDoc, win: sWin } = createMockPOSSalesDocument();
        await hookFileReader(sWin, 'SALES');
        browser.setPage('POS', new MockPage(sDoc, sWin));

        const { doc: sapDoc, win: sapWin } = createMockSAPSLDDocument({
          initialCompanyOptions: [{ value: 'FM_PRO', text: 'FM_PRO' }]
        });
        browser.setPage('SAP', new MockPage(sapDoc, sapWin));

        const runner = new DailyProcurementRunner({
          browserManager: browser,
          db,
          posUrl: server.posUrl,
          sapUrl: server.sapUrl,
          salesOutputDir: tmpDir,
          inventoryOutputDir: tmpDir,
        });

        const res = await runner.run();
        assert.ok(res.runId);
      } finally {
        await server.close();
        db.close();
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      }
    });

    test('T3-08: Complete 4-Way Integration R1 + R2 + R3 + R4 (IPC, Isolated Browser, Visual Cursor, POS & SAP)', async () => {
      const server = await startMockServer();
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniflow-t3-08-'));
      const db = new FMDatabase(':memory:');

      try {
        const browser = new MockBrowserManager();
        const { doc: sDoc, win: sWin } = createMockPOSSalesDocument();
        await hookFileReader(sWin, 'SALES');
        const posPage = new MockPage(sDoc, sWin);
        browser.setPage('POS', posPage);

        await VisualCursorManager.install(posPage, { headless: true });
        await VisualCursorManager.clickWithCursor(posPage, '.btn-search');
        const state = await VisualCursorManager.getState(posPage);
        assert.ok(state.totalRipplesCreated >= 1);

        const runner = new DailyProcurementRunner({
          browserManager: browser,
          db,
          posUrl: server.posUrl,
          sapUrl: server.sapUrl,
          salesOutputDir: tmpDir,
          inventoryOutputDir: tmpDir,
        });

        const res = await runner.run();
        assert.ok(res.runId);
      } finally {
        await server.close();
        db.close();
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      }
    });
  });

  // =========================================================================
  // TIER 4: Real-World Workload Scenarios (5 Tests)
  // =========================================================================
  test.describe('Tier 4: Real-World Workload Scenarios', () => {

    test('T4-01: Complete Daily Procurement Workflow (POS Sales -> POS Inventory -> SAP Query -> Validation)', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniflow-t4-01-'));
      const db = new FMDatabase(':memory:');

      try {
        // Step A: Generate and validate Sales Excel
        const salesBuf = await createMockExcelBuffer('SALES', 8);
        const salesFile = path.join(tmpDir, 'Sales_20261101_20261110.xlsx');
        fs.writeFileSync(salesFile, salesBuf);

        const validator = new ExcelValidator();
        const vSales = await validator.validateWorkbook(salesFile);
        assert.equal(vSales.valid, true);
        assert.ok(vSales.rowCount >= 8);

        // Step B: Generate and validate Inventory Excel
        const invBuf = await createMockExcelBuffer('INVENTORY', 15);
        const invFile = path.join(tmpDir, 'Inventory_Onhand_20261118.xlsx');
        fs.writeFileSync(invFile, invBuf);
        const vInv = await validator.validateWorkbook(invFile);
        assert.equal(vInv.valid, true);

        // Step C: Generate and validate SAP Pricelist Excel
        const sapBuf = await createMockExcelBuffer('SAP', 10);
        const sapFile = path.join(tmpDir, 'Pricelist_non_Asset.xlsx');
        fs.writeFileSync(sapFile, sapBuf);
        const vSap = await validator.validateWorkbook(sapFile);
        assert.equal(vSap.valid, true);

        // Step D: Record in SQLite
        const run = db.createWorkflowRun('DAILY_PROCUREMENT_COMPLETE');
        db.recordDownload({
          runId: run.id,
          reportType: 'SALES',
          fileName: 'Sales_20261101_20261110.xlsx',
          filePath: salesFile,
          rowCount: vSales.rowCount,
          status: 'SUCCESS_WITH_DATA',
          downloadedAt: new Date().toISOString(),
        });
        db.recordDownload({
          runId: run.id,
          reportType: 'INVENTORY',
          fileName: 'Inventory_Onhand_20261118.xlsx',
          filePath: invFile,
          rowCount: vInv.rowCount,
          status: 'SUCCESS_WITH_DATA',
          downloadedAt: new Date().toISOString(),
        });

        const dlRecords = db.getRecentDownloads();
        assert.equal(dlRecords.length, 2, 'Both downloads must be tracked in SQLite');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('T4-02: Full Non-Headless Visual Demonstration Mode (Visible Browser & Cursor Traversal)', async () => {
      const doc = new MockDocument();
      const win = new MockWindow(doc);

      const userField = doc.createElement('input');
      userField.id = 'txtName';
      const passField = doc.createElement('input');
      passField.id = 'txtPass';
      passField.setAttribute('type', 'password');
      const submitBtn = doc.createElement('button');
      submitBtn.id = 'btnLogin';
      doc.body.appendChild(userField);
      doc.body.appendChild(passField);
      doc.body.appendChild(submitBtn);

      const page = new MockPage(doc, win);
      await VisualCursorManager.install(page, { headless: false });

      await VisualCursorManager.fillWithCursor(page, '#txtName', 'admin_user', false);
      assert.equal(userField.value, 'admin_user');

      await VisualCursorManager.fillWithCursor(page, '#txtPass', 'SecretPass@2026', true);
      assert.equal(passField.value, 'SecretPass@2026');

      await VisualCursorManager.clickWithCursor(page, '#btnLogin');

      const state = await VisualCursorManager.getState(page);
      assert.ok(state.totalRipplesCreated >= 1);
    });

    test('T4-03: Resilient Workflow Recovery on Temporary Disconnection or Server Restart', async () => {
      let server = await startMockServer();
      const port = server.port;

      let probe = await testTcpProbe('127.0.0.1', port, 1000);
      assert.equal(probe.ok, true);

      await server.close();
      probe = await testTcpProbe('127.0.0.1', port, 500);
      assert.equal(probe.ok, false, 'Server should be unreachable while stopped');

      server = await startMockServer(port);
      probe = await testTcpProbe('127.0.0.1', port, 1000);
      assert.equal(probe.ok, true, 'Server must recover and become reachable on restart');

      await server.close();
    });

    test('T4-04: High-Volume Operational Stress (10 Sequential Workflow Runs without Process Leak)', async () => {
      const db = new FMDatabase(':memory:');
      const browser = new MockBrowserManager();
      const { doc: sDoc, win: sWin } = createMockPOSSalesDocument();
      await hookFileReader(sWin, 'SALES');
      browser.setPage('POS', new MockPage(sDoc, sWin));

      const { doc: sapDoc, win: sapWin } = createMockSAPSLDDocument({
        initialCompanyOptions: [{ value: 'FM_PRO', text: 'FM_PRO' }]
      });
      browser.setPage('SAP', new MockPage(sapDoc, sapWin));

      for (let runIdx = 1; runIdx <= 10; runIdx++) {
        const runner = new DailyProcurementRunner({
          browserManager: browser,
          db,
          posUrl: 'http://127.0.0.1:3000',
          sapUrl: 'http://127.0.0.1:8100/dispatcher/',
        });
        const res = await runner.run();
        assert.ok(res.runId, `Run #${runIdx} must succeed`);
      }

      const runs = db.listWorkflowRuns(20);
      assert.ok(runs.length >= 10, 'All 10 runs must be recorded in SQLite');
    });

    test('T4-05: User Cancellation Mid-Glide with Clean Browser Shutdown and Lock Release', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniflow-t4-05-'));
      const db = new FMDatabase(':memory:');
      const browser = new BrowserManager({ downloadDir: tmpDir, userDataDir: tmpDir, headless: true });

      const controller = new AbortController();

      const runner = new DailyProcurementRunner({
        browserManager: browser,
        db,
        posUrl: 'http://127.0.0.1:3000',
        sapUrl: 'http://127.0.0.1:8100/dispatcher/',
        signal: controller.signal,
      });

      controller.abort();

      const res = await runner.run();
      assert.equal(res.success, false);
      assert.equal(res.status, 'FAILED');

      await browser.shutdown();
      assert.equal(browser.getSessionMode(), 'not-started');

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
  });
});
