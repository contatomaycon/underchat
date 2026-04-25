import 'reflect-metadata';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';

jest.mock('@core/services/worker.service', () => ({
  WorkerService: class WorkerService {},
}));
jest.mock('@core/services/centrifugo.service', () => ({
  CentrifugoService: class CentrifugoService {},
}));
jest.mock('@core/services/workerGrpcClient.service', () => ({
  WorkerGrpcClientService: class WorkerGrpcClientService {},
}));

import { WorkerChangeStatusConnectionUseCase } from '@core/useCases/worker/WorkerChangeStatusConnection.useCase';

const t = ((key: string) => key) as never;

function makeSut() {
  const workerService = {
    existsWorkerById: jest.fn(async () => true),
    viewWorker: jest.fn(async () => ({ server: { id: 'server-1' } })),
    viewWorkerPhoneConnection: jest.fn(async () => null),
    createWorkerPhoneConnection: jest.fn(async () => undefined),
    updateWorkerPhoneConnection: jest.fn(async () => undefined),
  };
  const centrifugoService = {
    publishSub: jest.fn(async () => undefined),
  };
  const workerGrpcClientService = {
    changeConnectionStatus: jest.fn(async () => undefined),
  };

  const sut = new WorkerChangeStatusConnectionUseCase(
    workerService as never,
    centrifugoService as never,
    workerGrpcClientService as never
  );

  return { sut, workerService, centrifugoService, workerGrpcClientService };
}

describe('WorkerChangeStatusConnectionUseCase', () => {
  it('publishes a starting state before requesting an online connection', async () => {
    const { sut, centrifugoService, workerGrpcClientService } = makeSut();

    await sut.execute(t, 'account-1', {
      worker_id: 'worker-1',
      status: EWorkerStatus.online,
      type: EBaileysConnectionType.qrcode,
    });

    expect(centrifugoService.publishSub).toHaveBeenCalledWith(
      workerCentrifugoQueue('account-1'),
      expect.objectContaining({
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitConnection,
        worker_id: 'worker-1',
        account_id: 'account-1',
      })
    );
    expect(workerGrpcClientService.changeConnectionStatus).toHaveBeenCalled();
  });

  it('publishes a logout state before requesting disconnection', async () => {
    const { sut, centrifugoService, workerGrpcClientService } = makeSut();

    await sut.execute(t, 'account-1', {
      worker_id: 'worker-1',
      status: EWorkerStatus.disponible,
      type: EBaileysConnectionType.qrcode,
      remove_session: true,
    });

    expect(centrifugoService.publishSub).toHaveBeenCalledWith(
      workerCentrifugoQueue('account-1'),
      expect.objectContaining({
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.logoutInProgress,
        worker_id: 'worker-1',
        account_id: 'account-1',
        disconnected_user: true,
      })
    );
    expect(workerGrpcClientService.changeConnectionStatus).toHaveBeenCalled();
  });
});
