// FM AUTO OPS — Type-Safe IPC Bridge
// Wraps window.fmAgent (Electron context bridge) with fallback for standalone browser usage.

type IPCChannel = string;

interface FMAgentBridge {
  invoke: <T>(channel: IPCChannel, payload?: unknown) => Promise<{ success: boolean; data?: T; error?: string }>;
  on: (channel: IPCChannel, listener: (data: unknown) => void) => () => void;
}

declare global {
  interface Window {
    fmAgent?: FMAgentBridge;
  }
}

export function isElectron(): boolean {
  return typeof window !== 'undefined' && typeof window.fmAgent !== 'undefined';
}

export async function invoke<T>(channel: IPCChannel, payload?: unknown): Promise<T> {
  if (isElectron()) {
    const result = await window.fmAgent!.invoke<T>(channel, payload);
    if (!result.success) throw new Error(result.error ?? 'IPC call failed');
    return result.data as T;
  }
  return getMockData<T>(channel);
}

export function onEvent(channel: IPCChannel, listener: (data: unknown) => void): () => void {
  if (isElectron()) {
    return window.fmAgent!.on(channel, listener);
  }
  return () => {};
}

function getMockData<T>(channel: IPCChannel): T {
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
    'network:check': { sap: false, pos: false, sapLatency: 0, posLatency: 0, checkedAt: new Date().toISOString() },
    'network:probe-endpoints': {
      results: [],
      checkedAt: new Date().toISOString(),
    },
  };
  return (mocks[channel] ?? null) as T;
}
