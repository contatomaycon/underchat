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

jest.mock('@core/repositories/worker/WorkerWarmPool.repository', () => ({
  WorkerWarmPoolRepository: class WorkerWarmPoolRepository {},
}));

import { WorkerWarmDeleteConsume } from '@core/consumer/worker/WorkerWarmDelete.consume';
import { commitOffset } from '@core/common/functions/commitOffset';
import { createConsumer } from '@core/common/functions/createConsumer';

const { setImmediate: scheduleRealImmediate } =
  jest.requireActual<typeof import('node:timers')>('node:timers');

async function waitForCommit(partition: number, offset: number): Promise<void> {
  for (let turn = 0; turn < 50; turn += 1) {
    if (
      (commitOffset as jest.Mock).mock.calls.some(
        (call) => call[2] === partition && call[3] === offset
      )
    ) {
      return;
    }
    await new Promise<void>((resolve) => scheduleRealImmediate(resolve));
  }

  throw new Error(
    `Timed out waiting for Kafka commit for partition ${partition} offset ${offset}`
  );
}

describe('WorkerWarmDeleteConsume', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function makeSut(
    decision:
      | 'dispatch'
      | 'missing'
      | 'deferred_server_unavailable'
      | 'protected_runtime'
      | 'server_mismatch'
      | 'state_not_deletable' = 'dispatch'
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
        (_topic: string, _partition: number, epoch: number) => epoch === 1
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
      workerWarmDeleteRequest: jest.fn(() => 'worker.warm.delete.request'),
    };
    const workerGrpcClientService = {
      deleteWarmWorker: jest.fn(async () => undefined),
    };
    const workerWarmPoolRepository = {
      prepareDeleteDispatch: jest.fn(async () =>
        decision === 'dispatch'
          ? {
              decision,
              target: {
                warm_pool_id: 'warm-1',
                server_id: 'server-1',
                worker_type_id: 'type-1',
                session_storage: 'legacy_volume',
                container_id: 'container-1',
                container_name: 'warm-warm-1',
                session_volume_name: 'warm-warm-1',
              },
            }
          : { decision, target: null }
      ),
      recordDeleteRetryFailure: jest.fn(async () => true),
      reconcileDeletingRuntimeLineage: jest.fn(async () => true),
    };
    const sut = new WorkerWarmDeleteConsume(
      kafka as never,
      kafkaServiceQueueService as never,
      workerGrpcClientService as never,
      workerWarmPoolRepository as never
    );

    const payload = {
      request_id: 'request-1',
      warm_pool_id: 'warm-1',
      server_id: 'server-1',
      worker_type_id: 'type-1',
      container_id: 'container-1',
      container_name: 'warm-warm-1',
      session_volume_name: 'warm-warm-1',
      remove_volume: true,
      reason: 'pool_reconcile',
      requested_at: '2026-07-17T12:00:00.000Z',
    };

    return {
      handlers,
      kafkaConsumer,
      payload,
      sut,
      workerGrpcClientService,
      workerWarmPoolRepository,
    };
  }

  async function emitDelete(
    deps: ReturnType<typeof makeSut>,
    offset = 4
  ): Promise<void> {
    await deps.sut.execute();
    deps.handlers.data({
      value: Buffer.from(JSON.stringify(deps.payload)),
      partition: 2,
      offset,
      consumerAssignmentEpoch: 1,
    });
    await waitForCommit(2, offset);
  }

  it.each([
    'missing',
    'deferred_server_unavailable',
    'server_mismatch',
    'state_not_deletable',
  ] as const)(
    'commits stale decision %s without calling the dead gRPC endpoint',
    async (decision) => {
      const deps = makeSut(decision);

      await emitDelete(deps);

      expect(
        deps.workerWarmPoolRepository.prepareDeleteDispatch
      ).toHaveBeenCalledWith({
        warmPoolId: 'warm-1',
        serverId: 'server-1',
      });
      expect(
        deps.workerGrpcClientService.deleteWarmWorker
      ).not.toHaveBeenCalled();
      expect(commitOffset).toHaveBeenCalledWith(
        deps.kafkaConsumer,
        'worker.warm.delete.request',
        2,
        4
      );
    }
  );

  it('reconciles a protected runtime tombstone to assigned metadata before committing', async () => {
    const deps = makeSut('protected_runtime');

    await emitDelete(deps);

    expect(
      deps.workerWarmPoolRepository.reconcileDeletingRuntimeLineage
    ).toHaveBeenCalledWith('warm-1');
    expect(
      deps.workerGrpcClientService.deleteWarmWorker
    ).not.toHaveBeenCalled();
    expect(commitOffset).toHaveBeenCalledWith(
      deps.kafkaConsumer,
      'worker.warm.delete.request',
      2,
      4
    );
  });

  it('dispatches an active-server deletion only after the database fence', async () => {
    const deps = makeSut('dispatch');

    await emitDelete(deps);

    expect(
      deps.workerWarmPoolRepository.prepareDeleteDispatch
    ).toHaveBeenCalledTimes(1);
    expect(deps.workerGrpcClientService.deleteWarmWorker).toHaveBeenCalledWith(
      'server-1',
      expect.objectContaining({
        request_id: 'request-1',
        warm_pool_id: 'warm-1',
        container_name: 'warm-warm-1',
        remove_volume: true,
      }),
      300_000
    );
    expect(
      deps.workerWarmPoolRepository.recordDeleteRetryFailure
    ).not.toHaveBeenCalled();
    expect(commitOffset).toHaveBeenCalledWith(
      deps.kafkaConsumer,
      'worker.warm.delete.request',
      2,
      4
    );
  });

  it('uses the canonical locked database target instead of stale Kafka physical fields', async () => {
    const deps = makeSut('dispatch');
    Object.assign(deps.payload, {
      server_id: 'stale-server',
      worker_type_id: 'stale-type',
      container_id: 'stale-container',
      container_name: 'stale-container-name',
      session_volume_name: 'stale-volume',
    });

    await emitDelete(deps);

    expect(
      deps.workerWarmPoolRepository.prepareDeleteDispatch
    ).toHaveBeenCalledWith({
      warmPoolId: 'warm-1',
      serverId: 'stale-server',
    });
    expect(deps.workerGrpcClientService.deleteWarmWorker).toHaveBeenCalledWith(
      'server-1',
      expect.objectContaining({
        server_id: 'server-1',
        warm_pool_id: 'warm-1',
        worker_type_id: 'type-1',
        container_id: 'container-1',
        container_name: 'warm-warm-1',
        session_volume_name: 'warm-warm-1',
      }),
      300_000
    );
    const [, grpcPayload] = (
      deps.workerGrpcClientService.deleteWarmWorker as jest.Mock
    ).mock.calls[0];
    expect(grpcPayload).not.toEqual(
      expect.objectContaining({
        container_name: 'stale-container-name',
      })
    );
  });

  it('asserts the active Kafka context immediately before the external gRPC effect', async () => {
    const deps = makeSut('dispatch');
    const revoked = new Error('dispatch_revoked');
    const context = {
      assertActive: jest.fn(() => {
        throw revoked;
      }),
    };

    await expect(
      (
        deps.sut as unknown as {
          deleteWarmWorker: (
            payload: typeof deps.payload,
            lockContext: { assertActive: () => void }
          ) => Promise<void>;
        }
      ).deleteWarmWorker(deps.payload, context)
    ).rejects.toBe(revoked);

    expect(context.assertActive).toHaveBeenCalledTimes(1);
    expect(
      deps.workerGrpcClientService.deleteWarmWorker
    ).not.toHaveBeenCalled();
  });

  it('parks a gRPC deadline in the deleting tombstone and commits without a retry storm', async () => {
    const deps = makeSut('dispatch');
    const consoleWarn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    deps.workerGrpcClientService.deleteWarmWorker.mockRejectedValue({
      code: 4,
      details: 'Deadline exceeded after 10.000s,Waiting for LB pick',
    });

    await emitDelete(deps);

    expect(deps.workerGrpcClientService.deleteWarmWorker).toHaveBeenCalledTimes(
      1
    );
    expect(
      deps.workerWarmPoolRepository.recordDeleteRetryFailure
    ).toHaveBeenCalledWith(
      'warm-1',
      expect.stringContaining('warm_delete_grpc_deferred code=4')
    );
    expect(consoleWarn).toHaveBeenCalledWith(
      'Warm worker deletion deferred for durable redrive',
      expect.objectContaining({
        warm_pool_id: 'warm-1',
        parked: true,
        error_code: 4,
        error_message: 'Deadline exceeded after 10.000s,Waiting for LB pick',
      })
    );
    expect(commitOffset).toHaveBeenCalledWith(
      deps.kafkaConsumer,
      'worker.warm.delete.request',
      2,
      4
    );
    consoleWarn.mockRestore();
  });

  it('redrives a previously parked delete successfully after gRPC recovers', async () => {
    const deps = makeSut('dispatch');
    const consoleWarn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    deps.workerGrpcClientService.deleteWarmWorker
      .mockRejectedValueOnce({ code: 4, details: 'Deadline exceeded' })
      .mockRejectedValueOnce({ code: 14, details: 'Balance unavailable' })
      .mockResolvedValueOnce(undefined);

    await emitDelete(deps, 4);
    await emitDelete(deps, 5);
    await emitDelete(deps, 6);

    expect(deps.workerGrpcClientService.deleteWarmWorker).toHaveBeenCalledTimes(
      3
    );
    expect(
      deps.workerWarmPoolRepository.recordDeleteRetryFailure
    ).toHaveBeenCalledTimes(2);
    expect(commitOffset).toHaveBeenCalledWith(
      deps.kafkaConsumer,
      'worker.warm.delete.request',
      2,
      6
    );
    consoleWarn.mockRestore();
  });
});
