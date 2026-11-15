import { contextBridge, ipcRenderer } from 'electron';

// Secure bridge between renderer (React) and main process (Node.js)
contextBridge.exposeInMainWorld('fmAgent', {
  invoke: async <T>(channel: string, payload?: unknown): Promise<{ success: boolean; data?: T; error?: string }> => {
    try {
      const result = await ipcRenderer.invoke(channel, payload);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },

  on: (channel: string, listener: (data: unknown) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => listener(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
