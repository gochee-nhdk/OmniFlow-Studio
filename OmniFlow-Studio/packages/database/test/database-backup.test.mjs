import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { FMDatabase } from '../dist/index.js';

test.describe('Package @fm/database — Snapshot Backup & Rotation Tests', () => {
  let tmpDir;
  let dbPath;

  test.beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-db-backup-test-'));
    dbPath = path.join(tmpDir, 'fmauto.sqlite');
  });

  test.afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    } catch {}
  });

  test('checkpoint(): flushes WAL frames to main database file cleanly', () => {
    const db = new FMDatabase(dbPath);
    try {
      db.setSetting('test_checkpoint_key', 'checkpoint_value_123');
      assert.doesNotThrow(() => {
        db.checkpoint();
      }, 'WAL checkpoint(TRUNCATE) must complete without error');
    } finally {
      db.close();
    }
  });

  test('createBackup(): flushes WAL and creates valid standalone SQLite snapshot with correct metadata', () => {
    const db = new FMDatabase(dbPath);
    try {
      db.setSetting('app_title', 'OmniFlow Studio Test');
      db.setSetting('erp_mode', 'SAP_B1');
      db.createWorkflowRun('TEST_WORKFLOW');

      const customBackupDir = path.join(tmpDir, 'custom_snapshots');
      const backupResult = db.createBackup(customBackupDir, 5);

      assert.ok(backupResult.backupPath, 'Must return backupPath');
      assert.ok(backupResult.timestamp, 'Must return ISO timestamp');
      assert.ok(backupResult.sizeBytes > 0, 'Snapshot sizeBytes must be > 0');
      assert.ok(fs.existsSync(backupResult.backupPath), 'Snapshot file must exist on disk');

      // Verify data integrity inside the snapshot file using a new FMDatabase instance
      const snapshotDb = new FMDatabase(backupResult.backupPath);
      try {
        assert.equal(snapshotDb.getSetting('app_title'), 'OmniFlow Studio Test');
        assert.equal(snapshotDb.getSetting('erp_mode'), 'SAP_B1');
        const runs = snapshotDb.listWorkflowRuns(10);
        assert.equal(runs.length, 1);
        assert.equal(runs[0].workflowType, 'TEST_WORKFLOW');
      } finally {
        snapshotDb.close();
      }
    } finally {
      db.close();
    }
  });

  test('createBackup(): defaults backupDir to portable data/backups/snapshots when APP_DATA_DIR is set', () => {
    const portableDataDir = path.join(tmpDir, 'portable_data');
    const prevAppDataDir = process.env.APP_DATA_DIR;
    process.env.APP_DATA_DIR = portableDataDir;

    const db = new FMDatabase(dbPath);
    try {
      db.setSetting('default_dir_test', '1');
      const backupResult = db.createBackup();

      const expectedSnapshotDir = path.join(portableDataDir, 'backups', 'snapshots');
      assert.ok(
        backupResult.backupPath.startsWith(expectedSnapshotDir),
        `Snapshot path must reside inside ${expectedSnapshotDir}`
      );
      assert.ok(fs.existsSync(backupResult.backupPath));
    } finally {
      db.close();
      if (prevAppDataDir !== undefined) process.env.APP_DATA_DIR = prevAppDataDir;
      else delete process.env.APP_DATA_DIR;
    }
  });

  test('createBackup(): automatic rotation enforces maxRetained limit', async () => {
    const db = new FMDatabase(dbPath);
    const backupDir = path.join(tmpDir, 'rotation_test');

    try {
      db.setSetting('rotation_key', 'initial');

      // Create 6 backups with maxRetained = 3
      const maxRetained = 3;
      for (let i = 1; i <= 6; i++) {
        db.setSetting('rotation_key', `iteration_${i}`);
        db.createBackup(backupDir, maxRetained);
        // Small delay to ensure distinct mtimes/filenames
        await new Promise((resolve) => setTimeout(resolve, 30));
      }

      const files = fs.readdirSync(backupDir).filter((f) => f.startsWith('fmauto-snapshot-') && f.endsWith('.sqlite'));
      assert.equal(
        files.length,
        maxRetained,
        `Snapshot rotation must retain exactly ${maxRetained} snapshots, found ${files.length}`
      );

      // Verify listSnapshots lists them newest first
      const snapshots = db.listSnapshots(backupDir);
      assert.equal(snapshots.length, maxRetained);
      assert.ok(new Date(snapshots[0].timestamp) >= new Date(snapshots[1].timestamp));
    } finally {
      db.close();
    }
  });
});
