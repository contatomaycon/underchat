import 'reflect-metadata';
import { WorkerDeleterUseCase } from '@core/useCases/worker/WorkerDeleter.useCase';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';

const t = ((key: string) => key) as never;

const buildUseCase = (overrides: Record<string, unknown> = {}) => {
  const workerService = {
    existsWorkerById: jest.fn(async () => true),
    viewWorker: jest.fn(async () => ({
      id: 'worker-1',
      name: 'Channel',
      type: { id: EWorkerType.wwebjs },
    })),
    viewWorkerBalancer: jest.fn(async () => ({
      server_id: 'server-1',
      account_id: 'account-1',
    })),
    deleteWorkerById: jest.fn(async () => true),
    ...(overrides.workerService as Record<string, unknown> | undefined),
  };
  const centrifugoService = {
    publishSub: jest.fn(async () => ({})),
    ...(overrides.centrifugoService as Record<string, unknown> | undefined),
  };
  const workerGrpcClientService = {
    deleteWorker: jest.fn(async () => undefined),
    ...(overrides.workerGrpcClientService as
      Record<string, unknown> | undefined),
  };
  const workerWhatsappOfficialConnectionRepository = {
    softDeleteByWorkerId: jest.fn(async () => true),
    ...(overrides.workerWhatsappOfficialConnectionRepository as
      Record<string, unknown> | undefined),
  };

  const useCase = new WorkerDeleterUseCase(
    workerService as never,
    centrifugoService as never,
    workerGrpcClientService as never,
    workerWhatsappOfficialConnectionRepository as never
  );

  return {
    useCase,
    deps: {
      workerService,
      centrifugoService,
      workerGrpcClientService,
      workerWhatsappOfficialConnectionRepository,
    },
  };
};

describe('WorkerDeleterUseCase', () => {
  it('deletes official whatsapp worker without balancer or gRPC runtime', async () => {
    const { useCase, deps } = buildUseCase({
      workerService: {
        viewWorker: jest.fn(async () => ({
          id: 'worker-1',
          name: 'Official',
          type: { id: EWorkerType.whatsapp },
        })),
      },
    });

    await expect(useCase.execute(t, 'account-1', 'worker-1')).resolves.toBe(
      true
    );

    expect(deps.workerService.viewWorkerBalancer).not.toHaveBeenCalled();
    expect(deps.workerService.deleteWorkerById).toHaveBeenCalledWith(
      'account-1',
      'worker-1'
    );
    expect(
      deps.workerWhatsappOfficialConnectionRepository.softDeleteByWorkerId
    ).toHaveBeenCalledWith('worker-1');
    expect(deps.workerGrpcClientService.deleteWorker).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      'worker:account#account-1',
      expect.objectContaining({
        code: ECodeMessage.info,
        status: EBaileysConnectionStatus.info,
        worker_id: 'worker-1',
        worker_name: 'Official',
        account_id: 'account-1',
        worker_type_id: EWorkerType.whatsapp,
        worker_status_id: EWorkerStatus.delete,
      })
    );
  });

  it('keeps non-official worker deletion on runtime path', async () => {
    const { useCase, deps } = buildUseCase();

    await expect(useCase.execute(t, 'account-1', 'worker-1')).resolves.toBe(
      true
    );

    expect(deps.workerService.viewWorkerBalancer).toHaveBeenCalledWith(
      'account-1',
      'worker-1'
    );
    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      'worker:account#account-1',
      expect.objectContaining({
        action: EWorkerAction.delete,
        worker_id: 'worker-1',
        server_id: 'server-1',
        account_id: 'account-1',
      })
    );
    expect(deps.workerGrpcClientService.deleteWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        action: EWorkerAction.delete,
        worker_id: 'worker-1',
        server_id: 'server-1',
        account_id: 'account-1',
      })
    );
  });
});
