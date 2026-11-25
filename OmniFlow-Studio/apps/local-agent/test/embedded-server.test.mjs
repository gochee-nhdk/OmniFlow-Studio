import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { WebSocket } from 'ws';
import { FMDatabase } from '@fm/database';
import { AgentEmbeddedServer } from '../dist/main/ipc/embedded-server.js';

test('Embedded Agent Server in apps/local-agent Integration Suite', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniflow-embedded-test-'));
  const dbPath = path.join(tmpDir, 'embedded-test.sqlite');
  const db = new FMDatabase(dbPath);
  const testPort = 7799;
  const testHost = '127.0.0.1';

  let broadcastReceived = null;
  const server = new AgentEmbeddedServer({
    port: testPort,
    host: testHost,
    db,
    mode: 'electron',
    onBroadcast: (channel, data) => {
      broadcastReceived = { channel, data };
    },
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

  await t.test('1. GET /health in electron mode', async () => {
    const res = await makeRequest('GET', '/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
    assert.equal(res.body.mode, 'electron');
  });

  await t.test('2. WebSocket connection and bidirectional event dispatch', async () => {
    const ws = new WebSocket(`ws://${testHost}:${testPort}/ws`);
    const received = [];

    ws.on('message', (raw) => {
      received.push(JSON.parse(raw.toString('utf8')));
    });

    await new Promise((resolve) => ws.on('open', resolve));

    // Wait a brief moment to ensure welcome received
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(received.some((m) => m.channel === 'agent:status'));

    // Test broadcast
    server.broadcast('workflow:progress', {
      runId: 'embed-run-1',
      stepName: 'Embedded Step Progress',
      status: 'RUNNING',
      index: 1,
    });

    assert.ok(broadcastReceived);
    assert.equal(broadcastReceived.channel, 'workflow:progress');

    await new Promise((r) => setTimeout(r, 50));
    assert.ok(received.some((m) => m.channel === 'workflow:progress' && m.data.stepName === 'Embedded Step Progress'));

    await new Promise((resolve) => {
      ws.on('close', resolve);
      ws.close();
    });
  });

  await t.test('3. Stop server cleanly', async () => {
    await server.stop();
    db.close();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });
});
