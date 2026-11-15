import test from 'node:test';
import assert from 'node:assert/strict';
import { SecureStorage, LogRedactor } from '../dist/index.js';

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
});
