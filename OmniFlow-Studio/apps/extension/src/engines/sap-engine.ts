// ============================================================
// OmniFlow Studio — SAP Business One Chrome Extension MV3 Engine
// ============================================================
// Ported from packages/sap-adapter/src/index.ts to 100% MV3
// using chrome.tabs, chrome.scripting.executeScript (allFrames),
// chrome.downloads, and real-time screen-reading state machine
// with visual cursor overlay (cursor-overlay.ts).

import {
  injectCursorOverlay,
  cursorAction,
  removeCursorOverlay,
  type ElementRect,
} from './cursor-overlay.js';

export type SapTargetModule =
  | 'HOME'
  | 'PURCHASING_PO'
  | 'PURCHASING_GRPO'
  | 'PURCHASING_RETURN'
  | 'INVENTORY_STATUS'
  | 'QUERY_PRICELIST';

export type SapScreenName =
  | 'SAML_ERROR'
  | 'SLD_LOGON'
  | 'CONCURRENT_LOGIN'
  | 'INITIALIZING'
  | 'SYSTEM_MESSAGES_LOG'
  | 'WORKSPACE_READY'
  | 'QUERY_MANAGER'
  | 'QUERY_RESULT'
  | 'SAVE_AS_DIALOG'
  | 'CURRENCY_DIALOG'
  | 'UNKNOWN';

export interface SapScreenState {
  url: string;
  screen: SapScreenName;
  frameId: number;
  isLoading: boolean;
  dialogText?: string;
}

export interface SapEngineConfig {
  sapUrl: string;
  username: string;
  password: string;
  company?: string;
  server?: string;
  autoTakeOverSession?: boolean;
  targetModule?: SapTargetModule;
  queryCategory?: string;
  queryName?: string;
}

export type SapProgressCallback = (step: string, percent: number) => void;

export interface SapAutomationResult {
  ok: boolean;
  filename?: string;
  downloadId?: number;
  message: string;
}

interface TargetCoords {
  found: boolean;
  occluded: boolean;
  x: number;
  y: number;
  rect: ElementRect;
}

// Local MV3 Chrome API typings to avoid colliding with chrome-env.d.ts
interface ChromeDownloadItem {
  id: number;
  filename?: string;
  url?: string;
  state?: 'in_progress' | 'interrupted' | 'complete';
  error?: string;
}

interface ChromeDownloadDelta {
  id: number;
  filename?: { current?: string; previous?: string };
  state?: { current?: 'in_progress' | 'interrupted' | 'complete'; previous?: string };
  error?: { current?: string; previous?: string };
}

interface ChromeExtApi {
  tabs: {
    get(tabId: number): Promise<{ id?: number; url?: string; status?: string }>;
    update(
      tabId: number,
      updateProperties: { url?: string; active?: boolean }
    ): Promise<{ id?: number; url?: string; status?: string }>;
  };
  scripting: {
    executeScript<TArgs extends unknown[], TResult>(injection: {
      target: { tabId: number; allFrames?: boolean };
      func: (...args: TArgs) => TResult | Promise<TResult>;
      args?: TArgs;
    }): Promise<Array<{ frameId: number; result?: TResult }>>;
  };
  downloads?: {
    onCreated: {
      addListener(cb: (item: ChromeDownloadItem) => void): void;
      removeListener(cb: (item: ChromeDownloadItem) => void): void;
    };
    onChanged: {
      addListener(cb: (delta: ChromeDownloadDelta) => void): void;
      removeListener(cb: (delta: ChromeDownloadDelta) => void): void;
    };
    search(query: { id?: number }): Promise<ChromeDownloadItem[]>;
  };
}

function getChromeApi(): ChromeExtApi {
  const api = (globalThis as unknown as { chrome?: ChromeExtApi }).chrome;
  if (!api?.tabs || !api?.scripting) {
    throw new Error('Chrome Extension MV3 API (tabs/scripting) không khả dụng.');
  }
  return api;
}

class SapAbortError extends Error {
  constructor() {
    super('Đã hủy tác vụ tự động hóa SAP.');
    this.name = 'SapAbortError';
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new SapAbortError();
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new SapAbortError());
    };

    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function execInAllFrames<TArgs extends unknown[], TResult>(
  tabId: number,
  func: (...args: TArgs) => TResult | Promise<TResult>,
  args: TArgs
): Promise<Array<{ frameId: number; result?: TResult }>> {
  const api = getChromeApi();
  try {
    return await api.scripting.executeScript({
      target: { tabId, allFrames: true },
      func,
      args,
    });
  } catch {
    return await api.scripting.executeScript({
      target: { tabId },
      func,
      args,
    });
  }
}

/**
 * Derives the clean SAP Dispatcher base URL (e.g. https://172.16.1.210:8100/dispatcher/)
 * even if currentUrl is on /dispatcher/saml2/sp/acs or SLD :40000/ControlCenter/sbo.html.
 */
function resolveDispatcherRootUrl(sapUrl: string, currentUrl?: string): string {
  for (const candidate of [sapUrl, currentUrl || '']) {
    if (!candidate) continue;
    try {
      const parsed = new URL(candidate);
      if (parsed.pathname.includes('/dispatcher')) {
        return `${parsed.origin}/dispatcher/`;
      }
    } catch {
      // ignore invalid URL
    }
  }
  return sapUrl;
}

async function waitForTabComplete(
  tabId: number,
  timeoutMs = 30000,
  signal?: AbortSignal
): Promise<void> {
  const api = getChromeApi();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    throwIfAborted(signal);
    try {
      const tab = await api.tabs.get(tabId);
      if (tab.status === 'complete') return;
    } catch {
      // tab may be transitioning
    }
    await sleep(300, signal);
  }
}

async function navigateTab(
  tabId: number,
  url: string,
  timeoutMs = 30000,
  signal?: AbortSignal
): Promise<void> {
  const api = getChromeApi();
  await api.tabs.update(tabId, { url, active: true });
  await sleep(500, signal);
  await waitForTabComplete(tabId, timeoutMs, signal);
  await injectCursorOverlay(tabId);
}

async function reportStatus(
  tabId: number,
  onProgress: SapProgressCallback,
  step: string,
  percent: number
): Promise<void> {
  onProgress(step, percent);
  await cursorAction(tabId, { type: 'status', status: step });
}

async function animateTargetClick(
  tabId: number,
  coords: TargetCoords | undefined,
  signal?: AbortSignal
): Promise<void> {
  if (!coords?.found) return;
  await cursorAction(tabId, { type: 'highlight', rect: coords.rect });
  await cursorAction(tabId, { type: 'glide', x: coords.x, y: coords.y, duration: 320 });
  await cursorAction(tabId, { type: 'click', x: coords.x, y: coords.y });
  await sleep(120, signal);
  await cursorAction(tabId, { type: 'clearHighlight' });
}

/**
 * Real-Time Screen Reader across all frames (allFrames: true).
 * Inspects the live SAP browser tab before and after each action.
 */
export async function readSapScreenState(tabId: number): Promise<SapScreenState> {
  const api = getChromeApi();
  let tabUrl = '';
  try {
    const tab = await api.tabs.get(tabId);
    tabUrl = tab.url || '';
  } catch {
    // ignore tab lookup errors
  }

  if (tabUrl.includes('/saml2/sp/acs')) {
    return { url: tabUrl, screen: 'SAML_ERROR', frameId: 0, isLoading: false };
  }

  try {
    const frameResults = await execInAllFrames(
      tabId,
      () => {
        const isVisible = (el: Element | null): el is HTMLElement => {
          if (!el || !(el instanceof HTMLElement)) return false;
          const style = window.getComputedStyle(el);
          if (
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            style.opacity === '0'
          ) {
            return false;
          }
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };

        const href = window.location.href || '';
        const bodyText = document.body?.innerText || document.body?.textContent || '';

        if (
          href.includes('/saml2/sp/acs') ||
          /SAML2SPConfiguration|SAML2IdPConfiguration|null object loaded from local variable 'configuration'/i.test(
            bodyText
          )
        ) {
          return { screen: 'SAML_ERROR' as const, isLoading: false };
        }

        const dialogs = Array.from(
          document.querySelectorAll(
            '#messagebox, .sapMDialog, [role="dialog"], .b1-dialog, .dialog'
          )
        ).filter(isVisible);

        for (const dlg of dialogs) {
          const dlgText = (dlg.textContent || '').trim();
          if (/Export currency symbols/i.test(dlgText)) {
            return { screen: 'CURRENCY_DIALOG' as const, isLoading: false, dialogText: dlgText };
          }
          if (/Save As|Enter a file name/i.test(dlgText)) {
            return { screen: 'SAVE_AS_DIALOG' as const, isLoading: false, dialogText: dlgText };
          }
          if (/logged in|đăng nhập|already|invalid|không đúng|locked|khoá|failed/i.test(dlgText)) {
            return { screen: 'CONCURRENT_LOGIN' as const, isLoading: false, dialogText: dlgText };
          }
          if (/System Messages Log/i.test(dlgText)) {
            return { screen: 'SYSTEM_MESSAGES_LOG' as const, isLoading: false, dialogText: dlgText };
          }
        }

        if (/Export currency symbols/i.test(bodyText)) {
          return { screen: 'CURRENCY_DIALOG' as const, isLoading: false };
        }
        if (/\bSave As\b/i.test(bodyText) && /Enter a file name/i.test(bodyText)) {
          return { screen: 'SAVE_AS_DIALOG' as const, isLoading: false };
        }
        if (/System Messages Log/i.test(bodyText)) {
          return { screen: 'SYSTEM_MESSAGES_LOG' as const, isLoading: false };
        }

        const isBusy =
          isVisible(document.querySelector('.sapUiLocalBusyIndicator')) ||
          isVisible(document.querySelector('.sapMBusyDialog')) ||
          isVisible(document.querySelector('.sapUiBusy')) ||
          isVisible(document.querySelector('[class*="spinner" i]'));

        const hasQueryManager =
          bodyText.includes('Query Manager') ||
          bodyText.includes('Query Category') ||
          bodyText.includes('Manage Categories');
        if (hasQueryManager) {
          return { screen: 'QUERY_MANAGER' as const, isLoading: isBusy };
        }

        const hasExportBtn = Boolean(
          Array.from(
            document.querySelectorAll(
              'button[title*="Export to Excel" i], button[title*="MS-EXCEL" i], [title*="Export to MS-EXCEL" i], button[title*="Export to Spreadsheet" i], .sapUiTableToolbar button[title*="xls" i]'
            )
          ).find(isVisible)
        );
        const hasResultGrid =
          isVisible(document.querySelector('.sapUiTable')) ||
          isVisible(document.querySelector('.sapMListTbl')) ||
          isVisible(document.querySelector('table'));
        if (hasExportBtn && hasResultGrid) {
          return { screen: 'QUERY_RESULT' as const, isLoading: isBusy };
        }

        const hasLogonForm =
          isVisible(document.querySelector('#sbo_user')) ||
          Array.from(document.querySelectorAll('input[type="password"]')).some(isVisible);
        if (hasLogonForm) {
          return { screen: 'SLD_LOGON' as const, isLoading: isBusy };
        }

        const hasWorkspace =
          isVisible(document.querySelector('#shell-header')) ||
          isVisible(document.querySelector('.sapMShellTitle')) ||
          isVisible(document.querySelector('div[title*="Purchasing"]')) ||
          bodyText.includes('Purchasing - A/P') ||
          bodyText.includes('Look up menus');
        if (hasWorkspace) {
          return { screen: 'WORKSPACE_READY' as const, isLoading: isBusy };
        }

        if (isBusy || href.includes('/dispatcher')) {
          return { screen: 'INITIALIZING' as const, isLoading: true };
        }

        return { screen: 'UNKNOWN' as const, isLoading: isBusy };
      },
      []
    );

    const priority: SapScreenName[] = [
      'SAML_ERROR',
      'CURRENCY_DIALOG',
      'SAVE_AS_DIALOG',
      'CONCURRENT_LOGIN',
      'SYSTEM_MESSAGES_LOG',
      'QUERY_MANAGER',
      'QUERY_RESULT',
      'WORKSPACE_READY',
      'SLD_LOGON',
      'INITIALIZING',
      'UNKNOWN',
    ];

    let best: SapScreenState = {
      url: tabUrl,
      screen: 'UNKNOWN',
      frameId: 0,
      isLoading: false,
    };
    let bestRank = priority.length;

    for (const fr of frameResults) {
      if (!fr.result) continue;
      const rank = priority.indexOf(fr.result.screen);
      if (rank >= 0 && rank < bestRank) {
        bestRank = rank;
        best = {
          url: tabUrl,
          screen: fr.result.screen,
          frameId: fr.frameId,
          isLoading: fr.result.isLoading,
          dialogText: fr.result.dialogText,
        };
      }
    }

    return best;
  } catch {
    return { url: tabUrl, screen: 'UNKNOWN', frameId: 0, isLoading: false };
  }
}

async function dismissSystemMessagesLog(tabId: number, signal?: AbortSignal): Promise<boolean> {
  try {
    const frameResults = await execInAllFrames(
      tabId,
      () => {
        const isVisible = (el: Element | null): el is HTMLElement => {
          if (!el || !(el instanceof HTMLElement)) return false;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            return false;
          }
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };

        const containers = Array.from(
          document.querySelectorAll('.sapMDialog, #messagebox, [role="dialog"], .b1-dialog, .dialog')
        ).filter(isVisible);

        const targetContainer = containers.find((c) =>
          /System Messages Log/i.test(c.textContent || '')
        );
        if (!targetContainer) return { dismissed: false };

        const closeSelectors = [
          'button[title*="Close" i]',
          'button[aria-label*="Close" i]',
          '.sapMDialogCloseBtn',
          '.close-btn',
          'button',
        ];
        for (const sel of closeSelectors) {
          const btns = Array.from(targetContainer.querySelectorAll(sel)).filter(isVisible);
          for (const btn of btns) {
            const txt = (btn.textContent || '').trim();
            if (sel !== 'button' || /^(ok|close|đóng|cancel|x)$/i.test(txt)) {
              const rect = btn.getBoundingClientRect();
              btn.click();
              return {
                dismissed: true,
                coords: {
                  found: true,
                  occluded: false,
                  x: rect.left + rect.width / 2,
                  y: rect.top + rect.height / 2,
                  rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
                },
              };
            }
          }
        }
        return { dismissed: false };
      },
      []
    );
    const hit = frameResults.map((r) => r.result).find((r) => r?.dismissed);
    if (hit?.dismissed) {
      await animateTargetClick(tabId, hit.coords, signal);
      await sleep(500, signal);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Fills the SLD logon form inside the active logon frame with visual cursor feedback:
 * - Waits for #sbo_dbserver & #sbo_company options (clicking #refresh_company if needed)
 * - Selects server & company with multi-tier matching + BEFORE_IMPORT1 guard
 * - Sets username & password with input/change events and verifies against showLogonView() resets
 * - Clicks Log On
 */
async function fillAndSubmitLogonForm(
  tabId: number,
  cfg: SapEngineConfig,
  signal?: AbortSignal
): Promise<{ ok: boolean; retryReason?: string }> {
  await cursorAction(tabId, { type: 'type', text: cfg.username, isPassword: false });

  const frameResults = await execInAllFrames(
    tabId,
    async (params: {
      username: string;
      password: string;
      company: string;
      server: string;
    }) => {
      const isVisible = (el: Element | null): el is HTMLElement => {
        if (!el || !(el instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const hasFormInFrame =
        isVisible(document.querySelector('#sbo_user')) ||
        Array.from(document.querySelectorAll('input[type="password"]')).some((el) =>
          isVisible(el)
        );
      if (!hasFormInFrame) {
        return { ok: false, skipped: true };
      }

      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const waitUntil = async (fn: () => boolean, timeoutMs: number): Promise<boolean> => {
        const start = Date.now();
        while (Date.now() - start <= timeoutMs) {
          try {
            if (fn()) return true;
          } catch {
            // ignore during DOM transition
          }
          await wait(50);
        }
        return false;
      };

      const isOccluded = (el: HTMLElement): boolean => {
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const hit = document.elementFromPoint(cx, cy);
        return Boolean(hit && hit !== el && !el.contains(hit) && !hit.contains(el));
      };

      const setInputAndVerify = async (
        el: HTMLInputElement | null,
        value: string
      ): Promise<boolean> => {
        if (!el) return false;
        const protoSetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value'
        )?.set;

        for (let attempt = 1; attempt <= 3; attempt++) {
          el.focus();
          el.click();
          if (protoSetter) {
            protoSetter.call(el, value);
          } else {
            el.value = value;
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          await wait(100);
          if (el.value === value) return true;
        }
        return false;
      };

      // 1. DB Server settlement wait & selection (preserve SLD default when cfg.server is empty/undefined)
      const dbServerSelect = document.getElementById('sbo_dbserver') as HTMLSelectElement | null;
      let dbServerLoaded = true;
      if (isVisible(dbServerSelect) && dbServerSelect) {
        dbServerLoaded = await waitUntil(() => dbServerSelect.options.length > 0, 3000);
        const targetServer = (params.server || '').trim().toLowerCase();
        if (targetServer) {
          for (let i = 0; i < dbServerSelect.options.length; i++) {
            const opt = dbServerSelect.options[i];
            const val = (opt.value || '').trim().toLowerCase();
            const txt = (opt.textContent || opt.text || '').trim().toLowerCase();
            if (txt === targetServer || val === targetServer) {
              dbServerSelect.selectedIndex = i;
              dbServerSelect.value = opt.value;
              dbServerSelect.dispatchEvent(new Event('change', { bubbles: true }));
              break;
            }
          }
        }
      }

      // 2. Company settlement wait & Safe Refresh Guard
      const companySelect = document.getElementById('sbo_company') as HTMLSelectElement | null;
      const rawCompanyInput = (params.company || '').trim();
      if (isVisible(companySelect) && companySelect) {
        let companyLoaded = false;
        if (dbServerLoaded) {
          companyLoaded = await waitUntil(() => companySelect.options.length > 0, 3000);
        }

        if (!companyLoaded) {
          const hasDb = Boolean(
            dbServerSelect && dbServerSelect.selectedIndex >= 0 && dbServerSelect.options.length > 0
          );
          const compEmpty = companySelect.options.length === 0;
          if (hasDb && compEmpty) {
            const refreshBtn = document.getElementById('refresh_company');
            if (isVisible(refreshBtn)) {
              refreshBtn.click();
              companyLoaded = await waitUntil(() => companySelect.options.length > 0, 3000);
            }
          }
        }

        if (rawCompanyInput && companySelect.options.length > 0) {
          const lowerTarget = rawCompanyInput.toLowerCase();
          const schemaMatch = rawCompanyInput.match(/\(([^)]+)\)/);
          const targetSchema = (schemaMatch ? schemaMatch[1].trim() : '').toLowerCase();

          const isPlaceholder = (val: string, txt: string) =>
            !val.trim() || /^\s*(--)?\s*(chọn|select)\b/i.test(txt);

          let matchedIndex = -1;

          // Pass 1: Exact full text, value, or schema match (e.g. (FM_PRO))
          for (let i = 0; i < companySelect.options.length; i++) {
            const opt = companySelect.options[i];
            const rawVal = opt.value || '';
            const val = rawVal.trim().toLowerCase();
            const rawTxt = opt.textContent || opt.text || '';
            const txt = rawTxt.trim().toLowerCase();
            if (isPlaceholder(val, txt)) continue;

            const optSchemaMatch = rawTxt.match(/\(([^)]+)\)/);
            const optSchema = (optSchemaMatch ? optSchemaMatch[1].trim() : '').toLowerCase();

            if ((val && val === lowerTarget) || (txt && txt === lowerTarget)) {
              matchedIndex = i;
              break;
            }
            if (targetSchema && (val === targetSchema || optSchema === targetSchema)) {
              matchedIndex = i;
              break;
            }
          }

          // Pass 2: Schema-strict or (FM_PRO)-prioritized substring match (never accidentally pick FM_CORE)
          if (matchedIndex === -1) {
            const partialMatches: Array<{ index: number; val: string; txt: string; optSchema: string }> = [];
            for (let i = 0; i < companySelect.options.length; i++) {
              const opt = companySelect.options[i];
              const rawVal = opt.value || '';
              const val = rawVal.trim().toLowerCase();
              const rawTxt = opt.textContent || opt.text || '';
              const txt = rawTxt.trim().toLowerCase();
              if (isPlaceholder(val, txt)) continue;

              const optSchemaMatch = rawTxt.match(/\(([^)]+)\)/);
              const optSchema = (optSchemaMatch ? optSchemaMatch[1].trim() : '').toLowerCase();

              if (targetSchema) {
                if (txt.includes(targetSchema) || (val && val.includes(targetSchema))) {
                  partialMatches.push({ index: i, val, txt, optSchema });
                }
                continue;
              }

              if (
                (txt && txt.includes(lowerTarget)) ||
                (val && val.length >= 2 && lowerTarget.includes(val)) ||
                (optSchema && optSchema.length >= 2 && lowerTarget.includes(optSchema)) ||
                (val && lowerTarget.length >= 2 && val.includes(lowerTarget))
              ) {
                partialMatches.push({ index: i, val, txt, optSchema });
              }
            }

            if (partialMatches.length > 0) {
              const fmProMatch = !/fm_core/i.test(rawCompanyInput)
                ? partialMatches.find(
                    (m) =>
                      m.optSchema === 'fm_pro' ||
                      m.val === 'fm_pro' ||
                      m.txt.includes('(fm_pro)')
                  )
                : undefined;
              matchedIndex = (fmProMatch || partialMatches[0]).index;
            }
          }

          if (matchedIndex >= 0) {
            companySelect.selectedIndex = matchedIndex;
            companySelect.value = companySelect.options[matchedIndex].value;
            companySelect.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            const curr = companySelect.options[companySelect.selectedIndex];
            const currVal = curr ? (curr.value || '').trim() : '';
            const currTxt = curr ? (curr.textContent || curr.text || '').trim() : '';
            const requestedBeforeImport = /before_?import/i.test(rawCompanyInput);
            if (/before_?import/i.test(currVal) && !requestedBeforeImport) {
              return {
                ok: false,
                retryReason: `Không tìm thấy công ty "${rawCompanyInput}" và dropdown đang ở BEFORE_IMPORT1.`,
              };
            }
            if (!currVal || /^\s*(--)?\s*(chọn|select)\b/i.test(currTxt)) {
              return {
                ok: false,
                retryReason: `Không tìm thấy công ty "${rawCompanyInput}" và dropdown đang ở placeholder trống.`,
              };
            }
          }
        }
      }

      // 3. Fill User ID & Password with verification against showLogonView() resets
      const userEl = (document.querySelector('#sbo_user') ||
        document.querySelector('input[name*="user" i]')) as HTMLInputElement | null;
      if (isVisible(userEl)) {
        await setInputAndVerify(userEl, params.username);
      }

      const passEl = (document.querySelector('#sbo_password') ||
        Array.from(document.querySelectorAll('input[type="password"]')).find((el) =>
          isVisible(el)
        )) as HTMLInputElement | null;
      if (isVisible(passEl)) {
        await setInputAndVerify(passEl, params.password);
      }

      if (userEl && !userEl.value) await setInputAndVerify(userEl, params.username);
      if (passEl && !passEl.value) await setInputAndVerify(passEl, params.password);

      // 4. Pre-Submit Company Guard
      if (
        isVisible(companySelect) &&
        companySelect &&
        rawCompanyInput &&
        companySelect.options.length > 0
      ) {
        const chosen = companySelect.options[companySelect.selectedIndex];
        const chosenVal = chosen ? (chosen.value || '').trim() : '';
        const chosenTxt = chosen ? (chosen.textContent || chosen.text || '').trim() : '';
        const requestedBeforeImport = /before_?import/i.test(rawCompanyInput);
        if (!chosenVal || /^\s*(--)?\s*(chọn|select)\b/i.test(chosenTxt)) {
          return { ok: false, retryReason: 'Công ty đang ở placeholder trống trước khi gửi form.' };
        }
        if (/before_?import/i.test(chosenVal) && !requestedBeforeImport) {
          return { ok: false, retryReason: 'Công ty vẫn đang ở BEFORE_IMPORT1 trước khi gửi form.' };
        }
      }

      // 5. Click Log On button (with occlusion check + coordinates)
      const logonCandidates: Array<HTMLElement | null> = [
        document.getElementById('logon_sbo_btn'),
        document.querySelector('input[value="Log On"]'),
        ...Array.from(document.querySelectorAll('button')).filter((b) =>
          (b.textContent || '').includes('Log On')
        ),
      ];
      const loginBtn = logonCandidates.find((el) => isVisible(el));
      if (!loginBtn) {
        return { ok: false, retryReason: 'Không tìm thấy nút Log On.' };
      }

      loginBtn.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = loginBtn.getBoundingClientRect();
      const coords = {
        found: true,
        occluded: isOccluded(loginBtn),
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      };
      loginBtn.click();
      return { ok: true, coords };
    },
    [
      {
        username: cfg.username,
        password: cfg.password,
        company: cfg.company || '',
        server: cfg.server || '',
      },
    ]
  );

  await cursorAction(tabId, { type: 'hideType' });

  const activeResults = frameResults
    .map(
      (r) =>
        r.result as
          | { ok: boolean; skipped?: boolean; retryReason?: string; coords?: TargetCoords }
          | undefined
    )
    .filter(
      (
        r
      ): r is {
        ok: boolean;
        skipped?: boolean;
        retryReason?: string;
        coords?: TargetCoords;
      } => Boolean(r && !r.skipped)
    );

  const successResult = activeResults.find((r) => r.ok);
  if (successResult) {
    await animateTargetClick(tabId, successResult.coords, signal);
    return { ok: true };
  }

  return (
    activeResults[0] || {
      ok: false,
      retryReason: 'Không thể thực thi script điền form đăng nhập.',
    }
  );
}

async function checkAndHandleAuthDialog(
  tabId: number,
  autoTakeOverSession: boolean,
  signal?: AbortSignal
): Promise<{
  status: 'none' | 'took_over' | 'concurrent_blocked' | 'auth_failed';
  message?: string;
}> {
  const frameResults = await execInAllFrames(
    tabId,
    (takeOver: boolean) => {
      const isVisible = (el: Element | null): el is HTMLElement => {
        if (!el || !(el instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const modal = Array.from(document.querySelectorAll('#messagebox, .sapMDialog')).find(
        isVisible
      );
      if (!modal) return { status: 'none' as const };

      const text = (modal.textContent || '').trim();
      if (/logged in|đăng nhập|already/i.test(text)) {
        if (!takeOver) {
          return {
            status: 'concurrent_blocked' as const,
            message:
              'Phát hiện tài khoản SAP đang đăng nhập ở nơi khác. Hãy bật chế độ Tự động chiếm phiên (Take Over Session) nếu bạn muốn tiếp tục.',
          };
        }

        const btns = Array.from(modal.querySelectorAll('button, .btn-yes')).filter(isVisible);
        const confirmBtn = btns.find(
          (b) =>
            /yes|continue|tiếp tục|đồng ý|ok/i.test((b.textContent || '').trim()) ||
            b.classList.contains('btn-yes')
        );
        if (confirmBtn) {
          const rect = confirmBtn.getBoundingClientRect();
          confirmBtn.click();
          return {
            status: 'took_over' as const,
            coords: {
              found: true,
              occluded: false,
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2,
              rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
            },
          };
        }
        return { status: 'none' as const };
      }

      if (/invalid|không đúng|locked|khoá|failed/i.test(text)) {
        return {
          status: 'auth_failed' as const,
          message: `Đăng nhập SAP thất bại: ${text}`,
        };
      }

      return { status: 'none' as const };
    },
    [autoTakeOverSession]
  );

  const match = frameResults
    .map((r) => r.result)
    .find((r) => r && r.status !== 'none');

  if (match && match.status === 'took_over' && 'coords' in match) {
    await animateTargetClick(tabId, match.coords, signal);
  }

  return match || { status: 'none' };
}

async function navigateToStandardModule(
  tabId: number,
  targetModule: Exclude<SapTargetModule, 'HOME' | 'QUERY_PRICELIST'>,
  onProgress: SapProgressCallback,
  signal?: AbortSignal
): Promise<boolean> {
  const config: Record<
    Exclude<SapTargetModule, 'HOME' | 'QUERY_PRICELIST'>,
    { parents: string[]; labels: string[]; readable: string }
  > = {
    PURCHASING_PO: {
      parents: ['Purchasing - A/P', 'Mua hàng - A/P', 'Purchasing', 'Phân hệ Mua hàng'],
      labels: [
        'Purchase Order',
        'Purchase Orders',
        'Create Purchase Order',
        'Đơn đặt hàng mua',
        'Đơn mua hàng',
      ],
      readable: 'Đặt hàng (Purchase Order)',
    },
    PURCHASING_GRPO: {
      parents: ['Purchasing - A/P', 'Mua hàng - A/P', 'Purchasing'],
      labels: ['Goods Receipt PO', 'Goods Receipt POs', 'Nhập hàng từ PO', 'Phiếu nhập kho mua hàng'],
      readable: 'Nhập kho (Goods Receipt PO)',
    },
    PURCHASING_RETURN: {
      parents: ['Purchasing - A/P', 'Mua hàng - A/P', 'Purchasing'],
      labels: [
        'Goods Return',
        'Goods Returns',
        'Goods Return Request',
        'Trả hàng mua',
        'Xuất trả hàng nhà cung cấp',
      ],
      readable: 'Xuất trả hàng (Goods Return)',
    },
    INVENTORY_STATUS: {
      parents: ['Inventory', 'Kho hàng', 'Tồn kho', 'Purchasing - A/P'],
      labels: [
        'Inventory Status',
        'Inventory Reports',
        'Items',
        'Item Master Data',
        'Báo cáo tồn kho',
        'Danh mục hàng hóa',
      ],
      readable: 'Kiểm tra tồn kho (Inventory Status)',
    },
  };

  const target = config[targetModule];
  await reportStatus(tabId, onProgress, `Đang điều hướng tới phân hệ ${target.readable}...`, 85);
  await sleep(700, signal);

  const frameResults = await execInAllFrames(
    tabId,
    async (params: { parents: string[]; labels: string[] }) => {
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const isVisible = (el: Element | null): el is HTMLElement => {
        if (!el || !(el instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
          return false;
        }
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const clickByLabel = async (label: string): Promise<boolean> => {
        const lower = label.toLowerCase();
        const prioritySelectors = [
          '.sapMGT',
          '.sapUshellTile',
          'a',
          'button',
          '[role="treeitem"]',
          'span',
          'div',
        ];
        for (const sel of prioritySelectors) {
          const candidates = Array.from(document.querySelectorAll(sel)).filter(isVisible);
          const exact = candidates.find(
            (el) => (el.textContent || '').trim().toLowerCase() === lower
          );
          const partial = candidates.find((el) =>
            (el.textContent || '').toLowerCase().includes(lower)
          );
          const match = exact || partial;
          if (match) {
            match.scrollIntoView({ block: 'center', inline: 'center' });
            match.click();
            await wait(700);
            return true;
          }
        }
        return false;
      };

      for (const label of params.labels) {
        if (await clickByLabel(label)) return true;
      }

      for (const parent of params.parents) {
        if (await clickByLabel(parent)) {
          for (const label of params.labels) {
            if (await clickByLabel(label)) return true;
          }
        }
      }

      const searchSelectors = [
        'input[placeholder*="Look up menus" i]',
        'input[placeholder*="Search" i]',
        'input[placeholder*="Tìm" i]',
        '#shell-header input',
        '.sapUshellSearch input',
      ];
      for (const sel of searchSelectors) {
        const input = document.querySelector(sel) as HTMLInputElement | null;
        if (!isVisible(input) || !input) continue;
        for (const label of params.labels) {
          input.focus();
          input.value = label;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true })
          );
          input.dispatchEvent(
            new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true })
          );
          await wait(900);
          return true;
        }
      }
      return false;
    },
    [{ parents: target.parents, labels: target.labels }]
  );

  const navigated = frameResults.some((r) => Boolean(r.result));
  if (navigated) {
    await reportStatus(
      tabId,
      onProgress,
      `Đã đăng nhập SAP và mở sẵn phân hệ nghiệp vụ: ${target.readable}.`,
      100
    );
  } else {
    await reportStatus(
      tabId,
      onProgress,
      `Đã đăng nhập SAP; chưa tìm thấy menu ${targetModule} để điều hướng.`,
      95
    );
  }
  return navigated;
}

/**
 * Automates SAP B1 Browser Access Query Manager -> Execute -> Export Excel (.xlsx)
 * aligned with THAO_TÁC_SAP.pdf and captures the file via chrome.downloads.
 */
async function runQueryManagerAndExport(
  tabId: number,
  category: string,
  queryName: string,
  onProgress: SapProgressCallback,
  signal?: AbortSignal
): Promise<SapAutomationResult> {
  await reportStatus(tabId, onProgress, 'Đang mở Query Manager trên SAP Business One...', 68);

  // Step 1: Open Query Manager via Toolbar icon, Tools -> Queries -> Query Manager, or Look up menus
  let state = await readSapScreenState(tabId);
  if (state.screen !== 'QUERY_MANAGER') {
    const qmResults = await execInAllFrames(
      tabId,
      async () => {
        const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
        const isVisible = (el: Element | null): el is HTMLElement => {
          if (!el || !(el instanceof HTMLElement)) return false;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            return false;
          }
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };

        const isQmVisible = () => {
          const txt = document.body?.innerText || '';
          return (
            txt.includes('Query Manager') ||
            txt.includes('Query Category') ||
            txt.includes('Manage Categories')
          );
        };

        const findVisibleByText = (text: string, exact = false): HTMLElement | null => {
          const lower = text.toLowerCase();
          const all = Array.from(
            document.querySelectorAll('a, button, span, div, li, [role="menuitem"], [role="treeitem"]')
          ).filter(isVisible);
          const matches = all.filter((el) => {
            const t = (el.textContent || '').trim().toLowerCase();
            return exact ? t === lower : t.includes(lower);
          });
          return matches.length > 0 ? matches[matches.length - 1] : null;
        };

        const clickWithCoords = (el: HTMLElement): TargetCoords => {
          el.scrollIntoView({ block: 'center', inline: 'center' });
          const rect = el.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          const hit = document.elementFromPoint(cx, cy);
          const occluded = Boolean(hit && hit !== el && !el.contains(hit) && !hit.contains(el));
          el.click();
          return {
            found: true,
            occluded,
            x: cx,
            y: cy,
            rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
          };
        };

        // 1a. Try Toolbar Query Manager icon first (per THAO_TÁC_SAP.pdf)
        if (!isQmVisible()) {
          const iconSelectors = [
            'button[title*="Query Manager" i]',
            '[title*="Query Manager" i]',
            'button[aria-label*="Query Manager" i]',
            '[data-sap-ui*="query" i]',
          ];
          for (const sel of iconSelectors) {
            const icon = Array.from(document.querySelectorAll(sel)).find(isVisible);
            if (icon) {
              const coords = clickWithCoords(icon);
              await wait(800);
              if (isQmVisible()) return { opened: true, coords };
            }
          }
        }

        // 1b. Try Tools -> Queries -> Query Manager
        if (!isQmVisible()) {
          const tools = findVisibleByText('Tools', true);
          if (tools) {
            clickWithCoords(tools);
            await wait(500);
            const queries = findVisibleByText('Queries') || findVisibleByText('Query Manager');
            if (queries) {
              clickWithCoords(queries);
              await wait(500);
            }
            const qmSub = findVisibleByText('Query Manager');
            if (qmSub) {
              const coords = clickWithCoords(qmSub);
              await wait(800);
              if (isQmVisible()) return { opened: true, coords };
            }
          }
        }

        // 1c. Fallback: Look up menus
        if (!isQmVisible()) {
          const lookup = document.querySelector(
            'input[placeholder*="Look up menus" i]'
          ) as HTMLInputElement | null;
          if (isVisible(lookup) && lookup) {
            lookup.focus();
            lookup.value = 'Query Manager';
            lookup.dispatchEvent(new Event('input', { bubbles: true }));
            lookup.dispatchEvent(
              new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true })
            );
            await wait(1000);
            const qmResult = findVisibleByText('Query Manager');
            if (qmResult) {
              const coords = clickWithCoords(qmResult);
              await wait(800);
              return { opened: isQmVisible(), coords };
            }
          }
        }

        return { opened: isQmVisible() };
      },
      []
    );

    const openedEntry = qmResults.map((r) => r.result).find((r) => r?.opened);
    if (openedEntry?.coords) {
      await animateTargetClick(tabId, openedEntry.coords, signal);
    }
    state = await readSapScreenState(tabId);
  }

  if (state.screen !== 'QUERY_MANAGER') {
    return {
      ok: false,
      message: 'Đã vào SAP nhưng chưa mở được cửa sổ Query Manager tự động.',
    };
  }

  throwIfAborted(signal);

  // Step 2 & 3: Double-click category ("Danh Mục"), scroll & double-click queryName, and click OK
  await reportStatus(tabId, onProgress, `Đang chọn nhóm "${category}" -> "${queryName}"...`, 75);
  const selectResults = await execInAllFrames(
    tabId,
    async (params: { category: string; queryName: string }) => {
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const isVisible = (el: Element | null): el is HTMLElement => {
        if (!el || !(el instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
          return false;
        }
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const findVisibleByText = (text: string): HTMLElement | null => {
        const lower = text.toLowerCase();
        const all = Array.from(
          document.querySelectorAll('td, span, div, li, a, [role="treeitem"], [role="row"]')
        ).filter(isVisible);
        const exact = all.filter((el) => (el.textContent || '').trim().toLowerCase() === lower);
        if (exact.length > 0) return exact[exact.length - 1];
        const partial = all.filter((el) => (el.textContent || '').toLowerCase().includes(lower));
        return partial.length > 0 ? partial[partial.length - 1] : null;
      };

      const dblClickEl = (el: HTMLElement): TargetCoords => {
        el.scrollIntoView({ block: 'center', inline: 'center' });
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const hit = document.elementFromPoint(cx, cy);
        const occluded = Boolean(hit && hit !== el && !el.contains(hit) && !hit.contains(el));
        el.click();
        el.dispatchEvent(
          new MouseEvent('dblclick', {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: cx,
            clientY: cy,
          })
        );
        return {
          found: true,
          occluded,
          x: cx,
          y: cy,
          rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
        };
      };

      const catEl = findVisibleByText(params.category);
      let catCoords: TargetCoords | undefined;
      if (catEl) {
        catCoords = dblClickEl(catEl);
        await wait(700);
      }

      const queryEl = findVisibleByText(params.queryName);
      let queryCoords: TargetCoords | undefined;
      if (queryEl) {
        queryCoords = dblClickEl(queryEl);
        await wait(400);
      }

      const okBtns = Array.from(document.querySelectorAll('button')).filter(isVisible);
      const okBtn = okBtns.find((b) => (b.textContent || '').trim().toLowerCase() === 'ok');
      if (okBtn) {
        okBtn.click();
      }

      return { catCoords, queryCoords };
    },
    [{ category, queryName }]
  );

  for (const r of selectResults) {
    if (r.result?.catCoords) await animateTargetClick(tabId, r.result.catCoords, signal);
    if (r.result?.queryCoords) await animateTargetClick(tabId, r.result.queryCoords, signal);
  }

  // Step 4: Wait for query results table to populate via real-time screen reader
  await reportStatus(
    tabId,
    onProgress,
    `Đang thực thi truy vấn "${queryName}" và chờ bảng kết quả...`,
    82
  );
  for (let qWait = 0; qWait < 12; qWait++) {
    await sleep(500, signal);
    state = await readSapScreenState(tabId);
    if (state.screen === 'QUERY_RESULT' && !state.isLoading) break;
  }

  // Set up chrome.downloads listener BEFORE clicking Export to MS-EXCEL
  const api = getChromeApi();
  let capturedDownloadId: number | undefined;
  let capturedFilename: string | undefined;
  let downloadResolve:
    | ((item: { id: number; filename?: string; ok: boolean; error?: string }) => void)
    | null = null;

  const downloadDonePromise = new Promise<{
    id?: number;
    filename?: string;
    ok: boolean;
    error?: string;
  }>((resolve) => {
    downloadResolve = resolve;
  });

  const onCreated = (item: ChromeDownloadItem) => {
    if (capturedDownloadId === undefined) {
      capturedDownloadId = item.id;
      if (item.filename) capturedFilename = item.filename;
      if (item.state === 'complete') {
        downloadResolve?.({ id: item.id, filename: capturedFilename, ok: true });
      }
    }
  };

  const onChanged = (delta: ChromeDownloadDelta) => {
    if (capturedDownloadId !== undefined && delta.id !== capturedDownloadId) return;
    if (capturedDownloadId === undefined) capturedDownloadId = delta.id;
    if (delta.filename?.current) {
      capturedFilename = delta.filename.current;
    }
    if (delta.state?.current === 'complete') {
      downloadResolve?.({ id: delta.id, filename: capturedFilename, ok: true });
    } else if (delta.state?.current === 'interrupted') {
      downloadResolve?.({
        id: delta.id,
        filename: capturedFilename,
        ok: false,
        error: delta.error?.current || 'Download interrupted',
      });
    }
  };

  api.downloads?.onCreated.addListener(onCreated);
  api.downloads?.onChanged.addListener(onChanged);

  try {
    // Step 5: Trigger "Export to MS-EXCEL"
    await reportStatus(tabId, onProgress, 'Đang nhấn Export to MS-EXCEL...', 88);
    const exportFrameResults = await execInAllFrames(
      tabId,
      async () => {
        const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
        const isVisible = (el: Element | null): el is HTMLElement => {
          if (!el || !(el instanceof HTMLElement)) return false;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            return false;
          }
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };

        const clickExport = (btn: HTMLElement): TargetCoords => {
          btn.scrollIntoView({ block: 'center', inline: 'center' });
          const rect = btn.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          const hit = document.elementFromPoint(cx, cy);
          const occluded = Boolean(hit && hit !== btn && !btn.contains(hit) && !hit.contains(btn));
          btn.click();
          return {
            found: true,
            occluded,
            x: cx,
            y: cy,
            rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
          };
        };

        const exportSelectors = [
          'button[title*="Export to Excel" i]',
          'button[title*="Export to MS-EXCEL" i]',
          'button[title*="MS-EXCEL" i]',
          'button[title*="Export to Spreadsheet" i]',
          'button[aria-label*="Export to Excel" i]',
          'button[aria-label*="Export to Spreadsheet" i]',
          '[title*="Export to MS-EXCEL" i]',
          '.sapUiTableToolbar button[title*="xls" i]',
          '[data-action="exportExcel"]',
        ];

        for (const sel of exportSelectors) {
          const btn = Array.from(document.querySelectorAll(sel)).find(isVisible);
          if (btn) {
            const coords = clickExport(btn);
            await wait(1500);
            return { clicked: true, coords };
          }
        }

        const textLabels = [
          'Export to Excel',
          'Export to Spreadsheet',
          'Xuất Excel',
          'Xuất ra Excel',
        ];
        const allBtns = Array.from(document.querySelectorAll('button, a, span, div')).filter(
          isVisible
        );
        for (const label of textLabels) {
          const match = allBtns.find((el) =>
            (el.textContent || '').toLowerCase().includes(label.toLowerCase())
          );
          if (match) {
            const coords = clickExport(match);
            await wait(1500);
            return { clicked: true, coords };
          }
        }

        return { clicked: false };
      },
      []
    );

    const exportHit = exportFrameResults.map((r) => r.result).find((r) => r?.clicked);
    if (!exportHit) {
      return {
        ok: false,
        message: `Đã mở bảng kết quả "${queryName}" nhưng chưa tìm thấy nút Export to MS-EXCEL.`,
      };
    }
    await animateTargetClick(tabId, exportHit.coords, signal);

    // Step 6 & 7: Confirm "Save As" (.xlsx format + OK) and "Export currency symbols?" dialogs
    await reportStatus(
      tabId,
      onProgress,
      'Đang chọn định dạng .xlsx trong Save As & xác nhận Export currency symbols...',
      92
    );
    await sleep(800, signal);
    await execInAllFrames(
      tabId,
      async () => {
        const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
        const isVisible = (el: Element | null): el is HTMLElement => {
          if (!el || !(el instanceof HTMLElement)) return false;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };

        const getActiveDialog = (): ParentNode => {
          const dialogs = Array.from(
            document.querySelectorAll(
              '.sapMDialog, #messagebox, [role="dialog"], .dialog, .b1-dialog'
            )
          ).filter(isVisible);
          return dialogs[0] || document;
        };

        const selectXlsxFormatIfPresent = (scope: ParentNode) => {
          const selects = Array.from(scope.querySelectorAll('select')).filter(isVisible);
          for (const sel of selects as HTMLSelectElement[]) {
            for (let i = 0; i < sel.options.length; i++) {
              const opt = sel.options[i];
              const txt = (opt.textContent || opt.text || '').toLowerCase();
              const val = (opt.value || '').toLowerCase();
              if (txt.includes('xlsx') || val.includes('xlsx')) {
                sel.selectedIndex = i;
                sel.value = opt.value;
                sel.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
              }
            }
          }
          return false;
        };

        const clickOkButton = () => {
          const scope = getActiveDialog();
          const okBtn = Array.from(scope.querySelectorAll('button')).find(
            (b) => isVisible(b) && (b.textContent || '').trim().toLowerCase() === 'ok'
          );
          if (okBtn) {
            okBtn.click();
            return true;
          }
          return false;
        };

        const bodyText = document.body?.innerText || '';
        if (bodyText.includes('Save As') || bodyText.includes('Enter a file name')) {
          selectXlsxFormatIfPresent(getActiveDialog());
          await wait(300);
          clickOkButton();
          await wait(800);
        }

        if ((document.body?.innerText || '').includes('Export currency symbols')) {
          clickOkButton();
        }
      },
      []
    );

    // Step 8: Wait for chrome.downloads completion (up to 35s)
    await reportStatus(
      tabId,
      onProgress,
      'Đang chờ SAP kết xuất và tải file Excel về máy...',
      95
    );
    const timeoutPromise = sleep(35000, signal).then(() => ({
      id: capturedDownloadId,
      filename: capturedFilename,
      ok: false,
      error: 'timeout',
    }));

    const dlResult = await Promise.race([downloadDonePromise, timeoutPromise]);

    if (dlResult.ok && dlResult.id !== undefined) {
      let finalFilename = dlResult.filename;
      if (!finalFilename && api.downloads?.search) {
        const items = await api.downloads.search({ id: dlResult.id }).catch(() => []);
        finalFilename = items[0]?.filename;
      }
      await reportStatus(
        tabId,
        onProgress,
        `Đã xuất và tải thành công file SAP: ${finalFilename || queryName}`,
        100
      );
      return {
        ok: true,
        downloadId: dlResult.id,
        filename: finalFilename,
        message: `Đã xuất và tải thành công file SAP: ${finalFilename || queryName}`,
      };
    }

    if (capturedDownloadId !== undefined) {
      await reportStatus(
        tabId,
        onProgress,
        `Đã kích hoạt tải xuống file SAP (ID: ${capturedDownloadId}).`,
        100
      );
      return {
        ok: true,
        downloadId: capturedDownloadId,
        filename: capturedFilename,
        message: `Đã hoàn tất lệnh xuất dữ liệu "${queryName}" trên SAP Business One.`,
      };
    }

    await reportStatus(
      tabId,
      onProgress,
      `Đã hoàn tất lệnh xuất dữ liệu "${queryName}" trên SAP Business One.`,
      100
    );
    return {
      ok: true,
      message: `Đã hoàn tất lệnh xuất dữ liệu "${queryName}" trên SAP Business One.`,
    };
  } finally {
    api.downloads?.onCreated.removeListener(onCreated);
    api.downloads?.onChanged.removeListener(onChanged);
  }
}

/**
 * Main Chrome Extension MV3 entry point for SAP Business One automation.
 * Always cleans up the visual cursor overlay in `finally`.
 */
export async function runSapAutomation(
  tabId: number,
  cfg: SapEngineConfig,
  onProgress: SapProgressCallback,
  signal?: AbortSignal
): Promise<SapAutomationResult> {
  if (!cfg.sapUrl) {
    return { ok: false, message: 'Chưa cấu hình SAP URL.' };
  }

  const api = getChromeApi();
  const maxRetries = 10;

  try {
    await injectCursorOverlay(tabId);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      throwIfAborted(signal);
      await reportStatus(
        tabId,
        onProgress,
        `Kiểm tra phiên làm việc SAP (Lần ${attempt}/${maxRetries})...`,
        10
      );

      let screenState = await readSapScreenState(tabId);
      const dispatcherRootUrl = resolveDispatcherRootUrl(cfg.sapUrl, screenState.url);

      // 1. Auto-recover if sitting on SAML2 /dispatcher/saml2/sp/acs NullPointerException
      if (screenState.screen === 'SAML_ERROR') {
        await reportStatus(
          tabId,
          onProgress,
          `Phát hiện lỗi SAML2 (/dispatcher/saml2/sp/acs) — Đang điều hướng về ${dispatcherRootUrl}...`,
          20
        );
        await navigateTab(tabId, dispatcherRootUrl, 30000, signal);
        for (let w = 0; w < 25; w++) {
          await sleep(1000, signal);
          screenState = await readSapScreenState(tabId);
          if (
            screenState.screen === 'WORKSPACE_READY' ||
            screenState.screen === 'SYSTEM_MESSAGES_LOG' ||
            screenState.screen === 'QUERY_MANAGER' ||
            screenState.screen === 'QUERY_RESULT'
          ) {
            break;
          }
        }
      }

      // 2. Check if already authenticated
      if (
        screenState.screen === 'WORKSPACE_READY' ||
        screenState.screen === 'SYSTEM_MESSAGES_LOG' ||
        screenState.screen === 'QUERY_MANAGER' ||
        screenState.screen === 'QUERY_RESULT'
      ) {
        await reportStatus(tabId, onProgress, 'Đã vào màn hình làm việc SAP thành công!', 60);
        if (screenState.screen === 'SYSTEM_MESSAGES_LOG') {
          await dismissSystemMessagesLog(tabId, signal);
        }
        return await handleTargetModule(tabId, cfg, onProgress, signal);
      }

      // 3. Navigate to sapUrl if not currently on SAP host/dispatcher
      const tab = await api.tabs.get(tabId);
      const currentUrl = tab.url || '';
      let parsedHost = '';
      try {
        parsedHost = new URL(cfg.sapUrl).host;
      } catch {
        // ignore invalid URL
      }

      if (
        !currentUrl.includes(parsedHost) &&
        !currentUrl.includes('dispatcher') &&
        !currentUrl.includes('ControlCenter')
      ) {
        await reportStatus(tabId, onProgress, `Mở kết nối SAP: ${cfg.sapUrl}...`, 15);
        await navigateTab(tabId, cfg.sapUrl, 30000, signal);
      }

      await sleep(1200, signal);
      screenState = await readSapScreenState(tabId);
      if (
        screenState.screen === 'WORKSPACE_READY' ||
        screenState.screen === 'SYSTEM_MESSAGES_LOG' ||
        screenState.screen === 'QUERY_MANAGER' ||
        screenState.screen === 'QUERY_RESULT'
      ) {
        await reportStatus(tabId, onProgress, 'Đã vào màn hình làm việc SAP thành công!', 60);
        if (screenState.screen === 'SYSTEM_MESSAGES_LOG') {
          await dismissSystemMessagesLog(tabId, signal);
        }
        return await handleTargetModule(tabId, cfg, onProgress, signal);
      }

      // 4. Wait for SLD login form
      let formVisible = screenState.screen === 'SLD_LOGON';
      if (!formVisible) {
        for (let f = 0; f < 16; f++) {
          throwIfAborted(signal);
          screenState = await readSapScreenState(tabId);
          if (screenState.screen === 'SLD_LOGON') {
            formVisible = true;
            break;
          }
          if (screenState.screen === 'WORKSPACE_READY' || screenState.screen === 'SYSTEM_MESSAGES_LOG') {
            break;
          }
          await sleep(500, signal);
        }
      }

      if (screenState.screen === 'WORKSPACE_READY' || screenState.screen === 'SYSTEM_MESSAGES_LOG') {
        await reportStatus(tabId, onProgress, 'Đã vào màn hình làm việc SAP thành công!', 60);
        if (screenState.screen === 'SYSTEM_MESSAGES_LOG') {
          await dismissSystemMessagesLog(tabId, signal);
        }
        return await handleTargetModule(tabId, cfg, onProgress, signal);
      }

      if (!formVisible) {
        await reportStatus(
          tabId,
          onProgress,
          `Chưa tải được form đăng nhập SAP, mở lại ${dispatcherRootUrl}...`,
          22
        );
        await navigateTab(tabId, dispatcherRootUrl, 30000, signal);
        await sleep(1500, signal);
        continue;
      }

      // 5. Fill logon form & submit
      await reportStatus(
        tabId,
        onProgress,
        `Đang điền thông tin đăng nhập SAP (Lần ${attempt}/${maxRetries})...`,
        30
      );
      const submitRes = await fillAndSubmitLogonForm(tabId, cfg, signal);
      if (!submitRes.ok) {
        await reportStatus(
          tabId,
          onProgress,
          submitRes.retryReason || 'Đang thử điền lại form đăng nhập SAP...',
          32
        );
        await sleep(1000, signal);
        continue;
      }

      // 6. Post-Logon Polling: SAML2 ACS Recovery, Concurrent Login Dialog, and 25s Browser Access Spinner
      await reportStatus(
        tabId,
        onProgress,
        'Đang chờ SAP Browser Access khởi tạo phiên làm việc...',
        45
      );
      for (let waitSec = 0; waitSec < 25; waitSec++) {
        await sleep(1000, signal);
        screenState = await readSapScreenState(tabId);

        if (
          screenState.screen === 'WORKSPACE_READY' ||
          screenState.screen === 'SYSTEM_MESSAGES_LOG'
        ) {
          await reportStatus(
            tabId,
            onProgress,
            'Đã đăng nhập thành công vào màn hình làm việc SAP!',
            60
          );
          if (screenState.screen === 'SYSTEM_MESSAGES_LOG') {
            await dismissSystemMessagesLog(tabId, signal);
          }
          return await handleTargetModule(tabId, cfg, onProgress, signal);
        }

        if (screenState.screen === 'SAML_ERROR') {
          await reportStatus(
            tabId,
            onProgress,
            `Phát hiện lỗi SAML2 (/dispatcher/saml2/sp/acs) sau Log On — Chuyển về ${dispatcherRootUrl}...`,
            50
          );
          await navigateTab(tabId, dispatcherRootUrl, 30000, signal);
          for (let dWait = 0; dWait < 25; dWait++) {
            await sleep(1000, signal);
            screenState = await readSapScreenState(tabId);
            if (
              screenState.screen === 'WORKSPACE_READY' ||
              screenState.screen === 'SYSTEM_MESSAGES_LOG'
            ) {
              await reportStatus(
                tabId,
                onProgress,
                'Đã vào SAP Business One thành công sau khi vượt lỗi SAML2!',
                60
              );
              if (screenState.screen === 'SYSTEM_MESSAGES_LOG') {
                await dismissSystemMessagesLog(tabId, signal);
              }
              return await handleTargetModule(tabId, cfg, onProgress, signal);
            }
          }
          break;
        }

        if (screenState.screen === 'CONCURRENT_LOGIN') {
          const dialogRes = await checkAndHandleAuthDialog(
            tabId,
            cfg.autoTakeOverSession === true,
            signal
          );
          if (dialogRes.status === 'concurrent_blocked' || dialogRes.status === 'auth_failed') {
            return {
              ok: false,
              message: dialogRes.message || 'Đăng nhập SAP thất bại.',
            };
          }
          if (dialogRes.status === 'took_over') {
            await reportStatus(tabId, onProgress, 'Đã xác nhận chiếm phiên đăng nhập SAP...', 55);
            await sleep(1500, signal);
          }
        }
      }

      screenState = await readSapScreenState(tabId);
      if (
        screenState.screen === 'WORKSPACE_READY' ||
        screenState.screen === 'SYSTEM_MESSAGES_LOG'
      ) {
        await reportStatus(tabId, onProgress, 'Đã vào màn hình làm việc SAP!', 60);
        if (screenState.screen === 'SYSTEM_MESSAGES_LOG') {
          await dismissSystemMessagesLog(tabId, signal);
        }
        return await handleTargetModule(tabId, cfg, onProgress, signal);
      }

      await reportStatus(
        tabId,
        onProgress,
        `Chưa vào được màn hình làm việc, mở lại ${dispatcherRootUrl}...`,
        40
      );
      await navigateTab(tabId, dispatcherRootUrl, 30000, signal);
      await sleep(1500, signal);
    }

    return {
      ok: false,
      message: `Đã thử lại ${maxRetries} lần nhưng chưa vào được màn hình làm việc SAP.`,
    };
  } catch (err) {
    if (err instanceof SapAbortError) {
      return { ok: false, message: err.message };
    }
    return {
      ok: false,
      message: `Lỗi tự động hóa SAP: ${(err as Error).message}`,
    };
  } finally {
    await removeCursorOverlay(tabId).catch(() => null);
  }
}

async function handleTargetModule(
  tabId: number,
  cfg: SapEngineConfig,
  onProgress: SapProgressCallback,
  signal?: AbortSignal
): Promise<SapAutomationResult> {
  const targetModule = cfg.targetModule || 'HOME';
  if (targetModule === 'HOME') {
    await reportStatus(
      tabId,
      onProgress,
      'Đã sẵn sàng tại màn hình chính SAP Business One.',
      100
    );
    return { ok: true, message: 'Đăng nhập SAP thành công, đã vào màn hình làm việc.' };
  }

  if (targetModule === 'QUERY_PRICELIST') {
    const category = cfg.queryCategory || 'Danh Mục';
    const queryName = cfg.queryName || 'Danh sách item ncc pricelist_non_Asset';
    return await runQueryManagerAndExport(tabId, category, queryName, onProgress, signal);
  }

  const navigated = await navigateToStandardModule(tabId, targetModule, onProgress, signal);
  return {
    ok: navigated,
    message: navigated
      ? `Đã điều hướng tới phân hệ ${targetModule} trên SAP.`
      : `Đã đăng nhập SAP nhưng chưa tìm thấy menu ${targetModule}.`,
  };
}
