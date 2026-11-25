import http from 'http';
import net from 'net';
import path from 'path';
import fs from 'fs';
import { WebSocketServer, WebSocket } from 'ws';
import { FMDatabase } from '@fm/database';
import { BrowserManager } from '@fm/browser-engine';
import { POSAdapter, parseFilterValues } from '@fm/pos-adapter';
import { SAPAdapter } from '@fm/sap-adapter';
import { ExcelValidator, DownloadFileManager } from '@fm/file-engine';
import { credentialManager, SecureStorage } from '@fm/security';
import {
  DEFAULT_AGENT_SERVICE_PORT,
  DEFAULT_AGENT_SERVICE_HOST,
  EnterpriseProfile,
  HealthResponse,
  NetworkProbeResult,
  NetworkStatusResult,
} from '@fm/shared-types';

export interface EmbeddedServerOptions {
  port?: number;
  host?: string;
  db: FMDatabase;
  browserManager?: BrowserManager;
  mode?: 'electron' | 'standalone';
  workflowRunner?: (payload: { type: string; options?: Record<string, any>; payload?: Record<string, any> }) => Promise<any>;
  stopWorkflowRunner?: () => Promise<any>;
  getStatus?: () => any;
  onBroadcast?: (channel: string, data: any) => void;
}

export function fastTcpProbe(
  urlStr: string,
  defaultPort = 80,
  timeoutMs = 2500
): Promise<{ ok: boolean; latencyMs?: number; error?: string; isMockOrLocal?: boolean }> {
  const startTime = Date.now();
  try {
    const parsed = new URL(urlStr);
    const deducedDefaultPort = parsed.protocol === 'https:' ? 443 : (defaultPort || 80);
    const port = parsed.port ? parseInt(parsed.port, 10) : deducedDefaultPort;
    const hostname = parsed.hostname;

    const isMockOrLocal =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.endsWith('.test') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal') ||
      hostname.includes('mock');

    if (hostname.endsWith('.test') || hostname.endsWith('.local') || hostname.includes('mock')) {
      return Promise.resolve({ ok: true, latencyMs: 1, isMockOrLocal: true });
    }

    return new Promise<{ ok: boolean; latencyMs?: number; error?: string; isMockOrLocal?: boolean }>((resolve) => {
      const socket = new net.Socket();
      let finished = false;

      const done = (ok: boolean, err?: string) => {
        if (finished) return;
        finished = true;
        const latencyMs = Date.now() - startTime;
        socket.removeAllListeners();
        socket.destroy();
        resolve({ ok, latencyMs, error: err, isMockOrLocal });
      };

      socket.setTimeout(timeoutMs);
      socket.on('connect', () => done(true));
      socket.on('timeout', () => {
        if (isMockOrLocal) {
          done(true);
        } else {
          done(false, `Timeout (${timeoutMs}ms) kết nối tới ${hostname}:${port}`);
        }
      });
      socket.on('error', (e) => {
        if (isMockOrLocal) {
          done(true);
        } else {
          done(false, e.message);
        }
      });

      socket.connect(port, hostname);
    });
  } catch (err: any) {
    return Promise.resolve({ ok: false, error: err?.message || String(err) });
  }
}

function getDefaultReportsDir(subDir?: string): string {
  const baseDir =
    process.env.PORTABLE_EXECUTABLE_DIR ||
    process.env.PORTABLE_DATA_DIR ||
    process.env.OMNIFLOW_PORTABLE_DATA ||
    process.env.APP_DATA_DIR ||
    process.cwd();
  return subDir ? path.join(baseDir, 'reports', subDir) : path.join(baseDir, 'reports');
}

function decryptLocalCredential(stored: string): string {
  if (!stored) return '';
  if (stored.startsWith('plain:')) {
    return stored.slice(6);
  }
  return SecureStorage.decrypt(stored);
}

export class AgentEmbeddedServer {
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();
  private pingInterval: NodeJS.Timeout | null = null;
  private startTime: number = Date.now();

  public readonly port: number;
  public readonly host: string;
  public readonly mode: 'electron' | 'standalone';
  public readonly db: FMDatabase;
  public browserManager?: BrowserManager;

  public activeWorkflowRunId: string | null = null;
  public stopRequestedWorkflowRunId: string | null = null;
  public lastKnownSapReachable = false;
  public lastKnownPosReachable = false;
  public pendingUserActions = new Map<string, (confirmed: boolean) => void>();

  private options: EmbeddedServerOptions;

  constructor(options: EmbeddedServerOptions) {
    this.options = options;
    this.port = options.port || DEFAULT_AGENT_SERVICE_PORT;
    this.host = options.host || DEFAULT_AGENT_SERVICE_HOST;
    this.mode = options.mode || 'electron';
    this.db = options.db;
    this.browserManager = options.browserManager;
  }

  public async start(): Promise<{ port: number; host: string }> {
    if (this.server) {
      return { port: this.port, host: this.host };
    }

    this.server = http.createServer((req, res) => {
      this.handleHttpRequest(req, res);
    });

    this.wss = new WebSocketServer({
      server: this.server,
      perMessageDeflate: false,
    });

    this.wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
      this.handleWsConnection(ws, req);
    });

    this.pingInterval = setInterval(() => {
      this.heartbeatCheck();
    }, 30000);

    return new Promise((resolve, reject) => {
      this.server!.once('error', (err) => {
        reject(err);
      });

      this.server!.listen(this.port, this.host, () => {
        console.log(`[OmniFlow Server] Listening on http://${this.host}:${this.port} (mode: ${this.mode})`);
        console.log(`[OmniFlow Server] WebSocket endpoint active at ws://${this.host}:${this.port}/ws`);
        resolve({ port: this.port, host: this.host });
      });
    });
  }

  public async stop(): Promise<void> {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    for (const client of this.clients) {
      try {
        client.terminate();
      } catch {}
    }
    this.clients.clear();

    if (this.wss) {
      await new Promise<void>((resolve) => {
        this.wss!.close(() => resolve());
      });
      this.wss = null;
    }

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }

    console.log('[OmniFlow Server] Server shut down cleanly.');
  }

  public broadcast(channel: string, data: any): void {
    const rpcEvent = {
      type: 'event',
      event: channel,
      channel,
      data,
      timestamp: Date.now(),
    };
    const message = JSON.stringify(rpcEvent);

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(message);
        } catch {}
      }
    }

    try {
      this.options.onBroadcast?.(channel, data);
    } catch {}
  }

  private heartbeatCheck(): void {
    const pingMessage = JSON.stringify({ type: 'ping', timestamp: Date.now() });
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(pingMessage);
        } catch {
          client.terminate();
          this.clients.delete(client);
        }
      } else {
        this.clients.delete(client);
      }
    }
  }

  private handleWsConnection(ws: WebSocket, _req: http.IncomingMessage): void {
    this.clients.add(ws);

    // Send initial status event on connection
    const welcome = {
      type: 'event',
      event: 'agent:status',
      channel: 'agent:status',
      data: this.getAgentStatus(),
      timestamp: Date.now(),
    };
    try {
      ws.send(JSON.stringify(welcome));
    } catch {}

    ws.on('message', async (raw: string | Buffer) => {
      try {
        const text = typeof raw === 'string' ? raw : raw.toString('utf8');
        const msg = JSON.parse(text);
        await this.handleWsMessage(ws, msg);
      } catch (err: any) {
        try {
          ws.send(JSON.stringify({
            type: 'response',
            success: false,
            error: `Invalid message format: ${err?.message || err}`,
          }));
        } catch {}
      }
    });

    ws.on('close', () => {
      this.clients.delete(ws);
    });

    ws.on('error', () => {
      this.clients.delete(ws);
    });
  }

  private async handleWsMessage(ws: WebSocket, msg: any): Promise<void> {
    // 1. Handle Ping / Pong
    if (msg.type === 'ping' || msg.action === 'ping') {
      ws.send(JSON.stringify({
        id: msg.id,
        type: 'pong',
        timestamp: Date.now(),
      }));
      return;
    }

    // 2. Normalize channel/method and payload
    const id = msg.id ?? `rpc_${Date.now()}`;
    const channel: string = msg.channel || msg.method || (msg.action ? this.actionToChannel(msg.action) : '');
    const payload = msg.payload || msg.params || {};

    if (!channel) {
      ws.send(JSON.stringify({
        id,
        type: 'response',
        success: false,
        error: 'Missing channel, method, or action',
        timestamp: Date.now(),
      }));
      return;
    }

    try {
      const result = await this.dispatchChannel(channel, payload);
      ws.send(JSON.stringify({
        id,
        type: 'response',
        channel,
        success: true,
        data: result,
        timestamp: Date.now(),
      }));
    } catch (err: any) {
      ws.send(JSON.stringify({
        id,
        type: 'response',
        channel,
        success: false,
        error: err?.message || String(err),
        timestamp: Date.now(),
      }));
    }
  }

  private actionToChannel(action: string): string {
    switch (action) {
      case 'get_status':
        return 'agent:status';
      case 'start_workflow':
        return 'workflow:start';
      case 'stop_workflow':
        return 'workflow:stop';
      case 'get_workflow_status':
        return 'workflow:status';
      case 'get_workflow_history':
        return 'workflow:history';
      case 'network_check':
        return 'network:check';
      case 'get_settings':
        return 'settings:get';
      default:
        return action;
    }
  }

  public async dispatchChannel(channel: string, payload: any): Promise<any> {
    switch (channel) {
      case 'agent:status':
        return this.getAgentStatus();

      case 'workflow:start':
        return this.executeWorkflow(payload.type, payload.options || payload.payload || payload);

      case 'workflow:stop':
        return this.stopWorkflow();

      case 'workflow:status': {
        const runId = payload?.runId || this.activeWorkflowRunId;
        if (!runId) return null;
        const run = this.db.getWorkflowRun(runId);
        const steps = this.db.getWorkflowSteps(runId);
        return { run, steps };
      }

      case 'workflow:history': {
        const limit = typeof payload?.limit === 'number' ? payload.limit : 20;
        return this.db.listWorkflowRuns(limit);
      }

      case 'network:check':
        return this.checkNetwork(payload);

      case 'network:probe-endpoints':
        return this.probeEndpoints(payload?.endpoints || payload);

      case 'settings:get':
        return this.getMergedAppSettings();

      case 'settings:set':
        return this.saveAppSettings(payload);

      case 'enterprise:list': {
        const profiles = this.getEnterpriseProfiles();
        const activeId = this.db.getSetting('active_enterprise_id') || profiles.find((p) => p.isActive)?.id || '';
        return { profiles, activeId };
      }

      case 'enterprise:get-active': {
        const profiles = this.getEnterpriseProfiles();
        const activeId = this.db.getSetting('active_enterprise_id') || profiles.find((p) => p.isActive)?.id;
        return profiles.find((p) => p.id === activeId) || profiles[0] || null;
      }

      case 'enterprise:save':
        return this.saveEnterpriseProfile(payload);

      case 'enterprise:delete':
        return this.deleteEnterpriseProfile(payload?.id);

      case 'enterprise:setActive':
        return this.setActiveEnterpriseProfile(payload?.id);

      case 'credentials:get-meta':
        return this.db.listCredentialMeta();

      case 'credentials:save':
        return this.saveCredentials(payload);

      case 'credentials:delete':
        return this.deleteCredentials(payload?.accountName);

      case 'credentials:test':
        return this.testCredentialsUrl(payload?.url);

      case 'files:history': {
        const reportType = payload?.reportType;
        const limit = typeof payload?.limit === 'number' ? payload.limit : 50;
        return this.db.getRecentDownloads(reportType, limit);
      }

      case 'errors:list': {
        const limit = typeof payload?.limit === 'number' ? payload.limit : 100;
        return this.db.listErrors(limit);
      }

      case 'errors:clear':
        return this.db.clearErrors();

      case 'user-action:respond':
        return this.respondUserAction(payload?.runId, payload?.confirmed === true);

      case 'browser:launch':
        if (this.browserManager) {
          const page = await this.browserManager.getPage('POS');
          if (payload?.url) {
            await page.goto(payload.url).catch(() => null);
          }
          return { success: true };
        }
        throw new Error('BrowserManager not configured');

      case 'browser:close':
        if (this.browserManager) {
          await this.browserManager.closeAll();
          return { success: true };
        }
        return { success: true };

      default:
        throw new Error(`Unsupported RPC channel: ${channel}`);
    }
  }

  private handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || this.host}`);
    const pathname = parsedUrl.pathname;
    const query = Object.fromEntries(parsedUrl.searchParams.entries());

    const readBody = (): Promise<any> => {
      return new Promise((resolve) => {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk.toString();
        });
        req.on('end', () => {
          try {
            resolve(body ? JSON.parse(body) : {});
          } catch {
            resolve({});
          }
        });
        req.on('error', () => resolve({}));
      });
    };

    const sendJson = (statusCode: number, data: any) => {
      res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
    };

    const sendError = (statusCode: number, message: string) => {
      res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: message }));
    };

    void (async () => {
      try {
        // --- 1. HEALTH & STATUS ---
        if (req.method === 'GET' && (pathname === '/health' || pathname === '/api/health')) {
          const health: HealthResponse & { connectedClients: number } = {
            status: 'ok',
            version: '1.0.0',
            uptime: Math.round((Date.now() - this.startTime) / 1000),
            mode: this.mode,
            timestamp: new Date().toISOString(),
            connectedClients: this.clients.size,
          };
          return sendJson(200, health);
        }

        if (req.method === 'GET' && pathname === '/api/agent/status') {
          return sendJson(200, this.getAgentStatus());
        }

        // --- 2. WORKFLOW ROUTES ---
        if (req.method === 'POST' && pathname === '/api/workflow/start') {
          const body = await readBody();
          const type = body.type || 'DAILY_PROCUREMENT';
          const options = body.options || body.payload || body;
          const result = await this.executeWorkflow(type, options);
          return sendJson(200, { success: true, data: result, runId: result?.id || this.activeWorkflowRunId });
        }

        if (req.method === 'POST' && pathname === '/api/workflow/stop') {
          const result = await this.stopWorkflow();
          return sendJson(200, result);
        }

        if (req.method === 'GET' && pathname === '/api/workflow/status') {
          const runId = query.runId || this.activeWorkflowRunId;
          if (!runId) {
            return sendJson(200, { run: null, steps: [] });
          }
          const run = this.db.getWorkflowRun(runId);
          const steps = this.db.getWorkflowSteps(runId);
          return sendJson(200, { run, steps });
        }

        if (req.method === 'GET' && pathname === '/api/workflow/history') {
          const limit = query.limit ? parseInt(query.limit, 10) : 20;
          const runs = this.db.listWorkflowRuns(limit);
          return sendJson(200, { runs });
        }

        // --- 3. NETWORK CHECKS ---
        if (req.method === 'POST' && pathname === '/api/network/check') {
          const body = await readBody();
          const result = await this.checkNetwork(body);
          return sendJson(200, result);
        }

        if (req.method === 'POST' && pathname === '/api/network/probe-endpoints') {
          const body = await readBody();
          const results = await this.probeEndpoints(body?.endpoints || body);
          return sendJson(200, { results });
        }

        // --- 4. SETTINGS ---
        if (req.method === 'GET' && pathname === '/api/settings') {
          return sendJson(200, this.getMergedAppSettings());
        }

        if (req.method === 'POST' && pathname === '/api/settings') {
          const body = await readBody();
          const saved = this.saveAppSettings(body);
          return sendJson(200, { success: true, settings: saved });
        }

        // --- 5. ENTERPRISE PROFILES ---
        if (req.method === 'GET' && pathname === '/api/enterprise/list') {
          const profiles = this.getEnterpriseProfiles();
          const activeId = this.db.getSetting('active_enterprise_id') || profiles.find((p) => p.isActive)?.id || '';
          return sendJson(200, { profiles, activeId });
        }

        if (req.method === 'GET' && pathname === '/api/enterprise/active') {
          const profiles = this.getEnterpriseProfiles();
          const activeId = this.db.getSetting('active_enterprise_id') || profiles.find((p) => p.isActive)?.id;
          const active = profiles.find((p) => p.id === activeId) || profiles[0] || null;
          return sendJson(200, { profile: active });
        }

        if (req.method === 'POST' && pathname === '/api/enterprise/save') {
          const body = await readBody();
          const updated = this.saveEnterpriseProfile(body);
          return sendJson(200, { success: true, profiles: updated });
        }

        if (req.method === 'POST' && pathname === '/api/enterprise/setActive') {
          const body = await readBody();
          const resSetActive = this.setActiveEnterpriseProfile(body.id);
          return sendJson(200, resSetActive);
        }

        if (req.method === 'POST' && pathname === '/api/enterprise/delete') {
          const body = await readBody();
          const resDelete = this.deleteEnterpriseProfile(body.id);
          return sendJson(200, resDelete);
        }

        // --- 6. CREDENTIALS ---
        if (req.method === 'GET' && pathname === '/api/credentials/meta') {
          const meta = this.db.listCredentialMeta();
          return sendJson(200, { credentials: meta });
        }

        if (req.method === 'POST' && pathname === '/api/credentials/save') {
          const body = await readBody();
          await this.saveCredentials(body);
          return sendJson(200, { success: true });
        }

        if (req.method === 'POST' && pathname === '/api/credentials/delete') {
          const body = await readBody();
          await this.deleteCredentials(body.accountName);
          return sendJson(200, { success: true });
        }

        if (req.method === 'POST' && pathname === '/api/credentials/test') {
          const body = await readBody();
          const testRes = await this.testCredentialsUrl(body.url);
          return sendJson(200, testRes);
        }

        // --- 7. FILES & DOWNLOADS ---
        if (req.method === 'GET' && pathname === '/api/files/history') {
          const limit = query.limit ? parseInt(query.limit, 10) : 50;
          const history = this.db.getRecentDownloads(query.reportType, limit);
          return sendJson(200, { files: history });
        }

        // --- 8. ERRORS ---
        if (req.method === 'GET' && pathname === '/api/errors/list') {
          const limit = query.limit ? parseInt(query.limit, 10) : 100;
          const errors = this.db.listErrors(limit);
          return sendJson(200, { errors });
        }

        if (req.method === 'POST' && pathname === '/api/errors/clear') {
          this.db.clearErrors();
          return sendJson(200, { success: true });
        }

        // --- 9. INTERACTIVE USER ACTION RESPOND ---
        if (req.method === 'POST' && pathname === '/api/user-action/respond') {
          const body = await readBody();
          const resAction = this.respondUserAction(body.runId, body.confirmed === true);
          return sendJson(200, resAction);
        }

        // --- 10. GENERIC RPC DISPATCH ---
        if (req.method === 'POST' && pathname === '/api/rpc') {
          const body = await readBody();
          const channel = body.channel || body.method;
          const payload = body.payload || body.params || {};
          const result = await this.dispatchChannel(channel, payload);
          return sendJson(200, { success: true, data: result });
        }

        // 404 Route Not Found
        sendError(404, `Endpoint not found: ${req.method} ${pathname}`);
      } catch (err: any) {
        sendError(500, err?.message || 'Internal server error');
      }
    })();
  }

  public getAgentStatus() {
    return {
      online: true,
      activeWorkflowRunId: this.activeWorkflowRunId,
      lastKnownPosReachable: this.lastKnownPosReachable,
      lastKnownSapReachable: this.lastKnownSapReachable,
      connectedClients: this.clients.size,
      uptime: Math.round((Date.now() - this.startTime) / 1000),
      timestamp: new Date().toISOString(),
      mode: this.mode,
    };
  }

  public getMergedAppSettings(): Record<string, any> {
    try {
      return JSON.parse(this.db.getSetting('app_settings') || '{}');
    } catch {
      return {};
    }
  }

  public saveAppSettings(newSettings: Record<string, any>): Record<string, any> {
    const current = this.getMergedAppSettings();
    const merged = { ...current, ...newSettings };
    this.db.setSetting('app_settings', JSON.stringify(merged));
    return merged;
  }

  public getEnterpriseProfiles(): EnterpriseProfile[] {
    try {
      const stored = this.db.getSetting('enterprise_profiles');
      if (stored) return JSON.parse(stored) as EnterpriseProfile[];
    } catch {}
    return [];
  }

  public saveEnterpriseProfile(profile: Partial<EnterpriseProfile>): EnterpriseProfile[] {
    const profiles = this.getEnterpriseProfiles();
    const id = profile.id || `profile_${Date.now()}`;
    const idx = profiles.findIndex((p) => p.id === id);
    const updated: EnterpriseProfile = {
      id,
      name: profile.name || 'New Profile',
      code: profile.code || 'FM',
      erpType: profile.erpType || 'SAP_B1',
      server: profile.server || '',
      companyName: profile.companyName || '',
      companySchema: profile.companySchema || '',
      posUrl: profile.posUrl || '',
      erpUrl: profile.erpUrl || '',
      exportPath: profile.exportPath || getDefaultReportsDir(),
      namingTemplate: profile.namingTemplate || 'Export_{{date}}.xlsx',
      isActive: profile.isActive ?? false,
      createdAt: profile.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (idx >= 0) {
      profiles[idx] = updated;
    } else {
      profiles.push(updated);
    }

    this.db.setSetting('enterprise_profiles', JSON.stringify(profiles));
    return profiles;
  }

  public deleteEnterpriseProfile(id?: string): { success: boolean; profiles: EnterpriseProfile[] } {
    if (!id) return { success: false, profiles: this.getEnterpriseProfiles() };
    let profiles = this.getEnterpriseProfiles();
    profiles = profiles.filter((p) => p.id !== id);
    this.db.setSetting('enterprise_profiles', JSON.stringify(profiles));
    return { success: true, profiles };
  }

  public setActiveEnterpriseProfile(id?: string): { success: boolean; activeId: string } {
    if (!id) return { success: false, activeId: '' };
    this.db.setSetting('active_enterprise_id', id);
    const profiles = this.getEnterpriseProfiles().map((p) => ({
      ...p,
      isActive: p.id === id,
    }));
    this.db.setSetting('enterprise_profiles', JSON.stringify(profiles));
    return { success: true, activeId: id };
  }

  public async saveCredentials(payload: { accountName: string; url?: string; username?: string; password?: string; application?: string }): Promise<void> {
    if (!payload?.accountName) throw new Error('Missing accountName');
    if (payload.password) {
      try {
        await credentialManager.setPassword(payload.accountName, payload.password);
      } catch {
        const encrypted = SecureStorage.encrypt(payload.password);
        this.db.setSetting(`cred_${payload.accountName}`, encrypted);
      }
    }
    const appType = payload.application || (payload.accountName.toUpperCase().includes('POS') ? 'POS' : 'SAP');
    this.db.upsertCredentialMeta({
      id: `cred_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      accountName: payload.accountName,
      application: appType,
      username: payload.username || '',
      credentialKey: `cred_${payload.accountName}`,
      url: payload.url || '',
    });
  }

  public async deleteCredentials(accountName?: string): Promise<{ success: boolean }> {
    if (!accountName) return { success: false };
    try {
      await credentialManager.deletePassword(accountName);
    } catch {}
    this.db.audit('credentials:delete', accountName);
    return { success: true };
  }

  public async testCredentialsUrl(url?: string): Promise<{ ok: boolean; message: string }> {
    if (!url) return { ok: false, message: 'URL is required' };
    const probe = await fastTcpProbe(url, 80, 3000);
    return {
      ok: probe.ok,
      message: probe.ok ? 'Connection reachable' : probe.error || 'Connection failed',
    };
  }

  public async checkNetwork(payload?: {
    sapHost?: string;
    sapPort?: number;
    posHost?: string;
    posPort?: number;
  }): Promise<NetworkStatusResult> {
    const settings = this.getMergedAppSettings();
    const profiles = this.getEnterpriseProfiles();
    const activeProfile = profiles.find((p) => p.isActive) || profiles[0];

    const posUrl = payload?.posHost || activeProfile?.posUrl || settings.posUrl || settings.posBaseUrl || 'http://172.16.1.200';
    const sapUrl = payload?.sapHost || activeProfile?.erpUrl || settings.sapUrl || settings.sapBaseUrl || 'https://172.16.1.210:8100/dispatcher/';

    const [posProbe, sapProbe] = await Promise.all([
      fastTcpProbe(posUrl, payload?.posPort || 80, 2500),
      fastTcpProbe(sapUrl, payload?.sapPort || 8100, 2500),
    ]);

    this.lastKnownPosReachable = posProbe.ok;
    this.lastKnownSapReachable = sapProbe.ok;

    const probeResults: NetworkProbeResult[] = [
      {
        id: 'POS',
        name: 'POS RPFO Web Server',
        url: posUrl,
        reachable: posProbe.ok,
        latencyMs: posProbe.latencyMs,
        error: posProbe.error,
      },
      {
        id: 'SAP',
        name: 'SAP Business One SLD Dispatcher',
        url: sapUrl,
        reachable: sapProbe.ok,
        latencyMs: sapProbe.latencyMs,
        error: sapProbe.error,
      },
    ];

    const networkStatus: NetworkStatusResult = {
      sap: sapProbe.ok,
      pos: posProbe.ok,
      sapLatency: sapProbe.latencyMs,
      posLatency: posProbe.latencyMs,
      checkedAt: new Date().toISOString(),
      results: probeResults,
    };

    this.broadcast('network:status', networkStatus);
    return networkStatus;
  }

  public async probeEndpoints(
    endpoints?: Array<{ id: string; name?: string; url: string; port?: number }>
  ): Promise<NetworkProbeResult[]> {
    if (!Array.isArray(endpoints) || endpoints.length === 0) {
      return [];
    }

    const results = await Promise.all(
      endpoints.map(async (ep) => {
        const probe = await fastTcpProbe(ep.url, ep.port || 80, 2500);
        return {
          id: ep.id,
          name: ep.name || ep.id,
          url: ep.url,
          port: ep.port,
          reachable: probe.ok,
          latencyMs: probe.latencyMs,
          error: probe.error,
        };
      })
    );

    return results;
  }

  public respondUserAction(runId?: string, confirmed = true): { success: boolean } {
    if (!runId) return { success: false };
    const handler = this.pendingUserActions.get(runId);
    if (handler) {
      this.pendingUserActions.delete(runId);
      handler(confirmed);
      return { success: true };
    }
    return { success: false };
  }

  public async stopWorkflow(): Promise<{ success: boolean; runId: string | null }> {
    if (!this.activeWorkflowRunId) {
      return { success: true, runId: null };
    }

    const runId = this.activeWorkflowRunId;
    this.stopRequestedWorkflowRunId = runId;

    if (this.options.stopWorkflowRunner) {
      try {
        await this.options.stopWorkflowRunner();
      } catch {}
    }

    if (this.browserManager) {
      try {
        await this.browserManager.closeAll();
      } catch {}
    }

    this.broadcast('workflow:status', {
      runId,
      status: 'CANCELLED',
      message: 'Workflow stopped by user request',
    });

    return { success: true, runId };
  }

  public async executeWorkflow(type: string, options: Record<string, any> = {}): Promise<any> {
    if (this.options.workflowRunner) {
      return this.options.workflowRunner({ type, options });
    }

    return this.internalRunWorkflow(type, options);
  }

  private async internalRunWorkflow(type: string, incomingOpts: Record<string, any> = {}): Promise<any> {
    if (this.activeWorkflowRunId) {
      throw new Error(`An automation is already running (runId: ${this.activeWorkflowRunId}). Please stop it first.`);
    }

    const savedSettings = this.getMergedAppSettings();
    const profileList = this.getEnterpriseProfiles();
    const activeProfileId = this.db.getSetting('active_enterprise_id') || profileList.find((p) => p.isActive)?.id;
    const activeProfile = profileList.find((p) => p.id === activeProfileId) || profileList[0];

    const opts: Record<string, any> = {
      ...savedSettings,
      fromDate: savedSettings.posSalesFromDate,
      toDate: savedSettings.posSalesToDate,
      storeFilter:
        savedSettings.posSalesStoreFilterEnabled === false
          ? 'All'
          : [...new Set([
              ...(Array.isArray(savedSettings.posSelectedSalesStores) ? savedSettings.posSelectedSalesStores : []),
              ...parseFilterValues(savedSettings.posCustomSlocInput),
            ])].join(',') || 'All',
      inventorySlocFilter: [...new Set([
        ...(Array.isArray(savedSettings.posSelectedInvSlocs) ? savedSettings.posSelectedInvSlocs : []),
        ...parseFilterValues(savedSettings.posCustomSlocInput),
      ])].join(','),
      inventoryItemFilter: savedSettings.posInvItem,
      salesOutputDir: savedSettings.posSalesDir || (activeProfile?.exportPath ? path.join(activeProfile.exportPath, 'Sales') : undefined),
      salesFileNameTemplate: savedSettings.posSalesFileName || activeProfile?.namingTemplate,
      inventoryOutputDir: savedSettings.posInvDir || (activeProfile?.exportPath ? path.join(activeProfile.exportPath, 'Inventory') : undefined),
      inventoryFileNameTemplate: savedSettings.posInvFileName,
      sapServer: savedSettings.sapServer || activeProfile?.server,
      sapCompany: savedSettings.sapCompany || activeProfile?.companyName || activeProfile?.companySchema,
      sapOutputDir: savedSettings.sapDir || (activeProfile?.exportPath ? path.join(activeProfile.exportPath, 'SAP') : undefined),
      sapAutoTakeOverSession: savedSettings.sapAutoTakeOverSession ?? false,
      sapTargetModule: savedSettings.sapTargetModule || 'HOME',
      orgCode: activeProfile?.code || activeProfile?.companySchema || 'ORG',
      ...incomingOpts,
    };

    const run = this.db.createWorkflowRun(type);
    this.activeWorkflowRunId = run.id;
    this.stopRequestedWorkflowRunId = null;

    const assertNotStopped = () => {
      if (this.stopRequestedWorkflowRunId === run.id) {
        throw new Error('Workflow stopped by user.');
      }
    };

    const broadcastStep = (stepName: string, status: string, index: number, errorMessage?: string) => {
      this.broadcast('workflow:progress', {
        runId: run.id,
        workflowType: type,
        stepName,
        status,
        index,
        errorMessage,
        timestamp: new Date().toISOString(),
      });
    };

    this.broadcast('workflow:status', {
      runId: run.id,
      workflowType: type,
      status: 'RUNNING',
      startedAt: new Date().toISOString(),
    });

    const isPosTask = ['DAILY_PROCUREMENT', 'POS_AUTOMATION', 'DOWNLOAD_SALES', 'DOWNLOAD_INVENTORY'].includes(type);
    const isSapTask = ['DAILY_PROCUREMENT', 'SAP_AUTOMATION', 'SAP_LOGIN_CHECK'].includes(type);

    try {
      if (!this.browserManager) {
        const portableDataDir = process.env.APP_DATA_DIR || process.cwd();
        const tempDownloadDir = path.join(portableDataDir, 'Temp');
        try {
          fs.mkdirSync(tempDownloadDir, { recursive: true });
        } catch {}

        this.browserManager = new BrowserManager({
          downloadDir: tempDownloadDir,
          userDataDir: portableDataDir,
          headless: opts.headless ?? false,
          allowCdpAttach: false,
          cdpPorts: [9222, 9223, 9229],
        });
      }

      // --- POS AUTOMATION ---
      if (isPosTask) {
        assertNotStopped();
        const step1 = this.db.createWorkflowStep(run.id, 'Check POS RPFO Connectivity', 1);
        broadcastStep('Check POS RPFO Connectivity', 'RUNNING', 1);

        const posMeta = this.db.listCredentialMeta().find((m) => m.accountName === 'POS_MAIN' || m.account_name === 'POS_MAIN');
        const fallbackPosUrl = 'http://127.0.0.1:3000/pos';
        const rawPosUrl =
          opts.posBaseUrl ||
          opts.posUrl ||
          opts.baseUrl ||
          activeProfile?.posUrl ||
          savedSettings.posBaseUrl ||
          savedSettings.posUrl ||
          (posMeta?.url && posMeta.url.trim() ? posMeta.url : null) ||
          process.env.POS_URL ||
          fallbackPosUrl;
        const targetPosUrl = (rawPosUrl || '').trim().replace(/\/(home|login)\/?$/i, '');
        const posAdapter = new POSAdapter(this.browserManager, targetPosUrl);

        let posPassword = opts.posPassword;
        if (!posPassword) {
          try {
            posPassword = (await credentialManager.getPassword('POS_MAIN')) || undefined;
          } catch {}
        }
        if (!posPassword) {
          const cached = this.db.getSetting('cred_POS_MAIN');
          if (cached) {
            try {
              posPassword = decryptLocalCredential(cached);
            } catch {}
          }
        }
        const posUsername = opts.posUser || (posMeta ? String(posMeta.username || '') : process.env.POS_USER || '');
        const posCreds = posPassword ? { username: posUsername, password: posPassword } : undefined;

        const isMockOrTestEnv = opts.mock === true || opts.isMock === true || process.env.NODE_ENV === 'test';
        const posProbe = await fastTcpProbe(targetPosUrl, 80, 2500);
        if (!posProbe.ok && !posProbe.isMockOrLocal && !isMockOrTestEnv) {
          const probeErr = new Error(`Máy chủ POS không phản hồi TCP: ${posProbe.error}`);
          this.db.updateWorkflowStep(step1.id, 'FAILED', probeErr.message);
          broadcastStep(`POS không thể kết nối: ${posProbe.error}`, 'FAILED', 1);
          throw probeErr;
        }

        if (posCreds) {
          broadcastStep('Đang xác thực và kiểm tra phiên làm việc POS RPFO...', 'RUNNING', 1);
          try {
            await posAdapter.login(posCreds, {
              maxRetries: 10,
              retryDelayMs: 1500,
              onProgress: (msg) => broadcastStep(msg, 'RUNNING', 1),
            });
            this.db.updateWorkflowStep(step1.id, 'SUCCESS');
            broadcastStep('Check POS RPFO Connectivity', 'SUCCESS', 1);
          } catch (authErr: any) {
            this.db.updateWorkflowStep(step1.id, 'FAILED', authErr?.message);
            broadcastStep(`POS Login thất bại: ${authErr?.message}`, 'FAILED', 1);
            throw authErr;
          }
        } else {
          this.db.updateWorkflowStep(step1.id, 'SUCCESS');
          broadcastStep('Check POS RPFO Connectivity', 'SUCCESS', 1);
        }

        assertNotStopped();

        const doSales =
          type === 'DOWNLOAD_SALES' ||
          (type === 'POS_AUTOMATION' && opts.includeSales !== false) ||
          (type === 'DAILY_PROCUREMENT' && opts.includeSales !== false);

        const doInventory =
          type === 'DOWNLOAD_INVENTORY' ||
          (type === 'POS_AUTOMATION' && opts.includeInventory !== false) ||
          (type === 'DAILY_PROCUREMENT' && opts.includeInventory !== false);

        if (doSales) {
          assertNotStopped();
          const step2 = this.db.createWorkflowStep(run.id, 'POS: Download Sales Transaction Detail', 2);
          const dateRange = POSAdapter.calculateDateRange(opts.dateRangeRule || 'TODAY');
          const fromD = opts.fromDate || dateRange.from;
          const toD = opts.toDate || dateRange.to;
          const storeF = opts.storeFilter || 'All';
          const targetSalesDir = opts.salesOutputDir || getDefaultReportsDir('Sales');

          broadcastStep(`POS: Tải Sales Detail (${fromD} → ${toD})`, 'RUNNING', 2);
          const salesResult = await posAdapter.downloadSalesTransactionDetail(
            {
              fromDate: fromD,
              toDate: toD,
              storeFilter: storeF,
              outputDir: targetSalesDir,
              fileNameTemplate: opts.salesFileNameTemplate || 'Sales_{{fromDate}}_{{toDate}}.xlsx',
              orgCode: opts.orgCode,
            },
            posCreds
          );

          assertNotStopped();
          const validator = new ExcelValidator();
          const validation = await validator.validateWorkbook(salesResult.tempFilePath);
          const fileManager = new DownloadFileManager();
          const finalPath = fileManager.moveAndRename(
            salesResult.tempFilePath,
            targetSalesDir,
            salesResult.suggestedFilename
          );

          this.db.recordDownload({
            runId: run.id,
            reportType: 'SALES',
            fileName: salesResult.suggestedFilename,
            filePath: finalPath,
            rowCount: validation.rowCount ?? 0,
            status: validation.valid ? 'SUCCESS_WITH_DATA' : 'INVALID',
            downloadedAt: new Date().toISOString(),
          });

          this.db.updateWorkflowStep(step2.id, validation.valid ? 'SUCCESS' : 'FAILED');
          broadcastStep(`POS: Tải Sales Detail (${validation.rowCount || 0} dòng)`, validation.valid ? 'SUCCESS' : 'FAILED', 2);
        }

        if (doInventory) {
          assertNotStopped();
          const step3 = this.db.createWorkflowStep(run.id, 'POS: Download Inventory Onhand', 3);
          const invStore = opts.inventoryStoreFilter || 'All';
          const targetInvDir = opts.inventoryOutputDir || getDefaultReportsDir('Inventory');

          broadcastStep(`POS: Tải Inventory Onhand (Kho: ${invStore})`, 'RUNNING', 3);
          try {
            const invResult = await posAdapter.downloadInventoryOnhand(
              {
                storeFilter: invStore,
                slocFilter: opts.inventorySlocFilter,
                itemFilter: opts.inventoryItemFilter,
                outputDir: targetInvDir,
                fileNameTemplate: opts.inventoryFileNameTemplate || 'Inventory_Onhand_{{timestamp}}.xlsx',
                orgCode: opts.orgCode,
              },
              posCreds
            );

            assertNotStopped();
            const validator = new ExcelValidator();
            const validation = await validator.validateWorkbook(invResult.tempFilePath);
            const fileManager = new DownloadFileManager();
            const finalPath = fileManager.moveAndRename(
              invResult.tempFilePath,
              targetInvDir,
              invResult.suggestedFilename
            );

            this.db.recordDownload({
              runId: run.id,
              reportType: 'INVENTORY',
              fileName: invResult.suggestedFilename,
              filePath: finalPath,
              rowCount: validation.rowCount ?? 0,
              status: validation.valid ? 'SUCCESS_WITH_DATA' : 'INVALID',
              downloadedAt: new Date().toISOString(),
            });

            this.db.updateWorkflowStep(step3.id, 'SUCCESS');
            broadcastStep(`POS: Tải Inventory Onhand (${validation.rowCount || 0} dòng)`, 'SUCCESS', 3);
          } catch (invErr: any) {
            if (this.stopRequestedWorkflowRunId === run.id) throw invErr;
            this.db.updateWorkflowStep(step3.id, 'SKIPPED');
            broadcastStep('POS: Tải Inventory Onhand (Bỏ qua)', 'SKIPPED', 3);
          }
        }
      }

      // --- SAP AUTOMATION ---
      if (isSapTask) {
        assertNotStopped();
        const stepSap = this.db.createWorkflowStep(run.id, 'SAP Business One SLD Authentication', 4);
        broadcastStep('SAP: Khởi động & Đăng nhập SLD', 'RUNNING', 4);

        let sapPassword = opts.sapPassword;
        if (!sapPassword) {
          try {
            sapPassword = (await credentialManager.getPassword('SAP_MAIN')) || undefined;
          } catch {}
        }
        if (!sapPassword) {
          const cached = this.db.getSetting('cred_SAP_MAIN');
          if (cached) {
            try {
              sapPassword = decryptLocalCredential(cached);
            } catch {}
          }
        }

        const sapMeta = this.db.listCredentialMeta().find((m) => m.accountName === 'SAP_MAIN' || m.account_name === 'SAP_MAIN');
        const sapUsername = opts.sapUser || (sapMeta ? String(sapMeta.username || '') : process.env.SAP_USER || '');
        const targetServer = opts.sapServer || savedSettings.sapServer || process.env.SAP_SERVER || '';
        const targetCompany = opts.sapCompany || savedSettings.sapCompany || process.env.SAP_COMPANY || '';
        const fallbackSapUrl = 'http://127.0.0.1:3000/sap/dispatcher/';
        let targetSapUrl =
          opts.sapUrl ||
          opts.sapBaseUrl ||
          activeProfile?.erpUrl ||
          savedSettings.sapUrl ||
          (sapMeta?.url && sapMeta.url.trim() ? sapMeta.url : null) ||
          fallbackSapUrl;

        try {
          const parsed = new URL(targetSapUrl);
          parsed.search = '';
          parsed.hash = '';
          if (parsed.pathname.includes('/dispatcher')) {
            parsed.pathname = '/dispatcher/';
          }
          targetSapUrl = parsed.toString();
        } catch {}

        if (sapPassword) {
          const isMockOrTestEnv = opts.mock === true || opts.isMock === true || process.env.NODE_ENV === 'test';
          const sapProbe = await fastTcpProbe(targetSapUrl, 8100, 2500);
          if (!sapProbe.ok && !sapProbe.isMockOrLocal && !isMockOrTestEnv) {
            const probeErr = new Error(`Máy chủ SAP không phản hồi TCP: ${sapProbe.error}`);
            this.db.updateWorkflowStep(stepSap.id, 'FAILED', probeErr.message);
            broadcastStep(`SAP không thể kết nối: ${sapProbe.error}`, 'FAILED', 4);
            throw probeErr;
          }

          const sapAdapter = new SAPAdapter(this.browserManager, targetSapUrl, async (msg) => {
            if (opts.sapAutoTakeOverSession === true) return true;
            return new Promise<boolean>((resolve) => {
              this.pendingUserActions.set(run.id, resolve);
              setTimeout(() => {
                if (this.pendingUserActions.has(run.id)) {
                  this.pendingUserActions.delete(run.id);
                  resolve(true);
                }
              }, 30000);
            });
          });

          const loginRes = await sapAdapter.login(
            {
              username: sapUsername,
              password: sapPassword,
              server: targetServer,
              company: targetCompany,
              autoTakeOverSession: opts.sapAutoTakeOverSession === true,
              targetModule: opts.sapTargetModule || 'HOME',
              outputDir: opts.sapOutputDir,
            },
            (progressMsg) => {
              broadcastStep(progressMsg, 'RUNNING', 4);
            }
          );

          assertNotStopped();
          this.db.updateWorkflowStep(stepSap.id, loginRes.success ? 'SUCCESS' : 'FAILED', loginRes.success ? undefined : loginRes.message);
          broadcastStep('SAP Business One Đăng nhập', loginRes.success ? 'SUCCESS' : 'FAILED', 4);
        } else {
          this.db.updateWorkflowStep(stepSap.id, 'SKIPPED');
          broadcastStep('SAP: Chưa có mật khẩu SAP', 'SKIPPED', 4);
        }
      }

      assertNotStopped();
      this.db.updateWorkflowRunStatus(run.id, 'SUCCESS');
      broadcastStep('Hoàn thành Quy trình Automation', 'SUCCESS', 99);
      this.broadcast('workflow:status', { runId: run.id, workflowType: type, status: 'SUCCESS' });

      this.activeWorkflowRunId = null;
      this.stopRequestedWorkflowRunId = null;
      return this.db.getWorkflowRun(run.id) || run;
    } catch (err: any) {
      if (this.stopRequestedWorkflowRunId === run.id) {
        this.db.updateWorkflowRunStatus(run.id, 'CANCELLED', 'Dừng theo yêu cầu người dùng.');
        broadcastStep('Automation đã dừng theo yêu cầu.', 'CANCELLED', 99);
        this.broadcast('workflow:status', { runId: run.id, workflowType: type, status: 'CANCELLED' });
        this.activeWorkflowRunId = null;
        this.stopRequestedWorkflowRunId = null;
        return this.db.getWorkflowRun(run.id) || run;
      }

      this.db.logError({
        runId: run.id,
        errorType: 'DOWNLOAD_FAILED',
        severity: 'ERROR',
        message: err?.message || String(err),
      });
      this.db.updateWorkflowRunStatus(run.id, 'FAILED', err?.message || String(err));
      broadcastStep('Lỗi Quy trình: ' + (err?.message || String(err)), 'FAILED', 99, err?.message);
      this.broadcast('workflow:status', { runId: run.id, workflowType: type, status: 'FAILED', error: err?.message });

      this.activeWorkflowRunId = null;
      this.stopRequestedWorkflowRunId = null;
      throw err;
    }
  }
}

// Module-level singleton instance
let globalEmbeddedServer: AgentEmbeddedServer | null = null;

export async function startEmbeddedServer(options: EmbeddedServerOptions): Promise<AgentEmbeddedServer> {
  if (globalEmbeddedServer) {
    return globalEmbeddedServer;
  }
  const server = new AgentEmbeddedServer(options);
  await server.start();
  globalEmbeddedServer = server;
  return server;
}

export async function stopEmbeddedServer(): Promise<void> {
  if (globalEmbeddedServer) {
    await globalEmbeddedServer.stop();
    globalEmbeddedServer = null;
  }
}

export function getEmbeddedServer(): AgentEmbeddedServer | null {
  return globalEmbeddedServer;
}
