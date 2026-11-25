// E2E Test Suite — Requirement R13: Disaster Recovery Vault & Isolated Browser
// Validates:
// 1. Window maximization on launch in apps/local-agent/src/main/index.ts
// 2. Dedicated isolated browser profile enforcement in packages/browser-engine/src/index.ts (allowCdpAttach defaults to false)
// 3. VaultManager createEncryptedVault and restoreEncryptedVault roundtrip, salt extraction, wrong passphrase rejection
// 4. End-to-end database export and restore simulation preserving settings, enterprise profiles, and credential metadata
// 5. Preload IPC channel whitelisting for vault:export and vault:import

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
  VaultManager,
  createEncryptedVault,
  restoreEncryptedVault,
  VAULT_PREFIX,
  VAULT_VERSION,
  VAULT_SALT_LENGTH,
  VAULT_IV_LENGTH,
  VAULT_TAG_LENGTH,
  SecureStorage,
} from '../../packages/security/dist/index.js';

import { FMDatabase } from '../../packages/database/dist/index.js';
import { BrowserManager, getProfileBase } from '../../packages/browser-engine/dist/index.js';

test.describe('R13: Encrypted Vault Backup & Restore and Dedicated Browser Isolation', () => {

  // =========================================================================
  // SECTION 1: Window Maximization Verification
  // =========================================================================

  test('T1-R13-01: apps/local-agent/src/main/index.ts enforces immediate window maximization upon creation', () => {
    const mainPath = path.join(ROOT_DIR, 'apps/local-agent/src/main/index.ts');
    assert.ok(fs.existsSync(mainPath), 'apps/local-agent/src/main/index.ts must exist');

    const source = fs.readFileSync(mainPath, 'utf8');
    assert.ok(
      source.includes('mainWindow.maximize()'),
      'apps/local-agent/src/main/index.ts must call mainWindow.maximize() upon window creation'
    );
  });

  test('T1-R13-02: apps/local-agent/src/main/index.ts maximizes on ready-to-show event', () => {
    const mainPath = path.join(ROOT_DIR, 'apps/local-agent/src/main/index.ts');
    const source = fs.readFileSync(mainPath, 'utf8');

    const readyToShowIdx = source.indexOf("'ready-to-show'");
    assert.ok(readyToShowIdx !== -1, 'ready-to-show listener must exist');

    const readyToShowBlock = source.slice(readyToShowIdx, readyToShowIdx + 200);
    assert.ok(
      readyToShowBlock.includes('maximize()'),
      'ready-to-show event listener must call maximize() before showing the window'
    );
  });

  // =========================================================================
  // SECTION 2: Dedicated Isolated Browser Engine Verification
  // =========================================================================

  test('T1-R13-03: BrowserManager defaults allowCdpAttach to false for strict session isolation', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r13-bm-'));
    try {
      const bm = new BrowserManager({ downloadDir: tmpDir });
      assert.equal(
        bm.allowCdpAttach,
        false,
        'BrowserManager must default allowCdpAttach to false to prevent touching user personal browser tabs'
      );
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      } catch {}
    }
  });

  test('T1-R13-04: BrowserManager getProfileBase routes profiles strictly into portable data/browser-profiles', () => {
    const portableData = fs.mkdtempSync(path.join(os.tmpdir(), 'r13-port-'));
    const prevApp = process.env.APP_DATA_DIR;
    const prevPort = process.env.PORTABLE_DATA_DIR;

    try {
      delete process.env.APP_DATA_DIR;
      delete process.env.PORTABLE_DATA_DIR;

      // When userDataDir is explicitly passed
      const baseWithOption = getProfileBase(portableData);
      assert.equal(baseWithOption, path.join(portableData, 'browser-profiles'));

      // When APP_DATA_DIR is set
      process.env.APP_DATA_DIR = portableData;
      const baseWithEnv = getProfileBase();
      assert.equal(baseWithEnv, path.join(portableData, 'browser-profiles'));
    } finally {
      if (prevApp !== undefined) process.env.APP_DATA_DIR = prevApp;
      else delete process.env.APP_DATA_DIR;
      if (prevPort !== undefined) process.env.PORTABLE_DATA_DIR = prevPort;
      else delete process.env.PORTABLE_DATA_DIR;
      try {
        fs.rmSync(portableData, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      } catch {}
    }
  });

  test('T1-R13-05: BrowserManager respects explicit allowCdpAttach: true only when opted in', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r13-bm-optin-'));
    try {
      const bm = new BrowserManager({ downloadDir: tmpDir, allowCdpAttach: true });
      assert.equal(bm.allowCdpAttach, true, 'allowCdpAttach must be true when explicitly requested');
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      } catch {}
    }
  });

  // =========================================================================
  // SECTION 3: VaultManager Core Cryptographic Capabilities
  // =========================================================================

  test('T1-R13-06: VaultManager createEncryptedVault produces 6-segment format with 16B salt, 12B IV, 16B tag', () => {
    const sampleData = { secret: 'OmniFlowEnterprise2026', timestamp: Date.now() };
    const passphrase = 'SuperSecurePassphrase#123';

    const vault = createEncryptedVault(sampleData, passphrase);
    assert.ok(typeof vault === 'string');

    const parts = vault.split(':');
    assert.equal(parts.length, 6, 'Vault format must have 6 colon-delimited parts');
    assert.equal(parts[0], VAULT_PREFIX);
    assert.equal(parts[1], VAULT_VERSION);

    const salt = Buffer.from(parts[2], 'base64');
    const iv = Buffer.from(parts[3], 'base64');
    const tag = Buffer.from(parts[4], 'base64');
    const ciphertext = Buffer.from(parts[5], 'base64');

    assert.equal(salt.length, VAULT_SALT_LENGTH, 'Salt must be 16 bytes');
    assert.equal(iv.length, VAULT_IV_LENGTH, 'IV must be 12 bytes');
    assert.equal(tag.length, VAULT_TAG_LENGTH, 'Auth Tag must be 16 bytes');
    assert.ok(ciphertext.length > 0, 'Ciphertext must be present');
  });

  test('T1-R13-07: VaultManager restoreEncryptedVault recovers complex JSON payload with correct passphrase', () => {
    const originalPayload = {
      appName: 'OmniFlow Studio',
      activeEnterpriseId: 'ent-01',
      enterpriseProfiles: [
        { id: 'ent-01', name: 'Chi Nhánh Hà Nội', sapUrl: 'https://sap-hn.local:50000', isActive: true },
        { id: 'ent-02', name: 'Chi Nhánh TP.HCM', sapUrl: 'https://sap-hcm.local:50000', isActive: false },
      ],
      settings: {
        sap_url: 'https://sap-hn.local:50000',
        pos_url: 'https://pos-live.vn',
        download_directory: 'D:\\reports',
      },
      credentials: [
        { accountName: 'SAP_ACCOUNT', username: 'manager', password: 'P@ssword!2026' },
      ],
    };
    const passphrase = 'DisasterRecoveryKey$2026!';

    const vaultString = createEncryptedVault(originalPayload, passphrase);
    const restored = restoreEncryptedVault(vaultString, passphrase);

    assert.deepEqual(restored, originalPayload, 'Restored data must match original payload exactly');
  });

  test('T1-R13-08: VaultManager rejects wrong passphrase with clear authentication error', () => {
    const payload = { sensitive: 'Confidential ERP Data' };
    const vaultString = createEncryptedVault(payload, 'CorrectPassphrase');

    assert.throws(
      () => restoreEncryptedVault(vaultString, 'WrongPassphrase!'),
      /invalid passphrase or corrupted\/tampered data/i,
      'Must reject wrong passphrase'
    );
  });

  test('T1-R13-09: VaultManager rejects tampered ciphertext or authTag', () => {
    const payload = { critical: 'TamperTest' };
    const vaultString = createEncryptedVault(payload, 'TestPassphrase');
    const tampered = VaultManager.tamperVault(vaultString);

    assert.throws(
      () => restoreEncryptedVault(tampered, 'TestPassphrase'),
      /invalid passphrase or corrupted\/tampered data/i,
      'Must reject tampered vault payload'
    );
  });

  test('T1-R13-10: VaultManager validates empty passphrase and corrupted formats', () => {
    assert.throws(() => createEncryptedVault({ test: 1 }, ''), /passphrase is required/i);
    assert.throws(() => restoreEncryptedVault('not-a-vault', 'pass'), /Invalid vault format/i);
    assert.throws(() => restoreEncryptedVault('INVALID_HEADER:v1:a:b:c:d', 'pass'), /Invalid vault header/i);
  });

  // =========================================================================
  // SECTION 4: Database Export & Restore Simulation
  // =========================================================================

  test('T1-R13-11: Full Disaster Recovery Simulation (Export SQLite -> Vault -> Restore into fresh SQLite)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r13-e2e-vault-'));
    const db1Path = path.join(tmpDir, 'fmauto-original.sqlite');
    const db2Path = path.join(tmpDir, 'fmauto-restored.sqlite');
    const vaultFilePath = path.join(tmpDir, 'backup.ofvault');
    const passphrase = 'DisasterRecoveryVaultPassphrase2026!';

    try {
      // 1. Setup initial database with enterprise profiles and settings
      const db1 = new FMDatabase(db1Path);
      db1.setSetting('sap_url', 'https://sap-server.enterprise.vn:50000');
      db1.setSetting('pos_url', 'https://pos-portal.enterprise.vn');
      db1.setSetting('active_enterprise_id', 'ent-hanoi');

      const profiles = [
        { id: 'ent-hanoi', name: 'Hà Nội Enterprise', sapUrl: 'https://sap-server.enterprise.vn:50000', isActive: true },
        { id: 'ent-danang', name: 'Đà Nẵng Enterprise', sapUrl: 'https://sap-danang.enterprise.vn:50000', isActive: false },
      ];
      db1.setSetting('enterprise_profiles', JSON.stringify(profiles));

      db1.upsertCredentialMeta({
        id: 'SAP_CRED',
        accountName: 'SAP_CRED',
        application: 'SAP',
        username: 'admin_erp',
        credentialKey: 'SAP_CRED',
        url: 'https://sap-server.enterprise.vn:50000',
      });
      db1.setSetting('cred_SAP_CRED', SecureStorage.encrypt('SecretPassword#2026!'));

      // 2. Perform export simulation
      const exportPayload = {
        appName: 'OmniFlow Studio',
        format: 'OMNIFLOW_VAULT_BACKUP',
        version: 1,
        exportedAt: new Date().toISOString(),
        activeEnterpriseId: db1.getSetting('active_enterprise_id'),
        enterpriseProfiles: JSON.parse(db1.getSetting('enterprise_profiles') || '[]'),
        settings: db1.getAllSettings(),
        credentials: [
          {
            accountName: 'SAP_CRED',
            username: 'admin_erp',
            application: 'SAP',
            password: 'SecretPassword#2026!',
            encryptedLocal: db1.getSetting('cred_SAP_CRED'),
          },
        ],
      };

      const encryptedVault = createEncryptedVault(exportPayload, passphrase);
      fs.writeFileSync(vaultFilePath, encryptedVault, 'utf8');
      assert.ok(fs.existsSync(vaultFilePath));

      db1.close();

      // 3. Disaster recovery simulation into fresh blank database (db2)
      const rawVaultString = fs.readFileSync(vaultFilePath, 'utf8').trim();
      const restoredData = restoreEncryptedVault(rawVaultString, passphrase);

      const db2 = new FMDatabase(db2Path);

      // Restore settings
      for (const [k, v] of Object.entries(restoredData.settings)) {
        db2.setSetting(k, String(v));
      }

      // Restore enterprise profiles
      db2.setSetting('enterprise_profiles', JSON.stringify(restoredData.enterpriseProfiles));
      db2.setSetting('active_enterprise_id', restoredData.activeEnterpriseId);

      // Restore credentials
      for (const cred of restoredData.credentials) {
        db2.upsertCredentialMeta({
          id: cred.accountName,
          accountName: cred.accountName,
          application: cred.application || '',
          username: cred.username || '',
          credentialKey: cred.accountName,
          url: '',
        });
        if (cred.encryptedLocal) {
          db2.setSetting(`cred_${cred.accountName}`, cred.encryptedLocal);
        }
      }

      // Verify db2 state
      assert.equal(db2.getSetting('sap_url'), 'https://sap-server.enterprise.vn:50000');
      assert.equal(db2.getSetting('pos_url'), 'https://pos-portal.enterprise.vn');
      assert.equal(db2.getSetting('active_enterprise_id'), 'ent-hanoi');

      const restoredProfiles = JSON.parse(db2.getSetting('enterprise_profiles') || '[]');
      assert.equal(restoredProfiles.length, 2);
      assert.equal(restoredProfiles[0].name, 'Hà Nội Enterprise');

      const restoredMeta = db2.listCredentialMeta();
      assert.equal(restoredMeta.length, 1);
      assert.equal(restoredMeta[0].username, 'admin_erp');

      const restoredCredEncrypted = db2.getSetting('cred_SAP_CRED');
      assert.ok(restoredCredEncrypted);
      const decryptedPwd = SecureStorage.decrypt(restoredCredEncrypted);
      assert.equal(decryptedPwd, 'SecretPassword#2026!');

      db2.close();
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      } catch {}
    }
  });

  // =========================================================================
  // SECTION 5: Preload IPC Whitelist & Automated DB Snapshot Verification
  // =========================================================================

  test('T1-R13-12: apps/local-agent/src/preload/index.ts whitelists vault:export, vault:import, vault:create-snapshot, vault:list-snapshots', () => {
    const preloadPath = path.join(ROOT_DIR, 'apps/local-agent/src/preload/index.ts');
    assert.ok(fs.existsSync(preloadPath), 'preload/index.ts must exist');

    const source = fs.readFileSync(preloadPath, 'utf8');
    assert.ok(source.includes("'vault:export'"), 'preload must whitelist vault:export');
    assert.ok(source.includes("'vault:import'"), 'preload must whitelist vault:import');
    assert.ok(source.includes("'vault:create-snapshot'"), 'preload must whitelist vault:create-snapshot');
    assert.ok(source.includes("'vault:list-snapshots'"), 'preload must whitelist vault:list-snapshots');
  });

  test('T1-R13-13: FMDatabase checkpoint() flushes WAL and createBackup() creates rotated snapshot files', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r13-snap-'));
    const dbPath = path.join(tmpDir, 'fmauto.sqlite');
    const snapshotDir = path.join(tmpDir, 'snapshots');

    try {
      const db = new FMDatabase(dbPath);
      db.setSetting('profile_test', 'alpha');
      db.checkpoint();

      // Create multiple snapshots with maxRetained = 2
      for (let i = 1; i <= 4; i++) {
        db.setSetting('counter', String(i));
        db.createBackup(snapshotDir, 2);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      const files = fs.readdirSync(snapshotDir).filter((f) => f.startsWith('fmauto-snapshot-') && f.endsWith('.sqlite'));
      assert.equal(files.length, 2, 'Must retain exactly 2 snapshots after rotation');

      const snapshots = db.listSnapshots(snapshotDir);
      assert.equal(snapshots.length, 2);
      assert.ok(snapshots[0].sizeBytes > 0);

      db.close();
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      } catch {}
    }
  });

});
