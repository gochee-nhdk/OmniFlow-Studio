import { requestVlmNextAction, VlmNextAction } from './vlm-client.js';
import { cdpClick, cdpPressKey } from './cdp-executor.js';

export interface AgentElement {
  index: number;
  role: string;
  label: string;
  kind: string;
  rect: { x: number; y: number; width: number; height: number };
  disabled: boolean;
  frameId?: number;
  frameLocalIndex?: number;
}

export interface AgentPageSnapshot {
  url: string;
  title: string;
  viewport: { width: number; height: number };
  heading: string;
  elements: AgentElement[];
}

export interface InspectPageOptions {
  drawOverlay?: boolean;
  startIndex?: number;
}

export interface VlmFallbackParams {
  tabId: number;
  goal: string;
  currentState?: string;
  lastError?: string;
  consecutiveFailures?: number;
  apiKey?: string;
  preferCdp?: boolean;
}

export interface VlmFallbackResult {
  executed: boolean;
  action: VlmNextAction;
  snapshot: AgentPageSnapshot;
  outcome?: { ok: boolean; message: string };
}

/**
 * Runs in the inspected frame. Returns a compact, secret-safe DOM view
 * including interactive div/span/role elements and optional Set-of-Mark overlays.
 * Must remain 100% self-contained for chrome.scripting.executeScript({ func }).
 */
export function inspectPage(options?: InspectPageOptions): AgentPageSnapshot {
  const baseSelector =
    'button,a,input,textarea,select,[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="tab"],[role="menuitem"],[role="option"],[role="switch"],[role="combobox"],[role="textbox"],[role="treeitem"],[contenteditable="true"],[onclick],[tabindex]:not([tabindex="-1"]),div,span';
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(baseSelector));
  const elements: AgentElement[] = [];
  const startIndex = options?.startIndex ?? 1;

  const existingRoot = document.getElementById('omniflow-som-overlay-root');
  if (existingRoot) existingRoot.remove();

  const overlayRoot = options?.drawOverlay ? document.createElement('div') : null;
  if (overlayRoot) {
    overlayRoot.id = 'omniflow-som-overlay-root';
    overlayRoot.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:2147483647;overflow:hidden;';
  }

  for (const el of candidates) {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (rect.width < 2 || rect.height < 2 || style.visibility === 'hidden' || style.display === 'none') continue;
    if (rect.bottom < 0 || rect.right < 0 || rect.top > innerHeight || rect.left > innerWidth) continue;

    const tag = el.tagName.toLowerCase();
    const roleAttr = el.getAttribute('role') || '';
    const isNativeOrRole =
      tag === 'button' ||
      tag === 'a' ||
      tag === 'input' ||
      tag === 'textarea' ||
      tag === 'select' ||
      Boolean(roleAttr) ||
      el.isContentEditable ||
      el.hasAttribute('onclick') ||
      (el.hasAttribute('tabindex') && el.getAttribute('tabindex') !== '-1');

    if (!isNativeOrRole && (tag === 'div' || tag === 'span')) {
      const hasInteractiveClass =
        /\b(sapMBtn|sapUiBtn|sapMLIB|sapMTreeItemBase|dx-button|dx-menu-item|dx-treeview-item|dx-datagrid-filter-panel|btn|clickable)\b/i.test(
          el.className || ''
        );
      const isPointer = style.cursor === 'pointer';
      if (!isPointer && !hasInteractiveClass) continue;
      if (rect.width > 650 || rect.height > 220) continue;
      if (el.querySelector('button,a,input,select,textarea,[role="button"]')) continue;
    }

    const input = el instanceof HTMLInputElement ? el : null;
    const labelText = input?.labels ? Array.from(input.labels).map((label) => label.innerText).join(' ') : '';
    const label = (
      el.getAttribute('aria-label') ||
      el.getAttribute('placeholder') ||
      labelText ||
      el.innerText ||
      el.getAttribute('title') ||
      ''
    )
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 140);
    const kind = input?.type || tag;
    if (!label && !['checkbox', 'radio', 'submit', 'button'].includes(kind)) continue;

    const somIndex = startIndex + elements.length;
    elements.push({
      index: somIndex,
      role: roleAttr || tag,
      label: label || kind,
      kind,
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      disabled:
        ('disabled' in el && Boolean((el as HTMLButtonElement).disabled)) ||
        el.getAttribute('aria-disabled') === 'true',
    });

    if (overlayRoot) {
      const box = document.createElement('div');
      box.style.cssText = `position:fixed;left:${Math.round(rect.left)}px;top:${Math.round(rect.top)}px;width:${Math.round(rect.width)}px;height:${Math.round(rect.height)}px;border:1.5px solid #ef4444;box-sizing:border-box;pointer-events:none;`;
      const badge = document.createElement('span');
      badge.textContent = `[${somIndex}]`;
      badge.style.cssText =
        'position:absolute;top:-10px;left:-2px;background:#ef4444;color:#fff;font:bold 10px/1.2 monospace;padding:1px 3px;border-radius:3px;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,0.4);';
      box.appendChild(badge);
      overlayRoot.appendChild(box);
    }

    if (elements.length >= 100) break;
  }

  if (overlayRoot && document.body) {
    document.body.appendChild(overlayRoot);
  }

  return {
    url: location.href,
    title: document.title.slice(0, 160),
    viewport: { width: innerWidth, height: innerHeight },
    heading: (document.querySelector('h1')?.textContent || '').trim().slice(0, 200),
    elements,
  };
}

/**
 * Draws Set-of-Mark ([1], [2], ...) numbered overlays for a list of elements in the current frame.
 * Self-contained for chrome.scripting.executeScript({ func }).
 */
export function drawSomOverlays(
  items: Array<{ somIndex: number; rect: { x: number; y: number; width: number; height: number } }>
): void {
  const existing = document.getElementById('omniflow-som-overlay-root');
  if (existing) existing.remove();
  if (!document.body || !items.length) return;

  const root = document.createElement('div');
  root.id = 'omniflow-som-overlay-root';
  root.style.cssText =
    'position:fixed;inset:0;pointer-events:none;z-index:2147483647;overflow:hidden;';

  for (const item of items) {
    const box = document.createElement('div');
    box.style.cssText = `position:fixed;left:${item.rect.x}px;top:${item.rect.y}px;width:${item.rect.width}px;height:${item.rect.height}px;border:1.5px solid #ef4444;box-sizing:border-box;pointer-events:none;`;
    const badge = document.createElement('span');
    badge.textContent = `[${item.somIndex}]`;
    badge.style.cssText =
      'position:absolute;top:-10px;left:-2px;background:#ef4444;color:#fff;font:bold 10px/1.2 monospace;padding:1px 3px;border-radius:3px;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,0.4);';
    box.appendChild(badge);
    root.appendChild(box);
  }

  document.body.appendChild(root);
}

/** Removes any Set-of-Mark overlays from the current frame. */
export function clearSomOverlays(): void {
  const existing = document.getElementById('omniflow-som-overlay-root');
  if (existing) existing.remove();
}

/**
 * Re-identifies the selected visible control before acting, avoiding stale coordinates.
 * Must remain 100% self-contained for chrome.scripting.executeScript({ func }).
 */
export function actOnPage(
  index: number,
  operation: 'click' | 'fill',
  value: string | undefined,
  expectedLabel: string
): { ok: boolean; message: string } {
  const baseSelector =
    'button,a,input,textarea,select,[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="tab"],[role="menuitem"],[role="option"],[role="switch"],[role="combobox"],[role="textbox"],[role="treeitem"],[contenteditable="true"],[onclick],[tabindex]:not([tabindex="-1"]),div,span';
  const visible: HTMLElement[] = [];

  for (const el of Array.from(document.querySelectorAll<HTMLElement>(baseSelector))) {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (rect.width < 2 || rect.height < 2 || style.visibility === 'hidden' || style.display === 'none') continue;
    if (rect.bottom < 0 || rect.right < 0 || rect.top > innerHeight || rect.left > innerWidth) continue;

    const tag = el.tagName.toLowerCase();
    const roleAttr = el.getAttribute('role') || '';
    const isNativeOrRole =
      tag === 'button' ||
      tag === 'a' ||
      tag === 'input' ||
      tag === 'textarea' ||
      tag === 'select' ||
      Boolean(roleAttr) ||
      el.isContentEditable ||
      el.hasAttribute('onclick') ||
      (el.hasAttribute('tabindex') && el.getAttribute('tabindex') !== '-1');

    if (!isNativeOrRole && (tag === 'div' || tag === 'span')) {
      const hasInteractiveClass =
        /\b(sapMBtn|sapUiBtn|sapMLIB|sapMTreeItemBase|dx-button|dx-menu-item|dx-treeview-item|dx-datagrid-filter-panel|btn|clickable)\b/i.test(
          el.className || ''
        );
      const isPointer = style.cursor === 'pointer';
      if (!isPointer && !hasInteractiveClass) continue;
      if (rect.width > 650 || rect.height > 220) continue;
      if (el.querySelector('button,a,input,select,textarea,[role="button"]')) continue;
    }

    const input = el instanceof HTMLInputElement ? el : null;
    const labelText = input?.labels ? Array.from(input.labels).map((label) => label.innerText).join(' ') : '';
    const label = (
      el.getAttribute('aria-label') ||
      el.getAttribute('placeholder') ||
      labelText ||
      el.innerText ||
      el.getAttribute('title') ||
      ''
    )
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 140);
    const kind = input?.type || tag;
    if (!label && !['checkbox', 'radio', 'submit', 'button'].includes(kind)) continue;

    visible.push(el);
    if (visible.length >= 100) break;
  }

  const target = visible[index - 1];
  if (!target) return { ok: false, message: 'Phần tử không còn hiển thị; hãy quét lại trang.' };

  const inputTarget = target instanceof HTMLInputElement ? target : null;
  const labelText = inputTarget?.labels ? Array.from(inputTarget.labels).map((label) => label.innerText).join(' ') : '';
  const currentLabel =
    (
      target.getAttribute('aria-label') ||
      target.getAttribute('placeholder') ||
      labelText ||
      target.innerText ||
      target.getAttribute('title') ||
      ''
    )
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 140) ||
    (inputTarget?.type || target.tagName.toLowerCase());

  if (expectedLabel && currentLabel !== expectedLabel) {
    return { ok: false, message: 'Nhãn phần tử đã thay đổi; hãy quét lại trang trước khi thao tác.' };
  }
  if (
    ('disabled' in target && Boolean((target as HTMLButtonElement).disabled)) ||
    target.getAttribute('aria-disabled') === 'true'
  ) {
    return { ok: false, message: 'Phần tử đang bị vô hiệu hóa.' };
  }

  if (operation === 'click') {
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    target.click();
    return { ok: true, message: 'Đã nhấn phần tử.' };
  }

  if (
    !(
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      target.isContentEditable
    )
  ) {
    return { ok: false, message: 'Đích đã chọn không phải trường nhập liệu.' };
  }
  if (target instanceof HTMLInputElement && ['password', 'hidden', 'file'].includes(target.type)) {
    return { ok: false, message: 'Agent không đọc hoặc điền trường mật khẩu, ẩn hoặc tệp.' };
  }
  if (target instanceof HTMLSelectElement) {
    const option = Array.from(target.options).find((item) => item.label === value || item.value === value);
    if (!option) return { ok: false, message: 'Không tìm thấy lựa chọn khớp trong danh sách.' };
    target.value = option.value;
  } else if (target.isContentEditable) {
    target.textContent = value || '';
  } else {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), 'value')?.set;
    setter?.call(target, value || '');
  }
  target.dispatchEvent(new Event('input', { bubbles: true }));
  target.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true, message: 'Đã điền trường và phát sự kiện input/change.' };
}

/**
 * Inspects all frames in the given tab (`allFrames: true`), merges interactive elements
 * into a unified 1-based Set-of-Mark list, and optionally draws `[1]`, `[2]`, ... overlays.
 */
export async function inspectAllFrames(
  tabId: number,
  options?: { drawOverlay?: boolean }
): Promise<AgentPageSnapshot> {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: inspectPage,
    args: [{ drawOverlay: false }],
  });

  let primarySnapshot: AgentPageSnapshot | null = null;
  const mergedElements: AgentElement[] = [];
  const perFrameOverlays = new Map<
    number,
    Array<{ somIndex: number; rect: { x: number; y: number; width: number; height: number } }>
  >();

  for (const item of results) {
    const snap = item.result as AgentPageSnapshot | undefined;
    if (!snap) continue;
    const frameId = item.frameId ?? 0;
    if (frameId === 0 || !primarySnapshot) {
      primarySnapshot = snap;
    }

    for (const el of snap.elements) {
      const globalIndex = mergedElements.length + 1;
      mergedElements.push({
        ...el,
        index: globalIndex,
        frameId,
        frameLocalIndex: el.index,
      });
      if (options?.drawOverlay) {
        const list = perFrameOverlays.get(frameId) || [];
        list.push({ somIndex: globalIndex, rect: el.rect });
        perFrameOverlays.set(frameId, list);
      }
      if (mergedElements.length >= 120) break;
    }
    if (mergedElements.length >= 120) break;
  }

  if (options?.drawOverlay) {
    await Promise.all(
      Array.from(perFrameOverlays.entries()).map(([frameId, items]) =>
        chrome.scripting
          .executeScript({
            target: { tabId, frameIds: [frameId] },
            func: drawSomOverlays,
            args: [items],
          })
          .catch(() => null)
      )
    );
  }

  return {
    url: primarySnapshot?.url || '',
    title: primarySnapshot?.title || '',
    viewport: primarySnapshot?.viewport || { width: 0, height: 0 },
    heading: primarySnapshot?.heading || '',
    elements: mergedElements,
  };
}

/** Clears Set-of-Mark overlays across all frames of the given tab. */
export async function clearAllFrameOverlays(tabId: number): Promise<void> {
  await chrome.scripting
    .executeScript({
      target: { tabId, allFrames: true },
      func: clearSomOverlays,
    })
    .catch(() => null);
}

/** Executes a click or fill action on an element in its specific frame. */
export async function actOnFrameElement(
  tabId: number,
  element: Pick<AgentElement, 'index' | 'frameId' | 'frameLocalIndex' | 'label'>,
  operation: 'click' | 'fill',
  value?: string
): Promise<{ ok: boolean; message: string }> {
  const frameId = element.frameId ?? 0;
  const localIndex = element.frameLocalIndex ?? element.index;
  const [result] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    func: actOnPage,
    args: [localIndex, operation, value, element.label],
  });
  return (result?.result as { ok: boolean; message: string } | undefined) ?? {
    ok: false,
    message: 'Không nhận được kết quả từ frame.',
  };
}

/** Captures a JPEG screenshot of the window containing `tabId`. */
export async function captureTabScreenshot(tabId: number): Promise<string> {
  const tab = await chrome.tabs.get(tabId);
  return chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 65 });
}

/**
 * Computes top-level viewport center coordinates `(x, y)` for an element,
 * adding parent `iframe.getBoundingClientRect().left/top` offsets recursively when `frameId !== 0`.
 */
export async function getElementViewportCenter(
  tabId: number,
  element: Pick<AgentElement, 'rect' | 'frameId'>
): Promise<{ x: number; y: number }> {
  const localCenterX = element.rect.x + element.rect.width / 2;
  const localCenterY = element.rect.y + element.rect.height / 2;
  const frameId = element.frameId ?? 0;

  if (frameId === 0) {
    return { x: Math.round(localCenterX), y: Math.round(localCenterY) };
  }

  let offsetX = 0;
  let offsetY = 0;

  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      func: () => {
        let x = 0;
        let y = 0;
        let crossOriginBlocked = false;
        try {
          let win: Window = window;
          while (win !== win.top) {
            const fe = win.frameElement as HTMLElement | null;
            if (!fe) {
              crossOriginBlocked = true;
              break;
            }
            const r = fe.getBoundingClientRect();
            x += r.left;
            y += r.top;
            win = win.parent;
          }
        } catch {
          crossOriginBlocked = true;
        }
        return { x, y, crossOriginBlocked, href: location.href };
      },
    });

    const data = res?.result as
      | { x: number; y: number; crossOriginBlocked: boolean; href: string }
      | undefined;

    if (data) {
      offsetX = data.x;
      offsetY = data.y;

      if (data.crossOriginBlocked && data.href) {
        const allFrames = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          func: () => ({
            href: location.href,
            iframes: Array.from(document.querySelectorAll('iframe')).map((f) => {
              const r = f.getBoundingClientRect();
              return { src: f.src || '', left: r.left, top: r.top };
            }),
          }),
        });

        for (const frameRes of allFrames) {
          if ((frameRes.frameId ?? 0) === frameId) continue;
          const info = frameRes.result as
            | { href: string; iframes: Array<{ src: string; left: number; top: number }> }
            | undefined;
          const match = info?.iframes.find(
            (f) => f.src && (f.src === data.href || data.href.startsWith(f.src))
          );
          if (match) {
            offsetX += match.left;
            offsetY += match.top;
            break;
          }
        }
      }
    }
  } catch {
    // Fall back to local coordinates if frame offset lookup fails
  }

  return {
    x: Math.round(offsetX + localCenterX),
    y: Math.round(offsetY + localCenterY),
  };
}

/**
 * VLM Vision fallback helper for screen-router.ts when screen state is UNKNOWN,
 * an unexpected popup blocks the UI, or the same action fails 2 consecutive times.
 */
export async function runVlmFallback(params: VlmFallbackParams): Promise<VlmFallbackResult> {
  const { tabId, goal, currentState, lastError, consecutiveFailures, apiKey, preferCdp } = params;
  const snapshot = await inspectAllFrames(tabId, { drawOverlay: true });
  let screenshotDataUrl: string;
  try {
    screenshotDataUrl = await captureTabScreenshot(tabId);
  } finally {
    await clearAllFrameOverlays(tabId);
  }

  const action = await requestVlmNextAction({
    goal,
    currentState,
    lastError,
    consecutiveFailures,
    screenshotDataUrl,
    snapshot,
    apiKey,
  });

  if (action.action === 'click' || action.action === 'fill') {
    const target = snapshot.elements.find((el) => el.index === action.elementIndex);
    if (!target) {
      return {
        executed: false,
        action,
        snapshot,
        outcome: { ok: false, message: `VLM chọn index [${action.elementIndex}] không tồn tại.` },
      };
    }

    if (action.action === 'click' && preferCdp) {
      try {
        const { x, y } = await getElementViewportCenter(tabId, target);
        await cdpClick(tabId, x, y);
        return {
          executed: true,
          action,
          snapshot,
          outcome: { ok: true, message: `Đã CDP click [${target.index}] tại (${x}, ${y}).` },
        };
      } catch {
        // Fall back to DOM actOnFrameElement if CDP click fails
      }
    }

    const outcome = await actOnFrameElement(tabId, target, action.action, action.value);
    return { executed: outcome.ok, action, snapshot, outcome };
  }

  if (action.action === 'press_key' && action.value) {
    const key = action.value;
    if (preferCdp) {
      try {
        await cdpPressKey(tabId, key);
        return {
          executed: true,
          action,
          snapshot,
          outcome: { ok: true, message: `Đã gửi phím CDP ${key}.` },
        };
      } catch {
        // Fall back to DOM KeyboardEvent dispatch
      }
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      func: (k: string) => {
        const active = document.activeElement || document.body;
        active.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
        active.dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true }));
      },
      args: [key],
    });
    return {
      executed: true,
      action,
      snapshot,
      outcome: { ok: true, message: `Đã gửi phím ${key}.` },
    };
  }

  if (action.action === 'wait') {
    const ms = Math.min(Math.max(action.waitMs ?? 2000, 300), 15000);
    await new Promise((resolve) => setTimeout(resolve, ms));
    return {
      executed: true,
      action,
      snapshot,
      outcome: { ok: true, message: `Đã chờ ${ms}ms theo VLM.` },
    };
  }

  return {
    executed: false,
    action,
    snapshot,
    outcome: { ok: action.action === 'done', message: action.reason },
  };
}
