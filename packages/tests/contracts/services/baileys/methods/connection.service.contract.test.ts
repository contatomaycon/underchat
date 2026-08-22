import 'reflect-metadata';
import { EventEmitter } from 'node:events';

const mockEmitWorkerProviderRuntimeState = jest.fn<
  Promise<void>,
  [provider: string, ready: boolean]
>(async () => undefined);

jest.mock('@whiskeysockets/baileys', () => ({
  Browsers: {
    macOS: jest.fn((browser: string) => ['Mac OS', browser, '14.4.1']),
  },
  DEFAULT_CONNECTION_CONFIG: {
    version: [2, 3000, 1035194821],
  },
  fetchLatestBaileysVersion: jest.fn(async () => ({
    version: [2, 3000, 0],
  })),
  fetchLatestWaWebVersion: jest.fn(async () => ({
    version: [2, 3000, 0],
  })),
  makeWASocket: jest.fn(),
  useMultiFileAuthState: jest.fn(async () => ({
    state: {},
    saveCreds: jest.fn(async () => undefined),
  })),
}));

jest.mock('@core/config/environments', () => ({
  baileysEnvironment: {
    baileysAccountId: 'account-b',
    baileysWorkerId: 'worker-b',
    runtimeGeneration: 17,
  },
}));

jest.mock('@core/common/functions/centrifugoQueue', () => ({
  workerCentrifugoQueue: (accountId: string) => `worker-${accountId}`,
}));

jest.mock('@core/common/functions/workerProviderRuntimeState', () => ({
  emitWorkerProviderRuntimeState: (provider: string, ready: boolean) =>
    mockEmitWorkerProviderRuntimeState(provider, ready),
}));

jest.mock('@core/services/balanceWorkerStatusGrpcClient.service', () => ({
  BalanceWorkerStatusGrpcClientService: class {},
}));

jest.mock('@core/services/centrifugo.service', () => ({
  CentrifugoService: class {},
}));

jest.mock('@core/services/elasticDatabase.service', () => ({
  ElasticDatabaseService: class {},
}));

jest.mock('@core/services/baileys/methods/incoming.service', () => ({
  BaileysIncomingMessageService: class {},
}));

jest.mock('@core/services/baileys/methods/healthCheck.service', () => ({
  BaileysHealthCheckService: class {},
}));

import { EBaileysConnectionStatus as Status } from '@core/common/enums/EBaileysConnectionStatus';
import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWhatsappConnectionStatus } from '@core/common/enums/EWhatsappConnectionStatus';
import {
  isWorkerKafkaDispatchAuthorized,
  setWorkerKafkaDispatchAuthorized,
} from '@core/common/functions/workerKafkaDispatchAuthorization';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { IBaileysConnection } from '@core/common/interfaces/IBaileysConnection';
import { BaileysConnectionService } from '@core/services/baileys/methods/connection.service';
import { BaileysProviderProtocolFailureError } from '@core/services/baileys/util/providerOperationFailure';
import {
  BaileysCanonicalCodecError,
  BaileysPostgresAuthStateStore,
  BaileysSessionFenceError,
  type BaileysPostQuantumRollbackMarker,
} from '@core/services/baileys/stores/postgresAuthState.store';
import {
  Browsers,
  fetchLatestBaileysVersion,
  fetchLatestWaWebVersion,
  makeWASocket,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';

type WorkerStatusNotificationResult =
  | { outcome: 'accepted' }
  | { outcome: 'deferred'; reason: 'command_ingress_positioning' }
  | {
      outcome: 'failed';
      classification: 'recoverable' | 'terminal';
      reason: string;
      grpcCode?: number;
    };

type BaileysConnectionServicePrivate = {
  connecting: boolean;
  initialConnection: boolean;
  typeConnection: EBaileysConnectionType;
  qrReadSessionActive: boolean;
  qrReadSessionLocked: boolean;
  qrLifecycleReconnectAuthorized: boolean;
  qrGenerationCount: number;
  retryCount: number;
  qrRenewalTimer?: ReturnType<typeof setTimeout>;
  qrHash?: string;
  userRequestedDisconnect: boolean;
  disconnectFlight?: Promise<void>;
  disconnectFlightRemovesSession: boolean;
  explicitSessionRemovalInFlight: boolean;
  explicitSessionRemovalFlight?: Promise<void>;
  explicitSessionRemovalSocketId?: number;
  sessionClearFlight?: Promise<void>;
  connectionAttemptId?: string;
  runtimeFenceConnectionAuthorization?: {
    connection_epoch: string;
    connection_attempt_id?: string;
  };
  currentPromise?: Promise<IBaileysConnectionState>;
  reconnectRetryTimer?: ReturnType<typeof setTimeout>;
  runtimeGeneration?: number;
  socket?: unknown;
  postgresAuthStore?: {
    clearSession?: () => Promise<void>;
    close: () => Promise<void>;
    openForHandoff?: () => Promise<unknown>;
    loadAuthenticationState?: () => Promise<unknown>;
    hasRestorableSessionCached?: () => boolean;
    hasPendingHandoff?: () => boolean;
    authorizeHandoff?: (input: unknown) => Promise<unknown>;
    beginPostQuantumServerRollback?: (input: unknown) => Promise<unknown>;
    persistPostQuantumServerRollback?: (
      input: unknown,
      proof: unknown
    ) => Promise<unknown>;
    getPendingPostQuantumServerRollback?: () => Promise<unknown>;
    checkpointPostQuantumRecovery?: () => Promise<unknown>;
    completePostQuantumServerRollbackRecovery?: (
      marker: unknown
    ) => Promise<unknown>;
    promoteStagedImportIfReady?: () => Promise<void>;
    resumeWritesAfterFailedHandoff?: () => void;
    pauseWritesForHandoff?: () => void;
    prepareHandoff?: (input: unknown) => Promise<unknown>;
    closeForHandoff?: () => Promise<boolean>;
    getConnectionStatusLeaseProof?: () =>
      { ownerId: string; fencingToken: string } | undefined;
  };
  postgresLeaseRecoveryRequired: boolean;
  postgresLeaseRecoveryGeneration: number;
  postgresLeaseRecoveryResumeGeneration?: number;
  providerHandoffKey?: string;
  providerLifecycleInvocationFence: {
    fenceAndWaitForIdle: (scope: object, timeoutMs: number) => Promise<void>;
  };
  socketId: number;
  readyConfirmationEpoch: number;
  connectionEstablished: boolean;
  centralOnlineAcknowledged: boolean;
  nativeConnectionStatus?: IBaileysConnectionState['connection_status'];
  nativeConnectionStatusSource?: object;
  nativeConnectionStatusSourceId?: string;
  credentialPersistenceBarrier?: {
    socket: unknown;
    sequence: number;
    acknowledgedSequence: number;
    tail: Promise<void>;
    lastError?: unknown;
  };
  acceptNativeConnectionStatus: (
    source: unknown,
    value: unknown,
    publish: boolean
  ) => void;
  status: Status;
  code: ECodeMessage;
  pendingResolve?: (state: IBaileysConnectionState) => void;
  outboundSendRecoveryFlight?: Promise<void>;
  outboundSendRecoveryAttempts: number;
  outboundSendRecoveryExhaustedScope?: unknown;
  deviceRemovedConfirmationPending: boolean;
  consecutiveOutboundSendFailures: number;
  recoverFromOutboundSendFailure: (socket?: unknown) => Promise<void>;
  notifyWorkerStatusSafely: (
    payload: IBaileysConnectionState,
    context: string
  ) => Promise<WorkerStatusNotificationResult>;
  scheduleKafkaReadinessRetry: (socket: unknown, socketId: number) => void;
  scheduleTransientDisconnectStatus: (
    payload: IBaileysConnectionState,
    context: string
  ) => void;
  cancelTransientDisconnectStatus: () => void;
  cancelAttempt: (skipWebSocketClose?: boolean) => void;
  setStatus: (
    status: Status,
    code?: ECodeMessage,
    preserveProviderRuntime?: boolean
  ) => void;
  createSocket: () => Promise<{ socket: unknown; saveCreds: () => void }>;
  handleSocketCreateFailure: (error: unknown) => IBaileysConnectionState;
  connectExclusive: (
    input: IBaileysConnection
  ) => Promise<IBaileysConnectionState>;
  handleReadyRuntimeFailure: (
    context: Record<string, unknown>,
    readiness: Record<string, unknown>,
    error: unknown
  ) => Promise<IBaileysConnectionState>;
  scheduleNextReconnectAttempt: (allowActiveQrLifecycle?: boolean) => boolean;
  canContinueQrPairingReconnect: (fromDisconnectRestart: boolean) => boolean;
  maybeMarkPairingInProgressFromCreds: (
    creds: Partial<{ registered: boolean; me: unknown }>
  ) => void;
  wait: (socket: unknown, id: number) => Promise<IBaileysConnectionState>;
  onQr: (
    qr: string,
    resolve: (state: IBaileysConnectionState) => void,
    socketId: number
  ) => Promise<void>;
  scheduleQrRenewal: (socketId: number, qrHash: string) => void;
  restartQrConnectionForRenewal: () => void;
  handleQrGenerationLimitReached: () => Promise<void>;
  prepareFolder: () => void;
  clearFolder: () => void;
  clearSessionStorage: () => Promise<void>;
  resetPostgresAuthStoreForAuthorizedImport: () => Promise<void>;
  safeLogout: (
    forceLogout?: boolean,
    disconnectCode?: ECodeMessage
  ) => Promise<void>;
  logConnectionIpInLocal: () => Promise<void>;
  onOpen: (
    resolve: (state: IBaileysConnectionState) => void,
    socketId: number
  ) => Promise<void>;
  awaitCredentialPersistenceBarrier: (
    socket: unknown,
    socketId: number
  ) => Promise<void>;
  onClose: (
    last: { error?: unknown } | undefined,
    resolve: (state: IBaileysConnectionState) => void,
    socketId: number
  ) => Promise<void>;
};

describe('BaileysConnectionService', () => {
  const makeService = () => {
    const centrifugo = {
      publishSub: jest.fn(async () => undefined),
      publishSubImmediate: jest.fn(async () => undefined),
    };
    const elasticDatabaseService = {
      indices: jest.fn(async () => true),
      updateWithOCC: jest.fn(async () => 'updated'),
    };
    const balanceWorkerStatusGrpcClientService = {
      notifyWorkerStatus: jest.fn<
        Promise<void>,
        [payload: IBaileysConnectionState]
      >(async () => undefined),
      publishWorkerRuntimeEvent: jest.fn(async () => undefined),
      resolveWhatsappRuntimeOwnedConnectionFence: jest.fn(async () => null),
      activateWhatsappRuntimeFence: jest.fn(async () => ({
        connection_sequence: 1,
        already_active: true,
      })),
    };
    const incomingMessageService = {
      bindTo: jest.fn(),
      markConnectionReady: jest.fn(async () => true),
      markConnectionUnavailable: jest.fn(),
      unbind: jest.fn(),
      isBoundTo: jest.fn(() => true),
      getActiveRuntimeFenceIdentity: jest.fn(() => ({
        connection_epoch: '00000000-0000-4000-8000-000000000071',
        connection_sequence: 7,
      })),
      getCachedMessage: jest.fn(),
    };
    const healthCheckService = {
      configure: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
      notifyDisconnected: jest.fn(async () => undefined),
      verifyCurrentSession: jest.fn(async () => ({
        session_ready: true,
        can_send: true,
        can_receive_runtime: true,
        authenticated: true,
        provider_state: 'open',
        last_probe_at: new Date().toISOString(),
        probe_latency_ms: 1,
      })),
      markStatusPublished: jest.fn(),
    };
    const redis = {
      get: jest.fn(async () => null),
      set: jest.fn(async () => 'OK'),
    };

    const service = new BaileysConnectionService(
      centrifugo as never,
      elasticDatabaseService as never,
      balanceWorkerStatusGrpcClientService as never,
      incomingMessageService as never,
      healthCheckService as never,
      redis as never
    );

    const servicePrivate =
      service as unknown as BaileysConnectionServicePrivate;
    servicePrivate.nativeConnectionStatus = {
      provider: 'baileys',
      status: EWhatsappConnectionStatus.online,
      connected: true,
      authenticated: true,
      sessionValid: true,
      recoverable: false,
      qrAvailable: false,
      sequence: 1,
      changedAt: new Date().toISOString(),
    };
    servicePrivate.nativeConnectionStatusSourceId =
      '01900000-0000-7000-8000-000000000073';

    return {
      service,
      servicePrivate,
      centrifugo,
      balanceWorkerStatusGrpcClientService,
      incomingMessageService,
      healthCheckService,
    };
  };

  it('wires fresh-process bootstrap to refresh the persisted session state', async () => {
    const { service, healthCheckService } = makeService();
    const refreshPersistedSessionState = jest
      .spyOn(service, 'refreshPersistedSessionState')
      .mockResolvedValue(true);
    const healthConfig = healthCheckService.configure.mock.calls[0]?.[0] as {
      prepareSession?: () => Promise<boolean>;
    };

    await expect(healthConfig.prepareSession?.()).resolves.toBe(true);

    expect(refreshPersistedSessionState).toHaveBeenCalledTimes(1);
  });

  it('serializes overlapping connection setup calls before creating another socket', async () => {
    const { service, servicePrivate } = makeService();
    let releaseFirst!: () => void;
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const connectExclusive = jest
      .spyOn(servicePrivate, 'connectExclusive')
      .mockImplementation(async (input) => {
        if (input.connection_attempt_id === 'attempt-a') {
          await firstPending;
        }
        return {
          status: Status.connecting,
          worker_id: 'worker-b',
          account_id: 'account-b',
          connection_attempt_id: input.connection_attempt_id,
        } as IBaileysConnectionState;
      });

    const first = service.connect({
      connection_attempt_id: 'attempt-a',
    });
    await Promise.resolve();
    const second = service.connect({
      connection_attempt_id: 'attempt-b',
    });
    await Promise.resolve();

    expect(connectExclusive).toHaveBeenCalledTimes(1);
    releaseFirst();
    await expect(first).resolves.toEqual(
      expect.objectContaining({ connection_attempt_id: 'attempt-a' })
    );
    await expect(second).resolves.toEqual(
      expect.objectContaining({ connection_attempt_id: 'attempt-b' })
    );
    expect(connectExclusive).toHaveBeenCalledTimes(2);
  });

  it('keeps a tombstoned bootstrap dormant without opening the auth store', async () => {
    const {
      service,
      healthCheckService,
      balanceWorkerStatusGrpcClientService,
    } = makeService();
    balanceWorkerStatusGrpcClientService.activateWhatsappRuntimeFence.mockRejectedValueOnce(
      new Error('worker_runtime_fence_rejected')
    );
    const refreshPersistedSessionState = jest.spyOn(
      service,
      'refreshPersistedSessionState'
    );
    const healthConfig = healthCheckService.configure.mock.calls[0]?.[0] as {
      prepareSession?: () => Promise<boolean>;
    };

    await expect(healthConfig.prepareSession?.()).resolves.toBe(false);

    expect(refreshPersistedSessionState).not.toHaveBeenCalled();
  });

  it('consumes an authorized QR epoch before opening the PostgreSQL auth store', async () => {
    const previousStorage = process.env.WORKER_SESSION_STORAGE;
    process.env.WORKER_SESSION_STORAGE = 'postgres';
    try {
      const { service, servicePrivate, balanceWorkerStatusGrpcClientService } =
        makeService();
      const order: string[] = [];
      balanceWorkerStatusGrpcClientService.activateWhatsappRuntimeFence.mockImplementation(
        async () => {
          order.push('activation');
          return { connection_sequence: 1, already_active: false };
        }
      );
      const postgresAuthStore = {
        close: jest.fn(async () => undefined),
        loadAuthenticationState: jest.fn(async () => {
          order.push('auth-store');
        }),
        hasRestorableSessionCached: jest.fn(() => true),
      };
      servicePrivate.postgresAuthStore = postgresAuthStore;
      (servicePrivate as any).getPostgresAuthStore = jest.fn(
        () => postgresAuthStore
      );
      servicePrivate.connectionEstablished = true;
      servicePrivate.status = Status.connected;

      await service.connect({
        initial_connection: true,
        requested_by_user: true,
        type: EBaileysConnectionType.qrcode,
        connection_attempt_id: '22222222-2222-4222-8222-222222222222',
        authorized_connection_epoch: '11111111-1111-4111-8111-111111111111',
        runtime_generation: 17,
      });

      expect(order).toEqual(['activation', 'auth-store']);
    } finally {
      if (previousStorage === undefined) {
        delete process.env.WORKER_SESSION_STORAGE;
      } else {
        process.env.WORKER_SESSION_STORAGE = previousStorage;
      }
    }
  });

  it('detaches a store fenced before the authorized secure import can reopen it', async () => {
    const { servicePrivate } = makeService();
    const close = jest.fn(async () => {
      throw Object.assign(
        new Error('whatsapp connection epoch was disconnected'),
        { code: 'REVISION_INVALID' }
      );
    });
    servicePrivate.postgresAuthStore = { close };

    await expect(
      servicePrivate.resetPostgresAuthStoreForAuthorizedImport()
    ).resolves.toBeUndefined();

    expect(close).toHaveBeenCalledTimes(1);
    expect(servicePrivate.postgresAuthStore).toBeUndefined();
  });

  it('reuses the active QR fence when only the provider socket is recycled', async () => {
    const { service, servicePrivate, balanceWorkerStatusGrpcClientService } =
      makeService();
    servicePrivate.runtimeFenceConnectionAuthorization = {
      connection_epoch: '11111111-1111-4111-8111-111111111111',
      connection_attempt_id: '22222222-2222-4222-8222-222222222222',
    };
    servicePrivate.status = Status.connected;
    servicePrivate.connectionEstablished = true;
    balanceWorkerStatusGrpcClientService.activateWhatsappRuntimeFence.mockClear();
    balanceWorkerStatusGrpcClientService.resolveWhatsappRuntimeOwnedConnectionFence.mockClear();

    await service.connect({
      initial_connection: true,
      requested_by_user: false,
      from_disconnect_restart: true,
      type: EBaileysConnectionType.qrcode,
      connection_attempt_id: '22222222-2222-4222-8222-222222222222',
      runtime_generation: 17,
    });

    expect(
      balanceWorkerStatusGrpcClientService.resolveWhatsappRuntimeOwnedConnectionFence
    ).not.toHaveBeenCalled();
    expect(
      balanceWorkerStatusGrpcClientService.activateWhatsappRuntimeFence
    ).not.toHaveBeenCalled();
  });

  it('suspends with a recoverable code and acknowledges the real bootstrap reconnect schedule', async () => {
    const { service, servicePrivate, healthCheckService } = makeService();
    jest.spyOn(service, 'hasSession').mockReturnValue(true);
    servicePrivate.initialConnection = true;
    servicePrivate.connectionEstablished = true;
    servicePrivate.status = Status.connected;
    servicePrivate.code = ECodeMessage.connectionEstablished;

    await service.suspend();

    expect(healthCheckService.stop).toHaveBeenCalledTimes(1);
    expect(servicePrivate.status).toBe(Status.disconnected);
    expect(servicePrivate.code).toBe(ECodeMessage.connectionLost);
    expect(servicePrivate.reconnectRetryTimer).toBeUndefined();

    const healthConfig = healthCheckService.configure.mock.calls[0]?.[0] as {
      reconnect: (input: IBaileysConnection) => boolean | Promise<boolean>;
    };
    const reconnectStarted = await healthConfig.reconnect({
      initial_connection: true,
      requested_by_user: false,
      from_disconnect_restart: true,
    });
    expect(reconnectStarted).toBe(true);
    expect(servicePrivate.reconnectRetryTimer).toBeDefined();
    expect(servicePrivate.code).toBe(ECodeMessage.connectionLost);
  });

  it('waits for the durable credential ACK before allowing post-open readiness', async () => {
    const { service } = makeService();
    const servicePrivate =
      service as unknown as BaileysConnectionServicePrivate;
    const socket = {};
    let acknowledge!: () => void;
    const pending = new Promise<void>((resolve) => {
      acknowledge = resolve;
    });
    servicePrivate.socket = socket;
    servicePrivate.socketId = 41;
    servicePrivate.userRequestedDisconnect = false;
    servicePrivate.credentialPersistenceBarrier = {
      socket,
      sequence: 1,
      acknowledgedSequence: 0,
      tail: pending.then(() => {
        const barrier = servicePrivate.credentialPersistenceBarrier;
        if (barrier) barrier.acknowledgedSequence = 1;
      }),
    };

    let settled = false;
    const waiting = servicePrivate
      .awaitCredentialPersistenceBarrier(socket, 41)
      .then(() => {
        settled = true;
      });
    await Promise.resolve();
    expect(settled).toBe(false);

    acknowledge();
    await waiting;
    expect(settled).toBe(true);
  });

  const makeHandoffInput = (
    targetProvider: 'wwebjs' | 'whatsmeow' = 'whatsmeow'
  ) => ({
    worker_id: 'worker-b',
    account_id: 'account-b',
    source_provider: 'baileys' as const,
    target_provider: targetProvider,
    source_revision_id: '41',
    handoff_id: '0198b905-35db-75de-a48f-99dd9133273c',
    lifecycle_operation_id: '0198b905-35db-75de-a48f-99dd9133273d',
    runtime_generation: 17,
    debug_trace_id: 'handoff-contract',
  });

  it('revokes ACK and dispatch synchronously before persisting a non-ONLINE native snapshot', () => {
    const { servicePrivate } = makeService();
    const source = {
      getConnectionStatus: jest.fn(),
      ev: { on: jest.fn() },
    };
    servicePrivate.nativeConnectionStatusSource = source;
    servicePrivate.centralOnlineAcknowledged = true;
    setWorkerKafkaDispatchAuthorized(true);

    servicePrivate.acceptNativeConnectionStatus(
      source,
      {
        provider: 'baileys',
        status: EWhatsappConnectionStatus.leaseLost,
        connected: false,
        authenticated: true,
        sessionValid: true,
        recoverable: true,
        qrAvailable: false,
        sequence: 2,
        changedAt: new Date().toISOString(),
        reason: 'lease_lost',
      },
      true
    );

    expect(servicePrivate.centralOnlineAcknowledged).toBe(false);
    expect(isWorkerKafkaDispatchAuthorized()).toBe(false);
  });

  it('closes a lease-lost store/socket, notifies recovery once and retains only non-terminal session evidence', async () => {
    const previousStorage = process.env.WORKER_SESSION_STORAGE;
    process.env.WORKER_SESSION_STORAGE = 'postgres';
    const closeStore = jest.fn(async () => undefined);
    const fakeStores = Array.from({ length: 3 }, () => ({
      close: closeStore,
      loadAuthenticationState: jest.fn(async () => ({
        state: {},
        saveCreds: jest.fn(),
      })),
      hasRestorableSessionCached: jest.fn(() => true),
      getConnectionStatusLeaseProof: jest.fn(() => ({
        ownerId: '01900000-0000-7000-8000-000000000085',
        fencingToken: '42',
      })),
    }));
    const availableStores = [...fakeStores];
    const leaseLostCallbacks: Array<
      ((error: BaileysSessionFenceError) => void | Promise<void>) | undefined
    > = [];
    const fromEnvironment = jest
      .spyOn(BaileysPostgresAuthStateStore, 'fromEnvironment')
      .mockImplementation((_workerId, overrides) => {
        leaseLostCallbacks.push(overrides?.onLeaseLost);
        return availableStores.shift() as never;
      });

    try {
      const { service, servicePrivate, incomingMessageService } = makeService();
      const closeSocket = jest.fn();
      servicePrivate.socket = {
        ws: { readyState: 1, close: closeSocket },
        ev: { removeAllListeners: jest.fn() },
      };
      servicePrivate.initialConnection = true;
      servicePrivate.status = Status.connected;
      servicePrivate.code = ECodeMessage.connectionEstablished;
      setWorkerKafkaDispatchAuthorized(true);

      await service.refreshPersistedSessionState();
      const firstListener = jest.fn(async () => undefined);
      const failingListener = jest.fn(async () => {
        throw new Error('guard unavailable');
      });
      service.onSessionLeaseLost(firstListener);
      service.onSessionLeaseLost(failingListener);

      await leaseLostCallbacks[0]?.(
        new BaileysSessionFenceError('LEASE_LOST', new Error('db outage'))
      );

      expect(firstListener).toHaveBeenCalledTimes(1);
      expect(failingListener).toHaveBeenCalledTimes(1);
      expect(closeSocket).toHaveBeenCalledWith(1000, 'reconnect');
      expect(incomingMessageService.unbind).toHaveBeenCalled();
      expect(closeStore).toHaveBeenCalledTimes(1);
      expect(servicePrivate.postgresAuthStore).toBeUndefined();
      expect(servicePrivate.reconnectRetryTimer).toBeUndefined();
      expect(isWorkerKafkaDispatchAuthorized()).toBe(false);
      expect(service.hasSession()).toBe(true);
      expect(service.canRecoverRestorableSession()).toBe(true);
      expect(
        service.ensureRestorableSessionRecovery('self_monitor:lease_lost')
      ).toBe(false);

      await service.refreshPersistedSessionState();
      const generationBeforeStaleCallback =
        servicePrivate.postgresLeaseRecoveryGeneration;
      await leaseLostCallbacks[0]?.(
        new BaileysSessionFenceError(
          'LEASE_LOST',
          new Error('stale store callback')
        )
      );
      expect(servicePrivate.postgresLeaseRecoveryGeneration).toBe(
        generationBeforeStaleCallback
      );
      expect(firstListener).toHaveBeenCalledTimes(1);
      expect(servicePrivate.postgresLeaseRecoveryRequired).toBe(true);
      expect(servicePrivate.reconnectRetryTimer).toBeUndefined();
      const recoveryGeneration = service.beginSessionLeaseRecoveryResume();
      expect(recoveryGeneration).toBe(
        servicePrivate.postgresLeaseRecoveryGeneration
      );
      await leaseLostCallbacks[1]?.(
        new BaileysSessionFenceError(
          'LEASE_LOST',
          new Error('second db outage during resume')
        )
      );
      expect(
        service.markSessionLeaseRecoveryCompleted(recoveryGeneration)
      ).toBe(false);
      await service.refreshPersistedSessionState();
      const replacementRecoveryGeneration =
        service.beginSessionLeaseRecoveryResume();
      expect(
        service.markSessionLeaseRecoveryCompleted(replacementRecoveryGeneration)
      ).toBe(true);
      expect(servicePrivate.postgresLeaseRecoveryRequired).toBe(false);

      servicePrivate.setStatus(Status.disconnected, ECodeMessage.badSession);
      expect(service.hasSession()).toBe(false);
      expect(service.canRecoverRestorableSession()).toBe(false);
      await leaseLostCallbacks[2]?.(
        new BaileysSessionFenceError(
          'LEASE_LOST',
          new Error('terminal stale callback')
        )
      );
      expect(firstListener).toHaveBeenCalledTimes(2);
      expect(servicePrivate.postgresLeaseRecoveryRequired).toBe(false);
      expect(servicePrivate.postgresAuthStore).toBeUndefined();
    } finally {
      fromEnvironment.mockRestore();
      if (previousStorage === undefined) {
        delete process.env.WORKER_SESSION_STORAGE;
      } else {
        process.env.WORKER_SESSION_STORAGE = previousStorage;
      }
    }
  });

  it('fences source mismatch, stale and duplicate snapshots before fail-closed revocation', () => {
    const { servicePrivate } = makeService();
    const source = {
      getConnectionStatus: jest.fn(),
      ev: { on: jest.fn() },
    };
    servicePrivate.nativeConnectionStatusSource = source;
    servicePrivate.nativeConnectionStatus = {
      provider: 'baileys',
      status: EWhatsappConnectionStatus.online,
      connected: true,
      authenticated: true,
      sessionValid: true,
      recoverable: false,
      qrAvailable: false,
      sequence: 5,
      changedAt: new Date().toISOString(),
    };
    servicePrivate.centralOnlineAcknowledged = true;
    setWorkerKafkaDispatchAuthorized(true);
    const offline = (sequence: number) => ({
      provider: 'baileys',
      status: EWhatsappConnectionStatus.offline,
      connected: false,
      authenticated: true,
      sessionValid: true,
      recoverable: true,
      qrAvailable: false,
      sequence,
      changedAt: new Date().toISOString(),
      reason: 'socket_closed',
    });

    servicePrivate.acceptNativeConnectionStatus(source, offline(4), true);
    servicePrivate.acceptNativeConnectionStatus(source, offline(5), true);
    servicePrivate.acceptNativeConnectionStatus(
      { getConnectionStatus: jest.fn(), ev: { on: jest.fn() } },
      offline(6),
      true
    );

    expect(servicePrivate.nativeConnectionStatus.sequence).toBe(5);
    expect(servicePrivate.centralOnlineAcknowledged).toBe(true);
    expect(isWorkerKafkaDispatchAuthorized()).toBe(true);
  });

  const makeHandoffStore = () => ({
    close: jest.fn(async () => undefined),
    openForHandoff: jest.fn(async () => ({
      revisionId: 41,
      status: 'active',
    })),
    authorizeHandoff: jest.fn(async () => ({ authorized: true })),
    beginPostQuantumServerRollback: jest.fn(async () => undefined),
    persistPostQuantumServerRollback: jest.fn(async () => undefined),
    getPendingPostQuantumServerRollback: jest.fn(
      async (): Promise<BaileysPostQuantumRollbackMarker> => ({
        state: 'acknowledged',
        handoffId: '0198b905-35db-75de-a48f-99dd9133273c',
        lifecycleOperationId: '0198b905-35db-75de-a48f-99dd9133273d',
        sourceRevisionId: '41',
        targetProvider: 'whatsmeow',
        uploadLifecycleFenced: true,
        uploadLifecycleFenceVersion: 1,
      })
    ),
    checkpointPostQuantumRecovery: jest.fn(async () => undefined),
    completePostQuantumServerRollbackRecovery: jest.fn(async () => undefined),
    resumeWritesAfterFailedHandoff: jest.fn(),
    pauseWritesForHandoff: jest.fn(),
    prepareHandoff: jest.fn(async () => ({
      revisionId: 41,
      checksumSha256: 'f'.repeat(64),
      sizeBytes: 4096,
      recordCount: 12,
    })),
    closeForHandoff: jest.fn(async () => true),
    hasRestorableSessionCached: jest.fn(() => true),
    loadAuthenticationState: jest.fn(async () => ({
      state: { creds: { registered: true } },
      saveCreds: jest.fn(async () => undefined),
    })),
  });

  const makeHandoffSocket = () => {
    const ws = {
      readyState: 1,
      close: jest.fn(() => {
        ws.readyState = 3;
      }),
      terminate: jest.fn(() => {
        ws.readyState = 3;
      }),
    };
    return {
      ws,
      ev: { removeAllListeners: jest.fn(), on: jest.fn() },
      waitForSocketOpen: jest.fn(async () => undefined),
      deletePqPreKeys: jest.fn(async () => ({
        protocol: 'delete_pq_prekeys_server_ack_v1' as const,
        serverAcknowledged: true as const,
        localCleanupComplete: true as const,
        acknowledgedAtMs: Date.now(),
        responseValidated: true as const,
        uploadLifecycleFenced: true as const,
        uploadLifecycleFenceVersion: 1 as const,
      })),
      recoverPqAfterClassicalHandoffAbort: jest.fn(async () => undefined),
    };
  };

  beforeEach(() => {
    jest.useFakeTimers();
    mockEmitWorkerProviderRuntimeState.mockReset();
    mockEmitWorkerProviderRuntimeState.mockResolvedValue(undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('persists the PQ intent before runtime gating and restarts on a gate failure', async () => {
    const previousStorage = process.env.WORKER_SESSION_STORAGE;
    process.env.WORKER_SESSION_STORAGE = 'postgres';
    try {
      const { service, servicePrivate } = makeService();
      const store = makeHandoffStore();
      const socket = makeHandoffSocket();
      servicePrivate.postgresAuthStore = store;
      servicePrivate.socket = socket;
      const scheduleReconnect = jest
        .spyOn(servicePrivate, 'scheduleNextReconnectAttempt')
        .mockImplementation(() => false);
      mockEmitWorkerProviderRuntimeState.mockRejectedValueOnce(
        new Error('runtime_gate_failed')
      );

      await expect(
        service.prepareProviderHandoff(makeHandoffInput())
      ).rejects.toThrow('runtime_gate_failed');

      expect(store.beginPostQuantumServerRollback).toHaveBeenCalledTimes(1);
      expect(
        store.beginPostQuantumServerRollback.mock.invocationCallOrder[0]
      ).toBeLessThan(
        mockEmitWorkerProviderRuntimeState.mock.invocationCallOrder[0]
      );
      expect(socket.deletePqPreKeys).not.toHaveBeenCalled();
      expect(socket.ws.close).toHaveBeenCalledTimes(1);
      expect(
        store.completePostQuantumServerRollbackRecovery
      ).not.toHaveBeenCalled();
      expect(servicePrivate.providerHandoffKey).toBeUndefined();
      expect(scheduleReconnect).toHaveBeenCalledTimes(1);
    } finally {
      if (previousStorage === undefined) {
        delete process.env.WORKER_SESSION_STORAGE;
      } else {
        process.env.WORKER_SESSION_STORAGE = previousStorage;
      }
    }
  });

  it('closes the permanently fenced socket and uses a fresh reconnect after drain timeout', async () => {
    const previousStorage = process.env.WORKER_SESSION_STORAGE;
    process.env.WORKER_SESSION_STORAGE = 'postgres';
    try {
      const { service, servicePrivate } = makeService();
      const store = makeHandoffStore();
      const socket = makeHandoffSocket();
      servicePrivate.postgresAuthStore = store;
      servicePrivate.socket = socket;
      jest
        .spyOn(
          servicePrivate.providerLifecycleInvocationFence,
          'fenceAndWaitForIdle'
        )
        .mockRejectedValueOnce(new Error('provider_drain_timeout'));
      const scheduleReconnect = jest
        .spyOn(servicePrivate, 'scheduleNextReconnectAttempt')
        .mockImplementation(() => false);

      await expect(
        service.prepareProviderHandoff(makeHandoffInput())
      ).rejects.toThrow('provider_drain_timeout');

      expect(socket.ws.close).toHaveBeenCalledTimes(1);
      expect(socket.deletePqPreKeys).not.toHaveBeenCalled();
      expect(servicePrivate.socket).toBeUndefined();
      expect(servicePrivate.providerHandoffKey).toBeUndefined();
      expect(scheduleReconnect).toHaveBeenCalledTimes(1);
    } finally {
      if (previousStorage === undefined) {
        delete process.env.WORKER_SESSION_STORAGE;
      } else {
        process.env.WORKER_SESSION_STORAGE = previousStorage;
      }
    }
  });

  it('never reuses the source socket when the PQ delete acknowledgement is unknown', async () => {
    const previousStorage = process.env.WORKER_SESSION_STORAGE;
    process.env.WORKER_SESSION_STORAGE = 'postgres';
    try {
      const { service, servicePrivate } = makeService();
      const store = makeHandoffStore();
      const socket = makeHandoffSocket();
      const unknownAck = Object.assign(
        new Error('baileys_pq_rollback_server_ack_unknown'),
        { acknowledgementUnknown: true }
      );
      socket.deletePqPreKeys.mockRejectedValueOnce(unknownAck);
      servicePrivate.postgresAuthStore = store;
      servicePrivate.socket = socket;
      const scheduleReconnect = jest
        .spyOn(servicePrivate, 'scheduleNextReconnectAttempt')
        .mockImplementation(() => false);

      await expect(
        service.prepareProviderHandoff(makeHandoffInput())
      ).rejects.toBe(unknownAck);

      expect(socket.recoverPqAfterClassicalHandoffAbort).not.toHaveBeenCalled();
      expect(socket.ws.close).toHaveBeenCalledTimes(1);
      expect(
        store.completePostQuantumServerRollbackRecovery
      ).not.toHaveBeenCalled();
      expect(servicePrivate.socket).toBeUndefined();
      expect(scheduleReconnect).toHaveBeenCalledTimes(1);
    } finally {
      if (previousStorage === undefined) {
        delete process.env.WORKER_SESSION_STORAGE;
      } else {
        process.env.WORKER_SESSION_STORAGE = previousStorage;
      }
    }
  });

  it('uses the server-acknowledged PQ rollback for WWebJS and retries lease release without repeating the delete', async () => {
    const previousStorage = process.env.WORKER_SESSION_STORAGE;
    process.env.WORKER_SESSION_STORAGE = 'postgres';
    try {
      const { service, servicePrivate } = makeService();
      const store = makeHandoffStore();
      const socket = makeHandoffSocket();
      store.closeForHandoff.mockRejectedValueOnce(
        new Error('lease_release_ambiguous')
      );
      servicePrivate.postgresAuthStore = store;
      servicePrivate.socket = socket;
      const input = makeHandoffInput('wwebjs');

      await expect(service.prepareProviderHandoff(input)).rejects.toThrow(
        'lease_release_ambiguous'
      );
      await expect(
        service.prepareProviderHandoff(input)
      ).resolves.toMatchObject({
        prepared: true,
        checkpoint_persisted: true,
        provider_disconnected: true,
        lease_released: true,
      });

      expect(store.beginPostQuantumServerRollback).toHaveBeenCalledTimes(1);
      expect(socket.deletePqPreKeys).toHaveBeenCalledTimes(1);
      expect(store.persistPostQuantumServerRollback).toHaveBeenCalledTimes(1);
      expect(store.prepareHandoff).toHaveBeenCalledTimes(1);
      expect(socket.ws.close).toHaveBeenCalledTimes(1);
      expect(store.closeForHandoff).toHaveBeenCalledTimes(2);
    } finally {
      if (previousStorage === undefined) {
        delete process.env.WORKER_SESSION_STORAGE;
      } else {
        process.env.WORKER_SESSION_STORAGE = previousStorage;
      }
    }
  });

  it('closes an unbound startup recovery socket and never reports QR', async () => {
    const previousStorage = process.env.WORKER_SESSION_STORAGE;
    process.env.WORKER_SESSION_STORAGE = 'postgres';
    try {
      const { service, servicePrivate, incomingMessageService } = makeService();
      const store = makeHandoffStore();
      const socket = makeHandoffSocket();
      socket.recoverPqAfterClassicalHandoffAbort.mockRejectedValueOnce(
        new Error('pq_upload_failed')
      );
      servicePrivate.postgresAuthStore = store;
      jest.spyOn(servicePrivate, 'createSocket').mockResolvedValueOnce({
        socket,
        saveCreds: jest.fn(),
      });
      const scheduleReconnect = jest
        .spyOn(servicePrivate, 'scheduleNextReconnectAttempt')
        .mockImplementation(() => false);

      const state = await service.connect({
        initial_connection: true,
        allow_restore: false,
        requested_by_user: true,
        type: EBaileysConnectionType.qrcode,
        runtime_generation: 17,
      });

      expect(state).toMatchObject({
        status: Status.connecting,
        code: ECodeMessage.awaitConnection,
        worker_status_id: EWorkerStatus.disponible,
        qr_pending: true,
        session_ready: false,
        authenticated: false,
      });
      expect(socket.ws.close).toHaveBeenCalledTimes(1);
      expect(incomingMessageService.bindTo).not.toHaveBeenCalled();
      expect(socket.recoverPqAfterClassicalHandoffAbort).toHaveBeenCalledWith({
        allowPersistedRecovery: true,
      });
      expect(socket.waitForSocketOpen).not.toHaveBeenCalled();
      expect(store.pauseWritesForHandoff).toHaveBeenCalledTimes(1);
      expect(
        store.completePostQuantumServerRollbackRecovery
      ).not.toHaveBeenCalled();
      expect(scheduleReconnect).toHaveBeenCalledTimes(1);
    } finally {
      if (previousStorage === undefined) {
        delete process.env.WORKER_SESSION_STORAGE;
      } else {
        process.env.WORKER_SESSION_STORAGE = previousStorage;
      }
    }
  });

  it('fails closed when the installed Baileys cannot recover the pending PQ rollback', async () => {
    const previousStorage = process.env.WORKER_SESSION_STORAGE;
    process.env.WORKER_SESSION_STORAGE = 'postgres';
    try {
      const { service, servicePrivate, incomingMessageService } = makeService();
      const store = makeHandoffStore();
      const socket = makeHandoffSocket();
      socket.recoverPqAfterClassicalHandoffAbort = undefined as never;
      servicePrivate.postgresAuthStore = store;
      jest.spyOn(servicePrivate, 'createSocket').mockResolvedValueOnce({
        socket,
        saveCreds: jest.fn(),
      });
      const scheduleReconnect = jest
        .spyOn(servicePrivate, 'scheduleNextReconnectAttempt')
        .mockImplementation(() => false);

      const state = await service.connect({
        initial_connection: true,
        allow_restore: false,
        requested_by_user: true,
        type: EBaileysConnectionType.qrcode,
        runtime_generation: 17,
      });

      expect(state).toMatchObject({
        status: Status.disconnected,
        code: ECodeMessage.badSession,
        worker_status_id: EWorkerStatus.error,
        qr_pending: false,
        session_ready: false,
        authenticated: false,
      });
      expect(socket.ws.close).toHaveBeenCalledTimes(1);
      expect(incomingMessageService.bindTo).not.toHaveBeenCalled();
      expect(store.close).toHaveBeenCalledTimes(1);
      expect(scheduleReconnect).not.toHaveBeenCalled();
    } finally {
      if (previousStorage === undefined) {
        delete process.env.WORKER_SESSION_STORAGE;
      } else {
        process.env.WORKER_SESSION_STORAGE = previousStorage;
      }
    }
  });

  it('never grants a replacement socket persisted-recovery access for an intent-only marker', async () => {
    const previousStorage = process.env.WORKER_SESSION_STORAGE;
    process.env.WORKER_SESSION_STORAGE = 'postgres';
    try {
      const { service, servicePrivate, incomingMessageService } = makeService();
      const store = makeHandoffStore();
      const socket = makeHandoffSocket();
      store.getPendingPostQuantumServerRollback.mockResolvedValueOnce({
        state: 'intent',
        handoffId: '0198b905-35db-75de-a48f-99dd9133273c',
        lifecycleOperationId: '0198b905-35db-75de-a48f-99dd9133273d',
        sourceRevisionId: '41',
        targetProvider: 'whatsmeow',
      });
      servicePrivate.postgresAuthStore = store;
      jest.spyOn(servicePrivate, 'createSocket').mockResolvedValueOnce({
        socket,
        saveCreds: jest.fn(),
      });

      const state = await service.connect({
        initial_connection: true,
        allow_restore: false,
        requested_by_user: true,
        type: EBaileysConnectionType.qrcode,
        runtime_generation: 17,
      });

      expect(state).toMatchObject({
        status: Status.disconnected,
        code: ECodeMessage.badSession,
        worker_status_id: EWorkerStatus.error,
      });
      expect(socket.recoverPqAfterClassicalHandoffAbort).not.toHaveBeenCalled();
      expect(store.resumeWritesAfterFailedHandoff).not.toHaveBeenCalled();
      expect(incomingMessageService.bindTo).not.toHaveBeenCalled();
    } finally {
      if (previousStorage === undefined) {
        delete process.env.WORKER_SESSION_STORAGE;
      } else {
        process.env.WORKER_SESSION_STORAGE = previousStorage;
      }
    }
  });

  it('attaches the acquired lease proof only to a canonical strong ONLINE status', async () => {
    const previousStorage = process.env.WORKER_SESSION_STORAGE;
    process.env.WORKER_SESSION_STORAGE = 'postgres';
    try {
      const { servicePrivate, balanceWorkerStatusGrpcClientService } =
        makeService();
      servicePrivate.postgresAuthStore = {
        close: async () => undefined,
        getConnectionStatusLeaseProof: () => ({
          ownerId: '01900000-0000-7000-8000-000000000071',
          fencingToken: '19',
        }),
      };
      const nativeOnline = {
        provider: 'baileys' as const,
        status: EWhatsappConnectionStatus.online,
        connected: true,
        authenticated: true,
        sessionValid: true,
        recoverable: false,
        qrAvailable: false,
        sequence: 2,
        changedAt: new Date().toISOString(),
      };
      await expect(
        servicePrivate.notifyWorkerStatusSafely(
          {
            worker_id: 'worker-b',
            account_id: 'account-b',
            status: Status.connected,
            code: ECodeMessage.connectionEstablished,
            worker_status_id: EWorkerStatus.online,
            session_ready: true,
            can_send: true,
            can_receive_runtime: true,
            authenticated: true,
            connection_status_source_id: '01900000-0000-7000-8000-000000000073',
            connection_status: nativeOnline,
          },
          'test_online_proof'
        )
      ).resolves.toEqual({ outcome: 'accepted' });
      expect(
        balanceWorkerStatusGrpcClientService.notifyWorkerStatus
      ).toHaveBeenLastCalledWith(expect.any(Object), {
        connectionStatusLeaseProof: {
          ownerId: '01900000-0000-7000-8000-000000000071',
          fencingToken: '19',
        },
      });

      await expect(
        servicePrivate.notifyWorkerStatusSafely(
          {
            worker_id: 'worker-b',
            account_id: 'account-b',
            status: Status.connected,
            code: ECodeMessage.connectionEstablished,
            worker_status_id: EWorkerStatus.online,
            session_ready: true,
            can_send: true,
            can_receive_runtime: true,
            authenticated: true,
            connection_status_source_id: '01900000-0000-7000-8000-000000000099',
            connection_status: nativeOnline,
          },
          'test_forged_online_source'
        )
      ).resolves.toMatchObject({ outcome: 'failed' });
      expect(
        balanceWorkerStatusGrpcClientService.notifyWorkerStatus
      ).toHaveBeenCalledTimes(1);

      await servicePrivate.notifyWorkerStatusSafely(
        {
          worker_id: 'worker-b',
          account_id: 'account-b',
          status: Status.disconnected,
          code: ECodeMessage.connectionClosed,
          worker_status_id: EWorkerStatus.disponible,
          connection_status_source_id: '01900000-0000-7000-8000-000000000073',
          connection_status: {
            ...nativeOnline,
            status: EWhatsappConnectionStatus.stopped,
            connected: false,
            authenticated: false,
            sequence: 3,
          },
        },
        'test_stopped_without_proof'
      );
      expect(
        balanceWorkerStatusGrpcClientService.notifyWorkerStatus.mock.calls.at(
          -1
        )
      ).toHaveLength(1);
    } finally {
      if (previousStorage === undefined) {
        delete process.env.WORKER_SESSION_STORAGE;
      } else {
        process.env.WORKER_SESSION_STORAGE = previousStorage;
      }
    }
  });

  it('fences a stalled passkey call and accepts only a recreated socket', async () => {
    const { service, servicePrivate } = makeService();
    const ensureRecovery = jest
      .spyOn(service, 'ensureOutboundSendRecovery')
      .mockImplementation(() => undefined);
    let rejectLate!: (error: Error) => void;
    const oldSocket = {
      user: { id: '5511999999999@s.whatsapp.net' },
      sendPasskeyResponse: jest.fn(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectLate = reject;
          })
      ),
      confirmPasskey: jest.fn(async () => undefined),
    };
    servicePrivate.socket = oldSocket;

    const response = service.sendPasskeyResponse({
      passkey_response: '123456',
    });
    const rejection = expect(response).rejects.toMatchObject({
      code: 'WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT',
      operation: 'connection_passkey_response',
    });
    await jest.advanceTimersByTimeAsync(15_000);
    await rejection;

    expect(oldSocket.sendPasskeyResponse).toHaveBeenCalledTimes(1);
    expect(ensureRecovery).toHaveBeenCalledWith(oldSocket);
    await expect(service.confirmPasskey({})).rejects.toMatchObject({
      code: 'OUTBOUND_PROVIDER_CALL_IN_FLIGHT',
    });
    expect(oldSocket.confirmPasskey).not.toHaveBeenCalled();

    rejectLate(new Error('late passkey rejection'));
    await jest.advanceTimersByTimeAsync(0);
    expect(console.warn).toHaveBeenCalledWith(
      '[WhatsappProviderAuxiliary] operation_rejected_after_timeout',
      expect.objectContaining({
        provider: 'baileys',
        operation: 'connection_passkey_response',
        timeout_ms: 15_000,
      })
    );

    const freshSocket = {
      user: { id: '5511999999999@s.whatsapp.net' },
      confirmPasskey: jest.fn(async () => undefined),
    };
    servicePrivate.socket = freshSocket;
    await expect(service.confirmPasskey({})).resolves.toMatchObject({
      reason: 'passkey_confirmation_sent',
    });
    expect(freshSocket.confirmPasskey).toHaveBeenCalledTimes(1);
  });

  it('bounds logout, observes its late rejection, and detaches the old socket', async () => {
    const { servicePrivate } = makeService();
    let rejectLate!: (error: Error) => void;
    const oldSocket = {
      user: { id: '5511999999999@s.whatsapp.net' },
      logout: jest.fn(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectLate = reject;
          })
      ),
    };
    servicePrivate.socket = oldSocket;

    const logout = servicePrivate.safeLogout(true);
    await jest.advanceTimersByTimeAsync(15_000);
    await expect(logout).resolves.toBeUndefined();
    expect(oldSocket.logout).toHaveBeenCalledTimes(1);
    expect(servicePrivate.socket).toBeUndefined();

    rejectLate(new Error('late logout rejection'));
    await jest.advanceTimersByTimeAsync(0);
    expect(console.warn).toHaveBeenCalledWith(
      '[WhatsappProviderAuxiliary] operation_rejected_after_timeout',
      expect.objectContaining({
        provider: 'baileys',
        operation: 'connection_logout',
        timeout_ms: 15_000,
      })
    );

    const freshSocket = {
      user: { id: '5511999999999@s.whatsapp.net' },
      logout: jest.fn(async () => undefined),
    };
    servicePrivate.socket = freshSocket;
    const freshLogout = servicePrivate.safeLogout(true);
    await jest.advanceTimersByTimeAsync(1_000);
    await expect(freshLogout).resolves.toBeUndefined();
    expect(freshSocket.logout).toHaveBeenCalledTimes(1);
    expect(servicePrivate.socket).toBeUndefined();
  });

  it('preserves the central status while an authenticated session waits for Kafka readiness', async () => {
    const { servicePrivate, balanceWorkerStatusGrpcClientService } =
      makeService();
    const pendingPayload: IBaileysConnectionState = {
      status: Status.connecting,
      code: ECodeMessage.awaitConnection,
      worker_id: 'worker-b',
      account_id: 'account-b',
      worker_status_id: EWorkerStatus.disponible,
      session_ready: false,
      can_send: false,
      can_receive_runtime: true,
      authenticated: true,
      provider_state: 'kafka_consumers_not_ready',
      degraded_reason: 'kafka_consumers_not_ready:assignments_pending',
    };

    await expect(
      servicePrivate.notifyWorkerStatusSafely(
        pendingPayload,
        'kafka_positioning'
      )
    ).resolves.toEqual({
      outcome: 'deferred',
      reason: 'command_ingress_positioning',
    });

    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).not.toHaveBeenCalled();
  });

  it('publishes disponible when the failure is not the explicit preserved Kafka positioning state', async () => {
    const { servicePrivate, balanceWorkerStatusGrpcClientService } =
      makeService();
    const unavailablePayload: IBaileysConnectionState = {
      status: Status.connecting,
      code: ECodeMessage.awaitConnection,
      worker_id: 'worker-b',
      account_id: 'account-b',
      worker_status_id: EWorkerStatus.disponible,
      session_ready: false,
      can_send: false,
      can_receive_runtime: true,
      authenticated: true,
      provider_state: 'kafka_consumers_not_ready',
      degraded_reason: 'kafka_startup_failed',
    };

    await expect(
      servicePrivate.notifyWorkerStatusSafely(
        unavailablePayload,
        'kafka_startup_failed'
      )
    ).resolves.toEqual({ outcome: 'accepted' });

    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).toHaveBeenCalledWith(expect.objectContaining(unavailablePayload));
  });

  it('does not leak status persistence errors through logs or failure reasons', async () => {
    const { servicePrivate, balanceWorkerStatusGrpcClientService } =
      makeService();
    const secret =
      'postgres://worker:password@database:5432/underchat capability-secret qr-secret session-secret';
    balanceWorkerStatusGrpcClientService.notifyWorkerStatus.mockRejectedValueOnce(
      Object.assign(new Error(secret), { code: 'ECONNRESET' })
    );

    const result = await servicePrivate.notifyWorkerStatusSafely(
      {
        status: Status.connecting,
        code: ECodeMessage.awaitConnection,
        worker_id: 'worker-b',
        account_id: 'account-b',
        worker_status_id: EWorkerStatus.disponible,
      },
      'status_security_contract'
    );

    expect(result).toEqual({
      outcome: 'failed',
      classification: 'recoverable',
      reason: 'worker_status_notification_failed:econnreset',
      grpcCode: undefined,
    });
    expect(JSON.stringify(jest.mocked(console.error).mock.calls)).not.toContain(
      secret
    );
  });

  it('observes a failed outbound recovery and retries the same socket with bounded backoff', async () => {
    const { service, servicePrivate } = makeService();
    const socket = {
      user: { id: '556199999999@s.whatsapp.net' },
    };
    servicePrivate.socket = socket;
    const recover = jest
      .spyOn(servicePrivate, 'recoverFromOutboundSendFailure')
      .mockRejectedValueOnce(new Error('disconnect temporarily unavailable'))
      .mockResolvedValueOnce(undefined);
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);

    try {
      expect(
        service.reportOutboundSendFailure(
          socket as never,
          new Error('provider timed out'),
          { timedOut: true }
        )
      ).toBe(true);
      await expect(servicePrivate.outboundSendRecoveryFlight).resolves.toBe(
        undefined
      );
      expect(recover).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(250);

      expect(recover).toHaveBeenCalledTimes(2);
      expect(servicePrivate.outboundSendRecoveryAttempts).toBe(2);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it.each([
    ['not-authorized', 401],
    ['item-not-found', 404],
    ['forbidden', 403],
  ])(
    'keeps a healthy socket online across repeated %s operation rejections',
    async (message, providerCode) => {
      const { service, servicePrivate } = makeService();
      const socket = {
        user: { id: '556199999999@s.whatsapp.net' },
      };
      servicePrivate.socket = socket;
      const recover = jest
        .spyOn(servicePrivate, 'recoverFromOutboundSendFailure')
        .mockResolvedValue(undefined);
      const legacyProviderError = () =>
        Object.assign(new Error(message), {
          data: providerCode,
          output: { statusCode: 500 },
        });

      for (let attempt = 0; attempt < 6; attempt += 1) {
        expect(
          service.reportOutboundSendFailure(
            socket as never,
            legacyProviderError()
          )
        ).toBe(false);
      }
      await Promise.resolve();

      expect(servicePrivate.consecutiveOutboundSendFailures).toBe(0);
      expect(servicePrivate.outboundSendRecoveryFlight).toBeUndefined();
      expect(recover).not.toHaveBeenCalled();
    }
  );

  it.each([401, 403, 411, 440, 500])(
    'defers terminal session status %s to connection.update without local send recovery',
    async (providerCode) => {
      const { service, servicePrivate } = makeService();
      const socket = {
        user: { id: '556199999999@s.whatsapp.net' },
      };
      servicePrivate.socket = socket;
      const recover = jest
        .spyOn(servicePrivate, 'recoverFromOutboundSendFailure')
        .mockResolvedValue(undefined);
      const sessionError = () =>
        Object.assign(new Error('stream ended'), {
          output: { statusCode: providerCode },
        });

      for (let attempt = 0; attempt < 6; attempt += 1) {
        expect(
          service.reportOutboundSendFailure(socket as never, sessionError())
        ).toBe(false);
      }
      await Promise.resolve();

      expect(servicePrivate.consecutiveOutboundSendFailures).toBe(0);
      expect(servicePrivate.outboundSendRecoveryFlight).toBeUndefined();
      expect(recover).not.toHaveBeenCalled();
    }
  );

  it('requires objective transport failures to be consecutive', async () => {
    const { service, servicePrivate } = makeService();
    const socket = {
      user: { id: '556199999999@s.whatsapp.net' },
    };
    servicePrivate.socket = socket;
    const recover = jest
      .spyOn(servicePrivate, 'recoverFromOutboundSendFailure')
      .mockResolvedValue(undefined);
    const transportError = () =>
      Object.assign(new Error('provider call failed'), {
        code: 'ECONNRESET',
      });

    expect(
      service.reportOutboundSendFailure(socket as never, transportError())
    ).toBe(false);
    expect(
      service.reportOutboundSendFailure(socket as never, transportError())
    ).toBe(false);
    expect(
      service.reportOutboundSendFailure(
        socket as never,
        new Error('unclassified provider error')
      )
    ).toBe(false);
    expect(
      service.reportOutboundSendFailure(socket as never, transportError())
    ).toBe(false);
    await Promise.resolve();

    expect(servicePrivate.consecutiveOutboundSendFailures).toBe(1);
    expect(recover).not.toHaveBeenCalled();
  });

  it('retains bounded recovery for repeated objective transport failures', async () => {
    const { service, servicePrivate } = makeService();
    const socket = {
      user: { id: '556199999999@s.whatsapp.net' },
    };
    servicePrivate.socket = socket;
    const recover = jest
      .spyOn(servicePrivate, 'recoverFromOutboundSendFailure')
      .mockResolvedValue(undefined);
    const transportError = () =>
      Object.assign(new Error('provider call failed'), {
        code: 'ECONNRESET',
      });

    expect(
      service.reportOutboundSendFailure(socket as never, transportError())
    ).toBe(false);
    expect(
      service.reportOutboundSendFailure(socket as never, transportError())
    ).toBe(false);
    expect(
      service.reportOutboundSendFailure(socket as never, transportError())
    ).toBe(true);
    await expect(servicePrivate.outboundSendRecoveryFlight).resolves.toBe(
      undefined
    );

    expect(recover).toHaveBeenCalledTimes(1);
  });

  it('retains bounded recovery for repeated invalid provider responses', async () => {
    const { service, servicePrivate } = makeService();
    const socket = {
      user: { id: '556199999999@s.whatsapp.net' },
    };
    servicePrivate.socket = socket;
    const recover = jest
      .spyOn(servicePrivate, 'recoverFromOutboundSendFailure')
      .mockResolvedValue(undefined);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      service.reportOutboundSendFailure(
        socket as never,
        new BaileysProviderProtocolFailureError(
          'Failed to send message: missing key.id'
        )
      );
    }
    await expect(servicePrivate.outboundSendRecoveryFlight).resolves.toBe(
      undefined
    );

    expect(recover).toHaveBeenCalledTimes(1);
  });

  it('debounces a transient disconnect and cancels its central downgrade after provider recovery', async () => {
    const { servicePrivate, balanceWorkerStatusGrpcClientService } =
      makeService();
    const disconnectedPayload: IBaileysConnectionState = {
      status: Status.connecting,
      code: ECodeMessage.awaitConnection,
      worker_id: 'worker-b',
      account_id: 'account-b',
      worker_status_id: EWorkerStatus.disponible,
      session_ready: false,
      can_send: false,
      can_receive_runtime: false,
      authenticated: false,
      provider_state: 'reconnecting',
      degraded_reason: 'connection_closed',
    };

    servicePrivate.scheduleTransientDisconnectStatus(
      disconnectedPayload,
      'close'
    );
    await jest.advanceTimersByTimeAsync(4_999);
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).not.toHaveBeenCalled();

    servicePrivate.cancelTransientDisconnectStatus();
    await jest.advanceTimersByTimeAsync(1);
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).not.toHaveBeenCalled();

    servicePrivate.scheduleTransientDisconnectStatus(
      disconnectedPayload,
      'close'
    );
    await jest.advanceTimersByTimeAsync(5_000);
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).toHaveBeenCalledTimes(1);
  });

  it('cancels an active connecting attempt when a user forces a new QR request', async () => {
    const { service, servicePrivate } = makeService();
    const state: IBaileysConnectionState = {
      status: Status.connecting,
      code: ECodeMessage.awaitingReadQrCode,
      worker_id: 'worker-b',
      account_id: 'account-b',
    };

    servicePrivate.connecting = true;
    servicePrivate.currentPromise = Promise.resolve(state);
    servicePrivate.status = Status.connecting;

    const cancelAttemptSpy = jest
      .spyOn(servicePrivate, 'cancelAttempt')
      .mockImplementation(() => {
        servicePrivate.connecting = false;
        servicePrivate.currentPromise = undefined;
      });
    const createSocketSpy = jest
      .spyOn(servicePrivate, 'createSocket')
      .mockResolvedValue({ socket: {}, saveCreds: jest.fn() });
    jest.spyOn(servicePrivate, 'prepareFolder').mockImplementation(() => {});
    jest.spyOn(servicePrivate, 'wait').mockResolvedValue(state);

    await service.connect({
      initial_connection: true,
      force_new: true,
      requested_by_user: true,
      type: EBaileysConnectionType.qrcode,
    });

    expect(cancelAttemptSpy).toHaveBeenCalled();
    expect(createSocketSpy).toHaveBeenCalled();
  });

  it('does not apply the first-QR deadline to a restored session while central readiness is pending', async () => {
    const { service, servicePrivate, balanceWorkerStatusGrpcClientService } =
      makeService();
    const events = new EventEmitter();
    const close = jest.fn();
    const socket = {
      ev: events,
      user: { id: '556199999999@s.whatsapp.net' },
      ws: {
        isOpen: true,
        socket: { readyState: 1, close },
      },
    };
    let releaseKafkaGate: (() => void) | undefined;
    let markKafkaGateStarted: (() => void) | undefined;
    const kafkaGateStarted = new Promise<void>((resolve) => {
      markKafkaGateStarted = resolve;
    });
    const kafkaGate = new Promise<void>((resolve) => {
      releaseKafkaGate = resolve;
    });
    mockEmitWorkerProviderRuntimeState.mockImplementation(
      async (_provider, ready) => {
        if (ready) {
          markKafkaGateStarted?.();
          await kafkaGate;
        }
      }
    );
    jest
      .spyOn(servicePrivate, 'logConnectionIpInLocal')
      .mockResolvedValue(undefined);
    jest.spyOn(service, 'hasSession').mockReturnValue(true);
    servicePrivate.initialConnection = true;
    servicePrivate.qrReadSessionActive = false;
    servicePrivate.qrReadSessionLocked = false;
    servicePrivate.status = Status.connecting;
    servicePrivate.socket = socket;
    servicePrivate.socketId = 41;

    const connection = servicePrivate.wait(socket, 41);
    events.emit('connection.update', { connection: 'open' });
    await kafkaGateStarted;
    await jest.advanceTimersByTimeAsync(25_001);

    expect(close).not.toHaveBeenCalled();
    expect(servicePrivate.socket).toBe(socket);
    expect(service.hasCentralOnlineAcknowledgement()).toBe(false);
    expect(service.canRecoverRestorableSession()).toBe(true);
    expect(
      service.ensureRestorableSessionRecovery(
        'self_monitor:kafka_readiness_pending'
      )
    ).toBe(false);
    expect(servicePrivate.reconnectRetryTimer).toBeUndefined();
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).not.toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'first_qr_timeout' })
    );

    releaseKafkaGate?.();
    await expect(connection).resolves.toEqual(
      expect.objectContaining({
        status: Status.connected,
        worker_status_id: EWorkerStatus.online,
      })
    );
    expect(service.canRecoverRestorableSession()).toBe(true);
    expect(service.hasCentralOnlineAcknowledgement()).toBe(true);
  });

  it('cancels an active first-QR deadline as soon as the socket opens', async () => {
    const { service, servicePrivate } = makeService();
    const events = new EventEmitter();
    const close = jest.fn();
    const socket = {
      ev: events,
      user: { id: '556199999999@s.whatsapp.net' },
      ws: {
        isOpen: true,
        socket: { readyState: 1, close },
      },
    };
    let releaseKafkaGate: (() => void) | undefined;
    let markKafkaGateStarted: (() => void) | undefined;
    const kafkaGateStarted = new Promise<void>((resolve) => {
      markKafkaGateStarted = resolve;
    });
    const kafkaGate = new Promise<void>((resolve) => {
      releaseKafkaGate = resolve;
    });
    mockEmitWorkerProviderRuntimeState.mockImplementation(
      async (_provider, ready) => {
        if (ready) {
          markKafkaGateStarted?.();
          await kafkaGate;
        }
      }
    );
    jest
      .spyOn(servicePrivate, 'logConnectionIpInLocal')
      .mockResolvedValue(undefined);
    jest.spyOn(service, 'hasSession').mockReturnValue(false);
    servicePrivate.initialConnection = true;
    servicePrivate.qrReadSessionActive = true;
    servicePrivate.qrReadSessionLocked = false;
    servicePrivate.status = Status.connecting;
    servicePrivate.socket = socket;
    servicePrivate.socketId = 42;

    const connection = servicePrivate.wait(socket, 42);
    events.emit('connection.update', { connection: 'open' });
    await kafkaGateStarted;
    await jest.advanceTimersByTimeAsync(25_001);

    expect(close).not.toHaveBeenCalled();
    expect(servicePrivate.socket).toBe(socket);

    releaseKafkaGate?.();
    await expect(connection).resolves.toEqual(
      expect.objectContaining({ status: Status.connected })
    );
  });

  it('restarts an unresolved user QR flow after the first-QR deadline', async () => {
    const { service, servicePrivate } = makeService();
    const events = new EventEmitter();
    const close = jest.fn();
    const socket = {
      ev: events,
      ws: {
        isOpen: true,
        socket: { readyState: 1, close },
      },
    };
    jest.spyOn(service, 'hasSession').mockReturnValue(false);
    const scheduleNextReconnectAttempt = jest
      .spyOn(servicePrivate, 'scheduleNextReconnectAttempt')
      .mockReturnValue(true);
    servicePrivate.initialConnection = true;
    servicePrivate.qrReadSessionActive = true;
    servicePrivate.qrReadSessionLocked = false;
    servicePrivate.qrLifecycleReconnectAuthorized = true;
    servicePrivate.status = Status.connecting;
    servicePrivate.socket = socket;
    servicePrivate.socketId = 43;

    const connection = servicePrivate.wait(socket, 43);
    await jest.advanceTimersByTimeAsync(25_000);

    await expect(connection).resolves.toEqual(
      expect.objectContaining({
        status: Status.connecting,
        reason: 'first_qr_timeout',
        qr_pending: true,
      })
    );
    expect(close).toHaveBeenCalledWith(1000, 'first_qr_timeout');
    expect(servicePrivate.socket).toBeUndefined();
    expect(servicePrivate.qrLifecycleReconnectAuthorized).toBe(true);
    expect(scheduleNextReconnectAttempt).toHaveBeenCalledWith(true);
    expect(servicePrivate.reconnectRetryTimer).toBeUndefined();
  });

  it('schedules one forced local reconnect for a recoverable missing socket', async () => {
    const { service, servicePrivate } = makeService();
    const state: IBaileysConnectionState = {
      status: Status.connecting,
      code: ECodeMessage.awaitConnection,
      worker_id: 'worker-b',
      account_id: 'account-b',
    };
    jest.spyOn(service, 'hasSession').mockReturnValue(true);
    const connect = jest.spyOn(service, 'connect').mockResolvedValue(state);
    servicePrivate.initialConnection = true;
    servicePrivate.status = Status.connecting;
    servicePrivate.connecting = false;
    servicePrivate.currentPromise = undefined;
    servicePrivate.socket = undefined;

    expect(
      service.ensureRestorableSessionRecovery('self_monitor:missing_socket')
    ).toBe(true);
    expect(
      service.ensureRestorableSessionRecovery('self_monitor:missing_socket')
    ).toBe(false);

    await jest.advanceTimersByTimeAsync(0);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({
        initial_connection: true,
        from_disconnect_restart: true,
        force_new: true,
        requested_by_user: false,
      })
    );
  });

  it.each([
    {
      providerState: 'closing',
      isClosing: true,
      isClosed: false,
      readyState: 2,
    },
    {
      providerState: 'closed',
      isClosing: false,
      isClosed: true,
      readyState: 3,
    },
  ])(
    'breaks an orphaned connection promise when its recoverable socket is definitely $providerState',
    async ({ providerState, isClosing, isClosed, readyState }) => {
      const { service, servicePrivate } = makeService();
      const state: IBaileysConnectionState = {
        status: Status.connecting,
        code: ECodeMessage.awaitConnection,
        worker_id: 'worker-b',
        account_id: 'account-b',
      };
      const pendingResolve = jest.fn();
      const socket = {
        ev: { removeAllListeners: jest.fn() },
        ws: {
          isOpen: false,
          isConnecting: false,
          isClosing,
          isClosed,
          socket: { readyState },
        },
      };
      jest.spyOn(service, 'hasSession').mockReturnValue(true);
      const connect = jest.spyOn(service, 'connect').mockResolvedValue(state);
      servicePrivate.initialConnection = true;
      servicePrivate.status = Status.connecting;
      servicePrivate.code = ECodeMessage.awaitConnection;
      servicePrivate.connecting = true;
      servicePrivate.currentPromise = new Promise(() => undefined);
      servicePrivate.pendingResolve = pendingResolve;
      servicePrivate.socket = socket;

      expect(
        service.ensureRestorableSessionRecovery(`self_monitor:${providerState}`)
      ).toBe(true);
      expect(pendingResolve).toHaveBeenCalledTimes(1);
      expect(servicePrivate.currentPromise).toBeUndefined();
      expect(servicePrivate.connecting).toBe(false);
      expect(servicePrivate.socket).toBeUndefined();

      await jest.advanceTimersByTimeAsync(0);

      expect(connect).toHaveBeenCalledTimes(1);
    }
  );

  it('lets an explicit session removal own the provider close callback', async () => {
    const {
      servicePrivate,
      balanceWorkerStatusGrpcClientService,
      incomingMessageService,
      healthCheckService,
    } = makeService();
    const settle = jest.fn();
    const clearFolder = jest
      .spyOn(servicePrivate, 'clearFolder')
      .mockImplementation(() => undefined);
    servicePrivate.explicitSessionRemovalInFlight = true;
    servicePrivate.status = Status.connected;
    servicePrivate.socket = {
      user: { id: '556199999999@s.whatsapp.net' },
    };
    servicePrivate.socketId = 78;
    mockEmitWorkerProviderRuntimeState.mockClear();

    await servicePrivate.onClose(
      {
        error: {
          output: { statusCode: ECodeMessage.loggedOut },
          message: 'authentication_revoked',
        },
      },
      settle,
      78
    );

    expect(settle).toHaveBeenCalledTimes(1);
    expect(clearFolder).not.toHaveBeenCalled();
    expect(
      incomingMessageService.markConnectionUnavailable
    ).not.toHaveBeenCalled();
    expect(healthCheckService.stop).not.toHaveBeenCalled();
    expect(mockEmitWorkerProviderRuntimeState).not.toHaveBeenCalled();
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).not.toHaveBeenCalled();
  });

  it('keeps a removed socket tombstoned after the explicit flight settles', async () => {
    const {
      service,
      servicePrivate,
      incomingMessageService,
      healthCheckService,
      balanceWorkerStatusGrpcClientService,
    } = makeService();
    jest.spyOn(servicePrivate, 'safeLogout').mockResolvedValue(undefined);
    jest
      .spyOn(servicePrivate, 'clearSessionStorage')
      .mockResolvedValue(undefined);
    jest
      .spyOn(servicePrivate, 'cancelAttempt')
      .mockImplementation(() => undefined);
    servicePrivate.socketId = 79;
    servicePrivate.socket = { user: { id: '556199999999@s.whatsapp.net' } };

    await service.disconnect({
      disconnected_user: true,
      remove_session: true,
      runtime_generation: 17,
    });

    expect(servicePrivate.explicitSessionRemovalInFlight).toBe(false);
    expect(servicePrivate.explicitSessionRemovalSocketId).toBe(79);
    incomingMessageService.markConnectionUnavailable.mockClear();
    healthCheckService.stop.mockClear();
    balanceWorkerStatusGrpcClientService.notifyWorkerStatus.mockClear();
    mockEmitWorkerProviderRuntimeState.mockClear();

    await servicePrivate.onClose(
      {
        error: {
          output: { statusCode: ECodeMessage.loggedOut },
          message: 'late authentication_revoked',
        },
      },
      jest.fn(),
      79
    );

    expect(
      incomingMessageService.markConnectionUnavailable
    ).not.toHaveBeenCalled();
    expect(healthCheckService.stop).not.toHaveBeenCalled();
    expect(mockEmitWorkerProviderRuntimeState).not.toHaveBeenCalled();
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).not.toHaveBeenCalled();
  });

  it('coalesces concurrent explicit removals and clears the session once', async () => {
    const { service, servicePrivate, balanceWorkerStatusGrpcClientService } =
      makeService();
    let releaseLogout!: () => void;
    const safeLogout = jest
      .spyOn(servicePrivate, 'safeLogout')
      .mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            releaseLogout = resolve;
          })
      );
    const clearFolder = jest
      .spyOn(servicePrivate, 'clearFolder')
      .mockImplementation(() => undefined);
    jest
      .spyOn(servicePrivate, 'cancelAttempt')
      .mockImplementation(() => undefined);

    const first = service.disconnect({
      disconnected_user: true,
      remove_session: true,
      runtime_generation: 17,
    });
    const second = service.disconnect({
      disconnected_user: true,
      remove_session: true,
      runtime_generation: 17,
    });
    await Promise.resolve();

    expect(safeLogout).toHaveBeenCalledTimes(1);
    releaseLogout();
    await Promise.all([first, second]);

    expect(clearFolder).toHaveBeenCalledTimes(1);
    expect(servicePrivate.explicitSessionRemovalFlight).toBeUndefined();
    expect(servicePrivate.explicitSessionRemovalInFlight).toBe(false);
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).not.toHaveBeenCalled();
  });

  it('releases the PostgreSQL session lease after clearing an explicit session', async () => {
    const previousStorage = process.env.WORKER_SESSION_STORAGE;
    process.env.WORKER_SESSION_STORAGE = 'postgres';
    try {
      const { servicePrivate } = makeService();
      const clearSession = jest.fn(async () => undefined);
      const close = jest.fn(async () => undefined);
      servicePrivate.postgresAuthStore = {
        clearSession,
        close,
      };
      servicePrivate.runtimeFenceConnectionAuthorization = {
        connection_epoch: '00000000-0000-4000-8000-000000000091',
        connection_attempt_id: '00000000-0000-4000-8000-000000000092',
      };

      await servicePrivate.clearSessionStorage();

      expect(clearSession).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);
      expect(clearSession.mock.invocationCallOrder[0]).toBeLessThan(
        close.mock.invocationCallOrder[0] ?? 0
      );
      expect(servicePrivate.postgresAuthStore).toBeUndefined();
      expect(
        servicePrivate.runtimeFenceConnectionAuthorization
      ).toBeUndefined();
    } finally {
      if (previousStorage === undefined) {
        delete process.env.WORKER_SESSION_STORAGE;
      } else {
        process.env.WORKER_SESSION_STORAGE = previousStorage;
      }
    }
  });

  it('runs a stronger remove-session request after an active preserve-session disconnect', async () => {
    const { service, servicePrivate } = makeService();
    let releaseFirstLogout!: () => void;
    const safeLogout = jest
      .spyOn(servicePrivate, 'safeLogout')
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            releaseFirstLogout = resolve;
          })
      )
      .mockResolvedValueOnce(undefined);
    const clearSessionStorage = jest
      .spyOn(servicePrivate, 'clearSessionStorage')
      .mockResolvedValue(undefined);
    jest
      .spyOn(servicePrivate, 'cancelAttempt')
      .mockImplementation(() => undefined);

    const preserve = service.disconnect({ preserve_session: true });
    const remove = service.disconnect({
      disconnected_user: true,
      remove_session: true,
      runtime_generation: 17,
    });
    await Promise.resolve();
    expect(safeLogout).toHaveBeenCalledTimes(1);

    releaseFirstLogout();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.all([preserve, remove]);

    expect(safeLogout).toHaveBeenCalledTimes(2);
    expect(clearSessionStorage).toHaveBeenCalledTimes(1);
  });

  it('waits for an active disconnect before starting a new connection', async () => {
    const { service, servicePrivate } = makeService();
    let releaseDisconnect!: () => void;
    servicePrivate.disconnectFlight = new Promise<void>((resolve) => {
      releaseDisconnect = resolve;
    });
    servicePrivate.connectionEstablished = true;
    servicePrivate.status = Status.connected;
    servicePrivate.socket = { user: { id: '556199999999@s.whatsapp.net' } };
    const prepareFolder = jest.spyOn(servicePrivate, 'prepareFolder');

    let settled = false;
    const connecting = service
      .connect({ requested_by_user: true })
      .finally(() => {
        settled = true;
      });
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(prepareFolder).not.toHaveBeenCalled();

    releaseDisconnect();
    await expect(connecting).resolves.toEqual(
      expect.objectContaining({ status: Status.connected })
    );
    expect(prepareFolder).not.toHaveBeenCalled();
  });

  it('does not break an active connection promise while its socket is still connecting', () => {
    const { service, servicePrivate } = makeService();
    const pendingResolve = jest.fn();
    const socket = {
      ev: { removeAllListeners: jest.fn() },
      ws: {
        isOpen: false,
        isConnecting: true,
        isClosing: false,
        isClosed: false,
        socket: { readyState: 0 },
      },
    };
    jest.spyOn(service, 'hasSession').mockReturnValue(true);
    servicePrivate.initialConnection = true;
    servicePrivate.status = Status.connecting;
    servicePrivate.code = ECodeMessage.awaitConnection;
    servicePrivate.connecting = true;
    servicePrivate.currentPromise = new Promise(() => undefined);
    servicePrivate.pendingResolve = pendingResolve;
    servicePrivate.socket = socket;

    expect(
      service.ensureRestorableSessionRecovery('self_monitor:connecting')
    ).toBe(false);
    expect(pendingResolve).not.toHaveBeenCalled();
    expect(servicePrivate.currentPromise).toBeDefined();
    expect(servicePrivate.socket).toBe(socket);
    expect(servicePrivate.reconnectRetryTimer).toBeUndefined();
  });

  it('keeps the QR readable when creds.me arrives before registration', () => {
    const { servicePrivate } = makeService();
    servicePrivate.initialConnection = true;
    servicePrivate.typeConnection = EBaileysConnectionType.qrcode;
    servicePrivate.status = Status.connecting;
    servicePrivate.code = ECodeMessage.awaitingReadQrCode;
    servicePrivate.qrHash = 'current-qr';
    servicePrivate.qrReadSessionActive = true;
    servicePrivate.qrReadSessionLocked = false;

    servicePrivate.maybeMarkPairingInProgressFromCreds({
      registered: false,
      me: { id: 'provisional@s.whatsapp.net' },
    });

    expect(servicePrivate.code).toBe(ECodeMessage.awaitingReadQrCode);
    expect(servicePrivate.qrReadSessionActive).toBe(true);
    expect(servicePrivate.qrReadSessionLocked).toBe(false);

    servicePrivate.maybeMarkPairingInProgressFromCreds({ registered: true });

    expect(servicePrivate.code).toBe(ECodeMessage.pairingInProgress);
    expect(servicePrivate.qrReadSessionActive).toBe(false);
    expect(servicePrivate.qrReadSessionLocked).toBe(true);
  });

  it('continues the same QR attempt after restartRequired without a stored session', async () => {
    const { service, servicePrivate } = makeService();
    const connect = jest.spyOn(service, 'connect').mockResolvedValue({
      status: Status.connecting,
      code: ECodeMessage.awaitingReadQrCode,
      worker_id: 'worker-b',
      account_id: 'account-b',
    });
    const settle = jest.fn();
    jest.spyOn(service, 'hasSession').mockReturnValue(false);
    servicePrivate.initialConnection = true;
    servicePrivate.typeConnection = EBaileysConnectionType.qrcode;
    servicePrivate.status = Status.connecting;
    servicePrivate.code = ECodeMessage.awaitingReadQrCode;
    servicePrivate.connectionAttemptId = 'attempt-after-qr';
    servicePrivate.runtimeGeneration = 21;
    servicePrivate.qrHash = 'emitted-qr';
    servicePrivate.qrReadSessionActive = true;
    servicePrivate.qrReadSessionLocked = false;
    servicePrivate.socket = {
      user: undefined,
      ws: {
        isOpen: false,
        isConnecting: false,
        isClosing: false,
        isClosed: true,
        socket: { readyState: 3 },
      },
    };
    servicePrivate.socketId = 88;

    await servicePrivate.onClose(
      {
        error: {
          output: { statusCode: ECodeMessage.restartRequired },
          message: 'restart required after QR',
        },
      },
      settle,
      88
    );

    expect(settle).toHaveBeenCalledWith(
      expect.objectContaining({
        code: ECodeMessage.awaitingReadQrCode,
        connection_attempt_id: 'attempt-after-qr',
      })
    );
    expect(servicePrivate.reconnectRetryTimer).toBeDefined();

    await jest.advanceTimersByTimeAsync(0);

    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({
        from_disconnect_restart: true,
        force_new: true,
        requested_by_user: false,
        connection_attempt_id: 'attempt-after-qr',
        runtime_generation: 21,
      })
    );
  });

  it('continues an active QR attempt after a recoverable 408 without a stored session', async () => {
    const { service, servicePrivate } = makeService();
    const connect = jest.spyOn(service, 'connect').mockResolvedValue({
      status: Status.connecting,
      code: ECodeMessage.awaitingReadQrCode,
      worker_id: 'worker-b',
      account_id: 'account-b',
    });
    const settle = jest.fn();
    jest.spyOn(service, 'hasSession').mockReturnValue(false);
    servicePrivate.initialConnection = true;
    servicePrivate.typeConnection = EBaileysConnectionType.qrcode;
    servicePrivate.status = Status.connecting;
    servicePrivate.code = ECodeMessage.awaitingReadQrCode;
    servicePrivate.connectionAttemptId = 'attempt-after-timeout';
    servicePrivate.runtimeGeneration = 22;
    servicePrivate.qrHash = 'emitted-qr';
    servicePrivate.qrGenerationCount = 1;
    servicePrivate.qrReadSessionActive = true;
    servicePrivate.qrReadSessionLocked = false;
    servicePrivate.socket = {
      user: undefined,
      ws: {
        isOpen: false,
        isConnecting: false,
        isClosing: false,
        isClosed: true,
        socket: { readyState: 3 },
      },
    };
    servicePrivate.socketId = 90;

    await servicePrivate.onClose(
      {
        error: {
          output: { statusCode: ECodeMessage.connectionLost },
          message: 'Request Timeout',
        },
      },
      settle,
      90
    );

    expect(servicePrivate.qrLifecycleReconnectAuthorized).toBe(true);
    expect(servicePrivate.reconnectRetryTimer).toBeDefined();

    await jest.advanceTimersByTimeAsync(0);

    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({
        from_disconnect_restart: true,
        force_new: true,
        requested_by_user: false,
        connection_attempt_id: 'attempt-after-timeout',
        runtime_generation: 22,
      })
    );
  });

  it('renews an unread QR five times and only then closes the QR lifecycle', async () => {
    const { service, servicePrivate } = makeService();
    const connect = jest.spyOn(service, 'connect').mockResolvedValue({
      status: Status.connecting,
      code: ECodeMessage.awaitingReadQrCode,
      worker_id: 'worker-b',
      account_id: 'account-b',
    });
    jest.spyOn(service, 'hasSession').mockReturnValue(false);
    servicePrivate.initialConnection = true;
    servicePrivate.typeConnection = EBaileysConnectionType.qrcode;
    servicePrivate.status = Status.connecting;
    servicePrivate.code = ECodeMessage.awaitingReadQrCode;
    servicePrivate.connectionAttemptId = 'five-qr-attempt';
    servicePrivate.qrReadSessionActive = true;
    servicePrivate.qrReadSessionLocked = false;
    servicePrivate.qrGenerationCount = 5;
    servicePrivate.qrHash = 'fifth-qr';
    servicePrivate.socketId = 91;

    servicePrivate.scheduleQrRenewal(91, 'fifth-qr');
    expect(servicePrivate.qrRenewalTimer).toBeDefined();

    await jest.advanceTimersByTimeAsync(25_000);

    expect(connect).not.toHaveBeenCalled();
    expect(servicePrivate.qrReadSessionActive).toBe(false);
    expect(servicePrivate.qrReadSessionLocked).toBe(true);
    expect(servicePrivate.status).toBe(Status.disconnected);
    expect(servicePrivate.qrRenewalTimer).toBeUndefined();
  });

  it('publishes the QR terminal before tearing down its provider socket', async () => {
    const { servicePrivate } = makeService();
    let releaseNotification!: () => void;
    const notificationPending = new Promise<void>((resolve) => {
      releaseNotification = resolve;
    });
    const notifyWorkerStatusSafely = jest
      .spyOn(servicePrivate, 'notifyWorkerStatusSafely')
      .mockImplementation(async () => {
        await notificationPending;
        return { outcome: 'accepted' };
      });
    const cancelAttempt = jest.spyOn(servicePrivate, 'cancelAttempt');
    servicePrivate.initialConnection = true;
    servicePrivate.typeConnection = EBaileysConnectionType.qrcode;
    servicePrivate.connectionAttemptId = 'terminal-order-attempt';
    servicePrivate.qrReadSessionActive = true;
    servicePrivate.qrGenerationCount = 5;

    const terminalFlight = servicePrivate.handleQrGenerationLimitReached();
    await Promise.resolve();

    expect(notifyWorkerStatusSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 6,
        max_attempts: 5,
        connection_attempt_id: 'terminal-order-attempt',
      }),
      'qr_limit_reached'
    );
    expect(cancelAttempt).not.toHaveBeenCalled();

    releaseNotification();
    await terminalFlight;

    expect(cancelAttempt).toHaveBeenCalledWith(false);
  });

  it('bounds QR terminal publication before tearing down its provider socket', async () => {
    const { servicePrivate } = makeService();
    jest
      .spyOn(servicePrivate, 'notifyWorkerStatusSafely')
      .mockImplementation(() => new Promise(() => undefined));
    const cancelAttempt = jest.spyOn(servicePrivate, 'cancelAttempt');
    servicePrivate.initialConnection = true;
    servicePrivate.typeConnection = EBaileysConnectionType.qrcode;
    servicePrivate.connectionAttemptId = 'terminal-timeout-attempt';
    servicePrivate.qrReadSessionActive = true;
    servicePrivate.qrGenerationCount = 5;

    const terminalFlight = servicePrivate.handleQrGenerationLimitReached();
    await jest.advanceTimersByTimeAsync(4_999);
    expect(cancelAttempt).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    await terminalFlight;

    expect(cancelAttempt).toHaveBeenCalledWith(false);
    expect(console.error).toHaveBeenCalledWith(
      '[BaileysConnection] QR terminal publication delayed',
      expect.any(Object)
    );
  });

  it('recycles the provider socket immediately when an unread QR expires', async () => {
    const { service, servicePrivate } = makeService();
    const connect = jest.spyOn(service, 'connect').mockResolvedValue({
      status: Status.connecting,
      code: ECodeMessage.awaitingReadQrCode,
      worker_id: 'worker-b',
      account_id: 'account-b',
    });
    const scheduleNextReconnectAttempt = jest.spyOn(
      servicePrivate,
      'scheduleNextReconnectAttempt'
    );
    const close = jest.fn();
    servicePrivate.initialConnection = true;
    servicePrivate.typeConnection = EBaileysConnectionType.qrcode;
    servicePrivate.status = Status.connecting;
    servicePrivate.code = ECodeMessage.awaitingReadQrCode;
    servicePrivate.connectionAttemptId = 'rotating-qr-attempt';
    servicePrivate.runtimeGeneration = 17;
    servicePrivate.qrReadSessionActive = true;
    servicePrivate.qrReadSessionLocked = false;
    servicePrivate.qrGenerationCount = 1;
    servicePrivate.qrHash = 'first-qr';
    servicePrivate.socket = {
      ev: { removeAllListeners: jest.fn() },
      ws: { socket: { readyState: 1, close } },
    };
    servicePrivate.socketId = 92;

    servicePrivate.scheduleQrRenewal(92, 'first-qr');
    await jest.advanceTimersByTimeAsync(25_000);

    expect(close).toHaveBeenCalledWith(1000, 'reconnect');
    expect(servicePrivate.qrHash).toBeUndefined();
    expect(servicePrivate.qrGenerationCount).toBe(1);
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({
        from_disconnect_restart: true,
        force_new: true,
        requested_by_user: false,
        connection_attempt_id: 'rotating-qr-attempt',
        runtime_generation: 17,
      })
    );
    expect(scheduleNextReconnectAttempt).not.toHaveBeenCalled();
  });

  it('continues a requested QR flow when restartRequired arrives before the first QR', async () => {
    const { service, servicePrivate } = makeService();
    jest.spyOn(service, 'hasSession').mockReturnValue(false);
    servicePrivate.initialConnection = true;
    servicePrivate.typeConnection = EBaileysConnectionType.qrcode;
    servicePrivate.status = Status.connecting;
    servicePrivate.code = ECodeMessage.awaitConnection;
    servicePrivate.qrHash = undefined;
    servicePrivate.qrReadSessionActive = true;
    servicePrivate.qrReadSessionLocked = false;
    servicePrivate.socket = {
      user: undefined,
      ws: {
        isOpen: false,
        isConnecting: false,
        isClosing: false,
        isClosed: true,
        socket: { readyState: 3 },
      },
    };
    servicePrivate.socketId = 87;

    await servicePrivate.onClose(
      {
        error: {
          output: { statusCode: ECodeMessage.restartRequired },
          message: 'restart required before QR',
        },
      },
      jest.fn(),
      87
    );

    expect(servicePrivate.qrLifecycleReconnectAuthorized).toBe(true);
    expect(servicePrivate.reconnectRetryTimer).toBeDefined();
  });

  it('continues an unregistered pairing across restartRequired', async () => {
    const { service, servicePrivate } = makeService();
    const connect = jest.spyOn(service, 'connect').mockResolvedValue({
      status: Status.connecting,
      code: ECodeMessage.pairingInProgress,
      worker_id: 'worker-b',
      account_id: 'account-b',
    });
    jest.spyOn(service, 'hasSession').mockReturnValue(false);
    servicePrivate.initialConnection = true;
    servicePrivate.typeConnection = EBaileysConnectionType.qrcode;
    servicePrivate.status = Status.connecting;
    servicePrivate.code = ECodeMessage.pairingInProgress;
    servicePrivate.connectionAttemptId = 'unregistered-pairing';
    servicePrivate.qrReadSessionActive = false;
    servicePrivate.qrReadSessionLocked = true;
    servicePrivate.socket = {
      user: undefined,
      ws: {
        isOpen: false,
        isConnecting: false,
        isClosing: false,
        isClosed: true,
        socket: { readyState: 3 },
      },
    };
    servicePrivate.socketId = 89;

    expect(servicePrivate.canContinueQrPairingReconnect(true)).toBe(true);

    await servicePrivate.onClose(
      {
        error: {
          output: { statusCode: ECodeMessage.restartRequired },
          message: 'restart required while registering',
        },
      },
      jest.fn(),
      89
    );

    expect(servicePrivate.code).toBe(ECodeMessage.pairingInProgress);
    expect(servicePrivate.reconnectRetryTimer).toBeDefined();

    await jest.advanceTimersByTimeAsync(0);

    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({
        from_disconnect_restart: true,
        connection_attempt_id: 'unregistered-pairing',
      })
    );
  });

  it('keeps the authorized QR lifecycle retry after a transient socket creation failure', () => {
    const { service, servicePrivate } = makeService();
    jest.spyOn(service, 'hasSession').mockReturnValue(false);
    servicePrivate.initialConnection = true;
    servicePrivate.typeConnection = EBaileysConnectionType.qrcode;
    servicePrivate.status = Status.connecting;
    servicePrivate.code = ECodeMessage.pairingInProgress;
    servicePrivate.qrLifecycleReconnectAuthorized = true;

    const state = servicePrivate.handleSocketCreateFailure(
      new Error('transient socket creation failure')
    );

    expect(state).toEqual(
      expect.objectContaining({
        reason: 'socket_create_error',
        qr_pending: true,
      })
    );
    expect(servicePrivate.reconnectRetryTimer).toBeDefined();
  });

  it('keeps a post-quantum source recovery inside the current QR attempt', () => {
    const { service, servicePrivate } = makeService();
    jest.spyOn(service, 'hasSession').mockReturnValue(false);
    servicePrivate.initialConnection = true;
    servicePrivate.typeConnection = EBaileysConnectionType.qrcode;
    servicePrivate.status = Status.connecting;
    servicePrivate.code = ECodeMessage.awaitConnection;
    servicePrivate.qrReadSessionActive = true;
    servicePrivate.qrLifecycleReconnectAuthorized = true;

    const state = servicePrivate.handleSocketCreateFailure(
      new Error('baileys_pq_rollback_source_recovery_pending')
    );

    expect(state).toEqual(
      expect.objectContaining({
        status: Status.connecting,
        worker_status_id: EWorkerStatus.disponible,
        qr_pending: true,
        reason: 'socket_create_error',
      })
    );
    expect(servicePrivate.reconnectRetryTimer).toBeDefined();
  });

  it('retries an active QR setup after a short bounded delay', async () => {
    const { service, servicePrivate } = makeService();
    const connect = jest.spyOn(service, 'connect').mockResolvedValue({
      status: Status.connecting,
      code: ECodeMessage.awaitingReadQrCode,
      worker_id: 'worker-b',
      account_id: 'account-b',
    });
    jest.spyOn(service, 'hasSession').mockReturnValue(false);
    servicePrivate.initialConnection = true;
    servicePrivate.typeConnection = EBaileysConnectionType.qrcode;
    servicePrivate.status = Status.connecting;
    servicePrivate.code = ECodeMessage.awaitConnection;
    servicePrivate.connectionAttemptId = 'short-setup-retry';
    servicePrivate.qrLifecycleReconnectAuthorized = true;
    servicePrivate.qrReadSessionActive = true;
    servicePrivate.qrReadSessionLocked = false;
    servicePrivate.retryCount = 1;

    expect(servicePrivate.scheduleNextReconnectAttempt(true)).toBe(true);
    await jest.advanceTimersByTimeAsync(1_499);
    expect(connect).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({
        from_disconnect_restart: true,
        connection_attempt_id: 'short-setup-retry',
      })
    );
  });

  it('retries a pending provider handoff after a short bounded delay', async () => {
    const { service, servicePrivate } = makeService();
    const connect = jest.spyOn(service, 'connect').mockResolvedValue({
      status: Status.connecting,
      code: ECodeMessage.awaitConnection,
      worker_id: 'worker-b',
      account_id: 'account-b',
    });
    jest.spyOn(service, 'hasSession').mockReturnValue(true);
    servicePrivate.postgresAuthStore = {
      close: jest.fn(async () => undefined),
      hasPendingHandoff: () => true,
    };
    servicePrivate.initialConnection = true;
    servicePrivate.typeConnection = EBaileysConnectionType.qrcode;
    servicePrivate.status = Status.connecting;
    servicePrivate.code = ECodeMessage.awaitConnection;
    servicePrivate.retryCount = 1;

    expect(servicePrivate.scheduleNextReconnectAttempt(false)).toBe(true);
    await jest.advanceTimersByTimeAsync(1_999);
    expect(connect).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({
        from_disconnect_restart: true,
        force_new: true,
      })
    );
  });

  it('gives an explicit post-logout QR request a fresh immediate retry budget', async () => {
    const { service, servicePrivate } = makeService();
    jest.spyOn(service, 'hasSession').mockReturnValue(false);
    jest.spyOn(servicePrivate, 'prepareFolder').mockImplementation(() => {});
    const createSocket = jest
      .spyOn(servicePrivate, 'createSocket')
      .mockRejectedValue(
        new Error('baileys_pq_rollback_source_recovery_pending')
      );
    servicePrivate.status = Status.disconnected;
    servicePrivate.code = ECodeMessage.connectionClosed;
    servicePrivate.connectionEstablished = false;
    servicePrivate.retryCount = 3;
    servicePrivate.qrReadSessionActive = true;
    servicePrivate.qrLifecycleReconnectAuthorized = true;
    const scheduleReconnect = jest.spyOn(
      servicePrivate,
      'scheduleNextReconnectAttempt'
    );

    const state = await servicePrivate.connectExclusive({
      initial_connection: true,
      type: EBaileysConnectionType.qrcode,
      force_new: true,
      requested_by_user: true,
      from_disconnect_restart: true,
      allow_restore: false,
      connection_attempt_id: 'post-logout-user-restart',
    });

    expect(state).toEqual(
      expect.objectContaining({
        qr_pending: true,
        connection_attempt_id: 'post-logout-user-restart',
      })
    );
    expect(createSocket).toHaveBeenCalledTimes(1);
    expect(scheduleReconnect).toHaveBeenCalledTimes(1);
    expect(servicePrivate.retryCount).toBe(1);
    expect(servicePrivate.reconnectRetryTimer).toBeDefined();
  });

  it('never exposes QR or reconnects after a terminal canonical candidate failure', () => {
    const { servicePrivate } = makeService();
    const store = { close: jest.fn(async () => undefined) };
    servicePrivate.postgresAuthStore = store;
    const scheduleReconnect = jest
      .spyOn(servicePrivate, 'scheduleNextReconnectAttempt')
      .mockImplementation(() => false);

    const state = servicePrivate.handleSocketCreateFailure(
      new BaileysCanonicalCodecError('PROJECTION_INVALID')
    );

    expect(state).toEqual(
      expect.objectContaining({
        status: Status.disconnected,
        code: ECodeMessage.badSession,
        worker_status_id: EWorkerStatus.error,
        reason: 'PROJECTION_INVALID',
        qr_pending: false,
      })
    );
    expect(scheduleReconnect).not.toHaveBeenCalled();
    expect(store.close).toHaveBeenCalledTimes(1);
  });

  it('stops a ready target after terminal pre-CAS promotion compensation', async () => {
    const { servicePrivate, incomingMessageService, healthCheckService } =
      makeService();
    const store = { close: jest.fn(async () => undefined) };
    const socket = {
      ...makeHandoffSocket(),
      user: { id: '5511999999999@s.whatsapp.net' },
    };
    servicePrivate.postgresAuthStore = store;
    servicePrivate.socket = socket;
    servicePrivate.socketId = 91;
    servicePrivate.readyConfirmationEpoch = 4;
    servicePrivate.userRequestedDisconnect = false;
    const scheduleKafkaReadinessRetry = jest.spyOn(
      servicePrivate,
      'scheduleKafkaReadinessRetry'
    );

    const state = await servicePrivate.handleReadyRuntimeFailure(
      {
        socket,
        socketId: 91,
        epoch: 4,
        source: 'open',
        connectionAttemptId: 'candidate-promotion',
        runtimeGeneration: 17,
      },
      {
        session_ready: true,
        can_send: true,
        can_receive_runtime: true,
        authenticated: true,
        provider_state: 'online',
      },
      new BaileysCanonicalCodecError('PROJECTION_INVALID')
    );

    expect(state).toEqual(
      expect.objectContaining({
        status: Status.disconnected,
        code: ECodeMessage.badSession,
        worker_status_id: EWorkerStatus.error,
        provider_state: 'invalid_session',
        qr_pending: false,
        session_ready: false,
      })
    );
    expect(socket.ws.close).toHaveBeenCalledTimes(1);
    expect(
      incomingMessageService.markConnectionUnavailable
    ).toHaveBeenCalledWith(socket);
    expect(healthCheckService.stop).toHaveBeenCalled();
    expect(store.close).toHaveBeenCalledTimes(1);
    expect(scheduleKafkaReadinessRetry).not.toHaveBeenCalled();
  });

  it.each([
    ECodeMessage.loggedOut,
    ECodeMessage.multideviceMismatch,
    ECodeMessage.connectionReplaced,
    ECodeMessage.badSession,
  ])(
    'does not reconnect after terminal provider close code %s',
    async (code) => {
      const { service, servicePrivate } = makeService();
      const socket = {
        ev: { removeAllListeners: jest.fn() },
        user: { id: '556199999999@s.whatsapp.net' },
        ws: {
          isOpen: false,
          isConnecting: false,
          isClosing: false,
          isClosed: true,
          socket: { readyState: 3 },
        },
      };
      const settle = jest.fn();
      jest.spyOn(service, 'hasSession').mockReturnValue(true);
      jest.spyOn(servicePrivate, 'clearFolder').mockImplementation(() => {});
      const scheduleNextReconnectAttempt = jest.spyOn(
        servicePrivate,
        'scheduleNextReconnectAttempt'
      );
      servicePrivate.initialConnection = true;
      servicePrivate.status = Status.connected;
      servicePrivate.code = ECodeMessage.connectionEstablished;
      servicePrivate.socket = socket;
      servicePrivate.socketId = 77;

      await servicePrivate.onClose(
        {
          error: {
            output: { statusCode: code },
            message: `terminal_${String(code)}`,
          },
        },
        settle,
        77
      );

      expect(settle).toHaveBeenCalledTimes(1);
      expect(scheduleNextReconnectAttempt).not.toHaveBeenCalled();
      expect(servicePrivate.reconnectRetryTimer).toBeUndefined();
      expect(service.canRecoverRestorableSession()).toBe(false);
    }
  );

  it('confirms device_removed once before clearing the canonical session', async () => {
    const { service, servicePrivate } = makeService();
    const socket = {
      ev: { removeAllListeners: jest.fn() },
      user: { id: '556199999999@s.whatsapp.net' },
      ws: {
        isOpen: false,
        isConnecting: false,
        isClosing: false,
        isClosed: true,
        socket: { readyState: 3 },
      },
    };
    const clearSessionStorage = jest
      .spyOn(servicePrivate, 'clearSessionStorage')
      .mockResolvedValue(undefined);
    const scheduleNextReconnectAttempt = jest.spyOn(
      servicePrivate,
      'scheduleNextReconnectAttempt'
    );
    jest.spyOn(service, 'hasSession').mockReturnValue(true);
    servicePrivate.initialConnection = true;
    servicePrivate.status = Status.connected;
    servicePrivate.code = ECodeMessage.connectionEstablished;
    servicePrivate.socket = socket;
    servicePrivate.socketId = 78;

    const disconnect = {
      error: {
        output: { statusCode: ECodeMessage.loggedOut },
        message: 'Stream Errored (conflict)',
        data: { tag: 'conflict', attrs: { type: 'device_removed' } },
      },
    };

    await servicePrivate.onClose(disconnect, jest.fn(), 78);

    expect(servicePrivate.deviceRemovedConfirmationPending).toBe(true);
    expect(clearSessionStorage).not.toHaveBeenCalled();
    expect(scheduleNextReconnectAttempt).toHaveBeenCalledTimes(1);
    expect(servicePrivate.status).toBe(Status.connecting);
    expect(servicePrivate.code).toBe(ECodeMessage.awaitConnection);

    await servicePrivate.onClose(disconnect, jest.fn(), 78);

    expect(clearSessionStorage).toHaveBeenCalledTimes(1);
    expect(servicePrivate.deviceRemovedConfirmationPending).toBe(false);
    expect(servicePrivate.status).toBe(Status.disconnected);
    expect(servicePrivate.code).toBe(ECodeMessage.loggedOut);
  });

  it('does not locally recover a user-disconnected session', () => {
    const { service, servicePrivate } = makeService();
    jest.spyOn(service, 'hasSession').mockReturnValue(true);
    servicePrivate.initialConnection = true;
    servicePrivate.userRequestedDisconnect = true;
    servicePrivate.socket = undefined;

    expect(service.canRecoverRestorableSession()).toBe(false);
    expect(
      service.ensureRestorableSessionRecovery('self_monitor:missing_socket')
    ).toBe(false);
    expect(servicePrivate.reconnectRetryTimer).toBeUndefined();
  });

  it('preserves connection identity during an automatic QR reconnect', async () => {
    const { service, servicePrivate } = makeService();

    servicePrivate.connectionAttemptId = 'attempt-qr-1';
    servicePrivate.runtimeGeneration = 3;
    servicePrivate.status = Status.connecting;

    const state = await service.connect({
      initial_connection: true,
      from_disconnect_restart: true,
      type: EBaileysConnectionType.qrcode,
    });

    expect(state).toEqual(
      expect.objectContaining({
        connection_attempt_id: 'attempt-qr-1',
        runtime_generation: 3,
      })
    );
  });

  it('initializes and preserves runtime generation from the environment', async () => {
    const { service, servicePrivate } = makeService();
    const state: IBaileysConnectionState = {
      status: Status.connecting,
      code: ECodeMessage.awaitConnection,
      worker_id: 'worker-b',
      account_id: 'account-b',
    };

    expect(servicePrivate.runtimeGeneration).toBe(17);
    servicePrivate.connecting = true;
    servicePrivate.currentPromise = Promise.resolve(state);

    await service.connect({
      initial_connection: true,
      requested_by_user: true,
      type: EBaileysConnectionType.qrcode,
    });

    expect(servicePrivate.runtimeGeneration).toBe(17);
  });

  it('propagates connection metadata into reconnect and disconnect paths', async () => {
    const { service, servicePrivate, balanceWorkerStatusGrpcClientService } =
      makeService();
    const state: IBaileysConnectionState = {
      status: Status.connecting,
      code: ECodeMessage.awaitConnection,
      worker_id: 'worker-b',
      account_id: 'account-b',
    };
    jest.spyOn(service, 'hasSession').mockReturnValue(false);
    const connectSpy = jest.spyOn(service, 'connect').mockResolvedValue(state);

    servicePrivate.centralOnlineAcknowledged = true;
    service.reconnect({
      initial_connection: true,
      connection_attempt_id: 'reconnect-attempt',
      runtime_generation: 23,
      debug_trace_id: 'reconnect-trace',
    });

    expect(servicePrivate.centralOnlineAcknowledged).toBe(false);
    expect(connectSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        connection_attempt_id: 'reconnect-attempt',
        runtime_generation: 23,
        debug_trace_id: 'reconnect-trace',
      })
    );

    connectSpy.mockRestore();
    jest.spyOn(servicePrivate, 'safeLogout').mockResolvedValue(undefined);
    jest
      .spyOn(servicePrivate, 'cancelAttempt')
      .mockImplementation(() => undefined);

    await service.disconnect({
      initial_connection: false,
      disconnected_user: true,
      connection_attempt_id: 'disconnect-attempt',
      runtime_generation: 24,
      debug_trace_id: 'disconnect-trace',
    });

    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        connection_attempt_id: 'disconnect-attempt',
        runtime_generation: 24,
        debug_trace_id: 'disconnect-trace',
        connection_epoch: '00000000-0000-4000-8000-000000000071',
        connection_sequence: 7,
      })
    );
  });

  it('uses the bundled Baileys version when remote version resolution fails', async () => {
    const { servicePrivate } = makeService();
    const socket = { ev: { on: jest.fn() } };

    (fetchLatestWaWebVersion as jest.Mock).mockResolvedValueOnce({
      version: [2, 3000, 0],
      isLatest: false,
      error: new Error('wa web unavailable'),
    });
    (fetchLatestBaileysVersion as jest.Mock).mockResolvedValueOnce({
      version: [2, 3000, 0],
      isLatest: false,
      error: new Error('github unavailable'),
    });
    (makeWASocket as jest.Mock).mockReturnValueOnce(socket);

    await servicePrivate.createSocket();

    expect(makeWASocket).toHaveBeenCalledWith(
      expect.objectContaining({
        version: [2, 3000, 1035194821],
      })
    );
  });

  it('announces Chrome as the default browser for QR pairing', async () => {
    const { servicePrivate } = makeService();
    const socket = { ev: { on: jest.fn() } };

    (makeWASocket as jest.Mock).mockReturnValueOnce(socket);

    await servicePrivate.createSocket();

    expect(Browsers.macOS).toHaveBeenCalledWith('Chrome');
    expect(makeWASocket).toHaveBeenCalledWith(
      expect.objectContaining({
        browser: ['Mac OS', 'Chrome', '14.4.1'],
      })
    );
  });

  it('logs credential persistence SQLSTATE and only an allowlisted PostgreSQL message code', async () => {
    const secret = 'postgres://runtime:capability@database/session-private';
    const saveCreds = jest.fn(async () => {
      throw Object.assign(
        new Error('whatsapp session changed during pairing finalization'),
        {
          code: '40001',
          detail: secret,
          jid: '5511999999999@s.whatsapp.net',
        }
      );
    });
    let onCredsUpdate: ((creds: Record<string, unknown>) => void) | undefined;
    const socket = {
      ev: {
        on: jest.fn((event: string, listener: (value: unknown) => void) => {
          if (event === 'creds.update') {
            onCredsUpdate = listener as (
              creds: Record<string, unknown>
            ) => void;
          }
        }),
      },
    };
    (useMultiFileAuthState as jest.Mock).mockResolvedValueOnce({
      state: {},
      saveCreds,
    });
    (makeWASocket as jest.Mock).mockReturnValueOnce(socket);
    const { servicePrivate } = makeService();

    await servicePrivate.createSocket();
    expect(onCredsUpdate).toBeDefined();
    onCredsUpdate?.({});
    await servicePrivate.credentialPersistenceBarrier?.tail.catch(
      () => undefined
    );
    await Promise.resolve();

    const persistenceLog = jest
      .mocked(console.error)
      .mock.calls.find(
        ([message]) =>
          message === '[BaileysConnection] Failed to persist credentials'
      );
    expect(persistenceLog?.[1]).toEqual(
      expect.objectContaining({
        session_storage: 'legacy_volume',
        sequence: 1,
        error_name: 'error',
        error_code: '40001',
        native_error_code: 'native_error_code_unavailable',
        postgres_error_code: 'sqlstate_40001',
        postgres_message_error_code:
          'whatsapp_session_changed_during_pairing_finalization',
      })
    );
    const serializedLog = JSON.stringify(persistenceLog);
    expect(serializedLog).not.toContain(secret);
    expect(serializedLog).not.toContain('5511999999999');
  });

  it('reacquires the runtime fence before Kafka startup and online status', async () => {
    const {
      service,
      servicePrivate,
      balanceWorkerStatusGrpcClientService,
      healthCheckService,
      incomingMessageService,
    } = makeService();
    const socket = {
      user: { id: '556199999999@s.whatsapp.net' },
    };
    let releaseKafkaGate: (() => void) | undefined;
    const kafkaGate = new Promise<void>((resolve) => {
      releaseKafkaGate = resolve;
    });
    mockEmitWorkerProviderRuntimeState.mockImplementation(
      async (_provider, ready) => {
        if (ready) {
          await kafkaGate;
        }
      }
    );
    servicePrivate.socket = socket;
    servicePrivate.socketId = 7;
    servicePrivate.runtimeGeneration = 12;

    const verification = service.verifyAndPublishConnectionStatus({
      connection_attempt_id: 'attempt-ready',
      runtime_generation: 12,
      debug_trace_id: 'trace-ready',
    });
    for (let index = 0; index < 4; index += 1) {
      await Promise.resolve();
    }

    expect(incomingMessageService.markConnectionReady).toHaveBeenCalledWith(
      socket
    );
    expect(mockEmitWorkerProviderRuntimeState).toHaveBeenCalledWith(
      'baileys',
      true
    );
    expect(
      incomingMessageService.markConnectionReady.mock.invocationCallOrder[0]
    ).toBeLessThan(
      mockEmitWorkerProviderRuntimeState.mock.invocationCallOrder.find(
        (_order, index) =>
          mockEmitWorkerProviderRuntimeState.mock.calls[index]?.[1] === true
      ) as number
    );
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).not.toHaveBeenCalled();
    expect(healthCheckService.markStatusPublished).not.toHaveBeenCalled();

    releaseKafkaGate?.();
    await expect(verification).resolves.toEqual(
      expect.objectContaining({
        status: Status.connected,
        worker_status_id: EWorkerStatus.online,
        connection_attempt_id: 'attempt-ready',
        runtime_generation: 12,
        debug_trace_id: 'trace-ready',
      })
    );

    expect(healthCheckService.verifyCurrentSession).toHaveBeenCalledTimes(2);
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_status_id: EWorkerStatus.online,
        runtime_generation: 12,
        connection_epoch: '00000000-0000-4000-8000-000000000071',
        connection_sequence: 7,
      })
    );
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus.mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      healthCheckService.markStatusPublished.mock.invocationCallOrder[0]
    );
    expect(service.hasCentralOnlineAcknowledgement()).toBe(true);
  });

  it('contains a PostgreSQL import promotion rejection inside the ready confirmation', async () => {
    const previousStorage = process.env.WORKER_SESSION_STORAGE;
    process.env.WORKER_SESSION_STORAGE = 'postgres';
    try {
      const { service, servicePrivate, incomingMessageService } = makeService();
      const socket = {
        user: { id: '556199999999@s.whatsapp.net' },
      };
      const promoteStagedImportIfReady = jest.fn(async () => {
        throw new BaileysSessionFenceError('REVISION_INVALID');
      });
      servicePrivate.socket = socket;
      servicePrivate.socketId = 72;
      servicePrivate.postgresAuthStore = {
        close: jest.fn(async () => undefined),
        promoteStagedImportIfReady,
      };

      await expect(
        service.verifyAndPublishConnectionStatus({ runtime_generation: 18 })
      ).resolves.toEqual(
        expect.objectContaining({
          status: Status.connecting,
          worker_status_id: EWorkerStatus.disponible,
          provider_state: 'kafka_consumers_not_ready',
          degraded_reason: 'REVISION_INVALID',
        })
      );

      expect(promoteStagedImportIfReady).toHaveBeenCalledTimes(1);
      expect(
        incomingMessageService.markConnectionUnavailable
      ).toHaveBeenCalledWith(socket);
      expect(service.hasCentralOnlineAcknowledgement()).toBe(false);
    } finally {
      if (previousStorage === undefined) {
        delete process.env.WORKER_SESSION_STORAGE;
      } else {
        process.env.WORKER_SESSION_STORAGE = previousStorage;
      }
    }
  });

  it('does not expose online readiness before the central Notify ACK resolves', async () => {
    const { service, servicePrivate, balanceWorkerStatusGrpcClientService } =
      makeService();
    const socket = {
      user: { id: '556199999999@s.whatsapp.net' },
    };
    let releaseNotify: (() => void) | undefined;
    let markNotifyStarted: (() => void) | undefined;
    const notifyStarted = new Promise<void>((resolve) => {
      markNotifyStarted = resolve;
    });
    const notifyGate = new Promise<void>((resolve) => {
      releaseNotify = resolve;
    });
    balanceWorkerStatusGrpcClientService.notifyWorkerStatus.mockImplementationOnce(
      async () => {
        markNotifyStarted?.();
        await notifyGate;
      }
    );
    servicePrivate.socket = socket;
    servicePrivate.socketId = 8;

    const verification = service.verifyAndPublishConnectionStatus({
      runtime_generation: 17,
    });
    await notifyStarted;

    expect(servicePrivate.status).not.toBe(Status.connected);
    expect(servicePrivate.connectionEstablished).toBe(false);
    expect(service.hasCentralOnlineAcknowledgement()).toBe(false);

    releaseNotify?.();
    await expect(verification).resolves.toEqual(
      expect.objectContaining({
        status: Status.connected,
        worker_status_id: EWorkerStatus.online,
      })
    );
    expect(servicePrivate.connectionEstablished).toBe(true);
    expect(service.hasCentralOnlineAcknowledgement()).toBe(true);
  });

  it('keeps the WhatsApp socket and retries only the Kafka gate after startup failure', async () => {
    const {
      service,
      servicePrivate,
      balanceWorkerStatusGrpcClientService,
      healthCheckService,
    } = makeService();
    const socket = {
      user: { id: '556199999999@s.whatsapp.net' },
    };
    let readyAttempts = 0;
    mockEmitWorkerProviderRuntimeState.mockImplementation(
      async (_provider, ready) => {
        if (ready && ++readyAttempts === 1) {
          throw new Error('kafka_startup_failed');
        }
      }
    );
    servicePrivate.socket = socket;
    servicePrivate.socketId = 4;
    servicePrivate.runtimeGeneration = 9;
    const connectSpy = jest.spyOn(service, 'connect');
    const reconnectSpy = jest.spyOn(service, 'reconnect');

    await expect(
      service.verifyAndPublishConnectionStatus({ runtime_generation: 9 })
    ).resolves.toEqual(
      expect.objectContaining({
        status: Status.connecting,
        worker_status_id: EWorkerStatus.disponible,
        provider_state: 'kafka_consumers_not_ready',
        degraded_reason: 'kafka_startup_failed',
        runtime_generation: 9,
      })
    );

    expect(servicePrivate.socket).toBe(socket);
    expect(servicePrivate.connectionEstablished).toBe(false);
    expect(connectSpy).not.toHaveBeenCalled();
    expect(reconnectSpy).not.toHaveBeenCalled();
    expect(healthCheckService.markStatusPublished).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(5_000);

    expect(servicePrivate.socket).toBe(socket);
    expect(servicePrivate.connectionEstablished).toBe(true);
    expect(connectSpy).not.toHaveBeenCalled();
    expect(reconnectSpy).not.toHaveBeenCalled();
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus.mock.calls.map(
        ([payload]) => payload.worker_status_id
      )
    ).toEqual([EWorkerStatus.disponible, EWorkerStatus.online]);
    expect(healthCheckService.markStatusPublished).toHaveBeenCalledTimes(1);
    expect(
      mockEmitWorkerProviderRuntimeState.mock.calls.filter(([, ready]) => ready)
    ).toHaveLength(2);
  });

  it('does not stop a current provider while a superseded Kafka startup is retried', async () => {
    const { service, servicePrivate } = makeService();
    const socket = {
      user: { id: '556199999999@s.whatsapp.net' },
    };
    let readyAttempts = 0;
    mockEmitWorkerProviderRuntimeState.mockImplementation(
      async (_provider, ready) => {
        if (ready && ++readyAttempts === 1) {
          throw new Error(
            'baileys_provider_became_unavailable_during_consumer_startup'
          );
        }
      }
    );
    servicePrivate.socket = socket;
    servicePrivate.socketId = 14;

    await expect(
      service.verifyAndPublishConnectionStatus({ runtime_generation: 22 })
    ).resolves.toEqual(
      expect.objectContaining({
        status: Status.connecting,
        provider_state: 'kafka_consumers_not_ready',
      })
    );
    expect(
      mockEmitWorkerProviderRuntimeState.mock.calls.map(([, ready]) => ready)
    ).toEqual([true]);

    await jest.advanceTimersByTimeAsync(5_000);

    expect(servicePrivate.socket).toBe(socket);
    expect(servicePrivate.connectionEstablished).toBe(true);
    expect(
      mockEmitWorkerProviderRuntimeState.mock.calls.map(([, ready]) => ready)
    ).toEqual([true, true]);
  });

  it('keeps retrying when session readiness is transiently false during Kafka recovery', async () => {
    const {
      service,
      servicePrivate,
      balanceWorkerStatusGrpcClientService,
      healthCheckService,
    } = makeService();
    const ready = {
      session_ready: true,
      can_send: true,
      can_receive_runtime: true,
      authenticated: true,
      provider_state: 'open',
      last_probe_at: new Date().toISOString(),
      probe_latency_ms: 1,
    };
    const temporarilyUnavailable = {
      ...ready,
      session_ready: false,
      can_send: false,
      provider_state: 'connecting',
      degraded_reason: 'session_temporarily_unavailable',
    };
    healthCheckService.verifyCurrentSession
      .mockResolvedValueOnce(ready)
      .mockResolvedValueOnce(temporarilyUnavailable)
      .mockResolvedValueOnce(ready)
      .mockResolvedValueOnce(ready);
    let kafkaStartAttempts = 0;
    mockEmitWorkerProviderRuntimeState.mockImplementation(
      async (_provider, readyState) => {
        if (readyState && ++kafkaStartAttempts === 1) {
          throw new Error('kafka_startup_failed');
        }
      }
    );
    servicePrivate.socket = {
      user: { id: '556199999999@s.whatsapp.net' },
    };
    servicePrivate.socketId = 11;

    await service.verifyAndPublishConnectionStatus({ runtime_generation: 17 });
    await jest.advanceTimersByTimeAsync(5_000);

    expect(servicePrivate.connectionEstablished).toBe(false);
    expect(service.hasCentralOnlineAcknowledgement()).toBe(false);

    await jest.advanceTimersByTimeAsync(5_000);

    expect(servicePrivate.connectionEstablished).toBe(true);
    expect(service.hasCentralOnlineAcknowledgement()).toBe(true);
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus.mock.calls.map(
        ([payload]) => payload.worker_status_id
      )
    ).toEqual([
      EWorkerStatus.disponible,
      EWorkerStatus.disponible,
      EWorkerStatus.online,
    ]);
  });

  it('keeps online pending and retries publication when NotifyWorkerStatus fails', async () => {
    const {
      service,
      servicePrivate,
      balanceWorkerStatusGrpcClientService,
      healthCheckService,
    } = makeService();
    const socket = {
      user: { id: '556199999999@s.whatsapp.net' },
    };
    servicePrivate.socket = socket;
    servicePrivate.socketId = 3;
    servicePrivate.runtimeGeneration = 5;
    const secret =
      'postgres://worker:password@database:5432/underchat capability-secret qr-secret session-secret';
    balanceWorkerStatusGrpcClientService.notifyWorkerStatus.mockRejectedValueOnce(
      Object.assign(new Error(secret), { code: 'ECONNRESET' })
    );

    const pendingState = await service.verifyAndPublishConnectionStatus({
      runtime_generation: 6,
    });
    expect(pendingState).toEqual(
      expect.objectContaining({
        status: Status.connecting,
        worker_status_id: EWorkerStatus.disponible,
        provider_state: 'worker_status_not_published',
        degraded_reason: 'worker_status_notification_failed:econnreset',
        runtime_generation: 6,
      })
    );
    expect(JSON.stringify(pendingState)).not.toContain(secret);

    expect(servicePrivate.connectionEstablished).toBe(false);
    expect(service.hasCentralOnlineAcknowledgement()).toBe(false);
    expect(servicePrivate.runtimeGeneration).toBe(6);
    expect(healthCheckService.markStatusPublished).not.toHaveBeenCalled();
    expect(healthCheckService.start).not.toHaveBeenCalled();
    expect(
      mockEmitWorkerProviderRuntimeState.mock.calls.map(([, ready]) => ready)
    ).toEqual([true]);

    await jest.advanceTimersByTimeAsync(5_000);

    expect(servicePrivate.connectionEstablished).toBe(true);
    expect(service.hasCentralOnlineAcknowledgement()).toBe(true);
    expect(healthCheckService.markStatusPublished).toHaveBeenCalledTimes(1);
    expect(healthCheckService.start).toHaveBeenCalledTimes(1);
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus.mock.calls.map(
        ([payload]) => payload.worker_status_id
      )
    ).toEqual([EWorkerStatus.online, EWorkerStatus.online]);
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus.mock.calls.every(
        ([payload]) => payload.runtime_generation === 6
      )
    ).toBe(true);
    expect(
      mockEmitWorkerProviderRuntimeState.mock.calls.every(
        ([, ready]) => ready === true
      )
    ).toBe(true);
  });

  it('revokes the runtime and does not retry a terminal online status rejection', async () => {
    const {
      service,
      servicePrivate,
      balanceWorkerStatusGrpcClientService,
      incomingMessageService,
      healthCheckService,
    } = makeService();
    const socket = {
      user: { id: '556199999999@s.whatsapp.net' },
    };
    const scheduleKafkaReadinessRetry = jest.spyOn(
      servicePrivate,
      'scheduleKafkaReadinessRetry'
    );
    servicePrivate.socket = socket;
    servicePrivate.socketId = 19;
    balanceWorkerStatusGrpcClientService.notifyWorkerStatus.mockRejectedValueOnce(
      Object.assign(
        new Error(
          '9 FAILED_PRECONDITION: worker_online_readiness_rejected:runtime_generation_stale'
        ),
        {
          code: 9,
          details: 'worker_online_readiness_rejected:runtime_generation_stale',
        }
      )
    );

    await expect(
      service.verifyAndPublishConnectionStatus({ runtime_generation: 17 })
    ).resolves.toEqual(
      expect.objectContaining({
        status: Status.connecting,
        worker_status_id: EWorkerStatus.disponible,
        provider_state: 'worker_status_rejected',
        degraded_reason: expect.stringContaining('runtime_generation_stale'),
      })
    );

    expect(
      incomingMessageService.markConnectionUnavailable
    ).toHaveBeenCalledWith(socket);
    expect(healthCheckService.stop).toHaveBeenCalledTimes(1);
    expect(scheduleKafkaReadinessRetry).not.toHaveBeenCalled();
    expect(
      mockEmitWorkerProviderRuntimeState.mock.calls.map(([, ready]) => ready)
    ).toEqual([true, false]);

    await jest.advanceTimersByTimeAsync(10_000);
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending Kafka readiness retry when the worker shuts down', async () => {
    const { service, servicePrivate } = makeService();
    const socket = {
      ev: { removeAllListeners: jest.fn() },
      user: { id: '556199999999@s.whatsapp.net' },
    };
    mockEmitWorkerProviderRuntimeState.mockImplementation(
      async (_provider, ready) => {
        if (ready) {
          throw new Error('kafka_still_unavailable');
        }
      }
    );
    servicePrivate.socket = socket;
    servicePrivate.socketId = 5;
    const closePostgresStore = jest.fn(async () => undefined);
    servicePrivate.postgresAuthStore = { close: closePostgresStore };

    await service.verifyAndPublishConnectionStatus();
    await service.shutdown();
    await jest.advanceTimersByTimeAsync(10_000);

    expect(
      mockEmitWorkerProviderRuntimeState.mock.calls.filter(([, ready]) => ready)
    ).toHaveLength(1);
    expect(servicePrivate.socket).toBeUndefined();
    expect(closePostgresStore).toHaveBeenCalledTimes(1);
    expect(servicePrivate.postgresAuthStore).toBeUndefined();
  });
});
