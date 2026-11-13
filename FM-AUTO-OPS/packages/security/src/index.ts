// FM AUTO OPS — Credential Manager
// Uses Windows Credential Manager via keytar
// SECURITY RULES:
//   - Passwords NEVER logged
//   - Passwords NEVER sent to cloud
//   - Passwords NEVER stored in plaintext files
//   - Only password existence/account names exposed to UI

// eslint-disable-next-line @typescript-eslint/no-require-imports
const keytar = require('keytar') as typeof import('keytar');

const SERVICE_NAME = 'FM-AUTO-OPS';

export interface StoredCredential {
  accountName: string;
  username: string;
}

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
