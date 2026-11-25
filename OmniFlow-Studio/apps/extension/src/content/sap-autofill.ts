// ============================================================
// OmniFlow Studio — SAP B1 Content Script (100% Standalone Autofill & Workflow Trigger)
// ============================================================

(function () {
  console.log('[OmniFlow] Standalone SAP Helper injected:', window.location.href);

  // Prevent multiple injections
  if (document.getElementById('omniflow-sap-root')) {
    return;
  }

  // Automatic SAML2 error detection and recovery prompt
  const isSamlError =
    window.location.href.includes('/saml2/sp/acs') ||
    document.body.innerText.includes('getLocalSP()') ||
    document.body.innerText.includes('NullPointerException');

  // Create UI Root
  const root = document.createElement('div');
  root.id = 'omniflow-sap-root';
  root.className = 'omniflow-root';

  root.innerHTML = `
    <div class="omniflow-fab-container">
      <div id="omniflow-sap-menu" class="omniflow-menu">
        <div class="omniflow-menu-header">
          <div class="omniflow-menu-title">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect>
              <path d="M9 22v-4h6v4"></path>
            </svg>
            <span>OmniFlow SAP Helper</span>
          </div>
          <span id="omniflow-sap-status" class="omniflow-menu-status">Standalone v2.1</span>
        </div>

        <button id="omniflow-btn-sap-fill" class="omniflow-menu-item">
          <span class="omniflow-item-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path>
            </svg>
          </span>
          <div class="omniflow-item-content">
            <span class="omniflow-item-title">Điền thông tin SLD</span>
            <span class="omniflow-item-desc">Tự động chọn Công ty &amp; User từ Cấu hình</span>
          </div>
        </button>

        <button id="omniflow-btn-saml-recover" class="omniflow-menu-item" style="${
          isSamlError ? 'border-color: #D97706 !important; background: #FFFBEB !important;' : ''
        }">
          <span class="omniflow-item-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="23 4 23 10 17 10"></polyline>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
            </svg>
          </span>
          <div class="omniflow-item-content">
            <span class="omniflow-item-title">Khôi phục phiên SAML2</span>
            <span class="omniflow-item-desc">Vượt lỗi NullPointer -&gt; quay về Dispatcher</span>
          </div>
        </button>

        <button id="omniflow-btn-sap-query" class="omniflow-menu-item">
          <span class="omniflow-item-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="20" x2="18" y2="10"></line>
              <line x1="12" y1="20" x2="12" y2="4"></line>
              <line x1="6" y1="20" x2="6" y2="14"></line>
            </svg>
          </span>
          <div class="omniflow-item-content">
            <span class="omniflow-item-title">Xuất Báo Giá (SAP Pricelist)</span>
            <span class="omniflow-item-desc">Chạy workflow xuất Pricelist Non-Asset</span>
          </div>
        </button>

        <button id="omniflow-btn-sap-panel" class="omniflow-menu-item">
          <span class="omniflow-item-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="15" y1="3" x2="15" y2="21"></line>
            </svg>
          </span>
          <div class="omniflow-item-content">
            <span class="omniflow-item-title">Mở Bảng Điều Khiển</span>
            <span class="omniflow-item-desc">Mở Side Panel trong trình duyệt</span>
          </div>
        </button>
      </div>

      <button id="omniflow-sap-fab-btn" class="omniflow-fab-btn" style="background: #059669 !important;">
        <span id="omniflow-sap-fab-dot" class="omniflow-fab-dot"></span>
        <span>OmniFlow SAP</span>
      </button>
    </div>
  `;

  document.body.appendChild(root);

  // References
  const fabBtn = document.getElementById('omniflow-sap-fab-btn')!;
  const fabDot = document.getElementById('omniflow-sap-fab-dot')!;
  const menu = document.getElementById('omniflow-sap-menu')!;
  const statusBadge = document.getElementById('omniflow-sap-status')!;

  const btnSapFill = document.getElementById('omniflow-btn-sap-fill')!;
  const btnSamlRecover = document.getElementById('omniflow-btn-saml-recover')!;
  const btnSapQuery = document.getElementById('omniflow-btn-sap-query')!;
  const btnSapPanel = document.getElementById('omniflow-btn-sap-panel')!;

  let toastTimer: number | null = null;

  // Toast Helper (supports live progress updates)
  function showToast(message: string, duration = 3500, percent?: number) {
    if (toastTimer !== null) {
      window.clearTimeout(toastTimer);
      toastTimer = null;
    }

    let toast = document.querySelector<HTMLDivElement>('.omniflow-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'omniflow-toast';
      document.body.appendChild(toast);
    }

    const progressHtml =
      typeof percent === 'number'
        ? `<div class="omniflow-toast-progress"><div class="omniflow-toast-progress-fill" style="width:${Math.min(100, Math.max(0, percent))}%"></div></div>`
        : '';

    toast.innerHTML = `
      <div class="omniflow-toast-row">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0">
          <rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect>
          <path d="M9 22v-4h6v4"></path>
        </svg>
        <span>${message}${typeof percent === 'number' ? ` (${percent}%)` : ''}</span>
      </div>
      ${progressHtml}
    `;

    if (duration > 0) {
      toastTimer = window.setTimeout(() => {
        toast?.remove();
        toastTimer = null;
      }, duration);
    }
  }

  function setStatusState(isRunning: boolean) {
    if (isRunning) {
      fabDot.className = 'omniflow-fab-dot running';
      statusBadge.textContent = 'Đang chạy...';
      statusBadge.style.background = '#EFF6FF';
      statusBadge.style.color = '#2563EB';
      statusBadge.style.borderColor = '#BFDBFE';
    } else {
      fabDot.className = 'omniflow-fab-dot';
      statusBadge.textContent = 'Standalone v2.1';
      statusBadge.style.background = '#ECFDF5';
      statusBadge.style.color = '#059669';
      statusBadge.style.borderColor = '#A7F3D0';
    }
  }

  setStatusState(false);

  // Toggle Menu
  fabBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('open');
  });

  document.addEventListener('click', (e) => {
    if (!root.contains(e.target as Node)) {
      menu.classList.remove('open');
    }
  });

  // Helper: Load local config from chrome.storage.local
  async function loadLocalConfig(): Promise<Record<string, any>> {
    try {
      const res = await chrome.storage.local.get('omniflow_config');
      return res?.omniflow_config || {};
    } catch {
      return {};
    }
  }

  // Helper: Trigger native input change
  function setNativeValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
    const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set;
    const prototype = Object.getPrototypeOf(element);
    const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

    if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
      prototypeValueSetter.call(element, value);
    } else if (valueSetter) {
      valueSetter.call(element, value);
    } else {
      element.value = value;
    }

    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Action 1: Fill SAP SLD Credentials
  btnSapFill.addEventListener('click', async () => {
    menu.classList.remove('open');
    const cfg = await loadLocalConfig();
    const company = cfg.sapCompany || 'LARIA';
    const username = cfg.sapUsername || 'LOG32';
    const password = cfg.sapPassword || '';

    const selects = Array.from(document.querySelectorAll<HTMLSelectElement>('select'));
    const companySelect = selects.find(
      (s) =>
        s.name?.toLowerCase().includes('company') ||
        s.id?.toLowerCase().includes('company') ||
        Array.from(s.options).some((o) => o.text.includes(company) || o.text.includes('LARIA') || o.text.includes('FM_PRO'))
    );

    if (companySelect) {
      const matchOpt = Array.from(companySelect.options).find(
        (o) => o.text.includes(company) || o.text.includes('LARIA') || o.text.includes('FM_PRO')
      );
      if (matchOpt) {
        companySelect.value = matchOpt.value;
        companySelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input'));
    const userInputs = inputs.filter(
      (i) =>
        i.type === 'text' &&
        (i.name?.toLowerCase().includes('user') ||
          i.id?.toLowerCase().includes('user') ||
          i.placeholder?.toLowerCase().includes('user') ||
          inputs.indexOf(i) === 0)
    );

    const passInputs = inputs.filter((i) => i.type === 'password');

    let filled = false;
    if (userInputs.length > 0) {
      setNativeValue(userInputs[0], username);
      filled = true;
    }
    if (passInputs.length > 0 && password) {
      setNativeValue(passInputs[0], password);
      filled = true;
    }

    if (filled) {
      showToast(`Đã tự động điền thông tin SAP: ${username}`);
    } else {
      showToast('Không tìm thấy ô đăng nhập SAP trên màn hình.');
    }
  });

  // Action 2: SAML2 Recovery
  btnSamlRecover.addEventListener('click', () => {
    menu.classList.remove('open');
    showToast('Đang khôi phục điều hướng về SAP Dispatcher...');
    window.location.href = window.location.origin + '/dispatcher/';
  });

  // Action 3: Trigger SAP Pricelist Export
  btnSapQuery.addEventListener('click', () => {
    menu.classList.remove('open');
    setStatusState(true);
    showToast('Đang khởi chạy quy trình xuất Báo giá SAP...', 0, 5);
    chrome.runtime.sendMessage({
      action: 'TRIGGER_WORKFLOW',
      workflowType: 'SAP_AUTOMATION',
    });
  });

  // Action 4: Open Side Panel
  btnSapPanel.addEventListener('click', () => {
    menu.classList.remove('open');
    chrome.runtime.sendMessage({ action: 'OPEN_SIDEPANEL' });
  });

  let keepAlivePort: chrome.runtime.Port | null = null;
  let keepAliveTimer: number | null = null;
  let isKeepAliveActive = false;

  function startKeepAlivePort() {
    isKeepAliveActive = true;
    if (keepAlivePort) return;
    try {
      keepAlivePort = chrome.runtime.connect({ name: 'omniflow-keepalive' });
      keepAlivePort.onDisconnect.addListener(() => {
        keepAlivePort = null;
        if (keepAliveTimer !== null) {
          window.clearInterval(keepAliveTimer);
          keepAliveTimer = null;
        }
        if (isKeepAliveActive) {
          window.setTimeout(() => {
            if (isKeepAliveActive) startKeepAlivePort();
          }, 1000);
        }
      });
      if (keepAliveTimer === null) {
        keepAliveTimer = window.setInterval(() => {
          try {
            keepAlivePort?.postMessage({ type: 'PING', source: 'sap-content', ts: Date.now() });
          } catch {
            // Ignore; onDisconnect handles reconnect
          }
        }, 20000);
      }
    } catch {
      keepAlivePort = null;
    }
  }

  function stopKeepAlivePort() {
    isKeepAliveActive = false;
    if (keepAliveTimer !== null) {
      window.clearInterval(keepAliveTimer);
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

  // Live Progress Toast + MV3 Keep-Alive Listener
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg?.type) return;

    if (msg.type === 'START_KEEPALIVE') {
      startKeepAlivePort();
    } else if (msg.type === 'STOP_KEEPALIVE') {
      stopKeepAlivePort();
    } else if (msg.type === 'WORKFLOW_PROGRESS' && msg.payload) {
      const p = msg.payload;
      const isRunning =
        p.status === 'RUNNING' ||
        p.status === 'INITIALIZING' ||
        p.status === 'PENDING' ||
        p.status === 'RETRYING';
      setStatusState(isRunning);
      if (isRunning) {
        startKeepAlivePort();
      } else if (p.status === 'SUCCESS' || p.status === 'FAILED' || p.status === 'CANCELLED') {
        stopKeepAlivePort();
      }
      showToast(p.step || p.message || 'Đang xử lý SAP...', isRunning ? 0 : 4000, p.percent);
    } else if (msg.type === 'WORKFLOW_COMPLETED') {
      setStatusState(false);
      stopKeepAlivePort();
      showToast(msg.payload?.message || 'Hoàn thành xuất Báo giá SAP!', 4000, 100);
    } else if (msg.type === 'WORKFLOW_FAILED') {
      setStatusState(false);
      stopKeepAlivePort();
      showToast(`Lỗi SAP: ${msg.payload?.error || 'Thất bại'}`, 5000);
    } else if (msg.type === 'WORKFLOW_CANCELLED') {
      setStatusState(false);
      stopKeepAlivePort();
      showToast('Đã dừng quy trình SAP.', 3000);
    }
  });

  // If detected SAML error, display alert toast right away
  if (isSamlError) {
    showToast('Phát hiện lỗi SAML2 NullPointerException. Click "Khôi phục phiên SAML2" để tiếp tục.', 6000);
  }
})();
