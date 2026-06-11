import 'reflect-metadata';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';
import { WorkerRecreateCooldownError } from '@core/common/exceptions/WorkerRecreateCooldownError';

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
      recreate_available_at: '2026-06-11T12:01:00.000Z',
    })),
    updateWorkerById: jest.fn(async () => true),
    updateWorkerByIdIfRecreateAvailable: jest.fn(async () => true),
  };
  const accountService = {
    existsAccountById: jest.fn(async () => true),
  };
  const centrifugoService = {
    publishSub: jest.fn(async () => undefined),
    publish: jest.fn(async () => undefined),
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

const flushPromises = async (): Promise<void> => {
  await new Promise((resolve) => setImmediate(resolve));
};

describe('WorkerRecreatorUseCase', () => {
  it('returns ack after enqueueing lifecycle and schedules recreating status', async () => {
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
    expect(
      workerLifecycleQueueService.publish.mock.invocationCallOrder[0]
    ).toBeLessThan(centrifugoService.publishSub.mock.invocationCallOrder[0]);
  });

  it('does not wait for a slow recreating status publish before returning ack', async () => {
    const { sut, centrifugoService, workerLifecycleQueueService } = makeSut();
    let resolvePublish!: () => void;
    centrifugoService.publishSub.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          resolvePublish = () => resolve(undefined);
        })
    );

    await expect(
      sut.execute(t, 'account-1', 'worker-1', {
        previous_worker_status_id: EWorkerStatus.online,
      })
    ).resolves.toMatchObject({
      code: 202,
      queued: true,
      worker_id: 'worker-1',
    });

    expect(workerLifecycleQueueService.publish).toHaveBeenCalled();
    expect(centrifugoService.publishSub).toHaveBeenCalledWith(
      workerCentrifugoQueue('account-1'),
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.recreating,
      })
    );

    resolvePublish();
    await flushPromises();
  });

  it('publishes logout before recreating when session cleanup is requested', async () => {
    const {
      sut,
      workerService,
      centrifugoService,
      workerLifecycleQueueService,
    } = makeSut();

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
    expect(
      workerService.updateWorkerByIdIfRecreateAvailable
    ).not.toHaveBeenCalled();
  });

  it('updates worker with recreate cooldown guard when requested', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-11T12:00:00.000Z'));

    try {
      const { sut, workerService } = makeSut();

      await expect(
        sut.execute(t, 'account-1', 'worker-1', {
          enforce_recreate_cooldown: true,
        })
      ).resolves.toMatchObject({
        recreate_available_at: '2026-06-11T12:02:00.000Z',
      });

      expect(
        workerService.updateWorkerByIdIfRecreateAvailable
      ).toHaveBeenCalledWith(
        'account-1',
        expect.objectContaining({
          worker_id: 'worker-1',
          worker_status_id: EWorkerStatus.recreating,
          recreate_available_at: '2026-06-11T12:02:00.000Z',
        }),
        '2026-06-11T12:00:00.000Z'
      );
      expect(workerService.updateWorkerById).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('blocks recreate when cooldown guard does not update the worker', async () => {
    const {
      sut,
      workerService,
      centrifugoService,
      workerLifecycleQueueService,
    } = makeSut();
    workerService.updateWorkerByIdIfRecreateAvailable.mockResolvedValue(false);

    await expect(
      sut.execute(t, 'account-1', 'worker-1', {
        enforce_recreate_cooldown: true,
      })
    ).rejects.toBeInstanceOf(WorkerRecreateCooldownError);

    expect(centrifugoService.publishSub).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
  });
});
