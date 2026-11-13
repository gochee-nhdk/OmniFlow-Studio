import { create } from 'zustand';
import { invoke } from '../lib/ipc';

export type WorkflowStatus = 
  | 'IDLE' | 'INITIALIZING' | 'RUNNING' | 'WAITING_FOR_USER'
  | 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED' | 'CANCELLED' | 'PAUSED';

export type AuthState = 
  | 'NOT_CONFIGURED' | 'DISCONNECTED' | 'AUTHENTICATED'
  | 'LOGIN_REQUIRED' | 'AUTH_FAILED' | 'ERROR';

export interface AgentStatus {
  deviceId: string;
  deviceName: string;
  isOnline: boolean;
  version: string;
  lastHeartbeat: string;
  currentStatus: WorkflowStatus;
  sapAuthState: AuthState;
  posAuthState: AuthState;
  browserReady: boolean;
}

export interface WorkflowRun {
  id: string;
  workflowType: string;
  status: WorkflowStatus;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  errorSummary?: string;
  steps: WorkflowStep[];
}

export interface WorkflowStep {
  id: string;
  stepName: string;
  stepIndex: number;
  status: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  errorMessage?: string;
}

export interface ErrorEntry {
  id: string;
  errorType: string;
  severity: 'CRITICAL' | 'ERROR' | 'WARNING' | 'INFO';
  message: string;
  createdAt: string;
  recovered: boolean;
}

export interface NetworkStatus {
  sap: boolean;
  pos: boolean;
  lastChecked?: string;
}

interface AgentStore {
  agentStatus: AgentStatus | null;
  currentRun: WorkflowRun | null;
  recentRuns: WorkflowRun[];
  errors: ErrorEntry[];
  networkStatus: NetworkStatus;
  isLoading: boolean;
  pendingUserAction: { message: string; runId: string } | null;

  refreshStatus: () => Promise<void>;
  checkNetwork: () => Promise<void>;
  startWorkflow: (type: string, payload?: unknown) => Promise<void>;
  stopWorkflow: () => Promise<void>;
  respondToUserAction: (runId: string, confirmed: boolean) => Promise<void>;
  loadHistory: () => Promise<void>;
  loadErrors: () => Promise<void>;
  clearErrors: () => Promise<void>;
}

export const useAgentStore = create<AgentStore>((set) => ({
  agentStatus: null,
  currentRun: null,
  recentRuns: [],
  errors: [],
  networkStatus: { sap: true, pos: true },
  isLoading: false,
  pendingUserAction: null,

  refreshStatus: async () => {
    try {
      const status = await invoke<AgentStatus>('agent:status');
      set({ agentStatus: status });
    } catch {
      set({ agentStatus: null });
    }
  },

  checkNetwork: async () => {
    try {
      const result = await invoke<NetworkStatus>('network:check');
      set({ networkStatus: { ...result, lastChecked: new Date().toISOString() } });
    } catch {
      // Offline fallback
    }
  },

  startWorkflow: async (type: string, payload?: unknown) => {
    set({ isLoading: true });
    try {
      await invoke('workflow:start', { type, payload });
    } finally {
      set({ isLoading: false });
    }
  },

  stopWorkflow: async () => {
    await invoke('workflow:stop');
  },

  respondToUserAction: async (runId: string, confirmed: boolean) => {
    await invoke('user-action:respond', { runId, confirmed });
    set({ pendingUserAction: null });
  },

  loadHistory: async () => {
    try {
      const runs = await invoke<WorkflowRun[]>('workflow:history');
      set({ recentRuns: runs || [] });
    } catch {
      set({ recentRuns: [] });
    }
  },

  loadErrors: async () => {
    try {
      const errors = await invoke<ErrorEntry[]>('errors:list');
      set({ errors: errors || [] });
    } catch {
      set({ errors: [] });
    }
  },

  clearErrors: async () => {
    await invoke('errors:clear');
    set({ errors: [] });
  },
}));
