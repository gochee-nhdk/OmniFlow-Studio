import { contextBridge, ipcRenderer } from 'electron';

// Whitelist of strictly permitted IPC invocation channels from renderer
const ALLOWED_INVOKE_CHANNELS = new Set<string>([
  'workflow:start',
  'workflow:stop',
  'workflow:status',
  'workflow:history',
  'agent:status',
  'credentials:get',
  'credentials:save',
  'credentials:test',
  'credentials:delete',
  'credentials:get-meta',
  'settings:get',
  'settings:set',
  'network:check',
  'network:probe-endpoints',
  'dialog:open-directory',
  'app:get-paths',
  'browser:launch',
  'browser:close',
  'files:open-dir',
  'files:history',
  'errors:list',
  'errors:clear',
  'user-action:respond',
  'enterprise:list',
  'enterprise:save',
  'enterprise:delete',
  'enterprise:setActive',
  'enterprise:get-active',
]);

// Whitelist of strictly permitted incoming event channels
const ALLOWED_EVENT_CHANNELS = new Set<string>([
  'workflow:progress',
  'workflow:status',
  'agent:status',
]);

// Secure bridge between renderer (React) and main process (Node.js)
contextBridge.exposeInMainWorld('fmAgent', {
  invoke: async <T>(channel: string, payload?: unknown): Promise<{ success: boolean; data?: T; error?: string }> => {
    if (!ALLOWED_INVOKE_CHANNELS.has(channel)) {
      return { success: false, error: `Unauthorized IPC channel: ${channel}` };
    }
    try {
      const result = await ipcRenderer.invoke(channel, payload);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },

  on: (channel: string, listener: (data: unknown) => void): (() => void) => {
    if (!ALLOWED_EVENT_CHANNELS.has(channel)) {
      console.warn(`Attempted to listen on unauthorized IPC channel: ${channel}`);
      return () => {};
    }
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => listener(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
