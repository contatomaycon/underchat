import 'reflect-metadata';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';

const mockImportWhatsAppWebSessionToLocalAuth = jest.fn();
const mockBrowserProjectionFromWhatsAppWebProfile = jest.fn();
const mockEmitWorkerProviderRuntimeState = jest.fn<
  Promise<void>,
  [provider: string, ready: boolean]
>(async () => undefined);
const mockWwebjsInitialize = jest.fn<Promise<void>, []>(async () => undefined);
const mockWwebjsRefreshQr = jest.fn<Promise<boolean>, []>(async () => true);
let mockLastWwebjsClient:
  | {
      emit(event: string, ...args: unknown[]): Promise<void>;
      pupPage: { evaluate: jest.Mock<Promise<boolean>, []> };
    }
  | undefined;
let mockLastWwebjsClientOptions: Record<string, unknown> | undefined;

jest.mock('@wwebjs/whatsapp-web.js', () => {
  const actualWhatsappWeb = jest.requireActual(
    '@wwebjs/whatsapp-web.js'
  ) as Record<string, unknown>;
  return {
    __esModule: true,
    default: {
      ...actualWhatsappWeb,
      Client: class {
        readonly pupPage = {
          evaluate: jest.fn<Promise<boolean>, []>(() => mockWwebjsRefreshQr()),
        };

        private readonly handlers = new Map<
          string,
          Array<(...args: unknown[]) => unknown>
        >();

        constructor(options: Record<string, unknown>) {
          mockLastWwebjsClient = this;
          mockLastWwebjsClientOptions = options;
        }

        initialize(): Promise<void> {
          return mockWwebjsInitialize();
        }

        on(event: string, handler: (...args: unknown[]) => unknown): this {
          const handlers = this.handlers.get(event) ?? [];
          handlers.push(handler);
          this.handlers.set(event, handlers);
          return this;
        }

        async emit(event: string, ...args: unknown[]): Promise<void> {
          for (const handler of this.handlers.get(event) ?? []) {
            await handler(...args);
          }
        }
      },
      LocalAuth: class {},
      RemoteAuth: class {
        constructor(readonly options: Record<string, unknown>) {}
      },
      SecureSessionImport: {
        browserProjectionFromWhatsAppWebProfile:
          mockBrowserProjectionFromWhatsAppWebProfile,
        importWhatsAppWebSessionToLocalAuth:
          mockImportWhatsAppWebSessionToLocalAuth,
      },
    },
  };
});

jest.mock('@core/config/environments', () => ({
  wwebjsEnvironment: {
    wwebjsAccountId: 'account-w',
    wwebjsWorkerId: 'worker-w',
    runtimeGeneration: 1,
  },
}));

jest.mock('@core/common/functions/centrifugoQueue', () => ({
  workerCentrifugoQueue: (accountId: string) => `worker-${accountId}`,
  chatAccountCentrifugo: (accountId: string) => `chat-${accountId}`,
}));

jest.mock('@core/common/functions/normalizeJid', () => ({
  normalizeJid: (jid?: string | null) => jid ?? undefined,
}));

jest.mock('@core/common/functions/workerProviderRuntimeState', () => ({
  emitWorkerProviderRuntimeState: (provider: string, ready: boolean) =>
    mockEmitWorkerProviderRuntimeState(provider, ready),
}));

jest.mock('@core/services/centrifugo.service', () => ({
  CentrifugoService: class {},
}));

jest.mock('@core/services/elasticDatabase.service', () => ({
  ElasticDatabaseService: class {},
}));

jest.mock('@core/services/balanceWorkerStatusGrpcClient.service', () => ({
  BalanceWorkerStatusGrpcClientService: class {},
}));

jest.mock('@core/services/wwebjs/methods/incoming.service', () => ({
  WwebjsIncomingMessageService: class {},
}));

jest.mock('@core/services/wwebjs/methods/healthCheck.service', () => ({
  WwebjsHealthCheckService: class {},
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
import { hasWwebjsProviderProcessReplacementRequirement } from '@core/common/functions/wwebjsProcessReplacement';
import type { IBaileysConnection } from '@core/common/interfaces/IBaileysConnection';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import type { IWhatsappRuntimeFenceConnectionAuthorization } from '@core/common/interfaces/IWhatsappRuntimeFenceConnectionAuthorization';
import {
  resolveWwebjsCanonicalCompanionIdentity,
  type PostgresWwebjsSessionStore,
} from '@core/services/wwebjs/methods/postgresSessionStore';
import {
  resolveWwebjsClientInitializeWatchdogTimeoutMs,
  resolveWwebjsProviderHandoffCheckpointProof,
  resolveWwebjsProtocolTimeoutMs,
  resolveWwebjsRemoteAuthInitialCheckpointDelayMs,
  WwebjsConnectionService,
} from '@core/services/wwebjs/methods/connection.service';
import {
  captureWwebjsOwnedBrowserProcess,
  isWwebjsOwnedBrowserProcessTerminated,
  type WwebjsOwnedBrowserProcess,
} from '@core/services/wwebjs/methods/browserProcessOwnership';
import type {
  WwebjsSessionGuardContext,
  WwebjsSessionInspection,
} from '@core/services/wwebjs/methods/sessionGuard';
import { ProviderInvocationSingleFlight } from '@core/common/functions/providerInvocationSingleFlight';

function createWwebjsCanonicalBrowserProjection(
  webVersion = '2.3000.1027934701'
) {
  const encoded = (size: number, fill: number) =>
    Buffer.alloc(size, fill).toString('base64');

  return {
    kind: 'wwebjs-canonical-session-v1' as const,
    codec_version: 1,
    module_abi: 'wwebjs-private-modules-v1',
    web_version: webVersion,
    fingerprint_version: 'underchat-whatsapp-device-fingerprint-v2',
    complete: true,
    blockers: [],
    capabilities: {
      lid_migrated: false,
      pq_migrated: false,
      pq_upload_enabled: false,
      pq_messaging_enabled: false,
      pq_storage_mode: 'rollout_without_tables',
      pq_pre_key_count: 0,
      pq_last_resort_key_count: 0,
    },
    device: {
      jid: '5511999999999@c.us',
      lid: null,
      facebook_uuid: null,
      registration_id: 1,
      noise_key: encoded(32, 1),
      identity_key: encoded(32, 2),
      signed_pre_key: encoded(32, 3),
      signed_pre_key_id: 1,
      signed_pre_key_sig: encoded(64, 4),
      adv_secret_available: false,
      adv_key: null,
      adv_details: encoded(1, 5),
      adv_account_sig: encoded(64, 6),
      adv_account_sig_key: encoded(32, 7),
      adv_device_sig: encoded(64, 8),
      platform: 'web',
      business_name: '',
      push_name: '',
      lid_migration_ts: 0,
      next_pre_key_id: 2,
      device_fingerprint: '01'.repeat(32),
    },
    provider_state: null,
    transport_state: null,
    tables: {
      identity_keys: [],
      pre_keys: [],
      pq_pre_keys: [],
      pq_pre_key_state: [],
      signal_sessions: [],
      sender_keys: [],
      app_state_sync_keys: [],
      app_state_versions: [],
      app_state_mutation_macs: [],
    },
    record_count: 0,
    size_bytes: 321,
  };
}

type WorkerStatusNotificationResult =
  | { outcome: 'accepted' }
  | { outcome: 'deferred'; reason: 'command_ingress_positioning' }
  | {
      outcome: 'failed';
      classification: 'recoverable' | 'terminal';
      reason: string;
      grpcCode?: number;
    };

type WwebjsConnectionServicePrivate = {
  client: unknown;
  status: Status;
  initialConnection: boolean;
  connecting: boolean;
  secureImportConnectionAttemptActive: boolean;
  qrReadSessionActive: boolean;
  qrReadSessionLocked: boolean;
  qrGenerationCount: number;
  qrRefreshGeneration: number;
  qrRefreshTimer?: ReturnType<typeof setTimeout>;
  qrRefreshEventTimer?: ReturnType<typeof setTimeout>;
  typeConnection: EBaileysConnectionType;
  sessionRestoreBlocked: boolean;
  sessionLifecycleTerminationUnconfirmed: boolean;
  sessionLifecycleLeaseGeneration: number;
  connectionInvocationGeneration: number;
  sessionLockRetryCount: number;
  retryCount: number;
  sessionLifecycleLease?: {
    ownerToken: string;
    released: boolean;
    release: () => void;
  };
  browserRuntimeClients: Set<object>;
  clientInitializationLifecycles: WeakMap<
    object,
    {
      attemptId: number;
      connectionInvocationGeneration: number;
      runtimeGeneration?: number;
      lifecycleOwnerToken?: string;
      lifecycleLeaseGeneration: number;
      initializePromise: Promise<void>;
      initializeState: 'pending' | 'completed' | 'failed' | 'timed_out';
      initializeWatchdogTimeoutMs: number;
      initializeWatchdogTimer?: ReturnType<typeof setTimeout>;
      deferredConnectionStateProbe?: {
        proxy: unknown;
        secureImportRestore: boolean;
        readyObserved: boolean;
      };
      cancellationRequested: boolean;
      lateCleanupScheduled: boolean;
      ownedBrowserProcesses: Set<WwebjsOwnedBrowserProcess>;
      initializeErrorToken?: string;
    }
  >;
  teardownPromise: Promise<void>;
  activeConnectionAttemptId?: number;
  disconnectRetryTimer?: unknown;
  clientConnectionAttemptIds: WeakMap<object, number>;
  canonicalCheckpointDeferredProviderCalls: WeakMap<
    object,
    {
      token: symbol;
      checkpointGeneration?: number;
      deferredAtMs: number;
      providerCall: Promise<unknown>;
      postCheckpointDeadlineMs?: number;
    }
  >;
  clientsWithDurableRemoteCheckpoint: WeakSet<object>;
  clientsWithRejectedRestorePairing: WeakSet<object>;
  postgresSessionKnown: boolean;
  postgresLeaseRecoveryRequired: boolean;
  postgresLeaseRecoveryGeneration: number;
  postgresLeaseRecoveryResumeGeneration?: number;
  postgresSessionStore?: PostgresWwebjsSessionStore;
  postgresSessionRefreshPromise?: Promise<void>;
  refreshPostgresSessionState: () => Promise<void>;
  getPostgresSessionStore: () => PostgresWwebjsSessionStore;
  purgePostgresSession: () => Promise<void>;
  handlePostgresSessionLeaseLost: (error: Error) => void;
  connectionAttemptStartedAtMs: number;
  connectionAttemptId?: string;
  runtimeGeneration?: number;
  runtimeFenceConnectionAuthorization?: IWhatsappRuntimeFenceConnectionAuthorization;
  resolveRuntimeFenceConnectionAuthorization: (
    input: IBaileysConnection
  ) => Promise<IWhatsappRuntimeFenceConnectionAuthorization | undefined>;
  resolveConnectionRuntimeFenceAuthorization: (
    input: IBaileysConnection
  ) => Promise<IWhatsappRuntimeFenceConnectionAuthorization | undefined>;
  currentPromise?: Promise<IBaileysConnectionState>;
  connectionEstablished: boolean;
  centralOnlineAcknowledged: boolean;
  nativeConnectionStatus?: IBaileysConnectionState['connection_status'];
  nativeConnectionStatusSource?: object;
  nativeConnectionStatusSourceId?: string;
  acceptNativeConnectionStatus: (
    source: unknown,
    value: unknown,
    publish: boolean
  ) => void;
  outboundSendRecoveryFlight?: Promise<void>;
  outboundSendRecoveryAttempts: number;
  outboundSendRecoveryExhaustedScope?: unknown;
  recoverFromOutboundSendFailure: (client?: unknown) => Promise<void>;
  notifyWorkerStatusSafely: (
    payload: IBaileysConnectionState,
    context: string
  ) => Promise<WorkerStatusNotificationResult>;
  scheduleTransientDisconnectStatus: (
    payload: IBaileysConnectionState,
    context: string
  ) => void;
  cancelTransientDisconnectStatus: () => void;
  startConnectionStateProbe: (...args: unknown[]) => void;
  scheduleKafkaReadinessRetry: (...args: unknown[]) => void;
  cancelKafkaReadinessRetry: () => void;
  confirmReadyAndMarkConnected: (...args: unknown[]) => Promise<boolean>;
  shouldResolveQrAttemptTimeoutAsFailure: () => boolean;
  resolveQrAttemptTimeout: (...args: unknown[]) => IBaileysConnectionState;
  withConnectionAttemptGuardTimeout: (
    promise: Promise<IBaileysConnectionState>,
    attemptId: number,
    secureImportRestore?: boolean
  ) => Promise<IBaileysConnectionState>;
  handleHealthCheckMismatch: (detectedStatus: Status) => void;
  cancelAttempt: (skipDestroy?: boolean) => void;
  stopProviderRuntime: (context: string) => void;
  waitForPendingTeardown: () => Promise<void>;
  waitForSessionProfileTransition: () => Promise<void>;
  prepareFolder: () => void;
  clearFolder: (strict?: boolean) => void;
  purgeCurrentSessionQuarantine: (strict?: boolean) => void;
  clearChromiumProfileLock: () => void;
  recoverChromiumProfileBeforeLaunch: () => Promise<void>;
  beginRuntimeSessionActivation: () => string | undefined;
  acquireSessionLifecycleLease: () => string | undefined;
  releaseSessionLifecycleLease: () => void;
  withSessionLifecycleLease: <T>(operation: () => T) => T;
  queueTeardown: (
    operation: string,
    teardown: () => Promise<boolean>,
    options?: { lifecycleOwnerToken?: string }
  ) => void;
  trackClientInitialization: (
    client: object,
    attemptId: number,
    initializePromise: Promise<void>,
    watchdogTimeoutMs?: number
  ) => {
    attemptId: number;
    connectionInvocationGeneration: number;
    runtimeGeneration?: number;
    lifecycleOwnerToken?: string;
    lifecycleLeaseGeneration: number;
    initializePromise: Promise<void>;
    initializeState: 'pending' | 'completed' | 'failed' | 'timed_out';
    initializeWatchdogTimeoutMs: number;
    initializeWatchdogTimer?: ReturnType<typeof setTimeout>;
    deferredConnectionStateProbe?: {
      proxy: unknown;
      secureImportRestore: boolean;
      readyObserved: boolean;
    };
    cancellationRequested: boolean;
    lateCleanupScheduled: boolean;
    ownedBrowserProcesses: Set<WwebjsOwnedBrowserProcess>;
    initializeErrorToken?: string;
  };
  registerOwnedBrowserProcess: (
    client: object,
    attemptId: number,
    ownedBrowserProcess: WwebjsOwnedBrowserProcess
  ) => void;
  handleInitializeError: (
    message: string,
    client: object,
    attemptId: number
  ) => Promise<void>;
  destroyClientWithTimeout: (
    client: object,
    operation: string
  ) => Promise<boolean>;
  requestOwnedBrowserProcessTermination: (
    lifecycle: unknown,
    operation: string
  ) => boolean;
  forceTerminateClientRuntimeWithoutSdkOverlap: (
    client: object,
    operation: string
  ) => Promise<boolean>;
  safeDestroy: (
    forceLogout?: boolean,
    clientToDestroy?: object,
    providerRuntimeAlreadyStopped?: boolean,
    clearProfileLockAfterTermination?: boolean
  ) => Promise<boolean>;
  markSessionLifecycleTerminationUnconfirmed: (operation: string) => void;
  markProviderSessionValidated: () => boolean;
  getSessionGuardContext: () => WwebjsSessionGuardContext;
  inspectCurrentLocalSession: () => WwebjsSessionInspection;
  handleNonTransientInitializeError: (message: string) => void;
  recordSessionRestoreFailure: (
    providerState: string,
    reason: string
  ) => {
    failures: number;
    maxAttempts: number;
    marker?: {
      incomplete_activation_detected?: boolean;
    };
  };
  quarantineCurrentSession: (reason: string) => {
    blocked: boolean;
    moved: boolean;
    quarantinePath?: string;
    error?: string;
  };
  publishQrRequiredState: (
    reason: string,
    error?: string,
    failures?: number,
    maxAttempts?: number
  ) => void;
  handlePersistentUnpaired: (
    client: object,
    attemptId: number,
    providerState: 'UNPAIRED' | 'UNPAIRED_IDLE'
  ) => Promise<void>;
  canContinueQrReadSession: () => boolean;
  scheduleQrRefresh: (
    client: object,
    attemptId: number,
    delayMs?: number
  ) => void;
  clearQrRefreshTimers: () => void;
  recoverQrReadSessionAfterAuthFailure: (
    client: object,
    reason: string
  ) => Promise<void>;
  handleQrGenerationLimitReached: () => void;
  shouldScheduleRetryAfterDisconnect: (
    allowActiveQrLifecycle?: boolean
  ) => boolean;
  setStatus: (status: Status, code?: ECodeMessage) => void;
  scheduleNextReconnectAttempt: (
    forceNew?: boolean,
    allowActiveQrLifecycle?: boolean
  ) => void;
  createAndWaitClient: (
    attemptId: number,
    secureImportRestore?: boolean
  ) => Promise<IBaileysConnectionState>;
  startConnection: (
    fromDisconnectRestart?: boolean
  ) => Promise<IBaileysConnectionState>;
  startSecureImportRestore: (input: {
    connection_attempt_id?: string;
    runtime_generation?: number;
    debug_trace_id?: string;
  }) => IBaileysConnectionState;
  isPostgresRestorePairingForbidden: (secureImportRestore: boolean) => boolean;
  rejectUnexpectedPostgresRestorePairing: (
    client: object,
    attemptId: number,
    event: 'code' | 'qr'
  ) => Promise<void>;
};

function spawnOwnedBrowserTestProcess(): {
  childProcess: ChildProcess;
  ownedBrowserProcess: WwebjsOwnedBrowserProcess;
} {
  const ownershipMarker = `--user-data-dir=/tmp/underchat-wwebjs-test-${randomUUID()}`;
  const launchArgs = [
    '-e',
    'setInterval(() => undefined, 1000)',
    '--',
    ownershipMarker,
  ];
  const childProcess = spawn(process.execPath, launchArgs, {
    detached: true,
    stdio: 'ignore',
  });
  const ownedBrowserProcess = captureWwebjsOwnedBrowserProcess(childProcess, {
    executablePath: process.execPath,
    args: launchArgs,
  });
  return { childProcess, ownedBrowserProcess };
}

async function waitForChildExit(childProcess: ChildProcess): Promise<void> {
  if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
    return;
  }
  await new Promise<void>((resolve) => {
    childProcess.once('exit', () => resolve());
  });
}

async function waitForOwnedBrowserProcessTermination(
  ownedBrowserProcess: WwebjsOwnedBrowserProcess,
  timeoutMs = 2_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!isWwebjsOwnedBrowserProcessTerminated(ownedBrowserProcess)) {
    if (Date.now() >= deadline) {
      throw new Error(
        'Timed out waiting for owned browser process termination'
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function forceTerminateOwnedTestProcess(childProcess: ChildProcess): void {
  if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
    return;
  }
  try {
    childProcess.kill('SIGKILL');
  } catch {}
}

function configureServicePrivateTestDefaults(
  servicePrivate: WwebjsConnectionServicePrivate
): void {
  servicePrivate.nativeConnectionStatus = {
    provider: 'wwebjs',
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
    '01900000-0000-7000-8000-000000000083';
  jest
    .spyOn(servicePrivate, 'beginRuntimeSessionActivation')
    .mockReturnValue(undefined);
  jest
    .spyOn(servicePrivate, 'markProviderSessionValidated')
    .mockReturnValue(true);
  jest
    .spyOn(servicePrivate, 'acquireSessionLifecycleLease')
    .mockReturnValue(undefined);
  jest
    .spyOn(servicePrivate, 'releaseSessionLifecycleLease')
    .mockImplementation(() => undefined);
  jest
    .spyOn(servicePrivate, 'withSessionLifecycleLease')
    .mockImplementation((operation) => operation());
}

describe('resolveWwebjsProviderHandoffCheckpointProof', () => {
  const checksum = 'a'.repeat(64);

  it('accepts an active canonical checkpoint without a legacy browser projection', () => {
    expect(
      resolveWwebjsProviderHandoffCheckpointProof({
        checkpointRecordCount: 2_195,
        projection: {
          artifact: {
            checksum_sha256: checksum.toUpperCase(),
            size_bytes: 170_908_096,
          },
          canonicalProjection: {
            device: { jid: 'canonical-device' },
            record_count: 2_194,
          },
        },
      })
    ).toEqual({
      checksum,
      sizeBytes: 170_908_096,
      recordCount: 2_195,
    });
  });

  it('accepts the exact empty preparing-revision proof', () => {
    expect(
      resolveWwebjsProviderHandoffCheckpointProof({
        checkpointRecordCount: 0,
        projection: {
          artifact: {
            checksum_sha256: checksum,
            size_bytes: 0,
          },
          provider_projection: { records: [] },
        },
      })
    ).toEqual({ checksum, sizeBytes: 0, recordCount: 0 });
  });

  it('rejects a malformed legacy projection even when canonical data exists', () => {
    expect(() =>
      resolveWwebjsProviderHandoffCheckpointProof({
        checkpointRecordCount: 2,
        projection: {
          artifact: {
            checksum_sha256: checksum,
            size_bytes: 1,
          },
          provider_projection: {},
          canonicalProjection: {
            device: { jid: 'canonical-device' },
            record_count: 1,
          },
        },
      })
    ).toThrow('wwebjs_provider_handoff_checkpoint_proof_invalid');
  });

  it('rejects a canonical checkpoint whose declared record count diverges', () => {
    expect(() =>
      resolveWwebjsProviderHandoffCheckpointProof({
        checkpointRecordCount: 2_194,
        projection: {
          artifact: {
            checksum_sha256: checksum,
            size_bytes: 1,
          },
          canonicalProjection: {
            device: { jid: 'canonical-device' },
            record_count: 2_194,
          },
        },
      })
    ).toThrow('wwebjs_provider_handoff_checkpoint_proof_invalid');
  });

  it('does not coerce null proof counters into zero', () => {
    expect(() =>
      resolveWwebjsProviderHandoffCheckpointProof({
        checkpointRecordCount: null,
        projection: {
          artifact: {
            checksum_sha256: checksum,
            size_bytes: null,
          },
          provider_projection: { records: [] },
        },
      })
    ).toThrow('wwebjs_provider_handoff_checkpoint_proof_invalid');
  });
});

// The provider contract intentionally keeps its shared lifecycle harness in a
// single describe so every race uses the same deterministic mocks.
// eslint-disable-next-line max-statements
describe('WwebjsConnectionService', () => {
  const makeService = () => {
    const centrifugo = {
      publishSub: jest.fn(async () => undefined),
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
      resolveWhatsappRuntimeOwnedConnectionFence: jest.fn<
        Promise<{
          connection_epoch: string;
          connection_attempt_id?: string;
          connection_sequence: number;
          authorization_state: 'pending' | 'owned';
        } | null>,
        [payload: { runtime_generation?: number }]
      >(async () => null),
      activateWhatsappRuntimeFence: jest.fn<
        Promise<{ connection_sequence: number; already_active: boolean }>,
        [payload: { connection_epoch?: string }]
      >(async () => ({
        connection_sequence: 1,
        already_active: true,
      })),
    };
    const incomingMessageService = {
      bindTo: jest.fn(),
      prepareConnectionFence: jest.fn(async () => true),
      markConnectionReady: jest.fn(async () => true),
      markConnectionUnavailable: jest.fn(),
      unbind: jest.fn(),
      getActiveRuntimeFenceIdentity: jest.fn(() => ({
        connection_epoch: '00000000-0000-4000-8000-000000000072',
        connection_sequence: 8,
      })),
    };
    const healthCheckService = {
      configure: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
      notifyDisconnected: jest.fn<Promise<void>, []>(async () => undefined),
      verifyCurrentSession: jest.fn(async () => ({
        session_ready: true,
        can_send: true,
        can_receive_runtime: true,
        authenticated: true,
        provider_state: 'CONNECTED',
        last_probe_at: new Date().toISOString(),
        probe_latency_ms: 1,
      })),
      markStatusPublished: jest.fn(),
    };
    const redis = {
      get: jest.fn(async () => null),
      set: jest.fn(async () => 'OK'),
    };

    const service = new WwebjsConnectionService(
      centrifugo as never,
      elasticDatabaseService as never,
      balanceWorkerStatusGrpcClientService as never,
      incomingMessageService as never,
      healthCheckService as never,
      redis as never
    );

    const servicePrivate = service as unknown as WwebjsConnectionServicePrivate;
    configureServicePrivateTestDefaults(servicePrivate);

    return {
      service,
      servicePrivate,
      centrifugo,
      balanceWorkerStatusGrpcClientService,
      incomingMessageService,
      healthCheckService,
    };
  };

  it('reacquires and releases the exact provider lease when purging a stranded PostgreSQL session', async () => {
    const previousStorage = process.env.WORKER_SESSION_STORAGE;
    process.env.WORKER_SESSION_STORAGE = 'postgres';
    try {
      const { servicePrivate } = makeService();
      const calls: string[] = [];
      servicePrivate.postgresSessionKnown = true;
      servicePrivate.sessionRestoreBlocked = true;
      servicePrivate.postgresSessionStore = {
        getConnectionStatusLeaseProof: jest.fn(() => undefined),
        open: jest.fn(async () => {
          calls.push('open');
          return {};
        }),
        delete: jest.fn(async () => {
          calls.push('delete');
        }),
        close: jest.fn(async (options) => {
          calls.push(`close:${options?.requireLeaseRelease === true}`);
          return true;
        }),
      } as unknown as PostgresWwebjsSessionStore;

      await expect(servicePrivate.purgePostgresSession()).resolves.toBe(
        undefined
      );

      expect(calls).toEqual(['open', 'delete', 'close:true']);
      expect(servicePrivate.postgresSessionKnown).toBe(false);
      expect(servicePrivate.sessionRestoreBlocked).toBe(false);
    } finally {
      if (previousStorage === undefined) {
        delete process.env.WORKER_SESSION_STORAGE;
      } else {
        process.env.WORKER_SESSION_STORAGE = previousStorage;
      }
    }
  });

  it('releases a recovered provider lease and preserves both purge failures', async () => {
    const previousStorage = process.env.WORKER_SESSION_STORAGE;
    process.env.WORKER_SESSION_STORAGE = 'postgres';
    try {
      const { servicePrivate } = makeService();
      const deleteError = new Error('session-delete-failed');
      const closeError = new Error('lease-release-failed');
      servicePrivate.postgresSessionKnown = true;
      servicePrivate.postgresSessionStore = {
        getConnectionStatusLeaseProof: jest.fn(() => ({
          ownerId: '01900000-0000-7000-8000-000000000084',
          fencingToken: '31',
        })),
        open: jest.fn(async () => ({})),
        delete: jest.fn(async () => {
          throw deleteError;
        }),
        close: jest.fn(async () => {
          throw closeError;
        }),
      } as unknown as PostgresWwebjsSessionStore;

      let failure: unknown;
      try {
        await servicePrivate.purgePostgresSession();
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(AggregateError);
      expect((failure as AggregateError).cause).toBe(deleteError);
      expect((failure as AggregateError).errors).toEqual([
        deleteError,
        closeError,
      ]);
      expect(servicePrivate.postgresSessionStore.open).not.toHaveBeenCalled();
      expect(servicePrivate.postgresSessionStore.close).toHaveBeenCalledWith({
        requireLeaseRelease: true,
      });
      expect(servicePrivate.postgresSessionKnown).toBe(true);
    } finally {
      if (previousStorage === undefined) {
        delete process.env.WORKER_SESSION_STORAGE;
      } else {
        process.env.WORKER_SESSION_STORAGE = previousStorage;
      }
    }
  });

  it('revokes ACK and dispatch synchronously before persisting a non-ONLINE native snapshot', () => {
    const { servicePrivate } = makeService();
    const source = {
      getConnectionStatus: jest.fn(),
      on: jest.fn(),
    };
    servicePrivate.nativeConnectionStatusSource = source;
    servicePrivate.centralOnlineAcknowledged = true;
    setWorkerKafkaDispatchAuthorized(true);

    servicePrivate.acceptNativeConnectionStatus(
      source,
      {
        provider: 'wwebjs',
        status: EWhatsappConnectionStatus.offline,
        connected: false,
        authenticated: true,
        sessionValid: true,
        recoverable: true,
        qrAvailable: false,
        sequence: 2,
        changedAt: new Date().toISOString(),
        reason: 'socket_closed',
      },
      true
    );

    expect(servicePrivate.centralOnlineAcknowledged).toBe(false);
    expect(isWorkerKafkaDispatchAuthorized()).toBe(false);
  });

  it('preactivates a pending bootstrap grant before inspecting the session profile', async () => {
    const { service, servicePrivate, balanceWorkerStatusGrpcClientService } =
      makeService();
    const order: string[] = [];
    balanceWorkerStatusGrpcClientService.resolveWhatsappRuntimeOwnedConnectionFence.mockImplementation(
      async () => ({
        connection_epoch: '33333333-3333-4333-8333-333333333333',
        connection_attempt_id: '44444444-4444-4444-8444-444444444444',
        connection_sequence: 0,
        authorization_state: 'pending' as const,
      })
    );
    balanceWorkerStatusGrpcClientService.activateWhatsappRuntimeFence.mockImplementation(
      async (payload: { connection_epoch?: string }) => {
        order.push(`activation:${payload.connection_epoch}`);
        return { connection_sequence: 1, already_active: false };
      }
    );
    jest
      .spyOn(servicePrivate, 'waitForSessionProfileTransition')
      .mockImplementation(async () => {
        order.push('session-profile');
      });
    servicePrivate.connectionEstablished = true;
    servicePrivate.status = Status.connected;

    await service.connect({ initial_connection: true, runtime_generation: 1 });

    expect(order.slice(0, 2)).toEqual([
      'activation:33333333-3333-4333-8333-333333333333',
      'session-profile',
    ]);
    expect(servicePrivate.connectionAttemptId).toBe(
      '44444444-4444-4444-8444-444444444444'
    );
  });

  it('reconfirms the same client generation when native transport returns ONLINE after ACK revocation', async () => {
    const { servicePrivate, balanceWorkerStatusGrpcClientService } =
      makeService();
    const client = {
      getConnectionStatus: jest.fn(),
      on: jest.fn(),
    };
    servicePrivate.client = client;
    servicePrivate.clientConnectionAttemptIds.set(client, 7);
    servicePrivate.nativeConnectionStatusSource = client;
    servicePrivate.nativeConnectionStatus = {
      provider: 'wwebjs',
      status: EWhatsappConnectionStatus.reconnecting,
      connected: false,
      authenticated: true,
      sessionValid: true,
      recoverable: true,
      qrAvailable: false,
      sequence: 8,
      changedAt: new Date().toISOString(),
      reason: 'socket_reconnecting',
    };
    servicePrivate.status = Status.connected;
    servicePrivate.connectionEstablished = true;
    servicePrivate.centralOnlineAcknowledged = false;
    setWorkerKafkaDispatchAuthorized(false);

    let resolveConfirmationCall: ((args: unknown[]) => void) | undefined;
    const confirmationCalled = new Promise<unknown[]>((resolve) => {
      resolveConfirmationCall = resolve;
    });
    const confirmReady = jest
      .spyOn(servicePrivate, 'confirmReadyAndMarkConnected')
      .mockImplementation(async (...args: unknown[]) => {
        resolveConfirmationCall?.(args);
        return true;
      });

    servicePrivate.acceptNativeConnectionStatus(
      client,
      {
        provider: 'wwebjs',
        status: EWhatsappConnectionStatus.online,
        connected: true,
        authenticated: true,
        sessionValid: true,
        recoverable: false,
        qrAvailable: false,
        sequence: 9,
        changedAt: new Date().toISOString(),
        reason: 'socket_reconnected',
      },
      true
    );

    await expect(confirmationCalled).resolves.toEqual([
      client,
      7,
      null,
      'native_reconnect',
    ]);
    expect(confirmReady).toHaveBeenCalledTimes(1);
    expect(
      balanceWorkerStatusGrpcClientService.publishWorkerRuntimeEvent.mock
        .invocationCallOrder[0]
    ).toBeLessThan(confirmReady.mock.invocationCallOrder[0]);

    const acceptedOnline = servicePrivate.nativeConnectionStatus;
    if (!acceptedOnline) {
      throw new Error('accepted native ONLINE snapshot was not retained');
    }
    servicePrivate.acceptNativeConnectionStatus(client, acceptedOnline, true);
    servicePrivate.acceptNativeConnectionStatus(
      client,
      {
        ...acceptedOnline,
        sequence: 8,
      },
      true
    );
    await Promise.resolve();
    expect(confirmReady).toHaveBeenCalledTimes(1);
  });

  it('fences native ONLINE ACK recovery when the client generation changes while persistence drains', async () => {
    const { servicePrivate, balanceWorkerStatusGrpcClientService } =
      makeService();
    const client = {
      getConnectionStatus: jest.fn(),
      on: jest.fn(),
    };
    const replacementClient = {};
    servicePrivate.client = client;
    servicePrivate.clientConnectionAttemptIds.set(client, 3);
    servicePrivate.nativeConnectionStatusSource = client;
    servicePrivate.nativeConnectionStatus = {
      provider: 'wwebjs',
      status: EWhatsappConnectionStatus.reconnecting,
      connected: false,
      authenticated: true,
      sessionValid: true,
      recoverable: true,
      qrAvailable: false,
      sequence: 4,
      changedAt: new Date().toISOString(),
    };
    servicePrivate.status = Status.connected;
    servicePrivate.connectionEstablished = true;
    servicePrivate.centralOnlineAcknowledged = false;

    let releasePersistence: (() => void) | undefined;
    balanceWorkerStatusGrpcClientService.publishWorkerRuntimeEvent.mockReturnValueOnce(
      new Promise<undefined>((resolve) => {
        releasePersistence = () => resolve(undefined);
      })
    );
    const confirmReady = jest.spyOn(
      servicePrivate,
      'confirmReadyAndMarkConnected'
    );

    servicePrivate.acceptNativeConnectionStatus(
      client,
      {
        provider: 'wwebjs',
        status: EWhatsappConnectionStatus.online,
        connected: true,
        authenticated: true,
        sessionValid: true,
        recoverable: false,
        qrAvailable: false,
        sequence: 5,
        changedAt: new Date().toISOString(),
        reason: 'socket_reconnected',
      },
      true
    );
    await Promise.resolve();
    servicePrivate.client = replacementClient;
    servicePrivate.clientConnectionAttemptIds.set(replacementClient, 4);
    releasePersistence?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(confirmReady).not.toHaveBeenCalled();
  });

  it('fences source mismatch, stale and duplicate snapshots before fail-closed revocation', () => {
    const { servicePrivate } = makeService();
    const source = {
      getConnectionStatus: jest.fn(),
      on: jest.fn(),
    };
    servicePrivate.nativeConnectionStatusSource = source;
    servicePrivate.nativeConnectionStatus = {
      provider: 'wwebjs',
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
      provider: 'wwebjs',
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
      { getConnectionStatus: jest.fn(), on: jest.fn() },
      offline(6),
      true
    );

    expect(servicePrivate.nativeConnectionStatus.sequence).toBe(5);
    expect(servicePrivate.centralOnlineAcknowledged).toBe(true);
    expect(isWorkerKafkaDispatchAuthorized()).toBe(true);
  });

  beforeEach(() => {
    jest.useFakeTimers();
    mockImportWhatsAppWebSessionToLocalAuth.mockReset();
    mockBrowserProjectionFromWhatsAppWebProfile.mockReset();
    mockEmitWorkerProviderRuntimeState.mockReset();
    mockEmitWorkerProviderRuntimeState.mockResolvedValue(undefined);
    mockWwebjsInitialize.mockReset();
    mockWwebjsInitialize.mockResolvedValue(undefined);
    mockWwebjsRefreshQr.mockReset();
    mockWwebjsRefreshQr.mockResolvedValue(true);
    mockLastWwebjsClient = undefined;
    mockLastWwebjsClientOptions = undefined;
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('attaches the acquired lease proof only to a canonical strong ONLINE status', async () => {
    const previousStorage = process.env.WORKER_SESSION_STORAGE;
    process.env.WORKER_SESSION_STORAGE = 'postgres';
    try {
      const { servicePrivate, balanceWorkerStatusGrpcClientService } =
        makeService();
      servicePrivate.postgresSessionStore = {
        getConnectionStatusLeaseProof: () => ({
          ownerId: '01900000-0000-7000-8000-000000000081',
          fencingToken: '29',
        }),
      } as unknown as PostgresWwebjsSessionStore;
      const nativeOnline = {
        provider: 'wwebjs' as const,
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
            worker_id: 'worker-w',
            account_id: 'account-w',
            status: Status.connected,
            code: ECodeMessage.connectionEstablished,
            worker_status_id: EWorkerStatus.online,
            session_ready: true,
            can_send: true,
            can_receive_runtime: true,
            authenticated: true,
            connection_status_source_id: '01900000-0000-7000-8000-000000000083',
            connection_status: nativeOnline,
          },
          'test_online_proof'
        )
      ).resolves.toEqual({ outcome: 'accepted' });
      expect(
        balanceWorkerStatusGrpcClientService.notifyWorkerStatus
      ).toHaveBeenLastCalledWith(expect.any(Object), {
        connectionStatusLeaseProof: {
          ownerId: '01900000-0000-7000-8000-000000000081',
          fencingToken: '29',
        },
      });

      await expect(
        servicePrivate.notifyWorkerStatusSafely(
          {
            worker_id: 'worker-w',
            account_id: 'account-w',
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
          worker_id: 'worker-w',
          account_id: 'account-w',
          status: Status.disconnected,
          code: ECodeMessage.connectionClosed,
          worker_status_id: EWorkerStatus.disponible,
          connection_status_source_id: '01900000-0000-7000-8000-000000000083',
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

  it('uses a bounded Puppeteer protocol timeout below five minutes', () => {
    expect(resolveWwebjsProtocolTimeoutMs(undefined)).toBe(60_000);
    expect(resolveWwebjsProtocolTimeoutMs('90000')).toBe(90_000);
    expect(resolveWwebjsProtocolTimeoutMs('1')).toBe(5_000);
    expect(resolveWwebjsProtocolTimeoutMs('999999')).toBe(240_000);
    expect(resolveWwebjsProtocolTimeoutMs('invalid')).toBe(60_000);
  });

  it('starts the initial RemoteAuth checkpoint promptly while keeping it configurable', () => {
    expect(resolveWwebjsRemoteAuthInitialCheckpointDelayMs(undefined)).toBe(
      5_000
    );
    expect(resolveWwebjsRemoteAuthInitialCheckpointDelayMs('0')).toBe(0);
    expect(resolveWwebjsRemoteAuthInitialCheckpointDelayMs('7500')).toBe(7_500);
    expect(resolveWwebjsRemoteAuthInitialCheckpointDelayMs('999999')).toBe(
      120_000
    );
    expect(resolveWwebjsRemoteAuthInitialCheckpointDelayMs('invalid')).toBe(
      5_000
    );
  });

  it('extends only the canonical handoff initialize watchdog', () => {
    expect(
      resolveWwebjsClientInitializeWatchdogTimeoutMs(false, undefined, 210_000)
    ).toBe(210_000);
    expect(
      resolveWwebjsClientInitializeWatchdogTimeoutMs(true, undefined, 210_000)
    ).toBe(285_000);
    expect(
      resolveWwebjsClientInitializeWatchdogTimeoutMs(true, '480000', 210_000)
    ).toBe(285_000);
    expect(
      resolveWwebjsClientInitializeWatchdogTimeoutMs(true, '120000', 210_000)
    ).toBe(210_000);
    expect(
      resolveWwebjsClientInitializeWatchdogTimeoutMs(true, '999999', 210_000)
    ).toBe(285_000);
    expect(
      resolveWwebjsClientInitializeWatchdogTimeoutMs(
        true,
        '480000',
        210_000,
        600_000
      )
    ).toBe(480_000);
  });

  it('wires the extended watchdog only into secure-import client initialization', async () => {
    const normal = makeService().servicePrivate;
    normal.activeConnectionAttemptId = 1;
    normal.status = Status.connecting;
    jest
      .spyOn(normal, 'startConnectionStateProbe')
      .mockImplementation(() => undefined);
    jest
      .spyOn(normal, 'recoverChromiumProfileBeforeLaunch')
      .mockResolvedValue(undefined);
    const normalTrack = jest.spyOn(normal, 'trackClientInitialization');

    void normal.createAndWaitClient(1, false);
    await Promise.resolve();
    await Promise.resolve();

    expect(normalTrack).toHaveBeenCalledWith(
      expect.anything(),
      1,
      expect.any(Promise),
      resolveWwebjsClientInitializeWatchdogTimeoutMs(false)
    );

    const secureImport = makeService().servicePrivate;
    secureImport.activeConnectionAttemptId = 1;
    secureImport.status = Status.connecting;
    jest
      .spyOn(secureImport, 'startConnectionStateProbe')
      .mockImplementation(() => undefined);
    jest
      .spyOn(secureImport, 'recoverChromiumProfileBeforeLaunch')
      .mockResolvedValue(undefined);
    const secureImportTrack = jest.spyOn(
      secureImport,
      'trackClientInitialization'
    );

    void secureImport.createAndWaitClient(1, true);
    await Promise.resolve();
    await Promise.resolve();

    expect(secureImportTrack).toHaveBeenCalledWith(
      expect.anything(),
      1,
      expect.any(Promise),
      resolveWwebjsClientInitializeWatchdogTimeoutMs(true)
    );
  });

  it('defers a secure-import ready event until client initialization settles', async () => {
    let resolveInitialize!: () => void;
    mockWwebjsInitialize.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveInitialize = resolve;
        })
    );
    const { servicePrivate } = makeService();
    servicePrivate.activeConnectionAttemptId = 1;
    servicePrivate.status = Status.connecting;
    jest
      .spyOn(servicePrivate, 'recoverChromiumProfileBeforeLaunch')
      .mockResolvedValue(undefined);
    const startProbe = jest
      .spyOn(servicePrivate, 'startConnectionStateProbe')
      .mockImplementation(() => undefined);
    const confirmReady = jest.spyOn(
      servicePrivate,
      'confirmReadyAndMarkConnected'
    );

    void servicePrivate.createAndWaitClient(1, true);
    await Promise.resolve();
    await Promise.resolve();
    expect(mockLastWwebjsClient).toBeDefined();
    startProbe.mockClear();

    await mockLastWwebjsClient?.emit('ready');

    expect(confirmReady).not.toHaveBeenCalled();
    expect(startProbe).toHaveBeenCalledWith(
      mockLastWwebjsClient,
      1,
      null,
      true,
      true
    );
    expect(
      servicePrivate.clientInitializationLifecycles.get(
        mockLastWwebjsClient as object
      )?.initializeState
    ).toBe('pending');

    resolveInitialize();
    await Promise.resolve();
    await Promise.resolve();
  });

  it('uses the live profile-compatible version for legacy-volume sessions', async () => {
    const previousStorage = process.env.WORKER_SESSION_STORAGE;
    process.env.WORKER_SESSION_STORAGE = 'legacy_volume';
    try {
      const { servicePrivate } = makeService();
      servicePrivate.activeConnectionAttemptId = 1;
      servicePrivate.status = Status.connecting;
      jest
        .spyOn(servicePrivate, 'startConnectionStateProbe')
        .mockImplementation(() => undefined);
      jest
        .spyOn(servicePrivate, 'recoverChromiumProfileBeforeLaunch')
        .mockResolvedValue(undefined);

      void servicePrivate.createAndWaitClient(1);
      await Promise.resolve();
      await Promise.resolve();

      expect(mockLastWwebjsClientOptions).toEqual(
        expect.objectContaining({
          webVersionCache: { type: 'none' },
        })
      );
      expect(mockLastWwebjsClientOptions).not.toHaveProperty('webVersion');
    } finally {
      if (previousStorage === undefined) {
        delete process.env.WORKER_SESSION_STORAGE;
      } else {
        process.env.WORKER_SESSION_STORAGE = previousStorage;
      }
    }
  });

  it('wires fresh-process bootstrap to refresh PostgreSQL session state before hasSession', async () => {
    const previousStorage = process.env.WORKER_SESSION_STORAGE;
    process.env.WORKER_SESSION_STORAGE = 'postgres';
    try {
      const { servicePrivate, healthCheckService } = makeService();
      const sessionExists = jest.fn(async () => true);
      servicePrivate.postgresSessionKnown = false;
      servicePrivate.postgresSessionStore = {
        revisionId: 'bootstrap-revision',
        revisionStatus: 'active',
        sessionExists,
      } as unknown as PostgresWwebjsSessionStore;
      const healthConfig = healthCheckService.configure.mock.calls[0]?.[0] as {
        prepareSession?: () => Promise<boolean>;
        hasSession: () => boolean;
      };

      expect(healthConfig.hasSession()).toBe(false);
      await expect(healthConfig.prepareSession?.()).resolves.toBe(true);

      expect(sessionExists).toHaveBeenCalledWith({
        session: 'RemoteAuth-worker-w',
      });
      expect(healthConfig.hasSession()).toBe(true);
    } finally {
      if (previousStorage === undefined) {
        delete process.env.WORKER_SESSION_STORAGE;
      } else {
        process.env.WORKER_SESSION_STORAGE = previousStorage;
      }
    }
  });

  it('resumes a protected validating legacy-volume candidate without restaging the source volume', async () => {
    const previousStorage = process.env.WORKER_SESSION_STORAGE;
    const previousMigrationId = process.env.SESSION_STORAGE_MIGRATION_ID;
    const previousChecksum = process.env.LEGACY_SESSION_CHECKSUM_SHA256;
    process.env.WORKER_SESSION_STORAGE = 'postgres';
    process.env.SESSION_STORAGE_MIGRATION_ID =
      '019ff000-0000-7000-8000-000000000001';
    process.env.LEGACY_SESSION_CHECKSUM_SHA256 = 'a'.repeat(64);
    try {
      const { servicePrivate } = makeService();
      const sessionExists = jest.fn(async () => true);
      const initializeLegacyVolumeCandidateProfile = jest.fn();
      const stageCandidate = jest.fn();
      servicePrivate.postgresSessionKnown = false;
      servicePrivate.postgresSessionStore = {
        revisionId: 'legacy-retry-revision',
        revisionStatus: 'validating',
        revisionSource: 'legacy_volume_migration',
        sessionExists,
        initializeLegacyVolumeCandidateProfile,
        stageCandidate,
      } as unknown as PostgresWwebjsSessionStore;

      await expect(
        servicePrivate.refreshPostgresSessionState()
      ).resolves.toBeUndefined();

      expect(sessionExists).toHaveBeenCalledTimes(2);
      expect(initializeLegacyVolumeCandidateProfile).not.toHaveBeenCalled();
      expect(stageCandidate).not.toHaveBeenCalled();
      expect(servicePrivate.postgresSessionKnown).toBe(true);
    } finally {
      if (previousStorage === undefined) {
        delete process.env.WORKER_SESSION_STORAGE;
      } else {
        process.env.WORKER_SESSION_STORAGE = previousStorage;
      }
      if (previousMigrationId === undefined) {
        delete process.env.SESSION_STORAGE_MIGRATION_ID;
      } else {
        process.env.SESSION_STORAGE_MIGRATION_ID = previousMigrationId;
      }
      if (previousChecksum === undefined) {
        delete process.env.LEGACY_SESSION_CHECKSUM_SHA256;
      } else {
        process.env.LEGACY_SESSION_CHECKSUM_SHA256 = previousChecksum;
      }
    }
  });

  it('routes a native PostgreSQL lease loss to supervised recovery and blocks local reconnect until a new fence/store lease is ready', async () => {
    const previousStorage = process.env.WORKER_SESSION_STORAGE;
    process.env.WORKER_SESSION_STORAGE = 'postgres';
    try {
      const { service, servicePrivate, incomingMessageService } = makeService();
      const leaseProof = {
        ownerId: '01900000-0000-7000-8000-000000000084',
        fencingToken: '32',
      };
      servicePrivate.postgresSessionKnown = true;
      servicePrivate.postgresSessionStore = {
        logger: { log: jest.fn() },
        getNativeStore: jest.fn(() => ({})),
        getConnectionStatusLeaseProof: jest.fn(() => leaseProof),
        hasPendingHandoff: jest.fn(() => false),
      } as unknown as PostgresWwebjsSessionStore;
      servicePrivate.initialConnection = true;
      servicePrivate.activeConnectionAttemptId = 1;
      servicePrivate.status = Status.connected;
      jest.spyOn(servicePrivate, 'prepareFolder').mockImplementation(() => {});
      jest
        .spyOn(servicePrivate, 'recoverChromiumProfileBeforeLaunch')
        .mockResolvedValue(undefined);
      jest
        .spyOn(servicePrivate, 'startConnectionStateProbe')
        .mockImplementation(() => undefined);
      jest
        .spyOn(servicePrivate, 'queueTeardown')
        .mockImplementation(() => undefined);
      const leaseLost = jest.fn(async () => undefined);
      service.onSessionLeaseLost(leaseLost);

      void servicePrivate.createAndWaitClient(1);
      await Promise.resolve();
      await Promise.resolve();
      const client = mockLastWwebjsClient;
      expect(client).toBeDefined();
      servicePrivate.disconnectRetryTimer = setTimeout(() => undefined, 60_000);

      servicePrivate.handlePostgresSessionLeaseLost(
        Object.assign(new Error('native store lease loss'), {
          code: 'whatsapp_session_lease_lost',
        })
      );
      const firstLossGeneration =
        servicePrivate.postgresLeaseRecoveryGeneration;
      await client?.emit('disconnected', 'whatsapp_session_lease_lost');
      await Promise.resolve();
      await Promise.resolve();

      expect(leaseLost).toHaveBeenCalledTimes(1);
      expect(servicePrivate.postgresLeaseRecoveryGeneration).toBe(
        firstLossGeneration
      );
      expect(servicePrivate.postgresLeaseRecoveryRequired).toBe(true);
      expect(incomingMessageService.unbind).toHaveBeenCalled();
      expect(servicePrivate.disconnectRetryTimer).toBeUndefined();
      expect(servicePrivate.shouldScheduleRetryAfterDisconnect(false)).toBe(
        false
      );
      expect(service.hasSession()).toBe(true);

      const generation = service.beginSessionLeaseRecoveryResume();
      expect(generation).toBe(servicePrivate.postgresLeaseRecoveryGeneration);
      servicePrivate.handlePostgresSessionLeaseLost(
        Object.assign(new Error('second lease loss during resume'), {
          code: 'whatsapp_session_lease_lost',
        })
      );
      await Promise.resolve();
      expect(leaseLost).toHaveBeenCalledTimes(2);
      expect(servicePrivate.postgresLeaseRecoveryGeneration).toBe(
        firstLossGeneration + 1
      );
      expect(service.startSessionLeaseRecoverySocket(generation)).toBe(false);
      expect(service.markSessionLeaseRecoveryCompleted(generation)).toBe(false);

      const staleTimerGeneration = service.beginSessionLeaseRecoveryResume();
      expect(staleTimerGeneration).toBe(
        servicePrivate.postgresLeaseRecoveryGeneration
      );
      const connect = jest
        .spyOn(service, 'connect')
        .mockResolvedValue({} as IBaileysConnectionState);
      servicePrivate.scheduleNextReconnectAttempt(false);
      expect(servicePrivate.disconnectRetryTimer).toBeDefined();
      servicePrivate.postgresLeaseRecoveryGeneration += 1;
      servicePrivate.postgresLeaseRecoveryResumeGeneration = undefined;
      await jest.advanceTimersByTimeAsync(0);
      expect(connect).not.toHaveBeenCalled();
      expect(servicePrivate.disconnectRetryTimer).toBeUndefined();

      const replacementGeneration = service.beginSessionLeaseRecoveryResume();
      expect(replacementGeneration).toBe(
        servicePrivate.postgresLeaseRecoveryGeneration
      );
      jest
        .spyOn(servicePrivate, 'scheduleNextReconnectAttempt')
        .mockImplementation(() => {
          servicePrivate.client = {};
        });
      expect(
        service.startSessionLeaseRecoverySocket(replacementGeneration)
      ).toBe(true);
      expect(
        service.markSessionLeaseRecoveryCompleted(replacementGeneration)
      ).toBe(true);
      expect(servicePrivate.postgresLeaseRecoveryRequired).toBe(false);

      servicePrivate.setStatus(Status.disconnected, ECodeMessage.badSession);
      expect(servicePrivate.postgresSessionKnown).toBe(false);
      expect(service.hasSession()).toBe(false);
      servicePrivate.handlePostgresSessionLeaseLost(
        Object.assign(new Error('stale terminal lease callback'), {
          code: 'whatsapp_session_lease_lost',
        })
      );
      await Promise.resolve();
      expect(leaseLost).toHaveBeenCalledTimes(2);
      expect(servicePrivate.postgresLeaseRecoveryRequired).toBe(false);
    } finally {
      if (previousStorage === undefined) {
        delete process.env.WORKER_SESSION_STORAGE;
      } else {
        process.env.WORKER_SESSION_STORAGE = previousStorage;
      }
    }
  });

  it('deduplicates a bootstrap refresh racing the connection refresh on the same PostgreSQL store', async () => {
    const previousStorage = process.env.WORKER_SESSION_STORAGE;
    process.env.WORKER_SESSION_STORAGE = 'postgres';
    try {
      const { servicePrivate, healthCheckService } = makeService();
      let resolveSessionExists!: (exists: boolean) => void;
      let markSessionExistsStarted!: () => void;
      const sessionExistsStarted = new Promise<void>((resolve) => {
        markSessionExistsStarted = resolve;
      });
      const sessionExists = jest.fn(() => {
        markSessionExistsStarted();
        return new Promise<boolean>((resolve) => {
          resolveSessionExists = resolve;
        });
      });
      servicePrivate.postgresSessionStore = {
        revisionId: 'bootstrap-race-revision',
        revisionStatus: 'active',
        sessionExists,
      } as unknown as PostgresWwebjsSessionStore;
      const healthConfig = healthCheckService.configure.mock.calls[0]?.[0] as {
        prepareSession: () => Promise<boolean>;
        hasSession: () => boolean;
      };

      const bootstrapRefresh = healthConfig.prepareSession();
      await sessionExistsStarted;
      expect(sessionExists).toHaveBeenCalledTimes(1);
      const connectionRefresh = servicePrivate.refreshPostgresSessionState();

      expect(sessionExists).toHaveBeenCalledTimes(1);
      resolveSessionExists(true);
      await expect(
        Promise.all([bootstrapRefresh, connectionRefresh])
      ).resolves.toEqual([true, undefined]);
      expect(servicePrivate.postgresSessionRefreshPromise).toBeUndefined();
      expect(healthConfig.hasSession()).toBe(true);
    } finally {
      if (previousStorage === undefined) {
        delete process.env.WORKER_SESSION_STORAGE;
      } else {
        process.env.WORKER_SESSION_STORAGE = previousStorage;
      }
    }
  });

  it('does not let a PostgreSQL refresh started before a terminal transition resurrect the session', async () => {
    const previousStorage = process.env.WORKER_SESSION_STORAGE;
    process.env.WORKER_SESSION_STORAGE = 'postgres';
    try {
      const { service, servicePrivate } = makeService();
      let resolveSessionExists!: (exists: boolean) => void;
      let markSessionExistsStarted!: () => void;
      const sessionExistsStarted = new Promise<void>((resolve) => {
        markSessionExistsStarted = resolve;
      });
      servicePrivate.postgresSessionStore = {
        revisionId: 'terminal-race-revision',
        revisionStatus: 'active',
        sessionExists: jest.fn(() => {
          markSessionExistsStarted();
          return new Promise<boolean>((resolve) => {
            resolveSessionExists = resolve;
          });
        }),
      } as unknown as PostgresWwebjsSessionStore;

      const refresh = servicePrivate.refreshPostgresSessionState();
      await sessionExistsStarted;
      servicePrivate.setStatus(Status.disconnected, ECodeMessage.badSession);
      servicePrivate.setStatus(Status.connecting, ECodeMessage.awaitConnection);
      resolveSessionExists(true);
      await refresh;

      expect(servicePrivate.postgresSessionKnown).toBe(false);
      expect(service.hasSession()).toBe(false);
    } finally {
      if (previousStorage === undefined) {
        delete process.env.WORKER_SESSION_STORAGE;
      } else {
        process.env.WORKER_SESSION_STORAGE = previousStorage;
      }
    }
  });

  it('keeps bootstrap session preparation as a legacy-volume no-op', async () => {
    const previousStorage = process.env.WORKER_SESSION_STORAGE;
    process.env.WORKER_SESSION_STORAGE = 'legacy_volume';
    try {
      const { servicePrivate, healthCheckService } = makeService();
      const sessionExists = jest.fn(async () => true);
      servicePrivate.postgresSessionStore = {
        sessionExists,
      } as unknown as PostgresWwebjsSessionStore;
      const healthConfig = healthCheckService.configure.mock.calls[0]?.[0] as {
        prepareSession?: () => Promise<boolean>;
      };

      await expect(healthConfig.prepareSession?.()).resolves.toBe(true);
      expect(sessionExists).not.toHaveBeenCalled();
    } finally {
      if (previousStorage === undefined) {
        delete process.env.WORKER_SESSION_STORAGE;
      } else {
        process.env.WORKER_SESSION_STORAGE = previousStorage;
      }
    }
  });

  it('keeps a tombstoned bootstrap dormant without inspecting the browser profile', async () => {
    const {
      servicePrivate,
      healthCheckService,
      balanceWorkerStatusGrpcClientService,
    } = makeService();
    balanceWorkerStatusGrpcClientService.activateWhatsappRuntimeFence.mockRejectedValueOnce(
      new Error('worker_runtime_fence_rejected')
    );
    const waitForSessionProfileTransition = jest.spyOn(
      servicePrivate,
      'waitForSessionProfileTransition'
    );
    const healthConfig = healthCheckService.configure.mock.calls[0]?.[0] as {
      prepareSession?: () => Promise<boolean>;
    };

    await expect(healthConfig.prepareSession?.()).resolves.toBe(false);

    expect(waitForSessionProfileTransition).not.toHaveBeenCalled();
  });

  it('uses live/latest without a literal version for PostgreSQL sessions', async () => {
    const previousStorage = process.env.WORKER_SESSION_STORAGE;
    process.env.WORKER_SESSION_STORAGE = 'postgres';
    try {
      const { servicePrivate } = makeService();
      servicePrivate.postgresSessionStore = {
        logger: { log: jest.fn() },
        getNativeStore: () => ({}),
      } as unknown as PostgresWwebjsSessionStore;
      servicePrivate.activeConnectionAttemptId = 1;
      servicePrivate.status = Status.connecting;
      jest
        .spyOn(servicePrivate, 'startConnectionStateProbe')
        .mockImplementation(() => undefined);
      jest
        .spyOn(servicePrivate, 'recoverChromiumProfileBeforeLaunch')
        .mockResolvedValue(undefined);

      void servicePrivate.createAndWaitClient(1);
      await Promise.resolve();
      await Promise.resolve();

      expect(mockLastWwebjsClientOptions).not.toHaveProperty('webVersion');
      expect(mockLastWwebjsClientOptions).toEqual(
        expect.objectContaining({
          webVersionCache: { type: 'none' },
        })
      );
    } finally {
      if (previousStorage === undefined) {
        delete process.env.WORKER_SESSION_STORAGE;
      } else {
        process.env.WORKER_SESSION_STORAGE = previousStorage;
      }
    }
  });

  it('fails a PostgreSQL restore closed without exposing an unexpected QR', async () => {
    const previousStorage = process.env.WORKER_SESSION_STORAGE;
    process.env.WORKER_SESSION_STORAGE = 'postgres';
    try {
      const { servicePrivate } = makeService();
      const failCandidate = jest.fn(async () => undefined);
      const sessionExists = jest.fn(async () => true);
      servicePrivate.postgresSessionStore = {
        revisionId: '11',
        revisionStatus: 'validating',
        logger: { log: jest.fn() },
        getNativeStore: () => ({}),
        hasPendingHandoff: () => true,
        failCandidate,
        sessionExists,
      } as unknown as PostgresWwebjsSessionStore;
      servicePrivate.activeConnectionAttemptId = 1;
      servicePrivate.status = Status.connecting;
      jest
        .spyOn(servicePrivate, 'startConnectionStateProbe')
        .mockImplementation(() => undefined);
      jest
        .spyOn(servicePrivate, 'recoverChromiumProfileBeforeLaunch')
        .mockResolvedValue(undefined);
      jest
        .spyOn(servicePrivate, 'queueTeardown')
        .mockImplementation(() => undefined);

      const connection = servicePrivate.createAndWaitClient(1, true);
      await Promise.resolve();
      await Promise.resolve();
      expect(mockLastWwebjsClient).toBeDefined();
      const remoteAuth = mockLastWwebjsClientOptions?.authStrategy as
        { options?: Record<string, unknown> } | undefined;
      expect(remoteAuth?.options).toEqual(
        expect.objectContaining({
          identityResolver: resolveWwebjsCanonicalCompanionIdentity,
          requireFingerprintVerification: true,
        })
      );

      await mockLastWwebjsClient?.emit(
        'qr',
        'qr-payload-that-must-never-be-published'
      );
      const result = await connection;

      expect(failCandidate).toHaveBeenCalledWith(
        'wwebjs_restore_unexpected_qr'
      );
      expect(sessionExists).toHaveBeenCalledWith({
        session: 'RemoteAuth-worker-w',
      });
      expect(result).toEqual(
        expect.objectContaining({
          status: Status.disconnected,
          code: ECodeMessage.badSession,
          reason: 'wwebjs_restore_unexpected_qr',
          session_ready: false,
        })
      );
      expect(result.qrcode).toBeUndefined();

      await mockLastWwebjsClient?.emit('qr', 'second-qr');
      expect(failCandidate).toHaveBeenCalledTimes(1);
    } finally {
      if (previousStorage === undefined) {
        delete process.env.WORKER_SESSION_STORAGE;
      } else {
        process.env.WORKER_SESSION_STORAGE = previousStorage;
      }
    }
  });

  it.each([
    ['qr', 'wwebjs_restore_unexpected_qr'],
    ['auth_failure', 'wwebjs_post_cas_connection_failed'],
  ] as const)(
    'restarts an active PostgreSQL revision after %s without rollback, quarantine, or QR',
    async (event, expectedReason) => {
      const previousStorage = process.env.WORKER_SESSION_STORAGE;
      process.env.WORKER_SESSION_STORAGE = 'postgres';
      try {
        const { servicePrivate } = makeService();
        const failCandidate = jest.fn(async () => undefined);
        servicePrivate.postgresSessionKnown = true;
        servicePrivate.postgresSessionStore = {
          revisionId: '12',
          revisionStatus: 'active',
          logger: { log: jest.fn() },
          getNativeStore: () => ({}),
          hasPendingHandoff: () => false,
          failCandidate,
          sessionExists: jest.fn(async () => true),
        } as unknown as PostgresWwebjsSessionStore;
        servicePrivate.activeConnectionAttemptId = 1;
        servicePrivate.status = Status.connecting;
        jest
          .spyOn(servicePrivate, 'startConnectionStateProbe')
          .mockImplementation(() => undefined);
        jest
          .spyOn(servicePrivate, 'recoverChromiumProfileBeforeLaunch')
          .mockResolvedValue(undefined);
        jest
          .spyOn(servicePrivate, 'destroyClientWithTimeout')
          .mockResolvedValue(true);
        const scheduleRetry = jest
          .spyOn(servicePrivate, 'scheduleNextReconnectAttempt')
          .mockImplementation(() => undefined);

        const connection = servicePrivate.createAndWaitClient(1, true);
        await Promise.resolve();
        await Promise.resolve();
        expect(mockLastWwebjsClient).toBeDefined();

        await mockLastWwebjsClient?.emit(
          event,
          event === 'qr' ? 'forbidden-qr' : expectedReason
        );
        const result = await connection;
        await servicePrivate.teardownPromise;
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(failCandidate).not.toHaveBeenCalled();
        expect(servicePrivate.sessionRestoreBlocked).toBe(false);
        expect(result).toEqual(
          expect.objectContaining({
            status: Status.connecting,
            code: ECodeMessage.awaitConnection,
            provider_state: 'postgres_active_revision_restarting',
            degraded_reason: expectedReason,
            session_ready: false,
          })
        );
        expect(result.qrcode).toBeUndefined();
        expect(scheduleRetry).toHaveBeenCalledWith(false);
      } finally {
        if (previousStorage === undefined) {
          delete process.env.WORKER_SESSION_STORAGE;
        } else {
          process.env.WORKER_SESSION_STORAGE = previousStorage;
        }
      }
    }
  );

  it('restarts an active PostgreSQL revision after initialize fails without quarantine or QR', async () => {
    const previousStorage = process.env.WORKER_SESSION_STORAGE;
    process.env.WORKER_SESSION_STORAGE = 'postgres';
    try {
      const { servicePrivate } = makeService();
      const client = {
        destroy: jest.fn(async () => undefined),
      };
      const failCandidate = jest.fn(async () => undefined);
      servicePrivate.postgresSessionKnown = true;
      servicePrivate.postgresSessionStore = {
        revisionId: '12',
        revisionStatus: 'active',
        logger: { log: jest.fn() },
        getNativeStore: () => ({}),
        hasPendingHandoff: () => false,
        failCandidate,
      } as unknown as PostgresWwebjsSessionStore;
      servicePrivate.client = client;
      servicePrivate.activeConnectionAttemptId = 1;
      servicePrivate.clientConnectionAttemptIds.set(client, 1);
      servicePrivate.connecting = true;
      servicePrivate.runtimeGeneration = 41;
      servicePrivate.sessionLifecycleLease = {
        ownerToken: 'initialize-owner',
        released: false,
        release: jest.fn(),
      };
      servicePrivate.sessionLifecycleLeaseGeneration = 1;
      servicePrivate.trackClientInitialization(client, 1, Promise.resolve());
      jest
        .spyOn(servicePrivate, 'destroyClientWithTimeout')
        .mockResolvedValue(true);
      const quarantine = jest.spyOn(servicePrivate, 'quarantineCurrentSession');
      const scheduleRetry = jest
        .spyOn(servicePrivate, 'scheduleNextReconnectAttempt')
        .mockImplementation(() => undefined);

      await servicePrivate.handleInitializeError(
        'permanent-looking browser bootstrap failure',
        client,
        1
      );
      await servicePrivate.teardownPromise;
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(0);

      expect(failCandidate).not.toHaveBeenCalled();
      expect(quarantine).not.toHaveBeenCalled();
      expect(servicePrivate.sessionRestoreBlocked).toBe(false);
      expect(scheduleRetry).toHaveBeenCalledWith(false);
    } finally {
      if (previousStorage === undefined) {
        delete process.env.WORKER_SESSION_STORAGE;
      } else {
        process.env.WORKER_SESSION_STORAGE = previousStorage;
      }
    }
  });

  it('schedules one forced local reconnect for persisted auth with a missing client', async () => {
    const { service, servicePrivate } = makeService();
    const state: IBaileysConnectionState = {
      status: Status.connecting,
      code: ECodeMessage.awaitConnection,
      worker_id: 'worker-w',
      account_id: 'account-w',
    };
    jest.spyOn(service, 'hasSession').mockReturnValue(true);
    const connect = jest.spyOn(service, 'connect').mockResolvedValue(state);
    servicePrivate.initialConnection = true;
    servicePrivate.connecting = false;
    servicePrivate.currentPromise = undefined;
    servicePrivate.client = undefined;
    servicePrivate.sessionLifecycleTerminationUnconfirmed = false;
    servicePrivate.status = Status.connecting;

    expect(service.canRecoverRestorableSession()).toBe(true);
    expect(
      service.ensureRestorableSessionRecovery('self_monitor:missing_client')
    ).toBe(true);
    expect(
      service.ensureRestorableSessionRecovery('self_monitor:missing_client')
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

  it('never overlaps destroy with a stalled logout and permits only a recreated client', async () => {
    const { servicePrivate } = makeService();
    let rejectLate!: (error: Error) => void;
    const oldClient = {
      logout: jest.fn(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectLate = reject;
          })
      ),
      destroy: jest.fn(async () => undefined),
      pupBrowser: undefined,
    };
    const forceTerminate = jest
      .spyOn(servicePrivate, 'forceTerminateClientRuntimeWithoutSdkOverlap')
      .mockResolvedValue(true);
    const destroyClient = jest
      .spyOn(servicePrivate, 'destroyClientWithTimeout')
      .mockResolvedValue(true);
    servicePrivate.client = oldClient;

    const teardown = servicePrivate.safeDestroy(true, oldClient, true, false);
    const teardownResult = expect(teardown).resolves.toBe(true);
    await jest.advanceTimersByTimeAsync(15_000);
    await teardownResult;

    expect(oldClient.logout).toHaveBeenCalledTimes(1);
    expect(oldClient.destroy).not.toHaveBeenCalled();
    expect(destroyClient).not.toHaveBeenCalled();
    expect(forceTerminate).toHaveBeenCalledWith(
      oldClient,
      'safe_destroy:logout_stalled'
    );

    servicePrivate.client = oldClient;
    await expect(
      servicePrivate.safeDestroy(true, oldClient, true, false)
    ).resolves.toBe(true);
    expect(oldClient.logout).toHaveBeenCalledTimes(1);
    expect(destroyClient).not.toHaveBeenCalled();

    rejectLate(new Error('late logout rejection'));
    await jest.advanceTimersByTimeAsync(0);
    expect(console.warn).toHaveBeenCalledWith(
      '[WhatsappProviderAuxiliary] operation_rejected_after_timeout',
      expect.objectContaining({
        provider: 'wwebjs',
        operation: 'connection_logout',
        timeout_ms: 15_000,
      })
    );

    const freshClient = {
      logout: jest.fn(async () => undefined),
      destroy: jest.fn(async () => undefined),
      pupBrowser: undefined,
    };
    servicePrivate.client = freshClient;
    const freshTeardown = servicePrivate.safeDestroy(
      true,
      freshClient,
      true,
      false
    );
    await jest.advanceTimersByTimeAsync(1_000);
    await expect(freshTeardown).resolves.toBe(true);
    expect(freshClient.logout).toHaveBeenCalledTimes(1);
    expect(destroyClient).toHaveBeenCalledWith(freshClient, 'safe_destroy');
  });

  it('observes a failed outbound recovery and retries the same client with bounded backoff', async () => {
    const { service, servicePrivate } = makeService();
    const client = {
      info: { wid: { _serialized: '5511999999999@c.us' } },
    };
    servicePrivate.client = client;
    const recover = jest
      .spyOn(servicePrivate, 'recoverFromOutboundSendFailure')
      .mockRejectedValueOnce(new Error('browser teardown temporarily failed'))
      .mockResolvedValueOnce(undefined);
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);

    try {
      expect(
        service.reportOutboundSendFailure(
          client as never,
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

  it('awaits Chromium profile lock recovery before initializing the browser', async () => {
    const { servicePrivate } = makeService();
    let authorizeRecovery: (() => void) | undefined;
    const recovery = new Promise<void>((resolve) => {
      authorizeRecovery = resolve;
    });
    const recover = jest
      .spyOn(servicePrivate, 'recoverChromiumProfileBeforeLaunch')
      .mockReturnValue(recovery);
    servicePrivate.sessionLifecycleLease = {
      ownerToken: 'connection-owner',
      released: false,
      release: jest.fn(),
    };
    servicePrivate.activeConnectionAttemptId = 1;
    servicePrivate.status = Status.connecting;
    jest
      .spyOn(servicePrivate, 'startConnectionStateProbe')
      .mockImplementation(() => undefined);

    void servicePrivate.createAndWaitClient(1);
    await Promise.resolve();
    await Promise.resolve();

    expect(recover).toHaveBeenCalledTimes(1);
    expect(mockWwebjsInitialize).not.toHaveBeenCalled();

    authorizeRecovery?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockWwebjsInitialize).toHaveBeenCalledTimes(1);
  });

  it('never initializes the browser when Chromium lock recovery is denied', async () => {
    const { servicePrivate } = makeService();
    jest
      .spyOn(servicePrivate, 'recoverChromiumProfileBeforeLaunch')
      .mockRejectedValue(
        new Error(
          'wwebjs_chromium_profile_lock_recovery_blocked:authorization_denied'
        )
      );
    const initializeError = jest
      .spyOn(servicePrivate, 'handleInitializeError')
      .mockResolvedValue(undefined);
    servicePrivate.sessionLifecycleLease = {
      ownerToken: 'connection-owner',
      released: false,
      release: jest.fn(),
    };
    servicePrivate.activeConnectionAttemptId = 1;
    servicePrivate.status = Status.connecting;
    jest
      .spyOn(servicePrivate, 'startConnectionStateProbe')
      .mockImplementation(() => undefined);

    void servicePrivate.createAndWaitClient(1);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(0);

    expect(mockWwebjsInitialize).not.toHaveBeenCalled();
    expect(initializeError).toHaveBeenCalledWith(
      'wwebjs_chromium_profile_lock_recovery_blocked:authorization_denied',
      expect.any(Object),
      1,
      expect.any(Object)
    );
  });

  it('keeps quarantine outside the worker folder but inside the mounted /app/data volume', () => {
    const { servicePrivate } = makeService();

    expect(servicePrivate.getSessionGuardContext().quarantineRootPath).toBe(
      '/app/data/.underchat-quarantine/wwebjs/worker-w'
    );
    expect(servicePrivate.getSessionGuardContext().lockRootPath).toBe(
      '/app/data/.underchat-locks/wwebjs/worker-w'
    );
  });

  it('purges quarantine only when session removal is explicitly requested', async () => {
    const preserved = makeService();
    const preservedPurge = jest.spyOn(
      preserved.servicePrivate,
      'purgeCurrentSessionQuarantine'
    );
    await preserved.service.disconnect({
      preserve_session: true,
      remove_session: false,
    });
    expect(preservedPurge).not.toHaveBeenCalled();

    const removed = makeService();
    jest
      .spyOn(removed.servicePrivate, 'clearFolder')
      .mockImplementation(() => undefined);
    const removedPurge = jest
      .spyOn(removed.servicePrivate, 'purgeCurrentSessionQuarantine')
      .mockImplementation(() => undefined);
    await removed.service.disconnect({
      preserve_session: true,
      remove_session: true,
    });
    expect(removed.servicePrivate.clearFolder).toHaveBeenCalledWith(true);
    expect(removedPurge).toHaveBeenCalledWith(true);
    expect(removed.centrifugo.publishSub).not.toHaveBeenCalled();
    expect(
      removed.balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).not.toHaveBeenCalled();
  });

  it('fails the explicit removal when local session cleanup is unconfirmed', async () => {
    const { service, servicePrivate } = makeService();
    jest.spyOn(servicePrivate, 'clearFolder').mockImplementation(() => {
      throw new Error('wwebjs_session_folder_cleanup_unconfirmed');
    });
    const purgeQuarantine = jest.spyOn(
      servicePrivate,
      'purgeCurrentSessionQuarantine'
    );

    await expect(
      service.disconnect({
        preserve_session: false,
        remove_session: true,
        disconnected_user: true,
      })
    ).rejects.toThrow('wwebjs_session_folder_cleanup_unconfirmed');
    expect(purgeQuarantine).not.toHaveBeenCalled();
  });

  it('retains the lifecycle lease and session data when browser termination cannot be confirmed', async () => {
    const { service, servicePrivate } = makeService();
    const client = {
      destroy: jest.fn(async () => undefined),
    };
    servicePrivate.client = client;
    const clearFolder = jest
      .spyOn(servicePrivate, 'clearFolder')
      .mockImplementation(() => undefined);
    jest
      .spyOn(servicePrivate, 'purgeCurrentSessionQuarantine')
      .mockImplementation(() => undefined);
    const purgeQuarantine = jest
      .spyOn(servicePrivate, 'purgeCurrentSessionQuarantine')
      .mockImplementation(() => undefined);
    const releaseLease = jest.mocked(
      servicePrivate.releaseSessionLifecycleLease
    );
    jest
      .spyOn(servicePrivate, 'destroyClientWithTimeout')
      .mockResolvedValue(false);

    await expect(
      service.disconnect({
        preserve_session: false,
        remove_session: true,
      })
    ).rejects.toThrow('wwebjs_browser_termination_unconfirmed');

    expect(servicePrivate.sessionLifecycleTerminationUnconfirmed).toBe(true);
    expect(clearFolder).not.toHaveBeenCalled();
    expect(purgeQuarantine).not.toHaveBeenCalled();
    expect(releaseLease).not.toHaveBeenCalled();
  });

  it('preserves the central status while an authenticated session waits for Kafka readiness', async () => {
    const { servicePrivate, balanceWorkerStatusGrpcClientService } =
      makeService();
    const pendingPayload: IBaileysConnectionState = {
      status: Status.connecting,
      code: ECodeMessage.awaitConnection,
      worker_id: 'worker-w',
      account_id: 'account-w',
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
      worker_id: 'worker-w',
      account_id: 'account-w',
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
        worker_id: 'worker-w',
        account_id: 'account-w',
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

  it('debounces a transient disconnect and cancels its central downgrade after provider recovery', async () => {
    const { servicePrivate, balanceWorkerStatusGrpcClientService } =
      makeService();
    const disconnectedPayload: IBaileysConnectionState = {
      status: Status.connecting,
      code: ECodeMessage.awaitConnection,
      worker_id: 'worker-w',
      account_id: 'account-w',
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
      'disconnected'
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
      'disconnected'
    );
    await jest.advanceTimersByTimeAsync(5_000);
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).toHaveBeenCalledTimes(1);
  });

  it('waits for native ready before using the state probe fallback', async () => {
    const { service, servicePrivate } = makeService();
    const client = {
      info: {
        wid: {
          _serialized: '5511999999999@c.us',
        },
      },
      getState: jest.fn(async () => 'CONNECTED'),
      pupPage: {
        evaluate: jest.fn(async () => true),
      },
      attachEventListeners: jest.fn(async () => undefined),
    };

    const confirmReadySpy = jest
      .spyOn(servicePrivate, 'confirmReadyAndMarkConnected')
      .mockResolvedValue(true);

    servicePrivate.client = client;
    servicePrivate.initialConnection = true;
    servicePrivate.status = Status.connecting;
    servicePrivate.connectionEstablished = false;
    servicePrivate.clientConnectionAttemptIds.set(client, 1);

    servicePrivate.startConnectionStateProbe(client, 1, null);

    await jest.advanceTimersByTimeAsync(25_000);

    expect(client.attachEventListeners).not.toHaveBeenCalled();
    expect(confirmReadySpy).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(5_000);

    expect(client.attachEventListeners).toHaveBeenCalledTimes(1);
    expect(confirmReadySpy).toHaveBeenCalledWith(
      client,
      1,
      null,
      'state_probe'
    );
  });

  it('reconciles immediately after a native ready event without resetting the generic 30-second grace', async () => {
    const { servicePrivate } = makeService();
    const client = {
      info: {
        wid: {
          _serialized: '5511999999999@c.us',
        },
      },
      getState: jest.fn(async () => 'CONNECTED'),
      pupPage: {
        evaluate: jest.fn(async () => true),
      },
      attachEventListeners: jest.fn(async () => undefined),
    };
    const confirmReadySpy = jest
      .spyOn(servicePrivate, 'confirmReadyAndMarkConnected')
      .mockResolvedValue(true);

    servicePrivate.client = client;
    servicePrivate.initialConnection = true;
    servicePrivate.status = Status.connecting;
    servicePrivate.connectionEstablished = false;
    servicePrivate.clientConnectionAttemptIds.set(client, 1);

    servicePrivate.startConnectionStateProbe(client, 1, null, false, true);

    await jest.advanceTimersByTimeAsync(499);
    expect(confirmReadySpy).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(client.attachEventListeners).toHaveBeenCalledTimes(1);
    expect(confirmReadySpy).toHaveBeenCalledWith(
      client,
      1,
      null,
      'state_probe'
    );
  });

  it('does not probe or terminate Chromium while client initialization is pending', async () => {
    const { servicePrivate } = makeService();
    let resolveInitialize!: () => void;
    const initializePromise = new Promise<void>((resolve) => {
      resolveInitialize = resolve;
    });
    const client = {
      getState: jest.fn(() => new Promise<string>(() => undefined)),
    };
    const forceTerminate = jest.spyOn(
      servicePrivate,
      'forceTerminateClientRuntimeWithoutSdkOverlap'
    );

    servicePrivate.client = client;
    servicePrivate.initialConnection = true;
    servicePrivate.status = Status.connecting;
    servicePrivate.connectionEstablished = false;
    servicePrivate.clientConnectionAttemptIds.set(client, 1);
    servicePrivate.trackClientInitialization(client, 1, initializePromise);

    servicePrivate.startConnectionStateProbe(client, 1, null);
    await jest.advanceTimersByTimeAsync(60_000);

    expect(client.getState).not.toHaveBeenCalled();
    expect(forceTerminate).not.toHaveBeenCalled();
    expect(servicePrivate.client).toBe(client);

    resolveInitialize();
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(5_000);

    expect(client.getState).toHaveBeenCalledTimes(1);
  });

  it('fences a never-settling initialize after its watchdog without SDK overlap', async () => {
    const { servicePrivate, healthCheckService, incomingMessageService } =
      makeService();
    const { childProcess, ownedBrowserProcess } =
      spawnOwnedBrowserTestProcess();
    const client = {
      destroy: jest.fn(async () => undefined),
      getState: jest.fn(async () => 'CONNECTED'),
      pupBrowser: undefined,
    };

    try {
      servicePrivate.client = client;
      servicePrivate.initialConnection = true;
      servicePrivate.connecting = true;
      servicePrivate.status = Status.connecting;
      servicePrivate.connectionEstablished = false;
      servicePrivate.activeConnectionAttemptId = 1;
      servicePrivate.clientConnectionAttemptIds.set(client, 1);
      servicePrivate.browserRuntimeClients.add(client);
      const lifecycle = servicePrivate.trackClientInitialization(
        client,
        1,
        new Promise<void>(() => undefined),
        210_000
      );
      servicePrivate.registerOwnedBrowserProcess(
        client,
        1,
        ownedBrowserProcess
      );
      const healthConfig = healthCheckService.configure.mock.calls[0]?.[0] as {
        isProviderProbeAllowed?: (candidate: object) => unknown;
      };

      expect(healthConfig.isProviderProbeAllowed?.(client)).toEqual({
        allowed: false,
        state: 'initializing',
      });

      await jest.advanceTimersByTimeAsync(180_000);
      expect(lifecycle.initializeState).toBe('pending');
      expect(ownedBrowserProcess.killRequested).toBe(false);
      expect(client.getState).not.toHaveBeenCalled();
      expect(client.destroy).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(29_999);
      expect(lifecycle.initializeState).toBe('pending');

      await jest.advanceTimersByTimeAsync(1);

      expect(lifecycle.initializeState).toBe('timed_out');
      expect(lifecycle.cancellationRequested).toBe(true);
      expect(ownedBrowserProcess.killRequested).toBe(true);
      expect(client.getState).not.toHaveBeenCalled();
      expect(client.destroy).not.toHaveBeenCalled();
      expect(servicePrivate.sessionLifecycleTerminationUnconfirmed).toBe(true);
      expect(
        incomingMessageService.markConnectionUnavailable
      ).toHaveBeenCalledWith(client);
      expect(healthConfig.isProviderProbeAllowed?.(client)).toEqual({
        allowed: false,
        state: 'initialization_timeout',
        processReplacementRequired: true,
      });

      jest.useRealTimers();
      await waitForChildExit(childProcess);
      await waitForOwnedBrowserProcessTermination(ownedBrowserProcess);
      expect(client.destroy).not.toHaveBeenCalled();
    } finally {
      forceTerminateOwnedTestProcess(childProcess);
    }
  });

  it('defers provider probes while the canonical activation checkpoint is in progress', async () => {
    const { servicePrivate, healthCheckService } = makeService();
    let checkpointInProgress = true;
    let activeRestartAttestationPending = false;
    const authStrategy = {
      getCanonicalActivationCheckpointState: () => ({
        inProgress: checkpointInProgress,
        generation: 7,
      }),
      isCanonicalActivationRecoveryRequired: () => false,
      isCanonicalActiveRestartAttestationPending: () =>
        activeRestartAttestationPending,
    };
    const client = {
      authStrategy,
      getState: jest.fn(async () => 'CONNECTED'),
    };

    servicePrivate.client = client;
    servicePrivate.clientConnectionAttemptIds.set(client, 1);
    servicePrivate.trackClientInitialization(client, 1, Promise.resolve());
    await jest.advanceTimersByTimeAsync(0);

    const healthConfig = healthCheckService.configure.mock.calls[0]?.[0] as {
      getCanonicalActivationCheckpointState?: (candidate: object) => unknown;
      isProviderProbeAllowed?: (candidate: object) => unknown;
    };

    expect(
      healthConfig.getCanonicalActivationCheckpointState?.(client)
    ).toEqual({ inProgress: true, generation: 7 });
    expect(healthConfig.isProviderProbeAllowed?.(client)).toEqual({
      allowed: false,
      state: 'canonical_activation_checkpoint',
    });
    expect(client.getState).not.toHaveBeenCalled();

    checkpointInProgress = false;
    activeRestartAttestationPending = true;

    expect(healthConfig.isProviderProbeAllowed?.(client)).toEqual({
      allowed: false,
      state: 'canonical_activation_checkpoint',
    });

    activeRestartAttestationPending = false;

    expect(healthConfig.isProviderProbeAllowed?.(client)).toBe(true);
  });

  it('keeps a recurrent state probe singleflight when a canonical checkpoint crosses its deadline', async () => {
    const { servicePrivate } = makeService();
    let checkpointState = { inProgress: false, generation: 0 };
    let resolveInitialProbe!: (state: string) => void;
    const client = {
      authStrategy: {
        getCanonicalActivationCheckpointState: () => checkpointState,
      },
      getState: jest
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<string>((resolve) => {
              resolveInitialProbe = resolve;
            })
        )
        .mockResolvedValue('CONNECTED'),
    };
    const forceTerminate = jest.spyOn(
      servicePrivate,
      'forceTerminateClientRuntimeWithoutSdkOverlap'
    );
    const scheduleRetry = jest.spyOn(
      servicePrivate,
      'scheduleNextReconnectAttempt'
    );

    servicePrivate.client = client;
    servicePrivate.initialConnection = true;
    servicePrivate.status = Status.connecting;
    servicePrivate.connectionEstablished = false;
    servicePrivate.clientConnectionAttemptIds.set(client, 1);
    servicePrivate.startConnectionStateProbe(client, 1, null);

    await jest.advanceTimersByTimeAsync(5_000);
    expect(client.getState).toHaveBeenCalledTimes(1);

    checkpointState = { inProgress: true, generation: 1 };
    checkpointState = { inProgress: false, generation: 1 };
    await jest.advanceTimersByTimeAsync(10_000);

    expect(forceTerminate).not.toHaveBeenCalled();
    expect(scheduleRetry).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(5_000);
    expect(client.getState).toHaveBeenCalledTimes(1);
    expect(forceTerminate).not.toHaveBeenCalled();

    resolveInitialProbe('CONNECTED');
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(5_000);

    expect(client.getState).toHaveBeenCalledTimes(2);
    expect(forceTerminate).not.toHaveBeenCalled();
    expect(scheduleRetry).not.toHaveBeenCalled();
  });

  it('recovers once when a checkpoint-overlapped state probe misses its post-checkpoint drain deadline', async () => {
    const { servicePrivate } = makeService();
    let checkpointState = { inProgress: false, generation: 0 };
    let resolveInitialProbe!: (state: string) => void;
    const client = {
      authStrategy: {
        getCanonicalActivationCheckpointState: () => checkpointState,
      },
      getState: jest.fn(
        () =>
          new Promise<string>((resolve) => {
            resolveInitialProbe = resolve;
          })
      ),
    };
    const forceTerminate = jest
      .spyOn(servicePrivate, 'forceTerminateClientRuntimeWithoutSdkOverlap')
      .mockResolvedValue(true);
    const scheduleRetry = jest
      .spyOn(servicePrivate, 'scheduleNextReconnectAttempt')
      .mockImplementation(() => undefined);

    servicePrivate.client = client;
    servicePrivate.initialConnection = true;
    servicePrivate.status = Status.connecting;
    servicePrivate.connectionEstablished = false;
    servicePrivate.clientConnectionAttemptIds.set(client, 1);
    servicePrivate.startConnectionStateProbe(client, 1, null);

    await jest.advanceTimersByTimeAsync(5_000);
    checkpointState = { inProgress: true, generation: 1 };
    checkpointState = { inProgress: false, generation: 1 };
    await jest.advanceTimersByTimeAsync(20_000);

    expect(client.getState).toHaveBeenCalledTimes(1);
    expect(forceTerminate).toHaveBeenCalledTimes(1);
    expect(forceTerminate).toHaveBeenCalledWith(
      client,
      'connection_state_probe_stalled'
    );
    expect(scheduleRetry).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(60_000);
    expect(forceTerminate).toHaveBeenCalledTimes(1);
    expect(scheduleRetry).toHaveBeenCalledTimes(1);

    const replacementEntry = {
      token: Symbol('replacement-owner'),
      checkpointGeneration: 2,
      deferredAtMs: Date.now(),
      providerCall: Promise.resolve(),
    };
    servicePrivate.canonicalCheckpointDeferredProviderCalls.set(
      client,
      replacementEntry
    );
    resolveInitialProbe('CONNECTED');
    await jest.advanceTimersByTimeAsync(0);

    expect(
      servicePrivate.canonicalCheckpointDeferredProviderCalls.get(client)
    ).toBe(replacementEntry);
  });

  it('defers a state-probe rejection when a canonical checkpoint crossed the call', async () => {
    const { servicePrivate } = makeService();
    let checkpointState = { inProgress: false, generation: 0 };
    let rejectInitialProbe!: (error: Error) => void;
    const client = {
      authStrategy: {
        getCanonicalActivationCheckpointState: () => checkpointState,
      },
      getState: jest
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<string>((_resolve, reject) => {
              rejectInitialProbe = reject;
            })
        )
        .mockResolvedValue('CONNECTED'),
    };
    const forceTerminate = jest.spyOn(
      servicePrivate,
      'forceTerminateClientRuntimeWithoutSdkOverlap'
    );

    servicePrivate.client = client;
    servicePrivate.initialConnection = true;
    servicePrivate.status = Status.connecting;
    servicePrivate.connectionEstablished = false;
    servicePrivate.clientConnectionAttemptIds.set(client, 1);
    servicePrivate.startConnectionStateProbe(client, 1, null);

    await jest.advanceTimersByTimeAsync(5_000);
    checkpointState = { inProgress: true, generation: 1 };
    checkpointState = { inProgress: false, generation: 1 };
    rejectInitialProbe(new Error('Execution context was destroyed'));
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(5_000);

    expect(client.getState).toHaveBeenCalledTimes(2);
    expect(forceTerminate).not.toHaveBeenCalled();
  });

  it('rearms a state probe after an already-active canonical checkpoint settles', async () => {
    const { servicePrivate } = makeService();
    let checkpointState = { inProgress: true, generation: 3 };
    const client = {
      authStrategy: {
        getCanonicalActivationCheckpointState: () => checkpointState,
      },
      getState: jest.fn(async () => 'CONNECTED'),
    };
    const forceTerminate = jest.spyOn(
      servicePrivate,
      'forceTerminateClientRuntimeWithoutSdkOverlap'
    );

    servicePrivate.client = client;
    servicePrivate.initialConnection = true;
    servicePrivate.status = Status.connecting;
    servicePrivate.connectionEstablished = false;
    servicePrivate.clientConnectionAttemptIds.set(client, 1);
    servicePrivate.startConnectionStateProbe(client, 1, null);

    await jest.advanceTimersByTimeAsync(125_000);
    expect(client.getState).not.toHaveBeenCalled();
    expect(forceTerminate).not.toHaveBeenCalled();

    checkpointState = { inProgress: false, generation: 3 };
    await jest.advanceTimersByTimeAsync(5_000);

    expect(client.getState).toHaveBeenCalledTimes(1);
    expect(forceTerminate).not.toHaveBeenCalled();
  });

  it('retains destructive stalled-probe recovery after initialization completes', async () => {
    const { servicePrivate } = makeService();
    const client = {
      getState: jest.fn(() => new Promise<string>(() => undefined)),
    };
    const forceTerminate = jest
      .spyOn(servicePrivate, 'forceTerminateClientRuntimeWithoutSdkOverlap')
      .mockResolvedValue(true);
    const scheduleRetry = jest
      .spyOn(servicePrivate, 'scheduleNextReconnectAttempt')
      .mockImplementation(() => undefined);

    servicePrivate.client = client;
    servicePrivate.initialConnection = true;
    servicePrivate.status = Status.connecting;
    servicePrivate.connectionEstablished = false;
    servicePrivate.clientConnectionAttemptIds.set(client, 1);
    servicePrivate.trackClientInitialization(client, 1, Promise.resolve());
    servicePrivate.startConnectionStateProbe(client, 1, null);

    await jest.advanceTimersByTimeAsync(15_000);

    expect(client.getState).toHaveBeenCalledTimes(1);
    expect(forceTerminate).toHaveBeenCalledWith(
      client,
      'connection_state_probe_stalled'
    );
    expect(scheduleRetry).toHaveBeenCalledWith(true);
  });

  it('does not probe a client whose initialization completed after cancellation', async () => {
    const { servicePrivate, healthCheckService } = makeService();
    let resolveInitialize!: () => void;
    const initializePromise = new Promise<void>((resolve) => {
      resolveInitialize = resolve;
    });
    const client = {
      getState: jest.fn(() => new Promise<string>(() => undefined)),
    };

    servicePrivate.client = client;
    servicePrivate.initialConnection = true;
    servicePrivate.status = Status.connecting;
    servicePrivate.connectionEstablished = false;
    servicePrivate.clientConnectionAttemptIds.set(client, 1);
    const lifecycle = servicePrivate.trackClientInitialization(
      client,
      1,
      initializePromise
    );
    lifecycle.cancellationRequested = true;

    resolveInitialize();
    await jest.advanceTimersByTimeAsync(0);
    servicePrivate.startConnectionStateProbe(client, 1, null);
    await jest.advanceTimersByTimeAsync(60_000);

    expect(lifecycle.initializeState).toBe('completed');
    expect(client.getState).not.toHaveBeenCalled();
    const healthConfig = healthCheckService.configure.mock.calls[0]?.[0] as {
      isProviderProbeAllowed?: (candidate: object) => unknown;
    };
    expect(healthConfig.isProviderProbeAllowed?.(client)).toEqual({
      allowed: false,
      state: 'cancellation_requested',
      processReplacementRequired: false,
    });
  });

  it('fences a client whose recurrent state probe never settles and recreates without SDK teardown overlap', async () => {
    const { servicePrivate } = makeService();
    let rejectLate!: (error: Error) => void;
    const client = {
      getState: jest.fn(
        () =>
          new Promise<string>((_resolve, reject) => {
            rejectLate = reject;
          })
      ),
      destroy: jest.fn(async () => undefined),
    };
    const forceTerminate = jest
      .spyOn(servicePrivate, 'forceTerminateClientRuntimeWithoutSdkOverlap')
      .mockResolvedValue(true);
    const scheduleRetry = jest
      .spyOn(servicePrivate, 'scheduleNextReconnectAttempt')
      .mockImplementation(() => undefined);

    servicePrivate.client = client;
    servicePrivate.initialConnection = true;
    servicePrivate.status = Status.connecting;
    servicePrivate.connectionEstablished = false;
    servicePrivate.clientConnectionAttemptIds.set(client, 1);

    servicePrivate.startConnectionStateProbe(client, 1, null);
    await jest.advanceTimersByTimeAsync(15_000);

    expect(client.getState).toHaveBeenCalledTimes(1);
    expect(client.destroy).not.toHaveBeenCalled();
    expect(forceTerminate).toHaveBeenCalledTimes(1);
    expect(forceTerminate).toHaveBeenCalledWith(
      client,
      'connection_state_probe_stalled'
    );
    expect(servicePrivate.client).toBeUndefined();
    expect(scheduleRetry).toHaveBeenCalledTimes(1);
    expect(scheduleRetry).toHaveBeenCalledWith(true);

    await jest.advanceTimersByTimeAsync(60_000);
    expect(client.getState).toHaveBeenCalledTimes(1);
    expect(forceTerminate).toHaveBeenCalledTimes(1);

    rejectLate(new Error('late state probe rejection'));
    await jest.advanceTimersByTimeAsync(0);
    expect(console.warn).toHaveBeenCalledWith(
      '[WhatsappProviderAuxiliary] operation_rejected_after_timeout',
      expect.objectContaining({
        provider: 'wwebjs',
        operation: 'connection_state_probe',
        timeout_ms: 10_000,
      })
    );
  });

  it('defers a state probe under provider capacity without recreating Chromium', async () => {
    const { servicePrivate } = makeService();
    const client = {
      getState: jest.fn(async () => 'CONNECTED'),
    };
    const admission = new ProviderInvocationSingleFlight();
    const leases = Array.from({ length: 4 }, () => admission.acquire(client));
    const forceTerminate = jest.spyOn(
      servicePrivate,
      'forceTerminateClientRuntimeWithoutSdkOverlap'
    );
    const scheduleRetry = jest.spyOn(
      servicePrivate,
      'scheduleNextReconnectAttempt'
    );

    servicePrivate.client = client;
    servicePrivate.initialConnection = true;
    servicePrivate.status = Status.connecting;
    servicePrivate.connectionEstablished = false;
    servicePrivate.clientConnectionAttemptIds.set(client, 1);

    try {
      servicePrivate.startConnectionStateProbe(client, 1, null);
      await jest.advanceTimersByTimeAsync(5_000);

      expect(client.getState).not.toHaveBeenCalled();
      expect(forceTerminate).not.toHaveBeenCalled();
      expect(scheduleRetry).not.toHaveBeenCalled();
      expect(servicePrivate.client).toBe(client);
      expect(servicePrivate.status).toBe(Status.connecting);
    } finally {
      leases.forEach((lease) => lease?.releaseBeforeStart());
    }
  });

  it('requires a continuous unpaired window before handling a stale restore', async () => {
    const { service, servicePrivate } = makeService();
    const client = {
      getState: jest.fn(async () => 'UNPAIRED'),
      destroy: jest.fn(async () => undefined),
    };

    servicePrivate.client = client;
    servicePrivate.initialConnection = true;
    servicePrivate.status = Status.connecting;
    servicePrivate.connectionEstablished = false;
    servicePrivate.qrReadSessionActive = false;
    servicePrivate.clientConnectionAttemptIds.set(client, 1);
    jest.spyOn(service, 'hasSession').mockReturnValue(true);
    const handlePersistentUnpaired = jest
      .spyOn(servicePrivate, 'handlePersistentUnpaired')
      .mockResolvedValue(undefined);

    servicePrivate.startConnectionStateProbe(client, 1, null);

    await jest.advanceTimersByTimeAsync(34_999);
    expect(handlePersistentUnpaired).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(handlePersistentUnpaired).toHaveBeenCalledTimes(1);
    expect(handlePersistentUnpaired).toHaveBeenCalledWith(
      client,
      1,
      'UNPAIRED'
    );
  });

  it('does not classify an authenticated QR pairing as a stale restore while readiness is pending', async () => {
    const { service, servicePrivate } = makeService();
    const client = {
      getState: jest.fn(async () => 'UNPAIRED'),
      destroy: jest.fn(async () => undefined),
    };

    servicePrivate.client = client;
    servicePrivate.initialConnection = true;
    servicePrivate.status = Status.connecting;
    servicePrivate.connectionEstablished = false;
    servicePrivate.qrReadSessionActive = false;
    servicePrivate.qrReadSessionLocked = true;
    servicePrivate.clientConnectionAttemptIds.set(client, 1);
    jest.spyOn(service, 'hasSession').mockReturnValue(true);
    const handlePersistentUnpaired = jest
      .spyOn(servicePrivate, 'handlePersistentUnpaired')
      .mockResolvedValue(undefined);
    const scheduleRetry = jest
      .spyOn(servicePrivate, 'scheduleNextReconnectAttempt')
      .mockImplementation(() => undefined);

    servicePrivate.startConnectionStateProbe(client, 1, null);
    await jest.advanceTimersByTimeAsync(60_000);

    expect(handlePersistentUnpaired).not.toHaveBeenCalled();
    expect(servicePrivate.qrReadSessionLocked).toBe(true);

    await jest.advanceTimersByTimeAsync(60_000);

    expect(handlePersistentUnpaired).not.toHaveBeenCalled();
    expect(servicePrivate.qrReadSessionLocked).toBe(false);
    expect(scheduleRetry).toHaveBeenCalledWith(true);
  });

  it('quarantines an unpaired restore after the bounded failure budget and requires QR', async () => {
    const { servicePrivate, balanceWorkerStatusGrpcClientService } =
      makeService();
    const client = {
      destroy: jest.fn(async () => undefined),
    };

    servicePrivate.client = client;
    servicePrivate.initialConnection = true;
    servicePrivate.connecting = true;
    servicePrivate.status = Status.connecting;
    servicePrivate.activeConnectionAttemptId = 1;
    servicePrivate.clientConnectionAttemptIds.set(client, 1);

    jest
      .spyOn(servicePrivate, 'recordSessionRestoreFailure')
      .mockReturnValue({ failures: 3, maxAttempts: 3 });
    const quarantine = jest
      .spyOn(servicePrivate, 'quarantineCurrentSession')
      .mockReturnValue({
        blocked: true,
        moved: true,
        quarantinePath: '/quarantine/session-worker-w',
      });
    const scheduleRetry = jest.spyOn(
      servicePrivate,
      'scheduleNextReconnectAttempt'
    );

    await servicePrivate.handlePersistentUnpaired(client, 1, 'UNPAIRED');

    expect(client.destroy).toHaveBeenCalledTimes(1);
    expect(quarantine).toHaveBeenCalledWith(
      'persistent_unpaired_restore_exhausted'
    );
    expect(scheduleRetry).not.toHaveBeenCalled();
    expect(servicePrivate.sessionRestoreBlocked).toBe(true);
    expect(servicePrivate.status).toBe(Status.disconnected);
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        provider_state: 'QR_REQUIRED',
        reason: 'stale_session_restore_exhausted',
        attempt: 3,
        max_attempts: 3,
      })
    );
  });

  it('fails terminally and destroys the client when ready cannot commit the session activation fence', async () => {
    const {
      servicePrivate,
      balanceWorkerStatusGrpcClientService,
      incomingMessageService,
    } = makeService();
    const client = {
      info: {
        wid: {
          _serialized: '5511999999999@c.us',
        },
      },
      destroy: jest.fn(async () => undefined),
    };

    servicePrivate.client = client;
    servicePrivate.initialConnection = true;
    servicePrivate.connecting = true;
    servicePrivate.status = Status.connecting;
    servicePrivate.activeConnectionAttemptId = 1;
    servicePrivate.clientConnectionAttemptIds.set(client, 1);
    jest
      .mocked(servicePrivate.markProviderSessionValidated)
      .mockReturnValue(false);

    await expect(
      servicePrivate.confirmReadyAndMarkConnected(client, 1, null, 'ready')
    ).resolves.toBe(false);

    expect(client.destroy).toHaveBeenCalledTimes(1);
    expect(incomingMessageService.unbind).toHaveBeenCalled();
    expect(servicePrivate.sessionRestoreBlocked).toBe(true);
    expect(servicePrivate.status).toBe(Status.disconnected);
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        provider_state: 'SESSION_ACTIVATION_FENCED',
        reason: 'session_activation_fenced',
      })
    );
  });

  it('treats a held lifecycle lock as transient and schedules a bounded retry', async () => {
    const { servicePrivate } = makeService();
    servicePrivate.initialConnection = true;
    servicePrivate.status = Status.disconnected;
    jest
      .mocked(servicePrivate.acquireSessionLifecycleLease)
      .mockReturnValue('wwebjs_session_lifecycle_lock_busy');
    const createClient = jest.spyOn(servicePrivate, 'createAndWaitClient');

    await expect(servicePrivate.startConnection()).resolves.toEqual(
      expect.objectContaining({
        status: Status.connecting,
        provider_state: 'SESSION_LOCK_BUSY',
        reason: 'session_lifecycle_lock_busy',
      })
    );

    expect(createClient).not.toHaveBeenCalled();
    expect(servicePrivate.sessionRestoreBlocked).toBe(false);
    expect(servicePrivate.sessionLockRetryCount).toBe(1);
    expect(servicePrivate.disconnectRetryTimer).toBeDefined();
  });

  it('fences a late teardown from mutating or releasing a replacement lifecycle lease', async () => {
    const { servicePrivate } = makeService();
    jest.mocked(servicePrivate.withSessionLifecycleLease).mockRestore();
    jest.mocked(servicePrivate.releaseSessionLifecycleLease).mockRestore();

    const oldRelease = jest.fn();
    const replacementRelease = jest.fn();
    servicePrivate.sessionLifecycleLease = {
      ownerToken: 'old-owner',
      released: false,
      release: oldRelease,
    };
    let finishLateTeardown: (() => void) | undefined;
    const lateTeardownGate = new Promise<void>((resolve) => {
      finishLateTeardown = resolve;
    });
    const staleMutation = jest.fn();

    servicePrivate.queueTeardown('late_teardown', async () => {
      await lateTeardownGate;
      servicePrivate.withSessionLifecycleLease(staleMutation);
      return true;
    });
    servicePrivate.sessionLifecycleLease = {
      ownerToken: 'replacement-owner',
      released: false,
      release: replacementRelease,
    };
    finishLateTeardown?.();
    await servicePrivate.teardownPromise;

    expect(staleMutation).not.toHaveBeenCalled();
    expect(replacementRelease).not.toHaveBeenCalled();
    expect(servicePrivate.sessionLifecycleLease?.ownerToken).toBe(
      'replacement-owner'
    );
  });

  it('keeps an unconfirmed termination fence sticky after a later successful teardown', async () => {
    const { servicePrivate } = makeService();
    jest.mocked(servicePrivate.releaseSessionLifecycleLease).mockRestore();

    const release = jest.fn();
    servicePrivate.sessionLifecycleLease = {
      ownerToken: 'runtime-owner',
      released: false,
      release,
    };

    servicePrivate.queueTeardown('unconfirmed_runtime', async () => false);
    await servicePrivate.teardownPromise;

    expect(servicePrivate.sessionLifecycleTerminationUnconfirmed).toBe(true);
    expect(release).not.toHaveBeenCalled();

    servicePrivate.queueTeardown('later_confirmed_runtime', async () => true);
    await servicePrivate.teardownPromise;

    expect(servicePrivate.sessionLifecycleTerminationUnconfirmed).toBe(true);
    expect(release).not.toHaveBeenCalled();
    expect(servicePrivate.sessionLifecycleLease?.ownerToken).toBe(
      'runtime-owner'
    );
  });

  it('refuses to release the lifecycle lease while a tracked browser runtime remains', () => {
    const { servicePrivate } = makeService();
    jest.mocked(servicePrivate.releaseSessionLifecycleLease).mockRestore();

    const release = jest.fn();
    const client = {};
    servicePrivate.sessionLifecycleLease = {
      ownerToken: 'runtime-owner',
      released: false,
      release,
    };
    servicePrivate.browserRuntimeClients.add(client);

    servicePrivate.releaseSessionLifecycleLease();

    expect(release).not.toHaveBeenCalled();
    expect(servicePrivate.sessionLifecycleLease?.ownerToken).toBe(
      'runtime-owner'
    );

    servicePrivate.browserRuntimeClients.delete(client);
    servicePrivate.releaseSessionLifecycleLease();

    expect(release).toHaveBeenCalledTimes(1);
    expect(servicePrivate.sessionLifecycleLease).toBeUndefined();
  });

  it('does not clear a sticky termination fence when a client destroy later succeeds', async () => {
    const { servicePrivate } = makeService();
    const client = {
      destroy: jest.fn(async () => undefined),
    };
    const requestTermination = jest.spyOn(
      servicePrivate,
      'requestOwnedBrowserProcessTermination'
    );
    servicePrivate.sessionLifecycleTerminationUnconfirmed = true;

    await expect(
      servicePrivate.destroyClientWithTimeout(client, 'later_destroy')
    ).resolves.toBe(true);

    expect(servicePrivate.sessionLifecycleTerminationUnconfirmed).toBe(true);
    expect(requestTermination).not.toHaveBeenCalled();
  });

  it('normalizes a connected singleton to disconnected before shutdown destroys its browser', async () => {
    const { service, servicePrivate } = makeService();
    const client = {
      destroy: jest.fn(async () => undefined),
    };
    servicePrivate.client = client;
    servicePrivate.clientConnectionAttemptIds.set(client, 4);
    servicePrivate.browserRuntimeClients.add(client);
    servicePrivate.status = Status.connected;
    servicePrivate.connectionEstablished = true;
    servicePrivate.connecting = false;
    servicePrivate.centralOnlineAcknowledged = true;
    setWorkerKafkaDispatchAuthorized(true);

    await expect(service.shutdown()).resolves.toBeUndefined();

    expect(client.destroy).toHaveBeenCalledTimes(1);
    expect(servicePrivate.client).toBeUndefined();
    expect(servicePrivate.status).toBe(Status.disconnected);
    expect(servicePrivate.connectionEstablished).toBe(false);
    expect(servicePrivate.centralOnlineAcknowledged).toBe(false);
    expect(isWorkerKafkaDispatchAuthorized()).toBe(false);
  });

  it('fences a timed-out destroy before its late shutdown can reuse the native store', async () => {
    const { service, servicePrivate } = makeService();
    let finishDestroy: (() => void) | undefined;
    const client = {
      destroy: jest.fn(
        () =>
          new Promise<void>((resolve) => {
            finishDestroy = resolve;
          })
      ),
    };
    const requestTermination = jest.spyOn(
      servicePrivate,
      'requestOwnedBrowserProcessTermination'
    );
    const refreshPostgresSessionState = jest
      .spyOn(servicePrivate, 'refreshPostgresSessionState')
      .mockResolvedValue(undefined);
    const getPostgresSessionStore = jest.spyOn(
      servicePrivate,
      'getPostgresSessionStore'
    );

    servicePrivate.client = client;
    servicePrivate.initialConnection = true;
    servicePrivate.status = Status.connected;
    servicePrivate.connectionEstablished = true;

    const destroying = servicePrivate.destroyClientWithTimeout(
      client,
      'late_remote_auth_shutdown'
    );
    await jest.advanceTimersByTimeAsync(0);

    expect(client.destroy).toHaveBeenCalledTimes(1);
    expect(requestTermination).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(14_999);
    expect(requestTermination).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    await expect(destroying).resolves.toBe(false);

    expect(requestTermination).toHaveBeenCalledTimes(1);
    expect(servicePrivate.sessionLifecycleTerminationUnconfirmed).toBe(true);
    expect(hasWwebjsProviderProcessReplacementRequirement()).toBe(true);

    await expect(
      service.connect({
        initial_connection: true,
        allow_restore: true,
        runtime_generation: 3,
      })
    ).resolves.toEqual(
      expect.objectContaining({
        status: Status.disconnected,
        provider_state: 'BROWSER_TERMINATION_UNCONFIRMED',
        error: 'wwebjs_provider_process_replacement_required',
      })
    );
    expect(refreshPostgresSessionState).not.toHaveBeenCalled();
    expect(getPostgresSessionStore).not.toHaveBeenCalled();
    expect(mockWwebjsInitialize).not.toHaveBeenCalled();

    finishDestroy?.();
    await jest.advanceTimersByTimeAsync(0);

    expect(client.destroy).toHaveBeenCalledTimes(1);
    expect(refreshPostgresSessionState).not.toHaveBeenCalled();
    expect(getPostgresSessionStore).not.toHaveBeenCalled();
    expect(mockWwebjsInitialize).not.toHaveBeenCalled();
  });

  it('never signals or releases an untracked browser process returned by Puppeteer', async () => {
    jest.useRealTimers();
    const { servicePrivate } = makeService();
    const marker = `--external-browser=${randomUUID()}`;
    const externalProcess = spawn(
      process.execPath,
      ['-e', 'setInterval(() => undefined, 1000)', marker],
      {
        detached: true,
        stdio: 'ignore',
      }
    );
    const processKill = jest.spyOn(process, 'kill');
    const childKill = jest.spyOn(externalProcess, 'kill');
    const browser = {
      isConnected: jest.fn(() => true),
      process: jest.fn(() => externalProcess),
    };
    const client = {
      pupBrowser: browser,
      destroy: jest.fn(async () => undefined),
    };
    servicePrivate.browserRuntimeClients.add(client);

    try {
      await expect(
        servicePrivate.destroyClientWithTimeout(
          client,
          'untracked_browser_process'
        )
      ).resolves.toBe(false);

      expect(processKill).not.toHaveBeenCalled();
      expect(childKill).not.toHaveBeenCalled();
      expect(externalProcess.exitCode).toBeNull();
      expect(externalProcess.signalCode).toBeNull();
      expect(servicePrivate.browserRuntimeClients.has(client)).toBe(true);
      expect(servicePrivate.sessionLifecycleTerminationUnconfirmed).toBe(true);
    } finally {
      processKill.mockRestore();
      childKill.mockRestore();
      forceTerminateOwnedTestProcess(externalProcess);
      await waitForChildExit(externalProcess);
    }
  });

  it('destroys a browser assigned by initialize after disconnect was requested', async () => {
    const { service, servicePrivate } = makeService();
    let resolveInitialize: (() => void) | undefined;
    const initializePromise = new Promise<void>((resolve) => {
      resolveInitialize = resolve;
    });
    let browserConnected = true;
    const browser = {
      isConnected: jest.fn(() => browserConnected),
      process: jest.fn(() => null),
    };
    const client = {
      pupBrowser: undefined as typeof browser | undefined,
      destroy: jest.fn(async () => {
        browserConnected = false;
      }),
    };

    servicePrivate.client = client;
    servicePrivate.browserRuntimeClients.add(client);
    servicePrivate.clientConnectionAttemptIds.set(client, 1);
    servicePrivate.activeConnectionAttemptId = 1;
    servicePrivate.trackClientInitialization(client, 1, initializePromise);

    const disconnecting = service.disconnect({ preserve_session: true });
    await jest.advanceTimersByTimeAsync(0);

    expect(client.destroy).not.toHaveBeenCalled();
    expect(servicePrivate.browserRuntimeClients.has(client)).toBe(true);

    client.pupBrowser = browser;
    resolveInitialize?.();
    await disconnecting;

    expect(client.destroy).toHaveBeenCalledTimes(1);
    expect(browser.isConnected).toHaveBeenCalled();
    expect(servicePrivate.browserRuntimeClients.has(client)).toBe(false);
  });

  it('kills an owned browser child that initialize rejects before assigning to pupBrowser', async () => {
    jest.useRealTimers();
    const { service, servicePrivate } = makeService();
    const { childProcess, ownedBrowserProcess } =
      spawnOwnedBrowserTestProcess();
    const client = {
      pupBrowser: undefined,
      destroy: jest.fn(async () => undefined),
    };
    let rejectInitialize: ((error: Error) => void) | undefined;
    const initializePromise = new Promise<void>((_resolve, reject) => {
      rejectInitialize = reject;
    });

    try {
      servicePrivate.client = client;
      servicePrivate.browserRuntimeClients.add(client);
      servicePrivate.clientConnectionAttemptIds.set(client, 1);
      servicePrivate.activeConnectionAttemptId = 1;
      servicePrivate.trackClientInitialization(client, 1, initializePromise);
      servicePrivate.registerOwnedBrowserProcess(
        client,
        1,
        ownedBrowserProcess
      );

      const disconnecting = service.disconnect({ preserve_session: true });
      await Promise.resolve();
      expect(ownedBrowserProcess.killRequested).toBe(false);

      rejectInitialize?.(new Error('browser launch aborted before assignment'));
      await disconnecting;
      await waitForChildExit(childProcess);
      await waitForOwnedBrowserProcessTermination(ownedBrowserProcess);

      expect(ownedBrowserProcess.killRequested).toBe(true);
      expect(isWwebjsOwnedBrowserProcessTerminated(ownedBrowserProcess)).toBe(
        true
      );
      expect(client.destroy).toHaveBeenCalledTimes(1);
      expect(servicePrivate.browserRuntimeClients.has(client)).toBe(false);
    } finally {
      forceTerminateOwnedTestProcess(childProcess);
    }
  });

  it('kills a pre-assignment browser child but stays fenced when initialize never settles', async () => {
    const { servicePrivate } = makeService();
    jest.mocked(servicePrivate.releaseSessionLifecycleLease).mockRestore();
    const { childProcess, ownedBrowserProcess } =
      spawnOwnedBrowserTestProcess();
    const leaseRelease = jest.fn();
    const client = {
      pupBrowser: undefined,
      destroy: jest.fn(async () => undefined),
    };

    try {
      servicePrivate.sessionLifecycleLease = {
        ownerToken: 'pre-assignment-owner',
        released: false,
        release: leaseRelease,
      };
      servicePrivate.sessionLifecycleLeaseGeneration = 1;
      servicePrivate.browserRuntimeClients.add(client);
      servicePrivate.trackClientInitialization(
        client,
        1,
        new Promise<void>(() => {})
      );
      servicePrivate.registerOwnedBrowserProcess(
        client,
        1,
        ownedBrowserProcess
      );

      const destroying = servicePrivate.destroyClientWithTimeout(
        client,
        'pre_assignment_initialize_timeout'
      );
      await jest.advanceTimersByTimeAsync(15_000);
      await waitForChildExit(childProcess);
      await jest.advanceTimersByTimeAsync(100);

      await expect(destroying).resolves.toBe(false);
      servicePrivate.releaseSessionLifecycleLease();
      jest.useRealTimers();
      await waitForOwnedBrowserProcessTermination(ownedBrowserProcess);

      expect(ownedBrowserProcess.killRequested).toBe(true);
      expect(isWwebjsOwnedBrowserProcessTerminated(ownedBrowserProcess)).toBe(
        true
      );
      expect(client.destroy).not.toHaveBeenCalled();
      expect(servicePrivate.browserRuntimeClients.has(client)).toBe(true);
      expect(servicePrivate.sessionLifecycleTerminationUnconfirmed).toBe(true);
      expect(servicePrivate.sessionLifecycleLease?.ownerToken).toBe(
        'pre-assignment-owner'
      );
      expect(leaseRelease).not.toHaveBeenCalled();
    } finally {
      forceTerminateOwnedTestProcess(childProcess);
    }
  });

  it('keeps the client, lease, and sticky fence when initialize settlement times out', async () => {
    const { servicePrivate } = makeService();
    jest.mocked(servicePrivate.releaseSessionLifecycleLease).mockRestore();

    const leaseRelease = jest.fn();
    servicePrivate.sessionLifecycleLease = {
      ownerToken: 'initialize-owner',
      released: false,
      release: leaseRelease,
    };
    servicePrivate.sessionLifecycleLeaseGeneration = 1;
    const client = {
      destroy: jest.fn(async () => undefined),
    };
    const initializePromise = new Promise<void>(() => {});
    servicePrivate.browserRuntimeClients.add(client);
    servicePrivate.trackClientInitialization(client, 1, initializePromise);

    const destroying = servicePrivate.destroyClientWithTimeout(
      client,
      'initialize_timeout'
    );
    await jest.advanceTimersByTimeAsync(15_000);

    await expect(destroying).resolves.toBe(false);
    servicePrivate.releaseSessionLifecycleLease();

    expect(client.destroy).not.toHaveBeenCalled();
    expect(servicePrivate.browserRuntimeClients.has(client)).toBe(true);
    expect(servicePrivate.sessionLifecycleTerminationUnconfirmed).toBe(true);
    expect(servicePrivate.sessionLifecycleLease?.ownerToken).toBe(
      'initialize-owner'
    );
    expect(leaseRelease).not.toHaveBeenCalled();
  });

  it('fences a stale initialize error after a replacement lease starts', async () => {
    const { servicePrivate, healthCheckService } = makeService();
    jest.mocked(servicePrivate.releaseSessionLifecycleLease).mockRestore();

    const oldRelease = jest.fn();
    const replacementRelease = jest.fn();
    servicePrivate.sessionLifecycleLease = {
      ownerToken: 'initialize-owner',
      released: false,
      release: oldRelease,
    };
    servicePrivate.sessionLifecycleLeaseGeneration = 1;
    servicePrivate.runtimeGeneration = 41;
    const oldClient = {
      destroy: jest.fn(async () => undefined),
    };
    servicePrivate.client = oldClient;
    servicePrivate.browserRuntimeClients.add(oldClient);
    servicePrivate.clientConnectionAttemptIds.set(oldClient, 1);
    servicePrivate.activeConnectionAttemptId = 1;
    servicePrivate.connecting = true;
    servicePrivate.trackClientInitialization(oldClient, 1, Promise.resolve());

    let releaseHealthNotification: (() => void) | undefined;
    healthCheckService.notifyDisconnected.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        releaseHealthNotification = resolve;
      })
    );
    const clearChromiumProfileLock = jest
      .spyOn(servicePrivate, 'clearChromiumProfileLock')
      .mockImplementation(() => undefined);
    const handleNonTransientInitializeError = jest
      .spyOn(servicePrivate, 'handleNonTransientInitializeError')
      .mockImplementation(() => undefined);

    const handling = servicePrivate.handleInitializeError(
      'unexpected initialize failure',
      oldClient,
      1
    );
    await servicePrivate.waitForPendingTeardown();

    expect(oldRelease).toHaveBeenCalledTimes(1);
    expect(clearChromiumProfileLock).toHaveBeenCalledTimes(1);

    const replacementClient = {};
    servicePrivate.sessionLifecycleLease = {
      ownerToken: 'replacement-owner',
      released: false,
      release: replacementRelease,
    };
    servicePrivate.sessionLifecycleLeaseGeneration = 2;
    servicePrivate.client = replacementClient;
    servicePrivate.clientConnectionAttemptIds.set(replacementClient, 2);
    servicePrivate.activeConnectionAttemptId = 2;
    releaseHealthNotification?.();
    await handling;

    expect(handleNonTransientInitializeError).not.toHaveBeenCalled();
    expect(clearChromiumProfileLock).toHaveBeenCalledTimes(1);
    expect(replacementRelease).not.toHaveBeenCalled();
    expect(servicePrivate.sessionLifecycleLease?.ownerToken).toBe(
      'replacement-owner'
    );
  });

  it('serializes a replacement online publication after every initialize-error notification', async () => {
    const {
      servicePrivate,
      balanceWorkerStatusGrpcClientService,
      healthCheckService,
    } = makeService();
    servicePrivate.runtimeGeneration = 41;
    servicePrivate.sessionLifecycleLease = {
      ownerToken: 'initialize-owner',
      released: false,
      release: jest.fn(),
    };
    servicePrivate.sessionLifecycleLeaseGeneration = 1;
    const oldClient = {
      pupBrowser: undefined,
      destroy: jest.fn(async () => undefined),
    };
    servicePrivate.client = oldClient;
    servicePrivate.browserRuntimeClients.add(oldClient);
    servicePrivate.clientConnectionAttemptIds.set(oldClient, 1);
    servicePrivate.activeConnectionAttemptId = 1;
    servicePrivate.connecting = true;
    servicePrivate.trackClientInitialization(oldClient, 1, Promise.resolve());

    let releaseHealthNotification: (() => void) | undefined;
    healthCheckService.notifyDisconnected.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        releaseHealthNotification = resolve;
      })
    );

    const handling = servicePrivate.handleInitializeError(
      'old initialize failure',
      oldClient,
      1
    );
    await jest.advanceTimersByTimeAsync(0);

    expect(healthCheckService.notifyDisconnected).toHaveBeenCalledTimes(1);
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).toHaveBeenCalledTimes(1);
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus.mock.calls[0]?.[0]
        .worker_status_id
    ).toBe(EWorkerStatus.disponible);

    const replacementClient = {
      info: { wid: { _serialized: '5511999999999@c.us' } },
    };
    servicePrivate.sessionLifecycleLease = {
      ownerToken: 'replacement-owner',
      released: false,
      release: jest.fn(),
    };
    servicePrivate.sessionLifecycleLeaseGeneration = 2;
    servicePrivate.client = replacementClient;
    servicePrivate.clientConnectionAttemptIds.set(replacementClient, 2);
    servicePrivate.activeConnectionAttemptId = 2;

    let replacementOnlineSettled = false;
    const replacementOnline = servicePrivate
      .confirmReadyAndMarkConnected(replacementClient, 2, null, 'ready')
      .then((result) => {
        replacementOnlineSettled = true;
        return result;
      });
    await jest.advanceTimersByTimeAsync(0);

    expect(replacementOnlineSettled).toBe(false);
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).toHaveBeenCalledTimes(1);

    releaseHealthNotification?.();
    await handling;
    await expect(replacementOnline).resolves.toBe(true);

    const publishedWorkerStatuses =
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus.mock.calls.map(
        ([payload]) => payload.worker_status_id
      );
    expect(publishedWorkerStatuses).toEqual([
      EWorkerStatus.disponible,
      EWorkerStatus.online,
    ]);
    expect(servicePrivate.connectionEstablished).toBe(true);
    expect(servicePrivate.centralOnlineAcknowledged).toBe(true);
    expect(servicePrivate.status).toBe(Status.connected);
  });

  it('retries an unpaired restore below the budget without quarantining it', async () => {
    const { servicePrivate } = makeService();
    const client = {
      destroy: jest.fn(async () => undefined),
    };

    servicePrivate.client = client;
    servicePrivate.initialConnection = true;
    servicePrivate.connecting = true;
    servicePrivate.status = Status.connecting;
    servicePrivate.activeConnectionAttemptId = 1;
    servicePrivate.clientConnectionAttemptIds.set(client, 1);

    jest
      .spyOn(servicePrivate, 'recordSessionRestoreFailure')
      .mockReturnValue({ failures: 1, maxAttempts: 3 });
    const quarantine = jest.spyOn(servicePrivate, 'quarantineCurrentSession');
    const scheduleRetry = jest
      .spyOn(servicePrivate, 'scheduleNextReconnectAttempt')
      .mockImplementation(() => undefined);

    await servicePrivate.handlePersistentUnpaired(client, 1, 'UNPAIRED_IDLE');

    expect(client.destroy).toHaveBeenCalledTimes(1);
    expect(quarantine).not.toHaveBeenCalled();
    expect(scheduleRetry).toHaveBeenCalledWith(true);
    expect(servicePrivate.sessionRestoreBlocked).toBe(false);
    expect(servicePrivate.status).toBe(Status.connecting);
  });

  it('preserves a previously validated profile after a generic initialize failure', () => {
    const { servicePrivate } = makeService();
    jest.spyOn(servicePrivate, 'inspectCurrentLocalSession').mockReturnValue({
      exists: true,
      hasDurableAuthArtifacts: true,
      restorable: true,
      invalidMarker: false,
      incompleteActivationDetected: false,
      marker: {
        version: 1,
        worker_id: 'worker-w',
        account_id: 'account-w',
        state: 'validated',
        source: 'provider_ready',
        created_at: '2026-07-31T00:00:00.000Z',
        updated_at: '2026-07-31T00:00:00.000Z',
        restore_failures: 0,
      },
    });
    const recordRestoreFailure = jest.spyOn(
      servicePrivate,
      'recordSessionRestoreFailure'
    );
    const clearFolder = jest.spyOn(servicePrivate, 'clearFolder');
    const quarantine = jest.spyOn(servicePrivate, 'quarantineCurrentSession');
    const scheduleRetry = jest
      .spyOn(servicePrivate, 'scheduleNextReconnectAttempt')
      .mockImplementation(() => undefined);

    servicePrivate.handleNonTransientInitializeError(
      'unexpected browser initialization failure'
    );

    expect(clearFolder).not.toHaveBeenCalled();
    expect(quarantine).not.toHaveBeenCalled();
    expect(recordRestoreFailure).not.toHaveBeenCalled();
    expect(scheduleRetry).toHaveBeenCalledWith(false);
  });

  it('bounds an auth-state bootstrap timeout even for a previously validated profile', () => {
    const { servicePrivate } = makeService();
    jest.spyOn(servicePrivate, 'inspectCurrentLocalSession').mockReturnValue({
      exists: true,
      hasDurableAuthArtifacts: true,
      restorable: true,
      invalidMarker: false,
      incompleteActivationDetected: false,
      marker: {
        version: 1,
        worker_id: 'worker-w',
        account_id: 'account-w',
        state: 'validated',
        source: 'provider_ready',
        created_at: '2026-07-31T00:00:00.000Z',
        updated_at: '2026-07-31T00:00:00.000Z',
        restore_failures: 0,
      },
    });
    const recordRestoreFailure = jest
      .spyOn(servicePrivate, 'recordSessionRestoreFailure')
      .mockReturnValue({ failures: 1, maxAttempts: 3 });
    const quarantine = jest.spyOn(servicePrivate, 'quarantineCurrentSession');
    const publishQrRequiredState = jest.spyOn(
      servicePrivate,
      'publishQrRequiredState'
    );
    const scheduleRetry = jest
      .spyOn(servicePrivate, 'scheduleNextReconnectAttempt')
      .mockImplementation(() => undefined);

    servicePrivate.handleNonTransientInitializeError(
      'wwebjs_auth_state_timeout'
    );

    expect(recordRestoreFailure).toHaveBeenCalledWith(
      'AUTH_STATE_BOOTSTRAP_TIMEOUT',
      'auth_state_bootstrap_timeout'
    );
    expect(quarantine).not.toHaveBeenCalled();
    expect(publishQrRequiredState).not.toHaveBeenCalled();
    expect(scheduleRetry).toHaveBeenCalledWith(true);
  });

  it('returns a repeatedly timed-out validated profile to QR after the bounded restore budget', () => {
    const { servicePrivate } = makeService();
    jest.spyOn(servicePrivate, 'inspectCurrentLocalSession').mockReturnValue({
      exists: true,
      hasDurableAuthArtifacts: true,
      restorable: true,
      invalidMarker: false,
      incompleteActivationDetected: false,
      marker: {
        version: 1,
        worker_id: 'worker-w',
        account_id: 'account-w',
        state: 'validated',
        source: 'provider_ready',
        created_at: '2026-07-31T00:00:00.000Z',
        updated_at: '2026-07-31T00:00:00.000Z',
        restore_failures: 2,
      },
    });
    jest
      .spyOn(servicePrivate, 'recordSessionRestoreFailure')
      .mockReturnValue({ failures: 3, maxAttempts: 3 });
    const quarantine = jest
      .spyOn(servicePrivate, 'quarantineCurrentSession')
      .mockReturnValue({
        blocked: true,
        moved: true,
        quarantinePath: '/app/data/.underchat-quarantine/wwebjs/worker-w',
      });
    const publishQrRequiredState = jest.spyOn(
      servicePrivate,
      'publishQrRequiredState'
    );
    const scheduleRetry = jest
      .spyOn(servicePrivate, 'scheduleNextReconnectAttempt')
      .mockImplementation(() => undefined);

    servicePrivate.handleNonTransientInitializeError(
      'wwebjs_auth_state_timeout'
    );

    expect(quarantine).toHaveBeenCalledWith(
      'auth_state_bootstrap_timeout_restore_exhausted'
    );
    expect(publishQrRequiredState).toHaveBeenCalledWith(
      'auth_state_bootstrap_timeout_restore_exhausted',
      'wwebjs_auth_state_timeout',
      3,
      3
    );
    expect(scheduleRetry).not.toHaveBeenCalled();
  });

  it('keeps bounded restore accounting for a session that was never validated', () => {
    const { servicePrivate } = makeService();
    jest.spyOn(servicePrivate, 'inspectCurrentLocalSession').mockReturnValue({
      exists: true,
      hasDurableAuthArtifacts: true,
      restorable: true,
      invalidMarker: false,
      incompleteActivationDetected: false,
    });
    const recordRestoreFailure = jest
      .spyOn(servicePrivate, 'recordSessionRestoreFailure')
      .mockReturnValue({ failures: 1, maxAttempts: 3 });
    const quarantine = jest.spyOn(servicePrivate, 'quarantineCurrentSession');
    const scheduleRetry = jest
      .spyOn(servicePrivate, 'scheduleNextReconnectAttempt')
      .mockImplementation(() => undefined);

    servicePrivate.handleNonTransientInitializeError(
      'candidate browser initialization failure'
    );

    expect(recordRestoreFailure).toHaveBeenCalledWith(
      'INITIALIZE_ERROR',
      'non_transient_initialize_error'
    );
    expect(quarantine).not.toHaveBeenCalled();
    expect(scheduleRetry).toHaveBeenCalledWith(true);
  });

  it('quarantines an invalid automatic-restore directory and reports QR required', async () => {
    const { service, servicePrivate } = makeService();
    servicePrivate.status = Status.disconnected;
    jest.spyOn(servicePrivate, 'inspectCurrentLocalSession').mockReturnValue({
      exists: true,
      hasDurableAuthArtifacts: false,
      restorable: false,
      blockedReason: 'missing_auth_artifacts',
      invalidMarker: false,
      incompleteActivationDetected: false,
    });
    jest
      .spyOn(servicePrivate, 'waitForPendingTeardown')
      .mockResolvedValue(undefined);
    const quarantine = jest
      .spyOn(servicePrivate, 'quarantineCurrentSession')
      .mockReturnValue({
        blocked: true,
        moved: true,
        quarantinePath: '/app/data/.underchat-quarantine/wwebjs/worker-w',
      });
    const startConnection = jest.spyOn(servicePrivate, 'startConnection');

    await expect(
      service.connect({
        initial_connection: true,
        allow_restore: true,
        requested_by_user: false,
        type: EBaileysConnectionType.qrcode,
      })
    ).resolves.toEqual(
      expect.objectContaining({
        provider_state: 'QR_REQUIRED',
        reason: 'automatic_restore_session_quarantined',
      })
    );

    expect(quarantine).toHaveBeenCalledWith(
      'automatic_restore_missing_auth_artifacts'
    );
    expect(startConnection).not.toHaveBeenCalled();
  });

  it('cancels an active connecting attempt when a user forces a new QR request', async () => {
    const { service, servicePrivate } = makeService();
    const state: IBaileysConnectionState = {
      status: Status.connecting,
      code: ECodeMessage.awaitingReadQrCode,
      worker_id: 'worker-w',
      account_id: 'account-w',
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
    const startConnectionSpy = jest
      .spyOn(servicePrivate, 'startConnection')
      .mockResolvedValue(state);

    await service.connect({
      initial_connection: true,
      force_new: true,
      requested_by_user: true,
      type: EBaileysConnectionType.qrcode,
    });

    expect(cancelAttemptSpy).toHaveBeenCalled();
    expect(startConnectionSpy).toHaveBeenCalled();
  });

  it('preserves the first explicit QR invocation through activation and startup', async () => {
    const { service, servicePrivate } = makeService();
    const state: IBaileysConnectionState = {
      status: Status.connecting,
      code: ECodeMessage.awaitingReadQrCode,
      worker_id: 'worker-w',
      account_id: 'account-w',
    };
    servicePrivate.status = Status.disconnected;
    servicePrivate.connecting = false;
    servicePrivate.currentPromise = undefined;
    jest.spyOn(service, 'hasSession').mockReturnValue(false);
    jest
      .spyOn(servicePrivate, 'waitForPendingTeardown')
      .mockResolvedValue(undefined);
    jest
      .spyOn(
        servicePrivate as unknown as {
          prepareInvalidSessionForExplicitQr: () => boolean;
        },
        'prepareInvalidSessionForExplicitQr'
      )
      .mockReturnValue(true);
    const cancelAttempt = jest.spyOn(servicePrivate, 'cancelAttempt');
    const startConnection = jest
      .spyOn(servicePrivate, 'startConnection')
      .mockResolvedValue(state);

    await expect(
      service.connect({
        initial_connection: true,
        requested_by_user: true,
        force_new: false,
        type: EBaileysConnectionType.qrcode,
        connection_attempt_id: 'first-explicit-qr',
        runtime_generation: 1,
        debug_trace_id: 'trace-first-explicit-qr',
      })
    ).resolves.toBe(state);

    expect(cancelAttempt).not.toHaveBeenCalled();
    expect(servicePrivate.acquireSessionLifecycleLease).toHaveBeenCalledTimes(
      1
    );
    expect(servicePrivate.beginRuntimeSessionActivation).toHaveBeenCalledTimes(
      1
    );
    expect(startConnection).toHaveBeenCalledTimes(1);
  });

  it('logs a safe PostgreSQL revision-open failure before Chromium startup', async () => {
    const previousStorage = process.env.WORKER_SESSION_STORAGE;
    process.env.WORKER_SESSION_STORAGE = 'postgres';
    try {
      const { service, servicePrivate } = makeService();
      const sensitiveMessage =
        'postgres://worker:password@database/session runtime-capability qr-payload';
      const sessionOpenError = Object.assign(new Error(sensitiveMessage), {
        code: '42501',
      });
      servicePrivate.postgresSessionKnown = true;
      servicePrivate.postgresSessionStore = {
        sessionExists: jest.fn(async () => {
          throw sessionOpenError;
        }),
      } as unknown as PostgresWwebjsSessionStore;
      const startConnection = jest.spyOn(servicePrivate, 'startConnection');

      await expect(
        service.connect({
          initial_connection: true,
          requested_by_user: true,
          type: EBaileysConnectionType.qrcode,
          connection_attempt_id: 'postgres-open-failure',
          runtime_generation: 1,
          debug_trace_id: 'trace-postgres-open-failure',
        })
      ).rejects.toBe(sessionOpenError);

      expect(servicePrivate.postgresSessionKnown).toBe(true);
      const logs = jest
        .mocked(console.log)
        .mock.calls.flatMap((call) => call.map(String))
        .join('\n');
      expect(logs).toContain('wwebjs.provider.postgres_session_refresh_failed');
      expect(logs).toContain('wwebjs_postgres_session_open_failed:42501');
      expect(logs).not.toContain(sensitiveMessage);
      expect(startConnection).not.toHaveBeenCalled();
    } finally {
      if (previousStorage === undefined) {
        delete process.env.WORKER_SESSION_STORAGE;
      } else {
        process.env.WORKER_SESSION_STORAGE = previousStorage;
      }
    }
  });

  it('uses protected restore deadlines for a pending PostgreSQL provider handoff', async () => {
    const previousStorage = process.env.WORKER_SESSION_STORAGE;
    process.env.WORKER_SESSION_STORAGE = 'postgres';
    try {
      const { service, servicePrivate } = makeService();
      const failCandidate = jest.fn(async () => undefined);
      const sessionExists = jest.fn(async () => true);
      let resolveNativeStoreAccess: (() => void) | undefined;
      const nativeStoreAccessed = new Promise<void>((resolve) => {
        resolveNativeStoreAccess = resolve;
      });
      servicePrivate.postgresSessionStore = {
        revisionId: '11',
        revisionStatus: 'validating',
        logger: { log: jest.fn() },
        getNativeStore: () => {
          resolveNativeStoreAccess?.();
          return {};
        },
        hasPendingHandoff: () => true,
        failCandidate,
        sessionExists,
      } as unknown as PostgresWwebjsSessionStore;
      jest.spyOn(servicePrivate, 'prepareFolder').mockImplementation(() => {});
      jest
        .spyOn(servicePrivate, 'waitForPendingTeardown')
        .mockResolvedValue(undefined);
      jest
        .spyOn(servicePrivate, 'startConnectionStateProbe')
        .mockImplementation(() => undefined);
      jest
        .spyOn(servicePrivate, 'recoverChromiumProfileBeforeLaunch')
        .mockResolvedValue(undefined);
      jest
        .spyOn(servicePrivate, 'queueTeardown')
        .mockImplementation(() => undefined);
      const guard = jest
        .spyOn(servicePrivate, 'withConnectionAttemptGuardTimeout')
        .mockImplementation((promise) => promise);

      const connection = service.connect({
        initial_connection: true,
        allow_restore: true,
        type: EBaileysConnectionType.qrcode,
      });
      await nativeStoreAccessed;

      expect(sessionExists).toHaveBeenCalledWith({
        session: 'RemoteAuth-worker-w',
      });
      expect(mockLastWwebjsClient).toBeDefined();
      expect(mockLastWwebjsClientOptions).toEqual(
        expect.objectContaining({ authTimeoutMs: 150_000 })
      );
      expect(guard).toHaveBeenCalledWith(expect.any(Promise), 1, true);

      await mockLastWwebjsClient?.emit('qr', 'unexpected-handoff-qr');
      await expect(connection).resolves.toEqual(
        expect.objectContaining({
          status: Status.disconnected,
          reason: 'wwebjs_restore_unexpected_qr',
          session_ready: false,
        })
      );
      expect(failCandidate).toHaveBeenCalledWith(
        'wwebjs_restore_unexpected_qr'
      );
    } finally {
      if (previousStorage === undefined) {
        delete process.env.WORKER_SESSION_STORAGE;
      } else {
        process.env.WORKER_SESSION_STORAGE = previousStorage;
      }
    }
  });

  it('does not let a replaced attempt finally clear the active force-new attempt', async () => {
    const { service, servicePrivate } = makeService();
    const firstState: IBaileysConnectionState = {
      status: Status.connecting,
      code: ECodeMessage.awaitConnection,
      worker_id: 'worker-w',
      account_id: 'account-w',
    };
    let resolveFirst: ((state: IBaileysConnectionState) => void) | undefined;
    let resolveSecond: ((state: IBaileysConnectionState) => void) | undefined;
    const firstClientWait = new Promise<IBaileysConnectionState>((resolve) => {
      resolveFirst = resolve;
    });
    const secondClientWait = new Promise<IBaileysConnectionState>((resolve) => {
      resolveSecond = resolve;
    });

    jest.spyOn(servicePrivate, 'prepareFolder').mockImplementation(() => {});
    jest
      .spyOn(servicePrivate, 'waitForPendingTeardown')
      .mockResolvedValue(undefined);
    jest
      .spyOn(servicePrivate, 'createAndWaitClient')
      .mockReturnValueOnce(firstClientWait)
      .mockReturnValueOnce(secondClientWait);

    const firstAttempt = servicePrivate.startConnection();
    await jest.advanceTimersByTimeAsync(0);
    const secondAttempt = service.connect({
      initial_connection: true,
      force_new: true,
      requested_by_user: true,
      type: EBaileysConnectionType.qrcode,
    });
    await jest.advanceTimersByTimeAsync(0);
    const activeSecondPromise = servicePrivate.currentPromise;

    resolveFirst?.(firstState);
    await expect(firstAttempt).resolves.toBe(firstState);

    expect(servicePrivate.connecting).toBe(true);
    expect(servicePrivate.currentPromise).toBe(activeSecondPromise);
    expect(servicePrivate.activeConnectionAttemptId).toBe(2);

    resolveSecond?.(firstState);
    await expect(secondAttempt).resolves.toBe(firstState);
    expect(servicePrivate.connecting).toBe(false);
    expect(servicePrivate.currentPromise).toBeUndefined();
  });

  it('starts a user-requested QR connection when a session is already present', async () => {
    const { service, servicePrivate } = makeService();
    const state: IBaileysConnectionState = {
      status: Status.connecting,
      code: ECodeMessage.awaitingReadQrCode,
      worker_id: 'worker-w',
      account_id: 'account-w',
    };

    servicePrivate.status = Status.disconnected;
    jest.spyOn(service, 'hasSession').mockReturnValue(true);
    const startConnectionSpy = jest
      .spyOn(servicePrivate, 'startConnection')
      .mockResolvedValue(state);

    await service.connect({
      initial_connection: true,
      allow_restore: true,
      requested_by_user: true,
      type: EBaileysConnectionType.qrcode,
    });

    expect(startConnectionSpy).toHaveBeenCalled();
  });

  it('does not treat restore attempts as first QR timeout failures', () => {
    const { servicePrivate } = makeService();

    servicePrivate.qrReadSessionActive = false;

    expect(servicePrivate.shouldResolveQrAttemptTimeoutAsFailure()).toBe(false);

    servicePrivate.qrReadSessionActive = true;

    expect(servicePrivate.shouldResolveQrAttemptTimeoutAsFailure()).toBe(true);
  });

  it('restarts an active QR lifecycle without requiring a restorable session', async () => {
    const { service, servicePrivate } = makeService();
    jest.spyOn(service, 'hasSession').mockReturnValue(false);
    const connect = jest.spyOn(service, 'connect').mockResolvedValue({
      status: Status.connecting,
      code: ECodeMessage.awaitingReadQrCode,
      worker_id: 'worker-w',
      account_id: 'account-w',
    });
    servicePrivate.initialConnection = false;
    servicePrivate.typeConnection = EBaileysConnectionType.qrcode;
    servicePrivate.qrReadSessionActive = true;
    servicePrivate.qrReadSessionLocked = false;
    servicePrivate.qrGenerationCount = 1;
    servicePrivate.connectionAttemptId = 'wwebjs-active-qr';
    servicePrivate.runtimeGeneration = 31;

    expect(servicePrivate.canContinueQrReadSession()).toBe(true);
    expect(servicePrivate.shouldScheduleRetryAfterDisconnect(true)).toBe(true);

    servicePrivate.scheduleNextReconnectAttempt(false, true);
    await jest.advanceTimersByTimeAsync(0);

    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({
        force_new: false,
        from_disconnect_restart: true,
        requested_by_user: false,
        connection_attempt_id: 'wwebjs-active-qr',
        runtime_generation: 31,
      })
    );
  });

  it('uses the short retry only while a PostgreSQL provider handoff is pending', async () => {
    const previousStorage = process.env.WORKER_SESSION_STORAGE;
    process.env.WORKER_SESSION_STORAGE = 'postgres';
    try {
      const { service, servicePrivate } = makeService();
      jest.spyOn(service, 'hasSession').mockReturnValue(true);
      const connect = jest.spyOn(service, 'connect').mockResolvedValue({
        status: Status.connecting,
        code: ECodeMessage.awaitConnection,
        worker_id: 'worker-w',
        account_id: 'account-w',
      });
      servicePrivate.initialConnection = true;
      servicePrivate.retryCount = 1;
      servicePrivate.postgresSessionStore = {
        hasPendingHandoff: () => true,
      } as unknown as PostgresWwebjsSessionStore;

      servicePrivate.scheduleNextReconnectAttempt(false, false);

      await jest.advanceTimersByTimeAsync(1_999);
      expect(connect).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      expect(connect).toHaveBeenCalledTimes(1);
      expect(connect).toHaveBeenCalledWith(
        expect.objectContaining({
          allow_restore: true,
          from_disconnect_restart: true,
          requested_by_user: false,
        })
      );
    } finally {
      if (previousStorage === undefined) {
        delete process.env.WORKER_SESSION_STORAGE;
      } else {
        process.env.WORKER_SESSION_STORAGE = previousStorage;
      }
    }
  });

  it('keeps the normal 60-second retry outside provider handoff', async () => {
    const { service, servicePrivate } = makeService();
    jest.spyOn(service, 'hasSession').mockReturnValue(true);
    const connect = jest.spyOn(service, 'connect').mockResolvedValue({
      status: Status.connecting,
      code: ECodeMessage.awaitConnection,
      worker_id: 'worker-w',
      account_id: 'account-w',
    });
    servicePrivate.initialConnection = true;
    servicePrivate.retryCount = 1;

    servicePrivate.scheduleNextReconnectAttempt(false, false);

    await jest.advanceTimersByTimeAsync(59_999);
    expect(connect).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('reuses the current runtime fence while recycling the active QR client', async () => {
    const { servicePrivate } = makeService();
    servicePrivate.typeConnection = EBaileysConnectionType.qrcode;
    servicePrivate.qrReadSessionActive = true;
    servicePrivate.qrReadSessionLocked = false;
    servicePrivate.qrGenerationCount = 1;
    servicePrivate.runtimeFenceConnectionAuthorization = {
      connection_epoch: 'wwebjs-current-epoch',
      connection_attempt_id: 'wwebjs-current-qr-attempt',
    };
    const activate = jest.spyOn(
      servicePrivate,
      'resolveRuntimeFenceConnectionAuthorization'
    );

    await expect(
      servicePrivate.resolveConnectionRuntimeFenceAuthorization({
        initial_connection: false,
        type: EBaileysConnectionType.qrcode,
        requested_by_user: false,
        from_disconnect_restart: true,
        connection_attempt_id: 'wwebjs-current-qr-attempt',
      })
    ).resolves.toEqual({
      connection_epoch: 'wwebjs-current-epoch',
      connection_attempt_id: 'wwebjs-current-qr-attempt',
    });
    expect(activate).not.toHaveBeenCalled();
  });

  it('refreshes one fenced WWebJS attempt every 25 seconds and stops only after five distinct QRs', async () => {
    const { servicePrivate, balanceWorkerStatusGrpcClientService } =
      makeService();
    servicePrivate.activeConnectionAttemptId = 1;
    servicePrivate.status = Status.connecting;
    servicePrivate.initialConnection = true;
    servicePrivate.typeConnection = EBaileysConnectionType.qrcode;
    servicePrivate.qrReadSessionActive = true;
    servicePrivate.qrReadSessionLocked = false;
    servicePrivate.connectionAttemptId = 'wwebjs-five-qr-attempt';
    servicePrivate.runtimeGeneration = 41;
    servicePrivate.connectionAttemptStartedAtMs = Date.now();
    jest
      .spyOn(servicePrivate, 'startConnectionStateProbe')
      .mockImplementation(() => undefined);
    jest
      .spyOn(servicePrivate, 'recoverChromiumProfileBeforeLaunch')
      .mockResolvedValue(undefined);
    const cancelAttempt = jest
      .spyOn(servicePrivate, 'cancelAttempt')
      .mockImplementation(() => undefined);

    const connection = servicePrivate.createAndWaitClient(1);
    await jest.advanceTimersByTimeAsync(0);
    expect(mockLastWwebjsClient).toBeDefined();
    expect(mockWwebjsInitialize).toHaveBeenCalledTimes(1);

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      if (attempt > 1) {
        await jest.advanceTimersByTimeAsync(25_000);
        expect(mockWwebjsRefreshQr).toHaveBeenCalledTimes(attempt - 1);
      }
      const qrPublication = mockLastWwebjsClient?.emit(
        'qr',
        `wwebjs-distinct-qr-${attempt}-${String(attempt).repeat(24)}`
      );
      await jest.advanceTimersByTimeAsync(0);
      await qrPublication;
    }

    await expect(connection).resolves.toEqual(
      expect.objectContaining({
        attempt: 1,
        max_attempts: 5,
        connection_attempt_id: 'wwebjs-five-qr-attempt',
      })
    );
    expect(servicePrivate.qrGenerationCount).toBe(5);

    await jest.advanceTimersByTimeAsync(25_000);

    expect(mockWwebjsRefreshQr).toHaveBeenCalledTimes(4);
    expect(cancelAttempt).toHaveBeenCalledWith(false);
    expect(servicePrivate.qrReadSessionActive).toBe(false);
    expect(servicePrivate.qrReadSessionLocked).toBe(true);
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus.mock.calls
        .map(([payload]) => payload)
        .filter(
          (payload) =>
            payload.connection_attempt_id === 'wwebjs-five-qr-attempt' &&
            payload.max_attempts === 5
        )
        .map((payload) => payload.attempt)
    ).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('treats client_destroyed during a manual QR attempt as an internal client recycle', async () => {
    const { servicePrivate } = makeService();
    servicePrivate.activeConnectionAttemptId = 1;
    servicePrivate.status = Status.connecting;
    servicePrivate.initialConnection = false;
    servicePrivate.typeConnection = EBaileysConnectionType.qrcode;
    servicePrivate.qrReadSessionActive = true;
    servicePrivate.qrReadSessionLocked = false;
    servicePrivate.connectionAttemptId = 'wwebjs-manual-qr-attempt';
    servicePrivate.runtimeGeneration = 47;
    servicePrivate.connectionAttemptStartedAtMs = Date.now();
    jest
      .spyOn(servicePrivate, 'startConnectionStateProbe')
      .mockImplementation(() => undefined);
    jest
      .spyOn(servicePrivate, 'recoverChromiumProfileBeforeLaunch')
      .mockResolvedValue(undefined);
    const stopProviderRuntime = jest.spyOn(
      servicePrivate,
      'stopProviderRuntime'
    );
    const recover = jest
      .spyOn(servicePrivate, 'recoverQrReadSessionAfterAuthFailure')
      .mockResolvedValue(undefined);

    const connection = servicePrivate.createAndWaitClient(1);
    await jest.advanceTimersByTimeAsync(0);
    const client = mockLastWwebjsClient;
    expect(client).toBeDefined();

    const qrPublication = client?.emit(
      'qr',
      'wwebjs-manual-first-qr-111111111111111111111111'
    );
    await jest.advanceTimersByTimeAsync(0);
    await qrPublication;
    await expect(connection).resolves.toEqual(
      expect.objectContaining({
        attempt: 1,
        connection_attempt_id: 'wwebjs-manual-qr-attempt',
      })
    );
    stopProviderRuntime.mockClear();

    await client?.emit('disconnected', 'client_destroyed');

    expect(recover).toHaveBeenCalledWith(
      client,
      expect.stringContaining('wwebjs_qr_client_disconnected')
    );
    expect(stopProviderRuntime).not.toHaveBeenCalled();
    expect(servicePrivate.connectionAttemptId).toBe('wwebjs-manual-qr-attempt');
    expect(servicePrivate.runtimeGeneration).toBe(47);
    expect(servicePrivate.qrGenerationCount).toBe(1);
  });

  it('keeps the generic 120 second probe away from an active QR lifecycle', async () => {
    const { service, servicePrivate } = makeService();
    const client = {
      getState: jest.fn(async () => 'UNPAIRED'),
    };
    jest.spyOn(service, 'hasSession').mockReturnValue(false);
    const terminate = jest.spyOn(
      servicePrivate,
      'forceTerminateClientRuntimeWithoutSdkOverlap'
    );
    servicePrivate.client = client;
    servicePrivate.clientConnectionAttemptIds.set(client, 1);
    servicePrivate.status = Status.connecting;
    servicePrivate.connectionEstablished = false;
    servicePrivate.initialConnection = true;
    servicePrivate.typeConnection = EBaileysConnectionType.qrcode;
    servicePrivate.qrReadSessionActive = true;
    servicePrivate.qrReadSessionLocked = false;
    servicePrivate.qrGenerationCount = 4;
    servicePrivate.connectionAttemptId = 'wwebjs-probe-qr-attempt';

    servicePrivate.startConnectionStateProbe(client, 1, null);
    await jest.advanceTimersByTimeAsync(130_000);

    expect(client.getState).toHaveBeenCalled();
    expect(terminate).not.toHaveBeenCalled();
    expect(servicePrivate.client).toBe(client);
    expect(servicePrivate.status).toBe(Status.connecting);
  });

  it('recycles only the internal client after a QR refresh failure and preserves attempt identity', async () => {
    const { servicePrivate } = makeService();
    const client = {};
    servicePrivate.client = client;
    servicePrivate.clientConnectionAttemptIds.set(client, 7);
    servicePrivate.initialConnection = false;
    servicePrivate.typeConnection = EBaileysConnectionType.qrcode;
    servicePrivate.qrReadSessionActive = true;
    servicePrivate.qrReadSessionLocked = false;
    servicePrivate.qrGenerationCount = 2;
    servicePrivate.connectionAttemptId = 'wwebjs-recycled-qr-attempt';
    servicePrivate.runtimeGeneration = 51;
    jest
      .spyOn(servicePrivate, 'destroyClientWithTimeout')
      .mockResolvedValue(true);
    jest
      .spyOn(servicePrivate, 'queueTeardown')
      .mockImplementation((_operation, teardown) => {
        void teardown();
      });
    jest
      .spyOn(servicePrivate, 'waitForPendingTeardown')
      .mockResolvedValue(undefined);
    const reconnect = jest
      .spyOn(servicePrivate, 'scheduleNextReconnectAttempt')
      .mockImplementation(() => undefined);

    await servicePrivate.recoverQrReadSessionAfterAuthFailure(
      client,
      'wwebjs_qr_refresh_event_timeout'
    );

    expect(servicePrivate.connectionAttemptId).toBe(
      'wwebjs-recycled-qr-attempt'
    );
    expect(servicePrivate.runtimeGeneration).toBe(51);
    expect(servicePrivate.qrGenerationCount).toBe(2);
    expect(servicePrivate.qrReadSessionActive).toBe(true);
    expect(reconnect).toHaveBeenCalledWith(false, true);
    expect(servicePrivate.connecting).toBe(false);
    expect(servicePrivate.currentPromise).toBeUndefined();
    expect(servicePrivate.activeConnectionAttemptId).toBeUndefined();
  });

  it('does not resolve restore guard timeouts as QR failures', async () => {
    const { servicePrivate } = makeService();

    servicePrivate.status = Status.connecting;
    servicePrivate.connectionEstablished = false;
    servicePrivate.qrReadSessionActive = false;
    servicePrivate.activeConnectionAttemptId = 1;
    servicePrivate.connectionAttemptStartedAtMs = Date.now();

    const resolveQrTimeoutSpy = jest.spyOn(
      servicePrivate,
      'resolveQrAttemptTimeout'
    );
    const pendingRestore = new Promise<IBaileysConnectionState>(() => {});
    const guarded = servicePrivate.withConnectionAttemptGuardTimeout(
      pendingRestore,
      1
    );

    await jest.advanceTimersToNextTimerAsync();

    await expect(guarded).resolves.toEqual(
      expect.objectContaining({
        status: Status.connecting,
      })
    );
    expect(resolveQrTimeoutSpy).not.toHaveBeenCalled();
  });

  it('accepts native ready after the restore guard has returned a connecting state', async () => {
    const { servicePrivate, healthCheckService, incomingMessageService } =
      makeService();
    const client = {
      info: {
        wid: {
          _serialized: '5511999999999@c.us',
        },
      },
    };

    jest.spyOn(servicePrivate, 'prepareFolder').mockImplementation(() => {});
    jest
      .spyOn(servicePrivate, 'waitForPendingTeardown')
      .mockResolvedValue(undefined);
    jest
      .spyOn(servicePrivate, 'createAndWaitClient')
      .mockImplementation((attemptId) => {
        servicePrivate.client = client;
        servicePrivate.clientConnectionAttemptIds.set(client, attemptId);
        return new Promise<IBaileysConnectionState>(() => {});
      });

    const connectionResponse = servicePrivate.startConnection();
    await jest.advanceTimersByTimeAsync(30_000);

    await expect(connectionResponse).resolves.toEqual(
      expect.objectContaining({ status: Status.connecting })
    );
    expect(servicePrivate.activeConnectionAttemptId).toBeUndefined();

    await expect(
      servicePrivate.confirmReadyAndMarkConnected(client, 1, null, 'ready')
    ).resolves.toBe(true);

    expect(servicePrivate.status).toBe(Status.connected);
    expect(servicePrivate.connectionEstablished).toBe(true);
    expect(healthCheckService.verifyCurrentSession).toHaveBeenCalledTimes(2);
    expect(incomingMessageService.prepareConnectionFence).toHaveBeenCalledTimes(
      1
    );
    expect(incomingMessageService.markConnectionReady).toHaveBeenCalledTimes(1);
    expect(mockEmitWorkerProviderRuntimeState).toHaveBeenCalledWith(
      'wwebjs',
      true
    );
    const providerReadyCallIndex =
      mockEmitWorkerProviderRuntimeState.mock.calls.findIndex(
        ([, ready]) => ready === true
      );
    expect(
      incomingMessageService.prepareConnectionFence.mock.invocationCallOrder[0]
    ).toBeLessThan(
      mockEmitWorkerProviderRuntimeState.mock.invocationCallOrder[
        providerReadyCallIndex
      ]
    );
    expect(
      mockEmitWorkerProviderRuntimeState.mock.invocationCallOrder[
        providerReadyCallIndex
      ]
    ).toBeLessThan(
      incomingMessageService.markConnectionReady.mock.invocationCallOrder[0]
    );
  });

  it('accepts native ready after a QR response has completed the public connection promise', async () => {
    const { servicePrivate, incomingMessageService } = makeService();
    const client = {
      info: {
        wid: {
          _serialized: '5511999999999@c.us',
        },
      },
    };
    const qrState: IBaileysConnectionState = {
      status: Status.connecting,
      code: ECodeMessage.awaitingReadQrCode,
      worker_id: 'worker-w',
      account_id: 'account-w',
      qrcode: 'data:image/png;base64,qr',
    };

    jest.spyOn(servicePrivate, 'prepareFolder').mockImplementation(() => {});
    jest
      .spyOn(servicePrivate, 'waitForPendingTeardown')
      .mockResolvedValue(undefined);
    jest
      .spyOn(servicePrivate, 'createAndWaitClient')
      .mockImplementation(async (attemptId) => {
        servicePrivate.client = client;
        servicePrivate.clientConnectionAttemptIds.set(client, attemptId);
        return qrState;
      });

    await expect(servicePrivate.startConnection()).resolves.toBe(qrState);
    expect(servicePrivate.activeConnectionAttemptId).toBeUndefined();

    await expect(
      servicePrivate.confirmReadyAndMarkConnected(client, 1, null, 'ready')
    ).resolves.toBe(true);

    expect(servicePrivate.status).toBe(Status.connected);
    expect(servicePrivate.connectionEstablished).toBe(true);
    expect(incomingMessageService.markConnectionReady).toHaveBeenCalledTimes(1);
  });

  it('keeps the client generation valid when the Kafka readiness barrier finishes after the guard', async () => {
    const { servicePrivate } = makeService();
    const client = {
      info: {
        wid: {
          _serialized: '5511999999999@c.us',
        },
      },
    };
    let releaseKafkaBarrier: (() => void) | undefined;
    const kafkaBarrier = new Promise<void>((resolve) => {
      releaseKafkaBarrier = resolve;
    });

    mockEmitWorkerProviderRuntimeState.mockImplementation(
      async (_provider: string, ready: boolean) => {
        if (ready === true) {
          await kafkaBarrier;
        }
      }
    );
    jest.spyOn(servicePrivate, 'prepareFolder').mockImplementation(() => {});
    jest
      .spyOn(servicePrivate, 'waitForPendingTeardown')
      .mockResolvedValue(undefined);
    jest
      .spyOn(servicePrivate, 'createAndWaitClient')
      .mockImplementation((attemptId) => {
        servicePrivate.client = client;
        servicePrivate.clientConnectionAttemptIds.set(client, attemptId);
        return new Promise<IBaileysConnectionState>(() => {});
      });

    const connectionResponse = servicePrivate.startConnection();
    await jest.advanceTimersByTimeAsync(0);
    const readyConfirmation = servicePrivate.confirmReadyAndMarkConnected(
      client,
      1,
      null,
      'ready'
    );
    await jest.advanceTimersByTimeAsync(30_000);

    await expect(connectionResponse).resolves.toEqual(
      expect.objectContaining({ status: Status.connecting })
    );
    expect(servicePrivate.activeConnectionAttemptId).toBeUndefined();

    releaseKafkaBarrier?.();
    await expect(readyConfirmation).resolves.toBe(true);
    expect(servicePrivate.status).toBe(Status.connected);
  });

  it('still rejects a current client carrying a different connection generation', async () => {
    const { servicePrivate, healthCheckService } = makeService();
    const client = {};

    servicePrivate.client = client;
    servicePrivate.clientConnectionAttemptIds.set(client, 2);

    await expect(
      servicePrivate.confirmReadyAndMarkConnected(client, 1, null, 'ready')
    ).resolves.toBe(false);

    expect(healthCheckService.verifyCurrentSession).not.toHaveBeenCalled();
    expect(mockEmitWorkerProviderRuntimeState).not.toHaveBeenCalled();
    expect(servicePrivate.connectionEstablished).toBe(false);
  });

  it('does not short-circuit strong readiness when the local client is connected but central ACK was revoked', async () => {
    const {
      servicePrivate,
      balanceWorkerStatusGrpcClientService,
      incomingMessageService,
      healthCheckService,
    } = makeService();
    const client = {
      info: {
        wid: {
          _serialized: '5511999999999@c.us',
        },
      },
    };
    servicePrivate.client = client;
    servicePrivate.clientConnectionAttemptIds.set(client, 11);
    servicePrivate.status = Status.connected;
    servicePrivate.connectionEstablished = true;
    servicePrivate.centralOnlineAcknowledged = false;
    setWorkerKafkaDispatchAuthorized(false);

    await expect(
      servicePrivate.confirmReadyAndMarkConnected(
        client,
        11,
        null,
        'native_reconnect'
      )
    ).resolves.toBe(true);

    expect(healthCheckService.verifyCurrentSession).toHaveBeenCalledTimes(2);
    expect(mockEmitWorkerProviderRuntimeState).toHaveBeenCalledWith(
      'wwebjs',
      true
    );
    expect(incomingMessageService.markConnectionReady).toHaveBeenCalledTimes(1);
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).toHaveBeenCalledWith(
      expect.objectContaining({ worker_status_id: EWorkerStatus.online })
    );
    expect(servicePrivate.centralOnlineAcknowledged).toBe(true);
    expect(isWorkerKafkaDispatchAuthorized()).toBe(true);
  });

  it('does not restore ACK when native transport leaves ONLINE while the central notification is in flight', async () => {
    const {
      servicePrivate,
      balanceWorkerStatusGrpcClientService,
      healthCheckService,
    } = makeService();
    let currentNativeStatus = {
      provider: 'wwebjs' as const,
      status: EWhatsappConnectionStatus.online,
      connected: true,
      authenticated: true,
      sessionValid: true,
      recoverable: false,
      qrAvailable: false,
      sequence: 20,
      changedAt: new Date().toISOString(),
      reason: 'socket_reconnected',
    };
    const client = {
      info: {
        wid: {
          _serialized: '5511999999999@c.us',
        },
      },
      getConnectionStatus: jest.fn(() => currentNativeStatus),
    };
    servicePrivate.client = client;
    servicePrivate.clientConnectionAttemptIds.set(client, 12);
    servicePrivate.nativeConnectionStatusSource = client;
    servicePrivate.nativeConnectionStatus = currentNativeStatus;
    servicePrivate.status = Status.connected;
    servicePrivate.connectionEstablished = true;
    servicePrivate.centralOnlineAcknowledged = false;
    setWorkerKafkaDispatchAuthorized(false);

    let markNotificationStarted: (() => void) | undefined;
    let releaseNotification: (() => void) | undefined;
    const notificationStarted = new Promise<void>((resolve) => {
      markNotificationStarted = resolve;
    });
    const notificationBarrier = new Promise<void>((resolve) => {
      releaseNotification = resolve;
    });
    balanceWorkerStatusGrpcClientService.notifyWorkerStatus.mockImplementationOnce(
      async () => {
        markNotificationStarted?.();
        await notificationBarrier;
      }
    );

    const confirmation = servicePrivate.confirmReadyAndMarkConnected(
      client,
      12,
      null,
      'native_reconnect'
    );
    await notificationStarted;

    currentNativeStatus = {
      ...currentNativeStatus,
      status: EWhatsappConnectionStatus.reconnecting,
      connected: false,
      recoverable: true,
      sequence: 21,
      changedAt: new Date().toISOString(),
      reason: 'socket_reconnecting',
    };
    servicePrivate.acceptNativeConnectionStatus(
      client,
      currentNativeStatus,
      false
    );
    releaseNotification?.();

    await expect(confirmation).resolves.toBe(false);
    expect(servicePrivate.centralOnlineAcknowledged).toBe(false);
    expect(isWorkerKafkaDispatchAuthorized()).toBe(false);
    expect(healthCheckService.markStatusPublished).not.toHaveBeenCalled();
  });

  it('does not publish online in postgres mode before RemoteAuth confirms a durable checkpoint', async () => {
    const previousStorage = process.env.WORKER_SESSION_STORAGE;
    process.env.WORKER_SESSION_STORAGE = 'postgres';
    try {
      const { servicePrivate, healthCheckService } = makeService();
      const client = {
        info: { wid: { _serialized: '5511999999999@c.us' } },
      };
      servicePrivate.client = client;
      servicePrivate.status = Status.connecting;
      servicePrivate.clientConnectionAttemptIds.set(client, 1);

      await expect(
        servicePrivate.confirmReadyAndMarkConnected(client, 1, null, 'ready')
      ).resolves.toBe(false);
      expect(healthCheckService.verifyCurrentSession).not.toHaveBeenCalled();

      servicePrivate.clientsWithDurableRemoteCheckpoint.add(client);
      servicePrivate.postgresSessionStore = {
        getConnectionStatusLeaseProof: () => ({
          ownerId: '01900000-0000-7000-8000-000000000084',
          fencingToken: '31',
        }),
      } as unknown as PostgresWwebjsSessionStore;
      await expect(
        servicePrivate.confirmReadyAndMarkConnected(client, 1, null, 'ready')
      ).resolves.toBe(true);
    } finally {
      if (previousStorage === undefined) {
        delete process.env.WORKER_SESSION_STORAGE;
      } else {
        process.env.WORKER_SESSION_STORAGE = previousStorage;
      }
    }
  });

  it('singleflights concurrent native ready and state probe confirmations', async () => {
    const {
      servicePrivate,
      centrifugo,
      balanceWorkerStatusGrpcClientService,
      incomingMessageService,
      healthCheckService,
    } = makeService();
    const client = {
      info: {
        wid: {
          _serialized: '5511999999999@c.us',
        },
      },
    };

    servicePrivate.client = client;
    servicePrivate.status = Status.connecting;
    servicePrivate.clientConnectionAttemptIds.set(client, 1);

    const [nativeReady, stateProbe] = await Promise.all([
      servicePrivate.confirmReadyAndMarkConnected(client, 1, null, 'ready'),
      servicePrivate.confirmReadyAndMarkConnected(
        client,
        1,
        null,
        'state_probe'
      ),
    ]);

    expect(nativeReady).toBe(true);
    expect(stateProbe).toBe(true);
    expect(healthCheckService.verifyCurrentSession).toHaveBeenCalledTimes(2);
    expect(mockEmitWorkerProviderRuntimeState).toHaveBeenCalledTimes(1);
    expect(mockEmitWorkerProviderRuntimeState).toHaveBeenCalledWith(
      'wwebjs',
      true
    );
    expect(healthCheckService.markStatusPublished).toHaveBeenCalledTimes(1);
    expect(incomingMessageService.markConnectionReady).toHaveBeenCalledTimes(1);
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).toHaveBeenCalledTimes(1);
    expect(centrifugo.publishSub).not.toHaveBeenCalled();
  });

  it('serializes verified and native ready publications for the same client generation', async () => {
    const {
      service,
      servicePrivate,
      centrifugo,
      balanceWorkerStatusGrpcClientService,
      incomingMessageService,
      healthCheckService,
    } = makeService();
    const client = {
      info: {
        wid: {
          _serialized: '5511999999999@c.us',
        },
      },
    };
    let releaseOnlineNotification: (() => void) | undefined;
    let markOnlineNotificationStarted: (() => void) | undefined;
    const onlineNotificationStarted = new Promise<void>((resolve) => {
      markOnlineNotificationStarted = resolve;
    });
    const onlineNotificationBarrier = new Promise<void>((resolve) => {
      releaseOnlineNotification = resolve;
    });
    balanceWorkerStatusGrpcClientService.notifyWorkerStatus.mockImplementation(
      async (payload) => {
        if (payload.worker_status_id === EWorkerStatus.online) {
          markOnlineNotificationStarted?.();
          await onlineNotificationBarrier;
        }
      }
    );
    servicePrivate.client = client;
    servicePrivate.status = Status.connecting;
    servicePrivate.connectionEstablished = false;
    servicePrivate.clientConnectionAttemptIds.set(client, 1);

    const verifiedPublication = service.verifyAndPublishConnectionStatus();
    await onlineNotificationStarted;
    const nativeReadyPublication = servicePrivate.confirmReadyAndMarkConnected(
      client,
      1,
      null,
      'ready'
    );
    await Promise.resolve();

    expect(
      mockEmitWorkerProviderRuntimeState.mock.calls.filter(([, ready]) => ready)
    ).toHaveLength(1);

    releaseOnlineNotification?.();
    await expect(verifiedPublication).resolves.toEqual(
      expect.objectContaining({
        status: Status.connected,
        worker_status_id: EWorkerStatus.online,
      })
    );
    await expect(nativeReadyPublication).resolves.toBe(true);

    const onlineNotifications =
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus.mock.calls.filter(
        ([payload]) => payload.worker_status_id === EWorkerStatus.online
      );
    expect(onlineNotifications).toHaveLength(1);
    expect(incomingMessageService.markConnectionReady).toHaveBeenCalledTimes(1);
    expect(healthCheckService.markStatusPublished).toHaveBeenCalledTimes(1);
    expect(centrifugo.publishSub).not.toHaveBeenCalled();
  });

  it('invalidates the client generation before disconnect awaits teardown', async () => {
    const {
      service,
      servicePrivate,
      centrifugo,
      balanceWorkerStatusGrpcClientService,
      incomingMessageService,
      healthCheckService,
    } = makeService();
    const client = {
      destroy: jest.fn(async () => undefined),
      info: {
        wid: {
          _serialized: '5511999999999@c.us',
        },
      },
    };
    const readyState = {
      session_ready: true,
      can_send: true,
      can_receive_runtime: true,
      authenticated: true,
      provider_state: 'CONNECTED',
      last_probe_at: new Date().toISOString(),
      probe_latency_ms: 1,
    };
    let resolveSecondReadiness:
      ((value: typeof readyState) => void) | undefined;
    const secondReadiness = new Promise<typeof readyState>((resolve) => {
      resolveSecondReadiness = resolve;
    });
    healthCheckService.verifyCurrentSession
      .mockResolvedValueOnce(readyState)
      .mockReturnValueOnce(secondReadiness);
    let releaseDisconnectNotification: (() => void) | undefined;
    healthCheckService.notifyDisconnected.mockReturnValueOnce(
      new Promise<undefined>((resolve) => {
        releaseDisconnectNotification = () => resolve(undefined);
      })
    );
    servicePrivate.client = client;
    servicePrivate.status = Status.connecting;
    servicePrivate.connectionEstablished = false;
    servicePrivate.clientConnectionAttemptIds.set(client, 1);

    const readyConfirmation = servicePrivate.confirmReadyAndMarkConnected(
      client,
      1,
      null,
      'ready'
    );
    await jest.advanceTimersByTimeAsync(0);

    expect(healthCheckService.verifyCurrentSession).toHaveBeenCalledTimes(2);
    expect(mockEmitWorkerProviderRuntimeState).toHaveBeenCalledWith(
      'wwebjs',
      true
    );

    const staleRetry = jest.fn();
    servicePrivate.disconnectRetryTimer = setTimeout(staleRetry, 1);
    const disconnecting = service.disconnect({});
    expect(
      servicePrivate.clientConnectionAttemptIds.get(client)
    ).toBeUndefined();
    expect(servicePrivate.client).toBeUndefined();
    await jest.advanceTimersByTimeAsync(1);
    expect(staleRetry).not.toHaveBeenCalled();

    resolveSecondReadiness?.(readyState);
    await expect(readyConfirmation).resolves.toBe(false);

    expect(incomingMessageService.markConnectionReady).not.toHaveBeenCalled();
    expect(healthCheckService.markStatusPublished).not.toHaveBeenCalled();
    expect(centrifugo.publishSub).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ worker_status_id: EWorkerStatus.online })
    );
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus.mock.calls.some(
        ([payload]) => payload.worker_status_id === EWorkerStatus.online
      )
    ).toBe(false);

    releaseDisconnectNotification?.();
    await disconnecting;
    expect(client.destroy).toHaveBeenCalledTimes(1);
    expect(mockEmitWorkerProviderRuntimeState).toHaveBeenCalledWith(
      'wwebjs',
      false
    );
  });

  it('waits for disconnect teardown before starting a concurrent connection', async () => {
    const { service, servicePrivate, healthCheckService } = makeService();
    const client = {
      destroy: jest.fn(async () => undefined),
    };
    let releaseDisconnectNotification: (() => void) | undefined;
    healthCheckService.notifyDisconnected.mockReturnValueOnce(
      new Promise<undefined>((resolve) => {
        releaseDisconnectNotification = () => resolve(undefined);
      })
    );
    const nextState = {
      status: Status.connecting,
      worker_id: 'worker-w',
      account_id: 'account-w',
      code: ECodeMessage.awaitConnection,
    };
    const startConnection = jest
      .spyOn(servicePrivate, 'startConnection')
      .mockResolvedValue(nextState);
    servicePrivate.client = client;
    servicePrivate.status = Status.connecting;
    servicePrivate.connectionEstablished = false;
    servicePrivate.clientConnectionAttemptIds.set(client, 1);

    const disconnecting = service.disconnect({});
    await jest.advanceTimersByTimeAsync(0);
    const connecting = service.connect({
      initial_connection: true,
      requested_by_user: true,
      type: EBaileysConnectionType.qrcode,
    });
    await Promise.resolve();

    expect(startConnection).not.toHaveBeenCalled();
    expect(client.destroy).not.toHaveBeenCalled();

    releaseDisconnectNotification?.();
    await expect(disconnecting).resolves.toBeUndefined();
    await expect(connecting).resolves.toEqual(nextState);

    expect(client.destroy).toHaveBeenCalledTimes(1);
    expect(startConnection).toHaveBeenCalledTimes(1);
  });

  it('queues a stronger concurrent disconnect without losing its parameters', async () => {
    const { service, servicePrivate, healthCheckService } = makeService();
    const client = {
      destroy: jest.fn(async () => undefined),
    };
    let releaseFirstDisconnect: (() => void) | undefined;
    healthCheckService.notifyDisconnected.mockReturnValueOnce(
      new Promise<undefined>((resolve) => {
        releaseFirstDisconnect = () => resolve(undefined);
      })
    );
    const clearFolder = jest
      .spyOn(servicePrivate, 'clearFolder')
      .mockImplementation(() => undefined);
    const purgeQuarantine = jest
      .spyOn(servicePrivate, 'purgeCurrentSessionQuarantine')
      .mockImplementation(() => undefined);
    servicePrivate.client = client;
    servicePrivate.status = Status.connecting;
    servicePrivate.connectionEstablished = false;
    servicePrivate.clientConnectionAttemptIds.set(client, 1);

    const preservingDisconnect = service.disconnect({
      preserve_session: true,
    });
    await jest.advanceTimersByTimeAsync(0);
    const removingDisconnect = service.disconnect({
      preserve_session: false,
      remove_session: true,
      disconnected_user: true,
    });

    expect(clearFolder).not.toHaveBeenCalled();
    releaseFirstDisconnect?.();
    await expect(preservingDisconnect).resolves.toBeUndefined();
    await expect(removingDisconnect).resolves.toBeUndefined();

    expect(client.destroy).toHaveBeenCalledTimes(1);
    expect(clearFolder).toHaveBeenCalledTimes(1);
    expect(purgeQuarantine).toHaveBeenCalledWith(true);
    expect(
      mockEmitWorkerProviderRuntimeState.mock.calls.map(([, ready]) => ready)
    ).toEqual([false, false]);
  });

  it('fails closed after bounded Kafka stop retries during disconnect', async () => {
    const { service, servicePrivate } = makeService();
    const client = {
      destroy: jest.fn(async () => undefined),
    };
    mockEmitWorkerProviderRuntimeState.mockRejectedValue(
      new Error('kafka_stop_failed')
    );
    const startConnection = jest
      .spyOn(servicePrivate, 'startConnection')
      .mockResolvedValue({
        status: Status.connecting,
        worker_id: 'worker-w',
        account_id: 'account-w',
        code: ECodeMessage.awaitConnection,
      });
    servicePrivate.client = client;
    servicePrivate.status = Status.connecting;
    servicePrivate.connectionEstablished = false;
    servicePrivate.clientConnectionAttemptIds.set(client, 1);

    const disconnecting = service.disconnect({});
    const connecting = service.connect({
      initial_connection: true,
      requested_by_user: true,
      type: EBaileysConnectionType.qrcode,
    });

    await expect(disconnecting).rejects.toThrow('kafka_stop_failed');
    await expect(connecting).rejects.toThrow('kafka_stop_failed');

    expect(client.destroy).toHaveBeenCalledTimes(1);
    expect(startConnection).not.toHaveBeenCalled();
    expect(
      mockEmitWorkerProviderRuntimeState.mock.calls.map(([, ready]) => ready)
    ).toEqual([false, false, false]);

    mockEmitWorkerProviderRuntimeState.mockResolvedValue(undefined);
    await expect(
      service.connect({
        initial_connection: true,
        requested_by_user: true,
        type: EBaileysConnectionType.qrcode,
      })
    ).resolves.toEqual(expect.objectContaining({ status: Status.connecting }));

    expect(startConnection).toHaveBeenCalledTimes(1);
    expect(
      mockEmitWorkerProviderRuntimeState.mock.calls.map(([, ready]) => ready)
    ).toEqual([false, false, false, false]);
  });

  it('waits for an in-flight online publication even when Kafka stop fails', async () => {
    const {
      service,
      servicePrivate,
      balanceWorkerStatusGrpcClientService,
      healthCheckService,
    } = makeService();
    const client = {
      destroy: jest.fn(async () => undefined),
      info: {
        wid: {
          _serialized: '5511999999999@c.us',
        },
      },
    };
    let releaseOnlineNotification: (() => void) | undefined;
    let markOnlineNotificationStarted: (() => void) | undefined;
    const onlineNotificationStarted = new Promise<void>((resolve) => {
      markOnlineNotificationStarted = resolve;
    });
    const onlineNotificationBarrier = new Promise<void>((resolve) => {
      releaseOnlineNotification = resolve;
    });
    balanceWorkerStatusGrpcClientService.notifyWorkerStatus.mockImplementation(
      async (payload) => {
        if (payload.worker_status_id === EWorkerStatus.online) {
          markOnlineNotificationStarted?.();
          await onlineNotificationBarrier;
        }
      }
    );
    mockEmitWorkerProviderRuntimeState.mockImplementation(
      async (_provider, ready) => {
        if (!ready) {
          throw new Error('kafka_stop_failed');
        }
      }
    );
    servicePrivate.client = client;
    servicePrivate.status = Status.connecting;
    servicePrivate.connectionEstablished = false;
    servicePrivate.clientConnectionAttemptIds.set(client, 1);

    const confirmation = servicePrivate.confirmReadyAndMarkConnected(
      client,
      1,
      null,
      'ready'
    );
    await onlineNotificationStarted;
    const disconnecting = service.disconnect({});
    await jest.advanceTimersByTimeAsync(0);

    expect(healthCheckService.notifyDisconnected).not.toHaveBeenCalled();
    releaseOnlineNotification?.();
    await expect(confirmation).resolves.toBe(false);
    await expect(disconnecting).rejects.toThrow('kafka_stop_failed');

    expect(healthCheckService.notifyDisconnected).toHaveBeenCalledTimes(1);
    expect(client.destroy).toHaveBeenCalledTimes(1);
    expect(
      mockEmitWorkerProviderRuntimeState.mock.calls.map(([, ready]) => ready)
    ).toEqual([true, false, false, false]);
  });

  it('rejects an online publication when the runtime lease is revoked', async () => {
    const {
      servicePrivate,
      centrifugo,
      balanceWorkerStatusGrpcClientService,
      incomingMessageService,
      healthCheckService,
    } = makeService();
    const client = {
      info: {
        wid: {
          _serialized: '5511999999999@c.us',
        },
      },
    };
    const readyState = {
      session_ready: true,
      can_send: true,
      can_receive_runtime: true,
      authenticated: true,
      provider_state: 'CONNECTED',
      last_probe_at: new Date().toISOString(),
      probe_latency_ms: 1,
    };
    let resolveSecondReadiness:
      ((value: typeof readyState) => void) | undefined;
    healthCheckService.verifyCurrentSession
      .mockResolvedValueOnce(readyState)
      .mockReturnValueOnce(
        new Promise<typeof readyState>((resolve) => {
          resolveSecondReadiness = resolve;
        })
      );
    servicePrivate.client = client;
    servicePrivate.status = Status.connecting;
    servicePrivate.connectionEstablished = false;
    servicePrivate.clientConnectionAttemptIds.set(client, 1);

    const confirmation = servicePrivate.confirmReadyAndMarkConnected(
      client,
      1,
      null,
      'ready'
    );
    await jest.advanceTimersByTimeAsync(0);

    expect(mockEmitWorkerProviderRuntimeState).toHaveBeenCalledWith(
      'wwebjs',
      true
    );
    servicePrivate.stopProviderRuntime('late lifecycle state');
    expect(servicePrivate.clientConnectionAttemptIds.get(client)).toBe(1);
    resolveSecondReadiness?.(readyState);

    await expect(confirmation).resolves.toBe(false);
    expect(incomingMessageService.markConnectionReady).not.toHaveBeenCalled();
    expect(healthCheckService.markStatusPublished).not.toHaveBeenCalled();
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus.mock.calls.some(
        ([payload]) => payload.worker_status_id === EWorkerStatus.online
      )
    ).toBe(false);
    expect(centrifugo.publishSub).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ worker_status_id: EWorkerStatus.online })
    );
    expect(
      mockEmitWorkerProviderRuntimeState.mock.calls.map(([, ready]) => ready)
    ).toEqual([true, false]);
  });

  it('fails closed and allows a retry when the online status notification fails', async () => {
    const {
      servicePrivate,
      centrifugo,
      balanceWorkerStatusGrpcClientService,
      incomingMessageService,
      healthCheckService,
    } = makeService();
    const client = {
      info: {
        wid: {
          _serialized: '5511999999999@c.us',
        },
      },
    };

    servicePrivate.client = client;
    servicePrivate.status = Status.connecting;
    servicePrivate.clientConnectionAttemptIds.set(client, 1);
    balanceWorkerStatusGrpcClientService.notifyWorkerStatus.mockRejectedValueOnce(
      Object.assign(
        new Error(
          '9 FAILED_PRECONDITION: worker_online_readiness_rejected:worker_snapshot_unavailable'
        ),
        {
          code: 9,
          details:
            'worker_online_readiness_rejected:worker_snapshot_unavailable',
        }
      )
    );

    await expect(
      servicePrivate.confirmReadyAndMarkConnected(client, 1, null, 'ready')
    ).resolves.toBe(false);

    expect(servicePrivate.status).toBe(Status.connecting);
    expect(servicePrivate.connectionEstablished).toBe(false);
    expect(incomingMessageService.markConnectionReady).toHaveBeenCalledTimes(1);
    expect(
      incomingMessageService.markConnectionUnavailable
    ).not.toHaveBeenCalled();
    expect(healthCheckService.markStatusPublished).not.toHaveBeenCalled();
    expect(centrifugo.publishSub).not.toHaveBeenCalled();
    expect(
      mockEmitWorkerProviderRuntimeState.mock.calls.map(([, ready]) => ready)
    ).toEqual([true]);

    await expect(
      servicePrivate.confirmReadyAndMarkConnected(
        client,
        1,
        null,
        'state_probe'
      )
    ).resolves.toBe(true);

    expect(servicePrivate.status).toBe(Status.connected);
    expect(servicePrivate.connectionEstablished).toBe(true);
    expect(incomingMessageService.markConnectionReady).toHaveBeenCalledTimes(2);
    expect(healthCheckService.markStatusPublished).toHaveBeenCalledTimes(1);
    expect(centrifugo.publishSub).not.toHaveBeenCalled();
    expect(
      mockEmitWorkerProviderRuntimeState.mock.calls.map(([, ready]) => ready)
    ).toEqual([true, true]);
  });

  it('revokes the runtime and does not retry a terminal online status rejection', async () => {
    const {
      servicePrivate,
      balanceWorkerStatusGrpcClientService,
      incomingMessageService,
      healthCheckService,
    } = makeService();
    const client = {
      info: {
        wid: {
          _serialized: '5511999999999@c.us',
        },
      },
    };
    const scheduleKafkaReadinessRetry = jest.spyOn(
      servicePrivate,
      'scheduleKafkaReadinessRetry'
    );
    servicePrivate.client = client;
    servicePrivate.status = Status.connecting;
    servicePrivate.clientConnectionAttemptIds.set(client, 1);
    balanceWorkerStatusGrpcClientService.notifyWorkerStatus.mockRejectedValueOnce(
      Object.assign(
        new Error(
          '9 FAILED_PRECONDITION: worker_online_readiness_rejected:runtime_generation_mismatch'
        ),
        {
          code: 9,
          details:
            'worker_online_readiness_rejected:runtime_generation_mismatch',
        }
      )
    );

    await expect(
      servicePrivate.confirmReadyAndMarkConnected(client, 1, null, 'ready')
    ).resolves.toBe(false);

    expect(servicePrivate.status).toBe(Status.connecting);
    expect(servicePrivate.connectionEstablished).toBe(false);
    expect(
      incomingMessageService.markConnectionUnavailable
    ).toHaveBeenCalledWith(client);
    expect(healthCheckService.stop).toHaveBeenCalledTimes(1);
    expect(scheduleKafkaReadinessRetry).not.toHaveBeenCalled();
    expect(
      mockEmitWorkerProviderRuntimeState.mock.calls.map(([, ready]) => ready)
    ).toEqual([true, false]);
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).toHaveBeenCalledTimes(1);
  });

  it('does not start Kafka consumers when the client is replaced during readiness verification', async () => {
    const {
      servicePrivate,
      centrifugo,
      balanceWorkerStatusGrpcClientService,
      incomingMessageService,
      healthCheckService,
    } = makeService();
    const client = {};
    const replacementClient = {};
    let resolveVerification:
      | ((
          value: Awaited<
            ReturnType<typeof healthCheckService.verifyCurrentSession>
          >
        ) => void)
      | undefined;
    const verification = new Promise<
      Awaited<ReturnType<typeof healthCheckService.verifyCurrentSession>>
    >((resolve) => {
      resolveVerification = resolve;
    });
    healthCheckService.verifyCurrentSession.mockReturnValueOnce(verification);

    servicePrivate.client = client;
    servicePrivate.status = Status.connecting;
    servicePrivate.clientConnectionAttemptIds.set(client, 1);
    const confirmation = servicePrivate.confirmReadyAndMarkConnected(
      client,
      1,
      null,
      'ready'
    );

    servicePrivate.client = replacementClient;
    servicePrivate.clientConnectionAttemptIds.set(replacementClient, 2);
    resolveVerification?.({
      session_ready: true,
      can_send: true,
      can_receive_runtime: true,
      authenticated: true,
      provider_state: 'CONNECTED',
      last_probe_at: new Date().toISOString(),
      probe_latency_ms: 1,
    });

    await expect(confirmation).resolves.toBe(false);
    expect(mockEmitWorkerProviderRuntimeState).not.toHaveBeenCalledWith(
      'wwebjs',
      true
    );
    expect(incomingMessageService.markConnectionReady).not.toHaveBeenCalled();
    expect(healthCheckService.markStatusPublished).not.toHaveBeenCalled();
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).not.toHaveBeenCalled();
    expect(centrifugo.publishSub).not.toHaveBeenCalled();
  });

  it('does not publish stale status when the client is replaced during the Kafka barrier', async () => {
    const {
      servicePrivate,
      centrifugo,
      balanceWorkerStatusGrpcClientService,
      incomingMessageService,
      healthCheckService,
    } = makeService();
    const client = {};
    const replacementClient = {};
    let releaseKafkaBarrier: (() => void) | undefined;
    const kafkaBarrier = new Promise<void>((resolve) => {
      releaseKafkaBarrier = resolve;
    });
    mockEmitWorkerProviderRuntimeState.mockImplementation(
      async (_provider: string, ready: boolean) => {
        if (ready) {
          await kafkaBarrier;
        }
      }
    );

    servicePrivate.client = client;
    servicePrivate.status = Status.connecting;
    servicePrivate.clientConnectionAttemptIds.set(client, 1);
    const confirmation = servicePrivate.confirmReadyAndMarkConnected(
      client,
      1,
      null,
      'ready'
    );
    await jest.advanceTimersByTimeAsync(0);
    expect(mockEmitWorkerProviderRuntimeState).toHaveBeenCalledWith(
      'wwebjs',
      true
    );

    servicePrivate.client = replacementClient;
    servicePrivate.clientConnectionAttemptIds.set(replacementClient, 2);
    releaseKafkaBarrier?.();

    await expect(confirmation).resolves.toBe(false);
    expect(servicePrivate.status).toBe(Status.connecting);
    expect(servicePrivate.connectionEstablished).toBe(false);
    expect(incomingMessageService.markConnectionReady).not.toHaveBeenCalled();
    expect(healthCheckService.markStatusPublished).not.toHaveBeenCalled();
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).not.toHaveBeenCalled();
    expect(centrifugo.publishSub).not.toHaveBeenCalled();
    expect(
      mockEmitWorkerProviderRuntimeState.mock.calls.map(([, ready]) => ready)
    ).toEqual([true, false]);
  });

  it('publishes a fail-closed Kafka state when the runtime was not preserved', async () => {
    const {
      servicePrivate,
      centrifugo,
      balanceWorkerStatusGrpcClientService,
      incomingMessageService,
    } = makeService();
    const client = {
      info: {
        wid: {
          _serialized: '5511999999999@c.us',
        },
      },
    };
    mockEmitWorkerProviderRuntimeState.mockImplementation(
      async (_provider: string, ready: boolean) => {
        if (ready) {
          throw new Error('kafka_barrier_failed');
        }
      }
    );

    servicePrivate.client = client;
    servicePrivate.status = Status.connecting;
    servicePrivate.clientConnectionAttemptIds.set(client, 1);

    await expect(
      servicePrivate.confirmReadyAndMarkConnected(client, 1, null, 'ready')
    ).resolves.toBe(false);

    expect(
      mockEmitWorkerProviderRuntimeState.mock.calls.map(([, ready]) => ready)
    ).toEqual([true, false]);
    expect(servicePrivate.status).toBe(Status.connecting);
    expect(servicePrivate.connectionEstablished).toBe(false);
    expect(incomingMessageService.markConnectionReady).not.toHaveBeenCalled();
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_status_id: EWorkerStatus.disponible,
        provider_state: 'kafka_consumers_not_ready',
        degraded_reason: 'kafka_barrier_failed',
      })
    );
    expect(centrifugo.publishSub).not.toHaveBeenCalled();
    const notifiedStatuses =
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus.mock.calls.map(
        ([payload]) => payload.worker_status_id
      );
    expect(notifiedStatuses).toEqual([EWorkerStatus.disponible]);
  });

  it('retries only the Kafka readiness barrier and preserves the WhatsApp client', async () => {
    const {
      servicePrivate,
      balanceWorkerStatusGrpcClientService,
      incomingMessageService,
    } = makeService();
    const client = {
      destroy: jest.fn(async () => undefined),
      info: {
        wid: {
          _serialized: '5511999999999@c.us',
        },
      },
    };
    let kafkaStartAttempts = 0;
    mockEmitWorkerProviderRuntimeState.mockImplementation(
      async (_provider: string, ready: boolean) => {
        if (ready && ++kafkaStartAttempts === 1) {
          throw new Error('kafka_temporarily_unavailable');
        }
      }
    );

    servicePrivate.client = client;
    servicePrivate.status = Status.connecting;
    servicePrivate.connectionEstablished = false;
    servicePrivate.clientConnectionAttemptIds.set(client, 1);

    await expect(
      servicePrivate.confirmReadyAndMarkConnected(client, 1, null, 'ready')
    ).resolves.toBe(false);

    expect(servicePrivate.client).toBe(client);
    expect(client.destroy).not.toHaveBeenCalled();
    expect(servicePrivate.status).toBe(Status.connecting);

    await jest.advanceTimersByTimeAsync(5_000);

    expect(servicePrivate.client).toBe(client);
    expect(client.destroy).not.toHaveBeenCalled();
    expect(servicePrivate.status).toBe(Status.connected);
    expect(servicePrivate.connectionEstablished).toBe(true);
    expect(incomingMessageService.markConnectionReady).toHaveBeenCalledTimes(1);
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_status_id: EWorkerStatus.online,
        connection_epoch: '00000000-0000-4000-8000-000000000072',
        connection_sequence: 8,
      })
    );
  });

  it('does not stop a current provider while a superseded Kafka startup is retried', async () => {
    const { servicePrivate } = makeService();
    const client = {
      destroy: jest.fn(async () => undefined),
      info: {
        wid: {
          _serialized: '5511999999999@c.us',
        },
      },
    };
    let readyAttempts = 0;
    mockEmitWorkerProviderRuntimeState.mockImplementation(
      async (_provider: string, ready: boolean) => {
        if (ready && ++readyAttempts === 1) {
          throw new Error(
            'wwebjs_provider_became_unavailable_during_consumer_startup'
          );
        }
      }
    );

    servicePrivate.client = client;
    servicePrivate.status = Status.connecting;
    servicePrivate.connectionEstablished = false;
    servicePrivate.clientConnectionAttemptIds.set(client, 17);

    await expect(
      servicePrivate.confirmReadyAndMarkConnected(client, 17, null, 'ready')
    ).resolves.toBe(false);
    expect(
      mockEmitWorkerProviderRuntimeState.mock.calls.map(([, ready]) => ready)
    ).toEqual([true]);

    await jest.advanceTimersByTimeAsync(5_000);

    expect(servicePrivate.client).toBe(client);
    expect(client.destroy).not.toHaveBeenCalled();
    expect(servicePrivate.status).toBe(Status.connected);
    expect(servicePrivate.connectionEstablished).toBe(true);
    expect(
      mockEmitWorkerProviderRuntimeState.mock.calls.map(([, ready]) => ready)
    ).toEqual([true, true]);
  });

  it('never reaches the destructive session probe timeout while only Kafka is unavailable', async () => {
    const { servicePrivate } = makeService();
    const client = {
      destroy: jest.fn(async () => undefined),
      info: {
        wid: {
          _serialized: '5511999999999@c.us',
        },
      },
    };
    mockEmitWorkerProviderRuntimeState.mockImplementation(
      async (_provider: string, ready: boolean) => {
        if (ready) {
          throw new Error('kafka_still_unavailable');
        }
      }
    );

    servicePrivate.client = client;
    servicePrivate.status = Status.connecting;
    servicePrivate.connectionEstablished = false;
    servicePrivate.clientConnectionAttemptIds.set(client, 1);

    await expect(
      servicePrivate.confirmReadyAndMarkConnected(client, 1, null, 'ready')
    ).resolves.toBe(false);
    await jest.advanceTimersByTimeAsync(120_001);

    expect(servicePrivate.client).toBe(client);
    expect(client.destroy).not.toHaveBeenCalled();
    expect(servicePrivate.status).toBe(Status.connecting);
    expect(servicePrivate.connectionEstablished).toBe(false);

    servicePrivate.cancelKafkaReadinessRetry();
  });

  it('propagates runtime generation through verified online publication', async () => {
    const { service, servicePrivate, balanceWorkerStatusGrpcClientService } =
      makeService();
    const client = {
      info: {
        wid: {
          _serialized: '5511999999999@c.us',
        },
      },
    };
    servicePrivate.client = client;
    servicePrivate.status = Status.connected;
    servicePrivate.connectionEstablished = true;
    servicePrivate.clientConnectionAttemptIds.set(client, 1);

    await expect(
      service.verifyAndPublishConnectionStatus({
        connection_attempt_id: 'attempt-generation',
        runtime_generation: 23,
        debug_trace_id: 'trace-generation',
      })
    ).resolves.toEqual(
      expect.objectContaining({
        worker_status_id: EWorkerStatus.online,
        runtime_generation: 23,
      })
    );

    expect(servicePrivate.runtimeGeneration).toBe(23);
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        connection_attempt_id: 'attempt-generation',
        runtime_generation: 23,
        debug_trace_id: 'trace-generation',
      })
    );
  });

  it('does not publish verified status for a client replaced during readiness verification', async () => {
    const {
      service,
      servicePrivate,
      centrifugo,
      balanceWorkerStatusGrpcClientService,
      incomingMessageService,
      healthCheckService,
    } = makeService();
    const client = {};
    const replacementClient = {};
    let resolveVerification:
      | ((
          value: Awaited<
            ReturnType<typeof healthCheckService.verifyCurrentSession>
          >
        ) => void)
      | undefined;
    healthCheckService.verifyCurrentSession.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveVerification = resolve;
      })
    );
    servicePrivate.client = client;
    servicePrivate.status = Status.connected;
    servicePrivate.connectionEstablished = true;
    servicePrivate.clientConnectionAttemptIds.set(client, 1);

    const verification = service.verifyAndPublishConnectionStatus();
    servicePrivate.client = replacementClient;
    servicePrivate.clientConnectionAttemptIds.set(replacementClient, 2);
    resolveVerification?.({
      session_ready: true,
      can_send: true,
      can_receive_runtime: true,
      authenticated: true,
      provider_state: 'CONNECTED',
      last_probe_at: new Date().toISOString(),
      probe_latency_ms: 1,
    });
    await verification;

    expect(mockEmitWorkerProviderRuntimeState).not.toHaveBeenCalled();
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).not.toHaveBeenCalled();
    expect(incomingMessageService.markConnectionReady).not.toHaveBeenCalled();
    expect(healthCheckService.markStatusPublished).not.toHaveBeenCalled();
    expect(centrifugo.publishSub).not.toHaveBeenCalled();
  });

  it('keeps verified status pending and retries after an online notification failure', async () => {
    const {
      service,
      servicePrivate,
      centrifugo,
      balanceWorkerStatusGrpcClientService,
      incomingMessageService,
      healthCheckService,
    } = makeService();
    const client = {
      info: {
        wid: {
          _serialized: '5511999999999@c.us',
        },
      },
    };
    const kafkaReadinessRetry = jest.spyOn(
      servicePrivate,
      'scheduleKafkaReadinessRetry'
    );
    servicePrivate.client = client;
    servicePrivate.status = Status.connected;
    servicePrivate.connectionEstablished = true;
    servicePrivate.clientConnectionAttemptIds.set(client, 1);
    const secret =
      'postgres://worker:password@database:5432/underchat capability-secret qr-secret session-secret';
    balanceWorkerStatusGrpcClientService.notifyWorkerStatus.mockRejectedValueOnce(
      Object.assign(new Error(secret), { code: 'ECONNRESET' })
    );

    const pendingState = await service.verifyAndPublishConnectionStatus();
    expect(pendingState).toEqual(
      expect.objectContaining({
        status: Status.connecting,
        worker_status_id: EWorkerStatus.disponible,
        provider_state: 'worker_status_not_published',
        degraded_reason: 'worker_status_notification_failed:econnreset',
      })
    );
    expect(JSON.stringify(pendingState)).not.toContain(secret);

    expect(servicePrivate.connectionEstablished).toBe(false);
    expect(kafkaReadinessRetry).toHaveBeenCalledWith(client, 1, null);
    expect(incomingMessageService.markConnectionReady).toHaveBeenCalledTimes(1);
    expect(
      incomingMessageService.markConnectionUnavailable
    ).not.toHaveBeenCalled();
    expect(healthCheckService.markStatusPublished).not.toHaveBeenCalled();
    expect(centrifugo.publishSub).not.toHaveBeenCalled();
    expect(
      mockEmitWorkerProviderRuntimeState.mock.calls.map(([, ready]) => ready)
    ).toEqual([true]);

    await expect(service.verifyAndPublishConnectionStatus()).resolves.toEqual(
      expect.objectContaining({
        status: Status.connected,
        worker_status_id: EWorkerStatus.online,
      })
    );

    expect(servicePrivate.connectionEstablished).toBe(true);
    expect(incomingMessageService.markConnectionReady).toHaveBeenCalledTimes(2);
    expect(healthCheckService.markStatusPublished).toHaveBeenCalledTimes(1);
    expect(centrifugo.publishSub).not.toHaveBeenCalled();
    expect(
      mockEmitWorkerProviderRuntimeState.mock.calls.map(([, ready]) => ready)
    ).toEqual([true, true]);
  });

  it('waits for the verified Kafka barrier and publishes no online state when cancelled', async () => {
    const {
      service,
      servicePrivate,
      centrifugo,
      balanceWorkerStatusGrpcClientService,
      incomingMessageService,
      healthCheckService,
    } = makeService();
    const client = {
      destroy: jest.fn(async () => undefined),
      info: {
        wid: {
          _serialized: '5511999999999@c.us',
        },
      },
    };
    let releaseKafkaBarrier: (() => void) | undefined;
    const kafkaBarrier = new Promise<void>((resolve) => {
      releaseKafkaBarrier = resolve;
    });
    mockEmitWorkerProviderRuntimeState.mockImplementation(
      async (_provider: string, ready: boolean) => {
        if (ready) {
          await kafkaBarrier;
        }
      }
    );
    servicePrivate.client = client;
    servicePrivate.status = Status.connected;
    servicePrivate.connectionEstablished = true;
    servicePrivate.clientConnectionAttemptIds.set(client, 1);

    const verification = service.verifyAndPublishConnectionStatus();
    await jest.advanceTimersByTimeAsync(0);

    expect(mockEmitWorkerProviderRuntimeState).toHaveBeenCalledWith(
      'wwebjs',
      true
    );
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).not.toHaveBeenCalled();
    expect(centrifugo.publishSub).not.toHaveBeenCalled();

    servicePrivate.cancelAttempt(false);
    expect(mockEmitWorkerProviderRuntimeState).toHaveBeenCalledWith(
      'wwebjs',
      false
    );
    releaseKafkaBarrier?.();
    await verification;

    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).not.toHaveBeenCalled();
    expect(incomingMessageService.markConnectionReady).not.toHaveBeenCalled();
    expect(healthCheckService.markStatusPublished).not.toHaveBeenCalled();
    expect(centrifugo.publishSub).not.toHaveBeenCalled();
    expect(
      mockEmitWorkerProviderRuntimeState.mock.calls.map(([, ready]) => ready)
    ).toEqual([true, false]);
  });

  it('keeps secure import restore attempts open past the QR guard window', async () => {
    const { servicePrivate } = makeService();

    servicePrivate.status = Status.connecting;
    servicePrivate.connectionEstablished = false;
    servicePrivate.qrReadSessionActive = false;
    servicePrivate.activeConnectionAttemptId = 1;
    servicePrivate.connectionAttemptStartedAtMs = Date.now();

    const resolveQrTimeoutSpy = jest.spyOn(
      servicePrivate,
      'resolveQrAttemptTimeout'
    );
    const pendingRestore = new Promise<IBaileysConnectionState>(() => {});
    const guarded = servicePrivate.withConnectionAttemptGuardTimeout(
      pendingRestore,
      1,
      true
    );

    await jest.advanceTimersByTimeAsync(120_001);

    await expect(
      Promise.race([guarded, Promise.resolve('pending')])
    ).resolves.toBe('pending');
    expect(resolveQrTimeoutSpy).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(60_000);

    await expect(guarded).resolves.toEqual(
      expect.objectContaining({
        status: Status.connecting,
      })
    );
    expect(resolveQrTimeoutSpy).not.toHaveBeenCalled();
  });

  it('tears down the active client before reconnecting after a health-check disconnect', () => {
    const { servicePrivate, healthCheckService } = makeService();

    servicePrivate.client = {};
    servicePrivate.status = Status.connected;
    servicePrivate.connectionEstablished = true;

    const cancelAttemptSpy = jest
      .spyOn(servicePrivate, 'cancelAttempt')
      .mockImplementation(() => {
        servicePrivate.connectionEstablished = false;
      });

    servicePrivate.handleHealthCheckMismatch(Status.disconnected);

    expect(cancelAttemptSpy).toHaveBeenCalledWith(false);
    expect(healthCheckService.stop).toHaveBeenCalled();
    expect(servicePrivate.connectionEstablished).toBe(false);
  });

  it('destroys the captured client when cancel teardown runs asynchronously', async () => {
    const { servicePrivate } = makeService();

    const oldClient = {
      destroy: jest.fn(async () => undefined),
    };
    const newClient = {
      destroy: jest.fn(async () => undefined),
    };

    servicePrivate.client = oldClient;

    servicePrivate.cancelAttempt(false);
    servicePrivate.client = newClient;

    await servicePrivate.waitForPendingTeardown();

    expect(oldClient.destroy).toHaveBeenCalledTimes(1);
    expect(newClient.destroy).not.toHaveBeenCalled();
    expect(servicePrivate.client).toBe(newClient);
  });

  it('releases a secure-import lifecycle lease when restore rejects before a client starts', async () => {
    const { service, servicePrivate } = makeService();
    jest.spyOn(service, 'connect').mockRejectedValue(new Error('start_failed'));
    const releaseLease = jest.mocked(
      servicePrivate.releaseSessionLifecycleLease
    );

    servicePrivate.startSecureImportRestore({
      connection_attempt_id: 'secure-attempt',
      runtime_generation: 7,
      debug_trace_id: 'secure-trace',
    });
    await jest.advanceTimersByTimeAsync(0);

    expect(servicePrivate.client).toBeUndefined();
    expect(releaseLease).toHaveBeenCalledTimes(1);
  });

  it('serializes simultaneous secure imports before either can mutate the profile', async () => {
    const { service, servicePrivate } = makeService();
    const securePackage = {
      format_version: 'underchat-wa-web-session-v1',
      source: 'whatsapp_web',
      target_provider: 'wwebjs',
      payload: {
        wwebjs_local_auth: {
          files: {
            'Default/Cookies': { data: 'cookie-data', encoding: 'utf8' },
          },
        },
      },
    };
    (
      service as unknown as { redis: { get: jest.Mock } }
    ).redis.get.mockResolvedValue(JSON.stringify(securePackage));
    jest.spyOn(servicePrivate, 'cancelAttempt').mockImplementation(() => {});
    jest
      .spyOn(servicePrivate, 'waitForPendingTeardown')
      .mockResolvedValue(undefined);
    jest
      .spyOn(servicePrivate, 'clearChromiumProfileLock')
      .mockImplementation(() => {});
    jest.spyOn(servicePrivate, 'prepareFolder').mockImplementation(() => {});
    jest.spyOn(service, 'connect').mockResolvedValue({
      status: Status.connecting,
      code: ECodeMessage.awaitConnection,
      worker_id: 'worker-w',
      account_id: 'account-w',
    });

    let releaseFirstImport: (() => void) | undefined;
    const firstImportGate = new Promise<void>((resolve) => {
      releaseFirstImport = resolve;
    });
    let activeImports = 0;
    let maxActiveImports = 0;
    let importCall = 0;
    mockImportWhatsAppWebSessionToLocalAuth.mockImplementation(async () => {
      importCall += 1;
      activeImports += 1;
      maxActiveImports = Math.max(maxActiveImports, activeImports);
      if (importCall === 1) {
        await firstImportGate;
      }
      activeImports -= 1;
      return {
        formatVersion: securePackage.format_version,
        importedFiles: ['Default/Cookies'],
      };
    });

    const request = {
      account_id: 'account-w',
      format_version: securePackage.format_version,
      payload_ref: 'payload-ref',
      source: 'whatsapp_web' as const,
      target_provider: 'wwebjs' as const,
      worker_id: 'worker-w',
      worker_type_id: '019a930d-c6f6-766d-9c84-62b9c3e7d1f0' as never,
    };
    const first = service.importSecureSession({
      ...request,
      connection_attempt_id: 'secure-attempt-1',
    });
    await jest.advanceTimersByTimeAsync(0);
    const second = service.importSecureSession({
      ...request,
      connection_attempt_id: 'secure-attempt-2',
    });
    await jest.advanceTimersByTimeAsync(0);

    expect(mockImportWhatsAppWebSessionToLocalAuth).toHaveBeenCalledTimes(1);
    expect(maxActiveImports).toBe(1);

    releaseFirstImport?.();
    await Promise.all([first, second]);

    expect(mockImportWhatsAppWebSessionToLocalAuth).toHaveBeenCalledTimes(2);
    expect(maxActiveImports).toBe(1);
  });

  it('serializes a removing disconnect behind an in-flight secure import', async () => {
    const { service, servicePrivate } = makeService();
    const securePackage = {
      format_version: 'underchat-wa-web-session-v1',
      source: 'whatsapp_web',
      target_provider: 'wwebjs',
      payload: {
        wwebjs_local_auth: {
          files: {
            'Default/Cookies': { data: 'cookie-data', encoding: 'utf8' },
          },
        },
      },
    };
    (
      service as unknown as { redis: { get: jest.Mock } }
    ).redis.get.mockResolvedValue(JSON.stringify(securePackage));
    jest.spyOn(servicePrivate, 'cancelAttempt').mockImplementation(() => {});
    jest
      .spyOn(servicePrivate, 'waitForPendingTeardown')
      .mockResolvedValue(undefined);
    jest
      .spyOn(servicePrivate, 'clearChromiumProfileLock')
      .mockImplementation(() => {});
    jest.spyOn(servicePrivate, 'prepareFolder').mockImplementation(() => {});
    jest.spyOn(service, 'connect').mockResolvedValue({
      status: Status.connecting,
      code: ECodeMessage.awaitConnection,
      worker_id: 'worker-w',
      account_id: 'account-w',
    });

    let releaseImport: (() => void) | undefined;
    let importWriting = false;
    mockImportWhatsAppWebSessionToLocalAuth.mockImplementation(async () => {
      importWriting = true;
      await new Promise<void>((resolve) => {
        releaseImport = resolve;
      });
      importWriting = false;
      return {
        formatVersion: securePackage.format_version,
        importedFiles: ['Default/Cookies'],
      };
    });
    const clearFolder = jest
      .spyOn(servicePrivate, 'clearFolder')
      .mockImplementation(() => {
        expect(importWriting).toBe(false);
      });
    jest
      .spyOn(servicePrivate, 'purgeCurrentSessionQuarantine')
      .mockImplementation(() => undefined);

    const importing = service.importSecureSession({
      account_id: 'account-w',
      connection_attempt_id: 'secure-attempt',
      format_version: securePackage.format_version,
      payload_ref: 'payload-ref',
      source: 'whatsapp_web',
      target_provider: 'wwebjs',
      worker_id: 'worker-w',
      worker_type_id: '019a930d-c6f6-766d-9c84-62b9c3e7d1f0' as never,
    });
    await jest.advanceTimersByTimeAsync(0);
    const disconnecting = service.disconnect({
      preserve_session: false,
      remove_session: true,
    });
    await jest.advanceTimersByTimeAsync(0);

    expect(importWriting).toBe(true);
    expect(clearFolder).not.toHaveBeenCalled();

    releaseImport?.();
    await importing;
    await disconnecting;

    expect(clearFolder).toHaveBeenCalledTimes(1);
  });

  it('waits for a detached tracked client to terminate before removing the profile', async () => {
    const { service, servicePrivate } = makeService();
    let releaseDestroy: (() => void) | undefined;
    const client = {
      destroy: jest.fn(
        () =>
          new Promise<void>((resolve) => {
            releaseDestroy = resolve;
          })
      ),
    };
    servicePrivate.client = undefined;
    servicePrivate.browserRuntimeClients.add(client);
    const clearFolder = jest
      .spyOn(servicePrivate, 'clearFolder')
      .mockImplementation(() => undefined);
    jest
      .spyOn(servicePrivate, 'purgeCurrentSessionQuarantine')
      .mockImplementation(() => undefined);

    const disconnecting = service.disconnect({
      preserve_session: false,
      remove_session: true,
    });
    await jest.advanceTimersByTimeAsync(0);

    expect(client.destroy).toHaveBeenCalledTimes(1);
    expect(clearFolder).not.toHaveBeenCalled();

    releaseDestroy?.();
    await disconnecting;

    expect(servicePrivate.browserRuntimeClients.size).toBe(0);
    expect(clearFolder).toHaveBeenCalledTimes(1);
  });

  it('rejects Chrome extension browser profiles in legacy-volume storage', async () => {
    const previousStorage = process.env.WORKER_SESSION_STORAGE;
    process.env.WORKER_SESSION_STORAGE = 'legacy_volume';
    try {
      const { service, servicePrivate } = makeService();
      const securePackage = {
        format_version: 'underchat-wa-web-session-v1',
        source: 'whatsapp_web',
        target_provider: 'wwebjs',
        web_version: '2.3000.1027934701',
        payload: {
          chrome_extension: {
            version: '1.0.1',
          },
          whatsapp_web_creds: {
            me: { id: '5511999999999:0@s.whatsapp.net' },
            registrationId: 123,
          },
          whatsapp_web_profile: {
            localStorage: {},
          },
        },
      };

      (
        service as unknown as { redis: { get: jest.Mock } }
      ).redis.get.mockResolvedValueOnce(JSON.stringify(securePackage));
      jest.spyOn(servicePrivate, 'cancelAttempt').mockImplementation(() => {});
      jest
        .spyOn(servicePrivate, 'waitForPendingTeardown')
        .mockResolvedValue(undefined);
      jest
        .spyOn(servicePrivate, 'clearChromiumProfileLock')
        .mockImplementation(() => {});
      jest.spyOn(servicePrivate, 'prepareFolder').mockImplementation(() => {});
      const connectSpy = jest.spyOn(service, 'connect');

      const result = await service.importSecureSession({
        account_id: 'account-w',
        connection_attempt_id: 'attempt-1',
        format_version: securePackage.format_version,
        payload_ref: 'payload-ref',
        source: 'whatsapp_web',
        target_provider: 'wwebjs',
        worker_id: 'worker-w',
        worker_type_id: '019a930d-c6f6-766d-9c84-62b9c3e7d1f0' as never,
      });

      expect(result.error).toContain('requires PostgreSQL session storage');
      expect(connectSpy).not.toHaveBeenCalled();
      expect(mockImportWhatsAppWebSessionToLocalAuth).not.toHaveBeenCalled();
      expect(
        mockBrowserProjectionFromWhatsAppWebProfile
      ).not.toHaveBeenCalled();
    } finally {
      if (previousStorage === undefined) {
        delete process.env.WORKER_SESSION_STORAGE;
      } else {
        process.env.WORKER_SESSION_STORAGE = previousStorage;
      }
    }
  });

  it('stages Chrome extension browser profiles in PostgreSQL before secure restore', async () => {
    const previousStorage = process.env.WORKER_SESSION_STORAGE;
    process.env.WORKER_SESSION_STORAGE = 'postgres';
    try {
      const { service, servicePrivate } = makeService();
      const projection = {
        schema_version: 2 as const,
        web_version: '2.3000.1027934701',
        complete: true,
        lossy_records: 0,
        size_bytes: 17,
        indexeddb_stores: [],
        records: [
          {
            namespace: 'local_storage',
            record_key: 'last-wid',
            value: '5511999999999@c.us',
          },
        ],
      };
      const securePackage = {
        format_version: 'underchat-wa-web-session-v1',
        source: 'whatsapp_web',
        target_provider: 'wwebjs',
        web_version: projection.web_version,
        payload: {
          chrome_extension: { version: '1.0.2' },
          whatsapp_web_profile: {
            complete: true,
            lossyRecordCount: 0,
            serializationFormat: 'wwebjs-browser-value-v1',
            localStorage: { 'last-wid': '5511999999999@c.us' },
            signalStorage: {
              databaseName: 'signal-storage',
              stores: [],
            },
          },
        },
      };
      (
        service as unknown as { redis: { get: jest.Mock } }
      ).redis.get.mockResolvedValueOnce(JSON.stringify(securePackage));
      mockBrowserProjectionFromWhatsAppWebProfile.mockReturnValueOnce(
        projection
      );
      jest.spyOn(servicePrivate, 'cancelAttempt').mockImplementation(() => {});
      jest
        .spyOn(servicePrivate, 'waitForPendingTeardown')
        .mockResolvedValue(undefined);
      jest
        .spyOn(servicePrivate, 'clearChromiumProfileLock')
        .mockImplementation(() => {});
      jest.spyOn(servicePrivate, 'prepareFolder').mockImplementation(() => {});
      const stageExternalBrowserProjection = jest.fn(
        async (input: { profilePath: string }) => {
          expect(fs.existsSync(input.profilePath)).toBe(true);
          return '12';
        }
      );
      servicePrivate.postgresSessionStore = {
        stageExternalBrowserProjection,
        failCandidate: jest.fn(async () => undefined),
      } as unknown as PostgresWwebjsSessionStore;
      jest.spyOn(service, 'connect').mockResolvedValue({
        status: Status.connected,
        code: ECodeMessage.connectionEstablished,
        worker_id: 'worker-w',
        account_id: 'account-w',
        session_ready: true,
      });

      const result = await service.importSecureSession({
        account_id: 'account-w',
        connection_attempt_id: 'attempt-extension',
        format_version: securePackage.format_version,
        payload_ref: 'payload-ref',
        source: 'whatsapp_web',
        target_provider: 'wwebjs',
        worker_id: 'worker-w',
        worker_type_id: '019a930d-c6f6-766d-9c84-62b9c3e7d1f0' as never,
      });

      expect(result).toEqual(
        expect.objectContaining({
          reason: 'secure_import_restore_started',
        })
      );
      expect(mockBrowserProjectionFromWhatsAppWebProfile).toHaveBeenCalledWith(
        securePackage
      );
      expect(stageExternalBrowserProjection).toHaveBeenCalledWith({
        session: 'RemoteAuth-worker-w',
        projection,
        profilePath: expect.stringContaining('.underchat-extension-import-'),
      });
      const stagedProfilePath =
        stageExternalBrowserProjection.mock.calls[0]?.[0].profilePath;
      expect(stagedProfilePath).toBeDefined();
      expect(fs.existsSync(stagedProfilePath as string)).toBe(false);
      expect(mockImportWhatsAppWebSessionToLocalAuth).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(0);
    } finally {
      if (previousStorage === undefined) {
        delete process.env.WORKER_SESSION_STORAGE;
      } else {
        process.env.WORKER_SESSION_STORAGE = previousStorage;
      }
    }
  });

  it('stages the Chrome canonical projection through the shared migration path before restore', async () => {
    const previousStorage = process.env.WORKER_SESSION_STORAGE;
    process.env.WORKER_SESSION_STORAGE = 'postgres';
    try {
      const { service, servicePrivate } = makeService();
      const webVersion = '2.3000.1027934701';
      const browserProjection = {
        schema_version: 2 as const,
        web_version: webVersion,
        complete: true,
        lossy_records: 0,
        size_bytes: 17,
        indexeddb_stores: [],
        records: [],
      };
      const canonicalProjection =
        createWwebjsCanonicalBrowserProjection(webVersion);
      const securePackage = {
        format_version: 'underchat-wa-web-session-v1',
        source: 'whatsapp_web',
        target_provider: 'wwebjs',
        web_version: webVersion,
        payload: {
          chrome_extension: { version: '1.0.4' },
          whatsapp_web_profile: {
            complete: true,
            lossyRecordCount: 0,
            serializationFormat: 'wwebjs-browser-value-v1',
            localStorage: {},
            signalStorage: {
              databaseName: 'signal-storage',
              stores: [],
            },
          },
          wwebjs_canonical_projection: canonicalProjection,
        },
      };
      (
        service as unknown as { redis: { get: jest.Mock } }
      ).redis.get.mockResolvedValueOnce(JSON.stringify(securePackage));
      mockBrowserProjectionFromWhatsAppWebProfile.mockReturnValueOnce(
        browserProjection
      );
      jest.spyOn(servicePrivate, 'cancelAttempt').mockImplementation(() => {});
      jest
        .spyOn(servicePrivate, 'waitForPendingTeardown')
        .mockResolvedValue(undefined);
      jest
        .spyOn(servicePrivate, 'clearChromiumProfileLock')
        .mockImplementation(() => {});
      jest.spyOn(servicePrivate, 'prepareFolder').mockImplementation(() => {});
      const stageExternalCanonicalProjection = jest.fn(
        async (input: { profilePath: string }) => {
          expect(fs.existsSync(input.profilePath)).toBe(true);
          return '12';
        }
      );
      const stageExternalBrowserProjection = jest.fn(async () => '12');
      servicePrivate.postgresSessionStore = {
        stageExternalCanonicalProjection,
        stageExternalBrowserProjection,
        failCandidate: jest.fn(async () => undefined),
      } as unknown as PostgresWwebjsSessionStore;
      jest.spyOn(service, 'connect').mockResolvedValue({
        status: Status.connected,
        code: ECodeMessage.connectionEstablished,
        worker_id: 'worker-w',
        account_id: 'account-w',
        session_ready: true,
      });

      const result = await service.importSecureSession({
        account_id: 'account-w',
        connection_attempt_id: 'attempt-extension-canonical',
        format_version: securePackage.format_version,
        payload_ref: 'payload-ref-canonical',
        source: 'whatsapp_web',
        target_provider: 'wwebjs',
        worker_id: 'worker-w',
        worker_type_id: '019a930d-c6f6-766d-9c84-62b9c3e7d1f0' as never,
      });

      expect(result).toEqual(
        expect.objectContaining({
          reason: 'secure_import_restore_started',
        })
      );
      expect(stageExternalCanonicalProjection).toHaveBeenCalledWith({
        session: 'RemoteAuth-worker-w',
        browserProjection,
        canonicalProjection,
        profilePath: expect.stringContaining('.underchat-extension-import-'),
      });
      expect(stageExternalBrowserProjection).not.toHaveBeenCalled();
      const stagedProfilePath =
        stageExternalCanonicalProjection.mock.calls[0]?.[0].profilePath;
      expect(stagedProfilePath).toBeDefined();
      expect(fs.existsSync(stagedProfilePath as string)).toBe(false);
      await jest.advanceTimersByTimeAsync(0);
    } finally {
      if (previousStorage === undefined) {
        delete process.env.WORKER_SESSION_STORAGE;
      } else {
        process.env.WORKER_SESSION_STORAGE = previousStorage;
      }
    }
  });

  it('keeps importing secure sessions from wwebjs_local_auth files', async () => {
    const { service, servicePrivate } = makeService();
    const beginRuntimeSessionActivation = jest.mocked(
      servicePrivate.beginRuntimeSessionActivation
    );
    beginRuntimeSessionActivation.mockClear();
    const state: IBaileysConnectionState = {
      status: Status.connected,
      code: ECodeMessage.connectionEstablished,
      worker_id: 'worker-w',
      account_id: 'account-w',
    };
    const securePackage = {
      format_version: 'underchat-wa-web-session-v1',
      source: 'whatsapp_web',
      target_provider: 'wwebjs',
      payload: {
        wwebjs_local_auth: {
          files: {
            'Default/Cookies': { data: 'cookie-data', encoding: 'utf8' },
          },
        },
        whatsapp_web_creds: {
          me: { id: '5511999999999:0@s.whatsapp.net' },
          registrationId: 123,
        },
      },
    };

    (
      service as unknown as { redis: { get: jest.Mock } }
    ).redis.get.mockResolvedValueOnce(JSON.stringify(securePackage));
    mockImportWhatsAppWebSessionToLocalAuth.mockResolvedValueOnce({
      formatVersion: securePackage.format_version,
      importedFiles: ['Default/Cookies'],
    });
    jest.spyOn(servicePrivate, 'cancelAttempt').mockImplementation(() => {});
    jest
      .spyOn(servicePrivate, 'waitForPendingTeardown')
      .mockResolvedValue(undefined);
    jest
      .spyOn(servicePrivate, 'clearChromiumProfileLock')
      .mockImplementation(() => {});
    jest.spyOn(servicePrivate, 'prepareFolder').mockImplementation(() => {});
    jest.spyOn(service, 'connect').mockImplementation(async () => {
      await Promise.resolve();
      expect(servicePrivate.secureImportConnectionAttemptActive).toBe(true);
      return state;
    });

    await service.importSecureSession({
      account_id: 'account-w',
      connection_attempt_id: 'attempt-1',
      format_version: securePackage.format_version,
      payload_ref: 'payload-ref',
      source: 'whatsapp_web',
      target_provider: 'wwebjs',
      worker_id: 'worker-w',
      worker_type_id: '019a930d-c6f6-766d-9c84-62b9c3e7d1f0' as never,
    });

    expect(mockImportWhatsAppWebSessionToLocalAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'worker-w',
        overwrite: true,
        sessionPackage: securePackage,
      })
    );
    expect(beginRuntimeSessionActivation).toHaveBeenCalledTimes(1);
    expect(
      beginRuntimeSessionActivation.mock.invocationCallOrder[0]
    ).toBeLessThan(
      mockImportWhatsAppWebSessionToLocalAuth.mock.invocationCallOrder[0]
    );
    await jest.advanceTimersByTimeAsync(0);
    expect(servicePrivate.secureImportConnectionAttemptActive).toBe(false);
  });
});
