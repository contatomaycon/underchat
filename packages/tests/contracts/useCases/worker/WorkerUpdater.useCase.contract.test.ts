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
    const useCase = new WorkerUpdaterUseCase(
      workerService as never,
      accountService as never,
      workerGrpcClientService as never,
      workerRecreatorUseCase as never,
      workerConfigService as never,
      workerWarmPoolSettingsService as never,
      workerWarmPoolRepository as never,
      workerRuntimeRepository as never
    );

    await expect(
      useCase.execute(t, 'account-1', {
        worker_id: 'worker-1',
        name: 'Worker 1',
        worker_type: EWorkerType.wwebjs,
      } as never)
    ).resolves.toBe(true);

    expect(workerGrpcClientService.cleanupWorker).not.toHaveBeenCalled();
    expect(workerRecreatorUseCase.execute).toHaveBeenCalledWith(
      t,
      'account-1',
      'worker-1',
      expect.objectContaining({
        remove_session: true,
        remove_volume: true,
        lifecycle_operation_id: 'operation-1',
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
    const useCase = new WorkerUpdaterUseCase(
      workerService as never,
      accountService as never,
      workerGrpcClientService as never,
      workerRecreatorUseCase as never,
      workerConfigService as never,
      workerWarmPoolSettingsService as never,
      workerWarmPoolRepository as never,
      workerRuntimeRepository as never
    );

    await expect(
      useCase.execute(t, 'account-1', {
        worker_id: 'worker-1',
        name: 'Worker 1',
        worker_type: EWorkerType.whatsmeow,
        server_id: 'server-new',
      } as never)
    ).resolves.toBe(true);

    expect(workerService.updateWorkerById).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_type_id: EWorkerType.whatsmeow,
        server_id: 'server-new',
        worker_status_id: EWorkerStatus.recreating,
        lifecycle_operation_id: 'operation-1',
      })
    );
    expect(workerGrpcClientService.cleanupWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'cleanup',
        worker_id: 'worker-1',
        server_id: 'server-old',
        account_id: 'account-1',
        lifecycle_operation_id: 'operation-1',
      })
    );
    expect(workerRecreatorUseCase.execute).toHaveBeenCalledWith(
      t,
      'account-1',
      'worker-1',
      expect.objectContaining({
        remove_session: true,
        remove_volume: true,
        lifecycle_operation_id: 'operation-1',
        previous_worker_status_id: EWorkerStatus.online,
      })
    );
  });
});
