// ============================================================
// OmniFlow Studio — POS Content Script (100% Standalone Autofill & Workflow Trigger)
// ============================================================

(function () {
  console.log('[OmniFlow] Standalone POS Helper injected:', window.location.href);

  // Prevent multiple injections
  if (document.getElementById('omniflow-pos-root')) {
    return;
  }

  // Create UI Root
  const root = document.createElement('div');
  root.id = 'omniflow-pos-root';
  root.className = 'omniflow-root';

  root.innerHTML = `
    <div class="omniflow-fab-container">
      <div id="omniflow-pos-menu" class="omniflow-menu">
        <div class="omniflow-menu-header">
          <div class="omniflow-menu-title">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#2563EB" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
            </svg>
            <span>OmniFlow POS Helper</span>
          </div>
          <span id="omniflow-pos-status" class="omniflow-menu-status">Standalone v2.1</span>
        </div>

        <button id="omniflow-btn-fill-login" class="omniflow-menu-item">
          <span class="omniflow-item-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path>
            </svg>
          </span>
          <div class="omniflow-item-content">
            <span class="omniflow-item-title">Điền tài khoản POS</span>
            <span class="omniflow-item-desc">Tự động điền từ Cấu hình Extension</span>
          </div>
        </button>

        <button id="omniflow-btn-select-outlet" class="omniflow-menu-item">
          <span class="omniflow-item-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
              <polyline points="9 22 9 12 15 12 15 22"></polyline>
            </svg>
          </span>
          <div class="omniflow-item-content">
            <span class="omniflow-item-title">Chọn Outlet ưu tiên</span>
            <span class="omniflow-item-desc">Tự động chọn điểm bán (VD: FM04)</span>
          </div>
        </button>

        <button id="omniflow-btn-run-sales" class="omniflow-menu-item">
          <span class="omniflow-item-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="20" x2="18" y2="10"></line>
              <line x1="12" y1="20" x2="12" y2="4"></line>
              <line x1="6" y1="20" x2="6" y2="14"></line>
            </svg>
          </span>
          <div class="omniflow-item-content">
            <span class="omniflow-item-title">Tải Doanh Số POS</span>
            <span class="omniflow-item-desc">Xuất Sales Transaction Detail</span>
          </div>
        </button>

        <button id="omniflow-btn-run-inv" class="omniflow-menu-item">
          <span class="omniflow-item-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
            </svg>
          </span>
          <div class="omniflow-item-content">
            <span class="omniflow-item-title">Tải Tồn Kho (12 Kho)</span>
            <span class="omniflow-item-desc">Chạy workflow xuất Excel Onhand</span>
          </div>
        </button>

        <button id="omniflow-btn-pos-check" class="omniflow-menu-item">
          <span class="omniflow-item-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
          </span>
          <div class="omniflow-item-content">
            <span class="omniflow-item-title">Kiểm tra đăng nhập POS</span>
            <span class="omniflow-item-desc">Tự động kiểm tra phiên &amp; Outlet</span>
          </div>
        </button>

        <button id="omniflow-btn-open-panel" class="omniflow-menu-item">
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

      <button id="omniflow-fab-btn" class="omniflow-fab-btn">
        <span id="omniflow-fab-dot" class="omniflow-fab-dot"></span>
        <span>OmniFlow</span>
      </button>
    </div>
  `;

  document.body.appendChild(root);

  // References
  const fabBtn = document.getElementById('omniflow-fab-btn')!;
  const fabDot = document.getElementById('omniflow-fab-dot')!;
  const menu = document.getElementById('omniflow-pos-menu')!;
  const statusBadge = document.getElementById('omniflow-pos-status')!;

  const btnFillLogin = document.getElementById('omniflow-btn-fill-login')!;
  const btnSelectOutlet = document.getElementById('omniflow-btn-select-outlet')!;
  const btnRunSales = document.getElementById('omniflow-btn-run-sales')!;
  const btnRunInv = document.getElementById('omniflow-btn-run-inv')!;
  const btnPosCheck = document.getElementById('omniflow-btn-pos-check')!;
  const btnOpenPanel = document.getElementById('omniflow-btn-open-panel')!;

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
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2563EB" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
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

  // Helper: Trigger native React / Angular / DevExtreme input change
  function setNativeValue(element: HTMLInputElement, value: string) {
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
    element.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  // Action 1: Autofill POS Login
  btnFillLogin.addEventListener('click', async () => {
    menu.classList.remove('open');
    const cfg = await loadLocalConfig();
    const username = cfg.posUsername || 'TM01';
    const password = cfg.posPassword || '';

    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input'));
    const userInputs = inputs.filter(
      (i) =>
        i.type === 'text' &&
        (i.name?.toLowerCase().includes('user') ||
          i.id?.toLowerCase().includes('user') ||
          i.placeholder?.toLowerCase().includes('tài khoản') ||
          i.placeholder?.toLowerCase().includes('username') ||
          i.getAttribute('aria-label')?.toLowerCase().includes('user') ||
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
      showToast(`Đã điền tài khoản POS: ${username}`);
    } else {
      showToast('Không tìm thấy ô đăng nhập trên trang hiện tại.');
    }
  });

  // Action 2: Select Outlet
  btnSelectOutlet.addEventListener('click', async () => {
    menu.classList.remove('open');
    const cfg = await loadLocalConfig();
    const outlet = cfg.posPreferredOutlet || 'FM04';

    const allElements = Array.from(document.querySelectorAll('*'));
    const outletTarget = allElements.find((el) => {
      const text = el.textContent || '';
      return (
        (text.includes(outlet) || (outlet === 'FM04' && text.includes('Hoàng Hoa Thám'))) &&
        (el.classList.contains('card') ||
          el.tagName === 'DIV' ||
          el.getAttribute('role') === 'button' ||
          (el as HTMLElement).onclick != null)
      );
    });

    if (outletTarget) {
      (outletTarget as HTMLElement).click();
      showToast(`Đã chọn điểm bán: ${outlet}`);
    } else {
      showToast(`Chưa tìm thấy thẻ Outlet ${outlet}. Vui lòng vào màn hình chọn Outlet.`);
    }
  });

  // Action 3: Run Sales Workflow
  btnRunSales.addEventListener('click', () => {
    menu.classList.remove('open');
    setStatusState(true);
    showToast('Đang khởi chạy Doanh Số POS...', 0, 5);
    chrome.runtime.sendMessage({
      action: 'TRIGGER_WORKFLOW',
      workflowType: 'DOWNLOAD_SALES',
    });
  });

  // Action 4: Run Inventory Workflow
  btnRunInv.addEventListener('click', () => {
    menu.classList.remove('open');
    setStatusState(true);
    showToast('Đang khởi chạy Tồn Kho 12 Kho...', 0, 5);
    chrome.runtime.sendMessage({
      action: 'TRIGGER_WORKFLOW',
      workflowType: 'DOWNLOAD_INVENTORY',
    });
  });

  // Action 5: Run POS Login Check
  btnPosCheck.addEventListener('click', () => {
    menu.classList.remove('open');
    setStatusState(true);
    showToast('Đang kiểm tra đăng nhập & Outlet POS...', 0, 10);
    chrome.runtime.sendMessage({
      action: 'TRIGGER_WORKFLOW',
      workflowType: 'POS_LOGIN_CHECK',
    });
  });

  // Action 6: Open Side Panel
  btnOpenPanel.addEventListener('click', () => {
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
            keepAlivePort?.postMessage({ type: 'PING', source: 'pos-content', ts: Date.now() });
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
      showToast(p.step || p.message || 'Đang xử lý...', isRunning ? 0 : 4000, p.percent);
    } else if (msg.type === 'WORKFLOW_COMPLETED') {
      setStatusState(false);
      stopKeepAlivePort();
      showToast(msg.payload?.message || 'Hoàn thành quy trình POS!', 4000, 100);
    } else if (msg.type === 'WORKFLOW_FAILED') {
      setStatusState(false);
      stopKeepAlivePort();
      showToast(`Lỗi: ${msg.payload?.error || 'Thất bại'}`, 5000);
    } else if (msg.type === 'WORKFLOW_CANCELLED') {
      setStatusState(false);
      stopKeepAlivePort();
      showToast('Đã dừng quy trình.', 3000);
    }
  });
})();
