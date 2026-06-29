import 'reflect-metadata';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';

jest.mock('@core/common/functions/commitOffset', () => ({
  commitOffset: jest.fn(async () => undefined),
}));

jest.mock('@core/common/functions/connectConsumer', () => ({
  connectConsumer: jest.fn(),
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

jest.mock('uuid', () => ({
  v7: jest.fn(() => 'generated-request-id'),
}));

import { WorkerLifecycleConsume } from '@core/consumer/worker/WorkerLifecycle.consume';
import { commitOffset } from '@core/common/functions/commitOffset';
import { createConsumer } from '@core/common/functions/createConsumer';

async function flushPromises(times = 6): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
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
    lifecycle_operation_id: 'operation-1',
    ...overrides,
  };
}

function makeSut() {
  const handlers: Record<string, (message: any) => Promise<void>> = {};
  const kafkaConsumer: {
    on: jest.Mock;
    unsubscribe: jest.Mock;
    disconnect: jest.Mock;
  } = {
    on: jest.fn(),
    unsubscribe: jest.fn(),
    disconnect: jest.fn(),
  };
  kafkaConsumer.on = jest.fn(
    (event: string, handler: (message: any) => Promise<void>) => {
      handlers[event] = handler;
      return kafkaConsumer;
    }
  );
  kafkaConsumer.disconnect = jest.fn((callback: () => void) => callback());
  (createConsumer as jest.Mock).mockReturnValue(kafkaConsumer);

  const kafkaServiceQueueService = {
    workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
    getNumPartitions: jest.fn(() => 30),
    getReplicationFactor: jest.fn(() => 3),
  };
  const workerGrpcClientService = {
    createWorker: jest.fn(async () => undefined),
    recreateWorker: jest.fn(async () => undefined),
    cleanupWorker: jest.fn(async () => undefined),
    activateWarmWorker: jest.fn(async () => undefined),
    deleteWarmWorker: jest.fn(async () => undefined),
  };
  const workerService = {
    viewWorkerForMonitor: jest.fn(async () => currentWorker()),
  };
  const workerWarmPoolQueueService = {
    publishReplenish: jest.fn(async () => undefined),
  };
  const workerWarmPoolSettingsService = {
    view: jest.fn(async () => ({
      warmup_enabled: true,
    })),
  };
  const connectionLifecycleDebugService = {
    log: jest.fn(async () => undefined),
  };
  const workerRecreateServerSlotService = {
    releaseReservedSlot: jest.fn(async () => undefined),
  };
  const server = {
    log: {
      error: jest.fn(),
    },
  };
  const sut = new WorkerLifecycleConsume(
    {} as never,
    kafkaServiceQueueService as never,
    workerGrpcClientService as never,
    workerService as never,
    workerWarmPoolQueueService as never,
    workerWarmPoolSettingsService as never,
    connectionLifecycleDebugService as never,
    workerRecreateServerSlotService as never
  );

  return {
    handlers,
    kafkaConsumer,
    kafkaServiceQueueService,
    server,
    sut,
    workerGrpcClientService,
    workerService,
    workerWarmPoolQueueService,
    workerWarmPoolSettingsService,
    workerRecreateServerSlotService,
  };
}

describe('WorkerLifecycleConsume', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('dispatches valid create messages and commits after processing', async () => {
    const deps = makeSut();

    await deps.sut.execute(deps.server as never);
    deps.handlers.data({
      value: Buffer.from(JSON.stringify(lifecyclePayload())),
      partition: 2,
      offset: 7,
    });
    await flushPromises();
    await deps.sut.close();

    expect(deps.workerService.viewWorkerForMonitor).toHaveBeenCalledWith(
      'worker-1'
    );
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

  it('commits stale lifecycle messages without dispatching runtime work', async () => {
    const deps = makeSut();
    deps.workerService.viewWorkerForMonitor.mockResolvedValueOnce(
      currentWorker({ lifecycle_operation_id: 'operation-new' })
    );

    await deps.sut.execute(deps.server as never);
    deps.handlers.data({
      value: Buffer.from(JSON.stringify(lifecyclePayload())),
      partition: 1,
      offset: 3,
    });
    await flushPromises();
    await deps.sut.close();

    expect(deps.workerGrpcClientService.createWorker).not.toHaveBeenCalled();
    expect(deps.workerGrpcClientService.recreateWorker).not.toHaveBeenCalled();
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
  });

  it('releases a reserved recreate slot when the lifecycle message is stale', async () => {
    const deps = makeSut();
    deps.workerService.viewWorkerForMonitor.mockResolvedValueOnce(
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
          })
        )
      ),
      partition: 1,
      offset: 3,
    });
    await flushPromises();
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
          })
        )
      ),
      partition: 1,
      offset: 5,
    });
    await flushPromises();
    await deps.sut.close();

    expect(deps.workerGrpcClientService.recreateWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        action: EWorkerAction.recreate,
        recreate_server_slot_key: 'worker:recreate:server:server-1:slot:0',
        recreate_server_slot_token: 'worker-1:slot-token',
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

  it('falls back to clean create preserving worker_id when warm activation fails', async () => {
    const deps = makeSut();
    deps.workerGrpcClientService.activateWarmWorker.mockRejectedValueOnce(
      new Error('warm container failed')
    );

    await deps.sut.execute(deps.server as never);
    deps.handlers.data({
      value: Buffer.from(
        JSON.stringify(
          lifecyclePayload({
            action: 'activate_warm',
            warm_pool_id: 'warm-1',
            source: 'worker_update',
            worker_status_id: EWorkerStatus.recreating,
          })
        )
      ),
      partition: 4,
      offset: 9,
    });
    await flushPromises();
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
      120_000
    );
    expect(deps.workerGrpcClientService.deleteWarmWorker).toHaveBeenCalledWith(
      'server-1',
      expect.objectContaining({
        warm_pool_id: 'warm-1',
        remove_volume: true,
      }),
      60_000
    );
    expect(deps.workerWarmPoolQueueService.publishReplenish).toHaveBeenCalled();
    expect(deps.workerGrpcClientService.createWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        action: EWorkerAction.create,
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        lifecycle_operation_id: 'operation-1',
      })
    );
    expect(commitOffset).toHaveBeenCalledWith(
      deps.kafkaConsumer,
      'worker.lifecycle.request',
      4,
      9
    );
  });
});
