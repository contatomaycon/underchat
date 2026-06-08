import 'reflect-metadata';
import { EServerStatus } from '@core/common/enums/EServerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { WorkerUpdaterUseCase } from '@core/useCases/worker/WorkerUpdater.useCase';

jest.mock('uuid', () => ({
  v7: jest.fn(() => 'operation-1'),
}));

jest.mock('@core/services/worker.service', () => ({
  WorkerService: class WorkerService {},
}));
jest.mock('@core/services/account.service', () => ({
  AccountService: class AccountService {},
}));
jest.mock('@core/services/workerGrpcClient.service', () => ({
  WorkerGrpcClientService: class WorkerGrpcClientService {},
}));
jest.mock('@core/useCases/worker/WorkerRecreator.useCase', () => ({
  WorkerRecreatorUseCase: class WorkerRecreatorUseCase {},
}));
jest.mock('@core/services/workerConfig.service', () => ({
  WorkerConfigService: class WorkerConfigService {},
}));
jest.mock('@core/services/workerLifecycleQueue.service', () => ({
  WorkerLifecycleQueueService: class WorkerLifecycleQueueService {},
}));
jest.mock('@core/services/workerWarmPoolQueue.service', () => ({
  WorkerWarmPoolQueueService: class WorkerWarmPoolQueueService {},
}));
jest.mock('@core/services/centrifugo.service', () => ({
  CentrifugoService: class CentrifugoService {},
}));

const t = ((key: string) => key) as never;

describe('WorkerUpdaterUseCase lifecycle fencing', () => {
  it('resets session volume when only the worker type changes', async () => {
    const workerService = {
      viewWorkerType: jest.fn(async () => ({
        worker_type_id: EWorkerType.baileys,
      })),
      viewWorkerBalancer: jest.fn(async () => ({
        server_id: 'server-1',
        server_status_id: EServerStatus.online,
      })),
      viewWorker: jest.fn(async () => ({
        status: { id: EWorkerStatus.disponible },
      })),
      listWorkerServers: jest.fn(async () => []),
      updateWorkerById: jest.fn(async () => true),
    };
    const accountService = {
      existsAccountById: jest.fn(async () => true),
    };
    const workerGrpcClientService = {
      cleanupWorker: jest.fn(async () => undefined),
      changeConnectionStatus: jest.fn(async () => undefined),
    };
    const workerRecreatorUseCase = {
      execute: jest.fn(async () => true),
    };
    const workerConfigService = {
      refreshTypingSimulationCache: jest.fn(async () => undefined),
    };
    const workerWarmPoolSettingsService = {
      view: jest.fn(async () => ({
        reservation_ttl_seconds: 90,
      })),
    };
    const workerWarmPoolRepository = {
      releaseExpiredReservations: jest.fn(async () => 0),
      reserveReady: jest.fn(async () => null),
    };
    const workerRuntimeRepository = {
      viewByWorkerId: jest.fn(async () => null),
    };
    const workerLifecycleQueueService = {
      publish: jest.fn(async () => undefined),
    };
    const workerWarmPoolQueueService = {
      publishReplenish: jest.fn(async () => undefined),
    };
    const centrifugoService = {
      publishSub: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const useCase = new WorkerUpdaterUseCase(
      workerService as never,
      accountService as never,
      workerConfigService as never,
      workerWarmPoolSettingsService as never,
      workerWarmPoolRepository as never,
      workerLifecycleQueueService as never,
      workerWarmPoolQueueService as never,
      centrifugoService as never
    );

    await expect(
      useCase.execute(t, 'account-1', {
        worker_id: 'worker-1',
        name: 'Worker 1',
        worker_type: EWorkerType.wwebjs,
      } as never)
    ).resolves.toMatchObject({
      code: 202,
      queued: true,
      worker_id: 'worker-1',
      worker_status_id: EWorkerStatus.recreating,
      operation_id: 'operation-1',
    });

    expect(workerGrpcClientService.cleanupWorker).not.toHaveBeenCalled();
    expect(workerRecreatorUseCase.execute).not.toHaveBeenCalled();
    expect(workerService.updateWorkerById).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_type_id: EWorkerType.wwebjs,
        worker_status_id: EWorkerStatus.recreating,
        lifecycle_operation_id: 'operation-1',
        number: null,
        connection_date: null,
      })
    );
    expect(workerLifecycleQueueService.publish).toHaveBeenCalledTimes(1);
    expect(workerLifecycleQueueService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'recreate',
        worker_id: 'worker-1',
        remove_session: true,
        remove_volume: true,
        operation_id: 'operation-1',
        previous_worker_status_id: EWorkerStatus.disponible,
      })
    );
  });

  it('uses one lifecycle operation id for old-server cleanup and new-server recreate', async () => {
    const workerService = {
      viewWorkerType: jest.fn(async () => ({
        worker_type_id: EWorkerType.wwebjs,
      })),
      viewWorkerBalancer: jest.fn(async () => ({
        server_id: 'server-old',
        server_status_id: EServerStatus.online,
      })),
      viewWorker: jest.fn(async () => ({
        status: { id: EWorkerStatus.online },
      })),
      listWorkerServers: jest.fn(async () => [{ server_id: 'server-new' }]),
      updateWorkerById: jest.fn(async () => true),
    };
    const accountService = {
      existsAccountById: jest.fn(async () => true),
    };
    const workerGrpcClientService = {
      cleanupWorker: jest.fn(async () => undefined),
      changeConnectionStatus: jest.fn(async () => undefined),
    };
    const workerRecreatorUseCase = {
      execute: jest.fn(async () => true),
    };
    const workerConfigService = {
      refreshTypingSimulationCache: jest.fn(async () => undefined),
    };
    const workerWarmPoolSettingsService = {
      view: jest.fn(async () => ({
        reservation_ttl_seconds: 90,
      })),
    };
    const workerWarmPoolRepository = {
      releaseExpiredReservations: jest.fn(async () => 0),
      reserveReady: jest.fn(async () => null),
    };
    const workerRuntimeRepository = {
      viewByWorkerId: jest.fn(async () => null),
    };
    const workerLifecycleQueueService = {
      publish: jest.fn(async () => undefined),
    };
    const workerWarmPoolQueueService = {
      publishReplenish: jest.fn(async () => undefined),
    };
    const centrifugoService = {
      publishSub: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const useCase = new WorkerUpdaterUseCase(
      workerService as never,
      accountService as never,
      workerConfigService as never,
      workerWarmPoolSettingsService as never,
      workerWarmPoolRepository as never,
      workerLifecycleQueueService as never,
      workerWarmPoolQueueService as never,
      centrifugoService as never
    );

    await expect(
      useCase.execute(t, 'account-1', {
        worker_id: 'worker-1',
        name: 'Worker 1',
        worker_type: EWorkerType.whatsmeow,
        server_id: 'server-new',
      } as never)
    ).resolves.toMatchObject({
      code: 202,
      queued: true,
      worker_id: 'worker-1',
      worker_status_id: EWorkerStatus.recreating,
      operation_id: 'operation-1',
    });

    expect(workerService.updateWorkerById).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_type_id: EWorkerType.whatsmeow,
        server_id: 'server-new',
        worker_status_id: EWorkerStatus.recreating,
        lifecycle_operation_id: 'operation-1',
        number: null,
        connection_date: null,
      })
    );
    expect(workerGrpcClientService.cleanupWorker).not.toHaveBeenCalled();
    expect(workerRecreatorUseCase.execute).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.publish).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: 'cleanup_previous_runtime',
        worker_id: 'worker-1',
        server_id: 'server-old',
        account_id: 'account-1',
        operation_id: 'operation-1',
      })
    );
    expect(workerLifecycleQueueService.publish).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: 'recreate',
        worker_id: 'worker-1',
        server_id: 'server-new',
        account_id: 'account-1',
        remove_session: true,
        remove_volume: true,
        operation_id: 'operation-1',
        previous_worker_status_id: EWorkerStatus.online,
      })
    );
  });

  it('does not enqueue cleanup when same-server type change uses a warm runtime', async () => {
    const workerService = {
      viewWorkerType: jest.fn(async () => ({
        worker_type_id: EWorkerType.baileys,
      })),
      viewWorkerBalancer: jest.fn(async () => ({
        server_id: 'server-1',
        server_status_id: EServerStatus.online,
      })),
      viewWorker: jest.fn(async () => ({
        status: { id: EWorkerStatus.disponible },
      })),
      listWorkerServers: jest.fn(async () => []),
      updateWorkerById: jest.fn(async () => true),
    };
    const accountService = {
      existsAccountById: jest.fn(async () => true),
    };
    const workerConfigService = {
      refreshTypingSimulationCache: jest.fn(async () => undefined),
    };
    const workerWarmPoolSettingsService = {
      view: jest.fn(async () => ({
        reservation_ttl_seconds: 90,
        warmup_enabled: true,
      })),
    };
    const workerWarmPoolRepository = {
      releaseExpiredReservations: jest.fn(async () => 0),
      reserveReady: jest.fn(async () => ({
        warm_pool_id: 'warm-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        container_id: 'warm-container',
        container_name: 'warm-warm-1',
        session_volume_name: 'warm-warm-1',
      })),
    };
    const workerLifecycleQueueService = {
      publish: jest.fn(async () => undefined),
    };
    const workerWarmPoolQueueService = {
      publishReplenish: jest.fn(async () => undefined),
    };
    const centrifugoService = {
      publishSub: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const useCase = new WorkerUpdaterUseCase(
      workerService as never,
      accountService as never,
      workerConfigService as never,
      workerWarmPoolSettingsService as never,
      workerWarmPoolRepository as never,
      workerLifecycleQueueService as never,
      workerWarmPoolQueueService as never,
      centrifugoService as never
    );

    await useCase.execute(t, 'account-1', {
      worker_id: 'worker-1',
      name: 'Worker 1',
      worker_type: EWorkerType.wwebjs,
    } as never);

    expect(workerService.updateWorkerById).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_type_id: EWorkerType.wwebjs,
        worker_status_id: EWorkerStatus.recreating,
        lifecycle_operation_id: 'operation-1',
        number: null,
        connection_date: null,
      })
    );
    expect(workerLifecycleQueueService.publish).toHaveBeenCalledTimes(1);
    expect(workerLifecycleQueueService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'activate_warm',
        worker_id: 'worker-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        previous_server_id: 'server-1',
        previous_worker_type_id: EWorkerType.baileys,
        remove_session: true,
        remove_volume: true,
        warm_pool_id: 'warm-1',
      })
    );
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'cleanup_previous_runtime',
      })
    );
  });
});
