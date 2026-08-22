import 'reflect-metadata';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { EWorkerConfigStatus } from '@core/common/enums/EWorkerConfigStatus';
import { EWorkerConfigType } from '@core/common/enums/EWorkerConfigType';
import { workerProxyFingerprint } from '@core/common/functions/workerProxyFingerprint';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { EWorkerWarmPoolState } from '@core/common/enums/EWorkerWarmPoolState';
import { EWhatsappConnectionStatus } from '@core/common/enums/EWhatsappConnectionStatus';
import { EProxyProtocol } from '@core/common/enums/EProxyProtocol';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import type { ContainerHealthResult } from '@core/services/containerHealth.service';
import {
  WorkerCommandHandlerService,
  WorkerOnlineReadinessRejectedError,
} from '@core/services/workerCommandHandler.service';
import { WorkerRecreateServerSlotService } from '@core/services/workerRecreateServerSlot.service';
import type {
  WorkerContainerInspection,
  WorkerService,
  WorkerVolumeInspection,
} from '@core/services/worker.service';
import {
  WORKER_LIVENESS_LOCAL_DOCKER_READ_TIMEOUT_MS,
  WORKER_LIVENESS_LIFECYCLE_HEARTBEAT_MS,
  WORKER_LIVENESS_LIFECYCLE_LEASE_TTL_MS,
} from '@core/common/functions/workerContainerLivenessPolicy';
import { workerLifecycleSemanticFingerprint } from '@core/common/functions/workerLifecycleSemanticFingerprint';
import type { ILockLeaseContext } from '@core/common/functions/withLock';
import { IWorkerLifecycleQueueMessage } from '@core/common/interfaces/IWorkerLifecycleQueueMessage';
import type { IWorkerMonitor } from '@core/common/interfaces/IWorkerMonitor';
import type { IWorkerPayload } from '@core/common/interfaces/IWorkerPayload';
import type { IWorkerRuntime } from '@core/common/interfaces/IWorkerRuntime';
import { createHash } from 'node:crypto';

const WORKER_IMAGE_CONTENT_ID = `sha256:${'a'.repeat(64)}`;
const WARM_RUNTIME_CONTAINER_ID = 'f'.repeat(64);
const LIFECYCLE_RUNTIME_CONTAINER_ID = 'c'.repeat(64);
const WARM_RUNTIME_CAPABILITY = 'test-warm-runtime-capability';
const WARM_RUNTIME_WRITER_EPOCH = '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5d';
const CONNECTION_STATUS_SOURCE_ID = '019c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5d';
const CONNECTION_STATUS_CHANGED_AT = '2026-01-01T00:00:00.000Z';

const providerForWorkerType = (
  workerType: EWorkerType
): 'baileys' | 'wwebjs' | 'whatsmeow' => {
  if (workerType === EWorkerType.baileys) return 'baileys';
  if (workerType === EWorkerType.whatsmeow) return 'whatsmeow';
  return 'wwebjs';
};

const buildNativeConnectionStatus = (
  workerType: EWorkerType,
  online: boolean
) => ({
  provider: providerForWorkerType(workerType),
  status: online
    ? EWhatsappConnectionStatus.online
    : EWhatsappConnectionStatus.initializing,
  connected: online,
  authenticated: online,
  sessionValid: online ? true : null,
  recoverable: true,
  qrAvailable: false,
  sequence: online ? 2 : 1,
  changedAt: CONNECTION_STATUS_CHANGED_AT,
});

const nativeRuntimeContract = (workerType: EWorkerType, online: boolean) => ({
  runtime_health_schema_version: 3,
  connection_status_source_id: CONNECTION_STATUS_SOURCE_ID,
  connection_status: buildNativeConnectionStatus(workerType, online),
});

const sourceLessQrReadyWwebjsRuntimeHealth = (
  overrides: Record<string, unknown> = {}
) => ({
  worker_id: 'worker-1',
  account_id: 'account-1',
  worker_type_id: EWorkerType.wwebjs,
  activated: true,
  ready: true,
  standby: false,
  runtime_state: 'active',
  runtime_generation: 32,
  qr_stream_ready: true,
  has_session: false,
  has_qr: false,
  session_ready: false,
  can_send: false,
  can_receive_runtime: false,
  authenticated: false,
  provider_state: 'missing_client',
  degraded_reason: 'No client instance',
  phone: '',
  kafka_unhealthy: true,
  kafka_consumers_ready: false,
  kafka_consumers_authorized: false,
  runtime_health_schema_version: 3,
  connection_status_source_id: '',
  connection_status: undefined,
  error: '',
  ...overrides,
});

const withNativeRuntimeHealth = (
  health: Record<string, unknown>,
  workerType: EWorkerType
): Record<string, unknown> => {
  const online =
    health.session_ready === true &&
    health.can_send === true &&
    health.can_receive_runtime === true &&
    health.authenticated === true;

  return {
    ...nativeRuntimeContract(workerType, online),
    ...health,
  };
};

jest.mock('@core/services/worker.service', () => ({
  WorkerService: class WorkerService {},
}));

jest.mock('@core/services/centrifugo.service', () => ({
  CentrifugoService: class CentrifugoService {},
}));

jest.mock('@core/services/chat.service', () => ({
  ChatService: class ChatService {},
}));

jest.mock('@core/services/containerHealth.service', () => ({
  ContainerHealthService: class ContainerHealthService {},
}));

jest.mock('@core/services/workerBaileysGrpcClient.service', () => ({
  WorkerBaileysGrpcClientService: class WorkerBaileysGrpcClientService {},
  isWorkerConnectionDeadlineExceeded: (error: unknown) =>
    Boolean(
      error &&
      typeof error === 'object' &&
      (error as { code?: number }).code === 4
    ),
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

type RecreateRuntimeRemovalDecisionForTest = {
  status: 'removed' | 'recovered' | 'pending' | 'stale' | 'retry';
  reason: string;
};

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
    'underchat.session_storage': EWorkerSessionStorage.legacy_volume,
    'underchat.session_volume_name': 'worker-1',
  },
  container_env: {
    WORKER_ID: 'worker-1',
    ACCOUNT_ID: 'account-1',
    WORKER_TYPE_ID: EWorkerType.wwebjs,
    WORKER_IMAGE: 'under-worker-wwebjs:latest',
    WORKER_GRPC_PORT: '50053',
    WORKER_SESSION_STORAGE: EWorkerSessionStorage.legacy_volume,
    SESSION_VOLUME_NAME: 'worker-1',
  },
  container_mounts: [
    {
      destination: '/app/data',
      name: 'worker-1',
      read_write: true,
      type: 'volume',
    },
  ],
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

const buildWarmStandbyRuntimeHealth = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  worker_id: '',
  account_id: '',
  warm_pool_id: 'warm-pool-1',
  worker_type_id: EWorkerType.baileys,
  standby: true,
  activated: false,
  ready: true,
  has_session: false,
  has_qr: false,
  runtime_state: 'warm_standby',
  qr_stream_ready: false,
  session_ready: false,
  can_send: false,
  can_receive_runtime: false,
  authenticated: false,
  kafka_unhealthy: false,
  kafka_consumers_ready: false,
  kafka_consumers_authorized: false,
  runtime_health_schema_version: 3,
  error: '',
  ...overrides,
});

const buildReadyWarmRuntimeHealthEntry = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  warm_pool_id: 'warm-pool-1',
  server_id: 'server-1',
  worker_type_id: EWorkerType.whatsmeow,
  container_id: WARM_RUNTIME_CONTAINER_ID,
  container_name: 'warm-warm-pool-1',
  session_storage: EWorkerSessionStorage.postgres,
  session_volume_name: null,
  runtime_generation: 1,
  state: EWorkerWarmPoolState.ready,
  reserved_by_worker_id: null,
  reservation_expires_at: null,
  ...overrides,
});

const buildActivatedWarmRuntimeHealth = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  worker_id: 'worker-1',
  account_id: 'account-1',
  warm_pool_id: 'warm-1',
  worker_type_id: EWorkerType.baileys,
  standby: false,
  activated: true,
  ready: true,
  runtime_state: 'active',
  runtime_generation: 1,
  kafka_unhealthy: false,
  kafka_consumers_ready: true,
  kafka_consumers_authorized: true,
  runtime_health_schema_version: 3,
  qr_stream_ready: true,
  session_ready: false,
  can_send: false,
  can_receive_runtime: false,
  authenticated: false,
  error: '',
  ...overrides,
});

const buildWarmContainerInspection = (
  overrides: Partial<WorkerContainerInspection> = {}
): WorkerContainerInspection => ({
  exists: true,
  container_id: 'warm-container-id',
  container_name: 'warm-warm-pool-1',
  container_image: 'under-worker-baileys:latest',
  container_image_id: WORKER_IMAGE_CONTENT_ID,
  container_labels: {
    'underchat.warm_standby': 'true',
    'underchat.warm_pool_id': 'warm-pool-1',
    'underchat.server_id': 'server-1',
    'underchat.worker_type_id': EWorkerType.baileys,
    'underchat.worker_image': 'under-worker-baileys:latest',
    'underchat.worker_grpc_port': '50052',
    'underchat.session_volume_name': 'warm-warm-pool-1',
    'underchat.session_storage': EWorkerSessionStorage.legacy_volume,
  },
  container_env: {
    WARM_STANDBY: 'true',
    WARM_POOL_ID: 'warm-pool-1',
    WORKER_TYPE_ID: EWorkerType.baileys,
    WORKER_IMAGE: 'under-worker-baileys:latest',
    WORKER_GRPC_PORT: '50052',
    SESSION_VOLUME_NAME: 'warm-warm-pool-1',
    WORKER_SESSION_STORAGE: EWorkerSessionStorage.legacy_volume,
  },
  container_mounts: [
    {
      destination: '/app/data',
      name: 'warm-warm-pool-1',
      read_write: true,
      type: 'volume',
    },
  ],
  container_state: 'running',
  container_status: 'running',
  running: true,
  ...overrides,
});

const buildPostgresWarmContainerInspection = (
  overrides: Partial<WorkerContainerInspection> = {}
): WorkerContainerInspection => ({
  exists: true,
  container_id: 'warm-container-id',
  container_name: 'warm-warm-pool-1',
  container_image: 'under-worker-baileys:latest',
  container_image_id: WORKER_IMAGE_CONTENT_ID,
  container_labels: {
    'underchat.warm_standby': 'true',
    'underchat.warm_pool_id': 'warm-pool-1',
    'underchat.server_id': 'server-1',
    'underchat.worker_type_id': EWorkerType.baileys,
    'underchat.worker_image': 'under-worker-baileys:latest',
    'underchat.worker_grpc_port': '50052',
    'underchat.resource_profile': 'active',
    'underchat.session_storage': EWorkerSessionStorage.postgres,
    'underchat.proxy_mode': 'direct',
    'underchat.proxy_fingerprint': workerProxyFingerprint(),
  },
  container_env: {
    WARM_STANDBY: 'true',
    WARM_POOL_ID: 'warm-pool-1',
    WORKER_TYPE_ID: EWorkerType.baileys,
    WORKER_IMAGE: 'under-worker-baileys:latest',
    WORKER_GRPC_PORT: '50052',
    WORKER_SESSION_STORAGE: EWorkerSessionStorage.postgres,
  },
  container_mounts: [],
  container_state: 'running',
  container_status: 'running',
  running: true,
  ...overrides,
});

const buildActivatedWarmContainerInspection = (
  overrides: Partial<WorkerContainerInspection> = {}
): WorkerContainerInspection => ({
  exists: true,
  container_id: 'replacement-container-id',
  container_name: 'worker-1',
  container_image: 'under-worker-baileys:latest',
  container_image_id: WORKER_IMAGE_CONTENT_ID,
  container_labels: {
    'underchat.worker_id': 'worker-1',
    'underchat.account_id': 'account-1',
    'underchat.server_id': 'server-1',
    'underchat.worker_type_id': EWorkerType.baileys,
    'underchat.worker_image': 'under-worker-baileys:latest',
    'underchat.worker_grpc_port': '50052',
    'underchat.session_volume_name': 'warm-warm-1',
    'underchat.session_storage': EWorkerSessionStorage.legacy_volume,
    'underchat.runtime_generation': '5',
    'underchat.warm_pool_id': 'warm-1',
    'underchat.warm_standby': 'false',
    'underchat.proxy_mode': 'direct',
    'underchat.proxy_fingerprint': workerProxyFingerprint(),
  },
  container_env: {
    WORKER_ID: 'worker-1',
    ACCOUNT_ID: 'account-1',
    WORKER_TYPE_ID: EWorkerType.baileys,
    WORKER_IMAGE: 'under-worker-baileys:latest',
    WORKER_GRPC_PORT: '50052',
    SESSION_VOLUME_NAME: 'warm-warm-1',
    WORKER_SESSION_STORAGE: EWorkerSessionStorage.legacy_volume,
    RUNTIME_GENERATION: '5',
    WARM_POOL_ID: 'warm-1',
    WARM_STANDBY: 'false',
  },
  container_mounts: [
    {
      destination: '/app/data',
      name: 'warm-warm-1',
      read_write: true,
      type: 'volume',
    },
  ],
  container_state: 'running',
  container_status: 'running',
  running: true,
  ...overrides,
});

const buildLegacyRenamedWarmContainerInspection = (
  overrides: Partial<WorkerContainerInspection> = {}
): WorkerContainerInspection =>
  buildWarmContainerInspection({
    container_id: 'warm-container-id',
    container_name: 'worker-1',
    container_labels: {
      ...buildWarmContainerInspection().container_labels,
      'underchat.warm_pool_id': 'warm-1',
      'underchat.session_volume_name': 'warm-warm-1',
    },
    container_env: {
      ...buildWarmContainerInspection().container_env,
      WARM_POOL_ID: 'warm-1',
      SESSION_VOLUME_NAME: 'warm-warm-1',
    },
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
  runtime_generation: 1,
  connection_status_source_id: CONNECTION_STATUS_SOURCE_ID,
  connection_status: buildNativeConnectionStatus(EWorkerType.wwebjs, true),
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
  runtime_generation: 1,
  connection_status_source_id: CONNECTION_STATUS_SOURCE_ID,
  connection_status: buildNativeConnectionStatus(EWorkerType.wwebjs, false),
});

const buildStrictLivenessRuntimeHealth = (
  overrides: Record<string, unknown> = {}
) => ({
  worker_id: 'worker-1',
  account_id: 'account-1',
  worker_type_id: EWorkerType.wwebjs,
  runtime_generation: 7,
  runtime_state: 'active',
  ready: true,
  activated: true,
  standby: false,
  session_ready: true,
  can_send: true,
  can_receive_runtime: true,
  authenticated: true,
  kafka_unhealthy: false,
  kafka_consumers_ready: true,
  kafka_consumers_authorized: true,
  runtime_health_schema_version: 3,
  connection_status_source_id: CONNECTION_STATUS_SOURCE_ID,
  connection_status: buildNativeConnectionStatus(EWorkerType.wwebjs, true),
  phone: '556192037138',
  error: '',
  ...overrides,
});

function deleteStoredKeys(store: Map<string, string>, keys: string[]): void {
  for (const key of keys) {
    store.delete(key);
  }
}

function mockHandlerSleep(
  handler: WorkerCommandHandlerService
): jest.Mock<Promise<void>, [number]> {
  const sleep = jest.fn<Promise<void>, [number]>(async () => undefined);
  (
    handler as unknown as {
      sleep: (ms: number) => Promise<void>;
    }
  ).sleep = sleep;
  return sleep;
}

/**
 * The additive migration backfills every pre-existing session row as legacy.
 * A large part of this lifecycle suite intentionally builds the old row shape,
 * so expose those fixtures to the service exactly as PostgreSQL does after the
 * migration without weakening the production storage invariant.
 */
function withBackfilledLegacySessionStorage<T>(value: T): T {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !('session_storage' in value) &&
    'session_volume_name' in value &&
    typeof value.session_volume_name === 'string' &&
    value.session_volume_name.trim()
  ) {
    return {
      ...value,
      session_storage: EWorkerSessionStorage.legacy_volume,
    };
  }
  return value;
}

function withBackfilledLegacyWorkerSessionStorage<T>(value: T): T {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !('session_storage' in value) &&
    'worker_id' in value &&
    'worker_status_id' in value
  ) {
    return {
      ...value,
      session_storage: EWorkerSessionStorage.legacy_volume,
    };
  }
  return value;
}

function withBackfilledSessionRows<T extends object>(
  repository: T,
  methodNames: ReadonlySet<PropertyKey>
): T {
  return new Proxy(repository, {
    get(target, property, receiver) {
      const member = Reflect.get(target, property, receiver);
      if (typeof member !== 'function' || !methodNames.has(property)) {
        return member;
      }
      return async (...args: unknown[]) =>
        withBackfilledLegacySessionStorage(
          await Reflect.apply(member, target, args)
        );
    },
  });
}

function buildHandler(
  overrides: {
    cleanupError?: unknown;
    cleanupResult?: boolean;
    volumeExists?: boolean;
    workerRuntimeRepository?: {
      viewByWorkerId: jest.Mock;
      viewByWorkerIdConsistent?: jest.Mock;
      viewRecreatedWorkerUnavailableNativeTerminalProof?: jest.Mock;
      reserveNextRuntimeGeneration?: jest.Mock;
      claimReservedRuntimeContainer?: jest.Mock;
      claimPreviousRuntimeContainer?: jest.Mock;
      markRecreateBootstrapStarted?: jest.Mock;
      revokeFailedOnlineLivenessReplacementRuntime?: jest.Mock;
      upsert: jest.Mock;
      deleteByWorkerId: jest.Mock;
      clearWarmPoolReferenceIfMatches?: jest.Mock;
      isSessionVolumeReferencedConsistent?: jest.Mock;
      isSessionVolumeReferencedByOtherWorkerConsistent?: jest.Mock;
      tombstoneWarmActivationIfMatches?: jest.Mock;
      viewWhatsappProviderHandoffLifecycleContext?: jest.Mock;
      viewWhatsappProviderHandoffTerminalLifecycleProof?: jest.Mock;
      viewWhatsappProviderHandoffRecoveryLifecycleProof?: jest.Mock;
      viewWhatsappProviderHandoffDiscardPrimaryGate?: jest.Mock;
      viewWhatsappProviderEmptySwitchPrimaryProof?: jest.Mock;
      failWhatsappProviderHandoffBeforeSourceDrain?: jest.Mock;
      acknowledgeWhatsappProviderHandoffSourceDrained?: jest.Mock;
      isWhatsappProviderHandoffTargetAuthorized?: jest.Mock;
    };
    workerWarmPoolRepository?: {
      create: jest.Mock;
      viewById: jest.Mock;
      viewByIdConsistent: jest.Mock;
      finalizeCreationReady: jest.Mock;
      finalizePostgresCreationReady: jest.Mock;
      bindPostgresWarmRuntime?: jest.Mock;
      recordCreationError: jest.Mock;
      recordPostgresCreationError: jest.Mock;
      markAssigned: jest.Mock;
      markRuntime: jest.Mock;
      rejectActivation: jest.Mock;
      releaseReservedAfterHealthFence?: jest.Mock;
      extendActivationReservation: jest.Mock;
      beginActivation: jest.Mock;
      restorePreGenerationActivationToReady: jest.Mock;
      failActivatingActivation: jest.Mock;
      revertAssignedActivation: jest.Mock;
      claimFailedActivationCleanup: jest.Mock;
      finalizeFailedActivationCleanup: jest.Mock;
      finalizeRejectedActivationCleanup: jest.Mock;
      reconcileDeletingRuntimeLineage?: jest.Mock;
      claimLegacyDeletingContainerForReclaim?: jest.Mock;
      withLegacyDeletingReclaimFence?: jest.Mock;
      withConvertedDeletingReclaimFence: jest.Mock;
      finalizeLegacyDeletingResourcesAbsent?: jest.Mock;
      deleteById?: jest.Mock;
      deleteAssignedByWorkerId: jest.Mock;
    };
    workerInspection?: WorkerContainerInspection;
    containerHealthResult?: ContainerHealthResult;
    runtimeHealthResponse?: Record<string, unknown>;
    workerLifecycleQueueService?: {
      publish: jest.Mock;
      prepare?: jest.Mock;
      loadPrepared?: jest.Mock;
      loadPermanentDeletionProof?: jest.Mock;
    };
    workerRecreateServerSlotService?: {
      withSlot: jest.Mock;
      tryReserve?: jest.Mock;
      buildToken?: jest.Mock;
      getSlotCount?: jest.Mock;
      release?: jest.Mock;
    };
  } = {}
) {
  const inspectContainerWorkerById = jest.fn<
    Promise<WorkerContainerInspection>,
    [string]
  >(async (workerId: string) => {
    if (overrides.workerInspection) {
      return overrides.workerInspection;
    }
    if (workerId === 'replacement-container-id') {
      return buildActivatedWarmContainerInspection();
    }
    if (workerId.startsWith('warm-')) {
      return {
        exists: false,
        container_name: workerId,
      };
    }
    return buildWorkerContainerInspection();
  });
  let createdWarmInput:
    | {
        warmPoolId: string;
        serverId: string;
        workerTypeId: EWorkerType;
        imageName: string;
        imageContentId: string;
        workerGrpcPort?: number;
        runtimeCapability: string;
        writerEpoch: string;
      }
    | undefined;
  const inspectContainerWorkerByIdStrict = jest.fn<
    Promise<WorkerContainerInspection>,
    [string]
  >(async (workerId: string) => {
    if (
      createdWarmInput &&
      (workerId === 'warm-container-id' ||
        workerId === `warm-${createdWarmInput.warmPoolId}`)
    ) {
      const name = `warm-${createdWarmInput.warmPoolId}`;
      const grpcPort = String(createdWarmInput.workerGrpcPort ?? '');
      return {
        exists: true,
        container_id: 'warm-container-id',
        container_name: name,
        container_image: createdWarmInput.imageName,
        container_image_id: createdWarmInput.imageContentId,
        container_labels: {
          'underchat.warm_standby': 'true',
          'underchat.warm_pool_id': createdWarmInput.warmPoolId,
          'underchat.server_id': createdWarmInput.serverId,
          'underchat.worker_type_id': createdWarmInput.workerTypeId,
          'underchat.worker_image': createdWarmInput.imageName,
          'underchat.worker_grpc_port': grpcPort,
          'underchat.session_storage': EWorkerSessionStorage.postgres,
        },
        container_env: {
          WARM_STANDBY: 'true',
          WARM_POOL_ID: createdWarmInput.warmPoolId,
          WORKER_TYPE_ID: createdWarmInput.workerTypeId,
          WORKER_IMAGE: createdWarmInput.imageName,
          WORKER_GRPC_PORT: grpcPort,
          WORKER_SESSION_STORAGE: EWorkerSessionStorage.postgres,
        },
        container_mounts: [],
        running: true,
      };
    }
    return inspectContainerWorkerById(workerId);
  });
  const removeContainerWorkerById = jest.fn<Promise<boolean>, [string]>(
    async () => true
  );
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
    removeContainerWorkerById,
    stopContainerWorkerByIdGracefully: jest.fn(async () => true),
    removePostgresWarmContainerWithAnonymousVolumesById: jest.fn<
      Promise<boolean>,
      [string]
    >(async (containerId) => removeContainerWorkerById(containerId)),
    removeContainerIfLivenessFenceMatches: jest.fn<
      Promise<{
        status: 'removed' | 'recovered' | 'pending' | 'stale';
        reason: string;
        observedRestartCount?: number;
      }>,
      [Record<string, unknown>]
    >(async () => ({
      status: 'removed',
      reason: 'fence_matched',
    })),
    startContainerWorkerById: jest.fn<Promise<boolean>, [string]>(
      async () => true
    ),
    removeContainerByNameAndVolume: jest.fn(async () => true),
    removeVolumeByName: jest.fn(async () => true),
    listContainerIdsMountingVolumeStrict: jest.fn<Promise<string[]>, [string]>(
      async () => []
    ),
    inspectVolumeByNameStrict: jest.fn<
      Promise<WorkerVolumeInspection>,
      [string]
    >(async (volumeName: string) => ({
      exists: true,
      name: volumeName,
      signature: `signature:${volumeName}`,
    })),
    removeLegacyWarmVolumeByProof: jest.fn(async () => true),
    removeConvertedWarmVolumeByProof: jest.fn(async () => true),
    removeFailedWarmActivationVolumeByProof: jest.fn(async () => true),
    removeWorkerVolumeByProof: jest.fn(async () => true),
    existsVolumeByName: jest.fn<Promise<boolean>, [string]>(
      async () => overrides.volumeExists ?? true
    ),
    existsVolumeByNameStrict: jest.fn<Promise<boolean>, [string]>(
      async () => overrides.volumeExists ?? true
    ),
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
      session_storage: EWorkerSessionStorage.legacy_volume,
      lifecycle_operation_id: null,
      last_connection_check_at: null,
    })),
    existsContainerWorkerById: jest.fn(async () => true),
    inspectContainerWorkerById,
    inspectContainerWorkerByIdStrict,
    inspectRuntimeWriterIdentityByContainerIdStrict: jest.fn(async () => ({
      runtimeCapability:
        createdWarmInput?.runtimeCapability ?? WARM_RUNTIME_CAPABILITY,
      writerEpoch: createdWarmInput?.writerEpoch ?? WARM_RUNTIME_WRITER_EPOCH,
    })),
    ensureWorkerImageContentId: jest.fn(async () => WORKER_IMAGE_CONTENT_ID),
    inspectImageContentId: jest.fn(async () => WORKER_IMAGE_CONTENT_ID),
    createContainerWorker: jest.fn(async () => 'container-1'),
    createWarmContainerWorker: jest.fn(
      async (input: NonNullable<typeof createdWarmInput>) => {
        createdWarmInput = input;
        return {
          container_id: 'warm-container-id',
          container_name: `warm-${input.warmPoolId}`,
          session_volume_name: null,
        };
      }
    ),
    renameContainer: jest.fn(async () => undefined),
  };
  const viewWorkerForMonitorConsistent = jest.fn(async (workerId: string) =>
    withBackfilledLegacyWorkerSessionStorage(
      await workerService.viewWorkerForMonitor(workerId)
    )
  );
  Object.assign(workerService, {
    viewWorkerForMonitorConsistent,
  });

  const centrifugoService = {
    publish: jest.fn(async () => ({})),
    publishSub: jest.fn<
      Promise<unknown>,
      [string, unknown, (() => void | Promise<void>)?]
    >(async () => ({})),
    publishStrict: jest.fn<Promise<unknown>, [string, unknown]>(
      async () => ({})
    ),
    publishSubStrict: jest.fn<Promise<unknown>, [string, unknown]>(
      async () => ({})
    ),
  };

  const chatService = {};
  const kafkaBaileysQueueService = {
    all: jest.fn((workerId: string) => [
      `worker.${workerId}.send.message`,
      `worker.${workerId}.schedule.send.message`,
      `worker.${workerId}.validate.phone`,
      `worker.${workerId}.notification.message`,
      `worker.${workerId}.webhook.integration`,
      `worker.${workerId}.webhook.integration.dlq`,
      `worker.${workerId}.send.message.dlq`,
      `worker.${workerId}.consumer.dlq`,
    ]),
    deletePermanently: jest.fn(async () => undefined),
    ensure: jest.fn(async () => undefined),
  };
  const workerTopicDeletionAuthorizerService = {
    assertPermanentDeletionIntent: jest.fn<
      Promise<{ permanently_deleted: boolean }>,
      [Record<string, unknown>, string[]]
    >(async () => ({ permanently_deleted: false })),
    authorizePermanentDeletion: jest.fn(async () => undefined),
  };
  const workerCommandResourceLifecycleService = {
    beginPermanentDeletion: jest.fn(
      async (request: Record<string, unknown>, lease: ILockLeaseContext) => {
        lease.assertActive();
        const authorization =
          await workerTopicDeletionAuthorizerService.assertPermanentDeletionIntent(
            request,
            kafkaBaileysQueueService.all(String(request.worker_id))
          );
        lease.assertActive();
        return { authorization, epoch: null };
      }
    ),
    // Keep this mock aliased while the handler's historical deletion tests are
    // renamed independently from the production Kafka-to-JetStream cutover.
    finalizePermanentDeletion: kafkaBaileysQueueService.deletePermanently,
  };
  const containerHealthService = {
    checkServiceHealth: jest.fn<
      Promise<ContainerHealthResult>,
      [string, unknown?]
    >(
      async () =>
        overrides.containerHealthResult ?? buildContainerHealthResult()
    ),
  };
  const activateRuntime = jest.fn<
    Promise<{ activated: boolean }>,
    [string, Record<string, unknown>, EWorkerType]
  >(async () => ({ activated: true }));
  const workerBaileysGrpcClientService = {
    requestConnection: jest.fn(async () => buildConnectedState()),
    prepareProviderHandoff: jest.fn(async () => ({
      prepared: false,
      error: 'not_configured',
    })),
    waitForReady: jest.fn(async () => 'worker-1:50053'),
    activateRuntime,
    runtimeHealth: jest.fn<
      Promise<Record<string, unknown>>,
      [string, unknown, EWorkerType]
    >(async (_containerName, request, workerType) => {
      const healthRequest = request as {
        worker_id?: string;
        warm_pool_id?: string;
      };
      const activationPayload = activateRuntime.mock.calls.at(-1)?.[1] as
        | {
            account_id?: string;
            warm_pool_id?: string;
            runtime_generation?: number;
          }
        | undefined;
      const createMetadata = (
        workerService.createContainerWorker as jest.Mock
      ).mock.calls.at(-1)?.[7] as { runtimeGeneration?: number } | undefined;
      return withNativeRuntimeHealth(
        {
          worker_id: healthRequest.worker_id ?? 'worker-1',
          account_id: activationPayload?.account_id ?? 'account-1',
          worker_type_id: workerType,
          warm_pool_id:
            healthRequest.warm_pool_id ?? activationPayload?.warm_pool_id,
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
          kafka_consumers_ready: true,
          kafka_consumers_authorized: true,
          runtime_generation:
            createMetadata?.runtimeGeneration ??
            activationPayload?.runtime_generation ??
            1,
          ...overrides.runtimeHealthResponse,
        },
        workerType
      );
    }),
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
        callback: (context: {
          signal: AbortSignal;
          assertActive: () => void;
        }) => Promise<unknown>
      ) =>
        callback({
          signal: new AbortController().signal,
          assertActive: () => undefined,
        })
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
      async (script: string, keyCount: number, ...args: unknown[]) => {
        if (script.includes('local incoming_state = ARGV[2]')) {
          const keys = args.slice(0, keyCount).map(String);
          const [workerId, state, accountId, operationId] = args
            .slice(keyCount)
            .map(String);
          const currentRaw = redisStore.get(keys[0]);
          if (currentRaw) {
            try {
              const current = JSON.parse(currentRaw) as {
                worker_id?: string;
                state?: string;
                account_id?: string;
                lifecycle_operation_id?: string;
              };
              if (
                (current.state === 'deleting' || current.state === 'revoked') &&
                (current.worker_id !== workerId ||
                  (current.state === 'deleting' &&
                    (state !== 'deleting' ||
                      current.account_id !== accountId ||
                      current.lifecycle_operation_id !== operationId)) ||
                  (current.state === 'revoked' && state === 'deleting'))
              ) {
                return -1;
              }
              if (
                current.worker_id === workerId &&
                current.state === state &&
                current.account_id === accountId &&
                current.lifecycle_operation_id === operationId
              ) {
                deleteStoredKeys(redisStore, keys.slice(1));
                return 0;
              }
            } catch {}
          }
          redisStore.set(
            keys[0],
            JSON.stringify({
              state,
              worker_id: workerId,
              account_id: accountId,
              lifecycle_operation_id: operationId,
              revoked_at: Date.now(),
            })
          );
          deleteStoredKeys(redisStore, keys.slice(1));
          return 1;
        }

        if (script.includes('underchat:self-heal:complete-owned')) {
          const [recoveryKey, inflightKey, cooldownKey, operationId] =
            args.map(String);
          const recoveryRaw = redisStore.get(recoveryKey);
          if (!recoveryRaw || redisStore.get(inflightKey) !== operationId) {
            return 0;
          }

          try {
            const recovery = JSON.parse(recoveryRaw) as {
              operation_id?: string;
            };
            if (recovery.operation_id !== operationId) {
              return 0;
            }
          } catch {
            return 0;
          }

          redisStore.set(cooldownKey, operationId);
          redisStore.delete(recoveryKey);
          redisStore.delete(inflightKey);
          return 1;
        }

        if (script.includes('underchat:self-heal:clear-owned')) {
          const [inflightKey, recoveryKey, operationId] = args.map(String);
          let deleted = 0;
          if (redisStore.get(inflightKey) === operationId) {
            redisStore.delete(inflightKey);
            deleted += 1;
          }

          const recoveryRaw = redisStore.get(recoveryKey);
          if (recoveryRaw) {
            try {
              const recovery = JSON.parse(recoveryRaw) as {
                operation_id?: string;
              };
              if (recovery.operation_id === operationId) {
                redisStore.delete(recoveryKey);
                deleted += 1;
              }
            } catch {}
          }
          return deleted;
        }

        const keys = args.slice(0, keyCount).map(String);
        const argv = args.slice(keyCount);
        const key = keys[0];
        const token = String(argv[0]);
        const ttlValue = argv[1];
        const ttlMs =
          typeof ttlValue === 'number' ? ttlValue : Number(ttlValue);
        if (script.includes('"SET", KEYS[1]') && keys[1]) {
          if (redisStore.has(key)) {
            return 0;
          }
          redisStore.set(key, token);
          redisStore.set(keys[1], token);
          return 1;
        }
        if (script.includes('PEXPIRE')) {
          if (redisStore.get(key) !== token || !ttlMs) {
            return 0;
          }
          if (keys[1] && redisStore.get(keys[1]) === token) {
            redisStore.delete(keys[1]);
          }
          return 1;
        }

        if (script.includes('DEL')) {
          if (redisStore.get(key) !== token) {
            return 0;
          }

          redisStore.delete(key);
          if (keys[1] && redisStore.get(keys[1]) === token) {
            redisStore.delete(keys[1]);
          }
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
  let consistentWarmPool: Record<string, unknown> | null = null;
  const workerWarmPoolRepository = overrides.workerWarmPoolRepository ?? {
    create: jest.fn(async (input: Record<string, unknown>) => {
      consistentWarmPool = { ...input };
      return consistentWarmPool;
    }),
    viewByIdConsistent: jest.fn(async () => consistentWarmPool),
    finalizeCreationReady: jest.fn(async (input: Record<string, unknown>) => {
      if (consistentWarmPool) {
        consistentWarmPool = {
          ...consistentWarmPool,
          container_id: input.containerId,
          container_name: input.containerName,
          session_volume_name: input.sessionVolumeName,
          state: EWorkerWarmPoolState.ready,
        };
      }
      return true;
    }),
    finalizePostgresCreationReady: jest.fn(
      async (input: Record<string, unknown>) => {
        if (consistentWarmPool) {
          consistentWarmPool = {
            ...consistentWarmPool,
            container_id: input.containerId,
            container_name: input.containerName,
            session_storage: EWorkerSessionStorage.postgres,
            session_volume_name: null,
            runtime_capability_hash: input.runtimeCapabilityHash,
            session_writer_epoch: input.writerEpoch,
            state: EWorkerWarmPoolState.ready,
          };
        }
        return true;
      }
    ),
    recordCreationError: jest.fn(async (input: Record<string, unknown>) => {
      if (consistentWarmPool) {
        consistentWarmPool = {
          ...consistentWarmPool,
          state: EWorkerWarmPoolState.error,
          last_error: input.error,
        };
      }
      return true;
    }),
    recordPostgresCreationError: jest.fn(
      async (input: Record<string, unknown>) => {
        if (consistentWarmPool) {
          consistentWarmPool = {
            ...consistentWarmPool,
            state: EWorkerWarmPoolState.error,
            last_error: input.error,
          };
        }
        return true;
      }
    ),
    viewById: jest.fn(async () => ({
      warm_pool_id: 'warm-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      container_id: 'warm-container-id',
      container_name: 'warm-container',
      session_storage: EWorkerSessionStorage.legacy_volume,
      session_volume_name: 'warm-volume',
      runtime_generation: 1,
      state: EWorkerWarmPoolState.reserved,
      reserved_by_worker_id: 'worker-1',
      reservation_expires_at: '2999-01-01T00:00:00.000Z',
    })),
    markAssigned: jest.fn<Promise<boolean>, [Record<string, string>]>(
      async () => true
    ),
    rejectActivation: jest.fn(async () => true),
    releaseReservedAfterHealthFence: jest.fn(async () => true),
    extendActivationReservation: jest.fn(async () => true),
    beginActivation: jest.fn<Promise<boolean>, [Record<string, string>]>(
      async () => true
    ),
    restorePreGenerationActivationToReady: jest.fn<
      Promise<boolean>,
      [Record<string, string>]
    >(async () => true),
    failActivatingActivation: jest.fn<
      Promise<boolean>,
      [Record<string, string>]
    >(async () => true),
    revertAssignedActivation: jest.fn(async () => true),
    claimFailedActivationCleanup: jest.fn<
      Promise<boolean>,
      [Record<string, unknown>]
    >(async () => true),
    finalizeFailedActivationCleanup: jest.fn<
      Promise<boolean>,
      [Record<string, unknown>]
    >(async () => true),
    finalizeRejectedActivationCleanup: jest.fn(async () => true),
    reconcileDeletingRuntimeLineage: jest.fn(async () => true),
    claimLegacyDeletingContainerForReclaim: jest.fn(
      async (input: Record<string, unknown>) => {
        if (!consistentWarmPool) {
          return null;
        }
        consistentWarmPool = {
          ...consistentWarmPool,
          container_id: input.containerId,
          container_name: input.containerName,
          last_error: 'warm_legacy_reclaim_claimed_v1',
        };
        return { ...consistentWarmPool };
      }
    ),
    withLegacyDeletingReclaimFence: jest.fn(
      async (
        _input: Record<string, unknown>,
        operation: (fence: {
          assertUnreferenced(): Promise<void>;
        }) => Promise<unknown>
      ) => {
        const result = await operation({
          assertUnreferenced: jest.fn(async () => undefined),
        });
        consistentWarmPool = null;
        return result;
      }
    ),
    withConvertedDeletingReclaimFence: jest.fn<
      Promise<unknown | null>,
      [unknown, unknown]
    >(async () => null),
    finalizeLegacyDeletingResourcesAbsent: jest.fn(
      async (
        _input: Record<string, unknown>,
        finalizePhysicalResources: (fence: {
          assertUnreferenced(): Promise<void>;
        }) => Promise<void>
      ) => {
        await finalizePhysicalResources({
          assertUnreferenced: jest.fn(async () => undefined),
        });
        consistentWarmPool = null;
        return true;
      }
    ),
    markRuntime: jest.fn(async (input: Record<string, unknown>) => {
      if (consistentWarmPool) {
        consistentWarmPool = { ...consistentWarmPool, ...input };
      }
      return true;
    }),
    bindPostgresWarmRuntime: jest.fn(async () => true),
    deleteById: jest.fn(async () => true),
    deleteAssignedByWorkerId: jest.fn(async () => 0),
  };
  const workerRuntimeRepository =
    overrides.workerRuntimeRepository ?? buildSelfHealRuntimeRepository(1);
  if (!('prepareRuntimeWriterIdentity' in workerRuntimeRepository)) {
    Object.assign(workerRuntimeRepository, {
      prepareRuntimeWriterIdentity: jest.fn(async () => true),
    });
  }
  if (!('markRecreateBootstrapStarted' in workerRuntimeRepository)) {
    Object.assign(workerRuntimeRepository, {
      markRecreateBootstrapStarted: jest.fn(async () => true),
    });
  }
  if (
    !('revokeFailedOnlineLivenessReplacementRuntime' in workerRuntimeRepository)
  ) {
    Object.assign(workerRuntimeRepository, {
      revokeFailedOnlineLivenessReplacementRuntime: jest.fn(async () => true),
    });
  }
  if (
    !(
      'viewWhatsappProviderHandoffTerminalLifecycleProof' in
      workerRuntimeRepository
    )
  ) {
    Object.assign(workerRuntimeRepository, {
      viewWhatsappProviderHandoffTerminalLifecycleProof: jest.fn(
        async () => null
      ),
    });
  }
  const workerWarmPoolRepositoryForHandler = withBackfilledSessionRows(
    workerWarmPoolRepository,
    new Set([
      'create',
      'viewById',
      'viewByIdConsistent',
      'claimLegacyDeletingContainerForReclaim',
    ])
  );
  const workerRuntimeRepositoryForHandler = withBackfilledSessionRows(
    workerRuntimeRepository,
    new Set([
      'viewByWorkerId',
      'viewByWorkerIdConsistent',
      'upsert',
      'claimReservedRuntimeContainer',
      'claimPreviousRuntimeContainer',
    ])
  );
  const workerLifecycleQueueService = overrides.workerLifecycleQueueService ?? {
    publish: jest.fn(async () => undefined),
    prepare: jest.fn(async () => undefined),
    loadPrepared: jest.fn(async () => []),
    loadPermanentDeletionProof: jest.fn(async () => null),
  };
  const realWorkerRecreateServerSlotService =
    new WorkerRecreateServerSlotService(redis as never);
  const workerRecreateServerSlotService = {
    withSlot:
      overrides.workerRecreateServerSlotService?.withSlot ??
      jest.fn(
        realWorkerRecreateServerSlotService.withSlot.bind(
          realWorkerRecreateServerSlotService
        )
      ),
    tryReserve:
      overrides.workerRecreateServerSlotService?.tryReserve ??
      jest.fn(
        realWorkerRecreateServerSlotService.tryReserve.bind(
          realWorkerRecreateServerSlotService
        )
      ),
    buildToken:
      overrides.workerRecreateServerSlotService?.buildToken ??
      jest.fn(
        realWorkerRecreateServerSlotService.buildToken.bind(
          realWorkerRecreateServerSlotService
        )
      ),
    getSlotCount:
      overrides.workerRecreateServerSlotService?.getSlotCount ??
      jest.fn(
        realWorkerRecreateServerSlotService.getSlotCount.bind(
          realWorkerRecreateServerSlotService
        )
      ),
    release:
      overrides.workerRecreateServerSlotService?.release ??
      jest.fn(
        realWorkerRecreateServerSlotService.release.bind(
          realWorkerRecreateServerSlotService
        )
      ),
  };

  const handler = new WorkerCommandHandlerService(
    workerService as never,
    centrifugoService as never,
    chatService as never,
    workerCommandResourceLifecycleService as never,
    containerHealthService as never,
    workerBaileysGrpcClientService as never,
    serverSshViewerRepository as never,
    workerConfigViewerRepository as never,
    passwordEncryptorService as never,
    s3BackupUploadService as never,
    workerConfigService as never,
    workerLifecycleLockService as never,
    redis as never,
    workerLifecycleQueueService as never,
    redisQueueService as never,
    workerWarmPoolRepositoryForHandler as never,
    workerRuntimeRepositoryForHandler as never,
    undefined as never,
    workerRecreateServerSlotService as never
  );

  return {
    handler,
    workerService: workerService as typeof workerService & {
      viewWorkerForMonitorConsistent: typeof viewWorkerForMonitorConsistent;
    },
    centrifugoService,
    containerHealthService,
    kafkaBaileysQueueService,
    workerCommandResourceLifecycleService,
    workerTopicDeletionAuthorizerService,
    workerBaileysGrpcClientService,
    workerLifecycleLockService,
    workerConfigViewerRepository,
    redisQueueService,
    workerWarmPoolRepository,
    workerRuntimeRepository,
    workerLifecycleQueueService,
    workerRecreateServerSlotService,
    redis,
    redisStore,
  };
}

const flushPromises = async (): Promise<void> => {
  await new Promise((resolve) => setImmediate(resolve));
};

const emulatePersistedRecreateCompletion = (
  deps: ReturnType<typeof buildHandler>,
  initialWorker: Record<string, unknown>,
  outcomes: boolean[] = []
): (() => Record<string, unknown>) => {
  let persistedWorker = { ...initialWorker };
  const pendingOutcomes = [...outcomes];
  deps.workerService.updateWorkerByIdIfLifecycleMatches.mockImplementation(
    async (_accountId: string, update: unknown, fence: unknown) => {
      const succeeded = pendingOutcomes.shift() ?? true;
      if (!succeeded) return false;
      const completion = (
        fence as {
          recreate_completion?: {
            operation_id: string;
            runtime_generation: number;
          };
        }
      ).recreate_completion;
      persistedWorker = {
        ...persistedWorker,
        ...(update as Record<string, unknown>),
        ...(completion
          ? {
              runtime_generation: completion.runtime_generation,
              recreate_completed_operation_id: completion.operation_id,
              recreate_completed_runtime_generation:
                completion.runtime_generation,
              recreate_completed_at: '2026-08-08T00:00:00.000Z',
            }
          : {}),
      };
      return true;
    }
  );
  deps.workerService.viewWorkerForMonitorConsistent.mockImplementation(
    async () => withBackfilledLegacyWorkerSessionStorage({ ...persistedWorker })
  );
  return () => ({ ...persistedWorker });
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

const buildSelfHealRuntimeRepository = (
  runtimeGeneration = 4,
  containerId = 'container-1',
  initialRuntime: Record<string, unknown> = {}
) => {
  const runtime: Record<string, unknown> = {
    worker_id: 'worker-1',
    container_id: containerId,
    container_name: 'worker-1',
    session_storage: EWorkerSessionStorage.legacy_volume,
    session_volume_name: 'worker-1',
    runtime_generation: runtimeGeneration,
    connection_sequence: 1,
    recreate_bootstrap_operation_id: 'operation-1',
    recreate_bootstrap_runtime_generation: runtimeGeneration,
    recreate_bootstrap_container_id: containerId,
    recreate_bootstrap_started_at: '2026-08-08T00:00:00.000Z',
    recreate_retired_operation_id: null,
    recreate_retired_runtime_generation: null,
    recreate_retired_container_id: null,
    recreate_retired_at: null,
    ...initialRuntime,
  };
  return {
    viewByWorkerId: jest.fn<
      Promise<Record<string, unknown> | null>,
      [workerId?: string]
    >(async () => ({ ...runtime })),
    viewByWorkerIdConsistent: jest.fn<
      Promise<Record<string, unknown> | null>,
      [workerId?: string]
    >(async () => ({ ...runtime })),
    viewRecreatedWorkerUnavailableNativeTerminalProof: jest.fn(
      async () => null
    ),
    reserveNextRuntimeGeneration: jest.fn<
      Promise<number>,
      [input: Record<string, unknown>]
    >(async () => runtimeGeneration + 1),
    claimReservedRuntimeContainer: jest.fn(async () => false),
    claimPreviousRuntimeContainer: jest.fn(async () => false),
    markRecreateBootstrapStarted: jest.fn(
      async (input: Record<string, unknown>) => {
        Object.assign(runtime, {
          container_id: input.container_id,
          runtime_generation: input.runtime_generation,
          recreate_bootstrap_operation_id: input.lifecycle_operation_id,
          recreate_bootstrap_runtime_generation: input.runtime_generation,
          recreate_bootstrap_container_id: input.container_id,
          recreate_bootstrap_started_at: '2026-08-08T00:00:00.000Z',
          recreate_retired_operation_id: null,
          recreate_retired_runtime_generation: null,
          recreate_retired_container_id: null,
          recreate_retired_at: null,
        });
        return true;
      }
    ),
    revokeFailedOnlineLivenessReplacementRuntime: jest.fn(
      async (input: Record<string, unknown>) => {
        Object.assign(runtime, {
          runtime_capability_hash: null,
          session_writer_epoch: null,
          connection_epoch: null,
          connection_sequence: 0,
          source_provider: null,
          connection_activated_at: null,
          recreate_bootstrap_operation_id: null,
          recreate_bootstrap_runtime_generation: null,
          recreate_bootstrap_container_id: null,
          recreate_bootstrap_started_at: null,
          recreate_retired_operation_id: input.lifecycle_operation_id,
          recreate_retired_runtime_generation: input.failed_runtime_generation,
          recreate_retired_container_id: input.failed_container_id,
          recreate_retired_at: '2026-08-08T00:00:01.000Z',
        });
        return true;
      }
    ),
    prepareRuntimeWriterIdentity: jest.fn(async () => true),
    prepareWorkerConnectionDisconnect: jest.fn(async () => ({
      status: 'prepared' as const,
      already_prepared: false,
    })),
    activateWhatsappRuntimeFence: jest.fn(async () => ({
      activated: true,
      connection_sequence: 1,
      connection_epoch: '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5d',
    })),
    upsert: jest.fn<
      Promise<Record<string, unknown>>,
      [input: Record<string, unknown>]
    >(async () => ({
      worker_id: 'worker-1',
      session_storage: EWorkerSessionStorage.legacy_volume,
      session_volume_name: 'worker-1',
      runtime_generation: runtimeGeneration,
      connection_sequence: 1,
    })),
    deleteByWorkerId: jest.fn(async () => true),
    deletePostgresWhatsappSessionByWorkerId: jest.fn(async () => true),
    clearWarmPoolReferenceIfMatches: jest.fn(async () => true),
    isSessionVolumeReferencedConsistent: jest.fn(async () => false),
    isSessionVolumeReferencedByOtherWorkerConsistent: jest.fn(
      async () => false
    ),
    tombstoneWarmActivationIfMatches: jest.fn(async () => true),
    viewWhatsappProviderHandoffLifecycleContext: jest.fn(async () => null),
    viewWhatsappProviderHandoffTerminalLifecycleProof: jest.fn(
      async () => null
    ),
    viewWhatsappProviderHandoffRecoveryLifecycleProof: jest.fn(
      async () => null
    ),
    viewWhatsappProviderHandoffDiscardPrimaryGate: jest.fn(async () => null),
    viewWhatsappProviderEmptySwitchPrimaryProof: jest.fn(async () => null),
    failWhatsappProviderHandoffBeforeSourceDrain: jest.fn(async () => true),
    acknowledgeWhatsappProviderHandoffSourceDrained: jest.fn(async () => true),
    isWhatsappProviderHandoffTargetAuthorized: jest.fn(async () => false),
  };
};

/**
 * Older assertions in this suite predate the durable lifecycle journal. Keep
 * their business assertions useful by executing journal-backed recreate and
 * cleanup commands with the same immutable runtime proof production requires.
 * The gRPC boundary has separate coverage for journal-less terminal no-ops.
 */
const handleWorkerCommand = async (
  deps: ReturnType<typeof buildHandler>,
  input: IWorkerPayload
): Promise<void> => {
  let completedWorkerState: Record<string, unknown> | null = null;
  const consistentWorkerReader =
    deps.workerService.viewWorkerForMonitorConsistent.getMockImplementation();
  deps.workerService.viewWorkerForMonitorConsistent.mockImplementation(
    async (workerId: string) =>
      withBackfilledLegacyWorkerSessionStorage(
        completedWorkerState ?? (await consistentWorkerReader?.(workerId))
      )
  );
  if (
    (input.action !== EWorkerAction.recreate &&
      input.action !== EWorkerAction.cleanup) ||
    input.expected_container_id
  ) {
    await WorkerCommandHandlerService.prototype.handle.call(
      deps.handler,
      input
    );
    return;
  }

  const synthesizedLifecycle = !input.lifecycle_operation_id;
  const lifecycleOperationId =
    input.lifecycle_operation_id ?? 'test-lifecycle-operation';
  const workerType = input.worker_type_id ?? EWorkerType.wwebjs;
  const monitorImplementation =
    deps.workerService.viewWorkerForMonitor.getMockImplementation();
  const configuredWorker = synthesizedLifecycle
    ? undefined
    : await monitorImplementation?.(input.worker_id);
  const containerInspectionImplementation =
    deps.workerService.inspectContainerWorkerById.getMockImplementation();
  const configuredInspection = await containerInspectionImplementation?.(
    input.worker_id
  );
  const configuredInitialContainerId =
    configuredWorker?.container_id?.trim() ||
    configuredInspection?.container_id?.trim() ||
    'container-1';
  const initialContainerId =
    configuredInitialContainerId === 'container-1'
      ? LIFECYCLE_RUNTIME_CONTAINER_ID
      : configuredInitialContainerId;
  const runtimeRepository =
    deps.workerRuntimeRepository ??
    buildSelfHealRuntimeRepository(1, initialContainerId);
  const mutableRuntimeRepository = runtimeRepository as unknown as {
    viewByWorkerId: jest.Mock<
      Promise<Record<string, unknown> | null>,
      [string]
    >;
    viewByWorkerIdConsistent?: jest.Mock<
      Promise<Record<string, unknown> | null>,
      [string]
    >;
    reserveNextRuntimeGeneration?: jest.Mock<Promise<number>, [unknown?]>;
    markRecreateBootstrapStarted?: jest.Mock<Promise<boolean>, [unknown?]>;
    upsert: jest.Mock<Promise<unknown>, [unknown?]>;
  };
  if (typeof mutableRuntimeRepository.viewByWorkerIdConsistent !== 'function') {
    mutableRuntimeRepository.viewByWorkerIdConsistent = jest.fn(
      (workerId: string) => mutableRuntimeRepository.viewByWorkerId(workerId)
    );
  }
  if (
    typeof mutableRuntimeRepository.markRecreateBootstrapStarted !== 'function'
  ) {
    mutableRuntimeRepository.markRecreateBootstrapStarted = jest.fn(
      async () => true
    );
  }
  (
    deps.handler as unknown as {
      workerRuntimeRepository: typeof mutableRuntimeRepository;
    }
  ).workerRuntimeRepository = withBackfilledSessionRows(
    mutableRuntimeRepository,
    new Set([
      'viewByWorkerId',
      'viewByWorkerIdConsistent',
      'upsert',
      'claimReservedRuntimeContainer',
      'claimPreviousRuntimeContainer',
    ])
  );

  const initialRuntime =
    (await mutableRuntimeRepository.viewByWorkerIdConsistent?.(
      input.worker_id
    )) ?? null;
  let runtime: Record<string, unknown> = initialRuntime
    ? {
        ...initialRuntime,
        container_id:
          initialRuntime.container_id === 'container-1'
            ? initialContainerId
            : initialRuntime.container_id,
        runtime_generation:
          Number.isSafeInteger(initialRuntime.runtime_generation) &&
          Number(initialRuntime.runtime_generation) > 0
            ? initialRuntime.runtime_generation
            : 1,
      }
    : {
        worker_id: input.worker_id,
        container_id: initialContainerId,
        container_name: input.worker_id,
        session_storage:
          input.session_storage ?? EWorkerSessionStorage.legacy_volume,
        session_volume_name: input.worker_id,
        runtime_generation: 1,
        connection_sequence: 1,
      };
  const previousRuntimeUpsert =
    mutableRuntimeRepository.upsert.getMockImplementation();
  mutableRuntimeRepository.upsert.mockImplementation(
    async (update?: unknown) => {
      const result = previousRuntimeUpsert
        ? await previousRuntimeUpsert(update)
        : update;
      runtime = {
        ...runtime,
        ...(update as Record<string, unknown>),
      };
      return result;
    }
  );
  if (
    mutableRuntimeRepository.reserveNextRuntimeGeneration &&
    typeof mutableRuntimeRepository.reserveNextRuntimeGeneration
      .mockImplementation === 'function'
  ) {
    const previousReserve =
      mutableRuntimeRepository.reserveNextRuntimeGeneration.getMockImplementation();
    mutableRuntimeRepository.reserveNextRuntimeGeneration.mockImplementation(
      async (update?: unknown) => {
        const generation = previousReserve
          ? await previousReserve(update)
          : Number(runtime.runtime_generation ?? 0) + 1;
        runtime = {
          ...runtime,
          ...(update as Record<string, unknown>),
          container_id: null,
          runtime_generation: generation,
        };
        return generation;
      }
    );
  }
  if (
    mutableRuntimeRepository.markRecreateBootstrapStarted &&
    typeof mutableRuntimeRepository.markRecreateBootstrapStarted
      .mockImplementation === 'function'
  ) {
    const previousMark =
      mutableRuntimeRepository.markRecreateBootstrapStarted.getMockImplementation();
    mutableRuntimeRepository.markRecreateBootstrapStarted.mockImplementation(
      async (update?: unknown) => {
        const marked = previousMark ? await previousMark(update) : true;
        if (marked) {
          const marker = update as Record<string, unknown>;
          runtime = {
            ...runtime,
            container_id: marker.container_id,
            runtime_generation: marker.runtime_generation,
            recreate_bootstrap_operation_id: marker.lifecycle_operation_id,
            recreate_bootstrap_runtime_generation: marker.runtime_generation,
            recreate_bootstrap_container_id: marker.container_id,
            recreate_bootstrap_started_at: '2026-08-08T00:00:00.000Z',
            recreate_retired_operation_id: null,
            recreate_retired_runtime_generation: null,
            recreate_retired_container_id: null,
            recreate_retired_at: null,
          };
        }
        return marked;
      }
    );
  }
  mutableRuntimeRepository.viewByWorkerIdConsistent?.mockImplementation(
    async () => ({ ...runtime })
  );

  const removedContainerIds = new Set<string>();
  let worker = {
    worker_id: input.worker_id,
    name: 'Canal 1',
    account_id: input.account_id,
    server_id: input.server_id,
    worker_status_id:
      input.action === EWorkerAction.cleanup
        ? EWorkerStatus.blocked
        : EWorkerStatus.recreating,
    worker_type_id: workerType,
    session_storage:
      input.session_storage ?? EWorkerSessionStorage.legacy_volume,
    created_at: null,
    updated_at: null,
    deleted_at: null,
    container_id:
      typeof runtime.container_id === 'string'
        ? runtime.container_id
        : initialContainerId,
    lifecycle_operation_id: lifecycleOperationId,
    last_connection_check_at: null,
  };
  if (synthesizedLifecycle) {
    deps.workerService.viewWorkerForMonitor.mockImplementation(async () => ({
      ...worker,
    }));
  }

  const previousStrictInspection =
    deps.workerService.inspectContainerWorkerByIdStrict.getMockImplementation();
  deps.workerService.inspectContainerWorkerByIdStrict.mockImplementation(
    async (target: string) => {
      const containerId =
        typeof runtime.container_id === 'string'
          ? runtime.container_id
          : initialContainerId;
      const sessionVolumeName =
        typeof runtime.session_volume_name === 'string' &&
        runtime.session_volume_name.trim()
          ? runtime.session_volume_name
          : input.worker_id;
      const runtimeGeneration =
        Number.isSafeInteger(runtime.runtime_generation) &&
        Number(runtime.runtime_generation) > 0
          ? Number(runtime.runtime_generation)
          : 1;
      if (target.toLowerCase() !== containerId.toLowerCase()) {
        return previousStrictInspection
          ? previousStrictInspection(target)
          : { exists: false, container_name: target };
      }
      if (removedContainerIds.has(containerId.toLowerCase())) {
        return {
          exists: false,
          container_id: containerId,
          container_name: input.worker_id,
        };
      }
      return buildWorkerContainerInspection({
        container_id: containerId,
        container_name: input.worker_id,
        container_labels: {
          ...buildWorkerContainerInspection().container_labels,
          'underchat.worker_id': input.worker_id,
          'underchat.account_id': input.account_id,
          'underchat.server_id': input.server_id,
          'underchat.worker_type_id': workerType,
          'underchat.runtime_generation': String(runtimeGeneration),
          'underchat.session_volume_name': sessionVolumeName,
        },
        container_env: {
          ...buildWorkerContainerInspection().container_env,
          WORKER_ID: input.worker_id,
          ACCOUNT_ID: input.account_id,
          WORKER_TYPE_ID: workerType,
          RUNTIME_GENERATION: String(runtimeGeneration),
          SESSION_VOLUME_NAME: sessionVolumeName,
        },
        container_mounts: [
          {
            destination: '/app/data',
            name: sessionVolumeName,
            read_write: true,
            type: 'volume',
          },
        ],
      });
    }
  );

  const previousRemove =
    deps.workerService.removeContainerWorkerById.getMockImplementation();
  deps.workerService.removeContainerWorkerById.mockImplementation(
    async (target: string) => {
      const removed = previousRemove ? await previousRemove(target) : true;
      if (removed) {
        removedContainerIds.add(target.toLowerCase());
      }
      return removed;
    }
  );
  deps.workerService.listContainerIdsMountingVolumeStrict.mockImplementation(
    async (volumeName: string) => {
      const containerId =
        typeof runtime.container_id === 'string'
          ? runtime.container_id
          : initialContainerId;
      const sessionVolumeName =
        typeof runtime.session_volume_name === 'string'
          ? runtime.session_volume_name
          : input.worker_id;
      return volumeName === sessionVolumeName &&
        !removedContainerIds.has(containerId.toLowerCase())
        ? [containerId.toLowerCase()]
        : [];
    }
  );

  const previousConditionalUpdate =
    deps.workerService.updateWorkerByIdIfLifecycleMatches.getMockImplementation();
  deps.workerService.updateWorkerByIdIfLifecycleMatches.mockImplementation(
    async (accountId: string, update: unknown, fence: unknown) => {
      const updated = previousConditionalUpdate
        ? await previousConditionalUpdate(accountId, update, fence)
        : true;
      if (updated) {
        const recreateCompletion = (
          fence as {
            recreate_completion?: {
              operation_id: string;
              runtime_generation: number;
            };
          }
        ).recreate_completion;
        worker = {
          ...worker,
          ...(update as Partial<typeof worker>),
          ...(recreateCompletion
            ? {
                recreate_completed_operation_id:
                  recreateCompletion.operation_id,
                recreate_completed_runtime_generation:
                  recreateCompletion.runtime_generation,
                recreate_completed_at: '2026-08-08T00:00:00.000Z',
                runtime_generation: recreateCompletion.runtime_generation,
              }
            : {}),
        };
        completedWorkerState = worker;
        await deps.workerService.updateWorkerById(accountId, update);
      }
      return updated;
    }
  );

  if (synthesizedLifecycle) {
    const previousRequestConnection =
      deps.workerBaileysGrpcClientService.requestConnection.getMockImplementation();
    deps.workerBaileysGrpcClientService.requestConnection.mockImplementation(
      async (...args: unknown[]) => {
        const response = previousRequestConnection
          ? await Reflect.apply(previousRequestConnection, undefined, args)
          : buildConnectedState();
        const expectedGeneration = Number(runtime.runtime_generation ?? 1);
        return response?.runtime_generation === 1 && expectedGeneration > 1
          ? { ...response, runtime_generation: expectedGeneration }
          : response;
      }
    );
    const previousRuntimeHealth =
      deps.workerBaileysGrpcClientService.runtimeHealth.getMockImplementation();
    deps.workerBaileysGrpcClientService.runtimeHealth.mockImplementation(
      async (...args: unknown[]) => {
        const response = previousRuntimeHealth
          ? await Reflect.apply(previousRuntimeHealth, undefined, args)
          : {};
        const expectedGeneration = Number(runtime.runtime_generation ?? 1);
        return response?.runtime_generation === 1 && expectedGeneration > 1
          ? { ...response, runtime_generation: expectedGeneration }
          : response;
      }
    );
  }

  await WorkerCommandHandlerService.prototype.handle.call(deps.handler, {
    ...input,
    worker_type_id: workerType,
    lifecycle_operation_id: lifecycleOperationId,
  });
};

const buildPersistedColdRecreateImageHarness = (options: {
  containerImageContentId: string;
  labelledImageContentId?: string;
  currentWorkerType?: EWorkerType;
  currentWorkerContainerId?: string;
  targetAuthorized?: boolean;
  targetContainerExists?: boolean;
  canonicalTargetExists?: boolean;
  runtimeContainerId?: string | null;
  runtimeCapabilityHash?: string | null;
  sessionWriterEpoch?: string | null;
  runtimeSourceProvider?: string | null;
  connectionEpoch?: string | null;
  connectionSequence?: number;
  connectionActivatedAt?: string | null;
  payload?: Partial<IWorkerPayload>;
}) => {
  const containerId = 'd'.repeat(64);
  const controlContainerId = options.currentWorkerContainerId ?? containerId;
  const runtimeContainerId =
    options.runtimeContainerId === undefined
      ? containerId
      : options.runtimeContainerId;
  const runtimeGeneration = 9;
  const lifecycleOperationId = '00000000-0000-4000-8000-000000000091';
  const runtimeCapabilityHash = createHash('sha256')
    .update(WARM_RUNTIME_CAPABILITY)
    .digest('hex');
  const persistedRuntime = {
    worker_id: 'worker-1',
    container_id: runtimeContainerId,
    container_name: 'worker-1',
    session_storage: EWorkerSessionStorage.postgres,
    session_volume_name: null,
    runtime_capability_hash:
      options.runtimeCapabilityHash === undefined
        ? runtimeCapabilityHash
        : options.runtimeCapabilityHash,
    session_writer_epoch:
      options.sessionWriterEpoch === undefined
        ? WARM_RUNTIME_WRITER_EPOCH
        : options.sessionWriterEpoch,
    runtime_generation: runtimeGeneration,
    warm_pool_id: null,
    source_provider:
      options.runtimeSourceProvider === undefined
        ? null
        : options.runtimeSourceProvider,
    connection_epoch:
      options.connectionEpoch === undefined ? null : options.connectionEpoch,
    connection_activated_at:
      options.connectionActivatedAt === undefined
        ? null
        : options.connectionActivatedAt,
    connection_sequence: options.connectionSequence ?? 0,
  };
  const runtimeRepository = {
    ...buildSelfHealRuntimeRepository(runtimeGeneration, containerId),
    viewByWorkerId: jest.fn(async () => ({ ...persistedRuntime })),
    viewByWorkerIdConsistent: jest.fn(async () => ({ ...persistedRuntime })),
    reserveNextRuntimeGeneration: jest.fn(async () => runtimeGeneration + 1),
    markRecreateBootstrapStarted: jest.fn(
      async (input: Record<string, unknown>) => {
        Object.assign(persistedRuntime, {
          container_id: input.container_id,
          runtime_generation: input.runtime_generation,
          recreate_bootstrap_operation_id: input.lifecycle_operation_id,
          recreate_bootstrap_runtime_generation: input.runtime_generation,
          recreate_bootstrap_container_id: input.container_id,
          recreate_bootstrap_started_at: '2026-08-08T00:00:00.000Z',
          recreate_retired_operation_id: null,
          recreate_retired_runtime_generation: null,
          recreate_retired_container_id: null,
          recreate_retired_at: null,
        });
        return true;
      }
    ),
  };
  runtimeRepository.isWhatsappProviderHandoffTargetAuthorized.mockResolvedValue(
    options.targetAuthorized === true
  );
  const deps = buildHandler({ workerRuntimeRepository: runtimeRepository });
  const payload: IWorkerPayload = {
    action: EWorkerAction.recreate,
    worker_id: 'worker-1',
    account_id: 'account-1',
    server_id: 'server-1',
    worker_type_id: EWorkerType.wwebjs,
    session_storage: EWorkerSessionStorage.postgres,
    remove_session: false,
    remove_volume: false,
    lifecycle_operation_id: lifecycleOperationId,
    debug_trace_id: 'trace-recreate-image-fence',
    ...options.payload,
  };
  let currentWorker: IWorkerMonitor = {
    worker_id: payload.worker_id,
    name: 'Canal 1',
    account_id: payload.account_id,
    server_id: payload.server_id,
    worker_status_id: EWorkerStatus.recreating,
    worker_type_id: options.currentWorkerType ?? EWorkerType.wwebjs,
    session_storage: EWorkerSessionStorage.postgres,
    created_at: null,
    updated_at: null,
    deleted_at: null,
    container_id: controlContainerId,
    runtime_container_id: runtimeContainerId,
    runtime_generation: runtimeGeneration,
    runtime_session_volume_name: null,
    lifecycle_operation_id: lifecycleOperationId,
    last_connection_check_at: null,
  };
  deps.workerService.viewWorkerForMonitor.mockImplementation(async () => ({
    ...currentWorker,
  }));
  const inspection = buildWorkerContainerInspection({
    container_id: containerId,
    container_name: payload.worker_id,
    container_image_id: options.containerImageContentId,
    container_labels: {
      'underchat.worker_id': payload.worker_id,
      'underchat.account_id': payload.account_id,
      'underchat.server_id': payload.server_id,
      'underchat.worker_type_id': EWorkerType.wwebjs,
      'underchat.worker_image': 'under-worker-wwebjs:latest',
      'underchat.worker_image_content_id':
        options.labelledImageContentId ?? options.containerImageContentId,
      'underchat.worker_grpc_port': '50053',
      'underchat.runtime_generation': String(runtimeGeneration),
      'underchat.lifecycle_operation_id': lifecycleOperationId,
      'underchat.session_storage': EWorkerSessionStorage.postgres,
    },
    container_env: {
      WORKER_ID: payload.worker_id,
      ACCOUNT_ID: payload.account_id,
      WORKER_TYPE_ID: EWorkerType.wwebjs,
      WORKER_IMAGE: 'under-worker-wwebjs:latest',
      WORKER_GRPC_PORT: '50053',
      RUNTIME_GENERATION: String(runtimeGeneration),
      WORKER_SESSION_STORAGE: EWorkerSessionStorage.postgres,
    },
    container_mounts: [],
    running: true,
  });
  let targetContainerExists = options.targetContainerExists !== false;
  deps.workerService.inspectContainerWorkerByIdStrict.mockImplementation(
    async (target: string) =>
      target.trim().toLowerCase() === containerId
        ? {
            ...inspection,
            exists: targetContainerExists,
            running: targetContainerExists && inspection.running === true,
          }
        : target === payload.worker_id && options.canonicalTargetExists === true
          ? {
              ...inspection,
              container_id: 'f'.repeat(64),
              container_name: payload.worker_id,
              exists: true,
              running: true,
            }
          : { exists: false, container_name: target }
  );
  deps.workerService.removeContainerWorkerById.mockImplementation(
    async (target: string) => {
      if (target.trim().toLowerCase() === containerId) {
        targetContainerExists = false;
      }
      return true;
    }
  );
  deps.workerService.updateWorkerByIdIfLifecycleMatches.mockImplementation(
    async (_accountId: string, update: unknown) => {
      currentWorker = {
        ...currentWorker,
        ...(update as Partial<IWorkerMonitor>),
      };
      return true;
    }
  );
  deps.workerService.createContainerWorker.mockImplementation(async () => {
    if (targetContainerExists) {
      throw new Error('test_container_name_collision');
    }
    return 'container-1';
  });

  const prepareRecreateWorker = jest.fn(async () => true);
  const resolveRecreateExecutionContext = jest.fn(async () => ({
    currentWorker,
    workerType: payload.worker_type_id ?? EWorkerType.wwebjs,
  }));
  const resolveStableWorkerImageContentId = jest.fn(
    async () => WORKER_IMAGE_CONTENT_ID
  );
  const assertMissingJournalRecreateProviderSafe = jest.fn(
    async () => undefined
  );
  const resolveRecreateSessionContext = jest.fn(async () => ({
    shouldRemoveSession: payload.remove_session === true,
    sessionStorage: EWorkerSessionStorage.postgres,
    shouldRemoveVolume: false,
    sessionVolumeResolution: {
      runtimeGeneration,
      ...(payload.remove_session === true
        ? {
            sessionDeletionRuntimeFence: {
              runtime_generation: runtimeGeneration,
              container_id: runtimeContainerId,
              session_storage: EWorkerSessionStorage.postgres,
              session_volume_name: null,
            },
          }
        : {}),
      source: 'postgres',
      runtimeWasBackfilled: false,
    },
    preservedSessionVolumeName: undefined,
    sessionWasReset: false,
  }));
  const finalizeAdoptedRecreateRuntime = jest.fn(async () => ({
    adopted: true,
  }));
  const isLifecycleOperationCurrent = jest.fn(async () => true);
  const invalidateQrAttemptState = jest.fn(async () => undefined);
  const assertPreservedSessionVolumeExists = jest.fn(async () => undefined);
  const resolveRecreateRuntimeRemovalDecision = jest.fn(async () => ({
    status: 'removed' as const,
    reason: 'test_generic_removal',
  }));
  const assertLifecycleOperationCurrent = jest.fn(async () => undefined);
  const resolveWorkerProxyConfig = jest.fn(async () => undefined);
  const assertLifecycleCurrentForCreatedContainer = jest.fn(
    async () => undefined
  );
  const checkRecreatedContainerHealth = jest.fn(async () =>
    buildContainerHealthResult()
  );
  const logDebug = jest.fn();
  const handler = deps.handler as unknown as {
    performRecreateWorker(
      data: IWorkerPayload,
      lease: ILockLeaseContext
    ): Promise<unknown>;
  };
  Object.assign(handler, {
    prepareRecreateWorker,
    resolveRecreateExecutionContext,
    resolveStableWorkerImageContentId,
    assertMissingJournalRecreateProviderSafe,
    resolveRecreateSessionContext,
    finalizeAdoptedRecreateRuntime,
    isLifecycleOperationCurrent,
    invalidateQrAttemptState,
    assertPreservedSessionVolumeExists,
    resolveRecreateRuntimeRemovalDecision,
    assertLifecycleOperationCurrent,
    resolveWorkerProxyConfig,
    assertLifecycleCurrentForCreatedContainer,
    checkRecreatedContainerHealth,
    logDebug,
  });

  return {
    deps,
    handler,
    payload,
    currentWorker,
    lease: {
      signal: new AbortController().signal,
      assertActive: jest.fn(),
    } satisfies ILockLeaseContext,
    containerId,
    runtimeGeneration,
    runtimeRepository,
    persistedRuntime,
    inspection,
    hasTargetContainer: () => targetContainerExists,
    resolveStableWorkerImageContentId,
    finalizeAdoptedRecreateRuntime,
    resolveRecreateRuntimeRemovalDecision,
    assertLifecycleOperationCurrent,
    checkRecreatedContainerHealth,
    logDebug,
  };
};

const handleCreateWithRetryProof = async (
  deps: ReturnType<typeof buildHandler>,
  input: IWorkerPayload
): Promise<void> => {
  const lifecycleOperationId = 'test-create-retry-operation';
  const workerType = input.worker_type_id ?? EWorkerType.wwebjs;
  let runtime: Record<string, unknown> | null = null;
  const runtimeRepository = {
    viewByWorkerId: jest.fn(async () =>
      runtime ? ({ ...runtime } as Record<string, unknown>) : null
    ),
    viewByWorkerIdConsistent: jest.fn(async () =>
      runtime ? ({ ...runtime } as Record<string, unknown>) : null
    ),
    reserveNextRuntimeGeneration: jest.fn(
      async (reservation: Record<string, unknown>) => {
        runtime = {
          ...reservation,
          worker_id: input.worker_id,
          container_id: null,
          runtime_generation: 1,
          connection_sequence: 1,
        };
        return 1;
      }
    ),
    prepareRuntimeWriterIdentity: jest.fn(async () => true),
    activateWhatsappRuntimeFence: jest.fn(async () => ({
      activated: true,
      connection_sequence: 1,
      connection_epoch: '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5d',
    })),
    upsert: jest.fn(async (update: Record<string, unknown>) => {
      runtime = { ...runtime, ...update };
      return { ...runtime };
    }),
    deleteByWorkerId: jest.fn(async () => true),
    deletePostgresWhatsappSessionByWorkerId: jest.fn(async () => true),
    clearWarmPoolReferenceIfMatches: jest.fn(async () => true),
    isSessionVolumeReferencedConsistent: jest.fn(async () => false),
    isSessionVolumeReferencedByOtherWorkerConsistent: jest.fn(
      async () => false
    ),
    tombstoneWarmActivationIfMatches: jest.fn(async () => true),
  };
  (
    deps.handler as unknown as {
      workerRuntimeRepository: typeof runtimeRepository;
    }
  ).workerRuntimeRepository = withBackfilledSessionRows(
    runtimeRepository,
    new Set(['viewByWorkerId', 'viewByWorkerIdConsistent', 'upsert'])
  );

  let worker = {
    worker_id: input.worker_id,
    name: 'Canal 1',
    account_id: input.account_id,
    server_id: input.server_id,
    worker_status_id: EWorkerStatus.creating,
    worker_type_id: workerType,
    session_storage:
      input.session_storage ?? EWorkerSessionStorage.legacy_volume,
    created_at: null,
    updated_at: null,
    deleted_at: null,
    container_id: null as string | null,
    lifecycle_operation_id: lifecycleOperationId as string | null,
    last_connection_check_at: null,
  };
  deps.workerService.viewWorkerForMonitor.mockImplementation(async () => ({
    ...worker,
  }));

  const removedContainerIds = new Set<string>();
  deps.workerService.inspectContainerWorkerByIdStrict.mockImplementation(
    async (target: string) => {
      const runtimeContainerId =
        typeof runtime?.container_id === 'string'
          ? runtime.container_id
          : undefined;
      if (
        !runtimeContainerId ||
        target.toLowerCase() !== runtimeContainerId.toLowerCase() ||
        removedContainerIds.has(target.toLowerCase())
      ) {
        return {
          exists: false,
          container_id: target,
          container_name: input.worker_id,
        };
      }
      const sessionVolumeName =
        typeof runtime?.session_volume_name === 'string'
          ? runtime.session_volume_name
          : input.worker_id;
      const runtimeGeneration = Number(runtime?.runtime_generation ?? 1);
      return buildWorkerContainerInspection({
        container_id: runtimeContainerId,
        container_name: input.worker_id,
        container_labels: {
          ...buildWorkerContainerInspection().container_labels,
          'underchat.worker_id': input.worker_id,
          'underchat.account_id': input.account_id,
          'underchat.server_id': input.server_id,
          'underchat.worker_type_id': workerType,
          'underchat.runtime_generation': String(runtimeGeneration),
          'underchat.session_volume_name': sessionVolumeName,
          'underchat.lifecycle_operation_id': lifecycleOperationId,
        },
        container_env: {
          ...buildWorkerContainerInspection().container_env,
          WORKER_ID: input.worker_id,
          ACCOUNT_ID: input.account_id,
          WORKER_TYPE_ID: workerType,
          RUNTIME_GENERATION: String(runtimeGeneration),
          SESSION_VOLUME_NAME: sessionVolumeName,
        },
        container_mounts: [
          {
            destination: '/app/data',
            name: sessionVolumeName,
            read_write: true,
            type: 'volume',
          },
        ],
      });
    }
  );
  const previousRemove =
    deps.workerService.removeContainerWorkerById.getMockImplementation();
  deps.workerService.removeContainerWorkerById.mockImplementation(
    async (containerId: string) => {
      const removed = previousRemove ? await previousRemove(containerId) : true;
      if (removed) {
        removedContainerIds.add(containerId.toLowerCase());
      }
      return removed;
    }
  );

  deps.workerService.updateWorkerByIdIfLifecycleMatches.mockImplementation(
    async (accountId: string, update: unknown, rawFence: unknown) => {
      const fence = rawFence as Record<string, unknown>;
      const expectedStatus = fence.worker_status_id;
      const expectedLifecycle = fence.lifecycle_operation_id;
      const expectedRuntimeContainer = fence.runtime_container_id;
      const expectedRuntimeGeneration = fence.runtime_generation;
      const matches =
        worker.account_id === accountId &&
        worker.lifecycle_operation_id === expectedLifecycle &&
        (!expectedStatus || worker.worker_status_id === expectedStatus) &&
        (!expectedRuntimeContainer ||
          runtime?.container_id === expectedRuntimeContainer) &&
        (expectedRuntimeGeneration === undefined ||
          runtime?.runtime_generation === expectedRuntimeGeneration);
      if (!matches) {
        return false;
      }
      worker = {
        ...worker,
        ...(update as Partial<typeof worker>),
      };
      await deps.workerService.updateWorkerById(accountId, update);
      return true;
    }
  );

  await WorkerCommandHandlerService.prototype.handle.call(deps.handler, {
    ...input,
    worker_type_id: workerType,
    lifecycle_operation_id: lifecycleOperationId,
  });
};

const prepareWarmActivation = (deps: ReturnType<typeof buildHandler>): void => {
  deps.workerService.createContainerWorker.mockResolvedValue(
    'replacement-container-id'
  );
  let warmRecord: Record<string, unknown> = {
    warm_pool_id: 'warm-1',
    server_id: 'server-1',
    worker_type_id: EWorkerType.baileys,
    container_id: 'warm-container-id',
    container_name: 'warm-warm-1',
    session_storage: EWorkerSessionStorage.legacy_volume,
    session_volume_name: 'warm-warm-1',
    runtime_generation: 1,
    state: EWorkerWarmPoolState.reserved,
    reserved_by_worker_id: 'worker-1',
    reservation_expires_at: '2999-07-28T11:30:00.000Z',
  };
  deps.workerWarmPoolRepository.viewByIdConsistent.mockImplementation(
    async () => ({ ...warmRecord })
  );
  deps.workerWarmPoolRepository.beginActivation.mockImplementation(async () => {
    warmRecord = {
      ...warmRecord,
      state: EWorkerWarmPoolState.activating,
      reservation_expires_at: null,
    };
    return true;
  });
  deps.workerWarmPoolRepository.restorePreGenerationActivationToReady.mockImplementation(
    async () => {
      warmRecord = {
        ...warmRecord,
        state: EWorkerWarmPoolState.ready,
        reserved_by_worker_id: null,
        reservation_expires_at: null,
      };
      return true;
    }
  );
  deps.workerWarmPoolRepository.markAssigned.mockImplementation(
    async (input: Record<string, string>) => {
      warmRecord = {
        ...warmRecord,
        state: EWorkerWarmPoolState.assigned,
        container_id: input.assignedContainerId,
        container_name: input.assignedContainerName,
        reservation_expires_at: null,
      };
      return true;
    }
  );
  deps.workerWarmPoolRepository.failActivatingActivation.mockImplementation(
    async () => {
      warmRecord = {
        ...warmRecord,
        state: EWorkerWarmPoolState.error,
        container_id: null,
        container_name: null,
        reserved_by_worker_id: null,
        reservation_expires_at: null,
      };
      return true;
    }
  );
  deps.workerWarmPoolRepository.revertAssignedActivation.mockImplementation(
    async () => {
      warmRecord = {
        ...warmRecord,
        state: EWorkerWarmPoolState.error,
        container_id: null,
        container_name: null,
        reserved_by_worker_id: null,
        reservation_expires_at: null,
      };
      return true;
    }
  );
  deps.workerWarmPoolRepository.claimFailedActivationCleanup.mockImplementation(
    async (input: Record<string, unknown>) => {
      const currentWorker =
        await deps.workerService.viewWorkerForMonitor('worker-1');
      if (
        !currentWorker ||
        currentWorker.worker_status_id !== input.expectedWorkerStatusId ||
        currentWorker.lifecycle_operation_id !== input.lifecycleOperationId
      ) {
        return false;
      }
      deps.workerService.viewWorkerForMonitor.mockResolvedValue({
        ...currentWorker,
        worker_status_id: EWorkerStatus.error,
      });
      warmRecord = {
        ...warmRecord,
        last_error: input.pendingError,
      };
      return true;
    }
  );
  deps.workerWarmPoolRepository.finalizeFailedActivationCleanup.mockImplementation(
    async (input: Record<string, unknown>) => {
      warmRecord = {
        ...warmRecord,
        state: EWorkerWarmPoolState.error,
        container_id: null,
        container_name: null,
        reserved_by_worker_id: null,
        reservation_expires_at: null,
        last_error: input.error,
      };
      return true;
    }
  );
  deps.workerWarmPoolRepository.finalizeRejectedActivationCleanup.mockImplementation(
    async () => {
      warmRecord = {
        ...warmRecord,
        state: EWorkerWarmPoolState.error,
        container_id: null,
        container_name: null,
        reserved_by_worker_id: null,
        reservation_expires_at: null,
      };
      return true;
    }
  );
  if (deps.workerRuntimeRepository) {
    let runtimeRecord: Record<string, unknown> | null = null;
    deps.workerRuntimeRepository.reserveNextRuntimeGeneration?.mockImplementation(
      async (input: Record<string, unknown>) => {
        runtimeRecord = {
          ...input,
          container_id: null,
          runtime_generation: 5,
          connection_sequence: 0,
        };
        return 5;
      }
    );
    deps.workerRuntimeRepository.upsert.mockImplementation(
      async (input: Record<string, unknown>) => {
        runtimeRecord = {
          ...runtimeRecord,
          ...input,
          connection_sequence: 0,
        };
        return runtimeRecord;
      }
    );
    deps.workerRuntimeRepository.viewByWorkerIdConsistent?.mockImplementation(
      async () => runtimeRecord
    );
    deps.workerRuntimeRepository.tombstoneWarmActivationIfMatches?.mockImplementation(
      async () => {
        runtimeRecord = runtimeRecord
          ? {
              ...runtimeRecord,
              container_id: null,
              session_volume_name: 'retired-warm-warm-1-5',
              warm_pool_id: null,
            }
          : null;
        return true;
      }
    );
  }
  deps.workerService.viewWorkerForMonitor.mockResolvedValue({
    worker_id: 'worker-1',
    account_id: 'account-1',
    server_id: 'server-1',
    worker_status_id: EWorkerStatus.creating,
    worker_type_id: EWorkerType.baileys,
    deleted_at: null,
    container_id: null,
    lifecycle_operation_id: null,
  });
  deps.workerService.inspectContainerWorkerById
    .mockResolvedValueOnce(
      buildWarmContainerInspection({
        container_name: 'warm-warm-1',
        container_labels: {
          ...buildWarmContainerInspection().container_labels,
          'underchat.warm_pool_id': 'warm-1',
          'underchat.session_volume_name': 'warm-warm-1',
        },
        container_env: {
          ...buildWarmContainerInspection().container_env,
          WARM_POOL_ID: 'warm-1',
          SESSION_VOLUME_NAME: 'warm-warm-1',
        },
      })
    )
    .mockResolvedValueOnce(
      buildWarmContainerInspection({
        container_name: 'warm-warm-1',
        container_labels: {
          ...buildWarmContainerInspection().container_labels,
          'underchat.warm_pool_id': 'warm-1',
          'underchat.session_volume_name': 'warm-warm-1',
        },
        container_env: {
          ...buildWarmContainerInspection().container_env,
          WARM_POOL_ID: 'warm-1',
          SESSION_VOLUME_NAME: 'warm-warm-1',
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
        exists: false,
        container_name: 'worker-1',
        running: false,
      })
    )
    .mockResolvedValueOnce(
      buildWarmContainerInspection({
        container_name: 'warm-warm-1',
        container_labels: {
          ...buildWarmContainerInspection().container_labels,
          'underchat.warm_pool_id': 'warm-1',
          'underchat.session_volume_name': 'warm-warm-1',
        },
        container_env: {
          ...buildWarmContainerInspection().container_env,
          WARM_POOL_ID: 'warm-1',
          SESSION_VOLUME_NAME: 'warm-warm-1',
        },
      })
    )
    .mockResolvedValueOnce(buildActivatedWarmContainerInspection());
  deps.workerService.listContainerIdsMountingVolumeStrict.mockImplementation(
    async (volumeName: string) => {
      if (volumeName !== 'warm-warm-1') {
        return [];
      }
      const targetRemoved =
        deps.workerService.removeContainerWorkerById.mock.calls.some(
          ([containerId]: [string]) =>
            containerId === 'replacement-container-id'
        );
      return targetRemoved ? [] : ['replacement-container-id'];
    }
  );
};

const preparePostgresWarmActivation = (
  deps: ReturnType<typeof buildHandler>
): void => {
  const capabilityHash = createHash('sha256')
    .update(WARM_RUNTIME_CAPABILITY)
    .digest('hex');
  let renamed = false;
  let warmRecord: Record<string, unknown> = {
    warm_pool_id: 'warm-1',
    server_id: 'server-1',
    worker_type_id: EWorkerType.baileys,
    container_id: WARM_RUNTIME_CONTAINER_ID,
    container_name: 'warm-warm-1',
    session_storage: EWorkerSessionStorage.postgres,
    session_volume_name: null,
    runtime_generation: null,
    runtime_capability_hash: capabilityHash,
    session_writer_epoch: WARM_RUNTIME_WRITER_EPOCH,
    state: EWorkerWarmPoolState.reserved,
    reserved_by_worker_id: 'worker-1',
    reservation_expires_at: '2999-07-28T11:30:00.000Z',
  };
  deps.workerWarmPoolRepository.viewByIdConsistent.mockImplementation(
    async () => ({ ...warmRecord })
  );
  deps.workerWarmPoolRepository.beginActivation.mockImplementation(async () => {
    warmRecord = { ...warmRecord, state: EWorkerWarmPoolState.activating };
    return true;
  });
  deps.workerWarmPoolRepository.markAssigned.mockImplementation(
    async (input: Record<string, string>) => {
      warmRecord = {
        ...warmRecord,
        state: EWorkerWarmPoolState.assigned,
        container_id: input.assignedContainerId,
        container_name: input.assignedContainerName,
      };
      return true;
    }
  );
  deps.workerService.viewWorkerForMonitor.mockResolvedValue({
    worker_id: 'worker-1',
    account_id: 'account-1',
    server_id: 'server-1',
    worker_status_id: EWorkerStatus.disponible,
    worker_type_id: EWorkerType.baileys,
    session_storage: EWorkerSessionStorage.postgres,
    deleted_at: null,
    container_id: null,
    lifecycle_operation_id: null,
  });
  deps.workerService.inspectContainerWorkerByIdStrict.mockImplementation(
    async (target: string) => {
      if (target === 'worker-1' && !renamed) {
        return { exists: false, container_name: target };
      }
      if (
        target !== WARM_RUNTIME_CONTAINER_ID &&
        target !== 'warm-warm-1' &&
        target !== 'worker-1'
      ) {
        return { exists: false, container_name: target };
      }
      return buildPostgresWarmContainerInspection({
        container_id: WARM_RUNTIME_CONTAINER_ID,
        container_name: renamed ? 'worker-1' : 'warm-warm-1',
        container_labels: {
          ...buildPostgresWarmContainerInspection().container_labels,
          'underchat.warm_pool_id': 'warm-1',
        },
        container_env: {
          ...buildPostgresWarmContainerInspection().container_env,
          WARM_POOL_ID: 'warm-1',
        },
      });
    }
  );
  deps.workerService.renameContainer.mockImplementation(async () => {
    renamed = true;
  });
  deps.workerService.inspectRuntimeWriterIdentityByContainerIdStrict.mockResolvedValue(
    {
      runtimeCapability: WARM_RUNTIME_CAPABILITY,
      writerEpoch: WARM_RUNTIME_WRITER_EPOCH,
    }
  );
  deps.workerRuntimeRepository.viewByWorkerIdConsistent?.mockResolvedValue(
    null
  );
  deps.workerRuntimeRepository.reserveNextRuntimeGeneration?.mockResolvedValue(
    5
  );
  deps.workerRuntimeRepository.markRecreateBootstrapStarted?.mockImplementation(
    async (input: Record<string, unknown>) => {
      deps.workerRuntimeRepository.viewByWorkerIdConsistent?.mockResolvedValue({
        worker_id: input.worker_id,
        container_id: input.container_id,
        container_name: 'worker-1',
        session_storage: EWorkerSessionStorage.postgres,
        session_volume_name: null,
        runtime_generation: input.runtime_generation,
        connection_sequence: 0,
        recreate_bootstrap_operation_id: input.lifecycle_operation_id,
        recreate_bootstrap_runtime_generation: input.runtime_generation,
        recreate_bootstrap_container_id: input.container_id,
        recreate_bootstrap_started_at: '2026-08-08T00:00:00.000Z',
        recreate_retired_operation_id: null,
      });
      return true;
    }
  );
};

const prepareOnlineWarmActivationResume = (
  deps: ReturnType<typeof buildHandler>
): void => {
  deps.workerWarmPoolRepository.viewByIdConsistent.mockResolvedValue({
    warm_pool_id: 'warm-1',
    server_id: 'server-1',
    worker_type_id: EWorkerType.baileys,
    container_id: 'warm-container-id',
    container_name: 'warm-warm-1',
    session_volume_name: 'warm-warm-1',
    state: EWorkerWarmPoolState.activating,
    reserved_by_worker_id: 'worker-1',
    reservation_expires_at: null,
  });
  deps.workerService.viewWorkerForMonitor.mockResolvedValue({
    worker_id: 'worker-1',
    account_id: 'account-1',
    server_id: 'server-1',
    worker_status_id: EWorkerStatus.online,
    worker_type_id: EWorkerType.baileys,
    deleted_at: null,
    container_id: 'old-container-id',
    lifecycle_operation_id: 'operation-1',
  });
  deps.workerService.inspectContainerWorkerById.mockImplementation(
    async (containerId: string) =>
      containerId === 'worker-1' || containerId === 'replacement-container-id'
        ? buildActivatedWarmContainerInspection()
        : buildWorkerContainerInspection({
            exists: false,
            container_name: containerId,
            running: false,
          })
  );
};

const buildOnlineWarmActivationRuntimeRepository = () => {
  const runtimeRepository = buildSelfHealRuntimeRepository();
  const runtime: Record<string, unknown> = {
    worker_id: 'worker-1',
    container_id: 'replacement-container-id',
    container_name: 'worker-1',
    session_volume_name: 'warm-warm-1',
    runtime_generation: 5,
    connection_sequence: 0,
    warm_pool_id: 'warm-1',
    recreate_retired_operation_id: null,
  };
  (runtimeRepository.viewByWorkerIdConsistent as jest.Mock).mockImplementation(
    async () => ({ ...runtime })
  );
  runtimeRepository.markRecreateBootstrapStarted.mockImplementation(
    async (input: Record<string, unknown>) => {
      Object.assign(runtime, {
        recreate_bootstrap_operation_id: input.lifecycle_operation_id,
        recreate_bootstrap_runtime_generation: input.runtime_generation,
        recreate_bootstrap_container_id: input.container_id,
        recreate_bootstrap_started_at: '2026-08-08T00:00:00.000Z',
        recreate_retired_operation_id: null,
      });
      return true;
    }
  );
  return runtimeRepository;
};

const prepareAssignedLegacyWarmActivation = (
  deps: ReturnType<typeof buildHandler>,
  inspection: WorkerContainerInspection = buildLegacyRenamedWarmContainerInspection()
): void => {
  deps.workerWarmPoolRepository.viewByIdConsistent.mockResolvedValue({
    warm_pool_id: 'warm-1',
    server_id: 'server-1',
    worker_type_id: EWorkerType.baileys,
    container_id: 'warm-container-id',
    container_name: 'warm-warm-1',
    session_volume_name: 'warm-warm-1',
    state: EWorkerWarmPoolState.assigned,
    reserved_by_worker_id: 'worker-1',
    reservation_expires_at: null,
  });
  deps.workerService.viewWorkerForMonitor.mockResolvedValue({
    worker_id: 'worker-1',
    account_id: 'account-1',
    server_id: 'server-1',
    worker_status_id: EWorkerStatus.creating,
    worker_type_id: EWorkerType.baileys,
    deleted_at: null,
    container_id: 'warm-container-id',
    lifecycle_operation_id: 'operation-1',
  });
  deps.workerService.inspectContainerWorkerById.mockResolvedValue(inspection);
};

const buildAssignedLegacyWarmRuntimeRepository = () => {
  const runtimeRepository = buildSelfHealRuntimeRepository();
  (runtimeRepository.viewByWorkerIdConsistent as jest.Mock).mockResolvedValue({
    worker_id: 'worker-1',
    container_id: 'warm-container-id',
    container_name: 'worker-1',
    session_volume_name: 'warm-warm-1',
    runtime_generation: 5,
    connection_sequence: 0,
    warm_pool_id: 'warm-1',
  });
  return runtimeRepository;
};

type PreviousProviderWarmResetOverrides = {
  runtime?: Partial<{
    container_id: string | null;
    container_name: string;
    runtime_generation: number;
    session_volume_name: string;
    warm_pool_id: string | null;
  }>;
  staleContainerExists?: boolean;
  targetEnv?: Record<string, string>;
  targetLabels?: Record<string, string>;
  worker?: Partial<{
    account_id: string;
    container_id: string | null;
    deleted_at: string | null;
    lifecycle_operation_id: string | null;
    server_id: string;
    session_storage: EWorkerSessionStorage;
    worker_status_id: EWorkerStatus;
    worker_type_id: EWorkerType;
  }>;
};

const preparePreviousProviderWarmReset = (
  overrides: PreviousProviderWarmResetOverrides = {}
) => {
  const runtimeRepository = buildSelfHealRuntimeRepository();
  let runtime = {
    worker_id: 'worker-1',
    container_id: 'previous-runtime-container-id' as string | null,
    container_name: 'worker-1',
    session_volume_name: 'warm-previous-pool',
    runtime_generation: 8,
    connection_sequence: 0,
    warm_pool_id: 'previous-pool' as string | null,
    ...overrides.runtime,
  };
  (runtimeRepository.viewByWorkerIdConsistent as jest.Mock).mockImplementation(
    async () => ({ ...runtime })
  );
  (
    runtimeRepository.reserveNextRuntimeGeneration as jest.Mock
  ).mockImplementation(async (input: Record<string, unknown>) => {
    runtime = {
      ...runtime,
      ...input,
      container_id: null,
      runtime_generation: 9,
      connection_sequence: 0,
    };
    return 9;
  });
  (runtimeRepository.upsert as jest.Mock).mockImplementation(
    async (input: Record<string, unknown>) => {
      runtime = {
        ...runtime,
        ...input,
        connection_sequence: 0,
      };
      return { ...runtime };
    }
  );
  const deps = buildHandler({
    workerRuntimeRepository: runtimeRepository,
    runtimeHealthResponse: { runtime_generation: 9 },
  });
  deps.workerWarmPoolRepository.viewByIdConsistent.mockResolvedValue({
    warm_pool_id: 'warm-1',
    server_id: 'server-1',
    worker_type_id: EWorkerType.wwebjs,
    container_id: 'warm-source-container-id',
    container_name: 'warm-warm-1',
    session_volume_name: 'warm-warm-1',
    state: EWorkerWarmPoolState.activating,
    reserved_by_worker_id: 'worker-1',
    reservation_expires_at: null,
  });
  deps.workerService.viewWorkerForMonitor.mockResolvedValue({
    worker_id: 'worker-1',
    account_id: 'account-1',
    server_id: 'server-1',
    worker_status_id: EWorkerStatus.recreating,
    worker_type_id: EWorkerType.wwebjs,
    session_storage: EWorkerSessionStorage.legacy_volume,
    deleted_at: null,
    container_id: 'legacy-container-id',
    lifecycle_operation_id: 'operation-1',
    ...overrides.worker,
  });
  const previousTarget = buildWorkerContainerInspection({
    container_id: 'previous-runtime-container-id',
    container_name: 'worker-1',
    container_image: 'under-worker-whatsmeow:latest',
    container_labels: {
      'underchat.worker_id': 'worker-1',
      'underchat.account_id': 'account-1',
      'underchat.worker_type_id': EWorkerType.whatsmeow,
      'underchat.worker_image': 'under-worker-whatsmeow:latest',
      'underchat.worker_grpc_port': '50054',
      'underchat.session_volume_name': 'warm-previous-pool',
      'underchat.runtime_generation': '8',
      'underchat.warm_pool_id': 'previous-pool',
      'underchat.warm_standby': 'false',
      ...overrides.targetLabels,
    },
    container_env: {
      WORKER_ID: 'worker-1',
      ACCOUNT_ID: 'account-1',
      WORKER_TYPE_ID: EWorkerType.whatsmeow,
      WORKER_IMAGE: 'under-worker-whatsmeow:latest',
      WORKER_GRPC_PORT: '50054',
      SESSION_VOLUME_NAME: 'warm-previous-pool',
      RUNTIME_GENERATION: '8',
      WARM_POOL_ID: 'previous-pool',
      WARM_STANDBY: 'false',
      ...overrides.targetEnv,
    },
  });
  const activatedTarget = buildWorkerContainerInspection({
    container_id: 'replacement-container-id',
    container_name: 'worker-1',
    container_image: 'under-worker-wwebjs:latest',
    container_image_id: WORKER_IMAGE_CONTENT_ID,
    container_labels: {
      'underchat.worker_id': 'worker-1',
      'underchat.account_id': 'account-1',
      'underchat.server_id': 'server-1',
      'underchat.worker_type_id': EWorkerType.wwebjs,
      'underchat.worker_image': 'under-worker-wwebjs:latest',
      'underchat.worker_grpc_port': '50053',
      'underchat.session_volume_name': 'warm-warm-1',
      'underchat.runtime_generation': '9',
      'underchat.lifecycle_operation_id': 'operation-1',
      'underchat.warm_pool_id': 'warm-1',
      'underchat.warm_standby': 'false',
      'underchat.proxy_mode': 'direct',
      'underchat.proxy_fingerprint': workerProxyFingerprint(),
    },
    container_env: {
      WORKER_ID: 'worker-1',
      ACCOUNT_ID: 'account-1',
      WORKER_TYPE_ID: EWorkerType.wwebjs,
      WORKER_IMAGE: 'under-worker-wwebjs:latest',
      WORKER_GRPC_PORT: '50053',
      SESSION_VOLUME_NAME: 'warm-warm-1',
      RUNTIME_GENERATION: '9',
      WARM_POOL_ID: 'warm-1',
      WARM_STANDBY: 'false',
    },
  });
  let previousTargetExists = true;
  let sourceExists = true;
  let activatedTargetExists = false;
  deps.workerService.inspectContainerWorkerById.mockImplementation(
    async (containerId: string) => {
      if (
        previousTargetExists &&
        (containerId === 'worker-1' ||
          containerId === 'previous-runtime-container-id')
      ) {
        return previousTarget;
      }
      if (
        activatedTargetExists &&
        (containerId === 'worker-1' ||
          containerId === 'replacement-container-id')
      ) {
        return activatedTarget;
      }
      if (containerId === 'legacy-container-id') {
        return buildWorkerContainerInspection({
          exists: overrides.staleContainerExists === true,
          container_id: 'legacy-container-id',
          container_name: 'legacy-worker-container',
          running: overrides.staleContainerExists === true,
        });
      }
      if (
        sourceExists &&
        (containerId === 'warm-warm-1' ||
          containerId === 'warm-source-container-id')
      ) {
        return buildWorkerContainerInspection({
          container_id: 'warm-source-container-id',
          container_name: 'warm-warm-1',
          container_image: 'under-worker-wwebjs:latest',
          container_labels: {
            'underchat.warm_standby': 'true',
            'underchat.warm_pool_id': 'warm-1',
            'underchat.server_id': 'server-1',
            'underchat.worker_type_id': EWorkerType.wwebjs,
            'underchat.worker_image': 'under-worker-wwebjs:latest',
            'underchat.worker_grpc_port': '50053',
            'underchat.session_volume_name': 'warm-warm-1',
          },
          container_env: {
            WARM_STANDBY: 'true',
            WARM_POOL_ID: 'warm-1',
            WORKER_TYPE_ID: EWorkerType.wwebjs,
            WORKER_IMAGE: 'under-worker-wwebjs:latest',
            WORKER_GRPC_PORT: '50053',
            SESSION_VOLUME_NAME: 'warm-warm-1',
          },
        });
      }
      return buildWorkerContainerInspection({
        exists: false,
        container_name: containerId,
        running: false,
      });
    }
  );
  deps.workerService.removeContainerWorkerById.mockImplementation(
    async (containerId: string) => {
      if (containerId === 'previous-runtime-container-id') {
        previousTargetExists = false;
      }
      if (containerId === 'warm-source-container-id') {
        sourceExists = false;
      }
      return true;
    }
  );
  deps.workerService.createContainerWorker.mockImplementation(async () => {
    activatedTargetExists = true;
    return 'replacement-container-id';
  });
  return deps;
};

const activatePreviousProviderWarmReset = (
  deps: ReturnType<typeof preparePreviousProviderWarmReset>
) =>
  deps.handler.activateWarmWorker({
    warm_pool_id: 'warm-1',
    worker_id: 'worker-1',
    account_id: 'account-1',
    server_id: 'server-1',
    worker_type_id: EWorkerType.wwebjs,
    previous_worker_type_id: EWorkerType.whatsmeow,
    session_storage: EWorkerSessionStorage.legacy_volume,
    previous_worker_status_id: EWorkerStatus.online,
    remove_session: true,
    remove_volume: true,
    lifecycle_operation_id: 'operation-1',
  });

const expectNoPreviousProviderWarmResetMutation = (
  deps: ReturnType<typeof preparePreviousProviderWarmReset>
): void => {
  expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
  expect(deps.workerService.removeVolumeByName).not.toHaveBeenCalled();
  expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();
  expect(deps.workerWarmPoolRepository.markAssigned).not.toHaveBeenCalled();
  expect(
    deps.workerService.updateWorkerByIdIfLifecycleMatches
  ).not.toHaveBeenCalled();
  expect(
    deps.workerRuntimeRepository?.reserveNextRuntimeGeneration
  ).not.toHaveBeenCalled();
  expect(deps.workerRuntimeRepository?.upsert).not.toHaveBeenCalled();
};

const makeSelfHealWorkerOnline = (deps: ReturnType<typeof buildHandler>) => {
  deps.workerService.viewWorkerForMonitor.mockResolvedValue({
    worker_id: 'worker-1',
    name: 'Canal 1',
    account_id: 'account-1',
    server_id: 'server-1',
    worker_status_id: EWorkerStatus.online,
    worker_type_id: EWorkerType.wwebjs,
    created_at: null,
    updated_at: null,
    deleted_at: null,
    container_id: 'container-1',
    lifecycle_operation_id: null,
    last_connection_check_at: null,
  });
};

describe('WorkerCommandHandlerService session-storage transport fallback', () => {
  it('hydrates an omitted PostgreSQL backend through the public recreate handler', async () => {
    const runtimeContainerId = 'b'.repeat(64);
    const deps = buildHandler();
    const journal: IWorkerLifecycleQueueMessage = {
      request_id: 'request-1',
      operation_id: 'operation-1',
      action: 'recreate',
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      session_storage: EWorkerSessionStorage.postgres,
      source: 'worker_recreate',
      requested_at: '2026-08-01T22:00:00.000Z',
    };
    (
      deps.workerLifecycleQueueService.loadPrepared as jest.Mock
    ).mockResolvedValue([journal]);
    deps.workerService.viewWorkerForMonitor.mockResolvedValue({
      worker_id: 'worker-1',
      name: 'Canal PostgreSQL',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: EWorkerType.baileys,
      session_storage: EWorkerSessionStorage.postgres,
      runtime_container_id: runtimeContainerId,
      created_at: null,
      updated_at: null,
      deleted_at: null,
      container_id: runtimeContainerId,
      lifecycle_operation_id: 'operation-1',
      last_connection_check_at: null,
    });
    (
      deps.workerRuntimeRepository.viewByWorkerIdConsistent as jest.Mock
    ).mockResolvedValue({
      worker_id: 'worker-1',
      container_id: runtimeContainerId,
      container_name: 'worker-1',
      session_storage: EWorkerSessionStorage.postgres,
      session_volume_name: null,
      runtime_generation: 7,
      connection_sequence: 1,
    });
    const resolveRecreateExecutionContext = jest.fn(async () => null);
    Object.assign(deps.handler, { resolveRecreateExecutionContext });
    const payload: IWorkerPayload = {
      action: EWorkerAction.recreate,
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      lifecycle_operation_id: 'operation-1',
      lifecycle_semantic_fingerprint:
        workerLifecycleSemanticFingerprint(journal),
    };

    await deps.handler.handle(payload);

    expect(resolveRecreateExecutionContext).toHaveBeenCalledWith(
      expect.objectContaining({
        session_storage: EWorkerSessionStorage.postgres,
      }),
      expect.anything()
    );
    expect(payload.session_storage).toBe(EWorkerSessionStorage.postgres);
    expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();
    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
  });

  it('rejects an explicit backend mismatch through handle before Docker', async () => {
    const deps = buildHandler();
    deps.workerService.viewWorkerForMonitor.mockResolvedValue({
      worker_id: 'worker-1',
      name: 'Canal PostgreSQL',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: EWorkerType.baileys,
      session_storage: EWorkerSessionStorage.postgres,
      created_at: null,
      updated_at: null,
      deleted_at: null,
      container_id: null,
      lifecycle_operation_id: 'operation-1',
      last_connection_check_at: null,
    });
    const resolveRecreateExecutionContext = jest.fn(async () => null);
    Object.assign(deps.handler, { resolveRecreateExecutionContext });

    await expect(
      deps.handler.handle({
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        session_storage: EWorkerSessionStorage.legacy_volume,
        lifecycle_operation_id: 'operation-1',
      })
    ).rejects.toThrow('worker_session_storage_authoritative_fence_changed');

    expect(resolveRecreateExecutionContext).not.toHaveBeenCalled();
    expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();
    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
  });

  it.each([
    [EWorkerAction.create, EWorkerStatus.creating],
    [EWorkerAction.cleanup, EWorkerStatus.recreating],
    [EWorkerAction.delete, EWorkerStatus.deleting],
  ] as const)(
    'rejects an explicit backend mismatch in the public %s handler before Docker',
    async (action, workerStatus) => {
      const deps = buildHandler();
      (
        deps.workerRuntimeRepository.viewByWorkerIdConsistent as jest.Mock
      ).mockResolvedValue(null);
      deps.workerService.viewWorkerForMonitor.mockResolvedValue({
        worker_id: 'worker-1',
        name: 'Canal PostgreSQL',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_status_id: workerStatus,
        worker_type_id: EWorkerType.baileys,
        session_storage: EWorkerSessionStorage.postgres,
        created_at: null,
        updated_at: null,
        deleted_at: null,
        container_id: null,
        lifecycle_operation_id: null,
        last_connection_check_at: null,
      });

      await expect(
        deps.handler.handle({
          action,
          worker_id: 'worker-1',
          account_id: 'account-1',
          server_id: 'server-1',
          worker_type_id: EWorkerType.baileys,
          session_storage: EWorkerSessionStorage.legacy_volume,
        })
      ).rejects.toThrow('worker_session_storage_authoritative_fence_changed');

      expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();
      expect(
        deps.workerService.removeContainerWorkerById
      ).not.toHaveBeenCalled();
      expect(deps.workerService.cleanupContainerWorker).not.toHaveBeenCalled();
    }
  );

  it('closes a completed provider handoff lifecycle on the exact online target without recreating it', async () => {
    const deps = buildHandler();
    const terminalProof = (
      deps.workerRuntimeRepository as unknown as {
        viewWhatsappProviderHandoffTerminalLifecycleProof: jest.Mock;
      }
    ).viewWhatsappProviderHandoffTerminalLifecycleProof;
    terminalProof.mockResolvedValue({
      handoff_id: 'handoff-1',
      lifecycle_operation_id: 'operation-1',
      handoff_state: 'completed',
      error_code: null,
      source_provider: 'baileys',
      target_provider: 'wwebjs',
      recovery_state: 'none',
      recovery_operation_id: null,
      resolution_state: null,
      resolution_operation_id: null,
      point_of_no_return_at: '2026-08-12T03:53:58.910Z',
      worker_type_id: EWorkerType.wwebjs,
      worker_status_id: EWorkerStatus.online,
      terminal_ownership_unique: true,
    });
    const containerId = 'a'.repeat(64);
    let currentWorker = {
      worker_id: 'worker-1',
      name: 'Canal 1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.online,
      worker_type_id: EWorkerType.wwebjs,
      session_storage: EWorkerSessionStorage.postgres,
      created_at: null,
      updated_at: null,
      deleted_at: null,
      container_id: containerId,
      runtime_container_id: containerId,
      runtime_generation: 19,
      recreate_bootstrap_operation_id: 'operation-1',
      recreate_bootstrap_runtime_generation: 19,
      recreate_bootstrap_container_id: containerId,
      recreate_bootstrap_started_at: '2026-08-12T02:23:03.327Z',
      recreate_retired_operation_id: null,
      recreate_retired_runtime_generation: null,
      recreate_retired_container_id: null,
      recreate_retired_at: null,
      lifecycle_operation_id: 'operation-1',
      last_connection_check_at: null,
    };
    deps.workerService.viewWorkerForMonitorConsistent.mockImplementation(
      async () => ({ ...currentWorker })
    );
    deps.workerService.updateWorkerByIdIfLifecycleMatches.mockImplementation(
      async (_accountId, update, guard) => {
        const completion = (
          guard as {
            recreate_completion?: {
              operation_id: string;
              runtime_generation: number;
            };
          }
        ).recreate_completion;
        currentWorker = {
          ...currentWorker,
          ...(update as Partial<typeof currentWorker>),
          recreate_completed_operation_id: completion?.operation_id,
          recreate_completed_runtime_generation: completion?.runtime_generation,
          recreate_completed_at: '2026-08-12T04:14:52.724Z',
        } as typeof currentWorker;
        return true;
      }
    );

    await expect(
      handleWorkerCommand(deps, {
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: EWorkerType.wwebjs,
        previous_worker_type_id: EWorkerType.baileys,
        session_storage: EWorkerSessionStorage.postgres,
        remove_session: false,
        remove_volume: false,
        lifecycle_operation_id: 'operation-1',
      })
    ).resolves.toBeUndefined();

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        lifecycle_operation_id: null,
        worker_status_id: EWorkerStatus.online,
      }),
      expect.objectContaining({
        lifecycle_operation_id: 'operation-1',
        container_id: containerId,
        runtime_container_id: containerId,
        runtime_generation: 19,
        recreate_completion: {
          operation_id: 'operation-1',
          runtime_generation: 19,
          mode: 'replacement_runtime_already_online',
        },
      })
    );
    expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();
    expect(
      deps.workerService.stopContainerWorkerByIdGracefully
    ).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publishSubStrict).toHaveBeenCalled();
  });

  it('hydrates a missing protobuf field from the authoritative worker row', async () => {
    const deps = buildHandler();
    (
      deps.workerRuntimeRepository.viewByWorkerIdConsistent as jest.Mock
    ).mockResolvedValue(null);
    deps.workerService.viewWorkerForMonitor.mockResolvedValue({
      worker_id: 'worker-1',
      name: 'Canal PostgreSQL',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: EWorkerType.baileys,
      session_storage: EWorkerSessionStorage.postgres,
      created_at: null,
      updated_at: null,
      deleted_at: null,
      container_id: 'container-1',
      lifecycle_operation_id: 'operation-1',
      last_connection_check_at: null,
    });
    const payload: IWorkerPayload = {
      action: EWorkerAction.recreate,
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      lifecycle_operation_id: 'operation-1',
    };

    await (
      deps.handler as unknown as {
        hydrateAuthoritativeSessionStorageIfMissing: (
          data: IWorkerPayload
        ) => Promise<void>;
      }
    ).hydrateAuthoritativeSessionStorageIfMissing(payload);

    expect(payload.session_storage).toBe(EWorkerSessionStorage.postgres);
    expect(
      deps.workerService.viewWorkerForMonitorConsistent
    ).toHaveBeenCalledWith('worker-1');
  });

  it('fails closed when the authoritative row does not belong to the command account', async () => {
    const deps = buildHandler();
    deps.workerService.viewWorkerForMonitor.mockResolvedValue({
      worker_id: 'worker-1',
      account_id: 'different-account',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: EWorkerType.baileys,
      session_storage: EWorkerSessionStorage.postgres,
      deleted_at: null,
    });
    const payload: IWorkerPayload = {
      action: EWorkerAction.recreate,
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      lifecycle_operation_id: 'operation-1',
    };

    await expect(
      (
        deps.handler as unknown as {
          hydrateAuthoritativeSessionStorageIfMissing: (
            data: IWorkerPayload
          ) => Promise<void>;
        }
      ).hydrateAuthoritativeSessionStorageIfMissing(payload)
    ).rejects.toThrow('worker_session_storage_authoritative_fence_changed');

    expect(payload.session_storage).toBeUndefined();
  });

  it('fails closed when a supplied backend disagrees with the worker row', async () => {
    const deps = buildHandler();
    deps.workerService.viewWorkerForMonitor.mockResolvedValue({
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.creating,
      worker_type_id: EWorkerType.baileys,
      session_storage: EWorkerSessionStorage.postgres,
      deleted_at: null,
    });
    const payload: IWorkerPayload = {
      action: EWorkerAction.create,
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      session_storage: EWorkerSessionStorage.legacy_volume,
    };

    await expect(
      (
        deps.handler as unknown as {
          hydrateAuthoritativeSessionStorageIfMissing: (
            data: IWorkerPayload
          ) => Promise<void>;
        }
      ).hydrateAuthoritativeSessionStorageIfMissing(payload)
    ).rejects.toThrow('worker_session_storage_authoritative_fence_changed');
  });

  it('fails closed when the worker and current runtime backends diverge', async () => {
    const deps = buildHandler();
    const runtimeContainerId = 'a'.repeat(64);
    deps.workerService.viewWorkerForMonitor.mockResolvedValue({
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: EWorkerType.baileys,
      session_storage: EWorkerSessionStorage.postgres,
      runtime_container_id: runtimeContainerId,
      deleted_at: null,
    });
    (
      deps.workerRuntimeRepository.viewByWorkerIdConsistent as jest.Mock
    ).mockResolvedValue({
      worker_id: 'worker-1',
      container_id: runtimeContainerId,
      container_name: 'worker-1',
      session_storage: EWorkerSessionStorage.legacy_volume,
      session_volume_name: 'worker-1',
      runtime_generation: 7,
      connection_sequence: 1,
    });
    const payload: IWorkerPayload = {
      action: EWorkerAction.recreate,
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      session_storage: EWorkerSessionStorage.postgres,
      lifecycle_operation_id: 'operation-1',
    };

    await expect(
      (
        deps.handler as unknown as {
          hydrateAuthoritativeSessionStorageIfMissing: (
            data: IWorkerPayload
          ) => Promise<void>;
        }
      ).hydrateAuthoritativeSessionStorageIfMissing(payload)
    ).rejects.toThrow('worker_session_storage_authoritative_fence_changed');
  });
});

describe('WorkerCommandHandlerService lifecycle journal authority', () => {
  const buildLifecycleMessage = (
    overrides: Partial<IWorkerLifecycleQueueMessage> = {}
  ): IWorkerLifecycleQueueMessage => ({
    request_id: 'request-1',
    operation_id: 'operation-1',
    action: 'create',
    worker_id: 'worker-1',
    account_id: 'account-1',
    server_id: 'server-1',
    worker_type_id: EWorkerType.wwebjs,
    worker_status_id: EWorkerStatus.creating,
    source: 'worker_create',
    requested_at: '2026-07-30T00:00:00.000Z',
    ...overrides,
  });

  it('rejects a stale cold command after the authoritative journal upgrades to warm', async () => {
    const staleCold = buildLifecycleMessage();
    const authoritativeWarm = buildLifecycleMessage({
      request_id: 'request-warm',
      action: 'activate_warm',
      warm_pool_id: 'warm-pool-1',
    });
    const loadPrepared = jest.fn(async () => [authoritativeWarm]);
    const deps = buildHandler({
      workerLifecycleQueueService: {
        publish: jest.fn(async () => undefined),
        prepare: jest.fn(async () => undefined),
        loadPrepared,
        loadPermanentDeletionProof: jest.fn(async () => null),
      },
    });

    await expect(
      handleWorkerCommand(deps, {
        action: EWorkerAction.create,
        worker_id: staleCold.worker_id,
        server_id: staleCold.server_id,
        account_id: staleCold.account_id,
        worker_status_id: staleCold.worker_status_id,
        worker_type_id: staleCold.worker_type_id,
        lifecycle_operation_id: staleCold.operation_id,
        lifecycle_semantic_fingerprint:
          workerLifecycleSemanticFingerprint(staleCold),
      })
    ).rejects.toThrow(
      'worker_lifecycle_semantic_fingerprint_stale:operation-1'
    );

    expect(loadPrepared).toHaveBeenCalledWith('worker-1', 'operation-1');
    expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();
  });

  it('rejects cleanup when the authoritative cleanup flags no longer match', async () => {
    const staleCleanup = buildLifecycleMessage({
      action: 'cleanup_previous_runtime',
      source: 'worker_update',
      server_id: 'server-old',
      remove_session: false,
      remove_volume: false,
    });
    const authoritativeCleanup = {
      ...staleCleanup,
      request_id: 'request-cleanup-authoritative',
      remove_session: true,
      remove_volume: true,
    };
    const loadPrepared = jest.fn(async () => [authoritativeCleanup]);
    const deps = buildHandler({
      workerLifecycleQueueService: {
        publish: jest.fn(async () => undefined),
        prepare: jest.fn(async () => undefined),
        loadPrepared,
        loadPermanentDeletionProof: jest.fn(async () => null),
      },
    });

    await expect(
      handleWorkerCommand(deps, {
        action: EWorkerAction.cleanup,
        worker_id: staleCleanup.worker_id,
        server_id: staleCleanup.server_id,
        account_id: staleCleanup.account_id,
        worker_status_id: staleCleanup.worker_status_id,
        worker_type_id: staleCleanup.worker_type_id,
        remove_session: staleCleanup.remove_session,
        remove_volume: staleCleanup.remove_volume,
        lifecycle_operation_id: staleCleanup.operation_id,
        lifecycle_semantic_fingerprint:
          workerLifecycleSemanticFingerprint(staleCleanup),
      })
    ).rejects.toThrow(
      'worker_lifecycle_semantic_fingerprint_stale:operation-1'
    );

    expect(loadPrepared).toHaveBeenCalledWith('worker-1', 'operation-1');
    expect(deps.workerService.cleanupContainerWorker).not.toHaveBeenCalled();
  });
});

describe('WorkerCommandHandlerService warm standby readiness', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('routes an Activity warm RuntimeHealth probe to the exact persisted standby hostname', async () => {
    const deps = buildHandler({
      runtimeHealthResponse: buildWarmStandbyRuntimeHealth({
        worker_type_id: EWorkerType.whatsmeow,
      }),
    });
    deps.workerWarmPoolRepository.viewByIdConsistent.mockResolvedValue(
      buildReadyWarmRuntimeHealthEntry()
    );

    await deps.handler.runtimeHealth({
      warm_pool_id: 'warm-pool-1',
      worker_type_id: EWorkerType.whatsmeow,
      server_id: 'server-1',
    });

    expect(
      deps.workerWarmPoolRepository.viewByIdConsistent
    ).toHaveBeenCalledWith('warm-pool-1');
    expect(
      deps.workerBaileysGrpcClientService.runtimeHealth
    ).toHaveBeenCalledWith(
      'warm-warm-pool-1',
      {
        worker_id: undefined,
        warm_pool_id: 'warm-pool-1',
      },
      EWorkerType.whatsmeow
    );
  });

  it.each([
    {
      label: 'does not exist',
      entry: null,
      request: {},
      reason: 'not_found',
    },
    {
      label: 'is not ready',
      entry: buildReadyWarmRuntimeHealthEntry({
        state: EWorkerWarmPoolState.reserved,
      }),
      request: {},
      reason: 'state_not_ready',
    },
    {
      label: 'belongs to another server',
      entry: buildReadyWarmRuntimeHealthEntry(),
      request: { server_id: 'server-2' },
      reason: 'server_id_mismatch',
    },
    {
      label: 'belongs to another provider',
      entry: buildReadyWarmRuntimeHealthEntry(),
      request: { worker_type_id: EWorkerType.baileys },
      reason: 'worker_type_id_mismatch',
    },
    {
      label: 'has a legacy non-canonical container name',
      entry: buildReadyWarmRuntimeHealthEntry({
        container_name: 'warm-pool-1',
      }),
      request: {},
      reason: 'container_name_mismatch',
    },
  ])(
    'rejects before dialing when the warm RuntimeHealth row $label',
    async ({ entry, request, reason }) => {
      const deps = buildHandler();
      deps.workerWarmPoolRepository.viewByIdConsistent.mockResolvedValue(entry);

      await expect(
        deps.handler.runtimeHealth({
          warm_pool_id: 'warm-pool-1',
          worker_type_id: EWorkerType.whatsmeow,
          server_id: 'server-1',
          ...request,
        })
      ).rejects.toThrow(`warm_runtime_health_identity_rejected:${reason}`);
      expect(
        deps.workerBaileysGrpcClientService.runtimeHealth
      ).not.toHaveBeenCalled();
    }
  );

  it('requires server and provider identity for a warm RuntimeHealth probe', async () => {
    const deps = buildHandler();

    await expect(
      deps.handler.runtimeHealth({
        warm_pool_id: 'warm-pool-1',
        worker_type_id: EWorkerType.whatsmeow,
      })
    ).rejects.toThrow(
      'Missing required fields for warm RuntimeHealth: worker_type_id, server_id'
    );
    expect(
      deps.workerWarmPoolRepository.viewByIdConsistent
    ).not.toHaveBeenCalled();
    expect(
      deps.workerBaileysGrpcClientService.runtimeHealth
    ).not.toHaveBeenCalled();
  });

  it('rejects an unknown warm RuntimeHealth provider before dialing', async () => {
    const deps = buildHandler();

    await expect(
      deps.handler.runtimeHealth({
        warm_pool_id: 'warm-pool-1',
        worker_type_id: 'unknown-provider',
      })
    ).rejects.toThrow('Invalid worker_type_id');
    expect(
      deps.workerBaileysGrpcClientService.runtimeHealth
    ).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'Baileys',
      workerType: EWorkerType.baileys,
      workerId: '',
      accountId: '',
    },
    {
      label: 'WWebJS',
      workerType: EWorkerType.wwebjs,
      workerId: '',
      accountId: '',
    },
    {
      label: 'Whatsmeow',
      workerType: EWorkerType.whatsmeow,
      workerId: 'warm-pool-1',
      accountId: 'warm-standby',
    },
  ])(
    'marks a healthy $label standby ready after process health without requiring provider session, QR or Kafka consumers',
    async ({ workerType, workerId, accountId }) => {
      const runtimeHealthResponse = buildWarmStandbyRuntimeHealth({
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: workerType,
      });
      const deps = buildHandler({ runtimeHealthResponse });

      await expect(
        deps.handler.createWarmWorker({
          warm_pool_id: 'warm-pool-1',
          server_id: 'server-1',
          worker_type_id: workerType,
        })
      ).resolves.toEqual({
        warm_pool_id: 'warm-pool-1',
        container_id: 'warm-container-id',
        container_name: 'warm-warm-pool-1',
        session_volume_name: '',
      });

      expect(
        deps.containerHealthService.checkServiceHealth
      ).toHaveBeenCalledWith(
        'warm-container-id',
        expect.objectContaining({
          maxAttempts: 30,
          requiredConsecutiveSuccesses: 3,
          failFastAfterFirstSuccessFailures: 3,
        })
      );
      expect(
        deps.workerBaileysGrpcClientService.waitForReady
      ).toHaveBeenCalledWith('warm-warm-pool-1', workerType, 30_000);
      expect(
        deps.workerBaileysGrpcClientService.runtimeHealth
      ).toHaveBeenCalledWith(
        'warm-warm-pool-1',
        { warm_pool_id: 'warm-pool-1' },
        workerType
      );
      expect(
        deps.workerWarmPoolRepository.finalizePostgresCreationReady
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          warmPoolId: 'warm-pool-1',
          serverId: 'server-1',
          workerTypeId: workerType,
          containerId: 'warm-container-id',
          containerName: 'warm-warm-pool-1',
          runtimeCapabilityHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
          writerEpoch: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
          ),
        })
      );
    }
  );

  it('never creates a standby when immutable image resolution cannot be fenced', async () => {
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(),
    });
    deps.workerService.inspectImageContentId.mockResolvedValue(
      `sha256:${'d'.repeat(64)}`
    );
    deps.workerService.inspectContainerWorkerByIdStrict
      .mockResolvedValueOnce({
        exists: false,
        container_name: 'warm-warm-pool-1',
      })
      .mockResolvedValue(buildPostgresWarmContainerInspection());

    await expect(
      deps.handler.createWarmWorker({
        warm_pool_id: 'warm-pool-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
      })
    ).rejects.toThrow('worker_expected_image_changed_during_content_fence');

    expect(
      deps.workerWarmPoolRepository.finalizePostgresCreationReady
    ).not.toHaveBeenCalled();
    expect(deps.workerService.createWarmContainerWorker).not.toHaveBeenCalled();
    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
  });

  it('fails creation closed when latest changes during standby readiness', async () => {
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(),
      runtimeHealthResponse: buildWarmStandbyRuntimeHealth(),
    });
    mockHandlerSleep(deps.handler);
    deps.workerService.inspectImageContentId
      .mockResolvedValueOnce(WORKER_IMAGE_CONTENT_ID)
      .mockResolvedValueOnce(WORKER_IMAGE_CONTENT_ID)
      .mockResolvedValueOnce(WORKER_IMAGE_CONTENT_ID)
      .mockResolvedValueOnce(`sha256:${'e'.repeat(64)}`);

    await expect(
      deps.handler.createWarmWorker({
        warm_pool_id: 'warm-pool-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
      })
    ).rejects.toThrow('warm_worker_expected_image_changed_during_readiness');

    expect(
      deps.workerWarmPoolRepository.finalizePostgresCreationReady
    ).not.toHaveBeenCalled();
    expect(deps.workerService.removeContainerWorkerById).toHaveBeenCalledWith(
      'warm-container-id'
    );
  });

  it('cleans an exactly owned PostgreSQL warm runtime when the image injects an unexpected mount', async () => {
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(),
    });
    const mountedRuntime = buildPostgresWarmContainerInspection({
      container_mounts: [
        {
          destination: '/app/data',
          name: 'a'.repeat(64),
          read_write: true,
          type: 'volume',
        },
      ],
    });
    deps.workerService.inspectContainerWorkerByIdStrict
      .mockResolvedValueOnce({
        exists: false,
        container_name: 'warm-warm-pool-1',
      })
      .mockResolvedValue(mountedRuntime);

    await expect(
      deps.handler.createWarmWorker({
        warm_pool_id: 'warm-pool-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
      })
    ).rejects.toThrow('postgres_warm_worker_runtime_identity_mismatch');

    expect(
      deps.workerService.removePostgresWarmContainerWithAnonymousVolumesById
    ).toHaveBeenCalledWith('warm-container-id');
    expect(deps.workerService.removeVolumeByName).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.recordPostgresCreationError
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        warmPoolId: 'warm-pool-1',
        error: 'postgres_warm_worker_runtime_identity_mismatch',
      })
    );
  });

  it('returns an already-ready coherent warm runtime without creating or removing Docker artifacts', async () => {
    const inspection = buildPostgresWarmContainerInspection();
    const deps = buildHandler({
      workerInspection: inspection,
      runtimeHealthResponse: buildWarmStandbyRuntimeHealth(),
    });
    deps.workerWarmPoolRepository.viewByIdConsistent.mockResolvedValue({
      warm_pool_id: 'warm-pool-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      container_id: inspection.container_id,
      container_name: inspection.container_name,
      session_storage: EWorkerSessionStorage.postgres,
      session_volume_name: null,
      runtime_capability_hash: 'a'.repeat(64),
      session_writer_epoch: WARM_RUNTIME_WRITER_EPOCH,
      state: EWorkerWarmPoolState.ready,
    });

    await expect(
      deps.handler.createWarmWorker({
        warm_pool_id: 'warm-pool-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
      })
    ).resolves.toEqual({
      warm_pool_id: 'warm-pool-1',
      container_id: 'warm-container-id',
      container_name: 'warm-warm-pool-1',
      session_volume_name: '',
    });

    expect(deps.workerWarmPoolRepository.create).not.toHaveBeenCalled();
    expect(deps.workerService.createWarmContainerWorker).not.toHaveBeenCalled();
    expect(
      deps.workerService.removeContainerByNameAndVolume
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.finalizePostgresCreationReady
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.recordPostgresCreationError
    ).not.toHaveBeenCalled();
    expect(deps.workerLifecycleLockService.withLock).toHaveBeenCalledWith(
      'warm-pool:warm-pool-1',
      'create_warm_worker',
      expect.any(Function),
      expect.objectContaining({
        heartbeatIntervalMs: 15_000,
        ttlMs: 75_000,
      })
    );
  });

  it('adopts a coherent warming container instead of replacing it', async () => {
    const deps = buildHandler({
      workerInspection: buildPostgresWarmContainerInspection(),
      runtimeHealthResponse: buildWarmStandbyRuntimeHealth(),
    });
    deps.workerWarmPoolRepository.viewByIdConsistent.mockResolvedValueOnce({
      warm_pool_id: 'warm-pool-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      container_id: null,
      container_name: null,
      session_storage: EWorkerSessionStorage.postgres,
      session_volume_name: null,
      state: EWorkerWarmPoolState.warming,
    });

    await expect(
      deps.handler.createWarmWorker({
        warm_pool_id: 'warm-pool-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
      })
    ).resolves.toEqual(
      expect.objectContaining({
        warm_pool_id: 'warm-pool-1',
        container_id: 'warm-container-id',
      })
    );

    expect(deps.workerService.createWarmContainerWorker).not.toHaveBeenCalled();
    expect(
      deps.workerService.removeContainerByNameAndVolume
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.finalizePostgresCreationReady
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        warmPoolId: 'warm-pool-1',
        serverId: 'server-1',
        workerTypeId: EWorkerType.baileys,
        containerId: 'warm-container-id',
        containerName: 'warm-warm-pool-1',
        runtimeCapabilityHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
        writerEpoch: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
        ),
      })
    );
  });

  it.each([
    EWorkerWarmPoolState.reserved,
    EWorkerWarmPoolState.assigned,
    EWorkerWarmPoolState.deleting,
  ])(
    'rejects duplicate creation in %s state without pretending a warm runtime response',
    async (state) => {
      const deps = buildHandler();
      deps.workerWarmPoolRepository.viewByIdConsistent.mockResolvedValueOnce({
        warm_pool_id: 'warm-pool-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        container_id: 'warm-container-id',
        container_name: 'warm-warm-pool-1',
        session_storage: EWorkerSessionStorage.postgres,
        session_volume_name: null,
        state,
      });

      await expect(
        deps.handler.createWarmWorker({
          warm_pool_id: 'warm-pool-1',
          server_id: 'server-1',
          worker_type_id: EWorkerType.baileys,
        })
      ).rejects.toThrow(`warm_worker_creation_state_conflict:${state}`);

      expect(
        deps.workerService.inspectContainerWorkerByIdStrict
      ).not.toHaveBeenCalled();
      expect(
        deps.workerService.createWarmContainerWorker
      ).not.toHaveBeenCalled();
      expect(
        deps.workerService.removeContainerByNameAndVolume
      ).not.toHaveBeenCalled();
    }
  );

  it('never removes an existing container whose warm ownership is uncertain', async () => {
    const deps = buildHandler({
      workerInspection: buildPostgresWarmContainerInspection({
        container_labels: {
          ...buildPostgresWarmContainerInspection().container_labels,
          'underchat.warm_pool_id': 'another-warm-pool',
        },
        container_env: {
          ...buildPostgresWarmContainerInspection().container_env,
          WARM_POOL_ID: 'another-warm-pool',
        },
      }),
    });
    deps.workerWarmPoolRepository.viewByIdConsistent.mockResolvedValueOnce({
      warm_pool_id: 'warm-pool-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      container_id: null,
      container_name: null,
      session_storage: EWorkerSessionStorage.postgres,
      session_volume_name: null,
      state: EWorkerWarmPoolState.warming,
    });

    await expect(
      deps.handler.createWarmWorker({
        warm_pool_id: 'warm-pool-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
      })
    ).rejects.toThrow('postgres_warm_worker_runtime_identity_mismatch');

    expect(
      deps.workerService.removeContainerByNameAndVolume
    ).not.toHaveBeenCalled();
    expect(
      deps.workerService.removePostgresWarmContainerWithAnonymousVolumesById
    ).not.toHaveBeenCalled();
    expect(deps.workerService.createWarmContainerWorker).not.toHaveBeenCalled();
  });

  it('removes and recreates only a stale container proven to belong to the same warm claim', async () => {
    const runtimeRepository = buildSelfHealRuntimeRepository();
    const deps = buildHandler({
      workerRuntimeRepository: runtimeRepository,
      workerInspection: buildPostgresWarmContainerInspection({
        running: false,
        container_state: 'exited',
      }),
      runtimeHealthResponse: buildWarmStandbyRuntimeHealth(),
    });
    deps.workerWarmPoolRepository.viewByIdConsistent.mockResolvedValue({
      warm_pool_id: 'warm-pool-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      container_id: null,
      container_name: null,
      session_storage: EWorkerSessionStorage.postgres,
      session_volume_name: null,
      state: EWorkerWarmPoolState.warming,
    });

    await expect(
      deps.handler.createWarmWorker({
        warm_pool_id: 'warm-pool-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
      })
    ).resolves.toEqual(
      expect.objectContaining({
        warm_pool_id: 'warm-pool-1',
        container_id: 'warm-container-id',
      })
    );

    expect(
      runtimeRepository.isSessionVolumeReferencedConsistent
    ).not.toHaveBeenCalled();
    expect(deps.workerService.removeContainerWorkerById).toHaveBeenCalledWith(
      'warm-container-id'
    );
    expect(deps.workerService.removeVolumeByName).not.toHaveBeenCalled();
    expect(deps.workerService.createWarmContainerWorker).toHaveBeenCalledTimes(
      1
    );
  });

  it('does not mutate Docker when strict inspection is uncertain', async () => {
    const deps = buildHandler();
    deps.workerWarmPoolRepository.viewByIdConsistent.mockResolvedValueOnce({
      warm_pool_id: 'warm-pool-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      container_id: null,
      container_name: null,
      session_storage: EWorkerSessionStorage.postgres,
      session_volume_name: null,
      state: EWorkerWarmPoolState.warming,
    });
    deps.workerService.inspectContainerWorkerByIdStrict.mockRejectedValueOnce(
      new Error('docker daemon unavailable')
    );

    await expect(
      deps.handler.createWarmWorker({
        warm_pool_id: 'warm-pool-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
      })
    ).rejects.toThrow('docker daemon unavailable');

    expect(
      deps.workerService.removeContainerByNameAndVolume
    ).not.toHaveBeenCalled();
    expect(deps.workerService.createWarmContainerWorker).not.toHaveBeenCalled();
  });

  it('leaves an unhealthy ready row for reconciliation without deleting or rewriting it', async () => {
    const deps = buildHandler({
      workerInspection: buildPostgresWarmContainerInspection(),
      containerHealthResult: buildContainerHealthResult({
        healthy: false,
        health_failure_reason: 'temporary_probe_failure',
      }),
    });
    deps.workerWarmPoolRepository.viewByIdConsistent.mockResolvedValue({
      warm_pool_id: 'warm-pool-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      container_id: 'warm-container-id',
      container_name: 'warm-warm-pool-1',
      session_storage: EWorkerSessionStorage.postgres,
      session_volume_name: null,
      state: EWorkerWarmPoolState.ready,
    });

    await expect(
      deps.handler.createWarmWorker({
        warm_pool_id: 'warm-pool-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
      })
    ).rejects.toThrow(
      'warm_worker_http_health_not_ready:temporary_probe_failure'
    );

    expect(
      deps.workerWarmPoolRepository.finalizePostgresCreationReady
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.recordPostgresCreationError
    ).not.toHaveBeenCalled();
    expect(
      deps.workerService.removeContainerByNameAndVolume
    ).not.toHaveBeenCalled();
    expect(deps.workerService.createWarmContainerWorker).not.toHaveBeenCalled();
  });

  it('never compensates a warm runtime after losing the distributed lease', async () => {
    let leaseActive = true;
    const deps = buildHandler({
      workerInspection: buildPostgresWarmContainerInspection(),
      runtimeHealthResponse: buildWarmStandbyRuntimeHealth(),
    });
    deps.workerWarmPoolRepository.viewByIdConsistent.mockResolvedValue({
      warm_pool_id: 'warm-pool-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      container_id: null,
      container_name: null,
      session_storage: EWorkerSessionStorage.postgres,
      session_volume_name: null,
      state: EWorkerWarmPoolState.warming,
    });
    deps.containerHealthService.checkServiceHealth.mockImplementation(
      async () => {
        leaseActive = false;
        return buildContainerHealthResult();
      }
    );
    deps.workerLifecycleLockService.withLock.mockImplementation(
      async (
        _workerId: string,
        _operation: string,
        callback: (context: {
          signal: AbortSignal;
          assertActive: () => void;
        }) => Promise<unknown>
      ) =>
        callback({
          signal: new AbortController().signal,
          assertActive: () => {
            if (!leaseActive) {
              throw new Error('warm lease lost');
            }
          },
        })
    );

    await expect(
      deps.handler.createWarmWorker({
        warm_pool_id: 'warm-pool-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
      })
    ).rejects.toThrow('warm lease lost');

    expect(
      deps.workerWarmPoolRepository.finalizePostgresCreationReady
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.recordPostgresCreationError
    ).not.toHaveBeenCalled();
    expect(
      deps.workerService.removeContainerByNameAndVolume
    ).not.toHaveBeenCalled();
    expect(deps.workerService.createWarmContainerWorker).not.toHaveBeenCalled();
  });

  it('reacquires only after the stale creation lease unwinds and adopts the exact healthy runtime', async () => {
    let firstLeaseActive = true;
    let firstLeaseCallbackRunning = false;
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(),
      runtimeHealthResponse: buildWarmStandbyRuntimeHealth(),
    });
    const createWarmRuntime =
      deps.workerService.createWarmContainerWorker.getMockImplementation();
    if (!createWarmRuntime) {
      throw new Error('createWarmContainerWorker mock is unavailable');
    }
    deps.workerService.createWarmContainerWorker.mockImplementation(
      async (input) => {
        const runtime = await createWarmRuntime(input);
        firstLeaseActive = false;
        return runtime;
      }
    );
    deps.workerLifecycleLockService.withLock.mockImplementation(
      async (
        _workerId: string,
        operation: string,
        callback: (context: {
          signal: AbortSignal;
          assertActive: () => void;
        }) => Promise<unknown>
      ) => {
        if (operation === 'create_warm_worker') {
          firstLeaseCallbackRunning = true;
          try {
            return await callback({
              signal: new AbortController().signal,
              assertActive: () => {
                if (!firstLeaseActive) {
                  throw new Error('warm lease lost after docker create');
                }
              },
            });
          } finally {
            firstLeaseCallbackRunning = false;
          }
        }

        expect(operation).toBe('recover_lost_create_warm_worker');
        expect(firstLeaseCallbackRunning).toBe(false);
        return callback({
          signal: new AbortController().signal,
          assertActive: () => undefined,
        });
      }
    );

    await expect(
      deps.handler.createWarmWorker({
        warm_pool_id: 'warm-pool-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
      })
    ).rejects.toThrow('warm lease lost after docker create');

    expect(
      deps.workerLifecycleLockService.withLock.mock.calls.map(
        ([, operation]) => operation
      )
    ).toEqual(['create_warm_worker', 'recover_lost_create_warm_worker']);
    expect(deps.workerLifecycleLockService.withLock).toHaveBeenNthCalledWith(
      2,
      'warm-pool:warm-pool-1',
      'recover_lost_create_warm_worker',
      expect.any(Function),
      expect.objectContaining({
        acquireTimeoutMs: 15_000,
        heartbeatIntervalMs: 15_000,
        ttlMs: 75_000,
      })
    );
    expect(
      deps.workerWarmPoolRepository.finalizePostgresCreationReady
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        warmPoolId: 'warm-pool-1',
        serverId: 'server-1',
        workerTypeId: EWorkerType.baileys,
        containerId: 'warm-container-id',
        containerName: 'warm-warm-pool-1',
        runtimeCapabilityHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
        writerEpoch: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
        ),
      })
    );
    expect(
      deps.workerWarmPoolRepository.recordPostgresCreationError
    ).not.toHaveBeenCalled();
    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
    expect(deps.workerService.removeVolumeByName).not.toHaveBeenCalled();
  });

  it('reconciles an exact partial Docker effect after an aborted creation lease', async () => {
    const firstLeaseController = new AbortController();
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(),
      containerHealthResult: buildContainerHealthResult({
        healthy: false,
        health_failure_reason: 'partial_runtime_not_ready',
      }),
    });
    const createWarmRuntime =
      deps.workerService.createWarmContainerWorker.getMockImplementation();
    if (!createWarmRuntime) {
      throw new Error('createWarmContainerWorker mock is unavailable');
    }
    deps.workerService.createWarmContainerWorker.mockImplementation(
      async (input) => {
        await createWarmRuntime(input);
        firstLeaseController.abort();
        throw new Error('docker create result lost');
      }
    );
    deps.workerLifecycleLockService.withLock.mockImplementation(
      async (
        _workerId: string,
        operation: string,
        callback: (context: {
          signal: AbortSignal;
          assertActive: () => void;
        }) => Promise<unknown>
      ) => {
        if (operation === 'create_warm_worker') {
          return callback({
            signal: firstLeaseController.signal,
            assertActive: () => {
              if (firstLeaseController.signal.aborted) {
                throw new Error('warm lease aborted');
              }
            },
          });
        }

        return callback({
          signal: new AbortController().signal,
          assertActive: () => undefined,
        });
      }
    );

    await expect(
      deps.handler.createWarmWorker({
        warm_pool_id: 'warm-pool-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
      })
    ).rejects.toThrow('docker create result lost');

    expect(deps.workerService.removeContainerWorkerById).toHaveBeenCalledWith(
      'warm-container-id'
    );
    expect(deps.workerService.removeVolumeByName).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.finalizePostgresCreationReady
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.recordPostgresCreationError
    ).toHaveBeenCalledWith({
      warmPoolId: 'warm-pool-1',
      serverId: 'server-1',
      workerTypeId: EWorkerType.baileys,
      error: 'docker create result lost',
    });
  });

  it('fails closed and persists error when HTTP liveness never becomes healthy', async () => {
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(),
      containerHealthResult: buildContainerHealthResult({
        healthy: false,
        health_status_code: '503',
        health_failure_reason: 'http_health_not_ready',
      }),
      runtimeHealthResponse: buildWarmStandbyRuntimeHealth(),
    });

    await expect(
      deps.handler.createWarmWorker({
        warm_pool_id: 'warm-pool-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
      })
    ).rejects.toThrow(
      'warm_worker_http_health_not_ready:http_health_not_ready'
    );

    expect(
      deps.workerBaileysGrpcClientService.waitForReady
    ).not.toHaveBeenCalled();
    expect(
      deps.workerBaileysGrpcClientService.runtimeHealth
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.recordPostgresCreationError
    ).toHaveBeenCalledWith({
      warmPoolId: 'warm-pool-1',
      serverId: 'server-1',
      workerTypeId: EWorkerType.baileys,
      error: 'warm_worker_http_health_not_ready:http_health_not_ready',
    });
    expect(deps.workerService.removeContainerWorkerById).toHaveBeenCalledWith(
      'warm-container-id'
    );
    expect(deps.workerService.removeVolumeByName).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'an explicit worker error',
      response: { error: 'startup failed' },
      reason: 'worker_reported_error',
    },
    {
      label: 'a different warm pool identity',
      response: { warm_pool_id: 'warm-pool-other' },
      reason: 'warm_pool_id_mismatch',
    },
    {
      label: 'a missing warm pool identity',
      response: { warm_pool_id: undefined },
      reason: 'warm_pool_id_mismatch',
    },
    {
      label: 'a different worker type',
      response: { worker_type_id: EWorkerType.wwebjs },
      reason: 'worker_type_id_mismatch',
    },
    {
      label: 'an activated worker identity',
      response: { worker_id: 'worker-other' },
      reason: 'worker_id_mismatch',
    },
    {
      label: 'an activated account identity',
      response: { account_id: 'account-other' },
      reason: 'account_id_mismatch',
    },
    {
      label: 'standby false',
      response: { standby: false },
      reason: 'standby_not_true',
    },
    {
      label: 'ready false',
      response: { ready: false },
      reason: 'ready_not_true',
    },
    {
      label: 'activated true',
      response: { activated: true },
      reason: 'activated_not_false',
    },
    {
      label: 'a missing activated flag',
      response: { activated: undefined },
      reason: 'activated_not_false',
    },
    {
      label: 'an active runtime state',
      response: { runtime_state: 'active' },
      reason: 'runtime_state_mismatch',
    },
    {
      label: 'an unhealthy Kafka runtime',
      response: { kafka_unhealthy: true },
      reason: 'kafka_unhealthy',
    },
    {
      label: 'Kafka consumers started during standby',
      response: { kafka_consumers_ready: true },
      reason: 'kafka_consumers_started_in_standby',
    },
  ])(
    'fails closed and persists error when RuntimeHealth reports $label',
    async ({ response, reason }) => {
      const deps = buildHandler({
        workerRuntimeRepository: buildSelfHealRuntimeRepository(),
        runtimeHealthResponse: buildWarmStandbyRuntimeHealth(response),
      });
      const sleep = mockHandlerSleep(deps.handler);

      await expect(
        deps.handler.createWarmWorker({
          warm_pool_id: 'warm-pool-1',
          server_id: 'server-1',
          worker_type_id: EWorkerType.baileys,
        })
      ).rejects.toThrow(`warm_worker_runtime_health_not_ready:${reason}`);

      expect(
        deps.workerWarmPoolRepository.recordPostgresCreationError
      ).toHaveBeenCalledWith({
        warmPoolId: 'warm-pool-1',
        serverId: 'server-1',
        workerTypeId: EWorkerType.baileys,
        error: `warm_worker_runtime_health_not_ready:${reason}`,
      });
      expect(
        deps.workerWarmPoolRepository.finalizePostgresCreationReady
      ).not.toHaveBeenCalled();
      expect(
        deps.workerBaileysGrpcClientService.runtimeHealth
      ).toHaveBeenCalledTimes(10);
      expect(sleep).toHaveBeenCalledTimes(9);
      expect(deps.workerService.removeContainerWorkerById).toHaveBeenCalledWith(
        'warm-container-id'
      );
      expect(deps.workerService.removeVolumeByName).not.toHaveBeenCalled();
    }
  );

  it('treats Kafka consumers as not applicable while the runtime is a warm standby', async () => {
    const deps = buildHandler({
      runtimeHealthResponse: buildWarmStandbyRuntimeHealth({
        kafka_unhealthy: false,
        kafka_consumers_ready: false,
      }),
    });

    await expect(
      deps.handler.createWarmWorker({
        warm_pool_id: 'warm-pool-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
      })
    ).resolves.toEqual(
      expect.objectContaining({
        warm_pool_id: 'warm-pool-1',
        container_id: 'warm-container-id',
      })
    );

    expect(
      deps.workerWarmPoolRepository.finalizePostgresCreationReady
    ).toHaveBeenCalled();
    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
  });

  it('polls bounded RuntimeHealth with backoff until standby becomes semantically ready', async () => {
    const deps = buildHandler({
      runtimeHealthResponse: buildWarmStandbyRuntimeHealth(),
    });
    const sleep = mockHandlerSleep(deps.handler);
    deps.workerBaileysGrpcClientService.runtimeHealth
      .mockResolvedValueOnce(buildWarmStandbyRuntimeHealth({ standby: false }))
      .mockResolvedValueOnce(buildWarmStandbyRuntimeHealth({ ready: false }));

    await expect(
      deps.handler.createWarmWorker({
        warm_pool_id: 'warm-pool-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
      })
    ).resolves.toEqual(
      expect.objectContaining({
        warm_pool_id: 'warm-pool-1',
        container_id: 'warm-container-id',
      })
    );

    expect(
      deps.workerBaileysGrpcClientService.runtimeHealth
    ).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 250);
    expect(sleep).toHaveBeenNthCalledWith(2, 500);
    expect(
      deps.workerService.removeContainerByNameAndVolume
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.finalizePostgresCreationReady
    ).toHaveBeenCalled();
  });

  it('keeps the original readiness diagnosis when rejected-runtime cleanup also fails', async () => {
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(),
      runtimeHealthResponse: buildWarmStandbyRuntimeHealth({
        standby: false,
      }),
    });
    mockHandlerSleep(deps.handler);
    deps.workerService.removeContainerWorkerById.mockRejectedValueOnce(
      new Error('docker cleanup failed')
    );
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await expect(
      deps.handler.createWarmWorker({
        warm_pool_id: 'warm-pool-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
      })
    ).rejects.toThrow('warm_worker_runtime_health_not_ready:standby_not_true');

    expect(
      deps.workerWarmPoolRepository.recordPostgresCreationError
    ).toHaveBeenCalledWith({
      warmPoolId: 'warm-pool-1',
      serverId: 'server-1',
      workerTypeId: EWorkerType.baileys,
      error: 'warm_worker_runtime_health_not_ready:standby_not_true',
    });
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to cleanup PostgreSQL warm worker runtime',
      expect.objectContaining({
        warm_pool_id: 'warm-pool-1',
        original_error: 'warm_worker_runtime_health_not_ready:standby_not_true',
        cleanup_error: 'docker cleanup failed',
      })
    );
  });
});

describe('WorkerCommandHandlerService warm lifecycle races', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('binds and activates a PostgreSQL warm worker by reusing the same container', async () => {
    const runtimeRepository = buildSelfHealRuntimeRepository();
    const deps = buildHandler({ workerRuntimeRepository: runtimeRepository });
    preparePostgresWarmActivation(deps);

    await expect(
      deps.handler.activateWarmWorker({
        warm_pool_id: 'warm-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
      })
    ).resolves.toEqual({
      warm_pool_id: 'warm-1',
      worker_id: 'worker-1',
      container_id: WARM_RUNTIME_CONTAINER_ID,
      container_name: 'worker-1',
      session_volume_name: '',
      claimed: true,
    });

    expect(
      deps.workerWarmPoolRepository.bindPostgresWarmRuntime
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        warmPoolId: 'warm-1',
        workerId: 'worker-1',
        containerId: WARM_RUNTIME_CONTAINER_ID,
        containerName: 'worker-1',
        runtimeGeneration: 5,
        runtimeCapabilityHash: createHash('sha256')
          .update(WARM_RUNTIME_CAPABILITY)
          .digest('hex'),
        writerEpoch: WARM_RUNTIME_WRITER_EPOCH,
      })
    );
    expect(deps.workerService.renameContainer).toHaveBeenCalledWith(
      WARM_RUNTIME_CONTAINER_ID,
      'worker-1'
    );
    expect(
      deps.workerBaileysGrpcClientService.activateRuntime
    ).toHaveBeenCalledWith(
      'worker-1',
      expect.objectContaining({
        warm_pool_id: 'warm-1',
        runtime_generation: 5,
        session_storage: EWorkerSessionStorage.postgres,
        runtime_capability: WARM_RUNTIME_CAPABILITY,
        writer_epoch: WARM_RUNTIME_WRITER_EPOCH,
      }),
      EWorkerType.baileys
    );
    expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();
    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
    expect(deps.workerWarmPoolRepository.markAssigned).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedContainerId: WARM_RUNTIME_CONTAINER_ID,
        assignedContainerId: WARM_RUNTIME_CONTAINER_ID,
      })
    );
  });

  it('redelivers an already provider-activated exact PostgreSQL warm runtime without rebinding or reserving another generation', async () => {
    const runtimeRepository = buildSelfHealRuntimeRepository();
    const deps = buildHandler({ workerRuntimeRepository: runtimeRepository });
    preparePostgresWarmActivation(deps);
    const capabilityHash = createHash('sha256')
      .update(WARM_RUNTIME_CAPABILITY)
      .digest('hex');
    runtimeRepository.viewByWorkerIdConsistent.mockResolvedValue({
      worker_id: 'worker-1',
      container_id: WARM_RUNTIME_CONTAINER_ID,
      container_name: 'worker-1',
      session_storage: EWorkerSessionStorage.postgres,
      session_volume_name: null,
      runtime_generation: 5,
      runtime_capability_hash: capabilityHash,
      session_writer_epoch: WARM_RUNTIME_WRITER_EPOCH,
      connection_epoch: '00000000-0000-4000-8000-000000000006',
      connection_sequence: 7,
      source_provider: 'baileys',
      connection_activated_at: '2026-08-08T00:00:00.000Z',
      native_connection_status: { status: 'online' },
      native_connection_online_acknowledged: true,
      recreate_bootstrap_operation_id: '00000000-0000-4000-8000-000000000004',
      recreate_bootstrap_runtime_generation: 5,
      recreate_bootstrap_container_id: WARM_RUNTIME_CONTAINER_ID,
      recreate_bootstrap_started_at: '2026-08-08T00:00:01.000Z',
      recreate_retired_operation_id: null,
      recreate_retired_runtime_generation: null,
      recreate_retired_container_id: null,
      recreate_retired_at: null,
      warm_pool_id: 'warm-1',
    });

    await expect(
      deps.handler.activateWarmWorker({
        warm_pool_id: 'warm-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
      })
    ).resolves.toEqual(
      expect.objectContaining({
        claimed: true,
        container_id: WARM_RUNTIME_CONTAINER_ID,
      })
    );

    expect(
      runtimeRepository.reserveNextRuntimeGeneration
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.bindPostgresWarmRuntime
    ).not.toHaveBeenCalled();
    expect(
      deps.workerBaileysGrpcClientService.activateRuntime
    ).toHaveBeenCalledWith(
      'worker-1',
      expect.objectContaining({ runtime_generation: 5 }),
      EWorkerType.baileys
    );
  });

  it('finalizes PostgreSQL warm recreate when ONLINE wins between owner snapshot and completion CAS', async () => {
    const runtimeRepository = buildSelfHealRuntimeRepository();
    const deps = buildHandler({ workerRuntimeRepository: runtimeRepository });
    preparePostgresWarmActivation(deps);
    const lifecycleOperationId = '019fdf2c-63af-73e2-8107-3442eeeb8e19';
    const oldContainerId = 'a'.repeat(64);
    let currentWorker: Record<string, unknown> = {
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: EWorkerType.baileys,
      session_storage: EWorkerSessionStorage.postgres,
      deleted_at: null,
      container_id: oldContainerId,
      runtime_container_id: WARM_RUNTIME_CONTAINER_ID,
      runtime_generation: 5,
      lifecycle_operation_id: lifecycleOperationId,
    };
    deps.workerService.viewWorkerForMonitor.mockImplementation(async () => ({
      ...currentWorker,
    }));
    let completionAttempt = 0;
    deps.workerService.updateWorkerByIdIfLifecycleMatches.mockImplementation(
      async (_accountId: string, update: unknown, guard: unknown) => {
        completionAttempt += 1;
        if (completionAttempt === 1) {
          currentWorker = {
            ...currentWorker,
            worker_status_id: EWorkerStatus.online,
            container_id: WARM_RUNTIME_CONTAINER_ID,
          };
          return false;
        }
        const completion = (
          guard as {
            recreate_completion?: {
              operation_id: string;
              runtime_generation: number;
            };
          }
        ).recreate_completion;
        currentWorker = {
          ...currentWorker,
          ...(update as Record<string, unknown>),
          recreate_completed_operation_id: completion?.operation_id,
          recreate_completed_runtime_generation: completion?.runtime_generation,
          recreate_completed_at: '2026-08-08T00:00:00.000Z',
        };
        return true;
      }
    );

    await expect(
      deps.handler.activateWarmWorker({
        warm_pool_id: 'warm-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        previous_worker_type_id: EWorkerType.baileys,
        lifecycle_operation_id: lifecycleOperationId,
        session_storage: EWorkerSessionStorage.postgres,
      })
    ).resolves.toEqual(
      expect.objectContaining({
        claimed: true,
        container_id: WARM_RUNTIME_CONTAINER_ID,
      })
    );

    expect(
      deps.workerRuntimeRepository.markRecreateBootstrapStarted
    ).toHaveBeenCalledWith({
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      lifecycle_operation_id: lifecycleOperationId,
      runtime_generation: 5,
      container_id: WARM_RUNTIME_CONTAINER_ID,
    });
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenNthCalledWith(
      1,
      'account-1',
      expect.objectContaining({ lifecycle_operation_id: null }),
      expect.objectContaining({
        container_id: oldContainerId,
        worker_status_id: EWorkerStatus.recreating,
        recreate_completion: {
          operation_id: lifecycleOperationId,
          runtime_generation: 5,
          mode: 'replacement_runtime',
        },
      })
    );
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenNthCalledWith(
      2,
      'account-1',
      expect.objectContaining({ lifecycle_operation_id: null }),
      expect.objectContaining({
        container_id: WARM_RUNTIME_CONTAINER_ID,
        worker_status_id: EWorkerStatus.online,
        recreate_completion: {
          operation_id: lifecycleOperationId,
          runtime_generation: 5,
          mode: 'replacement_runtime_already_online',
        },
      })
    );
    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
  });

  it('normalizes the protobuf empty session backend and resolves it from the worker row', async () => {
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(),
    });
    preparePostgresWarmActivation(deps);

    await expect(
      deps.handler.activateWarmWorker({
        warm_pool_id: 'warm-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        session_storage: '',
      })
    ).resolves.toEqual(
      expect.objectContaining({
        claimed: true,
        container_id: WARM_RUNTIME_CONTAINER_ID,
      })
    );
    expect(
      deps.workerWarmPoolRepository.bindPostgresWarmRuntime
    ).toHaveBeenCalled();
  });

  it('rejects an explicit warm backend that disagrees with the worker before any mutation', async () => {
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(),
    });
    preparePostgresWarmActivation(deps);

    await expect(
      deps.handler.activateWarmWorker({
        warm_pool_id: 'warm-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        session_storage: EWorkerSessionStorage.legacy_volume,
      })
    ).rejects.toThrow('worker_session_storage_authoritative_fence_changed');

    expect(
      deps.workerWarmPoolRepository.beginActivation
    ).not.toHaveBeenCalled();
    expect(
      deps.workerRuntimeRepository.reserveNextRuntimeGeneration
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.bindPostgresWarmRuntime
    ).not.toHaveBeenCalled();
    expect(deps.workerService.renameContainer).not.toHaveBeenCalled();
    expect(
      deps.workerBaileysGrpcClientService.activateRuntime
    ).not.toHaveBeenCalled();
  });

  it('returns a pool miss when the worker and warm backends disagree before any mutation', async () => {
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(),
    });
    preparePostgresWarmActivation(deps);
    deps.workerService.viewWorkerForMonitor.mockResolvedValue({
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.creating,
      worker_type_id: EWorkerType.baileys,
      session_storage: EWorkerSessionStorage.legacy_volume,
      deleted_at: null,
      container_id: null,
      lifecycle_operation_id: null,
    });

    await expect(
      deps.handler.activateWarmWorker({
        warm_pool_id: 'warm-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
      })
    ).resolves.toEqual(
      expect.objectContaining({
        claimed: false,
        error: 'confirmed_cleanup',
      })
    );

    expect(
      deps.workerWarmPoolRepository.beginActivation
    ).not.toHaveBeenCalled();
    expect(
      deps.workerRuntimeRepository.reserveNextRuntimeGeneration
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.bindPostgresWarmRuntime
    ).not.toHaveBeenCalled();
    expect(deps.workerService.renameContainer).not.toHaveBeenCalled();
    expect(
      deps.workerBaileysGrpcClientService.activateRuntime
    ).not.toHaveBeenCalled();
  });

  it('rejects an unknown warm backend before acquiring lifecycle locks', async () => {
    const deps = buildHandler();

    await expect(
      deps.handler.activateWarmWorker({
        warm_pool_id: 'warm-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        session_storage: 'filesystem',
      })
    ).rejects.toThrow('Invalid session_storage');

    expect(deps.workerLifecycleLockService.withLock).not.toHaveBeenCalled();
  });

  it('refuses to promote a PostgreSQL standby created with the legacy warm resource profile', async () => {
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(),
    });
    preparePostgresWarmActivation(deps);
    deps.workerService.inspectContainerWorkerByIdStrict.mockImplementation(
      async (target: string) => {
        if (target === 'worker-1') {
          return { exists: false, container_name: target };
        }
        const inspection = buildPostgresWarmContainerInspection({
          container_id: WARM_RUNTIME_CONTAINER_ID,
          container_name: 'warm-warm-1',
        });
        return {
          ...inspection,
          container_labels: {
            ...inspection.container_labels,
            'underchat.warm_pool_id': 'warm-1',
            'underchat.resource_profile': 'warm',
          },
          container_env: {
            ...inspection.container_env,
            WARM_POOL_ID: 'warm-1',
          },
        };
      }
    );

    await expect(
      deps.handler.activateWarmWorker({
        warm_pool_id: 'warm-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
      })
    ).rejects.toThrow('postgres_warm_worker_source_identity_mismatch');

    expect(
      deps.workerWarmPoolRepository.bindPostgresWarmRuntime
    ).not.toHaveBeenCalled();
    expect(deps.workerService.renameContainer).not.toHaveBeenCalled();
    expect(
      deps.workerBaileysGrpcClientService.activateRuntime
    ).not.toHaveBeenCalled();
  });

  it('releases the claim fail-closed when latest is retagged during the activation fence', async () => {
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(),
    });
    prepareWarmActivation(deps);
    deps.workerService.inspectImageContentId
      .mockResolvedValueOnce(WORKER_IMAGE_CONTENT_ID)
      .mockResolvedValueOnce(`sha256:${'b'.repeat(64)}`);

    await expect(
      deps.handler.activateWarmWorker({
        warm_pool_id: 'warm-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
      })
    ).resolves.toEqual(
      expect.objectContaining({
        claimed: false,
        error: 'confirmed_cleanup',
      })
    );

    expect(
      deps.workerWarmPoolRepository.releaseReservedAfterHealthFence
    ).toHaveBeenCalledWith({
      warmPoolId: 'warm-1',
      reservedByWorkerId: 'worker-1',
      expectedContainerId: 'warm-container-id',
    });
    expect(
      deps.workerWarmPoolRepository.beginActivation
    ).not.toHaveBeenCalled();
    expect(
      deps.workerBaileysGrpcClientService.activateRuntime
    ).not.toHaveBeenCalled();
  });

  it('keeps a healthy pinned target available when latest is retagged after source removal', async () => {
    const retaggedImageId = `sha256:${'b'.repeat(64)}`;
    let currentAliasImageId = WORKER_IMAGE_CONTENT_ID;
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(),
    });
    prepareWarmActivation(deps);
    deps.workerService.inspectImageContentId.mockImplementation(
      async () => currentAliasImageId
    );
    deps.workerBaileysGrpcClientService.runtimeHealth.mockImplementationOnce(
      async () => {
        /*
         * Retag only after the standby source has gone and the pinned target
         * has passed Docker health. At this point availability belongs to A;
         * mutable alias B is rollout input, not authority to delete A.
         */
        expect(
          deps.workerService.removeContainerWorkerById
        ).toHaveBeenCalledWith('warm-container-id');
        expect(
          deps.containerHealthService.checkServiceHealth
        ).toHaveBeenCalledWith('replacement-container-id', expect.any(Object));
        currentAliasImageId = retaggedImageId;
        return buildActivatedWarmRuntimeHealth({
          runtime_generation: 5,
        });
      }
    );

    await expect(
      deps.handler.activateWarmWorker({
        warm_pool_id: 'warm-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
      })
    ).resolves.toEqual(
      expect.objectContaining({
        claimed: true,
        container_id: 'replacement-container-id',
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
      expect.any(Object),
      'warm-warm-1',
      expect.objectContaining({
        requireExistingVolume: true,
        requireContainerNameAvailable: true,
        imageContentId: WORKER_IMAGE_CONTENT_ID,
      })
    );
    expect(deps.workerWarmPoolRepository.markAssigned).toHaveBeenCalledWith(
      expect.objectContaining({
        assignedContainerId: 'replacement-container-id',
      })
    );
    expect(
      deps.workerService.removeContainerWorkerById
    ).not.toHaveBeenCalledWith('replacement-container-id');
    expect(deps.workerService.inspectImageContentId).toHaveBeenCalledTimes(2);
    expect(currentAliasImageId).toBe(retaggedImageId);
  });

  it('cleans an obsolete claimed standby before any provider activation', async () => {
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(),
    });
    prepareWarmActivation(deps);
    deps.workerService.inspectImageContentId.mockResolvedValue(
      `sha256:${'c'.repeat(64)}`
    );

    await expect(
      deps.handler.activateWarmWorker({
        warm_pool_id: 'warm-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
      })
    ).resolves.toEqual(
      expect.objectContaining({
        claimed: false,
        error: 'confirmed_cleanup',
      })
    );

    expect(deps.workerWarmPoolRepository.rejectActivation).toHaveBeenCalledWith(
      expect.objectContaining({
        warmPoolId: 'warm-1',
        reservedByWorkerId: 'worker-1',
        error: expect.stringContaining('content_image_mismatch'),
      })
    );
    expect(deps.workerService.removeContainerWorkerById).toHaveBeenCalledWith(
      'warm-container-id'
    );
    expect(
      deps.workerWarmPoolRepository.beginActivation
    ).not.toHaveBeenCalled();
    expect(
      deps.workerBaileysGrpcClientService.activateRuntime
    ).not.toHaveBeenCalled();
  });

  it('admits warm activation through a short per-server slot before acquiring lifecycle locks', async () => {
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(),
    });
    prepareWarmActivation(deps);
    deps.workerService.viewWorkerForMonitor.mockResolvedValue({
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.creating,
      worker_type_id: EWorkerType.baileys,
      session_storage: EWorkerSessionStorage.legacy_volume,
      deleted_at: null,
      container_id: null,
      lifecycle_operation_id: 'operation-1',
    });

    await expect(
      deps.handler.activateWarmWorker({
        warm_pool_id: 'warm-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        lifecycle_operation_id: 'operation-1',
      })
    ).resolves.toEqual(expect.objectContaining({ claimed: true }));

    expect(deps.workerRecreateServerSlotService.withSlot).toHaveBeenCalledWith(
      {
        serverId: 'server-1',
        workerId: 'worker-1',
        lifecycleOperationId: 'operation-1',
      },
      expect.any(Function),
      { acquireTimeoutMs: 15_000 }
    );
    expect(
      deps.workerRecreateServerSlotService.withSlot.mock.invocationCallOrder[0]
    ).toBeLessThan(
      deps.workerLifecycleLockService.withLock.mock.invocationCallOrder[0]
    );
  });

  it('does not acquire lifecycle locks or mutate warm state when server admission times out', async () => {
    const serverSlotError = new Error(
      'Timed out waiting for recreate slot on server server-1'
    );
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(),
      workerRecreateServerSlotService: {
        withSlot: jest.fn(async () => {
          throw serverSlotError;
        }),
      },
    });
    prepareWarmActivation(deps);

    await expect(
      deps.handler.activateWarmWorker({
        warm_pool_id: 'warm-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        lifecycle_operation_id: 'operation-1',
      })
    ).rejects.toBe(serverSlotError);

    expect(deps.workerLifecycleLockService.withLock).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.beginActivation
    ).not.toHaveBeenCalled();
    expect(deps.workerWarmPoolRepository.markAssigned).not.toHaveBeenCalled();
    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
    expect(deps.workerService.removeVolumeByName).not.toHaveBeenCalled();
    expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();
  });

  it('admits a recreate through the server slot before acquiring the worker lifecycle lock', async () => {
    const deps = buildHandler();

    await expect(
      handleWorkerCommand(deps, {
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        lifecycle_operation_id: 'operation-1',
      })
    ).resolves.toBeUndefined();

    expect(deps.workerRecreateServerSlotService.withSlot).toHaveBeenCalledWith(
      {
        serverId: 'server-1',
        workerId: 'worker-1',
        lifecycleOperationId: 'operation-1',
      },
      expect.any(Function),
      {
        reservedSlotKey: undefined,
        reservedSlotToken: undefined,
      }
    );
    expect(
      deps.workerRecreateServerSlotService.withSlot.mock.invocationCallOrder[0]
    ).toBeLessThan(
      deps.workerLifecycleLockService.withLock.mock.invocationCallOrder[0]
    );
  });

  it.each([
    [
      'target recreation',
      EWorkerAction.recreate,
      EWorkerType.whatsmeow,
      EWorkerType.baileys,
    ],
    [
      'source cleanup',
      EWorkerAction.cleanup,
      EWorkerType.baileys,
      EWorkerType.baileys,
    ],
  ] as const)(
    'suppresses terminal provider handoff %s under the lifecycle lock before any runtime effect',
    async (_effect, action, workerTypeId, previousWorkerTypeId) => {
      const deps = buildHandler();
      const terminalProof = (
        deps.workerRuntimeRepository as unknown as {
          viewWhatsappProviderHandoffTerminalLifecycleProof: jest.Mock;
        }
      ).viewWhatsappProviderHandoffTerminalLifecycleProof;
      terminalProof.mockResolvedValue({
        handoff_id: 'handoff-1',
        lifecycle_operation_id: 'operation-1',
        handoff_state: 'completed',
        error_code: null,
        source_provider: 'baileys',
        target_provider: 'whatsmeow',
        recovery_state: 'none',
        recovery_operation_id: null,
        resolution_state: null,
        resolution_operation_id: null,
        point_of_no_return_at: '2026-08-09T03:30:00.000Z',
        worker_type_id: EWorkerType.whatsmeow,
        worker_status_id: EWorkerStatus.online,
        terminal_ownership_unique: true,
      });

      await expect(
        handleWorkerCommand(deps, {
          action,
          worker_id: 'worker-1',
          account_id: 'account-1',
          server_id: 'server-1',
          worker_status_id: EWorkerStatus.recreating,
          worker_type_id: workerTypeId,
          previous_worker_type_id: previousWorkerTypeId,
          session_storage: EWorkerSessionStorage.postgres,
          remove_session: false,
          remove_volume: false,
          lifecycle_operation_id: 'operation-1',
        })
      ).resolves.toBeUndefined();

      expect(terminalProof).toHaveBeenCalledWith({
        worker_id: 'worker-1',
        account_id: 'account-1',
        lifecycle_operation_id: 'operation-1',
      });
      expect(
        deps.workerLifecycleLockService.withLock.mock.invocationCallOrder[0]
      ).toBeLessThan(terminalProof.mock.invocationCallOrder[0]);
      expect(
        deps.workerService.stopContainerWorkerByIdGracefully
      ).not.toHaveBeenCalled();
      expect(
        deps.workerService.removeContainerWorkerById
      ).not.toHaveBeenCalled();
      expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();
    }
  );

  it('suppresses a recovery cleanup after the preserved source runtime reservation replaced the failed target', async () => {
    const deps = buildHandler();
    const recoveryProof = (
      deps.workerRuntimeRepository as unknown as {
        viewWhatsappProviderHandoffRecoveryLifecycleProof: jest.Mock;
      }
    ).viewWhatsappProviderHandoffRecoveryLifecycleProof;
    const terminalProof = (
      deps.workerRuntimeRepository as unknown as {
        viewWhatsappProviderHandoffTerminalLifecycleProof: jest.Mock;
      }
    ).viewWhatsappProviderHandoffTerminalLifecycleProof;
    deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValue({
      worker_id: 'worker-1',
      name: 'Canal 1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: EWorkerType.wwebjs,
      session_storage: EWorkerSessionStorage.postgres,
      lifecycle_operation_id: 'operation-1',
      deleted_at: null,
    });
    recoveryProof.mockResolvedValue({
      handoff_id: 'handoff-1',
      handoff_lifecycle_operation_id: 'original-operation',
      recovery_operation_id: 'operation-1',
      source_provider: 'wwebjs',
      failed_target_provider: 'baileys',
      source_revision_id: '41',
      recovery_state: 'running',
      recovery_cleanup_required: true,
      recovery_from_generation: 20,
      recovery_ownership_unique: true,
      recovery_context_valid: true,
      source_session_valid: true,
      runtime_source_provider: null,
      runtime_generation: 21,
      runtime_container_id: null,
      recovery_source_runtime_reserved: true,
    });

    await expect(
      (
        deps.handler as unknown as {
          suppressTerminalWhatsappProviderHandoffEffect(
            input: IWorkerPayload,
            lease: ILockLeaseContext
          ): Promise<boolean>;
        }
      ).suppressTerminalWhatsappProviderHandoffEffect(
        {
          action: EWorkerAction.cleanup,
          worker_id: 'worker-1',
          account_id: 'account-1',
          server_id: 'server-1',
          worker_status_id: EWorkerStatus.recreating,
          worker_type_id: EWorkerType.baileys,
          previous_worker_type_id: EWorkerType.baileys,
          session_storage: EWorkerSessionStorage.postgres,
          remove_session: false,
          remove_volume: false,
          lifecycle_operation_id: 'operation-1',
        },
        {
          signal: new AbortController().signal,
          assertActive: jest.fn(),
        }
      )
    ).resolves.toBe(true);

    expect(recoveryProof).toHaveBeenCalledWith({
      worker_id: 'worker-1',
      account_id: 'account-1',
      recovery_operation_id: 'operation-1',
      recovery_worker_type_id: EWorkerType.wwebjs,
      recovery_provider: 'wwebjs',
    });
    expect(terminalProof).not.toHaveBeenCalled();
    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
    expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();
  });

  it('uses short heartbeated leases only for a liveness recreate', async () => {
    const deps = buildHandler();

    await handleWorkerCommand(deps, {
      action: EWorkerAction.recreate,
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.wwebjs,
      lifecycle_operation_id: 'operation-liveness',
      expected_container_id: 'a'.repeat(64),
    });

    expect(deps.workerRecreateServerSlotService.withSlot).toHaveBeenCalledWith(
      {
        serverId: 'server-1',
        workerId: 'worker-1',
        lifecycleOperationId: 'operation-liveness',
      },
      expect.any(Function),
      expect.objectContaining({
        ttlMs: WORKER_LIVENESS_LIFECYCLE_LEASE_TTL_MS,
        acquireTimeoutMs: WORKER_LIVENESS_LIFECYCLE_LEASE_TTL_MS,
        heartbeatIntervalMs: WORKER_LIVENESS_LIFECYCLE_HEARTBEAT_MS,
      })
    );
    expect(deps.workerLifecycleLockService.withLock).toHaveBeenCalledWith(
      'worker-1',
      'recreate_worker',
      expect.any(Function),
      expect.objectContaining({
        ttlMs: WORKER_LIVENESS_LIFECYCLE_LEASE_TTL_MS,
        acquireTimeoutMs: WORKER_LIVENESS_LIFECYCLE_LEASE_TTL_MS,
        heartbeatIntervalMs: WORKER_LIVENESS_LIFECYCLE_HEARTBEAT_MS,
        signal: expect.any(AbortSignal),
      })
    );
  });

  it('does not acquire the worker lifecycle lock when recreate server admission times out', async () => {
    const serverSlotError = new Error(
      'Timed out waiting for recreate slot on server server-1'
    );
    const deps = buildHandler({
      workerRecreateServerSlotService: {
        withSlot: jest.fn(async () => {
          throw serverSlotError;
        }),
      },
    });

    await expect(
      handleWorkerCommand(deps, {
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        lifecycle_operation_id: 'operation-1',
      })
    ).rejects.toBe(serverSlotError);

    expect(deps.workerLifecycleLockService.withLock).not.toHaveBeenCalled();
    expect(deps.workerService.removeContainerWorker).not.toHaveBeenCalled();
    expect(
      deps.workerService.removeContainerByNameAndVolume
    ).not.toHaveBeenCalled();
    expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();
  });

  it('does not continue to runtime removal after a timed-out slot callback completes late', async () => {
    const slotTimeout = new Error('worker_recreate_server_slot_hold_timeout');
    const slotAbortController = new AbortController();
    let slotActive = true;
    let notifyImageProvisionStarted: (() => void) | undefined;
    const imageProvisionStarted = new Promise<void>((resolve) => {
      notifyImageProvisionStarted = resolve;
    });
    let completeImageProvision: ((imageId: string) => void) | undefined;
    const delayedImageProvision = new Promise<string>((resolve) => {
      completeImageProvision = resolve;
    });
    let lateCallback: Promise<unknown> | undefined;
    const workerRecreateServerSlotService = {
      withSlot: jest.fn(
        async (
          _input: unknown,
          callback: (
            lease: {
              key: string;
              token: string;
              serverId: string;
              slot: number;
              reserved: boolean;
            },
            context: ILockLeaseContext
          ) => Promise<unknown>
        ) => {
          const context: ILockLeaseContext = {
            signal: slotAbortController.signal,
            assertActive: () => {
              if (!slotActive) {
                throw slotTimeout;
              }
            },
          };
          lateCallback = callback(
            {
              key: 'worker:recreate:server:server-1:slot:0',
              token: 'worker-1:operation-1',
              serverId: 'server-1',
              slot: 0,
              reserved: false,
            },
            context
          ).then(
            (value) => ({ kind: 'completed', value }),
            (error: unknown) => ({ kind: 'failed', error })
          );

          await imageProvisionStarted;
          slotActive = false;
          slotAbortController.abort(slotTimeout);
          throw slotTimeout;
        }
      ),
    };
    const deps = buildHandler({ workerRecreateServerSlotService });
    deps.workerService.ensureWorkerImageContentId.mockImplementation(
      async () => {
        notifyImageProvisionStarted?.();
        return delayedImageProvision;
      }
    );

    await expect(
      handleWorkerCommand(deps, {
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
      })
    ).rejects.toBe(slotTimeout);

    expect(deps.workerService.removeContainerWorker).not.toHaveBeenCalled();
    expect(
      deps.workerService.removeContainerByNameAndVolume
    ).not.toHaveBeenCalled();
    expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();

    completeImageProvision?.(WORKER_IMAGE_CONTENT_ID);
    await lateCallback;

    expect(deps.workerService.removeContainerWorker).not.toHaveBeenCalled();
    expect(
      deps.workerService.removeContainerByNameAndVolume
    ).not.toHaveBeenCalled();
    expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();
  });

  it('rechecks a ready row after health and never returns a tombstoned runtime', async () => {
    const deps = buildHandler({
      workerInspection: buildPostgresWarmContainerInspection(),
      runtimeHealthResponse: buildWarmStandbyRuntimeHealth(),
    });
    deps.workerWarmPoolRepository.viewByIdConsistent
      .mockResolvedValueOnce({
        warm_pool_id: 'warm-pool-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        container_id: 'warm-container-id',
        container_name: 'warm-warm-pool-1',
        session_storage: EWorkerSessionStorage.postgres,
        session_volume_name: null,
        state: EWorkerWarmPoolState.ready,
      })
      .mockResolvedValueOnce({
        warm_pool_id: 'warm-pool-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        container_id: 'warm-container-id',
        container_name: 'warm-warm-pool-1',
        session_storage: EWorkerSessionStorage.postgres,
        session_volume_name: null,
        state: EWorkerWarmPoolState.deleting,
      });

    await expect(
      deps.handler.createWarmWorker({
        warm_pool_id: 'warm-pool-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
      })
    ).rejects.toThrow(
      'warm_worker_ready_state_changed_after_health_check:deleting'
    );
    expect(deps.workerService.createWarmContainerWorker).not.toHaveBeenCalled();
    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
  });

  it('extends the primary reservation and waits for Kafka consumers before assignment', async () => {
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(),
    });
    prepareWarmActivation(deps);
    const sleep = mockHandlerSleep(deps.handler);
    deps.workerBaileysGrpcClientService.runtimeHealth.mockResolvedValueOnce(
      buildActivatedWarmRuntimeHealth({
        runtime_generation: 5,
        kafka_consumers_ready: false,
        authenticated: true,
        session_ready: true,
        can_send: true,
        can_receive_runtime: true,
      })
    );
    const startedAt = Date.now();

    await expect(
      deps.handler.activateWarmWorker({
        warm_pool_id: 'warm-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
      })
    ).resolves.toEqual(expect.objectContaining({ claimed: true }));

    expect(
      deps.workerWarmPoolRepository.extendActivationReservation
    ).toHaveBeenCalledWith({
      warmPoolId: 'warm-1',
      reservedByWorkerId: 'worker-1',
      reservationExpiresAt: expect.any(String),
    });
    const extension = deps.workerWarmPoolRepository.extendActivationReservation
      .mock.calls[0][0] as {
      reservationExpiresAt: string;
    };
    expect(Date.parse(extension.reservationExpiresAt)).toBeGreaterThanOrEqual(
      startedAt + 10 * 60 * 1_000
    );
    expect(
      deps.workerBaileysGrpcClientService.runtimeHealth
    ).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250);
    expect(deps.workerWarmPoolRepository.markAssigned).toHaveBeenCalled();
    expect(deps.workerLifecycleLockService.withLock.mock.calls[0][0]).toBe(
      'warm-pool:warm-1'
    );
    expect(deps.workerLifecycleLockService.withLock.mock.calls[1][0]).toBe(
      'worker-1'
    );
  });

  it('accepts a fresh unauthenticated runtime before QR consumers start', async () => {
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(),
      runtimeHealthResponse: {
        runtime_generation: 5,
        authenticated: false,
        session_ready: false,
        can_send: false,
        kafka_consumers_ready: false,
        kafka_unhealthy: true,
        qr_stream_ready: true,
      },
    });
    prepareWarmActivation(deps);

    await expect(
      deps.handler.activateWarmWorker({
        warm_pool_id: 'warm-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
      })
    ).resolves.toEqual(expect.objectContaining({ claimed: true }));

    expect(
      deps.workerBaileysGrpcClientService.runtimeHealth
    ).toHaveBeenCalledTimes(1);
    expect(deps.workerWarmPoolRepository.markAssigned).toHaveBeenCalled();
  });

  it('returns a confirmed cleanup when Kafka consumers never become ready', async () => {
    const runtimeRepository = buildSelfHealRuntimeRepository();
    const deps = buildHandler({
      workerRuntimeRepository: runtimeRepository,
      runtimeHealthResponse: {
        kafka_consumers_ready: false,
        authenticated: true,
        session_ready: true,
        can_send: true,
        can_receive_runtime: true,
      },
    });
    prepareWarmActivation(deps);
    deps.workerService.inspectContainerWorkerById.mockResolvedValueOnce(
      buildActivatedWarmContainerInspection()
    );
    const sleep = mockHandlerSleep(deps.handler);

    await expect(
      deps.handler.activateWarmWorker({
        warm_pool_id: 'warm-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
      })
    ).resolves.toEqual(
      expect.objectContaining({ claimed: false, error: 'confirmed_cleanup' })
    );

    expect(
      deps.workerBaileysGrpcClientService.runtimeHealth
    ).toHaveBeenCalledTimes(30);
    expect(sleep).toHaveBeenCalledTimes(29);
    expect(deps.workerWarmPoolRepository.markAssigned).not.toHaveBeenCalled();
    expect(deps.workerService.updateWorkerById).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.finalizeFailedActivationCleanup
    ).toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.failActivatingActivation
    ).not.toHaveBeenCalled();
  });

  it('fails closed on uncertain Docker inspection without rejecting or mutating the reservation', async () => {
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(),
    });
    prepareWarmActivation(deps);
    deps.workerService.inspectContainerWorkerByIdStrict.mockRejectedValueOnce(
      new Error('docker daemon unavailable')
    );

    await expect(
      deps.handler.activateWarmWorker({
        warm_pool_id: 'warm-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
      })
    ).rejects.toThrow('docker daemon unavailable');

    expect(
      deps.workerWarmPoolRepository.rejectActivation
    ).not.toHaveBeenCalled();
    expect(deps.workerService.renameContainer).not.toHaveBeenCalled();
    expect(deps.workerWarmPoolRepository.markAssigned).not.toHaveBeenCalled();
  });

  it('restores an intact standby when activation fails before reserving a runtime generation', async () => {
    const runtimeRepository = buildSelfHealRuntimeRepository();
    const deps = buildHandler({ workerRuntimeRepository: runtimeRepository });
    prepareWarmActivation(deps);
    const source = buildWarmContainerInspection({
      container_id: 'warm-container-id',
      container_name: 'warm-warm-1',
      container_labels: {
        ...buildWarmContainerInspection().container_labels,
        'underchat.warm_pool_id': 'warm-1',
        'underchat.session_volume_name': 'warm-warm-1',
      },
      container_env: {
        ...buildWarmContainerInspection().container_env,
        WARM_POOL_ID: 'warm-1',
        SESSION_VOLUME_NAME: 'warm-warm-1',
      },
    });
    deps.workerService.inspectContainerWorkerByIdStrict.mockImplementation(
      async (containerId: string) =>
        containerId === 'warm-container-id' || containerId === 'warm-warm-1'
          ? source
          : buildWorkerContainerInspection({
              exists: false,
              container_name: containerId,
              running: false,
            })
    );
    runtimeRepository.reserveNextRuntimeGeneration.mockRejectedValueOnce(
      new Error('runtime generation database unavailable')
    );

    await expect(
      deps.handler.activateWarmWorker({
        warm_pool_id: 'warm-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
      })
    ).resolves.toEqual(
      expect.objectContaining({ claimed: false, error: 'confirmed_cleanup' })
    );

    expect(deps.workerWarmPoolRepository.beginActivation).toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.restorePreGenerationActivationToReady
    ).toHaveBeenCalledWith({
      warmPoolId: 'warm-1',
      serverId: 'server-1',
      workerTypeId: EWorkerType.baileys,
      reservedByWorkerId: 'worker-1',
      expectedSourceContainerId: 'warm-container-id',
      expectedSourceContainerName: 'warm-warm-1',
      sessionVolumeName: 'warm-warm-1',
    });
    expect(
      deps.workerService.removeContainerWorkerById
    ).not.toHaveBeenCalledWith('warm-container-id');
    expect(deps.workerService.removeVolumeByName).not.toHaveBeenCalledWith(
      'warm-warm-1'
    );
  });

  it('keeps an activating row fenced when a runtime already has warm lineage', async () => {
    const runtimeRepository = buildSelfHealRuntimeRepository();
    const deps = buildHandler({ workerRuntimeRepository: runtimeRepository });
    prepareWarmActivation(deps);
    const source = buildWarmContainerInspection({
      container_id: 'warm-container-id',
      container_name: 'warm-warm-1',
      container_labels: {
        ...buildWarmContainerInspection().container_labels,
        'underchat.warm_pool_id': 'warm-1',
        'underchat.session_volume_name': 'warm-warm-1',
      },
      container_env: {
        ...buildWarmContainerInspection().container_env,
        WARM_POOL_ID: 'warm-1',
        SESSION_VOLUME_NAME: 'warm-warm-1',
      },
    });
    deps.workerService.inspectContainerWorkerByIdStrict.mockImplementation(
      async (containerId: string) =>
        containerId === 'warm-container-id' || containerId === 'warm-warm-1'
          ? source
          : buildWorkerContainerInspection({
              exists: false,
              container_name: containerId,
              running: false,
            })
    );
    runtimeRepository.viewByWorkerIdConsistent.mockResolvedValue({
      worker_id: 'worker-1',
      container_id: null,
      container_name: 'worker-1',
      session_volume_name: 'warm-warm-1',
      runtime_generation: 5,
      connection_sequence: 0,
      warm_pool_id: 'warm-1',
    } as never);
    runtimeRepository.reserveNextRuntimeGeneration.mockRejectedValueOnce(
      new Error('runtime generation database unavailable')
    );

    await expect(
      deps.handler.activateWarmWorker({
        warm_pool_id: 'warm-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
      })
    ).rejects.toThrow('runtime generation database unavailable');

    expect(
      deps.workerWarmPoolRepository.restorePreGenerationActivationToReady
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.failActivatingActivation
    ).not.toHaveBeenCalled();
    expect(
      deps.workerService.removeContainerWorkerById
    ).not.toHaveBeenCalledWith('warm-container-id');
    expect(deps.workerService.removeVolumeByName).not.toHaveBeenCalledWith(
      'warm-warm-1'
    );
  });

  it('finishes an assigned runtime after the worker update response is lost', async () => {
    const runtimeRepository = buildSelfHealRuntimeRepository();
    const deps = buildHandler({
      workerRuntimeRepository: runtimeRepository,
      runtimeHealthResponse: { runtime_generation: 5 },
    });
    prepareWarmActivation(deps);
    deps.workerService.inspectContainerWorkerById.mockResolvedValueOnce(
      buildActivatedWarmContainerInspection()
    );
    runtimeRepository.viewByWorkerIdConsistent.mockResolvedValue({
      worker_id: 'worker-1',
      container_id: 'replacement-container-id',
      container_name: 'worker-1',
      session_volume_name: 'warm-warm-1',
      runtime_generation: 5,
      connection_sequence: 0,
      warm_pool_id: 'warm-1',
    } as never);
    let currentWarm =
      await deps.workerWarmPoolRepository.viewByIdConsistent('warm-1');
    deps.workerWarmPoolRepository.viewByIdConsistent.mockImplementation(
      async () => currentWarm
    );
    deps.workerWarmPoolRepository.markAssigned.mockImplementation(
      async (input) => {
        currentWarm = {
          ...currentWarm,
          state: EWorkerWarmPoolState.assigned,
          container_id: input.assignedContainerId,
          container_name: input.assignedContainerName,
        };
        return true;
      }
    );
    deps.workerService.updateWorkerById.mockRejectedValueOnce(
      new Error('database connection reset after update')
    );
    const order: string[] = [];
    deps.workerService.removeContainerWorkerById.mockImplementation(
      async (containerId: string) => {
        if (containerId === 'replacement-container-id') {
          order.push('container');
        }
        return true;
      }
    );
    deps.workerService.removeVolumeByName.mockImplementation(async () => {
      order.push('volume');
      return true;
    });
    runtimeRepository.tombstoneWarmActivationIfMatches.mockImplementation(
      async () => {
        order.push('tombstone');
        return true;
      }
    );
    deps.workerWarmPoolRepository.revertAssignedActivation.mockImplementation(
      async () => {
        order.push('revert');
        return true;
      }
    );

    await expect(
      deps.handler.activateWarmWorker({
        warm_pool_id: 'warm-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
      })
    ).resolves.toEqual(expect.objectContaining({ claimed: true }));

    expect(
      deps.workerWarmPoolRepository.finalizeFailedActivationCleanup
    ).not.toHaveBeenCalled();
    expect(order).toEqual([]);
  });

  it('does not destructively clean an assigned runtime after an ambiguous worker update', async () => {
    const runtimeRepository = buildSelfHealRuntimeRepository();
    const deps = buildHandler({
      workerRuntimeRepository: runtimeRepository,
      runtimeHealthResponse: { runtime_generation: 5 },
    });
    prepareWarmActivation(deps);
    deps.workerService.inspectContainerWorkerById.mockResolvedValueOnce(
      buildActivatedWarmContainerInspection()
    );
    const assignedWarm = {
      warm_pool_id: 'warm-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      container_id: 'replacement-container-id',
      container_name: 'worker-1',
      session_volume_name: 'warm-warm-1',
      state: EWorkerWarmPoolState.assigned,
      reserved_by_worker_id: 'worker-1',
      reservation_expires_at: null,
    };
    deps.workerWarmPoolRepository.markAssigned.mockResolvedValue(true);
    deps.workerWarmPoolRepository.viewByIdConsistent
      .mockResolvedValueOnce({
        ...assignedWarm,
        state: EWorkerWarmPoolState.reserved,
        container_id: 'warm-container-id',
        container_name: 'warm-warm-1',
      })
      .mockResolvedValue(assignedWarm);
    runtimeRepository.viewByWorkerIdConsistent.mockResolvedValue({
      worker_id: 'worker-1',
      container_id: 'replacement-container-id',
      container_name: 'worker-1',
      session_volume_name: 'warm-warm-1',
      runtime_generation: 5,
      connection_sequence: 0,
      warm_pool_id: 'warm-1',
    } as never);
    deps.workerService.updateWorkerById.mockRejectedValueOnce(
      new Error('worker update failed')
    );
    deps.workerService.removeContainerWorkerById.mockImplementation(
      async (containerId: string) => {
        if (containerId === 'replacement-container-id') {
          throw new Error('docker daemon unavailable');
        }
        return true;
      }
    );

    await expect(
      deps.handler.activateWarmWorker({
        warm_pool_id: 'warm-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
      })
    ).resolves.toEqual(expect.objectContaining({ claimed: true }));

    expect(
      deps.workerWarmPoolRepository.finalizeFailedActivationCleanup
    ).not.toHaveBeenCalled();
    expect(
      runtimeRepository.tombstoneWarmActivationIfMatches
    ).not.toHaveBeenCalled();
    expect(
      runtimeRepository.clearWarmPoolReferenceIfMatches
    ).not.toHaveBeenCalled();
    expect(deps.workerService.removeVolumeByName).not.toHaveBeenCalled();
  });

  it('returns an already assigned exact runtime idempotently after a lost response', async () => {
    const runtimeRepository = buildSelfHealRuntimeRepository();
    runtimeRepository.viewByWorkerIdConsistent.mockResolvedValue({
      worker_id: 'worker-1',
      container_id: 'replacement-container-id',
      container_name: 'worker-1',
      session_volume_name: 'warm-warm-1',
      runtime_generation: 5,
      connection_sequence: 0,
      warm_pool_id: 'warm-1',
    } as never);
    const deps = buildHandler({
      workerRuntimeRepository: runtimeRepository,
      runtimeHealthResponse: { runtime_generation: 5 },
    });
    deps.workerWarmPoolRepository.viewByIdConsistent.mockResolvedValue({
      warm_pool_id: 'warm-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      container_id: 'replacement-container-id',
      container_name: 'worker-1',
      session_volume_name: 'warm-warm-1',
      state: EWorkerWarmPoolState.assigned,
      reserved_by_worker_id: 'worker-1',
      reservation_expires_at: null,
    });
    deps.workerService.viewWorkerForMonitor.mockResolvedValue({
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.disponible,
      worker_type_id: EWorkerType.baileys,
      container_id: 'replacement-container-id',
      lifecycle_operation_id: null,
    });
    deps.workerService.inspectContainerWorkerById.mockResolvedValueOnce(
      buildActivatedWarmContainerInspection()
    );

    await expect(
      deps.handler.activateWarmWorker({
        warm_pool_id: 'warm-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
      })
    ).resolves.toEqual(
      expect.objectContaining({
        claimed: true,
        container_id: 'replacement-container-id',
      })
    );

    expect(
      deps.workerWarmPoolRepository.beginActivation
    ).not.toHaveBeenCalled();
    expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();
    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
  });

  it('finishes the worker row after a crash between assigned CAS and worker update', async () => {
    const runtimeRepository = buildSelfHealRuntimeRepository();
    runtimeRepository.viewByWorkerIdConsistent.mockResolvedValue({
      worker_id: 'worker-1',
      container_id: 'replacement-container-id',
      container_name: 'worker-1',
      session_volume_name: 'warm-warm-1',
      runtime_generation: 5,
      connection_sequence: 0,
      warm_pool_id: 'warm-1',
    } as never);
    const deps = buildHandler({
      workerRuntimeRepository: runtimeRepository,
      runtimeHealthResponse: { runtime_generation: 5 },
    });
    deps.workerWarmPoolRepository.viewByIdConsistent.mockResolvedValue({
      warm_pool_id: 'warm-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      container_id: 'replacement-container-id',
      container_name: 'worker-1',
      session_volume_name: 'warm-warm-1',
      state: EWorkerWarmPoolState.assigned,
      reserved_by_worker_id: 'worker-1',
      reservation_expires_at: null,
    });
    deps.workerService.viewWorkerForMonitor.mockResolvedValue({
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.creating,
      worker_type_id: EWorkerType.baileys,
      container_id: null,
      lifecycle_operation_id: 'operation-1',
    });
    deps.workerService.inspectContainerWorkerById.mockResolvedValueOnce(
      buildActivatedWarmContainerInspection()
    );

    await expect(
      deps.handler.activateWarmWorker({
        warm_pool_id: 'warm-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        lifecycle_operation_id: 'operation-1',
      })
    ).resolves.toEqual(expect.objectContaining({ claimed: true }));

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        container_id: 'replacement-container-id',
        worker_status_id: EWorkerStatus.disponible,
        lifecycle_operation_id: null,
      }),
      {
        lifecycle_operation_id: 'operation-1',
        container_id: null,
        runtime_container_id: 'replacement-container-id',
        runtime_generation: 5,
        server_id: 'server-1',
        worker_status_id: EWorkerStatus.creating,
        worker_type_id: EWorkerType.baileys,
      }
    );
    expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();
  });

  it('resumes an activating exact target without deleting it or reserving another generation', async () => {
    const runtimeRepository = buildSelfHealRuntimeRepository();
    runtimeRepository.viewByWorkerIdConsistent.mockResolvedValue({
      worker_id: 'worker-1',
      container_id: 'replacement-container-id',
      container_name: 'worker-1',
      session_volume_name: 'warm-warm-1',
      runtime_generation: 5,
      connection_sequence: 0,
      warm_pool_id: 'warm-1',
    } as never);
    const deps = buildHandler({
      workerRuntimeRepository: runtimeRepository,
      runtimeHealthResponse: { runtime_generation: 5 },
    });
    deps.workerWarmPoolRepository.viewByIdConsistent.mockResolvedValue({
      warm_pool_id: 'warm-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      container_id: 'warm-container-id',
      container_name: 'warm-warm-1',
      session_volume_name: 'warm-warm-1',
      state: EWorkerWarmPoolState.activating,
      reserved_by_worker_id: 'worker-1',
      reservation_expires_at: null,
    });
    deps.workerService.viewWorkerForMonitor.mockResolvedValue({
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.creating,
      worker_type_id: EWorkerType.baileys,
      container_id: null,
      lifecycle_operation_id: null,
    });
    deps.workerService.inspectContainerWorkerById.mockImplementation(
      async (containerId: string) =>
        containerId === 'worker-1' || containerId === 'replacement-container-id'
          ? buildActivatedWarmContainerInspection()
          : buildWarmContainerInspection({
              exists: false,
              container_name: containerId,
              running: false,
            })
    );

    await expect(
      deps.handler.activateWarmWorker({
        warm_pool_id: 'warm-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
      })
    ).resolves.toEqual(expect.objectContaining({ claimed: true }));

    expect(
      runtimeRepository.reserveNextRuntimeGeneration
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.beginActivation
    ).not.toHaveBeenCalled();
    expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();
    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
  });

  it('rejects a direct warm activation reset before any durable or Docker mutation', async () => {
    const runtimeRepository = buildSelfHealRuntimeRepository();
    runtimeRepository.viewByWorkerIdConsistent.mockResolvedValue({
      worker_id: 'worker-1',
      container_id: 'old-container-id',
      container_name: 'worker-1',
      session_volume_name: 'old-volume',
      runtime_generation: 7,
      connection_sequence: 0,
      warm_pool_id: null,
    } as never);
    const deps = buildHandler({ workerRuntimeRepository: runtimeRepository });
    deps.workerService.viewWorkerForMonitor.mockResolvedValue({
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.creating,
      worker_type_id: EWorkerType.baileys,
      session_storage: EWorkerSessionStorage.legacy_volume,
      deleted_at: null,
      container_id: 'old-container-id',
      lifecycle_operation_id: null,
    });
    deps.workerWarmPoolRepository.viewByIdConsistent.mockResolvedValue({
      warm_pool_id: 'warm-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      container_id: 'warm-container-id',
      container_name: 'warm-warm-1',
      session_volume_name: 'warm-warm-1',
      state: EWorkerWarmPoolState.reserved,
      reserved_by_worker_id: 'worker-1',
      reservation_expires_at: '2999-01-01T00:00:00.000Z',
    });

    await expect(
      deps.handler.activateWarmWorker({
        warm_pool_id: 'warm-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
      })
    ).rejects.toThrow('warm_worker_existing_runtime_reset_not_authorized');

    expect(
      deps.workerWarmPoolRepository.extendActivationReservation
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.beginActivation
    ).not.toHaveBeenCalled();
    expect(
      runtimeRepository.reserveNextRuntimeGeneration
    ).not.toHaveBeenCalled();
    expect(runtimeRepository.upsert).not.toHaveBeenCalled();
    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
    expect(deps.workerService.removeVolumeByName).not.toHaveBeenCalled();
    expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();
  });

  it('rejects an unfenced provider switch before acquiring locks or mutating Docker', async () => {
    const deps = buildHandler();

    await expect(
      deps.handler.activateWarmWorker({
        warm_pool_id: 'warm-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        previous_worker_type_id: EWorkerType.whatsmeow,
        remove_session: true,
        remove_volume: true,
      })
    ).rejects.toThrow('worker_type_change_requires_postgres_session');

    expect(deps.workerLifecycleLockService.withLock).not.toHaveBeenCalled();
    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
    expect(deps.workerService.removeVolumeByName).not.toHaveBeenCalled();
    expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();
  });

  it('reserves above a durable fence left by the previous provider', async () => {
    const runtimeRepository = buildSelfHealRuntimeRepository(3);
    runtimeRepository.reserveNextRuntimeGeneration.mockResolvedValue(90);
    const deps = buildHandler({ workerRuntimeRepository: runtimeRepository });
    deps.redisStore.set(
      'whatsapp:runtime-fence:v1:worker-1',
      JSON.stringify({
        state: 'active',
        worker_id: 'worker-1',
        runtime_generation: 89,
        connection_epoch: 'old-baileys-epoch',
        connection_sequence: 33,
        source_provider: 'baileys',
        activated_at: Date.now(),
        activation_order: 33,
      })
    );

    const reserve = (
      deps.handler as unknown as {
        reserveNextWorkerRuntimeGeneration: (
          data: IWorkerPayload,
          volume: string
        ) => Promise<number>;
      }
    ).reserveNextWorkerRuntimeGeneration.bind(deps.handler);

    await expect(
      reserve(
        {
          action: EWorkerAction.recreate,
          worker_id: 'worker-1',
          account_id: 'account-1',
          server_id: 'server-1',
          worker_type_id: EWorkerType.whatsmeow,
          session_storage: EWorkerSessionStorage.legacy_volume,
        },
        'worker-volume-1'
      )
    ).resolves.toBe(90);

    expect(runtimeRepository.reserveNextRuntimeGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_id: 'worker-1',
        minimum_runtime_generation: 90,
      })
    );
  });

  it('fails closed when the existing runtime provider diverges from the fenced previous provider', async () => {
    const runtimeRepository = buildSelfHealRuntimeRepository(
      7,
      'container-old'
    );
    (runtimeRepository.viewByWorkerIdConsistent as jest.Mock).mockResolvedValue(
      {
        worker_id: 'worker-1',
        container_id: 'container-old',
        container_name: 'worker-1',
        session_volume_name: 'old-volume',
        runtime_generation: 7,
        connection_sequence: 0,
        warm_pool_id: null,
      }
    );
    const deps = buildHandler({ workerRuntimeRepository: runtimeRepository });
    deps.workerWarmPoolRepository.viewByIdConsistent.mockResolvedValue({
      warm_pool_id: 'warm-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      container_id: 'warm-container-id',
      container_name: 'warm-warm-1',
      session_volume_name: 'warm-warm-1',
      state: EWorkerWarmPoolState.reserved,
      reserved_by_worker_id: 'worker-1',
      reservation_expires_at: '2999-01-01T00:00:00.000Z',
    });
    deps.workerService.viewWorkerForMonitor.mockResolvedValue({
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.creating,
      worker_type_id: EWorkerType.baileys,
      deleted_at: null,
      container_id: 'container-old',
      lifecycle_operation_id: 'operation-1',
    });
    deps.workerService.inspectContainerWorkerById.mockImplementation(
      async (containerId: string) => {
        if (
          containerId === 'warm-warm-1' ||
          containerId === 'warm-container-id'
        ) {
          const warm = buildWarmContainerInspection();
          return buildWarmContainerInspection({
            container_name: 'warm-warm-1',
            container_labels: {
              ...warm.container_labels,
              'underchat.warm_pool_id': 'warm-1',
              'underchat.session_volume_name': 'warm-warm-1',
            },
            container_env: {
              ...warm.container_env,
              WARM_POOL_ID: 'warm-1',
              SESSION_VOLUME_NAME: 'warm-warm-1',
            },
          });
        }
        return buildWorkerContainerInspection({
          container_id: 'container-old',
          container_name: 'worker-1',
          container_image: 'under-worker-wwebjs:latest',
          container_labels: {
            'underchat.worker_id': 'worker-1',
            'underchat.account_id': 'account-1',
            'underchat.server_id': 'server-1',
            'underchat.worker_type_id': EWorkerType.wwebjs,
            'underchat.worker_image': 'under-worker-wwebjs:latest',
            'underchat.worker_grpc_port': '50053',
            'underchat.session_volume_name': 'old-volume',
            'underchat.runtime_generation': '7',
          },
          container_env: {
            WORKER_ID: 'worker-1',
            ACCOUNT_ID: 'account-1',
            WORKER_TYPE_ID: EWorkerType.wwebjs,
            WORKER_IMAGE: 'under-worker-wwebjs:latest',
            WORKER_GRPC_PORT: '50053',
            SESSION_VOLUME_NAME: 'old-volume',
            RUNTIME_GENERATION: '7',
          },
        });
      }
    );

    await expect(
      deps.handler.activateWarmWorker({
        warm_pool_id: 'warm-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        previous_worker_type_id: EWorkerType.whatsmeow,
        session_storage: EWorkerSessionStorage.legacy_volume,
        remove_session: true,
        remove_volume: true,
        lifecycle_operation_id: 'operation-1',
      })
    ).rejects.toThrow('worker_type_change_requires_postgres_session');

    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
    expect(deps.workerService.removeVolumeByName).not.toHaveBeenCalled();
    expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();
    expect(
      runtimeRepository.reserveNextRuntimeGeneration
    ).not.toHaveBeenCalled();
  });

  it('replaces a legacy renamed target after cutover and advances its runtime fence', async () => {
    let runtime = {
      worker_id: 'worker-1',
      container_id: 'warm-container-id' as string | null,
      container_name: 'worker-1',
      session_volume_name: 'warm-warm-1',
      runtime_generation: 5,
      connection_sequence: 0,
      warm_pool_id: 'warm-1',
    };
    const runtimeRepository = buildSelfHealRuntimeRepository();
    (
      runtimeRepository.viewByWorkerIdConsistent as jest.Mock
    ).mockImplementation(async () => ({ ...runtime }));
    runtimeRepository.reserveNextRuntimeGeneration.mockImplementation(
      async () => {
        runtime = {
          ...runtime,
          container_id: null,
          runtime_generation: 6,
        };
        return 6;
      }
    );
    (runtimeRepository.upsert as jest.Mock).mockImplementation(
      async (input: Record<string, unknown>) => {
        runtime = { ...runtime, ...input } as typeof runtime;
        return runtime;
      }
    );
    const deps = buildHandler({
      workerRuntimeRepository: runtimeRepository,
      runtimeHealthResponse: { runtime_generation: 6 },
    });
    mockHandlerSleep(deps.handler);
    deps.workerWarmPoolRepository.viewByIdConsistent.mockResolvedValue({
      warm_pool_id: 'warm-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      container_id: 'warm-container-id',
      container_name: 'warm-warm-1',
      session_volume_name: 'warm-warm-1',
      state: EWorkerWarmPoolState.activating,
      reserved_by_worker_id: 'worker-1',
      reservation_expires_at: null,
    });
    deps.workerService.viewWorkerForMonitor.mockResolvedValue({
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.creating,
      worker_type_id: EWorkerType.baileys,
      deleted_at: null,
      container_id: 'warm-container-id',
      lifecycle_operation_id: null,
    });
    let legacyExists = true;
    let modernExists = false;
    deps.workerService.inspectContainerWorkerById.mockImplementation(
      async (containerId: string) => {
        if (
          legacyExists &&
          (containerId === 'worker-1' || containerId === 'warm-container-id')
        ) {
          return buildLegacyRenamedWarmContainerInspection();
        }
        if (
          modernExists &&
          (containerId === 'worker-1' ||
            containerId === 'replacement-container-id')
        ) {
          return buildActivatedWarmContainerInspection({
            container_labels: {
              ...buildActivatedWarmContainerInspection().container_labels,
              'underchat.runtime_generation': '6',
            },
            container_env: {
              ...buildActivatedWarmContainerInspection().container_env,
              RUNTIME_GENERATION: '6',
            },
          });
        }
        return buildWorkerContainerInspection({
          exists: false,
          container_name: containerId,
          running: false,
        });
      }
    );
    deps.workerService.removeContainerWorkerById.mockImplementation(
      async (containerId: string) => {
        if (containerId === 'warm-container-id') legacyExists = false;
        return true;
      }
    );
    deps.workerService.createContainerWorker.mockImplementation(async () => {
      modernExists = true;
      return 'replacement-container-id';
    });

    await expect(
      deps.handler.activateWarmWorker({
        warm_pool_id: 'warm-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
      })
    ).resolves.toEqual(expect.objectContaining({ claimed: true }));

    expect(deps.workerService.removeContainerWorkerById).toHaveBeenCalledWith(
      'warm-container-id'
    );
    expect(runtimeRepository.reserveNextRuntimeGeneration).toHaveBeenCalled();
    expect(deps.workerService.createContainerWorker).toHaveBeenCalledWith(
      expect.any(String),
      'worker-1',
      'account-1',
      false,
      expect.any(String),
      expect.any(Number),
      undefined,
      expect.objectContaining({ runtimeGeneration: 6 }),
      'warm-warm-1',
      expect.objectContaining({ requireExistingVolume: true })
    );
    expect(deps.workerService.removeVolumeByName).not.toHaveBeenCalled();
  });

  it('resumes after the warm source was removed before target creation', async () => {
    let runtime = {
      worker_id: 'worker-1',
      container_id: null as string | null,
      container_name: 'worker-1',
      session_volume_name: 'warm-warm-1',
      runtime_generation: 5,
      connection_sequence: 0,
      warm_pool_id: 'warm-1',
    };
    const runtimeRepository = buildSelfHealRuntimeRepository();
    (
      runtimeRepository.viewByWorkerIdConsistent as jest.Mock
    ).mockImplementation(async () => ({ ...runtime }));
    runtimeRepository.reserveNextRuntimeGeneration.mockImplementation(
      async () => {
        runtime = { ...runtime, runtime_generation: 6 };
        return 6;
      }
    );
    (runtimeRepository.upsert as jest.Mock).mockImplementation(
      async (input: Record<string, unknown>) => {
        runtime = { ...runtime, ...input } as typeof runtime;
        return runtime;
      }
    );
    const deps = buildHandler({
      workerRuntimeRepository: runtimeRepository,
      runtimeHealthResponse: { runtime_generation: 6 },
    });
    deps.workerWarmPoolRepository.viewByIdConsistent.mockResolvedValue({
      warm_pool_id: 'warm-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      container_id: 'warm-container-id',
      container_name: 'warm-warm-1',
      session_volume_name: 'warm-warm-1',
      state: EWorkerWarmPoolState.activating,
      reserved_by_worker_id: 'worker-1',
      reservation_expires_at: null,
    });
    deps.workerService.viewWorkerForMonitor.mockResolvedValue({
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.creating,
      worker_type_id: EWorkerType.baileys,
      deleted_at: null,
      container_id: null,
      lifecycle_operation_id: null,
    });
    let modernExists = false;
    deps.workerService.inspectContainerWorkerById.mockImplementation(
      async (containerId: string) =>
        modernExists &&
        (containerId === 'worker-1' ||
          containerId === 'replacement-container-id')
          ? buildActivatedWarmContainerInspection({
              container_labels: {
                ...buildActivatedWarmContainerInspection().container_labels,
                'underchat.runtime_generation': '6',
              },
              container_env: {
                ...buildActivatedWarmContainerInspection().container_env,
                RUNTIME_GENERATION: '6',
              },
            })
          : buildWorkerContainerInspection({
              exists: false,
              container_name: containerId,
              running: false,
            })
    );
    deps.workerService.createContainerWorker.mockImplementation(async () => {
      modernExists = true;
      return 'replacement-container-id';
    });

    await expect(
      deps.handler.activateWarmWorker({
        warm_pool_id: 'warm-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
      })
    ).resolves.toEqual(expect.objectContaining({ claimed: true }));

    expect(
      deps.workerWarmPoolRepository.beginActivation
    ).not.toHaveBeenCalled();
    expect(runtimeRepository.reserveNextRuntimeGeneration).toHaveBeenCalled();
    expect(deps.workerService.createContainerWorker).toHaveBeenCalledWith(
      expect.any(String),
      'worker-1',
      'account-1',
      false,
      expect.any(String),
      expect.any(Number),
      undefined,
      expect.objectContaining({ runtimeGeneration: 6 }),
      'warm-warm-1',
      expect.objectContaining({ requireExistingVolume: true })
    );
    expect(deps.workerService.removeVolumeByName).not.toHaveBeenCalled();
  });

  it('keeps an online worker online when an activating runtime is fully connected', async () => {
    const runtimeRepository = buildOnlineWarmActivationRuntimeRepository();
    const deps = buildHandler({
      workerRuntimeRepository: runtimeRepository,
      runtimeHealthResponse: {
        runtime_generation: 5,
        authenticated: true,
        session_ready: true,
        can_send: true,
        can_receive_runtime: true,
        kafka_unhealthy: false,
        kafka_consumers_ready: true,
        qr_stream_ready: false,
      },
    });
    prepareOnlineWarmActivationResume(deps);

    await expect(
      deps.handler.activateWarmWorker({
        warm_pool_id: 'warm-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        lifecycle_operation_id: 'operation-1',
      })
    ).resolves.toEqual(expect.objectContaining({ claimed: true }));

    expect(deps.workerWarmPoolRepository.markAssigned).toHaveBeenCalled();
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'account-1',
      {
        worker_id: 'worker-1',
        container_id: 'replacement-container-id',
        lifecycle_operation_id: null,
      },
      expect.objectContaining({
        lifecycle_operation_id: 'operation-1',
        container_id: 'old-container-id',
        runtime_container_id: 'replacement-container-id',
        runtime_generation: 5,
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.online,
      })
    );
  });

  it('normalizes an online QR-only activating runtime to disponible', async () => {
    const runtimeRepository = buildOnlineWarmActivationRuntimeRepository();
    const deps = buildHandler({
      workerRuntimeRepository: runtimeRepository,
      runtimeHealthResponse: { runtime_generation: 5 },
    });
    prepareOnlineWarmActivationResume(deps);
    mockHandlerSleep(deps.handler);

    await expect(
      deps.handler.activateWarmWorker({
        warm_pool_id: 'warm-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        lifecycle_operation_id: 'operation-1',
      })
    ).resolves.toEqual(expect.objectContaining({ claimed: true }));

    expect(deps.workerWarmPoolRepository.markAssigned).toHaveBeenCalled();
    expect(
      deps.workerBaileysGrpcClientService.runtimeHealth
    ).toHaveBeenCalledTimes(3);
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'account-1',
      {
        worker_id: 'worker-1',
        container_id: 'replacement-container-id',
        worker_status_id: EWorkerStatus.disponible,
        lifecycle_operation_id: null,
        number: null,
        connection_date: null,
      },
      expect.objectContaining({
        lifecycle_operation_id: 'operation-1',
        container_id: 'old-container-id',
        runtime_container_id: 'replacement-container-id',
        runtime_generation: 5,
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.online,
      })
    );
  });

  it('preserves online when a transient QR-only probe becomes connected', async () => {
    const runtimeRepository = buildOnlineWarmActivationRuntimeRepository();
    const deps = buildHandler({ workerRuntimeRepository: runtimeRepository });
    prepareOnlineWarmActivationResume(deps);
    mockHandlerSleep(deps.handler);
    deps.workerBaileysGrpcClientService.runtimeHealth
      .mockResolvedValueOnce(
        buildActivatedWarmRuntimeHealth({ runtime_generation: 5 })
      )
      .mockResolvedValue(
        buildActivatedWarmRuntimeHealth({
          runtime_generation: 5,
          authenticated: true,
          session_ready: true,
          can_send: true,
          can_receive_runtime: true,
          kafka_unhealthy: false,
          kafka_consumers_ready: true,
          qr_stream_ready: false,
        })
      );

    await expect(
      deps.handler.activateWarmWorker({
        warm_pool_id: 'warm-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        lifecycle_operation_id: 'operation-1',
      })
    ).resolves.toEqual(expect.objectContaining({ claimed: true }));

    expect(
      deps.workerBaileysGrpcClientService.runtimeHealth
    ).toHaveBeenCalledTimes(2);
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'account-1',
      {
        worker_id: 'worker-1',
        container_id: 'replacement-container-id',
        lifecycle_operation_id: null,
      },
      expect.objectContaining({
        lifecycle_operation_id: 'operation-1',
        worker_status_id: EWorkerStatus.online,
      })
    );
  });

  it('restores provisioning when an online stability recheck loses transport', async () => {
    const runtimeRepository = buildOnlineWarmActivationRuntimeRepository();
    const deps = buildHandler({ workerRuntimeRepository: runtimeRepository });
    prepareOnlineWarmActivationResume(deps);
    mockHandlerSleep(deps.handler);
    deps.workerBaileysGrpcClientService.runtimeHealth
      .mockResolvedValueOnce(
        buildActivatedWarmRuntimeHealth({ runtime_generation: 5 })
      )
      .mockRejectedValueOnce(new Error('grpc transport unavailable'));

    await expect(
      deps.handler.activateWarmWorker({
        warm_pool_id: 'warm-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        lifecycle_operation_id: 'operation-1',
      })
    ).rejects.toThrow('grpc transport unavailable');

    expect(deps.workerWarmPoolRepository.markAssigned).not.toHaveBeenCalled();
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'account-1',
      {
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.recreating,
      },
      expect.objectContaining({
        lifecycle_operation_id: 'operation-1',
        worker_status_id: EWorkerStatus.online,
      })
    );
  });

  it('redelivers a restored same-target warm recreate through its exact marker and tombstone', async () => {
    const runtimeRepository = buildOnlineWarmActivationRuntimeRepository();
    const deps = buildHandler({ workerRuntimeRepository: runtimeRepository });
    prepareOnlineWarmActivationResume(deps);
    mockHandlerSleep(deps.handler);
    const currentWorker = {
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.online,
      worker_type_id: EWorkerType.baileys,
      session_storage: EWorkerSessionStorage.legacy_volume,
      deleted_at: null,
      container_id: 'replacement-container-id',
      runtime_container_id: 'replacement-container-id',
      runtime_generation: 5,
      lifecycle_operation_id: 'operation-1',
    };
    const currentState = emulatePersistedRecreateCompletion(
      deps,
      currentWorker
    );
    deps.workerBaileysGrpcClientService.runtimeHealth
      .mockResolvedValueOnce(
        buildActivatedWarmRuntimeHealth({ runtime_generation: 5 })
      )
      .mockRejectedValueOnce(new Error('grpc transport unavailable'))
      .mockResolvedValue(
        buildActivatedWarmRuntimeHealth({
          runtime_generation: 5,
          authenticated: true,
          session_ready: true,
          can_send: true,
          can_receive_runtime: true,
          qr_stream_ready: false,
        })
      );
    const payload = {
      warm_pool_id: 'warm-1',
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      previous_worker_type_id: EWorkerType.baileys,
      session_storage: EWorkerSessionStorage.legacy_volume,
      lifecycle_operation_id: 'operation-1',
    };

    await expect(deps.handler.activateWarmWorker(payload)).rejects.toThrow(
      'grpc transport unavailable'
    );
    expect(currentState()).toEqual(
      expect.objectContaining({
        worker_status_id: EWorkerStatus.recreating,
        container_id: 'replacement-container-id',
        lifecycle_operation_id: 'operation-1',
      })
    );

    await expect(deps.handler.activateWarmWorker(payload)).resolves.toEqual(
      expect.objectContaining({
        claimed: true,
        container_id: 'replacement-container-id',
      })
    );

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenLastCalledWith(
      'account-1',
      expect.objectContaining({
        container_id: 'replacement-container-id',
        lifecycle_operation_id: null,
      }),
      expect.objectContaining({
        lifecycle_operation_id: 'operation-1',
        container_id: 'replacement-container-id',
        runtime_container_id: 'replacement-container-id',
        runtime_generation: 5,
        worker_status_id: EWorkerStatus.recreating,
        recreate_completion: {
          operation_id: 'operation-1',
          runtime_generation: 5,
          mode: 'replacement_runtime_already_online',
        },
      })
    );
    expect(currentState()).toEqual(
      expect.objectContaining({
        lifecycle_operation_id: null,
        recreate_completed_operation_id: 'operation-1',
        recreate_completed_runtime_generation: 5,
        recreate_completed_at: '2026-08-08T00:00:00.000Z',
      })
    );
    expect(
      runtimeRepository.markRecreateBootstrapStarted
    ).toHaveBeenCalledTimes(2);
    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
    expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();
  });

  it('restores provisioning when an online activating runtime is unhealthy', async () => {
    const runtimeRepository = buildOnlineWarmActivationRuntimeRepository();
    const deps = buildHandler({
      workerRuntimeRepository: runtimeRepository,
      runtimeHealthResponse: {
        runtime_generation: 5,
        authenticated: false,
        session_ready: false,
        qr_stream_ready: false,
      },
    });
    prepareOnlineWarmActivationResume(deps);
    mockHandlerSleep(deps.handler);

    await expect(
      deps.handler.activateWarmWorker({
        warm_pool_id: 'warm-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        lifecycle_operation_id: 'operation-1',
      })
    ).rejects.toThrow(
      'warm_worker_activated_runtime_health_not_ready:qr_stream_not_ready'
    );

    expect(deps.workerWarmPoolRepository.markAssigned).not.toHaveBeenCalled();
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'account-1',
      {
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.recreating,
      },
      {
        lifecycle_operation_id: 'operation-1',
        container_id: 'old-container-id',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.online,
      }
    );
  });

  it('does not let a null lifecycle finalization overwrite a newly claimed operation', async () => {
    const runtimeRepository = buildSelfHealRuntimeRepository();
    const deps = buildHandler({ workerRuntimeRepository: runtimeRepository });
    prepareWarmActivation(deps);
    deps.workerService.inspectContainerWorkerById.mockResolvedValue(
      buildActivatedWarmContainerInspection()
    );
    let currentWorker = {
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.creating,
      worker_type_id: EWorkerType.baileys,
      deleted_at: null,
      container_id: null as string | null,
      lifecycle_operation_id: null as string | null,
    };
    deps.workerService.viewWorkerForMonitor.mockImplementation(async () => ({
      ...currentWorker,
    }));
    deps.workerService.updateWorkerByIdIfLifecycleMatches.mockImplementation(
      async () => {
        currentWorker = {
          ...currentWorker,
          worker_status_id: EWorkerStatus.recreating,
          lifecycle_operation_id: 'new-operation',
        };
        return false;
      }
    );

    await expect(
      deps.handler.activateWarmWorker({
        warm_pool_id: 'warm-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
      })
    ).rejects.toThrow('warm_worker_assigned_redelivery_worker_mismatch');

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenNthCalledWith(
      1,
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        container_id: 'replacement-container-id',
      }),
      expect.objectContaining({
        lifecycle_operation_id: null,
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.creating,
        runtime_container_id: 'replacement-container-id',
        runtime_generation: 5,
      })
    );
    expect(deps.workerService.updateWorkerById).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.claimFailedActivationCleanup
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        lifecycleOperationId: null,
        expectedWorkerStatusId: EWorkerStatus.creating,
      })
    );
    expect(
      deps.workerService.removeContainerWorkerById
    ).not.toHaveBeenCalledWith('replacement-container-id');
    expect(
      deps.workerService.removeFailedWarmActivationVolumeByProof
    ).not.toHaveBeenCalled();
    expect(currentWorker.lifecycle_operation_id).toBe('new-operation');
  });

  it('finalizes an assigned same-warm legacy container without replacing it', async () => {
    const runtimeRepository = buildAssignedLegacyWarmRuntimeRepository();
    const deps = buildHandler({
      workerRuntimeRepository: runtimeRepository,
      runtimeHealthResponse: { runtime_generation: 5 },
    });
    prepareAssignedLegacyWarmActivation(deps);

    await expect(
      deps.handler.activateWarmWorker({
        warm_pool_id: 'warm-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        lifecycle_operation_id: 'operation-1',
      })
    ).resolves.toEqual(
      expect.objectContaining({
        claimed: true,
        container_id: 'warm-container-id',
      })
    );

    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
    expect(deps.workerService.removeVolumeByName).not.toHaveBeenCalled();
    expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        container_id: 'warm-container-id',
        worker_status_id: EWorkerStatus.disponible,
        lifecycle_operation_id: null,
      }),
      expect.objectContaining({
        lifecycle_operation_id: 'operation-1',
        worker_status_id: EWorkerStatus.creating,
      })
    );
  });

  it('fails closed on assigned legacy container identity divergence', async () => {
    const runtimeRepository = buildAssignedLegacyWarmRuntimeRepository();
    const deps = buildHandler({ workerRuntimeRepository: runtimeRepository });
    const legacy = buildLegacyRenamedWarmContainerInspection();
    prepareAssignedLegacyWarmActivation(
      deps,
      buildLegacyRenamedWarmContainerInspection({
        container_labels: {
          ...legacy.container_labels,
          'underchat.server_id': 'other-server',
        },
      })
    );

    await expect(
      deps.handler.activateWarmWorker({
        warm_pool_id: 'warm-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        lifecycle_operation_id: 'operation-1',
      })
    ).rejects.toThrow(
      'warm_worker_legacy_assigned_container_mismatch:standby_identity'
    );

    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
    expect(deps.workerService.removeVolumeByName).not.toHaveBeenCalled();
    expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
  });

  it('rechecks and finalizes a markAssigned commit whose response was lost', async () => {
    const runtimeRepository = buildSelfHealRuntimeRepository();
    const deps = buildHandler({ workerRuntimeRepository: runtimeRepository });
    prepareWarmActivation(deps);
    const reserved = {
      warm_pool_id: 'warm-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      container_id: 'warm-container-id',
      container_name: 'warm-warm-1',
      session_volume_name: 'warm-warm-1',
      state: EWorkerWarmPoolState.reserved,
      reserved_by_worker_id: 'worker-1',
      reservation_expires_at: '2999-01-01T00:00:00.000Z',
    };
    deps.workerWarmPoolRepository.viewByIdConsistent
      .mockResolvedValueOnce(reserved)
      .mockResolvedValue({
        ...reserved,
        state: EWorkerWarmPoolState.assigned,
        container_id: 'replacement-container-id',
        container_name: 'worker-1',
        reservation_expires_at: null,
      });
    deps.workerWarmPoolRepository.markAssigned.mockRejectedValueOnce(
      new Error('database response lost after commit')
    );
    deps.workerService.inspectContainerWorkerById.mockResolvedValueOnce(
      buildActivatedWarmContainerInspection()
    );

    await expect(
      deps.handler.activateWarmWorker({
        warm_pool_id: 'warm-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
      })
    ).resolves.toEqual(expect.objectContaining({ claimed: true }));

    expect(
      deps.workerWarmPoolRepository.revertAssignedActivation
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.failActivatingActivation
    ).not.toHaveBeenCalled();
    expect(
      runtimeRepository.tombstoneWarmActivationIfMatches
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.finalizeFailedActivationCleanup
    ).not.toHaveBeenCalled();
  });

  it('aborts on proxy repository uncertainty before any Docker mutation', async () => {
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(),
    });
    prepareWarmActivation(deps);
    deps.workerConfigViewerRepository.fetchConfigValueByType.mockRejectedValueOnce(
      new Error('proxy repository unavailable')
    );

    await expect(
      deps.handler.activateWarmWorker({
        warm_pool_id: 'warm-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
      })
    ).rejects.toThrow('proxy repository unavailable');

    expect(
      deps.workerWarmPoolRepository.beginActivation
    ).not.toHaveBeenCalled();
    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
    expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();
  });

  it('preserves the exact channel proxy while replacing the warm container', async () => {
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(),
    });
    prepareWarmActivation(deps);
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
        { statusId: EWorkerConfigStatus.active, value: 'proxy-user' },
      ],
      [
        EWorkerConfigType.proxy_password,
        { statusId: EWorkerConfigStatus.active, value: 'proxy-password' },
      ],
    ]);
    deps.workerConfigViewerRepository.fetchConfigValueByType.mockImplementation(
      async (_workerId: string, type: EWorkerConfigType) =>
        proxyConfig.get(type) ?? { statusId: null, value: null }
    );
    const warmSource = buildWarmContainerInspection({
      container_name: 'warm-warm-1',
      container_labels: {
        ...buildWarmContainerInspection().container_labels,
        'underchat.warm_pool_id': 'warm-1',
        'underchat.session_volume_name': 'warm-warm-1',
      },
      container_env: {
        ...buildWarmContainerInspection().container_env,
        WARM_POOL_ID: 'warm-1',
        SESSION_VOLUME_NAME: 'warm-warm-1',
      },
    });
    const absentTarget = buildWorkerContainerInspection({
      exists: false,
      container_name: 'worker-1',
      running: false,
    });
    const activatedProxyTarget = buildActivatedWarmContainerInspection({
      container_labels: {
        ...buildActivatedWarmContainerInspection().container_labels,
        'underchat.proxy_mode': 'proxy',
        'underchat.proxy_fingerprint': workerProxyFingerprint({
          protocol: EProxyProtocol.http,
          host: 'proxy.example.test',
          port: 12484,
          username: 'proxy-user',
          password: 'proxy-password',
        }),
      },
      container_env: {
        ...buildActivatedWarmContainerInspection().container_env,
        PROXY_PROTOCOL: EProxyProtocol.http,
        PROXY_HOST: 'proxy.example.test',
        PROXY_PORT: '12484',
      },
    });
    deps.workerService.inspectContainerWorkerById.mockReset();
    deps.workerService.inspectContainerWorkerById
      .mockResolvedValueOnce(warmSource)
      .mockResolvedValueOnce(warmSource)
      .mockResolvedValueOnce(absentTarget)
      .mockResolvedValueOnce(absentTarget)
      .mockResolvedValueOnce(warmSource)
      .mockResolvedValueOnce(activatedProxyTarget)
      .mockResolvedValue(activatedProxyTarget);

    await expect(
      deps.handler.activateWarmWorker({
        warm_pool_id: 'warm-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
      })
    ).resolves.toEqual(expect.objectContaining({ claimed: true }));

    expect(deps.workerService.createContainerWorker).toHaveBeenCalledWith(
      expect.any(String),
      'worker-1',
      'account-1',
      false,
      expect.any(String),
      expect.any(Number),
      expect.objectContaining({
        protocol: EProxyProtocol.http,
        host: 'proxy.example.test',
        port: 12484,
      }),
      expect.objectContaining({ proxyMode: 'proxy' }),
      'warm-warm-1',
      expect.objectContaining({
        requireExistingVolume: true,
        requireContainerNameAvailable: true,
        imageContentId: WORKER_IMAGE_CONTENT_ID,
      })
    );
  });

  it.each([
    {
      label: 'source container removal',
      configure: (deps: ReturnType<typeof buildHandler>) => {
        deps.workerService.removeContainerWorkerById.mockResolvedValue(false);
      },
    },
    {
      label: 'target container creation',
      configure: (deps: ReturnType<typeof buildHandler>) => {
        deps.workerService.createContainerWorker.mockRejectedValue(
          new Error('target create failed')
        );
      },
    },
    {
      label: 'source volume preflight',
      configure: (deps: ReturnType<typeof buildHandler>) => {
        deps.workerService.existsVolumeByNameStrict.mockResolvedValue(false);
      },
    },
  ])('keeps activating quarantine on $label failure', async ({ configure }) => {
    const runtimeRepository = buildSelfHealRuntimeRepository();
    const deps = buildHandler({ workerRuntimeRepository: runtimeRepository });
    prepareWarmActivation(deps);
    deps.workerService.inspectContainerWorkerById.mockReset();
    deps.workerService.inspectContainerWorkerById
      .mockResolvedValueOnce(
        buildWarmContainerInspection({
          container_name: 'warm-warm-1',
          container_labels: {
            ...buildWarmContainerInspection().container_labels,
            'underchat.warm_pool_id': 'warm-1',
            'underchat.session_volume_name': 'warm-warm-1',
          },
          container_env: {
            ...buildWarmContainerInspection().container_env,
            WARM_POOL_ID: 'warm-1',
            SESSION_VOLUME_NAME: 'warm-warm-1',
          },
        })
      )
      .mockResolvedValueOnce(
        buildWarmContainerInspection({
          container_name: 'warm-warm-1',
          container_labels: {
            ...buildWarmContainerInspection().container_labels,
            'underchat.warm_pool_id': 'warm-1',
            'underchat.session_volume_name': 'warm-warm-1',
          },
          container_env: {
            ...buildWarmContainerInspection().container_env,
            WARM_POOL_ID: 'warm-1',
            SESSION_VOLUME_NAME: 'warm-warm-1',
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
          exists: false,
          container_name: 'worker-1',
          running: false,
        })
      )
      .mockResolvedValueOnce(
        buildWarmContainerInspection({
          container_name: 'warm-warm-1',
          container_labels: {
            ...buildWarmContainerInspection().container_labels,
            'underchat.warm_pool_id': 'warm-1',
            'underchat.session_volume_name': 'warm-warm-1',
          },
          container_env: {
            ...buildWarmContainerInspection().container_env,
            WARM_POOL_ID: 'warm-1',
            SESSION_VOLUME_NAME: 'warm-warm-1',
          },
        })
      )
      .mockResolvedValue(
        buildWorkerContainerInspection({
          exists: false,
          container_name: 'worker-1',
          running: false,
        })
      );
    configure(deps);

    await expect(
      deps.handler.activateWarmWorker({
        warm_pool_id: 'warm-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
      })
    ).rejects.toThrow();

    expect(
      deps.workerWarmPoolRepository.failActivatingActivation
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.revertAssignedActivation
    ).not.toHaveBeenCalled();
    expect(
      runtimeRepository.tombstoneWarmActivationIfMatches
    ).not.toHaveBeenCalled();
    expect(deps.workerService.removeVolumeByName).not.toHaveBeenCalled();
  });

  it('rejects unanchored delete commands before any Docker operation', async () => {
    const deps = buildHandler();

    await expect(
      deps.handler.deleteWarmWorker({
        container_name: 'arbitrary-container',
        session_volume_name: 'arbitrary-volume',
        remove_volume: true,
      })
    ).rejects.toThrow('Missing required field: warm_pool_id');

    expect(deps.workerLifecycleLockService.withLock).not.toHaveBeenCalled();
    expect(
      deps.workerService.removeContainerByNameAndVolume
    ).not.toHaveBeenCalled();
    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
    expect(deps.workerService.removeVolumeByName).not.toHaveBeenCalled();
  });

  it('preserves a converted warm target when the owner database fence cannot prove it was superseded', async () => {
    const runtimeRepository = buildSelfHealRuntimeRepository(
      5,
      'replacement-container-id'
    );
    const deps = buildHandler({
      workerRuntimeRepository: runtimeRepository,
      workerInspection: buildActivatedWarmContainerInspection(),
    });
    deps.workerWarmPoolRepository.viewByIdConsistent.mockResolvedValue({
      warm_pool_id: 'warm-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      container_id: 'replacement-container-id',
      container_name: 'worker-1',
      session_volume_name: 'warm-warm-1',
      state: EWorkerWarmPoolState.deleting,
      reserved_by_worker_id: 'worker-1',
      reservation_expires_at: null,
      last_error: 'warm_activation_abandoned:target_created_before_runtime',
    });

    await expect(
      deps.handler.deleteWarmWorker({
        warm_pool_id: 'warm-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        container_id: 'replacement-container-id',
        container_name: 'worker-1',
        session_volume_name: 'warm-warm-1',
        remove_volume: true,
      })
    ).rejects.toThrow('converted_warm_reclaim_database_fence_rejected');

    expect(
      runtimeRepository.isSessionVolumeReferencedConsistent
    ).toHaveBeenCalledTimes(1);
    expect(
      deps.workerService.inspectContainerWorkerByIdStrict
    ).toHaveBeenCalledWith('replacement-container-id');
    expect(
      deps.workerWarmPoolRepository.withConvertedDeletingReclaimFence
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        warmPoolId: 'warm-1',
        containerId: 'replacement-container-id',
        ownerWorkerId: 'worker-1',
      }),
      expect.any(Function)
    );
    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
    expect(
      deps.workerService.removeConvertedWarmVolumeByProof
    ).not.toHaveBeenCalled();
    expect(deps.workerWarmPoolRepository.deleteById).not.toHaveBeenCalled();
  });

  it('never falls back to generic deletion for active Docker identity when the converted row owner is incomplete', async () => {
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(),
      workerInspection: buildActivatedWarmContainerInspection(),
    });
    deps.workerWarmPoolRepository.viewByIdConsistent.mockResolvedValue({
      warm_pool_id: 'warm-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      container_id: 'replacement-container-id',
      container_name: 'worker-1',
      session_volume_name: 'warm-warm-1',
      state: EWorkerWarmPoolState.deleting,
      reserved_by_worker_id: null,
      last_error: 'warm_runtime_error_cleanup',
    });

    await expect(
      deps.handler.deleteWarmWorker({
        warm_pool_id: 'warm-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        container_id: 'replacement-container-id',
        container_name: 'worker-1',
        session_volume_name: 'warm-warm-1',
        remove_volume: true,
      })
    ).rejects.toThrow('converted_warm_reclaim_row_identity_invalid');

    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
    expect(deps.workerService.removeVolumeByName).not.toHaveBeenCalled();
    expect(
      deps.workerService.removeConvertedWarmVolumeByProof
    ).not.toHaveBeenCalled();
  });

  it('preserves a converted cleanup marker when the target is already absent instead of deleting its volume generically', async () => {
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(),
      workerInspection: buildWorkerContainerInspection({
        exists: false,
        container_id: undefined,
        container_name: 'worker-1',
        running: false,
      }),
    });
    deps.workerWarmPoolRepository.viewByIdConsistent.mockResolvedValue({
      warm_pool_id: 'warm-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      container_id: 'replacement-container-id',
      container_name: 'worker-1',
      session_volume_name: 'warm-warm-1',
      state: EWorkerWarmPoolState.deleting,
      reserved_by_worker_id: 'worker-1',
      last_error: 'warm_activation_abandoned:target_created_before_runtime',
    });

    await expect(
      deps.handler.deleteWarmWorker({
        warm_pool_id: 'warm-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        container_id: 'replacement-container-id',
        container_name: 'worker-1',
        session_volume_name: 'warm-warm-1',
        remove_volume: true,
      })
    ).rejects.toThrow('converted_warm_reclaim_target_absent_unproven');

    expect(deps.workerService.inspectVolumeByNameStrict).not.toHaveBeenCalled();
    expect(deps.workerService.removeVolumeByName).not.toHaveBeenCalled();
    expect(deps.workerWarmPoolRepository.deleteById).not.toHaveBeenCalled();
  });

  it('preserves both converted runtimes when a proven newer replacement mounts the same session volume', async () => {
    const target = buildActivatedWarmContainerInspection();
    const replacement = buildActivatedWarmContainerInspection({
      container_id: 'new-container-id',
      container_labels: {
        ...buildActivatedWarmContainerInspection().container_labels,
        'underchat.runtime_generation': '6',
      },
      container_env: {
        ...buildActivatedWarmContainerInspection().container_env,
        RUNTIME_GENERATION: '6',
      },
    });
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(),
      workerInspection: target,
    });
    deps.workerWarmPoolRepository.viewByIdConsistent.mockResolvedValue({
      warm_pool_id: 'warm-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      container_id: 'replacement-container-id',
      container_name: 'worker-1',
      session_volume_name: 'warm-warm-1',
      state: EWorkerWarmPoolState.deleting,
      reserved_by_worker_id: 'worker-1',
      last_error: 'warm_activation_abandoned:target_created_before_runtime',
    });
    deps.workerWarmPoolRepository.withConvertedDeletingReclaimFence.mockImplementation(
      async (...args: unknown[]) => {
        const operation = args[1] as (fence: {
          ownerMode: 'replacement';
          ownerAccountId: string;
          replacementContainerId: string;
          assertSafe(): Promise<void>;
        }) => Promise<unknown>;
        return operation({
          ownerMode: 'replacement',
          ownerAccountId: 'account-1',
          replacementContainerId: 'new-container-id',
          assertSafe: jest.fn(async () => undefined),
        });
      }
    );
    deps.workerService.inspectContainerWorkerByIdStrict
      .mockReset()
      .mockResolvedValueOnce(target)
      .mockResolvedValueOnce(replacement);
    deps.workerService.listContainerIdsMountingVolumeStrict.mockResolvedValueOnce(
      ['new-container-id', 'replacement-container-id']
    );

    await expect(
      deps.handler.deleteWarmWorker({
        warm_pool_id: 'warm-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        container_id: 'replacement-container-id',
        container_name: 'worker-1',
        session_volume_name: 'warm-warm-1',
        remove_volume: true,
      })
    ).rejects.toThrow('converted_warm_reclaim_replacement_uses_session_volume');

    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
    expect(
      deps.workerService.removeConvertedWarmVolumeByProof
    ).not.toHaveBeenCalled();
  });

  it('deletes a converted target only under a soft-deleted owner fence and repeated exact Docker proof', async () => {
    const runtimeRepository = buildSelfHealRuntimeRepository(
      5,
      'replacement-container-id'
    );
    const target = buildActivatedWarmContainerInspection();
    const deps = buildHandler({
      workerRuntimeRepository: runtimeRepository,
      workerInspection: target,
    });
    deps.workerWarmPoolRepository.viewByIdConsistent.mockResolvedValue({
      warm_pool_id: 'warm-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      container_id: 'replacement-container-id',
      container_name: 'worker-1',
      session_volume_name: 'warm-warm-1',
      state: EWorkerWarmPoolState.deleting,
      reserved_by_worker_id: 'worker-1',
      reservation_expires_at: null,
      last_error: 'warm_activation_abandoned:target_created_before_runtime',
    });
    deps.workerWarmPoolRepository.withConvertedDeletingReclaimFence.mockImplementation(
      async (...args: unknown[]) => {
        const operation = args[1] as (fence: {
          ownerMode: 'deleted';
          ownerAccountId: string;
          assertSafe(): Promise<void>;
        }) => Promise<unknown>;
        return operation({
          ownerMode: 'deleted',
          ownerAccountId: 'account-1',
          assertSafe: jest.fn(async () => undefined),
        });
      }
    );
    deps.workerService.inspectContainerWorkerByIdStrict
      .mockReset()
      .mockResolvedValueOnce(target)
      .mockResolvedValueOnce(target)
      .mockResolvedValueOnce(
        buildWorkerContainerInspection({
          exists: false,
          container_id: undefined,
          container_name: 'worker-1',
          running: false,
        })
      );
    deps.workerService.listContainerIdsMountingVolumeStrict
      .mockResolvedValueOnce(['replacement-container-id'])
      .mockResolvedValueOnce([]);

    await expect(
      deps.handler.deleteWarmWorker({
        warm_pool_id: 'warm-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        container_id: 'replacement-container-id',
        container_name: 'worker-1',
        session_volume_name: 'warm-warm-1',
        remove_volume: true,
      })
    ).resolves.toBeUndefined();

    expect(deps.workerService.removeContainerWorkerById).toHaveBeenCalledWith(
      'replacement-container-id'
    );
    expect(
      deps.workerService.removeConvertedWarmVolumeByProof
    ).toHaveBeenCalledWith('warm-warm-1', 'signature:warm-warm-1');
    expect(deps.workerService.removeVolumeByName).not.toHaveBeenCalled();
    expect(deps.workerWarmPoolRepository.deleteById).not.toHaveBeenCalled();
  });

  it('preserves a converted target and its volume when runtime lineage appears after cleanup claim', async () => {
    const runtimeRepository = buildSelfHealRuntimeRepository(
      5,
      'replacement-container-id'
    );
    runtimeRepository.isSessionVolumeReferencedConsistent.mockResolvedValue(
      true
    );
    const deps = buildHandler({
      workerRuntimeRepository: runtimeRepository,
      workerInspection: buildActivatedWarmContainerInspection(),
    });
    deps.workerWarmPoolRepository.viewByIdConsistent.mockResolvedValue({
      warm_pool_id: 'warm-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      container_id: 'replacement-container-id',
      container_name: 'worker-1',
      session_volume_name: 'warm-warm-1',
      state: EWorkerWarmPoolState.deleting,
      reserved_by_worker_id: 'worker-1',
      reservation_expires_at: null,
    });

    await expect(
      deps.handler.deleteWarmWorker({
        warm_pool_id: 'warm-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        container_id: 'replacement-container-id',
        container_name: 'worker-1',
        session_volume_name: 'warm-warm-1',
        remove_volume: true,
      })
    ).resolves.toBeUndefined();

    expect(
      runtimeRepository.isSessionVolumeReferencedConsistent
    ).toHaveBeenCalledWith('warm-warm-1');
    expect(
      deps.workerService.inspectContainerWorkerByIdStrict
    ).not.toHaveBeenCalled();
    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
    expect(deps.workerService.removeVolumeByName).not.toHaveBeenCalled();
    expect(deps.workerWarmPoolRepository.deleteById).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.reconcileDeletingRuntimeLineage
    ).toHaveBeenCalledWith('warm-1');
  });

  it('finalizes only the deleting DB tombstone after repeated proof that legacy Docker resources are absent', async () => {
    const warmPoolId = '019fb27a-47c9-7321-a249-681c18fc615d';
    const containerName = `warm-${warmPoolId}`;
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(),
    });
    deps.workerWarmPoolRepository.viewByIdConsistent.mockResolvedValue({
      warm_pool_id: warmPoolId,
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      container_id: null,
      container_name: null,
      session_volume_name: containerName,
      state: EWorkerWarmPoolState.deleting,
      reserved_by_worker_id: null,
    });
    deps.workerService.listContainerIdsMountingVolumeStrict.mockResolvedValue(
      []
    );
    deps.workerService.inspectVolumeByNameStrict.mockResolvedValue({
      exists: false,
      name: containerName,
    });
    const finalizeLegacyDeletingResourcesAbsent =
      deps.workerWarmPoolRepository.finalizeLegacyDeletingResourcesAbsent;
    if (!finalizeLegacyDeletingResourcesAbsent) {
      throw new Error('legacy absent finalizer mock is required');
    }

    await expect(
      deps.handler.deleteWarmWorker({
        warm_pool_id: warmPoolId,
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        session_volume_name: containerName,
        remove_volume: true,
      })
    ).resolves.toBeUndefined();

    expect(finalizeLegacyDeletingResourcesAbsent).toHaveBeenCalledWith(
      {
        warmPoolId,
        serverId: 'server-1',
        workerTypeId: EWorkerType.baileys,
        containerName,
        sessionVolumeName: containerName,
      },
      expect.any(Function)
    );
    expect(
      deps.workerService.listContainerIdsMountingVolumeStrict
    ).toHaveBeenCalledTimes(4);
    expect(
      deps.workerService.inspectContainerWorkerByIdStrict
    ).toHaveBeenCalledTimes(3);
    expect(deps.workerService.inspectVolumeByNameStrict).toHaveBeenCalledTimes(
      2
    );
    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
    expect(deps.workerService.removeVolumeByName).not.toHaveBeenCalled();
    expect(
      deps.workerService.removeLegacyWarmVolumeByProof
    ).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'the canonical container still exists without a mount',
      inspection: buildWorkerContainerInspection({
        exists: true,
        container_id: 'd'.repeat(64),
        container_name: 'warm-019fb27a-47c9-7321-a249-681c18fc615d',
        container_state: 'exited',
        running: false,
      }),
      expected: 'legacy_warm_absent_container_present',
    },
  ])(
    'preserves the tombstone when $label',
    async ({ inspection, expected }) => {
      const warmPoolId = '019fb27a-47c9-7321-a249-681c18fc615d';
      const containerName = `warm-${warmPoolId}`;
      const deps = buildHandler({
        workerRuntimeRepository: buildSelfHealRuntimeRepository(),
        workerInspection: inspection,
      });
      deps.workerWarmPoolRepository.viewByIdConsistent.mockResolvedValue({
        warm_pool_id: warmPoolId,
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        container_id: null,
        container_name: null,
        session_volume_name: containerName,
        state: EWorkerWarmPoolState.deleting,
        reserved_by_worker_id: null,
      });
      deps.workerService.listContainerIdsMountingVolumeStrict.mockResolvedValue(
        []
      );
      deps.workerService.inspectVolumeByNameStrict.mockResolvedValue({
        exists: false,
        name: containerName,
      });
      const finalizeLegacyDeletingResourcesAbsent =
        deps.workerWarmPoolRepository.finalizeLegacyDeletingResourcesAbsent;
      if (!finalizeLegacyDeletingResourcesAbsent) {
        throw new Error('legacy absent finalizer mock is required');
      }

      await expect(
        deps.handler.deleteWarmWorker({
          warm_pool_id: warmPoolId,
          server_id: 'server-1',
          worker_type_id: EWorkerType.baileys,
          session_volume_name: containerName,
          remove_volume: true,
        })
      ).rejects.toThrow(expected);

      expect(finalizeLegacyDeletingResourcesAbsent).not.toHaveBeenCalled();
      expect(
        deps.workerService.removeContainerWorkerById
      ).not.toHaveBeenCalled();
      expect(deps.workerService.removeVolumeByName).not.toHaveBeenCalled();
      expect(
        deps.workerService.removeLegacyWarmVolumeByProof
      ).not.toHaveBeenCalled();
    }
  );

  it('removes an exact unmounted orphan volume under the deleting DB fence', async () => {
    const warmPoolId = '019fb27a-47c9-7321-a249-681c18fc615d';
    const containerName = `warm-${warmPoolId}`;
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(),
    });
    deps.workerWarmPoolRepository.viewByIdConsistent.mockResolvedValue({
      warm_pool_id: warmPoolId,
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      container_id: null,
      container_name: null,
      session_volume_name: containerName,
      state: EWorkerWarmPoolState.deleting,
      reserved_by_worker_id: null,
    });
    deps.workerService.listContainerIdsMountingVolumeStrict.mockResolvedValue(
      []
    );
    deps.workerService.inspectVolumeByNameStrict
      .mockResolvedValueOnce({
        exists: true,
        name: containerName,
        signature: 'orphan-volume-signature',
      })
      .mockResolvedValueOnce({
        exists: false,
        name: containerName,
      });

    await expect(
      deps.handler.deleteWarmWorker({
        warm_pool_id: warmPoolId,
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        session_volume_name: containerName,
        remove_volume: true,
      })
    ).resolves.toBeUndefined();

    expect(
      deps.workerWarmPoolRepository.finalizeLegacyDeletingResourcesAbsent
    ).toHaveBeenCalledWith(
      expect.objectContaining({ warmPoolId, sessionVolumeName: containerName }),
      expect.any(Function)
    );
    expect(
      deps.workerService.removeLegacyWarmVolumeByProof
    ).toHaveBeenCalledWith(containerName, 'orphan-volume-signature');
    expect(
      deps.workerService.listContainerIdsMountingVolumeStrict
    ).toHaveBeenCalledTimes(4);
    expect(
      deps.workerService.inspectContainerWorkerByIdStrict
    ).toHaveBeenCalledTimes(3);
  });

  it('preserves an orphan volume without explicit removal authorization', async () => {
    const warmPoolId = '019fb27a-47c9-7321-a249-681c18fc615d';
    const containerName = `warm-${warmPoolId}`;
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(),
    });
    deps.workerWarmPoolRepository.viewByIdConsistent.mockResolvedValue({
      warm_pool_id: warmPoolId,
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      container_id: null,
      container_name: null,
      session_volume_name: containerName,
      state: EWorkerWarmPoolState.deleting,
      reserved_by_worker_id: null,
    });
    deps.workerService.listContainerIdsMountingVolumeStrict.mockResolvedValue(
      []
    );
    deps.workerService.inspectVolumeByNameStrict.mockResolvedValue({
      exists: true,
      name: containerName,
      signature: 'orphan-volume-signature',
    });

    await expect(
      deps.handler.deleteWarmWorker({
        warm_pool_id: warmPoolId,
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        session_volume_name: containerName,
        remove_volume: false,
      })
    ).rejects.toThrow('legacy_warm_absent_volume_present');

    expect(
      deps.workerWarmPoolRepository.finalizeLegacyDeletingResourcesAbsent
    ).not.toHaveBeenCalled();
    expect(
      deps.workerService.removeLegacyWarmVolumeByProof
    ).not.toHaveBeenCalled();
  });

  it('keeps the tombstone when the orphan volume signature changes', async () => {
    const warmPoolId = '019fb27a-47c9-7321-a249-681c18fc615d';
    const containerName = `warm-${warmPoolId}`;
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(),
    });
    deps.workerWarmPoolRepository.viewByIdConsistent.mockResolvedValue({
      warm_pool_id: warmPoolId,
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      container_id: null,
      container_name: null,
      session_volume_name: containerName,
      state: EWorkerWarmPoolState.deleting,
      reserved_by_worker_id: null,
    });
    deps.workerService.listContainerIdsMountingVolumeStrict.mockResolvedValue(
      []
    );
    deps.workerService.inspectVolumeByNameStrict.mockResolvedValue({
      exists: true,
      name: containerName,
      signature: 'original-volume-signature',
    });
    deps.workerService.removeLegacyWarmVolumeByProof.mockRejectedValueOnce(
      new Error('legacy_warm_reclaim_volume_identity_changed')
    );

    await expect(
      deps.handler.deleteWarmWorker({
        warm_pool_id: warmPoolId,
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        session_volume_name: containerName,
        remove_volume: true,
      })
    ).rejects.toThrow('legacy_warm_reclaim_volume_identity_changed');

    expect(
      deps.workerWarmPoolRepository.finalizeLegacyDeletingResourcesAbsent
    ).toHaveBeenCalledTimes(1);
    expect(
      deps.workerService.removeLegacyWarmVolumeByProof
    ).toHaveBeenCalledWith(containerName, 'original-volume-signature');
  });

  it('does not remove an orphan volume when DB ownership changes after Docker inspection', async () => {
    const warmPoolId = '019fb27a-47c9-7321-a249-681c18fc615d';
    const containerName = `warm-${warmPoolId}`;
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(),
    });
    deps.workerWarmPoolRepository.viewByIdConsistent.mockResolvedValue({
      warm_pool_id: warmPoolId,
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      container_id: null,
      container_name: null,
      session_volume_name: containerName,
      state: EWorkerWarmPoolState.deleting,
      reserved_by_worker_id: null,
    });
    deps.workerService.listContainerIdsMountingVolumeStrict.mockResolvedValue(
      []
    );
    deps.workerService.inspectVolumeByNameStrict.mockResolvedValue({
      exists: true,
      name: containerName,
      signature: 'orphan-volume-signature',
    });
    const assertUnreferenced = jest.fn(async () => {
      throw new Error('legacy_warm_absent_database_proof_changed');
    });
    deps.workerWarmPoolRepository.finalizeLegacyDeletingResourcesAbsent?.mockImplementationOnce(
      async (
        _input: Record<string, unknown>,
        finalizePhysicalResources: (fence: {
          assertUnreferenced(): Promise<void>;
        }) => Promise<void>
      ) => {
        await finalizePhysicalResources({ assertUnreferenced });
        return true;
      }
    );

    await expect(
      deps.handler.deleteWarmWorker({
        warm_pool_id: warmPoolId,
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        session_volume_name: containerName,
        remove_volume: true,
      })
    ).rejects.toThrow('legacy_warm_absent_database_proof_changed');

    expect(assertUnreferenced).toHaveBeenCalledTimes(1);
    expect(
      deps.workerService.removeLegacyWarmVolumeByProof
    ).not.toHaveBeenCalled();
  });

  it.each([
    {
      containerState: 'exited',
      paused: false,
      running: false,
      stateLabel: 'stopped',
    },
    {
      containerState: 'running',
      paused: false,
      running: true,
      stateLabel: 'running',
    },
    {
      containerState: 'paused',
      paused: true,
      running: true,
      stateLabel: 'paused',
    },
    {
      containerState: 'restarting',
      paused: false,
      running: true,
      stateLabel: 'restarting',
    },
  ])(
    'recaptures and removes an exact $stateLabel legacy standby under the database reclaim fence',
    async ({ containerState, paused, running }) => {
      const containerId = 'a'.repeat(64);
      const warmPoolId = '019fb27a-47c9-7321-a249-681c18fc615d';
      const containerName = `warm-${warmPoolId}`;
      const warm = {
        warm_pool_id: warmPoolId,
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        container_id: null,
        container_name: null,
        session_volume_name: containerName,
        state: EWorkerWarmPoolState.deleting,
        reserved_by_worker_id: null,
        reservation_expires_at: null,
        last_error: 'warm_delete_grpc_deferred',
      };
      const inspection: WorkerContainerInspection = {
        exists: true,
        container_id: containerId,
        container_name: containerName,
        container_state: containerState,
        container_paused: paused,
        running,
        container_labels: {
          'underchat.warm_standby': 'true',
          'underchat.warm_pool_id': warmPoolId,
          'underchat.server_id': 'server-1',
          'underchat.worker_type_id': EWorkerType.baileys,
          'underchat.session_volume_name': containerName,
        },
        container_env: {
          WARM_STANDBY: 'true',
          WARM_POOL_ID: warmPoolId,
          WORKER_TYPE_ID: EWorkerType.baileys,
          SESSION_VOLUME_NAME: containerName,
        },
        container_mounts: [
          {
            destination: '/app/data',
            name: containerName,
            read_write: true,
            type: 'volume',
          },
        ],
      };
      const runtimeRepository = buildSelfHealRuntimeRepository();
      const deps = buildHandler({
        workerRuntimeRepository: runtimeRepository,
        workerInspection: inspection,
      });
      deps.workerService.inspectContainerWorkerByIdStrict
        .mockResolvedValueOnce(inspection)
        .mockResolvedValueOnce(inspection)
        .mockResolvedValueOnce({
          exists: false,
          container_name: containerName,
        });
      deps.workerWarmPoolRepository.viewByIdConsistent.mockResolvedValue(warm);
      deps.workerService.listContainerIdsMountingVolumeStrict.mockResolvedValue(
        [containerId]
      );
      const claimLegacyDeletingContainerForReclaim =
        deps.workerWarmPoolRepository.claimLegacyDeletingContainerForReclaim;
      if (!claimLegacyDeletingContainerForReclaim) {
        throw new Error('legacy reclaim claim mock is required');
      }
      claimLegacyDeletingContainerForReclaim.mockResolvedValue({
        ...warm,
        container_id: containerId,
        container_name: containerName,
        last_error: 'warm_legacy_reclaim_claimed_v1',
      });

      await expect(
        deps.handler.deleteWarmWorker({
          warm_pool_id: warmPoolId,
          server_id: 'server-1',
          worker_type_id: EWorkerType.baileys,
          session_volume_name: containerName,
          remove_volume: true,
        })
      ).resolves.toBeUndefined();

      expect(claimLegacyDeletingContainerForReclaim).toHaveBeenCalledWith({
        warmPoolId,
        serverId: 'server-1',
        workerTypeId: EWorkerType.baileys,
        containerId,
        containerName,
        sessionVolumeName: containerName,
      });
      expect(
        deps.workerWarmPoolRepository.withLegacyDeletingReclaimFence
      ).toHaveBeenCalledWith(
        expect.objectContaining({ warmPoolId, containerId, containerName }),
        expect.any(Function)
      );
      expect(
        deps.workerService.inspectContainerWorkerByIdStrict
      ).toHaveBeenCalledTimes(3);
      expect(deps.workerService.removeContainerWorkerById).toHaveBeenCalledWith(
        containerId
      );
      expect(
        deps.workerService.removeLegacyWarmVolumeByProof
      ).toHaveBeenCalledWith(containerName, `signature:${containerName}`);
      expect(deps.workerWarmPoolRepository.deleteById).not.toHaveBeenCalled();
    }
  );

  it.each([
    {
      label: 'inconsistent running lifecycle state',
      mutate: (inspection: WorkerContainerInspection) => ({
        ...inspection,
        container_state: 'exited',
        running: true,
      }),
      expected: 'container_not_stopped',
    },
    {
      label: 'inconsistent paused lifecycle state',
      mutate: (inspection: WorkerContainerInspection) => ({
        ...inspection,
        container_state: 'paused',
        container_paused: false,
        running: true,
      }),
      expected: 'container_not_stopped',
    },
    {
      label: 'active owner label, even when empty',
      mutate: (inspection: WorkerContainerInspection) => ({
        ...inspection,
        container_labels: {
          ...inspection.container_labels,
          'underchat.worker_id': '',
        },
      }),
      expected: 'active_owner_identity',
    },
    {
      label: 'runtime generation label, even when empty',
      mutate: (inspection: WorkerContainerInspection) => ({
        ...inspection,
        container_labels: {
          ...inspection.container_labels,
          'underchat.runtime_generation': '',
        },
      }),
      expected: 'active_owner_identity',
    },
    {
      label: 'non-exact session mount',
      mutate: (inspection: WorkerContainerInspection) => ({
        ...inspection,
        container_mounts: [
          {
            destination: '/app/data',
            name: 'another-volume',
            read_write: true,
            type: 'volume',
          },
        ],
      }),
      expected: 'session_mount',
    },
  ])(
    'fails closed before DB claim for $label',
    async ({ mutate, expected }) => {
      const containerId = 'b'.repeat(64);
      const warmPoolId = '019fb27a-47c9-7321-a249-681c18fc615d';
      const containerName = `warm-${warmPoolId}`;
      const baseline: WorkerContainerInspection = {
        exists: true,
        container_id: containerId,
        container_name: containerName,
        container_state: 'exited',
        container_paused: false,
        running: false,
        container_labels: {
          'underchat.warm_standby': 'true',
          'underchat.warm_pool_id': warmPoolId,
          'underchat.server_id': 'server-1',
          'underchat.worker_type_id': EWorkerType.baileys,
          'underchat.session_volume_name': containerName,
        },
        container_env: {
          WARM_STANDBY: 'true',
          WARM_POOL_ID: warmPoolId,
          WORKER_TYPE_ID: EWorkerType.baileys,
          SESSION_VOLUME_NAME: containerName,
        },
        container_mounts: [
          {
            destination: '/app/data',
            name: containerName,
            read_write: true,
            type: 'volume',
          },
        ],
      };
      const deps = buildHandler({
        workerRuntimeRepository: buildSelfHealRuntimeRepository(),
        workerInspection: mutate(baseline),
      });
      deps.workerWarmPoolRepository.viewByIdConsistent.mockResolvedValue({
        warm_pool_id: warmPoolId,
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        container_id: null,
        container_name: null,
        session_volume_name: containerName,
        state: EWorkerWarmPoolState.deleting,
        reserved_by_worker_id: null,
      });
      deps.workerService.listContainerIdsMountingVolumeStrict.mockResolvedValue(
        [containerId]
      );
      const claimLegacyDeletingContainerForReclaim =
        deps.workerWarmPoolRepository.claimLegacyDeletingContainerForReclaim;
      if (!claimLegacyDeletingContainerForReclaim) {
        throw new Error('legacy reclaim claim mock is required');
      }

      await expect(
        deps.handler.deleteWarmWorker({
          warm_pool_id: warmPoolId,
          server_id: 'server-1',
          worker_type_id: EWorkerType.baileys,
          session_volume_name: containerName,
          remove_volume: true,
        })
      ).rejects.toThrow(expected);

      expect(claimLegacyDeletingContainerForReclaim).not.toHaveBeenCalled();
      expect(
        deps.workerService.removeContainerWorkerById
      ).not.toHaveBeenCalled();
      expect(
        deps.workerService.removeLegacyWarmVolumeByProof
      ).not.toHaveBeenCalled();
    }
  );
});

describe('WorkerCommandHandlerService legacy provider-switch rejection', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects a legacy warm provider-switch retry even with destructive reset flags and a lifecycle id', async () => {
    const deps = preparePreviousProviderWarmReset();

    await expect(activatePreviousProviderWarmReset(deps)).rejects.toThrow(
      'worker_type_change_requires_postgres_session'
    );

    expect(deps.workerLifecycleLockService.withLock).not.toHaveBeenCalled();
    expectNoPreviousProviderWarmResetMutation(deps);
  });

  it('rejects a forged postgres payload when the authoritative worker still owns a legacy volume', async () => {
    const deps = preparePreviousProviderWarmReset();

    await expect(
      deps.handler.activateWarmWorker({
        warm_pool_id: 'warm-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        previous_worker_type_id: EWorkerType.whatsmeow,
        session_storage: EWorkerSessionStorage.postgres,
        remove_session: false,
        remove_volume: false,
        lifecycle_operation_id: 'operation-1',
      })
    ).rejects.toThrow('worker_type_change_requires_postgres_session');

    expectNoPreviousProviderWarmResetMutation(deps);
  });

  it('rejects a non-WhatsApp provider transition before acquiring lifecycle locks', async () => {
    const deps = preparePreviousProviderWarmReset();

    await expect(
      deps.handler.activateWarmWorker({
        warm_pool_id: 'warm-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        previous_worker_type_id: EWorkerType.telegram,
        session_storage: EWorkerSessionStorage.postgres,
        remove_session: false,
        remove_volume: false,
        lifecycle_operation_id: 'operation-1',
      })
    ).rejects.toThrow('worker_type_change_unofficial_only');

    expect(deps.workerLifecycleLockService.withLock).not.toHaveBeenCalled();
    expectNoPreviousProviderWarmResetMutation(deps);
  });
});

// This legacy contract group shares one mock lifecycle across its provider,
// reconnect, recreate and deletion cases; splitting it would duplicate that
// boundary setup without changing the production behavior under test.
// eslint-disable-next-line max-statements
describe('WorkerCommandHandlerService connection', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('accepts self-heal requests by durably enqueueing recreate without removing session or volume', async () => {
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(),
    });
    makeSelfHealWorkerOnline(deps);
    const handleSpy = jest.spyOn(deps.handler, 'handle');

    await deps.handler.requestWorkerSelfHealing({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      source: 'health_monitor',
      reason: 'send_probe_failed',
      provider_state: 'connected',
      degraded_reason: 'send_probe_failed',
      kafka_unhealthy: false,
      session_ready: true,
      can_send: false,
      can_receive_runtime: true,
      authenticated: true,
      phone: '556192037138',
      runtime_generation: 4,
      recovery_window_seconds: 600,
      debug_trace_id: 'trace-1',
    });

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.recreating,
        lifecycle_operation_id: 'uuid-v7',
      }),
      {
        lifecycle_operation_id: null,
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        worker_status_id: EWorkerStatus.online,
      }
    );
    expect(deps.redisStore.get('worker:self-heal:recovery:worker-1')).toContain(
      'send_probe_failed'
    );
    expect(deps.workerLifecycleQueueService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'recreate',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        previous_worker_status_id: EWorkerStatus.online,
        operation_id: 'uuid-v7',
        source: 'self_heal',
        recreate_server_slot_key: 'worker:recreate:server:server-1:slot:0',
        recreate_server_slot_token: 'worker-1:uuid-v7',
        requested_at: expect.any(String),
      })
    );
    const recreatePayload = (
      deps.workerLifecycleQueueService.publish as jest.Mock
    ).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(recreatePayload).not.toHaveProperty('remove_session');
    expect(recreatePayload).not.toHaveProperty('remove_volume');
    expect(handleSpy).not.toHaveBeenCalled();
    expect(deps.redisStore.has('worker:self-heal:cooldown:worker-1')).toBe(
      false
    );
    expect(deps.redisStore.get('worker:self-heal:inflight:worker-1')).toBe(
      'uuid-v7'
    );
    expect(deps.redisStore.get('worker:recreate:server:server-1:slot:0')).toBe(
      'worker-1:uuid-v7'
    );
  });

  it('defers the third self-heal on one server without status mutation or Kafka publication', async () => {
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(),
    });
    makeSelfHealWorkerOnline(deps);
    deps.redisStore.set(
      'worker:recreate:server:server-1:slot:0',
      'worker-a:operation-a'
    );
    deps.redisStore.set(
      'worker:recreate:server:server-1:slot:1',
      'worker-b:operation-b'
    );

    await deps.handler.requestWorkerSelfHealing({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      source: 'health_monitor',
      reason: 'send_probe_failed',
      provider_state: 'connected',
      session_ready: true,
      can_send: false,
      can_receive_runtime: true,
      authenticated: true,
      phone: '556192037138',
      runtime_generation: 4,
    });

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
    expect(deps.workerLifecycleQueueService.prepare).not.toHaveBeenCalled();
    expect(deps.workerLifecycleQueueService.publish).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publish).not.toHaveBeenCalled();
    expect(deps.redisStore.has('worker:self-heal:inflight:worker-1')).toBe(
      false
    );
    expect(deps.redisStore.has('worker:self-heal:recovery:worker-1')).toBe(
      false
    );
    expect(deps.redisStore.get('worker:recreate:server:server-1:slot:0')).toBe(
      'worker-a:operation-a'
    );
    expect(deps.redisStore.get('worker:recreate:server:server-1:slot:1')).toBe(
      'worker-b:operation-b'
    );
  });

  it('sets the self-heal cooldown before clearing recovery fences for the recreated generation', async () => {
    const deps = buildHandler();
    deps.redisStore.set('worker:self-heal:inflight:worker-1', 'operation-1');
    deps.redisStore.set(
      'worker:self-heal:recovery:worker-1',
      JSON.stringify({
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
        runtime_generation: 4,
        operation_id: 'operation-1',
        requested_at: '2026-07-17T00:00:00.000Z',
        deadline_at: '2026-07-17T00:10:00.000Z',
        recovery_window_seconds: 600,
      })
    );

    await (
      deps.handler as unknown as {
        clearSelfHealRecoveryAfterNotification: (
          payload: Record<string, unknown>,
          status: EWorkerStatus
        ) => Promise<void>;
      }
    ).clearSelfHealRecoveryAfterNotification(
      {
        ...buildConnectedState(),
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
        runtime_generation: 5,
      },
      EWorkerStatus.online
    );

    expect(deps.redisStore.get('worker:self-heal:cooldown:worker-1')).toBe(
      'operation-1'
    );
    expect(deps.redisStore.has('worker:self-heal:inflight:worker-1')).toBe(
      false
    );
    expect(deps.redisStore.has('worker:self-heal:recovery:worker-1')).toBe(
      false
    );
  });

  it('does not clear self-heal recovery from the stale runtime generation', async () => {
    const deps = buildHandler();
    deps.redisStore.set('worker:self-heal:inflight:worker-1', 'operation-1');
    const recovery = JSON.stringify({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      runtime_generation: 4,
      operation_id: 'operation-1',
      requested_at: '2026-07-17T00:00:00.000Z',
      deadline_at: '2026-07-17T00:10:00.000Z',
      recovery_window_seconds: 600,
    });
    deps.redisStore.set('worker:self-heal:recovery:worker-1', recovery);

    await (
      deps.handler as unknown as {
        clearSelfHealRecoveryAfterNotification: (
          payload: Record<string, unknown>,
          status: EWorkerStatus
        ) => Promise<void>;
      }
    ).clearSelfHealRecoveryAfterNotification(
      {
        ...buildConnectedState(),
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
        runtime_generation: 4,
      },
      EWorkerStatus.online
    );

    expect(deps.redisStore.has('worker:self-heal:cooldown:worker-1')).toBe(
      false
    );
    expect(deps.redisStore.get('worker:self-heal:inflight:worker-1')).toBe(
      'operation-1'
    );
    expect(deps.redisStore.get('worker:self-heal:recovery:worker-1')).toBe(
      recovery
    );
  });

  it('preserves the durable lifecycle claim when self-heal publish exhausts fast redrive', async () => {
    const enqueueError = new Error('kafka unavailable');
    const workerLifecycleQueueService = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => {
        throw enqueueError;
      }),
    };
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(),
      workerLifecycleQueueService,
    });
    makeSelfHealWorkerOnline(deps);
    deps.workerService.updateWorkerByIdIfLifecycleMatches.mockResolvedValueOnce(
      true
    );
    const handleSpy = jest.spyOn(deps.handler, 'handle');

    await expect(
      deps.handler.requestWorkerSelfHealing({
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
        source: 'health_monitor',
        reason: 'send_probe_failed',
        provider_state: 'connected',
        session_ready: true,
        can_send: false,
        can_receive_runtime: true,
        authenticated: true,
        phone: '556192037138',
        runtime_generation: 4,
      })
    ).rejects.toThrow(
      'Self-heal lifecycle uuid-v7 remains prepared for fast redrive'
    );

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.recreating,
        lifecycle_operation_id: 'uuid-v7',
      }),
      {
        lifecycle_operation_id: null,
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        worker_status_id: EWorkerStatus.online,
      }
    );
    expect(workerLifecycleQueueService.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'recreate',
        operation_id: 'uuid-v7',
        source: 'self_heal',
      })
    );
    const prepareCallOrder =
      workerLifecycleQueueService.prepare.mock.invocationCallOrder.at(0) ??
      Number.MAX_SAFE_INTEGER;
    const updateCallOrder =
      deps.workerService.updateWorkerByIdIfLifecycleMatches.mock.invocationCallOrder.at(
        0
      ) ?? -1;
    expect(prepareCallOrder).toBeLessThan(updateCallOrder);
    expect(workerLifecycleQueueService.publish).toHaveBeenCalledTimes(6);
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledTimes(1);
    expect(deps.redisStore.get('worker:self-heal:inflight:worker-1')).toBe(
      'uuid-v7'
    );
    expect(deps.redisStore.get('worker:self-heal:recovery:worker-1')).toContain(
      '"operation_id":"uuid-v7"'
    );
    expect(deps.redisStore.has('worker:self-heal:cooldown:worker-1')).toBe(
      false
    );
    expect(deps.redisStore.has('worker:recreate:server:server-1:slot:0')).toBe(
      false
    );
    expect(deps.centrifugoService.publish).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publishSub).not.toHaveBeenCalled();
    expect(handleSpy).not.toHaveBeenCalled();
  });

  it('does not clear replacement self-heal fences after publish exhaustion', async () => {
    const enqueueError = new Error('kafka unavailable');
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(),
      workerLifecycleQueueService: {
        prepare: jest.fn(async () => undefined),
        publish: jest.fn(async () => {
          throw enqueueError;
        }),
      },
    });
    makeSelfHealWorkerOnline(deps);
    const replacementRecovery = JSON.stringify({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      runtime_generation: 5,
      operation_id: 'replacement-operation',
      requested_at: '2026-07-17T00:00:00.000Z',
      deadline_at: '2026-07-17T00:10:00.000Z',
      recovery_window_seconds: 600,
    });
    deps.workerService.updateWorkerByIdIfLifecycleMatches.mockImplementationOnce(
      async () => {
        deps.redisStore.set(
          'worker:self-heal:inflight:worker-1',
          'replacement-operation'
        );
        deps.redisStore.set(
          'worker:self-heal:recovery:worker-1',
          replacementRecovery
        );
        return true;
      }
    );

    await expect(
      deps.handler.requestWorkerSelfHealing({
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
        source: 'health_monitor',
        reason: 'send_probe_failed',
        provider_state: 'connected',
        session_ready: true,
        can_send: false,
        can_receive_runtime: true,
        authenticated: true,
        phone: '556192037138',
        runtime_generation: 4,
      })
    ).rejects.toThrow(
      'Self-heal lifecycle uuid-v7 remains prepared for fast redrive'
    );

    expect(deps.redisStore.get('worker:self-heal:inflight:worker-1')).toBe(
      'replacement-operation'
    );
    expect(deps.redisStore.get('worker:self-heal:recovery:worker-1')).toBe(
      replacementRecovery
    );
    expect(deps.redisStore.has('worker:self-heal:cooldown:worker-1')).toBe(
      false
    );
  });

  it('does not claim the primary worker when durable self-heal prepare fails', async () => {
    const prepareError = new Error('redis journal unavailable');
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(),
      workerLifecycleQueueService: {
        prepare: jest.fn(async () => {
          throw prepareError;
        }),
        publish: jest.fn(async () => undefined),
      },
    });
    makeSelfHealWorkerOnline(deps);

    await expect(
      deps.handler.requestWorkerSelfHealing({
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
        source: 'health_monitor',
        reason: 'send_probe_failed',
        provider_state: 'connected',
        session_ready: true,
        can_send: false,
        can_receive_runtime: true,
        authenticated: true,
        phone: '556192037138',
        runtime_generation: 4,
      })
    ).rejects.toBe(prepareError);

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
    expect(deps.workerLifecycleQueueService.publish).not.toHaveBeenCalled();
    expect(deps.redisStore.has('worker:self-heal:inflight:worker-1')).toBe(
      false
    );
    expect(deps.redisStore.has('worker:self-heal:recovery:worker-1')).toBe(
      false
    );
    expect(deps.redisStore.has('worker:recreate:server:server-1:slot:0')).toBe(
      false
    );
  });

  it('fast-redrives the same prepared self-heal claim after initial publish retries fail', async () => {
    let publishAttempt = 0;
    const workerLifecycleQueueService = {
      prepare: jest.fn<Promise<void>, [IWorkerLifecycleQueueMessage]>(
        async () => undefined
      ),
      publish: jest.fn<Promise<void>, [IWorkerLifecycleQueueMessage]>(
        async () => {
          publishAttempt += 1;
          if (publishAttempt <= 3) {
            throw new Error('kafka unavailable');
          }
        }
      ),
    };
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(),
      workerLifecycleQueueService,
    });
    makeSelfHealWorkerOnline(deps);
    deps.workerService.updateWorkerByIdIfLifecycleMatches.mockResolvedValueOnce(
      true
    );

    await deps.handler.requestWorkerSelfHealing({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      source: 'health_monitor',
      reason: 'send_probe_failed',
      provider_state: 'connected',
      session_ready: true,
      can_send: false,
      can_receive_runtime: true,
      authenticated: true,
      phone: '556192037138',
      runtime_generation: 4,
    });

    expect(workerLifecycleQueueService.publish).toHaveBeenCalledTimes(4);
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledTimes(1);
    const preparedPayload = workerLifecycleQueueService.prepare.mock.calls.at(
      0
    )?.[0] as IWorkerLifecycleQueueMessage | undefined;
    expect(preparedPayload).toBeDefined();
    for (const [publishedPayload] of workerLifecycleQueueService.publish.mock
      .calls) {
      expect(publishedPayload).toEqual(preparedPayload);
    }
    const prepareCallOrder =
      workerLifecycleQueueService.prepare.mock.invocationCallOrder.at(0) ??
      Number.MAX_SAFE_INTEGER;
    const updateCallOrder =
      deps.workerService.updateWorkerByIdIfLifecycleMatches.mock.invocationCallOrder.at(
        0
      ) ?? -1;
    expect(prepareCallOrder).toBeLessThan(updateCallOrder);
    expect(deps.redisStore.get('worker:self-heal:recovery:worker-1')).toContain(
      '"operation_id":"uuid-v7"'
    );
  });

  it('publishes recovery when the self-heal lifecycle CAS throws after committing', async () => {
    const casError = new Error('connection lost after commit');
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(),
    });
    makeSelfHealWorkerOnline(deps);
    const onlineWorker =
      await deps.workerService.viewWorkerForMonitor('worker-1');
    deps.workerService.viewWorkerForMonitor
      .mockReset()
      .mockResolvedValueOnce(onlineWorker)
      .mockResolvedValueOnce({
        ...onlineWorker,
        worker_status_id: EWorkerStatus.recreating,
        lifecycle_operation_id: 'uuid-v7',
      });
    deps.workerService.updateWorkerByIdIfLifecycleMatches.mockRejectedValueOnce(
      casError
    );

    await deps.handler.requestWorkerSelfHealing({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      source: 'health_monitor',
      reason: 'send_probe_failed',
      provider_state: 'connected',
      session_ready: true,
      can_send: false,
      can_receive_runtime: true,
      authenticated: true,
      phone: '556192037138',
      runtime_generation: 4,
    });

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledTimes(1);
    expect(deps.workerLifecycleQueueService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        operation_id: 'uuid-v7',
        action: 'recreate',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        source: 'self_heal',
      })
    );
    expect(deps.redisStore.get('worker:self-heal:inflight:worker-1')).toBe(
      'uuid-v7'
    );
    expect(deps.redisStore.get('worker:self-heal:recovery:worker-1')).toContain(
      '"operation_id":"uuid-v7"'
    );
  });

  it('publishes recovery when the lifecycle CAS and its primary verification both throw', async () => {
    const casError = new Error('connection lost after commit');
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(),
    });
    makeSelfHealWorkerOnline(deps);
    const onlineWorker =
      await deps.workerService.viewWorkerForMonitor('worker-1');
    deps.workerService.viewWorkerForMonitor
      .mockReset()
      .mockResolvedValueOnce(onlineWorker)
      .mockRejectedValueOnce(new Error('primary unavailable'));
    deps.workerService.updateWorkerByIdIfLifecycleMatches.mockRejectedValueOnce(
      casError
    );

    await deps.handler.requestWorkerSelfHealing({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      source: 'health_monitor',
      reason: 'send_probe_failed',
      provider_state: 'connected',
      session_ready: true,
      can_send: false,
      can_receive_runtime: true,
      authenticated: true,
      phone: '556192037138',
      runtime_generation: 4,
    });

    expect(deps.workerLifecycleQueueService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        operation_id: 'uuid-v7',
        action: 'recreate',
        source: 'self_heal',
      })
    );
    expect(deps.redisStore.get('worker:self-heal:inflight:worker-1')).toBe(
      'uuid-v7'
    );
  });

  it('does not publish an ambiguous self-heal CAS when another lifecycle owns the worker', async () => {
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(),
    });
    makeSelfHealWorkerOnline(deps);
    const onlineWorker =
      await deps.workerService.viewWorkerForMonitor('worker-1');
    deps.workerService.viewWorkerForMonitor
      .mockReset()
      .mockResolvedValueOnce(onlineWorker)
      .mockResolvedValueOnce({
        ...onlineWorker,
        worker_status_id: EWorkerStatus.recreating,
        lifecycle_operation_id: 'another-operation',
      });
    deps.workerService.updateWorkerByIdIfLifecycleMatches.mockRejectedValueOnce(
      new Error('connection lost after commit')
    );

    await deps.handler.requestWorkerSelfHealing({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      source: 'health_monitor',
      reason: 'send_probe_failed',
      provider_state: 'connected',
      session_ready: true,
      can_send: false,
      can_receive_runtime: true,
      authenticated: true,
      phone: '556192037138',
      runtime_generation: 4,
    });

    expect(deps.workerLifecycleQueueService.publish).not.toHaveBeenCalled();
    expect(deps.redisStore.has('worker:self-heal:inflight:worker-1')).toBe(
      false
    );
    expect(deps.redisStore.has('worker:self-heal:recovery:worker-1')).toBe(
      false
    );
    expect(deps.redisStore.has('worker:recreate:server:server-1:slot:0')).toBe(
      false
    );
  });

  it('deduplicates self-heal requests when another recreate is inflight', async () => {
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(),
    });
    makeSelfHealWorkerOnline(deps);
    const handleSpy = jest.spyOn(deps.handler, 'handle');
    deps.redisStore.set('worker:self-heal:inflight:worker-1', 'existing');

    await deps.handler.requestWorkerSelfHealing({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      source: 'health_monitor',
      reason: 'kafka_unhealthy',
      kafka_unhealthy: true,
      session_ready: true,
      can_send: true,
      can_receive_runtime: true,
      authenticated: true,
      phone: '556192037138',
      provider_state: 'connected',
      runtime_generation: 4,
    });

    expect(handleSpy).not.toHaveBeenCalled();
    expect(deps.workerService.updateWorkerById).not.toHaveBeenCalled();
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
  });

  it('abandons self-heal when another lifecycle wins the database fence', async () => {
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(),
    });
    makeSelfHealWorkerOnline(deps);
    const handleSpy = jest.spyOn(deps.handler, 'handle');
    deps.workerService.updateWorkerByIdIfLifecycleMatches.mockResolvedValueOnce(
      false
    );

    await deps.handler.requestWorkerSelfHealing({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      source: 'external_monitor',
      reason: 'probe_failed',
      session_ready: true,
      can_send: false,
      can_receive_runtime: true,
      authenticated: true,
      phone: '556192037138',
      provider_state: 'connected',
      runtime_generation: 4,
    });

    expect(handleSpy).not.toHaveBeenCalled();
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.recreating,
      }),
      {
        lifecycle_operation_id: null,
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        worker_status_id: EWorkerStatus.online,
      }
    );
    expect(deps.redisStore.has('worker:self-heal:inflight:worker-1')).toBe(
      false
    );
    expect(deps.redisStore.has('worker:self-heal:recovery:worker-1')).toBe(
      false
    );
  });

  it.each([
    EWorkerStatus.disponible,
    EWorkerStatus.offline,
    EWorkerStatus.error,
  ])('rejects self-heal while the worker status is %s', async (status) => {
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(),
    });
    deps.workerService.viewWorkerForMonitor.mockResolvedValue({
      worker_id: 'worker-1',
      name: 'Canal 1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: status,
      worker_type_id: EWorkerType.wwebjs,
      created_at: null,
      updated_at: null,
      deleted_at: null,
      container_id: 'container-1',
      lifecycle_operation_id: null,
      last_connection_check_at: null,
    });
    const handleSpy = jest.spyOn(deps.handler, 'handle');

    await deps.handler.requestWorkerSelfHealing({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      source: 'health_monitor',
      reason: 'kafka_unhealthy',
      provider_state: 'connected',
      kafka_unhealthy: true,
      session_ready: true,
      can_send: true,
      can_receive_runtime: true,
      authenticated: true,
      phone: '556192037138',
      runtime_generation: 4,
    });

    expect(handleSpy).not.toHaveBeenCalled();
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
  });

  it('rejects a self-heal request from a stale runtime generation', async () => {
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(5),
    });
    makeSelfHealWorkerOnline(deps);
    const handleSpy = jest.spyOn(deps.handler, 'handle');

    await deps.handler.requestWorkerSelfHealing({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      source: 'health_monitor',
      reason: 'send_probe_failed',
      provider_state: 'connected',
      session_ready: true,
      can_send: false,
      can_receive_runtime: true,
      authenticated: true,
      phone: '556192037138',
      runtime_generation: 4,
    });

    expect(handleSpy).not.toHaveBeenCalled();
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
  });

  it('rejects Kafka self-heal without an active authenticated session', async () => {
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(),
    });
    makeSelfHealWorkerOnline(deps);
    const handleSpy = jest.spyOn(deps.handler, 'handle');

    await deps.handler.requestWorkerSelfHealing({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      source: 'health_monitor',
      reason: 'runtime_not_initialized',
      provider_state: 'not_initialized',
      kafka_unhealthy: true,
      session_ready: false,
      can_send: false,
      can_receive_runtime: false,
      authenticated: false,
      runtime_generation: 4,
    });

    expect(handleSpy).not.toHaveBeenCalled();
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
  });

  it('uses and releases a per-server recreate slot in the real recreate flow', async () => {
    const deps = buildHandler();

    await handleWorkerCommand(deps, {
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
      2,
      'worker:recreate:server:server-1:slot:0',
      'worker:recreate:server:server-1:slot:0:reservation',
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
      expect.objectContaining({
        imageContentId: WORKER_IMAGE_CONTENT_ID,
        requireExistingVolume: true,
      })
    );
  });

  it('adopts and releases a reserved per-server recreate slot', async () => {
    const deps = buildHandler();
    const slotKey = 'worker:recreate:server:server-1:slot:0';
    const slotToken = 'worker-1:reserved-token';
    deps.redisStore.set(slotKey, slotToken);

    await handleWorkerCommand(deps, {
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
      2,
      slotKey,
      `${slotKey}:reservation`,
      slotToken,
      expect.any(Number)
    );
    expect(deps.redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('DEL'),
      2,
      slotKey,
      `${slotKey}:reservation`,
      slotToken
    );
  });

  it('clears provider and QR state twice before terminalizing an in-place disconnect under one lock', async () => {
    const finalizeWorkerConnectionDisconnect = jest.fn(async () => ({
      status: 'completed' as const,
      worker_id: 'worker-1',
      worker_status_id: EWorkerStatus.disponible,
      runtime_generation: 4,
      container_id: 'container-1',
      worker_status_observed_at: '2026-08-09T14:00:00.000Z',
    }));
    const runtimeRepository = Object.assign(
      buildSelfHealRuntimeRepository(4, 'container-1'),
      { finalizeWorkerConnectionDisconnect }
    );
    const deps = buildHandler({
      workerRuntimeRepository: runtimeRepository,
    });
    deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValue({
      worker_id: 'worker-1',
      name: 'Canal 1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.online,
      worker_type_id: EWorkerType.wwebjs,
      session_storage: EWorkerSessionStorage.legacy_volume,
      created_at: null,
      updated_at: null,
      deleted_at: null,
      container_id: 'container-1',
      runtime_container_id: 'container-1',
      runtime_generation: 4,
      lifecycle_operation_id: null,
      last_connection_check_at: null,
    });

    await deps.handler.handleChangeConnectionStatus(
      {
        worker_id: 'worker-1',
        status: EWorkerStatus.disponible,
        type: EBaileysConnectionType.qrcode,
        remove_session: true,
        runtime_generation: 4,
        debug_trace_id: 'trace-disconnect-1',
      },
      'account-1'
    );

    expect(deps.workerLifecycleLockService.withLock).toHaveBeenCalledWith(
      'worker-1',
      'change_status_worker_request',
      expect.any(Function),
      expect.objectContaining({
        acquireTimeoutMs: 10_000,
        ttlMs: 90_000,
      })
    );
    expect(deps.redisQueueService.invalidateWorkerState).toHaveBeenCalledTimes(
      2
    );
    expect(
      deps.redisQueueService.invalidateWorkerState
    ).toHaveBeenNthCalledWith(
      1,
      'worker-1',
      expect.objectContaining({
        reason: 'worker_connection_disconnected',
        runtimeGeneration: 4,
      })
    );
    expect(
      deps.redisQueueService.invalidateWorkerState
    ).toHaveBeenNthCalledWith(
      2,
      'worker-1',
      expect.objectContaining({
        reason: 'worker_connection_disconnected_terminal',
        runtimeGeneration: 4,
      })
    );
    expect(
      deps.workerBaileysGrpcClientService.requestConnection
    ).toHaveBeenCalledWith(
      'worker-1',
      expect.objectContaining({
        status: EWorkerStatus.disponible,
        remove_session: true,
        runtime_generation: 4,
      }),
      EWorkerType.wwebjs
    );
    expect(finalizeWorkerConnectionDisconnect).toHaveBeenCalledWith({
      worker_id: 'worker-1',
      account_id: 'account-1',
      expected_runtime_generation: 4,
      expected_container_id: 'container-1',
      expected_connection_epoch: null,
    });

    const [firstInvalidationOrder, secondInvalidationOrder] =
      deps.redisQueueService.invalidateWorkerState.mock.invocationCallOrder;
    const providerOrder =
      deps.workerBaileysGrpcClientService.requestConnection.mock
        .invocationCallOrder[0];
    const intentOrder =
      deps.centrifugoService.publishSub.mock.invocationCallOrder[0];
    const finalizerOrder =
      finalizeWorkerConnectionDisconnect.mock.invocationCallOrder[0];
    expect(firstInvalidationOrder).toBeLessThan(intentOrder);
    expect(intentOrder).toBeLessThan(providerOrder);
    expect(providerOrder).toBeLessThan(secondInvalidationOrder);
    expect(secondInvalidationOrder).toBeLessThan(finalizerOrder);
  });

  it('finalizes an in-place disconnect when the provider cleared before losing its acknowledgement', async () => {
    const finalizeWorkerConnectionDisconnect = jest
      .fn()
      .mockResolvedValueOnce({ status: 'session_not_empty' as const })
      .mockResolvedValueOnce({ status: 'session_fence_invalid' as const })
      .mockResolvedValueOnce({
        status: 'completed' as const,
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.disponible,
        runtime_generation: 4,
        container_id: 'container-1',
        worker_status_observed_at: '2026-08-09T14:00:00.000Z',
      });
    const runtimeRepository = Object.assign(
      buildSelfHealRuntimeRepository(4, 'container-1'),
      { finalizeWorkerConnectionDisconnect }
    );
    const deps = buildHandler({ workerRuntimeRepository: runtimeRepository });
    const sleep = mockHandlerSleep(deps.handler);
    deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValue({
      worker_id: 'worker-1',
      name: 'Canal 1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.online,
      worker_type_id: EWorkerType.baileys,
      session_storage: EWorkerSessionStorage.postgres,
      created_at: null,
      updated_at: null,
      deleted_at: null,
      container_id: 'container-1',
      runtime_container_id: 'container-1',
      runtime_generation: 4,
      lifecycle_operation_id: null,
      last_connection_check_at: null,
    });
    deps.workerBaileysGrpcClientService.requestConnection.mockRejectedValueOnce(
      new Error('provider response lost after clear')
    );

    await expect(
      deps.handler.handleChangeConnectionStatus(
        {
          worker_id: 'worker-1',
          status: EWorkerStatus.disponible,
          type: EBaileysConnectionType.qrcode,
          remove_session: true,
          runtime_generation: 4,
          debug_trace_id: 'trace-disconnect-provider-ack-lost',
        },
        'account-1'
      )
    ).resolves.toBeUndefined();

    expect(deps.redisQueueService.invalidateWorkerState).toHaveBeenCalledTimes(
      2
    );
    expect(finalizeWorkerConnectionDisconnect).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('does not publish disconnect intent before the account and runtime fences pass', async () => {
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(4, 'container-1'),
    });
    deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValue({
      worker_id: 'worker-1',
      account_id: 'another-account',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.online,
      worker_type_id: EWorkerType.baileys,
      session_storage: EWorkerSessionStorage.postgres,
      deleted_at: null,
      container_id: 'container-1',
      runtime_container_id: 'container-1',
      runtime_generation: 4,
      lifecycle_operation_id: null,
    });

    await expect(
      deps.handler.handleChangeConnectionStatus(
        {
          worker_id: 'worker-1',
          status: EWorkerStatus.disponible,
          type: EBaileysConnectionType.qrcode,
          remove_session: true,
          runtime_generation: 4,
        },
        'account-1'
      )
    ).rejects.toThrow('worker_disconnect_lifecycle_fence_changed');

    expect(deps.centrifugoService.publishSub).not.toHaveBeenCalled();
    expect(
      deps.workerBaileysGrpcClientService.requestConnection
    ).not.toHaveBeenCalled();
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
    expect(
      deps.containerHealthService.checkServiceHealth
    ).not.toHaveBeenCalled();

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
    deps.workerService.viewWorkerForMonitor.mockResolvedValueOnce({
      worker_id: 'worker-1',
      name: 'Canal 1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.creating,
      worker_type_id: EWorkerType.wwebjs,
      created_at: null,
      updated_at: null,
      deleted_at: null,
      container_id: 'container-1',
      lifecycle_operation_id: null,
      last_connection_check_at: null,
    });
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

  it('does not let a late connecting event from the disconnected epoch repopulate worker state', async () => {
    const runtimeRepository = buildSelfHealRuntimeRepository(4, 'container-1');
    runtimeRepository.viewByWorkerIdConsistent.mockResolvedValue({
      worker_id: 'worker-1',
      container_id: 'container-1',
      container_name: 'worker-1',
      session_storage: EWorkerSessionStorage.legacy_volume,
      session_volume_name: 'worker-1',
      runtime_generation: 4,
      source_provider: 'wwebjs',
      connection_epoch: 'removed-epoch',
      disconnected_connection_epoch: 'removed-epoch',
      connection_disconnected_at: '2026-08-09T14:00:00.000Z',
      connection_sequence: 12,
    });
    const deps = buildHandler({ workerRuntimeRepository: runtimeRepository });

    await expect(
      deps.handler.notifyWorkerStatus({
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
        worker_status_id: EWorkerStatus.offline,
        status: EBaileysConnectionStatus.connecting,
        runtime_generation: 4,
        container_id: 'container-1',
      })
    ).resolves.toBeUndefined();

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publishSub).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publish).not.toHaveBeenCalled();
  });

  it('rejects a late ONLINE event from the disconnected epoch', async () => {
    const runtimeRepository = buildSelfHealRuntimeRepository(4, 'container-1');
    runtimeRepository.viewByWorkerIdConsistent.mockResolvedValue({
      worker_id: 'worker-1',
      container_id: 'container-1',
      container_name: 'worker-1',
      session_storage: EWorkerSessionStorage.legacy_volume,
      session_volume_name: 'worker-1',
      runtime_generation: 4,
      source_provider: 'wwebjs',
      connection_epoch: 'removed-epoch',
      disconnected_connection_epoch: 'removed-epoch',
      connection_disconnected_at: '2026-08-09T14:00:00.000Z',
      connection_sequence: 12,
    });
    const deps = buildHandler({ workerRuntimeRepository: runtimeRepository });

    await expect(
      deps.handler.notifyWorkerStatus({
        ...buildConnectedState(),
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
        worker_status_id: EWorkerStatus.online,
        runtime_generation: 4,
        container_id: 'container-1',
      })
    ).rejects.toThrow(
      'worker_online_readiness_rejected:worker_connection_disconnect_epoch_stale'
    );

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publishSub).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publish).not.toHaveBeenCalled();
  });

  it('ignores a late provider teardown while a recreate lifecycle is active', async () => {
    const deps = buildHandler();
    deps.workerService.viewWorkerForMonitor.mockResolvedValue({
      worker_id: 'worker-1',
      name: 'Canal 1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: EWorkerType.wwebjs,
      created_at: null,
      updated_at: null,
      deleted_at: null,
      container_id: 'container-new',
      lifecycle_operation_id: 'recreate-operation-1',
      last_connection_check_at: null,
    });

    await deps.handler.notifyWorkerStatus({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      worker_status_id: EWorkerStatus.disponible,
      status: EBaileysConnectionStatus.disconnected,
      code: ECodeMessage.loggedOut,
      disconnected_user: true,
      container_id: 'container-new',
    });

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
    expect(deps.workerService.updateWorkerById).not.toHaveBeenCalled();
    expect(
      deps.workerService.updateWorkerPhoneStatusConnectionDate
    ).not.toHaveBeenCalled();
    expect(deps.redis.del).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publishSub).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publish).not.toHaveBeenCalled();
  });

  it('drops a provider status when lifecycle starts between its primary read and CAS update', async () => {
    const deps = buildHandler();
    deps.workerService.updateWorkerByIdIfLifecycleMatches.mockResolvedValueOnce(
      false
    );

    await deps.handler.notifyWorkerStatus({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      worker_status_id: EWorkerStatus.offline,
      status: EBaileysConnectionStatus.disconnected,
      code: ECodeMessage.connectionClosed,
      container_id: 'container-1',
    });

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'account-1',
      {
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.offline,
      },
      {
        lifecycle_operation_id: null,
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        worker_status_id: EWorkerStatus.disponible,
        runtime_generation: 1,
        container_id: 'container-1',
        runtime_container_id: 'container-1',
      }
    );
    expect(
      deps.workerService.updateWorkerPhoneStatusConnectionDate
    ).not.toHaveBeenCalled();
    expect(deps.redis.del).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publishSub).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publish).not.toHaveBeenCalled();
  });

  it('rejects online readiness when lifecycle starts before its fenced update', async () => {
    const deps = buildHandler({
      runtimeHealthResponse: {
        ready: true,
        session_ready: true,
        can_send: true,
        can_receive_runtime: true,
        authenticated: true,
        has_session: true,
        provider_state: 'CONNECTED',
        phone: '556192037138',
      },
    });
    deps.workerService.updateWorkerByIdIfLifecycleMatches.mockResolvedValueOnce(
      false
    );

    await expect(
      deps.handler.notifyWorkerStatus({
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
        container_id: 'container-1',
      })
    ).rejects.toThrow(
      'worker_online_readiness_rejected:worker_state_changed_or_lifecycle_started'
    );

    expect(deps.redis.del).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publishSub).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publish).not.toHaveBeenCalled();
  });

  it('rejects online worker status notifications without session readiness', async () => {
    const deps = buildHandler();
    deps.workerService.viewWorkerForMonitor.mockResolvedValue({
      worker_id: 'worker-1',
      name: 'Canal 1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.online,
      worker_type_id: EWorkerType.wwebjs,
      created_at: null,
      updated_at: null,
      deleted_at: null,
      container_id: 'container-1',
      lifecycle_operation_id: null,
      last_connection_check_at: null,
    });

    await expect(
      deps.handler.notifyWorkerStatus({
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_status_id: EWorkerStatus.online,
        status: EBaileysConnectionStatus.connected,
        code: ECodeMessage.connectionEstablished,
        phone: '+556192037138',
      })
    ).rejects.toBeInstanceOf(WorkerOnlineReadinessRejectedError);

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publishSub).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publish).not.toHaveBeenCalled();
  });

  it('reports Kafka readiness instead of masking it as a missing session', async () => {
    const deps = buildHandler({
      runtimeHealthResponse: {
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
        runtime_state: 'active',
        provider_state: 'CONNECTED',
        phone: '556192037138',
        kafka_unhealthy: true,
        kafka_consumers_ready: false,
      },
    });
    deps.workerService.viewWorkerForMonitor.mockResolvedValue({
      worker_id: 'worker-1',
      name: 'Canal 1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: EWorkerType.wwebjs,
      created_at: null,
      updated_at: null,
      deleted_at: null,
      container_id: 'container-1',
      lifecycle_operation_id: 'recreate-operation-1',
      last_connection_check_at: null,
    });

    await expect(
      deps.handler.notifyWorkerStatus({
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
        worker_status_id: EWorkerStatus.online,
        status: EBaileysConnectionStatus.connected,
        code: ECodeMessage.connectionEstablished,
        phone: '556192037138',
        runtime_generation: 1,
        session_ready: true,
        can_send: true,
        can_receive_runtime: true,
        authenticated: true,
      })
    ).rejects.toThrow(
      'worker_online_readiness_rejected:kafka_consumers_not_ready'
    );

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'the primary worker snapshot is not found',
      arrange: (viewWorkerForMonitor: jest.Mock) =>
        viewWorkerForMonitor.mockResolvedValueOnce(null),
    },
    {
      label: 'the primary worker snapshot read fails',
      arrange: (viewWorkerForMonitor: jest.Mock) =>
        viewWorkerForMonitor.mockRejectedValueOnce(
          new Error('primary database unavailable')
        ),
    },
  ])('rejects online notifications when $label', async ({ arrange }) => {
    const deps = buildHandler();
    const primaryWorkerView = (
      deps.workerService as typeof deps.workerService & {
        viewWorkerForMonitorConsistent: jest.Mock;
      }
    ).viewWorkerForMonitorConsistent;
    arrange(primaryWorkerView);

    await expect(
      deps.handler.notifyWorkerStatus({
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
        worker_status_id: EWorkerStatus.online,
        status: EBaileysConnectionStatus.connected,
        code: ECodeMessage.connectionEstablished,
        phone: '+556192037138',
        session_ready: true,
        can_send: true,
        can_receive_runtime: true,
        authenticated: true,
        runtime_generation: 1,
      })
    ).rejects.toThrow(
      'worker_online_readiness_rejected:worker_snapshot_unavailable'
    );

    expect(
      deps.workerBaileysGrpcClientService.runtimeHealth
    ).not.toHaveBeenCalled();
    expect(
      deps.workerService.updateWorkerPhoneStatusConnectionDate
    ).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publishSub).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publish).not.toHaveBeenCalled();
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
    deps.workerService.viewWorkerForMonitor.mockResolvedValue({
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.disponible,
      worker_type_id: EWorkerType.whatsmeow,
      deleted_at: null,
      container_id: 'container-1',
      lifecycle_operation_id: null,
    });
    deps.workerService.viewWorker.mockResolvedValueOnce({
      id: 'worker-1',
      name: 'Canal 1',
      server: { id: 'server-1' },
      type: { id: EWorkerType.whatsmeow },
      status: { id: EWorkerStatus.disponible },
    });
    deps.workerBaileysGrpcClientService.runtimeHealth.mockResolvedValueOnce({
      ...nativeRuntimeContract(EWorkerType.whatsmeow, true),
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
      kafka_unhealthy: false,
      kafka_consumers_ready: true,
      kafka_consumers_authorized: true,
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
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.online,
        number: '+556192037138',
        connection_date: expect.any(String),
      }),
      {
        container_id: 'container-1',
        lifecycle_operation_id: null,
        runtime_container_id: 'container-1',
        runtime_generation: 1,
        server_id: 'server-1',
        worker_type_id: EWorkerType.whatsmeow,
        worker_status_id: EWorkerStatus.disponible,
      }
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
      ...nativeRuntimeContract(EWorkerType.wwebjs, true),
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
      kafka_unhealthy: false,
      kafka_consumers_ready: true,
      kafka_consumers_authorized: true,
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
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.online,
        number: '5561888887777',
        connection_date: expect.any(String),
      }),
      {
        container_id: 'container-1',
        lifecycle_operation_id: null,
        runtime_container_id: 'container-1',
        runtime_generation: 1,
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        worker_status_id: EWorkerStatus.disponible,
      }
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
      ...nativeRuntimeContract(EWorkerType.wwebjs, true),
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

    await expect(
      deps.handler.notifyWorkerStatus({
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
      })
    ).rejects.toBeInstanceOf(WorkerOnlineReadinessRejectedError);

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publishSub).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publish).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'kafka_consumers_ready=false', includeReadiness: true },
    { label: 'kafka_consumers_ready is absent', includeReadiness: false },
  ])('rejects online when runtime health reports $label', async (scenario) => {
    const deps = buildHandler();
    const runtimeHealth: Record<string, unknown> = {
      ...nativeRuntimeContract(EWorkerType.wwebjs, true),
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
      kafka_unhealthy: false,
    };
    if (scenario.includeReadiness) {
      runtimeHealth.kafka_consumers_ready = false;
    }
    deps.workerBaileysGrpcClientService.runtimeHealth.mockResolvedValueOnce(
      runtimeHealth
    );

    await expect(
      deps.handler.notifyWorkerStatus({
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
      })
    ).rejects.toThrow(
      'worker_online_readiness_rejected:kafka_consumers_not_ready'
    );

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publishSub).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publish).not.toHaveBeenCalled();
  });

  it('rejects stale online runtime generations before updating or publishing', async () => {
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

    await expect(
      deps.handler.notifyWorkerStatus({
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
      })
    ).rejects.toThrow(
      'worker_online_readiness_rejected:runtime_generation_stale'
    );

    expect(
      deps.workerService.updateWorkerPhoneStatusConnectionDate
    ).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publishSub).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publish).not.toHaveBeenCalled();
    expect(
      deps.workerBaileysGrpcClientService.runtimeHealth
    ).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'missing',
      runtimeGeneration: undefined,
      bootstrapOperationId: 'recreate-operation-1',
    },
    {
      label: 'mismatched',
      runtimeGeneration: 6,
      bootstrapOperationId: 'recreate-operation-1',
    },
    {
      label: 'generation-matched but stale-bootstrap',
      runtimeGeneration: 5,
      bootstrapOperationId: 'older-recreate-operation',
    },
  ])(
    'rejects $label online runtime generation notifications while recreate fencing is active',
    async ({ runtimeGeneration, bootstrapOperationId }) => {
      const deps = buildHandler({
        workerRuntimeRepository: {
          viewByWorkerId: jest.fn(async () => ({
            worker_id: 'worker-1',
            container_id: 'container-current',
            container_name: 'worker-1',
            session_volume_name: 'worker-1',
            runtime_generation: 5,
            warm_pool_id: null,
            recreate_bootstrap_operation_id: bootstrapOperationId,
            recreate_bootstrap_runtime_generation: 5,
            recreate_bootstrap_container_id: 'container-current',
            recreate_bootstrap_started_at: '2026-08-15T20:00:00.000Z',
            recreate_retired_operation_id: null,
            recreate_retired_runtime_generation: null,
            recreate_retired_container_id: null,
            recreate_retired_at: null,
          })),
          upsert: jest.fn(async () => null),
          deleteByWorkerId: jest.fn(async () => undefined),
        },
      });
      deps.workerService.viewWorker.mockResolvedValue({
        id: 'worker-1',
        name: 'Canal 1',
        server: { id: 'server-1' },
        type: { id: EWorkerType.wwebjs },
        status: { id: EWorkerStatus.recreating },
      });
      deps.workerService.viewWorkerForMonitor.mockResolvedValue({
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: EWorkerType.wwebjs,
        created_at: null,
        updated_at: null,
        deleted_at: null,
        container_id: 'container-current',
        lifecycle_operation_id: 'recreate-operation-1',
        last_connection_check_at: null,
      });

      await expect(
        deps.handler.notifyWorkerStatus({
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
          ...(runtimeGeneration === undefined
            ? {}
            : { runtime_generation: runtimeGeneration }),
        })
      ).rejects.toBeInstanceOf(WorkerOnlineReadinessRejectedError);

      expect(
        deps.workerService.updateWorkerPhoneStatusConnectionDate
      ).not.toHaveBeenCalled();
      expect(deps.centrifugoService.publishSub).not.toHaveBeenCalled();
      expect(deps.centrifugoService.publish).not.toHaveBeenCalled();
      if (runtimeGeneration === 5) {
        expect(
          deps.workerBaileysGrpcClientService.runtimeHealth
        ).toHaveBeenCalledTimes(1);
      } else {
        expect(
          deps.workerBaileysGrpcClientService.runtimeHealth
        ).not.toHaveBeenCalled();
      }
    }
  );

  it('accepts a generation-matched strong online notification while preserving the lifecycle fence for its finalizer', async () => {
    const deps = buildHandler({
      workerRuntimeRepository: {
        viewByWorkerId: jest.fn(async () => ({
          worker_id: 'worker-1',
          container_id: 'container-current',
          container_name: 'worker-1',
          session_volume_name: 'worker-1',
          runtime_generation: 5,
          warm_pool_id: null,
          recreate_bootstrap_operation_id: 'recreate-operation-1',
          recreate_bootstrap_runtime_generation: 5,
          recreate_bootstrap_container_id: 'container-current',
          recreate_bootstrap_started_at: '2026-08-15T20:00:00.000Z',
          recreate_retired_operation_id: null,
          recreate_retired_runtime_generation: null,
          recreate_retired_container_id: null,
          recreate_retired_at: null,
        })),
        upsert: jest.fn(async () => null),
        deleteByWorkerId: jest.fn(async () => undefined),
      },
      runtimeHealthResponse: {
        ready: true,
        session_ready: true,
        can_send: true,
        can_receive_runtime: true,
        authenticated: true,
        provider_state: 'CONNECTED',
        phone: '556192037138',
        runtime_generation: 5,
      },
    });
    deps.workerService.viewWorkerForMonitor.mockResolvedValue({
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: EWorkerType.wwebjs,
      container_id: 'container-current',
      lifecycle_operation_id: 'recreate-operation-1',
    });
    deps.workerService.viewWorker.mockResolvedValue({
      id: 'worker-1',
      name: 'Canal 1',
      server: { id: 'server-1' },
      type: { id: EWorkerType.wwebjs },
      status: { id: EWorkerStatus.recreating },
    });

    await expect(
      deps.handler.notifyWorkerStatus({
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
        runtime_generation: 5,
      })
    ).resolves.toBeUndefined();

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.online,
      }),
      expect.objectContaining({
        lifecycle_operation_id: 'recreate-operation-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        worker_status_id: EWorkerStatus.recreating,
      })
    );
    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      expect.stringContaining('account-1'),
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.online,
      })
    );
  });

  it('does not let non-online reconciliation bypass a rejected runtime generation', async () => {
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
      runtimeHealthResponse: {
        ready: true,
        session_ready: true,
        can_send: true,
        can_receive_runtime: true,
        authenticated: true,
        provider_state: 'CONNECTED',
        runtime_generation: 6,
      },
    });
    deps.workerService.viewWorkerForMonitor.mockResolvedValue({
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: EWorkerType.wwebjs,
      container_id: 'container-current',
      lifecycle_operation_id: 'recreate-operation-1',
    });
    deps.workerService.viewWorker.mockResolvedValue({
      id: 'worker-1',
      name: 'Canal 1',
      server: { id: 'server-1' },
      type: { id: EWorkerType.wwebjs },
      status: { id: EWorkerStatus.recreating },
    });

    await expect(
      deps.handler.notifyWorkerStatus({
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
        worker_status_id: EWorkerStatus.online,
        status: EBaileysConnectionStatus.connected,
        code: ECodeMessage.connectionEstablished,
        runtime_generation: 5,
      })
    ).rejects.toThrow('worker_online_readiness_rejected');

    expect(
      deps.workerBaileysGrpcClientService.runtimeHealth
    ).toHaveBeenCalledTimes(1);
    expect(
      deps.workerService.updateWorkerPhoneStatusConnectionDate
    ).not.toHaveBeenCalled();
  });

  it('keeps legacy online health without runtime generation compatible outside recreate', async () => {
    const deps = buildHandler({
      workerRuntimeRepository: {
        viewByWorkerId: jest.fn(async () => ({
          worker_id: 'worker-1',
          container_id: 'container-current',
          container_name: 'worker-1',
          session_volume_name: 'worker-1',
          runtime_generation: 6,
          warm_pool_id: null,
        })),
        upsert: jest.fn(async () => null),
        deleteByWorkerId: jest.fn(async () => undefined),
      },
    });
    deps.workerService.viewWorker.mockResolvedValue({
      id: 'worker-1',
      name: 'Canal 1',
      server: { id: 'server-1' },
      type: { id: EWorkerType.wwebjs },
      status: { id: EWorkerStatus.online },
    });
    deps.workerService.viewWorkerForMonitor.mockResolvedValue({
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.online,
      worker_type_id: EWorkerType.wwebjs,
      created_at: null,
      updated_at: null,
      deleted_at: null,
      container_id: 'container-current',
      lifecycle_operation_id: null,
      last_connection_check_at: null,
    });
    deps.workerBaileysGrpcClientService.runtimeHealth.mockResolvedValueOnce({
      ...nativeRuntimeContract(EWorkerType.wwebjs, true),
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
      runtime_state: 'active',
      provider_state: 'CONNECTED',
      phone: '556192037138',
      kafka_unhealthy: false,
      kafka_consumers_ready: true,
      kafka_consumers_authorized: true,
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
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.online,
      }),
      {
        lifecycle_operation_id: null,
        container_id: 'container-current',
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        worker_status_id: EWorkerStatus.online,
        runtime_container_id: 'container-current',
        runtime_generation: 6,
      }
    );
  });

  it('rejects ONLINE when current runtime health omits native status proof', async () => {
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
      runtime_state: 'active',
      provider_state: 'CONNECTED',
      phone: '556192037138',
      kafka_unhealthy: false,
      kafka_consumers_ready: true,
      kafka_consumers_authorized: true,
      runtime_health_schema_version: 3,
    });

    await expect(
      deps.handler.notifyWorkerStatus({
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
        connection_status_source_id: CONNECTION_STATUS_SOURCE_ID,
        connection_status: buildNativeConnectionStatus(
          EWorkerType.wwebjs,
          true
        ),
      })
    ).rejects.toThrow(
      'worker_online_readiness_rejected:native_connection_status_not_online'
    );

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
  });

  it('accepts only the schema-v3 online bootstrap that grants Kafka dispatch authorization', async () => {
    const deps = buildHandler();
    deps.workerBaileysGrpcClientService.runtimeHealth.mockResolvedValueOnce({
      ...nativeRuntimeContract(EWorkerType.wwebjs, true),
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
      runtime_state: 'active',
      provider_state: 'CONNECTED',
      phone: '556192037138',
      kafka_unhealthy: false,
      kafka_consumers_ready: true,
      kafka_consumers_authorized: false,
      runtime_health_schema_version: 3,
      connection_status_source_id: CONNECTION_STATUS_SOURCE_ID,
      connection_status: buildNativeConnectionStatus(EWorkerType.wwebjs, true),
      degraded_reason: 'awaiting_dispatch_authorization',
    });

    await expect(
      deps.handler.notifyWorkerStatus({
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
        connection_status_source_id: CONNECTION_STATUS_SOURCE_ID,
        connection_status: buildNativeConnectionStatus(
          EWorkerType.wwebjs,
          true
        ),
      })
    ).resolves.toBeUndefined();

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.online,
      }),
      expect.any(Object)
    );
  });

  it('rejects schema-v3 online health without authorization outside the exact bootstrap state', async () => {
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
      runtime_state: 'active',
      provider_state: 'CONNECTED',
      phone: '556192037138',
      kafka_unhealthy: false,
      kafka_consumers_ready: true,
      kafka_consumers_authorized: false,
      runtime_health_schema_version: 3,
      connection_status_source_id: CONNECTION_STATUS_SOURCE_ID,
      connection_status: buildNativeConnectionStatus(EWorkerType.wwebjs, true),
      degraded_reason: 'dispatch_authorization_stalled',
    });

    await expect(
      deps.handler.notifyWorkerStatus({
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
      })
    ).rejects.toThrow(
      'worker_online_readiness_rejected:kafka_consumers_not_authorized'
    );

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
  });

  it('promotes a non-online notification to online when runtime health confirms a real session', async () => {
    const deps = buildHandler();
    deps.workerBaileysGrpcClientService.runtimeHealth.mockResolvedValueOnce({
      ...nativeRuntimeContract(EWorkerType.wwebjs, true),
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
      kafka_unhealthy: false,
      kafka_consumers_ready: true,
      kafka_consumers_authorized: true,
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
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.online,
        number: '556192037138',
        connection_date: expect.any(String),
      }),
      {
        container_id: 'container-1',
        lifecycle_operation_id: null,
        runtime_container_id: 'container-1',
        runtime_generation: 1,
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        worker_status_id: EWorkerStatus.disponible,
      }
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

  it('preserves online state when a non-online notification races Kafka positioning of an authenticated runtime', async () => {
    const deps = buildHandler();
    deps.workerService.viewWorkerForMonitor.mockResolvedValue({
      worker_id: 'worker-1',
      name: 'Canal 1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.online,
      worker_type_id: EWorkerType.wwebjs,
      created_at: null,
      updated_at: null,
      deleted_at: null,
      container_id: 'container-1',
      lifecycle_operation_id: null,
      last_connection_check_at: null,
    });
    deps.workerBaileysGrpcClientService.runtimeHealth.mockResolvedValueOnce({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      activated: true,
      ready: false,
      session_ready: false,
      can_send: false,
      can_receive_runtime: false,
      authenticated: true,
      standby: false,
      has_session: true,
      runtime_state: 'active',
      qr_stream_ready: true,
      provider_state: 'kafka_consumers_not_ready',
      phone: '556192037138',
      kafka_unhealthy: false,
      kafka_consumers_ready: false,
    });

    await deps.handler.notifyWorkerStatus({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      worker_status_id: EWorkerStatus.disponible,
      status: EBaileysConnectionStatus.connecting,
      code: ECodeMessage.awaitConnection,
      reason: 'kafka_consumers_not_ready',
    });

    expect(
      deps.workerBaileysGrpcClientService.runtimeHealth
    ).toHaveBeenCalledWith(
      'worker-1',
      { worker_id: 'worker-1' },
      EWorkerType.wwebjs
    );
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publishSub).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publish).not.toHaveBeenCalled();
  });

  describe('current-runtime functional degradation', () => {
    it('moves the DB out of online when the current generation confirms strong functional degradation', async () => {
      const deps = buildHandler({
        workerRuntimeRepository: buildSelfHealRuntimeRepository(
          7,
          'container-1'
        ),
      });
      deps.workerService.viewWorkerForMonitor.mockResolvedValue({
        worker_id: 'worker-1',
        name: 'Faveni',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_status_id: EWorkerStatus.online,
        worker_type_id: EWorkerType.wwebjs,
        created_at: null,
        updated_at: null,
        deleted_at: null,
        container_id: 'container-1',
        lifecycle_operation_id: null,
        last_connection_check_at: null,
      });
      deps.workerBaileysGrpcClientService.runtimeHealth.mockResolvedValueOnce({
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
        runtime_generation: 7,
        activated: true,
        ready: false,
        session_ready: false,
        can_send: false,
        can_receive_runtime: true,
        authenticated: true,
        standby: false,
        has_session: true,
        runtime_state: 'active',
        provider_state: 'kafka_consumers_not_ready',
        phone: '5516981462113',
        kafka_unhealthy: false,
        kafka_consumers_ready: false,
      });

      await deps.handler.notifyWorkerStatus({
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
        worker_status_id: EWorkerStatus.offline,
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitConnection,
        phone: '5516981462113',
        session_ready: false,
        can_send: false,
        can_receive_runtime: true,
        authenticated: true,
        provider_state: 'kafka_consumers_not_ready',
        degraded_reason: 'kafka_consumers_not_ready',
        container_id: 'container-1',
        runtime_generation: 7,
      });

      expect(
        deps.workerBaileysGrpcClientService.runtimeHealth
      ).toHaveBeenCalledWith(
        'worker-1',
        { worker_id: 'worker-1' },
        EWorkerType.wwebjs
      );
      expect(
        deps.workerService.updateWorkerByIdIfLifecycleMatches
      ).toHaveBeenCalledWith(
        'account-1',
        expect.objectContaining({
          worker_id: 'worker-1',
          worker_status_id: EWorkerStatus.offline,
        }),
        {
          lifecycle_operation_id: null,
          server_id: 'server-1',
          worker_type_id: EWorkerType.wwebjs,
          worker_status_id: EWorkerStatus.online,
          runtime_generation: 7,
          container_id: 'container-1',
          runtime_container_id: 'container-1',
        }
      );
      expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
        'worker:account#account-1',
        expect.objectContaining({
          worker_id: 'worker-1',
          worker_status_id: EWorkerStatus.offline,
          session_ready: false,
          can_send: false,
          can_receive_runtime: true,
          authenticated: true,
          provider_state: 'kafka_consumers_not_ready',
          runtime_generation: 7,
        })
      );
    });

    it('applies strong current-generation degradation when runtime health is unavailable', async () => {
      const deps = buildHandler({
        workerRuntimeRepository: buildSelfHealRuntimeRepository(
          7,
          'container-1'
        ),
      });
      deps.workerService.viewWorkerForMonitor.mockResolvedValue({
        worker_id: 'worker-1',
        name: 'Faveni',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_status_id: EWorkerStatus.online,
        worker_type_id: EWorkerType.wwebjs,
        created_at: null,
        updated_at: null,
        deleted_at: null,
        container_id: 'container-1',
        lifecycle_operation_id: null,
        last_connection_check_at: null,
      });
      deps.workerBaileysGrpcClientService.runtimeHealth.mockRejectedValueOnce(
        new Error('runtime health unavailable')
      );

      await deps.handler.notifyWorkerStatus({
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
        worker_status_id: EWorkerStatus.disponible,
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitConnection,
        phone: '5516981462113',
        session_ready: false,
        can_send: false,
        can_receive_runtime: true,
        authenticated: true,
        provider_state: 'CONNECTED',
        degraded_reason: 'session_probe_failed',
        container_id: 'container-1',
        runtime_generation: 7,
      });

      expect(
        deps.workerBaileysGrpcClientService.runtimeHealth
      ).toHaveBeenCalledWith(
        'worker-1',
        { worker_id: 'worker-1' },
        EWorkerType.wwebjs
      );
      expect(
        deps.workerService.updateWorkerByIdIfLifecycleMatches
      ).toHaveBeenCalledWith(
        'account-1',
        expect.objectContaining({
          worker_id: 'worker-1',
          worker_status_id: EWorkerStatus.disponible,
        }),
        {
          lifecycle_operation_id: null,
          server_id: 'server-1',
          worker_type_id: EWorkerType.wwebjs,
          worker_status_id: EWorkerStatus.online,
          runtime_generation: 7,
          container_id: 'container-1',
          runtime_container_id: 'container-1',
        }
      );
      expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
        'worker:account#account-1',
        expect.objectContaining({
          worker_id: 'worker-1',
          worker_status_id: EWorkerStatus.disponible,
          session_ready: false,
          can_send: false,
          can_receive_runtime: true,
          degraded_reason: 'session_probe_failed',
          runtime_generation: 7,
        })
      );
    });

    it.each([
      'missing_client_info',
      'event_bridge_not_attached',
      'missing_local_session',
      'store_wwebjs_not_ready',
      'session_probe_failed',
      'self_jid_not_registered',
      'registration_probe_unavailable',
    ])(
      'does not retain a false online state when WWebJS confirms %s on the current generation',
      async (degradedReason) => {
        const deps = buildHandler({
          workerRuntimeRepository: buildSelfHealRuntimeRepository(
            7,
            'container-1'
          ),
        });
        deps.workerService.viewWorkerForMonitor.mockResolvedValue({
          worker_id: 'worker-1',
          name: 'Faveni',
          account_id: 'account-1',
          server_id: 'server-1',
          worker_status_id: EWorkerStatus.online,
          worker_type_id: EWorkerType.wwebjs,
          created_at: null,
          updated_at: null,
          deleted_at: null,
          container_id: 'container-1',
          lifecycle_operation_id: null,
          last_connection_check_at: null,
        });
        deps.workerBaileysGrpcClientService.runtimeHealth.mockResolvedValueOnce(
          {
            worker_id: 'worker-1',
            account_id: 'account-1',
            worker_type_id: EWorkerType.wwebjs,
            runtime_generation: 7,
            activated: true,
            ready: false,
            session_ready: false,
            can_send: false,
            can_receive_runtime: true,
            authenticated: true,
            standby: false,
            has_session: true,
            runtime_state: 'active',
            provider_state: 'CONNECTED',
            degraded_reason: degradedReason,
            phone: '5516981462113',
            kafka_unhealthy: false,
            kafka_consumers_ready: true,
          }
        );

        await deps.handler.notifyWorkerStatus({
          worker_id: 'worker-1',
          account_id: 'account-1',
          worker_type_id: EWorkerType.wwebjs,
          worker_status_id: EWorkerStatus.disponible,
          status: EBaileysConnectionStatus.connecting,
          code: ECodeMessage.awaitConnection,
          phone: '5516981462113',
          session_ready: false,
          can_send: false,
          can_receive_runtime: true,
          authenticated: true,
          provider_state: 'CONNECTED',
          degraded_reason: degradedReason,
          container_id: 'container-1',
          runtime_generation: 7,
        });

        expect(
          deps.workerService.updateWorkerByIdIfLifecycleMatches
        ).toHaveBeenCalledWith(
          'account-1',
          expect.objectContaining({
            worker_id: 'worker-1',
            worker_status_id: EWorkerStatus.disponible,
          }),
          {
            lifecycle_operation_id: null,
            server_id: 'server-1',
            worker_type_id: EWorkerType.wwebjs,
            worker_status_id: EWorkerStatus.online,
            runtime_generation: 7,
            container_id: 'container-1',
            runtime_container_id: 'container-1',
          }
        );
      }
    );

    it('does not demote the current generation when the runtime probe disproves an isolated degraded event', async () => {
      const deps = buildHandler({
        workerRuntimeRepository: buildSelfHealRuntimeRepository(
          7,
          'container-1'
        ),
        runtimeHealthResponse: {
          ...buildStrictLivenessRuntimeHealth(),
          runtime_generation: 7,
        },
      });
      deps.workerService.viewWorkerForMonitor.mockResolvedValue({
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_status_id: EWorkerStatus.online,
        worker_type_id: EWorkerType.wwebjs,
        container_id: 'container-1',
        lifecycle_operation_id: null,
      });

      await deps.handler.notifyWorkerStatus({
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
        worker_status_id: EWorkerStatus.offline,
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitConnection,
        session_ready: false,
        can_send: false,
        can_receive_runtime: false,
        authenticated: true,
        provider_state: 'kafka_consumers_not_ready',
        degraded_reason: 'kafka_consumers_not_ready',
        container_id: 'container-1',
        runtime_generation: 7,
      });

      expect(
        deps.workerService.updateWorkerByIdIfLifecycleMatches
      ).toHaveBeenCalledWith(
        'account-1',
        expect.objectContaining({
          worker_id: 'worker-1',
          worker_status_id: EWorkerStatus.online,
        }),
        expect.objectContaining({ worker_status_id: EWorkerStatus.online })
      );
    });
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
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.disponible,
        number: null,
        connection_date: null,
      }),
      expect.objectContaining({
        lifecycle_operation_id: null,
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        worker_status_id: EWorkerStatus.disponible,
        container_id: 'container-1',
        runtime_container_id: 'container-1',
        runtime_generation: 1,
      })
    );
    expect(
      deps.workerService.updateWorkerPhoneStatusConnectionDate
    ).not.toHaveBeenCalled();
  });

  it('restores the runtime pointer when remote logout clears the control pointer', async () => {
    const runtimeRepository = buildSelfHealRuntimeRepository(7, 'container-1');
    const deps = buildHandler({
      workerRuntimeRepository: runtimeRepository,
    });
    deps.workerService.viewWorkerForMonitor.mockResolvedValue({
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.mismatched,
      worker_type_id: EWorkerType.wwebjs,
      deleted_at: null,
      container_id: null,
      session_storage: EWorkerSessionStorage.postgres,
      lifecycle_operation_id: null,
    });

    await deps.handler.notifyWorkerStatus({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      worker_status_id: EWorkerStatus.mismatched,
      status: EBaileysConnectionStatus.disconnected,
      code: ECodeMessage.loggedOut,
      disconnected_user: true,
      container_id: 'container-1',
      runtime_generation: 7,
    });

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'account-1',
      {
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.mismatched,
        number: null,
        container_id: 'container-1',
        connection_date: null,
      },
      expect.objectContaining({
        lifecycle_operation_id: null,
        worker_status_id: EWorkerStatus.mismatched,
        container_id: null,
        runtime_container_id: 'container-1',
        runtime_generation: 7,
      })
    );
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

  it('publishes QR exhaustion and releases the active attempt even when its last QR is cached', async () => {
    const deps = buildHandler();
    seedActiveQrAttempt(deps.redisStore, {
      connectionAttemptId: 'attempt-active',
      runtimeGeneration: 1,
    });
    const cacheKey = `connection:qrcode:${EWorkerType.wwebjs}:worker-1:attempt`;
    const activeKey = `connection:qrcode:${EWorkerType.wwebjs}:worker-1:active_attempt`;
    deps.redisStore.set(
      cacheKey,
      JSON.stringify({
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
        worker_status_id: EWorkerStatus.disponible,
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitingReadQrCode,
        qrcode: 'data:image/png;base64,fifth-qr',
        connection_attempt_id: 'attempt-active',
        runtime_generation: 1,
        qr_generated_at: new Date().toISOString(),
      })
    );

    await deps.handler.notifyWorkerStatus({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      worker_status_id: EWorkerStatus.disponible,
      status: EBaileysConnectionStatus.disconnected,
      code: ECodeMessage.connectionClosed,
      connection_attempt_id: 'attempt-active',
      runtime_generation: 1,
      attempt: 6,
      max_attempts: 5,
    });

    expect(deps.redisStore.has(activeKey)).toBe(false);
    expect(JSON.parse(deps.redisStore.get(cacheKey) ?? '{}')).toEqual(
      expect.objectContaining({
        status: EBaileysConnectionStatus.disconnected,
        code: ECodeMessage.connectionClosed,
        connection_attempt_id: 'attempt-active',
        attempt: 6,
        max_attempts: 5,
      })
    );
    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      'worker:account#account-1',
      expect.objectContaining({
        status: EBaileysConnectionStatus.disconnected,
        connection_attempt_id: 'attempt-active',
        attempt: 6,
        max_attempts: 5,
      })
    );
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
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.online,
        number: '556192037138',
        connection_date: expect.any(String),
      }),
      {
        container_id: 'container-1',
        lifecycle_operation_id: null,
        runtime_container_id: 'container-1',
        runtime_generation: 1,
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        worker_status_id: EWorkerStatus.disponible,
      }
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
        callback: (context: {
          signal: AbortSignal;
          assertActive: () => void;
        }) => Promise<unknown>
      ) => {
        const previous = lockTail;
        let release!: () => void;
        lockTail = new Promise<void>((resolve) => {
          release = resolve;
        });

        await previous;
        try {
          return await callback({
            signal: new AbortController().signal,
            assertActive: () => undefined,
          });
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
        runtime_generation: 1,
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
        runtime_generation: 1,
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
        runtime_generation: 1,
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

  it('replaces the cached QR when the same fenced attempt enters pairing progress', async () => {
    const deps = buildHandler();

    await deps.handler.handleRequestConnectionQrCode(
      {
        worker_id: 'worker-1',
        status: EWorkerStatus.online,
        type: EBaileysConnectionType.qrcode,
      },
      'account-1'
    );
    const cacheKey = `connection:qrcode:${EWorkerType.wwebjs}:worker-1:attempt`;
    deps.redisStore.set(
      cacheKey,
      JSON.stringify({
        code: ECodeMessage.awaitingReadQrCode,
        status: EBaileysConnectionStatus.connecting,
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
        connection_attempt_id: 'uuid-v7',
        runtime_generation: 1,
        qrcode: 'data:image/png;base64,qr',
        qr_pending: false,
        qr_generated_at: new Date().toISOString(),
      })
    );

    const accepted = await (
      deps.handler as unknown as {
        cacheAndPublishQrAttemptState(
          state: IBaileysConnectionState
        ): Promise<boolean>;
      }
    ).cacheAndPublishQrAttemptState({
      code: ECodeMessage.pairingInProgress,
      status: EBaileysConnectionStatus.connecting,
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      connection_attempt_id: 'uuid-v7',
      runtime_generation: 1,
      qrcode: 'data:image/png;base64,stale-copy',
      qr_pending: true,
    });

    expect(accepted).toBe(true);
    const cached = JSON.parse(String(deps.redisStore.get(cacheKey)));
    expect(cached).toEqual(
      expect.objectContaining({
        code: ECodeMessage.pairingInProgress,
        qr_pending: false,
        connection_attempt_id: 'uuid-v7',
        runtime_generation: 1,
      })
    );
    expect(cached.qrcode).toBeUndefined();
    expect(cached.qr_generated_at).toBeUndefined();
  });

  it('persists connecting only when the active QR attempt enters pairing progress', async () => {
    const deps = buildHandler();

    await deps.handler.handleRequestConnectionQrCode(
      {
        worker_id: 'worker-1',
        status: EWorkerStatus.online,
        type: EBaileysConnectionType.qrcode,
      },
      'account-1'
    );

    await deps.handler.notifyWorkerStatus({
      code: ECodeMessage.pairingInProgress,
      status: EBaileysConnectionStatus.connecting,
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      worker_status_id: EWorkerStatus.disponible,
      connection_attempt_id: 'uuid-v7',
      runtime_generation: 1,
      qr_pending: false,
      is_new_login: true,
    });

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.connecting,
      }),
      expect.objectContaining({
        worker_status_id: EWorkerStatus.disponible,
        runtime_generation: 1,
      })
    );
    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      'worker:account#account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.connecting,
        code: ECodeMessage.pairingInProgress,
      })
    );
  });

  it.each([
    ['Baileys', EWorkerType.baileys],
    ['WWebJS', EWorkerType.wwebjs],
    ['WhatsMeow', EWorkerType.whatsmeow],
  ])(
    'does not regress an active %s QR attempt from available to offline',
    async (_providerName, workerTypeId) => {
      const deps = buildHandler();
      deps.workerService.viewWorkerForMonitor.mockResolvedValue({
        worker_id: 'worker-1',
        name: 'Canal 1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_status_id: EWorkerStatus.disponible,
        worker_type_id: workerTypeId,
        created_at: null,
        updated_at: null,
        deleted_at: null,
        container_id: 'container-1',
        session_storage: EWorkerSessionStorage.legacy_volume,
        lifecycle_operation_id: null,
        last_connection_check_at: null,
      });
      seedActiveQrAttempt(deps.redisStore, {
        workerTypeId,
        connectionAttemptId: '019feeb4-557b-75ec-9d69-1e6250dbb12e',
        runtimeGeneration: 1,
      });

      await deps.handler.notifyWorkerStatus({
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: workerTypeId,
        worker_status_id: EWorkerStatus.offline,
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitConnection,
        connection_attempt_id: '019feeb4-557b-75ec-9d69-1e6250dbb12e',
        runtime_generation: 1,
        qr_pending: true,
        reason: 'provider_pairing_recovery_pending',
      });

      expect(
        deps.workerService.updateWorkerByIdIfLifecycleMatches
      ).not.toHaveBeenCalled();
      expect(deps.centrifugoService.publishSub).not.toHaveBeenCalled();
      expect(deps.centrifugoService.publish).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['Baileys', EWorkerType.baileys],
    ['WWebJS', EWorkerType.wwebjs],
    ['WhatsMeow', EWorkerType.whatsmeow],
  ])(
    'does not regress an active %s post-scan attempt from connecting to available',
    async (_providerName, workerTypeId) => {
      const deps = buildHandler();
      deps.workerService.viewWorkerForMonitor.mockResolvedValue({
        worker_id: 'worker-1',
        name: 'Canal 1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_status_id: EWorkerStatus.connecting,
        worker_type_id: workerTypeId,
        created_at: null,
        updated_at: null,
        deleted_at: null,
        container_id: 'container-1',
        session_storage: EWorkerSessionStorage.postgres,
        lifecycle_operation_id: null,
        last_connection_check_at: null,
      });
      seedActiveQrAttempt(deps.redisStore, {
        workerTypeId,
        connectionAttemptId: '019feeb4-557b-75ec-9d69-1e6250dbb12e',
        runtimeGeneration: 1,
      });

      await deps.handler.notifyWorkerStatus({
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: workerTypeId,
        worker_status_id: EWorkerStatus.disponible,
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitConnection,
        connection_attempt_id: '019feeb4-557b-75ec-9d69-1e6250dbb12e',
        runtime_generation: 1,
        qr_pending: false,
      });

      expect(
        deps.workerService.updateWorkerByIdIfLifecycleMatches
      ).not.toHaveBeenCalled();
      expect(deps.centrifugoService.publishSub).not.toHaveBeenCalled();
      expect(deps.centrifugoService.publish).not.toHaveBeenCalled();
    }
  );

  it('accepts a terminal failure from the exact active post-scan attempt', async () => {
    const deps = buildHandler();
    deps.workerService.viewWorkerForMonitor.mockResolvedValue({
      worker_id: 'worker-1',
      name: 'Canal 1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.connecting,
      worker_type_id: EWorkerType.whatsmeow,
      created_at: null,
      updated_at: null,
      deleted_at: null,
      container_id: 'container-1',
      session_storage: EWorkerSessionStorage.postgres,
      lifecycle_operation_id: null,
      last_connection_check_at: null,
    });
    seedActiveQrAttempt(deps.redisStore, {
      workerTypeId: EWorkerType.whatsmeow,
      connectionAttemptId: '019feeb4-557b-75ec-9d69-1e6250dbb12e',
      runtimeGeneration: 1,
    });

    await deps.handler.notifyWorkerStatus({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.whatsmeow,
      worker_status_id: EWorkerStatus.offline,
      status: EBaileysConnectionStatus.disconnected,
      code: ECodeMessage.connectionLost,
      connection_attempt_id: '019feeb4-557b-75ec-9d69-1e6250dbb12e',
      runtime_generation: 1,
      qr_pending: false,
      reason: 'pairing_failed',
    });

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.offline,
      }),
      expect.objectContaining({
        worker_status_id: EWorkerStatus.connecting,
        worker_type_id: EWorkerType.whatsmeow,
        runtime_generation: 1,
      })
    );
  });

  it('rejects pairing progress from another connection attempt', async () => {
    const deps = buildHandler();

    await deps.handler.handleRequestConnectionQrCode(
      {
        worker_id: 'worker-1',
        status: EWorkerStatus.online,
        type: EBaileysConnectionType.qrcode,
      },
      'account-1'
    );

    const accepted = await (
      deps.handler as unknown as {
        cacheAndPublishQrAttemptState(
          state: IBaileysConnectionState
        ): Promise<boolean>;
      }
    ).cacheAndPublishQrAttemptState({
      code: ECodeMessage.pairingInProgress,
      status: EBaileysConnectionStatus.connecting,
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      connection_attempt_id: 'attempt-from-another-reader',
      runtime_generation: 1,
      qr_pending: false,
    });

    expect(accepted).toBe(false);
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
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(),
    });
    mockHandlerSleep(deps.handler);
    prepareWarmActivation(deps);

    await deps.handler.activateWarmWorker({
      warm_pool_id: 'warm-1',
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      remove_session: true,
      remove_volume: true,
    });

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        container_id: 'replacement-container-id',
        worker_status_id: EWorkerStatus.disponible,
        number: null,
        connection_date: null,
      }),
      expect.objectContaining({
        lifecycle_operation_id: null,
        runtime_container_id: 'replacement-container-id',
        runtime_generation: 5,
        server_id: 'server-1',
        worker_status_id: EWorkerStatus.creating,
        worker_type_id: EWorkerType.baileys,
      })
    );
    expect(
      deps.workerWarmPoolRepository.deleteAssignedByWorkerId
    ).toHaveBeenCalledWith('worker-1', 'warm-1');
  });

  it('never replaces a previous-provider legacy runtime during warm activation', async () => {
    let persistedRuntimeGeneration: number | null = 7;
    const workerRuntimeRepository = {
      viewByWorkerId: jest.fn(async () =>
        persistedRuntimeGeneration === null
          ? null
          : {
              worker_id: 'worker-1',
              container_id: 'container-old',
              container_name: 'worker-1',
              session_volume_name: 'old-volume',
              runtime_generation: persistedRuntimeGeneration,
            }
      ),
      viewByWorkerIdConsistent: jest.fn(async () =>
        persistedRuntimeGeneration === null
          ? null
          : {
              worker_id: 'worker-1',
              container_id: 'container-old',
              container_name: 'worker-1',
              session_volume_name: 'old-volume',
              runtime_generation: persistedRuntimeGeneration,
            }
      ),
      reserveNextRuntimeGeneration: jest.fn(async () => {
        persistedRuntimeGeneration =
          (persistedRuntimeGeneration === null
            ? 0
            : persistedRuntimeGeneration) + 1;
        return persistedRuntimeGeneration;
      }),
      upsert: jest.fn(async (input: { runtime_generation?: number }) => {
        persistedRuntimeGeneration =
          input.runtime_generation ?? persistedRuntimeGeneration;
        return input;
      }),
      deleteByWorkerId: jest.fn(async () => {
        persistedRuntimeGeneration = null;
        return true;
      }),
      isSessionVolumeReferencedByOtherWorkerConsistent: jest.fn(
        async () => false
      ),
    };
    const deps = buildHandler({ workerRuntimeRepository });
    mockHandlerSleep(deps.handler);
    deps.workerWarmPoolRepository.viewByIdConsistent.mockResolvedValue({
      warm_pool_id: 'warm-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      container_id: 'warm-container-id',
      container_name: 'warm-warm-1',
      session_volume_name: 'warm-warm-1',
      state: EWorkerWarmPoolState.reserved,
      reserved_by_worker_id: 'worker-1',
      reservation_expires_at: '2999-01-01T00:00:00.000Z',
    });
    deps.workerService.viewWorkerForMonitor.mockResolvedValue({
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.creating,
      worker_type_id: EWorkerType.baileys,
      session_storage: EWorkerSessionStorage.legacy_volume,
      deleted_at: null,
      container_id: 'container-old',
      lifecycle_operation_id: 'operation-1',
    });
    deps.workerService.createContainerWorker.mockResolvedValue(
      'warm-container-id'
    );
    deps.workerService.inspectContainerWorkerById
      .mockResolvedValueOnce(
        buildWorkerContainerInspection({
          container_id: 'warm-container-id',
          container_name: 'warm-warm-1',
          container_image: 'under-worker-baileys:latest',
          container_image_id: WORKER_IMAGE_CONTENT_ID,
          container_labels: {
            'underchat.server_id': 'server-1',
            'underchat.warm_pool_id': 'warm-1',
            'underchat.warm_standby': 'true',
            'underchat.worker_type_id': EWorkerType.baileys,
            'underchat.worker_image': 'under-worker-baileys:latest',
            'underchat.worker_grpc_port': '50052',
            'underchat.session_volume_name': 'warm-warm-1',
          },
          container_env: {
            WARM_STANDBY: 'true',
            WARM_POOL_ID: 'warm-1',
            WORKER_TYPE_ID: EWorkerType.baileys,
            WORKER_IMAGE: 'under-worker-baileys:latest',
            WORKER_GRPC_PORT: '50052',
            SESSION_VOLUME_NAME: 'warm-warm-1',
          },
        })
      )
      .mockResolvedValueOnce(
        buildWorkerContainerInspection({
          container_id: 'warm-container-id',
          container_name: 'warm-warm-1',
          container_image: 'under-worker-baileys:latest',
          container_image_id: WORKER_IMAGE_CONTENT_ID,
          container_labels: {
            'underchat.server_id': 'server-1',
            'underchat.warm_pool_id': 'warm-1',
            'underchat.warm_standby': 'true',
            'underchat.worker_type_id': EWorkerType.baileys,
            'underchat.worker_image': 'under-worker-baileys:latest',
            'underchat.worker_grpc_port': '50052',
            'underchat.session_volume_name': 'warm-warm-1',
          },
          container_env: {
            WARM_STANDBY: 'true',
            WARM_POOL_ID: 'warm-1',
            WORKER_TYPE_ID: EWorkerType.baileys,
            WORKER_IMAGE: 'under-worker-baileys:latest',
            WORKER_GRPC_PORT: '50052',
            SESSION_VOLUME_NAME: 'warm-warm-1',
          },
        })
      )
      .mockResolvedValueOnce(
        buildWorkerContainerInspection({
          exists: true,
          container_id: 'container-old',
          container_name: 'worker-1',
          container_image: 'under-worker-whatsmeow:latest',
          container_labels: {
            'underchat.worker_id': 'worker-1',
            'underchat.account_id': 'account-1',
            'underchat.server_id': 'server-1',
            'underchat.worker_type_id': EWorkerType.whatsmeow,
            'underchat.worker_image': 'under-worker-whatsmeow:latest',
            'underchat.worker_grpc_port': '50054',
            'underchat.session_volume_name': 'old-volume',
            'underchat.runtime_generation': '7',
          },
          container_env: {
            WORKER_ID: 'worker-1',
            ACCOUNT_ID: 'account-1',
            WORKER_TYPE_ID: EWorkerType.whatsmeow,
            WORKER_IMAGE: 'under-worker-whatsmeow:latest',
            WORKER_GRPC_PORT: '50054',
            SESSION_VOLUME_NAME: 'old-volume',
            RUNTIME_GENERATION: '7',
          },
          running: true,
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
          exists: false,
          container_name: 'worker-1',
          running: false,
        })
      )
      .mockResolvedValueOnce(
        buildWarmContainerInspection({
          container_name: 'warm-warm-1',
          container_labels: {
            ...buildWarmContainerInspection().container_labels,
            'underchat.warm_pool_id': 'warm-1',
            'underchat.session_volume_name': 'warm-warm-1',
          },
          container_env: {
            ...buildWarmContainerInspection().container_env,
            WARM_POOL_ID: 'warm-1',
            SESSION_VOLUME_NAME: 'warm-warm-1',
          },
        })
      )
      .mockResolvedValue(
        buildActivatedWarmContainerInspection({
          container_id: 'warm-container-id',
          container_labels: {
            ...buildActivatedWarmContainerInspection().container_labels,
            'underchat.runtime_generation': '8',
          },
          container_env: {
            ...buildActivatedWarmContainerInspection().container_env,
            RUNTIME_GENERATION: '8',
          },
        })
      );

    await expect(
      deps.handler.activateWarmWorker({
        warm_pool_id: 'warm-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        previous_worker_type_id: EWorkerType.whatsmeow,
        session_storage: EWorkerSessionStorage.legacy_volume,
        remove_session: true,
        remove_volume: true,
        lifecycle_operation_id: 'operation-1',
      })
    ).rejects.toThrow('worker_type_change_requires_postgres_session');

    expect(workerRuntimeRepository.upsert).not.toHaveBeenCalled();
    expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();
    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
    expect(deps.workerService.removeVolumeByName).not.toHaveBeenCalled();
    expect(workerRuntimeRepository.deleteByWorkerId).not.toHaveBeenCalled();
    expect(persistedRuntimeGeneration).toBe(7);
  });

  it('atomically tombstones a failed assigned warm activation after physical cleanup', async () => {
    const workerRuntimeRepository = buildSelfHealRuntimeRepository();
    const deps = buildHandler({ workerRuntimeRepository });
    mockHandlerSleep(deps.handler);
    prepareWarmActivation(deps);
    deps.workerService.inspectContainerWorkerById.mockResolvedValue(
      buildActivatedWarmContainerInspection()
    );
    deps.workerService.updateWorkerById.mockResolvedValue(false);
    deps.workerService.updateWorkerByIdIfLifecycleMatches.mockResolvedValue(
      false
    );

    await expect(
      deps.handler.activateWarmWorker({
        warm_pool_id: 'warm-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
      })
    ).resolves.toEqual(
      expect.objectContaining({
        claimed: false,
        error: 'confirmed_cleanup',
      })
    );

    expect(
      deps.workerWarmPoolRepository.finalizeFailedActivationCleanup
    ).toHaveBeenCalledWith({
      warmPoolId: 'warm-1',
      reservedByWorkerId: 'worker-1',
      accountId: 'account-1',
      serverId: 'server-1',
      workerTypeId: EWorkerType.baileys,
      lifecycleOperationId: null,
      expectedWarmState: EWorkerWarmPoolState.assigned,
      expectedWarmContainerId: 'replacement-container-id',
      runtimeGeneration: 5,
      runtimeContainerId: 'replacement-container-id',
      sessionVolumeName: 'warm-warm-1',
      tombstoneSessionVolumeName: 'retired-warm-warm-1-5',
      pendingError: expect.stringContaining('warm_activation_cleanup_pending'),
      error: expect.stringContaining('warm_activation_lifecycle_changed'),
    });
    expect(deps.workerService.removeContainerWorkerById).toHaveBeenCalledWith(
      'replacement-container-id'
    );
    expect(
      deps.workerService.removeFailedWarmActivationVolumeByProof
    ).toHaveBeenCalledWith('warm-warm-1', 'signature:warm-warm-1');
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
    deps.workerRuntimeRepository.viewByWorkerId.mockResolvedValueOnce(null);
    (
      deps.workerRuntimeRepository.viewByWorkerIdConsistent as jest.Mock
    ).mockResolvedValueOnce(null);
    (
      deps.workerRuntimeRepository.reserveNextRuntimeGeneration as jest.Mock
    ).mockResolvedValueOnce(1);

    await handleWorkerCommand(deps, {
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
        runtimeGeneration: 1,
      }),
      undefined,
      expect.objectContaining({
        requireContainerNameAvailable: true,
        beforeStart: expect.any(Function),
      })
    );

    const availableUpdateIndex =
      deps.workerService.updateWorkerByIdIfLifecycleMatches.mock.calls.findIndex(
        ([, input]) =>
          getWorkerStatusFromUpdateInput(input) === EWorkerStatus.disponible
      );
    expect(availableUpdateIndex).toBeGreaterThan(-1);
    expect(
      deps.workerBaileysGrpcClientService.waitForReady.mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      deps.workerService.updateWorkerByIdIfLifecycleMatches.mock
        .invocationCallOrder[availableUpdateIndex]
    );
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches.mock.calls[
        availableUpdateIndex
      ]?.[2]
    ).toEqual(
      expect.objectContaining({
        lifecycle_operation_id: null,
        worker_status_id: EWorkerStatus.creating,
        runtime_container_id: 'container-1',
        runtime_generation: 1,
      })
    );
  });

  it('rejects a compatibility-v1 create once a v2 lifecycle owns the worker', async () => {
    const deps = buildHandler();
    deps.workerService.viewWorkerForMonitor.mockResolvedValue({
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.creating,
      worker_type_id: EWorkerType.wwebjs,
      container_id: null,
      lifecycle_operation_id: 'new-v2-operation',
      deleted_at: null,
    });

    await handleWorkerCommand(deps, {
      action: EWorkerAction.create,
      worker_id: 'worker-1',
      server_id: 'server-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
    });

    expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
    expect(deps.workerService.updateWorkerById).not.toHaveBeenCalled();
  });

  it('atomically finalizes create only while the lifecycle is still creating', async () => {
    const deps = buildHandler();
    deps.workerService.viewWorkerForMonitor.mockResolvedValue({
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.creating,
      worker_type_id: EWorkerType.wwebjs,
      container_id: null,
      lifecycle_operation_id: 'create-operation-1',
    });

    await handleWorkerCommand(deps, {
      action: EWorkerAction.create,
      worker_id: 'worker-1',
      server_id: 'server-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      lifecycle_operation_id: 'create-operation-1',
    });

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.disponible,
        lifecycle_operation_id: null,
      }),
      expect.objectContaining({
        lifecycle_operation_id: 'create-operation-1',
        worker_status_id: EWorkerStatus.creating,
      })
    );
  });

  it('claims a v1 reserved runtime snapshot before a cold WhatsApp worker can start', async () => {
    const containerId = 'e'.repeat(64);
    const events: string[] = [];
    let runtime: Record<string, unknown> | null = null;
    const runtimeRepository = {
      ...buildSelfHealRuntimeRepository(1, containerId),
      viewByWorkerId: jest.fn(async () => (runtime ? { ...runtime } : null)),
      viewByWorkerIdConsistent: jest.fn(async () =>
        runtime ? { ...runtime } : null
      ),
      reserveNextRuntimeGeneration: jest.fn(async () => {
        runtime = {
          worker_id: 'worker-1',
          container_id: null,
          container_name: 'worker-1',
          session_storage: EWorkerSessionStorage.postgres,
          session_volume_name: null,
          runtime_generation: 1,
          warm_pool_id: null,
          source_provider: null,
        };
        return 1;
      }),
      prepareRuntimeWriterIdentity: jest.fn(
        async (input: Record<string, unknown>) => {
          runtime = {
            ...runtime,
            runtime_capability_hash: input.runtime_capability_hash,
            session_writer_epoch: input.session_writer_epoch,
          };
          return true;
        }
      ),
      claimReservedRuntimeContainer: jest.fn(async () => {
        events.push('runtime-cas');
        runtime = { ...runtime, container_id: containerId };
        return true;
      }),
      upsert: jest.fn(async (input: Record<string, unknown>) => {
        runtime = { ...runtime, ...input };
        return { ...runtime };
      }),
    };
    const deps = buildHandler({ workerRuntimeRepository: runtimeRepository });
    deps.workerService.viewWorkerForMonitor.mockResolvedValue({
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.creating,
      worker_type_id: EWorkerType.wwebjs,
      container_id: null,
      runtime_container_id: null,
      lifecycle_operation_id: null,
      session_storage: EWorkerSessionStorage.postgres,
      deleted_at: null,
    });
    deps.workerService.createContainerWorker.mockImplementation(
      async (...args: unknown[]) => {
        const createOptions = args.at(-1) as {
          beforeStart?: (createdContainerId: string) => Promise<void>;
        };
        await createOptions.beforeStart?.(containerId);
        events.push('start');
        return containerId;
      }
    );

    await handleWorkerCommand(deps, {
      action: EWorkerAction.create,
      worker_id: 'worker-1',
      server_id: 'server-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      session_storage: EWorkerSessionStorage.postgres,
    });

    expect(events).toEqual(['runtime-cas', 'start']);
    expect(
      runtimeRepository.claimReservedRuntimeContainer
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_id: 'worker-1',
        container_id: containerId,
        lifecycle_operation_id: null,
        runtime_generation: 1,
        expected_worker_status_id: EWorkerStatus.creating,
        session_storage: EWorkerSessionStorage.postgres,
        session_volume_name: null,
      })
    );
  });

  it('adopts a v1 pre-start cold runtime after Balance restart without rotating its writer identity', async () => {
    const containerId = 'd'.repeat(64);
    const runtimeGeneration = 9;
    const runtimeCapabilityHash = createHash('sha256')
      .update(WARM_RUNTIME_CAPABILITY)
      .digest('hex');
    const persistedRuntime = {
      worker_id: 'worker-1',
      container_id: containerId,
      container_name: 'worker-1',
      session_storage: EWorkerSessionStorage.postgres,
      session_volume_name: null,
      runtime_capability_hash: runtimeCapabilityHash,
      session_writer_epoch: WARM_RUNTIME_WRITER_EPOCH,
      runtime_generation: runtimeGeneration,
      warm_pool_id: null,
      source_provider: null,
      connection_sequence: 0,
    };
    const runtimeRepository = {
      ...buildSelfHealRuntimeRepository(runtimeGeneration, containerId),
      viewByWorkerId: jest.fn(async () => ({ ...persistedRuntime })),
      viewByWorkerIdConsistent: jest.fn(async () => ({ ...persistedRuntime })),
      reserveNextRuntimeGeneration: jest.fn(async () =>
        Promise.reject(new Error('must not reserve a replacement generation'))
      ),
      prepareRuntimeWriterIdentity: jest.fn(async () =>
        Promise.reject(new Error('must not rotate the writer identity'))
      ),
    };
    const deps = buildHandler({ workerRuntimeRepository: runtimeRepository });
    let running = false;
    const inspection = (): WorkerContainerInspection =>
      buildWorkerContainerInspection({
        container_id: containerId,
        container_image_id: WORKER_IMAGE_CONTENT_ID,
        container_labels: {
          'underchat.worker_id': 'worker-1',
          'underchat.account_id': 'account-1',
          'underchat.server_id': 'server-1',
          'underchat.worker_type_id': EWorkerType.wwebjs,
          'underchat.worker_image': 'under-worker-wwebjs:latest',
          'underchat.worker_image_content_id': WORKER_IMAGE_CONTENT_ID,
          'underchat.worker_grpc_port': '50053',
          'underchat.runtime_generation': String(runtimeGeneration),
          'underchat.session_storage': EWorkerSessionStorage.postgres,
        },
        container_env: {
          WORKER_ID: 'worker-1',
          ACCOUNT_ID: 'account-1',
          WORKER_TYPE_ID: EWorkerType.wwebjs,
          WORKER_IMAGE: 'under-worker-wwebjs:latest',
          WORKER_GRPC_PORT: '50053',
          RUNTIME_GENERATION: String(runtimeGeneration),
          WORKER_SESSION_STORAGE: EWorkerSessionStorage.postgres,
        },
        container_mounts: [],
        container_state: running ? 'running' : 'created',
        container_status: running ? 'running' : 'created',
        running,
      });
    deps.workerService.inspectContainerWorkerByIdStrict.mockImplementation(
      async () => inspection()
    );
    deps.workerService.startContainerWorkerById.mockImplementation(async () => {
      running = true;
      return true;
    });
    deps.workerService.viewWorkerForMonitor.mockResolvedValue({
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.creating,
      worker_type_id: EWorkerType.wwebjs,
      container_id: null,
      runtime_container_id: containerId,
      runtime_generation: runtimeGeneration,
      session_storage: EWorkerSessionStorage.postgres,
      lifecycle_operation_id: null,
      deleted_at: null,
    });

    await handleWorkerCommand(deps, {
      action: EWorkerAction.create,
      worker_id: 'worker-1',
      server_id: 'server-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      session_storage: EWorkerSessionStorage.postgres,
    });

    expect(
      deps.workerService.inspectRuntimeWriterIdentityByContainerIdStrict
    ).toHaveBeenCalledWith(containerId);
    expect(deps.workerService.startContainerWorkerById).toHaveBeenCalledWith(
      containerId
    );
    expect(
      runtimeRepository.reserveNextRuntimeGeneration
    ).not.toHaveBeenCalled();
    expect(
      runtimeRepository.prepareRuntimeWriterIdentity
    ).not.toHaveBeenCalled();
    expect(
      deps.workerService.ensureWorkerImageContentId
    ).not.toHaveBeenCalled();
    expect(deps.workerService.inspectImageContentId).not.toHaveBeenCalled();
    expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();
  });

  it('adopts a persisted recreate runtime only when Docker and its immutable image label match the resolved SHA', async () => {
    const harness = buildPersistedColdRecreateImageHarness({
      containerImageContentId: WORKER_IMAGE_CONTENT_ID,
    });

    await expect(
      harness.handler.performRecreateWorker(harness.payload, harness.lease)
    ).resolves.toEqual({ adopted: true });

    expect(harness.finalizeAdoptedRecreateRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        containerId: harness.containerId,
        runtimeGeneration: harness.runtimeGeneration,
      })
    );
    expect(
      harness.deps.workerService.stopContainerWorkerByIdGracefully
    ).not.toHaveBeenCalled();
    expect(
      harness.deps.workerService.removeContainerWorkerById
    ).not.toHaveBeenCalled();
    expect(
      harness.runtimeRepository.reserveNextRuntimeGeneration
    ).not.toHaveBeenCalled();
    expect(
      harness.deps.workerService.createContainerWorker
    ).not.toHaveBeenCalled();
  });

  it('adopts the exact cold target when provider ONLINE wins before marker even after the mutable image alias advances', async () => {
    const pinnedTargetImageContentId = `sha256:${'b'.repeat(64)}`;
    const harness = buildPersistedColdRecreateImageHarness({
      containerImageContentId: pinnedTargetImageContentId,
    });
    harness.currentWorker.worker_status_id = EWorkerStatus.online;
    harness.currentWorker.container_id = harness.containerId;

    await expect(
      harness.handler.performRecreateWorker(harness.payload, harness.lease)
    ).resolves.toEqual({ adopted: true });

    expect(
      harness.runtimeRepository.markRecreateBootstrapStarted
    ).toHaveBeenCalledWith({
      worker_id: harness.payload.worker_id,
      account_id: harness.payload.account_id,
      server_id: harness.payload.server_id,
      lifecycle_operation_id: harness.payload.lifecycle_operation_id,
      runtime_generation: harness.runtimeGeneration,
      container_id: harness.containerId,
    });
    expect(harness.finalizeAdoptedRecreateRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        containerId: harness.containerId,
        runtimeGeneration: harness.runtimeGeneration,
      })
    );
    expect(
      harness.deps.workerService.stopContainerWorkerByIdGracefully
    ).not.toHaveBeenCalled();
    expect(
      harness.deps.workerService.removeContainerWorkerById
    ).not.toHaveBeenCalled();
    expect(
      harness.runtimeRepository.reserveNextRuntimeGeneration
    ).not.toHaveBeenCalled();
    expect(
      harness.deps.workerService.createContainerWorker
    ).not.toHaveBeenCalled();
    const retainedLog = harness.logDebug.mock.calls.find(
      ([event]) =>
        event === 'service.worker_runtime.cold_runtime_adoption_retained'
    )?.[1];
    expect(retainedLog).toEqual(
      expect.objectContaining({
        reason: 'operation_pinned_online_target_image_retained',
      })
    );
    expect(retainedLog).not.toHaveProperty('container_id');
    expect(JSON.stringify(retainedLog)).not.toContain(
      pinnedTargetImageContentId
    );
    expect(JSON.stringify(retainedLog)).not.toContain(WORKER_IMAGE_CONTENT_ID);
  });

  it('removes a consistently identified stale-image PostgreSQL runtime and provisions generation plus one with the pinned SHA', async () => {
    const staleImageContentId = `sha256:${'b'.repeat(64)}`;
    const harness = buildPersistedColdRecreateImageHarness({
      containerImageContentId: staleImageContentId,
    });
    const stopAfterProvision = new Error('stop_after_stale_image_provision');
    harness.checkRecreatedContainerHealth.mockRejectedValueOnce(
      stopAfterProvision
    );

    await expect(
      harness.handler.performRecreateWorker(harness.payload, harness.lease)
    ).rejects.toBe(stopAfterProvision);

    expect(
      harness.deps.workerService.stopContainerWorkerByIdGracefully
    ).toHaveBeenCalledWith(harness.containerId);
    expect(
      harness.deps.workerService.removeContainerWorkerById
    ).toHaveBeenCalledTimes(1);
    expect(
      harness.deps.workerService.removeContainerWorkerById
    ).toHaveBeenCalledWith(harness.containerId);
    expect(harness.hasTargetContainer()).toBe(false);
    expect(
      harness.resolveRecreateRuntimeRemovalDecision
    ).not.toHaveBeenCalled();
    expect(
      harness.runtimeRepository.reserveNextRuntimeGeneration
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_id: harness.payload.worker_id,
        session_storage: EWorkerSessionStorage.postgres,
        session_volume_name: null,
      })
    );
    expect(
      harness.deps.workerService.createContainerWorker
    ).toHaveBeenCalledWith(
      'under-worker-wwebjs:latest',
      harness.payload.worker_id,
      harness.payload.account_id,
      false,
      expect.any(String),
      expect.any(Number),
      undefined,
      expect.objectContaining({ runtimeGeneration: 10 }),
      undefined,
      expect.objectContaining({
        imageContentId: WORKER_IMAGE_CONTENT_ID,
        requireContainerNameAvailable: true,
      })
    );
    expect(
      harness.runtimeRepository.deletePostgresWhatsappSessionByWorkerId
    ).not.toHaveBeenCalled();
    expect(
      harness.deps.workerService.removeVolumeByName
    ).not.toHaveBeenCalled();
    expect(
      harness.deps.workerService.removeWorkerVolumeByProof
    ).not.toHaveBeenCalled();
    expect(
      harness.deps.workerService.removeContainerWorkerById.mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      harness.runtimeRepository.reserveNextRuntimeGeneration.mock
        .invocationCallOrder[0]
    );
    expect(
      harness.runtimeRepository.reserveNextRuntimeGeneration.mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      harness.deps.workerService.createContainerWorker.mock
        .invocationCallOrder[0]
    );
    const driftLog = harness.logDebug.mock.calls.find(
      ([event]) =>
        event === 'service.worker_runtime.cold_runtime_adoption_skipped'
    )?.[1];
    expect(driftLog).toEqual(
      expect.objectContaining({ reason: 'immutable_image_content_drift' })
    );
    expect(driftLog).not.toHaveProperty('container_id');
    expect(JSON.stringify(driftLog)).not.toContain(staleImageContentId);
    expect(JSON.stringify(driftLog)).not.toContain(WORKER_IMAGE_CONTENT_ID);
  });

  it('fails closed without Docker mutation when the actual image and immutable image label disagree', async () => {
    const labelledImageContentId = `sha256:${'b'.repeat(64)}`;
    const harness = buildPersistedColdRecreateImageHarness({
      containerImageContentId: WORKER_IMAGE_CONTENT_ID,
      labelledImageContentId,
    });

    await expect(
      harness.handler.performRecreateWorker(harness.payload, harness.lease)
    ).rejects.toThrow('worker_cold_runtime_adoption_image_identity_mismatch');

    expect(
      harness.deps.workerService.stopContainerWorkerByIdGracefully
    ).not.toHaveBeenCalled();
    expect(
      harness.deps.workerService.removeContainerWorkerById
    ).not.toHaveBeenCalled();
    expect(
      harness.runtimeRepository.reserveNextRuntimeGeneration
    ).not.toHaveBeenCalled();
    expect(
      harness.deps.workerService.createContainerWorker
    ).not.toHaveBeenCalled();
  });

  it('rejects an invalid resolved recreate image invariant before inspecting or mutating Docker', async () => {
    const harness = buildPersistedColdRecreateImageHarness({
      containerImageContentId: WORKER_IMAGE_CONTENT_ID,
    });
    harness.resolveStableWorkerImageContentId.mockResolvedValueOnce(
      'under-worker-wwebjs:latest'
    );

    await expect(
      harness.handler.performRecreateWorker(harness.payload, harness.lease)
    ).rejects.toThrow(
      'worker_cold_runtime_adoption_expected_image_content_id_invalid'
    );

    expect(
      harness.deps.workerService.inspectContainerWorkerByIdStrict
    ).not.toHaveBeenCalled();
    expect(
      harness.deps.workerService.stopContainerWorkerByIdGracefully
    ).not.toHaveBeenCalled();
    expect(
      harness.deps.workerService.removeContainerWorkerById
    ).not.toHaveBeenCalled();
    expect(
      harness.runtimeRepository.reserveNextRuntimeGeneration
    ).not.toHaveBeenCalled();
    expect(
      harness.deps.workerService.createContainerWorker
    ).not.toHaveBeenCalled();
  });

  it('removes only the stale target runtime during a cross-server PostgreSQL provider handoff and skips generic source removal', async () => {
    const staleImageContentId = `sha256:${'b'.repeat(64)}`;
    const sourceContainerId = 'e'.repeat(64);
    const harness = buildPersistedColdRecreateImageHarness({
      containerImageContentId: staleImageContentId,
      currentWorkerType: EWorkerType.baileys,
      currentWorkerContainerId: sourceContainerId,
      targetAuthorized: true,
      payload: {
        previous_worker_type_id: EWorkerType.baileys,
        previous_server_id: 'server-source',
      },
    });
    const stopAfterProvision = new Error(
      'stop_after_cross_server_stale_target_provision'
    );
    harness.checkRecreatedContainerHealth.mockRejectedValueOnce(
      stopAfterProvision
    );

    await expect(
      harness.handler.performRecreateWorker(harness.payload, harness.lease)
    ).rejects.toBe(stopAfterProvision);

    expect(
      harness.deps.workerService.removeContainerWorkerById
    ).toHaveBeenCalledTimes(1);
    expect(
      harness.deps.workerService.removeContainerWorkerById
    ).toHaveBeenCalledWith(harness.containerId);
    expect(
      harness.deps.workerService.removeContainerWorkerById
    ).not.toHaveBeenCalledWith(sourceContainerId);
    expect(
      harness.resolveRecreateRuntimeRemovalDecision
    ).not.toHaveBeenCalled();
    expect(
      harness.deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
    expect(
      harness.runtimeRepository.deletePostgresWhatsappSessionByWorkerId
    ).not.toHaveBeenCalled();
    expect(
      harness.deps.workerService.createContainerWorker
    ).toHaveBeenCalledWith(
      expect.any(String),
      harness.payload.worker_id,
      harness.payload.account_id,
      false,
      expect.any(String),
      expect.any(Number),
      undefined,
      expect.objectContaining({ runtimeGeneration: 10 }),
      undefined,
      expect.objectContaining({ imageContentId: WORKER_IMAGE_CONTENT_ID })
    );
  });

  it.each([
    {
      label: 'before target activation',
      runtimeSourceProvider: null,
      connectionEpoch: null,
      connectionSequence: 0,
      connectionActivatedAt: null,
    },
    {
      label: 'after target activation',
      runtimeSourceProvider: 'wwebjs',
      connectionEpoch: 'target-connection-epoch-9',
      connectionSequence: 4,
      connectionActivatedAt: '2026-08-07T03:30:00.000Z',
    },
  ])(
    'redelivers after a stale target removal crash in a cross-server PostgreSQL handoff without touching the source ($label)',
    async ({
      runtimeSourceProvider,
      connectionEpoch,
      connectionSequence,
      connectionActivatedAt,
    }) => {
      const sourceContainerId = 'e'.repeat(64);
      const harness = buildPersistedColdRecreateImageHarness({
        containerImageContentId: `sha256:${'b'.repeat(64)}`,
        currentWorkerType: EWorkerType.baileys,
        currentWorkerContainerId: sourceContainerId,
        targetAuthorized: true,
        targetContainerExists: false,
        runtimeSourceProvider,
        connectionEpoch,
        connectionSequence,
        connectionActivatedAt,
        payload: {
          previous_worker_type_id: EWorkerType.baileys,
          previous_server_id: 'server-source',
        },
      });
      const stopAfterProvision = new Error(
        'stop_after_absent_cross_server_target_reprovision'
      );
      harness.checkRecreatedContainerHealth.mockRejectedValueOnce(
        stopAfterProvision
      );

      await expect(
        harness.handler.performRecreateWorker(harness.payload, harness.lease)
      ).rejects.toBe(stopAfterProvision);

      expect(
        harness.runtimeRepository.isWhatsappProviderHandoffTargetAuthorized
      ).toHaveBeenCalledTimes(2);
      expect(
        harness.runtimeRepository.isWhatsappProviderHandoffTargetAuthorized
      ).toHaveBeenNthCalledWith(1, {
        worker_id: harness.payload.worker_id,
        account_id: harness.payload.account_id,
        lifecycle_operation_id: harness.payload.lifecycle_operation_id,
        target_worker_type_id: harness.payload.worker_type_id,
      });
      expect(
        harness.resolveRecreateRuntimeRemovalDecision
      ).not.toHaveBeenCalled();
      expect(
        harness.deps.workerService.stopContainerWorkerByIdGracefully
      ).not.toHaveBeenCalled();
      expect(
        harness.deps.workerService.removeContainerWorkerById
      ).not.toHaveBeenCalled();
      expect(
        harness.deps.workerService.updateWorkerByIdIfLifecycleMatches
      ).not.toHaveBeenCalled();
      expect(
        harness.runtimeRepository.reserveNextRuntimeGeneration
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          worker_id: harness.payload.worker_id,
          session_storage: EWorkerSessionStorage.postgres,
          session_volume_name: null,
        })
      );
      expect(
        harness.deps.workerService.createContainerWorker
      ).toHaveBeenCalledWith(
        'under-worker-wwebjs:latest',
        harness.payload.worker_id,
        harness.payload.account_id,
        false,
        expect.any(String),
        expect.any(Number),
        undefined,
        expect.objectContaining({ runtimeGeneration: 10 }),
        undefined,
        expect.objectContaining({
          imageContentId: WORKER_IMAGE_CONTENT_ID,
          requireContainerNameAvailable: true,
        })
      );
      expect(
        harness.runtimeRepository.deletePostgresWhatsappSessionByWorkerId
      ).not.toHaveBeenCalled();
      expect(
        harness.deps.workerService.removeWorkerVolumeByProof
      ).not.toHaveBeenCalled();
      expect(harness.logDebug).toHaveBeenCalledWith(
        'service.worker_runtime.cold_runtime_absent_handoff_target_recovered',
        expect.objectContaining({
          reason: 'cross_server_postgres_target_absent',
          runtime_generation: harness.runtimeGeneration,
        })
      );
    }
  );

  it.each([
    {
      label: 'empty writer identity',
      runtimeCapabilityHash: null,
      sessionWriterEpoch: null,
    },
    {
      label: 'prepared writer identity',
      runtimeCapabilityHash: createHash('sha256')
        .update(WARM_RUNTIME_CAPABILITY)
        .digest('hex'),
      sessionWriterEpoch: WARM_RUNTIME_WRITER_EPOCH,
    },
  ])(
    'abandons an already-reserved cross-server PostgreSQL handoff generation with $label and fences it with the next generation',
    async ({ runtimeCapabilityHash, sessionWriterEpoch }) => {
      const sourceContainerId = 'e'.repeat(64);
      const harness = buildPersistedColdRecreateImageHarness({
        containerImageContentId: `sha256:${'b'.repeat(64)}`,
        currentWorkerType: EWorkerType.baileys,
        currentWorkerContainerId: sourceContainerId,
        targetAuthorized: true,
        targetContainerExists: false,
        runtimeContainerId: null,
        runtimeCapabilityHash,
        sessionWriterEpoch,
        payload: {
          previous_worker_type_id: EWorkerType.baileys,
          previous_server_id: 'server-source',
        },
      });
      const stopAfterProvision = new Error(
        'stop_after_reserved_cross_server_target_provision'
      );
      harness.checkRecreatedContainerHealth.mockRejectedValueOnce(
        stopAfterProvision
      );

      await expect(
        harness.handler.performRecreateWorker(harness.payload, harness.lease)
      ).rejects.toBe(stopAfterProvision);

      expect(
        harness.runtimeRepository.isWhatsappProviderHandoffTargetAuthorized
      ).toHaveBeenCalledTimes(2);
      expect(
        harness.deps.workerService.inspectContainerWorkerByIdStrict
      ).toHaveBeenCalledTimes(2);
      expect(
        harness.deps.workerService.inspectContainerWorkerByIdStrict
      ).toHaveBeenNthCalledWith(1, harness.payload.worker_id);
      expect(
        harness.deps.workerService.inspectContainerWorkerByIdStrict
      ).not.toHaveBeenCalledWith(sourceContainerId);
      expect(
        harness.resolveRecreateRuntimeRemovalDecision
      ).not.toHaveBeenCalled();
      expect(
        harness.runtimeRepository.reserveNextRuntimeGeneration
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          worker_id: harness.payload.worker_id,
          session_storage: EWorkerSessionStorage.postgres,
          session_volume_name: null,
        })
      );
      expect(
        harness.runtimeRepository.prepareRuntimeWriterIdentity
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          worker_id: harness.payload.worker_id,
          runtime_generation: harness.runtimeGeneration + 1,
        })
      );
      expect(
        harness.deps.workerService.stopContainerWorkerByIdGracefully
      ).not.toHaveBeenCalled();
      expect(
        harness.deps.workerService.removeContainerWorkerById
      ).not.toHaveBeenCalled();
      expect(
        harness.deps.workerService.updateWorkerByIdIfLifecycleMatches
      ).not.toHaveBeenCalled();
      expect(
        harness.runtimeRepository.deletePostgresWhatsappSessionByWorkerId
      ).not.toHaveBeenCalled();
      expect(
        harness.deps.workerService.removeWorkerVolumeByProof
      ).not.toHaveBeenCalled();
      expect(
        harness.deps.workerService.createContainerWorker
      ).toHaveBeenCalledWith(
        'under-worker-wwebjs:latest',
        harness.payload.worker_id,
        harness.payload.account_id,
        false,
        expect.any(String),
        expect.any(Number),
        undefined,
        expect.objectContaining({
          runtimeGeneration: harness.runtimeGeneration + 1,
        }),
        undefined,
        expect.objectContaining({
          imageContentId: WORKER_IMAGE_CONTENT_ID,
          requireContainerNameAvailable: true,
        })
      );
      expect(harness.logDebug).toHaveBeenCalledWith(
        'service.worker_runtime.cold_runtime_reserved_handoff_target_recovered',
        expect.objectContaining({
          reason: 'cross_server_postgres_target_reservation_abandoned',
          runtime_generation: harness.runtimeGeneration,
        })
      );
    }
  );

  it('removes only an exact stopped pre-bind orphan before fencing the abandoned cross-server reservation', async () => {
    const sourceContainerId = 'e'.repeat(64);
    const orphanContainerId = 'f'.repeat(64);
    const orphanImageContentId = `sha256:${'b'.repeat(64)}`;
    const harness = buildPersistedColdRecreateImageHarness({
      containerImageContentId: WORKER_IMAGE_CONTENT_ID,
      currentWorkerType: EWorkerType.baileys,
      currentWorkerContainerId: sourceContainerId,
      targetAuthorized: true,
      targetContainerExists: false,
      runtimeContainerId: null,
      payload: {
        previous_worker_type_id: EWorkerType.baileys,
        previous_server_id: 'server-source',
      },
    });
    const orphanInspection = buildWorkerContainerInspection({
      container_id: orphanContainerId,
      container_name: harness.payload.worker_id,
      container_image_id: orphanImageContentId,
      container_labels: {
        'underchat.worker_id': harness.payload.worker_id,
        'underchat.account_id': harness.payload.account_id,
        'underchat.server_id': harness.payload.server_id,
        'underchat.worker_type_id': EWorkerType.wwebjs,
        'underchat.worker_image': 'under-worker-wwebjs:latest',
        'underchat.worker_image_content_id': orphanImageContentId,
        'underchat.worker_grpc_port': '50053',
        'underchat.runtime_generation': String(harness.runtimeGeneration),
        'underchat.lifecycle_operation_id': harness.payload
          .lifecycle_operation_id as string,
        'underchat.session_storage': EWorkerSessionStorage.postgres,
      },
      container_env: {
        WORKER_ID: harness.payload.worker_id,
        ACCOUNT_ID: harness.payload.account_id,
        WORKER_TYPE_ID: EWorkerType.wwebjs,
        WORKER_IMAGE: 'under-worker-wwebjs:latest',
        WORKER_GRPC_PORT: '50053',
        RUNTIME_GENERATION: String(harness.runtimeGeneration),
        WORKER_SESSION_STORAGE: EWorkerSessionStorage.postgres,
      },
      container_mounts: [],
      container_state: 'created',
      container_status: 'created',
      container_restart_count: 0,
      running: false,
    });
    let orphanExists = true;
    harness.deps.workerService.inspectContainerWorkerByIdStrict.mockImplementation(
      async (target: string) =>
        orphanExists &&
        (target === harness.payload.worker_id || target === orphanContainerId)
          ? { ...orphanInspection }
          : { exists: false, container_name: target }
    );
    harness.deps.workerService.removeContainerWorkerById.mockImplementation(
      async (target: string) => {
        if (target !== orphanContainerId) return false;
        orphanExists = false;
        return true;
      }
    );
    const stopAfterProvision = new Error(
      'stop_after_pre_bind_orphan_reprovision'
    );
    harness.checkRecreatedContainerHealth.mockRejectedValueOnce(
      stopAfterProvision
    );

    await expect(
      harness.handler.performRecreateWorker(harness.payload, harness.lease)
    ).rejects.toBe(stopAfterProvision);

    expect(
      harness.deps.workerService.stopContainerWorkerByIdGracefully
    ).not.toHaveBeenCalled();
    expect(
      harness.deps.workerService.removeContainerWorkerById
    ).toHaveBeenCalledTimes(1);
    expect(
      harness.deps.workerService.removeContainerWorkerById
    ).toHaveBeenCalledWith(orphanContainerId);
    expect(
      harness.deps.workerService.removeContainerWorkerById
    ).not.toHaveBeenCalledWith(sourceContainerId);
    expect(
      harness.resolveRecreateRuntimeRemovalDecision
    ).not.toHaveBeenCalled();
    expect(
      harness.runtimeRepository.reserveNextRuntimeGeneration
    ).toHaveBeenCalledTimes(1);
    expect(
      harness.deps.workerService.createContainerWorker
    ).toHaveBeenCalledWith(
      expect.any(String),
      harness.payload.worker_id,
      harness.payload.account_id,
      false,
      expect.any(String),
      expect.any(Number),
      undefined,
      expect.objectContaining({
        runtimeGeneration: harness.runtimeGeneration + 1,
      }),
      undefined,
      expect.objectContaining({
        imageContentId: WORKER_IMAGE_CONTENT_ID,
        requireContainerNameAvailable: true,
      })
    );
    expect(
      harness.deps.workerService.inspectContainerWorkerByIdStrict.mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      harness.deps.workerService.removeContainerWorkerById.mock
        .invocationCallOrder[0]
    );
    expect(
      harness.deps.workerService.removeContainerWorkerById.mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      harness.runtimeRepository.reserveNextRuntimeGeneration.mock
        .invocationCallOrder[0]
    );
    expect(
      harness.runtimeRepository.reserveNextRuntimeGeneration.mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      harness.deps.workerService.createContainerWorker.mock
        .invocationCallOrder[0]
    );
    expect(
      harness.runtimeRepository.deletePostgresWhatsappSessionByWorkerId
    ).not.toHaveBeenCalled();
    expect(
      harness.deps.workerService.removeWorkerVolumeByProof
    ).not.toHaveBeenCalled();
  });

  it('preserves an exact canonical target that is already running before its pre-bind claim', async () => {
    const sourceContainerId = 'e'.repeat(64);
    const harness = buildPersistedColdRecreateImageHarness({
      containerImageContentId: WORKER_IMAGE_CONTENT_ID,
      currentWorkerType: EWorkerType.baileys,
      currentWorkerContainerId: sourceContainerId,
      targetAuthorized: true,
      targetContainerExists: false,
      canonicalTargetExists: true,
      runtimeContainerId: null,
      payload: {
        previous_worker_type_id: EWorkerType.baileys,
        previous_server_id: 'server-source',
      },
    });

    await expect(
      harness.handler.performRecreateWorker(harness.payload, harness.lease)
    ).rejects.toThrow(
      'worker_cold_runtime_reserved_handoff_target_snapshot_stale'
    );

    expect(
      harness.resolveRecreateRuntimeRemovalDecision
    ).not.toHaveBeenCalled();
    expect(
      harness.runtimeRepository.reserveNextRuntimeGeneration
    ).not.toHaveBeenCalled();
    expect(
      harness.deps.workerService.stopContainerWorkerByIdGracefully
    ).not.toHaveBeenCalled();
    expect(
      harness.deps.workerService.removeContainerWorkerById
    ).not.toHaveBeenCalled();
    expect(
      harness.deps.workerService.inspectContainerWorkerByIdStrict
    ).not.toHaveBeenCalledWith(sourceContainerId);
    expect(
      harness.deps.workerService.createContainerWorker
    ).not.toHaveBeenCalled();
  });

  it('preserves an exact canonical target that was previously started and is now exited', async () => {
    const sourceContainerId = 'e'.repeat(64);
    const exitedContainerId = 'f'.repeat(64);
    const harness = buildPersistedColdRecreateImageHarness({
      containerImageContentId: WORKER_IMAGE_CONTENT_ID,
      currentWorkerType: EWorkerType.baileys,
      currentWorkerContainerId: sourceContainerId,
      targetAuthorized: true,
      targetContainerExists: false,
      runtimeContainerId: null,
      payload: {
        previous_worker_type_id: EWorkerType.baileys,
        previous_server_id: 'server-source',
      },
    });
    const exitedInspection = buildWorkerContainerInspection({
      ...harness.inspection,
      container_id: exitedContainerId,
      container_state: 'exited',
      container_status: 'exited',
      container_restart_count: 0,
      running: false,
    });
    harness.deps.workerService.inspectContainerWorkerByIdStrict.mockResolvedValue(
      exitedInspection
    );

    await expect(
      harness.handler.performRecreateWorker(harness.payload, harness.lease)
    ).rejects.toThrow(
      'worker_cold_runtime_reserved_handoff_target_snapshot_stale'
    );

    expect(
      harness.resolveRecreateRuntimeRemovalDecision
    ).not.toHaveBeenCalled();
    expect(
      harness.runtimeRepository.reserveNextRuntimeGeneration
    ).not.toHaveBeenCalled();
    expect(
      harness.deps.workerService.stopContainerWorkerByIdGracefully
    ).not.toHaveBeenCalled();
    expect(
      harness.deps.workerService.removeContainerWorkerById
    ).not.toHaveBeenCalled();
    expect(
      harness.deps.workerService.createContainerWorker
    ).not.toHaveBeenCalled();
  });

  it('fails closed when cross-server PostgreSQL target authorization changes on the second reserved snapshot', async () => {
    const sourceContainerId = 'e'.repeat(64);
    const harness = buildPersistedColdRecreateImageHarness({
      containerImageContentId: WORKER_IMAGE_CONTENT_ID,
      currentWorkerType: EWorkerType.baileys,
      currentWorkerContainerId: sourceContainerId,
      targetAuthorized: true,
      targetContainerExists: false,
      runtimeContainerId: null,
      runtimeCapabilityHash: null,
      sessionWriterEpoch: null,
      payload: {
        previous_worker_type_id: EWorkerType.baileys,
        previous_server_id: 'server-source',
      },
    });
    harness.runtimeRepository.isWhatsappProviderHandoffTargetAuthorized
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await expect(
      harness.handler.performRecreateWorker(harness.payload, harness.lease)
    ).rejects.toThrow(
      'worker_cold_runtime_reserved_handoff_target_snapshot_stale'
    );

    expect(
      harness.runtimeRepository.isWhatsappProviderHandoffTargetAuthorized
    ).toHaveBeenCalledTimes(2);
    expect(
      harness.resolveRecreateRuntimeRemovalDecision
    ).not.toHaveBeenCalled();
    expect(
      harness.runtimeRepository.reserveNextRuntimeGeneration
    ).not.toHaveBeenCalled();
    expect(
      harness.deps.workerService.stopContainerWorkerByIdGracefully
    ).not.toHaveBeenCalled();
    expect(
      harness.deps.workerService.removeContainerWorkerById
    ).not.toHaveBeenCalled();
    expect(
      harness.deps.workerService.createContainerWorker
    ).not.toHaveBeenCalled();
  });

  it('fails closed when the reserved target runtime generation mutates on the second primary snapshot', async () => {
    const sourceContainerId = 'e'.repeat(64);
    const harness = buildPersistedColdRecreateImageHarness({
      containerImageContentId: WORKER_IMAGE_CONTENT_ID,
      currentWorkerType: EWorkerType.baileys,
      currentWorkerContainerId: sourceContainerId,
      targetAuthorized: true,
      targetContainerExists: false,
      runtimeContainerId: null,
      runtimeCapabilityHash: null,
      sessionWriterEpoch: null,
      payload: {
        previous_worker_type_id: EWorkerType.baileys,
        previous_server_id: 'server-source',
      },
    });
    harness.runtimeRepository.viewByWorkerIdConsistent
      .mockResolvedValueOnce({ ...harness.persistedRuntime })
      .mockResolvedValueOnce({ ...harness.persistedRuntime })
      .mockResolvedValueOnce({
        ...harness.persistedRuntime,
        runtime_generation: harness.runtimeGeneration + 1,
      });

    await expect(
      harness.handler.performRecreateWorker(harness.payload, harness.lease)
    ).rejects.toThrow(
      'worker_cold_runtime_reserved_handoff_target_snapshot_stale'
    );

    expect(
      harness.resolveRecreateRuntimeRemovalDecision
    ).not.toHaveBeenCalled();
    expect(
      harness.runtimeRepository.reserveNextRuntimeGeneration
    ).not.toHaveBeenCalled();
    expect(
      harness.deps.workerService.stopContainerWorkerByIdGracefully
    ).not.toHaveBeenCalled();
    expect(
      harness.deps.workerService.removeContainerWorkerById
    ).not.toHaveBeenCalled();
    expect(
      harness.deps.workerService.createContainerWorker
    ).not.toHaveBeenCalled();
  });

  it('propagates a strict canonical target inspection failure without lifecycle mutation', async () => {
    const sourceContainerId = 'e'.repeat(64);
    const harness = buildPersistedColdRecreateImageHarness({
      containerImageContentId: WORKER_IMAGE_CONTENT_ID,
      currentWorkerType: EWorkerType.baileys,
      currentWorkerContainerId: sourceContainerId,
      targetAuthorized: true,
      targetContainerExists: false,
      runtimeContainerId: null,
      runtimeCapabilityHash: null,
      sessionWriterEpoch: null,
      payload: {
        previous_worker_type_id: EWorkerType.baileys,
        previous_server_id: 'server-source',
      },
    });
    const dockerError = new Error('strict_target_inspection_unavailable');
    harness.deps.workerService.inspectContainerWorkerByIdStrict.mockRejectedValueOnce(
      dockerError
    );

    await expect(
      harness.handler.performRecreateWorker(harness.payload, harness.lease)
    ).rejects.toBe(dockerError);

    expect(
      harness.resolveRecreateRuntimeRemovalDecision
    ).not.toHaveBeenCalled();
    expect(
      harness.runtimeRepository.reserveNextRuntimeGeneration
    ).not.toHaveBeenCalled();
    expect(
      harness.deps.workerService.stopContainerWorkerByIdGracefully
    ).not.toHaveBeenCalled();
    expect(
      harness.deps.workerService.removeContainerWorkerById
    ).not.toHaveBeenCalled();
    expect(
      harness.deps.workerService.createContainerWorker
    ).not.toHaveBeenCalled();
  });

  it('cleans a stale PostgreSQL target before legacy-volume conversion provisions the collision-free target', async () => {
    const staleImageContentId = `sha256:${'b'.repeat(64)}`;
    const harness = buildPersistedColdRecreateImageHarness({
      containerImageContentId: staleImageContentId,
      payload: {
        previous_session_storage: EWorkerSessionStorage.legacy_volume,
        remove_session: true,
        remove_volume: true,
      },
    });
    const stopAfterProvision = new Error(
      'stop_after_legacy_conversion_target_provision'
    );
    harness.checkRecreatedContainerHealth.mockRejectedValueOnce(
      stopAfterProvision
    );

    await expect(
      harness.handler.performRecreateWorker(harness.payload, harness.lease)
    ).rejects.toBe(stopAfterProvision);

    expect(
      harness.deps.workerService.removeContainerWorkerById
    ).toHaveBeenCalledWith(harness.containerId);
    expect(harness.hasTargetContainer()).toBe(false);
    expect(
      harness.resolveRecreateRuntimeRemovalDecision
    ).not.toHaveBeenCalled();
    expect(
      harness.runtimeRepository.deletePostgresWhatsappSessionByWorkerId
    ).toHaveBeenCalledWith({
      worker_id: harness.payload.worker_id,
      account_id: harness.payload.account_id,
      lifecycle_operation_id: harness.payload.lifecycle_operation_id,
      expected_worker_status_id: EWorkerStatus.recreating,
      expected_runtime_generation: harness.runtimeGeneration,
      expected_container_id: harness.containerId,
      expected_runtime_session_storage: EWorkerSessionStorage.postgres,
      expected_session_volume_name: null,
    });
    expect(
      harness.deps.workerService.removeVolumeByName
    ).not.toHaveBeenCalled();
    expect(
      harness.deps.workerService.createContainerWorker
    ).toHaveBeenCalledWith(
      expect.any(String),
      harness.payload.worker_id,
      harness.payload.account_id,
      false,
      expect.any(String),
      expect.any(Number),
      undefined,
      expect.objectContaining({
        runtimeGeneration: 10,
        sessionStorage: EWorkerSessionStorage.postgres,
      }),
      undefined,
      expect.objectContaining({ imageContentId: WORKER_IMAGE_CONTENT_ID })
    );
  });

  it('does not remove the stale-image runtime when its durable generation changes after graceful stop', async () => {
    const staleImageContentId = `sha256:${'b'.repeat(64)}`;
    const harness = buildPersistedColdRecreateImageHarness({
      containerImageContentId: staleImageContentId,
    });
    harness.deps.workerService.stopContainerWorkerByIdGracefully.mockImplementationOnce(
      async () => {
        harness.runtimeRepository.viewByWorkerIdConsistent.mockResolvedValue({
          ...harness.persistedRuntime,
          runtime_generation: harness.runtimeGeneration + 1,
        });
        return true;
      }
    );

    await expect(
      harness.handler.performRecreateWorker(harness.payload, harness.lease)
    ).rejects.toThrow(
      'worker_cold_runtime_stale_image_cleanup_database_identity_changed'
    );

    expect(
      harness.deps.workerService.stopContainerWorkerByIdGracefully
    ).toHaveBeenCalledWith(harness.containerId);
    expect(
      harness.deps.workerService.removeContainerWorkerById
    ).not.toHaveBeenCalled();
    expect(harness.hasTargetContainer()).toBe(true);
    expect(
      harness.runtimeRepository.reserveNextRuntimeGeneration
    ).not.toHaveBeenCalled();
    expect(
      harness.deps.workerService.createContainerWorker
    ).not.toHaveBeenCalled();
  });

  it('uses the primary atomic runtime generation reservation for cold create', async () => {
    const workerRuntimeRepository = {
      viewByWorkerId: jest.fn(async () => null),
      viewByWorkerIdConsistent: jest.fn(async () => null),
      reserveNextRuntimeGeneration: jest.fn(async () => 9),
      upsert: jest.fn(async (input: unknown) => input),
      deleteByWorkerId: jest.fn(async () => true),
    };
    const deps = buildHandler({ workerRuntimeRepository });

    await handleWorkerCommand(deps, {
      action: EWorkerAction.create,
      worker_id: 'worker-1',
      server_id: 'server-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
    });

    expect(
      workerRuntimeRepository.reserveNextRuntimeGeneration
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_id: 'worker-1',
        container_name: 'worker-1',
        session_volume_name: 'worker-1',
      })
    );
    expect(deps.workerService.createContainerWorker).toHaveBeenCalledWith(
      expect.any(String),
      'worker-1',
      'account-1',
      true,
      expect.any(String),
      expect.any(Number),
      undefined,
      expect.objectContaining({ runtimeGeneration: 9 }),
      undefined,
      expect.objectContaining({
        requireContainerNameAvailable: true,
        beforeStart: expect.any(Function),
      })
    );
  });

  it('fails closed when an adopted create volume cannot be inspected strictly', async () => {
    const existingRuntime = {
      worker_id: 'worker-1',
      container_id: null,
      container_name: 'worker-1',
      session_storage: EWorkerSessionStorage.legacy_volume,
      session_volume_name: 'warm-preserved',
      runtime_generation: 4,
    };
    const workerRuntimeRepository = {
      viewByWorkerId: jest.fn(async () => existingRuntime),
      viewByWorkerIdConsistent: jest.fn(async () => existingRuntime),
      reserveNextRuntimeGeneration: jest.fn(async () => 5),
      upsert: jest.fn(async (input: unknown) => input),
      deleteByWorkerId: jest.fn(async () => true),
    };
    const deps = buildHandler({ workerRuntimeRepository });
    const daemonError = new Error('docker daemon unavailable');
    deps.workerService.existsVolumeByNameStrict.mockRejectedValueOnce(
      daemonError
    );

    await expect(
      handleWorkerCommand(deps, {
        action: EWorkerAction.create,
        worker_id: 'worker-1',
        server_id: 'server-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
      })
    ).rejects.toBe(daemonError);

    expect(deps.workerService.existsVolumeByNameStrict).toHaveBeenCalledWith(
      'warm-preserved'
    );
    expect(deps.workerService.existsVolumeByName).not.toHaveBeenCalled();
    expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();
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

    await handleCreateWithRetryProof(deps, {
      action: EWorkerAction.create,
      worker_id: 'worker-1',
      server_id: 'server-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
    });

    expect(deps.workerService.removeContainerWorkerById).toHaveBeenCalledWith(
      'container-bad'
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
      handleCreateWithRetryProof(deps, {
        action: EWorkerAction.create,
        worker_id: 'worker-1',
        server_id: 'server-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
      })
    ).rejects.toThrow('Worker service is not healthy');

    expect(deps.workerService.createContainerWorker).toHaveBeenCalledTimes(2);
    expect(deps.workerService.removeContainerWorkerById).toHaveBeenCalledTimes(
      1
    );
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

    await handleCreateWithRetryProof(deps, {
      action: EWorkerAction.create,
      worker_id: 'worker-1',
      server_id: 'server-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
    });

    expect(deps.workerService.removeContainerWorkerById).toHaveBeenCalledWith(
      'container-1'
    );
    expect(deps.workerService.createContainerWorker).toHaveBeenCalledTimes(2);
  });

  it('marks created workers as error after both gRPC readiness attempts fail', async () => {
    const deps = buildHandler();
    deps.workerBaileysGrpcClientService.waitForReady.mockRejectedValue(
      new Error('gRPC unavailable')
    );

    await expect(
      handleCreateWithRetryProof(deps, {
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

    await handleWorkerCommand(deps, {
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
      handleCreateWithRetryProof(deps, {
        action: EWorkerAction.create,
        worker_id: 'worker-1',
        server_id: 'server-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
      })
    ).rejects.toThrow('gRPC unavailable');

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

    await handleWorkerCommand(deps, {
      action: EWorkerAction.recreate,
      worker_id: 'worker-1',
      server_id: 'server-1',
      account_id: 'account-1',
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

  it.each([EWorkerType.baileys, EWorkerType.wwebjs, EWorkerType.whatsmeow])(
    'finalizes a healthy %s runtime without a restorable session despite deferred provider consumers',
    async (workerType) => {
      const deps = buildHandler({
        runtimeHealthResponse: {
          worker_type_id: workerType,
          activated: true,
          standby: false,
          ready: true,
          qr_stream_ready: true,
          runtime_state: 'active',
          kafka_consumers_ready: false,
          kafka_unhealthy: true,
          session_ready: false,
          authenticated: false,
          has_session: false,
          provider_state: 'not_initialized',
        },
      });
      deps.workerService.viewWorkerForMonitor.mockResolvedValue({
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: workerType,
        container_id: 'container-old',
        lifecycle_operation_id: null,
        deleted_at: null,
      });

      await handleWorkerCommand(deps, {
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        server_id: 'server-1',
        account_id: 'account-1',
        worker_type_id: workerType,
        previous_worker_status_id: EWorkerStatus.error,
      });

      expect(
        deps.workerBaileysGrpcClientService.requestConnection
      ).not.toHaveBeenCalled();
      expect(deps.workerService.updateWorkerById).toHaveBeenCalledWith(
        'account-1',
        expect.objectContaining({
          worker_id: 'worker-1',
          worker_status_id: EWorkerStatus.disponible,
          container_id: 'container-1',
        })
      );
      expect(deps.centrifugoService.publishSubStrict).toHaveBeenCalledWith(
        expect.stringContaining('account-1'),
        expect.objectContaining({
          worker_status_id: EWorkerStatus.disponible,
          lifecycle_phase: 'completed',
          recreate_completed_operation_id: 'test-lifecycle-operation',
          recreate_completed_runtime_generation: 2,
        })
      );
    }
  );

  it('atomically finalizes recreate only while the lifecycle is still recreating', async () => {
    const deps = buildHandler();
    deps.workerService.viewWorkerForMonitor.mockResolvedValue({
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: EWorkerType.wwebjs,
      container_id: 'container-old',
      lifecycle_operation_id: 'recreate-operation-1',
    });

    await handleWorkerCommand(deps, {
      action: EWorkerAction.recreate,
      worker_id: 'worker-1',
      server_id: 'server-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      lifecycle_operation_id: 'recreate-operation-1',
    });

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        lifecycle_operation_id: null,
      }),
      expect.objectContaining({
        lifecycle_operation_id: 'recreate-operation-1',
        container_id: 'container-old',
        runtime_container_id: 'container-1',
        runtime_generation: 2,
        worker_status_id: EWorkerStatus.recreating,
        recreate_completion: {
          operation_id: 'recreate-operation-1',
          runtime_generation: 2,
          mode: 'replacement_runtime',
        },
      })
    );
    const markRecreateBootstrapStarted = deps.workerRuntimeRepository
      .markRecreateBootstrapStarted as jest.Mock;
    expect(markRecreateBootstrapStarted).toHaveBeenCalledWith({
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      lifecycle_operation_id: 'recreate-operation-1',
      runtime_generation: 2,
      container_id: 'container-1',
    });
    expect(
      markRecreateBootstrapStarted.mock.invocationCallOrder[0]
    ).toBeLessThan(
      deps.containerHealthService.checkServiceHealth.mock.invocationCallOrder[0]
    );

    const accountLifecycleEvents =
      deps.centrifugoService.publishSubStrict.mock.calls.map(
        ([, payload]) => payload
      );
    const globalLifecycleEvents = (
      deps.centrifugoService.publishStrict as jest.Mock
    ).mock.calls.map(([, payload]) => payload);
    expect(globalLifecycleEvents).toEqual(accountLifecycleEvents);
    expect(accountLifecycleEvents).toEqual([
      expect.objectContaining({
        lifecycle_phase: 'runtime_started',
        recreate_phase: 'connecting',
        recreate_phase_observed_at: '2026-08-08T00:00:00.000Z',
        connection_status_observed_at: '2026-08-08T00:00:00.000Z',
        runtime_generation: 2,
      }),
      expect.objectContaining({
        lifecycle_phase: 'completed',
        recreate_completed_operation_id: 'recreate-operation-1',
        recreate_completed_runtime_generation: 2,
      }),
    ]);
    for (const event of accountLifecycleEvents) {
      expect(event).not.toHaveProperty('container_id');
    }
  });

  it('retries runtime-started publication from the durable bootstrap timestamp', async () => {
    const deps = buildHandler();
    const lifecycleOperationId = '55555555-5555-7555-8555-555555555555';
    const containerId = 'c'.repeat(64);
    const bootstrapStartedAt = '2026-08-08T00:00:00.321Z';
    const markRecreateBootstrapStarted = deps.workerRuntimeRepository
      .markRecreateBootstrapStarted as jest.Mock;
    markRecreateBootstrapStarted.mockResolvedValue(true);
    (
      deps.workerRuntimeRepository.viewByWorkerIdConsistent as jest.Mock
    ).mockResolvedValue({
      worker_id: 'worker-1',
      container_id: containerId,
      runtime_generation: 7,
      session_storage: EWorkerSessionStorage.postgres,
      session_volume_name: null,
      recreate_bootstrap_operation_id: lifecycleOperationId,
      recreate_bootstrap_runtime_generation: 7,
      recreate_bootstrap_container_id: containerId,
      recreate_bootstrap_started_at: bootstrapStartedAt,
      recreate_retired_operation_id: null,
      recreate_retired_runtime_generation: null,
      recreate_retired_container_id: null,
      recreate_retired_at: null,
    });
    deps.centrifugoService.publishSubStrict.mockRejectedValueOnce(
      new Error('centrifugo account queue unavailable')
    );
    const leaseContext = {
      signal: new AbortController().signal,
      assertActive: jest.fn(),
    };
    const input = {
      data: {
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        lifecycle_operation_id: lifecycleOperationId,
      },
      workerType: EWorkerType.wwebjs,
      containerId,
      runtimeGeneration: 7,
      leaseContext,
    };
    const publishRuntimeStarted = () =>
      (
        deps.handler as unknown as {
          markAndPublishRecreateRuntimeStarted(
            value: typeof input
          ): Promise<void>;
        }
      ).markAndPublishRecreateRuntimeStarted(input);

    await expect(publishRuntimeStarted()).rejects.toThrow(
      'centrifugo account queue unavailable'
    );
    await expect(publishRuntimeStarted()).resolves.toBeUndefined();

    expect(markRecreateBootstrapStarted).toHaveBeenCalledTimes(2);
    const accountEvents =
      deps.centrifugoService.publishSubStrict.mock.calls.map(
        ([, payload]) => payload
      );
    const globalEvents = (
      deps.centrifugoService.publishStrict as jest.Mock
    ).mock.calls.map(([, payload]) => payload);
    expect(accountEvents).toHaveLength(2);
    expect(globalEvents).toHaveLength(2);
    expect(accountEvents[1]).toEqual(accountEvents[0]);
    expect(globalEvents).toEqual(accountEvents);
    expect(accountEvents[0]).toEqual(
      expect.objectContaining({
        lifecycle_phase: 'runtime_started',
        recreate_phase: 'connecting',
        recreate_phase_observed_at: bootstrapStartedAt,
        connection_status_observed_at: bootstrapStartedAt,
        runtime_generation: 7,
      })
    );
  });

  it('keeps the lifecycle fence intact so transient recreate failures can be redelivered', async () => {
    const deps = buildHandler();
    deps.containerHealthService.checkServiceHealth.mockResolvedValue(
      buildContainerHealthResult({
        healthy: false,
        health_failure_reason: 'http_health_not_ready',
      })
    );
    deps.workerService.viewWorkerForMonitor.mockResolvedValue({
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: EWorkerType.wwebjs,
      container_id: 'container-old',
      lifecycle_operation_id: 'recreate-operation-1',
      deleted_at: null,
    });

    await expect(
      handleWorkerCommand(deps, {
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        server_id: 'server-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
        session_storage: EWorkerSessionStorage.legacy_volume,
        lifecycle_operation_id: 'recreate-operation-1',
      })
    ).rejects.toThrow('Worker service is not healthy');

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_status_id: EWorkerStatus.error,
        lifecycle_operation_id: null,
      }),
      expect.anything()
    );
    expect(deps.centrifugoService.publishSub).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ worker_status_id: EWorkerStatus.error })
    );
  });

  it('reports the terminal health probe before a recovery supersedes the recreate lifecycle', async () => {
    const deps = buildHandler();
    let lifecycleCurrent = true;
    const handler = deps.handler as unknown as {
      isLifecycleOperationCurrent: jest.Mock;
      logDebug: jest.Mock;
      resolveRecreateRuntimeRemovalDecision: jest.Mock;
    };
    const logDebug = jest.fn();
    handler.isLifecycleOperationCurrent = jest.fn(async () => lifecycleCurrent);
    handler.logDebug = logDebug;
    handler.resolveRecreateRuntimeRemovalDecision = jest.fn(async () => ({
      status: 'removed',
      reason: 'test_runtime_removed',
    }));
    deps.containerHealthService.checkServiceHealth.mockImplementationOnce(
      async () => {
        lifecycleCurrent = false;
        return buildContainerHealthResult({
          healthy: false,
          health_attempt: 30,
          health_max_attempts: 30,
          health_delay_ms: 1000,
          health_status_code: '000',
          health_duration_ms: 3001,
          health_error: 'curl_exit_code=7; connection refused',
          health_failure_reason: 'http_health_not_ready',
        });
      }
    );

    await expect(
      handleWorkerCommand(deps, {
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        server_id: 'server-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
        session_storage: EWorkerSessionStorage.legacy_volume,
        lifecycle_operation_id: 'recreate-operation-1',
      })
    ).rejects.toThrow(
      'Worker lifecycle changed after container health wait for worker-1'
    );

    const healthNotReady = logDebug.mock.calls.find(
      ([event]) => event === 'service.recreate_worker.health_not_ready'
    );
    expect(healthNotReady).toEqual([
      'service.recreate_worker.health_not_ready',
      expect.objectContaining({
        reason: 'http_health_not_ready',
        health_probe_state: 'not_ready',
        health_error_code: 'connection_refused',
        http_status_code: 0,
        health_attempt: 30,
        health_max_attempts: 30,
        health_delay_ms: 1000,
        health_duration_ms: 3001,
      }),
    ]);
    expect(healthNotReady?.[1]).not.toHaveProperty('health_error');
  });

  it('always replaces a ready container during recreate and preserves volume by default', async () => {
    const deps = buildHandler();

    await handleWorkerCommand(deps, {
      action: EWorkerAction.recreate,
      worker_id: 'worker-1',
      server_id: 'server-1',
      account_id: 'account-1',
    });

    expect(deps.workerService.removeContainerWorkerById).toHaveBeenCalledWith(
      LIFECYCLE_RUNTIME_CONTAINER_ID
    );
    expect(deps.workerService.existsVolumeByNameStrict).toHaveBeenCalledWith(
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
        runtimeGeneration: 2,
      }),
      'worker-1',
      expect.objectContaining({
        imageContentId: WORKER_IMAGE_CONTENT_ID,
        requireExistingVolume: true,
      })
    );
    expect(deps.workerService.updateWorkerById).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.disponible,
        container_id: 'container-1',
        number: null,
        connection_date: null,
      })
    );
  });

  it('preserves the mapped runtime volume during recreate', async () => {
    const workerRuntimeRepository = {
      viewByWorkerId: jest.fn(async () => ({
        worker_id: 'worker-1',
        container_id: LIFECYCLE_RUNTIME_CONTAINER_ID,
        container_name: 'worker-1',
        session_volume_name: 'warm-123',
      })),
      upsert: jest.fn(async () => ({})),
      deleteByWorkerId: jest.fn(async () => true),
    };
    const deps = buildHandler({ workerRuntimeRepository });
    deps.workerService.inspectContainerWorkerByIdStrict.mockResolvedValue(
      buildWorkerContainerInspection({
        container_id: LIFECYCLE_RUNTIME_CONTAINER_ID,
        container_labels: {
          ...buildWorkerContainerInspection().container_labels,
          'underchat.server_id': 'server-1',
          'underchat.runtime_generation': '1',
          'underchat.session_volume_name': 'warm-123',
        },
        container_env: {
          ...buildWorkerContainerInspection().container_env,
          RUNTIME_GENERATION: '1',
          SESSION_VOLUME_NAME: 'warm-123',
        },
        container_mounts: [
          {
            destination: '/app/data',
            name: 'warm-123',
            read_write: true,
            type: 'volume',
          },
        ],
      })
    );

    await handleWorkerCommand(deps, {
      action: EWorkerAction.recreate,
      worker_id: 'worker-1',
      server_id: 'server-1',
      account_id: 'account-1',
    });

    expect(deps.workerService.existsVolumeByNameStrict).toHaveBeenCalledWith(
      'warm-123'
    );
    expect(deps.workerService.removeContainerWorkerById).toHaveBeenCalledWith(
      LIFECYCLE_RUNTIME_CONTAINER_ID
    );
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
      expect.objectContaining({
        imageContentId: WORKER_IMAGE_CONTENT_ID,
        requireExistingVolume: true,
      })
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

  it('prefers the live container volume when an interrupted reservation left a different existing runtime volume', async () => {
    let runtime = {
      worker_id: 'worker-1',
      container_id: 'container-old' as string | null,
      container_name: 'worker-1',
      session_volume_name: 'warm-stale',
      runtime_generation: 21,
      warm_pool_id: 'warm-reservation' as string | null,
    };
    const workerRuntimeRepository = {
      viewByWorkerId: jest.fn(async () => runtime),
      viewByWorkerIdConsistent: jest.fn(async () => runtime),
      reserveNextRuntimeGeneration: jest.fn(
        async (input: { session_volume_name: string }) => {
          runtime = {
            ...runtime,
            container_id: null,
            session_volume_name: input.session_volume_name,
            runtime_generation: 22,
            warm_pool_id: null,
          };
          return 22;
        }
      ),
      upsert: jest.fn(async (input: Partial<typeof runtime>) => {
        runtime = { ...runtime, ...input };
        return runtime;
      }),
      deleteByWorkerId: jest.fn(async () => true),
    };
    const deps = buildHandler({
      workerRuntimeRepository,
      runtimeHealthResponse: { runtime_generation: 22 },
      workerInspection: buildWorkerContainerInspection({
        container_id: 'container-old',
        container_labels: {
          ...buildWorkerContainerInspection().container_labels,
          'underchat.session_volume_name': 'worker-1',
        },
        container_env: {
          ...buildWorkerContainerInspection().container_env,
          SESSION_VOLUME_NAME: 'worker-1',
        },
      }),
    });
    deps.workerService.existsVolumeByNameStrict.mockResolvedValue(true);

    await handleWorkerCommand(deps, {
      action: EWorkerAction.recreate,
      worker_id: 'worker-1',
      server_id: 'server-1',
      account_id: 'account-1',
    });

    expect(workerRuntimeRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_id: 'worker-1',
        container_id: 'container-old',
        session_volume_name: 'worker-1',
        runtime_generation: 21,
        warm_pool_id: null,
      })
    );
    expect(deps.workerService.removeContainerWorkerById).toHaveBeenCalledWith(
      'container-old'
    );
    expect(deps.workerService.createContainerWorker).toHaveBeenCalledWith(
      expect.any(String),
      'worker-1',
      'account-1',
      false,
      expect.any(String),
      expect.any(Number),
      undefined,
      expect.objectContaining({ runtimeGeneration: 22 }),
      'worker-1',
      expect.objectContaining({
        imageContentId: WORKER_IMAGE_CONTENT_ID,
        requireExistingVolume: true,
      })
    );
  });

  it('creates a fresh worker volume when Docker confirms the preserved volume is missing', async () => {
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

    deps.workerService.inspectContainerWorkerById.mockResolvedValueOnce({
      exists: false,
      container_name: 'worker-1',
    });

    await handleWorkerCommand(deps, {
      action: EWorkerAction.recreate,
      worker_id: 'worker-1',
      server_id: 'server-1',
      account_id: 'account-1',
    });

    expect(deps.workerService.existsVolumeByNameStrict).toHaveBeenCalledWith(
      'warm-123'
    );
    expect(deps.workerService.removeContainerWorkerById).toHaveBeenCalledWith(
      'container-old'
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
      }),
      undefined,
      expect.objectContaining({
        imageContentId: WORKER_IMAGE_CONTENT_ID,
      })
    );
    expect(workerRuntimeRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_id: 'worker-1',
        session_volume_name: 'worker-1',
      })
    );
    expect(deps.workerService.updateWorkerById).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.disponible,
        number: null,
        connection_date: null,
      })
    );
  });

  it('adopts a legacy worker-id volume before classifying a stale runtime volume as reset', async () => {
    const workerRuntimeRepository = {
      viewByWorkerId: jest.fn(async () => ({
        worker_id: 'worker-1',
        container_id: 'container-old',
        container_name: 'worker-1',
        session_volume_name: 'warm-missing',
        runtime_generation: 7,
      })),
      upsert: jest.fn(async (input: unknown) => input),
      deleteByWorkerId: jest.fn(async () => true),
    };
    const deps = buildHandler({
      workerRuntimeRepository,
      runtimeHealthResponse: { runtime_generation: 8 },
    });
    deps.workerService.inspectContainerWorkerByIdStrict.mockResolvedValueOnce({
      exists: false,
      container_name: 'worker-1',
    });
    deps.workerService.existsVolumeByNameStrict.mockImplementation(
      async (volumeName: string) => volumeName === 'worker-1'
    );

    await handleWorkerCommand(deps, {
      action: EWorkerAction.recreate,
      worker_id: 'worker-1',
      server_id: 'server-1',
      account_id: 'account-1',
    });

    expect(deps.workerService.existsVolumeByNameStrict).toHaveBeenCalledWith(
      'warm-missing'
    );
    expect(deps.workerService.existsVolumeByNameStrict).toHaveBeenCalledWith(
      'worker-1'
    );
    expect(deps.workerService.createContainerWorker).toHaveBeenCalledWith(
      expect.any(String),
      'worker-1',
      'account-1',
      false,
      expect.any(String),
      expect.any(Number),
      undefined,
      expect.objectContaining({ runtimeGeneration: 8 }),
      'worker-1',
      expect.objectContaining({
        imageContentId: WORKER_IMAGE_CONTENT_ID,
        requireExistingVolume: true,
      })
    );

    const finalUpdate = deps.workerService.updateWorkerById.mock.calls
      .map(([, input]) => input as Record<string, unknown>)
      .find(
        (input) =>
          input.container_id === 'container-1' &&
          input.worker_status_id === EWorkerStatus.disponible
      );
    expect(finalUpdate).toBeDefined();
    expect(finalUpdate).toEqual(
      expect.objectContaining({ number: null, connection_date: null })
    );
  });

  it('fails closed before destructive recreate effects when Docker volume inspection is transiently unavailable', async () => {
    const deps = buildHandler();
    deps.workerService.existsVolumeByNameStrict.mockRejectedValue(
      new Error('docker daemon unavailable')
    );

    await expect(
      handleWorkerCommand(deps, {
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        server_id: 'server-1',
        account_id: 'account-1',
      })
    ).rejects.toThrow('docker daemon unavailable');

    expect(deps.workerService.removeContainerWorker).not.toHaveBeenCalled();
    expect(
      deps.workerService.removeContainerByNameAndVolume
    ).not.toHaveBeenCalled();
    expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();
  });

  it('fails closed when the old volume is missing but live container inspection fails transiently', async () => {
    const workerRuntimeRepository = {
      viewByWorkerId: jest.fn(async () => ({
        worker_id: 'worker-1',
        container_id: 'container-old',
        container_name: 'worker-1',
        session_volume_name: 'warm-missing',
      })),
      upsert: jest.fn(async () => ({})),
      deleteByWorkerId: jest.fn(async () => true),
    };
    const deps = buildHandler({
      workerRuntimeRepository,
      volumeExists: false,
    });
    deps.workerService.inspectContainerWorkerByIdStrict.mockRejectedValueOnce(
      new Error('docker daemon unavailable')
    );

    await expect(
      handleWorkerCommand(deps, {
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        server_id: 'server-1',
        account_id: 'account-1',
      })
    ).rejects.toThrow('docker daemon unavailable');

    expect(
      deps.workerService.removeContainerByNameAndVolume
    ).not.toHaveBeenCalled();
    expect(deps.workerService.removeContainerWorker).not.toHaveBeenCalled();
    expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();
  });

  it('repairs a stale warm runtime volume from the live container without creating an empty session', async () => {
    let runtime: {
      worker_id: string;
      container_id: string | null;
      container_name: string;
      session_volume_name: string;
      runtime_generation: number;
      warm_pool_id: string | null;
    } = {
      worker_id: 'worker-1',
      container_id: 'container-old',
      container_name: 'worker-1',
      session_volume_name: 'warm-missing',
      runtime_generation: 21,
      warm_pool_id: 'warm-obsolete',
    };
    const workerRuntimeRepository = {
      viewByWorkerId: jest.fn(async () => runtime),
      reserveNextRuntimeGeneration: jest.fn(
        async (input: {
          session_volume_name: string;
          warm_pool_id?: string | null;
        }) => {
          runtime = {
            ...runtime,
            container_id: null,
            session_volume_name: input.session_volume_name,
            runtime_generation: 22,
            warm_pool_id: input.warm_pool_id ?? null,
          };
          return 22;
        }
      ),
      upsert: jest.fn(async (input: Partial<typeof runtime>) => {
        runtime = { ...runtime, ...input };
        return runtime;
      }),
      deleteByWorkerId: jest.fn(async () => true),
    };
    const deps = buildHandler({
      workerRuntimeRepository,
      runtimeHealthResponse: { runtime_generation: 22 },
    });
    deps.workerService.existsVolumeByNameStrict.mockImplementation(
      async (volumeName: string) => volumeName === 'warm-adopted'
    );
    deps.workerService.inspectContainerWorkerById.mockResolvedValue(
      buildWorkerContainerInspection({
        container_id: 'container-old',
        container_name: 'worker-1',
        container_labels: {
          ...buildWorkerContainerInspection().container_labels,
          'underchat.session_volume_name': 'warm-adopted',
        },
        container_env: {
          ...buildWorkerContainerInspection().container_env,
          SESSION_VOLUME_NAME: 'warm-adopted',
        },
      })
    );

    await handleWorkerCommand(deps, {
      action: EWorkerAction.recreate,
      worker_id: 'worker-1',
      server_id: 'server-1',
      account_id: 'account-1',
    });

    expect(workerRuntimeRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_id: 'worker-1',
        container_id: 'container-old',
        session_volume_name: 'warm-adopted',
        runtime_generation: 21,
        warm_pool_id: null,
      })
    );
    expect(deps.workerService.removeContainerWorkerById).toHaveBeenCalledWith(
      'container-old'
    );
    expect(deps.workerService.createContainerWorker).toHaveBeenCalledWith(
      expect.any(String),
      'worker-1',
      'account-1',
      false,
      expect.any(String),
      expect.any(Number),
      undefined,
      expect.objectContaining({ runtimeGeneration: 22 }),
      'warm-adopted',
      expect.objectContaining({
        imageContentId: WORKER_IMAGE_CONTENT_ID,
        requireExistingVolume: true,
      })
    );
    expect(deps.workerService.createContainerWorker).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      true,
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
  });

  describe('journal-less recreate provider recovery', () => {
    it('fails closed without Docker or runtime mutation when a journal-less recreate finds a previous provider', async () => {
      const workerRuntimeRepository = buildSelfHealRuntimeRepository(
        8,
        'container-old'
      );
      const deps = buildHandler({
        workerRuntimeRepository,
        workerInspection: buildWorkerContainerInspection({
          container_id: 'container-old',
          container_image: 'under-worker-whatsmeow:latest',
          container_labels: {
            'underchat.worker_id': 'worker-1',
            'underchat.account_id': 'account-1',
            'underchat.worker_type_id': EWorkerType.whatsmeow,
            'underchat.worker_image': 'under-worker-whatsmeow:latest',
            'underchat.session_volume_name': 'previous-provider-volume',
          },
          container_env: {
            WORKER_ID: 'worker-1',
            ACCOUNT_ID: 'account-1',
            WORKER_TYPE_ID: EWorkerType.whatsmeow,
            WORKER_IMAGE: 'under-worker-whatsmeow:latest',
            SESSION_VOLUME_NAME: 'previous-provider-volume',
          },
        }),
      });
      deps.workerService.viewWorkerForMonitor.mockResolvedValue({
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: EWorkerType.wwebjs,
        deleted_at: null,
        container_id: 'container-old',
        lifecycle_operation_id: 'operation-recovered',
      });

      await expect(
        handleWorkerCommand(deps, {
          action: EWorkerAction.recreate,
          worker_id: 'worker-1',
          server_id: 'server-1',
          account_id: 'account-1',
          worker_status_id: EWorkerStatus.recreating,
          worker_type_id: EWorkerType.wwebjs,
          lifecycle_operation_id: 'operation-recovered',
          recovery_without_journal: true,
        })
      ).rejects.toThrow(
        'worker_recreate_missing_journal_identity_conflict:worker_type'
      );

      expect(deps.workerService.removeContainerWorker).not.toHaveBeenCalled();
      expect(
        deps.workerService.removeContainerByNameAndVolume
      ).not.toHaveBeenCalled();
      expect(
        deps.workerService.removeContainerWorkerById
      ).not.toHaveBeenCalled();
      expect(deps.workerService.removeVolumeByName).not.toHaveBeenCalled();
      expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();
      expect(
        workerRuntimeRepository.reserveNextRuntimeGeneration
      ).not.toHaveBeenCalled();
      expect(workerRuntimeRepository.upsert).not.toHaveBeenCalled();
    });

    it('fails closed on previous-provider image evidence when legacy type fields are absent', async () => {
      const deps = buildHandler({
        workerInspection: buildWorkerContainerInspection({
          container_id: 'container-old',
          container_image:
            'harbor.devunder.com/underchat/balance/under-worker-whatsmeow:v1',
          container_labels: {
            'underchat.worker_id': 'worker-1',
            'underchat.account_id': 'account-1',
            'underchat.session_volume_name': 'legacy-volume',
          },
          container_env: {
            WORKER_ID: 'worker-1',
            ACCOUNT_ID: 'account-1',
            SESSION_VOLUME_NAME: 'legacy-volume',
          },
        }),
      });
      deps.workerService.viewWorkerForMonitor.mockResolvedValue({
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: EWorkerType.wwebjs,
        deleted_at: null,
        container_id: 'container-old',
        lifecycle_operation_id: 'operation-recovered',
      });

      await expect(
        handleWorkerCommand(deps, {
          action: EWorkerAction.recreate,
          worker_id: 'worker-1',
          server_id: 'server-1',
          account_id: 'account-1',
          worker_status_id: EWorkerStatus.recreating,
          worker_type_id: EWorkerType.wwebjs,
          lifecycle_operation_id: 'operation-recovered',
          recovery_without_journal: true,
        })
      ).rejects.toThrow(
        'worker_recreate_missing_journal_identity_conflict:worker_image'
      );

      expect(deps.workerService.removeContainerWorker).not.toHaveBeenCalled();
      expect(
        deps.workerService.removeContainerByNameAndVolume
      ).not.toHaveBeenCalled();
      expect(deps.workerService.removeVolumeByName).not.toHaveBeenCalled();
      expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();
    });

    it('preserves legacy journal-less recreate compatibility when its image proves the current provider', async () => {
      const deps = buildHandler({
        workerInspection: buildWorkerContainerInspection({
          container_id: 'container-old',
          container_image:
            'harbor.devunder.com/underchat/balance/under-worker-wwebjs:v1',
          container_labels: {
            'underchat.worker_id': 'worker-1',
            'underchat.account_id': 'account-1',
            'underchat.session_volume_name': 'legacy-volume',
          },
          container_env: {
            WORKER_ID: 'worker-1',
            ACCOUNT_ID: 'account-1',
            SESSION_VOLUME_NAME: 'legacy-volume',
          },
        }),
      });
      deps.workerService.viewWorkerForMonitor.mockResolvedValue({
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: EWorkerType.wwebjs,
        deleted_at: null,
        container_id: 'container-old',
        lifecycle_operation_id: 'operation-recovered',
      });

      await expect(
        handleWorkerCommand(deps, {
          action: EWorkerAction.recreate,
          worker_id: 'worker-1',
          server_id: 'server-1',
          account_id: 'account-1',
          worker_status_id: EWorkerStatus.recreating,
          worker_type_id: EWorkerType.wwebjs,
          lifecycle_operation_id: 'operation-recovered',
          recovery_without_journal: true,
        })
      ).resolves.toBeUndefined();

      expect(deps.workerService.removeContainerWorkerById).toHaveBeenCalledWith(
        'container-old'
      );
      expect(deps.workerService.createContainerWorker).toHaveBeenCalled();
    });

    it('fails closed without Docker mutation when the legacy provider cannot be proven', async () => {
      const deps = buildHandler({
        workerInspection: buildWorkerContainerInspection({
          container_id: 'container-old',
          container_image: 'legacy-underchat-worker:v1',
          container_labels: {
            'underchat.worker_id': 'worker-1',
            'underchat.account_id': 'account-1',
            'underchat.session_volume_name': 'legacy-volume',
          },
          container_env: {
            WORKER_ID: 'worker-1',
            ACCOUNT_ID: 'account-1',
            SESSION_VOLUME_NAME: 'legacy-volume',
          },
        }),
      });
      deps.workerService.viewWorkerForMonitor.mockResolvedValue({
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: EWorkerType.wwebjs,
        deleted_at: null,
        container_id: 'container-old',
        lifecycle_operation_id: 'operation-recovered',
      });

      await expect(
        handleWorkerCommand(deps, {
          action: EWorkerAction.recreate,
          worker_id: 'worker-1',
          server_id: 'server-1',
          account_id: 'account-1',
          worker_status_id: EWorkerStatus.recreating,
          worker_type_id: EWorkerType.wwebjs,
          lifecycle_operation_id: 'operation-recovered',
          recovery_without_journal: true,
        })
      ).rejects.toThrow(
        'worker_recreate_missing_journal_identity_conflict:worker_type_unproven'
      );

      expect(deps.workerService.removeContainerWorker).not.toHaveBeenCalled();
      expect(
        deps.workerService.removeContainerByNameAndVolume
      ).not.toHaveBeenCalled();
      expect(deps.workerService.removeVolumeByName).not.toHaveBeenCalled();
      expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();
    });
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

    await handleWorkerCommand(deps, {
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
    expect(deps.workerService.removeContainerWorkerById).toHaveBeenCalledWith(
      'container-old'
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
      'legacy-volume',
      expect.objectContaining({
        imageContentId: WORKER_IMAGE_CONTENT_ID,
        requireExistingVolume: true,
      })
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

    await handleWorkerCommand(deps, {
      action: EWorkerAction.recreate,
      worker_id: 'worker-1',
      server_id: 'server-1',
      account_id: 'account-1',
    });

    expect(workerRuntimeRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_id: 'worker-1',
        container_id: 'container-1',
        container_name: 'worker-1',
        session_volume_name: 'worker-1',
      })
    );
    expect(deps.workerService.removeContainerWorkerById).toHaveBeenCalledWith(
      LIFECYCLE_RUNTIME_CONTAINER_ID
    );
  });

  it('removes the volume during recreate only when explicit session reset is requested', async () => {
    const deps = buildHandler();

    await handleWorkerCommand(deps, {
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
    expect(deps.workerService.removeContainerWorkerById).toHaveBeenCalledWith(
      LIFECYCLE_RUNTIME_CONTAINER_ID
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
    const deps = buildHandler({
      workerRuntimeRepository,
      runtimeHealthResponse: { runtime_generation: 5 },
    });

    await handleWorkerCommand(deps, {
      action: EWorkerAction.recreate,
      worker_id: 'worker-1',
      server_id: 'server-1',
      account_id: 'account-1',
      remove_session: true,
      remove_volume: true,
    });

    expect(deps.workerService.removeContainerWorkerById).toHaveBeenCalledWith(
      'container-old'
    );
    expect(workerRuntimeRepository.deleteByWorkerId).not.toHaveBeenCalled();
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
    deps.workerBaileysGrpcClientService.runtimeHealth.mockResolvedValueOnce({
      ...nativeRuntimeContract(EWorkerType.wwebjs, true),
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
      phone: '+556192037138',
      kafka_unhealthy: false,
      kafka_consumers_ready: true,
      kafka_consumers_authorized: true,
      runtime_generation: 2,
    });

    await handleWorkerCommand(deps, {
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
        runtime_generation: 2,
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
    expect(deps.centrifugoService.publishSubStrict).toHaveBeenCalledWith(
      expect.stringContaining('account-1'),
      expect.objectContaining({
        event_type: 'status',
        status: EBaileysConnectionStatus.connected,
        code: ECodeMessage.connectionEstablished,
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_status_id: EWorkerStatus.online,
        runtime_generation: 2,
      })
    );
  });

  it.each([
    [EWorkerType.baileys, EWorkerType.wwebjs, EWorkerType.baileys],
    [EWorkerType.baileys, EWorkerType.whatsmeow, EWorkerType.baileys],
    [EWorkerType.wwebjs, EWorkerType.baileys, EWorkerType.wwebjs],
    [EWorkerType.wwebjs, EWorkerType.whatsmeow, EWorkerType.wwebjs],
    [EWorkerType.whatsmeow, EWorkerType.baileys, EWorkerType.whatsmeow],
    [EWorkerType.whatsmeow, EWorkerType.wwebjs, EWorkerType.whatsmeow],
    [EWorkerType.baileys, EWorkerType.whatsmeow, undefined],
    [EWorkerType.baileys, EWorkerType.whatsmeow, EWorkerType.whatsmeow],
  ])(
    'restores a PostgreSQL %s -> %s handoff without requesting an interactive QR login',
    async (sourceWorkerType, targetWorkerType, previousWorkerType) => {
      const deps = buildHandler();
      const handoffContext = {
        handoff_id: '00000000-0000-4000-8000-000000000051',
        lifecycle_operation_id: '00000000-0000-4000-8000-000000000052',
        source_provider: providerForWorkerType(sourceWorkerType),
        target_provider: providerForWorkerType(targetWorkerType),
        source_revision_id: '1',
        target_revision_id: '2',
      };
      (
        deps.workerRuntimeRepository
          .viewWhatsappProviderHandoffLifecycleContext as jest.Mock
      )
        .mockResolvedValueOnce({ ...handoffContext, state: 'validating' })
        .mockResolvedValue({ ...handoffContext, state: 'completed' });
      deps.workerBaileysGrpcClientService.runtimeHealth.mockResolvedValueOnce({
        ...nativeRuntimeContract(targetWorkerType, true),
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: targetWorkerType,
        activated: true,
        ready: true,
        session_ready: true,
        can_send: true,
        can_receive_runtime: true,
        authenticated: true,
        standby: false,
        has_session: true,
        has_qr: false,
        runtime_state: 'active',
        qr_stream_ready: true,
        provider_state: 'CONNECTED',
        phone: '556192037138',
        kafka_unhealthy: false,
        kafka_consumers_ready: true,
        kafka_consumers_authorized: true,
        runtime_generation: 2,
      });

      const reconciliation = await (
        deps.handler as unknown as {
          reconcileRecreatedWorkerConnection(
            data: IWorkerPayload,
            workerType: EWorkerType,
            runtimeGeneration: number,
            lease: ILockLeaseContext
          ): Promise<{
            workerStatusId: EWorkerStatus;
            connectionState?: IBaileysConnectionState;
          }>;
        }
      ).reconcileRecreatedWorkerConnection(
        {
          action: EWorkerAction.recreate,
          worker_id: 'worker-1',
          server_id: 'server-1',
          account_id: 'account-1',
          worker_type_id: targetWorkerType,
          previous_worker_type_id: previousWorkerType,
          previous_worker_status_id: EWorkerStatus.online,
          session_storage: EWorkerSessionStorage.postgres,
          remove_session: false,
          remove_volume: false,
          lifecycle_operation_id: '00000000-0000-4000-8000-000000000052',
        },
        targetWorkerType,
        2,
        {
          signal: new AbortController().signal,
          assertActive: jest.fn(),
        }
      );

      expect(reconciliation.workerStatusId).toBe(EWorkerStatus.online);
      expect(reconciliation.connectionState).toEqual(
        expect.objectContaining({
          status: EBaileysConnectionStatus.connected,
          session_ready: true,
          authenticated: true,
        })
      );
      expect(
        deps.workerBaileysGrpcClientService.requestConnection
      ).not.toHaveBeenCalled();
    }
  );

  it.each(
    [
      [EWorkerType.baileys, EWorkerType.wwebjs],
      [EWorkerType.baileys, EWorkerType.whatsmeow],
      [EWorkerType.wwebjs, EWorkerType.baileys],
      [EWorkerType.wwebjs, EWorkerType.whatsmeow],
      [EWorkerType.whatsmeow, EWorkerType.baileys],
      [EWorkerType.whatsmeow, EWorkerType.wwebjs],
    ].flatMap(([recoveryWorkerType, failedTargetWorkerType]) => [
      {
        recoveryWorkerType,
        failedTargetWorkerType,
        cleanupRequired: true,
        previousWorkerType: failedTargetWorkerType,
      },
      {
        recoveryWorkerType,
        failedTargetWorkerType,
        cleanupRequired: false,
        previousWorkerType: recoveryWorkerType,
      },
    ])
  )(
    'restores PostgreSQL $recoveryWorkerType -> $failedTargetWorkerType recovery (cleanup=$cleanupRequired) without QR',
    async ({
      recoveryWorkerType,
      failedTargetWorkerType,
      cleanupRequired,
      previousWorkerType,
    }) => {
      const deps = buildHandler();
      const recoveryOperationId = '00000000-0000-4000-8000-000000000071';
      (
        deps.workerRuntimeRepository
          .viewWhatsappProviderHandoffRecoveryLifecycleProof as jest.Mock
      ).mockResolvedValue({
        handoff_id: '00000000-0000-4000-8000-000000000072',
        handoff_lifecycle_operation_id: '00000000-0000-4000-8000-000000000073',
        recovery_operation_id: recoveryOperationId,
        source_provider: providerForWorkerType(recoveryWorkerType),
        failed_target_provider: providerForWorkerType(failedTargetWorkerType),
        source_revision_id: '41',
        recovery_state: 'running',
        recovery_cleanup_required: cleanupRequired,
        recovery_from_generation: 8,
        recovery_ownership_unique: true,
        recovery_context_valid: true,
        source_session_valid: true,
      });
      deps.workerBaileysGrpcClientService.runtimeHealth.mockResolvedValueOnce({
        ...nativeRuntimeContract(recoveryWorkerType, true),
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: recoveryWorkerType,
        activated: true,
        ready: true,
        session_ready: true,
        can_send: true,
        can_receive_runtime: true,
        authenticated: true,
        standby: false,
        has_session: true,
        has_qr: false,
        runtime_state: 'active',
        qr_stream_ready: true,
        provider_state: 'CONNECTED',
        phone: '556192037138',
        kafka_unhealthy: false,
        kafka_consumers_ready: true,
        kafka_consumers_authorized: true,
        runtime_generation: 9,
      });

      const reconciliation = await (
        deps.handler as unknown as {
          reconcileRecreatedWorkerConnection(
            data: IWorkerPayload,
            workerType: EWorkerType,
            runtimeGeneration: number,
            lease: ILockLeaseContext
          ): Promise<{ workerStatusId: EWorkerStatus }>;
        }
      ).reconcileRecreatedWorkerConnection(
        {
          action: EWorkerAction.recreate,
          worker_id: 'worker-1',
          server_id: 'server-1',
          account_id: 'account-1',
          worker_type_id: recoveryWorkerType,
          previous_worker_type_id: previousWorkerType,
          previous_worker_status_id: EWorkerStatus.online,
          session_storage: EWorkerSessionStorage.postgres,
          remove_session: false,
          remove_volume: false,
          lifecycle_operation_id: recoveryOperationId,
        },
        recoveryWorkerType,
        9,
        {
          signal: new AbortController().signal,
          assertActive: jest.fn(),
        }
      );

      expect(reconciliation.workerStatusId).toBe(EWorkerStatus.online);
      expect(
        deps.workerRuntimeRepository
          .viewWhatsappProviderHandoffRecoveryLifecycleProof
      ).toHaveBeenCalledWith({
        worker_id: 'worker-1',
        account_id: 'account-1',
        recovery_operation_id: recoveryOperationId,
        recovery_worker_type_id: recoveryWorkerType,
        recovery_provider: providerForWorkerType(recoveryWorkerType),
      });
      expect(
        deps.workerBaileysGrpcClientService.requestConnection
      ).not.toHaveBeenCalled();
    }
  );

  it('protects a no-cleanup recovery with an omitted previous type from the QR shortcut', async () => {
    const deps = buildHandler();
    const recoveryOperationId = '00000000-0000-4000-8000-000000000074';
    (
      deps.workerRuntimeRepository
        .viewWhatsappProviderHandoffRecoveryLifecycleProof as jest.Mock
    ).mockResolvedValue({
      handoff_id: '00000000-0000-4000-8000-000000000075',
      handoff_lifecycle_operation_id: '00000000-0000-4000-8000-000000000076',
      recovery_operation_id: recoveryOperationId,
      source_provider: 'wwebjs',
      failed_target_provider: 'baileys',
      source_revision_id: '41',
      recovery_state: 'running',
      recovery_cleanup_required: false,
      recovery_from_generation: 8,
      recovery_ownership_unique: true,
      recovery_context_valid: true,
      source_session_valid: true,
    });
    deps.workerBaileysGrpcClientService.runtimeHealth.mockResolvedValueOnce({
      ...nativeRuntimeContract(EWorkerType.wwebjs, true),
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
      has_qr: false,
      runtime_state: 'active',
      provider_state: 'CONNECTED',
      phone: '556192037138',
      kafka_unhealthy: false,
      kafka_consumers_ready: true,
      kafka_consumers_authorized: true,
      runtime_generation: 9,
    });

    await expect(
      (
        deps.handler as unknown as {
          reconcileRecreatedWorkerConnection(
            data: IWorkerPayload,
            workerType: EWorkerType,
            runtimeGeneration: number,
            lease: ILockLeaseContext
          ): Promise<unknown>;
        }
      ).reconcileRecreatedWorkerConnection(
        {
          action: EWorkerAction.recreate,
          worker_id: 'worker-1',
          server_id: 'server-1',
          account_id: 'account-1',
          worker_type_id: EWorkerType.wwebjs,
          previous_worker_type_id: undefined,
          previous_worker_status_id: EWorkerStatus.online,
          session_storage: EWorkerSessionStorage.postgres,
          remove_session: false,
          remove_volume: false,
          lifecycle_operation_id: recoveryOperationId,
        },
        EWorkerType.wwebjs,
        9,
        {
          signal: new AbortController().signal,
          assertActive: jest.fn(),
        }
      )
    ).resolves.toMatchObject({ workerStatusId: EWorkerStatus.online });

    expect(
      deps.workerBaileysGrpcClientService.requestConnection
    ).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'missing source session with same-provider previous type',
      previousWorkerType: EWorkerType.wwebjs as EWorkerType | undefined,
    },
    {
      label: 'invalid source revision with legacy previous type omitted',
      previousWorkerType: undefined,
    },
  ])(
    'fails closed for an owned no-cleanup recovery with $label',
    async ({ previousWorkerType }) => {
      const deps = buildHandler();
      const recoveryOperationId = '00000000-0000-4000-8000-000000000082';
      (
        deps.workerRuntimeRepository
          .viewWhatsappProviderHandoffRecoveryLifecycleProof as jest.Mock
      ).mockResolvedValue({
        handoff_id: '00000000-0000-4000-8000-000000000083',
        handoff_lifecycle_operation_id: '00000000-0000-4000-8000-000000000084',
        recovery_operation_id: recoveryOperationId,
        source_provider: 'wwebjs',
        failed_target_provider: 'baileys',
        source_revision_id: '41',
        recovery_state: 'running',
        recovery_cleanup_required: false,
        recovery_from_generation: 8,
        recovery_ownership_unique: true,
        recovery_context_valid: true,
        source_session_valid: false,
      });

      await expect(
        (
          deps.handler as unknown as {
            reconcileRecreatedWorkerConnection(
              data: IWorkerPayload,
              workerType: EWorkerType,
              runtimeGeneration: number,
              lease: ILockLeaseContext
            ): Promise<unknown>;
          }
        ).reconcileRecreatedWorkerConnection(
          {
            action: EWorkerAction.recreate,
            worker_id: 'worker-1',
            server_id: 'server-1',
            account_id: 'account-1',
            worker_type_id: EWorkerType.wwebjs,
            previous_worker_type_id: previousWorkerType,
            previous_worker_status_id: EWorkerStatus.online,
            session_storage: EWorkerSessionStorage.postgres,
            remove_session: false,
            remove_volume: false,
            lifecycle_operation_id: recoveryOperationId,
          },
          EWorkerType.wwebjs,
          9,
          {
            signal: new AbortController().signal,
            assertActive: jest.fn(),
          }
        )
      ).rejects.toThrow('postgres_provider_handoff_recovery_context_invalid');

      expect(
        deps.workerRuntimeRepository
          .viewWhatsappProviderHandoffRecoveryLifecycleProof
      ).toHaveBeenCalledTimes(1);
      expect(
        deps.workerBaileysGrpcClientService.requestConnection
      ).not.toHaveBeenCalled();
    }
  );

  it.each(
    ['completed', 'blocked', 'cancelled'].flatMap((recoveryState) => [
      {
        recoveryState,
        previousWorkerType: EWorkerType.wwebjs as EWorkerType | undefined,
      },
      {
        recoveryState,
        previousWorkerType: undefined,
      },
    ])
  )(
    'fails closed for terminal owned recovery $recoveryState with previous type $previousWorkerType',
    async ({ recoveryState, previousWorkerType }) => {
      const deps = buildHandler();
      const recoveryOperationId = '00000000-0000-4000-8000-000000000085';
      (
        deps.workerRuntimeRepository
          .viewWhatsappProviderHandoffRecoveryLifecycleProof as jest.Mock
      ).mockResolvedValue({
        handoff_id: '00000000-0000-4000-8000-000000000086',
        handoff_lifecycle_operation_id: '00000000-0000-4000-8000-000000000087',
        recovery_operation_id: recoveryOperationId,
        source_provider: 'wwebjs',
        failed_target_provider: 'baileys',
        source_revision_id: '41',
        recovery_state: recoveryState,
        recovery_cleanup_required: false,
        recovery_from_generation: 8,
        recovery_ownership_unique: true,
        recovery_context_valid: false,
        source_session_valid: true,
      });

      await expect(
        (
          deps.handler as unknown as {
            reconcileRecreatedWorkerConnection(
              data: IWorkerPayload,
              workerType: EWorkerType,
              runtimeGeneration: number,
              lease: ILockLeaseContext
            ): Promise<unknown>;
          }
        ).reconcileRecreatedWorkerConnection(
          {
            action: EWorkerAction.recreate,
            worker_id: 'worker-1',
            server_id: 'server-1',
            account_id: 'account-1',
            worker_type_id: EWorkerType.wwebjs,
            previous_worker_type_id: previousWorkerType,
            previous_worker_status_id: EWorkerStatus.online,
            session_storage: EWorkerSessionStorage.postgres,
            remove_session: false,
            remove_volume: false,
            lifecycle_operation_id: recoveryOperationId,
          },
          EWorkerType.wwebjs,
          9,
          {
            signal: new AbortController().signal,
            assertActive: jest.fn(),
          }
        )
      ).rejects.toThrow('postgres_provider_handoff_recovery_context_invalid');

      expect(
        deps.workerBaileysGrpcClientService.requestConnection
      ).not.toHaveBeenCalled();
      expect(
        deps.workerBaileysGrpcClientService.runtimeHealth
      ).not.toHaveBeenCalled();
    }
  );

  it('rejects a recovery proof that aliases the original handoff lifecycle UUID', async () => {
    const deps = buildHandler();
    const recoveryOperationId = '00000000-0000-4000-8000-000000000080';
    (
      deps.workerRuntimeRepository
        .viewWhatsappProviderHandoffRecoveryLifecycleProof as jest.Mock
    ).mockResolvedValue({
      handoff_id: '00000000-0000-4000-8000-000000000081',
      handoff_lifecycle_operation_id: recoveryOperationId,
      recovery_operation_id: recoveryOperationId,
      source_provider: 'wwebjs',
      failed_target_provider: 'baileys',
      source_revision_id: '41',
      recovery_state: 'running',
      recovery_cleanup_required: true,
      recovery_from_generation: 8,
      recovery_ownership_unique: true,
      recovery_context_valid: true,
      source_session_valid: true,
    });

    await expect(
      (
        deps.handler as unknown as {
          reconcileRecreatedWorkerConnection(
            data: IWorkerPayload,
            workerType: EWorkerType,
            runtimeGeneration: number,
            lease: ILockLeaseContext
          ): Promise<unknown>;
        }
      ).reconcileRecreatedWorkerConnection(
        {
          action: EWorkerAction.recreate,
          worker_id: 'worker-1',
          server_id: 'server-1',
          account_id: 'account-1',
          worker_type_id: EWorkerType.wwebjs,
          previous_worker_type_id: EWorkerType.baileys,
          previous_worker_status_id: EWorkerStatus.online,
          session_storage: EWorkerSessionStorage.postgres,
          remove_session: false,
          remove_volume: false,
          lifecycle_operation_id: recoveryOperationId,
        },
        EWorkerType.wwebjs,
        9,
        {
          signal: new AbortController().signal,
          assertActive: jest.fn(),
        }
      )
    ).rejects.toThrow('postgres_provider_handoff_recovery_context_invalid');

    expect(
      deps.workerBaileysGrpcClientService.requestConnection
    ).not.toHaveBeenCalled();
  });

  it('fails closed when an exact recovery proof disappears during online confirmation', async () => {
    const deps = buildHandler();
    const recoveryOperationId = '00000000-0000-4000-8000-000000000077';
    const proof = {
      handoff_id: '00000000-0000-4000-8000-000000000078',
      handoff_lifecycle_operation_id: '00000000-0000-4000-8000-000000000079',
      recovery_operation_id: recoveryOperationId,
      source_provider: 'wwebjs',
      failed_target_provider: 'baileys',
      source_revision_id: '41',
      recovery_state: 'running',
      recovery_cleanup_required: true,
      recovery_from_generation: 8,
      recovery_ownership_unique: true,
      recovery_context_valid: true,
      source_session_valid: true,
    };
    (
      deps.workerRuntimeRepository
        .viewWhatsappProviderHandoffRecoveryLifecycleProof as jest.Mock
    )
      .mockResolvedValueOnce(proof)
      .mockResolvedValueOnce(null);
    deps.workerBaileysGrpcClientService.runtimeHealth.mockResolvedValueOnce({
      ...nativeRuntimeContract(EWorkerType.wwebjs, true),
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
      has_qr: false,
      runtime_state: 'active',
      provider_state: 'CONNECTED',
      phone: '556192037138',
      kafka_unhealthy: false,
      kafka_consumers_ready: true,
      kafka_consumers_authorized: true,
      runtime_generation: 9,
    });

    await expect(
      (
        deps.handler as unknown as {
          reconcileRecreatedWorkerConnection(
            data: IWorkerPayload,
            workerType: EWorkerType,
            runtimeGeneration: number,
            lease: ILockLeaseContext
          ): Promise<unknown>;
        }
      ).reconcileRecreatedWorkerConnection(
        {
          action: EWorkerAction.recreate,
          worker_id: 'worker-1',
          server_id: 'server-1',
          account_id: 'account-1',
          worker_type_id: EWorkerType.wwebjs,
          previous_worker_type_id: EWorkerType.baileys,
          previous_worker_status_id: EWorkerStatus.online,
          session_storage: EWorkerSessionStorage.postgres,
          remove_session: false,
          remove_volume: false,
          lifecycle_operation_id: recoveryOperationId,
        },
        EWorkerType.wwebjs,
        9,
        {
          signal: new AbortController().signal,
          assertActive: jest.fn(),
        }
      )
    ).rejects.toThrow('postgres_provider_handoff_context_missing');

    expect(
      deps.workerBaileysGrpcClientService.requestConnection
    ).not.toHaveBeenCalled();
  });

  it('never converts a PostgreSQL handoff with an absent target session into QR-ready disponible', async () => {
    const deps = buildHandler();
    (
      deps.workerRuntimeRepository
        .viewWhatsappProviderHandoffLifecycleContext as jest.Mock
    ).mockResolvedValue({
      handoff_id: '00000000-0000-4000-8000-000000000054',
      lifecycle_operation_id: '00000000-0000-4000-8000-000000000053',
      source_provider: 'baileys',
      target_provider: 'whatsmeow',
      source_revision_id: '1',
      target_revision_id: '2',
      state: 'validating',
    });
    (deps.handler as any).recreateOnlineReconciliationWaitMs = 1;
    (deps.handler as any).providerHandoffOnlineReconciliationWaitMs = 1;
    (deps.handler as any).recreateOnlineReconciliationPollIntervalMs = 0;
    deps.workerBaileysGrpcClientService.runtimeHealth.mockResolvedValue({
      ...nativeRuntimeContract(EWorkerType.whatsmeow, false),
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.whatsmeow,
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
      provider_state: 'awaiting_connection',
      kafka_unhealthy: true,
      kafka_consumers_ready: false,
      kafka_consumers_authorized: false,
      runtime_generation: 2,
    });

    await expect(
      (
        deps.handler as unknown as {
          reconcileRecreatedWorkerConnection(
            data: IWorkerPayload,
            workerType: EWorkerType,
            runtimeGeneration: number,
            lease: ILockLeaseContext
          ): Promise<unknown>;
        }
      ).reconcileRecreatedWorkerConnection(
        {
          action: EWorkerAction.recreate,
          worker_id: 'worker-1',
          server_id: 'server-1',
          account_id: 'account-1',
          worker_type_id: EWorkerType.whatsmeow,
          previous_worker_type_id: EWorkerType.baileys,
          previous_worker_status_id: EWorkerStatus.online,
          session_storage: EWorkerSessionStorage.postgres,
          remove_session: false,
          remove_volume: false,
          lifecycle_operation_id: '00000000-0000-4000-8000-000000000053',
        },
        EWorkerType.whatsmeow,
        2,
        {
          signal: new AbortController().signal,
          assertActive: jest.fn(),
        }
      )
    ).rejects.toThrow('Provider handoff target session readiness');

    expect(
      deps.workerBaileysGrpcClientService.requestConnection
    ).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'explicit source type',
      previousWorkerType: EWorkerType.baileys as EWorkerType | undefined,
    },
    {
      label: 'legacy payload without a source type',
      previousWorkerType: undefined,
    },
  ])(
    'fails closed without requesting QR when a PostgreSQL provider change has no durable handoff proof ($label)',
    async ({ previousWorkerType }) => {
      const deps = buildHandler();

      await expect(
        (
          deps.handler as unknown as {
            reconcileRecreatedWorkerConnection(
              data: IWorkerPayload,
              workerType: EWorkerType,
              runtimeGeneration: number,
              lease: ILockLeaseContext
            ): Promise<unknown>;
          }
        ).reconcileRecreatedWorkerConnection(
          {
            action: EWorkerAction.recreate,
            worker_id: 'worker-1',
            server_id: 'server-1',
            account_id: 'account-1',
            worker_type_id: EWorkerType.whatsmeow,
            previous_worker_type_id: previousWorkerType,
            previous_worker_status_id: EWorkerStatus.online,
            session_storage: EWorkerSessionStorage.postgres,
            remove_session: false,
            remove_volume: false,
            lifecycle_operation_id: '00000000-0000-4000-8000-000000000055',
          },
          EWorkerType.whatsmeow,
          2,
          {
            signal: new AbortController().signal,
            assertActive: jest.fn(),
          }
        )
      ).rejects.toThrow('postgres_provider_handoff_context_missing');

      expect(
        deps.workerBaileysGrpcClientService.requestConnection
      ).not.toHaveBeenCalled();
    }
  );

  it('fails closed without QR when a PostgreSQL recreate carries a contradictory volume-removal flag', async () => {
    const deps = buildHandler();

    await expect(
      (
        deps.handler as unknown as {
          reconcileRecreatedWorkerConnection(
            data: IWorkerPayload,
            workerType: EWorkerType,
            runtimeGeneration: number,
            lease: ILockLeaseContext
          ): Promise<unknown>;
        }
      ).reconcileRecreatedWorkerConnection(
        {
          action: EWorkerAction.recreate,
          worker_id: 'worker-1',
          server_id: 'server-1',
          account_id: 'account-1',
          worker_type_id: EWorkerType.whatsmeow,
          previous_worker_type_id: EWorkerType.baileys,
          previous_worker_status_id: EWorkerStatus.online,
          session_storage: EWorkerSessionStorage.postgres,
          remove_session: false,
          remove_volume: true,
          lifecycle_operation_id: '00000000-0000-4000-8000-000000000067',
        },
        EWorkerType.whatsmeow,
        2,
        {
          signal: new AbortController().signal,
          assertActive: jest.fn(),
        }
      )
    ).rejects.toThrow('postgres_recreate_remove_volume_invalid');

    expect(
      deps.workerRuntimeRepository.viewWhatsappProviderHandoffLifecycleContext
    ).not.toHaveBeenCalled();
    expect(
      deps.workerBaileysGrpcClientService.requestConnection
    ).not.toHaveBeenCalled();
  });

  it('permits interactive login for an empty PostgreSQL provider switch only with primary proof', async () => {
    const deps = buildHandler();
    (
      deps.workerRuntimeRepository
        .viewWhatsappProviderEmptySwitchPrimaryProof as jest.Mock
    ).mockResolvedValue({
      lifecycle_operation_id: '00000000-0000-4000-8000-000000000064',
      worker_type_id: EWorkerType.whatsmeow,
      runtime_session_storage: EWorkerSessionStorage.postgres,
      runtime_source_provider: 'whatsmeow',
    });
    deps.workerBaileysGrpcClientService.requestConnection.mockResolvedValueOnce(
      {
        ...buildConnectedState(),
        runtime_generation: 2,
        connection_status: buildNativeConnectionStatus(
          EWorkerType.whatsmeow,
          true
        ),
      }
    );
    deps.workerBaileysGrpcClientService.runtimeHealth.mockResolvedValueOnce({
      ...nativeRuntimeContract(EWorkerType.whatsmeow, true),
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
      has_qr: false,
      runtime_state: 'active',
      provider_state: 'CONNECTED',
      phone: '+556192037138',
      kafka_unhealthy: false,
      kafka_consumers_ready: true,
      kafka_consumers_authorized: true,
      runtime_generation: 2,
    });

    const reconciliation = await (
      deps.handler as unknown as {
        reconcileRecreatedWorkerConnection(
          data: IWorkerPayload,
          workerType: EWorkerType,
          runtimeGeneration: number,
          lease: ILockLeaseContext
        ): Promise<{ workerStatusId: EWorkerStatus }>;
      }
    ).reconcileRecreatedWorkerConnection(
      {
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        server_id: 'server-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.whatsmeow,
        previous_worker_type_id: EWorkerType.baileys,
        previous_worker_status_id: EWorkerStatus.online,
        session_storage: EWorkerSessionStorage.postgres,
        remove_session: false,
        remove_volume: false,
        lifecycle_operation_id: '00000000-0000-4000-8000-000000000064',
      },
      EWorkerType.whatsmeow,
      2,
      {
        signal: new AbortController().signal,
        assertActive: jest.fn(),
      }
    );

    expect(reconciliation.workerStatusId).toBe(EWorkerStatus.online);
    expect(
      deps.workerRuntimeRepository.viewWhatsappProviderEmptySwitchPrimaryProof
    ).toHaveBeenCalledWith({
      worker_id: 'worker-1',
      account_id: 'account-1',
      lifecycle_operation_id: '00000000-0000-4000-8000-000000000064',
      target_worker_type_id: EWorkerType.whatsmeow,
      target_provider: 'whatsmeow',
    });
    expect(
      deps.workerBaileysGrpcClientService.requestConnection
    ).toHaveBeenCalledTimes(1);
  });

  it('permits interactive login only after the durable discard gate proves cleanup complete', async () => {
    const deps = buildHandler();
    (
      deps.workerRuntimeRepository
        .viewWhatsappProviderHandoffDiscardPrimaryGate as jest.Mock
    ).mockResolvedValue({
      handoff_id: '00000000-0000-4000-8000-000000000056',
      operation_id: '00000000-0000-4000-8000-000000000057',
      source_provider: 'baileys',
      target_provider: 'whatsmeow',
      session_present: false,
      cleanup_finalized_at: '2026-08-06T20:00:00.000Z',
    });
    deps.workerBaileysGrpcClientService.requestConnection.mockResolvedValueOnce(
      {
        ...buildConnectedState(),
        runtime_generation: 2,
        connection_status: buildNativeConnectionStatus(
          EWorkerType.whatsmeow,
          true
        ),
      }
    );
    deps.workerBaileysGrpcClientService.runtimeHealth.mockResolvedValueOnce({
      ...nativeRuntimeContract(EWorkerType.whatsmeow, true),
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
      has_qr: false,
      runtime_state: 'active',
      provider_state: 'CONNECTED',
      phone: '+556192037138',
      kafka_unhealthy: false,
      kafka_consumers_ready: true,
      kafka_consumers_authorized: true,
      runtime_generation: 2,
    });

    const reconciliation = await (
      deps.handler as unknown as {
        reconcileRecreatedWorkerConnection(
          data: IWorkerPayload,
          workerType: EWorkerType,
          runtimeGeneration: number,
          lease: ILockLeaseContext
        ): Promise<{ workerStatusId: EWorkerStatus }>;
      }
    ).reconcileRecreatedWorkerConnection(
      {
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        server_id: 'server-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.whatsmeow,
        previous_worker_type_id: EWorkerType.baileys,
        previous_worker_status_id: EWorkerStatus.online,
        session_storage: EWorkerSessionStorage.postgres,
        remove_session: false,
        remove_volume: false,
        lifecycle_operation_id: '00000000-0000-4000-8000-000000000057',
      },
      EWorkerType.whatsmeow,
      2,
      {
        signal: new AbortController().signal,
        assertActive: jest.fn(),
      }
    );

    expect(reconciliation.workerStatusId).toBe(EWorkerStatus.online);
    expect(
      deps.workerBaileysGrpcClientService.requestConnection
    ).toHaveBeenCalledTimes(1);
  });

  it('rejects a completed discard gate whose provider direction does not match the lifecycle', async () => {
    const deps = buildHandler();
    (
      deps.workerRuntimeRepository
        .viewWhatsappProviderHandoffDiscardPrimaryGate as jest.Mock
    ).mockResolvedValue({
      handoff_id: '00000000-0000-4000-8000-000000000065',
      operation_id: '00000000-0000-4000-8000-000000000066',
      source_provider: 'wwebjs',
      target_provider: 'whatsmeow',
      session_present: false,
      cleanup_finalized_at: '2026-08-06T20:00:00.000Z',
    });

    await expect(
      (
        deps.handler as unknown as {
          reconcileRecreatedWorkerConnection(
            data: IWorkerPayload,
            workerType: EWorkerType,
            runtimeGeneration: number,
            lease: ILockLeaseContext
          ): Promise<unknown>;
        }
      ).reconcileRecreatedWorkerConnection(
        {
          action: EWorkerAction.recreate,
          worker_id: 'worker-1',
          server_id: 'server-1',
          account_id: 'account-1',
          worker_type_id: EWorkerType.whatsmeow,
          previous_worker_type_id: EWorkerType.baileys,
          previous_worker_status_id: EWorkerStatus.online,
          session_storage: EWorkerSessionStorage.postgres,
          remove_session: false,
          remove_volume: false,
          lifecycle_operation_id: '00000000-0000-4000-8000-000000000066',
        },
        EWorkerType.whatsmeow,
        2,
        {
          signal: new AbortController().signal,
          assertActive: jest.fn(),
        }
      )
    ).rejects.toThrow('postgres_provider_handoff_context_missing');

    expect(
      deps.workerBaileysGrpcClientService.requestConnection
    ).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'provider identity mismatch',
      context: {
        handoff_id: '00000000-0000-4000-8000-000000000058',
        lifecycle_operation_id: '00000000-0000-4000-8000-000000000059',
        source_provider: 'wwebjs',
        target_provider: 'whatsmeow',
        source_revision_id: '1',
        target_revision_id: '2',
        state: 'validating',
      },
      expectedError: 'postgres_provider_handoff_context_invalid',
    },
    {
      label: 'failed handoff',
      context: {
        handoff_id: '00000000-0000-4000-8000-000000000058',
        lifecycle_operation_id: '00000000-0000-4000-8000-000000000059',
        source_provider: 'baileys',
        target_provider: 'whatsmeow',
        source_revision_id: '1',
        target_revision_id: '2',
        state: 'failed',
      },
      expectedError: 'postgres_provider_handoff_rolled_back',
    },
  ])(
    'fails closed without QR for $label context',
    async ({ context, expectedError }) => {
      const deps = buildHandler();
      (
        deps.workerRuntimeRepository
          .viewWhatsappProviderHandoffLifecycleContext as jest.Mock
      ).mockResolvedValue(context);

      await expect(
        (
          deps.handler as unknown as {
            reconcileRecreatedWorkerConnection(
              data: IWorkerPayload,
              workerType: EWorkerType,
              runtimeGeneration: number,
              lease: ILockLeaseContext
            ): Promise<unknown>;
          }
        ).reconcileRecreatedWorkerConnection(
          {
            action: EWorkerAction.recreate,
            worker_id: 'worker-1',
            server_id: 'server-1',
            account_id: 'account-1',
            worker_type_id: EWorkerType.whatsmeow,
            previous_worker_type_id: EWorkerType.baileys,
            previous_worker_status_id: EWorkerStatus.online,
            session_storage: EWorkerSessionStorage.postgres,
            remove_session: false,
            remove_volume: false,
            lifecycle_operation_id: '00000000-0000-4000-8000-000000000059',
          },
          EWorkerType.whatsmeow,
          2,
          {
            signal: new AbortController().signal,
            assertActive: jest.fn(),
          }
        )
      ).rejects.toThrow(expectedError);

      expect(
        deps.workerBaileysGrpcClientService.requestConnection
      ).not.toHaveBeenCalled();
    }
  );

  it('revalidates the durable handoff after each health probe and rejects rollback immediately', async () => {
    const deps = buildHandler();
    const lifecycleContext = {
      handoff_id: '00000000-0000-4000-8000-000000000060',
      lifecycle_operation_id: '00000000-0000-4000-8000-000000000061',
      source_provider: 'baileys',
      target_provider: 'whatsmeow',
      source_revision_id: '1',
      target_revision_id: '2',
    };
    (
      deps.workerRuntimeRepository
        .viewWhatsappProviderHandoffLifecycleContext as jest.Mock
    )
      .mockResolvedValueOnce({ ...lifecycleContext, state: 'validating' })
      .mockResolvedValueOnce({ ...lifecycleContext, state: 'failed' });
    deps.workerBaileysGrpcClientService.runtimeHealth.mockResolvedValueOnce({
      ...nativeRuntimeContract(EWorkerType.whatsmeow, true),
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
      has_qr: false,
      runtime_state: 'active',
      provider_state: 'CONNECTED',
      phone: '+556192037138',
      kafka_unhealthy: false,
      kafka_consumers_ready: true,
      kafka_consumers_authorized: true,
      runtime_generation: 2,
    });

    await expect(
      (
        deps.handler as unknown as {
          reconcileRecreatedWorkerConnection(
            data: IWorkerPayload,
            workerType: EWorkerType,
            runtimeGeneration: number,
            lease: ILockLeaseContext
          ): Promise<unknown>;
        }
      ).reconcileRecreatedWorkerConnection(
        {
          action: EWorkerAction.recreate,
          worker_id: 'worker-1',
          server_id: 'server-1',
          account_id: 'account-1',
          worker_type_id: EWorkerType.whatsmeow,
          previous_worker_type_id: EWorkerType.baileys,
          previous_worker_status_id: EWorkerStatus.online,
          session_storage: EWorkerSessionStorage.postgres,
          remove_session: false,
          remove_volume: false,
          lifecycle_operation_id: '00000000-0000-4000-8000-000000000061',
        },
        EWorkerType.whatsmeow,
        2,
        {
          signal: new AbortController().signal,
          assertActive: jest.fn(),
        }
      )
    ).rejects.toThrow('postgres_provider_handoff_rolled_back');

    expect(
      deps.workerRuntimeRepository.viewWhatsappProviderHandoffLifecycleContext
    ).toHaveBeenCalledTimes(2);
    expect(
      deps.workerBaileysGrpcClientService.requestConnection
    ).not.toHaveBeenCalled();
  });

  it.each([
    ['ready=false', { ready: false }],
    ['has_session=false', { has_session: false }],
    ['has_qr=true', { has_qr: true }],
    ['worker identity mismatch', { worker_id: 'worker-other' }],
    ['account identity mismatch', { account_id: 'account-other' }],
  ])(
    'does not accept contradictory handoff health with %s',
    async (_label, contradiction) => {
      const deps = buildHandler();
      (
        deps.workerRuntimeRepository
          .viewWhatsappProviderHandoffLifecycleContext as jest.Mock
      ).mockResolvedValue({
        handoff_id: '00000000-0000-4000-8000-000000000062',
        lifecycle_operation_id: '00000000-0000-4000-8000-000000000063',
        source_provider: 'baileys',
        target_provider: 'whatsmeow',
        source_revision_id: '1',
        target_revision_id: '2',
        state: 'validating',
      });
      (deps.handler as any).recreateOnlineReconciliationWaitMs = 1;
      (deps.handler as any).providerHandoffOnlineReconciliationWaitMs = 1;
      (deps.handler as any).recreateOnlineReconciliationPollIntervalMs = 0;
      deps.workerBaileysGrpcClientService.runtimeHealth.mockResolvedValue({
        ...nativeRuntimeContract(EWorkerType.whatsmeow, true),
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
        has_qr: false,
        runtime_state: 'active',
        provider_state: 'CONNECTED',
        phone: '+556192037138',
        kafka_unhealthy: false,
        kafka_consumers_ready: true,
        kafka_consumers_authorized: true,
        runtime_generation: 2,
        ...contradiction,
      });

      await expect(
        (
          deps.handler as unknown as {
            reconcileRecreatedWorkerConnection(
              data: IWorkerPayload,
              workerType: EWorkerType,
              runtimeGeneration: number,
              lease: ILockLeaseContext
            ): Promise<unknown>;
          }
        ).reconcileRecreatedWorkerConnection(
          {
            action: EWorkerAction.recreate,
            worker_id: 'worker-1',
            server_id: 'server-1',
            account_id: 'account-1',
            worker_type_id: EWorkerType.whatsmeow,
            previous_worker_type_id: EWorkerType.baileys,
            previous_worker_status_id: EWorkerStatus.online,
            session_storage: EWorkerSessionStorage.postgres,
            remove_session: false,
            remove_volume: false,
            lifecycle_operation_id: '00000000-0000-4000-8000-000000000063',
          },
          EWorkerType.whatsmeow,
          2,
          {
            signal: new AbortController().signal,
            assertActive: jest.fn(),
          }
        )
      ).rejects.toThrow('Provider handoff target session readiness');

      expect(
        deps.workerBaileysGrpcClientService.requestConnection
      ).not.toHaveBeenCalled();
    }
  );

  it('does not mistake QR transport readiness for provider connection readiness', async () => {
    const deps = buildHandler();
    (deps.handler as any).recreateOnlineReconciliationPollIntervalMs = 0;

    await handleWorkerCommand(deps, {
      action: EWorkerAction.recreate,
      worker_id: 'worker-1',
      server_id: 'server-1',
      account_id: 'account-1',
      previous_worker_status_id: EWorkerStatus.online,
    });

    expect(
      deps.workerBaileysGrpcClientService.requestConnection
    ).toHaveBeenCalledTimes(1);
    expect(
      deps.workerBaileysGrpcClientService.runtimeHealth
    ).toHaveBeenCalledTimes(1);
    expect(deps.workerService.updateWorkerById).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.disponible,
        container_id: 'container-1',
        number: null,
        connection_date: null,
      })
    );
  });

  it('downgrades the complete reconciliation when post-response health proves the session absent', async () => {
    const deps = buildHandler();
    deps.workerBaileysGrpcClientService.runtimeHealth.mockResolvedValueOnce({
      ...nativeRuntimeContract(EWorkerType.wwebjs, false),
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      activated: true,
      ready: true,
      qr_stream_ready: true,
      runtime_state: 'active',
      session_ready: false,
      can_send: false,
      can_receive_runtime: false,
      authenticated: false,
      standby: false,
      has_session: false,
      provider_state: 'not_initialized',
      kafka_unhealthy: true,
      runtime_generation: 2,
    });

    await handleWorkerCommand(deps, {
      action: EWorkerAction.recreate,
      worker_id: 'worker-1',
      server_id: 'server-1',
      account_id: 'account-1',
      previous_worker_status_id: EWorkerStatus.online,
    });

    expect(
      deps.workerBaileysGrpcClientService.requestConnection
    ).toHaveBeenCalledTimes(1);
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
      expect.objectContaining({ worker_status_id: EWorkerStatus.online })
    );
    expect(deps.centrifugoService.publishSubStrict).toHaveBeenCalledWith(
      expect.stringContaining('account-1'),
      expect.objectContaining({
        event_type: 'status',
        worker_status_id: EWorkerStatus.disponible,
        lifecycle_phase: 'completed',
        recreate_completed_operation_id: 'test-lifecycle-operation',
        recreate_completed_runtime_generation: 2,
      })
    );
    const terminalPayload =
      deps.centrifugoService.publishSubStrict.mock.calls.at(-1)?.[1];
    expect(terminalPayload).not.toHaveProperty('session_ready');
    expect(terminalPayload).not.toHaveProperty('can_send');
    expect(terminalPayload).not.toHaveProperty('can_receive_runtime');
    expect(terminalPayload).not.toHaveProperty('authenticated');
    expect(deps.centrifugoService.publishSubStrict).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ worker_status_id: EWorkerStatus.online })
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
    deps.workerBaileysGrpcClientService.runtimeHealth
      .mockResolvedValueOnce({
        ...nativeRuntimeContract(EWorkerType.wwebjs, false),
        worker_type_id: EWorkerType.wwebjs,
        activated: false,
        runtime_generation: 2,
      })
      .mockResolvedValueOnce({
        ...nativeRuntimeContract(EWorkerType.wwebjs, true),
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
        kafka_unhealthy: false,
        kafka_consumers_ready: true,
        kafka_consumers_authorized: true,
        runtime_generation: 2,
      });

    await handleWorkerCommand(deps, {
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
    expect(deps.centrifugoService.publishSubStrict).toHaveBeenCalledWith(
      expect.stringContaining('account-1'),
      expect.objectContaining({
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_status_id: EWorkerStatus.online,
        lifecycle_phase: 'completed',
        recreate_completed_operation_id: 'test-lifecycle-operation',
        recreate_completed_runtime_generation: 2,
      })
    );
    const terminalPayload =
      deps.centrifugoService.publishSubStrict.mock.calls.at(-1)?.[1];
    expect(terminalPayload).not.toHaveProperty('phone');
    expect(terminalPayload).not.toHaveProperty('session_ready');
    expect(terminalPayload).not.toHaveProperty('can_send');
    expect(terminalPayload).not.toHaveProperty('can_receive_runtime');
    expect(terminalPayload).not.toHaveProperty('authenticated');
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
        ...nativeRuntimeContract(EWorkerType.wwebjs, false),
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
        runtime_generation: 2,
      })
      .mockResolvedValueOnce({
        ...nativeRuntimeContract(EWorkerType.wwebjs, true),
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
        kafka_unhealthy: false,
        kafka_consumers_ready: true,
        kafka_consumers_authorized: true,
        runtime_generation: 2,
      });

    await handleWorkerCommand(deps, {
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

  it('never publishes disponible while an authenticated recreated session is waiting for Kafka assignment', async () => {
    const deps = buildHandler();
    (deps.handler as any).recreateOnlineReconciliationWaitMs = 25;
    (deps.handler as any).recreateOnlineReconciliationPollIntervalMs = 1;
    deps.workerBaileysGrpcClientService.requestConnection.mockResolvedValueOnce(
      buildConnectingState()
    );
    deps.workerBaileysGrpcClientService.runtimeHealth
      .mockResolvedValueOnce({
        ...nativeRuntimeContract(EWorkerType.wwebjs, false),
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
        activated: true,
        ready: true,
        session_ready: false,
        can_send: false,
        can_receive_runtime: false,
        authenticated: true,
        standby: false,
        has_session: true,
        runtime_state: 'active',
        qr_stream_ready: true,
        kafka_consumers_ready: false,
        kafka_unhealthy: false,
        provider_state: 'CONNECTED',
        phone: '556192037138',
        runtime_generation: 2,
      })
      .mockResolvedValueOnce({
        ...nativeRuntimeContract(EWorkerType.wwebjs, true),
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
        kafka_consumers_ready: true,
        kafka_consumers_authorized: true,
        kafka_unhealthy: false,
        provider_state: 'CONNECTED',
        phone: '556192037138',
        runtime_generation: 2,
      });

    await handleWorkerCommand(deps, {
      action: EWorkerAction.recreate,
      worker_id: 'worker-1',
      server_id: 'server-1',
      account_id: 'account-1',
      previous_worker_status_id: EWorkerStatus.online,
    });

    expect(
      deps.workerBaileysGrpcClientService.runtimeHealth
    ).toHaveBeenCalledTimes(2);
    expect(deps.workerService.updateWorkerById).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.online,
        container_id: 'container-1',
      })
    );
    expect(deps.workerService.updateWorkerById).not.toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_status_id: EWorkerStatus.disponible,
      })
    );
    expect(deps.centrifugoService.publishSub).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        worker_status_id: EWorkerStatus.disponible,
      })
    );
  });

  it('finalizes an explicitly reset WWebJS replacement as disponible when the exact QR runtime has no native client or Kafka consumers', async () => {
    const deps = buildHandler();
    const lifecycleOperationId = '019fe724-a608-74b9-a76a-4449f9a0f49f';
    const controlContainerId = 'a'.repeat(64);
    const runtimeContainerId = 'b'.repeat(64);
    const runtimeGeneration = 32;
    const initialWorker = {
      worker_id: 'worker-1',
      name: 'Canal 1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: EWorkerType.wwebjs,
      session_storage: EWorkerSessionStorage.postgres,
      created_at: null,
      updated_at: '2026-08-09T12:29:26.545-03:00',
      deleted_at: null,
      container_id: controlContainerId,
      runtime_container_id: runtimeContainerId,
      runtime_generation: runtimeGeneration,
      runtime_session_volume_name: null,
      lifecycle_operation_id: lifecycleOperationId,
      recreate_bootstrap_operation_id: lifecycleOperationId,
      recreate_bootstrap_runtime_generation: runtimeGeneration,
      recreate_bootstrap_container_id: runtimeContainerId,
      recreate_bootstrap_started_at: '2026-08-09T12:56:51.960-03:00',
      recreate_retired_operation_id: null,
      recreate_retired_runtime_generation: null,
      recreate_retired_container_id: null,
      recreate_retired_at: null,
      last_connection_check_at: null,
    };
    const persistedWorker = emulatePersistedRecreateCompletion(
      deps,
      initialWorker
    );
    (deps.handler as any).recreateOnlineReconciliationWaitMs = 100;
    (deps.handler as any).recreateOnlineReconciliationPollIntervalMs = 0;
    deps.workerBaileysGrpcClientService.runtimeHealth.mockResolvedValue(
      sourceLessQrReadyWwebjsRuntimeHealth({
        runtime_generation: runtimeGeneration,
      })
    );

    await expect(
      (
        deps.handler as unknown as {
          finalizeAdoptedRecreateRuntime(input: {
            data: IWorkerPayload;
            workerType: EWorkerType;
            controlContainerId: string;
            containerId: string;
            runtimeGeneration: number;
            sessionWasReset: boolean;
            leaseContext: ILockLeaseContext;
          }): Promise<unknown>;
        }
      ).finalizeAdoptedRecreateRuntime({
        data: {
          action: EWorkerAction.recreate,
          worker_id: 'worker-1',
          account_id: 'account-1',
          server_id: 'server-1',
          worker_type_id: EWorkerType.wwebjs,
          previous_worker_type_id: EWorkerType.wwebjs,
          session_storage: EWorkerSessionStorage.postgres,
          previous_worker_status_id: EWorkerStatus.online,
          remove_session: true,
          remove_volume: false,
          lifecycle_operation_id: lifecycleOperationId,
          debug_trace_id: 'trace-source-less-empty-runtime',
        },
        workerType: EWorkerType.wwebjs,
        controlContainerId,
        containerId: runtimeContainerId,
        runtimeGeneration,
        sessionWasReset: true,
        leaseContext: {
          signal: new AbortController().signal,
          assertActive: jest.fn(),
        },
      })
    ).resolves.toBeDefined();

    expect(
      deps.workerBaileysGrpcClientService.runtimeHealth.mock.calls.length
    ).toBeGreaterThanOrEqual(2);
    expect(
      deps.workerBaileysGrpcClientService.requestConnection
    ).not.toHaveBeenCalled();
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.disponible,
        worker_type_id: EWorkerType.wwebjs,
        container_id: runtimeContainerId,
        lifecycle_operation_id: null,
        number: null,
        connection_date: null,
      }),
      expect.objectContaining({
        lifecycle_operation_id: lifecycleOperationId,
        container_id: controlContainerId,
        runtime_container_id: runtimeContainerId,
        runtime_generation: runtimeGeneration,
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        worker_status_id: EWorkerStatus.recreating,
        recreate_completion: {
          operation_id: lifecycleOperationId,
          runtime_generation: runtimeGeneration,
          mode: 'replacement_runtime',
        },
      })
    );
    expect(persistedWorker()).toEqual(
      expect.objectContaining({
        worker_status_id: EWorkerStatus.disponible,
        container_id: runtimeContainerId,
        runtime_generation: runtimeGeneration,
        lifecycle_operation_id: null,
        recreate_completed_operation_id: lifecycleOperationId,
        recreate_completed_runtime_generation: runtimeGeneration,
        recreate_completed_at: expect.any(String),
        number: null,
        connection_date: null,
      })
    );
    expect(deps.centrifugoService.publishSubStrict).toHaveBeenCalledWith(
      expect.stringContaining('account-1'),
      expect.objectContaining({
        event_type: 'status',
        lifecycle_phase: 'completed',
        worker_status_id: EWorkerStatus.disponible,
        runtime_generation: runtimeGeneration,
        recreate_completed_operation_id: lifecycleOperationId,
        recreate_completed_runtime_generation: runtimeGeneration,
      })
    );
    expect(deps.centrifugoService.publishStrict).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        lifecycle_phase: 'completed',
        worker_status_id: EWorkerStatus.disponible,
        runtime_generation: runtimeGeneration,
      })
    );
  });

  it.each([
    EWhatsappConnectionStatus.loggedOut,
    EWhatsappConnectionStatus.invalidSession,
  ])(
    'reconciles an empty QR-ready Baileys runtime with native status %s as disponible',
    async (nativeStatus) => {
      const deps = buildHandler();
      const runtimeGeneration = 69;
      deps.workerBaileysGrpcClientService.runtimeHealth.mockResolvedValue({
        ...nativeRuntimeContract(EWorkerType.baileys, false),
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.baileys,
        activated: true,
        ready: true,
        standby: false,
        runtime_state: 'active',
        runtime_generation: runtimeGeneration,
        qr_stream_ready: true,
        has_session: false,
        has_qr: false,
        session_ready: false,
        can_send: false,
        can_receive_runtime: false,
        authenticated: false,
        provider_state: nativeStatus,
        degraded_reason: 'authentication_revoked',
        phone: '',
        kafka_unhealthy: true,
        kafka_consumers_ready: false,
        kafka_consumers_authorized: false,
        error: '',
        connection_status: {
          provider: 'baileys',
          status: nativeStatus,
          connected: false,
          authenticated: false,
          sessionValid: false,
          recoverable: false,
          qrAvailable: false,
          sequence: 2,
          changedAt: CONNECTION_STATUS_CHANGED_AT,
        },
      });

      const result = await (
        deps.handler as unknown as {
          probeRecreatedWorkerRuntimeHealth: (
            data: IWorkerPayload,
            workerType: EWorkerType,
            expectedRuntimeGeneration: number,
            leaseContext: ILockLeaseContext
          ) => Promise<{
            reconciliation: {
              workerStatusId: EWorkerStatus;
              connectionState: IBaileysConnectionState;
            } | null;
          }>;
        }
      ).probeRecreatedWorkerRuntimeHealth(
        {
          action: EWorkerAction.recreate,
          worker_id: 'worker-1',
          account_id: 'account-1',
          server_id: 'server-1',
          worker_type_id: EWorkerType.baileys,
          previous_worker_type_id: EWorkerType.baileys,
          session_storage: EWorkerSessionStorage.legacy_volume,
          previous_worker_status_id: EWorkerStatus.online,
          remove_session: false,
          remove_volume: false,
          lifecycle_operation_id: '019ff621-b64d-74ca-8375-2eaab8104372',
        },
        EWorkerType.baileys,
        runtimeGeneration,
        {
          signal: new AbortController().signal,
          assertActive: jest.fn(),
        }
      );

      expect(result.reconciliation).toEqual(
        expect.objectContaining({
          workerStatusId: EWorkerStatus.disponible,
          connectionState: expect.objectContaining({
            worker_status_id: EWorkerStatus.disponible,
            authenticated: false,
            session_ready: false,
            can_send: false,
            can_receive_runtime: false,
          }),
        })
      );
    }
  );

  it('reconciles a credential-bearing Baileys runtime that explicitly requires pairing as disponible', async () => {
    const deps = buildHandler();
    (deps.handler as any).recreateOnlineReconciliationWaitMs = 1;
    (deps.handler as any).recreateOnlineReconciliationPollIntervalMs = 0;
    const runtimeGeneration = 70;
    deps.workerBaileysGrpcClientService.requestConnection.mockResolvedValueOnce(
      buildConnectingState()
    );
    deps.workerBaileysGrpcClientService.runtimeHealth.mockResolvedValue({
      ...nativeRuntimeContract(EWorkerType.baileys, false),
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.baileys,
      activated: true,
      ready: true,
      standby: false,
      runtime_state: 'active',
      runtime_generation: runtimeGeneration,
      qr_stream_ready: true,
      has_session: true,
      has_qr: true,
      session_ready: false,
      can_send: false,
      can_receive_runtime: false,
      authenticated: false,
      provider_state: 'pairing_required',
      degraded_reason: 'pairing_required',
      phone: '',
      kafka_unhealthy: true,
      kafka_consumers_ready: false,
      kafka_consumers_authorized: false,
      error: '',
      connection_status: {
        provider: 'baileys',
        status: EWhatsappConnectionStatus.qr,
        connected: false,
        authenticated: false,
        sessionValid: null,
        recoverable: true,
        qrAvailable: true,
        sequence: 3,
        changedAt: CONNECTION_STATUS_CHANGED_AT,
      },
    });

    const result = await (
      deps.handler as unknown as {
        reconcileRecreatedWorkerConnection: (
          data: IWorkerPayload,
          workerType: EWorkerType,
          expectedRuntimeGeneration: number,
          leaseContext: ILockLeaseContext
        ) => Promise<{
          workerStatusId: EWorkerStatus;
          connectionState: IBaileysConnectionState;
        }>;
      }
    ).reconcileRecreatedWorkerConnection(
      {
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        previous_worker_type_id: EWorkerType.baileys,
        session_storage: EWorkerSessionStorage.legacy_volume,
        previous_worker_status_id: EWorkerStatus.disponible,
        remove_session: false,
        remove_volume: false,
        lifecycle_operation_id: '019ff621-b64d-74ca-8375-2eaab8104373',
      },
      EWorkerType.baileys,
      runtimeGeneration,
      {
        signal: new AbortController().signal,
        assertActive: jest.fn(),
      }
    );

    expect(result).toEqual(
      expect.objectContaining({
        workerStatusId: EWorkerStatus.disponible,
        connectionState: expect.objectContaining({
          worker_status_id: EWorkerStatus.disponible,
          authenticated: false,
          session_ready: false,
        }),
      })
    );
    expect(
      deps.workerBaileysGrpcClientService.requestConnection
    ).not.toHaveBeenCalled();
  });

  it('reconciles a credential-bearing WWebJS runtime after an explicit non-recoverable initialization failure', async () => {
    const deps = buildHandler();
    const runtimeGeneration = 72;
    deps.workerBaileysGrpcClientService.runtimeHealth.mockResolvedValue({
      ...nativeRuntimeContract(EWorkerType.wwebjs, false),
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      activated: true,
      ready: true,
      standby: false,
      runtime_state: 'active',
      runtime_generation: runtimeGeneration,
      qr_stream_ready: true,
      has_session: true,
      has_qr: false,
      session_ready: false,
      can_send: false,
      can_receive_runtime: false,
      authenticated: false,
      provider_state: 'initialize_error',
      degraded_reason: 'wwebjs_auth_state_timeout',
      phone: '',
      kafka_unhealthy: true,
      kafka_consumers_ready: false,
      kafka_consumers_authorized: false,
      error: 'wwebjs_auth_state_timeout',
      connection_status: {
        provider: 'wwebjs',
        status: EWhatsappConnectionStatus.error,
        connected: false,
        authenticated: false,
        sessionValid: null,
        recoverable: false,
        qrAvailable: false,
        sequence: 3,
        changedAt: CONNECTION_STATUS_CHANGED_AT,
      },
    });

    const result = await (
      deps.handler as unknown as {
        reconcileRecreatedWorkerConnection: (
          data: IWorkerPayload,
          workerType: EWorkerType,
          expectedRuntimeGeneration: number,
          leaseContext: ILockLeaseContext
        ) => Promise<{
          workerStatusId: EWorkerStatus;
          connectionState: IBaileysConnectionState;
        }>;
      }
    ).reconcileRecreatedWorkerConnection(
      {
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        previous_worker_type_id: EWorkerType.wwebjs,
        session_storage: EWorkerSessionStorage.legacy_volume,
        previous_worker_status_id: EWorkerStatus.disponible,
        remove_session: false,
        remove_volume: false,
        lifecycle_operation_id: '019ff621-b64d-74ca-8375-2eaab8104375',
      },
      EWorkerType.wwebjs,
      runtimeGeneration,
      {
        signal: new AbortController().signal,
        assertActive: jest.fn(),
      }
    );

    expect(result).toEqual(
      expect.objectContaining({
        workerStatusId: EWorkerStatus.disponible,
        connectionState: expect.objectContaining({
          worker_status_id: EWorkerStatus.disponible,
          authenticated: false,
          session_ready: false,
        }),
      })
    );
    expect(
      deps.workerBaileysGrpcClientService.requestConnection
    ).not.toHaveBeenCalled();
  });

  it('recovers a durable non-recoverable native terminal when the recreated runtime exits before gRPC health probing', async () => {
    const deps = buildHandler();
    const lifecycleOperationId = '019ff621-b64d-74ca-8375-2eaab8104376';
    const runtimeGeneration = 73;
    const containerId = 'd'.repeat(64);
    const sourceId = '019ff621-c377-71b4-b030-20f554363868';
    const changedAt = '2026-08-16T03:35:10.281Z';
    const nativeStatus = {
      provider: 'wwebjs' as const,
      status: EWhatsappConnectionStatus.error,
      connected: false,
      authenticated: false,
      sessionValid: null,
      recoverable: false,
      qrAvailable: false,
      sequence: 4,
      changedAt,
      reason: 'initialization_failed',
    };
    deps.workerBaileysGrpcClientService.runtimeHealth.mockRejectedValue(
      new Error('runtime unavailable')
    );
    const durableProof = deps.workerRuntimeRepository
      .viewRecreatedWorkerUnavailableNativeTerminalProof as jest.Mock;
    durableProof.mockResolvedValue({
      container_id: containerId,
      connection_status: nativeStatus,
      connection_status_source_id: sourceId,
      connection_status_sequence: nativeStatus.sequence,
      connection_status_changed_at: changedAt,
    });

    const result = await (
      deps.handler as unknown as {
        probeRecreatedWorkerRuntimeHealth: (
          data: IWorkerPayload,
          workerType: EWorkerType,
          expectedRuntimeGeneration: number,
          leaseContext: ILockLeaseContext
        ) => Promise<{ reconciliation: Record<string, unknown> | null }>;
      }
    ).probeRecreatedWorkerRuntimeHealth(
      {
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        previous_worker_type_id: EWorkerType.wwebjs,
        session_storage: EWorkerSessionStorage.legacy_volume,
        previous_worker_status_id: EWorkerStatus.disponible,
        remove_session: false,
        remove_volume: false,
        lifecycle_operation_id: lifecycleOperationId,
      },
      EWorkerType.wwebjs,
      runtimeGeneration,
      {
        signal: new AbortController().signal,
        assertActive: jest.fn(),
      }
    );

    expect(durableProof).toHaveBeenCalledWith({
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.wwebjs,
      lifecycle_operation_id: lifecycleOperationId,
      runtime_generation: runtimeGeneration,
    });
    expect(result.reconciliation).toEqual(
      expect.objectContaining({
        workerStatusId: EWorkerStatus.disponible,
        connectionState: expect.objectContaining({
          worker_status_id: EWorkerStatus.disponible,
          provider_state: EWhatsappConnectionStatus.error,
          degraded_reason: 'initialization_failed',
          runtime_generation: runtimeGeneration,
          authenticated: false,
          session_ready: false,
        }),
      })
    );
  });

  it('recovers a durable native terminal when live health lost its in-memory native event', async () => {
    const deps = buildHandler();
    const lifecycleOperationId = '019ff621-b64d-74ca-8375-2eaab8104378';
    const runtimeGeneration = 75;
    const changedAt = '2026-08-16T03:41:10.281Z';
    const nativeStatus = {
      provider: 'wwebjs' as const,
      status: EWhatsappConnectionStatus.error,
      connected: false,
      authenticated: false,
      sessionValid: null,
      recoverable: false,
      qrAvailable: false,
      sequence: 5,
      changedAt,
      reason: 'initialization_failed',
    };
    deps.workerBaileysGrpcClientService.runtimeHealth.mockResolvedValue({
      ...sourceLessQrReadyWwebjsRuntimeHealth({
        runtime_generation: runtimeGeneration,
      }),
      connection_status_source_id: CONNECTION_STATUS_SOURCE_ID,
      connection_status: {},
    });
    const durableProof = deps.workerRuntimeRepository
      .viewRecreatedWorkerUnavailableNativeTerminalProof as jest.Mock;
    durableProof.mockResolvedValue({
      container_id: 'e'.repeat(64),
      connection_status: nativeStatus,
      connection_status_source_id: CONNECTION_STATUS_SOURCE_ID,
      connection_status_sequence: nativeStatus.sequence,
      connection_status_changed_at: changedAt,
    });

    const result = await (
      deps.handler as unknown as {
        probeRecreatedWorkerRuntimeHealth: (
          data: IWorkerPayload,
          workerType: EWorkerType,
          expectedRuntimeGeneration: number,
          leaseContext: ILockLeaseContext
        ) => Promise<{ reconciliation: Record<string, unknown> | null }>;
      }
    ).probeRecreatedWorkerRuntimeHealth(
      {
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        previous_worker_type_id: EWorkerType.wwebjs,
        session_storage: EWorkerSessionStorage.legacy_volume,
        previous_worker_status_id: EWorkerStatus.disponible,
        remove_session: false,
        remove_volume: false,
        lifecycle_operation_id: lifecycleOperationId,
      },
      EWorkerType.wwebjs,
      runtimeGeneration,
      {
        signal: new AbortController().signal,
        assertActive: jest.fn(),
      }
    );

    expect(durableProof).toHaveBeenCalledWith({
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.wwebjs,
      lifecycle_operation_id: lifecycleOperationId,
      runtime_generation: runtimeGeneration,
    });
    expect(result.reconciliation).toEqual(
      expect.objectContaining({
        workerStatusId: EWorkerStatus.disponible,
        connectionState: expect.objectContaining({
          worker_status_id: EWorkerStatus.disponible,
          provider_state: EWhatsappConnectionStatus.error,
          degraded_reason: 'initialization_failed',
          runtime_generation: runtimeGeneration,
        }),
      })
    );
  });

  it('does not use the unavailable durable terminal fallback for a channel that was online', async () => {
    const deps = buildHandler();
    deps.workerBaileysGrpcClientService.runtimeHealth.mockRejectedValue(
      new Error('runtime unavailable')
    );
    const durableProof = deps.workerRuntimeRepository
      .viewRecreatedWorkerUnavailableNativeTerminalProof as jest.Mock;

    const result = await (
      deps.handler as unknown as {
        probeRecreatedWorkerRuntimeHealth: (
          data: IWorkerPayload,
          workerType: EWorkerType,
          expectedRuntimeGeneration: number,
          leaseContext: ILockLeaseContext
        ) => Promise<{ reconciliation: Record<string, unknown> | null }>;
      }
    ).probeRecreatedWorkerRuntimeHealth(
      {
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        previous_worker_type_id: EWorkerType.wwebjs,
        session_storage: EWorkerSessionStorage.legacy_volume,
        previous_worker_status_id: EWorkerStatus.online,
        remove_session: false,
        remove_volume: false,
        lifecycle_operation_id: '019ff621-b64d-74ca-8375-2eaab8104377',
      },
      EWorkerType.wwebjs,
      74,
      {
        signal: new AbortController().signal,
        assertActive: jest.fn(),
      }
    );

    expect(durableProof).not.toHaveBeenCalled();
    expect(result.reconciliation).toBeNull();
  });

  it('keeps a credential-bearing Baileys runtime in reconciliation while it is still connecting', async () => {
    const deps = buildHandler();
    const runtimeGeneration = 71;
    deps.workerBaileysGrpcClientService.runtimeHealth.mockResolvedValue({
      ...nativeRuntimeContract(EWorkerType.baileys, false),
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.baileys,
      activated: true,
      ready: true,
      standby: false,
      runtime_state: 'active',
      runtime_generation: runtimeGeneration,
      qr_stream_ready: true,
      has_session: true,
      has_qr: false,
      session_ready: false,
      can_send: false,
      can_receive_runtime: false,
      authenticated: false,
      provider_state: 'connecting',
      phone: '',
      kafka_unhealthy: true,
      kafka_consumers_ready: false,
      kafka_consumers_authorized: false,
      error: '',
      connection_status: {
        provider: 'baileys',
        status: EWhatsappConnectionStatus.connecting,
        connected: false,
        authenticated: false,
        sessionValid: null,
        recoverable: true,
        qrAvailable: false,
        sequence: 2,
        changedAt: CONNECTION_STATUS_CHANGED_AT,
      },
    });

    const result = await (
      deps.handler as unknown as {
        probeRecreatedWorkerRuntimeHealth: (
          data: IWorkerPayload,
          workerType: EWorkerType,
          expectedRuntimeGeneration: number,
          leaseContext: ILockLeaseContext
        ) => Promise<{ reconciliation: unknown | null }>;
      }
    ).probeRecreatedWorkerRuntimeHealth(
      {
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        previous_worker_type_id: EWorkerType.baileys,
        session_storage: EWorkerSessionStorage.legacy_volume,
        previous_worker_status_id: EWorkerStatus.disponible,
        remove_session: false,
        remove_volume: false,
        lifecycle_operation_id: '019ff621-b64d-74ca-8375-2eaab8104374',
      },
      EWorkerType.baileys,
      runtimeGeneration,
      {
        signal: new AbortController().signal,
        assertActive: jest.fn(),
      }
    );

    expect(result.reconciliation).toBeNull();
  });

  it('explicitly authorizes QR recovery for a recreated channel that was already unavailable', async () => {
    const deps = buildHandler();
    (deps.handler as any).recreateOnlineReconciliationWaitMs = 1;
    (deps.handler as any).recreateOnlineReconciliationPollIntervalMs = 0;
    const runtimeGeneration = 76;
    const connectingHealth = {
      ...nativeRuntimeContract(EWorkerType.baileys, false),
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.baileys,
      activated: true,
      ready: true,
      standby: false,
      runtime_state: 'active',
      runtime_generation: runtimeGeneration,
      qr_stream_ready: true,
      has_session: true,
      has_qr: false,
      session_ready: false,
      can_send: false,
      can_receive_runtime: false,
      authenticated: false,
      provider_state: 'connecting',
      phone: '',
      kafka_unhealthy: true,
      kafka_consumers_ready: false,
      kafka_consumers_authorized: false,
      error: '',
      connection_status: {
        provider: 'baileys',
        status: EWhatsappConnectionStatus.connecting,
        connected: false,
        authenticated: false,
        sessionValid: null,
        recoverable: true,
        qrAvailable: false,
        sequence: 2,
        changedAt: CONNECTION_STATUS_CHANGED_AT,
      },
    };
    const qrHealth = {
      ...connectingHealth,
      has_qr: true,
      provider_state: 'pairing_required',
      degraded_reason: 'pairing_required',
      connection_status: {
        provider: 'baileys',
        status: EWhatsappConnectionStatus.qr,
        connected: false,
        authenticated: false,
        sessionValid: null,
        recoverable: true,
        qrAvailable: true,
        sequence: 3,
        changedAt: CONNECTION_STATUS_CHANGED_AT,
      },
    };
    deps.workerBaileysGrpcClientService.runtimeHealth
      .mockResolvedValueOnce(connectingHealth)
      .mockResolvedValue(qrHealth);
    deps.workerBaileysGrpcClientService.requestConnection.mockResolvedValue({
      ...buildConnectingState(),
      runtime_generation: runtimeGeneration,
    });

    const result = await (
      deps.handler as unknown as {
        reconcileRecreatedWorkerConnection: (
          data: IWorkerPayload,
          workerType: EWorkerType,
          expectedRuntimeGeneration: number,
          leaseContext: ILockLeaseContext
        ) => Promise<{
          workerStatusId: EWorkerStatus;
          connectionState: IBaileysConnectionState;
        }>;
      }
    ).reconcileRecreatedWorkerConnection(
      {
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        previous_worker_type_id: EWorkerType.baileys,
        session_storage: EWorkerSessionStorage.legacy_volume,
        previous_worker_status_id: EWorkerStatus.disponible,
        remove_session: false,
        remove_volume: false,
        lifecycle_operation_id: '019ff621-b64d-74ca-8375-2eaab8104379',
      },
      EWorkerType.baileys,
      runtimeGeneration,
      {
        signal: new AbortController().signal,
        assertActive: jest.fn(),
      }
    );

    expect(result.workerStatusId).toBe(EWorkerStatus.disponible);
    expect(
      deps.workerBaileysGrpcClientService.requestConnection
    ).toHaveBeenCalledWith(
      'worker-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        type: EBaileysConnectionType.qrcode,
        qr_pending: true,
        runtime_generation: runtimeGeneration,
      }),
      EWorkerType.baileys
    );
  });

  it('does not force QR recovery for a recreated channel that was online', async () => {
    const deps = buildHandler();
    const runtimeGeneration = 77;
    deps.workerBaileysGrpcClientService.requestConnection.mockResolvedValue({
      ...buildConnectedState(),
      runtime_generation: runtimeGeneration,
    });

    await (
      deps.handler as unknown as {
        reconcileRecreatedWorkerConnection: (
          data: IWorkerPayload,
          workerType: EWorkerType,
          expectedRuntimeGeneration: number,
          leaseContext: ILockLeaseContext
        ) => Promise<unknown>;
      }
    ).reconcileRecreatedWorkerConnection(
      {
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        previous_worker_type_id: EWorkerType.baileys,
        session_storage: EWorkerSessionStorage.legacy_volume,
        previous_worker_status_id: EWorkerStatus.online,
        remove_session: false,
        remove_volume: false,
        lifecycle_operation_id: '019ff621-b64d-74ca-8375-2eaab8104380',
      },
      EWorkerType.baileys,
      runtimeGeneration,
      {
        signal: new AbortController().signal,
        assertActive: jest.fn(),
      }
    );

    const request = (
      deps.workerBaileysGrpcClientService.requestConnection.mock
        .calls as unknown as Array<
        [string, { worker_id?: string; qr_pending?: boolean }, EWorkerType]
      >
    )[0]?.[1];
    expect(request).toEqual(
      expect.objectContaining({
        worker_id: 'worker-1',
        runtime_generation: runtimeGeneration,
      })
    );
    expect(request?.qr_pending).toBeUndefined();
  });

  it('does not terminalize a source-less empty WWebJS runtime from a stale generation', async () => {
    const deps = buildHandler();
    (deps.handler as any).recreateOnlineReconciliationWaitMs = 1;
    (deps.handler as any).recreateOnlineReconciliationPollIntervalMs = 0;
    deps.workerBaileysGrpcClientService.runtimeHealth.mockResolvedValue(
      sourceLessQrReadyWwebjsRuntimeHealth({ runtime_generation: 31 })
    );

    await expect(
      (
        deps.handler as unknown as {
          reconcileRecreatedWorkerConnection(
            data: IWorkerPayload,
            workerType: EWorkerType,
            runtimeGeneration: number,
            leaseContext: ILockLeaseContext
          ): Promise<unknown>;
        }
      ).reconcileRecreatedWorkerConnection(
        {
          action: EWorkerAction.recreate,
          worker_id: 'worker-1',
          account_id: 'account-1',
          server_id: 'server-1',
          worker_type_id: EWorkerType.wwebjs,
          previous_worker_type_id: EWorkerType.wwebjs,
          session_storage: EWorkerSessionStorage.postgres,
          previous_worker_status_id: EWorkerStatus.online,
          remove_session: true,
          remove_volume: false,
          lifecycle_operation_id: '019fe724-a608-74b9-a76a-4449f9a0f49f',
        },
        EWorkerType.wwebjs,
        32,
        {
          signal: new AbortController().signal,
          assertActive: jest.fn(),
        }
      )
    ).rejects.toThrow('Recreated worker runtime readiness was not confirmed');

    expect(
      deps.workerBaileysGrpcClientService.requestConnection
    ).not.toHaveBeenCalled();
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_status_id: EWorkerStatus.disponible,
      }),
      expect.anything()
    );
    expect(deps.centrifugoService.publishSubStrict).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        worker_status_id: EWorkerStatus.disponible,
      })
    );
  });

  it('does not falsely finalize a recreated worker as disponible before its QR runtime is ready', async () => {
    const deps = buildHandler();
    (deps.handler as any).recreateOnlineReconciliationWaitMs = 1;
    (deps.handler as any).recreateOnlineReconciliationPollIntervalMs = 0;
    deps.workerBaileysGrpcClientService.requestConnection.mockResolvedValueOnce(
      buildConnectingState()
    );
    deps.workerBaileysGrpcClientService.runtimeHealth.mockResolvedValue({
      ...nativeRuntimeContract(EWorkerType.wwebjs, false),
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.wwebjs,
      activated: true,
      ready: false,
      session_ready: false,
      can_send: false,
      can_receive_runtime: false,
      authenticated: false,
      standby: false,
      has_session: false,
      runtime_state: 'active',
      qr_stream_ready: false,
      provider_state: 'CONNECTING',
      phone: '',
      runtime_generation: 2,
    });

    await expect(
      handleWorkerCommand(deps, {
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        server_id: 'server-1',
        account_id: 'account-1',
        previous_worker_status_id: EWorkerStatus.online,
      })
    ).rejects.toThrow('connection confirmation remained pending');

    expect(deps.workerService.updateWorkerById).not.toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.disponible,
      })
    );
    expect(deps.centrifugoService.publishSub).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        worker_status_id: EWorkerStatus.disponible,
      })
    );
  });

  it('invalidates an available fallback when a later runtime probe is negative', async () => {
    const deps = buildHandler();
    (deps.handler as any).recreateOnlineReconciliationWaitMs = 100;
    (deps.handler as any).recreateOnlineReconciliationPollIntervalMs = 1;
    deps.workerBaileysGrpcClientService.requestConnection.mockResolvedValueOnce(
      buildConnectingState()
    );
    deps.workerBaileysGrpcClientService.runtimeHealth
      .mockResolvedValueOnce({
        ...nativeRuntimeContract(EWorkerType.wwebjs, false),
        worker_type_id: EWorkerType.wwebjs,
        activated: false,
        runtime_generation: 2,
      })
      .mockResolvedValueOnce({
        ...nativeRuntimeContract(EWorkerType.wwebjs, false),
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
        activated: true,
        ready: true,
        qr_stream_ready: true,
        runtime_state: 'active',
        session_ready: false,
        can_send: false,
        can_receive_runtime: false,
        authenticated: false,
        standby: false,
        has_session: false,
        runtime_generation: 2,
      })
      .mockResolvedValue({
        ...nativeRuntimeContract(EWorkerType.wwebjs, false),
        worker_type_id: EWorkerType.wwebjs,
        activated: false,
        ready: false,
        runtime_state: 'inactive',
        runtime_generation: 2,
      });

    await expect(
      handleWorkerCommand(deps, {
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        server_id: 'server-1',
        account_id: 'account-1',
        previous_worker_status_id: EWorkerStatus.online,
      })
    ).rejects.toThrow('connection confirmation remained pending');

    expect(
      deps.workerBaileysGrpcClientService.runtimeHealth.mock.calls.length
    ).toBeGreaterThanOrEqual(3);

    expect(deps.workerService.updateWorkerById).not.toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({ worker_status_id: EWorkerStatus.disponible })
    );
    expect(deps.centrifugoService.publishSub).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ worker_status_id: EWorkerStatus.disponible })
    );
  });

  it('finalizes recreate as disponible after a connection DEADLINE_EXCEEDED', async () => {
    const deps = buildHandler();
    (deps.handler as any).recreateOnlineReconciliationWaitMs = 100;
    (deps.handler as any).recreateOnlineReconciliationPollIntervalMs = 0;
    deps.workerBaileysGrpcClientService.requestConnection.mockRejectedValueOnce(
      {
        code: 4,
        details: 'Deadline exceeded',
      }
    );
    deps.workerBaileysGrpcClientService.runtimeHealth.mockResolvedValueOnce({
      ...nativeRuntimeContract(EWorkerType.wwebjs, false),
      worker_type_id: EWorkerType.wwebjs,
      activated: false,
      runtime_generation: 2,
    });

    await handleWorkerCommand(deps, {
      action: EWorkerAction.recreate,
      worker_id: 'worker-1',
      server_id: 'server-1',
      account_id: 'account-1',
      previous_worker_status_id: EWorkerStatus.online,
    });

    expect(
      deps.workerBaileysGrpcClientService.requestConnection
    ).toHaveBeenCalledTimes(1);

    expect(deps.workerService.updateWorkerById).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.disponible,
        container_id: 'container-1',
      })
    );
    expect(deps.centrifugoService.publishSubStrict).toHaveBeenCalledWith(
      expect.stringContaining('account-1'),
      expect.objectContaining({
        event_type: 'status',
        worker_status_id: EWorkerStatus.disponible,
        lifecycle_phase: 'completed',
        status: EBaileysConnectionStatus.info,
        code: ECodeMessage.info,
        recreate_completed_operation_id: 'test-lifecycle-operation',
        runtime_generation: 2,
      })
    );
    expect(
      deps.centrifugoService.publishSubStrict.mock.calls.at(-1)?.[1]
    ).toEqual(
      expect.objectContaining({
        lifecycle_phase: 'completed',
        worker_status_id: EWorkerStatus.disponible,
      })
    );
  });

  it('clears the completed recreate lifecycle while preserving its runtime generation', async () => {
    const deps = buildHandler();
    // The production gate requires two consecutive runtime-ready probes before
    // it may downgrade a previously-online session to QR-ready. Give the
    // zero-delay test loop enough wall-clock budget to collect both proofs.
    (deps.handler as any).recreateOnlineReconciliationWaitMs = 100;
    (deps.handler as any).recreateOnlineReconciliationPollIntervalMs = 0;
    deps.workerBaileysGrpcClientService.requestConnection.mockResolvedValueOnce(
      buildConnectingState()
    );
    deps.workerService.viewWorkerForMonitor.mockResolvedValue({
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: EWorkerType.wwebjs,
      container_id: 'container-old',
      lifecycle_operation_id: 'operation-1',
    });

    await handleWorkerCommand(deps, {
      action: EWorkerAction.recreate,
      worker_id: 'worker-1',
      server_id: 'server-1',
      account_id: 'account-1',
      previous_worker_status_id: EWorkerStatus.online,
      lifecycle_operation_id: 'operation-1',
    });

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.disponible,
        container_id: 'container-1',
        lifecycle_operation_id: null,
      }),
      expect.objectContaining({
        lifecycle_operation_id: 'operation-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        worker_status_id: EWorkerStatus.recreating,
      })
    );
    expect(deps.centrifugoService.publishSubStrict).toHaveBeenCalledWith(
      expect.stringContaining('account-1'),
      expect.objectContaining({
        event_type: 'status',
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.disponible,
        runtime_generation: 2,
      })
    );
  });

  it('fails without clearing the lifecycle so an unfinalized recreate can be redelivered', async () => {
    const deps = buildHandler();
    (deps.handler as any).recreateOnlineReconciliationWaitMs = 1;
    (deps.handler as any).recreateOnlineReconciliationPollIntervalMs = 0;
    deps.workerService.viewWorkerForMonitor.mockResolvedValue({
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: EWorkerType.wwebjs,
      container_id: 'container-old',
      lifecycle_operation_id: 'operation-1',
    });
    deps.workerService.updateWorkerByIdIfLifecycleMatches.mockResolvedValue(
      false
    );

    await expect(
      handleWorkerCommand(deps, {
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        server_id: 'server-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
        previous_worker_status_id: EWorkerStatus.disponible,
        lifecycle_operation_id: 'operation-1',
      })
    ).rejects.toThrow(
      'Recreate lifecycle could not be finalized by its active operation'
    );

    expect(deps.workerService.removeContainerWorkerById).toHaveBeenCalledWith(
      'container-1'
    );
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.error,
        lifecycle_operation_id: null,
      }),
      expect.anything()
    );
  });

  it('fails without clearing the lifecycle so an unfinalized create can be redelivered', async () => {
    const deps = buildHandler();
    deps.workerService.viewWorkerForMonitor.mockResolvedValue({
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.creating,
      worker_type_id: EWorkerType.wwebjs,
      container_id: null,
      lifecycle_operation_id: 'operation-1',
    });
    deps.workerService.updateWorkerByIdIfLifecycleMatches
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await expect(
      handleWorkerCommand(deps, {
        action: EWorkerAction.create,
        worker_id: 'worker-1',
        server_id: 'server-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
        lifecycle_operation_id: 'operation-1',
      })
    ).rejects.toThrow(
      'Create lifecycle could not be finalized by its active operation'
    );

    expect(deps.workerService.removeContainerWorkerById).toHaveBeenCalledWith(
      'container-1'
    );
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.error,
        lifecycle_operation_id: null,
      }),
      expect.anything()
    );
  });

  it('does not accept connected response or health from a mismatched recreate generation', async () => {
    const deps = buildHandler();
    (deps.handler as any).recreateOnlineReconciliationWaitMs = 1;
    (deps.handler as any).recreateOnlineReconciliationPollIntervalMs = 0;
    deps.workerBaileysGrpcClientService.requestConnection.mockResolvedValueOnce(
      {
        ...buildConnectedState(),
        runtime_generation: 3,
      }
    );
    deps.workerBaileysGrpcClientService.runtimeHealth.mockResolvedValue({
      ...nativeRuntimeContract(EWorkerType.wwebjs, true),
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
      kafka_unhealthy: false,
      runtime_generation: 3,
    });

    await expect(
      handleWorkerCommand(deps, {
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        server_id: 'server-1',
        account_id: 'account-1',
        previous_worker_status_id: EWorkerStatus.online,
      })
    ).rejects.toThrow('connection confirmation remained pending');

    expect(deps.workerService.updateWorkerById).not.toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({ worker_status_id: EWorkerStatus.disponible })
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

    await handleWorkerCommand(deps, {
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
    expect(deps.centrifugoService.publishSubStrict).toHaveBeenCalledWith(
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

  it('explicitly restores a durable session when recreating a previously disponible worker', async () => {
    const deps = buildHandler({
      runtimeHealthResponse: {
        worker_type_id: EWorkerType.whatsmeow,
      },
    });
    (deps.handler as any).recreateOnlineReconciliationWaitMs = 25;
    (deps.handler as any).recreateOnlineReconciliationPollIntervalMs = 1;
    deps.workerBaileysGrpcClientService.runtimeHealth
      .mockResolvedValueOnce({
        ...nativeRuntimeContract(EWorkerType.wwebjs, false),
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
        runtime_generation: 2,
      })
      .mockResolvedValueOnce({
        ...nativeRuntimeContract(EWorkerType.wwebjs, true),
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
        kafka_unhealthy: false,
        kafka_consumers_ready: true,
        kafka_consumers_authorized: true,
        runtime_generation: 2,
      });

    await handleWorkerCommand(deps, {
      action: EWorkerAction.recreate,
      worker_id: 'worker-1',
      server_id: 'server-1',
      account_id: 'account-1',
      previous_worker_status_id: EWorkerStatus.disponible,
    });

    expect(
      deps.workerBaileysGrpcClientService.requestConnection
    ).toHaveBeenCalledWith(
      'worker-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        status: EWorkerStatus.online,
        type: EBaileysConnectionType.qrcode,
        runtime_generation: 2,
      }),
      EWorkerType.wwebjs
    );
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
    expect(deps.workerService.updateWorkerById).not.toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        number: null,
        connection_date: null,
      })
    );
  });

  describe('recreate primary lifecycle fencing', () => {
    it('unwinds the liveness lock when an exact Docker inspection never settles', async () => {
      jest.useFakeTimers();
      try {
        const containerId = 'a'.repeat(64);
        const lifecycleOperationId = 'operation-liveness';
        const deps = buildHandler();
        const currentWorker = {
          worker_id: 'worker-1',
          name: 'Canal 1',
          account_id: 'account-1',
          server_id: 'server-1',
          worker_status_id: EWorkerStatus.recreating,
          worker_type_id: EWorkerType.wwebjs,
          created_at: null,
          updated_at: null,
          deleted_at: null,
          container_id: containerId,
          runtime_container_id: containerId,
          runtime_generation: 7,
          lifecycle_operation_id: lifecycleOperationId,
          last_connection_check_at: null,
        };
        (
          deps.workerService as unknown as {
            viewWorkerForMonitorConsistent: jest.Mock;
          }
        ).viewWorkerForMonitorConsistent.mockResolvedValue(currentWorker);
        deps.workerService.inspectContainerWorkerByIdStrict.mockImplementation(
          () => new Promise<WorkerContainerInspection>(() => undefined)
        );
        let activeLifecycleLocks = 0;
        deps.workerLifecycleLockService.withLock.mockImplementation(
          async (
            _workerId: string,
            _operation: string,
            callback: (context: {
              signal: AbortSignal;
              assertActive: () => void;
            }) => Promise<unknown>
          ) => {
            activeLifecycleLocks += 1;
            try {
              return await callback({
                signal: new AbortController().signal,
                assertActive: () => undefined,
              });
            } finally {
              activeLifecycleLocks -= 1;
            }
          }
        );
        const payload = {
          action: EWorkerAction.recreate,
          worker_id: 'worker-1',
          account_id: 'account-1',
          server_id: 'server-1',
          worker_type_id: EWorkerType.wwebjs,
          lifecycle_operation_id: lifecycleOperationId,
          expected_container_id: containerId,
          expected_container_started_at: '2026-07-29T22:00:00Z',
          expected_container_restart_count: 0,
          expected_container_health_status: 'unhealthy',
          expected_container_paused: false,
          expected_runtime_generation: 7,
        };

        const handling = handleWorkerCommand(deps, payload);
        const rejection = expect(handling).rejects.toThrow(
          'worker_recreate_liveness_fence_retry:docker_timeout:strict_inspect'
        );
        await jest.advanceTimersByTimeAsync(
          WORKER_LIVENESS_LOCAL_DOCKER_READ_TIMEOUT_MS
        );

        await rejection;
        expect(activeLifecycleLocks).toBe(0);

        deps.workerService.inspectContainerWorkerByIdStrict.mockResolvedValue(
          buildWorkerContainerInspection({
            container_id: containerId,
            container_started_at: '2026-07-29T22:00:00Z',
            container_restart_count: 0,
            container_health_status: 'unhealthy',
            container_paused: false,
            container_labels: {
              'underchat.worker_id': 'worker-1',
              'underchat.account_id': 'account-1',
              'underchat.server_id': 'server-1',
              'underchat.worker_type_id': EWorkerType.wwebjs,
              'underchat.runtime_generation': '7',
            },
          })
        );
        await expect(
          (
            deps.handler as unknown as {
              revalidateLivenessRecreateFence: (
                data: typeof payload,
                worker: typeof currentWorker,
                context: {
                  signal: AbortSignal;
                  assertActive: () => void;
                }
              ) => Promise<string>;
            }
          ).revalidateLivenessRecreateFence(payload, currentWorker, {
            signal: new AbortController().signal,
            assertActive: () => undefined,
          })
        ).resolves.toBe('proceed');
      } finally {
        jest.useRealTimers();
      }
    });

    it('rejects an old online finalizer after the same operation advances runtime generation', async () => {
      const staleContainerId = 'b'.repeat(64);
      const currentContainerId = 'c'.repeat(64);
      const lifecycleOperationId = 'operation-liveness';
      const deps = buildHandler();
      (
        deps.workerService as unknown as {
          viewWorkerForMonitorConsistent: jest.Mock;
        }
      ).viewWorkerForMonitorConsistent.mockResolvedValue({
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_status_id: EWorkerStatus.online,
        worker_type_id: EWorkerType.wwebjs,
        container_id: 'a'.repeat(64),
        runtime_container_id: currentContainerId,
        runtime_generation: 9,
        lifecycle_operation_id: lifecycleOperationId,
      });
      deps.workerService.updateWorkerByIdIfLifecycleMatches.mockImplementation(
        async (_accountId, _input, rawGuard) => {
          const guard = rawGuard as {
            runtime_container_id?: string;
            runtime_generation?: number;
          };
          return (
            guard.runtime_container_id === currentContainerId &&
            guard.runtime_generation === 9
          );
        }
      );

      await expect(
        (
          deps.handler as unknown as {
            finalizeAlreadyOnlineWorkerLifecycle: (
              accountId: string,
              data: Record<string, unknown>,
              workerType: EWorkerType,
              containerId: string,
              runtimeGeneration: number
            ) => Promise<boolean>;
          }
        ).finalizeAlreadyOnlineWorkerLifecycle(
          'account-1',
          {
            action: EWorkerAction.recreate,
            worker_id: 'worker-1',
            account_id: 'account-1',
            server_id: 'server-1',
            worker_type_id: EWorkerType.wwebjs,
            lifecycle_operation_id: lifecycleOperationId,
          },
          EWorkerType.wwebjs,
          staleContainerId,
          8
        )
      ).resolves.toBe(false);

      expect(
        deps.workerService.updateWorkerByIdIfLifecycleMatches
      ).toHaveBeenCalledWith(
        'account-1',
        expect.objectContaining({
          container_id: staleContainerId,
          lifecycle_operation_id: null,
        }),
        expect.objectContaining({
          lifecycle_operation_id: lifecycleOperationId,
          runtime_container_id: staleContainerId,
          runtime_generation: 8,
          worker_status_id: EWorkerStatus.online,
        })
      );
    });

    it('finalizes a replacement whose ONLINE event already advanced the worker pointer to the marked target', async () => {
      const targetContainerId = 'd'.repeat(64);
      const lifecycleOperationId = 'operation-online-before-finalize';
      const deps = buildHandler();
      (
        deps.workerService as unknown as {
          viewWorkerForMonitorConsistent: jest.Mock;
        }
      ).viewWorkerForMonitorConsistent.mockResolvedValue({
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_status_id: EWorkerStatus.online,
        worker_type_id: EWorkerType.wwebjs,
        container_id: targetContainerId,
        runtime_container_id: targetContainerId,
        runtime_generation: 8,
        lifecycle_operation_id: lifecycleOperationId,
      });
      deps.workerService.updateWorkerByIdIfLifecycleMatches.mockResolvedValue(
        true
      );

      await expect(
        (
          deps.handler as unknown as {
            finalizeAlreadyOnlineWorkerLifecycle: (
              accountId: string,
              data: Record<string, unknown>,
              workerType: EWorkerType,
              containerId: string,
              runtimeGeneration: number
            ) => Promise<boolean>;
          }
        ).finalizeAlreadyOnlineWorkerLifecycle(
          'account-1',
          {
            action: EWorkerAction.recreate,
            worker_id: 'worker-1',
            account_id: 'account-1',
            server_id: 'server-1',
            worker_type_id: EWorkerType.wwebjs,
            lifecycle_operation_id: lifecycleOperationId,
          },
          EWorkerType.wwebjs,
          targetContainerId,
          8
        )
      ).resolves.toBe(true);

      expect(
        deps.workerService.updateWorkerByIdIfLifecycleMatches
      ).toHaveBeenCalledWith(
        'account-1',
        {
          worker_id: 'worker-1',
          container_id: targetContainerId,
          lifecycle_operation_id: null,
        },
        expect.objectContaining({
          lifecycle_operation_id: lifecycleOperationId,
          container_id: targetContainerId,
          runtime_container_id: targetContainerId,
          runtime_generation: 8,
          worker_status_id: EWorkerStatus.online,
          recreate_completion: {
            operation_id: lifecycleOperationId,
            runtime_generation: 8,
            mode: 'replacement_runtime_already_online',
          },
        })
      );
    });

    it('retries recreate completion against a freshly observed control pointer without discarding the valid runtime', async () => {
      const refreshedControlContainerId = 'b'.repeat(64);
      const targetContainerId = 'c'.repeat(64);
      const lifecycleOperationId = 'operation-control-pointer-refreshed';
      const deps = buildHandler();
      (
        deps.workerService as unknown as {
          viewWorkerForMonitorConsistent: jest.Mock;
        }
      ).viewWorkerForMonitorConsistent.mockResolvedValue({
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: EWorkerType.baileys,
        container_id: refreshedControlContainerId,
        runtime_container_id: targetContainerId,
        runtime_generation: 93,
        lifecycle_operation_id: lifecycleOperationId,
        deleted_at: null,
      });
      deps.workerService.updateWorkerByIdIfLifecycleMatches.mockResolvedValue(
        true
      );

      const committedStatus = await (
        deps.handler as unknown as {
          finalizeRecreateLifecycleAfterCasMiss: (
            accountId: string,
            intendedUpdate: Record<string, unknown>,
            data: Record<string, unknown>,
            workerType: EWorkerType,
            containerId: string,
            runtimeGeneration: number
          ) => Promise<EWorkerStatus | null>;
        }
      ).finalizeRecreateLifecycleAfterCasMiss(
        'account-1',
        {
          worker_id: 'worker-1',
          worker_status_id: EWorkerStatus.disponible,
          worker_type_id: EWorkerType.baileys,
          container_id: targetContainerId,
          lifecycle_operation_id: null,
          number: null,
          connection_date: null,
        },
        {
          action: EWorkerAction.recreate,
          worker_id: 'worker-1',
          account_id: 'account-1',
          server_id: 'server-1',
          worker_type_id: EWorkerType.baileys,
          lifecycle_operation_id: lifecycleOperationId,
        },
        EWorkerType.baileys,
        targetContainerId,
        93
      );

      expect(committedStatus).toBe(EWorkerStatus.disponible);
      expect(
        deps.workerService.updateWorkerByIdIfLifecycleMatches
      ).toHaveBeenCalledWith(
        'account-1',
        expect.objectContaining({
          worker_id: 'worker-1',
          worker_status_id: EWorkerStatus.disponible,
          container_id: targetContainerId,
          lifecycle_operation_id: null,
        }),
        expect.objectContaining({
          lifecycle_operation_id: lifecycleOperationId,
          container_id: refreshedControlContainerId,
          runtime_container_id: targetContainerId,
          runtime_generation: 93,
          worker_status_id: EWorkerStatus.recreating,
          recreate_completion: {
            operation_id: lifecycleOperationId,
            runtime_generation: 93,
            mode: 'replacement_runtime',
          },
        })
      );
      expect(
        deps.workerService.removeContainerWorkerById
      ).not.toHaveBeenCalled();
    });

    it('revalidates through handle immediately before removal and compensates a recovered runtime', async () => {
      const containerId = 'c'.repeat(64);
      const startedAt = '2026-07-29T22:00:00Z';
      const deps = buildHandler({
        runtimeHealthResponse: buildStrictLivenessRuntimeHealth(),
      });
      const currentWorker = {
        worker_id: 'worker-1',
        name: 'Canal 1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: EWorkerType.wwebjs,
        created_at: null,
        updated_at: null,
        deleted_at: null,
        container_id: containerId,
        runtime_container_id: containerId,
        runtime_generation: 7,
        lifecycle_operation_id: 'operation-liveness',
        last_connection_check_at: null,
      };
      emulatePersistedRecreateCompletion(deps, currentWorker);
      deps.workerService.removeContainerIfLivenessFenceMatches.mockResolvedValueOnce(
        {
          status: 'recovered',
          reason: 'runtime_recovered',
          observedRestartCount: 1,
        }
      );
      let livenessInspectionCount = 0;
      deps.workerService.inspectContainerWorkerByIdStrict.mockImplementation(
        async (containerOrWorkerId: string) => {
          if (containerOrWorkerId !== containerId) {
            return buildWorkerContainerInspection({
              container_id: containerId,
              container_started_at: startedAt,
              container_restart_count: 0,
              container_health_status: 'unhealthy',
              container_paused: false,
            });
          }

          livenessInspectionCount += 1;
          return buildWorkerContainerInspection({
            container_id: containerId,
            container_started_at: startedAt,
            container_restart_count: 0,
            container_health_status: 'unhealthy',
            container_paused: false,
            container_labels: {
              'underchat.worker_id': 'worker-1',
              'underchat.account_id': 'account-1',
              'underchat.server_id': 'server-1',
              'underchat.worker_type_id': EWorkerType.wwebjs,
              'underchat.runtime_generation': '7',
            },
          });
        }
      );

      await handleWorkerCommand(deps, {
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        lifecycle_operation_id: 'operation-liveness',
        expected_container_id: containerId,
        expected_container_started_at: startedAt,
        expected_container_restart_count: 0,
        expected_container_health_status: 'unhealthy',
        expected_container_paused: false,
        expected_runtime_generation: 7,
      });

      expect(livenessInspectionCount).toBe(1);
      expect(
        deps.workerService.removeContainerIfLivenessFenceMatches
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          containerId,
          startedAt,
          restartCount: 0,
          healthStatus: 'unhealthy',
          paused: false,
          workerId: 'worker-1',
          accountId: 'account-1',
          serverId: 'server-1',
          workerTypeId: EWorkerType.wwebjs,
          runtimeGeneration: 7,
        })
      );
      expect(
        deps.workerService.updateWorkerByIdIfLifecycleMatches
      ).toHaveBeenCalledWith(
        'account-1',
        {
          worker_id: 'worker-1',
          worker_status_id: EWorkerStatus.online,
          lifecycle_operation_id: null,
        },
        expect.objectContaining({
          lifecycle_operation_id: 'operation-liveness',
          container_id: containerId,
          runtime_container_id: containerId,
          runtime_generation: 7,
          worker_status_id: EWorkerStatus.recreating,
        })
      );
      expect(
        deps.workerService.removeContainerWorkerById
      ).not.toHaveBeenCalled();
      expect(
        deps.workerService.removeContainerByNameAndVolume
      ).not.toHaveBeenCalled();
      expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();
    });

    it('finalizes an exact strict-ready replacement after a crash between runtime upsert and the worker CAS', async () => {
      const oldContainerId = 'a'.repeat(64);
      const replacementContainerId = 'b'.repeat(64);
      const lifecycleOperationId = 'operation-liveness';
      const deps = buildHandler({
        runtimeHealthResponse: buildStrictLivenessRuntimeHealth({
          runtime_generation: 8,
        }),
      });
      const currentWorker = {
        worker_id: 'worker-1',
        name: 'Canal 1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: EWorkerType.wwebjs,
        created_at: null,
        updated_at: '2026-07-29T22:00:00Z',
        deleted_at: null,
        container_id: oldContainerId,
        runtime_container_id: replacementContainerId,
        runtime_generation: 8,
        lifecycle_operation_id: lifecycleOperationId,
        last_connection_check_at: null,
      };
      emulatePersistedRecreateCompletion(deps, currentWorker);
      deps.workerService.inspectContainerWorkerByIdStrict.mockResolvedValue(
        buildWorkerContainerInspection({
          container_id: replacementContainerId,
          container_name: 'worker-1',
          container_started_at: '2026-07-29T22:01:00Z',
          container_restart_count: 0,
          container_health_status: 'healthy',
          container_paused: false,
          container_labels: {
            'underchat.worker_id': 'worker-1',
            'underchat.account_id': 'account-1',
            'underchat.server_id': 'server-1',
            'underchat.worker_type_id': EWorkerType.wwebjs,
            'underchat.runtime_generation': '8',
            'underchat.lifecycle_operation_id': lifecycleOperationId,
          },
        })
      );
      const cooldownKey = `underchat:worker:liveness-recreate:worker-1:${oldContainerId}`;
      deps.redisStore.set(cooldownKey, lifecycleOperationId);

      await handleWorkerCommand(deps, {
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        session_storage: EWorkerSessionStorage.legacy_volume,
        lifecycle_operation_id: lifecycleOperationId,
        expected_container_id: oldContainerId,
        expected_container_started_at: '2026-07-29T22:00:00Z',
        expected_container_restart_count: 0,
        expected_container_health_status: 'unhealthy',
        expected_container_paused: false,
        expected_runtime_generation: 7,
      });

      expect(
        deps.workerService.updateWorkerByIdIfLifecycleMatches
      ).toHaveBeenCalledWith(
        'account-1',
        {
          worker_id: 'worker-1',
          worker_status_id: EWorkerStatus.online,
          lifecycle_operation_id: null,
          container_id: replacementContainerId,
        },
        expect.objectContaining({
          lifecycle_operation_id: lifecycleOperationId,
          container_id: oldContainerId,
          runtime_container_id: replacementContainerId,
          runtime_generation: 8,
          worker_status_id: EWorkerStatus.recreating,
        })
      );
      expect(deps.redisStore.has(cooldownKey)).toBe(false);
      expect(
        deps.workerService.removeContainerIfLivenessFenceMatches
      ).not.toHaveBeenCalled();
      expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();
    });

    it('recovers liveness when provider ONLINE advances the worker pointer before marker and completion', async () => {
      const oldContainerId = '5'.repeat(64);
      const replacementContainerId = '6'.repeat(64);
      const lifecycleOperationId = 'operation-liveness';
      const deps = buildHandler({
        runtimeHealthResponse: buildStrictLivenessRuntimeHealth({
          runtime_generation: 8,
        }),
      });
      const currentWorker = {
        worker_id: 'worker-1',
        name: 'Canal 1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_status_id: EWorkerStatus.online,
        worker_type_id: EWorkerType.wwebjs,
        created_at: null,
        updated_at: null,
        deleted_at: null,
        container_id: replacementContainerId,
        runtime_container_id: replacementContainerId,
        runtime_generation: 8,
        lifecycle_operation_id: lifecycleOperationId,
        last_connection_check_at: null,
      };
      emulatePersistedRecreateCompletion(deps, currentWorker, [false, true]);
      deps.workerService.inspectContainerWorkerByIdStrict.mockResolvedValue(
        buildWorkerContainerInspection({
          container_id: replacementContainerId,
          container_name: 'worker-1',
          container_started_at: '2026-07-29T22:01:00Z',
          container_restart_count: 0,
          container_health_status: 'healthy',
          container_paused: false,
          container_labels: {
            'underchat.worker_id': 'worker-1',
            'underchat.account_id': 'account-1',
            'underchat.server_id': 'server-1',
            'underchat.worker_type_id': EWorkerType.wwebjs,
            'underchat.runtime_generation': '8',
            'underchat.lifecycle_operation_id': lifecycleOperationId,
          },
        })
      );
      const lease = {
        signal: new AbortController().signal,
        assertActive: jest.fn(),
      };

      await expect(
        (
          deps.handler as unknown as {
            reconcileOwnedLivenessReplacement: (
              payload: Record<string, unknown>,
              worker: typeof currentWorker,
              context: typeof lease
            ) => Promise<'not_applicable' | 'recovered' | 'removed'>;
          }
        ).reconcileOwnedLivenessReplacement(
          {
            action: EWorkerAction.recreate,
            worker_id: 'worker-1',
            account_id: 'account-1',
            server_id: 'server-1',
            worker_type_id: EWorkerType.wwebjs,
            lifecycle_operation_id: lifecycleOperationId,
            expected_container_id: oldContainerId,
            expected_runtime_generation: 7,
          },
          currentWorker,
          lease
        )
      ).resolves.toBe('recovered');

      expect(
        deps.workerService.updateWorkerByIdIfLifecycleMatches
      ).toHaveBeenLastCalledWith(
        'account-1',
        expect.objectContaining({
          lifecycle_operation_id: null,
          container_id: replacementContainerId,
        }),
        expect.objectContaining({
          worker_status_id: EWorkerStatus.online,
          lifecycle_operation_id: lifecycleOperationId,
          container_id: replacementContainerId,
          runtime_container_id: replacementContainerId,
          runtime_generation: 8,
          recreate_completion: {
            operation_id: lifecycleOperationId,
            runtime_generation: 8,
            mode: 'replacement_runtime_already_online',
          },
        })
      );
      expect(
        deps.workerRuntimeRepository.markRecreateBootstrapStarted
      ).toHaveBeenCalledWith({
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        lifecycle_operation_id: lifecycleOperationId,
        runtime_generation: 8,
        container_id: replacementContainerId,
      });
      expect(
        deps.workerService.removeContainerIfLivenessFenceMatches
      ).not.toHaveBeenCalled();
      expect(
        deps.workerService.removeContainerWorkerById
      ).not.toHaveBeenCalled();
    });

    it('keeps an ONLINE liveness target intact when its bootstrap marker proof is rejected', async () => {
      const oldContainerId = '5'.repeat(64);
      const replacementContainerId = '6'.repeat(64);
      const lifecycleOperationId = 'operation-liveness';
      const deps = buildHandler({
        runtimeHealthResponse: buildStrictLivenessRuntimeHealth({
          runtime_generation: 8,
        }),
      });
      const currentWorker = {
        worker_id: 'worker-1',
        name: 'Canal 1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_status_id: EWorkerStatus.online,
        worker_type_id: EWorkerType.wwebjs,
        created_at: null,
        updated_at: null,
        deleted_at: null,
        container_id: replacementContainerId,
        runtime_container_id: replacementContainerId,
        runtime_generation: 8,
        lifecycle_operation_id: lifecycleOperationId,
        last_connection_check_at: null,
      };
      (
        deps.workerRuntimeRepository.markRecreateBootstrapStarted as jest.Mock
      ).mockResolvedValueOnce(false);
      deps.workerService.inspectContainerWorkerByIdStrict.mockResolvedValue(
        buildWorkerContainerInspection({
          container_id: replacementContainerId,
          container_name: 'worker-1',
          container_started_at: '2026-07-29T22:01:00Z',
          container_restart_count: 0,
          container_health_status: 'healthy',
          container_paused: false,
          container_labels: {
            'underchat.worker_id': 'worker-1',
            'underchat.account_id': 'account-1',
            'underchat.server_id': 'server-1',
            'underchat.worker_type_id': EWorkerType.wwebjs,
            'underchat.runtime_generation': '8',
            'underchat.lifecycle_operation_id': lifecycleOperationId,
          },
        })
      );
      const lease = {
        signal: new AbortController().signal,
        assertActive: jest.fn(),
      };

      await expect(
        (
          deps.handler as unknown as {
            reconcileOwnedLivenessReplacement: (
              payload: Record<string, unknown>,
              worker: typeof currentWorker,
              context: typeof lease
            ) => Promise<'not_applicable' | 'recovered' | 'removed'>;
          }
        ).reconcileOwnedLivenessReplacement(
          {
            action: EWorkerAction.recreate,
            worker_id: 'worker-1',
            account_id: 'account-1',
            server_id: 'server-1',
            worker_type_id: EWorkerType.wwebjs,
            lifecycle_operation_id: lifecycleOperationId,
            expected_container_id: oldContainerId,
            expected_runtime_generation: 7,
          },
          currentWorker,
          lease
        )
      ).rejects.toThrow('worker_recreate_bootstrap_marker_stale');

      expect(
        deps.workerService.updateWorkerByIdIfLifecycleMatches
      ).not.toHaveBeenCalled();
      expect(
        deps.workerService.removeContainerIfLivenessFenceMatches
      ).not.toHaveBeenCalled();
      expect(
        deps.workerService.removeContainerWorkerById
      ).not.toHaveBeenCalled();
    });

    it('rolls an absent exact ONLINE target back to provisioning and reserves the next generation', async () => {
      const oldContainerId = '7'.repeat(64);
      const replacementContainerId = '8'.repeat(64);
      const lifecycleOperationId = 'operation-liveness';
      const runtimeRepository = buildSelfHealRuntimeRepository(
        8,
        replacementContainerId
      );
      const deps = buildHandler({ workerRuntimeRepository: runtimeRepository });
      const currentWorker = {
        worker_id: 'worker-1',
        name: 'Canal 1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_status_id: EWorkerStatus.online,
        worker_type_id: EWorkerType.wwebjs,
        session_storage: EWorkerSessionStorage.legacy_volume,
        created_at: null,
        updated_at: null,
        deleted_at: null,
        container_id: replacementContainerId,
        runtime_container_id: replacementContainerId,
        runtime_generation: 8,
        lifecycle_operation_id: lifecycleOperationId,
        last_connection_check_at: null,
      };
      const currentState = emulatePersistedRecreateCompletion(
        deps,
        currentWorker
      );
      deps.workerService.inspectContainerWorkerByIdStrict.mockResolvedValue(
        buildWorkerContainerInspection({ exists: false, running: false })
      );
      const payload = {
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        session_storage: EWorkerSessionStorage.legacy_volume,
        lifecycle_operation_id: lifecycleOperationId,
        expected_container_id: oldContainerId,
        expected_container_started_at: '2026-08-08T00:00:00.000Z',
        expected_container_restart_count: 1,
        expected_container_health_status: 'unhealthy',
        expected_container_paused: false,
        expected_runtime_generation: 7,
      };
      const lease = {
        signal: new AbortController().signal,
        assertActive: jest.fn(),
      };

      const context = await (
        deps.handler as unknown as {
          resolveRecreateExecutionContext: (
            data: typeof payload,
            context: typeof lease
          ) => Promise<{
            currentWorker: typeof currentWorker;
            workerType: EWorkerType;
          } | null>;
        }
      ).resolveRecreateExecutionContext(payload, lease);

      expect(context).toEqual(
        expect.objectContaining({
          currentWorker: expect.objectContaining({
            worker_status_id: EWorkerStatus.recreating,
            container_id: oldContainerId,
            runtime_container_id: replacementContainerId,
            runtime_generation: 8,
            lifecycle_operation_id: lifecycleOperationId,
          }),
        })
      );
      expect(
        deps.workerService.updateWorkerByIdIfLifecycleMatches
      ).toHaveBeenCalledWith(
        'account-1',
        {
          worker_id: 'worker-1',
          worker_status_id: EWorkerStatus.recreating,
          container_id: oldContainerId,
        },
        {
          lifecycle_operation_id: lifecycleOperationId,
          container_id: replacementContainerId,
          runtime_container_id: replacementContainerId,
          runtime_generation: 8,
          server_id: 'server-1',
          worker_type_id: EWorkerType.wwebjs,
          worker_status_id: EWorkerStatus.online,
        }
      );
      expect(currentState()).toEqual(
        expect.objectContaining({
          worker_status_id: EWorkerStatus.recreating,
          container_id: oldContainerId,
          runtime_container_id: replacementContainerId,
          runtime_generation: 8,
        })
      );

      const nextGeneration = await (
        deps.handler as unknown as {
          reserveNextWorkerRuntimeGeneration: (
            data: typeof payload,
            sessionVolumeName: string,
            currentRuntimeGeneration: number
          ) => Promise<number>;
        }
      ).reserveNextWorkerRuntimeGeneration(payload, 'worker-1', 8);
      expect(nextGeneration).toBe(9);
      expect(runtimeRepository.reserveNextRuntimeGeneration).toHaveBeenCalled();
      expect(
        deps.workerService.removeContainerIfLivenessFenceMatches
      ).not.toHaveBeenCalled();
    });

    it.each([
      {
        name: 'paused',
        healthStatus: 'healthy',
        paused: true,
      },
      {
        name: 'unhealthy',
        healthStatus: 'unhealthy',
        paused: false,
      },
    ])(
      'rolls back and removes an exact ONLINE $name target before reprovisioning',
      async ({ healthStatus, paused }) => {
        const oldContainerId = '9'.repeat(64);
        const replacementContainerId = 'a'.repeat(64);
        const lifecycleOperationId = 'operation-liveness';
        const runtimeRepository = buildSelfHealRuntimeRepository(
          8,
          replacementContainerId
        );
        const deps = buildHandler({
          workerRuntimeRepository: runtimeRepository,
        });
        const currentWorker = {
          worker_id: 'worker-1',
          name: 'Canal 1',
          account_id: 'account-1',
          server_id: 'server-1',
          worker_status_id: EWorkerStatus.online,
          worker_type_id: EWorkerType.wwebjs,
          session_storage: EWorkerSessionStorage.legacy_volume,
          created_at: null,
          updated_at: null,
          deleted_at: null,
          container_id: replacementContainerId,
          runtime_container_id: replacementContainerId,
          runtime_generation: 8,
          lifecycle_operation_id: lifecycleOperationId,
          last_connection_check_at: null,
        };
        const currentState = emulatePersistedRecreateCompletion(
          deps,
          currentWorker
        );
        deps.workerService.inspectContainerWorkerByIdStrict.mockResolvedValue(
          buildWorkerContainerInspection({
            container_id: replacementContainerId,
            container_name: 'worker-1',
            running: true,
            container_started_at: '2026-08-08T00:00:00.000Z',
            container_restart_count: 2,
            container_health_status: healthStatus,
            container_paused: paused,
            container_labels: {
              'underchat.worker_id': 'worker-1',
              'underchat.account_id': 'account-1',
              'underchat.server_id': 'server-1',
              'underchat.worker_type_id': EWorkerType.wwebjs,
              'underchat.runtime_generation': '8',
              'underchat.lifecycle_operation_id': lifecycleOperationId,
            },
          })
        );
        const lease = {
          signal: new AbortController().signal,
          assertActive: jest.fn(),
        };

        await expect(
          (
            deps.handler as unknown as {
              reconcileOwnedLivenessReplacement: (
                payload: Record<string, unknown>,
                worker: typeof currentWorker,
                context: typeof lease
              ) => Promise<string>;
            }
          ).reconcileOwnedLivenessReplacement(
            {
              action: EWorkerAction.recreate,
              worker_id: 'worker-1',
              account_id: 'account-1',
              server_id: 'server-1',
              worker_type_id: EWorkerType.wwebjs,
              lifecycle_operation_id: lifecycleOperationId,
              expected_container_id: oldContainerId,
              expected_runtime_generation: 7,
            },
            currentWorker,
            lease
          )
        ).resolves.toBe('reprovision');

        expect(currentState()).toEqual(
          expect.objectContaining({
            worker_status_id: EWorkerStatus.recreating,
            container_id: oldContainerId,
            runtime_container_id: replacementContainerId,
            runtime_generation: 8,
          })
        );
        expect(
          deps.workerService.removeContainerIfLivenessFenceMatches
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            containerId: replacementContainerId,
            startedAt: '2026-08-08T00:00:00.000Z',
            restartCount: 2,
            healthStatus,
            paused,
            runtimeGeneration: 8,
            forceRemove: true,
            retiredLifecycleOperationId: lifecycleOperationId,
          })
        );
        expect(
          deps.workerService.removeContainerWorkerById
        ).not.toHaveBeenCalled();
      }
    );

    it('blocks terminal target removal when provider ONLINE re-admits the generation after rollback', async () => {
      const oldContainerId = 'b'.repeat(64);
      const replacementContainerId = 'c'.repeat(64);
      const lifecycleOperationId = 'operation-liveness';
      const deps = buildHandler();
      const onlineWorker = {
        worker_id: 'worker-1',
        name: 'Canal 1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_status_id: EWorkerStatus.online,
        worker_type_id: EWorkerType.wwebjs,
        session_storage: EWorkerSessionStorage.legacy_volume,
        created_at: null,
        updated_at: null,
        deleted_at: null,
        container_id: replacementContainerId,
        runtime_container_id: replacementContainerId,
        runtime_generation: 8,
        lifecycle_operation_id: lifecycleOperationId,
        last_connection_check_at: null,
      };
      const provisioningWorker = {
        ...onlineWorker,
        worker_status_id: EWorkerStatus.recreating,
        container_id: oldContainerId,
      };
      deps.workerService.updateWorkerByIdIfLifecycleMatches.mockResolvedValue(
        true
      );
      deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValueOnce(
        provisioningWorker
      );
      const revokeFailedOnlineLivenessReplacementRuntime =
        deps.workerRuntimeRepository
          .revokeFailedOnlineLivenessReplacementRuntime;
      if (!revokeFailedOnlineLivenessReplacementRuntime) {
        throw new Error(
          'Expected revokeFailedOnlineLivenessReplacementRuntime mock to be available'
        );
      }
      revokeFailedOnlineLivenessReplacementRuntime.mockResolvedValueOnce(false);
      deps.workerService.inspectContainerWorkerByIdStrict.mockResolvedValue(
        buildWorkerContainerInspection({
          container_id: replacementContainerId,
          container_name: 'worker-1',
          running: true,
          container_started_at: '2026-08-08T00:00:00.000Z',
          container_restart_count: 2,
          container_health_status: 'unhealthy',
          container_paused: false,
          container_labels: {
            'underchat.worker_id': 'worker-1',
            'underchat.account_id': 'account-1',
            'underchat.server_id': 'server-1',
            'underchat.worker_type_id': EWorkerType.wwebjs,
            'underchat.runtime_generation': '8',
            'underchat.lifecycle_operation_id': lifecycleOperationId,
          },
        })
      );
      const lease = {
        signal: new AbortController().signal,
        assertActive: jest.fn(),
      };

      await expect(
        (
          deps.handler as unknown as {
            reconcileOwnedLivenessReplacement: (
              payload: Record<string, unknown>,
              worker: typeof onlineWorker,
              context: typeof lease
            ) => Promise<string>;
          }
        ).reconcileOwnedLivenessReplacement(
          {
            action: EWorkerAction.recreate,
            worker_id: 'worker-1',
            account_id: 'account-1',
            server_id: 'server-1',
            worker_type_id: EWorkerType.wwebjs,
            lifecycle_operation_id: lifecycleOperationId,
            expected_container_id: oldContainerId,
            expected_runtime_generation: 7,
          },
          onlineWorker,
          lease
        )
      ).rejects.toThrow(
        'worker_recreate_liveness_fence_retry:replacement:runtime_revoke_cas_conflict'
      );

      expect(
        deps.workerService.removeContainerIfLivenessFenceMatches
      ).not.toHaveBeenCalled();
      expect(
        deps.workerService.removeContainerWorkerById
      ).not.toHaveBeenCalled();
    });

    it('retires an exact stopped legacy replacement without writer identity so redrive can provision a fresh generation', async () => {
      const oldContainerId = 'd'.repeat(64);
      const replacementContainerId = 'e'.repeat(64);
      const lifecycleOperationId = '019ff621-b64d-74ca-8375-2eaab8104372';
      const runtimeRepository = buildSelfHealRuntimeRepository(
        8,
        replacementContainerId,
        {
          runtime_capability_hash: null,
          session_writer_epoch: null,
          source_provider: null,
        }
      );
      const deps = buildHandler({ workerRuntimeRepository: runtimeRepository });
      const currentWorker = {
        worker_id: 'worker-1',
        name: 'Canal 1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: EWorkerType.wwebjs,
        session_storage: EWorkerSessionStorage.legacy_volume,
        created_at: null,
        updated_at: '2026-08-15T00:30:00.000Z',
        deleted_at: null,
        container_id: oldContainerId,
        runtime_container_id: replacementContainerId,
        runtime_generation: 8,
        lifecycle_operation_id: lifecycleOperationId,
        last_connection_check_at: null,
      };
      deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValue(
        currentWorker
      );
      deps.workerService.inspectContainerWorkerByIdStrict.mockResolvedValue(
        buildWorkerContainerInspection({
          container_id: replacementContainerId,
          container_name: 'worker-1',
          container_state: 'exited',
          container_status: 'exited',
          running: false,
          container_started_at: '2026-08-12T19:00:00.000Z',
          container_finished_at: '2026-08-15T00:30:00.000Z',
          container_restart_count: 0,
          container_health_status: 'unhealthy',
          container_paused: false,
          container_labels: {
            'underchat.worker_id': 'worker-1',
            'underchat.account_id': 'account-1',
            'underchat.server_id': 'server-1',
            'underchat.worker_type_id': EWorkerType.wwebjs,
            'underchat.runtime_generation': '8',
            'underchat.lifecycle_operation_id': lifecycleOperationId,
          },
        })
      );
      const lease = {
        signal: new AbortController().signal,
        assertActive: jest.fn(),
      };

      await expect(
        (
          deps.handler as unknown as {
            reconcileOwnedLivenessReplacement: (
              payload: Record<string, unknown>,
              worker: typeof currentWorker,
              context: typeof lease
            ) => Promise<string>;
          }
        ).reconcileOwnedLivenessReplacement(
          {
            action: EWorkerAction.recreate,
            worker_id: 'worker-1',
            account_id: 'account-1',
            server_id: 'server-1',
            worker_type_id: EWorkerType.wwebjs,
            session_storage: EWorkerSessionStorage.legacy_volume,
            lifecycle_operation_id: lifecycleOperationId,
            expected_container_id: oldContainerId,
            expected_runtime_generation: 7,
          },
          currentWorker,
          lease
        )
      ).resolves.toBe('removed');

      expect(
        deps.workerService.inspectRuntimeWriterIdentityByContainerIdStrict
      ).not.toHaveBeenCalled();
      expect(
        deps.workerService.startContainerWorkerById
      ).not.toHaveBeenCalled();
      expect(
        runtimeRepository.revokeFailedOnlineLivenessReplacementRuntime
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          lifecycle_operation_id: lifecycleOperationId,
          failed_container_id: replacementContainerId,
          failed_runtime_generation: 8,
        })
      );
      expect(
        deps.workerService.removeContainerIfLivenessFenceMatches
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          containerId: replacementContainerId,
          forceRemove: true,
          retiredLifecycleOperationId: lifecycleOperationId,
          sessionStorage: EWorkerSessionStorage.legacy_volume,
        })
      );
    });

    it('retires a revoked target irreversibly after a transient host removal failure even when Docker becomes healthy', async () => {
      const oldContainerId = 'd'.repeat(64);
      const replacementContainerId = 'e'.repeat(64);
      const lifecycleOperationId = 'operation-liveness';
      const runtime: Record<string, unknown> = {
        worker_id: 'worker-1',
        container_id: replacementContainerId,
        container_name: 'worker-1',
        session_storage: EWorkerSessionStorage.legacy_volume,
        session_volume_name: 'worker-1',
        runtime_generation: 8,
        runtime_capability_hash: 'f'.repeat(64),
        session_writer_epoch: '00000000-0000-4000-8000-000000000001',
        connection_epoch: '00000000-0000-4000-8000-000000000002',
        source_provider: 'wwebjs',
        connection_activated_at: '2026-08-08T00:00:00.000Z',
        recreate_bootstrap_operation_id: null,
        recreate_bootstrap_runtime_generation: null,
        recreate_bootstrap_container_id: null,
        recreate_bootstrap_started_at: null,
        recreate_retired_operation_id: null,
        recreate_retired_runtime_generation: null,
        recreate_retired_container_id: null,
        recreate_retired_at: null,
      };
      const runtimeRepository = buildSelfHealRuntimeRepository(
        8,
        replacementContainerId
      );
      runtimeRepository.viewByWorkerId.mockImplementation(async () => ({
        ...runtime,
      }));
      runtimeRepository.viewByWorkerIdConsistent.mockImplementation(
        async () => ({ ...runtime })
      );
      (
        runtimeRepository.markRecreateBootstrapStarted as jest.Mock
      ).mockImplementation(async (input: Record<string, unknown>) => {
        Object.assign(runtime, {
          recreate_bootstrap_operation_id: input.lifecycle_operation_id,
          recreate_bootstrap_runtime_generation: input.runtime_generation,
          recreate_bootstrap_container_id: input.container_id,
          recreate_bootstrap_started_at: '2026-08-08T00:00:00.000Z',
        });
        return true;
      });
      runtimeRepository.revokeFailedOnlineLivenessReplacementRuntime.mockImplementation(
        async (input: Record<string, unknown>) => {
          Object.assign(runtime, {
            runtime_capability_hash: null,
            session_writer_epoch: null,
            connection_epoch: null,
            connection_sequence: 0,
            source_provider: null,
            connection_activated_at: null,
            recreate_bootstrap_operation_id: null,
            recreate_bootstrap_runtime_generation: null,
            recreate_bootstrap_container_id: null,
            recreate_bootstrap_started_at: null,
            recreate_retired_operation_id: input.lifecycle_operation_id,
            recreate_retired_runtime_generation:
              input.failed_runtime_generation,
            recreate_retired_container_id: input.failed_container_id,
            recreate_retired_at: '2026-08-08T00:00:01.000Z',
          });
          return true;
        }
      );
      const deps = buildHandler({
        workerRuntimeRepository: runtimeRepository,
        runtimeHealthResponse: buildStrictLivenessRuntimeHealth({
          runtime_generation: 8,
          can_send: true,
          kafka_consumers_ready: true,
        }),
      });
      const currentWorker = {
        worker_id: 'worker-1',
        name: 'Canal 1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: EWorkerType.wwebjs,
        session_storage: EWorkerSessionStorage.legacy_volume,
        created_at: null,
        updated_at: null,
        deleted_at: null,
        container_id: oldContainerId,
        runtime_container_id: replacementContainerId,
        runtime_generation: 8,
        lifecycle_operation_id: lifecycleOperationId,
        last_connection_check_at: null,
      };
      const currentState = emulatePersistedRecreateCompletion(
        deps,
        currentWorker
      );
      const terminalInspection = buildWorkerContainerInspection({
        container_id: replacementContainerId,
        container_name: 'worker-1',
        running: true,
        container_started_at: '2026-08-08T00:00:00.000Z',
        container_restart_count: 2,
        container_health_status: 'unhealthy',
        container_paused: false,
        container_labels: {
          'underchat.worker_id': 'worker-1',
          'underchat.account_id': 'account-1',
          'underchat.server_id': 'server-1',
          'underchat.worker_type_id': EWorkerType.wwebjs,
          'underchat.runtime_generation': '8',
          'underchat.lifecycle_operation_id': lifecycleOperationId,
        },
      });
      deps.workerService.inspectContainerWorkerByIdStrict
        .mockResolvedValueOnce(terminalInspection)
        .mockResolvedValue({
          ...terminalInspection,
          container_health_status: 'healthy',
        });
      deps.workerService.removeContainerIfLivenessFenceMatches
        .mockResolvedValueOnce({
          status: 'pending',
          reason: 'transient_host_failure',
        })
        .mockResolvedValueOnce({
          status: 'removed',
          reason: 'fence_matched',
        });
      const payload = {
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        lifecycle_operation_id: lifecycleOperationId,
        expected_container_id: oldContainerId,
        expected_runtime_generation: 7,
      };
      const lease = {
        signal: new AbortController().signal,
        assertActive: jest.fn(),
      };
      const reconcile = (worker: typeof currentWorker): Promise<string> =>
        (
          deps.handler as unknown as {
            reconcileOwnedLivenessReplacement: (
              data: typeof payload,
              current: typeof currentWorker,
              context: typeof lease
            ) => Promise<string>;
          }
        ).reconcileOwnedLivenessReplacement(payload, worker, lease);

      await expect(reconcile(currentWorker)).rejects.toThrow(
        'worker_recreate_liveness_fence_retry:replacement:remove_pending:transient_host_failure'
      );
      await expect(
        reconcile(currentState() as typeof currentWorker)
      ).resolves.toBe('removed');

      expect(
        runtimeRepository.revokeFailedOnlineLivenessReplacementRuntime
      ).toHaveBeenCalledTimes(2);
      expect(
        runtimeRepository.markRecreateBootstrapStarted
      ).toHaveBeenCalledTimes(1);
      expect(runtime).toEqual(
        expect.objectContaining({
          recreate_bootstrap_operation_id: null,
          recreate_bootstrap_runtime_generation: null,
          recreate_bootstrap_container_id: null,
          recreate_bootstrap_started_at: null,
        })
      );
      expect(
        deps.workerService.removeContainerIfLivenessFenceMatches
      ).toHaveBeenCalledTimes(2);
      for (const [removalFence] of deps.workerService
        .removeContainerIfLivenessFenceMatches.mock.calls) {
        expect(removalFence).toEqual(
          expect.objectContaining({
            forceRemove: true,
            retiredLifecycleOperationId: lifecycleOperationId,
          })
        );
      }
      expect(
        deps.workerService.startContainerWorkerById
      ).not.toHaveBeenCalled();
      expect(
        deps.workerService.updateWorkerByIdIfLifecycleMatches
      ).not.toHaveBeenCalled();
    });

    it('retries the same durable runtime-retired event on both channels before any host removal', async () => {
      const oldContainerId = 'a'.repeat(64);
      const replacementContainerId = 'b'.repeat(64);
      const lifecycleOperationId = '00000000-0000-4000-8000-000000000004';
      const runtimeRepository = buildSelfHealRuntimeRepository(
        8,
        replacementContainerId
      );
      const deps = buildHandler({ workerRuntimeRepository: runtimeRepository });
      const currentWorker = {
        worker_id: 'worker-1',
        name: 'Canal 1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: EWorkerType.wwebjs,
        session_storage: EWorkerSessionStorage.legacy_volume,
        created_at: null,
        updated_at: null,
        deleted_at: null,
        container_id: oldContainerId,
        runtime_container_id: replacementContainerId,
        runtime_generation: 8,
        lifecycle_operation_id: lifecycleOperationId,
        last_connection_check_at: null,
      };
      deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValue(
        currentWorker
      );
      deps.centrifugoService.publishSubStrict.mockRejectedValueOnce(
        new Error('centrifugo unavailable')
      );
      const payload = {
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        lifecycle_operation_id: lifecycleOperationId,
        expected_container_id: oldContainerId,
        expected_runtime_generation: 7,
      };
      const lease = {
        signal: new AbortController().signal,
        assertActive: jest.fn(),
      };
      const revokeAndPublish = () =>
        (
          deps.handler as unknown as {
            revokeFailedOnlineLivenessReplacementRuntime(
              data: typeof payload,
              worker: typeof currentWorker,
              containerId: string,
              runtimeGeneration: number,
              context: typeof lease
            ): Promise<void>;
          }
        ).revokeFailedOnlineLivenessReplacementRuntime(
          payload,
          currentWorker,
          replacementContainerId,
          8,
          lease
        );

      await expect(revokeAndPublish()).rejects.toThrow(
        'centrifugo unavailable'
      );
      expect(
        deps.workerService.removeContainerIfLivenessFenceMatches
      ).not.toHaveBeenCalled();

      await expect(revokeAndPublish()).resolves.toBeUndefined();

      expect(
        runtimeRepository.revokeFailedOnlineLivenessReplacementRuntime
      ).toHaveBeenCalledTimes(2);
      const retiredEvents = (
        deps.centrifugoService.publishSubStrict.mock.calls as unknown as Array<
          [string, Record<string, unknown>]
        >
      ).map(([, event]) => event);
      expect(retiredEvents).toHaveLength(2);
      for (const event of retiredEvents) {
        expect(event).toEqual(
          expect.objectContaining({
            lifecycle_phase: 'runtime_retired',
            recreate_phase: 'recreating',
            lifecycle_operation_id: lifecycleOperationId,
            runtime_generation: 8,
            recreate_phase_observed_at: '2026-08-08T00:00:01.000Z',
          })
        );
        expect(event).not.toHaveProperty('container_id');
      }
      expect(retiredEvents[1]).toEqual(retiredEvents[0]);
      expect(deps.centrifugoService.publishStrict).toHaveBeenCalledTimes(2);
    });

    it('preserves a newer liveness cooldown owner during old-operation recovery', async () => {
      const containerId = 'c'.repeat(64);
      const key = `underchat:worker:liveness-recreate:worker-1:${containerId}`;
      const deps = buildHandler();
      deps.redisStore.set(key, 'new-operation-owner');

      await (
        deps.handler as unknown as {
          releaseRecoveredLivenessCooldown: (
            workerId: string,
            exactContainerId: string,
            operationId: string
          ) => Promise<void>;
        }
      ).releaseRecoveredLivenessCooldown(
        'worker-1',
        containerId,
        'old-operation-owner'
      );

      expect(deps.redisStore.get(key)).toBe('new-operation-owner');
    });

    it('preserves the owned Docker-healthy replacement while its provider is not ready', async () => {
      const oldContainerId = 'd'.repeat(64);
      const replacementContainerId = 'e'.repeat(64);
      const lifecycleOperationId = 'operation-liveness';
      const deps = buildHandler({
        runtimeHealthResponse: buildStrictLivenessRuntimeHealth({
          runtime_generation: 8,
          can_send: false,
          kafka_consumers_ready: false,
        }),
      });
      const currentWorker = {
        worker_id: 'worker-1',
        name: 'Canal 1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_status_id: EWorkerStatus.online,
        worker_type_id: EWorkerType.wwebjs,
        created_at: null,
        updated_at: '2026-07-29T22:00:00Z',
        deleted_at: null,
        container_id: replacementContainerId,
        runtime_container_id: replacementContainerId,
        runtime_generation: 8,
        lifecycle_operation_id: lifecycleOperationId,
        last_connection_check_at: null,
      };
      deps.workerService.inspectContainerWorkerByIdStrict.mockResolvedValue(
        buildWorkerContainerInspection({
          container_id: replacementContainerId,
          container_name: 'worker-1',
          container_started_at: '2026-07-29T22:00:00Z',
          container_restart_count: 0,
          container_health_status: 'healthy',
          container_paused: false,
          container_labels: {
            'underchat.worker_id': 'worker-1',
            'underchat.account_id': 'account-1',
            'underchat.server_id': 'server-1',
            'underchat.worker_type_id': EWorkerType.wwebjs,
            'underchat.runtime_generation': '8',
            'underchat.lifecycle_operation_id': lifecycleOperationId,
          },
        })
      );
      const lease = {
        signal: new AbortController().signal,
        assertActive: jest.fn(),
      };

      await expect(
        (
          deps.handler as unknown as {
            reconcileOwnedLivenessReplacement: (
              payload: Record<string, unknown>,
              worker: typeof currentWorker,
              context: typeof lease
            ) => Promise<'not_applicable' | 'recovered' | 'removed'>;
          }
        ).reconcileOwnedLivenessReplacement(
          {
            action: EWorkerAction.recreate,
            worker_id: 'worker-1',
            account_id: 'account-1',
            server_id: 'server-1',
            worker_type_id: EWorkerType.wwebjs,
            lifecycle_operation_id: lifecycleOperationId,
            expected_container_id: oldContainerId,
            expected_runtime_generation: 7,
          },
          currentWorker,
          lease
        )
      ).rejects.toThrow(
        'worker_recreate_liveness_fence_retry:replacement:provider_not_ready'
      );

      expect(
        deps.workerService.removeContainerIfLivenessFenceMatches
      ).not.toHaveBeenCalled();
      expect(
        deps.workerService.updateWorkerByIdIfLifecycleMatches
      ).not.toHaveBeenCalled();
    });

    it('preserves an owned replacement while its provider is still inside the bounded startup window', async () => {
      const oldContainerId = '1'.repeat(64);
      const replacementContainerId = '2'.repeat(64);
      const lifecycleOperationId = 'operation-liveness';
      const deps = buildHandler({
        runtimeHealthResponse: buildStrictLivenessRuntimeHealth({
          runtime_generation: 8,
          can_send: false,
        }),
      });
      const currentWorker = {
        worker_id: 'worker-1',
        name: 'Canal 1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: EWorkerType.wwebjs,
        created_at: null,
        updated_at: new Date().toISOString(),
        deleted_at: null,
        container_id: oldContainerId,
        runtime_container_id: replacementContainerId,
        runtime_generation: 8,
        lifecycle_operation_id: lifecycleOperationId,
        last_connection_check_at: null,
      };
      deps.workerService.inspectContainerWorkerByIdStrict.mockResolvedValue(
        buildWorkerContainerInspection({
          container_id: replacementContainerId,
          container_name: 'worker-1',
          container_started_at: new Date().toISOString(),
          container_restart_count: 0,
          container_health_status: 'starting',
          container_paused: false,
          container_labels: {
            'underchat.worker_id': 'worker-1',
            'underchat.account_id': 'account-1',
            'underchat.server_id': 'server-1',
            'underchat.worker_type_id': EWorkerType.wwebjs,
            'underchat.runtime_generation': '8',
            'underchat.lifecycle_operation_id': lifecycleOperationId,
          },
        })
      );
      const lease = {
        signal: new AbortController().signal,
        assertActive: jest.fn(),
      };

      await expect(
        (
          deps.handler as unknown as {
            reconcileOwnedLivenessReplacement: (
              payload: Record<string, unknown>,
              worker: typeof currentWorker,
              context: typeof lease
            ) => Promise<'not_applicable' | 'recovered' | 'removed'>;
          }
        ).reconcileOwnedLivenessReplacement(
          {
            action: EWorkerAction.recreate,
            worker_id: 'worker-1',
            account_id: 'account-1',
            server_id: 'server-1',
            worker_type_id: EWorkerType.wwebjs,
            lifecycle_operation_id: lifecycleOperationId,
            expected_container_id: oldContainerId,
            expected_runtime_generation: 7,
          },
          currentWorker,
          lease
        )
      ).rejects.toThrow(
        'worker_recreate_liveness_fence_retry:replacement:provider_not_ready'
      );

      expect(
        deps.workerService.removeContainerIfLivenessFenceMatches
      ).not.toHaveBeenCalled();
      expect(
        deps.workerService.updateWorkerByIdIfLifecycleMatches
      ).not.toHaveBeenCalled();
    });

    it('fails closed on a replacement lifecycle-label mismatch without deleting either container', async () => {
      const oldContainerId = '3'.repeat(64);
      const replacementContainerId = '4'.repeat(64);
      const deps = buildHandler();
      const currentWorker = {
        worker_id: 'worker-1',
        name: 'Canal 1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: EWorkerType.wwebjs,
        created_at: null,
        updated_at: null,
        deleted_at: null,
        container_id: oldContainerId,
        runtime_container_id: replacementContainerId,
        runtime_generation: 8,
        lifecycle_operation_id: 'operation-liveness',
        last_connection_check_at: null,
      };
      deps.workerService.inspectContainerWorkerByIdStrict.mockResolvedValue(
        buildWorkerContainerInspection({
          container_id: replacementContainerId,
          container_name: 'worker-1',
          container_started_at: '2026-07-29T22:00:00Z',
          container_restart_count: 0,
          container_health_status: 'healthy',
          container_paused: false,
          container_labels: {
            'underchat.worker_id': 'worker-1',
            'underchat.account_id': 'account-1',
            'underchat.server_id': 'server-1',
            'underchat.worker_type_id': EWorkerType.wwebjs,
            'underchat.runtime_generation': '8',
            'underchat.lifecycle_operation_id': 'different-operation',
          },
        })
      );
      const lease = {
        signal: new AbortController().signal,
        assertActive: jest.fn(),
      };

      await expect(
        (
          deps.handler as unknown as {
            reconcileOwnedLivenessReplacement: (
              payload: Record<string, unknown>,
              worker: typeof currentWorker,
              context: typeof lease
            ) => Promise<'not_applicable' | 'recovered' | 'removed'>;
          }
        ).reconcileOwnedLivenessReplacement(
          {
            action: EWorkerAction.recreate,
            worker_id: 'worker-1',
            account_id: 'account-1',
            server_id: 'server-1',
            worker_type_id: EWorkerType.wwebjs,
            lifecycle_operation_id: 'operation-liveness',
            expected_container_id: oldContainerId,
            expected_runtime_generation: 7,
          },
          currentWorker,
          lease
        )
      ).rejects.toThrow(
        'worker_recreate_liveness_fence_retry:replacement:identity_changed'
      );

      expect(
        deps.workerService.removeContainerIfLivenessFenceMatches
      ).not.toHaveBeenCalled();
      expect(
        deps.workerService.updateWorkerByIdIfLifecycleMatches
      ).not.toHaveBeenCalled();
    });

    it('retries instead of ACKing when strict recovery compensation loses CAS but still owns the same fence', async () => {
      const containerId = '5'.repeat(64);
      const deps = buildHandler({
        runtimeHealthResponse: buildStrictLivenessRuntimeHealth(),
      });
      const currentWorker = {
        worker_id: 'worker-1',
        name: 'Canal 1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: EWorkerType.wwebjs,
        created_at: null,
        updated_at: null,
        deleted_at: null,
        container_id: containerId,
        runtime_container_id: containerId,
        runtime_generation: 7,
        lifecycle_operation_id: 'operation-liveness',
        last_connection_check_at: null,
      };
      (
        deps.workerService as unknown as {
          viewWorkerForMonitorConsistent: jest.Mock;
        }
      ).viewWorkerForMonitorConsistent.mockResolvedValue(currentWorker);
      deps.workerService.updateWorkerByIdIfLifecycleMatches.mockResolvedValue(
        false
      );
      const data = {
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        lifecycle_operation_id: 'operation-liveness',
        expected_container_id: containerId,
        expected_runtime_generation: 7,
      };
      const lease = {
        signal: new AbortController().signal,
        assertActive: jest.fn(),
      };

      await expect(
        (
          deps.handler as unknown as {
            compensateRecoveredLivenessRecreate: (
              payload: typeof data,
              worker: typeof currentWorker,
              reason: string,
              context: typeof lease
            ) => Promise<'not_ready' | 'restored' | 'superseded'>;
          }
        ).compensateRecoveredLivenessRecreate(
          data,
          currentWorker,
          'test',
          lease
        )
      ).rejects.toThrow(
        'worker_recreate_liveness_fence_retry:recovery:compensation_cas_conflict'
      );

      expect(deps.centrifugoService.publishSub).not.toHaveBeenCalled();
    });

    it('clears an online liveness fence only after strict readiness proves the same runtime', async () => {
      const containerId = '7'.repeat(64);
      const lifecycleOperationId = '33333333-3333-7333-8333-333333333333';
      const deps = buildHandler({
        runtimeHealthResponse: buildStrictLivenessRuntimeHealth(),
      });
      const currentWorker = {
        worker_id: 'worker-1',
        name: 'Canal 1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_status_id: EWorkerStatus.online,
        worker_type_id: EWorkerType.wwebjs,
        created_at: null,
        updated_at: null,
        deleted_at: null,
        container_id: containerId,
        runtime_container_id: containerId,
        runtime_generation: 7,
        lifecycle_operation_id: lifecycleOperationId,
        last_connection_check_at: null,
      };
      emulatePersistedRecreateCompletion(deps, currentWorker, [false, true]);
      const lease = {
        signal: new AbortController().signal,
        assertActive: jest.fn(),
      };

      await expect(
        (
          deps.handler as unknown as {
            compensateRecoveredLivenessRecreate: (
              payload: Record<string, unknown>,
              worker: typeof currentWorker,
              reason: string,
              context: typeof lease
            ) => Promise<'not_ready' | 'restored' | 'superseded'>;
          }
        ).compensateRecoveredLivenessRecreate(
          {
            action: EWorkerAction.recreate,
            worker_id: 'worker-1',
            account_id: 'account-1',
            server_id: 'server-1',
            worker_type_id: EWorkerType.wwebjs,
            lifecycle_operation_id: lifecycleOperationId,
            expected_container_id: containerId,
            expected_runtime_generation: 7,
          },
          currentWorker,
          'online_same_fence',
          lease
        )
      ).resolves.toBe('restored');

      expect(
        deps.workerService.updateWorkerByIdIfLifecycleMatches
      ).toHaveBeenNthCalledWith(
        2,
        'account-1',
        {
          worker_id: 'worker-1',
          lifecycle_operation_id: null,
        },
        expect.objectContaining({
          lifecycle_operation_id: lifecycleOperationId,
          worker_status_id: EWorkerStatus.online,
          container_id: containerId,
          runtime_container_id: containerId,
          runtime_generation: 7,
        })
      );
      expect(deps.centrifugoService.publishSubStrict).toHaveBeenCalledWith(
        'worker:account#account-1',
        expect.objectContaining({
          event_type: 'status',
          lifecycle_source: 'manager',
          lifecycle_action: EWorkerAction.recreate,
          lifecycle_phase: 'completed',
          lifecycle_operation_id: lifecycleOperationId,
          worker_status_id: EWorkerStatus.online,
          runtime_generation: 7,
          reason: 'liveness_runtime_recovered_before_recreate',
        })
      );
      const completionPublication =
        deps.centrifugoService.publishSubStrict.mock.calls.find(
          ([channel, payload]) =>
            channel === 'worker:account#account-1' &&
            (payload as IBaileysConnectionState | undefined)
              ?.lifecycle_phase === 'completed'
        )?.[1];
      expect(completionPublication).not.toHaveProperty('connection_status');
      expect(completionPublication).not.toHaveProperty(
        'connection_status_order'
      );
      expect(completionPublication).not.toHaveProperty('container_id');
    });

    it('retries a recovered liveness terminal publication and replays it from the durable tombstone', async () => {
      const containerId = '8'.repeat(64);
      const lifecycleOperationId = '44444444-4444-7444-8444-444444444444';
      const deps = buildHandler({
        runtimeHealthResponse: buildStrictLivenessRuntimeHealth(),
      });
      const currentWorker = {
        worker_id: 'worker-1',
        name: 'Canal 1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: EWorkerType.wwebjs,
        created_at: null,
        updated_at: null,
        deleted_at: null,
        container_id: containerId,
        runtime_container_id: containerId,
        runtime_generation: 7,
        lifecycle_operation_id: lifecycleOperationId,
        last_connection_check_at: null,
      };
      const readPersistedWorker = emulatePersistedRecreateCompletion(
        deps,
        currentWorker
      );
      deps.centrifugoService.publishSubStrict.mockRejectedValueOnce(
        new Error('centrifugo account queue unavailable')
      );
      const data = {
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        lifecycle_operation_id: lifecycleOperationId,
        expected_container_id: containerId,
        expected_runtime_generation: 7,
      };
      const lease = {
        signal: new AbortController().signal,
        assertActive: jest.fn(),
      };

      await expect(
        (
          deps.handler as unknown as {
            compensateRecoveredLivenessRecreate: (
              payload: typeof data,
              worker: typeof currentWorker,
              reason: string,
              context: typeof lease
            ) => Promise<'not_ready' | 'restored' | 'superseded'>;
          }
        ).compensateRecoveredLivenessRecreate(
          data,
          currentWorker,
          'runtime_recovered',
          lease
        )
      ).rejects.toThrow(
        'worker_recreate_liveness_fence_retry:recovery:terminal_publish_failed'
      );

      expect(readPersistedWorker()).toEqual(
        expect.objectContaining({
          worker_status_id: EWorkerStatus.online,
          lifecycle_operation_id: null,
          recreate_completed_operation_id: lifecycleOperationId,
          recreate_completed_runtime_generation: 7,
          recreate_completed_at: '2026-08-08T00:00:00.000Z',
        })
      );
      expect(
        deps.workerService.updateWorkerByIdIfLifecycleMatches
      ).toHaveBeenCalledTimes(1);

      deps.centrifugoService.publishSubStrict.mockClear();
      (deps.centrifugoService.publishStrict as jest.Mock).mockClear();
      await expect(
        (
          deps.handler as unknown as {
            beginRecreateWorker: (
              payload: typeof data,
              context: typeof lease
            ) => Promise<boolean>;
          }
        ).beginRecreateWorker(data, lease)
      ).resolves.toBe(false);

      expect(
        deps.workerService.updateWorkerByIdIfLifecycleMatches
      ).toHaveBeenCalledTimes(1);
      const accountTerminal =
        deps.centrifugoService.publishSubStrict.mock.calls[0]?.[1];
      const globalTerminal = (deps.centrifugoService.publishStrict as jest.Mock)
        .mock.calls[0]?.[1];
      expect(accountTerminal).toEqual(globalTerminal);
      expect(accountTerminal).toEqual(
        expect.objectContaining({
          lifecycle_phase: 'completed',
          lifecycle_operation_id: lifecycleOperationId,
          recreate_completed_operation_id: lifecycleOperationId,
          recreate_completed_runtime_generation: 7,
          recreate_completed_at: '2026-08-08T00:00:00.000Z',
        })
      );
      expect(accountTerminal).not.toHaveProperty('container_id');
    });

    it('treats a failed recovery CAS as superseded only after a primary reread proves a newer operation', async () => {
      const containerId = '6'.repeat(64);
      const deps = buildHandler({
        runtimeHealthResponse: buildStrictLivenessRuntimeHealth(),
      });
      const currentWorker = {
        worker_id: 'worker-1',
        name: 'Canal 1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: EWorkerType.wwebjs,
        created_at: null,
        updated_at: null,
        deleted_at: null,
        container_id: containerId,
        runtime_container_id: containerId,
        runtime_generation: 7,
        lifecycle_operation_id: 'operation-liveness',
        last_connection_check_at: null,
      };
      (
        deps.workerService as unknown as {
          viewWorkerForMonitorConsistent: jest.Mock;
        }
      ).viewWorkerForMonitorConsistent.mockResolvedValue({
        ...currentWorker,
        lifecycle_operation_id: 'operation-newer',
      });
      deps.workerService.updateWorkerByIdIfLifecycleMatches.mockResolvedValue(
        false
      );
      const data = {
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        lifecycle_operation_id: 'operation-liveness',
        expected_container_id: containerId,
        expected_runtime_generation: 7,
      };
      const lease = {
        signal: new AbortController().signal,
        assertActive: jest.fn(),
      };

      await expect(
        (
          deps.handler as unknown as {
            compensateRecoveredLivenessRecreate: (
              payload: typeof data,
              worker: typeof currentWorker,
              reason: string,
              context: typeof lease
            ) => Promise<'not_ready' | 'restored' | 'superseded'>;
          }
        ).compensateRecoveredLivenessRecreate(
          data,
          currentWorker,
          'test',
          lease
        )
      ).resolves.toBe('superseded');

      expect(deps.centrifugoService.publishSub).not.toHaveBeenCalled();
    });

    it('defers a Docker-health recovery to strict provider readiness', async () => {
      const containerId = 'a'.repeat(64);
      const deps = buildHandler();
      deps.workerService.inspectContainerWorkerByIdStrict.mockResolvedValueOnce(
        buildWorkerContainerInspection({
          container_id: containerId,
          container_started_at: '2026-07-29T22:01:00Z',
          container_restart_count: 1,
          container_health_status: 'healthy',
          container_paused: false,
          container_labels: {
            'underchat.worker_id': 'worker-1',
            'underchat.account_id': 'account-1',
            'underchat.server_id': 'server-1',
            'underchat.worker_type_id': EWorkerType.wwebjs,
            'underchat.runtime_generation': '7',
          },
        })
      );
      const currentWorker = {
        worker_id: 'worker-1',
        name: 'Canal 1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: EWorkerType.wwebjs,
        created_at: null,
        updated_at: null,
        deleted_at: null,
        container_id: containerId,
        runtime_container_id: containerId,
        runtime_generation: 7,
        lifecycle_operation_id: 'operation-liveness',
        last_connection_check_at: null,
      };
      const data = {
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        lifecycle_operation_id: 'operation-liveness',
        expected_container_id: containerId,
        expected_container_started_at: '2026-07-29T22:00:00Z',
        expected_container_restart_count: 0,
        expected_container_health_status: 'unhealthy',
        expected_container_paused: false,
        expected_runtime_generation: 7,
      };
      const lease = {
        signal: new AbortController().signal,
        assertActive: jest.fn(),
      };

      await expect(
        (
          deps.handler as unknown as {
            revalidateLivenessRecreateFence: (
              payload: typeof data,
              worker: typeof currentWorker,
              context: typeof lease
            ) => Promise<'proceed' | 'recovered' | 'pending' | 'stale'>;
          }
        ).revalidateLivenessRecreateFence(data, currentWorker, lease)
      ).resolves.toBe('proceed');

      expect(
        deps.workerService.updateWorkerByIdIfLifecycleMatches
      ).not.toHaveBeenCalled();
      expect(
        deps.workerService.removeContainerWorkerById
      ).not.toHaveBeenCalled();
      expect(
        deps.workerService.removeContainerByNameAndVolume
      ).not.toHaveBeenCalled();
    });

    it('routes a starting runtime into bounded conditional polling without compensating it online', async () => {
      const containerId = 'd'.repeat(64);
      const deps = buildHandler();
      deps.workerService.inspectContainerWorkerByIdStrict.mockResolvedValueOnce(
        buildWorkerContainerInspection({
          container_id: containerId,
          container_started_at: '2026-07-29T22:01:00Z',
          container_restart_count: 1,
          container_health_status: 'starting',
          container_paused: false,
          container_labels: {
            'underchat.worker_id': 'worker-1',
            'underchat.account_id': 'account-1',
            'underchat.server_id': 'server-1',
            'underchat.worker_type_id': EWorkerType.wwebjs,
            'underchat.runtime_generation': '7',
          },
        })
      );
      const currentWorker = {
        worker_id: 'worker-1',
        name: 'Canal 1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: EWorkerType.wwebjs,
        created_at: null,
        updated_at: null,
        deleted_at: null,
        container_id: containerId,
        runtime_container_id: containerId,
        runtime_generation: 7,
        lifecycle_operation_id: 'operation-liveness',
        last_connection_check_at: null,
      };
      const data = {
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        lifecycle_operation_id: 'operation-liveness',
        expected_container_id: containerId,
        expected_container_started_at: '2026-07-29T22:00:00Z',
        expected_container_restart_count: 0,
        expected_container_health_status: 'unhealthy',
        expected_container_paused: false,
        expected_runtime_generation: 7,
      };
      const lease = {
        signal: new AbortController().signal,
        assertActive: jest.fn(),
      };

      await expect(
        (
          deps.handler as unknown as {
            revalidateLivenessRecreateFence: (
              payload: typeof data,
              worker: typeof currentWorker,
              context: typeof lease
            ) => Promise<'proceed' | 'recovered' | 'stale'>;
          }
        ).revalidateLivenessRecreateFence(data, currentWorker, lease)
      ).resolves.toBe('proceed');

      expect(
        deps.workerService.updateWorkerByIdIfLifecycleMatches
      ).not.toHaveBeenCalled();
    });

    it.each([
      {
        nextStatus: 'recovered' as const,
        nextReason: 'runtime_recovered',
        observedRestartCount: 1,
      },
      {
        nextStatus: 'removed' as const,
        nextReason: 'fence_matched',
        observedRestartCount: undefined,
      },
    ])(
      'resolves starting to $nextStatus inside the same lifecycle',
      async ({ nextStatus, nextReason, observedRestartCount }) => {
        const containerId = '1'.repeat(64);
        const deps = buildHandler({
          runtimeHealthResponse: buildStrictLivenessRuntimeHealth(),
        });
        (deps.handler as any).livenessStartingRecoveryWaitMs = 1_000;
        (deps.handler as any).livenessStartingRecoveryPollIntervalMs = 1;
        deps.workerService.removeContainerIfLivenessFenceMatches
          .mockResolvedValueOnce({
            status: 'pending',
            reason: 'health_starting',
            observedRestartCount: 1,
          })
          .mockResolvedValueOnce({
            status: nextStatus,
            reason: nextReason,
            ...(observedRestartCount !== undefined
              ? { observedRestartCount }
              : {}),
          });
        const currentWorker = {
          worker_id: 'worker-1',
          name: 'Canal 1',
          account_id: 'account-1',
          server_id: 'server-1',
          worker_status_id: EWorkerStatus.recreating,
          worker_type_id: EWorkerType.wwebjs,
          created_at: null,
          updated_at: null,
          deleted_at: null,
          container_id: containerId,
          runtime_container_id: containerId,
          runtime_generation: 7,
          lifecycle_operation_id: 'operation-liveness',
          last_connection_check_at: null,
        };
        emulatePersistedRecreateCompletion(deps, currentWorker);
        const data = {
          action: EWorkerAction.recreate,
          worker_id: 'worker-1',
          account_id: 'account-1',
          server_id: 'server-1',
          expected_container_id: containerId,
          expected_container_started_at: '2026-07-29T22:00:00Z',
          expected_container_restart_count: 0,
          expected_container_health_status: 'unhealthy',
          expected_container_paused: false,
          expected_runtime_generation: 7,
          lifecycle_operation_id: 'operation-liveness',
        };
        const lease = {
          signal: new AbortController().signal,
          assertActive: jest.fn(),
        };

        await expect(
          (
            deps.handler as unknown as {
              removeRecreateRuntimeContainer: (
                payload: typeof data,
                removeVolume: boolean,
                worker: typeof currentWorker,
                context: typeof lease
              ) => Promise<RecreateRuntimeRemovalDecisionForTest>;
            }
          ).removeRecreateRuntimeContainer(data, false, currentWorker, lease)
        ).resolves.toEqual({
          status: nextStatus,
          reason: nextReason,
          ...(observedRestartCount !== undefined
            ? { observedRestartCount }
            : {}),
        });

        expect(
          deps.workerService.removeContainerIfLivenessFenceMatches
        ).toHaveBeenCalledTimes(2);
        expect(
          deps.workerService.removeContainerIfLivenessFenceMatches
        ).toHaveBeenNthCalledWith(
          1,
          expect.objectContaining({ forceRemove: false })
        );
        expect(
          deps.workerService.removeContainerIfLivenessFenceMatches
        ).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({ forceRemove: false })
        );
      }
    );

    it('never marks or removes a Docker-healthy provider/Kafka-not-ready runtime', async () => {
      const containerId = '4'.repeat(64);
      const deps = buildHandler({
        runtimeHealthResponse: buildStrictLivenessRuntimeHealth({
          can_send: false,
          kafka_consumers_ready: false,
        }),
      });
      (deps.handler as any).livenessStartingRecoveryWaitMs = 0;
      deps.workerService.removeContainerIfLivenessFenceMatches.mockResolvedValueOnce(
        {
          status: 'recovered',
          reason: 'runtime_recovered',
          observedRestartCount: 1,
        }
      );
      const currentWorker = {
        worker_id: 'worker-1',
        name: 'Canal 1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: EWorkerType.wwebjs,
        created_at: null,
        updated_at: null,
        deleted_at: null,
        container_id: containerId,
        runtime_container_id: containerId,
        runtime_generation: 7,
        lifecycle_operation_id: 'operation-liveness',
        last_connection_check_at: null,
      };
      const data = {
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        expected_container_id: containerId,
        expected_container_started_at: '2026-07-29T22:00:00Z',
        expected_container_restart_count: 0,
        expected_container_health_status: 'unhealthy',
        expected_container_paused: false,
        expected_runtime_generation: 7,
        lifecycle_operation_id: 'operation-liveness',
      };
      const lease = {
        signal: new AbortController().signal,
        assertActive: jest.fn(),
      };

      await expect(
        (
          deps.handler as unknown as {
            removeRecreateRuntimeContainer: (
              payload: typeof data,
              removeVolume: boolean,
              worker: typeof currentWorker,
              context: typeof lease
            ) => Promise<RecreateRuntimeRemovalDecisionForTest>;
          }
        ).removeRecreateRuntimeContainer(data, false, currentWorker, lease)
      ).rejects.toThrow(
        'worker_recreate_liveness_fence_retry:pending:local_liveness_recovered_readiness_pending'
      );

      expect(
        deps.workerService.updateWorkerByIdIfLifecycleMatches
      ).not.toHaveBeenCalled();
      expect(
        deps.workerService.removeContainerIfLivenessFenceMatches
      ).toHaveBeenCalledTimes(1);
    });

    it('forces exact removal when restart count advances again during starting', async () => {
      const containerId = '2'.repeat(64);
      const deps = buildHandler();
      (deps.handler as any).livenessStartingRecoveryWaitMs = 1_000;
      (deps.handler as any).livenessStartingRecoveryPollIntervalMs = 1;
      deps.workerService.removeContainerIfLivenessFenceMatches
        .mockResolvedValueOnce({
          status: 'pending',
          reason: 'health_starting',
          observedRestartCount: 1,
        })
        .mockResolvedValueOnce({
          status: 'pending',
          reason: 'health_starting',
          observedRestartCount: 2,
        })
        .mockResolvedValueOnce({
          status: 'removed',
          reason: 'still_unhealthy_after_restart',
        });
      const currentWorker = {
        worker_id: 'worker-1',
        name: 'Canal 1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: EWorkerType.wwebjs,
        created_at: null,
        updated_at: null,
        deleted_at: null,
        container_id: containerId,
        runtime_container_id: containerId,
        runtime_generation: 7,
        lifecycle_operation_id: 'operation-liveness',
        last_connection_check_at: null,
      };
      const data = {
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        expected_container_id: containerId,
        expected_container_started_at: '2026-07-29T22:00:00Z',
        expected_container_restart_count: 0,
        expected_container_health_status: 'unhealthy',
        expected_container_paused: false,
        expected_runtime_generation: 7,
      };
      const lease = {
        signal: new AbortController().signal,
        assertActive: jest.fn(),
      };

      await expect(
        (
          deps.handler as unknown as {
            removeRecreateRuntimeContainer: (
              payload: typeof data,
              removeVolume: boolean,
              worker: typeof currentWorker,
              context: typeof lease
            ) => Promise<RecreateRuntimeRemovalDecisionForTest>;
          }
        ).removeRecreateRuntimeContainer(data, false, currentWorker, lease)
      ).resolves.toEqual({
        status: 'removed',
        reason: 'still_unhealthy_after_restart',
      });

      expect(
        deps.workerService.removeContainerIfLivenessFenceMatches
      ).toHaveBeenCalledTimes(3);
      expect(
        deps.workerService.removeContainerIfLivenessFenceMatches
      ).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({ forceRemove: true })
      );
    });

    it('forces exact removal after the bounded starting recovery window', async () => {
      const containerId = '3'.repeat(64);
      const deps = buildHandler();
      (deps.handler as any).livenessStartingRecoveryWaitMs = 0;
      deps.workerService.removeContainerIfLivenessFenceMatches
        .mockResolvedValueOnce({
          status: 'pending',
          reason: 'health_starting',
          observedRestartCount: 1,
        })
        .mockResolvedValueOnce({
          status: 'removed',
          reason: 'still_unhealthy_after_restart',
        });
      const currentWorker = {
        worker_id: 'worker-1',
        name: 'Canal 1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: EWorkerType.wwebjs,
        created_at: null,
        updated_at: null,
        deleted_at: null,
        container_id: containerId,
        runtime_container_id: containerId,
        runtime_generation: 7,
        lifecycle_operation_id: 'operation-liveness',
        last_connection_check_at: null,
      };
      const data = {
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        expected_container_id: containerId,
        expected_container_started_at: '2026-07-29T22:00:00Z',
        expected_container_restart_count: 0,
        expected_container_health_status: 'unhealthy',
        expected_container_paused: false,
        expected_runtime_generation: 7,
      };
      const lease = {
        signal: new AbortController().signal,
        assertActive: jest.fn(),
      };

      await expect(
        (
          deps.handler as unknown as {
            removeRecreateRuntimeContainer: (
              payload: typeof data,
              removeVolume: boolean,
              worker: typeof currentWorker,
              context: typeof lease
            ) => Promise<RecreateRuntimeRemovalDecisionForTest>;
          }
        ).removeRecreateRuntimeContainer(data, false, currentWorker, lease)
      ).resolves.toEqual({
        status: 'removed',
        reason: 'still_unhealthy_after_restart',
      });
      expect(
        deps.workerService.removeContainerIfLivenessFenceMatches
      ).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ forceRemove: true })
      );
    });

    it('rejects identity drift without removal or online compensation', async () => {
      const containerId = 'e'.repeat(64);
      const deps = buildHandler();
      const currentWorker = {
        worker_id: 'worker-1',
        name: 'Canal 1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: EWorkerType.wwebjs,
        created_at: null,
        updated_at: null,
        deleted_at: null,
        container_id: containerId,
        runtime_container_id: containerId,
        runtime_generation: 7,
        lifecycle_operation_id: 'operation-liveness',
        last_connection_check_at: null,
      };
      deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValue(
        currentWorker
      );
      deps.workerService.inspectContainerWorkerByIdStrict.mockResolvedValueOnce(
        buildWorkerContainerInspection({
          container_id: containerId,
          container_started_at: '2026-07-29T22:00:00Z',
          container_restart_count: 0,
          container_health_status: 'unhealthy',
          container_paused: false,
          container_labels: {
            'underchat.worker_id': 'worker-1',
            'underchat.account_id': 'different-account',
            'underchat.server_id': 'server-1',
            'underchat.worker_type_id': EWorkerType.wwebjs,
            'underchat.runtime_generation': '7',
          },
        })
      );

      await expect(
        handleWorkerCommand(deps, {
          action: EWorkerAction.recreate,
          worker_id: 'worker-1',
          account_id: 'account-1',
          server_id: 'server-1',
          worker_type_id: EWorkerType.wwebjs,
          lifecycle_operation_id: 'operation-liveness',
          expected_container_id: containerId,
          expected_container_started_at: '2026-07-29T22:00:00Z',
          expected_container_restart_count: 0,
          expected_container_health_status: 'unhealthy',
          expected_container_paused: false,
          expected_runtime_generation: 7,
        })
      ).rejects.toThrow('worker_recreate_liveness_fence_retry:stale:preflight');

      expect(
        deps.workerService.removeContainerIfLivenessFenceMatches
      ).not.toHaveBeenCalled();
      expect(
        deps.workerService.updateWorkerByIdIfLifecycleMatches
      ).not.toHaveBeenCalled();
      expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();
    });

    it('treats a confirmed missing exact container as idempotently removed and creates its replacement', async () => {
      const containerId = 'f'.repeat(64);
      const deps = buildHandler({
        runtimeHealthResponse: buildStrictLivenessRuntimeHealth({
          runtime_generation: 2,
        }),
      });
      (deps.handler as any).recreateOnlineReconciliationWaitMs = 1;
      (deps.handler as any).recreateOnlineReconciliationPollIntervalMs = 0;
      deps.workerBaileysGrpcClientService.requestConnection.mockResolvedValue({
        ...buildConnectedState(),
        runtime_generation: 2,
      });
      const currentWorker = {
        worker_id: 'worker-1',
        name: 'Canal 1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: EWorkerType.wwebjs,
        created_at: null,
        updated_at: null,
        deleted_at: null,
        container_id: containerId,
        runtime_container_id: containerId,
        runtime_generation: 7,
        lifecycle_operation_id: 'operation-liveness',
        last_connection_check_at: null,
      };
      emulatePersistedRecreateCompletion(deps, currentWorker);
      deps.workerService.inspectContainerWorkerByIdStrict.mockResolvedValue({
        exists: false,
        container_name: 'worker-1',
      });
      deps.workerService.removeContainerIfLivenessFenceMatches.mockResolvedValueOnce(
        {
          status: 'removed',
          reason: 'already_absent',
        }
      );

      await handleWorkerCommand(deps, {
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        lifecycle_operation_id: 'operation-liveness',
        previous_worker_status_id: EWorkerStatus.online,
        expected_container_id: containerId,
        expected_container_started_at: '2026-07-29T22:00:00Z',
        expected_container_restart_count: 0,
        expected_container_health_status: 'unhealthy',
        expected_container_paused: false,
        expected_runtime_generation: 7,
      });

      expect(
        deps.workerService.removeContainerIfLivenessFenceMatches
      ).toHaveBeenCalledTimes(1);
      expect(deps.workerService.createContainerWorker).toHaveBeenCalledTimes(1);
      expect(
        deps.workerService.updateWorkerByIdIfLifecycleMatches
      ).not.toHaveBeenCalledWith(
        'account-1',
        expect.objectContaining({
          worker_status_id: EWorkerStatus.online,
          lifecycle_operation_id: null,
          container_id: containerId,
        }),
        expect.anything()
      );
    });

    it('removes only the full container id carried by a liveness fence', async () => {
      const containerId = 'b'.repeat(64);
      const rawContainerId = containerId.toUpperCase();
      const deps = buildHandler();
      const currentWorker = {
        worker_id: 'worker-1',
        name: 'Canal 1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: EWorkerType.wwebjs,
        created_at: null,
        updated_at: null,
        deleted_at: null,
        container_id: containerId,
        runtime_container_id: containerId,
        runtime_generation: 7,
        lifecycle_operation_id: 'operation-liveness',
        last_connection_check_at: null,
      };

      await expect(
        (
          deps.handler as unknown as {
            removeRecreateRuntimeContainer: (
              payload: {
                worker_id: string;
                account_id: string;
                server_id: string;
                expected_container_id: string;
                expected_container_started_at: string;
                expected_container_restart_count: number;
                expected_container_health_status: string;
                expected_container_paused: boolean;
                expected_runtime_generation: number;
              },
              removeVolume: boolean,
              worker: typeof currentWorker,
              context: {
                signal: AbortSignal;
                assertActive: () => void;
              }
            ) => Promise<{
              status: 'removed' | 'recovered' | 'pending' | 'stale' | 'retry';
              reason: string;
            }>;
          }
        ).removeRecreateRuntimeContainer(
          {
            worker_id: 'worker-1',
            account_id: 'account-1',
            server_id: 'server-1',
            expected_container_id: `  ${rawContainerId}  `,
            expected_container_started_at: '2026-07-29T22:00:00Z',
            expected_container_restart_count: 0,
            expected_container_health_status: 'unhealthy',
            expected_container_paused: false,
            expected_runtime_generation: 7,
          },
          false,
          currentWorker,
          {
            signal: new AbortController().signal,
            assertActive: jest.fn(),
          }
        )
      ).resolves.toEqual({
        status: 'removed',
        reason: 'fence_matched',
      });

      expect(
        deps.workerService.removeContainerIfLivenessFenceMatches
      ).toHaveBeenCalledWith({
        containerId,
        startedAt: '2026-07-29T22:00:00Z',
        restartCount: 0,
        healthStatus: 'unhealthy',
        paused: false,
        workerId: 'worker-1',
        accountId: 'account-1',
        serverId: 'server-1',
        workerTypeId: EWorkerType.wwebjs,
        runtimeGeneration: 7,
        forceRemove: false,
      });
      expect(
        deps.workerService.removeContainerByNameAndVolume
      ).not.toHaveBeenCalled();
    });

    it('skips stale recreate operations before removing or creating containers', async () => {
      const deps = buildHandler();
      deps.workerService.viewWorkerForMonitor.mockResolvedValue({
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: EWorkerType.wwebjs,
        deleted_at: null,
        container_id: 'container-old',
        lifecycle_operation_id: 'operation-old',
      });
      const primaryView = (
        deps.workerService as unknown as {
          viewWorkerForMonitorConsistent: jest.Mock;
        }
      ).viewWorkerForMonitorConsistent;
      deps.workerService.viewWorkerForMonitor.mockResolvedValueOnce({
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: EWorkerType.whatsmeow,
        session_storage: EWorkerSessionStorage.legacy_volume,
        created_at: null,
        updated_at: null,
        deleted_at: null,
        container_id: 'container-new',
        lifecycle_operation_id: 'operation-new',
        last_connection_check_at: null,
      });

      await handleWorkerCommand(deps, {
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        server_id: 'server-1',
        account_id: 'account-1',
        lifecycle_operation_id: 'operation-old',
      });

      expect(deps.workerService.removeContainerWorker).not.toHaveBeenCalled();
      expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();
      expect(deps.workerService.updateWorkerById).not.toHaveBeenCalled();
      expect(primaryView).toHaveBeenCalledWith('worker-1');
    });

    it('uses the primary worker provider during recreate instead of a stale replica type', async () => {
      const deps = buildHandler({
        runtimeHealthResponse: {
          worker_type_id: EWorkerType.whatsmeow,
        },
      });
      deps.workerService.viewWorkerForMonitor.mockResolvedValue({
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: EWorkerType.whatsmeow,
        deleted_at: null,
        container_id: 'container-old',
        lifecycle_operation_id: null,
      });

      await handleWorkerCommand(deps, {
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        server_id: 'server-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.whatsmeow,
      });

      expect(deps.workerService.viewWorkerType).not.toHaveBeenCalled();
      expect(deps.workerService.createContainerWorker).toHaveBeenCalledWith(
        expect.any(String),
        'worker-1',
        'account-1',
        false,
        expect.any(String),
        expect.any(Number),
        undefined,
        expect.objectContaining({
          workerTypeId: EWorkerType.whatsmeow,
          runtimeGeneration: 2,
        }),
        'worker-1',
        expect.objectContaining({
          imageContentId: WORKER_IMAGE_CONTENT_ID,
          requireContainerNameAvailable: true,
          requireExistingVolume: true,
        })
      );
    });
  });

  it('removes the exact newly created container when recreate is superseded during Docker creation', async () => {
    let containerCreated = false;
    const workerRuntimeRepository = {
      viewByWorkerId: jest.fn(async () => ({
        worker_id: 'worker-1',
        container_id: 'container-old',
        container_name: 'worker-1',
        session_volume_name: 'worker-1',
        runtime_generation: 7,
      })),
      reserveNextRuntimeGeneration: jest.fn(async () => 8),
      upsert: jest.fn(async (input: Record<string, unknown>) => input),
      deleteByWorkerId: jest.fn(async () => true),
    };
    const deps = buildHandler({ workerRuntimeRepository });
    deps.workerService.viewWorkerForMonitor.mockImplementation(async () => ({
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: EWorkerType.wwebjs,
      deleted_at: null,
      container_id: containerCreated ? 'container-newer' : 'container-old',
      lifecycle_operation_id: containerCreated
        ? 'operation-new'
        : 'operation-current',
    }));
    deps.workerService.createContainerWorker.mockImplementationOnce(
      async () => {
        containerCreated = true;
        return 'container-stale';
      }
    );

    await expect(
      handleWorkerCommand(deps, {
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        server_id: 'server-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
        lifecycle_operation_id: 'operation-current',
      })
    ).rejects.toThrow(
      'Worker lifecycle changed after container creation for worker-1'
    );

    expect(deps.workerService.removeContainerWorkerById).toHaveBeenCalledWith(
      'container-stale'
    );
    expect(workerRuntimeRepository.upsert).not.toHaveBeenCalled();
    expect(deps.workerService.updateWorkerById).not.toHaveBeenCalled();
  });

  describe('durable topic deletion boundaries', () => {
    it('does not request a QR code in background after recreating a worker', async () => {
      const deps = buildHandler();

      await handleWorkerCommand(deps, {
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        server_id: 'server-1',
        account_id: 'account-1',
      });

      expect(
        deps.workerBaileysGrpcClientService.requestConnection
      ).not.toHaveBeenCalled();
      expect(
        deps.kafkaBaileysQueueService.deletePermanently
      ).not.toHaveBeenCalled();
    });

    it('deletes all durable worker topics only for permanent worker deletion', async () => {
      const deps = buildHandler();

      await handleWorkerCommand(deps, {
        action: EWorkerAction.delete,
        worker_id: 'worker-1',
        server_id: 'server-1',
        account_id: 'account-1',
        lifecycle_operation_id: 'operation-delete-1',
        debug_trace_id: 'trace-delete-1',
      });

      const deletionRequest = {
        action: EWorkerAction.delete,
        worker_id: 'worker-1',
        account_id: 'account-1',
        lifecycle_operation_id: 'operation-delete-1',
        debug_trace_id: 'trace-delete-1',
      };
      const topics = deps.kafkaBaileysQueueService.all('worker-1');
      expect(
        deps.workerTopicDeletionAuthorizerService.assertPermanentDeletionIntent
      ).toHaveBeenCalledWith(deletionRequest, topics);
      expect(
        deps.workerTopicDeletionAuthorizerService.authorizePermanentDeletion
      ).not.toHaveBeenCalled();
      expect(
        deps.kafkaBaileysQueueService.deletePermanently
      ).toHaveBeenCalledWith(
        deletionRequest,
        expect.objectContaining({
          assertActive: expect.any(Function),
        })
      );
      expect(
        deps.workerService.updateWorkerByIdIfLifecycleMatches
      ).toHaveBeenCalledWith(
        'account-1',
        expect.objectContaining({
          worker_id: 'worker-1',
          worker_status_id: EWorkerStatus.deleting,
        }),
        {
          lifecycle_operation_id: 'operation-delete-1',
          server_id: 'server-1',
          worker_status_id: EWorkerStatus.deleting,
        }
      );
      expect(deps.workerService.deleteWorkerById).toHaveBeenCalledWith(
        'account-1',
        'worker-1',
        {
          lifecycleOperationId: 'operation-delete-1',
          expectedLifecycleOperationId: 'operation-delete-1',
        }
      );
      expect(
        deps.workerService.deleteWorkerById.mock.invocationCallOrder[0]
      ).toBeLessThan(
        deps.kafkaBaileysQueueService.deletePermanently.mock
          .invocationCallOrder[0]
      );
    });

    it('preserves every durable worker topic when worker deletion fails', async () => {
      const deps = buildHandler();
      deps.workerTopicDeletionAuthorizerService.assertPermanentDeletionIntent.mockRejectedValueOnce(
        new Error('database unavailable')
      );

      await expect(
        handleWorkerCommand(deps, {
          action: EWorkerAction.delete,
          worker_id: 'worker-1',
          server_id: 'server-1',
          account_id: 'account-1',
          lifecycle_operation_id: 'operation-delete-1',
          debug_trace_id: 'trace-delete-1',
        })
      ).rejects.toThrow('database unavailable');

      expect(
        deps.kafkaBaileysQueueService.deletePermanently
      ).not.toHaveBeenCalled();
    });

    it('preserves durable topics when a predeleted worker cannot be cleaned from Docker', async () => {
      const deps = buildHandler();
      const daemonError = Object.assign(
        new Error('docker daemon unavailable'),
        {
          statusCode: 500,
        }
      );
      deps.workerTopicDeletionAuthorizerService.assertPermanentDeletionIntent.mockResolvedValueOnce(
        { permanently_deleted: true }
      );
      deps.workerService.removeContainerByNameAndVolume.mockRejectedValueOnce(
        daemonError
      );

      await expect(
        handleWorkerCommand(deps, {
          action: EWorkerAction.delete,
          worker_id: 'worker-1',
          server_id: 'server-1',
          account_id: 'account-1',
          lifecycle_operation_id: 'operation-delete-1',
          debug_trace_id: 'trace-delete-1',
        })
      ).rejects.toBe(daemonError);

      expect(deps.workerService.deleteWorkerById).not.toHaveBeenCalled();
      expect(
        deps.kafkaBaileysQueueService.deletePermanently
      ).not.toHaveBeenCalled();
    });
  });
});

describe('WorkerCommandHandlerService online notification CAS races', () => {
  const initialProvisioningWorker = {
    worker_id: 'worker-1',
    name: 'Canal 1',
    account_id: 'account-1',
    server_id: 'server-1',
    worker_status_id: EWorkerStatus.recreating,
    worker_type_id: EWorkerType.wwebjs,
    created_at: null,
    updated_at: null,
    deleted_at: null,
    container_id: 'container-1',
    lifecycle_operation_id: 'operation-1',
    last_connection_check_at: null,
  };
  const onlineWorker = {
    ...initialProvisioningWorker,
    worker_status_id: EWorkerStatus.online,
    lifecycle_operation_id: null,
  };
  const strictRuntimeHealth = {
    ready: true,
    session_ready: true,
    can_send: true,
    can_receive_runtime: true,
    authenticated: true,
    has_session: true,
    provider_state: 'CONNECTED',
    phone: '556192037138',
    kafka_unhealthy: false,
    kafka_consumers_ready: true,
    runtime_health_schema_version: 3,
  };
  const onlineNotification = {
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
    container_id: 'container-1',
    runtime_generation: 1,
    connection_status_source_id: CONNECTION_STATUS_SOURCE_ID,
    connection_status: buildNativeConnectionStatus(EWorkerType.wwebjs, true),
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('repairs a NULL runtime pointer from one immutable Docker volume owner before accepting ONLINE', async () => {
    const oldContainerId = 'b'.repeat(64);
    const runtimeContainerId = 'a'.repeat(64);
    let runtime: Record<string, unknown> & { container_id: string | null } = {
      worker_id: 'worker-1',
      container_id: null as string | null,
      container_name: 'worker-1',
      session_storage: EWorkerSessionStorage.legacy_volume,
      session_volume_name: 'worker-volume-1',
      runtime_generation: 4,
      warm_pool_id: null,
      connection_sequence: 0,
    };
    const runtimeRepository = {
      ...buildSelfHealRuntimeRepository(4, runtimeContainerId),
      viewByWorkerId: jest.fn(async () => ({ ...runtime })),
      viewByWorkerIdConsistent: jest.fn(async () => ({ ...runtime })),
      claimReservedRuntimeContainer: jest.fn(async () => {
        runtime = { ...runtime, container_id: runtimeContainerId };
        return true;
      }),
      markRecreateBootstrapStarted: jest.fn(async () => {
        runtime = {
          ...runtime,
          recreate_bootstrap_operation_id: 'operation-1',
          recreate_bootstrap_runtime_generation: 4,
          recreate_bootstrap_container_id: runtimeContainerId,
          recreate_bootstrap_started_at: '2026-08-15T20:00:00.000Z',
          recreate_retired_operation_id: null,
          recreate_retired_runtime_generation: null,
          recreate_retired_container_id: null,
          recreate_retired_at: null,
        };
        return true;
      }),
    };
    const deps = buildHandler({
      workerRuntimeRepository: runtimeRepository,
      runtimeHealthResponse: {
        ...strictRuntimeHealth,
        runtime_generation: 4,
      },
    });
    deps.workerService.viewWorkerForMonitor.mockResolvedValue({
      ...initialProvisioningWorker,
      container_id: oldContainerId,
      runtime_container_id: null,
      runtime_generation: 4,
      runtime_session_volume_name: 'worker-volume-1',
    });
    deps.workerService.listContainerIdsMountingVolumeStrict.mockResolvedValue([
      runtimeContainerId,
    ]);
    deps.workerService.inspectContainerWorkerByIdStrict.mockResolvedValue(
      buildWorkerContainerInspection({
        container_id: runtimeContainerId,
        container_name: 'worker-1',
        container_image_id: WORKER_IMAGE_CONTENT_ID,
        container_labels: {
          'underchat.worker_id': 'worker-1',
          'underchat.account_id': 'account-1',
          'underchat.server_id': 'server-1',
          'underchat.worker_type_id': EWorkerType.wwebjs,
          'underchat.worker_image': 'under-worker-wwebjs:latest',
          'underchat.worker_image_content_id': WORKER_IMAGE_CONTENT_ID,
          'underchat.worker_grpc_port': '50053',
          'underchat.runtime_generation': '4',
          'underchat.lifecycle_operation_id': 'operation-1',
          'underchat.session_storage': EWorkerSessionStorage.legacy_volume,
          'underchat.session_volume_name': 'worker-volume-1',
        },
        container_env: {
          WORKER_ID: 'worker-1',
          ACCOUNT_ID: 'account-1',
          WORKER_TYPE_ID: EWorkerType.wwebjs,
          WORKER_IMAGE: 'under-worker-wwebjs:latest',
          WORKER_GRPC_PORT: '50053',
          RUNTIME_GENERATION: '4',
          WORKER_SESSION_STORAGE: EWorkerSessionStorage.legacy_volume,
          SESSION_VOLUME_NAME: 'worker-volume-1',
        },
        container_mounts: [
          {
            destination: '/app/data',
            name: 'worker-volume-1',
            read_write: true,
            type: 'volume',
          },
        ],
      })
    );

    await expect(
      deps.handler.notifyWorkerStatus({
        ...onlineNotification,
        container_id: undefined,
        runtime_generation: 4,
      })
    ).resolves.toBeUndefined();

    expect(
      runtimeRepository.claimReservedRuntimeContainer
    ).toHaveBeenCalledWith({
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.wwebjs,
      lifecycle_operation_id: 'operation-1',
      expected_worker_status_id: EWorkerStatus.recreating,
      container_id: runtimeContainerId,
      container_name: 'worker-1',
      session_storage: EWorkerSessionStorage.legacy_volume,
      session_volume_name: 'worker-volume-1',
      runtime_generation: 4,
      warm_pool_id: null,
      source_provider: undefined,
    });
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.online,
        container_id: runtimeContainerId,
      }),
      expect.objectContaining({
        container_id: oldContainerId,
        runtime_container_id: runtimeContainerId,
        runtime_generation: 4,
      })
    );
  });

  it('fails closed when a NULL runtime pointer has no uniquely validated Docker identity', async () => {
    const runtimeContainerId = 'a'.repeat(64);
    const runtimeRepository = {
      ...buildSelfHealRuntimeRepository(4, runtimeContainerId),
      viewByWorkerId: jest.fn(async () => ({
        worker_id: 'worker-1',
        container_id: null,
        container_name: 'worker-1',
        session_volume_name: 'worker-volume-1',
        runtime_generation: 4,
        warm_pool_id: null,
      })),
      viewByWorkerIdConsistent: jest.fn(async () => ({
        worker_id: 'worker-1',
        container_id: null,
        container_name: 'worker-1',
        session_volume_name: 'worker-volume-1',
        runtime_generation: 4,
        warm_pool_id: null,
      })),
      claimReservedRuntimeContainer: jest.fn(async () => true),
    };
    const deps = buildHandler({
      workerRuntimeRepository: runtimeRepository,
      runtimeHealthResponse: {
        ...strictRuntimeHealth,
        runtime_generation: 4,
      },
    });
    deps.workerService.viewWorkerForMonitor.mockResolvedValue({
      ...initialProvisioningWorker,
      container_id: 'b'.repeat(64),
      runtime_container_id: null,
      runtime_generation: 4,
      runtime_session_volume_name: 'worker-volume-1',
    });
    deps.workerService.listContainerIdsMountingVolumeStrict.mockResolvedValue([
      runtimeContainerId,
      'c'.repeat(64),
    ]);

    await expect(
      deps.handler.notifyWorkerStatus({
        ...onlineNotification,
        container_id: undefined,
        runtime_generation: 4,
      })
    ).rejects.toThrow(
      'worker_online_readiness_rejected:runtime_container_identity_unavailable'
    );

    expect(
      runtimeRepository.claimReservedRuntimeContainer
    ).not.toHaveBeenCalled();
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
  });

  it('acknowledges an identical online runtime when another path won the lifecycle CAS', async () => {
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(1, 'container-1'),
      runtimeHealthResponse: strictRuntimeHealth,
    });
    deps.workerService.viewWorkerForMonitor
      .mockResolvedValueOnce(initialProvisioningWorker)
      .mockResolvedValueOnce(onlineWorker);
    deps.workerService.updateWorkerByIdIfLifecycleMatches.mockResolvedValueOnce(
      false
    );

    await expect(
      deps.handler.notifyWorkerStatus(onlineNotification)
    ).resolves.toBeUndefined();

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.online,
      }),
      expect.objectContaining({
        lifecycle_operation_id: 'operation-1',
        worker_status_id: EWorkerStatus.recreating,
      })
    );
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenNthCalledWith(
      2,
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.online,
        number: '556192037138',
        connection_date: expect.any(String),
      }),
      {
        lifecycle_operation_id: null,
        container_id: 'container-1',
        runtime_container_id: 'container-1',
        runtime_generation: 1,
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        worker_status_id: EWorkerStatus.online,
      }
    );
    expect(deps.workerService.viewWorkerForMonitor).toHaveBeenCalledTimes(2);
    expect(deps.centrifugoService.publishSub).toHaveBeenCalled();
    expect(deps.centrifugoService.publish).toHaveBeenCalled();
  });

  it('promotes a replacement runtime while fencing the previous control container', async () => {
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(
        2,
        'container-new'
      ),
      runtimeHealthResponse: {
        ...strictRuntimeHealth,
        runtime_generation: 2,
      },
    });
    deps.workerService.viewWorkerForMonitor.mockResolvedValue({
      ...initialProvisioningWorker,
      container_id: 'container-old',
      runtime_container_id: 'container-new',
    });

    await expect(
      deps.handler.notifyWorkerStatus({
        ...onlineNotification,
        container_id: 'container-new',
        runtime_generation: 2,
      })
    ).resolves.toBeUndefined();

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.online,
        container_id: 'container-new',
      }),
      {
        lifecycle_operation_id: 'operation-1',
        container_id: 'container-old',
        runtime_container_id: 'container-new',
        runtime_generation: 2,
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        worker_status_id: EWorkerStatus.recreating,
      }
    );
    const firstUpdateCall =
      deps.workerService.updateWorkerByIdIfLifecycleMatches.mock.calls.at(0);
    expect(firstUpdateCall?.[1]).not.toHaveProperty('lifecycle_operation_id');
  });

  it('re-applies a replacement runtime idempotently after lifecycle finalization wins', async () => {
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(
        2,
        'container-new'
      ),
      runtimeHealthResponse: {
        ...strictRuntimeHealth,
        runtime_generation: 2,
      },
    });
    deps.workerService.viewWorkerForMonitor
      .mockResolvedValueOnce({
        ...initialProvisioningWorker,
        container_id: 'container-old',
        runtime_container_id: 'container-new',
      })
      .mockResolvedValueOnce({
        ...onlineWorker,
        container_id: 'container-new',
        runtime_container_id: 'container-new',
      });
    deps.workerService.updateWorkerByIdIfLifecycleMatches.mockResolvedValueOnce(
      false
    );

    await expect(
      deps.handler.notifyWorkerStatus({
        ...onlineNotification,
        container_id: 'container-new',
        runtime_generation: 2,
      })
    ).resolves.toBeUndefined();

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenNthCalledWith(
      2,
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.online,
        container_id: 'container-new',
      }),
      {
        lifecycle_operation_id: null,
        container_id: 'container-new',
        runtime_container_id: 'container-new',
        runtime_generation: 2,
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        worker_status_id: EWorkerStatus.online,
      }
    );
  });

  it.each([EWorkerType.baileys, EWorkerType.wwebjs, EWorkerType.whatsmeow])(
    're-acknowledges the exact %s runtime after a crash between ONLINE and lifecycle finalization',
    async (workerTypeId) => {
      const onlineWithPendingLifecycle = {
        ...initialProvisioningWorker,
        worker_status_id: EWorkerStatus.online,
        worker_type_id: workerTypeId,
      };
      const deps = buildHandler({
        workerRuntimeRepository: buildSelfHealRuntimeRepository(
          1,
          'container-1'
        ),
        runtimeHealthResponse: {
          ...strictRuntimeHealth,
          worker_type_id: workerTypeId,
        },
      });
      deps.workerService.viewWorkerForMonitor.mockResolvedValue(
        onlineWithPendingLifecycle
      );

      await expect(
        deps.handler.notifyWorkerStatus({
          ...onlineNotification,
          worker_type_id: workerTypeId,
          container_id: undefined,
        })
      ).resolves.toBeUndefined();

      expect(
        deps.workerService.updateWorkerByIdIfLifecycleMatches
      ).toHaveBeenCalledWith(
        'account-1',
        expect.objectContaining({
          worker_id: 'worker-1',
          worker_status_id: EWorkerStatus.online,
        }),
        expect.objectContaining({
          lifecycle_operation_id: 'operation-1',
          container_id: 'container-1',
          server_id: 'server-1',
          worker_type_id: workerTypeId,
          worker_status_id: EWorkerStatus.online,
          runtime_container_id: 'container-1',
          runtime_generation: 1,
        })
      );
      expect(deps.centrifugoService.publishSub).toHaveBeenCalled();
      expect(deps.centrifugoService.publish).toHaveBeenCalled();
    }
  );

  it('rejects an ONLINE re-ack when a reported container conflicts with the lifecycle runtime', async () => {
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(1, 'container-1'),
      runtimeHealthResponse: strictRuntimeHealth,
    });
    deps.workerService.viewWorkerForMonitor.mockResolvedValue({
      ...initialProvisioningWorker,
      worker_status_id: EWorkerStatus.online,
    });

    await expect(
      deps.handler.notifyWorkerStatus({
        ...onlineNotification,
        container_id: 'stale-container',
      })
    ).rejects.toThrow(
      'worker_online_readiness_rejected:runtime_container_mismatch'
    );

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
  });

  it('rejects an ONLINE lifecycle re-ack without an explicit runtime generation', async () => {
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(1, 'container-1'),
      runtimeHealthResponse: strictRuntimeHealth,
    });
    deps.workerService.viewWorkerForMonitor.mockResolvedValue({
      ...initialProvisioningWorker,
      worker_status_id: EWorkerStatus.online,
    });

    await expect(
      deps.handler.notifyWorkerStatus({
        ...onlineNotification,
        runtime_generation: undefined,
      })
    ).rejects.toThrow(
      'worker_online_readiness_rejected:runtime_generation_missing'
    );

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
  });

  it('promotes the exact runtime when lifecycle finalization wins the CAS as disponible', async () => {
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(1, 'container-1'),
      runtimeHealthResponse: strictRuntimeHealth,
    });
    deps.workerService.viewWorkerForMonitor
      .mockResolvedValueOnce(initialProvisioningWorker)
      .mockResolvedValueOnce({
        ...initialProvisioningWorker,
        worker_status_id: EWorkerStatus.disponible,
        lifecycle_operation_id: null,
      });
    deps.workerService.updateWorkerByIdIfLifecycleMatches.mockResolvedValueOnce(
      false
    );

    await expect(
      deps.handler.notifyWorkerStatus(onlineNotification)
    ).resolves.toBeUndefined();

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenNthCalledWith(
      2,
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.online,
        number: '556192037138',
        connection_date: expect.any(String),
      }),
      {
        lifecycle_operation_id: null,
        container_id: 'container-1',
        runtime_container_id: 'container-1',
        runtime_generation: 1,
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        worker_status_id: EWorkerStatus.disponible,
      }
    );
    expect(deps.centrifugoService.publishSub).toHaveBeenCalled();
    expect(deps.centrifugoService.publish).toHaveBeenCalled();
  });

  it('rejects a CAS miss when the authoritative runtime generation changed', async () => {
    const runtimeRepository = buildSelfHealRuntimeRepository(1, 'container-1');
    runtimeRepository.viewByWorkerIdConsistent
      .mockResolvedValueOnce({
        worker_id: 'worker-1',
        container_id: 'container-1',
        container_name: 'worker-1',
        session_volume_name: 'worker-1',
        runtime_generation: 1,
        connection_sequence: 1,
        recreate_bootstrap_operation_id: 'operation-1',
        recreate_bootstrap_runtime_generation: 1,
        recreate_bootstrap_container_id: 'container-1',
        recreate_bootstrap_started_at: '2026-08-08T00:00:00.000Z',
      })
      .mockResolvedValueOnce({
        worker_id: 'worker-1',
        container_id: 'container-1',
        container_name: 'worker-1',
        session_volume_name: 'worker-1',
        runtime_generation: 2,
        connection_sequence: 2,
      });
    const deps = buildHandler({
      workerRuntimeRepository: runtimeRepository,
      runtimeHealthResponse: strictRuntimeHealth,
    });
    deps.workerService.viewWorkerForMonitor
      .mockResolvedValueOnce(initialProvisioningWorker)
      .mockResolvedValueOnce(onlineWorker);
    deps.workerService.updateWorkerByIdIfLifecycleMatches.mockResolvedValueOnce(
      false
    );

    await expect(
      deps.handler.notifyWorkerStatus(onlineNotification)
    ).rejects.toThrow(
      'worker_online_readiness_rejected:worker_state_changed_or_lifecycle_started'
    );

    expect(deps.centrifugoService.publishSub).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publish).not.toHaveBeenCalled();
  });

  it('rejects a CAS miss when the authoritative container changed', async () => {
    const runtimeRepository = buildSelfHealRuntimeRepository(1, 'container-1');
    runtimeRepository.viewByWorkerIdConsistent
      .mockResolvedValueOnce({
        worker_id: 'worker-1',
        container_id: 'container-1',
        container_name: 'worker-1',
        session_volume_name: 'worker-1',
        runtime_generation: 1,
        connection_sequence: 1,
        recreate_bootstrap_operation_id: 'operation-1',
        recreate_bootstrap_runtime_generation: 1,
        recreate_bootstrap_container_id: 'container-1',
        recreate_bootstrap_started_at: '2026-08-08T00:00:00.000Z',
      })
      .mockResolvedValueOnce({
        worker_id: 'worker-1',
        container_id: 'container-2',
        container_name: 'worker-1',
        session_volume_name: 'worker-1',
        runtime_generation: 1,
        connection_sequence: 2,
      });
    const deps = buildHandler({
      workerRuntimeRepository: runtimeRepository,
      runtimeHealthResponse: strictRuntimeHealth,
    });
    deps.workerService.viewWorkerForMonitor
      .mockResolvedValueOnce(initialProvisioningWorker)
      .mockResolvedValueOnce({
        ...onlineWorker,
        container_id: 'container-2',
      });
    deps.workerService.updateWorkerByIdIfLifecycleMatches.mockResolvedValueOnce(
      false
    );

    await expect(
      deps.handler.notifyWorkerStatus(onlineNotification)
    ).rejects.toThrow(
      'worker_online_readiness_rejected:worker_state_changed_or_lifecycle_started'
    );

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledTimes(1);
    expect(deps.centrifugoService.publishSub).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publish).not.toHaveBeenCalled();
  });

  it('rejects a CAS miss when the worker omitted its runtime generation', async () => {
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(1, 'container-1'),
      runtimeHealthResponse: strictRuntimeHealth,
    });
    deps.workerService.viewWorkerForMonitor
      .mockResolvedValueOnce(initialProvisioningWorker)
      .mockResolvedValueOnce(onlineWorker);
    deps.workerService.updateWorkerByIdIfLifecycleMatches.mockResolvedValueOnce(
      false
    );

    await expect(
      deps.handler.notifyWorkerStatus({
        ...onlineNotification,
        runtime_generation: undefined,
      })
    ).rejects.toThrow(
      'worker_online_readiness_rejected:runtime_generation_missing'
    );

    expect(deps.workerService.viewWorkerForMonitor).toHaveBeenCalledTimes(1);
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publishSub).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publish).not.toHaveBeenCalled();
  });

  it('rejects when the second fenced CAS loses to another lifecycle transition', async () => {
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(1, 'container-1'),
      runtimeHealthResponse: strictRuntimeHealth,
    });
    deps.workerService.viewWorkerForMonitor
      .mockResolvedValueOnce(initialProvisioningWorker)
      .mockResolvedValueOnce(onlineWorker);
    deps.workerService.updateWorkerByIdIfLifecycleMatches
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);

    await expect(
      deps.handler.notifyWorkerStatus(onlineNotification)
    ).rejects.toThrow(
      'worker_online_readiness_rejected:worker_state_changed_or_lifecycle_started'
    );

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledTimes(2);
    expect(deps.centrifugoService.publishSub).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publish).not.toHaveBeenCalled();
  });

  it('rejects when a new lifecycle is present during the authoritative reread', async () => {
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(1, 'container-1'),
      runtimeHealthResponse: strictRuntimeHealth,
    });
    deps.workerService.viewWorkerForMonitor
      .mockResolvedValueOnce(initialProvisioningWorker)
      .mockResolvedValueOnce({
        ...onlineWorker,
        lifecycle_operation_id: 'operation-2',
      });
    deps.workerService.updateWorkerByIdIfLifecycleMatches.mockResolvedValueOnce(
      false
    );

    await expect(
      deps.handler.notifyWorkerStatus(onlineNotification)
    ).rejects.toThrow(
      'worker_online_readiness_rejected:worker_state_changed_or_lifecycle_started'
    );

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledTimes(1);
    expect(deps.centrifugoService.publishSub).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publish).not.toHaveBeenCalled();
  });

  it('fails closed when the authoritative reread after a CAS miss is unavailable', async () => {
    const deps = buildHandler({
      workerRuntimeRepository: buildSelfHealRuntimeRepository(1, 'container-1'),
      runtimeHealthResponse: strictRuntimeHealth,
    });
    deps.workerService.viewWorkerForMonitor
      .mockResolvedValueOnce(initialProvisioningWorker)
      .mockRejectedValueOnce(new Error('primary database unavailable'));
    deps.workerService.updateWorkerByIdIfLifecycleMatches.mockResolvedValueOnce(
      false
    );

    await expect(
      deps.handler.notifyWorkerStatus(onlineNotification)
    ).rejects.toThrow(
      'worker_online_readiness_rejected:worker_state_changed_or_lifecycle_started'
    );

    expect(deps.centrifugoService.publishSub).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publish).not.toHaveBeenCalled();
  });
});

describe('WorkerCommandHandlerService permanent deletion authorization', () => {
  it.each([
    {
      name: 'session reset',
      workerType: EWorkerType.wwebjs,
      previousWorkerType: undefined,
    },
    {
      name: 'provider replacement',
      workerType: EWorkerType.whatsmeow,
      previousWorkerType: EWorkerType.wwebjs,
    },
  ])(
    'passes the exact removed runtime snapshot to the PostgreSQL deletion fence during $name',
    async ({ workerType, previousWorkerType }) => {
      const runtimeRepository = buildSelfHealRuntimeRepository(
        41,
        'container-generation-41'
      );
      const deps = buildHandler({
        workerRuntimeRepository: runtimeRepository,
      });
      const stopAfterSessionDelete = new Error(
        'stop_after_postgres_session_delete'
      );
      const lifecycleData: IWorkerPayload = {
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: workerType,
        ...(previousWorkerType
          ? { previous_worker_type_id: previousWorkerType }
          : {}),
        session_storage: EWorkerSessionStorage.postgres,
        remove_session: true,
        remove_volume: false,
        lifecycle_operation_id: 'operation-reset-1',
      };
      const handler = deps.handler as unknown as {
        performRecreateWorker: (
          data: IWorkerPayload,
          lease: ILockLeaseContext
        ) => Promise<unknown>;
        resolveRecreateExecutionContext: jest.Mock;
        resolveStableWorkerImageContentId: jest.Mock;
        assertMissingJournalRecreateProviderSafe: jest.Mock;
        resolveRecreateSessionContext: jest.Mock;
        isLifecycleOperationCurrent: jest.Mock;
        invalidateQrAttemptState: jest.Mock;
        assertPreservedSessionVolumeExists: jest.Mock;
        assertLifecycleOperationCurrent: jest.Mock;
        retryOperation: jest.Mock;
        removeRecreateRuntimeContainer: jest.Mock;
        reserveNextWorkerRuntimeGeneration: jest.Mock;
      };
      Object.assign(handler, {
        resolveRecreateExecutionContext: jest.fn(async () => ({
          currentWorker: {
            worker_id: lifecycleData.worker_id,
            account_id: lifecycleData.account_id,
            server_id: lifecycleData.server_id,
            worker_type_id: workerType,
            worker_status_id: EWorkerStatus.recreating,
            lifecycle_operation_id: lifecycleData.lifecycle_operation_id,
            deleted_at: null,
          },
          workerType,
        })),
        resolveStableWorkerImageContentId: jest.fn(
          async () => WORKER_IMAGE_CONTENT_ID
        ),
        assertMissingJournalRecreateProviderSafe: jest.fn(
          async () => undefined
        ),
        resolveRecreateSessionContext: jest.fn(async () => ({
          shouldRemoveSession: true,
          sessionStorage: EWorkerSessionStorage.postgres,
          shouldRemoveVolume: false,
          sessionVolumeResolution: {
            runtimeGeneration: 41,
            sessionDeletionRuntimeFence: {
              runtime_generation: 41,
              container_id: 'container-generation-41',
              session_storage: EWorkerSessionStorage.postgres,
              session_volume_name: null,
            },
            source: 'postgres',
            runtimeWasBackfilled: false,
          },
          preservedSessionVolumeName: undefined,
          sessionWasReset: false,
        })),
        isLifecycleOperationCurrent: jest.fn(async () => true),
        invalidateQrAttemptState: jest.fn(async () => undefined),
        assertPreservedSessionVolumeExists: jest.fn(async () => undefined),
        assertLifecycleOperationCurrent: jest.fn(async () => undefined),
        retryOperation: jest.fn(async (operation: () => Promise<unknown>) =>
          operation()
        ),
        removeRecreateRuntimeContainer: jest.fn(async () => ({
          status: 'removed',
          reason: 'test_removed',
        })),
        reserveNextWorkerRuntimeGeneration: jest.fn(async () => {
          throw stopAfterSessionDelete;
        }),
      });
      const lease: ILockLeaseContext = {
        signal: new AbortController().signal,
        assertActive: jest.fn(),
      };

      await expect(
        handler.performRecreateWorker(lifecycleData, lease)
      ).rejects.toBe(stopAfterSessionDelete);

      expect(
        runtimeRepository.deletePostgresWhatsappSessionByWorkerId
      ).toHaveBeenCalledWith({
        worker_id: lifecycleData.worker_id,
        account_id: lifecycleData.account_id,
        lifecycle_operation_id: lifecycleData.lifecycle_operation_id,
        expected_worker_status_id: EWorkerStatus.recreating,
        expected_runtime_generation: 41,
        expected_container_id: 'container-generation-41',
        expected_runtime_session_storage: EWorkerSessionStorage.postgres,
        expected_session_volume_name: null,
      });
    }
  );

  it('deletes a failed PostgreSQL migration shadow before a fresh legacy-volume conversion opens its pairing revision', async () => {
    const runtimeRepository = buildSelfHealRuntimeRepository(
      41,
      'container-generation-41'
    );
    const deps = buildHandler({
      workerRuntimeRepository: runtimeRepository,
    });
    const stopAfterSessionDelete = new Error('stop_after_legacy_shadow_delete');
    const lifecycleData: IWorkerPayload = {
      action: EWorkerAction.recreate,
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.whatsmeow,
      previous_worker_type_id: EWorkerType.whatsmeow,
      session_storage: EWorkerSessionStorage.postgres,
      previous_session_storage: EWorkerSessionStorage.legacy_volume,
      remove_session: true,
      remove_volume: true,
      lifecycle_operation_id: 'operation-legacy-reset-1',
    };
    const handler = deps.handler as unknown as {
      performRecreateWorker: (
        data: IWorkerPayload,
        lease: ILockLeaseContext
      ) => Promise<unknown>;
      resolveRecreateExecutionContext: jest.Mock;
      resolveStableWorkerImageContentId: jest.Mock;
      assertMissingJournalRecreateProviderSafe: jest.Mock;
      resolveRecreateSessionContext: jest.Mock;
      isLifecycleOperationCurrent: jest.Mock;
      invalidateQrAttemptState: jest.Mock;
      assertPreservedSessionVolumeExists: jest.Mock;
      assertLifecycleOperationCurrent: jest.Mock;
      resolveRecreateRuntimeRemovalDecision: jest.Mock;
      reserveNextWorkerRuntimeGeneration: jest.Mock;
    };
    Object.assign(handler, {
      resolveRecreateExecutionContext: jest.fn(async () => ({
        currentWorker: {
          worker_id: lifecycleData.worker_id,
          account_id: lifecycleData.account_id,
          server_id: lifecycleData.server_id,
          worker_type_id: lifecycleData.worker_type_id,
          worker_status_id: EWorkerStatus.recreating,
          lifecycle_operation_id: lifecycleData.lifecycle_operation_id,
          deleted_at: null,
        },
        workerType: lifecycleData.worker_type_id,
      })),
      resolveStableWorkerImageContentId: jest.fn(
        async () => WORKER_IMAGE_CONTENT_ID
      ),
      assertMissingJournalRecreateProviderSafe: jest.fn(async () => undefined),
      resolveRecreateSessionContext: jest.fn(async () => ({
        shouldRemoveSession: true,
        sessionStorage: EWorkerSessionStorage.postgres,
        shouldRemoveVolume: false,
        sessionVolumeResolution: {
          runtimeGeneration: 41,
          sessionDeletionRuntimeFence: {
            runtime_generation: 41,
            container_id: 'container-generation-41',
            session_storage: EWorkerSessionStorage.legacy_volume,
            session_volume_name: 'legacy-volume-1',
          },
          source: 'reset',
          runtimeWasBackfilled: false,
        },
        preservedSessionVolumeName: undefined,
        sessionWasReset: true,
      })),
      isLifecycleOperationCurrent: jest.fn(async () => true),
      invalidateQrAttemptState: jest.fn(async () => undefined),
      assertPreservedSessionVolumeExists: jest.fn(async () => undefined),
      assertLifecycleOperationCurrent: jest.fn(async () => undefined),
      resolveRecreateRuntimeRemovalDecision: jest.fn(async () => ({
        status: 'removed',
        reason: 'legacy_source_cleanup_committed',
      })),
      reserveNextWorkerRuntimeGeneration: jest.fn(async () => {
        throw stopAfterSessionDelete;
      }),
    });
    const lease: ILockLeaseContext = {
      signal: new AbortController().signal,
      assertActive: jest.fn(),
    };

    await expect(
      handler.performRecreateWorker(lifecycleData, lease)
    ).rejects.toBe(stopAfterSessionDelete);

    expect(
      runtimeRepository.deletePostgresWhatsappSessionByWorkerId
    ).toHaveBeenCalledWith({
      worker_id: lifecycleData.worker_id,
      account_id: lifecycleData.account_id,
      lifecycle_operation_id: lifecycleData.lifecycle_operation_id,
      expected_worker_status_id: EWorkerStatus.recreating,
      expected_runtime_generation: 41,
      expected_container_id: 'container-generation-41',
      expected_runtime_session_storage: EWorkerSessionStorage.legacy_volume,
      expected_session_volume_name: 'legacy-volume-1',
    });
  });

  it('passes the exact deleting lifecycle and runtime snapshot to permanent PostgreSQL session cleanup', async () => {
    const runtimeRepository = buildSelfHealRuntimeRepository(
      52,
      'container-generation-52'
    );
    runtimeRepository.viewByWorkerIdConsistent.mockResolvedValue({
      worker_id: 'worker-1',
      container_id: 'container-generation-52',
      container_name: 'worker-1',
      session_storage: EWorkerSessionStorage.postgres,
      session_volume_name: null,
      runtime_generation: 52,
      connection_sequence: 1,
    });
    const deps = buildHandler({
      workerRuntimeRepository: runtimeRepository,
    });
    const data: IWorkerPayload = {
      action: EWorkerAction.delete,
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      session_storage: EWorkerSessionStorage.postgres,
      lifecycle_operation_id: 'operation-delete-52',
      debug_trace_id: 'trace-delete-52',
    };
    const deletionRequest = {
      action: EWorkerAction.delete as const,
      worker_id: data.worker_id,
      account_id: data.account_id,
      lifecycle_operation_id: 'operation-delete-52',
      debug_trace_id: 'trace-delete-52',
    };

    await (
      deps.handler as unknown as {
        deleteWorker: (
          input: IWorkerPayload,
          request: typeof deletionRequest,
          authorization: { permanently_deleted: boolean }
        ) => Promise<unknown>;
      }
    ).deleteWorker(data, deletionRequest, { permanently_deleted: false });

    expect(
      runtimeRepository.deletePostgresWhatsappSessionByWorkerId
    ).toHaveBeenCalledWith({
      worker_id: data.worker_id,
      account_id: data.account_id,
      lifecycle_operation_id: deletionRequest.lifecycle_operation_id,
      expected_worker_status_id: EWorkerStatus.deleting,
      expected_runtime_generation: 52,
      expected_container_id: 'container-generation-52',
      expected_runtime_session_storage: EWorkerSessionStorage.postgres,
      expected_session_volume_name: null,
    });
    const terminalPayload = expect.objectContaining({
      event_type: 'status',
      code: ECodeMessage.info,
      status: EBaileysConnectionStatus.info,
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_status_id: EWorkerStatus.delete,
      lifecycle_operation_id: deletionRequest.lifecycle_operation_id,
      debug_trace_id: data.debug_trace_id,
      runtime_generation: 52,
    });
    expect(deps.centrifugoService.publishSubStrict).toHaveBeenCalledWith(
      'worker:account#account-1',
      terminalPayload
    );
    expect(deps.centrifugoService.publishStrict).toHaveBeenCalledWith(
      'channels:config',
      terminalPayload
    );
    expect(deps.centrifugoService.publishSub).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publish).not.toHaveBeenCalled();
  });

  it('propagates an unconfirmed terminal status publication before deleting Kafka topics', async () => {
    const deps = buildHandler();
    deps.centrifugoService.publishSubStrict.mockRejectedValueOnce(
      new Error('centrifugo unavailable')
    );

    await expect(
      handleWorkerCommand(deps, {
        action: EWorkerAction.delete,
        worker_id: 'worker-1',
        server_id: 'server-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
        lifecycle_operation_id: 'operation-delete-publication-1',
        debug_trace_id: 'trace-delete-publication-1',
      })
    ).rejects.toThrow('centrifugo unavailable');

    expect(deps.workerService.deleteWorkerById).toHaveBeenCalled();
    expect(
      deps.kafkaBaileysQueueService.deletePermanently
    ).not.toHaveBeenCalled();
  });

  it('retains the deleting fence so a Docker failure can be retried idempotently', async () => {
    const deps = buildHandler();
    const daemonError = Object.assign(new Error('docker daemon unavailable'), {
      statusCode: 500,
    });
    deps.workerService.removeContainerByNameAndVolume.mockRejectedValueOnce(
      daemonError
    );

    await expect(
      handleWorkerCommand(deps, {
        action: EWorkerAction.delete,
        worker_id: 'worker-1',
        server_id: 'server-1',
        account_id: 'account-1',
        lifecycle_operation_id: 'operation-delete-1',
        debug_trace_id: 'trace-delete-1',
      })
    ).rejects.toBe(daemonError);

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledTimes(1);
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.deleting,
      }),
      expect.objectContaining({
        lifecycle_operation_id: 'operation-delete-1',
        worker_status_id: EWorkerStatus.deleting,
      })
    );
    expect(deps.workerService.updateWorkerById).not.toHaveBeenCalled();
    expect(deps.workerService.deleteWorkerById).not.toHaveBeenCalled();
    expect(
      deps.kafkaBaileysQueueService.deletePermanently
    ).not.toHaveBeenCalled();
  });

  it('does not touch Docker, the database, or Kafka when permanent deletion intent is not authoritative', async () => {
    const deps = buildHandler();
    deps.workerTopicDeletionAuthorizerService.assertPermanentDeletionIntent.mockRejectedValueOnce(
      new Error(
        'worker_topic_deletion_not_authorized:lifecycle_operation_mismatch'
      )
    );

    await expect(
      handleWorkerCommand(deps, {
        action: EWorkerAction.delete,
        worker_id: 'worker-1',
        server_id: 'server-1',
        account_id: 'account-1',
        lifecycle_operation_id: 'operation-stale',
        debug_trace_id: 'trace-stale',
      })
    ).rejects.toThrow(
      'worker_topic_deletion_not_authorized:lifecycle_operation_mismatch'
    );

    expect(deps.workerService.removeContainerWorker).not.toHaveBeenCalled();
    expect(deps.workerService.deleteWorkerById).not.toHaveBeenCalled();
    expect(
      deps.kafkaBaileysQueueService.deletePermanently
    ).not.toHaveBeenCalled();
  });

  it('preserves topics when the tombstone cannot be revalidated immediately before Kafka deletion', async () => {
    const deps = buildHandler();
    deps.kafkaBaileysQueueService.deletePermanently.mockRejectedValueOnce(
      new Error('primary database unavailable')
    );

    await expect(
      handleWorkerCommand(deps, {
        action: EWorkerAction.delete,
        worker_id: 'worker-1',
        server_id: 'server-1',
        account_id: 'account-1',
        lifecycle_operation_id: 'operation-delete-1',
        debug_trace_id: 'trace-delete-1',
      })
    ).rejects.toThrow('primary database unavailable');

    expect(deps.workerService.deleteWorkerById).toHaveBeenCalled();
    expect(
      deps.kafkaBaileysQueueService.deletePermanently
    ).toHaveBeenCalledTimes(1);
  });

  it('keeps the permanent deletion fence when the database tombstone CAS fails after Docker removal', async () => {
    const deps = buildHandler();
    deps.workerService.deleteWorkerById.mockResolvedValue(false);
    Object.assign(deps.handler, {
      sleep: jest.fn(async () => undefined),
    });

    await expect(
      handleWorkerCommand(deps, {
        action: EWorkerAction.delete,
        worker_id: 'worker-1',
        server_id: 'server-1',
        account_id: 'account-1',
        lifecycle_operation_id: 'operation-delete-1',
        debug_trace_id: 'trace-delete-1',
      })
    ).rejects.toThrow('Failed to delete worker');

    expect(
      deps.workerService.removeContainerByNameAndVolume
    ).toHaveBeenCalled();
    expect(deps.workerService.deleteWorkerById).toHaveBeenCalled();
    expect(deps.workerService.updateWorkerById).not.toHaveBeenCalled();
    expect(
      deps.kafkaBaileysQueueService.deletePermanently
    ).not.toHaveBeenCalled();
  });
});

describe('WorkerCommandHandlerService runtime pointer reconciliation', () => {
  const staleContainerId = '1'.repeat(64);
  const runtimeContainerId = '2'.repeat(64);
  const runtimeGeneration = 58;
  const sessionVolumeName = 'worker-1';
  const lifecycleOperationId = 'operation-provider-change-1';
  const updatedAt = '2026-07-31T11:03:15.948Z';
  const payload: IWorkerPayload = {
    action: EWorkerAction.cleanup,
    worker_id: 'worker-1',
    account_id: 'account-1',
    server_id: 'server-1',
    worker_type_id: EWorkerType.wwebjs,
    previous_worker_type_id: EWorkerType.wwebjs,
    remove_session: true,
    remove_volume: true,
    session_storage: EWorkerSessionStorage.legacy_volume,
    lifecycle_operation_id: lifecycleOperationId,
  };
  const runtime = {
    worker_id: payload.worker_id,
    container_id: runtimeContainerId,
    container_name: payload.worker_id,
    session_storage: EWorkerSessionStorage.legacy_volume,
    session_volume_name: sessionVolumeName,
    runtime_generation: runtimeGeneration,
    connection_sequence: 1,
  };
  type PointerRepairRuntime = typeof runtime & {
    source_provider?: string | null;
  };
  const buildPointerRepairRuntime = (
    overrides: Partial<PointerRepairRuntime> = {}
  ): PointerRepairRuntime => ({ ...runtime, ...overrides });
  const buildCurrentProviderWorker = (
    containerId = staleContainerId
  ): IWorkerMonitor => ({
    worker_id: payload.worker_id,
    name: 'Canal 1',
    account_id: payload.account_id,
    server_id: payload.server_id,
    worker_status_id: EWorkerStatus.recreating,
    worker_type_id: EWorkerType.whatsmeow,
    session_storage: EWorkerSessionStorage.legacy_volume,
    created_at: '2026-01-07T18:08:53.431Z',
    updated_at: updatedAt,
    deleted_at: null,
    container_id: containerId,
    runtime_container_id: runtimeContainerId,
    runtime_generation: runtimeGeneration,
    runtime_session_volume_name: sessionVolumeName,
    lifecycle_operation_id: lifecycleOperationId,
    last_connection_check_at: null,
  });
  const buildRuntimeInspection = (
    input: IWorkerPayload,
    overrides: Partial<WorkerContainerInspection> = {}
  ): WorkerContainerInspection => {
    const workerType = input.worker_type_id ?? EWorkerType.wwebjs;
    return buildWorkerContainerInspection({
      container_id: runtimeContainerId,
      container_name: input.worker_id,
      container_labels: {
        'underchat.worker_id': input.worker_id,
        'underchat.account_id': input.account_id,
        'underchat.server_id': input.server_id,
        'underchat.worker_type_id': workerType,
        'underchat.runtime_generation': String(runtimeGeneration),
        'underchat.session_storage': EWorkerSessionStorage.legacy_volume,
        'underchat.session_volume_name': sessionVolumeName,
      },
      container_env: {
        WORKER_ID: input.worker_id,
        ACCOUNT_ID: input.account_id,
        SERVER_ID: input.server_id,
        WORKER_TYPE_ID: workerType,
        RUNTIME_GENERATION: String(runtimeGeneration),
        WORKER_SESSION_STORAGE: EWorkerSessionStorage.legacy_volume,
        SESSION_VOLUME_NAME: sessionVolumeName,
      },
      container_mounts: [
        {
          destination: '/app/data',
          name: sessionVolumeName,
          read_write: true,
          type: 'volume',
        },
      ],
      ...overrides,
    });
  };
  const buildPreviousProviderRuntimeInspection = (
    overrides: Partial<WorkerContainerInspection> = {}
  ): WorkerContainerInspection => buildRuntimeInspection(payload, overrides);
  const removeWithLifecycleProof = (
    deps: ReturnType<typeof buildHandler>,
    worker: IWorkerMonitor,
    leaseContext: ILockLeaseContext,
    input: IWorkerPayload = payload,
    removeVolume = true
  ): Promise<boolean> =>
    (
      deps.handler as unknown as {
        removeRuntimeContainerWithLifecycleProof: (
          data: IWorkerPayload,
          removeVolume: boolean,
          initialWorker: IWorkerMonitor,
          lease: ILockLeaseContext
        ) => Promise<boolean>;
      }
    ).removeRuntimeContainerWithLifecycleProof(
      {
        ...input,
        session_storage: input.session_storage ?? worker.session_storage,
      },
      removeVolume,
      worker,
      leaseContext
    );
  const buildPointerRepairHarness = (options: {
    input: IWorkerPayload;
    worker: IWorkerMonitor;
    runtimeRow?: PointerRepairRuntime;
    runtimeInspection?: WorkerContainerInspection;
    runtimeExists?: boolean;
    casResult?: boolean;
    rereadWorker?: IWorkerMonitor;
  }) => {
    const runtimeRow =
      options.runtimeRow ??
      buildPointerRepairRuntime({ source_provider: null });
    const workerRuntimeRepository = buildSelfHealRuntimeRepository(
      runtimeRow.runtime_generation,
      runtimeRow.container_id
    );
    workerRuntimeRepository.viewByWorkerId.mockResolvedValue(runtimeRow);
    workerRuntimeRepository.viewByWorkerIdConsistent.mockResolvedValue(
      runtimeRow
    );
    const deps = buildHandler({ workerRuntimeRepository });
    let currentWorker = options.worker;
    let runtimeRemoved = false;
    deps.workerService.viewWorkerForMonitor.mockImplementation(async () =>
      options.rereadWorker ? options.rereadWorker : currentWorker
    );
    deps.workerService.inspectContainerWorkerByIdStrict.mockImplementation(
      async (containerId: string) => {
        if (containerId === options.worker.container_id) {
          return { exists: false, container_name: options.input.worker_id };
        }
        if (
          containerId === runtimeRow.container_id &&
          options.runtimeExists !== false
        ) {
          return (
            options.runtimeInspection ?? buildRuntimeInspection(options.input)
          );
        }
        return { exists: false, container_name: options.input.worker_id };
      }
    );
    deps.workerService.updateWorkerByIdIfLifecycleMatches.mockImplementation(
      async (_accountId: string, update: unknown) => {
        const repairedContainerId = (update as { container_id?: string })
          .container_id;
        const repaired = options.casResult !== false;
        if (repaired) {
          currentWorker = {
            ...currentWorker,
            container_id: repairedContainerId ?? currentWorker.container_id,
          };
        }
        return repaired;
      }
    );
    deps.workerService.listContainerIdsMountingVolumeStrict.mockImplementation(
      async () =>
        options.runtimeExists !== false && !runtimeRemoved
          ? [runtimeRow.container_id]
          : []
    );
    deps.workerService.removeContainerWorkerById.mockImplementation(
      async () => {
        runtimeRemoved = true;
        return true;
      }
    );
    const leaseContext: ILockLeaseContext = {
      signal: new AbortController().signal,
      assertActive: jest.fn(),
    };

    return { deps, leaseContext };
  };

  const reservedRuntimeCases = [
    {
      workerType: EWorkerType.baileys,
      sourceProvider: 'baileys',
      image: 'under-worker-baileys:latest',
      grpcPort: '50052',
    },
    {
      workerType: EWorkerType.wwebjs,
      sourceProvider: 'wwebjs',
      image: 'under-worker-wwebjs:latest',
      grpcPort: '50053',
    },
    {
      workerType: EWorkerType.whatsmeow,
      sourceProvider: 'whatsmeow',
      image: 'under-worker-whatsmeow:latest',
      grpcPort: '50054',
    },
  ] as const;
  const buildReservedRuntimeRemovalHarness = (options: {
    workerType: EWorkerType;
    sourceProvider: string;
    image: string;
    grpcPort: string;
    runtimeExists?: boolean;
    namedContainerExists?: boolean;
    volumeExists?: boolean;
    mountOwners?: string[];
    controlContainerExists?: boolean;
    action?: EWorkerAction.recreate | EWorkerAction.cleanup;
    currentWorkerType?: EWorkerType;
    currentServerId?: string;
    currentSessionStorage?: EWorkerSessionStorage;
    warmPoolId?: string;
    inspectionOverrides?: Partial<WorkerContainerInspection>;
  }) => {
    const action = options.action ?? EWorkerAction.recreate;
    const removalPayload: IWorkerPayload = {
      action,
      worker_id: payload.worker_id,
      account_id: payload.account_id,
      server_id: payload.server_id,
      worker_type_id: options.workerType,
      ...(action === EWorkerAction.cleanup
        ? { previous_worker_type_id: options.workerType }
        : {}),
      remove_session: true,
      remove_volume: true,
      session_storage: EWorkerSessionStorage.legacy_volume,
      lifecycle_operation_id: lifecycleOperationId,
    };
    const runtimeSessionVolumeName = options.warmPoolId
      ? `warm-${options.warmPoolId}`
      : sessionVolumeName;
    let currentRuntime: IWorkerRuntime | null =
      options.runtimeExists === false
        ? null
        : {
            worker_id: removalPayload.worker_id,
            container_id: null,
            container_name: removalPayload.worker_id,
            session_storage: EWorkerSessionStorage.legacy_volume,
            session_volume_name: runtimeSessionVolumeName,
            runtime_generation: runtimeGeneration,
            connection_sequence: 1,
            warm_pool_id: options.warmPoolId ?? null,
            source_provider: options.sourceProvider,
          };
    let controlContainerId = staleContainerId;
    let runtimeRemoved = false;
    const buildWorker = (): IWorkerMonitor => ({
      worker_id: removalPayload.worker_id,
      name: 'Reserved runtime channel',
      account_id: removalPayload.account_id,
      server_id: options.currentServerId ?? removalPayload.server_id,
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: options.currentWorkerType ?? options.workerType,
      session_storage:
        options.currentSessionStorage ?? EWorkerSessionStorage.legacy_volume,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: updatedAt,
      deleted_at: null,
      container_id: controlContainerId,
      runtime_container_id: currentRuntime?.container_id ?? null,
      runtime_generation: currentRuntime?.runtime_generation ?? null,
      runtime_session_volume_name: currentRuntime?.session_volume_name ?? null,
      lifecycle_operation_id: lifecycleOperationId,
      last_connection_check_at: null,
    });
    const inspection = buildWorkerContainerInspection({
      container_id: runtimeContainerId,
      container_name: removalPayload.worker_id,
      container_image: options.image,
      container_image_id: WORKER_IMAGE_CONTENT_ID,
      container_labels: {
        'underchat.worker_id': removalPayload.worker_id,
        'underchat.account_id': removalPayload.account_id,
        'underchat.server_id': removalPayload.server_id,
        'underchat.worker_type_id': options.workerType,
        'underchat.runtime_generation': String(runtimeGeneration),
        'underchat.session_storage': EWorkerSessionStorage.legacy_volume,
        'underchat.lifecycle_operation_id': lifecycleOperationId,
        'underchat.session_volume_name': runtimeSessionVolumeName,
        'underchat.worker_image': options.image,
        'underchat.worker_image_content_id': WORKER_IMAGE_CONTENT_ID,
        'underchat.worker_grpc_port': options.grpcPort,
        ...(options.warmPoolId
          ? {
              'underchat.warm_pool_id': options.warmPoolId,
              'underchat.warm_standby': 'false',
            }
          : {}),
      },
      container_env: {
        WORKER_ID: removalPayload.worker_id,
        ACCOUNT_ID: removalPayload.account_id,
        SERVER_ID: removalPayload.server_id,
        WORKER_TYPE_ID: options.workerType,
        RUNTIME_GENERATION: String(runtimeGeneration),
        WORKER_SESSION_STORAGE: EWorkerSessionStorage.legacy_volume,
        SESSION_VOLUME_NAME: runtimeSessionVolumeName,
        WORKER_IMAGE: options.image,
        WORKER_GRPC_PORT: options.grpcPort,
        ...(options.warmPoolId
          ? {
              WARM_POOL_ID: options.warmPoolId,
              WARM_STANDBY: 'false',
            }
          : {}),
      },
      container_mounts: [
        {
          destination: '/app/data',
          name: runtimeSessionVolumeName,
          read_write: true,
          type: 'volume',
        },
      ],
      ...options.inspectionOverrides,
    });
    const workerRuntimeRepository = buildSelfHealRuntimeRepository(
      runtimeGeneration,
      runtimeContainerId
    );
    (workerRuntimeRepository.viewByWorkerId as jest.Mock).mockImplementation(
      async () => currentRuntime
    );
    (
      workerRuntimeRepository.viewByWorkerIdConsistent as jest.Mock
    ).mockImplementation(async () => currentRuntime);
    const claimRuntimeContainer = async (claim: {
      container_id: string;
    }): Promise<boolean> => {
      if (!currentRuntime || currentRuntime.container_id) {
        return false;
      }
      currentRuntime = {
        ...currentRuntime,
        container_id: claim.container_id,
      };
      return true;
    };
    (
      workerRuntimeRepository.claimReservedRuntimeContainer as jest.Mock
    ).mockImplementation(claimRuntimeContainer);
    (
      workerRuntimeRepository.claimPreviousRuntimeContainer as jest.Mock
    ).mockImplementation(claimRuntimeContainer);
    const deps = buildHandler({ workerRuntimeRepository });
    deps.workerService.viewWorkerForMonitor.mockImplementation(async () =>
      buildWorker()
    );
    deps.workerService.inspectContainerWorkerByIdStrict.mockImplementation(
      async (containerId: string) => {
        if (
          containerId === staleContainerId &&
          options.controlContainerExists === true
        ) {
          return buildWorkerContainerInspection({
            container_id: staleContainerId,
            container_name: 'renamed-stale-runtime',
          });
        }
        if (
          (containerId === removalPayload.worker_id ||
            containerId === runtimeContainerId) &&
          options.namedContainerExists !== false &&
          !runtimeRemoved
        ) {
          return inspection;
        }
        return {
          exists: false,
          container_name: removalPayload.worker_id,
        };
      }
    );
    deps.workerService.inspectVolumeByNameStrict.mockResolvedValue({
      exists: options.volumeExists !== false,
      name: runtimeSessionVolumeName,
      signature: `signature:${runtimeSessionVolumeName}`,
    });
    deps.workerService.listContainerIdsMountingVolumeStrict.mockImplementation(
      async () => {
        if (runtimeRemoved || options.namedContainerExists === false) {
          return options.mountOwners ?? [];
        }
        return options.mountOwners ?? [runtimeContainerId];
      }
    );
    deps.workerService.updateWorkerByIdIfLifecycleMatches.mockImplementation(
      async (_accountId: string, update: unknown) => {
        controlContainerId =
          (update as { container_id?: string }).container_id ??
          controlContainerId;
        return true;
      }
    );
    deps.workerService.removeContainerWorkerById.mockImplementation(
      async () => {
        runtimeRemoved = true;
        return true;
      }
    );
    const leaseContext: ILockLeaseContext = {
      signal: new AbortController().signal,
      assertActive: jest.fn(),
    };

    return {
      deps,
      input: removalPayload,
      leaseContext,
      runtimeSessionVolumeName,
      worker: buildWorker(),
      workerRuntimeRepository,
    };
  };

  it.each(reservedRuntimeCases)(
    'claims and removes a strongly proven reserved $sourceProvider runtime after the DB pointer crash window',
    async ({ workerType, sourceProvider, image, grpcPort }) => {
      const harness = buildReservedRuntimeRemovalHarness({
        workerType,
        sourceProvider,
        image,
        grpcPort,
      });

      await expect(
        removeWithLifecycleProof(
          harness.deps,
          harness.worker,
          harness.leaseContext,
          harness.input
        )
      ).resolves.toBe(true);

      expect(
        harness.workerRuntimeRepository.claimReservedRuntimeContainer
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          worker_id: harness.input.worker_id,
          container_id: runtimeContainerId,
          runtime_generation: runtimeGeneration,
          session_volume_name: sessionVolumeName,
        })
      );
      expect(
        harness.deps.workerService.removeContainerWorkerById
      ).toHaveBeenCalledWith(runtimeContainerId);
      expect(
        harness.deps.workerService.removeWorkerVolumeByProof
      ).toHaveBeenCalledWith(
        sessionVolumeName,
        `signature:${sessionVolumeName}`
      );
    }
  );

  it('claims and removes the previous-provider reserved runtime during authoritative cleanup', async () => {
    const harness = buildReservedRuntimeRemovalHarness({
      ...reservedRuntimeCases[1],
      action: EWorkerAction.cleanup,
      currentWorkerType: EWorkerType.whatsmeow,
      currentServerId: 'server-new',
    });

    await expect(
      removeWithLifecycleProof(
        harness.deps,
        harness.worker,
        harness.leaseContext,
        harness.input
      )
    ).resolves.toBe(true);

    expect(
      harness.workerRuntimeRepository.claimPreviousRuntimeContainer
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        current_server_id: harness.worker.server_id,
        current_worker_type_id: EWorkerType.whatsmeow,
        previous_server_id: harness.input.server_id,
        previous_worker_type_id: EWorkerType.wwebjs,
        remove_session: true,
        remove_volume: true,
        source_provider: 'wwebjs',
      })
    );
    expect(
      harness.workerRuntimeRepository.claimReservedRuntimeContainer
    ).not.toHaveBeenCalled();
    expect(
      harness.deps.workerService.removeContainerWorkerById
    ).toHaveBeenCalledWith(runtimeContainerId);
  });

  it('proves and removes the retired legacy volume after its target row has switched to PostgreSQL', async () => {
    const harness = buildReservedRuntimeRemovalHarness({
      ...reservedRuntimeCases[1],
      action: EWorkerAction.cleanup,
      currentWorkerType: EWorkerType.whatsmeow,
      currentServerId: 'server-target',
      currentSessionStorage: EWorkerSessionStorage.postgres,
    });
    const conversionCleanup: IWorkerPayload = {
      ...harness.input,
      session_storage: EWorkerSessionStorage.postgres,
      previous_session_storage: EWorkerSessionStorage.legacy_volume,
    };

    await expect(
      removeWithLifecycleProof(
        harness.deps,
        harness.worker,
        harness.leaseContext,
        conversionCleanup
      )
    ).resolves.toBe(true);

    expect(
      harness.workerRuntimeRepository.claimPreviousRuntimeContainer
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        current_server_id: 'server-target',
        current_worker_type_id: EWorkerType.whatsmeow,
        previous_server_id: conversionCleanup.server_id,
        previous_worker_type_id: EWorkerType.wwebjs,
        session_storage: EWorkerSessionStorage.legacy_volume,
        remove_session: true,
        remove_volume: true,
      })
    );
    expect(
      harness.deps.workerService.removeContainerWorkerById
    ).toHaveBeenCalledWith(runtimeContainerId);
    expect(
      harness.deps.workerService.removeWorkerVolumeByProof
    ).toHaveBeenCalledWith(
      harness.runtimeSessionVolumeName,
      `signature:${harness.runtimeSessionVolumeName}`
    );
  });

  it('leaves a null-pointer warm activation to its dedicated activation recovery path', async () => {
    const warmPoolId = '019fb9ff-1111-7222-8333-444444444444';
    const harness = buildReservedRuntimeRemovalHarness({
      ...reservedRuntimeCases[0],
      warmPoolId,
    });

    await expect(
      removeWithLifecycleProof(
        harness.deps,
        harness.worker,
        harness.leaseContext,
        harness.input
      )
    ).rejects.toThrow('worker_runtime_removal_immutable_identity_missing');

    expect(
      harness.workerRuntimeRepository.claimReservedRuntimeContainer
    ).not.toHaveBeenCalled();
    expect(
      harness.workerRuntimeRepository.claimPreviousRuntimeContainer
    ).not.toHaveBeenCalled();
    expect(
      harness.deps.workerService.removeContainerWorkerById
    ).not.toHaveBeenCalled();
    expect(
      harness.deps.workerService.removeWorkerVolumeByProof
    ).not.toHaveBeenCalled();
  });

  it.each(reservedRuntimeCases)(
    'claims and force-removes an exact exited $sourceProvider reserved runtime',
    async ({ workerType, sourceProvider, image, grpcPort }) => {
      const harness = buildReservedRuntimeRemovalHarness({
        workerType,
        sourceProvider,
        image,
        grpcPort,
        inspectionOverrides: {
          container_state: 'exited',
          container_status: 'exited',
          running: false,
        },
      });

      await expect(
        removeWithLifecycleProof(
          harness.deps,
          harness.worker,
          harness.leaseContext,
          harness.input
        )
      ).resolves.toBe(true);

      expect(
        harness.workerRuntimeRepository.claimReservedRuntimeContainer
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          container_id: runtimeContainerId,
          source_provider: sourceProvider,
        })
      );
      expect(
        harness.deps.workerService.removeContainerWorkerById
      ).toHaveBeenCalledWith(runtimeContainerId);
    }
  );

  it('fails closed when a named reserved container has a foreign immutable identity', async () => {
    const harness = buildReservedRuntimeRemovalHarness({
      ...reservedRuntimeCases[1],
      inspectionOverrides: {
        container_labels: {
          ...buildWorkerContainerInspection().container_labels,
          'underchat.worker_id': payload.worker_id,
          'underchat.account_id': 'foreign-account',
        },
      },
    });

    await expect(
      removeWithLifecycleProof(
        harness.deps,
        harness.worker,
        harness.leaseContext,
        harness.input
      )
    ).rejects.toThrow(
      'worker_runtime_removal_immutable_identity_conflict:account_id'
    );

    expect(
      harness.workerRuntimeRepository.claimReservedRuntimeContainer
    ).not.toHaveBeenCalled();
    expect(
      harness.deps.workerService.removeContainerWorkerById
    ).not.toHaveBeenCalled();
    expect(
      harness.deps.workerService.removeWorkerVolumeByProof
    ).not.toHaveBeenCalled();
  });

  it('fails closed when the reserved volume has ambiguous mount owners', async () => {
    const harness = buildReservedRuntimeRemovalHarness({
      ...reservedRuntimeCases[1],
      mountOwners: [runtimeContainerId, '3'.repeat(64)],
    });

    await expect(
      removeWithLifecycleProof(
        harness.deps,
        harness.worker,
        harness.leaseContext,
        harness.input
      )
    ).rejects.toThrow('worker_runtime_removal_volume_owner_changed');

    expect(
      harness.workerRuntimeRepository.claimReservedRuntimeContainer
    ).not.toHaveBeenCalled();
    expect(
      harness.deps.workerService.removeContainerWorkerById
    ).not.toHaveBeenCalled();
  });

  it.each([
    { runtimeExists: false, caseName: 'missing runtime row' },
    { runtimeExists: true, caseName: 'unclaimed runtime row' },
  ])(
    'completes an idempotent reset when both Docker resources are absent with a $caseName',
    async ({ runtimeExists }) => {
      const harness = buildReservedRuntimeRemovalHarness({
        ...reservedRuntimeCases[0],
        runtimeExists,
        namedContainerExists: false,
        volumeExists: false,
      });

      await expect(
        removeWithLifecycleProof(
          harness.deps,
          harness.worker,
          harness.leaseContext,
          harness.input
        )
      ).resolves.toBe(true);

      expect(
        harness.deps.workerService.removeContainerWorkerById
      ).not.toHaveBeenCalled();
      expect(
        harness.deps.workerService.removeWorkerVolumeByProof
      ).not.toHaveBeenCalled();
    }
  );

  it('preserves an unclaimed volume that is still mounted when its named container is absent', async () => {
    const harness = buildReservedRuntimeRemovalHarness({
      ...reservedRuntimeCases[0],
      namedContainerExists: false,
      volumeExists: true,
      mountOwners: ['foreign-container'],
    });

    await expect(
      removeWithLifecycleProof(
        harness.deps,
        harness.worker,
        harness.leaseContext,
        harness.input
      )
    ).rejects.toThrow('worker_runtime_removal_volume_still_mounted');

    expect(
      harness.deps.workerService.removeWorkerVolumeByProof
    ).not.toHaveBeenCalled();
  });

  it('fails closed when the canonical name is absent but the durable control container still exists', async () => {
    const harness = buildReservedRuntimeRemovalHarness({
      ...reservedRuntimeCases[1],
      namedContainerExists: false,
      volumeExists: false,
      controlContainerExists: true,
    });

    await expect(
      removeWithLifecycleProof(
        harness.deps,
        harness.worker,
        harness.leaseContext,
        harness.input
      )
    ).rejects.toThrow('worker_runtime_removal_stale_control_still_exists');

    expect(
      harness.deps.workerService.inspectContainerWorkerByIdStrict
    ).toHaveBeenCalledWith(staleContainerId);
    expect(
      harness.deps.workerService.removeWorkerVolumeByProof
    ).not.toHaveBeenCalled();
  });

  it('repairs an absent stale control pointer with CAS before removing the previous-provider runtime', async () => {
    const workerRuntimeRepository = buildSelfHealRuntimeRepository(
      runtimeGeneration,
      runtimeContainerId
    );
    workerRuntimeRepository.viewByWorkerId.mockResolvedValue(runtime);
    workerRuntimeRepository.viewByWorkerIdConsistent.mockResolvedValue(runtime);
    const deps = buildHandler({ workerRuntimeRepository });
    let currentWorker = buildCurrentProviderWorker();
    let runtimeRemoved = false;
    deps.workerService.viewWorkerForMonitor.mockImplementation(
      async () => currentWorker
    );
    deps.workerService.inspectContainerWorkerByIdStrict.mockImplementation(
      async (containerId: string) =>
        containerId === staleContainerId
          ? { exists: false, container_name: payload.worker_id }
          : buildPreviousProviderRuntimeInspection()
    );
    deps.workerService.updateWorkerByIdIfLifecycleMatches.mockImplementation(
      async (_accountId: string, input: unknown) => {
        const containerId = (input as { container_id?: string }).container_id;
        currentWorker = {
          ...currentWorker,
          container_id: containerId ?? currentWorker.container_id,
        };
        return true;
      }
    );
    deps.workerService.listContainerIdsMountingVolumeStrict.mockImplementation(
      async () => (runtimeRemoved ? [] : [runtimeContainerId])
    );
    deps.workerService.removeContainerWorkerById.mockImplementation(
      async () => {
        runtimeRemoved = true;
        return true;
      }
    );
    const leaseContext: ILockLeaseContext = {
      signal: new AbortController().signal,
      assertActive: jest.fn(),
    };

    await expect(
      removeWithLifecycleProof(deps, buildCurrentProviderWorker(), leaseContext)
    ).resolves.toBe(true);

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      payload.account_id,
      {
        worker_id: payload.worker_id,
        container_id: runtimeContainerId,
      },
      {
        lifecycle_operation_id: lifecycleOperationId,
        container_id: staleContainerId,
        runtime_container_id: runtimeContainerId,
        runtime_generation: runtimeGeneration,
        runtime_session_volume_name: sessionVolumeName,
        server_id: payload.server_id,
        worker_type_id: EWorkerType.whatsmeow,
        worker_status_id: EWorkerStatus.recreating,
        updated_at: updatedAt,
      }
    );
    expect(deps.workerService.removeContainerWorkerById).toHaveBeenCalledWith(
      runtimeContainerId
    );
    expect(deps.workerService.removeWorkerVolumeByProof).toHaveBeenCalledWith(
      sessionVolumeName,
      `signature:${sessionVolumeName}`
    );
  });

  it('repairs the pointer and removes only the proven volume after a partial cleanup already removed both containers', async () => {
    const workerRuntimeRepository = buildSelfHealRuntimeRepository(
      runtimeGeneration,
      runtimeContainerId
    );
    workerRuntimeRepository.viewByWorkerId.mockResolvedValue(runtime);
    workerRuntimeRepository.viewByWorkerIdConsistent.mockResolvedValue(runtime);
    const deps = buildHandler({ workerRuntimeRepository });
    let currentWorker = buildCurrentProviderWorker();
    deps.workerService.viewWorkerForMonitor.mockImplementation(
      async () => currentWorker
    );
    deps.workerService.inspectContainerWorkerByIdStrict.mockImplementation(
      async (containerId: string) => ({
        exists: false,
        container_name:
          containerId === runtimeContainerId
            ? runtime.container_name
            : payload.worker_id,
      })
    );
    deps.workerService.updateWorkerByIdIfLifecycleMatches.mockImplementation(
      async (_accountId: string, input: unknown) => {
        const containerId = (input as { container_id?: string }).container_id;
        currentWorker = {
          ...currentWorker,
          container_id: containerId ?? currentWorker.container_id,
        };
        return true;
      }
    );
    const leaseContext: ILockLeaseContext = {
      signal: new AbortController().signal,
      assertActive: jest.fn(),
    };

    await expect(
      removeWithLifecycleProof(deps, buildCurrentProviderWorker(), leaseContext)
    ).resolves.toBe(true);

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      payload.account_id,
      {
        worker_id: payload.worker_id,
        container_id: runtimeContainerId,
      },
      expect.objectContaining({
        lifecycle_operation_id: lifecycleOperationId,
        container_id: staleContainerId,
        runtime_container_id: runtimeContainerId,
        runtime_generation: runtimeGeneration,
        runtime_session_volume_name: sessionVolumeName,
      })
    );
    expect(
      deps.workerService.inspectContainerWorkerByIdStrict
    ).toHaveBeenCalledWith(staleContainerId);
    expect(
      deps.workerService.inspectContainerWorkerByIdStrict
    ).toHaveBeenCalledWith(runtimeContainerId);
    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
    expect(deps.workerService.removeWorkerVolumeByProof).toHaveBeenCalledWith(
      sessionVolumeName,
      `signature:${sessionVolumeName}`
    );
  });

  it('repairs a stale pointer during a regular recreate on the same server and provider', async () => {
    const recreatePayload: IWorkerPayload = {
      action: EWorkerAction.recreate,
      worker_id: payload.worker_id,
      account_id: payload.account_id,
      server_id: payload.server_id,
      worker_type_id: EWorkerType.wwebjs,
      remove_session: true,
      remove_volume: true,
      lifecycle_operation_id: lifecycleOperationId,
    };
    const worker: IWorkerMonitor = {
      ...buildCurrentProviderWorker(),
      worker_type_id: EWorkerType.wwebjs,
    };
    const { deps, leaseContext } = buildPointerRepairHarness({
      input: recreatePayload,
      worker,
      runtimeRow: buildPointerRepairRuntime({ source_provider: 'wwebjs' }),
    });

    await expect(
      removeWithLifecycleProof(deps, worker, leaseContext, recreatePayload)
    ).resolves.toBe(true);

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      recreatePayload.account_id,
      {
        worker_id: recreatePayload.worker_id,
        container_id: runtimeContainerId,
      },
      expect.objectContaining({
        container_id: staleContainerId,
        server_id: recreatePayload.server_id,
        worker_type_id: recreatePayload.worker_type_id,
      })
    );
    expect(deps.workerService.removeContainerWorkerById).toHaveBeenCalledWith(
      runtimeContainerId
    );
    expect(deps.workerService.removeWorkerVolumeByProof).toHaveBeenCalledWith(
      sessionVolumeName,
      `signature:${sessionVolumeName}`
    );
  });

  it('repairs a stale pointer during a session-preserving recreate', async () => {
    const recreatePayload: IWorkerPayload = {
      action: EWorkerAction.recreate,
      worker_id: payload.worker_id,
      account_id: payload.account_id,
      server_id: payload.server_id,
      worker_type_id: EWorkerType.whatsmeow,
      remove_session: false,
      remove_volume: false,
      lifecycle_operation_id: lifecycleOperationId,
    };
    const worker: IWorkerMonitor = {
      ...buildCurrentProviderWorker(),
      worker_type_id: EWorkerType.whatsmeow,
    };
    const { deps, leaseContext } = buildPointerRepairHarness({
      input: recreatePayload,
      worker,
      runtimeRow: buildPointerRepairRuntime({ source_provider: 'whatsmeow' }),
    });

    await expect(
      removeWithLifecycleProof(
        deps,
        worker,
        leaseContext,
        recreatePayload,
        false
      )
    ).resolves.toBe(true);

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      recreatePayload.account_id,
      {
        worker_id: recreatePayload.worker_id,
        container_id: runtimeContainerId,
      },
      expect.objectContaining({
        container_id: staleContainerId,
        runtime_container_id: runtimeContainerId,
        runtime_generation: runtimeGeneration,
        server_id: recreatePayload.server_id,
        worker_type_id: recreatePayload.worker_type_id,
      })
    );
    expect(deps.workerService.removeContainerWorkerById).toHaveBeenCalledWith(
      runtimeContainerId
    );
    expect(deps.workerService.removeWorkerVolumeByProof).not.toHaveBeenCalled();
  });

  it('repairs and removes the previous runtime during a server-only move', async () => {
    const previousServerPayload: IWorkerPayload = {
      action: EWorkerAction.cleanup,
      worker_id: payload.worker_id,
      account_id: payload.account_id,
      server_id: 'server-old',
      worker_type_id: EWorkerType.wwebjs,
      previous_worker_type_id: EWorkerType.wwebjs,
      remove_session: true,
      remove_volume: true,
      lifecycle_operation_id: lifecycleOperationId,
    };
    const worker: IWorkerMonitor = {
      ...buildCurrentProviderWorker(),
      server_id: 'server-new',
      worker_type_id: EWorkerType.wwebjs,
    };
    const { deps, leaseContext } = buildPointerRepairHarness({
      input: previousServerPayload,
      worker,
      runtimeRow: buildPointerRepairRuntime({ source_provider: 'wwebjs' }),
    });

    await expect(
      removeWithLifecycleProof(
        deps,
        worker,
        leaseContext,
        previousServerPayload
      )
    ).resolves.toBe(true);

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      previousServerPayload.account_id,
      {
        worker_id: previousServerPayload.worker_id,
        container_id: runtimeContainerId,
      },
      expect.objectContaining({
        container_id: staleContainerId,
        server_id: worker.server_id,
        worker_type_id: EWorkerType.wwebjs,
      })
    );
    expect(deps.workerService.removeContainerWorkerById).toHaveBeenCalledWith(
      runtimeContainerId
    );
    expect(deps.workerService.removeWorkerVolumeByProof).toHaveBeenCalled();
  });

  it('fails closed when a simultaneous server and provider move has a divergent runtime source provider', async () => {
    const previousRuntimePayload: IWorkerPayload = {
      action: EWorkerAction.cleanup,
      worker_id: payload.worker_id,
      account_id: payload.account_id,
      server_id: 'server-old',
      worker_type_id: EWorkerType.wwebjs,
      previous_worker_type_id: EWorkerType.wwebjs,
      remove_session: true,
      remove_volume: true,
      lifecycle_operation_id: lifecycleOperationId,
    };
    const worker: IWorkerMonitor = {
      ...buildCurrentProviderWorker(),
      server_id: 'server-new',
      worker_type_id: EWorkerType.whatsmeow,
    };
    const { deps, leaseContext } = buildPointerRepairHarness({
      input: previousRuntimePayload,
      worker,
      runtimeRow: buildPointerRepairRuntime({ source_provider: 'baileys' }),
    });

    await expect(
      removeWithLifecycleProof(
        deps,
        worker,
        leaseContext,
        previousRuntimePayload
      )
    ).rejects.toThrow('worker_runtime_removal_database_fence_changed');

    expect(
      deps.workerService.inspectContainerWorkerByIdStrict
    ).not.toHaveBeenCalled();
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
    expect(deps.workerService.removeWorkerVolumeByProof).not.toHaveBeenCalled();
  });

  it('fails closed after a lost CAS when the authoritative joined runtime changes before reread', async () => {
    const recreatePayload: IWorkerPayload = {
      action: EWorkerAction.recreate,
      worker_id: payload.worker_id,
      account_id: payload.account_id,
      server_id: payload.server_id,
      worker_type_id: EWorkerType.wwebjs,
      remove_session: true,
      remove_volume: true,
      lifecycle_operation_id: lifecycleOperationId,
    };
    const worker: IWorkerMonitor = {
      ...buildCurrentProviderWorker(),
      worker_type_id: EWorkerType.wwebjs,
    };
    const rereadWorker: IWorkerMonitor = {
      ...worker,
      container_id: runtimeContainerId,
      runtime_generation: runtimeGeneration + 1,
    };
    const { deps, leaseContext } = buildPointerRepairHarness({
      input: recreatePayload,
      worker,
      runtimeRow: buildPointerRepairRuntime({ source_provider: 'wwebjs' }),
      casResult: false,
      rereadWorker,
    });

    await expect(
      removeWithLifecycleProof(deps, worker, leaseContext, recreatePayload)
    ).rejects.toThrow('worker_runtime_removal_pointer_repair_raced');

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledTimes(1);
    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
    expect(deps.workerService.removeWorkerVolumeByProof).not.toHaveBeenCalled();
  });

  it('fails closed when the stale control pointer still resolves to a container', async () => {
    const workerRuntimeRepository = buildSelfHealRuntimeRepository(
      runtimeGeneration,
      runtimeContainerId
    );
    workerRuntimeRepository.viewByWorkerIdConsistent.mockResolvedValue(runtime);
    const deps = buildHandler({ workerRuntimeRepository });
    deps.workerService.inspectContainerWorkerByIdStrict.mockResolvedValue(
      buildWorkerContainerInspection({
        container_id: staleContainerId,
        container_name: payload.worker_id,
      })
    );
    const worker = buildCurrentProviderWorker();
    const leaseContext: ILockLeaseContext = {
      signal: new AbortController().signal,
      assertActive: jest.fn(),
    };

    await expect(
      removeWithLifecycleProof(deps, worker, leaseContext)
    ).rejects.toThrow('worker_runtime_removal_stale_control_still_exists');

    expect(
      deps.workerService.inspectContainerWorkerByIdStrict
    ).toHaveBeenCalledTimes(1);
    expect(
      deps.workerService.inspectContainerWorkerByIdStrict
    ).toHaveBeenCalledWith(staleContainerId);
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
    expect(deps.workerService.removeWorkerVolumeByProof).not.toHaveBeenCalled();
  });

  it('fails closed when the runtime Docker identity belongs to a different provider', async () => {
    const workerRuntimeRepository = buildSelfHealRuntimeRepository(
      runtimeGeneration,
      runtimeContainerId
    );
    workerRuntimeRepository.viewByWorkerIdConsistent.mockResolvedValue(runtime);
    const deps = buildHandler({ workerRuntimeRepository });
    deps.workerService.inspectContainerWorkerByIdStrict.mockImplementation(
      async (containerId: string) => {
        if (containerId === staleContainerId) {
          return { exists: false, container_name: payload.worker_id };
        }
        const inspection = buildPreviousProviderRuntimeInspection();
        return {
          ...inspection,
          container_labels: {
            ...inspection.container_labels,
            'underchat.worker_type_id': EWorkerType.whatsmeow,
          },
          container_env: {
            ...inspection.container_env,
            WORKER_TYPE_ID: EWorkerType.whatsmeow,
          },
        };
      }
    );
    const worker = buildCurrentProviderWorker();
    const leaseContext: ILockLeaseContext = {
      signal: new AbortController().signal,
      assertActive: jest.fn(),
    };

    await expect(
      removeWithLifecycleProof(deps, worker, leaseContext)
    ).rejects.toThrow(
      'worker_runtime_removal_container_conflict:worker_type_id'
    );

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
    expect(deps.workerService.removeWorkerVolumeByProof).not.toHaveBeenCalled();
  });
});

describe('WorkerCommandHandlerService runtime removal server identity', () => {
  const payload: IWorkerPayload = {
    action: EWorkerAction.recreate,
    worker_id: 'worker-1',
    account_id: 'account-1',
    server_id: 'server-1',
    worker_type_id: EWorkerType.wwebjs,
    session_storage: EWorkerSessionStorage.legacy_volume,
    lifecycle_operation_id: 'operation-1',
  };
  const expected = {
    containerId: 'container-1',
    runtimeGeneration: 7,
    sessionStorage: EWorkerSessionStorage.legacy_volume,
    sessionVolumeName: 'worker-1',
  };
  const buildRemovalInspection = (
    serverLabel?: string,
    serverEnvironment?: string
  ): WorkerContainerInspection =>
    buildWorkerContainerInspection({
      container_labels: {
        'underchat.worker_id': 'worker-1',
        'underchat.account_id': 'account-1',
        'underchat.worker_type_id': EWorkerType.wwebjs,
        'underchat.runtime_generation': '7',
        'underchat.session_storage': EWorkerSessionStorage.legacy_volume,
        'underchat.session_volume_name': 'worker-1',
        ...(serverLabel === undefined
          ? {}
          : { 'underchat.server_id': serverLabel }),
      },
      container_env: {
        WORKER_ID: 'worker-1',
        ACCOUNT_ID: 'account-1',
        WORKER_TYPE_ID: EWorkerType.wwebjs,
        RUNTIME_GENERATION: '7',
        WORKER_SESSION_STORAGE: EWorkerSessionStorage.legacy_volume,
        SESSION_VOLUME_NAME: 'worker-1',
        ...(serverEnvironment === undefined
          ? {}
          : { SERVER_ID: serverEnvironment }),
      },
      container_mounts: [
        {
          destination: '/app/data',
          name: 'worker-1',
          read_write: true,
          type: 'volume',
        },
      ],
    });
  const assertRemovalIdentity = (
    inspection: WorkerContainerInspection
  ): void => {
    const deps = buildHandler();
    (
      deps.handler as unknown as {
        assertRuntimeRemovalContainerIdentity: (
          data: IWorkerPayload,
          inspectedContainer: WorkerContainerInspection,
          immutableIdentity: typeof expected
        ) => void;
      }
    ).assertRuntimeRemovalContainerIdentity(payload, inspection, expected);
  };

  it('accepts a legacy container whose server identity is absent', () => {
    expect(() => assertRemovalIdentity(buildRemovalInspection())).not.toThrow();
  });

  it('removes a legacy container through the complete lifecycle proof', async () => {
    const workerRuntimeRepository = buildSelfHealRuntimeRepository(
      expected.runtimeGeneration,
      expected.containerId
    );
    const deps = buildHandler({ workerRuntimeRepository });
    const worker: IWorkerMonitor = {
      worker_id: payload.worker_id,
      name: 'Canal 1',
      account_id: payload.account_id,
      server_id: payload.server_id,
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: EWorkerType.wwebjs,
      created_at: null,
      updated_at: null,
      deleted_at: null,
      container_id: expected.containerId,
      lifecycle_operation_id: payload.lifecycle_operation_id ?? null,
      last_connection_check_at: null,
    };
    deps.workerService.viewWorkerForMonitor.mockResolvedValue(worker);
    deps.workerService.inspectContainerWorkerByIdStrict.mockResolvedValue(
      buildRemovalInspection()
    );
    deps.workerService.listContainerIdsMountingVolumeStrict.mockResolvedValue([
      expected.containerId,
    ]);
    const leaseContext: ILockLeaseContext = {
      signal: new AbortController().signal,
      assertActive: jest.fn(),
    };

    await expect(
      (
        deps.handler as unknown as {
          removeRuntimeContainerWithLifecycleProof: (
            data: IWorkerPayload,
            removeVolume: boolean,
            initialWorker: IWorkerMonitor,
            lease: ILockLeaseContext
          ) => Promise<boolean>;
        }
      ).removeRuntimeContainerWithLifecycleProof(
        payload,
        false,
        worker,
        leaseContext
      )
    ).resolves.toBe(true);

    expect(deps.workerService.removeContainerWorkerById).toHaveBeenCalledWith(
      expected.containerId
    );
  });

  it('removes a PostgreSQL-backed runtime during reset/recreate without touching Docker volumes', async () => {
    const containerId = 'a'.repeat(64);
    const runtimeGeneration = 19;
    const runtime = {
      worker_id: payload.worker_id,
      container_id: containerId,
      container_name: payload.worker_id,
      session_storage: EWorkerSessionStorage.postgres,
      session_volume_name: null,
      runtime_capability_hash: 'b'.repeat(64),
      session_writer_epoch: '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5d',
      runtime_generation: runtimeGeneration,
      source_provider: 'wwebjs',
      connection_sequence: 1,
    };
    const workerRuntimeRepository = buildSelfHealRuntimeRepository(
      runtimeGeneration,
      containerId
    );
    workerRuntimeRepository.viewByWorkerId.mockResolvedValue(runtime);
    workerRuntimeRepository.viewByWorkerIdConsistent.mockResolvedValue(runtime);
    const deps = buildHandler({ workerRuntimeRepository });
    const postgresPayload: IWorkerPayload = {
      ...payload,
      session_storage: EWorkerSessionStorage.postgres,
      remove_session: true,
      remove_volume: false,
    };
    const worker: IWorkerMonitor = {
      worker_id: postgresPayload.worker_id,
      name: 'Canal PostgreSQL',
      account_id: postgresPayload.account_id,
      server_id: postgresPayload.server_id,
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: EWorkerType.wwebjs,
      session_storage: EWorkerSessionStorage.postgres,
      created_at: null,
      updated_at: null,
      deleted_at: null,
      container_id: containerId,
      runtime_container_id: containerId,
      runtime_generation: runtimeGeneration,
      runtime_session_volume_name: null,
      lifecycle_operation_id: postgresPayload.lifecycle_operation_id ?? null,
      last_connection_check_at: null,
    };
    deps.workerService.viewWorkerForMonitor.mockResolvedValue(worker);
    deps.workerService.inspectContainerWorkerByIdStrict.mockResolvedValue(
      buildWorkerContainerInspection({
        container_id: containerId,
        container_name: postgresPayload.worker_id,
        container_labels: {
          'underchat.worker_id': postgresPayload.worker_id,
          'underchat.account_id': postgresPayload.account_id,
          'underchat.server_id': postgresPayload.server_id,
          'underchat.worker_type_id': EWorkerType.wwebjs,
          'underchat.runtime_generation': String(runtimeGeneration),
          'underchat.session_storage': EWorkerSessionStorage.postgres,
        },
        container_env: {
          WORKER_ID: postgresPayload.worker_id,
          ACCOUNT_ID: postgresPayload.account_id,
          WORKER_TYPE_ID: EWorkerType.wwebjs,
          RUNTIME_GENERATION: String(runtimeGeneration),
          WORKER_SESSION_STORAGE: EWorkerSessionStorage.postgres,
        },
        container_mounts: [],
      })
    );
    const leaseContext: ILockLeaseContext = {
      signal: new AbortController().signal,
      assertActive: jest.fn(),
    };

    await expect(
      (
        deps.handler as unknown as {
          removeRuntimeContainerWithLifecycleProof: (
            data: IWorkerPayload,
            removeVolume: boolean,
            initialWorker: IWorkerMonitor,
            lease: ILockLeaseContext
          ) => Promise<boolean>;
        }
      ).removeRuntimeContainerWithLifecycleProof(
        postgresPayload,
        false,
        worker,
        leaseContext
      )
    ).resolves.toBe(true);

    expect(deps.workerService.removeContainerWorkerById).toHaveBeenCalledWith(
      containerId
    );
    expect(deps.workerService.inspectVolumeByNameStrict).not.toHaveBeenCalled();
    expect(
      deps.workerService.listContainerIdsMountingVolumeStrict
    ).not.toHaveBeenCalled();
    expect(deps.workerService.removeWorkerVolumeByProof).not.toHaveBeenCalled();
  });

  it('fails closed before Docker removal when a PostgreSQL runtime lost its capability fence', async () => {
    const containerId = 'c'.repeat(64);
    const runtimeGeneration = 20;
    const runtime = {
      worker_id: payload.worker_id,
      container_id: containerId,
      container_name: payload.worker_id,
      session_storage: EWorkerSessionStorage.postgres,
      session_volume_name: null,
      runtime_capability_hash: null,
      session_writer_epoch: '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5d',
      runtime_generation: runtimeGeneration,
      source_provider: 'wwebjs',
      connection_sequence: 1,
    };
    const workerRuntimeRepository = buildSelfHealRuntimeRepository(
      runtimeGeneration,
      containerId
    );
    workerRuntimeRepository.viewByWorkerIdConsistent.mockResolvedValue(runtime);
    const deps = buildHandler({ workerRuntimeRepository });
    const postgresPayload: IWorkerPayload = {
      ...payload,
      session_storage: EWorkerSessionStorage.postgres,
      remove_session: true,
      remove_volume: false,
    };
    const worker = {
      worker_id: postgresPayload.worker_id,
      name: 'Canal PostgreSQL',
      account_id: postgresPayload.account_id,
      server_id: postgresPayload.server_id,
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: EWorkerType.wwebjs,
      session_storage: EWorkerSessionStorage.postgres,
      created_at: null,
      updated_at: null,
      deleted_at: null,
      container_id: containerId,
      lifecycle_operation_id: postgresPayload.lifecycle_operation_id ?? null,
      last_connection_check_at: null,
    } satisfies IWorkerMonitor;
    const leaseContext: ILockLeaseContext = {
      signal: new AbortController().signal,
      assertActive: jest.fn(),
    };

    await expect(
      (
        deps.handler as unknown as {
          removeRuntimeContainerWithLifecycleProof: (
            data: IWorkerPayload,
            removeVolume: boolean,
            initialWorker: IWorkerMonitor,
            lease: ILockLeaseContext
          ) => Promise<boolean>;
        }
      ).removeRuntimeContainerWithLifecycleProof(
        postgresPayload,
        false,
        worker,
        leaseContext
      )
    ).rejects.toThrow('worker_runtime_removal_immutable_identity_missing');

    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
  });

  it.each([
    {
      caseName: 'current whatsmeow recreate',
      workerType: EWorkerType.whatsmeow,
      currentWorkerType: EWorkerType.whatsmeow,
      runtimeImage: 'under-worker-whatsmeow:latest',
      runtimeGrpcPort: '50054',
      action: EWorkerAction.recreate,
      previousWorkerType: undefined,
      removeSession: false,
      removeVolume: false,
      reservedByWorkerId: payload.worker_id,
      succeeds: true,
    },
    {
      caseName: 'current baileys recreate',
      workerType: EWorkerType.baileys,
      currentWorkerType: EWorkerType.baileys,
      runtimeImage: 'under-worker-baileys:latest',
      runtimeGrpcPort: '50051',
      action: EWorkerAction.recreate,
      previousWorkerType: undefined,
      removeSession: false,
      removeVolume: false,
      reservedByWorkerId: payload.worker_id,
      succeeds: true,
    },
    {
      caseName: 'previous baileys cleanup during whatsmeow type change',
      workerType: EWorkerType.baileys,
      currentWorkerType: EWorkerType.whatsmeow,
      runtimeImage: 'under-worker-baileys:latest',
      runtimeGrpcPort: '50051',
      action: EWorkerAction.cleanup,
      previousWorkerType: EWorkerType.baileys,
      removeSession: true,
      removeVolume: true,
      reservedByWorkerId: payload.worker_id,
      succeeds: true,
    },
    {
      caseName: 'cleanup without matching previous provider identity',
      workerType: EWorkerType.baileys,
      currentWorkerType: EWorkerType.whatsmeow,
      runtimeImage: 'under-worker-baileys:latest',
      runtimeGrpcPort: '50051',
      action: EWorkerAction.cleanup,
      previousWorkerType: undefined,
      removeSession: true,
      removeVolume: true,
      reservedByWorkerId: payload.worker_id,
      succeeds: false,
    },
    {
      caseName: 'previous provider cleanup reserved by another worker',
      workerType: EWorkerType.baileys,
      currentWorkerType: EWorkerType.whatsmeow,
      runtimeImage: 'under-worker-baileys:latest',
      runtimeGrpcPort: '50051',
      action: EWorkerAction.cleanup,
      previousWorkerType: EWorkerType.baileys,
      removeSession: true,
      removeVolume: true,
      reservedByWorkerId: 'different-worker',
      succeeds: false,
    },
  ])(
    'handles $caseName only with exact legacy assigned-warm ownership',
    async ({
      workerType,
      currentWorkerType,
      runtimeImage,
      runtimeGrpcPort,
      action,
      previousWorkerType,
      removeSession,
      removeVolume,
      reservedByWorkerId,
      succeeds,
    }) => {
      const containerId = '6'.repeat(64);
      const warmPoolId = '019fa9f0-1111-7222-8333-444444444444';
      const sessionVolumeName = `warm-${warmPoolId}`;
      const runtime = {
        worker_id: payload.worker_id,
        container_id: containerId,
        container_name: payload.worker_id,
        session_volume_name: sessionVolumeName,
        runtime_generation: 1,
        warm_pool_id: warmPoolId,
        connection_sequence: 1,
      };
      const workerRuntimeRepository = buildSelfHealRuntimeRepository(
        runtime.runtime_generation,
        runtime.container_id
      );
      workerRuntimeRepository.viewByWorkerId.mockResolvedValue(runtime);
      workerRuntimeRepository.viewByWorkerIdConsistent.mockResolvedValue(
        runtime
      );
      const deps = buildHandler({ workerRuntimeRepository });
      const legacyPayload: IWorkerPayload = {
        ...payload,
        action,
        worker_type_id: workerType,
        previous_worker_type_id: previousWorkerType,
        remove_session: removeSession,
        remove_volume: removeVolume,
      };
      const worker: IWorkerMonitor = {
        worker_id: legacyPayload.worker_id,
        name: 'PLÁCIDO',
        account_id: legacyPayload.account_id,
        server_id: legacyPayload.server_id,
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: currentWorkerType,
        created_at: null,
        updated_at: null,
        deleted_at: null,
        container_id: containerId,
        runtime_container_id: containerId,
        runtime_generation: 1,
        runtime_session_volume_name: sessionVolumeName,
        lifecycle_operation_id: legacyPayload.lifecycle_operation_id ?? null,
        last_connection_check_at: null,
      };
      deps.workerService.viewWorkerForMonitor.mockResolvedValue(worker);
      deps.workerWarmPoolRepository.viewByIdConsistent.mockResolvedValue({
        warm_pool_id: warmPoolId,
        server_id: legacyPayload.server_id,
        worker_type_id: workerType,
        container_id: containerId,
        container_name: sessionVolumeName,
        session_volume_name: sessionVolumeName,
        state: EWorkerWarmPoolState.assigned,
        reserved_by_worker_id: reservedByWorkerId,
      });
      deps.workerService.inspectContainerWorkerByIdStrict.mockResolvedValue(
        buildWorkerContainerInspection({
          container_id: containerId,
          container_name: legacyPayload.worker_id,
          container_image: runtimeImage,
          container_labels: {
            'underchat.warm_standby': 'true',
            'underchat.warm_pool_id': warmPoolId,
            'underchat.server_id': legacyPayload.server_id,
            'underchat.worker_type_id': workerType,
            'underchat.worker_image': runtimeImage,
            'underchat.worker_grpc_port': runtimeGrpcPort,
            'underchat.session_volume_name': sessionVolumeName,
          },
          container_env: {
            WARM_STANDBY: 'true',
            WARM_POOL_ID: warmPoolId,
            WORKER_TYPE_ID: workerType,
            WORKER_IMAGE: runtimeImage,
            WORKER_GRPC_PORT: runtimeGrpcPort,
            SESSION_VOLUME_NAME: sessionVolumeName,
          },
          container_mounts: [
            {
              destination: '/app/data',
              name: sessionVolumeName,
              read_write: true,
              type: 'volume',
            },
          ],
        })
      );
      let runtimeRemoved = false;
      deps.workerService.listContainerIdsMountingVolumeStrict.mockImplementation(
        async () => (runtimeRemoved ? [] : [containerId])
      );
      deps.workerService.removeContainerWorkerById.mockImplementation(
        async () => {
          runtimeRemoved = true;
          return true;
        }
      );
      const leaseContext: ILockLeaseContext = {
        signal: new AbortController().signal,
        assertActive: jest.fn(),
      };

      const removal = (
        deps.handler as unknown as {
          removeRuntimeContainerWithLifecycleProof: (
            data: IWorkerPayload,
            removeVolume: boolean,
            initialWorker: IWorkerMonitor,
            lease: ILockLeaseContext
          ) => Promise<boolean>;
        }
      ).removeRuntimeContainerWithLifecycleProof(
        legacyPayload,
        removeVolume,
        worker,
        leaseContext
      );

      if (!succeeds) {
        await expect(removal).rejects.toThrow(
          'worker_runtime_removal_container_conflict:worker_id'
        );
        expect(
          deps.workerService.removeContainerWorkerById
        ).not.toHaveBeenCalled();
        return;
      }

      await expect(removal).resolves.toBe(true);

      expect(
        deps.workerWarmPoolRepository.viewByIdConsistent
      ).toHaveBeenCalledWith(warmPoolId);
      expect(deps.workerService.removeContainerWorkerById).toHaveBeenCalledWith(
        containerId
      );
      if (removeVolume) {
        expect(
          deps.workerService.removeWorkerVolumeByProof
        ).toHaveBeenCalledWith(
          sessionVolumeName,
          `signature:${sessionVolumeName}`
        );
      } else {
        expect(
          deps.workerService.removeWorkerVolumeByProof
        ).not.toHaveBeenCalled();
      }
    }
  );

  it('fails closed on a legacy warm-looking container owned by another worker', async () => {
    const containerId = '7'.repeat(64);
    const warmPoolId = '019fa9f0-5555-7666-8777-888888888888';
    const sessionVolumeName = `warm-${warmPoolId}`;
    const runtime = {
      worker_id: payload.worker_id,
      container_id: containerId,
      container_name: payload.worker_id,
      session_volume_name: sessionVolumeName,
      runtime_generation: 1,
      warm_pool_id: warmPoolId,
      connection_sequence: 1,
    };
    const workerRuntimeRepository = buildSelfHealRuntimeRepository(
      1,
      containerId
    );
    workerRuntimeRepository.viewByWorkerId.mockResolvedValue(runtime);
    workerRuntimeRepository.viewByWorkerIdConsistent.mockResolvedValue(runtime);
    const deps = buildHandler({ workerRuntimeRepository });
    const legacyPayload: IWorkerPayload = {
      ...payload,
      worker_type_id: EWorkerType.whatsmeow,
    };
    const worker: IWorkerMonitor = {
      worker_id: legacyPayload.worker_id,
      name: 'PLÁCIDO',
      account_id: legacyPayload.account_id,
      server_id: legacyPayload.server_id,
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: EWorkerType.whatsmeow,
      created_at: null,
      updated_at: null,
      deleted_at: null,
      container_id: containerId,
      runtime_container_id: containerId,
      runtime_generation: 1,
      runtime_session_volume_name: sessionVolumeName,
      lifecycle_operation_id: legacyPayload.lifecycle_operation_id ?? null,
      last_connection_check_at: null,
    };
    deps.workerService.viewWorkerForMonitor.mockResolvedValue(worker);
    deps.workerWarmPoolRepository.viewByIdConsistent.mockResolvedValue({
      warm_pool_id: warmPoolId,
      server_id: legacyPayload.server_id,
      worker_type_id: EWorkerType.whatsmeow,
      container_id: containerId,
      container_name: sessionVolumeName,
      session_volume_name: sessionVolumeName,
      state: EWorkerWarmPoolState.assigned,
      reserved_by_worker_id: 'different-worker',
    });
    deps.workerService.inspectContainerWorkerByIdStrict.mockResolvedValue(
      buildWorkerContainerInspection({
        container_id: containerId,
        container_name: legacyPayload.worker_id,
        container_image: 'under-worker-whatsmeow:latest',
        container_labels: {
          'underchat.warm_standby': 'true',
          'underchat.warm_pool_id': warmPoolId,
          'underchat.server_id': legacyPayload.server_id,
          'underchat.worker_type_id': EWorkerType.whatsmeow,
          'underchat.worker_image': 'under-worker-whatsmeow:latest',
          'underchat.worker_grpc_port': '50054',
          'underchat.session_volume_name': sessionVolumeName,
        },
        container_env: {
          WARM_STANDBY: 'true',
          WARM_POOL_ID: warmPoolId,
          WORKER_TYPE_ID: EWorkerType.whatsmeow,
          WORKER_IMAGE: 'under-worker-whatsmeow:latest',
          WORKER_GRPC_PORT: '50054',
          SESSION_VOLUME_NAME: sessionVolumeName,
        },
        container_mounts: [
          {
            destination: '/app/data',
            name: sessionVolumeName,
            read_write: true,
            type: 'volume',
          },
        ],
      })
    );
    const leaseContext: ILockLeaseContext = {
      signal: new AbortController().signal,
      assertActive: jest.fn(),
    };

    await expect(
      (
        deps.handler as unknown as {
          removeRuntimeContainerWithLifecycleProof: (
            data: IWorkerPayload,
            removeVolume: boolean,
            initialWorker: IWorkerMonitor,
            lease: ILockLeaseContext
          ) => Promise<boolean>;
        }
      ).removeRuntimeContainerWithLifecycleProof(
        legacyPayload,
        false,
        worker,
        leaseContext
      )
    ).rejects.toThrow('worker_runtime_removal_container_conflict:worker_id');

    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
  });

  it('accepts matching server identity in both the label and environment', () => {
    expect(() =>
      assertRemovalIdentity(buildRemovalInspection('server-1', 'server-1'))
    ).not.toThrow();
  });

  it('fails closed when the server label conflicts with the lifecycle fence', () => {
    expect(() =>
      assertRemovalIdentity(buildRemovalInspection('server-2', 'server-1'))
    ).toThrow('worker_runtime_removal_container_conflict:server_id');
  });

  it('fails closed when the server environment conflicts with the lifecycle fence', () => {
    expect(() =>
      assertRemovalIdentity(buildRemovalInspection('server-1', 'server-2'))
    ).toThrow('worker_runtime_removal_container_conflict:server_id');
  });
});

describe('WorkerCommandHandlerService PostgreSQL provider handoff target removal', () => {
  const sourceContainerId = 'd'.repeat(64);
  const lifecycleOperationId = '00000000-0000-4000-8000-000000000029';
  const targetPayload: IWorkerPayload = {
    action: EWorkerAction.recreate,
    worker_id: 'worker-1',
    account_id: 'account-1',
    server_id: 'server-target',
    previous_server_id: 'server-source',
    worker_type_id: EWorkerType.whatsmeow,
    previous_worker_type_id: EWorkerType.baileys,
    session_storage: EWorkerSessionStorage.postgres,
    remove_session: false,
    remove_volume: false,
    lifecycle_operation_id: lifecycleOperationId,
  };
  const sourceWorker: IWorkerMonitor = {
    worker_id: targetPayload.worker_id,
    name: 'Canal em migração',
    account_id: targetPayload.account_id,
    server_id: targetPayload.server_id,
    worker_status_id: EWorkerStatus.recreating,
    // The source remains authoritative until the target promotion commits.
    worker_type_id: EWorkerType.baileys,
    session_storage: EWorkerSessionStorage.postgres,
    created_at: '2026-08-06T12:00:00.000Z',
    updated_at: '2026-08-06T12:01:00.000Z',
    deleted_at: null,
    container_id: sourceContainerId,
    runtime_container_id: sourceContainerId,
    runtime_generation: 4,
    runtime_session_volume_name: null,
    lifecycle_operation_id: lifecycleOperationId,
    last_connection_check_at: null,
  };
  const sourceRuntime: IWorkerRuntime = {
    worker_id: targetPayload.worker_id,
    container_id: sourceContainerId,
    container_name: targetPayload.worker_id,
    session_storage: EWorkerSessionStorage.postgres,
    session_volume_name: null,
    runtime_generation: 4,
    runtime_capability_hash: 'a'.repeat(64),
    session_writer_epoch: '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5d',
    source_provider: 'baileys',
    connection_sequence: 6,
  };
  const lease = (): ILockLeaseContext => ({
    signal: new AbortController().signal,
    assertActive: jest.fn(),
  });
  const removeWithLifecycleProof = (
    deps: ReturnType<typeof buildHandler>
  ): Promise<boolean> =>
    (
      deps.handler as unknown as {
        removeRuntimeContainerWithLifecycleProof(
          data: IWorkerPayload,
          removeVolume: boolean,
          worker: IWorkerMonitor,
          lifecycle: ILockLeaseContext
        ): Promise<boolean>;
      }
    ).removeRuntimeContainerWithLifecycleProof(
      targetPayload,
      false,
      sourceWorker,
      lease()
    );

  const buildSourceInspection = (sourceServerId: string) =>
    buildWorkerContainerInspection({
      container_id: sourceContainerId,
      container_name: targetPayload.worker_id,
      container_labels: {
        'underchat.worker_id': targetPayload.worker_id,
        'underchat.account_id': targetPayload.account_id,
        'underchat.server_id': sourceServerId,
        'underchat.worker_type_id': EWorkerType.baileys,
        'underchat.runtime_generation': '4',
        'underchat.session_storage': EWorkerSessionStorage.postgres,
      },
      container_env: {
        WORKER_ID: targetPayload.worker_id,
        ACCOUNT_ID: targetPayload.account_id,
        SERVER_ID: sourceServerId,
        WORKER_TYPE_ID: EWorkerType.baileys,
        RUNTIME_GENERATION: '4',
        WORKER_SESSION_STORAGE: EWorkerSessionStorage.postgres,
      },
      container_mounts: [],
    });

  it('accepts the drained source pointer only after the exact target handoff is authorized', async () => {
    const deps = buildHandler();
    Object.assign(deps.workerRuntimeRepository, {
      viewByWorkerIdConsistent: jest.fn(async () => sourceRuntime),
      isWhatsappProviderHandoffTargetAuthorized: jest.fn(async () => true),
    });
    deps.workerService.inspectContainerWorkerByIdStrict.mockResolvedValue({
      exists: false,
      container_name: targetPayload.worker_id,
    });

    await expect(removeWithLifecycleProof(deps)).resolves.toBe(true);

    expect(
      deps.workerRuntimeRepository.isWhatsappProviderHandoffTargetAuthorized
    ).toHaveBeenCalledWith({
      worker_id: targetPayload.worker_id,
      account_id: targetPayload.account_id,
      lifecycle_operation_id: lifecycleOperationId,
      target_worker_type_id: EWorkerType.whatsmeow,
    });
    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
  });

  it('removes a still-present source container only after proving its source Docker identity', async () => {
    const deps = buildHandler();
    Object.assign(deps.workerRuntimeRepository, {
      viewByWorkerIdConsistent: jest.fn(async () => sourceRuntime),
      isWhatsappProviderHandoffTargetAuthorized: jest.fn(async () => true),
    });
    deps.workerService.viewWorkerForMonitor.mockResolvedValue(sourceWorker);
    deps.workerService.inspectContainerWorkerByIdStrict.mockResolvedValue(
      buildSourceInspection('server-source')
    );

    await expect(removeWithLifecycleProof(deps)).resolves.toBe(true);

    expect(
      deps.workerService.stopContainerWorkerByIdGracefully
    ).toHaveBeenCalledWith(sourceContainerId);
    expect(deps.workerService.removeContainerWorkerById).toHaveBeenCalledWith(
      sourceContainerId
    );
    expect(
      deps.workerRuntimeRepository.isWhatsappProviderHandoffTargetAuthorized
    ).toHaveBeenCalled();
  });

  it('keeps the source-server fence exact during an authorized handoff', async () => {
    const deps = buildHandler();
    Object.assign(deps.workerRuntimeRepository, {
      viewByWorkerIdConsistent: jest.fn(async () => sourceRuntime),
      isWhatsappProviderHandoffTargetAuthorized: jest.fn(async () => true),
    });
    deps.workerService.viewWorkerForMonitor.mockResolvedValue(sourceWorker);
    deps.workerService.inspectContainerWorkerByIdStrict.mockResolvedValue(
      buildSourceInspection('server-other')
    );

    await expect(removeWithLifecycleProof(deps)).rejects.toThrow(
      'worker_runtime_removal_container_conflict:server_id'
    );
    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
  });

  it('fails closed when the handoff authorization is absent', async () => {
    const deps = buildHandler();
    Object.assign(deps.workerRuntimeRepository, {
      viewByWorkerIdConsistent: jest.fn(async () => sourceRuntime),
      isWhatsappProviderHandoffTargetAuthorized: jest.fn(async () => false),
    });

    await expect(removeWithLifecycleProof(deps)).rejects.toThrow(
      'worker_runtime_removal_database_fence_changed'
    );
    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
  });

  it('releases an absent same-server target cold reservation without touching the source', async () => {
    const targetReservationContainerId = 'e'.repeat(64);
    const abandonedTargetRuntime: IWorkerRuntime = {
      ...sourceRuntime,
      container_id: targetReservationContainerId,
      runtime_generation: 5,
      source_provider: null,
    };
    let currentWorker: IWorkerMonitor = {
      ...sourceWorker,
      runtime_container_id: targetReservationContainerId,
      runtime_generation: 5,
    };
    const sameServerPayload: IWorkerPayload = {
      ...targetPayload,
      previous_server_id: targetPayload.server_id,
    };
    const deps = buildHandler();
    Object.assign(deps.workerRuntimeRepository, {
      viewByWorkerIdConsistent: jest.fn(async () => abandonedTargetRuntime),
      isWhatsappProviderHandoffTargetAuthorized: jest.fn(async () => true),
    });
    deps.workerService.viewWorkerForMonitor.mockImplementation(
      async () => currentWorker
    );
    deps.workerService.inspectContainerWorkerByIdStrict.mockImplementation(
      async (containerId: string) => ({
        exists: false,
        container_id: containerId,
        container_name: sameServerPayload.worker_id,
      })
    );
    deps.workerService.updateWorkerByIdIfLifecycleMatches.mockImplementation(
      async (_accountId: string, update: unknown) => {
        currentWorker = {
          ...currentWorker,
          container_id: (update as { container_id: string }).container_id,
        };
        return true;
      }
    );

    await expect(
      (
        deps.handler as unknown as {
          removeRuntimeContainerWithLifecycleProof(
            data: IWorkerPayload,
            removeVolume: boolean,
            worker: IWorkerMonitor,
            lifecycle: ILockLeaseContext
          ): Promise<boolean>;
        }
      ).removeRuntimeContainerWithLifecycleProof(
        sameServerPayload,
        false,
        currentWorker,
        lease()
      )
    ).resolves.toBe(true);

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      sameServerPayload.account_id,
      expect.objectContaining({
        worker_id: sameServerPayload.worker_id,
        container_id: targetReservationContainerId,
      }),
      expect.objectContaining({
        lifecycle_operation_id: lifecycleOperationId,
        worker_type_id: EWorkerType.baileys,
      })
    );
    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
  });

  it('releases an absent same-server target that authenticated before promotion and reprovisions the next generation', async () => {
    const targetReservationContainerId = 'a'.repeat(64);
    const targetRuntimeGeneration = 5;
    const activatedTargetRuntime: IWorkerRuntime = {
      ...sourceRuntime,
      container_id: targetReservationContainerId,
      runtime_generation: targetRuntimeGeneration,
      source_provider: 'whatsmeow',
      connection_epoch: 'target-connection-epoch-5',
      connection_sequence: 2,
      connection_activated_at: '2026-08-11T18:14:41.444Z',
      recreate_bootstrap_operation_id: lifecycleOperationId,
      recreate_bootstrap_runtime_generation: targetRuntimeGeneration,
      recreate_bootstrap_container_id: targetReservationContainerId,
      recreate_bootstrap_started_at: '2026-08-11T18:14:39.011Z',
    };
    let currentWorker: IWorkerMonitor = {
      ...sourceWorker,
      runtime_container_id: targetReservationContainerId,
      runtime_generation: targetRuntimeGeneration,
    };
    const sameServerPayload: IWorkerPayload = {
      ...targetPayload,
      previous_server_id: targetPayload.server_id,
    };
    const deps = buildHandler();
    Object.assign(deps.workerRuntimeRepository, {
      viewByWorkerIdConsistent: jest.fn(async () => activatedTargetRuntime),
      isWhatsappProviderHandoffTargetAuthorized: jest.fn(async () => true),
    });
    deps.workerService.viewWorkerForMonitor.mockImplementation(
      async () => currentWorker
    );
    deps.workerService.inspectContainerWorkerByIdStrict.mockImplementation(
      async (containerId: string) => ({
        exists: false,
        container_id: containerId,
        container_name: sameServerPayload.worker_id,
      })
    );
    deps.workerService.updateWorkerByIdIfLifecycleMatches.mockImplementation(
      async (_accountId: string, update: unknown) => {
        currentWorker = {
          ...currentWorker,
          container_id: (update as { container_id: string }).container_id,
        };
        return true;
      }
    );

    await expect(
      (
        deps.handler as unknown as {
          removeRuntimeContainerWithLifecycleProof(
            data: IWorkerPayload,
            removeVolume: boolean,
            worker: IWorkerMonitor,
            lifecycle: ILockLeaseContext
          ): Promise<boolean>;
        }
      ).removeRuntimeContainerWithLifecycleProof(
        sameServerPayload,
        false,
        currentWorker,
        lease()
      )
    ).resolves.toBe(true);

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      sameServerPayload.account_id,
      expect.objectContaining({
        worker_id: sameServerPayload.worker_id,
        container_id: targetReservationContainerId,
      }),
      expect.objectContaining({
        lifecycle_operation_id: lifecycleOperationId,
        runtime_generation: targetRuntimeGeneration,
        worker_type_id: EWorkerType.baileys,
      })
    );
    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'divergent provider',
      runtime: {
        source_provider: 'wwebjs',
        connection_epoch: 'target-connection-epoch-5',
        connection_sequence: 2,
        connection_activated_at: '2026-08-11T18:14:41.444Z',
      },
    },
    {
      label: 'missing bootstrap ownership',
      runtime: {
        source_provider: 'whatsmeow',
        connection_epoch: 'target-connection-epoch-5',
        connection_sequence: 2,
        connection_activated_at: '2026-08-11T18:14:41.444Z',
        recreate_bootstrap_operation_id: null,
      },
    },
  ])(
    'fails closed for an absent activated same-server target with $label',
    async ({ runtime: runtimeOverride }) => {
      const targetReservationContainerId = 'b'.repeat(64);
      const targetRuntimeGeneration = 5;
      const inconsistentTargetRuntime: IWorkerRuntime = {
        ...sourceRuntime,
        container_id: targetReservationContainerId,
        runtime_generation: targetRuntimeGeneration,
        recreate_bootstrap_operation_id: lifecycleOperationId,
        recreate_bootstrap_runtime_generation: targetRuntimeGeneration,
        recreate_bootstrap_container_id: targetReservationContainerId,
        recreate_bootstrap_started_at: '2026-08-11T18:14:39.011Z',
        ...runtimeOverride,
      };
      const currentWorker: IWorkerMonitor = {
        ...sourceWorker,
        runtime_container_id: targetReservationContainerId,
        runtime_generation: targetRuntimeGeneration,
      };
      const sameServerPayload: IWorkerPayload = {
        ...targetPayload,
        previous_server_id: targetPayload.server_id,
      };
      const deps = buildHandler();
      Object.assign(deps.workerRuntimeRepository, {
        viewByWorkerIdConsistent: jest.fn(
          async () => inconsistentTargetRuntime
        ),
        isWhatsappProviderHandoffTargetAuthorized: jest.fn(async () => true),
      });
      deps.workerService.viewWorkerForMonitor.mockResolvedValue(currentWorker);
      deps.workerService.inspectContainerWorkerByIdStrict.mockResolvedValue({
        exists: false,
        container_name: sameServerPayload.worker_id,
      });

      await expect(
        (
          deps.handler as unknown as {
            removeRuntimeContainerWithLifecycleProof(
              data: IWorkerPayload,
              removeVolume: boolean,
              worker: IWorkerMonitor,
              lifecycle: ILockLeaseContext
            ): Promise<boolean>;
          }
        ).removeRuntimeContainerWithLifecycleProof(
          sameServerPayload,
          false,
          currentWorker,
          lease()
        )
      ).rejects.toThrow('worker_runtime_removal_database_fence_changed');

      expect(
        deps.workerService.updateWorkerByIdIfLifecycleMatches
      ).not.toHaveBeenCalled();
      expect(
        deps.workerService.removeContainerWorkerById
      ).not.toHaveBeenCalled();
    }
  );

  it('does not repair an absent target reservation across servers', async () => {
    const targetReservationContainerId = 'f'.repeat(64);
    const abandonedTargetRuntime: IWorkerRuntime = {
      ...sourceRuntime,
      container_id: targetReservationContainerId,
      runtime_generation: 5,
      source_provider: null,
    };
    const currentWorker: IWorkerMonitor = {
      ...sourceWorker,
      runtime_container_id: targetReservationContainerId,
      runtime_generation: 5,
    };
    const deps = buildHandler();
    Object.assign(deps.workerRuntimeRepository, {
      viewByWorkerIdConsistent: jest.fn(async () => abandonedTargetRuntime),
      isWhatsappProviderHandoffTargetAuthorized: jest.fn(async () => true),
    });
    deps.workerService.viewWorkerForMonitor.mockResolvedValue(currentWorker);
    deps.workerService.inspectContainerWorkerByIdStrict.mockResolvedValue({
      exists: false,
      container_name: targetPayload.worker_id,
    });

    await expect(
      (
        deps.handler as unknown as {
          removeRuntimeContainerWithLifecycleProof(
            data: IWorkerPayload,
            removeVolume: boolean,
            worker: IWorkerMonitor,
            lifecycle: ILockLeaseContext
          ): Promise<boolean>;
        }
      ).removeRuntimeContainerWithLifecycleProof(
        targetPayload,
        false,
        currentWorker,
        lease()
      )
    ).rejects.toThrow('worker_runtime_removal_database_fence_changed');

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
  });

  it('keeps a target cold-runtime claim current while the source remains authoritative', async () => {
    const deps = buildHandler();
    Object.assign(deps.workerRuntimeRepository, {
      isWhatsappProviderHandoffTargetAuthorized: jest.fn(async () => true),
    });
    deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValue(
      sourceWorker
    );

    await expect(
      (
        deps.handler as unknown as {
          isReservedColdRuntimeClaimCurrent(input: {
            data: IWorkerPayload;
            workerType: EWorkerType;
            expectedWorkerStatus: EWorkerStatus;
          }): Promise<boolean>;
        }
      ).isReservedColdRuntimeClaimCurrent({
        data: targetPayload,
        workerType: EWorkerType.whatsmeow,
        expectedWorkerStatus: EWorkerStatus.recreating,
      })
    ).resolves.toBe(true);

    expect(
      deps.workerRuntimeRepository.isWhatsappProviderHandoffTargetAuthorized
    ).toHaveBeenCalledWith({
      worker_id: targetPayload.worker_id,
      account_id: targetPayload.account_id,
      lifecycle_operation_id: lifecycleOperationId,
      target_worker_type_id: EWorkerType.whatsmeow,
    });
  });
});

describe('WorkerCommandHandlerService legacy-volume conversion', () => {
  const lifecycleOperationId = '00000000-0000-4000-8000-00000000002a';
  const targetPayload: IWorkerPayload = {
    action: EWorkerAction.recreate,
    worker_id: 'worker-1',
    account_id: 'account-1',
    server_id: 'server-target',
    worker_type_id: EWorkerType.whatsmeow,
    previous_worker_type_id: EWorkerType.wwebjs,
    session_storage: EWorkerSessionStorage.postgres,
    previous_session_storage: EWorkerSessionStorage.legacy_volume,
    remove_session: true,
    remove_volume: true,
    lifecycle_operation_id: lifecycleOperationId,
  };
  const targetWorker: IWorkerMonitor = {
    worker_id: targetPayload.worker_id,
    name: 'Canal em conversão',
    account_id: targetPayload.account_id,
    server_id: targetPayload.server_id,
    worker_status_id: EWorkerStatus.recreating,
    worker_type_id: EWorkerType.whatsmeow,
    session_storage: EWorkerSessionStorage.postgres,
    created_at: '2026-08-06T12:00:00.000Z',
    updated_at: '2026-08-06T12:01:00.000Z',
    deleted_at: null,
    container_id: 'e'.repeat(64),
    runtime_container_id: 'e'.repeat(64),
    runtime_generation: 4,
    runtime_session_volume_name: 'worker-1',
    lifecycle_operation_id: lifecycleOperationId,
    last_connection_check_at: null,
  };
  const sourceRuntime: IWorkerRuntime = {
    worker_id: targetPayload.worker_id,
    container_id: 'e'.repeat(64),
    container_name: targetPayload.worker_id,
    session_storage: EWorkerSessionStorage.legacy_volume,
    session_volume_name: 'worker-1',
    runtime_generation: 4,
    source_provider: 'wwebjs',
    connection_sequence: 9,
  };
  const lease: ILockLeaseContext = {
    signal: new AbortController().signal,
    assertActive: jest.fn(),
  };

  it('accepts the target PostgreSQL row while the prepared cleanup still owns the legacy source runtime', async () => {
    const deps = buildHandler();
    Object.assign(deps.workerRuntimeRepository, {
      viewByWorkerIdConsistent: jest.fn(async () => sourceRuntime),
    });
    const handler = deps.handler as unknown as {
      hydrateAuthoritativeSessionStorageIfMissing(
        data: IWorkerPayload,
        worker: IWorkerMonitor
      ): Promise<void>;
      resolveRecreateSessionVolume(
        data: IWorkerPayload,
        shouldRemoveVolume: boolean,
        lifecycle: ILockLeaseContext
      ): Promise<unknown>;
    };

    await expect(
      handler.hydrateAuthoritativeSessionStorageIfMissing(
        { ...targetPayload },
        targetWorker
      )
    ).resolves.toBeUndefined();
    await expect(
      handler.resolveRecreateSessionVolume(targetPayload, false, lease)
    ).resolves.toEqual(
      expect.objectContaining({
        source: 'reset',
        runtimeGeneration: sourceRuntime.runtime_generation,
        sessionDeletionRuntimeFence: {
          runtime_generation: sourceRuntime.runtime_generation,
          container_id: sourceRuntime.container_id,
          session_storage: EWorkerSessionStorage.legacy_volume,
          session_volume_name: sourceRuntime.session_volume_name,
        },
      })
    );
  });
});

describe('WorkerCommandHandlerService protected legacy-volume migration', () => {
  const lifecycleOperationId = '00000000-0000-4000-8000-00000000002b';
  const migrationId = '00000000-0000-4000-8000-00000000002c';
  const sourceContainerId = 'e'.repeat(64);
  const sourceVolumeName = 'worker-1';
  const runtimeGeneration = 4;
  const checksum = 'a'.repeat(64);
  const restoreSourceContainerId = 'd'.repeat(64);
  const staleLegacyContainerId = 'c'.repeat(64);
  const restoreRuntimeGeneration = 8;
  const restoreWriterEpoch = '00000000-0000-4000-8000-00000000002d';
  const providers = [
    [EWorkerType.baileys, 'baileys'],
    [EWorkerType.wwebjs, 'wwebjs'],
    [EWorkerType.whatsmeow, 'whatsmeow'],
  ] as const;

  const buildPayload = (workerType: EWorkerType): IWorkerPayload => ({
    action: EWorkerAction.recreate,
    worker_id: 'worker-1',
    account_id: 'account-1',
    server_id: 'server-1',
    worker_type_id: workerType,
    previous_worker_type_id: workerType,
    worker_status_id: EWorkerStatus.recreating,
    previous_worker_status_id: EWorkerStatus.recreating,
    session_storage: EWorkerSessionStorage.postgres,
    previous_session_storage: EWorkerSessionStorage.legacy_volume,
    remove_session: false,
    remove_volume: false,
    lifecycle_operation_id: lifecycleOperationId,
    session_storage_migration_id: migrationId,
    legacy_session_volume_name: sourceVolumeName,
    legacy_session_checksum: checksum,
  });

  const buildFinalizationPayload = (
    workerType: EWorkerType
  ): IWorkerPayload => ({
    ...buildPayload(workerType),
    previous_session_storage: undefined,
    legacy_session_volume_name: undefined,
    legacy_session_checksum: undefined,
    lifecycle_semantic_fingerprint: 'b'.repeat(64),
  });

  const buildPendingMigrationHealth = (
    workerType: EWorkerType,
    expectedGeneration: number
  ) => ({
    ...nativeRuntimeContract(workerType, false),
    worker_id: 'worker-1',
    account_id: 'account-1',
    worker_type_id: workerType,
    activated: true,
    ready: true,
    standby: false,
    runtime_state: 'active',
    runtime_generation: expectedGeneration,
    qr_stream_ready: true,
    has_session: true,
    has_qr: false,
    session_ready: false,
    can_send: false,
    can_receive_runtime: false,
    authenticated: false,
    provider_state: 'session_importing',
    phone: '',
    kafka_unhealthy: true,
    kafka_consumers_ready: false,
    kafka_consumers_authorized: false,
  });

  const buildOnlineMigrationHealth = (
    workerType: EWorkerType,
    expectedGeneration: number
  ) => ({
    ...buildPendingMigrationHealth(workerType, expectedGeneration),
    ...nativeRuntimeContract(workerType, true),
    connection_status: buildNativeConnectionStatus(workerType, true),
    session_ready: true,
    can_send: true,
    can_receive_runtime: true,
    authenticated: true,
    provider_state: 'CONNECTED',
    phone: '556192037138',
    kafka_unhealthy: false,
    kafka_consumers_ready: true,
    kafka_consumers_authorized: true,
  });

  const buildTargetWorker = (workerType: EWorkerType): IWorkerMonitor => ({
    worker_id: 'worker-1',
    name: 'Canal em migração protegida',
    account_id: 'account-1',
    server_id: 'server-1',
    worker_status_id: EWorkerStatus.recreating,
    worker_type_id: workerType,
    session_storage: EWorkerSessionStorage.postgres,
    created_at: '2026-08-15T05:00:00.000Z',
    updated_at: '2026-08-15T05:01:00.000Z',
    deleted_at: null,
    container_id: sourceContainerId,
    runtime_container_id: sourceContainerId,
    runtime_generation: runtimeGeneration,
    runtime_session_volume_name: sourceVolumeName,
    lifecycle_operation_id: lifecycleOperationId,
    last_connection_check_at: null,
  });

  const buildSourceRuntime = (
    provider: 'baileys' | 'wwebjs' | 'whatsmeow'
  ): IWorkerRuntime => ({
    worker_id: 'worker-1',
    container_id: sourceContainerId,
    container_name: 'worker-1',
    session_storage: EWorkerSessionStorage.legacy_volume,
    session_volume_name: sourceVolumeName,
    runtime_generation: runtimeGeneration,
    source_provider: provider,
    connection_sequence: 9,
  });

  const buildSourceInspection = (
    workerType: EWorkerType
  ): WorkerContainerInspection =>
    buildWorkerContainerInspection({
      container_id: sourceContainerId,
      container_name: 'worker-1',
      container_labels: {
        'underchat.worker_id': 'worker-1',
        'underchat.account_id': 'account-1',
        'underchat.server_id': 'server-1',
        'underchat.worker_type_id': workerType,
        'underchat.runtime_generation': String(runtimeGeneration),
        'underchat.session_storage': EWorkerSessionStorage.legacy_volume,
        'underchat.session_volume_name': sourceVolumeName,
      },
      container_env: {
        WORKER_ID: 'worker-1',
        ACCOUNT_ID: 'account-1',
        SERVER_ID: 'server-1',
        WORKER_TYPE_ID: workerType,
        RUNTIME_GENERATION: String(runtimeGeneration),
        WORKER_SESSION_STORAGE: EWorkerSessionStorage.legacy_volume,
        SESSION_VOLUME_NAME: sourceVolumeName,
      },
    });

  const buildRestorePayload = (workerType: EWorkerType): IWorkerPayload => ({
    ...buildPayload(workerType),
    session_storage: EWorkerSessionStorage.legacy_volume,
    previous_session_storage: EWorkerSessionStorage.postgres,
  });

  const buildRestoreWorker = (workerType: EWorkerType): IWorkerMonitor => ({
    ...buildTargetWorker(workerType),
    session_storage: EWorkerSessionStorage.legacy_volume,
    container_id: staleLegacyContainerId,
    runtime_container_id: restoreSourceContainerId,
    runtime_generation: restoreRuntimeGeneration,
    runtime_session_volume_name: null,
  });

  const buildRepairedRestoreWorker = (
    workerType: EWorkerType
  ): IWorkerMonitor => ({
    ...buildRestoreWorker(workerType),
    container_id: restoreSourceContainerId,
  });

  const buildRestoreSourceRuntime = (
    provider: 'baileys' | 'wwebjs' | 'whatsmeow'
  ): IWorkerRuntime => ({
    worker_id: 'worker-1',
    container_id: restoreSourceContainerId,
    container_name: 'worker-1',
    session_storage: EWorkerSessionStorage.postgres,
    session_volume_name: null,
    runtime_generation: restoreRuntimeGeneration,
    source_provider: provider,
    runtime_capability_hash: 'b'.repeat(64),
    session_writer_epoch: restoreWriterEpoch,
    connection_sequence: 10,
  });

  const buildRestoreSourceInspection = (
    workerType: EWorkerType
  ): WorkerContainerInspection =>
    buildWorkerContainerInspection({
      container_id: restoreSourceContainerId,
      container_name: 'worker-1',
      container_labels: {
        'underchat.worker_id': 'worker-1',
        'underchat.account_id': 'account-1',
        'underchat.server_id': 'server-1',
        'underchat.worker_type_id': workerType,
        'underchat.runtime_generation': String(restoreRuntimeGeneration),
        'underchat.session_storage': EWorkerSessionStorage.postgres,
      },
      container_env: {
        WORKER_ID: 'worker-1',
        ACCOUNT_ID: 'account-1',
        SERVER_ID: 'server-1',
        WORKER_TYPE_ID: workerType,
        RUNTIME_GENERATION: String(restoreRuntimeGeneration),
        WORKER_SESSION_STORAGE: EWorkerSessionStorage.postgres,
      },
      container_mounts: [],
    });

  const removeWithLifecycleProof = (
    deps: ReturnType<typeof buildHandler>,
    payload: IWorkerPayload,
    worker: IWorkerMonitor
  ): Promise<boolean> =>
    (
      deps.handler as unknown as {
        removeRuntimeContainerWithLifecycleProof(
          data: IWorkerPayload,
          removeVolume: boolean,
          initialWorker: IWorkerMonitor,
          lease: ILockLeaseContext
        ): Promise<boolean>;
      }
    ).removeRuntimeContainerWithLifecycleProof(payload, false, worker, {
      signal: new AbortController().signal,
      assertActive: jest.fn(),
    });

  it.each(providers)(
    'keeps a protected %s storage migration alive past the ordinary recreate confirmation budget',
    async (workerType) => {
      const deps = buildHandler();
      (deps.handler as any).recreateOnlineReconciliationWaitMs = 1;
      (deps.handler as any).sessionStorageMigrationOnlineReconciliationWaitMs =
        100;
      (deps.handler as any).recreateOnlineReconciliationPollIntervalMs = 5;
      const expectedGeneration = runtimeGeneration + 1;
      const pendingHealth = buildPendingMigrationHealth(
        workerType,
        expectedGeneration
      );
      const onlineHealth = buildOnlineMigrationHealth(
        workerType,
        expectedGeneration
      );
      deps.workerBaileysGrpcClientService.runtimeHealth
        .mockResolvedValueOnce(pendingHealth)
        .mockResolvedValueOnce(pendingHealth)
        .mockResolvedValue(onlineHealth);
      deps.workerBaileysGrpcClientService.requestConnection.mockResolvedValue({
        ...buildConnectingState(),
        runtime_generation: expectedGeneration,
      });

      const reconciliation = await (
        deps.handler as unknown as {
          reconcileRecreatedWorkerConnection(
            data: IWorkerPayload,
            workerType: EWorkerType,
            runtimeGeneration: number,
            lease: ILockLeaseContext
          ): Promise<{ workerStatusId: EWorkerStatus }>;
        }
      ).reconcileRecreatedWorkerConnection(
        buildPayload(workerType),
        workerType,
        expectedGeneration,
        {
          signal: new AbortController().signal,
          assertActive: jest.fn(),
        }
      );

      expect(reconciliation.workerStatusId).toBe(EWorkerStatus.online);
      expect(
        deps.workerBaileysGrpcClientService.runtimeHealth.mock.calls.length
      ).toBeGreaterThanOrEqual(3);
    }
  );

  it.each(providers)(
    'keeps the protected %s PostgreSQL finalization alive without remounting legacy metadata',
    async (workerType) => {
      const deps = buildHandler();
      (deps.handler as any).recreateOnlineReconciliationWaitMs = 1;
      (deps.handler as any).sessionStorageMigrationOnlineReconciliationWaitMs =
        100;
      (deps.handler as any).recreateOnlineReconciliationPollIntervalMs = 5;
      const expectedGeneration = runtimeGeneration + 1;
      const pendingHealth = buildPendingMigrationHealth(
        workerType,
        expectedGeneration
      );
      const onlineHealth = buildOnlineMigrationHealth(
        workerType,
        expectedGeneration
      );
      deps.workerBaileysGrpcClientService.runtimeHealth
        .mockResolvedValueOnce(pendingHealth)
        .mockResolvedValueOnce(pendingHealth)
        .mockResolvedValue(onlineHealth);
      deps.workerBaileysGrpcClientService.requestConnection.mockResolvedValue({
        ...buildConnectingState(),
        runtime_generation: expectedGeneration,
      });
      const finalizationPayload = buildFinalizationPayload(workerType);
      expect(
        (
          deps.handler as unknown as {
            isSafeSessionStorageMigrationFinalization(
              data: IWorkerPayload
            ): boolean;
          }
        ).isSafeSessionStorageMigrationFinalization(finalizationPayload)
      ).toBe(true);

      const reconciliation = await (
        deps.handler as unknown as {
          reconcileRecreatedWorkerConnection(
            data: IWorkerPayload,
            workerType: EWorkerType,
            runtimeGeneration: number,
            lease: ILockLeaseContext
          ): Promise<{ workerStatusId: EWorkerStatus }>;
        }
      ).reconcileRecreatedWorkerConnection(
        finalizationPayload,
        workerType,
        expectedGeneration,
        {
          signal: new AbortController().signal,
          assertActive: jest.fn(),
        }
      );

      expect(reconciliation.workerStatusId).toBe(EWorkerStatus.online);
      expect(
        deps.workerBaileysGrpcClientService.runtimeHealth.mock.calls.length
      ).toBeGreaterThanOrEqual(3);
    }
  );

  it.each(providers)(
    'does not widen an ordinary %s PostgreSQL recreate to the migration confirmation budget',
    async (workerType) => {
      const deps = buildHandler();
      (deps.handler as any).recreateOnlineReconciliationWaitMs = 1;
      (deps.handler as any).sessionStorageMigrationOnlineReconciliationWaitMs =
        100;
      (deps.handler as any).recreateOnlineReconciliationPollIntervalMs = 5;
      const expectedGeneration = runtimeGeneration + 1;
      const pendingHealth = buildPendingMigrationHealth(
        workerType,
        expectedGeneration
      );
      deps.workerBaileysGrpcClientService.runtimeHealth.mockResolvedValue(
        pendingHealth
      );
      deps.workerBaileysGrpcClientService.requestConnection.mockResolvedValue({
        ...buildConnectingState(),
        runtime_generation: expectedGeneration,
      });
      const ordinaryPayload: IWorkerPayload = {
        ...buildFinalizationPayload(workerType),
        session_storage_migration_id: undefined,
        lifecycle_semantic_fingerprint: undefined,
      };

      expect(
        (
          deps.handler as unknown as {
            isSafeSessionStorageMigrationFinalization(
              data: IWorkerPayload
            ): boolean;
          }
        ).isSafeSessionStorageMigrationFinalization(ordinaryPayload)
      ).toBe(false);

      await expect(
        (
          deps.handler as unknown as {
            reconcileRecreatedWorkerConnection(
              data: IWorkerPayload,
              workerType: EWorkerType,
              runtimeGeneration: number,
              lease: ILockLeaseContext
            ): Promise<{ workerStatusId: EWorkerStatus }>;
          }
        ).reconcileRecreatedWorkerConnection(
          ordinaryPayload,
          workerType,
          expectedGeneration,
          {
            signal: new AbortController().signal,
            assertActive: jest.fn(),
          }
        )
      ).rejects.toThrow('remained pending');
    }
  );

  it.each(providers)(
    'retires the exact %s legacy source container while preserving its rollback volume',
    async (workerType, provider) => {
      const payload = buildPayload(workerType);
      const worker = buildTargetWorker(workerType);
      const runtime = buildSourceRuntime(provider);
      const deps = buildHandler({
        workerInspection: buildSourceInspection(workerType),
      });
      Object.assign(deps.workerRuntimeRepository, {
        viewByWorkerIdConsistent: jest.fn(async () => runtime),
      });
      deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValue(
        worker
      );
      deps.workerService.listContainerIdsMountingVolumeStrict.mockResolvedValue(
        [sourceContainerId]
      );

      await expect(
        removeWithLifecycleProof(deps, payload, worker)
      ).resolves.toBe(true);

      expect(deps.workerService.removeContainerWorkerById).toHaveBeenCalledWith(
        sourceContainerId
      );
      expect(
        deps.workerService.stopContainerWorkerByIdGracefully
      ).not.toHaveBeenCalled();
      expect(
        deps.workerService.removeWorkerVolumeByProof
      ).not.toHaveBeenCalled();
    }
  );

  it('fails closed when the protected command names a different source volume', async () => {
    const payload = {
      ...buildPayload(EWorkerType.wwebjs),
      legacy_session_volume_name: 'worker-other',
    };
    const worker = buildTargetWorker(EWorkerType.wwebjs);
    const runtime = buildSourceRuntime('wwebjs');
    const deps = buildHandler({
      workerInspection: buildSourceInspection(EWorkerType.wwebjs),
    });
    Object.assign(deps.workerRuntimeRepository, {
      viewByWorkerIdConsistent: jest.fn(async () => runtime),
    });

    await expect(
      removeWithLifecycleProof(deps, payload, worker)
    ).rejects.toThrow('worker_runtime_removal_database_fence_changed');
    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
    expect(deps.workerService.removeWorkerVolumeByProof).not.toHaveBeenCalled();
  });

  it.each(providers)(
    'retires the exact failed %s PostgreSQL target before restoring the preserved legacy volume',
    async (workerType, provider) => {
      const payload = buildRestorePayload(workerType);
      const worker = buildRestoreWorker(workerType);
      const repairedWorker = buildRepairedRestoreWorker(workerType);
      const runtime = buildRestoreSourceRuntime(provider);
      const sourceInspection = buildRestoreSourceInspection(workerType);
      const deps = buildHandler();
      Object.assign(deps.workerRuntimeRepository, {
        viewByWorkerIdConsistent: jest.fn(async () => runtime),
      });
      deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValue(
        repairedWorker
      );
      deps.workerService.inspectContainerWorkerByIdStrict.mockImplementation(
        async (containerId: string) =>
          containerId === staleLegacyContainerId
            ? {
                exists: false,
                container_name: 'worker-1',
              }
            : sourceInspection
      );

      await expect(
        removeWithLifecycleProof(deps, payload, worker)
      ).resolves.toBe(true);

      expect(
        deps.workerService.updateWorkerByIdIfLifecycleMatches
      ).toHaveBeenCalledWith(
        'account-1',
        expect.objectContaining({
          worker_id: 'worker-1',
          container_id: restoreSourceContainerId,
        }),
        expect.objectContaining({
          container_id: staleLegacyContainerId,
          runtime_container_id: restoreSourceContainerId,
          runtime_generation: restoreRuntimeGeneration,
          runtime_session_volume_name: null,
        })
      );
      expect(
        deps.workerService.stopContainerWorkerByIdGracefully
      ).toHaveBeenCalledWith(restoreSourceContainerId);
      expect(deps.workerService.removeContainerWorkerById).toHaveBeenCalledWith(
        restoreSourceContainerId
      );
      expect(
        deps.workerService.removeWorkerVolumeByProof
      ).not.toHaveBeenCalled();
    }
  );

  it('fails closed when a PostgreSQL-to-volume restore omits the captured checksum', async () => {
    const payload = {
      ...buildRestorePayload(EWorkerType.wwebjs),
      legacy_session_checksum: undefined,
    };
    const worker = buildRestoreWorker(EWorkerType.wwebjs);
    const runtime = buildRestoreSourceRuntime('wwebjs');
    const deps = buildHandler();
    Object.assign(deps.workerRuntimeRepository, {
      viewByWorkerIdConsistent: jest.fn(async () => runtime),
    });

    await expect(
      removeWithLifecycleProof(deps, payload, worker)
    ).rejects.toThrow('worker_runtime_removal_database_fence_changed');
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
  });

  it.each(providers)(
    'emits a stable terminal error when the protected %s rollback volume is physically absent',
    async (workerType) => {
      const deps = buildHandler({ volumeExists: false });
      const updateWorkerErrorStatus = jest.fn(async () => undefined);
      const assertActive = jest.fn();
      const handler = deps.handler as unknown as {
        assertPreservedSessionVolumeExists(
          data: IWorkerPayload,
          resolution: {
            sessionVolumeName: string;
            source: 'runtime';
            runtimeWasBackfilled: false;
          },
          lease: ILockLeaseContext
        ): Promise<void>;
        updateWorkerErrorStatus: jest.Mock;
      };
      Object.assign(handler, { updateWorkerErrorStatus });

      await expect(
        handler.assertPreservedSessionVolumeExists(
          buildRestorePayload(workerType),
          {
            sessionVolumeName: sourceVolumeName,
            source: 'runtime',
            runtimeWasBackfilled: false,
          },
          {
            signal: new AbortController().signal,
            assertActive,
          }
        )
      ).rejects.toThrow('session_storage_migration_source_volume_missing');

      expect(deps.workerService.existsVolumeByNameStrict).toHaveBeenCalledWith(
        sourceVolumeName
      );
      expect(updateWorkerErrorStatus).toHaveBeenCalledWith(
        'worker-1',
        'account-1',
        EWorkerAction.recreate,
        'server-1',
        lifecycleOperationId
      );
      expect(assertActive).toHaveBeenCalledTimes(4);
    }
  );
});

describe('WorkerCommandHandlerService provider handoff discard ordering', () => {
  const discardPrimary = {
    action: EWorkerAction.recreate,
    worker_id: 'worker-1',
    account_id: 'account-1',
    server_id: 'server-1',
    worker_type_id: EWorkerType.baileys,
    previous_worker_type_id: EWorkerType.whatsmeow,
    lifecycle_operation_id: '00000000-0000-4000-8000-000000000030',
    session_storage: EWorkerSessionStorage.postgres,
    remove_session: false,
    remove_volume: false,
  };

  const callDiscardGate = async (
    deps: ReturnType<typeof buildHandler>,
    assertActive = jest.fn()
  ) => {
    await (
      deps.handler as unknown as {
        assertWhatsappHandoffDiscardCleanupCompleted(
          data: Record<string, unknown>,
          lease: ILockLeaseContext
        ): Promise<void>;
      }
    ).assertWhatsappHandoffDiscardCleanupCompleted(discardPrimary, {
      signal: new AbortController().signal,
      assertActive,
    });
  };

  it.each([
    [true, null],
    [false, null],
  ] as const)(
    'keeps the target recreate pending while source cleanup is not committed (session=%s, finalized=%s)',
    async (sessionPresent, cleanupFinalizedAt) => {
      const deps = buildHandler();
      Object.assign(deps.workerRuntimeRepository, {
        viewWhatsappProviderHandoffDiscardPrimaryGate: jest.fn(async () => ({
          handoff_id: '00000000-0000-4000-8000-000000000031',
          operation_id: discardPrimary.lifecycle_operation_id,
          source_provider: 'whatsmeow',
          target_provider: 'baileys',
          session_present: sessionPresent,
          cleanup_finalized_at: cleanupFinalizedAt,
        })),
      });

      await expect(callDiscardGate(deps)).rejects.toThrow(
        'pending:whatsapp_handoff_discard_cleanup'
      );
    }
  );

  it('releases the target only after session deletion and cleanup finalization are both durable', async () => {
    const deps = buildHandler();
    const assertActive = jest.fn();
    Object.assign(deps.workerRuntimeRepository, {
      viewWhatsappProviderHandoffDiscardPrimaryGate: jest.fn(async () => ({
        handoff_id: '00000000-0000-4000-8000-000000000031',
        operation_id: discardPrimary.lifecycle_operation_id,
        source_provider: 'whatsmeow',
        target_provider: 'baileys',
        session_present: false,
        cleanup_finalized_at: '2026-08-05T01:00:00.000Z',
      })),
    });

    await expect(callDiscardGate(deps, assertActive)).resolves.toBeUndefined();
    expect(assertActive).toHaveBeenCalledTimes(1);
  });

  it('does not affect ordinary recreates that have no discard resolution', async () => {
    const deps = buildHandler();
    Object.assign(deps.workerRuntimeRepository, {
      viewWhatsappProviderHandoffDiscardPrimaryGate: jest.fn(async () => null),
    });

    await expect(callDiscardGate(deps)).resolves.toBeUndefined();
  });

  it('makes a finalized source cleanup retry a no-op even after the target session exists', async () => {
    const deps = buildHandler();
    const handler = deps.handler as unknown as {
      cleanupWorker(
        data: IWorkerPayload,
        lease: ILockLeaseContext
      ): Promise<void>;
      isLifecycleOperationCurrent: jest.Mock;
      preparePostgresProviderHandoffSource: jest.Mock;
    };
    handler.isLifecycleOperationCurrent = jest.fn(async () => true);
    handler.preparePostgresProviderHandoffSource = jest.fn(async () => ({
      status: 'not_handoff',
    }));
    Object.assign(deps.workerRuntimeRepository, {
      viewWhatsappProviderHandoffDiscardCleanupContext: jest.fn(async () => ({
        handoff_id: '00000000-0000-4000-8000-000000000031',
        operation_id: discardPrimary.lifecycle_operation_id,
        source_provider: 'whatsmeow',
        target_provider: 'baileys',
        runtime_generation: 13,
        container_id: 'f'.repeat(64),
        session_present: true,
        cleanup_finalized_at: '2026-08-05T01:00:00.000Z',
      })),
      finalizeWhatsappProviderHandoffDiscardCleanup: jest.fn(async () => true),
    });

    await expect(
      handler.cleanupWorker(discardPrimary, {
        signal: new AbortController().signal,
        assertActive: jest.fn(),
      })
    ).resolves.toBeUndefined();

    expect(handler.preparePostgresProviderHandoffSource).not.toHaveBeenCalled();
    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
  });

  it('does not treat session absence without the durable cleanup timestamp as finalized', async () => {
    const deps = buildHandler();
    const handler = deps.handler as unknown as {
      cleanupWorker(
        data: IWorkerPayload,
        lease: ILockLeaseContext
      ): Promise<void>;
      isLifecycleOperationCurrent: jest.Mock;
      preparePostgresProviderHandoffSource: jest.Mock;
      removeRuntimeContainerWithLifecycleProof: jest.Mock;
    };
    handler.isLifecycleOperationCurrent = jest.fn(async () => true);
    handler.preparePostgresProviderHandoffSource = jest.fn(async () => ({
      status: 'not_handoff',
    }));
    handler.removeRuntimeContainerWithLifecycleProof = jest.fn(
      async () => true
    );
    const finalize = jest.fn(async () => true);
    Object.assign(deps.workerRuntimeRepository, {
      viewWhatsappProviderHandoffDiscardCleanupContext: jest.fn(async () => ({
        handoff_id: '00000000-0000-4000-8000-000000000031',
        operation_id: discardPrimary.lifecycle_operation_id,
        source_provider: 'whatsmeow',
        target_provider: 'baileys',
        runtime_generation: 13,
        container_id: 'f'.repeat(64),
        session_present: false,
        cleanup_finalized_at: null,
      })),
      finalizeWhatsappProviderHandoffDiscardCleanup: finalize,
    });

    await expect(
      handler.cleanupWorker(discardPrimary, {
        signal: new AbortController().signal,
        assertActive: jest.fn(),
      })
    ).resolves.toBeUndefined();

    expect(handler.preparePostgresProviderHandoffSource).toHaveBeenCalled();
    expect(handler.removeRuntimeContainerWithLifecycleProof).toHaveBeenCalled();
    expect(finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        handoff_id: '00000000-0000-4000-8000-000000000031',
        operation_id: discardPrimary.lifecycle_operation_id,
      })
    );
  });
});

describe('WorkerCommandHandlerService provider handoff source-drain barrier', () => {
  it('retries an out-of-order target command before any destination runtime or writer effect', async () => {
    const deps = buildHandler();
    const operationId = '00000000-0000-4000-8000-000000000040';
    deps.workerService.viewWorkerForMonitorConsistent.mockResolvedValue({
      worker_id: 'worker-1',
      name: 'Canal 1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: EWorkerType.baileys,
      created_at: null,
      updated_at: null,
      deleted_at: null,
      container_id: 'source-container',
      session_storage: EWorkerSessionStorage.postgres,
      lifecycle_operation_id: operationId,
      last_connection_check_at: null,
    });
    (
      deps.workerRuntimeRepository
        .isWhatsappProviderHandoffTargetAuthorized as jest.Mock
    ).mockResolvedValue(false);
    (
      deps.workerRuntimeRepository
        .viewWhatsappProviderHandoffLifecycleContext as jest.Mock
    ).mockResolvedValue({
      handoff_id: '00000000-0000-4000-8000-000000000041',
      lifecycle_operation_id: operationId,
      source_provider: 'baileys',
      target_provider: 'whatsmeow',
      source_revision_id: '71',
      target_revision_id: '72',
      state: 'requested',
    });

    await expect(
      (
        deps.handler as unknown as {
          performRecreateWorker(
            data: IWorkerPayload,
            lease: ILockLeaseContext
          ): Promise<unknown>;
        }
      ).performRecreateWorker(
        {
          action: EWorkerAction.recreate,
          worker_id: 'worker-1',
          account_id: 'account-1',
          server_id: 'server-1',
          worker_type_id: EWorkerType.whatsmeow,
          previous_worker_type_id: EWorkerType.baileys,
          lifecycle_operation_id: operationId,
          session_storage: EWorkerSessionStorage.postgres,
          remove_session: false,
          remove_volume: false,
        },
        {
          signal: new AbortController().signal,
          assertActive: jest.fn(),
        }
      )
    ).rejects.toThrow(
      'worker_recreate_liveness_fence_retry:pending:whatsapp_handoff_source_drain'
    );

    expect(
      deps.workerRuntimeRepository.reserveNextRuntimeGeneration
    ).not.toHaveBeenCalled();
    expect(
      (
        deps.workerRuntimeRepository as typeof deps.workerRuntimeRepository & {
          prepareRuntimeWriterIdentity: jest.Mock;
        }
      ).prepareRuntimeWriterIdentity
    ).not.toHaveBeenCalled();
    expect(deps.workerRuntimeRepository.upsert).not.toHaveBeenCalled();
    expect(deps.workerService.createContainerWorker).not.toHaveBeenCalled();
    expect(
      deps.workerBaileysGrpcClientService.requestConnection
    ).not.toHaveBeenCalled();
  });
});

describe('WorkerCommandHandlerService cleanup', () => {
  it('never infers volume removal for PostgreSQL cleanup when an older protobuf peer omits false', async () => {
    const deps = buildHandler();
    const handler = deps.handler as unknown as {
      cleanupWorker(
        data: IWorkerPayload,
        lease: ILockLeaseContext
      ): Promise<void>;
      isLifecycleOperationCurrent: jest.Mock;
      preparePostgresProviderHandoffSource: jest.Mock;
      removeRuntimeContainerWithLifecycleProof: jest.Mock;
    };
    handler.isLifecycleOperationCurrent = jest.fn(async () => true);
    handler.preparePostgresProviderHandoffSource = jest.fn(async () => ({
      status: 'not_handoff',
    }));
    handler.removeRuntimeContainerWithLifecycleProof = jest.fn(
      async () => true
    );

    await handler.cleanupWorker(
      {
        action: EWorkerAction.cleanup,
        worker_id: 'worker-1',
        server_id: 'server-old',
        account_id: 'account-1',
        session_storage: EWorkerSessionStorage.postgres,
        lifecycle_operation_id: 'operation-current',
      },
      {
        signal: new AbortController().signal,
        assertActive: jest.fn(),
      }
    );

    expect(
      handler.removeRuntimeContainerWithLifecycleProof
    ).toHaveBeenCalledWith(
      expect.any(Object),
      false,
      expect.any(Object),
      expect.any(Object),
      undefined
    );
  });

  it('preserves an explicit PostgreSQL volume-removal intent for the immutable proof to reject', async () => {
    const deps = buildHandler();
    const handler = deps.handler as unknown as {
      cleanupWorker(
        data: IWorkerPayload,
        lease: ILockLeaseContext
      ): Promise<void>;
      isLifecycleOperationCurrent: jest.Mock;
      preparePostgresProviderHandoffSource: jest.Mock;
      removeRuntimeContainerWithLifecycleProof: jest.Mock;
    };
    handler.isLifecycleOperationCurrent = jest.fn(async () => true);
    handler.preparePostgresProviderHandoffSource = jest.fn(async () => ({
      status: 'not_handoff',
    }));
    handler.removeRuntimeContainerWithLifecycleProof = jest.fn(
      async (_data: IWorkerPayload, removeVolume: boolean) => {
        if (removeVolume) {
          throw new Error('postgres_worker_must_not_remove_session_volume');
        }
        return true;
      }
    );

    await expect(
      handler.cleanupWorker(
        {
          action: EWorkerAction.cleanup,
          worker_id: 'worker-1',
          server_id: 'server-old',
          account_id: 'account-1',
          session_storage: EWorkerSessionStorage.postgres,
          remove_volume: true,
          lifecycle_operation_id: 'operation-current',
        },
        {
          signal: new AbortController().signal,
          assertActive: jest.fn(),
        }
      )
    ).rejects.toThrow('postgres_worker_must_not_remove_session_volume');

    expect(
      handler.removeRuntimeContainerWithLifecycleProof
    ).toHaveBeenCalledWith(
      expect.any(Object),
      true,
      expect.any(Object),
      expect.any(Object),
      undefined
    );
  });

  it('removes only local container artifacts and does not mutate worker data', async () => {
    const deps = buildHandler();

    await handleWorkerCommand(deps, {
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
    expect(deps.workerService.removeContainerWorkerById).toHaveBeenCalledWith(
      LIFECYCLE_RUNTIME_CONTAINER_ID
    );
    expect(deps.workerLifecycleLockService.withLock).toHaveBeenCalledWith(
      'worker-1',
      'cleanup_worker',
      expect.any(Function)
    );
    expect(
      deps.kafkaBaileysQueueService.deletePermanently
    ).not.toHaveBeenCalled();
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

    await handleWorkerCommand(deps, {
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

  it('does not disconnect a provider after the cleanup lifecycle is superseded', async () => {
    const deps = buildHandler();
    deps.workerService.viewWorkerForMonitor
      .mockResolvedValueOnce({
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-new',
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: EWorkerType.whatsmeow,
        deleted_at: null,
        lifecycle_operation_id: 'operation-current',
      })
      .mockResolvedValueOnce({
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-new',
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: EWorkerType.whatsmeow,
        deleted_at: null,
        lifecycle_operation_id: 'operation-new',
      });

    await expect(
      handleWorkerCommand(deps, {
        action: EWorkerAction.cleanup,
        worker_id: 'worker-1',
        server_id: 'server-old',
        account_id: 'account-1',
        remove_session: true,
        remove_volume: false,
        lifecycle_operation_id: 'operation-current',
      })
    ).rejects.toThrow(
      'Worker lifecycle changed before cleanup provider session disconnect'
    );

    expect(
      deps.workerBaileysGrpcClientService.requestConnection
    ).not.toHaveBeenCalled();
    expect(deps.workerService.cleanupContainerWorker).not.toHaveBeenCalled();
  });

  it('rechecks the cleanup lifecycle in every runtime removal attempt', async () => {
    const deps = buildHandler();
    deps.workerService.viewWorkerForMonitor
      .mockResolvedValueOnce({
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-new',
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: EWorkerType.whatsmeow,
        deleted_at: null,
        lifecycle_operation_id: 'operation-current',
      })
      .mockResolvedValueOnce({
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-new',
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: EWorkerType.whatsmeow,
        deleted_at: null,
        lifecycle_operation_id: 'operation-new',
      });

    await expect(
      handleWorkerCommand(deps, {
        action: EWorkerAction.cleanup,
        worker_id: 'worker-1',
        server_id: 'server-old',
        account_id: 'account-1',
        remove_session: true,
        remove_volume: true,
        lifecycle_operation_id: 'operation-current',
      })
    ).rejects.toThrow(
      'Worker lifecycle changed before cleanup runtime removal'
    );

    expect(deps.workerService.cleanupContainerWorker).not.toHaveBeenCalled();
    expect(
      deps.workerService.removeContainerByNameAndVolume
    ).not.toHaveBeenCalled();
  });

  it('fails closed without deleting a runtime generation reserved by the new server', async () => {
    let runtime = {
      worker_id: 'worker-1',
      container_id: null,
      container_name: 'worker-1',
      session_volume_name: 'worker-1',
      runtime_generation: 8,
      warm_pool_id: null,
    } as Record<string, unknown> | null;
    const workerRuntimeRepository = {
      viewByWorkerId: jest.fn(async () => runtime),
      upsert: jest.fn(async (input: Record<string, unknown>) => input),
      deleteByWorkerId: jest.fn(async () => {
        runtime = null;
        return true;
      }),
    };
    const deps = buildHandler({ workerRuntimeRepository });
    deps.workerService.viewWorkerForMonitor.mockResolvedValue({
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-new',
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: EWorkerType.whatsmeow,
      deleted_at: null,
      container_id: null,
      lifecycle_operation_id: 'operation-current',
    });
    deps.workerService.inspectContainerWorkerByIdStrict.mockResolvedValue({
      exists: false,
      container_name: 'worker-1',
    });

    await expect(
      handleWorkerCommand(deps, {
        action: EWorkerAction.cleanup,
        worker_id: 'worker-1',
        server_id: 'server-old',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
        remove_session: true,
        remove_volume: true,
        lifecycle_operation_id: 'operation-current',
      })
    ).rejects.toThrow('worker_runtime_removal_volume_identity_missing');

    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
    expect(workerRuntimeRepository.deleteByWorkerId).not.toHaveBeenCalled();
    expect(runtime).toEqual(expect.objectContaining({ runtime_generation: 8 }));
  });

  it('propagates cleanup failures from an accessible worker server', async () => {
    const deps = buildHandler();
    deps.workerService.removeContainerWorkerById.mockRejectedValue(
      new Error('docker failed')
    );

    await expect(
      handleWorkerCommand(deps, {
        action: EWorkerAction.cleanup,
        worker_id: 'worker-1',
        server_id: 'server-old',
        account_id: 'account-1',
        remove_volume: true,
      })
    ).rejects.toThrow('docker failed');

    expect(deps.workerService.updateWorkerById).not.toHaveBeenCalled();
    expect(deps.workerService.deleteWorkerById).not.toHaveBeenCalled();
  });

  it.each([
    [EWorkerType.baileys, 'baileys', 'wwebjs'],
    [EWorkerType.baileys, 'baileys', 'whatsmeow'],
    [EWorkerType.wwebjs, 'wwebjs', 'baileys'],
    [EWorkerType.wwebjs, 'wwebjs', 'whatsmeow'],
    [EWorkerType.whatsmeow, 'whatsmeow', 'baileys'],
    [EWorkerType.whatsmeow, 'whatsmeow', 'wwebjs'],
  ] as const)(
    'routes a fully fenced PostgreSQL source drain for %s (%s -> %s)',
    async (sourceWorkerType, sourceProvider, targetProvider) => {
      const deps = buildHandler();
      const context = {
        handoff_id: '00000000-0000-4000-8000-000000000020',
        lifecycle_operation_id: '00000000-0000-4000-8000-000000000021',
        source_provider: sourceProvider,
        target_provider: targetProvider,
        source_revision_id: '51',
        target_revision_id: '52',
        state: 'requested',
      } as const;
      (
        deps.workerRuntimeRepository
          .viewWhatsappProviderHandoffLifecycleContext as jest.Mock
      ).mockResolvedValue(context);
      (
        deps.workerRuntimeRepository.viewByWorkerIdConsistent as jest.Mock
      ).mockResolvedValue({
        worker_id: 'worker-1',
        container_id: 'd'.repeat(64),
        container_name: 'worker-1',
        session_storage: EWorkerSessionStorage.postgres,
        session_volume_name: null,
        runtime_generation: 12,
        source_provider: sourceProvider,
      });
      (
        deps.workerBaileysGrpcClientService.prepareProviderHandoff as jest.Mock
      ).mockResolvedValue({
        worker_id: 'worker-1',
        provider: sourceProvider,
        handoff_id: context.handoff_id,
        lifecycle_operation_id: context.lifecycle_operation_id,
        source_revision_id: context.source_revision_id,
        runtime_generation: 12,
        prepared: true,
        consumers_drained: true,
        writes_paused: true,
        checkpoint_persisted: true,
        provider_disconnected: true,
        lease_released: true,
        checkpoint_checksum_sha256: 'e'.repeat(64),
        checkpoint_size_bytes: '4096',
        checkpoint_record_count: '24',
        prepared_at: '2026-08-04T03:00:00.000Z',
        error: '',
      });

      const result = await (
        deps.handler as unknown as {
          preparePostgresProviderHandoffSource(
            data: Record<string, unknown>,
            lease: ILockLeaseContext
          ): Promise<unknown>;
        }
      ).preparePostgresProviderHandoffSource(
        {
          action: EWorkerAction.cleanup,
          worker_id: 'worker-1',
          account_id: 'account-1',
          server_id: 'server-old',
          worker_type_id: sourceWorkerType,
          lifecycle_operation_id: context.lifecycle_operation_id,
          session_storage: EWorkerSessionStorage.postgres,
          remove_session: false,
          ...(sourceWorkerType === EWorkerType.baileys &&
          targetProvider === 'whatsmeow'
            ? {}
            : { remove_volume: false }),
        },
        {
          signal: new AbortController().signal,
          assertActive: jest.fn(),
        }
      );

      expect(result).toEqual({
        status: 'remove_source',
        sourceContainerId: 'd'.repeat(64),
        runtimeGeneration: 12,
        sourceProvider,
      });
      expect(
        deps.workerBaileysGrpcClientService.prepareProviderHandoff
      ).toHaveBeenCalledWith(
        'worker-1',
        expect.objectContaining({
          source_provider: sourceProvider,
          target_provider: targetProvider,
          source_revision_id: '51',
        }),
        sourceWorkerType
      );
      expect(
        deps.workerRuntimeRepository
          .acknowledgeWhatsappProviderHandoffSourceDrained
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          source_provider: sourceProvider,
          source_revision_id: '51',
          checkpoint_checksum_sha256: 'e'.repeat(64),
        })
      );
      expect(
        deps.workerService.stopContainerWorkerByIdGracefully
      ).toHaveBeenCalledWith('d'.repeat(64));
      expect(
        deps.workerService.removeContainerWorkerById
      ).not.toHaveBeenCalled();
    }
  );

  it('resumes source cleanup after a committed drain acknowledgement without repeating the provider RPC', async () => {
    const deps = buildHandler();
    const handler = deps.handler as unknown as {
      cleanupWorker(
        data: IWorkerPayload,
        lease: ILockLeaseContext
      ): Promise<void>;
      isLifecycleOperationCurrent: jest.Mock;
      removeRuntimeContainerWithLifecycleProof: jest.Mock;
    };
    handler.isLifecycleOperationCurrent = jest.fn(async () => true);
    handler.removeRuntimeContainerWithLifecycleProof = jest.fn(
      async () => true
    );
    const context = {
      handoff_id: '00000000-0000-4000-8000-000000000020',
      lifecycle_operation_id: '00000000-0000-4000-8000-000000000021',
      source_provider: 'baileys',
      target_provider: 'whatsmeow',
      source_revision_id: '51',
      target_revision_id: '52',
      state: 'transforming',
    } as const;
    (
      deps.workerRuntimeRepository
        .viewWhatsappProviderHandoffLifecycleContext as jest.Mock
    ).mockResolvedValue(context);
    (
      deps.workerRuntimeRepository.viewByWorkerIdConsistent as jest.Mock
    ).mockResolvedValue({
      worker_id: 'worker-1',
      container_id: 'd'.repeat(64),
      container_name: 'worker-1',
      session_storage: EWorkerSessionStorage.postgres,
      session_volume_name: null,
      runtime_generation: 12,
      source_provider: 'baileys',
    });

    await handler.cleanupWorker(
      {
        action: EWorkerAction.cleanup,
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-old',
        worker_type_id: EWorkerType.baileys,
        lifecycle_operation_id: context.lifecycle_operation_id,
        session_storage: EWorkerSessionStorage.postgres,
        remove_session: false,
      },
      {
        signal: new AbortController().signal,
        assertActive: jest.fn(),
      }
    );

    expect(
      deps.workerBaileysGrpcClientService.prepareProviderHandoff
    ).not.toHaveBeenCalled();
    expect(
      deps.workerRuntimeRepository
        .acknowledgeWhatsappProviderHandoffSourceDrained
    ).not.toHaveBeenCalled();
    expect(
      deps.workerService.stopContainerWorkerByIdGracefully
    ).toHaveBeenCalledWith('d'.repeat(64));
    expect(
      handler.removeRuntimeContainerWithLifecycleProof
    ).toHaveBeenCalledWith(
      expect.any(Object),
      false,
      expect.any(Object),
      expect.any(Object),
      {
        containerId: 'd'.repeat(64),
        runtimeGeneration: 12,
        sourceProvider: 'baileys',
      }
    );
  });

  it('requires the complete provider checkpoint proof before stopping a PostgreSQL source runtime', async () => {
    const deps = buildHandler();
    const context = {
      handoff_id: '00000000-0000-4000-8000-000000000010',
      lifecycle_operation_id: '00000000-0000-4000-8000-000000000011',
      source_provider: 'wwebjs',
      target_provider: 'baileys',
      source_revision_id: '41',
      target_revision_id: '42',
      state: 'requested',
    } as const;
    (
      deps.workerRuntimeRepository
        .viewWhatsappProviderHandoffLifecycleContext as jest.Mock
    ).mockResolvedValue(context);
    (
      deps.workerRuntimeRepository.viewByWorkerIdConsistent as jest.Mock
    ).mockResolvedValue({
      worker_id: 'worker-1',
      container_id: 'a'.repeat(64),
      container_name: 'worker-1',
      session_storage: EWorkerSessionStorage.postgres,
      session_volume_name: null,
      runtime_generation: 9,
      source_provider: 'wwebjs',
    });
    (
      deps.workerBaileysGrpcClientService.prepareProviderHandoff as jest.Mock
    ).mockResolvedValue({
      worker_id: 'worker-1',
      provider: 'wwebjs',
      handoff_id: context.handoff_id,
      lifecycle_operation_id: context.lifecycle_operation_id,
      source_revision_id: context.source_revision_id,
      runtime_generation: 9,
      prepared: true,
      consumers_drained: true,
      writes_paused: true,
      checkpoint_persisted: true,
      provider_disconnected: true,
      lease_released: true,
      checkpoint_checksum_sha256: 'b'.repeat(64),
      checkpoint_size_bytes: '2048',
      checkpoint_record_count: '18',
      prepared_at: '2026-08-02T18:00:00.000Z',
      error: '',
    });

    const handler = deps.handler as unknown as {
      preparePostgresProviderHandoffSource(
        data: Record<string, unknown>,
        lease: ILockLeaseContext
      ): Promise<unknown>;
    };
    const input = {
      action: EWorkerAction.cleanup,
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-old',
      worker_type_id: EWorkerType.wwebjs,
      lifecycle_operation_id: context.lifecycle_operation_id,
      session_storage: EWorkerSessionStorage.postgres,
      remove_session: false,
      remove_volume: false,
    };
    const lease = {
      signal: new AbortController().signal,
      assertActive: jest.fn(),
    };
    const result = await handler.preparePostgresProviderHandoffSource(
      input,
      lease
    );

    expect(result).toEqual({
      status: 'remove_source',
      sourceContainerId: 'a'.repeat(64),
      runtimeGeneration: 9,
      sourceProvider: 'wwebjs',
    });
    expect(
      deps.workerRuntimeRepository
        .acknowledgeWhatsappProviderHandoffSourceDrained as jest.Mock
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        handoff_id: context.handoff_id,
        source_revision_id: '41',
        checkpoint_checksum_sha256: 'b'.repeat(64),
        checkpoint_size_bytes: '2048',
        checkpoint_record_count: '18',
      })
    );
    expect(
      deps.workerService.stopContainerWorkerByIdGracefully
    ).toHaveBeenCalledWith('a'.repeat(64));
    expect(
      (
        deps.workerRuntimeRepository
          .acknowledgeWhatsappProviderHandoffSourceDrained as jest.Mock
      ).mock.invocationCallOrder[0]
    ).toBeLessThan(
      deps.workerService.stopContainerWorkerByIdGracefully.mock
        .invocationCallOrder[0]
    );

    (
      deps.workerRuntimeRepository
        .acknowledgeWhatsappProviderHandoffSourceDrained as jest.Mock
    ).mockResolvedValueOnce(false);
    (
      deps.workerRuntimeRepository
        .failWhatsappProviderHandoffBeforeSourceDrain as jest.Mock
    ).mockClear();
    deps.workerService.stopContainerWorkerByIdGracefully.mockClear();
    await expect(
      handler.preparePostgresProviderHandoffSource(input, lease)
    ).rejects.toThrow('whatsapp_handoff_source_drain_not_acknowledged');
    expect(
      deps.workerRuntimeRepository.failWhatsappProviderHandoffBeforeSourceDrain
    ).not.toHaveBeenCalled();
    expect(
      deps.workerService.stopContainerWorkerByIdGracefully
    ).not.toHaveBeenCalled();
  });

  it('atomically fails without ACK or Docker stop when one provider drain proof is missing', async () => {
    const deps = buildHandler();
    const context = {
      handoff_id: '00000000-0000-4000-8000-000000000010',
      lifecycle_operation_id: '00000000-0000-4000-8000-000000000011',
      source_provider: 'wwebjs',
      target_provider: 'baileys',
      source_revision_id: '41',
      target_revision_id: '42',
      state: 'requested',
    } as const;
    (
      deps.workerRuntimeRepository
        .viewWhatsappProviderHandoffLifecycleContext as jest.Mock
    ).mockResolvedValue(context);
    (
      deps.workerRuntimeRepository.viewByWorkerIdConsistent as jest.Mock
    ).mockResolvedValue({
      worker_id: 'worker-1',
      container_id: 'a'.repeat(64),
      container_name: 'worker-1',
      session_storage: EWorkerSessionStorage.postgres,
      session_volume_name: null,
      runtime_generation: 9,
      source_provider: 'wwebjs',
    });
    (
      deps.workerBaileysGrpcClientService.prepareProviderHandoff as jest.Mock
    ).mockResolvedValue({
      worker_id: 'worker-1',
      provider: 'wwebjs',
      handoff_id: context.handoff_id,
      lifecycle_operation_id: context.lifecycle_operation_id,
      source_revision_id: context.source_revision_id,
      runtime_generation: 9,
      prepared: true,
      consumers_drained: true,
      writes_paused: true,
      checkpoint_persisted: true,
      provider_disconnected: true,
      lease_released: false,
      checkpoint_checksum_sha256: 'b'.repeat(64),
      checkpoint_size_bytes: '2048',
      checkpoint_record_count: '18',
      prepared_at: '2026-08-02T18:00:00.000Z',
      error: '',
    });

    await expect(
      (
        deps.handler as unknown as {
          preparePostgresProviderHandoffSource(
            data: Record<string, unknown>,
            lease: ILockLeaseContext
          ): Promise<unknown>;
        }
      ).preparePostgresProviderHandoffSource(
        {
          action: EWorkerAction.cleanup,
          worker_id: 'worker-1',
          account_id: 'account-1',
          server_id: 'server-old',
          worker_type_id: EWorkerType.wwebjs,
          lifecycle_operation_id: context.lifecycle_operation_id,
          session_storage: EWorkerSessionStorage.postgres,
          remove_session: false,
          remove_volume: false,
        },
        {
          signal: new AbortController().signal,
          assertActive: jest.fn(),
        }
      )
    ).resolves.toEqual({ status: 'already_replaced' });

    expect(
      deps.workerRuntimeRepository.failWhatsappProviderHandoffBeforeSourceDrain
    ).toHaveBeenCalledWith({
      worker_id: 'worker-1',
      account_id: 'account-1',
      lifecycle_operation_id: context.lifecycle_operation_id,
      handoff_id: context.handoff_id,
      source_provider: 'wwebjs',
      target_provider: 'baileys',
      source_revision_id: '41',
      target_revision_id: '42',
      runtime_generation: 9,
      source_container_id: 'a'.repeat(64),
      error_code: 'whatsapp_handoff_prepare_proof_invalid',
    });
    expect(
      deps.workerRuntimeRepository
        .acknowledgeWhatsappProviderHandoffSourceDrained
    ).not.toHaveBeenCalled();
    expect(
      deps.workerService.stopContainerWorkerByIdGracefully
    ).not.toHaveBeenCalled();
    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
  });

  it.each([
    [
      EWorkerType.wwebjs,
      'wwebjs',
      'baileys',
      9,
      'whatsapp_artifact_profile_too_large',
      'whatsapp_artifact_profile_too_large',
    ],
    [
      EWorkerType.wwebjs,
      'wwebjs',
      'baileys',
      9,
      'wwebjs_provider_handoff_context_invalid',
      null,
    ],
    [
      EWorkerType.wwebjs,
      'wwebjs',
      'baileys',
      9,
      'whatsapp_artifact_chunk_count_exceeded',
      'whatsapp_artifact_chunk_count_exceeded',
    ],
    [
      EWorkerType.wwebjs,
      'wwebjs',
      'baileys',
      9,
      'whatsapp_artifact_profile_incomplete',
      'whatsapp_artifact_profile_incomplete',
    ],
    [
      EWorkerType.wwebjs,
      'wwebjs',
      'baileys',
      9,
      'whatsapp_artifact_profile_fingerprint_mismatch',
      'whatsapp_artifact_profile_fingerprint_mismatch',
    ],
    [
      EWorkerType.wwebjs,
      'wwebjs',
      'baileys',
      9,
      'whatsapp_artifact_symlink_unsupported',
      'whatsapp_artifact_symlink_unsupported',
    ],
    [
      EWorkerType.wwebjs,
      'wwebjs',
      'baileys',
      9,
      'wwebjs_provider_handoff_native_proof_invalid',
      'wwebjs_provider_handoff_native_proof_invalid',
    ],
    [
      EWorkerType.wwebjs,
      'wwebjs',
      'baileys',
      9,
      'wwebjs_provider_handoff_checkpoint_proof_invalid',
      'wwebjs_provider_handoff_checkpoint_proof_invalid',
    ],
    [
      EWorkerType.wwebjs,
      'wwebjs',
      'baileys',
      9,
      'wwebjs_provider_handoff_browser_termination_unconfirmed',
      'wwebjs_provider_handoff_browser_termination_unconfirmed',
    ],
    [
      EWorkerType.wwebjs,
      'wwebjs',
      'baileys',
      9,
      'wwebjs_profile_anchor_previous_protection_active',
      'wwebjs_profile_anchor_previous_protection_active',
    ],
    [
      EWorkerType.wwebjs,
      'wwebjs',
      'baileys',
      9,
      'whatsapp_session_lease_lost',
      'whatsapp_session_lease_lost',
    ],
    [
      EWorkerType.baileys,
      'baileys',
      'wwebjs',
      9,
      'whatsapp_session_lease_lost',
      'whatsapp_session_lease_lost',
    ],
    [
      EWorkerType.whatsmeow,
      'whatsmeow',
      'baileys',
      9,
      'whatsapp_session_lease_lost',
      'whatsapp_session_lease_lost',
    ],
    [
      EWorkerType.baileys,
      'baileys',
      'wwebjs',
      9,
      'whatsmeow_canonical_routing_info_unavailable',
      null,
    ],
    [
      EWorkerType.whatsmeow,
      'whatsmeow',
      'baileys',
      9,
      'whatsmeow_canonical_routing_info_unavailable',
      null,
    ],
    [
      EWorkerType.wwebjs,
      'wwebjs',
      'baileys',
      9,
      'whatsapp_artifact_profile_changed_during_checkpoint',
      null,
    ],
    [
      EWorkerType.wwebjs,
      'wwebjs',
      'baileys',
      9,
      'whatsapp_artifact_blob_batch_rejected',
      null,
    ],
    [
      EWorkerType.wwebjs,
      'wwebjs',
      'baileys',
      9,
      'terminal prepare rejection with spaces',
      null,
    ],
    [
      EWorkerType.wwebjs,
      'wwebjs',
      'baileys',
      14,
      'whatsapp_artifact_profile_too_large',
      null,
    ],
  ] as const)(
    'classifies provider-scoped rejection (type=%s source=%s target=%s grpc=%s details=%s expected=%s)',
    async (
      sourceWorkerType,
      sourceProvider,
      targetProvider,
      grpcCode,
      details,
      expectedErrorCode
    ) => {
      const deps = buildHandler();
      const context = {
        handoff_id: '00000000-0000-4000-8000-000000000010',
        lifecycle_operation_id: '00000000-0000-4000-8000-000000000011',
        source_provider: sourceProvider,
        target_provider: targetProvider,
        source_revision_id: '41',
        target_revision_id: '42',
        state: 'requested',
      } as const;
      (
        deps.workerRuntimeRepository
          .viewWhatsappProviderHandoffLifecycleContext as jest.Mock
      ).mockResolvedValue(context);
      (
        deps.workerRuntimeRepository.viewByWorkerIdConsistent as jest.Mock
      ).mockResolvedValue({
        worker_id: 'worker-1',
        container_id: 'a'.repeat(64),
        container_name: 'worker-1',
        session_storage: EWorkerSessionStorage.postgres,
        session_volume_name: null,
        runtime_generation: 9,
        source_provider: sourceProvider,
      });
      const rpcError = Object.assign(new Error('prepare rpc failed'), {
        code: grpcCode,
        details,
      });
      (
        deps.workerBaileysGrpcClientService.prepareProviderHandoff as jest.Mock
      ).mockRejectedValue(rpcError);

      const invocation = (
        deps.handler as unknown as {
          preparePostgresProviderHandoffSource(
            data: Record<string, unknown>,
            lease: ILockLeaseContext
          ): Promise<unknown>;
        }
      ).preparePostgresProviderHandoffSource(
        {
          action: EWorkerAction.cleanup,
          worker_id: 'worker-1',
          account_id: 'account-1',
          server_id: 'server-old',
          worker_type_id: sourceWorkerType,
          lifecycle_operation_id: context.lifecycle_operation_id,
          session_storage: EWorkerSessionStorage.postgres,
          remove_session: false,
          remove_volume: false,
        },
        {
          signal: new AbortController().signal,
          assertActive: jest.fn(),
        }
      );

      if (expectedErrorCode) {
        await expect(invocation).resolves.toEqual({
          status: 'already_replaced',
        });
        expect(
          deps.workerRuntimeRepository
            .failWhatsappProviderHandoffBeforeSourceDrain
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            worker_id: 'worker-1',
            account_id: 'account-1',
            lifecycle_operation_id: context.lifecycle_operation_id,
            handoff_id: context.handoff_id,
            source_provider: sourceProvider,
            target_provider: targetProvider,
            source_revision_id: '41',
            target_revision_id: '42',
            runtime_generation: 9,
            source_container_id: 'a'.repeat(64),
            error_code: expectedErrorCode,
          })
        );
      } else {
        await expect(invocation).rejects.toBe(rpcError);
        expect(
          deps.workerRuntimeRepository
            .failWhatsappProviderHandoffBeforeSourceDrain
        ).not.toHaveBeenCalled();
      }
      expect(
        deps.workerRuntimeRepository
          .acknowledgeWhatsappProviderHandoffSourceDrained
      ).not.toHaveBeenCalled();
      expect(
        deps.workerService.stopContainerWorkerByIdGracefully
      ).not.toHaveBeenCalled();
      expect(
        deps.workerService.removeContainerWorkerById
      ).not.toHaveBeenCalled();
    }
  );

  it('never removes the target runtime when a source cleanup is retried after promotion', async () => {
    const deps = buildHandler();
    (
      deps.workerRuntimeRepository
        .viewWhatsappProviderHandoffLifecycleContext as jest.Mock
    ).mockResolvedValue({
      handoff_id: '00000000-0000-4000-8000-000000000010',
      lifecycle_operation_id: '00000000-0000-4000-8000-000000000011',
      source_provider: 'wwebjs',
      target_provider: 'baileys',
      source_revision_id: '41',
      target_revision_id: '42',
      state: 'completed',
    });
    (
      deps.workerRuntimeRepository.viewByWorkerIdConsistent as jest.Mock
    ).mockResolvedValue({
      worker_id: 'worker-1',
      container_id: 'c'.repeat(64),
      session_storage: EWorkerSessionStorage.postgres,
      session_volume_name: null,
      runtime_generation: 10,
      source_provider: 'baileys',
    });

    await expect(
      (
        deps.handler as unknown as {
          preparePostgresProviderHandoffSource(
            data: Record<string, unknown>,
            lease: ILockLeaseContext
          ): Promise<unknown>;
        }
      ).preparePostgresProviderHandoffSource(
        {
          action: EWorkerAction.cleanup,
          worker_id: 'worker-1',
          account_id: 'account-1',
          server_id: 'server-old',
          worker_type_id: EWorkerType.wwebjs,
          lifecycle_operation_id: '00000000-0000-4000-8000-000000000011',
          session_storage: EWorkerSessionStorage.postgres,
          remove_session: false,
          remove_volume: false,
        },
        {
          signal: new AbortController().signal,
          assertActive: jest.fn(),
        }
      )
    ).resolves.toEqual({ status: 'already_replaced' });

    expect(
      deps.workerBaileysGrpcClientService.prepareProviderHandoff
    ).not.toHaveBeenCalled();
    expect(
      deps.workerService.stopContainerWorkerByIdGracefully
    ).not.toHaveBeenCalled();
    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
  });

  it('returns already_replaced without touching the target runtime when source cleanup retries during post-CAS activation', async () => {
    const deps = buildHandler();
    (
      deps.workerRuntimeRepository
        .viewWhatsappProviderHandoffLifecycleContext as jest.Mock
    ).mockResolvedValue({
      handoff_id: '00000000-0000-4000-8000-000000000010',
      lifecycle_operation_id: '00000000-0000-4000-8000-000000000011',
      source_provider: 'wwebjs',
      target_provider: 'baileys',
      source_revision_id: '41',
      target_revision_id: '42',
      state: 'activating',
    });
    (
      deps.workerRuntimeRepository.viewByWorkerIdConsistent as jest.Mock
    ).mockResolvedValue({
      worker_id: 'worker-1',
      container_id: 'c'.repeat(64),
      session_storage: EWorkerSessionStorage.postgres,
      session_volume_name: null,
      runtime_generation: 10,
      source_provider: 'baileys',
    });

    await expect(
      (
        deps.handler as unknown as {
          preparePostgresProviderHandoffSource(
            data: Record<string, unknown>,
            lease: ILockLeaseContext
          ): Promise<unknown>;
        }
      ).preparePostgresProviderHandoffSource(
        {
          action: EWorkerAction.cleanup,
          worker_id: 'worker-1',
          account_id: 'account-1',
          server_id: 'server-old',
          worker_type_id: EWorkerType.wwebjs,
          lifecycle_operation_id: '00000000-0000-4000-8000-000000000011',
          session_storage: EWorkerSessionStorage.postgres,
          remove_session: false,
          remove_volume: false,
        },
        {
          signal: new AbortController().signal,
          assertActive: jest.fn(),
        }
      )
    ).resolves.toEqual({ status: 'already_replaced' });

    expect(
      deps.workerRuntimeRepository.viewByWorkerIdConsistent
    ).not.toHaveBeenCalled();
    expect(
      deps.workerBaileysGrpcClientService.prepareProviderHandoff
    ).not.toHaveBeenCalled();
    expect(
      deps.workerRuntimeRepository
        .acknowledgeWhatsappProviderHandoffSourceDrained
    ).not.toHaveBeenCalled();
    expect(
      deps.workerService.stopContainerWorkerByIdGracefully
    ).not.toHaveBeenCalled();
    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
    expect(
      deps.workerService.removeContainerByNameAndVolume
    ).not.toHaveBeenCalled();
  });

  it('keeps a cleanup bound to the drained source when the target replaces worker_runtime before removal', async () => {
    const deps = buildHandler();
    (
      deps.workerRuntimeRepository.viewByWorkerIdConsistent as jest.Mock
    ).mockResolvedValue({
      worker_id: 'worker-1',
      container_id: 'c'.repeat(64),
      session_storage: EWorkerSessionStorage.postgres,
      session_volume_name: null,
      runtime_generation: 10,
      source_provider: 'baileys',
    });

    const removed = await (
      deps.handler as unknown as {
        removeRuntimeContainerWithLifecycleProof(
          data: Record<string, unknown>,
          removeVolume: boolean,
          initialWorker: Record<string, unknown>,
          lease: ILockLeaseContext,
          boundSourceRuntime: {
            containerId: string;
            runtimeGeneration: number;
            sourceProvider: string;
          }
        ): Promise<boolean>;
      }
    ).removeRuntimeContainerWithLifecycleProof(
      {
        action: EWorkerAction.cleanup,
        worker_id: 'worker-1',
        account_id: 'account-1',
        lifecycle_operation_id: '00000000-0000-4000-8000-000000000011',
      },
      false,
      {},
      {
        signal: new AbortController().signal,
        assertActive: jest.fn(),
      },
      {
        containerId: 'a'.repeat(64),
        runtimeGeneration: 9,
        sourceProvider: 'wwebjs',
      }
    );

    expect(removed).toBe(true);
    expect(deps.workerService.removeContainerWorkerById).not.toHaveBeenCalled();
    expect(
      deps.workerService.inspectContainerWorkerByIdStrict
    ).not.toHaveBeenCalled();
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

  it('returns absence only for a confirmed 404 in strict Docker checks', async () => {
    const workerService = buildActualWorkerService();
    const notFoundError = Object.assign(new Error('not found'), {
      statusCode: 404,
    });
    (
      workerService as unknown as {
        docker: {
          getContainer: jest.Mock;
          getVolume: jest.Mock;
        };
      }
    ).docker = {
      getContainer: jest.fn(() => ({
        inspect: jest.fn(async () => {
          throw notFoundError;
        }),
      })),
      getVolume: jest.fn(() => ({
        inspect: jest.fn(async () => {
          throw notFoundError;
        }),
      })),
    };

    await expect(
      workerService.inspectContainerWorkerByIdStrict('worker-missing')
    ).resolves.toMatchObject({
      exists: false,
      container_name: 'worker-missing',
    });
    await expect(
      workerService.existsVolumeByNameStrict('volume-missing')
    ).resolves.toBe(false);
  });

  it('propagates transient Docker failures from strict lifecycle checks', async () => {
    const workerService = buildActualWorkerService();
    const dockerError = Object.assign(new Error('docker daemon unavailable'), {
      statusCode: 500,
    });
    (
      workerService as unknown as {
        docker: {
          getContainer: jest.Mock;
          getVolume: jest.Mock;
        };
      }
    ).docker = {
      getContainer: jest.fn(() => ({
        inspect: jest.fn(async () => {
          throw dockerError;
        }),
      })),
      getVolume: jest.fn(() => ({
        inspect: jest.fn(async () => {
          throw dockerError;
        }),
      })),
    };

    await expect(
      workerService.inspectContainerWorkerByIdStrict('worker-error')
    ).rejects.toThrow('docker daemon unavailable');
    await expect(
      workerService.existsVolumeByNameStrict('volume-error')
    ).rejects.toThrow('docker daemon unavailable');
  });

  it('does not classify a non-404 Docker error containing not found as absence', async () => {
    const workerService = buildActualWorkerService();
    const misleadingError = Object.assign(
      new Error('Docker API route not found'),
      { statusCode: 500 }
    );
    (
      workerService as unknown as {
        docker: {
          getContainer: jest.Mock;
        };
      }
    ).docker = {
      getContainer: jest.fn(() => ({
        inspect: jest.fn(async () => {
          throw misleadingError;
        }),
      })),
    };

    await expect(
      workerService.inspectContainerWorkerByIdStrict('worker-error')
    ).rejects.toBe(misleadingError);
  });

  it('bounds a strict Docker inspect that never settles', async () => {
    jest.useFakeTimers();
    try {
      const workerService = buildActualWorkerService();
      (
        workerService as unknown as {
          docker: {
            getContainer: jest.Mock;
          };
        }
      ).docker = {
        getContainer: jest.fn(() => ({
          inspect: jest.fn(
            () => new Promise<WorkerContainerInspection>(() => undefined)
          ),
        })),
      };

      const pending =
        workerService.inspectContainerWorkerByIdStrict('worker-hung');
      const rejection = expect(pending).rejects.toThrow(
        'worker_docker_strict_inspect_timeout'
      );
      await jest.advanceTimersByTimeAsync(
        WORKER_LIVENESS_LOCAL_DOCKER_READ_TIMEOUT_MS
      );

      await rejection;
    } finally {
      jest.useRealTimers();
    }
  });

  it('bounds a strict Docker volume inspect that never settles', async () => {
    jest.useFakeTimers();
    try {
      const workerService = buildActualWorkerService();
      (
        workerService as unknown as {
          docker: {
            getVolume: jest.Mock;
          };
        }
      ).docker = {
        getVolume: jest.fn(() => ({
          inspect: jest.fn(
            () => new Promise<Record<string, unknown>>(() => undefined)
          ),
        })),
      };

      const pending = workerService.existsVolumeByNameStrict('volume-hung');
      const rejection = expect(pending).rejects.toThrow(
        'worker_docker_strict_inspect_timeout'
      );
      await jest.advanceTimersByTimeAsync(
        WORKER_LIVENESS_LOCAL_DOCKER_READ_TIMEOUT_MS
      );

      await rejection;
    } finally {
      jest.useRealTimers();
    }
  });
});
