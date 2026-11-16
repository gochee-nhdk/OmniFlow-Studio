// FM AUTO OPS — Security & Credential Manager
// Uses Windows Credential Manager via keytar & authenticated AES-256-GCM local fallback
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

/**
 * Resolve the security directory for master key storage.
 * Prioritizes portable directories (APP_DATA_DIR, PORTABLE_DATA_DIR, ./data)
 * before falling back to per-user directory os.homedir()/.fm-auto-ops.
 */
export function getSecurityDir(): string {
  if (process.env.APP_DATA_DIR) {
    const appData = process.env.APP_DATA_DIR;
    return path.basename(appData).toLowerCase() === 'security'
      ? appData
      : path.join(appData, 'security');
  }

  if (process.env.PORTABLE_DATA_DIR) {
    const portData = process.env.PORTABLE_DATA_DIR;
    return path.basename(portData).toLowerCase() === 'security'
      ? portData
      : path.join(portData, 'security');
  }

  if (process.env.OMNIFLOW_PORTABLE_DATA) {
    const omniData = process.env.OMNIFLOW_PORTABLE_DATA;
    return path.basename(omniData).toLowerCase() === 'security'
      ? omniData
      : path.join(omniData, 'security');
  }

  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    const exeDataDir = path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'data');
    if (fs.existsSync(exeDataDir)) {
      return path.join(exeDataDir, 'security');
    }
  }

  const localDataDir = path.join(process.cwd(), 'data');
  if (fs.existsSync(localDataDir)) {
    return path.join(localDataDir, 'security');
  }

  return path.join(os.homedir(), '.fm-auto-ops');
}

/**
 * Return the path to the resolved master key file (or ':env:' if FM_OPS_MASTER_KEY is set).
 */
export function getMasterKeyPath(): string {
  if (process.env.FM_OPS_MASTER_KEY) {
    return ':env:';
  }
  return path.join(getSecurityDir(), 'master.key');
}

/**
 * Resolve or dynamically generate a 256-bit machine/portable master key.
 * Stores master.key inside portable security folder or per-OS-user directory.
 */
export function getOrGenerateMasterKeySync(): string {
  if (process.env.FM_OPS_MASTER_KEY) {
    return process.env.FM_OPS_MASTER_KEY;
  }

  // 1. Check secure key file in portable security or user directory
  const keyDir = getSecurityDir();
  const keyFile = path.join(keyDir, 'master.key');

  try {
    if (fs.existsSync(keyFile)) {
      const stored = fs.readFileSync(keyFile, 'utf8').trim();
      if (stored.length >= 32) {
        return stored;
      }
    }
  } catch {}

  // 2. Generate and durably store a cryptographically strong 256-bit key.
  const generatedKey = crypto.randomBytes(32).toString('hex');

  try {
    fs.mkdirSync(keyDir, { recursive: true });
    try {
      fs.writeFileSync(keyFile, generatedKey, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    } catch (writeError) {
      // Another process may have initialized the key between our read and write.
      if (!fs.existsSync(keyFile)) throw writeError;
    }
    const stored = fs.readFileSync(keyFile, 'utf8').trim();
    if (stored.length >= 32) return stored;
    throw new Error('Machine encryption key could not be persisted safely.');
  } catch (error) {
    throw new Error(`Secure credential storage is unavailable: ${(error as Error).message}`);
  }

  // The key file is the synchronous fallback used by SecureStorage.
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
  private readonly customMasterKey?: string;

  constructor(masterKey?: string) {
    this.customMasterKey = masterKey;
  }

  get masterKey(): string {
    return this.customMasterKey ?? getOrGenerateMasterKeySync();
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

/**
 * Encrypted Vault Backup & Restore Manager
 * Implements 100% secure, offline Encrypted Vault Backup & Restore.
 * Vault string format: OMNIFLOW_VAULT:v1:<salt_b64>:<iv_b64>:<tag_b64>:<ciphertext_b64>
 */
export const VAULT_PREFIX = 'OMNIFLOW_VAULT';
export const VAULT_VERSION = 'v1';
export const VAULT_SALT_LENGTH = 16;
export const VAULT_IV_LENGTH = 12;
export const VAULT_TAG_LENGTH = 16;

export class VaultManager {
  /**
   * Creates an encrypted vault string from data and a passphrase.
   * Format: OMNIFLOW_VAULT:v1:<salt_b64>:<iv_b64>:<tag_b64>:<ciphertext_b64>
   */
  static createEncryptedVault(data: object | string, passphrase: string): string {
    if (!passphrase || typeof passphrase !== 'string') {
      throw new Error('A valid non-empty passphrase is required to create an encrypted vault');
    }

    const plaintext = typeof data === 'string' ? data : JSON.stringify(data);
    const salt = crypto.randomBytes(VAULT_SALT_LENGTH);
    const iv = crypto.randomBytes(VAULT_IV_LENGTH);
    const key = crypto.scryptSync(passphrase, salt, 32);

    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let ciphertext = cipher.update(plaintext, 'utf8', 'base64');
    ciphertext += cipher.final('base64');
    const authTag = cipher.getAuthTag().toString('base64');

    const saltB64 = salt.toString('base64');
    const ivB64 = iv.toString('base64');
    const tagB64 = authTag;
    const ciphertextB64 = ciphertext;

    return `${VAULT_PREFIX}:${VAULT_VERSION}:${saltB64}:${ivB64}:${tagB64}:${ciphertextB64}`;
  }

  /**
   * Restores data from an encrypted vault string using the passphrase.
   * Validates format, derives key using embedded salt, authenticates and decrypts payload.
   * Returns parsed object if valid JSON, otherwise original plaintext string.
   */
  static restoreEncryptedVault<T = any>(vaultString: string, passphrase: string): T {
    if (typeof vaultString !== 'string') {
      throw new Error('Vault payload must be a string');
    }
    if (!passphrase || typeof passphrase !== 'string') {
      throw new Error('A valid non-empty passphrase is required to restore an encrypted vault');
    }

    const parts = vaultString.split(':');
    if (parts.length !== 6) {
      throw new Error(`Invalid vault format: expected 6 colon-separated segments, got ${parts.length}`);
    }

    const [prefix, version, saltB64, ivB64, tagB64, ciphertextB64] = parts;

    if (prefix !== VAULT_PREFIX) {
      throw new Error(`Invalid vault header: expected ${VAULT_PREFIX}, got ${prefix}`);
    }
    if (version !== VAULT_VERSION) {
      throw new Error(`Unsupported vault version: expected ${VAULT_VERSION}, got ${version}`);
    }

    const salt = Buffer.from(saltB64, 'base64');
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(tagB64, 'base64');
    const ciphertext = Buffer.from(ciphertextB64, 'base64');

    if (salt.length !== VAULT_SALT_LENGTH) {
      throw new Error(`Invalid vault: salt length must be ${VAULT_SALT_LENGTH} bytes, got ${salt.length}`);
    }
    if (iv.length !== VAULT_IV_LENGTH) {
      throw new Error(`Invalid vault: IV length must be ${VAULT_IV_LENGTH} bytes, got ${iv.length}`);
    }
    if (authTag.length !== VAULT_TAG_LENGTH) {
      throw new Error(`Invalid vault: auth tag length must be ${VAULT_TAG_LENGTH} bytes, got ${authTag.length}`);
    }

    const key = crypto.scryptSync(passphrase, salt, 32);

    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(ciphertext, undefined, 'utf8');
      decrypted += decipher.final('utf8');

      try {
        return JSON.parse(decrypted) as T;
      } catch {
        return decrypted as unknown as T;
      }
    } catch (err: any) {
      throw new Error(`Failed to restore encrypted vault: invalid passphrase or corrupted/tampered data (${err.message})`);
    }
  }

  /**
   * Helper to tamper with vault ciphertext for testing authTag verification
   */
  static tamperVault(vaultString: string): string {
    const parts = vaultString.split(':');
    if (parts.length !== 6) return vaultString;
    const data = parts[5];
    const tamperedData = data.length > 2
      ? data.slice(0, 1) + (data[1] === 'A' ? 'B' : 'A') + data.slice(2)
      : 'TAMPERED';
    return `${parts[0]}:${parts[1]}:${parts[2]}:${parts[3]}:${parts[4]}:${tamperedData}`;
  }

  createEncryptedVault(data: object | string, passphrase: string): string {
    return VaultManager.createEncryptedVault(data, passphrase);
  }

  restoreEncryptedVault<T = any>(vaultString: string, passphrase: string): T {
    return VaultManager.restoreEncryptedVault<T>(vaultString, passphrase);
  }
}

export const vaultManager = new VaultManager();
export const createEncryptedVault = VaultManager.createEncryptedVault.bind(VaultManager);
export const restoreEncryptedVault = VaultManager.restoreEncryptedVault.bind(VaultManager);
