// ============================================================
// FM AUTO OPS — Client Bridge Package Root
// ============================================================

export * from './bridge.js';
export * from './types.js';
export * from './singleton.js';
export * from './helpers.js';

// Re-export common shared-types for consumer convenience
export type {
  IPCChannel,
  BridgeConnectionMode,
  BridgeConnectionState,
  RPCMessage,
  RPCRequest,
  RPCResponse,
  RPCEvent,
  RPCPing,
  RPCPong,
  WorkflowProgressEvent,
  WorkflowStatusEvent,
  AgentStatusEvent,
  NetworkStatusResult,
  WorkflowTriggerOptions,
  HealthResponse,
} from '@fm/shared-types';

export {
  DEFAULT_AGENT_SERVICE_PORT,
  DEFAULT_AGENT_SERVICE_HOST,
  DEFAULT_AGENT_WS_URL,
  DEFAULT_AGENT_HTTP_URL,
} from '@fm/shared-types';
