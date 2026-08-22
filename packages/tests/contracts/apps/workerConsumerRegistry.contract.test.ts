export {};

const healthSnapshot = jest.fn((consumer: { health?: unknown }) =>
  consumer.health ? consumer.health : null
);
const mockBuildMissingKafkaConsumerHealthSnapshot = jest.fn(
  ({ owner }: { owner: string; registeredAt: number; graceMs: number }) => ({
    owner,
    missing: true,
    unhealthy: false,
  })
);

jest.mock('@core/common/functions/kafkaConsumerHealth', () => ({
  buildMissingKafkaConsumerHealthSnapshot:
    mockBuildMissingKafkaConsumerHealthSnapshot,
  getConsumerOwnerKafkaHealthSnapshot: (consumer: { health?: unknown }) =>
    healthSnapshot(consumer),
  getConsumerOwnerName: (consumer: { name?: string }) =>
    consumer.name ?? 'test-consumer',
}));

interface RegistryModule {
  EXPECTED_KAFKA_CONSUMER_COUNT: number;
  registerWorkerConsumer(consumer: {
    name?: string;
    execute?: () => Promise<void>;
    close?: () => Promise<void>;
    restart?: () => Promise<void>;
    health?: unknown;
  }): void;
  unregisterWorkerConsumer(consumer: {
    name?: string;
    execute?: () => Promise<void>;
    close?: () => Promise<void>;
    restart?: () => Promise<void>;
    health?: unknown;
  }): boolean;
  getKafkaConsumerHealthSnapshots(): Array<Record<string, unknown>>;
  getKafkaConsumerHealthSummary(snapshots?: unknown[]): {
    expected: number;
    active: number;
    missing: number;
    unhealthy: number;
  };
  areKafkaConsumersReady(summary?: {
    expected: number;
    active: number;
    missing: number;
    unhealthy: number;
  }): boolean;
  hasUnhealthyKafkaConsumer(): boolean;
  hasKafkaConsumerRequiringProcessReplacement(): boolean;
  waitForKafkaConsumersReady(options?: {
    timeoutMs?: number;
    shouldContinue?: () => boolean;
  }): Promise<void>;
  reconcileKafkaConsumers(
    log: { warn: jest.Mock; error: jest.Mock },
    trigger?: string
  ): Promise<void>;
  setKafkaConsumersProviderReady(
    ready: boolean,
    log: { warn: jest.Mock; error: jest.Mock }
  ): Promise<void>;
  startKafkaConsumerSupervisor(log: {
    warn: jest.Mock;
    error: jest.Mock;
  }): void;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

async function flushPromises(times = 4): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

function loadRegistry(modulePath: string): RegistryModule {
  jest.resetModules();
  return require(modulePath) as RegistryModule;
}

function buildActiveKafkaHealth(index: number) {
  return {
    owner: `consumer-${index}`,
    group_id: `uc_worker_${index}`,
    assignments_ready: true,
    dispatch_authorized: true,
    topics: [`uc.worker.command.worker-${index}`],
    connected: true,
    consuming: true,
    unhealthy: false,
    restart_count: 0,
    last_message_at: 0,
    last_commit_at: 0,
    last_restart_at: 0,
    last_error: '',
  };
}

const registryModules = [
  '../../../../apps/worker_baileys/src/consumer/registry',
  '../../../../apps/worker_wwebjs/src/consumer/registry',
];

describe.each(registryModules)('worker consumer registry %s', (modulePath) => {
  const originalMissingSnapshotGrace =
    process.env.KAFKA_CONSUMER_MISSING_SNAPSHOT_GRACE_MS;
  const originalRebalanceGrace = process.env.KAFKA_CONSUMER_REBALANCE_GRACE_MS;
  const originalReconcileBackoffBase =
    process.env.KAFKA_CONSUMER_RECONCILE_BACKOFF_BASE_MS;
  const originalReconcileBackoffMax =
    process.env.KAFKA_CONSUMER_RECONCILE_BACKOFF_MAX_MS;
  const originalReconcileJitter =
    process.env.KAFKA_CONSUMER_RECONCILE_JITTER_RATIO;

  beforeEach(() => {
    jest.useFakeTimers();
    healthSnapshot.mockClear();
    mockBuildMissingKafkaConsumerHealthSnapshot.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    restoreEnvironmentVariable(
      'KAFKA_CONSUMER_MISSING_SNAPSHOT_GRACE_MS',
      originalMissingSnapshotGrace
    );
    restoreEnvironmentVariable(
      'KAFKA_CONSUMER_REBALANCE_GRACE_MS',
      originalRebalanceGrace
    );
    restoreEnvironmentVariable(
      'KAFKA_CONSUMER_RECONCILE_BACKOFF_BASE_MS',
      originalReconcileBackoffBase
    );
    restoreEnvironmentVariable(
      'KAFKA_CONSUMER_RECONCILE_BACKOFF_MAX_MS',
      originalReconcileBackoffMax
    );
    restoreEnvironmentVariable(
      'KAFKA_CONSUMER_RECONCILE_JITTER_RATIO',
      originalReconcileJitter
    );
  });

  it('fails closed before the worker command ingress is registered', () => {
    const registry = loadRegistry(modulePath);

    expect(registry.EXPECTED_KAFKA_CONSUMER_COUNT).toBe(1);
    expect(registry.getKafkaConsumerHealthSummary()).toEqual({
      expected: 1,
      active: 0,
      missing: 1,
      unhealthy: 0,
    });
    expect(registry.areKafkaConsumersReady()).toBe(false);
    expect(registry.hasUnhealthyKafkaConsumer()).toBe(true);
  });

  it('becomes ready only when the JetStream ingress is authorized', () => {
    const registry = loadRegistry(modulePath);

    Array.from({ length: 1 }, (_, index) => ({
      name: `consumer-${index}`,
      health: buildActiveKafkaHealth(index),
    })).forEach((consumer) => registry.registerWorkerConsumer(consumer));

    expect(registry.getKafkaConsumerHealthSummary()).toEqual({
      expected: 1,
      active: 1,
      missing: 0,
      unhealthy: 0,
    });
    expect(registry.areKafkaConsumersReady()).toBe(true);
    expect(registry.hasUnhealthyKafkaConsumer()).toBe(false);
  });

  it('registers an owner once and removes it completely after failed startup cleanup', () => {
    const registry = loadRegistry(modulePath);
    const consumer = {
      name: 'startup-owner',
      health: buildActiveKafkaHealth(1),
    };

    registry.registerWorkerConsumer(consumer);
    registry.registerWorkerConsumer(consumer);
    expect(registry.getKafkaConsumerHealthSummary()).toMatchObject({
      active: 1,
      missing: 0,
    });

    expect(registry.unregisterWorkerConsumer(consumer)).toBe(true);
    expect(registry.unregisterWorkerConsumer(consumer)).toBe(false);
    expect(registry.getKafkaConsumerHealthSummary()).toEqual({
      expected: 1,
      active: 0,
      missing: 1,
      unhealthy: 0,
    });
  });

  it.each([
    ['is disconnected', { connected: false }],
    ['is not consuming', { consuming: false }],
    ['has no filtered subject', { topics: [] }],
    ['has no active subscription', { assignments_ready: false }],
    ['has the wrong durable', { group_id: 'legacy-kafka-group' }],
    ['is unhealthy', { unhealthy: true }],
  ])('fails closed when the ingress %s', (_label, override) => {
    const registry = loadRegistry(modulePath);

    Array.from({ length: 1 }, (_, index) => ({
      name: `consumer-${index}`,
      health: {
        ...buildActiveKafkaHealth(index),
        ...(index === 0 ? override : {}),
      },
    })).forEach((consumer) => registry.registerWorkerConsumer(consumer));

    expect(registry.areKafkaConsumersReady()).toBe(false);
    expect(registry.hasUnhealthyKafkaConsumer()).toBe(true);
  });

  it('reports ingress assigned before the central dispatch authorization bootstrap', () => {
    const registry = loadRegistry(modulePath);
    registry.registerWorkerConsumer({
      health: {
        ...buildActiveKafkaHealth(0),
        dispatch_authorized: false,
      },
    });

    expect(registry.areKafkaConsumersReady()).toBe(true);
    expect(registry.getKafkaConsumerHealthSnapshots()[0]).toMatchObject({
      assignments_ready: true,
      dispatch_authorized: false,
    });
  });

  it('counts unregistered and registered-without-snapshot consumers as missing', () => {
    const registry = loadRegistry(modulePath);

    registry.registerWorkerConsumer({ name: 'consumer-without-snapshot' });

    expect(registry.getKafkaConsumerHealthSummary()).toEqual({
      expected: 1,
      active: 0,
      missing: 1,
      unhealthy: 0,
    });
    expect(registry.areKafkaConsumersReady()).toBe(false);
  });

  it('uses the one-second catalog default for a missing health snapshot', () => {
    delete process.env.KAFKA_CONSUMER_MISSING_SNAPSHOT_GRACE_MS;
    const registry = loadRegistry(modulePath);

    registry.registerWorkerConsumer({ name: 'consumer-without-snapshot' });
    registry.getKafkaConsumerHealthSummary();

    expect(mockBuildMissingKafkaConsumerHealthSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ graceMs: 1_000 })
    );
  });

  it('waits for the delayed subscription before declaring the provider ready', async () => {
    const registry = loadRegistry(modulePath);
    const consumers = Array.from({ length: 1 }, (_, index) => ({
      name: `consumer-${index}`,
      health: {
        ...buildActiveKafkaHealth(index),
        assignments_ready: false,
      },
    }));
    consumers.forEach((consumer) => registry.registerWorkerConsumer(consumer));

    let settled = false;
    const waiting = registry
      .waitForKafkaConsumersReady({ timeoutMs: 1_000 })
      .then(() => {
        settled = true;
      });
    await flushPromises();
    expect(settled).toBe(false);

    consumers.forEach((consumer, index) => {
      consumer.health = buildActiveKafkaHealth(index);
    });
    jest.advanceTimersByTime(100);
    await waiting;

    expect(settled).toBe(true);
    expect(registry.areKafkaConsumersReady()).toBe(true);
  });

  it('fails the readiness wait with an actionable Kafka summary', async () => {
    const registry = loadRegistry(modulePath);
    const waiting = registry.waitForKafkaConsumersReady({ timeoutMs: 1 });

    jest.advanceTimersByTime(1);
    await flushPromises();

    await expect(waiting).rejects.toThrow(
      'kafka_consumers_not_ready:expected=1,active=0,missing=1,unhealthy=0'
    );
  });

  it('allows a transient disconnect but reconciles a persistent missing subject', async () => {
    process.env.KAFKA_CONSUMER_REBALANCE_GRACE_MS = '1000';
    process.env.KAFKA_CONSUMER_RECONCILE_JITTER_RATIO = '0';
    const registry = loadRegistry(modulePath);
    const consumer = {
      name: 'assignment-consumer',
      health: buildActiveKafkaHealth(0),
      restart: jest.fn(async () => undefined),
    };
    const log = { warn: jest.fn(), error: jest.fn() };
    registry.registerWorkerConsumer(consumer);
    registry.getKafkaConsumerHealthSummary();

    consumer.health = {
      ...buildActiveKafkaHealth(0),
      topics: [],
    };
    registry.getKafkaConsumerHealthSummary();
    jest.advanceTimersByTime(999);
    await registry.reconcileKafkaConsumers(log, 'test_rebalance');
    expect(consumer.restart).not.toHaveBeenCalled();

    consumer.health = buildActiveKafkaHealth(0);
    registry.getKafkaConsumerHealthSummary();
    jest.advanceTimersByTime(1000);
    await registry.reconcileKafkaConsumers(log, 'test_recovered');
    expect(consumer.restart).not.toHaveBeenCalled();

    consumer.health = {
      ...buildActiveKafkaHealth(0),
      topics: [],
    };
    registry.getKafkaConsumerHealthSummary();
    jest.advanceTimersByTime(1000);
    await registry.reconcileKafkaConsumers(log, 'readiness_timeout');

    expect(consumer.restart).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        readiness_issue: 'worker_command_ingress_identity_invalid',
        reconciliation_attempt: 1,
        reconciliation_trigger: 'readiness_timeout',
      }),
      'Kafka consumer supervisor reconciling non-ready owner'
    );
  });

  it('backs off repeated reconciliation attempts with jitter', async () => {
    process.env.KAFKA_CONSUMER_REBALANCE_GRACE_MS = '1000';
    process.env.KAFKA_CONSUMER_RECONCILE_BACKOFF_BASE_MS = '2000';
    process.env.KAFKA_CONSUMER_RECONCILE_BACKOFF_MAX_MS = '10000';
    process.env.KAFKA_CONSUMER_RECONCILE_JITTER_RATIO = '0.2';
    jest.spyOn(Math, 'random').mockReturnValue(0.75);
    const registry = loadRegistry(modulePath);
    const consumer = {
      name: 'assignment-consumer',
      health: {
        ...buildActiveKafkaHealth(0),
        topics: [],
      },
      restart: jest.fn(async () => undefined),
    };
    const log = { warn: jest.fn(), error: jest.fn() };
    registry.registerWorkerConsumer(consumer);
    registry.getKafkaConsumerHealthSummary();

    jest.advanceTimersByTime(1000);
    await registry.reconcileKafkaConsumers(log, 'readiness_timeout');
    expect(consumer.restart).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        reconciliation_attempt: 1,
        retry_in_ms: 2200,
      }),
      'Kafka consumer supervisor reconciling non-ready owner'
    );

    jest.advanceTimersByTime(2199);
    await registry.reconcileKafkaConsumers(log, 'readiness_timeout');
    expect(consumer.restart).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1);
    await registry.reconcileKafkaConsumers(log, 'readiness_timeout');
    expect(consumer.restart).toHaveBeenCalledTimes(2);
    expect(log.warn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        reconciliation_attempt: 2,
        retry_in_ms: 4400,
      }),
      'Kafka consumer supervisor reconciling non-ready owner'
    );
  });

  it('does not create another native generation when process replacement is required', async () => {
    const registry = loadRegistry(modulePath);
    const consumer = {
      name: 'native-ghost-consumer',
      health: {
        ...buildActiveKafkaHealth(0),
        connected: false,
        assignments_ready: false,
        unhealthy: true,
        stall_reason: 'native_disconnect_timeout',
        pod_replacement_required: true,
        pod_replacement_reason: 'native_disconnect_timeout',
      },
      restart: jest.fn(async () => undefined),
    };
    const log = { warn: jest.fn(), error: jest.fn() };
    registry.registerWorkerConsumer(consumer);

    expect(registry.hasKafkaConsumerRequiringProcessReplacement()).toBe(true);
    await registry.reconcileKafkaConsumers(log, 'supervisor');

    expect(consumer.restart).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({
        group_id: 'uc_worker_0',
        pod_replacement_reason: 'native_disconnect_timeout',
      }),
      'Kafka native consumer requires worker process replacement'
    );
  });

  it('closes and reopens all monitored consumers in parallel', async () => {
    const registry = loadRegistry(modulePath);
    const closeGates = [deferred(), deferred(), deferred()];
    const consumers = closeGates.map((gate, index) => ({
      name: `consumer-${index}`,
      close: jest.fn(() => gate.promise),
      execute: jest.fn(async () => undefined),
    }));
    consumers.forEach((consumer) => registry.registerWorkerConsumer(consumer));
    const log = { warn: jest.fn(), error: jest.fn() };

    const stopping = registry.setKafkaConsumersProviderReady(false, log);
    await flushPromises();
    expect(
      consumers.every((consumer) => consumer.close.mock.calls.length === 1)
    ).toBe(true);

    const reopening = registry.setKafkaConsumersProviderReady(true, log);
    expect(
      consumers.every((consumer) => consumer.execute.mock.calls.length === 0)
    ).toBe(true);
    closeGates.forEach((gate) => gate.resolve());
    await Promise.all([stopping, reopening]);

    expect(
      consumers.every((consumer) => consumer.execute.mock.calls.length === 1)
    ).toBe(true);
  });

  it('does not report consumers ready while an empty registry is bootstrapping', async () => {
    const registry = loadRegistry(modulePath);
    const log = { warn: jest.fn(), error: jest.fn() };

    await registry.setKafkaConsumersProviderReady(false, log);
    log.warn.mockClear();
    await registry.setKafkaConsumersProviderReady(true, log);

    expect(log.warn).toHaveBeenCalledWith(
      {
        ready: false,
        provider_state_applied: true,
        consumer_count: 0,
        expected_consumer_count: 1,
        active_consumer_count: 0,
        missing_consumer_count: 1,
        unhealthy_consumer_count: 0,
      },
      'Kafka provider ready; consumers are still registering or assigning'
    );
  });

  it('serializes the supervisor behind provider transitions and desired state', async () => {
    const registry = loadRegistry(modulePath);
    const closeGate = deferred();
    const executeGate = deferred();
    const consumer = {
      name: 'unhealthy-consumer',
      health: {
        owner: 'unhealthy-consumer',
        unhealthy: true,
        topics: ['worker.w1.send.message'],
      },
      close: jest.fn(() => closeGate.promise),
      execute: jest.fn(() => executeGate.promise),
      restart: jest.fn(async () => undefined),
    };
    registry.registerWorkerConsumer(consumer);
    const log = { warn: jest.fn(), error: jest.fn() };
    registry.startKafkaConsumerSupervisor(log);

    const stopping = registry.setKafkaConsumersProviderReady(false, log);
    await flushPromises();
    jest.advanceTimersByTime(30_000);
    await flushPromises();
    expect(consumer.restart).not.toHaveBeenCalled();

    closeGate.resolve();
    await stopping;
    await flushPromises();
    expect(consumer.restart).not.toHaveBeenCalled();

    const reopening = registry.setKafkaConsumersProviderReady(true, log);
    await flushPromises();
    jest.advanceTimersByTime(30_000);
    await flushPromises();
    expect(consumer.restart).not.toHaveBeenCalled();

    executeGate.resolve();
    await reopening;
    await flushPromises(8);
    expect(consumer.restart).toHaveBeenCalledTimes(1);
  });

  it('rolls back a partial reopen and retries from provider-not-ready', async () => {
    const registry = loadRegistry(modulePath);
    const failedConsumer = {
      name: 'failed-consumer',
      close: jest.fn(async () => undefined),
      execute: jest
        .fn()
        .mockRejectedValueOnce(new Error('assignment_failed'))
        .mockResolvedValueOnce(undefined),
    };
    const healthyConsumer = {
      name: 'healthy-consumer',
      close: jest.fn(async () => undefined),
      execute: jest.fn(async () => undefined),
    };
    registry.registerWorkerConsumer(failedConsumer);
    registry.registerWorkerConsumer(healthyConsumer);
    const log = { warn: jest.fn(), error: jest.fn() };

    await registry.setKafkaConsumersProviderReady(false, log);
    await expect(
      registry.setKafkaConsumersProviderReady(true, log)
    ).rejects.toThrow('lifecycle transition failed');

    expect(failedConsumer.close).toHaveBeenCalledTimes(2);
    expect(healthyConsumer.close).toHaveBeenCalledTimes(2);
    await expect(
      registry.setKafkaConsumersProviderReady(true, log)
    ).resolves.toBeUndefined();
    expect(failedConsumer.execute).toHaveBeenCalledTimes(2);
    expect(healthyConsumer.execute).toHaveBeenCalledTimes(2);
  });

  it('starts closing ready consumers before a concurrent reopen finishes', async () => {
    const registry = loadRegistry(modulePath);
    const pendingExecute = deferred();
    const readyConsumer = {
      name: 'ready-consumer',
      close: jest.fn(async () => undefined),
      execute: jest.fn(async () => undefined),
    };
    const pendingConsumer = {
      name: 'pending-consumer',
      close: jest.fn(async () => undefined),
      execute: jest.fn(() => pendingExecute.promise),
    };
    registry.registerWorkerConsumer(readyConsumer);
    registry.registerWorkerConsumer(pendingConsumer);
    const log = { warn: jest.fn(), error: jest.fn() };

    await registry.setKafkaConsumersProviderReady(false, log);
    readyConsumer.close.mockClear();
    pendingConsumer.close.mockClear();

    const reopening = registry.setKafkaConsumersProviderReady(true, log);
    await flushPromises(8);
    expect(readyConsumer.execute).toHaveBeenCalledTimes(1);
    expect(pendingConsumer.execute).toHaveBeenCalledTimes(1);

    const stopping = registry.setKafkaConsumersProviderReady(false, log);
    await flushPromises(8);

    expect(readyConsumer.close).toHaveBeenCalled();
    expect(pendingConsumer.close).toHaveBeenCalled();

    pendingExecute.resolve();
    await Promise.all([reopening, stopping]);
    await expect(
      registry.setKafkaConsumersProviderReady(true, log)
    ).resolves.toBeUndefined();
    expect(readyConsumer.execute).toHaveBeenCalledTimes(2);
    expect(pendingConsumer.execute).toHaveBeenCalledTimes(2);
  });

  it('closes an owner unregistered while a serialized reopen is in flight', async () => {
    const registry = loadRegistry(modulePath);
    const executeGate = deferred();
    const consumer = {
      name: 'startup-owner',
      close: jest.fn(async () => undefined),
      execute: jest.fn(() => executeGate.promise),
    };
    const log = { warn: jest.fn(), error: jest.fn() };
    registry.registerWorkerConsumer(consumer);
    await registry.setKafkaConsumersProviderReady(false, log);
    consumer.close.mockClear();

    const reopening = registry.setKafkaConsumersProviderReady(true, log);
    await flushPromises(8);
    expect(consumer.execute).toHaveBeenCalledTimes(1);
    expect(registry.unregisterWorkerConsumer(consumer)).toBe(true);
    executeGate.resolve();
    await reopening;

    expect(consumer.close).toHaveBeenCalledTimes(1);
    expect(registry.getKafkaConsumerHealthSummary()).toEqual({
      expected: 1,
      active: 0,
      missing: 1,
      unhealthy: 0,
    });
  });

  it('closes an owner unregistered while the supervisor restart is in flight', async () => {
    const registry = loadRegistry(modulePath);
    const restartGate = deferred();
    const consumer = {
      name: 'startup-owner',
      health: {
        owner: 'startup-owner',
        unhealthy: true,
        topics: ['worker.w1.send.message'],
      },
      close: jest.fn(async () => undefined),
      restart: jest.fn(() => restartGate.promise),
    };
    const log = { warn: jest.fn(), error: jest.fn() };
    registry.registerWorkerConsumer(consumer);

    const reconciling = registry.reconcileKafkaConsumers(log, 'test');
    await flushPromises(8);
    expect(consumer.restart).toHaveBeenCalledTimes(1);
    expect(registry.unregisterWorkerConsumer(consumer)).toBe(true);
    restartGate.resolve();
    await reconciling;

    expect(consumer.close).toHaveBeenCalledTimes(1);
    expect(registry.getKafkaConsumerHealthSummary()).toEqual({
      expected: 1,
      active: 0,
      missing: 1,
      unhealthy: 0,
    });
  });
});

function restoreEnvironmentVariable(
  name: string,
  value: string | undefined
): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
