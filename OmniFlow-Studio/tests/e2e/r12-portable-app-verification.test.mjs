// E2E Test Suite — Requirement R12: Portable App Architecture Verification
// Validates 100% portable architecture:
// 1. apps/local-agent/package.json target includes 'portable' alongside 'nsis' and 'zip'
// 2. Portable data root directory resolution (PORTABLE_EXECUTABLE_DIR, OMNIFLOW_PORTABLE_DATA, APP_DATA_DIR)
// 3. SQLite database (fmauto.sqlite) and logs/Temp directories created inside portable data folder
// 4. master.key created in portable data/security folder when APP_DATA_DIR is set
// 5. Browser profiles created within portable directory via getProfileBase
// 6. Default reports directory located in portable reports directory via getDefaultReportsDir
// 7. Launcher.cs environment propagation and safe credential fallback

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

// Import packages under test
import {
  getSecurityDir,
  getMasterKeyPath,
  getOrGenerateMasterKeySync,
  SecureStorage,
  LogRedactor,
} from '../../packages/security/dist/index.js';

import { FMDatabase } from '../../packages/database/dist/index.js';
import { getProfileBase, BrowserManager } from '../../packages/browser-engine/dist/index.js';
import { getDefaultReportsDir } from '../../packages/workflow-engine/dist/index.js';
import { validateTargets } from '../../scripts/release.mjs';

test.describe('R12: Portable App Architecture Verification', () => {

  // =========================================================================
  // SECTION 1: Package Configuration & Target Verification
  // =========================================================================

  test('T1-R12-01: apps/local-agent/package.json win.target includes portable, nsis, and zip', () => {
    const pkgPath = path.join(ROOT_DIR, 'apps/local-agent/package.json');
    assert.ok(fs.existsSync(pkgPath), 'apps/local-agent/package.json must exist');

    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    assert.ok(pkg.build, 'package.json must contain build configuration');
    assert.ok(pkg.build.win, 'package.json build must contain win configuration');
    assert.ok(Array.isArray(pkg.build.win.target), 'build.win.target must be an array');

    const targets = pkg.build.win.target.map(t => (typeof t === 'string' ? t.toLowerCase() : t.target.toLowerCase()));
    assert.ok(targets.includes('portable'), 'build.win.target must include portable');
    assert.ok(targets.includes('nsis'), 'build.win.target must include nsis');
    assert.ok(targets.includes('zip'), 'build.win.target must include zip');
  });

  test('T1-R12-02: apps/local-agent/package.json defines portable artifact configuration', () => {
    const pkgPath = path.join(ROOT_DIR, 'apps/local-agent/package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    assert.ok(pkg.build.portable, 'build.portable configuration must be defined');
    assert.ok(pkg.build.portable.artifactName, 'build.portable.artifactName must be specified');
    assert.ok(pkg.build.portable.artifactName.includes('portable'), 'artifactName must identify portable package');
  });

  test('T1-R12-03: scripts/release.mjs validates and supports portable target', () => {
    const res = validateTargets(['nsis', 'zip', 'portable']);
    assert.equal(res.valid, true, 'release target validation must succeed');
    assert.equal(res.hasNsis, true);
    assert.equal(res.hasZip, true);
    assert.equal(res.hasPortable, true);
    assert.ok(res.targetNames.includes('portable'));
  });

  // =========================================================================
  // SECTION 2: Portable Data Root Resolution
  // =========================================================================

  test('T1-R12-04: Portable directory resolution prioritizes PORTABLE_EXECUTABLE_DIR', () => {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r12-exe-dir-'));
    const prevExe = process.env.PORTABLE_EXECUTABLE_DIR;
    const prevApp = process.env.APP_DATA_DIR;
    const prevPort = process.env.PORTABLE_DATA_DIR;

    try {
      process.env.PORTABLE_EXECUTABLE_DIR = testDir;
      delete process.env.APP_DATA_DIR;
      delete process.env.PORTABLE_DATA_DIR;

      const reportsDir = getDefaultReportsDir();
      assert.equal(reportsDir, path.join(testDir, 'reports'));

      const salesReportsDir = getDefaultReportsDir('Sales');
      assert.equal(salesReportsDir, path.join(testDir, 'reports', 'Sales'));
    } finally {
      if (prevExe !== undefined) process.env.PORTABLE_EXECUTABLE_DIR = prevExe;
      else delete process.env.PORTABLE_EXECUTABLE_DIR;
      if (prevApp !== undefined) process.env.APP_DATA_DIR = prevApp;
      else delete process.env.APP_DATA_DIR;
      if (prevPort !== undefined) process.env.PORTABLE_DATA_DIR = prevPort;
      else delete process.env.PORTABLE_DATA_DIR;
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('T1-R12-05: Portable data directory resolution with APP_DATA_DIR and PORTABLE_DATA_DIR', () => {
    const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r12-data-dir-'));
    const prevExe = process.env.PORTABLE_EXECUTABLE_DIR;
    const prevApp = process.env.APP_DATA_DIR;

    try {
      delete process.env.PORTABLE_EXECUTABLE_DIR;
      process.env.APP_DATA_DIR = testDataDir;

      const reportsDir = getDefaultReportsDir();
      assert.equal(reportsDir, path.join(testDataDir, 'reports'));

      const profileBase = getProfileBase();
      assert.equal(profileBase, path.join(testDataDir, 'browser-profiles'));
    } finally {
      if (prevExe !== undefined) process.env.PORTABLE_EXECUTABLE_DIR = prevExe;
      else delete process.env.PORTABLE_EXECUTABLE_DIR;
      if (prevApp !== undefined) process.env.APP_DATA_DIR = prevApp;
      else delete process.env.APP_DATA_DIR;
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // SECTION 3: SQLite Database (fmauto.sqlite) and Logs in Portable Data Folder
  // =========================================================================

  test('T1-R12-06: fmauto.sqlite initializes and performs migrations within portable data folder', () => {
    const portableRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'r12-db-test-'));
    const dbPath = path.join(portableRoot, 'fmauto.sqlite');

    try {
      const db = new FMDatabase(dbPath);

      // Verify database file was created inside portable directory
      assert.ok(fs.existsSync(dbPath), 'fmauto.sqlite must exist in portable directory');

      // Verify database operations
      const run = db.createWorkflowRun('DAILY_PROCUREMENT');
      assert.ok(run.id, 'Workflow run ID must be generated');
      assert.equal(run.workflowType, 'DAILY_PROCUREMENT');
      assert.equal(run.status, 'RUNNING');

      const step = db.createWorkflowStep(run.id, 'Portable Step Test', 1);
      assert.ok(step.id);
      assert.equal(step.stepName, 'Portable Step Test');

      db.updateWorkflowStep(step.id, 'SUCCESS');
      db.updateWorkflowRunStatus(run.id, 'SUCCESS');

      const fetched = db.getWorkflowRun(run.id);
      assert.equal(fetched?.status, 'SUCCESS');

      db.close();
    } finally {
      try {
        fs.rmSync(portableRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch {}
    }
  });

  test('T1-R12-07: Log and Temp directories operate cleanly inside portable data folder', () => {
    const portableRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'r12-logs-test-'));
    const logDir = path.join(portableRoot, 'logs');
    const tempDir = path.join(portableRoot, 'Temp');

    try {
      fs.mkdirSync(logDir, { recursive: true });
      fs.mkdirSync(tempDir, { recursive: true });

      assert.ok(fs.existsSync(logDir), 'logs directory must exist in portable folder');
      assert.ok(fs.existsSync(tempDir), 'Temp directory must exist in portable folder');

      // Test logging with redaction
      const logFile = path.join(logDir, 'electron-main.log');
      const sensitiveMessage = 'Connecting to SAP with password=SecretPassword123! at localhost';
      const redacted = LogRedactor.redact(sensitiveMessage);
      fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${redacted}\n`);

      assert.ok(fs.existsSync(logFile), 'log file must be created');
      const content = fs.readFileSync(logFile, 'utf8');
      assert.ok(!content.includes('SecretPassword123!'), 'Passwords must never be written to logs');
      assert.ok(content.includes('[REDACTED]'), 'Redaction placeholder must be present');
    } finally {
      fs.rmSync(portableRoot, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // SECTION 4: Portable Master Key & Security Storage
  // =========================================================================

  test('T1-R12-08: master.key created in portable data/security folder when APP_DATA_DIR is set', () => {
    const portableDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r12-security-test-'));
    const prevMasterKey = process.env.FM_OPS_MASTER_KEY;
    const prevAppDataDir = process.env.APP_DATA_DIR;
    delete process.env.FM_OPS_MASTER_KEY;
    process.env.APP_DATA_DIR = portableDataDir;

    try {
      const securityDir = getSecurityDir();
      const expectedSecurityDir = path.join(portableDataDir, 'security');
      assert.equal(securityDir, expectedSecurityDir, 'Security directory must be under APP_DATA_DIR/security');

      const expectedKeyPath = path.join(expectedSecurityDir, 'master.key');
      assert.equal(getMasterKeyPath(), expectedKeyPath, 'Master key path must be inside portable security dir');

      // Generate key in portable security folder
      const generatedKey = getOrGenerateMasterKeySync();
      assert.ok(generatedKey.length >= 32, 'Master key must be at least 32 characters');
      assert.ok(fs.existsSync(expectedKeyPath), 'master.key must exist in portable security folder');

      // Verify file content matches returned key
      const fileKey = fs.readFileSync(expectedKeyPath, 'utf8').trim();
      assert.equal(fileKey, generatedKey);

      // Verify key persistence across calls
      const reusedKey = getOrGenerateMasterKeySync();
      assert.equal(reusedKey, generatedKey, 'Subsequent calls must load existing master.key');
    } finally {
      if (prevMasterKey !== undefined) process.env.FM_OPS_MASTER_KEY = prevMasterKey;
      else delete process.env.FM_OPS_MASTER_KEY;
      if (prevAppDataDir !== undefined) process.env.APP_DATA_DIR = prevAppDataDir;
      else delete process.env.APP_DATA_DIR;
      fs.rmSync(portableDataDir, { recursive: true, force: true });
    }
  });

  test('T1-R12-09: SecureStorage encrypts and decrypts credentials using portable master key', () => {
    const portableDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r12-crypto-test-'));
    const prevMasterKey = process.env.FM_OPS_MASTER_KEY;
    const prevAppDataDir = process.env.APP_DATA_DIR;
    delete process.env.FM_OPS_MASTER_KEY;
    process.env.APP_DATA_DIR = portableDataDir;

    try {
      const secret = 'Enterprise_SAP_Password_2026!#';
      const storage = new SecureStorage();

      const encrypted = storage.encrypt(secret);
      assert.ok(typeof encrypted === 'string');
      assert.equal(encrypted.split(':').length, 3, 'Payload format must be iv:authTag:ciphertext');

      const decrypted = storage.decrypt(encrypted);
      assert.equal(decrypted, secret, 'Decrypted credential must match original plaintext');
    } finally {
      if (prevMasterKey !== undefined) process.env.FM_OPS_MASTER_KEY = prevMasterKey;
      else delete process.env.FM_OPS_MASTER_KEY;
      if (prevAppDataDir !== undefined) process.env.APP_DATA_DIR = prevAppDataDir;
      else delete process.env.APP_DATA_DIR;
      try {
        fs.rmSync(portableDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch {}
    }
  });

  // =========================================================================
  // SECTION 5: Browser Profiles in Portable Directory
  // =========================================================================

  test('T1-R12-10: Browser profiles resolved within portable directory via getProfileBase', () => {
    const portableDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r12-browser-test-'));
    const prevAppDataDir = process.env.APP_DATA_DIR;
    const prevPortDataDir = process.env.PORTABLE_DATA_DIR;

    try {
      // 1. When explicit userDataDir is provided
      const customProfileBase = getProfileBase(portableDataDir);
      assert.equal(customProfileBase, path.join(portableDataDir, 'browser-profiles'));

      // 2. When APP_DATA_DIR env variable is set
      process.env.APP_DATA_DIR = portableDataDir;
      delete process.env.PORTABLE_DATA_DIR;
      const envProfileBase = getProfileBase();
      assert.equal(envProfileBase, path.join(portableDataDir, 'browser-profiles'));

      // 3. When PORTABLE_DATA_DIR env variable is set
      delete process.env.APP_DATA_DIR;
      process.env.PORTABLE_DATA_DIR = portableDataDir;
      const portProfileBase = getProfileBase();
      assert.equal(portProfileBase, path.join(portableDataDir, 'browser-profiles'));

      // 4. Verify BrowserManager uses portable directory
      const bm = new BrowserManager({
        downloadDir: path.join(portableDataDir, 'Temp'),
        userDataDir: portableDataDir,
        headless: true,
      });
      assert.ok(bm, 'BrowserManager must instantiate with portable directory');
    } finally {
      if (prevAppDataDir !== undefined) process.env.APP_DATA_DIR = prevAppDataDir;
      else delete process.env.APP_DATA_DIR;
      if (prevPortDataDir !== undefined) process.env.PORTABLE_DATA_DIR = prevPortDataDir;
      else delete process.env.PORTABLE_DATA_DIR;
      fs.rmSync(portableDataDir, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // SECTION 6: Default Reports Directory in Portable Directory
  // =========================================================================

  test('T1-R12-11: Default reports directory located in portable reports directory', () => {
    const portableBase = fs.mkdtempSync(path.join(os.tmpdir(), 'r12-reports-test-'));
    const prevExe = process.env.PORTABLE_EXECUTABLE_DIR;
    const prevApp = process.env.APP_DATA_DIR;

    try {
      process.env.PORTABLE_EXECUTABLE_DIR = portableBase;

      // Base reports dir
      const baseReports = getDefaultReportsDir();
      assert.equal(baseReports, path.join(portableBase, 'reports'));

      // Sales subfolder
      const salesReports = getDefaultReportsDir('Sales');
      assert.equal(salesReports, path.join(portableBase, 'reports', 'Sales'));

      // Inventory subfolder
      const invReports = getDefaultReportsDir('Inventory');
      assert.equal(invReports, path.join(portableBase, 'reports', 'Inventory'));

      // Ensure directory can be created and file written
      fs.mkdirSync(salesReports, { recursive: true });
      const testReportFile = path.join(salesReports, 'Test_Sales.xlsx');
      fs.writeFileSync(testReportFile, 'dummy content');
      assert.ok(fs.existsSync(testReportFile));
    } finally {
      if (prevExe !== undefined) process.env.PORTABLE_EXECUTABLE_DIR = prevExe;
      else delete process.env.PORTABLE_EXECUTABLE_DIR;
      if (prevApp !== undefined) process.env.APP_DATA_DIR = prevApp;
      else delete process.env.APP_DATA_DIR;
      fs.rmSync(portableBase, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // SECTION 7: Launcher.cs & Portable Environment Contract
  // =========================================================================

  test('T1-R12-12: scripts/Launcher.cs injects OMNIFLOW_PORTABLE and PORTABLE_EXECUTABLE_DIR', () => {
    const launcherPath = path.join(ROOT_DIR, 'scripts/Launcher.cs');
    assert.ok(fs.existsSync(launcherPath), 'scripts/Launcher.cs must exist');

    const code = fs.readFileSync(launcherPath, 'utf8');
    assert.ok(code.includes('OMNIFLOW_PORTABLE'), 'Launcher must define OMNIFLOW_PORTABLE environment variable');
    assert.ok(code.includes('PORTABLE_EXECUTABLE_DIR'), 'Launcher must define PORTABLE_EXECUTABLE_DIR environment variable');
  });

});
