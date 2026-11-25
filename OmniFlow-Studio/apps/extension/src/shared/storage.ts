import { DEFAULT_CONFIG, ExtensionConfig, ExtensionLogEntry, DownloadHistoryItem, WorkflowType } from '../types.js';

const STORAGE_KEYS = {
  CONFIG: 'omniflow_config',
  LOGS: 'omniflow_logs',
  DOWNLOADS: 'omniflow_downloads',
  CHECKPOINT: 'omniflow_workflow_checkpoint',
};

export interface WorkflowCheckpoint {
  runId: string;
  workflowType: WorkflowType;
  stage: string;
  stepIndex: number;
  totalSteps: number;
  percent: number;
  tabId?: number;
  lastScreen?: string;
  completedStages?: string[];
  updatedAt: string;
}

export async function getConfig(): Promise<ExtensionConfig> {
  try {
    const res = await chrome.storage.local.get(STORAGE_KEYS.CONFIG);
    const saved = (res[STORAGE_KEYS.CONFIG] || {}) as Partial<ExtensionConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...saved,
      availableSlocs:
        Array.isArray(saved.availableSlocs) && saved.availableSlocs.length > 0
          ? saved.availableSlocs
          : [...DEFAULT_CONFIG.availableSlocs],
      posSlocFilter:
        Array.isArray(saved.posSlocFilter) && saved.posSlocFilter.length > 0
          ? saved.posSlocFilter
          : [...DEFAULT_CONFIG.posSlocFilter],
    };
  } catch (err) {
    console.warn('[OmniFlow Storage] Failed to get config:', err);
    return {
      ...DEFAULT_CONFIG,
      availableSlocs: [...DEFAULT_CONFIG.availableSlocs],
      posSlocFilter: [...DEFAULT_CONFIG.posSlocFilter],
    };
  }
}

export async function saveConfig(config: Partial<ExtensionConfig>): Promise<ExtensionConfig> {
  try {
    const current = await getConfig();
    const updated: ExtensionConfig = { ...current, ...config };
    await chrome.storage.local.set({ [STORAGE_KEYS.CONFIG]: updated });
    return updated;
  } catch (err) {
    console.error('[OmniFlow Storage] Failed to save config:', err);
    throw err;
  }
}

export async function getLogs(): Promise<ExtensionLogEntry[]> {
  try {
    const res = await chrome.storage.local.get(STORAGE_KEYS.LOGS);
    return res[STORAGE_KEYS.LOGS] || [];
  } catch {
    return [];
  }
}

export async function appendLog(entry: Omit<ExtensionLogEntry, 'id'>): Promise<void> {
  try {
    const logs = await getLogs();
    const newEntry: ExtensionLogEntry = {
      ...entry,
      id: 'log_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    };
    const updated = [newEntry, ...logs].slice(0, 200);
    await chrome.storage.local.set({ [STORAGE_KEYS.LOGS]: updated });
  } catch (err) {
    console.warn('[OmniFlow Storage] Failed to append log:', err);
  }
}

export async function clearLogs(): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.LOGS]: [] });
}

export async function getDownloads(): Promise<DownloadHistoryItem[]> {
  try {
    const res = await chrome.storage.local.get(STORAGE_KEYS.DOWNLOADS);
    return res[STORAGE_KEYS.DOWNLOADS] || [];
  } catch {
    return [];
  }
}

export async function recordDownload(item: DownloadHistoryItem): Promise<void> {
  try {
    const list = await getDownloads();
    const filtered = list.filter((i) => i.id !== item.id);
    const updated = [item, ...filtered].slice(0, 50);
    await chrome.storage.local.set({ [STORAGE_KEYS.DOWNLOADS]: updated });
  } catch (err) {
    console.warn('[OmniFlow Storage] Failed to record download:', err);
  }
}

export async function saveCheckpoint(checkpoint: WorkflowCheckpoint): Promise<void> {
  try {
    if (chrome.storage.session) {
      await chrome.storage.session.set({ [STORAGE_KEYS.CHECKPOINT]: checkpoint });
    }
  } catch (err) {
    console.warn('[OmniFlow Storage] Failed to save checkpoint:', err);
  }
}

export async function getCheckpoint(): Promise<WorkflowCheckpoint | null> {
  try {
    if (!chrome.storage.session) return null;
    const res = await chrome.storage.session.get(STORAGE_KEYS.CHECKPOINT);
    return (res[STORAGE_KEYS.CHECKPOINT] as WorkflowCheckpoint | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function clearCheckpoint(): Promise<void> {
  try {
    if (chrome.storage.session) {
      await chrome.storage.session.remove(STORAGE_KEYS.CHECKPOINT);
    }
  } catch (err) {
    console.warn('[OmniFlow Storage] Failed to clear checkpoint:', err);
  }
}
