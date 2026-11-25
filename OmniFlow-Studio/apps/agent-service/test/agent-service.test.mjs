import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { WebSocket } from 'ws';
import { FMDatabase } from '@fm/database';
import { AgentServiceServer } from '../dist/index.js';

test('Standalone Agent Service & HTTP/WS Integration Suite', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniflow-service-test-'));
  const dbPath = path.join(tmpDir, 'test.sqlite');
  const db = new FMDatabase(dbPath);
  const testPort = 7789;
  const testHost = '127.0.0.1';

  const server = new AgentServiceServer({
    port: testPort,
    host: testHost,
    db,
  });

  await server.start();

  function makeRequest(method, urlPath, body = null) {
    return new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : null;
      const req = http.request(
        {
          host: testHost,
          port: testPort,
          path: urlPath,
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
            } catch {
              resolve({ status: res.statusCode, headers: res.headers, raw: data });
            }
          });
        }
      );
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  await t.test('1. GET /health returns valid status and CORS headers', async () => {
    const res = await makeRequest('GET', '/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
    assert.equal(res.body.mode, 'standalone');
    assert.equal(res.body.version, '1.0.0');
    assert.equal(res.headers['access-control-allow-origin'], '*');
  });

  await t.test('2. GET /api/agent/status returns agent status', async () => {
    const res = await makeRequest('GET', '/api/agent/status');
    assert.equal(res.status, 200);
    assert.equal(res.body.online, true);
    assert.equal(typeof res.body.uptime, 'number');
  });

  await t.test('3. Settings GET and POST roundtrip', async () => {
    const postRes = await makeRequest('POST', '/api/settings', {
      posUrl: 'http://172.16.1.200',
      sapUrl: 'https://172.16.1.210:8100/dispatcher/',
      testKey: 'testValue123',
    });
    assert.equal(postRes.status, 200);
    assert.equal(postRes.body.success, true);
    assert.equal(postRes.body.settings.testKey, 'testValue123');

    const getRes = await makeRequest('GET', '/api/settings');
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.testKey, 'testValue123');
  });

  await t.test('4. Enterprise Profile CRUD roundtrip', async () => {
    const saveRes = await makeRequest('POST', '/api/enterprise/save', {
      name: 'FM Test Profile',
      code: 'FM_TEST',
      erpType: 'SAP_B1',
      server: '172.16.1.210',
      companyName: 'Công ty TNHH Thương Mại LARIA (FM_PRO)',
    });
    assert.equal(saveRes.status, 200);
    assert.equal(saveRes.body.success, true);

    const listRes = await makeRequest('GET', '/api/enterprise/list');
    assert.equal(listRes.status, 200);
    assert.ok(listRes.body.profiles.length > 0);
    assert.equal(listRes.body.profiles[0].name, 'FM Test Profile');
  });

  await t.test('5. POST /api/network/check with mock probe', async () => {
    const res = await makeRequest('POST', '/api/network/check', {
      posHost: 'http://localhost.mock',
      sapHost: 'https://localhost.mock:8100',
    });
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.sap, 'boolean');
    assert.equal(typeof res.body.pos, 'boolean');
    assert.ok(Array.isArray(res.body.results));
  });

  await t.test('6. WebSocket Connection, Greeting, Ping/Pong, and RPC', async () => {
    const ws = new WebSocket(`ws://${testHost}:${testPort}/ws`);
    const received = [];
    const waiters = [];

    ws.on('message', (raw) => {
      const parsed = JSON.parse(raw.toString('utf8'));
      received.push(parsed);
      while (waiters.length > 0) {
        const waiter = waiters.shift();
        waiter();
      }
    });

    const waitForMessage = (predicate, timeoutMs = 3000) => {
      return new Promise((resolve, reject) => {
        const check = () => {
          const idx = received.findIndex(predicate);
          if (idx >= 0) {
            const item = received.splice(idx, 1)[0];
            return resolve(item);
          }
        };
        check();
        const timer = setTimeout(() => {
          reject(new Error(`Timeout waiting for message matching predicate after ${timeoutMs}ms. Received: ${JSON.stringify(received)}`));
        }, timeoutMs);

        waiters.push(() => {
          const idx = received.findIndex(predicate);
          if (idx >= 0) {
            clearTimeout(timer);
            const item = received.splice(idx, 1)[0];
            resolve(item);
          }
        });
      });
    };

    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    // 6a. Verify initial agent:status event
    const initialMsg = await waitForMessage((m) => m.channel === 'agent:status');
    assert.equal(initialMsg.type, 'event');
    assert.equal(initialMsg.data.online, true);

    // 6b. Ping / Pong
    ws.send(JSON.stringify({ id: 'ping-1', type: 'ping' }));
    const pongMsg = await waitForMessage((m) => m.type === 'pong' && m.id === 'ping-1');
    assert.equal(pongMsg.type, 'pong');

    // 6c. RPC channel dispatch: settings:get
    ws.send(JSON.stringify({ id: 'rpc-1', channel: 'settings:get' }));
    const rpcMsg = await waitForMessage((m) => m.id === 'rpc-1');
    assert.equal(rpcMsg.success, true);
    assert.equal(rpcMsg.data.testKey, 'testValue123');

    // 6d. Broadcast event check
    server.broadcast('workflow:progress', {
      runId: 'run-test-123',
      stepName: 'Test Broadcast Step',
      status: 'RUNNING',
      index: 1,
    });

    const broadcastMsg = await waitForMessage((m) => m.channel === 'workflow:progress');
    assert.equal(broadcastMsg.data.stepName, 'Test Broadcast Step');

    await new Promise((resolve) => {
      ws.on('close', resolve);
      ws.close();
    });
  });

  await t.test('7. Cleanup and clean shutdown', async () => {
    await server.stop();
    db.close();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });
});
