// ============================================================
// OmniFlow Studio Extension — MV3 Visual Cursor Overlay Engine
// CSP-safe injection via chrome.scripting.executeScript (func)
// Encapsulated in an isolated Shadow DOM
// ============================================================

export interface CursorPosition {
  x: number;
  y: number;
}

export interface ElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CursorAction =
  | { type: 'glide'; x: number; y: number; duration?: number; speed?: number }
  | { type: 'click'; x?: number; y?: number }
  | { type: 'type'; text: string; isPassword?: boolean }
  | { type: 'hideType' }
  | { type: 'status'; status: string }
  | { type: 'highlight'; rect: ElementRect }
  | { type: 'clearHighlight' };

interface ChromeScriptingAPI {
  executeScript<Args extends unknown[], Result>(injection: {
    target: { tabId: number; allFrames?: boolean };
    world?: 'MAIN' | 'ISOLATED';
    func: (...args: Args) => Result;
    args?: Args;
  }): Promise<Array<{ frameId: number; result: Result }>>;
}

function getScripting(): ChromeScriptingAPI {
  const api = (chrome as unknown as { scripting?: ChromeScriptingAPI }).scripting;
  if (!api) {
    throw new Error('chrome.scripting API is unavailable. Ensure "scripting" permission is enabled.');
  }
  return api;
}

/**
 * In-page cursor overlay installer executed via chrome.scripting.executeScript.
 * Must remain self-contained with zero external closures for MV3 serialization.
 */
function installCursorOverlayInPage(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const w = window as unknown as Record<string, any>;
  if (w.__omniflowCursor) {
    if (typeof w.__omniflowCursor.ensureMounted === 'function') {
      w.__omniflowCursor.ensureMounted();
    }
    return;
  }

  const STORAGE_KEY = '__omniflow_cursor_coords__';
  let currentX = 100;
  let currentY = 100;

  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
        currentX = parsed.x;
        currentY = parsed.y;
      }
    }
  } catch {
    // ignore storage errors
  }

  let host = document.getElementById('___omniflow_cursor_root__') as HTMLDivElement | null;
  if (!host) {
    host = document.createElement('div');
    host.id = '___omniflow_cursor_root__';
    host.style.cssText =
      'position:fixed!important;top:0!important;left:0!important;width:0!important;height:0!important;pointer-events:none!important;z-index:2147483647!important;border:none!important;margin:0!important;padding:0!important;';
  }

  function mountHost(): void {
    const target = document.documentElement || document.body;
    if (target && host && (!host.parentNode || !document.contains(host))) {
      try {
        target.appendChild(host);
      } catch {
        // ignore mount errors during navigation
      }
    }
  }

  let observer: MutationObserver | null = null;
  const onDomReady = () => mountHost();

  mountHost();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onDomReady);
  }

  try {
    observer = new MutationObserver(() => {
      if (host && !document.contains(host)) {
        mountHost();
      }
    });
    if (document.documentElement) {
      observer.observe(document.documentElement, { childList: true });
    }
    if (document.body) {
      observer.observe(document.body, { childList: true });
    }
  } catch {
    // ignore observer errors
  }

  const shadow = host.shadowRoot || host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = [
    ':host { all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; pointer-events: none !important; z-index: 2147483647 !important; }',
    '#omniflow-cursor-container { position: fixed; top: 0; left: 0; pointer-events: none !important; z-index: 2147483647 !important; will-change: transform; transition: opacity 0.2s ease; display: flex; flex-direction: column; align-items: flex-start; }',
    '#omniflow-pointer-wrapper { transform-origin: 3px 2px; transition: transform 0.08s ease-out; will-change: transform; filter: drop-shadow(0 2px 8px rgba(0, 240, 255, 0.65)); }',
    '#omniflow-pointer-wrapper.depressed { transform: scale(0.82) rotate(-4deg); filter: drop-shadow(0 1px 4px rgba(0, 240, 255, 0.9)); }',
    '#omniflow-status-badge { display: inline-flex; align-items: center; gap: 6px; margin-top: 10px; margin-left: 14px; padding: 4px 10px; background: rgba(10, 16, 32, 0.9); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); border: 1px solid rgba(0, 240, 255, 0.45); border-radius: 9999px; color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif; font-size: 11px; font-weight: 600; letter-spacing: 0.2px; white-space: nowrap; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4), 0 0 10px rgba(0, 240, 255, 0.25); transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1); user-select: none; }',
    '#omniflow-status-badge.typing-pulse { animation: omniflow-badge-pulse 0.9s infinite alternate ease-in-out; border-color: rgba(0, 255, 170, 0.7); box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4), 0 0 12px rgba(0, 255, 170, 0.4); }',
    '@keyframes omniflow-badge-pulse { 0% { transform: scale(1); filter: brightness(1); } 100% { transform: scale(1.05); filter: brightness(1.2); } }',
    '#omniflow-highlight-frame { position: fixed; pointer-events: none !important; border: 2px solid rgba(0, 240, 255, 0.85); border-radius: 4px; box-shadow: 0 0 12px rgba(0, 240, 255, 0.5), inset 0 0 8px rgba(0, 240, 255, 0.2); background: rgba(0, 240, 255, 0.08); transition: opacity 0.25s ease, transform 0.2s ease, width 0.2s ease, height 0.2s ease, top 0.2s ease, left 0.2s ease; opacity: 0; z-index: 2147483646 !important; will-change: top, left, width, height, opacity; }',
    '.omniflow-click-ripple { position: fixed; border-radius: 50%; pointer-events: none !important; z-index: 2147483645 !important; transform: translate(-50%, -50%); background: radial-gradient(circle, rgba(0, 240, 255, 0.7) 0%, rgba(0, 170, 255, 0.4) 45%, rgba(0, 100, 255, 0) 70%); border: 1.5px solid rgba(0, 240, 255, 0.9); box-shadow: 0 0 14px rgba(0, 240, 255, 0.8); animation: omniflow-ripple-expand 0.45s cubic-bezier(0.12, 0.8, 0.32, 1) forwards; }',
    '@keyframes omniflow-ripple-expand { 0% { width: 10px; height: 10px; opacity: 0.95; transform: translate(-50%, -50%) scale(0.3); } 60% { opacity: 0.65; } 100% { width: 68px; height: 68px; opacity: 0; transform: translate(-50%, -50%) scale(2.2); } }',
  ].join('\n');

  shadow.innerHTML = '';
  shadow.appendChild(style);

  const highlightFrame = document.createElement('div');
  highlightFrame.id = 'omniflow-highlight-frame';
  shadow.appendChild(highlightFrame);

  const cursorContainer = document.createElement('div');
  cursorContainer.id = 'omniflow-cursor-container';
  cursorContainer.style.transform = `translate3d(${currentX}px, ${currentY}px, 0)`;

  const pointerWrapper = document.createElement('div');
  pointerWrapper.id = 'omniflow-pointer-wrapper';
  pointerWrapper.innerHTML = [
    '<svg id="omniflow-cursor-svg" viewBox="0 0 24 24" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg">',
    '  <defs>',
    '    <linearGradient id="omniflow-pointer-grad" x1="0%" y1="0%" x2="100%" y2="100%">',
    '      <stop offset="0%" stop-color="#00ffff" />',
    '      <stop offset="60%" stop-color="#00b4d8" />',
    '      <stop offset="100%" stop-color="#0077b6" />',
    '    </linearGradient>',
    '  </defs>',
    '  <path d="M3 2L20 9.5L12 12.5L8.5 20.5L3 2Z" fill="url(#omniflow-pointer-grad)" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/>',
    '</svg>',
  ].join('');

  const statusBadge = document.createElement('div');
  statusBadge.id = 'omniflow-status-badge';
  const statusIcon = document.createElement('span');
  statusIcon.id = 'omniflow-status-icon';
  statusIcon.textContent = '🤖';
  const statusText = document.createElement('span');
  statusText.id = 'omniflow-status-text';
  statusText.textContent = 'OmniFlow Agent';
  statusBadge.appendChild(statusIcon);
  statusBadge.appendChild(statusText);

  cursorContainer.appendChild(pointerWrapper);
  cursorContainer.appendChild(statusBadge);
  shadow.appendChild(cursorContainer);

  let activeRaf: number | null = null;
  let activeResolve: (() => void) | null = null;
  const activeTimers = new Set<ReturnType<typeof setTimeout>>();

  function trackTimeout(fn: () => void, ms: number): void {
    const id = setTimeout(() => {
      activeTimers.delete(id);
      fn();
    }, ms);
    activeTimers.add(id);
  }

  function savePosition(x: number, y: number): void {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ x, y }));
    } catch {
      // ignore storage errors
    }
  }

  function clearHighlight(): void {
    mountHost();
    highlightFrame.style.opacity = '0';
  }

  function setStatus(status: string): void {
    mountHost();
    if (!status) return;
    if (status.startsWith('⚡')) {
      statusIcon.textContent = '⚡';
      statusText.textContent = status.replace('⚡', '').trim() || 'Click';
    } else if (status.startsWith('👁️')) {
      statusIcon.textContent = '👁️';
      statusText.textContent = status.replace('👁️', '').trim() || 'Hover';
    } else if (status.startsWith('⌨️')) {
      statusIcon.textContent = '⌨️';
      statusText.textContent = status.replace('⌨️', '').trim() || 'Typing';
    } else if (status.startsWith('🤖')) {
      statusIcon.textContent = '🤖';
      statusText.textContent = status.replace('🤖', '').trim() || 'OmniFlow Agent';
    } else {
      statusIcon.textContent = '🤖';
      statusText.textContent = status;
    }
  }

  function glideTo(
    targetX: number,
    targetY: number,
    options?: { duration?: number; speed?: number }
  ): Promise<void> {
    mountHost();
    const opts = options || {};
    const p0x = currentX;
    const p0y = currentY;
    const p2x = Math.round(targetX);
    const p2y = Math.round(targetY);

    const dx = p2x - p0x;
    const dy = p2y - p0y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    let duration: number;
    if (typeof opts.duration === 'number') {
      duration = opts.duration;
    } else {
      const speed = typeof opts.speed === 'number' && opts.speed > 0 ? opts.speed : 1.0;
      const base = Math.max(160, Math.min(520, 160 + Math.sqrt(dist) * 12));
      duration = Math.round(base / speed);
    }

    if (activeRaf !== null) {
      cancelAnimationFrame(activeRaf);
      activeRaf = null;
    }
    if (typeof activeResolve === 'function') {
      const prevResolve = activeResolve;
      activeResolve = null;
      prevResolve();
    }

    if (duration <= 0 || dist < 2) {
      currentX = p2x;
      currentY = p2y;
      cursorContainer.style.transform = `translate3d(${p2x}px, ${p2y}px, 0)`;
      savePosition(p2x, p2y);
      return Promise.resolve();
    }

    const mx = (p0x + p2x) / 2;
    const my = (p0y + p2y) / 2;
    const nx = -dy / dist;
    const ny = dx / dist;
    const offset = Math.min(38, dist * 0.12);
    const sign = Math.round(p0x + p0y) % 2 === 0 ? 1 : -1;
    const p1x = mx + nx * offset * sign;
    const p1y = my + ny * offset * sign;

    return new Promise<void>((resolve) => {
      activeResolve = resolve;
      const startTime = performance.now();

      function step(now: number): void {
        const elapsed = now - startTime;
        const u = Math.min(1, Math.max(0, elapsed / duration));
        const t = 1 - Math.pow(1 - u, 3);
        const oneMinusT = 1 - t;

        const curX = Math.round(
          oneMinusT * oneMinusT * p0x + 2 * oneMinusT * t * p1x + t * t * p2x
        );
        const curY = Math.round(
          oneMinusT * oneMinusT * p0y + 2 * oneMinusT * t * p1y + t * t * p2y
        );

        currentX = curX;
        currentY = curY;
        cursorContainer.style.transform = `translate3d(${curX}px, ${curY}px, 0)`;

        if (u < 1) {
          activeRaf = requestAnimationFrame(step);
        } else {
          currentX = p2x;
          currentY = p2y;
          cursorContainer.style.transform = `translate3d(${p2x}px, ${p2y}px, 0)`;
          savePosition(p2x, p2y);
          activeRaf = null;
          const res = activeResolve;
          activeResolve = null;
          if (typeof res === 'function') res();
        }
      }

      activeRaf = requestAnimationFrame(step);
    });
  }

  function triggerClickRipple(x?: number, y?: number): void {
    mountHost();
    const rippleX = typeof x === 'number' ? x : currentX;
    const rippleY = typeof y === 'number' ? y : currentY;

    pointerWrapper.classList.add('depressed');
    trackTimeout(() => {
      pointerWrapper.classList.remove('depressed');
    }, 150);

    const ripple = document.createElement('div');
    ripple.className = 'omniflow-click-ripple';
    ripple.style.left = `${rippleX}px`;
    ripple.style.top = `${rippleY}px`;
    shadow.appendChild(ripple);

    trackTimeout(() => {
      if (ripple.parentNode) {
        ripple.parentNode.removeChild(ripple);
      }
    }, 500);

    trackTimeout(() => {
      clearHighlight();
      setStatus('🤖 OmniFlow Agent');
    }, 600);
  }

  function showTypingBadge(text: string, isPassword?: boolean): void {
    mountHost();
    statusBadge.classList.add('typing-pulse');
    statusIcon.textContent = '⌨️';
    let displayText = '';
    if (isPassword) {
      const len = text ? text.length : 8;
      displayText = '•'.repeat(Math.min(len, 16));
    } else {
      displayText = text ? (text.length > 20 ? `${text.slice(0, 18)}...` : text) : '...';
    }
    statusText.textContent = `Typing: ${displayText}`;
  }

  function hideTypingBadge(): void {
    mountHost();
    statusBadge.classList.remove('typing-pulse');
    statusIcon.textContent = '🤖';
    statusText.textContent = 'OmniFlow Agent';
  }

  function highlightElement(rect: ElementRect): void {
    mountHost();
    if (!rect) return;
    highlightFrame.style.left = `${Math.round(rect.x - 2)}px`;
    highlightFrame.style.top = `${Math.round(rect.y - 2)}px`;
    highlightFrame.style.width = `${Math.round(rect.width + 4)}px`;
    highlightFrame.style.height = `${Math.round(rect.height + 4)}px`;
    highlightFrame.style.opacity = '1';
  }

  w.__omniflowCursor = {
    glideTo,
    triggerClickRipple,
    showTypingBadge,
    hideTypingBadge,
    setStatus,
    highlightElement,
    clearHighlight,
    getPosition: () => {
      mountHost();
      return { x: currentX, y: currentY };
    },
    getRootElement: () => {
      mountHost();
      return host;
    },
    getShadowRoot: () => {
      mountHost();
      return shadow;
    },
    ensureMounted: () => {
      mountHost();
    },
    destroy: () => {
      if (activeRaf !== null) {
        cancelAnimationFrame(activeRaf);
        activeRaf = null;
      }
      if (typeof activeResolve === 'function') {
        const res = activeResolve;
        activeResolve = null;
        res();
      }
      for (const timer of activeTimers) {
        clearTimeout(timer);
      }
      activeTimers.clear();
      if (observer) {
        try {
          observer.disconnect();
        } catch {
          // ignore
        }
        observer = null;
      }
      document.removeEventListener('DOMContentLoaded', onDomReady);
      if (host && host.parentNode) {
        host.parentNode.removeChild(host);
      }
      host = null;
      delete w.__omniflowCursor;
    },
  };
}

/**
 * Remove the visual cursor overlay, disconnect its MutationObserver,
 * cancel active animations/timers, and clear window.__omniflowCursor.
 */
export async function removeCursorOverlay(tabId: number): Promise<void> {
  try {
    await getScripting().executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (): void => {
        const w = window as unknown as Record<string, any>;
        if (w.__omniflowCursor && typeof w.__omniflowCursor.destroy === 'function') {
          w.__omniflowCursor.destroy();
        }
        const leftover =
          document.getElementById('___omniflow_cursor_root__') ||
          document.getElementById('omniflow-cursor-root');
        if (leftover && leftover.parentNode) {
          leftover.parentNode.removeChild(leftover);
        }
        delete w.__omniflowCursor;
      },
    });
  } catch {
    // Non-fatal: tab may already be closed or navigated to restricted URL
  }
}

/**
 * Inject the Shadow DOM visual cursor overlay into the given tab using MV3 chrome.scripting.executeScript.
 */
export async function injectCursorOverlay(tabId: number): Promise<void> {
  try {
    await getScripting().executeScript({
      target: { tabId },
      world: 'MAIN',
      func: installCursorOverlayInPage,
    });
  } catch {
    // Non-fatal: page may be restricted or navigating
  }
}

/**
 * Execute a visual cursor action in the target tab, auto-injecting the overlay if needed.
 */
export async function cursorAction(tabId: number, action: CursorAction): Promise<void> {
  try {
    const results = await getScripting().executeScript({
      target: { tabId },
      world: 'MAIN',
      func: async (act: CursorAction): Promise<boolean> => {
        const w = window as unknown as Record<string, any>;
        const api = w.__omniflowCursor;
        if (!api) return false;

        switch (act.type) {
          case 'glide':
            await api.glideTo(act.x, act.y, {
              duration: act.duration,
              speed: act.speed,
            });
            return true;
          case 'click':
            api.triggerClickRipple(act.x, act.y);
            return true;
          case 'type':
            api.showTypingBadge(act.text, act.isPassword);
            return true;
          case 'hideType':
            api.hideTypingBadge();
            return true;
          case 'status':
            api.setStatus(act.status);
            return true;
          case 'highlight':
            api.highlightElement(act.rect);
            return true;
          case 'clearHighlight':
            api.clearHighlight();
            return true;
          default:
            return true;
        }
      },
      args: [action],
    });

    const mounted = results?.[0]?.result as unknown as boolean | undefined;
    if (mounted === false) {
      await injectCursorOverlay(tabId);
      await getScripting().executeScript({
        target: { tabId },
        world: 'MAIN',
        func: async (act: CursorAction): Promise<void> => {
          const w = window as unknown as Record<string, any>;
          const api = w.__omniflowCursor;
          if (!api) return;
          switch (act.type) {
            case 'glide':
              await api.glideTo(act.x, act.y, { duration: act.duration, speed: act.speed });
              break;
            case 'click':
              api.triggerClickRipple(act.x, act.y);
              break;
            case 'type':
              api.showTypingBadge(act.text, act.isPassword);
              break;
            case 'hideType':
              api.hideTypingBadge();
              break;
            case 'status':
              api.setStatus(act.status);
              break;
            case 'highlight':
              api.highlightElement(act.rect);
              break;
            case 'clearHighlight':
              api.clearHighlight();
              break;
          }
        },
        args: [action],
      });
    }
  } catch {
    // Non-fatal: cursor overlay is visual enhancement
  }
}
