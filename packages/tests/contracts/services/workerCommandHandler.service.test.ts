import 'reflect-metadata';
import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { WorkerCommandHandlerService } from '@core/services/workerCommandHandler.service';
import type { WorkerService } from '@core/services/worker.service';

jest.mock('@core/services/worker.service', () => ({
  WorkerService: class WorkerService {},
}));

jest.mock('@core/services/centrifugo.service', () => ({
  CentrifugoService: class CentrifugoService {},
}));

jest.mock('@core/services/chat.service', () => ({
  ChatService: class ChatService {},
}));

jest.mock('@core/services/kafkaBaileysQueue.service', () => ({
  KafkaBaileysQueueService: class KafkaBaileysQueueService {},
}));

jest.mock('@core/services/containerHealth.service', () => ({
  ContainerHealthService: class ContainerHealthService {},
}));

jest.mock('@core/services/workerBaileysGrpcClient.service', () => ({
  WorkerBaileysGrpcClientService: class WorkerBaileysGrpcClientService {},
}));

jest.mock('@core/repositories/server/ServerSshViewer.repository', () => ({
  ServerSshViewerRepository: class ServerSshViewerRepository {},
}));

jest.mock('@core/repositories/worker/WorkerConfigViewer.repository', () => ({
  WorkerConfigViewerRepository: class WorkerConfigViewerRepository {},
}));

jest.mock('@core/services/passwordEncryptor.service', () => ({
  PasswordEncryptorService: class PasswordEncryptorService {},
}));

jest.mock('@core/services/s3BackupUpload.service', () => ({
  S3BackupUploadService: class S3BackupUploadService {},
}));

jest.mock('@core/services/workerConfig.service', () => ({
  WorkerConfigService: class WorkerConfigService {},
}));

jest.mock('uuid', () => ({
  v7: jest.fn(() => 'uuid-v7'),
}));

function buildHandler(
  overrides: {
    cleanupError?: unknown;
    cleanupResult?: boolean;
  } = {}
) {
  const workerService = {
    cleanupContainerWorker: jest.fn(async () => {
      if (overrides.cleanupError) {
        throw overrides.cleanupError;
      }

      return overrides.cleanupResult ?? true;
    }),
    updateWorkerById: jest.fn(async () => true),
    deleteWorkerById: jest.fn(async () => true),
    existsWorkerById: jest.fn(async () => true),
    removeContainerWorker: jest.fn(async () => true),
    viewWorkerType: jest.fn(async () => ({
      worker_type_id: EWorkerType.wwebjs,
    })),
    viewWorker: jest.fn(async () => ({
      server: { id: 'server-1' },
      type: { id: EWorkerType.wwebjs },
    })),
    viewWorkerForMonitor: jest.fn(async () => null),
    existsContainerWorkerById: jest.fn(async () => true),
    createContainerWorker: jest.fn(async () => 'container-1'),
  };

  const centrifugoService = {
    publish: jest.fn(async () => ({})),
    publishSub: jest.fn(async () => ({})),
  };

  const chatService = {};
  const kafkaBaileysQueueService = {
    delete: jest.fn(async () => undefined),
    ensure: jest.fn(async () => undefined),
  };
  const containerHealthService = {
    isServiceHealthy: jest.fn(async () => true),
  };
  const workerBaileysGrpcClientService = {
    requestConnection: jest.fn(async () => undefined),
    requestConnectionQrCode: jest.fn(async () => ({
      status: 'connecting',
      code: 202,
      worker_id: 'worker-1',
      account_id: 'account-1',
      qrcode: 'data:image/png;base64,qr',
    })),
  };
  const serverSshViewerRepository = {
    viewServerSshById: jest.fn(async () => null),
  };
  const workerConfigViewerRepository = {
    fetchConfigValueByType: jest.fn(async () => ({
      statusId: null,
      value: null,
    })),
  };
  const passwordEncryptorService = {
    decrypt: jest.fn((value: string) => value),
  };
  const s3BackupUploadService = {};
  const workerConfigService = {
    viewTypingSimulation: jest.fn(async () => ({ enabled: true, speed: 50 })),
    refreshTypingSimulationCache: jest.fn(async () => undefined),
  };

  const handler = new WorkerCommandHandlerService(
    workerService as never,
    centrifugoService as never,
    chatService as never,
    kafkaBaileysQueueService as never,
    containerHealthService as never,
    workerBaileysGrpcClientService as never,
    serverSshViewerRepository as never,
    workerConfigViewerRepository as never,
    passwordEncryptorService as never,
    s3BackupUploadService as never,
    workerConfigService as never
  );

  return {
    handler,
    workerService,
    centrifugoService,
    containerHealthService,
    kafkaBaileysQueueService,
    workerBaileysGrpcClientService,
  };
}

const flushPromises = async (): Promise<void> => {
  await new Promise((resolve) => setImmediate(resolve));
};

describe('WorkerCommandHandlerService connection', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects legacy QR status changes without publishing a connection intent', async () => {
    const deps = buildHandler();

    await expect(
      deps.handler.handleChangeConnectionStatus(
        {
          worker_id: 'worker-1',
          status: EWorkerStatus.online,
          type: EBaileysConnectionType.qrcode,
        },
        'account-1'
      )
    ).rejects.toThrow('Use RequestConnectionQrCode for QR Code connections.');

    expect(
      deps.workerBaileysGrpcClientService.requestConnection
    ).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publishSub).not.toHaveBeenCalled();
  });

  it('acks a non-QR online connection without waiting for worker gRPC completion', async () => {
    const deps = buildHandler();
    let resolveConnection!: () => void;
    deps.workerBaileysGrpcClientService.requestConnection.mockReturnValueOnce(
      new Promise<undefined>((resolve) => {
        resolveConnection = () => resolve(undefined);
      })
    );

    await expect(
      deps.handler.handleChangeConnectionStatus(
        {
          worker_id: 'worker-1',
          status: EWorkerStatus.online,
          type: EBaileysConnectionType.phone,
        },
        'account-1'
      )
    ).resolves.toBeUndefined();

    await flushPromises();

    expect(
      deps.workerBaileysGrpcClientService.requestConnection
    ).toHaveBeenCalledWith(
      'worker-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        status: EWorkerStatus.online,
        type: EBaileysConnectionType.phone,
      }),
      EWorkerType.wwebjs
    );
    expect(deps.containerHealthService.isServiceHealthy).not.toHaveBeenCalled();

    resolveConnection();
    await flushPromises();
  });

  it('tries worker gRPC before falling back to container health checks', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const deps = buildHandler();
    deps.workerBaileysGrpcClientService.requestConnection
      .mockRejectedValueOnce(new Error('worker not ready'))
      .mockResolvedValueOnce(undefined);
    deps.containerHealthService.isServiceHealthy.mockResolvedValueOnce(true);

    await deps.handler.handleChangeConnectionStatus(
      {
        worker_id: 'worker-1',
        status: EWorkerStatus.online,
        type: EBaileysConnectionType.phone,
      },
      'account-1'
    );

    await flushPromises();
    await flushPromises();

    expect(deps.containerHealthService.isServiceHealthy).toHaveBeenCalledWith(
      'worker-1',
      { maxAttempts: 3, delayMs: 1000 }
    );
    expect(
      deps.workerBaileysGrpcClientService.requestConnection
    ).toHaveBeenCalledTimes(2);
  });

  it('publishes a disconnected state when the background workflow cannot resolve worker data', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const deps = buildHandler();
    (deps.workerService.viewWorker as jest.Mock).mockResolvedValueOnce(null);
    deps.workerService.viewWorkerForMonitor.mockResolvedValueOnce(null);
    deps.workerService.existsContainerWorkerById.mockResolvedValueOnce(false);

    await expect(
      deps.handler.handleChangeConnectionStatus(
        {
          worker_id: 'worker-1',
          status: EWorkerStatus.online,
          type: EBaileysConnectionType.phone,
        },
        'account-1'
      )
    ).resolves.toBeUndefined();

    await flushPromises();
    await flushPromises();

    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      expect.stringContaining('account-1'),
      expect.objectContaining({
        worker_id: 'worker-1',
        account_id: 'account-1',
        status: 'disconnected',
        code: 428,
      })
    );
  });

  it('returns a QR code through the synchronous worker request without publishing a connection intent', async () => {
    const deps = buildHandler();

    const response = await deps.handler.handleRequestConnectionQrCode(
      {
        worker_id: 'worker-1',
        status: EWorkerStatus.online,
        type: EBaileysConnectionType.qrcode,
      },
      'account-1'
    );

    expect(response).toEqual(
      expect.objectContaining({
        worker_id: 'worker-1',
        account_id: 'account-1',
        qrcode: 'data:image/png;base64,qr',
      })
    );
    expect(
      deps.workerBaileysGrpcClientService.requestConnectionQrCode
    ).toHaveBeenCalledWith(
      'worker-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        status: EWorkerStatus.online,
        type: EBaileysConnectionType.qrcode,
      }),
      EWorkerType.wwebjs
    );
    expect(deps.centrifugoService.publishSub).not.toHaveBeenCalled();
  });

  it('does not request a QR code in background after recreating a worker', async () => {
    const deps = buildHandler();

    await deps.handler.handle({
      action: EWorkerAction.recreate,
      worker_id: 'worker-1',
      server_id: 'server-1',
      account_id: 'account-1',
    });

    expect(
      deps.workerBaileysGrpcClientService.requestConnection
    ).not.toHaveBeenCalled();
    expect(
      deps.workerBaileysGrpcClientService.requestConnectionQrCode
    ).not.toHaveBeenCalled();
  });
});

describe('WorkerCommandHandlerService cleanup', () => {
  it('removes only local container artifacts and does not mutate worker data', async () => {
    const deps = buildHandler();

    await deps.handler.handle({
      action: EWorkerAction.cleanup,
      worker_id: 'worker-1',
      server_id: 'server-old',
      account_id: 'account-1',
      remove_session: true,
      remove_volume: true,
    });

    expect(
      deps.workerBaileysGrpcClientService.requestConnection
    ).toHaveBeenCalledWith(
      'worker-1',
      {
        worker_id: 'worker-1',
        status: EWorkerStatus.disponible,
        type: EBaileysConnectionType.qrcode,
        remove_session: true,
      },
      EWorkerType.wwebjs
    );
    expect(deps.workerService.cleanupContainerWorker).toHaveBeenCalledWith(
      'worker-1',
      true
    );
    expect(deps.kafkaBaileysQueueService.delete).not.toHaveBeenCalled();
    expect(deps.workerService.updateWorkerById).not.toHaveBeenCalled();
    expect(deps.workerService.deleteWorkerById).not.toHaveBeenCalled();
  });

  it('propagates cleanup failures from an accessible worker server', async () => {
    const deps = buildHandler({
      cleanupError: new Error('docker failed'),
    });

    await expect(
      deps.handler.handle({
        action: EWorkerAction.cleanup,
        worker_id: 'worker-1',
        server_id: 'server-old',
        account_id: 'account-1',
        remove_volume: true,
      })
    ).rejects.toThrow('docker failed');

    expect(deps.kafkaBaileysQueueService.delete).not.toHaveBeenCalled();
    expect(deps.workerService.updateWorkerById).not.toHaveBeenCalled();
    expect(deps.workerService.deleteWorkerById).not.toHaveBeenCalled();
  });
});

describe('WorkerService cleanupContainerWorker', () => {
  it('treats missing container and volume as a successful cleanup', async () => {
    const { WorkerService: ActualWorkerService } = jest.requireActual<
      typeof import('@core/services/worker.service')
    >('@core/services/worker.service');
    const workerService = Object.create(
      ActualWorkerService.prototype
    ) as WorkerService;
    workerService.existsContainerWorkerById = jest.fn(async () => false);
    workerService.existsVolumeWorkerById = jest.fn(async () => false);
    workerService.removeContainerWorkerById = jest.fn(async () => true);
    workerService.removeVolumeWorkerById = jest.fn(async () => true);

    await expect(
      workerService.cleanupContainerWorker('worker-1', true)
    ).resolves.toBe(true);

    expect(workerService.removeContainerWorkerById).not.toHaveBeenCalled();
    expect(workerService.removeVolumeWorkerById).not.toHaveBeenCalled();
  });
});
