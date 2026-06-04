import 'reflect-metadata';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import type { ContainerHealthResult } from '@core/services/containerHealth.service';
import { WorkerCommandHandlerService } from '@core/services/workerCommandHandler.service';
import type {
  WorkerContainerInspection,
  WorkerService,
} from '@core/services/worker.service';

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

const buildWorkerContainerInspection = (
  overrides: Partial<WorkerContainerInspection> = {}
): WorkerContainerInspection => ({
  exists: true,
  container_id: 'container-1',
  container_name: 'worker-1',
  container_image: 'under-worker-wwebjs:latest',
  container_labels: {
    'underchat.worker_id': 'worker-1',
    'underchat.account_id': 'account-1',
    'underchat.worker_type_id': EWorkerType.wwebjs,
    'underchat.worker_image': 'under-worker-wwebjs:latest',
    'underchat.worker_grpc_port': '50053',
  },
  container_env: {
    WORKER_ID: 'worker-1',
    ACCOUNT_ID: 'account-1',
    WORKER_TYPE_ID: EWorkerType.wwebjs,
    WORKER_IMAGE: 'under-worker-wwebjs:latest',
    WORKER_GRPC_PORT: '50053',
  },
  container_state: 'running',
  container_status: 'running',
  container_started_at: '2026-01-01T00:00:00Z',
  container_finished_at: '0001-01-01T00:00:00Z',
  running: true,
  ...overrides,
});

const getWorkerStatusFromUpdateInput = (
  input: unknown
): EWorkerStatus | undefined =>
  (input as { worker_status_id?: EWorkerStatus } | undefined)?.worker_status_id;

const buildContainerHealthResult = (
  overrides: Partial<ContainerHealthResult> = {}
): ContainerHealthResult => ({
  healthy: true,
  container_id: 'container-1',
  health_url: 'http://127.0.0.1:3005/v1/health/check',
  health_attempt: 1,
  health_max_attempts: 1,
  health_delay_ms: 0,
  health_status_code: '200',
  consecutive_successes: 1,
  required_consecutive_successes: 1,
  health_duration_ms: 1,
  attempts: [],
  ...overrides,
});

const buildConnectedState = () => ({
  status: EBaileysConnectionStatus.connected,
  code: ECodeMessage.connectionEstablished,
  worker_id: 'worker-1',
  account_id: 'account-1',
  phone: '+556192037138',
  worker_status_id: EWorkerStatus.online,
});

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
    updateWorkerById: jest.fn<Promise<boolean>, [string, unknown]>(
      async () => true
    ),
    updateWorkerByIdIfLifecycleMatches: jest.fn<
      Promise<boolean>,
      [string, unknown, unknown]
    >(async () => true),
    deleteWorkerById: jest.fn(async () => true),
    existsWorkerById: jest.fn(async () => true),
    removeContainerWorker: jest.fn(async () => true),
    viewWorkerType: jest.fn(async () => ({
      worker_type_id: EWorkerType.wwebjs,
    })),
    viewWorker: jest.fn(async () => ({
      server: { id: 'server-1' },
      type: { id: EWorkerType.wwebjs },
      status: { id: EWorkerStatus.disponible },
    })),
    viewWorkerPhoneConnectionDate: jest.fn(async () => ({
      id: 'worker-1',
      number: null,
      connection_date: null,
    })),
    updateWorkerPhoneStatusConnectionDate: jest.fn(async () => true),
    viewWorkerForMonitor: jest.fn<Promise<any>, [string]>(async () => ({
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.disponible,
      worker_type_id: EWorkerType.wwebjs,
      created_at: null,
      updated_at: null,
      deleted_at: null,
      container_id: 'container-1',
      lifecycle_operation_id: null,
      last_connection_check_at: null,
    })),
    existsContainerWorkerById: jest.fn(async () => true),
    inspectContainerWorkerById: jest.fn<
      Promise<WorkerContainerInspection>,
      [string]
    >(async () => buildWorkerContainerInspection()),
    recordContainerDiagnostics: jest.fn(async () => undefined),
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
    checkServiceHealth: jest.fn<
      Promise<ContainerHealthResult>,
      [string, unknown?]
    >(async () => buildContainerHealthResult()),
  };
  const workerBaileysGrpcClientService = {
    requestConnection: jest.fn(async () => buildConnectedState()),
    waitForReady: jest.fn(async () => 'worker-1:50053'),
    requestConnectionQrCode: jest.fn<
      Promise<IBaileysConnectionState>,
      [string, unknown, unknown?]
    >(async () => ({
      status: EBaileysConnectionStatus.connecting,
      code: ECodeMessage.awaitingReadQrCode,
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
  const workerLifecycleLockService = {
    withLock: jest.fn(
      async (
        _workerId: string,
        _operation: string,
        callback: () => Promise<unknown>
      ) => callback()
    ),
  };
  const redis = {
    setex: jest.fn(async () => 'OK'),
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
    workerConfigService as never,
    workerLifecycleLockService as never,
    redis as never
  );

  return {
    handler,
    workerService,
    centrifugoService,
    containerHealthService,
    kafkaBaileysQueueService,
    workerBaileysGrpcClientService,
    workerLifecycleLockService,
    redis,
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
      new Promise<ReturnType<typeof buildConnectedState>>((resolve) => {
        resolveConnection = () => resolve(buildConnectedState());
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
      .mockResolvedValueOnce(buildConnectedState());
    deps.containerHealthService.checkServiceHealth.mockResolvedValueOnce(
      buildContainerHealthResult({
        healthy: true,
        container_id: 'worker-1',
        health_attempt: 1,
        health_max_attempts: 3,
        health_delay_ms: 1000,
      })
    );

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

    expect(deps.containerHealthService.checkServiceHealth).toHaveBeenCalledWith(
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

  it('defers disponible worker notifications while lifecycle readiness is pending', async () => {
    const deps = buildHandler();
    deps.workerService.viewWorker.mockResolvedValueOnce({
      server: { id: 'server-1' },
      type: { id: EWorkerType.wwebjs },
      status: { id: EWorkerStatus.creating },
    });

    await deps.handler.notifyWorkerStatus({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_status_id: EWorkerStatus.disponible,
    });

    expect(
      deps.workerService.updateWorkerPhoneStatusConnectionDate
    ).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publish).not.toHaveBeenCalled();
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
        connection_attempt_id: 'uuid-v7',
        qr_pending: false,
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
        connection_attempt_id: 'uuid-v7',
      }),
      EWorkerType.wwebjs
    );
    expect(deps.containerHealthService.checkServiceHealth).toHaveBeenCalledWith(
      'container-1',
      { maxAttempts: 2, delayMs: 1000, requiredConsecutiveSuccesses: 1 }
    );
    expect(
      deps.workerBaileysGrpcClientService.waitForReady
    ).toHaveBeenCalledWith('worker-1', EWorkerType.wwebjs, undefined);
    expect(
      deps.workerBaileysGrpcClientService.waitForReady.mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      deps.workerBaileysGrpcClientService.requestConnectionQrCode.mock
        .invocationCallOrder[0]
    );
    expect(deps.redis.setex).toHaveBeenCalledWith(
      'connection:qrcode:worker-1:attempt',
      expect.any(Number),
      expect.stringContaining('"connection_attempt_id":"uuid-v7"')
    );
    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      'worker:account#account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        account_id: 'account-1',
        qrcode: 'data:image/png;base64,qr',
        connection_attempt_id: 'uuid-v7',
        qr_pending: false,
      })
    );
  });

  it('recreates an existing unhealthy container before requesting QR', async () => {
    const deps = buildHandler();
    deps.containerHealthService.checkServiceHealth.mockResolvedValueOnce(
      buildContainerHealthResult({
        healthy: false,
        health_attempt: 2,
        health_max_attempts: 2,
        health_delay_ms: 1000,
        health_status_code: '500',
        consecutive_successes: 0,
        health_duration_ms: 3000,
      })
    );

    await deps.handler.handleRequestConnectionQrCode(
      {
        worker_id: 'worker-1',
        status: EWorkerStatus.online,
        type: EBaileysConnectionType.qrcode,
      },
      'account-1'
    );

    expect(deps.workerService.createContainerWorker).toHaveBeenCalledWith(
      expect.any(String),
      'worker-1',
      'account-1',
      true,
      expect.any(String),
      expect.any(Number),
      undefined,
      expect.objectContaining({
        workerTypeId: EWorkerType.wwebjs,
        workerGrpcPort: expect.any(Number),
      })
    );
    expect(deps.containerHealthService.checkServiceHealth).toHaveBeenCalledWith(
      'container-1',
      { maxAttempts: 2, delayMs: 1000, requiredConsecutiveSuccesses: 1 }
    );
    expect(deps.workerService.recordContainerDiagnostics).toHaveBeenCalledWith(
      'worker-1',
      'existing_container_health_failed'
    );
    expect(
      deps.workerService.createContainerWorker.mock.invocationCallOrder[0]
    ).toBeLessThan(
      deps.workerBaileysGrpcClientService.requestConnectionQrCode.mock
        .invocationCallOrder[0]
    );
  });

  it('creates a missing container synchronously before requesting QR', async () => {
    const deps = buildHandler();
    deps.workerService.inspectContainerWorkerById
      .mockResolvedValueOnce(
        buildWorkerContainerInspection({
          exists: false,
          container_name: 'worker-1',
        })
      )
      .mockResolvedValue(
        buildWorkerContainerInspection({
          container_id: 'container-created',
        })
      );

    await deps.handler.handleRequestConnectionQrCode(
      {
        worker_id: 'worker-1',
        status: EWorkerStatus.online,
        type: EBaileysConnectionType.qrcode,
      },
      'account-1'
    );

    expect(deps.workerService.createContainerWorker).toHaveBeenCalled();
    expect(
      deps.workerBaileysGrpcClientService.waitForReady.mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      deps.workerBaileysGrpcClientService.requestConnectionQrCode.mock
        .invocationCallOrder[0]
    );
  });

  it('recreates an incompatible existing container before health checks', async () => {
    const deps = buildHandler();
    deps.workerService.inspectContainerWorkerById.mockResolvedValue(
      buildWorkerContainerInspection({
        container_image: 'under-worker-baileys:latest',
      })
    );

    await deps.handler.handleRequestConnectionQrCode(
      {
        worker_id: 'worker-1',
        status: EWorkerStatus.online,
        type: EBaileysConnectionType.qrcode,
      },
      'account-1'
    );

    expect(deps.workerService.recordContainerDiagnostics).toHaveBeenCalledWith(
      'worker-1',
      'image_mismatch'
    );
    expect(deps.workerService.createContainerWorker).toHaveBeenCalled();
    expect(
      deps.workerService.createContainerWorker.mock.invocationCallOrder[0]
    ).toBeLessThan(
      deps.containerHealthService.checkServiceHealth.mock.invocationCallOrder[0]
    );
  });

  it('fails clearly when gRPC readiness never completes and does not request QR', async () => {
    const deps = buildHandler();
    deps.workerBaileysGrpcClientService.waitForReady.mockRejectedValue(
      new Error('not ready')
    );

    await expect(
      deps.handler.handleRequestConnectionQrCode(
        {
          worker_id: 'worker-1',
          status: EWorkerStatus.online,
          type: EBaileysConnectionType.qrcode,
        },
        'account-1'
      )
    ).rejects.toThrow('not ready');

    expect(
      deps.workerBaileysGrpcClientService.requestConnectionQrCode
    ).not.toHaveBeenCalled();
  });

  it('does not schedule background connection retries for QR requests', async () => {
    const deps = buildHandler();

    await deps.handler.handleRequestConnectionQrCode(
      {
        worker_id: 'worker-1',
        status: EWorkerStatus.online,
        type: EBaileysConnectionType.qrcode,
      },
      'account-1'
    );

    expect(
      deps.workerBaileysGrpcClientService.requestConnection
    ).not.toHaveBeenCalled();
  });

  it('returns qr_pending and schedules retry when the worker QR request hits a deadline', async () => {
    jest.useFakeTimers();
    const deps = buildHandler();
    deps.workerBaileysGrpcClientService.requestConnectionQrCode.mockRejectedValueOnce(
      Object.assign(new Error('4 DEADLINE_EXCEEDED'), { code: 4 })
    );

    try {
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
          code: ECodeMessage.awaitingReadQrCode,
          status: EBaileysConnectionStatus.connecting,
          connection_attempt_id: 'uuid-v7',
          qr_pending: true,
        })
      );
      expect(response.qrcode).toBeUndefined();
      expect(deps.redis.setex).toHaveBeenCalledWith(
        'connection:qrcode:worker-1:attempt',
        expect.any(Number),
        expect.stringContaining('"qr_pending":true')
      );
      expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
        'worker:account#account-1',
        expect.objectContaining({
          worker_id: 'worker-1',
          account_id: 'account-1',
          connection_attempt_id: 'uuid-v7',
          qr_pending: true,
        })
      );
      expect(jest.getTimerCount()).toBe(1);
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it('publishes and caches QR with the same attempt when it arrives after the HTTP response', async () => {
    jest.useFakeTimers();
    const deps = buildHandler();
    deps.workerBaileysGrpcClientService.requestConnectionQrCode
      .mockResolvedValueOnce({
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitConnection,
        worker_id: 'worker-1',
        account_id: 'account-1',
      })
      .mockResolvedValueOnce({
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitingReadQrCode,
        worker_id: 'worker-1',
        account_id: 'account-1',
        qrcode: 'data:image/png;base64,qr-async',
      });

    try {
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
          connection_attempt_id: 'uuid-v7',
          qr_pending: true,
        })
      );
      expect(response.qrcode).toBeUndefined();

      await (
        deps.handler as unknown as {
          runQrConnectionAttempt(workerId: string): Promise<void>;
        }
      ).runQrConnectionAttempt('worker-1');

      expect(
        deps.workerBaileysGrpcClientService.requestConnectionQrCode
      ).toHaveBeenCalledTimes(2);
      expect(deps.redis.setex).toHaveBeenLastCalledWith(
        'connection:qrcode:worker-1:attempt',
        expect.any(Number),
        expect.stringContaining('"qrcode":"data:image/png;base64,qr-async"')
      );
      expect(deps.centrifugoService.publishSub).toHaveBeenLastCalledWith(
        'worker:account#account-1',
        expect.objectContaining({
          worker_id: 'worker-1',
          account_id: 'account-1',
          qrcode: 'data:image/png;base64,qr-async',
          connection_attempt_id: 'uuid-v7',
          qr_pending: false,
        })
      );
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it('marks created workers available only after stable health and gRPC readiness', async () => {
    const deps = buildHandler();

    await deps.handler.handle({
      action: EWorkerAction.create,
      worker_id: 'worker-1',
      server_id: 'server-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
    });

    expect(deps.containerHealthService.checkServiceHealth).toHaveBeenCalledWith(
      'container-1',
      {
        maxAttempts: 30,
        delayMs: 1000,
        requiredConsecutiveSuccesses: 3,
        failFastAfterFirstSuccessFailures: 3,
      }
    );
    expect(
      deps.workerBaileysGrpcClientService.waitForReady
    ).toHaveBeenCalledWith('worker-1', EWorkerType.wwebjs, undefined);

    const availableUpdateIndex =
      deps.workerService.updateWorkerById.mock.calls.findIndex(
        ([, input]) =>
          getWorkerStatusFromUpdateInput(input) === EWorkerStatus.disponible
      );
    expect(availableUpdateIndex).toBeGreaterThan(-1);
    expect(
      deps.workerBaileysGrpcClientService.waitForReady.mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      deps.workerService.updateWorkerById.mock.invocationCallOrder[
        availableUpdateIndex
      ]
    );
  });

  it('retries created workers once when the first container health fails', async () => {
    const deps = buildHandler();
    deps.workerService.createContainerWorker
      .mockResolvedValueOnce('container-bad')
      .mockResolvedValueOnce('container-good');
    deps.containerHealthService.checkServiceHealth
      .mockResolvedValueOnce(
        buildContainerHealthResult({
          healthy: false,
          container_id: 'container-bad',
          health_failure_reason: 'http_health_not_ready',
        })
      )
      .mockResolvedValueOnce(
        buildContainerHealthResult({
          healthy: true,
          container_id: 'container-good',
        })
      );

    await deps.handler.handle({
      action: EWorkerAction.create,
      worker_id: 'worker-1',
      server_id: 'server-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
    });

    expect(deps.workerService.recordContainerDiagnostics).toHaveBeenCalledWith(
      'worker-1',
      'create_health_failed'
    );
    expect(deps.workerService.removeContainerWorker).toHaveBeenCalledWith(
      'worker-1',
      false
    );
    expect(deps.workerService.createContainerWorker).toHaveBeenCalledTimes(2);
    expect(
      deps.workerBaileysGrpcClientService.waitForReady
    ).toHaveBeenCalledWith('worker-1', EWorkerType.wwebjs, undefined);
  });

  it('marks created workers as error only after both health attempts fail', async () => {
    const deps = buildHandler();
    deps.containerHealthService.checkServiceHealth.mockResolvedValue(
      buildContainerHealthResult({
        healthy: false,
        health_failure_reason: 'health_flapping_after_success',
      })
    );

    await expect(
      deps.handler.handle({
        action: EWorkerAction.create,
        worker_id: 'worker-1',
        server_id: 'server-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
      })
    ).rejects.toThrow('Worker service is not healthy');

    expect(deps.workerService.recordContainerDiagnostics).toHaveBeenCalledWith(
      'worker-1',
      'create_health_flapping_after_success'
    );
    expect(deps.workerService.createContainerWorker).toHaveBeenCalledTimes(2);
    expect(deps.workerService.removeContainerWorker).toHaveBeenCalledTimes(1);
    expect(
      deps.workerBaileysGrpcClientService.waitForReady
    ).not.toHaveBeenCalled();
    expect(
      deps.workerService.updateWorkerById.mock.calls.some(
        ([, input]) =>
          getWorkerStatusFromUpdateInput(input) === EWorkerStatus.error
      )
    ).toBe(true);
  });

  it('retries created workers once when gRPC readiness fails', async () => {
    const deps = buildHandler();
    deps.workerBaileysGrpcClientService.waitForReady
      .mockRejectedValueOnce(new Error('gRPC unavailable'))
      .mockResolvedValueOnce('worker-1:50053');

    await deps.handler.handle({
      action: EWorkerAction.create,
      worker_id: 'worker-1',
      server_id: 'server-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
    });

    expect(deps.workerService.recordContainerDiagnostics).toHaveBeenCalledWith(
      'worker-1',
      'create_grpc_readiness_failed'
    );
    expect(deps.workerService.removeContainerWorker).toHaveBeenCalledWith(
      'worker-1',
      false
    );
    expect(deps.workerService.createContainerWorker).toHaveBeenCalledTimes(2);
  });

  it('marks created workers as error after both gRPC readiness attempts fail', async () => {
    const deps = buildHandler();
    deps.workerBaileysGrpcClientService.waitForReady.mockRejectedValue(
      new Error('gRPC unavailable')
    );

    await expect(
      deps.handler.handle({
        action: EWorkerAction.create,
        worker_id: 'worker-1',
        server_id: 'server-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
      })
    ).rejects.toThrow('gRPC unavailable');

    expect(deps.workerService.recordContainerDiagnostics).toHaveBeenCalledWith(
      'worker-1',
      'create_grpc_readiness_failed'
    );
    expect(deps.workerService.createContainerWorker).toHaveBeenCalledTimes(2);
    expect(
      deps.workerService.updateWorkerById.mock.calls.some(
        ([, input]) =>
          getWorkerStatusFromUpdateInput(input) === EWorkerStatus.error
      )
    ).toBe(true);
  });

  it('marks recreated workers available only after stable health and gRPC readiness', async () => {
    const deps = buildHandler();
    deps.workerService.inspectContainerWorkerById.mockResolvedValueOnce({
      exists: false,
      container_name: 'worker-1',
    });

    await deps.handler.handle({
      action: EWorkerAction.recreate,
      worker_id: 'worker-1',
      server_id: 'server-1',
      account_id: 'account-1',
    });

    expect(deps.containerHealthService.isServiceHealthy).toHaveBeenCalledWith(
      'container-1',
      {
        maxAttempts: 30,
        delayMs: 1000,
        requiredConsecutiveSuccesses: 3,
        failFastAfterFirstSuccessFailures: 3,
      }
    );
    expect(
      deps.workerBaileysGrpcClientService.waitForReady
    ).toHaveBeenCalledWith('worker-1', EWorkerType.wwebjs, undefined);

    const availableUpdateIndex =
      deps.workerService.updateWorkerById.mock.calls.findIndex(
        ([, input]) =>
          getWorkerStatusFromUpdateInput(input) === EWorkerStatus.disponible
      );
    expect(availableUpdateIndex).toBeGreaterThan(-1);
    expect(
      deps.workerBaileysGrpcClientService.waitForReady.mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      deps.workerService.updateWorkerById.mock.invocationCallOrder[
        availableUpdateIndex
      ]
    );
  });

  it('always replaces a ready container during recreate and preserves volume by default', async () => {
    const deps = buildHandler();

    await deps.handler.handle({
      action: EWorkerAction.recreate,
      worker_id: 'worker-1',
      server_id: 'server-1',
      account_id: 'account-1',
    });

    expect(deps.workerService.removeContainerWorker).toHaveBeenCalledWith(
      'worker-1',
      false
    );
    expect(deps.workerService.createContainerWorker).toHaveBeenCalledWith(
      expect.any(String),
      'worker-1',
      'account-1',
      false,
      expect.any(String),
      expect.any(Number),
      undefined,
      expect.objectContaining({
        workerTypeId: EWorkerType.wwebjs,
        workerGrpcPort: 50053,
      })
    );
    expect(deps.workerService.updateWorkerById).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.disponible,
        container_id: 'container-1',
      })
    );
  });

  it('removes the volume during recreate only when explicit session reset is requested', async () => {
    const deps = buildHandler();

    await deps.handler.handle({
      action: EWorkerAction.recreate,
      worker_id: 'worker-1',
      server_id: 'server-1',
      account_id: 'account-1',
      remove_session: true,
      remove_volume: true,
    });

    expect(
      deps.workerBaileysGrpcClientService.requestConnection
    ).toHaveBeenCalledWith(
      'worker-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        status: EWorkerStatus.disponible,
        type: EBaileysConnectionType.qrcode,
        remove_session: true,
      }),
      EWorkerType.wwebjs
    );
    expect(deps.workerService.removeContainerWorker).toHaveBeenCalledWith(
      'worker-1',
      true
    );
    expect(deps.workerService.createContainerWorker).toHaveBeenCalled();
  });

  it('keeps a previously online worker online after recreate when the worker reconnects', async () => {
    const deps = buildHandler();

    await deps.handler.handle({
      action: EWorkerAction.recreate,
      worker_id: 'worker-1',
      server_id: 'server-1',
      account_id: 'account-1',
      previous_worker_status_id: EWorkerStatus.online,
    });

    expect(
      deps.workerBaileysGrpcClientService.requestConnection
    ).toHaveBeenCalledWith(
      'worker-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        status: EWorkerStatus.online,
        type: EBaileysConnectionType.qrcode,
      }),
      EWorkerType.wwebjs
    );
    expect(deps.workerService.updateWorkerById).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.online,
        container_id: 'container-1',
        number: '+556192037138',
      })
    );
    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      expect.stringContaining('account-1'),
      expect.objectContaining({
        status: EBaileysConnectionStatus.connected,
        code: ECodeMessage.connectionEstablished,
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_status_id: EWorkerStatus.online,
      })
    );
  });

  it('skips stale recreate operations before removing or creating containers', async () => {
    const deps = buildHandler();
    deps.workerService.viewWorkerForMonitor.mockResolvedValueOnce({
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: EWorkerType.whatsmeow,
      created_at: null,
      updated_at: null,
      deleted_at: null,
      container_id: 'container-new',
      lifecycle_operation_id: 'operation-new',
      last_connection_check_at: null,
    });

    await deps.handler.handle({
      action: EWorkerAction.recreate,
      worker_id: 'worker-1',
      server_id: 'server-1',
      account_id: 'account-1',
      lifecycle_operation_id: 'operation-old',
    });

    expect(deps.workerService.removeContainerWorker).not.toHaveBeenCalled();
    expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();
    expect(deps.workerService.updateWorkerById).not.toHaveBeenCalled();
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
    expect(deps.workerLifecycleLockService.withLock).toHaveBeenCalledWith(
      'worker-1',
      'cleanup_worker',
      expect.any(Function)
    );
    expect(deps.kafkaBaileysQueueService.delete).not.toHaveBeenCalled();
    expect(deps.workerService.updateWorkerById).not.toHaveBeenCalled();
    expect(deps.workerService.deleteWorkerById).not.toHaveBeenCalled();
  });

  it('skips stale cleanup operations before touching local container artifacts', async () => {
    const deps = buildHandler();
    deps.workerService.viewWorkerForMonitor.mockResolvedValueOnce({
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-2',
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: EWorkerType.whatsmeow,
      created_at: null,
      updated_at: null,
      deleted_at: null,
      container_id: 'container-new',
      lifecycle_operation_id: 'operation-new',
      last_connection_check_at: null,
    });

    await deps.handler.handle({
      action: EWorkerAction.cleanup,
      worker_id: 'worker-1',
      server_id: 'server-old',
      account_id: 'account-1',
      remove_session: true,
      remove_volume: true,
      lifecycle_operation_id: 'operation-old',
    });

    expect(
      deps.workerBaileysGrpcClientService.requestConnection
    ).not.toHaveBeenCalled();
    expect(deps.workerService.cleanupContainerWorker).not.toHaveBeenCalled();
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
