// ============================================================
// OmniFlow Studio — Chrome DevTools Protocol (CDP) Executor
// ============================================================
// Provides trusted hardware-level mouse, keyboard, and wheel
// events via chrome.debugger.sendCommand for SAP B1 Browser Access
// (SAP UI5) where synthetic DOM events are ignored.

export interface CdpMouseOptions {
  button?: 'left' | 'right' | 'middle';
  clickCount?: number;
  delayMs?: number;
}

export interface CdpTypeOptions {
  delayMs?: number;
  clearFirst?: boolean;
}

export interface CdpKeyOptions {
  code?: string;
  keyCode?: number;
  modifiers?: number;
}

interface Debuggee {
  tabId?: number;
  extensionId?: string;
  targetId?: string;
}

interface ChromeDebuggerApi {
  attach(target: Debuggee, requiredVersion: string): Promise<void>;
  detach(target: Debuggee): Promise<void>;
  sendCommand<T = unknown>(
    target: Debuggee,
    method: string,
    commandParams?: Record<string, unknown>
  ): Promise<T>;
  onDetach?: {
    addListener(cb: (source: Debuggee, reason: string) => void): void;
    removeListener(cb: (source: Debuggee, reason: string) => void): void;
  };
}

const CDP_PROTOCOL_VERSION = '1.3';
const attachedTabs = new Set<number>();
let detachListenerRegistered = false;

function getDebuggerApi(): ChromeDebuggerApi | undefined {
  const api = (globalThis as unknown as { chrome?: { debugger?: ChromeDebuggerApi } }).chrome;
  return api?.debugger;
}

function ensureDetachListener(dbg: ChromeDebuggerApi): void {
  if (detachListenerRegistered || !dbg.onDetach) return;
  detachListenerRegistered = true;
  dbg.onDetach.addListener((source) => {
    if (typeof source.tabId === 'number') {
      attachedTabs.delete(source.tabId);
    }
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mouseButtonMask(button: 'left' | 'right' | 'middle'): number {
  if (button === 'right') return 2;
  if (button === 'middle') return 4;
  return 1;
}

/**
 * Returns whether this executor currently tracks `tabId` as CDP-attached.
 */
export function isCdpAttached(tabId: number): boolean {
  return attachedTabs.has(tabId);
}

/**
 * Safely attaches `chrome.debugger` (CDP 1.3) to `tabId`.
 * Returns `true` if attached (or already attached), `false` if unavailable or blocked.
 */
export async function cdpAttach(tabId: number): Promise<boolean> {
  const dbg = getDebuggerApi();
  if (!dbg) return false;
  ensureDetachListener(dbg);

  if (attachedTabs.has(tabId)) {
    return true;
  }

  try {
    await dbg.attach({ tabId }, CDP_PROTOCOL_VERSION);
    attachedTabs.add(tabId);
    return true;
  } catch (err) {
    const msg = (err as Error)?.message || String(err);
    // If Chrome reports another debugger is already attached, check if we can still command it;
    // otherwise DevTools is open and we must not crash.
    if (/already attached/i.test(msg)) {
      return false;
    }
    return false;
  }
}

/**
 * Safely detaches `chrome.debugger` from `tabId`, ignoring not-attached errors.
 */
export async function cdpDetach(tabId: number): Promise<void> {
  const dbg = getDebuggerApi();
  attachedTabs.delete(tabId);
  if (!dbg) return;

  try {
    await dbg.detach({ tabId });
  } catch {
    // Ignore if already detached or tab closed
  }
}

/**
 * Sends a raw CDP command to `tabId`, auto-attaching if needed and retrying once
 * if the debugger detached mid-flight.
 */
export async function cdpSendCommand<T = unknown>(
  tabId: number,
  method: string,
  params?: Record<string, unknown>
): Promise<T> {
  const dbg = getDebuggerApi();
  if (!dbg) {
    throw new Error('chrome.debugger API không khả dụng (cần quyền "debugger" trong manifest.json).');
  }

  if (!attachedTabs.has(tabId)) {
    const ok = await cdpAttach(tabId);
    if (!ok) {
      throw new Error(`Không thể gắn CDP debugger vào tab ${tabId}.`);
    }
  }

  try {
    return await dbg.sendCommand<T>({ tabId }, method, params);
  } catch (err) {
    const msg = (err as Error)?.message || String(err);
    if (/not attached|detached/i.test(msg)) {
      attachedTabs.delete(tabId);
      const reattached = await cdpAttach(tabId);
      if (reattached) {
        return await dbg.sendCommand<T>({ tabId }, method, params);
      }
    }
    throw err;
  }
}

/**
 * Dispatches a trusted mouse click at top-level viewport coordinates `(x, y)`.
 */
export async function cdpClick(
  tabId: number,
  x: number,
  y: number,
  options: CdpMouseOptions = {}
): Promise<void> {
  const button = options.button ?? 'left';
  const clickCount = options.clickCount ?? 1;
  const delayMs = options.delayMs ?? 35;
  const buttons = mouseButtonMask(button);

  await cdpSendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x,
    y,
    button: 'none',
    buttons: 0,
  });

  await cdpSendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button,
    buttons,
    clickCount,
  });

  if (delayMs > 0) await sleep(delayMs);

  await cdpSendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button,
    buttons: 0,
    clickCount,
  });
}

/**
 * Dispatches a trusted double-click sequence (`clickCount: 1` then `clickCount: 2`)
 * at top-level viewport coordinates `(x, y)`.
 */
export async function cdpDoubleClick(
  tabId: number,
  x: number,
  y: number,
  options: Omit<CdpMouseOptions, 'clickCount'> = {}
): Promise<void> {
  const button = options.button ?? 'left';
  const delayMs = options.delayMs ?? 40;
  const buttons = mouseButtonMask(button);

  await cdpSendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x,
    y,
    button: 'none',
    buttons: 0,
  });

  // First click
  await cdpSendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button,
    buttons,
    clickCount: 1,
  });
  await cdpSendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button,
    buttons: 0,
    clickCount: 1,
  });

  if (delayMs > 0) await sleep(delayMs);

  // Second click
  await cdpSendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button,
    buttons,
    clickCount: 2,
  });
  await cdpSendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button,
    buttons: 0,
    clickCount: 2,
  });
}

/**
 * Dispatches a trusted keyboard key press (`keyDown` + `keyUp`).
 */
export async function cdpPressKey(
  tabId: number,
  key: string,
  options: CdpKeyOptions = {}
): Promise<void> {
  const keyMap: Record<string, { code: string; keyCode: number }> = {
    Enter: { code: 'Enter', keyCode: 13 },
    Tab: { code: 'Tab', keyCode: 9 },
    Escape: { code: 'Escape', keyCode: 27 },
    Backspace: { code: 'Backspace', keyCode: 8 },
    ArrowDown: { code: 'ArrowDown', keyCode: 40 },
    ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  };
  const mapped = keyMap[key];
  const code = options.code ?? mapped?.code ?? key;
  const windowsVirtualKeyCode = options.keyCode ?? mapped?.keyCode ?? 0;
  const modifiers = options.modifiers ?? 0;

  await cdpSendCommand(tabId, 'Input.dispatchKeyEvent', {
    type: 'keyDown',
    key,
    code,
    windowsVirtualKeyCode,
    nativeVirtualKeyCode: windowsVirtualKeyCode,
    modifiers,
  });

  await cdpSendCommand(tabId, 'Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code,
    windowsVirtualKeyCode,
    nativeVirtualKeyCode: windowsVirtualKeyCode,
    modifiers,
  });
}

/**
 * Types `text` into the currently focused element using `Input.insertText`.
 * Optionally selects all and clears existing content first.
 */
export async function cdpType(
  tabId: number,
  text: string,
  options: CdpTypeOptions = {}
): Promise<void> {
  if (options.clearFirst) {
    // Ctrl+A (modifiers: 2 = Ctrl) then Backspace
    await cdpPressKey(tabId, 'a', { code: 'KeyA', keyCode: 65, modifiers: 2 });
    await cdpPressKey(tabId, 'Backspace');
    await sleep(30);
  }

  if (options.delayMs && options.delayMs > 0) {
    for (const ch of text) {
      await cdpSendCommand(tabId, 'Input.insertText', { text: ch });
      await sleep(options.delayMs);
    }
  } else {
    await cdpSendCommand(tabId, 'Input.insertText', { text });
  }
}

/**
 * Dispatches a trusted mouse wheel scroll event at `(x, y)`.
 */
export async function cdpWheel(
  tabId: number,
  x: number,
  y: number,
  deltaX = 0,
  deltaY = 300
): Promise<void> {
  await cdpSendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x,
    y,
    deltaX,
    deltaY,
  });
}

/**
 * Runs `fn` within a CDP-attached session, detaching in `finally` unless
 * `keepAttached` is true or the tab was already attached before entry.
 */
export async function withCdpSession<T>(
  tabId: number,
  fn: () => Promise<T>,
  options: { keepAttached?: boolean } = {}
): Promise<T> {
  const wasAttached = isCdpAttached(tabId);
  if (!wasAttached) {
    await cdpAttach(tabId);
  }
  try {
    return await fn();
  } finally {
    if (!wasAttached && !options.keepAttached) {
      await cdpDetach(tabId);
    }
  }
}
