// ============================================================
// FM AUTO OPS — Type-Safe Domain Helpers for Client Bridge
// ============================================================

import type {
  WorkflowType,
  WorkflowRun,
  AgentStatus,
  AppSettings,
  EnterpriseProfile,
  ErrorLogEntry,
  NetworkStatusResult,
  WorkflowTriggerOptions,
} from '@fm/shared-types';

import { ClientBridge } from './bridge.js';
import { getClientBridge } from './singleton.js';

function resolveBridge(bridge?: ClientBridge): ClientBridge {
  return bridge || getClientBridge();
}

/**
 * Triggers a workflow (e.g. POS, SAP, Daily Procurement)
 */
export async function triggerWorkflow(
  type: WorkflowType | string,
  options?: WorkflowTriggerOptions,
  bridge?: ClientBridge
): Promise<{ success: boolean; runId?: string; error?: string }> {
  return resolveBridge(bridge).invoke<{ success: boolean; runId?: string; error?: string }>(
    'workflow:start',
    { type, options, payload: options }
  );
}

/**
 * Stops an active workflow run
 */
export async function stopWorkflow(
  runId?: string,
  bridge?: ClientBridge
): Promise<{ success: boolean; error?: string }> {
  return resolveBridge(bridge).invoke<{ success: boolean; error?: string }>(
    'workflow:stop',
    { runId }
  );
}

/**
 * Gets live Agent Status (heartbeat, auth states, browser status)
 */
export async function getAgentStatus(
  bridge?: ClientBridge
): Promise<AgentStatus> {
  return resolveBridge(bridge).invoke<AgentStatus>('agent:status');
}

/**
 * Checks connectivity to SAP and POS systems with latency
 */
export async function checkNetwork(
  options?: {
    sapHost?: string;
    sapPort?: number;
    posHost?: string;
    posPort?: number;
    showFeedback?: boolean;
  },
  bridge?: ClientBridge
): Promise<NetworkStatusResult> {
  return resolveBridge(bridge).invoke<NetworkStatusResult>('network:check', options);
}

/**
 * Probes all configured endpoints (SAP, POS, custom)
 */
export async function probeEndpoints(
  bridge?: ClientBridge
): Promise<NetworkStatusResult> {
  return resolveBridge(bridge).invoke<NetworkStatusResult>('network:probe-endpoints');
}

/**
 * Retrieves the workflow run execution history
 */
export async function getWorkflowHistory(
  bridge?: ClientBridge
): Promise<WorkflowRun[]> {
  return resolveBridge(bridge).invoke<WorkflowRun[]>('workflow:history');
}

/**
 * Retrieves current application settings
 */
export async function getAppSettings(
  bridge?: ClientBridge
): Promise<AppSettings | null> {
  return resolveBridge(bridge).invoke<AppSettings | null>('settings:get');
}

/**
 * Updates application settings
 */
export async function setAppSettings(
  settings: Partial<AppSettings>,
  bridge?: ClientBridge
): Promise<AppSettings> {
  return resolveBridge(bridge).invoke<AppSettings>('settings:set', settings);
}

/**
 * Retrieves enterprise multi-tenant profiles
 */
export async function getEnterpriseProfiles(
  bridge?: ClientBridge
): Promise<{ profiles: EnterpriseProfile[]; activeId: string }> {
  return resolveBridge(bridge).invoke<{ profiles: EnterpriseProfile[]; activeId: string }>(
    'enterprise:list'
  );
}

/**
 * Saves or updates an enterprise profile
 */
export async function saveEnterpriseProfile(
  profile: Partial<EnterpriseProfile>,
  bridge?: ClientBridge
): Promise<{ profile: EnterpriseProfile; profiles: EnterpriseProfile[]; activeId: string }> {
  return resolveBridge(bridge).invoke('enterprise:save', profile);
}

/**
 * Sets the active enterprise profile
 */
export async function setActiveEnterpriseProfile(
  id: string,
  bridge?: ClientBridge
): Promise<{ success: boolean; activeId: string }> {
  return resolveBridge(bridge).invoke('enterprise:setActive', { id });
}

/**
 * Deletes an enterprise profile
 */
export async function deleteEnterpriseProfile(
  id: string,
  bridge?: ClientBridge
): Promise<{ success: boolean }> {
  return resolveBridge(bridge).invoke('enterprise:delete', { id });
}

/**
 * Retrieves the system error logs
 */
export async function getErrors(
  bridge?: ClientBridge
): Promise<ErrorLogEntry[]> {
  return resolveBridge(bridge).invoke<ErrorLogEntry[]>('errors:list');
}

/**
 * Clears the error logs
 */
export async function clearErrors(
  bridge?: ClientBridge
): Promise<{ success: boolean }> {
  return resolveBridge(bridge).invoke<{ success: boolean }>('errors:clear');
}

/**
 * Responds to a pending user interaction request during automation
 */
export async function respondToUserAction(
  runId: string,
  confirmed: boolean,
  notes?: string,
  bridge?: ClientBridge
): Promise<{ success: boolean }> {
  return resolveBridge(bridge).invoke<{ success: boolean }>(
    'user-action:respond',
    { runId, confirmed, notes }
  );
}

/**
 * Requests the local OS file manager to open a directory
 */
export async function openDirectory(
  dirPath: string,
  bridge?: ClientBridge
): Promise<void> {
  return resolveBridge(bridge).invoke<void>('files:open-dir', { path: dirPath });
}
