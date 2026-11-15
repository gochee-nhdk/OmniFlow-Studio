// FM AUTO OPS — Empirical Challenge Test Suite for Mock Harnesses
// Targets: mock-dom.mjs, mock-page.mjs, mock-security.mjs
// Run command: node --test tests/e2e/harness-challenge.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
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

test.describe('CHALLENGE SUITE 1: mock-dom.mjs Selector Parsing & State Behavior', () => {

  test('CH-DOM-01: Attribute Selector with Comma Inside Quotes (False Positive/Negative)', () => {
    const doc = new MockDocument();
    const btn = doc.createElement('button');
    btn.setAttribute('title', 'Save, Close');
    doc.body.appendChild(btn);

    // Standard CSS / Playwright allows commas in attribute strings
    // matchSelector splits on comma naively at line 403: selector.includes(',')
    const matched = doc.querySelector('[title="Save, Close"]');
    assert.ok(matched !== null, 'Should match attribute with comma inside quotes: [title="Save, Close"]');
  });

  test('CH-DOM-02: Text Selector with Comma Inside Quotes :text("Hello, World")', () => {
    const doc = new MockDocument();
    const div = doc.createElement('div');
    div.textContent = 'Hello, World';
    doc.body.appendChild(div);

    const matched = doc.querySelector(':text("Hello, World")');
    assert.ok(matched !== null, 'Should match :text("Hello, World") despite internal comma');
  });

  test('CH-DOM-03: Attribute Selector with Parentheses [title="Company (Schema)"]', () => {
    const doc = new MockDocument();
    const opt = doc.createElement('option');
    opt.setAttribute('title', 'SBODEMOUS (SAP Demo US)');
    opt.value = 'SBODEMOUS';
    doc.body.appendChild(opt);

    const matched = doc.querySelector('option[title="SBODEMOUS (SAP Demo US)"]');
    assert.ok(matched !== null, 'Should match attribute containing parentheses inside quotes');
  });

  test('CH-DOM-04: Attribute Selector with Spaces Around Equal Sign [data-field = "slocId"]', () => {
    const doc = new MockDocument();
    const td = doc.createElement('td');
    td.setAttribute('data-field', 'slocId');
    doc.body.appendChild(td);

    // CSS specification allows whitespace around attr operator
    const matched = doc.querySelector('[data-field = "slocId"]');
    assert.ok(matched !== null, 'Should handle spaces around equals sign in attribute selector');
  });

  test('CH-DOM-05: Child Combinator (>) in Selectors', () => {
    const doc = new MockDocument();
    const table = doc.createElement('table');
    const tbody = doc.createElement('tbody');
    const tr = doc.createElement('tr');
    tr.className = 'target-row';
    tbody.appendChild(tr);
    table.appendChild(tbody);
    doc.body.appendChild(table);

    const matched = doc.querySelector('table > tbody > tr.target-row');
    assert.ok(matched !== null, 'Should support child combinator (>) in CSS selectors');
  });

  test('CH-DOM-06: Pseudo-selector :visible on Child of Hidden Ancestor (False Positive Visibility)', () => {
    const doc = new MockDocument();
    const modal = doc.createElement('div');
    modal.id = 'modal';
    modal.style.display = 'none'; // Parent is hidden!

    const btn = doc.createElement('button');
    btn.className = 'btn-confirm';
    // Button itself has no inline display none, but its parent is hidden
    modal.appendChild(btn);
    doc.body.appendChild(modal);

    // In CSS / Playwright, a child of a hidden element is NOT :visible
    const matched = doc.querySelector('.btn-confirm:visible');
    assert.equal(matched, null, 'Child of display:none container should NOT match :visible');
  });

  test('CH-DOM-07: Duplicate Elements in querySelectorAll("body")', () => {
    const doc = new MockDocument();
    const results = doc.querySelectorAll('body');
    // Lines 480 & 481 of mock-dom.mjs push body manually AND traverse root.children
    assert.equal(results.length, 1, `querySelectorAll("body") should return exactly 1 element, got ${results.length}`);
  });

  test('CH-DOM-08: Querying for Root Element (html)', () => {
    const doc = new MockDocument();
    const html = doc.querySelector('html');
    assert.ok(html !== null, 'doc.querySelector("html") should return the root HTML element');
  });

  test('CH-DOM-09: Unquoted :has-text() Selector Support', () => {
    const doc = new MockDocument();
    const btn = doc.createElement('button');
    btn.textContent = 'Submit Data';
    doc.body.appendChild(btn);

    // Playwright supports :has-text(Submit Data) without quotes
    const matched = doc.querySelector('button:has-text("Submit Data")');
    assert.ok(matched !== null, 'Quoted :has-text should match');

    const matchedUnquoted = doc.querySelector('button:has-text(Submit Data)');
    assert.ok(matchedUnquoted !== null, 'Unquoted :has-text(Submit Data) should match');
  });

  test('CH-DOM-10: Event Bubbling and stopPropagation() Fidelity', () => {
    const doc = new MockDocument();
    const parent = doc.createElement('div');
    const child = doc.createElement('button');
    parent.appendChild(child);
    doc.body.appendChild(parent);

    let parentFired = false;
    let childFired = false;

    parent.addEventListener('click', () => { parentFired = true; });
    child.addEventListener('click', (e) => {
      childFired = true;
      e.stopPropagation();
    });

    child.click();

    assert.equal(childFired, true, 'Child click listener must fire');
    assert.equal(parentFired, false, 'Parent click listener must NOT fire when stopPropagation is called');
  });

  test('CH-DOM-11: DevExtreme dxDateBox State Synchronization & Blur Reversion', () => {
    const { win, fromBox, fromInput } = createMockPOSSalesDocument();
    const inst = win.DevExpress.ui.dxDateBox.getInstance(fromBox);

    // Widget starts with Nov 14, 2026
    const initialDate = inst.option('value');
    assert.equal(initialDate.getFullYear(), 2026);

    // Simulate user typing into input without committing widget
    fromInput.value = '01/01/2025';
    // Trigger blur
    fromInput.blur();

    // DevExtreme blur handler reverts input if not committed
    assert.equal(fromInput.value, '14/11/2026', 'Uncommitted input must revert on blur');

    // Now properly commit date via widget API
    inst.option('value', new Date(2025, 0, 1));
    fromBox.__committed = true;
    fromInput.blur();
    assert.equal(fromInput.value, '01/01/2025', 'Committed widget date must persist after blur');
  });

  test('CH-DOM-12: DevExtreme dxDataGrid Multi-Column Filter Application', () => {
    const { win, gridContainer, tbody } = createMockPOSInventoryDocument({ initialRows: 6 });
    const gridInst = win.DevExpress.ui.dxDataGrid.getInstance(gridContainer);

    // Rows: i=0: SDC0101, ITEM-001; i=1: SDC0102, ITEM-002; i=2: SDC0101, ITEM-003; ...
    // Filter by slocId = ['SDC0101']
    gridInst.columnOption('slocId', 'filterValues', ['SDC0101']);
    gridInst.columnOption('slocId', 'filterType', 'include');

    const visibleRowsAfterSloc = tbody.children.filter(r => r.style.display !== 'none');
    assert.equal(visibleRowsAfterSloc.length, 3, 'Filter on SDC0101 should leave 3 visible rows');

    // Add filter on itemCode = ['ITEM-001']
    gridInst.columnOption('itemCode', 'filterValues', ['ITEM-001']);
    gridInst.columnOption('itemCode', 'filterType', 'include');

    const visibleRowsAfterBoth = tbody.children.filter(r => r.style.display !== 'none');
    assert.equal(visibleRowsAfterBoth.length, 1, 'Compound filter should leave exactly 1 row');
  });
});

test.describe('CHALLENGE SUITE 2: mock-page.mjs Playwright Emulation Fidelity', () => {

  test('CH-PAGE-01: selectOption with Non-Existent Option (False Positive Guard)', async () => {
    const doc = new MockDocument();
    const select = doc.createElement('select');
    const opt = doc.createElement('option');
    opt.value = 'VALID_OPT';
    opt.textContent = 'Valid Option';
    select.appendChild(opt);
    doc.body.appendChild(select);

    const page = new MockPage(doc);
    const loc = page.locator('select');

    // In real Playwright, selecting a non-existent option throws an error / timeout.
    // In mock-page.mjs lines 147-151, if matchedIndex === -1 it silently succeeds!
    let threw = false;
    try {
      await loc.selectOption('NON_EXISTENT_OPTION');
    } catch {
      threw = true;
    }
    assert.equal(threw, true, 'selectOption with invalid option must reject / throw, not silently succeed');
  });

  test('CH-PAGE-02: fill() on Disabled Element (False Positive Guard)', async () => {
    const doc = new MockDocument();
    const input = doc.createElement('input');
    input.disabled = true;
    doc.body.appendChild(input);

    const page = new MockPage(doc);
    let threw = false;
    try {
      await page.locator('input').fill('SECRET_VALUE');
    } catch {
      threw = true;
    }
    assert.equal(threw, true, 'fill() on disabled element must reject / throw error');
  });

  test('CH-PAGE-03: fill() on Hidden Element (display: none)', async () => {
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
    assert.equal(threw, true, 'fill() on hidden element must reject / throw error');
  });

  test('CH-PAGE-04: page.waitForTimeout Real vs Simulated Delay Fidelity', async () => {
    const page = new MockPage();
    const start = Date.now();
    await page.waitForTimeout(500);
    const elapsed = Date.now() - start;

    // Line 291 caps delay: Math.min(ms, 5)
    // Document whether test harness accelerates or respects timing
    assert.ok(elapsed < 50, `waitForTimeout(500) was accelerated to ${elapsed}ms for fast test execution`);
  });

  test('CH-PAGE-05: page.waitForSelector Timeout Cap (150ms Cap Analysis)', async () => {
    const doc = new MockDocument();
    const page = new MockPage(doc);

    const start = Date.now();
    let threw = false;
    try {
      await page.waitForSelector('.does-not-exist', { timeout: 2000 });
    } catch (e) {
      threw = true;
    }
    const elapsed = Date.now() - start;
    assert.equal(threw, true, 'waitForSelector must throw on non-existent selector');
    // Line 263 caps timeout to Math.min(rawTimeout, 150)
    assert.ok(elapsed <= 250, `waitForSelector bounded by fast timeout: took ${elapsed}ms`);
  });

  test('CH-PAGE-06: page.waitForResponse Rejection on Uninvoked Endpoint (False Positive Guard)', async () => {
    const page = new MockPage();
    let threw = false;
    try {
      await page.waitForResponse('http://unreachable-server.internal/api', { timeout: 100 });
    } catch {
      threw = true;
    }
    assert.equal(threw, true, 'waitForResponse must reject / timeout when endpoint never responds');
  });

  test('CH-PAGE-07: page.waitForEvent("download") Rejection When Untriggered (False Positive Guard)', async () => {
    const page = new MockPage();
    let threw = false;
    try {
      await page.waitForEvent('download', { timeout: 100 });
    } catch {
      threw = true;
    }
    assert.equal(threw, true, 'waitForEvent("download") must reject / timeout without event trigger');
  });

  test('CH-PAGE-08: MockDownload.saveAs File Writing & Directory Creation', async () => {
    const download = new MockDownload('test-report.xlsx', Buffer.from('XLSX_BINARY_STREAM_CONTENT'));
    const testDest = path.join(process.cwd(), 'Temp', 'challenge-test', 'out.xlsx');

    try {
      await download.saveAs(testDest);
      assert.ok(fs.existsSync(testDest), 'File must be written to disk');
      const content = fs.readFileSync(testDest, 'utf8');
      assert.equal(content, 'XLSX_BINARY_STREAM_CONTENT');
    } finally {
      if (fs.existsSync(testDest)) fs.unlinkSync(testDest);
      const dir = path.dirname(testDest);
      if (fs.existsSync(dir)) fs.rmdirSync(dir);
    }
  });

  test('CH-PAGE-09: page.evaluate String Expression Support', async () => {
    const page = new MockPage();
    const result = await page.evaluate('1 + 1');
    assert.equal(result, 2, 'evaluate with string expression evaluates and returns result');
  });
});

test.describe('CHALLENGE SUITE 3: mock-security.mjs Cryptographic & Oracle Fidelity', () => {

  test('CH-SEC-01: Authenticated AES-256-GCM Roundtrip with Master Key', () => {
    const plaintext = 'SBO_PASSWORD_COMPLEX_P@ssw0rd!_2026';
    const encrypted = MockSecurityOracle.encryptAES256GCM(plaintext);
    assert.ok(typeof encrypted === 'string');

    const parts = encrypted.split(':');
    assert.equal(parts.length, 3, 'Must have IV:AuthTag:Ciphertext');

    const decrypted = MockSecurityOracle.verifyAES256GCM(encrypted);
    assert.equal(decrypted, plaintext, 'Decrypted text must match plaintext exactly');
  });

  test('CH-SEC-02: Auth Tag Tampering Rejection (1-bit Modification)', () => {
    const plaintext = 'CRITICAL_FINANCIAL_PAYLOAD';
    const encrypted = MockSecurityOracle.encryptAES256GCM(plaintext);
    const parts = encrypted.split(':');

    // Tamper the Auth Tag (parts[1])
    const rawTag = Buffer.from(parts[1], 'base64');
    rawTag[0] ^= 0x01; // flip 1 bit in auth tag
    const tamperedPayload = `${parts[0]}:${rawTag.toString('base64')}:${parts[2]}`;

    assert.throws(() => {
      MockSecurityOracle.verifyAES256GCM(tamperedPayload);
    }, /Unsupported state or unable to authenticate data/, 'Tampered Auth Tag MUST throw authentication error');
  });

  test('CH-SEC-03: Ciphertext Tampering Rejection via tamperCiphertext()', () => {
    const plaintext = 'STORE_DAILY_SALES_TOTAL_999999';
    const encrypted = MockSecurityOracle.encryptAES256GCM(plaintext);
    const tampered = MockSecurityOracle.tamperCiphertext(encrypted);

    assert.throws(() => {
      MockSecurityOracle.verifyAES256GCM(tampered);
    }, /Unsupported state or unable to authenticate data/, 'Tampered Ciphertext MUST throw authentication error');
  });

  test('CH-SEC-04: IV Tampering Rejection (1-bit Modification)', () => {
    const plaintext = 'WAREHOUSE_SDC0101_AUTH';
    const encrypted = MockSecurityOracle.encryptAES256GCM(plaintext);
    const parts = encrypted.split(':');

    // Tamper the IV (parts[0])
    const rawIv = Buffer.from(parts[0], 'base64');
    rawIv[0] ^= 0x01; // flip 1 bit in IV
    const tamperedPayload = `${rawIv.toString('base64')}:${parts[1]}:${parts[2]}`;

    assert.throws(() => {
      MockSecurityOracle.verifyAES256GCM(tamperedPayload);
    }, /Unsupported state or unable to authenticate data/, 'Tampered IV MUST throw authentication error');
  });

  test('CH-SEC-05: Key Length and Derived Key Entropy Verification', () => {
    const key = MockSecurityOracle.deriveKey('FM_OPS_MASTER_KEY');
    assert.equal(key.length, 32, 'Derived key must be exactly 32 bytes (256 bits)');

    // Different passwords must produce different keys
    const key2 = MockSecurityOracle.deriveKey('FM_OPS_DIFFERENT_KEY');
    assert.notDeepEqual(key, key2, 'Different master keys must yield different derived keys');

    // Decryption with wrong password must be rejected
    const encrypted = MockSecurityOracle.encryptAES256GCM('SECRET', 'PASSWORD_A');
    assert.throws(() => {
      MockSecurityOracle.verifyAES256GCM(encrypted, 'PASSWORD_B');
    }, /Unsupported state or unable to authenticate data/, 'Decryption with wrong password must fail');
  });

  test('CH-SEC-06: IV Randomness & Collision Resistance over 50 Iterations', () => {
    const iterations = 50;
    const seenIVs = new Set();
    const seenCiphertexts = new Set();
    const plaintext = 'STATIC_REPEAT_PLAINTEXT_PAYLOAD';

    for (let i = 0; i < iterations; i++) {
      const encrypted = MockSecurityOracle.encryptAES256GCM(plaintext);
      const [ivB64, , cipherB64] = encrypted.split(':');

      assert.ok(!seenIVs.has(ivB64), `IV collision detected on iteration ${i}! IV: ${ivB64}`);
      assert.ok(!seenCiphertexts.has(cipherB64), `Ciphertext collision detected on iteration ${i}!`);

      seenIVs.add(ivB64);
      seenCiphertexts.add(cipherB64);
    }

    assert.equal(seenIVs.size, iterations, 'All 50 IVs must be strictly unique');
    assert.equal(seenCiphertexts.size, iterations, 'All 50 Ciphertexts must be strictly unique');
  });

  test('CH-SEC-07: Log Redactor Leak Detection on Tokens <= 3 Characters (Boundary Flaw Fixed)', () => {
    const mockRedactor = (input) => input; // Leaky redactor that does not scrub
    const sensitiveTokens = ['123', 'PIN', 'SBO'];

    const result = MockSecurityOracle.simulateLogRedactor(mockRedactor, 'User PIN is 123', sensitiveTokens);

    assert.equal(result.leakDetected, true, 'simulateLogRedactor must detect leaks of tokens <= 3 characters');
  });

  test('CH-SEC-08: Log Redactor Leak Detection on Normal Tokens (> 3 Characters)', () => {
    const leakyRedactor = (input) => input;
    const secureRedactor = (input) => input.replace('P@ssw0rd', '[REDACTED]');

    const leakyResult = MockSecurityOracle.simulateLogRedactor(leakyRedactor, 'log: P@ssw0rd used', ['P@ssw0rd']);
    assert.equal(leakyResult.leakDetected, true, 'Must detect leakage with leaky redactor');

    const secureResult = MockSecurityOracle.simulateLogRedactor(secureRedactor, 'log: P@ssw0rd used', ['P@ssw0rd']);
    assert.equal(secureResult.leakDetected, false, 'Must confirm no leakage with secure redactor');
  });
});
