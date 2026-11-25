// Ambient declarations for Chrome Extension MV3 API

declare namespace chrome {
  namespace runtime {
    const id: string;
    function getURL(path: string): string;
    function sendMessage<M = any, R = any>(
      message: M,
      responseCallback?: (response: R) => void
    ): Promise<R>;
    function sendMessage<M = any, R = any>(
      extensionId: string,
      message: M,
      responseCallback?: (response: R) => void
    ): Promise<R>;

    interface MessageSender {
      tab?: chrome.tabs.Tab;
      frameId?: number;
      id?: string;
      url?: string;
      tlsChannelId?: string;
    }

    interface Port {
      name: string;
      disconnect(): void;
      onDisconnect: {
        addListener(callback: (port: Port) => void): void;
      };
      onMessage: {
        addListener(callback: (msg: any, port: Port) => void): void;
      };
      postMessage(msg: any): void;
    }

    function connect(connectInfo?: { name?: string }): Port;

    const onConnect: {
      addListener(callback: (port: Port) => void): void;
      removeListener(callback: (port: Port) => void): void;
    };

    const onMessage: {
      addListener(
        callback: (
          message: any,
          sender: MessageSender,
          sendResponse: (response?: any) => void
        ) => boolean | void | Promise<any>
      ): void;
      removeListener(callback: (...args: any[]) => void): void;
    };

    const onInstalled: {
      addListener(callback: (details: { reason: string; previousVersion?: string }) => void): void;
    };
  }

  namespace action {
    function setBadgeText(details: { text: string; tabId?: number }): Promise<void>;
    function setBadgeBackgroundColor(details: {
      color: string | [number, number, number, number];
      tabId?: number;
    }): Promise<void>;
    function setTitle(details: { title: string; tabId?: number }): Promise<void>;
    function openPopup(): Promise<void>;
  }

  namespace sidePanel {
    function open(options: { windowId?: number; tabId?: number }): Promise<void>;
    function setOptions(options: {
      tabId?: number;
      path?: string;
      enabled?: boolean;
    }): Promise<void>;
    function getOptions(options: { tabId?: number }): Promise<{ path?: string; enabled?: boolean }>;
  }

  namespace tabs {
    interface Tab {
      id?: number;
      index: number;
      windowId: number;
      highlighted: boolean;
      active: boolean;
      pinned: boolean;
      url?: string;
      title?: string;
      favIconUrl?: string;
      status?: string;
      incognito: boolean;
      width?: number;
      height?: number;
    }

    function get(tabId: number): Promise<Tab>;
    function query(queryInfo: {
      active?: boolean;
      currentWindow?: boolean;
      url?: string | string[];
    }): Promise<Tab[]>;
    function captureVisibleTab(windowId?: number, options?: { format?: 'jpeg' | 'png'; quality?: number }): Promise<string>;
    function create(createProperties: {
      url?: string;
      active?: boolean;
      windowId?: number;
    }): Promise<Tab>;
    function update(tabId: number, updateProperties: { url?: string; active?: boolean }): Promise<Tab>;
    function sendMessage<M = any, R = any>(
      tabId: number,
      message: M,
      responseCallback?: (response: R) => void
    ): Promise<R>;

    const onUpdated: {
      addListener(
        callback: (tabId: number, changeInfo: { status?: string; url?: string }, tab: Tab) => void
      ): void;
      removeListener(
        callback: (tabId: number, changeInfo: { status?: string; url?: string }, tab: Tab) => void
      ): void;
    };
  }

  namespace windows {
    interface Window {
      id?: number;
      focused: boolean;
      top?: number;
      left?: number;
      width?: number;
      height?: number;
      type?: string;
      state?: string;
      incognito: boolean;
      alwaysOnTop: boolean;
    }
    function getCurrent(): Promise<Window>;
  }

  namespace storage {
    interface StorageArea {
      get(keys?: string | string[] | Record<string, any> | null): Promise<Record<string, any>>;
      set(items: Record<string, any>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
      clear(): Promise<void>;
    }
    const local: StorageArea;
    const sync: StorageArea;
    const session: StorageArea;
    const onChanged: {
      addListener(
        callback: (
          changes: Record<string, { oldValue?: any; newValue?: any }>,
          areaName: string
        ) => void
      ): void;
    };
  }

  namespace alarms {
    interface Alarm {
      name: string;
      scheduledTime: number;
      periodInMinutes?: number;
    }
    function create(name: string, alarmInfo: { delayInMinutes?: number; periodInMinutes?: number; when?: number }): void;
    function clear(name: string): Promise<boolean>;
    const onAlarm: {
      addListener(callback: (alarm: Alarm) => void): void;
    };
  }

  namespace scripting {
    interface InjectionTarget {
      tabId: number;
      allFrames?: boolean;
      frameIds?: number[];
    }
    interface ScriptInjection<Args extends any[] = any[], Result = any> {
      target: InjectionTarget;
      func?: (...args: Args) => Result;
      files?: string[];
      args?: Args;
      world?: 'ISOLATED' | 'MAIN';
    }
    interface InjectionResult<T = any> {
      frameId: number;
      result: T;
    }
    function executeScript<Args extends any[] = any[], Result = any>(
      injection: ScriptInjection<Args, Result>
    ): Promise<InjectionResult<Result>[]>;
  }

  namespace downloads {
    interface DownloadItem {
      id: number;
      url: string;
      finalUrl?: string;
      filename: string;
      state: 'in_progress' | 'interrupted' | 'complete';
      bytesReceived: number;
      totalBytes: number;
      fileSize: number;
      startTime: string;
      endTime?: string;
      error?: string;
      exists?: boolean;
    }
    interface StringDelta {
      current?: string;
      previous?: string;
    }
    interface DownloadDelta {
      id: number;
      state?: StringDelta;
      filename?: StringDelta;
      error?: StringDelta;
    }
    function search(query: {
      id?: number;
      url?: string;
      filenameRegex?: string;
      state?: 'in_progress' | 'interrupted' | 'complete';
      limit?: number;
      orderBy?: string[];
    }): Promise<DownloadItem[]>;
    function show(downloadId: number): void;
    function showDefaultFolder(): void;
    const onChanged: {
      addListener(callback: (delta: DownloadDelta) => void): void;
      removeListener(callback: (delta: DownloadDelta) => void): void;
    };
  }
}
