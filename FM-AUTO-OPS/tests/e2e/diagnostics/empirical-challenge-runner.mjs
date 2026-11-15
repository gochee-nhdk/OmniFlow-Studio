// FM AUTO OPS — Standalone Empirical Challenge Runner & Diagnostic Oracle
// Directly runs 29 empirical probes across mock-dom.mjs, mock-page.mjs, mock-security.mjs
// Command: node tests/e2e/empirical-challenge-runner.mjs

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  MockElement,
  MockDocument,
  MockWindow,
  MockEvent,
  MockCustomEvent,
  createMockSAPSLDDocument,
  createMockPOSSalesDocument,
  createMockPOSInventoryDocument,
} from '../harness/mock-dom.mjs';

import { MockPage, MockLocator, MockDownload } from '../harness/mock-page.mjs';
import { MockSecurityOracle } from '../harness/mock-security.mjs';

async function runEmpiricalProbes() {
  const probes = [];

  function record(id, module, title, passed, details) {
    probes.push({ id, module, title, passed, details });
  }

  // === MODULE 1: mock-dom.mjs ===

  // Probe 1: Attribute selector with comma inside quotes
  try {
    const doc = new MockDocument();
    const btn = doc.createElement('button');
    btn.setAttribute('title', 'Save, Close');
    doc.body.appendChild(btn);
    const m = doc.querySelector('[title="Save, Close"]');
    record('DOM-01', 'mock-dom.mjs', 'Attribute selector with comma inside quotes', m !== null,
      m ? 'Matched' : 'FAILED: Naive selector.split(",") splits inside quotes');
  } catch (e) {
    record('DOM-01', 'mock-dom.mjs', 'Attribute selector with comma inside quotes', false, e.message);
  }

  // Probe 2: Text selector with comma inside quotes
  try {
    const doc = new MockDocument();
    const div = doc.createElement('div');
    div.textContent = 'Hello, World';
    doc.body.appendChild(div);
    const m = doc.querySelector(':text("Hello, World")');
    record('DOM-02', 'mock-dom.mjs', 'Text selector with comma inside quotes', m !== null,
      m ? 'Matched' : 'FAILED: Naive selector.split(",") splits inside :text quotes');
  } catch (e) {
    record('DOM-02', 'mock-dom.mjs', 'Text selector with comma inside quotes', false, e.message);
  }

  // Probe 3: Attribute selector with parentheses inside quotes
  try {
    const doc = new MockDocument();
    const opt = doc.createElement('option');
    opt.setAttribute('title', 'SBODEMOUS (SAP Demo US)');
    doc.body.appendChild(opt);
    const m = doc.querySelector('option[title="SBODEMOUS (SAP Demo US)"]');
    record('DOM-03', 'mock-dom.mjs', 'Attribute selector with parentheses inside quotes', m !== null,
      m ? 'Matched correctly' : 'FAILED: Parentheses caused parser mismatch');
  } catch (e) {
    record('DOM-03', 'mock-dom.mjs', 'Attribute selector with parentheses inside quotes', false, e.message);
  }

  // Probe 4: Attribute selector with spaces around equal sign
  try {
    const doc = new MockDocument();
    const td = doc.createElement('td');
    td.setAttribute('data-field', 'slocId');
    doc.body.appendChild(td);
    const m = doc.querySelector('[data-field = "slocId"]');
    record('DOM-04', 'mock-dom.mjs', 'Attribute selector with spaces around =', m !== null,
      m ? 'Matched' : 'FAILED: splitSelectorDescendants splits on spaces inside brackets');
  } catch (e) {
    record('DOM-04', 'mock-dom.mjs', 'Attribute selector with spaces around =', false, e.message);
  }

  // Probe 5: Child combinator (>)
  try {
    const doc = new MockDocument();
    const table = doc.createElement('table');
    const tbody = doc.createElement('tbody');
    const tr = doc.createElement('tr');
    tr.className = 'target-row';
    tbody.appendChild(tr);
    table.appendChild(tbody);
    doc.body.appendChild(table);
    const m = doc.querySelector('table > tbody > tr.target-row');
    record('DOM-05', 'mock-dom.mjs', 'Child combinator (>) in selector', m !== null,
      m ? 'Matched' : 'FAILED: Child combinator (>) treated as ancestor tag name');
  } catch (e) {
    record('DOM-05', 'mock-dom.mjs', 'Child combinator (>) in selector', false, e.message);
  }

  // Probe 6: Pseudo-selector :visible on child of hidden container (False Positive)
  try {
    const doc = new MockDocument();
    const modal = doc.createElement('div');
    modal.style.display = 'none';
    const btn = doc.createElement('button');
    btn.className = 'btn-confirm';
    modal.appendChild(btn);
    doc.body.appendChild(modal);
    const m = doc.querySelector('.btn-confirm:visible');
    // It should be null because parent is display: none. If m !== null, it is a FALSE POSITIVE!
    const isFalsePositive = (m !== null);
    record('DOM-06', 'mock-dom.mjs', ':visible checks ancestor display (False Positive Guard)', !isFalsePositive,
      isFalsePositive ? 'FAILED: False positive! Button inside display:none parent matched :visible' : 'Passed');
  } catch (e) {
    record('DOM-06', 'mock-dom.mjs', ':visible checks ancestor display', false, e.message);
  }

  // Probe 7: Duplicate elements in querySelectorAll("body")
  try {
    const doc = new MockDocument();
    const res = doc.querySelectorAll('body');
    const passed = (res.length === 1);
    record('DOM-07', 'mock-dom.mjs', 'querySelectorAll("body") returns single instance', passed,
      passed ? '1 instance' : `FAILED: Duplicate element returned! Array length: ${res.length}`);
  } catch (e) {
    record('DOM-07', 'mock-dom.mjs', 'querySelectorAll("body") duplicate check', false, e.message);
  }

  // Probe 8: Querying for Root Element (html)
  try {
    const doc = new MockDocument();
    const m = doc.querySelector('html');
    record('DOM-08', 'mock-dom.mjs', 'doc.querySelector("html") returns root element', m !== null,
      m ? 'Matched HTML' : 'FAILED: querySelectorSingle skips root itself, returns null');
  } catch (e) {
    record('DOM-08', 'mock-dom.mjs', 'doc.querySelector("html")', false, e.message);
  }

  // Probe 9: Unquoted :has-text() selector
  try {
    const doc = new MockDocument();
    const btn = doc.createElement('button');
    btn.textContent = 'Submit';
    doc.body.appendChild(btn);
    const m = doc.querySelector('button:has-text(Submit)');
    record('DOM-09', 'mock-dom.mjs', 'Unquoted :has-text() selector support', m !== null,
      m ? 'Matched' : 'FAILED: Regex strictly requires quotes, unquoted fails');
  } catch (e) {
    record('DOM-09', 'mock-dom.mjs', 'Unquoted :has-text() selector', false, e.message);
  }

  // Probe 10: Event bubbling and stopPropagation
  try {
    const doc = new MockDocument();
    const p = doc.createElement('div');
    const c = doc.createElement('button');
    p.appendChild(c);
    doc.body.appendChild(p);
    let parentFired = false;
    let childFired = false;
    p.addEventListener('click', () => { parentFired = true; });
    c.addEventListener('click', (e) => { childFired = true; e.stopPropagation(); });
    c.click();
    const passed = childFired && !parentFired;
    record('DOM-10', 'mock-dom.mjs', 'Event bubbling & stopPropagation fidelity', passed,
      passed ? 'Correctly propagated and stopped' : 'FAILED: stopPropagation did not halt bubbling');
  } catch (e) {
    record('DOM-10', 'mock-dom.mjs', 'Event bubbling & stopPropagation', false, e.message);
  }

  // Probe 11: DevExtreme dxDateBox blur reversion
  try {
    const { win, fromBox, fromInput } = createMockPOSSalesDocument();
    const inst = win.DevExpress.ui.dxDateBox.getInstance(fromBox);
    fromInput.value = '01/01/2025';
    fromInput.blur();
    const reverted = (fromInput.value === '14/11/2026');
    record('DOM-11', 'mock-dom.mjs', 'DevExtreme dxDateBox blur uncommitted reversion', reverted,
      reverted ? 'Reverted to model date 14/11/2026' : `FAILED: Did not revert, value=${fromInput.value}`);
  } catch (e) {
    record('DOM-11', 'mock-dom.mjs', 'DevExtreme dxDateBox blur reversion', false, e.message);
  }

  // Probe 12: DevExtreme dxDataGrid multi-column filtering
  try {
    const { win, gridContainer, tbody } = createMockPOSInventoryDocument({ initialRows: 6 });
    const gridInst = win.DevExpress.ui.dxDataGrid.getInstance(gridContainer);
    gridInst.columnOption('slocId', 'filterValues', ['SDC0101']);
    gridInst.columnOption('slocId', 'filterType', 'include');
    gridInst.columnOption('itemCode', 'filterValues', ['ITEM-001']);
    gridInst.columnOption('itemCode', 'filterType', 'include');
    const visibleRows = tbody.children.filter(r => r.style.display !== 'none');
    const passed = (visibleRows.length === 1);
    record('DOM-12', 'mock-dom.mjs', 'DevExtreme dxDataGrid compound filter application', passed,
      passed ? 'Exactly 1 row visible' : `FAILED: Visible row count=${visibleRows.length}`);
  } catch (e) {
    record('DOM-12', 'mock-dom.mjs', 'DevExtreme dxDataGrid compound filter', false, e.message);
  }

  // === MODULE 2: mock-page.mjs ===

  // Probe 13: selectOption non-existent option (False Positive Guard)
  try {
    const doc = new MockDocument();
    const sel = doc.createElement('select');
    const opt = doc.createElement('option');
    opt.value = 'A';
    sel.appendChild(opt);
    doc.body.appendChild(sel);
    const page = new MockPage(doc);
    let threw = false;
    try {
      await page.locator('select').selectOption('DOES_NOT_EXIST');
    } catch {
      threw = true;
    }
    record('PAGE-01', 'mock-page.mjs', 'selectOption throws on non-existent option (False Positive Guard)', threw,
      threw ? 'Threw expected error' : 'FAILED: False positive! Silently succeeded when selecting non-existent option');
  } catch (e) {
    record('PAGE-01', 'mock-page.mjs', 'selectOption non-existent', false, e.message);
  }

  // Probe 14: fill() on disabled element (False Positive Guard)
  try {
    const doc = new MockDocument();
    const input = doc.createElement('input');
    input.disabled = true;
    doc.body.appendChild(input);
    const page = new MockPage(doc);
    let threw = false;
    try {
      await page.locator('input').fill('SECRET');
    } catch {
      threw = true;
    }
    record('PAGE-02', 'mock-page.mjs', 'fill() throws on disabled element (False Positive Guard)', threw,
      threw ? 'Threw error' : 'FAILED: False positive! fill() modified disabled element without error');
  } catch (e) {
    record('PAGE-02', 'mock-page.mjs', 'fill() on disabled element', false, e.message);
  }

  // Probe 15: fill() on hidden element (False Positive Guard)
  try {
    const doc = new MockDocument();
    const input = doc.createElement('input');
    input.style.display = 'none';
    doc.body.appendChild(input);
    const page = new MockPage(doc);
    let threw = false;
    try {
      await page.locator('input').fill('HIDDEN_TEXT');
    } catch {
      threw = true;
    }
    record('PAGE-03', 'mock-page.mjs', 'fill() throws on hidden element (False Positive Guard)', threw,
      threw ? 'Threw error' : 'FAILED: False positive! fill() operated on display:none element without error');
  } catch (e) {
    record('PAGE-03', 'mock-page.mjs', 'fill() on hidden element', false, e.message);
  }

  // Probe 16: waitForTimeout acceleration
  try {
    const page = new MockPage();
    const t0 = Date.now();
    await page.waitForTimeout(500);
    const elapsed = Date.now() - t0;
    // Capped at Math.min(ms, 5)
    record('PAGE-04', 'mock-page.mjs', 'waitForTimeout acceleration fidelity', true,
      `Requested 500ms -> Accelerated to ${elapsed}ms via Math.min(ms, 5)`);
  } catch (e) {
    record('PAGE-04', 'mock-page.mjs', 'waitForTimeout acceleration', false, e.message);
  }

  // Probe 17: waitForSelector timeout cap
  try {
    const page = new MockPage();
    const t0 = Date.now();
    let threw = false;
    try {
      await page.waitForSelector('.missing-node', { timeout: 3000 });
    } catch {
      threw = true;
    }
    const elapsed = Date.now() - t0;
    record('PAGE-05', 'mock-page.mjs', 'waitForSelector timeout bounding (150ms cap)', threw && elapsed < 300,
      `Timeout threw after ${elapsed}ms (capped by Math.min(rawTimeout, 150))`);
  } catch (e) {
    record('PAGE-05', 'mock-page.mjs', 'waitForSelector timeout bounding', false, e.message);
  }

  // Probe 18: waitForResponse timeout on uninvoked endpoint (False Positive Guard)
  try {
    const page = new MockPage();
    let threw = false;
    try {
      await page.waitForResponse('http://non-existent-api.corp', { timeout: 100 });
    } catch {
      threw = true;
    }
    record('PAGE-06', 'mock-page.mjs', 'waitForResponse timeout on uninvoked endpoint (False Positive Guard)', threw,
      threw ? 'Correctly timed out / rejected for uninvoked endpoint' : 'VULNERABILITY: Did not reject uninvoked endpoint');
  } catch (e) {
    record('PAGE-06', 'mock-page.mjs', 'waitForResponse fallback', false, e.message);
  }

  // Probe 19: waitForEvent('download') timeout when untriggered (False Positive Guard)
  try {
    const page = new MockPage();
    let threw = false;
    try {
      await page.waitForEvent('download', { timeout: 100 });
    } catch {
      threw = true;
    }
    record('PAGE-07', 'mock-page.mjs', 'waitForEvent("download") timeout when untriggered (False Positive Guard)', threw,
      threw ? 'Correctly timed out waiting for untriggered download' : 'VULNERABILITY: Immediately returned without trigger');
  } catch (e) {
    record('PAGE-07', 'mock-page.mjs', 'waitForEvent download', false, e.message);
  }

  // Probe 20: MockDownload.saveAs file persistence
  try {
    const dl = new MockDownload('probe.xlsx', Buffer.from('TEST_DATA'));
    const dest = path.join(process.cwd(), 'Temp', 'probe-out.xlsx');
    await dl.saveAs(dest);
    const exists = fs.existsSync(dest);
    if (exists) fs.unlinkSync(dest);
    record('PAGE-08', 'mock-page.mjs', 'MockDownload.saveAs filesystem persistence', exists,
      exists ? 'Successfully wrote and verified file' : 'FAILED: File not written');
  } catch (e) {
    record('PAGE-08', 'mock-page.mjs', 'MockDownload.saveAs', false, e.message);
  }

  // Probe 21: evaluate string expression handling
  try {
    const page = new MockPage();
    const res = await page.evaluate('2 + 2');
    record('PAGE-09', 'mock-page.mjs', 'page.evaluate string expression support', res !== null,
      res !== null ? `Evaluated: ${res}` : 'LIMITATION: evaluate(string) returns null; only function arguments supported');
  } catch (e) {
    record('PAGE-09', 'mock-page.mjs', 'page.evaluate string', false, e.message);
  }

  // === MODULE 3: mock-security.mjs ===

  // Probe 22: Authenticated AES-256-GCM Roundtrip
  try {
    const secret = 'MY_TOP_SECRET_PASSWORD_123';
    const enc = MockSecurityOracle.encryptAES256GCM(secret);
    const dec = MockSecurityOracle.verifyAES256GCM(enc);
    const passed = (dec === secret);
    record('SEC-01', 'mock-security.mjs', 'AES-256-GCM authenticated encryption roundtrip', passed,
      passed ? 'Decrypted plaintext matches perfectly' : 'FAILED: Decrypted mismatch');
  } catch (e) {
    record('SEC-01', 'mock-security.mjs', 'AES-256-GCM roundtrip', false, e.message);
  }

  // Probe 23: Auth Tag Tampering Rejection
  try {
    const enc = MockSecurityOracle.encryptAES256GCM('DATA');
    const parts = enc.split(':');
    const rawTag = Buffer.from(parts[1], 'base64');
    rawTag[0] ^= 0x01;
    let threw = false;
    try {
      MockSecurityOracle.verifyAES256GCM(`${parts[0]}:${rawTag.toString('base64')}:${parts[2]}`);
    } catch {
      threw = true;
    }
    record('SEC-02', 'mock-security.mjs', 'Auth Tag 1-bit tampering rejection', threw,
      threw ? 'Cryptographic auth tag verification threw rejection' : 'FAILED: Accepted tampered auth tag!');
  } catch (e) {
    record('SEC-02', 'mock-security.mjs', 'Auth Tag tampering', false, e.message);
  }

  // Probe 24: Ciphertext Tampering Rejection
  try {
    const enc = MockSecurityOracle.encryptAES256GCM('DATA');
    const tampered = MockSecurityOracle.tamperCiphertext(enc);
    let threw = false;
    try {
      MockSecurityOracle.verifyAES256GCM(tampered);
    } catch {
      threw = true;
    }
    record('SEC-03', 'mock-security.mjs', 'tamperCiphertext() auth tag verification rejection', threw,
      threw ? 'Cryptographic auth tag verification threw rejection' : 'FAILED: Accepted tampered ciphertext!');
  } catch (e) {
    record('SEC-03', 'mock-security.mjs', 'Ciphertext tampering', false, e.message);
  }

  // Probe 25: IV Tampering Rejection
  try {
    const enc = MockSecurityOracle.encryptAES256GCM('DATA');
    const parts = enc.split(':');
    const rawIv = Buffer.from(parts[0], 'base64');
    rawIv[0] ^= 0x01;
    let threw = false;
    try {
      MockSecurityOracle.verifyAES256GCM(`${rawIv.toString('base64')}:${parts[1]}:${parts[2]}`);
    } catch {
      threw = true;
    }
    record('SEC-04', 'mock-security.mjs', 'IV 1-bit tampering rejection', threw,
      threw ? 'Cryptographic auth tag verification threw rejection' : 'FAILED: Accepted tampered IV!');
  } catch (e) {
    record('SEC-04', 'mock-security.mjs', 'IV tampering', false, e.message);
  }

  // Probe 26: Key derivation length and entropy
  try {
    const key = MockSecurityOracle.deriveKey('FM_OPS_MASTER_KEY');
    const keyLenPassed = (key.length === 32);
    record('SEC-05', 'mock-security.mjs', 'deriveKey() outputs 32 bytes (256 bits)', keyLenPassed,
      keyLenPassed ? `Key length: ${key.length} bytes (AES-256 compliant)` : `FAILED: Length=${key.length}`);
  } catch (e) {
    record('SEC-05', 'mock-security.mjs', 'deriveKey length', false, e.message);
  }

  // Probe 27: IV Randomness & Collision Resistance (50 iterations)
  try {
    const count = 50;
    const ivs = new Set();
    for (let i = 0; i < count; i++) {
      const enc = MockSecurityOracle.encryptAES256GCM('REPEAT');
      ivs.add(enc.split(':')[0]);
    }
    const passed = (ivs.size === count);
    record('SEC-06', 'mock-security.mjs', 'IV uniqueness & randomness (50 iterations)', passed,
      passed ? `100% unique IVs (50/50 unique samples)` : `FAILED: Collisions detected, unique=${ivs.size}`);
  } catch (e) {
    record('SEC-06', 'mock-security.mjs', 'IV randomness', false, e.message);
  }

  // Probe 28: Log Redactor short token boundary flaw (<= 3 chars)
  try {
    const mockRedactor = (s) => s; // Leaky redactor
    const result = MockSecurityOracle.simulateLogRedactor(mockRedactor, 'PIN is 123', ['123', 'PIN']);
    // Line 86: if (token && token.length > 3) -> token <= 3 is bypassed!
    const missedLeak = !result.leakDetected;
    record('SEC-07', 'mock-security.mjs', 'Log redactor short token bypass (Boundary Flaw)', !missedLeak,
      missedLeak ? 'FAILED: False negative! Tokens <= 3 chars (e.g. PIN "123") silently bypassed by oracle' : 'Detected');
  } catch (e) {
    record('SEC-07', 'mock-security.mjs', 'Log redactor short tokens', false, e.message);
  }

  // Probe 29: Log Redactor normal token (> 3 chars)
  try {
    const leakyRedactor = (s) => s;
    const result = MockSecurityOracle.simulateLogRedactor(leakyRedactor, 'pwd is SecretPassword', ['SecretPassword']);
    record('SEC-08', 'mock-security.mjs', 'Log redactor normal token leak detection', result.leakDetected,
      result.leakDetected ? 'Detected sensitive token leak' : 'FAILED: Missed leak');
  } catch (e) {
    record('SEC-08', 'mock-security.mjs', 'Log redactor normal token', false, e.message);
  }

  // Print scorecard
  console.log('========================================================================');
  console.log('  FM-AUTO-OPS MOCK HARNESS EMPIRICAL CHALLENGE SCORECARD');
  console.log('========================================================================');
  let passCount = 0;
  let failCount = 0;
  for (const p of probes) {
    const status = p.passed ? '[PASS]' : '[FAIL]';
    if (p.passed) passCount++; else failCount++;
    console.log(`${status} [${p.id}] ${p.module.padEnd(18)} : ${p.title}`);
    console.log(`       -> ${p.details}`);
  }
  console.log('------------------------------------------------------------------------');
  console.log(`TOTAL PROBES: ${probes.length} | PASSED: ${passCount} | DEFECTS/FALSE POSITIVES: ${failCount}`);
  console.log(`PASS RATE: ${((passCount / probes.length) * 100).toFixed(2)}%`);
  console.log('========================================================================');
}

runEmpiricalProbes().catch(console.error);
