import 'reflect-metadata';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';

jest.mock('uuid', () => ({
  v7: jest.fn(() => 'operation-1'),
}));

jest.mock('@core/services/worker.service', () => ({
  WorkerService: class WorkerService {},
}));
jest.mock('@core/services/account.service', () => ({
  AccountService: class AccountService {},
}));
jest.mock('@core/services/centrifugo.service', () => ({
  CentrifugoService: class CentrifugoService {},
}));
jest.mock('@core/services/workerGrpcClient.service', () => ({
  WorkerGrpcClientService: class WorkerGrpcClientService {},
}));
jest.mock('@core/services/workerLifecycleQueue.service', () => ({
  WorkerLifecycleQueueService: class WorkerLifecycleQueueService {},
}));

import { WorkerRecreatorUseCase } from '@core/useCases/worker/WorkerRecreator.useCase';

const t = ((key: string) => key) as never;

function makeSut() {
  const workerService = {
    viewWorkerBalancer: jest.fn(async () => ({
      server_id: 'server-1',
      account_id: 'account-1',
    })),
    viewWorker: jest.fn(async () => ({
      status: { id: EWorkerStatus.online },
    })),
    updateWorkerById: jest.fn(async () => true),
  };
  const accountService = {
    existsAccountById: jest.fn(async () => true),
  };
  const centrifugoService = {
    publishSub: jest.fn(async () => undefined),
  };
  const workerGrpcClientService = {
    recreateWorker: jest.fn(async () => undefined),
  };
  const workerLifecycleQueueService = {
    publish: jest.fn(async () => undefined),
  };

  const sut = new WorkerRecreatorUseCase(
    workerService as never,
    accountService as never,
    centrifugoService as never,
    workerLifecycleQueueService as never
  );

  return {
    sut,
    workerService,
    centrifugoService,
    workerGrpcClientService,
    workerLifecycleQueueService,
  };
}

describe('WorkerRecreatorUseCase', () => {
  it('returns ack after publishing recreating status and enqueueing lifecycle', async () => {
    const { sut, centrifugoService, workerLifecycleQueueService } = makeSut();

    await expect(
      sut.execute(t, 'account-1', 'worker-1', {
        previous_worker_status_id: EWorkerStatus.online,
      })
    ).resolves.toMatchObject({
      code: 202,
      queued: true,
      worker_id: 'worker-1',
      worker_status_id: EWorkerStatus.recreating,
      operation_id: 'operation-1',
    });

    expect(centrifugoService.publishSub).toHaveBeenCalledWith(
      workerCentrifugoQueue('account-1'),
      expect.objectContaining({
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.recreating,
      })
    );
    expect(workerLifecycleQueueService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        operation_id: 'operation-1',
        previous_worker_status_id: EWorkerStatus.online,
      })
    );
  });

  it('publishes logout before recreating when session cleanup is requested', async () => {
    const { sut, centrifugoService, workerLifecycleQueueService } = makeSut();

    await sut.execute(t, 'account-1', 'worker-1', {
      remove_session: true,
      remove_volume: true,
    });

    expect(centrifugoService.publishSub).toHaveBeenNthCalledWith(
      1,
      workerCentrifugoQueue('account-1'),
      expect.objectContaining({
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.logoutInProgress,
        worker_id: 'worker-1',
        account_id: 'account-1',
        disconnected_user: true,
      })
    );
    expect(centrifugoService.publishSub).toHaveBeenNthCalledWith(
      2,
      workerCentrifugoQueue('account-1'),
      expect.objectContaining({
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.recreating,
        remove_session: true,
        remove_volume: true,
      })
    );
    expect(workerLifecycleQueueService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        remove_session: true,
        remove_volume: true,
      })
    );
  });
});
