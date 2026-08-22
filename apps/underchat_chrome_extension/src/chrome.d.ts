type ChromeTab = {
  id?: number;
  pendingUrl?: string;
  status?: 'complete' | 'loading' | 'unloaded';
  url?: string;
};

type ChromeInjectionResult<T = unknown> = {
  result?: T;
};

type ChromeStorageChange<T = unknown> = {
  newValue?: T;
  oldValue?: T;
};

type ChromeRuntimeMessage = {
  payload?: unknown;
  type: string;
};

type ChromeApi = {
  alarms: {
    clear(name: string): Promise<boolean>;
    create(
      name: string,
      alarmInfo: { delayInMinutes?: number; when?: number }
    ): Promise<void>;
    onAlarm: {
      addListener(callback: (alarm: { name: string }) => void): void;
    };
  };
  browsingData: {
    remove(
      options: { origins?: string[]; since?: number },
      dataToRemove: Record<string, boolean>
    ): Promise<void>;
  };
  runtime: {
    getURL(path: string): string;
    lastError?: { message?: string };
    onMessage: {
      addListener(
        callback: (
          message: ChromeRuntimeMessage,
          sender: unknown,
          sendResponse: (response?: unknown) => void
        ) => boolean | void
      ): void;
    };
    sendMessage<T = unknown>(message: ChromeRuntimeMessage): Promise<T>;
  };
  scripting: {
    executeScript<T = unknown>(details: {
      args?: unknown[];
      func: (...args: never[]) => T | Promise<T>;
      target: { tabId: number };
      world?: 'ISOLATED' | 'MAIN';
    }): Promise<Array<ChromeInjectionResult<Awaited<T>>>>;
  };
  storage: {
    local: {
      get<T extends Record<string, unknown>>(
        keys?: string | string[] | Record<string, unknown> | null
      ): Promise<T>;
      remove(keys: string | string[]): Promise<void>;
      set(items: Record<string, unknown>): Promise<void>;
    };
    onChanged: {
      addListener(
        callback: (
          changes: Record<string, ChromeStorageChange>,
          areaName: string
        ) => void
      ): void;
    };
  };
  tabs: {
    get(tabId: number): Promise<ChromeTab>;
    onUpdated: {
      addListener(
        callback: (
          tabId: number,
          changeInfo: { status?: string; url?: string },
          tab: ChromeTab
        ) => void
      ): void;
    };
    query(queryInfo: {
      active?: boolean;
      currentWindow?: boolean;
      url?: string | string[];
    }): Promise<ChromeTab[]>;
    reload(
      tabId?: number,
      reloadProperties?: {
        bypassCache?: boolean;
      }
    ): Promise<void>;
    update(
      tabId: number,
      updateProperties: {
        url?: string;
      }
    ): Promise<ChromeTab>;
  };
};

declare const chrome: ChromeApi;
