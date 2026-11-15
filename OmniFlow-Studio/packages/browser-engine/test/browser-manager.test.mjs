import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BrowserManager } from '../dist/index.js';

test('BrowserManager uses a dedicated persistent profile and distinct POS/SAP tabs by default', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omniflow-browser-manager-'));
  const userDataDir = path.join(root, 'user-data');
  const manager = new BrowserManager({
    downloadDir: path.join(root, 'downloads'),
    userDataDir,
    headless: true,
  });

  try {
    const posPage = await manager.getPage('POS');
    const sapPage = await manager.getPage('SAP');

    assert.equal(manager.getSessionMode(), 'dedicated');
    assert.notEqual(posPage, sapPage);
    await posPage.setContent('<title>POS session</title>');
    await sapPage.setContent('<title>SAP session</title>');
    assert.equal(await posPage.title(), 'POS session');
    assert.equal(await sapPage.title(), 'SAP session');
    assert.ok(fs.existsSync(path.join(userDataDir, 'browser-profiles', 'omniflow-workspace')));

    await manager.closeAll();
    const nextPosPage = await manager.getPage('POS');
    assert.equal(manager.getSessionMode(), 'dedicated');
    assert.equal(nextPosPage.isClosed(), false);
  } finally {
    await manager.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
