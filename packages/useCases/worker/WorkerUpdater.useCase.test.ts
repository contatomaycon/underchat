import 'reflect-metadata';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { EServerStatus } from '@core/common/enums/EServerStatus';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { WorkerUpdaterUseCase } from './WorkerUpdater.useCase';

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

jest.mock('uuid', () => ({
  v7: jest.fn(() => 'uuid-v7'),
}));

const t = ((key: string) => key) as never;

function buildUseCase(
  overrides: {
    currentServerStatusId?: EServerStatus;
    currentServerId?: string;
    nextServerId?: string;
    cleanupError?: unknown;
  } = {}
) {
  const callOrder: string[] = [];
  const currentServerId = overrides.currentServerId ?? 'server-old';
  const nextServerId = overrides.nextServerId ?? 'server-new';

  const workerService = {
    viewWorkerType: jest.fn(async () => ({
      worker_type_id: EWorkerType.wwebjs,
    })),
    viewWorkerBalancer: jest.fn(async () => ({
      server_id: currentServerId,
      server_status_id: overrides.currentServerStatusId ?? EServerStatus.online,
      account_id: 'account-1',
      key: 'key-1',
      web_domain: '10.0.2.21',
      web_port: 3003,
      web_protocol: 'http',
    })),
    listWorkerServers: jest.fn(async () => [
      {
        server_id: nextServerId,
        name: 'Server new',
      },
    ]),
    updateWorkerById: jest.fn(async () => {
      callOrder.push('update');
      return true;
    }),
  };

  const accountService = {
    existsAccountById: jest.fn(async () => true),
  };

  const workerGrpcClientService = {
    cleanupWorker: jest.fn(async () => {
      callOrder.push('cleanup');
      if (overrides.cleanupError) {
        throw overrides.cleanupError;
      }
    }),
    changeConnectionStatus: jest.fn(async () => undefined),
  };

  const workerRecreatorUseCase = {
    execute: jest.fn(async () => {
      callOrder.push('recreate');
      return true;
    }),
  };

  const useCase = new WorkerUpdaterUseCase(
    workerService as never,
    accountService as never,
    workerGrpcClientService as never,
    workerRecreatorUseCase as never
  );

  return {
    useCase,
    callOrder,
    workerService,
    accountService,
    workerGrpcClientService,
    workerRecreatorUseCase,
    currentServerId,
    nextServerId,
  };
}

describe('WorkerUpdaterUseCase', () => {
  it('cleans the previous server before updating and recreating on server change', async () => {
    const deps = buildUseCase();

    await expect(
      deps.useCase.execute(t, 'account-1', {
        worker_id: 'worker-1',
        name: 'Wwebjs',
        server_id: deps.nextServerId,
      })
    ).resolves.toBe(true);

    expect(deps.workerGrpcClientService.cleanupWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        action: EWorkerAction.cleanup,
        worker_id: 'worker-1',
        server_id: deps.currentServerId,
        account_id: 'account-1',
        remove_session: true,
        remove_volume: true,
      })
    );
    expect(deps.workerService.updateWorkerById).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        name: 'Wwebjs',
        server_id: deps.nextServerId,
      })
    );
    expect(deps.workerRecreatorUseCase.execute).toHaveBeenCalledWith(
      t,
      'account-1',
      'worker-1',
      {
        remove_session: true,
        remove_volume: true,
      }
    );
    expect(deps.callOrder).toEqual(['cleanup', 'update', 'recreate']);
  });

  it('aborts without updating when an accessible previous server fails cleanup', async () => {
    const deps = buildUseCase({
      cleanupError: Object.assign(new Error('docker removal failed'), {
        code: GrpcStatus.INTERNAL,
      }),
    });

    await expect(
      deps.useCase.execute(t, 'account-1', {
        worker_id: 'worker-1',
        name: 'Wwebjs',
        server_id: deps.nextServerId,
      })
    ).rejects.toThrow('worker_removal_failed');

    expect(deps.workerService.updateWorkerById).not.toHaveBeenCalled();
    expect(deps.workerRecreatorUseCase.execute).not.toHaveBeenCalled();
    expect(deps.callOrder).toEqual(['cleanup']);
  });

  it('continues the server change when the previous server is marked offline', async () => {
    const deps = buildUseCase({
      currentServerStatusId: EServerStatus.offline,
    });

    await expect(
      deps.useCase.execute(t, 'account-1', {
        worker_id: 'worker-1',
        name: 'Wwebjs',
        server_id: deps.nextServerId,
      })
    ).resolves.toBe(true);

    expect(deps.workerGrpcClientService.cleanupWorker).not.toHaveBeenCalled();
    expect(deps.callOrder).toEqual(['update', 'recreate']);
  });

  it.each([GrpcStatus.UNAVAILABLE, GrpcStatus.DEADLINE_EXCEEDED])(
    'continues the server change when cleanup gRPC returns %s',
    async (code) => {
      const deps = buildUseCase({
        cleanupError: Object.assign(new Error('server unavailable'), { code }),
      });

      await expect(
        deps.useCase.execute(t, 'account-1', {
          worker_id: 'worker-1',
          name: 'Wwebjs',
          server_id: deps.nextServerId,
        })
      ).resolves.toBe(true);

      expect(deps.workerService.updateWorkerById).toHaveBeenCalled();
      expect(deps.workerRecreatorUseCase.execute).toHaveBeenCalled();
      expect(deps.callOrder).toEqual(['cleanup', 'update', 'recreate']);
    }
  );

  it('does not cleanup or recreate when the selected server is unchanged', async () => {
    const deps = buildUseCase({
      nextServerId: 'server-old',
    });

    await expect(
      deps.useCase.execute(t, 'account-1', {
        worker_id: 'worker-1',
        name: 'Wwebjs',
        server_id: 'server-old',
      })
    ).resolves.toBe(true);

    expect(deps.workerGrpcClientService.cleanupWorker).not.toHaveBeenCalled();
    expect(deps.workerRecreatorUseCase.execute).not.toHaveBeenCalled();
    expect(deps.workerService.updateWorkerById).toHaveBeenCalledWith(
      'account-1',
      {
        worker_id: 'worker-1',
        name: 'Wwebjs',
      }
    );
  });
});
