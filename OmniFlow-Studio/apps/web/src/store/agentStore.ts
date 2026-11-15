import { create } from 'zustand';
import { invoke, onEvent } from '../lib/ipc';

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

export interface NetworkFeedback {
  message: string;
  type: 'success' | 'warning' | 'error' | 'info';
  timestamp: number;
}

export interface WorkflowProgress {
  runId: string;
  workflowType: string;
  stepName: string;
  status: string;
  index: number;
  errorMessage?: string;
}

interface AgentStore {
  agentStatus: AgentStatus | null;
  currentRun: WorkflowRun | null;
  recentRuns: WorkflowRun[];
  errors: ErrorEntry[];
  networkStatus: NetworkStatus;
  isCheckingNetwork: boolean;
  networkFeedback: NetworkFeedback | null;
  isLoading: boolean;
  pendingUserAction: { message: string; runId: string } | null;
  activeProgress: WorkflowProgress | null;

  refreshStatus: () => Promise<void>;
  checkNetwork: (options?: { sapHost?: string; sapPort?: number; posHost?: string; posPort?: number; showFeedback?: boolean }) => Promise<NetworkStatus>;
  dismissNetworkFeedback: () => void;
  startWorkflow: (type: string, payload?: unknown) => Promise<void>;
  stopWorkflow: () => Promise<void>;
  respondToUserAction: (runId: string, confirmed: boolean) => Promise<void>;
  loadHistory: () => Promise<void>;
  loadErrors: () => Promise<void>;
  clearErrors: () => Promise<void>;
}

export const useAgentStore = create<AgentStore>((set, get) => {
  // Listen to live background progress events from Electron main
  onEvent('workflow:progress', (raw) => {
    const data = raw as WorkflowProgress;
    set({ activeProgress: data });
    if (data.status === 'SUCCESS' || data.status === 'FAILED') {
      get().loadHistory();
      get().refreshStatus();
    }
  });

  return {
    agentStatus: null,
    currentRun: null,
    recentRuns: [],
    errors: [],
    networkStatus: { sap: true, pos: true },
    isCheckingNetwork: false,
    networkFeedback: null,
    isLoading: false,
    pendingUserAction: null,
    activeProgress: null,

    dismissNetworkFeedback: () => {
      set({ networkFeedback: null });
    },

    refreshStatus: async () => {
      try {
        const status = await invoke<AgentStatus>('agent:status');
        set({ agentStatus: status });
      } catch {
        set({ agentStatus: null });
      }
    },

    checkNetwork: async (options) => {
      set({ isCheckingNetwork: true });
      try {
        const result = await invoke<NetworkStatus>('network:check', {
          sapHost: options?.sapHost,
          sapPort: options?.sapPort,
          posHost: options?.posHost,
          posPort: options?.posPort,
        });
        const updatedStatus = { ...result, lastChecked: new Date().toISOString() };
        set({ networkStatus: updatedStatus });

        if (options?.showFeedback) {
          const bothOk = result.sap && result.pos;
          const posOk = result.pos;
          const sapOk = result.sap;
          let message = 'Đã kiểm tra kết nối: ';
          let type: 'success' | 'warning' | 'error' = 'success';

          if (bothOk) {
            message += 'Cả POS và SAP đều phản hồi tốt (Sẵn sàng)';
            type = 'success';
          } else if (!posOk && !sapOk) {
            message += 'Không thể kết nối cả POS (172.16.1.200) và SAP SLD (172.16.1.210:8100)';
            type = 'error';
          } else if (!posOk) {
            message += 'POS Mất kết nối (172.16.1.200), SAP SLD hoạt động';
            type = 'warning';
          } else {
            message += 'POS kết nối tốt, SAP SLD Mất kết nối (172.16.1.210:8100)';
            type = 'warning';
          }

          set({
            networkFeedback: {
              message,
              type,
              timestamp: Date.now(),
            },
          });
        }
        return updatedStatus;
      } catch {
        const fallbackStatus = { sap: false, pos: false, lastChecked: new Date().toISOString() };
        set({
          networkStatus: fallbackStatus,
          networkFeedback: options?.showFeedback ? {
            message: 'Không thể thăm dò trạng thái mạng (Lỗi IPC)',
            type: 'error',
            timestamp: Date.now(),
          } : get().networkFeedback,
        });
        return fallbackStatus;
      } finally {
        set({ isCheckingNetwork: false });
      }
    },

    startWorkflow: async (type: string, payload?: unknown) => {
      set({
        isLoading: true,
        activeProgress: {
          runId: '',
          workflowType: type,
          stepName: `Bắt đầu quy trình ${type.replace(/_/g, ' ')}...`,
          status: 'RUNNING',
          index: 0,
        },
      });

      try {
        await invoke('workflow:start', { type, payload });
      } catch (err) {
        set({
          activeProgress: {
            runId: '',
            workflowType: type,
            stepName: `Lỗi: ${(err as Error).message}`,
            status: 'FAILED',
            index: 99,
            errorMessage: (err as Error).message,
          },
        });
      } finally {
        set({ isLoading: false });
        await get().loadHistory();
        await get().refreshStatus();
      }
    },

    stopWorkflow: async () => {
      await invoke('workflow:stop');
      set({ isLoading: false, activeProgress: null });
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
  };
});
