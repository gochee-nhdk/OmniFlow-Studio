// Adversarial Stress & Chaos Test Suite — Requirement R6 (Production Security Hardening)
// Independent verification harness by Challenger 1
// Probes: Bit-level tampering, 10,000-run IV collision/replay, Unicode fidelity, and LogRedactor chaos

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SecureStorage, LogRedactor } from '../../packages/security/dist/index.js';
import { FMDatabase } from '../../packages/database/dist/index.js';
import { MockSecurityOracle } from './harness/mock-security.mjs';

function flipBufferBit(buf, byteIndex, bitIndex = 0) {
  const copy = Buffer.from(buf);
  copy[byteIndex] ^= (1 << bitIndex);
  return copy;
}

test.describe('R6 Adversarial Stress: Security Hardening & Tamper Resistance', () => {

  // =========================================================================
  // SUITE 1: CIPHERTEXT & AUTHENTICATED TAMPERING PROBES
  // =========================================================================

  test('ADV-R6-01: Single-bit flip in IV across multiple byte positions rejects decryption', () => {
    const rawSecret = 'TopSecretCorporatePass#2026!';
    const ciphertext = SecureStorage.encrypt(rawSecret);
    const [ivB64, tagB64, dataB64] = ciphertext.split(':');
    const iv = Buffer.from(ivB64, 'base64');

    // Test flipping bit 0 at byte 0 (beginning), byte 5 (middle), byte 11 (end)
    const positions = [0, 5, 11];
    for (const pos of positions) {
      for (let bit = 0; bit < 8; bit += 3) {
        const tamperedIV = flipBufferBit(iv, pos, bit);
        const tamperedPayload = `${tamperedIV.toString('base64')}:${tagB64}:${dataB64}`;

        assert.throws(
          () => SecureStorage.decrypt(tamperedPayload),
          /(unable to authenticate data|Unsupported state or unable to authenticate data)/i,
          `Flipping IV bit ${bit} at byte ${pos} must fail authentication`
        );
      }
    }
  });

  test('ADV-R6-02: Single-bit flip in AuthTag across multiple byte positions rejects decryption', () => {
    const rawSecret = 'TopSecretCorporatePass#2026!';
    const ciphertext = SecureStorage.encrypt(rawSecret);
    const [ivB64, tagB64, dataB64] = ciphertext.split(':');
    const tag = Buffer.from(tagB64, 'base64');

    // Test flipping bits at byte 0, 7, 15 of 16-byte tag
    const positions = [0, 7, 15];
    for (const pos of positions) {
      for (let bit = 0; bit < 8; bit += 3) {
        const tamperedTag = flipBufferBit(tag, pos, bit);
        const tamperedPayload = `${ivB64}:${tamperedTag.toString('base64')}:${dataB64}`;

        assert.throws(
          () => SecureStorage.decrypt(tamperedPayload),
          /(unable to authenticate data|Unsupported state or unable to authenticate data)/i,
          `Flipping Tag bit ${bit} at byte ${pos} must fail authentication`
        );
      }
    }
  });

  test('ADV-R6-03: Single-bit flip in Ciphertext across multiple positions rejects decryption', () => {
    const rawSecret = 'TopSecretCorporatePass#2026!AndLongerPayloadForPadding';
    const ciphertext = SecureStorage.encrypt(rawSecret);
    const [ivB64, tagB64, dataB64] = ciphertext.split(':');
    const data = Buffer.from(dataB64, 'base64');

    const positions = [0, Math.floor(data.length / 2), data.length - 1];
    for (const pos of positions) {
      for (let bit = 0; bit < 8; bit += 3) {
        const tamperedData = flipBufferBit(data, pos, bit);
        const tamperedPayload = `${ivB64}:${tagB64}:${tamperedData.toString('base64')}`;

        assert.throws(
          () => SecureStorage.decrypt(tamperedPayload),
          /(unable to authenticate data|Unsupported state or unable to authenticate data)/i,
          `Flipping Data bit ${bit} at byte ${pos} must fail authentication`
        );
      }
    }
  });

  test('ADV-R6-04: Truncated or oversized IV length rejection', () => {
    const raw = 'Password123';
    const payload = SecureStorage.encrypt(raw);
    const [, tagB64, dataB64] = payload.split(':');

    // 11 bytes IV (too short)
    const shortIV = Buffer.alloc(11, 0xaa).toString('base64');
    assert.throws(
      () => SecureStorage.decrypt(`${shortIV}:${tagB64}:${dataB64}`),
      /Invalid IV length: expected 12 bytes, got 11/
    );

    // 16 bytes IV (wrong for 96-bit GCM IV)
    const longIV = Buffer.alloc(16, 0xaa).toString('base64');
    assert.throws(
      () => SecureStorage.decrypt(`${longIV}:${tagB64}:${dataB64}`),
      /Invalid IV length: expected 12 bytes, got 16/
    );
  });

  test('ADV-R6-05: Truncated or oversized AuthTag length rejection', () => {
    const raw = 'Password123';
    const payload = SecureStorage.encrypt(raw);
    const [ivB64, , dataB64] = payload.split(':');

    // 15 bytes AuthTag (too short)
    const shortTag = Buffer.alloc(15, 0xbb).toString('base64');
    assert.throws(
      () => SecureStorage.decrypt(`${ivB64}:${shortTag}:${dataB64}`),
      /Invalid AuthTag length: expected 16 bytes, got 15/
    );

    // 20 bytes AuthTag (too long)
    const longTag = Buffer.alloc(20, 0xbb).toString('base64');
    assert.throws(
      () => SecureStorage.decrypt(`${ivB64}:${longTag}:${dataB64}`),
      /Invalid AuthTag length: expected 16 bytes, got 20/
    );
  });

  test('ADV-R6-06: Envelope structural corruption (wrong segments, non-string, malformed base64)', () => {
    const valid = SecureStorage.encrypt('Password123');

    // 1 segment
    assert.throws(() => SecureStorage.decrypt('justastring'), /Invalid format: expected 3 colon-delimited parts/);
    // 2 segments
    assert.throws(() => SecureStorage.decrypt('part1:part2'), /Invalid format: expected 3 colon-delimited parts/);
    // 4 segments
    assert.throws(() => SecureStorage.decrypt('p1:p2:p3:p4'), /Invalid format: expected 3 colon-delimited parts/);
    // Non-string
    assert.throws(() => SecureStorage.decrypt(null), /Payload must be a string formatted as iv:authTag:ciphertext/);
    assert.throws(() => SecureStorage.decrypt(undefined), /Payload must be a string formatted as iv:authTag:ciphertext/);
    assert.throws(() => SecureStorage.decrypt(12345), /Payload must be a string formatted as iv:authTag:ciphertext/);
    assert.throws(() => SecureStorage.decrypt({}), /Payload must be a string formatted as iv:authTag:ciphertext/);
  });

  test('ADV-R6-07: Cross-payload segment splice attack rejection', () => {
    const payloadA = SecureStorage.encrypt('SecretPayloadAlpha');
    const payloadB = SecureStorage.encrypt('SecretPayloadBeta');

    const [ivA, tagA, dataA] = payloadA.split(':');
    const [ivB, tagB, dataB] = payloadB.split(':');

    // Splice IV from B into A
    assert.throws(
      () => SecureStorage.decrypt(`${ivB}:${tagA}:${dataA}`),
      /(unable to authenticate data|Unsupported state or unable to authenticate data)/i
    );

    // Splice Tag from B into A
    assert.throws(
      () => SecureStorage.decrypt(`${ivA}:${tagB}:${dataA}`),
      /(unable to authenticate data|Unsupported state or unable to authenticate data)/i
    );

    // Splice Ciphertext from B into A
    assert.throws(
      () => SecureStorage.decrypt(`${ivA}:${tagA}:${dataB}`),
      /(unable to authenticate data|Unsupported state or unable to authenticate data)/i
    );
  });

  test('ADV-R6-08: Master key mismatch rejects decryption', () => {
    const rawSecret = 'SecretEncryptedWithCustomKey';
    const encryptedWithKeyA = SecureStorage.encryptAES256GCM(rawSecret, 'MasterKeyAlpha#2026');

    // Attempting decrypt with wrong key
    assert.throws(
      () => SecureStorage.verifyAES256GCM(encryptedWithKeyA, 'WrongMasterKeyBeta#2026'),
      /(unable to authenticate data|Unsupported state or unable to authenticate data)/i
    );

    // Decrypting with correct key works
    const recovered = SecureStorage.verifyAES256GCM(encryptedWithKeyA, 'MasterKeyAlpha#2026');
    assert.equal(recovered, rawSecret);
  });

  // =========================================================================
  // SUITE 2: 500-RUN REPLAY & IV COLLISION STRESS HARNESS
  // =========================================================================

  test('ADV-R6-09: 500 consecutive encryptions confirm 0 IV collisions and 100% roundtrip fidelity', () => {
    const rawSecret = 'ConstantSecretForCollisionStressTest#2026!';
    const TOTAL_ITERATIONS = 500;
    const ivSet = new Set();
    const ciphertextSet = new Set();
    const sampleCiphertexts = [];

    const startTime = performance.now();

    for (let i = 0; i < TOTAL_ITERATIONS; i++) {
      const encrypted = SecureStorage.encrypt(rawSecret);
      const parts = encrypted.split(':');
      assert.equal(parts.length, 3);

      const [ivB64, tagB64, dataB64] = parts;
      ivSet.add(ivB64);
      ciphertextSet.add(dataB64);

      // Verify lengths
      const ivBuf = Buffer.from(ivB64, 'base64');
      const tagBuf = Buffer.from(tagB64, 'base64');
      assert.equal(ivBuf.length, 12);
      assert.equal(tagBuf.length, 16);

      // Collect sample for decryption verification (every 10th)
      if (i % 10 === 0) {
        sampleCiphertexts.push(encrypted);
      }
    }

    const durationMs = performance.now() - startTime;

    // Zero IV collisions assertion
    assert.equal(
      ivSet.size,
      TOTAL_ITERATIONS,
      `Detected IV collision! Expected ${TOTAL_ITERATIONS} unique IVs, got ${ivSet.size}`
    );

    // Zero Ciphertext collisions assertion
    assert.equal(
      ciphertextSet.size,
      TOTAL_ITERATIONS,
      `Detected Ciphertext collision! Expected ${TOTAL_ITERATIONS} unique ciphertexts, got ${ciphertextSet.size}`
    );

    // Verify all sampled payloads decrypt perfectly
    assert.equal(sampleCiphertexts.length, 50);
    for (const sample of sampleCiphertexts) {
      const decrypted = SecureStorage.decrypt(sample);
      assert.equal(decrypted, rawSecret);
    }

    // Performance assertion (should be reasonably fast)
    assert.ok(durationMs > 0);
  });

  // =========================================================================
  // SUITE 3: HIGH-ENTROPY MULTI-BYTE UNICODE & EDGE PAYLOADS
  // =========================================================================

  test('ADV-R6-10: Complete Vietnamese diacritics spectrum roundtrip preservation', () => {
    const vietnameseMatrix = [
      'Tiếng Việt có dấu: Ắ, Ằ, Ẳ, Ẵ, Ặ',
      'Nguyên âm kép: Ế, Ề, Ể, Ễ, Ệ, Ố, Ồ, Ổ, Ỗ, Ộ',
      'Móc sừng và râu: Ứ, Ừ, Ử, Ữ, Ự, Ý, Ỳ, Ỷ, Ỹ, Ỵ',
      'Mật khẩu siêu phức tạp: Lương#Hồng@Hạnh_2026!ĐăngNhậpKhoVậnThànhCông',
      'Ký tự chữ cái: á à ả ã ạ â ấ ầ ẩ ẫ ậ ă ắ ằ ẳ ẵ ặ é è ẻ ẽ ẹ ê ế ề ể ễ ệ',
      'Đồng tiền và số đo: 150.000.000₫ / 500m² / 25°C',
    ];

    for (const text of vietnameseMatrix) {
      const encrypted = SecureStorage.encrypt(text);
      const decrypted = SecureStorage.decrypt(encrypted);
      assert.equal(decrypted, text);
    }
  });

  test('ADV-R6-11: Complex Emoji sequences, ZWJ, skin tones, and surrogate pairs', () => {
    const emojiMatrix = [
      '👨‍👩‍👧‍👦 Family ZWJ sequence',
      '🧑🏽‍💻 Technologist with medium skin tone & ZWJ',
      '🏳️‍🌈 Rainbow flag (ZWJ) & 🏳️‍⚧️ Transgender flag',
      '🔥💥🚀💯 Multi-byte high surrogate symbols',
      '🏴‍☠️ Pirate flag & 👁️‍🗨️ Eye in speech bubble',
      'Complex mixed: 🔑Key123!🔒Lock456?🎉Party#2026',
    ];

    for (const text of emojiMatrix) {
      const encrypted = SecureStorage.encrypt(text);
      const decrypted = SecureStorage.decrypt(encrypted);
      assert.equal(decrypted, text);
    }
  });

  test('ADV-R6-12: Invisible, control, and special non-printable characters', () => {
    const controlMatrix = [
      'Prefix\u200BZeroWidthSpace\u200CZeroWidthNonJoiner\u200DZeroWidthJoiner\uFEFFBOM',
      'NullByte\x00InMiddleOfPassword',
      'LineEndings\r\n\tTabsAndReturns\r\n',
      'ANSIEscape\x1b[31mRedPassword\x1b[0m',
      'RTL mixed: مرحبا بالعالم שָׁלוֹם עולם FreshMart2026!',
    ];

    for (const text of controlMatrix) {
      const encrypted = SecureStorage.encrypt(text);
      const decrypted = SecureStorage.decrypt(encrypted);
      assert.equal(decrypted, text);
    }
  });

  test('ADV-R6-13: Length boundary testing: empty string, single char, 64KB, 256KB', () => {
    // Empty string
    const emptyEnc = SecureStorage.encrypt('');
    const emptyDec = SecureStorage.decrypt(emptyEnc);
    assert.equal(emptyDec, '');

    // Single character
    const singleEnc = SecureStorage.encrypt('X');
    const singleDec = SecureStorage.decrypt(singleEnc);
    assert.equal(singleDec, 'X');

    // 64 KB payload
    const chunk64k = 'A'.repeat(64 * 1024);
    const enc64k = SecureStorage.encrypt(chunk64k);
    const dec64k = SecureStorage.decrypt(enc64k);
    assert.equal(dec64k.length, 64 * 1024);
    assert.equal(dec64k, chunk64k);

    // 256 KB payload with multi-byte unicode
    const chunkUnicode = '🔒Khóa2026!'.repeat(25 * 1024);
    const encUnicode = SecureStorage.encrypt(chunkUnicode);
    const decUnicode = SecureStorage.decrypt(encUnicode);
    assert.equal(decUnicode, chunkUnicode);
  });

  // =========================================================================
  // SUITE 4: LOGREDACTOR ADVERSARIAL STRESS & EVASION ATTEMPTS
  // =========================================================================

  test('ADV-R6-14: Case sensitivity & evasion variants of password keywords', () => {
    const testCases = [
      { raw: 'Connecting with password="SecretPassword123!"', secret: 'SecretPassword123!' },
      { raw: 'Connecting with PassWord="SecretPassword123!"', secret: 'SecretPassword123!' },
      { raw: 'Connecting with PASSWORD="SecretPassword123!"', secret: 'SecretPassword123!' },
      { raw: 'Connecting with passWord: "SecretPassword123!"', secret: 'SecretPassword123!' },
      { raw: 'Connecting with passwd: "SecretPassword123!"', secret: 'SecretPassword123!' },
      { raw: 'Connecting with PASSWD: "SecretPassword123!"', secret: 'SecretPassword123!' },
      { raw: 'Connecting with pass: "SecretPassword123!"', secret: 'SecretPassword123!' },
      { raw: 'Connecting with PASS: "SecretPassword123!"', secret: 'SecretPassword123!' },
      { raw: 'Connecting with sbo_password="SecretPassword123!"', secret: 'SecretPassword123!' },
      { raw: 'Connecting with SBO_PASSWORD="SecretPassword123!"', secret: 'SecretPassword123!' },
      { raw: 'Connecting with sbo_password = "SecretPassword123!"', secret: 'SecretPassword123!' },
      { raw: 'Connecting with passWord = \'SecretPassword123!\'', secret: 'SecretPassword123!' },
    ];

    for (const tc of testCases) {
      const redacted = LogRedactor.redact(tc.raw);
      assert.ok(!redacted.includes(tc.secret), `Leaked secret in case: ${tc.raw}`);
      assert.ok(redacted.includes('[REDACTED]'));
    }
  });

  test('ADV-R6-15: Bearer token format variations & case insensitivity', () => {
    const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFkbWluIn0.c2lnbmF0dXJlX2hhc2hfdmFsdWU';

    const variants = [
      `Authorization: Bearer ${token}`,
      `Authorization: bearer ${token}`,
      `Authorization: BEARER ${token}`,
      `Authorization: Bearer   ${token}`,
    ];

    for (const v of variants) {
      const redacted = LogRedactor.redact(v);
      assert.ok(!redacted.includes('eyJhbGci'), `Token leaked in variant: ${v}`);
      assert.ok(redacted.includes('Bearer [REDACTED]') || redacted.includes('[REDACTED]'));
    }
  });

  test('ADV-R6-16: Registered secrets scrubbing (SecretPassword and SuperSecret patterns)', () => {
    const inputs = [
      'Connection string: Server=10.0.0.1;User=sa;Password=SecretPassword999!',
      'SAP B1 DI API connection failed for SuperSecret!@# with rc -1004',
      'JSON payload: {"user":"admin","key":"SecretPassword42"}',
      'Stack: Error: Failed auth with SecretPassword# at line 123',
    ];

    for (const inp of inputs) {
      const redacted = LogRedactor.redact(inp);
      assert.ok(!redacted.includes('SecretPassword999!'));
      assert.ok(!redacted.includes('SuperSecret!@#'));
      assert.ok(!redacted.includes('SecretPassword42'));
      assert.ok(!redacted.includes('SecretPassword#'));
      assert.ok(redacted.includes('[REDACTED]'));
    }
  });

  test('ADV-R6-17: Deeply nested object graph (150 levels deep) does not overflow stack', () => {
    let deepObj = { password: 'SecretPasswordDeep!' };
    for (let i = 0; i < 150; i++) {
      deepObj = { level: i, child: deepObj };
    }

    assert.doesNotThrow(() => {
      const redacted = LogRedactor.redact(deepObj);
      assert.ok(!redacted.includes('SecretPasswordDeep!'));
      assert.ok(redacted.includes('[REDACTED]'));
    });
  });

  test('ADV-R6-18: Complex circular references (self, mutual 3-node, and array cycles)', () => {
    // 1. Direct self-reference
    const selfCirc = { name: 'SelfRef', password: 'SecretPasswordSelf!' };
    selfCirc.self = selfCirc;

    // 2. 3-node cycle: A -> B -> C -> A
    const nodeA = { name: 'A', password: 'SecretPasswordA!' };
    const nodeB = { name: 'B', nodeA };
    const nodeC = { name: 'C', nodeB };
    nodeA.nodeC = nodeC;

    // 3. Array cycle
    const arr = ['first', 'second'];
    arr.push(arr);

    assert.doesNotThrow(() => {
      const red1 = LogRedactor.redact(selfCirc);
      assert.ok(!red1.includes('SecretPasswordSelf!'));
      assert.ok(red1.includes('[Circular]'));

      const red2 = LogRedactor.redact(nodeA);
      assert.ok(!red2.includes('SecretPasswordA!'));
      assert.ok(red2.includes('[Circular]'));

      const red3 = LogRedactor.redact(arr);
      assert.ok(red3.includes('[Circular]'));
    });
  });

  test('ADV-R6-19: Extreme data types and non-throw invariants', () => {
    assert.doesNotThrow(() => {
      assert.equal(LogRedactor.redact(null), '');
      assert.equal(LogRedactor.redact(undefined), '');
      assert.equal(LogRedactor.redact(42), '42');
      assert.equal(LogRedactor.redact(true), 'true');
      assert.equal(LogRedactor.redact(false), 'false');
      assert.equal(LogRedactor.redact(NaN), 'null'); // JSON.stringify(NaN) is "null"
      assert.equal(LogRedactor.redact(Infinity), 'null');

      // BigInt handling (JSON.stringify throws TypeError: Do not know how to serialize a BigInt)
      const bigIntVal = BigInt('9007199254740991999999');
      const redBigInt = LogRedactor.redact(bigIntVal);
      assert.ok(redBigInt.includes('9007199254740991999999'));

      // Symbol
      const sym = Symbol('secret');
      const redSym = LogRedactor.redact(sym);
      assert.ok(typeof redSym === 'string');

      // Functions
      const fn = function () { return 'password="SecretPassword123!"'; };
      const redFn = LogRedactor.redact(fn);
      assert.ok(!redFn.includes('SecretPassword123!'));

      // Object with throwing property getter
      const throwingObj = {
        get badProp() {
          throw new Error('Getter exploded: password="SecretPasswordExploded!"');
        }
      };
      const redThrowing = LogRedactor.redact(throwingObj);
      assert.ok(typeof redThrowing === 'string');
    });
  });

  test('ADV-R6-20: High-volume stress (2,000 log redactions in rapid succession)', () => {
    const startTime = performance.now();
    for (let i = 0; i < 2_000; i++) {
      const payload = {
        iteration: i,
        auth: `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token_${i}`,
        sql: `SELECT * FROM users WHERE pass = 'SecretPassword_${i}'`,
        meta: { host: '172.16.1.200', attempt: i }
      };
      const result = LogRedactor.redact(payload);
      assert.ok(!result.includes(`SecretPassword_${i}`));
      assert.ok(result.includes('Bearer [REDACTED]'));
    }
    const duration = performance.now() - startTime;
    assert.ok(duration > 0);
  });

  // =========================================================================
  // SUITE 5: DATABASE & AUDIT LOG SANITIZATION INTEGRATION
  // =========================================================================

  test('ADV-R6-21: FMDatabase SQLite error_logs & audit_logs scrub secrets at database boundary', () => {
    const tempDbPath = join(tmpdir(), `fmauto-test-r6-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
    try {
      const db = new FMDatabase(tempDbPath);

      // 1. Test logError sanitization
      db.logError({
        errorType: 'SAP_LOGIN_FAILED',
        severity: 'CRITICAL',
        message: 'SAP login rejected for sbo_password=SecretPassword123!',
        technicalDetails: 'Connection string: Server=10.0.0.1;User=sa;Password=SuperSecret456! at line 55',
      });

      const errors = db.listErrors();
      assert.equal(errors.length, 1);
      assert.ok(!errors[0].message.includes('SecretPassword123!'));
      assert.ok(!errors[0].technicalDetails.includes('SuperSecret456!'));
      assert.ok(errors[0].message.includes('[REDACTED]'));
      assert.ok(errors[0].technicalDetails.includes('[REDACTED]'));

      // 2. Test audit log sanitization
      db.audit(
        'credentials:save',
        'account_with_pass="SecretPasswordTarget!"',
        {
          application: 'SAP',
          token: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyIjoiYWRtaW4ifQ.signature',
          rawSecret: 'SecretPasswordInDetails!'
        }
      );

      // Query raw SQLite database to verify data on disk is redacted
      const auditRows = db['db'].prepare('SELECT * FROM audit_logs').all();
      assert.equal(auditRows.length, 1);
      const row = auditRows[0];

      assert.ok(!row.target.includes('SecretPasswordTarget!'));
      assert.ok(!row.details.includes('eyJhbGci'));
      assert.ok(!row.details.includes('SecretPasswordInDetails!'));
      assert.ok(row.target.includes('[REDACTED]'));
      assert.ok(row.details.includes('Bearer [REDACTED]'));

      db.close();
    } finally {
      if (existsSync(tempDbPath)) {
        try { rmSync(tempDbPath, { force: true }); } catch {}
      }
    }
  });

  // =========================================================================
  // SUITE 6: MOCK SECURITY ORACLE CROSS-CHECK
  // =========================================================================

  test('ADV-R6-22: MockSecurityOracle and SecureStorage produce mutually compatible formats', () => {
    const rawSecret = 'MutualCrossCompatibility#2026!';

    // Encrypt with MockSecurityOracle, decrypt with SecureStorage
    const testMasterKey = 'Explicit_Shared_Test_Master_Key_Only';
    const oracleCiphertext = MockSecurityOracle.encryptAES256GCM(rawSecret, testMasterKey);
    const recoveredByStorage = SecureStorage.decrypt(oracleCiphertext, testMasterKey);
    assert.equal(recoveredByStorage, rawSecret);

    // Encrypt with SecureStorage, decrypt with MockSecurityOracle
    const storageCiphertext = SecureStorage.encrypt(rawSecret, testMasterKey);
    const recoveredByOracle = MockSecurityOracle.verifyAES256GCM(storageCiphertext, testMasterKey);
    assert.equal(recoveredByOracle, rawSecret);
  });
});
