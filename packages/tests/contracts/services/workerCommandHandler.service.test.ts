import 'reflect-metadata';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { EWorkerConfigStatus } from '@core/common/enums/EWorkerConfigStatus';
import { EWorkerConfigType } from '@core/common/enums/EWorkerConfigType';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerWarmPoolState } from '@core/common/enums/EWorkerWarmPoolState';
import { EProxyProtocol } from '@core/common/enums/EProxyProtocol';
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
    volumeExists?: boolean;
    workerRuntimeRepository?: {
      viewByWorkerId: jest.Mock;
      upsert: jest.Mock;
      deleteByWorkerId: jest.Mock;
    };
    workerWarmPoolRepository?: {
      viewById: jest.Mock;
      markAssigned: jest.Mock;
      markRuntime: jest.Mock;
      deleteAssignedByWorkerId: jest.Mock;
    };
    workerInspection?: WorkerContainerInspection;
    runtimeHealthResponse?: Record<string, unknown>;
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
    removeContainerByNameAndVolume: jest.fn(async () => true),
    existsVolumeByName: jest.fn(async () => overrides.volumeExists ?? true),
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
    >(
      async () => overrides.workerInspection ?? buildWorkerContainerInspection()
    ),
    createContainerWorker: jest.fn(async () => 'container-1'),
    renameContainer: jest.fn(async () => undefined),
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
    activateRuntime: jest.fn(async () => ({ activated: true })),
    runtimeHealth: jest.fn(async () => ({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      activated: true,
      ready: true,
      standby: false,
      has_session: false,
      runtime_state: 'active',
      qr_stream_ready: true,
      ...overrides.runtimeHealthResponse,
    })),
  };
  const serverSshViewerRepository = {
    viewServerSshById: jest.fn(async () => null),
  };
  const workerConfigViewerRepository = {
    fetchConfigValueByType: jest.fn<
      Promise<{ statusId: string | null; value: string | null }>,
      [string, EWorkerConfigType]
    >(async () => ({
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
  const redisStore = new Map<string, string>();
  const redis = {
    get: jest.fn(async (key: string) => redisStore.get(key) ?? null),
    setex: jest.fn(async (key: string, _ttl: number, value: string) => {
      redisStore.set(key, value);
      return 'OK';
    }),
    set: jest.fn(async (key: string, value: string, ...args: unknown[]) => {
      if (args.includes('NX') && redisStore.has(key)) {
        return null;
      }
      redisStore.set(key, value);
      return 'OK';
    }),
    del: jest.fn(async (...keys: string[]) => {
      let deleted = 0;
      for (const key of keys) {
        if (redisStore.delete(key)) {
          deleted += 1;
        }
      }
      return deleted;
    }),
  };
  const redisQueueService = {
    streamKey: jest.fn((workerId: string, workerTypeId: string) => {
      return `connection:qrcode:${workerTypeId}:${workerId}:requests`;
    }),
    consumerGroup: jest.fn((workerId: string, workerTypeId: string) => {
      return `connection:qrcode:${workerTypeId}:${workerId}:group`;
    }),
    enqueue: jest.fn(async () => '1710000000000-0'),
    invalidateWorkerState: jest.fn(async () => ({
      deleted_keys: 5,
      scanned_processed_keys: 0,
      keys: [
        'connection:qrcode:worker-1:attempt',
        'connection:qrcode:worker-1:active_attempt',
        `connection:qrcode:${EWorkerType.baileys}:worker-1:requests`,
        `connection:qrcode:${EWorkerType.wwebjs}:worker-1:requests`,
        `connection:qrcode:${EWorkerType.whatsmeow}:worker-1:requests`,
      ],
    })),
  };
  const workerWarmPoolRepository = overrides.workerWarmPoolRepository ?? {
    viewById: jest.fn(async () => ({
      warm_pool_id: 'warm-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      container_id: 'warm-container-id',
      container_name: 'warm-container',
      session_volume_name: 'warm-volume',
      state: EWorkerWarmPoolState.reserved,
      reserved_by_worker_id: 'worker-1',
      reservation_expires_at: '2999-01-01T00:00:00.000Z',
    })),
    markAssigned: jest.fn(async () => true),
    markRuntime: jest.fn(async () => true),
    deleteAssignedByWorkerId: jest.fn(async () => 0),
  };
  const workerRuntimeRepository = overrides.workerRuntimeRepository;

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
    redis as never,
    redisQueueService as never,
    workerWarmPoolRepository as never,
    workerRuntimeRepository as never
  );

  return {
    handler,
    workerService,
    centrifugoService,
    containerHealthService,
    kafkaBaileysQueueService,
    workerBaileysGrpcClientService,
    workerLifecycleLockService,
    workerConfigViewerRepository,
    redisQueueService,
    workerWarmPoolRepository,
    workerRuntimeRepository,
    redis,
    redisStore,
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
    ).rejects.toThrow(
      'Use the QR Code request endpoint for QR Code connections.'
    );

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

  it('preserves QR state from worker status notifications', async () => {
    const deps = buildHandler();

    await deps.handler.notifyWorkerStatus({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_status_id: EWorkerStatus.disponible,
      status: EBaileysConnectionStatus.connecting,
      code: ECodeMessage.awaitingReadQrCode,
      qrcode: 'data:image/png;base64,qr',
      connection_attempt_id: 'attempt-1',
      qr_generated_at: new Date().toISOString(),
      time_to_first_qr_ms: 1335,
    });

    expect(deps.redis.setex).toHaveBeenCalledWith(
      `connection:qrcode:${EWorkerType.wwebjs}:worker-1:attempt`,
      expect.any(Number),
      expect.stringContaining('"qrcode":"data:image/png;base64,qr"')
    );
    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      'worker:account#account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        account_id: 'account-1',
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitingReadQrCode,
        qrcode: 'data:image/png;base64,qr',
        connection_attempt_id: 'attempt-1',
        qr_pending: false,
      })
    );
  });

  it('enqueues QR in Redis Streams and returns pending state', async () => {
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
        code: ECodeMessage.awaitingReadQrCode,
        status: EBaileysConnectionStatus.connecting,
        connection_attempt_id: 'uuid-v7',
        qr_pending: true,
      })
    );
    expect(response.pairing_code).toBeUndefined();
    expect(deps.redisQueueService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        request_id: 'uuid-v7',
        worker_id: 'worker-1',
        account_id: 'account-1',
        connection_attempt_id: 'uuid-v7',
        worker_type_id: EWorkerType.wwebjs,
        source: 'manager',
        requested_at: expect.any(String),
      })
    );
    expect(
      deps.workerBaileysGrpcClientService.waitForReady
    ).not.toHaveBeenCalled();
    expect(
      deps.containerHealthService.checkServiceHealth
    ).not.toHaveBeenCalled();
    expect(deps.redis.setex).toHaveBeenCalledWith(
      `connection:qrcode:${EWorkerType.wwebjs}:worker-1:attempt`,
      180,
      expect.stringContaining('"connection_attempt_id":"uuid-v7"')
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
  });

  it('returns the same cached pending state for repeated QR requests without duplicating stream messages', async () => {
    const deps = buildHandler();

    const first = await deps.handler.handleRequestConnectionQrCode(
      {
        worker_id: 'worker-1',
        status: EWorkerStatus.online,
        type: EBaileysConnectionType.qrcode,
      },
      'account-1'
    );
    const second = await deps.handler.handleRequestConnectionQrCode(
      {
        worker_id: 'worker-1',
        status: EWorkerStatus.online,
        type: EBaileysConnectionType.qrcode,
      },
      'account-1'
    );

    expect(second).toEqual(
      expect.objectContaining({
        worker_id: first.worker_id,
        account_id: first.account_id,
        connection_attempt_id: first.connection_attempt_id,
        qr_pending: true,
      })
    );
    expect(second.connection_attempt_id).toBe('uuid-v7');
    expect(second.qrcode).toBeUndefined();
    expect(second.qr_pending).toBe(true);
    expect(deps.redisQueueService.enqueue).toHaveBeenCalledTimes(1);
    expect(deps.redis.setex).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent QR requests through the active Redis attempt', async () => {
    const deps = buildHandler();
    let lockTail = Promise.resolve();
    deps.workerLifecycleLockService.withLock.mockImplementation(
      async (
        _workerId: string,
        _operation: string,
        callback: () => Promise<unknown>
      ) => {
        const previous = lockTail;
        let release!: () => void;
        lockTail = new Promise<void>((resolve) => {
          release = resolve;
        });

        await previous;
        try {
          return await callback();
        } finally {
          release();
        }
      }
    );

    const first = deps.handler.handleRequestConnectionQrCode(
      {
        worker_id: 'worker-1',
        status: EWorkerStatus.online,
        type: EBaileysConnectionType.qrcode,
      },
      'account-1'
    );
    await flushPromises();

    const second = deps.handler.handleRequestConnectionQrCode(
      {
        worker_id: 'worker-1',
        status: EWorkerStatus.online,
        type: EBaileysConnectionType.qrcode,
      },
      'account-1'
    );
    await flushPromises();

    const [firstResponse, secondResponse] = await Promise.all([first, second]);

    expect(firstResponse.connection_attempt_id).toBe('uuid-v7');
    expect(secondResponse.connection_attempt_id).toBe('uuid-v7');
    expect(firstResponse.qrcode).toBeUndefined();
    expect(secondResponse.qrcode).toBeUndefined();
    expect(secondResponse.qr_pending).toBe(true);
    expect(deps.redisQueueService.enqueue).toHaveBeenCalledTimes(1);
  });

  it('returns a fresh cached QR instead of sanitizing it to pending', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-04T13:45:00.000Z'));
    const deps = buildHandler();
    deps.redisStore.set(
      `connection:qrcode:${EWorkerType.wwebjs}:worker-1:attempt`,
      JSON.stringify({
        code: ECodeMessage.awaitingReadQrCode,
        status: EBaileysConnectionStatus.connecting,
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
        connection_attempt_id: 'attempt-fresh',
        qrcode: 'data:image/png;base64,qr-fresh',
        qr_pending: false,
        qr_generated_at: '2026-06-04T13:44:00.000Z',
      })
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
          connection_attempt_id: 'attempt-fresh',
          qrcode: 'data:image/png;base64,qr-fresh',
          qr_pending: false,
        })
      );
      expect(response.qr_generated_at).toBe('2026-06-04T13:44:00.000Z');
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not return a cached QR older than the WhatsApp QR lifetime', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-04T13:45:00.000Z'));
    const deps = buildHandler();
    deps.redisStore.set(
      `connection:qrcode:${EWorkerType.wwebjs}:worker-1:attempt`,
      JSON.stringify({
        code: ECodeMessage.awaitingReadQrCode,
        status: EBaileysConnectionStatus.connecting,
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
        connection_attempt_id: 'attempt-expired',
        qrcode: 'data:image/png;base64,qr-expired',
        qr_pending: false,
        qr_generated_at: '2026-06-04T13:42:59.000Z',
      })
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
      await Promise.resolve();
      await Promise.resolve();

      expect(response).toEqual(
        expect.objectContaining({
          connection_attempt_id: 'uuid-v7',
          qr_pending: true,
        })
      );
      expect(response.qrcode).toBeUndefined();
      expect(response.qr_generated_at).toBeUndefined();
      expect(deps.redis.setex).toHaveBeenCalledWith(
        `connection:qrcode:${EWorkerType.wwebjs}:worker-1:attempt`,
        180,
        expect.not.stringContaining('qr-expired')
      );
      expect(deps.redisQueueService.enqueue).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it('does not probe a compatible container before enqueueing QR', async () => {
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

    expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();
    expect(
      deps.workerBaileysGrpcClientService.waitForReady
    ).not.toHaveBeenCalled();
    expect(deps.redisQueueService.enqueue).toHaveBeenCalledTimes(1);
    expect(
      deps.containerHealthService.checkServiceHealth
    ).not.toHaveBeenCalled();
  });

  it('does not inspect unhealthy container readiness before enqueueing QR', async () => {
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
    deps.workerBaileysGrpcClientService.waitForReady
      .mockRejectedValueOnce(new Error('not ready'))
      .mockResolvedValueOnce('worker-1:50053');

    await deps.handler.handleRequestConnectionQrCode(
      {
        worker_id: 'worker-1',
        status: EWorkerStatus.online,
        type: EBaileysConnectionType.qrcode,
      },
      'account-1'
    );

    expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();
    expect(
      deps.containerHealthService.checkServiceHealth
    ).not.toHaveBeenCalled();
    expect(deps.redisQueueService.enqueue).toHaveBeenCalledTimes(1);
  });

  it('does not create a missing container synchronously before requesting QR', async () => {
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

    expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();
    expect(
      deps.workerBaileysGrpcClientService.waitForReady
    ).not.toHaveBeenCalled();
    expect(deps.redisQueueService.enqueue).toHaveBeenCalledTimes(1);
  });

  it('does not recreate an incompatible existing container from QR request', async () => {
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

    expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();
    expect(
      deps.containerHealthService.checkServiceHealth
    ).not.toHaveBeenCalled();
  });

  it('does not run a readiness probe before enqueueing QR', async () => {
    const deps = buildHandler();
    deps.workerBaileysGrpcClientService.waitForReady.mockRejectedValue(
      new Error('not ready')
    );

    await deps.handler.handleRequestConnectionQrCode(
      {
        worker_id: 'worker-1',
        status: EWorkerStatus.online,
        type: EBaileysConnectionType.qrcode,
      },
      'account-1'
    );

    expect(deps.redisQueueService.enqueue).toHaveBeenCalledTimes(1);
    expect(
      deps.workerBaileysGrpcClientService.waitForReady
    ).not.toHaveBeenCalled();
    expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();
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

  it('clears pending active state when Redis Stream enqueue fails', async () => {
    const deps = buildHandler();
    deps.redisQueueService.enqueue.mockRejectedValueOnce(
      new Error('xadd failed')
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
    ).rejects.toThrow('xadd failed');

    expect(deps.redis.del).toHaveBeenCalledWith(
      `connection:qrcode:${EWorkerType.wwebjs}:worker-1:active_attempt`
    );
    expect(deps.kafkaBaileysQueueService.ensure).not.toHaveBeenCalled();
  });

  it('returns the cached pending attempt after Redis Stream was queued once', async () => {
    jest.useFakeTimers();
    const deps = buildHandler();

    try {
      await deps.handler.handleRequestConnectionQrCode(
        {
          worker_id: 'worker-1',
          status: EWorkerStatus.online,
          type: EBaileysConnectionType.qrcode,
        },
        'account-1'
      );

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
      expect(deps.redisQueueService.enqueue).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it('does not start an async retry timer after Redis QR enqueue', async () => {
    jest.useFakeTimers();
    const deps = buildHandler();

    try {
      await deps.handler.handleRequestConnectionQrCode(
        {
          worker_id: 'worker-1',
          status: EWorkerStatus.online,
          type: EBaileysConnectionType.qrcode,
        },
        'account-1'
      );
      expect(deps.redisQueueService.enqueue).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it('does not enqueue again when Redis has a pending attempt', async () => {
    jest.useFakeTimers();
    const deps = buildHandler();
    deps.redisStore.set(
      `connection:qrcode:${EWorkerType.wwebjs}:worker-1:attempt`,
      JSON.stringify({
        code: ECodeMessage.awaitingReadQrCode,
        status: EBaileysConnectionStatus.connecting,
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
        connection_attempt_id: 'attempt-cached',
        qr_pending: true,
      })
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
      await Promise.resolve();
      await Promise.resolve();

      expect(response).toEqual(
        expect.objectContaining({
          connection_attempt_id: 'attempt-cached',
          qr_pending: true,
        })
      );
      expect(response.qrcode).toBeUndefined();
      expect(deps.redisQueueService.enqueue).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it('does not publish a stale no-QR state after a QR is cached for the active attempt', async () => {
    const deps = buildHandler();

    await deps.handler.handleRequestConnectionQrCode(
      {
        worker_id: 'worker-1',
        status: EWorkerStatus.online,
        type: EBaileysConnectionType.qrcode,
      },
      'account-1'
    );
    deps.redisStore.set(
      `connection:qrcode:${EWorkerType.wwebjs}:worker-1:attempt`,
      JSON.stringify({
        code: ECodeMessage.awaitingReadQrCode,
        status: EBaileysConnectionStatus.connecting,
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
        connection_attempt_id: 'uuid-v7',
        qrcode: 'data:image/png;base64,qr',
        qr_pending: false,
        qr_generated_at: new Date().toISOString(),
      })
    );

    const setexCalls = deps.redis.setex.mock.calls.length;
    const publishCalls = deps.centrifugoService.publishSub.mock.calls.length;
    const accepted = await (
      deps.handler as unknown as {
        cacheAndPublishQrAttemptState(
          state: IBaileysConnectionState,
          options: { event: string; publishSource?: string }
        ): Promise<boolean>;
      }
    ).cacheAndPublishQrAttemptState(
      {
        code: ECodeMessage.awaitingReadQrCode,
        status: EBaileysConnectionStatus.connecting,
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
        connection_attempt_id: 'uuid-v7',
        qr_pending: true,
      },
      {
        event: 'test_stale_without_qr',
        publishSource: 'test',
      }
    );

    expect(accepted).toBe(false);
    expect(deps.redis.setex).toHaveBeenCalledTimes(setexCalls);
    expect(deps.centrifugoService.publishSub).toHaveBeenCalledTimes(
      publishCalls
    );
  });

  it('publishes non-QR availability events even when an old QR is cached', async () => {
    const deps = buildHandler();
    deps.redisStore.set(
      `connection:qrcode:${EWorkerType.wwebjs}:worker-1:attempt`,
      JSON.stringify({
        code: ECodeMessage.awaitingReadQrCode,
        status: EBaileysConnectionStatus.connecting,
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
        connection_attempt_id: 'old-attempt',
        qrcode: 'data:image/png;base64,old-qr',
        qr_pending: false,
        qr_generated_at: new Date().toISOString(),
      })
    );

    await (
      deps.handler as unknown as {
        centrifugoPublish(state: IBaileysConnectionState): Promise<unknown>;
      }
    ).centrifugoPublish({
      code: ECodeMessage.info,
      status: EBaileysConnectionStatus.info,
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_status_id: EWorkerStatus.disponible,
      reason: 'warm_activation_disponible',
    });

    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      'worker:account#account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_status_id: EWorkerStatus.disponible,
        reason: 'warm_activation_disponible',
      })
    );
  });

  it('clears stale phone metadata when warm activation resets the session', async () => {
    const deps = buildHandler();
    deps.workerService.inspectContainerWorkerById
      .mockResolvedValueOnce(
        buildWorkerContainerInspection({
          container_id: 'warm-container-id',
          container_name: 'warm-container',
          container_image: 'under-worker-baileys:latest',
          container_labels: {
            'underchat.server_id': 'server-1',
            'underchat.warm_pool_id': 'warm-1',
            'underchat.warm_standby': 'true',
            'underchat.worker_type_id': EWorkerType.baileys,
            'underchat.worker_image': 'under-worker-baileys:latest',
            'underchat.worker_grpc_port': '50052',
          },
          container_env: {
            WARM_STANDBY: 'true',
            WARM_POOL_ID: 'warm-1',
            WORKER_TYPE_ID: EWorkerType.baileys,
            WORKER_IMAGE: 'under-worker-baileys:latest',
            WORKER_GRPC_PORT: '50052',
          },
        })
      )
      .mockResolvedValueOnce(
        buildWorkerContainerInspection({
          exists: false,
          container_name: 'worker-1',
          running: false,
        })
      )
      .mockResolvedValueOnce(
        buildWorkerContainerInspection({
          container_id: 'activated-container',
          container_name: 'worker-1',
          container_image: 'under-worker-baileys:latest',
          container_labels: {
            'underchat.worker_id': 'worker-1',
            'underchat.account_id': 'account-1',
            'underchat.session_volume_name': 'warm-volume',
            'underchat.worker_type_id': EWorkerType.baileys,
            'underchat.worker_image': 'under-worker-baileys:latest',
            'underchat.worker_grpc_port': '50052',
          },
          container_env: {
            WORKER_ID: 'worker-1',
            ACCOUNT_ID: 'account-1',
            SESSION_VOLUME_NAME: 'warm-volume',
            WORKER_TYPE_ID: EWorkerType.baileys,
            WORKER_IMAGE: 'under-worker-baileys:latest',
            WORKER_GRPC_PORT: '50052',
          },
        })
      );

    await deps.handler.activateWarmWorker({
      warm_pool_id: 'warm-1',
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      previous_worker_type_id: EWorkerType.whatsmeow,
      remove_session: true,
      remove_volume: true,
    });

    expect(deps.workerService.updateWorkerById).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        container_id: 'activated-container',
        worker_status_id: EWorkerStatus.disponible,
        number: null,
        connection_date: null,
      })
    );
    expect(
      deps.workerWarmPoolRepository.deleteAssignedByWorkerId
    ).toHaveBeenCalledWith('worker-1', 'warm-1');
  });

  it('does not recreate a proxied container from the QR request', async () => {
    const deps = buildHandler();
    const proxyConfig = new Map<
      string,
      { statusId: string | null; value: string | null }
    >([
      [
        EWorkerConfigType.proxy_enabled,
        { statusId: EWorkerConfigStatus.active, value: 'true' },
      ],
      [
        EWorkerConfigType.proxy_protocol,
        { statusId: EWorkerConfigStatus.active, value: EProxyProtocol.http },
      ],
      [
        EWorkerConfigType.proxy_host,
        { statusId: EWorkerConfigStatus.active, value: 'proxy.example.test' },
      ],
      [
        EWorkerConfigType.proxy_port,
        { statusId: EWorkerConfigStatus.active, value: '12484' },
      ],
      [
        EWorkerConfigType.proxy_username,
        { statusId: EWorkerConfigStatus.active, value: 'user' },
      ],
      [
        EWorkerConfigType.proxy_password,
        { statusId: EWorkerConfigStatus.active, value: 'password' },
      ],
    ]);
    deps.workerConfigViewerRepository.fetchConfigValueByType.mockImplementation(
      async (_workerId: string, type: EWorkerConfigType) =>
        proxyConfig.get(type) ?? { statusId: null, value: null }
    );
    deps.workerService.inspectContainerWorkerById.mockResolvedValueOnce(
      buildWorkerContainerInspection({
        container_env: {
          WORKER_ID: 'worker-1',
          ACCOUNT_ID: 'account-1',
          WORKER_TYPE_ID: EWorkerType.wwebjs,
          WORKER_IMAGE: 'under-worker-wwebjs:latest',
          WORKER_GRPC_PORT: '50053',
          PROXY_HOST: 'proxy.example.test',
          PROXY_PORT: '12484',
          PROXY_PROTOCOL: EProxyProtocol.http,
        },
        container_labels: {
          'underchat.worker_id': 'worker-1',
          'underchat.account_id': 'account-1',
          'underchat.worker_type_id': EWorkerType.wwebjs,
          'underchat.worker_image': 'under-worker-wwebjs:latest',
          'underchat.worker_grpc_port': '50053',
          'underchat.proxy_mode': 'proxy',
        },
      })
    );

    const response = await deps.handler.handleRequestConnectionQrCode(
      {
        worker_id: 'worker-1',
        status: EWorkerStatus.online,
        type: EBaileysConnectionType.qrcode,
      },
      'account-1'
    );

    expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();
    expect(deps.workerService.cleanupContainerWorker).not.toHaveBeenCalled();
    expect(response).toEqual(
      expect.objectContaining({
        worker_id: 'worker-1',
        account_id: 'account-1',
        qr_pending: true,
      })
    );
    expect(deps.redisQueueService.enqueue).toHaveBeenCalledTimes(1);
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
    expect(deps.workerService.existsVolumeByName).toHaveBeenCalledWith(
      'worker-1'
    );
    expect(deps.redisQueueService.invalidateWorkerState).toHaveBeenCalledWith(
      'worker-1',
      expect.objectContaining({
        accountId: 'account-1',
        workerTypeId: EWorkerType.wwebjs,
        reason: 'worker_recreate',
        source: 'worker_command_handler',
      })
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
      }),
      'worker-1',
      { requireExistingVolume: true }
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

  it('preserves the mapped runtime volume during recreate', async () => {
    const workerRuntimeRepository = {
      viewByWorkerId: jest.fn(async () => ({
        worker_id: 'worker-1',
        container_id: 'container-old',
        container_name: 'worker-1',
        session_volume_name: 'warm-123',
      })),
      upsert: jest.fn(async () => ({})),
      deleteByWorkerId: jest.fn(async () => true),
    };
    const deps = buildHandler({ workerRuntimeRepository });

    await deps.handler.handle({
      action: EWorkerAction.recreate,
      worker_id: 'worker-1',
      server_id: 'server-1',
      account_id: 'account-1',
    });

    expect(deps.workerService.existsVolumeByName).toHaveBeenCalledWith(
      'warm-123'
    );
    expect(
      deps.workerService.removeContainerByNameAndVolume
    ).toHaveBeenCalledWith('worker-1', 'warm-123', false);
    expect(deps.workerService.removeContainerWorker).not.toHaveBeenCalled();
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
      }),
      'warm-123',
      { requireExistingVolume: true }
    );
    expect(workerRuntimeRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_id: 'worker-1',
        container_id: 'container-1',
        container_name: 'worker-1',
        session_volume_name: 'warm-123',
      })
    );
    expect(
      deps.workerWarmPoolRepository.deleteAssignedByWorkerId
    ).toHaveBeenCalledWith('worker-1', undefined);
  });

  it('aborts recreate before removing the container when the preserved volume is missing', async () => {
    const workerRuntimeRepository = {
      viewByWorkerId: jest.fn(async () => ({
        worker_id: 'worker-1',
        container_id: 'container-old',
        container_name: 'worker-1',
        session_volume_name: 'warm-123',
      })),
      upsert: jest.fn(async () => ({})),
      deleteByWorkerId: jest.fn(async () => true),
    };
    const deps = buildHandler({
      workerRuntimeRepository,
      volumeExists: false,
    });

    await expect(
      deps.handler.handle({
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        server_id: 'server-1',
        account_id: 'account-1',
      })
    ).rejects.toThrow('Worker session volume warm-123 not found');

    expect(
      deps.workerService.removeContainerByNameAndVolume
    ).not.toHaveBeenCalled();
    expect(deps.workerService.removeContainerWorker).not.toHaveBeenCalled();
    expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();
    expect(workerRuntimeRepository.upsert).not.toHaveBeenCalled();
  });

  it('backfills legacy runtime from container session volume metadata during recreate', async () => {
    const workerRuntimeRepository = {
      viewByWorkerId: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          worker_id: 'worker-1',
          container_id: 'container-old',
          container_name: 'worker-1',
          session_volume_name: 'legacy-volume',
        }),
      upsert: jest.fn(async () => ({})),
      deleteByWorkerId: jest.fn(async () => true),
    };
    const deps = buildHandler({
      workerRuntimeRepository,
      workerInspection: buildWorkerContainerInspection({
        container_id: 'container-old',
        container_labels: {
          ...buildWorkerContainerInspection().container_labels,
          'underchat.session_volume_name': 'legacy-volume',
        },
        container_env: {
          ...buildWorkerContainerInspection().container_env,
          SESSION_VOLUME_NAME: 'legacy-volume',
        },
      }),
    });

    await deps.handler.handle({
      action: EWorkerAction.recreate,
      worker_id: 'worker-1',
      server_id: 'server-1',
      account_id: 'account-1',
    });

    expect(workerRuntimeRepository.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        worker_id: 'worker-1',
        container_id: 'container-old',
        container_name: 'worker-1',
        session_volume_name: 'legacy-volume',
      })
    );
    expect(
      deps.workerService.removeContainerByNameAndVolume
    ).toHaveBeenCalledWith('worker-1', 'legacy-volume', false);
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
      }),
      'legacy-volume',
      { requireExistingVolume: true }
    );
  });

  it('backfills legacy runtime with worker id volume when no metadata exists', async () => {
    const workerRuntimeRepository = {
      viewByWorkerId: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          worker_id: 'worker-1',
          container_id: 'container-old',
          container_name: 'worker-1',
          session_volume_name: 'worker-1',
        }),
      upsert: jest.fn(async () => ({})),
      deleteByWorkerId: jest.fn(async () => true),
    };
    const deps = buildHandler({ workerRuntimeRepository });

    await deps.handler.handle({
      action: EWorkerAction.recreate,
      worker_id: 'worker-1',
      server_id: 'server-1',
      account_id: 'account-1',
    });

    expect(workerRuntimeRepository.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        worker_id: 'worker-1',
        container_id: 'container-1',
        container_name: 'worker-1',
        session_volume_name: 'worker-1',
      })
    );
    expect(
      deps.workerService.removeContainerByNameAndVolume
    ).toHaveBeenCalledWith('worker-1', 'worker-1', false);
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
    ).not.toHaveBeenCalled();
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

  it('marks a recreated worker online when runtime health reports an authenticated session', async () => {
    const deps = buildHandler({
      runtimeHealthResponse: {
        worker_type_id: EWorkerType.wwebjs,
        has_session: true,
      },
    });

    await deps.handler.handle({
      action: EWorkerAction.recreate,
      worker_id: 'worker-1',
      server_id: 'server-1',
      account_id: 'account-1',
      previous_worker_status_id: EWorkerStatus.disponible,
    });

    expect(
      deps.workerBaileysGrpcClientService.runtimeHealth
    ).toHaveBeenCalledWith(
      'worker-1',
      { worker_id: 'worker-1' },
      EWorkerType.wwebjs
    );
    expect(
      deps.workerBaileysGrpcClientService.requestConnection
    ).not.toHaveBeenCalled();
    expect(deps.workerService.updateWorkerById).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.online,
        container_id: 'container-1',
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
    ).not.toHaveBeenCalled();
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
