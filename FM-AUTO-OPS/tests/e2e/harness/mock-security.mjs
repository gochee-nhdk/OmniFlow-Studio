// FM AUTO OPS — Security Test Oracle & Cryptographic Validator
// Implements authenticated AES-256-GCM validation and centralized log redaction auditing.

import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
const TAG_LENGTH = 16; // 128 bits
const DEFAULT_SALT = 'FM_AUTO_OPS_SECURE_SALT_2026';

export class MockSecurityOracle {
  static deriveKey(masterPassword = 'FM_OPS_MASTER_KEY') {
    return crypto.scryptSync(masterPassword, DEFAULT_SALT, 32);
  }

  /**
   * Encrypt plaintext into authenticated AES-256-GCM format: "iv:authTag:ciphertext" (base64 encoded parts)
   */
  static encryptAES256GCM(plaintext, masterPassword = 'FM_OPS_MASTER_KEY') {
    const key = this.deriveKey(masterPassword);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let ciphertext = cipher.update(plaintext, 'utf8', 'base64');
    ciphertext += cipher.final('base64');
    const authTag = cipher.getAuthTag().toString('base64');

    return `${iv.toString('base64')}:${authTag}:${ciphertext}`;
  }

  /**
   * Decrypt and verify authenticated AES-256-GCM string
   */
  static verifyAES256GCM(formattedPayload, masterPassword = 'FM_OPS_MASTER_KEY') {
    if (typeof formattedPayload !== 'string') {
      throw new Error('Payload must be a string formatted as iv:authTag:ciphertext');
    }

    const parts = formattedPayload.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid format: expected 3 colon-delimited parts (iv:authTag:ciphertext)');
    }

    const [ivB64, tagB64, dataB64] = parts;
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(tagB64, 'base64');
    const ciphertext = Buffer.from(dataB64, 'base64');

    if (iv.length !== IV_LENGTH) {
      throw new Error(`Invalid IV length: expected ${IV_LENGTH} bytes, got ${iv.length}`);
    }
    if (authTag.length !== TAG_LENGTH) {
      throw new Error(`Invalid AuthTag length: expected ${TAG_LENGTH} bytes, got ${authTag.length}`);
    }

    const key = this.deriveKey(masterPassword);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, undefined, 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  /**
   * Tamper a formatted payload by flipping a character in the ciphertext or auth tag
   */
  static tamperCiphertext(formattedPayload) {
    const parts = formattedPayload.split(':');
    if (parts.length !== 3) return formattedPayload;

    const data = parts[2];
    const tamperedData = data.length > 2
      ? data.slice(0, 1) + (data[1] === 'A' ? 'B' : 'A') + data.slice(2)
      : 'TAMPERED';
    return `${parts[0]}:${parts[1]}:${tamperedData}`;
  }

  /**
   * Validate that a log redactor scrubs all sensitive tokens
   */
  static simulateLogRedactor(redactorFn, rawPayload, sensitiveTokens = []) {
    const sanitized = redactorFn(rawPayload);
    const sanitizedStr = typeof sanitized === 'string' ? sanitized : JSON.stringify(sanitized);

    for (const token of sensitiveTokens) {
      if (token && sanitizedStr.includes(token)) {
        return {
          leakDetected: true,
          leakedToken: token,
          output: sanitizedStr,
        };
      }
    }
    return {
      leakDetected: false,
      output: sanitizedStr,
    };
  }

  /**
   * Check if a string is raw unencrypted base64-encoded password
   */
  static isUnencryptedBase64(storedValue, originalSecret) {
    try {
      const decoded = Buffer.from(storedValue, 'base64').toString('utf8');
      return decoded === originalSecret;
    } catch {
      return false;
    }
  }
}
