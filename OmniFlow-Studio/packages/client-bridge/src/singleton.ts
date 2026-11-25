// ============================================================
// FM AUTO OPS — Client Bridge Singleton & Convenience Access
// ============================================================

import { ClientBridge } from './bridge.js';
import type { ClientBridgeOptions } from './types.js';
import type { IPCChannel } from '@fm/shared-types';

let defaultBridgeInstance: ClientBridge | null = null;

/**
 * Returns the default singleton ClientBridge instance.
 * Automatically initializes if not already created.
 */
export function getClientBridge(options?: ClientBridgeOptions): ClientBridge {
  if (!defaultBridgeInstance) {
    defaultBridgeInstance = new ClientBridge(options);
  }
  return defaultBridgeInstance;
}

/**
 * Resets or destroys the current default singleton bridge.
 * Useful for tests or connection re-configuration.
 */
export function resetClientBridge(): void {
  if (defaultBridgeInstance) {
    defaultBridgeInstance.disconnect();
    defaultBridgeInstance = null;
  }
}

/**
 * Convenience invoke function using the default singleton bridge.
 */
export async function invoke<T = unknown>(
  channel: IPCChannel | string,
  payload?: unknown
): Promise<T> {
  return getClientBridge().invoke<T>(channel, payload);
}

/**
 * Convenience event subscriber using the default singleton bridge.
 */
export function onEvent<T = unknown>(
  channel: string,
  listener: (data: T) => void
): () => void {
  return getClientBridge().on<T>(channel, listener);
}

/**
 * Checks if running inside an Electron environment.
 */
export function isElectron(): boolean {
  return getClientBridge().isElectron();
}
