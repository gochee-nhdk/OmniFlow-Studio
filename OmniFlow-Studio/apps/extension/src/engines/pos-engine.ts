// ============================================================
// OmniFlow Studio Extension — MV3 POS RPFO Automation Engine
// 100% Chrome Extension MV3 (chrome.scripting, chrome.tabs, chrome.downloads)
// ============================================================

import { injectCursorOverlay, cursorAction, removeCursorOverlay, type ElementRect } from './cursor-overlay';
import type { WeekConvention } from '../types';

export type PosScreenName =
  | 'LOGIN'
  | 'LOADING_DATA'
  | 'SELECT_OUTLET'
  | 'DASHBOARD'
  | 'INVENTORY_ONHAND'
  | 'SALES_DETAIL'
  | 'MORE_MODAL'
  | 'HEADER_FILTER_POPUP'
  | 'PAGE_NOT_FOUND'
  | 'UNKNOWN';

export interface PosScreenState {
  url: string;
  screen: PosScreenName;
  isLoading: boolean;
  gridRowCount: number;
  hasExportButton: boolean;
  activeOverlayBlocking: boolean;
  currentFromDate?: string;
  currentToDate?: string;
}

export interface PosEngineConfig {
  posUrl: string;
  username: string;
  password: string;
  preferredOutlet?: string;
  fromDate?: string;
  toDate?: string;
  weekConvention?: WeekConvention;
  storeFilter?: string;
  slocFilter?: string;
  itemFilter?: string;
  fileNameTemplate?: string;
}

export interface PosDateRange {
  fromDate: string;
  toDate: string;
}

export type PosProgressCallback = (step: string, percent: number) => void;

export interface PosLoginResult {
  ok: boolean;
  url: string;
  message: string;
}

export interface PosDownloadResult {
  ok: boolean;
  filename?: string;
  downloadId?: number;
  message: string;
}

interface ChromeScriptingAPI {
  executeScript<Args extends unknown[], Result>(injection: {
    target: { tabId: number; allFrames?: boolean };
    world?: 'MAIN' | 'ISOLATED';
    func: (...args: Args) => Result;
    args?: Args;
  }): Promise<Array<{ frameId: number; result: Result }>>;
}

interface ChromeDownloadItem {
  id: number;
  filename?: string;
  url?: string;
  state?: 'in_progress' | 'interrupted' | 'complete';
  error?: string;
}

interface ChromeDownloadsAPI {
  download(options: {
    url: string;
    filename?: string;
    saveAs?: boolean;
    conflictAction?: 'uniquify' | 'overwrite' | 'prompt';
  }): Promise<number>;
  search(query: { id?: number }): Promise<ChromeDownloadItem[]>;
  onCreated: {
    addListener(cb: (item: ChromeDownloadItem) => void): void;
    removeListener(cb: (item: ChromeDownloadItem) => void): void;
  };
  onChanged: {
    addListener(cb: (delta: { id: number; state?: { current?: string }; filename?: { current?: string }; error?: { current?: string } }) => void): void;
    removeListener(cb: (delta: { id: number; state?: { current?: string }; filename?: { current?: string }; error?: { current?: string } }) => void): void;
  };
}

interface ChromeTabsExtended {
  get(tabId: number): Promise<chrome.tabs.Tab>;
  update(tabId: number, props: { url?: string; active?: boolean }): Promise<chrome.tabs.Tab>;
}

function getScripting(): ChromeScriptingAPI {
  const api = (chrome as unknown as { scripting?: ChromeScriptingAPI }).scripting;
  if (!api) throw new Error('chrome.scripting API is unavailable.');
  return api;
}

function getDownloads(): ChromeDownloadsAPI {
  const api = (chrome as unknown as { downloads?: ChromeDownloadsAPI }).downloads;
  if (!api) throw new Error('chrome.downloads API is unavailable.');
  return api;
}

function getTabs(): ChromeTabsExtended {
  return chrome.tabs as unknown as ChromeTabsExtended;
}

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('Workflow cancelled by user.');
  }
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  checkAborted(signal);
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Workflow cancelled by user.'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function execMain<Args extends unknown[], Result>(
  tabId: number,
  func: (...args: Args) => Result,
  ...args: Args
): Promise<Result | undefined> {
  // MV3 chrome.scripting.executeScript rejects undefined values in args ("Value is unserializable")
  const safeArgs = args.map((a) => (a === undefined ? null : a)) as Args;
  const results = await getScripting().executeScript({
    target: { tabId },
    world: 'MAIN',
    func,
    args: safeArgs,
  });
  return results?.[0]?.result;
}

export function normalizePosBaseUrl(rawUrl: string): string {
  const clean = (rawUrl || '').trim().replace(/\/(home|login)\/?$/i, '');
  if (!clean) {
    throw new Error('POS URL is not configured.');
  }
  return clean.endsWith('/') ? clean : `${clean}/`;
}

export function formatDateYmd(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Compute previous week's [fromDate, toDate] (YYYY-MM-DD) for the given convention:
 * - 'mon-sun' (T2-CN): previous Monday through Sunday
 * - 'sun-sat' (CN-T7): previous Sunday through Saturday
 */
export function getPreviousWeekRange(
  weekConvention: WeekConvention = 'mon-sun',
  referenceDate: Date = new Date()
): PosDateRange {
  const today = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  const dayOfWeek = today.getDay();
  if (weekConvention === 'sun-sat') {
    const prevSunday = new Date(today);
    prevSunday.setDate(today.getDate() - dayOfWeek - 7);
    const prevSaturday = new Date(prevSunday);
    prevSaturday.setDate(prevSunday.getDate() + 6);
    return { fromDate: formatDateYmd(prevSunday), toDate: formatDateYmd(prevSaturday) };
  }
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  const prevMonday = new Date(today);
  prevMonday.setDate(today.getDate() - daysSinceMonday - 7);
  const prevSunday = new Date(prevMonday);
  prevSunday.setDate(prevMonday.getDate() + 6);
  return { fromDate: formatDateYmd(prevMonday), toDate: formatDateYmd(prevSunday) };
}

export function parseFilterValues(raw?: string | string[]): string[] {
  const values = raw == null ? [] : Array.isArray(raw) ? raw : String(raw).split(/[,;]+/);
  return values
    .map((v) => String(v).trim())
    .filter((v) => v.length > 0 && !['all', 'all_sloc'].includes(v.toLowerCase()));
}

export function resolveColumnIdentifiers(columnField: string): { dataField: string; titles: string[] } {
  const norm = columnField.trim().toLowerCase();
  if (norm === 'slocid' || norm === 'sloc id' || norm === 'sloc') {
    return { dataField: 'slocId', titles: ['Sloc Id', 'Sloc ID', 'Sloc', 'Kho'] };
  }
  if (norm === 'itemcode' || norm === 'item code' || norm === 'item') {
    return { dataField: 'itemCode', titles: ['Item Code', 'Item', 'Mã sản phẩm', 'Mã'] };
  }
  if (norm === 'storeid' || norm === 'store id' || norm === 'store') {
    return { dataField: 'storeId', titles: ['Store Id', 'Store ID', 'Store', 'Cửa hàng'] };
  }
  if (norm === 'whsname' || norm === 'whs name') {
    return { dataField: 'whsName', titles: ['Whs Name', 'Tên kho'] };
  }
  if (norm === 'itemname' || norm === 'item name') {
    return { dataField: 'itemName', titles: ['Item Name', 'Tên sản phẩm'] };
  }
  return { dataField: columnField, titles: [columnField] };
}

export function resolveFilename(template: string, vars: Record<string, string>): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const allVars: Record<string, string> = {
    timestamp,
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    ...vars,
  };
  let name = template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => allVars[key] ?? '');
  if (!name.toLowerCase().endsWith('.xlsx')) {
    name += '.xlsx';
  }
  return name.replace(/[<>:"/\\|?*]/g, '_');
}

async function getTabUrl(tabId: number): Promise<string> {
  const tab = await getTabs().get(tabId);
  return tab?.url || '';
}

async function navigateAndWait(
  tabId: number,
  url: string,
  signal?: AbortSignal,
  timeoutMs = 25000
): Promise<void> {
  checkAborted(signal);
  await getTabs().update(tabId, { url });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(350, signal);
    const tab = await getTabs().get(tabId).catch(() => null);
    if (tab?.status === 'complete') {
      break;
    }
  }
  await injectCursorOverlay(tabId);
}

interface LocatedElement {
  found: boolean;
  x: number;
  y: number;
  rect: ElementRect;
  occluded?: boolean;
}

/**
 * Real-Time Screen Reader: inspects the live POS tab DOM & URL before/after each step.
 */
export async function readPosScreenState(tabId: number): Promise<PosScreenState> {
  const url = await getTabUrl(tabId).catch(() => '');
  const dom = await execMain(tabId, (): Omit<PosScreenState, 'url'> => {
    const isVisible = (el: Element): boolean => {
      const htmlEl = el as HTMLElement;
      const st = window.getComputedStyle(htmlEl);
      if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;
      const r = htmlEl.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };

    const bodyText = document.body?.innerText || '';
    const href = window.location.href || '';

    const hasWave = Array.from(
      document.querySelectorAll('.dx-loadpanel, .dx-loadindicator, .loading-wave, [class*="wave"], .dx-export-loadpanel')
    ).some(isVisible);
    const hasLoadingBtn = Array.from(document.querySelectorAll('button, dx-button, .dx-button')).some(
      (b) => isVisible(b) && (b.textContent || '').includes('Loading data')
    );
    const hasLoadingText =
      bodyText.includes('Loading data. Please wait a minute') ||
      bodyText.includes('Loading Max Value Currency') ||
      bodyText.includes('Loading Information Shop') ||
      bodyText.includes('Exporting...');

    const isLoading = hasWave || hasLoadingBtn || hasLoadingText;

    const activeOverlayBlocking = Array.from(
      document.querySelectorAll('.dx-overlay-wrapper .dx-loadpanel-content, .dx-loadpanel, .dx-export-loadpanel, .loading-wave')
    ).some(isVisible);

    const gridRowCount = document.querySelectorAll('.dx-datagrid-rowsview tr.dx-data-row, .dx-datagrid-rowsview .dx-data-row').length;

    const hasExportButton = Array.from(
      document.querySelectorAll(
        '.dx-datagrid-header-panel .dx-datagrid-export-button, .dx-datagrid-export-button, .dx-button .dx-icon-xlsxfile, .btn-excel'
      )
    ).some(isVisible);

    const isNotFound =
      !!document.querySelector('app-page-not-found') ||
      bodyText.includes('page-not-found works!') ||
      href.includes('404') ||
      href.endsWith('/home') ||
      href.endsWith('/home/');

    const hasFilterPopup = Array.from(document.querySelectorAll('.dx-header-filter-menu')).some(isVisible);

    const hasMoreModal = Array.from(
      document.querySelectorAll('[role="dialog"], .modal, .dx-popup-normal')
    ).some((m) => {
      if (!isVisible(m)) return false;
      const txt = m.textContent || '';
      return txt.includes('Search Menu') || (txt.includes('More') && txt.includes('Report'));
    });

    const hasLoginForm =
      href.includes('/login') ||
      Array.from(document.querySelectorAll('#txtName, input[name*="user" i], input[placeholder*="User" i]')).some(isVisible);

    const hasSelectOutlet =
      href.includes('select-outlets') ||
      Array.from(document.querySelectorAll('.blog-sider-common')).some(isVisible) ||
      bodyText.includes('Last Login');

    let screen: PosScreenName = 'UNKNOWN';
    if (isNotFound) {
      screen = 'PAGE_NOT_FOUND';
    } else if (hasFilterPopup) {
      screen = 'HEADER_FILTER_POPUP';
    } else if (hasMoreModal) {
      screen = 'MORE_MODAL';
    } else if (hasLoginForm) {
      screen = 'LOGIN';
    } else if (hasSelectOutlet) {
      screen = isLoading ? 'LOADING_DATA' : 'SELECT_OUTLET';
    } else if (href.includes('inventory-onhand') || (bodyText.includes('Inventory Onhand') && !bodyText.includes('Search Menu'))) {
      screen = 'INVENTORY_ONHAND';
    } else if (href.includes('sales-transaction-detail') || (bodyText.includes('Sales Transaction Detail') && !bodyText.includes('Search Menu'))) {
      screen = 'SALES_DETAIL';
    } else if (isLoading) {
      screen = 'LOADING_DATA';
    } else if (href.includes('/admin') || href.includes('/shop') || bodyText.includes('IN SHOP') || bodyText.includes('MORE')) {
      screen = 'DASHBOARD';
    }

    let currentFromDate: string | undefined;
    let currentToDate: string | undefined;
    if (screen === 'SALES_DETAIL') {
      const normalizeDateToYmd = (raw: unknown): string | undefined => {
        if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
          const pad = (n: number) => String(n).padStart(2, '0');
          return `${raw.getFullYear()}-${pad(raw.getMonth() + 1)}-${pad(raw.getDate())}`;
        }
        if (typeof raw !== 'string') return undefined;
        const text = raw.trim();
        if (!text) return undefined;
        const ymdMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
        if (ymdMatch) {
          const [, y, m, d] = ymdMatch;
          return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
        }
        const dmyMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (dmyMatch) {
          const [, d, m, y] = dmyMatch;
          return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
        }
        return undefined;
      };

      const readDateBoxYmd = (box: Element | undefined): string | undefined => {
        if (!box) return undefined;
        const input = box.querySelector('input.dx-texteditor-input, input') as HTMLInputElement | null;
        const fromInput = normalizeDateToYmd(input?.value);
        if (fromInput) return fromInput;
        const devExpress = (window as any).DevExpress;
        if (devExpress?.ui?.dxDateBox) {
          try {
            const inst = devExpress.ui.dxDateBox.getInstance(box);
            if (inst && typeof inst.option === 'function') {
              return normalizeDateToYmd(inst.option('value'));
            }
          } catch {
            // ignore
          }
        }
        return undefined;
      };

      const visibleBoxes = Array.from(document.querySelectorAll('dx-date-box, .dx-datebox')).filter(isVisible);
      const dateBoxes = visibleBoxes.length >= 2 ? visibleBoxes : Array.from(document.querySelectorAll('dx-date-box, .dx-datebox'));
      currentFromDate = readDateBoxYmd(dateBoxes[0]);
      currentToDate = readDateBoxYmd(dateBoxes[1]);
    }

    return {
      screen,
      isLoading,
      gridRowCount,
      hasExportButton,
      activeOverlayBlocking,
      currentFromDate,
      currentToDate,
    };
  });

  return {
    url,
    screen: dom?.screen ?? 'UNKNOWN',
    isLoading: dom?.isLoading ?? false,
    gridRowCount: dom?.gridRowCount ?? 0,
    hasExportButton: dom?.hasExportButton ?? false,
    activeOverlayBlocking: dom?.activeOverlayBlocking ?? false,
    currentFromDate: dom?.currentFromDate,
    currentToDate: dom?.currentToDate,
  };
}

async function locateVisibleElement(
  tabId: number,
  selectors: string[],
  textMatches?: string[]
): Promise<LocatedElement | null> {
  const res = await execMain(
    tabId,
    (sels: string[], texts: string[] | undefined): LocatedElement | null => {
      const isVisible = (el: Element): boolean => {
        const htmlEl = el as HTMLElement;
        const style = window.getComputedStyle(htmlEl);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
          return false;
        }
        const r = htmlEl.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };

      let target: Element | null = null;
      for (const sel of sels) {
        try {
          const list = Array.from(document.querySelectorAll(sel));
          const found = list.find((el) => isVisible(el));
          if (found) {
            target = found;
            break;
          }
        } catch {
          // ignore invalid selector
        }
      }

      if (!target && texts && texts.length > 0) {
        const candidates = Array.from(
          document.querySelectorAll('button, a, dx-button, .dx-button, span, div, h1, h2, h3, li, td')
        );
        for (const txt of texts) {
          const lower = txt.toLowerCase();
          const exact = candidates.find(
            (el) => isVisible(el) && (el.textContent || '').trim().toLowerCase() === lower
          );
          if (exact) {
            target = exact;
            break;
          }
          const partial = candidates.find(
            (el) =>
              isVisible(el) &&
              el.children.length <= 3 &&
              (el.textContent || '').trim().toLowerCase().includes(lower)
          );
          if (partial) {
            target = partial;
            break;
          }
        }
      }

      if (!target) return null;
      (target as HTMLElement).scrollIntoView({ block: 'center', inline: 'nearest' });
      const r = target.getBoundingClientRect();
      const cx = Math.round(r.left + r.width / 2);
      const cy = Math.round(r.top + r.height / 2);
      const topEl = document.elementFromPoint(cx, cy);
      const occluded = Boolean(topEl && topEl !== target && !target.contains(topEl) && !topEl.contains(target));
      return {
        found: true,
        x: cx,
        y: cy,
        occluded,
        rect: {
          x: r.left,
          y: r.top,
          width: r.width,
          height: r.height,
        },
      };
    },
    selectors,
    textMatches
  );
  return res ?? null;
}

async function visualClickElement(
  tabId: number,
  selectors: string[],
  textMatches?: string[],
  statusLabel?: string,
  signal?: AbortSignal
): Promise<boolean> {
  checkAborted(signal);
  let loc = await locateVisibleElement(tabId, selectors, textMatches);
  if (!loc) return false;

  if (loc.occluded) {
    await waitForLoadingWaveToEnd(tabId, 10000, signal);
    await sleep(300, signal);
    const reLoc = await locateVisibleElement(tabId, selectors, textMatches);
    if (reLoc) loc = reLoc;
  }

  await cursorAction(tabId, { type: 'highlight', rect: loc.rect });
  if (statusLabel) {
    await cursorAction(tabId, { type: 'status', status: `⚡ ${statusLabel}` });
  }
  await cursorAction(tabId, { type: 'glide', x: loc.x, y: loc.y });
  await cursorAction(tabId, { type: 'click', x: loc.x, y: loc.y });

  const clicked = await execMain(
    tabId,
    (x: number, y: number, sels: string[], texts: string[] | undefined): boolean => {
      const isVisible = (el: Element): boolean => {
        const r = (el as HTMLElement).getBoundingClientRect();
        const st = window.getComputedStyle(el);
        return st.display !== 'none' && st.visibility !== 'hidden' && r.width > 0 && r.height > 0;
      };

      let target: Element | null = null;
      for (const sel of sels) {
        try {
          const found = Array.from(document.querySelectorAll(sel)).find(isVisible);
          if (found) {
            target = found;
            break;
          }
        } catch {
          // ignore
        }
      }
      if (!target && texts && texts.length > 0) {
        const candidates = Array.from(
          document.querySelectorAll('button, a, dx-button, .dx-button, span, div, li, td')
        );
        for (const txt of texts) {
          const lower = txt.toLowerCase();
          target =
            candidates.find((el) => isVisible(el) && (el.textContent || '').trim().toLowerCase() === lower) ||
            candidates.find(
              (el) =>
                isVisible(el) &&
                el.children.length <= 3 &&
                (el.textContent || '').trim().toLowerCase().includes(lower)
            ) ||
            null;
          if (target) break;
        }
      }
      if (!target) {
        target = document.elementFromPoint(x, y);
      }
      if (!target) return false;

      const htmlTarget = target as HTMLElement;
      htmlTarget.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      htmlTarget.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      htmlTarget.click();
      return true;
    },
    loc.x,
    loc.y,
    selectors,
    textMatches
  );

  return Boolean(clicked);
}

async function visualFillInput(
  tabId: number,
  selectors: string[],
  value: string,
  isPassword: boolean,
  signal?: AbortSignal
): Promise<boolean> {
  checkAborted(signal);
  const loc = await locateVisibleElement(tabId, selectors);
  if (!loc) return false;

  await cursorAction(tabId, { type: 'highlight', rect: loc.rect });
  await cursorAction(tabId, { type: 'glide', x: loc.x, y: loc.y });
  await cursorAction(tabId, { type: 'click', x: loc.x, y: loc.y });
  await cursorAction(tabId, { type: 'type', text: value, isPassword });

  const filled = await execMain(
    tabId,
    (sels: string[], val: string): boolean => {
      const isVisible = (el: Element): boolean => {
        const r = (el as HTMLElement).getBoundingClientRect();
        const st = window.getComputedStyle(el);
        return st.display !== 'none' && st.visibility !== 'hidden' && r.width > 0 && r.height > 0;
      };
      let input: HTMLInputElement | null = null;
      for (const sel of sels) {
        const found = Array.from(document.querySelectorAll(sel)).find(isVisible) as HTMLInputElement | undefined;
        if (found) {
          input = found;
          break;
        }
      }
      if (!input) return false;

      input.focus();
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (nativeSetter) {
        nativeSetter.call(input, val);
      } else {
        input.value = val;
      }
      try {
        input.dispatchEvent(new InputEvent('input', { bubbles: true, data: val, inputType: 'insertText' }));
      } catch {
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('blur', { bubbles: false }));
      return true;
    },
    selectors,
    value
  );

  await sleep(180, signal);
  await cursorAction(tabId, { type: 'hideType' });
  await cursorAction(tabId, { type: 'clearHighlight' });
  return Boolean(filled);
}

async function isPOSAuthenticated(tabId: number): Promise<boolean> {
  const url = await getTabUrl(tabId);
  if (url.includes('/login') || url.includes('select-outlets')) {
    return false;
  }
  const hasAdminOrShop = url.includes('/admin') || url.includes('/shop');
  const domState = await execMain(tabId, (): { hasIndicator: boolean; hasLoginForm: boolean } => {
    const bodyText = document.body?.innerText || '';
    const hasIndicator =
      bodyText.includes('IN SHOP') ||
      bodyText.includes('Dashboard') ||
      bodyText.includes('MORE') ||
      !!document.querySelector('a[href*="logout"], a[href*="admin"], .dx-datagrid');
    const hasLoginForm = !!document.querySelector('#txtName');
    return { hasIndicator, hasLoginForm };
  });

  if (domState?.hasLoginForm) return false;
  return hasAdminOrShop || Boolean(domState?.hasIndicator);
}

export async function waitForLoadingWaveToEnd(
  tabId: number,
  timeoutMs = 30000,
  signal?: AbortSignal
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    checkAborted(signal);
    const loading = await execMain(tabId, (): boolean => {
      const isVisible = (el: Element): boolean => {
        const r = (el as HTMLElement).getBoundingClientRect();
        const st = window.getComputedStyle(el);
        return st.display !== 'none' && st.visibility !== 'hidden' && st.opacity !== '0' && r.width > 0 && r.height > 0;
      };
      const waveSelectors = [
        '.dx-loadpanel',
        '.dx-loadindicator',
        '.loading-wave',
        '[class*="wave"]',
        '.dx-export-loadpanel',
        '.dx-overlay-wrapper .dx-loadpanel-content',
      ];
      for (const sel of waveSelectors) {
        if (Array.from(document.querySelectorAll(sel)).some(isVisible)) {
          return true;
        }
      }
      const buttons = Array.from(document.querySelectorAll('button, dx-button, .dx-button'));
      return buttons.some((b) => isVisible(b) && (b.textContent || '').includes('Loading data'));
    });

    if (!loading) {
      await sleep(300, signal);
      const stillLoading = await execMain(tabId, (): boolean => {
        const isVisible = (el: Element): boolean => {
          const r = (el as HTMLElement).getBoundingClientRect();
          const st = window.getComputedStyle(el);
          return st.display !== 'none' && st.visibility !== 'hidden' && st.opacity !== '0' && r.width > 0 && r.height > 0;
        };
        if (Array.from(document.querySelectorAll('.dx-loadpanel, .dx-loadindicator, .loading-wave, .dx-export-loadpanel')).some(isVisible)) {
          return true;
        }
        return Array.from(document.querySelectorAll('button, dx-button')).some(
          (b) => isVisible(b) && (b.textContent || '').includes('Loading data')
        );
      });
      if (!stillLoading) return;
    }
    await sleep(500, signal);
  }
}

async function selectOutletAndWaitSettlement(
  tabId: number,
  preferredOutlet: string,
  onProgress: PosProgressCallback,
  signal?: AbortSignal
): Promise<boolean> {
  const outlet = preferredOutlet || 'FM04';
  const clicked = await execMain(tabId, (targetOutlet: string): ElementRect | null => {
    const isVisible = (el: Element): boolean => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const st = window.getComputedStyle(el);
      return st.display !== 'none' && st.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    };

    const cards = Array.from(document.querySelectorAll('.blog-sider-common'));
    let match = cards.find((c) => isVisible(c) && (c.textContent || '').includes(targetOutlet));
    if (!match) match = cards.find(isVisible);
    if (!match) {
      const allDivs = Array.from(document.querySelectorAll('div, a, button'));
      match =
        allDivs.find(
          (el) =>
            isVisible(el) &&
            el.children.length <= 4 &&
            ((el.textContent || '').includes(targetOutlet) ||
              (el.textContent || '').includes('DC01 - Nơ Trang Long') ||
              (el.textContent || '').includes('FM01'))
        ) || undefined;
    }
    if (!match) return null;
    (match as HTMLElement).scrollIntoView({ block: 'center' });
    const r = match.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }, outlet);

  if (!clicked) return false;

  const cx = Math.round(clicked.x + clicked.width / 2);
  const cy = Math.round(clicked.y + clicked.height / 2);
  await cursorAction(tabId, { type: 'highlight', rect: clicked });
  await cursorAction(tabId, { type: 'status', status: `⚡ Select Outlet ${outlet}` });
  await cursorAction(tabId, { type: 'glide', x: cx, y: cy });
  await cursorAction(tabId, { type: 'click', x: cx, y: cy });

  await execMain(tabId, (x: number, y: number) => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    el?.click();
  }, cx, cy);

  onProgress(`Đang chờ POS nạp cấu hình cửa hàng ${outlet} (9 bước)...`, 28);

  for (let tick = 0; tick < 35; tick++) {
    await sleep(1000, signal);
    if (await isPOSAuthenticated(tabId)) {
      await waitForLoadingWaveToEnd(tabId, 10000, signal);
      return true;
    }
    const url = await getTabUrl(tabId);
    if (!url.includes('select-outlets')) {
      break;
    }
  }

  return isPOSAuthenticated(tabId);
}

export async function ensureAuthenticated(
  tabId: number,
  cfg: PosEngineConfig,
  onProgress: PosProgressCallback,
  signal?: AbortSignal
): Promise<void> {
  const baseUrl = normalizePosBaseUrl(cfg.posUrl);
  const preferredOutlet = cfg.preferredOutlet || 'FM04';
  const maxRetries = 12;

  await injectCursorOverlay(tabId);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    checkAborted(signal);
    let currentUrl = await getTabUrl(tabId);

    // 0. Auto-recover from /home, 404, or app-page-not-found
    const pageNotFound = await execMain(tabId, (): boolean => {
      return (
        !!document.querySelector('app-page-not-found') ||
        (document.body?.innerText || '').includes('page-not-found works!')
      );
    });

    const isNotFound =
      currentUrl.includes('404') ||
      currentUrl.endsWith('/home') ||
      currentUrl.endsWith('/home/') ||
      currentUrl.includes('/home?') ||
      Boolean(pageNotFound);

    if (isNotFound) {
      onProgress('Phát hiện URL /home (page-not-found) — Đang khôi phục điều hướng...', 10);
      const hasToken = await execMain(tabId, (): boolean => {
        return !!(localStorage.getItem('token') && localStorage.getItem('user'));
      });

      if (hasToken) {
        onProgress('Phiên POS còn hiệu lực — Chuyển tiếp vào Dashboard...', 15);
        await navigateAndWait(tabId, `${baseUrl}admin/dashboard`, signal);
      } else {
        onProgress('Chuyển tiếp về màn hình đăng nhập POS /login...', 12);
        await navigateAndWait(tabId, baseUrl, signal);
        await sleep(1200, signal);
        const afterUrl = await getTabUrl(tabId);
        if (afterUrl.endsWith('/home') || afterUrl.endsWith('/home/')) {
          await navigateAndWait(tabId, `${baseUrl}login`, signal);
        }
      }
      currentUrl = await getTabUrl(tabId);
    }

    // 1. Initial navigation if not on POS site
    let sameOrigin = false;
    try {
      sameOrigin = Boolean(currentUrl && currentUrl !== 'about:blank' && new URL(currentUrl).origin === new URL(baseUrl).origin);
    } catch {
      sameOrigin = currentUrl.startsWith(baseUrl);
    }
    if (!sameOrigin) {
      onProgress(`Đang kết nối POS RPFO (${baseUrl}) - Lần ${attempt}/${maxRetries}...`, 8);
      await navigateAndWait(tabId, `${baseUrl}login`, signal);
      await sleep(1000, signal);
    }

    // 2. Already authenticated?
    if (await isPOSAuthenticated(tabId)) {
      onProgress('Phiên đăng nhập POS hợp lệ.', 35);
      return;
    }

    // 3. Outlet selection screen
    const hasOutlets = await execMain(tabId, (): boolean => {
      return (
        window.location.href.includes('select-outlets') ||
        !!document.querySelector('.blog-sider-common') ||
        (document.body?.innerText || '').includes('Last Login')
      );
    });

    if (hasOutlets) {
      onProgress(`Đang chọn cửa hàng ${preferredOutlet}...`, 25);
      const ok = await selectOutletAndWaitSettlement(tabId, preferredOutlet, onProgress, signal);
      if (ok) return;
    }

    // 4. Login form
    const loginFormVisible = await execMain(tabId, (): boolean => {
      return (
        window.location.href.includes('/login') ||
        !!document.querySelector('#txtName, input[name*="user" i], input[placeholder*="User" i]')
      );
    });

    if (loginFormVisible) {
      if (!cfg.username || !cfg.password) {
        throw new Error('POS login is required, but username/password are not configured.');
      }

      onProgress(`Đang điền thông tin đăng nhập POS (Lần ${attempt}/${maxRetries})...`, 16);
      await injectCursorOverlay(tabId);

      await visualFillInput(
        tabId,
        ['#txtName', 'input[name*="user" i]', 'input[placeholder*="User" i]', 'input[type="text"]'],
        cfg.username,
        false,
        signal
      );

      await visualFillInput(
        tabId,
        ['#txtPassword', 'input[type="password"]'],
        cfg.password,
        true,
        signal
      );

      onProgress('Đang nhấn LOGIN...', 20);
      await visualClickElement(
        tabId,
        ['input[type="submit"]', 'button[type="submit"]', 'button'],
        ['LOGIN', 'Login'],
        'LOGIN',
        signal
      );

      await sleep(2000, signal);

      // Wait out "Loading data. Please wait a minute" if present after clicking LOGIN
      let postLoginState = await readPosScreenState(tabId);
      if (postLoginState.isLoading || postLoginState.screen === 'LOADING_DATA') {
        onProgress('Đang chờ POS xử lý đăng nhập...', 23);
        await waitForLoadingWaveToEnd(tabId, 20000, signal);
        postLoginState = await readPosScreenState(tabId);
      }

      if (postLoginState.screen === 'SELECT_OUTLET') {
        onProgress(`Đang chọn Outlet ${preferredOutlet} và nạp cấu hình...`, 26);
        await selectOutletAndWaitSettlement(tabId, preferredOutlet, onProgress, signal);
      }

      const settledState = await readPosScreenState(tabId);
      if (
        settledState.screen === 'DASHBOARD' ||
        settledState.screen === 'INVENTORY_ONHAND' ||
        settledState.screen === 'SALES_DETAIL' ||
        (await isPOSAuthenticated(tabId))
      ) {
        onProgress('Đăng nhập POS RPFO thành công!', 35);
        return;
      }

      const errorMsg = await execMain(tabId, (): string => {
        const el = document.querySelector('.alert, .toast-error, .text-danger, .error-message, .swal2-html-container');
        return el ? (el.textContent || '').trim() : '';
      });

      if (errorMsg && /sai|không đúng|locked|khoá|invalid/i.test(errorMsg)) {
        throw new Error(`Đăng nhập POS thất bại: ${errorMsg}`);
      }
    }

    if (attempt < maxRetries) {
      onProgress(`Đang thử kết nối lại POS (Lần ${attempt + 1}/${maxRetries})...`, 12);
      await navigateAndWait(tabId, baseUrl, signal);
      await sleep(1500, signal);
    }
  }

  if (await isPOSAuthenticated(tabId)) return;
  throw new Error(`Không thể đăng nhập POS sau ${maxRetries} lần thử.`);
}

export async function navigateToReport(
  tabId: number,
  reportName: 'Inventory Onhand' | 'Sales Transaction Detail',
  fallbackPath: string,
  baseUrl: string,
  onProgress: PosProgressCallback,
  signal?: AbortSignal
): Promise<void> {
  const currentUrl = await getTabUrl(tabId);
  if (currentUrl.includes(fallbackPath)) return;

  onProgress(`Đang mở menu MORE -> Report -> ${reportName}...`, 40);

  try {
    const clickedMore = await visualClickElement(
      tabId,
      ['[aria-label="MORE"]', '[title="MORE"]', 'button', 'a'],
      ['MORE'],
      'MORE',
      signal
    );

    if (clickedMore) {
      await sleep(550, signal);
      const modalState = await readPosScreenState(tabId);
      if (modalState.screen !== 'MORE_MODAL') {
        await sleep(450, signal);
      }
      const clickedReport = await visualClickElement(
        tabId,
        ['[aria-label="Report"]', '[title="Report"]', 'div', 'a', 'button'],
        ['Report'],
        'Report',
        signal
      );

      if (clickedReport) {
        await sleep(550, signal);
        const itemLoc = await locateVisibleElement(tabId, [`[aria-label="${reportName}"]`, `[title="${reportName}"]`], [reportName]);
        if (!itemLoc) {
          await execMain(tabId, () => {
            const modals = document.querySelectorAll('.modal-body, .dx-popup-content, .dx-scrollable-container, [role="dialog"] div');
            modals.forEach((m) => {
              (m as HTMLElement).scrollTop += 300;
            });
          });
          await sleep(350, signal);
        }

        const clickedItem = await visualClickElement(
          tabId,
          [`[aria-label="${reportName}"]`, `[title="${reportName}"]`],
          [reportName],
          reportName,
          signal
        );

        if (clickedItem) {
          await sleep(1800, signal);
          const afterNav = await readPosScreenState(tabId);
          if (
            afterNav.url.includes(fallbackPath) ||
            (reportName === 'Inventory Onhand' && afterNav.screen === 'INVENTORY_ONHAND') ||
            (reportName === 'Sales Transaction Detail' && afterNav.screen === 'SALES_DETAIL')
          ) {
            return;
          }
        }
      }
    }
  } catch (err) {
    if ((err as Error).message.includes('cancelled')) throw err;
  }

  onProgress(`Điều hướng trực tiếp tới /${fallbackPath}...`, 45);
  await navigateAndWait(tabId, `${baseUrl}${fallbackPath}`, signal);
  await sleep(1800, signal);
}

export async function setDateFilter(tabId: number, field: 'from' | 'to', isoDate: string): Promise<void> {
  const parts = isoDate.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return;
  const [year, month, day] = parts;
  const pad = (n: number) => String(n).padStart(2, '0');
  const formatted = `${pad(day)}/${pad(month)}/${year}`;
  const targetIndex = field === 'from' ? 0 : 1;

  await execMain(
    tabId,
    (idx: number, y: number, m: number, d: number, formattedStr: string): boolean => {
      const boxes = document.querySelectorAll('dx-date-box, .dx-datebox');
      const box = boxes[idx] as any;
      if (!box) return false;

      const targetDate = new Date(y, m - 1, d, 12, 0, 0);
      const devExpress = (window as any).DevExpress;
      if (devExpress?.ui?.dxDateBox) {
        try {
          const inst = devExpress.ui.dxDateBox.getInstance(box);
          if (inst && typeof inst.option === 'function') {
            inst.option('value', targetDate);
          }
        } catch {
          // ignore
        }
      }
      box.__committed = true;

      const input = box.querySelector('input.dx-texteditor-input, input') as HTMLInputElement | null;
      if (input) {
        input.value = formattedStr;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
        input.dispatchEvent(new Event('blur', { bubbles: false }));
      }
      return true;
    },
    targetIndex,
    year,
    month,
    day,
    formatted
  );
}

export async function setStoreFilter(tabId: number, storeFilter: string, signal?: AbortSignal): Promise<void> {
  if (!storeFilter || storeFilter.toLowerCase() === 'all') return;
  const opened = await visualClickElement(tabId, ['dx-select-box', '.dx-selectbox'], undefined, 'Store Filter', signal);
  if (!opened) return;
  await sleep(500, signal);

  await execMain(tabId, (target: string) => {
    const items = Array.from(document.querySelectorAll('.dx-item, .dx-list-item'));
    const match = items.find((el) => (el.textContent || '').includes(target)) as HTMLElement | undefined;
    match?.click();
  }, storeFilter);
  await sleep(250, signal);
}

export async function isGridPopulated(tabId: number): Promise<boolean> {
  const populated = await execMain(tabId, (): boolean => {
    const isVisible = (el: Element): boolean => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const st = window.getComputedStyle(el);
      return st.display !== 'none' && st.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    };
    const noData = Array.from(document.querySelectorAll('.dx-datagrid-nodata, .no-data')).some(isVisible);
    if (noData) return false;
    const rows = document.querySelectorAll('.dx-datagrid-rowsview tr.dx-data-row, .dx-datagrid-rowsview .dx-data-row');
    return rows.length > 0;
  });
  return Boolean(populated);
}

export async function setGridFilter(
  tabId: number,
  columnField: string,
  value: string | string[],
  signal?: AbortSignal
): Promise<boolean> {
  const resolved = resolveColumnIdentifiers(columnField);
  const filterVals = parseFilterValues(value);

  // Mode A: DevExtreme dxDataGrid JS API in MAIN world
  const apiSuccess = await execMain(
    tabId,
    (dataField: string, titles: string[], vals: string[]): boolean => {
      const gridEl = document.querySelector('.dx-datagrid');
      if (!gridEl) return false;

      let grid: any = null;
      const devExpress = (window as any).DevExpress;
      if (devExpress?.ui?.dxDataGrid) {
        grid = devExpress.ui.dxDataGrid.getInstance(gridEl);
      }
      if (!grid) {
        const jq = (window as any).jQuery;
        if (jq) {
          try {
            grid = jq(gridEl).dxDataGrid('instance');
          } catch {
            // ignore
          }
        }
      }
      if (!grid || typeof grid.columnOption !== 'function') return false;

      let targetField = dataField;
      if (typeof grid.getColumns === 'function') {
        const cols = grid.getColumns();
        if (Array.isArray(cols) && cols.length > 0) {
          const match = cols.find(
            (c: any) =>
              c.dataField === dataField ||
              titles.some((t) => t.toLowerCase() === (c.caption || '').toLowerCase()) ||
              titles.some((t) => t.toLowerCase() === (c.dataField || '').toLowerCase()) ||
              (c.name && titles.some((t) => t.toLowerCase() === c.name.toLowerCase()))
          );
          if (!match) return false;
          targetField = match.dataField || match.name || match.caption || dataField;
        }
      }

      if (vals.length === 0) {
        grid.columnOption(targetField, 'filterValues', []);
      } else {
        grid.columnOption(targetField, 'filterType', 'include');
        grid.columnOption(targetField, 'filterValues', vals);
      }
      if (typeof grid.refresh === 'function') grid.refresh();
      return true;
    },
    resolved.dataField,
    resolved.titles,
    filterVals
  );

  if (apiSuccess) {
    await sleep(400, signal);
    await waitForLoadingWaveToEnd(tabId, 20000, signal);
    return true;
  }

  // Mode B: DOM Header Filter Popup with Virtual Scroll fallback
  const funnelLoc = await execMain(
    tabId,
    (dataField: string, titles: string[]): ElementRect | null => {
      const isVisible = (el: Element): boolean => {
        const r = (el as HTMLElement).getBoundingClientRect();
        const st = window.getComputedStyle(el);
        return st.display !== 'none' && st.visibility !== 'hidden' && r.width > 0 && r.height > 0;
      };
      const cells = Array.from(document.querySelectorAll('.dx-header-row td, .dx-datagrid-headers th, .dx-datagrid-headers td'));
      let headerCell: Element | undefined;
      for (const title of titles) {
        headerCell = cells.find((c) => isVisible(c) && (c.textContent || '').toLowerCase().includes(title.toLowerCase()));
        if (headerCell) break;
      }
      if (!headerCell) {
        headerCell = document.querySelector(`.dx-header-row td[data-field="${dataField}"]`) || undefined;
      }
      if (!headerCell) return null;
      const funnel = headerCell.querySelector('.dx-header-filter') as HTMLElement | null;
      if (!funnel || !isVisible(funnel)) return null;
      funnel.scrollIntoView({ block: 'center', inline: 'nearest' });
      const r = funnel.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    },
    resolved.dataField,
    resolved.titles
  );

  if (!funnelLoc) return false;

  const fx = Math.round(funnelLoc.x + funnelLoc.width / 2);
  const fy = Math.round(funnelLoc.y + funnelLoc.height / 2);
  await cursorAction(tabId, { type: 'highlight', rect: funnelLoc });
  await cursorAction(tabId, { type: 'glide', x: fx, y: fy });
  await cursorAction(tabId, { type: 'click', x: fx, y: fy });
  await execMain(tabId, (x: number, y: number) => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    el?.click();
  }, fx, fy);

  // Wait up to 5s for header filter popup to appear
  for (let w = 0; w < 16; w++) {
    await sleep(300, signal);
    const popupVisible = await execMain(tabId, (): boolean => {
      const popup = document.querySelector('.dx-header-filter-menu, .dx-overlay-content .dx-popup-content') as HTMLElement | null;
      if (!popup) return false;
      const r = popup.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (popupVisible) break;
  }

  // Uncheck Select All if checked
  await execMain(tabId, () => {
    const popup = document.querySelector('.dx-header-filter-menu, .dx-overlay-content .dx-popup-content');
    if (!popup) return;
    const items = Array.from(popup.querySelectorAll('.dx-list-item, .dx-item'));
    const selectAll = items.find((i) => /^\s*[\(\（]?(Select All|Chọn tất cả|Tất cả)[\)\）]?\s*$/i.test(i.textContent || ''));
    if (!selectAll) return;
    const cb = selectAll.querySelector('.dx-checkbox, input[type="checkbox"]') as HTMLElement | null;
    if (!cb) return;
    const isChecked = cb.getAttribute('aria-checked') === 'true' || !!cb.querySelector('.dx-checkbox-checked');
    if (isChecked) cb.click();
  });
  await sleep(200, signal);

  const tickVisible = async (remaining: string[]): Promise<string[]> => {
    const matched = await execMain(tabId, (targets: string[]): string[] => {
      const popup = document.querySelector('.dx-header-filter-menu, .dx-overlay-content .dx-popup-content');
      if (!popup) return [];
      const items = Array.from(popup.querySelectorAll('.dx-list-item, .dx-item'));
      const done: string[] = [];
      for (const val of targets) {
        const item = items.find((el) => (el.textContent || '').includes(val)) as HTMLElement | undefined;
        if (item) {
          const cb = item.querySelector('.dx-checkbox, input[type="checkbox"]') as HTMLElement | null;
          if (cb) {
            const isChecked = cb.getAttribute('aria-checked') === 'true' || !!cb.querySelector('.dx-checkbox-checked');
            if (!isChecked) cb.click();
          } else {
            item.click();
          }
          done.push(val);
        }
      }
      return done;
    }, remaining);
    const doneSet = new Set(matched || []);
    return remaining.filter((v) => !doneSet.has(v));
  };

  let remaining = await tickVisible(filterVals);

  // Virtual scroll loop (up to 12 steps)
  for (let step = 0; step < 12 && remaining.length > 0; step++) {
    const scrolled = await execMain(tabId, (): boolean => {
      const scroller = document.querySelector(
        '.dx-header-filter-menu .dx-scrollable-container, .dx-popup-content .dx-scrollable-container, .dx-header-filter-menu .dx-list'
      ) as HTMLElement | null;
      if (!scroller) return false;
      const prev = scroller.scrollTop;
      scroller.scrollTop += 180;
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
      return scroller.scrollTop > prev;
    });
    await sleep(160, signal);
    remaining = await tickVisible(remaining);
    if (!scrolled) break;
  }

  // Search box fallback for any remaining values
  if (remaining.length > 0) {
    for (const val of remaining) {
      await execMain(tabId, (searchVal: string) => {
        const popup = document.querySelector('.dx-header-filter-menu, .dx-overlay-content .dx-popup-content');
        const input = popup?.querySelector('input.dx-texteditor-input, input[placeholder*="Search"], input[type="text"]') as HTMLInputElement | null;
        if (input) {
          input.value = searchVal;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, val);
      await sleep(260, signal);
      await tickVisible([val]);
    }
    await execMain(tabId, () => {
      const popup = document.querySelector('.dx-header-filter-menu, .dx-overlay-content .dx-popup-content');
      const input = popup?.querySelector('input.dx-texteditor-input, input[placeholder*="Search"], input[type="text"]') as HTMLInputElement | null;
      if (input) {
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await sleep(160, signal);
  }

  // Click OK
  await visualClickElement(tabId, ['.dx-popup-bottom .dx-button', '.dx-button'], ['OK'], 'Filter OK', signal);
  await sleep(400, signal);
  await waitForLoadingWaveToEnd(tabId, 25000, signal);
  return true;
}

async function injectBlobInterceptor(tabId: number): Promise<void> {
  await execMain(tabId, () => {
    const w = window as any;
    w.__capturedBlobs = [];
    if (!w.__blobHookInstalled) {
      w.__blobHookInstalled = true;
      const origCreate = URL.createObjectURL;
      URL.createObjectURL = function (obj: Blob | MediaSource) {
        if (obj instanceof Blob) {
          const reader = new FileReader();
          reader.onload = () => {
            w.__capturedBlobs.push({
              type: obj.type,
              size: obj.size,
              dataUrl: reader.result,
            });
          };
          reader.readAsDataURL(obj);
        }
        return origCreate.call(URL, obj);
      };

      const origRevoke = URL.revokeObjectURL;
      URL.revokeObjectURL = function (url: string) {
        setTimeout(() => origRevoke.call(URL, url), 60000);
      };
    }
  });
}

async function waitForDownloadComplete(downloadId: number, timeoutMs = 20000, signal?: AbortSignal): Promise<ChromeDownloadItem | null> {
  const downloads = getDownloads();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    checkAborted(signal);
    const items = await downloads.search({ id: downloadId }).catch(() => []);
    const item = items[0];
    if (item && item.state === 'complete') {
      return item;
    }
    if (item && item.state === 'interrupted') {
      return null;
    }
    await sleep(300, signal);
  }
  return null;
}

export const POS_LOADING_WAIT_TIMEOUT_MS = 720000;

export const POS_SALES_EXPORT_SELECTORS = [
  '.dx-datagrid-header-panel .dx-datagrid-export-button',
  '.dx-datagrid-header-panel .dx-button:has(.dx-icon-xlsxfile)',
  '.dx-datagrid-header-panel [aria-label*="Export to Excel" i]',
  '.dx-datagrid-export-button',
  '.btn-excel',
];

export const POS_INVENTORY_EXPORT_SELECTORS = [
  '.dx-datagrid-header-panel .dx-datagrid-export-button',
  '.dx-datagrid-header-panel .dx-button:has(.dx-icon-xlsxfile)',
  '.dx-datagrid-header-panel [aria-label*="Export to Excel" i]',
  '.dx-datagrid-export-button',
  '.dx-button:has(.dx-icon-xlsxfile)',
];

export async function triggerPosSearch(
  tabId: number,
  label = 'Search',
  signal?: AbortSignal
): Promise<boolean> {
  return visualClickElement(
    tabId,
    ['dx-button[icon="search"]', '.btn-search', 'button[type="submit"]', 'button', 'a'],
    ['Search'],
    label,
    signal
  );
}

export async function cleanupPosOverlay(tabId: number): Promise<void> {
  await removeCursorOverlay(tabId);
}

export async function triggerExportAndCapture(
  tabId: number,
  buttonSelectors: string[],
  fallbackTextMatches: string[] | undefined,
  fallbackFilename: string,
  signal?: AbortSignal
): Promise<{ downloadId: number; filename: string } | null> {
  await injectBlobInterceptor(tabId);

  const downloads = getDownloads();
  const state: { createdItem: ChromeDownloadItem | null } = { createdItem: null };
  const onCreated = (item: ChromeDownloadItem) => {
    if (!state.createdItem) state.createdItem = item;
  };
  downloads.onCreated.addListener(onCreated);

  try {
    const clicked = await visualClickElement(tabId, buttonSelectors, fallbackTextMatches, 'Export Excel', signal);
    if (!clicked) return null;

    await sleep(450, signal);
    // Check if DevExtreme export dropdown menu appeared (strictly scoped to overlay menu items)
    await visualClickElement(
      tabId,
      ['.dx-export-menu-item', '.dx-overlay-content .dx-menu-item'],
      undefined,
      'Export all data',
      signal
    );

    let firstBlobSeenAt = 0;
    const deadline = Date.now() + 28000;
    while (Date.now() < deadline) {
      checkAborted(signal);

      if (state.createdItem) {
        const completed = await waitForDownloadComplete(state.createdItem.id, 15000, signal);
        const finalName = completed?.filename || state.createdItem.filename || fallbackFilename;
        return { downloadId: state.createdItem.id, filename: finalName };
      }

      const blobs = await execMain(tabId, (): Array<{ dataUrl?: string; size?: number }> => {
        return (window as any).__capturedBlobs || [];
      });

      if (Array.isArray(blobs) && blobs.length > 0 && blobs[0].dataUrl && (blobs[0].size || 0) > 50) {
        if (!firstBlobSeenAt) {
          firstBlobSeenAt = Date.now();
        }
        // Give native chrome.downloads.onCreated 1.2s to fire first so we don't double-download
        if (Date.now() - firstBlobSeenAt >= 1200) {
          const dlId = await downloads.download({
            url: blobs[0].dataUrl,
            filename: fallbackFilename,
            saveAs: false,
            conflictAction: 'uniquify',
          });
          const completed = await waitForDownloadComplete(dlId, 15000, signal);
          return { downloadId: dlId, filename: completed?.filename || fallbackFilename };
        }
      }

      await sleep(400, signal);
    }

    return null;
  } finally {
    downloads.onCreated.removeListener(onCreated);
  }
}

/**
 * Check POS login status and authenticate if required.
 */
export async function runPosCheckLogin(
  tabId: number,
  cfg: PosEngineConfig,
  onProgress: PosProgressCallback,
  signal?: AbortSignal
): Promise<PosLoginResult> {
  try {
    onProgress('Đang kiểm tra phiên đăng nhập POS RPFO...', 5);
    await ensureAuthenticated(tabId, cfg, onProgress, signal);
    const url = await getTabUrl(tabId);
    onProgress('POS RPFO đã sẵn sàng.', 100);
    return {
      ok: true,
      url,
      message: `Đã đăng nhập POS thành công (${cfg.preferredOutlet || 'FM04'}).`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    onProgress(`Lỗi POS: ${message}`, 100);
    return {
      ok: false,
      url: await getTabUrl(tabId).catch(() => ''),
      message,
    };
  } finally {
    await removeCursorOverlay(tabId);
  }
}

/**
 * Download POS Sales Transaction Detail Excel report.
 */
export async function runPosSalesDownload(
  tabId: number,
  cfg: PosEngineConfig,
  onProgress: PosProgressCallback,
  signal?: AbortSignal
): Promise<PosDownloadResult> {
  try {
    const baseUrl = normalizePosBaseUrl(cfg.posUrl);
    onProgress('Đang xác thực POS RPFO...', 5);
    await ensureAuthenticated(tabId, cfg, onProgress, signal);

    await navigateToReport(tabId, 'Sales Transaction Detail', 'admin/report/sales-transaction-detail', baseUrl, onProgress, signal);

    const urlNow = await getTabUrl(tabId);
    if (urlNow.includes('/login') || urlNow.includes('404') || urlNow.includes('/home')) {
      await ensureAuthenticated(tabId, cfg, onProgress, signal);
      await navigateToReport(tabId, 'Sales Transaction Detail', 'admin/report/sales-transaction-detail', baseUrl, onProgress, signal);
    }

    const fallbackWeek = !cfg.fromDate || !cfg.toDate ? getPreviousWeekRange(cfg.weekConvention ?? 'mon-sun') : null;
    const effectiveFromDate = cfg.fromDate || fallbackWeek?.fromDate;
    const effectiveToDate = cfg.toDate || fallbackWeek?.toDate;

    onProgress('Đang thiết lập bộ lọc ngày và cửa hàng...', 52);
    if (effectiveFromDate) await setDateFilter(tabId, 'from', effectiveFromDate);
    if (effectiveToDate) await setDateFilter(tabId, 'to', effectiveToDate);

    const parsedStores = parseFilterValues(cfg.storeFilter);
    if (parsedStores.length === 1) {
      await setStoreFilter(tabId, parsedStores[0], signal);
    }

    onProgress('Đang tải dữ liệu Sales Transaction Detail...', 60);
    for (let sAttempt = 1; sAttempt <= 3; sAttempt++) {
      await triggerPosSearch(tabId, `Search (${sAttempt}/3)`, signal);
      await waitForLoadingWaveToEnd(tabId, POS_LOADING_WAIT_TIMEOUT_MS, signal);
      await sleep(1200, signal);
      const stateAfterSearch = await readPosScreenState(tabId);
      if (!stateAfterSearch.isLoading && stateAfterSearch.gridRowCount > 0) break;
    }

    if (parsedStores.length > 1) {
      onProgress('Đang áp dụng bộ lọc nhiều cửa hàng trên lưới...', 76);
      const applied = await setGridFilter(tabId, 'storeId', parsedStores, signal);
      if (!applied) {
        await setGridFilter(tabId, 'slocId', parsedStores, signal);
      }
    }

    const storeLabel = parsedStores.length === 0 ? 'ALL' : parsedStores.length === 1 ? parsedStores[0] : `${parsedStores.length}STORES`;
    const filename = resolveFilename(cfg.fileNameTemplate || 'Sales_{{fromDate}}_{{toDate}}.xlsx', {
      fromDate: effectiveFromDate || 'ALL',
      toDate: effectiveToDate || 'ALL',
      storeId: storeLabel,
    });

    onProgress('Đang xuất file Excel Sales Transaction Detail...', 85);
    const capture = await triggerExportAndCapture(
      tabId,
      POS_SALES_EXPORT_SELECTORS,
      ['Excel'],
      filename,
      signal
    );

    if (!capture) {
      throw new Error('Không thể thu được file Excel Sales Transaction Detail từ trình duyệt.');
    }

    onProgress('Hoàn tất tải Sales Transaction Detail!', 100);
    return {
      ok: true,
      filename: capture.filename,
      downloadId: capture.downloadId,
      message: `Đã tải xuống ${capture.filename}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    onProgress(`Lỗi tải Sales: ${message}`, 100);
    return { ok: false, message };
  } finally {
    await removeCursorOverlay(tabId);
  }
}

/**
 * Download POS Inventory Onhand Excel report (supports 12 Sloc filter + Item filter).
 */
export async function runPosInventoryDownload(
  tabId: number,
  cfg: PosEngineConfig,
  onProgress: PosProgressCallback,
  signal?: AbortSignal
): Promise<PosDownloadResult> {
  try {
    const baseUrl = normalizePosBaseUrl(cfg.posUrl);
    onProgress('Đang xác thực POS RPFO...', 5);
    await ensureAuthenticated(tabId, cfg, onProgress, signal);

    await navigateToReport(tabId, 'Inventory Onhand', 'admin/report/inventory-onhand', baseUrl, onProgress, signal);

    const urlNow = await getTabUrl(tabId);
    if (urlNow.includes('/login') || urlNow.includes('404') || urlNow.includes('/home')) {
      await ensureAuthenticated(tabId, cfg, onProgress, signal);
      await navigateToReport(tabId, 'Inventory Onhand', 'admin/report/inventory-onhand', baseUrl, onProgress, signal);
    }

    const parsedStores = parseFilterValues(cfg.storeFilter);
    if (parsedStores.length === 1) {
      await setStoreFilter(tabId, parsedStores[0], signal);
    }

    onProgress('Đang chờ Inventory Onhand tải dữ liệu...', 52);
    await waitForLoadingWaveToEnd(tabId, POS_LOADING_WAIT_TIMEOUT_MS, signal);
    await sleep(2000, signal);

    let populated = await isGridPopulated(tabId);
    if (!populated) {
      for (let sAttempt = 1; sAttempt <= 6; sAttempt++) {
        onProgress(`Đang truy vấn Inventory Onhand (Lần ${sAttempt}/6)...`, 54 + sAttempt * 3);
        await triggerPosSearch(tabId, `Search (${sAttempt}/6)`, signal);
        await waitForLoadingWaveToEnd(tabId, POS_LOADING_WAIT_TIMEOUT_MS, signal);
        await sleep(2500, signal);
        populated = await isGridPopulated(tabId);
        if (populated) break;
      }
    }

    const parsedSlocs = parseFilterValues(cfg.slocFilter);
    if (parsedSlocs.length > 0) {
      onProgress(`Đang lọc ${parsedSlocs.length} kho (Sloc Id)...`, 76);
      await setGridFilter(tabId, 'slocId', parsedSlocs, signal);
    }

    const parsedItems = parseFilterValues(cfg.itemFilter);
    if (parsedItems.length > 0) {
      onProgress(`Đang lọc mã hàng (${parsedItems.length} mã)...`, 82);
      await setGridFilter(tabId, 'itemCode', parsedItems, signal);
    }

    const slocLabel = parsedSlocs.length === 0 ? 'ALL_SLOC' : parsedSlocs.length === 1 ? parsedSlocs[0] : `${parsedSlocs.length}SLOCS`;
    const filename = resolveFilename(cfg.fileNameTemplate || 'Inventory_{{slocId}}_{{timestamp}}.xlsx', {
      slocId: slocLabel,
      itemCode: cfg.itemFilter || 'ALL',
    });

    onProgress('Đang xuất file Excel Inventory Onhand...', 88);
    const capture = await triggerExportAndCapture(
      tabId,
      POS_INVENTORY_EXPORT_SELECTORS,
      undefined,
      filename,
      signal
    );

    if (!capture) {
      throw new Error('Không thể thu được file Excel Inventory Onhand từ trình duyệt.');
    }

    onProgress('Hoàn tất tải Inventory Onhand!', 100);
    return {
      ok: true,
      filename: capture.filename,
      downloadId: capture.downloadId,
      message: `Đã tải xuống ${capture.filename}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    onProgress(`Lỗi tải Inventory: ${message}`, 100);
    return { ok: false, message };
  } finally {
    await removeCursorOverlay(tabId);
  }
}
