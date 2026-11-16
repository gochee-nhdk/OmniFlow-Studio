import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  SecureStorage,
  LogRedactor,
  getOrGenerateMasterKeySync,
  getSecurityDir,
  getMasterKeyPath,
  VaultManager,
  createEncryptedVault,
  restoreEncryptedVault
} from '../dist/index.js';

test.describe('Package @fm/security - Unit Tests', () => {
  test('SecureStorage: encrypt produces 3-segment base64 format', () => {
    const raw = 'SecretPassword123!';
    const encrypted = SecureStorage.encrypt(raw);
    const parts = encrypted.split(':');

    assert.equal(parts.length, 3, 'Must have iv:authTag:ciphertext');
    const [ivB64, tagB64, dataB64] = parts;
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');

    assert.equal(iv.length, 12, 'IV must be 12 bytes');
    assert.equal(tag.length, 16, 'AuthTag must be 16 bytes');
    assert.ok(dataB64.length > 0, 'Ciphertext must not be empty');
    assert.ok(!encrypted.includes(raw), 'Plaintext must not appear in output');
  });

  test('SecureStorage: decrypt roundtrip preserves plaintext', () => {
    const raw = 'Procurement2026!SecureKey';
    const encrypted = SecureStorage.encrypt(raw);
    const recovered = SecureStorage.decrypt(encrypted);
    assert.equal(recovered, raw);
  });

  test('SecureStorage: unique IV on consecutive encryptions', () => {
    const raw = 'IdenticalSecretString';
    const enc1 = SecureStorage.encrypt(raw);
    const enc2 = SecureStorage.encrypt(raw);

    assert.notEqual(enc1, enc2);
    assert.notEqual(enc1.split(':')[0], enc2.split(':')[0]);
  });

  test('SecureStorage: tampered payload rejected by authTag check', () => {
    const raw = 'DoNotTamperWithMe';
    const enc = SecureStorage.encrypt(raw);
    const tampered = SecureStorage.tamperCiphertext(enc);

    assert.throws(() => {
      SecureStorage.decrypt(tampered);
    }, /(unable to authenticate data|Unsupported state or unable to authenticate data)/i);
  });

  test('SecureStorage: high-entropy and multi-byte unicode strings', () => {
    const unicode = 'MậtKhẩu#2026!🔒🔑ĐăngNhậpAnToàn';
    const enc = SecureStorage.encrypt(unicode);
    const dec = SecureStorage.decrypt(enc);
    assert.equal(dec, unicode);
  });

  test('SecureStorage: isUnencryptedBase64 validates that storage is not raw base64', () => {
    const pass = 'PlainPasswordToTest';
    const enc = SecureStorage.encrypt(pass);
    assert.equal(SecureStorage.isUnencryptedBase64(enc, pass), false);

    const rawBase64 = Buffer.from(pass).toString('base64');
    assert.equal(SecureStorage.isUnencryptedBase64(rawBase64, pass), true);
  });

  test('LogRedactor: password keyword scrubbing', () => {
    const log1 = 'Connecting to SAP with password="SecretPassword123!"';
    const res1 = LogRedactor.redact(log1);
    assert.ok(!res1.includes('SecretPassword123!'));
    assert.ok(res1.includes('[REDACTED]'));

    const log2 = 'Failed: sbo_password=MySecretPassword at line 10';
    const res2 = LogRedactor.redact(log2);
    assert.ok(!res2.includes('MySecretPassword'));
    assert.ok(res2.includes('[REDACTED]'));
  });

  test('LogRedactor: Bearer token and JWT scrubbing', () => {
    const header = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig';
    const redacted = LogRedactor.redact(header);
    assert.ok(!redacted.includes('eyJhbGci'));
    assert.ok(redacted.includes('Bearer [REDACTED]'));
  });

  test('LogRedactor: Error objects and stack trace scrubbing', () => {
    const err = new Error('Database error with sbo_password=SecretPassword123!');
    const redacted = LogRedactor.redact(err);
    assert.ok(!redacted.includes('SecretPassword123!'));
    assert.ok(redacted.includes('[REDACTED]'));
  });

  test('LogRedactor: handles circular references, null, undefined, numbers without throwing', () => {
    assert.doesNotThrow(() => {
      LogRedactor.redact(null);
      LogRedactor.redact(undefined);
      LogRedactor.redact(12345);
      LogRedactor.redact(true);
      LogRedactor.redact({});

      const circ = {};
      circ.self = circ;
      LogRedactor.redact(circ);
    });
  });

  test('LogRedactor: object payload with sensitive keys is genuinely redacted', () => {
    const payload = {
      username: 'admin',
      password: 'ProductionPassword2026!',
      sbo_password: 'SapProdPassword2026!',
      secret: 'ConfidentialKey999',
      token: 'jwt-token-value-12345',
      authorization: 'Basic dXNlcjpwYXNz',
      publicInfo: 'visible-data'
    };

    const redacted = LogRedactor.redact(payload);
    assert.ok(!redacted.includes('ProductionPassword2026!'), 'password must be redacted');
    assert.ok(!redacted.includes('SapProdPassword2026!'), 'sbo_password must be redacted');
    assert.ok(!redacted.includes('ConfidentialKey999'), 'secret must be redacted');
    assert.ok(!redacted.includes('jwt-token-value-12345'), 'token must be redacted');
    assert.ok(!redacted.includes('Basic dXNlcjpwYXNz'), 'authorization must be redacted');
    assert.ok(redacted.includes('visible-data'), 'non-sensitive fields preserved');
    assert.ok(redacted.includes('[REDACTED]'));

    // Check that output is valid JSON
    const parsed = JSON.parse(redacted);
    assert.equal(parsed.password, '[REDACTED]');
    assert.equal(parsed.sbo_password, '[REDACTED]');
    assert.equal(parsed.secret, '[REDACTED]');
    assert.equal(parsed.publicInfo, 'visible-data');
  });

  test('LogRedactor: password with spaces inside quotes preserves boundary without leaking trailing words', () => {
    const str1 = 'Connecting with password="my secret password 123" to server';
    const res1 = LogRedactor.redact(str1);
    assert.ok(!res1.includes('my secret password 123'));
    assert.ok(!res1.includes('secret password'));
    assert.ok(res1.includes('password="[REDACTED]"'));

    const str2 = "Connecting with pass='another spaced secret pass' to server";
    const res2 = LogRedactor.redact(str2);
    assert.ok(!res2.includes('another spaced secret pass'));
    assert.ok(res2.includes('pass="[REDACTED]"'));
  });

  test('LogRedactor: nested objects and arrays with sensitive properties are redacted', () => {
    const complex = {
      service: 'pos',
      configs: [
        { id: 1, pass: 'ArrayPass1' },
        { id: 2, sbo_password: 'ArrayPass2' }
      ],
      nested: {
        deeper: {
          password: 'DeepSecretPassword!'
        }
      }
    };

    const redacted = LogRedactor.redact(complex);
    assert.ok(!redacted.includes('ArrayPass1'));
    assert.ok(!redacted.includes('ArrayPass2'));
    assert.ok(!redacted.includes('DeepSecretPassword!'));
    assert.ok(redacted.includes('[REDACTED]'));
  });

  test('Portable Master Key: respects process.env.FM_OPS_MASTER_KEY when set', () => {
    const prev = process.env.FM_OPS_MASTER_KEY;
    try {
      const customKey = 'test-custom-master-key-32-chars-long!';
      process.env.FM_OPS_MASTER_KEY = customKey;
      assert.equal(getOrGenerateMasterKeySync(), customKey);
      assert.equal(getMasterKeyPath(), ':env:');
    } finally {
      if (prev !== undefined) process.env.FM_OPS_MASTER_KEY = prev;
      else delete process.env.FM_OPS_MASTER_KEY;
    }
  });

  test('Portable Master Key: creates and loads master.key in APP_DATA_DIR/security', () => {
    const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-port-test-'));
    const prevEnv = process.env.FM_OPS_MASTER_KEY;
    const prevApp = process.env.APP_DATA_DIR;
    delete process.env.FM_OPS_MASTER_KEY;
    process.env.APP_DATA_DIR = tmpDataDir;

    try {
      const expectedDir = path.join(tmpDataDir, 'security');
      const expectedKeyFile = path.join(expectedDir, 'master.key');

      assert.equal(getSecurityDir(), expectedDir);
      assert.equal(getMasterKeyPath(), expectedKeyFile);

      // Generate key in portable security dir
      const key1 = getOrGenerateMasterKeySync();
      assert.ok(key1.length >= 32, 'Master key must be at least 32 chars');
      assert.ok(fs.existsSync(expectedKeyFile), 'master.key file must exist in portable security folder');

      const savedContent = fs.readFileSync(expectedKeyFile, 'utf8').trim();
      assert.equal(savedContent, key1);

      // Subsequent call reuses existing key
      const key2 = getOrGenerateMasterKeySync();
      assert.equal(key2, key1);

      // Roundtrip encryption works seamlessly with portable key
      const encrypted = SecureStorage.encrypt('PortableData2026!');
      const decrypted = SecureStorage.decrypt(encrypted);
      assert.equal(decrypted, 'PortableData2026!');
    } finally {
      if (prevEnv !== undefined) process.env.FM_OPS_MASTER_KEY = prevEnv;
      else delete process.env.FM_OPS_MASTER_KEY;
      if (prevApp !== undefined) process.env.APP_DATA_DIR = prevApp;
      else delete process.env.APP_DATA_DIR;
      fs.rmSync(tmpDataDir, { recursive: true, force: true });
    }
  });

  test('Portable Master Key: PORTABLE_DATA_DIR resolution', () => {
    const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-port2-test-'));
    const prevEnv = process.env.FM_OPS_MASTER_KEY;
    const prevApp = process.env.APP_DATA_DIR;
    const prevPort = process.env.PORTABLE_DATA_DIR;
    delete process.env.FM_OPS_MASTER_KEY;
    delete process.env.APP_DATA_DIR;
    process.env.PORTABLE_DATA_DIR = tmpDataDir;

    try {
      const expectedDir = path.join(tmpDataDir, 'security');
      assert.equal(getSecurityDir(), expectedDir);
      const key = getOrGenerateMasterKeySync();
      assert.ok(key.length >= 32);
      assert.ok(fs.existsSync(path.join(expectedDir, 'master.key')));
    } finally {
      if (prevEnv !== undefined) process.env.FM_OPS_MASTER_KEY = prevEnv;
      else delete process.env.FM_OPS_MASTER_KEY;
      if (prevApp !== undefined) process.env.APP_DATA_DIR = prevApp;
      else delete process.env.APP_DATA_DIR;
      if (prevPort !== undefined) process.env.PORTABLE_DATA_DIR = prevPort;
      else delete process.env.PORTABLE_DATA_DIR;
      fs.rmSync(tmpDataDir, { recursive: true, force: true });
    }
  });

  test('VaultManager: createEncryptedVault generates valid 6-segment OMNIFLOW_VAULT format', () => {
    const payload = {
      enterprise: 'OmniFlow Global',
      profiles: ['admin', 'operator'],
      settings: { offlineMode: true, syncIntervalMs: 5000 },
      credentials: [{ service: 'SAP_MAIN', account: 'SYSTEM' }]
    };
    const passphrase = 'SuperSecretBackupPassword2026!';

    const vault = createEncryptedVault(payload, passphrase);
    assert.equal(typeof vault, 'string');
    assert.ok(vault.startsWith('OMNIFLOW_VAULT:v1:'));

    const parts = vault.split(':');
    assert.equal(parts.length, 6, 'Vault format must have 6 colon-separated segments');
    assert.equal(parts[0], 'OMNIFLOW_VAULT');
    assert.equal(parts[1], 'v1');

    const salt = Buffer.from(parts[2], 'base64');
    const iv = Buffer.from(parts[3], 'base64');
    const tag = Buffer.from(parts[4], 'base64');
    const ciphertext = Buffer.from(parts[5], 'base64');

    assert.equal(salt.length, 16, 'Salt must be 16 bytes');
    assert.equal(iv.length, 12, 'IV must be 12 bytes');
    assert.equal(tag.length, 16, 'Tag must be 16 bytes');
    assert.ok(ciphertext.length > 0, 'Ciphertext must not be empty');

    // Plaintext or passphrase should not leak into output
    assert.ok(!vault.includes('OmniFlow Global'));
    assert.ok(!vault.includes(passphrase));
  });

  test('VaultManager: roundtrip restore successfully recovers complex object payload', () => {
    const originalData = {
      version: '2.5.0',
      databaseDump: {
        tables: ['tasks', 'credentials', 'audit_logs'],
        rowCount: 1250,
      },
      secrets: {
        sapToken: 'secret-sap-token-xyz-12345',
        posPin: '9876'
      },
      unicodeNote: 'Đảm bảo sao lưu an toàn tuyệt đối 100% 🔒'
    };
    const passphrase = 'MyVaultPassphrase#2026';

    const vault = VaultManager.createEncryptedVault(originalData, passphrase);
    const restored = VaultManager.restoreEncryptedVault(vault, passphrase);

    assert.deepEqual(restored, originalData);
    assert.equal(restored.databaseDump.rowCount, 1250);
    assert.equal(restored.secrets.sapToken, 'secret-sap-token-xyz-12345');
    assert.equal(restored.unicodeNote, 'Đảm bảo sao lưu an toàn tuyệt đối 100% 🔒');
  });

  test('VaultManager: roundtrip restore supports raw string data', () => {
    const rawString = 'Plain text backup payload without JSON wrapper';
    const passphrase = 'StringVaultPassword2026';

    const vault = createEncryptedVault(rawString, passphrase);
    const restored = restoreEncryptedVault(rawString ? vault : '', passphrase);

    assert.equal(restored, rawString);
  });

  test('VaultManager: tampered ciphertext is rejected with error', () => {
    const payload = { config: 'confidential' };
    const passphrase = 'ValidPassphrase2026';

    const vault = createEncryptedVault(payload, passphrase);
    const tampered = VaultManager.tamperVault(vault);

    assert.throws(() => {
      restoreEncryptedVault(tampered, passphrase);
    }, /(unable to authenticate data|tampered|corrupted)/i);
  });

  test('VaultManager: incorrect passphrase throws error', () => {
    const payload = { critical: 'data' };
    const correctPassphrase = 'CorrectPassword123';
    const wrongPassphrase = 'WrongPassword456';

    const vault = createEncryptedVault(payload, correctPassphrase);

    assert.throws(() => {
      restoreEncryptedVault(vault, wrongPassphrase);
    }, /(invalid passphrase|unable to authenticate data|corrupted)/i);
  });

  test('VaultManager: validates inputs and rejects invalid/empty passphrases or malformed formats', () => {
    assert.throws(() => {
      createEncryptedVault({ a: 1 }, '');
    }, /passphrase is required/i);

    assert.throws(() => {
      createEncryptedVault({ a: 1 }, null);
    }, /passphrase is required/i);

    assert.throws(() => {
      restoreEncryptedVault('INVALID_HEADER:v1:abc', 'pass');
    }, /Invalid vault/i);

    assert.throws(() => {
      restoreEncryptedVault('OMNIFLOW_VAULT:v2:a:b:c:d', 'pass');
    }, /Unsupported vault version/i);
  });
});
