import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { createRequire } from 'node:module';
import { BrowserManager } from '../../packages/browser-engine/dist/index.js';
import { parseFilterValues } from '../../packages/pos-adapter/dist/index.js';
import { resolveNamingTemplate } from '../../packages/file-engine/dist/index.js';
import { FMDatabase } from '../../packages/database/dist/index.js';
import { SecureStorage } from '../../packages/security/dist/index.js';

const require = createRequire(new URL('../../packages/browser-engine/package.json', import.meta.url));
const { chromium } = require('playwright');

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

test('R10: an isolated CDP browser keeps its user page and receives separate POS and SAP tabs', async () => {
  const port = await reservePort();
  const browser = await chromium.launch({ headless: true, args: [`--remote-debugging-port=${port}`] });
  const userContext = browser.contexts()[0] || await browser.newContext();
  const userPage = await userContext.newPage();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniflow-r10-'));
  const manager = new BrowserManager({ downloadDir: tmpDir, headless: true, allowCdpAttach: true, cdpPorts: [port] });

  try {
    const endpoint = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        const response = await fetch(`${endpoint}/json/version`);
        ready = response.ok;
        if (ready) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(ready, true, 'local Chromium must expose its CDP endpoint');

    const posPage = await manager.getPage('POS');
    const sapPage = await manager.getPage('SAP');
    assert.notEqual(posPage, userPage);
    assert.notEqual(sapPage, userPage);
    assert.notEqual(posPage, sapPage);
    assert.equal(userContext.pages().includes(userPage), true);
    await manager.closeAll();
    assert.equal(userPage.isClosed(), false, 'closeAll must leave the user page open');
  } finally {
    await manager.shutdown();
    assert.equal(userPage.isClosed(), false, 'shutdown must leave the user page open');
    await browser.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
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
    const encrypted = new SecureStorage().encrypt('credential-value');
    assert.equal(new SecureStorage().decrypt(encrypted), 'credential-value');
    assert.throws(() => SecureStorage.decrypt(encrypted, 'FM_OPS_MASTER_KEY'));
  } finally {
    if (originalKey === undefined) delete process.env.FM_OPS_MASTER_KEY;
    else process.env.FM_OPS_MASTER_KEY = originalKey;
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
