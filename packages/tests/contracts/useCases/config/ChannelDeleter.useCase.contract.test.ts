import 'reflect-metadata';

jest.mock('@core/services/worker.service', () => ({
  WorkerService: class {},
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
jest.mock('@core/services/chat.service', () => ({
  ChatService: class {},
}));

import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { ChannelDeleterUseCase } from '@core/useCases/config/ChannelDeleter.useCase';

describe('ChannelDeleterUseCase', () => {
  it('throws when worker balancer is not found during validation', async () => {
    const workerService = { deleteWorkerById: jest.fn() };
    const configService = {
      viewChannelBalancer: jest.fn(async () => null),
    };
    const centrifugoService = {
      publishSub: jest.fn(),
      publish: jest.fn(),
    };
    const workerGrpcClientService = {
      deleteWorker: jest.fn(),
    };
    const chatService = {
      countOpenChatsByWorkerId: jest.fn(),
    };
    const useCase = new ChannelDeleterUseCase(
      workerService as never,
      configService as never,
      centrifugoService as never,
      workerGrpcClientService as never,
      chatService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'worker-1')).rejects.toThrow(
      'worker_not_found'
    );
    expect(chatService.countOpenChatsByWorkerId).not.toHaveBeenCalled();
  });

  it('throws when channel has open conversations', async () => {
    const workerService = { deleteWorkerById: jest.fn() };
    const configService = {
      viewChannelBalancer: jest.fn(async () => ({
        account_id: 'acc-1',
        server_id: 'srv-1',
      })),
    };
    const centrifugoService = {
      publishSub: jest.fn(),
      publish: jest.fn(),
    };
    const workerGrpcClientService = {
      deleteWorker: jest.fn(),
    };
    const chatService = {
      countOpenChatsByWorkerId: jest.fn(async () => 3),
    };
    const useCase = new ChannelDeleterUseCase(
      workerService as never,
      configService as never,
      centrifugoService as never,
      workerGrpcClientService as never,
      chatService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'worker-1')).rejects.toThrow(
      'channel_delete_has_open_conversations'
    );
    expect(workerService.deleteWorkerById).not.toHaveBeenCalled();
  });

  it('throws when worker balancer is missing after validation', async () => {
    const workerService = { deleteWorkerById: jest.fn() };
    const configService = {
      viewChannelBalancer: jest
        .fn()
        .mockResolvedValueOnce({
          account_id: 'acc-1',
          server_id: 'srv-1',
        })
        .mockResolvedValueOnce(null),
    };
    const centrifugoService = {
      publishSub: jest.fn(),
      publish: jest.fn(),
    };
    const workerGrpcClientService = {
      deleteWorker: jest.fn(),
    };
    const chatService = {
      countOpenChatsByWorkerId: jest.fn(async () => 0),
    };
    const useCase = new ChannelDeleterUseCase(
      workerService as never,
      configService as never,
      centrifugoService as never,
      workerGrpcClientService as never,
      chatService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'worker-1')).rejects.toThrow(
      'worker_not_found'
    );
    expect(workerService.deleteWorkerById).not.toHaveBeenCalled();
  });

  it('publishes deletion and deletes worker successfully', async () => {
    const workerService = {
      deleteWorkerById: jest.fn(async () => true),
      viewWorker: jest.fn(async () => ({
        type: { id: 'non-official-worker-type' },
      })),
    };
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
      deleteWorker: jest.fn(async () => undefined),
    };
    const chatService = {
      countOpenChatsByWorkerId: jest.fn(async () => 0),
    };
    const useCase = new ChannelDeleterUseCase(
      workerService as never,
      configService as never,
      centrifugoService as never,
      workerGrpcClientService as never,
      chatService as never
    );

    await expect(useCase.execute(jest.fn() as never, 'worker-1')).resolves.toBe(
      true
    );

    const expectedPayload = {
      action: EWorkerAction.delete,
      worker_id: 'worker-1',
      server_id: 'srv-1',
      account_id: 'acc-1',
    };
    expect(centrifugoService.publishSub).toHaveBeenCalledWith(
      'worker:account#acc-1',
      expectedPayload
    );
    expect(centrifugoService.publish).toHaveBeenCalledWith(
      'channels:config',
      expectedPayload
    );
    expect(workerService.deleteWorkerById).toHaveBeenCalledWith(
      'acc-1',
      'worker-1'
    );
  });

  it('handles grpc delete errors without throwing from onChannelDeleted', async () => {
    const workerService = { deleteWorkerById: jest.fn() };
    const configService = { viewChannelBalancer: jest.fn() };
    const centrifugoService = { publishSub: jest.fn(), publish: jest.fn() };
    const workerGrpcClientService = {
      deleteWorker: jest.fn(async () => {
        throw new Error('grpc-failed');
      }),
    };
    const chatService = { countOpenChatsByWorkerId: jest.fn() };
    const useCase = new ChannelDeleterUseCase(
      workerService as never,
      configService as never,
      centrifugoService as never,
      workerGrpcClientService as never,
      chatService as never
    );
    const spyConsole = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    await (useCase as any).onChannelDeleted({
      action: EWorkerAction.delete,
      worker_id: 'worker-1',
      server_id: 'srv-1',
      account_id: 'acc-1',
    });
    await Promise.resolve();

    expect(spyConsole).toHaveBeenCalled();
    spyConsole.mockRestore();
  });
});
