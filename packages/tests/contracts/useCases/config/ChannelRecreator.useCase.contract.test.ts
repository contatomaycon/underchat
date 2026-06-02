import 'reflect-metadata';

jest.mock('uuid', () => ({
  v7: jest.fn(() => 'operation-1'),
}));

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

const flushPromises = async (): Promise<void> => {
  await new Promise((resolve) => setImmediate(resolve));
};

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

  it('marks the channel as error when recreate grpc dispatch fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const workerService = {
      viewWorker: jest.fn(async () => ({
        status: { id: EWorkerStatus.online },
      })),
      updateWorkerById: jest.fn(async () => true),
    };
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

    await expect(useCase.execute(t as never, 'worker-1')).resolves.toBe(true);
    await flushPromises();

    expect(workerService.updateWorkerById).toHaveBeenCalledWith('acc-1', {
      worker_id: 'worker-1',
      worker_status_id: EWorkerStatus.error,
    });
    expect(centrifugoService.publish).toHaveBeenCalledWith(
      'channels:config',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.error,
      })
    );

    jest.restoreAllMocks();
  });

  it('recreates channel successfully', async () => {
    const workerService = {
      viewWorker: jest.fn(async () => ({
        status: { id: EWorkerStatus.online },
      })),
      updateWorkerById: jest.fn(async () => true),
    };
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
      lifecycle_operation_id: expect.any(String),
      previous_worker_status_id: EWorkerStatus.online,
    };
    expect(workerService.updateWorkerById).toHaveBeenCalledWith(
      'acc-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.recreating,
        lifecycle_operation_id: expect.any(String),
      })
    );
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
