import 'reflect-metadata';

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

jest.mock('@core/services/workerWarmPoolSettings.service', () => ({
  WorkerWarmPoolSettingsService: class WorkerWarmPoolSettingsService {},
}));

jest.mock('@core/repositories/worker/WorkerWarmPool.repository', () => ({
  WorkerWarmPoolRepository: class WorkerWarmPoolRepository {},
}));

import { WorkerWarmReplenishConsume } from '@core/consumer/worker/WorkerWarmReplenish.consume';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { commitOffset } from '@core/common/functions/commitOffset';
import { createConsumer } from '@core/common/functions/createConsumer';

const { setImmediate: scheduleRealImmediate } =
  jest.requireActual<typeof import('node:timers')>('node:timers');

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

describe('WorkerWarmReplenishConsume', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function makeSut(
    warmupEnabled: boolean,
    options: {
      capacityClaimed?: boolean;
    } = {}
  ) {
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
      workerWarmReplenishRequest: jest.fn(
        () => 'worker.warm.replenish.request'
      ),
      getNumPartitions: jest.fn(() => 1),
      getReplicationFactor: jest.fn(() => 1),
    };
    const workerGrpcClientService = {
      createWarmWorker: jest.fn(async () => ({
        warm_pool_id: 'warm-1',
      })),
    };
    const workerWarmPoolSettingsService = {
      view: jest.fn(async () => ({
        settings_id: 'default',
        warmup_enabled: warmupEnabled,
        target_ready_baileys: 4,
        target_ready_wwebjs: 5,
        target_ready_whatsmeow: 6,
        scan_interval_seconds: 30,
        reservation_ttl_seconds: 90,
        warming_stale_after_seconds: 180,
        created_at: '2026-07-17T00:00:00.000Z',
        updated_at: '2026-07-17T00:00:00.000Z',
      })),
    };
    const workerWarmPoolRepository = {
      claimCapacityForReplenish: jest.fn(
        async () => options.capacityClaimed ?? true
      ),
      recordPostgresCreationError: jest.fn(async () => true),
    };
    const sut = new WorkerWarmReplenishConsume(
      kafka as never,
      kafkaServiceQueueService as never,
      workerGrpcClientService as never,
      workerWarmPoolSettingsService as never,
      workerWarmPoolRepository as never
    );

    return {
      handlers,
      kafkaConsumer,
      kafkaServiceQueueService,
      sut,
      workerGrpcClientService,
      workerWarmPoolRepository,
      workerWarmPoolSettingsService,
    };
  }

  it('bounds process concurrency without serializing an entire Kafka partition', async () => {
    const deps = makeSut(true);

    await deps.sut.execute();

    const runner = (deps.sut as any).runner;
    expect(runner.maxInFlightTotal).toBe(8);
    expect(runner.maxInFlightPerPartition).toBe(4);

    await deps.sut.close();
  });

  it('coalesces only redeliveries of the same warm capacity slot', async () => {
    const deps = makeSut(true);
    await deps.sut.execute();
    const resolveCoalesceKey = (deps.sut as any).runner.options
      .resolveCoalesceKey as (payload: Record<string, unknown>) => string;
    const original = {
      request_id: 'req-1',
      server_id: 'srv-1',
      worker_type_id: EWorkerType.baileys,
      reason: 'scheduled_scan',
      requested_at: '2026-06-05T00:00:00.000Z',
    };
    const redrive = {
      ...original,
      requested_at: '2026-06-05T00:05:00.000Z',
    };

    expect(resolveCoalesceKey(redrive)).toBe(resolveCoalesceKey(original));
    for (const sameCapacity of [{ reason: 'manual' }]) {
      expect(resolveCoalesceKey({ ...original, ...sameCapacity })).toBe(
        resolveCoalesceKey(original)
      );
    }
    for (const conflict of [
      { request_id: 'req-2' },
      { server_id: 'srv-2' },
      { worker_type_id: EWorkerType.wwebjs },
    ]) {
      expect(resolveCoalesceKey({ ...original, ...conflict })).not.toBe(
        resolveCoalesceKey(original)
      );
    }

    await deps.sut.close();
  });

  it('commits replenish messages without creating containers when warmup is disabled', async () => {
    const deps = makeSut(false);

    await deps.sut.execute();
    deps.handlers.data({
      value: Buffer.from(
        JSON.stringify({
          request_id: 'req-1',
          server_id: 'srv-1',
          worker_type_id: EWorkerType.baileys,
          reason: 'scheduled_scan',
        })
      ),
      partition: 3,
      offset: 10,
      consumerAssignmentEpoch: 101,
    });
    await waitForCommit(3, 10);

    expect(deps.workerWarmPoolSettingsService.view).toHaveBeenCalledTimes(1);
    expect(
      deps.workerGrpcClientService.createWarmWorker
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.claimCapacityForReplenish
    ).not.toHaveBeenCalled();
    expect(commitOffset).toHaveBeenCalledWith(
      deps.kafkaConsumer,
      'worker.warm.replenish.request',
      3,
      10
    );
  });

  it('commits invalid payloads before loading settings', async () => {
    const deps = makeSut(true);

    await deps.sut.execute();
    deps.handlers.data({
      value: Buffer.from('{}'),
      partition: 1,
      offset: 2,
      consumerAssignmentEpoch: 101,
    });
    await waitForCommit(1, 2);

    expect(deps.workerWarmPoolSettingsService.view).not.toHaveBeenCalled();
    expect(
      deps.workerGrpcClientService.createWarmWorker
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.claimCapacityForReplenish
    ).not.toHaveBeenCalled();
    expect(commitOffset).toHaveBeenCalledWith(
      deps.kafkaConsumer,
      'worker.warm.replenish.request',
      1,
      2
    );
  });

  it('claims capacity atomically at consume time before creating a warm worker', async () => {
    const deps = makeSut(true);
    const requestId = '019f6f00-0000-7000-8000-000000000010';

    await deps.sut.execute();
    deps.handlers.data({
      value: Buffer.from(
        JSON.stringify({
          request_id: requestId,
          server_id: 'srv-1',
          worker_type_id: EWorkerType.wwebjs,
          reason: 'scheduled_scan',
        })
      ),
      partition: 0,
      offset: 3,
      consumerAssignmentEpoch: 101,
    });
    await waitForCommit(0, 3);

    expect(
      deps.workerWarmPoolRepository.claimCapacityForReplenish
    ).toHaveBeenCalledWith({
      warmPoolId: requestId,
      serverId: 'srv-1',
      workerTypeId: EWorkerType.wwebjs,
      sessionVolumeName: `warm-${requestId}`,
      target: 5,
      retryAfter: expect.any(String),
    });
    expect(deps.workerGrpcClientService.createWarmWorker).toHaveBeenCalledWith(
      'srv-1',
      {
        request_id: requestId,
        warm_pool_id: requestId,
        server_id: 'srv-1',
        worker_type_id: EWorkerType.wwebjs,
      },
      10_000
    );
    expect(commitOffset).toHaveBeenCalledWith(
      deps.kafkaConsumer,
      'worker.warm.replenish.request',
      0,
      3
    );
  });

  it('commits without gRPC creation when the consume-time target is already full', async () => {
    const deps = makeSut(true, { capacityClaimed: false });

    await deps.sut.execute();
    deps.handlers.data({
      value: Buffer.from(
        JSON.stringify({
          request_id: '019f6f00-0000-7000-8000-000000000011',
          server_id: 'srv-1',
          worker_type_id: EWorkerType.baileys,
          reason: 'scheduled_scan',
        })
      ),
      partition: 2,
      offset: 7,
      consumerAssignmentEpoch: 101,
    });
    await waitForCommit(2, 7);

    expect(
      deps.workerWarmPoolRepository.claimCapacityForReplenish
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        target: 4,
        workerTypeId: EWorkerType.baileys,
      })
    );
    expect(
      deps.workerGrpcClientService.createWarmWorker
    ).not.toHaveBeenCalled();
    expect(commitOffset).toHaveBeenCalledWith(
      deps.kafkaConsumer,
      'worker.warm.replenish.request',
      2,
      7
    );
  });

  it('keeps one transient gRPC failure uncommitted and completes the same claim after recovery', async () => {
    jest.useFakeTimers();
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const deps = makeSut(true);
    const transientGrpcError = Object.assign(
      new Error('14 UNAVAILABLE: balance restarting'),
      { code: 14 }
    );
    deps.workerGrpcClientService.createWarmWorker
      .mockRejectedValueOnce(transientGrpcError)
      .mockResolvedValueOnce({ warm_pool_id: 'warm-recovered' });

    try {
      await deps.sut.execute();
      deps.handlers.data({
        value: Buffer.from(
          JSON.stringify({
            request_id: '019f6f00-0000-7000-8000-000000000013',
            server_id: 'srv-recovering',
            worker_type_id: EWorkerType.baileys,
            reason: 'scheduled_scan',
          })
        ),
        partition: 4,
        offset: 9,
        consumerAssignmentEpoch: 101,
      });

      await jest.advanceTimersByTimeAsync(1_000);
      await waitForCondition(
        () =>
          deps.workerGrpcClientService.createWarmWorker.mock.calls.length === 2,
        'the recovered warm creation attempt'
      );
      await waitForCommit(4, 9);

      expect(
        deps.workerWarmPoolRepository.claimCapacityForReplenish
      ).toHaveBeenCalledTimes(2);
      expect(
        deps.workerWarmPoolRepository.claimCapacityForReplenish
      ).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          warmPoolId: '019f6f00-0000-7000-8000-000000000013',
          serverId: 'srv-recovering',
          workerTypeId: EWorkerType.baileys,
        })
      );
      expect(
        deps.workerGrpcClientService.createWarmWorker
      ).toHaveBeenNthCalledWith(
        2,
        'srv-recovering',
        expect.objectContaining({
          request_id: '019f6f00-0000-7000-8000-000000000013',
          warm_pool_id: '019f6f00-0000-7000-8000-000000000013',
        }),
        10_000
      );
      expect(commitOffset).toHaveBeenCalledWith(
        deps.kafkaConsumer,
        'worker.warm.replenish.request',
        4,
        9
      );
    } finally {
      await deps.sut.close();
      consoleError.mockRestore();
      jest.useRealTimers();
    }
  });

  it('stops redelivery without another gRPC call when the durable claim is no longer active', async () => {
    jest.useFakeTimers();
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const deps = makeSut(true);
    deps.workerWarmPoolRepository.claimCapacityForReplenish
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    deps.workerGrpcClientService.createWarmWorker.mockRejectedValueOnce(
      Object.assign(new Error('13 INTERNAL: response lost'), { code: 13 })
    );

    try {
      await deps.sut.execute();
      deps.handlers.data({
        value: Buffer.from(
          JSON.stringify({
            request_id: '019f6f00-0000-7000-8000-000000000014',
            server_id: 'srv-claim-moved',
            worker_type_id: EWorkerType.wwebjs,
            reason: 'scheduled_scan',
          })
        ),
        partition: 5,
        offset: 11,
        consumerAssignmentEpoch: 101,
      });

      await jest.advanceTimersByTimeAsync(1_000);
      await waitForCommit(5, 11);

      expect(
        deps.workerWarmPoolRepository.claimCapacityForReplenish
      ).toHaveBeenCalledTimes(2);
      expect(
        deps.workerGrpcClientService.createWarmWorker
      ).toHaveBeenCalledTimes(1);
      expect(commitOffset).toHaveBeenCalledWith(
        deps.kafkaConsumer,
        'worker.warm.replenish.request',
        5,
        11
      );
    } finally {
      await deps.sut.close();
      consoleError.mockRestore();
      jest.useRealTimers();
    }
  });

  it('bounds prolonged gRPC unavailability, persists the claim error, then commits', async () => {
    jest.useFakeTimers();
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const deps = makeSut(true);
    deps.workerGrpcClientService.createWarmWorker.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          setTimeout(
            () =>
              reject(
                Object.assign(
                  new Error('4 DEADLINE_EXCEEDED: balance offline'),
                  { code: 4 }
                )
              ),
            10_000
          );
        })
    );

    try {
      await deps.sut.execute();
      deps.handlers.data({
        value: Buffer.from(
          JSON.stringify({
            request_id: '019f6f00-0000-7000-8000-000000000015',
            server_id: 'srv-offline',
            worker_type_id: EWorkerType.baileys,
            reason: 'scheduled_scan',
          })
        ),
        partition: 6,
        offset: 13,
        consumerAssignmentEpoch: 101,
      });

      await jest.advanceTimersByTimeAsync(20_999);
      expect(commitOffset).not.toHaveBeenCalled();
      expect(
        deps.workerWarmPoolRepository.recordPostgresCreationError
      ).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(1);
      await waitForCommit(6, 13);

      expect(
        deps.workerGrpcClientService.createWarmWorker
      ).toHaveBeenCalledTimes(2);
      expect(
        deps.workerWarmPoolRepository.recordPostgresCreationError
      ).toHaveBeenCalledWith({
        warmPoolId: '019f6f00-0000-7000-8000-000000000015',
        serverId: 'srv-offline',
        workerTypeId: EWorkerType.baileys,
        error: '4 DEADLINE_EXCEEDED: balance offline',
      });
      expect(
        deps.workerWarmPoolRepository.recordPostgresCreationError.mock
          .invocationCallOrder[0]
      ).toBeLessThan((commitOffset as jest.Mock).mock.invocationCallOrder[0]);
      expect(commitOffset).toHaveBeenCalledTimes(1);
    } finally {
      await deps.sut.close();
      consoleError.mockRestore();
      jest.useRealTimers();
    }
  });

  it('does not downgrade a warm runtime that becomes ready after the client deadline', async () => {
    jest.useFakeTimers();
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const deps = makeSut(true);
    let durableState: 'warming' | 'ready' = 'warming';
    let grpcAttempts = 0;
    deps.workerWarmPoolRepository.claimCapacityForReplenish.mockImplementation(
      async () => durableState === 'warming'
    );
    deps.workerWarmPoolRepository.recordPostgresCreationError.mockImplementation(
      async () => {
        if (durableState !== 'warming') {
          return false;
        }
        return true;
      }
    );
    deps.workerGrpcClientService.createWarmWorker.mockImplementation(() => {
      grpcAttempts += 1;
      if (grpcAttempts === 1) {
        /*
         * A unary deadline only closes the client wait. The Balance may finish
         * the already-started idempotent operation shortly afterwards.
         */
        setTimeout(() => {
          durableState = 'ready';
        }, 20_500);
      }
      return new Promise((_resolve, reject) => {
        setTimeout(
          () =>
            reject(
              Object.assign(new Error('4 DEADLINE_EXCEEDED: client deadline'), {
                code: 4,
              })
            ),
          10_000
        );
      });
    });

    const requestId = '019f6f00-0000-7000-8000-000000000017';
    const payload = {
      request_id: requestId,
      server_id: 'srv-late-ready',
      worker_type_id: EWorkerType.whatsmeow,
      reason: 'scheduled_scan',
    };

    try {
      await deps.sut.execute();
      deps.handlers.data({
        value: Buffer.from(JSON.stringify(payload)),
        partition: 8,
        offset: 17,
        consumerAssignmentEpoch: 101,
      });

      await jest.advanceTimersByTimeAsync(21_000);
      await waitForCommit(8, 17);

      expect(durableState).toBe('ready');
      expect(
        deps.workerGrpcClientService.createWarmWorker
      ).toHaveBeenCalledTimes(2);
      expect(
        deps.workerWarmPoolRepository.recordPostgresCreationError
      ).toHaveBeenCalledTimes(1);
      await expect(
        deps.workerWarmPoolRepository.recordPostgresCreationError.mock
          .results[0].value
      ).resolves.toBe(false);

      /*
       * A later delivery of the same idempotency identity observes the durable
       * ready state and commits without another physical create.
       */
      deps.handlers.data({
        value: Buffer.from(JSON.stringify(payload)),
        partition: 8,
        offset: 18,
        consumerAssignmentEpoch: 101,
      });
      await waitForCommit(8, 18);

      expect(
        deps.workerWarmPoolRepository.claimCapacityForReplenish
      ).toHaveBeenCalledTimes(3);
      expect(
        deps.workerGrpcClientService.createWarmWorker
      ).toHaveBeenCalledTimes(2);
      expect(durableState).toBe('ready');
    } finally {
      await deps.sut.close();
      consoleError.mockRestore();
      jest.useRealTimers();
    }
  });

  it('does not retry unauthenticated gRPC configuration failures', async () => {
    jest.useFakeTimers();
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const deps = makeSut(true);
    deps.workerGrpcClientService.createWarmWorker.mockRejectedValue(
      Object.assign(new Error('16 UNAUTHENTICATED: invalid token'), {
        code: 16,
      })
    );

    try {
      await deps.sut.execute();
      deps.handlers.data({
        value: Buffer.from(
          JSON.stringify({
            request_id: '019f6f00-0000-7000-8000-000000000016',
            server_id: 'srv-auth-failed',
            worker_type_id: EWorkerType.wwebjs,
            reason: 'scheduled_scan',
          })
        ),
        partition: 7,
        offset: 15,
        consumerAssignmentEpoch: 101,
      });

      await waitForCommit(7, 15);

      expect(
        deps.workerGrpcClientService.createWarmWorker
      ).toHaveBeenCalledTimes(1);
      expect(
        deps.workerWarmPoolRepository.recordPostgresCreationError
      ).toHaveBeenCalledTimes(1);
      expect(commitOffset).toHaveBeenCalledTimes(1);
    } finally {
      await deps.sut.close();
      consoleError.mockRestore();
      jest.useRealTimers();
    }
  });

  it('discards unsupported worker types before claiming capacity', async () => {
    const deps = makeSut(true);

    await deps.sut.execute();
    deps.handlers.data({
      value: Buffer.from(
        JSON.stringify({
          request_id: '019f6f00-0000-7000-8000-000000000012',
          server_id: 'srv-1',
          worker_type_id: 'unsupported',
          reason: 'scheduled_scan',
        })
      ),
      partition: 0,
      offset: 8,
      consumerAssignmentEpoch: 101,
    });
    await waitForCommit(0, 8);

    expect(
      deps.workerWarmPoolRepository.claimCapacityForReplenish
    ).not.toHaveBeenCalled();
    expect(
      deps.workerGrpcClientService.createWarmWorker
    ).not.toHaveBeenCalled();
  });

  it('serializes distinct capacity slots for the same server and worker type', async () => {
    const deps = makeSut(true);
    let releaseFirst!: () => void;
    const firstCreate = new Promise<{ warm_pool_id: string }>((resolve) => {
      releaseFirst = () => resolve({ warm_pool_id: 'first' });
    });
    deps.workerGrpcClientService.createWarmWorker
      .mockImplementationOnce(() => firstCreate)
      .mockResolvedValueOnce({ warm_pool_id: 'second' });

    await deps.sut.execute();
    for (const [index, requestId] of [
      [20, '019f6f00-0000-7000-8000-000000000020'],
      [21, '019f6f00-0000-7000-8000-000000000021'],
    ] as const) {
      deps.handlers.data({
        value: Buffer.from(
          JSON.stringify({
            request_id: requestId,
            server_id: 'srv-ordered',
            worker_type_id: EWorkerType.whatsmeow,
            reason: 'scheduled_scan',
          })
        ),
        partition: 0,
        offset: index,
        consumerAssignmentEpoch: 101,
      });
    }
    await waitForCondition(
      () =>
        deps.workerGrpcClientService.createWarmWorker.mock.calls.length === 1,
      'the first serialized warm worker creation'
    );

    expect(
      deps.workerWarmPoolRepository.claimCapacityForReplenish
    ).toHaveBeenCalledTimes(1);
    expect(deps.workerGrpcClientService.createWarmWorker).toHaveBeenCalledTimes(
      1
    );

    releaseFirst();
    await waitForCommit(0, 21);

    expect(
      deps.workerWarmPoolRepository.claimCapacityForReplenish
    ).toHaveBeenCalledTimes(2);
    expect(deps.workerGrpcClientService.createWarmWorker).toHaveBeenCalledTimes(
      2
    );
  });
});
