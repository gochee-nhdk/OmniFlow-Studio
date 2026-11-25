// ============================================================
// FM AUTO OPS — Client Bridge Types
// ============================================================

import type {
  IPCChannel,
  BridgeConnectionMode,
  BridgeConnectionState,
  HealthResponse,
} from '@fm/shared-types';

export interface ClientBridgeOptions {
  /**
   * WebSocket server URL
   * @default 'ws://127.0.0.1:7779/ws'
   */
  wsUrl?: string;

  /**
   * HTTP REST server base URL
   * @default 'http://127.0.0.1:7779'
   */
  httpUrl?: string;

  /**
   * Whether to automatically connect on bridge initialization
   * @default true
   */
  autoConnect?: boolean;

  /**
   * Base reconnect interval in milliseconds
   * @default 1500
   */
  reconnectIntervalMs?: number;

  /**
   * Maximum reconnect interval in milliseconds (exponential backoff ceiling)
   * @default 10000
   */
  maxReconnectIntervalMs?: number;

  /**
   * Request timeout in milliseconds for RPC invocations
   * @default 30000
   */
  requestTimeoutMs?: number;

  /**
   * Ping interval in milliseconds for WebSocket heartbeat
   * @default 15000
   */
  pingIntervalMs?: number;

  /**
   * Whether to prefer Electron IPC (contextBridge window.fmAgent) when available
   * @default true
   */
  preferElectronIpc?: boolean;

  /**
   * Optional custom WebSocket constructor (useful in headless Node environments)
   */
  webSocketFactory?: (url: string) => any;

  /**
   * Optional custom fetch implementation
   */
  fetchFn?: typeof fetch;
}

export type BridgeEventListener<T = unknown> = (data: T) => void;

export type BridgeStateListener = (state: BridgeConnectionState) => void;

export interface PendingRequest<T = unknown> {
  id: string;
  channel: string;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
  timer: any;
  createdAt: number;
}

export interface FMAgentBridge {
  invoke: <T>(channel: string, payload?: unknown) => Promise<{ success: boolean; data?: T; error?: string }>;
  on: (channel: string, listener: (data: unknown) => void) => () => void;
}

declare global {
  interface Window {
    fmAgent?: FMAgentBridge;
  }
}
