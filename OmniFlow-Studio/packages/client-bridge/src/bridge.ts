// ============================================================
// FM AUTO OPS — Client Bridge Implementation
// ============================================================

import {
  DEFAULT_AGENT_HTTP_URL,
  DEFAULT_AGENT_WS_URL,
  type IPCChannel,
  type BridgeConnectionState,
  type HealthResponse,
  type RPCMessage,
  type RPCRequest,
  type RPCResponse,
  type RPCEvent,
} from '@fm/shared-types';

import type {
  ClientBridgeOptions,
  BridgeEventListener,
  BridgeStateListener,
  PendingRequest,
} from './types.js';

export class ClientBridge {
  private readonly wsUrl: string;
  private readonly httpUrl: string;
  private readonly requestTimeoutMs: number;
  private readonly reconnectIntervalMs: number;
  private readonly maxReconnectIntervalMs: number;
  private readonly pingIntervalMs: number;
  private readonly preferElectronIpc: boolean;
  private readonly webSocketFactory?: (url: string) => any;
  private readonly fetchFn: typeof fetch;

  private ws: any = null;
  private state: BridgeConnectionState = {
    mode: 'mock-disconnected',
    isConnected: false,
    isReconnecting: false,
    reconnectAttempts: 0,
  };

  private pendingRequests = new Map<string, PendingRequest<any>>();
  private listeners = new Map<string, Set<BridgeEventListener<any>>>();
  private stateListeners = new Set<BridgeStateListener>();

  private reconnectTimer: any = null;
  private pingTimer: any = null;
  private isDisposed = false;
  private electronUnsubscribers: Array<() => void> = [];

  constructor(options: ClientBridgeOptions = {}) {
    this.wsUrl = options.wsUrl || DEFAULT_AGENT_WS_URL;
    this.httpUrl = options.httpUrl || DEFAULT_AGENT_HTTP_URL;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30000;
    this.reconnectIntervalMs = options.reconnectIntervalMs ?? 1500;
    this.maxReconnectIntervalMs = options.maxReconnectIntervalMs ?? 10000;
    this.pingIntervalMs = options.pingIntervalMs ?? 15000;
    this.preferElectronIpc = options.preferElectronIpc ?? true;
    this.webSocketFactory = options.webSocketFactory;
    this.fetchFn = options.fetchFn || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : (null as any));

    this.initMode();

    if (options.autoConnect !== false) {
      this.connect().catch(() => {
        // Background connection attempts will continue through reconnect logic
      });
    }
  }

  // ----------------------------------------------------------
  // Mode Detection & Connection State
  // ----------------------------------------------------------

  public isElectron(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof window.fmAgent !== 'undefined' &&
      typeof window.fmAgent.invoke === 'function'
    );
  }

  public isOnline(): boolean {
    return this.state.isConnected;
  }

  public getState(): BridgeConnectionState {
    return { ...this.state };
  }

  private initMode(): void {
    if (this.preferElectronIpc && this.isElectron()) {
      this.updateState({
        mode: 'electron-ipc',
        isConnected: true,
        isReconnecting: false,
        reconnectAttempts: 0,
        url: 'electron://ipc',
        lastConnectedAt: Date.now(),
      });
      this.attachElectronEventListeners();
    } else {
      this.updateState({
        mode: 'websocket',
        isConnected: false,
        isReconnecting: false,
        reconnectAttempts: 0,
        url: this.wsUrl,
      });
    }
  }

  private updateState(partial: Partial<BridgeConnectionState>): void {
    const prevState = { ...this.state };
    this.state = { ...this.state, ...partial };
    
    // Notify listeners if state changed meaningfully
    if (
      prevState.isConnected !== this.state.isConnected ||
      prevState.mode !== this.state.mode ||
      prevState.isReconnecting !== this.state.isReconnecting ||
      prevState.error !== this.state.error
    ) {
      for (const listener of this.stateListeners) {
        try {
          listener(this.getState());
        } catch (err) {
          console.error('[ClientBridge] Error in state listener:', err);
        }
      }
      this.emit('connection:state', this.getState());
      if (this.state.isConnected && !prevState.isConnected) {
        this.emit('bridge:connected', { mode: this.state.mode, timestamp: Date.now() });
      } else if (!this.state.isConnected && prevState.isConnected) {
        this.emit('bridge:disconnected', { mode: this.state.mode, timestamp: Date.now() });
      }
    }
  }

  // ----------------------------------------------------------
  // Lifecycle & Connection Management
  // ----------------------------------------------------------

  public async connect(): Promise<void> {
    if (this.isDisposed) return;

    if (this.preferElectronIpc && this.isElectron()) {
      this.initMode();
      return;
    }

    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) {
      return; // Already connecting or connected
    }

    this.clearTimers();

    return new Promise<void>((resolve, reject) => {
      try {
        let ws: any;
        if (this.webSocketFactory) {
          try {
            ws = new (this.webSocketFactory as any)(this.wsUrl);
          } catch {
            ws = (this.webSocketFactory as any)(this.wsUrl);
          }
        } else if (typeof WebSocket !== 'undefined') {
          ws = new WebSocket(this.wsUrl);
        } else if ((globalThis as any).WebSocket) {
          ws = new (globalThis as any).WebSocket(this.wsUrl);
        } else {
          this.updateState({
            mode: 'rest-fallback',
            isConnected: false,
            error: 'WebSocket is not supported in this environment.',
          });
          resolve();
          return;
        }

        this.ws = ws;

        let hasResolved = false;

        ws.onopen = () => {
          if (this.isDisposed || this.ws !== ws) return;

          this.updateState({
            mode: 'websocket',
            isConnected: true,
            isReconnecting: false,
            reconnectAttempts: 0,
            lastConnectedAt: Date.now(),
            error: undefined,
          });

          this.startHeartbeat();

          if (!hasResolved) {
            hasResolved = true;
            resolve();
          }
        };

        ws.onmessage = (event: any) => {
          this.handleMessage(event.data);
        };

        ws.onerror = (event: any) => {
          const errMsg = event?.message || 'WebSocket connection error';
          if (!this.state.isConnected) {
            this.updateState({ error: errMsg });
          }
        };

        ws.onclose = (event: any) => {
          this.handleClose(event?.code, event?.reason);
          if (!hasResolved) {
            hasResolved = true;
            // Don't reject the connect() promise outright to allow graceful fallback/retry
            resolve();
          }
        };
      } catch (err: any) {
        this.updateState({
          isConnected: false,
          error: err?.message || 'Failed to instantiate WebSocket',
        });
        this.scheduleReconnect();
        resolve();
      }
    });
  }

  public disconnect(): void {
    this.clearTimers();
    this.isDisposed = true;

    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.onmessage = null;
        this.ws.close();
      } catch {}
      this.ws = null;
    }

    for (const unsub of this.electronUnsubscribers) {
      try {
        unsub();
      } catch {}
    }
    this.electronUnsubscribers = [];

    // Reject all pending requests
    for (const [id, req] of this.pendingRequests.entries()) {
      clearTimeout(req.timer);
      req.reject(new Error('ClientBridge disconnected.'));
      this.pendingRequests.delete(id);
    }

    this.updateState({
      isConnected: false,
      isReconnecting: false,
    });
  }

  private handleClose(code?: number, reason?: string): void {
    if (this.isDisposed) return;

    this.ws = null;
    this.stopHeartbeat();

    this.updateState({
      isConnected: false,
      lastDisconnectedAt: Date.now(),
      error: reason ? `Closed (${code}): ${reason}` : `Closed (${code ?? 'unknown'})`,
    });

    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.isDisposed || this.isElectron()) return;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const attempts = this.state.reconnectAttempts + 1;
    // Exponential backoff with jitter
    const delay = Math.min(
      this.reconnectIntervalMs * Math.pow(1.5, Math.min(attempts - 1, 6)),
      this.maxReconnectIntervalMs
    ) + Math.floor(Math.random() * 300);

    this.updateState({
      isReconnecting: true,
      reconnectAttempts: attempts,
    });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isDisposed && !this.state.isConnected) {
        this.connect().catch(() => {});
      }
    }, delay);
    if (this.reconnectTimer?.unref) {
      this.reconnectTimer.unref();
    }
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === 1) {
        try {
          const ping: RPCMessage = {
            id: `ping_${Date.now()}`,
            type: 'ping',
            timestamp: Date.now(),
          };
          this.ws.send(JSON.stringify(ping));
        } catch {
          // Non-fatal
        }
      }
    }, this.pingIntervalMs);
    if (this.pingTimer?.unref) {
      this.pingTimer.unref();
    }
  }

  private stopHeartbeat(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  // ----------------------------------------------------------
  // Message Handling & Inbound Dispatch
  // ----------------------------------------------------------

  private handleMessage(raw: unknown): void {
    if (typeof raw !== 'string') {
      if (raw instanceof ArrayBuffer || (typeof Buffer !== 'undefined' && Buffer.isBuffer(raw))) {
        raw = new TextDecoder().decode(raw as any);
      } else {
        return;
      }
    }

    let message: any;
    try {
      message = JSON.parse(raw as string);
    } catch {
      return;
    }

    if (!message || typeof message !== 'object') return;

    // 1. Heartbeat pong
    if (message.type === 'pong' || message.action === 'pong') {
      return;
    }

    // 2. Heartbeat ping from server (respond with pong)
    if (message.type === 'ping') {
      if (this.ws && this.ws.readyState === 1) {
        try {
          this.ws.send(JSON.stringify({ type: 'pong', id: message.id, timestamp: Date.now() }));
        } catch {}
      }
      return;
    }

    // 3. RPC Response to a pending request
    const responseId = message.id;
    if (responseId && this.pendingRequests.has(responseId)) {
      const pending = this.pendingRequests.get(responseId)!;
      this.pendingRequests.delete(responseId);
      clearTimeout(pending.timer);

      // Check standard RPCResponse format or JSON-RPC format
      if (message.success === false || message.error) {
        const errMsg = typeof message.error === 'string'
          ? message.error
          : message.error?.message || 'RPC invocation failed';
        pending.reject(new Error(errMsg));
      } else {
        const resolvedData = message.data !== undefined ? message.data : message.result;
        pending.resolve(resolvedData);
      }
      return;
    }

    // 4. Server Broadcast Event
    // Can arrive as:
    // a) { type: 'event', channel: string, data: any }
    // b) { event: string, payload: any }
    // c) { channel: string, data: any }
    const channel = message.channel || message.event || message.action;
    const payload = message.data !== undefined ? message.data : (message.payload !== undefined ? message.payload : message);

    if (channel && typeof channel === 'string') {
      this.emit(channel, payload);
    }
  }

  // ----------------------------------------------------------
  // Electron Event Bridge Listener Setup
  // ----------------------------------------------------------

  private attachElectronEventListeners(): void {
    if (!this.isElectron()) return;

    const channels: string[] = [
      'workflow:progress',
      'workflow:status',
      'agent:status',
      'network:check',
    ];

    for (const ch of channels) {
      try {
        const unsub = window.fmAgent!.on(ch, (data: unknown) => {
          this.emit(ch, data);
        });
        if (typeof unsub === 'function') {
          this.electronUnsubscribers.push(unsub);
        }
      } catch (err) {
        console.warn(`[ClientBridge] Failed to register Electron listener for channel "${ch}":`, err);
      }
    }
  }

  // ----------------------------------------------------------
  // RPC Invocation with Multi-Transport Fallback
  // ----------------------------------------------------------

  /**
   * Invokes an RPC channel.
   * Execution priority:
   * 1. Electron IPC (if running inside Electron desktop app)
   * 2. WebSocket RPC (if WebSocket is connected)
   * 3. HTTP REST RPC fallback (/api/rpc or direct endpoint)
   */
  public async invoke<T = unknown>(channel: IPCChannel | string, payload?: unknown): Promise<T> {
    // 1. Electron IPC Transport
    if (this.preferElectronIpc && this.isElectron()) {
      try {
        const res = await window.fmAgent!.invoke<T>(channel, payload);
        if (!res.success) {
          throw new Error(res.error || `IPC channel '${channel}' returned error`);
        }
        return res.data as T;
      } catch (err: any) {
        throw new Error(err?.message || `IPC call failed on channel '${channel}'`);
      }
    }

    // 2. WebSocket Transport
    if (this.ws && this.ws.readyState === 1) {
      return this.invokeWebSocket<T>(channel, payload);
    }

    // 3. HTTP REST RPC Fallback
    try {
      return await this.invokeHttpRpc<T>(channel, payload);
    } catch (httpErr: any) {
      // If HTTP fails and WS is reconnecting, provide meaningful diagnostics
      if (this.state.isReconnecting) {
        throw new Error(
          `Agent Service is currently offline or restarting (${this.httpUrl}). Reconnect attempt #${this.state.reconnectAttempts}. (${httpErr.message})`
        );
      }
      throw httpErr;
    }
  }

  private invokeWebSocket<T>(channel: string, payload?: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      const timer = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`RPC timeout (${this.requestTimeoutMs}ms) on channel '${channel}'`));
        }
      }, this.requestTimeoutMs);

      this.pendingRequests.set(id, {
        id,
        channel,
        resolve,
        reject,
        timer,
        createdAt: Date.now(),
      });

      const request: RPCRequest = {
        id,
        type: 'request',
        channel,
        payload,
        timestamp: Date.now(),
      };

      try {
        this.ws.send(JSON.stringify(request));
      } catch (err: any) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(new Error(`Failed to transmit WebSocket message: ${err?.message}`));
      }
    });
  }

  private async invokeHttpRpc<T>(channel: string, payload?: unknown): Promise<T> {
    if (!this.fetchFn) {
      throw new Error('fetch is not available in this environment');
    }

    const url = `${this.httpUrl}/api/rpc`;
    const id = `http_req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller
      ? setTimeout(() => controller.abort(), this.requestTimeoutMs)
      : null;

    try {
      const response = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          id,
          type: 'request',
          channel,
          payload,
          timestamp: Date.now(),
        }),
        signal: controller?.signal,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status} on /api/rpc: ${errText || response.statusText}`);
      }

      const json = (await response.json()) as any;
      if (json && json.success === false) {
        throw new Error(json.error || `RPC error on channel '${channel}'`);
      }

      return (json.data !== undefined ? json.data : json) as T;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error(`HTTP RPC request timed out after ${this.requestTimeoutMs}ms`);
      }
      throw err;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  // ----------------------------------------------------------
  // Direct HTTP Helpers
  // ----------------------------------------------------------

  public async httpGet<T = unknown>(endpointPath: string): Promise<T> {
    if (!this.fetchFn) throw new Error('fetch is not available');
    const url = endpointPath.startsWith('http')
      ? endpointPath
      : `${this.httpUrl}${endpointPath.startsWith('/') ? '' : '/'}${endpointPath}`;

    const res = await this.fetchFn(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`GET ${endpointPath} failed: HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  public async httpPost<T = unknown>(endpointPath: string, body?: unknown): Promise<T> {
    if (!this.fetchFn) throw new Error('fetch is not available');
    const url = endpointPath.startsWith('http')
      ? endpointPath
      : `${this.httpUrl}${endpointPath.startsWith('/') ? '' : '/'}${endpointPath}`;

    const res = await this.fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      throw new Error(`POST ${endpointPath} failed: HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  public async checkHealth(): Promise<HealthResponse> {
    return this.httpGet<HealthResponse>('/api/health').catch(() =>
      this.httpGet<HealthResponse>('/health')
    );
  }

  // ----------------------------------------------------------
  // Event Subscription & Dispatching
  // ----------------------------------------------------------

  /**
   * Subscribes to events on a specific channel.
   * Special channel '*' receives all events.
   * Returns an unsubscribe function.
   */
  public on<T = unknown>(channel: string, listener: BridgeEventListener<T>): () => void {
    if (!this.listeners.has(channel)) {
      this.listeners.set(channel, new Set());
    }
    this.listeners.get(channel)!.add(listener);

    // Also register on Electron if in Electron and channel is not already registered
    if (this.isElectron() && !channel.startsWith('connection:') && !channel.startsWith('bridge:')) {
      try {
        const unsub = window.fmAgent!.on(channel, (data: unknown) => {
          this.emit(channel, data);
        });
        if (typeof unsub === 'function') {
          this.electronUnsubscribers.push(unsub);
        }
      } catch {}
    }

    return () => {
      this.off(channel, listener);
    };
  }

  public off<T = unknown>(channel: string, listener: BridgeEventListener<T>): void {
    const set = this.listeners.get(channel);
    if (set) {
      set.delete(listener);
      if (set.size === 0) {
        this.listeners.delete(channel);
      }
    }
  }

  public emit(channel: string, data: unknown): void {
    const specific = this.listeners.get(channel);
    if (specific) {
      for (const listener of specific) {
        try {
          listener(data);
        } catch (err) {
          console.error(`[ClientBridge] Listener error on channel '${channel}':`, err);
        }
      }
    }

    const wildcard = this.listeners.get('*');
    if (wildcard) {
      for (const listener of wildcard) {
        try {
          listener({ channel, data });
        } catch (err) {
          console.error(`[ClientBridge] Wildcard listener error:`, err);
        }
      }
    }
  }

  /**
   * Subscribes to connection state changes
   */
  public onStateChange(listener: BridgeStateListener): () => void {
    this.stateListeners.add(listener);
    // Immediately notify current state
    try {
      listener(this.getState());
    } catch {}

    return () => {
      this.stateListeners.delete(listener);
    };
  }
}
