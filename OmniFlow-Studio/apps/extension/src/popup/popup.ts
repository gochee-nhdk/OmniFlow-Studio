import { WorkflowProgress, WorkflowType } from '../types.js';

// DOM Elements
const agentBadge = document.getElementById('agentBadge')!;
const agentStatusText = document.getElementById('agentStatusText')!;
const posLatency = document.getElementById('posLatency')!;
const posIndicator = document.getElementById('posIndicator')!;
const sapLatency = document.getElementById('sapLatency')!;
const sapIndicator = document.getElementById('sapIndicator')!;

const progressSection = document.getElementById('progressSection')!;
const progressSpinner = document.getElementById('progressSpinner')!;
const progressWorkflowName = document.getElementById('progressWorkflowName')!;
const progressPercent = document.getElementById('progressPercent')!;
const progressBar = document.getElementById('progressBar')!;
const progressStep = document.getElementById('progressStep')!;
const btnStopWorkflow = document.getElementById('btnStopWorkflow')!;

const btnDailyAll = document.getElementById('btnDailyAll')!;
const btnSales = document.getElementById('btnSales')!;
const btnInventory = document.getElementById('btnInventory')!;
const btnSap = document.getElementById('btnSap')!;
const btnPosCheck = document.getElementById('btnPosCheck')!;
const btnOpenSidePanel = document.getElementById('btnOpenSidePanel')!;
const btnRefresh = document.getElementById('btnRefresh')!;

// Format Latency
function formatLatency(ms?: number, reachable?: boolean): string {
  if (!reachable) return 'Chưa kết nối';
  if (ms === undefined || ms < 0) return 'Sẵn sàng';
  return `${ms} ms`;
}

// Standalone Mode Badge (always online/ready)
function renderStandaloneBadge(isRunning = false) {
  if (isRunning) {
    agentBadge.className = 'agent-badge running';
    agentStatusText.textContent = '100% Extension • Đang chạy';
  } else {
    agentBadge.className = 'agent-badge online';
    agentStatusText.textContent = '100% Extension • Sẵn sàng';
  }
}

// Update Network Metrics
function renderNetworkMetrics(data: {
  posReachable?: boolean;
  posLatencyMs?: number;
  sapReachable?: boolean;
  sapLatencyMs?: number;
}) {
  if (data.posReachable) {
    posIndicator.className = 'status-indicator up';
    posLatency.textContent = formatLatency(data.posLatencyMs, true);
  } else {
    posIndicator.className = 'status-indicator down';
    posLatency.textContent = 'Chưa kiểm tra';
  }

  if (data.sapReachable) {
    sapIndicator.className = 'status-indicator up';
    sapLatency.textContent = formatLatency(data.sapLatencyMs, true);
  } else {
    sapIndicator.className = 'status-indicator down';
    sapLatency.textContent = 'Chưa kiểm tra';
  }
}

// Update Progress Section
function renderProgress(progress: WorkflowProgress | null) {
  if (!progress || progress.status === 'IDLE') {
    progressSection.classList.add('hidden');
    renderStandaloneBadge(false);
    return;
  }

  progressSection.classList.remove('hidden');
  progressWorkflowName.textContent = getWorkflowFriendlyName(progress.workflowType);
  progressPercent.textContent = `${progress.percent ?? 0}%`;
  progressBar.style.width = `${progress.percent ?? 0}%`;
  progressStep.textContent = progress.step || progress.message || 'Đang thực thi...';

  const isRunning =
    progress.status === 'RUNNING' ||
    progress.status === 'INITIALIZING' ||
    progress.status === 'PENDING' ||
    progress.status === 'RETRYING';

  renderStandaloneBadge(isRunning);
  progressSpinner.classList.toggle('hidden', !isRunning);
  btnStopWorkflow.classList.toggle('hidden', !isRunning);

  if (progress.status === 'SUCCESS' || progress.status === 'SUCCESS_WITH_NO_DATA') {
    progressBar.style.background = '#059669';
    progressStep.textContent = progress.message || 'Hoàn thành thành công!';
  } else if (progress.status === 'FAILED') {
    progressBar.style.background = '#DC2626';
    progressStep.textContent = progress.message || 'Có lỗi xảy ra trong quá trình chạy.';
  } else if (progress.status === 'CANCELLED') {
    progressBar.style.background = '#D97706';
    progressStep.textContent = 'Đã dừng quy trình theo yêu cầu.';
  } else {
    progressBar.style.background = '#2563EB';
  }
}

function getWorkflowFriendlyName(wfType?: string): string {
  switch (wfType) {
    case 'DAILY_PROCUREMENT':
      return 'Daily Procurement (POS + SAP)';
    case 'DOWNLOAD_SALES':
      return 'Doanh số POS';
    case 'DOWNLOAD_INVENTORY':
      return 'Tồn kho POS (12 Kho)';
    case 'SAP_AUTOMATION':
      return 'SAP Business One';
    case 'POS_LOGIN_CHECK':
      return 'Kiểm tra POS';
    case 'SAP_LOGIN_CHECK':
      return 'Kiểm tra SAP';
    default:
      return wfType || 'Quy trình tự động hóa';
  }
}

// Trigger Workflow Helper
async function runWorkflow(workflowType: WorkflowType, params: Record<string, any> = {}) {
  try {
    renderProgress({
      workflowType,
      step: 'Đang khởi chạy trực tiếp trên trình duyệt...',
      percent: 5,
      status: 'RUNNING',
      timestamp: new Date().toISOString(),
    });

    const res = await chrome.runtime.sendMessage({
      action: 'TRIGGER_WORKFLOW',
      workflowType,
      params,
    });

    if (!res?.success) {
      renderProgress({
        workflowType,
        step: 'Lỗi kích hoạt',
        percent: 0,
        status: 'FAILED',
        message: res?.error || 'Không thể khởi chạy quy trình',
        timestamp: new Date().toISOString(),
      });
    }
  } catch (err: any) {
    renderProgress({
      workflowType,
      step: 'Lỗi hệ thống',
      percent: 0,
      status: 'FAILED',
      message: err?.message || 'Lỗi không xác định',
      timestamp: new Date().toISOString(),
    });
  }
}

// Fetch Initial Data
async function loadStatus() {
  renderStandaloneBadge(false);
  try {
    const res = await chrome.runtime.sendMessage({ action: 'GET_STATUS' });
    if (res?.success && res.data) {
      const status = res.data.status || res.data;
      renderNetworkMetrics(status || {});
      if (res.data.progress) {
        renderProgress(res.data.progress);
      }
    }
  } catch (err) {
    console.warn('[Popup] Error getting status:', err);
  }
}

// Event Listeners for 5 Quick Buttons
btnDailyAll.addEventListener('click', () => runWorkflow('DAILY_PROCUREMENT'));
btnSales.addEventListener('click', () => runWorkflow('DOWNLOAD_SALES'));
btnInventory.addEventListener('click', () => runWorkflow('DOWNLOAD_INVENTORY'));
btnSap.addEventListener('click', () => runWorkflow('SAP_AUTOMATION'));
btnPosCheck.addEventListener('click', () => runWorkflow('POS_LOGIN_CHECK'));

// Stop Running Workflow
btnStopWorkflow.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ action: 'ABORT_WORKFLOW' }).catch(() => {});
  renderProgress({
    step: 'Đã dừng',
    percent: 0,
    status: 'CANCELLED',
    timestamp: new Date().toISOString(),
  });
});

// Open Side Panel directly via chrome.sidePanel.open (fallback to background message)
btnOpenSidePanel.addEventListener('click', async () => {
  try {
    const win = await chrome.windows.getCurrent();
    if (win?.id && chrome.sidePanel?.open) {
      await chrome.sidePanel.open({ windowId: win.id });
      window.close();
      return;
    }
  } catch (e) {
    console.warn('[Popup] Direct sidePanel.open failed, falling back:', e);
  }

  try {
    await chrome.runtime.sendMessage({ action: 'OPEN_SIDEPANEL' });
    window.close();
  } catch (e) {
    console.warn(e);
  }
});

// Ping Targets
btnRefresh.addEventListener('click', async () => {
  btnRefresh.style.transform = 'rotate(360deg)';
  btnRefresh.style.transition = 'transform 0.5s ease';
  setTimeout(() => {
    btnRefresh.style.transform = 'none';
    btnRefresh.style.transition = 'none';
  }, 500);

  try {
    const res = await chrome.runtime.sendMessage({ action: 'PING_TARGETS' });
    if (res?.success && res.data) {
      renderNetworkMetrics(res.data);
    }
  } catch {
    // Ignore transient ping errors
  }
  await loadStatus();
});

// Runtime Message Listener for Real-time Streaming Updates
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg?.type) return;

  switch (msg.type) {
    case 'AGENT_STATUS_UPDATED':
      renderNetworkMetrics(msg.payload || {});
      break;

    case 'NETWORK_METRICS_UPDATED':
      renderNetworkMetrics({
        posReachable: msg.payload?.pos?.reachable ?? msg.payload?.posReachable,
        posLatencyMs: msg.payload?.pos?.latencyMs ?? msg.payload?.posLatencyMs,
        sapReachable: msg.payload?.sap?.reachable ?? msg.payload?.sapReachable,
        sapLatencyMs: msg.payload?.sap?.latencyMs ?? msg.payload?.sapLatencyMs,
      });
      break;

    case 'WORKFLOW_PROGRESS':
      renderProgress(msg.payload);
      break;

    case 'WORKFLOW_COMPLETED':
      renderProgress({
        workflowType: msg.payload?.workflowType,
        step: 'Hoàn thành thành công!',
        percent: 100,
        status: 'SUCCESS',
        message: msg.payload?.message || 'Hoàn thành thành công!',
        timestamp: new Date().toISOString(),
      });
      break;

    case 'WORKFLOW_FAILED':
      renderProgress({
        workflowType: msg.payload?.workflowType,
        step: 'Thất bại',
        percent: 0,
        status: 'FAILED',
        message: `Lỗi: ${msg.payload?.error || 'Thất bại'}`,
        timestamp: new Date().toISOString(),
      });
      break;

    case 'WORKFLOW_CANCELLED':
      renderProgress({
        workflowType: msg.payload?.workflowType,
        step: 'Đã dừng',
        percent: 0,
        status: 'CANCELLED',
        timestamp: new Date().toISOString(),
      });
      break;

    case 'WORKFLOW_RESET':
      renderProgress(null);
      break;
  }
});

// Init
document.addEventListener('DOMContentLoaded', () => {
  loadStatus();
});
