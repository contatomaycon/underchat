import 'reflect-metadata';

jest.mock('@core/services/worker.service', () => ({
  WorkerService: class {},
}));
jest.mock('@core/services/account.service', () => ({
  AccountService: class {},
}));
jest.mock('@core/services/config.service', () => ({
  ConfigService: class {},
}));
jest.mock('@core/services/centrifugo.service', () => ({
  CentrifugoService: class {},
}));
jest.mock('@core/services/workerGrpcClient.service', () => ({
  WorkerGrpcClientService: class {},
}));

import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { ChannelRecreatorUseCase } from '@core/useCases/config/ChannelRecreator.useCase';

describe('ChannelRecreatorUseCase', () => {
  it('throws when worker balancer is not found', async () => {
    const workerService = { updateWorkerById: jest.fn() };
    const accountService = { existsAccountById: jest.fn() };
    const configService = { viewChannelBalancer: jest.fn(async () => null) };
    const centrifugoService = { publishSub: jest.fn(), publish: jest.fn() };
    const workerGrpcClientService = { recreateWorker: jest.fn() };
    const useCase = new ChannelRecreatorUseCase(
      workerService as never,
      accountService as never,
      configService as never,
      centrifugoService as never,
      workerGrpcClientService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'worker-1')).rejects.toThrow(
      'worker_not_found'
    );
  });

  it('throws when account does not exist', async () => {
    const workerService = { updateWorkerById: jest.fn() };
    const accountService = { existsAccountById: jest.fn(async () => false) };
    const configService = {
      viewChannelBalancer: jest.fn(async () => ({
        account_id: 'acc-1',
        server_id: 'srv-1',
      })),
    };
    const centrifugoService = { publishSub: jest.fn(), publish: jest.fn() };
    const workerGrpcClientService = { recreateWorker: jest.fn() };
    const useCase = new ChannelRecreatorUseCase(
      workerService as never,
      accountService as never,
      configService as never,
      centrifugoService as never,
      workerGrpcClientService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'worker-1')).rejects.toThrow(
      'account_not_found'
    );
    expect(workerService.updateWorkerById).not.toHaveBeenCalled();
  });

  it('throws grpc_error when recreate grpc call fails', async () => {
    const workerService = { updateWorkerById: jest.fn(async () => true) };
    const accountService = { existsAccountById: jest.fn(async () => true) };
    const configService = {
      viewChannelBalancer: jest.fn(async () => ({
        account_id: 'acc-1',
        server_id: 'srv-1',
      })),
    };
    const centrifugoService = {
      publishSub: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const workerGrpcClientService = {
      recreateWorker: jest.fn(async () => {
        throw new Error('grpc-fail');
      }),
    };
    const useCase = new ChannelRecreatorUseCase(
      workerService as never,
      accountService as never,
      configService as never,
      centrifugoService as never,
      workerGrpcClientService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'worker-1')).rejects.toThrow(
      'grpc_error'
    );
  });

  it('recreates channel successfully', async () => {
    const workerService = { updateWorkerById: jest.fn(async () => true) };
    const accountService = { existsAccountById: jest.fn(async () => true) };
    const configService = {
      viewChannelBalancer: jest.fn(async () => ({
        account_id: 'acc-1',
        server_id: 'srv-1',
      })),
    };
    const centrifugoService = {
      publishSub: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const workerGrpcClientService = {
      recreateWorker: jest.fn(async () => undefined),
    };
    const useCase = new ChannelRecreatorUseCase(
      workerService as never,
      accountService as never,
      configService as never,
      centrifugoService as never,
      workerGrpcClientService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'worker-1')).resolves.toBe(true);

    const expectedPayload = {
      action: EWorkerAction.recreate,
      worker_id: 'worker-1',
      server_id: 'srv-1',
      account_id: 'acc-1',
      worker_status_id: EWorkerStatus.recreating,
    };
    expect(workerService.updateWorkerById).toHaveBeenCalledWith('acc-1', {
      worker_id: 'worker-1',
      worker_status_id: EWorkerStatus.recreating,
    });
    expect(centrifugoService.publishSub).toHaveBeenCalledWith(
      'worker:account#acc-1',
      expectedPayload
    );
    expect(centrifugoService.publish).toHaveBeenCalledWith(
      'channels:config',
      expectedPayload
    );
    expect(workerGrpcClientService.recreateWorker).toHaveBeenCalledWith(
      expectedPayload
    );
  });
});
