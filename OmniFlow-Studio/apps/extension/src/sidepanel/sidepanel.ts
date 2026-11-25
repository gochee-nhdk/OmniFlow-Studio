import {
  DateRule,
  DEFAULT_CONFIG,
  DownloadHistoryItem,
  ExtensionConfig,
  ExtensionLogEntry,
  POS_12_SLOCS,
  WeekConvention,
  WorkflowProgress,
  WorkflowType,
} from '../types.js';
import { AgentPageSnapshot } from '../engines/browser-agent.js';
import { StandardRoutine, matchStandardRoutine } from '../engines/workflow-knowledge.js';

const STORAGE_KEYS = {
  CONFIG: 'omniflow_config',
  LOGS: 'omniflow_logs',
  DOWNLOADS: 'omniflow_downloads',
  THEME: 'omniflow_theme',
};

// DOM Elements
const sideStatusBadge = document.getElementById('sideStatusBadge')!;
const sideStatusText = document.getElementById('sideStatusText')!;
const btnThemeToggle = document.getElementById('btnThemeToggle')!;
const iconSun = document.getElementById('iconSun')!;
const iconMoon = document.getElementById('iconMoon')!;
const tabButtons = document.querySelectorAll<HTMLButtonElement>('.tab-btn');
const tabPanes = document.querySelectorAll<HTMLElement>('.tab-pane');
const agentTask = document.getElementById('agentTask') as HTMLTextAreaElement;
const btnAgentScan = document.getElementById('btnAgentScan') as HTMLButtonElement;
const btnAgentPlan = document.getElementById('btnAgentPlan') as HTMLButtonElement;
const btnAgentExecute = document.getElementById('btnAgentExecute') as HTMLButtonElement;
const agentStatus = document.getElementById('agentStatus')!;
const agentPlan = document.getElementById('agentPlan')!;
const agentScreenshot = document.getElementById('agentScreenshot') as HTMLImageElement;
let agentSnapshot: AgentPageSnapshot | null = null;
let pendingAgentPlan: { kind: 'routine'; routine: StandardRoutine } | { kind: 'action'; index: number; label: string; operation: 'click' | 'fill'; value?: string } | null = null;

// Tab Control
const selectWorkflow = document.getElementById('selectWorkflow') as HTMLSelectElement;
const selectDateRule = document.getElementById('selectDateRule') as HTMLSelectElement;
const customDateRow = document.getElementById('customDateRow')!;
const inputFromDate = document.getElementById('inputFromDate') as HTMLInputElement;
const inputToDate = document.getElementById('inputToDate') as HTMLInputElement;
const inputOutlet = document.getElementById('inputOutlet') as HTMLInputElement;
const slocContainer = document.getElementById('slocContainer')!;
const slocCountBadge = document.getElementById('slocCountBadge')!;
const btnToggleSlocs = document.getElementById('btnToggleSlocs')!;
const inputNewSloc = document.getElementById('inputNewSloc') as HTMLInputElement;
const btnAddSloc = document.getElementById('btnAddSloc')!;
const btnExecuteWorkflow = document.getElementById('btnExecuteWorkflow')!;
const btnStopWorkflow = document.getElementById('btnStopWorkflow')!;
const quickStatusTag = document.getElementById('quickStatusTag')!;
const stepperPercent = document.getElementById('stepperPercent')!;
const stepperMessage = document.getElementById('stepperMessage')!;

// Tab History
const downloadsContent = document.getElementById('downloadsContent')!;
const btnRefreshHistory = document.getElementById('btnRefreshHistory')!;
const btnOpenDownloadsFolder = document.getElementById('btnOpenDownloadsFolder')!;

// Tab Logs
const logTerminal = document.getElementById('logTerminal')!;
const btnClearLogs = document.getElementById('btnClearLogs')!;
const btnCopyLogs = document.getElementById('btnCopyLogs')!;

// Tab Settings (Standalone Local Storage)
const cfgPosUrl = document.getElementById('cfgPosUrl') as HTMLInputElement;
const cfgPosUsername = document.getElementById('cfgPosUsername') as HTMLInputElement;
const cfgPosPassword = document.getElementById('cfgPosPassword') as HTMLInputElement;
const cfgPosPreferredOutlet = document.getElementById('cfgPosPreferredOutlet') as HTMLInputElement;
const cfgPosItemFilter = document.getElementById('cfgPosItemFilter') as HTMLInputElement;
const cfgWeekConvention = document.getElementById('cfgWeekConvention') as HTMLSelectElement;

const cfgSapUrl = document.getElementById('cfgSapUrl') as HTMLInputElement;
const cfgSapUsername = document.getElementById('cfgSapUsername') as HTMLInputElement;
const cfgSapPassword = document.getElementById('cfgSapPassword') as HTMLInputElement;
const cfgSapCompany = document.getElementById('cfgSapCompany') as HTMLInputElement;
const cfgSapTargetModule = document.getElementById('cfgSapTargetModule') as HTMLInputElement;
const cfgAutoTakeOverSession = document.getElementById('cfgAutoTakeOverSession') as HTMLInputElement;
const cfgGeminiApiKey = document.getElementById('cfgGeminiApiKey') as HTMLInputElement;

const configSavedNotice = document.getElementById('configSavedNotice')!;
const btnSaveConfig = document.getElementById('btnSaveConfig')!;
const btnTestConfig = document.getElementById('btnTestConfig')!;

let allSlocsSelected = true;

// ============================================================
// Theme Management (Light Mode Default)
// ============================================================
function applyTheme(theme: 'light' | 'dark') {
  document.documentElement.setAttribute('data-theme', theme);
  iconSun.classList.toggle('hidden', theme === 'light');
  iconMoon.classList.toggle('hidden', theme === 'dark');
}

async function initTheme() {
  try {
    const res = await chrome.storage.local.get(STORAGE_KEYS.THEME);
    const saved = res[STORAGE_KEYS.THEME] === 'dark' ? 'dark' : 'light';
    applyTheme(saved);
  } catch {
    applyTheme('light');
  }
}

btnThemeToggle.addEventListener('click', async () => {
  const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const next = current === 'light' ? 'dark' : 'light';
  applyTheme(next);
  await chrome.storage.local.set({ [STORAGE_KEYS.THEME]: next }).catch(() => {});
});

// ============================================================
// Password Eye Toggles
// ============================================================
document.querySelectorAll<HTMLButtonElement>('.eye-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const targetId = btn.getAttribute('data-target');
    const input = targetId ? (document.getElementById(targetId) as HTMLInputElement | null) : null;
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
  });
});

// ============================================================
// Tab Navigation
// ============================================================
tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    tabButtons.forEach((b) => b.classList.remove('active'));
    tabPanes.forEach((p) => p.classList.remove('active'));

    btn.classList.add('active');
    const targetId = btn.getAttribute('data-tab');
    if (targetId) {
      document.getElementById(targetId)?.classList.add('active');
    }

    if (targetId === 'tab-history') loadDownloads();
    if (targetId === 'tab-logs') loadLogs();
    if (targetId === 'tab-settings') loadConfig();
  });
});

// ============================================================
// Screen-aware browser agent and PDF-derived SOP routines
// ============================================================
function normalizeAgentText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim();
}

function clearAgentPlan(message: string) {
  pendingAgentPlan = null;
  agentPlan.classList.add('hidden');
  btnAgentExecute.classList.add('hidden');
  agentStatus.textContent = message;
}

btnAgentScan.addEventListener('click', async () => {
  btnAgentScan.disabled = true;
  clearAgentPlan('Đang quét tab hiện tại…');
  try {
    const [pageRes, imageRes] = await Promise.all([
      chrome.runtime.sendMessage({ action: 'AGENT_INSPECT' }),
      chrome.runtime.sendMessage({ action: 'AGENT_SCREENSHOT' }).catch(() => null),
    ]);
    if (!pageRes?.success || !pageRes.data?.snapshot) throw new Error(pageRes?.error || 'Không thể đọc tab. Trang có thể bị trình duyệt bảo vệ.');
    agentSnapshot = { ...pageRes.data.snapshot, tabId: pageRes.data.tabId } as AgentPageSnapshot & { tabId: number };
    const { title, url, heading, elements } = agentSnapshot;
    agentStatus.textContent = `${title || 'Tab không tiêu đề'} · ${elements.length} phần tử tương tác · ${url}`;
    if (imageRes?.success && imageRes.data?.dataUrl) {
      agentScreenshot.src = imageRes.data.dataUrl;
      agentScreenshot.classList.remove('hidden');
    } else {
      agentScreenshot.classList.add('hidden');
    }
    agentPlan.innerHTML = `<strong>Đã đọc trang.</strong>${heading ? `<p>${escapeHtml(heading)}</p>` : ''}<ul>${elements.slice(0, 14).map((item) => `<li>${escapeHtml(item.role)} · ${escapeHtml(item.label)}${item.disabled ? ' (không khả dụng)' : ''}</li>`).join('') || '<li>Không tìm thấy phần tử tương tác có nhãn.</li>'}</ul>`;
    agentPlan.classList.remove('hidden');
  } catch (err: any) {
    agentSnapshot = null;
    clearAgentPlan(err?.message || 'Không thể quét tab.');
  } finally {
    btnAgentScan.disabled = false;
  }
});

btnAgentPlan.addEventListener('click', () => {
  if (!agentSnapshot) {
    clearAgentPlan('Hãy bấm “Đọc trang” trước để agent kiểm tra tab hiện tại.');
    return;
  }
  const task = agentTask.value.trim();
  if (!task) {
    clearAgentPlan('Nhập yêu cầu trước khi lập kế hoạch.');
    return;
  }
  const routine = matchStandardRoutine(task);
  if (routine) {
    pendingAgentPlan = { kind: 'routine', routine };
    agentPlan.innerHTML = `<strong>${escapeHtml(routine.label)}</strong><p>Kế hoạch theo hướng dẫn PDF:</p><ol>${routine.checkpoints.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol><p>Thực thi sẽ gọi workflow POS/SAP đã có, workflow sẽ mở đúng hệ thống đã cấu hình và kiểm tra trạng thái từng bước.${routine.manualCompletionRequired ? ' Việc tạo/lưu chứng từ cần người dùng tự kiểm tra và hoàn tất.' : ''}</p>`;
    agentPlan.classList.remove('hidden');
    btnAgentExecute.textContent = 'Duyệt và chạy quy trình';
    btnAgentExecute.classList.remove('hidden');
    agentStatus.textContent = `Nhận diện quy trình chuẩn · nguồn trang ${routine.sourcePages.join(', ')}.`;
    return;
  }

  const fillMatch = task.match(/^(?:điền|nhập|fill)\s+["“]?(.+?)["”]?\s+(?:là|thành|with|to|=)\s+["“]?([\s\S]+?)["”]?$/i);
  const clickMatch = task.match(/^(?:nhấn|bấm|click|mở|chọn)\s+["“]?(.+?)["”]?$/i);
  const operation = fillMatch ? 'fill' : clickMatch ? 'click' : null;
  const requestedTarget = fillMatch?.[1] || clickMatch?.[1];
  if (!operation || !requestedTarget) {
    clearAgentPlan('Chưa khớp quy trình chuẩn hoặc lệnh thao tác đơn giản. Hãy dùng “nhấn [nhãn nút]” / “điền [nhãn trường] là [giá trị]”.');
    return;
  }
  const key = normalizeAgentText(requestedTarget.replace(/["“”]/g, ''));
  const matches = agentSnapshot.elements.filter((item) => normalizeAgentText(item.label) === key);
  const candidates = matches.length ? matches : agentSnapshot.elements.filter((item) => normalizeAgentText(item.label).includes(key));
  if (candidates.length !== 1) {
    clearAgentPlan(candidates.length ? 'Có nhiều phần tử khớp yêu cầu; hãy dùng nhãn cụ thể hơn.' : 'Không tìm thấy phần tử có nhãn khớp trên tab đã quét.');
    return;
  }
  const target = candidates[0];
  if (target.disabled) {
    clearAgentPlan('Phần tử đang bị vô hiệu hóa.');
    return;
  }
  if (operation === 'fill' && !['input', 'textarea', 'select'].includes(target.role) && !['text', 'email', 'search', 'number', 'tel', 'url'].includes(target.kind)) {
    clearAgentPlan('Phần tử đã chọn không phải trường nhập liệu.');
    return;
  }
  pendingAgentPlan = { kind: 'action', index: target.index, label: target.label, operation, value: fillMatch?.[2]?.replace(/["“”]$/g, '') };
  agentPlan.innerHTML = `<strong>Kế hoạch một thao tác</strong><ol><li>${operation === 'click' ? 'Nhấn' : 'Điền'} “${escapeHtml(target.label)}”${operation === 'fill' ? ` với “${escapeHtml(pendingAgentPlan.value || '')}”` : ''}.</li><li>Kiểm tra nhãn và trạng thái phần tử vẫn khớp trước khi thao tác.</li></ol><p>Các nút có thể gửi, xóa, thanh toán, đặt hàng hoặc xác nhận giao dịch sẽ bị chặn.</p>`;
  agentPlan.classList.remove('hidden');
  btnAgentExecute.textContent = 'Duyệt và thao tác';
  btnAgentExecute.classList.remove('hidden');
  agentStatus.textContent = `Một đích khớp duy nhất · ${agentSnapshot.url}`;
});

btnAgentExecute.addEventListener('click', async () => {
  if (!pendingAgentPlan) return;
  btnAgentExecute.disabled = true;
  try {
    if (pendingAgentPlan.kind === 'routine') {
      const { routine } = pendingAgentPlan;
      const result = await chrome.runtime.sendMessage({ action: 'TRIGGER_WORKFLOW', workflowType: routine.workflowType, params: routine.params || {} });
      if (!result?.success) throw new Error(result?.error || 'Workflow không khởi chạy được.');
      agentStatus.textContent = `Đã khởi chạy ${routine.label}. Theo dõi tiến trình ở tab Điều khiển / Console.`;
    } else {
      const snapshot = agentSnapshot as (AgentPageSnapshot & { tabId: number }) | null;
      if (!snapshot?.tabId) throw new Error('Không còn thông tin tab đã quét; hãy quét lại.');
      const plan = pendingAgentPlan;
      const result = await chrome.runtime.sendMessage({ action: 'AGENT_ACT', tabId: snapshot.tabId, index: plan.index, expectedLabel: plan.label, operation: plan.operation, value: plan.value });
      if (!result?.success) throw new Error(result?.error || result?.data?.message || 'Thao tác bị từ chối.');
      agentStatus.textContent = result?.data?.message || 'Thao tác hoàn tất.';
    }
    pendingAgentPlan = null;
    btnAgentExecute.classList.add('hidden');
  } catch (err: any) {
    agentStatus.textContent = err?.message || 'Không thể thực hiện kế hoạch.';
  } finally {
    btnAgentExecute.disabled = false;
  }
});

// ============================================================
// Date Rule Custom Toggle
// ============================================================
selectDateRule.addEventListener('change', () => {
  customDateRow.classList.toggle('hidden', selectDateRule.value !== 'CUSTOM');
});

// ============================================================
// Sloc Checkboxes + Dynamic Add/Remove + Live Count Badge
// ============================================================
let availableSlocsList: string[] = [...POS_12_SLOCS];

function updateSlocCountBadge() {
  const count = getSelectedSlocs().length;
  const total = availableSlocsList.length;
  slocCountBadge.textContent = `${count}/${total} kho`;
  allSlocsSelected = total > 0 && count === total;
  btnToggleSlocs.textContent = allSlocsSelected ? 'Bỏ chọn tất cả' : 'Chọn tất cả';
}

async function persistSlocState() {
  try {
    await chrome.runtime.sendMessage({
      action: 'SAVE_CONFIG',
      config: {
        availableSlocs: availableSlocsList,
        posSlocFilter: getSelectedSlocs(),
      },
    });
  } catch {
    // ignore background sleep
  }
}

function initSlocCheckboxes(selectedSlocs: string[] = availableSlocsList, availableSlocs?: string[]) {
  if (Array.isArray(availableSlocs) && availableSlocs.length > 0) {
    availableSlocsList = Array.from(new Set(availableSlocs.map((s) => s.trim().toUpperCase()).filter(Boolean)));
  }
  slocContainer.innerHTML = '';
  const selectedSet = new Set(selectedSlocs.length > 0 ? selectedSlocs : availableSlocsList);

  availableSlocsList.forEach((code) => {
    const label = document.createElement('label');
    label.className = 'sloc-item';
    const checked = selectedSet.has(code) ? 'checked' : '';
    label.innerHTML = `
      <span class="sloc-item-left">
        <input type="checkbox" value="${escapeHtml(code)}" ${checked}>
        <span>${escapeHtml(code)}</span>
      </span>
      <button type="button" class="sloc-remove-btn" title="Xóa kho ${escapeHtml(code)}" aria-label="Xóa kho ${escapeHtml(code)}">&times;</button>
    `;
    const checkbox = label.querySelector('input')!;
    checkbox.addEventListener('change', () => {
      updateSlocCountBadge();
      persistSlocState();
    });

    const removeBtn = label.querySelector('.sloc-remove-btn') as HTMLButtonElement;
    removeBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (availableSlocsList.length <= 1) return;
      const currentSelected = getSelectedSlocs().filter((c) => c !== code);
      availableSlocsList = availableSlocsList.filter((c) => c !== code);
      initSlocCheckboxes(currentSelected, availableSlocsList);
      await persistSlocState();
    });

    slocContainer.appendChild(label);
  });
  updateSlocCountBadge();
}

async function addNewSlocsFromInput() {
  const raw = inputNewSloc.value.trim();
  if (!raw) return;
  const codes = raw
    .split(/[\s,;]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  if (codes.length === 0) return;

  const currentSelected = new Set(getSelectedSlocs());
  let added = false;
  for (const code of codes) {
    if (!availableSlocsList.includes(code)) {
      availableSlocsList.push(code);
      added = true;
    }
    currentSelected.add(code);
  }
  inputNewSloc.value = '';
  if (added || currentSelected.size > 0) {
    initSlocCheckboxes(Array.from(currentSelected), availableSlocsList);
    await persistSlocState();
  }
}

btnAddSloc.addEventListener('click', addNewSlocsFromInput);
inputNewSloc.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addNewSlocsFromInput();
  }
});

btnToggleSlocs.addEventListener('click', () => {
  const next = !allSlocsSelected;
  const checkboxes = slocContainer.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  checkboxes.forEach((cb) => (cb.checked = next));
  updateSlocCountBadge();
  persistSlocState();
});

function getSelectedSlocs(): string[] {
  const checkboxes = slocContainer.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked');
  return Array.from(checkboxes).map((cb) => cb.value);
}

// ============================================================
// MV3 Service Worker Keep-Alive Port
// ============================================================
let keepAlivePort: chrome.runtime.Port | null = null;
let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
let isWorkflowActive = false;

function startKeepAlivePort() {
  isWorkflowActive = true;
  if (keepAlivePort) return;
  try {
    keepAlivePort = chrome.runtime.connect({ name: 'omniflow-keepalive' });
    keepAlivePort.onDisconnect.addListener(() => {
      keepAlivePort = null;
      if (keepAliveTimer) {
        clearInterval(keepAliveTimer);
        keepAliveTimer = null;
      }
      if (isWorkflowActive) {
        setTimeout(() => {
          if (isWorkflowActive) startKeepAlivePort();
        }, 1000);
      }
    });
    if (!keepAliveTimer) {
      keepAliveTimer = setInterval(() => {
        try {
          keepAlivePort?.postMessage({ type: 'PING', ts: Date.now() });
        } catch {
          // Port disconnected; onDisconnect will handle reconnect if active
        }
      }, 20000);
    }
  } catch {
    keepAlivePort = null;
  }
}

function stopKeepAlivePort() {
  isWorkflowActive = false;
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
  if (keepAlivePort) {
    try {
      keepAlivePort.disconnect();
    } catch {
      // Ignore
    }
    keepAlivePort = null;
  }
}

// ============================================================
// Stepper & Status Badge Updates
// ============================================================
function updateStatusBadge(isRunning = false) {
  if (isRunning) {
    sideStatusBadge.className = 'status-badge running';
    sideStatusText.textContent = 'Đang chạy...';
    startKeepAlivePort();
  } else {
    sideStatusBadge.className = 'status-badge online';
    sideStatusText.textContent = 'Sẵn sàng';
    stopKeepAlivePort();
  }
}

function updateStepper(progress: WorkflowProgress | null) {
  const steps = [1, 2, 3, 4, 5];

  if (!progress || progress.status === 'IDLE') {
    stepperPercent.textContent = '0%';
    stepperMessage.textContent = 'Chờ lệnh thực thi...';
    quickStatusTag.textContent = 'Sẵn sàng';
    quickStatusTag.style.color = 'var(--text-muted)';
    updateStatusBadge(false);
    steps.forEach((i) => {
      const el = document.getElementById(`step-${i}`);
      if (el) el.className = 'stepper-step';
    });
    return;
  }

  const percent = progress.percent ?? 0;
  stepperPercent.textContent = `${percent}%`;
  stepperMessage.textContent = progress.step || progress.message || 'Đang xử lý...';

  const isRunning =
    progress.status === 'RUNNING' ||
    progress.status === 'INITIALIZING' ||
    progress.status === 'PENDING' ||
    progress.status === 'RETRYING';

  updateStatusBadge(isRunning);

  if (isRunning) {
    quickStatusTag.textContent = 'Đang thực thi';
    quickStatusTag.style.color = 'var(--accent-primary)';
  } else if (progress.status === 'SUCCESS' || progress.status === 'SUCCESS_WITH_NO_DATA') {
    quickStatusTag.textContent = 'Hoàn thành';
    quickStatusTag.style.color = 'var(--success-text)';
  } else if (progress.status === 'FAILED') {
    quickStatusTag.textContent = 'Thất bại';
    quickStatusTag.style.color = 'var(--danger-text)';
  } else if (progress.status === 'CANCELLED') {
    quickStatusTag.textContent = 'Đã dừng';
    quickStatusTag.style.color = 'var(--warning-text)';
  } else {
    quickStatusTag.textContent = progress.status;
  }

  const currentIndex = progress.stepIndex
    ? Math.min(5, Math.max(1, progress.stepIndex))
    : Math.min(5, Math.max(1, Math.ceil((percent / 100) * 5)));

  steps.forEach((i) => {
    const el = document.getElementById(`step-${i}`);
    if (!el) return;

    if (progress.status === 'FAILED' && i === currentIndex) {
      el.className = 'stepper-step error';
    } else if (i < currentIndex || progress.status === 'SUCCESS' || progress.status === 'SUCCESS_WITH_NO_DATA') {
      el.className = 'stepper-step completed';
    } else if (i === currentIndex && isRunning) {
      el.className = 'stepper-step active';
    } else {
      el.className = 'stepper-step';
    }
  });
}

// ============================================================
// Workflow Actions
// ============================================================
btnExecuteWorkflow.addEventListener('click', async () => {
  const workflowType = selectWorkflow.value as WorkflowType;
  const dateRule = selectDateRule.value as DateRule;
  const outlet = inputOutlet.value.trim() || 'FM04';
  const slocs = getSelectedSlocs();

  updateStepper({
    workflowType,
    step: 'Đang khởi chạy trực tiếp trên trình duyệt...',
    percent: 10,
    status: 'RUNNING',
    timestamp: new Date().toISOString(),
  });

  try {
    const res = await chrome.runtime.sendMessage({
      action: 'TRIGGER_WORKFLOW',
      workflowType,
      params: {
        dateRule,
        customFromDate: inputFromDate.value || undefined,
        customToDate: inputToDate.value || undefined,
        outlet,
        slocs,
      },
    });

    if (!res?.success) {
      updateStepper({
        workflowType,
        step: res?.error || 'Không thể khởi chạy quy trình',
        percent: 0,
        status: 'FAILED',
        timestamp: new Date().toISOString(),
      });
    }
  } catch (err: any) {
    updateStepper({
      workflowType,
      step: err?.message || 'Lỗi không xác định',
      percent: 0,
      status: 'FAILED',
      timestamp: new Date().toISOString(),
    });
  }
});

btnStopWorkflow.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ action: 'ABORT_WORKFLOW' }).catch(() => {});
  updateStepper({
    step: 'Đã dừng quy trình theo yêu cầu.',
    percent: 0,
    status: 'CANCELLED',
    timestamp: new Date().toISOString(),
  });
});

// ============================================================
// Downloads History
// ============================================================
async function loadDownloads() {
  try {
    const res = await chrome.runtime.sendMessage({ action: 'GET_DOWNLOADS' });
    if (res?.success && Array.isArray(res.data)) {
      renderDownloads(res.data);
      return;
    }
  } catch (err) {
    console.warn('[SidePanel] GET_DOWNLOADS fallback to storage:', err);
  }

  const stored = await chrome.storage.local.get(STORAGE_KEYS.DOWNLOADS);
  const items: DownloadHistoryItem[] = stored[STORAGE_KEYS.DOWNLOADS] || [];
  renderDownloads(items);
}

function renderDownloads(items: DownloadHistoryItem[]) {
  if (items.length === 0) {
    downloadsContent.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="12" y1="18" x2="12" y2="12"></line>
            <line x1="9" y1="15" x2="15" y2="15"></line>
          </svg>
        </div>
        <div class="empty-state-title">Chưa có tệp nào được xuất</div>
        <div class="empty-state-desc">Kết quả Excel từ POS/SAP sẽ hiển thị tại đây sau khi hoàn tất quy trình.</div>
      </div>
    `;
    return;
  }

  downloadsContent.innerHTML = `
    <div class="table-container">
      <table class="data-table">
        <thead>
          <tr>
            <th>Loại</th>
            <th>Tên tệp</th>
            <th>Thời gian</th>
            <th>Mở</th>
          </tr>
        </thead>
        <tbody>
          ${items
            .map(
              (item) => `
            <tr>
              <td><strong>${escapeHtml(item.reportType)}</strong></td>
              <td title="${escapeHtml(item.fileName)}">${escapeHtml(truncate(item.fileName, 22))}</td>
              <td>${formatTime(item.downloadedAt)}</td>
              <td>
                <button class="btn btn-secondary btn-xs btn-open-download" data-download-id="${item.downloadId ?? ''}" title="Mở tệp trong thư mục tải xuống">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                  </svg>
                </button>
              </td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;

  downloadsContent.querySelectorAll<HTMLButtonElement>('.btn-open-download').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idStr = btn.getAttribute('data-download-id');
      const downloadId = idStr ? Number(idStr) : NaN;
      if (!Number.isNaN(downloadId) && downloadId > 0) {
        chrome.downloads.show(downloadId);
      } else {
        chrome.downloads.showDefaultFolder();
      }
    });
  });
}

btnRefreshHistory.addEventListener('click', () => loadDownloads());
btnOpenDownloadsFolder.addEventListener('click', () => {
  chrome.downloads.showDefaultFolder();
});

// ============================================================
// Console Logs
// ============================================================
async function loadLogs() {
  try {
    const res = await chrome.runtime.sendMessage({ action: 'GET_LOGS' });
    if (res?.success && Array.isArray(res.data)) {
      renderLogs(res.data);
      return;
    }
  } catch (err) {
    console.warn('[SidePanel] GET_LOGS fallback to storage:', err);
  }

  const stored = await chrome.storage.local.get(STORAGE_KEYS.LOGS);
  renderLogs(stored[STORAGE_KEYS.LOGS] || []);
}

function renderLogs(logs: ExtensionLogEntry[]) {
  if (logs.length === 0) {
    logTerminal.innerHTML =
      '<div class="log-line"><span class="log-msg" style="color:var(--text-muted);">Chưa có nhật ký hoạt động...</span></div>';
    return;
  }

  logTerminal.innerHTML = logs
    .slice()
    .reverse()
    .map(
      (log) => `
    <div class="log-line">
      <span class="log-time">[${formatTime(log.timestamp)}]</span>
      <span class="log-level ${log.level}">${log.level.toUpperCase()}</span>
      <span class="log-msg">${escapeHtml(log.message)}</span>
    </div>
  `
    )
    .join('');
  logTerminal.scrollTop = logTerminal.scrollHeight;
}

btnClearLogs.addEventListener('click', async () => {
  try {
    await chrome.runtime.sendMessage({ action: 'CLEAR_LOGS' });
  } catch {
    await chrome.storage.local.set({ [STORAGE_KEYS.LOGS]: [] });
  }
  renderLogs([]);
});

btnCopyLogs.addEventListener('click', () => {
  const text = logTerminal.innerText;
  navigator.clipboard.writeText(text);
  showNotice('Đã sao chép toàn bộ nhật ký vào clipboard.');
});

// ============================================================
// Configuration (100% Local Storage)
// ============================================================
function applyConfigToForm(c: ExtensionConfig) {
  cfgPosUrl.value = c.posUrl || DEFAULT_CONFIG.posUrl;
  cfgPosUsername.value = c.posUsername || DEFAULT_CONFIG.posUsername;
  cfgPosPassword.value = c.posPassword || '';
  cfgPosPreferredOutlet.value = c.posPreferredOutlet || DEFAULT_CONFIG.posPreferredOutlet;
  cfgPosItemFilter.value = c.posItemFilter || '';
  cfgWeekConvention.value = c.weekConvention || DEFAULT_CONFIG.weekConvention;

  cfgSapUrl.value = c.sapUrl || DEFAULT_CONFIG.sapUrl;
  cfgSapUsername.value = c.sapUsername || DEFAULT_CONFIG.sapUsername;
  cfgSapPassword.value = c.sapPassword || '';
  cfgSapCompany.value = c.sapCompany || DEFAULT_CONFIG.sapCompany;
  cfgSapTargetModule.value = c.sapTargetModule || DEFAULT_CONFIG.sapTargetModule;
  cfgAutoTakeOverSession.checked = c.autoTakeOverSession ?? DEFAULT_CONFIG.autoTakeOverSession;
  cfgGeminiApiKey.value = c.geminiApiKey || '';

  const prevWeekOption = selectDateRule.querySelector('option[value="PREVIOUS_WEEK"]');
  if (prevWeekOption) {
    prevWeekOption.textContent =
      cfgWeekConvention.value === 'sun-sat'
        ? 'Tuần trước (Chủ nhật - Thứ Bảy)'
        : 'Tuần trước (Thứ Hai - Chủ nhật)';
  }

  inputOutlet.value = c.posPreferredOutlet || DEFAULT_CONFIG.posPreferredOutlet;
  selectDateRule.value = c.dateRule || DEFAULT_CONFIG.dateRule;
  customDateRow.classList.toggle('hidden', selectDateRule.value !== 'CUSTOM');
  if (c.customFromDate) inputFromDate.value = c.customFromDate;
  if (c.customToDate) inputToDate.value = c.customToDate;
  const savedAvailable = Array.isArray(c.availableSlocs) && c.availableSlocs.length > 0 ? c.availableSlocs : POS_12_SLOCS;
  const savedSelected = Array.isArray(c.posSlocFilter) && c.posSlocFilter.length > 0 ? c.posSlocFilter : savedAvailable;
  initSlocCheckboxes(savedSelected, savedAvailable);
}

async function loadConfig() {
  try {
    const res = await chrome.runtime.sendMessage({ action: 'GET_CONFIG' });
    if (res?.success && res.data) {
      applyConfigToForm({ ...DEFAULT_CONFIG, ...res.data });
      return;
    }
  } catch (err) {
    console.warn('[SidePanel] GET_CONFIG fallback to storage:', err);
  }

  const stored = await chrome.storage.local.get(STORAGE_KEYS.CONFIG);
  applyConfigToForm({ ...DEFAULT_CONFIG, ...(stored[STORAGE_KEYS.CONFIG] || {}) });
}

function showNotice(msg: string, isError = false) {
  configSavedNotice.textContent = msg;
  configSavedNotice.className = isError ? 'config-notice error' : 'config-notice';
  setTimeout(() => {
    configSavedNotice.classList.add('hidden');
  }, 3500);
}

btnSaveConfig.addEventListener('click', async () => {
  const updated: Partial<ExtensionConfig> = {
    posUrl: cfgPosUrl.value.trim() || DEFAULT_CONFIG.posUrl,
    posUsername: cfgPosUsername.value.trim() || DEFAULT_CONFIG.posUsername,
    posPassword: cfgPosPassword.value,
    posPreferredOutlet: cfgPosPreferredOutlet.value.trim() || DEFAULT_CONFIG.posPreferredOutlet,
    posItemFilter: cfgPosItemFilter.value.trim(),
    weekConvention: (cfgWeekConvention.value as WeekConvention) || DEFAULT_CONFIG.weekConvention,
    availableSlocs: availableSlocsList,
    posSlocFilter: getSelectedSlocs(),
    sapUrl: cfgSapUrl.value.trim() || DEFAULT_CONFIG.sapUrl,
    sapUsername: cfgSapUsername.value.trim() || DEFAULT_CONFIG.sapUsername,
    sapPassword: cfgSapPassword.value,
    sapCompany: cfgSapCompany.value.trim() || DEFAULT_CONFIG.sapCompany,
    sapTargetModule: cfgSapTargetModule.value.trim() || DEFAULT_CONFIG.sapTargetModule,
    autoTakeOverSession: cfgAutoTakeOverSession.checked,
    geminiApiKey: cfgGeminiApiKey.value.trim(),
    dateRule: selectDateRule.value as DateRule,
    customFromDate: inputFromDate.value || undefined,
    customToDate: inputToDate.value || undefined,
  };

  try {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.CONFIG);
    const merged = { ...DEFAULT_CONFIG, ...(stored[STORAGE_KEYS.CONFIG] || {}), ...updated };
    await chrome.storage.local.set({ [STORAGE_KEYS.CONFIG]: merged });
    await chrome.runtime.sendMessage({ action: 'SAVE_CONFIG', config: updated }).catch(() => {});
    inputOutlet.value = merged.posPreferredOutlet;
    showNotice('Đã lưu cấu hình thành công.');
  } catch (err: any) {
    showNotice(`Không thể lưu cấu hình: ${err?.message || err}`, true);
  }
});

btnTestConfig.addEventListener('click', async () => {
  showNotice('Đang kiểm tra kết nối tới POS & SAP...');
  try {
    const res = await chrome.runtime.sendMessage({ action: 'PING_TARGETS' });
    if (res?.success && res.data) {
      const p = res.data;
      const posTxt = p.posReachable ? `POS: Online (${p.posLatencyMs ?? '--'}ms)` : 'POS: Không phản hồi';
      const sapTxt = p.sapReachable ? `SAP: Online (${p.sapLatencyMs ?? '--'}ms)` : 'SAP: Không phản hồi';
      showNotice(`${posTxt} • ${sapTxt}`, !p.posReachable && !p.sapReachable);
    } else {
      showNotice('Không nhận được phản hồi kiểm tra kết nối.', true);
    }
  } catch (err: any) {
    showNotice(`Lỗi kiểm tra: ${err?.message || err}`, true);
  }
});

// ============================================================
// Runtime & Storage Event Listeners
// ============================================================
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg?.type) return;

  switch (msg.type) {
    case 'WORKFLOW_PROGRESS':
      updateStepper(msg.payload);
      break;

    case 'WORKFLOW_COMPLETED':
      updateStepper({
        workflowType: msg.payload?.workflowType,
        step: msg.payload?.message || 'Hoàn thành thành công!',
        percent: 100,
        status: 'SUCCESS',
        timestamp: new Date().toISOString(),
      });
      loadDownloads();
      break;

    case 'WORKFLOW_FAILED':
      updateStepper({
        workflowType: msg.payload?.workflowType,
        step: `Lỗi: ${msg.payload?.error || 'Thất bại'}`,
        percent: 0,
        status: 'FAILED',
        timestamp: new Date().toISOString(),
      });
      break;

    case 'WORKFLOW_CANCELLED':
      updateStepper({
        workflowType: msg.payload?.workflowType,
        step: 'Đã dừng quy trình.',
        percent: 0,
        status: 'CANCELLED',
        timestamp: new Date().toISOString(),
      });
      break;

    case 'NEW_LOG_ENTRY':
      loadLogs();
      break;
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes[STORAGE_KEYS.LOGS]) {
    loadLogs();
  }
  if (changes[STORAGE_KEYS.DOWNLOADS]) {
    loadDownloads();
  }
  if (changes[STORAGE_KEYS.THEME]) {
    const next = changes[STORAGE_KEYS.THEME].newValue === 'dark' ? 'dark' : 'light';
    applyTheme(next);
  }
});

// Utility Helpers
function truncate(str: string, len: number): string {
  if (!str) return '';
  return str.length > len ? str.substring(0, len) + '...' : str;
}

function formatTime(isoStr: string): string {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleTimeString('vi-VN', { hour12: false });
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.innerText = text;
  return div.innerHTML;
}

// Initial Boot
document.addEventListener('DOMContentLoaded', async () => {
  await initTheme();
  initSlocCheckboxes();
  updateStatusBadge(false);

  try {
    const statusRes = await chrome.runtime.sendMessage({ action: 'GET_STATUS' });
    if (statusRes?.success && statusRes.data?.progress) {
      updateStepper(statusRes.data.progress);
    }
  } catch (err) {
    console.warn('[SidePanel] GET_STATUS error:', err);
  }

  await Promise.all([loadConfig(), loadDownloads(), loadLogs()]);
});
