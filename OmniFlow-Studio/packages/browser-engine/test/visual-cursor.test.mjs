import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { BrowserManager, VisualCursorManager, CURSOR_INJECTION_SCRIPT } from '../dist/index.js';

test('Test 1: Overlay injection into DOM and isolated Shadow DOM structure', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await VisualCursorManager.install(context, { enabled: true, headless: true });

  const page = await context.newPage();
  await page.setContent(`<!DOCTYPE html><html><body><h1>OmniFlow Visual Cursor</h1></body></html>`);

  const overlayInfo = await page.evaluate(() => {
    const root = document.getElementById('___omniflow_cursor_root__');
    if (!root) return null;
    const shadow = root.shadowRoot;
    if (!shadow) return null;

    const cursorContainer = shadow.getElementById('omniflow-cursor-container');
    const pointerWrapper = shadow.getElementById('omniflow-pointer-wrapper');
    const statusBadge = shadow.getElementById('omniflow-status-badge');
    const highlightFrame = shadow.getElementById('omniflow-highlight-frame');
    const cursorSvg = shadow.getElementById('omniflow-cursor-svg');

    return {
      hasRoot: true,
      hasShadow: true,
      hasContainer: !!cursorContainer,
      hasPointer: !!pointerWrapper,
      hasBadge: !!statusBadge,
      hasHighlightFrame: !!highlightFrame,
      hasSvg: !!cursorSvg,
      badgeText: statusBadge ? statusBadge.textContent.trim() : null,
      hasApi: typeof window.__omniflowCursor === 'object',
      pointerEvents: root.style.pointerEvents,
      zIndex: root.style.zIndex,
    };
  });

  assert.ok(overlayInfo, 'Overlay root element must exist');
  assert.equal(overlayInfo.hasRoot, true);
  assert.equal(overlayInfo.hasShadow, true);
  assert.equal(overlayInfo.hasContainer, true);
  assert.equal(overlayInfo.hasPointer, true);
  assert.equal(overlayInfo.hasBadge, true);
  assert.equal(overlayInfo.hasHighlightFrame, true);
  assert.equal(overlayInfo.hasSvg, true);
  assert.equal(overlayInfo.badgeText, '🤖OmniFlow Agent');
  assert.equal(overlayInfo.hasApi, true);
  assert.equal(overlayInfo.pointerEvents, 'none');
  assert.equal(overlayInfo.zIndex, '2147483647');

  await browser.close();
});

test('Test 2: Smooth glideTo updates coordinates and persists position', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await VisualCursorManager.install(context, { enabled: true, headless: true });
  const page = await context.newPage();
  await page.setContent(`<!DOCTYPE html><html><body><div>Glide Target</div></body></html>`);

  // Instantaneous glide (duration 0)
  await page.evaluate(() => window.__omniflowCursor.glideTo(320, 240, { duration: 0 }));

  const pos1 = await page.evaluate(() => window.__omniflowCursor.getPosition());
  assert.equal(pos1.x, 320);
  assert.equal(pos1.y, 240);

  // Position query matches updated coordinates
  const posCheck = await page.evaluate(() => {
    try {
      const saved = sessionStorage.getItem('__omniflow_cursor_coords__');
      return saved ? JSON.parse(saved) : window.__omniflowCursor.getPosition();
    } catch {
      return window.__omniflowCursor.getPosition();
    }
  });
  assert.deepEqual(posCheck, { x: 320, y: 240 });

  // Glide with duration
  await page.evaluate(() => window.__omniflowCursor.glideTo(150, 450, { duration: 50 }));
  const pos2 = await page.evaluate(() => window.__omniflowCursor.getPosition());
  assert.equal(pos2.x, 150);
  assert.equal(pos2.y, 450);

  await browser.close();
});

test('Test 3: Click ripple triggering and pointer depress animation', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await VisualCursorManager.install(context, { enabled: true, headless: true });
  const page = await context.newPage();
  await page.setContent(`<!DOCTYPE html><html><body><button id="btn">Click Target</button></body></html>`);

  // Trigger click ripple at (200, 300)
  const initialCheck = await page.evaluate(() => {
    window.__omniflowCursor.triggerClickRipple(200, 300);
    const shadow = document.getElementById('___omniflow_cursor_root__').shadowRoot;
    const ripple = shadow.querySelector('.omniflow-click-ripple');
    const pointer = shadow.getElementById('omniflow-pointer-wrapper');
    return {
      hasRipple: !!ripple,
      rippleLeft: ripple ? ripple.style.left : null,
      rippleTop: ripple ? ripple.style.top : null,
      isDepressed: pointer ? pointer.classList.contains('depressed') : false,
    };
  });

  assert.equal(initialCheck.hasRipple, true);
  assert.equal(initialCheck.rippleLeft, '200px');
  assert.equal(initialCheck.rippleTop, '300px');
  assert.equal(initialCheck.isDepressed, true);

  // Wait for ripple animation cleanup (550ms)
  await page.waitForTimeout(600);

  const cleanupCheck = await page.evaluate(() => {
    const shadow = document.getElementById('___omniflow_cursor_root__').shadowRoot;
    const ripple = shadow.querySelector('.omniflow-click-ripple');
    const pointer = shadow.getElementById('omniflow-pointer-wrapper');
    return {
      hasRipple: !!ripple,
      isDepressed: pointer ? pointer.classList.contains('depressed') : false,
    };
  });

  assert.equal(cleanupCheck.hasRipple, false, 'Ripple element must be removed after animation');
  assert.equal(cleanupCheck.isDepressed, false, 'Pointer must no longer be depressed');

  await browser.close();
});

test('Test 4: Typing badge with text display and password masking', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await VisualCursorManager.install(context, { enabled: true, headless: true });
  const page = await context.newPage();
  await page.setContent(`<!DOCTYPE html><html><body><input type="text" /></body></html>`);

  // Normal text typing
  const normalResult = await page.evaluate(() => {
    window.__omniflowCursor.showTypingBadge('JohnDoe');
    const shadow = document.getElementById('___omniflow_cursor_root__').shadowRoot;
    const badge = shadow.getElementById('omniflow-status-badge');
    return {
      text: badge.textContent,
      hasPulse: badge.classList.contains('typing-pulse'),
    };
  });
  assert.ok(normalResult.text.includes('Typing: JohnDoe'));
  assert.equal(normalResult.hasPulse, true);

  // Hide badge
  const hideResult = await page.evaluate(() => {
    window.__omniflowCursor.hideTypingBadge();
    const shadow = document.getElementById('___omniflow_cursor_root__').shadowRoot;
    const badge = shadow.getElementById('omniflow-status-badge');
    return {
      text: badge.textContent,
      hasPulse: badge.classList.contains('typing-pulse'),
    };
  });
  assert.ok(hideResult.text.includes('OmniFlow Agent'));
  assert.equal(hideResult.hasPulse, false);

  // Password masking: plain text must NEVER appear in badge
  const passwordResult = await page.evaluate(() => {
    const secret = 'MySuperSecretP@ssword123';
    window.__omniflowCursor.showTypingBadge(secret, true);
    const shadow = document.getElementById('___omniflow_cursor_root__').shadowRoot;
    const badge = shadow.getElementById('omniflow-status-badge');
    const text = badge.textContent;
    return {
      text,
      containsPlainText: text.includes('MySuperSecret'),
      containsBullets: text.includes('••••'),
      bulletCount: (text.match(/•/g) || []).length,
    };
  });

  assert.equal(passwordResult.containsPlainText, false, 'Plaintext password must never be exposed');
  assert.equal(passwordResult.containsBullets, true, 'Password must be masked with bullets');
  assert.ok(passwordResult.bulletCount >= 8, 'Bullet mask count should match masked length');

  await browser.close();
});

test('Test 5: Target element bounding box highlight and clearing', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await VisualCursorManager.install(context, { enabled: true, headless: true });
  const page = await context.newPage();
  await page.setContent(`<!DOCTYPE html><html><body><div>Highlight Test</div></body></html>`);

  // Highlight element
  await page.evaluate(() => {
    window.__omniflowCursor.highlightElement({ x: 120, y: 80, width: 200, height: 50 });
  });

  const frameInfo = await page.evaluate(() => {
    const shadow = document.getElementById('___omniflow_cursor_root__').shadowRoot;
    const frame = shadow.getElementById('omniflow-highlight-frame');
    return {
      opacity: frame.style.opacity,
      width: frame.style.width,
      height: frame.style.height,
    };
  });

  assert.equal(frameInfo.opacity, '1');
  assert.equal(frameInfo.width, '204px');
  assert.equal(frameInfo.height, '54px');

  // Clear highlight
  await page.evaluate(() => window.__omniflowCursor.clearHighlight());
  const clearedOpacity = await page.evaluate(() => {
    const shadow = document.getElementById('___omniflow_cursor_root__').shadowRoot;
    return shadow.getElementById('omniflow-highlight-frame').style.opacity;
  });
  assert.equal(clearedOpacity, '0');

  await browser.close();
});

test('Test 6: Coordinates persist across page reload and navigation', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await VisualCursorManager.install(context, { enabled: true, headless: true });
  const page = await context.newPage();

  // Load first page and glide cursor to (420, 310)
  await page.setContent(`<!DOCTYPE html><html><body><h1>Page 1</h1></body></html>`);
  await page.evaluate(() => window.__omniflowCursor.glideTo(420, 310, { duration: 0 }));

  const posBefore = await page.evaluate(() => window.__omniflowCursor.getPosition());
  assert.deepEqual(posBefore, { x: 420, y: 310 });

  // Navigate to another page (simulating SPA route or reload)
  await page.setContent(`<!DOCTYPE html><html><body><h1>Page 2</h1></body></html>`);

  const posAfter = await page.evaluate(() => window.__omniflowCursor.getPosition());
  assert.deepEqual(posAfter, { x: 420, y: 310 }, 'Cursor position must be restored from persistent state');

  await browser.close();
});

test('Test 7: Headless 0ms bypass executes without artificial latency', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await VisualCursorManager.install(context, { enabled: true, headless: true });
  const page = await context.newPage();
  await page.setContent(`<!DOCTYPE html><html><body><button id="fast">Fast Button</button></body></html>`);

  const startTime = Date.now();
  await page.locator('#fast').click();
  const elapsed = Date.now() - startTime;

  // In headless mode with 0ms bypass, click coordination should be fast (< 200ms)
  assert.ok(elapsed < 200, `Headless action took ${elapsed}ms; should execute without artificial glide latency`);

  await browser.close();
});

test('Test 8: Playwright Locator action interception (click, hover, fill)', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await VisualCursorManager.install(context, { enabled: true, headless: true });
  const page = await context.newPage();

  await page.setContent(`
    <!DOCTYPE html>
    <html>
      <body style="margin: 0; padding: 20px;">
        <button id="action-btn" style="position: absolute; left: 250px; top: 150px; width: 120px; height: 40px;">Submit</button>
        <input id="user-input" type="text" style="position: absolute; left: 250px; top: 220px; width: 160px; height: 30px;" />
        <input id="pass-input" type="password" style="position: absolute; left: 250px; top: 280px; width: 160px; height: 30px;" />
        <div id="output"></div>
        <script>
          document.getElementById('action-btn').addEventListener('click', () => {
            document.getElementById('output').textContent = 'clicked';
          });
        </script>
      </body>
    </html>
  `);

  // Hover action
  await page.locator('#action-btn').hover();
  const hoverPos = await page.evaluate(() => window.__omniflowCursor.getPosition());
  assert.ok(Math.abs(hoverPos.x - 310) <= 20, `Cursor X should be near button center 310, got ${hoverPos.x}`);
  assert.ok(Math.abs(hoverPos.y - 170) <= 20, `Cursor Y should be near button center 170, got ${hoverPos.y}`);

  // Click action
  await page.locator('#action-btn').click();
  const clickOutput = await page.textContent('#output');
  assert.equal(clickOutput, 'clicked', 'Button click event must have fired');

  // Fill action on standard input
  await page.locator('#user-input').fill('agent_user');
  const userVal = await page.inputValue('#user-input');
  assert.equal(userVal, 'agent_user');

  // Fill action on password input (verifies masking logic path)
  await page.locator('#pass-input').fill('SecretKey999!');
  const passVal = await page.inputValue('#pass-input');
  assert.equal(passVal, 'SecretKey999!');

  await browser.close();
});

test('Test 9: Graceful fallback on non-existent or offscreen elements without throwing internal errors', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await VisualCursorManager.install(context, { enabled: true, headless: true });
  const page = await context.newPage();

  await page.setContent(`
    <!DOCTYPE html>
    <html>
      <body style="margin: 0; padding: 0;">
        <div style="width: 3000px; height: 3000px;">
          <button id="scroll-btn" style="margin-top: 1200px; margin-left: 800px; width: 100px; height: 30px;">Scrolled Target</button>
        </div>
        <button id="hidden-btn" style="display: none;">Hidden</button>
      </body>
    </html>
  `);

  // Direct handleLocatorAction on non-existent locator resolves cleanly without unhandled exceptions
  let nonExistentError = null;
  try {
    await VisualCursorManager.handleLocatorAction(page.locator('#does-not-exist'), 'click');
  } catch (err) {
    nonExistentError = err;
  }
  assert.equal(nonExistentError, null, 'Non-existent element must not crash action handler');

  // Offscreen element click scrolls and glides smoothly
  await page.locator('#scroll-btn').click();
  const scrollPos = await page.evaluate(() => window.__omniflowCursor.getPosition());
  assert.ok(scrollPos.x >= 700, `Expected X >= 700, got ${scrollPos.x}`);
  assert.ok(scrollPos.y >= 1000 || scrollPos.y >= 200, `Expected Y coordinate updated, got ${scrollPos.y}`);

  // Hidden element click falls back directly to Playwright's native error without overlay crashing
  let hiddenError = null;
  try {
    await page.locator('#hidden-btn').click({ timeout: 250 });
  } catch (err) {
    hiddenError = err;
  }
  assert.ok(hiddenError, 'Playwright should report element visibility');
  assert.ok(!hiddenError.message.includes('__omniflow'), 'Error must not originate from visual cursor overlay');

  await browser.close();
});

test('Test 10: BrowserManager integration with visualCursor options', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omniflow-visual-test-'));
  const userDataDir = path.join(tmpRoot, 'user-data');
  const manager = new BrowserManager({
    downloadDir: path.join(tmpRoot, 'downloads'),
    userDataDir,
    headless: true,
    visualCursor: true,
    cursorSpeed: 2.0,
  });

  try {
    const posPage = await manager.getPage('POS');
    await posPage.setContent(`<!DOCTYPE html><html><body><h2>POS Session</h2></body></html>`);

    const hasCursor = await posPage.evaluate(() => {
      return !!document.getElementById('___omniflow_cursor_root__') && typeof window.__omniflowCursor === 'object';
    });
    assert.equal(hasCursor, true, 'BrowserManager must install visual cursor on managed pages');

    await manager.closeAll();
  } finally {
    await manager.shutdown();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('Test 11: Interrupted in-flight glideTo immediately resolves previous promise without hanging', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await VisualCursorManager.install(context, { enabled: true, headless: true });
  const page = await context.newPage();
  await page.setContent('<!DOCTYPE html><html><body><div>Glide Test</div></body></html>');

  // Start a long glide (duration 1000ms)
  const result = await page.evaluate(async () => {
    let p1Resolved = false;
    const p1 = window.__omniflowCursor.glideTo(500, 500, { duration: 1000 }).then(() => {
      p1Resolved = true;
    });

    // Wait a short tick so animation frame loop starts
    await new Promise((r) => setTimeout(r, 40));

    // Interrupt with a second glide
    const p2 = window.__omniflowCursor.glideTo(200, 200, { duration: 0 });

    // Both should resolve quickly without waiting for the 1000ms duration
    const start = performance.now();
    await Promise.all([p1, p2]);
    const elapsed = performance.now() - start;

    const pos = window.__omniflowCursor.getPosition();
    return {
      p1Resolved,
      elapsed,
      pos,
    };
  });

  assert.equal(result.p1Resolved, true, 'Interrupted glide promise must resolve');
  assert.ok(result.elapsed < 500, `Interruption should resolve quickly, took ${result.elapsed}ms`);
  assert.deepEqual(result.pos, { x: 200, y: 200 }, 'Position should match second target');

  await browser.close();
});

test('Test 12: page.setContent() maintains single host with valid shadow DOM', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await VisualCursorManager.install(context, { enabled: true, headless: true });
  const page = await context.newPage();

  // Initial content
  await page.setContent('<!DOCTYPE html><html><body><div id="first">Initial</div></body></html>');

  // Replace content multiple times via setContent
  await page.setContent('<!DOCTYPE html><html><body><div id="second">Updated Once</div></body></html>');
  await page.setContent('<!DOCTYPE html><html><body><div id="third">Updated Twice</div></body></html>');

  const check = await page.evaluate(() => {
    const hosts = document.querySelectorAll('#___omniflow_cursor_root__');
    const firstHost = hosts[0];
    const shadow = firstHost ? firstHost.shadowRoot : null;
    const container = shadow ? shadow.getElementById('omniflow-cursor-container') : null;
    const badge = shadow ? shadow.getElementById('omniflow-status-badge') : null;

    return {
      hostCount: hosts.length,
      hasShadow: !!shadow,
      hasContainer: !!container,
      hasBadge: !!badge,
    };
  });

  assert.equal(check.hostCount, 1, 'Exactly one #___omniflow_cursor_root__ host must exist');
  assert.equal(check.hasShadow, true, 'Single host must have valid shadow DOM');
  assert.equal(check.hasContainer, true, 'Shadow DOM must contain cursor container');
  assert.equal(check.hasBadge, true, 'Shadow DOM must contain status badge');

  await browser.close();
});

test('Test 13: Fill action exception cleans up typing pulse and restores status badge', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await VisualCursorManager.install(context, { enabled: true, headless: true });
  const page = await context.newPage();

  // A readonly input causes locator.fill to reject
  await page.setContent(`<!DOCTYPE html><html><body><input id="readonly-input" readonly value="fixed" /></body></html>`);

  let fillError = null;
  try {
    await page.locator('#readonly-input').fill('new_value', { timeout: 300 });
  } catch (err) {
    fillError = err;
  }

  assert.ok(fillError, 'Playwright should throw error when filling readonly input');

  // Check that after error, typing-pulse is cleared and status badge is restored
  const overlayState = await page.evaluate(() => {
    const shadow = document.getElementById('___omniflow_cursor_root__').shadowRoot;
    const badge = shadow.getElementById('omniflow-status-badge');
    const frame = shadow.getElementById('omniflow-highlight-frame');
    return {
      hasPulse: badge ? badge.classList.contains('typing-pulse') : false,
      badgeText: badge ? badge.textContent.trim() : null,
      frameOpacity: frame ? frame.style.opacity : null,
    };
  });

  assert.equal(overlayState.hasPulse, false, 'typing-pulse class must be removed in finally block');
  assert.equal(overlayState.badgeText, '🤖OmniFlow Agent', 'Status badge must revert to OmniFlow Agent');
  assert.equal(overlayState.frameOpacity, '0', 'Highlight frame must be cleared in finally block');

  await browser.close();
});

test('Test 14: Post-click highlight frame auto-clears', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await VisualCursorManager.install(context, { enabled: true, headless: true });
  const page = await context.newPage();
  await page.setContent(`
    <!DOCTYPE html>
    <html><body>
      <button id="test-btn" style="width: 120px; height: 40px;">Click Me</button>
    </body></html>
  `);

  // Direct trigger or locator click
  await page.locator('#test-btn').click();

  // Immediately after click, highlight frame is visible and status is Click
  const immediate = await page.evaluate(() => {
    const shadow = document.getElementById('___omniflow_cursor_root__').shadowRoot;
    const frame = shadow.getElementById('omniflow-highlight-frame');
    const badge = shadow.getElementById('omniflow-status-badge');
    return {
      opacity: frame.style.opacity,
      status: badge.textContent.trim(),
    };
  });
  assert.equal(immediate.opacity, '1', 'Highlight frame must be visible immediately after click');
  assert.ok(immediate.status.includes('Click'), 'Status badge must show click immediately');

  // Wait 700ms for the 600ms auto-clear timeout to fire
  await page.waitForTimeout(700);

  const afterTimeout = await page.evaluate(() => {
    const shadow = document.getElementById('___omniflow_cursor_root__').shadowRoot;
    const frame = shadow.getElementById('omniflow-highlight-frame');
    const badge = shadow.getElementById('omniflow-status-badge');
    return {
      opacity: frame.style.opacity,
      status: badge.textContent.trim(),
    };
  });

  assert.equal(afterTimeout.opacity, '0', 'Highlight frame must auto-clear after 600ms');
  assert.equal(afterTimeout.status, '🤖OmniFlow Agent', 'Status badge must restore to OmniFlow Agent after 600ms');

  await browser.close();
});

test('Test 15: Expanded password heuristics detect name="pwd" and autocomplete="current-password"', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await VisualCursorManager.install(context, { enabled: true, headless: true });
  const page = await context.newPage();

  await page.setContent(`
    <!DOCTYPE html>
    <html><body>
      <input id="input-pwd" name="pwd" type="text" />
      <input id="input-auto" autocomplete="current-password" type="text" />
      <input id="input-pin" name="user_pin" aria-label="Enter PIN" type="text" />
      <input id="input-normal" name="username" type="text" />
    </body></html>
  `);

  // Hook showTypingBadge on page to capture the (text, isPassword) arguments
  await page.evaluate(() => {
    window.__capturedTypingCalls = [];
    const orig = window.__omniflowCursor.showTypingBadge;
    window.__omniflowCursor.showTypingBadge = function (text, isPassword) {
      window.__capturedTypingCalls.push({ text, isPassword: !!isPassword });
      return orig.apply(this, arguments);
    };
  });

  // Fill name="pwd"
  await page.locator('#input-pwd').fill('SuperSecret1');
  // Fill autocomplete="current-password"
  await page.locator('#input-auto').fill('SuperSecret2');
  // Fill input with pin in aria-label
  await page.locator('#input-pin').fill('4321');
  // Fill normal username
  await page.locator('#input-normal').fill('regular_user');

  const calls = await page.evaluate(() => window.__capturedTypingCalls);

  assert.equal(calls.length, 4, 'All four fill calls must be captured');
  assert.equal(calls[0].isPassword, true, 'name="pwd" must be detected as password');
  assert.equal(calls[1].isPassword, true, 'autocomplete="current-password" must be detected as password');
  assert.equal(calls[2].isPassword, true, 'aria-label containing "pin" must be detected as password');
  assert.equal(calls[3].isPassword, false, 'name="username" must NOT be detected as password');

  await browser.close();
});
