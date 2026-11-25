// Client-side in-browser cursor overlay script.
// Injected into every page via BrowserContext.addInitScript().
// Encapsulated within an isolated Shadow DOM to avoid CSS leaks or conflicts with host applications.

export interface CursorPosition {
  x: number;
  y: number;
}

export interface GlideOptions {
  duration?: number;
  speed?: number;
}

export interface ElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OmniFlowCursorAPI {
  glideTo(x: number, y: number, options?: GlideOptions): Promise<void>;
  triggerClickRipple(x?: number, y?: number): void;
  showTypingBadge(text: string, isPassword?: boolean): void;
  hideTypingBadge(): void;
  setStatus(status: string): void;
  highlightElement(rect: ElementRect): void;
  clearHighlight(): void;
  getPosition(): CursorPosition;
  getRootElement(): any;
  getShadowRoot(): any;
  ensureMounted(): void;
}

export const CURSOR_INJECTION_SCRIPT = `
(function () {
  if (typeof window === 'undefined') return;

  if (window.__omniflowCursor) {
    if (typeof window.__omniflowCursor.ensureMounted === 'function') {
      window.__omniflowCursor.ensureMounted();
    }
    return;
  }

  var STORAGE_KEY = '__omniflow_cursor_coords__';
  var currentX = 100;
  var currentY = 100;

  // Restore persistent coordinates from sessionStorage if available
  try {
    var saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) {
      var parsed = JSON.parse(saved);
      if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
        currentX = parsed.x;
        currentY = parsed.y;
      }
    }
  } catch (e) {}

  var host = document.getElementById('___omniflow_cursor_root__');
  if (!host) {
    host = document.createElement('div');
    host.id = '___omniflow_cursor_root__';
    host.style.cssText = 'position:fixed!important;top:0!important;left:0!important;width:0!important;height:0!important;pointer-events:none!important;z-index:2147483647!important;border:none!important;margin:0!important;padding:0!important;';
  }

  function mountHost() {
    var target = document.body || document.documentElement;
    if (target && (!host.parentNode || !document.contains(host))) {
      try {
        target.appendChild(host);
      } catch (e) {}
    }
  }

  mountHost();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountHost);
  }

  try {
    var observer = new MutationObserver(function () {
      if (!document.contains(host)) {
        mountHost();
      }
    });
    if (document.documentElement) {
      observer.observe(document.documentElement, { childList: true });
    }
  } catch (e) {}

  var shadow = host.shadowRoot || host.attachShadow({ mode: 'open' });

  // Stylesheet
  var style = document.createElement('style');
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
    '@keyframes omniflow-ripple-expand { 0% { width: 10px; height: 10px; opacity: 0.95; transform: translate(-50%, -50%) scale(0.3); } 60% { opacity: 0.65; } 100% { width: 68px; height: 68px; opacity: 0; transform: translate(-50%, -50%) scale(2.2); } }'
  ].join('\\n');

  shadow.innerHTML = '';
  shadow.appendChild(style);

  // Target Highlight Frame
  var highlightFrame = document.createElement('div');
  highlightFrame.id = 'omniflow-highlight-frame';
  shadow.appendChild(highlightFrame);

  // Cursor Container
  var cursorContainer = document.createElement('div');
  cursorContainer.id = 'omniflow-cursor-container';
  cursorContainer.style.transform = 'translate3d(' + currentX + 'px, ' + currentY + 'px, 0)';

  // Pointer SVG Wrapper
  var pointerWrapper = document.createElement('div');
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
    '</svg>'
  ].join('');

  // Status Badge
  var statusBadge = document.createElement('div');
  statusBadge.id = 'omniflow-status-badge';
  var statusIcon = document.createElement('span');
  statusIcon.id = 'omniflow-status-icon';
  statusIcon.textContent = '🤖';
  var statusText = document.createElement('span');
  statusText.id = 'omniflow-status-text';
  statusText.textContent = 'OmniFlow Agent';
  statusBadge.appendChild(statusIcon);
  statusBadge.appendChild(statusText);

  cursorContainer.appendChild(pointerWrapper);
  cursorContainer.appendChild(statusBadge);
  shadow.appendChild(cursorContainer);

  // Active RAF tracking
  var activeRaf = null;
  var activeResolve = null;

  function savePosition(x, y) {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ x: x, y: y }));
    } catch (e) {}
  }

  function glideTo(targetX, targetY, options) {
    mountHost();
    options = options || {};
    var p0x = currentX;
    var p0y = currentY;
    var p2x = Math.round(targetX);
    var p2y = Math.round(targetY);

    var dx = p2x - p0x;
    var dy = p2y - p0y;
    var dist = Math.sqrt(dx * dx + dy * dy);

    var duration;
    if (typeof options.duration === 'number') {
      duration = options.duration;
    } else {
      var speed = typeof options.speed === 'number' && options.speed > 0 ? options.speed : 1.0;
      var base = Math.max(160, Math.min(520, 160 + Math.sqrt(dist) * 12));
      duration = Math.round(base / speed);
    }

    if (activeRaf) {
      cancelAnimationFrame(activeRaf);
      activeRaf = null;
    }
    if (typeof activeResolve === 'function') {
      var prevResolve = activeResolve;
      activeResolve = null;
      prevResolve();
    }

    if (duration <= 0 || dist < 2) {
      currentX = p2x;
      currentY = p2y;
      cursorContainer.style.transform = 'translate3d(' + p2x + 'px, ' + p2y + 'px, 0)';
      savePosition(p2x, p2y);
      return Promise.resolve();
    }

    // Bezier control point calculation: orthogonal offset from midpoint
    var mx = (p0x + p2x) / 2;
    var my = (p0y + p2y) / 2;
    var nx = -dy / dist;
    var ny = dx / dist;
    var offset = Math.min(38, dist * 0.12);
    var sign = ((Math.round(p0x + p0y) % 2) === 0) ? 1 : -1;
    var p1x = mx + nx * offset * sign;
    var p1y = my + ny * offset * sign;

    return new Promise(function (resolve) {
      activeResolve = resolve;
      var startTime = performance.now();

      function step(now) {
        var elapsed = now - startTime;
        var u = Math.min(1, Math.max(0, elapsed / duration));
        // Cubic Ease-Out acceleration/deceleration: 1 - (1 - u)^3
        var t = 1 - Math.pow(1 - u, 3);
        var oneMinusT = 1 - t;

        var curX = Math.round(oneMinusT * oneMinusT * p0x + 2 * oneMinusT * t * p1x + t * t * p2x);
        var curY = Math.round(oneMinusT * oneMinusT * p0y + 2 * oneMinusT * t * p1y + t * t * p2y);

        currentX = curX;
        currentY = curY;
        cursorContainer.style.transform = 'translate3d(' + curX + 'px, ' + curY + 'px, 0)';

        if (u < 1) {
          activeRaf = requestAnimationFrame(step);
        } else {
          currentX = p2x;
          currentY = p2y;
          cursorContainer.style.transform = 'translate3d(' + p2x + 'px, ' + p2y + 'px, 0)';
          savePosition(p2x, p2y);
          activeRaf = null;
          var res = activeResolve;
          activeResolve = null;
          if (typeof res === 'function') res();
        }
      }

      activeRaf = requestAnimationFrame(step);
    });
  }

  function triggerClickRipple(x, y) {
    mountHost();
    var rippleX = typeof x === 'number' ? x : currentX;
    var rippleY = typeof y === 'number' ? y : currentY;

    // Depress arrow pointer
    pointerWrapper.classList.add('depressed');
    setTimeout(function () {
      pointerWrapper.classList.remove('depressed');
    }, 150);

    // Create ripple circle
    var ripple = document.createElement('div');
    ripple.className = 'omniflow-click-ripple';
    ripple.style.left = rippleX + 'px';
    ripple.style.top = rippleY + 'px';
    shadow.appendChild(ripple);

    setTimeout(function () {
      if (ripple.parentNode) {
        ripple.parentNode.removeChild(ripple);
      }
    }, 500);

    setTimeout(function () {
      clearHighlight();
      setStatus('🤖 OmniFlow Agent');
    }, 600);
  }

  function showTypingBadge(text, isPassword) {
    mountHost();
    statusBadge.classList.add('typing-pulse');
    statusIcon.textContent = '⌨️';
    var displayText = '';
    if (isPassword) {
      var len = text ? text.length : 8;
      displayText = '•'.repeat(Math.min(len, 16));
    } else {
      displayText = text ? (text.length > 20 ? text.slice(0, 18) + '...' : text) : '...';
    }
    statusText.textContent = 'Typing: ' + displayText;
  }

  function hideTypingBadge() {
    mountHost();
    statusBadge.classList.remove('typing-pulse');
    statusIcon.textContent = '🤖';
    statusText.textContent = 'OmniFlow Agent';
  }

  function setStatus(status) {
    mountHost();
    if (!status) return;
    if (status.indexOf('⚡') === 0) {
      statusIcon.textContent = '⚡';
      statusText.textContent = status.replace('⚡', '').trim() || 'Click';
    } else if (status.indexOf('👁️') === 0) {
      statusIcon.textContent = '👁️';
      statusText.textContent = status.replace('👁️', '').trim() || 'Hover';
    } else if (status.indexOf('⌨️') === 0) {
      statusIcon.textContent = '⌨️';
      statusText.textContent = status.replace('⌨️', '').trim() || 'Typing';
    } else if (status.indexOf('🤖') === 0) {
      statusIcon.textContent = '🤖';
      statusText.textContent = status.replace('🤖', '').trim() || 'OmniFlow Agent';
    } else {
      statusIcon.textContent = '🤖';
      statusText.textContent = status;
    }
  }

  function highlightElement(rect) {
    mountHost();
    if (!rect) return;
    highlightFrame.style.left = Math.round(rect.x - 2) + 'px';
    highlightFrame.style.top = Math.round(rect.y - 2) + 'px';
    highlightFrame.style.width = Math.round(rect.width + 4) + 'px';
    highlightFrame.style.height = Math.round(rect.height + 4) + 'px';
    highlightFrame.style.opacity = '1';
  }

  function clearHighlight() {
    mountHost();
    highlightFrame.style.opacity = '0';
  }

  window.__omniflowCursor = {
    glideTo: glideTo,
    triggerClickRipple: triggerClickRipple,
    showTypingBadge: showTypingBadge,
    hideTypingBadge: hideTypingBadge,
    setStatus: setStatus,
    highlightElement: highlightElement,
    clearHighlight: clearHighlight,
    getPosition: function () {
      mountHost();
      return { x: currentX, y: currentY };
    },
    getRootElement: function () {
      mountHost();
      return host;
    },
    getShadowRoot: function () {
      mountHost();
      return shadow;
    },
    ensureMounted: function () {
      mountHost();
    }
  };
})();
`;
