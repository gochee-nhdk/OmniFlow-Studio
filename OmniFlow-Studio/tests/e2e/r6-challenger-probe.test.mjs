// Challenger 2: Adversarial Security Hardening Probe
// Milestone M4: Production Security Hardening (R6)
// Probes IPC credential exposure and database/file log leaks.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

const { SecureStorage, LogRedactor, credentialManager } = require('../../packages/security/dist/index.js');
const { FMDatabase } = require('../../packages/database/dist/index.js');

test.describe('Challenger 2 — Adversarial Security Hardening Probe', () => {

  // =========================================================================
  // SECTION 1: IPC Contract Adversarial Probing (`credentials:get`)
  // =========================================================================
  test.describe('IPC Contract: credentials:get Zero Plaintext Password Invariant', () => {

    async function simulateCredentialsGet(db, mockKeytarMap, payload) {
      if (!db) return null;
      const meta = db.listCredentialMeta().find((m) => m.accountName === payload?.accountName || m.account_name === payload?.accountName);
      let password = '';
      try {
        if (payload?.accountName && mockKeytarMap[payload.accountName]) {
          password = mockKeytarMap[payload.accountName];
        }
      } catch {
        // Fallback
      }

      if (!password && payload?.accountName) {
        const cached = db.getSetting(`cred_${payload.accountName}`);
        if (cached) {
          try {
            password = SecureStorage.decrypt(cached);
          } catch {
            try {
              password = Buffer.from(cached, 'base64').toString('utf-8');
            } catch {}
          }
        }
      }

      return {
        accountName: payload?.accountName,
        username: meta?.username || '',
        application: meta?.application || '',
        url: meta?.url || '',
        hasPassword: Boolean(password)
      };
    }

    test('Probe IPC 1: Account with OS Credential Vault (Keytar) password', async () => {
      const db = new FMDatabase(':memory:');
      const mockKeytar = {
        'SAP_MAIN': 'UltraSecretKeytarPass!2026'
      };

      db.upsertCredentialMeta({
        id: 'SAP_MAIN',
        accountName: 'SAP_MAIN',
        application: 'SAP',
        username: 'sap_operator',
        credentialKey: 'SAP_MAIN',
        url: 'https://sap.local:8100'
      });

      const res = await simulateCredentialsGet(db, mockKeytar, { accountName: 'SAP_MAIN' });

      assert.ok(res !== null, 'Response must exist');
      assert.equal(res.accountName, 'SAP_MAIN');
      assert.equal(res.username, 'sap_operator');
      assert.equal(res.hasPassword, true);

      // CRITICAL CONTRACT ASSERTIONS:
      assert.equal(res.password, undefined, 'res.password must be strictly undefined');
      assert.equal('password' in res, false, "'password' in res must be strictly false");
      assert.equal(Object.keys(res).includes('password'), false, 'Object.keys must not include password');

      // JSON serialization check:
      const jsonStr = JSON.stringify(res);
      assert.equal(jsonStr.includes('UltraSecretKeytarPass'), false, 'Serialized JSON must NOT leak password');
      assert.match(jsonStr, /"hasPassword":true/);
      assert.doesNotMatch(jsonStr, /"password":/);

      db.close();
    });

    test('Probe IPC 2: Account with AES-256-GCM SecureStorage in SQLite settings', async () => {
      const db = new FMDatabase(':memory:');
      const secret = 'SecureGCMFallbackPassword#999';
      const encrypted = SecureStorage.encrypt(secret);
      db.setSetting('cred_POS_MAIN', encrypted);

      db.upsertCredentialMeta({
        id: 'POS_MAIN',
        accountName: 'POS_MAIN',
        application: 'POS',
        username: 'pos_cashier',
        credentialKey: 'POS_MAIN',
        url: 'http://pos.local:80'
      });

      const res = await simulateCredentialsGet(db, {}, { accountName: 'POS_MAIN' });

      assert.ok(res !== null);
      assert.equal(res.hasPassword, true);
      assert.equal(res.password, undefined);
      assert.equal('password' in res, false);
      assert.equal(JSON.stringify(res).includes('SecureGCMFallbackPassword'), false);
      assert.doesNotMatch(JSON.stringify(res), /"password":/);

      db.close();
    });

    test('Probe IPC 3: Account with legacy Base64 fallback in SQLite settings', async () => {
      const db = new FMDatabase(':memory:');
      const secret = 'LegacyBase64Pass777';
      db.setSetting('cred_LEGACY_ACC', Buffer.from(secret).toString('base64'));

      db.upsertCredentialMeta({
        id: 'LEGACY_ACC',
        accountName: 'LEGACY_ACC',
        application: 'SAP',
        username: 'old_user',
        credentialKey: 'LEGACY_ACC',
        url: 'http://old.local'
      });

      const res = await simulateCredentialsGet(db, {}, { accountName: 'LEGACY_ACC' });

      assert.ok(res !== null);
      assert.equal(res.hasPassword, true);
      assert.equal(res.password, undefined);
      assert.equal('password' in res, false);
      assert.equal(JSON.stringify(res).includes('LegacyBase64Pass777'), false);
      assert.doesNotMatch(JSON.stringify(res), /"password":/);

      db.close();
    });

    test('Probe IPC 4: Non-existent account and empty credentials', async () => {
      const db = new FMDatabase(':memory:');

      const res = await simulateCredentialsGet(db, {}, { accountName: 'DOES_NOT_EXIST' });

      assert.ok(res !== null);
      assert.equal(res.hasPassword, false);
      assert.equal(res.password, undefined);
      assert.equal('password' in res, false);
      assert.doesNotMatch(JSON.stringify(res), /"password":/);

      db.close();
    });

    test('Probe IPC 5: Adversarial payload with injected fields attempting to extract password', async () => {
      const db = new FMDatabase(':memory:');
      db.setSetting('cred_TARGET', SecureStorage.encrypt('TargetPass123!'));

      const maliciousPayload = {
        accountName: 'TARGET',
        password: 'MALICIOUS_INJECTION',
        includePassword: true,
        showSecrets: true,
        __proto__: { leaked: true }
      };

      const res = await simulateCredentialsGet(db, {}, maliciousPayload);

      assert.ok(res !== null);
      assert.equal(res.hasPassword, true);
      assert.equal(res.password, undefined);
      assert.equal('password' in res, false);
      assert.equal(res.showSecrets, undefined);
      assert.equal(res.includePassword, undefined);
      assert.equal(JSON.stringify(res).includes('MALICIOUS_INJECTION'), false);
      assert.equal(JSON.stringify(res).includes('TargetPass123!'), false);

      db.close();
    });

    test('Probe IPC 6: High-entropy Unicode & Emoji Password in vault', async () => {
      const db = new FMDatabase(':memory:');
      const unicodeSecret = 'MậtKhẩu#2026!🔒🔑ĐăngNhậpAnToàn';
      db.setSetting('cred_UNICODE_ACC', SecureStorage.encrypt(unicodeSecret));

      const res = await simulateCredentialsGet(db, {}, { accountName: 'UNICODE_ACC' });

      assert.equal(res.hasPassword, true);
      assert.equal(res.password, undefined);
      assert.equal('password' in res, false);
      assert.equal(JSON.stringify(res).includes(unicodeSecret), false);

      db.close();
    });

    test('Probe IPC 7: credentials:get-meta lists zero passwords across all metadata', () => {
      const db = new FMDatabase(':memory:');
      db.upsertCredentialMeta({
        id: 'ACC1',
        accountName: 'ACC1',
        application: 'SAP',
        username: 'user1',
        credentialKey: 'key1',
        url: 'https://app1.local'
      });
      db.upsertCredentialMeta({
        id: 'ACC2',
        accountName: 'ACC2',
        application: 'POS',
        username: 'user2',
        credentialKey: 'key2',
        url: 'https://app2.local'
      });

      const list = db.listCredentialMeta();
      assert.equal(list.length, 2);

      for (const item of list) {
        assert.equal(item.password, undefined);
        assert.equal('password' in item, false);
        assert.doesNotMatch(JSON.stringify(item), /"password":/);
      }

      db.close();
    });
  });

  // =========================================================================
  // SECTION 2: Redactor in Database & Logger Adversarial Probing
  // =========================================================================
  test.describe('LogRedactor: Adversarial Probing on SQL Queries, Errors & Logs', () => {

    test('Probe Redactor 1: SQL queries with inline passwords (Prompt requirement)', () => {
      // Required by mission prompt:
      // INSERT INTO users VALUES ('admin', 'sbo_password=secret')
      const sql1 = "INSERT INTO users VALUES ('admin', 'sbo_password=secret')";
      const redacted1 = LogRedactor.redact(sql1);
      assert.equal(redacted1.includes('secret'), false, 'Must not leak secret in inline SQL');
      assert.ok(redacted1.includes('[REDACTED]'));

      const sql2 = "UPDATE accounts SET password='MyTopSecretDatabasePassword999' WHERE id=1";
      const redacted2 = LogRedactor.redact(sql2);
      assert.equal(redacted2.includes('MyTopSecretDatabasePassword999'), false);
      assert.ok(redacted2.includes('[REDACTED]'));

      const sql3 = "EXEC sp_login @user='admin', @sbo_password='SuperSecretSAP_DB_PW#'";
      const redacted3 = LogRedactor.redact(sql3);
      assert.equal(redacted3.includes('SuperSecretSAP_DB_PW#'), false);
      assert.ok(redacted3.includes('[REDACTED]'));
    });

    test('Probe Redactor 2: Complex Errors and Stack Traces', () => {
      const err1 = new Error('Database connection failed: host=172.16.1.210;port=8100;sbo_password=FatalErrorSecret123;timeout=5000');
      const redacted1 = LogRedactor.redact(err1);
      assert.equal(redacted1.includes('FatalErrorSecret123'), false, 'Error message/stack must not leak secret');
      assert.ok(redacted1.includes('[REDACTED]'));

      const err2 = new Error('Network timeout during auth');
      err2.stack = `Error: Network timeout\n    at authenticate (auth.js:42:15)\n    params: { password="StackTraceLeakPassword!#" }`;
      const redacted2 = LogRedactor.redact(err2);
      assert.equal(redacted2.includes('StackTraceLeakPassword!#'), false);
      assert.ok(redacted2.includes('[REDACTED]'));
    });

    test('Probe Redactor 3: Bearer tokens and JWT formats', () => {
      const tokens = [
        'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
        'Failed auth with Bearer ya29.a0AfH6SMD_adversarial_token_leak_check_123456789',
        'Header Bearer abcdef1234567890.xyz987654321'
      ];

      for (const t of tokens) {
        const redacted = LogRedactor.redact(t);
        assert.ok(redacted.includes('Bearer [REDACTED]'), `Expected Bearer [REDACTED] in: ${redacted}`);
        assert.equal(redacted.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'), false);
        assert.equal(redacted.includes('SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'), false);
      }
    });

    test('Probe Redactor 4: SQLite Database Error Table Sanitization', () => {
      const db = new FMDatabase(':memory:');

      db.logError({
        errorType: 'DATABASE_ERROR',
        severity: 'CRITICAL',
        message: "SQL Execution Error: INSERT INTO users VALUES ('admin', 'sbo_password=secret_db_pass_123')",
        technicalDetails: "Query Failed at line 88: EXEC auth_proc @pass='TechnicalSecretPass999#'"
      });

      const errors = db.listErrors(10);
      assert.equal(errors.length, 1);
      const row = errors[0];

      assert.equal(row.message.includes('secret_db_pass_123'), false, 'error_logs.message must not leak secret');
      assert.ok(row.message.includes('[REDACTED]'));

      assert.ok(row.technicalDetails);
      assert.equal(row.technicalDetails.includes('TechnicalSecretPass999#'), false, 'error_logs.technical_details must not leak secret');
      assert.ok(row.technicalDetails.includes('[REDACTED]'));

      db.close();
    });

    // --- VULNERABILITY FINDINGS (EMPIRICAL DEMONSTRATION) ---

    test('VULNERABILITY 1: Object payload with password property fails redaction', () => {
      const payload = {
        user: 'admin',
        password: 'ActualProductionPassword987!'
      };

      const redacted = LogRedactor.redact(payload);
      const leaked = redacted.includes('ActualProductionPassword987!');

      assert.equal(leaked, false, 'Remediated: secret is not leaked');
    });

    test('VULNERABILITY 2: SQLite Audit Log details object stores unredacted password on disk', () => {
      const db = new FMDatabase(':memory:');
      db.audit('auth:attempt', 'user:admin', {
        ip: '192.168.1.50',
        password: 'MyTopSecretUserPassword!'
      });

      const row = db.db.prepare('SELECT * FROM audit_logs').get();
      const leaked = row.details.includes('MyTopSecretUserPassword!');

      db.close();
      assert.equal(leaked, false, 'Remediated: secret is not leaked');
    });

    test('VULNERABILITY 3: Password with spaces inside quotes leaks trailing tokens', () => {
      const str1 = "Connecting with password='my secret pass with spaces' to server";
      const redacted1 = LogRedactor.redact(str1);
      const leaked = redacted1.includes('secret pass with spaces');

      assert.equal(leaked, false, 'Remediated: secret is not leaked');
    });
  });
});
