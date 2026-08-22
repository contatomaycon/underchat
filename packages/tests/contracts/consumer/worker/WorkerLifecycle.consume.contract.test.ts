import 'reflect-metadata';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { IWorkerLifecycleQueueMessage } from '@core/common/interfaces/IWorkerLifecycleQueueMessage';
import { workerLifecycleBudgets } from '@core/common/functions/workerLifecycleBudgets';

jest.mock('@core/common/functions/commitOffset', () => ({
  commitOffset: jest.fn(async () => undefined),
}));

jest.mock('@core/common/functions/connectConsumer', () => ({
  connectConsumer: jest.fn(async (_consumer, _topic, onConnected) => {
    onConnected?.();
  }),
}));

jest.mock('@core/common/functions/createConsumer', () => ({
  createConsumer: jest.fn(),
}));

jest.mock('@core/common/functions/ensureKafkaTopic', () => ({
  ensureKafkaTopic: jest.fn(async () => undefined),
}));

jest.mock('@core/plugins/kafkaStreams', () => ({}));

jest.mock('@core/services/kafkaServiceQueue.service', () => ({
  KafkaServiceQueueService: class KafkaServiceQueueService {},
}));

jest.mock('@core/services/workerGrpcClient.service', () => ({
  WorkerGrpcClientService: class WorkerGrpcClientService {},
}));

jest.mock('@core/services/worker.service', () => ({
  WorkerService: class WorkerService {},
}));

jest.mock('@core/services/workerWarmPoolQueue.service', () => ({
  WorkerWarmPoolQueueService: class WorkerWarmPoolQueueService {},
}));

jest.mock('@core/services/workerWarmPoolSettings.service', () => ({
  WorkerWarmPoolSettingsService: class WorkerWarmPoolSettingsService {},
}));

jest.mock('@core/repositories/worker/WorkerRuntime.repository', () => ({
  WorkerRuntimeRepository: class WorkerRuntimeRepository {},
}));

jest.mock('uuid', () => ({
  v7: jest.fn(() => 'generated-request-id'),
}));

import { WorkerLifecycleConsume } from '@core/consumer/worker/WorkerLifecycle.consume';
import { commitOffset } from '@core/common/functions/commitOffset';
import { connectConsumer } from '@core/common/functions/connectConsumer';
import { createConsumer } from '@core/common/functions/createConsumer';

const { setImmediate: scheduleRealImmediate } =
  jest.requireActual<typeof import('node:timers')>('node:timers');

async function flushPromises(times = 6): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

async function waitForCondition(
  condition: () => boolean,
  description: string,
  maxTurns = 50
): Promise<void> {
  for (let turn = 0; turn < maxTurns; turn += 1) {
    if (condition()) {
      return;
    }
    await new Promise<void>((resolve) => scheduleRealImmediate(resolve));
  }

  throw new Error(`Timed out waiting for ${description}`);
}

async function waitForCommit(partition: number, offset: number): Promise<void> {
  await waitForCondition(
    () =>
      (commitOffset as jest.Mock).mock.calls.some(
        (call) => call[2] === partition && call[3] === offset
      ),
    `Kafka commit for partition ${partition} offset ${offset}`
  );
}

function lifecyclePayload(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    request_id: 'request-1',
    operation_id: 'operation-1',
    action: 'create',
    worker_id: 'worker-1',
    account_id: 'account-1',
    server_id: 'server-1',
    worker_type_id: EWorkerType.baileys,
    worker_status_id: EWorkerStatus.creating,
    source: 'worker_create',
    debug_trace_id: 'trace-1',
    requested_at: '2026-06-05T00:00:00.000Z',
    ...overrides,
  };
}

function currentWorker(overrides: Record<string, unknown> = {}) {
  return {
    worker_id: 'worker-1',
    account_id: 'account-1',
    server_id: 'server-1',
    worker_type_id: EWorkerType.baileys,
    worker_status_id: EWorkerStatus.creating,
    lifecycle_operation_id: 'operation-1',
    ...overrides,
  };
}

function strictHealthyRuntimeHealth(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const workerType =
    (overrides.worker_type_id as EWorkerType | undefined) ??
    EWorkerType.baileys;
  const provider =
    workerType === EWorkerType.wwebjs
      ? 'wwebjs'
      : workerType === EWorkerType.whatsmeow
        ? 'whatsmeow'
        : 'baileys';
  return {
    worker_id: 'worker-1',
    account_id: 'account-1',
    worker_type_id: workerType,
    runtime_generation: 4,
    runtime_health_schema_version: 3,
    runtime_state: 'active',
    has_session: true,
    has_qr: false,
    session_ready: true,
    can_send: true,
    can_receive_runtime: true,
    authenticated: true,
    activated: true,
    ready: true,
    standby: false,
    kafka_unhealthy: false,
    kafka_consumers_ready: true,
    kafka_consumers_authorized: true,
    phone: '5561999999999',
    connection_status_source_id: '019fccbb-05eb-7126-bb30-fc6bf21226a8',
    connection_status: {
      provider,
      status: 'online',
      connected: true,
      authenticated: true,
      sessionValid: true,
      recoverable: true,
      qrAvailable: false,
      sequence: 9,
      changedAt: '2026-08-04T12:00:00.000Z',
    },
    ...overrides,
  };
}

function makeSut() {
  const handlers: Record<string, (message: any) => Promise<void>> = {};
  const kafkaConsumer: {
    on: jest.Mock;
    unsubscribe: jest.Mock;
    disconnect: jest.Mock;
    __isAssignmentEpochActive: jest.Mock;
  } = {
    on: jest.fn(),
    unsubscribe: jest.fn(),
    disconnect: jest.fn(),
    __isAssignmentEpochActive: jest.fn(
      (_topic: string, _partition: number, epoch: number) => epoch === 101
    ),
  };
  kafkaConsumer.on = jest.fn(
    (event: string, handler: (message: any) => Promise<void>) => {
      handlers[event] = handler;
      return kafkaConsumer;
    }
  );
  kafkaConsumer.disconnect = jest.fn((callback: () => void) => callback());
  (createConsumer as jest.Mock).mockReturnValue(kafkaConsumer);
  const kafka = {
    getBroker: jest.fn(() => 'broker-a:9092'),
  };

  const kafkaServiceQueueService = {
    workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
    getNumPartitions: jest.fn(() => 30),
    getReplicationFactor: jest.fn(() => 3),
  };
  const workerGrpcClientService = {
    createWorker: jest.fn<Promise<void>, unknown[]>(async () => undefined),
    recreateWorker: jest.fn<Promise<void>, unknown[]>(async () => undefined),
    deleteWorker: jest.fn<Promise<void>, unknown[]>(async () => undefined),
    cleanupWorker: jest.fn<Promise<void>, unknown[]>(async () => undefined),
    activateWarmWorker: jest.fn<
      Promise<{ claimed?: boolean; error?: string }>,
      unknown[]
    >(async () => ({ claimed: true })),
    deleteWarmWorker: jest.fn<Promise<void>, unknown[]>(async () => undefined),
    runtimeHealth: jest.fn<Promise<Record<string, unknown>>, unknown[]>(
      async () => ({})
    ),
  };
  const workerService = {
    viewWorkerForMonitor: jest.fn(async () => currentWorker()),
    viewWorkerForMonitorConsistent: jest.fn(async () => currentWorker()),
    updateWorkerByIdIfLifecycleMatches: jest.fn(
      async (
        _accountId: string,
        _input: Record<string, unknown>,
        _guard: Record<string, unknown>
      ) => true
    ),
  };
  const workerLifecycleQueueService = {
    publish: jest.fn(async () => undefined),
    loadPrepared: jest.fn<
      Promise<IWorkerLifecycleQueueMessage[]>,
      [string, string]
    >(async () => []),
    loadAuthoritativePreparedPayload: jest.fn<
      Promise<IWorkerLifecycleQueueMessage | null>,
      [IWorkerLifecycleQueueMessage]
    >(async (payload) => payload),
  };
  const connectionLifecycleDebugService = {
    log: jest.fn(async () => undefined),
  };
  const workerRecreateServerSlotService = {
    releaseReservedSlot: jest.fn(async () => undefined),
  };
  const workerLifecycleLockService = {
    isLocked: jest.fn(async () => false),
    releaseRedriveClaim: jest.fn(async () => true),
  };
  const workerRuntimeRepository = {
    viewByWorkerIdConsistent: jest.fn<
      Promise<Record<string, unknown> | null>,
      unknown[]
    >(async () => null),
    reconcileHealthyRuntimeLifecycle: jest.fn(async () => true),
    isWhatsappProviderHandoffTargetAuthorized: jest.fn(async () => false),
    viewWhatsappProviderHandoffLifecycleContext: jest.fn<
      Promise<Record<string, unknown> | null>,
      unknown[]
    >(async () => null),
    viewWhatsappProviderHandoffTerminalLifecycleProof: jest.fn<
      Promise<Record<string, unknown> | null>,
      unknown[]
    >(async () => null),
    viewWhatsappProviderHandoffRecoveryLifecycleProof: jest.fn<
      Promise<Record<string, unknown> | null>,
      unknown[]
    >(async () => null),
  };
  const server = {
    log: {
      error: jest.fn(),
      warn: jest.fn(),
    },
  };
  const sut = new WorkerLifecycleConsume(
    kafka as never,
    kafkaServiceQueueService as never,
    workerGrpcClientService as never,
    workerService as never,
    workerLifecycleQueueService as never,
    connectionLifecycleDebugService as never,
    workerRecreateServerSlotService as never,
    workerLifecycleLockService as never,
    workerRuntimeRepository as never
  );

  return {
    handlers,
    kafka,
    kafkaConsumer,
    kafkaServiceQueueService,
    server,
    sut,
    workerGrpcClientService,
    workerService,
    workerLifecycleQueueService,
    connectionLifecycleDebugService,
    workerRecreateServerSlotService,
    workerLifecycleLockService,
    workerRuntimeRepository,
  };
}

describe('WorkerLifecycleConsume', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps bounded concurrency while allowing independent workers to bypass a slow partition head', async () => {
    const deps = makeSut();

    await deps.sut.execute(deps.server as never);

    const runner = (deps.sut as any).runner;
    expect(runner.maxInFlightTotal).toBe(8);
    expect(runner.maxInFlightPerPartition).toBe(4);

    await deps.sut.close();
  });

  it('accepts only complete, valid liveness recreate fences while preserving legacy recreates', () => {
    const deps = makeSut();
    const parsePayload = (
      deps.sut as unknown as {
        parsePayload: (value: Buffer) => Record<string, unknown> | null;
      }
    ).parsePayload.bind(deps.sut);
    const legacyRecreate = lifecyclePayload({
      action: 'recreate',
      source: 'worker_recreate',
      worker_status_id: EWorkerStatus.recreating,
    });
    const validFence = {
      expected_container_id: 'A'.repeat(64),
      expected_container_started_at: '2026-07-29T22:00:00.000Z',
      expected_container_restart_count: 3,
      expected_container_health_status: 'unhealthy',
      expected_container_paused: false,
      expected_runtime_generation: 7,
    };
    const parse = (payload: Record<string, unknown>) =>
      parsePayload(Buffer.from(JSON.stringify(payload)));

    expect(parse(legacyRecreate)).toEqual(
      expect.objectContaining(legacyRecreate)
    );
    expect(parse({ ...legacyRecreate, ...validFence })).toEqual(
      expect.objectContaining(validFence)
    );
    expect(
      parse({
        ...legacyRecreate,
        ...validFence,
        expected_container_health_status: 'starting',
        expected_container_restart_count: 1,
      })
    ).toEqual(
      expect.objectContaining({
        expected_container_health_status: 'starting',
        expected_container_restart_count: 1,
      })
    );

    const invalidFences = [
      {
        ...legacyRecreate,
        expected_container_id: validFence.expected_container_id,
      },
      {
        ...legacyRecreate,
        ...validFence,
        expected_container_id: 'not-a-container-id',
      },
      {
        ...legacyRecreate,
        ...validFence,
        expected_container_started_at: 'not-a-date',
      },
      {
        ...legacyRecreate,
        ...validFence,
        expected_container_restart_count: -1,
      },
      {
        ...legacyRecreate,
        ...validFence,
        expected_container_health_status: 'healthy',
      },
      {
        ...legacyRecreate,
        ...validFence,
        expected_container_health_status: 'starting',
        expected_container_restart_count: 0,
      },
      {
        ...legacyRecreate,
        ...validFence,
        expected_container_paused: 'false',
      },
      {
        ...legacyRecreate,
        ...validFence,
        expected_runtime_generation: 0,
      },
      {
        ...legacyRecreate,
        ...validFence,
        source: 'config_recreate',
      },
      {
        ...legacyRecreate,
        previous_server_id: '   ',
      },
    ];

    for (const invalidFence of invalidFences) {
      expect(parse(invalidFence)).toBeNull();
    }
  });

  it('accepts only fully identified provider-preserving storage migrations', () => {
    const deps = makeSut();
    const parsePayload = (
      deps.sut as unknown as {
        parsePayload: (value: Buffer) => Record<string, unknown> | null;
      }
    ).parsePayload.bind(deps.sut);
    const parse = (payload: Record<string, unknown>) =>
      parsePayload(Buffer.from(JSON.stringify(payload)));
    const migration = lifecyclePayload({
      action: 'recreate',
      source: 'worker_update',
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: EWorkerType.wwebjs,
      previous_worker_type_id: EWorkerType.wwebjs,
      session_storage: EWorkerSessionStorage.postgres,
      previous_session_storage: EWorkerSessionStorage.legacy_volume,
      session_storage_migration_id: '019ff000-0000-7000-8000-000000000001',
      legacy_session_volume_name: 'under-session-worker-1',
      legacy_session_checksum: 'a'.repeat(64),
      remove_session: false,
      remove_volume: false,
    });

    expect(parse(migration)).toEqual(expect.objectContaining(migration));
    expect(
      parse({ ...migration, legacy_session_checksum: undefined })
    ).toBeNull();
    expect(
      parse({ ...migration, previous_worker_type_id: EWorkerType.baileys })
    ).toBeNull();
    expect(
      parse({ ...migration, previous_server_id: 'server-old' })
    ).toBeNull();
    expect(parse({ ...migration, remove_volume: true })).toBeNull();
  });

  it('accepts only an identity-only PostgreSQL finalization for a protected storage migration', () => {
    const deps = makeSut();
    const parsePayload = (
      deps.sut as unknown as {
        parsePayload: (value: Buffer) => Record<string, unknown> | null;
      }
    ).parsePayload.bind(deps.sut);
    const parse = (payload: Record<string, unknown>) =>
      parsePayload(Buffer.from(JSON.stringify(payload)));
    const finalization = lifecyclePayload({
      action: 'recreate',
      source: 'worker_update',
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: EWorkerType.wwebjs,
      previous_worker_type_id: EWorkerType.wwebjs,
      session_storage: EWorkerSessionStorage.postgres,
      session_storage_migration_id: '019ff000-0000-7000-8000-000000000001',
      remove_session: false,
      remove_volume: false,
    });

    expect(parse(finalization)).toEqual(expect.objectContaining(finalization));
    expect(
      parse({ ...finalization, session_storage_migration_id: 'invalid' })
    ).toBeNull();
    expect(
      parse({
        ...finalization,
        legacy_session_volume_name: 'under-session-worker-1',
      })
    ).toBeNull();
    expect(
      parse({ ...finalization, legacy_session_checksum: 'a'.repeat(64) })
    ).toBeNull();
    expect(
      parse({
        ...finalization,
        previous_session_storage: EWorkerSessionStorage.postgres,
      })
    ).toBeNull();
    expect(
      parse({
        ...finalization,
        previous_worker_type_id: EWorkerType.baileys,
      })
    ).toBeNull();
    expect(
      parse({ ...finalization, previous_server_id: 'server-old' })
    ).toBeNull();
    expect(parse({ ...finalization, remove_volume: true })).toBeNull();
  });

  it('coalesces only lifecycle redrives with an identical semantic effect', async () => {
    const deps = makeSut();
    await deps.sut.execute(deps.server as never);
    const resolveCoalesceKey = (deps.sut as any).runner.options
      .resolveCoalesceKey as (payload: Record<string, unknown>) => string;
    const original = lifecyclePayload({
      action: 'activate_warm',
      source: 'worker_update',
      session_storage: EWorkerSessionStorage.postgres,
      warm_pool_id: 'warm-1',
      remove_session: true,
      remove_volume: false,
      previous_server_id: 'server-old',
      previous_worker_type_id: EWorkerType.wwebjs,
      previous_worker_status_id: EWorkerStatus.online,
      recreate_server_slot_key: 'slot-1',
      recreate_server_slot_token: 'slot-token-1',
    });
    const redrive = {
      ...original,
      request_id: 'request-redrive',
      debug_trace_id: 'trace-redrive',
      requested_at: '2026-06-05T00:05:00.000Z',
    };

    expect(resolveCoalesceKey(redrive)).toBe(resolveCoalesceKey(original));

    const conflicts = [
      { operation_id: 'operation-2' },
      { action: 'recreate' },
      { worker_id: 'worker-2' },
      { account_id: 'account-2' },
      { server_id: 'server-2' },
      { worker_type_id: EWorkerType.whatsmeow },
      { worker_status_id: EWorkerStatus.recreating },
      { source: 'worker_create' },
      { session_storage: EWorkerSessionStorage.legacy_volume },
      { remove_session: false },
      { remove_volume: true },
      { warm_pool_id: 'warm-2' },
      { previous_server_id: 'server-old-2' },
      { previous_worker_type_id: EWorkerType.whatsmeow },
      { previous_worker_status_id: EWorkerStatus.offline },
      { recreate_server_slot_key: 'slot-2' },
      { recreate_server_slot_token: 'slot-token-2' },
      { recovery_without_journal: true },
    ];
    for (const conflict of conflicts) {
      expect(resolveCoalesceKey({ ...original, ...conflict })).not.toBe(
        resolveCoalesceKey(original)
      );
    }

    const withoutPreviousServer = lifecyclePayload();
    expect(
      resolveCoalesceKey({
        ...withoutPreviousServer,
        previous_server_id: null,
      })
    ).not.toBe(resolveCoalesceKey(withoutPreviousServer));
    await deps.sut.close();
  });

  it('dispatches valid create messages and commits after processing', async () => {
    const deps = makeSut();

    await deps.sut.execute(deps.server as never);
    deps.handlers.data({
      value: Buffer.from(JSON.stringify(lifecyclePayload())),
      partition: 2,
      offset: 7,
      consumerAssignmentEpoch: 101,
    });
    await waitForCommit(2, 7);
    await deps.sut.close();

    expect(
      deps.workerService.viewWorkerForMonitorConsistent
    ).toHaveBeenCalledWith('worker-1');
    expect(deps.workerService.viewWorkerForMonitor).not.toHaveBeenCalled();
    expect(deps.workerGrpcClientService.createWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        action: EWorkerAction.create,
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.creating,
        lifecycle_operation_id: 'operation-1',
      })
    );
    expect(commitOffset).toHaveBeenCalledWith(
      deps.kafkaConsumer,
      'worker.lifecycle.request',
      2,
      7
    );
  });

  it('dispatches lifecycle work only after consumer readiness', async () => {
    const deps = makeSut();
    let markConnected: (() => void) | undefined;
    (connectConsumer as jest.Mock).mockImplementationOnce(
      async (_consumer, _topic, onConnected) => {
        markConnected = onConnected;
      }
    );

    await deps.sut.execute(deps.server as never);
    deps.handlers.data({
      value: Buffer.from(JSON.stringify(lifecyclePayload())),
      partition: 2,
      offset: 7,
      consumerAssignmentEpoch: 101,
    });
    await flushPromises();

    expect(deps.workerGrpcClientService.createWorker).not.toHaveBeenCalled();
    expect(commitOffset).not.toHaveBeenCalled();

    markConnected?.();
    deps.handlers.data({
      value: Buffer.from(JSON.stringify(lifecyclePayload())),
      partition: 2,
      offset: 8,
      consumerAssignmentEpoch: 101,
    });
    await waitForCommit(2, 8);
    await deps.sut.close();

    expect(deps.kafka.getBroker).toHaveBeenCalled();
    expect(deps.workerGrpcClientService.createWorker).toHaveBeenCalledTimes(1);
    expect(commitOffset).toHaveBeenCalledWith(
      deps.kafkaConsumer,
      'worker.lifecycle.request',
      2,
      8
    );
  });

  it('dispatches a fenced permanent deletion through gRPC', async () => {
    const deps = makeSut();
    deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValueOnce(
      currentWorker({
        worker_status_id: EWorkerStatus.deleting,
      })
    );

    await deps.sut.execute(deps.server as never);
    deps.handlers.data({
      value: Buffer.from(
        JSON.stringify(
          lifecyclePayload({
            action: 'delete',
            source: 'plan_cancellation',
            worker_status_id: EWorkerStatus.deleting,
          })
        )
      ),
      partition: 2,
      offset: 9,
      consumerAssignmentEpoch: 101,
    });
    await waitForCommit(2, 9);
    await deps.sut.close();

    expect(deps.workerGrpcClientService.deleteWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        action: EWorkerAction.delete,
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.deleting,
        lifecycle_operation_id: 'operation-1',
      })
    );
    expect(commitOffset).toHaveBeenCalledWith(
      deps.kafkaConsumer,
      'worker.lifecycle.request',
      2,
      9
    );
  });

  it('redelivers permanent deletion after the worker became a tombstone', async () => {
    const deps = makeSut();
    deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValueOnce(
      currentWorker({
        worker_status_id: EWorkerStatus.deleting,
        deleted_at: '2026-07-27T22:00:00.000Z',
      })
    );

    await deps.sut.execute(deps.server as never);
    deps.handlers.data({
      value: Buffer.from(
        JSON.stringify(
          lifecyclePayload({
            action: 'delete',
            source: 'plan_cancellation',
            worker_status_id: EWorkerStatus.deleting,
          })
        )
      ),
      partition: 2,
      offset: 10,
      consumerAssignmentEpoch: 101,
    });
    await waitForCommit(2, 10);
    await deps.sut.close();

    expect(deps.workerGrpcClientService.deleteWorker).toHaveBeenCalledTimes(1);
    expect(commitOffset).toHaveBeenCalledWith(
      deps.kafkaConsumer,
      'worker.lifecycle.request',
      2,
      10
    );
  });

  it('serializes lifecycle effects for the same worker within a partition', async () => {
    const deps = makeSut();
    let currentOperationId = 'operation-1';
    deps.workerService.viewWorkerForMonitorConsistent.mockImplementation(
      async () => currentWorker({ lifecycle_operation_id: currentOperationId })
    );
    let releaseFirst: (() => void) | undefined;
    deps.workerGrpcClientService.createWorker
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            releaseFirst = resolve;
          })
      )
      .mockResolvedValueOnce(undefined);

    await deps.sut.execute(deps.server as never);
    deps.handlers.data({
      value: Buffer.from(JSON.stringify(lifecyclePayload())),
      key: Buffer.from('worker-1'),
      partition: 2,
      offset: 7,
      consumerAssignmentEpoch: 101,
    });
    deps.handlers.data({
      value: Buffer.from(
        JSON.stringify(
          lifecyclePayload({
            request_id: 'request-2',
            operation_id: 'operation-2',
          })
        )
      ),
      key: Buffer.from('worker-1'),
      partition: 2,
      offset: 8,
      consumerAssignmentEpoch: 101,
    });
    await waitForCondition(
      () => deps.workerGrpcClientService.createWorker.mock.calls.length === 1,
      'first serialized worker create dispatch'
    );

    expect(deps.workerGrpcClientService.createWorker).toHaveBeenCalledTimes(1);
    expect(
      deps.workerService.viewWorkerForMonitorConsistent
    ).toHaveBeenCalledTimes(2);

    currentOperationId = 'operation-2';
    releaseFirst?.();
    await waitForCommit(2, 8);
    await deps.sut.close();

    expect(deps.workerGrpcClientService.createWorker).toHaveBeenCalledTimes(2);
    expect(
      deps.workerService.viewWorkerForMonitorConsistent
    ).toHaveBeenCalledTimes(4);
  });

  it('uses the primary worker view so replica lag cannot discard a current lifecycle operation', async () => {
    const deps = makeSut();
    deps.workerService.viewWorkerForMonitor.mockResolvedValueOnce(
      currentWorker({ lifecycle_operation_id: null })
    );
    deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValueOnce(
      currentWorker({ lifecycle_operation_id: 'operation-1' })
    );

    await deps.sut.execute(deps.server as never);
    deps.handlers.data({
      value: Buffer.from(JSON.stringify(lifecyclePayload())),
      partition: 2,
      offset: 8,
      consumerAssignmentEpoch: 101,
    });
    await waitForCommit(2, 8);
    await deps.sut.close();

    expect(deps.workerService.viewWorkerForMonitor).not.toHaveBeenCalled();
    expect(
      deps.workerService.viewWorkerForMonitorConsistent
    ).toHaveBeenCalledWith('worker-1');
    expect(deps.workerGrpcClientService.createWorker).toHaveBeenCalledTimes(1);
    expect(commitOffset).toHaveBeenCalledWith(
      deps.kafkaConsumer,
      'worker.lifecycle.request',
      2,
      8
    );
  });

  it.each([null, 'operation-new'])(
    'commits stale lifecycle messages without dispatching runtime work when the database lifecycle is %s',
    async (currentLifecycleOperationId) => {
      const deps = makeSut();
      deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValueOnce(
        currentWorker({
          lifecycle_operation_id: currentLifecycleOperationId,
          worker_status_id:
            currentLifecycleOperationId === null
              ? EWorkerStatus.online
              : EWorkerStatus.creating,
        })
      );

      await deps.sut.execute(deps.server as never);
      deps.handlers.data({
        value: Buffer.from(JSON.stringify(lifecyclePayload())),
        partition: 1,
        offset: 3,
        consumerAssignmentEpoch: 101,
      });
      await waitForCommit(1, 3);
      await deps.sut.close();

      expect(deps.workerGrpcClientService.createWorker).not.toHaveBeenCalled();
      expect(
        deps.workerGrpcClientService.recreateWorker
      ).not.toHaveBeenCalled();
      expect(deps.workerGrpcClientService.deleteWorker).not.toHaveBeenCalled();
      expect(deps.workerGrpcClientService.cleanupWorker).not.toHaveBeenCalled();
      expect(
        deps.workerRecreateServerSlotService.releaseReservedSlot
      ).not.toHaveBeenCalled();
      expect(commitOffset).toHaveBeenCalledWith(
        deps.kafkaConsumer,
        'worker.lifecycle.request',
        1,
        3
      );
    }
  );

  it('keeps the active lifecycle fence when its event carries a stale server snapshot', async () => {
    const deps = makeSut();
    deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValueOnce(
      currentWorker({
        server_id: 'server-2',
        worker_status_id: EWorkerStatus.recreating,
        lifecycle_operation_id: 'operation-1',
      })
    );

    await deps.sut.execute(deps.server as never);
    deps.handlers.data({
      value: Buffer.from(
        JSON.stringify(
          lifecyclePayload({
            action: 'recreate',
            source: 'config_recreate',
            worker_status_id: EWorkerStatus.recreating,
          })
        )
      ),
      partition: 1,
      offset: 4,
      consumerAssignmentEpoch: 101,
    });
    await waitForCommit(1, 4);
    await deps.sut.close();

    expect(deps.workerGrpcClientService.recreateWorker).not.toHaveBeenCalled();
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
    expect(commitOffset).toHaveBeenCalledWith(
      deps.kafkaConsumer,
      'worker.lifecycle.request',
      1,
      4
    );
  });

  it('discards lifecycle work for a deleted worker without mutating it', async () => {
    const deps = makeSut();
    deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValueOnce(
      currentWorker({
        deleted_at: '2026-07-17T12:00:00.000Z',
        lifecycle_operation_id: 'operation-1',
      })
    );

    await deps.sut.execute(deps.server as never);
    deps.handlers.data({
      value: Buffer.from(JSON.stringify(lifecyclePayload())),
      partition: 1,
      offset: 5,
      consumerAssignmentEpoch: 101,
    });
    await waitForCommit(1, 5);
    await deps.sut.close();

    expect(deps.workerGrpcClientService.createWorker).not.toHaveBeenCalled();
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
    expect(commitOffset).toHaveBeenCalledWith(
      deps.kafkaConsumer,
      'worker.lifecycle.request',
      1,
      5
    );
  });

  it('releases a reserved recreate slot when the lifecycle message is stale', async () => {
    const deps = makeSut();
    deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValueOnce(
      currentWorker({ lifecycle_operation_id: 'operation-new' })
    );

    await deps.sut.execute(deps.server as never);
    deps.handlers.data({
      value: Buffer.from(
        JSON.stringify(
          lifecyclePayload({
            action: 'recreate',
            source: 'config_recreate',
            worker_status_id: EWorkerStatus.recreating,
            recreate_server_slot_key: 'worker:recreate:server:server-1:slot:0',
            recreate_server_slot_token: 'worker-1:slot-token',
            recovery_without_journal: true,
          })
        )
      ),
      partition: 1,
      offset: 3,
      consumerAssignmentEpoch: 101,
    });
    await waitForCommit(1, 3);
    await deps.sut.close();

    expect(
      deps.workerRecreateServerSlotService.releaseReservedSlot
    ).toHaveBeenCalledWith({
      serverId: 'server-1',
      key: 'worker:recreate:server:server-1:slot:0',
      token: 'worker-1:slot-token',
    });
  });

  it('passes reserved recreate server slots to gRPC recreate dispatch', async () => {
    const deps = makeSut();

    await deps.sut.execute(deps.server as never);
    deps.handlers.data({
      value: Buffer.from(
        JSON.stringify(
          lifecyclePayload({
            action: 'recreate',
            source: 'config_recreate',
            worker_status_id: EWorkerStatus.recreating,
            recreate_server_slot_key: 'worker:recreate:server:server-1:slot:0',
            recreate_server_slot_token: 'worker-1:slot-token',
            recovery_without_journal: true,
          })
        )
      ),
      partition: 1,
      offset: 5,
      consumerAssignmentEpoch: 101,
    });
    await waitForCommit(1, 5);
    await deps.sut.close();

    expect(deps.workerGrpcClientService.recreateWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        action: EWorkerAction.recreate,
        recreate_server_slot_key: 'worker:recreate:server:server-1:slot:0',
        recreate_server_slot_token: 'worker-1:slot-token',
        recovery_without_journal: true,
      })
    );
  });

  it('retries transient runtime failures internally and commits after success', async () => {
    jest.useFakeTimers();
    const deps = makeSut();
    deps.workerGrpcClientService.createWorker.mockRejectedValueOnce(
      new Error('grpc unavailable')
    );

    try {
      await deps.sut.execute(deps.server as never);
      deps.handlers.data({
        value: Buffer.from(JSON.stringify(lifecyclePayload())),
        partition: 1,
        offset: 4,
        consumerAssignmentEpoch: 101,
      });
      await flushPromises();
      await jest.advanceTimersByTimeAsync(1000);
      await flushPromises();
      await deps.sut.close();

      expect(deps.workerGrpcClientService.createWorker).toHaveBeenCalledTimes(
        2
      );
      expect(commitOffset).toHaveBeenCalledWith(
        deps.kafkaConsumer,
        'worker.lifecycle.request',
        1,
        4
      );
      expect(deps.server.log.error).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('commits an exhausted delivery even when leased slot cleanup is unavailable', async () => {
    jest.useFakeTimers();
    const deps = makeSut();
    deps.workerGrpcClientService.recreateWorker.mockRejectedValue(
      new Error('grpc unavailable')
    );
    deps.workerRecreateServerSlotService.releaseReservedSlot.mockRejectedValue(
      new Error('Redis unavailable during slot release')
    );

    try {
      await deps.sut.execute(deps.server as never);
      deps.handlers.data({
        value: Buffer.from(
          JSON.stringify(
            lifecyclePayload({
              action: 'recreate',
              source: 'config_recreate',
              worker_status_id: EWorkerStatus.recreating,
              recreate_server_slot_key:
                'worker:recreate:server:server-1:slot:0',
              recreate_server_slot_token: 'worker-1:slot-token',
            })
          )
        ),
        partition: 3,
        offset: 6,
        consumerAssignmentEpoch: 101,
      });
      await flushPromises();
      await jest.advanceTimersByTimeAsync(1000);
      await flushPromises();
      await jest.advanceTimersByTimeAsync(5000);
      await flushPromises(12);
      await deps.sut.close();

      expect(deps.workerGrpcClientService.recreateWorker).toHaveBeenCalledTimes(
        3
      );
      expect(
        deps.workerService.updateWorkerByIdIfLifecycleMatches
      ).not.toHaveBeenCalled();
      expect(
        deps.workerRecreateServerSlotService.releaseReservedSlot
      ).toHaveBeenCalledWith({
        serverId: 'server-1',
        key: 'worker:recreate:server:server-1:slot:0',
        token: 'worker-1:slot-token',
      });
      expect(commitOffset).toHaveBeenCalledWith(
        deps.kafkaConsumer,
        'worker.lifecycle.request',
        3,
        6
      );
      expect(deps.connectionLifecycleDebugService.log).toHaveBeenCalledWith(
        'service.lifecycle_queue.recreate_slot_release_deferred',
        expect.objectContaining({
          lifecycle_operation_id: 'operation-1',
        })
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('marks a failed PostgreSQL server-only migration as error after a terminal gRPC recreate failure', async () => {
    const deps = makeSut();
    const serverMigration = lifecyclePayload({
      action: 'recreate',
      source: 'worker_update',
      server_id: 'server-new',
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: EWorkerType.baileys,
      previous_worker_type_id: EWorkerType.baileys,
      previous_server_id: 'server-old',
      session_storage: EWorkerSessionStorage.postgres,
      remove_session: false,
      remove_volume: false,
      cleanup_previous_runtime_required: false,
    });
    deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValue(
      currentWorker({
        server_id: 'server-new',
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: EWorkerType.baileys,
        session_storage: EWorkerSessionStorage.postgres,
      })
    );
    deps.workerGrpcClientService.recreateWorker.mockRejectedValue(
      Object.assign(new Error('target server rejected recreate'), {
        code: GrpcStatus.FAILED_PRECONDITION,
      })
    );

    await deps.sut.execute(deps.server as never);
    deps.handlers.data({
      value: Buffer.from(JSON.stringify(serverMigration)),
      partition: 3,
      offset: 16,
      consumerAssignmentEpoch: 101,
    });
    await waitForCommit(3, 16);
    await deps.sut.close();

    expect(deps.workerGrpcClientService.recreateWorker).toHaveBeenCalledTimes(
      1
    );
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'account-1',
      {
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.error,
        lifecycle_operation_id: null,
      },
      {
        lifecycle_operation_id: 'operation-1',
        server_id: 'server-new',
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.recreating,
      }
    );
    expect(deps.connectionLifecycleDebugService.log).toHaveBeenCalledWith(
      'service.lifecycle_queue.terminal_server_migration_failure_marked_error',
      expect.objectContaining({
        worker_id: 'worker-1',
        lifecycle_operation_id: 'operation-1',
      })
    );
  });

  it('keeps terminal compensation limited to PostgreSQL server-only migrations', async () => {
    const deps = makeSut();
    const terminalize = (
      deps.sut as unknown as {
        terminalizePostgresServerMigrationFailure: (
          payload: IWorkerLifecycleQueueMessage,
          error: unknown,
          discardReason: 'terminal_error' | 'retry_exhausted',
          assertActive: () => void
        ) => Promise<boolean>;
      }
    ).terminalizePostgresServerMigrationFailure.bind(deps.sut);
    const migration = lifecyclePayload({
      action: 'recreate',
      source: 'worker_update',
      server_id: 'server-new',
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: EWorkerType.baileys,
      previous_worker_type_id: EWorkerType.baileys,
      previous_server_id: 'server-old',
      session_storage: EWorkerSessionStorage.postgres,
      remove_session: false,
      remove_volume: false,
      cleanup_previous_runtime_required: false,
    }) as unknown as IWorkerLifecycleQueueMessage;
    const terminalGrpcError = Object.assign(new Error('invalid target state'), {
      code: GrpcStatus.FAILED_PRECONDITION,
    });

    const excludedPayloads: Array<{
      payload: IWorkerLifecycleQueueMessage;
      discardReason: 'terminal_error' | 'retry_exhausted';
      error?: unknown;
    }> = [
      {
        payload: {
          ...migration,
          previous_worker_type_id: EWorkerType.wwebjs,
          cleanup_previous_runtime_required: true,
        },
        discardReason: 'terminal_error',
      },
      {
        payload: {
          ...migration,
          action: 'cleanup_previous_runtime',
          server_id: 'server-old',
          worker_type_id: EWorkerType.baileys,
        },
        discardReason: 'terminal_error',
      },
      {
        payload: {
          ...migration,
          action: 'delete',
          source: 'worker_delete',
          worker_status_id: EWorkerStatus.deleting,
        },
        discardReason: 'terminal_error',
      },
      {
        payload: {
          ...migration,
          source: 'worker_recreate',
          expected_container_id: 'a'.repeat(64),
        },
        discardReason: 'terminal_error',
      },
      {
        payload: migration,
        discardReason: 'retry_exhausted',
      },
      {
        payload: migration,
        discardReason: 'terminal_error',
        error: Object.assign(new Error('transport unavailable'), {
          code: GrpcStatus.UNAVAILABLE,
        }),
      },
    ];

    for (const excluded of excludedPayloads) {
      await expect(
        terminalize(
          excluded.payload,
          excluded.error ?? terminalGrpcError,
          excluded.discardReason,
          jest.fn()
        )
      ).resolves.toBe(false);
    }

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
  });

  it('keeps a failed liveness recreate lifecycle durable after the in-memory retry budget', async () => {
    jest.useFakeTimers();
    const deps = makeSut();
    deps.workerGrpcClientService.recreateWorker.mockRejectedValue(
      new Error('docker restart policy state is uncertain')
    );
    const livenessFence = {
      expected_container_id: 'a'.repeat(64),
      expected_container_started_at: '2026-07-29T22:00:00.000Z',
      expected_container_restart_count: 0,
      expected_container_health_status: 'unhealthy',
      expected_container_paused: false,
      expected_runtime_generation: 7,
    };
    const queuedPayload = lifecyclePayload({
      action: 'recreate',
      source: 'worker_recreate',
      worker_status_id: EWorkerStatus.recreating,
      recreate_server_slot_key: 'worker:recreate:server:server-1:slot:0',
      recreate_server_slot_token: 'worker-1:slot-token',
      ...livenessFence,
    });

    try {
      await deps.sut.execute(deps.server as never);
      deps.handlers.data({
        value: Buffer.from(JSON.stringify(queuedPayload)),
        partition: 3,
        offset: 12,
        consumerAssignmentEpoch: 101,
      });
      await flushPromises();
      await jest.advanceTimersByTimeAsync(1000);
      await flushPromises();
      await jest.advanceTimersByTimeAsync(5000);
      await flushPromises(12);

      expect(deps.workerGrpcClientService.recreateWorker).toHaveBeenCalledTimes(
        3
      );
      expect(
        deps.workerService.updateWorkerByIdIfLifecycleMatches
      ).not.toHaveBeenCalled();
      expect(
        deps.workerRecreateServerSlotService.releaseReservedSlot
      ).toHaveBeenCalledWith({
        serverId: 'server-1',
        key: 'worker:recreate:server:server-1:slot:0',
        token: 'worker-1:slot-token',
      });
      expect(deps.connectionLifecycleDebugService.log).toHaveBeenCalledWith(
        'service.lifecycle_queue.liveness_recreate_retry_pending',
        expect.objectContaining({
          worker_id: 'worker-1',
          lifecycle_operation_id: 'operation-1',
          container_id: livenessFence.expected_container_id,
          runtime_generation: 7,
        })
      );
      expect(commitOffset).toHaveBeenCalledWith(
        deps.kafkaConsumer,
        'worker.lifecycle.request',
        3,
        12
      );

      deps.workerGrpcClientService.recreateWorker.mockResolvedValue(undefined);
      deps.handlers.data({
        value: Buffer.from(
          JSON.stringify({
            ...queuedPayload,
            request_id: 'request-redrive',
            requested_at: '2026-07-29T22:05:00.000Z',
          })
        ),
        partition: 3,
        offset: 13,
        consumerAssignmentEpoch: 101,
      });
      await waitForCommit(3, 13);
      await deps.sut.close();

      expect(deps.workerGrpcClientService.recreateWorker).toHaveBeenCalledTimes(
        4
      );
      expect(commitOffset).toHaveBeenCalledWith(
        deps.kafkaConsumer,
        'worker.lifecycle.request',
        3,
        13
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('fast-redrives an authoritative liveness conflict without inline retries or clearing its journal', async () => {
    const deps = makeSut();
    deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValue(
      currentWorker({
        worker_status_id: EWorkerStatus.recreating,
      })
    );
    deps.workerGrpcClientService.recreateWorker.mockRejectedValue(
      new Error('worker_runtime_removal_database_fence_changed')
    );
    const queuedPayload = lifecyclePayload({
      action: 'recreate',
      source: 'worker_recreate',
      worker_status_id: EWorkerStatus.recreating,
      recreate_server_slot_key: 'worker:recreate:server:server-1:slot:0',
      recreate_server_slot_token: 'worker-1:slot-token',
      expected_container_id: 'a'.repeat(64),
      expected_container_started_at: '2026-07-29T22:00:00.000Z',
      expected_container_restart_count: 0,
      expected_container_health_status: 'unhealthy',
      expected_container_paused: false,
      expected_runtime_generation: 7,
    });

    await deps.sut.execute(deps.server as never);
    deps.handlers.data({
      value: Buffer.from(JSON.stringify(queuedPayload)),
      partition: 3,
      offset: 15,
      consumerAssignmentEpoch: 101,
    });
    await waitForCommit(3, 15);
    await deps.sut.close();

    expect(deps.workerGrpcClientService.recreateWorker).toHaveBeenCalledTimes(
      1
    );
    expect(deps.server.log.error).not.toHaveBeenCalled();
    expect(deps.server.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        workerId: 'worker-1',
        operationId: 'operation-1',
        attempt: 1,
      }),
      'Worker lifecycle authoritative conflict deferred to durable redrive'
    );
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
    expect(
      deps.workerLifecycleQueueService.loadAuthoritativePreparedPayload
    ).toHaveBeenCalledWith(expect.objectContaining(queuedPayload));
    expect(deps.connectionLifecycleDebugService.log).toHaveBeenCalledWith(
      'service.lifecycle_queue.liveness_recreate_retry_pending',
      expect.objectContaining({
        worker_id: 'worker-1',
        lifecycle_operation_id: 'operation-1',
      })
    );
    expect(commitOffset).toHaveBeenCalledWith(
      deps.kafkaConsumer,
      'worker.lifecycle.request',
      3,
      15
    );
  });

  it('attempts terminal recovery of an owned replacement before preserving a discarded liveness delivery', async () => {
    jest.useFakeTimers();
    const deps = makeSut();
    const oldContainerId = 'a'.repeat(64);
    const replacementContainerId = 'b'.repeat(64);
    deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValue({
      ...currentWorker({
        worker_status_id: EWorkerStatus.recreating,
      }),
      container_id: oldContainerId,
      runtime_container_id: replacementContainerId,
      runtime_generation: 8,
    } as never);
    deps.workerGrpcClientService.recreateWorker
      .mockRejectedValueOnce(new Error('balance response lost'))
      .mockRejectedValueOnce(new Error('balance response lost'))
      .mockRejectedValueOnce(new Error('balance response lost'))
      .mockResolvedValueOnce(undefined);
    const queuedPayload = lifecyclePayload({
      action: 'recreate',
      source: 'worker_recreate',
      worker_status_id: EWorkerStatus.recreating,
      expected_container_id: oldContainerId,
      expected_container_started_at: '2026-07-29T22:00:00.000Z',
      expected_container_restart_count: 0,
      expected_container_health_status: 'unhealthy',
      expected_container_paused: false,
      expected_runtime_generation: 7,
    });

    try {
      await deps.sut.execute(deps.server as never);
      deps.handlers.data({
        value: Buffer.from(JSON.stringify(queuedPayload)),
        partition: 3,
        offset: 14,
        consumerAssignmentEpoch: 101,
      });
      await flushPromises();
      await jest.advanceTimersByTimeAsync(1000);
      await flushPromises();
      await jest.advanceTimersByTimeAsync(5000);
      await waitForCommit(3, 14);
      await deps.sut.close();

      expect(deps.workerGrpcClientService.recreateWorker).toHaveBeenCalledTimes(
        4
      );
      expect(deps.connectionLifecycleDebugService.log).not.toHaveBeenCalledWith(
        'service.lifecycle_queue.liveness_recreate_retry_pending',
        expect.anything()
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('preserves deleting and commits after bounded gRPC retries', async () => {
    jest.useFakeTimers();
    const deps = makeSut();
    deps.workerGrpcClientService.deleteWorker.mockRejectedValue(
      new Error('grpc unavailable')
    );
    deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValue(
      currentWorker({
        worker_status_id: EWorkerStatus.deleting,
      })
    );

    try {
      await deps.sut.execute(deps.server as never);
      deps.handlers.data({
        value: Buffer.from(
          JSON.stringify(
            lifecyclePayload({
              action: 'delete',
              source: 'plan_cancellation',
              worker_status_id: EWorkerStatus.deleting,
            })
          )
        ),
        partition: 3,
        offset: 11,
        consumerAssignmentEpoch: 101,
      });
      await flushPromises();
      await jest.advanceTimersByTimeAsync(1000);
      await flushPromises();
      await jest.advanceTimersByTimeAsync(5000);
      await flushPromises(12);

      expect(deps.workerGrpcClientService.deleteWorker).toHaveBeenCalledTimes(
        3
      );
      expect(
        deps.workerService.updateWorkerByIdIfLifecycleMatches
      ).not.toHaveBeenCalled();
      expect(commitOffset).toHaveBeenCalledWith(
        deps.kafkaConsumer,
        'worker.lifecycle.request',
        3,
        11
      );

      const closing = deps.sut.close();
      await jest.runOnlyPendingTimersAsync();
      await closing;
    } finally {
      jest.useRealTimers();
    }
  });

  it('reconciles a strictly healthy replacement runtime instead of marking the terminal lifecycle as error', async () => {
    const deps = makeSut();
    deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValue(
      currentWorker({
        worker_status_id: EWorkerStatus.recreating,
        container_id: 'container-generation-3',
        runtime_container_id: 'container-generation-4',
        runtime_generation: 4,
      })
    );
    deps.workerRuntimeRepository.viewByWorkerIdConsistent.mockResolvedValue({
      worker_id: 'worker-1',
      container_id: 'container-generation-4',
      container_name: 'worker-1',
      session_volume_name: 'worker-volume-1',
      runtime_generation: 4,
      connection_epoch: 'connection-epoch-4',
      connection_sequence: 12,
      source_provider: 'baileys',
    });
    deps.workerGrpcClientService.runtimeHealth.mockResolvedValue(
      strictHealthyRuntimeHealth({
        runtime_generation: '4',
        provider_state: 'open',
      })
    );

    await expect(
      (deps.sut as any).reconcileHealthyTerminalRuntime(
        lifecyclePayload({
          action: 'recreate',
          source: 'config_recreate',
          worker_status_id: EWorkerStatus.recreating,
        }),
        EWorkerStatus.recreating,
        jest.fn()
      )
    ).resolves.toBe('reconciled');

    expect(deps.workerGrpcClientService.runtimeHealth).toHaveBeenCalledWith(
      'server-1',
      { worker_id: 'worker-1' }
    );
    expect(
      deps.workerRuntimeRepository.reconcileHealthyRuntimeLifecycle
    ).toHaveBeenCalledWith({
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      lifecycle_operation_id: 'operation-1',
      expected_worker_status_id: EWorkerStatus.recreating,
      lifecycle_action: 'recreate',
      container_id: 'container-generation-4',
      runtime_generation: 4,
      phone: '5561999999999',
    });
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
  });

  it('keeps healthy create reconciliation on the non-recreate completion path', async () => {
    const deps = makeSut();
    deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValue(
      currentWorker({
        worker_status_id: EWorkerStatus.creating,
        container_id: 'container-generation-0',
        runtime_container_id: 'container-generation-1',
        runtime_generation: 1,
      })
    );
    deps.workerRuntimeRepository.viewByWorkerIdConsistent.mockResolvedValue({
      worker_id: 'worker-1',
      container_id: 'container-generation-1',
      container_name: 'worker-1',
      session_volume_name: 'worker-volume-1',
      runtime_generation: 1,
      connection_epoch: 'connection-epoch-1',
      connection_sequence: 1,
      source_provider: 'baileys',
    });
    deps.workerGrpcClientService.runtimeHealth.mockResolvedValue(
      strictHealthyRuntimeHealth({ runtime_generation: 1 })
    );

    await expect(
      (deps.sut as any).reconcileHealthyTerminalRuntime(
        lifecyclePayload({
          action: 'create',
          source: 'worker_create',
          worker_status_id: EWorkerStatus.creating,
        }),
        EWorkerStatus.creating,
        jest.fn()
      )
    ).resolves.toBe('reconciled');

    expect(
      deps.workerRuntimeRepository.reconcileHealthyRuntimeLifecycle
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        lifecycle_action: 'create',
        lifecycle_operation_id: 'operation-1',
        runtime_generation: 1,
      })
    );
  });

  it('continues an explicitly requested recreate when the old runtime health probe is unavailable', async () => {
    const deps = makeSut();
    deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValue(
      currentWorker({
        worker_status_id: EWorkerStatus.online,
        container_id: 'container-generation-4',
        runtime_container_id: 'container-generation-4',
        runtime_generation: 4,
      })
    );
    jest
      .spyOn(deps.sut as any, 'reconcileHealthyTerminalRuntime')
      .mockResolvedValue('probe_unavailable');

    await expect(
      (deps.sut as any).finalizeAlreadyOnlineLifecycle(
        lifecyclePayload({
          action: 'recreate',
          source: 'config_recreate',
          worker_status_id: EWorkerStatus.recreating,
        }),
        jest.fn()
      )
    ).resolves.toBe(false);

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'account-1',
      {
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.recreating,
      },
      {
        lifecycle_operation_id: 'operation-1',
        container_id: 'container-generation-4',
        runtime_container_id: 'container-generation-4',
        runtime_generation: 4,
        allow_disconnected_runtime: true,
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.online,
      }
    );

    await expect(
      (deps.sut as any).finalizeAlreadyOnlineLifecycle(
        lifecyclePayload({ action: 'create' }),
        jest.fn()
      )
    ).rejects.toThrow('Online lifecycle readiness probe is unavailable');
  });

  it('suppresses an online recreate when its status rearm loses the lifecycle fence', async () => {
    const deps = makeSut();
    deps.workerService.viewWorkerForMonitorConsistent
      .mockResolvedValueOnce(
        currentWorker({
          worker_status_id: EWorkerStatus.online,
          container_id: 'container-generation-4',
          runtime_container_id: 'container-generation-4',
          runtime_generation: 4,
        })
      )
      .mockResolvedValueOnce(currentWorker({ lifecycle_operation_id: null }));
    deps.workerService.updateWorkerByIdIfLifecycleMatches.mockResolvedValueOnce(
      false
    );
    jest
      .spyOn(deps.sut as any, 'reconcileHealthyTerminalRuntime')
      .mockResolvedValue('not_ready');

    await expect(
      (deps.sut as any).finalizeAlreadyOnlineLifecycle(
        lifecyclePayload({
          action: 'recreate',
          source: 'config_recreate',
          worker_status_id: EWorkerStatus.recreating,
        }),
        jest.fn()
      )
    ).resolves.toBe(true);

    expect(deps.workerGrpcClientService.recreateWorker).not.toHaveBeenCalled();
  });

  it.each([
    {
      caseName: 'pre-v3 health response',
      health: strictHealthyRuntimeHealth({
        runtime_health_schema_version: 2,
      }),
    },
    {
      caseName: 'missing native source identity',
      health: strictHealthyRuntimeHealth({
        connection_status_source_id: '',
      }),
    },
    {
      caseName: 'native provider mismatch',
      health: strictHealthyRuntimeHealth({
        connection_status: {
          provider: 'wwebjs',
          status: 'online',
          connected: true,
          authenticated: true,
          sessionValid: true,
          recoverable: true,
          qrAvailable: false,
          sequence: 9,
          changedAt: '2026-08-04T12:00:00.000Z',
        },
      }),
    },
    {
      caseName: 'native connection is offline',
      health: strictHealthyRuntimeHealth({
        connection_status: {
          provider: 'baileys',
          status: 'offline',
          connected: false,
          authenticated: true,
          sessionValid: true,
          recoverable: true,
          qrAvailable: false,
          sequence: 10,
          changedAt: '2026-08-04T12:00:01.000Z',
        },
      }),
    },
    {
      caseName: 'Kafka dispatch is not authorized',
      health: strictHealthyRuntimeHealth({
        kafka_consumers_authorized: false,
      }),
    },
  ])('fails closed for $caseName', ({ health }) => {
    const deps = makeSut();

    expect(
      (
        deps.sut as unknown as {
          isStrictHealthyTerminalRuntime: (
            payload: IWorkerLifecycleQueueMessage,
            expectedRuntimeGeneration: number,
            runtimeHealth: Record<string, unknown>
          ) => boolean;
        }
      ).isStrictHealthyTerminalRuntime(
        lifecyclePayload() as unknown as IWorkerLifecycleQueueMessage,
        4,
        health
      )
    ).toBe(false);
  });

  it('defers terminal reconciliation while the original lifecycle lock is active and resumes after release', async () => {
    const deps = makeSut();
    const payload = lifecyclePayload({
      action: 'recreate',
      source: 'config_recreate',
      worker_status_id: EWorkerStatus.recreating,
      redrive_claim_token: 'operation-1:019fe267-40c7-767d-a866-7c83bcfd0350',
    }) as unknown as IWorkerLifecycleQueueMessage;
    deps.workerLifecycleLockService.isLocked
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValue(
      currentWorker({
        worker_status_id: EWorkerStatus.online,
        container_id: 'container-generation-3',
        runtime_container_id: 'container-generation-4',
        runtime_generation: 4,
      })
    );
    deps.workerRuntimeRepository.viewByWorkerIdConsistent.mockResolvedValue({
      worker_id: 'worker-1',
      container_id: 'container-generation-4',
      container_name: 'worker-1',
      session_volume_name: 'worker-volume-1',
      runtime_generation: 4,
      connection_epoch: 'connection-epoch-4',
      connection_sequence: 12,
      source_provider: 'baileys',
    });
    deps.workerGrpcClientService.runtimeHealth.mockResolvedValue(
      strictHealthyRuntimeHealth()
    );

    await expect(
      (deps.sut as any).processPayload(payload, jest.fn())
    ).rejects.toThrow('Worker lifecycle operation remains active');
    expect(
      deps.workerRuntimeRepository.reconcileHealthyRuntimeLifecycle
    ).not.toHaveBeenCalled();
    expect(deps.workerGrpcClientService.recreateWorker).not.toHaveBeenCalled();
    expect(
      deps.workerLifecycleLockService.releaseRedriveClaim
    ).toHaveBeenCalledWith(
      'worker-1',
      'operation-1',
      'operation-1:019fe267-40c7-767d-a866-7c83bcfd0350'
    );

    await expect(
      (deps.sut as any).processPayload(payload, jest.fn())
    ).resolves.toBeUndefined();
    expect(
      deps.workerRuntimeRepository.reconcileHealthyRuntimeLifecycle
    ).toHaveBeenCalledTimes(1);
    expect(
      deps.workerRuntimeRepository.reconcileHealthyRuntimeLifecycle
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_id: 'worker-1',
        lifecycle_operation_id: 'operation-1',
        container_id: 'container-generation-4',
        runtime_generation: 4,
      })
    );
    expect(deps.workerGrpcClientService.recreateWorker).not.toHaveBeenCalled();
  });

  it('fails closed when the lifecycle lock cannot be inspected', async () => {
    const deps = makeSut();
    const payload = lifecyclePayload({
      action: 'recreate',
      source: 'config_recreate',
      worker_status_id: EWorkerStatus.recreating,
    }) as unknown as IWorkerLifecycleQueueMessage;
    deps.workerLifecycleLockService.isLocked.mockRejectedValueOnce(
      new Error('redis unavailable')
    );

    await expect(
      (deps.sut as any).processPayload(payload, jest.fn())
    ).rejects.toThrow('Worker lifecycle operation remains active');
    expect(
      deps.workerRuntimeRepository.reconcileHealthyRuntimeLifecycle
    ).not.toHaveBeenCalled();
    expect(deps.workerGrpcClientService.recreateWorker).not.toHaveBeenCalled();
  });

  it('does not promote a healthy response from a stale runtime generation', async () => {
    const deps = makeSut();
    deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValue(
      currentWorker({
        worker_status_id: EWorkerStatus.recreating,
        container_id: 'container-generation-3',
        runtime_container_id: 'container-generation-4',
        runtime_generation: 4,
      })
    );
    deps.workerRuntimeRepository.viewByWorkerIdConsistent.mockResolvedValue({
      worker_id: 'worker-1',
      container_id: 'container-generation-4',
      session_volume_name: 'worker-volume-1',
      runtime_generation: 4,
      connection_epoch: 'connection-epoch-4',
      connection_sequence: 12,
    });
    deps.workerGrpcClientService.runtimeHealth.mockResolvedValue(
      strictHealthyRuntimeHealth({ runtime_generation: 3 })
    );

    await expect(
      (deps.sut as any).reconcileHealthyTerminalRuntime(
        lifecyclePayload({
          action: 'recreate',
          source: 'config_recreate',
          worker_status_id: EWorkerStatus.recreating,
        }),
        EWorkerStatus.recreating,
        jest.fn()
      )
    ).resolves.toBe('not_ready');

    expect(
      deps.workerRuntimeRepository.reconcileHealthyRuntimeLifecycle
    ).not.toHaveBeenCalled();
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
  });

  it('re-reads lifecycle state without writing error when the healthy-runtime CAS loses its fence', async () => {
    const deps = makeSut();
    deps.workerRuntimeRepository.viewByWorkerIdConsistent.mockResolvedValue({
      worker_id: 'worker-1',
      container_id: 'container-generation-4',
      session_volume_name: 'worker-volume-1',
      runtime_generation: 4,
      connection_epoch: 'connection-epoch-4',
      connection_sequence: 12,
    });
    deps.workerGrpcClientService.runtimeHealth.mockResolvedValue(
      strictHealthyRuntimeHealth()
    );
    deps.workerRuntimeRepository.reconcileHealthyRuntimeLifecycle.mockResolvedValue(
      false
    );
    deps.workerService.viewWorkerForMonitorConsistent
      .mockResolvedValueOnce(
        currentWorker({
          worker_status_id: EWorkerStatus.recreating,
          container_id: 'container-generation-3',
          runtime_container_id: 'container-generation-4',
          runtime_generation: 4,
        })
      )
      .mockResolvedValue(
        currentWorker({ lifecycle_operation_id: 'operation-new' })
      );

    await expect(
      (deps.sut as any).reconcileHealthyTerminalRuntime(
        lifecyclePayload({
          action: 'recreate',
          source: 'config_recreate',
          worker_status_id: EWorkerStatus.recreating,
        }),
        EWorkerStatus.recreating,
        jest.fn()
      )
    ).resolves.toBe('fence_changed');

    expect(
      deps.workerRuntimeRepository.reconcileHealthyRuntimeLifecycle
    ).toHaveBeenCalledTimes(1);
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
    expect(
      deps.workerService.viewWorkerForMonitorConsistent
    ).toHaveBeenCalledWith('worker-1');
  });

  it('continues recreation when a healthy old runtime is online under the current lifecycle fence', async () => {
    const deps = makeSut();
    const unchangedCurrent = currentWorker({
      worker_status_id: EWorkerStatus.online,
      container_id: 'container-generation-4',
      runtime_container_id: 'container-generation-4',
      runtime_generation: 4,
    });
    deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValue(
      unchangedCurrent
    );
    deps.workerRuntimeRepository.viewByWorkerIdConsistent.mockResolvedValue({
      worker_id: 'worker-1',
      container_id: 'container-generation-4',
      session_volume_name: 'worker-volume-1',
      runtime_generation: 4,
      connection_epoch: 'connection-epoch-4',
      connection_sequence: 12,
      recreate_bootstrap_operation_id: 'operation-older',
      recreate_bootstrap_runtime_generation: 4,
      recreate_bootstrap_container_id: 'container-generation-4',
      recreate_bootstrap_started_at: '2026-08-15T17:08:11.000Z',
    });
    deps.workerGrpcClientService.runtimeHealth.mockResolvedValue(
      strictHealthyRuntimeHealth()
    );
    deps.workerRuntimeRepository.reconcileHealthyRuntimeLifecycle.mockResolvedValue(
      false
    );

    await expect(
      (deps.sut as any).reconcileHealthyTerminalRuntime(
        lifecyclePayload({
          action: 'recreate',
          source: 'config_recreate',
          worker_status_id: EWorkerStatus.recreating,
        }),
        EWorkerStatus.online,
        jest.fn()
      )
    ).resolves.toBe('not_ready');

    expect(
      deps.workerRuntimeRepository.reconcileHealthyRuntimeLifecycle
    ).toHaveBeenCalledTimes(1);
    expect(
      deps.workerService.viewWorkerForMonitorConsistent
    ).toHaveBeenCalledTimes(2);
  });

  it('does not complete a recreate from the healthy pre-existing runtime', async () => {
    const deps = makeSut();
    deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValue(
      currentWorker({
        worker_status_id: EWorkerStatus.recreating,
        container_id: 'container-generation-3',
        runtime_container_id: 'container-generation-3',
        runtime_generation: 3,
      })
    );
    deps.workerRuntimeRepository.viewByWorkerIdConsistent.mockResolvedValue({
      worker_id: 'worker-1',
      container_id: 'container-generation-3',
      container_name: 'worker-1',
      session_volume_name: 'worker-volume-1',
      runtime_generation: 3,
      connection_epoch: 'connection-epoch-3',
      connection_sequence: 8,
    });
    deps.workerGrpcClientService.runtimeHealth.mockResolvedValue(
      strictHealthyRuntimeHealth({ runtime_generation: 3 })
    );

    await expect(
      (deps.sut as any).reconcileHealthyTerminalRuntime(
        lifecyclePayload({
          action: 'recreate',
          source: 'config_recreate',
          worker_status_id: EWorkerStatus.recreating,
        }),
        EWorkerStatus.recreating,
        jest.fn()
      )
    ).resolves.toBe('not_ready');

    expect(deps.workerGrpcClientService.runtimeHealth).not.toHaveBeenCalled();
    expect(
      deps.workerRuntimeRepository.reconcileHealthyRuntimeLifecycle
    ).not.toHaveBeenCalled();
  });

  it('does not compensate or release the slot when a duplicate redrive times out behind the active lifecycle', async () => {
    jest.useFakeTimers();
    const deps = makeSut();
    deps.workerGrpcClientService.recreateWorker.mockRejectedValue(
      new Error('Worker lifecycle lock timeout for worker worker-1')
    );
    deps.workerLifecycleLockService.isLocked.mockResolvedValue(true);

    try {
      await deps.sut.execute(deps.server as never);
      deps.handlers.data({
        value: Buffer.from(
          JSON.stringify(
            lifecyclePayload({
              action: 'recreate',
              source: 'config_recreate',
              worker_status_id: EWorkerStatus.recreating,
              recreate_server_slot_key:
                'worker:recreate:server:server-1:slot:0',
              recreate_server_slot_token: 'worker-1:slot-token',
              redrive_claim_token:
                'operation-1:019fe267-40c7-767d-a866-7c83bcfd0350',
            })
          )
        ),
        partition: 3,
        offset: 10,
        consumerAssignmentEpoch: 101,
      });
      await flushPromises();
      await jest.advanceTimersByTimeAsync(1000);
      await flushPromises();
      await jest.advanceTimersByTimeAsync(5000);
      await flushPromises(12);
      await deps.sut.close();

      expect(
        deps.workerGrpcClientService.recreateWorker
      ).not.toHaveBeenCalled();
      expect(deps.workerLifecycleLockService.isLocked).toHaveBeenCalledWith(
        'worker-1'
      );
      expect(
        deps.workerLifecycleLockService.releaseRedriveClaim
      ).toHaveBeenCalledWith(
        'worker-1',
        'operation-1',
        'operation-1:019fe267-40c7-767d-a866-7c83bcfd0350'
      );
      expect(
        deps.workerService.updateWorkerByIdIfLifecycleMatches
      ).not.toHaveBeenCalled();
      expect(
        deps.workerRecreateServerSlotService.releaseReservedSlot
      ).not.toHaveBeenCalled();
      expect(deps.server.log.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          workerId: 'worker-1',
          operationId: 'operation-1',
        }),
        expect.stringContaining('duplicate lifecycle redrive')
      );
      expect(commitOffset).toHaveBeenCalledWith(
        deps.kafkaConsumer,
        'worker.lifecycle.request',
        3,
        10
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not overwrite a newer lifecycle operation while compensating a discarded event', async () => {
    jest.useFakeTimers();
    const deps = makeSut();
    deps.workerGrpcClientService.recreateWorker.mockRejectedValue(
      new Error('grpc unavailable')
    );
    deps.workerService.updateWorkerByIdIfLifecycleMatches.mockResolvedValue(
      false
    );
    let primaryReads = 0;
    deps.workerService.viewWorkerForMonitorConsistent.mockImplementation(
      async () => {
        primaryReads += 1;
        return currentWorker({
          worker_status_id: EWorkerStatus.recreating,
          lifecycle_operation_id:
            primaryReads <= 3 ? 'operation-1' : 'operation-new',
        });
      }
    );

    try {
      await deps.sut.execute(deps.server as never);
      deps.handlers.data({
        value: Buffer.from(
          JSON.stringify(
            lifecyclePayload({
              action: 'recreate',
              source: 'config_recreate',
              worker_status_id: EWorkerStatus.recreating,
              recreate_server_slot_key:
                'worker:recreate:server:server-1:slot:0',
              recreate_server_slot_token: 'worker-1:slot-token',
            })
          )
        ),
        partition: 3,
        offset: 7,
        consumerAssignmentEpoch: 101,
      });
      await flushPromises();
      await jest.advanceTimersByTimeAsync(1000);
      await flushPromises();
      await jest.advanceTimersByTimeAsync(5000);
      await flushPromises(12);
      await deps.sut.close();

      expect(
        deps.workerService.updateWorkerByIdIfLifecycleMatches
      ).not.toHaveBeenCalled();
      expect(
        deps.workerRecreateServerSlotService.releaseReservedSlot
      ).toHaveBeenCalledTimes(1);
      expect(commitOffset).toHaveBeenCalledWith(
        deps.kafkaConsumer,
        'worker.lifecycle.request',
        3,
        7
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('preserves the terminal lifecycle fence when online readiness is not proven', async () => {
    jest.useFakeTimers();
    const deps = makeSut();
    deps.workerGrpcClientService.recreateWorker.mockRejectedValue(
      new Error('grpc response was lost')
    );
    deps.workerService.updateWorkerByIdIfLifecycleMatches
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    let primaryReads = 0;
    deps.workerService.viewWorkerForMonitorConsistent.mockImplementation(
      async () => {
        primaryReads += 1;
        return currentWorker({
          worker_status_id:
            primaryReads <= 3 ? EWorkerStatus.recreating : EWorkerStatus.online,
        });
      }
    );

    try {
      await deps.sut.execute(deps.server as never);
      deps.handlers.data({
        value: Buffer.from(
          JSON.stringify(
            lifecyclePayload({
              action: 'recreate',
              source: 'config_recreate',
              worker_status_id: EWorkerStatus.recreating,
            })
          )
        ),
        partition: 3,
        offset: 8,
        consumerAssignmentEpoch: 101,
      });
      await flushPromises();
      await jest.advanceTimersByTimeAsync(1000);
      await flushPromises();
      await jest.advanceTimersByTimeAsync(5000);
      await flushPromises(12);
      await deps.sut.close();

      expect(
        deps.workerService.updateWorkerByIdIfLifecycleMatches
      ).not.toHaveBeenCalled();
      expect(commitOffset).toHaveBeenCalledWith(
        deps.kafkaConsumer,
        'worker.lifecycle.request',
        3,
        8
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps standalone cleanup finalization retryable on a transient database failure', async () => {
    const deps = makeSut();
    deps.workerService.updateWorkerByIdIfLifecycleMatches.mockRejectedValueOnce(
      new Error('database temporarily unavailable')
    );

    await expect(
      (deps.sut as any).finalizeStandaloneCleanup(
        lifecyclePayload({
          action: 'cleanup_previous_runtime',
          source: 'plan_limit_enforcement',
          worker_status_id: EWorkerStatus.blocked,
        }),
        jest.fn()
      )
    ).rejects.toThrow('database temporarily unavailable');
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledTimes(1);
  });

  it('preserves a stopped cleanup fence while the old runtime is unavailable', async () => {
    jest.useFakeTimers();
    const deps = makeSut();
    deps.workerGrpcClientService.cleanupWorker.mockRejectedValue(
      new Error('cleanup unavailable')
    );

    try {
      await deps.sut.execute(deps.server as never);
      deps.handlers.data({
        value: Buffer.from(
          JSON.stringify(
            lifecyclePayload({
              action: 'cleanup_previous_runtime',
              source: 'plan_limit_enforcement',
              worker_status_id: EWorkerStatus.blocked,
            })
          )
        ),
        partition: 3,
        offset: 9,
        consumerAssignmentEpoch: 101,
      });
      await flushPromises();
      await jest.advanceTimersByTimeAsync(1000);
      await flushPromises();
      await jest.advanceTimersByTimeAsync(5000);
      await flushPromises(12);
      await deps.sut.close();

      expect(
        deps.workerService.updateWorkerByIdIfLifecycleMatches
      ).not.toHaveBeenCalled();
      expect(commitOffset).toHaveBeenCalledWith(
        deps.kafkaConsumer,
        'worker.lifecycle.request',
        3,
        9
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('blocks a worker-update primary until its exact prepared cleanup succeeds', async () => {
    const deps = makeSut();
    const primary = lifecyclePayload({
      action: 'recreate',
      source: 'worker_update',
      server_id: 'server-new',
      worker_status_id: EWorkerStatus.recreating,
      previous_server_id: 'server-old',
      previous_worker_type_id: EWorkerType.wwebjs,
      cleanup_previous_runtime_required: true,
      remove_session: true,
      remove_volume: true,
    }) as unknown as IWorkerLifecycleQueueMessage;
    const cleanup: IWorkerLifecycleQueueMessage = {
      ...primary,
      request_id: 'request-cleanup',
      action: 'cleanup_previous_runtime',
      server_id: 'server-old',
      worker_type_id: EWorkerType.wwebjs,
    };
    deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValue(
      currentWorker({
        server_id: 'server-new',
        worker_status_id: EWorkerStatus.recreating,
      })
    );
    deps.workerLifecycleQueueService.loadPrepared.mockResolvedValue([
      cleanup,
      primary,
    ]);
    deps.workerGrpcClientService.cleanupWorker.mockRejectedValueOnce(
      new Error('old server unavailable')
    );

    await expect(
      (deps.sut as any).processPayload(primary, jest.fn())
    ).rejects.toThrow('old server unavailable');
    expect(deps.workerGrpcClientService.recreateWorker).not.toHaveBeenCalled();

    deps.workerGrpcClientService.cleanupWorker.mockResolvedValue(undefined);
    await expect(
      (deps.sut as any).processPayload(primary, jest.fn())
    ).resolves.toBeUndefined();
    expect(deps.workerGrpcClientService.cleanupWorker).toHaveBeenCalledTimes(2);
    expect(deps.workerGrpcClientService.recreateWorker).toHaveBeenCalledTimes(
      1
    );
  });

  it('retires the previous provider before dispatching a cold destructive PostgreSQL reset', async () => {
    const deps = makeSut();
    const primary = lifecyclePayload({
      action: 'recreate',
      source: 'worker_update',
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: EWorkerType.baileys,
      previous_worker_type_id: EWorkerType.whatsmeow,
      previous_server_id: 'server-1',
      session_storage: EWorkerSessionStorage.postgres,
      cleanup_previous_runtime_required: true,
      remove_session: true,
      remove_volume: false,
    }) as unknown as IWorkerLifecycleQueueMessage;
    const cleanup: IWorkerLifecycleQueueMessage = {
      ...primary,
      request_id: 'request-fresh-provider-reset-cleanup',
      action: 'cleanup_previous_runtime',
      worker_type_id: EWorkerType.whatsmeow,
      previous_worker_type_id: EWorkerType.whatsmeow,
      cleanup_previous_runtime_required: undefined,
      remove_session: false,
    };
    deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValue(
      currentWorker({
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: EWorkerType.baileys,
        session_storage: EWorkerSessionStorage.postgres,
      })
    );
    deps.workerLifecycleQueueService.loadPrepared.mockResolvedValue([
      cleanup,
      primary,
    ]);

    await expect(
      (deps.sut as any).processPayload(primary, jest.fn())
    ).resolves.toBeUndefined();

    expect(deps.workerGrpcClientService.cleanupWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        action: EWorkerAction.cleanup,
        worker_type_id: EWorkerType.whatsmeow,
        previous_worker_type_id: EWorkerType.whatsmeow,
        session_storage: EWorkerSessionStorage.postgres,
        remove_session: false,
        remove_volume: false,
      })
    );
    expect(deps.workerGrpcClientService.recreateWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        action: EWorkerAction.recreate,
        worker_type_id: EWorkerType.baileys,
        previous_worker_type_id: EWorkerType.whatsmeow,
        session_storage: EWorkerSessionStorage.postgres,
        remove_session: true,
        remove_volume: false,
      })
    );
    expect(
      deps.workerGrpcClientService.cleanupWorker.mock.invocationCallOrder[0]
    ).toBeLessThan(
      deps.workerGrpcClientService.recreateWorker.mock.invocationCallOrder[0]
    );
    expect(
      deps.workerRuntimeRepository.isWhatsappProviderHandoffTargetAuthorized
    ).not.toHaveBeenCalled();
  });

  it('removes a legacy volume before recreating a fresh reset with PostgreSQL storage', async () => {
    const deps = makeSut();
    const primary = lifecyclePayload({
      action: 'recreate',
      source: 'reset_connection',
      worker_status_id: EWorkerStatus.recreating,
      session_storage: EWorkerSessionStorage.postgres,
      previous_session_storage: EWorkerSessionStorage.legacy_volume,
      previous_server_id: 'server-1',
      previous_worker_type_id: EWorkerType.baileys,
      cleanup_previous_runtime_required: true,
      remove_session: true,
      remove_volume: true,
    }) as unknown as IWorkerLifecycleQueueMessage;
    const cleanup: IWorkerLifecycleQueueMessage = {
      ...primary,
      request_id: 'request-reset-cleanup',
      action: 'cleanup_previous_runtime',
    };
    deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValue(
      currentWorker({
        worker_status_id: EWorkerStatus.recreating,
        session_storage: EWorkerSessionStorage.postgres,
      })
    );
    deps.workerLifecycleQueueService.loadPrepared.mockResolvedValue([
      cleanup,
      primary,
    ]);
    deps.workerGrpcClientService.cleanupWorker.mockRejectedValueOnce(
      new Error('legacy volume cleanup unavailable')
    );

    await expect(
      (deps.sut as any).processPayload(primary, jest.fn())
    ).rejects.toThrow('legacy volume cleanup unavailable');
    expect(deps.workerGrpcClientService.recreateWorker).not.toHaveBeenCalled();

    await expect(
      (deps.sut as any).processPayload(primary, jest.fn())
    ).resolves.toBeUndefined();

    expect(deps.workerGrpcClientService.cleanupWorker).toHaveBeenCalledTimes(2);
    expect(deps.workerGrpcClientService.cleanupWorker).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: EWorkerAction.cleanup,
        session_storage: EWorkerSessionStorage.postgres,
        previous_session_storage: EWorkerSessionStorage.legacy_volume,
        remove_session: true,
        remove_volume: true,
      })
    );
    expect(deps.workerGrpcClientService.recreateWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        session_storage: EWorkerSessionStorage.postgres,
        previous_session_storage: EWorkerSessionStorage.legacy_volume,
        remove_session: true,
        remove_volume: true,
      })
    );
    expect(
      deps.workerGrpcClientService.cleanupWorker.mock.invocationCallOrder[1]
    ).toBeLessThan(
      deps.workerGrpcClientService.recreateWorker.mock.invocationCallOrder[0]
    );
  });

  it('dispatches an authorized PostgreSQL provider handoff across type and server while the worker row still owns the source provider', async () => {
    const deps = makeSut();
    const primary = lifecyclePayload({
      action: 'recreate',
      source: 'worker_update',
      server_id: 'server-target',
      previous_server_id: 'server-source',
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: EWorkerType.whatsmeow,
      previous_worker_type_id: EWorkerType.baileys,
      session_storage: EWorkerSessionStorage.postgres,
      remove_session: false,
      remove_volume: false,
      cleanup_previous_runtime_required: true,
    }) as unknown as IWorkerLifecycleQueueMessage;
    const cleanup: IWorkerLifecycleQueueMessage = {
      ...primary,
      request_id: 'request-provider-handoff-cleanup',
      action: 'cleanup_previous_runtime',
      server_id: 'server-source',
      worker_type_id: EWorkerType.baileys,
    };
    deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValue(
      currentWorker({
        server_id: 'server-target',
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: EWorkerType.baileys,
        session_storage: EWorkerSessionStorage.postgres,
      })
    );
    deps.workerRuntimeRepository.isWhatsappProviderHandoffTargetAuthorized.mockResolvedValue(
      true
    );
    deps.workerLifecycleQueueService.loadPrepared.mockResolvedValue([
      cleanup,
      primary,
    ]);

    await expect(
      (deps.sut as any).processPayload(primary, jest.fn())
    ).resolves.toBeUndefined();

    expect(
      deps.workerRuntimeRepository.isWhatsappProviderHandoffTargetAuthorized
    ).toHaveBeenCalledWith({
      worker_id: 'worker-1',
      account_id: 'account-1',
      lifecycle_operation_id: 'operation-1',
      target_worker_type_id: EWorkerType.whatsmeow,
    });
    expect(deps.workerGrpcClientService.cleanupWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_type_id: EWorkerType.baileys,
        previous_server_id: 'server-source',
        remove_session: false,
        remove_volume: false,
      })
    );
    expect(deps.workerGrpcClientService.recreateWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_type_id: EWorkerType.whatsmeow,
        previous_worker_type_id: EWorkerType.baileys,
        previous_server_id: 'server-source',
        session_storage: EWorkerSessionStorage.postgres,
        remove_session: false,
        remove_volume: false,
      })
    );
  });

  it.each([
    [
      'target recreation',
      'recreate',
      EWorkerType.whatsmeow,
      EWorkerType.baileys,
      1,
    ],
    [
      'source cleanup with its real source-provider payload',
      'cleanup_previous_runtime',
      EWorkerType.baileys,
      EWorkerType.baileys,
      0,
    ],
  ] as const)(
    'suppresses a queued provider handoff %s after terminal commit even when runtime health is unavailable',
    async (
      _effect,
      action,
      workerTypeId,
      previousWorkerTypeId,
      expectedSlotReleases
    ) => {
      const deps = makeSut();
      const payload = lifecyclePayload({
        action,
        source: 'worker_update',
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: workerTypeId,
        previous_worker_type_id: previousWorkerTypeId,
        session_storage: EWorkerSessionStorage.postgres,
        remove_session: false,
        remove_volume: false,
        cleanup_previous_runtime_required: true,
        redrive_claim_token: 'operation-1:019fe267-40c7-767d-a866-7c83bcfd0350',
      }) as unknown as IWorkerLifecycleQueueMessage;
      deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValue(
        currentWorker({
          worker_status_id: EWorkerStatus.online,
          worker_type_id: EWorkerType.whatsmeow,
          session_storage: EWorkerSessionStorage.postgres,
        })
      );
      deps.workerRuntimeRepository.viewWhatsappProviderHandoffTerminalLifecycleProof.mockResolvedValue(
        {
          handoff_id: 'handoff-1',
          lifecycle_operation_id: 'operation-1',
          handoff_state: 'completed',
          error_code: null,
          source_provider: 'baileys',
          target_provider: 'whatsmeow',
          recovery_state: 'none',
          recovery_operation_id: null,
          resolution_state: null,
          resolution_operation_id: null,
          point_of_no_return_at: '2026-08-09T03:30:00.000Z',
          worker_type_id: EWorkerType.whatsmeow,
          worker_status_id: EWorkerStatus.online,
          terminal_ownership_unique: true,
        }
      );
      deps.workerGrpcClientService.runtimeHealth.mockRejectedValue(
        new Error('runtime health unavailable')
      );

      await expect(
        (deps.sut as any).processPayload(payload, jest.fn())
      ).resolves.toBeUndefined();

      expect(
        deps.workerRuntimeRepository
          .viewWhatsappProviderHandoffTerminalLifecycleProof
      ).toHaveBeenCalledWith({
        worker_id: 'worker-1',
        account_id: 'account-1',
        lifecycle_operation_id: 'operation-1',
      });
      expect(
        deps.workerLifecycleLockService.releaseRedriveClaim
      ).toHaveBeenCalledWith(
        'worker-1',
        'operation-1',
        'operation-1:019fe267-40c7-767d-a866-7c83bcfd0350'
      );
      expect(
        deps.workerRecreateServerSlotService.releaseReservedSlot
      ).toHaveBeenCalledTimes(expectedSlotReleases);
      expect(
        deps.workerLifecycleQueueService.loadPrepared
      ).not.toHaveBeenCalled();
      expect(deps.workerGrpcClientService.runtimeHealth).not.toHaveBeenCalled();
      expect(deps.workerGrpcClientService.cleanupWorker).not.toHaveBeenCalled();
      expect(
        deps.workerGrpcClientService.recreateWorker
      ).not.toHaveBeenCalled();
    }
  );

  it('suppresses a recovery cleanup after the preserved source runtime is reserved', async () => {
    const deps = makeSut();
    const payload = lifecyclePayload({
      action: 'cleanup_previous_runtime',
      source: 'worker_update',
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: EWorkerType.baileys,
      previous_worker_type_id: EWorkerType.baileys,
      session_storage: EWorkerSessionStorage.postgres,
      remove_session: false,
      remove_volume: false,
    }) as unknown as IWorkerLifecycleQueueMessage;
    deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValue(
      currentWorker({
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: EWorkerType.wwebjs,
        session_storage: EWorkerSessionStorage.postgres,
      })
    );
    deps.workerRuntimeRepository.viewWhatsappProviderHandoffRecoveryLifecycleProof.mockResolvedValue(
      {
        handoff_id: 'handoff-1',
        handoff_lifecycle_operation_id: 'original-operation',
        recovery_operation_id: 'operation-1',
        source_provider: 'wwebjs',
        failed_target_provider: 'baileys',
        source_revision_id: '41',
        recovery_state: 'running',
        recovery_cleanup_required: true,
        recovery_from_generation: 20,
        recovery_ownership_unique: true,
        recovery_context_valid: true,
        source_session_valid: true,
        runtime_source_provider: null,
        runtime_generation: 21,
        runtime_container_id: null,
        recovery_source_runtime_reserved: true,
      }
    );

    await expect(
      (deps.sut as any).processPayload(payload, jest.fn())
    ).resolves.toBeUndefined();

    expect(
      deps.workerRuntimeRepository
        .viewWhatsappProviderHandoffRecoveryLifecycleProof
    ).toHaveBeenCalledWith({
      worker_id: 'worker-1',
      account_id: 'account-1',
      recovery_operation_id: 'operation-1',
      recovery_worker_type_id: EWorkerType.wwebjs,
      recovery_provider: 'wwebjs',
    });
    expect(deps.workerGrpcClientService.cleanupWorker).not.toHaveBeenCalled();
    expect(deps.workerGrpcClientService.recreateWorker).not.toHaveBeenCalled();
  });

  it('runs the exact prepared source drain before an out-of-order PostgreSQL handoff target and retries idempotently', async () => {
    const deps = makeSut();
    const primary = lifecyclePayload({
      action: 'recreate',
      source: 'worker_update',
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: EWorkerType.whatsmeow,
      previous_worker_type_id: EWorkerType.baileys,
      session_storage: EWorkerSessionStorage.postgres,
      remove_session: false,
      remove_volume: false,
      cleanup_previous_runtime_required: true,
    }) as unknown as IWorkerLifecycleQueueMessage;
    const cleanup: IWorkerLifecycleQueueMessage = {
      ...primary,
      request_id: 'request-provider-handoff-cleanup',
      action: 'cleanup_previous_runtime',
      worker_type_id: EWorkerType.baileys,
    };
    deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValue(
      currentWorker({
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: EWorkerType.baileys,
        session_storage: EWorkerSessionStorage.postgres,
      })
    );
    deps.workerLifecycleQueueService.loadPrepared.mockResolvedValue([
      cleanup,
      primary,
    ]);
    deps.workerRuntimeRepository.isWhatsappProviderHandoffTargetAuthorized
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    deps.workerRuntimeRepository.viewWhatsappProviderHandoffLifecycleContext.mockResolvedValue(
      {
        lifecycle_operation_id: 'operation-1',
        source_provider: 'baileys',
        target_provider: 'whatsmeow',
        state: 'requested',
      }
    );
    deps.workerGrpcClientService.cleanupWorker.mockRejectedValueOnce(
      new Error('source drain unavailable')
    );

    await expect(
      (deps.sut as any).processPayload(primary, jest.fn())
    ).rejects.toThrow('source drain unavailable');
    expect(deps.workerGrpcClientService.recreateWorker).not.toHaveBeenCalled();

    await expect(
      (deps.sut as any).processPayload(primary, jest.fn())
    ).resolves.toBeUndefined();

    expect(deps.workerGrpcClientService.cleanupWorker).toHaveBeenCalledTimes(2);
    expect(deps.workerGrpcClientService.recreateWorker).toHaveBeenCalledTimes(
      1
    );
    expect(
      deps.workerGrpcClientService.cleanupWorker.mock.invocationCallOrder[1]
    ).toBeLessThan(
      deps.workerGrpcClientService.recreateWorker.mock.invocationCallOrder[0]
    );
    expect(
      deps.workerRuntimeRepository.viewWhatsappProviderHandoffLifecycleContext
    ).toHaveBeenCalledTimes(2);
  });

  it('keeps the target retryable when source cleanup returns before its fenced drain ACK is visible', async () => {
    const deps = makeSut();
    const primary = lifecyclePayload({
      action: 'recreate',
      source: 'worker_update',
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: EWorkerType.whatsmeow,
      previous_worker_type_id: EWorkerType.baileys,
      session_storage: EWorkerSessionStorage.postgres,
      remove_session: false,
      remove_volume: false,
      cleanup_previous_runtime_required: true,
    }) as unknown as IWorkerLifecycleQueueMessage;
    const cleanup: IWorkerLifecycleQueueMessage = {
      ...primary,
      request_id: 'request-provider-handoff-cleanup-pending-ack',
      action: 'cleanup_previous_runtime',
      worker_type_id: EWorkerType.baileys,
    };
    deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValue(
      currentWorker({
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: EWorkerType.baileys,
        session_storage: EWorkerSessionStorage.postgres,
      })
    );
    deps.workerLifecycleQueueService.loadPrepared.mockResolvedValue([
      cleanup,
      primary,
    ]);
    deps.workerRuntimeRepository.isWhatsappProviderHandoffTargetAuthorized.mockResolvedValue(
      false
    );
    deps.workerRuntimeRepository.viewWhatsappProviderHandoffLifecycleContext.mockResolvedValue(
      {
        lifecycle_operation_id: 'operation-1',
        source_provider: 'baileys',
        target_provider: 'whatsmeow',
        state: 'draining',
      }
    );

    let pendingError: unknown;
    try {
      await (deps.sut as any).processPayload(primary, jest.fn());
    } catch (error) {
      pendingError = error;
    }

    expect(pendingError).toEqual(
      expect.objectContaining({
        name: 'WorkerProviderHandoffSourceDrainPendingError',
        workerId: 'worker-1',
      })
    );
    expect((deps.sut as any).classifyLifecycleError(pendingError)).toBe(
      'retryable'
    );
    expect(deps.workerGrpcClientService.cleanupWorker).toHaveBeenCalledTimes(1);
    expect(deps.workerGrpcClientService.recreateWorker).not.toHaveBeenCalled();
  });

  it('never authorizes a destination from a failed provider handoff context', async () => {
    const deps = makeSut();
    const primary = lifecyclePayload({
      action: 'recreate',
      source: 'worker_update',
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: EWorkerType.whatsmeow,
      previous_worker_type_id: EWorkerType.baileys,
      session_storage: EWorkerSessionStorage.postgres,
      remove_session: false,
      remove_volume: false,
      cleanup_previous_runtime_required: true,
    }) as unknown as IWorkerLifecycleQueueMessage;
    deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValue(
      currentWorker({
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: EWorkerType.baileys,
        session_storage: EWorkerSessionStorage.postgres,
      })
    );
    deps.workerRuntimeRepository.isWhatsappProviderHandoffTargetAuthorized.mockResolvedValue(
      false
    );
    deps.workerRuntimeRepository.viewWhatsappProviderHandoffLifecycleContext.mockResolvedValue(
      {
        lifecycle_operation_id: 'operation-1',
        source_provider: 'baileys',
        target_provider: 'whatsmeow',
        state: 'failed',
      }
    );

    await expect(
      (deps.sut as any).processPayload(primary, jest.fn())
    ).resolves.toBeUndefined();

    expect(deps.workerGrpcClientService.cleanupWorker).not.toHaveBeenCalled();
    expect(deps.workerGrpcClientService.recreateWorker).not.toHaveBeenCalled();
  });

  it.each([
    {
      caseName: 'database handoff authorization is absent',
      overrides: {},
      databaseAuthorized: false,
      authorizationQueried: true,
    },
    {
      caseName: 'session reset is requested',
      overrides: { remove_session: true },
      databaseAuthorized: true,
      authorizationQueried: false,
    },
    {
      caseName: 'volume reset is requested',
      overrides: { remove_volume: true },
      databaseAuthorized: true,
      authorizationQueried: false,
    },
    {
      caseName: 'previous provider does not match the worker row',
      overrides: { previous_worker_type_id: EWorkerType.wwebjs },
      databaseAuthorized: true,
      authorizationQueried: false,
    },
    {
      caseName: 'cleanup dependency is not explicit',
      overrides: { cleanup_previous_runtime_required: undefined },
      databaseAuthorized: true,
      authorizationQueried: false,
    },
  ])(
    'discards a provider-mismatched recreate when $caseName',
    async ({ overrides, databaseAuthorized, authorizationQueried }) => {
      const deps = makeSut();
      const primary = lifecyclePayload({
        action: 'recreate',
        source: 'worker_update',
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: EWorkerType.whatsmeow,
        previous_worker_type_id: EWorkerType.baileys,
        session_storage: EWorkerSessionStorage.postgres,
        remove_session: false,
        remove_volume: false,
        cleanup_previous_runtime_required: true,
        ...overrides,
      }) as unknown as IWorkerLifecycleQueueMessage;
      deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValue(
        currentWorker({
          worker_status_id: EWorkerStatus.recreating,
          worker_type_id: EWorkerType.baileys,
          session_storage: EWorkerSessionStorage.postgres,
        })
      );
      deps.workerRuntimeRepository.isWhatsappProviderHandoffTargetAuthorized.mockResolvedValue(
        databaseAuthorized
      );

      await expect(
        (deps.sut as any).processPayload(primary, jest.fn())
      ).resolves.toBeUndefined();

      expect(
        deps.workerRuntimeRepository.isWhatsappProviderHandoffTargetAuthorized
      ).toHaveBeenCalledTimes(authorizationQueried ? 1 : 0);
      expect(deps.workerGrpcClientService.cleanupWorker).not.toHaveBeenCalled();
      expect(
        deps.workerGrpcClientService.recreateWorker
      ).not.toHaveBeenCalled();
    }
  );

  it('retries instead of committing a provider-mismatched recreate when handoff authorization cannot be read', async () => {
    const deps = makeSut();
    const primary = lifecyclePayload({
      action: 'recreate',
      source: 'worker_update',
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: EWorkerType.whatsmeow,
      previous_worker_type_id: EWorkerType.baileys,
      session_storage: EWorkerSessionStorage.postgres,
      remove_session: false,
      remove_volume: false,
      cleanup_previous_runtime_required: true,
    }) as unknown as IWorkerLifecycleQueueMessage;
    deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValue(
      currentWorker({
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: EWorkerType.baileys,
        session_storage: EWorkerSessionStorage.postgres,
      })
    );
    deps.workerRuntimeRepository.isWhatsappProviderHandoffTargetAuthorized.mockRejectedValue(
      new Error('database unavailable')
    );

    await expect(
      (deps.sut as any).processPayload(primary, jest.fn())
    ).rejects.toThrow('database unavailable');
    expect(deps.workerGrpcClientService.cleanupWorker).not.toHaveBeenCalled();
    expect(deps.workerGrpcClientService.recreateWorker).not.toHaveBeenCalled();
  });

  it('fails closed before a worker-update primary when its journal cannot be read', async () => {
    const deps = makeSut();
    const primary = lifecyclePayload({
      action: 'recreate',
      source: 'worker_update',
      server_id: 'server-new',
      worker_status_id: EWorkerStatus.recreating,
      previous_server_id: 'server-old',
      previous_worker_type_id: EWorkerType.wwebjs,
      cleanup_previous_runtime_required: true,
    });
    deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValue(
      currentWorker({
        server_id: 'server-new',
        worker_status_id: EWorkerStatus.recreating,
      })
    );
    deps.workerLifecycleQueueService.loadPrepared.mockRejectedValue(
      new Error('redis unavailable')
    );

    await expect(
      (deps.sut as any).processPayload(primary, jest.fn())
    ).rejects.toThrow('redis unavailable');
    expect(deps.workerGrpcClientService.cleanupWorker).not.toHaveBeenCalled();
    expect(deps.workerGrpcClientService.recreateWorker).not.toHaveBeenCalled();
  });

  it('runs prepared cleanup before finalizing an already-online target runtime', async () => {
    const deps = makeSut();
    const primary = lifecyclePayload({
      action: 'recreate',
      source: 'worker_update',
      server_id: 'server-new',
      worker_status_id: EWorkerStatus.recreating,
      previous_server_id: 'server-old',
      previous_worker_type_id: EWorkerType.wwebjs,
      cleanup_previous_runtime_required: true,
    }) as unknown as IWorkerLifecycleQueueMessage;
    const cleanup: IWorkerLifecycleQueueMessage = {
      ...primary,
      request_id: 'request-cleanup-online',
      action: 'cleanup_previous_runtime',
      server_id: 'server-old',
      worker_type_id: EWorkerType.wwebjs,
    };
    deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValue(
      currentWorker({
        server_id: 'server-new',
        worker_status_id: EWorkerStatus.online,
      })
    );
    deps.workerLifecycleQueueService.loadPrepared.mockResolvedValue([
      cleanup,
      primary,
    ]);
    deps.workerRuntimeRepository.viewByWorkerIdConsistent.mockResolvedValue({
      worker_id: 'worker-1',
      container_id: 'container-online',
      runtime_generation: 9,
      connection_epoch: 'epoch-online',
    });
    deps.workerGrpcClientService.runtimeHealth.mockResolvedValue(
      strictHealthyRuntimeHealth({ runtime_generation: 9 })
    );
    deps.workerGrpcClientService.cleanupWorker.mockRejectedValueOnce(
      new Error('old server unavailable')
    );

    await expect(
      (deps.sut as any).processPayload(primary, jest.fn())
    ).rejects.toThrow('old server unavailable');
    expect(
      deps.workerRuntimeRepository.reconcileHealthyRuntimeLifecycle
    ).not.toHaveBeenCalled();

    deps.workerGrpcClientService.cleanupWorker.mockResolvedValue(undefined);
    await expect(
      (deps.sut as any).processPayload(primary, jest.fn())
    ).resolves.toBeUndefined();
    expect(
      deps.workerRuntimeRepository.reconcileHealthyRuntimeLifecycle
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        lifecycle_operation_id: 'operation-1',
        expected_worker_status_id: EWorkerStatus.online,
      })
    );
    expect(deps.workerGrpcClientService.recreateWorker).not.toHaveBeenCalled();
  });

  it('discards an old cold Kafka record after the journal upgrades to warm activation', async () => {
    const deps = makeSut();
    const cold = lifecyclePayload({
      action: 'create',
      source: 'worker_create',
      session_storage: EWorkerSessionStorage.postgres,
      worker_status_id: EWorkerStatus.creating,
    }) as unknown as IWorkerLifecycleQueueMessage;
    const warm: IWorkerLifecycleQueueMessage = {
      ...cold,
      request_id: 'request-authoritative-warm',
      action: 'activate_warm',
      warm_pool_id: 'warm-1',
    };
    deps.workerLifecycleQueueService.loadAuthoritativePreparedPayload.mockResolvedValue(
      warm
    );

    await expect(
      (deps.sut as any).processPayload(cold, jest.fn())
    ).resolves.toBeUndefined();

    expect(
      deps.workerService.viewWorkerForMonitorConsistent
    ).not.toHaveBeenCalled();
    expect(deps.workerGrpcClientService.createWorker).not.toHaveBeenCalled();
    expect(deps.workerGrpcClientService.recreateWorker).not.toHaveBeenCalled();
    expect(
      deps.workerGrpcClientService.activateWarmWorker
    ).not.toHaveBeenCalled();
  });

  it('discards cleanup whose immutable flags differ from the journal', async () => {
    const deps = makeSut();
    const cleanup = lifecyclePayload({
      action: 'cleanup_previous_runtime',
      source: 'worker_update',
      worker_status_id: EWorkerStatus.recreating,
      remove_session: true,
      remove_volume: true,
    }) as unknown as IWorkerLifecycleQueueMessage;
    deps.workerLifecycleQueueService.loadAuthoritativePreparedPayload.mockResolvedValue(
      {
        ...cleanup,
        request_id: 'request-authoritative-cleanup',
        remove_volume: false,
      }
    );

    await expect(
      (deps.sut as any).processPayload(cleanup, jest.fn())
    ).resolves.toBeUndefined();

    expect(deps.workerGrpcClientService.cleanupWorker).not.toHaveBeenCalled();
    expect(
      deps.workerService.viewWorkerForMonitorConsistent
    ).not.toHaveBeenCalled();
  });

  it('honors explicit false cleanup requirement for a previous offline runtime', async () => {
    const deps = makeSut();
    const primary = lifecyclePayload({
      action: 'recreate',
      source: 'worker_update',
      server_id: 'server-new',
      worker_status_id: EWorkerStatus.recreating,
      previous_server_id: 'server-offline',
      previous_worker_type_id: EWorkerType.wwebjs,
      cleanup_previous_runtime_required: false,
    }) as unknown as IWorkerLifecycleQueueMessage;
    deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValue(
      currentWorker({
        server_id: 'server-new',
        worker_status_id: EWorkerStatus.recreating,
      })
    );

    await expect(
      (deps.sut as any).processPayload(primary, jest.fn())
    ).resolves.toBeUndefined();

    expect(deps.workerGrpcClientService.cleanupWorker).not.toHaveBeenCalled();
    expect(deps.workerGrpcClientService.recreateWorker).toHaveBeenCalledTimes(
      1
    );
  });

  it('infers a missing cleanup dependency for a legacy divergent primary', async () => {
    const deps = makeSut();
    const primary = lifecyclePayload({
      action: 'recreate',
      source: 'worker_update',
      server_id: 'server-new',
      worker_status_id: EWorkerStatus.recreating,
      previous_server_id: 'server-old',
      previous_worker_type_id: EWorkerType.wwebjs,
    }) as unknown as IWorkerLifecycleQueueMessage;
    deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValue(
      currentWorker({
        server_id: 'server-new',
        worker_status_id: EWorkerStatus.recreating,
      })
    );

    await expect(
      (deps.sut as any).processPayload(primary, jest.fn())
    ).rejects.toThrow('Prepared cleanup dependency is missing');
    expect(deps.workerGrpcClientService.recreateWorker).not.toHaveBeenCalled();
  });

  it('executes confirmed warm fallback inline without downgrading the journal', async () => {
    const deps = makeSut();
    const warm = lifecyclePayload({
      action: 'activate_warm',
      source: 'worker_create',
      session_storage: EWorkerSessionStorage.postgres,
      warm_pool_id: 'warm-1',
      worker_status_id: EWorkerStatus.creating,
    }) as unknown as IWorkerLifecycleQueueMessage;
    deps.workerGrpcClientService.activateWarmWorker.mockResolvedValue({
      claimed: false,
      error: 'confirmed_cleanup',
    });

    await expect(
      (deps.sut as any).processPayload(warm, jest.fn())
    ).resolves.toBeUndefined();

    expect(deps.workerGrpcClientService.createWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        action: EWorkerAction.create,
        lifecycle_operation_id: 'operation-1',
        lifecycle_semantic_fingerprint: expect.any(String),
      })
    );
    expect(deps.workerLifecycleQueueService.publish).not.toHaveBeenCalled();
  });

  it('clears a blocked plan-limit fence only after cleanup succeeds', async () => {
    const deps = makeSut();
    deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValue(
      currentWorker({ worker_status_id: EWorkerStatus.blocked })
    );
    const cleanup = lifecyclePayload({
      action: 'cleanup_previous_runtime',
      source: 'plan_limit_enforcement',
      worker_status_id: EWorkerStatus.blocked,
    });

    await expect(
      (deps.sut as any).processPayload(cleanup, jest.fn())
    ).resolves.toBeUndefined();
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'account-1',
      {
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.blocked,
        lifecycle_operation_id: null,
      },
      {
        lifecycle_operation_id: 'operation-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.blocked,
      }
    );
  });

  it('routes a preserving warm-update message through regular recreate', async () => {
    const deps = makeSut();

    await deps.sut.execute(deps.server as never);
    deps.handlers.data({
      value: Buffer.from(
        JSON.stringify(
          lifecyclePayload({
            action: 'activate_warm',
            warm_pool_id: 'warm-1',
            source: 'worker_update',
            session_storage: EWorkerSessionStorage.legacy_volume,
            worker_status_id: EWorkerStatus.recreating,
            remove_session: false,
            remove_volume: false,
          })
        )
      ),
      partition: 4,
      offset: 8,
      consumerAssignmentEpoch: 101,
    });
    await waitForCommit(4, 8);
    await deps.sut.close();

    expect(deps.workerGrpcClientService.recreateWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        lifecycle_operation_id: 'operation-1',
        remove_session: false,
        remove_volume: false,
      })
    );
    expect(
      deps.workerGrpcClientService.activateWarmWorker
    ).not.toHaveBeenCalled();
    expect(deps.workerGrpcClientService.createWorker).not.toHaveBeenCalled();
    expect(
      deps.workerGrpcClientService.deleteWarmWorker
    ).not.toHaveBeenCalled();
    expect(commitOffset).toHaveBeenCalledWith(
      deps.kafkaConsumer,
      'worker.lifecycle.request',
      4,
      8
    );
  });

  it('commits a deadline-exhausted warm delivery for durable fast redrive without inline retry', async () => {
    jest.useFakeTimers();
    const deps = makeSut();
    deps.workerGrpcClientService.activateWarmWorker.mockRejectedValue(
      Object.assign(new Error('deadline exceeded after commit'), {
        code: GrpcStatus.DEADLINE_EXCEEDED,
      })
    );

    try {
      await deps.sut.execute(deps.server as never);
      deps.handlers.data({
        value: Buffer.from(
          JSON.stringify(
            lifecyclePayload({
              action: 'activate_warm',
              warm_pool_id: 'warm-1',
              source: 'worker_update',
              session_storage: EWorkerSessionStorage.postgres,
              worker_status_id: EWorkerStatus.recreating,
              remove_session: true,
              remove_volume: false,
              redrive_claim_token:
                'operation-1:019fe267-40c7-767d-a866-7c83bcfd0350',
            })
          )
        ),
        partition: 4,
        offset: 9,
        consumerAssignmentEpoch: 101,
      });
      await flushPromises();
      await flushPromises(12);
      await waitForCommit(4, 9);
      await deps.sut.close();

      expect(
        deps.workerGrpcClientService.activateWarmWorker
      ).toHaveBeenCalledWith(
        'server-1',
        expect.objectContaining({
          warm_pool_id: 'warm-1',
          worker_id: 'worker-1',
          account_id: 'account-1',
          lifecycle_operation_id: 'operation-1',
        }),
        workerLifecycleBudgets.grpcDeadlineMs
      );
      expect(
        deps.workerGrpcClientService.activateWarmWorker
      ).toHaveBeenCalledTimes(1);
      expect(
        deps.workerLifecycleLockService.releaseRedriveClaim
      ).not.toHaveBeenCalled();
      expect(
        deps.workerGrpcClientService.deleteWarmWorker
      ).not.toHaveBeenCalled();
      expect(deps.workerGrpcClientService.createWorker).not.toHaveBeenCalled();
      expect(deps.connectionLifecycleDebugService.log).toHaveBeenCalledWith(
        'service.lifecycle_queue.retry_pending_fast_redrive',
        expect.objectContaining({
          worker_id: 'worker-1',
          lifecycle_operation_id: 'operation-1',
        })
      );
      expect(commitOffset).toHaveBeenCalledWith(
        deps.kafkaConsumer,
        'worker.lifecycle.request',
        4,
        9
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('defers an ambiguous warm activation while the Balance still owns its lifecycle lock', async () => {
    jest.useFakeTimers();
    const deps = makeSut();
    deps.workerGrpcClientService.activateWarmWorker.mockRejectedValue(
      Object.assign(new Error('deadline exceeded after dispatch'), {
        code: GrpcStatus.DEADLINE_EXCEEDED,
      })
    );
    deps.workerLifecycleLockService.isLocked
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    try {
      await deps.sut.execute(deps.server as never);
      deps.handlers.data({
        value: Buffer.from(
          JSON.stringify(
            lifecyclePayload({
              action: 'activate_warm',
              warm_pool_id: 'warm-1',
              source: 'worker_update',
              session_storage: EWorkerSessionStorage.postgres,
              worker_status_id: EWorkerStatus.recreating,
              remove_session: true,
              remove_volume: false,
              redrive_claim_token:
                'operation-1:019fe267-40c7-767d-a866-7c83bcfd0350',
            })
          )
        ),
        partition: 4,
        offset: 10,
        consumerAssignmentEpoch: 101,
      });
      await flushPromises();
      await jest.advanceTimersByTimeAsync(1000);
      await flushPromises();
      await jest.advanceTimersByTimeAsync(5000);
      await flushPromises(12);
      await waitForCommit(4, 10);
      await deps.sut.close();

      expect(
        deps.workerGrpcClientService.activateWarmWorker
      ).toHaveBeenCalledTimes(1);
      expect(deps.workerLifecycleLockService.isLocked).toHaveBeenCalledWith(
        'worker-1'
      );
      expect(
        deps.workerService.updateWorkerByIdIfLifecycleMatches
      ).not.toHaveBeenCalled();
      expect(deps.connectionLifecycleDebugService.log).toHaveBeenCalledWith(
        'service.lifecycle_queue.warm_activation_deferred_active',
        expect.objectContaining({
          worker_id: 'worker-1',
          lifecycle_operation_id: 'operation-1',
        })
      );
      expect(
        deps.workerLifecycleLockService.releaseRedriveClaim
      ).toHaveBeenCalledWith(
        'worker-1',
        'operation-1',
        'operation-1:019fe267-40c7-767d-a866-7c83bcfd0350'
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('stops retrying an unavailable warm activation and releases its Kafka partition', async () => {
    jest.useFakeTimers();
    const deps = makeSut();
    deps.workerGrpcClientService.activateWarmWorker.mockRejectedValue(
      Object.assign(new Error('warm balance unavailable'), {
        code: GrpcStatus.UNAVAILABLE,
      })
    );

    try {
      await deps.sut.execute(deps.server as never);
      deps.handlers.data({
        value: Buffer.from(
          JSON.stringify(
            lifecyclePayload({
              action: 'activate_warm',
              warm_pool_id: 'warm-1',
              source: 'worker_update',
              session_storage: EWorkerSessionStorage.postgres,
              worker_status_id: EWorkerStatus.recreating,
              remove_session: true,
              remove_volume: false,
            })
          )
        ),
        partition: 4,
        offset: 10,
        consumerAssignmentEpoch: 101,
      });

      await flushPromises();
      await jest.advanceTimersByTimeAsync(1000);
      await flushPromises();
      await jest.advanceTimersByTimeAsync(5000);
      await flushPromises(12);
      await waitForCommit(4, 10);

      await jest.advanceTimersByTimeAsync(60_000);
      await flushPromises();
      await deps.sut.close();

      expect(
        deps.workerGrpcClientService.activateWarmWorker
      ).toHaveBeenCalledTimes(3);
      expect(
        deps.workerService.updateWorkerByIdIfLifecycleMatches
      ).not.toHaveBeenCalled();
      expect(commitOffset).toHaveBeenCalledWith(
        deps.kafkaConsumer,
        'worker.lifecycle.request',
        4,
        10
      );
    } finally {
      jest.useRealTimers();
    }
  });
});
