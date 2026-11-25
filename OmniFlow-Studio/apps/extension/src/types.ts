// ============================================================
// OmniFlow Studio — Standalone Extension Types & Protocol
// ============================================================

export type WorkflowType =
  | 'DAILY_PROCUREMENT'
  | 'POS_AUTOMATION'
  | 'SAP_AUTOMATION'
  | 'DOWNLOAD_INVENTORY'
  | 'DOWNLOAD_SALES'
  | 'SAP_LOGIN_CHECK'
  | 'POS_LOGIN_CHECK'
  | 'CONNECTION_TEST';

export type WorkflowStatus =
  | 'IDLE'
  | 'INITIALIZING'
  | 'PENDING'
  | 'RUNNING'
  | 'WAITING_FOR_USER'
  | 'RETRYING'
  | 'PAUSED'
  | 'SUCCESS'
  | 'SUCCESS_WITH_NO_DATA'
  | 'PARTIAL_SUCCESS'
  | 'FAILED'
  | 'CANCELLED';

export type DateRule = 'TODAY' | 'YESTERDAY' | 'PREVIOUS_WEEK' | 'CUSTOM';

export type WeekConvention = 'sun-sat' | 'mon-sun';

export interface WorkflowProgress {
  runId?: string;
  workflowType?: WorkflowType | string;
  step: string;
  stepIndex?: number;
  totalSteps?: number;
  percent: number;
  status: WorkflowStatus;
  message?: string;
  timestamp: string;
}

export interface AgentStatus {
  isOnline: boolean;
  mode: 'STANDALONE';
  version: string;
  deviceId?: string;
  deviceName?: string;
  currentWorkflow?: WorkflowType;
  currentStatus: WorkflowStatus;
  lastHeartbeat: string;
  posReachable: boolean;
  sapReachable: boolean;
  posLatencyMs?: number;
  sapLatencyMs?: number;
  activeJobsCount?: number;
}

export interface ExtensionLogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  source?: string;
}

export interface DownloadHistoryItem {
  id: string;
  downloadId?: number;
  fileName: string;
  reportType: 'INVENTORY' | 'SALES' | 'SAP';
  filePath?: string;
  fileSizeBytes?: number;
  rowCount?: number;
  status: 'SUCCESS' | 'FAILED' | 'PARTIAL';
  downloadedAt: string;
}

export const POS_12_SLOCS: string[] = [
  'SDC0101',
  'SFF0101',
  'SFM0101',
  'SFM0201',
  'SFM0301',
  'SFM0401',
  'SFM0501',
  'SFM06QT1',
  'SFM07AP1',
  'SFM0801',
  'SFM0901',
  'SFM1001',
];

export interface ExtensionConfig {
  posUrl: string;
  sapUrl: string;
  posUsername: string;
  posPassword: string;
  posPreferredOutlet: string;
  availableSlocs: string[];
  posSlocFilter: string[];
  posItemFilter: string;
  sapUsername: string;
  sapPassword: string;
  sapCompany: string;
  sapServer?: string;
  sapTargetModule: string;
  autoTakeOverSession: boolean;
  dateRule: DateRule;
  weekConvention: WeekConvention;
  customFromDate?: string;
  customToDate?: string;
  pingIntervalSec: number;
  geminiApiKey: string;
}

export const DEFAULT_CONFIG: ExtensionConfig = {
  posUrl: 'http://172.16.1.200',
  sapUrl: 'https://172.16.1.210:8100',
  posUsername: 'TM01',
  posPassword: '',
  posPreferredOutlet: 'FM04',
  availableSlocs: [...POS_12_SLOCS],
  posSlocFilter: [...POS_12_SLOCS],
  posItemFilter: '',
  sapUsername: 'LOG32',
  sapPassword: '',
  sapCompany: 'Công ty TNHH Thương Mại LARIA (FM_PRO)',
  sapServer: '',
  sapTargetModule: 'Price Lists',
  autoTakeOverSession: true,
  dateRule: 'TODAY',
  weekConvention: 'mon-sun',
  pingIntervalSec: 30,
  geminiApiKey: '',
};

// RPC Messages between content script/popup/sidepanel and background
export type ExtensionMessage =
  | { action: 'GET_STATUS' }
  | { action: 'TRIGGER_WORKFLOW'; workflowType: WorkflowType; params?: Record<string, any> }
  | { action: 'ABORT_WORKFLOW'; runId?: string }
  | { action: 'STOP_WORKFLOW'; runId?: string }
  | { action: 'PING_TARGETS' }
  | { action: 'PING_SERVERS' }
  | { action: 'OPEN_SIDEPANEL' }
  | { action: 'OPEN_TARGET_TAB'; target: 'POS' | 'SAP'; url?: string }
  | { action: 'GET_CONFIG' }
  | { action: 'SAVE_CONFIG'; config: Partial<ExtensionConfig> }
  | { action: 'GET_LOGS' }
  | { action: 'CLEAR_LOGS' }
  | { action: 'GET_DOWNLOADS' }
  | { action: 'AGENT_INSPECT' }
  | { action: 'AGENT_SCREENSHOT' }
  | { action: 'AGENT_ACT'; tabId: number; index: number; expectedLabel: string; operation: 'click' | 'fill'; value?: string };

export interface ExtensionResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}
