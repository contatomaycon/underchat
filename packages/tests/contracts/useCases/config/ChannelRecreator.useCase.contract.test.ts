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
jest.mock('@core/services/workerLifecycleQueue.service', () => ({
  WorkerLifecycleQueueService: class {},
}));

import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { ChannelRecreatorUseCase } from '@core/useCases/config/ChannelRecreator.useCase';

describe('ChannelRecreatorUseCase', () => {
  it('throws when worker balancer is not found', async () => {
    const workerService = { updateWorkerById: jest.fn() };
    const accountService = { existsAccountById: jest.fn() };
    const configService = { viewChannelContext: jest.fn(async () => null) };
    const centrifugoService = { publishSub: jest.fn(), publish: jest.fn() };
    const workerGrpcClientService = { recreateWorker: jest.fn() };
    const workerLifecycleQueueService = { publish: jest.fn() };
    const useCase = new ChannelRecreatorUseCase(
      workerService as never,
      accountService as never,
      configService as never,
      centrifugoService as never,
      workerLifecycleQueueService as never
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
      viewChannelContext: jest.fn(async () => ({
        worker_id: 'worker-1',
        account_id: 'acc-1',
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.online,
        name: 'Channel',
      })),
      viewChannelBalancer: jest.fn(async () => ({
        account_id: 'acc-1',
        server_id: 'srv-1',
      })),
    };
    const centrifugoService = { publishSub: jest.fn(), publish: jest.fn() };
    const workerGrpcClientService = { recreateWorker: jest.fn() };
    const workerLifecycleQueueService = { publish: jest.fn() };
    const useCase = new ChannelRecreatorUseCase(
      workerService as never,
      accountService as never,
      configService as never,
      centrifugoService as never,
      workerLifecycleQueueService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'worker-1')).rejects.toThrow(
      'account_not_found'
    );
    expect(workerService.updateWorkerById).not.toHaveBeenCalled();
  });

  it('marks the channel as error when lifecycle enqueue fails', async () => {
    const workerService = {
      viewWorker: jest.fn(async () => ({
        status: { id: EWorkerStatus.online },
      })),
      updateWorkerById: jest.fn(async () => true),
    };
    const accountService = { existsAccountById: jest.fn(async () => true) };
    const configService = {
      viewChannelContext: jest.fn(async () => ({
        worker_id: 'worker-1',
        account_id: 'acc-1',
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.online,
        name: 'Channel',
      })),
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
    const workerLifecycleQueueService = {
      publish: jest.fn(async () => {
        throw new Error('kafka-fail');
      }),
    };
    const useCase = new ChannelRecreatorUseCase(
      workerService as never,
      accountService as never,
      configService as never,
      centrifugoService as never,
      workerLifecycleQueueService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'worker-1')).rejects.toThrow(
      'kafka-fail'
    );

    expect(workerService.updateWorkerById).toHaveBeenCalledWith('acc-1', {
      worker_id: 'worker-1',
      worker_status_id: EWorkerStatus.error,
      lifecycle_operation_id: null,
    });
    expect(centrifugoService.publish).toHaveBeenCalledWith(
      'channels:config',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.error,
      })
    );
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
      viewChannelContext: jest.fn(async () => ({
        worker_id: 'worker-1',
        account_id: 'acc-1',
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.online,
        name: 'Channel',
      })),
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
    const workerLifecycleQueueService = {
      publish: jest.fn(async () => undefined),
    };
    const useCase = new ChannelRecreatorUseCase(
      workerService as never,
      accountService as never,
      configService as never,
      centrifugoService as never,
      workerLifecycleQueueService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'worker-1')
    ).resolves.toMatchObject({
      code: 202,
      queued: true,
      worker_id: 'worker-1',
      worker_status_id: EWorkerStatus.recreating,
    });

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
      expect.objectContaining(expectedPayload)
    );
    expect(centrifugoService.publish).toHaveBeenCalledWith(
      'channels:config',
      expect.objectContaining(expectedPayload)
    );
    expect(workerLifecycleQueueService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        account_id: 'acc-1',
        server_id: 'srv-1',
        operation_id: expect.any(String),
      })
    );
  });

  it('blocks official WhatsApp channel recreate', async () => {
    const workerService = {
      viewWorker: jest.fn(async () => ({
        status: { id: EWorkerStatus.online },
        type: { id: EWorkerType.whatsapp },
      })),
      updateWorkerById: jest.fn(async () => true),
    };
    const accountService = { existsAccountById: jest.fn(async () => true) };
    const configService = {
      viewChannelContext: jest.fn(async () => ({
        worker_id: 'worker-1',
        account_id: 'acc-1',
        worker_type_id: EWorkerType.whatsapp,
        worker_status_id: EWorkerStatus.online,
        name: 'Official',
      })),
      viewChannelBalancer: jest.fn(async () => ({
        account_id: 'acc-1',
        server_id: 'srv-1',
      })),
    };
    const centrifugoService = {
      publishSub: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const workerLifecycleQueueService = {
      publish: jest.fn(async () => undefined),
    };
    const useCase = new ChannelRecreatorUseCase(
      workerService as never,
      accountService as never,
      configService as never,
      centrifugoService as never,
      workerLifecycleQueueService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'worker-1')).rejects.toThrow(
      'whatsapp_official_runtime_action_not_supported'
    );
    expect(workerService.updateWorkerById).not.toHaveBeenCalled();
    expect(configService.viewChannelBalancer).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
  });

  it('includes reserved recreate server slot in lifecycle message', async () => {
    const workerService = {
      viewWorker: jest.fn(async () => ({
        status: { id: EWorkerStatus.online },
      })),
      updateWorkerById: jest.fn(async () => true),
    };
    const accountService = { existsAccountById: jest.fn(async () => true) };
    const configService = {
      viewChannelContext: jest.fn(async () => ({
        worker_id: 'worker-1',
        account_id: 'acc-1',
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.online,
        name: 'Channel',
      })),
      viewChannelBalancer: jest.fn(async () => ({
        account_id: 'acc-1',
        server_id: 'srv-1',
      })),
    };
    const centrifugoService = {
      publishSub: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const workerLifecycleQueueService = {
      publish: jest.fn(async () => undefined),
    };
    const useCase = new ChannelRecreatorUseCase(
      workerService as never,
      accountService as never,
      configService as never,
      centrifugoService as never,
      workerLifecycleQueueService as never
    );

    await useCase.execute(jest.fn() as never, 'worker-1', undefined, {
      recreate_server_slot_key: 'worker:recreate:server:srv-1:slot:0',
      recreate_server_slot_token: 'worker-1:token',
    });

    expect(workerLifecycleQueueService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        recreate_server_slot_key: 'worker:recreate:server:srv-1:slot:0',
        recreate_server_slot_token: 'worker-1:token',
      })
    );
  });
});
