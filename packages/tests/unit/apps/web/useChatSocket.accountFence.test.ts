import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

type PublicationHandler = (data: any) => void;

const channelHandlers = new Map<string, Set<PublicationHandler>>();
const mockAddChat = jest.fn();
const mockChatStore = {
  user: { account_id: 'account-1', user_id: 'user-1' },
  activeChat: null as null | { chat_id: string },
  listMessages: [] as Array<{ message_id: string }>,
  addChat: mockAddChat,
  addMessageActiveChat: jest.fn(() => 'added'),
  clearActiveChatUnreadCountLocally: jest.fn(),
  findChatInLists: jest.fn(() => null),
  getChatById: jest.fn(async () => true),
  hasActiveKanbanFilters: jest.fn(() => false),
  isActiveChatSummaryOnlyUpdate: jest.fn(() => false),
  loadKanbanInitial: jest.fn(async () => true),
  loadPinnedChats: jest.fn(async () => []),
  reloadAllChatLists: jest.fn(async () => true),
  reconcileUnreadSummaryFromChat: jest.fn(),
  setActiveChat: jest.fn(),
  viewUnreadSummary: jest.fn(async () => 0),
};

const mockOnMessage = jest.fn(
  async (channel: string, handler: PublicationHandler) => {
    const handlers = channelHandlers.get(channel) ?? new Set();
    handlers.add(handler);
    channelHandlers.set(channel, handlers);
    return { channel };
  }
);
const mockUnsubscribe = jest.fn(
  async (channel: string, handler?: PublicationHandler) => {
    if (handler) {
      channelHandlers.get(channel)?.delete(handler);
    } else {
      channelHandlers.delete(channel);
    }
  }
);
const mockFetchHistoryAndProcess = jest.fn<
  Promise<{
    processed: number;
    recovered: boolean;
    requiresFallback: boolean;
  }>,
  [string]
>(async () => ({
  processed: 0,
  recovered: true,
  requiresFallback: false,
}));

type ChatSocket = {
  initializeSocket: () => Promise<void>;
  cleanup: () => Promise<void>;
};

const loadChatSocket = (): ChatSocket => {
  const filename = path.resolve(
    process.cwd(),
    'apps/web/src/composables/useChatSocket.ts'
  );
  const source = fs
    .readFileSync(filename, 'utf8')
    .replaceAll('import.meta.env.DEV', 'false');
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
      vue: { ref: <T>(value: T) => ({ value }) },
      'vue-router': { useRoute: () => ({ name: 'chat' }) },
      '@/@webcore/centrifugo': {
        acknowledgeRecoveryFallback: jest.fn(() => true),
        addCentrifugoLifecycleListener: jest.fn(() => jest.fn()),
        fetchHistoryAndProcess: mockFetchHistoryAndProcess,
        isChannelSubscribed: jest.fn(() => true),
        onMessage: mockOnMessage,
        unsubscribe: mockUnsubscribe,
      },
      '@core/common/functions/centrifugoQueue': {
        chatAccountCentrifugo: (accountId: string) => `chat#${accountId}`,
        chatQueueAccountCentrifugo: (accountId: string) =>
          `chat_queue#${accountId}`,
      },
      '@/@webcore/stores/chat': { useChatStore: () => mockChatStore },
      '@core/common/enums/EChatStatus': {
        EChatStatus: { in_chat: 'in_chat' },
      },
      '@/composables/useChatNotifications': {
        useChatNotifications: () => ({
          handleNewMessage: jest.fn(),
          handleChatStatusChange: jest.fn(),
          handleChatTransfer: jest.fn(async () => false),
        }),
      },
      '@core/common/functions/chatParticipants': {
        isChatParticipant: jest.fn(() => true),
      },
      '@core/common/functions/chatSnapshotRevision': jest.requireActual(
        '@core/common/functions/chatSnapshotRevision'
      ),
    };

    if (!(moduleId in modules)) {
      throw new Error(`Unexpected chat socket dependency: ${moduleId}`);
    }

    return modules[moduleId];
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

  return (
    loadedModule.exports as unknown as { useChatSocket: () => ChatSocket }
  ).useChatSocket();
};

describe('useChatSocket account lifecycle fence', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    channelHandlers.clear();
    mockAddChat.mockClear();
    mockOnMessage.mockClear();
    mockUnsubscribe.mockClear();
    mockFetchHistoryAndProcess.mockReset();
    mockFetchHistoryAndProcess.mockResolvedValue({
      processed: 0,
      recovered: true,
      requiresFallback: false,
    });
    mockChatStore.reloadAllChatLists.mockReset();
    mockChatStore.reloadAllChatLists.mockResolvedValue(true);
    mockChatStore.activeChat = null;
    mockChatStore.user = {
      account_id: 'account-1',
      user_id: 'user-1',
    };
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        visibilityState: 'visible',
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      },
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('discards a buffered publication from the previous account during teardown', async () => {
    const socket = loadChatSocket();
    await socket.initializeSocket();

    const oldHandler = [...(channelHandlers.get('chat#account-1') ?? [])][0];
    expect(oldHandler).toBeDefined();
    oldHandler({
      chat_id: 'chat-from-account-1',
      status: 'queue',
      secondary_users: [],
    });

    mockChatStore.user = {
      account_id: 'account-2',
      user_id: 'user-2',
    };
    await socket.initializeSocket();
    await jest.advanceTimersByTimeAsync(200);

    expect(mockAddChat).not.toHaveBeenCalledWith(
      expect.objectContaining({ chat_id: 'chat-from-account-1' })
    );

    await socket.cleanup();
  });

  it('keeps the newest official window while batching out-of-order chat events', async () => {
    const socket = loadChatSocket();
    await socket.initializeSocket();

    const handler = [...(channelHandlers.get('chat#account-1') ?? [])][0];
    expect(handler).toBeDefined();

    handler({
      chat_id: 'chat-window-race',
      status: 'queue',
      meta: { status_epoch: 10, status_event_id: 'status-10' },
      secondary_users: [],
      official_window: {
        state: 'open',
        updated_at: '2026-08-17T12:02:00.000Z',
      },
    });
    handler({
      chat_id: 'chat-window-race',
      status: 'in_chat',
      meta: { status_epoch: 11, status_event_id: 'status-11' },
      secondary_users: [],
      official_window: {
        state: 'awaiting_contact_reply',
        updated_at: '2026-08-17T12:01:00.000Z',
      },
    });

    await jest.advanceTimersByTimeAsync(200);

    expect(mockAddChat).toHaveBeenCalledTimes(1);
    expect(mockAddChat).toHaveBeenCalledWith(
      expect.objectContaining({
        chat_id: 'chat-window-race',
        status: 'in_chat',
        official_window: expect.objectContaining({
          state: 'open',
          updated_at: '2026-08-17T12:02:00.000Z',
        }),
      })
    );

    await socket.cleanup();
  });

  it('waits for an old API fallback and reloads the new account afterwards', async () => {
    let resolveOldFallback: ((value: boolean) => void) | undefined;
    const oldFallback = new Promise<boolean>((resolve) => {
      resolveOldFallback = resolve;
    });
    const fallbackAccounts: string[] = [];
    mockFetchHistoryAndProcess.mockImplementation(async (channel: string) => ({
      processed: 0,
      recovered: !channel.includes('account-1'),
      requiresFallback: channel.includes('account-1'),
    }));
    mockChatStore.reloadAllChatLists.mockImplementation(async () => {
      const accountId = mockChatStore.user.account_id;
      fallbackAccounts.push(accountId);
      return accountId === 'account-1' ? oldFallback : true;
    });

    const socket = loadChatSocket();
    await socket.initializeSocket();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (fallbackAccounts.length > 0) {
        break;
      }
      await Promise.resolve();
    }
    expect(fallbackAccounts).toEqual(['account-1']);

    mockChatStore.user = {
      account_id: 'account-2',
      user_id: 'user-2',
    };
    const transition = socket.initializeSocket();
    await Promise.resolve();
    expect(fallbackAccounts).toEqual(['account-1']);

    resolveOldFallback?.(true);
    await transition;

    expect(fallbackAccounts.slice(0, 2)).toEqual(['account-1', 'account-2']);

    await socket.cleanup();
  });
});
