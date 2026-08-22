export {};

type DeferredConsumer = {
  execute?: jest.Mock<Promise<void>, []>;
  close: jest.Mock<Promise<void>, []>;
};
type DeferredConsumerStarterArgs = [
  server: unknown,
  onCreated?: (consumer: DeferredConsumer) => void,
];

const mockWwebjsQrStart = jest.fn();
const mockBaileysQrStart = jest.fn();
const mockWwebjsStarter = jest.fn<
  Promise<DeferredConsumer>,
  DeferredConsumerStarterArgs
>(async () => ({
  close: jest.fn(async (): Promise<void> => undefined),
}));
const mockBaileysStarter = jest.fn<
  Promise<DeferredConsumer>,
  DeferredConsumerStarterArgs
>(async () => ({
  close: jest.fn(async (): Promise<void> => undefined),
}));
const mockRegisteredWorkerConsumers: Array<{
  execute?: () => Promise<void>;
  close?: () => Promise<void>;
}> = [];
const mockRegisterWorkerConsumer = jest.fn(
  (consumer: {
    execute?: () => Promise<void>;
    close?: () => Promise<void>;
  }) => {
    mockRegisteredWorkerConsumers.push(consumer);
  }
);
const mockUnregisterWorkerConsumer = jest.fn(
  (consumer: {
    execute?: () => Promise<void>;
    close?: () => Promise<void>;
  }) => {
    const index = mockRegisteredWorkerConsumers.indexOf(consumer);
    if (index < 0) {
      return false;
    }
    mockRegisteredWorkerConsumers.splice(index, 1);
    return true;
  }
);
const mockWwebjsSetKafkaConsumersProviderReady = jest.fn(
  async (_ready: boolean) => undefined
);
const mockBaileysSetKafkaConsumersProviderReady = jest.fn(
  async (_ready: boolean) => undefined
);
const mockWwebjsReconcileKafkaConsumers = jest.fn(
  async (_log: unknown, _trigger?: string) => undefined
);
const mockBaileysReconcileKafkaConsumers = jest.fn(
  async (_log: unknown, _trigger?: string) => undefined
);
const mockWwebjsStartKafkaConsumerSupervisor = jest.fn();
const mockBaileysStartKafkaConsumerSupervisor = jest.fn();
const mockWwebjsWaitForKafkaConsumersReady = jest.fn(async () => undefined);
const mockBaileysWaitForKafkaConsumersReady = jest.fn(async () => undefined);
const mockRuntimeDesiredStates: Record<
  'baileys' | 'wwebjs',
  boolean | undefined
> = {
  baileys: undefined,
  wwebjs: undefined,
};
const mockDesiredStateListeners = new Map<
  'baileys' | 'wwebjs',
  (ready: boolean) => void
>();
const mockRuntimeStateListeners = new Map<
  'baileys' | 'wwebjs',
  (ready: boolean) => void | Promise<void>
>();
const mockDatabaseGuardOptions: Array<{
  provider: RuntimeProvider;
  onSuspend: () => Promise<void>;
  reacquireFence: () => Promise<void>;
  onResume: () => Promise<void>;
}> = [];
const mockDatabaseGuardStart = jest.fn();
const mockDatabaseGuardStop = jest.fn();
const mockDatabaseGuardReportSessionLeaseLost = jest.fn(async () => undefined);
let mockBaileysSessionLeaseLostListener:
  (() => void | Promise<void>) | undefined;
const mockBeginSessionLeaseRecoveryResume = jest.fn<number | undefined, []>(
  () => undefined
);
const mockStartSessionLeaseRecoverySocket = jest.fn(() => true);
const mockMarkSessionLeaseRecoveryCompleted = jest.fn(() => true);
const mockAbortSessionLeaseRecoveryResume = jest.fn();
const mockWwebjsEnvironment = {
  wwebjsWorkerId: 'worker-wwebjs',
  wwebjsAccountId: 'account-wwebjs',
  runtimeGeneration: 7 as number | string,
  isWarmStandby: true,
  isRuntimeActivated: false,
};
const mockBaileysEnvironment = {
  baileysWorkerId: 'worker-baileys',
  baileysAccountId: 'account-baileys',
  runtimeGeneration: 7 as number | string,
  isWarmStandby: true,
  isRuntimeActivated: false,
};
const mockRuntimeService = {
  bootstrapConnection: jest.fn(async (): Promise<void> => undefined),
  verifyCurrentSession: jest.fn(async () => ({
    session_ready: true,
    can_send: true,
    can_receive_runtime: true,
    authenticated: true,
  })),
  start: jest.fn(),
  stop: jest.fn(),
  shutdown: jest.fn(async () => undefined),
  suspend: jest.fn(async () => undefined),
  refreshPersistedSessionState: jest.fn(async () => true),
  activateWhatsappRuntimeFence: jest.fn(async () => ({
    connection_sequence: 1,
    already_active: false,
  })),
  resolveWhatsappRuntimeOwnedConnectionFence: jest.fn(async () => null),
  canRecoverRestorableSession: jest.fn(() => false),
  ensureRestorableSessionRecovery: jest.fn(() => false),
  onSessionLeaseLost: jest.fn((listener: () => void | Promise<void>) => {
    mockBaileysSessionLeaseLostListener = listener;
    return () => {
      if (mockBaileysSessionLeaseLostListener === listener) {
        mockBaileysSessionLeaseLostListener = undefined;
      }
    };
  }),
  beginSessionLeaseRecoveryResume: mockBeginSessionLeaseRecoveryResume,
  startSessionLeaseRecoverySocket: mockStartSessionLeaseRecoverySocket,
  markSessionLeaseRecoveryCompleted: mockMarkSessionLeaseRecoveryCompleted,
  abortSessionLeaseRecoveryResume: mockAbortSessionLeaseRecoveryResume,
};

jest.mock('fastify-plugin', () => ({
  __esModule: true,
  default: jest.fn((plugin: unknown) => plugin),
}));

jest.mock('tsyringe', () => ({
  container: {
    resolve: jest.fn(() => mockRuntimeService),
  },
}));

jest.mock('@core/services/wwebjs/methods/healthCheck.service', () => ({
  WwebjsHealthCheckService: class {},
}));
jest.mock('@core/services/baileys/methods/healthCheck.service', () => ({
  BaileysHealthCheckService: class {},
}));
jest.mock('@core/services/wwebjs', () => ({ WwebjsService: class {} }));
jest.mock('@core/services/baileys', () => ({ BaileysService: class {} }));
jest.mock('@core/services/workerSelfMonitor.service', () => ({
  WorkerSelfMonitorService: class {},
}));
jest.mock('@core/services/workerRuntimeDatabase.service', () => ({
  WorkerRuntimeDatabaseService: class {},
}));
jest.mock('@core/services/workerDatabaseAvailabilityGuard.service', () => ({
  WorkerDatabaseAvailabilityGuard: class {
    constructor(options: (typeof mockDatabaseGuardOptions)[number]) {
      mockDatabaseGuardOptions.push(options);
    }

    start(): void {
      mockDatabaseGuardStart();
    }

    stop(): void {
      mockDatabaseGuardStop();
    }

    reportSessionLeaseLost(): Promise<void> {
      return mockDatabaseGuardReportSessionLeaseLost();
    }
  },
}));
jest.mock('@core/common/enums/EWorkerType', () => ({
  EWorkerType: { wwebjs: 'wwebjs', baileys: 'baileys' },
}));
jest.mock('@core/config/environments', () => ({
  wwebjsEnvironment: mockWwebjsEnvironment,
  baileysEnvironment: mockBaileysEnvironment,
}));
jest.mock('@core/common/functions/workerProviderRuntimeState', () => ({
  emitWorkerProviderRuntimeState: jest.fn(
    async (provider: 'baileys' | 'wwebjs', ready: boolean) => {
      mockRuntimeDesiredStates[provider] = ready;
    }
  ),
  getWorkerProviderRuntimeState: jest.fn(
    (provider: 'baileys' | 'wwebjs') => mockRuntimeDesiredStates[provider]
  ),
  subscribeWorkerProviderRuntimeDesiredState: jest.fn(
    (provider: 'baileys' | 'wwebjs', listener: (ready: boolean) => void) => {
      mockDesiredStateListeners.set(provider, listener);
      return () => mockDesiredStateListeners.delete(provider);
    }
  ),
  subscribeWorkerProviderRuntimeState: jest.fn(
    (
      provider: 'baileys' | 'wwebjs',
      listener: (ready: boolean) => void | Promise<void>
    ) => {
      mockRuntimeStateListeners.set(provider, listener);
      return () => mockRuntimeStateListeners.delete(provider);
    }
  ),
}));

jest.mock(
  '../../../../apps/worker_wwebjs/src/consumer/connectionQrCode.consume',
  () => ({
    startConnectionQrCodeWwebjsConsume: mockWwebjsQrStart,
  })
);
jest.mock(
  '../../../../apps/worker_wwebjs/src/consumer/workerCommandIngress.consume',
  () => ({
    startWorkerCommandIngressWwebjsConsume: mockWwebjsStarter,
  })
);
jest.mock(
  '../../../../apps/worker_baileys/src/consumer/connectionQrCode.consume',
  () => ({ startConnectionQrCodeConsume: mockBaileysQrStart })
);
jest.mock(
  '../../../../apps/worker_baileys/src/consumer/workerCommandIngress.consume',
  () => ({ startWorkerCommandIngressConsume: mockBaileysStarter })
);
jest.mock('../../../../apps/worker_wwebjs/src/consumer/registry', () => ({
  getKafkaConsumerHealthSnapshots: jest.fn(() => []),
  getWorkerConsumers: jest.fn(() => [...mockRegisteredWorkerConsumers]),
  hasUnhealthyKafkaConsumer: jest.fn(() => false),
  reconcileKafkaConsumers: mockWwebjsReconcileKafkaConsumers,
  registerWorkerConsumer: mockRegisterWorkerConsumer,
  unregisterWorkerConsumer: mockUnregisterWorkerConsumer,
  setKafkaConsumersProviderReady: mockWwebjsSetKafkaConsumersProviderReady,
  startKafkaConsumerSupervisor: mockWwebjsStartKafkaConsumerSupervisor,
  waitForKafkaConsumersReady: mockWwebjsWaitForKafkaConsumersReady,
}));
jest.mock('../../../../apps/worker_baileys/src/consumer/registry', () => ({
  getKafkaConsumerHealthSnapshots: jest.fn(() => []),
  getWorkerConsumers: jest.fn(() => [...mockRegisteredWorkerConsumers]),
  hasUnhealthyKafkaConsumer: jest.fn(() => false),
  reconcileKafkaConsumers: mockBaileysReconcileKafkaConsumers,
  registerWorkerConsumer: mockRegisterWorkerConsumer,
  unregisterWorkerConsumer: mockUnregisterWorkerConsumer,
  setKafkaConsumersProviderReady: mockBaileysSetKafkaConsumersProviderReady,
  startKafkaConsumerSupervisor: mockBaileysStartKafkaConsumerSupervisor,
  waitForKafkaConsumersReady: mockBaileysWaitForKafkaConsumersReady,
}));

interface RuntimeActivationModule {
  default?: (fastify: never) => Promise<void>;
  activateWwebjsRuntime?: (
    fastify: never
  ) => Promise<{ alreadyActive?: boolean }>;
  activateBaileysRuntime?: (
    fastify: never
  ) => Promise<{ alreadyActive?: boolean }>;
}

type RuntimeProvider = 'baileys' | 'wwebjs';
type RuntimeActivator = (
  fastify: never
) => Promise<{ alreadyActive?: boolean }>;

function getRuntimeActivator(
  runtime: RuntimeActivationModule,
  provider: RuntimeProvider
): RuntimeActivator {
  const activate =
    provider === 'wwebjs'
      ? runtime.activateWwebjsRuntime
      : runtime.activateBaileysRuntime;
  if (!activate) {
    throw new Error(`${provider} runtime activator was not exported`);
  }
  return activate;
}

function deferred() {
  let resolve: ((value: DeferredConsumer) => void) | undefined;
  const promise = new Promise<DeferredConsumer>((resolver) => {
    resolve = resolver;
  });
  if (!resolve) {
    throw new Error('Deferred resolver was not captured');
  }
  return { promise, resolve };
}

function deferredVoid() {
  let resolve: (() => void) | undefined;
  let reject: ((error: Error) => void) | undefined;
  const promise = new Promise<void>((resolver, rejecter) => {
    resolve = resolver;
    reject = rejecter;
  });
  if (!resolve || !reject) {
    throw new Error('Deferred void handlers were not captured');
  }
  return { promise, resolve, reject };
}

async function flushPromises(times = 8): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

const wwebjsRuntime =
  require('../../../../apps/worker_wwebjs/src/consumer') as RuntimeActivationModule;
const baileysRuntime =
  require('../../../../apps/worker_baileys/src/consumer') as RuntimeActivationModule;

function makeFastify() {
  return {
    qrStreamReady: false,
    log: {
      error: jest.fn(),
      info: jest.fn(),
    },
    addHook: jest.fn(),
  } as never;
}

function getFastifyHook(
  fastify: ReturnType<typeof makeFastify>,
  hookName: string
): () => Promise<void> {
  const addHook = (fastify as unknown as { addHook: jest.Mock }).addHook;
  const hook = addHook.mock.calls.find(([name]) => name === hookName)?.[1];
  if (!hook) {
    throw new Error(`Hook ${hookName} was not registered`);
  }
  return hook as () => Promise<void>;
}

describe('warm worker runtime activation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDatabaseGuardOptions.length = 0;
    mockWwebjsEnvironment.isWarmStandby = true;
    mockWwebjsEnvironment.isRuntimeActivated = false;
    mockWwebjsEnvironment.runtimeGeneration = 7;
    mockBaileysEnvironment.isWarmStandby = true;
    mockBaileysEnvironment.isRuntimeActivated = false;
    mockBaileysEnvironment.runtimeGeneration = 7;
    mockWwebjsStarter.mockReset();
    mockWwebjsStarter.mockImplementation(async () => ({
      close: jest.fn(async (): Promise<void> => undefined),
    }));
    mockBaileysStarter.mockReset();
    mockBaileysStarter.mockImplementation(async () => ({
      close: jest.fn(async (): Promise<void> => undefined),
    }));
    mockRuntimeService.verifyCurrentSession.mockReset();
    mockRuntimeService.verifyCurrentSession.mockResolvedValue({
      session_ready: true,
      can_send: true,
      can_receive_runtime: true,
      authenticated: true,
    });
    mockRuntimeService.bootstrapConnection.mockReset();
    mockRuntimeService.bootstrapConnection.mockResolvedValue(undefined);
    mockRegisteredWorkerConsumers.length = 0;
    mockRuntimeDesiredStates.baileys = undefined;
    mockRuntimeDesiredStates.wwebjs = undefined;
    mockDesiredStateListeners.clear();
    mockRuntimeStateListeners.clear();
    mockBaileysSessionLeaseLostListener = undefined;
    mockBeginSessionLeaseRecoveryResume.mockReset();
    mockBeginSessionLeaseRecoveryResume.mockReturnValue(undefined);
    mockStartSessionLeaseRecoverySocket.mockReset();
    mockStartSessionLeaseRecoverySocket.mockReturnValue(true);
    mockMarkSessionLeaseRecoveryCompleted.mockReset();
    mockMarkSessionLeaseRecoveryCompleted.mockReturnValue(true);
    mockAbortSessionLeaseRecoveryResume.mockReset();
    mockWwebjsSetKafkaConsumersProviderReady.mockReset();
    mockWwebjsSetKafkaConsumersProviderReady.mockResolvedValue(undefined);
    mockBaileysSetKafkaConsumersProviderReady.mockReset();
    mockBaileysSetKafkaConsumersProviderReady.mockResolvedValue(undefined);
    mockWwebjsReconcileKafkaConsumers.mockReset();
    mockWwebjsReconcileKafkaConsumers.mockResolvedValue(undefined);
    mockBaileysReconcileKafkaConsumers.mockReset();
    mockBaileysReconcileKafkaConsumers.mockResolvedValue(undefined);
    mockWwebjsStartKafkaConsumerSupervisor.mockReset();
    mockBaileysStartKafkaConsumerSupervisor.mockReset();
    mockWwebjsWaitForKafkaConsumersReady.mockReset();
    mockWwebjsWaitForKafkaConsumersReady.mockResolvedValue(undefined);
    mockBaileysWaitForKafkaConsumersReady.mockReset();
    mockBaileysWaitForKafkaConsumersReady.mockResolvedValue(undefined);
  });

  it.each([
    {
      provider: 'wwebjs' as const,
      modulePath: '../../../../apps/worker_wwebjs/src/consumer',
      qrStarter: mockWwebjsQrStart,
      setProviderReady: mockWwebjsSetKafkaConsumersProviderReady,
      environment: mockWwebjsEnvironment,
      workerId: 'worker-wwebjs',
      accountId: 'account-wwebjs',
    },
    {
      provider: 'baileys' as const,
      modulePath: '../../../../apps/worker_baileys/src/consumer',
      qrStarter: mockBaileysQrStart,
      setProviderReady: mockBaileysSetKafkaConsumersProviderReady,
      environment: mockBaileysEnvironment,
      workerId: 'worker-baileys',
      accountId: 'account-baileys',
    },
  ])(
    'suspends the $provider runtime and reacquires its durable fence before resume',
    async ({
      provider,
      modulePath,
      qrStarter,
      setProviderReady,
      environment,
      workerId,
      accountId,
    }) => {
      environment.isWarmStandby = false;
      environment.isRuntimeActivated = true;
      environment.runtimeGeneration = 7;
      mockRuntimeDesiredStates[provider] = false;
      const qrConsumer = {
        execute: jest.fn(async (): Promise<void> => undefined),
        close: jest.fn(async (): Promise<void> => undefined),
      };
      qrStarter.mockReset();
      qrStarter.mockResolvedValue(qrConsumer);

      jest.resetModules();
      const runtime = require(modulePath) as RuntimeActivationModule;
      const fastify = makeFastify();
      await runtime.default?.(fastify);
      await getRuntimeActivator(runtime, provider)(fastify);

      const guardOptions = mockDatabaseGuardOptions.find(
        (options) => options.provider === provider
      );
      if (!guardOptions) {
        throw new Error(`${provider} database guard was not created`);
      }
      expect(mockDatabaseGuardStart).toHaveBeenCalledTimes(1);

      await guardOptions.onSuspend();

      expect(qrConsumer.close).toHaveBeenCalledTimes(1);
      if (provider === 'baileys') {
        expect(mockRuntimeService.suspend).toHaveBeenCalledTimes(1);
        expect(mockRuntimeService.shutdown).not.toHaveBeenCalled();
      } else {
        expect(mockRuntimeService.shutdown).toHaveBeenCalledTimes(1);
        expect(mockRuntimeService.suspend).not.toHaveBeenCalled();
      }
      expect(setProviderReady).toHaveBeenCalledWith(
        false,
        (fastify as unknown as { log: unknown }).log
      );

      await guardOptions.reacquireFence();
      const fenceCallOrder =
        mockRuntimeService.activateWhatsappRuntimeFence.mock
          .invocationCallOrder[0];
      expect(
        mockRuntimeService.activateWhatsappRuntimeFence
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          worker_id: workerId,
          account_id: accountId,
          source_provider: provider,
          runtime_generation: 7,
          connection_epoch: expect.any(String),
        })
      );

      if (provider === 'baileys') {
        mockBeginSessionLeaseRecoveryResume.mockReturnValueOnce(71);
      }
      await guardOptions.onResume();

      expect(fenceCallOrder).toBeLessThan(
        qrConsumer.execute.mock.invocationCallOrder[0]
      );
      if (provider === 'wwebjs') {
        const resumeBootstrapOrder =
          mockRuntimeService.bootstrapConnection.mock.invocationCallOrder.at(
            -1
          );
        const resumeMonitorOrder =
          mockRuntimeService.start.mock.invocationCallOrder.at(-1);
        expect(resumeBootstrapOrder).toBeDefined();
        expect(resumeMonitorOrder).toBeDefined();
        expect(fenceCallOrder).toBeLessThan(resumeBootstrapOrder as number);
        expect(resumeBootstrapOrder as number).toBeLessThan(
          qrConsumer.execute.mock.invocationCallOrder[0]
        );
        expect(resumeBootstrapOrder as number).toBeLessThan(
          resumeMonitorOrder as number
        );
      } else {
        const resumeBootstrapOrder =
          mockRuntimeService.bootstrapConnection.mock.invocationCallOrder.at(
            -1
          );
        const resumeMonitorOrder =
          mockRuntimeService.start.mock.invocationCallOrder.at(-1);
        expect(resumeBootstrapOrder).toBeDefined();
        expect(resumeMonitorOrder).toBeDefined();
        expect(
          mockRuntimeService.refreshPersistedSessionState
        ).not.toHaveBeenCalled();
        expect(fenceCallOrder).toBeLessThan(resumeBootstrapOrder as number);
        expect(resumeBootstrapOrder as number).toBeLessThan(
          qrConsumer.execute.mock.invocationCallOrder[0]
        );
        expect(resumeBootstrapOrder as number).toBeLessThan(
          resumeMonitorOrder as number
        );
        expect(mockMarkSessionLeaseRecoveryCompleted).toHaveBeenCalledWith(71);
        expect(resumeMonitorOrder as number).toBeLessThan(
          mockMarkSessionLeaseRecoveryCompleted.mock.invocationCallOrder.at(
            -1
          ) as number
        );
      }

      await getFastifyHook(fastify, 'onClose')();
      expect(mockDatabaseGuardStop).toHaveBeenCalledTimes(1);
    }
  );

  it('routes a Baileys lease-loss callback into immediate database-guard suspension and unregisters it on close', async () => {
    mockBaileysEnvironment.isWarmStandby = false;
    mockBaileysEnvironment.isRuntimeActivated = true;
    mockRuntimeDesiredStates.baileys = false;
    mockBaileysQrStart.mockResolvedValue({
      execute: jest.fn(async (): Promise<void> => undefined),
      close: jest.fn(async (): Promise<void> => undefined),
    });

    jest.resetModules();
    const runtime =
      require('../../../../apps/worker_baileys/src/consumer') as RuntimeActivationModule;
    const fastify = makeFastify();
    await runtime.default?.(fastify);
    await getRuntimeActivator(runtime, 'baileys')(fastify);

    expect(mockBaileysSessionLeaseLostListener).toBeDefined();
    await mockBaileysSessionLeaseLostListener?.();
    expect(mockDatabaseGuardReportSessionLeaseLost).toHaveBeenCalledTimes(1);

    await getFastifyHook(fastify, 'onClose')();
    expect(mockBaileysSessionLeaseLostListener).toBeUndefined();
  });

  it('routes WWebJS lease loss through the database guard and completes recovery only after fence, bootstrap, ingress and socket scheduling', async () => {
    mockWwebjsEnvironment.isWarmStandby = false;
    mockWwebjsEnvironment.isRuntimeActivated = true;
    mockRuntimeDesiredStates.wwebjs = false;
    const qrConsumer = {
      execute: jest.fn(async (): Promise<void> => undefined),
      close: jest.fn(async (): Promise<void> => undefined),
    };
    mockWwebjsQrStart.mockResolvedValue(qrConsumer);

    jest.resetModules();
    const runtime =
      require('../../../../apps/worker_wwebjs/src/consumer') as RuntimeActivationModule;
    const fastify = makeFastify();
    await runtime.default?.(fastify);
    await getRuntimeActivator(runtime, 'wwebjs')(fastify);
    const guardOptions = mockDatabaseGuardOptions.find(
      (options) => options.provider === 'wwebjs'
    );
    expect(guardOptions).toBeDefined();
    expect(mockBaileysSessionLeaseLostListener).toBeDefined();

    await mockBaileysSessionLeaseLostListener?.();
    expect(mockDatabaseGuardReportSessionLeaseLost).toHaveBeenCalledTimes(1);
    await guardOptions?.onSuspend();
    await guardOptions?.reacquireFence();
    mockBeginSessionLeaseRecoveryResume.mockReturnValueOnce(73);
    await guardOptions?.onResume();

    expect(mockStartSessionLeaseRecoverySocket).toHaveBeenCalledWith(73);
    expect(mockMarkSessionLeaseRecoveryCompleted).toHaveBeenCalledWith(73);
    expect(
      mockRuntimeService.activateWhatsappRuntimeFence.mock.invocationCallOrder.at(
        -1
      ) as number
    ).toBeLessThan(
      mockRuntimeService.bootstrapConnection.mock.invocationCallOrder.at(
        -1
      ) as number
    );
    expect(
      qrConsumer.execute.mock.invocationCallOrder.at(-1) as number
    ).toBeLessThan(
      mockStartSessionLeaseRecoverySocket.mock.invocationCallOrder.at(
        -1
      ) as number
    );
    expect(
      mockStartSessionLeaseRecoverySocket.mock.invocationCallOrder.at(
        -1
      ) as number
    ).toBeLessThan(
      mockMarkSessionLeaseRecoveryCompleted.mock.invocationCallOrder.at(
        -1
      ) as number
    );

    await getFastifyHook(fastify, 'onClose')();
    expect(mockBaileysSessionLeaseLostListener).toBeUndefined();
  });

  it('awaits WWebJS bootstrap before activate opens QR, monitor, or Kafka consumers', async () => {
    mockWwebjsEnvironment.isWarmStandby = true;
    mockWwebjsEnvironment.isRuntimeActivated = false;
    mockRuntimeDesiredStates.wwebjs = false;
    const bootstrap = deferredVoid();
    mockRuntimeService.bootstrapConnection.mockReturnValueOnce(
      bootstrap.promise
    );
    const qrConsumer = {
      close: jest.fn(async (): Promise<void> => undefined),
    };
    mockWwebjsQrStart.mockReset();
    mockWwebjsQrStart.mockResolvedValue(qrConsumer);

    jest.resetModules();
    const runtime =
      require('../../../../apps/worker_wwebjs/src/consumer') as RuntimeActivationModule;
    const fastify = makeFastify();
    await runtime.default?.(fastify);

    const activation = getRuntimeActivator(runtime, 'wwebjs')(fastify);
    await flushPromises();

    expect(mockRuntimeService.bootstrapConnection).toHaveBeenCalledTimes(1);
    expect(mockWwebjsQrStart).not.toHaveBeenCalled();
    expect(mockWwebjsStartKafkaConsumerSupervisor).not.toHaveBeenCalled();
    expect(mockRuntimeService.start).not.toHaveBeenCalled();
    expect(mockWwebjsStarter).not.toHaveBeenCalled();

    bootstrap.resolve();
    await expect(activation).resolves.toEqual({ alreadyActive: false });

    expect(
      mockRuntimeService.bootstrapConnection.mock.invocationCallOrder[0]
    ).toBeLessThan(mockWwebjsQrStart.mock.invocationCallOrder[0]);
    expect(mockWwebjsQrStart.mock.invocationCallOrder[0]).toBeLessThan(
      mockRuntimeService.start.mock.invocationCallOrder[0]
    );
  });

  it('keeps WWebJS ingress closed when activate bootstrap fails', async () => {
    mockWwebjsEnvironment.isWarmStandby = true;
    mockWwebjsEnvironment.isRuntimeActivated = false;
    mockRuntimeService.bootstrapConnection.mockRejectedValueOnce(
      new Error('wwebjs_bootstrap_session_refresh_failed:42501')
    );
    mockWwebjsQrStart.mockReset();

    jest.resetModules();
    const runtime =
      require('../../../../apps/worker_wwebjs/src/consumer') as RuntimeActivationModule;
    const fastify = makeFastify();
    await runtime.default?.(fastify);

    await expect(
      getRuntimeActivator(runtime, 'wwebjs')(fastify)
    ).rejects.toThrow('wwebjs_bootstrap_session_refresh_failed:42501');
    expect(mockWwebjsQrStart).not.toHaveBeenCalled();
    expect(mockWwebjsStartKafkaConsumerSupervisor).not.toHaveBeenCalled();
    expect(mockRuntimeService.start).not.toHaveBeenCalled();
    expect(mockWwebjsStarter).not.toHaveBeenCalled();
  });

  it('retries cold WWebJS bootstrap with bounded backoff and opens ingress only after success', async () => {
    jest.useFakeTimers();
    try {
      mockWwebjsEnvironment.isWarmStandby = false;
      mockWwebjsEnvironment.isRuntimeActivated = false;
      mockRuntimeDesiredStates.wwebjs = false;
      const secondBootstrap = deferredVoid();
      mockRuntimeService.bootstrapConnection
        .mockRejectedValueOnce(
          new Error('wwebjs_bootstrap_session_refresh_failed:42501')
        )
        .mockReturnValueOnce(secondBootstrap.promise);
      const qrConsumer = {
        close: jest.fn(async (): Promise<void> => undefined),
      };
      mockWwebjsQrStart.mockReset();
      mockWwebjsQrStart.mockResolvedValue(qrConsumer);

      jest.resetModules();
      const runtime =
        require('../../../../apps/worker_wwebjs/src/consumer') as RuntimeActivationModule;
      const fastify = makeFastify();
      await runtime.default?.(fastify);

      await getFastifyHook(fastify, 'onListen')();
      await flushPromises();
      expect(mockRuntimeService.bootstrapConnection).toHaveBeenCalledTimes(1);
      expect(mockWwebjsQrStart).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(999);
      expect(mockRuntimeService.bootstrapConnection).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      await flushPromises();
      expect(mockRuntimeService.bootstrapConnection).toHaveBeenCalledTimes(2);
      expect(mockWwebjsQrStart).not.toHaveBeenCalled();

      secondBootstrap.resolve();
      await flushPromises(16);
      expect(mockWwebjsQrStart).toHaveBeenCalledTimes(1);
      expect(
        mockRuntimeService.bootstrapConnection.mock.invocationCallOrder[1]
      ).toBeLessThan(mockWwebjsQrStart.mock.invocationCallOrder[0]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('closes a partially started WWebJS control plane and retries without duplicate consumers', async () => {
    jest.useFakeTimers();
    try {
      mockWwebjsEnvironment.isWarmStandby = false;
      mockWwebjsEnvironment.isRuntimeActivated = false;
      mockRuntimeDesiredStates.wwebjs = true;
      const firstQrConsumer = {
        close: jest.fn(async (): Promise<void> => undefined),
      };
      const retryQrConsumer = {
        close: jest.fn(async (): Promise<void> => undefined),
      };
      mockWwebjsQrStart.mockReset();
      mockWwebjsQrStart
        .mockResolvedValueOnce(firstQrConsumer)
        .mockResolvedValueOnce(retryQrConsumer);
      mockRuntimeService.bootstrapConnection.mockImplementation(async () => {
        if (mockRuntimeService.bootstrapConnection.mock.calls.length === 2) {
          mockRuntimeDesiredStates.wwebjs = true;
        }
      });
      const firstBatchConsumers = Array.from({ length: 1 }, () => ({
        close: jest.fn(async (): Promise<void> => undefined),
      }));
      const retryConsumers = Array.from({ length: 1 }, () => ({
        close: jest.fn(async (): Promise<void> => undefined),
      }));
      let starterCall = 0;
      mockWwebjsStarter.mockReset();
      mockWwebjsStarter.mockImplementation((_server, onCreated) => {
        const index = starterCall;
        starterCall += 1;
        const consumer =
          index < firstBatchConsumers.length
            ? firstBatchConsumers[index]
            : retryConsumers[index - firstBatchConsumers.length];
        onCreated?.(consumer);
        return index === 0
          ? Promise.reject(new Error('first_batch_start_failed'))
          : Promise.resolve(consumer);
      });

      jest.resetModules();
      const runtime =
        require('../../../../apps/worker_wwebjs/src/consumer') as RuntimeActivationModule;
      const fastify = makeFastify();
      await runtime.default?.(fastify);

      await getFastifyHook(fastify, 'onListen')();
      await flushPromises(64);

      expect(firstQrConsumer.close).toHaveBeenCalledTimes(1);
      expect(mockRuntimeService.stop).toHaveBeenCalled();
      expect(mockRuntimeService.shutdown).toHaveBeenCalled();
      expect(mockRegisteredWorkerConsumers).not.toContain(firstQrConsumer);
      expect(mockRegisteredWorkerConsumers).toHaveLength(0);

      await jest.advanceTimersByTimeAsync(1_000);
      await flushPromises(32);

      expect(mockWwebjsQrStart).toHaveBeenCalledTimes(2);
      expect(mockWwebjsStarter).toHaveBeenCalledTimes(2);
      expect(mockRegisteredWorkerConsumers).toEqual([
        retryQrConsumer,
        ...retryConsumers,
      ]);
      expect(
        firstBatchConsumers.every(
          (consumer) => consumer.close.mock.calls.length === 1
        )
      ).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('retries failed WWebJS QR cleanup before a replacement bootstrap can open ingress', async () => {
    mockRuntimeDesiredStates.wwebjs = true;
    const firstQrConsumer = {
      close: jest
        .fn<Promise<void>, []>()
        .mockRejectedValueOnce(new Error('qr_close_failed'))
        .mockResolvedValue(undefined),
    };
    const retryQrConsumer = {
      close: jest.fn(async (): Promise<void> => undefined),
    };
    mockWwebjsQrStart.mockReset();
    mockWwebjsQrStart
      .mockResolvedValueOnce(firstQrConsumer)
      .mockResolvedValue(retryQrConsumer);
    mockRuntimeService.bootstrapConnection.mockImplementation(async () => {
      if (mockRuntimeService.bootstrapConnection.mock.calls.length === 2) {
        mockRuntimeDesiredStates.wwebjs = true;
      }
    });
    const firstBatchConsumers = Array.from({ length: 1 }, () => ({
      close: jest.fn(async (): Promise<void> => undefined),
    }));
    const retryConsumers = Array.from({ length: 1 }, () => ({
      close: jest.fn(async (): Promise<void> => undefined),
    }));
    let starterCall = 0;
    mockWwebjsStarter.mockReset();
    mockWwebjsStarter.mockImplementation((_server, onCreated) => {
      const index = starterCall;
      starterCall += 1;
      const consumer =
        index < firstBatchConsumers.length
          ? firstBatchConsumers[index]
          : retryConsumers[index - firstBatchConsumers.length];
      onCreated?.(consumer);
      return index === 0
        ? Promise.reject(new Error('first_batch_start_failed'))
        : Promise.resolve(consumer);
    });

    jest.resetModules();
    const runtime =
      require('../../../../apps/worker_wwebjs/src/consumer') as RuntimeActivationModule;
    const fastify = makeFastify();
    await runtime.default?.(fastify);
    const activate = () => getRuntimeActivator(runtime, 'wwebjs')(fastify);

    await expect(activate()).rejects.toThrow(
      'wwebjs_runtime_activation_cleanup_incomplete:failures=1'
    );
    expect(firstQrConsumer.close).toHaveBeenCalledTimes(1);
    expect(mockRuntimeService.bootstrapConnection).toHaveBeenCalledTimes(1);
    expect(mockRegisteredWorkerConsumers).toEqual([firstQrConsumer]);

    await expect(activate()).resolves.toEqual({ alreadyActive: false });

    expect(firstQrConsumer.close).toHaveBeenCalledTimes(2);
    expect(firstQrConsumer.close.mock.invocationCallOrder[1]).toBeLessThan(
      mockRuntimeService.bootstrapConnection.mock.invocationCallOrder[1]
    );
    expect(mockWwebjsQrStart).toHaveBeenCalledTimes(2);
    expect(mockRegisteredWorkerConsumers).toEqual([
      retryQrConsumer,
      ...retryConsumers,
    ]);
  });

  it('cancels a pending cold WWebJS activation retry on close', async () => {
    jest.useFakeTimers();
    try {
      mockWwebjsEnvironment.isWarmStandby = false;
      mockRuntimeService.bootstrapConnection.mockRejectedValue(
        new Error('wwebjs_bootstrap_session_refresh_failed:42501')
      );
      mockWwebjsQrStart.mockReset();

      jest.resetModules();
      const runtime =
        require('../../../../apps/worker_wwebjs/src/consumer') as RuntimeActivationModule;
      const fastify = makeFastify();
      await runtime.default?.(fastify);

      await getFastifyHook(fastify, 'onListen')();
      await flushPromises();
      expect(mockRuntimeService.bootstrapConnection).toHaveBeenCalledTimes(1);

      await getFastifyHook(fastify, 'onClose')();
      await jest.advanceTimersByTimeAsync(60_000);
      expect(mockRuntimeService.bootstrapConnection).toHaveBeenCalledTimes(1);
      expect(mockWwebjsQrStart).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps WWebJS resume suspended when bootstrap refresh fails before QR and monitor resume', async () => {
    mockWwebjsEnvironment.isWarmStandby = false;
    mockWwebjsEnvironment.isRuntimeActivated = true;
    mockRuntimeDesiredStates.wwebjs = false;
    const qrConsumer = {
      execute: jest.fn(async (): Promise<void> => undefined),
      close: jest.fn(async (): Promise<void> => undefined),
    };
    mockWwebjsQrStart.mockReset();
    mockWwebjsQrStart.mockResolvedValue(qrConsumer);

    jest.resetModules();
    const runtime =
      require('../../../../apps/worker_wwebjs/src/consumer') as RuntimeActivationModule;
    const fastify = makeFastify();
    await runtime.default?.(fastify);
    await getRuntimeActivator(runtime, 'wwebjs')(fastify);
    const guardOptions = mockDatabaseGuardOptions.find(
      (options) => options.provider === 'wwebjs'
    );
    expect(guardOptions).toBeDefined();
    await guardOptions?.onSuspend();
    const monitorStartsBeforeResume =
      mockRuntimeService.start.mock.calls.length;
    mockRuntimeService.bootstrapConnection.mockRejectedValueOnce(
      new Error('wwebjs_bootstrap_session_refresh_failed:42501')
    );

    await expect(guardOptions?.onResume()).rejects.toThrow(
      'wwebjs_database_resume_incomplete'
    );
    expect(qrConsumer.execute).not.toHaveBeenCalled();
    expect(mockRuntimeService.start).toHaveBeenCalledTimes(
      monitorStartsBeforeResume
    );
    expect(mockRuntimeDesiredStates.wwebjs).toBe(false);
    expect(mockWwebjsSetKafkaConsumersProviderReady).toHaveBeenLastCalledWith(
      false,
      (fastify as unknown as { log: unknown }).log
    );
  });

  it('invalidates a pending WWebJS bootstrap on suspend and requires a fresh post-fence bootstrap before ingress', async () => {
    mockWwebjsEnvironment.isWarmStandby = false;
    mockWwebjsEnvironment.isRuntimeActivated = true;
    mockRuntimeDesiredStates.wwebjs = false;
    const firstBootstrap = deferredVoid();
    const secondBootstrap = deferredVoid();
    mockRuntimeService.bootstrapConnection
      .mockReturnValueOnce(firstBootstrap.promise)
      .mockReturnValueOnce(secondBootstrap.promise);
    const qrConsumer = {
      execute: jest.fn(async (): Promise<void> => undefined),
      close: jest.fn(async (): Promise<void> => undefined),
    };
    mockWwebjsQrStart.mockReset();
    mockWwebjsQrStart.mockResolvedValue(qrConsumer);

    jest.resetModules();
    const runtime =
      require('../../../../apps/worker_wwebjs/src/consumer') as RuntimeActivationModule;
    const fastify = makeFastify();
    await runtime.default?.(fastify);
    const activation = getRuntimeActivator(runtime, 'wwebjs')(fastify);
    await flushPromises();
    const guardOptions = mockDatabaseGuardOptions.find(
      (options) => options.provider === 'wwebjs'
    );
    expect(guardOptions).toBeDefined();

    await guardOptions?.onSuspend();
    await guardOptions?.reacquireFence();
    let resumeCompleted = false;
    const resume = guardOptions?.onResume().then(() => {
      resumeCompleted = true;
    });
    await flushPromises();

    expect(mockRuntimeService.bootstrapConnection).toHaveBeenCalledTimes(1);
    expect(mockWwebjsQrStart).not.toHaveBeenCalled();
    expect(resumeCompleted).toBe(false);

    firstBootstrap.resolve();
    await expect(activation).rejects.toThrow(
      'wwebjs_runtime_bootstrap_cancelled'
    );
    await flushPromises(16);

    expect(mockRuntimeService.bootstrapConnection).toHaveBeenCalledTimes(2);
    expect(mockWwebjsQrStart).not.toHaveBeenCalled();
    expect(resumeCompleted).toBe(false);

    secondBootstrap.resolve();
    await resume;

    expect(mockWwebjsQrStart).toHaveBeenCalledTimes(1);
    const fenceOrder = mockRuntimeService.activateWhatsappRuntimeFence.mock
      .invocationCallOrder[0] as number;
    const freshBootstrapOrder = mockRuntimeService.bootstrapConnection.mock
      .invocationCallOrder[1] as number;
    expect(fenceOrder).toBeLessThan(freshBootstrapOrder);
    expect(freshBootstrapOrder).toBeLessThan(
      mockWwebjsQrStart.mock.invocationCallOrder[0]
    );
  });

  it('closes a QR owner that resolves after database suspension during WWebJS startup', async () => {
    mockWwebjsEnvironment.isWarmStandby = false;
    mockWwebjsEnvironment.isRuntimeActivated = true;
    mockRuntimeDesiredStates.wwebjs = false;
    let resolveQr!: (consumer: DeferredConsumer) => void;
    const qrPromise = new Promise<DeferredConsumer>((resolve) => {
      resolveQr = resolve;
    });
    const qrConsumer = {
      close: jest.fn(async (): Promise<void> => undefined),
    };
    mockWwebjsQrStart.mockReset();
    mockWwebjsQrStart.mockReturnValueOnce(qrPromise);

    jest.resetModules();
    const runtime =
      require('../../../../apps/worker_wwebjs/src/consumer') as RuntimeActivationModule;
    const fastify = makeFastify();
    await runtime.default?.(fastify);
    const activation = getRuntimeActivator(runtime, 'wwebjs')(fastify);
    await flushPromises();
    const guardOptions = mockDatabaseGuardOptions.find(
      (options) => options.provider === 'wwebjs'
    );
    expect(guardOptions).toBeDefined();

    await guardOptions?.onSuspend();
    resolveQr(qrConsumer);
    await expect(activation).rejects.toThrow('wwebjs_runtime_is_closing');

    expect(qrConsumer.close).toHaveBeenCalled();
    expect(mockRegisteredWorkerConsumers).not.toContain(qrConsumer);
    expect(mockWwebjsStarter).not.toHaveBeenCalled();
  });

  it('waits for an in-flight WWebJS bootstrap transition during close without opening ingress', async () => {
    const bootstrap = deferredVoid();
    mockWwebjsEnvironment.isWarmStandby = true;
    mockWwebjsEnvironment.isRuntimeActivated = false;
    mockRuntimeService.bootstrapConnection.mockReturnValueOnce(
      bootstrap.promise
    );
    mockWwebjsQrStart.mockReset();

    jest.resetModules();
    const runtime =
      require('../../../../apps/worker_wwebjs/src/consumer') as RuntimeActivationModule;
    const fastify = makeFastify();
    await runtime.default?.(fastify);
    const activation = getRuntimeActivator(runtime, 'wwebjs')(fastify);
    await flushPromises();

    let closeCompleted = false;
    const closing = getFastifyHook(fastify, 'onClose')().then(() => {
      closeCompleted = true;
    });
    await flushPromises();
    expect(closeCompleted).toBe(false);
    expect(mockWwebjsQrStart).not.toHaveBeenCalled();

    bootstrap.resolve();
    await expect(activation).rejects.toThrow(
      'wwebjs_runtime_bootstrap_cancelled'
    );
    await closing;

    expect(closeCompleted).toBe(true);
    expect(mockWwebjsQrStart).not.toHaveBeenCalled();
  });

  it('awaits Baileys bootstrap before warm activation opens QR, monitor, or Kafka consumers', async () => {
    mockBaileysEnvironment.isWarmStandby = true;
    mockBaileysEnvironment.isRuntimeActivated = false;
    mockRuntimeDesiredStates.baileys = false;
    const bootstrap = deferredVoid();
    mockRuntimeService.bootstrapConnection.mockReturnValueOnce(
      bootstrap.promise
    );
    const qrConsumer = {
      close: jest.fn(async (): Promise<void> => undefined),
    };
    mockBaileysQrStart.mockReset();
    mockBaileysQrStart.mockResolvedValue(qrConsumer);

    jest.resetModules();
    const runtime =
      require('../../../../apps/worker_baileys/src/consumer') as RuntimeActivationModule;
    const fastify = makeFastify();
    await runtime.default?.(fastify);

    const activation = getRuntimeActivator(runtime, 'baileys')(fastify);
    await flushPromises();

    expect(mockRuntimeService.bootstrapConnection).toHaveBeenCalledTimes(1);
    expect(mockBaileysQrStart).not.toHaveBeenCalled();
    expect(mockBaileysStartKafkaConsumerSupervisor).not.toHaveBeenCalled();
    expect(mockRuntimeService.start).not.toHaveBeenCalled();
    expect(mockBaileysStarter).not.toHaveBeenCalled();

    bootstrap.resolve();
    await expect(activation).resolves.toEqual({ alreadyActive: false });

    expect(
      mockRuntimeService.bootstrapConnection.mock.invocationCallOrder[0]
    ).toBeLessThan(mockBaileysQrStart.mock.invocationCallOrder[0]);
    expect(mockBaileysQrStart.mock.invocationCallOrder[0]).toBeLessThan(
      mockRuntimeService.start.mock.invocationCallOrder[0]
    );
  });

  it('keeps cold Baileys ingress closed when bootstrap fails', async () => {
    mockBaileysEnvironment.isWarmStandby = false;
    mockBaileysEnvironment.isRuntimeActivated = false;
    mockRuntimeDesiredStates.baileys = false;
    mockRuntimeService.bootstrapConnection.mockRejectedValueOnce(
      new Error('baileys_bootstrap_session_refresh_failed:42501')
    );
    mockBaileysQrStart.mockReset();

    jest.resetModules();
    const runtime =
      require('../../../../apps/worker_baileys/src/consumer') as RuntimeActivationModule;
    const fastify = makeFastify();
    await runtime.default?.(fastify);

    await expect(
      getRuntimeActivator(runtime, 'baileys')(fastify)
    ).rejects.toThrow('baileys_bootstrap_session_refresh_failed:42501');
    expect(mockBaileysQrStart).not.toHaveBeenCalled();
    expect(mockBaileysStartKafkaConsumerSupervisor).not.toHaveBeenCalled();
    expect(mockRuntimeService.start).not.toHaveBeenCalled();
    expect(mockBaileysStarter).not.toHaveBeenCalled();
  });

  it('retries cold Baileys bootstrap with bounded backoff and opens ingress only after success', async () => {
    jest.useFakeTimers();
    try {
      mockBaileysEnvironment.isWarmStandby = false;
      mockBaileysEnvironment.isRuntimeActivated = false;
      mockRuntimeDesiredStates.baileys = false;
      const secondBootstrap = deferredVoid();
      mockRuntimeService.bootstrapConnection
        .mockRejectedValueOnce(
          new Error('baileys_bootstrap_session_refresh_failed:42501')
        )
        .mockReturnValueOnce(secondBootstrap.promise);
      const qrConsumer = {
        close: jest.fn(async (): Promise<void> => undefined),
      };
      mockBaileysQrStart.mockReset();
      mockBaileysQrStart.mockResolvedValue(qrConsumer);

      jest.resetModules();
      const runtime =
        require('../../../../apps/worker_baileys/src/consumer') as RuntimeActivationModule;
      const fastify = makeFastify();
      await runtime.default?.(fastify);

      await getFastifyHook(fastify, 'onListen')();
      await flushPromises();
      expect(mockRuntimeService.bootstrapConnection).toHaveBeenCalledTimes(1);
      expect(mockBaileysQrStart).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(999);
      expect(mockRuntimeService.bootstrapConnection).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      await flushPromises();
      expect(mockRuntimeService.bootstrapConnection).toHaveBeenCalledTimes(2);
      expect(mockBaileysQrStart).not.toHaveBeenCalled();

      secondBootstrap.resolve();
      await flushPromises(16);
      expect(mockBaileysQrStart).toHaveBeenCalledTimes(1);
      expect(
        mockRuntimeService.bootstrapConnection.mock.invocationCallOrder[1]
      ).toBeLessThan(mockBaileysQrStart.mock.invocationCallOrder[0]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('cancels a pending cold Baileys activation retry on close', async () => {
    jest.useFakeTimers();
    try {
      mockBaileysEnvironment.isWarmStandby = false;
      mockRuntimeService.bootstrapConnection.mockRejectedValue(
        new Error('baileys_bootstrap_session_refresh_failed:42501')
      );
      mockBaileysQrStart.mockReset();

      jest.resetModules();
      const runtime =
        require('../../../../apps/worker_baileys/src/consumer') as RuntimeActivationModule;
      const fastify = makeFastify();
      await runtime.default?.(fastify);

      await getFastifyHook(fastify, 'onListen')();
      await flushPromises();
      expect(mockRuntimeService.bootstrapConnection).toHaveBeenCalledTimes(1);

      await getFastifyHook(fastify, 'onClose')();
      await jest.advanceTimersByTimeAsync(60_000);
      expect(mockRuntimeService.bootstrapConnection).toHaveBeenCalledTimes(1);
      expect(mockBaileysQrStart).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps Baileys resume suspended when bootstrap refresh fails before QR and monitor resume', async () => {
    mockBaileysEnvironment.isWarmStandby = false;
    mockBaileysEnvironment.isRuntimeActivated = true;
    mockRuntimeDesiredStates.baileys = false;
    const qrConsumer = {
      execute: jest.fn(async (): Promise<void> => undefined),
      close: jest.fn(async (): Promise<void> => undefined),
    };
    mockBaileysQrStart.mockReset();
    mockBaileysQrStart.mockResolvedValue(qrConsumer);

    jest.resetModules();
    const runtime =
      require('../../../../apps/worker_baileys/src/consumer') as RuntimeActivationModule;
    const fastify = makeFastify();
    await runtime.default?.(fastify);
    await getRuntimeActivator(runtime, 'baileys')(fastify);
    const guardOptions = mockDatabaseGuardOptions.find(
      (options) => options.provider === 'baileys'
    );
    expect(guardOptions).toBeDefined();
    await guardOptions?.onSuspend();
    const monitorStartsBeforeResume =
      mockRuntimeService.start.mock.calls.length;
    mockRuntimeService.bootstrapConnection.mockRejectedValueOnce(
      new Error('baileys_bootstrap_session_refresh_failed:42501')
    );

    await expect(guardOptions?.onResume()).rejects.toThrow(
      'baileys_database_resume_incomplete'
    );
    expect(
      mockRuntimeService.refreshPersistedSessionState
    ).not.toHaveBeenCalled();
    expect(mockRuntimeService.suspend).toHaveBeenCalledTimes(2);
    expect(qrConsumer.execute).not.toHaveBeenCalled();
    expect(mockRuntimeService.start).toHaveBeenCalledTimes(
      monitorStartsBeforeResume
    );
    expect(mockRuntimeDesiredStates.baileys).toBe(false);
    expect(mockBaileysSetKafkaConsumersProviderReady).toHaveBeenLastCalledWith(
      false,
      (fastify as unknown as { log: unknown }).log
    );
  });

  it.each([
    {
      provider: 'wwebjs' as const,
      modulePath: '../../../../apps/worker_wwebjs/src/consumer',
      starter: mockWwebjsStarter,
      qrStarter: mockWwebjsQrStart,
    },
    {
      provider: 'baileys' as const,
      modulePath: '../../../../apps/worker_baileys/src/consumer',
      starter: mockBaileysStarter,
      qrStarter: mockBaileysQrStart,
    },
  ])(
    'bounds a stalled $provider role, reports its identity, and removes the failed batch',
    async ({ provider, modulePath, starter, qrStarter }) => {
      const previousTimeout =
        process.env.WORKER_COMMAND_INGRESS_STARTUP_TIMEOUT_MS;
      process.env.WORKER_COMMAND_INGRESS_STARTUP_TIMEOUT_MS = '1000';
      jest.useFakeTimers();
      try {
        jest.resetModules();
        const runtime = require(modulePath) as RuntimeActivationModule;
        const fastify = makeFastify();
        await runtime.default?.(fastify);

        const qrConsumer = {
          close: jest.fn(async (): Promise<void> => undefined),
        };
        qrStarter.mockReset();
        qrStarter.mockResolvedValue(qrConsumer);
        const consumers = Array.from({ length: 1 }, () => ({
          execute: jest.fn(async (): Promise<void> => undefined),
          close: jest.fn(async (): Promise<void> => undefined),
        }));
        let starterCall = 0;
        starter.mockReset();
        starter.mockImplementation((_server, onCreated) => {
          const index = starterCall;
          starterCall += 1;
          const consumer = consumers[index];
          onCreated?.(consumer);
          return index === 0
            ? new Promise<DeferredConsumer>(() => undefined)
            : Promise.resolve(consumer);
        });
        mockRuntimeDesiredStates[provider] = true;

        const activation = getRuntimeActivator(runtime, provider)(fastify);
        const activationOutcome = activation.catch((error: unknown) => error);
        await flushPromises(16);

        // Deferred owners stay locally tracked but outside the supervisor
        // until every role has completed startup.
        expect(mockRegisteredWorkerConsumers).toEqual([qrConsumer]);
        await jest.advanceTimersByTimeAsync(1000);
        const error = await activationOutcome;

        expect(error).toEqual(
          expect.objectContaining({
            message: expect.stringContaining(
              `${provider}_kafka_consumer_start_failed:role=worker_command_ingress:code=startup_timeout`
            ),
          })
        );
        expect(
          consumers.every((consumer) => consumer.close.mock.calls.length === 1)
        ).toBe(true);
        expect(mockRegisteredWorkerConsumers).toEqual(
          provider === 'wwebjs' ? [] : [qrConsumer]
        );
        expect(
          (
            fastify as unknown as {
              log: { error: jest.Mock };
            }
          ).log.error
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            startup_failed_roles: ['worker_command_ingress'],
            startup_failure_codes: ['startup_timeout'],
            cleanup_failed_roles: [],
            cleanup_failure_codes: [],
          }),
          expect.stringContaining('startup do lote Kafka não foi concluído')
        );
      } finally {
        jest.useRealTimers();
        if (previousTimeout === undefined) {
          delete process.env.WORKER_COMMAND_INGRESS_STARTUP_TIMEOUT_MS;
        } else {
          process.env.WORKER_COMMAND_INGRESS_STARTUP_TIMEOUT_MS =
            previousTimeout;
        }
      }
    }
  );

  it.each([
    {
      provider: 'wwebjs' as const,
      modulePath: '../../../../apps/worker_wwebjs/src/consumer',
      starter: mockWwebjsStarter,
      qrStarter: mockWwebjsQrStart,
    },
    {
      provider: 'baileys' as const,
      modulePath: '../../../../apps/worker_baileys/src/consumer',
      starter: mockBaileysStarter,
      qrStarter: mockBaileysQrStart,
    },
  ])(
    'closes and unregisters a $provider consumer created after its role timed out',
    async ({ provider, modulePath, starter, qrStarter }) => {
      const previousTimeout =
        process.env.WORKER_COMMAND_INGRESS_STARTUP_TIMEOUT_MS;
      process.env.WORKER_COMMAND_INGRESS_STARTUP_TIMEOUT_MS = '1000';
      jest.useFakeTimers();
      try {
        jest.resetModules();
        const runtime = require(modulePath) as RuntimeActivationModule;
        const fastify = makeFastify();
        await runtime.default?.(fastify);

        const qrConsumer = {
          close: jest.fn(async (): Promise<void> => undefined),
        };
        qrStarter.mockReset();
        qrStarter.mockResolvedValue(qrConsumer);
        const readyConsumers = Array.from({ length: 0 }, () => ({
          execute: jest.fn(async (): Promise<void> => undefined),
          close: jest.fn(async (): Promise<void> => undefined),
        }));
        const lateConsumer = {
          execute: jest.fn(async (): Promise<void> => undefined),
          close: jest.fn(async (): Promise<void> => undefined),
        };
        const pending = deferred();
        let lateOnCreated: ((consumer: DeferredConsumer) => void) | undefined;
        let starterCall = 0;
        starter.mockReset();
        starter.mockImplementation((_server, onCreated) => {
          const index = starterCall;
          starterCall += 1;
          if (index === 0) {
            lateOnCreated = onCreated;
            return pending.promise;
          }
          const consumer = readyConsumers[index];
          onCreated?.(consumer);
          return Promise.resolve(consumer);
        });
        mockRuntimeDesiredStates[provider] = true;

        const activation = getRuntimeActivator(runtime, provider)(fastify);
        const activationOutcome = activation.catch((error: unknown) => error);
        await flushPromises(16);

        expect(mockRegisteredWorkerConsumers).toEqual([qrConsumer]);
        await jest.advanceTimersByTimeAsync(1000);
        await activationOutcome;
        expect(mockRegisteredWorkerConsumers).toEqual(
          provider === 'wwebjs' ? [] : [qrConsumer]
        );

        lateOnCreated?.(lateConsumer);
        pending.resolve(lateConsumer);
        await flushPromises(16);

        expect(lateConsumer.close).toHaveBeenCalledTimes(1);
        expect(mockUnregisterWorkerConsumer).toHaveBeenCalledWith(lateConsumer);
        expect(mockRegisteredWorkerConsumers).toEqual(
          provider === 'wwebjs' ? [] : [qrConsumer]
        );
      } finally {
        jest.useRealTimers();
        if (previousTimeout === undefined) {
          delete process.env.WORKER_COMMAND_INGRESS_STARTUP_TIMEOUT_MS;
        } else {
          process.env.WORKER_COMMAND_INGRESS_STARTUP_TIMEOUT_MS =
            previousTimeout;
        }
      }
    }
  );

  it.each([
    {
      provider: 'wwebjs' as const,
      modulePath: '../../../../apps/worker_wwebjs/src/consumer',
      qrStarter: mockWwebjsQrStart,
      waitForReady: mockWwebjsWaitForKafkaConsumersReady,
      startSupervisor: mockWwebjsStartKafkaConsumerSupervisor,
      reconcile: mockWwebjsReconcileKafkaConsumers,
    },
    {
      provider: 'baileys' as const,
      modulePath: '../../../../apps/worker_baileys/src/consumer',
      qrStarter: mockBaileysQrStart,
      waitForReady: mockBaileysWaitForKafkaConsumersReady,
      startSupervisor: mockBaileysStartKafkaConsumerSupervisor,
      reconcile: mockBaileysReconcileKafkaConsumers,
    },
  ])(
    'starts the $provider supervisor before readiness and reconciles its timeout',
    async ({
      provider,
      modulePath,
      qrStarter,
      waitForReady,
      startSupervisor,
      reconcile,
    }) => {
      jest.resetModules();
      const runtime = require(modulePath) as RuntimeActivationModule;
      const fastify = makeFastify();
      await runtime.default?.(fastify);
      qrStarter.mockReset();
      qrStarter.mockResolvedValue({
        close: jest.fn(async (): Promise<void> => undefined),
      });
      mockRuntimeDesiredStates[provider] = true;
      waitForReady.mockRejectedValueOnce(
        new Error(
          'kafka_consumers_not_ready:expected=7,active=6,missing=0,unhealthy=0'
        )
      );

      const activate = getRuntimeActivator(runtime, provider);
      await expect(activate(fastify)).rejects.toThrow(
        'kafka_consumers_not_ready'
      );

      expect(startSupervisor).toHaveBeenCalledWith(
        (fastify as unknown as { log: unknown }).log
      );
      expect(startSupervisor.mock.invocationCallOrder[0]).toBeLessThan(
        waitForReady.mock.invocationCallOrder[0]
      );
      expect(mockRuntimeService.start).toHaveBeenCalledTimes(1);
      expect(mockRuntimeService.start.mock.invocationCallOrder[0]).toBeLessThan(
        waitForReady.mock.invocationCallOrder[0]
      );
      expect(reconcile).toHaveBeenCalledWith(
        (fastify as unknown as { log: unknown }).log,
        'readiness_timeout'
      );
      expect(waitForReady.mock.invocationCallOrder[0]).toBeLessThan(
        reconcile.mock.invocationCallOrder[0]
      );
    }
  );

  it.each([
    {
      provider: 'wwebjs' as const,
      modulePath: '../../../../apps/worker_wwebjs/src/consumer',
      starter: mockWwebjsStarter,
      qrStarter: mockWwebjsQrStart,
      setProviderReady: mockWwebjsSetKafkaConsumersProviderReady,
    },
    {
      provider: 'baileys' as const,
      modulePath: '../../../../apps/worker_baileys/src/consumer',
      starter: mockBaileysStarter,
      qrStarter: mockBaileysQrStart,
      setProviderReady: mockBaileysSetKafkaConsumersProviderReady,
    },
  ])(
    'starts each $provider owner exactly once after the first late ready transition',
    async ({ provider, modulePath, starter, qrStarter, setProviderReady }) => {
      jest.resetModules();
      const runtime = require(modulePath) as RuntimeActivationModule;
      const fastify = makeFastify();
      await runtime.default?.(fastify);

      let providerReady = false;
      mockRuntimeService.verifyCurrentSession.mockImplementation(async () => ({
        session_ready: providerReady,
        can_send: providerReady,
        can_receive_runtime: providerReady,
        authenticated: providerReady,
      }));
      mockRuntimeDesiredStates[provider] = false;

      const qrConsumer = {
        close: jest.fn(async (): Promise<void> => undefined),
      };
      qrStarter.mockReset();
      qrStarter.mockResolvedValue(qrConsumer);

      const owners = Array.from({ length: 1 }, () => ({
        execute: jest.fn(async (): Promise<void> => undefined),
        close: jest.fn(async (): Promise<void> => undefined),
      }));
      let nextOwner = 0;
      starter.mockReset();
      starter.mockImplementation(async () => {
        const owner = owners[nextOwner];
        nextOwner += 1;
        await owner.execute();
        return owner;
      });

      let registryReady = true;
      setProviderReady.mockImplementation(async (ready: boolean) => {
        if (registryReady === ready) {
          return;
        }
        registryReady = ready;
        const monitoredOwners = mockRegisteredWorkerConsumers.filter(
          (consumer) => consumer.execute !== undefined
        );
        if (ready) {
          await Promise.all(
            monitoredOwners.map((consumer) => consumer.execute?.())
          );
          return;
        }
        await Promise.all(
          monitoredOwners.map((consumer) => consumer.close?.())
        );
      });

      const activate = getRuntimeActivator(runtime, provider);
      await activate(fastify);

      expect(starter).not.toHaveBeenCalled();
      expect(
        owners.every((owner) => owner.execute.mock.calls.length === 0)
      ).toBe(true);

      providerReady = true;
      mockRuntimeDesiredStates[provider] = true;
      mockDesiredStateListeners.get(provider)?.(true);
      await mockRuntimeStateListeners.get(provider)?.(true);

      expect(starter).toHaveBeenCalledTimes(1);
      expect(
        owners.every((owner) => owner.execute.mock.calls.length === 1)
      ).toBe(true);

      await mockRuntimeStateListeners.get(provider)?.(true);

      expect(starter).toHaveBeenCalledTimes(1);
      expect(
        owners.every((owner) => owner.execute.mock.calls.length === 1)
      ).toBe(true);
    }
  );

  it('starts Baileys ingress from its fenced ready transition without a competing provider probe', async () => {
    jest.resetModules();
    const runtime =
      require('../../../../apps/worker_baileys/src/consumer') as RuntimeActivationModule;
    const fastify = makeFastify();
    await runtime.default?.(fastify);

    mockRuntimeService.verifyCurrentSession.mockResolvedValue({
      session_ready: false,
      can_send: false,
      can_receive_runtime: false,
      authenticated: true,
    });
    const owner = {
      execute: jest.fn(async (): Promise<void> => undefined),
      close: jest.fn(async (): Promise<void> => undefined),
    };
    mockBaileysStarter.mockImplementation(async (_server, onCreated) => {
      onCreated?.(owner);
      await owner.execute();
      return owner;
    });

    mockRuntimeDesiredStates.baileys = true;
    mockDesiredStateListeners.get('baileys')?.(true);
    await mockRuntimeStateListeners.get('baileys')?.(true);

    expect(mockRuntimeService.verifyCurrentSession).not.toHaveBeenCalled();
    expect(mockBaileysStarter).toHaveBeenCalledTimes(1);
    expect(owner.execute).toHaveBeenCalledTimes(1);
    expect(mockBaileysSetKafkaConsumersProviderReady).toHaveBeenCalledWith(
      true,
      (fastify as unknown as { log: unknown }).log
    );
  });

  it('retries WWebJS activation after a transient startup failure', async () => {
    mockWwebjsQrStart
      .mockRejectedValueOnce(new Error('transient readiness failure'))
      .mockResolvedValueOnce({ close: jest.fn(async () => undefined) });
    const fastify = makeFastify();
    const activateWwebjsRuntime = getRuntimeActivator(wwebjsRuntime, 'wwebjs');

    await expect(activateWwebjsRuntime(fastify)).rejects.toThrow(
      'transient readiness failure'
    );
    await expect(activateWwebjsRuntime(fastify)).resolves.toEqual({
      alreadyActive: false,
    });

    expect(mockWwebjsQrStart).toHaveBeenCalledTimes(2);
  });

  it('retries Baileys activation after a transient startup failure', async () => {
    mockBaileysQrStart
      .mockRejectedValueOnce(new Error('transient readiness failure'))
      .mockResolvedValueOnce({ close: jest.fn(async () => undefined) });
    const fastify = makeFastify();
    const activateBaileysRuntime = getRuntimeActivator(
      baileysRuntime,
      'baileys'
    );

    await expect(activateBaileysRuntime(fastify)).rejects.toThrow(
      'transient readiness failure'
    );
    await expect(activateBaileysRuntime(fastify)).resolves.toEqual({
      alreadyActive: false,
    });

    expect(mockBaileysQrStart).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      provider: 'wwebjs' as const,
      modulePath: '../../../../apps/worker_wwebjs/src/consumer',
      starter: mockWwebjsStarter,
      qrStarter: mockWwebjsQrStart,
    },
    {
      provider: 'baileys' as const,
      modulePath: '../../../../apps/worker_baileys/src/consumer',
      starter: mockBaileysStarter,
      qrStarter: mockBaileysQrStart,
    },
  ])(
    'closes fulfilled $provider consumers before a pending startup settles',
    async ({ provider, modulePath, starter, qrStarter }) => {
      jest.resetModules();
      const runtime = require(modulePath) as RuntimeActivationModule;
      const fastify = makeFastify();
      await runtime.default?.(fastify);

      const readyConsumers = Array.from({ length: 0 }, () => ({
        close: jest.fn(async (): Promise<void> => undefined),
      }));
      const pendingConsumer = {
        close: jest.fn(async (): Promise<void> => undefined),
      };
      const pending = deferred();
      starter.mockReset();
      for (const consumer of readyConsumers) {
        starter.mockResolvedValueOnce(consumer);
      }
      starter.mockImplementationOnce((_server, onCreated) => {
        onCreated?.(pendingConsumer);
        return pending.promise;
      });
      qrStarter.mockReset();
      qrStarter.mockResolvedValue({ close: jest.fn(async () => undefined) });
      mockRuntimeDesiredStates[provider] = true;

      const activate = getRuntimeActivator(runtime, provider);
      const activation = activate(fastify);
      await flushPromises(16);

      expect(starter).toHaveBeenCalledTimes(1);
      expect(
        readyConsumers.every((consumer) => !consumer.close.mock.calls.length)
      ).toBe(true);

      mockRuntimeDesiredStates[provider] = false;
      mockDesiredStateListeners.get(provider)?.(false);
      await flushPromises(16);

      expect(
        readyConsumers.every((consumer) => consumer.close.mock.calls.length > 0)
      ).toBe(true);
      expect(pendingConsumer.close).toHaveBeenCalledTimes(1);

      pending.resolve(pendingConsumer);
      await activation;
      expect(pendingConsumer.close).toHaveBeenCalledTimes(2);
    }
  );

  it.each([
    {
      provider: 'wwebjs' as const,
      modulePath: '../../../../apps/worker_wwebjs/src/consumer',
      starter: mockWwebjsStarter,
      qrStarter: mockWwebjsQrStart,
    },
    {
      provider: 'baileys' as const,
      modulePath: '../../../../apps/worker_baileys/src/consumer',
      starter: mockBaileysStarter,
      qrStarter: mockBaileysQrStart,
    },
  ])(
    'retries a failed $provider startup close during the serialized false transition',
    async ({ provider, modulePath, starter, qrStarter }) => {
      jest.resetModules();
      const runtime = require(modulePath) as RuntimeActivationModule;
      const fastify = makeFastify();
      await runtime.default?.(fastify);

      const readyConsumers = Array.from({ length: 0 }, () => ({
        close: jest.fn(async (): Promise<void> => undefined),
      }));
      const pendingConsumer = {
        close: jest
          .fn<Promise<void>, []>()
          .mockRejectedValueOnce(new Error('transient close failure'))
          .mockResolvedValueOnce(undefined),
      };
      const pending = deferred();
      starter.mockReset();
      for (const consumer of readyConsumers) {
        starter.mockResolvedValueOnce(consumer);
      }
      starter.mockImplementationOnce((_server, onCreated) => {
        onCreated?.(pendingConsumer);
        return pending.promise;
      });
      qrStarter.mockReset();
      qrStarter.mockResolvedValue({ close: jest.fn(async () => undefined) });
      mockRuntimeDesiredStates[provider] = true;

      const activate = getRuntimeActivator(runtime, provider);
      const activation = activate(fastify);
      await flushPromises(16);

      mockRuntimeDesiredStates[provider] = false;
      mockDesiredStateListeners.get(provider)?.(false);
      await flushPromises(16);
      pending.resolve(pendingConsumer);
      await activation;

      expect(pendingConsumer.close).toHaveBeenCalledTimes(2);
      await mockRuntimeStateListeners.get(provider)?.(false);
      expect(pendingConsumer.close).toHaveBeenCalledTimes(2);
    }
  );

  it.each([
    {
      provider: 'wwebjs' as const,
      modulePath: '../../../../apps/worker_wwebjs/src/consumer',
      starter: mockWwebjsStarter,
      qrStarter: mockWwebjsQrStart,
    },
    {
      provider: 'baileys' as const,
      modulePath: '../../../../apps/worker_baileys/src/consumer',
      starter: mockBaileysStarter,
      qrStarter: mockBaileysQrStart,
    },
  ])(
    'onClose waits for and closes a late $provider deferred consumer',
    async ({ provider, modulePath, starter, qrStarter }) => {
      jest.resetModules();
      const runtime = require(modulePath) as RuntimeActivationModule;
      const fastify = makeFastify();
      await runtime.default?.(fastify);

      const readyConsumers = Array.from({ length: 0 }, () => ({
        close: jest.fn(async (): Promise<void> => undefined),
      }));
      const pendingConsumer = {
        close: jest.fn(async (): Promise<void> => undefined),
      };
      const pending = deferred();
      starter.mockReset();
      for (const consumer of readyConsumers) {
        starter.mockResolvedValueOnce(consumer);
      }
      starter.mockImplementationOnce((_server, onCreated) => {
        onCreated?.(pendingConsumer);
        return pending.promise;
      });
      const qrConsumer = {
        close: jest.fn(async (): Promise<void> => undefined),
      };
      qrStarter.mockReset();
      qrStarter.mockResolvedValue(qrConsumer);
      mockRuntimeDesiredStates[provider] = true;

      const activate = getRuntimeActivator(runtime, provider);
      const activation = activate(fastify);
      const activationOutcome = activation.catch((error) => error);
      await flushPromises(16);

      const closing = getFastifyHook(fastify, 'onClose')();
      await flushPromises(16);
      expect(
        readyConsumers.every((consumer) => consumer.close.mock.calls.length > 0)
      ).toBe(true);
      expect(pendingConsumer.close).toHaveBeenCalledTimes(1);

      pending.resolve(pendingConsumer);
      await closing;
      await activationOutcome;

      expect(pendingConsumer.close).toHaveBeenCalledTimes(2);
      expect(qrConsumer.close).toHaveBeenCalled();
      expect(mockRegisterWorkerConsumer).toHaveBeenCalledTimes(1);
      expect(mockRegisteredWorkerConsumers).toEqual(
        provider === 'wwebjs' ? [] : [qrConsumer]
      );
    }
  );

  it.each([
    {
      provider: 'wwebjs' as const,
      modulePath: '../../../../apps/worker_wwebjs/src/consumer',
      starter: mockWwebjsStarter,
      qrStarter: mockWwebjsQrStart,
    },
    {
      provider: 'baileys' as const,
      modulePath: '../../../../apps/worker_baileys/src/consumer',
      starter: mockBaileysStarter,
      qrStarter: mockBaileysQrStart,
    },
  ])(
    'does not let a timed-out $provider attempt close a singleton reused by its successful retry',
    async ({ provider, modulePath, starter, qrStarter }) => {
      const previousTimeout =
        process.env.WORKER_COMMAND_INGRESS_STARTUP_TIMEOUT_MS;
      process.env.WORKER_COMMAND_INGRESS_STARTUP_TIMEOUT_MS = '1000';
      jest.useFakeTimers();
      try {
        jest.resetModules();
        const runtime = require(modulePath) as RuntimeActivationModule;
        const fastify = makeFastify();
        await runtime.default?.(fastify);

        const qrConsumer = {
          close: jest.fn(async (): Promise<void> => undefined),
        };
        const retryQrConsumer = {
          close: jest.fn(async (): Promise<void> => undefined),
        };
        qrStarter.mockReset();
        if (provider === 'wwebjs') {
          qrStarter
            .mockResolvedValueOnce(qrConsumer)
            .mockResolvedValue(retryQrConsumer);
          mockRuntimeService.bootstrapConnection.mockImplementation(
            async () => {
              if (
                mockRuntimeService.bootstrapConnection.mock.calls.length === 2
              ) {
                mockRuntimeDesiredStates.wwebjs = true;
              }
            }
          );
        } else {
          qrStarter.mockResolvedValue(qrConsumer);
        }
        const firstPending = deferred();
        let firstOnCreated: ((consumer: DeferredConsumer) => void) | undefined;
        const firstBatchConsumers = Array.from({ length: 0 }, () => ({
          close: jest.fn(async (): Promise<void> => undefined),
        }));
        const reusedConsumer = {
          close: jest.fn(async (): Promise<void> => undefined),
        };
        const retryConsumers = [
          reusedConsumer,
          ...Array.from({ length: 0 }, () => ({
            close: jest.fn(async (): Promise<void> => undefined),
          })),
        ];
        let starterCall = 0;
        starter.mockReset();
        starter.mockImplementation((_server, onCreated) => {
          const index = starterCall;
          starterCall += 1;
          if (index === 0) {
            firstOnCreated = onCreated;
            return firstPending.promise;
          }
          const consumer =
            index < 1
              ? firstBatchConsumers[index - 1]
              : retryConsumers[index - 1];
          onCreated?.(consumer);
          return Promise.resolve(consumer);
        });
        mockRuntimeDesiredStates[provider] = true;

        const activate = () => getRuntimeActivator(runtime, provider)(fastify);
        const firstOutcome = activate().catch((error: unknown) => error);
        await flushPromises(16);
        await jest.advanceTimersByTimeAsync(1000);
        await expect(firstOutcome).resolves.toEqual(
          expect.objectContaining({
            message: expect.stringContaining('startup_timeout'),
          })
        );

        await expect(activate()).resolves.toEqual({ alreadyActive: false });
        expect(mockRegisteredWorkerConsumers).toEqual([
          provider === 'wwebjs' ? retryQrConsumer : qrConsumer,
          ...retryConsumers,
        ]);

        firstOnCreated?.(reusedConsumer);
        firstPending.resolve(reusedConsumer);
        await flushPromises(16);

        expect(reusedConsumer.close).not.toHaveBeenCalled();
        expect(mockRegisteredWorkerConsumers).toContain(reusedConsumer);
      } finally {
        jest.useRealTimers();
        if (previousTimeout === undefined) {
          delete process.env.WORKER_COMMAND_INGRESS_STARTUP_TIMEOUT_MS;
        } else {
          process.env.WORKER_COMMAND_INGRESS_STARTUP_TIMEOUT_MS =
            previousTimeout;
        }
      }
    }
  );

  it.each([
    {
      provider: 'wwebjs' as const,
      modulePath: '../../../../apps/worker_wwebjs/src/consumer',
      qrStarter: mockWwebjsQrStart,
    },
    {
      provider: 'baileys' as const,
      modulePath: '../../../../apps/worker_baileys/src/consumer',
      qrStarter: mockBaileysQrStart,
    },
  ])(
    'onClose waits for and closes a late $provider QR consumer without registering it',
    async ({ provider, modulePath, qrStarter }) => {
      jest.resetModules();
      const runtime = require(modulePath) as RuntimeActivationModule;
      const fastify = makeFastify();
      await runtime.default?.(fastify);

      const qrConsumer = {
        close: jest.fn(async (): Promise<void> => undefined),
      };
      const pendingQr = deferred();
      qrStarter.mockReset();
      qrStarter.mockImplementationOnce(() => pendingQr.promise);
      mockRuntimeDesiredStates[provider] = true;

      const activate = getRuntimeActivator(runtime, provider);
      const activation = activate(fastify);
      const activationOutcome = activation.catch((error) => error);
      await flushPromises(8);

      const closing = getFastifyHook(fastify, 'onClose')();
      await flushPromises(8);
      expect(qrConsumer.close).not.toHaveBeenCalled();

      pendingQr.resolve(qrConsumer);
      await closing;
      await activationOutcome;

      expect(qrConsumer.close).toHaveBeenCalledTimes(1);
      expect(mockRegisterWorkerConsumer).not.toHaveBeenCalled();
    }
  );

  it.each([
    {
      provider: 'wwebjs' as const,
      modulePath: '../../../../apps/worker_wwebjs/src/consumer',
      starter: mockWwebjsStarter,
      qrStarter: mockWwebjsQrStart,
    },
    {
      provider: 'baileys' as const,
      modulePath: '../../../../apps/worker_baileys/src/consumer',
      starter: mockBaileysStarter,
      qrStarter: mockBaileysQrStart,
    },
  ])(
    'keeps exactly one registered $provider QR consumer after deferred startup retry',
    async ({ provider, modulePath, starter, qrStarter }) => {
      jest.resetModules();
      const runtime = require(modulePath) as RuntimeActivationModule;
      const fastify = makeFastify();
      const qrConsumer = {
        close: jest.fn(async (): Promise<void> => undefined),
      };
      const retryQrConsumer = {
        close: jest.fn(async (): Promise<void> => undefined),
      };
      qrStarter.mockReset();
      if (provider === 'wwebjs') {
        qrStarter
          .mockResolvedValueOnce(qrConsumer)
          .mockResolvedValue(retryQrConsumer);
        mockRuntimeService.bootstrapConnection.mockImplementation(async () => {
          if (mockRuntimeService.bootstrapConnection.mock.calls.length === 2) {
            mockRuntimeDesiredStates.wwebjs = true;
          }
        });
      } else {
        qrStarter.mockResolvedValue(qrConsumer);
      }
      starter.mockReset();
      starter.mockRejectedValueOnce(new Error('deferred_start_failed'));
      starter.mockResolvedValueOnce({
        close: jest.fn(async (): Promise<void> => undefined),
      });
      mockRuntimeDesiredStates[provider] = true;

      const activateRuntime = getRuntimeActivator(runtime, provider);
      const activate = () => activateRuntime(fastify);
      await expect(activate()).rejects.toThrow(
        `${provider}_kafka_consumer_start_failed:role=worker_command_ingress:code=consumer_start_error`
      );
      await expect(activate()).resolves.toEqual({ alreadyActive: false });

      expect(qrStarter).toHaveBeenCalledTimes(provider === 'wwebjs' ? 2 : 1);
      expect(qrConsumer.close).toHaveBeenCalledTimes(
        provider === 'wwebjs' ? 1 : 0
      );
      expect(mockRegisterWorkerConsumer).toHaveBeenCalledTimes(
        provider === 'wwebjs' ? 3 : 2
      );
      expect(mockRegisteredWorkerConsumers).toHaveLength(2);
      expect(mockRegisteredWorkerConsumers[0]).toBe(
        provider === 'wwebjs' ? retryQrConsumer : qrConsumer
      );
    }
  );

  it.each([
    {
      provider: 'wwebjs' as const,
      modulePath: '../../../../apps/worker_wwebjs/src/consumer',
      starter: mockWwebjsStarter,
      qrStarter: mockWwebjsQrStart,
    },
    {
      provider: 'baileys' as const,
      modulePath: '../../../../apps/worker_baileys/src/consumer',
      starter: mockBaileysStarter,
      qrStarter: mockBaileysQrStart,
    },
  ])(
    'blocks a new $provider batch until failed cleanup succeeds',
    async ({ provider, modulePath, starter, qrStarter }) => {
      jest.resetModules();
      const runtime = require(modulePath) as RuntimeActivationModule;
      const fastify = makeFastify();
      qrStarter.mockReset();
      const qrConsumer = {
        close: jest.fn(async (): Promise<void> => undefined),
      };
      const retryQrConsumer = {
        close: jest.fn(async (): Promise<void> => undefined),
      };
      if (provider === 'wwebjs') {
        qrStarter
          .mockResolvedValueOnce(qrConsumer)
          .mockResolvedValue(retryQrConsumer);
        mockRuntimeService.bootstrapConnection.mockImplementation(async () => {
          if (mockRuntimeService.bootstrapConnection.mock.calls.length === 2) {
            mockRuntimeDesiredStates.wwebjs = true;
          }
        });
      } else {
        qrStarter.mockResolvedValue(qrConsumer);
      }
      const remainingConsumer = {
        close: jest
          .fn<Promise<void>, []>()
          .mockRejectedValueOnce(new Error('cleanup_failed_once'))
          .mockRejectedValueOnce(new Error('cleanup_failed_twice'))
          .mockResolvedValue(undefined),
      };
      let starterCall = 0;
      starter.mockReset();
      starter.mockImplementation(async (_server, onCreated) => {
        starterCall += 1;
        if (starterCall === 1) {
          onCreated?.(remainingConsumer);
          throw new Error('deferred_start_failed');
        }
        const consumer = {
          close: jest.fn(async (): Promise<void> => undefined),
        };
        onCreated?.(consumer);
        return consumer;
      });
      mockRuntimeDesiredStates[provider] = true;

      const activateRuntime = getRuntimeActivator(runtime, provider);
      const activate = () => activateRuntime(fastify);
      await expect(activate()).rejects.toThrow(
        provider === 'wwebjs'
          ? 'wwebjs_runtime_activation_cleanup_incomplete:failures=1'
          : 'baileys_kafka_consumer_startup_cleanup_failed:role=worker_command_ingress'
      );
      expect(starter).toHaveBeenCalledTimes(1);
      expect(remainingConsumer.close).toHaveBeenCalledTimes(
        provider === 'wwebjs' ? 2 : 1
      );
      expect(
        (
          fastify as unknown as {
            log: { error: jest.Mock };
          }
        ).log.error
      ).toHaveBeenCalledWith(
        {
          startup_failed_roles: ['worker_command_ingress'],
          startup_failure_codes: ['cleanup_failed'],
          cleanup_failed_roles: [],
          cleanup_failure_codes: [],
        },
        expect.stringContaining('startup do lote Kafka não foi concluído')
      );

      if (provider === 'baileys') {
        await expect(activate()).rejects.toThrow('remanescente');
        expect(starter).toHaveBeenCalledTimes(1);
        expect(remainingConsumer.close).toHaveBeenCalledTimes(2);
      }

      await expect(activate()).resolves.toEqual({ alreadyActive: false });
      expect(starter).toHaveBeenCalledTimes(2);
      expect(remainingConsumer.close).toHaveBeenCalledTimes(3);
      expect(qrStarter).toHaveBeenCalledTimes(provider === 'wwebjs' ? 2 : 1);
      expect(mockRegisteredWorkerConsumers[0]).toBe(
        provider === 'wwebjs' ? retryQrConsumer : qrConsumer
      );
    }
  );

  it.each([
    {
      provider: 'wwebjs' as const,
      modulePath: '../../../../apps/worker_wwebjs/src/consumer',
      starter: mockWwebjsStarter,
      qrStarter: mockWwebjsQrStart,
    },
    {
      provider: 'baileys' as const,
      modulePath: '../../../../apps/worker_baileys/src/consumer',
      starter: mockBaileysStarter,
      qrStarter: mockBaileysQrStart,
    },
  ])(
    'closes both $provider owners when onCreated and the resolved consumer disagree',
    async ({ provider, modulePath, starter, qrStarter }) => {
      jest.resetModules();
      const runtime = require(modulePath) as RuntimeActivationModule;
      const fastify = makeFastify();
      await runtime.default?.(fastify);

      qrStarter.mockReset();
      const qrConsumer = {
        close: jest.fn(async (): Promise<void> => undefined),
      };
      qrStarter.mockResolvedValue(qrConsumer);
      const announcedConsumer = {
        close: jest.fn(async (): Promise<void> => undefined),
      };
      const resolvedConsumer = {
        close: jest.fn(async (): Promise<void> => undefined),
      };
      const remainingConsumers = Array.from({ length: 0 }, () => ({
        close: jest.fn(async (): Promise<void> => undefined),
      }));
      let starterCall = 0;
      starter.mockReset();
      starter.mockImplementation(async (_server, onCreated) => {
        const index = starterCall;
        starterCall += 1;
        if (index === 0) {
          onCreated?.(announcedConsumer);
          return resolvedConsumer;
        }
        const consumer = remainingConsumers[index - 1];
        onCreated?.(consumer);
        return consumer;
      });
      mockRuntimeDesiredStates[provider] = true;

      await expect(
        getRuntimeActivator(runtime, provider)(fastify)
      ).rejects.toThrow(
        `${provider}_kafka_consumer_start_failed:role=worker_command_ingress:code=consumer_identity_changed`
      );

      expect(announcedConsumer.close).toHaveBeenCalledTimes(1);
      expect(resolvedConsumer.close).toHaveBeenCalledTimes(1);
      expect(
        remainingConsumers.every(
          (consumer) => consumer.close.mock.calls.length === 1
        )
      ).toBe(true);
      expect(mockRegisteredWorkerConsumers).toEqual(
        provider === 'wwebjs' ? [] : [qrConsumer]
      );
    }
  );
});
