import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { createPinia, setActivePinia } from 'pinia';
import { EChatStatus } from '@core/common/enums/EChatStatus';

const mockAxiosGet = jest.fn();
const mockAxiosPost = jest.fn();

type TestChat = {
  chat_id: string;
  status?: string;
  meta?: {
    status_epoch?: number | null;
    status_event_id?: string | null;
  } | null;
  account?: { id: string; name: string };
  worker?: { id: string; name: string };
  sector?: null;
  user?: { id: string; name: string } | null;
  secondary_users?: Array<{ id: string; name: string }>;
  contact?: null;
  photo?: null;
  name?: string;
  phone?: string;
  date?: string;
  started_at?: string | null;
  closed_at?: string | null;
  summary?: {
    last_message: string | null;
    last_date: string | null;
    unread_count: number;
    revision?: number;
  } | null;
  official_window?: {
    state: string;
    can_send_freeform: boolean;
    updated_at?: string | null;
  } | null;
};

interface TestChatStore {
  user: { account_id: string; user_id: string } | null;
  activeChat: TestChat | null;
  pinnedChats: Array<{ chat_id: string }>;
  unreadSummaryCount: number;
  unreadSummaryByChatId: Record<
    string,
    { unread_count: number; revision: number }
  >;
  chatContacts: Record<string, { contact_id: string } | null>;
  kanbanQueue: Array<{ chat_id: string }>;
  listMessages: Array<{ message_id: string; chat_id: string }>;
  listQueue: TestChat[];
  listInChat: TestChat[];
  listChatbot: TestChat[];
  listScheduled: TestChat[];
  listClosed: TestChat[];
  queuePagings: {
    current_page: number;
    total_pages: number;
    per_page: number;
    count: number;
    total: number;
  };
  loadPinnedChats: () => Promise<unknown>;
  ensureUnreadSummaryAccountScope: (accountId: string | null) => void;
  resetUnreadSummary: () => void;
  viewUnreadSummary: () => Promise<number>;
  loadKanbanInitial: () => Promise<boolean>;
  getChatById: (
    query: { current_page: number; per_page: number },
    chatId: string,
    options: { preserveMessages: boolean; skipLoading: boolean }
  ) => Promise<boolean>;
  applyOfficialWindowSnapshot: (
    chatId: string,
    officialWindow:
      { state: string; can_send_freeform: boolean } | null | undefined
  ) => boolean;
  captureChatStatusSnapshotFence: () => Record<string, string>;
  updateListsByStatus: (
    statuses: EChatStatus[],
    results: TestChat[],
    append: boolean,
    fence?: Record<string, string>
  ) => void;
  setActiveChat: (chatId: string, fallbackChat?: TestChat) => void;
  clearActiveChatUnreadCountLocally: () => boolean;
  reconcileUnreadSummaryFromChat: (chat: TestChat) => void;
  getChatContactsByIds: (
    contactIds: string[]
  ) => Promise<Array<{ contact_id: string }>>;
  listQueueChats: (
    input: {
      current_page: number;
      per_page: number;
      status: EChatStatus.queue;
    },
    append?: boolean
  ) => Promise<unknown>;
  reloadAllChatLists: () => Promise<boolean>;
}

type ChatStoreFactory = () => TestChatStore;

const loadChatStoreFactory = (): ChatStoreFactory => {
  const filename = path.resolve(
    process.cwd(),
    'apps/web/src/@webcore/stores/chat.ts'
  );
  const source = fs.readFileSync(filename, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText;
  const loadedModule = { exports: {} as Record<string, unknown> };
  const moduleRequire = (moduleId: string): unknown => {
    const modules: Record<string, unknown> = {
      pinia: jest.requireActual('pinia'),
      '@/plugins/i18n': {
        getI18n: () => ({ global: { t: (key: string) => key } }),
      },
      '@webcore/axios': {
        __esModule: true,
        default: {
          get: (...args: unknown[]) => mockAxiosGet(...args),
          post: (...args: unknown[]) => mockAxiosPost(...args),
        },
      },
      '@/utils/apiError': {
        getApiErrorRequestId: () => null,
        getApiErrorStatus: () => null,
        isOfficialWindowRefreshConflict: () => false,
      },
      '../localStorage/user': {
        getUser: () => null,
        setUser: jest.fn(),
        getPermissions: () => [],
        getSectors: () => [],
        getChannels: () => [],
      },
      '../utils/perKeyPromiseQueue': {
        PerKeyPromiseQueue: class {
          async run<T>(_key: string, operation: () => Promise<T>): Promise<T> {
            return operation();
          }
        },
      },
    };

    if (moduleId in modules) {
      return modules[moduleId];
    }
    if (moduleId === 'axios' || moduleId.startsWith('@core/')) {
      return jest.requireActual(moduleId);
    }

    throw new Error(`Unexpected chat store dependency: ${moduleId}`);
  };
  const evaluateModule = new Function(
    'require',
    'module',
    'exports',
    transpiled
  ) as (
    requireModule: (moduleId: string) => unknown,
    module: typeof loadedModule,
    exports: Record<string, unknown>
  ) => void;
  evaluateModule(moduleRequire, loadedModule, loadedModule.exports);

  return (loadedModule.exports as { useChatStore: ChatStoreFactory })
    .useChatStore;
};

const useChatStore = loadChatStoreFactory();

const setAccount = (store: TestChatStore, accountId: string): void => {
  store.user = {
    account_id: accountId,
    user_id: `user-${accountId}`,
  };
};

const deferred = <T>() => {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve: (value: T) => resolve?.(value) };
};

const createStatusChat = (
  status: EChatStatus,
  statusEpoch: number,
  statusEventId: string
): TestChat => ({
  chat_id: 'chat-status-race',
  status,
  meta: {
    status_epoch: statusEpoch,
    status_event_id: statusEventId,
  },
  account: { id: 'account-a', name: 'Account A' },
  worker: { id: 'worker-a', name: 'Worker A' },
  sector: null,
  user: { id: 'user-account-a', name: 'Operator A' },
  secondary_users: [],
  contact: null,
  photo: null,
  name: 'Contact A',
  phone: '5511999999999',
  date: '2026-07-24T12:00:00.000Z',
  started_at:
    status === EChatStatus.in_chat ? '2026-07-24T12:04:21.571Z' : null,
  closed_at: null,
  summary: {
    last_message: 'Bom dia',
    last_date: '2026-07-24T12:08:05.907Z',
    unread_count: 0,
  },
});

describe('chat store account request fence', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        removeItem: (key: string) => values.delete(key),
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
    setActivePinia(createPinia());
    mockAxiosGet.mockReset();
    mockAxiosPost.mockReset();
  });

  it('does not commit a late pinned-chat response from account A into account B', async () => {
    const request = deferred<{
      data: { status: boolean; data: Array<{ chat_id: string }> };
    }>();
    mockAxiosGet.mockReturnValueOnce(request.promise);

    const store = useChatStore();
    setAccount(store, 'account-a');
    const pending = store.loadPinnedChats();

    setAccount(store, 'account-b');
    store.pinnedChats = [{ chat_id: 'chat-b' }] as typeof store.pinnedChats;
    request.resolve({
      data: {
        status: true,
        data: [{ chat_id: 'chat-a' }],
      },
    });
    await pending;

    expect(store.pinnedChats).toEqual([
      expect.objectContaining({ chat_id: 'chat-b' }),
    ]);
    expect(store.pinnedChats).not.toEqual([
      expect.objectContaining({ chat_id: 'chat-a' }),
    ]);
  });

  it('does not commit a late unread-summary response from account A into account B', async () => {
    const request = deferred<{
      data: { status: boolean; data: { unread_count: number } };
    }>();
    mockAxiosGet.mockReturnValueOnce(request.promise);

    const store = useChatStore();
    setAccount(store, 'account-a');
    const pending = store.viewUnreadSummary();

    setAccount(store, 'account-b');
    store.unreadSummaryCount = 41;
    request.resolve({
      data: { status: true, data: { unread_count: 99 } },
    });
    await pending;

    expect(store.unreadSummaryCount).toBe(41);
  });

  it('does not restore a summary invalidated while its request was pending', async () => {
    const request = deferred<{
      data: {
        status: boolean;
        data: { unread_count: number; unread_chats: [] };
      };
    }>();
    mockAxiosGet.mockReturnValueOnce(request.promise);

    const store = useChatStore();
    setAccount(store, 'account-a');
    const pending = store.viewUnreadSummary();
    store.resetUnreadSummary();

    request.resolve({
      data: {
        status: true,
        data: { unread_count: 99, unread_chats: [] },
      },
    });
    await pending;

    expect(store.unreadSummaryCount).toBe(0);
    expect(store.unreadSummaryByChatId).toEqual({});
  });

  it('clears the unread projection immediately when the account changes', () => {
    const store = useChatStore();
    setAccount(store, 'account-a');
    store.ensureUnreadSummaryAccountScope('account-a');
    store.unreadSummaryCount = 4;
    store.unreadSummaryByChatId = {
      'chat-a': { unread_count: 4, revision: 3 },
    };

    setAccount(store, 'account-b');
    store.ensureUnreadSummaryAccountScope('account-b');

    expect(store.unreadSummaryCount).toBe(0);
    expect(store.unreadSummaryByChatId).toEqual({});
  });

  it('negative-caches contacts omitted by the batch response', async () => {
    mockAxiosPost.mockResolvedValue({
      data: { status: true, data: [] },
    });
    const store = useChatStore();

    await expect(
      store.getChatContactsByIds(['missing-contact'])
    ).resolves.toEqual([]);
    await expect(
      store.getChatContactsByIds(['missing-contact'])
    ).resolves.toEqual([]);

    expect(mockAxiosPost).toHaveBeenCalledTimes(1);
    expect(mockAxiosPost).toHaveBeenCalledWith('/chat/contacts/batch', {
      contact_ids: ['missing-contact'],
    });
    expect(store.chatContacts['missing-contact']).toBeNull();
  });

  it('clears the menu projection even when the active chat snapshot is already zero', () => {
    const store = useChatStore();
    setAccount(store, 'account-a');
    const activeChat = createStatusChat(
      EChatStatus.in_chat,
      200,
      'active-event'
    );
    activeChat.summary = {
      ...(activeChat.summary ?? {
        last_message: null,
        last_date: null,
        unread_count: 0,
      }),
      unread_count: 0,
      revision: 8,
    };
    store.activeChat = activeChat;
    store.listInChat = [activeChat];
    store.unreadSummaryCount = 3;
    store.unreadSummaryByChatId = {
      [activeChat.chat_id]: { unread_count: 2, revision: 7 },
      'another-chat': { unread_count: 1, revision: 4 },
    };

    expect(store.clearActiveChatUnreadCountLocally()).toBe(true);
    expect(store.unreadSummaryCount).toBe(1);
    expect(store.unreadSummaryByChatId[activeChat.chat_id]).toEqual({
      unread_count: 0,
      revision: 7,
    });
    expect(store.listInChat[0]?.summary?.unread_count).toBe(0);
  });

  it('does not let an older realtime revision restore a locally cleared badge', () => {
    const store = useChatStore();
    setAccount(store, 'account-a');
    const activeChat = createStatusChat(
      EChatStatus.in_chat,
      200,
      'active-event'
    );
    activeChat.summary = {
      ...(activeChat.summary ?? {
        last_message: null,
        last_date: null,
        unread_count: 0,
      }),
      unread_count: 2,
      revision: 7,
    };
    store.activeChat = activeChat;
    store.unreadSummaryCount = 2;
    store.unreadSummaryByChatId = {
      [activeChat.chat_id]: { unread_count: 2, revision: 7 },
    };

    store.clearActiveChatUnreadCountLocally();
    store.reconcileUnreadSummaryFromChat(activeChat);

    expect(store.unreadSummaryCount).toBe(0);
    expect(store.unreadSummaryByChatId[activeChat.chat_id]?.unread_count).toBe(
      0
    );
  });

  it('does not let a late initial HTTP snapshot overwrite a newer realtime count', async () => {
    const request = deferred<{
      data: {
        status: boolean;
        data: {
          unread_count: number;
          unread_chats: Array<{
            chat_id: string;
            unread_count: number;
            revision: number;
          }>;
        };
      };
    }>();
    mockAxiosGet.mockReturnValueOnce(request.promise);

    const store = useChatStore();
    setAccount(store, 'account-a');
    const pending = store.viewUnreadSummary();
    const realtimeChat = createStatusChat(
      EChatStatus.in_chat,
      200,
      'realtime-event'
    );
    realtimeChat.summary = {
      ...(realtimeChat.summary ?? {
        last_message: null,
        last_date: null,
        unread_count: 0,
      }),
      unread_count: 1,
      revision: 8,
    };
    store.reconcileUnreadSummaryFromChat(realtimeChat);

    request.resolve({
      data: {
        status: true,
        data: {
          unread_count: 5,
          unread_chats: [
            {
              chat_id: realtimeChat.chat_id,
              unread_count: 5,
              revision: 7,
            },
          ],
        },
      },
    });
    await pending;

    expect(store.unreadSummaryCount).toBe(1);
    expect(store.unreadSummaryByChatId[realtimeChat.chat_id]).toEqual({
      unread_count: 1,
      revision: 8,
    });
  });

  it('does not commit a late Kanban response from account A into account B', async () => {
    const request = deferred<{ data: { status: boolean; data: unknown } }>();
    mockAxiosGet.mockReturnValueOnce(request.promise);

    const store = useChatStore();
    setAccount(store, 'account-a');
    const pending = store.loadKanbanInitial();

    setAccount(store, 'account-b');
    store.kanbanQueue = [{ chat_id: 'kanban-b' }] as typeof store.kanbanQueue;
    const pagings = {
      current_page: 1,
      total_pages: 1,
      per_page: 50,
      count: 1,
      total: 1,
    };
    request.resolve({
      data: {
        status: true,
        data: {
          chatbot: { results: [], pagings },
          queue: { results: [{ chat_id: 'kanban-a' }], pagings },
          in_chat: { results: [], pagings },
          closed: { results: [], pagings },
        },
      },
    });
    await pending;

    expect(store.kanbanQueue).toEqual([
      expect.objectContaining({ chat_id: 'kanban-b' }),
    ]);
  });

  it('does not commit late active-chat messages from account A into account B', async () => {
    const request = deferred<{ data: { status: boolean; data: unknown } }>();
    mockAxiosGet.mockReturnValueOnce(request.promise);

    const store = useChatStore();
    setAccount(store, 'account-a');
    const pending = store.getChatById(
      { current_page: 1, per_page: 100 },
      'chat-a',
      { preserveMessages: true, skipLoading: true }
    );

    setAccount(store, 'account-b');
    store.listMessages = [
      { message_id: 'message-b', chat_id: 'chat-b' },
    ] as typeof store.listMessages;
    request.resolve({
      data: {
        status: true,
        data: {
          results: [{ message_id: 'message-a', chat_id: 'chat-a' }],
          pagings: { current_page: 1, total_pages: 1 },
        },
      },
    });
    await pending;

    expect(store.listMessages).toEqual([
      expect.objectContaining({ message_id: 'message-b', chat_id: 'chat-b' }),
    ]);
  });

  it('applies the authoritative official-window snapshot after loading messages', async () => {
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        status: true,
        data: {
          results: [],
          pagings: { current_page: 1, total_pages: 1 },
          official_window: {
            is_official: true,
            state: 'open',
            reason: 'customer_service_window_open',
            can_send_freeform: true,
            can_send_template: true,
          },
        },
      },
    });

    const store = useChatStore();
    setAccount(store, 'account-a');
    store.activeChat = {
      chat_id: 'chat-a',
      official_window: {
        state: 'awaiting_contact_reply',
        can_send_freeform: false,
      },
    };

    await store.getChatById({ current_page: 1, per_page: 100 }, 'chat-a', {
      preserveMessages: true,
      skipLoading: true,
    });

    expect(store.activeChat?.official_window).toEqual(
      expect.objectContaining({
        state: 'open',
        can_send_freeform: true,
      })
    );
  });

  it('does not apply a late official-window response to another active chat', async () => {
    const request = deferred<{ data: { status: boolean; data: unknown } }>();
    mockAxiosGet.mockReturnValueOnce(request.promise);

    const store = useChatStore();
    setAccount(store, 'account-a');
    store.activeChat = {
      chat_id: 'chat-a',
      official_window: {
        state: 'awaiting_contact_reply',
        can_send_freeform: false,
      },
    };
    const pending = store.getChatById(
      { current_page: 1, per_page: 100 },
      'chat-a',
      { preserveMessages: true, skipLoading: true }
    );

    store.activeChat = {
      chat_id: 'chat-b',
      official_window: {
        state: 'closed',
        can_send_freeform: false,
      },
    };
    request.resolve({
      data: {
        status: true,
        data: {
          results: [],
          pagings: { current_page: 1, total_pages: 1 },
          official_window: {
            is_official: true,
            state: 'open',
            reason: 'customer_service_window_open',
            can_send_freeform: true,
            can_send_template: true,
          },
        },
      },
    });
    await pending;

    expect(store.activeChat).toEqual({
      chat_id: 'chat-b',
      official_window: {
        state: 'closed',
        can_send_freeform: false,
      },
    });
  });

  it('does not let an older HTTP window overwrite a newer realtime window', async () => {
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        status: true,
        data: {
          results: [],
          pagings: { current_page: 1, total_pages: 1 },
          official_window: {
            is_official: true,
            state: 'awaiting_contact_reply',
            reason: 'customer_reply_required',
            can_send_freeform: false,
            can_send_template: false,
            updated_at: '2026-08-17T12:01:00.000Z',
          },
        },
      },
    });

    const store = useChatStore();
    setAccount(store, 'account-a');
    store.activeChat = {
      chat_id: 'chat-a',
      official_window: {
        state: 'open',
        can_send_freeform: true,
        updated_at: '2026-08-17T12:02:00.000Z',
      },
    };

    await store.getChatById({ current_page: 1, per_page: 100 }, 'chat-a', {
      preserveMessages: true,
      skipLoading: true,
    });

    expect(store.activeChat?.official_window).toEqual({
      state: 'open',
      can_send_freeform: true,
      updated_at: '2026-08-17T12:02:00.000Z',
    });
  });

  it('does not let an older same-chat response overwrite a newer official window', async () => {
    const olderRequest = deferred<{
      data: { status: boolean; data: unknown };
    }>();
    const newerRequest = deferred<{
      data: { status: boolean; data: unknown };
    }>();
    mockAxiosGet
      .mockReturnValueOnce(olderRequest.promise)
      .mockReturnValueOnce(newerRequest.promise);

    const store = useChatStore();
    setAccount(store, 'account-a');
    store.activeChat = {
      chat_id: 'chat-a',
      official_window: {
        state: 'awaiting_contact_reply',
        can_send_freeform: false,
      },
    };

    const olderPending = store.getChatById(
      { current_page: 1, per_page: 100 },
      'chat-a',
      { preserveMessages: true, skipLoading: true }
    );
    const newerPending = store.getChatById(
      { current_page: 1, per_page: 100 },
      'chat-a',
      { preserveMessages: true, skipLoading: true }
    );

    newerRequest.resolve({
      data: {
        status: true,
        data: {
          results: [],
          pagings: { current_page: 1, total_pages: 1 },
          official_window: {
            is_official: true,
            state: 'open',
            reason: 'customer_service_window_open',
            can_send_freeform: true,
            can_send_template: true,
          },
        },
      },
    });
    await newerPending;

    olderRequest.resolve({
      data: {
        status: true,
        data: {
          results: [],
          pagings: { current_page: 1, total_pages: 1 },
          official_window: {
            is_official: true,
            state: 'awaiting_contact_reply',
            reason: 'customer_reply_required',
            can_send_freeform: false,
            can_send_template: false,
          },
        },
      },
    });
    await olderPending;

    expect(store.activeChat?.official_window).toEqual(
      expect.objectContaining({
        state: 'open',
        can_send_freeform: true,
      })
    );
  });

  it('does not commit late list reloads from account A into account B', async () => {
    const requests = [
      deferred<{ data: { status: boolean; data: unknown } }>(),
      deferred<{ data: { status: boolean; data: unknown } }>(),
      deferred<{ data: { status: boolean; data: unknown } }>(),
    ];
    for (const request of requests) {
      mockAxiosGet.mockReturnValueOnce(request.promise);
    }

    const store = useChatStore();
    setAccount(store, 'account-a');
    const pending = store.reloadAllChatLists();

    setAccount(store, 'account-b');
    store.listQueue = [{ chat_id: 'queue-b' }] as typeof store.listQueue;
    store.listInChat = [{ chat_id: 'in-chat-b' }] as typeof store.listInChat;
    store.listChatbot = [{ chat_id: 'chatbot-b' }] as typeof store.listChatbot;
    const lateResponse = {
      data: {
        status: true,
        data: {
          results: [{ chat_id: 'chat-a' }],
          pagings: {},
          counts: null,
        },
      },
    };
    for (const request of requests) {
      request.resolve(lateResponse);
    }
    await pending;

    expect(store.listQueue).toEqual([
      expect.objectContaining({ chat_id: 'queue-b' }),
    ]);
    expect(store.listInChat).toEqual([
      expect.objectContaining({ chat_id: 'in-chat-b' }),
    ]);
    expect(store.listChatbot).toEqual([
      expect.objectContaining({ chat_id: 'chatbot-b' }),
    ]);
  });

  it('keeps a captured chat out of queue when an older list snapshot arrives', () => {
    const store = useChatStore();
    setAccount(store, 'account-a');
    const staleQueue = createStatusChat(EChatStatus.queue, 100, 'queue-event');
    const captured = createStatusChat(
      EChatStatus.in_chat,
      200,
      'capture-event'
    );

    store.listQueue = [];
    store.listInChat = [captured];
    store.activeChat = captured;

    store.updateListsByStatus(
      [EChatStatus.queue, EChatStatus.in_chat],
      [staleQueue],
      false
    );

    expect(store.listQueue).toEqual([]);
    expect(store.listInChat).toEqual([
      expect.objectContaining({
        chat_id: captured.chat_id,
        status: EChatStatus.in_chat,
      }),
    ]);
    expect(store.activeChat).toEqual(
      expect.objectContaining({ status: EChatStatus.in_chat })
    );
  });

  it('does not restore a stale queue count after capture during an HTTP request', async () => {
    const request = deferred<{ data: { status: boolean; data: unknown } }>();
    mockAxiosGet.mockReturnValueOnce(request.promise);

    const store = useChatStore();
    setAccount(store, 'account-a');
    const staleQueue = createStatusChat(EChatStatus.queue, 100, 'queue-event');
    const captured = createStatusChat(
      EChatStatus.in_chat,
      200,
      'capture-event'
    );

    store.listQueue = [staleQueue];
    store.queuePagings = {
      current_page: 1,
      total_pages: 1,
      per_page: 25,
      count: 4,
      total: 4,
    };
    const pending = store.listQueueChats({
      current_page: 1,
      per_page: 25,
      status: EChatStatus.queue,
    });

    store.listQueue = [];
    store.listInChat = [captured];
    store.activeChat = captured;
    store.queuePagings = {
      ...store.queuePagings,
      count: 3,
      total: 3,
    };

    request.resolve({
      data: {
        status: true,
        data: {
          results: [staleQueue],
          pagings: {
            current_page: 1,
            total_pages: 1,
            per_page: 25,
            count: 4,
            total: 4,
          },
        },
      },
    });
    await pending;

    expect(store.listQueue).toEqual([]);
    expect(store.listInChat).toEqual([
      expect.objectContaining({ status: EChatStatus.in_chat }),
    ]);
    expect(store.queuePagings).toEqual(
      expect.objectContaining({ count: 0, total: 3 })
    );
  });

  it('preserves a status transition that happened while a list request was pending', () => {
    const store = useChatStore();
    setAccount(store, 'account-a');
    const staleQueue = createStatusChat(EChatStatus.queue, 100, 'queue-event');
    const captured = createStatusChat(
      EChatStatus.in_chat,
      200,
      'capture-event'
    );

    store.listQueue = [staleQueue];
    const requestFence = store.captureChatStatusSnapshotFence();

    store.listQueue = [];
    store.listInChat = [captured];
    store.activeChat = captured;

    store.updateListsByStatus(
      [EChatStatus.queue, EChatStatus.in_chat],
      [],
      false,
      requestFence
    );

    expect(store.listQueue).toEqual([]);
    expect(store.listInChat).toEqual([
      expect.objectContaining({
        chat_id: captured.chat_id,
        status: EChatStatus.in_chat,
      }),
    ]);
  });

  it('opens the newest snapshot instead of a stale queue fallback', () => {
    const store = useChatStore();
    setAccount(store, 'account-a');
    const staleQueue = createStatusChat(EChatStatus.queue, 100, 'queue-event');
    const captured = createStatusChat(
      EChatStatus.in_chat,
      200,
      'capture-event'
    );

    store.activeChat = null;
    store.listQueue = [staleQueue];
    store.listInChat = [captured];

    store.setActiveChat(captured.chat_id, staleQueue);

    expect(store.activeChat).toEqual(
      expect.objectContaining({
        chat_id: captured.chat_id,
        status: EChatStatus.in_chat,
      })
    );
  });
});
