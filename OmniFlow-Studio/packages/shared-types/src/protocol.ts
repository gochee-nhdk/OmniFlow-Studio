// ============================================================
// FM AUTO OPS — Agent Service RPC & WebSocket Protocol
// ============================================================

import type {
  IPCChannel,
  WorkflowType,
  WorkflowStatus,
  StepStatus,
  AgentStatus,
  DateRule,
} from './index';

export const DEFAULT_AGENT_SERVICE_PORT = 7779;
export const DEFAULT_AGENT_SERVICE_HOST = '127.0.0.1';
export const DEFAULT_AGENT_WS_PATH = '/ws';
export const DEFAULT_AGENT_WS_URL = `ws://${DEFAULT_AGENT_SERVICE_HOST}:${DEFAULT_AGENT_SERVICE_PORT}${DEFAULT_AGENT_WS_PATH}`;
export const DEFAULT_AGENT_HTTP_URL = `http://${DEFAULT_AGENT_SERVICE_HOST}:${DEFAULT_AGENT_SERVICE_PORT}`;

// ------------------------------------------------------------
// RPC Message Types
// ------------------------------------------------------------

export type RPCMessageType = 'request' | 'response' | 'event' | 'ping' | 'pong';

export interface RPCRequest<T = unknown> {
  id: string;
  type?: 'request';
  channel: IPCChannel | string;
  payload?: T;
  timestamp?: number;
}

export interface RPCResponse<T = unknown> {
  id: string;
  type?: 'response';
  channel?: IPCChannel | string;
  success: boolean;
  data?: T;
  error?: string;
  timestamp?: number;
}

export interface RPCEvent<T = unknown> {
  type: 'event';
  channel: string; // e.g. 'workflow:progress', 'workflow:status', 'agent:status'
  data: T;
  timestamp?: number;
}

export interface RPCPing {
  id?: string;
  type: 'ping';
  timestamp?: number;
}

export interface RPCPong {
  id?: string;
  type: 'pong';
  timestamp?: number;
}

export type RPCMessage<T = unknown> =
  | RPCRequest<T>
  | RPCResponse<T>
  | RPCEvent<T>
  | RPCPing
  | RPCPong;

// JSON-RPC 2.0 Compatibility Types
export interface JsonRpcRequest<T = unknown> {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: T;
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: string | number;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

// ------------------------------------------------------------
// Bridge Connection State
// ------------------------------------------------------------

export type BridgeConnectionMode =
  | 'electron-ipc'
  | 'websocket'
  | 'rest-fallback'
  | 'mock-disconnected';

export interface BridgeConnectionState {
  mode: BridgeConnectionMode;
  isConnected: boolean;
  isReconnecting: boolean;
  reconnectAttempts: number;
  url?: string;
  lastConnectedAt?: number;
  lastDisconnectedAt?: number;
  error?: string;
}

// ------------------------------------------------------------
// Workflow Trigger & Action Payloads
// ------------------------------------------------------------

export interface WorkflowTriggerOptions {
  dateRule?: DateRule;
  dateFrom?: string;
  dateTo?: string;
  selectedSalesStores?: string[];
  selectedInvSlocs?: string[];
  salesDir?: string;
  salesFileName?: string;
  invDir?: string;
  invFileName?: string;
  sapTargetModule?:
    | 'HOME'
    | 'PURCHASING_PO'
    | 'PURCHASING_GRPO'
    | 'PURCHASING_RETURN'
    | 'INVENTORY_STATUS'
    | 'QUERY_PRICELIST';
  sapQueryCategory?: string;
  sapQueryName?: string;
  sapAutoTakeOverSession?: boolean;
  enterpriseId?: string;
  headless?: boolean;
  customSlocInput?: string;
  invItem?: string;
  showFeedback?: boolean;
  [key: string]: unknown;
}

export interface WorkflowTriggerRequest {
  type: WorkflowType | string;
  options?: WorkflowTriggerOptions;
  payload?: WorkflowTriggerOptions;
}

export interface WorkflowStopRequest {
  runId?: string;
}

export interface UserActionResponseRequest {
  runId: string;
  confirmed: boolean;
  notes?: string;
}

// ------------------------------------------------------------
// Event Payloads
// ------------------------------------------------------------

export interface WorkflowProgressEvent {
  runId: string;
  workflowType: WorkflowType | string;
  stepName: string;
  status: StepStatus | WorkflowStatus | string;
  index: number;
  errorMessage?: string;
  durationMs?: number;
  timestamp?: string;
}

export interface WorkflowStatusEvent {
  runId: string;
  workflowType: WorkflowType | string;
  status: WorkflowStatus;
  startedAt?: string;
  completedAt?: string;
  errorSummary?: string;
}

export interface AgentStatusEvent {
  status: AgentStatus;
  timestamp?: string;
}

export interface NetworkProbeResult {
  id?: string;
  name?: string;
  url?: string;
  host?: string;
  port?: number;
  reachable: boolean;
  latencyMs?: number;
  error?: string;
}

export interface NetworkStatusResult {
  sap: boolean;
  pos: boolean;
  sapLatency?: number;
  posLatency?: number;
  checkedAt?: string;
  results?: NetworkProbeResult[];
}

// ------------------------------------------------------------
// REST API Endpoint Contracts
// ------------------------------------------------------------

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  version: string;
  uptime: number;
  mode: 'electron' | 'standalone';
  timestamp: string;
}
