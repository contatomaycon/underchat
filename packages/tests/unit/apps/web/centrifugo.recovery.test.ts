import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

type MockEventHandler = (context: any) => void;
type StreamPosition = { offset: number; epoch: string };
type RecoveryResult = {
  recovered: boolean;
  requiresFallback: boolean;
  reason?: string;
};
type CentrifugoModule = {
  acknowledgeRecoveryFallback: (channel: string) => boolean;
  addCentrifugoLifecycleListener: (
    listener: (event: unknown) => void
  ) => () => void;
  fetchHistoryAndProcess: (channel: string) => Promise<RecoveryResult>;
  fetchRecentHistoryAndProcess: (
    channel: string,
    handler: MockEventHandler,
    limit?: number,
    options?: { commitCursor?: boolean }
  ) => Promise<number>;
  getStreamPosition: (channel: string) => StreamPosition | undefined;
  onMessage: (
    channel: string,
    handler: MockEventHandler
  ) => Promise<MockSubscription>;
  resetConnection: () => void;
  unsubscribe: (channel: string, handler?: MockEventHandler) => Promise<void>;
};

const mockAxiosPost = jest.fn();
const mockSubscriptions = new Map<string, MockSubscription>();
const mockCentrifugeClients: MockCentrifuge[] = [];
let mockConnectImmediately = true;
let mockAuthContext = {
  account_id: 'account-1',
  user_id: 'user-1',
};

class MockSubscription {
  state = 'unsubscribed';
  readonly handlers = new Map<string, Set<MockEventHandler>>();
  readonly history = jest.fn();

  constructor(readonly channel: string) {}

  on(event: string, handler: MockEventHandler): void {
    const handlers = this.handlers.get(event) ?? new Set<MockEventHandler>();
    handlers.add(handler);
    this.handlers.set(event, handlers);
  }

  off(event: string, handler: MockEventHandler): void {
    this.handlers.get(event)?.delete(handler);
  }

  emit(event: string, context: any): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(context);
    }
  }

  subscribe(): void {
    this.state = 'subscribed';
    this.emit('subscribed', {
      channel: this.channel,
      recoverable: true,
      positioned: true,
      streamPosition: { offset: 10, epoch: 'epoch-1' },
      wasRecovering: false,
      recovered: false,
      hasRecoveredPublications: false,
    });
  }

  unsubscribe(): void {
    this.state = 'unsubscribed';
    this.emit('unsubscribed', {
      channel: this.channel,
      code: 0,
      reason: 'client unsubscribe',
    });
  }
}

const State = {
  Disconnected: 'disconnected',
  Connecting: 'connecting',
  Connected: 'connected',
};
const SubscriptionState = {
  Unsubscribed: 'unsubscribed',
  Subscribing: 'subscribing',
  Subscribed: 'subscribed',
};

class MockCentrifuge {
  state = State.Disconnected;
  private readonly handlers = new Map<string, Set<MockEventHandler>>();

  constructor() {
    mockCentrifugeClients.push(this);
  }

  on(event: string, handler: MockEventHandler): void {
    const handlers = this.handlers.get(event) ?? new Set<MockEventHandler>();
    handlers.add(handler);
    this.handlers.set(event, handlers);
  }

  off(event: string, handler: MockEventHandler): void {
    this.handlers.get(event)?.delete(handler);
  }

  emit(event: string, context: any): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(context);
    }
  }

  connect(): void {
    if (!mockConnectImmediately) {
      this.state = State.Connecting;
      return;
    }

    this.state = State.Connected;
    this.emit('connected', {});
  }

  disconnect(): void {
    this.state = State.Disconnected;
  }

  getSubscription(channel: string): MockSubscription | null {
    return mockSubscriptions.get(channel) ?? null;
  }

  newSubscription(channel: string): MockSubscription {
    const subscription = new MockSubscription(channel);
    mockSubscriptions.set(channel, subscription);
    return subscription;
  }

  publish(): Promise<Record<string, never>> {
    return Promise.resolve({});
  }
}

const loadCentrifugoModule = (): CentrifugoModule => {
  const filename = path.resolve(
    process.cwd(),
    'apps/web/src/@webcore/centrifugo.ts'
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
      centrifuge: { Centrifuge: MockCentrifuge, State, SubscriptionState },
      axios: { isAxiosError: () => false },
      '@webcore/axios': {
        __esModule: true,
        default: { post: mockAxiosPost },
      },
      './localStorage/user': {
        getTokenJwtData: () => mockAuthContext,
        getUser: () => mockAuthContext,
      },
    };

    if (!(moduleId in modules)) {
      throw new Error(`Unexpected Centrifugo dependency: ${moduleId}`);
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

  return loadedModule.exports as unknown as CentrifugoModule;
};

const {
  acknowledgeRecoveryFallback,
  addCentrifugoLifecycleListener,
  fetchHistoryAndProcess,
  fetchRecentHistoryAndProcess,
  getStreamPosition,
  onMessage,
  resetConnection,
  unsubscribe,
} = loadCentrifugoModule();

describe('web Centrifugo recovery cursor', () => {
  beforeEach(() => {
    resetConnection();
    mockSubscriptions.clear();
    mockCentrifugeClients.length = 0;
    mockConnectImmediately = true;
    mockAuthContext = {
      account_id: 'account-1',
      user_id: 'user-1',
    };
    mockAxiosPost.mockReset();
    mockAxiosPost.mockResolvedValue({
      data: {
        status: true,
        data: { token: 'token', url: 'ws://centrifugo.test' },
      },
    });
  });

  afterAll(() => {
    resetConnection();
  });

  it('keeps the prior cursor until failed recovery is replaced by an API baseline', async () => {
    const channel = 'chat#account-1';
    const handler = jest.fn();
    await onMessage(channel, handler);
    const subscription = mockSubscriptions.get(channel);
    expect(subscription).toBeDefined();
    expect(getStreamPosition(channel)).toEqual({
      offset: 10,
      epoch: 'epoch-1',
    });

    subscription?.emit('subscribed', {
      channel,
      recoverable: true,
      positioned: true,
      streamPosition: { offset: 20, epoch: 'epoch-2' },
      wasRecovering: true,
      recovered: false,
      hasRecoveredPublications: false,
    });

    expect(getStreamPosition(channel)).toEqual({
      offset: 10,
      epoch: 'epoch-1',
    });
    subscription?.history.mockResolvedValue({
      publications: [],
      offset: 20,
      epoch: 'epoch-2',
    });

    await expect(fetchHistoryAndProcess(channel)).resolves.toMatchObject({
      recovered: false,
      requiresFallback: true,
      reason: 'history_gap',
    });
    expect(getStreamPosition(channel)).toEqual({
      offset: 10,
      epoch: 'epoch-1',
    });

    expect(acknowledgeRecoveryFallback(channel)).toBe(true);
    expect(getStreamPosition(channel)).toEqual({
      offset: 20,
      epoch: 'epoch-2',
    });
  });

  it('advances recovered publications only after handlers process them', async () => {
    const channel = 'chat#account-1';
    const handler = jest.fn();
    await onMessage(channel, handler);
    const subscription = mockSubscriptions.get(channel);

    subscription?.emit('subscribed', {
      channel,
      recoverable: true,
      positioned: true,
      streamPosition: { offset: 12, epoch: 'epoch-1' },
      wasRecovering: true,
      recovered: true,
      hasRecoveredPublications: true,
    });
    expect(getStreamPosition(channel)?.offset).toBe(10);

    subscription?.emit('publication', { data: { id: 11 }, offset: 11 });
    expect(handler).toHaveBeenLastCalledWith(
      { id: 11 },
      expect.objectContaining({ offset: 11 })
    );
    expect(getStreamPosition(channel)?.offset).toBe(11);

    subscription?.emit('publication', { data: { id: 12 }, offset: 12 });
    expect(getStreamPosition(channel)?.offset).toBe(12);
  });

  it('replays modal history locally without advancing the account cursor', async () => {
    const channel = 'chat#account-1';
    await onMessage(channel, jest.fn());
    const subscription = mockSubscriptions.get(channel);
    const modalHandler = jest.fn();
    subscription?.history.mockResolvedValue({
      publications: [
        { data: { id: 12 }, offset: 12 },
        { data: { id: 11 }, offset: 11 },
      ],
      offset: 12,
      epoch: 'epoch-1',
    });

    await expect(
      fetchRecentHistoryAndProcess(channel, modalHandler, 100, {
        commitCursor: false,
      })
    ).resolves.toBe(2);
    expect(modalHandler.mock.calls.map(([data]) => data.id)).toEqual([11, 12]);
    expect(getStreamPosition(channel)).toEqual({
      offset: 10,
      epoch: 'epoch-1',
    });
  });

  it('blocks the cursor when a publication handler fails', async () => {
    const channel = 'chat#account-1';
    const listener = jest.fn();
    const removeListener = addCentrifugoLifecycleListener(listener);
    const handler = jest.fn(() => {
      throw new Error('render failed');
    });
    await onMessage(channel, handler);

    mockSubscriptions.get(channel)?.emit('publication', {
      data: { id: 11 },
      offset: 11,
    });

    expect(getStreamPosition(channel)?.offset).toBe(10);
    expect(listener).toHaveBeenCalledWith({
      type: 'recovery_failed',
      channel,
      reason: 'publication_handler_failed',
    });
    removeListener();
  });

  it('surfaces terminal subscription loss to the lifecycle owner', async () => {
    const channel = 'chat#account-1';
    const listener = jest.fn();
    const removeListener = addCentrifugoLifecycleListener(listener);
    await onMessage(channel, jest.fn());

    mockSubscriptions.get(channel)?.emit('unsubscribed', {
      channel,
      code: 2500,
      reason: 'permission denied',
    });

    expect(listener).toHaveBeenCalledWith({
      type: 'subscription_unsubscribed',
      channel,
      code: 2500,
      reason: 'permission denied',
    });
    removeListener();
  });

  it('waits for an existing handler subscription to become active again', async () => {
    const channel = 'chat#account-1';
    const handler = jest.fn();
    const firstSubscription = await onMessage(channel, handler);
    firstSubscription.unsubscribe();

    const restoredSubscription = await onMessage(channel, handler);
    restoredSubscription.emit('publication', {
      data: { id: 'message-after-resubscribe' },
      offset: 11,
    });

    expect(restoredSubscription).toBe(firstSubscription);
    expect(restoredSubscription.state).toBe('subscribed');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('rebinds lifecycle handlers when a removed subscription is reused', async () => {
    const channel = 'chat#account-1';
    const firstHandler = jest.fn();
    const firstSubscription = await onMessage(channel, firstHandler);

    await unsubscribe(channel, firstHandler);

    const nextHandler = jest.fn();
    const reusedSubscription = await onMessage(channel, nextHandler);
    reusedSubscription.emit('publication', {
      data: { id: 'message-after-cleanup' },
      offset: 11,
    });

    expect(reusedSubscription).toBe(firstSubscription);
    expect(firstHandler).not.toHaveBeenCalled();
    expect(nextHandler).toHaveBeenCalledWith(
      { id: 'message-after-cleanup' },
      expect.objectContaining({ offset: 11 })
    );
    // The mock does not acknowledge server-side recovery on resubscribe, so
    // the cursor deliberately remains blocked until the API fallback runs.
    expect(getStreamPosition(channel)?.offset).toBe(10);
  });

  it('does not let a late failure from an old auth client clear the new account subscriptions', async () => {
    mockConnectImmediately = false;
    const oldConnectionResult = onMessage('chat#account-1', jest.fn()).catch(
      (error: unknown) => error
    );

    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (mockCentrifugeClients.length === 1) {
        break;
      }
      await Promise.resolve();
    }
    expect(mockCentrifugeClients).toHaveLength(1);
    const oldClient = mockCentrifugeClients[0];

    mockAuthContext = {
      account_id: 'account-2',
      user_id: 'user-2',
    };
    mockConnectImmediately = true;
    const newHandler = jest.fn();
    const newSubscription = await onMessage('chat#account-2', newHandler);

    expect(mockCentrifugeClients).toHaveLength(2);
    oldClient.emit('disconnected', {
      code: 3500,
      reason: 'late old connection failure',
    });
    await expect(oldConnectionResult).resolves.toBeInstanceOf(Error);

    newSubscription.emit('publication', {
      data: { id: 'new-account-message' },
      offset: 11,
    });

    expect(newHandler).toHaveBeenCalledWith(
      { id: 'new-account-message' },
      expect.objectContaining({ offset: 11 })
    );
  });
});
