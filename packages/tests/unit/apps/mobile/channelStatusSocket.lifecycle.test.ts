import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const onMessage = jest.fn();
const unsubscribe = jest.fn();
const isChannelSubscribed = jest.fn();
const addConnectionListener = jest.fn(() => jest.fn());
const addRecoveryListener = jest.fn(() => jest.fn());

interface ChannelStatusSocketModule {
  initializeChannelStatusSocket(accountId: string): Promise<void>;
  cleanupChannelStatusSocket(): Promise<void>;
  isChannelStatusSocketInitialized(accountId?: string): boolean;
}

const deferred = <T,>() => {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
};

const loadModule = (): ChannelStatusSocketModule => {
  const filename = resolve(
    process.cwd(),
    'apps/mobile/socket/channelStatusSocket.ts'
  );
  const source = readFileSync(filename, 'utf8');
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
    if (moduleId === './centrifugo') {
      return {
        addCentrifugoConnectionListener: addConnectionListener,
        addCentrifugoRecoveryFailedListener: addRecoveryListener,
        isChannelSubscribed,
        onMessage,
        unsubscribe,
      };
    }
    throw new Error(`Unexpected channel status dependency: ${moduleId}`);
  };
  const evaluate = new Function('require', 'module', 'exports', transpiled) as (
    requireModule: (moduleId: string) => unknown,
    module: typeof loaded,
    exports: Record<string, unknown>
  ) => void;
  evaluate(moduleRequire, loaded, loaded.exports);
  return loaded.exports as unknown as ChannelStatusSocketModule;
};

describe('mobile channel status socket lifecycle fencing', () => {
  beforeEach(() => {
    onMessage.mockReset();
    unsubscribe.mockReset().mockResolvedValue(undefined);
    isChannelSubscribed.mockReset().mockReturnValue(false);
  });

  it('single-flights concurrent initialization for the same account', async () => {
    const subscription = deferred<void>();
    onMessage.mockReturnValue(subscription.promise);
    const socket = loadModule();

    const first = socket.initializeChannelStatusSocket('account-a');
    const second = socket.initializeChannelStatusSocket('account-a');

    expect(second).toBe(first);
    expect(onMessage).toHaveBeenCalledTimes(1);
    subscription.resolve();
    await Promise.all([first, second]);
  });

  it('invalidates a pending initialization on unmount cleanup', async () => {
    const subscription = deferred<void>();
    onMessage.mockReturnValue(subscription.promise);
    const socket = loadModule();
    const initializing = socket
      .initializeChannelStatusSocket('account-a')
      .catch((error: Error) => error);

    await socket.cleanupChannelStatusSocket();
    subscription.resolve();

    const result = await initializing;
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).name).toBe(
      'ChannelStatusInitializationCancelledError'
    );
    expect(socket.isChannelStatusSocketInitialized('account-a')).toBe(false);
    expect(unsubscribe).toHaveBeenCalledWith(
      'worker:account#account-a',
      expect.any(Function)
    );
  });

  it('keeps the new account when the retired account resolves late', async () => {
    const firstSubscription = deferred<void>();
    const secondSubscription = deferred<void>();
    const subscribed = new Set<string>();
    onMessage.mockImplementation((channel: string) => {
      const pending = channel.endsWith('account-a')
        ? firstSubscription
        : secondSubscription;
      return pending.promise.then(() => {
        subscribed.add(channel);
      });
    });
    unsubscribe.mockImplementation(async (channel: string) => {
      subscribed.delete(channel);
    });
    isChannelSubscribed.mockImplementation((channel: string) =>
      subscribed.has(channel)
    );
    const socket = loadModule();

    const retired = socket
      .initializeChannelStatusSocket('account-a')
      .catch((error: Error) => error);
    const current = socket.initializeChannelStatusSocket('account-b');

    secondSubscription.resolve();
    await current;
    firstSubscription.resolve();
    expect(await retired).toBeInstanceOf(Error);

    expect(socket.isChannelStatusSocketInitialized('account-b')).toBe(true);
    expect(socket.isChannelStatusSocketInitialized('account-a')).toBe(false);
    expect(unsubscribe).toHaveBeenCalledWith(
      'worker:account#account-a',
      expect.any(Function)
    );
    expect(unsubscribe).not.toHaveBeenCalledWith(
      'worker:account#account-b',
      expect.any(Function)
    );
  });
});
