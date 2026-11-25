// FM AUTO OPS — Type-Safe IPC & WebSocket Bridge
// Wraps ClientBridge (Electron context bridge + WebSocket ws://127.0.0.1:7779 + REST HTTP fallback)

import {
  getClientBridge,
  ClientBridge,
  type IPCChannel,
  type BridgeConnectionState,
} from '@fm/client-bridge';

export { getClientBridge, ClientBridge };
export type { IPCChannel, BridgeConnectionState };

export function isElectron(): boolean {
  return getClientBridge().isElectron();
}

export function getBridgeState(): BridgeConnectionState {
  return getClientBridge().getState();
}

export async function invoke<T = unknown>(channel: IPCChannel | string, payload?: unknown): Promise<T> {
  const bridge = getClientBridge();
  try {
    return await bridge.invoke<T>(channel, payload);
  } catch (err: any) {
    // If not in Electron and agent service is not running (standalone web preview mode),
    // gracefully provide mock data so the Web UI continues to function.
    if (!bridge.isElectron()) {
      const mock = getMockData<T>(channel);
      if (mock !== null && mock !== undefined) {
        return mock;
      }
    }
    throw err;
  }
}

export function onEvent(channel: string, listener: (data: unknown) => void): () => void {
  return getClientBridge().on(channel, listener);
}

function getMockData<T>(channel: string): T | null {
  const mocks: Record<string, unknown> = {
    'agent:status': {
      deviceId: 'local-pc-01',
      deviceName: 'Local Windows RPA Node',
      isOnline: true,
      version: '1.0.0-local',
      lastHeartbeat: new Date().toISOString(),
      currentStatus: 'IDLE',
      sapAuthState: 'NOT_CONFIGURED',
      posAuthState: 'NOT_CONFIGURED',
      browserReady: true,
    },
    'workflow:history': [],
    'errors:list': [],
    'credentials:get-meta': [],
    'enterprise:list': { profiles: [], activeId: '' },
    'settings:get': null,
    'network:check': {
      sap: false,
      pos: false,
      sapLatency: 0,
      posLatency: 0,
      checkedAt: new Date().toISOString(),
    },
    'network:probe-endpoints': {
      results: [],
      checkedAt: new Date().toISOString(),
    },
  };
  return (mocks[channel] ?? null) as T;
}
