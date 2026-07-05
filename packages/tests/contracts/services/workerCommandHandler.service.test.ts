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
  session_ready: true,
  can_send: true,
  can_receive_runtime: true,
  authenticated: true,
  provider_state: 'connected',
});

const buildConnectingState = () => ({
  status: EBaileysConnectionStatus.connecting,
  code: ECodeMessage.awaitConnection,
  worker_id: 'worker-1',
  account_id: 'account-1',
  phone: '',
  worker_status_id: EWorkerStatus.disponible,
  session_ready: false,
  can_send: false,
  can_receive_runtime: false,
  authenticated: false,
  provider_state: 'connecting',
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
      id: 'worker-1',
      name: 'Canal 1',
      server: { id: 'server-1' } as { id: string } | null,
      type: { id: EWorkerType.wwebjs },
      status: { id: EWorkerStatus.disponible },
    })),
    viewWorkerNameAndId: jest.fn(async () => ({
      id: 'worker-1',
      name: 'Canal 1',
    })),
    viewWorkerPhoneConnectionDate: jest.fn(async () => ({
      id: 'worker-1',
      number: null,
      connection_date: null,
    })),
    updateWorkerPhoneStatusConnectionDate: jest.fn(async () => true),
    viewWorkerForMonitor: jest.fn<Promise<any>, [string]>(async () => ({
      worker_id: 'worker-1',
      name: 'Canal 1',
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
    runtimeHealth: jest.fn<
      Promise<Record<string, unknown>>,
      [string, unknown, EWorkerType]
    >(async () => ({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      activated: true,
      ready: true,
      session_ready: false,
      can_send: false,
      can_receive_runtime: false,
      authenticated: false,
      standby: false,
      has_session: false,
      runtime_state: 'active',
      qr_stream_ready: true,
      provider_state: '',
      phone: '',
      kafka_unhealthy: false,
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
    eval: jest.fn(
      async (
        script: string,
        _keyCount: number,
        key: string,
        token: string,
        ttlMs?: number
      ) => {
        if (script.includes('PEXPIRE')) {
          return redisStore.get(key) === token && ttlMs ? 1 : 0;
        }

        if (script.includes('DEL')) {
          if (redisStore.get(key) !== token) {
            return 0;
          }

          redisStore.delete(key);
          return 1;
        }

        return 0;
      }
    ),
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

const seedActiveQrAttempt = (
  redisStore: Map<string, string>,
  {
    workerId = 'worker-1',
    workerTypeId = EWorkerType.wwebjs,
    connectionAttemptId,
    runtimeGeneration = 1,
  }: {
    workerId?: string;
    workerTypeId?: EWorkerType;
    connectionAttemptId: string;
    runtimeGeneration?: number;
  }
): void => {
  redisStore.set(
    `connection:qrcode:${workerTypeId}:${workerId}:active_attempt`,
    JSON.stringify({
      ack: {
        worker_id: workerId,
        account_id: 'account-1',
        worker_type_id: workerTypeId,
        connection_attempt_id: connectionAttemptId,
        runtime_generation: runtimeGeneration,
      },
      queued_at: new Date().toISOString(),
      stream_key: `connection:qrcode:${workerTypeId}:${workerId}:requests`,
      consumer_group: `connection:qrcode:${workerTypeId}:${workerId}:group`,
      source: 'manager',
      worker_type_id: workerTypeId,
      runtime_generation: runtimeGeneration,
    })
  );
};

describe('WorkerCommandHandlerService connection', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('accepts self-heal requests by scheduling recreate without removing session or volume', async () => {
    const deps = buildHandler();
    const handleSpy = jest
      .spyOn(deps.handler, 'handle')
      .mockResolvedValueOnce(undefined);

    await deps.handler.requestWorkerSelfHealing({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      source: 'health_monitor',
      reason: 'send_probe_failed',
      provider_state: 'connected',
      degraded_reason: 'send_probe_failed',
      kafka_unhealthy: false,
      runtime_generation: 4,
      recovery_window_seconds: 600,
      debug_trace_id: 'trace-1',
    });

    expect(deps.workerService.updateWorkerById).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.recreating,
        lifecycle_operation_id: 'uuid-v7',
      })
    );
    expect(deps.redisStore.get('worker:self-heal:recovery:worker-1')).toContain(
      'send_probe_failed'
    );
    expect(handleSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        previous_worker_status_id: EWorkerStatus.disponible,
        lifecycle_operation_id: 'uuid-v7',
      })
    );
    const recreatePayload = handleSpy.mock.calls[0]?.[0] as unknown as Record<
      string,
      unknown
    >;
    expect(recreatePayload).not.toHaveProperty('remove_session');
    expect(recreatePayload).not.toHaveProperty('remove_volume');
  });

  it('deduplicates self-heal requests when another recreate is inflight', async () => {
    const deps = buildHandler();
    const handleSpy = jest.spyOn(deps.handler, 'handle');
    deps.redisStore.set('worker:self-heal:inflight:worker-1', 'existing');

    await deps.handler.requestWorkerSelfHealing({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      source: 'health_monitor',
      reason: 'kafka_unhealthy',
      kafka_unhealthy: true,
    });

    expect(handleSpy).not.toHaveBeenCalled();
    expect(deps.workerService.updateWorkerById).not.toHaveBeenCalled();
  });

  it('uses and releases a per-server recreate slot in the real recreate flow', async () => {
    const deps = buildHandler();

    await deps.handler.handle({
      action: EWorkerAction.recreate,
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.wwebjs,
      previous_worker_status_id: EWorkerStatus.online,
    });

    expect(deps.redis.set).toHaveBeenCalledWith(
      'worker:recreate:server:server-1:slot:0',
      expect.stringContaining('worker-1:'),
      'PX',
      expect.any(Number),
      'NX'
    );
    expect(deps.redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('DEL'),
      1,
      'worker:recreate:server:server-1:slot:0',
      expect.stringContaining('worker-1:')
    );
    expect(deps.workerService.createContainerWorker).toHaveBeenCalledWith(
      expect.any(String),
      'worker-1',
      'account-1',
      false,
      expect.any(String),
      expect.any(Number),
      undefined,
      expect.objectContaining({ workerTypeId: EWorkerType.wwebjs }),
      'worker-1',
      { requireExistingVolume: true }
    );
  });

  it('adopts and releases a reserved per-server recreate slot', async () => {
    const deps = buildHandler();
    const slotKey = 'worker:recreate:server:server-1:slot:0';
    const slotToken = 'worker-1:reserved-token';
    deps.redisStore.set(slotKey, slotToken);

    await deps.handler.handle({
      action: EWorkerAction.recreate,
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.wwebjs,
      previous_worker_status_id: EWorkerStatus.online,
      recreate_server_slot_key: slotKey,
      recreate_server_slot_token: slotToken,
    });

    expect(deps.redis.set).not.toHaveBeenCalledWith(
      slotKey,
      expect.any(String),
      'PX',
      expect.any(Number),
      'NX'
    );
    expect(deps.redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('PEXPIRE'),
      1,
      slotKey,
      slotToken,
      expect.any(Number)
    );
    expect(deps.redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('DEL'),
      1,
      slotKey,
      slotToken
    );
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
      id: 'worker-1',
      name: 'Canal 1',
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

  it('rejects online worker status notifications without session readiness', async () => {
    const deps = buildHandler();

    await deps.handler.notifyWorkerStatus({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_status_id: EWorkerStatus.online,
      status: EBaileysConnectionStatus.connected,
      code: ECodeMessage.connectionEstablished,
      phone: '+556192037138',
    });

    expect(
      deps.workerService.updateWorkerPhoneStatusConnectionDate
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_id: 'worker-1',
        status: EWorkerStatus.disponible,
        number: '+556192037138',
      })
    );
    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      'worker:account#account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_status_id: EWorkerStatus.disponible,
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitConnection,
        session_ready: false,
        degraded_reason: 'online_without_session_ready',
      })
    );
  });

  it('enriches worker status notifications with worker name before publishing', async () => {
    const deps = buildHandler();

    await deps.handler.notifyWorkerStatus({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_status_id: EWorkerStatus.disponible,
      disconnected_user: true,
    });

    expect(deps.workerService.viewWorkerNameAndId).toHaveBeenCalledWith(
      'account-1',
      'worker-1'
    );
    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      'worker:account#account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_name: 'Canal 1',
        worker_status_id: EWorkerStatus.disponible,
      })
    );
  });

  it('publishes worker status notifications when worker name lookup fails', async () => {
    const deps = buildHandler();
    deps.workerService.viewWorkerNameAndId.mockRejectedValueOnce(
      new Error('database unavailable')
    );

    await expect(
      deps.handler.notifyWorkerStatus({
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_status_id: EWorkerStatus.disponible,
        disconnected_user: true,
      })
    ).resolves.toBeUndefined();

    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      'worker:account#account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_status_id: EWorkerStatus.disponible,
      })
    );
    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      'worker:account#account-1',
      expect.not.objectContaining({
        worker_name: expect.any(String),
      })
    );
  });

  it('uses worker_type_id from NotifyWorkerStatus to confirm online readiness through runtime health', async () => {
    const deps = buildHandler();
    deps.workerService.viewWorker.mockResolvedValueOnce({
      id: 'worker-1',
      name: 'Canal 1',
      server: { id: 'server-1' },
      type: { id: EWorkerType.whatsmeow },
      status: { id: EWorkerStatus.disponible },
    });
    deps.workerBaileysGrpcClientService.runtimeHealth.mockResolvedValueOnce({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.whatsmeow,
      activated: true,
      ready: true,
      session_ready: true,
      can_send: true,
      can_receive_runtime: true,
      authenticated: true,
      standby: false,
      has_session: true,
      runtime_state: 'active',
      qr_stream_ready: true,
      provider_state: 'CONNECTED',
      phone: '',
    });

    await deps.handler.notifyWorkerStatus({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.whatsmeow,
      worker_status_id: EWorkerStatus.online,
      status: EBaileysConnectionStatus.connected,
      code: ECodeMessage.connectionEstablished,
      phone: '+556192037138',
    });

    expect(
      deps.workerBaileysGrpcClientService.runtimeHealth
    ).toHaveBeenCalledWith(
      'worker-1',
      { worker_id: 'worker-1' },
      EWorkerType.whatsmeow
    );
    expect(
      deps.workerService.updateWorkerPhoneStatusConnectionDate
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_id: 'worker-1',
        status: EWorkerStatus.online,
        number: '+556192037138',
        connection_date: expect.any(String),
      })
    );
    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      'worker:account#account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.whatsmeow,
        worker_status_id: EWorkerStatus.online,
        session_ready: true,
      })
    );
  });

  it('backfills the phone from runtime health when a strict online notification arrives without a phone', async () => {
    const deps = buildHandler();
    deps.workerBaileysGrpcClientService.runtimeHealth.mockResolvedValueOnce({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      activated: true,
      ready: true,
      session_ready: true,
      can_send: true,
      can_receive_runtime: true,
      authenticated: true,
      standby: false,
      has_session: true,
      runtime_state: 'active',
      qr_stream_ready: true,
      provider_state: 'CONNECTED',
      phone: '5561888887777',
    });

    await deps.handler.notifyWorkerStatus({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      worker_status_id: EWorkerStatus.online,
      status: EBaileysConnectionStatus.connected,
      code: ECodeMessage.connectionEstablished,
      session_ready: true,
      can_send: true,
      can_receive_runtime: true,
      authenticated: true,
    });

    expect(
      deps.workerBaileysGrpcClientService.runtimeHealth
    ).toHaveBeenCalledWith(
      'worker-1',
      { worker_id: 'worker-1' },
      EWorkerType.wwebjs
    );
    expect(
      deps.workerService.updateWorkerPhoneStatusConnectionDate
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_id: 'worker-1',
        status: EWorkerStatus.online,
        number: '5561888887777',
        connection_date: expect.any(String),
      })
    );
    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      'worker:account#account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.online,
        phone: '5561888887777',
        session_ready: true,
      })
    );
  });

  it('rejects online notifications when runtime health reports unhealthy Kafka', async () => {
    const deps = buildHandler();
    deps.workerBaileysGrpcClientService.runtimeHealth.mockResolvedValueOnce({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      activated: true,
      ready: true,
      session_ready: true,
      can_send: true,
      can_receive_runtime: true,
      authenticated: true,
      standby: false,
      has_session: true,
      runtime_state: 'active',
      qr_stream_ready: true,
      provider_state: 'CONNECTED',
      phone: '556192037138',
      kafka_unhealthy: true,
    });

    await deps.handler.notifyWorkerStatus({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      worker_status_id: EWorkerStatus.online,
      status: EBaileysConnectionStatus.connected,
      code: ECodeMessage.connectionEstablished,
      phone: '556192037138',
      session_ready: true,
      can_send: true,
      can_receive_runtime: true,
      authenticated: true,
    });

    expect(
      deps.workerService.updateWorkerPhoneStatusConnectionDate
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_id: 'worker-1',
        status: EWorkerStatus.disponible,
        connection_date: null,
      })
    );
    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      'worker:account#account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.disponible,
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitConnection,
        session_ready: false,
        can_send: false,
        can_receive_runtime: false,
        authenticated: false,
      })
    );
  });

  it('ignores stale runtime generation notifications before updating or publishing', async () => {
    const deps = buildHandler({
      workerRuntimeRepository: {
        viewByWorkerId: jest.fn(async () => ({
          worker_id: 'worker-1',
          container_id: 'container-current',
          container_name: 'worker-1',
          session_volume_name: 'worker-1',
          runtime_generation: 5,
          warm_pool_id: null,
        })),
        upsert: jest.fn(async () => null),
        deleteByWorkerId: jest.fn(async () => undefined),
      },
    });

    await deps.handler.notifyWorkerStatus({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      worker_status_id: EWorkerStatus.online,
      status: EBaileysConnectionStatus.connected,
      code: ECodeMessage.connectionEstablished,
      phone: '556192037138',
      session_ready: true,
      can_send: true,
      can_receive_runtime: true,
      authenticated: true,
      runtime_generation: 4,
    });

    expect(
      deps.workerService.updateWorkerPhoneStatusConnectionDate
    ).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publishSub).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publish).not.toHaveBeenCalled();
    expect(
      deps.workerBaileysGrpcClientService.runtimeHealth
    ).not.toHaveBeenCalled();
  });

  it('promotes a non-online notification to online when runtime health confirms a real session', async () => {
    const deps = buildHandler();
    deps.workerBaileysGrpcClientService.runtimeHealth.mockResolvedValueOnce({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      activated: true,
      ready: true,
      session_ready: true,
      can_send: true,
      can_receive_runtime: true,
      authenticated: true,
      standby: false,
      has_session: true,
      runtime_state: 'active',
      qr_stream_ready: true,
      provider_state: 'CONNECTED',
      phone: '556192037138',
    });

    await deps.handler.notifyWorkerStatus({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      worker_status_id: EWorkerStatus.disponible,
      status: EBaileysConnectionStatus.connecting,
      code: ECodeMessage.awaitConnection,
      reason: 'late_connecting_event',
    });

    expect(
      deps.workerBaileysGrpcClientService.runtimeHealth
    ).toHaveBeenCalledWith(
      'worker-1',
      { worker_id: 'worker-1' },
      EWorkerType.wwebjs
    );
    expect(
      deps.workerService.updateWorkerPhoneStatusConnectionDate
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_id: 'worker-1',
        status: EWorkerStatus.online,
        number: '556192037138',
        connection_date: expect.any(String),
      })
    );
    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      'worker:account#account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
        worker_status_id: EWorkerStatus.online,
        status: EBaileysConnectionStatus.connected,
        code: ECodeMessage.connectionEstablished,
        session_ready: true,
        phone: '556192037138',
      })
    );
  });

  it('does not promote a strong logout notification even when runtime health is stale-ready', async () => {
    const deps = buildHandler({
      runtimeHealthResponse: {
        session_ready: true,
        can_send: true,
        can_receive_runtime: true,
        authenticated: true,
        has_session: true,
      },
    });

    await deps.handler.notifyWorkerStatus({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      worker_status_id: EWorkerStatus.disponible,
      status: EBaileysConnectionStatus.disconnected,
      code: ECodeMessage.loggedOut,
      disconnected_user: true,
    });

    expect(
      deps.workerBaileysGrpcClientService.runtimeHealth
    ).not.toHaveBeenCalled();
    expect(deps.workerService.updateWorkerById).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.disponible,
        number: null,
        connection_date: null,
      })
    );
    expect(
      deps.workerService.updateWorkerPhoneStatusConnectionDate
    ).not.toHaveBeenCalled();
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

  it('caches passkey request over a QR cached for the same active attempt', async () => {
    const deps = buildHandler();
    seedActiveQrAttempt(deps.redisStore, {
      connectionAttemptId: 'attempt-1',
      runtimeGeneration: 1,
    });
    deps.redisStore.set(
      `connection:qrcode:${EWorkerType.wwebjs}:worker-1:attempt`,
      JSON.stringify({
        code: ECodeMessage.awaitingReadQrCode,
        status: EBaileysConnectionStatus.connecting,
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
        connection_attempt_id: 'attempt-1',
        runtime_generation: 1,
        qrcode: 'data:image/png;base64,qr',
        qr_pending: false,
        qr_generated_at: new Date().toISOString(),
      })
    );

    await deps.handler.notifyWorkerStatus({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      worker_status_id: EWorkerStatus.disponible,
      status: EBaileysConnectionStatus.connecting,
      code: ECodeMessage.awaitingPasskey,
      passkey_public_key: '{"challenge":"abc"}',
      passkey_pending: true,
      connection_attempt_id: 'attempt-1',
      runtime_generation: 1,
    });

    const cached = JSON.parse(
      deps.redisStore.get(
        `connection:qrcode:${EWorkerType.wwebjs}:worker-1:attempt`
      ) ?? '{}'
    ) as IBaileysConnectionState;

    expect(cached).toEqual(
      expect.objectContaining({
        code: ECodeMessage.awaitingPasskey,
        connection_attempt_id: 'attempt-1',
        passkey_public_key: '{"challenge":"abc"}',
        passkey_pending: true,
        qr_pending: false,
      })
    );
    expect(cached.qrcode).toBeUndefined();
    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      'worker:account#account-1',
      expect.objectContaining({
        code: ECodeMessage.awaitingPasskey,
        passkey_public_key: '{"challenge":"abc"}',
        connection_attempt_id: 'attempt-1',
      })
    );
  });

  it('keeps a QR notification when a newer active request raced ahead', async () => {
    const deps = buildHandler();
    seedActiveQrAttempt(deps.redisStore, {
      connectionAttemptId: 'attempt-newer',
      runtimeGeneration: 1,
    });

    await deps.handler.notifyWorkerStatus({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_status_id: EWorkerStatus.disponible,
      status: EBaileysConnectionStatus.connecting,
      code: ECodeMessage.awaitingReadQrCode,
      qrcode: 'data:image/png;base64,first-valid-qr',
      connection_attempt_id: 'attempt-first',
      runtime_generation: 1,
      qr_generated_at: new Date().toISOString(),
    });

    expect(deps.redis.setex).toHaveBeenCalledWith(
      `connection:qrcode:${EWorkerType.wwebjs}:worker-1:attempt`,
      expect.any(Number),
      expect.stringContaining('"connection_attempt_id":"attempt-first"')
    );
    expect(deps.redis.setex).toHaveBeenCalledWith(
      `connection:qrcode:${EWorkerType.wwebjs}:worker-1:attempt`,
      expect.any(Number),
      expect.stringContaining('"qrcode":"data:image/png;base64,first-valid-qr"')
    );
    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      'worker:account#account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        account_id: 'account-1',
        qrcode: 'data:image/png;base64,first-valid-qr',
        connection_attempt_id: 'attempt-first',
        qr_pending: false,
      })
    );
  });

  it('skips stale disconnected notifications from a superseded QR attempt', async () => {
    const deps = buildHandler();
    seedActiveQrAttempt(deps.redisStore, {
      connectionAttemptId: 'attempt-newer',
      runtimeGeneration: 1,
    });

    await deps.handler.notifyWorkerStatus({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_status_id: EWorkerStatus.disponible,
      status: EBaileysConnectionStatus.disconnected,
      code: ECodeMessage.connectionClosed,
      connection_attempt_id: 'attempt-first',
      runtime_generation: 1,
    });

    expect(
      deps.workerService.updateWorkerPhoneStatusConnectionDate
    ).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publishSub).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publish).not.toHaveBeenCalled();
  });

  it('skips disconnected notifications without attempt while a QR attempt is active', async () => {
    const deps = buildHandler();
    seedActiveQrAttempt(deps.redisStore, {
      connectionAttemptId: 'attempt-active',
      runtimeGeneration: 1,
    });

    await deps.handler.notifyWorkerStatus({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_status_id: EWorkerStatus.offline,
      status: EBaileysConnectionStatus.disconnected,
      code: ECodeMessage.connectionClosed,
    });

    expect(
      deps.workerService.updateWorkerPhoneStatusConnectionDate
    ).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publishSub).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publish).not.toHaveBeenCalled();
  });

  it('persists a connected notification even when a QR is cached for the same attempt', async () => {
    const deps = buildHandler({
      runtimeHealthResponse: {
        session_ready: true,
        can_send: true,
        can_receive_runtime: true,
        authenticated: true,
        has_session: true,
        phone: '556192037138',
      },
    });
    seedActiveQrAttempt(deps.redisStore, {
      connectionAttemptId: 'attempt-active',
      runtimeGeneration: 1,
    });
    deps.redisStore.set(
      `connection:qrcode:${EWorkerType.wwebjs}:worker-1:attempt`,
      JSON.stringify({
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
        worker_status_id: EWorkerStatus.disponible,
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitingReadQrCode,
        qrcode: 'data:image/png;base64,cached-qr',
        connection_attempt_id: 'attempt-active',
        runtime_generation: 1,
        qr_generated_at: new Date().toISOString(),
      })
    );

    await deps.handler.notifyWorkerStatus({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      worker_status_id: EWorkerStatus.online,
      status: EBaileysConnectionStatus.connected,
      code: ECodeMessage.connectionEstablished,
      phone: '556192037138',
      session_ready: true,
      can_send: true,
      can_receive_runtime: true,
      authenticated: true,
      provider_state: 'CONNECTED',
      connection_attempt_id: 'attempt-active',
      runtime_generation: 1,
    });

    expect(
      deps.workerService.updateWorkerPhoneStatusConnectionDate
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_id: 'worker-1',
        status: EWorkerStatus.online,
        number: '556192037138',
        connection_date: expect.any(String),
      })
    );
    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      'worker:account#account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.online,
        status: EBaileysConnectionStatus.connected,
        code: ECodeMessage.connectionEstablished,
        session_ready: true,
        phone: '556192037138',
      })
    );
    expect(
      deps.redisStore.has(
        `connection:qrcode:${EWorkerType.wwebjs}:worker-1:attempt`
      )
    ).toBe(false);
    expect(
      deps.redisStore.has(
        `connection:qrcode:${EWorkerType.wwebjs}:worker-1:active_attempt`
      )
    ).toBe(false);
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

  it('returns a cached passkey request instead of enqueueing a new QR attempt', async () => {
    const deps = buildHandler();
    deps.redisStore.set(
      `connection:qrcode:${EWorkerType.wwebjs}:worker-1:attempt`,
      JSON.stringify({
        code: ECodeMessage.awaitingPasskey,
        status: EBaileysConnectionStatus.connecting,
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
        connection_attempt_id: 'attempt-passkey',
        passkey_public_key: '{"challenge":"abc"}',
        passkey_pending: true,
        qr_pending: false,
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

    expect(response).toEqual(
      expect.objectContaining({
        code: ECodeMessage.awaitingPasskey,
        connection_attempt_id: 'attempt-passkey',
        passkey_public_key: '{"challenge":"abc"}',
        passkey_pending: true,
        qr_pending: false,
      })
    );
    expect(response.qrcode).toBeUndefined();
    expect(deps.redisQueueService.enqueue).not.toHaveBeenCalled();
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

  it('increments runtime generation when warm activation replaces a reset runtime', async () => {
    const workerRuntimeRepository = {
      viewByWorkerId: jest.fn(async () => ({
        worker_id: 'worker-1',
        container_id: 'container-old',
        container_name: 'worker-1',
        session_volume_name: 'old-volume',
        runtime_generation: 7,
      })),
      upsert: jest.fn(async (input: unknown) => input),
      deleteByWorkerId: jest.fn(async () => true),
    };
    const deps = buildHandler({ workerRuntimeRepository });
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

    expect(workerRuntimeRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_id: 'worker-1',
        container_id: 'activated-container',
        container_name: 'worker-1',
        session_volume_name: 'warm-volume',
        runtime_generation: 8,
      })
    );
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

  it('does not create runtime for official whatsapp workers', async () => {
    const deps = buildHandler();

    await deps.handler.handle({
      action: EWorkerAction.create,
      worker_id: 'worker-1',
      server_id: 'server-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.whatsapp,
    });

    expect(deps.workerService.updateWorkerById).not.toHaveBeenCalled();
    expect(deps.kafkaBaileysQueueService.ensure).not.toHaveBeenCalled();
    expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();
    expect(
      deps.workerBaileysGrpcClientService.waitForReady
    ).not.toHaveBeenCalled();
  });

  it('does not mark official whatsapp workers as error when runtime handling fails', async () => {
    const deps = buildHandler();
    deps.workerService.viewWorker.mockResolvedValue({
      id: 'worker-1',
      name: 'Official',
      server: null,
      type: { id: EWorkerType.whatsapp },
      status: { id: EWorkerStatus.online },
    });
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

    expect(
      deps.workerService.updateWorkerById.mock.calls.some(
        ([, input]) =>
          getWorkerStatusFromUpdateInput(input) === EWorkerStatus.error
      )
    ).toBe(false);
    expect(deps.centrifugoService.publishSub).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ worker_status_id: EWorkerStatus.error })
    );
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

  it('increments runtime generation when recreate resets the session volume', async () => {
    const workerRuntimeRepository = {
      viewByWorkerId: jest.fn(async () => ({
        worker_id: 'worker-1',
        container_id: 'container-old',
        container_name: 'worker-1',
        session_volume_name: 'old-volume',
        runtime_generation: 4,
      })),
      upsert: jest.fn(async (input: unknown) => input),
      deleteByWorkerId: jest.fn(async () => true),
    };
    const deps = buildHandler({ workerRuntimeRepository });

    await deps.handler.handle({
      action: EWorkerAction.recreate,
      worker_id: 'worker-1',
      server_id: 'server-1',
      account_id: 'account-1',
      remove_session: true,
      remove_volume: true,
    });

    expect(
      deps.workerService.removeContainerByNameAndVolume
    ).toHaveBeenCalledWith('worker-1', 'old-volume', true);
    expect(workerRuntimeRepository.deleteByWorkerId).toHaveBeenCalledWith(
      'worker-1'
    );
    expect(workerRuntimeRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_id: 'worker-1',
        container_id: 'container-1',
        container_name: 'worker-1',
        session_volume_name: 'worker-1',
        runtime_generation: 5,
      })
    );
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

  it('backfills the phone from runtime health when a recreated worker reconnects without a phone in the connection response', async () => {
    const deps = buildHandler();
    deps.workerBaileysGrpcClientService.requestConnection.mockResolvedValueOnce(
      {
        ...buildConnectedState(),
        phone: '',
      }
    );
    deps.workerBaileysGrpcClientService.runtimeHealth.mockResolvedValueOnce({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      activated: true,
      ready: true,
      session_ready: true,
      can_send: true,
      can_receive_runtime: true,
      authenticated: true,
      standby: false,
      has_session: true,
      runtime_state: 'active',
      qr_stream_ready: true,
      provider_state: 'CONNECTED',
      phone: '5561999999999',
    });

    await deps.handler.handle({
      action: EWorkerAction.recreate,
      worker_id: 'worker-1',
      server_id: 'server-1',
      account_id: 'account-1',
      previous_worker_status_id: EWorkerStatus.online,
    });

    expect(
      deps.workerBaileysGrpcClientService.runtimeHealth
    ).toHaveBeenCalledWith(
      'worker-1',
      { worker_id: 'worker-1' },
      EWorkerType.wwebjs
    );
    expect(deps.workerService.updateWorkerById).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.online,
        container_id: 'container-1',
        number: '5561999999999',
        connection_date: expect.any(String),
      })
    );
    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      expect.stringContaining('account-1'),
      expect.objectContaining({
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_status_id: EWorkerStatus.online,
        phone: '5561999999999',
        session_ready: true,
        can_send: true,
        can_receive_runtime: true,
        authenticated: true,
      })
    );
  });

  it('waits briefly for runtime health before downgrading an online worker after recreate', async () => {
    const deps = buildHandler();
    (deps.handler as any).recreateOnlineReconciliationWaitMs = 25;
    (deps.handler as any).recreateOnlineReconciliationPollIntervalMs = 1;
    deps.workerBaileysGrpcClientService.requestConnection.mockResolvedValueOnce(
      buildConnectingState()
    );
    deps.workerBaileysGrpcClientService.runtimeHealth
      .mockResolvedValueOnce({
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
        activated: true,
        ready: true,
        session_ready: false,
        can_send: false,
        can_receive_runtime: false,
        authenticated: false,
        standby: false,
        has_session: false,
        runtime_state: 'active',
        qr_stream_ready: true,
        provider_state: 'CONNECTING',
        phone: '',
      })
      .mockResolvedValueOnce({
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
        activated: true,
        ready: true,
        session_ready: true,
        can_send: true,
        can_receive_runtime: true,
        authenticated: true,
        standby: false,
        has_session: true,
        runtime_state: 'active',
        qr_stream_ready: true,
        provider_state: 'CONNECTED',
        phone: '556192037138',
      });

    await deps.handler.handle({
      action: EWorkerAction.recreate,
      worker_id: 'worker-1',
      server_id: 'server-1',
      account_id: 'account-1',
      previous_worker_status_id: EWorkerStatus.online,
    });

    expect(
      deps.workerBaileysGrpcClientService.runtimeHealth
    ).toHaveBeenCalledWith(
      'worker-1',
      { worker_id: 'worker-1' },
      EWorkerType.wwebjs
    );
    expect(deps.workerService.updateWorkerById).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.online,
        container_id: 'container-1',
      })
    );
  });

  it('does not mark a recreated worker online without a connected response or health confirmation', async () => {
    const deps = buildHandler();
    (deps.handler as any).recreateOnlineReconciliationWaitMs = 1;
    (deps.handler as any).recreateOnlineReconciliationPollIntervalMs = 0;
    deps.workerBaileysGrpcClientService.requestConnection.mockResolvedValueOnce(
      buildConnectingState()
    );
    deps.workerBaileysGrpcClientService.runtimeHealth.mockResolvedValue({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      activated: true,
      ready: true,
      session_ready: false,
      can_send: false,
      can_receive_runtime: false,
      authenticated: false,
      standby: false,
      has_session: false,
      runtime_state: 'active',
      qr_stream_ready: true,
      provider_state: 'CONNECTING',
      phone: '',
    });

    await deps.handler.handle({
      action: EWorkerAction.recreate,
      worker_id: 'worker-1',
      server_id: 'server-1',
      account_id: 'account-1',
      previous_worker_status_id: EWorkerStatus.online,
    });

    expect(deps.workerService.updateWorkerById).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.disponible,
        container_id: 'container-1',
      })
    );
    expect(deps.workerService.updateWorkerById).not.toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.online,
      })
    );
  });

  it('marks a recreated worker online when runtime health reports an authenticated session', async () => {
    const deps = buildHandler({
      runtimeHealthResponse: {
        worker_type_id: EWorkerType.wwebjs,
        session_ready: true,
        can_send: true,
        can_receive_runtime: true,
        authenticated: true,
        has_session: true,
        phone: '556192037138',
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

  it('waits for runtime health before leaving a recreated disponible worker disponible', async () => {
    const deps = buildHandler();
    (deps.handler as any).recreateOnlineReconciliationWaitMs = 25;
    (deps.handler as any).recreateOnlineReconciliationPollIntervalMs = 1;
    deps.workerBaileysGrpcClientService.runtimeHealth
      .mockResolvedValueOnce({
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
        activated: true,
        ready: true,
        session_ready: false,
        can_send: false,
        can_receive_runtime: false,
        authenticated: false,
        standby: false,
        has_session: true,
        runtime_state: 'active',
        qr_stream_ready: true,
        provider_state: 'CONNECTING',
        phone: '',
      })
      .mockResolvedValueOnce({
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
        activated: true,
        ready: true,
        session_ready: true,
        can_send: true,
        can_receive_runtime: true,
        authenticated: true,
        standby: false,
        has_session: true,
        runtime_state: 'active',
        qr_stream_ready: true,
        provider_state: 'CONNECTED',
        phone: '556192037138',
      });

    await deps.handler.handle({
      action: EWorkerAction.recreate,
      worker_id: 'worker-1',
      server_id: 'server-1',
      account_id: 'account-1',
      previous_worker_status_id: EWorkerStatus.disponible,
    });

    expect(
      deps.workerBaileysGrpcClientService.requestConnection
    ).not.toHaveBeenCalled();
    expect(
      deps.workerBaileysGrpcClientService.runtimeHealth
    ).toHaveBeenCalledTimes(2);
    expect(deps.workerService.updateWorkerById).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.online,
        container_id: 'container-1',
        number: '556192037138',
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
  function buildActualWorkerService(): WorkerService {
    const { WorkerService: ActualWorkerService } = jest.requireActual<
      typeof import('@core/services/worker.service')
    >('@core/services/worker.service');

    return Object.create(ActualWorkerService.prototype) as WorkerService;
  }

  it('treats missing container and volume as a successful cleanup', async () => {
    const workerService = buildActualWorkerService();
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

  it('does not warn when a Docker volume existence check returns not found', async () => {
    const workerService = buildActualWorkerService();
    const notFoundError = Object.assign(new Error('no such volume'), {
      statusCode: 404,
    });
    (
      workerService as unknown as {
        docker: {
          getVolume: jest.Mock;
        };
      }
    ).docker = {
      getVolume: jest.fn(() => ({
        inspect: jest.fn(async () => {
          throw notFoundError;
        }),
      })),
    };
    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    await expect(
      workerService.existsVolumeByName('warm-missing')
    ).resolves.toBe(false);

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('still warns when a Docker volume existence check fails unexpectedly', async () => {
    const workerService = buildActualWorkerService();
    const dockerError = Object.assign(new Error('docker daemon unavailable'), {
      statusCode: 500,
    });
    (
      workerService as unknown as {
        docker: {
          getVolume: jest.Mock;
        };
      }
    ).docker = {
      getVolume: jest.fn(() => ({
        inspect: jest.fn(async () => {
          throw dockerError;
        }),
      })),
    };
    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    await expect(workerService.existsVolumeByName('warm-error')).resolves.toBe(
      false
    );

    expect(warnSpy).toHaveBeenCalledWith(
      'Volume warm-error does not exist or is inaccessible:',
      { error: 'docker daemon unavailable' }
    );
    warnSpy.mockRestore();
  });
});
