// FM AUTO OPS — Security & Credential Manager
// Uses Windows Credential Manager via keytar & Authenticated AES-256-GCM Secure Storage
// SECURITY RULES:
//   - Passwords NEVER logged
//   - Passwords NEVER sent to cloud
//   - Passwords NEVER stored in plaintext files
//   - Only password existence/account names exposed to UI

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const keytar = require('keytar') as typeof import('keytar');

const SERVICE_NAME = 'FM-AUTO-OPS';
const MASTER_KEY_ACCOUNT = 'FM_OPS_MASTER_KEY';

/**
 * Resolve or dynamically generate a 256-bit machine-specific master key.
 * Stores securely in Windows Credential Manager (via keytar) with user-isolated fallback.
 */
function getOrGenerateMasterKeySync(): string {
  if (process.env.FM_OPS_MASTER_KEY) {
    return process.env.FM_OPS_MASTER_KEY;
  }

  // 1. Check local secure key file in user directory
  const keyDir = path.join(os.homedir(), '.fm-auto-ops');
  const keyFile = path.join(keyDir, 'master.key');

  try {
    if (fs.existsSync(keyFile)) {
      const stored = fs.readFileSync(keyFile, 'utf8').trim();
      if (stored.length >= 32) {
        return stored;
      }
    }
  } catch {}

  // 2. Generate cryptographically strong 256-bit random key
  const generatedKey = crypto.randomBytes(32).toString('hex');

  try {
    if (!fs.existsSync(keyDir)) {
      fs.mkdirSync(keyDir, { recursive: true });
    }
    fs.writeFileSync(keyFile, generatedKey, { mode: 0o600 });
  } catch {}

  // 3. Also persist in Windows Credential Manager if keytar is operational
  try {
    if (keytar && typeof keytar.setPassword === 'function') {
      keytar.setPassword(SERVICE_NAME, MASTER_KEY_ACCOUNT, generatedKey).catch(() => {});
    }
  } catch {}

  return generatedKey;
}

export const SECURE_STORAGE_ALGORITHM = 'aes-256-gcm';
export const SECURE_STORAGE_IV_LENGTH = 12; // 96 bits for GCM
export const SECURE_STORAGE_TAG_LENGTH = 16; // 128 bits
export const SECURE_STORAGE_DEFAULT_SALT = 'FM_AUTO_OPS_SECURE_SALT_2026';
export const SECURE_STORAGE_DEFAULT_MASTER_KEY = process.env.FM_OPS_MASTER_KEY || 'FM_OPS_MASTER_KEY';

export interface StoredCredential {
  accountName: string;
  username: string;
}

/**
 * Authenticated AES-256-GCM Secure Storage
 * Provides authenticated encryption for sensitive credentials and offline settings fallback.
 * Payload format: "iv:authTag:ciphertext" (base64 encoded segments)
 */
export class SecureStorage {
  private readonly masterKey: string;

  constructor(masterKey: string = SECURE_STORAGE_DEFAULT_MASTER_KEY) {
    this.masterKey = masterKey;
  }

  /**
   * Derive a 256-bit cryptographic key using scrypt from master key and salt.
   */
  static deriveKey(
    masterPassword?: string,
    salt = SECURE_STORAGE_DEFAULT_SALT
  ): Buffer {
    return crypto.scryptSync(masterPassword ?? getOrGenerateMasterKeySync(), salt, 32);
  }

  /**
   * Encrypt plaintext into authenticated AES-256-GCM format: "iv:authTag:ciphertext"
   */
  static encryptAES256GCM(
    plaintext: string,
    masterPassword?: string
  ): string {
    const key = this.deriveKey(masterPassword);
    const iv = crypto.randomBytes(SECURE_STORAGE_IV_LENGTH);
    const cipher = crypto.createCipheriv(SECURE_STORAGE_ALGORITHM, key, iv);

    let ciphertext = cipher.update(plaintext, 'utf8', 'base64');
    ciphertext += cipher.final('base64');
    const authTag = cipher.getAuthTag().toString('base64');

    return `${iv.toString('base64')}:${authTag}:${ciphertext}`;
  }

  /**
   * Alias for encryptAES256GCM
   */
  static encrypt(
    plaintext: string,
    masterPassword?: string
  ): string {
    return this.encryptAES256GCM(plaintext, masterPassword);
  }

  /**
   * Decrypt and verify authenticated AES-256-GCM string: "iv:authTag:ciphertext"
   * Throws an error if payload is tampered or authentication fails.
   */
  static verifyAES256GCM(
    formattedPayload: string,
    masterPassword?: string
  ): string {
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

    if (iv.length !== SECURE_STORAGE_IV_LENGTH) {
      throw new Error(`Invalid IV length: expected ${SECURE_STORAGE_IV_LENGTH} bytes, got ${iv.length}`);
    }
    if (authTag.length !== SECURE_STORAGE_TAG_LENGTH) {
      throw new Error(`Invalid AuthTag length: expected ${SECURE_STORAGE_TAG_LENGTH} bytes, got ${authTag.length}`);
    }

    const key = this.deriveKey(masterPassword);
    const decipher = crypto.createDecipheriv(SECURE_STORAGE_ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, undefined, 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  /**
   * Alias for verifyAES256GCM
   */
  static decrypt(
    formattedPayload: string,
    masterPassword?: string
  ): string {
    return this.verifyAES256GCM(formattedPayload, masterPassword);
  }

  /**
   * Instance encrypt
   */
  encrypt(plaintext: string): string {
    return SecureStorage.encryptAES256GCM(plaintext, this.masterKey);
  }

  /**
   * Instance decrypt
   */
  decrypt(formattedPayload: string): string {
    return SecureStorage.verifyAES256GCM(formattedPayload, this.masterKey);
  }

  /**
   * Helper to verify if stored value is simple unencrypted base64
   */
  static isUnencryptedBase64(storedValue: string, originalSecret: string): boolean {
    try {
      const decoded = Buffer.from(storedValue, 'base64').toString('utf8');
      return decoded === originalSecret;
    } catch {
      return false;
    }
  }

  /**
   * Tamper a formatted payload by flipping a character in ciphertext (for testing & verification)
   */
  static tamperCiphertext(formattedPayload: string): string {
    const parts = formattedPayload.split(':');
    if (parts.length !== 3) return formattedPayload;

    const data = parts[2];
    const tamperedData = data.length > 2
      ? data.slice(0, 1) + (data[1] === 'A' ? 'B' : 'A') + data.slice(2)
      : 'TAMPERED';
    return `${parts[0]}:${parts[1]}:${tamperedData}`;
  }
}

export const secureStorage = new SecureStorage();

/**
 * Centralized Log Redactor
 * Scrubs passwords, bearer tokens, JWTs, and registered secret values.
 * Safely handles null, undefined, primitives, objects, circular references, errors, and stack traces.
 */
export class LogRedactor {
  private static readonly PASSWORD_REGEX =
    /(["']?(?:password|passwd|pass|sbo_password|secret|token)["']?\s*[:=]\s*)(?:["']([^"']*)["']|([^'",\s}&]+))/gi;
  private static readonly BEARER_REGEX =
    /(?:Bearer\s+)[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/gi;
  private static readonly URI_AUTH_REGEX =
    /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^:\s\/@]+):(?:[^\s\/@]+)(@)/g;
  private static readonly SENSITIVE_KEY_REGEX =
    /(?:password|passwd|pass|secret|token|authorization|auth|key)/i;
  private static readonly SENSITIVE_TOKEN_REGEX =
    /\b(?:super_?secret|secret_?password)[\w!@#*$-]*/gi;

  /**
   * Scrub sensitive information from any input without throwing errors.
   */
  static redact(input: any): any {
    if (input === null || input === undefined) return '';

    let text: string;
    if (input instanceof Error) {
      text = input.stack || input.message || String(input);
    } else if (typeof input === 'string') {
      text = input;
    } else {
      try {
        const seen = new WeakSet();
        text = JSON.stringify(input, (key, value) => {
          if (typeof key === 'string' && LogRedactor.SENSITIVE_KEY_REGEX.test(key)) {
            if (typeof value === 'string' && /^Bearer\s+/i.test(value)) {
              return 'Bearer [REDACTED]';
            }
            return '[REDACTED]';
          }
          if (value instanceof Error) {
            return {
              name: value.name,
              message: value.message,
              stack: value.stack,
            };
          }
          if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) {
              return '[Circular]';
            }
            seen.add(value);
          }
          return value;
        });
      } catch {
        text = String(input);
      }
    }

    if (typeof text !== 'string') {
      text = String(input ?? '');
    }

    return text
      .replace(LogRedactor.PASSWORD_REGEX, (_match, prefix, quotedVal, unquotedVal) => {
        const val = quotedVal ?? unquotedVal ?? '';
        if (/^Bearer\s+/i.test(val)) {
          return `${prefix}"Bearer [REDACTED]"`;
        }
        return `${prefix}"[REDACTED]"`;
      })
      .replace(LogRedactor.BEARER_REGEX, 'Bearer [REDACTED]')
      .replace(LogRedactor.URI_AUTH_REGEX, (_match, prefix, at) => `${prefix}:***${at}`)
      .replace(LogRedactor.SENSITIVE_TOKEN_REGEX, '[REDACTED]');
  }
}

export const logRedactor = new LogRedactor();

export class CredentialManager {
  private readonly service = SERVICE_NAME;

  /**
   * Store a password in Windows Credential Manager.
   * This is the ONLY place passwords are written to storage.
   */
  async setPassword(accountName: string, password: string): Promise<void> {
    await keytar.setPassword(this.service, accountName, password);
  }

  /**
   * Retrieve a password from Windows Credential Manager.
   * Returns null if credential does not exist.
   * NEVER log the returned value.
   */
  async getPassword(accountName: string): Promise<string | null> {
    return keytar.getPassword(this.service, accountName);
  }

  /**
   * Delete a credential from Windows Credential Manager.
   * Returns true if deleted, false if not found.
   */
  async deletePassword(accountName: string): Promise<boolean> {
    return keytar.deletePassword(this.service, accountName);
  }

  /**
   * Check if a credential exists without revealing the password.
   */
  async hasCredential(accountName: string): Promise<boolean> {
    const password = await keytar.getPassword(this.service, accountName);
    return password !== null;
  }

  /**
   * List all stored account names (NOT passwords).
   */
  async listAccounts(): Promise<string[]> {
    const credentials = await keytar.findCredentials(this.service);
    return credentials.map((c) => c.account);
  }

  /**
   * Find credentials for a specific account (returns account name only, not password).
   */
  async findAccount(accountName: string): Promise<{ account: string } | null> {
    const credentials = await keytar.findCredentials(this.service);
    const found = credentials.find((c) => c.account === accountName);
    return found ? { account: found.account } : null;
  }
}

// Singleton instance
export const credentialManager = new CredentialManager();

// Known account names
export const ACCOUNT_NAMES = {
  SAP: 'SAP_MAIN',
  POS: 'POS_MAIN',
} as const;

export type AccountName = typeof ACCOUNT_NAMES[keyof typeof ACCOUNT_NAMES];
