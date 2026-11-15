import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { BrowserManager } from '../../packages/browser-engine/dist/index.js';
import { parseFilterValues } from '../../packages/pos-adapter/dist/index.js';
import { resolveNamingTemplate } from '../../packages/file-engine/dist/index.js';
import { FMDatabase } from '../../packages/database/dist/index.js';
import { SecureStorage } from '../../packages/security/dist/index.js';
const require = createRequire(new URL('../../packages/browser-engine/package.json', import.meta.url));
const { chromium } = require('playwright');

test('R10: an active CDP browser keeps its user page and receives separate POS and SAP tabs', async (t) => {
  const endpoint = process.env.OMNIFLOW_E2E_CDP_URL;
  if (!endpoint) {
    t.skip('Set OMNIFLOW_E2E_CDP_URL to a browser session you intend to test.');
    return;
  }
  const parsedEndpoint = new URL(endpoint);
  const port = Number(parsedEndpoint.port || 9222);
  const browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  const pagesBefore = context.pages().length;
  const userPage = await context.newPage();
  const manager = new BrowserManager({ downloadDir: path.join(os.tmpdir(), `omniflow-r10-${Date.now()}`), headless: true, allowCdpAttach: true, cdpPorts: [port] });

  try {
    const posPage = await manager.getPage('POS');
    const sapPage = await manager.getPage('SAP');
    assert.notEqual(posPage, userPage);
    assert.notEqual(sapPage, userPage);
    assert.notEqual(posPage, sapPage);
    assert.equal(context.pages().length, pagesBefore + 2);
    await manager.closeAll();
    assert.equal(userPage.isClosed(), false);
    assert.equal(browser.isConnected(), true);
  } finally {
    await manager.closeAll();
    await userPage.close();
  }
});

test('R10: store selection and report naming preserve all user inputs', () => {
  const stores = ['DC01', 'ST01', 'ST02'];
  assert.deepEqual(parseFilterValues(stores), stores);
  assert.deepEqual(parseFilterValues('DC01,ST01;ST02'), stores);
  const name = resolveNamingTemplate('{{orgCode}}_{{reportType}}_{{fromDate}}_{{toDate}}.xlsx', {
    orgCode: 'ACME_ERP', reportType: 'SALES', fromDate: '2026-11-01', toDate: '2026-11-10',
  });
  assert.equal(name, 'ACME_ERP_SALES_2026-11-01_2026-11-10.xlsx');
});

test('R10: SQLite error clearing and machine-specific credential keys work against real modules', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniflow-r10-db-'));
  const db = new FMDatabase(path.join(dir, 'integration.sqlite'));
  const originalKey = process.env.FM_OPS_MASTER_KEY;
  const dynamicKey = `r10-${process.pid}-${Date.now()}-machine-key`;
  try {
    db.logError({ errorType: 'DOWNLOAD_FAILED', severity: 'ERROR', message: 'integration error' });
    assert.equal(db.listErrors().length, 1);
    db.clearErrors();
    assert.equal(db.listErrors().length, 0);

    process.env.FM_OPS_MASTER_KEY = dynamicKey;
    const encrypted = SecureStorage.encrypt('credential-value');
    assert.equal(SecureStorage.decrypt(encrypted), 'credential-value');
    assert.throws(() => SecureStorage.decrypt(encrypted, 'FM_OPS_MASTER_KEY'));
  } finally {
    if (originalKey === undefined) delete process.env.FM_OPS_MASTER_KEY;
    else process.env.FM_OPS_MASTER_KEY = originalKey;
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
