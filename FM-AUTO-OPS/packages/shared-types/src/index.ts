// ============================================================
// FM AUTO OPS — Shared Types v1.0
// ============================================================

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

export type WorkflowType =
  | 'DAILY_PROCUREMENT'
  | 'DOWNLOAD_INVENTORY'
  | 'DOWNLOAD_SALES'
  | 'SAP_LOGIN_CHECK'
  | 'POS_LOGIN_CHECK'
  | 'CONNECTION_TEST';

export type StepStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'SUCCESS'
  | 'FAILED'
  | 'SKIPPED'
  | 'WAITING_FOR_USER';

export type AuthState =
  | 'NOT_CONFIGURED'
  | 'DISCONNECTED'
  | 'LOGIN_REQUIRED'
  | 'AUTHENTICATING'
  | 'AUTHENTICATED'
  | 'SESSION_EXPIRED'
  | 'AUTH_FAILED'
  | 'CONCURRENT_LOGIN_WARNING' // SAP only — ALWAYS requires human confirmation
  | 'MFA_REQUIRED'
  | 'CAPTCHA_REQUIRED'
  | 'ERROR';

export type ApplicationTarget = 'SAP' | 'POS';

export type DownloadStatus =
  | 'PENDING'
  | 'DOWNLOADING'
  | 'VALIDATING'
  | 'SUCCESS_WITH_DATA'
  | 'SUCCESS_NO_DATA'
  | 'FAILED'
  | 'INVALID'
  | 'BLOCKED';

export type ActionClassification = 'READ_ONLY' | 'WRITE' | 'CRITICAL';

export type ErrorType =
  | 'NETWORK_ERROR'
  | 'AUTH_ERROR'
  | 'SESSION_EXPIRED'
  | 'PAGE_TIMEOUT'
  | 'SELECTOR_NOT_FOUND'
  | 'MODAL_NOT_OPEN'
  | 'TABLE_NOT_LOADED'
  | 'DOWNLOAD_FAILED'
  | 'FILE_INVALID'
  | 'PERMISSION_DENIED'
  | 'BROWSER_CRASH'
  | 'AGENT_DISCONNECTED'
  | 'UNEXPECTED_POPUP'
  | 'MFA_REQUIRED'
  | 'CAPTCHA_REQUIRED'
  | 'CONCURRENT_LOGIN'
  | 'DISK_FULL'
  | 'UNKNOWN';

export type ErrorSeverity = 'CRITICAL' | 'ERROR' | 'WARNING' | 'INFO';

export type RecoveryAction =
  | 'RETRY'
  | 'RELOAD'
  | 'REOPEN_PAGE'
  | 'RELOGIN'
  | 'RESTART_BROWSER'
  | 'WAIT_FOR_USER'
  | 'SKIP'
  | 'STOP';

export type DateRule =
  | 'TODAY'
  | 'YESTERDAY'
  | 'LAST_7_DAYS'
  | 'LAST_30_DAYS'
  | 'CURRENT_WEEK'
  | 'PREVIOUS_WEEK'
  | 'CURRENT_MONTH'
  | 'PREVIOUS_MONTH'
  | 'FIXED_RANGE'
  | 'CUSTOM';

export interface WorkflowRun {
  id: string;
  workflowType: WorkflowType;
  status: WorkflowStatus;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  retryCount: number;
  errorSummary?: string;
  steps: WorkflowStep[];
  downloads: DownloadResult[];
}

export interface WorkflowStep {
  id: string;
  runId: string;
  stepName: string;
  stepIndex: number;
  status: StepStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  retryCount: number;
  errorMessage?: string;
  output?: Record<string, unknown>;
}

export interface DownloadResult {
  id: string;
  runId?: string;
  reportType: 'INVENTORY' | 'SALES' | 'SAP';
  fileName: string;
  filePath: string;
  fileSizeBytes?: number;
  rowCount?: number;
  status: DownloadStatus;
  downloadedAt: string;
  validatedAt?: string;
  checksum?: string;
  validationErrors?: string[];
}

export interface FilterPreset {
  id: string;
  name: string;
  reportType: 'INVENTORY' | 'SALES';
  storeFilter: string;
  dateRule?: DateRule;
  dateFrom?: string;
  dateTo?: string;
  outputDir?: string;
  fileNameTemplate?: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CredentialMetadata {
  id: string;
  accountName: string;
  application: ApplicationTarget;
  username: string;
  url: string;
  isEnabled: boolean;
  lastVerifiedAt?: string;
  authState: AuthState;
}

export interface ErrorLogEntry {
  id: string;
  runId?: string;
  stepId?: string;
  errorType: ErrorType;
  severity: ErrorSeverity;
  message: string;
  technicalDetails?: string;
  recoveryAction?: RecoveryAction;
  recovered: boolean;
  createdAt: string;
}

export interface AgentStatus {
  deviceId: string;
  deviceName: string;
  isOnline: boolean;
  version: string;
  lastHeartbeat: string;
  currentWorkflow?: WorkflowType;
  currentStatus: WorkflowStatus;
  sapAuthState: AuthState;
  posAuthState: AuthState;
  browserReady: boolean;
}

export interface SystemStatus {
  agent: AgentStatus | null;
  sapReachable: boolean;
  posReachable: boolean;
  storageReady: boolean;
  storageFreeBytes?: number;
  lastInventoryDownload?: DownloadResult;
  lastSalesDownload?: DownloadResult;
  lastWorkflowRun?: WorkflowRun;
}

export type IPCChannel =
  | 'workflow:start'
  | 'workflow:stop'
  | 'workflow:status'
  | 'workflow:history'
  | 'agent:status'
  | 'credentials:save'
  | 'credentials:test'
  | 'credentials:delete'
  | 'credentials:get-meta'
  | 'settings:get'
  | 'settings:set'
  | 'network:check'
  | 'browser:launch'
  | 'browser:close'
  | 'files:open-dir'
  | 'files:history'
  | 'errors:list'
  | 'errors:clear'
  | 'user-action:respond';

export interface IPCResponse<T = unknown> {
  id: string;
  success: boolean;
  data?: T;
  error?: string;
}

export interface AppSettings {
  general: {
    language: 'vi' | 'en';
    theme: 'light' | 'dark' | 'system';
    timezone: string;
    minimizeToTray: boolean;
    startMinimized: boolean;
    launchOnStartup: boolean;
  };
  storage: {
    rootDir: string;
    inventoryDir: string;
    salesDir: string;
    sapDir: string;
    poDir: string;
    returnDir: string;
    archiveDir: string;
    errorDir: string;
    logsDir: string;
    tempDir: string;
  };
  sap: {
    url: string;
    retryLimit: number;
    sessionTimeoutMs: number;
    pageTimeoutMs: number;
  };
  pos: {
    baseUrl: string;
    dashboardUrl: string;
    inventoryUrl: string;
    salesUrl: string;
    retryLimit: number;
    sessionTimeoutMs: number;
    pageTimeoutMs: number;
  };
  workflows: {
    dailyProcurement: {
      enabled: boolean;
      retryLimit: number;
      stepTimeoutMs: number;
    };
  };
  logging: {
    retentionDays: number;
    debugMode: boolean;
    logToFile: boolean;
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  general: {
    language: 'vi',
    theme: 'system',
    timezone: 'Asia/Ho_Chi_Minh',
    minimizeToTray: true,
    startMinimized: false,
    launchOnStartup: false,
  },
  storage: {
    rootDir: 'D:\\FM_AUTO_OPS',
    inventoryDir: 'D:\\FM_AUTO_OPS\\Inventory',
    salesDir: 'D:\\FM_AUTO_OPS\\Sales',
    sapDir: 'D:\\FM_AUTO_OPS\\SAP',
    poDir: 'D:\\FM_AUTO_OPS\\PO',
    returnDir: 'D:\\FM_AUTO_OPS\\Return',
    archiveDir: 'D:\\FM_AUTO_OPS\\Archive',
    errorDir: 'D:\\FM_AUTO_OPS\\Error',
    logsDir: 'D:\\FM_AUTO_OPS\\Logs',
    tempDir: 'D:\\FM_AUTO_OPS\\Temp',
  },
  sap: {
    url: 'https://172.16.1.210:8100/dispatcher/',
    retryLimit: 3,
    sessionTimeoutMs: 30000,
    pageTimeoutMs: 60000,
  },
  pos: {
    baseUrl: 'http://172.16.1.200/',
    dashboardUrl: 'http://172.16.1.200/shop',
    inventoryUrl: 'http://172.16.1.200/admin/report/inventory-onhand',
    salesUrl: 'http://172.16.1.200/admin/report/sales-transaction-detail',
    retryLimit: 3,
    sessionTimeoutMs: 30000,
    pageTimeoutMs: 60000,
  },
  workflows: {
    dailyProcurement: {
      enabled: true,
      retryLimit: 3,
      stepTimeoutMs: 120000,
    },
  },
  logging: {
    retentionDays: 30,
    debugMode: false,
    logToFile: true,
  },
};
