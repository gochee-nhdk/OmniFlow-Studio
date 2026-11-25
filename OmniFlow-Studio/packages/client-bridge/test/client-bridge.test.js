import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  ClientBridge,
  getClientBridge,
  resetClientBridge,
  invoke,
  onEvent,
  triggerWorkflow,
  stopWorkflow,
  getAgentStatus,
  checkNetwork,
  getWorkflowHistory,
  getAppSettings,
  setAppSettings,
} from '../dist/index.js';

describe('ClientBridge Unit Tests', () => {
  afterEach(() => {
    resetClientBridge();
  });

  test('initializes with default options and correct state', () => {
    const bridge = new ClientBridge({ autoConnect: false });
    const state = bridge.getState();
    assert.strictEqual(typeof state.isConnected, 'boolean');
    assert.strictEqual(state.isReconnecting, false);
    assert.strictEqual(state.reconnectAttempts, 0);
  });

  test('detects electron mode when window.fmAgent is available', async () => {
    const originalWindow = globalThis.window;
    try {
      globalThis.window = {
        fmAgent: {
          invoke: async (channel, payload) => ({
            success: true,
            data: { channel, payload, handledBy: 'electron-mock' },
          }),
          on: (channel, listener) => () => {},
        },
      };

      const bridge = new ClientBridge({ autoConnect: false });
      assert.strictEqual(bridge.isElectron(), true);
      assert.strictEqual(bridge.getState().mode, 'electron-ipc');
      assert.strictEqual(bridge.isOnline(), true);

      const res = await bridge.invoke('agent:status');
      assert.deepStrictEqual(res, {
        channel: 'agent:status',
        payload: undefined,
        handledBy: 'electron-mock',
      });
    } finally {
      globalThis.window = originalWindow;
    }
  });

  test('dispatches incoming WebSocket messages to pending requests and event listeners', async () => {
    let sentMessages = [];
    class MockWebSocket {
      constructor(url) {
        this.url = url;
        this.readyState = 1; // OPEN
        setTimeout(() => {
          if (this.onopen) this.onopen({});
        }, 10);
      }
      send(data) {
        sentMessages.push(JSON.parse(data));
      }
      close() {
        this.readyState = 3;
        if (this.onclose) this.onclose({ code: 1000, reason: 'Normal closure' });
      }
    }

    const bridge = new ClientBridge({
      autoConnect: false,
      preferElectronIpc: false,
      webSocketFactory: (url) => new MockWebSocket(url),
    });

    await bridge.connect();
    assert.strictEqual(bridge.getState().isConnected, true);

    // Test event listening
    let receivedProgress = null;
    const unsub = bridge.on('workflow:progress', (data) => {
      receivedProgress = data;
    });

    // Simulate server broadcast event
    const ws = bridge.ws;
    ws.onmessage({
      data: JSON.stringify({
        type: 'event',
        channel: 'workflow:progress',
        data: { runId: 'run-123', status: 'RUNNING', stepName: 'STEP_1', index: 1 },
      }),
    });

    assert.deepStrictEqual(receivedProgress, {
      runId: 'run-123',
      status: 'RUNNING',
      stepName: 'STEP_1',
      index: 1,
    });

    unsub();

    // Test RPC invocation over mock WebSocket
    const invokePromise = bridge.invoke('settings:get');
    assert.strictEqual(sentMessages.length >= 1, true);
    const sentReq = sentMessages[sentMessages.length - 1];
    assert.strictEqual(sentReq.channel, 'settings:get');

    // Simulate server response
    ws.onmessage({
      data: JSON.stringify({
        id: sentReq.id,
        type: 'response',
        channel: 'settings:get',
        success: true,
        data: { theme: 'dark', language: 'vi' },
      }),
    });

    const settings = await invokePromise;
    assert.deepStrictEqual(settings, { theme: 'dark', language: 'vi' });

    bridge.disconnect();
  });

  test('falls back to HTTP RPC when WebSocket is unavailable', async () => {
    let fetchCalled = false;
    let requestBody = null;

    const mockFetch = async (url, options) => {
      fetchCalled = true;
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: requestBody.id,
          success: true,
          data: { result: 'from-http-fallback', channel: requestBody.channel },
        }),
      };
    };

    const bridge = new ClientBridge({
      autoConnect: false,
      preferElectronIpc: false,
      fetchFn: mockFetch,
    });

    const res = await bridge.invoke('workflow:history');
    assert.strictEqual(fetchCalled, true);
    assert.strictEqual(requestBody.channel, 'workflow:history');
    assert.deepStrictEqual(res, {
      result: 'from-http-fallback',
      channel: 'workflow:history',
    });
  });

  test('domain helper functions invoke corresponding channels', async () => {
    const invokedChannels = [];

    const mockFetch = async (url, options) => {
      const body = JSON.parse(options.body);
      invokedChannels.push({ channel: body.channel, payload: body.payload });
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { ok: true } }),
      };
    };

    const bridge = new ClientBridge({
      autoConnect: false,
      preferElectronIpc: false,
      fetchFn: mockFetch,
    });

    await triggerWorkflow('POS_AUTOMATION', { headless: true }, bridge);
    await stopWorkflow('run-456', bridge);
    await getAgentStatus(bridge);
    await checkNetwork({ sapHost: '10.0.0.1' }, bridge);
    await getWorkflowHistory(bridge);
    await getAppSettings(bridge);
    await setAppSettings({ general: { theme: 'dark' } }, bridge);

    assert.strictEqual(invokedChannels[0].channel, 'workflow:start');
    assert.strictEqual(invokedChannels[1].channel, 'workflow:stop');
    assert.strictEqual(invokedChannels[2].channel, 'agent:status');
    assert.strictEqual(invokedChannels[3].channel, 'network:check');
    assert.strictEqual(invokedChannels[4].channel, 'workflow:history');
    assert.strictEqual(invokedChannels[5].channel, 'settings:get');
    assert.strictEqual(invokedChannels[6].channel, 'settings:set');
  });

  test('notifies state change listeners on reconnect attempts', async () => {
    const stateTransitions = [];

    const bridge = new ClientBridge({
      autoConnect: false,
      preferElectronIpc: false,
      reconnectIntervalMs: 50,
      maxReconnectIntervalMs: 200,
      webSocketFactory: () => {
        throw new Error('Connection refused');
      },
    });

    const unsub = bridge.onStateChange((state) => {
      stateTransitions.push(state.isReconnecting);
    });

    await bridge.connect();
    assert.strictEqual(stateTransitions.length >= 1, true);

    unsub();
    bridge.disconnect();
  });
});
