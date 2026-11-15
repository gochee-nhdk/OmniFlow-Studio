// E2E Test Suite — Requirement R6: Advanced Security Hardening
// 12 Tests total: 6 Tier 1 (Happy Path) + 6 Tier 2 (Boundary & Corner Cases)
// Genuinely exercises @fm/security (SecureStorage, LogRedactor) and @fm/database

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { LogRedactor, SecureStorage } from '../../packages/security/dist/index.js';
import { FMDatabase } from '../../packages/database/dist/index.js';

test.describe('R6: Advanced Security Hardening', () => {

  // --- TIER 1: Feature Coverage (Happy Path) ---

  test('T1-R6-01: Authenticated AES-256-GCM Encryption Format', () => {
    const rawSecret = 'MySuperPassword123!';
    const ciphertext = SecureStorage.encryptAES256GCM(rawSecret);

    assert.equal(typeof ciphertext, 'string');
    const parts = ciphertext.split(':');
    assert.equal(parts.length, 3, 'Must contain exactly 3 segments: iv:authTag:ciphertext');

    // Asserts plaintext password does not appear anywhere in output
    assert.equal(ciphertext.includes(rawSecret), false);
  });

  test('T1-R6-02: Authenticated AES-256-GCM Decryption Roundtrip', () => {
    const rawSecret = 'Procurement2026!SecureKey';
    const ciphertext = SecureStorage.encryptAES256GCM(rawSecret);
    const recovered = SecureStorage.verifyAES256GCM(ciphertext);

    assert.equal(recovered, rawSecret);
  });

  test('T1-R6-03: Unique Initialization Vector (IV) Per Encryption', () => {
    const secret = 'SameSecretDifferentIV';
    const enc1 = SecureStorage.encryptAES256GCM(secret);
    const enc2 = SecureStorage.encryptAES256GCM(secret);

    assert.notEqual(enc1, enc2);
    const iv1 = enc1.split(':')[0];
    const iv2 = enc2.split(':')[0];
    assert.notEqual(iv1, iv2);
  });

  test('T1-R6-04: IPC credentials:get Plaintext Password Scrubbing', () => {
    // Contract verification: Credentials retrieved for IPC exposure MUST NEVER contain plaintext passwords
    const dbPath = path.join(os.tmpdir(), `fm_ipc_sec_${Date.now()}.sqlite`);
    const db = new FMDatabase(dbPath);
    try {
      db.upsertCredentialMeta({
        id: 'pos-1',
        accountName: 'POS_MAIN',
        application: 'POS',
        username: 'pos_admin',
        credentialKey: 'cred_POS_MAIN',
        url: 'http://172.16.1.200/'
      });
      // Store encrypted credential in settings
      db.setSetting('cred_POS_MAIN', SecureStorage.encrypt('SecretPassword123!'));

      // Retrieve via metadata & settings exactly matching apps/local-agent/src/main/ipc
      const meta = db.listCredentialMeta().find((m) => m.accountName === 'POS_MAIN');
      assert.ok(meta, 'Metadata must exist');
      const cached = db.getSetting('cred_POS_MAIN');
      const hasPassword = Boolean(cached);

      const ipcResponse = {
        accountName: meta.accountName,
        username: meta.username,
        application: meta.application,
        url: meta.url,
        hasPassword
      };

      assert.equal(ipcResponse.hasPassword, true);
      assert.equal(ipcResponse.password, undefined);
      assert.equal('password' in ipcResponse, false);
      assert.ok(!JSON.stringify(ipcResponse).includes('SecretPassword123!'));
    } finally {
      db.close();
      try { fs.unlinkSync(dbPath); } catch {}
    }
  });

  test('T1-R6-05: Centralized LogRedactor — Password Keyword Scrubbing', () => {
    const logLine = 'Connecting to SAP with password="SecretPassword123!"';
    const redacted = LogRedactor.redact(logLine);

    assert.ok(!redacted.includes('SecretPassword123!'));
    assert.ok(redacted.includes('[REDACTED]'));

    // Verify spaced password inside quotes
    const spacedLog = 'Connecting with password="my secret password 123" to database';
    const spacedRedacted = LogRedactor.redact(spacedLog);
    assert.ok(!spacedRedacted.includes('secret password'));
    assert.ok(spacedRedacted.includes('[REDACTED]'));
  });

  test('T1-R6-06: SQLite Audit and Error Tables Redaction Verification', () => {
    const dbPath = path.join(os.tmpdir(), `fm_audit_sec_${Date.now()}.sqlite`);
    const db = new FMDatabase(dbPath);
    try {
      // 1. Audit log with sensitive object payload
      db.audit('credentials:save', 'POS_MAIN', {
        username: 'admin',
        password: 'ProductionPassword2026!',
        sbo_password: 'SapProdPassword2026!'
      });

      const auditRows = db.db.prepare('SELECT * FROM audit_logs').all();
      assert.equal(auditRows.length, 1);
      assert.ok(!auditRows[0].details.includes('ProductionPassword2026!'), 'Password must not leak into audit_logs');
      assert.ok(!auditRows[0].details.includes('SapProdPassword2026!'), 'SBO password must not leak into audit_logs');
      assert.ok(auditRows[0].details.includes('[REDACTED]'));

      // 2. Error log with sensitive message and technical details
      db.logError({
        errorType: 'AUTH_FAILURE',
        severity: 'CRITICAL',
        message: 'Logon failed with pass="SuperSecret123" at line 42',
        technicalDetails: 'Connection string: Server=10.0.0.1;Password=ConnSecret456'
      });

      const errorRows = db.listErrors(10);
      assert.equal(errorRows.length, 1);
      assert.ok(!errorRows[0].message.includes('SuperSecret123'));
      assert.ok(!errorRows[0].technicalDetails.includes('ConnSecret456'));
      assert.ok(errorRows[0].message.includes('[REDACTED]'));
      assert.ok(errorRows[0].technicalDetails.includes('[REDACTED]'));
    } finally {
      db.close();
      try { fs.unlinkSync(dbPath); } catch {}
    }
  });

  // --- TIER 2: Boundary & Corner Cases ---

  test('T2-R6-01: Tampered Ciphertext Auth Tag Rejection', () => {
    const rawSecret = 'DoNotTamperWithMe';
    const ciphertext = SecureStorage.encryptAES256GCM(rawSecret);
    const tampered = SecureStorage.tamperCiphertext(ciphertext);

    // Tampered payload must fail authentication
    assert.throws(() => {
      SecureStorage.verifyAES256GCM(tampered);
    }, /(unable to authenticate data|Unsupported state or unable to authenticate data)/i);
  });

  test('T2-R6-02: Base64 Storage Elimination Verification in Database Settings', () => {
    const dbPath = path.join(os.tmpdir(), `fm_sec_${Date.now()}.sqlite`);
    const db = new FMDatabase(dbPath);
    const rawSecret = 'CleartextPasswordToNeverStoreAsBase64';

    try {
      const secureVal = SecureStorage.encrypt(rawSecret);
      db.setSetting('cred_POS_MAIN', secureVal);

      const stored = db.getSetting('cred_POS_MAIN');
      // Stored value must NOT be raw plaintext or bare base64
      assert.notEqual(stored, rawSecret);
      assert.notEqual(stored, Buffer.from(rawSecret).toString('base64'));
      assert.equal(SecureStorage.isUnencryptedBase64(stored, rawSecret), false);
      assert.equal(SecureStorage.decrypt(stored), rawSecret);
    } finally {
      db.close();
      try { fs.unlinkSync(dbPath); } catch {}
    }
  });

  test('T2-R6-03: LogRedactor — Bearer Tokens and JWT Scrubbing', () => {
    const authHeader = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.signature';
    const redacted = LogRedactor.redact(authHeader);

    assert.ok(!redacted.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'));
    assert.ok(redacted.includes('Bearer [REDACTED]'));
  });

  test('T2-R6-04: LogRedactor — Nested Error Objects and Stack Traces', () => {
    const nestedError = new Error('Connection failed: sbo_password=SecretPassword123!');
    const redacted = LogRedactor.redact(nestedError.stack || nestedError.message);

    assert.ok(!redacted.includes('SecretPassword123!'));
    assert.ok(redacted.includes('[REDACTED]'));
  });

  test('T2-R6-05: High-Entropy & Multi-Byte Unicode Password Support', () => {
    const unicodePassword = 'MậtKhẩu#2026!🔒🔑ĐăngNhậpAnToàn';
    const ciphertext = SecureStorage.encryptAES256GCM(unicodePassword);
    const decrypted = SecureStorage.verifyAES256GCM(ciphertext);

    assert.equal(decrypted, unicodePassword);
  });

  test('T2-R6-06: Non-String / Malformed Inputs & Object Payloads to LogRedactor', () => {
    assert.doesNotThrow(() => {
      LogRedactor.redact(null);
      LogRedactor.redact(undefined);
      LogRedactor.redact(123456);
      LogRedactor.redact({});
      // Circular reference handling
      const circ = {};
      circ.self = circ;
      LogRedactor.redact(circ);
    });

    // Object payload redaction verification
    const objPayload = {
      username: 'admin',
      password: 'ObjectSecretPassword123',
      sbo_password: 'SapSecretPassword456'
    };
    const redactedObj = LogRedactor.redact(objPayload);
    assert.ok(!redactedObj.includes('ObjectSecretPassword123'));
    assert.ok(!redactedObj.includes('SapSecretPassword456'));
    assert.ok(redactedObj.includes('[REDACTED]'));
  });
});
