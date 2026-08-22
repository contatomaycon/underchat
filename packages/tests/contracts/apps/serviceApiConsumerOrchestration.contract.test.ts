import 'reflect-metadata';

jest.mock('strip-ansi', () => ({
  __esModule: true,
  default: (value: string) => value,
}));
jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: (value: string) => value,
}));
jest.mock('puppeteer', () => ({
  __esModule: true,
  default: {},
}));
jest.mock('@core/common/functions/createI18nInstance', () => ({
  createI18nInstance: jest.fn(),
}));

interface IServiceApiConsumerOrchestrationModule {
  startServiceApiConsumerSequence(options: {
    starters: Array<() => unknown>;
    isClosing: () => boolean;
    concurrency?: number;
    waitingLogIntervalMs?: number;
    pollIntervalMs?: number;
    consumerStartupTimeoutMs?: number;
    totalStartupTimeoutMs?: number;
    preflightMaxAttempts?: number;
    preflightRetryBaseMs?: number;
    random?: () => number;
    onWaiting?: (
      consumer: unknown,
      snapshot: unknown,
      index: number,
      waitingMs: number
    ) => void;
  }): Promise<void>;
  closeServiceApiConsumerGroup(
    consumers: Array<{ close?: () => Promise<void> }>,
    concurrency?: number
  ): Promise<Array<{ error: unknown }>>;
}

const loadOrchestration = (): IServiceApiConsumerOrchestrationModule =>
  require('../../../../apps/service_api/src/consumer') as IServiceApiConsumerOrchestrationModule;

interface IFakeHealth {
  connected: boolean;
  consuming: boolean;
  assignmentsReady: boolean;
}

function buildFakeConsumer(health: IFakeHealth, close?: () => Promise<void>) {
  return {
    consumer: {
      __health: () => ({
        group_id: 'group-test',
        topics: ['topic-test'],
        connected: health.connected,
        consuming: health.consuming,
        assignments_ready: health.assignmentsReady,
        unhealthy: false,
        pod_replacement_required: false,
        restart_count: 0,
        last_message_at: 0,
        last_commit_at: 0,
        last_restart_at: 0,
        last_error: '',
      }),
    },
    close,
  };
}

async function flushPromises(times = 6): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

describe('Service API Kafka consumer orchestration', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not start the next consumer before the current one is ready', async () => {
    const { startServiceApiConsumerSequence } = loadOrchestration();
    const firstHealth: IFakeHealth = {
      connected: false,
      consuming: false,
      assignmentsReady: false,
    };
    const secondHealth: IFakeHealth = {
      connected: true,
      consuming: true,
      assignmentsReady: true,
    };
    const first = buildFakeConsumer(firstHealth);
    const second = buildFakeConsumer(secondHealth);
    const firstStarter = jest.fn(() => first);
    const secondStarter = jest.fn(() => second);
    const startup = startServiceApiConsumerSequence({
      starters: [firstStarter, secondStarter],
      isClosing: () => false,
      concurrency: 1,
      waitingLogIntervalMs: 1_000,
      pollIntervalMs: 10,
    });

    await flushPromises();
    expect(firstStarter).toHaveBeenCalledTimes(1);
    expect(secondStarter).not.toHaveBeenCalled();

    firstHealth.connected = true;
    firstHealth.consuming = true;
    firstHealth.assignmentsReady = true;
    await jest.advanceTimersByTimeAsync(10);
    await startup;

    expect(secondStarter).toHaveBeenCalledTimes(1);
  });

  it('keeps recovery active after reporting a delayed startup', async () => {
    const { startServiceApiConsumerSequence } = loadOrchestration();
    const health: IFakeHealth = {
      connected: true,
      consuming: false,
      assignmentsReady: false,
    };
    const consumer = buildFakeConsumer(health);
    const onWaiting = jest.fn();
    const startup = startServiceApiConsumerSequence({
      starters: [() => consumer],
      isClosing: () => false,
      concurrency: 1,
      waitingLogIntervalMs: 20,
      pollIntervalMs: 10,
      onWaiting,
    });

    await jest.advanceTimersByTimeAsync(20);
    expect(onWaiting).toHaveBeenCalledWith(
      consumer,
      expect.objectContaining({
        connected: true,
        consuming: false,
        assignments_ready: false,
      }),
      0,
      20
    );

    health.consuming = true;
    health.assignmentsReady = true;
    await jest.advanceTimersByTimeAsync(10);
    await startup;
  });

  it('propagates an asynchronous execute failure to the startup coordinator', async () => {
    const { startServiceApiConsumerSequence } = loadOrchestration();
    const { launchServiceApiConsumerStartup } =
      require('../../../../apps/service_api/src/consumer/startupAttempt') as {
        launchServiceApiConsumerStartup<TConsumer extends object>(
          consumer: TConsumer,
          start: () => Promise<void>,
          onError: (error: unknown) => void
        ): TConsumer;
      };
    const startupError = new Error('async_consumer_start_failed');
    const onError = jest.fn();
    const startup = startServiceApiConsumerSequence({
      starters: [
        () =>
          launchServiceApiConsumerStartup(
            { close: async () => undefined },
            async () => {
              throw startupError;
            },
            onError
          ),
      ],
      isClosing: () => false,
      concurrency: 1,
      pollIntervalMs: 10,
      waitingLogIntervalMs: 1_000,
      consumerStartupTimeoutMs: 1_000,
      totalStartupTimeoutMs: 1_000,
      preflightMaxAttempts: 1,
    });
    const startupExpectation = expect(startup).rejects.toBe(startupError);

    await flushPromises();
    await jest.advanceTimersByTimeAsync(10);

    await startupExpectation;
    expect(onError).toHaveBeenCalledWith(startupError);
  });

  it('recovers a transient pre-runner failure inside the bounded startup attempt', async () => {
    const { startServiceApiConsumerSequence } = loadOrchestration();
    const { launchServiceApiConsumerStartup } =
      require('../../../../apps/service_api/src/consumer/startupAttempt') as {
        launchServiceApiConsumerStartup<TConsumer extends object>(
          consumer: TConsumer,
          start: () => Promise<void>,
          onError: (error: unknown) => void
        ): TConsumer;
      };
    const health: IFakeHealth = {
      connected: false,
      consuming: false,
      assignmentsReady: false,
    };
    const consumer = buildFakeConsumer(health);
    let executeAttempts = 0;
    const startup = startServiceApiConsumerSequence({
      starters: [
        () =>
          launchServiceApiConsumerStartup(
            consumer,
            async () => {
              executeAttempts += 1;
              if (executeAttempts === 1) {
                throw new Error('transient_pre_runner_failure');
              }
              health.connected = true;
              health.consuming = true;
              health.assignmentsReady = true;
            },
            jest.fn()
          ),
      ],
      isClosing: () => false,
      concurrency: 1,
      pollIntervalMs: 10,
      waitingLogIntervalMs: 1_000,
      consumerStartupTimeoutMs: 1_000,
      totalStartupTimeoutMs: 1_000,
      preflightMaxAttempts: 2,
      preflightRetryBaseMs: 10,
      random: () => 1,
    });

    await flushPromises();
    await jest.advanceTimersByTimeAsync(50);
    await startup;

    expect(executeAttempts).toBe(2);
  });

  it('marks startup failed only after the bounded preflight attempts are exhausted', async () => {
    const { startServiceApiConsumerSequence } = loadOrchestration();
    const registry =
      require('../../../../apps/service_api/src/consumer/registry') as {
        getServiceApiConsumerStartupState(): 'starting' | 'ready' | 'failed';
        trackServiceApiConsumerStartup(
          startup: () => Promise<void>
        ): Promise<void>;
      };
    const { launchServiceApiConsumerStartup } =
      require('../../../../apps/service_api/src/consumer/startupAttempt') as {
        launchServiceApiConsumerStartup<TConsumer extends object>(
          consumer: TConsumer,
          start: () => Promise<void>,
          onError: (error: unknown) => void
        ): TConsumer;
      };
    let executeAttempts = 0;
    const startupError = new Error('persistent_pre_runner_failure');
    const startup = registry.trackServiceApiConsumerStartup(() =>
      startServiceApiConsumerSequence({
        starters: [
          () =>
            launchServiceApiConsumerStartup(
              { close: async () => undefined },
              async () => {
                executeAttempts += 1;
                throw startupError;
              },
              jest.fn()
            ),
        ],
        isClosing: () => false,
        concurrency: 1,
        pollIntervalMs: 5,
        waitingLogIntervalMs: 1_000,
        consumerStartupTimeoutMs: 1_000,
        totalStartupTimeoutMs: 1_000,
        preflightMaxAttempts: 3,
        preflightRetryBaseMs: 10,
        random: () => 1,
      })
    );
    const startupExpectation = expect(startup).rejects.toBe(startupError);

    await flushPromises();
    expect(registry.getServiceApiConsumerStartupState()).toBe('starting');
    await jest.advanceTimersByTimeAsync(100);
    await startupExpectation;

    expect(executeAttempts).toBe(3);
    expect(registry.getServiceApiConsumerStartupState()).toBe('failed');
  });

  it('keeps a pending consumer startup active beyond the readiness deadline', async () => {
    const { startServiceApiConsumerSequence } = loadOrchestration();
    const registry =
      require('../../../../apps/service_api/src/consumer/registry') as {
        getServiceApiConsumerStartupState(): 'starting' | 'ready' | 'failed';
        trackServiceApiConsumerStartup(
          startup: () => Promise<void>
        ): Promise<void>;
      };
    const { launchServiceApiConsumerStartup } =
      require('../../../../apps/service_api/src/consumer/startupAttempt') as {
        launchServiceApiConsumerStartup<TConsumer extends object>(
          consumer: TConsumer,
          start: () => Promise<void>,
          onError: (error: unknown) => void
        ): TConsumer;
      };
    const health: IFakeHealth = {
      connected: false,
      consuming: false,
      assignmentsReady: false,
    };
    const consumer = buildFakeConsumer(health);
    let finishStartup: (() => void) | undefined;
    const startup = registry.trackServiceApiConsumerStartup(() =>
      startServiceApiConsumerSequence({
        starters: [
          () =>
            launchServiceApiConsumerStartup(
              consumer,
              () =>
                new Promise<void>((resolve) => {
                  finishStartup = resolve;
                }),
              jest.fn()
            ),
        ],
        isClosing: () => false,
        concurrency: 1,
        pollIntervalMs: 10,
        waitingLogIntervalMs: 1_000,
        consumerStartupTimeoutMs: 30,
        totalStartupTimeoutMs: 30,
      })
    );
    let settled = false;
    void startup.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );

    await flushPromises();
    await jest.advanceTimersByTimeAsync(100);

    expect(settled).toBe(false);
    expect(registry.getServiceApiConsumerStartupState()).toBe('starting');

    health.connected = true;
    health.consuming = true;
    health.assignmentsReady = true;
    await jest.advanceTimersByTimeAsync(10);

    expect(settled).toBe(false);
    expect(registry.getServiceApiConsumerStartupState()).toBe('starting');

    finishStartup?.();
    await jest.advanceTimersByTimeAsync(10);
    await startup;

    expect(registry.getServiceApiConsumerStartupState()).toBe('ready');
  });

  it('applies the readiness deadline after a startup attempt fulfills without health', async () => {
    const { startServiceApiConsumerSequence } = loadOrchestration();
    const { launchServiceApiConsumerStartup } =
      require('../../../../apps/service_api/src/consumer/startupAttempt') as {
        launchServiceApiConsumerStartup<TConsumer extends object>(
          consumer: TConsumer,
          start: () => Promise<void>,
          onError: (error: unknown) => void
        ): TConsumer;
      };
    const consumer = { close: async () => undefined };
    const startup = startServiceApiConsumerSequence({
      starters: [
        () =>
          launchServiceApiConsumerStartup(
            consumer,
            async () => undefined,
            jest.fn()
          ),
      ],
      isClosing: () => false,
      concurrency: 1,
      pollIntervalMs: 10,
      waitingLogIntervalMs: 1_000,
      consumerStartupTimeoutMs: 30,
      totalStartupTimeoutMs: 1_000,
    });
    const startupExpectation = expect(startup).rejects.toThrow(
      'did not become ready'
    );

    await flushPromises();
    await jest.advanceTimersByTimeAsync(40);

    await startupExpectation;
  });

  it('fails a missing consumer startup only after its bounded recovery window', async () => {
    const { startServiceApiConsumerSequence } = loadOrchestration();
    const startup = startServiceApiConsumerSequence({
      starters: [() => ({ close: async () => undefined })],
      isClosing: () => false,
      concurrency: 1,
      pollIntervalMs: 10,
      waitingLogIntervalMs: 1_000,
      consumerStartupTimeoutMs: 30,
      totalStartupTimeoutMs: 1_000,
    });

    await jest.advanceTimersByTimeAsync(20);
    let settled = false;
    void startup.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    await flushPromises();
    expect(settled).toBe(false);

    await jest.advanceTimersByTimeAsync(10);
    await expect(startup).rejects.toThrow('did not become ready within 30ms');
  });

  it('cancels the remaining startup lanes after the first failure', async () => {
    const { startServiceApiConsumerSequence } = loadOrchestration();
    const secondStarter = jest.fn(() =>
      buildFakeConsumer({
        connected: true,
        consuming: true,
        assignmentsReady: true,
      })
    );

    await expect(
      startServiceApiConsumerSequence({
        starters: [
          () => {
            throw new Error('starter_failed');
          },
          secondStarter,
        ],
        isClosing: () => false,
        concurrency: 2,
        waitingLogIntervalMs: 1_000,
        pollIntervalMs: 10,
      })
    ).rejects.toThrow('starter_failed');

    expect(secondStarter).not.toHaveBeenCalled();
  });

  it('limits shutdown concurrency and reports every close failure', async () => {
    const { closeServiceApiConsumerGroup } = loadOrchestration();
    let activeClosures = 0;
    let maximumActiveClosures = 0;
    const close =
      (shouldFail = false) =>
      async (): Promise<void> => {
        activeClosures += 1;
        maximumActiveClosures = Math.max(maximumActiveClosures, activeClosures);
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
        activeClosures -= 1;
        if (shouldFail) {
          throw new Error('close_failed');
        }
      };
    const consumers = [
      buildFakeConsumer(
        { connected: true, consuming: true, assignmentsReady: true },
        close()
      ),
      buildFakeConsumer(
        { connected: true, consuming: true, assignmentsReady: true },
        close(true)
      ),
      buildFakeConsumer(
        { connected: true, consuming: true, assignmentsReady: true },
        close()
      ),
      buildFakeConsumer(
        { connected: true, consuming: true, assignmentsReady: true },
        close(true)
      ),
    ];

    const shutdown = closeServiceApiConsumerGroup(consumers, 2);
    await jest.advanceTimersByTimeAsync(30);
    const failures = await shutdown;

    expect(maximumActiveClosures).toBe(2);
    expect(failures).toHaveLength(2);
    expect(failures.map(({ error }) => (error as Error).message)).toEqual([
      'close_failed',
      'close_failed',
    ]);
  });
});
