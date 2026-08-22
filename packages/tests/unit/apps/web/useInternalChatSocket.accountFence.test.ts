import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

type PublicationHandler = (payload: unknown) => void;

const channelHandlers = new Map<string, Set<PublicationHandler>>();
const mockHandleRealtimePayload = jest.fn((payload: unknown) => payload);
const mockEmitNotification = jest.fn();
const mockStore = {
  user: { account_id: 'account-a' },
  handleRealtimePayload: mockHandleRealtimePayload,
  scheduleRefreshConversations: jest.fn(),
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
  async (channel: string, handler: PublicationHandler) => {
    channelHandlers.get(channel)?.delete(handler);
  }
);

interface InternalChatSocket {
  initializeSocket: () => Promise<void>;
  cleanup: () => Promise<void>;
  isInitialized: () => boolean;
}

const loadInternalChatSocket = (): InternalChatSocket => {
  const filename = path.resolve(
    process.cwd(),
    'apps/web/src/composables/useInternalChatSocket.ts'
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
      '@core/common/functions/centrifugoQueue': {
        internalChatAccountCentrifugo: (accountId: string) =>
          `internal_chat#${accountId}`,
      },
      '@/@webcore/centrifugo': {
        acknowledgeRecoveryFallback: jest.fn(() => true),
        addCentrifugoLifecycleListener: jest.fn(() => jest.fn()),
        fetchHistoryAndProcess: jest.fn(async () => ({
          processed: 0,
          recovered: true,
          requiresFallback: false,
        })),
        onMessage: mockOnMessage,
        unsubscribe: mockUnsubscribe,
      },
      '@/@webcore/stores/internalChat': {
        useInternalChatStore: () => mockStore,
      },
      '@/composables/useInternalChatNotifications': {
        emitInternalChatNotificationMessage: mockEmitNotification,
      },
    };

    if (!(moduleId in modules)) {
      throw new Error(
        `Unexpected internal chat socket dependency: ${moduleId}`
      );
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
    loadedModule.exports as unknown as {
      useInternalChatSocket: () => InternalChatSocket;
    }
  ).useInternalChatSocket();
};

describe('useInternalChatSocket account lifecycle fence', () => {
  beforeEach(() => {
    channelHandlers.clear();
    mockHandleRealtimePayload.mockClear();
    mockEmitNotification.mockClear();
    mockOnMessage.mockClear();
    mockUnsubscribe.mockClear();
    mockStore.user = { account_id: 'account-a' };
  });

  it('resubscribes A to B and discards a late event from the old account handler', async () => {
    const socket = loadInternalChatSocket();
    await socket.initializeSocket();
    expect(socket.isInitialized()).toBe(true);

    const oldHandler = [
      ...(channelHandlers.get('internal_chat#account-a') ?? []),
    ][0];
    expect(oldHandler).toBeDefined();

    mockStore.user = { account_id: 'account-b' };
    expect(socket.isInitialized()).toBe(false);
    await socket.initializeSocket();

    expect(mockUnsubscribe).toHaveBeenCalledWith(
      'internal_chat#account-a',
      oldHandler
    );
    expect(socket.isInitialized()).toBe(true);

    oldHandler?.({ id: 'late-account-a-message' });
    const newHandler = [
      ...(channelHandlers.get('internal_chat#account-b') ?? []),
    ][0];
    newHandler?.({ id: 'account-b-message' });

    expect(mockHandleRealtimePayload).not.toHaveBeenCalledWith({
      id: 'late-account-a-message',
    });
    expect(mockHandleRealtimePayload).toHaveBeenCalledTimes(1);
    expect(mockHandleRealtimePayload).toHaveBeenCalledWith({
      id: 'account-b-message',
    });
    expect(mockEmitNotification).toHaveBeenCalledTimes(1);

    await socket.cleanup();
  });
});
