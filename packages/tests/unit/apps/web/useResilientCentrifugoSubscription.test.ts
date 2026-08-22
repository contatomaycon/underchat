import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

type MessageHandler = (data: unknown, context: unknown) => void;
type LifecycleEvent =
  | { type: 'connected' }
  | { type: 'connection_lost'; code: number; reason: string }
  | {
      type: 'recovery_failed';
      channel: string;
      reason: 'server_recovery_failed';
    }
  | {
      type: 'subscription_unsubscribed';
      channel: string;
      code: number;
      reason: string;
    };

interface ResilientSubscriptionModule {
  useResilientCentrifugoSubscription: (options: {
    channel: string | (() => string | null);
    handler: MessageHandler;
    onSubscribed?: (channel: string) => void | Promise<void>;
    acknowledgeRecoveryAfterSubscribed?: boolean;
    retryBaseDelayMs?: number;
    retryMaxDelayMs?: number;
  }) => {
    isSubscribed: { value: boolean };
    retryAttempt: { value: number };
    retry: () => void;
    stop: () => void;
  };
}

const onMessage = jest.fn();
const unsubscribe = jest.fn().mockResolvedValue(undefined);
const acknowledgeRecoveryFallback = jest.fn(() => true);
const fetchHistoryAndProcess = jest.fn(async () => ({
  processed: 0,
  recovered: true,
  requiresFallback: false,
}));
let lifecycleListener: ((event: LifecycleEvent) => void) | null = null;
let scopeDispose: (() => void) | null = null;

const loadModule = (): ResilientSubscriptionModule => {
  const filename = path.resolve(
    process.cwd(),
    'apps/web/src/composables/useResilientCentrifugoSubscription.ts'
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
  const loaded = { exports: {} as Record<string, unknown> };
  const moduleRequire = (moduleId: string): unknown => {
    if (moduleId === '@/@webcore/centrifugo') {
      return {
        acknowledgeRecoveryFallback,
        addCentrifugoLifecycleListener: (
          listener: (event: LifecycleEvent) => void
        ) => {
          lifecycleListener = listener;
          return () => {
            lifecycleListener = null;
          };
        },
        onMessage,
        fetchHistoryAndProcess,
        unsubscribe,
      };
    }
    if (moduleId === '@/@webcore/utils/connectionLifecycleDebug') {
      return { logConnectionLifecycleDebug: jest.fn() };
    }
    if (moduleId === 'vue') {
      return {
        onScopeDispose: (callback: () => void) => {
          scopeDispose = callback;
        },
        shallowReadonly: <T>(value: T) => value,
        shallowRef: <T>(value: T) => ({ value }),
        toValue: <T>(value: T | (() => T)) =>
          typeof value === 'function' ? (value as () => T)() : value,
        watch: (
          sourceValue: () => unknown,
          callback: (value: unknown) => void,
          options: { immediate?: boolean }
        ) => {
          if (options.immediate) callback(sourceValue());
          return jest.fn();
        },
      };
    }
    throw new Error(
      `Unexpected resilient subscription dependency: ${moduleId}`
    );
  };
  const evaluate = new Function('require', 'module', 'exports', transpiled) as (
    requireModule: (moduleId: string) => unknown,
    module: typeof loaded,
    exports: Record<string, unknown>
  ) => void;
  evaluate(moduleRequire, loaded, loaded.exports);
  return loaded.exports as unknown as ResilientSubscriptionModule;
};

const flushPromises = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('useResilientCentrifugoSubscription', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    onMessage.mockReset();
    unsubscribe.mockClear();
    acknowledgeRecoveryFallback.mockClear();
    fetchHistoryAndProcess.mockClear();
    lifecycleListener = null;
    scopeDispose = null;
  });

  afterEach(() => {
    scopeDispose?.();
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('recovers an initial token/connection failure without a page refresh', async () => {
    onMessage
      .mockRejectedValueOnce(new Error('token endpoint unavailable'))
      .mockResolvedValueOnce({});
    const { useResilientCentrifugoSubscription } = loadModule();

    const subscription = useResilientCentrifugoSubscription({
      channel: 'worker#account-1',
      handler: jest.fn(),
      retryBaseDelayMs: 100,
      retryMaxDelayMs: 100,
    });

    jest.runOnlyPendingTimers();
    await flushPromises();
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(subscription.isSubscribed.value).toBe(false);

    jest.advanceTimersByTime(100);
    await flushPromises();
    expect(onMessage).toHaveBeenCalledTimes(2);
    expect(subscription.isSubscribed.value).toBe(true);
    expect(subscription.retryAttempt.value).toBe(0);
  });

  it('reinstalls the handler after a terminal subscription event', async () => {
    onMessage.mockResolvedValue({});
    const { useResilientCentrifugoSubscription } = loadModule();
    const subscription = useResilientCentrifugoSubscription({
      channel: 'worker#account-1',
      handler: jest.fn(),
      retryBaseDelayMs: 50,
      retryMaxDelayMs: 50,
    });

    jest.runOnlyPendingTimers();
    await flushPromises();
    expect(subscription.isSubscribed.value).toBe(true);

    lifecycleListener?.({
      type: 'subscription_unsubscribed',
      channel: 'worker#account-1',
      code: 2500,
      reason: 'server restart',
    });
    expect(subscription.isSubscribed.value).toBe(false);
    jest.advanceTimersByTime(50);
    await flushPromises();

    expect(onMessage).toHaveBeenCalledTimes(2);
    expect(subscription.isSubscribed.value).toBe(true);
  });

  it('retries a failed history/API reconciliation without dropping live status', async () => {
    onMessage.mockResolvedValue({});
    const reconcile = jest
      .fn()
      .mockRejectedValueOnce(new Error('history unavailable'))
      .mockResolvedValueOnce(undefined);
    const { useResilientCentrifugoSubscription } = loadModule();
    const subscription = useResilientCentrifugoSubscription({
      channel: 'worker#account-1',
      handler: jest.fn(),
      onSubscribed: reconcile,
      retryBaseDelayMs: 100,
      retryMaxDelayMs: 100,
    });

    jest.runOnlyPendingTimers();
    await flushPromises();
    expect(subscription.isSubscribed.value).toBe(true);
    expect(reconcile).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(100);
    await flushPromises();
    expect(onMessage).toHaveBeenCalledTimes(2);
    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(subscription.retryAttempt.value).toBe(0);
  });

  it('cancels retries and unregisters the handler when its scope stops', async () => {
    onMessage.mockRejectedValue(new Error('offline'));
    const handler = jest.fn();
    const { useResilientCentrifugoSubscription } = loadModule();
    const subscription = useResilientCentrifugoSubscription({
      channel: 'worker#account-1',
      handler,
      retryBaseDelayMs: 100,
      retryMaxDelayMs: 100,
    });

    jest.runOnlyPendingTimers();
    await flushPromises();
    subscription.stop();
    jest.advanceTimersByTime(1_000);
    await flushPromises();

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledWith('worker#account-1', handler);
    expect(subscription.isSubscribed.value).toBe(false);
    expect(lifecycleListener).toBeNull();
  });

  it('acknowledges an authoritative fallback and replays the HTTP race window', async () => {
    onMessage.mockResolvedValue({});
    const reconcile = jest.fn(async () => undefined);
    const { useResilientCentrifugoSubscription } = loadModule();
    useResilientCentrifugoSubscription({
      channel: 'worker#account-1',
      handler: jest.fn(),
      onSubscribed: reconcile,
      acknowledgeRecoveryAfterSubscribed: true,
    });

    jest.runOnlyPendingTimers();
    await flushPromises();
    expect(reconcile).toHaveBeenCalledTimes(1);

    lifecycleListener?.({
      type: 'recovery_failed',
      channel: 'worker#account-1',
      reason: 'server_recovery_failed',
    });
    jest.runOnlyPendingTimers();
    await flushPromises();

    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(acknowledgeRecoveryFallback).toHaveBeenCalledWith(
      'worker#account-1'
    );
    expect(fetchHistoryAndProcess).toHaveBeenCalledWith('worker#account-1');
  });

  it('ignores a late reconciliation rejection after scope disposal', async () => {
    onMessage.mockResolvedValue({});
    let rejectReconciliation!: (error: Error) => void;
    const reconcile = jest.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectReconciliation = reject;
        })
    );
    const { useResilientCentrifugoSubscription } = loadModule();
    const subscription = useResilientCentrifugoSubscription({
      channel: 'worker#account-1',
      handler: jest.fn(),
      onSubscribed: reconcile,
      retryBaseDelayMs: 10,
      retryMaxDelayMs: 10,
    });

    jest.runOnlyPendingTimers();
    await flushPromises();
    subscription.stop();
    rejectReconciliation(new Error('late API failure'));
    await flushPromises();
    jest.advanceTimersByTime(100);
    await flushPromises();

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(subscription.retryAttempt.value).toBe(0);
  });
});
