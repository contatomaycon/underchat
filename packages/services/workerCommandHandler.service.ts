import { injectable, inject } from 'tsyringe';
import { status as GrpcStatus, type ServiceError } from '@grpc/grpc-js';
import Redis from 'ioredis';
import { v7 as uuidv7 } from 'uuid';
import {
  WorkerContainerInspection,
  WorkerService,
  type WorkerVolumeInspection,
} from '@core/services/worker.service';
import { getImageWorker } from '@core/common/functions/getImageWorker';
import { IUpdateWorker } from '@core/common/interfaces/IUpdateWorker';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { IWorkerPayload } from '@core/common/interfaces/IWorkerPayload';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { ChatService } from '@core/services/chat.service';
import { PublishResult } from 'centrifuge';
import type {
  PermanentWorkerDeletionIntentAuthorization,
  PermanentWorkerTopicDeletionRequest,
} from '@core/common/interfaces/IWorkerTopicLifecycle';
import { WorkerCommandResourceLifecycleService } from '@core/services/workerCommandResourceLifecycle.service';
import {
  ContainerHealthService,
  type ContainerHealthCheckOptions,
  type ContainerHealthResult,
} from '@core/services/containerHealth.service';
import { StatusConnectionWorkerRequest } from '@core/schema/worker/statusConnection/request.schema';
import {
  isWorkerConnectionDeadlineExceeded,
  WorkerBaileysGrpcClientService,
} from '@core/services/workerBaileysGrpcClient.service';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import {
  isWhatsappConnectionOnline,
  normalizeWhatsappConnectionStatus,
} from '@core/common/functions/whatsappConnectionStatus';
import { isWhatsappQrAttemptExhaustedState } from '@core/common/functions/isWhatsappQrAttemptExhaustedState';
import {
  buildManagerWorkerRecreateCompletedStatusEvent,
  buildManagerWorkerRecreateRuntimeRetiredStatusEvent,
  buildManagerWorkerRecreateRuntimeStartedStatusEvent,
  buildManagerWorkerRecreateTerminalStatusEvent,
} from '@core/common/functions/workerLifecycleRealtimeStatus';
import { EWhatsappConnectionStatus } from '@core/common/enums/EWhatsappConnectionStatus';
import { IWhatsappConnectionStatus } from '@core/common/interfaces/IWhatsappConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';
import {
  workerCentrifugoQueue,
  channelsConfigCentrifugo,
} from '@core/common/functions/centrifugoQueue';
import { balanceEnvironment } from '@core/config/environments';
import { getErrorMessage } from '@core/common/functions/toError';
import { INotifyWorkerStatusRequestProto } from '@core/common/interfaces/INotifyWorkerStatusRequestProto';
import {
  IWhatsappRuntimeFenceActivationRequestProto,
  IWhatsappRuntimeFenceActivationResponseProto,
} from '@core/common/interfaces/IWhatsappRuntimeFenceActivationProto';
import { currentTime } from '@core/common/functions/currentTime';
import { IResolveIncomingCallActionRequestProto } from '@core/common/interfaces/IResolveIncomingCallActionRequestProto';
import { IResolveIncomingCallActionResponseProto } from '@core/common/interfaces/IResolveIncomingCallActionResponseProto';
import { IGetTypingSimulationConfigRequestProto } from '@core/common/interfaces/IGetTypingSimulationConfigRequestProto';
import { IGetTypingSimulationConfigResponseProto } from '@core/common/interfaces/IGetTypingSimulationConfigResponseProto';
import { IPhoneValidationRequest } from '@core/common/interfaces/IPhoneValidationRequest';
import { IPhoneValidationResponse } from '@core/common/interfaces/IPhoneValidationResponse';
import { ISecureConnectionImportRequest } from '@core/common/interfaces/ISecureConnectionSession';
import { IRegisterS3BackupFallbackUploadRequestProto } from '@core/common/interfaces/IRegisterS3BackupFallbackUploadRequestProto';
import { IWorkerSelfHealingRequestProto } from '@core/common/interfaces/IWorkerSelfHealingRequestProto';
import { ServerSshViewerRepository } from '@core/repositories/server/ServerSshViewer.repository';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import { WorkerConfigViewerRepository } from '@core/repositories/worker/WorkerConfigViewer.repository';
import { EWorkerConfigType } from '@core/common/enums/EWorkerConfigType';
import { EWorkerConfigStatus } from '@core/common/enums/EWorkerConfigStatus';
import { EProxyProtocol } from '@core/common/enums/EProxyProtocol';
import { S3BackupUploadService } from '@core/services/s3BackupUpload.service';
import { WorkerConfigService } from '@core/services/workerConfig.service';
import { defaultTypingSimulationConfig } from '@core/common/functions/typingSimulationConfig';
import { WorkerLifecycleLockService } from '@core/services/workerLifecycleLock.service';
import {
  CONVERTED_WARM_RECLAIM_MARKER,
  LEGACY_WARM_RECLAIM_MARKER,
  type LegacyWarmReclaimInput,
  WorkerWarmPoolRepository,
} from '@core/repositories/worker/WorkerWarmPool.repository';
import {
  StaleWorkerRuntimeGenerationError,
  WorkerRuntimeRepository,
} from '@core/repositories/worker/WorkerRuntime.repository';
import { EWorkerWarmPoolState } from '@core/common/enums/EWorkerWarmPoolState';
import { IWorkerWarmPool } from '@core/common/interfaces/IWorkerWarmPool';
import { IWorkerRuntime } from '@core/common/interfaces/IWorkerRuntime';
import {
  IActivateWarmWorkerRequestProto,
  ICreateWarmWorkerRequestProto,
  IDeleteWarmWorkerRequestProto,
  IWarmWorkerCommandResponseProto,
} from '@core/common/interfaces/IWorkerWarmCommandProto';
import { IWorkerConnectionQrCodeQueueMessage } from '@core/common/interfaces/IWorkerConnectionQrCodeQueueMessage';
import { WorkerConnectionQrCodeRedisQueueService } from '@core/services/workerConnectionQrCodeRedisQueue.service';
import {
  IWorkerRuntimeHealthRequestProto,
  IWorkerRuntimeHealthResponseProto,
} from '@core/common/interfaces/IWorkerRuntimeActivationProto';
import {
  IPrepareSessionStorageMigrationRequestProto,
  IPrepareSessionStorageMigrationResponseProto,
} from '@core/common/interfaces/ISessionStorageMigrationPrepareProto';
import {
  ILegacySessionVolumeDeleteRequestProto,
  ILegacySessionVolumeDeleteResponseProto,
} from '@core/common/interfaces/ILegacySessionVolumeDeleteProto';
import {
  ConnectionLifecycleDebugContext,
  ConnectionLifecycleDebugService,
} from '@core/services/connectionLifecycleDebug.service';
import { ILockLeaseContext } from '@core/common/functions/withLock';
import { logLocalConnectionStatus } from '@core/common/functions/localConnectionStatusLog';
import {
  WorkerSelfHealRecoveryState,
  parseWorkerSelfHealRecoveryState,
  workerSelfHealCooldownKey,
  workerSelfHealInflightKey,
  workerSelfHealRecoveryKey,
} from '@core/common/functions/workerSelfHealingKeys';
import {
  type WorkerRecreateServerSlotControl,
  type WorkerRecreateServerSlotLease,
  WorkerRecreateServerSlotService,
} from '@core/services/workerRecreateServerSlot.service';
import { WorkerLifecycleQueueService } from '@core/services/workerLifecycleQueue.service';
import { IWorkerLifecycleQueueMessage } from '@core/common/interfaces/IWorkerLifecycleQueueMessage';
import { WhatsappRuntimeFenceService } from '@core/services/whatsappRuntimeFence.service';
import { workerProxyFingerprint } from '@core/common/functions/workerProxyFingerprint';
import { WARM_ACTIVATION_CONFIRMED_CLEANUP } from '@core/common/functions/workerWarmActivationOutcome';
import { IWorkerMonitor } from '@core/common/interfaces/IWorkerMonitor';
import {
  WORKER_LIVENESS_LOCAL_DOCKER_READ_TIMEOUT_MS,
  WORKER_LIVENESS_LIFECYCLE_HEARTBEAT_MS,
  WORKER_LIVENESS_LIFECYCLE_LEASE_TTL_MS,
} from '@core/common/functions/workerContainerLivenessPolicy';
import { workerLifecycleSemanticFingerprint } from '@core/common/functions/workerLifecycleSemanticFingerprint';
import { workerLifecycleBudgets } from '@core/common/functions/workerLifecycleBudgets';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { supportsWhatsappSessionStorage } from '@core/common/functions/workerSessionStorage';
import { isWhatsappQrCredentialConsumedState } from '@core/common/functions/isWhatsappQrCredentialConsumedState';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { planCompletedWhatsappProviderHandoffLifecycle } from '@core/common/functions/whatsappProviderHandoffLifecycleCompletion';

const WARM_STANDBY_HEALTH_MAX_ATTEMPTS = 10;
const WARM_STANDBY_HEALTH_RETRY_BASE_MS = 250;
const WARM_STANDBY_HEALTH_RETRY_MAX_MS = 5_000;
const WARM_ACTIVATION_HEALTH_MAX_ATTEMPTS = 30;
const WARM_ACTIVATION_HEALTH_RETRY_BASE_MS = 250;
const WARM_ACTIVATION_HEALTH_RETRY_MAX_MS = 2_000;
const WARM_ONLINE_HEALTH_STABILITY_ATTEMPTS = 3;
const WARM_ACTIVATION_RESERVATION_EXTENSION_MS = 10 * 60 * 1_000;
const WARM_ACTIVATION_SERVER_SLOT_ACQUIRE_TIMEOUT_MS = 15_000;
const WARM_CREATION_LOCK_TTL_MS = 75_000;
const WARM_CREATION_LOCK_HEARTBEAT_MS = 15_000;
const CONNECTION_DISCONNECT_LOCK_ACQUIRE_TIMEOUT_MS = 10_000;
const CONNECTION_DISCONNECT_LOCK_TTL_MS = 90_000;
const CONNECTION_DISCONNECT_LOCK_HEARTBEAT_MS = 15_000;
const CONNECTION_DISCONNECT_FINALIZE_RETRY_MS = 5_000;
const CONNECTION_DISCONNECT_FINALIZE_POLL_MS = 100;
const WARM_ACTIVATION_CLEANUP_MARKER = 'warm_activation_cleanup_confirmed';
const WARM_ACTIVATION_CLEANUP_PENDING_MARKER =
  'warm_activation_cleanup_pending';
const WARM_ACTIVATION_PREFLIGHT_CLEANUP_MARKER =
  'warm_activation_preflight_cleanup_confirmed';
const WARM_ACTIVATION_PREFLIGHT_PENDING_MARKER =
  'warm_activation_preflight_cleanup_pending';
const DOCKER_CONTAINER_ID_PATTERN = /^[0-9a-f]{64}$/i;
const WHATSAPP_HANDOFF_PREPARE_ERROR_CODE_PATTERN = /^[a-z0-9_.:-]{1,100}$/u;
const WHATSAPP_HANDOFF_PREPARE_PROOF_INVALID =
  'whatsapp_handoff_prepare_proof_invalid';
const PROVIDER_HANDOFF_SOURCE_UNAVAILABLE_FAILURE_CODES = new Set([
  'whatsapp_session_lease_lost',
]);
const WWEBJS_HANDOFF_POST_TEARDOWN_ARTIFACT_FAILURE_CODES = new Set([
  'whatsapp_artifact_profile_too_large',
  'whatsapp_artifact_chunk_count_exceeded',
  'whatsapp_artifact_profile_incomplete',
  'whatsapp_artifact_profile_fingerprint_mismatch',
  'whatsapp_artifact_symlink_unsupported',
]);
const WWEBJS_HANDOFF_POST_TEARDOWN_FAILURE_CODES = new Set([
  'wwebjs_provider_handoff_native_proof_invalid',
  'wwebjs_provider_handoff_checkpoint_proof_invalid',
  'wwebjs_provider_handoff_browser_termination_unconfirmed',
  'wwebjs_profile_anchor_previous_protection_active',
]);
const WHATSMEOW_HANDOFF_PRE_DRAIN_TERMINAL_FAILURE_CODES = new Set([
  'whatsapp_whatsmeow_handoff_source_state_conflict',
]);
type WhatsappRuntimeProvider = 'baileys' | 'wwebjs' | 'whatsmeow';

const resolveWhatsappHandoffPreDrainFailureCode = (
  error: unknown,
  sourceProvider: WhatsappRuntimeProvider
): string | undefined => {
  if (!error || typeof error !== 'object') return undefined;
  const grpcError = error as Partial<ServiceError>;
  if (
    grpcError.code !== GrpcStatus.FAILED_PRECONDITION ||
    typeof grpcError.details !== 'string' ||
    !WHATSAPP_HANDOFF_PREPARE_ERROR_CODE_PATTERN.test(grpcError.details)
  ) {
    return undefined;
  }
  if (
    PROVIDER_HANDOFF_SOURCE_UNAVAILABLE_FAILURE_CODES.has(grpcError.details)
  ) {
    return grpcError.details;
  }
  // RemoteAuth emits these five deterministic profile validation errors only
  // after terminating Chromium; its catch then closes the store. Do not match
  // the whole artifact family: it also contains retryable snapshot changes and
  // database/fence rejections. The service proof errors are likewise evaluated
  // only after native prepare returned or browser termination ran. Earlier
  // WWebJS context/preflight failures deliberately remain retryable.
  if (
    sourceProvider === 'wwebjs' &&
    (WWEBJS_HANDOFF_POST_TEARDOWN_ARTIFACT_FAILURE_CODES.has(
      grpcError.details
    ) ||
      WWEBJS_HANDOFF_POST_TEARDOWN_FAILURE_CODES.has(grpcError.details))
  ) {
    return grpcError.details;
  }
  if (
    sourceProvider === 'whatsmeow' &&
    WHATSMEOW_HANDOFF_PRE_DRAIN_TERMINAL_FAILURE_CODES.has(grpcError.details)
  ) {
    return grpcError.details;
  }
  return undefined;
};

const WORKER_TYPE_SOURCE_PROVIDER: Partial<
  Record<EWorkerType, WhatsappRuntimeProvider>
> = {
  [EWorkerType.baileys]: 'baileys',
  [EWorkerType.wwebjs]: 'wwebjs',
  [EWorkerType.whatsmeow]: 'whatsmeow',
};
const ACTIVE_PROVIDER_STATES = new Set([
  'connected',
  'open',
  'ready',
  'kafka_consumers_not_ready',
]);
const FUNCTIONAL_DEGRADATION_MARKERS = [
  'connecting',
  'disconnected',
  'disconnecting',
  'offline',
  'closed',
  'kafka_consumers_not_ready',
  'kafka_not_ready',
  'kafka_unhealthy',
  'missing_client_info',
  'event_bridge_not_attached',
  'missing_local_session',
  'store_wwebjs_not_ready',
  'session_probe_failed',
  'self_jid_not_registered',
  'registration_probe_unavailable',
] as const;

class WarmCreationLeaseRecoveryRequiredError extends Error {
  constructor(readonly originalError: unknown) {
    super('warm_creation_lease_recovery_required', {
      cause: originalError,
    });
    this.name = 'WarmCreationLeaseRecoveryRequiredError';
  }
}

export class WorkerOnlineReadinessRejectedError extends Error {
  constructor(reason?: string) {
    super(
      reason
        ? `worker_online_readiness_rejected:${reason}`
        : 'worker_online_readiness_rejected'
    );
    this.name = 'WorkerOnlineReadinessRejectedError';
  }
}

interface ResolvedWorkerDataForContainer {
  accountIdResolved: string;
  serverId: string;
  serverName?: string;
  serverWebDomain?: string;
  workerTypeId: EWorkerType;
  workerTypeName?: string;
  workerStatusId?: EWorkerStatus;
  controlContainerId?: string | null;
  runtimeContainerId?: string | null;
  containerId?: string | null;
  lifecycleOperationId?: string | null;
  runtimeGeneration?: number;
  warmPoolId?: string | null;
  recreateBootstrapOperationId?: string | null;
  recreateBootstrapRuntimeGeneration?: number | null;
  recreateBootstrapContainerId?: string | null;
  recreateBootstrapStartedAt?: string | null;
  recreateRetiredOperationId?: string | null;
  recreateRetiredRuntimeGeneration?: number | null;
  recreateRetiredContainerId?: string | null;
  recreateRetiredAt?: string | null;
  connectionEpoch?: string | null;
  disconnectedConnectionEpoch?: string | null;
  connectionDisconnectedAt?: string | null;
}

const DISCONNECTED_USER_RUNTIME_POINTER_STATUSES = new Set<EWorkerStatus>([
  EWorkerStatus.disponible,
  EWorkerStatus.offline,
  EWorkerStatus.mismatched,
  EWorkerStatus.error,
]);
const UNAVAILABLE_RECREATE_PREVIOUS_STATUSES = new Set<EWorkerStatus>([
  EWorkerStatus.disponible,
  EWorkerStatus.offline,
  EWorkerStatus.mismatched,
  EWorkerStatus.error,
  EWorkerStatus.stopped,
  EWorkerStatus.connecting,
]);

interface RuntimeFunctionalEvidence {
  status?: EBaileysConnectionStatus;
  session_ready?: boolean;
  can_send?: boolean;
  can_receive_runtime?: boolean;
  provider_state?: string;
  degraded_reason?: string;
  reason?: string;
  error?: string;
  kafka_unhealthy?: boolean;
  kafka_consumers_ready?: boolean;
  kafka_consumers_authorized?: boolean;
  runtime_health_schema_version?: number;
}

type ValidatedActivateWarmWorkerRequest = IActivateWarmWorkerRequestProto &
  Required<
    Pick<
      IActivateWarmWorkerRequestProto,
      | 'warm_pool_id'
      | 'worker_id'
      | 'account_id'
      | 'server_id'
      | 'worker_type_id'
    >
  >;

type ValidatedCreateWarmWorkerRequest = ICreateWarmWorkerRequestProto &
  Required<
    Pick<
      ICreateWarmWorkerRequestProto,
      'warm_pool_id' | 'server_id' | 'worker_type_id'
    >
  >;

interface WarmWorkerRuntimeReference {
  container_id: string;
  container_name: string;
  session_volume_name: string;
}

interface WarmWorkerIdentityRequest {
  warm_pool_id: string;
  server_id: string;
  worker_type_id: string;
}

interface ResolvedWorkerProxyConfig {
  protocol: EProxyProtocol;
  host: string;
  port: number;
  username?: string | null;
  password?: string | null;
}

interface RecreateConnectionReconciliation {
  workerStatusId: EWorkerStatus;
  connectionState?: IBaileysConnectionState;
}

interface RecreatedWorkerRuntimeHealthProbe {
  reconciliation: RecreateConnectionReconciliation | null;
  hasDurableSession: boolean;
  providerHandoffOnlineSessionReady: boolean;
}

type PostgresProviderHandoffReconciliationMode =
  | 'not_applicable'
  | 'handoff'
  | 'recovery'
  | 'interactive_discard'
  | 'interactive_empty';

interface CreateWorkerOptions {
  healthOptions?: ContainerHealthCheckOptions;
  proxyOverride?: ResolvedWorkerProxyConfig | null;
  proxyMode?: 'proxy' | 'direct' | 'direct_fallback';
}

interface WorkerLifecycleUpdateOptions {
  expectedWorkerStatusId?: EWorkerStatus;
  expectedControlContainerId?: string;
  expectedRuntimeContainerId?: string;
  expectedRuntimeGeneration?: number;
  completeRecreate?: boolean;
}

interface ActiveQrAttempt {
  ack: IBaileysConnectionState;
  queued_at: string;
  stream_key: string;
  stream_id?: string;
  consumer_group: string;
  source: 'manager';
  worker_type_id: EWorkerType;
  runtime_generation?: number;
}

interface RecreateSessionVolumeResolution {
  sessionVolumeName?: string;
  runtimeGeneration?: number;
  sessionDeletionRuntimeFence?: WhatsappSessionDeletionRuntimeFence | null;
  source:
    | 'worker_runtime'
    | 'container_label'
    | 'container_env'
    | 'legacy_worker_id'
    | 'postgres'
    | 'reset';
  runtimeWasBackfilled: boolean;
}

interface WhatsappSessionDeletionRuntimeFence {
  runtime_generation: number;
  container_id: string | null;
  session_storage: EWorkerSessionStorage;
  session_volume_name: string | null;
}

interface RuntimeRemovalIdentity {
  containerId: string;
  runtimeGeneration: number;
  sessionStorage: EWorkerSessionStorage;
  sessionVolumeName: string | null;
}

interface RuntimeRemovalDatabaseIdentity extends RuntimeRemovalIdentity {
  workerStatusId: EWorkerStatus;
}

type LivenessRecreatePreflightDecision = 'proceed' | 'recovered' | 'stale';

interface WorkerLifecycleLeaseOptions {
  ttlMs?: number;
  acquireTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  signal?: AbortSignal;
}

interface RecreateRuntimeRemovalDecision {
  status: 'removed' | 'recovered' | 'pending' | 'stale' | 'retry';
  reason: string;
}

type PersistedColdRuntimeAdoptionResult =
  | {
      status: 'adopted';
      containerId: string;
      runtimeGeneration: number;
    }
  | {
      status: 'stale_image_removed';
      runtimeGeneration: number;
    }
  | {
      status: 'absent_cross_server_handoff_target';
      runtimeGeneration: number;
    }
  | {
      status: 'reserved_cross_server_handoff_target';
      runtimeGeneration: number;
    };

interface RecreateExecutionContext {
  currentWorker: IWorkerMonitor;
  workerType: EWorkerType;
}

type LivenessRecoveryCompensationOutcome =
  'not_ready' | 'restored' | 'superseded';

type OwnedLivenessReplacementDecision =
  'not_applicable' | 'recovered' | 'removed' | 'reprovision';

type OwnedLivenessReplacementPhysicalDecision =
  | { status: 'grace' }
  | { status: 'incomplete' }
  | {
      status: 'terminal';
      startedAt: string;
      restartCount: number;
      healthStatus: string;
      paused: boolean;
    };

class WorkerLivenessRecreateRetryError extends Error {
  constructor(readonly reason: string) {
    super(`worker_recreate_liveness_fence_retry:${reason}`);
    this.name = 'WorkerLivenessRecreateRetryError';
    Object.setPrototypeOf(this, WorkerLivenessRecreateRetryError.prototype);
  }
}

class WorkerCreateAttemptError extends Error {
  constructor(
    message: string,
    readonly reason: string,
    readonly containerId?: string,
    readonly healthResult?: ContainerHealthResult
  ) {
    super(message);
    this.name = 'WorkerCreateAttemptError';
    Object.setPrototypeOf(this, WorkerCreateAttemptError.prototype);
  }
}

@injectable()
export class WorkerCommandHandlerService {
  private readonly maxRetries = 5;
  private readonly retryIntervalMs = 30 * 1000;
  private readonly connectionRequestRetryIntervalMs = 15_000;
  private readonly connectionRequestMinAttempts = 10;
  private readonly recreateOnlineReconciliationWaitMs =
    workerLifecycleBudgets.recreateConnectionConfirmationWaitMs;
  private readonly sessionStorageMigrationOnlineReconciliationWaitMs =
    workerLifecycleBudgets.sessionStorageMigrationConnectionConfirmationWaitMs;
  private readonly providerHandoffOnlineReconciliationWaitMs =
    workerLifecycleBudgets.providerHandoffConnectionConfirmationWaitMs;
  private readonly recreateOnlineReconciliationPollIntervalMs = 500;
  private readonly livenessStartingRecoveryWaitMs = 120_000;
  private readonly livenessStartingRecoveryPollIntervalMs = 5_000;
  private readonly qrAttemptTtlSeconds = 180;
  private readonly qrCacheTtlSeconds = 115;
  private readonly qrMaxAgeMs = 120_000;
  private readonly selfHealInflightTtlSeconds = 20 * 60;
  private readonly selfHealCooldownSeconds = 30 * 60;
  private readonly selfHealRecoveryWindowSeconds = Math.max(
    60,
    Number(process.env.WORKER_SELF_HEAL_RECOVERY_WINDOW_SECONDS) || 10 * 60
  );
  private connectionRequestTimers = new Map<string, NodeJS.Timeout>();
  private connectionRequestAttempts = new Map<string, number>();
  private connectionRequestPayloads = new Map<
    string,
    StatusConnectionWorkerRequest
  >();
  private readonly runtimeWriterIdentities = new Map<
    string,
    { runtimeCapability: string; writerEpoch: string }
  >();
  private readonly defaultCallAction: IResolveIncomingCallActionResponseProto =
    {
      reject_call: false,
      show_message_on_call: false,
      show_message_text: '',
    };

  constructor(
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject(ChatService)
    private readonly chatService: ChatService,
    @inject(WorkerCommandResourceLifecycleService)
    private readonly workerCommandResourceLifecycleService: WorkerCommandResourceLifecycleService,
    @inject(ContainerHealthService)
    private readonly containerHealthService: ContainerHealthService,
    @inject(WorkerBaileysGrpcClientService)
    private readonly workerBaileysGrpcClientService: WorkerBaileysGrpcClientService,
    @inject(ServerSshViewerRepository)
    private readonly serverSshViewerRepository: ServerSshViewerRepository,
    @inject(WorkerConfigViewerRepository)
    private readonly workerConfigViewerRepository: WorkerConfigViewerRepository,
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService,
    @inject(S3BackupUploadService)
    private readonly s3BackupUploadService: S3BackupUploadService,
    @inject(WorkerConfigService)
    private readonly workerConfigService: WorkerConfigService,
    @inject(WorkerLifecycleLockService)
    private readonly workerLifecycleLockService: WorkerLifecycleLockService,
    @inject('Redis')
    private readonly redis: Redis,
    @inject(WorkerLifecycleQueueService)
    private readonly workerLifecycleQueueService: WorkerLifecycleQueueService,
    @inject(WorkerConnectionQrCodeRedisQueueService)
    private readonly redisQueueService: WorkerConnectionQrCodeRedisQueueService = new WorkerConnectionQrCodeRedisQueueService(
      redis
    ),
    @inject(WorkerWarmPoolRepository)
    private readonly workerWarmPoolRepository: WorkerWarmPoolRepository = undefined as never,
    @inject(WorkerRuntimeRepository)
    private readonly workerRuntimeRepository: WorkerRuntimeRepository = undefined as never,
    @inject(ConnectionLifecycleDebugService)
    private readonly connectionLifecycleDebugService: ConnectionLifecycleDebugService = {
      log: async () => undefined,
    } as unknown as ConnectionLifecycleDebugService,
    @inject(WorkerRecreateServerSlotService)
    private readonly workerRecreateServerSlotService: WorkerRecreateServerSlotService = new WorkerRecreateServerSlotService(
      redis
    )
  ) {}

  private logDebug(
    event: string,
    context: ConnectionLifecycleDebugContext
  ): void {
    void this.connectionLifecycleDebugService.log(event, context);
    logLocalConnectionStatus(event, context);
  }

  private optionalRuntimeGeneration(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
      return value;
    }

    if (typeof value === 'string' && value.trim()) {
      const parsed = Number.parseInt(value, 10);
      return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
    }

    return undefined;
  }

  private isCurrentRecreateBootstrapReady(
    worker: ResolvedWorkerDataForContainer | null
  ): boolean {
    if (!worker) {
      return false;
    }
    const lifecycleOperationId = worker.lifecycleOperationId?.trim();
    const runtimeContainerId = worker.runtimeContainerId?.trim().toLowerCase();
    const bootstrapContainerId = worker.recreateBootstrapContainerId
      ?.trim()
      .toLowerCase();
    const retirementIsClear = Boolean(
      (worker.recreateRetiredOperationId === null ||
        worker.recreateRetiredOperationId === undefined) &&
      (worker.recreateRetiredRuntimeGeneration === null ||
        worker.recreateRetiredRuntimeGeneration === undefined) &&
      (worker.recreateRetiredContainerId === null ||
        worker.recreateRetiredContainerId === undefined) &&
      (worker.recreateRetiredAt === null ||
        worker.recreateRetiredAt === undefined)
    );

    return Boolean(
      worker.workerStatusId === EWorkerStatus.recreating &&
      lifecycleOperationId &&
      runtimeContainerId &&
      bootstrapContainerId &&
      worker.recreateBootstrapOperationId === lifecycleOperationId &&
      worker.recreateBootstrapRuntimeGeneration === worker.runtimeGeneration &&
      bootstrapContainerId === runtimeContainerId &&
      worker.recreateBootstrapStartedAt &&
      retirementIsClear
    );
  }

  private sessionStorageFor(data: {
    session_storage?: string;
  }): EWorkerSessionStorage {
    if (
      !data.session_storage ||
      !Object.values(EWorkerSessionStorage).includes(
        data.session_storage as EWorkerSessionStorage
      )
    ) {
      throw new Error('worker_session_storage_authoritative_fence_changed');
    }
    return data.session_storage as EWorkerSessionStorage;
  }

  /**
   * A legacy Docker volume is local to its runtime and cannot cross either a
   * provider or server boundary.  The update claim deliberately changes the
   * worker row to PostgreSQL before the source cleanup runs, so the target
   * storage and the source runtime storage differ for this one lifecycle.
   *
   * Keep the exception explicit and destructive: it is valid only for the
   * journaled legacy -> PostgreSQL conversion, with both source-session and
   * source-volume removal requested.  A normal legacy recreate never enters
   * this branch and continues to preserve its volume.
   */
  private isLegacyVolumeToPostgresConversion(data: IWorkerPayload): boolean {
    return (
      (data.action === EWorkerAction.recreate ||
        data.action === EWorkerAction.cleanup) &&
      data.session_storage === EWorkerSessionStorage.postgres &&
      data.previous_session_storage === EWorkerSessionStorage.legacy_volume &&
      data.remove_session === true &&
      data.remove_volume === true
    );
  }

  private hasValidSessionStorageMigrationIdentity(
    data: IWorkerPayload
  ): boolean {
    return Boolean(
      data.action === EWorkerAction.recreate &&
      data.session_storage_migration_id &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        data.session_storage_migration_id
      ) &&
      data.legacy_session_volume_name &&
      data.legacy_session_volume_name.length <= 255 &&
      !/[\\/\u0000]/u.test(data.legacy_session_volume_name) &&
      data.remove_session === false &&
      data.remove_volume === false
    );
  }

  private hasValidSessionStorageMigrationMetadata(
    data: IWorkerPayload
  ): boolean {
    return (
      this.hasValidSessionStorageMigrationIdentity(data) &&
      /^[0-9a-f]{64}$/u.test(data.legacy_session_checksum ?? '')
    );
  }

  private isSafeSessionStorageMigration(data: IWorkerPayload): boolean {
    return (
      this.hasValidSessionStorageMigrationMetadata(data) &&
      data.session_storage === EWorkerSessionStorage.postgres &&
      (data.previous_session_storage === EWorkerSessionStorage.legacy_volume ||
        data.previous_session_storage === EWorkerSessionStorage.postgres)
    );
  }

  private isSafeSessionStorageMigrationRestore(data: IWorkerPayload): boolean {
    return (
      this.hasValidSessionStorageMigrationIdentity(data) &&
      data.session_storage === EWorkerSessionStorage.legacy_volume &&
      data.previous_session_storage === EWorkerSessionStorage.postgres
    );
  }

  /**
   * The storage orchestrator performs one final PostgreSQL-only recreate after
   * promoting the imported revision. This boot must inherit the protected
   * online reconciliation budget, but it must never inherit legacy volume
   * metadata (which would remount/import the rollback source again).
   *
   * Requiring the journal operation/fingerprint keeps an unfenced ordinary
   * recreate on the short, standard confirmation budget.
   */
  private isSafeSessionStorageMigrationFinalization(
    data: IWorkerPayload
  ): boolean {
    return Boolean(
      data.action === EWorkerAction.recreate &&
      data.session_storage === EWorkerSessionStorage.postgres &&
      data.previous_session_storage === undefined &&
      typeof data.worker_type_id === 'string' &&
      data.previous_worker_type_id === data.worker_type_id &&
      data.previous_server_id === undefined &&
      data.remove_session === false &&
      data.remove_volume === false &&
      typeof data.session_storage_migration_id === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        data.session_storage_migration_id
      ) &&
      data.legacy_session_volume_name === undefined &&
      data.legacy_session_checksum === undefined &&
      typeof data.lifecycle_operation_id === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        data.lifecycle_operation_id
      ) &&
      typeof data.lifecycle_semantic_fingerprint === 'string' &&
      /^[0-9a-f]{64}$/u.test(data.lifecycle_semantic_fingerprint)
    );
  }

  private isLegacyVolumeToPostgresSourceCleanup(
    data: IWorkerPayload,
    worker: IWorkerMonitor | null | undefined,
    expected?: RuntimeRemovalIdentity
  ): boolean {
    return Boolean(
      data.action === EWorkerAction.cleanup &&
      this.isLegacyVolumeToPostgresConversion(data) &&
      data.previous_worker_type_id === data.worker_type_id &&
      worker &&
      worker.session_storage === EWorkerSessionStorage.postgres &&
      (!expected ||
        (expected.sessionStorage === EWorkerSessionStorage.legacy_volume &&
          Boolean(expected.sessionVolumeName)))
    );
  }

  /**
   * A protected legacy-volume -> PostgreSQL migration updates the worker row
   * to the target backend before it retires the still-authoritative source
   * runtime. Authorize only that temporary split-brain identity: same
   * provider/server, exact migration volume and checksum-bearing metadata,
   * with both destructive flags disabled. The runtime and Docker volume stay
   * legacy until the source container has been removed; the volume itself is
   * deliberately preserved for rollback.
   */
  private isSafeSessionStorageMigrationSourceRuntimeRetirement(
    data: IWorkerPayload,
    worker: IWorkerMonitor | null | undefined,
    runtime: IWorkerRuntime | null | undefined,
    expected?: RuntimeRemovalIdentity
  ): boolean {
    const expectedSourceProvider = data.worker_type_id
      ? WORKER_TYPE_SOURCE_PROVIDER[data.worker_type_id]
      : undefined;
    return Boolean(
      this.isSafeSessionStorageMigration(data) &&
      data.previous_session_storage === EWorkerSessionStorage.legacy_volume &&
      data.previous_worker_type_id === data.worker_type_id &&
      expectedSourceProvider &&
      worker &&
      !worker.deleted_at &&
      worker.worker_id === data.worker_id &&
      worker.account_id === data.account_id &&
      worker.server_id === data.server_id &&
      worker.worker_type_id === data.worker_type_id &&
      worker.session_storage === EWorkerSessionStorage.postgres &&
      runtime &&
      runtime.worker_id === data.worker_id &&
      runtime.session_storage === EWorkerSessionStorage.legacy_volume &&
      runtime.session_volume_name === data.legacy_session_volume_name &&
      runtime.source_provider?.trim().toLowerCase() ===
        expectedSourceProvider &&
      expected?.sessionStorage === EWorkerSessionStorage.legacy_volume &&
      expected.sessionVolumeName === data.legacy_session_volume_name
    );
  }

  /**
   * A failed protected legacy-volume -> PostgreSQL migration restores the
   * worker row to the legacy backend before retiring the failed PostgreSQL
   * target runtime. Authorize only that symmetric transition: the restore
   * command must carry the original checksum-bearing migration proof, while
   * the worker already names legacy storage and the immutable runtime still
   * names the exact PostgreSQL generation that has to be stopped.
   */
  private isSafeSessionStorageMigrationRestoreSourceRuntimeRetirement(
    data: IWorkerPayload,
    worker: IWorkerMonitor | null | undefined,
    runtime: IWorkerRuntime | null | undefined,
    expected?: RuntimeRemovalIdentity
  ): boolean {
    const expectedSourceProvider = data.worker_type_id
      ? WORKER_TYPE_SOURCE_PROVIDER[data.worker_type_id]
      : undefined;
    return Boolean(
      this.isSafeSessionStorageMigrationRestore(data) &&
      this.hasValidSessionStorageMigrationMetadata(data) &&
      data.previous_worker_type_id === data.worker_type_id &&
      expectedSourceProvider &&
      worker &&
      !worker.deleted_at &&
      worker.worker_id === data.worker_id &&
      worker.account_id === data.account_id &&
      worker.server_id === data.server_id &&
      worker.worker_type_id === data.worker_type_id &&
      worker.session_storage === EWorkerSessionStorage.legacy_volume &&
      runtime &&
      runtime.worker_id === data.worker_id &&
      runtime.session_storage === EWorkerSessionStorage.postgres &&
      runtime.session_volume_name === null &&
      runtime.source_provider?.trim().toLowerCase() ===
        expectedSourceProvider &&
      expected?.sessionStorage === EWorkerSessionStorage.postgres &&
      expected.sessionVolumeName === null
    );
  }

  private async hydrateAuthoritativeSessionStorageIfMissing(
    data: IWorkerPayload,
    authoritativeWorker?: IWorkerMonitor | null
  ): Promise<void> {
    if (
      !this.workerRuntimeRepository ||
      typeof this.workerRuntimeRepository.viewByWorkerIdConsistent !==
        'function'
    ) {
      throw new Error('worker_session_storage_authoritative_fence_changed');
    }
    const [worker, runtime] = await Promise.all([
      authoritativeWorker === undefined
        ? this.viewWorkerForMonitorConsistent(data.worker_id)
        : Promise.resolve(authoritativeWorker),
      this.workerRuntimeRepository.viewByWorkerIdConsistent(data.worker_id),
    ]);
    const sessionStorage = worker?.session_storage;
    if (
      !worker ||
      worker.deleted_at ||
      worker.worker_id !== data.worker_id ||
      worker.account_id !== data.account_id ||
      !sessionStorage ||
      !Object.values(EWorkerSessionStorage).includes(sessionStorage)
    ) {
      throw new Error('worker_session_storage_authoritative_fence_changed');
    }

    if (
      data.session_storage !== undefined &&
      data.session_storage !== sessionStorage
    ) {
      throw new Error('worker_session_storage_authoritative_fence_changed');
    }

    const runtimeContainerId = worker.runtime_container_id?.trim();
    if (runtime) {
      /*
       * Backend and volume are immutable across a lifecycle generation. The
       * two container pointers are not: after a crash between runtime upsert
       * and worker CAS, the existing recovery path deliberately observes the
       * replacement runtime before the worker pointer advances. Exact
       * container identity is therefore checked by the later lifecycle fences.
       */
      const runtimeSessionStorage = runtime.session_storage;
      const legacyConversionSourceRuntime =
        (this.isLegacyVolumeToPostgresConversion(data) ||
          this.isSafeSessionStorageMigration(data)) &&
        runtimeSessionStorage === EWorkerSessionStorage.legacy_volume &&
        Boolean(runtime.session_volume_name?.trim());
      const migrationRestoreSourceRuntime =
        this.isSafeSessionStorageMigrationRestore(data) &&
        runtimeSessionStorage === EWorkerSessionStorage.postgres &&
        runtime.session_volume_name === null;
      const validRuntimeVolume =
        legacyConversionSourceRuntime || migrationRestoreSourceRuntime
          ? true
          : sessionStorage === EWorkerSessionStorage.legacy_volume
            ? Boolean(runtime.session_volume_name?.trim())
            : sessionStorage === EWorkerSessionStorage.postgres &&
              runtime.session_volume_name === null;
      if (
        runtime.worker_id !== data.worker_id ||
        !runtimeSessionStorage ||
        !Object.values(EWorkerSessionStorage).includes(runtimeSessionStorage) ||
        (runtimeSessionStorage !== sessionStorage &&
          !legacyConversionSourceRuntime &&
          !migrationRestoreSourceRuntime) ||
        !validRuntimeVolume
      ) {
        throw new Error('worker_session_storage_authoritative_fence_changed');
      }
    } else if (runtimeContainerId) {
      throw new Error('worker_session_storage_authoritative_fence_changed');
    }

    data.session_storage = sessionStorage;

    if (
      data.previous_worker_type_id !== undefined &&
      data.previous_worker_type_id !== data.worker_type_id &&
      (!supportsWhatsappSessionStorage(data.previous_worker_type_id) ||
        !supportsWhatsappSessionStorage(data.worker_type_id))
    ) {
      throw new Error('worker_type_change_unofficial_only');
    }

    if (
      data.previous_worker_type_id !== undefined &&
      data.previous_worker_type_id !== data.worker_type_id &&
      sessionStorage !== EWorkerSessionStorage.postgres
    ) {
      throw new Error('worker_type_change_requires_postgres_session');
    }
  }

  private assertLegacyWarmSession(
    warm: IWorkerWarmPool
  ): asserts warm is IWorkerWarmPool & {
    session_storage: EWorkerSessionStorage.legacy_volume;
    session_volume_name: string;
  } {
    if (
      warm.session_storage !== EWorkerSessionStorage.legacy_volume ||
      !warm.session_volume_name
    ) {
      throw new Error('legacy_warm_worker_session_volume_required');
    }
  }

  private assertLegacyRuntimeSession(
    runtime: IWorkerRuntime
  ): asserts runtime is IWorkerRuntime & {
    session_storage: EWorkerSessionStorage.legacy_volume;
    session_volume_name: string;
  } {
    if (
      runtime.session_storage !== EWorkerSessionStorage.legacy_volume ||
      !runtime.session_volume_name
    ) {
      throw new Error('legacy_worker_runtime_session_volume_required');
    }
  }

  private runtimeWriterIdentityKey(
    workerId: string,
    runtimeGeneration: number
  ): string {
    return `${workerId}:${runtimeGeneration}`;
  }

  private async preparePostgresRuntimeWriterIdentity(
    data: IWorkerPayload,
    runtimeGeneration: number
  ): Promise<{
    sessionStorage: EWorkerSessionStorage;
    runtimeCapability?: string;
    writerEpoch?: string;
  }> {
    const sessionStorage = this.sessionStorageFor(data);
    const managedWhatsappWorker =
      data.worker_type_id === EWorkerType.baileys ||
      data.worker_type_id === EWorkerType.wwebjs ||
      data.worker_type_id === EWorkerType.whatsmeow;
    if (!managedWhatsappWorker) {
      return { sessionStorage };
    }
    if (!this.workerRuntimeRepository) {
      throw new Error('worker_runtime_database_repository_required');
    }
    const key = this.runtimeWriterIdentityKey(
      data.worker_id,
      runtimeGeneration
    );
    for (const retainedKey of this.runtimeWriterIdentities.keys()) {
      if (retainedKey !== key && retainedKey.startsWith(`${data.worker_id}:`)) {
        this.runtimeWriterIdentities.delete(retainedKey);
      }
    }
    const existing = this.runtimeWriterIdentities.get(key);
    if (existing) {
      return { sessionStorage, ...existing };
    }

    const runtimeCapability = randomBytes(48).toString('base64url');
    const writerEpoch = randomUUID();
    const prepared =
      await this.workerRuntimeRepository.prepareRuntimeWriterIdentity({
        worker_id: data.worker_id,
        runtime_generation: runtimeGeneration,
        runtime_capability_hash: createHash('sha256')
          .update(runtimeCapability)
          .digest('hex'),
        session_writer_epoch: writerEpoch,
      });
    if (!prepared) {
      throw new Error('worker_runtime_database_identity_reservation_stale');
    }
    const identity = { runtimeCapability, writerEpoch };
    this.runtimeWriterIdentities.set(key, identity);
    return { sessionStorage, ...identity };
  }

  /**
   * Docker assigns the immutable container ID at create time, before the
   * process is started. Persist that ID through the lifecycle/generation CAS
   * while the container is still stopped, so a worker can never race its
   * canonical database-fence activation against a later Balance upsert.
   */
  private async bindReservedColdRuntimeBeforeStart(input: {
    data: IWorkerPayload;
    workerType: EWorkerType;
    expectedWorkerStatus: EWorkerStatus.creating | EWorkerStatus.recreating;
    runtimeGeneration: number;
    sessionStorage: EWorkerSessionStorage;
    sessionVolumeName: string | null;
    runtimeCapability: string;
    writerEpoch: string;
    containerId: string;
    leaseContext: ILockLeaseContext;
  }): Promise<void> {
    const lifecycleOperationId =
      input.data.lifecycle_operation_id?.trim() || null;
    const sourceProvider = WORKER_TYPE_SOURCE_PROVIDER[input.workerType];
    if (!sourceProvider) {
      throw new Error('worker_runtime_before_start_provider_required');
    }

    input.leaseContext.assertActive();
    let claimError: unknown;
    try {
      await this.workerRuntimeRepository.claimReservedRuntimeContainer({
        worker_id: input.data.worker_id,
        account_id: input.data.account_id,
        server_id: input.data.server_id,
        worker_type_id: input.workerType,
        lifecycle_operation_id: lifecycleOperationId,
        expected_worker_status_id: input.expectedWorkerStatus,
        container_id: input.containerId,
        container_name: input.data.worker_id,
        session_storage: input.sessionStorage,
        session_volume_name: input.sessionVolumeName,
        runtime_generation: input.runtimeGeneration,
        warm_pool_id: null,
        source_provider: null,
      });
    } catch (error) {
      // The UPDATE may have committed even when the response was lost. Resolve
      // the ambiguous result through the primary before compensating Docker.
      claimError = error;
    }
    input.leaseContext.assertActive();

    const runtime = await this.workerRuntimeRepository.viewByWorkerIdConsistent(
      input.data.worker_id
    );
    input.leaseContext.assertActive();
    const expectedCapabilityHash = createHash('sha256')
      .update(input.runtimeCapability)
      .digest('hex');
    const exactClaimPersisted = Boolean(
      runtime &&
      runtime.worker_id === input.data.worker_id &&
      runtime.container_id === input.containerId &&
      runtime.container_name === input.data.worker_id &&
      runtime.session_storage === input.sessionStorage &&
      runtime.session_volume_name === input.sessionVolumeName &&
      runtime.runtime_generation === input.runtimeGeneration &&
      runtime.runtime_capability_hash === expectedCapabilityHash &&
      runtime.session_writer_epoch === input.writerEpoch &&
      (runtime.warm_pool_id ?? null) === null
    );
    const lifecycleStillCurrent = await this.isReservedColdRuntimeClaimCurrent({
      data: input.data,
      workerType: input.workerType,
      expectedWorkerStatus: input.expectedWorkerStatus,
    });
    input.leaseContext.assertActive();
    if (exactClaimPersisted && lifecycleStillCurrent) {
      return;
    }
    if (claimError) {
      throw claimError;
    }
    throw new Error('worker_runtime_before_start_claim_stale');
  }

  private async isReservedColdRuntimeClaimCurrent(input: {
    data: IWorkerPayload;
    workerType: EWorkerType;
    expectedWorkerStatus: EWorkerStatus.creating | EWorkerStatus.recreating;
  }): Promise<boolean> {
    const current = await this.viewWorkerForMonitorConsistent(
      input.data.worker_id
    );
    let workerTypeMatches = current?.worker_type_id === input.workerType;
    /*
     * The target container is created before provider-handoff promotion. At
     * that point the worker row must still name the drained source provider,
     * otherwise a rollback could no longer prove its owner. The database CAS
     * that wrote the runtime pointer already proves the exact target handoff;
     * repeat that same proof for the post-CAS read instead of treating the
     * intentionally retained source type as a stale lifecycle.
     */
    if (
      !workerTypeMatches &&
      current &&
      (await this.isPostgresProviderHandoffTargetAuthorized(
        input.data,
        current
      ))
    ) {
      workerTypeMatches = true;
    }
    return Boolean(
      current &&
      !current.deleted_at &&
      current.worker_id === input.data.worker_id &&
      current.account_id === input.data.account_id &&
      current.server_id === input.data.server_id &&
      workerTypeMatches &&
      current.worker_status_id === input.expectedWorkerStatus &&
      (current.lifecycle_operation_id ?? null) ===
        (input.data.lifecycle_operation_id?.trim() || null)
    );
  }

  /**
   * Provider ONLINE admission may win after the cold runtime was durably
   * claimed but before the manager publishes `runtime_started`. Admit that
   * redelivery only for the exact lifecycle generation and runtime pointer;
   * the marker SQL still performs the authoritative native ACK/lease proof
   * before this target can be completed.
   */
  private async isOnlineColdRuntimeClaimTargetCurrent(input: {
    data: IWorkerPayload;
    workerType: EWorkerType;
    containerId: string;
    runtimeGeneration: number;
  }): Promise<boolean> {
    const lifecycleOperationId = input.data.lifecycle_operation_id?.trim();
    if (
      input.data.action !== EWorkerAction.recreate ||
      !lifecycleOperationId ||
      !DOCKER_CONTAINER_ID_PATTERN.test(input.containerId) ||
      !Number.isSafeInteger(input.runtimeGeneration) ||
      input.runtimeGeneration <= 0
    ) {
      return false;
    }

    const current = await this.viewWorkerForMonitorConsistent(
      input.data.worker_id
    );
    let workerTypeMatches = current?.worker_type_id === input.workerType;
    if (
      !workerTypeMatches &&
      current &&
      (await this.isPostgresProviderHandoffTargetAuthorized(
        input.data,
        current
      ))
    ) {
      workerTypeMatches = true;
    }
    return Boolean(
      current &&
      !current.deleted_at &&
      current.worker_id === input.data.worker_id &&
      current.account_id === input.data.account_id &&
      current.server_id === input.data.server_id &&
      workerTypeMatches &&
      current.worker_status_id === EWorkerStatus.online &&
      current.lifecycle_operation_id === lifecycleOperationId &&
      current.container_id?.trim().toLowerCase() === input.containerId &&
      current.runtime_container_id?.trim().toLowerCase() ===
        input.containerId &&
      current.runtime_generation === input.runtimeGeneration
    );
  }

  /**
   * A Balance restart can lose the in-memory cleartext capability after the
   * runtime pointer was committed. The immutable container environment is the
   * only recovery source: verify its secret against the durable hash/epoch and
   * reuse it. Generating a replacement capability for an associated runtime
   * would strand (or fence) the already-created worker.
   */
  private async adoptPersistedColdRuntimeIfPresent(input: {
    data: IWorkerPayload;
    workerType: EWorkerType;
    sessionStorage: EWorkerSessionStorage;
    sessionVolumeName: string | null;
    expectedWorkerStatus: EWorkerStatus.creating | EWorkerStatus.recreating;
    expectedImageContentId?: string;
    leaseContext: ILockLeaseContext;
  }): Promise<PersistedColdRuntimeAdoptionResult | null> {
    const sourceProvider = WORKER_TYPE_SOURCE_PROVIDER[input.workerType];
    if (!sourceProvider) {
      return null;
    }
    const expectedImageContentId = input.expectedImageContentId
      ?.trim()
      .toLowerCase();
    if (
      input.expectedWorkerStatus === EWorkerStatus.recreating &&
      (!expectedImageContentId ||
        !/^sha256:[0-9a-f]{64}$/u.test(expectedImageContentId))
    ) {
      throw new Error(
        'worker_cold_runtime_adoption_expected_image_content_id_invalid'
      );
    }

    input.leaseContext.assertActive();
    const runtime = await this.workerRuntimeRepository.viewByWorkerIdConsistent(
      input.data.worker_id
    );
    input.leaseContext.assertActive();
    if (!runtime) return null;
    const containerId = runtime.container_id?.trim().toLowerCase();
    if (!containerId) {
      const reservedCrossServerHandoffTarget =
        await this.isReservedCrossServerPostgresHandoffTargetCurrent({
          ...input,
          runtime,
          sourceProvider,
        });
      input.leaseContext.assertActive();
      if (!reservedCrossServerHandoffTarget) return null;

      this.logDebug(
        'service.worker_runtime.cold_runtime_reserved_handoff_target_recovered',
        {
          trace_id: input.data.debug_trace_id,
          layer: 'service',
          worker_id: input.data.worker_id,
          account_id: input.data.account_id,
          worker_type_id: input.workerType,
          lifecycle_operation_id: input.data.lifecycle_operation_id,
          runtime_generation: runtime.runtime_generation,
          reason: 'cross_server_postgres_target_reservation_abandoned',
        }
      );
      return {
        status: 'reserved_cross_server_handoff_target',
        runtimeGeneration: runtime.runtime_generation,
      };
    }
    if (!DOCKER_CONTAINER_ID_PATTERN.test(containerId)) return null;

    let inspection =
      await this.workerService.inspectContainerWorkerByIdStrict(containerId);
    input.leaseContext.assertActive();
    if (!inspection.exists) {
      const absentCrossServerHandoffTarget =
        await this.isAbsentCrossServerPostgresHandoffTargetCurrent({
          ...input,
          runtime,
          containerId,
          sourceProvider,
        });
      input.leaseContext.assertActive();
      if (!absentCrossServerHandoffTarget) return null;

      this.logDebug(
        'service.worker_runtime.cold_runtime_absent_handoff_target_recovered',
        {
          trace_id: input.data.debug_trace_id,
          layer: 'service',
          worker_id: input.data.worker_id,
          account_id: input.data.account_id,
          worker_type_id: input.workerType,
          lifecycle_operation_id: input.data.lifecycle_operation_id,
          runtime_generation: runtime.runtime_generation,
          reason: 'cross_server_postgres_target_absent',
        }
      );
      return {
        status: 'absent_cross_server_handoff_target',
        runtimeGeneration: runtime.runtime_generation,
      };
    }
    const expectedLifecycleOperationId =
      input.data.lifecycle_operation_id?.trim();
    if (
      inspection.container_labels?.['underchat.lifecycle_operation_id'] !==
      expectedLifecycleOperationId
    ) {
      // This is the runtime being replaced, not a partially-created runtime
      // owned by the current lifecycle operation.
      return null;
    }
    if (
      !runtime ||
      !this.isPersistedColdRuntimeDatabaseIdentityCurrent({
        runtime,
        data: input.data,
        sessionStorage: input.sessionStorage,
        sessionVolumeName: input.sessionVolumeName,
        containerId,
        sourceProvider,
      })
    ) {
      throw new Error(
        'worker_cold_runtime_adoption_database_identity_mismatch'
      );
    }
    const reservedClaimCurrent = await this.isReservedColdRuntimeClaimCurrent({
      data: input.data,
      workerType: input.workerType,
      expectedWorkerStatus: input.expectedWorkerStatus,
    });
    let onlineTargetClaimCurrent = Boolean(
      !reservedClaimCurrent &&
      input.expectedWorkerStatus === EWorkerStatus.recreating &&
      (await this.isOnlineColdRuntimeClaimTargetCurrent({
        data: input.data,
        workerType: input.workerType,
        containerId,
        runtimeGeneration: runtime.runtime_generation,
      }))
    );
    if (!reservedClaimCurrent && !onlineTargetClaimCurrent) {
      throw new Error('worker_cold_runtime_adoption_snapshot_stale');
    }
    input.leaseContext.assertActive();
    this.assertCreateRetryContainerIdentity(
      input.data,
      input.workerType,
      runtime.runtime_generation,
      input.sessionVolumeName,
      containerId,
      inspection
    );
    const containerImageContentId =
      input.expectedWorkerStatus === EWorkerStatus.recreating
        ? this.resolvePersistedColdRuntimeImageContentId(inspection)
        : undefined;

    const writerIdentity =
      await this.workerService.inspectRuntimeWriterIdentityByContainerIdStrict(
        containerId
      );
    input.leaseContext.assertActive();
    const capabilityHash = createHash('sha256')
      .update(writerIdentity.runtimeCapability)
      .digest('hex');
    if (
      capabilityHash !== runtime.runtime_capability_hash ||
      writerIdentity.writerEpoch !== runtime.session_writer_epoch
    ) {
      throw new Error('worker_cold_runtime_adoption_writer_identity_mismatch');
    }
    if (expectedImageContentId && !containerImageContentId) {
      throw new Error('worker_cold_runtime_adoption_image_identity_mismatch');
    }
    const immutableImageContentDrift = Boolean(
      expectedImageContentId &&
      containerImageContentId &&
      input.expectedWorkerStatus === EWorkerStatus.recreating &&
      containerImageContentId !== expectedImageContentId
    );
    if (immutableImageContentDrift && !onlineTargetClaimCurrent) {
      onlineTargetClaimCurrent =
        await this.isOnlineColdRuntimeClaimTargetCurrent({
          data: input.data,
          workerType: input.workerType,
          containerId,
          runtimeGeneration: runtime.runtime_generation,
        });
      input.leaseContext.assertActive();
    }
    if (immutableImageContentDrift && onlineTargetClaimCurrent) {
      /*
       * The retry re-resolves a mutable image alias, while this exact
       * lifecycle target already pinned its immutable digest at creation and
       * subsequently won strong ONLINE admission. Retain that operation-owned
       * content; replacing it here would turn an alias rollout into an
       * endless recreate loop after every lost manager response.
       */
      this.logDebug('service.worker_runtime.cold_runtime_adoption_retained', {
        trace_id: input.data.debug_trace_id,
        layer: 'service',
        worker_id: input.data.worker_id,
        account_id: input.data.account_id,
        worker_type_id: input.workerType,
        lifecycle_operation_id: input.data.lifecycle_operation_id,
        runtime_generation: runtime.runtime_generation,
        reason: 'operation_pinned_online_target_image_retained',
      });
    }
    if (immutableImageContentDrift && !onlineTargetClaimCurrent) {
      if (!expectedImageContentId || !containerImageContentId) {
        throw new Error('worker_cold_runtime_adoption_image_identity_mismatch');
      }
      this.logDebug('service.worker_runtime.cold_runtime_adoption_skipped', {
        trace_id: input.data.debug_trace_id,
        layer: 'service',
        worker_id: input.data.worker_id,
        account_id: input.data.account_id,
        worker_type_id: input.workerType,
        lifecycle_operation_id: input.data.lifecycle_operation_id,
        runtime_generation: runtime.runtime_generation,
        reason: 'immutable_image_content_drift',
      });
      await this.removeStaleImagePersistedColdRuntime({
        ...input,
        expectedWorkerStatus: EWorkerStatus.recreating,
        expectedImageContentId,
        staleImageContentId: containerImageContentId,
        containerId,
        runtime,
        sourceProvider,
      });
      input.leaseContext.assertActive();
      return {
        status: 'stale_image_removed',
        runtimeGeneration: runtime.runtime_generation,
      };
    }
    this.runtimeWriterIdentities.set(
      this.runtimeWriterIdentityKey(
        input.data.worker_id,
        runtime.runtime_generation
      ),
      writerIdentity
    );

    if (inspection.running !== true) {
      const started =
        await this.workerService.startContainerWorkerById(containerId);
      input.leaseContext.assertActive();
      if (!started) {
        throw new Error('worker_cold_runtime_adoption_start_failed');
      }
      inspection =
        await this.workerService.inspectContainerWorkerByIdStrict(containerId);
      input.leaseContext.assertActive();
      this.assertCreateRetryContainerIdentity(
        input.data,
        input.workerType,
        runtime.runtime_generation,
        input.sessionVolumeName,
        containerId,
        inspection
      );
    }
    const reservedClaimStillCurrent =
      await this.isReservedColdRuntimeClaimCurrent({
        data: input.data,
        workerType: input.workerType,
        expectedWorkerStatus: input.expectedWorkerStatus,
      });
    const onlineTargetClaimStillCurrent = Boolean(
      !reservedClaimStillCurrent &&
      input.expectedWorkerStatus === EWorkerStatus.recreating &&
      (await this.isOnlineColdRuntimeClaimTargetCurrent({
        data: input.data,
        workerType: input.workerType,
        containerId,
        runtimeGeneration: runtime.runtime_generation,
      }))
    );
    if (!reservedClaimStillCurrent && !onlineTargetClaimStillCurrent) {
      throw new Error('worker_cold_runtime_adoption_snapshot_stale');
    }
    input.leaseContext.assertActive();

    this.logDebug('service.worker_runtime.cold_runtime_adopted', {
      trace_id: input.data.debug_trace_id,
      layer: 'service',
      worker_id: input.data.worker_id,
      account_id: input.data.account_id,
      worker_type_id: input.workerType,
      lifecycle_operation_id: input.data.lifecycle_operation_id,
      container_id: containerId,
      runtime_generation: runtime.runtime_generation,
      session_storage: input.sessionStorage,
    });
    return {
      status: 'adopted',
      containerId,
      runtimeGeneration: runtime.runtime_generation,
    };
  }

  /**
   * Recovers a generation abandoned by a cross-server PostgreSQL handoff when
   * Balance stopped after reservation and before the immutable Docker ID was
   * claimed. The abandoned generation is never reused: after proving the
   * target name absent (or removing only its exact stopped pre-bind orphan),
   * the caller reserves a fresh monotonically-increasing generation.
   */
  private async isReservedCrossServerPostgresHandoffTargetCurrent(input: {
    data: IWorkerPayload;
    workerType: EWorkerType;
    sessionStorage: EWorkerSessionStorage;
    sessionVolumeName: string | null;
    expectedWorkerStatus: EWorkerStatus.creating | EWorkerStatus.recreating;
    runtime: IWorkerRuntime;
    sourceProvider: string;
    leaseContext: ILockLeaseContext;
  }): Promise<boolean> {
    const previousServerId = input.data.previous_server_id?.trim();
    const previousWorkerType = input.data.previous_worker_type_id;
    const lifecycleOperationId = input.data.lifecycle_operation_id?.trim();
    const writerIdentityIsEmpty =
      (input.runtime.runtime_capability_hash ?? null) === null &&
      (input.runtime.session_writer_epoch ?? null) === null;
    const writerIdentityIsPrepared = Boolean(
      /^[0-9a-f]{64}$/u.test(input.runtime.runtime_capability_hash ?? '') &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
        input.runtime.session_writer_epoch ?? ''
      )
    );
    if (
      input.expectedWorkerStatus !== EWorkerStatus.recreating ||
      input.sessionStorage !== EWorkerSessionStorage.postgres ||
      input.sessionVolumeName !== null ||
      input.data.action !== EWorkerAction.recreate ||
      input.data.remove_session === true ||
      input.data.remove_volume === true ||
      input.data.worker_type_id !== input.workerType ||
      !previousServerId ||
      previousServerId === input.data.server_id ||
      !previousWorkerType ||
      previousWorkerType === input.workerType ||
      !lifecycleOperationId ||
      WORKER_TYPE_SOURCE_PROVIDER[input.workerType] !== input.sourceProvider ||
      (input.runtime.container_id ?? null) !== null ||
      input.runtime.source_provider !== null ||
      (input.runtime.warm_pool_id ?? null) !== null ||
      input.runtime.connection_sequence !== 0 ||
      (input.runtime.connection_epoch ?? null) !== null ||
      (input.runtime.connection_activated_at ?? null) !== null ||
      (!writerIdentityIsEmpty && !writerIdentityIsPrepared)
    ) {
      return false;
    }

    const snapshotMatches = (
      worker: IWorkerMonitor | null,
      runtime: IWorkerRuntime | null
    ): boolean => {
      const sourceContainerId = worker?.container_id?.trim().toLowerCase();
      const runtimeWriterIdentityIsEmpty =
        (runtime?.runtime_capability_hash ?? null) === null &&
        (runtime?.session_writer_epoch ?? null) === null;
      const runtimeWriterIdentityIsPrepared = Boolean(
        /^[0-9a-f]{64}$/u.test(runtime?.runtime_capability_hash ?? '') &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
          runtime?.session_writer_epoch ?? ''
        )
      );
      return Boolean(
        worker &&
        runtime &&
        !worker.deleted_at &&
        worker.worker_id === input.data.worker_id &&
        worker.account_id === input.data.account_id &&
        worker.server_id === input.data.server_id &&
        worker.worker_type_id === previousWorkerType &&
        worker.worker_status_id === EWorkerStatus.recreating &&
        worker.session_storage === EWorkerSessionStorage.postgres &&
        worker.lifecycle_operation_id === lifecycleOperationId &&
        sourceContainerId &&
        DOCKER_CONTAINER_ID_PATTERN.test(sourceContainerId) &&
        worker.runtime_container_id === null &&
        worker.runtime_generation === input.runtime.runtime_generation &&
        worker.runtime_session_volume_name === null &&
        runtime.worker_id === input.data.worker_id &&
        runtime.container_id === null &&
        runtime.container_name === input.data.worker_id &&
        runtime.session_storage === EWorkerSessionStorage.postgres &&
        runtime.session_volume_name === null &&
        Number.isSafeInteger(runtime.runtime_generation) &&
        runtime.runtime_generation > 0 &&
        runtime.runtime_generation === input.runtime.runtime_generation &&
        runtime.source_provider === null &&
        (runtime.warm_pool_id ?? null) === null &&
        runtime.connection_sequence === 0 &&
        (runtime.connection_epoch ?? null) === null &&
        (runtime.connection_activated_at ?? null) === null &&
        (runtimeWriterIdentityIsEmpty || runtimeWriterIdentityIsPrepared) &&
        (runtime.runtime_capability_hash ?? null) ===
          (input.runtime.runtime_capability_hash ?? null) &&
        (runtime.session_writer_epoch ?? null) ===
          (input.runtime.session_writer_epoch ?? null)
      );
    };
    const readAuthorizedSnapshot = async (): Promise<{
      worker: IWorkerMonitor;
      runtime: IWorkerRuntime;
    } | null> => {
      input.leaseContext.assertActive();
      const [worker, runtime] = await Promise.all([
        this.viewWorkerForMonitorConsistent(input.data.worker_id),
        this.workerRuntimeRepository.viewByWorkerIdConsistent(
          input.data.worker_id
        ),
      ]);
      input.leaseContext.assertActive();
      if (!snapshotMatches(worker, runtime) || !worker || !runtime) {
        return null;
      }
      if (
        !(await this.isPostgresProviderHandoffTargetAuthorized(
          input.data,
          worker
        ))
      ) {
        return null;
      }
      input.leaseContext.assertActive();
      return { worker, runtime };
    };
    const snapshotsMatch = (
      before: { worker: IWorkerMonitor; runtime: IWorkerRuntime },
      after: { worker: IWorkerMonitor; runtime: IWorkerRuntime }
    ): boolean =>
      after.worker.container_id === before.worker.container_id &&
      after.worker.server_id === before.worker.server_id &&
      after.worker.worker_type_id === before.worker.worker_type_id &&
      after.worker.lifecycle_operation_id ===
        before.worker.lifecycle_operation_id &&
      after.runtime.runtime_generation === before.runtime.runtime_generation &&
      (after.runtime.runtime_capability_hash ?? null) ===
        (before.runtime.runtime_capability_hash ?? null) &&
      (after.runtime.session_writer_epoch ?? null) ===
        (before.runtime.session_writer_epoch ?? null) &&
      after.runtime.connection_sequence ===
        before.runtime.connection_sequence &&
      (after.runtime.connection_epoch ?? null) ===
        (before.runtime.connection_epoch ?? null) &&
      (after.runtime.connection_activated_at ?? null) ===
        (before.runtime.connection_activated_at ?? null) &&
      (after.runtime.source_provider ?? null) ===
        (before.runtime.source_provider ?? null);

    const assertExactStoppedOrphan = async (
      inspection: WorkerContainerInspection
    ): Promise<string> => {
      const orphanContainerId = inspection.container_id?.trim().toLowerCase();
      if (
        !orphanContainerId ||
        !DOCKER_CONTAINER_ID_PATTERN.test(orphanContainerId) ||
        inspection.running !== false ||
        inspection.container_state !== 'created' ||
        inspection.container_status !== 'created' ||
        inspection.container_restart_count !== 0 ||
        !writerIdentityIsPrepared
      ) {
        throw new Error(
          'worker_cold_runtime_reserved_handoff_target_snapshot_stale'
        );
      }
      this.assertCreateRetryContainerIdentity(
        input.data,
        input.workerType,
        input.runtime.runtime_generation,
        null,
        orphanContainerId,
        inspection
      );
      const expectedImageName = getImageWorker(input.workerType);
      const expectedGrpcPort = String(
        this.getExpectedWorkerGrpcPort(input.workerType)
      );
      if (
        inspection.container_labels?.['underchat.warm_pool_id'] !== undefined ||
        inspection.container_env?.WARM_POOL_ID !== undefined ||
        (inspection.container_env?.WARM_STANDBY !== undefined &&
          inspection.container_env.WARM_STANDBY !== 'false') ||
        inspection.container_labels?.['underchat.worker_image'] !==
          expectedImageName ||
        inspection.container_env?.WORKER_IMAGE !== expectedImageName ||
        inspection.container_labels?.['underchat.worker_grpc_port'] !==
          expectedGrpcPort ||
        inspection.container_env?.WORKER_GRPC_PORT !== expectedGrpcPort
      ) {
        throw new Error(
          'worker_cold_runtime_reserved_handoff_target_snapshot_stale'
        );
      }
      this.resolvePersistedColdRuntimeImageContentId(inspection);
      const writerIdentity =
        await this.workerService.inspectRuntimeWriterIdentityByContainerIdStrict(
          orphanContainerId
        );
      input.leaseContext.assertActive();
      if (
        createHash('sha256')
          .update(writerIdentity.runtimeCapability)
          .digest('hex') !== input.runtime.runtime_capability_hash ||
        writerIdentity.writerEpoch !== input.runtime.session_writer_epoch
      ) {
        throw new Error(
          'worker_cold_runtime_reserved_handoff_target_snapshot_stale'
        );
      }
      return orphanContainerId;
    };

    const before = await readAuthorizedSnapshot();
    if (!before) return false;
    const named = await this.workerService.inspectContainerWorkerByIdStrict(
      input.data.worker_id
    );
    input.leaseContext.assertActive();
    const orphanContainerId = named.exists
      ? await assertExactStoppedOrphan(named)
      : null;
    const after = await readAuthorizedSnapshot();
    if (!after || !snapshotsMatch(before, after)) {
      throw new Error(
        'worker_cold_runtime_reserved_handoff_target_snapshot_stale'
      );
    }

    const confirmed = await this.workerService.inspectContainerWorkerByIdStrict(
      orphanContainerId ?? input.data.worker_id
    );
    input.leaseContext.assertActive();
    if (!orphanContainerId) {
      if (confirmed.exists) {
        throw new Error(
          'worker_cold_runtime_reserved_handoff_target_snapshot_stale'
        );
      }
      return true;
    }

    const confirmedOrphanContainerId =
      await assertExactStoppedOrphan(confirmed);
    if (confirmedOrphanContainerId !== orphanContainerId) {
      throw new Error(
        'worker_cold_runtime_reserved_handoff_target_snapshot_stale'
      );
    }
    const immediatelyBeforeRemoval = await readAuthorizedSnapshot();
    if (
      !immediatelyBeforeRemoval ||
      !snapshotsMatch(before, immediatelyBeforeRemoval)
    ) {
      throw new Error(
        'worker_cold_runtime_reserved_handoff_target_snapshot_stale'
      );
    }
    const removed =
      await this.workerService.removeContainerWorkerById(orphanContainerId);
    input.leaseContext.assertActive();
    if (!removed) {
      throw new Error(
        'worker_cold_runtime_reserved_handoff_target_orphan_removal_failed'
      );
    }
    const [orphanAfterRemoval, nameAfterRemoval] = await Promise.all([
      this.workerService.inspectContainerWorkerByIdStrict(orphanContainerId),
      this.workerService.inspectContainerWorkerByIdStrict(input.data.worker_id),
    ]);
    input.leaseContext.assertActive();
    if (orphanAfterRemoval.exists || nameAfterRemoval.exists) {
      throw new Error(
        'worker_cold_runtime_reserved_handoff_target_orphan_removal_unconfirmed'
      );
    }
    const afterRemoval = await readAuthorizedSnapshot();
    if (!afterRemoval || !snapshotsMatch(before, afterRemoval)) {
      throw new Error(
        'worker_cold_runtime_reserved_handoff_target_snapshot_stale'
      );
    }
    return true;
  }

  /**
   * Recovers the crash window after an already-claimed PostgreSQL handoff
   * target was removed but before the next generation was reserved. In a
   * cross-server handoff the worker control pointer deliberately still names
   * the source container on the previous host, so the generic local pointer
   * reconciler cannot prove that container absent.
   *
   * The handoff target authorization is a primary-database proof whose
   * `transforming+` state can only be committed after the source checkpoint,
   * write pause, provider disconnect and complete lease release. Combine that
   * with the exact target reservation and two primary snapshots
   * around a strict target-host Docker absence check. This permits only a new
   * generation reservation; it never repairs the source pointer or mutates
   * the previous host.
   */
  private async isAbsentCrossServerPostgresHandoffTargetCurrent(input: {
    data: IWorkerPayload;
    workerType: EWorkerType;
    sessionStorage: EWorkerSessionStorage;
    sessionVolumeName: string | null;
    expectedWorkerStatus: EWorkerStatus.creating | EWorkerStatus.recreating;
    runtime: IWorkerRuntime;
    containerId: string;
    sourceProvider: string;
    leaseContext: ILockLeaseContext;
  }): Promise<boolean> {
    const previousServerId = input.data.previous_server_id?.trim();
    const previousWorkerType = input.data.previous_worker_type_id;
    const lifecycleOperationId = input.data.lifecycle_operation_id?.trim();
    const activationIsCoherent = (runtime: IWorkerRuntime): boolean => {
      const provider = runtime.source_provider ?? null;
      const connectionEpoch = runtime.connection_epoch?.trim() || null;
      const connectionActivatedAt =
        runtime.connection_activated_at?.trim() || null;
      if (provider === null) {
        return (
          connectionEpoch === null &&
          runtime.connection_sequence === 0 &&
          connectionActivatedAt === null
        );
      }
      return Boolean(
        provider === input.sourceProvider &&
        connectionEpoch &&
        Number.isSafeInteger(runtime.connection_sequence) &&
        runtime.connection_sequence > 0 &&
        connectionActivatedAt &&
        Number.isFinite(Date.parse(connectionActivatedAt))
      );
    };
    if (
      input.expectedWorkerStatus !== EWorkerStatus.recreating ||
      input.sessionStorage !== EWorkerSessionStorage.postgres ||
      input.sessionVolumeName !== null ||
      input.data.action !== EWorkerAction.recreate ||
      input.data.remove_session === true ||
      input.data.remove_volume === true ||
      input.data.worker_type_id !== input.workerType ||
      !previousServerId ||
      previousServerId === input.data.server_id ||
      !previousWorkerType ||
      previousWorkerType === input.workerType ||
      !lifecycleOperationId ||
      (input.runtime.warm_pool_id ?? null) !== null ||
      !activationIsCoherent(input.runtime)
    ) {
      return false;
    }

    const snapshotMatches = (
      worker: IWorkerMonitor | null,
      runtime: IWorkerRuntime | null
    ): boolean => {
      const sourceContainerId = worker?.container_id?.trim().toLowerCase();
      return Boolean(
        worker &&
        runtime &&
        !worker.deleted_at &&
        worker.worker_id === input.data.worker_id &&
        worker.account_id === input.data.account_id &&
        worker.server_id === input.data.server_id &&
        worker.worker_type_id === previousWorkerType &&
        worker.worker_status_id === EWorkerStatus.recreating &&
        worker.session_storage === EWorkerSessionStorage.postgres &&
        sourceContainerId &&
        DOCKER_CONTAINER_ID_PATTERN.test(sourceContainerId) &&
        sourceContainerId !== input.containerId &&
        worker.runtime_container_id?.trim().toLowerCase() ===
          input.containerId &&
        worker.runtime_generation === input.runtime.runtime_generation &&
        worker.runtime_session_volume_name === null &&
        (runtime.warm_pool_id ?? null) === null &&
        activationIsCoherent(runtime) &&
        this.isPersistedColdRuntimeDatabaseIdentityCurrent({
          runtime,
          data: input.data,
          sessionStorage: input.sessionStorage,
          sessionVolumeName: input.sessionVolumeName,
          containerId: input.containerId,
          sourceProvider: input.sourceProvider,
          expectedRuntime: input.runtime,
        })
      );
    };
    const readAuthorizedSnapshot = async (): Promise<{
      worker: IWorkerMonitor;
      runtime: IWorkerRuntime;
    } | null> => {
      input.leaseContext.assertActive();
      const [worker, runtime] = await Promise.all([
        this.viewWorkerForMonitorConsistent(input.data.worker_id),
        this.workerRuntimeRepository.viewByWorkerIdConsistent(
          input.data.worker_id
        ),
      ]);
      input.leaseContext.assertActive();
      if (!snapshotMatches(worker, runtime) || !worker || !runtime) {
        return null;
      }
      if (
        !(await this.isPostgresProviderHandoffTargetAuthorized(
          input.data,
          worker
        ))
      ) {
        return null;
      }
      input.leaseContext.assertActive();
      return { worker, runtime };
    };

    const before = await readAuthorizedSnapshot();
    if (!before) return false;
    const target = await this.workerService.inspectContainerWorkerByIdStrict(
      input.containerId
    );
    input.leaseContext.assertActive();
    if (target.exists) {
      throw new Error(
        'worker_cold_runtime_absent_handoff_target_snapshot_stale'
      );
    }
    const after = await readAuthorizedSnapshot();
    if (
      !after ||
      after.worker.container_id !== before.worker.container_id ||
      after.worker.server_id !== before.worker.server_id ||
      after.worker.worker_type_id !== before.worker.worker_type_id ||
      after.worker.lifecycle_operation_id !==
        before.worker.lifecycle_operation_id ||
      after.runtime.container_id !== before.runtime.container_id ||
      after.runtime.runtime_generation !== before.runtime.runtime_generation ||
      after.runtime.runtime_capability_hash !==
        before.runtime.runtime_capability_hash ||
      after.runtime.session_writer_epoch !==
        before.runtime.session_writer_epoch ||
      after.runtime.source_provider !== before.runtime.source_provider ||
      after.runtime.connection_epoch !== before.runtime.connection_epoch ||
      after.runtime.connection_sequence !==
        before.runtime.connection_sequence ||
      after.runtime.connection_activated_at !==
        before.runtime.connection_activated_at
    ) {
      throw new Error(
        'worker_cold_runtime_absent_handoff_target_snapshot_stale'
      );
    }
    return true;
  }

  private isPersistedColdRuntimeDatabaseIdentityCurrent(input: {
    runtime: IWorkerRuntime | null | undefined;
    data: IWorkerPayload;
    sessionStorage: EWorkerSessionStorage;
    sessionVolumeName: string | null;
    containerId: string;
    sourceProvider: string;
    expectedRuntime?: IWorkerRuntime;
  }): boolean {
    const { runtime, expectedRuntime } = input;
    return Boolean(
      runtime &&
      runtime.worker_id === input.data.worker_id &&
      runtime.container_id?.trim().toLowerCase() === input.containerId &&
      runtime.container_name === input.data.worker_id &&
      runtime.session_storage === input.sessionStorage &&
      runtime.session_volume_name === input.sessionVolumeName &&
      Number.isSafeInteger(runtime.runtime_generation) &&
      runtime.runtime_generation > 0 &&
      /^[0-9a-f]{64}$/u.test(runtime.runtime_capability_hash ?? '') &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
        runtime.session_writer_epoch ?? ''
      ) &&
      (runtime.source_provider === null ||
        runtime.source_provider === input.sourceProvider) &&
      (runtime.warm_pool_id ?? null) === null &&
      (!expectedRuntime ||
        (runtime.runtime_generation === expectedRuntime.runtime_generation &&
          runtime.runtime_capability_hash ===
            expectedRuntime.runtime_capability_hash &&
          runtime.session_writer_epoch ===
            expectedRuntime.session_writer_epoch &&
          (runtime.source_provider ?? null) ===
            (expectedRuntime.source_provider ?? null)))
    );
  }

  private resolvePersistedColdRuntimeImageContentId(
    inspection: WorkerContainerInspection
  ): string {
    const containerImageContentId = inspection.container_image_id
        ?.trim()
        .toLowerCase(),
      labelledImageContentId = inspection.container_labels?.[
        'underchat.worker_image_content_id'
      ]
        ?.trim()
        .toLowerCase();
    if (
      !containerImageContentId ||
      !labelledImageContentId ||
      !/^sha256:[0-9a-f]{64}$/u.test(containerImageContentId) ||
      !/^sha256:[0-9a-f]{64}$/u.test(labelledImageContentId) ||
      containerImageContentId !== labelledImageContentId
    ) {
      throw new Error('worker_cold_runtime_adoption_image_identity_mismatch');
    }
    return containerImageContentId;
  }

  private async assertStaleImageColdRuntimeCleanupSnapshot(input: {
    data: IWorkerPayload;
    workerType: EWorkerType;
    sessionStorage: EWorkerSessionStorage;
    sessionVolumeName: string | null;
    expectedWorkerStatus: EWorkerStatus.recreating;
    expectedImageContentId: string;
    staleImageContentId: string;
    containerId: string;
    runtime: IWorkerRuntime;
    sourceProvider: string;
    leaseContext: ILockLeaseContext;
  }): Promise<boolean> {
    input.leaseContext.assertActive();
    const [runtime, inspection] = await Promise.all([
      this.workerRuntimeRepository.viewByWorkerIdConsistent(
        input.data.worker_id
      ),
      this.workerService.inspectContainerWorkerByIdStrict(input.containerId),
    ]);
    input.leaseContext.assertActive();
    if (
      !runtime ||
      !this.isPersistedColdRuntimeDatabaseIdentityCurrent({
        runtime,
        data: input.data,
        sessionStorage: input.sessionStorage,
        sessionVolumeName: input.sessionVolumeName,
        containerId: input.containerId,
        sourceProvider: input.sourceProvider,
        expectedRuntime: input.runtime,
      })
    ) {
      throw new Error(
        'worker_cold_runtime_stale_image_cleanup_database_identity_changed'
      );
    }
    if (
      !(await this.isReservedColdRuntimeClaimCurrent({
        data: input.data,
        workerType: input.workerType,
        expectedWorkerStatus: input.expectedWorkerStatus,
      }))
    ) {
      throw new Error('worker_cold_runtime_stale_image_cleanup_snapshot_stale');
    }
    input.leaseContext.assertActive();
    if (!inspection.exists) {
      return false;
    }
    this.assertCreateRetryContainerIdentity(
      input.data,
      input.workerType,
      runtime.runtime_generation,
      input.sessionVolumeName,
      input.containerId,
      inspection
    );
    const imageContentId =
      this.resolvePersistedColdRuntimeImageContentId(inspection);
    if (
      imageContentId !== input.staleImageContentId ||
      imageContentId === input.expectedImageContentId
    ) {
      throw new Error(
        'worker_cold_runtime_stale_image_cleanup_image_identity_changed'
      );
    }
    const writerIdentity =
      await this.workerService.inspectRuntimeWriterIdentityByContainerIdStrict(
        input.containerId
      );
    input.leaseContext.assertActive();
    if (
      createHash('sha256')
        .update(writerIdentity.runtimeCapability)
        .digest('hex') !== runtime.runtime_capability_hash ||
      writerIdentity.writerEpoch !== runtime.session_writer_epoch
    ) {
      throw new Error(
        'worker_cold_runtime_stale_image_cleanup_writer_identity_changed'
      );
    }
    const confirmedRuntime =
      await this.workerRuntimeRepository.viewByWorkerIdConsistent(
        input.data.worker_id
      );
    input.leaseContext.assertActive();
    if (
      !this.isPersistedColdRuntimeDatabaseIdentityCurrent({
        runtime: confirmedRuntime,
        data: input.data,
        sessionStorage: input.sessionStorage,
        sessionVolumeName: input.sessionVolumeName,
        containerId: input.containerId,
        sourceProvider: input.sourceProvider,
        expectedRuntime: input.runtime,
      }) ||
      !(await this.isReservedColdRuntimeClaimCurrent({
        data: input.data,
        workerType: input.workerType,
        expectedWorkerStatus: input.expectedWorkerStatus,
      }))
    ) {
      throw new Error('worker_cold_runtime_stale_image_cleanup_snapshot_stale');
    }
    input.leaseContext.assertActive();
    return true;
  }

  private async removeStaleImagePersistedColdRuntime(input: {
    data: IWorkerPayload;
    workerType: EWorkerType;
    sessionStorage: EWorkerSessionStorage;
    sessionVolumeName: string | null;
    expectedWorkerStatus: EWorkerStatus.recreating;
    expectedImageContentId: string;
    staleImageContentId: string;
    containerId: string;
    runtime: IWorkerRuntime;
    sourceProvider: string;
    leaseContext: ILockLeaseContext;
  }): Promise<void> {
    if (!(await this.assertStaleImageColdRuntimeCleanupSnapshot(input))) {
      return;
    }

    let gracefulStopSucceeded = false;
    if (input.sessionStorage === EWorkerSessionStorage.postgres) {
      try {
        gracefulStopSucceeded =
          await this.workerService.stopContainerWorkerByIdGracefully(
            input.containerId
          );
      } catch (error) {
        this.logDebug(
          'service.worker_runtime.cold_runtime_stale_image_stop_failed',
          {
            trace_id: input.data.debug_trace_id,
            layer: 'service',
            worker_id: input.data.worker_id,
            account_id: input.data.account_id,
            worker_type_id: input.workerType,
            lifecycle_operation_id: input.data.lifecycle_operation_id,
            runtime_generation: input.runtime.runtime_generation,
            graceful_stop_error_type:
              error instanceof Error ? error.name : typeof error,
            reason: 'graceful_stop_failed',
          }
        );
      }
      input.leaseContext.assertActive();
    }

    const stillExists =
      await this.assertStaleImageColdRuntimeCleanupSnapshot(input);
    input.leaseContext.assertActive();
    if (stillExists) {
      const removed = await this.workerService.removeContainerWorkerById(
        input.containerId
      );
      input.leaseContext.assertActive();
      if (!removed) {
        throw new Error(
          'worker_cold_runtime_stale_image_cleanup_removal_failed'
        );
      }
    }
    const afterRemoval =
      await this.workerService.inspectContainerWorkerByIdStrict(
        input.containerId
      );
    input.leaseContext.assertActive();
    if (afterRemoval.exists) {
      throw new Error(
        'worker_cold_runtime_stale_image_cleanup_removal_unconfirmed'
      );
    }
    this.logDebug('service.worker_runtime.cold_runtime_stale_image_removed', {
      trace_id: input.data.debug_trace_id,
      layer: 'service',
      worker_id: input.data.worker_id,
      account_id: input.data.account_id,
      worker_type_id: input.workerType,
      lifecycle_operation_id: input.data.lifecycle_operation_id,
      runtime_generation: input.runtime.runtime_generation,
      graceful_stop_succeeded: gracefulStopSucceeded,
      reason: 'immutable_image_content_drift',
    });
  }

  private normalizePositiveInt(value: unknown, fallback: number): number {
    const parsed =
      typeof value === 'number'
        ? value
        : Number.parseInt(String(value ?? ''), 10);

    return Number.isFinite(parsed) && parsed > 0
      ? Math.trunc(parsed)
      : fallback;
  }

  private async redisSetNxSeconds(
    key: string,
    value: string,
    ttlSeconds: number
  ): Promise<boolean> {
    const result = await this.redis.set(key, value, 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  private async clearSelfHealFencesIfOwned(
    workerId: string,
    operationId: string
  ): Promise<void> {
    await this.redis.eval(
      `
        -- underchat:self-heal:clear-owned
        local deleted = 0
        if redis.call("GET", KEYS[1]) == ARGV[1] then
          deleted = deleted + redis.call("DEL", KEYS[1])
        end

        local recovery = redis.call("GET", KEYS[2])
        if recovery then
          local ok, decoded = pcall(cjson.decode, recovery)
          if ok and type(decoded) == "table" and decoded["operation_id"] == ARGV[1] then
            deleted = deleted + redis.call("DEL", KEYS[2])
          end
        end
        return deleted
      `,
      2,
      workerSelfHealInflightKey(workerId),
      workerSelfHealRecoveryKey(workerId),
      operationId
    );
  }

  private async completeSelfHealRecoveryIfOwned(
    workerId: string,
    operationId: string
  ): Promise<boolean> {
    const result = await this.redis.eval(
      `
        -- underchat:self-heal:complete-owned
        local recovery = redis.call("GET", KEYS[1])
        if not recovery then
          return 0
        end

        local ok, decoded = pcall(cjson.decode, recovery)
        if not ok or type(decoded) ~= "table" or decoded["operation_id"] ~= ARGV[1] then
          return 0
        end
        if redis.call("GET", KEYS[2]) ~= ARGV[1] then
          return 0
        end

        redis.call("SETEX", KEYS[3], ARGV[2], ARGV[1])
        redis.call("DEL", KEYS[1])
        redis.call("DEL", KEYS[2])
        return 1
      `,
      3,
      workerSelfHealRecoveryKey(workerId),
      workerSelfHealInflightKey(workerId),
      workerSelfHealCooldownKey(workerId),
      operationId,
      this.selfHealCooldownSeconds
    );

    return Number(result) === 1;
  }

  private async publishSelfHealLifecycleWithRetry(
    message: IWorkerLifecycleQueueMessage
  ): Promise<void> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await this.workerLifecycleQueueService.publish(message);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < 3) {
          await this.sleep(100);
        }
      }
    }

    throw lastError;
  }

  private async recoverSelfHealAfterPublishFailure(input: {
    lifecycleMessage: IWorkerLifecycleQueueMessage;
    workerId: string;
    accountId: string;
    serverId: string;
    workerTypeId: EWorkerType;
    operationId: string;
    publishError: unknown;
    debugTraceId?: string;
  }): Promise<'published'> {
    try {
      await this.publishSelfHealLifecycleWithRetry(input.lifecycleMessage);
      return 'published';
    } catch (recoveryPublishError) {
      this.logDebug('service.self_heal.publish_pending_fast_redrive', {
        trace_id: input.debugTraceId,
        layer: 'service',
        worker_id: input.workerId,
        account_id: input.accountId,
        worker_type_id: input.workerTypeId,
        lifecycle_operation_id: input.operationId,
        publish_reason: getErrorMessage(input.publishError),
        recovery_publish_reason: getErrorMessage(recoveryPublishError),
      });
      throw new AggregateError(
        [input.publishError, recoveryPublishError],
        `Self-heal lifecycle ${input.operationId} remains prepared for fast redrive`
      );
    }
  }

  private hasSelfHealingActiveSessionEvidence(
    input: IWorkerSelfHealingRequestProto
  ): boolean {
    if (input.authenticated !== true) {
      return false;
    }

    const state = `${input.provider_state ?? ''} ${
      input.degraded_reason ?? input.reason ?? ''
    }`.toLowerCase();
    const passiveState = [
      'qr',
      'pairing',
      'no_session',
      'not_authenticated',
      'logged_out',
      'bad_session',
      'mismatch',
      'launching',
      'state_unavailable',
      'state_probe_pending',
      'not_initialized',
      'runtime_not_initialized',
      'not initialized',
      'disconnected',
      'disconnecting',
      'offline',
      'closed',
      'awaiting_connection',
      'awaiting connection',
    ].some((marker) => state.includes(marker));
    if (passiveState) {
      return false;
    }

    const providerState = (input.provider_state ?? '').toLowerCase();
    return (
      input.session_ready === true ||
      Boolean(input.phone?.trim()) ||
      providerState.includes('connected') ||
      providerState === 'open' ||
      providerState === 'ready'
    );
  }

  private normalizeProxyProtocol(
    protocol: string | null | undefined
  ): EProxyProtocol {
    if (!protocol) {
      return EProxyProtocol.http;
    }

    if (Object.values(EProxyProtocol).includes(protocol as EProxyProtocol)) {
      return protocol as EProxyProtocol;
    }

    return EProxyProtocol.http;
  }

  async handle(data: IWorkerPayload): Promise<void> {
    const lifecycleContext: ConnectionLifecycleDebugContext = {
      trace_id: data.debug_trace_id,
      layer: 'service',
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id: data.worker_type_id,
      lifecycle_operation_id: data.lifecycle_operation_id,
      action: data.action,
    };
    this.logDebug('service.command_handler.handle', lifecycleContext);

    if (data.action === EWorkerAction.create) {
      await this.runWithWorkerLifecycleLock(
        data.worker_id,
        'create_worker',
        async (leaseContext) => {
          await this.assertAuthoritativeLifecycleSemanticFingerprint(
            data.worker_id,
            data.lifecycle_operation_id,
            data.lifecycle_semantic_fingerprint,
            new Set<IWorkerLifecycleQueueMessage['action']>([
              'create',
              'activate_warm',
            ]),
            leaseContext
          );
          return this.createWorker(data, undefined, {}, leaseContext);
        },
        lifecycleContext
      );
      return;
    }

    if (data.action === EWorkerAction.delete) {
      await this.runWithWorkerLifecycleLock(
        data.worker_id,
        'delete_worker',
        async (leaseContext) => {
          leaseContext.assertActive();
          await this.assertAuthoritativeLifecycleSemanticFingerprint(
            data.worker_id,
            data.lifecycle_operation_id,
            data.lifecycle_semantic_fingerprint,
            new Set<IWorkerLifecycleQueueMessage['action']>(['delete']),
            leaseContext
          );
          const deletionRequest: PermanentWorkerTopicDeletionRequest = {
            action: EWorkerAction.delete,
            worker_id: data.worker_id,
            account_id: data.account_id,
            lifecycle_operation_id: data.lifecycle_operation_id ?? '',
            debug_trace_id: data.debug_trace_id ?? '',
          };
          // The primary-database lifecycle fence is checked before Docker and
          // the command epoch is moved to draining before runtime teardown.
          // No Kafka topic participates in this boundary.
          const { authorization: deletionAuthorization } =
            await this.workerCommandResourceLifecycleService.beginPermanentDeletion(
              deletionRequest,
              leaseContext
            );
          await this.hydrateAuthoritativeSessionStorageIfMissing(data);
          const runtimeFence = new WhatsappRuntimeFenceService(this.redis);
          await runtimeFence.revokeForDeletion(
            deletionRequest.worker_id,
            deletionRequest.account_id,
            deletionRequest.lifecycle_operation_id
          );
          await runtimeFence.assertDeletionRevoked(
            deletionRequest.worker_id,
            deletionRequest.account_id,
            deletionRequest.lifecycle_operation_id
          );
          leaseContext.assertActive();

          // Keep the durable until runtime/database cleanup completes. The
          // draining epoch prevents any pending command from crossing the
          // provider boundary while deletion is in progress.
          await this.deleteWorker(data, deletionRequest, deletionAuthorization);
          leaseContext.assertActive();
          await this.workerCommandResourceLifecycleService.finalizePermanentDeletion(
            deletionRequest,
            leaseContext
          );
        },
        lifecycleContext
      );
      return;
    }

    if (data.action === EWorkerAction.cleanup) {
      await this.runWithWorkerLifecycleLock(
        data.worker_id,
        'cleanup_worker',
        async (leaseContext) => {
          await this.assertAuthoritativeLifecycleSemanticFingerprint(
            data.worker_id,
            data.lifecycle_operation_id,
            data.lifecycle_semantic_fingerprint,
            new Set<IWorkerLifecycleQueueMessage['action']>([
              'cleanup_previous_runtime',
            ]),
            leaseContext
          );
          if (
            await this.suppressTerminalWhatsappProviderHandoffEffect(
              data,
              leaseContext
            )
          ) {
            return;
          }
          return this.cleanupWorker(data, leaseContext);
        },
        lifecycleContext
      );
      return;
    }

    if (data.action === EWorkerAction.recreate) {
      await this.handleRecreateWithOrderedLocks(data, lifecycleContext);
    }
  }

  private async handleRecreateWithOrderedLocks(
    data: IWorkerPayload,
    lifecycleContext: ConnectionLifecycleDebugContext
  ): Promise<void> {
    const livenessLeaseOptions: WorkerLifecycleLeaseOptions | undefined =
      data.expected_container_id
        ? {
            ttlMs: WORKER_LIVENESS_LIFECYCLE_LEASE_TTL_MS,
            acquireTimeoutMs: WORKER_LIVENESS_LIFECYCLE_LEASE_TTL_MS,
            heartbeatIntervalMs: WORKER_LIVENESS_LIFECYCLE_HEARTBEAT_MS,
          }
        : undefined;
    await this.runWithRecreateServerSlot(
      data,
      (slotLeaseContext, slotControl) =>
        this.runWithWorkerLifecycleLock(
          data.worker_id,
          'recreate_worker',
          async (workerLeaseContext) => {
            await this.assertAuthoritativeLifecycleSemanticFingerprint(
              data.worker_id,
              data.lifecycle_operation_id,
              data.lifecycle_semantic_fingerprint,
              new Set<IWorkerLifecycleQueueMessage['action']>([
                'recreate',
                'activate_warm',
              ]),
              workerLeaseContext
            );
            if (
              await this.suppressTerminalWhatsappProviderHandoffEffect(
                data,
                workerLeaseContext
              )
            ) {
              return;
            }
            return this.recreateWorker(
              data,
              this.combineLockLeaseContexts(
                slotLeaseContext,
                workerLeaseContext
              ),
              slotControl
            );
          },
          lifecycleContext,
          {
            ...(livenessLeaseOptions ?? {}),
            signal: slotLeaseContext.signal,
          }
        )
    );
  }

  private async assertAuthoritativeLifecycleSemanticFingerprint(
    workerId: string,
    operationId: string | undefined,
    fingerprint: string | undefined,
    allowedActions: ReadonlySet<IWorkerLifecycleQueueMessage['action']>,
    leaseContext: ILockLeaseContext
  ): Promise<void> {
    const normalizedFingerprint = fingerprint?.trim();
    if (!operationId || !normalizedFingerprint) {
      /*
       * Unfenced internal maintenance calls remain compatible. Every fenced
       * network command is required to carry this field by the gRPC boundary,
       * so production lifecycle effects always take the durable-journal path.
       */
      return;
    }

    leaseContext.assertActive();
    const prepared = allowedActions.has('delete')
      ? [
          await this.workerLifecycleQueueService.loadPermanentDeletionProof(
            workerId,
            operationId
          ),
        ].filter(
          (payload): payload is IWorkerLifecycleQueueMessage => payload !== null
        )
      : await this.workerLifecycleQueueService.loadPrepared(
          workerId,
          operationId
        );
    leaseContext.assertActive();
    const authoritative = prepared.some(
      (payload) =>
        allowedActions.has(payload.action) &&
        workerLifecycleSemanticFingerprint(payload) === normalizedFingerprint
    );
    if (!authoritative) {
      throw new Error(
        `worker_lifecycle_semantic_fingerprint_stale:${operationId}`
      );
    }
  }

  async createWarmWorker(
    data: ICreateWarmWorkerRequestProto
  ): Promise<IWarmWorkerCommandResponseProto> {
    if (!data.warm_pool_id || !data.server_id || !data.worker_type_id) {
      throw new Error(
        'Missing required fields: warm_pool_id, server_id, worker_type_id'
      );
    }

    const workerType = data.worker_type_id as EWorkerType;
    if (!Object.values(EWorkerType).includes(workerType)) {
      throw new Error('Invalid worker_type_id');
    }
    const request = data as ValidatedCreateWarmWorkerRequest;
    try {
      return await this.runWithWorkerLifecycleLock(
        `warm-pool:${request.warm_pool_id}`,
        'create_warm_worker',
        (leaseContext) =>
          this.createWarmWorkerWithLock(request, workerType, leaseContext),
        {
          layer: 'service',
          worker_id: `warm-pool:${request.warm_pool_id}`,
          worker_type_id: workerType,
          action: EWorkerAction.create,
        },
        this.buildWarmCreationLeaseOptions()
      );
    } catch (error) {
      if (!(error instanceof WarmCreationLeaseRecoveryRequiredError)) {
        throw error;
      }
      /*
       * Reacquire only after the original withLock has unwound and released
       * its token. Re-entering the same key inside the stale callback can
       * self-block until TTL expiry.
       */
      await this.reconcileWarmCreationAfterLeaseLoss(
        request,
        workerType,
        error.originalError
      );
      throw error.originalError;
    }
  }

  private buildWarmCreationLeaseOptions(): WorkerLifecycleLeaseOptions {
    return {
      ttlMs: WARM_CREATION_LOCK_TTL_MS,
      heartbeatIntervalMs: WARM_CREATION_LOCK_HEARTBEAT_MS,
    };
  }

  private async createWarmWorkerWithLock(
    data: ValidatedCreateWarmWorkerRequest,
    workerType: EWorkerType,
    leaseContext: ILockLeaseContext
  ): Promise<IWarmWorkerCommandResponseProto> {
    const containerName = `warm-${data.warm_pool_id}`;
    const sessionStorage = EWorkerSessionStorage.postgres;
    const sessionVolumeName: string | null = null;
    leaseContext.assertActive();
    const existing = await this.workerWarmPoolRepository.viewByIdConsistent(
      data.warm_pool_id
    );
    leaseContext.assertActive();
    const warm =
      existing ??
      (await this.workerWarmPoolRepository.create({
        warm_pool_id: data.warm_pool_id,
        server_id: data.server_id,
        worker_type_id: workerType,
        session_storage: sessionStorage,
        session_volume_name: sessionVolumeName,
        state: EWorkerWarmPoolState.warming,
      }));
    leaseContext.assertActive();

    this.assertWarmCreationRowIdentity(
      warm,
      data,
      workerType,
      sessionVolumeName
    );
    this.assertWarmCreationStateCanRespond(warm);

    if (warm.session_storage === EWorkerSessionStorage.postgres) {
      return this.createOrReturnPostgresWarmRuntime(
        data,
        warm,
        workerType,
        containerName,
        leaseContext
      );
    }

    const inspection =
      await this.workerService.inspectContainerWorkerByIdStrict(containerName);
    leaseContext.assertActive();

    if (warm.state === EWorkerWarmPoolState.ready) {
      return this.returnReadyWarmRuntime(
        warm,
        data,
        workerType,
        inspection,
        leaseContext
      );
    }

    return this.reconcileMutableWarmRuntime(
      warm,
      data,
      workerType,
      inspection,
      leaseContext
    );
  }

  private assertWarmCreationRowIdentity(
    warm: IWorkerWarmPool,
    data: ValidatedCreateWarmWorkerRequest,
    workerType: EWorkerType,
    expectedSessionVolumeName: string | null
  ): void {
    const conflict =
      warm.warm_pool_id !== data.warm_pool_id
        ? 'warm_pool_id'
        : warm.server_id !== data.server_id
          ? 'server_id'
          : warm.worker_type_id !== workerType
            ? 'worker_type_id'
            : warm.session_storage !== EWorkerSessionStorage.postgres
              ? 'session_storage'
              : warm.session_volume_name !== expectedSessionVolumeName
                ? 'session_volume_name'
                : warm.container_name &&
                    warm.container_name !== `warm-${data.warm_pool_id}`
                  ? 'container_name'
                  : undefined;

    if (conflict) {
      throw new Error(`warm_worker_creation_row_conflict:${conflict}`);
    }
  }

  private async createOrReturnPostgresWarmRuntime(
    data: ValidatedCreateWarmWorkerRequest,
    warm: IWorkerWarmPool,
    workerType: EWorkerType,
    containerName: string,
    leaseContext: ILockLeaseContext
  ): Promise<IWarmWorkerCommandResponseProto> {
    try {
      let inspection =
        await this.workerService.inspectContainerWorkerByIdStrict(
          containerName
        );
      leaseContext.assertActive();

      if (inspection.exists) {
        let existingRuntime: WarmWorkerRuntimeReference | undefined;
        let existingRejection: unknown;
        try {
          this.assertPostgresWarmContainerIdentity(
            data,
            workerType,
            inspection
          );
          existingRuntime = this.buildPostgresWarmRuntimeReference(
            inspection,
            containerName
          );
          await this.assertWarmRuntimeReady(
            existingRuntime,
            data.warm_pool_id,
            workerType
          );
        } catch (error) {
          existingRejection = error;
        }
        leaseContext.assertActive();

        if (!existingRejection && existingRuntime) {
          if (warm.state === EWorkerWarmPoolState.ready) {
            await this.assertReadyPostgresWarmRuntimeRemainsCurrent(
              data,
              workerType,
              existingRuntime,
              leaseContext
            );
          } else {
            await this.persistPostgresWarmRuntimeReady(
              data,
              workerType,
              existingRuntime,
              leaseContext
            );
          }
          return this.buildWarmRuntimeResponse(
            data.warm_pool_id,
            existingRuntime
          );
        }

        if (warm.state === EWorkerWarmPoolState.ready) {
          throw existingRejection;
        }

        await this.cleanupOwnedPostgresWarmRuntime(
          data,
          workerType,
          inspection,
          existingRejection ??
            new Error('postgres_warm_worker_runtime_identity_mismatch'),
          leaseContext
        );
        leaseContext.assertActive();
        inspection = { exists: false, container_name: containerName };
      }

      if (!inspection.exists) {
        return await this.createAndValidatePostgresWarmRuntime(
          data,
          workerType,
          containerName,
          leaseContext
        );
      }

      throw new Error('postgres_warm_worker_runtime_identity_mismatch');
    } catch (error) {
      if (error instanceof WarmCreationLeaseRecoveryRequiredError) {
        throw error;
      }
      if (warm.state !== EWorkerWarmPoolState.ready) {
        leaseContext.assertActive();
        await this.workerWarmPoolRepository.recordPostgresCreationError({
          warmPoolId: data.warm_pool_id,
          serverId: data.server_id,
          workerTypeId: workerType,
          error: getErrorMessage(error),
        });
      }
      throw error;
    }
  }

  private async createAndValidatePostgresWarmRuntime(
    data: ValidatedCreateWarmWorkerRequest,
    workerType: EWorkerType,
    containerName: string,
    leaseContext: ILockLeaseContext
  ): Promise<IWarmWorkerCommandResponseProto> {
    let runtime: WarmWorkerRuntimeReference | undefined;
    let creationAttempted = false;
    let readinessConfirmed = false;
    try {
      const imageName = getImageWorker(workerType);
      const imageContentId = await this.resolveStableWorkerImageContentId(
        workerType,
        leaseContext
      );
      leaseContext.assertActive();
      const proxy = await this.resolveServerProxyConfig(data.server_id);
      leaseContext.assertActive();
      const runtimeCapability = randomBytes(48).toString('base64url');
      const writerEpoch = randomUUID();
      creationAttempted = true;
      const created = await this.workerService.createWarmContainerWorker({
        imageName,
        imageContentId,
        warmPoolId: data.warm_pool_id,
        serverId: data.server_id,
        workerTypeId: workerType,
        sessionStorage: EWorkerSessionStorage.postgres,
        grpcHost: balanceEnvironment.grpcHost,
        grpcPort: balanceEnvironment.grpcPort,
        workerGrpcPort: this.getExpectedWorkerGrpcPort(workerType),
        runtimeCapability,
        writerEpoch,
        proxy,
      });
      leaseContext.assertActive();
      const inspection =
        await this.workerService.inspectContainerWorkerByIdStrict(
          created.container_id
        );
      leaseContext.assertActive();
      this.assertPostgresWarmContainerIdentity(
        data,
        workerType,
        inspection,
        created.container_id
      );
      runtime = this.buildPostgresWarmRuntimeReference(
        inspection,
        containerName
      );
      await this.assertWarmRuntimeReady(runtime, data.warm_pool_id, workerType);
      readinessConfirmed = true;
      leaseContext.assertActive();
      await this.persistPostgresWarmRuntimeReady(
        data,
        workerType,
        runtime,
        leaseContext
      );
      leaseContext.assertActive();
      return this.buildWarmRuntimeResponse(data.warm_pool_id, runtime);
    } catch (error) {
      if (creationAttempted && this.isWorkerLifecycleLeaseLost(leaseContext)) {
        throw new WarmCreationLeaseRecoveryRequiredError(error);
      }
      if (creationAttempted && !readinessConfirmed) {
        const inspection =
          await this.workerService.inspectContainerWorkerByIdStrict(
            runtime?.container_id ?? containerName
          );
        leaseContext.assertActive();
        if (inspection.exists) {
          await this.cleanupOwnedPostgresWarmRuntime(
            data,
            workerType,
            inspection,
            error,
            leaseContext
          );
        }
      }
      throw error;
    }
  }

  private buildPostgresWarmRuntimeReference(
    inspection: WorkerContainerInspection,
    containerName: string
  ): WarmWorkerRuntimeReference {
    return {
      container_id: inspection.container_id as string,
      container_name: containerName,
      session_volume_name: '',
    };
  }

  private assertPostgresWarmContainerIdentity(
    data: WarmWorkerIdentityRequest,
    workerType: EWorkerType,
    inspection: WorkerContainerInspection,
    expectedContainerId?: string,
    requireRunning: boolean = true
  ): void {
    this.assertPostgresWarmContainerCleanupOwnership(
      data,
      workerType,
      inspection,
      expectedContainerId,
      requireRunning
    );
    const appDataMounts = (inspection.container_mounts ?? []).filter(
      (mount) => mount.destination === '/app/data'
    );
    if (appDataMounts.length !== 0) {
      throw new Error('postgres_warm_worker_runtime_identity_mismatch');
    }
  }

  /**
   * Cleanup ownership intentionally ignores mounts. An image-level VOLUME can
   * create an anonymous /app/data mount even though the requested runtime is
   * otherwise the exact PostgreSQL standby. Every immutable label/env/name/id
   * fence remains mandatory, including the absence of legacy volume metadata.
   */
  private assertPostgresWarmContainerCleanupOwnership(
    data: WarmWorkerIdentityRequest,
    workerType: EWorkerType,
    inspection: WorkerContainerInspection,
    expectedContainerId?: string,
    requireRunning: boolean = false
  ): void {
    const labels = inspection.container_labels ?? {};
    const env = inspection.container_env ?? {};
    if (
      !inspection.exists ||
      !inspection.container_id ||
      (requireRunning && inspection.running !== true) ||
      (expectedContainerId &&
        inspection.container_id !== expectedContainerId) ||
      inspection.container_name !== `warm-${data.warm_pool_id}` ||
      labels['underchat.warm_standby'] !== 'true' ||
      labels['underchat.warm_pool_id'] !== data.warm_pool_id ||
      labels['underchat.server_id'] !== data.server_id ||
      labels['underchat.worker_type_id'] !== workerType ||
      labels['underchat.session_storage'] !== EWorkerSessionStorage.postgres ||
      labels['underchat.session_volume_name'] !== undefined ||
      env.WARM_STANDBY !== 'true' ||
      env.WARM_POOL_ID !== data.warm_pool_id ||
      env.WORKER_TYPE_ID !== workerType ||
      env.WORKER_SESSION_STORAGE !== EWorkerSessionStorage.postgres ||
      env.SESSION_VOLUME_NAME !== undefined
    ) {
      throw new Error('postgres_warm_worker_runtime_identity_mismatch');
    }
  }

  private async persistPostgresWarmRuntimeReady(
    data: ValidatedCreateWarmWorkerRequest,
    workerType: EWorkerType,
    runtime: WarmWorkerRuntimeReference,
    leaseContext: ILockLeaseContext
  ): Promise<void> {
    leaseContext.assertActive();
    const writerIdentity =
      await this.workerService.inspectRuntimeWriterIdentityByContainerIdStrict(
        runtime.container_id
      );
    leaseContext.assertActive();
    const runtimeCapabilityHash = createHash('sha256')
      .update(writerIdentity.runtimeCapability)
      .digest('hex');
    const persisted =
      await this.workerWarmPoolRepository.finalizePostgresCreationReady({
        warmPoolId: data.warm_pool_id,
        serverId: data.server_id,
        workerTypeId: workerType,
        containerId: runtime.container_id,
        containerName: runtime.container_name,
        runtimeCapabilityHash,
        writerEpoch: writerIdentity.writerEpoch,
      });
    leaseContext.assertActive();
    if (!persisted) {
      throw new Error('postgres_warm_worker_ready_persistence_failed');
    }
  }

  private async assertReadyPostgresWarmRuntimeRemainsCurrent(
    data: ValidatedCreateWarmWorkerRequest,
    workerType: EWorkerType,
    runtime: WarmWorkerRuntimeReference,
    leaseContext: ILockLeaseContext
  ): Promise<void> {
    leaseContext.assertActive();
    const current = await this.workerWarmPoolRepository.viewByIdConsistent(
      data.warm_pool_id
    );
    leaseContext.assertActive();
    if (!current) {
      throw new Error('warm_worker_ready_row_missing_after_health_check');
    }
    this.assertWarmCreationRowIdentity(current, data, workerType, null);
    if (current.state !== EWorkerWarmPoolState.ready) {
      throw new Error(
        `warm_worker_ready_state_changed_after_health_check:${current.state}`
      );
    }
    if (
      current.container_id !== runtime.container_id ||
      current.container_name !== runtime.container_name ||
      current.session_volume_name !== null ||
      !/^[0-9a-f]{64}$/u.test(current.runtime_capability_hash ?? '') ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        current.session_writer_epoch ?? ''
      )
    ) {
      throw new Error('warm_worker_ready_runtime_changed_after_health_check');
    }
  }

  private async cleanupOwnedPostgresWarmRuntime(
    data: ValidatedCreateWarmWorkerRequest,
    workerType: EWorkerType,
    inspection: WorkerContainerInspection,
    originalError: unknown,
    leaseContext: ILockLeaseContext
  ): Promise<void> {
    try {
      this.assertPostgresWarmContainerCleanupOwnership(
        data,
        workerType,
        inspection,
        inspection.container_id,
        false
      );
      leaseContext.assertActive();
      const current = await this.workerWarmPoolRepository.viewByIdConsistent(
        data.warm_pool_id
      );
      leaseContext.assertActive();
      if (
        !current ||
        (current.state !== EWorkerWarmPoolState.warming &&
          current.state !== EWorkerWarmPoolState.error) ||
        (current.container_id !== null &&
          current.container_id !== undefined &&
          current.container_id !== inspection.container_id)
      ) {
        throw originalError;
      }
      this.assertWarmCreationRowIdentity(current, data, workerType, null);
      const confirmed =
        await this.workerService.inspectContainerWorkerByIdStrict(
          inspection.container_id as string
        );
      leaseContext.assertActive();
      this.assertPostgresWarmContainerCleanupOwnership(
        data,
        workerType,
        confirmed,
        inspection.container_id,
        false
      );
      const removed =
        await this.workerService.removePostgresWarmContainerWithAnonymousVolumesById(
          inspection.container_id as string
        );
      if (!removed) {
        throw originalError;
      }
      leaseContext.assertActive();
    } catch (cleanupError) {
      console.error('Failed to cleanup PostgreSQL warm worker runtime', {
        warm_pool_id: data.warm_pool_id,
        container_id: inspection.container_id,
        original_error: getErrorMessage(originalError),
        cleanup_error: getErrorMessage(cleanupError),
      });
      throw originalError;
    }
  }

  private assertWarmCreationStateCanRespond(warm: IWorkerWarmPool): void {
    if (
      warm.state === EWorkerWarmPoolState.warming ||
      warm.state === EWorkerWarmPoolState.error ||
      warm.state === EWorkerWarmPoolState.ready
    ) {
      return;
    }

    throw new Error(`warm_worker_creation_state_conflict:${warm.state}`);
  }

  private async returnReadyWarmRuntime(
    warm: IWorkerWarmPool,
    data: ValidatedCreateWarmWorkerRequest,
    workerType: EWorkerType,
    inspection: WorkerContainerInspection,
    leaseContext: ILockLeaseContext
  ): Promise<IWarmWorkerCommandResponseProto> {
    const runtime = this.resolveExistingWarmRuntime(
      warm,
      data,
      workerType,
      inspection
    );
    await this.assertWarmRuntimeReady(runtime, data.warm_pool_id, workerType);
    await this.assertReadyWarmRuntimeRemainsCurrent(
      data,
      workerType,
      runtime,
      leaseContext
    );
    return this.buildWarmRuntimeResponse(data.warm_pool_id, runtime);
  }

  private async assertReadyWarmRuntimeRemainsCurrent(
    data: ValidatedCreateWarmWorkerRequest,
    workerType: EWorkerType,
    runtime: WarmWorkerRuntimeReference,
    leaseContext: ILockLeaseContext
  ): Promise<void> {
    leaseContext.assertActive();
    const current = await this.workerWarmPoolRepository.viewByIdConsistent(
      data.warm_pool_id
    );
    leaseContext.assertActive();
    this.assertReadyWarmRuntimeStillCurrent(current, data, workerType, runtime);
  }

  private assertReadyWarmRuntimeStillCurrent(
    current: IWorkerWarmPool | null,
    data: ValidatedCreateWarmWorkerRequest,
    workerType: EWorkerType,
    runtime: WarmWorkerRuntimeReference
  ): void {
    if (!current) {
      throw new Error('warm_worker_ready_row_missing_after_health_check');
    }
    this.assertWarmCreationRowIdentity(
      current,
      data,
      workerType,
      runtime.session_volume_name
    );
    if (current.state !== EWorkerWarmPoolState.ready) {
      throw new Error(
        `warm_worker_ready_state_changed_after_health_check:${current.state}`
      );
    }
    if (
      current.container_id !== runtime.container_id ||
      current.container_name !== runtime.container_name ||
      current.session_volume_name !== runtime.session_volume_name
    ) {
      throw new Error('warm_worker_ready_runtime_changed_after_health_check');
    }
  }

  private async reconcileMutableWarmRuntime(
    warm: IWorkerWarmPool,
    data: ValidatedCreateWarmWorkerRequest,
    workerType: EWorkerType,
    inspection: WorkerContainerInspection,
    leaseContext: ILockLeaseContext
  ): Promise<IWarmWorkerCommandResponseProto> {
    try {
      if (inspection.exists) {
        const recovered = await this.tryRecoverExistingWarmRuntime(
          warm,
          data,
          workerType,
          inspection,
          leaseContext
        );
        if (recovered) {
          return recovered;
        }
      }

      return await this.createAndValidateWarmRuntime(
        data,
        workerType,
        leaseContext
      );
    } catch (error) {
      /*
       * A lost lease means another owner may already be reconciling or
       * adopting this runtime. Bubble a typed recovery request so the outer
       * lock can unwind before this key is reacquired.
       */
      if (error instanceof WarmCreationLeaseRecoveryRequiredError) {
        throw error;
      }
      leaseContext.assertActive();
      await this.recordWarmCreationError(data, error, leaseContext);
      throw error;
    }
  }

  private async tryRecoverExistingWarmRuntime(
    warm: IWorkerWarmPool,
    data: ValidatedCreateWarmWorkerRequest,
    workerType: EWorkerType,
    inspection: WorkerContainerInspection,
    leaseContext: ILockLeaseContext
  ): Promise<IWarmWorkerCommandResponseProto | null> {
    let runtime: WarmWorkerRuntimeReference | undefined;
    let rejection: unknown;
    try {
      runtime = this.resolveExistingWarmRuntime(
        warm,
        data,
        workerType,
        inspection
      );
      await this.assertWarmRuntimeReady(runtime, data.warm_pool_id, workerType);
    } catch (error) {
      rejection = error;
    }
    leaseContext.assertActive();

    if (!rejection && runtime) {
      await this.persistWarmRuntimeReady(data, runtime, leaseContext);
      leaseContext.assertActive();
      return this.buildWarmRuntimeResponse(data.warm_pool_id, runtime);
    }

    const originalError =
      rejection ?? new Error('warm_worker_existing_runtime_invalid');
    await this.cleanupOwnedStaleWarmRuntime(
      data,
      workerType,
      inspection,
      originalError,
      leaseContext
    );
    leaseContext.assertActive();
    return null;
  }

  private resolveExistingWarmRuntime(
    warm: IWorkerWarmPool,
    data: ValidatedCreateWarmWorkerRequest,
    workerType: EWorkerType,
    inspection: WorkerContainerInspection
  ): WarmWorkerRuntimeReference {
    this.assertLegacyWarmSession(warm);
    const rejection = this.resolveWarmCreationContainerRejection(
      warm,
      data,
      workerType,
      inspection
    );
    if (rejection) {
      throw new Error(`warm_worker_existing_runtime_invalid:${rejection}`);
    }

    return {
      container_id: inspection.container_id as string,
      container_name: inspection.container_name as string,
      session_volume_name: warm.session_volume_name,
    };
  }

  private resolveWarmCreationContainerRejection(
    warm: IWorkerWarmPool,
    data: ValidatedCreateWarmWorkerRequest,
    workerType: EWorkerType,
    inspection: WorkerContainerInspection
  ): string | undefined {
    const identityRejection = this.resolveWarmContainerIdentityRejection(
      data,
      workerType,
      inspection
    );
    if (identityRejection) return identityRejection;
    if (inspection.running !== true) return 'container_not_running';
    if (warm.container_id && warm.container_id !== inspection.container_id) {
      return 'persisted_container_id';
    }

    return undefined;
  }

  private resolveWarmContainerIdentityRejection(
    data: WarmWorkerIdentityRequest,
    workerType: EWorkerType,
    inspection: WorkerContainerInspection,
    expectedContainerId?: string
  ): string | undefined {
    const expectedImage = getImageWorker(workerType);
    const labels = inspection.container_labels ?? {};
    const env = inspection.container_env ?? {};

    const ownershipRejection = this.resolveOwnedWarmContainerIdentityRejection(
      data,
      workerType,
      inspection,
      expectedContainerId
    );
    if (ownershipRejection) return ownershipRejection;
    if (inspection.container_image !== expectedImage) return 'container_image';
    if (labels['underchat.worker_image'] !== expectedImage) {
      return 'worker_image_label';
    }
    if (env.WORKER_IMAGE !== expectedImage) return 'worker_image_env';
    const expectedGrpcPort = this.getExpectedWorkerGrpcPort(workerType);
    if (
      expectedGrpcPort !== undefined &&
      labels['underchat.worker_grpc_port'] !== String(expectedGrpcPort)
    ) {
      return 'worker_grpc_port_label';
    }
    if (
      expectedGrpcPort !== undefined &&
      env.WORKER_GRPC_PORT !== String(expectedGrpcPort)
    ) {
      return 'worker_grpc_port_env';
    }

    return undefined;
  }

  private resolveOwnedWarmContainerIdentityRejection(
    data: WarmWorkerIdentityRequest,
    workerType: EWorkerType,
    inspection: WorkerContainerInspection,
    expectedContainerId?: string
  ): string | undefined {
    const expectedName = `warm-${data.warm_pool_id}`;
    const labels = inspection.container_labels ?? {};
    const env = inspection.container_env ?? {};

    if (!inspection.exists) return 'container_missing';
    if (!inspection.container_id) return 'container_id_missing';
    if (inspection.container_name !== expectedName) return 'container_name';
    if (
      expectedContainerId &&
      inspection.container_id !== expectedContainerId
    ) {
      return 'container_id';
    }
    if (labels['underchat.warm_standby'] !== 'true') return 'standby_label';
    if (labels['underchat.warm_pool_id'] !== data.warm_pool_id) {
      return 'warm_pool_label';
    }
    if (labels['underchat.server_id'] !== data.server_id) return 'server_label';
    if (labels['underchat.worker_type_id'] !== workerType) {
      return 'worker_type_label';
    }
    if (labels['underchat.session_volume_name'] !== expectedName) {
      return 'session_volume_label';
    }
    if (env.WARM_STANDBY !== 'true') return 'standby_env';
    if (env.WARM_POOL_ID !== data.warm_pool_id) return 'warm_pool_env';
    if (env.WORKER_TYPE_ID !== workerType) return 'worker_type_env';
    if (env.SESSION_VOLUME_NAME !== expectedName) return 'session_volume_env';
    if (
      !inspection.container_image ||
      labels['underchat.worker_image'] !== inspection.container_image ||
      env.WORKER_IMAGE !== inspection.container_image
    ) {
      return 'worker_image_coherence';
    }
    if (
      labels['underchat.worker_grpc_port'] !== env.WORKER_GRPC_PORT ||
      !env.WORKER_GRPC_PORT
    ) {
      return 'worker_grpc_port_coherence';
    }

    return undefined;
  }

  private resolveActivatedWarmContainerIdentityRejection(
    data: ValidatedActivateWarmWorkerRequest,
    workerType: EWorkerType,
    runtimeGeneration: number,
    inspection: WorkerContainerInspection,
    expectedContainerId?: string,
    expectedProxy?: ResolvedWorkerProxyConfig,
    validateProxy: boolean = false,
    requireRunning: boolean = true
  ): string | undefined {
    const expectedImage = getImageWorker(workerType);
    const expectedGrpcPort = this.getExpectedWorkerGrpcPort(workerType);
    const labels = inspection.container_labels ?? {};
    const env = inspection.container_env ?? {};

    const ownershipRejection =
      this.resolveOwnedActivatedWarmContainerIdentityRejection(
        data,
        workerType,
        runtimeGeneration,
        inspection,
        expectedContainerId,
        requireRunning
      );
    if (ownershipRejection) return ownershipRejection;
    if (inspection.container_image !== expectedImage) return 'container_image';
    if (labels['underchat.worker_image'] !== expectedImage) {
      return 'worker_image_label';
    }
    if (env.WORKER_IMAGE !== expectedImage) return 'worker_image_env';
    if (validateProxy) {
      const expectedProxyMode = expectedProxy ? 'proxy' : 'direct';
      if (labels['underchat.proxy_mode'] !== expectedProxyMode) {
        return 'proxy_mode_label';
      }
      if (
        labels['underchat.proxy_fingerprint'] !==
        workerProxyFingerprint(expectedProxy)
      ) {
        return 'proxy_fingerprint_label';
      }
      if (
        expectedProxy &&
        (env.PROXY_PROTOCOL !== expectedProxy.protocol ||
          env.PROXY_HOST !== expectedProxy.host ||
          env.PROXY_PORT !== String(expectedProxy.port))
      ) {
        return 'proxy_env';
      }
      if (
        !expectedProxy &&
        (env.PROXY_PROTOCOL || env.PROXY_HOST || env.PROXY_PORT)
      ) {
        return 'unexpected_proxy_env';
      }
    }
    if (
      expectedGrpcPort !== undefined &&
      labels['underchat.worker_grpc_port'] !== String(expectedGrpcPort)
    ) {
      return 'worker_grpc_port_label';
    }
    if (
      expectedGrpcPort !== undefined &&
      env.WORKER_GRPC_PORT !== String(expectedGrpcPort)
    ) {
      return 'worker_grpc_port_env';
    }

    return undefined;
  }

  private resolveOwnedActivatedWarmContainerIdentityRejection(
    data: ValidatedActivateWarmWorkerRequest,
    workerType: EWorkerType,
    runtimeGeneration: number,
    inspection: WorkerContainerInspection,
    expectedContainerId?: string,
    requireRunning: boolean = false
  ): string | undefined {
    const expectedVolume = `warm-${data.warm_pool_id}`;
    const labels = inspection.container_labels ?? {};
    const env = inspection.container_env ?? {};

    if (!inspection.exists) return 'container_missing';
    if (!inspection.container_id) return 'container_id_missing';
    if (inspection.container_name !== data.worker_id) return 'container_name';
    if (
      expectedContainerId &&
      inspection.container_id !== expectedContainerId
    ) {
      return 'container_id';
    }
    if (requireRunning && inspection.running !== true) {
      return 'container_not_running';
    }
    if (labels['underchat.worker_id'] !== data.worker_id) {
      return 'worker_id_label';
    }
    if (labels['underchat.account_id'] !== data.account_id) {
      return 'account_id_label';
    }
    if (labels['underchat.server_id'] !== data.server_id) {
      return 'server_id_label';
    }
    if (labels['underchat.worker_type_id'] !== workerType) {
      return 'worker_type_label';
    }
    if (labels['underchat.session_volume_name'] !== expectedVolume) {
      return 'session_volume_label';
    }
    if (labels['underchat.runtime_generation'] !== String(runtimeGeneration)) {
      return 'runtime_generation_label';
    }
    if (labels['underchat.warm_pool_id'] !== data.warm_pool_id) {
      return 'warm_pool_label';
    }
    if (labels['underchat.warm_standby'] !== 'false') {
      return 'standby_label';
    }
    if (env.WORKER_ID !== data.worker_id) return 'worker_id_env';
    if (env.ACCOUNT_ID !== data.account_id) return 'account_id_env';
    if (env.WORKER_TYPE_ID !== workerType) return 'worker_type_env';
    if (env.SESSION_VOLUME_NAME !== expectedVolume) {
      return 'session_volume_env';
    }
    if (env.RUNTIME_GENERATION !== String(runtimeGeneration)) {
      return 'runtime_generation_env';
    }
    if (env.WARM_POOL_ID !== data.warm_pool_id) return 'warm_pool_env';
    if (env.WARM_STANDBY !== 'false') return 'standby_env';
    if (
      !inspection.container_image ||
      labels['underchat.worker_image'] !== inspection.container_image ||
      env.WORKER_IMAGE !== inspection.container_image
    ) {
      return 'worker_image_coherence';
    }
    if (
      labels['underchat.worker_grpc_port'] !== env.WORKER_GRPC_PORT ||
      !env.WORKER_GRPC_PORT
    ) {
      return 'worker_grpc_port_coherence';
    }
    const proxyMode = labels['underchat.proxy_mode'];
    if (proxyMode === 'direct') {
      if (env.PROXY_PROTOCOL || env.PROXY_HOST || env.PROXY_PORT) {
        return 'direct_proxy_coherence';
      }
    } else if (proxyMode === 'proxy') {
      if (
        !labels['underchat.proxy_fingerprint'] ||
        !env.PROXY_PROTOCOL ||
        !env.PROXY_HOST ||
        !env.PROXY_PORT
      ) {
        return 'proxy_coherence';
      }
    } else {
      return 'proxy_mode_label';
    }

    return undefined;
  }

  private resolveLegacyWarmContainerIdentityRejection(
    data: ValidatedActivateWarmWorkerRequest,
    warm: IWorkerWarmPool,
    workerType: EWorkerType,
    inspection: WorkerContainerInspection
  ): string | undefined {
    const expectedVolume = `warm-${data.warm_pool_id}`;
    const labels = inspection.container_labels ?? {};
    const env = inspection.container_env ?? {};

    if (!inspection.exists) return 'container_missing';
    if (!inspection.container_id) return 'container_id_missing';
    if (
      warm.server_id !== data.server_id ||
      warm.worker_type_id !== workerType ||
      warm.reserved_by_worker_id !== data.worker_id ||
      warm.container_id !== inspection.container_id ||
      warm.container_name !== expectedVolume ||
      warm.session_volume_name !== expectedVolume
    ) {
      return 'warm_row';
    }
    if (inspection.container_name !== data.worker_id) return 'container_name';
    if (
      labels['underchat.warm_standby'] !== 'true' ||
      env.WARM_STANDBY !== 'true' ||
      labels['underchat.warm_pool_id'] !== data.warm_pool_id ||
      env.WARM_POOL_ID !== data.warm_pool_id ||
      labels['underchat.server_id'] !== data.server_id ||
      labels['underchat.worker_type_id'] !== workerType ||
      env.WORKER_TYPE_ID !== workerType ||
      labels['underchat.session_volume_name'] !== expectedVolume ||
      env.SESSION_VOLUME_NAME !== expectedVolume
    ) {
      return 'standby_identity';
    }
    if (
      labels['underchat.worker_id'] !== undefined ||
      labels['underchat.account_id'] !== undefined ||
      labels['underchat.runtime_generation'] !== undefined ||
      env.WORKER_ID !== undefined ||
      env.ACCOUNT_ID !== undefined ||
      env.RUNTIME_GENERATION !== undefined
    ) {
      return 'mixed_identity';
    }
    if (
      !inspection.container_image ||
      labels['underchat.worker_image'] !== inspection.container_image ||
      env.WORKER_IMAGE !== inspection.container_image ||
      !env.WORKER_GRPC_PORT ||
      labels['underchat.worker_grpc_port'] !== env.WORKER_GRPC_PORT
    ) {
      return 'runtime_coherence';
    }

    return undefined;
  }

  private async cleanupOwnedStaleWarmRuntime(
    data: ValidatedCreateWarmWorkerRequest,
    workerType: EWorkerType,
    inspection: WorkerContainerInspection,
    originalError: unknown,
    leaseContext: ILockLeaseContext
  ): Promise<void> {
    if (
      this.resolveOwnedWarmContainerIdentityRejection(
        data,
        workerType,
        inspection,
        inspection.container_id
      )
    ) {
      throw originalError;
    }

    const volumeName = `warm-${data.warm_pool_id}`;
    leaseContext.assertActive();
    const current = await this.workerWarmPoolRepository.viewByIdConsistent(
      data.warm_pool_id
    );
    leaseContext.assertActive();
    if (
      !current ||
      (current.state !== EWorkerWarmPoolState.warming &&
        current.state !== EWorkerWarmPoolState.error)
    ) {
      throw originalError;
    }
    this.assertWarmCreationRowIdentity(current, data, workerType, volumeName);

    let volumeReferenced: boolean | undefined;
    try {
      volumeReferenced =
        await this.workerRuntimeRepository?.isSessionVolumeReferencedConsistent(
          volumeName
        );
    } catch (referenceError) {
      console.error('Failed to verify stale warm runtime volume ownership', {
        warm_pool_id: data.warm_pool_id,
        original_error: getErrorMessage(originalError),
        reference_error: getErrorMessage(referenceError),
      });
      throw originalError;
    }
    if (volumeReferenced !== false) {
      throw originalError;
    }

    try {
      leaseContext.assertActive();
      const confirmed =
        await this.workerService.inspectContainerWorkerByIdStrict(volumeName);
      leaseContext.assertActive();
      if (
        !confirmed.exists ||
        !inspection.container_id ||
        confirmed.container_id !== inspection.container_id ||
        !this.isWarmContainerOwnedByRequest(confirmed, data.warm_pool_id)
      ) {
        throw originalError;
      }

      const removed = await this.workerService.removeContainerWorkerById(
        inspection.container_id
      );
      if (!removed) throw originalError;
      leaseContext.assertActive();
      const stillReferenced =
        await this.workerRuntimeRepository?.isSessionVolumeReferencedConsistent(
          volumeName
        );
      leaseContext.assertActive();
      if (stillReferenced !== false) throw originalError;
      const volumeRemoved =
        await this.workerService.removeVolumeByName(volumeName);
      if (!volumeRemoved) throw originalError;
    } catch (cleanupError) {
      console.error('Failed to cleanup stale warm worker runtime', {
        warm_pool_id: data.warm_pool_id,
        container_id: inspection.container_id,
        container_name: inspection.container_name,
        session_volume_name: volumeName,
        original_error: getErrorMessage(originalError),
        cleanup_error: getErrorMessage(cleanupError),
      });
      throw originalError;
    }
  }

  private isWarmContainerOwnedByRequest(
    inspection: WorkerContainerInspection,
    warmPoolId: string
  ): boolean {
    const labels = inspection.container_labels ?? {};
    const env = inspection.container_env ?? {};
    return (
      labels['underchat.warm_pool_id'] === warmPoolId &&
      env.WARM_POOL_ID === warmPoolId
    );
  }

  private async createAndValidateWarmRuntime(
    data: ValidatedCreateWarmWorkerRequest,
    workerType: EWorkerType,
    leaseContext: ILockLeaseContext
  ): Promise<IWarmWorkerCommandResponseProto> {
    const imageName = getImageWorker(workerType);
    let runtime: WarmWorkerRuntimeReference | undefined;
    let creationAttempted = false;
    let readinessConfirmed = false;
    try {
      const proxy = await this.resolveServerProxyConfig(data.server_id);
      leaseContext.assertActive();
      const imageContentId = await this.resolveStableWorkerImageContentId(
        workerType,
        leaseContext
      );
      leaseContext.assertActive();
      const runtimeCapability = randomBytes(48).toString('base64url');
      const writerEpoch = randomUUID();
      creationAttempted = true;
      runtime = await this.workerService.createWarmContainerWorker({
        imageName,
        imageContentId,
        warmPoolId: data.warm_pool_id,
        serverId: data.server_id,
        workerTypeId: workerType,
        grpcHost: balanceEnvironment.grpcHost,
        grpcPort: balanceEnvironment.grpcPort,
        workerGrpcPort: this.getExpectedWorkerGrpcPort(workerType),
        runtimeCapability,
        writerEpoch,
        proxy,
      });
      leaseContext.assertActive();
      await this.assertWarmRuntimeReady(runtime, data.warm_pool_id, workerType);
      readinessConfirmed = true;
      leaseContext.assertActive();
      await this.persistWarmRuntimeReady(data, runtime, leaseContext);
      leaseContext.assertActive();
      return this.buildWarmRuntimeResponse(data.warm_pool_id, runtime);
    } catch (error) {
      if (creationAttempted && this.isWorkerLifecycleLeaseLost(leaseContext)) {
        throw new WarmCreationLeaseRecoveryRequiredError(error);
      }
      if (creationAttempted && !readinessConfirmed) {
        try {
          await this.cleanupRejectedWarmCreationEffect(
            runtime,
            data,
            workerType,
            error,
            leaseContext
          );
        } catch (cleanupError) {
          if (!this.isWorkerLifecycleLeaseLost(leaseContext)) {
            throw cleanupError;
          }
          throw new WarmCreationLeaseRecoveryRequiredError(error);
        }
      }
      throw error;
    }
  }

  private isWorkerLifecycleLeaseLost(leaseContext: ILockLeaseContext): boolean {
    if (leaseContext.signal.aborted) {
      return true;
    }
    try {
      leaseContext.assertActive();
      return false;
    } catch {
      return true;
    }
  }

  private async cleanupRejectedWarmCreationEffect(
    runtime: WarmWorkerRuntimeReference | undefined,
    data: ValidatedCreateWarmWorkerRequest,
    workerType: EWorkerType,
    originalError: unknown,
    leaseContext: ILockLeaseContext
  ): Promise<void> {
    leaseContext.assertActive();
    const expectedName = `warm-${data.warm_pool_id}`;
    const inspection =
      await this.workerService.inspectContainerWorkerByIdStrict(
        runtime?.container_id ?? expectedName
      );
    leaseContext.assertActive();

    if (inspection.exists) {
      const expectedContainerId =
        runtime?.container_id ?? inspection.container_id;
      const ownershipRejection =
        this.resolveOwnedWarmContainerIdentityRejection(
          data,
          workerType,
          inspection,
          expectedContainerId
        );
      if (
        ownershipRejection ||
        !inspection.container_id ||
        inspection.container_name !== expectedName ||
        (runtime &&
          (runtime.container_id !== inspection.container_id ||
            runtime.container_name !== inspection.container_name ||
            runtime.session_volume_name !== expectedName))
      ) {
        console.error('Rejected warm creation effect was not removed', {
          warm_pool_id: data.warm_pool_id,
          container_id: inspection.container_id,
          original_error: getErrorMessage(originalError),
          reason: ownershipRejection ?? 'runtime_reference_changed',
        });
        return;
      }

      await this.cleanupRejectedWarmRuntime(
        {
          container_id: inspection.container_id,
          container_name: expectedName,
          session_volume_name: expectedName,
        },
        data,
        workerType,
        getErrorMessage(originalError),
        leaseContext
      );
      return;
    }

    await this.cleanupUnreferencedWarmCreationVolume(
      data,
      workerType,
      originalError,
      leaseContext
    );
  }

  private async cleanupUnreferencedWarmCreationVolume(
    data: ValidatedCreateWarmWorkerRequest,
    workerType: EWorkerType,
    originalError: unknown,
    leaseContext: ILockLeaseContext
  ): Promise<void> {
    const expectedName = `warm-${data.warm_pool_id}`;
    leaseContext.assertActive();
    const current = await this.workerWarmPoolRepository.viewByIdConsistent(
      data.warm_pool_id
    );
    leaseContext.assertActive();
    if (
      !current ||
      (current.state !== EWorkerWarmPoolState.warming &&
        current.state !== EWorkerWarmPoolState.error)
    ) {
      return;
    }
    this.assertWarmCreationRowIdentity(current, data, workerType, expectedName);

    const referenced =
      await this.workerRuntimeRepository?.isSessionVolumeReferencedConsistent(
        expectedName
      );
    leaseContext.assertActive();
    if (referenced !== false) {
      return;
    }

    const confirmed =
      await this.workerService.inspectContainerWorkerByIdStrict(expectedName);
    leaseContext.assertActive();
    if (confirmed.exists) {
      return;
    }

    try {
      await this.workerService.removeVolumeByName(expectedName);
      leaseContext.assertActive();
    } catch (cleanupError) {
      console.error('Failed to cleanup rejected warm creation volume', {
        warm_pool_id: data.warm_pool_id,
        session_volume_name: expectedName,
        original_error: getErrorMessage(originalError),
        cleanup_error: getErrorMessage(cleanupError),
      });
    }
  }

  private async reconcileWarmCreationAfterLeaseLoss(
    data: ValidatedCreateWarmWorkerRequest,
    workerType: EWorkerType,
    originalError: unknown
  ): Promise<void> {
    try {
      await this.runWithWorkerLifecycleLock(
        `warm-pool:${data.warm_pool_id}`,
        'recover_lost_create_warm_worker',
        async (leaseContext) => {
          leaseContext.assertActive();
          const current =
            await this.workerWarmPoolRepository.viewByIdConsistent(
              data.warm_pool_id
            );
          leaseContext.assertActive();
          if (
            !current ||
            (current.state !== EWorkerWarmPoolState.warming &&
              current.state !== EWorkerWarmPoolState.error)
          ) {
            return;
          }
          if (current.session_storage === EWorkerSessionStorage.postgres) {
            await this.reconcilePostgresWarmCreationAfterLeaseLoss(
              data,
              current,
              workerType,
              originalError,
              leaseContext
            );
            return;
          }
          const expectedName = `warm-${data.warm_pool_id}`;
          this.assertWarmCreationRowIdentity(
            current,
            data,
            workerType,
            expectedName
          );
          const inspection =
            await this.workerService.inspectContainerWorkerByIdStrict(
              expectedName
            );
          leaseContext.assertActive();

          if (!inspection.exists) {
            await this.cleanupUnreferencedWarmCreationVolume(
              data,
              workerType,
              originalError,
              leaseContext
            );
            await this.recordWarmCreationError(
              data,
              originalError,
              leaseContext
            );
            return;
          }

          const ownershipRejection =
            this.resolveOwnedWarmContainerIdentityRejection(
              data,
              workerType,
              inspection,
              inspection.container_id
            );
          if (ownershipRejection) {
            console.error('Lost-lease warm runtime was left untouched', {
              warm_pool_id: data.warm_pool_id,
              container_id: inspection.container_id,
              original_error: getErrorMessage(originalError),
              reason: ownershipRejection,
            });
            return;
          }

          const recovered = await this.tryRecoverExistingWarmRuntime(
            current,
            data,
            workerType,
            inspection,
            leaseContext
          );
          if (!recovered) {
            await this.recordWarmCreationError(
              data,
              originalError,
              leaseContext
            );
          }
        },
        {
          layer: 'service',
          worker_id: `warm-pool:${data.warm_pool_id}`,
          worker_type_id: workerType,
          action: EWorkerAction.create,
        },
        {
          ...this.buildWarmCreationLeaseOptions(),
          acquireTimeoutMs: 15_000,
        }
      );
    } catch (recoveryError) {
      console.error('Failed to reconcile warm creation after lease loss', {
        warm_pool_id: data.warm_pool_id,
        original_error: getErrorMessage(originalError),
        recovery_error: getErrorMessage(recoveryError),
      });
    }
  }

  private async reconcilePostgresWarmCreationAfterLeaseLoss(
    data: ValidatedCreateWarmWorkerRequest,
    current: IWorkerWarmPool,
    workerType: EWorkerType,
    originalError: unknown,
    leaseContext: ILockLeaseContext
  ): Promise<void> {
    this.assertWarmCreationRowIdentity(current, data, workerType, null);
    const expectedName = `warm-${data.warm_pool_id}`;
    const inspection =
      await this.workerService.inspectContainerWorkerByIdStrict(expectedName);
    leaseContext.assertActive();
    if (!inspection.exists) {
      await this.workerWarmPoolRepository.recordPostgresCreationError({
        warmPoolId: data.warm_pool_id,
        serverId: data.server_id,
        workerTypeId: workerType,
        error: getErrorMessage(originalError),
      });
      return;
    }

    let runtime: WarmWorkerRuntimeReference | undefined;
    let rejection: unknown;
    try {
      this.assertPostgresWarmContainerIdentity(data, workerType, inspection);
      runtime = this.buildPostgresWarmRuntimeReference(
        inspection,
        expectedName
      );
      await this.assertWarmRuntimeReady(runtime, data.warm_pool_id, workerType);
    } catch (error) {
      rejection = error;
    }
    leaseContext.assertActive();

    if (!rejection && runtime) {
      await this.persistPostgresWarmRuntimeReady(
        data,
        workerType,
        runtime,
        leaseContext
      );
      return;
    }

    await this.cleanupOwnedPostgresWarmRuntime(
      data,
      workerType,
      inspection,
      rejection ?? originalError,
      leaseContext
    );
    leaseContext.assertActive();
    await this.workerWarmPoolRepository.recordPostgresCreationError({
      warmPoolId: data.warm_pool_id,
      serverId: data.server_id,
      workerTypeId: workerType,
      error: getErrorMessage(originalError),
    });
  }

  private async assertWarmRuntimeReady(
    runtime: WarmWorkerRuntimeReference,
    warmPoolId: string,
    workerType: EWorkerType
  ): Promise<void> {
    const expectedImageName = getImageWorker(workerType);
    const expectedImageIdBefore =
      await this.workerService.inspectImageContentId(expectedImageName);
    const inspectionBefore =
      await this.workerService.inspectContainerWorkerByIdStrict(
        runtime.container_id
      );
    this.assertWarmRuntimeImageIdentity({
      runtime,
      inspection: inspectionBefore,
      expectedImageName,
      expectedImageId: expectedImageIdBefore,
    });

    const containerHealth =
      await this.containerHealthService.checkServiceHealth(
        runtime.container_id,
        this.buildNewContainerHealthOptions()
      );
    this.assertWarmContainerHealth(containerHealth);

    if (this.isWorkerGrpcReadinessRequired(workerType)) {
      await this.workerBaileysGrpcClientService.waitForReady(
        runtime.container_name,
        workerType,
        30_000
      );
      await this.waitForWarmStandbyRuntimeHealth({
        containerName: runtime.container_name,
        warmPoolId,
        workerType,
      });
    }

    const inspectionAfter =
      await this.workerService.inspectContainerWorkerByIdStrict(
        runtime.container_id
      );
    const expectedImageIdAfter =
      await this.workerService.inspectImageContentId(expectedImageName);
    if (expectedImageIdBefore !== expectedImageIdAfter) {
      throw new Error('warm_worker_expected_image_changed_during_readiness');
    }
    this.assertWarmRuntimeImageIdentity({
      runtime,
      inspection: inspectionAfter,
      expectedImageName,
      expectedImageId: expectedImageIdAfter,
    });
  }

  private assertWarmRuntimeImageIdentity(input: {
    runtime: WarmWorkerRuntimeReference;
    inspection: WorkerContainerInspection;
    expectedImageName: string;
    expectedImageId: string;
  }): void {
    if (
      input.inspection.exists !== true ||
      input.inspection.container_id !== input.runtime.container_id ||
      input.inspection.container_name !== input.runtime.container_name ||
      input.inspection.container_image !== input.expectedImageName ||
      input.inspection.container_image_id?.toLowerCase() !==
        input.expectedImageId
    ) {
      throw new Error('warm_worker_content_image_identity_mismatch');
    }
  }

  private async inspectWarmActivationContentImageFence(input: {
    sourceContainerName: string;
    expectedContainerId: string;
    workerType: EWorkerType;
    initialInspection: WorkerContainerInspection;
    leaseContext: ILockLeaseContext;
  }): Promise<{
    status: 'current' | 'mismatch' | 'unstable';
    inspection: WorkerContainerInspection;
    expectedImageId?: string;
  }> {
    const expectedImageName = getImageWorker(input.workerType);
    const expectedImageIdBefore =
      await this.workerService.inspectImageContentId(expectedImageName);
    input.leaseContext.assertActive();
    const inspectionAfter =
      await this.workerService.inspectContainerWorkerByIdStrict(
        input.sourceContainerName
      );
    input.leaseContext.assertActive();
    const expectedImageIdAfter =
      await this.workerService.inspectImageContentId(expectedImageName);
    input.leaseContext.assertActive();

    if (expectedImageIdBefore !== expectedImageIdAfter) {
      return { status: 'unstable', inspection: inspectionAfter };
    }

    const stableContainer =
      input.initialInspection.exists === true &&
      inspectionAfter.exists === true &&
      input.initialInspection.container_id === input.expectedContainerId &&
      inspectionAfter.container_id === input.expectedContainerId &&
      input.initialInspection.container_image_id?.toLowerCase() ===
        inspectionAfter.container_image_id?.toLowerCase() &&
      input.initialInspection.container_image ===
        inspectionAfter.container_image;
    const current =
      stableContainer &&
      inspectionAfter.container_image === expectedImageName &&
      inspectionAfter.container_image_id?.toLowerCase() ===
        expectedImageIdAfter;

    return {
      status: current ? 'current' : 'mismatch',
      inspection: inspectionAfter,
      expectedImageId: current ? expectedImageIdAfter : undefined,
    };
  }

  private async resolveStableWorkerImageContentId(
    workerType: EWorkerType,
    leaseContext: ILockLeaseContext
  ): Promise<string> {
    const imageName = getImageWorker(workerType);
    leaseContext.assertActive();
    const provisioned =
      await this.workerService.ensureWorkerImageContentId(imageName);
    leaseContext.assertActive();
    const before = await this.workerService.inspectImageContentId(imageName);
    leaseContext.assertActive();
    const after = await this.workerService.inspectImageContentId(imageName);
    leaseContext.assertActive();
    if (before !== provisioned || before !== after) {
      throw new Error('worker_expected_image_changed_during_content_fence');
    }
    return after;
  }

  private assertActivatedContainerContentImage(input: {
    data: ValidatedActivateWarmWorkerRequest;
    containerId: string;
    inspection: WorkerContainerInspection;
    workerType: EWorkerType;
    expectedImageId: string;
  }): void {
    if (
      input.inspection.exists !== true ||
      input.inspection.container_id !== input.containerId ||
      input.inspection.container_name !== input.data.worker_id ||
      input.inspection.container_image !== getImageWorker(input.workerType) ||
      input.inspection.container_image_id?.toLowerCase() !==
        input.expectedImageId
    ) {
      throw new Error('warm_worker_activated_content_image_mismatch');
    }
  }

  private async persistWarmRuntimeReady(
    data: ValidatedCreateWarmWorkerRequest,
    runtime: WarmWorkerRuntimeReference,
    leaseContext: ILockLeaseContext
  ): Promise<void> {
    leaseContext.assertActive();
    const updated = await this.workerWarmPoolRepository.finalizeCreationReady({
      warmPoolId: data.warm_pool_id,
      serverId: data.server_id,
      workerTypeId: data.worker_type_id,
      containerId: runtime.container_id,
      containerName: runtime.container_name,
      sessionVolumeName: runtime.session_volume_name,
    });
    if (!updated) {
      throw new Error('warm_worker_ready_persistence_failed');
    }
  }

  private async recordWarmCreationError(
    data: ValidatedCreateWarmWorkerRequest,
    error: unknown,
    leaseContext: ILockLeaseContext
  ): Promise<void> {
    try {
      leaseContext.assertActive();
      const current = await this.workerWarmPoolRepository.viewByIdConsistent(
        data.warm_pool_id
      );
      leaseContext.assertActive();
      if (
        !current ||
        (current.state !== EWorkerWarmPoolState.warming &&
          current.state !== EWorkerWarmPoolState.error)
      ) {
        return;
      }
      await this.workerWarmPoolRepository.recordCreationError({
        warmPoolId: data.warm_pool_id,
        serverId: data.server_id,
        workerTypeId: data.worker_type_id,
        sessionVolumeName: `warm-${data.warm_pool_id}`,
        error: getErrorMessage(error),
      });
    } catch (persistenceError) {
      console.error('Failed to persist warm worker creation error', {
        warm_pool_id: data.warm_pool_id,
        original_error: getErrorMessage(error),
        persistence_error: getErrorMessage(persistenceError),
      });
    }
  }

  private buildWarmRuntimeResponse(
    warmPoolId: string,
    runtime: WarmWorkerRuntimeReference
  ): IWarmWorkerCommandResponseProto {
    return {
      warm_pool_id: warmPoolId,
      container_id: runtime.container_id,
      container_name: runtime.container_name,
      session_volume_name: runtime.session_volume_name,
    };
  }

  private assertWarmContainerHealth(health: ContainerHealthResult): void {
    if (health.healthy === true) {
      return;
    }

    const reason =
      health.health_failure_reason?.trim() ||
      health.health_error?.trim() ||
      (health.health_status_code
        ? `http_status_${health.health_status_code}`
        : 'unknown');
    throw new Error(`warm_worker_http_health_not_ready:${reason}`);
  }

  private async waitForWarmStandbyRuntimeHealth(input: {
    containerName: string;
    warmPoolId: string;
    workerType: EWorkerType;
  }): Promise<void> {
    let lastReason = 'unknown';

    for (
      let attempt = 1;
      attempt <= WARM_STANDBY_HEALTH_MAX_ATTEMPTS;
      attempt += 1
    ) {
      try {
        const health = await this.workerBaileysGrpcClientService.runtimeHealth(
          input.containerName,
          { warm_pool_id: input.warmPoolId },
          input.workerType
        );
        const rejectionReason = this.resolveWarmStandbyHealthRejection(
          health,
          input
        );
        if (!rejectionReason) {
          return;
        }
        lastReason = rejectionReason;
      } catch (error) {
        lastReason = `runtime_probe_failed:${getErrorMessage(error)}`;
      }

      if (attempt < WARM_STANDBY_HEALTH_MAX_ATTEMPTS) {
        await this.sleep(this.getWarmStandbyHealthRetryDelay(attempt));
      }
    }

    throw new Error(`warm_worker_runtime_health_not_ready:${lastReason}`);
  }

  private getWarmStandbyHealthRetryDelay(attempt: number): number {
    return Math.min(
      WARM_STANDBY_HEALTH_RETRY_MAX_MS,
      WARM_STANDBY_HEALTH_RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1)
    );
  }

  private async waitForActivatedWarmRuntimeHealth(input: {
    data: ValidatedActivateWarmWorkerRequest;
    workerType: EWorkerType;
    runtimeGeneration: number;
    leaseContext: ILockLeaseContext;
    requireConnectedSession?: boolean;
  }): Promise<IWorkerRuntimeHealthResponseProto> {
    let lastReason = 'unknown';

    for (
      let attempt = 1;
      attempt <= WARM_ACTIVATION_HEALTH_MAX_ATTEMPTS;
      attempt += 1
    ) {
      input.leaseContext.assertActive();
      try {
        const health = await this.workerBaileysGrpcClientService.runtimeHealth(
          input.data.worker_id,
          {
            worker_id: input.data.worker_id,
            warm_pool_id: input.data.warm_pool_id,
          },
          input.workerType
        );
        input.leaseContext.assertActive();
        const rejection = this.resolveActivatedWarmRuntimeHealthRejection(
          health,
          input
        );
        if (!rejection) {
          return health;
        }
        lastReason = rejection;
      } catch (error) {
        input.leaseContext.assertActive();
        lastReason = `runtime_probe_failed:${getErrorMessage(error)}`;
      }

      if (attempt < WARM_ACTIVATION_HEALTH_MAX_ATTEMPTS) {
        await this.sleep(this.getWarmActivationHealthRetryDelay(attempt));
      }
    }

    throw new Error(
      `warm_worker_activated_runtime_health_not_ready:${lastReason}`
    );
  }

  private resolveActivatedWarmRuntimeHealthRejection(
    health: IWorkerRuntimeHealthResponseProto,
    expected: {
      data: ValidatedActivateWarmWorkerRequest;
      workerType: EWorkerType;
      runtimeGeneration: number;
      requireConnectedSession?: boolean;
    }
  ): string | undefined {
    if (health.error?.trim()) return 'worker_reported_error';
    if (health.worker_id !== expected.data.worker_id) {
      return 'worker_id_mismatch';
    }
    if (health.account_id !== expected.data.account_id) {
      return 'account_id_mismatch';
    }
    if (health.worker_type_id !== expected.workerType) {
      return 'worker_type_id_mismatch';
    }
    if (health.warm_pool_id !== expected.data.warm_pool_id) {
      return 'warm_pool_id_mismatch';
    }
    if (Number(health.runtime_generation) !== expected.runtimeGeneration) {
      return 'runtime_generation_mismatch';
    }
    if (health.activated !== true) return 'activated_not_true';
    if (health.standby !== false) return 'standby_not_false';
    if (health.ready !== true) return 'ready_not_true';
    if (health.runtime_state !== 'active') return 'runtime_state_mismatch';
    if (expected.requireConnectedSession === true) {
      if (health.authenticated !== true) return 'session_not_authenticated';
      if (health.session_ready !== true) {
        return 'authenticated_session_not_ready';
      }
      if (health.can_send !== true) return 'session_cannot_send';
      if (health.can_receive_runtime !== true) {
        return 'session_cannot_receive';
      }
      if (health.kafka_unhealthy === true) return 'kafka_unhealthy';
      if (health.kafka_consumers_ready !== true) {
        return 'kafka_consumers_not_ready';
      }
      if (
        this.requiresKafkaDispatchAuthorization(health) &&
        health.kafka_consumers_authorized !== true
      ) {
        return 'kafka_consumers_not_authorized';
      }
      return undefined;
    }
    const hasUsableSession =
      health.authenticated === true || health.session_ready === true;
    if (hasUsableSession && health.authenticated !== true) {
      return 'session_not_authenticated';
    }
    if (!hasUsableSession && health.qr_stream_ready !== true) {
      return 'qr_stream_not_ready';
    }
    if (hasUsableSession && health.kafka_unhealthy === true) {
      return 'kafka_unhealthy';
    }
    if (hasUsableSession && health.kafka_consumers_ready !== true) {
      return 'kafka_consumers_not_ready';
    }
    if (
      hasUsableSession &&
      this.requiresKafkaDispatchAuthorization(health) &&
      health.kafka_consumers_authorized !== true
    ) {
      return 'kafka_consumers_not_authorized';
    }
    if (health.authenticated === true && health.session_ready !== true) {
      return 'authenticated_session_not_ready';
    }
    if (hasUsableSession && health.can_send !== true) {
      return 'session_cannot_send';
    }
    if (hasUsableSession && health.can_receive_runtime !== true) {
      return 'session_cannot_receive';
    }

    return undefined;
  }

  private async confirmOnlineWarmRuntimeConnection(
    input: {
      data: ValidatedActivateWarmWorkerRequest;
      workerType: EWorkerType;
      runtimeGeneration: number;
      leaseContext: ILockLeaseContext;
    },
    initialHealth: IWorkerRuntimeHealthResponseProto
  ): Promise<boolean> {
    let health = initialHealth;
    for (
      let attempt = 1;
      attempt <= WARM_ONLINE_HEALTH_STABILITY_ATTEMPTS;
      attempt += 1
    ) {
      const generalRejection = this.resolveActivatedWarmRuntimeHealthRejection(
        health,
        input
      );
      if (generalRejection) {
        throw new Error(
          `warm_worker_activated_runtime_health_not_ready:${generalRejection}`
        );
      }
      const connectedRejection =
        this.resolveActivatedWarmRuntimeHealthRejection(health, {
          ...input,
          requireConnectedSession: true,
        });
      if (!connectedRejection) return true;
      if (attempt === WARM_ONLINE_HEALTH_STABILITY_ATTEMPTS) return false;

      await this.sleep(this.getWarmActivationHealthRetryDelay(attempt));
      input.leaseContext.assertActive();
      health = await this.workerBaileysGrpcClientService.runtimeHealth(
        input.data.worker_id,
        {
          worker_id: input.data.worker_id,
          warm_pool_id: input.data.warm_pool_id,
        },
        input.workerType
      );
      input.leaseContext.assertActive();
    }
    return false;
  }

  private getWarmActivationHealthRetryDelay(attempt: number): number {
    return Math.min(
      WARM_ACTIVATION_HEALTH_RETRY_MAX_MS,
      WARM_ACTIVATION_HEALTH_RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1)
    );
  }

  private async cleanupRejectedWarmRuntime(
    runtime: Awaited<ReturnType<WorkerService['createWarmContainerWorker']>>,
    data: ValidatedCreateWarmWorkerRequest,
    workerType: EWorkerType,
    originalError: string,
    leaseContext: ILockLeaseContext
  ): Promise<void> {
    try {
      leaseContext.assertActive();
      const current = await this.workerWarmPoolRepository.viewByIdConsistent(
        data.warm_pool_id
      );
      leaseContext.assertActive();
      if (
        !current ||
        (current.state !== EWorkerWarmPoolState.warming &&
          current.state !== EWorkerWarmPoolState.error)
      ) {
        throw new Error('warm_worker_rejected_cleanup_state_changed');
      }
      this.assertWarmCreationRowIdentity(
        current,
        data,
        workerType,
        runtime.session_volume_name
      );

      const referencedBeforeRemoval =
        await this.workerRuntimeRepository?.isSessionVolumeReferencedConsistent(
          runtime.session_volume_name
        );
      leaseContext.assertActive();
      if (referencedBeforeRemoval !== false) {
        throw new Error('warm_worker_rejected_cleanup_volume_referenced');
      }

      const confirmed =
        await this.workerService.inspectContainerWorkerByIdStrict(
          runtime.container_id
        );
      leaseContext.assertActive();
      const identityRejection = this.resolveWarmContainerIdentityRejection(
        data,
        workerType,
        confirmed,
        runtime.container_id
      );
      if (
        identityRejection ||
        confirmed.container_name !== runtime.container_name ||
        runtime.session_volume_name !== `warm-${data.warm_pool_id}`
      ) {
        throw new Error(
          `warm_worker_rejected_cleanup_identity_mismatch:${
            identityRejection ?? 'runtime_reference'
          }`
        );
      }

      leaseContext.assertActive();
      const containerRemoved =
        await this.workerService.removeContainerWorkerById(
          runtime.container_id
        );
      if (!containerRemoved) {
        throw new Error('warm_worker_rejected_cleanup_container_not_removed');
      }
      leaseContext.assertActive();
      const referencedAfterRemoval =
        await this.workerRuntimeRepository?.isSessionVolumeReferencedConsistent(
          runtime.session_volume_name
        );
      leaseContext.assertActive();
      if (referencedAfterRemoval !== false) {
        throw new Error(
          'warm_worker_rejected_cleanup_volume_became_referenced'
        );
      }
      const volumeRemoved = await this.workerService.removeVolumeByName(
        runtime.session_volume_name
      );
      if (!volumeRemoved) {
        throw new Error('warm_worker_rejected_cleanup_volume_not_removed');
      }
      leaseContext.assertActive();
    } catch (cleanupError) {
      leaseContext.assertActive();
      console.error('Failed to cleanup rejected warm worker runtime', {
        warm_pool_id: data.warm_pool_id,
        container_id: runtime.container_id,
        container_name: runtime.container_name,
        session_volume_name: runtime.session_volume_name,
        original_error: originalError,
        cleanup_error: getErrorMessage(cleanupError),
      });
    }
  }

  private resolveWarmStandbyHealthRejection(
    health: IWorkerRuntimeHealthResponseProto,
    expected: {
      warmPoolId: string;
      workerType: EWorkerType;
    }
  ): string | undefined {
    if (health.error?.trim()) {
      return 'worker_reported_error';
    }
    if (health.warm_pool_id !== expected.warmPoolId) {
      return 'warm_pool_id_mismatch';
    }
    if (health.worker_type_id !== expected.workerType) {
      return 'worker_type_id_mismatch';
    }
    if (health.worker_id && health.worker_id !== expected.warmPoolId) {
      return 'worker_id_mismatch';
    }
    if (health.account_id && health.account_id !== 'warm-standby') {
      return 'account_id_mismatch';
    }
    if (health.standby !== true) {
      return 'standby_not_true';
    }
    if (health.ready !== true) {
      return 'ready_not_true';
    }
    if (health.activated !== false) {
      return 'activated_not_false';
    }
    if (health.runtime_state !== 'warm_standby') {
      return 'runtime_state_mismatch';
    }
    if (health.kafka_unhealthy === true) {
      return 'kafka_unhealthy';
    }
    if (health.kafka_consumers_ready === true) {
      return 'kafka_consumers_started_in_standby';
    }

    return undefined;
  }

  async deleteWarmWorker(data: IDeleteWarmWorkerRequestProto): Promise<void> {
    if (!data.warm_pool_id) {
      throw new Error('Missing required field: warm_pool_id');
    }

    const warmPoolId = data.warm_pool_id;
    await this.runWithWorkerLifecycleLock(
      `warm-pool:${warmPoolId}`,
      'delete_warm_worker',
      (leaseContext) =>
        this.deleteWarmWorkerWithLock(data, warmPoolId, leaseContext),
      {
        layer: 'service',
        worker_id: `warm-pool:${warmPoolId}`,
        worker_type_id: data.worker_type_id as EWorkerType,
        action: EWorkerAction.delete,
      }
    );
  }

  private async deleteWarmWorkerWithLock(
    data: IDeleteWarmWorkerRequestProto,
    warmPoolId: string,
    leaseContext: ILockLeaseContext
  ): Promise<void> {
    leaseContext.assertActive();
    const warm =
      await this.workerWarmPoolRepository.viewByIdConsistent(warmPoolId);
    leaseContext.assertActive();
    if (!warm) {
      return;
    }
    this.assertWarmDeleteRowIdentity(warm, data);
    if (warm.state !== EWorkerWarmPoolState.deleting) {
      throw new Error(`warm_worker_delete_state_conflict:${warm.state}`);
    }

    if (warm.session_storage === EWorkerSessionStorage.postgres) {
      await this.deletePostgresWarmWorkerWithLock(
        warm,
        warmPoolId,
        leaseContext
      );
      return;
    }
    this.assertLegacyWarmSession(warm);

    const runtimeReferenced =
      await this.workerRuntimeRepository?.isSessionVolumeReferencedConsistent(
        warm.session_volume_name
      );
    leaseContext.assertActive();
    if (runtimeReferenced !== false) {
      let lineageReconciled = false;
      if (runtimeReferenced === true) {
        lineageReconciled =
          await this.workerWarmPoolRepository.reconcileDeletingRuntimeLineage(
            warmPoolId
          );
        leaseContext.assertActive();
        if (!lineageReconciled) {
          throw new Error(
            'warm_worker_delete_runtime_lineage_reconcile_failed'
          );
        }
      }
      this.logDebug('service.warm_pool.delete_preserved', {
        layer: 'service',
        warm_pool_id: warmPoolId,
        session_volume_name: warm.session_volume_name,
        state: warm.state,
        reason: 'worker_runtime_reference',
        lineage_reconciled: lineageReconciled,
      });
      return;
    }

    if (
      (!warm.container_id && !warm.container_name) ||
      warm.last_error?.startsWith(LEGACY_WARM_RECLAIM_MARKER)
    ) {
      await this.deleteLegacyWarmStandbyWithProof(warm, data, leaseContext);
      return;
    }

    const inspectionKey =
      warm.container_id ||
      warm.container_name ||
      data.container_id ||
      data.container_name;
    if (inspectionKey) {
      const inspection =
        await this.workerService.inspectContainerWorkerByIdStrict(
          inspectionKey
        );
      leaseContext.assertActive();
      const convertedTarget = this.isConvertedWarmDeleteTarget(
        warm,
        inspection
      );
      if (convertedTarget && !inspection.exists) {
        throw new Error('converted_warm_reclaim_target_absent_unproven');
      }
      if (inspection.exists) {
        this.assertWarmDeleteContainerIdentity(warm, inspection);
        if (convertedTarget) {
          const ownerWorkerId = warm.reserved_by_worker_id as string;
          if (!ownerWorkerId || warm.container_name !== ownerWorkerId) {
            throw new Error('converted_warm_reclaim_row_identity_invalid');
          }
          await this.runWithWorkerLifecycleLock(
            ownerWorkerId,
            'delete_converted_warm_worker',
            (workerLeaseContext) =>
              this.deleteConvertedWarmTargetWithProof(
                warm,
                inspection,
                data,
                this.combineLockLeaseContexts(leaseContext, workerLeaseContext)
              ),
            {
              layer: 'service',
              worker_id: ownerWorkerId,
              account_id: inspection.container_labels?.['underchat.account_id'],
              worker_type_id: warm.worker_type_id as EWorkerType,
              action: EWorkerAction.delete,
            }
          );
          return;
        }
        this.assertStrictWarmStandbyDeleteIdentity(warm, inspection);
        const removed = await this.workerService.removeContainerWorkerById(
          inspection.container_id as string
        );
        leaseContext.assertActive();
        if (!removed) {
          throw new Error('warm_worker_delete_container_removal_failed');
        }
      }
    }

    if (data.remove_volume === true) {
      const stillReferenced =
        await this.workerRuntimeRepository?.isSessionVolumeReferencedConsistent(
          warm.session_volume_name
        );
      leaseContext.assertActive();
      if (stillReferenced !== false) {
        throw new Error('warm_worker_delete_volume_reference_changed');
      }
      const removed = await this.workerService.removeVolumeByName(
        warm.session_volume_name
      );
      leaseContext.assertActive();
      if (!removed) {
        throw new Error('warm_worker_delete_volume_removal_failed');
      }
    }

    const deleted = await this.workerWarmPoolRepository.deleteById(warmPoolId);
    leaseContext.assertActive();
    if (!deleted) {
      throw new Error('warm_worker_delete_state_changed');
    }
  }

  private async deletePostgresWarmWorkerWithLock(
    warm: IWorkerWarmPool,
    warmPoolId: string,
    leaseContext: ILockLeaseContext
  ): Promise<void> {
    if (warm.session_volume_name !== null) {
      throw new Error('postgres_warm_worker_has_session_volume');
    }
    if (warm.reserved_by_worker_id) {
      const runtime =
        await this.workerRuntimeRepository?.viewByWorkerIdConsistent(
          warm.reserved_by_worker_id
        );
      leaseContext.assertActive();
      if (runtime?.container_id) {
        throw new Error('postgres_warm_worker_is_owned_by_active_runtime');
      }
    }

    const inspectionKey = warm.container_id ?? warm.container_name;
    if (inspectionKey) {
      const inspection =
        await this.workerService.inspectContainerWorkerByIdStrict(
          inspectionKey
        );
      leaseContext.assertActive();
      if (inspection.exists) {
        const labels = inspection.container_labels ?? {};
        const env = inspection.container_env ?? {};
        if (
          inspection.container_id !== warm.container_id ||
          labels['underchat.warm_pool_id'] !== warmPoolId ||
          labels['underchat.session_storage'] !==
            EWorkerSessionStorage.postgres ||
          labels['underchat.session_volume_name'] !== undefined ||
          env.WARM_STANDBY !== 'true' ||
          env.SESSION_VOLUME_NAME !== undefined ||
          (inspection.container_mounts ?? []).some(
            (mount) => mount.destination === '/app/data'
          )
        ) {
          throw new Error('postgres_warm_worker_delete_identity_mismatch');
        }
        const removed = await this.workerService.removeContainerWorkerById(
          inspection.container_id as string
        );
        leaseContext.assertActive();
        if (!removed) {
          throw new Error('postgres_warm_worker_delete_container_failed');
        }
      }
    }
    const deleted = await this.workerWarmPoolRepository.deleteById(warmPoolId);
    leaseContext.assertActive();
    if (!deleted) {
      throw new Error('postgres_warm_worker_delete_state_changed');
    }
  }

  private isConvertedWarmDeleteTarget(
    warm: IWorkerWarmPool,
    inspection: WorkerContainerInspection
  ): boolean {
    const labels = inspection.container_labels ?? {};
    const env = inspection.container_env ?? {};
    return Boolean(
      warm.last_error?.startsWith(CONVERTED_WARM_RECLAIM_MARKER) ||
      (warm.reserved_by_worker_id &&
        warm.container_name === warm.reserved_by_worker_id) ||
      labels['underchat.warm_standby'] === 'false' ||
      env.WARM_STANDBY === 'false' ||
      labels['underchat.worker_id'] !== undefined ||
      labels['underchat.account_id'] !== undefined ||
      labels['underchat.runtime_generation'] !== undefined ||
      env.WORKER_ID !== undefined ||
      env.ACCOUNT_ID !== undefined ||
      env.RUNTIME_GENERATION !== undefined
    );
  }

  private assertStrictWarmStandbyDeleteIdentity(
    warm: IWorkerWarmPool,
    inspection: WorkerContainerInspection
  ): void {
    const expectedName = `warm-${warm.warm_pool_id}`;
    const labels = inspection.container_labels ?? {};
    const env = inspection.container_env ?? {};
    const hasActiveIdentity = [
      labels['underchat.worker_id'],
      labels['underchat.account_id'],
      labels['underchat.runtime_generation'],
      labels['underchat.lifecycle_operation_id'],
      env.WORKER_ID,
      env.ACCOUNT_ID,
      env.RUNTIME_GENERATION,
    ].some((value) => value !== undefined);
    if (
      inspection.container_name !== expectedName ||
      warm.container_name !== expectedName ||
      labels['underchat.warm_standby'] !== 'true' ||
      env.WARM_STANDBY !== 'true' ||
      labels['underchat.warm_pool_id'] !== warm.warm_pool_id ||
      env.WARM_POOL_ID !== warm.warm_pool_id ||
      labels['underchat.server_id'] !== warm.server_id ||
      labels['underchat.worker_type_id'] !== warm.worker_type_id ||
      env.WORKER_TYPE_ID !== warm.worker_type_id ||
      labels['underchat.session_volume_name'] !== warm.session_volume_name ||
      env.SESSION_VOLUME_NAME !== warm.session_volume_name ||
      hasActiveIdentity ||
      !this.hasExactWritableSessionVolumeMount(
        inspection,
        warm.session_volume_name
      )
    ) {
      throw new Error('warm_worker_delete_standby_identity_invalid');
    }
  }

  private async deleteConvertedWarmTargetWithProof(
    warm: IWorkerWarmPool,
    initialTarget: WorkerContainerInspection,
    data: IDeleteWarmWorkerRequestProto,
    leaseContext: ILockLeaseContext
  ): Promise<void> {
    this.assertLegacyWarmSession(warm);
    const containerId = warm.container_id?.trim();
    const ownerWorkerId = warm.reserved_by_worker_id?.trim();
    const labels = initialTarget.container_labels ?? {};
    const env = initialTarget.container_env ?? {};
    const accountId = labels['underchat.account_id']?.trim();
    const generationText = labels['underchat.runtime_generation']?.trim();
    const runtimeGeneration = Number(generationText);
    if (
      !containerId ||
      initialTarget.container_id !== containerId ||
      !ownerWorkerId ||
      warm.container_name !== ownerWorkerId ||
      !warm.last_error?.startsWith(CONVERTED_WARM_RECLAIM_MARKER) ||
      labels['underchat.worker_id'] !== ownerWorkerId ||
      env.WORKER_ID !== ownerWorkerId ||
      !accountId ||
      env.ACCOUNT_ID !== accountId ||
      labels['underchat.warm_standby'] !== 'false' ||
      env.WARM_STANDBY !== 'false' ||
      labels['underchat.warm_pool_id'] !== warm.warm_pool_id ||
      env.WARM_POOL_ID !== warm.warm_pool_id ||
      labels['underchat.server_id'] !== warm.server_id ||
      labels['underchat.worker_type_id'] !== warm.worker_type_id ||
      env.WORKER_TYPE_ID !== warm.worker_type_id ||
      labels['underchat.session_volume_name'] !== warm.session_volume_name ||
      env.SESSION_VOLUME_NAME !== warm.session_volume_name ||
      env.RUNTIME_GENERATION !== generationText ||
      !Number.isSafeInteger(runtimeGeneration) ||
      runtimeGeneration <= 0 ||
      !this.hasExactWritableSessionVolumeMount(
        initialTarget,
        warm.session_volume_name
      )
    ) {
      throw new Error('converted_warm_reclaim_target_identity_invalid');
    }

    const volumeBefore = await this.workerService.inspectVolumeByNameStrict(
      warm.session_volume_name
    );
    leaseContext.assertActive();
    if (!volumeBefore.exists || !volumeBefore.signature) {
      throw new Error('converted_warm_reclaim_volume_missing');
    }

    const reclaimed =
      await this.workerWarmPoolRepository.withConvertedDeletingReclaimFence(
        {
          warmPoolId: warm.warm_pool_id,
          serverId: warm.server_id,
          workerTypeId: warm.worker_type_id,
          containerId,
          containerName: ownerWorkerId,
          sessionVolumeName: warm.session_volume_name,
          ownerWorkerId,
        },
        async (databaseFence) => {
          leaseContext.assertActive();
          await databaseFence.assertSafe();
          leaseContext.assertActive();
          if (databaseFence.ownerAccountId !== accountId) {
            throw new Error(
              'converted_warm_reclaim_owner_account_identity_changed'
            );
          }

          let replacement: WorkerContainerInspection | undefined;
          if (databaseFence.ownerMode === 'replacement') {
            const replacementContainerId =
              databaseFence.replacementContainerId?.trim();
            if (
              !replacementContainerId ||
              replacementContainerId === containerId
            ) {
              throw new Error(
                'converted_warm_reclaim_replacement_pointer_invalid'
              );
            }
            replacement =
              await this.workerService.inspectContainerWorkerByIdStrict(
                replacementContainerId
              );
            leaseContext.assertActive();
            this.assertConvertedWarmReplacementIdentity(
              replacement,
              replacementContainerId,
              ownerWorkerId,
              accountId,
              warm,
              runtimeGeneration
            );
          }

          const mountedBefore =
            await this.workerService.listContainerIdsMountingVolumeStrict(
              warm.session_volume_name
            );
          leaseContext.assertActive();
          const allowedMountIds = new Set([
            containerId.toLowerCase(),
            ...(databaseFence.replacementContainerId
              ? [databaseFence.replacementContainerId.toLowerCase()]
              : []),
          ]);
          if (
            !mountedBefore.includes(containerId.toLowerCase()) ||
            mountedBefore.some((id) => !allowedMountIds.has(id))
          ) {
            throw new Error('converted_warm_reclaim_volume_ownership_changed');
          }
          if (
            replacement &&
            this.hasExactWritableSessionVolumeMount(
              replacement,
              warm.session_volume_name
            )
          ) {
            throw new Error(
              'converted_warm_reclaim_replacement_uses_session_volume'
            );
          }

          const target =
            await this.workerService.inspectContainerWorkerByIdStrict(
              containerId
            );
          leaseContext.assertActive();
          this.assertConvertedWarmTargetReinspection(
            warm,
            target,
            containerId,
            ownerWorkerId,
            accountId,
            runtimeGeneration
          );
          await databaseFence.assertSafe();
          leaseContext.assertActive();

          const removed =
            await this.workerService.removeContainerWorkerById(containerId);
          leaseContext.assertActive();
          if (!removed) {
            throw new Error('converted_warm_reclaim_container_removal_failed');
          }

          await databaseFence.assertSafe();
          leaseContext.assertActive();
          const targetAfter =
            await this.workerService.inspectContainerWorkerByIdStrict(
              containerId
            );
          leaseContext.assertActive();
          if (targetAfter.exists) {
            throw new Error('converted_warm_reclaim_container_still_present');
          }

          if (replacement && databaseFence.replacementContainerId) {
            replacement =
              await this.workerService.inspectContainerWorkerByIdStrict(
                databaseFence.replacementContainerId
              );
            leaseContext.assertActive();
            this.assertConvertedWarmReplacementIdentity(
              replacement,
              databaseFence.replacementContainerId,
              ownerWorkerId,
              accountId,
              warm,
              runtimeGeneration
            );
          }

          const mountedAfter =
            await this.workerService.listContainerIdsMountingVolumeStrict(
              warm.session_volume_name
            );
          leaseContext.assertActive();
          if (mountedAfter.length !== 0) {
            throw new Error('converted_warm_reclaim_volume_still_owned');
          }

          await databaseFence.assertSafe();
          leaseContext.assertActive();
          if (data.remove_volume === true) {
            const volumeRemoved =
              await this.workerService.removeConvertedWarmVolumeByProof(
                warm.session_volume_name,
                volumeBefore.signature
              );
            leaseContext.assertActive();
            if (!volumeRemoved) {
              throw new Error('converted_warm_reclaim_volume_removal_failed');
            }
          }
          await databaseFence.assertSafe();
          leaseContext.assertActive();
        }
      );
    leaseContext.assertActive();
    if (reclaimed === null) {
      throw new Error('converted_warm_reclaim_database_fence_rejected');
    }
  }

  private hasExactWritableSessionVolumeMount(
    inspection: WorkerContainerInspection,
    sessionVolumeName: string
  ): boolean {
    const mounts = (inspection.container_mounts ?? []).filter(
      (mount) => mount.destination === '/app/data'
    );
    return (
      mounts.length === 1 &&
      mounts[0].type === 'volume' &&
      mounts[0].name === sessionVolumeName &&
      mounts[0].read_write === true
    );
  }

  private assertConvertedWarmTargetReinspection(
    warm: IWorkerWarmPool,
    inspection: WorkerContainerInspection,
    containerId: string,
    ownerWorkerId: string,
    accountId: string,
    runtimeGeneration: number
  ): void {
    this.assertLegacyWarmSession(warm);
    const labels = inspection.container_labels ?? {};
    const env = inspection.container_env ?? {};
    if (
      !inspection.exists ||
      inspection.container_id !== containerId ||
      inspection.container_name !== ownerWorkerId ||
      labels['underchat.worker_id'] !== ownerWorkerId ||
      env.WORKER_ID !== ownerWorkerId ||
      labels['underchat.account_id'] !== accountId ||
      env.ACCOUNT_ID !== accountId ||
      labels['underchat.server_id'] !== warm.server_id ||
      labels['underchat.worker_type_id'] !== warm.worker_type_id ||
      env.WORKER_TYPE_ID !== warm.worker_type_id ||
      labels['underchat.warm_pool_id'] !== warm.warm_pool_id ||
      env.WARM_POOL_ID !== warm.warm_pool_id ||
      labels['underchat.warm_standby'] !== 'false' ||
      env.WARM_STANDBY !== 'false' ||
      labels['underchat.session_volume_name'] !== warm.session_volume_name ||
      env.SESSION_VOLUME_NAME !== warm.session_volume_name ||
      labels['underchat.runtime_generation'] !== String(runtimeGeneration) ||
      env.RUNTIME_GENERATION !== String(runtimeGeneration) ||
      !this.hasExactWritableSessionVolumeMount(
        inspection,
        warm.session_volume_name
      )
    ) {
      throw new Error('converted_warm_reclaim_target_identity_changed');
    }
  }

  private assertConvertedWarmReplacementIdentity(
    inspection: WorkerContainerInspection,
    replacementContainerId: string,
    ownerWorkerId: string,
    accountId: string,
    warm: IWorkerWarmPool,
    targetRuntimeGeneration: number
  ): void {
    this.assertLegacyWarmSession(warm);
    const labels = inspection.container_labels ?? {};
    const env = inspection.container_env ?? {};
    const replacementGeneration = Number(
      labels['underchat.runtime_generation']
    );
    const replacementSessionVolume =
      labels['underchat.session_volume_name']?.trim();
    if (
      !inspection.exists ||
      inspection.container_id !== replacementContainerId ||
      inspection.container_name !== ownerWorkerId ||
      inspection.running !== true ||
      labels['underchat.worker_id'] !== ownerWorkerId ||
      env.WORKER_ID !== ownerWorkerId ||
      labels['underchat.account_id'] !== accountId ||
      env.ACCOUNT_ID !== accountId ||
      labels['underchat.server_id'] !== warm.server_id ||
      labels['underchat.worker_type_id'] !== warm.worker_type_id ||
      env.WORKER_TYPE_ID !== warm.worker_type_id ||
      labels['underchat.warm_standby'] !== 'false' ||
      env.WARM_STANDBY !== 'false' ||
      !replacementSessionVolume ||
      env.SESSION_VOLUME_NAME !== replacementSessionVolume ||
      !this.hasExactWritableSessionVolumeMount(
        inspection,
        replacementSessionVolume
      ) ||
      env.RUNTIME_GENERATION !== String(replacementGeneration) ||
      !Number.isSafeInteger(replacementGeneration) ||
      replacementGeneration <= targetRuntimeGeneration
    ) {
      throw new Error('converted_warm_reclaim_replacement_identity_invalid');
    }
  }

  private async deleteLegacyWarmStandbyWithProof(
    initialWarm: IWorkerWarmPool,
    data: IDeleteWarmWorkerRequestProto,
    leaseContext: ILockLeaseContext
  ): Promise<void> {
    this.assertLegacyWarmSession(initialWarm);
    const expectedContainerName = `warm-${initialWarm.warm_pool_id}`;
    if (initialWarm.session_volume_name !== expectedContainerName) {
      throw new Error('legacy_warm_reclaim_session_identity_mismatch');
    }

    let warm = initialWarm;
    if (!warm.container_id && !warm.container_name) {
      leaseContext.assertActive();
      const mountedContainerIds =
        await this.workerService.listContainerIdsMountingVolumeStrict(
          warm.session_volume_name
        );
      leaseContext.assertActive();
      if (mountedContainerIds.length === 0) {
        const volumeBefore = await this.inspectLegacyWarmOrphanVolumeCandidate(
          warm,
          leaseContext
        );
        if (
          volumeBefore.exists &&
          (data.remove_volume !== true || !volumeBefore.signature)
        ) {
          throw new Error('legacy_warm_absent_volume_present');
        }
        const finalized =
          await this.workerWarmPoolRepository.finalizeLegacyDeletingResourcesAbsent(
            {
              warmPoolId: warm.warm_pool_id,
              serverId: warm.server_id,
              workerTypeId: warm.worker_type_id,
              containerName: expectedContainerName,
              sessionVolumeName: warm.session_volume_name,
            },
            async (databaseFence) => {
              leaseContext.assertActive();
              await this.assertLegacyWarmCanonicalContainerAbsentAndUnmounted(
                warm,
                leaseContext
              );
              await databaseFence.assertUnreferenced();
              leaseContext.assertActive();
              if (volumeBefore.exists) {
                const removed =
                  await this.workerService.removeLegacyWarmVolumeByProof(
                    warm.session_volume_name,
                    volumeBefore.signature
                  );
                leaseContext.assertActive();
                if (!removed) {
                  throw new Error('legacy_warm_orphan_volume_removal_failed');
                }
              }
              await databaseFence.assertUnreferenced();
              leaseContext.assertActive();
              await this.assertLegacyWarmPhysicalResourcesAbsent(
                warm,
                leaseContext
              );
            }
          );
        leaseContext.assertActive();
        if (!finalized) {
          throw new Error('legacy_warm_absent_database_fence_rejected');
        }
        return;
      }
      if (mountedContainerIds.length !== 1) {
        throw new Error('legacy_warm_reclaim_container_ownership_ambiguous');
      }
      const discoveredContainerId = mountedContainerIds[0];
      const discovered =
        await this.workerService.inspectContainerWorkerByIdStrict(
          discoveredContainerId
        );
      leaseContext.assertActive();
      this.assertLegacyWarmReclaimContainerIdentity(
        warm,
        discovered,
        discoveredContainerId
      );

      const claimed =
        await this.workerWarmPoolRepository.claimLegacyDeletingContainerForReclaim(
          {
            warmPoolId: warm.warm_pool_id,
            serverId: warm.server_id,
            workerTypeId: warm.worker_type_id,
            containerId: discoveredContainerId,
            containerName: expectedContainerName,
            sessionVolumeName: warm.session_volume_name,
          }
        );
      leaseContext.assertActive();
      if (!claimed) {
        throw new Error('legacy_warm_reclaim_database_claim_rejected');
      }
      this.assertLegacyWarmSession(claimed);
      warm = claimed;
    }

    const containerId = warm.container_id?.trim().toLowerCase();
    if (
      !containerId ||
      !DOCKER_CONTAINER_ID_PATTERN.test(containerId) ||
      warm.container_name !== expectedContainerName ||
      !warm.last_error?.startsWith(LEGACY_WARM_RECLAIM_MARKER)
    ) {
      throw new Error('legacy_warm_reclaim_durable_identity_invalid');
    }
    const reclaimInput: LegacyWarmReclaimInput = {
      warmPoolId: warm.warm_pool_id,
      serverId: warm.server_id,
      workerTypeId: warm.worker_type_id,
      containerId,
      containerName: expectedContainerName,
      sessionVolumeName: warm.session_volume_name,
    };

    leaseContext.assertActive();
    const volumeBefore = await this.workerService.inspectVolumeByNameStrict(
      warm.session_volume_name
    );
    leaseContext.assertActive();

    const reclaimed =
      await this.workerWarmPoolRepository.withLegacyDeletingReclaimFence(
        reclaimInput,
        async (databaseFence) => {
          leaseContext.assertActive();
          await databaseFence.assertUnreferenced();
          leaseContext.assertActive();

          const mountedContainerIds =
            await this.workerService.listContainerIdsMountingVolumeStrict(
              warm.session_volume_name
            );
          leaseContext.assertActive();
          const confirmation =
            await this.workerService.inspectContainerWorkerByIdStrict(
              containerId
            );
          leaseContext.assertActive();
          if (confirmation.exists) {
            if (
              mountedContainerIds.length !== 1 ||
              mountedContainerIds[0] !== containerId
            ) {
              throw new Error(
                'legacy_warm_reclaim_container_ownership_changed'
              );
            }
            this.assertLegacyWarmReclaimContainerIdentity(
              warm,
              confirmation,
              containerId
            );
            if (!volumeBefore.exists || !volumeBefore.signature) {
              throw new Error('legacy_warm_reclaim_volume_missing');
            }
            const removed =
              await this.workerService.removeContainerWorkerById(containerId);
            leaseContext.assertActive();
            if (!removed) {
              throw new Error('legacy_warm_reclaim_container_removal_failed');
            }
            const removedContainer =
              await this.workerService.inspectContainerWorkerByIdStrict(
                containerId
              );
            leaseContext.assertActive();
            if (removedContainer.exists) {
              throw new Error('legacy_warm_reclaim_container_still_present');
            }
          } else if (mountedContainerIds.length !== 0) {
            throw new Error('legacy_warm_reclaim_volume_owner_changed');
          }

          await databaseFence.assertUnreferenced();
          leaseContext.assertActive();
          if (data.remove_volume === true) {
            const volumeRemoved =
              await this.workerService.removeLegacyWarmVolumeByProof(
                warm.session_volume_name,
                volumeBefore.signature
              );
            leaseContext.assertActive();
            if (!volumeRemoved) {
              throw new Error('legacy_warm_reclaim_volume_removal_failed');
            }
          }
          await databaseFence.assertUnreferenced();
          leaseContext.assertActive();
        }
      );
    leaseContext.assertActive();
    if (reclaimed === null) {
      throw new Error('legacy_warm_reclaim_database_fence_rejected');
    }
  }

  private async assertLegacyWarmPhysicalResourcesAbsent(
    warm: IWorkerWarmPool,
    leaseContext: ILockLeaseContext
  ): Promise<void> {
    this.assertLegacyWarmSession(warm);
    await this.assertLegacyWarmCanonicalContainerAbsentAndUnmounted(
      warm,
      leaseContext
    );

    const volume = await this.workerService.inspectVolumeByNameStrict(
      warm.session_volume_name
    );
    leaseContext.assertActive();
    if (volume.exists) {
      throw new Error('legacy_warm_absent_volume_present');
    }
  }

  private async inspectLegacyWarmOrphanVolumeCandidate(
    warm: IWorkerWarmPool,
    leaseContext: ILockLeaseContext
  ): Promise<WorkerVolumeInspection> {
    this.assertLegacyWarmSession(warm);
    await this.assertLegacyWarmCanonicalContainerAbsentAndUnmounted(
      warm,
      leaseContext
    );

    const volume = await this.workerService.inspectVolumeByNameStrict(
      warm.session_volume_name
    );
    leaseContext.assertActive();
    return volume;
  }

  private async assertLegacyWarmCanonicalContainerAbsentAndUnmounted(
    warm: IWorkerWarmPool,
    leaseContext: ILockLeaseContext
  ): Promise<void> {
    this.assertLegacyWarmSession(warm);
    const expectedContainerName = `warm-${warm.warm_pool_id}`;
    const mountedContainerIds =
      await this.workerService.listContainerIdsMountingVolumeStrict(
        warm.session_volume_name
      );
    leaseContext.assertActive();
    if (mountedContainerIds.length !== 0) {
      throw new Error('legacy_warm_absent_volume_mount_present');
    }

    const canonicalContainer =
      await this.workerService.inspectContainerWorkerByIdStrict(
        expectedContainerName
      );
    leaseContext.assertActive();
    if (canonicalContainer.exists) {
      throw new Error('legacy_warm_absent_container_present');
    }
  }

  private assertLegacyWarmReclaimContainerIdentity(
    warm: IWorkerWarmPool,
    inspection: WorkerContainerInspection,
    expectedContainerId: string
  ): void {
    this.assertLegacyWarmSession(warm);
    const expectedName = `warm-${warm.warm_pool_id}`;
    const labels = inspection.container_labels ?? {};
    const env = inspection.container_env ?? {};
    const mounts = inspection.container_mounts ?? [];
    const appDataMounts = mounts.filter(
      (mount) => mount.destination === '/app/data'
    );
    const lifecycleState = inspection.container_state?.trim().toLowerCase();
    const hasStoppedLifecycleState = Boolean(
      lifecycleState &&
      ['created', 'dead', 'exited', 'removing'].includes(lifecycleState)
    );
    const hasRunningLifecycleState = Boolean(
      inspection.running === true &&
      (lifecycleState === 'running' ||
        (lifecycleState === 'paused' && inspection.container_paused === true) ||
        (lifecycleState === 'restarting' &&
          inspection.container_paused !== true))
    );
    const hasCanonicalLifecycleState =
      hasRunningLifecycleState ||
      (inspection.running === false && hasStoppedLifecycleState);
    const hasActiveOwnerIdentity = [
      labels['underchat.worker_id'],
      labels['underchat.account_id'],
      labels['underchat.lifecycle_operation_id'],
      labels['underchat.runtime_generation'],
      env.WORKER_ID,
      env.ACCOUNT_ID,
      env.RUNTIME_GENERATION,
    ].some((value) => value !== undefined);
    const conflict = !inspection.exists
      ? 'container_missing'
      : inspection.container_id?.trim().toLowerCase() !== expectedContainerId
        ? 'container_id'
        : inspection.container_name !== expectedName
          ? 'container_name'
          : !hasCanonicalLifecycleState
            ? 'container_not_stopped'
            : labels['underchat.warm_standby'] !== 'true' ||
                env.WARM_STANDBY !== 'true'
              ? 'standby_identity'
              : labels['underchat.warm_pool_id'] !== warm.warm_pool_id ||
                  env.WARM_POOL_ID !== warm.warm_pool_id
                ? 'warm_pool_id'
                : labels['underchat.server_id'] !== warm.server_id
                  ? 'server_id'
                  : labels['underchat.worker_type_id'] !==
                        warm.worker_type_id ||
                      env.WORKER_TYPE_ID !== warm.worker_type_id
                    ? 'worker_type_id'
                    : labels['underchat.session_volume_name'] !==
                          warm.session_volume_name ||
                        env.SESSION_VOLUME_NAME !== warm.session_volume_name
                      ? 'session_volume_name'
                      : hasActiveOwnerIdentity
                        ? 'active_owner_identity'
                        : appDataMounts.length !== 1 ||
                            appDataMounts[0].type !== 'volume' ||
                            appDataMounts[0].name !==
                              warm.session_volume_name ||
                            appDataMounts[0].read_write !== true
                          ? 'session_mount'
                          : undefined;
    if (conflict) {
      throw new Error(`legacy_warm_reclaim_container_conflict:${conflict}`);
    }
  }

  private assertWarmDeleteRowIdentity(
    warm: IWorkerWarmPool,
    data: IDeleteWarmWorkerRequestProto
  ): void {
    const conflict =
      data.server_id && data.server_id !== warm.server_id
        ? 'server_id'
        : data.worker_type_id && data.worker_type_id !== warm.worker_type_id
          ? 'worker_type_id'
          : data.container_id &&
              warm.container_id &&
              data.container_id !== warm.container_id
            ? 'container_id'
            : data.session_volume_name &&
                data.session_volume_name !== warm.session_volume_name
              ? 'session_volume_name'
              : undefined;
    if (conflict) {
      throw new Error(`warm_worker_delete_row_conflict:${conflict}`);
    }
  }

  private assertWarmDeleteContainerIdentity(
    warm: IWorkerWarmPool,
    inspection: WorkerContainerInspection
  ): void {
    const labels = inspection.container_labels ?? {};
    const env = inspection.container_env ?? {};
    const conflict = !inspection.container_id
      ? 'container_id_missing'
      : warm.container_id && warm.container_id !== inspection.container_id
        ? 'container_id'
        : warm.container_name &&
            warm.container_name !== inspection.container_name
          ? 'container_name'
          : labels['underchat.warm_pool_id'] !== warm.warm_pool_id ||
              env.WARM_POOL_ID !== warm.warm_pool_id
            ? 'warm_pool_id'
            : labels['underchat.server_id'] !== warm.server_id
              ? 'server_id'
              : labels['underchat.worker_type_id'] !== warm.worker_type_id ||
                  env.WORKER_TYPE_ID !== warm.worker_type_id
                ? 'worker_type_id'
                : labels['underchat.session_volume_name'] !==
                      warm.session_volume_name ||
                    env.SESSION_VOLUME_NAME !== warm.session_volume_name
                  ? 'session_volume_name'
                  : undefined;
    if (conflict) {
      throw new Error(`warm_worker_delete_container_conflict:${conflict}`);
    }
  }

  async activateWarmWorker(
    data: IActivateWarmWorkerRequestProto
  ): Promise<IWarmWorkerCommandResponseProto> {
    if (
      !data.warm_pool_id ||
      !data.worker_id ||
      !data.account_id ||
      !data.server_id ||
      !data.worker_type_id
    ) {
      throw new Error(
        'Missing required fields: warm_pool_id, worker_id, account_id, server_id, worker_type_id'
      );
    }

    const normalizedSessionStorage = data.session_storage?.trim();
    if (
      normalizedSessionStorage &&
      !Object.values(EWorkerSessionStorage).includes(
        normalizedSessionStorage as EWorkerSessionStorage
      )
    ) {
      throw new Error('Invalid session_storage');
    }

    const activationData: ValidatedActivateWarmWorkerRequest = {
      ...data,
      warm_pool_id: data.warm_pool_id,
      worker_id: data.worker_id,
      account_id: data.account_id,
      server_id: data.server_id,
      worker_type_id: data.worker_type_id,
      session_storage: normalizedSessionStorage || undefined,
    };
    const workerType = activationData.worker_type_id as EWorkerType;
    if (!Object.values(EWorkerType).includes(workerType)) {
      throw new Error('Invalid worker_type_id');
    }
    if (
      activationData.previous_worker_type_id &&
      !Object.values(EWorkerType).includes(
        activationData.previous_worker_type_id as EWorkerType
      )
    ) {
      throw new Error('Invalid previous_worker_type_id');
    }
    if (
      activationData.previous_worker_type_id &&
      activationData.previous_worker_type_id !== workerType
    ) {
      if (
        !supportsWhatsappSessionStorage(
          activationData.previous_worker_type_id
        ) ||
        !supportsWhatsappSessionStorage(workerType)
      ) {
        throw new Error('worker_type_change_unofficial_only');
      }
      if (
        activationData.session_storage !== EWorkerSessionStorage.postgres ||
        activationData.remove_session === true ||
        activationData.remove_volume === true ||
        !activationData.lifecycle_operation_id
      ) {
        throw new Error('worker_type_change_requires_postgres_session');
      }
    }

    return this.runWithWarmActivationServerSlot(
      activationData,
      (slotLeaseContext) =>
        this.runWithWorkerLifecycleLock(
          `warm-pool:${activationData.warm_pool_id}`,
          'activate_warm_pool',
          (warmLeaseContext) =>
            this.activateWarmWorkerWithWarmLock(
              activationData,
              workerType,
              this.combineLockLeaseContexts(slotLeaseContext, warmLeaseContext)
            ),
          {
            trace_id: activationData.debug_trace_id,
            layer: 'service',
            worker_id: `warm-pool:${activationData.warm_pool_id}`,
            account_id: activationData.account_id,
            worker_type_id: activationData.worker_type_id,
            lifecycle_operation_id: activationData.lifecycle_operation_id,
            action: EWorkerAction.create,
          }
        )
    );
  }

  private async runWithWarmActivationServerSlot<T>(
    data: ValidatedActivateWarmWorkerRequest,
    callback: (leaseContext: ILockLeaseContext) => Promise<T>
  ): Promise<T> {
    const startedAt = Date.now();
    return this.workerRecreateServerSlotService.withSlot(
      {
        serverId: data.server_id,
        workerId: data.worker_id,
        lifecycleOperationId: data.lifecycle_operation_id,
      },
      async (lease, slotLeaseContext) => {
        slotLeaseContext.assertActive();
        this.logDebug('service.warm_activation.server_slot_acquired', {
          trace_id: data.debug_trace_id,
          layer: 'service',
          worker_id: data.worker_id,
          account_id: data.account_id,
          worker_type_id: data.worker_type_id,
          lifecycle_operation_id: data.lifecycle_operation_id,
          warm_pool_id: data.warm_pool_id,
          server_id: data.server_id,
          slot: lease.slot,
          wait_ms: Date.now() - startedAt,
        });
        const result = await callback(slotLeaseContext);
        slotLeaseContext.assertActive();
        return result;
      },
      {
        acquireTimeoutMs: WARM_ACTIVATION_SERVER_SLOT_ACQUIRE_TIMEOUT_MS,
      }
    );
  }

  private async activateWarmWorkerWithWarmLock(
    data: ValidatedActivateWarmWorkerRequest,
    workerType: EWorkerType,
    warmLeaseContext: ILockLeaseContext
  ): Promise<IWarmWorkerCommandResponseProto> {
    warmLeaseContext.assertActive();
    const response = await this.runWithWorkerLifecycleLock(
      data.worker_id,
      'activate_warm_worker',
      (workerLeaseContext) =>
        this.activateWarmWorkerWithLocks(
          data,
          workerType,
          this.combineLockLeaseContexts(warmLeaseContext, workerLeaseContext)
        ),
      {
        trace_id: data.debug_trace_id,
        layer: 'service',
        worker_id: data.worker_id,
        account_id: data.account_id,
        worker_type_id: data.worker_type_id,
        lifecycle_operation_id: data.lifecycle_operation_id,
        action: EWorkerAction.create,
      }
    );
    warmLeaseContext.assertActive();
    return response;
  }

  private async activateWarmWorkerWithLocks(
    data: ValidatedActivateWarmWorkerRequest,
    workerType: EWorkerType,
    leaseContext: ILockLeaseContext
  ): Promise<IWarmWorkerCommandResponseProto> {
    leaseContext.assertActive();
    await this.assertAuthoritativeLifecycleSemanticFingerprint(
      data.worker_id,
      data.lifecycle_operation_id,
      data.lifecycle_semantic_fingerprint,
      new Set<IWorkerLifecycleQueueMessage['action']>(['activate_warm']),
      leaseContext
    );
    const [warm, worker] = await Promise.all([
      this.workerWarmPoolRepository.viewByIdConsistent(data.warm_pool_id),
      this.viewWorkerForMonitorConsistent(data.worker_id),
    ]);
    leaseContext.assertActive();
    const workerSessionStorage = worker?.session_storage;
    if (
      !worker ||
      worker.deleted_at ||
      worker.worker_id !== data.worker_id ||
      worker.account_id !== data.account_id ||
      worker.server_id !== data.server_id ||
      worker.worker_type_id !== workerType ||
      !workerSessionStorage ||
      !Object.values(EWorkerSessionStorage).includes(workerSessionStorage)
    ) {
      throw new Error('worker_session_storage_authoritative_fence_changed');
    }
    if (
      data.previous_worker_type_id !== undefined &&
      data.previous_worker_type_id !== workerType &&
      workerSessionStorage !== EWorkerSessionStorage.postgres
    ) {
      throw new Error('worker_type_change_requires_postgres_session');
    }
    if (
      data.session_storage !== undefined &&
      data.session_storage !== workerSessionStorage
    ) {
      throw new Error('worker_session_storage_authoritative_fence_changed');
    }
    data.session_storage = workerSessionStorage;
    if (!warm) {
      return this.resolveWarmActivationPoolMiss(data, undefined, leaseContext);
    }
    if (
      warm.server_id !== data.server_id ||
      warm.worker_type_id !== workerType ||
      warm.session_storage !== workerSessionStorage
    ) {
      return this.resolveWarmActivationPoolMiss(data, warm, leaseContext);
    }
    if (warm.session_storage === EWorkerSessionStorage.postgres) {
      return this.activatePostgresWarmWorker(
        data,
        warm,
        workerType,
        leaseContext
      );
    }
    if (
      (warm.state === EWorkerWarmPoolState.activating ||
        warm.state === EWorkerWarmPoolState.assigned) &&
      this.isPendingFailedWarmActivationCleanupForWorker(warm, data.worker_id)
    ) {
      return this.resumePendingFailedWarmActivationCleanup(
        data,
        warm,
        workerType,
        leaseContext
      );
    }
    if (warm.state === EWorkerWarmPoolState.error) {
      if (
        this.isPendingWarmActivationPreflightCleanupForWorker(
          warm,
          data.worker_id
        )
      ) {
        return this.cleanupRejectedWarmActivation({
          data,
          warm,
          workerType,
          reason: 'resumed_preflight_cleanup',
          leaseContext,
        });
      }
      return this.isConfirmedWarmActivationCleanupForWorker(
        warm,
        data.worker_id
      )
        ? this.resolveConfirmedWarmActivationCleanupRedelivery(
            data,
            warm,
            workerType,
            leaseContext
          )
        : this.resolveWarmActivationPoolMiss(data, warm, leaseContext);
    }
    if (warm.state === EWorkerWarmPoolState.assigned) {
      if (warm.reserved_by_worker_id !== data.worker_id) {
        return this.resolveWarmActivationPoolMiss(data, warm, leaseContext);
      }
      if (warm.container_name === `warm-${data.warm_pool_id}`) {
        return this.resolveCompletedLegacyWarmActivation(
          data,
          warm,
          workerType,
          leaseContext
        );
      }
      return this.resolveCompletedWarmActivationRedelivery(
        data,
        warm,
        workerType,
        leaseContext
      );
    }
    if (
      (warm.state !== EWorkerWarmPoolState.reserved &&
        warm.state !== EWorkerWarmPoolState.activating) ||
      warm.reserved_by_worker_id !== data.worker_id
    ) {
      return this.resolveWarmActivationPoolMiss(data, warm, leaseContext);
    }
    if (warm.state === EWorkerWarmPoolState.activating) {
      const interruptedCleanup =
        await this.resolveInterruptedWarmActivationCleanup(
          data,
          warm,
          workerType,
          leaseContext
        );
      if (interruptedCleanup) return interruptedCleanup;
    }
    await this.assertWarmActivationRuntimeResetAuthorized(data, leaseContext);
    let activationWarm = warm;
    const sourceContainerName =
      activationWarm.container_name || `warm-${data.warm_pool_id}`;
    const sessionVolumeName =
      activationWarm.session_volume_name || `warm-${data.warm_pool_id}`;
    const sourceInspection =
      await this.workerService.inspectContainerWorkerByIdStrict(
        sourceContainerName
      );
    leaseContext.assertActive();
    const legacyRenamedSource = await this.isLegacyRenamedWarmActivationSource(
      data,
      activationWarm,
      sourceInspection,
      workerType,
      leaseContext
    );
    const rejectionReason = legacyRenamedSource
      ? undefined
      : this.validateWarmActivation(
          data,
          activationWarm,
          sourceInspection,
          workerType
        );
    if (rejectionReason) {
      return this.cleanupRejectedWarmActivation({
        data,
        warm,
        workerType,
        sourceInspection,
        reason: rejectionReason,
        leaseContext,
      });
    }
    if (
      data.lifecycle_operation_id &&
      !(await this.isLifecycleOperationCurrent({
        action: EWorkerAction.create,
        worker_id: data.worker_id,
        account_id: data.account_id,
        server_id: data.server_id,
        worker_type_id: workerType,
        lifecycle_operation_id: data.lifecycle_operation_id,
      }))
    ) {
      return this.cleanupRejectedWarmActivation({
        data,
        warm: activationWarm,
        workerType,
        sourceInspection,
        reason: 'stale_lifecycle_operation',
        leaseContext,
      });
    }
    if (
      !data.lifecycle_operation_id &&
      !(await this.isWorkerSnapshotCurrent(
        data.worker_id,
        data.account_id,
        data.server_id,
        workerType,
        null
      ))
    ) {
      return this.cleanupRejectedWarmActivation({
        data,
        warm: activationWarm,
        workerType,
        sourceInspection,
        reason: 'worker_snapshot_changed',
        leaseContext,
      });
    }
    if (warm.state === EWorkerWarmPoolState.reserved) {
      const extendedReservationExpiresAt = new Date(
        Date.now() + WARM_ACTIVATION_RESERVATION_EXTENSION_MS
      ).toISOString();
      const reservationExtended =
        await this.workerWarmPoolRepository.extendActivationReservation({
          warmPoolId: data.warm_pool_id,
          reservedByWorkerId: data.worker_id,
          reservationExpiresAt: extendedReservationExpiresAt,
        });
      leaseContext.assertActive();
      if (!reservationExtended) {
        return this.resolveWarmActivationPoolMiss(data, warm, leaseContext);
      }
      activationWarm = {
        ...warm,
        reservation_expires_at: extendedReservationExpiresAt,
      };
    }
    const activationWorker =
      await this.workerService.viewWorkerForMonitorConsistent(data.worker_id);
    leaseContext.assertActive();
    const expectedWorkerStatusId = activationWorker?.worker_status_id as
      EWorkerStatus | undefined;
    if (
      activationWorker?.account_id !== data.account_id ||
      activationWorker.server_id !== data.server_id ||
      activationWorker.worker_type_id !== workerType ||
      activationWorker.lifecycle_operation_id !==
        (data.lifecycle_operation_id ?? null)
    ) {
      return this.cleanupRejectedWarmActivation({
        data,
        warm: activationWarm,
        workerType,
        sourceInspection,
        reason: 'worker_activation_status_changed',
        leaseContext,
      });
    }
    if (expectedWorkerStatusId === EWorkerStatus.online) {
      return this.resumeOnlineWarmActivationBeforeAssignment({
        data,
        warm: activationWarm,
        workerType,
        worker: activationWorker,
        leaseContext,
      });
    }
    if (
      expectedWorkerStatusId !== EWorkerStatus.creating &&
      expectedWorkerStatusId !== EWorkerStatus.recreating
    ) {
      return this.cleanupRejectedWarmActivation({
        data,
        warm: activationWarm,
        workerType,
        sourceInspection,
        reason: 'worker_activation_status_changed',
        leaseContext,
      });
    }
    const volumeReferencedByAnotherWorker =
      await this.workerRuntimeRepository?.isSessionVolumeReferencedByOtherWorkerConsistent(
        sessionVolumeName,
        data.worker_id
      );
    leaseContext.assertActive();
    if (volumeReferencedByAnotherWorker !== false) {
      return this.resolveWarmActivationPoolMiss(
        data,
        activationWarm,
        leaseContext
      );
    }

    const resolvedProxy = await this.resolveWorkerProxyConfigStrict(
      data.worker_id,
      data.server_id
    );
    leaseContext.assertActive();

    await this.invalidateQrAttemptState(data.worker_id, {
      accountId: data.account_id,
      workerType,
      previousWorkerType: data.previous_worker_type_id,
      reason: 'warm_activation_runtime_replacement',
      recreateReason:
        data.remove_volume === true
          ? 'activate_warm_with_volume_reset'
          : 'activate_warm_container_replaced',
      debugTraceId: data.debug_trace_id,
    });

    leaseContext.assertActive();
    return this.activateWarmWorkerRuntime(
      data,
      activationWarm,
      workerType,
      sourceInspection,
      sourceContainerName,
      sessionVolumeName,
      resolvedProxy,
      expectedWorkerStatusId,
      activationWorker.container_id,
      leaseContext
    );
  }

  private async activatePostgresWarmWorker(
    data: ValidatedActivateWarmWorkerRequest,
    warm: IWorkerWarmPool,
    workerType: EWorkerType,
    leaseContext: ILockLeaseContext
  ): Promise<IWarmWorkerCommandResponseProto> {
    if (
      warm.session_volume_name !== null ||
      warm.reserved_by_worker_id !== data.worker_id ||
      (warm.state !== EWorkerWarmPoolState.reserved &&
        warm.state !== EWorkerWarmPoolState.activating &&
        warm.state !== EWorkerWarmPoolState.assigned)
    ) {
      return this.resolveWarmActivationPoolMiss(data, warm, leaseContext);
    }

    if (!warm.container_id) {
      throw new Error('postgres_warm_worker_source_container_missing');
    }
    const sourceContainerId = warm.container_id;

    if (
      !/^[0-9a-f]{64}$/u.test(warm.runtime_capability_hash ?? '') ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        warm.session_writer_epoch ?? ''
      )
    ) {
      throw new Error('postgres_warm_worker_writer_identity_missing');
    }

    let source =
      await this.workerService.inspectContainerWorkerByIdStrict(
        sourceContainerId
      );
    leaseContext.assertActive();
    this.assertPostgresReusableWarmContainerIdentity(
      data,
      workerType,
      source,
      sourceContainerId
    );
    const writerIdentity =
      await this.workerService.inspectRuntimeWriterIdentityByContainerIdStrict(
        sourceContainerId
      );
    leaseContext.assertActive();
    if (
      createHash('sha256')
        .update(writerIdentity.runtimeCapability)
        .digest('hex') !== warm.runtime_capability_hash ||
      writerIdentity.writerEpoch !== warm.session_writer_epoch
    ) {
      throw new Error('postgres_warm_worker_writer_identity_mismatch');
    }

    const resolvedProxy = await this.resolveWorkerProxyConfigStrict(
      data.worker_id,
      data.server_id
    );
    leaseContext.assertActive();
    const sourceLabels = source.container_labels ?? {};
    const expectedProxyMode = resolvedProxy ? 'proxy' : 'direct';
    if (
      sourceLabels['underchat.proxy_mode'] !== expectedProxyMode ||
      sourceLabels['underchat.proxy_fingerprint'] !==
        workerProxyFingerprint(resolvedProxy)
    ) {
      return this.resolveWarmActivationPoolMiss(data, warm, leaseContext);
    }

    if (warm.state === EWorkerWarmPoolState.reserved) {
      const started = await this.workerWarmPoolRepository.beginActivation({
        warmPoolId: data.warm_pool_id,
        reservedByWorkerId: data.worker_id,
        expectedContainerId: sourceContainerId,
      });
      leaseContext.assertActive();
      if (!started) {
        throw new Error('postgres_warm_worker_activation_cas_failed');
      }
      warm = { ...warm, state: EWorkerWarmPoolState.activating };
    }

    let worker = await this.workerService.viewWorkerForMonitorConsistent(
      data.worker_id
    );
    leaseContext.assertActive();
    if (
      !worker ||
      worker.deleted_at ||
      worker.account_id !== data.account_id ||
      worker.server_id !== data.server_id ||
      worker.worker_type_id !== workerType
    ) {
      throw new Error('postgres_warm_worker_owner_identity_mismatch');
    }

    if (
      worker.worker_status_id !== EWorkerStatus.creating &&
      worker.worker_status_id !== EWorkerStatus.recreating &&
      worker.worker_status_id !== EWorkerStatus.disponible &&
      worker.worker_status_id !== EWorkerStatus.online
    ) {
      const transitioned = await this.updateWorkerWithLifecycleGuard(
        data.account_id,
        {
          worker_id: data.worker_id,
          worker_status_id: EWorkerStatus.creating,
        },
        {
          ...data,
          action: EWorkerAction.create,
          worker_type_id: workerType,
          previous_worker_type_id: data.previous_worker_type_id as
            EWorkerType | undefined,
          session_storage: EWorkerSessionStorage.postgres,
        } as IWorkerPayload,
        workerType
      );
      leaseContext.assertActive();
      if (!transitioned) {
        throw new Error('postgres_warm_worker_creating_cas_failed');
      }
      worker = await this.workerService.viewWorkerForMonitorConsistent(
        data.worker_id
      );
      leaseContext.assertActive();
      if (!worker) {
        throw new Error('postgres_warm_worker_owner_missing_after_cas');
      }
    }

    const recreateLifecycle = this.isPendingWarmRecreateLifecycle(data, worker);

    let runtime = await this.workerRuntimeRepository?.viewByWorkerIdConsistent(
      data.worker_id
    );
    leaseContext.assertActive();
    const reusableReservation = Boolean(
      runtime &&
      runtime.warm_pool_id === data.warm_pool_id &&
      runtime.session_storage === EWorkerSessionStorage.postgres &&
      runtime.session_volume_name === null &&
      runtime.container_id === sourceContainerId &&
      runtime.runtime_capability_hash === warm.runtime_capability_hash &&
      runtime.session_writer_epoch === warm.session_writer_epoch &&
      Number.isSafeInteger(runtime.runtime_generation) &&
      runtime.runtime_generation > 0
    );
    const runtimeGeneration = reusableReservation
      ? (runtime?.runtime_generation as number)
      : await this.reserveNextWorkerRuntimeGeneration(
          {
            ...data,
            action: EWorkerAction.create,
            worker_type_id: workerType,
            previous_worker_type_id: data.previous_worker_type_id as
              EWorkerType | undefined,
            session_storage: EWorkerSessionStorage.postgres,
          } as IWorkerPayload,
          null,
          runtime?.runtime_generation,
          data.warm_pool_id
        );
    leaseContext.assertActive();

    if (!reusableReservation) {
      const bound = await this.workerWarmPoolRepository.bindPostgresWarmRuntime(
        {
          warmPoolId: data.warm_pool_id,
          workerId: data.worker_id,
          accountId: data.account_id,
          serverId: data.server_id,
          workerTypeId: workerType,
          lifecycleOperationId: data.lifecycle_operation_id ?? null,
          containerId: sourceContainerId,
          containerName: data.worker_id,
          runtimeGeneration,
          runtimeCapabilityHash: warm.runtime_capability_hash as string,
          writerEpoch: warm.session_writer_epoch as string,
        }
      );
      leaseContext.assertActive();
      if (!bound) {
        throw new Error('postgres_warm_worker_runtime_bind_rejected');
      }
    }

    if (source.container_name === `warm-${data.warm_pool_id}`) {
      const target = await this.workerService.inspectContainerWorkerByIdStrict(
        data.worker_id
      );
      leaseContext.assertActive();
      if (target.exists && target.container_id !== sourceContainerId) {
        throw new Error('postgres_warm_worker_target_name_occupied');
      }
      if (!target.exists) {
        await this.workerService.renameContainer(
          sourceContainerId,
          data.worker_id
        );
        leaseContext.assertActive();
      }
    }

    source =
      await this.workerService.inspectContainerWorkerByIdStrict(
        sourceContainerId
      );
    leaseContext.assertActive();
    this.assertPostgresReusableWarmContainerIdentity(
      data,
      workerType,
      source,
      sourceContainerId,
      true
    );

    const activation =
      await this.workerBaileysGrpcClientService.activateRuntime(
        data.worker_id,
        {
          worker_id: data.worker_id,
          account_id: data.account_id,
          worker_type_id: workerType,
          warm_pool_id: data.warm_pool_id,
          runtime_generation: runtimeGeneration,
          session_storage: EWorkerSessionStorage.postgres,
          runtime_capability: writerIdentity.runtimeCapability,
          writer_epoch: writerIdentity.writerEpoch,
        },
        workerType
      );
    leaseContext.assertActive();
    if (activation.activated !== true) {
      throw new Error('postgres_warm_worker_runtime_activation_rejected');
    }

    if (recreateLifecycle) {
      await this.markAndPublishRecreateRuntimeStarted({
        data,
        workerType,
        containerId: sourceContainerId,
        runtimeGeneration,
        leaseContext,
      });
    }

    await this.assertActivatedWarmContainerReady({
      data,
      workerType,
      containerId: sourceContainerId,
      runtimeGeneration,
      leaseContext,
    });
    await this.waitForActivatedWarmRuntimeHealth({
      data,
      workerType,
      runtimeGeneration,
      leaseContext,
    });
    leaseContext.assertActive();

    worker = await this.workerService.viewWorkerForMonitorConsistent(
      data.worker_id
    );
    leaseContext.assertActive();
    if (!worker) {
      throw new Error('postgres_warm_worker_owner_missing_at_finalize');
    }
    const terminalWorkerStatus =
      worker.worker_status_id === EWorkerStatus.online
        ? EWorkerStatus.online
        : EWorkerStatus.disponible;
    if (
      recreateLifecycle ||
      (worker.worker_status_id !== EWorkerStatus.disponible &&
        worker.worker_status_id !== EWorkerStatus.online)
    ) {
      let finalized =
        await this.workerService.updateWorkerByIdIfLifecycleMatches(
          data.account_id,
          {
            worker_id: data.worker_id,
            container_id: sourceContainerId,
            worker_status_id: terminalWorkerStatus,
            lifecycle_operation_id: null,
          },
          {
            lifecycle_operation_id: data.lifecycle_operation_id ?? null,
            container_id: worker.container_id,
            runtime_container_id: sourceContainerId,
            runtime_generation: runtimeGeneration,
            server_id: data.server_id,
            worker_type_id: workerType,
            worker_status_id: worker.worker_status_id,
            ...(recreateLifecycle && data.lifecycle_operation_id
              ? {
                  recreate_completion: {
                    operation_id: data.lifecycle_operation_id,
                    runtime_generation: runtimeGeneration,
                    mode: this.replacementRuntimeCompletionMode(
                      worker.container_id,
                      sourceContainerId
                    ),
                  },
                }
              : {}),
          }
        );
      leaseContext.assertActive();
      if (!finalized && recreateLifecycle) {
        finalized = await this.finalizeAlreadyOnlineWorkerLifecycle(
          data.account_id,
          {
            ...data,
            action: EWorkerAction.recreate,
            worker_type_id: workerType,
          } as IWorkerPayload,
          workerType,
          sourceContainerId,
          runtimeGeneration
        );
        leaseContext.assertActive();
      }
      if (!finalized) {
        throw new Error('postgres_warm_worker_owner_finalize_cas_failed');
      }
    }

    if (warm.state !== EWorkerWarmPoolState.assigned) {
      const assigned = await this.workerWarmPoolRepository.markAssigned({
        warmPoolId: data.warm_pool_id,
        reservedByWorkerId: data.worker_id,
        expectedContainerId: sourceContainerId,
        assignedContainerId: sourceContainerId,
        assignedContainerName: data.worker_id,
      });
      leaseContext.assertActive();
      if (!assigned) {
        const current = await this.workerWarmPoolRepository.viewByIdConsistent(
          data.warm_pool_id
        );
        leaseContext.assertActive();
        if (
          current?.state !== EWorkerWarmPoolState.assigned ||
          current.container_id !== sourceContainerId ||
          current.reserved_by_worker_id !== data.worker_id
        ) {
          throw new Error('postgres_warm_worker_assignment_cas_failed');
        }
      }
    }
    await this.cleanupAssignedWarmPoolReferences(data.worker_id, {
      currentWarmPoolId: data.warm_pool_id,
    });

    await this.publishWarmRecreateTerminalIfCommitted({
      data,
      workerType,
      runtimeGeneration,
      leaseContext,
    });

    return {
      warm_pool_id: data.warm_pool_id,
      worker_id: data.worker_id,
      container_id: sourceContainerId,
      container_name: data.worker_id,
      session_volume_name: '',
      claimed: true,
    };
  }

  private assertPostgresReusableWarmContainerIdentity(
    data: ValidatedActivateWarmWorkerRequest,
    workerType: EWorkerType,
    inspection: WorkerContainerInspection,
    expectedContainerId: string,
    requireActivatedName: boolean = false
  ): void {
    const labels = inspection.container_labels ?? {};
    const env = inspection.container_env ?? {};
    const expectedName = requireActivatedName
      ? data.worker_id
      : inspection.container_name;
    const allowedName =
      expectedName === data.worker_id ||
      expectedName === `warm-${data.warm_pool_id}`;
    if (
      inspection.exists !== true ||
      inspection.running !== true ||
      inspection.container_id !== expectedContainerId ||
      !allowedName ||
      (requireActivatedName && inspection.container_name !== data.worker_id) ||
      labels['underchat.warm_standby'] !== 'true' ||
      labels['underchat.warm_pool_id'] !== data.warm_pool_id ||
      labels['underchat.server_id'] !== data.server_id ||
      labels['underchat.worker_type_id'] !== workerType ||
      labels['underchat.resource_profile'] !== 'active' ||
      labels['underchat.session_storage'] !== EWorkerSessionStorage.postgres ||
      labels['underchat.session_volume_name'] !== undefined ||
      labels['underchat.worker_id'] !== undefined ||
      labels['underchat.account_id'] !== undefined ||
      env.WARM_STANDBY !== 'true' ||
      env.WARM_POOL_ID !== data.warm_pool_id ||
      env.WORKER_TYPE_ID !== workerType ||
      env.WORKER_SESSION_STORAGE !== EWorkerSessionStorage.postgres ||
      env.SESSION_VOLUME_NAME !== undefined ||
      env.WORKER_ID !== undefined ||
      env.ACCOUNT_ID !== undefined ||
      (inspection.container_mounts ?? []).some(
        (mount) => mount.destination === '/app/data'
      )
    ) {
      throw new Error('postgres_warm_worker_source_identity_mismatch');
    }
  }

  private async assertWarmActivationRuntimeResetAuthorized(
    data: ValidatedActivateWarmWorkerRequest,
    leaseContext: ILockLeaseContext
  ): Promise<void> {
    const runtime =
      await this.workerRuntimeRepository?.viewByWorkerIdConsistent(
        data.worker_id
      );
    leaseContext.assertActive();
    if (!runtime) return;
    this.assertLegacyRuntimeSession(runtime);

    const expectedVolume = `warm-${data.warm_pool_id}`;
    const currentActivationRuntime =
      runtime.warm_pool_id === data.warm_pool_id &&
      runtime.session_volume_name === expectedVolume;
    const retiredRuntime =
      runtime.container_id === null &&
      runtime.warm_pool_id === null &&
      runtime.session_volume_name.startsWith('retired-warm-');

    if (currentActivationRuntime || retiredRuntime) return;
    if (data.remove_session === true && data.remove_volume === true) return;

    throw new Error('warm_worker_existing_runtime_reset_not_authorized');
  }

  private async resumeOnlineWarmActivationBeforeAssignment(input: {
    data: ValidatedActivateWarmWorkerRequest;
    warm: IWorkerWarmPool;
    workerType: EWorkerType;
    worker: NonNullable<
      Awaited<ReturnType<WorkerService['viewWorkerForMonitorConsistent']>>
    >;
    leaseContext: ILockLeaseContext;
  }): Promise<IWarmWorkerCommandResponseProto> {
    this.assertLegacyWarmSession(input.warm);
    const runtime =
      await this.workerRuntimeRepository?.viewByWorkerIdConsistent(
        input.data.worker_id
      );
    input.leaseContext.assertActive();
    if (
      input.warm.state !== EWorkerWarmPoolState.activating ||
      input.worker.lifecycle_operation_id !==
        (input.data.lifecycle_operation_id ?? null) ||
      input.worker.deleted_at ||
      !runtime?.container_id ||
      runtime.warm_pool_id !== input.data.warm_pool_id ||
      runtime.container_name !== input.data.worker_id ||
      runtime.session_volume_name !== input.warm.session_volume_name ||
      !Number.isSafeInteger(runtime.runtime_generation) ||
      runtime.runtime_generation <= 0
    ) {
      const error = new Error('warm_worker_online_resume_identity_mismatch');
      await this.restoreOnlineWarmActivationProvisioning(input, error);
      throw error;
    }
    this.assertLegacyRuntimeSession(runtime);

    const inspection =
      await this.workerService.inspectContainerWorkerByIdStrict(
        runtime.container_id
      );
    input.leaseContext.assertActive();
    const identityRejection =
      this.resolveOwnedActivatedWarmContainerIdentityRejection(
        input.data,
        input.workerType,
        runtime.runtime_generation,
        inspection,
        runtime.container_id,
        true
      );
    if (identityRejection) {
      const error = new Error(
        `warm_worker_online_resume_identity_mismatch:${identityRejection}`
      );
      await this.restoreOnlineWarmActivationProvisioning(input, error);
      throw error;
    }

    const [volumeExists, referencedByAnotherWorker] = await Promise.all([
      this.workerService.existsVolumeByNameStrict(
        input.warm.session_volume_name
      ),
      this.workerRuntimeRepository?.isSessionVolumeReferencedByOtherWorkerConsistent(
        input.warm.session_volume_name,
        input.data.worker_id
      ),
    ]);
    input.leaseContext.assertActive();
    if (!volumeExists || referencedByAnotherWorker !== false) {
      const error = new Error('warm_worker_online_resume_volume_mismatch');
      await this.restoreOnlineWarmActivationProvisioning(input, error);
      throw error;
    }

    if (this.isPendingWarmRecreateLifecycle(input.data, input.worker)) {
      await this.markAndPublishRecreateRuntimeStarted({
        data: input.data,
        workerType: input.workerType,
        containerId: runtime.container_id,
        runtimeGeneration: runtime.runtime_generation,
        leaseContext: input.leaseContext,
      });
    }

    let connected = false;
    try {
      await this.assertActivatedWarmContainerReady({
        data: input.data,
        workerType: input.workerType,
        containerId: runtime.container_id,
        runtimeGeneration: runtime.runtime_generation,
        leaseContext: input.leaseContext,
      });
      const health = await this.waitForActivatedWarmRuntimeHealth({
        data: input.data,
        workerType: input.workerType,
        runtimeGeneration: runtime.runtime_generation,
        leaseContext: input.leaseContext,
      });
      connected = await this.confirmOnlineWarmRuntimeConnection(
        {
          data: input.data,
          workerType: input.workerType,
          runtimeGeneration: runtime.runtime_generation,
          leaseContext: input.leaseContext,
        },
        health
      );
    } catch (error) {
      await this.restoreOnlineWarmActivationProvisioning(input, error);
      throw error;
    }
    input.leaseContext.assertActive();
    await this.workerRuntimeRepository?.upsert({
      worker_id: input.data.worker_id,
      container_id: runtime.container_id,
      container_name: input.data.worker_id,
      session_volume_name: input.warm.session_volume_name,
      runtime_generation: runtime.runtime_generation,
      warm_pool_id: input.data.warm_pool_id,
      activated_at: currentTime(),
    });
    input.leaseContext.assertActive();

    let assigned = false;
    let assignmentError: unknown;
    try {
      assigned = await this.workerWarmPoolRepository.markAssigned({
        warmPoolId: input.data.warm_pool_id,
        reservedByWorkerId: input.data.worker_id,
        expectedContainerId: input.warm.container_id as string,
        assignedContainerId: runtime.container_id,
        assignedContainerName: input.data.worker_id,
      });
      input.leaseContext.assertActive();
    } catch (error) {
      assignmentError = error;
    }
    if (!assigned) {
      const reconciled = await this.workerWarmPoolRepository.viewByIdConsistent(
        input.data.warm_pool_id
      );
      input.leaseContext.assertActive();
      const assignmentCommitted = Boolean(
        reconciled?.state === EWorkerWarmPoolState.assigned &&
        reconciled.reserved_by_worker_id === input.data.worker_id &&
        reconciled.container_id === runtime.container_id &&
        reconciled.container_name === input.data.worker_id &&
        reconciled.session_volume_name === input.warm.session_volume_name
      );
      if (!assignmentCommitted) {
        throw (
          assignmentError ??
          new Error('warm_worker_assignment_persistence_failed')
        );
      }
    }

    const finalizedStatus = connected
      ? await this.finalizeAssignedWarmWorkerRedelivery(
          input.data,
          input.workerType,
          runtime.container_id,
          input.worker,
          runtime.runtime_generation,
          input.leaseContext
        )
      : await this.finalizeQrReadyOnlineWarmActivationAsDisponible(
          input,
          runtime.container_id,
          runtime.runtime_generation
        );
    await this.cleanupAssignedWarmPoolReferences(input.data.worker_id, {
      currentWarmPoolId: input.data.warm_pool_id,
    });
    input.leaseContext.assertActive();
    const publishedRecreate = await this.publishWarmRecreateTerminalIfCommitted(
      {
        data: input.data,
        workerType: input.workerType,
        runtimeGeneration: runtime.runtime_generation,
        leaseContext: input.leaseContext,
      }
    );
    if (!publishedRecreate && finalizedStatus === EWorkerStatus.disponible) {
      await this.publishWarmActivationDisponible(
        input.data,
        input.workerType,
        runtime.container_id,
        runtime.runtime_generation
      );
    }

    return {
      warm_pool_id: input.data.warm_pool_id,
      worker_id: input.data.worker_id,
      container_id: runtime.container_id,
      container_name: input.data.worker_id,
      session_volume_name: input.warm.session_volume_name,
      claimed: true,
    };
  }

  private async restoreOnlineWarmActivationProvisioning(
    input: {
      data: ValidatedActivateWarmWorkerRequest;
      workerType: EWorkerType;
      worker: NonNullable<
        Awaited<ReturnType<WorkerService['viewWorkerForMonitorConsistent']>>
      >;
      leaseContext: ILockLeaseContext;
    },
    originalError: unknown
  ): Promise<void> {
    const recoveryStatus = EWorkerStatus.recreating;
    const restored =
      await this.workerService.updateWorkerByIdIfLifecycleMatches(
        input.data.account_id,
        {
          worker_id: input.data.worker_id,
          worker_status_id: recoveryStatus,
        },
        {
          lifecycle_operation_id: input.data.lifecycle_operation_id ?? null,
          container_id: input.worker.container_id,
          server_id: input.data.server_id,
          worker_type_id: input.workerType,
          worker_status_id: EWorkerStatus.online,
        }
      );
    input.leaseContext.assertActive();
    if (restored) return;

    const reconciled = await this.workerService.viewWorkerForMonitorConsistent(
      input.data.worker_id
    );
    input.leaseContext.assertActive();
    if (
      reconciled?.account_id === input.data.account_id &&
      reconciled.server_id === input.data.server_id &&
      reconciled.worker_type_id === input.workerType &&
      reconciled.worker_status_id === recoveryStatus &&
      reconciled.lifecycle_operation_id ===
        (input.data.lifecycle_operation_id ?? null)
    ) {
      return;
    }
    throw new Error(
      `warm_worker_online_resume_recovery_cas_failed:${getErrorMessage(
        originalError
      )}`
    );
  }

  private async finalizeQrReadyOnlineWarmActivationAsDisponible(
    input: {
      data: ValidatedActivateWarmWorkerRequest;
      workerType: EWorkerType;
      worker: NonNullable<
        Awaited<ReturnType<WorkerService['viewWorkerForMonitorConsistent']>>
      >;
      leaseContext: ILockLeaseContext;
    },
    containerId: string,
    runtimeGeneration: number
  ): Promise<EWorkerStatus.disponible> {
    const recreateLifecycle = this.isPendingWarmRecreateLifecycle(
      input.data,
      input.worker
    );
    const terminalUpdate: IUpdateWorker = {
      worker_id: input.data.worker_id,
      container_id: containerId,
      worker_status_id: EWorkerStatus.disponible,
      lifecycle_operation_id: null,
      number: null,
      connection_date: null,
    };
    let updated = await this.workerService.updateWorkerByIdIfLifecycleMatches(
      input.data.account_id,
      terminalUpdate,
      {
        lifecycle_operation_id: input.data.lifecycle_operation_id ?? null,
        container_id: input.worker.container_id,
        runtime_container_id: containerId,
        runtime_generation: runtimeGeneration,
        server_id: input.data.server_id,
        worker_type_id: input.workerType,
        worker_status_id: EWorkerStatus.online,
        ...(recreateLifecycle && input.data.lifecycle_operation_id
          ? {
              recreate_completion: {
                operation_id: input.data.lifecycle_operation_id,
                runtime_generation: runtimeGeneration,
                mode: this.replacementRuntimeCompletionMode(
                  input.worker.container_id,
                  containerId
                ),
              },
            }
          : {}),
      }
    );
    input.leaseContext.assertActive();
    if (updated) return EWorkerStatus.disponible;

    let reconciled = await this.workerService.viewWorkerForMonitorConsistent(
      input.data.worker_id
    );
    input.leaseContext.assertActive();
    if (
      reconciled?.account_id === input.data.account_id &&
      reconciled.server_id === input.data.server_id &&
      reconciled.worker_type_id === input.workerType &&
      reconciled.container_id === containerId &&
      reconciled.worker_status_id === EWorkerStatus.online &&
      reconciled.lifecycle_operation_id ===
        (input.data.lifecycle_operation_id ?? null)
    ) {
      updated = await this.workerService.updateWorkerByIdIfLifecycleMatches(
        input.data.account_id,
        terminalUpdate,
        {
          lifecycle_operation_id: input.data.lifecycle_operation_id ?? null,
          container_id: reconciled.container_id,
          runtime_container_id: containerId,
          runtime_generation: runtimeGeneration,
          server_id: input.data.server_id,
          worker_type_id: input.workerType,
          worker_status_id: EWorkerStatus.online,
          ...(recreateLifecycle && input.data.lifecycle_operation_id
            ? {
                recreate_completion: {
                  operation_id: input.data.lifecycle_operation_id,
                  runtime_generation: runtimeGeneration,
                  mode: 'replacement_runtime_already_online' as const,
                },
              }
            : {}),
        }
      );
      input.leaseContext.assertActive();
      if (updated) return EWorkerStatus.disponible;
      reconciled = await this.workerService.viewWorkerForMonitorConsistent(
        input.data.worker_id
      );
      input.leaseContext.assertActive();
    }
    if (
      reconciled?.account_id !== input.data.account_id ||
      reconciled.server_id !== input.data.server_id ||
      reconciled.worker_type_id !== input.workerType ||
      reconciled.container_id !== containerId ||
      reconciled.worker_status_id !== EWorkerStatus.disponible ||
      reconciled.lifecycle_operation_id !== null ||
      (recreateLifecycle &&
        !this.hasExactRecreateCompletion(
          input.data,
          reconciled,
          input.workerType,
          runtimeGeneration
        ))
    ) {
      throw new Error('warm_worker_qr_ready_finalize_cas_failed');
    }
    return EWorkerStatus.disponible;
  }

  private async isLegacyRenamedWarmActivationSource(
    data: ValidatedActivateWarmWorkerRequest,
    warm: IWorkerWarmPool,
    source: WorkerContainerInspection,
    workerType: EWorkerType,
    leaseContext: ILockLeaseContext
  ): Promise<boolean> {
    this.assertLegacyWarmSession(warm);
    if (
      (warm.state !== EWorkerWarmPoolState.reserved &&
        warm.state !== EWorkerWarmPoolState.activating) ||
      source.exists
    ) {
      return false;
    }
    const [target, runtime, worker] = await Promise.all([
      this.workerService.inspectContainerWorkerByIdStrict(data.worker_id),
      this.workerRuntimeRepository?.viewByWorkerIdConsistent(data.worker_id),
      this.workerService.viewWorkerForMonitorConsistent(data.worker_id),
    ]);
    leaseContext.assertActive();
    if (
      this.resolveLegacyWarmContainerIdentityRejection(
        data,
        warm,
        workerType,
        target
      )
    ) {
      return false;
    }
    const lifecycleMatches =
      worker?.lifecycle_operation_id === (data.lifecycle_operation_id ?? null);
    const provisioning =
      worker?.worker_status_id === EWorkerStatus.creating ||
      worker?.worker_status_id === EWorkerStatus.recreating;
    const online = worker?.worker_status_id === EWorkerStatus.online;
    if (
      worker?.deleted_at ||
      worker?.account_id !== data.account_id ||
      worker.server_id !== data.server_id ||
      worker.worker_type_id !== workerType ||
      !lifecycleMatches ||
      (!provisioning && !online)
    ) {
      return false;
    }

    const currentRuntime = Boolean(
      runtime &&
      runtime.warm_pool_id === data.warm_pool_id &&
      runtime.session_volume_name === warm.session_volume_name &&
      runtime.container_name === data.worker_id &&
      (!runtime.container_id || runtime.container_id === target.container_id) &&
      Number.isSafeInteger(runtime.runtime_generation) &&
      runtime.runtime_generation > 0
    );
    const previousRuntimeReset = Boolean(
      runtime &&
      data.remove_session === true &&
      data.remove_volume === true &&
      runtime.warm_pool_id !== data.warm_pool_id &&
      runtime.session_volume_name !== warm.session_volume_name &&
      runtime.container_id !== target.container_id
    );
    if (runtime && !currentRuntime && !previousRuntimeReset) return false;
    if (online && !currentRuntime) return false;
    const staleWorkerContainerId =
      worker.container_id &&
      worker.container_id !== target.container_id &&
      worker.container_id !== runtime?.container_id
        ? worker.container_id
        : undefined;
    if (staleWorkerContainerId) {
      if (data.remove_session !== true || data.remove_volume !== true) {
        return false;
      }
      const staleWorkerContainer =
        await this.workerService.inspectContainerWorkerByIdStrict(
          staleWorkerContainerId
        );
      leaseContext.assertActive();
      if (staleWorkerContainer.exists) return false;
    }
    if (previousRuntimeReset && runtime?.container_id) {
      const previous =
        await this.workerService.inspectContainerWorkerByIdStrict(
          runtime.container_id
        );
      leaseContext.assertActive();
      if (previous.exists) return false;
    }
    const [volumeExists, referencedByAnotherWorker] = await Promise.all([
      this.workerService.existsVolumeByNameStrict(warm.session_volume_name),
      this.workerRuntimeRepository?.isSessionVolumeReferencedByOtherWorkerConsistent(
        warm.session_volume_name,
        data.worker_id
      ),
    ]);
    leaseContext.assertActive();
    return volumeExists && referencedByAnotherWorker === false;
  }

  private async resolveCompletedLegacyWarmActivation(
    data: ValidatedActivateWarmWorkerRequest,
    warm: IWorkerWarmPool,
    workerType: EWorkerType,
    leaseContext: ILockLeaseContext
  ): Promise<IWarmWorkerCommandResponseProto> {
    this.assertLegacyWarmSession(warm);
    const [runtime, worker] = await Promise.all([
      this.workerRuntimeRepository?.viewByWorkerIdConsistent(data.worker_id),
      this.workerService.viewWorkerForMonitorConsistent(data.worker_id),
    ]);
    leaseContext.assertActive();
    if (
      !runtime?.container_id ||
      runtime.warm_pool_id !== data.warm_pool_id ||
      runtime.container_id !== warm.container_id ||
      runtime.container_name !== data.worker_id ||
      runtime.session_volume_name !== warm.session_volume_name ||
      !Number.isSafeInteger(runtime.runtime_generation) ||
      runtime.runtime_generation <= 0 ||
      worker?.deleted_at ||
      worker?.account_id !== data.account_id ||
      worker.server_id !== data.server_id ||
      worker.worker_type_id !== workerType
    ) {
      throw new Error('warm_worker_legacy_assigned_primary_identity_mismatch');
    }
    this.assertLegacyRuntimeSession(runtime);
    const alreadyFinalized =
      worker.container_id === runtime.container_id &&
      (worker.worker_status_id === EWorkerStatus.disponible ||
        worker.worker_status_id === EWorkerStatus.online) &&
      worker.lifecycle_operation_id === null;
    const lifecyclePending =
      worker.lifecycle_operation_id === (data.lifecycle_operation_id ?? null) &&
      (worker.worker_status_id === EWorkerStatus.creating ||
        worker.worker_status_id === EWorkerStatus.recreating ||
        worker.worker_status_id === EWorkerStatus.online);
    if (!alreadyFinalized && !lifecyclePending) {
      throw new Error('warm_worker_legacy_assigned_worker_mismatch');
    }

    let inspection = await this.workerService.inspectContainerWorkerByIdStrict(
      runtime.container_id
    );
    leaseContext.assertActive();
    let rejection = this.resolveLegacyWarmContainerIdentityRejection(
      data,
      warm,
      workerType,
      inspection
    );
    if (rejection) {
      throw new Error(
        `warm_worker_legacy_assigned_container_mismatch:${rejection}`
      );
    }
    if (inspection.running !== true) {
      const started = await this.workerService.startContainerWorkerById(
        runtime.container_id
      );
      leaseContext.assertActive();
      if (!started) {
        throw new Error('warm_worker_legacy_assigned_container_start_failed');
      }
      inspection = await this.workerService.inspectContainerWorkerByIdStrict(
        runtime.container_id
      );
      leaseContext.assertActive();
      rejection = this.resolveLegacyWarmContainerIdentityRejection(
        data,
        warm,
        workerType,
        inspection
      );
      if (rejection || inspection.running !== true) {
        throw new Error(
          `warm_worker_legacy_assigned_container_start_mismatch:${
            rejection ?? 'container_not_running'
          }`
        );
      }
    }
    const [volumeExists, referencedByAnotherWorker] = await Promise.all([
      this.workerService.existsVolumeByNameStrict(warm.session_volume_name),
      this.workerRuntimeRepository?.isSessionVolumeReferencedByOtherWorkerConsistent(
        warm.session_volume_name,
        data.worker_id
      ),
    ]);
    leaseContext.assertActive();
    if (!volumeExists || referencedByAnotherWorker !== false) {
      throw new Error('warm_worker_legacy_assigned_volume_mismatch');
    }

    if (this.isPendingWarmRecreateLifecycle(data, worker)) {
      await this.markAndPublishRecreateRuntimeStarted({
        data,
        workerType,
        containerId: runtime.container_id,
        runtimeGeneration: runtime.runtime_generation,
        leaseContext,
      });
    }

    let connected = false;
    try {
      await this.assertActivatedWarmContainerReady({
        data,
        workerType,
        containerId: runtime.container_id,
        runtimeGeneration: runtime.runtime_generation,
        leaseContext,
      });
      const health = await this.waitForActivatedWarmRuntimeHealth({
        data,
        workerType,
        runtimeGeneration: runtime.runtime_generation,
        leaseContext,
      });
      if (worker.worker_status_id === EWorkerStatus.online) {
        connected = await this.confirmOnlineWarmRuntimeConnection(
          {
            data,
            workerType,
            runtimeGeneration: runtime.runtime_generation,
            leaseContext,
          },
          health
        );
      }
    } catch (error) {
      if (worker.worker_status_id === EWorkerStatus.online) {
        await this.restoreOnlineWarmActivationProvisioning(
          { data, workerType, worker, leaseContext },
          error
        );
      }
      throw error;
    }
    leaseContext.assertActive();
    await this.workerRuntimeRepository?.upsert({
      worker_id: data.worker_id,
      container_id: runtime.container_id,
      container_name: data.worker_id,
      session_volume_name: warm.session_volume_name,
      runtime_generation: runtime.runtime_generation,
      warm_pool_id: data.warm_pool_id,
      activated_at: currentTime(),
    });
    leaseContext.assertActive();

    const finalizedStatus =
      worker.worker_status_id === EWorkerStatus.online && !connected
        ? await this.finalizeQrReadyOnlineWarmActivationAsDisponible(
            { data, workerType, worker, leaseContext },
            runtime.container_id,
            runtime.runtime_generation
          )
        : await this.finalizeAssignedWarmWorkerRedelivery(
            data,
            workerType,
            runtime.container_id,
            worker,
            runtime.runtime_generation,
            leaseContext
          );
    await this.cleanupAssignedWarmPoolReferences(data.worker_id, {
      currentWarmPoolId: data.warm_pool_id,
    });
    leaseContext.assertActive();
    const publishedRecreate = await this.publishWarmRecreateTerminalIfCommitted(
      {
        data,
        workerType,
        runtimeGeneration: runtime.runtime_generation,
        leaseContext,
      }
    );
    if (
      !publishedRecreate &&
      finalizedStatus === EWorkerStatus.disponible &&
      worker.worker_status_id !== EWorkerStatus.disponible
    ) {
      await this.publishWarmActivationDisponible(
        data,
        workerType,
        runtime.container_id,
        runtime.runtime_generation
      );
    }

    return {
      warm_pool_id: data.warm_pool_id,
      worker_id: data.worker_id,
      container_id: runtime.container_id,
      container_name: data.worker_id,
      session_volume_name: warm.session_volume_name,
      claimed: true,
    };
  }

  private async resolveCompletedWarmActivationRedelivery(
    data: ValidatedActivateWarmWorkerRequest,
    warm: IWorkerWarmPool,
    workerType: EWorkerType,
    leaseContext: ILockLeaseContext
  ): Promise<IWarmWorkerCommandResponseProto> {
    this.assertLegacyWarmSession(warm);
    if (
      warm.reserved_by_worker_id !== data.worker_id ||
      !warm.container_id ||
      warm.container_name !== data.worker_id
    ) {
      throw new Error('warm_worker_assigned_redelivery_owner_mismatch');
    }
    const [runtime, worker] = await Promise.all([
      this.workerRuntimeRepository?.viewByWorkerIdConsistent(data.worker_id),
      this.workerService.viewWorkerForMonitorConsistent(data.worker_id),
    ]);
    leaseContext.assertActive();
    if (
      !runtime ||
      runtime.warm_pool_id !== data.warm_pool_id ||
      runtime.container_id !== warm.container_id ||
      runtime.container_name !== data.worker_id ||
      runtime.session_volume_name !== warm.session_volume_name ||
      !Number.isSafeInteger(runtime.runtime_generation) ||
      runtime.runtime_generation <= 0
    ) {
      throw new Error('warm_worker_assigned_redelivery_runtime_mismatch');
    }
    this.assertLegacyRuntimeSession(runtime);
    let inspection = await this.workerService.inspectContainerWorkerByIdStrict(
      warm.container_id
    );
    leaseContext.assertActive();
    if (!inspection.exists) {
      const volumeExists = await this.workerService.existsVolumeByNameStrict(
        warm.session_volume_name
      );
      leaseContext.assertActive();
      if (!volumeExists) {
        const finalized = await this.finalizePhysicallyMissingWarmActivation({
          data,
          warm,
          runtime,
          expectedWarmState: EWorkerWarmPoolState.assigned,
          expectedWarmContainerId: warm.container_id,
          error: 'assigned_runtime_missing_after_interrupted_cleanup',
          leaseContext,
        });
        if (!finalized) {
          throw new Error(
            'warm_worker_assigned_missing_cleanup_finalization_failed'
          );
        }
        return this.confirmedWarmActivationCleanupResponse(data);
      }
      if (
        !this.isAssignedWarmWorkerProvisioningCurrent(data, workerType, worker)
      ) {
        throw new Error('warm_worker_assigned_redelivery_worker_mismatch');
      }
      const cleaned = await this.cleanupFailedActivatedWarmRuntime({
        data,
        workerType,
        containerId: runtime.container_id,
        sessionVolumeName: runtime.session_volume_name,
        runtimeGeneration: runtime.runtime_generation,
        expectedWorkerStatusId: worker?.worker_status_id as
          EWorkerStatus.creating | EWorkerStatus.recreating,
        expectedWarmState: EWorkerWarmPoolState.assigned,
        expectedWarmContainerId: warm.container_id,
        error: 'assigned_runtime_container_missing',
        leaseContext,
      });
      if (!cleaned) {
        throw new Error(
          'warm_worker_assigned_missing_cleanup_finalization_failed'
        );
      }
      return this.confirmedWarmActivationCleanupResponse(data);
    }
    const ownershipRejection =
      this.resolveOwnedActivatedWarmContainerIdentityRejection(
        data,
        workerType,
        runtime.runtime_generation,
        inspection,
        warm.container_id,
        false
      );
    if (ownershipRejection) {
      throw new Error(
        `warm_worker_assigned_redelivery_container_mismatch:${ownershipRejection}`
      );
    }
    if (
      worker?.account_id === data.account_id &&
      worker.server_id === data.server_id &&
      worker.worker_type_id === workerType &&
      worker.container_id === warm.container_id &&
      (worker.worker_status_id === EWorkerStatus.disponible ||
        worker.worker_status_id === EWorkerStatus.online) &&
      worker.lifecycle_operation_id === null
    ) {
      await this.publishWarmRecreateTerminalIfCommitted({
        data,
        workerType,
        runtimeGeneration: runtime.runtime_generation,
        leaseContext,
      });
      await this.cleanupAssignedWarmPoolReferences(data.worker_id, {
        currentWarmPoolId: data.warm_pool_id,
      });
      leaseContext.assertActive();
      return {
        warm_pool_id: data.warm_pool_id,
        worker_id: data.worker_id,
        container_id: warm.container_id,
        container_name: data.worker_id,
        session_volume_name: warm.session_volume_name,
        claimed: true,
      };
    }
    const expectedProxy = await this.resolveWorkerProxyConfigStrict(
      data.worker_id,
      data.server_id
    );
    leaseContext.assertActive();
    const conformanceRejection =
      this.resolveActivatedWarmContainerIdentityRejection(
        data,
        workerType,
        runtime.runtime_generation,
        inspection,
        warm.container_id,
        expectedProxy,
        true,
        false
      );
    if (conformanceRejection) {
      return this.cleanupAssignedWarmProvisioningFailure({
        data,
        warm,
        workerType,
        runtime,
        worker,
        error: new Error(
          `warm_worker_assigned_redelivery_container_mismatch:${conformanceRejection}`
        ),
        leaseContext,
      });
    }
    if (inspection.running !== true) {
      let started = false;
      try {
        started = await this.workerService.startContainerWorkerById(
          warm.container_id
        );
      } catch (error) {
        return this.cleanupAssignedWarmProvisioningFailure({
          data,
          warm,
          workerType,
          runtime,
          worker,
          error,
          leaseContext,
        });
      }
      leaseContext.assertActive();
      if (!started) {
        return this.cleanupAssignedWarmProvisioningFailure({
          data,
          warm,
          workerType,
          runtime,
          worker,
          error: new Error(
            'warm_worker_assigned_redelivery_container_start_failed'
          ),
          leaseContext,
        });
      }
      inspection = await this.workerService.inspectContainerWorkerByIdStrict(
        warm.container_id
      );
      leaseContext.assertActive();
    }
    const identityRejection =
      this.resolveActivatedWarmContainerIdentityRejection(
        data,
        workerType,
        runtime.runtime_generation,
        inspection,
        warm.container_id,
        expectedProxy,
        true
      );
    if (identityRejection) {
      return this.cleanupAssignedWarmProvisioningFailure({
        data,
        warm,
        workerType,
        runtime,
        worker,
        error: new Error(
          `warm_worker_assigned_redelivery_container_mismatch:${identityRejection}`
        ),
        leaseContext,
      });
    }
    if (this.isPendingWarmRecreateLifecycle(data, worker)) {
      await this.markAndPublishRecreateRuntimeStarted({
        data,
        workerType,
        containerId: warm.container_id,
        runtimeGeneration: runtime.runtime_generation,
        leaseContext,
      });
    }
    let connected = false;
    try {
      await this.assertActivatedWarmContainerReady({
        data,
        workerType,
        containerId: warm.container_id,
        runtimeGeneration: runtime.runtime_generation,
        leaseContext,
      });
      const health = await this.waitForActivatedWarmRuntimeHealth({
        data,
        workerType,
        runtimeGeneration: runtime.runtime_generation,
        leaseContext,
      });
      if (worker?.worker_status_id === EWorkerStatus.online) {
        connected = await this.confirmOnlineWarmRuntimeConnection(
          {
            data,
            workerType,
            runtimeGeneration: runtime.runtime_generation,
            leaseContext,
          },
          health
        );
      }
    } catch (error) {
      return this.cleanupAssignedWarmProvisioningFailure({
        data,
        warm,
        workerType,
        runtime,
        worker,
        error,
        leaseContext,
      });
    }
    const finalizedStatus =
      worker?.worker_status_id === EWorkerStatus.online && !connected
        ? await this.finalizeQrReadyOnlineWarmActivationAsDisponible(
            { data, workerType, worker, leaseContext },
            warm.container_id,
            runtime.runtime_generation
          )
        : await this.finalizeAssignedWarmWorkerRedelivery(
            data,
            workerType,
            warm.container_id,
            worker,
            runtime.runtime_generation,
            leaseContext
          );
    await this.cleanupAssignedWarmPoolReferences(data.worker_id, {
      currentWarmPoolId: data.warm_pool_id,
    });
    leaseContext.assertActive();
    const publishedRecreate = await this.publishWarmRecreateTerminalIfCommitted(
      {
        data,
        workerType,
        runtimeGeneration: runtime.runtime_generation,
        leaseContext,
      }
    );
    if (!publishedRecreate && finalizedStatus === EWorkerStatus.disponible) {
      await this.publishWarmActivationDisponible(
        data,
        workerType,
        warm.container_id,
        runtime.runtime_generation
      );
    }

    return {
      warm_pool_id: data.warm_pool_id,
      worker_id: data.worker_id,
      container_id: warm.container_id,
      container_name: data.worker_id,
      session_volume_name: warm.session_volume_name,
      claimed: true,
    };
  }

  private isAssignedWarmWorkerProvisioningCurrent(
    data: ValidatedActivateWarmWorkerRequest,
    workerType: EWorkerType,
    worker: Awaited<ReturnType<WorkerService['viewWorkerForMonitorConsistent']>>
  ): boolean {
    const lifecycleMatches =
      worker?.lifecycle_operation_id === (data.lifecycle_operation_id ?? null);
    const provisioning =
      worker?.worker_status_id === EWorkerStatus.creating ||
      worker?.worker_status_id === EWorkerStatus.recreating;
    return Boolean(
      worker?.account_id === data.account_id &&
      worker.server_id === data.server_id &&
      worker.worker_type_id === workerType &&
      lifecycleMatches &&
      provisioning
    );
  }

  private async cleanupAssignedWarmProvisioningFailure(input: {
    data: ValidatedActivateWarmWorkerRequest;
    warm: IWorkerWarmPool;
    workerType: EWorkerType;
    runtime: IWorkerRuntime;
    worker: Awaited<
      ReturnType<WorkerService['viewWorkerForMonitorConsistent']>
    >;
    error: unknown;
    leaseContext: ILockLeaseContext;
  }): Promise<IWarmWorkerCommandResponseProto> {
    this.assertLegacyWarmSession(input.warm);
    this.assertLegacyRuntimeSession(input.runtime);
    if (
      input.worker?.account_id === input.data.account_id &&
      input.worker.server_id === input.data.server_id &&
      input.worker.worker_type_id === input.workerType &&
      input.worker.worker_status_id === EWorkerStatus.online &&
      input.worker.lifecycle_operation_id ===
        (input.data.lifecycle_operation_id ?? null)
    ) {
      await this.restoreOnlineWarmActivationProvisioning(
        {
          data: input.data,
          workerType: input.workerType,
          worker: input.worker,
          leaseContext: input.leaseContext,
        },
        input.error
      );
      throw input.error;
    }
    if (
      !this.isAssignedWarmWorkerProvisioningCurrent(
        input.data,
        input.workerType,
        input.worker
      )
    ) {
      throw input.error;
    }
    const expectedWorkerStatusId = input.worker?.worker_status_id as
      EWorkerStatus.creating | EWorkerStatus.recreating;
    const cleaned = await this.cleanupFailedActivatedWarmRuntime({
      data: input.data,
      workerType: input.workerType,
      containerId: input.warm.container_id as string,
      sessionVolumeName: input.warm.session_volume_name,
      runtimeGeneration: input.runtime.runtime_generation,
      expectedWorkerStatusId,
      expectedWarmState: EWorkerWarmPoolState.assigned,
      expectedWarmContainerId: input.warm.container_id as string,
      error: getErrorMessage(input.error),
      leaseContext: input.leaseContext,
    });
    input.leaseContext.assertActive();
    if (!cleaned) throw input.error;
    return this.confirmedWarmActivationCleanupResponse(input.data);
  }

  private async finalizeAssignedWarmWorkerRedelivery(
    data: ValidatedActivateWarmWorkerRequest,
    workerType: EWorkerType,
    containerId: string,
    worker: Awaited<
      ReturnType<WorkerService['viewWorkerForMonitorConsistent']>
    >,
    runtimeGeneration: number,
    leaseContext: ILockLeaseContext
  ): Promise<EWorkerStatus.disponible | EWorkerStatus.online> {
    if (
      worker?.account_id !== data.account_id ||
      worker.server_id !== data.server_id ||
      worker.worker_type_id !== workerType
    ) {
      throw new Error('warm_worker_assigned_redelivery_worker_mismatch');
    }
    const alreadyFinalized =
      worker.container_id === containerId &&
      (worker.worker_status_id === EWorkerStatus.disponible ||
        worker.worker_status_id === EWorkerStatus.online) &&
      worker.lifecycle_operation_id === null;
    if (alreadyFinalized) {
      if (
        data.lifecycle_operation_id &&
        data.previous_worker_type_id &&
        !this.hasExactRecreateCompletion(
          data,
          worker,
          workerType,
          runtimeGeneration
        )
      ) {
        throw new Error('warm_worker_recreate_completion_tombstone_missing');
      }
      return worker.worker_status_id as
        EWorkerStatus.disponible | EWorkerStatus.online;
    }
    if (
      worker.worker_status_id === EWorkerStatus.online &&
      worker.lifecycle_operation_id === (data.lifecycle_operation_id ?? null)
    ) {
      const finalizedOnline =
        await this.workerService.updateWorkerByIdIfLifecycleMatches(
          data.account_id,
          {
            worker_id: data.worker_id,
            container_id: containerId,
            lifecycle_operation_id: null,
          },
          {
            lifecycle_operation_id: data.lifecycle_operation_id ?? null,
            container_id: worker.container_id,
            runtime_container_id: containerId,
            runtime_generation: runtimeGeneration,
            server_id: data.server_id,
            worker_type_id: workerType,
            worker_status_id: EWorkerStatus.online,
            ...(this.isPendingWarmRecreateLifecycle(data, worker) &&
            data.lifecycle_operation_id
              ? {
                  recreate_completion: {
                    operation_id: data.lifecycle_operation_id,
                    runtime_generation: runtimeGeneration,
                    mode: this.replacementRuntimeCompletionMode(
                      worker.container_id,
                      containerId
                    ),
                  },
                }
              : {}),
          }
        );
      leaseContext.assertActive();
      if (finalizedOnline) return EWorkerStatus.online;
      const reconciledOnline =
        await this.workerService.viewWorkerForMonitorConsistent(data.worker_id);
      leaseContext.assertActive();
      if (
        reconciledOnline?.account_id === data.account_id &&
        reconciledOnline.server_id === data.server_id &&
        reconciledOnline.worker_type_id === workerType &&
        reconciledOnline.container_id === containerId &&
        reconciledOnline.worker_status_id === EWorkerStatus.online &&
        reconciledOnline.lifecycle_operation_id === null &&
        (!data.lifecycle_operation_id ||
          !data.previous_worker_type_id ||
          this.hasExactRecreateCompletion(
            data,
            reconciledOnline,
            workerType,
            runtimeGeneration
          ))
      ) {
        return EWorkerStatus.online;
      }
      throw new Error('warm_worker_assigned_redelivery_finalize_cas_failed');
    }
    if (
      (worker.worker_status_id !== EWorkerStatus.creating &&
        worker.worker_status_id !== EWorkerStatus.recreating) ||
      worker.lifecycle_operation_id !== (data.lifecycle_operation_id ?? null)
    ) {
      throw new Error('warm_worker_assigned_redelivery_worker_mismatch');
    }
    const shouldClearSessionMetadata =
      data.remove_session === true ||
      data.remove_volume === true ||
      Boolean(
        data.previous_worker_type_id &&
        data.previous_worker_type_id !== workerType
      );
    const update: IUpdateWorker = {
      worker_id: data.worker_id,
      container_id: containerId,
      worker_status_id: EWorkerStatus.disponible,
      ...(data.lifecycle_operation_id ? { lifecycle_operation_id: null } : {}),
      ...(shouldClearSessionMetadata
        ? { number: null, connection_date: null }
        : {}),
    };
    const updated = await this.workerService.updateWorkerByIdIfLifecycleMatches(
      data.account_id,
      update,
      {
        lifecycle_operation_id: data.lifecycle_operation_id ?? null,
        container_id: worker.container_id,
        runtime_container_id: containerId,
        runtime_generation: runtimeGeneration,
        server_id: data.server_id,
        worker_type_id: workerType,
        worker_status_id: worker.worker_status_id,
        ...(this.isPendingWarmRecreateLifecycle(data, worker) &&
        data.lifecycle_operation_id
          ? {
              recreate_completion: {
                operation_id: data.lifecycle_operation_id,
                runtime_generation: runtimeGeneration,
                mode: this.replacementRuntimeCompletionMode(
                  worker.container_id,
                  containerId
                ),
              },
            }
          : {}),
      }
    );
    leaseContext.assertActive();
    if (updated) return EWorkerStatus.disponible;
    let reconciled = await this.workerService.viewWorkerForMonitorConsistent(
      data.worker_id
    );
    leaseContext.assertActive();
    if (
      reconciled?.account_id === data.account_id &&
      reconciled.server_id === data.server_id &&
      reconciled.worker_type_id === workerType &&
      reconciled.worker_status_id === EWorkerStatus.online &&
      reconciled.lifecycle_operation_id ===
        (data.lifecycle_operation_id ?? null)
    ) {
      const finalizedOnline =
        await this.workerService.updateWorkerByIdIfLifecycleMatches(
          data.account_id,
          {
            worker_id: data.worker_id,
            container_id: containerId,
            lifecycle_operation_id: null,
          },
          {
            lifecycle_operation_id: data.lifecycle_operation_id ?? null,
            container_id: reconciled.container_id,
            runtime_container_id: containerId,
            runtime_generation: runtimeGeneration,
            server_id: data.server_id,
            worker_type_id: workerType,
            worker_status_id: EWorkerStatus.online,
            ...(this.isPendingWarmRecreateLifecycle(data, reconciled) &&
            data.lifecycle_operation_id
              ? {
                  recreate_completion: {
                    operation_id: data.lifecycle_operation_id,
                    runtime_generation: runtimeGeneration,
                    mode: this.replacementRuntimeCompletionMode(
                      reconciled.container_id,
                      containerId
                    ),
                  },
                }
              : {}),
          }
        );
      leaseContext.assertActive();
      if (finalizedOnline) return EWorkerStatus.online;
      reconciled = await this.workerService.viewWorkerForMonitorConsistent(
        data.worker_id
      );
      leaseContext.assertActive();
    }
    if (
      reconciled?.account_id !== data.account_id ||
      reconciled.server_id !== data.server_id ||
      reconciled.worker_type_id !== workerType ||
      reconciled.container_id !== containerId ||
      (reconciled.worker_status_id !== EWorkerStatus.disponible &&
        reconciled.worker_status_id !== EWorkerStatus.online) ||
      reconciled.lifecycle_operation_id !== null ||
      (data.lifecycle_operation_id &&
        data.previous_worker_type_id &&
        !this.hasExactRecreateCompletion(
          data,
          reconciled,
          workerType,
          runtimeGeneration
        ))
    ) {
      throw new Error('warm_worker_assigned_redelivery_finalize_cas_failed');
    }
    return reconciled.worker_status_id as
      EWorkerStatus.disponible | EWorkerStatus.online;
  }

  private combineLockLeaseContexts(
    first: ILockLeaseContext,
    second: ILockLeaseContext
  ): ILockLeaseContext {
    return {
      signal: AbortSignal.any([first.signal, second.signal]),
      assertActive: () => {
        first.assertActive();
        second.assertActive();
      },
    };
  }

  private async activateWarmWorkerRuntime(
    data: ValidatedActivateWarmWorkerRequest,
    warm: IWorkerWarmPool,
    workerType: EWorkerType,
    sourceInspection: WorkerContainerInspection,
    sourceContainerName: string,
    sessionVolumeName: string,
    resolvedProxy: ResolvedWorkerProxyConfig | undefined,
    expectedWorkerStatusId: EWorkerStatus.creating | EWorkerStatus.recreating,
    controlContainerId: string | null,
    leaseContext: ILockLeaseContext
  ): Promise<IWarmWorkerCommandResponseProto> {
    let activationImageContentId: string | undefined;
    if (warm.state === EWorkerWarmPoolState.reserved && warm.container_id) {
      const imageFence = await this.inspectWarmActivationContentImageFence({
        sourceContainerName,
        expectedContainerId: warm.container_id,
        workerType,
        initialInspection: sourceInspection,
        leaseContext,
      });
      if (imageFence.status === 'unstable') {
        const released =
          await this.workerWarmPoolRepository.releaseReservedAfterHealthFence({
            warmPoolId: data.warm_pool_id,
            reservedByWorkerId: data.worker_id,
            expectedContainerId: warm.container_id,
          });
        leaseContext.assertActive();
        if (!released) {
          throw new Error('warm_worker_activation_image_fence_release_failed');
        }
        return this.confirmedWarmActivationCleanupResponse(data);
      }
      if (imageFence.status === 'mismatch') {
        return this.cleanupRejectedWarmActivation({
          data,
          warm,
          workerType,
          sourceInspection: imageFence.inspection,
          reason: 'content_image_mismatch',
          leaseContext,
        });
      }
      activationImageContentId = imageFence.expectedImageId;
    }
    activationImageContentId ??= await this.resolveStableWorkerImageContentId(
      workerType,
      leaseContext
    );

    let nextRuntimeGeneration: number | undefined;
    let activationFinalized = false;
    let activatedContainerId: string | undefined;

    try {
      await this.beginOrResumeWarmActivation(data, warm, leaseContext);
      await this.removeExistingRuntimeBeforeWarmActivation(
        data,
        workerType,
        sourceContainerName,
        warm.state === EWorkerWarmPoolState.activating,
        leaseContext
      );
      leaseContext.assertActive();
      nextRuntimeGeneration = await this.resolveWarmActivationRuntimeGeneration(
        data,
        warm,
        workerType,
        sessionVolumeName
      );
      leaseContext.assertActive();

      activatedContainerId =
        await this.ensureRestartSafeWarmActivationContainer({
          data,
          warm,
          workerType,
          sourceContainerName,
          sessionVolumeName,
          runtimeGeneration: nextRuntimeGeneration,
          imageContentId: activationImageContentId,
          proxy: resolvedProxy,
          leaseContext,
        });
      leaseContext.assertActive();

      await this.workerRuntimeRepository?.upsert({
        worker_id: data.worker_id,
        container_id: activatedContainerId,
        container_name: data.worker_id,
        session_volume_name: sessionVolumeName,
        runtime_generation: nextRuntimeGeneration,
        warm_pool_id: data.warm_pool_id,
      });
      leaseContext.assertActive();

      if (expectedWorkerStatusId === EWorkerStatus.recreating) {
        await this.markAndPublishRecreateRuntimeStarted({
          data,
          workerType,
          containerId: activatedContainerId,
          runtimeGeneration: nextRuntimeGeneration,
          leaseContext,
        });
      }

      await this.assertActivatedWarmContainerReady({
        data,
        workerType,
        containerId: activatedContainerId,
        runtimeGeneration: nextRuntimeGeneration,
        leaseContext,
      });
      await this.waitForActivatedWarmRuntimeHealth({
        data,
        workerType,
        runtimeGeneration: nextRuntimeGeneration,
        leaseContext,
      });
      leaseContext.assertActive();
      const targetAfterHealth =
        await this.workerService.inspectContainerWorkerByIdStrict(
          activatedContainerId
        );
      leaseContext.assertActive();
      /*
       * The source runtime has already been removed at this point. The
       * content-addressed image selected by the activation fence remains the
       * authoritative target even if the mutable alias advances meanwhile.
       * Finishing this healthy target preserves availability; the bounded
       * image-drift rollout can migrate it to the newer content afterwards.
       */
      this.assertActivatedContainerContentImage({
        data,
        containerId: activatedContainerId,
        inspection: targetAfterHealth,
        workerType,
        expectedImageId: activationImageContentId,
      });

      let runtime;
      try {
        runtime = await this.workerRuntimeRepository?.upsert({
          worker_id: data.worker_id,
          container_id: activatedContainerId,
          container_name: data.worker_id,
          session_volume_name: sessionVolumeName,
          runtime_generation: nextRuntimeGeneration,
          warm_pool_id: data.warm_pool_id,
          activated_at: currentTime(),
        });
        leaseContext.assertActive();
      } catch (error) {
        if (error instanceof StaleWorkerRuntimeGenerationError) {
          await this.workerService
            .removeContainerWorkerById(activatedContainerId)
            .catch(() => false);
        }
        throw error;
      }

      const assigned = await this.workerWarmPoolRepository.markAssigned({
        warmPoolId: data.warm_pool_id,
        reservedByWorkerId: data.worker_id,
        expectedContainerId: warm.container_id as string,
        assignedContainerId: activatedContainerId,
        assignedContainerName: data.worker_id,
      });
      leaseContext.assertActive();
      if (!assigned) {
        throw new Error('warm_worker_assignment_persistence_failed');
      }
      await this.cleanupAssignedWarmPoolReferences(data.worker_id, {
        currentWarmPoolId: data.warm_pool_id,
      });
      leaseContext.assertActive();
      const shouldClearSessionMetadata =
        data.remove_session === true ||
        data.remove_volume === true ||
        Boolean(
          data.previous_worker_type_id &&
          data.previous_worker_type_id !== workerType
        );
      const workerUpdate: IUpdateWorker = {
        worker_id: data.worker_id,
        container_id: activatedContainerId,
        worker_status_id: EWorkerStatus.disponible,
        ...(data.lifecycle_operation_id
          ? { lifecycle_operation_id: null }
          : {}),
        ...(shouldClearSessionMetadata
          ? { number: null, connection_date: null }
          : {}),
      };

      const lifecycleData: IWorkerPayload = {
        action:
          expectedWorkerStatusId === EWorkerStatus.recreating
            ? EWorkerAction.recreate
            : EWorkerAction.create,
        worker_id: data.worker_id,
        account_id: data.account_id,
        server_id: data.server_id,
        worker_type_id: workerType,
        lifecycle_operation_id: data.lifecycle_operation_id,
        debug_trace_id: data.debug_trace_id,
      };
      const updated =
        await this.workerService.updateWorkerByIdIfLifecycleMatches(
          data.account_id,
          workerUpdate,
          {
            lifecycle_operation_id: data.lifecycle_operation_id ?? null,
            ...(expectedWorkerStatusId === EWorkerStatus.recreating
              ? { container_id: controlContainerId }
              : {}),
            runtime_container_id: activatedContainerId,
            runtime_generation: nextRuntimeGeneration,
            server_id: data.server_id,
            worker_type_id: workerType,
            worker_status_id: expectedWorkerStatusId,
            ...(expectedWorkerStatusId === EWorkerStatus.recreating &&
            data.lifecycle_operation_id
              ? {
                  recreate_completion: {
                    operation_id: data.lifecycle_operation_id,
                    runtime_generation: nextRuntimeGeneration,
                    mode: this.replacementRuntimeCompletionMode(
                      controlContainerId,
                      activatedContainerId
                    ),
                  },
                }
              : {}),
          }
        );
      leaseContext.assertActive();
      const finalizedAsOnline = updated
        ? false
        : await this.finalizeAlreadyOnlineWorkerLifecycle(
            data.account_id,
            lifecycleData,
            workerType,
            activatedContainerId,
            nextRuntimeGeneration
          );

      if (!updated && !finalizedAsOnline) {
        const cleaned = await this.cleanupFailedActivatedWarmRuntime({
          data,
          workerType,
          containerId: activatedContainerId,
          sessionVolumeName,
          runtimeGeneration: nextRuntimeGeneration,
          expectedWorkerStatusId,
          expectedWarmState: EWorkerWarmPoolState.assigned,
          expectedWarmContainerId: activatedContainerId,
          error: 'warm_activation_lifecycle_changed',
          leaseContext,
        });
        leaseContext.assertActive();
        if (!cleaned) {
          throw new Error(
            'Warm activation lifecycle changed before finalization'
          );
        }
        return this.confirmedWarmActivationCleanupResponse(data);
      }

      activationFinalized = true;

      if (expectedWorkerStatusId === EWorkerStatus.recreating) {
        await this.publishManagerWorkerRecreateTerminal({
          data,
          workerType,
          runtimeGeneration: nextRuntimeGeneration,
          workerStatusId: finalizedAsOnline
            ? EWorkerStatus.online
            : EWorkerStatus.disponible,
        });
      } else if (!finalizedAsOnline) {
        await this.publishWarmActivationDisponible(
          data,
          workerType,
          activatedContainerId,
          runtime?.runtime_generation
        );
      }

      return {
        warm_pool_id: data.warm_pool_id,
        worker_id: data.worker_id,
        container_id: activatedContainerId,
        container_name: data.worker_id,
        session_volume_name: sessionVolumeName,
        claimed: true,
      };
    } catch (error) {
      return this.resolveFailedWarmActivation({
        data,
        warm,
        workerType,
        sessionVolumeName,
        runtimeGeneration: nextRuntimeGeneration,
        activatedContainerId,
        activationFinalized,
        expectedWorkerStatusId,
        error,
        leaseContext,
      });
    }
  }

  private async resolveFailedWarmActivation(input: {
    data: ValidatedActivateWarmWorkerRequest;
    warm: IWorkerWarmPool;
    workerType: EWorkerType;
    sessionVolumeName: string;
    runtimeGeneration?: number;
    activatedContainerId?: string;
    activationFinalized: boolean;
    expectedWorkerStatusId: EWorkerStatus.creating | EWorkerStatus.recreating;
    error: unknown;
    leaseContext: ILockLeaseContext;
  }): Promise<IWarmWorkerCommandResponseProto> {
    input.leaseContext.assertActive();
    if (input.activationFinalized) {
      throw input.error;
    }
    if (input.runtimeGeneration === undefined) {
      return this.resolvePreGenerationWarmActivationFailure(input);
    }
    const containerId =
      input.activatedContainerId ??
      (await this.findOwnedActivatedWarmContainerId({
        data: input.data,
        workerType: input.workerType,
        runtimeGeneration: input.runtimeGeneration,
      }));
    input.leaseContext.assertActive();
    if (!containerId) throw input.error;

    const resolution = await this.resolveAmbiguousWarmActivationFinalization({
      data: input.data,
      workerType: input.workerType,
      containerId,
      expectedSourceContainerId: input.warm.container_id as string,
      sessionVolumeName: input.sessionVolumeName,
      runtimeGeneration: input.runtimeGeneration,
    });
    input.leaseContext.assertActive();
    if (resolution === 'finalized') {
      await this.publishWarmActivationDisponible(
        input.data,
        input.workerType,
        containerId,
        input.runtimeGeneration
      );
      return {
        warm_pool_id: input.data.warm_pool_id,
        worker_id: input.data.worker_id,
        container_id: containerId,
        container_name: input.data.worker_id,
        session_volume_name: input.sessionVolumeName,
        claimed: true,
      };
    }
    if (resolution === 'assigned') {
      return this.resumeAssignedWarmActivationAfterAmbiguousFailure(input);
    }
    if (resolution === 'unknown') throw input.error;

    const anchored = await this.anchorWarmRuntimeForCompensation({
      data: input.data,
      containerId,
      sessionVolumeName: input.sessionVolumeName,
      runtimeGeneration: input.runtimeGeneration,
    });
    input.leaseContext.assertActive();
    if (!anchored) throw input.error;
    const cleaned = await this.cleanupFailedActivatedWarmRuntime({
      data: input.data,
      workerType: input.workerType,
      containerId,
      sessionVolumeName: input.sessionVolumeName,
      runtimeGeneration: input.runtimeGeneration,
      expectedWorkerStatusId: input.expectedWorkerStatusId,
      expectedWarmState: EWorkerWarmPoolState.activating,
      expectedWarmContainerId: input.warm.container_id as string,
      error: getErrorMessage(input.error),
      leaseContext: input.leaseContext,
    });
    input.leaseContext.assertActive();
    if (!cleaned) throw input.error;
    return this.confirmedWarmActivationCleanupResponse(input.data);
  }

  private async resolvePreGenerationWarmActivationFailure(input: {
    data: ValidatedActivateWarmWorkerRequest;
    workerType: EWorkerType;
    error: unknown;
    leaseContext: ILockLeaseContext;
  }): Promise<IWarmWorkerCommandResponseProto> {
    input.leaseContext.assertActive();
    const warm = await this.workerWarmPoolRepository.viewByIdConsistent(
      input.data.warm_pool_id
    );
    input.leaseContext.assertActive();
    const expectedName = `warm-${input.data.warm_pool_id}`;
    if (
      !warm ||
      warm.server_id !== input.data.server_id ||
      warm.worker_type_id !== input.workerType ||
      warm.state !== EWorkerWarmPoolState.activating ||
      warm.reserved_by_worker_id !== input.data.worker_id ||
      !warm.container_id ||
      warm.container_name !== expectedName ||
      warm.session_volume_name !== expectedName
    ) {
      throw input.error;
    }
    if (!this.workerRuntimeRepository) {
      throw input.error;
    }

    const runtime = await this.workerRuntimeRepository.viewByWorkerIdConsistent(
      input.data.worker_id
    );
    input.leaseContext.assertActive();
    if (
      runtime?.warm_pool_id === input.data.warm_pool_id ||
      runtime?.container_id === warm.container_id ||
      runtime?.session_volume_name === expectedName
    ) {
      throw input.error;
    }

    const [source, target, volumeExists, volumeReferenced] = await Promise.all([
      this.workerService.inspectContainerWorkerByIdStrict(warm.container_id),
      this.workerService.inspectContainerWorkerByIdStrict(input.data.worker_id),
      this.workerService.existsVolumeByNameStrict(expectedName),
      this.workerRuntimeRepository.isSessionVolumeReferencedConsistent(
        expectedName
      ),
    ]);
    input.leaseContext.assertActive();
    const sourceRejection = this.resolveOwnedWarmContainerIdentityRejection(
      input.data,
      input.workerType,
      source,
      warm.container_id
    );
    const targetHasActivationLineage =
      target.exists &&
      this.isWarmContainerOwnedByRequest(target, input.data.warm_pool_id);
    if (
      sourceRejection ||
      source.running !== true ||
      !volumeExists ||
      volumeReferenced !== false ||
      targetHasActivationLineage
    ) {
      throw input.error;
    }

    const restored =
      await this.workerWarmPoolRepository.restorePreGenerationActivationToReady(
        {
          warmPoolId: input.data.warm_pool_id,
          serverId: input.data.server_id,
          workerTypeId: input.workerType,
          reservedByWorkerId: input.data.worker_id,
          expectedSourceContainerId: warm.container_id,
          expectedSourceContainerName: expectedName,
          sessionVolumeName: expectedName,
        }
      );
    input.leaseContext.assertActive();
    if (!restored) {
      throw input.error;
    }

    this.logDebug('service.warm_activation.pre_generation_rolled_back', {
      trace_id: input.data.debug_trace_id,
      layer: 'service',
      worker_id: input.data.worker_id,
      account_id: input.data.account_id,
      worker_type_id: input.workerType,
      lifecycle_operation_id: input.data.lifecycle_operation_id,
      warm_pool_id: input.data.warm_pool_id,
      source_container_id: warm.container_id,
      reason: getErrorMessage(input.error),
    });
    return this.confirmedWarmActivationCleanupResponse(input.data);
  }

  private async resumeAssignedWarmActivationAfterAmbiguousFailure(input: {
    data: ValidatedActivateWarmWorkerRequest;
    workerType: EWorkerType;
    error: unknown;
    leaseContext: ILockLeaseContext;
  }): Promise<IWarmWorkerCommandResponseProto> {
    const assignedWarm = await this.workerWarmPoolRepository.viewByIdConsistent(
      input.data.warm_pool_id
    );
    input.leaseContext.assertActive();
    if (!assignedWarm || assignedWarm.state !== EWorkerWarmPoolState.assigned) {
      throw input.error;
    }
    return this.resolveCompletedWarmActivationRedelivery(
      input.data,
      assignedWarm,
      input.workerType,
      input.leaseContext
    );
  }

  private async beginOrResumeWarmActivation(
    data: ValidatedActivateWarmWorkerRequest,
    warm: IWorkerWarmPool,
    leaseContext: ILockLeaseContext
  ): Promise<void> {
    if (warm.state === EWorkerWarmPoolState.activating) {
      return;
    }
    if (!warm.container_id) {
      throw new Error('warm_worker_source_container_id_missing');
    }
    leaseContext.assertActive();
    const started = await this.workerWarmPoolRepository.beginActivation({
      warmPoolId: data.warm_pool_id,
      reservedByWorkerId: data.worker_id,
      expectedContainerId: warm.container_id,
    });
    leaseContext.assertActive();
    if (!started) {
      throw new Error('warm_worker_activation_cutover_cas_failed');
    }
  }

  private async resolveWarmActivationRuntimeGeneration(
    data: ValidatedActivateWarmWorkerRequest,
    warm: IWorkerWarmPool,
    workerType: EWorkerType,
    sessionVolumeName: string
  ): Promise<number> {
    if (warm.state === EWorkerWarmPoolState.activating) {
      const runtime =
        await this.workerRuntimeRepository?.viewByWorkerIdConsistent(
          data.worker_id
        );
      if (runtime?.warm_pool_id === data.warm_pool_id) {
        if (
          runtime.session_volume_name !== sessionVolumeName ||
          !Number.isSafeInteger(runtime.runtime_generation) ||
          runtime.runtime_generation <= 0
        ) {
          throw new Error('warm_worker_resume_runtime_identity_mismatch');
        }
        const target =
          await this.workerService.inspectContainerWorkerByIdStrict(
            data.worker_id
          );
        const targetIsCurrent =
          this.resolveOwnedActivatedWarmContainerIdentityRejection(
            data,
            workerType,
            runtime.runtime_generation,
            target,
            target.container_id,
            false
          ) === undefined;
        if (targetIsCurrent) {
          return runtime.runtime_generation;
        }
      }
    }

    return this.reserveNextWorkerRuntimeGeneration(
      {
        action: EWorkerAction.create,
        worker_id: data.worker_id,
        account_id: data.account_id,
        server_id: data.server_id,
        worker_type_id: workerType,
        session_storage: this.sessionStorageFor(data),
        lifecycle_operation_id: data.lifecycle_operation_id,
        debug_trace_id: data.debug_trace_id,
      },
      sessionVolumeName,
      undefined,
      data.warm_pool_id
    );
  }

  private async ensureRestartSafeWarmActivationContainer(input: {
    data: ValidatedActivateWarmWorkerRequest;
    warm: IWorkerWarmPool;
    workerType: EWorkerType;
    sourceContainerName: string;
    sessionVolumeName: string;
    runtimeGeneration: number;
    imageContentId: string;
    proxy: ResolvedWorkerProxyConfig | undefined;
    leaseContext: ILockLeaseContext;
  }): Promise<string> {
    const referencedByAnotherWorker =
      await this.workerRuntimeRepository?.isSessionVolumeReferencedByOtherWorkerConsistent(
        input.sessionVolumeName,
        input.data.worker_id
      );
    input.leaseContext.assertActive();
    if (referencedByAnotherWorker !== false) {
      throw new Error(
        'warm_worker_session_volume_referenced_by_another_worker'
      );
    }
    const existingTarget =
      await this.workerService.inspectContainerWorkerByIdStrict(
        input.data.worker_id
      );
    input.leaseContext.assertActive();
    if (existingTarget.exists) {
      const immutableRejection =
        this.resolveOwnedActivatedWarmContainerIdentityRejection(
          input.data,
          input.workerType,
          input.runtimeGeneration,
          existingTarget,
          undefined,
          false
        );
      if (immutableRejection) {
        throw new Error(
          `warm_worker_existing_target_identity_mismatch:${immutableRejection}`
        );
      }
      const conformanceRejection =
        this.resolveActivatedWarmContainerIdentityRejection(
          input.data,
          input.workerType,
          input.runtimeGeneration,
          existingTarget,
          undefined,
          input.proxy,
          true,
          false
        );
      if (conformanceRejection) {
        throw new Error(
          `warm_worker_existing_target_not_conformant:${conformanceRejection}`
        );
      }
      let readyTarget = existingTarget;
      if (existingTarget.running !== true) {
        const started = await this.workerService.startContainerWorkerById(
          existingTarget.container_id as string
        );
        input.leaseContext.assertActive();
        if (!started) {
          throw new Error('warm_worker_existing_target_start_failed');
        }
        readyTarget = await this.workerService.inspectContainerWorkerByIdStrict(
          input.data.worker_id
        );
        input.leaseContext.assertActive();
      }
      const readyRejection =
        this.resolveActivatedWarmContainerIdentityRejection(
          input.data,
          input.workerType,
          input.runtimeGeneration,
          readyTarget,
          existingTarget.container_id,
          input.proxy,
          true
        );
      if (readyRejection) {
        throw new Error(
          `warm_worker_existing_target_not_ready:${readyRejection}`
        );
      }
      this.assertActivatedContainerContentImage({
        data: input.data,
        containerId: readyTarget.container_id as string,
        inspection: readyTarget,
        workerType: input.workerType,
        expectedImageId: input.imageContentId,
      });
      await this.removeWarmActivationSourceIfPresent(input);
      return readyTarget.container_id as string;
    }

    await this.removeWarmActivationSourceIfPresent(input);
    input.leaseContext.assertActive();
    const runtimeIdentity = await this.preparePostgresRuntimeWriterIdentity(
      {
        action: EWorkerAction.create,
        worker_id: input.data.worker_id,
        account_id: input.data.account_id,
        server_id: input.data.server_id,
        worker_type_id: input.workerType,
        session_storage: EWorkerSessionStorage.legacy_volume,
        lifecycle_operation_id: input.data.lifecycle_operation_id,
        debug_trace_id: input.data.debug_trace_id,
      },
      input.runtimeGeneration
    );
    input.leaseContext.assertActive();
    const metadata = {
      workerTypeId: input.workerType,
      workerGrpcPort: this.getExpectedWorkerGrpcPort(input.workerType),
      runtimeGeneration: input.runtimeGeneration,
      ...(input.data.lifecycle_operation_id
        ? { lifecycleOperationId: input.data.lifecycle_operation_id }
        : {}),
      warmPoolId: input.data.warm_pool_id,
      serverId: input.data.server_id,
      proxyMode: input.proxy ? ('proxy' as const) : ('direct' as const),
      ...runtimeIdentity,
    };

    let createdContainerId: string;
    try {
      createdContainerId = await this.workerService.createContainerWorker(
        getImageWorker(input.workerType),
        input.data.worker_id,
        input.data.account_id,
        false,
        balanceEnvironment.grpcHost,
        balanceEnvironment.grpcPort,
        input.proxy,
        metadata,
        input.sessionVolumeName,
        {
          requireExistingVolume: true,
          requireContainerNameAvailable: true,
          imageContentId: input.imageContentId,
        }
      );
    } catch (createError) {
      const recovered = await this.findConformantActivatedWarmContainerId({
        data: input.data,
        workerType: input.workerType,
        runtimeGeneration: input.runtimeGeneration,
        proxy: input.proxy,
      });
      if (recovered) {
        return recovered;
      }
      throw createError;
    }
    input.leaseContext.assertActive();

    const created = await this.workerService.inspectContainerWorkerByIdStrict(
      input.data.worker_id
    );
    input.leaseContext.assertActive();
    const rejection = this.resolveActivatedWarmContainerIdentityRejection(
      input.data,
      input.workerType,
      input.runtimeGeneration,
      created,
      createdContainerId,
      input.proxy,
      true
    );
    if (rejection) {
      throw new Error(`warm_worker_created_identity_mismatch:${rejection}`);
    }
    this.assertActivatedContainerContentImage({
      data: input.data,
      containerId: createdContainerId,
      inspection: created,
      workerType: input.workerType,
      expectedImageId: input.imageContentId,
    });
    return createdContainerId;
  }

  private async removeWarmActivationSourceIfPresent(input: {
    data: ValidatedActivateWarmWorkerRequest;
    warm: IWorkerWarmPool;
    workerType: EWorkerType;
    sourceContainerName: string;
    sessionVolumeName: string;
    leaseContext: ILockLeaseContext;
  }): Promise<void> {
    input.leaseContext.assertActive();
    const volumeExists = await this.workerService.existsVolumeByNameStrict(
      input.sessionVolumeName
    );
    input.leaseContext.assertActive();
    if (!volumeExists) {
      throw new Error('warm_worker_source_volume_missing');
    }
    const source = await this.workerService.inspectContainerWorkerByIdStrict(
      input.sourceContainerName
    );
    input.leaseContext.assertActive();
    if (!source.exists) {
      return;
    }
    const rejection = this.resolveOwnedWarmContainerIdentityRejection(
      input.data,
      input.workerType,
      source,
      input.warm.container_id ?? undefined
    );
    if (rejection) {
      throw new Error(`warm_worker_source_identity_mismatch:${rejection}`);
    }
    const removed = await this.workerService.removeContainerWorkerById(
      source.container_id as string
    );
    input.leaseContext.assertActive();
    if (!removed) {
      throw new Error('warm_worker_source_container_removal_failed');
    }
  }

  private async assertActivatedWarmContainerReady(input: {
    data: ValidatedActivateWarmWorkerRequest;
    workerType: EWorkerType;
    containerId: string;
    runtimeGeneration: number;
    leaseContext: ILockLeaseContext;
  }): Promise<void> {
    const containerHealth =
      await this.containerHealthService.checkServiceHealth(
        input.containerId,
        this.buildNewContainerHealthOptions()
      );
    input.leaseContext.assertActive();
    this.assertWarmContainerHealth(containerHealth);
    if (this.isWorkerGrpcReadinessRequired(input.workerType)) {
      await this.workerBaileysGrpcClientService.waitForReady(
        input.data.worker_id,
        input.workerType,
        30_000
      );
      input.leaseContext.assertActive();
    }
  }

  private async findConformantActivatedWarmContainerId(input: {
    data: ValidatedActivateWarmWorkerRequest;
    workerType: EWorkerType;
    runtimeGeneration: number;
    proxy: ResolvedWorkerProxyConfig | undefined;
  }): Promise<string | undefined> {
    try {
      let inspection =
        await this.workerService.inspectContainerWorkerByIdStrict(
          input.data.worker_id
        );
      const immutableRejection =
        this.resolveActivatedWarmContainerIdentityRejection(
          input.data,
          input.workerType,
          input.runtimeGeneration,
          inspection,
          undefined,
          input.proxy,
          true,
          false
        );
      if (immutableRejection) return undefined;
      if (inspection.running !== true) {
        const started = await this.workerService.startContainerWorkerById(
          inspection.container_id as string
        );
        if (!started) return undefined;
        inspection = await this.workerService.inspectContainerWorkerByIdStrict(
          input.data.worker_id
        );
      }
      const rejection = this.resolveActivatedWarmContainerIdentityRejection(
        input.data,
        input.workerType,
        input.runtimeGeneration,
        inspection,
        undefined,
        input.proxy,
        true
      );
      return rejection ? undefined : inspection.container_id;
    } catch {
      return undefined;
    }
  }

  private async findOwnedActivatedWarmContainerId(input: {
    data: ValidatedActivateWarmWorkerRequest;
    workerType: EWorkerType;
    runtimeGeneration: number;
  }): Promise<string | undefined> {
    try {
      const inspection =
        await this.workerService.inspectContainerWorkerByIdStrict(
          input.data.worker_id
        );
      const rejection =
        this.resolveOwnedActivatedWarmContainerIdentityRejection(
          input.data,
          input.workerType,
          input.runtimeGeneration,
          inspection
        );
      return rejection ? undefined : inspection.container_id;
    } catch {
      return undefined;
    }
  }

  private async anchorWarmRuntimeForCompensation(input: {
    data: ValidatedActivateWarmWorkerRequest;
    containerId: string;
    sessionVolumeName: string;
    runtimeGeneration: number;
  }): Promise<boolean> {
    try {
      const runtime =
        await this.workerRuntimeRepository?.viewByWorkerIdConsistent(
          input.data.worker_id
        );
      if (
        runtime?.warm_pool_id !== input.data.warm_pool_id ||
        runtime.session_volume_name !== input.sessionVolumeName ||
        runtime.runtime_generation !== input.runtimeGeneration
      ) {
        return false;
      }
      if (runtime.container_id === input.containerId) {
        return true;
      }
      if (runtime.container_id) {
        return false;
      }
      await this.workerRuntimeRepository?.upsert({
        worker_id: input.data.worker_id,
        container_id: input.containerId,
        container_name: input.data.worker_id,
        session_volume_name: input.sessionVolumeName,
        runtime_generation: input.runtimeGeneration,
        warm_pool_id: input.data.warm_pool_id,
      });
      return true;
    } catch {
      return false;
    }
  }

  private async cleanupFailedActivatedWarmRuntime(input: {
    data: ValidatedActivateWarmWorkerRequest;
    workerType: EWorkerType;
    containerId: string;
    sessionVolumeName: string;
    runtimeGeneration: number;
    expectedWorkerStatusId?: EWorkerStatus.creating | EWorkerStatus.recreating;
    expectedWarmState:
      EWorkerWarmPoolState.activating | EWorkerWarmPoolState.assigned;
    expectedWarmContainerId: string;
    error: string;
    leaseContext: ILockLeaseContext;
    alreadyClaimed?: boolean;
  }): Promise<boolean> {
    try {
      input.leaseContext.assertActive();
      const pendingError = this.warmActivationPendingCleanupMarker(
        input.data.worker_id,
        input.runtimeGeneration,
        input.error
      );
      if (!input.alreadyClaimed) {
        if (!input.expectedWorkerStatusId) {
          return false;
        }
        const claimed =
          await this.workerWarmPoolRepository.claimFailedActivationCleanup({
            warmPoolId: input.data.warm_pool_id,
            reservedByWorkerId: input.data.worker_id,
            accountId: input.data.account_id,
            serverId: input.data.server_id,
            workerTypeId: input.workerType,
            lifecycleOperationId:
              input.data.lifecycle_operation_id?.trim() || null,
            expectedWorkerStatusId: input.expectedWorkerStatusId,
            expectedWarmState: input.expectedWarmState,
            expectedWarmContainerId: input.expectedWarmContainerId,
            runtimeGeneration: input.runtimeGeneration,
            runtimeContainerId: input.containerId,
            sessionVolumeName: input.sessionVolumeName,
            pendingError,
          });
        input.leaseContext.assertActive();
        if (!claimed) {
          return false;
        }
      }

      if (
        !(await this.isFailedWarmActivationCleanupClaimCurrent({
          ...input,
          pendingError,
        }))
      ) {
        return false;
      }

      const referencedByAnotherWorker =
        await this.workerRuntimeRepository?.isSessionVolumeReferencedByOtherWorkerConsistent(
          input.sessionVolumeName,
          input.data.worker_id
        );
      input.leaseContext.assertActive();
      if (referencedByAnotherWorker !== false) {
        return false;
      }

      const volume = await this.workerService.inspectVolumeByNameStrict(
        input.sessionVolumeName
      );
      input.leaseContext.assertActive();
      if (volume.exists && !volume.signature) {
        return false;
      }

      const inspection =
        await this.workerService.inspectContainerWorkerByIdStrict(
          input.containerId
        );
      input.leaseContext.assertActive();
      const identityRejection = inspection.exists
        ? this.resolveOwnedActivatedWarmContainerIdentityRejection(
            input.data,
            input.workerType,
            input.runtimeGeneration,
            inspection,
            input.containerId,
            false
          )
        : undefined;
      if (inspection.exists && identityRejection) {
        return false;
      }
      const mountedBefore =
        await this.workerService.listContainerIdsMountingVolumeStrict(
          input.sessionVolumeName
        );
      input.leaseContext.assertActive();
      const normalizedContainerId = input.containerId.toLowerCase();
      if (
        (inspection.exists &&
          (mountedBefore.length !== 1 ||
            mountedBefore[0] !== normalizedContainerId)) ||
        (!inspection.exists && mountedBefore.length !== 0)
      ) {
        return false;
      }

      if (
        !(await this.isFailedWarmActivationCleanupClaimCurrent({
          ...input,
          pendingError,
        }))
      ) {
        return false;
      }

      if (inspection.exists) {
        const removed = await this.workerService.removeContainerWorkerById(
          input.containerId
        );
        input.leaseContext.assertActive();
        if (!removed) return false;
      }

      const mountedAfter =
        await this.workerService.listContainerIdsMountingVolumeStrict(
          input.sessionVolumeName
        );
      input.leaseContext.assertActive();
      if (mountedAfter.length !== 0) {
        return false;
      }
      if (
        !(await this.isFailedWarmActivationCleanupClaimCurrent({
          ...input,
          pendingError,
        }))
      ) {
        return false;
      }

      const volumeRemoved =
        await this.workerService.removeFailedWarmActivationVolumeByProof(
          input.sessionVolumeName,
          volume.signature
        );
      input.leaseContext.assertActive();
      if (!volumeRemoved) {
        return false;
      }

      const runtimeTombstoned =
        await this.workerWarmPoolRepository.finalizeFailedActivationCleanup({
          warmPoolId: input.data.warm_pool_id,
          reservedByWorkerId: input.data.worker_id,
          accountId: input.data.account_id,
          serverId: input.data.server_id,
          workerTypeId: input.workerType,
          lifecycleOperationId:
            input.data.lifecycle_operation_id?.trim() || null,
          expectedWarmState: input.expectedWarmState,
          expectedWarmContainerId: input.expectedWarmContainerId,
          runtimeGeneration: input.runtimeGeneration,
          runtimeContainerId: input.containerId,
          sessionVolumeName: input.sessionVolumeName,
          tombstoneSessionVolumeName: this.warmActivationTombstoneVolumeName(
            input.data.warm_pool_id,
            input.runtimeGeneration
          ),
          pendingError,
          error: this.warmActivationCleanupMarker(
            input.data.worker_id,
            input.runtimeGeneration,
            input.error
          ),
        });
      input.leaseContext.assertActive();
      return runtimeTombstoned === true;
    } catch (cleanupError) {
      this.logDebug('service.warm_activation.failed_runtime_quarantined', {
        trace_id: input.data.debug_trace_id,
        layer: 'service',
        worker_id: input.data.worker_id,
        account_id: input.data.account_id,
        worker_type_id: input.data.worker_type_id,
        warm_pool_id: input.data.warm_pool_id,
        container_id: input.containerId,
        session_volume_name: input.sessionVolumeName,
        runtime_generation: input.runtimeGeneration,
        error: getErrorMessage(cleanupError),
      });
      return false;
    }
  }

  private async isFailedWarmActivationCleanupClaimCurrent(input: {
    data: ValidatedActivateWarmWorkerRequest;
    workerType: EWorkerType;
    containerId: string;
    sessionVolumeName: string;
    runtimeGeneration: number;
    expectedWarmState:
      EWorkerWarmPoolState.activating | EWorkerWarmPoolState.assigned;
    expectedWarmContainerId: string;
    pendingError: string;
    leaseContext: ILockLeaseContext;
  }): Promise<boolean> {
    const [worker, runtime, warm] = await Promise.all([
      this.workerService.viewWorkerForMonitorConsistent(input.data.worker_id),
      this.workerRuntimeRepository?.viewByWorkerIdConsistent(
        input.data.worker_id
      ),
      this.workerWarmPoolRepository.viewByIdConsistent(input.data.warm_pool_id),
    ]);
    input.leaseContext.assertActive();

    return Boolean(
      worker &&
      !worker.deleted_at &&
      worker.account_id === input.data.account_id &&
      worker.server_id === input.data.server_id &&
      worker.worker_type_id === input.workerType &&
      worker.worker_status_id === EWorkerStatus.error &&
      worker.lifecycle_operation_id ===
        (input.data.lifecycle_operation_id?.trim() || null) &&
      runtime &&
      runtime.worker_id === input.data.worker_id &&
      runtime.warm_pool_id === input.data.warm_pool_id &&
      runtime.container_id === input.containerId &&
      runtime.container_name === input.data.worker_id &&
      runtime.session_volume_name === input.sessionVolumeName &&
      runtime.runtime_generation === input.runtimeGeneration &&
      warm &&
      warm.server_id === input.data.server_id &&
      warm.worker_type_id === input.workerType &&
      warm.state === input.expectedWarmState &&
      warm.reserved_by_worker_id === input.data.worker_id &&
      warm.container_id === input.expectedWarmContainerId &&
      warm.session_volume_name === input.sessionVolumeName &&
      warm.last_error === input.pendingError
    );
  }

  private confirmedWarmActivationCleanupResponse(
    data: ValidatedActivateWarmWorkerRequest
  ): IWarmWorkerCommandResponseProto {
    return {
      warm_pool_id: data.warm_pool_id,
      worker_id: data.worker_id,
      claimed: false,
      fallback_created: false,
      error: WARM_ACTIVATION_CONFIRMED_CLEANUP,
    };
  }

  private isConfirmedWarmActivationCleanupForWorker(
    warm: IWorkerWarmPool,
    workerId: string
  ): boolean {
    return Boolean(
      warm.last_error?.startsWith(
        `${WARM_ACTIVATION_CLEANUP_MARKER}:${workerId}:`
      ) ||
      warm.last_error?.startsWith(
        `${WARM_ACTIVATION_PREFLIGHT_CLEANUP_MARKER}:${workerId}:`
      )
    );
  }

  private isPendingWarmActivationPreflightCleanupForWorker(
    warm: IWorkerWarmPool,
    workerId: string
  ): boolean {
    return Boolean(
      warm.last_error?.startsWith(
        `${WARM_ACTIVATION_PREFLIGHT_PENDING_MARKER}:${workerId}:`
      )
    );
  }

  private parsePendingFailedWarmActivationCleanup(
    warm: IWorkerWarmPool,
    workerId: string
  ): { runtimeGeneration: number; error: string } | null {
    const prefix = `${WARM_ACTIVATION_CLEANUP_PENDING_MARKER}:${workerId}:`;
    if (!warm.last_error?.startsWith(prefix)) {
      return null;
    }

    const remainder = warm.last_error.slice(prefix.length);
    const separator = remainder.indexOf(':');
    if (separator <= 0) {
      return null;
    }
    const runtimeGeneration = Number(remainder.slice(0, separator));
    const error = remainder.slice(separator + 1);
    if (
      !Number.isSafeInteger(runtimeGeneration) ||
      runtimeGeneration <= 0 ||
      !error
    ) {
      return null;
    }
    return { runtimeGeneration, error };
  }

  private isPendingFailedWarmActivationCleanupForWorker(
    warm: IWorkerWarmPool,
    workerId: string
  ): boolean {
    return Boolean(
      this.parsePendingFailedWarmActivationCleanup(warm, workerId)
    );
  }

  private async resumePendingFailedWarmActivationCleanup(
    data: ValidatedActivateWarmWorkerRequest,
    warm: IWorkerWarmPool,
    workerType: EWorkerType,
    leaseContext: ILockLeaseContext
  ): Promise<IWarmWorkerCommandResponseProto> {
    this.assertLegacyWarmSession(warm);
    const pending = this.parsePendingFailedWarmActivationCleanup(
      warm,
      data.worker_id
    );
    const runtime =
      await this.workerRuntimeRepository?.viewByWorkerIdConsistent(
        data.worker_id
      );
    leaseContext.assertActive();
    if (
      !pending ||
      !warm.container_id ||
      !runtime ||
      runtime.worker_id !== data.worker_id ||
      runtime.warm_pool_id !== data.warm_pool_id ||
      !runtime.container_id ||
      runtime.container_name !== data.worker_id ||
      runtime.session_volume_name !== warm.session_volume_name ||
      runtime.runtime_generation !== pending.runtimeGeneration
    ) {
      throw new Error('warm_activation_cleanup_pending_identity_mismatch');
    }
    this.assertLegacyRuntimeSession(runtime);

    const cleaned = await this.cleanupFailedActivatedWarmRuntime({
      data,
      workerType,
      containerId: runtime.container_id,
      sessionVolumeName: runtime.session_volume_name,
      runtimeGeneration: runtime.runtime_generation,
      expectedWarmState: warm.state as
        EWorkerWarmPoolState.activating | EWorkerWarmPoolState.assigned,
      expectedWarmContainerId: warm.container_id,
      error: pending.error,
      leaseContext,
      alreadyClaimed: true,
    });
    leaseContext.assertActive();
    if (!cleaned) {
      throw new Error('warm_activation_cleanup_pending_redrive_failed');
    }
    return this.confirmedWarmActivationCleanupResponse(data);
  }

  private async resolveWarmActivationPoolMiss(
    data: ValidatedActivateWarmWorkerRequest,
    warm: IWorkerWarmPool | undefined,
    leaseContext: ILockLeaseContext
  ): Promise<IWarmWorkerCommandResponseProto> {
    const [runtime, worker, target] = await Promise.all([
      this.workerRuntimeRepository?.viewByWorkerIdConsistent(data.worker_id),
      this.workerService.viewWorkerForMonitorConsistent(data.worker_id),
      this.workerService.inspectContainerWorkerByIdStrict(data.worker_id),
    ]);
    leaseContext.assertActive();
    const expectedVolume = `warm-${data.warm_pool_id}`;
    const lifecycleCurrent = Boolean(
      worker?.account_id === data.account_id &&
      worker.server_id === data.server_id &&
      worker.worker_type_id === data.worker_type_id &&
      (worker.worker_status_id === EWorkerStatus.creating ||
        worker.worker_status_id === EWorkerStatus.recreating) &&
      worker.lifecycle_operation_id === (data.lifecycle_operation_id ?? null)
    );
    if (!lifecycleCurrent) {
      throw new Error('warm_worker_pool_miss_lifecycle_changed');
    }
    if (
      runtime?.warm_pool_id === data.warm_pool_id ||
      runtime?.session_volume_name === expectedVolume ||
      (target.exists &&
        this.isWarmContainerOwnedByRequest(target, data.warm_pool_id))
    ) {
      throw new Error('warm_worker_pool_miss_has_activation_lineage');
    }
    if (!warm && runtime) {
      const tombstonePrefix = `retired-warm-${data.warm_pool_id}-`;
      if (runtime.session_volume_name?.startsWith(tombstonePrefix)) {
        const volumeExists =
          await this.workerService.existsVolumeByNameStrict(expectedVolume);
        leaseContext.assertActive();
        if (
          runtime.container_id !== null ||
          target.exists ||
          volumeExists ||
          !lifecycleCurrent
        ) {
          throw new Error('warm_worker_deleted_cleanup_proof_mismatch');
        }
      }
    }
    return this.confirmedWarmActivationCleanupResponse(data);
  }

  private async cleanupRejectedWarmActivation(input: {
    data: ValidatedActivateWarmWorkerRequest;
    warm: IWorkerWarmPool;
    workerType: EWorkerType;
    sourceInspection?: WorkerContainerInspection;
    reason: string;
    leaseContext: ILockLeaseContext;
  }): Promise<IWarmWorkerCommandResponseProto> {
    this.assertLegacyWarmSession(input.warm);
    const expectedName = `warm-${input.data.warm_pool_id}`;
    if (
      input.warm.server_id !== input.data.server_id ||
      input.warm.worker_type_id !== input.workerType ||
      input.warm.reserved_by_worker_id !== input.data.worker_id ||
      !input.warm.container_id ||
      input.warm.container_name !== expectedName ||
      input.warm.session_volume_name !== expectedName ||
      (input.warm.state !== EWorkerWarmPoolState.reserved &&
        (input.warm.state !== EWorkerWarmPoolState.error ||
          !this.isPendingWarmActivationPreflightCleanupForWorker(
            input.warm,
            input.data.worker_id
          )))
    ) {
      throw new Error(`warm_worker_preflight_cleanup_identity_mismatch`);
    }
    const [runtime, target] = await Promise.all([
      this.workerRuntimeRepository?.viewByWorkerIdConsistent(
        input.data.worker_id
      ),
      this.workerService.inspectContainerWorkerByIdStrict(input.data.worker_id),
    ]);
    input.leaseContext.assertActive();
    if (
      runtime?.warm_pool_id === input.data.warm_pool_id ||
      runtime?.session_volume_name === expectedName ||
      (target.exists &&
        this.isWarmContainerOwnedByRequest(target, input.data.warm_pool_id))
    ) {
      throw new Error('warm_worker_preflight_cleanup_activation_lineage');
    }
    const volumeReferenced =
      await this.workerRuntimeRepository?.isSessionVolumeReferencedConsistent(
        expectedName
      );
    input.leaseContext.assertActive();
    if (volumeReferenced !== false) {
      throw new Error('warm_worker_preflight_cleanup_volume_referenced');
    }
    const source =
      input.sourceInspection ??
      (await this.workerService.inspectContainerWorkerByIdStrict(
        input.warm.container_id
      ));
    input.leaseContext.assertActive();
    if (source.exists) {
      const sourceRejection = this.resolveOwnedWarmContainerIdentityRejection(
        input.data,
        input.workerType,
        source,
        input.warm.container_id
      );
      if (sourceRejection) {
        throw new Error(
          `warm_worker_preflight_cleanup_source_conflict:${sourceRejection}`
        );
      }
    }
    if (input.warm.state === EWorkerWarmPoolState.reserved) {
      const claimed = await this.workerWarmPoolRepository.rejectActivation({
        warmPoolId: input.data.warm_pool_id,
        reservedByWorkerId: input.data.worker_id,
        error: `${WARM_ACTIVATION_PREFLIGHT_PENDING_MARKER}:${input.data.worker_id}:${input.reason}`,
      });
      input.leaseContext.assertActive();
      if (!claimed) {
        throw new Error('warm_worker_preflight_cleanup_claim_failed');
      }
    }
    if (source.exists) {
      const removed = await this.workerService.removeContainerWorkerById(
        source.container_id as string
      );
      input.leaseContext.assertActive();
      if (!removed) {
        throw new Error('warm_worker_preflight_cleanup_container_failed');
      }
    }
    const volumeRemoved =
      await this.workerService.removeVolumeByName(expectedName);
    input.leaseContext.assertActive();
    if (!volumeRemoved) {
      throw new Error('warm_worker_preflight_cleanup_volume_failed');
    }
    const finalized =
      await this.workerWarmPoolRepository.finalizeRejectedActivationCleanup({
        warmPoolId: input.data.warm_pool_id,
        reservedByWorkerId: input.data.worker_id,
        expectedContainerId: input.warm.container_id,
        sessionVolumeName: expectedName,
        error: `${WARM_ACTIVATION_PREFLIGHT_CLEANUP_MARKER}:${input.data.worker_id}:${input.reason}`,
      });
    input.leaseContext.assertActive();
    if (!finalized) {
      throw new Error('warm_worker_preflight_cleanup_finalize_failed');
    }
    return this.confirmedWarmActivationCleanupResponse(input.data);
  }

  private warmActivationTombstoneVolumeName(
    warmPoolId: string,
    runtimeGeneration: number
  ): string {
    return `retired-warm-${warmPoolId}-${runtimeGeneration}`;
  }

  private warmActivationCleanupMarker(
    workerId: string,
    runtimeGeneration: number,
    error: string
  ): string {
    return `${WARM_ACTIVATION_CLEANUP_MARKER}:${workerId}:${runtimeGeneration}:${error}`;
  }

  private warmActivationPendingCleanupMarker(
    workerId: string,
    runtimeGeneration: number,
    error: string
  ): string {
    return `${WARM_ACTIVATION_CLEANUP_PENDING_MARKER}:${workerId}:${runtimeGeneration}:${error}`;
  }

  private async finalizePhysicallyMissingWarmActivation(input: {
    data: ValidatedActivateWarmWorkerRequest;
    warm: IWorkerWarmPool;
    runtime: IWorkerRuntime;
    expectedWarmState:
      EWorkerWarmPoolState.activating | EWorkerWarmPoolState.assigned;
    expectedWarmContainerId: string;
    error: string;
    leaseContext: ILockLeaseContext;
  }): Promise<boolean> {
    this.assertLegacyWarmSession(input.warm);
    this.assertLegacyRuntimeSession(input.runtime);
    if (
      input.runtime.warm_pool_id !== input.data.warm_pool_id ||
      !input.runtime.container_id ||
      input.runtime.container_name !== input.data.worker_id ||
      input.runtime.session_volume_name !== input.warm.session_volume_name ||
      !Number.isSafeInteger(input.runtime.runtime_generation) ||
      input.runtime.runtime_generation <= 0
    ) {
      return false;
    }
    const worker = await this.workerService.viewWorkerForMonitorConsistent(
      input.data.worker_id
    );
    input.leaseContext.assertActive();
    const pending = this.parsePendingFailedWarmActivationCleanup(
      input.warm,
      input.data.worker_id
    );
    const alreadyClaimed = Boolean(
      pending &&
      pending.runtimeGeneration === input.runtime.runtime_generation &&
      worker?.worker_status_id === EWorkerStatus.error
    );
    const expectedWorkerStatusId =
      worker?.worker_status_id === EWorkerStatus.creating ||
      worker?.worker_status_id === EWorkerStatus.recreating
        ? worker.worker_status_id
        : undefined;
    if (!alreadyClaimed && !expectedWorkerStatusId) {
      return false;
    }

    return this.cleanupFailedActivatedWarmRuntime({
      data: input.data,
      workerType: input.warm.worker_type_id as EWorkerType,
      containerId: input.runtime.container_id,
      sessionVolumeName: input.runtime.session_volume_name,
      runtimeGeneration: input.runtime.runtime_generation,
      expectedWorkerStatusId,
      expectedWarmState: input.expectedWarmState,
      expectedWarmContainerId: input.expectedWarmContainerId,
      error: pending?.error ?? input.error,
      leaseContext: input.leaseContext,
      alreadyClaimed,
    });
  }

  private async resolveInterruptedWarmActivationCleanup(
    data: ValidatedActivateWarmWorkerRequest,
    warm: IWorkerWarmPool,
    workerType: EWorkerType,
    leaseContext: ILockLeaseContext
  ): Promise<IWarmWorkerCommandResponseProto | undefined> {
    this.assertLegacyWarmSession(warm);
    if (
      warm.server_id !== data.server_id ||
      warm.worker_type_id !== workerType ||
      warm.reserved_by_worker_id !== data.worker_id ||
      !warm.container_id ||
      warm.container_name !== `warm-${data.warm_pool_id}` ||
      warm.session_volume_name !== `warm-${data.warm_pool_id}`
    ) {
      return undefined;
    }
    const runtime =
      await this.workerRuntimeRepository?.viewByWorkerIdConsistent(
        data.worker_id
      );
    leaseContext.assertActive();
    if (
      !runtime ||
      runtime.warm_pool_id !== data.warm_pool_id ||
      !runtime.container_id ||
      runtime.container_name !== data.worker_id ||
      runtime.session_volume_name !== warm.session_volume_name
    ) {
      return undefined;
    }
    this.assertLegacyRuntimeSession(runtime);
    const target = await this.workerService.inspectContainerWorkerByIdStrict(
      runtime.container_id
    );
    leaseContext.assertActive();
    if (target.exists) return undefined;
    const volumeExists = await this.workerService.existsVolumeByNameStrict(
      warm.session_volume_name
    );
    leaseContext.assertActive();
    if (volumeExists) return undefined;
    const finalized = await this.finalizePhysicallyMissingWarmActivation({
      data,
      warm,
      runtime,
      expectedWarmState: EWorkerWarmPoolState.activating,
      expectedWarmContainerId: warm.container_id,
      error: 'activating_runtime_missing_after_interrupted_cleanup',
      leaseContext,
    });
    if (!finalized) {
      throw new Error(
        'warm_worker_activating_missing_cleanup_finalization_failed'
      );
    }
    return this.confirmedWarmActivationCleanupResponse(data);
  }

  private async resolveConfirmedWarmActivationCleanupRedelivery(
    data: ValidatedActivateWarmWorkerRequest,
    warm: IWorkerWarmPool,
    workerType: EWorkerType,
    leaseContext: ILockLeaseContext
  ): Promise<IWarmWorkerCommandResponseProto> {
    this.assertLegacyWarmSession(warm);
    const runtime =
      await this.workerRuntimeRepository?.viewByWorkerIdConsistent(
        data.worker_id
      );
    leaseContext.assertActive();
    const target = await this.workerService.inspectContainerWorkerByIdStrict(
      data.worker_id
    );
    leaseContext.assertActive();
    const volumeExists = await this.workerService.existsVolumeByNameStrict(
      warm.session_volume_name
    );
    leaseContext.assertActive();
    const volumeReferenced =
      await this.workerRuntimeRepository?.isSessionVolumeReferencedConsistent(
        warm.session_volume_name
      );
    leaseContext.assertActive();
    const exactTombstone = Boolean(
      runtime &&
      Number.isSafeInteger(runtime.runtime_generation) &&
      runtime.runtime_generation > 0 &&
      runtime.container_id === null &&
      runtime.container_name === data.worker_id &&
      runtime.warm_pool_id === null &&
      runtime.session_volume_name ===
        this.warmActivationTombstoneVolumeName(
          data.warm_pool_id,
          runtime.runtime_generation
        )
    );
    const marker = runtime
      ? `${WARM_ACTIVATION_CLEANUP_MARKER}:${data.worker_id}:${runtime.runtime_generation}:`
      : '';
    const atomicCleanupConfirmed = Boolean(
      exactTombstone && warm.last_error?.startsWith(marker)
    );
    const preflightCleanupConfirmed = Boolean(
      warm.last_error?.startsWith(
        `${WARM_ACTIVATION_PREFLIGHT_CLEANUP_MARKER}:${data.worker_id}:`
      ) &&
      runtime?.warm_pool_id !== data.warm_pool_id &&
      runtime?.session_volume_name !== warm.session_volume_name
    );
    const targetHasWarmLineage =
      target.exists &&
      this.isWarmContainerOwnedByRequest(target, data.warm_pool_id);
    if (
      warm.server_id !== data.server_id ||
      warm.worker_type_id !== workerType ||
      warm.container_id !== null ||
      warm.container_name !== null ||
      warm.reserved_by_worker_id !== null ||
      (!atomicCleanupConfirmed && !preflightCleanupConfirmed) ||
      targetHasWarmLineage ||
      (atomicCleanupConfirmed && target.exists) ||
      volumeExists ||
      volumeReferenced !== false
    ) {
      throw new Error('warm_worker_cleanup_redelivery_proof_mismatch');
    }
    return this.confirmedWarmActivationCleanupResponse(data);
  }

  private async resolveAmbiguousWarmActivationFinalization(input: {
    data: ValidatedActivateWarmWorkerRequest;
    workerType: EWorkerType;
    containerId: string;
    expectedSourceContainerId: string;
    sessionVolumeName: string;
    runtimeGeneration: number;
  }): Promise<'finalized' | 'assigned' | 'activating' | 'unknown'> {
    try {
      if (!this.workerRuntimeRepository) {
        return 'unknown';
      }
      const [warm, runtime, worker] = await Promise.all([
        this.workerWarmPoolRepository.viewByIdConsistent(
          input.data.warm_pool_id
        ),
        this.workerRuntimeRepository.viewByWorkerIdConsistent(
          input.data.worker_id
        ),
        this.workerService.viewWorkerForMonitorConsistent(input.data.worker_id),
      ]);
      const warmFinalized =
        warm?.state === EWorkerWarmPoolState.assigned &&
        warm.reserved_by_worker_id === input.data.worker_id &&
        warm.container_id === input.containerId;
      const runtimeFinalized =
        runtime?.warm_pool_id === input.data.warm_pool_id &&
        runtime.container_id === input.containerId &&
        runtime.container_name === input.data.worker_id &&
        runtime.session_volume_name === input.sessionVolumeName &&
        runtime.runtime_generation === input.runtimeGeneration;
      const workerFinalized =
        worker?.account_id === input.data.account_id &&
        worker.server_id === input.data.server_id &&
        worker.worker_type_id === input.workerType &&
        worker.container_id === input.containerId &&
        (worker.worker_status_id === EWorkerStatus.disponible ||
          worker.worker_status_id === EWorkerStatus.online) &&
        worker.lifecycle_operation_id === null;

      if (warmFinalized && runtimeFinalized) {
        return workerFinalized ? 'finalized' : 'assigned';
      }
      const warmStillActivating =
        warm?.state === EWorkerWarmPoolState.activating &&
        warm.reserved_by_worker_id === input.data.worker_id &&
        warm.container_id === input.expectedSourceContainerId;
      const runtimeStillActivating =
        runtime?.warm_pool_id === input.data.warm_pool_id &&
        runtime.session_volume_name === input.sessionVolumeName &&
        runtime.runtime_generation === input.runtimeGeneration &&
        (!runtime.container_id || runtime.container_id === input.containerId);
      return warmStillActivating && runtimeStillActivating
        ? 'activating'
        : 'unknown';
    } catch (reconciliationError) {
      this.logDebug('service.warm_activation.finalization_recheck_failed', {
        trace_id: input.data.debug_trace_id,
        layer: 'service',
        worker_id: input.data.worker_id,
        account_id: input.data.account_id,
        worker_type_id: input.workerType,
        warm_pool_id: input.data.warm_pool_id,
        runtime_generation: input.runtimeGeneration,
        error: getErrorMessage(reconciliationError),
      });
      return 'unknown';
    }
  }

  private async removeExistingRuntimeBeforeWarmActivation(
    data: ValidatedActivateWarmWorkerRequest,
    workerType: EWorkerType,
    sourceContainerName: string,
    preserveWarmLineageTarget: boolean,
    leaseContext: ILockLeaseContext
  ): Promise<void> {
    leaseContext.assertActive();
    const targetInspection =
      await this.workerService.inspectContainerWorkerByIdStrict(data.worker_id);
    leaseContext.assertActive();
    if (!targetInspection.exists) {
      if (data.remove_volume === true) {
        await this.removeAbsentExistingRuntimeVolumeBeforeWarmActivation(
          data,
          workerType,
          leaseContext
        );
      }
      return;
    }
    if (targetInspection.container_name === sourceContainerName) {
      return;
    }
    const [runtime, worker] = await Promise.all([
      this.workerRuntimeRepository?.viewByWorkerIdConsistent(data.worker_id),
      this.workerService.viewWorkerForMonitorConsistent(data.worker_id),
    ]);
    leaseContext.assertActive();
    if (
      preserveWarmLineageTarget &&
      this.isResumableModernWarmActivationTarget(
        data,
        workerType,
        targetInspection,
        runtime,
        worker
      )
    ) {
      return;
    }
    const existingWorkerType = this.resolveExistingRuntimeWorkerType(
      data,
      workerType
    );
    const identityRejection =
      await this.resolveExistingWarmActivationTargetRejection(
        data,
        workerType,
        existingWorkerType,
        targetInspection,
        runtime,
        worker,
        leaseContext
      );
    leaseContext.assertActive();
    if (identityRejection) {
      const previousLegacyRejection =
        await this.resolveLegacyAssignedWarmTargetRejection(
          data,
          workerType,
          existingWorkerType,
          targetInspection,
          runtime,
          worker
        );
      leaseContext.assertActive();
      const currentLegacyRejection = previousLegacyRejection
        ? await this.resolveCurrentLegacyWarmTargetRejection(
            data,
            workerType,
            targetInspection,
            runtime,
            worker
          )
        : undefined;
      leaseContext.assertActive();
      if (previousLegacyRejection && currentLegacyRejection) {
        throw new Error(
          `warm_worker_existing_target_identity_conflict:${identityRejection}:${previousLegacyRejection}:${currentLegacyRejection}`
        );
      }
    }
    const targetContainerId = targetInspection.container_id as string;
    let removed = false;
    try {
      removed =
        await this.workerService.removeContainerWorkerById(targetContainerId);
    } catch (error) {
      const current =
        await this.workerService.inspectContainerWorkerByIdStrict(
          targetContainerId
        );
      if (current.exists) throw error;
      removed = true;
    }
    leaseContext.assertActive();
    if (!removed) {
      const current =
        await this.workerService.inspectContainerWorkerByIdStrict(
          targetContainerId
        );
      if (current.exists) {
        throw new Error('Worker removal failed before warm activation');
      }
    }
    if (
      data.remove_volume === true &&
      runtime &&
      runtime.warm_pool_id !== data.warm_pool_id
    ) {
      this.assertLegacyRuntimeSession(runtime);
      const referencedByAnotherWorker =
        await this.workerRuntimeRepository?.isSessionVolumeReferencedByOtherWorkerConsistent(
          runtime.session_volume_name,
          data.worker_id
        );
      leaseContext.assertActive();
      if (referencedByAnotherWorker !== false) {
        throw new Error(
          'warm_worker_existing_target_volume_shared_before_removal'
        );
      }
      const volumeRemoved = await this.workerService.removeVolumeByName(
        runtime.session_volume_name
      );
      leaseContext.assertActive();
      if (!volumeRemoved) {
        throw new Error('warm_worker_existing_target_volume_removal_failed');
      }
    }

    await this.waitForContainerNameReleased(
      data.worker_id,
      10,
      300,
      leaseContext
    );
  }

  private isResumableModernWarmActivationTarget(
    data: ValidatedActivateWarmWorkerRequest,
    workerType: EWorkerType,
    inspection: WorkerContainerInspection,
    runtime: IWorkerRuntime | null | undefined,
    worker: Awaited<ReturnType<WorkerService['viewWorkerForMonitorConsistent']>>
  ): boolean {
    if (
      !runtime ||
      !worker ||
      runtime.warm_pool_id !== data.warm_pool_id ||
      runtime.container_name !== data.worker_id ||
      runtime.session_volume_name !== `warm-${data.warm_pool_id}` ||
      (runtime.container_id &&
        runtime.container_id !== inspection.container_id) ||
      !Number.isSafeInteger(runtime.runtime_generation) ||
      runtime.runtime_generation <= 0 ||
      worker.deleted_at ||
      worker.account_id !== data.account_id ||
      worker.server_id !== data.server_id ||
      worker.worker_type_id !== workerType ||
      worker.lifecycle_operation_id !== (data.lifecycle_operation_id ?? null) ||
      (worker.worker_status_id !== EWorkerStatus.creating &&
        worker.worker_status_id !== EWorkerStatus.recreating)
    ) {
      return false;
    }
    return (
      this.resolveOwnedActivatedWarmContainerIdentityRejection(
        data,
        workerType,
        runtime.runtime_generation,
        inspection,
        inspection.container_id,
        false
      ) === undefined
    );
  }

  private async removeAbsentExistingRuntimeVolumeBeforeWarmActivation(
    data: ValidatedActivateWarmWorkerRequest,
    workerType: EWorkerType,
    leaseContext: ILockLeaseContext
  ): Promise<void> {
    const [runtime, worker] = await Promise.all([
      this.workerRuntimeRepository?.viewByWorkerIdConsistent(data.worker_id),
      this.workerService.viewWorkerForMonitorConsistent(data.worker_id),
    ]);
    leaseContext.assertActive();
    if (!runtime || runtime.warm_pool_id === data.warm_pool_id) return;
    this.assertLegacyRuntimeSession(runtime);
    if (
      worker?.account_id !== data.account_id ||
      worker.server_id !== data.server_id ||
      worker.worker_type_id !== workerType ||
      (worker.worker_status_id !== EWorkerStatus.creating &&
        worker.worker_status_id !== EWorkerStatus.recreating) ||
      worker.lifecycle_operation_id !== (data.lifecycle_operation_id ?? null) ||
      runtime.container_name !== data.worker_id ||
      runtime.session_volume_name === `warm-${data.warm_pool_id}` ||
      (runtime.container_id && worker.container_id !== runtime.container_id)
    ) {
      throw new Error('warm_worker_absent_old_runtime_identity_conflict');
    }
    if (runtime.container_id) {
      const byImmutableId =
        await this.workerService.inspectContainerWorkerByIdStrict(
          runtime.container_id
        );
      leaseContext.assertActive();
      if (byImmutableId.exists) {
        throw new Error(
          'warm_worker_absent_old_runtime_container_still_exists'
        );
      }
    }
    const referencedByAnotherWorker =
      await this.workerRuntimeRepository?.isSessionVolumeReferencedByOtherWorkerConsistent(
        runtime.session_volume_name,
        data.worker_id
      );
    leaseContext.assertActive();
    if (referencedByAnotherWorker !== false) {
      throw new Error('warm_worker_absent_old_runtime_volume_shared');
    }
    const removed = await this.workerService.removeVolumeByName(
      runtime.session_volume_name
    );
    leaseContext.assertActive();
    if (!removed) {
      throw new Error('warm_worker_absent_old_runtime_volume_removal_failed');
    }
  }

  private resolveExistingRuntimeWorkerType(
    data: ValidatedActivateWarmWorkerRequest,
    workerType: EWorkerType
  ): EWorkerType {
    const previousWorkerType = data.previous_worker_type_id as
      EWorkerType | undefined;
    if (!previousWorkerType || previousWorkerType === workerType) {
      return workerType;
    }
    throw new Error('worker_type_change_requires_postgres_session');
  }

  private async resolveExistingWarmActivationTargetRejection(
    data: ValidatedActivateWarmWorkerRequest,
    workerType: EWorkerType,
    existingWorkerType: EWorkerType,
    inspection: WorkerContainerInspection,
    runtime: Awaited<
      ReturnType<WorkerRuntimeRepository['viewByWorkerIdConsistent']>
    >,
    worker: Awaited<
      ReturnType<WorkerService['viewWorkerForMonitorConsistent']>
    >,
    leaseContext: ILockLeaseContext
  ): Promise<string | undefined> {
    const labels = inspection.container_labels ?? {};
    const env = inspection.container_env ?? {};
    if (!runtime || !worker) return 'primary_identity_missing';
    this.assertLegacyRuntimeSession(runtime);
    if (!inspection.exists) return 'container_missing';
    if (!inspection.container_id) return 'container_id_missing';
    if (inspection.running !== true) return 'container_not_running';
    if (inspection.container_name !== data.worker_id) return 'container_name';
    if (runtime.container_id !== inspection.container_id) {
      return 'runtime_container_id';
    }
    if (runtime.container_name !== data.worker_id) return 'runtime_name';
    if (
      !Number.isSafeInteger(runtime.runtime_generation) ||
      runtime.runtime_generation <= 0
    ) {
      return 'runtime_generation';
    }
    if (
      worker.deleted_at ||
      worker.account_id !== data.account_id ||
      worker.server_id !== data.server_id ||
      worker.worker_type_id !== workerType ||
      worker.lifecycle_operation_id !== (data.lifecycle_operation_id ?? null) ||
      (worker.worker_status_id !== EWorkerStatus.creating &&
        worker.worker_status_id !== EWorkerStatus.recreating)
    ) {
      return 'worker_fence';
    }
    const staleProviderPointerAuthorized =
      this.isStaleProviderRuntimePointerAuthorized(
        data,
        workerType,
        existingWorkerType,
        runtime,
        worker.container_id,
        inspection.container_id
      );
    if (
      labels['underchat.worker_id'] !== data.worker_id ||
      env.WORKER_ID !== data.worker_id
    ) {
      return 'worker_id';
    }
    if (
      labels['underchat.account_id'] !== data.account_id ||
      env.ACCOUNT_ID !== data.account_id
    ) {
      return 'account_id';
    }
    if (
      labels['underchat.server_id'] !== data.server_id &&
      (!staleProviderPointerAuthorized ||
        labels['underchat.server_id'] !== undefined)
    ) {
      return 'server_id';
    }
    if (
      labels['underchat.worker_type_id'] !== existingWorkerType ||
      env.WORKER_TYPE_ID !== existingWorkerType
    ) {
      return 'worker_type';
    }
    if (
      labels['underchat.session_volume_name'] !== runtime.session_volume_name ||
      env.SESSION_VOLUME_NAME !== runtime.session_volume_name
    ) {
      return 'session_volume';
    }
    if (
      labels['underchat.runtime_generation'] !==
        String(runtime.runtime_generation) ||
      env.RUNTIME_GENERATION !== String(runtime.runtime_generation)
    ) {
      return 'runtime_generation_identity';
    }
    if (
      runtime.warm_pool_id &&
      (labels['underchat.warm_pool_id'] !== runtime.warm_pool_id ||
        env.WARM_POOL_ID !== runtime.warm_pool_id ||
        labels['underchat.warm_standby'] !== 'false' ||
        env.WARM_STANDBY !== 'false')
    ) {
      return 'runtime_warm_identity';
    }
    if (
      !runtime.warm_pool_id &&
      (labels['underchat.warm_pool_id'] !== undefined ||
        env.WARM_POOL_ID !== undefined ||
        labels['underchat.warm_standby'] !== undefined ||
        env.WARM_STANDBY !== undefined)
    ) {
      return 'unexpected_runtime_warm_identity';
    }

    const expectedImage = getImageWorker(existingWorkerType);
    if (
      inspection.container_image !== expectedImage ||
      labels['underchat.worker_image'] !== expectedImage ||
      env.WORKER_IMAGE !== expectedImage
    ) {
      return 'worker_image';
    }
    const expectedGrpcPort = this.getExpectedWorkerGrpcPort(existingWorkerType);
    if (
      expectedGrpcPort !== undefined &&
      (labels['underchat.worker_grpc_port'] !== String(expectedGrpcPort) ||
        env.WORKER_GRPC_PORT !== String(expectedGrpcPort))
    ) {
      return 'worker_grpc_port';
    }
    if (worker.container_id === inspection.container_id) return undefined;
    if (!worker.container_id) return 'worker_container_id_missing';
    if (!staleProviderPointerAuthorized) {
      return 'worker_container_id';
    }

    const staleWorkerContainer =
      await this.workerService.inspectContainerWorkerByIdStrict(
        worker.container_id
      );
    leaseContext.assertActive();
    if (staleWorkerContainer.exists) {
      return 'stale_worker_container_still_exists';
    }
    this.logDebug('service.warm_activation.stale_worker_pointer_reconciled', {
      trace_id: data.debug_trace_id,
      layer: 'service',
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id: workerType,
      lifecycle_operation_id: data.lifecycle_operation_id,
      previous_worker_type_id: existingWorkerType,
      stale_container_id: worker.container_id,
      runtime_container_id: runtime.container_id,
      runtime_generation: runtime.runtime_generation,
      session_volume_name: runtime.session_volume_name,
      warm_pool_id: data.warm_pool_id,
    });
    return undefined;
  }

  private isStaleProviderRuntimePointerAuthorized(
    data: ValidatedActivateWarmWorkerRequest,
    workerType: EWorkerType,
    existingWorkerType: EWorkerType,
    runtime: IWorkerRuntime,
    workerContainerId: string | null | undefined,
    runtimeContainerId: string
  ): boolean {
    return Boolean(
      workerContainerId &&
      workerContainerId !== runtimeContainerId &&
      runtime.container_id === runtimeContainerId &&
      data.previous_worker_type_id === existingWorkerType &&
      existingWorkerType !== workerType &&
      data.remove_session === true &&
      data.remove_volume === true &&
      data.lifecycle_operation_id &&
      runtime.warm_pool_id !== data.warm_pool_id &&
      runtime.session_volume_name !== `warm-${data.warm_pool_id}`
    );
  }

  private async resolveLegacyAssignedWarmTargetRejection(
    data: ValidatedActivateWarmWorkerRequest,
    workerType: EWorkerType,
    existingWorkerType: EWorkerType,
    inspection: WorkerContainerInspection,
    runtime: IWorkerRuntime | null | undefined,
    worker: Awaited<ReturnType<WorkerService['viewWorkerForMonitorConsistent']>>
  ): Promise<string | undefined> {
    if (!runtime || !worker) return 'primary_identity_missing';
    this.assertLegacyRuntimeSession(runtime);
    if (!inspection.container_id) return 'container_id_missing';
    if (!runtime.warm_pool_id || runtime.warm_pool_id === data.warm_pool_id) {
      return 'legacy_warm_pool_id';
    }

    const legacyWarm = await this.workerWarmPoolRepository.viewByIdConsistent(
      runtime.warm_pool_id
    );
    if (!legacyWarm) return 'legacy_warm_row_missing';
    this.assertLegacyWarmSession(legacyWarm);

    const legacyVolume = `warm-${runtime.warm_pool_id}`;
    const labels = inspection.container_labels ?? {};
    const env = inspection.container_env ?? {};
    if (
      legacyWarm.state !== EWorkerWarmPoolState.assigned ||
      legacyWarm.reserved_by_worker_id !== data.worker_id ||
      legacyWarm.server_id !== data.server_id ||
      legacyWarm.worker_type_id !== existingWorkerType ||
      legacyWarm.container_id !== inspection.container_id ||
      legacyWarm.container_name !== legacyVolume ||
      legacyWarm.session_volume_name !== legacyVolume
    ) {
      return 'legacy_warm_row';
    }
    if (
      inspection.container_name !== data.worker_id ||
      runtime.container_id !== inspection.container_id ||
      runtime.container_name !== data.worker_id ||
      runtime.session_volume_name !== legacyVolume ||
      !Number.isSafeInteger(runtime.runtime_generation) ||
      runtime.runtime_generation <= 0
    ) {
      return 'legacy_runtime';
    }
    if (
      worker.deleted_at ||
      worker.account_id !== data.account_id ||
      worker.server_id !== data.server_id ||
      worker.worker_type_id !== workerType ||
      worker.container_id !== inspection.container_id ||
      worker.lifecycle_operation_id !== (data.lifecycle_operation_id ?? null) ||
      (worker.worker_status_id !== EWorkerStatus.creating &&
        worker.worker_status_id !== EWorkerStatus.recreating)
    ) {
      return 'legacy_worker';
    }
    if (
      labels['underchat.warm_standby'] !== 'true' ||
      env.WARM_STANDBY !== 'true' ||
      labels['underchat.warm_pool_id'] !== runtime.warm_pool_id ||
      env.WARM_POOL_ID !== runtime.warm_pool_id ||
      labels['underchat.server_id'] !== data.server_id ||
      labels['underchat.worker_type_id'] !== existingWorkerType ||
      env.WORKER_TYPE_ID !== existingWorkerType ||
      labels['underchat.session_volume_name'] !== legacyVolume ||
      env.SESSION_VOLUME_NAME !== legacyVolume
    ) {
      return 'legacy_container_identity';
    }
    if (
      labels['underchat.worker_id'] !== undefined ||
      labels['underchat.account_id'] !== undefined ||
      labels['underchat.runtime_generation'] !== undefined ||
      env.WORKER_ID !== undefined ||
      env.ACCOUNT_ID !== undefined ||
      env.RUNTIME_GENERATION !== undefined
    ) {
      return 'legacy_container_mixed_identity';
    }
    if (
      !inspection.container_image ||
      labels['underchat.worker_image'] !== inspection.container_image ||
      env.WORKER_IMAGE !== inspection.container_image ||
      !env.WORKER_GRPC_PORT ||
      labels['underchat.worker_grpc_port'] !== env.WORKER_GRPC_PORT
    ) {
      return 'legacy_container_runtime_coherence';
    }

    return undefined;
  }

  private async resolveCurrentLegacyWarmTargetRejection(
    data: ValidatedActivateWarmWorkerRequest,
    workerType: EWorkerType,
    inspection: WorkerContainerInspection,
    runtime: IWorkerRuntime | null | undefined,
    worker: Awaited<ReturnType<WorkerService['viewWorkerForMonitorConsistent']>>
  ): Promise<string | undefined> {
    const warm = await this.workerWarmPoolRepository.viewByIdConsistent(
      data.warm_pool_id
    );
    if (
      !warm ||
      (warm.state !== EWorkerWarmPoolState.reserved &&
        warm.state !== EWorkerWarmPoolState.activating)
    ) {
      return 'current_legacy_warm_state';
    }
    this.assertLegacyWarmSession(warm);
    const containerRejection = this.resolveLegacyWarmContainerIdentityRejection(
      data,
      warm,
      workerType,
      inspection
    );
    if (containerRejection) return containerRejection;
    if (
      !worker ||
      worker.deleted_at ||
      worker.account_id !== data.account_id ||
      worker.server_id !== data.server_id ||
      worker.worker_type_id !== workerType ||
      worker.lifecycle_operation_id !== (data.lifecycle_operation_id ?? null) ||
      (worker.worker_status_id !== EWorkerStatus.creating &&
        worker.worker_status_id !== EWorkerStatus.recreating)
    ) {
      return 'current_legacy_worker';
    }

    const currentRuntime = Boolean(
      runtime &&
      runtime.warm_pool_id === data.warm_pool_id &&
      runtime.session_volume_name === warm.session_volume_name &&
      runtime.container_name === data.worker_id &&
      (!runtime.container_id ||
        runtime.container_id === inspection.container_id) &&
      Number.isSafeInteger(runtime.runtime_generation) &&
      runtime.runtime_generation > 0
    );
    const previousRuntimeReset = Boolean(
      runtime &&
      data.remove_session === true &&
      data.remove_volume === true &&
      runtime.warm_pool_id !== data.warm_pool_id &&
      runtime.session_volume_name !== warm.session_volume_name &&
      runtime.container_id !== inspection.container_id
    );
    if (runtime && !currentRuntime && !previousRuntimeReset) {
      return 'current_legacy_runtime';
    }
    const staleWorkerContainerId =
      worker.container_id &&
      worker.container_id !== inspection.container_id &&
      worker.container_id !== runtime?.container_id
        ? worker.container_id
        : undefined;
    if (staleWorkerContainerId) {
      if (data.remove_session !== true || data.remove_volume !== true) {
        return 'current_legacy_worker_container';
      }
      const staleWorkerContainer =
        await this.workerService.inspectContainerWorkerByIdStrict(
          staleWorkerContainerId
        );
      if (staleWorkerContainer.exists) {
        return 'current_legacy_worker_container_exists';
      }
    }
    if (previousRuntimeReset && runtime?.container_id) {
      const previous =
        await this.workerService.inspectContainerWorkerByIdStrict(
          runtime.container_id
        );
      if (previous.exists) return 'current_legacy_previous_container_exists';
    }
    const referencedByAnotherWorker =
      await this.workerRuntimeRepository?.isSessionVolumeReferencedByOtherWorkerConsistent(
        warm.session_volume_name,
        data.worker_id
      );
    if (referencedByAnotherWorker !== false) {
      return 'current_legacy_volume_shared';
    }

    return undefined;
  }

  private async waitForContainerNameReleased(
    containerName: string,
    maxAttempts: number,
    delayMs: number,
    leaseContext?: ILockLeaseContext
  ): Promise<void> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      leaseContext?.assertActive();
      const inspection =
        await this.workerService.inspectContainerWorkerByIdStrict(
          containerName
        );
      leaseContext?.assertActive();
      if (!inspection.exists) {
        return;
      }

      if (attempt < maxAttempts) {
        await this.sleep(delayMs);
      }
    }
    throw new Error(`container_name_release_timeout:${containerName}`);
  }

  private async publishWarmActivationDisponible(
    data: IActivateWarmWorkerRequestProto,
    workerType: EWorkerType,
    containerId?: string,
    runtimeGeneration?: number
  ): Promise<void> {
    if (!data.worker_id || !data.account_id) {
      return;
    }

    const state: IBaileysConnectionState = {
      code: ECodeMessage.info,
      status: EBaileysConnectionStatus.info,
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_status_id: EWorkerStatus.disponible,
      warm_pool_id: data.warm_pool_id,
      container_id: containerId,
      runtime_generation: runtimeGeneration,
      reason: 'warm_activation_disponible',
    };

    try {
      await Promise.all([
        this.centrifugoService.publishSub(
          workerCentrifugoQueue(data.account_id),
          state
        ),
        this.centrifugoService.publish(channelsConfigCentrifugo(), {
          action: EWorkerAction.create,
          worker_id: data.worker_id,
          account_id: data.account_id,
          server_id: data.server_id ?? '',
          worker_type_id: workerType,
          worker_status_id: EWorkerStatus.disponible,
          lifecycle_operation_id: data.lifecycle_operation_id,
        }),
      ]);
    } catch {}
  }

  private validateWarmActivation(
    data: ValidatedActivateWarmWorkerRequest,
    warm: IWorkerWarmPool,
    sourceInspection: WorkerContainerInspection,
    workerType: EWorkerType
  ): string | undefined {
    if (warm.server_id !== data.server_id) {
      return 'server_mismatch';
    }
    if (warm.worker_type_id !== data.worker_type_id) {
      return 'worker_type_mismatch';
    }
    if (
      warm.state !== EWorkerWarmPoolState.reserved &&
      warm.state !== EWorkerWarmPoolState.activating
    ) {
      return 'warm_pool_state_not_activatable';
    }
    if (warm.reserved_by_worker_id !== data.worker_id) {
      return 'reserved_worker_mismatch';
    }
    const expectedName = `warm-${data.warm_pool_id}`;
    if (!warm.container_id) {
      return 'persisted_container_id_missing';
    }
    if (warm.container_name !== expectedName) {
      return 'persisted_container_name_mismatch';
    }
    if (warm.session_volume_name !== expectedName) {
      return 'persisted_session_volume_mismatch';
    }
    if (
      warm.state === EWorkerWarmPoolState.reserved &&
      warm.reservation_expires_at
    ) {
      const expiresAtMs = Date.parse(warm.reservation_expires_at);
      if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) {
        return 'reservation_expired';
      }
    }
    if (
      warm.state === EWorkerWarmPoolState.reserved ||
      sourceInspection.exists
    ) {
      const identityRejection = this.resolveOwnedWarmContainerIdentityRejection(
        data,
        workerType,
        sourceInspection,
        warm.container_id
      );
      if (identityRejection) {
        return `source_container_identity_${identityRejection}`;
      }
      if (sourceInspection.running !== true) {
        return 'source_container_not_running';
      }
    }

    return undefined;
  }

  private async runWithWorkerLifecycleLock<T>(
    workerId: string,
    operation: string,
    callback: (leaseContext: ILockLeaseContext) => Promise<T>,
    context?: ConnectionLifecycleDebugContext,
    options?: WorkerLifecycleLeaseOptions
  ): Promise<T> {
    const startedAt = Date.now();
    this.logDebug('service.lifecycle_lock.wait', {
      ...context,
      layer: context?.layer ?? 'service',
      worker_id: workerId,
      operation,
    });

    const run = (leaseContext: ILockLeaseContext): Promise<T> => {
      leaseContext.assertActive();
      this.logDebug('service.lifecycle_lock.acquired', {
        ...context,
        layer: context?.layer ?? 'service',
        worker_id: workerId,
        operation,
        duration_ms: Date.now() - startedAt,
      });

      return (async () => {
        try {
          const result = await callback(leaseContext);
          leaseContext.assertActive();
          this.logDebug('service.lifecycle_lock.release', {
            ...context,
            layer: context?.layer ?? 'service',
            worker_id: workerId,
            operation,
            duration_ms: Date.now() - startedAt,
          });
          return result;
        } catch (error) {
          this.logDebug('service.lifecycle_lock.error', {
            ...context,
            layer: context?.layer ?? 'service',
            worker_id: workerId,
            operation,
            duration_ms: Date.now() - startedAt,
            reason: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      })();
    };

    if (options) {
      return this.workerLifecycleLockService.withLock(
        workerId,
        operation,
        run,
        options
      );
    }
    return this.workerLifecycleLockService.withLock(workerId, operation, run);
  }

  async handleChangeConnectionStatus(
    input: StatusConnectionWorkerRequest,
    accountId?: string
  ): Promise<void> {
    await this.handleChangeConnectionStatusWithLifecycle(input, accountId);
  }

  private async handleChangeConnectionStatusWithLifecycle(
    input: StatusConnectionWorkerRequest,
    accountId?: string
  ): Promise<void> {
    const payload: StatusConnectionWorkerRequest = {
      worker_id: input.worker_id,
      status: input.status,
      type: input.type,
      phone_connection: input.phone_connection,
      remove_session: input.remove_session,
      connection_attempt_id: input.connection_attempt_id,
      debug_trace_id: input.debug_trace_id,
      runtime_generation: input.runtime_generation,
      warm_pool_id: input.warm_pool_id,
      qr_pending: input.qr_pending,
    };

    this.logDebug('service.command_handler.change_connection_status', {
      trace_id: payload.debug_trace_id,
      layer: 'service',
      worker_id: payload.worker_id,
      account_id: accountId,
      connection_attempt_id: payload.connection_attempt_id,
      runtime_generation: payload.runtime_generation,
      status: payload.status,
      qr_pending: payload.qr_pending === true,
    });

    if (
      payload.status === EWorkerStatus.online &&
      payload.type === EBaileysConnectionType.qrcode
    ) {
      throw new Error(
        'Use the QR Code request endpoint for QR Code connections.'
      );
    }

    if (payload.status === EWorkerStatus.online) {
      this.startOnlineConnectionWorkflow(payload, accountId);
      return;
    }

    this.stopConnectionRequestRetry(payload.worker_id);
    const removesSessionInPlace =
      payload.status === EWorkerStatus.disponible &&
      payload.remove_session === true;
    await this.runWithWorkerLifecycleLock(
      payload.worker_id,
      'change_status_worker_request',
      async (leaseContext) => {
        try {
          let disconnectWorkerType: EWorkerType | undefined;
          let disconnectRuntimeGeneration: number | undefined;
          let disconnectContainerId: string | undefined;
          let disconnectConnectionEpoch: string | null | undefined;
          if (removesSessionInPlace) {
            leaseContext.assertActive();
            const current = await this.viewWorkerForMonitorConsistent(
              payload.worker_id
            );
            leaseContext.assertActive();
            const expectedRuntimeGeneration = this.optionalRuntimeGeneration(
              payload.runtime_generation
            );
            if (
              !current ||
              !accountId ||
              current.account_id !== accountId ||
              current.deleted_at ||
              current.lifecycle_operation_id ||
              !expectedRuntimeGeneration ||
              current.runtime_generation !== expectedRuntimeGeneration
            ) {
              throw new Error('worker_disconnect_lifecycle_fence_changed');
            }
            if (
              !current.runtime_container_id ||
              (current.container_id !== null &&
                current.container_id !== current.runtime_container_id)
            ) {
              throw new Error('worker_disconnect_runtime_container_conflict');
            }
            const currentConnectionEpoch = current.connection_epoch ?? null;
            if (
              (current.connection_disconnected_at ?? null) !== null &&
              (current.disconnected_connection_epoch ?? null) ===
                currentConnectionEpoch
            ) {
              const finalized =
                await this.workerRuntimeRepository.finalizeWorkerConnectionDisconnect(
                  {
                    worker_id: payload.worker_id,
                    account_id: accountId,
                    expected_runtime_generation: expectedRuntimeGeneration,
                    expected_container_id: current.runtime_container_id,
                    expected_connection_epoch: currentConnectionEpoch,
                  }
                );
              leaseContext.assertActive();
              if (finalized.status === 'completed') {
                return;
              }
              if (
                finalized.status !== 'session_not_empty' &&
                finalized.status !== 'session_fence_invalid'
              ) {
                throw new Error('worker_disconnect_terminal_fence_changed');
              }
            }
            disconnectWorkerType = current.worker_type_id as EWorkerType;
            disconnectRuntimeGeneration = expectedRuntimeGeneration;
            disconnectContainerId = current.runtime_container_id;
            disconnectConnectionEpoch = currentConnectionEpoch;
            const prepared =
              await this.workerRuntimeRepository.prepareWorkerConnectionDisconnect(
                {
                  worker_id: payload.worker_id,
                  account_id: accountId,
                  expected_runtime_generation: expectedRuntimeGeneration,
                  expected_container_id: current.runtime_container_id,
                  expected_connection_epoch: currentConnectionEpoch,
                }
              );
            leaseContext.assertActive();
            if (prepared.status !== 'prepared') {
              throw new Error('worker_disconnect_terminal_fence_changed');
            }
            await this.invalidateQrAttemptState(
              payload.worker_id,
              {
                accountId,
                workerType: disconnectWorkerType,
                reason: 'worker_connection_disconnected',
                debugTraceId: payload.debug_trace_id,
                runtimeGeneration: expectedRuntimeGeneration,
                strict: true,
              },
              leaseContext
            );
          }

          const workerType = await this.resolveWorkerTypeForConnection(
            input.worker_id,
            accountId
          );
          await this.publishConnectionIntent(
            payload,
            accountId,
            disconnectWorkerType ?? workerType
          );
          leaseContext.assertActive();
          let providerRequestFailed = false;
          let providerRequestError: unknown;
          try {
            await this.workerBaileysGrpcClientService.requestConnection(
              input.worker_id,
              payload,
              disconnectWorkerType ?? workerType
            );
          } catch (error) {
            if (!removesSessionInPlace) {
              throw error;
            }
            providerRequestFailed = true;
            providerRequestError = error;
          }
          if (
            removesSessionInPlace &&
            accountId &&
            disconnectWorkerType &&
            disconnectRuntimeGeneration &&
            disconnectContainerId &&
            disconnectConnectionEpoch !== undefined
          ) {
            try {
              await this.finalizeInPlaceConnectionDisconnect({
                workerId: payload.worker_id,
                accountId,
                workerType: disconnectWorkerType,
                runtimeGeneration: disconnectRuntimeGeneration,
                containerId: disconnectContainerId,
                connectionEpoch: disconnectConnectionEpoch,
                debugTraceId: payload.debug_trace_id,
                leaseContext,
              });
            } catch (finalizationError) {
              if (providerRequestFailed) {
                throw new AggregateError(
                  [providerRequestError, finalizationError],
                  'worker_disconnect_provider_and_terminal_cleanup_failed'
                );
              }
              throw finalizationError;
            }
            if (providerRequestFailed) {
              this.logDebug(
                'service.command_handler.disconnect_provider_error_recovered',
                {
                  trace_id: payload.debug_trace_id,
                  layer: 'service',
                  worker_id: payload.worker_id,
                  account_id: accountId,
                  worker_type_id: disconnectWorkerType,
                  runtime_generation: disconnectRuntimeGeneration,
                  reason:
                    providerRequestError instanceof Error
                      ? providerRequestError.message
                      : String(providerRequestError),
                }
              );
            }
          } else if (providerRequestFailed) {
            throw providerRequestError;
          }
        } catch (err) {
          throw err;
        }
      },
      {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: payload.worker_id,
        account_id: accountId,
        connection_attempt_id: payload.connection_attempt_id,
        runtime_generation: payload.runtime_generation,
        status: payload.status,
      },
      removesSessionInPlace
        ? {
            acquireTimeoutMs: CONNECTION_DISCONNECT_LOCK_ACQUIRE_TIMEOUT_MS,
            ttlMs: CONNECTION_DISCONNECT_LOCK_TTL_MS,
            heartbeatIntervalMs: CONNECTION_DISCONNECT_LOCK_HEARTBEAT_MS,
          }
        : undefined
    );
  }

  private async finalizeInPlaceConnectionDisconnect(input: {
    workerId: string;
    accountId: string;
    workerType: EWorkerType;
    runtimeGeneration: number;
    containerId: string;
    connectionEpoch: string | null;
    debugTraceId?: string;
    leaseContext: ILockLeaseContext;
  }): Promise<void> {
    input.leaseContext.assertActive();
    // The first pass removes credentials that predated logout. Run a second
    // strict pass even when the provider acknowledgement failed: the worker
    // may have committed the canonical clear before losing its gRPC reply.
    await this.invalidateQrAttemptState(
      input.workerId,
      {
        accountId: input.accountId,
        workerType: input.workerType,
        reason: 'worker_connection_disconnected_terminal',
        debugTraceId: input.debugTraceId,
        runtimeGeneration: input.runtimeGeneration,
        strict: true,
      },
      input.leaseContext
    );
    input.leaseContext.assertActive();
    const finalizeDeadline =
      Date.now() + CONNECTION_DISCONNECT_FINALIZE_RETRY_MS;
    while (true) {
      input.leaseContext.assertActive();
      const finalized =
        await this.workerRuntimeRepository.finalizeWorkerConnectionDisconnect({
          worker_id: input.workerId,
          account_id: input.accountId,
          expected_runtime_generation: input.runtimeGeneration,
          expected_container_id: input.containerId,
          expected_connection_epoch: input.connectionEpoch,
        });
      input.leaseContext.assertActive();
      if (finalized.status === 'completed') {
        return;
      }
      if (
        finalized.status !== 'session_not_empty' &&
        finalized.status !== 'session_fence_invalid'
      ) {
        throw new Error('worker_disconnect_terminal_fence_changed');
      }
      if (Date.now() >= finalizeDeadline) {
        throw new Error('worker_disconnect_session_postcondition_failed');
      }
      await this.sleep(CONNECTION_DISCONNECT_FINALIZE_POLL_MS);
    }
  }

  async handleRequestConnectionQrCode(
    input: StatusConnectionWorkerRequest,
    accountId?: string
  ): Promise<IBaileysConnectionState> {
    return this.handleRequestConnectionQrCodeWithLifecycle(input, accountId);
  }

  private async handleRequestConnectionQrCodeWithLifecycle(
    input: StatusConnectionWorkerRequest,
    accountId?: string
  ): Promise<IBaileysConnectionState> {
    if (input.type === EBaileysConnectionType.phone) {
      throw new Error('Phone connection is disabled. Use QR Code.');
    }

    this.stopConnectionRequestRetry(input.worker_id);
    this.logDebug('service.command_handler.qr_request.start', {
      trace_id: input.debug_trace_id,
      layer: 'service',
      worker_id: input.worker_id,
      account_id: accountId,
      connection_attempt_id: input.connection_attempt_id,
      runtime_generation: input.runtime_generation,
      status: input.status,
      qr_pending: input.qr_pending === true,
    });
    return this.runWithWorkerLifecycleLock(
      input.worker_id,
      'request_qrcode',
      async () => {
        const { payload, cachedState, shouldReturnCached } =
          await this.resolveQrRequestPayload(input, accountId);

        if (shouldReturnCached && cachedState) {
          if (
            cachedState.qrcode ||
            cachedState.pairing_code ||
            cachedState.passkey_public_key ||
            cachedState.passkey_confirmation_code
          ) {
            return this.buildQrReadyStateFromState(
              cachedState,
              payload,
              accountId
            );
          }

          return this.buildQrPendingStateFromState(
            cachedState,
            payload,
            accountId
          );
        }

        return this.runConnectionQrCodeWorkflow(payload, accountId);
      },
      {
        trace_id: input.debug_trace_id,
        layer: 'service',
        worker_id: input.worker_id,
        account_id: accountId,
        connection_attempt_id: input.connection_attempt_id,
        runtime_generation: input.runtime_generation,
        status: input.status,
      }
    );
  }

  private async publishConnectionIntent(
    payload: StatusConnectionWorkerRequest,
    accountId?: string,
    workerTypeId?: EWorkerType
  ): Promise<void> {
    if (!accountId) {
      return;
    }

    if (payload.status === EWorkerStatus.online) {
      this.logDebug('service.connection_intent.publish', {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: payload.worker_id,
        account_id: accountId,
        connection_attempt_id: payload.connection_attempt_id,
        runtime_generation: payload.runtime_generation,
        status: payload.status,
      });
      await this.centrifugoPublish({
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitConnection,
        worker_id: payload.worker_id,
        account_id: accountId,
        worker_type_id: workerTypeId,
        connection_attempt_id: payload.connection_attempt_id,
        runtime_generation: payload.runtime_generation,
        debug_trace_id: payload.debug_trace_id,
      }).catch((err) => {
        console.error('Failed to publish connection start intent:', err);
      });
      return;
    }

    if (payload.status === EWorkerStatus.disponible) {
      this.logDebug('service.connection_intent.publish', {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: payload.worker_id,
        account_id: accountId,
        connection_attempt_id: payload.connection_attempt_id,
        runtime_generation: payload.runtime_generation,
        status: payload.status,
      });
      await this.centrifugoPublish({
        status: EBaileysConnectionStatus.info,
        code: ECodeMessage.logoutInProgress,
        worker_id: payload.worker_id,
        account_id: accountId,
        worker_type_id: workerTypeId,
        disconnected_user: true,
        connection_attempt_id: payload.connection_attempt_id,
        runtime_generation: payload.runtime_generation,
        debug_trace_id: payload.debug_trace_id,
      }).catch((err) => {
        console.error('Failed to publish connection logout intent:', err);
      });
    }
  }

  async notifyWorkerStatus(
    input: INotifyWorkerStatusRequestProto
  ): Promise<void> {
    const workerStatusId = input.worker_status_id as EWorkerStatus | undefined;
    await this.notifyWorkerStatusWithLifecycle(input, workerStatusId);
  }

  async activateWhatsappRuntimeFence(
    input: IWhatsappRuntimeFenceActivationRequestProto
  ): Promise<IWhatsappRuntimeFenceActivationResponseProto> {
    const runtimeGeneration = this.optionalRuntimeGeneration(
      input.runtime_generation
    );
    const connectionEpoch = input.connection_epoch?.trim();
    const connectionAttemptId = input.connection_attempt_id?.trim();
    const sourceProvider = input.source_provider?.trim().toLowerCase();
    const workerId = input.worker_id?.trim();
    const accountId = input.account_id?.trim();

    if (
      !workerId ||
      !accountId ||
      !sourceProvider ||
      !runtimeGeneration ||
      !connectionEpoch
    ) {
      throw new TypeError('Missing required runtime fence activation fields');
    }

    const result =
      await this.workerRuntimeRepository.activateWhatsappRuntimeFence({
        worker_id: workerId,
        account_id: accountId,
        source_provider: sourceProvider,
        runtime_generation: runtimeGeneration,
        connection_epoch: connectionEpoch,
        connection_attempt_id: connectionAttemptId || undefined,
      });

    return {
      activated: true,
      already_active: result.already_active,
      connection_sequence: result.connection_sequence,
    };
  }

  async requestWorkerSelfHealing(
    input: IWorkerSelfHealingRequestProto
  ): Promise<void> {
    const workerId = input.worker_id?.trim();
    const accountId = input.account_id?.trim();
    const workerTypeId = input.worker_type_id?.trim() as
      EWorkerType | undefined;

    if (!workerId || !accountId || !workerTypeId) {
      throw new Error(
        'Missing required fields: worker_id, account_id, worker_type_id'
      );
    }

    if (!Object.values(EWorkerType).includes(workerTypeId)) {
      throw new Error('Invalid worker_type_id');
    }

    const runtimeGeneration = this.optionalRuntimeGeneration(
      input.runtime_generation
    );
    const current = await this.viewWorkerForMonitorConsistent(workerId);
    if (
      !current ||
      current.account_id !== accountId ||
      current.worker_type_id !== workerTypeId ||
      current.deleted_at ||
      current.lifecycle_operation_id ||
      current.worker_status_id !== EWorkerStatus.online ||
      !this.hasSelfHealingActiveSessionEvidence(input)
    ) {
      this.logDebug('service.self_heal.skipped_worker_not_eligible', {
        trace_id: input.debug_trace_id,
        layer: 'service',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: workerTypeId,
        status: current?.worker_status_id,
        lifecycle_operation_id: current?.lifecycle_operation_id ?? undefined,
        source: input.source,
        reason: input.reason,
        authenticated: input.authenticated,
        session_ready: input.session_ready,
        provider_state: input.provider_state,
      });
      return;
    }

    const currentRuntime = await this.viewWorkerRuntimeConsistent(workerId);
    const currentContainerId = current.container_id?.trim();
    const runtimeContainerId = currentRuntime?.container_id?.trim();
    if (
      !runtimeGeneration ||
      !currentRuntime ||
      currentRuntime.runtime_generation !== runtimeGeneration ||
      !currentContainerId ||
      !runtimeContainerId ||
      currentContainerId !== runtimeContainerId
    ) {
      this.logDebug('service.self_heal.skipped_runtime_fence_mismatch', {
        trace_id: input.debug_trace_id,
        layer: 'service',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: workerTypeId,
        source: input.source,
        reason: input.reason,
        reported_runtime_generation: runtimeGeneration,
        current_runtime_generation: currentRuntime?.runtime_generation,
        worker_container_id: currentContainerId,
        runtime_container_id: runtimeContainerId,
      });
      return;
    }

    const inspection = await this.workerService
      .inspectContainerWorkerById(workerId)
      .catch(() => null);
    if (
      !inspection?.exists ||
      inspection.running !== true ||
      inspection.container_id !== currentContainerId
    ) {
      this.logDebug('service.self_heal.skipped_container_not_running', {
        trace_id: input.debug_trace_id,
        layer: 'service',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: workerTypeId,
        source: input.source,
        reason: input.reason,
        worker_container_id: currentContainerId,
        inspected_container_id: inspection?.container_id,
      });
      return;
    }

    const cooldownKey = workerSelfHealCooldownKey(workerId);
    if (await this.redis.get(cooldownKey)) {
      this.logDebug('service.self_heal.skipped_cooldown', {
        trace_id: input.debug_trace_id,
        layer: 'service',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: workerTypeId,
        source: input.source,
        reason: input.reason,
      });
      return;
    }

    const operationId = uuidv7();
    const inflightKey = workerSelfHealInflightKey(workerId);
    const inflightAcquired = await this.redisSetNxSeconds(
      inflightKey,
      operationId,
      this.selfHealInflightTtlSeconds
    );
    if (!inflightAcquired) {
      this.logDebug('service.self_heal.skipped_inflight', {
        trace_id: input.debug_trace_id,
        layer: 'service',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: workerTypeId,
        source: input.source,
        reason: input.reason,
      });
      return;
    }

    const recreateSlotToken = this.workerRecreateServerSlotService.buildToken(
      workerId,
      operationId
    );
    let recreateSlot: WorkerRecreateServerSlotLease | null;
    try {
      recreateSlot = await this.workerRecreateServerSlotService.tryReserve(
        current.server_id,
        recreateSlotToken
      );
    } catch (error) {
      await this.clearSelfHealFencesIfOwned(workerId, operationId).catch(
        (cleanupError) => {
          this.logDebug('service.self_heal.slot_reserve_cleanup_failed', {
            trace_id: input.debug_trace_id,
            layer: 'service',
            worker_id: workerId,
            account_id: accountId,
            worker_type_id: workerTypeId,
            lifecycle_operation_id: operationId,
            reason: getErrorMessage(cleanupError),
          });
        }
      );
      throw error;
    }
    if (!recreateSlot) {
      await this.clearSelfHealFencesIfOwned(workerId, operationId);
      this.logDebug('service.self_heal.deferred_server_capacity', {
        trace_id: input.debug_trace_id,
        layer: 'service',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: workerTypeId,
        lifecycle_operation_id: operationId,
        server_id: current.server_id,
        slot_count: this.workerRecreateServerSlotService.getSlotCount(),
        source: input.source,
        reason: input.reason,
      });
      return;
    }

    let lifecycleClaimed = false;
    let slotTransferredToLifecycle = false;
    try {
      const recoveryWindowSeconds = this.normalizePositiveInt(
        input.recovery_window_seconds,
        this.selfHealRecoveryWindowSeconds
      );
      const now = new Date();
      const deadline = new Date(now.getTime() + recoveryWindowSeconds * 1000);
      const recoveryState: WorkerSelfHealRecoveryState = {
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: workerTypeId,
        source: input.source || 'health_monitor',
        reason: input.reason || 'worker_self_heal_requested',
        provider_state: input.provider_state || undefined,
        degraded_reason: input.degraded_reason || undefined,
        kafka_unhealthy: input.kafka_unhealthy === true,
        session_ready: input.session_ready === true,
        can_send: input.can_send === true,
        can_receive_runtime: input.can_receive_runtime === true,
        authenticated: input.authenticated === true,
        phone: input.phone?.trim() || undefined,
        runtime_generation: runtimeGeneration,
        operation_id: operationId,
        requested_at: now.toISOString(),
        deadline_at: deadline.toISOString(),
        recovery_window_seconds: recoveryWindowSeconds,
        debug_trace_id: input.debug_trace_id || undefined,
      };

      await this.redis.setex(
        workerSelfHealRecoveryKey(workerId),
        recoveryWindowSeconds + 10 * 60,
        JSON.stringify(recoveryState)
      );

      const updateInput: IUpdateWorker = {
        worker_id: workerId,
        worker_status_id: EWorkerStatus.recreating,
        lifecycle_operation_id: operationId,
      };
      const payload: IWorkerPayload = {
        action: EWorkerAction.recreate,
        worker_id: workerId,
        account_id: accountId,
        server_id: current.server_id,
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: workerTypeId,
        session_storage:
          current.session_storage ?? EWorkerSessionStorage.legacy_volume,
        previous_worker_status_id: EWorkerStatus.online,
        lifecycle_operation_id: operationId,
        debug_trace_id: input.debug_trace_id,
      };
      const lifecycleMessage: IWorkerLifecycleQueueMessage = {
        request_id: uuidv7(),
        operation_id: operationId,
        action: 'recreate',
        worker_id: workerId,
        account_id: accountId,
        server_id: current.server_id,
        worker_type_id: workerTypeId,
        session_storage:
          current.session_storage ?? EWorkerSessionStorage.legacy_volume,
        worker_status_id: EWorkerStatus.recreating,
        source: 'self_heal',
        previous_worker_status_id: EWorkerStatus.online,
        recreate_server_slot_key: recreateSlot.key,
        recreate_server_slot_token: recreateSlot.token,
        debug_trace_id: input.debug_trace_id,
        requested_at: currentTime(),
      };
      try {
        await this.workerLifecycleQueueService.prepare(lifecycleMessage);
      } catch (prepareError) {
        try {
          await this.clearSelfHealFencesIfOwned(workerId, operationId);
        } catch (fenceCleanupError) {
          this.logDebug(
            'service.self_heal.prepare_failed_fence_cleanup_pending',
            {
              trace_id: input.debug_trace_id,
              layer: 'service',
              worker_id: workerId,
              account_id: accountId,
              worker_type_id: workerTypeId,
              lifecycle_operation_id: operationId,
              prepare_reason: getErrorMessage(prepareError),
              cleanup_reason: getErrorMessage(fenceCleanupError),
            }
          );
        }
        throw prepareError;
      }

      let updated = false;
      let lifecyclePublished = false;
      try {
        updated = await this.workerService.updateWorkerByIdIfLifecycleMatches(
          accountId,
          updateInput,
          {
            lifecycle_operation_id: null,
            server_id: current.server_id,
            worker_type_id: workerTypeId,
            worker_status_id: EWorkerStatus.online,
          }
        );
      } catch (casError) {
        let lifecycleClaimWasApplied: boolean | undefined;
        try {
          const observed = await this.viewWorkerForMonitorConsistent(workerId);
          lifecycleClaimWasApplied =
            observed?.account_id === accountId &&
            observed.server_id === current.server_id &&
            observed.worker_type_id === workerTypeId &&
            !observed.deleted_at &&
            observed.worker_status_id === EWorkerStatus.recreating &&
            observed.lifecycle_operation_id === operationId;
        } catch (primaryReadError) {
          this.logDebug('service.self_heal.cas_ambiguous_primary_read_failed', {
            trace_id: input.debug_trace_id,
            layer: 'service',
            worker_id: workerId,
            account_id: accountId,
            worker_type_id: workerTypeId,
            lifecycle_operation_id: operationId,
            cas_reason: getErrorMessage(casError),
            reason: getErrorMessage(primaryReadError),
          });
        }

        if (lifecycleClaimWasApplied === false) {
          await this.clearSelfHealFencesIfOwned(workerId, operationId);
          return;
        }

        lifecycleClaimed = true;

        try {
          await this.publishSelfHealLifecycleWithRetry(lifecycleMessage);
          lifecyclePublished = true;
          slotTransferredToLifecycle = true;
          updated = true;
        } catch (publishError) {
          await this.recoverSelfHealAfterPublishFailure({
            lifecycleMessage,
            workerId,
            accountId,
            serverId: current.server_id,
            workerTypeId,
            operationId,
            publishError,
            debugTraceId: input.debug_trace_id,
          });
          lifecyclePublished = true;
          slotTransferredToLifecycle = true;
          updated = true;
        }
      }
      if (!updated) {
        await this.clearSelfHealFencesIfOwned(workerId, operationId);
        return;
      }
      lifecycleClaimed = true;

      const statusPayload: IBaileysConnectionState = {
        code: ECodeMessage.info,
        status: EBaileysConnectionStatus.info,
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: workerTypeId,
        worker_status_id: EWorkerStatus.recreating,
        provider_state: input.provider_state || undefined,
        degraded_reason: input.degraded_reason || input.reason || undefined,
        debug_trace_id: input.debug_trace_id,
      };

      if (!lifecyclePublished) {
        try {
          await this.publishSelfHealLifecycleWithRetry(lifecycleMessage);
          lifecyclePublished = true;
          slotTransferredToLifecycle = true;
        } catch (publishError) {
          await this.recoverSelfHealAfterPublishFailure({
            lifecycleMessage,
            workerId,
            accountId,
            serverId: current.server_id,
            workerTypeId,
            operationId,
            publishError,
            debugTraceId: input.debug_trace_id,
          });
          lifecyclePublished = true;
          slotTransferredToLifecycle = true;
        }
      }

      await Promise.all([
        this.centrifugoPublish(statusPayload),
        this.centrifugoService.publish(channelsConfigCentrifugo(), payload),
      ]).catch((error) => {
        console.error('Failed to publish self-heal recreating status', {
          workerId,
          accountId,
          error: getErrorMessage(error),
        });
      });

      this.logDebug('service.self_heal.accepted', {
        trace_id: input.debug_trace_id,
        layer: 'service',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: workerTypeId,
        lifecycle_operation_id: operationId,
        source: recoveryState.source,
        reason: recoveryState.reason,
        recovery_deadline_at: recoveryState.deadline_at,
      });
    } catch (error) {
      if (!lifecycleClaimed) {
        await this.clearSelfHealFencesIfOwned(workerId, operationId).catch(
          (cleanupError) => {
            this.logDebug('service.self_heal.admission_cleanup_failed', {
              trace_id: input.debug_trace_id,
              layer: 'service',
              worker_id: workerId,
              account_id: accountId,
              worker_type_id: workerTypeId,
              lifecycle_operation_id: operationId,
              reason: getErrorMessage(cleanupError),
            });
          }
        );
      }
      throw error;
    } finally {
      if (!slotTransferredToLifecycle) {
        await this.workerRecreateServerSlotService
          .release(recreateSlot)
          .catch((error) => {
            this.logDebug('service.self_heal.slot_release_failed', {
              trace_id: input.debug_trace_id,
              layer: 'service',
              worker_id: workerId,
              account_id: accountId,
              worker_type_id: workerTypeId,
              lifecycle_operation_id: operationId,
              server_id: current.server_id,
              slot: recreateSlot.slot,
              reason: getErrorMessage(error),
            });
          });
      }
    }
  }

  private async notifyWorkerStatusWithLifecycle(
    input: INotifyWorkerStatusRequestProto,
    workerStatusId: EWorkerStatus | undefined
  ): Promise<void> {
    const workerId = input.worker_id;
    const accountId = input.account_id;

    if (!workerId || !accountId || !workerStatusId) {
      throw new Error(
        'Missing required fields: worker_id, account_id, worker_status_id'
      );
    }

    const payload = this.buildNotifyWorkerStatusPayload(
      input,
      workerId,
      accountId,
      workerStatusId
    );
    const qrCredentialConsumed =
      workerStatusId !== EWorkerStatus.online &&
      (payload.code === ECodeMessage.pairingInProgress ||
        payload.code === ECodeMessage.newLoginAttempt);
    if (qrCredentialConsumed) {
      // Providers historically reported `disponible` while the phone had
      // already consumed the QR. Promote only this explicit, attempt-bound
      // boundary to the durable pairing status. The active-attempt fence
      // below still rejects stale provider/runtime/attempt generations before
      // any database mutation is allowed.
      workerStatusId = EWorkerStatus.connecting;
      payload.worker_status_id = EWorkerStatus.connecting;
    }
    await this.enrichWorkerStatusPayloadWithName(payload, accountId, workerId);
    this.logDebug('service.notify_status.received', {
      trace_id: payload.debug_trace_id,
      layer: 'service',
      worker_id: workerId,
      worker_name: payload.worker_name,
      account_id: accountId,
      worker_type_id: payload.worker_type_id,
      connection_attempt_id: payload.connection_attempt_id,
      runtime_generation: payload.runtime_generation,
      status: payload.status,
      code: payload.code,
      reason: payload.reason,
      has_qrcode: Boolean(payload.qrcode),
      has_pairing_code: Boolean(payload.pairing_code),
      has_passkey_public_key: Boolean(payload.passkey_public_key),
      has_passkey_confirmation_code: Boolean(payload.passkey_confirmation_code),
      passkey_skip_handoff_ux: payload.passkey_skip_handoff_ux === true,
      worker_status_id: workerStatusId,
      session_ready: payload.session_ready,
      can_send: payload.can_send,
      can_receive_runtime: payload.can_receive_runtime,
      authenticated: payload.authenticated,
      provider_state: payload.provider_state,
      degraded_reason: payload.degraded_reason,
      phone: payload.phone,
    });
    const shouldPublishAsQrAttempt = this.isNotifyQrAttemptState(payload);
    const reportedRuntimeGeneration = payload.runtime_generation;
    const reportedContainerId = payload.container_id?.trim().toLowerCase();
    const reportedWorkerTypeId = payload.worker_type_id;
    /*
     * Every provider notification can eventually mutate the worker status.
     * Always resolve the authoritative primary snapshot so that the write can
     * be fenced by the exact lifecycle/server/type/status state observed here.
     */
    let resolvedWorkerData = await this.resolveWorkerDataForContainer(
      workerId,
      accountId
    ).catch(() => null);
    resolvedWorkerData = await this.resolveOnlineRuntimePointerForNotification(
      workerStatusId,
      resolvedWorkerData,
      payload,
      reportedRuntimeGeneration
    );
    if (workerStatusId === EWorkerStatus.online && !resolvedWorkerData) {
      this.logDebug('service.notify_status.online_worker_snapshot_rejected', {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: payload.worker_type_id,
        runtime_generation: payload.runtime_generation,
        status: payload.status,
        code: payload.code,
        reason: 'worker_snapshot_unavailable',
      });
      throw new WorkerOnlineReadinessRejectedError(
        'worker_snapshot_unavailable'
      );
    }
    this.applyResolvedWorkerDataToNotifyPayload({
      payload,
      resolvedWorkerData,
      workerId,
      accountId,
    });

    if (
      !this.shouldContinueAfterNotificationRuntimeFences({
        payload,
        resolvedWorkerData,
        reportedRuntimeGeneration,
        workerStatusId,
        disconnectedUser: input.disconnected_user === true,
        workerId,
        accountId,
      })
    ) {
      return;
    }

    payload.runtime_generation ??= resolvedWorkerData?.runtimeGeneration;

    const requestedWorkerStatusId = workerStatusId;
    workerStatusId = await this.enforceOnlineNotificationReadiness(
      payload,
      workerStatusId,
      {
        requireRuntimeGenerationMatch:
          this.isRuntimeGenerationFenceRequired(resolvedWorkerData),
      }
    );
    if (
      requestedWorkerStatusId !== EWorkerStatus.online &&
      !qrCredentialConsumed
    ) {
      const reconciledWorkerStatusId =
        await this.reconcileNonOnlineNotificationReadiness(
          payload,
          workerStatusId,
          {
            currentWorkerStatusId: resolvedWorkerData?.workerStatusId,
            currentRuntimeGeneration: resolvedWorkerData?.runtimeGeneration,
            reportedRuntimeGeneration,
          }
        );
      if (reconciledWorkerStatusId === null) {
        this.logDebug(
          'service.notify_status.non_online_deferred_active_session',
          {
            trace_id: payload.debug_trace_id,
            layer: 'service',
            worker_id: workerId,
            account_id: accountId,
            worker_type_id: payload.worker_type_id,
            requested_worker_status_id: requestedWorkerStatusId,
            status: payload.status,
            code: payload.code,
            session_ready: payload.session_ready,
            authenticated: payload.authenticated,
            provider_state: payload.provider_state,
            runtime_generation: payload.runtime_generation,
            reason: 'active_session_evidence',
          }
        );
        return;
      }
      workerStatusId = reconciledWorkerStatusId;
    }
    if (
      requestedWorkerStatusId === EWorkerStatus.online &&
      workerStatusId !== EWorkerStatus.online
    ) {
      throw new WorkerOnlineReadinessRejectedError(
        payload.degraded_reason || payload.reason
      );
    }
    if (workerStatusId === EWorkerStatus.online && !resolvedWorkerData) {
      resolvedWorkerData = await this.resolveWorkerDataForContainer(
        workerId,
        accountId
      ).catch(() => null);
    }
    if (workerStatusId === EWorkerStatus.online && !resolvedWorkerData) {
      this.logDebug('service.notify_status.online_worker_snapshot_rejected', {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: payload.worker_type_id,
        runtime_generation: payload.runtime_generation,
        status: payload.status,
        code: payload.code,
        reason: 'worker_snapshot_unavailable_after_readiness',
      });
      throw new WorkerOnlineReadinessRejectedError(
        'worker_snapshot_unavailable'
      );
    }
    this.assertOnlineRuntimeIdentityAvailable(
      workerStatusId,
      resolvedWorkerData,
      payload
    );
    const currentRecreateBootstrapIsReady =
      this.isCurrentRecreateBootstrapReady(resolvedWorkerData);
    const advancesProvisioningOnline = Boolean(
      resolvedWorkerData?.lifecycleOperationId &&
      requestedWorkerStatusId === EWorkerStatus.online &&
      workerStatusId === EWorkerStatus.online &&
      (resolvedWorkerData.workerStatusId === EWorkerStatus.creating ||
        currentRecreateBootstrapIsReady)
    );
    const normalizedReportedRuntimeGeneration = this.optionalRuntimeGeneration(
      reportedRuntimeGeneration
    );
    const expectedLifecycleRuntimeGeneration =
      resolvedWorkerData?.runtimeGeneration;
    const acceptsIdempotentOnlineDuringLifecycle = Boolean(
      resolvedWorkerData?.lifecycleOperationId &&
      resolvedWorkerData.workerStatusId === EWorkerStatus.online &&
      requestedWorkerStatusId === EWorkerStatus.online &&
      workerStatusId === EWorkerStatus.online &&
      reportedWorkerTypeId === resolvedWorkerData.workerTypeId &&
      (!reportedContainerId ||
        reportedContainerId ===
          resolvedWorkerData.containerId?.trim().toLowerCase()) &&
      normalizedReportedRuntimeGeneration !== undefined &&
      Number.isSafeInteger(expectedLifecycleRuntimeGeneration) &&
      Number(expectedLifecycleRuntimeGeneration) > 0 &&
      normalizedReportedRuntimeGeneration ===
        expectedLifecycleRuntimeGeneration &&
      Boolean(resolvedWorkerData.serverId)
    );
    const acceptsOnlineWhileProvisioning =
      advancesProvisioningOnline || acceptsIdempotentOnlineDuringLifecycle;
    if (
      resolvedWorkerData?.lifecycleOperationId &&
      !acceptsOnlineWhileProvisioning
    ) {
      this.logDebug('service.notify_status.deferred_for_lifecycle', {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: payload.worker_type_id,
        worker_status_id: workerStatusId,
        lifecycle_operation_id: resolvedWorkerData?.lifecycleOperationId,
        runtime_generation: payload.runtime_generation,
        status: payload.status,
        code: payload.code,
        reason: 'lifecycle_operation_pending',
      });
      if (requestedWorkerStatusId === EWorkerStatus.online) {
        throw new WorkerOnlineReadinessRejectedError(
          'lifecycle_operation_pending'
        );
      }
      return;
    }
    if (acceptsOnlineWhileProvisioning) {
      this.logDebug('service.notify_status.online_accepted_during_lifecycle', {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: payload.worker_type_id,
        lifecycle_operation_id:
          resolvedWorkerData?.lifecycleOperationId ?? undefined,
        runtime_generation: payload.runtime_generation,
        status: payload.status,
        code: payload.code,
        reason: acceptsIdempotentOnlineDuringLifecycle
          ? 'same_lifecycle_runtime_online_reacknowledged'
          : 'strong_online_readiness_advances_provisioning',
      });
    }
    const rejectUnacceptedOnlineStatus = (): void => {
      if (
        requestedWorkerStatusId === EWorkerStatus.online &&
        workerStatusId !== EWorkerStatus.online
      ) {
        throw new WorkerOnlineReadinessRejectedError(
          payload.degraded_reason || payload.reason
        );
      }
    };
    this.logDebug('service.notify_status.readiness_gate_result', {
      trace_id: payload.debug_trace_id,
      layer: 'service',
      worker_id: workerId,
      account_id: accountId,
      worker_type_id: payload.worker_type_id,
      requested_worker_status_id: requestedWorkerStatusId,
      worker_status_id: workerStatusId,
      status: payload.status,
      code: payload.code,
      session_ready: payload.session_ready,
      can_send: payload.can_send,
      can_receive_runtime: payload.can_receive_runtime,
      authenticated: payload.authenticated,
      provider_state: payload.provider_state,
      degraded_reason: payload.degraded_reason,
      phone: payload.phone,
      connection_attempt_id: payload.connection_attempt_id,
      runtime_generation: payload.runtime_generation,
    });

    if (
      !resolvedWorkerData?.serverId ||
      !resolvedWorkerData.workerTypeId ||
      !resolvedWorkerData.workerStatusId
    ) {
      this.logDebug('service.notify_status.worker_snapshot_mutation_skipped', {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: payload.worker_type_id,
        requested_worker_status_id: requestedWorkerStatusId,
        worker_status_id: workerStatusId,
        reason: 'worker_snapshot_unavailable_for_fenced_update',
      });
      if (requestedWorkerStatusId === EWorkerStatus.online) {
        throw new WorkerOnlineReadinessRejectedError(
          'worker_snapshot_unavailable'
        );
      }
      return;
    }

    const notificationRuntimeContainerId =
      resolvedWorkerData.runtimeContainerId;
    const restoresDisconnectedRuntimePointer =
      input.disconnected_user === true &&
      DISCONNECTED_USER_RUNTIME_POINTER_STATUSES.has(workerStatusId);
    const notificationControlContainerId =
      restoresDisconnectedRuntimePointer &&
      Object.prototype.hasOwnProperty.call(
        resolvedWorkerData,
        'controlContainerId'
      )
        ? resolvedWorkerData.controlContainerId
        : acceptsOnlineWhileProvisioning &&
            Object.prototype.hasOwnProperty.call(
              resolvedWorkerData,
              'controlContainerId'
            )
          ? resolvedWorkerData.controlContainerId
          : notificationRuntimeContainerId;
    const notificationMutationGuard = {
      lifecycle_operation_id: acceptsOnlineWhileProvisioning
        ? resolvedWorkerData.lifecycleOperationId
        : null,
      server_id: resolvedWorkerData.serverId,
      worker_type_id: resolvedWorkerData.workerTypeId,
      worker_status_id: resolvedWorkerData.workerStatusId,
      ...(notificationRuntimeContainerId && resolvedWorkerData.runtimeGeneration
        ? {
            container_id: notificationControlContainerId,
            runtime_container_id: notificationRuntimeContainerId,
            runtime_generation: resolvedWorkerData.runtimeGeneration,
          }
        : {}),
    };
    const rejectFencedNotification = (): void => {
      this.logDebug('service.notify_status.db_update_fenced', {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: payload.worker_type_id,
        requested_worker_status_id: requestedWorkerStatusId,
        worker_status_id: workerStatusId,
        observed_worker_status_id: resolvedWorkerData.workerStatusId,
        observed_server_id: resolvedWorkerData.serverId,
        observed_worker_type_id: resolvedWorkerData.workerTypeId,
        reason: 'worker_state_changed_or_lifecycle_started',
      });
      if (requestedWorkerStatusId === EWorkerStatus.online) {
        throw new WorkerOnlineReadinessRejectedError(
          'worker_state_changed_or_lifecycle_started'
        );
      }
    };

    if (restoresDisconnectedRuntimePointer) {
      const updateInput: IUpdateWorker = {
        worker_id: workerId,
        worker_status_id: workerStatusId,
        number: null,
        container_id: notificationRuntimeContainerId,
        connection_date: null,
      };

      const updated =
        await this.workerService.updateWorkerByIdIfLifecycleMatches(
          accountId,
          updateInput,
          notificationMutationGuard
        );
      if (!updated) {
        rejectFencedNotification();
        return;
      }
      this.logDebug('service.notify_status.db_update_disconnected_user', {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: payload.worker_type_id,
        worker_status_id: updateInput.worker_status_id,
        status: payload.status,
        code: payload.code,
        number: updateInput.number,
        connection_date: updateInput.connection_date,
        disconnected_user: true,
      });
      await Promise.all([
        this.centrifugoPublish(payload),
        this.centrifugoService.publish(channelsConfigCentrifugo(), payload),
      ]);
      this.logDebug('service.notify_status.disconnected_user_published', {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: payload.worker_type_id,
        connection_attempt_id: payload.connection_attempt_id,
        runtime_generation: payload.runtime_generation,
        status: payload.status,
        code: payload.code,
        reason: payload.reason,
      });

      rejectUnacceptedOnlineStatus();
      return;
    }

    if (
      await this.shouldDeferDisponibleWorkerNotification(
        workerStatusId,
        resolvedWorkerData,
        reportedRuntimeGeneration
      )
    ) {
      rejectUnacceptedOnlineStatus();
      return;
    }

    const staleQrAttemptStatus = await this.shouldIgnoreQrAttemptState(payload);
    if (staleQrAttemptStatus.ignored) {
      this.logDebug('service.notify_status.stale_qr_attempt_skipped', {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: payload.worker_type_id,
        connection_attempt_id: payload.connection_attempt_id,
        runtime_generation: payload.runtime_generation,
        status: payload.status,
        code: payload.code,
        reason: staleQrAttemptStatus.reason,
        has_qrcode: Boolean(payload.qrcode),
        has_pairing_code: Boolean(payload.pairing_code),
        worker_status_id: workerStatusId,
      });
      rejectUnacceptedOnlineStatus();
      return;
    }

    if (
      await this.shouldDeferActivePairingStatusRegression(
        payload,
        workerStatusId,
        resolvedWorkerData
      )
    ) {
      this.logDebug('service.notify_status.pairing_regression_skipped', {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: payload.worker_type_id,
        connection_attempt_id: payload.connection_attempt_id,
        runtime_generation: payload.runtime_generation,
        requested_worker_status_id: requestedWorkerStatusId,
        worker_status_id: workerStatusId,
        observed_worker_status_id: resolvedWorkerData.workerStatusId,
        status: payload.status,
        code: payload.code,
        reason: 'active_pairing_attempt_is_authoritative',
      });
      rejectUnacceptedOnlineStatus();
      return;
    }

    const view =
      await this.workerService.viewWorkerPhoneConnectionDate(workerId);

    const inputPhone = payload.phone?.trim() || null;
    const phoneNumber = inputPhone ?? view?.number ?? null;

    let connectionDate = view?.connection_date;
    if (workerStatusId === EWorkerStatus.online) {
      connectionDate = currentTime();
    }

    const updateInput: IUpdateWorker = {
      worker_id: workerId,
      worker_status_id: workerStatusId,
    };
    if (
      workerStatusId === EWorkerStatus.online &&
      acceptsOnlineWhileProvisioning &&
      notificationRuntimeContainerId
    ) {
      updateInput.container_id = notificationRuntimeContainerId;
    }
    if (workerStatusId !== EWorkerStatus.disponible && phoneNumber) {
      updateInput.number = phoneNumber;
      if (connectionDate) {
        updateInput.connection_date = connectionDate;
      }
    }

    const updated = await this.workerService.updateWorkerByIdIfLifecycleMatches(
      accountId,
      updateInput,
      notificationMutationGuard
    );
    if (!updated) {
      const alreadyApplied = await this.reapplyOnlineNotificationAfterCasMiss({
        workerId,
        accountId,
        requestedWorkerStatusId,
        expected: resolvedWorkerData,
        reportedRuntimeGeneration,
        updateInput,
      });
      if (!alreadyApplied) {
        rejectFencedNotification();
        return;
      }
      this.logDebug('service.notify_status.online_cas_idempotent_ack', {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: payload.worker_type_id,
        worker_status_id: workerStatusId,
        runtime_generation: payload.runtime_generation,
        container_id: payload.container_id,
        reason: 'same_runtime_already_online',
      });
    }
    await this.clearQrAttemptAfterFinishedTerminal(payload);
    await this.clearSelfHealRecoveryAfterNotification(payload, workerStatusId);
    this.logDebug('service.notify_status.db_update', {
      trace_id: payload.debug_trace_id,
      layer: 'service',
      worker_id: workerId,
      account_id: accountId,
      worker_type_id: payload.worker_type_id,
      worker_status_id: workerStatusId,
      status: payload.status,
      code: payload.code,
      session_ready: payload.session_ready,
      phone: phoneNumber,
      previous_phone: view?.number ?? null,
      connection_date: connectionDate,
      previous_connection_date: view?.connection_date ?? null,
      connection_attempt_id: payload.connection_attempt_id,
      runtime_generation: payload.runtime_generation,
    });

    let qrAttemptPublished: boolean | undefined;
    if (shouldPublishAsQrAttempt) {
      qrAttemptPublished = await this.cacheAndPublishQrAttemptState(payload);

      if (qrAttemptPublished) {
        await this.centrifugoService.publish(
          channelsConfigCentrifugo(),
          payload
        );
        this.logDebug('service.notify_status.qr_attempt_published', {
          trace_id: payload.debug_trace_id,
          layer: 'service',
          worker_id: workerId,
          account_id: accountId,
          worker_type_id: payload.worker_type_id,
          connection_attempt_id: payload.connection_attempt_id,
          runtime_generation: payload.runtime_generation,
          status: payload.status,
          code: payload.code,
          reason: payload.reason,
          has_qrcode: Boolean(payload.qrcode),
          has_pairing_code: Boolean(payload.pairing_code),
        });
      }
    } else {
      await Promise.all([
        this.centrifugoPublish(payload),
        this.centrifugoService.publish(channelsConfigCentrifugo(), payload),
      ]);
      this.logDebug('service.notify_status.published', {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: payload.worker_type_id,
        connection_attempt_id: payload.connection_attempt_id,
        runtime_generation: payload.runtime_generation,
        status: payload.status,
        code: payload.code,
        reason: payload.reason,
      });
    }

    rejectUnacceptedOnlineStatus();
  }

  private applyResolvedWorkerDataToNotifyPayload(input: {
    payload: IBaileysConnectionState;
    resolvedWorkerData: ResolvedWorkerDataForContainer | null;
    workerId: string;
    accountId: string;
  }): void {
    const { payload, resolvedWorkerData, workerId, accountId } = input;
    if (!resolvedWorkerData) {
      return;
    }

    payload.worker_type_id ??= resolvedWorkerData.workerTypeId;
    payload.worker_status_id ??= resolvedWorkerData.workerStatusId;
    payload.warm_pool_id ??= resolvedWorkerData.warmPoolId ?? undefined;
    payload.container_id ??= resolvedWorkerData.containerId ?? undefined;
    this.logDebug('service.notify_status.worker_data_resolved', {
      trace_id: payload.debug_trace_id,
      layer: 'service',
      worker_id: workerId,
      account_id: accountId,
      worker_type_id: payload.worker_type_id,
      worker_status_id: payload.worker_status_id,
      status: payload.status,
      code: payload.code,
      connection_attempt_id: payload.connection_attempt_id,
      runtime_generation: payload.runtime_generation,
      container_id: payload.container_id,
      warm_pool_id: payload.warm_pool_id,
    });
  }

  private shouldContinueAfterNotificationRuntimeFences(input: {
    payload: IBaileysConnectionState;
    resolvedWorkerData: ResolvedWorkerDataForContainer | null;
    reportedRuntimeGeneration: number | undefined;
    workerStatusId: EWorkerStatus;
    disconnectedUser: boolean;
    workerId: string;
    accountId: string;
  }): boolean {
    const {
      payload,
      resolvedWorkerData,
      reportedRuntimeGeneration,
      workerStatusId,
      disconnectedUser,
      workerId,
      accountId,
    } = input;
    const connectionDisconnectedAt =
      resolvedWorkerData?.connectionDisconnectedAt ?? null;
    const connectionEpoch = resolvedWorkerData?.connectionEpoch ?? null;
    const disconnectedConnectionEpoch =
      resolvedWorkerData?.disconnectedConnectionEpoch ?? null;
    if (
      connectionDisconnectedAt !== null &&
      connectionEpoch === disconnectedConnectionEpoch
    ) {
      const terminalDisconnectAck =
        workerStatusId === EWorkerStatus.disponible && disconnectedUser;
      this.logDebug('service.notify_status.disconnected_epoch_rejected', {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: payload.worker_type_id,
        runtime_generation: payload.runtime_generation,
        status: payload.status,
        code: payload.code,
        reason: terminalDisconnectAck
          ? 'worker_connection_disconnect_terminal_duplicate'
          : 'worker_connection_disconnect_epoch_stale',
      });
      if (terminalDisconnectAck) {
        return false;
      }
      if (workerStatusId === EWorkerStatus.online) {
        throw new WorkerOnlineReadinessRejectedError(
          'worker_connection_disconnect_epoch_stale'
        );
      }
      return false;
    }

    const staleRuntimeStatus = this.shouldIgnoreStaleRuntimeNotification(
      payload,
      resolvedWorkerData,
      reportedRuntimeGeneration
    );
    if (!staleRuntimeStatus.ignored) {
      return true;
    }

    this.logDebug('service.notify_status.stale_runtime_skipped', {
      trace_id: payload.debug_trace_id,
      layer: 'service',
      worker_id: workerId,
      account_id: accountId,
      worker_type_id: payload.worker_type_id,
      connection_attempt_id: payload.connection_attempt_id,
      runtime_generation: payload.runtime_generation,
      container_id: payload.container_id,
      status: payload.status,
      code: payload.code,
      worker_status_id: workerStatusId,
      reason: staleRuntimeStatus.reason,
      current_runtime_generation: resolvedWorkerData?.runtimeGeneration,
      current_container_id: resolvedWorkerData?.containerId,
    });
    if (workerStatusId === EWorkerStatus.online) {
      throw new WorkerOnlineReadinessRejectedError(
        staleRuntimeStatus.reason ?? 'stale_runtime'
      );
    }
    return false;
  }

  private async reapplyOnlineNotificationAfterCasMiss(input: {
    workerId: string;
    accountId: string;
    requestedWorkerStatusId: EWorkerStatus;
    expected: ResolvedWorkerDataForContainer;
    reportedRuntimeGeneration: unknown;
    updateInput: IUpdateWorker;
  }): Promise<boolean> {
    if (input.requestedWorkerStatusId !== EWorkerStatus.online) {
      return false;
    }

    const expectedContainerId = input.expected.runtimeContainerId?.trim();
    const expectedRuntimeGeneration = input.expected.runtimeGeneration;
    const reportedRuntimeGeneration = this.optionalRuntimeGeneration(
      input.reportedRuntimeGeneration
    );
    if (
      !expectedContainerId ||
      !Number.isSafeInteger(expectedRuntimeGeneration) ||
      Number(expectedRuntimeGeneration) <= 0 ||
      reportedRuntimeGeneration !== expectedRuntimeGeneration
    ) {
      return false;
    }

    let current: ResolvedWorkerDataForContainer | null;
    try {
      current = await this.resolveWorkerDataForContainer(
        input.workerId,
        input.accountId
      );
    } catch {
      return false;
    }

    const currentStatusCanAcceptOnline =
      current?.workerStatusId === EWorkerStatus.online ||
      current?.workerStatusId === EWorkerStatus.disponible ||
      current?.workerStatusId === EWorkerStatus.connecting;
    const currentRuntimeContainerId = current?.runtimeContainerId?.trim();
    const sameRuntimeCanAcceptOnline = Boolean(
      current &&
      current.accountIdResolved === input.accountId &&
      current.serverId === input.expected.serverId &&
      current.workerTypeId === input.expected.workerTypeId &&
      currentStatusCanAcceptOnline &&
      (current.lifecycleOperationId === null ||
        current.lifecycleOperationId === undefined) &&
      (current.connectionDisconnectedAt ?? null) === null &&
      currentRuntimeContainerId === expectedContainerId &&
      current.runtimeGeneration === expectedRuntimeGeneration
    );
    if (!sameRuntimeCanAcceptOnline || !current || !current.workerStatusId) {
      return false;
    }

    try {
      return await this.workerService.updateWorkerByIdIfLifecycleMatches(
        input.accountId,
        input.updateInput,
        {
          lifecycle_operation_id: null,
          container_id: expectedContainerId,
          runtime_container_id: expectedContainerId,
          runtime_generation: expectedRuntimeGeneration,
          server_id: current.serverId,
          worker_type_id: current.workerTypeId,
          worker_status_id: current.workerStatusId,
        }
      );
    } catch {
      return false;
    }
  }

  private async enrichWorkerStatusPayloadWithName(
    payload: IBaileysConnectionState,
    accountId: string,
    workerId: string
  ): Promise<void> {
    try {
      const worker = await this.workerService.viewWorkerNameAndId(
        accountId,
        workerId
      );
      if (worker?.name) {
        payload.worker_name = worker.name;
      }
    } catch {
      // Worker status publication must continue even when display metadata is unavailable.
    }
  }

  private buildNotifyWorkerStatusPayload(
    input: INotifyWorkerStatusRequestProto,
    workerId: string,
    accountId: string,
    workerStatusId: EWorkerStatus
  ): IBaileysConnectionState {
    const payload: IBaileysConnectionState = {
      code: this.normalizeNotifyCode(input.code),
      status: this.normalizeNotifyStatus(input.status),
      worker_id: workerId,
      account_id: accountId,
      worker_type_id: input.worker_type_id
        ? (input.worker_type_id as EWorkerType)
        : undefined,
      worker_status_id: workerStatusId,
      phone: input.phone || undefined,
      disconnected_user: input.disconnected_user ?? undefined,
      connection_attempt_id: input.connection_attempt_id || undefined,
      debug_trace_id: input.debug_trace_id || undefined,
      qrcode: input.qrcode || undefined,
      pairing_code: input.pairing_code || undefined,
      passkey_public_key: input.passkey_public_key || undefined,
      passkey_pending: input.passkey_pending === true ? true : undefined,
      passkey_confirmation_code: input.passkey_confirmation_code || undefined,
      passkey_skip_handoff_ux:
        input.passkey_skip_handoff_ux === true ? true : undefined,
      qr_pending: input.qr_pending === true ? true : undefined,
      qr_generated_at: input.qr_generated_at || undefined,
      reason: input.reason || undefined,
      error: input.error || undefined,
      container_id: input.container_id || undefined,
      warm_pool_id: input.warm_pool_id || undefined,
      session_ready:
        input.session_ready !== undefined
          ? input.session_ready === true
          : undefined,
      can_send:
        input.can_send !== undefined ? input.can_send === true : undefined,
      can_receive_runtime:
        input.can_receive_runtime !== undefined
          ? input.can_receive_runtime === true
          : undefined,
      authenticated:
        input.authenticated !== undefined
          ? input.authenticated === true
          : undefined,
      provider_state: input.provider_state || undefined,
      degraded_reason: input.degraded_reason || undefined,
      last_probe_at: input.last_probe_at || undefined,
    };

    if (input.proxy_status) {
      payload.proxy_status =
        input.proxy_status as IBaileysConnectionState['proxy_status'];
    }
    if (input.proxy_error_code) {
      payload.proxy_error_code = input.proxy_error_code;
    }
    if (input.proxy_fallback) {
      payload.proxy_fallback =
        input.proxy_fallback as IBaileysConnectionState['proxy_fallback'];
    }
    if (input.proxy_bypassed === true) {
      payload.proxy_bypassed = true;
    }
    if (input.is_new_login === true) {
      payload.is_new_login = true;
    }
    const connectionStatus = normalizeWhatsappConnectionStatus(
      input.connection_status
    );
    if (connectionStatus) {
      payload.connection_status = connectionStatus;
    }
    if (
      input.connection_status_source_id &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        input.connection_status_source_id
      )
    ) {
      payload.connection_status_source_id =
        input.connection_status_source_id.toLowerCase();
    }

    const attempt = this.normalizeNotifyOptionalNumber(input.attempt);
    const maxAttempts = this.normalizeNotifyOptionalNumber(input.max_attempts);
    const time = this.normalizeNotifyOptionalNumber(input.time);
    const secondsUntilNextAttempt = this.normalizeNotifyOptionalNumber(
      input.seconds_until_next_attempt
    );
    const timeToFirstQrMs = this.normalizeNotifyOptionalNumber(
      input.time_to_first_qr_ms
    );
    const runtimeGeneration = this.optionalRuntimeGeneration(
      input.runtime_generation
    );
    const probeLatencyMs = this.normalizeNotifyOptionalNumber(
      input.probe_latency_ms
    );

    if (attempt !== undefined) payload.attempt = attempt;
    if (maxAttempts !== undefined) payload.max_attempts = maxAttempts;
    if (time !== undefined) payload.time = time;
    if (secondsUntilNextAttempt !== undefined) {
      payload.seconds_until_next_attempt = secondsUntilNextAttempt;
    }
    if (timeToFirstQrMs !== undefined) {
      payload.time_to_first_qr_ms = timeToFirstQrMs;
    }
    if (runtimeGeneration !== undefined) {
      payload.runtime_generation = runtimeGeneration;
    }
    if (probeLatencyMs !== undefined) {
      payload.probe_latency_ms = probeLatencyMs;
    }
    if (payload.qrcode && payload.qr_pending !== true) {
      payload.qr_pending = false;
    }

    return payload;
  }

  private async enforceOnlineNotificationReadiness(
    payload: IBaileysConnectionState,
    workerStatusId: EWorkerStatus,
    options: { requireRuntimeGenerationMatch?: boolean } = {}
  ): Promise<EWorkerStatus> {
    if (workerStatusId !== EWorkerStatus.online) {
      return workerStatusId;
    }

    const workerType = payload.worker_type_id as EWorkerType | undefined;
    let rejectionReason = 'online_without_session_ready';
    if (workerType) {
      try {
        const health = await this.workerBaileysGrpcClientService.runtimeHealth(
          payload.worker_id,
          { worker_id: payload.worker_id },
          workerType
        );
        this.logDebug('service.notify_status.session_ready_probe_result', {
          trace_id: payload.debug_trace_id,
          layer: 'service',
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          worker_type_id: workerType,
          worker_status_id: workerStatusId,
          status: payload.status,
          code: payload.code,
          session_ready: health?.session_ready,
          can_send: health?.can_send,
          can_receive_runtime: health?.can_receive_runtime,
          authenticated: health?.authenticated,
          provider_state: health?.provider_state,
          degraded_reason: health?.degraded_reason,
          runtime_generation: health?.runtime_generation,
          runtime_state: health?.runtime_state,
          phone: health?.phone,
          kafka_unhealthy: health?.kafka_unhealthy,
          kafka_consumers_ready: health?.kafka_consumers_ready,
          kafka_consumers_authorized: health?.kafka_consumers_authorized,
          connection_attempt_id: payload.connection_attempt_id,
        });

        const runtimeGenerationCompatible =
          options.requireRuntimeGenerationMatch === true
            ? this.hasExpectedRuntimeGeneration(
                health?.runtime_generation,
                payload.runtime_generation ?? 0
              )
            : this.isRuntimeGenerationCompatible(payload, health);
        rejectionReason = runtimeGenerationCompatible
          ? this.resolveOnlineRuntimeHealthRejectionReason(health, workerType)
          : 'runtime_generation_mismatch';
        const dispatchAuthorizationBootstrap =
          runtimeGenerationCompatible &&
          this.isDispatchAuthorizationBootstrapHealth(
            health,
            workerType,
            payload
          );
        if (
          runtimeGenerationCompatible &&
          (this.isConnectedRuntimeHealth(health, workerType, payload.phone) ||
            dispatchAuthorizationBootstrap)
        ) {
          this.applyConnectedRuntimeHealthToPayload(payload, health);
          if (dispatchAuthorizationBootstrap) {
            payload.degraded_reason = undefined;
          }
          this.logDebug(
            'service.notify_status.session_ready_runtime_confirmed',
            {
              trace_id: payload.debug_trace_id,
              layer: 'service',
              worker_id: payload.worker_id,
              account_id: payload.account_id,
              worker_type_id: workerType,
              worker_status_id: workerStatusId,
              status: payload.status,
              code: payload.code,
              session_ready: payload.session_ready,
              can_send: payload.can_send,
              can_receive_runtime: payload.can_receive_runtime,
              authenticated: payload.authenticated,
              phone: payload.phone,
              connection_attempt_id: payload.connection_attempt_id,
              runtime_generation: payload.runtime_generation,
              runtime_health_generation: health?.runtime_generation,
            }
          );
          return workerStatusId;
        }
      } catch (error) {
        rejectionReason = 'runtime_health_probe_failed';
        this.logDebug('service.notify_status.session_ready_probe_failed', {
          trace_id: payload.debug_trace_id,
          layer: 'service',
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          worker_type_id: workerType,
          connection_attempt_id: payload.connection_attempt_id,
          runtime_generation: payload.runtime_generation,
          status: payload.status,
          code: payload.code,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    payload.worker_status_id = EWorkerStatus.disponible;
    payload.status = EBaileysConnectionStatus.connecting;
    payload.code = ECodeMessage.awaitConnection;
    payload.session_ready = false;
    payload.can_send = false;
    payload.can_receive_runtime = false;
    payload.authenticated = false;
    payload.degraded_reason = rejectionReason;

    this.logDebug(
      'service.notify_status.online_rejected_without_session_ready',
      {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        worker_type_id: payload.worker_type_id,
        connection_attempt_id: payload.connection_attempt_id,
        runtime_generation: payload.runtime_generation,
        status: payload.status,
        code: payload.code,
        reason: payload.degraded_reason,
      }
    );

    return EWorkerStatus.disponible;
  }

  private shouldIgnoreStaleRuntimeNotification(
    payload: IBaileysConnectionState,
    current: ResolvedWorkerDataForContainer | null,
    reportedRuntimeGeneration: number | undefined
  ): { ignored: boolean; reason?: string } {
    if (!current) {
      return { ignored: false };
    }

    if (
      payload.worker_type_id &&
      current.workerTypeId &&
      payload.worker_type_id !== current.workerTypeId
    ) {
      return { ignored: true, reason: 'runtime_worker_type_mismatch' };
    }

    if (
      payload.container_id &&
      current.containerId &&
      payload.container_id !== current.containerId
    ) {
      return { ignored: true, reason: 'runtime_container_mismatch' };
    }

    const currentRuntimeGeneration = this.optionalRuntimeGeneration(
      current.runtimeGeneration
    );
    const recreateFenceRequired =
      currentRuntimeGeneration !== undefined &&
      this.isRuntimeGenerationFenceRequired(current);

    if (recreateFenceRequired && reportedRuntimeGeneration === undefined) {
      return { ignored: true, reason: 'runtime_generation_missing' };
    }

    if (
      recreateFenceRequired &&
      reportedRuntimeGeneration !== currentRuntimeGeneration
    ) {
      return { ignored: true, reason: 'runtime_generation_mismatch' };
    }

    if (
      reportedRuntimeGeneration !== undefined &&
      currentRuntimeGeneration !== undefined &&
      reportedRuntimeGeneration < currentRuntimeGeneration
    ) {
      return { ignored: true, reason: 'runtime_generation_stale' };
    }

    return { ignored: false };
  }

  private isRuntimeGenerationFenceRequired(
    current: ResolvedWorkerDataForContainer | null
  ): boolean {
    return Boolean(
      current &&
      (current.workerStatusId === EWorkerStatus.recreating ||
        current.lifecycleOperationId)
    );
  }

  private shouldProbeNonOnlineNotificationReadiness(
    payload: IBaileysConnectionState,
    workerStatusId: EWorkerStatus
  ): boolean {
    if (workerStatusId === EWorkerStatus.online) {
      return false;
    }

    if (!payload.worker_type_id) {
      return false;
    }

    if (payload.disconnected_user === true) {
      return false;
    }

    return !this.isStrongSessionInvalidationNotification(payload);
  }

  private hasActiveSessionEvidence(
    payload: Partial<IBaileysConnectionState>,
    health?: IWorkerRuntimeHealthResponseProto
  ): boolean {
    const providerState = (
      health?.provider_state ??
      payload.provider_state ??
      ''
    )
      .trim()
      .toLowerCase();
    const activeProviderState = ACTIVE_PROVIDER_STATES.has(providerState);

    return (
      payload.authenticated === true ||
      payload.session_ready === true ||
      payload.status === EBaileysConnectionStatus.connected ||
      health?.authenticated === true ||
      health?.session_ready === true ||
      activeProviderState
    );
  }

  private hasStrongFunctionalDegradationEvidence(
    evidence: RuntimeFunctionalEvidence
  ): boolean {
    const degradedState = [
      evidence.provider_state,
      evidence.degraded_reason,
      evidence.reason,
      evidence.error,
    ]
      .filter(Boolean)
      .join(' ')
      .trim()
      .toLowerCase();
    const providerIsFunctionallyDegraded = FUNCTIONAL_DEGRADATION_MARKERS.some(
      (marker) => degradedState.includes(marker)
    );

    return (
      evidence.session_ready === false &&
      (evidence.can_send === false || evidence.can_receive_runtime === false) &&
      (providerIsFunctionallyDegraded ||
        evidence.kafka_unhealthy === true ||
        evidence.kafka_consumers_ready === false ||
        (this.requiresKafkaDispatchAuthorization(evidence) &&
          evidence.kafka_consumers_authorized === false))
    );
  }

  private isStrongSessionInvalidationNotification(
    payload: Partial<IBaileysConnectionState>
  ): boolean {
    return (
      payload.code === ECodeMessage.logoutInProgress ||
      payload.code === ECodeMessage.loggedOut ||
      payload.code === ECodeMessage.forbidden ||
      payload.code === ECodeMessage.connectionReplaced ||
      payload.code === ECodeMessage.badSession ||
      payload.code === ECodeMessage.multideviceMismatch ||
      payload.code === ECodeMessage.phoneNotAvailable
    );
  }

  private applyConnectedRuntimeHealthToPayload(
    payload: IBaileysConnectionState,
    health: IWorkerRuntimeHealthResponseProto
  ): void {
    payload.worker_status_id = EWorkerStatus.online;
    payload.status = EBaileysConnectionStatus.connected;
    payload.code = ECodeMessage.connectionEstablished;
    payload.session_ready = true;
    payload.can_send = health.can_send === true;
    payload.can_receive_runtime = health.can_receive_runtime === true;
    payload.authenticated = health.authenticated === true;
    payload.connection_status = normalizeWhatsappConnectionStatus(
      health.connection_status
    );
    payload.connection_status_source_id = health.connection_status_source_id;
    payload.provider_state = health.provider_state || undefined;
    payload.degraded_reason = health.degraded_reason || undefined;
    payload.last_probe_at = health.last_probe_at || undefined;
    payload.probe_latency_ms = this.normalizeNotifyOptionalNumber(
      health.probe_latency_ms
    );

    const healthPhone = this.normalizeConnectionPhone(health.phone);
    if (healthPhone) {
      payload.phone = healthPhone;
    }
  }

  private async enrichConnectedPayloadFromRuntimeHealth(
    payload: IBaileysConnectionState
  ): Promise<void> {
    if (payload.phone?.trim() || !payload.worker_type_id) {
      return;
    }

    const workerType = payload.worker_type_id as EWorkerType;

    try {
      const health = await this.workerBaileysGrpcClientService.runtimeHealth(
        payload.worker_id,
        { worker_id: payload.worker_id },
        workerType
      );
      this.logDebug('service.notify_status.connected_payload_enrich_result', {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        worker_type_id: workerType,
        status: payload.status,
        code: payload.code,
        session_ready: health?.session_ready,
        provider_state: health?.provider_state,
        phone: health?.phone,
        connection_attempt_id: payload.connection_attempt_id,
      });

      if (this.isConnectedRuntimeHealth(health, workerType, payload.phone)) {
        this.applyConnectedRuntimeHealthToPayload(payload, health);
      }
    } catch (error) {
      this.logDebug('service.notify_status.connected_payload_enrich_failed', {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        worker_type_id: workerType,
        status: payload.status,
        code: payload.code,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async reconcileNonOnlineNotificationReadiness(
    payload: IBaileysConnectionState,
    workerStatusId: EWorkerStatus,
    runtimeFence: {
      currentWorkerStatusId?: EWorkerStatus;
      currentRuntimeGeneration?: number;
      reportedRuntimeGeneration?: number;
    }
  ): Promise<EWorkerStatus | null> {
    const currentRuntimeGeneration = this.optionalRuntimeGeneration(
      runtimeFence.currentRuntimeGeneration
    );
    const reportedRuntimeGeneration = this.optionalRuntimeGeneration(
      runtimeFence.reportedRuntimeGeneration
    );
    const hasCurrentRuntimeFunctionalDegradation = Boolean(
      runtimeFence.currentWorkerStatusId === EWorkerStatus.online &&
      currentRuntimeGeneration &&
      reportedRuntimeGeneration === currentRuntimeGeneration &&
      this.hasStrongFunctionalDegradationEvidence(payload)
    );

    if (
      workerStatusId !== EWorkerStatus.online &&
      payload.disconnected_user !== true &&
      !this.isStrongSessionInvalidationNotification(payload) &&
      this.hasActiveSessionEvidence(payload) &&
      !hasCurrentRuntimeFunctionalDegradation
    ) {
      return null;
    }

    if (
      !this.shouldProbeNonOnlineNotificationReadiness(payload, workerStatusId)
    ) {
      return workerStatusId;
    }

    const workerType = payload.worker_type_id as EWorkerType;

    try {
      const health = await this.workerBaileysGrpcClientService.runtimeHealth(
        payload.worker_id,
        { worker_id: payload.worker_id },
        workerType
      );
      this.logDebug('service.notify_status.non_online_probe_result', {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        worker_type_id: workerType,
        requested_worker_status_id: workerStatusId,
        status: payload.status,
        code: payload.code,
        session_ready: health?.session_ready,
        can_send: health?.can_send,
        can_receive_runtime: health?.can_receive_runtime,
        authenticated: health?.authenticated,
        provider_state: health?.provider_state,
        degraded_reason: health?.degraded_reason,
        runtime_generation: health?.runtime_generation,
        runtime_state: health?.runtime_state,
        phone: health?.phone,
        connection_attempt_id: payload.connection_attempt_id,
      });

      const healthRuntimeGeneration = this.optionalRuntimeGeneration(
        health?.runtime_generation
      );
      const healthMatchesCurrentRuntime =
        !hasCurrentRuntimeFunctionalDegradation ||
        healthRuntimeGeneration === currentRuntimeGeneration;

      if (
        hasCurrentRuntimeFunctionalDegradation &&
        !healthMatchesCurrentRuntime
      ) {
        return null;
      }

      if (!this.isConnectedRuntimeHealth(health, workerType, payload.phone)) {
        if (
          hasCurrentRuntimeFunctionalDegradation &&
          this.hasStrongFunctionalDegradationEvidence(health ?? {})
        ) {
          payload.session_ready = health?.session_ready;
          payload.can_send = health?.can_send;
          payload.can_receive_runtime = health?.can_receive_runtime;
          payload.authenticated = health?.authenticated;
          payload.provider_state = health?.provider_state || undefined;
          payload.degraded_reason = health?.degraded_reason || undefined;
          payload.last_probe_at = health?.last_probe_at || undefined;
          payload.probe_latency_ms = this.normalizeNotifyOptionalNumber(
            health?.probe_latency_ms
          );
          return workerStatusId;
        }
        if (hasCurrentRuntimeFunctionalDegradation) {
          return null;
        }
        if (this.hasActiveSessionEvidence(payload, health)) {
          payload.session_ready = health?.session_ready;
          payload.can_send = health?.can_send;
          payload.can_receive_runtime = health?.can_receive_runtime;
          payload.authenticated = health?.authenticated;
          payload.provider_state = health?.provider_state || undefined;
          payload.degraded_reason = health?.degraded_reason || undefined;
          payload.last_probe_at = health?.last_probe_at || undefined;
          payload.probe_latency_ms = this.normalizeNotifyOptionalNumber(
            health?.probe_latency_ms
          );
          return null;
        }
        return workerStatusId;
      }

      this.applyConnectedRuntimeHealthToPayload(payload, health);
      this.logDebug(
        'service.notify_status.non_online_promoted_by_runtime_health',
        {
          trace_id: payload.debug_trace_id,
          layer: 'service',
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          worker_type_id: workerType,
          requested_worker_status_id: workerStatusId,
          worker_status_id: EWorkerStatus.online,
          status: payload.status,
          code: payload.code,
          session_ready: payload.session_ready,
          can_send: payload.can_send,
          can_receive_runtime: payload.can_receive_runtime,
          authenticated: payload.authenticated,
          provider_state: payload.provider_state,
          degraded_reason: payload.degraded_reason,
          phone: payload.phone,
          connection_attempt_id: payload.connection_attempt_id,
        }
      );

      return EWorkerStatus.online;
    } catch (error) {
      this.logDebug('service.notify_status.non_online_probe_failed', {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        worker_type_id: workerType,
        connection_attempt_id: payload.connection_attempt_id,
        runtime_generation: payload.runtime_generation,
        status: payload.status,
        code: payload.code,
        reason: error instanceof Error ? error.message : String(error),
      });
      /*
       * A strong degradation event from the exact current generation is
       * already fenced by worker/container/runtime identity. If the central
       * probe is temporarily unavailable, retaining ONLINE would turn a
       * confirmed provider/Kafka failure into a false positive indefinitely.
       * Apply the non-online status; a later strict healthy notification can
       * promote the same generation again.
       */
      return workerStatusId;
    }
  }

  private normalizeNotifyCode(code: unknown): ECodeMessage {
    const value = this.normalizeNotifyOptionalNumber(code);
    const validCodes = Object.values(ECodeMessage).filter(
      (candidate): candidate is ECodeMessage => typeof candidate === 'number'
    );

    return value !== undefined && validCodes.includes(value as ECodeMessage)
      ? (value as ECodeMessage)
      : ECodeMessage.info;
  }

  private normalizeNotifyStatus(
    statusValue: unknown
  ): EBaileysConnectionStatus {
    if (
      typeof statusValue === 'string' &&
      Object.values(EBaileysConnectionStatus).includes(
        statusValue as EBaileysConnectionStatus
      )
    ) {
      return statusValue as EBaileysConnectionStatus;
    }

    return EBaileysConnectionStatus.info;
  }

  private normalizeNotifyOptionalNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value) && value !== 0) {
      return value;
    }

    if (typeof value === 'string' && value.trim()) {
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) && parsed !== 0 ? parsed : undefined;
    }

    return undefined;
  }

  private isNotifyQrAttemptState(payload: IBaileysConnectionState): boolean {
    return (
      Boolean(payload.qrcode) ||
      Boolean(payload.pairing_code) ||
      Boolean(payload.passkey_public_key) ||
      Boolean(payload.passkey_confirmation_code) ||
      payload.qr_pending === true ||
      payload.code === ECodeMessage.awaitingReadQrCode ||
      payload.code === ECodeMessage.awaitingPairingCode ||
      payload.code === ECodeMessage.awaitingPasskey ||
      payload.code === ECodeMessage.awaitingPasskeyConfirmation ||
      payload.code === ECodeMessage.pairingInProgress ||
      payload.code === ECodeMessage.newLoginAttempt ||
      isWhatsappQrAttemptExhaustedState(payload)
    );
  }

  private async shouldDeferDisponibleWorkerNotification(
    workerStatusId: EWorkerStatus,
    current: ResolvedWorkerDataForContainer | null,
    reportedRuntimeGeneration: number | undefined
  ): Promise<boolean> {
    if (workerStatusId !== EWorkerStatus.disponible) {
      return false;
    }

    const currentStatus = current?.workerStatusId;

    const lifecyclePending = Boolean(current?.lifecycleOperationId);
    const currentRuntimeGeneration = this.optionalRuntimeGeneration(
      current?.runtimeGeneration
    );
    const authoritativeRecreateNotification =
      currentStatus === EWorkerStatus.recreating &&
      !lifecyclePending &&
      currentRuntimeGeneration !== undefined &&
      reportedRuntimeGeneration === currentRuntimeGeneration;

    if (authoritativeRecreateNotification) {
      return false;
    }

    return (
      currentStatus === EWorkerStatus.creating ||
      currentStatus === EWorkerStatus.recreating
    );
  }

  async resolveIncomingCallAction(
    input: IResolveIncomingCallActionRequestProto
  ): Promise<IResolveIncomingCallActionResponseProto> {
    const workerId = input.worker_id?.trim();
    const accountId = input.account_id?.trim();

    if (!workerId || !accountId) {
      return { ...this.defaultCallAction };
    }

    const worker = await this.workerService.viewWorker(accountId, workerId);
    if (!worker) {
      return { ...this.defaultCallAction };
    }

    const config =
      await this.workerService.viewWorkerConfigFieldsByWorkerId(workerId);
    const showMessageTemplate = config?.show_message_on_call?.trim() ?? '';
    const callJid = input.call_jid?.trim() || null;
    const callPhone = input.call_phone?.trim() || null;
    let showMessageText = showMessageTemplate;

    if (showMessageTemplate.length > 0) {
      try {
        showMessageText = await this.chatService.renderIncomingCallTemplate({
          accountId,
          accountName: worker.account?.name ?? '',
          workerId,
          workerName: worker.name ?? '',
          template: showMessageTemplate,
          callJid,
          callPhone,
        });
      } catch (error) {
        console.error(
          `[WorkerCommandHandler] Error building incoming call message for worker ${workerId}:`,
          error
        );
      }
    }

    return {
      reject_call: Boolean(config?.reject_call),
      show_message_on_call: showMessageText.trim().length > 0,
      show_message_text: showMessageText,
    };
  }

  async getTypingSimulationConfig(
    input: IGetTypingSimulationConfigRequestProto
  ): Promise<IGetTypingSimulationConfigResponseProto> {
    const workerId = input.worker_id?.trim();
    const accountId = input.account_id?.trim();

    if (!workerId || !accountId) {
      return defaultTypingSimulationConfig();
    }

    const worker = await this.workerService.viewWorker(accountId, workerId);
    if (!worker) {
      return defaultTypingSimulationConfig();
    }

    const config =
      await this.workerConfigService.viewTypingSimulation(workerId);
    await this.workerConfigService.refreshTypingSimulationCache(workerId);

    return config;
  }

  async registerS3BackupFallbackUpload(
    input: IRegisterS3BackupFallbackUploadRequestProto
  ): Promise<void> {
    const accountId = input.account_id?.trim();
    const bucket = input.bucket?.trim();
    const objectKey = input.object_key?.trim();

    if (!accountId || !bucket || !objectKey) {
      throw new Error(
        'Missing required fields: account_id, bucket, object_key'
      );
    }

    const parsedSize =
      typeof input.size_bytes === 'number'
        ? input.size_bytes
        : Number.parseInt(input.size_bytes ?? '0', 10);

    if (!Number.isFinite(parsedSize) || parsedSize < 0) {
      throw new Error('Invalid field: size_bytes');
    }

    const primaryAttempts =
      typeof input.primary_attempts === 'number' && input.primary_attempts > 0
        ? Math.trunc(input.primary_attempts)
        : 0;

    const backupAttempts =
      typeof input.backup_attempts === 'number' && input.backup_attempts > 0
        ? Math.trunc(input.backup_attempts)
        : 0;

    await this.s3BackupUploadService.registerFallbackUpload({
      account_id: accountId,
      bucket,
      object_key: objectKey,
      file_name: input.file_name?.trim() || null,
      content_type: input.content_type?.trim() || null,
      size_bytes: Math.trunc(parsedSize),
      primary_attempts: primaryAttempts,
      backup_attempts: backupAttempts,
      primary_error: input.primary_error?.trim() || null,
      backup_error: input.backup_error?.trim() || null,
    });
  }

  async validatePhone(
    input: IPhoneValidationRequest
  ): Promise<IPhoneValidationResponse> {
    const workerId = input.worker_id?.trim();
    const accountId = input.account_id?.trim();
    const phone = input.phone?.trim();
    const phoneDdi = input.phone_ddi?.trim();

    if (!workerId || !accountId || !phone) {
      throw new Error('Missing required fields: worker_id, account_id, phone');
    }

    if (!phoneDdi) {
      throw new Error('Missing required field: phone_ddi');
    }

    const workerType = await this.resolveWorkerTypeForConnection(
      workerId,
      accountId
    );

    return this.workerBaileysGrpcClientService.validatePhone(
      workerId,
      {
        ...input,
        worker_id: workerId,
        account_id: accountId,
        phone,
        phone_ddi: phoneDdi,
      },
      workerType
    );
  }

  async importSecureSession(
    input: ISecureConnectionImportRequest
  ): Promise<IBaileysConnectionState> {
    const workerId = input.worker_id?.trim();
    const accountId = input.account_id?.trim();

    if (!workerId || !accountId || !input.connection_attempt_id) {
      throw new Error(
        'Missing required fields: worker_id, account_id, connection_attempt_id'
      );
    }

    const workerType =
      (input.worker_type_id as EWorkerType | undefined) ??
      (await this.resolveWorkerTypeForConnection(workerId, accountId));

    this.logDebug('service.command_handler.secure_import.start', {
      trace_id: input.debug_trace_id,
      layer: 'service',
      worker_id: workerId,
      account_id: accountId,
      worker_type_id: workerType,
      connection_attempt_id: input.connection_attempt_id,
      runtime_generation: input.runtime_generation,
      target_provider: input.target_provider,
      has_payload_ref: Boolean(input.payload_ref),
      has_payload_json: Boolean(input.payload_json),
    });

    const response =
      await this.workerBaileysGrpcClientService.importSecureSession(
        workerId,
        {
          ...input,
          worker_id: workerId,
          account_id: accountId,
          worker_type_id: workerType ?? input.worker_type_id,
        },
        workerType
      );

    this.logDebug('service.command_handler.secure_import.done', {
      trace_id: response.debug_trace_id ?? input.debug_trace_id,
      layer: 'service',
      worker_id: response.worker_id || workerId,
      account_id: response.account_id || accountId,
      worker_type_id: response.worker_type_id ?? workerType,
      connection_attempt_id:
        response.connection_attempt_id ?? input.connection_attempt_id,
      runtime_generation:
        response.runtime_generation ?? input.runtime_generation,
      status: response.status,
      code: response.code,
      reason: response.reason,
      session_ready: response.session_ready,
      authenticated: response.authenticated,
    });

    return response;
  }

  async prepareSessionStorageMigration(
    input: IPrepareSessionStorageMigrationRequestProto
  ): Promise<IPrepareSessionStorageMigrationResponseProto> {
    const workerId = input.worker_id?.trim();
    if (!workerId || !input.account_id?.trim()) {
      throw new Error('session_storage_migration_identity_missing');
    }
    const workerType = await this.resolveWorkerTypeForConnection(workerId);
    const expectedProvider = workerType
      ? WORKER_TYPE_SOURCE_PROVIDER[workerType]
      : undefined;
    if (
      !workerType ||
      !expectedProvider ||
      input.provider !== expectedProvider
    ) {
      throw new Error('session_storage_migration_provider_mismatch');
    }
    const inspection =
      await this.workerService.inspectContainerWorkerByIdStrict(workerId);
    if (!inspection.exists || !inspection.running || !inspection.container_id) {
      throw new Error('session_storage_migration_source_container_missing');
    }
    const writerIdentity =
      await this.workerService.inspectRuntimeWriterIdentityByContainerIdStrict(
        inspection.container_id
      );
    return this.workerBaileysGrpcClientService.prepareSessionStorageMigration(
      workerId,
      {
        ...input,
        runtime_capability: writerIdentity.runtimeCapability,
      },
      workerType
    );
  }

  async deleteLegacySessionVolume(
    input: ILegacySessionVolumeDeleteRequestProto
  ): Promise<ILegacySessionVolumeDeleteResponseProto> {
    if (
      !input.worker_id ||
      !input.account_id ||
      !/^[0-9a-f-]{36}$/iu.test(input.migration_id) ||
      !input.volume_name ||
      input.volume_name.length > 255 ||
      /[\\/\u0000]/u.test(input.volume_name)
    ) {
      throw new Error('legacy_session_volume_delete_scope_invalid');
    }
    const mounts =
      await this.workerService.listContainerIdsMountingVolumeStrict(
        input.volume_name
      );
    if (mounts.length > 0) {
      throw new Error('legacy_session_volume_still_mounted');
    }
    const before = await this.workerService.inspectVolumeByNameStrict(
      input.volume_name
    );
    if (before.exists) {
      if (!before.signature) {
        throw new Error('legacy_session_volume_signature_missing');
      }
      await this.workerService.removeWorkerVolumeByProof(
        input.volume_name,
        before.signature
      );
    }
    const after = await this.workerService.inspectVolumeByNameStrict(
      input.volume_name
    );
    if (after.exists) {
      throw new Error('legacy_session_volume_delete_unconfirmed');
    }
    return {
      worker_id: input.worker_id,
      migration_id: input.migration_id,
      volume_absent: true,
      mounted_container_count: 0,
    };
  }

  async runtimeHealth(
    input: IWorkerRuntimeHealthRequestProto
  ): Promise<IWorkerRuntimeHealthResponseProto> {
    const workerId = input.worker_id?.trim();
    const warmPoolId = input.warm_pool_id?.trim();
    const requestedWorkerType = input.worker_type_id?.trim();
    const requestedServerId = input.server_id?.trim();

    if (!workerId && !warmPoolId) {
      throw new Error('Missing required fields: worker_id or warm_pool_id');
    }

    this.logDebug('service.command_handler.runtime_health.start', {
      layer: 'service',
      worker_id: workerId,
      warm_pool_id: warmPoolId,
      server_id: requestedServerId,
    });

    if (
      requestedWorkerType &&
      !Object.values(EWorkerType).includes(requestedWorkerType as EWorkerType)
    ) {
      throw new Error('Invalid worker_type_id');
    }

    let workerType: EWorkerType | undefined;
    let runtimeContainerName = workerId ?? '';
    if (workerId) {
      workerType = await this.resolveWorkerTypeForConnection(workerId);
    } else {
      if (!requestedWorkerType || !requestedServerId) {
        throw new Error(
          'Missing required fields for warm RuntimeHealth: worker_type_id, server_id'
        );
      }

      const warm = await this.workerWarmPoolRepository.viewByIdConsistent(
        warmPoolId as string
      );
      if (!warm) {
        throw new Error('warm_runtime_health_identity_rejected:not_found');
      }

      const expectedContainerName = `warm-${warmPoolId}`;
      let identityRejection: string | undefined;
      if (warm.state !== EWorkerWarmPoolState.ready) {
        identityRejection = 'state_not_ready';
      } else if (warm.server_id !== requestedServerId) {
        identityRejection = 'server_id_mismatch';
      } else if (warm.worker_type_id !== requestedWorkerType) {
        identityRejection = 'worker_type_id_mismatch';
      } else if (warm.reserved_by_worker_id || warm.reservation_expires_at) {
        identityRejection = 'reservation_present';
      } else if (
        !warm.container_id ||
        !DOCKER_CONTAINER_ID_PATTERN.test(warm.container_id)
      ) {
        identityRejection = 'container_id_invalid';
      } else if (warm.container_name !== expectedContainerName) {
        identityRejection = 'container_name_mismatch';
      } else if (
        warm.session_storage === EWorkerSessionStorage.legacy_volume &&
        warm.session_volume_name !== expectedContainerName
      ) {
        identityRejection = 'session_volume_name_mismatch';
      } else if (
        warm.session_storage === EWorkerSessionStorage.postgres &&
        warm.session_volume_name !== null
      ) {
        identityRejection = 'postgres_session_volume_forbidden';
      }

      if (identityRejection) {
        throw new Error(
          `warm_runtime_health_identity_rejected:${identityRejection}`
        );
      }

      workerType = warm.worker_type_id as EWorkerType;
      runtimeContainerName = expectedContainerName;
    }

    const response = await this.workerBaileysGrpcClientService.runtimeHealth(
      runtimeContainerName,
      {
        worker_id: workerId,
        warm_pool_id: warmPoolId,
      },
      workerType
    );

    this.logDebug('service.command_handler.runtime_health.done', {
      layer: 'service',
      worker_id: response.worker_id || workerId,
      warm_pool_id: response.warm_pool_id || warmPoolId,
      server_id: requestedServerId,
      resolved_worker_type_id: workerType,
      worker_type_id: response.worker_type_id,
      runtime_generation: response.runtime_generation,
      session_ready: response.session_ready,
      authenticated: response.authenticated,
      can_send: response.can_send,
      can_receive_runtime: response.can_receive_runtime,
      activated: response.activated,
      standby: response.standby,
      provider_state: response.provider_state,
      degraded_reason: response.degraded_reason,
      kafka_unhealthy: response.kafka_unhealthy,
      phone_present: Boolean(response.phone),
      error_present: Boolean(response.error),
    });

    return response;
  }

  private startOnlineConnectionWorkflow(
    payload: StatusConnectionWorkerRequest,
    accountId?: string
  ): void {
    this.stopConnectionRequestRetry(payload.worker_id);

    void this.runWithWorkerLifecycleLock(
      payload.worker_id,
      'change_status_online',
      (leaseContext) =>
        this.runOnlineConnectionWorkflow(payload, accountId, leaseContext)
    ).catch((err) => {
      console.error('Worker online connection workflow failed:', {
        workerId: payload.worker_id,
        accountId,
        error: getErrorMessage(err),
      });

      void this.publishConnectionFailure(payload, accountId).catch(
        (publishErr) => {
          console.error('Failed to publish worker connection failure:', {
            workerId: payload.worker_id,
            accountId,
            error: getErrorMessage(publishErr),
          });
        }
      );
    });
  }

  private async runOnlineConnectionWorkflow(
    payload: StatusConnectionWorkerRequest,
    accountId: string | undefined,
    leaseContext: ILockLeaseContext
  ): Promise<void> {
    leaseContext.assertActive();
    const workerId = payload.worker_id;
    const workerData = await this.resolveWorkerDataForContainer(
      workerId,
      accountId
    );
    const workerType =
      workerData?.workerTypeId ??
      (await this.resolveWorkerTypeForConnection(workerId, accountId));
    await this.publishConnectionIntent(payload, accountId, workerType);
    leaseContext.assertActive();

    const existsContainer =
      await this.workerService.existsContainerWorkerById(workerId);
    if (existsContainer) {
      const requested = await this.tryRequestConnection(
        workerId,
        payload,
        workerType
      );
      if (requested) {
        return;
      }

      const healthy = await this.isExistingContainerHealthy(workerId, {
        maxAttempts: 3,
        delayMs: 1000,
      });
      if (healthy) {
        this.startConnectionRequestRetry(payload);
        return;
      }
    }

    if (!workerData) {
      throw new Error(`Worker data not found for connection: ${workerId}`);
    }

    await this.createWorkerWithPayload(
      workerId,
      workerData,
      payload,
      leaseContext
    );
  }

  private qrAttemptCacheKey(
    workerId: string,
    workerTypeId?: EWorkerType | string
  ): string {
    return workerTypeId
      ? `connection:qrcode:${workerTypeId}:${workerId}:attempt`
      : `connection:qrcode:${workerId}:attempt`;
  }

  private activeQrAttemptKey(
    workerId: string,
    workerTypeId?: EWorkerType | string
  ): string {
    return workerTypeId
      ? `connection:qrcode:${workerTypeId}:${workerId}:active_attempt`
      : `connection:qrcode:${workerId}:active_attempt`;
  }

  private qrGeneratedAtMs(
    state: Partial<IBaileysConnectionState>
  ): number | undefined {
    if (!state.qr_generated_at) {
      return undefined;
    }

    const parsed = Date.parse(state.qr_generated_at);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private qrAgeMs(state: Partial<IBaileysConnectionState>): number | undefined {
    const generatedAtMs = this.qrGeneratedAtMs(state);
    if (generatedAtMs === undefined) {
      return undefined;
    }

    return Math.max(0, Date.now() - generatedAtMs);
  }

  private qrExpiresAt(
    state: Partial<IBaileysConnectionState>
  ): string | undefined {
    const generatedAtMs = this.qrGeneratedAtMs(state);
    if (generatedAtMs === undefined) {
      return undefined;
    }

    return new Date(generatedAtMs + this.qrMaxAgeMs).toISOString();
  }

  private isQrExpired(state: Partial<IBaileysConnectionState>): boolean {
    if (!state.qrcode) {
      return false;
    }

    const ageMs = this.qrAgeMs(state);
    return ageMs === undefined || ageMs >= this.qrMaxAgeMs;
  }

  private qrCacheTtlForState(state: IBaileysConnectionState): number {
    if (!state.qrcode) {
      return this.qrAttemptTtlSeconds;
    }

    const ageMs = this.qrAgeMs(state) ?? 0;
    const remainingSeconds = Math.max(
      1,
      Math.floor((this.qrMaxAgeMs - ageMs) / 1000)
    );

    return Math.min(this.qrCacheTtlSeconds, remainingSeconds);
  }

  private buildPendingStateFromExpiredQr(
    state: IBaileysConnectionState
  ): IBaileysConnectionState {
    const pending: IBaileysConnectionState = {
      ...state,
      code: ECodeMessage.awaitingReadQrCode,
      status: EBaileysConnectionStatus.connecting,
      qr_pending: true,
    };
    delete pending.qrcode;
    delete pending.qr_generated_at;
    delete pending.expires_at;
    return pending;
  }

  private normalizeQrFreshness(
    state: IBaileysConnectionState
  ): IBaileysConnectionState {
    if (
      state.pairing_code ||
      state.passkey_public_key ||
      state.passkey_confirmation_code
    ) {
      const normalized: IBaileysConnectionState = {
        ...state,
        qr_pending: false,
      };
      delete normalized.qrcode;
      delete normalized.qr_generated_at;
      delete normalized.expires_at;
      if (normalized.passkey_public_key) {
        normalized.code = ECodeMessage.awaitingPasskey;
      } else if (normalized.passkey_confirmation_code) {
        normalized.code = ECodeMessage.awaitingPasskeyConfirmation;
      } else if (normalized.pairing_code) {
        normalized.code = ECodeMessage.awaitingPairingCode;
      }
      normalized.status = EBaileysConnectionStatus.connecting;
      return normalized;
    }

    if (!state.qrcode) {
      return state;
    }

    const normalized: IBaileysConnectionState = { ...state };
    normalized.qr_generated_at ??= new Date().toISOString();
    normalized.expires_at ??= this.qrExpiresAt(normalized);

    if (!this.isQrExpired(normalized)) {
      normalized.qr_pending = false;
      return normalized;
    }

    return this.buildPendingStateFromExpiredQr(normalized);
  }

  private async getCachedQrAttemptState(
    workerId: string,
    workerTypeId?: EWorkerType | string
  ): Promise<IBaileysConnectionState | undefined> {
    try {
      const raw = await this.redis.get(
        this.qrAttemptCacheKey(workerId, workerTypeId)
      );
      if (!raw) {
        return undefined;
      }

      const parsed = JSON.parse(raw) as Partial<IBaileysConnectionState>;
      if (!parsed.worker_id || parsed.worker_id !== workerId) {
        return undefined;
      }

      const state = parsed as IBaileysConnectionState;
      if (this.isQrExpired(state)) {
        await this.redis.del(this.qrAttemptCacheKey(workerId, workerTypeId));
        return undefined;
      }

      return state;
    } catch {
      return undefined;
    }
  }

  private isQrAttemptTerminalState(
    state: Partial<IBaileysConnectionState>
  ): boolean {
    return (
      state.status === EBaileysConnectionStatus.connected ||
      state.status === EBaileysConnectionStatus.disconnected ||
      state.disconnected_user === true ||
      state.worker_status_id === EWorkerStatus.online ||
      state.worker_status_id === EWorkerStatus.error ||
      state.worker_status_id === EWorkerStatus.delete ||
      state.code === ECodeMessage.connectionEstablished ||
      state.code === ECodeMessage.logoutInProgress ||
      state.code === ECodeMessage.loggedOut ||
      state.code === ECodeMessage.connectionLost ||
      state.code === ECodeMessage.connectionClosed ||
      state.code === ECodeMessage.connectionReplaced ||
      state.code === ECodeMessage.badSession ||
      state.code === ECodeMessage.multideviceMismatch ||
      state.code === ECodeMessage.phoneNotAvailable
    );
  }

  private isQrAttemptSuccessfulTerminalState(
    state: Partial<IBaileysConnectionState>
  ): boolean {
    return (
      state.status === EBaileysConnectionStatus.connected ||
      state.worker_status_id === EWorkerStatus.online ||
      state.code === ECodeMessage.connectionEstablished
    );
  }

  private isActiveQrAttemptState(
    state: IBaileysConnectionState | undefined
  ): state is IBaileysConnectionState {
    return state !== undefined && !this.isQrAttemptTerminalState(state);
  }

  private async resolveQrRequestPayload(
    input: StatusConnectionWorkerRequest,
    accountId?: string
  ): Promise<{
    payload: StatusConnectionWorkerRequest;
    cachedState?: IBaileysConnectionState;
    shouldReturnCached: boolean;
  }> {
    const workerData = await this.resolveWorkerDataForContainer(
      input.worker_id,
      accountId
    );
    const cached = await this.getCachedQrAttemptState(
      input.worker_id,
      workerData?.workerTypeId
    );
    const cachedIdentityMismatch = cached
      ? this.getCachedQrIdentityMismatchReason(cached, workerData)
      : undefined;
    if (cached && cachedIdentityMismatch) {
      await this.redis.del(
        this.qrAttemptCacheKey(input.worker_id, workerData?.workerTypeId)
      );
      this.logDebug('service.qr_request.cached_state_invalidated', {
        trace_id: input.debug_trace_id,
        layer: 'service',
        worker_id: input.worker_id,
        account_id: accountId,
        worker_type_id: workerData?.workerTypeId,
        runtime_generation: workerData?.runtimeGeneration,
        connection_attempt_id: cached.connection_attempt_id,
        reason: cachedIdentityMismatch,
      });
    }

    const activeCached =
      this.isActiveQrAttemptState(cached) && !cachedIdentityMismatch
        ? cached
        : undefined;
    const connectionAttemptId =
      activeCached?.connection_attempt_id ??
      input.connection_attempt_id ??
      uuidv7();
    const payload: StatusConnectionWorkerRequest = {
      worker_id: input.worker_id,
      status: EWorkerStatus.online,
      type: EBaileysConnectionType.qrcode,
      connection_attempt_id: connectionAttemptId,
      debug_trace_id: input.debug_trace_id,
      runtime_generation:
        input.runtime_generation ?? workerData?.runtimeGeneration,
      warm_pool_id: input.warm_pool_id ?? workerData?.warmPoolId ?? undefined,
    };

    if (!activeCached) {
      this.logDebug('service.qr_request.payload_resolved', {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: payload.worker_id,
        account_id: accountId,
        worker_type_id: workerData?.workerTypeId,
        runtime_generation: payload.runtime_generation,
        connection_attempt_id: payload.connection_attempt_id,
        cached: false,
      });
      return { payload, shouldReturnCached: false };
    }

    if (
      activeCached.qrcode ||
      activeCached.pairing_code ||
      activeCached.passkey_public_key ||
      activeCached.passkey_confirmation_code ||
      activeCached.qr_pending === true
    ) {
      this.logDebug('service.qr_request.cached_state_returnable', {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: payload.worker_id,
        account_id: accountId,
        worker_type_id: activeCached.worker_type_id ?? workerData?.workerTypeId,
        runtime_generation:
          activeCached.runtime_generation ?? payload.runtime_generation,
        connection_attempt_id: payload.connection_attempt_id,
        has_qrcode: Boolean(activeCached.qrcode),
        has_pairing_code: Boolean(activeCached.pairing_code),
        has_passkey_public_key: Boolean(activeCached.passkey_public_key),
        has_passkey_confirmation_code: Boolean(
          activeCached.passkey_confirmation_code
        ),
        qr_pending: activeCached.qr_pending === true,
      });
      return {
        payload,
        cachedState: activeCached,
        shouldReturnCached: true,
      };
    }

    return {
      payload,
      cachedState: activeCached,
      shouldReturnCached: false,
    };
  }

  private getCachedQrIdentityMismatchReason(
    cached: IBaileysConnectionState,
    workerData: ResolvedWorkerDataForContainer | null
  ): string | undefined {
    if (!workerData) {
      return undefined;
    }

    if (!cached.worker_type_id) {
      return 'cached_qr_missing_worker_type';
    }

    if (cached.worker_type_id !== workerData.workerTypeId) {
      return 'cached_qr_worker_type_mismatch';
    }

    if (
      workerData.runtimeGeneration !== undefined &&
      cached.runtime_generation === undefined
    ) {
      return 'cached_qr_missing_runtime_generation';
    }

    if (
      cached.runtime_generation !== undefined &&
      workerData.runtimeGeneration !== undefined &&
      cached.runtime_generation !== workerData.runtimeGeneration
    ) {
      return 'cached_qr_runtime_generation_mismatch';
    }

    return undefined;
  }

  private ensureQrConnectionAttemptId(
    payload: StatusConnectionWorkerRequest
  ): string {
    if (!payload.connection_attempt_id) {
      payload.connection_attempt_id = uuidv7();
    }

    return payload.connection_attempt_id;
  }

  private buildQrPendingState(
    payload: StatusConnectionWorkerRequest,
    accountId: string,
    options: {
      attempt?: number;
      maxAttempts?: number;
      reason?: string;
      runtimeGeneration?: number;
      warmPoolId?: string | null;
      containerId?: string | null;
    } = {}
  ): IBaileysConnectionState {
    return {
      code: ECodeMessage.awaitingReadQrCode,
      status: EBaileysConnectionStatus.connecting,
      worker_id: payload.worker_id,
      account_id: accountId,
      connection_attempt_id: this.ensureQrConnectionAttemptId(payload),
      debug_trace_id: payload.debug_trace_id,
      qr_pending: true,
      reason: options.reason,
      runtime_generation: options.runtimeGeneration,
      warm_pool_id: options.warmPoolId ?? undefined,
      container_id: options.containerId ?? undefined,
      ...(options.attempt !== undefined ? { attempt: options.attempt } : {}),
      ...(options.maxAttempts !== undefined
        ? { max_attempts: options.maxAttempts }
        : {}),
    };
  }

  private buildQrPendingStateFromState(
    state: IBaileysConnectionState,
    payload: StatusConnectionWorkerRequest,
    accountId?: string
  ): IBaileysConnectionState {
    const pending: IBaileysConnectionState = {
      ...state,
      code: ECodeMessage.awaitingReadQrCode,
      status: EBaileysConnectionStatus.connecting,
      worker_id: payload.worker_id,
      account_id: state.account_id || accountId || '',
      connection_attempt_id:
        state.connection_attempt_id ??
        this.ensureQrConnectionAttemptId(payload),
      runtime_generation:
        state.runtime_generation ?? payload.runtime_generation,
      debug_trace_id: state.debug_trace_id ?? payload.debug_trace_id,
      qr_pending: true,
      reason: state.reason ?? 'queued',
    };
    delete pending.qrcode;
    delete pending.pairing_code;
    delete pending.qr_generated_at;
    return pending;
  }

  private buildQrReadyStateFromState(
    state: IBaileysConnectionState,
    payload: StatusConnectionWorkerRequest,
    accountId?: string
  ): IBaileysConnectionState {
    return {
      ...state,
      code: state.code ?? ECodeMessage.awaitingReadQrCode,
      status: state.status ?? EBaileysConnectionStatus.connecting,
      worker_id: payload.worker_id,
      account_id: state.account_id || accountId || '',
      connection_attempt_id:
        state.connection_attempt_id ??
        this.ensureQrConnectionAttemptId(payload),
      runtime_generation:
        state.runtime_generation ?? payload.runtime_generation,
      debug_trace_id: state.debug_trace_id ?? payload.debug_trace_id,
      expires_at: state.expires_at ?? this.qrExpiresAt(state),
      qr_pending: false,
      reason: state.reason ?? 'cached_qr_available',
    };
  }

  private normalizeQrWorkerResponse(
    response: IBaileysConnectionState,
    payload: StatusConnectionWorkerRequest,
    accountId: string,
    workerData?: ResolvedWorkerDataForContainer
  ): IBaileysConnectionState {
    const normalized: IBaileysConnectionState = {
      ...response,
      worker_id: response.worker_id || payload.worker_id,
      account_id: response.account_id || accountId,
      worker_type_id: response.worker_type_id ?? workerData?.workerTypeId,
      worker_status_id: response.worker_status_id ?? workerData?.workerStatusId,
      connection_attempt_id:
        response.connection_attempt_id ??
        this.ensureQrConnectionAttemptId(payload),
      debug_trace_id: response.debug_trace_id ?? payload.debug_trace_id,
      runtime_generation:
        response.runtime_generation ??
        payload.runtime_generation ??
        workerData?.runtimeGeneration,
      warm_pool_id:
        response.warm_pool_id ??
        payload.warm_pool_id ??
        workerData?.warmPoolId ??
        undefined,
      container_id:
        response.container_id ?? workerData?.containerId ?? undefined,
    };

    if (normalized.qrcode) {
      normalized.qr_generated_at ??= new Date().toISOString();
      normalized.expires_at ??= this.qrExpiresAt(normalized);
      normalized.qr_pending = false;
      return normalized;
    }

    if (
      normalized.pairing_code ||
      normalized.passkey_public_key ||
      normalized.passkey_confirmation_code
    ) {
      normalized.qr_pending = false;
      normalized.status = EBaileysConnectionStatus.connecting;
      if (normalized.passkey_public_key) {
        normalized.code = ECodeMessage.awaitingPasskey;
      } else if (normalized.passkey_confirmation_code) {
        normalized.code = ECodeMessage.awaitingPasskeyConfirmation;
      } else if (normalized.pairing_code) {
        normalized.code = ECodeMessage.awaitingPairingCode;
      }
      return normalized;
    }

    if (
      normalized.status !== EBaileysConnectionStatus.connected &&
      normalized.code !== ECodeMessage.connectionEstablished
    ) {
      normalized.qr_pending = true;
      normalized.reason ??= 'worker_response_without_qr';
      normalized.code = ECodeMessage.awaitingReadQrCode;
      normalized.status = EBaileysConnectionStatus.connecting;
    }

    return normalized;
  }

  private async cacheQrAttemptState(
    state: IBaileysConnectionState
  ): Promise<void> {
    const ttlSeconds = this.qrCacheTtlForState(state);
    await this.redis.setex(
      this.qrAttemptCacheKey(state.worker_id, state.worker_type_id),
      ttlSeconds,
      JSON.stringify(state)
    );
  }

  private async getActiveQrAttempt(
    workerId: string,
    workerTypeId?: EWorkerType | string
  ): Promise<ActiveQrAttempt | null> {
    const raw = await this.redis.get(
      this.activeQrAttemptKey(workerId, workerTypeId)
    );
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as ActiveQrAttempt;
      if (!parsed?.ack?.connection_attempt_id) {
        return null;
      }
      return parsed;
    } catch {
      await this.redis.del(this.activeQrAttemptKey(workerId, workerTypeId));
      return null;
    }
  }

  private async claimActiveQrAttempt(
    workerId: string,
    workerTypeId: EWorkerType,
    attempt: ActiveQrAttempt
  ): Promise<boolean> {
    const result = await this.redis.set(
      this.activeQrAttemptKey(workerId, workerTypeId),
      JSON.stringify(attempt),
      'EX',
      this.qrAttemptTtlSeconds,
      'NX'
    );
    return result === 'OK';
  }

  private async clearQrAttemptAfterEnqueueFailure(
    workerId: string,
    workerTypeId: EWorkerType,
    connectionAttemptId?: string
  ): Promise<void> {
    await this.redis.del(this.qrAttemptCacheKey(workerId, workerTypeId));
    if (!connectionAttemptId) {
      return;
    }

    const active = await this.getActiveQrAttempt(workerId, workerTypeId);
    if (active?.ack.connection_attempt_id === connectionAttemptId) {
      await this.redis.del(this.activeQrAttemptKey(workerId, workerTypeId));
    }
  }

  private async clearQrAttemptAfterFinishedTerminal(
    state: IBaileysConnectionState
  ): Promise<void> {
    if (
      (!this.isQrAttemptSuccessfulTerminalState(state) &&
        !isWhatsappQrAttemptExhaustedState(state)) ||
      !state.worker_type_id
    ) {
      return;
    }

    await this.redis.del(
      this.qrAttemptCacheKey(state.worker_id, state.worker_type_id)
    );

    if (!state.connection_attempt_id) {
      return;
    }

    const active = await this.getActiveQrAttempt(
      state.worker_id,
      state.worker_type_id
    );
    if (active?.ack.connection_attempt_id === state.connection_attempt_id) {
      await this.redis.del(
        this.activeQrAttemptKey(state.worker_id, state.worker_type_id)
      );
    }
  }

  private async invalidateQrAttemptState(
    workerId: string,
    options: {
      accountId?: string;
      workerType?: EWorkerType;
      previousWorkerType?: EWorkerType | string;
      reason: string;
      recreateReason?: string;
      debugTraceId?: string;
      runtimeGeneration?: number;
      strict?: boolean;
    },
    leaseContext?: ILockLeaseContext
  ): Promise<void> {
    try {
      leaseContext?.assertActive();
      this.logDebug('service.qr_state.invalidate', {
        trace_id: options.debugTraceId,
        layer: 'service',
        worker_id: workerId,
        account_id: options.accountId,
        worker_type_id: options.workerType,
        reason: options.reason,
        recreate_reason: options.recreateReason,
      });
      const result = await this.redisQueueService.invalidateWorkerState(
        workerId,
        {
          accountId: options.accountId,
          workerTypeId: options.workerType,
          previousWorkerTypeId: options.previousWorkerType,
          reason: options.reason,
          recreateReason: options.recreateReason,
          source: 'worker_command_handler',
          debugTraceId: options.debugTraceId,
          runtimeGeneration: options.runtimeGeneration,
        }
      );
      leaseContext?.assertActive();
      this.logDebug('service.qr_state.invalidated', {
        trace_id: options.debugTraceId,
        layer: 'service',
        worker_id: workerId,
        account_id: options.accountId,
        worker_type_id: options.workerType,
        reason: options.reason,
        recreate_reason: options.recreateReason,
        duration_ms: result.duration_ms,
        deleted_keys: result.deleted_keys,
        scanned_processed_keys: result.scanned_processed_keys,
      });
      if (
        options.strict === true &&
        ((result.group_destroy_timeout_count ?? 0) > 0 ||
          (result.scan_timeout_count ?? 0) > 0 ||
          (result.delete_timeout_count ?? 0) > 0)
      ) {
        throw new Error('worker_qr_state_invalidation_incomplete');
      }
    } catch (error) {
      leaseContext?.assertActive();
      if (options.strict === true) {
        throw error;
      }
    }
  }

  private async cleanupAssignedWarmPoolReferences(
    workerId: string,
    options: {
      currentWarmPoolId?: string | null;
    } = {}
  ): Promise<void> {
    try {
      const deleted =
        await this.workerWarmPoolRepository?.deleteAssignedByWorkerId(
          workerId,
          options.currentWarmPoolId
        );

      if (!deleted) {
        return;
      }
    } catch {}
  }

  private async shouldIgnoreQrAttemptState(
    state: IBaileysConnectionState
  ): Promise<{ ignored: boolean; reason?: string }> {
    const isTerminal = this.isQrAttemptTerminalState(state);
    const isQrAttemptState = this.isNotifyQrAttemptState(state);
    const hasQrCredential = Boolean(
      state.qrcode ||
      state.pairing_code ||
      state.passkey_public_key ||
      state.passkey_confirmation_code
    );
    const qrCredentialConsumed = isWhatsappQrCredentialConsumedState(state);
    const qrAttemptExhausted = isWhatsappQrAttemptExhaustedState(state);
    const allowAttemptMismatch =
      hasQrCredential || this.isQrAttemptSuccessfulTerminalState(state);

    if (state.disconnected_user === true) {
      return { ignored: false };
    }

    if (this.isQrAttemptSuccessfulTerminalState(state)) {
      return { ignored: false };
    }

    if (!isTerminal && !isQrAttemptState) {
      return { ignored: false };
    }

    if (
      (hasQrCredential || qrCredentialConsumed) &&
      (!state.connection_attempt_id || !state.worker_type_id)
    ) {
      return {
        ignored: true,
        reason: !state.connection_attempt_id
          ? 'incoming_connection_attempt_missing'
          : 'incoming_worker_type_missing',
      };
    }

    const active = await this.getActiveQrAttempt(
      state.worker_id,
      state.worker_type_id
    );
    if (active) {
      const activeAttempt = active.ack.connection_attempt_id;
      const incomingAttempt = state.connection_attempt_id;
      const activeRuntimeGeneration =
        active.runtime_generation ?? active.ack.runtime_generation;

      if (
        active.worker_type_id &&
        state.worker_type_id &&
        active.worker_type_id !== state.worker_type_id
      ) {
        return {
          ignored: true,
          reason: 'active_worker_type_mismatch',
        };
      }

      if (
        !isTerminal &&
        state.runtime_generation !== undefined &&
        activeRuntimeGeneration === undefined
      ) {
        return {
          ignored: true,
          reason: 'active_runtime_generation_missing',
        };
      }

      if (activeRuntimeGeneration !== undefined) {
        if (!isTerminal && state.runtime_generation === undefined) {
          return {
            ignored: true,
            reason: 'incoming_runtime_generation_missing',
          };
        }

        if (
          state.runtime_generation !== undefined &&
          activeRuntimeGeneration !== state.runtime_generation
        ) {
          return {
            ignored: true,
            reason: 'active_runtime_generation_mismatch',
          };
        }
      }

      if (!isTerminal && !incomingAttempt) {
        return {
          ignored: true,
          reason: 'incoming_connection_attempt_missing',
        };
      }

      if (activeAttempt && activeAttempt !== incomingAttempt) {
        if (allowAttemptMismatch) {
          return { ignored: false };
        }

        return {
          ignored: true,
          reason: 'active_attempt_mismatch',
        };
      }

      if (!hasQrCredential && !qrCredentialConsumed && !qrAttemptExhausted) {
        const cached = await this.getCachedQrAttemptState(
          state.worker_id,
          state.worker_type_id
        );
        if (
          this.isActiveQrAttemptState(cached) &&
          cached.connection_attempt_id === incomingAttempt &&
          Boolean(cached.qrcode)
        ) {
          return {
            ignored: true,
            reason: 'cached_qr_wins_over_without_qr',
          };
        }
      }

      return { ignored: false };
    }

    const cached = await this.getCachedQrAttemptState(
      state.worker_id,
      state.worker_type_id
    );
    if (!this.isActiveQrAttemptState(cached)) {
      return { ignored: false };
    }

    const cachedAttempt = cached.connection_attempt_id;
    const incomingAttempt = state.connection_attempt_id;

    if (
      cached.worker_type_id &&
      state.worker_type_id &&
      cached.worker_type_id !== state.worker_type_id
    ) {
      return {
        ignored: true,
        reason: 'active_worker_type_mismatch',
      };
    }

    if (
      cached.runtime_generation !== undefined &&
      qrCredentialConsumed &&
      state.runtime_generation === undefined
    ) {
      return {
        ignored: true,
        reason: 'incoming_runtime_generation_missing',
      };
    }

    if (
      cached.runtime_generation !== undefined &&
      state.runtime_generation !== undefined &&
      cached.runtime_generation !== state.runtime_generation
    ) {
      return {
        ignored: true,
        reason: 'active_runtime_generation_mismatch',
      };
    }

    if (cachedAttempt && incomingAttempt && cachedAttempt !== incomingAttempt) {
      if (allowAttemptMismatch) {
        return { ignored: false };
      }

      return {
        ignored: true,
        reason: 'active_attempt_mismatch',
      };
    }

    if (
      cached.qrcode &&
      !hasQrCredential &&
      !qrCredentialConsumed &&
      !qrAttemptExhausted
    ) {
      return {
        ignored: true,
        reason: 'cached_qr_wins_over_without_qr',
      };
    }

    return { ignored: false };
  }

  private async shouldDeferActivePairingStatusRegression(
    state: IBaileysConnectionState,
    requestedWorkerStatusId: EWorkerStatus,
    current: ResolvedWorkerDataForContainer
  ): Promise<boolean> {
    const currentWorkerStatusId = current.workerStatusId;
    const regressesAvailablePairing =
      currentWorkerStatusId === EWorkerStatus.disponible &&
      requestedWorkerStatusId === EWorkerStatus.offline;
    const regressesConsumedPairing =
      currentWorkerStatusId === EWorkerStatus.connecting &&
      (requestedWorkerStatusId === EWorkerStatus.disponible ||
        requestedWorkerStatusId === EWorkerStatus.offline);

    if (!regressesAvailablePairing && !regressesConsumedPairing) {
      return false;
    }

    if (
      state.disconnected_user === true ||
      this.isQrAttemptSuccessfulTerminalState(state) ||
      !state.connection_attempt_id ||
      !state.worker_type_id
    ) {
      return false;
    }

    const active = await this.getActiveQrAttempt(
      state.worker_id,
      state.worker_type_id
    );
    if (!active) {
      return false;
    }

    const activeRuntimeGeneration = this.optionalRuntimeGeneration(
      active.runtime_generation ?? active.ack.runtime_generation
    );
    const reportedRuntimeGeneration = this.optionalRuntimeGeneration(
      state.runtime_generation
    );
    const exactAttempt =
      active.ack.connection_attempt_id === state.connection_attempt_id &&
      active.worker_type_id === state.worker_type_id &&
      current.workerTypeId === state.worker_type_id &&
      (activeRuntimeGeneration === undefined ||
        (reportedRuntimeGeneration !== undefined &&
          activeRuntimeGeneration === reportedRuntimeGeneration));
    if (!exactAttempt) {
      return false;
    }

    const pairingProgressCode =
      state.code === ECodeMessage.newLoginAttempt ||
      state.code === ECodeMessage.awaitingReadQrCode ||
      state.code === ECodeMessage.awaitConnection ||
      state.code === ECodeMessage.awaitingPairingCode ||
      state.code === ECodeMessage.pairingInProgress ||
      state.code === ECodeMessage.awaitingPasskey ||
      state.code === ECodeMessage.awaitingPasskeyConfirmation;
    const recoverableNativeState =
      state.connection_status?.recoverable === true;
    const explicitTerminal =
      this.isQrAttemptTerminalState(state) &&
      state.qr_pending !== true &&
      !pairingProgressCode &&
      !recoverableNativeState;

    return !explicitTerminal;
  }

  private async cacheAndPublishQrAttemptState(
    state: IBaileysConnectionState,
    options: {
      workerType?: EWorkerType;
    } = {}
  ): Promise<boolean> {
    const stateWithIdentity = await this.hydrateQrAttemptIdentity(state);
    if (options.workerType && !stateWithIdentity.worker_type_id) {
      stateWithIdentity.worker_type_id = options.workerType;
    }
    if (
      options.workerType &&
      stateWithIdentity.worker_type_id &&
      stateWithIdentity.worker_type_id !== options.workerType
    ) {
      return false;
    }
    const consumedQrCredential =
      isWhatsappQrCredentialConsumedState(stateWithIdentity);
    const stateForCache: IBaileysConnectionState = consumedQrCredential
      ? {
          ...stateWithIdentity,
          status: EBaileysConnectionStatus.connecting,
          code: ECodeMessage.pairingInProgress,
          qr_pending: false,
        }
      : stateWithIdentity;
    if (consumedQrCredential) {
      delete stateForCache.qrcode;
      delete stateForCache.qr_generated_at;
      delete stateForCache.expires_at;
    }
    const normalizedState = this.normalizeQrFreshness(stateForCache);
    const stale = await this.shouldIgnoreQrAttemptState(normalizedState);
    if (stale.ignored) {
      this.logDebug('service.qr_attempt.cache_skip', {
        trace_id: normalizedState.debug_trace_id,
        layer: 'service',
        worker_id: normalizedState.worker_id,
        account_id: normalizedState.account_id,
        worker_type_id: normalizedState.worker_type_id,
        connection_attempt_id: normalizedState.connection_attempt_id,
        runtime_generation: normalizedState.runtime_generation,
        status: normalizedState.status,
        code: normalizedState.code,
        reason: stale.reason,
        has_qrcode: Boolean(normalizedState.qrcode),
        has_pairing_code: Boolean(normalizedState.pairing_code),
      });
      return false;
    }

    try {
      await this.cacheQrAttemptState(normalizedState);
      this.logDebug('service.qr_attempt.cached', {
        trace_id: normalizedState.debug_trace_id,
        layer: 'service',
        worker_id: normalizedState.worker_id,
        account_id: normalizedState.account_id,
        worker_type_id: normalizedState.worker_type_id,
        connection_attempt_id: normalizedState.connection_attempt_id,
        runtime_generation: normalizedState.runtime_generation,
        status: normalizedState.status,
        code: normalizedState.code,
        reason: normalizedState.reason,
        qr_credential_consumed: consumedQrCredential,
        has_qrcode: Boolean(normalizedState.qrcode),
        has_pairing_code: Boolean(normalizedState.pairing_code),
      });
    } catch {}

    if (normalizedState.account_id) {
      try {
        await this.centrifugoPublish(normalizedState);
        this.logDebug('service.qr_attempt.centrifugo_published', {
          trace_id: normalizedState.debug_trace_id,
          layer: 'service',
          worker_id: normalizedState.worker_id,
          account_id: normalizedState.account_id,
          worker_type_id: normalizedState.worker_type_id,
          connection_attempt_id: normalizedState.connection_attempt_id,
          runtime_generation: normalizedState.runtime_generation,
          status: normalizedState.status,
          code: normalizedState.code,
          reason: normalizedState.reason,
          qr_credential_consumed: consumedQrCredential,
          has_qrcode: Boolean(normalizedState.qrcode),
          has_pairing_code: Boolean(normalizedState.pairing_code),
        });
      } catch {}
    }

    return true;
  }

  private async hydrateQrAttemptIdentity(
    state: IBaileysConnectionState
  ): Promise<IBaileysConnectionState> {
    try {
      const raw = await this.redis.get(
        this.activeQrAttemptKey(state.worker_id, state.worker_type_id)
      );
      if (!raw) {
        return state;
      }

      const parsed = JSON.parse(raw) as {
        ack?: Partial<IBaileysConnectionState>;
        worker_type_id?: EWorkerType;
        runtime_generation?: number | string;
      };
      const ack = parsed.ack;
      if (!ack || ack.worker_id !== state.worker_id) {
        return state;
      }

      const hydrated: IBaileysConnectionState = {
        ...state,
        connection_attempt_id:
          state.connection_attempt_id ?? ack.connection_attempt_id,
        debug_trace_id: state.debug_trace_id ?? ack.debug_trace_id,
        worker_type_id:
          state.worker_type_id ?? ack.worker_type_id ?? parsed.worker_type_id,
        runtime_generation:
          state.runtime_generation ??
          ack.runtime_generation ??
          this.optionalRuntimeGeneration(parsed.runtime_generation),
        warm_pool_id: state.warm_pool_id ?? ack.warm_pool_id,
        container_id: state.container_id ?? ack.container_id,
      };

      return hydrated;
    } catch {
      return state;
    }
  }

  private async runConnectionQrCodeWorkflow(
    payload: StatusConnectionWorkerRequest,
    accountId?: string
  ): Promise<IBaileysConnectionState> {
    const workerId = payload.worker_id;
    this.ensureQrConnectionAttemptId(payload);
    this.logDebug('service.qr_workflow.start', {
      trace_id: payload.debug_trace_id,
      layer: 'service',
      worker_id: workerId,
      account_id: accountId,
      connection_attempt_id: payload.connection_attempt_id,
      runtime_generation: payload.runtime_generation,
      status: payload.status,
      qr_pending: payload.qr_pending === true,
    });
    const workerData = await this.resolveWorkerDataForContainer(
      workerId,
      accountId
    );

    if (!workerData) {
      throw new Error(`Worker data not found for connection: ${workerId}`);
    }

    const pending = this.buildQrPendingState(
      payload,
      workerData.accountIdResolved,
      {
        reason: 'qrcode_redis_stream_start',
        runtimeGeneration: workerData.runtimeGeneration,
        warmPoolId: workerData.warmPoolId,
        containerId: workerData.containerId,
      }
    );
    pending.worker_type_id = workerData.workerTypeId;
    pending.worker_status_id = workerData.workerStatusId;
    this.logDebug('service.qr_workflow.worker_resolved', {
      trace_id: payload.debug_trace_id,
      layer: 'service',
      worker_id: workerId,
      account_id: workerData.accountIdResolved,
      worker_type_id: workerData.workerTypeId,
      connection_attempt_id: pending.connection_attempt_id,
      runtime_generation: workerData.runtimeGeneration,
      status: workerData.workerStatusId,
      container_id: workerData.containerId,
      warm_pool_id: workerData.warmPoolId,
    });

    const streamKey = this.redisQueueService.streamKey(
      workerId,
      workerData.workerTypeId
    );
    const consumerGroup = this.redisQueueService.consumerGroup(
      workerId,
      workerData.workerTypeId
    );
    const activeAttempt: ActiveQrAttempt = {
      ack: pending,
      queued_at: new Date().toISOString(),
      stream_key: streamKey,
      consumer_group: consumerGroup,
      source: 'manager',
      worker_type_id: workerData.workerTypeId,
      runtime_generation: workerData.runtimeGeneration,
    };
    const claimed = await this.claimActiveQrAttempt(
      workerId,
      workerData.workerTypeId,
      activeAttempt
    );
    this.logDebug('service.qr_workflow.active_attempt_claimed', {
      trace_id: payload.debug_trace_id,
      layer: 'service',
      worker_id: workerId,
      account_id: workerData.accountIdResolved,
      worker_type_id: workerData.workerTypeId,
      connection_attempt_id: pending.connection_attempt_id,
      runtime_generation: workerData.runtimeGeneration,
      claimed,
    });
    if (!claimed) {
      const current = await this.getActiveQrAttempt(
        workerId,
        workerData.workerTypeId
      );
      if (current) {
        const currentRuntimeGeneration =
          current.runtime_generation ?? current.ack.runtime_generation;
        if (
          workerData.runtimeGeneration !== undefined &&
          (currentRuntimeGeneration === undefined ||
            currentRuntimeGeneration !== workerData.runtimeGeneration)
        ) {
          await this.redis.del(
            this.activeQrAttemptKey(workerId, workerData.workerTypeId)
          );
        } else {
          this.logDebug('service.qr_workflow.active_attempt_returned', {
            trace_id: payload.debug_trace_id,
            layer: 'service',
            worker_id: workerId,
            account_id: workerData.accountIdResolved,
            worker_type_id: workerData.workerTypeId,
            connection_attempt_id: current.ack.connection_attempt_id,
            runtime_generation:
              current.runtime_generation ?? current.ack.runtime_generation,
            reason: current.ack.reason ?? 'queued',
          });
          return {
            ...current.ack,
            debug_trace_id: payload.debug_trace_id,
            worker_type_id: workerData.workerTypeId,
            worker_status_id: workerData.workerStatusId,
            qr_pending: true,
            qrcode: undefined,
            pairing_code: undefined,
            reason: current.ack.reason ?? 'queued',
          };
        }
      }

      const reclaimed = await this.claimActiveQrAttempt(
        workerId,
        workerData.workerTypeId,
        activeAttempt
      );
      this.logDebug('service.qr_workflow.active_attempt_reclaimed', {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: workerId,
        account_id: workerData.accountIdResolved,
        worker_type_id: workerData.workerTypeId,
        connection_attempt_id: pending.connection_attempt_id,
        runtime_generation: workerData.runtimeGeneration,
        claimed: reclaimed,
      });
      if (!reclaimed) {
        throw new Error('Unable to claim active QR Code attempt.');
      }
    }

    await this.cacheAndPublishQrAttemptState(pending, {
      workerType: workerData.workerTypeId,
    });

    const queueRequest: StatusConnectionWorkerRequest = {
      ...payload,
      status: EWorkerStatus.online,
      type: EBaileysConnectionType.qrcode,
      runtime_generation: workerData.runtimeGeneration,
      warm_pool_id: workerData.warmPoolId ?? undefined,
      qr_pending: true,
    };

    try {
      await this.enqueueQrCodeRedisStream(queueRequest, workerData);
      return pending;
    } catch (err) {
      await this.clearQrAttemptAfterEnqueueFailure(
        workerId,
        workerData.workerTypeId,
        queueRequest.connection_attempt_id
      );
      throw err;
    }
  }

  private async enqueueQrCodeRedisStream(
    payload: StatusConnectionWorkerRequest,
    workerData: ResolvedWorkerDataForContainer
  ): Promise<void> {
    const queuePayload: IWorkerConnectionQrCodeQueueMessage = {
      request_id: uuidv7(),
      connection_attempt_id: this.ensureQrConnectionAttemptId(payload),
      worker_id: payload.worker_id,
      account_id: workerData.accountIdResolved,
      worker_type_id: workerData.workerTypeId,
      runtime_generation: payload.runtime_generation,
      source: 'manager',
      requested_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + this.qrMaxAgeMs).toISOString(),
      debug_trace_id: payload.debug_trace_id,
    };

    this.logDebug('service.qr_workflow.redis_enqueue', {
      trace_id: payload.debug_trace_id,
      layer: 'service',
      worker_id: payload.worker_id,
      account_id: workerData.accountIdResolved,
      worker_type_id: workerData.workerTypeId,
      connection_attempt_id: queuePayload.connection_attempt_id,
      runtime_generation: queuePayload.runtime_generation,
    });
    const streamId = await this.redisQueueService.enqueue(queuePayload);
    this.logDebug('service.qr_workflow.redis_enqueued', {
      trace_id: payload.debug_trace_id,
      layer: 'service',
      worker_id: payload.worker_id,
      account_id: workerData.accountIdResolved,
      worker_type_id: workerData.workerTypeId,
      connection_attempt_id: queuePayload.connection_attempt_id,
      runtime_generation: queuePayload.runtime_generation,
      stream_id: streamId,
    });
  }

  private isWorkerGrpcReadinessRequired(workerType: EWorkerType): boolean {
    return (
      workerType === EWorkerType.baileys ||
      workerType === EWorkerType.wwebjs ||
      workerType === EWorkerType.whatsmeow
    );
  }

  private getExpectedWorkerGrpcPort(
    workerType: EWorkerType
  ): number | undefined {
    if (workerType === EWorkerType.wwebjs) {
      return balanceEnvironment.workerWwebjsGrpcPort;
    }

    if (workerType === EWorkerType.whatsmeow) {
      return balanceEnvironment.workerWhatsmeowGrpcPort;
    }

    if (workerType === EWorkerType.baileys) {
      return balanceEnvironment.workerBaileysGrpcPort;
    }

    return undefined;
  }

  private async waitForWorkerGrpcReady(
    workerId: string,
    workerType: EWorkerType,
    timeoutMs?: number
  ): Promise<string> {
    return this.workerBaileysGrpcClientService.waitForReady(
      workerId,
      workerType,
      timeoutMs
    );
  }

  private async tryRequestConnection(
    workerId: string,
    payload: StatusConnectionWorkerRequest,
    workerType?: EWorkerType
  ): Promise<boolean> {
    try {
      await this.workerBaileysGrpcClientService.requestConnection(
        workerId,
        payload,
        workerType
      );
      return true;
    } catch (err) {
      console.error('Initial worker connection request failed:', {
        workerId,
        workerType,
        error: getErrorMessage(err),
      });
      return false;
    }
  }

  private async isExistingContainerHealthy(
    containerId: string,
    options: ContainerHealthCheckOptions
  ): Promise<boolean> {
    try {
      const result = await this.containerHealthService.checkServiceHealth(
        containerId,
        options
      );
      return result.healthy;
    } catch (err) {
      console.error('Failed to check worker container health:', {
        containerId,
        error: getErrorMessage(err),
      });
      return false;
    }
  }

  private async publishConnectionFailure(
    payload: StatusConnectionWorkerRequest,
    accountId?: string
  ): Promise<void> {
    if (!accountId) {
      return;
    }

    await this.centrifugoPublish({
      status: EBaileysConnectionStatus.disconnected,
      code: ECodeMessage.connectionClosed,
      worker_id: payload.worker_id,
      account_id: accountId,
    });
  }

  private async resolveOnlineRuntimePointerForNotification(
    workerStatusId: EWorkerStatus,
    current: ResolvedWorkerDataForContainer | null,
    payload: IBaileysConnectionState,
    reportedRuntimeGeneration: number | undefined
  ): Promise<ResolvedWorkerDataForContainer | null> {
    if (
      workerStatusId !== EWorkerStatus.online ||
      !current ||
      current.runtimeContainerId
    ) {
      return current;
    }

    try {
      return await this.repairReservedRuntimeContainerPointer(
        current,
        payload,
        reportedRuntimeGeneration
      );
    } catch (error) {
      this.logDebug(
        'service.notify_status.runtime_pointer_repair_failed_closed',
        {
          trace_id: payload.debug_trace_id,
          layer: 'service',
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          worker_type_id: payload.worker_type_id,
          lifecycle_operation_id: current.lifecycleOperationId ?? undefined,
          runtime_generation: reportedRuntimeGeneration,
          reason: getErrorMessage(error),
        }
      );
      return current;
    }
  }

  private assertOnlineRuntimeIdentityAvailable(
    workerStatusId: EWorkerStatus,
    current: ResolvedWorkerDataForContainer | null,
    payload: IBaileysConnectionState
  ): void {
    if (
      workerStatusId !== EWorkerStatus.online ||
      !current ||
      !current.lifecycleOperationId ||
      current.runtimeContainerId
    ) {
      return;
    }

    this.logDebug('service.notify_status.online_runtime_identity_rejected', {
      trace_id: payload.debug_trace_id,
      layer: 'service',
      worker_id: payload.worker_id,
      account_id: payload.account_id,
      worker_type_id: payload.worker_type_id,
      lifecycle_operation_id: current.lifecycleOperationId,
      runtime_generation: payload.runtime_generation,
      reason: 'runtime_container_identity_unavailable',
    });
    throw new WorkerOnlineReadinessRejectedError(
      'runtime_container_identity_unavailable'
    );
  }

  private resolveReservedRuntimeContainerConflict(input: {
    worker: ResolvedWorkerDataForContainer;
    runtime: IWorkerRuntime;
    inspection: WorkerContainerInspection;
    containerId: string;
    lifecycleOperationId: string;
    runtimeGeneration: number;
    reportedContainerId?: string;
  }): string | undefined {
    const {
      worker,
      runtime,
      inspection,
      containerId,
      lifecycleOperationId,
      runtimeGeneration,
      reportedContainerId,
    } = input;
    const labels = inspection.container_labels ?? {};
    const env = inspection.container_env ?? {};
    const workerId = runtime.worker_id;
    const expectedImage = getImageWorker(worker.workerTypeId);
    const expectedGrpcPort = this.getExpectedWorkerGrpcPort(
      worker.workerTypeId
    );
    const expectedSourceProvider =
      WORKER_TYPE_SOURCE_PROVIDER[worker.workerTypeId];
    const runtimeSourceProvider = runtime.source_provider?.trim().toLowerCase();
    const imageContentId = inspection.container_image_id?.trim().toLowerCase();
    const labelledImageContentId = labels['underchat.worker_image_content_id']
      ?.trim()
      .toLowerCase();
    const appDataMounts = (inspection.container_mounts ?? []).filter(
      (mount) => mount.destination === '/app/data'
    );
    const warmPoolId = runtime.warm_pool_id?.trim();
    const postgresWarmLineage = Boolean(
      runtime.session_storage === EWorkerSessionStorage.postgres &&
      runtime.session_volume_name === null &&
      /^[0-9a-f]{64}$/u.test(runtime.runtime_capability_hash ?? '') &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
        runtime.session_writer_epoch ?? ''
      ) &&
      warmPoolId &&
      labels['underchat.warm_pool_id'] === warmPoolId &&
      env.WARM_POOL_ID === warmPoolId &&
      labels['underchat.warm_standby'] === 'true' &&
      env.WARM_STANDBY === 'true' &&
      labels['underchat.worker_id'] === undefined &&
      labels['underchat.account_id'] === undefined &&
      labels['underchat.runtime_generation'] === undefined &&
      env.WORKER_ID === undefined &&
      env.ACCOUNT_ID === undefined &&
      env.RUNTIME_GENERATION === undefined
    );
    const warmIdentityMatches = warmPoolId
      ? postgresWarmLineage ||
        (labels['underchat.warm_pool_id'] === warmPoolId &&
          env.WARM_POOL_ID === warmPoolId &&
          labels['underchat.warm_standby'] === 'false' &&
          env.WARM_STANDBY === 'false')
      : labels['underchat.warm_pool_id'] === undefined &&
        env.WARM_POOL_ID === undefined &&
        labels['underchat.warm_standby'] !== 'true' &&
        env.WARM_STANDBY !== 'true';

    if (!inspection.exists) return 'container_missing';
    if (!DOCKER_CONTAINER_ID_PATTERN.test(containerId)) {
      return 'container_id_invalid';
    }
    if (inspection.container_id?.trim().toLowerCase() !== containerId) {
      return 'container_id_changed';
    }
    if (reportedContainerId && reportedContainerId !== containerId) {
      return 'reported_container_id_mismatch';
    }
    if (inspection.running !== true) return 'container_not_running';
    if (inspection.container_name !== workerId) return 'container_name';
    if (
      (!postgresWarmLineage && labels['underchat.worker_id'] !== workerId) ||
      (!postgresWarmLineage && env.WORKER_ID !== workerId)
    ) {
      return 'worker_id';
    }
    if (
      (!postgresWarmLineage &&
        labels['underchat.account_id'] !== worker.accountIdResolved) ||
      (!postgresWarmLineage && env.ACCOUNT_ID !== worker.accountIdResolved)
    ) {
      return 'account_id';
    }
    if (labels['underchat.server_id'] !== worker.serverId) {
      return 'server_id';
    }
    if (
      !expectedSourceProvider ||
      (runtimeSourceProvider &&
        runtimeSourceProvider !== expectedSourceProvider)
    ) {
      return 'source_provider';
    }
    if (
      labels['underchat.worker_type_id'] !== worker.workerTypeId ||
      env.WORKER_TYPE_ID !== worker.workerTypeId
    ) {
      return 'worker_type_id';
    }
    if (
      (!postgresWarmLineage &&
        labels['underchat.runtime_generation'] !== String(runtimeGeneration)) ||
      (!postgresWarmLineage &&
        env.RUNTIME_GENERATION !== String(runtimeGeneration))
    ) {
      return 'runtime_generation';
    }
    if (
      !postgresWarmLineage &&
      labels['underchat.lifecycle_operation_id'] !== lifecycleOperationId
    ) {
      return 'lifecycle_operation_id';
    }
    if (
      labels['underchat.session_storage'] !== runtime.session_storage ||
      env.WORKER_SESSION_STORAGE !== runtime.session_storage
    ) {
      return 'session_storage';
    }
    if (runtime.session_storage === EWorkerSessionStorage.postgres) {
      if (
        runtime.session_volume_name !== null ||
        labels['underchat.session_volume_name'] !== undefined ||
        env.SESSION_VOLUME_NAME !== undefined ||
        appDataMounts.length !== 0
      ) {
        return 'postgres_session_backend';
      }
    } else if (
      !runtime.session_volume_name ||
      labels['underchat.session_volume_name'] !== runtime.session_volume_name ||
      env.SESSION_VOLUME_NAME !== runtime.session_volume_name
    ) {
      return 'session_volume_name';
    }
    if (
      inspection.container_image !== expectedImage ||
      labels['underchat.worker_image'] !== expectedImage ||
      env.WORKER_IMAGE !== expectedImage
    ) {
      return 'worker_image';
    }
    if (
      !imageContentId ||
      !/^sha256:[0-9a-f]{64}$/u.test(imageContentId) ||
      labelledImageContentId !== imageContentId
    ) {
      return 'worker_image_content_id';
    }
    if (
      expectedGrpcPort !== undefined &&
      (labels['underchat.worker_grpc_port'] !== String(expectedGrpcPort) ||
        env.WORKER_GRPC_PORT !== String(expectedGrpcPort))
    ) {
      return 'worker_grpc_port';
    }
    if (!warmIdentityMatches) return 'warm_identity';
    if (
      runtime.session_storage === EWorkerSessionStorage.legacy_volume &&
      (appDataMounts.length !== 1 ||
        appDataMounts[0].type !== 'volume' ||
        appDataMounts[0].name !== runtime.session_volume_name ||
        appDataMounts[0].read_write !== true)
    ) {
      return 'session_mount';
    }
    return undefined;
  }

  /**
   * Removal can safely force-delete a stopped, exited or paused container once
   * every immutable identity and the exclusive volume mount still match. The
   * online-notification proof above deliberately keeps requiring `running`.
   */
  private resolveReservedRuntimeContainerRemovalConflict(input: {
    worker: ResolvedWorkerDataForContainer;
    runtime: IWorkerRuntime;
    inspection: WorkerContainerInspection;
    containerId: string;
    lifecycleOperationId: string;
    runtimeGeneration: number;
  }): string | undefined {
    return this.resolveReservedRuntimeContainerConflict({
      ...input,
      inspection: {
        ...input.inspection,
        running: input.inspection.exists ? true : input.inspection.running,
      },
    });
  }

  private async repairReservedRuntimeContainerPointer(
    current: ResolvedWorkerDataForContainer,
    payload: IBaileysConnectionState,
    reportedRuntimeGeneration: number | undefined
  ): Promise<ResolvedWorkerDataForContainer> {
    const lifecycleOperationId = current.lifecycleOperationId?.trim();
    const runtimeGeneration = this.optionalRuntimeGeneration(
      reportedRuntimeGeneration
    );
    const canRepair = Boolean(
      this.workerRuntimeRepository &&
      typeof this.workerRuntimeRepository.claimReservedRuntimeContainer ===
        'function' &&
      lifecycleOperationId &&
      WORKER_TYPE_SOURCE_PROVIDER[current.workerTypeId] &&
      (current.workerStatusId === EWorkerStatus.creating ||
        current.workerStatusId === EWorkerStatus.recreating) &&
      (!payload.worker_type_id ||
        payload.worker_type_id === current.workerTypeId) &&
      runtimeGeneration &&
      runtimeGeneration === current.runtimeGeneration
    );
    if (!canRepair || !lifecycleOperationId || !runtimeGeneration) {
      return current;
    }

    const runtime = await this.viewWorkerRuntimeConsistent(payload.worker_id);
    if (!runtime) return current;
    if (runtime.container_id) {
      return (
        (await this.resolveWorkerDataForContainer(
          payload.worker_id,
          payload.account_id
        )) ?? current
      );
    }
    if (runtime.session_storage === EWorkerSessionStorage.postgres) {
      return current;
    }
    if (
      runtime.worker_id !== payload.worker_id ||
      runtime.container_name !== payload.worker_id ||
      !runtime.session_volume_name ||
      runtime.runtime_generation !== runtimeGeneration ||
      (runtime.warm_pool_id ?? null) !== (current.warmPoolId ?? null)
    ) {
      return current;
    }

    const mountedContainerIds =
      await this.workerService.listContainerIdsMountingVolumeStrict(
        runtime.session_volume_name
      );
    if (mountedContainerIds.length !== 1) {
      this.logDebug('service.notify_status.runtime_pointer_repair_skipped', {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        worker_type_id: payload.worker_type_id,
        lifecycle_operation_id: lifecycleOperationId,
        runtime_generation: runtimeGeneration,
        reason:
          mountedContainerIds.length === 0
            ? 'session_volume_has_no_container'
            : 'session_volume_has_multiple_containers',
      });
      return current;
    }

    const containerId = mountedContainerIds[0];
    const inspection =
      await this.workerService.inspectContainerWorkerByIdStrict(containerId);
    const conflict = this.resolveReservedRuntimeContainerConflict({
      worker: current,
      runtime,
      inspection,
      containerId,
      lifecycleOperationId,
      runtimeGeneration,
      reportedContainerId: payload.container_id?.trim().toLowerCase(),
    });
    if (conflict) {
      this.logDebug('service.notify_status.runtime_pointer_repair_skipped', {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        worker_type_id: payload.worker_type_id,
        lifecycle_operation_id: lifecycleOperationId,
        runtime_generation: runtimeGeneration,
        container_id: containerId,
        reason: conflict,
      });
      return current;
    }

    const claimed =
      await this.workerRuntimeRepository.claimReservedRuntimeContainer({
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        server_id: current.serverId,
        worker_type_id: current.workerTypeId,
        lifecycle_operation_id: lifecycleOperationId,
        expected_worker_status_id: current.workerStatusId as EWorkerStatus,
        container_id: containerId,
        container_name: payload.worker_id,
        session_storage: runtime.session_storage,
        session_volume_name: runtime.session_volume_name,
        runtime_generation: runtimeGeneration,
        warm_pool_id: runtime.warm_pool_id,
        source_provider: runtime.source_provider,
      });
    let refreshed = await this.resolveWorkerDataForContainer(
      payload.worker_id,
      payload.account_id
    );
    let reconciled = Boolean(
      refreshed?.runtimeContainerId === containerId &&
      refreshed.runtimeGeneration === runtimeGeneration
    );
    if (
      reconciled &&
      current.workerStatusId === EWorkerStatus.recreating &&
      (refreshed?.recreateBootstrapOperationId !== lifecycleOperationId ||
        refreshed.recreateBootstrapRuntimeGeneration !== runtimeGeneration ||
        refreshed.recreateBootstrapContainerId?.trim().toLowerCase() !==
          containerId)
    ) {
      /*
       * Recover the narrow crash window where Docker started the exact
       * lifecycle-labelled legacy-volume runtime before its reserved pointer
       * and bootstrap marker were committed. The database function repeats
       * every worker/runtime fence atomically, so an old container cannot use
       * this repair path to authorize itself for a newer recreation.
       */
      await this.workerRuntimeRepository.markRecreateBootstrapStarted({
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        server_id: current.serverId,
        lifecycle_operation_id: lifecycleOperationId,
        runtime_generation: runtimeGeneration,
        container_id: containerId,
      });
      refreshed = await this.resolveWorkerDataForContainer(
        payload.worker_id,
        payload.account_id
      );
      reconciled = Boolean(
        refreshed?.runtimeContainerId === containerId &&
        refreshed.runtimeGeneration === runtimeGeneration
      );
    }
    this.logDebug('service.notify_status.runtime_pointer_repair_result', {
      trace_id: payload.debug_trace_id,
      layer: 'service',
      worker_id: payload.worker_id,
      account_id: payload.account_id,
      worker_type_id: payload.worker_type_id,
      lifecycle_operation_id: lifecycleOperationId,
      runtime_generation: runtimeGeneration,
      container_id: containerId,
      reason: reconciled
        ? claimed
          ? 'reserved_runtime_claimed'
          : 'concurrent_runtime_claim_confirmed'
        : 'runtime_claim_not_confirmed',
    });
    return refreshed ?? current;
  }

  private async resolveWorkerDataForContainer(
    workerId: string,
    accountId?: string
  ): Promise<ResolvedWorkerDataForContainer | null> {
    const attachRuntime = async (
      data: ResolvedWorkerDataForContainer | null
    ): Promise<ResolvedWorkerDataForContainer | null> => {
      if (!data || !this.workerRuntimeRepository) {
        return data;
      }

      const runtime = await this.viewWorkerRuntimeConsistent(workerId);
      if (!runtime) {
        return data;
      }

      return {
        ...data,
        runtimeContainerId: runtime.container_id,
        containerId:
          runtime.container_id ?? data.runtimeContainerId ?? data.containerId,
        runtimeGeneration: runtime.runtime_generation,
        warmPoolId: runtime.warm_pool_id,
        recreateBootstrapOperationId: runtime.recreate_bootstrap_operation_id,
        recreateBootstrapRuntimeGeneration:
          runtime.recreate_bootstrap_runtime_generation,
        recreateBootstrapContainerId: runtime.recreate_bootstrap_container_id,
        recreateBootstrapStartedAt: runtime.recreate_bootstrap_started_at,
        recreateRetiredOperationId: runtime.recreate_retired_operation_id,
        recreateRetiredRuntimeGeneration:
          runtime.recreate_retired_runtime_generation,
        recreateRetiredContainerId: runtime.recreate_retired_container_id,
        recreateRetiredAt: runtime.recreate_retired_at,
        connectionEpoch: runtime.connection_epoch,
        disconnectedConnectionEpoch: runtime.disconnected_connection_epoch,
        connectionDisconnectedAt: runtime.connection_disconnected_at,
      };
    };

    const fromMonitor = await this.resolveWorkerDataFromMonitor(workerId);
    if (fromMonitor) {
      if (accountId && fromMonitor.accountIdResolved !== accountId) {
        return null;
      }

      const fromView = accountId
        ? await this.resolveWorkerDataFromView(accountId, workerId).catch(
            () => null
          )
        : null;
      return attachRuntime({
        ...fromMonitor,
        ...(fromView?.serverId === fromMonitor.serverId
          ? {
              serverName: fromView.serverName,
              serverWebDomain: fromView.serverWebDomain,
            }
          : {}),
        ...(fromView?.workerTypeId === fromMonitor.workerTypeId
          ? { workerTypeName: fromView.workerTypeName }
          : {}),
      });
    }

    return null;
  }

  private async resolveWorkerDataFromView(
    accountId: string,
    workerId: string
  ): Promise<ResolvedWorkerDataForContainer | null> {
    const view = await this.workerService.viewWorker(accountId, workerId);
    if (!view?.server?.id || !view?.type?.id) {
      return null;
    }

    return {
      accountIdResolved: accountId,
      serverId: view.server.id,
      serverName: view.server.name ?? undefined,
      workerTypeId: view.type.id as EWorkerType,
      workerTypeName: view.type.name ?? undefined,
      workerStatusId: view.status?.id as EWorkerStatus | undefined,
    };
  }

  private async resolveWorkerDataFromMonitor(
    workerId: string
  ): Promise<ResolvedWorkerDataForContainer | null> {
    const monitorView = await this.viewWorkerForMonitorConsistent(workerId);
    if (
      !monitorView?.account_id ||
      !monitorView?.server_id ||
      !monitorView?.worker_type_id ||
      monitorView.deleted_at
    ) {
      return null;
    }

    return {
      accountIdResolved: monitorView.account_id,
      serverId: monitorView.server_id,
      workerTypeId: monitorView.worker_type_id as EWorkerType,
      workerStatusId: monitorView.worker_status_id as EWorkerStatus,
      controlContainerId: monitorView.container_id,
      runtimeContainerId: monitorView.runtime_container_id,
      containerId: monitorView.runtime_container_id ?? monitorView.container_id,
      lifecycleOperationId: monitorView.lifecycle_operation_id,
    };
  }

  private async isLifecycleOperationCurrent(
    data: IWorkerPayload,
    options: {
      allowServerMismatch?: boolean;
      allowWorkerTypeMismatch?: boolean;
    } = {},
    validateSessionStorage = false
  ): Promise<boolean> {
    const current = await this.viewWorkerForMonitorConsistent(data.worker_id);
    const currentOperationId = current?.lifecycle_operation_id ?? null;
    const expectedOperationId = data.lifecycle_operation_id?.trim() || null;
    const operationMatches = currentOperationId === expectedOperationId;
    const accountMatches = current?.account_id === data.account_id;
    const serverMatches =
      options.allowServerMismatch === true ||
      !data.server_id ||
      current?.server_id === data.server_id;
    let workerTypeMatches =
      options.allowWorkerTypeMismatch === true ||
      !data.worker_type_id ||
      current?.worker_type_id === data.worker_type_id;
    if (
      !workerTypeMatches &&
      current &&
      (await this.isPostgresProviderHandoffTargetAuthorized(data, current))
    ) {
      workerTypeMatches = true;
    }
    const deletionBlocksEffect =
      data.action !== EWorkerAction.delete &&
      (current?.worker_status_id === EWorkerStatus.deleting ||
        current?.worker_status_id === EWorkerStatus.delete);

    const isCurrent = Boolean(
      current &&
      !current.deleted_at &&
      !deletionBlocksEffect &&
      operationMatches &&
      accountMatches &&
      serverMatches &&
      workerTypeMatches
    );

    if (!isCurrent) {
      return false;
    }

    /*
     * Rolling service-api instances predating WorkerPayload.session_storage
     * can still omit the field. Reuse the primary lifecycle snapshot only
     * after it has proved that this operation is current, then cross-check the
     * current runtime backend before any provider or Docker effect. Stale
     * lifecycle commands remain idempotent no-ops.
     */
    if (validateSessionStorage) {
      await this.hydrateAuthoritativeSessionStorageIfMissing(data, current);
    }

    return true;
  }

  private async isPostgresProviderHandoffTargetAuthorized(
    data: IWorkerPayload,
    current: IWorkerMonitor
  ): Promise<boolean> {
    if (
      data.action !== EWorkerAction.recreate ||
      !data.worker_type_id ||
      !data.lifecycle_operation_id ||
      data.remove_session === true ||
      data.remove_volume === true ||
      (current.session_storage ?? EWorkerSessionStorage.legacy_volume) !==
        EWorkerSessionStorage.postgres ||
      current.lifecycle_operation_id !== data.lifecycle_operation_id ||
      current.worker_status_id !== EWorkerStatus.recreating ||
      typeof this.workerRuntimeRepository
        ?.isWhatsappProviderHandoffTargetAuthorized !== 'function'
    ) {
      return false;
    }
    return this.workerRuntimeRepository.isWhatsappProviderHandoffTargetAuthorized(
      {
        worker_id: data.worker_id,
        account_id: data.account_id,
        lifecycle_operation_id: data.lifecycle_operation_id,
        target_worker_type_id: data.worker_type_id,
      }
    );
  }

  private async isPostgresProviderHandoffTargetPendingSourceDrain(
    data: IWorkerPayload
  ): Promise<boolean> {
    if (
      data.action !== EWorkerAction.recreate ||
      data.session_storage !== EWorkerSessionStorage.postgres ||
      data.remove_session !== false ||
      data.remove_volume !== false ||
      !data.worker_type_id ||
      !data.previous_worker_type_id ||
      !data.lifecycle_operation_id ||
      data.worker_type_id === data.previous_worker_type_id ||
      typeof this.workerRuntimeRepository
        ?.viewWhatsappProviderHandoffLifecycleContext !== 'function'
    ) {
      return false;
    }

    const current = await this.viewWorkerForMonitorConsistent(data.worker_id);
    if (
      !current ||
      current.deleted_at ||
      current.account_id !== data.account_id ||
      current.server_id !== data.server_id ||
      current.lifecycle_operation_id !== data.lifecycle_operation_id ||
      current.worker_status_id !== EWorkerStatus.recreating ||
      current.worker_type_id !== data.previous_worker_type_id ||
      current.session_storage !== EWorkerSessionStorage.postgres
    ) {
      return false;
    }

    const context =
      await this.workerRuntimeRepository.viewWhatsappProviderHandoffLifecycleContext(
        {
          worker_id: data.worker_id,
          account_id: data.account_id,
          lifecycle_operation_id: data.lifecycle_operation_id,
        }
      );
    const sourceProvider =
      WORKER_TYPE_SOURCE_PROVIDER[data.previous_worker_type_id];
    const targetProvider = WORKER_TYPE_SOURCE_PROVIDER[data.worker_type_id];
    return Boolean(
      context &&
      sourceProvider &&
      targetProvider &&
      context.lifecycle_operation_id === data.lifecycle_operation_id &&
      context.source_provider === sourceProvider &&
      context.target_provider === targetProvider &&
      (context.state === 'requested' || context.state === 'draining')
    );
  }

  /**
   * Re-proves terminal handoff ownership only after this handler owns the exact
   * worker lifecycle mutex and before either target recreation or source
   * cleanup. This closes the consumer's final DB-read-to-gRPC race: once the
   * proof is absent under the mutex, no compliant handoff or recovery path can
   * terminalize the same lifecycle concurrently.
   */
  private async suppressTerminalWhatsappProviderHandoffEffect(
    data: IWorkerPayload,
    leaseContext: ILockLeaseContext
  ): Promise<boolean> {
    const sourceProvider = data.previous_worker_type_id
      ? WORKER_TYPE_SOURCE_PROVIDER[data.previous_worker_type_id]
      : undefined;
    const targetProvider = data.worker_type_id
      ? WORKER_TYPE_SOURCE_PROVIDER[data.worker_type_id]
      : undefined;
    const sessionPreservingWhatsappLifecycle = Boolean(
      data.session_storage === EWorkerSessionStorage.postgres &&
      data.remove_session === false &&
      data.remove_volume === false &&
      data.lifecycle_operation_id?.trim() &&
      sourceProvider &&
      targetProvider
    );
    const potentialProviderHandoff = Boolean(
      sessionPreservingWhatsappLifecycle &&
      ((data.action === EWorkerAction.recreate &&
        sourceProvider !== targetProvider) ||
        data.action === EWorkerAction.cleanup)
    );
    if (!potentialProviderHandoff) {
      return false;
    }

    if (data.action === EWorkerAction.cleanup) {
      const current = await this.viewWorkerForMonitorConsistent(data.worker_id);
      leaseContext.assertActive();
      if (
        current &&
        !current.deleted_at &&
        current.account_id === data.account_id &&
        current.lifecycle_operation_id === data.lifecycle_operation_id &&
        current.worker_status_id === EWorkerStatus.recreating &&
        current.session_storage === EWorkerSessionStorage.postgres &&
        current.worker_type_id !== data.worker_type_id
      ) {
        const recoveryProvider =
          WORKER_TYPE_SOURCE_PROVIDER[current.worker_type_id];
        if (
          !recoveryProvider ||
          typeof this.workerRuntimeRepository
            ?.viewWhatsappProviderHandoffRecoveryLifecycleProof !== 'function'
        ) {
          throw new Error(
            'whatsapp_handoff_recovery_cleanup_handler_fence_unavailable'
          );
        }
        const recoveryProof =
          await this.workerRuntimeRepository.viewWhatsappProviderHandoffRecoveryLifecycleProof(
            {
              worker_id: data.worker_id,
              account_id: data.account_id,
              recovery_operation_id: data.lifecycle_operation_id as string,
              recovery_worker_type_id: current.worker_type_id,
              recovery_provider: recoveryProvider,
            }
          );
        leaseContext.assertActive();
        if (
          recoveryProof?.recovery_ownership_unique === true &&
          recoveryProof.recovery_context_valid === true &&
          recoveryProof.source_session_valid === true &&
          recoveryProof.recovery_source_runtime_reserved === true &&
          recoveryProof.recovery_operation_id === data.lifecycle_operation_id &&
          recoveryProof.source_provider === recoveryProvider &&
          recoveryProof.failed_target_provider === targetProvider
        ) {
          this.logDebug(
            'service.recreate_worker.provider_handoff_recovery_cleanup_suppressed',
            {
              trace_id: data.debug_trace_id,
              layer: 'service',
              worker_id: data.worker_id,
              account_id: data.account_id,
              worker_type_id: current.worker_type_id,
              lifecycle_operation_id: data.lifecycle_operation_id,
              handoff_id: recoveryProof.handoff_id,
              source_provider: recoveryProof.source_provider,
              previous_provider: recoveryProof.failed_target_provider,
              runtime_generation: recoveryProof.runtime_generation ?? undefined,
              reason: 'source_runtime_already_reserved',
            }
          );
          return true;
        }
      }
    }

    if (
      typeof this.workerRuntimeRepository
        ?.viewWhatsappProviderHandoffTerminalLifecycleProof !== 'function'
    ) {
      throw new Error(
        'whatsapp_handoff_terminal_lifecycle_handler_fence_unavailable'
      );
    }

    const proof =
      await this.workerRuntimeRepository.viewWhatsappProviderHandoffTerminalLifecycleProof(
        {
          worker_id: data.worker_id,
          account_id: data.account_id,
          lifecycle_operation_id: data.lifecycle_operation_id as string,
        }
      );
    leaseContext.assertActive();
    if (!proof) {
      return false;
    }

    const current = await this.viewWorkerForMonitorConsistent(data.worker_id);
    leaseContext.assertActive();
    const completionPlan = planCompletedWhatsappProviderHandoffLifecycle(
      proof,
      current
    );
    if (completionPlan) {
      const completed =
        await this.workerService.updateWorkerByIdIfLifecycleMatches(
          completionPlan.accountId,
          {
            worker_id: data.worker_id,
            worker_status_id: EWorkerStatus.online,
            container_id: completionPlan.runtimeContainerId,
            lifecycle_operation_id: null,
          },
          {
            lifecycle_operation_id: completionPlan.lifecycleOperationId,
            container_id: completionPlan.controlContainerId,
            runtime_container_id: completionPlan.runtimeContainerId,
            runtime_generation: completionPlan.runtimeGeneration,
            server_id: completionPlan.serverId,
            worker_type_id: completionPlan.workerTypeId,
            worker_status_id: EWorkerStatus.online,
            recreate_completion: {
              operation_id: completionPlan.lifecycleOperationId,
              runtime_generation: completionPlan.runtimeGeneration,
              mode: 'replacement_runtime_already_online',
            },
          }
        );
      leaseContext.assertActive();

      const reconciled =
        await this.workerService.viewWorkerForMonitorConsistent(data.worker_id);
      leaseContext.assertActive();
      if (
        !reconciled ||
        reconciled.lifecycle_operation_id !== null ||
        reconciled.worker_status_id !== EWorkerStatus.online ||
        reconciled.worker_type_id !== completionPlan.workerTypeId ||
        reconciled.runtime_generation !== completionPlan.runtimeGeneration ||
        reconciled.recreate_completed_operation_id !==
          completionPlan.lifecycleOperationId ||
        reconciled.recreate_completed_runtime_generation !==
          completionPlan.runtimeGeneration ||
        !reconciled.recreate_completed_at
      ) {
        throw new Error(
          completed
            ? 'whatsapp_handoff_completed_lifecycle_postcondition_changed'
            : 'whatsapp_handoff_completed_lifecycle_cas_failed'
        );
      }

      await this.publishManagerWorkerRecreateTerminal({
        data,
        workerType: completionPlan.workerTypeId,
        runtimeGeneration: completionPlan.runtimeGeneration,
        workerStatusId: EWorkerStatus.online,
      });
      leaseContext.assertActive();
      this.logDebug(
        'service.recreate_worker.provider_handoff_lifecycle_completed',
        {
          trace_id: data.debug_trace_id,
          layer: 'service',
          worker_id: data.worker_id,
          account_id: data.account_id,
          worker_type_id: completionPlan.workerTypeId,
          lifecycle_operation_id: completionPlan.lifecycleOperationId,
          handoff_id: proof.handoff_id,
          runtime_generation: completionPlan.runtimeGeneration,
          already_completed: completed !== true,
        }
      );
      return true;
    }

    this.logDebug(
      'service.recreate_worker.provider_handoff_terminal_suppressed',
      {
        trace_id: data.debug_trace_id,
        layer: 'service',
        worker_id: data.worker_id,
        account_id: data.account_id,
        worker_type_id: data.worker_type_id,
        lifecycle_operation_id: data.lifecycle_operation_id,
        handoff_id: proof.handoff_id,
        handoff_state: proof.handoff_state,
        recovery_operation_id: proof.recovery_operation_id ?? undefined,
        recovery_state: proof.recovery_state,
        resolution_operation_id: proof.resolution_operation_id ?? undefined,
        resolution_state: proof.resolution_state ?? undefined,
      }
    );
    return true;
  }

  private async assertLifecycleOperationCurrent(
    data: IWorkerPayload,
    effect: string,
    options: {
      allowServerMismatch?: boolean;
      allowWorkerTypeMismatch?: boolean;
    } = {}
  ): Promise<void> {
    if (await this.isLifecycleOperationCurrent(data, options)) {
      return;
    }

    throw new Error(
      `Worker lifecycle changed before ${effect} for ${data.worker_id}`
    );
  }

  private async isWorkerSnapshotCurrent(
    workerId: string,
    accountId: string,
    serverId: string,
    workerTypeId: EWorkerType,
    expectedLifecycleOperationId?: string | null
  ): Promise<boolean> {
    const current = await this.viewWorkerForMonitorConsistent(workerId);
    const isCurrent = Boolean(
      current &&
      !current.deleted_at &&
      current.worker_status_id !== EWorkerStatus.deleting &&
      current.worker_status_id !== EWorkerStatus.delete &&
      current.account_id === accountId &&
      current.server_id === serverId &&
      current.worker_type_id === workerTypeId &&
      (expectedLifecycleOperationId === undefined ||
        current.lifecycle_operation_id === expectedLifecycleOperationId)
    );

    if (!isCurrent) {
      return false;
    }

    return true;
  }

  private async updateWorkerWithLifecycleGuard(
    accountId: string,
    input: IUpdateWorker,
    data: IWorkerPayload,
    workerTypeId?: EWorkerType,
    options: WorkerLifecycleUpdateOptions = {}
  ): Promise<boolean> {
    const lifecycleOperationId = data.lifecycle_operation_id?.trim() || null;
    let expectedWorkerStatusId = options.expectedWorkerStatusId;

    if (options.completeRecreate) {
      const expectedControlContainerId =
        options.expectedControlContainerId?.trim();
      const expectedRuntimeContainerId =
        options.expectedRuntimeContainerId?.trim();
      const updateContainerId = input.container_id?.trim();
      if (
        !expectedControlContainerId ||
        !expectedRuntimeContainerId ||
        !updateContainerId ||
        updateContainerId !== expectedRuntimeContainerId ||
        expectedControlContainerId === expectedRuntimeContainerId
      ) {
        throw new Error('worker_recreate_completion_identity_invalid');
      }
    }

    // Compatibility-v1 messages have no durable operation id. When the
    // caller does not already know the current status, capture it from the
    // primary view and include it in the UPDATE. This preserves the previous
    // deleting/deleted guard without leaving a read-then-unconditional-update
    // race. A v1 writer can therefore mutate only a v1 (NULL lifecycle) row.
    if (lifecycleOperationId === null && !expectedWorkerStatusId) {
      const current = await this.viewWorkerForMonitorConsistent(data.worker_id);
      if (
        !current ||
        current.deleted_at ||
        current.lifecycle_operation_id !== null ||
        current.worker_status_id === EWorkerStatus.deleting ||
        current.worker_status_id === EWorkerStatus.delete ||
        current.account_id !== accountId ||
        current.server_id !== data.server_id ||
        current.worker_type_id !==
          (workerTypeId ?? data.worker_type_id ?? ('' as EWorkerType))
      ) {
        return false;
      }
      expectedWorkerStatusId = current.worker_status_id as EWorkerStatus;
    }

    return this.workerService.updateWorkerByIdIfLifecycleMatches(
      accountId,
      input,
      {
        lifecycle_operation_id: lifecycleOperationId,
        server_id: data.server_id,
        ...(workerTypeId ? { worker_type_id: workerTypeId } : {}),
        ...(expectedWorkerStatusId
          ? { worker_status_id: expectedWorkerStatusId }
          : {}),
        ...(options.expectedControlContainerId
          ? { container_id: options.expectedControlContainerId }
          : {}),
        ...(options.expectedRuntimeContainerId
          ? {
              runtime_container_id: options.expectedRuntimeContainerId,
            }
          : {}),
        ...(options.expectedRuntimeGeneration !== undefined
          ? {
              runtime_generation: options.expectedRuntimeGeneration,
            }
          : {}),
        ...(options.completeRecreate &&
        data.action === EWorkerAction.recreate &&
        lifecycleOperationId &&
        options.expectedRuntimeGeneration !== undefined
          ? {
              recreate_completion: {
                operation_id: lifecycleOperationId,
                runtime_generation: options.expectedRuntimeGeneration,
                mode: 'replacement_runtime',
              },
            }
          : {}),
      }
    );
  }

  private async updateWorkerWithLifecycleGuardAndLegacyRetry(
    accountId: string,
    input: IUpdateWorker,
    data: IWorkerPayload,
    workerTypeId?: EWorkerType,
    options: WorkerLifecycleUpdateOptions = {}
  ): Promise<boolean> {
    if (data.lifecycle_operation_id) {
      return this.updateWorkerWithLifecycleGuard(
        accountId,
        input,
        data,
        workerTypeId,
        options
      );
    }

    return this.retryOperation(
      async () =>
        this.updateWorkerWithLifecycleGuard(
          accountId,
          input,
          data,
          workerTypeId,
          options
        ),
      (r) => !r
    );
  }

  private async finalizeAlreadyOnlineWorkerLifecycle(
    accountId: string,
    data: IWorkerPayload,
    workerTypeId: EWorkerType,
    containerId: string,
    runtimeGeneration: number
  ): Promise<boolean> {
    const current = await this.workerService.viewWorkerForMonitorConsistent(
      data.worker_id
    );
    if (
      current?.account_id !== accountId ||
      current.server_id !== data.server_id ||
      current.worker_type_id !== workerTypeId ||
      current.worker_status_id !== EWorkerStatus.online ||
      current.lifecycle_operation_id !== (data.lifecycle_operation_id ?? null)
    ) {
      return false;
    }

    const replacementCompletionMode = this.replacementRuntimeCompletionMode(
      current.container_id,
      containerId
    );

    return this.workerService.updateWorkerByIdIfLifecycleMatches(
      accountId,
      {
        worker_id: data.worker_id,
        container_id: containerId,
        ...(data.lifecycle_operation_id
          ? { lifecycle_operation_id: null }
          : {}),
      },
      {
        lifecycle_operation_id: data.lifecycle_operation_id ?? null,
        container_id: current.container_id,
        runtime_container_id: containerId,
        runtime_generation: runtimeGeneration,
        server_id: data.server_id,
        worker_type_id: workerTypeId,
        worker_status_id: EWorkerStatus.online,
        ...(data.action === EWorkerAction.recreate &&
        data.lifecycle_operation_id
          ? {
              recreate_completion: {
                operation_id: data.lifecycle_operation_id,
                runtime_generation: runtimeGeneration,
                mode: replacementCompletionMode,
              },
            }
          : {}),
      }
    );
  }

  /**
   * The runtime and bootstrap marker are written before the worker-row
   * completion CAS. A concurrent, fenced observer may legitimately advance
   * only the control pointer (or an ONLINE notification may advance the
   * status and pointer) between the original snapshot and that CAS. Treating
   * this as a failed recreate removes a valid replacement and causes the same
   * durable command to spin through new generations forever.
   *
   * Re-read the joined worker/runtime identity once and retry only while the
   * same account, server, provider, lifecycle operation, runtime container and
   * generation are still authoritative. The repository takes row locks and
   * verifies the exact, non-retired bootstrap marker in the final statement.
   */
  private async finalizeRecreateLifecycleAfterCasMiss(
    accountId: string,
    intendedUpdate: IUpdateWorker,
    data: IWorkerPayload,
    workerTypeId: EWorkerType,
    containerId: string,
    runtimeGeneration: number
  ): Promise<EWorkerStatus.online | EWorkerStatus.disponible | null> {
    const lifecycleOperationId = data.lifecycle_operation_id?.trim();
    if (!lifecycleOperationId) {
      return null;
    }

    const current = await this.workerService.viewWorkerForMonitorConsistent(
      data.worker_id
    );
    const normalizedContainerId = containerId.trim().toLowerCase();
    const normalizedControlContainerId = current?.container_id
      ?.trim()
      .toLowerCase();
    const normalizedRuntimeContainerId = current?.runtime_container_id
      ?.trim()
      .toLowerCase();

    if (
      current?.account_id !== accountId ||
      current.deleted_at ||
      current.server_id !== data.server_id ||
      current.worker_type_id !== workerTypeId ||
      current.lifecycle_operation_id !== lifecycleOperationId ||
      (current.worker_status_id !== EWorkerStatus.recreating &&
        current.worker_status_id !== EWorkerStatus.online) ||
      !normalizedControlContainerId ||
      normalizedRuntimeContainerId !== normalizedContainerId ||
      current.runtime_generation !== runtimeGeneration
    ) {
      return this.observeCommittedRecreateStatus(
        data,
        workerTypeId,
        normalizedContainerId,
        runtimeGeneration,
        current
      );
    }

    const terminalStatus =
      current.worker_status_id === EWorkerStatus.online
        ? EWorkerStatus.online
        : intendedUpdate.worker_status_id;
    if (
      terminalStatus !== EWorkerStatus.online &&
      terminalStatus !== EWorkerStatus.disponible
    ) {
      return null;
    }

    const update: IUpdateWorker =
      current.worker_status_id === EWorkerStatus.online
        ? {
            worker_id: data.worker_id,
            container_id: normalizedContainerId,
            lifecycle_operation_id: null,
          }
        : intendedUpdate;
    const finalized =
      await this.workerService.updateWorkerByIdIfLifecycleMatches(
        accountId,
        update,
        {
          lifecycle_operation_id: lifecycleOperationId,
          container_id: normalizedControlContainerId,
          runtime_container_id: normalizedContainerId,
          runtime_generation: runtimeGeneration,
          server_id: data.server_id,
          worker_type_id: workerTypeId,
          worker_status_id: current.worker_status_id,
          recreate_completion: {
            operation_id: lifecycleOperationId,
            runtime_generation: runtimeGeneration,
            mode: this.replacementRuntimeCompletionMode(
              normalizedControlContainerId,
              normalizedContainerId
            ),
          },
        }
      );
    if (finalized) {
      this.logDebug('service.recreate_worker.finalization_cas_refreshed', {
        trace_id: data.debug_trace_id,
        layer: 'service',
        worker_id: data.worker_id,
        account_id: accountId,
        worker_type_id: workerTypeId,
        worker_status_id: terminalStatus,
        lifecycle_operation_id: lifecycleOperationId,
        runtime_generation: runtimeGeneration,
        reason: 'authoritative_control_pointer_reobserved',
      });
      return terminalStatus;
    }

    const observed = await this.workerService.viewWorkerForMonitorConsistent(
      data.worker_id
    );
    return this.observeCommittedRecreateStatus(
      data,
      workerTypeId,
      normalizedContainerId,
      runtimeGeneration,
      observed
    );
  }

  private observeCommittedRecreateStatus(
    data: IWorkerPayload,
    workerTypeId: EWorkerType,
    normalizedContainerId: string,
    runtimeGeneration: number,
    worker: IWorkerMonitor | null | undefined
  ): EWorkerStatus.online | EWorkerStatus.disponible | null {
    return this.hasExactRecreateCompletion(
      data,
      worker,
      workerTypeId,
      runtimeGeneration
    ) &&
      worker.container_id?.trim().toLowerCase() === normalizedContainerId &&
      worker.runtime_container_id?.trim().toLowerCase() ===
        normalizedContainerId
      ? (worker.worker_status_id as
          EWorkerStatus.online | EWorkerStatus.disponible)
      : null;
  }

  private replacementRuntimeCompletionMode(
    controlContainerId: string | null | undefined,
    runtimeContainerId: string
  ): 'replacement_runtime' | 'replacement_runtime_already_online' {
    const control = controlContainerId?.trim().toLowerCase();
    const runtime = runtimeContainerId.trim().toLowerCase();
    const samePhysicalContainer = Boolean(
      control &&
      runtime &&
      (control === runtime ||
        control.startsWith(runtime) ||
        runtime.startsWith(control))
    );

    return samePhysicalContainer
      ? 'replacement_runtime_already_online'
      : 'replacement_runtime';
  }

  private async removeSupersededContainer(
    containerId: string,
    data: IWorkerPayload,
    reason: string
  ): Promise<void> {
    try {
      await this.workerService.removeContainerWorkerById(containerId);
    } catch (error) {
      this.logDebug(
        'service.worker_runtime.superseded_container_cleanup_failed',
        {
          trace_id: data.debug_trace_id,
          layer: 'service',
          worker_id: data.worker_id,
          account_id: data.account_id,
          worker_type_id: data.worker_type_id,
          lifecycle_operation_id: data.lifecycle_operation_id,
          container_id: containerId,
          reason,
          error: getErrorMessage(error),
        }
      );
    }
  }

  private async assertLifecycleCurrentForCreatedContainer(
    data: IWorkerPayload,
    containerId: string,
    effect: string
  ): Promise<void> {
    if (await this.isLifecycleOperationCurrent(data)) {
      return;
    }

    await this.removeSupersededContainer(
      containerId,
      data,
      `lifecycle_changed_${effect}`
    );
    throw new Error(
      `Worker lifecycle changed after ${effect} for ${data.worker_id}`
    );
  }

  private async createWorkerWithPayload(
    workerId: string,
    workerData: ResolvedWorkerDataForContainer,
    connectionRequest?: StatusConnectionWorkerRequest,
    leaseContext?: ILockLeaseContext,
    options: CreateWorkerOptions = {}
  ): Promise<void> {
    const createPayload: IWorkerPayload = {
      action: EWorkerAction.create,
      worker_id: workerId,
      server_id: workerData.serverId,
      account_id: workerData.accountIdResolved,
      worker_type_id: workerData.workerTypeId,
      ...(workerData.lifecycleOperationId
        ? { lifecycle_operation_id: workerData.lifecycleOperationId }
        : {}),
    };

    if (!leaseContext) throw new Error('worker_lifecycle_lease_required');
    await this.createWorker(
      createPayload,
      connectionRequest,
      options,
      leaseContext
    );
  }

  private startConnectionRequestRetry(
    payload: StatusConnectionWorkerRequest
  ): void {
    if (payload.type === EBaileysConnectionType.qrcode) {
      console.warn('Skipping background QR Code connection request:', {
        workerId: payload.worker_id,
        status: payload.status,
      });
      return;
    }

    this.stopConnectionRequestRetry(payload.worker_id);
    this.connectionRequestPayloads.set(payload.worker_id, payload);
    this.connectionRequestAttempts.set(payload.worker_id, 0);
    void this.runConnectionRequestAttempt(payload.worker_id);
  }

  private stopConnectionRequestRetry(workerId: string): void {
    const timer = this.connectionRequestTimers.get(workerId);
    if (timer) {
      clearTimeout(timer);
      this.connectionRequestTimers.delete(workerId);
    }
    this.connectionRequestPayloads.delete(workerId);
    this.connectionRequestAttempts.delete(workerId);
  }

  private scheduleNextConnectionRequest(workerId: string): void {
    const timer = setTimeout(() => {
      void this.runConnectionRequestAttempt(workerId);
    }, this.connectionRequestRetryIntervalMs);
    this.connectionRequestTimers.set(workerId, timer);
  }

  private async runConnectionRequestAttempt(workerId: string): Promise<void> {
    const payload = this.connectionRequestPayloads.get(workerId);
    if (!payload) {
      return;
    }

    const attempt = (this.connectionRequestAttempts.get(workerId) ?? 0) + 1;
    this.connectionRequestAttempts.set(workerId, attempt);

    try {
      const workerType = await this.resolveWorkerTypeForConnection(workerId);
      await this.workerBaileysGrpcClientService.requestConnection(
        workerId,
        payload,
        workerType
      );
      this.stopConnectionRequestRetry(workerId);
    } catch (err) {
      console.error('Failed to request worker connection:', err);

      if (attempt < this.connectionRequestMinAttempts) {
        this.scheduleNextConnectionRequest(workerId);
        return;
      }

      this.scheduleNextConnectionRequest(workerId);
    }
  }

  private async resolveWorkerTypeForConnection(
    workerId: string,
    accountId?: string
  ): Promise<EWorkerType | undefined> {
    if (accountId) {
      const viewWorkerType = await this.workerService.viewWorkerType(
        accountId,
        workerId
      );

      if (viewWorkerType?.worker_type_id) {
        return viewWorkerType.worker_type_id as EWorkerType;
      }
    }

    const monitorView = await this.viewWorkerForMonitorConsistent(workerId);
    if (monitorView?.worker_type_id) {
      return monitorView.worker_type_id as EWorkerType;
    }

    return undefined;
  }

  private async resolveWorkerProxyConfig(
    workerId: string,
    serverId: string
  ): Promise<ResolvedWorkerProxyConfig | undefined> {
    try {
      const channelProxy = await this.resolveChannelProxyConfig(workerId);
      if (channelProxy) {
        return channelProxy;
      }
    } catch (err) {
      console.error(
        'Failed to resolve channel proxy config. Falling back to server proxy.',
        {
          workerId,
          serverId,
          error: getErrorMessage(err),
        }
      );
    }

    try {
      return await this.resolveServerProxyConfig(serverId);
    } catch (err) {
      console.error('Failed to resolve server proxy config', {
        serverId,
        error: getErrorMessage(err),
      });

      return undefined;
    }
  }

  private async resolveWorkerProxyConfigStrict(
    workerId: string,
    serverId: string
  ): Promise<ResolvedWorkerProxyConfig | undefined> {
    const channelProxy = await this.resolveChannelProxyConfig(workerId);
    return channelProxy ?? this.resolveServerProxyConfig(serverId);
  }

  private async resolveChannelProxyConfig(workerId: string): Promise<
    | {
        protocol: EProxyProtocol;
        host: string;
        port: number;
        username?: string | null;
        password?: string | null;
      }
    | undefined
  > {
    const [
      proxyEnabled,
      proxyProtocol,
      proxyHost,
      proxyPort,
      proxyUsername,
      proxyPassword,
    ] = await Promise.all([
      this.workerConfigViewerRepository.fetchConfigValueByType(
        workerId,
        EWorkerConfigType.proxy_enabled
      ),
      this.workerConfigViewerRepository.fetchConfigValueByType(
        workerId,
        EWorkerConfigType.proxy_protocol
      ),
      this.workerConfigViewerRepository.fetchConfigValueByType(
        workerId,
        EWorkerConfigType.proxy_host
      ),
      this.workerConfigViewerRepository.fetchConfigValueByType(
        workerId,
        EWorkerConfigType.proxy_port
      ),
      this.workerConfigViewerRepository.fetchConfigValueByType(
        workerId,
        EWorkerConfigType.proxy_username
      ),
      this.workerConfigViewerRepository.fetchConfigValueByType(
        workerId,
        EWorkerConfigType.proxy_password
      ),
    ]);

    if (proxyEnabled.statusId !== EWorkerConfigStatus.active) {
      return undefined;
    }

    const host = proxyHost.value?.trim();
    const port = Number.parseInt(proxyPort.value ?? '', 10);
    if (!host || !Number.isFinite(port) || port <= 0) {
      return undefined;
    }

    return {
      protocol: this.normalizeProxyProtocol(proxyProtocol.value),
      host,
      port,
      username: this.tryDecryptProxyValue(proxyUsername.value),
      password: this.tryDecryptProxyValue(proxyPassword.value),
    };
  }

  private async resolveServerProxyConfig(serverId: string): Promise<
    | {
        protocol: EProxyProtocol;
        host: string;
        port: number;
        username?: string | null;
        password?: string | null;
      }
    | undefined
  > {
    const server =
      await this.serverSshViewerRepository.viewServerSshById(serverId);
    if (!server) {
      return undefined;
    }

    if (
      !server.proxy_enabled ||
      !server.proxy_host ||
      !server.proxy_port ||
      !Number.isFinite(server.proxy_port)
    ) {
      return undefined;
    }

    return {
      protocol: this.normalizeProxyProtocol(server.proxy_protocol),
      host: server.proxy_host,
      port: server.proxy_port,
      username: this.tryDecryptProxyValue(server.proxy_username),
      password: this.tryDecryptProxyValue(server.proxy_password),
    };
  }

  private tryDecryptProxyValue(value: string | null): string | null {
    if (!value) {
      return null;
    }

    try {
      return this.passwordEncryptorService.decrypt(value);
    } catch {
      return value;
    }
  }

  private async centrifugoPublish(
    dataPublish: IBaileysConnectionState
  ): Promise<PublishResult> {
    const channel = workerCentrifugoQueue(dataPublish.account_id);
    const stale = await this.shouldIgnoreQrAttemptState(dataPublish);
    if (stale.ignored) {
      return {} as PublishResult;
    }

    try {
      const result = await this.centrifugoService.publishSub(
        channel,
        dataPublish
      );
      return result;
    } catch (err) {
      throw err;
    }
  }

  private async updateWorkerErrorStatus(
    workerId: string,
    accountId: string,
    action?: EWorkerAction,
    serverId?: string,
    lifecycleOperationId?: string
  ): Promise<PublishResult> {
    /*
     * A lifecycle command is delivered by Kafka with bounded retries.  Marking
     * it terminal here would clear its operation fence on the first transient
     * Docker/gRPC/provider failure; every redelivery would then look stale and
     * be committed without retrying the actual work.  Keep the lifecycle in
     * progress and let WorkerLifecycleConsume perform the fenced terminal
     * compensation only after its retry budget is exhausted.
     */
    if (lifecycleOperationId) {
      this.logDebug('service.worker_error.deferred_to_lifecycle_consumer', {
        layer: 'service',
        worker_id: workerId,
        account_id: accountId,
        server_id: serverId,
        action,
        lifecycle_operation_id: lifecycleOperationId,
      });
      return {} as PublishResult;
    }

    const currentWorker = await this.workerService.viewWorker(
      accountId,
      workerId
    );

    if (currentWorker?.type?.id === EWorkerType.whatsapp) {
      return {} as PublishResult;
    }

    const inputUpdate: IUpdateWorker = {
      worker_id: workerId,
      worker_status_id: EWorkerStatus.error,
      ...(lifecycleOperationId ? { lifecycle_operation_id: null } : {}),
    };

    const updated = lifecycleOperationId
      ? await this.workerService.updateWorkerByIdIfLifecycleMatches(
          accountId,
          inputUpdate,
          {
            lifecycle_operation_id: lifecycleOperationId,
            ...(serverId ? { server_id: serverId } : {}),
          }
        )
      : await this.workerService.updateWorkerById(accountId, inputUpdate);

    if (!updated && lifecycleOperationId) {
      return {} as PublishResult;
    }

    const dataPublish: IBaileysConnectionState = {
      event_type: 'status',
      code: ECodeMessage.info,
      status: EBaileysConnectionStatus.info,
      worker_id: workerId,
      account_id: accountId,
      worker_status_id: EWorkerStatus.error,
    };

    const publishPromises: Promise<PublishResult>[] = [
      this.centrifugoPublish(dataPublish),
    ];

    if (
      (action === EWorkerAction.delete || action === EWorkerAction.recreate) &&
      serverId
    ) {
      const errorPayload: IWorkerPayload = {
        action: action,
        worker_id: workerId,
        server_id: serverId,
        account_id: accountId,
        worker_status_id: EWorkerStatus.error,
      };

      publishPromises.push(
        this.centrifugoService.publish(channelsConfigCentrifugo(), errorPayload)
      );
    }

    const [result] = await Promise.all(publishPromises);
    return result;
  }

  private optionalNonEmpty(
    value: string | undefined | null
  ): string | undefined {
    const normalized = value?.trim();
    return normalized && normalized.length > 0 ? normalized : undefined;
  }

  private async withLivenessDockerReadDeadline<T>(
    data: IWorkerPayload,
    operationName: string,
    operation: () => Promise<T>
  ): Promise<T> {
    if (!data.expected_container_id) {
      return operation();
    }

    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      deadlineTimer = setTimeout(() => {
        reject(
          new WorkerLivenessRecreateRetryError(
            `docker_timeout:${operationName}`
          )
        );
      }, WORKER_LIVENESS_LOCAL_DOCKER_READ_TIMEOUT_MS);
      deadlineTimer.unref?.();
    });

    try {
      return await Promise.race([operation(), deadline]);
    } finally {
      if (deadlineTimer) {
        clearTimeout(deadlineTimer);
      }
    }
  }

  private inspectRecreateContainerStrict(
    data: IWorkerPayload,
    containerId: string
  ): Promise<WorkerContainerInspection> {
    return this.withLivenessDockerReadDeadline(data, 'strict_inspect', () =>
      this.workerService.inspectContainerWorkerByIdStrict(containerId)
    );
  }

  private getSessionVolumeNameFromInspection(
    inspection: WorkerContainerInspection | undefined
  ): {
    sessionVolumeName?: string;
    source?: 'container_label' | 'container_env';
  } {
    const labelVolume = this.optionalNonEmpty(
      inspection?.container_labels?.['underchat.session_volume_name']
    );
    if (labelVolume) {
      return { sessionVolumeName: labelVolume, source: 'container_label' };
    }

    const envVolume = this.optionalNonEmpty(
      inspection?.container_env?.SESSION_VOLUME_NAME
    );
    if (envVolume) {
      return { sessionVolumeName: envVolume, source: 'container_env' };
    }

    return {};
  }

  private async assertMissingJournalRecreateProviderSafe(
    data: IWorkerPayload,
    worker: NonNullable<
      Awaited<ReturnType<WorkerService['viewWorkerForMonitorConsistent']>>
    >,
    workerType: EWorkerType,
    leaseContext: ILockLeaseContext
  ): Promise<void> {
    if (data.recovery_without_journal !== true) {
      return;
    }

    if (
      data.action !== EWorkerAction.recreate ||
      !data.lifecycle_operation_id ||
      worker.worker_status_id !== EWorkerStatus.recreating ||
      worker.lifecycle_operation_id !== data.lifecycle_operation_id
    ) {
      throw new Error(
        'worker_recreate_missing_journal_identity_conflict:lifecycle_fence'
      );
    }

    const inspection = await this.inspectRecreateContainerStrict(
      data,
      data.worker_id
    );
    leaseContext.assertActive();
    if (!inspection.exists) {
      return;
    }

    const rejection = this.resolveMissingJournalRecreateIdentityRejection(
      data,
      workerType,
      inspection
    );
    if (rejection) {
      throw new Error(
        `worker_recreate_missing_journal_identity_conflict:${rejection}`
      );
    }

    this.logDebug('service.recreate_worker.missing_journal_identity_proven', {
      trace_id: data.debug_trace_id,
      layer: 'service',
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id: workerType,
      lifecycle_operation_id: data.lifecycle_operation_id,
      container_id: inspection.container_id,
      container_image: inspection.container_image,
      provider_identity_legacy:
        inspection.container_labels?.['underchat.worker_type_id'] ===
          undefined && inspection.container_env?.WORKER_TYPE_ID === undefined,
    });
  }

  private resolveMissingJournalRecreateIdentityRejection(
    data: IWorkerPayload,
    workerType: EWorkerType,
    inspection: WorkerContainerInspection
  ): string | undefined {
    const labels = inspection.container_labels ?? {};
    const env = inspection.container_env ?? {};
    if (!inspection.container_id) return 'container_id_missing';
    if (inspection.container_name !== data.worker_id) return 'container_name';
    if (
      (labels['underchat.worker_id'] !== undefined &&
        labels['underchat.worker_id'] !== data.worker_id) ||
      (env.WORKER_ID !== undefined && env.WORKER_ID !== data.worker_id)
    ) {
      return 'worker_id';
    }
    if (
      (labels['underchat.account_id'] !== undefined &&
        labels['underchat.account_id'] !== data.account_id) ||
      (env.ACCOUNT_ID !== undefined && env.ACCOUNT_ID !== data.account_id)
    ) {
      return 'account_id';
    }
    if (
      labels['underchat.server_id'] !== undefined &&
      labels['underchat.server_id'] !== data.server_id
    ) {
      return 'server_id';
    }
    if (
      labels['underchat.warm_standby'] === 'true' ||
      env.WARM_STANDBY === 'true'
    ) {
      return 'warm_standby';
    }
    if (
      labels['underchat.session_volume_name'] !== undefined &&
      env.SESSION_VOLUME_NAME !== undefined &&
      labels['underchat.session_volume_name'] !== env.SESSION_VOLUME_NAME
    ) {
      return 'session_volume';
    }

    const explicitTypes = [
      labels['underchat.worker_type_id'],
      env.WORKER_TYPE_ID,
    ].filter((value): value is string => value !== undefined);
    if (
      explicitTypes.some(
        (value) =>
          !Object.values(EWorkerType).includes(value as EWorkerType) ||
          value !== workerType
      )
    ) {
      return 'worker_type';
    }

    const imageTypes = [
      inspection.container_image,
      labels['underchat.worker_image'],
      env.WORKER_IMAGE,
    ]
      .map((image) => this.resolveWorkerTypeFromImageEvidence(image))
      .filter((value): value is EWorkerType => value !== undefined);
    if (imageTypes.some((value) => value !== workerType)) {
      return 'worker_image';
    }
    if (explicitTypes.length === 0 && imageTypes.length === 0) {
      return 'worker_type_unproven';
    }

    return undefined;
  }

  private resolveWorkerTypeFromImageEvidence(
    image: string | undefined
  ): EWorkerType | undefined {
    if (!image) return undefined;
    const normalized = image.toLowerCase();
    return Object.values(EWorkerType).find((workerType) =>
      normalized.includes(getImageWorker(workerType).split(':')[0])
    );
  }

  private async resolveRecreateSessionContext(
    data: IWorkerPayload,
    leaseContext: ILockLeaseContext
  ): Promise<{
    shouldRemoveSession: boolean;
    sessionStorage: EWorkerSessionStorage;
    shouldRemoveVolume: boolean;
    sessionVolumeResolution: RecreateSessionVolumeResolution;
    preservedSessionVolumeName?: string;
    sessionWasReset: boolean;
  }> {
    const shouldRemoveSession = data.remove_session === true;
    const sessionStorage = this.sessionStorageFor(data);
    const shouldRemoveVolume =
      sessionStorage === EWorkerSessionStorage.legacy_volume &&
      data.remove_volume === true;
    const sessionVolumeResolution = await this.resolveRecreateSessionVolume(
      data,
      shouldRemoveVolume,
      leaseContext
    );
    leaseContext.assertActive();
    return {
      shouldRemoveSession,
      sessionStorage,
      shouldRemoveVolume,
      sessionVolumeResolution,
      preservedSessionVolumeName: sessionVolumeResolution.sessionVolumeName,
      sessionWasReset: sessionVolumeResolution.source === 'reset',
    };
  }

  private async resolveRecreateSessionVolume(
    data: IWorkerPayload,
    shouldRemoveVolume: boolean,
    leaseContext: ILockLeaseContext
  ): Promise<RecreateSessionVolumeResolution> {
    leaseContext.assertActive();
    const runtimeBeforeRemove = await this.viewWorkerRuntimeConsistent(
      data.worker_id
    );
    leaseContext.assertActive();

    if (this.isSafeSessionStorageMigrationRestore(data)) {
      if (
        !runtimeBeforeRemove ||
        runtimeBeforeRemove.session_storage !==
          EWorkerSessionStorage.postgres ||
        runtimeBeforeRemove.session_volume_name !== null
      ) {
        throw new Error('session_storage_migration_restore_runtime_mismatch');
      }
      return {
        sessionVolumeName: data.legacy_session_volume_name,
        runtimeGeneration: runtimeBeforeRemove.runtime_generation,
        source: 'worker_runtime',
        runtimeWasBackfilled: false,
      };
    }

    if (this.sessionStorageFor(data) === EWorkerSessionStorage.postgres) {
      if (
        runtimeBeforeRemove &&
        runtimeBeforeRemove.session_storage !== EWorkerSessionStorage.postgres
      ) {
        const legacyConversionSourceRuntime =
          this.isLegacyVolumeToPostgresConversion(data) &&
          runtimeBeforeRemove.session_storage ===
            EWorkerSessionStorage.legacy_volume &&
          Boolean(runtimeBeforeRemove.session_volume_name?.trim());
        const protectedMigrationSourceRuntime =
          this.isSafeSessionStorageMigration(data) &&
          runtimeBeforeRemove.session_storage ===
            EWorkerSessionStorage.legacy_volume &&
          runtimeBeforeRemove.session_volume_name?.trim() ===
            data.legacy_session_volume_name;
        if (legacyConversionSourceRuntime || protectedMigrationSourceRuntime) {
          // The prepared cleanup owns this retired local volume. A destructive
          // conversion must also discard any canonical shadow left by an
          // earlier failed storage migration before the new generation opens.
          return {
            runtimeGeneration: runtimeBeforeRemove.runtime_generation,
            sessionDeletionRuntimeFence: legacyConversionSourceRuntime
              ? {
                  runtime_generation: runtimeBeforeRemove.runtime_generation,
                  container_id: runtimeBeforeRemove.container_id ?? null,
                  session_storage: EWorkerSessionStorage.legacy_volume,
                  session_volume_name:
                    runtimeBeforeRemove.session_volume_name ?? null,
                }
              : null,
            source: 'reset',
            runtimeWasBackfilled: false,
          };
        }
        throw new Error('postgres_worker_runtime_session_backend_mismatch');
      }
      return {
        runtimeGeneration: runtimeBeforeRemove?.runtime_generation,
        sessionDeletionRuntimeFence: runtimeBeforeRemove
          ? {
              runtime_generation: runtimeBeforeRemove.runtime_generation,
              container_id: runtimeBeforeRemove.container_id ?? null,
              session_storage: EWorkerSessionStorage.postgres,
              session_volume_name: null,
            }
          : null,
        source: 'postgres',
        runtimeWasBackfilled: false,
      };
    }

    if (shouldRemoveVolume) {
      return {
        runtimeGeneration: runtimeBeforeRemove?.runtime_generation,
        source: 'reset',
        runtimeWasBackfilled: false,
      };
    }

    const runtimeVolume = this.optionalNonEmpty(
      runtimeBeforeRemove?.session_volume_name
    );
    const inspection = await this.inspectRecreateContainerStrict(
      data,
      data.worker_id
    );
    leaseContext.assertActive();
    const inspectedVolume = this.getSessionVolumeNameFromInspection(inspection);
    const inspectedVolumeName = inspectedVolume.sessionVolumeName;

    /*
     * The live container is the authoritative source while it still exists.
     * A worker_runtime row may already contain the volume reserved for an
     * interrupted activation even though the serving container is still
     * mounted to the previous session. Adopting that row would silently start
     * the replacement with the wrong WhatsApp identity.
     */
    if (inspection.exists && inspectedVolumeName) {
      const inspectedVolumeExists =
        await this.workerService.existsVolumeByNameStrict(inspectedVolumeName);
      leaseContext.assertActive();

      if (!inspectedVolumeExists) {
        return {
          runtimeGeneration: runtimeBeforeRemove?.runtime_generation,
          source: 'reset',
          runtimeWasBackfilled: false,
        };
      }

      let runtimeGeneration = runtimeBeforeRemove?.runtime_generation;
      let runtimeWasBackfilled = false;

      if (
        runtimeVolume !== inspectedVolumeName &&
        this.workerRuntimeRepository
      ) {
        leaseContext.assertActive();
        const repairedRuntime = await this.workerRuntimeRepository.upsert({
          worker_id: data.worker_id,
          container_id: inspection.container_id,
          container_name: inspection.container_name ?? data.worker_id,
          session_volume_name: inspectedVolumeName,
          runtime_generation: runtimeBeforeRemove?.runtime_generation,
          warm_pool_id: null,
          activated_at: currentTime(),
        });
        leaseContext.assertActive();
        runtimeGeneration =
          repairedRuntime?.runtime_generation ??
          runtimeBeforeRemove?.runtime_generation;
        runtimeWasBackfilled = true;
      }

      return {
        sessionVolumeName: inspectedVolumeName,
        runtimeGeneration,
        source: inspectedVolume.source ?? 'legacy_worker_id',
        runtimeWasBackfilled,
      };
    }

    if (runtimeVolume) {
      leaseContext.assertActive();
      const runtimeVolumeExists =
        await this.workerService.existsVolumeByNameStrict(runtimeVolume);
      leaseContext.assertActive();
      if (runtimeVolumeExists) {
        return {
          sessionVolumeName: runtimeVolume,
          runtimeGeneration: runtimeBeforeRemove?.runtime_generation,
          source: 'worker_runtime',
          runtimeWasBackfilled: false,
        };
      }

      /*
       * Older workers used their worker id as the Docker volume name. A stale
       * warm-runtime row must not hide that still-recoverable legacy session:
       * createContainerWorker would reuse it later, so classify and preserve it
       * consistently instead of clearing the worker identity as a reset.
       */
      if (
        runtimeVolume !== data.worker_id &&
        (await this.workerService.existsVolumeByNameStrict(data.worker_id))
      ) {
        leaseContext.assertActive();
        if (inspection.exists && this.workerRuntimeRepository) {
          leaseContext.assertActive();
          await this.workerRuntimeRepository.upsert({
            worker_id: data.worker_id,
            container_id: inspection.container_id,
            container_name: inspection.container_name ?? data.worker_id,
            session_volume_name: data.worker_id,
            runtime_generation: runtimeBeforeRemove?.runtime_generation,
            warm_pool_id: null,
            activated_at: currentTime(),
          });
          leaseContext.assertActive();
        }

        return {
          sessionVolumeName: data.worker_id,
          runtimeGeneration: runtimeBeforeRemove?.runtime_generation,
          source: 'legacy_worker_id',
          runtimeWasBackfilled: inspection.exists,
        };
      }

      return {
        runtimeGeneration: runtimeBeforeRemove?.runtime_generation,
        source: 'reset',
        runtimeWasBackfilled: false,
      };
    }

    const containerVolume = this.getSessionVolumeNameFromInspection(inspection);
    const sessionVolumeName =
      containerVolume.sessionVolumeName ?? data.worker_id;
    const source = containerVolume.source ?? 'legacy_worker_id';

    const volumeExists =
      await this.workerService.existsVolumeByNameStrict(sessionVolumeName);
    leaseContext.assertActive();
    if (!volumeExists) {
      return {
        runtimeGeneration: runtimeBeforeRemove?.runtime_generation,
        source: 'reset',
        runtimeWasBackfilled: false,
      };
    }

    let runtimeGeneration: number | undefined;
    if (inspection.exists && this.workerRuntimeRepository) {
      leaseContext.assertActive();
      const runtime = await this.workerRuntimeRepository.upsert({
        worker_id: data.worker_id,
        container_id: inspection.container_id,
        container_name: inspection.container_name ?? data.worker_id,
        session_volume_name: sessionVolumeName,
        warm_pool_id: null,
        activated_at: currentTime(),
      });
      leaseContext.assertActive();
      runtimeGeneration = runtime?.runtime_generation;
    }

    return {
      sessionVolumeName,
      runtimeGeneration,
      source,
      runtimeWasBackfilled: inspection.exists,
    };
  }

  private async assertPreservedSessionVolumeExists(
    data: IWorkerPayload,
    resolution: RecreateSessionVolumeResolution,
    leaseContext: ILockLeaseContext
  ): Promise<void> {
    if (!resolution.sessionVolumeName) {
      return;
    }

    leaseContext.assertActive();
    const existsVolume = await this.workerService.existsVolumeByNameStrict(
      resolution.sessionVolumeName
    );
    leaseContext.assertActive();

    if (existsVolume) {
      return;
    }

    leaseContext.assertActive();
    await this.updateWorkerErrorStatus(
      data.worker_id,
      data.account_id,
      data.action,
      data.server_id,
      data.lifecycle_operation_id
    );
    leaseContext.assertActive();

    if (this.isSafeSessionStorageMigrationRestore(data)) {
      throw new Error('session_storage_migration_source_volume_missing');
    }

    throw new Error('worker_session_volume_missing_recreate_aborted');
  }

  private resolveLivenessRecreateFenceMismatch(
    data: IWorkerPayload,
    currentWorker: IWorkerMonitor,
    inspection: WorkerContainerInspection,
    runtime?: IWorkerRuntime | null
  ): string | undefined {
    const expectedContainerId = data.expected_container_id
      ?.trim()
      .toLowerCase();
    const expectedStartedAt = data.expected_container_started_at?.trim();
    const expectedRestartCount = data.expected_container_restart_count;
    const expectedHealthStatus = data.expected_container_health_status
      ?.trim()
      .toLowerCase();
    const expectedPaused = data.expected_container_paused === true;
    const expectedRuntimeGeneration = data.expected_runtime_generation;
    if (!expectedContainerId) {
      return undefined;
    }
    if (
      !DOCKER_CONTAINER_ID_PATTERN.test(expectedContainerId) ||
      data.remove_session === true ||
      data.remove_volume === true ||
      !expectedStartedAt ||
      typeof expectedRestartCount !== 'number' ||
      !Number.isSafeInteger(expectedRestartCount) ||
      expectedRestartCount < 0 ||
      !['unhealthy', 'healthy', 'starting', 'none'].includes(
        expectedHealthStatus ?? ''
      ) ||
      (!expectedPaused &&
        expectedHealthStatus !== 'unhealthy' &&
        !(expectedHealthStatus === 'starting' && expectedRestartCount >= 1)) ||
      typeof expectedRuntimeGeneration !== 'number' ||
      !Number.isSafeInteger(expectedRuntimeGeneration) ||
      expectedRuntimeGeneration <= 0
    ) {
      return 'liveness_fence_incomplete';
    }
    if (
      currentWorker.container_id?.trim().toLowerCase() !==
        expectedContainerId ||
      currentWorker.runtime_container_id?.trim().toLowerCase() !==
        expectedContainerId ||
      currentWorker.runtime_generation !== expectedRuntimeGeneration
    ) {
      return 'control_plane_runtime_changed';
    }
    if (!inspection.exists) {
      return 'container_missing';
    }

    const labels = inspection.container_labels ?? {};
    const env = inspection.container_env ?? {};
    const postgresWarmLineage = Boolean(
      runtime?.container_id?.trim().toLowerCase() === expectedContainerId &&
      runtime.session_storage === EWorkerSessionStorage.postgres &&
      runtime.session_volume_name === null &&
      runtime.runtime_generation === expectedRuntimeGeneration &&
      /^[0-9a-f]{64}$/u.test(runtime.runtime_capability_hash ?? '') &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
        runtime.session_writer_epoch ?? ''
      ) &&
      runtime.warm_pool_id &&
      labels['underchat.warm_pool_id'] === runtime.warm_pool_id &&
      env.WARM_POOL_ID === runtime.warm_pool_id &&
      labels['underchat.warm_standby'] === 'true' &&
      env.WARM_STANDBY === 'true' &&
      labels['underchat.worker_id'] === undefined &&
      labels['underchat.account_id'] === undefined &&
      labels['underchat.runtime_generation'] === undefined
    );
    const observedRuntimeGeneration = postgresWarmLineage
      ? runtime?.runtime_generation
      : Number(labels['underchat.runtime_generation']);
    if (
      inspection.container_id?.trim().toLowerCase() !== expectedContainerId ||
      inspection.container_name !== data.worker_id ||
      (!postgresWarmLineage &&
        labels['underchat.worker_id'] !== data.worker_id) ||
      (!postgresWarmLineage &&
        labels['underchat.account_id'] !== data.account_id) ||
      labels['underchat.server_id'] !== data.server_id ||
      labels['underchat.worker_type_id'] !== currentWorker.worker_type_id ||
      observedRuntimeGeneration !== expectedRuntimeGeneration
    ) {
      return 'docker_runtime_identity_changed';
    }
    if (
      inspection.running !== true ||
      inspection.container_started_at !== expectedStartedAt ||
      inspection.container_restart_count !== expectedRestartCount ||
      (inspection.container_health_status ?? 'none').toLowerCase() !==
        expectedHealthStatus ||
      inspection.container_paused !== expectedPaused
    ) {
      return 'docker_runtime_observation_changed';
    }

    return undefined;
  }

  private async compensateRecoveredLivenessRecreate(
    data: IWorkerPayload,
    currentWorker: IWorkerMonitor,
    reason: string,
    leaseContext: ILockLeaseContext
  ): Promise<LivenessRecoveryCompensationOutcome> {
    const expectedContainerId = data.expected_container_id
      ?.trim()
      .toLowerCase();
    const expectedRuntimeGeneration = data.expected_runtime_generation;
    if (
      !data.lifecycle_operation_id ||
      !expectedContainerId ||
      typeof expectedRuntimeGeneration !== 'number' ||
      !Number.isSafeInteger(expectedRuntimeGeneration) ||
      expectedRuntimeGeneration <= 0
    ) {
      throw new WorkerLivenessRecreateRetryError(
        'recovery:incomplete_identity'
      );
    }

    if (
      !(await this.loadStrictLivenessRuntimeHealth(
        data,
        currentWorker,
        expectedRuntimeGeneration,
        leaseContext
      ))
    ) {
      return 'not_ready';
    }

    leaseContext.assertActive();
    const restored =
      await this.workerService.updateWorkerByIdIfLifecycleMatches(
        data.account_id,
        {
          worker_id: data.worker_id,
          worker_status_id: EWorkerStatus.online,
          lifecycle_operation_id: null,
        },
        {
          lifecycle_operation_id: data.lifecycle_operation_id,
          container_id: expectedContainerId,
          runtime_container_id: expectedContainerId,
          runtime_generation: expectedRuntimeGeneration,
          server_id: data.server_id,
          worker_type_id: currentWorker.worker_type_id,
          worker_status_id: EWorkerStatus.recreating,
          recreate_completion: {
            operation_id: data.lifecycle_operation_id,
            runtime_generation: expectedRuntimeGeneration,
            mode: 'revalidated_current_runtime',
          },
        }
      );
    leaseContext.assertActive();

    let compensated = restored;
    if (!compensated) {
      const latest = await this.viewWorkerForMonitorConsistent(data.worker_id);
      leaseContext.assertActive();
      if (
        !latest ||
        latest.deleted_at ||
        latest.account_id !== data.account_id ||
        latest.lifecycle_operation_id !== data.lifecycle_operation_id ||
        latest.container_id?.trim().toLowerCase() !== expectedContainerId ||
        latest.runtime_container_id?.trim().toLowerCase() !==
          expectedContainerId ||
        latest.runtime_generation !== expectedRuntimeGeneration
      ) {
        return 'superseded';
      }

      if (latest.worker_status_id === EWorkerStatus.online) {
        compensated =
          await this.workerService.updateWorkerByIdIfLifecycleMatches(
            data.account_id,
            {
              worker_id: data.worker_id,
              lifecycle_operation_id: null,
            },
            {
              lifecycle_operation_id: data.lifecycle_operation_id,
              container_id: expectedContainerId,
              runtime_container_id: expectedContainerId,
              runtime_generation: expectedRuntimeGeneration,
              server_id: data.server_id,
              worker_type_id: currentWorker.worker_type_id,
              worker_status_id: EWorkerStatus.online,
              recreate_completion: {
                operation_id: data.lifecycle_operation_id,
                runtime_generation: expectedRuntimeGeneration,
                mode: 'revalidated_current_runtime',
              },
            }
          );
        leaseContext.assertActive();
        if (!compensated) {
          const afterRetry = await this.viewWorkerForMonitorConsistent(
            data.worker_id
          );
          leaseContext.assertActive();
          if (
            !afterRetry ||
            afterRetry.lifecycle_operation_id !== data.lifecycle_operation_id ||
            afterRetry.container_id?.trim().toLowerCase() !==
              expectedContainerId ||
            afterRetry.runtime_container_id?.trim().toLowerCase() !==
              expectedContainerId ||
            afterRetry.runtime_generation !== expectedRuntimeGeneration
          ) {
            return 'superseded';
          }
        }
      }

      if (!compensated) {
        throw new WorkerLivenessRecreateRetryError(
          'recovery:compensation_cas_conflict'
        );
      }
    }

    await this.releaseRecoveredLivenessCooldown(
      data.worker_id,
      expectedContainerId,
      data.lifecycle_operation_id
    );
    this.logDebug('service.recreate_worker.liveness_fence_recovered', {
      trace_id: data.debug_trace_id,
      layer: 'service',
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id: currentWorker.worker_type_id,
      lifecycle_operation_id: data.lifecycle_operation_id,
      container_id: expectedContainerId,
      runtime_generation: expectedRuntimeGeneration,
      reason,
      restored: true,
    });

    const completed = await this.viewWorkerForMonitorConsistent(data.worker_id);
    leaseContext.assertActive();
    if (
      !completed ||
      completed.worker_status_id !== EWorkerStatus.online ||
      completed.lifecycle_operation_id !== null ||
      completed.runtime_generation !== expectedRuntimeGeneration ||
      completed.recreate_completed_operation_id !==
        data.lifecycle_operation_id ||
      completed.recreate_completed_runtime_generation !==
        expectedRuntimeGeneration ||
      !completed.recreate_completed_at
    ) {
      throw new WorkerLivenessRecreateRetryError(
        'recovery:completion_tombstone_mismatch'
      );
    }
    const recoveredState = buildManagerWorkerRecreateCompletedStatusEvent(
      {
        ...data,
        action: EWorkerAction.recreate,
        lifecycle_operation_id: data.lifecycle_operation_id,
        worker_type_id: currentWorker.worker_type_id as EWorkerType,
      },
      expectedRuntimeGeneration,
      expectedContainerId,
      completed.recreate_completed_at
    );
    try {
      await Promise.all([
        this.centrifugoService.publishSubStrict(
          workerCentrifugoQueue(data.account_id),
          recoveredState
        ),
        this.centrifugoService.publishStrict(
          channelsConfigCentrifugo(),
          recoveredState
        ),
      ]);
    } catch (error) {
      this.logDebug(
        'service.recreate_worker.liveness_recovery_terminal_publish_failed',
        {
          trace_id: data.debug_trace_id,
          layer: 'service',
          worker_id: data.worker_id,
          account_id: data.account_id,
          worker_type_id: currentWorker.worker_type_id,
          lifecycle_operation_id: data.lifecycle_operation_id,
          runtime_generation: expectedRuntimeGeneration,
          reason: getErrorMessage(error),
        }
      );
      throw new WorkerLivenessRecreateRetryError(
        'recovery:terminal_publish_failed'
      );
    }
    return 'restored';
  }

  private async releaseRecoveredLivenessCooldown(
    workerId: string,
    containerId: string,
    lifecycleOperationId: string
  ): Promise<void> {
    const key = `underchat:worker:liveness-recreate:${workerId}:${containerId}`;
    try {
      await this.redis.eval(
        `
          if redis.call("GET", KEYS[1]) == ARGV[1] then
            return redis.call("DEL", KEYS[1])
          end
          return 0
        `,
        1,
        key,
        lifecycleOperationId
      );
    } catch (error) {
      this.logDebug(
        'service.recreate_worker.liveness_cooldown_release_failed',
        {
          layer: 'service',
          worker_id: workerId,
          lifecycle_operation_id: lifecycleOperationId,
          container_id: containerId,
          reason: getErrorMessage(error),
        }
      );
    }
  }

  private async loadStrictLivenessRuntimeHealth(
    data: IWorkerPayload,
    currentWorker: IWorkerMonitor,
    expectedRuntimeGeneration: number,
    leaseContext: ILockLeaseContext
  ): Promise<IWorkerRuntimeHealthResponseProto | null> {
    if (
      typeof expectedRuntimeGeneration !== 'number' ||
      !Number.isSafeInteger(expectedRuntimeGeneration) ||
      expectedRuntimeGeneration <= 0
    ) {
      return null;
    }

    let health: IWorkerRuntimeHealthResponseProto;
    try {
      leaseContext.assertActive();
      health = await this.workerBaileysGrpcClientService.runtimeHealth(
        data.worker_id,
        { worker_id: data.worker_id },
        currentWorker.worker_type_id as EWorkerType
      );
      leaseContext.assertActive();
    } catch (error) {
      this.logDebug(
        'service.recreate_worker.liveness_runtime_readiness_unavailable',
        {
          trace_id: data.debug_trace_id,
          layer: 'service',
          worker_id: data.worker_id,
          account_id: data.account_id,
          worker_type_id: currentWorker.worker_type_id,
          lifecycle_operation_id: data.lifecycle_operation_id,
          runtime_generation: expectedRuntimeGeneration,
          reason: getErrorMessage(error),
        }
      );
      return null;
    }

    const ready =
      (!health.worker_id || health.worker_id === data.worker_id) &&
      (!health.account_id || health.account_id === data.account_id) &&
      (!health.worker_type_id ||
        health.worker_type_id === currentWorker.worker_type_id) &&
      this.hasExpectedRuntimeGeneration(
        health.runtime_generation,
        expectedRuntimeGeneration
      ) &&
      health.ready === true &&
      health.kafka_consumers_ready === true &&
      this.isConnectedRuntimeHealth(
        health,
        currentWorker.worker_type_id as EWorkerType
      );
    if (!ready) {
      this.logDebug('service.recreate_worker.liveness_runtime_not_ready', {
        trace_id: data.debug_trace_id,
        layer: 'service',
        worker_id: data.worker_id,
        account_id: data.account_id,
        worker_type_id: currentWorker.worker_type_id,
        lifecycle_operation_id: data.lifecycle_operation_id,
        runtime_generation: expectedRuntimeGeneration,
        reported_runtime_generation: this.optionalRuntimeGeneration(
          health.runtime_generation
        ),
        provider_state: health.provider_state,
        reason: this.resolveOnlineRuntimeHealthRejectionReason(
          health,
          currentWorker.worker_type_id as EWorkerType
        ),
      });
    }
    return ready ? health : null;
  }

  private isOwnedLivenessReplacementIdentity(
    data: IWorkerPayload,
    currentWorker: IWorkerMonitor,
    inspection: WorkerContainerInspection,
    containerId: string,
    runtimeGeneration: number
  ): boolean {
    const labels = inspection.container_labels ?? {};
    return (
      inspection.exists &&
      inspection.container_id?.trim().toLowerCase() === containerId &&
      inspection.container_name === data.worker_id &&
      labels['underchat.worker_id'] === data.worker_id &&
      labels['underchat.account_id'] === data.account_id &&
      labels['underchat.server_id'] === data.server_id &&
      labels['underchat.worker_type_id'] === currentWorker.worker_type_id &&
      labels['underchat.runtime_generation'] === String(runtimeGeneration) &&
      labels['underchat.lifecycle_operation_id'] === data.lifecycle_operation_id
    );
  }

  private async finalizeOwnedLivenessReplacement(
    data: IWorkerPayload,
    currentWorker: IWorkerMonitor,
    containerId: string,
    runtimeGeneration: number,
    leaseContext: ILockLeaseContext
  ): Promise<boolean> {
    const expectedOldContainerId = data.expected_container_id
      ?.trim()
      .toLowerCase();
    if (!expectedOldContainerId || !data.lifecycle_operation_id) {
      return false;
    }

    leaseContext.assertActive();
    let finalized = await this.workerService.updateWorkerByIdIfLifecycleMatches(
      data.account_id,
      {
        worker_id: data.worker_id,
        worker_status_id: EWorkerStatus.online,
        lifecycle_operation_id: null,
        container_id: containerId,
      },
      {
        lifecycle_operation_id: data.lifecycle_operation_id,
        container_id: expectedOldContainerId,
        runtime_container_id: containerId,
        runtime_generation: runtimeGeneration,
        server_id: data.server_id,
        worker_type_id: currentWorker.worker_type_id,
        worker_status_id: currentWorker.worker_status_id,
        recreate_completion: {
          operation_id: data.lifecycle_operation_id,
          runtime_generation: runtimeGeneration,
          mode: 'replacement_runtime',
        },
      }
    );
    leaseContext.assertActive();
    if (!finalized) {
      finalized = await this.finalizeAlreadyOnlineWorkerLifecycle(
        data.account_id,
        data,
        currentWorker.worker_type_id as EWorkerType,
        containerId,
        runtimeGeneration
      );
      leaseContext.assertActive();
    }
    if (!finalized) {
      const latest = await this.viewWorkerForMonitorConsistent(data.worker_id);
      leaseContext.assertActive();
      if (
        latest?.account_id === data.account_id &&
        latest.server_id === data.server_id &&
        latest.worker_type_id === currentWorker.worker_type_id &&
        latest.worker_status_id === EWorkerStatus.online &&
        !latest.lifecycle_operation_id &&
        latest.container_id?.trim().toLowerCase() === containerId &&
        latest.runtime_container_id?.trim().toLowerCase() === containerId &&
        latest.runtime_generation === runtimeGeneration &&
        this.hasExactRecreateCompletion(
          data,
          latest,
          currentWorker.worker_type_id as EWorkerType,
          runtimeGeneration
        )
      ) {
        await this.releaseRecoveredLivenessCooldown(
          data.worker_id,
          expectedOldContainerId,
          data.lifecycle_operation_id
        );
        return true;
      }
      throw new WorkerLivenessRecreateRetryError(
        'replacement:finalization_cas_conflict'
      );
    }

    await this.releaseRecoveredLivenessCooldown(
      data.worker_id,
      expectedOldContainerId,
      data.lifecycle_operation_id
    );
    await this.publishManagerWorkerRecreateTerminal({
      data,
      workerType: currentWorker.worker_type_id as EWorkerType,
      runtimeGeneration,
      workerStatusId: EWorkerStatus.online,
    });
    this.logDebug('service.recreate_worker.liveness_replacement_finalized', {
      trace_id: data.debug_trace_id,
      layer: 'service',
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id: currentWorker.worker_type_id,
      lifecycle_operation_id: data.lifecycle_operation_id,
      old_container_id: expectedOldContainerId,
      container_id: containerId,
      runtime_generation: runtimeGeneration,
    });
    return true;
  }

  private classifyOwnedLivenessReplacementPhysicalState(
    inspection: WorkerContainerInspection,
    allowReadinessGrace: boolean = true
  ): OwnedLivenessReplacementPhysicalDecision {
    const startedAt = inspection.container_started_at;
    const restartCount = inspection.container_restart_count;
    const healthStatus = (
      inspection.container_health_status ?? 'none'
    ).toLowerCase();
    const paused = inspection.container_paused === true;
    const startedAtMs = startedAt ? Date.parse(startedAt) : Number.NaN;
    if (
      !startedAt ||
      !Number.isFinite(startedAtMs) ||
      typeof restartCount !== 'number' ||
      !Number.isSafeInteger(restartCount) ||
      restartCount < 0 ||
      !['unhealthy', 'healthy', 'starting', 'none'].includes(healthStatus)
    ) {
      return { status: 'incomplete' };
    }

    if (
      allowReadinessGrace &&
      inspection.running === true &&
      !paused &&
      (healthStatus === 'healthy' ||
        (healthStatus === 'starting' &&
          Date.now() - startedAtMs < this.livenessStartingRecoveryWaitMs))
    ) {
      return { status: 'grace' };
    }

    return {
      status: 'terminal',
      startedAt,
      restartCount,
      healthStatus,
      paused,
    };
  }

  private async restoreMissingOrTerminalOnlineLivenessReplacementProvisioning(
    data: IWorkerPayload,
    currentWorker: IWorkerMonitor,
    replacementContainerId: string,
    replacementRuntimeGeneration: number,
    leaseContext: ILockLeaseContext
  ): Promise<IWorkerMonitor> {
    const expectedOldContainerId = data.expected_container_id
      ?.trim()
      .toLowerCase();
    const expectedRuntimeGeneration = data.expected_runtime_generation;
    if (
      !data.lifecycle_operation_id ||
      !expectedOldContainerId ||
      !DOCKER_CONTAINER_ID_PATTERN.test(expectedOldContainerId) ||
      !DOCKER_CONTAINER_ID_PATTERN.test(replacementContainerId) ||
      expectedOldContainerId === replacementContainerId ||
      typeof expectedRuntimeGeneration !== 'number' ||
      !Number.isSafeInteger(expectedRuntimeGeneration) ||
      expectedRuntimeGeneration <= 0 ||
      !Number.isSafeInteger(replacementRuntimeGeneration) ||
      replacementRuntimeGeneration <= expectedRuntimeGeneration ||
      currentWorker.deleted_at ||
      currentWorker.worker_id !== data.worker_id ||
      currentWorker.account_id !== data.account_id ||
      currentWorker.server_id !== data.server_id ||
      currentWorker.worker_status_id !== EWorkerStatus.online ||
      currentWorker.lifecycle_operation_id !== data.lifecycle_operation_id ||
      currentWorker.container_id?.trim().toLowerCase() !==
        replacementContainerId ||
      currentWorker.runtime_container_id?.trim().toLowerCase() !==
        replacementContainerId ||
      currentWorker.runtime_generation !== replacementRuntimeGeneration
    ) {
      throw new WorkerLivenessRecreateRetryError(
        'replacement:failed_target_recovery_identity_changed'
      );
    }

    leaseContext.assertActive();
    const restored =
      await this.workerService.updateWorkerByIdIfLifecycleMatches(
        data.account_id,
        {
          worker_id: data.worker_id,
          worker_status_id: EWorkerStatus.recreating,
          container_id: expectedOldContainerId,
        },
        {
          lifecycle_operation_id: data.lifecycle_operation_id,
          container_id: replacementContainerId,
          runtime_container_id: replacementContainerId,
          runtime_generation: replacementRuntimeGeneration,
          server_id: data.server_id,
          worker_type_id: currentWorker.worker_type_id,
          worker_status_id: EWorkerStatus.online,
        }
      );
    leaseContext.assertActive();

    const refreshed = await this.viewWorkerForMonitorConsistent(data.worker_id);
    leaseContext.assertActive();
    if (
      !refreshed ||
      refreshed.deleted_at ||
      refreshed.worker_id !== data.worker_id ||
      refreshed.account_id !== data.account_id ||
      refreshed.server_id !== data.server_id ||
      refreshed.worker_type_id !== currentWorker.worker_type_id ||
      refreshed.worker_status_id !== EWorkerStatus.recreating ||
      refreshed.lifecycle_operation_id !== data.lifecycle_operation_id ||
      refreshed.container_id?.trim().toLowerCase() !== expectedOldContainerId ||
      refreshed.runtime_container_id?.trim().toLowerCase() !==
        replacementContainerId ||
      refreshed.runtime_generation !== replacementRuntimeGeneration
    ) {
      throw new WorkerLivenessRecreateRetryError(
        restored
          ? 'replacement:failed_target_recovery_postcondition_changed'
          : 'replacement:failed_target_recovery_cas_conflict'
      );
    }

    this.logDebug(
      'service.recreate_worker.liveness_failed_online_target_reprovisioned',
      {
        trace_id: data.debug_trace_id,
        layer: 'service',
        worker_id: data.worker_id,
        account_id: data.account_id,
        worker_type_id: currentWorker.worker_type_id,
        lifecycle_operation_id: data.lifecycle_operation_id,
        old_container_id: expectedOldContainerId,
        failed_container_id: replacementContainerId,
        failed_runtime_generation: replacementRuntimeGeneration,
        reason: restored
          ? 'exact_online_target_rolled_back'
          : 'concurrent_exact_online_target_rollback_confirmed',
      }
    );
    return refreshed;
  }

  private isFailedOnlineLivenessReplacementRuntimeRevoked(
    runtime: IWorkerRuntime | null | undefined,
    containerId: string,
    runtimeGeneration: number,
    lifecycleOperationId: string
  ): boolean {
    return Boolean(
      runtime &&
      runtime.container_id?.trim().toLowerCase() === containerId &&
      runtime.runtime_generation === runtimeGeneration &&
      runtime.recreate_retired_operation_id === lifecycleOperationId &&
      runtime.recreate_retired_runtime_generation === runtimeGeneration &&
      runtime.recreate_retired_container_id?.trim().toLowerCase() ===
        containerId &&
      Boolean(runtime.recreate_retired_at) &&
      !runtime.runtime_capability_hash &&
      !runtime.session_writer_epoch &&
      !runtime.connection_epoch &&
      runtime.connection_sequence === 0 &&
      !runtime.source_provider &&
      !runtime.connection_activated_at &&
      !runtime.recreate_bootstrap_operation_id &&
      !runtime.recreate_bootstrap_runtime_generation &&
      !runtime.recreate_bootstrap_container_id &&
      !runtime.recreate_bootstrap_started_at
    );
  }

  private async revokeFailedOnlineLivenessReplacementRuntime(
    data: IWorkerPayload,
    currentWorker: IWorkerMonitor,
    replacementContainerId: string,
    replacementRuntimeGeneration: number,
    leaseContext: ILockLeaseContext
  ): Promise<void> {
    const expectedOldContainerId = data.expected_container_id
      ?.trim()
      .toLowerCase();
    const expectedOldRuntimeGeneration = data.expected_runtime_generation;
    if (
      !data.lifecycle_operation_id ||
      !expectedOldContainerId ||
      typeof expectedOldRuntimeGeneration !== 'number' ||
      typeof this.workerRuntimeRepository
        .revokeFailedOnlineLivenessReplacementRuntime !== 'function'
    ) {
      throw new WorkerLivenessRecreateRetryError(
        'replacement:runtime_revoke_identity_incomplete'
      );
    }

    leaseContext.assertActive();
    const revoked =
      await this.workerRuntimeRepository.revokeFailedOnlineLivenessReplacementRuntime(
        {
          worker_id: data.worker_id,
          account_id: data.account_id,
          server_id: data.server_id,
          worker_type_id: currentWorker.worker_type_id as EWorkerType,
          lifecycle_operation_id: data.lifecycle_operation_id,
          expected_old_container_id: expectedOldContainerId,
          expected_old_runtime_generation: expectedOldRuntimeGeneration,
          failed_container_id: replacementContainerId,
          failed_runtime_generation: replacementRuntimeGeneration,
        }
      );
    leaseContext.assertActive();
    if (!revoked) {
      throw new WorkerLivenessRecreateRetryError(
        'replacement:runtime_revoke_cas_conflict'
      );
    }

    const [worker, runtime] = await Promise.all([
      this.viewWorkerForMonitorConsistent(data.worker_id),
      this.workerRuntimeRepository.viewByWorkerIdConsistent(data.worker_id),
    ]);
    leaseContext.assertActive();
    if (
      !worker ||
      worker.deleted_at ||
      worker.worker_id !== data.worker_id ||
      worker.account_id !== data.account_id ||
      worker.server_id !== data.server_id ||
      worker.worker_type_id !== currentWorker.worker_type_id ||
      worker.worker_status_id !== EWorkerStatus.recreating ||
      worker.lifecycle_operation_id !== data.lifecycle_operation_id ||
      worker.container_id?.trim().toLowerCase() !== expectedOldContainerId ||
      !runtime?.recreate_retired_at ||
      !this.isFailedOnlineLivenessReplacementRuntimeRevoked(
        runtime,
        replacementContainerId,
        replacementRuntimeGeneration,
        data.lifecycle_operation_id
      )
    ) {
      throw new WorkerLivenessRecreateRetryError(
        'replacement:runtime_revoke_postcondition_changed'
      );
    }

    const state = buildManagerWorkerRecreateRuntimeRetiredStatusEvent(
      {
        action: EWorkerAction.recreate,
        worker_id: data.worker_id,
        account_id: data.account_id,
        server_id: data.server_id,
        worker_type_id: currentWorker.worker_type_id as EWorkerType,
        lifecycle_operation_id: data.lifecycle_operation_id,
        debug_trace_id: data.debug_trace_id,
        previous_worker_type_id: data.previous_worker_type_id,
      },
      replacementRuntimeGeneration,
      runtime.recreate_retired_at
    );
    await Promise.all([
      this.centrifugoService.publishSubStrict(
        workerCentrifugoQueue(data.account_id),
        state
      ),
      this.centrifugoService.publishStrict(channelsConfigCentrifugo(), state),
    ]);
    leaseContext.assertActive();
    this.logDebug('service.recreate_worker.runtime_retired_published', {
      trace_id: data.debug_trace_id,
      layer: 'service',
      worker_id: data.worker_id,
      account_id: data.account_id,
      server_id: data.server_id,
      worker_type_id: currentWorker.worker_type_id,
      lifecycle_operation_id: data.lifecycle_operation_id,
      runtime_generation: replacementRuntimeGeneration,
      recreate_retired_at: runtime.recreate_retired_at,
    });
  }

  private async reconcileOwnedLivenessReplacement(
    data: IWorkerPayload,
    currentWorker: IWorkerMonitor,
    leaseContext: ILockLeaseContext
  ): Promise<OwnedLivenessReplacementDecision> {
    const expectedContainerId = data.expected_container_id
      ?.trim()
      .toLowerCase();
    const expectedRuntimeGeneration = data.expected_runtime_generation;
    const replacementContainerId = currentWorker.runtime_container_id
      ?.trim()
      .toLowerCase();
    const replacementRuntimeGeneration = currentWorker.runtime_generation;
    const controlContainerId = currentWorker.container_id?.trim().toLowerCase();
    const workerPointerAlreadyTargetsReplacement = Boolean(
      replacementContainerId &&
      controlContainerId === replacementContainerId &&
      currentWorker.worker_status_id === EWorkerStatus.online &&
      currentWorker.lifecycle_operation_id === data.lifecycle_operation_id
    );
    if (
      !expectedContainerId ||
      !DOCKER_CONTAINER_ID_PATTERN.test(expectedContainerId) ||
      (currentWorker.worker_status_id !== EWorkerStatus.recreating &&
        currentWorker.worker_status_id !== EWorkerStatus.online) ||
      !replacementContainerId ||
      !DOCKER_CONTAINER_ID_PATTERN.test(replacementContainerId) ||
      (controlContainerId !== expectedContainerId &&
        !workerPointerAlreadyTargetsReplacement) ||
      replacementContainerId === expectedContainerId ||
      typeof expectedRuntimeGeneration !== 'number' ||
      !Number.isSafeInteger(expectedRuntimeGeneration) ||
      typeof replacementRuntimeGeneration !== 'number' ||
      !Number.isSafeInteger(replacementRuntimeGeneration) ||
      replacementRuntimeGeneration <= expectedRuntimeGeneration
    ) {
      return 'not_applicable';
    }

    const replacementRuntime =
      await this.workerRuntimeRepository?.viewByWorkerIdConsistent(
        data.worker_id
      );
    leaseContext.assertActive();
    const failedReplacementRuntimeRevoked = Boolean(
      !workerPointerAlreadyTargetsReplacement &&
      controlContainerId === expectedContainerId &&
      this.isFailedOnlineLivenessReplacementRuntimeRevoked(
        replacementRuntime,
        replacementContainerId,
        replacementRuntimeGeneration,
        data.lifecycle_operation_id as string
      )
    );

    leaseContext.assertActive();
    let inspection = await this.inspectRecreateContainerStrict(
      data,
      replacementContainerId
    );
    leaseContext.assertActive();
    if (!inspection.exists) {
      if (workerPointerAlreadyTargetsReplacement) {
        await this.restoreMissingOrTerminalOnlineLivenessReplacementProvisioning(
          data,
          currentWorker,
          replacementContainerId,
          replacementRuntimeGeneration,
          leaseContext
        );
      }
      await this.revokeFailedOnlineLivenessReplacementRuntime(
        data,
        currentWorker,
        replacementContainerId,
        replacementRuntimeGeneration,
        leaseContext
      );
      return workerPointerAlreadyTargetsReplacement ? 'reprovision' : 'removed';
    }
    if (
      !this.isOwnedLivenessReplacementIdentity(
        data,
        currentWorker,
        inspection,
        replacementContainerId,
        replacementRuntimeGeneration
      )
    ) {
      throw new WorkerLivenessRecreateRetryError(
        'replacement:identity_changed'
      );
    }

    if (
      inspection.running !== true &&
      inspection.container_paused !== true &&
      !workerPointerAlreadyTargetsReplacement &&
      !failedReplacementRuntimeRevoked
    ) {
      const expectedProvider =
        WORKER_TYPE_SOURCE_PROVIDER[
          currentWorker.worker_type_id as EWorkerType
        ];
      const hasRuntimeCapabilityHash = /^[0-9a-f]{64}$/u.test(
        replacementRuntime?.runtime_capability_hash ?? ''
      );
      const hasSessionWriterEpoch =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
          replacementRuntime?.session_writer_epoch ?? ''
        );
      const hasCompleteWriterIdentity =
        hasRuntimeCapabilityHash && hasSessionWriterEpoch;
      const canRetireWriterlessLegacyReplacement = Boolean(
        replacementRuntime &&
        currentWorker.session_storage === EWorkerSessionStorage.legacy_volume &&
        replacementRuntime.session_storage ===
          EWorkerSessionStorage.legacy_volume &&
        replacementRuntime.runtime_capability_hash === null &&
        replacementRuntime.session_writer_epoch === null
      );
      if (
        !replacementRuntime ||
        replacementRuntime.container_id?.trim().toLowerCase() !==
          replacementContainerId ||
        replacementRuntime.runtime_generation !==
          replacementRuntimeGeneration ||
        !expectedProvider ||
        (replacementRuntime.source_provider !== null &&
          replacementRuntime.source_provider !== undefined &&
          replacementRuntime.source_provider !== expectedProvider) ||
        (!hasCompleteWriterIdentity && !canRetireWriterlessLegacyReplacement)
      ) {
        throw new WorkerLivenessRecreateRetryError(
          'replacement:database_identity_changed'
        );
      }
      if (hasCompleteWriterIdentity) {
        const writerIdentity =
          await this.workerService.inspectRuntimeWriterIdentityByContainerIdStrict(
            replacementContainerId
          );
        leaseContext.assertActive();
        if (
          createHash('sha256')
            .update(writerIdentity.runtimeCapability)
            .digest('hex') !== replacementRuntime.runtime_capability_hash ||
          writerIdentity.writerEpoch !== replacementRuntime.session_writer_epoch
        ) {
          throw new WorkerLivenessRecreateRetryError(
            'replacement:writer_identity_changed'
          );
        }
        this.runtimeWriterIdentities.set(
          this.runtimeWriterIdentityKey(
            data.worker_id,
            replacementRuntimeGeneration
          ),
          writerIdentity
        );
        const started = await this.workerService.startContainerWorkerById(
          replacementContainerId
        );
        leaseContext.assertActive();
        if (!started) {
          throw new WorkerLivenessRecreateRetryError(
            'replacement:start_failed'
          );
        }
        inspection = await this.inspectRecreateContainerStrict(
          data,
          replacementContainerId
        );
        leaseContext.assertActive();
        if (
          !this.isOwnedLivenessReplacementIdentity(
            data,
            currentWorker,
            inspection,
            replacementContainerId,
            replacementRuntimeGeneration
          )
        ) {
          throw new WorkerLivenessRecreateRetryError(
            'replacement:identity_changed_after_start'
          );
        }
      } else {
        /*
         * Runtimes created before writer identities were introduced cannot be
         * authenticated strongly enough to restart. The exact legacy-volume
         * lifecycle target is still safe to retire below using its immutable
         * Docker labels and the runtime-table CAS. A later redrive provisions
         * a fresh generation with a writer identity instead of retrying this
         * unstartable target forever.
         */
        this.logDebug(
          'service.recreate_worker.liveness_writerless_legacy_replacement_retired',
          {
            trace_id: data.debug_trace_id,
            layer: 'service',
            worker_id: data.worker_id,
            account_id: data.account_id,
            worker_type_id: currentWorker.worker_type_id,
            lifecycle_operation_id: data.lifecycle_operation_id,
            runtime_generation: replacementRuntimeGeneration,
            container_id: replacementContainerId,
          }
        );
      }
    }

    let physicalDecision = this.classifyOwnedLivenessReplacementPhysicalState(
      inspection,
      !failedReplacementRuntimeRevoked
    );
    let markerReady = !failedReplacementRuntimeRevoked;
    if (
      inspection.running === true &&
      inspection.container_paused !== true &&
      !failedReplacementRuntimeRevoked
    ) {
      try {
        await this.markAndPublishRecreateRuntimeStarted({
          data,
          workerType: currentWorker.worker_type_id as EWorkerType,
          containerId: replacementContainerId,
          runtimeGeneration: replacementRuntimeGeneration,
          leaseContext,
        });
      } catch (error) {
        leaseContext.assertActive();
        if (
          !workerPointerAlreadyTargetsReplacement ||
          physicalDecision.status !== 'terminal'
        ) {
          throw error;
        }
        markerReady = false;
        this.logDebug(
          'service.recreate_worker.liveness_terminal_target_marker_unavailable',
          {
            trace_id: data.debug_trace_id,
            layer: 'service',
            worker_id: data.worker_id,
            account_id: data.account_id,
            worker_type_id: currentWorker.worker_type_id,
            lifecycle_operation_id: data.lifecycle_operation_id,
            runtime_generation: replacementRuntimeGeneration,
            reason: getErrorMessage(error),
          }
        );
      }
    }

    const replacementDockerOperational =
      inspection.running === true &&
      inspection.container_paused !== true &&
      ['healthy', 'starting'].includes(
        (inspection.container_health_status ?? 'none').toLowerCase()
      );
    const strictHealth =
      replacementDockerOperational && markerReady
        ? await this.loadStrictLivenessRuntimeHealth(
            data,
            currentWorker,
            replacementRuntimeGeneration,
            leaseContext
          )
        : null;
    if (strictHealth) {
      await this.finalizeOwnedLivenessReplacement(
        data,
        currentWorker,
        replacementContainerId,
        replacementRuntimeGeneration,
        leaseContext
      );
      return 'recovered';
    }

    if (physicalDecision.status === 'grace') {
      throw new WorkerLivenessRecreateRetryError(
        'replacement:provider_not_ready'
      );
    }
    if (physicalDecision.status === 'incomplete') {
      throw new WorkerLivenessRecreateRetryError(
        'replacement:incomplete_docker_observation'
      );
    }

    if (workerPointerAlreadyTargetsReplacement) {
      await this.restoreMissingOrTerminalOnlineLivenessReplacementProvisioning(
        data,
        currentWorker,
        replacementContainerId,
        replacementRuntimeGeneration,
        leaseContext
      );
      inspection = await this.inspectRecreateContainerStrict(
        data,
        replacementContainerId
      );
      leaseContext.assertActive();
      if (!inspection.exists) {
        await this.revokeFailedOnlineLivenessReplacementRuntime(
          data,
          currentWorker,
          replacementContainerId,
          replacementRuntimeGeneration,
          leaseContext
        );
        return 'reprovision';
      }
      if (
        !this.isOwnedLivenessReplacementIdentity(
          data,
          currentWorker,
          inspection,
          replacementContainerId,
          replacementRuntimeGeneration
        )
      ) {
        throw new WorkerLivenessRecreateRetryError(
          'replacement:identity_changed_after_recovery_cas'
        );
      }
      physicalDecision =
        this.classifyOwnedLivenessReplacementPhysicalState(inspection);
      if (physicalDecision.status !== 'terminal') {
        throw new WorkerLivenessRecreateRetryError(
          physicalDecision.status === 'grace'
            ? 'replacement:state_recovered_after_recovery_cas'
            : 'replacement:incomplete_observation_after_recovery_cas'
        );
      }
    }

    await this.revokeFailedOnlineLivenessReplacementRuntime(
      data,
      currentWorker,
      replacementContainerId,
      replacementRuntimeGeneration,
      leaseContext
    );

    const removed =
      await this.workerService.removeContainerIfLivenessFenceMatches({
        containerId: replacementContainerId,
        startedAt: physicalDecision.startedAt,
        restartCount: physicalDecision.restartCount,
        healthStatus: physicalDecision.healthStatus,
        paused: physicalDecision.paused,
        workerId: data.worker_id,
        accountId: data.account_id,
        serverId: data.server_id,
        workerTypeId: currentWorker.worker_type_id,
        runtimeGeneration: replacementRuntimeGeneration,
        forceRemove: true,
        retiredLifecycleOperationId: data.lifecycle_operation_id,
        warmPoolId:
          replacementRuntime?.container_id === replacementContainerId
            ? (replacementRuntime.warm_pool_id ?? undefined)
            : undefined,
        sessionStorage:
          replacementRuntime?.container_id === replacementContainerId
            ? replacementRuntime.session_storage
            : currentWorker.session_storage,
      });
    leaseContext.assertActive();
    if (removed.status !== 'removed') {
      throw new WorkerLivenessRecreateRetryError(
        `replacement:remove_${removed.status}:${removed.reason}`
      );
    }
    return workerPointerAlreadyTargetsReplacement ? 'reprovision' : 'removed';
  }

  private async revalidateLivenessRecreateFence(
    data: IWorkerPayload,
    currentWorker: IWorkerMonitor,
    leaseContext: ILockLeaseContext
  ): Promise<LivenessRecreatePreflightDecision> {
    const expectedContainerId = data.expected_container_id
      ?.trim()
      .toLowerCase();
    if (!expectedContainerId) {
      return 'proceed';
    }

    leaseContext.assertActive();
    const inspection = await this.inspectRecreateContainerStrict(
      data,
      expectedContainerId
    );
    leaseContext.assertActive();
    const runtime =
      await this.workerRuntimeRepository?.viewByWorkerIdConsistent(
        data.worker_id
      );
    leaseContext.assertActive();
    const mismatch = this.resolveLivenessRecreateFenceMismatch(
      data,
      currentWorker,
      inspection,
      runtime
    );
    if (!mismatch) {
      return 'proceed';
    }

    if (
      mismatch === 'control_plane_runtime_changed' &&
      currentWorker.container_id?.trim().toLowerCase() ===
        expectedContainerId &&
      typeof data.expected_runtime_generation === 'number' &&
      typeof currentWorker.runtime_generation === 'number' &&
      Number.isSafeInteger(currentWorker.runtime_generation) &&
      currentWorker.runtime_generation > data.expected_runtime_generation
    ) {
      // The same lifecycle may have crashed after reserving/upserting its
      // replacement runtime but before the final worker-table CAS. The owned
      // replacement reconciler above either finalized or removed that exact
      // labelled generation. Continue the same durable operation instead of
      // treating its own partial effect as a foreign runtime.
      return 'proceed';
    }

    if (mismatch === 'container_missing') {
      return 'proceed';
    }
    if (mismatch === 'docker_runtime_observation_changed') {
      // A failed local restart may advance StartedAt/RestartCount while the
      // exact runtime changes state. The host-side compare-and-remove helper
      // takes a fresh snapshot after restart=no, and provider/Kafka readiness
      // is checked before any online compensation.
      return 'proceed';
    }

    this.logDebug('service.recreate_worker.liveness_fence_stale', {
      trace_id: data.debug_trace_id,
      layer: 'service',
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id: currentWorker.worker_type_id,
      lifecycle_operation_id: data.lifecycle_operation_id,
      container_id: expectedContainerId,
      runtime_generation: data.expected_runtime_generation,
      reason: `preflight:${mismatch}`,
    });
    return 'stale';
  }

  private async removeRecreateRuntimeContainer(
    data: IWorkerPayload,
    shouldRemoveVolume: boolean,
    currentWorker: IWorkerMonitor,
    leaseContext: ILockLeaseContext
  ): Promise<RecreateRuntimeRemovalDecision> {
    if (data.expected_container_id) {
      const expectedContainerId = data.expected_container_id
        .trim()
        .toLowerCase();
      const recoveryDeadline = Date.now() + this.livenessStartingRecoveryWaitMs;
      let previousObservedRestartCount: number | undefined;
      let forceRemove = false;
      const removalRuntime =
        await this.workerRuntimeRepository?.viewByWorkerIdConsistent(
          data.worker_id
        );
      leaseContext.assertActive();

      while (true) {
        leaseContext.assertActive();
        const result =
          await this.workerService.removeContainerIfLivenessFenceMatches({
            containerId: expectedContainerId,
            startedAt: data.expected_container_started_at ?? '',
            restartCount: data.expected_container_restart_count ?? -1,
            healthStatus: data.expected_container_health_status ?? '',
            paused: data.expected_container_paused === true,
            workerId: data.worker_id,
            accountId: data.account_id,
            serverId: data.server_id,
            workerTypeId: currentWorker.worker_type_id,
            runtimeGeneration: data.expected_runtime_generation ?? -1,
            forceRemove,
            warmPoolId:
              removalRuntime?.container_id?.trim().toLowerCase() ===
              expectedContainerId
                ? (removalRuntime.warm_pool_id ?? undefined)
                : undefined,
            sessionStorage:
              removalRuntime?.container_id?.trim().toLowerCase() ===
              expectedContainerId
                ? removalRuntime.session_storage
                : currentWorker.session_storage,
          });
        leaseContext.assertActive();
        if (result.status !== 'pending' && result.status !== 'recovered') {
          return result;
        }

        if (result.status === 'recovered') {
          const compensation = await this.compensateRecoveredLivenessRecreate(
            data,
            currentWorker,
            `conditional_remove:${result.reason}`,
            leaseContext
          );
          if (compensation === 'restored' || compensation === 'superseded') {
            return result;
          }
          throw new WorkerLivenessRecreateRetryError(
            'pending:local_liveness_recovered_readiness_pending'
          );
        }

        if (forceRemove) {
          throw new WorkerLivenessRecreateRetryError(
            'pending:forced_liveness_removal'
          );
        }

        const observedRestartCount = result.observedRestartCount;
        if (
          observedRestartCount === undefined ||
          (previousObservedRestartCount !== undefined &&
            observedRestartCount < previousObservedRestartCount)
        ) {
          throw new WorkerLivenessRecreateRetryError(
            'pending:invalid_restart_observation'
          );
        }
        const restartAdvanced =
          previousObservedRestartCount !== undefined &&
          observedRestartCount > previousObservedRestartCount;
        if (restartAdvanced || Date.now() >= recoveryDeadline) {
          forceRemove = true;
          continue;
        }

        previousObservedRestartCount = observedRestartCount;
        const remainingMs = recoveryDeadline - Date.now();
        await this.sleep(
          Math.min(
            this.livenessStartingRecoveryPollIntervalMs,
            Math.max(1, remainingMs)
          )
        );
        leaseContext.assertActive();
      }
    }

    if (!data.lifecycle_operation_id) {
      throw new Error('worker_runtime_removal_requires_lifecycle_identity');
    }

    const removed = await this.removeRuntimeContainerWithLifecycleProof(
      data,
      shouldRemoveVolume,
      currentWorker,
      leaseContext
    );
    return {
      status: removed ? 'removed' : 'retry',
      reason: removed ? 'runtime_removed_by_proof' : 'runtime_remove_failed',
    };
  }

  /**
   * A legacy-to-PostgreSQL target does not own the source runtime removal:
   * its prepared cleanup dependency proves and removes that local volume
   * first. All other recreates retain the regular retrying removal path.
   */
  private async resolveRecreateRuntimeRemovalDecision(
    data: IWorkerPayload,
    shouldRemoveVolume: boolean,
    currentWorker: IWorkerMonitor,
    leaseContext: ILockLeaseContext
  ): Promise<RecreateRuntimeRemovalDecision> {
    leaseContext.assertActive();
    await this.assertLifecycleOperationCurrent(data, 'runtime removal');
    if (this.isLegacyVolumeToPostgresConversion(data)) {
      return {
        status: 'removed',
        reason: 'legacy_source_cleanup_owned',
      };
    }

    return this.retryOperation(
      async () => {
        leaseContext.assertActive();
        await this.assertLifecycleOperationCurrent(data, 'runtime removal');
        const result = await this.removeRecreateRuntimeContainer(
          data,
          shouldRemoveVolume,
          currentWorker,
          leaseContext
        );
        leaseContext.assertActive();
        return result;
      },
      (result) => result.status === 'retry'
    );
  }

  private async recreateWorker(
    data: IWorkerPayload,
    lifecycleLease: ILockLeaseContext,
    slotControl?: WorkerRecreateServerSlotControl
  ): Promise<PublishResult> {
    try {
      return await this.performRecreateWorker(
        data,
        lifecycleLease,
        slotControl
      );
    } catch (error) {
      if (error instanceof WorkerLivenessRecreateRetryError) {
        throw error;
      }
      lifecycleLease.assertActive();
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.action,
        data.server_id,
        data.lifecycle_operation_id
      ).catch(() => undefined);
      throw error;
    }
  }

  private async resolveRecreateExecutionContext(
    data: IWorkerPayload,
    leaseContext: ILockLeaseContext
  ): Promise<RecreateExecutionContext | null> {
    leaseContext.assertActive();
    let currentWorker = await this.viewWorkerForMonitorConsistent(
      data.worker_id
    );
    leaseContext.assertActive();
    if (
      !currentWorker ||
      currentWorker.deleted_at ||
      currentWorker.account_id !== data.account_id ||
      currentWorker.server_id !== data.server_id
    ) {
      this.logDebug('service.recreate_worker.stale', {
        trace_id: data.debug_trace_id,
        layer: 'service',
        worker_id: data.worker_id,
        account_id: data.account_id,
        worker_type_id: data.worker_type_id,
        lifecycle_operation_id: data.lifecycle_operation_id,
        reason: 'worker_snapshot_not_current',
      });
      return null;
    }

    const currentWorkerType = currentWorker.worker_type_id as EWorkerType;
    const requestedWorkerType = data.worker_type_id;
    const targetHandoffAuthorized = Boolean(
      requestedWorkerType &&
      requestedWorkerType !== currentWorkerType &&
      (await this.isPostgresProviderHandoffTargetAuthorized(
        data,
        currentWorker
      ))
    );
    if (
      requestedWorkerType &&
      requestedWorkerType !== currentWorkerType &&
      !targetHandoffAuthorized
    ) {
      this.logDebug('service.recreate_worker.stale', {
        trace_id: data.debug_trace_id,
        layer: 'service',
        worker_id: data.worker_id,
        account_id: data.account_id,
        worker_type_id: data.worker_type_id,
        current_worker_type_id: currentWorkerType,
        lifecycle_operation_id: data.lifecycle_operation_id,
        reason: 'worker_type_not_current',
      });
      return null;
    }
    if (
      data.previous_worker_type_id === undefined ||
      (targetHandoffAuthorized && requestedWorkerType)
    ) {
      /*
       * Older lifecycle publishers may omit the source type, and a malformed
       * handoff retry may even repeat the target type. This authoritative
       * snapshot identifies ordinary same-provider recreates directly; for a
       * provider change, the exact handoff authorization additionally proves
       * that it is still the source. Hydrate the command before any source
       * runtime effect can occur.
       */
      data.previous_worker_type_id = currentWorkerType;
    }
    const workerType =
      targetHandoffAuthorized && requestedWorkerType
        ? requestedWorkerType
        : currentWorkerType;

    const ownedReplacementDecision =
      await this.reconcileOwnedLivenessReplacement(
        data,
        currentWorker,
        leaseContext
      );
    if (ownedReplacementDecision === 'recovered') {
      return null;
    }
    if (ownedReplacementDecision === 'reprovision') {
      const refreshed = await this.viewWorkerForMonitorConsistent(
        data.worker_id
      );
      leaseContext.assertActive();
      if (
        !refreshed ||
        refreshed.deleted_at ||
        refreshed.worker_id !== data.worker_id ||
        refreshed.account_id !== data.account_id ||
        refreshed.server_id !== data.server_id ||
        refreshed.worker_type_id !== currentWorkerType ||
        refreshed.worker_status_id !== EWorkerStatus.recreating ||
        refreshed.lifecycle_operation_id !== data.lifecycle_operation_id
      ) {
        throw new WorkerLivenessRecreateRetryError(
          'replacement:reprovision_snapshot_changed'
        );
      }
      currentWorker = refreshed;
    }

    const livenessPreflightDecision =
      await this.revalidateLivenessRecreateFence(
        data,
        currentWorker,
        leaseContext
      );
    if (livenessPreflightDecision === 'recovered') {
      return null;
    }
    if (livenessPreflightDecision === 'stale') {
      throw new WorkerLivenessRecreateRetryError('stale:preflight');
    }

    return { currentWorker, workerType };
  }

  private async beginRecreateWorker(
    data: IWorkerPayload,
    leaseContext: ILockLeaseContext
  ): Promise<boolean> {
    leaseContext.assertActive();
    this.logDebug('service.recreate_worker.start', {
      trace_id: data.debug_trace_id,
      layer: 'service',
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id: data.worker_type_id,
      lifecycle_operation_id: data.lifecycle_operation_id,
      remove_session: data.remove_session === true,
      remove_volume: data.remove_volume === true,
    });
    if (await this.isLifecycleOperationCurrent(data, {}, true)) {
      leaseContext.assertActive();
      return true;
    }

    const completed = await this.viewWorkerForMonitorConsistent(data.worker_id);
    leaseContext.assertActive();
    if (
      data.lifecycle_operation_id &&
      completed?.runtime_generation &&
      this.hasExactRecreateCompletion(
        data,
        completed,
        completed.worker_type_id as EWorkerType,
        completed.runtime_generation
      )
    ) {
      await this.publishManagerWorkerRecreateTerminal({
        data,
        workerType: completed.worker_type_id as EWorkerType,
        runtimeGeneration: completed.runtime_generation,
        workerStatusId: completed.worker_status_id as
          EWorkerStatus.online | EWorkerStatus.disponible,
      });
      leaseContext.assertActive();
      this.logDebug('service.recreate_worker.terminal_republished', {
        trace_id: data.debug_trace_id,
        layer: 'service',
        worker_id: data.worker_id,
        account_id: data.account_id,
        worker_type_id: completed.worker_type_id,
        lifecycle_operation_id: data.lifecycle_operation_id,
        runtime_generation: completed.runtime_generation,
      });
      return false;
    }

    if (await this.isPostgresProviderHandoffTargetPendingSourceDrain(data)) {
      leaseContext.assertActive();
      this.logDebug('service.provider_handoff.target_waiting_source_drain', {
        trace_id: data.debug_trace_id,
        layer: 'service',
        worker_id: data.worker_id,
        account_id: data.account_id,
        worker_type_id: data.worker_type_id,
        previous_worker_type_id: data.previous_worker_type_id,
        lifecycle_operation_id: data.lifecycle_operation_id,
        reason: 'source_drain_not_committed',
      });
      throw new WorkerLivenessRecreateRetryError(
        'pending:whatsapp_handoff_source_drain'
      );
    }

    this.logDebug('service.recreate_worker.stale', {
      trace_id: data.debug_trace_id,
      layer: 'service',
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id: data.worker_type_id,
      lifecycle_operation_id: data.lifecycle_operation_id,
      reason: 'lifecycle_operation_not_current',
    });
    return false;
  }

  /**
   * A discard decision has two independently delivered Kafka commands. The
   * primary recreate must never overtake source cleanup, otherwise it could
   * open the target provider over the still-present source projection. The
   * database timestamp is written in the same fenced transaction that clears
   * the session, after the exact source container has been removed.
   */
  private async assertWhatsappHandoffDiscardCleanupCompleted(
    data: IWorkerPayload,
    leaseContext: ILockLeaseContext
  ): Promise<void> {
    if (
      this.sessionStorageFor(data) !== EWorkerSessionStorage.postgres ||
      !data.lifecycle_operation_id ||
      typeof this.workerRuntimeRepository
        .viewWhatsappProviderHandoffDiscardPrimaryGate !== 'function'
    ) {
      return;
    }

    const gate =
      await this.workerRuntimeRepository.viewWhatsappProviderHandoffDiscardPrimaryGate(
        {
          worker_id: data.worker_id,
          account_id: data.account_id,
          operation_id: data.lifecycle_operation_id,
        }
      );
    leaseContext.assertActive();
    if (!gate) return;

    const sourceProvider = data.previous_worker_type_id
      ? WORKER_TYPE_SOURCE_PROVIDER[data.previous_worker_type_id]
      : undefined;
    const targetProvider = data.worker_type_id
      ? WORKER_TYPE_SOURCE_PROVIDER[data.worker_type_id]
      : undefined;
    if (
      gate.operation_id !== data.lifecycle_operation_id ||
      !sourceProvider ||
      !targetProvider ||
      gate.source_provider !== sourceProvider ||
      gate.target_provider !== targetProvider
    ) {
      this.logDebug('service.provider_handoff.discard_primary_invalid', {
        trace_id: data.debug_trace_id,
        layer: 'service',
        worker_id: data.worker_id,
        account_id: data.account_id,
        worker_type_id: data.worker_type_id,
        previous_worker_type_id: data.previous_worker_type_id,
        lifecycle_operation_id: data.lifecycle_operation_id,
        handoff_id: gate.handoff_id,
        reason: 'discard_primary_identity_mismatch',
      });
      throw new WorkerLivenessRecreateRetryError(
        'pending:whatsapp_handoff_discard_identity'
      );
    }

    if (gate.session_present || !gate.cleanup_finalized_at) {
      this.logDebug('service.provider_handoff.discard_primary_waiting', {
        trace_id: data.debug_trace_id,
        layer: 'service',
        worker_id: data.worker_id,
        account_id: data.account_id,
        worker_type_id: data.worker_type_id,
        lifecycle_operation_id: data.lifecycle_operation_id,
        handoff_id: gate.handoff_id,
        session_present: gate.session_present,
        cleanup_finalized: Boolean(gate.cleanup_finalized_at),
        reason: 'source_cleanup_not_committed',
      });
      throw new WorkerLivenessRecreateRetryError(
        'pending:whatsapp_handoff_discard_cleanup'
      );
    }

    this.logDebug('service.provider_handoff.discard_primary_released', {
      trace_id: data.debug_trace_id,
      layer: 'service',
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id: data.worker_type_id,
      lifecycle_operation_id: data.lifecycle_operation_id,
      handoff_id: gate.handoff_id,
      reason: 'source_cleanup_committed',
    });
  }

  private async prepareRecreateWorker(
    data: IWorkerPayload,
    leaseContext: ILockLeaseContext
  ): Promise<boolean> {
    if (!(await this.beginRecreateWorker(data, leaseContext))) {
      return false;
    }

    await this.assertWhatsappHandoffDiscardCleanupCompleted(data, leaseContext);
    return true;
  }

  private async performRecreateWorker(
    data: IWorkerPayload,
    leaseContext: ILockLeaseContext,
    slotControl?: WorkerRecreateServerSlotControl
  ): Promise<PublishResult> {
    if (!(await this.prepareRecreateWorker(data, leaseContext))) {
      return {} as PublishResult;
    }

    const executionContext = await this.resolveRecreateExecutionContext(
      data,
      leaseContext
    );
    if (!executionContext) {
      return {} as PublishResult;
    }
    /*
     * Provision and pin immutable content while the current runtime is still
     * available. Registry or alias-resolution failure must never turn a
     * healthy channel into downtime. The pinned content remains valid if the
     * mutable alias advances during the recreate.
     */
    const { currentWorker, workerType } = executionContext,
      imageName = getImageWorker(workerType),
      recreateImageContentId = await this.resolveStableWorkerImageContentId(
        workerType,
        leaseContext
      );
    leaseContext.assertActive();

    await this.assertMissingJournalRecreateProviderSafe(
      data,
      currentWorker,
      workerType,
      leaseContext
    );

    const {
      shouldRemoveSession,
      sessionStorage,
      shouldRemoveVolume,
      sessionVolumeResolution,
      preservedSessionVolumeName,
      sessionWasReset,
    } = await this.resolveRecreateSessionContext(data, leaseContext);
    const recreateSessionVolumeName =
      sessionStorage === EWorkerSessionStorage.postgres
        ? null
        : (preservedSessionVolumeName ?? data.worker_id);
    const adoptedColdRuntime = await this.adoptPersistedColdRuntimeIfPresent({
      data,
      workerType,
      sessionStorage,
      sessionVolumeName: recreateSessionVolumeName,
      expectedWorkerStatus: EWorkerStatus.recreating,
      expectedImageContentId: recreateImageContentId,
      leaseContext,
    });
    if (adoptedColdRuntime?.status === 'adopted') {
      await this.releaseRecreateSlotAndMarkRuntimeStarted({
        data,
        workerType,
        containerId: adoptedColdRuntime.containerId,
        runtimeGeneration: adoptedColdRuntime.runtimeGeneration,
        leaseContext,
        slotControl,
      });
      return this.finalizeAdoptedRecreateRuntime({
        data,
        workerType,
        controlContainerId: currentWorker.container_id,
        containerId: adoptedColdRuntime.containerId,
        runtimeGeneration: adoptedColdRuntime.runtimeGeneration,
        sessionWasReset: shouldRemoveSession || sessionWasReset,
        leaseContext,
      });
    }
    const persistedColdRuntimeRemovalProven =
      adoptedColdRuntime?.status === 'stale_image_removed' ||
      adoptedColdRuntime?.status === 'absent_cross_server_handoff_target' ||
      adoptedColdRuntime?.status === 'reserved_cross_server_handoff_target';

    this.logDebug('service.recreate_worker.session_volume_resolved', {
      trace_id: data.debug_trace_id,
      layer: 'service',
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id: workerType,
      lifecycle_operation_id: data.lifecycle_operation_id,
      resolution_source: sessionVolumeResolution.source,
      session_volume_preserved: Boolean(preservedSessionVolumeName),
      session_identity_reset: shouldRemoveSession || sessionWasReset,
      runtime_was_backfilled: sessionVolumeResolution.runtimeWasBackfilled,
    });

    if (!(await this.isLifecycleOperationCurrent(data))) {
      return {} as PublishResult;
    }
    leaseContext.assertActive();

    await this.invalidateQrAttemptState(
      data.worker_id,
      {
        accountId: data.account_id,
        workerType,
        previousWorkerType: data.previous_worker_type_id,
        reason: 'worker_recreate',
        recreateReason: shouldRemoveVolume
          ? 'recreate_with_volume_reset'
          : 'recreate_container_replaced',
        debugTraceId: data.debug_trace_id,
      },
      leaseContext
    );

    if (shouldRemoveSession && shouldRemoveVolume) {
    } else if (shouldRemoveSession) {
      await this.assertLifecycleOperationCurrent(
        data,
        'provider session disconnect'
      );
      const disconnectPayload: StatusConnectionWorkerRequest = {
        worker_id: data.worker_id,
        status: EWorkerStatus.disponible,
        type: EBaileysConnectionType.qrcode,
        remove_session: true,
        debug_trace_id: data.debug_trace_id,
      };

      try {
        leaseContext.assertActive();
        await this.workerBaileysGrpcClientService.requestConnection(
          data.worker_id,
          disconnectPayload,
          workerType
        );
        leaseContext.assertActive();
      } catch (err) {
        leaseContext.assertActive();
        console.error('Failed to request worker disconnect before recreate', {
          workerId: data.worker_id,
          accountId: data.account_id,
          error: getErrorMessage(err),
        });
      }
    }

    if (!shouldRemoveVolume) {
      leaseContext.assertActive();
      await this.assertPreservedSessionVolumeExists(
        data,
        sessionVolumeResolution,
        leaseContext
      );
    }

    const removalDecision: RecreateRuntimeRemovalDecision =
      persistedColdRuntimeRemovalProven &&
      sessionStorage === EWorkerSessionStorage.postgres
        ? {
            status: 'removed',
            reason:
              adoptedColdRuntime?.status === 'stale_image_removed'
                ? 'stale_image_runtime_removed_by_exact_proof'
                : adoptedColdRuntime?.status ===
                    'absent_cross_server_handoff_target'
                  ? 'absent_handoff_target_replaced_by_exact_proof'
                  : 'abandoned_reserved_handoff_target_by_exact_proof',
          }
        : await this.resolveRecreateRuntimeRemovalDecision(
            data,
            shouldRemoveVolume,
            currentWorker,
            leaseContext
          );
    leaseContext.assertActive();

    if (removalDecision.status === 'recovered') {
      return {} as PublishResult;
    }

    if (removalDecision.status === 'pending') {
      throw new WorkerLivenessRecreateRetryError(
        `pending:${removalDecision.reason}`
      );
    }

    if (removalDecision.status === 'stale') {
      this.logDebug('service.recreate_worker.liveness_fence_stale', {
        trace_id: data.debug_trace_id,
        layer: 'service',
        worker_id: data.worker_id,
        account_id: data.account_id,
        worker_type_id: currentWorker.worker_type_id,
        lifecycle_operation_id: data.lifecycle_operation_id,
        container_id: data.expected_container_id,
        runtime_generation: data.expected_runtime_generation,
        reason: `pre_remove:${removalDecision.reason}`,
      });
      throw new WorkerLivenessRecreateRetryError(
        `stale:${removalDecision.reason}`
      );
    }

    if (removalDecision.status !== 'removed') {
      leaseContext.assertActive();
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.action,
        data.server_id,
        data.lifecycle_operation_id
      );
      throw new Error('Worker removal failed');
    }
    this.logDebug('service.recreate_worker.container_removed', {
      trace_id: data.debug_trace_id,
      layer: 'service',
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id: workerType,
      lifecycle_operation_id: data.lifecycle_operation_id,
      remove_volume: shouldRemoveVolume,
    });

    if (
      shouldRemoveSession &&
      sessionStorage === EWorkerSessionStorage.postgres
    ) {
      await this.deletePostgresWhatsappSessionWithLifecycleFence(
        data,
        EWorkerStatus.recreating,
        sessionVolumeResolution.sessionDeletionRuntimeFence ?? null
      );
      leaseContext.assertActive();
    }

    await this.assertLifecycleOperationCurrent(
      data,
      'runtime generation reservation'
    );
    leaseContext.assertActive();
    const nextRuntimeGeneration = await this.reserveNextWorkerRuntimeGeneration(
      data,
      sessionStorage === EWorkerSessionStorage.postgres
        ? null
        : (preservedSessionVolumeName ?? data.worker_id),
      sessionVolumeResolution.runtimeGeneration
    );
    leaseContext.assertActive();

    const proxy = await this.resolveWorkerProxyConfig(
      data.worker_id,
      data.server_id
    );
    leaseContext.assertActive();

    if (!(await this.isLifecycleOperationCurrent(data))) {
      return {} as PublishResult;
    }

    const containerId = await this.retryOperation(
      async () => {
        leaseContext.assertActive();
        await this.assertLifecycleOperationCurrent(data, 'container creation');
        const runtimeIdentity = await this.preparePostgresRuntimeWriterIdentity(
          data,
          nextRuntimeGeneration
        );
        const options = {
          workerTypeId: workerType,
          workerGrpcPort: this.getExpectedWorkerGrpcPort(workerType),
          runtimeGeneration: nextRuntimeGeneration,
          serverId: data.server_id,
          ...(data.lifecycle_operation_id
            ? { lifecycleOperationId: data.lifecycle_operation_id }
            : {}),
          ...runtimeIdentity,
          ...(this.isSafeSessionStorageMigration(data)
            ? {
                sessionStorageMigrationId: data.session_storage_migration_id,
                legacySessionVolumeName: data.legacy_session_volume_name,
                legacySessionChecksum: data.legacy_session_checksum,
              }
            : {}),
        };
        const beforeStart =
          runtimeIdentity.runtimeCapability && runtimeIdentity.writerEpoch
            ? async (createdContainerId: string): Promise<void> =>
                this.bindReservedColdRuntimeBeforeStart({
                  data,
                  workerType,
                  expectedWorkerStatus: EWorkerStatus.recreating,
                  runtimeGeneration: nextRuntimeGeneration,
                  sessionStorage,
                  sessionVolumeName:
                    sessionStorage === EWorkerSessionStorage.postgres
                      ? null
                      : (preservedSessionVolumeName ?? data.worker_id),
                  runtimeCapability:
                    runtimeIdentity.runtimeCapability as string,
                  writerEpoch: runtimeIdentity.writerEpoch as string,
                  containerId: createdContainerId,
                  leaseContext,
                })
            : undefined;

        if (preservedSessionVolumeName) {
          const created = await this.workerService.createContainerWorker(
            imageName,
            data.worker_id,
            data.account_id,
            false,
            balanceEnvironment.grpcHost,
            balanceEnvironment.grpcPort,
            proxy,
            options,
            preservedSessionVolumeName,
            {
              requireExistingVolume: true,
              requireContainerNameAvailable: true,
              imageContentId: recreateImageContentId,
              ...(beforeStart ? { beforeStart } : {}),
            }
          );
          leaseContext.assertActive();
          return created;
        }

        const created = await this.workerService.createContainerWorker(
          imageName,
          data.worker_id,
          data.account_id,
          false,
          balanceEnvironment.grpcHost,
          balanceEnvironment.grpcPort,
          proxy,
          options,
          undefined,
          {
            imageContentId: recreateImageContentId,
            requireContainerNameAvailable: true,
            ...(beforeStart ? { beforeStart } : {}),
          }
        );
        leaseContext.assertActive();
        return created;
      },
      (r) => !r
    );
    leaseContext.assertActive();

    if (!containerId) {
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.action,
        data.server_id,
        data.lifecycle_operation_id
      );
      throw new Error('Worker creation failed');
    }
    this.logDebug('service.recreate_worker.container_created', {
      trace_id: data.debug_trace_id,
      layer: 'service',
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id: workerType,
      lifecycle_operation_id: data.lifecycle_operation_id,
      container_id: containerId,
      runtime_generation: nextRuntimeGeneration,
    });

    await this.assertLifecycleCurrentForCreatedContainer(
      data,
      containerId,
      'container creation'
    );
    leaseContext.assertActive();

    try {
      leaseContext.assertActive();
      await this.workerRuntimeRepository?.upsert({
        worker_id: data.worker_id,
        container_id: containerId,
        container_name: data.worker_id,
        session_storage: sessionStorage,
        session_volume_name:
          sessionStorage === EWorkerSessionStorage.postgres
            ? null
            : (preservedSessionVolumeName ?? data.worker_id),
        runtime_generation: nextRuntimeGeneration,
        activated_at: currentTime(),
      });
      leaseContext.assertActive();
    } catch (error) {
      leaseContext.assertActive();
      if (error instanceof StaleWorkerRuntimeGenerationError) {
        await this.removeSupersededContainer(
          containerId,
          data,
          'stale_runtime_generation'
        );
      }
      throw error;
    }

    await this.releaseRecreateSlotAndMarkRuntimeStarted({
      data,
      workerType,
      containerId,
      runtimeGeneration: nextRuntimeGeneration,
      leaseContext,
      slotControl,
    });

    const health = await this.checkRecreatedContainerHealth({
      data,
      workerType,
      containerId,
      stage: 'cold_recreate',
    });
    leaseContext.assertActive();

    await this.assertLifecycleCurrentForCreatedContainer(
      data,
      containerId,
      'container health wait'
    );

    if (!health.healthy) {
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.action,
        data.server_id,
        data.lifecycle_operation_id
      );
      throw new Error('Worker service is not healthy');
    }
    this.logDebug('service.recreate_worker.health_ready', {
      trace_id: data.debug_trace_id,
      layer: 'service',
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id: workerType,
      lifecycle_operation_id: data.lifecycle_operation_id,
      container_id: containerId,
    });

    if (this.isWorkerGrpcReadinessRequired(workerType)) {
      try {
        leaseContext.assertActive();
        await this.waitForWorkerGrpcReady(data.worker_id, workerType);
        leaseContext.assertActive();
        await this.assertLifecycleCurrentForCreatedContainer(
          data,
          containerId,
          'worker gRPC readiness wait'
        );
        this.logDebug('service.recreate_worker.grpc_ready', {
          trace_id: data.debug_trace_id,
          layer: 'service',
          worker_id: data.worker_id,
          account_id: data.account_id,
          worker_type_id: workerType,
          lifecycle_operation_id: data.lifecycle_operation_id,
          container_id: containerId,
        });
      } catch (err) {
        leaseContext.assertActive();
        await this.updateWorkerErrorStatus(
          data.worker_id,
          data.account_id,
          data.action,
          data.server_id,
          data.lifecycle_operation_id
        );
        throw err;
      }
    }

    await this.assertLifecycleOperationCurrent(
      data,
      'connection reconciliation'
    );
    const reconciliation = await this.reconcileRecreatedWorkerConnection(
      data,
      workerType,
      nextRuntimeGeneration,
      leaseContext
    );
    await this.assertLifecycleCurrentForCreatedContainer(
      data,
      containerId,
      'connection reconciliation'
    );
    leaseContext.assertActive();

    const inputUpdate = this.buildRecreateFinalWorkerUpdate(
      data,
      workerType,
      containerId,
      shouldRemoveSession || sessionWasReset,
      reconciliation
    );

    const updated = await this.updateWorkerWithLifecycleGuardAndLegacyRetry(
      data.account_id,
      inputUpdate,
      data,
      workerType,
      {
        expectedWorkerStatusId: EWorkerStatus.recreating,
        expectedControlContainerId: currentWorker.container_id ?? undefined,
        expectedRuntimeContainerId: containerId,
        expectedRuntimeGeneration: nextRuntimeGeneration,
        completeRecreate: true,
      }
    );
    leaseContext.assertActive();

    const committedWorkerStatus = updated
      ? reconciliation.workerStatusId
      : await this.finalizeRecreateLifecycleAfterCasMiss(
          data.account_id,
          inputUpdate,
          data,
          workerType,
          containerId,
          nextRuntimeGeneration
        );
    leaseContext.assertActive();

    if (!committedWorkerStatus) {
      console.error('Failed to update worker status after recreate', {
        workerId: data.worker_id,
        accountId: data.account_id,
        action: data.action,
      });
      await this.removeSupersededContainer(
        containerId,
        data,
        'recreate_lifecycle_changed'
      );
      leaseContext.assertActive();
      throw new Error(
        'Recreate lifecycle could not be finalized by its active operation'
      );
    }

    await this.cleanupAssignedWarmPoolReferences(data.worker_id);
    leaseContext.assertActive();

    const result = await this.publishWorkerRecreateFinalState(
      data,
      {
        ...reconciliation,
        workerStatusId: committedWorkerStatus,
      },
      nextRuntimeGeneration,
      workerType
    );
    leaseContext.assertActive();
    this.logDebug('service.recreate_worker.final_state_published', {
      trace_id: data.debug_trace_id,
      layer: 'service',
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id: workerType,
      lifecycle_operation_id: data.lifecycle_operation_id,
      container_id: containerId,
      status: reconciliation.connectionState?.status,
      worker_status_id: reconciliation.workerStatusId,
      runtime_generation: nextRuntimeGeneration,
    });
    return result;
  }

  private async finalizeAdoptedRecreateRuntime(input: {
    data: IWorkerPayload;
    workerType: EWorkerType;
    controlContainerId: string | null;
    containerId: string;
    runtimeGeneration: number;
    sessionWasReset: boolean;
    leaseContext: ILockLeaseContext;
  }): Promise<PublishResult> {
    const {
      data,
      workerType,
      controlContainerId,
      containerId,
      runtimeGeneration,
      sessionWasReset,
      leaseContext,
    } = input;
    leaseContext.assertActive();
    await this.assertLifecycleCurrentForCreatedContainer(
      data,
      containerId,
      'cold runtime adoption'
    );
    leaseContext.assertActive();

    const health = await this.checkRecreatedContainerHealth({
      data,
      workerType,
      containerId,
      stage: 'adopted_recreate',
    });
    leaseContext.assertActive();
    await this.assertLifecycleCurrentForCreatedContainer(
      data,
      containerId,
      'adopted container health wait'
    );
    if (!health.healthy) {
      throw new Error('Adopted worker service is not healthy');
    }

    if (this.isWorkerGrpcReadinessRequired(workerType)) {
      await this.waitForWorkerGrpcReady(data.worker_id, workerType);
      leaseContext.assertActive();
      await this.assertLifecycleCurrentForCreatedContainer(
        data,
        containerId,
        'adopted worker gRPC readiness wait'
      );
    }

    await this.assertLifecycleOperationCurrent(
      data,
      'adopted connection reconciliation'
    );
    const reconciliation = await this.reconcileRecreatedWorkerConnection(
      data,
      workerType,
      runtimeGeneration,
      leaseContext
    );
    await this.assertLifecycleCurrentForCreatedContainer(
      data,
      containerId,
      'adopted connection reconciliation'
    );
    leaseContext.assertActive();

    const inputUpdate = this.buildRecreateFinalWorkerUpdate(
      data,
      workerType,
      containerId,
      sessionWasReset,
      reconciliation
    );
    const updated = await this.updateWorkerWithLifecycleGuardAndLegacyRetry(
      data.account_id,
      inputUpdate,
      data,
      workerType,
      {
        expectedWorkerStatusId: EWorkerStatus.recreating,
        expectedControlContainerId: controlContainerId ?? undefined,
        expectedRuntimeContainerId: containerId,
        expectedRuntimeGeneration: runtimeGeneration,
        completeRecreate: true,
      }
    );
    leaseContext.assertActive();
    const committedWorkerStatus = updated
      ? reconciliation.workerStatusId
      : await this.finalizeRecreateLifecycleAfterCasMiss(
          data.account_id,
          inputUpdate,
          data,
          workerType,
          containerId,
          runtimeGeneration
        );
    leaseContext.assertActive();
    if (!committedWorkerStatus) {
      throw new Error(
        'Adopted recreate lifecycle could not be finalized by its active operation'
      );
    }

    await this.cleanupAssignedWarmPoolReferences(data.worker_id);
    leaseContext.assertActive();
    const result = await this.publishWorkerRecreateFinalState(
      data,
      {
        ...reconciliation,
        workerStatusId: committedWorkerStatus,
      },
      runtimeGeneration,
      workerType
    );
    leaseContext.assertActive();
    this.logDebug('service.recreate_worker.adopted_runtime_finalized', {
      trace_id: data.debug_trace_id,
      layer: 'service',
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id: workerType,
      lifecycle_operation_id: data.lifecycle_operation_id,
      container_id: containerId,
      runtime_generation: runtimeGeneration,
      worker_status_id: reconciliation.workerStatusId,
    });
    return result;
  }

  private async runWithRecreateServerSlot<T>(
    data: IWorkerPayload,
    callback: (
      context: ILockLeaseContext,
      control?: WorkerRecreateServerSlotControl
    ) => Promise<T>
  ): Promise<T> {
    const startedAt = Date.now();
    const isLivenessRecreate = Boolean(data.expected_container_id);
    return this.workerRecreateServerSlotService.withSlot(
      {
        serverId: data.server_id,
        workerId: data.worker_id,
        lifecycleOperationId: data.lifecycle_operation_id,
      },
      async (lease, slotLease, slotControl) => {
        slotLease.assertActive();
        this.logDebug('service.recreate_worker.server_slot_acquired', {
          trace_id: data.debug_trace_id,
          layer: 'service',
          worker_id: data.worker_id,
          account_id: data.account_id,
          worker_type_id: data.worker_type_id,
          lifecycle_operation_id: data.lifecycle_operation_id,
          server_id: data.server_id,
          slot: lease.slot,
          reserved_slot: lease.reserved,
          wait_ms: Date.now() - startedAt,
        });

        const result = await callback(slotLease, slotControl);
        if (!slotControl?.isReleased()) {
          slotLease.assertActive();
        }
        return result;
      },
      {
        reservedSlotKey: data.recreate_server_slot_key,
        reservedSlotToken: data.recreate_server_slot_token,
        ...(isLivenessRecreate
          ? {
              ttlMs: WORKER_LIVENESS_LIFECYCLE_LEASE_TTL_MS,
              acquireTimeoutMs: WORKER_LIVENESS_LIFECYCLE_LEASE_TTL_MS,
              heartbeatIntervalMs: WORKER_LIVENESS_LIFECYCLE_HEARTBEAT_MS,
            }
          : {}),
      }
    );
  }

  private async publishWorkerDisponible(
    data: IWorkerPayload,
    runtimeGeneration: number,
    workerType: EWorkerType
  ): Promise<PublishResult> {
    const dataPublish: IBaileysConnectionState = {
      code: ECodeMessage.info,
      status: EBaileysConnectionStatus.info,
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id: workerType,
      worker_status_id: EWorkerStatus.disponible,
      debug_trace_id: data.debug_trace_id,
      runtime_generation: runtimeGeneration,
    };

    const [result] = await Promise.all([
      this.centrifugoPublish(dataPublish),
      this.centrifugoService.publish(channelsConfigCentrifugo(), dataPublish),
    ]);
    return result;
  }

  private async releaseRecreateSlotAndMarkRuntimeStarted(
    input: Parameters<
      WorkerCommandHandlerService['markAndPublishRecreateRuntimeStarted']
    >[0] & { slotControl?: WorkerRecreateServerSlotControl }
  ): Promise<void> {
    await input.slotControl?.release();
    input.leaseContext.assertActive();
    await this.markAndPublishRecreateRuntimeStarted(input);
  }

  private async markAndPublishRecreateRuntimeStarted(input: {
    data: Pick<
      IWorkerPayload,
      | 'worker_id'
      | 'account_id'
      | 'server_id'
      | 'lifecycle_operation_id'
      | 'debug_trace_id'
    > & { previous_worker_type_id?: string };
    workerType: EWorkerType;
    containerId: string;
    runtimeGeneration: number;
    leaseContext: ILockLeaseContext;
  }): Promise<void> {
    const lifecycleOperationId = input.data.lifecycle_operation_id?.trim();
    if (!lifecycleOperationId || !input.data.server_id) {
      throw new Error('worker_recreate_bootstrap_lifecycle_required');
    }
    input.leaseContext.assertActive();
    const marked =
      await this.workerRuntimeRepository.markRecreateBootstrapStarted({
        worker_id: input.data.worker_id,
        account_id: input.data.account_id,
        server_id: input.data.server_id,
        lifecycle_operation_id: lifecycleOperationId,
        runtime_generation: input.runtimeGeneration,
        container_id: input.containerId,
      });
    input.leaseContext.assertActive();
    if (!marked) {
      throw new Error('worker_recreate_bootstrap_marker_stale');
    }

    const runtime = await this.workerRuntimeRepository.viewByWorkerIdConsistent(
      input.data.worker_id
    );
    input.leaseContext.assertActive();
    const normalizedContainerId = input.containerId.trim().toLowerCase();
    if (
      !runtime ||
      runtime.container_id?.trim().toLowerCase() !== normalizedContainerId ||
      runtime.runtime_generation !== input.runtimeGeneration ||
      runtime.recreate_bootstrap_operation_id !== lifecycleOperationId ||
      runtime.recreate_bootstrap_runtime_generation !==
        input.runtimeGeneration ||
      runtime.recreate_bootstrap_container_id?.trim().toLowerCase() !==
        normalizedContainerId ||
      !runtime.recreate_bootstrap_started_at ||
      runtime.recreate_retired_operation_id !== null
    ) {
      throw new Error('worker_recreate_bootstrap_marker_postcondition_changed');
    }

    const state = buildManagerWorkerRecreateRuntimeStartedStatusEvent(
      {
        action: EWorkerAction.recreate,
        worker_id: input.data.worker_id,
        account_id: input.data.account_id,
        server_id: input.data.server_id,
        worker_type_id: input.workerType,
        lifecycle_operation_id: lifecycleOperationId,
        debug_trace_id: input.data.debug_trace_id,
        previous_worker_type_id: input.data.previous_worker_type_id as
          EWorkerType | undefined,
      },
      input.runtimeGeneration,
      runtime.recreate_bootstrap_started_at
    );
    await Promise.all([
      this.centrifugoService.publishSubStrict(
        workerCentrifugoQueue(input.data.account_id),
        state
      ),
      this.centrifugoService.publishStrict(channelsConfigCentrifugo(), state),
    ]);
    input.leaseContext.assertActive();
    this.logDebug('service.recreate_worker.runtime_started_published', {
      trace_id: input.data.debug_trace_id,
      layer: 'service',
      worker_id: input.data.worker_id,
      account_id: input.data.account_id,
      server_id: input.data.server_id,
      worker_type_id: input.workerType,
      lifecycle_operation_id: lifecycleOperationId,
      runtime_generation: input.runtimeGeneration,
    });
  }

  private isPendingWarmRecreateLifecycle(
    data: ValidatedActivateWarmWorkerRequest,
    worker: IWorkerMonitor | null | undefined
  ): boolean {
    return Boolean(
      data.lifecycle_operation_id &&
      data.previous_worker_type_id &&
      worker?.lifecycle_operation_id === data.lifecycle_operation_id &&
      (worker.worker_status_id === EWorkerStatus.recreating ||
        worker.worker_status_id === EWorkerStatus.online)
    );
  }

  private hasExactRecreateCompletion(
    data: Pick<
      IWorkerPayload,
      'lifecycle_operation_id' | 'worker_id' | 'account_id' | 'server_id'
    >,
    worker: IWorkerMonitor | null | undefined,
    workerType: EWorkerType,
    runtimeGeneration: number
  ): worker is IWorkerMonitor {
    return Boolean(
      data.lifecycle_operation_id &&
      worker &&
      !worker.deleted_at &&
      worker.worker_id === data.worker_id &&
      worker.account_id === data.account_id &&
      worker.server_id === data.server_id &&
      worker.worker_type_id === workerType &&
      worker.lifecycle_operation_id === null &&
      worker.runtime_generation === runtimeGeneration &&
      worker.recreate_completed_operation_id === data.lifecycle_operation_id &&
      worker.recreate_completed_runtime_generation === runtimeGeneration &&
      Boolean(worker.recreate_completed_at) &&
      (worker.worker_status_id === EWorkerStatus.online ||
        worker.worker_status_id === EWorkerStatus.disponible)
    );
  }

  private async publishWarmRecreateTerminalIfCommitted(input: {
    data: ValidatedActivateWarmWorkerRequest;
    workerType: EWorkerType;
    runtimeGeneration: number;
    leaseContext: ILockLeaseContext;
  }): Promise<boolean> {
    if (!input.data.lifecycle_operation_id) return false;
    const completed = await this.workerService.viewWorkerForMonitorConsistent(
      input.data.worker_id
    );
    input.leaseContext.assertActive();
    if (
      !this.hasExactRecreateCompletion(
        input.data,
        completed,
        input.workerType,
        input.runtimeGeneration
      )
    ) {
      return false;
    }
    await this.publishManagerWorkerRecreateTerminal({
      data: input.data,
      workerType: input.workerType,
      runtimeGeneration: input.runtimeGeneration,
      workerStatusId: completed.worker_status_id as
        EWorkerStatus.online | EWorkerStatus.disponible,
    });
    input.leaseContext.assertActive();
    return true;
  }

  private async publishManagerWorkerRecreateTerminal(input: {
    data: Pick<
      IWorkerPayload,
      | 'worker_id'
      | 'account_id'
      | 'server_id'
      | 'lifecycle_operation_id'
      | 'debug_trace_id'
    > & { previous_worker_type_id?: string };
    workerType: EWorkerType;
    runtimeGeneration: number;
    workerStatusId: EWorkerStatus.online | EWorkerStatus.disponible;
  }): Promise<PublishResult> {
    const lifecycleOperationId = input.data.lifecycle_operation_id?.trim();
    if (!lifecycleOperationId || !input.data.server_id) {
      throw new Error('worker_recreate_terminal_lifecycle_required');
    }
    const completed = await this.workerService.viewWorkerForMonitorConsistent(
      input.data.worker_id
    );
    if (
      !completed ||
      completed.deleted_at ||
      completed.account_id !== input.data.account_id ||
      completed.server_id !== input.data.server_id ||
      completed.worker_type_id !== input.workerType ||
      completed.worker_status_id !== input.workerStatusId ||
      completed.lifecycle_operation_id !== null ||
      completed.runtime_generation !== input.runtimeGeneration ||
      completed.recreate_completed_operation_id !== lifecycleOperationId ||
      completed.recreate_completed_runtime_generation !==
        input.runtimeGeneration ||
      !completed.recreate_completed_at
    ) {
      throw new Error('worker_recreate_terminal_tombstone_mismatch');
    }
    const state = buildManagerWorkerRecreateTerminalStatusEvent(
      {
        action: EWorkerAction.recreate,
        worker_id: input.data.worker_id,
        account_id: input.data.account_id,
        server_id: input.data.server_id,
        worker_type_id: input.workerType,
        lifecycle_operation_id: lifecycleOperationId,
        debug_trace_id: input.data.debug_trace_id,
        previous_worker_type_id: input.data.previous_worker_type_id as
          EWorkerType | undefined,
      },
      input.runtimeGeneration,
      input.workerStatusId,
      completed.recreate_completed_at
    );
    const [result] = await Promise.all([
      this.centrifugoService.publishSubStrict(
        workerCentrifugoQueue(input.data.account_id),
        state
      ),
      this.centrifugoService.publishStrict(channelsConfigCentrifugo(), state),
    ]);
    return result;
  }

  private shouldReconcileRecreatedWorkerConnection(
    data: IWorkerPayload
  ): boolean {
    return data.remove_session !== true;
  }

  /**
   * A PostgreSQL provider handoff already carries an authenticated canonical
   * session into the target runtime. It must converge exclusively through the
   * target bootstrap: sending RequestConnection(qrcode) here would turn a
   * restore into a new interactive login and is deliberately rejected by the
   * providers while the handoff fence is active.
   */
  private async resolvePostgresProviderHandoffReconciliationMode(
    data: IWorkerPayload,
    workerType: EWorkerType
  ): Promise<PostgresProviderHandoffReconciliationMode> {
    const lifecycleOperationId = data.lifecycle_operation_id?.trim();
    const sourceWorkerType = data.previous_worker_type_id;
    const sourceProvider = sourceWorkerType
      ? WORKER_TYPE_SOURCE_PROVIDER[sourceWorkerType]
      : undefined;
    const targetProvider = WORKER_TYPE_SOURCE_PROVIDER[workerType];
    if (
      data.action !== EWorkerAction.recreate ||
      data.session_storage !== EWorkerSessionStorage.postgres ||
      data.remove_session === true ||
      !targetProvider
    ) {
      return 'not_applicable';
    }

    /*
     * PostgreSQL providers have no session volume. A surviving remove_volume
     * flag is therefore contradictory unless it belongs to the explicit,
     * destructive legacy-volume conversion (which also removes the source
     * session and returned above). Never let that contradiction bypass the
     * durable handoff proof and fall through to an interactive QR request.
     */
    if (data.remove_volume === true) {
      throw new Error('postgres_recreate_remove_volume_invalid');
    }

    if (!lifecycleOperationId) {
      if (sourceProvider === targetProvider) return 'not_applicable';
      throw new Error('postgres_provider_handoff_context_unavailable');
    }
    if (
      typeof this.workerRuntimeRepository
        ?.viewWhatsappProviderHandoffLifecycleContext !== 'function'
    ) {
      throw new Error('postgres_provider_handoff_context_unavailable');
    }

    const context =
      await this.workerRuntimeRepository.viewWhatsappProviderHandoffLifecycleContext(
        {
          worker_id: data.worker_id,
          account_id: data.account_id,
          lifecycle_operation_id: lifecycleOperationId,
        }
      );
    if (context) {
      if (
        context.lifecycle_operation_id !== lifecycleOperationId ||
        context.target_provider !== targetProvider ||
        context.source_provider === targetProvider ||
        (sourceProvider !== undefined &&
          sourceProvider !== targetProvider &&
          context.source_provider !== sourceProvider)
      ) {
        throw new Error('postgres_provider_handoff_context_invalid');
      }
      if (context.state === 'failed') {
        throw new Error('postgres_provider_handoff_rolled_back');
      }
      if (context.state === 'requested' || context.state === 'draining') {
        throw new Error('postgres_provider_handoff_source_drain_pending');
      }
      if (
        context.state !== 'transforming' &&
        context.state !== 'hydrating' &&
        context.state !== 'validating' &&
        context.state !== 'promoting' &&
        context.state !== 'activating' &&
        context.state !== 'completed'
      ) {
        throw new Error('postgres_provider_handoff_context_invalid');
      }
      return 'handoff';
    }

    /*
     * A failed handoff is restored under its own recovery operation UUID.
     * Resolve that identity before the same-provider shortcut: recoveries
     * which did not create a target runtime legitimately carry
     * previous_worker_type_id === worker_type_id, but they still must never
     * request a new QR login for the preserved PostgreSQL session.
     */
    if (
      typeof this.workerRuntimeRepository
        ?.viewWhatsappProviderHandoffRecoveryLifecycleProof === 'function'
    ) {
      const recoveryProof =
        await this.workerRuntimeRepository.viewWhatsappProviderHandoffRecoveryLifecycleProof(
          {
            worker_id: data.worker_id,
            account_id: data.account_id,
            recovery_operation_id: lifecycleOperationId,
            recovery_worker_type_id: workerType,
            recovery_provider: targetProvider,
          }
        );
      if (recoveryProof) {
        if (
          recoveryProof.recovery_ownership_unique !== true ||
          recoveryProof.recovery_context_valid !== true ||
          recoveryProof.source_session_valid !== true ||
          recoveryProof.recovery_operation_id !== lifecycleOperationId ||
          !recoveryProof.handoff_lifecycle_operation_id?.trim() ||
          recoveryProof.handoff_lifecycle_operation_id ===
            lifecycleOperationId ||
          recoveryProof.source_provider !== targetProvider ||
          recoveryProof.failed_target_provider === targetProvider ||
          !recoveryProof.source_revision_id?.trim() ||
          !['pending', 'dispatching', 'running'].includes(
            recoveryProof.recovery_state
          ) ||
          typeof recoveryProof.recovery_cleanup_required !== 'boolean' ||
          !Number.isSafeInteger(recoveryProof.recovery_from_generation) ||
          (recoveryProof.recovery_from_generation ?? 0) <= 0
        ) {
          throw new Error('postgres_provider_handoff_recovery_context_invalid');
        }
        const expectedPreviousProvider =
          recoveryProof.recovery_cleanup_required === true
            ? recoveryProof.failed_target_provider
            : recoveryProof.source_provider;
        if (
          sourceProvider !== undefined &&
          sourceProvider !== expectedPreviousProvider
        ) {
          throw new Error('postgres_provider_handoff_recovery_context_invalid');
        }
        return 'recovery';
      }
    }

    /*
     * A durable handoff journal takes precedence over a stale payload that
     * repeats the target as its previous type. Only after the primary lookup
     * proves that no handoff owns this operation is a genuine same-provider
     * recreate allowed to keep its established connection flow.
     */
    if (sourceProvider === targetProvider) {
      return 'not_applicable';
    }

    /*
     * A missing handoff is ambiguous (empty source, replica/schema skew,
     * rollback or corruption), so it never grants QR by itself. Interactive
     * connection requires one of two positive primary-database proofs: fenced
     * discard cleanup, or an exact lifecycle for a channel that has never
     * created a canonical PostgreSQL session.
     */
    if (
      typeof this.workerRuntimeRepository
        ?.viewWhatsappProviderHandoffDiscardPrimaryGate === 'function'
    ) {
      const discardGate =
        await this.workerRuntimeRepository.viewWhatsappProviderHandoffDiscardPrimaryGate(
          {
            worker_id: data.worker_id,
            account_id: data.account_id,
            operation_id: lifecycleOperationId,
          }
        );
      if (
        discardGate?.operation_id === lifecycleOperationId &&
        discardGate.target_provider === targetProvider &&
        discardGate.source_provider !== targetProvider &&
        (sourceProvider === undefined ||
          discardGate.source_provider === sourceProvider) &&
        discardGate.session_present === false &&
        Boolean(discardGate.cleanup_finalized_at?.trim())
      ) {
        return 'interactive_discard';
      }
    }

    if (
      typeof this.workerRuntimeRepository
        ?.viewWhatsappProviderEmptySwitchPrimaryProof === 'function'
    ) {
      const emptySwitchProof =
        await this.workerRuntimeRepository.viewWhatsappProviderEmptySwitchPrimaryProof(
          {
            worker_id: data.worker_id,
            account_id: data.account_id,
            lifecycle_operation_id: lifecycleOperationId,
            target_worker_type_id: workerType,
            target_provider: targetProvider,
          }
        );
      if (
        emptySwitchProof?.lifecycle_operation_id === lifecycleOperationId &&
        emptySwitchProof.worker_type_id === workerType &&
        (emptySwitchProof.runtime_session_storage === null ||
          emptySwitchProof.runtime_session_storage ===
            EWorkerSessionStorage.postgres) &&
        (emptySwitchProof.runtime_source_provider === null ||
          emptySwitchProof.runtime_source_provider === targetProvider)
      ) {
        return 'interactive_empty';
      }
    }

    throw new Error('postgres_provider_handoff_context_missing');
  }

  private isConnectedConnectionState(
    state: IBaileysConnectionState | undefined
  ): boolean {
    return (
      this.isStrictConnectedPayload(state ?? {}) &&
      (state?.worker_status_id === EWorkerStatus.online ||
        state?.status === EBaileysConnectionStatus.connected ||
        state?.code === ECodeMessage.connectionEstablished)
    );
  }

  private isConnectedRuntimeHealth(
    health: IWorkerRuntimeHealthResponseProto | undefined,
    workerType: EWorkerType,
    phoneFallback?: string | null
  ): boolean {
    return (
      isWhatsappConnectionOnline(
        this.currentNativeRuntimeHealthStatus(health, workerType)
      ) &&
      health?.session_ready === true &&
      health.can_send === true &&
      health.can_receive_runtime === true &&
      health.authenticated === true &&
      health?.activated === true &&
      health?.standby !== true &&
      (!health.worker_type_id || health.worker_type_id === workerType) &&
      health.kafka_consumers_ready === true &&
      (!this.requiresKafkaDispatchAuthorization(health) ||
        health.kafka_consumers_authorized === true) &&
      health.kafka_unhealthy !== true &&
      !health.error &&
      Boolean(
        this.normalizeConnectionPhone(health.phone) ??
        this.normalizeConnectionPhone(phoneFallback)
      )
    );
  }

  private isStrictProviderHandoffRuntimeHealth(
    health: IWorkerRuntimeHealthResponseProto | undefined,
    data: IWorkerPayload,
    workerType: EWorkerType
  ): boolean {
    return Boolean(
      this.isConnectedRuntimeHealth(health, workerType) &&
      health?.worker_id === data.worker_id &&
      health.account_id === data.account_id &&
      health.worker_type_id === workerType &&
      health.ready === true &&
      health.has_session === true &&
      health.has_qr === false
    );
  }

  private resolveOnlineRuntimeHealthRejectionReason(
    health: IWorkerRuntimeHealthResponseProto | undefined,
    workerType: EWorkerType
  ): string {
    if (!health) return 'runtime_health_unavailable';
    if (health.error) return 'runtime_health_error';
    if (
      !isWhatsappConnectionOnline(
        this.currentNativeRuntimeHealthStatus(health, workerType)
      )
    ) {
      return 'native_connection_status_not_online';
    }
    if (health.activated !== true) return 'runtime_not_activated';
    if (health.standby === true) return 'runtime_standby';
    if (health.worker_type_id && health.worker_type_id !== workerType) {
      return 'runtime_worker_type_mismatch';
    }
    if (health.session_ready !== true) return 'online_without_session_ready';
    if (health.authenticated !== true) return 'online_without_authentication';
    if (health.can_send !== true) return 'online_without_send_ready';
    if (health.can_receive_runtime !== true) {
      return 'online_without_receive_ready';
    }
    if (
      health.kafka_consumers_ready !== true ||
      health.kafka_unhealthy === true
    ) {
      return 'kafka_consumers_not_ready';
    }
    if (
      this.requiresKafkaDispatchAuthorization(health) &&
      health.kafka_consumers_authorized !== true
    ) {
      return 'kafka_consumers_not_authorized';
    }
    if (!this.normalizeConnectionPhone(health.phone)) {
      return 'runtime_phone_unavailable';
    }
    return 'online_without_strict_readiness';
  }

  private isDispatchAuthorizationBootstrapHealth(
    health: IWorkerRuntimeHealthResponseProto | undefined,
    workerType: EWorkerType,
    payload: Partial<IBaileysConnectionState>
  ): health is IWorkerRuntimeHealthResponseProto {
    return (
      this.isStrictConnectedPayload(payload) &&
      isWhatsappConnectionOnline(
        this.currentNativeRuntimeHealthStatus(health, workerType)
      ) &&
      payload.status === EBaileysConnectionStatus.connected &&
      payload.code === ECodeMessage.connectionEstablished &&
      this.requiresKafkaDispatchAuthorization(health) &&
      health?.session_ready === true &&
      health.can_send === true &&
      health.can_receive_runtime === true &&
      health.authenticated === true &&
      health.activated === true &&
      health.standby !== true &&
      (!health.worker_type_id || health.worker_type_id === workerType) &&
      health.kafka_consumers_ready === true &&
      health.kafka_consumers_authorized === false &&
      health.kafka_unhealthy !== true &&
      health.degraded_reason === 'awaiting_dispatch_authorization' &&
      !health.error &&
      Boolean(
        this.normalizeConnectionPhone(health.phone) ??
        this.normalizeConnectionPhone(payload.phone)
      )
    );
  }

  private requiresKafkaDispatchAuthorization(
    health:
      | Pick<IWorkerRuntimeHealthResponseProto, 'runtime_health_schema_version'>
      | RuntimeFunctionalEvidence
      | undefined
  ): boolean {
    return Number(health?.runtime_health_schema_version) >= 2;
  }

  private isExplicitlyAvailableRuntimeHealth(
    health: IWorkerRuntimeHealthResponseProto | undefined,
    data: IWorkerPayload,
    workerType: EWorkerType,
    expectedRuntimeGeneration: number
  ): boolean {
    /*
     * Provider-dependent Kafka consumers cannot become ready before a session
     * (Baileys reports `missing_socket` here). For the `disponible` state the
     * only required stream is the already-ready QR/control runtime; send and
     * receive readiness remains false until authentication succeeds.
     */
    if (!health) {
      return false;
    }

    const rawNativeSourceId = health.connection_status_source_id?.trim();
    const hasRawNativeStatus =
      health.connection_status !== undefined &&
      health.connection_status !== null;
    const hasRawNativeSource = Boolean(rawNativeSourceId);
    const hasAnyNativeEvidence = hasRawNativeStatus || hasRawNativeSource;
    let nativeStatus: IWhatsappConnectionStatus | undefined;
    if (hasAnyNativeEvidence) {
      nativeStatus = this.currentNativeRuntimeHealthStatus(health, workerType);
      const hasCompleteUnavailableNativeEvidence =
        hasRawNativeStatus &&
        hasRawNativeSource &&
        this.isNativeUnavailableForAvailableProjection(nativeStatus);
      if (!hasCompleteUnavailableNativeEvidence) {
        return false;
      }
    }

    const hasExplicitUnavailableSessionEvidence =
      this.hasExplicitUnavailableNativeSessionEvidence(nativeStatus);
    /*
     * A legacy volume may contain credential files while the provider has
     * already rejected them and opened a fresh pairing flow. In that state
     * `has_session` describes files on disk, not an authenticated session.
     * Requiring it to become false makes the recreate lifecycle impossible to
     * finish: the volume must be preserved, so every redrive sees the same
     * files and starts another QR attempt. Accept only the exact runtime's
     * native QR/revocation proof. Connecting and authenticated/Kafka-starting
     * states remain excluded and continue waiting for ONLINE.
     */
    const sessionIsUnavailable =
      health.has_session === false || hasExplicitUnavailableSessionEvidence;
    if (!sessionIsUnavailable) {
      return false;
    }
    if (health.error && !hasExplicitUnavailableSessionEvidence) {
      return false;
    }
    if (
      Number(health.runtime_health_schema_version ?? 0) < 3 ||
      health.worker_id !== data.worker_id ||
      health.account_id !== data.account_id ||
      health.worker_type_id !== workerType ||
      !this.hasExpectedRuntimeGeneration(
        health.runtime_generation,
        expectedRuntimeGeneration
      )
    ) {
      return false;
    }

    return (
      health.activated === true &&
      health.standby === false &&
      health.ready === true &&
      health.qr_stream_ready === true &&
      health.runtime_state === 'active' &&
      health.session_ready === false &&
      health.authenticated === false &&
      health.can_send === false &&
      health.can_receive_runtime === false &&
      !this.normalizeConnectionPhone(health.phone)
    );
  }

  private isNativeUnavailableForAvailableProjection(
    nativeStatus: IWhatsappConnectionStatus | undefined
  ): nativeStatus is IWhatsappConnectionStatus {
    if (
      !nativeStatus ||
      nativeStatus.connected !== false ||
      nativeStatus.authenticated !== false ||
      nativeStatus.sessionValid === true
    ) {
      return false;
    }

    return [
      EWhatsappConnectionStatus.initializing,
      EWhatsappConnectionStatus.connecting,
      EWhatsappConnectionStatus.qr,
      EWhatsappConnectionStatus.offline,
      EWhatsappConnectionStatus.loggedOut,
      EWhatsappConnectionStatus.invalidSession,
      EWhatsappConnectionStatus.stopped,
      EWhatsappConnectionStatus.error,
    ].includes(nativeStatus.status);
  }

  private hasExplicitUnavailableNativeSessionEvidence(
    nativeStatus: IWhatsappConnectionStatus | undefined
  ): nativeStatus is IWhatsappConnectionStatus {
    if (!this.isNativeUnavailableForAvailableProjection(nativeStatus)) {
      return false;
    }
    if (
      nativeStatus.status === EWhatsappConnectionStatus.qr &&
      nativeStatus.qrAvailable === true
    ) {
      return true;
    }
    if (
      (nativeStatus.status === EWhatsappConnectionStatus.loggedOut ||
        nativeStatus.status === EWhatsappConnectionStatus.invalidSession) &&
      nativeStatus.sessionValid === false
    ) {
      return true;
    }
    return (
      nativeStatus.status === EWhatsappConnectionStatus.error &&
      nativeStatus.recoverable === false
    );
  }

  private buildAvailableRecreatedRuntimeProbe(input: {
    data: IWorkerPayload;
    workerType: EWorkerType;
    runtimeGeneration: number;
    nativeStatus?: IWhatsappConnectionStatus;
    hasDurableSession?: boolean;
    providerHandoffOnlineSessionReady?: boolean;
    providerState?: string;
    degradedReason?: string;
    lastProbeAt?: string;
    probeLatencyMs?: number;
  }): RecreatedWorkerRuntimeHealthProbe {
    return {
      reconciliation: {
        workerStatusId: EWorkerStatus.disponible,
        connectionState: {
          code: ECodeMessage.awaitConnection,
          status: EBaileysConnectionStatus.connecting,
          worker_id: input.data.worker_id,
          account_id: input.data.account_id,
          worker_type_id: input.workerType,
          runtime_generation: input.runtimeGeneration,
          phone: undefined,
          worker_status_id: EWorkerStatus.disponible,
          session_ready: false,
          can_send: false,
          can_receive_runtime: false,
          authenticated: false,
          provider_state:
            input.providerState ||
            input.nativeStatus?.status ||
            'awaiting_connection',
          degraded_reason:
            input.degradedReason ||
            input.nativeStatus?.reason ||
            'runtime_ready_without_session',
          last_probe_at: input.lastProbeAt,
          probe_latency_ms: input.probeLatencyMs,
        },
      },
      hasDurableSession: input.hasDurableSession === true,
      providerHandoffOnlineSessionReady:
        input.providerHandoffOnlineSessionReady === true,
    };
  }

  private canUseDurableUnavailableNativeTerminalProof(
    data: IWorkerPayload,
    workerType: EWorkerType
  ): data is IWorkerPayload & { lifecycle_operation_id: string } {
    const previousStatus = data.previous_worker_status_id;
    return Boolean(
      data.action === EWorkerAction.recreate &&
      data.remove_session !== true &&
      data.remove_volume !== true &&
      data.previous_worker_type_id === workerType &&
      previousStatus &&
      UNAVAILABLE_RECREATE_PREVIOUS_STATUSES.has(previousStatus) &&
      data.lifecycle_operation_id &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        data.lifecycle_operation_id
      ) &&
      !this.isSafeSessionStorageMigration(data) &&
      !this.isSafeSessionStorageMigrationRestore(data) &&
      !this.isSafeSessionStorageMigrationFinalization(data)
    );
  }

  private async probeDurableUnavailableNativeTerminal(
    data: IWorkerPayload,
    workerType: EWorkerType,
    expectedRuntimeGeneration: number,
    leaseContext: ILockLeaseContext
  ): Promise<RecreatedWorkerRuntimeHealthProbe | null> {
    if (!this.canUseDurableUnavailableNativeTerminalProof(data, workerType)) {
      return null;
    }

    leaseContext.assertActive();
    const proof =
      await this.workerRuntimeRepository.viewRecreatedWorkerUnavailableNativeTerminalProof(
        {
          worker_id: data.worker_id,
          account_id: data.account_id,
          server_id: data.server_id,
          worker_type_id: workerType,
          lifecycle_operation_id: data.lifecycle_operation_id,
          runtime_generation: expectedRuntimeGeneration,
        }
      );
    leaseContext.assertActive();
    const nativeStatus = normalizeWhatsappConnectionStatus(
      proof?.connection_status,
      WORKER_TYPE_SOURCE_PROVIDER[workerType]
    );
    if (
      !proof ||
      !this.hasExplicitUnavailableNativeSessionEvidence(nativeStatus)
    ) {
      return null;
    }

    this.logDebug('service.recreate_worker.durable_native_terminal_recovered', {
      trace_id: data.debug_trace_id,
      layer: 'service',
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id: workerType,
      lifecycle_operation_id: data.lifecycle_operation_id,
      runtime_generation: expectedRuntimeGeneration,
      container_id: proof.container_id,
      connection_status: nativeStatus.status,
      connection_status_source_id: proof.connection_status_source_id,
      connection_status_sequence: proof.connection_status_sequence,
      connection_status_changed_at: proof.connection_status_changed_at,
    });

    return this.buildAvailableRecreatedRuntimeProbe({
      data,
      workerType,
      runtimeGeneration: expectedRuntimeGeneration,
      nativeStatus,
      providerState: nativeStatus.status,
      degradedReason: nativeStatus.reason || nativeStatus.errorCode,
      lastProbeAt: proof.connection_status_changed_at,
    });
  }

  private currentNativeRuntimeHealthStatus(
    health: IWorkerRuntimeHealthResponseProto | undefined,
    workerType: EWorkerType
  ): IWhatsappConnectionStatus | undefined {
    if (
      Number(health?.runtime_health_schema_version ?? 0) < 3 ||
      !health?.connection_status_source_id ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        health.connection_status_source_id
      )
    ) {
      return undefined;
    }
    const expectedProvider = WORKER_TYPE_SOURCE_PROVIDER[workerType];
    if (!expectedProvider) return undefined;
    return normalizeWhatsappConnectionStatus(
      health.connection_status,
      expectedProvider
    );
  }

  private isRuntimeGenerationCompatible(
    payload: IBaileysConnectionState,
    health: IWorkerRuntimeHealthResponseProto | undefined
  ): boolean {
    const payloadGeneration = this.optionalRuntimeGeneration(
      payload.runtime_generation
    );
    const healthGeneration = this.optionalRuntimeGeneration(
      health?.runtime_generation
    );

    if (payloadGeneration === undefined || healthGeneration === undefined) {
      return true;
    }

    return payloadGeneration === healthGeneration;
  }

  private hasExpectedRuntimeGeneration(
    value: unknown,
    expectedRuntimeGeneration: number
  ): boolean {
    return this.optionalRuntimeGeneration(value) === expectedRuntimeGeneration;
  }

  private isStrictConnectedPayload(
    payload: Partial<IBaileysConnectionState>
  ): boolean {
    const nativeStatus = normalizeWhatsappConnectionStatus(
      payload.connection_status
    );
    return (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        payload.connection_status_source_id ?? ''
      ) &&
      isWhatsappConnectionOnline(nativeStatus) &&
      payload.session_ready === true &&
      payload.can_send === true &&
      payload.can_receive_runtime === true &&
      payload.authenticated === true &&
      Boolean(this.normalizeConnectionPhone(payload.phone))
    );
  }

  private normalizeConnectionPhone(
    phone: string | null | undefined
  ): string | undefined {
    const normalized = phone?.trim();
    return normalized ? normalized : undefined;
  }

  private async clearSelfHealRecoveryAfterNotification(
    payload: IBaileysConnectionState,
    workerStatusId: EWorkerStatus
  ): Promise<void> {
    const workerId = payload.worker_id;
    if (!workerId) {
      return;
    }

    if (
      workerStatusId === EWorkerStatus.online &&
      this.isStrictConnectedPayload(payload)
    ) {
      const recovery = parseWorkerSelfHealRecoveryState(
        await this.redis.get(workerSelfHealRecoveryKey(workerId))
      );
      const recoveryGeneration = this.optionalRuntimeGeneration(
        recovery?.runtime_generation
      );
      const payloadGeneration = this.optionalRuntimeGeneration(
        payload.runtime_generation
      );
      const ownsRecovery =
        Boolean(recovery?.operation_id) &&
        recovery?.worker_id === workerId &&
        recovery?.account_id === payload.account_id &&
        recovery?.worker_type_id === payload.worker_type_id &&
        recoveryGeneration !== undefined &&
        payloadGeneration !== undefined &&
        payloadGeneration > recoveryGeneration;

      if (!ownsRecovery || !recovery?.operation_id) {
        this.logDebug('service.self_heal.recovery_healthy_not_owned', {
          trace_id: payload.debug_trace_id,
          layer: 'service',
          worker_id: workerId,
          account_id: payload.account_id,
          worker_type_id: payload.worker_type_id,
          recovery_operation_id: recovery?.operation_id,
          recovery_runtime_generation: recoveryGeneration,
          payload_runtime_generation: payloadGeneration,
        });
        return;
      }

      const completed = await this.completeSelfHealRecoveryIfOwned(
        workerId,
        recovery.operation_id
      );
      if (!completed) {
        this.logDebug('service.self_heal.recovery_healthy_fence_changed', {
          trace_id: payload.debug_trace_id,
          layer: 'service',
          worker_id: workerId,
          account_id: payload.account_id,
          worker_type_id: payload.worker_type_id,
          recovery_operation_id: recovery.operation_id,
          payload_runtime_generation: payloadGeneration,
        });
        return;
      }

      this.logDebug('service.self_heal.recovery_cleared_healthy', {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: workerId,
        account_id: payload.account_id,
        worker_type_id: payload.worker_type_id,
        status: payload.status,
        worker_status_id: workerStatusId,
        lifecycle_operation_id: recovery.operation_id,
        runtime_generation: payloadGeneration,
      });
      return;
    }

    if (
      workerStatusId === EWorkerStatus.offline &&
      payload.degraded_reason === 'self_heal_recovery_timeout'
    ) {
      const recoveryRaw = await this.redis.get(
        workerSelfHealRecoveryKey(workerId)
      );
      const recovery = parseWorkerSelfHealRecoveryState(recoveryRaw);
      const operationId =
        recovery?.operation_id ?? payload.debug_trace_id ?? 'timeout';
      await this.redis.setex(
        workerSelfHealCooldownKey(workerId),
        this.selfHealCooldownSeconds,
        operationId
      );
      if (recovery?.operation_id) {
        await this.clearSelfHealFencesIfOwned(workerId, recovery.operation_id);
      }
    }
  }

  private async probeRecreatedWorkerRuntimeHealth(
    data: IWorkerPayload,
    workerType: EWorkerType,
    expectedRuntimeGeneration: number,
    leaseContext: ILockLeaseContext
  ): Promise<RecreatedWorkerRuntimeHealthProbe> {
    try {
      leaseContext.assertActive();
      const health = await this.workerBaileysGrpcClientService.runtimeHealth(
        data.worker_id,
        { worker_id: data.worker_id },
        workerType
      );
      leaseContext.assertActive();
      const expectedGeneration = this.hasExpectedRuntimeGeneration(
        health?.runtime_generation,
        expectedRuntimeGeneration
      );
      const hasDurableSession =
        expectedGeneration && health?.has_session === true;
      const connected =
        expectedGeneration && this.isConnectedRuntimeHealth(health, workerType);
      const providerHandoffOnlineSessionReady =
        expectedGeneration &&
        this.isStrictProviderHandoffRuntimeHealth(health, data, workerType);

      if (!connected) {
        if (!expectedGeneration) {
          return {
            reconciliation: null,
            hasDurableSession,
            providerHandoffOnlineSessionReady,
          };
        }

        const nativeStatus = this.currentNativeRuntimeHealthStatus(
          health,
          workerType
        );
        if (
          this.isExplicitlyAvailableRuntimeHealth(
            health,
            data,
            workerType,
            expectedRuntimeGeneration
          )
        ) {
          return this.buildAvailableRecreatedRuntimeProbe({
            data,
            workerType,
            runtimeGeneration: expectedRuntimeGeneration,
            nativeStatus,
            hasDurableSession,
            providerHandoffOnlineSessionReady,
            providerState: health?.provider_state || 'awaiting_connection',
            degradedReason: health?.degraded_reason,
            lastProbeAt: health?.last_probe_at,
            probeLatencyMs: this.normalizeNotifyOptionalNumber(
              health?.probe_latency_ms
            ),
          });
        }

        /*
         * Some runtimes survive long enough to answer gRPC after their
         * provider has terminated, but lose the in-memory native event that
         * caused the termination. Only in that absence may the exact
         * generation's durable primary-DB terminal complete the lifecycle.
         * A live connecting/offline event always wins and keeps waiting.
         */
        if (!nativeStatus) {
          const durableTerminal =
            await this.probeDurableUnavailableNativeTerminal(
              data,
              workerType,
              expectedRuntimeGeneration,
              leaseContext
            );
          if (durableTerminal) {
            return durableTerminal;
          }
        }

        return {
          reconciliation: null,
          hasDurableSession,
          providerHandoffOnlineSessionReady,
        };
      }

      return {
        reconciliation: {
          workerStatusId: EWorkerStatus.online,
          connectionState: {
            code: ECodeMessage.connectionEstablished,
            status: EBaileysConnectionStatus.connected,
            worker_id: data.worker_id,
            account_id: data.account_id,
            worker_type_id: workerType,
            runtime_generation: expectedRuntimeGeneration,
            phone: this.normalizeConnectionPhone(health?.phone),
            worker_status_id: EWorkerStatus.online,
            session_ready: true,
            can_send: health?.can_send,
            can_receive_runtime: health?.can_receive_runtime,
            authenticated: health?.authenticated,
            provider_state: health?.provider_state,
            degraded_reason: health?.degraded_reason,
            last_probe_at: health?.last_probe_at,
            probe_latency_ms: this.normalizeNotifyOptionalNumber(
              health?.probe_latency_ms
            ),
          },
        },
        hasDurableSession,
        providerHandoffOnlineSessionReady,
      };
    } catch {
      leaseContext.assertActive();
      const durableTerminal = await this.probeDurableUnavailableNativeTerminal(
        data,
        workerType,
        expectedRuntimeGeneration,
        leaseContext
      );
      if (durableTerminal) {
        return durableTerminal;
      }
      return {
        reconciliation: null,
        hasDurableSession: false,
        providerHandoffOnlineSessionReady: false,
      };
    }
  }

  private async reconcileRecreatedWorkerConnection(
    data: IWorkerPayload,
    workerType: EWorkerType,
    expectedRuntimeGeneration: number,
    leaseContext: ILockLeaseContext
  ): Promise<RecreateConnectionReconciliation> {
    leaseContext.assertActive();
    const providerHandoffMode =
      await this.resolvePostgresProviderHandoffReconciliationMode(
        data,
        workerType
      );
    const providerHandoffProtectedRestore =
      providerHandoffMode === 'handoff' || providerHandoffMode === 'recovery';
    leaseContext.assertActive();
    if (
      providerHandoffProtectedRestore ||
      !this.shouldReconcileRecreatedWorkerConnection(data)
    ) {
      const confirmed = await this.waitForRecreatedWorkerConnectionConfirmation(
        data,
        workerType,
        expectedRuntimeGeneration,
        leaseContext,
        {
          requireOnlineSession: providerHandoffProtectedRestore,
          providerHandoffMode: providerHandoffProtectedRestore
            ? providerHandoffMode
            : undefined,
          ...(providerHandoffProtectedRestore
            ? { timeoutMs: this.providerHandoffOnlineReconciliationWaitMs }
            : {}),
        }
      );
      if (confirmed) {
        return confirmed;
      }

      throw new Error(
        providerHandoffMode === 'handoff'
          ? `Provider handoff target session readiness was not confirmed for ${data.worker_id}`
          : providerHandoffMode === 'recovery'
            ? `Provider handoff recovery source session readiness was not confirmed for ${data.worker_id}`
            : `Recreated worker runtime readiness was not confirmed for ${data.worker_id}`
      );
    }

    if (data.previous_worker_status_id !== EWorkerStatus.online) {
      const healthProbe = await this.probeRecreatedWorkerRuntimeHealth(
        data,
        workerType,
        expectedRuntimeGeneration,
        leaseContext
      );
      const healthReconciliation = healthProbe.reconciliation;

      /*
       * A channel which was already waiting for pairing has no online
       * identity to preserve. When its exact recreated runtime explicitly
       * exposes a terminal QR/revocation state, finish immediately even if
       * legacy credential files still exist on disk. Calling
       * requestConnection in this state blocks until the provider's QR
       * window expires and can turn a conclusive QR result into an endless
       * reconnect loop.
       */
      if (healthReconciliation) {
        return healthReconciliation;
      }

      if (!healthProbe.hasDurableSession) {
        if (healthReconciliation) {
          return healthReconciliation;
        }

        const delayedConnection =
          await this.waitForRecreatedWorkerConnectionConfirmation(
            data,
            workerType,
            expectedRuntimeGeneration,
            leaseContext
          );

        if (delayedConnection) {
          return delayedConnection;
        }

        throw new Error(
          `Recreated worker connection state was not confirmed for ${data.worker_id}`
        );
      }
    }

    const payload: StatusConnectionWorkerRequest = {
      worker_id: data.worker_id,
      status: EWorkerStatus.online,
      type: EBaileysConnectionType.qrcode,
      debug_trace_id: data.debug_trace_id,
      runtime_generation: expectedRuntimeGeneration,
    };
    if (
      data.previous_worker_status_id &&
      UNAVAILABLE_RECREATE_PREVIOUS_STATUSES.has(data.previous_worker_status_id)
    ) {
      /*
       * A legacy volume can still contain credential files after the provider
       * has rejected the session. Authorize an interactive QR attempt only
       * when this lifecycle started from an already-unavailable channel. An
       * ordinary request treats those files as a restorable session, so the
       * native socket can emit QR internally without allowing the worker to
       * publish it, then close with 408 and repeat forever.
       */
      payload.qr_pending = true;
    }

    try {
      leaseContext.assertActive();
      const response =
        await this.workerBaileysGrpcClientService.requestConnection(
          data.worker_id,
          payload,
          workerType
        );
      leaseContext.assertActive();
      const connected =
        this.hasExpectedRuntimeGeneration(
          response?.runtime_generation,
          expectedRuntimeGeneration
        ) && this.isConnectedConnectionState(response);

      if (!connected) {
        const delayedConnection =
          await this.waitForRecreatedWorkerConnectionConfirmation(
            data,
            workerType,
            expectedRuntimeGeneration,
            leaseContext
          );

        if (delayedConnection) {
          return delayedConnection;
        }

        throw new Error(
          `Recreated worker connection confirmation remained pending for ${data.worker_id}`
        );
      }

      return this.reconcileConnectedResponseWithRuntimeHealth(
        data,
        workerType,
        expectedRuntimeGeneration,
        {
          code: response?.code ?? ECodeMessage.connectionEstablished,
          status:
            response?.status === EBaileysConnectionStatus.connected
              ? response.status
              : EBaileysConnectionStatus.connected,
          worker_id: data.worker_id,
          account_id: data.account_id,
          phone: this.normalizeConnectionPhone(response?.phone),
          worker_status_id: EWorkerStatus.online,
          debug_trace_id: data.debug_trace_id,
          runtime_generation: expectedRuntimeGeneration,
          session_ready: true,
          can_send: response?.can_send,
          can_receive_runtime: response?.can_receive_runtime,
          authenticated: response?.authenticated,
          provider_state: response?.provider_state,
          degraded_reason: response?.degraded_reason,
          last_probe_at: response?.last_probe_at,
          probe_latency_ms: response?.probe_latency_ms,
        },
        leaseContext
      );
    } catch (error) {
      leaseContext.assertActive();
      if (isWorkerConnectionDeadlineExceeded(error)) {
        const delayedConnection =
          await this.waitForRecreatedWorkerConnectionConfirmation(
            data,
            workerType,
            expectedRuntimeGeneration,
            leaseContext
          );

        if (delayedConnection) {
          return delayedConnection;
        }

        this.logDebug('service.recreate_worker.connection_request_pending', {
          trace_id: data.debug_trace_id,
          layer: 'service',
          worker_id: data.worker_id,
          account_id: data.account_id,
          worker_type_id: workerType,
          lifecycle_operation_id: data.lifecycle_operation_id,
          runtime_generation: expectedRuntimeGeneration,
          reason: 'request_connection_deadline_exceeded',
        });
        throw new Error(
          `Recreated worker connection request timed out before readiness for ${data.worker_id}`
        );
      }

      const delayedConnection =
        await this.waitForRecreatedWorkerConnectionConfirmation(
          data,
          workerType,
          expectedRuntimeGeneration,
          leaseContext
        );
      if (delayedConnection) {
        return delayedConnection;
      }

      throw error;
    }
  }

  private async reconcileConnectedResponseWithRuntimeHealth(
    data: IWorkerPayload,
    workerType: EWorkerType,
    expectedRuntimeGeneration: number,
    connectionState: IBaileysConnectionState,
    leaseContext: ILockLeaseContext
  ): Promise<RecreateConnectionReconciliation> {
    const { reconciliation: healthReconciliation } =
      await this.probeRecreatedWorkerRuntimeHealth(
        data,
        workerType,
        expectedRuntimeGeneration,
        leaseContext
      );
    const healthState = healthReconciliation?.connectionState;
    const responsePhone = this.normalizeConnectionPhone(connectionState.phone);
    const healthPhone = this.normalizeConnectionPhone(healthState?.phone);

    if (!healthState) {
      return {
        workerStatusId: EWorkerStatus.online,
        connectionState: {
          ...connectionState,
          phone: responsePhone,
        },
      };
    }

    if (healthReconciliation.workerStatusId === EWorkerStatus.disponible) {
      return healthReconciliation;
    }

    return {
      workerStatusId: EWorkerStatus.online,
      connectionState: {
        ...connectionState,
        worker_id: data.worker_id,
        account_id: data.account_id,
        worker_type_id:
          connectionState.worker_type_id ?? healthState.worker_type_id,
        phone: healthPhone ?? responsePhone,
        worker_status_id: EWorkerStatus.online,
        debug_trace_id: connectionState.debug_trace_id ?? data.debug_trace_id,
        runtime_generation: expectedRuntimeGeneration,
        session_ready: true,
        can_send: healthState.can_send ?? connectionState.can_send,
        can_receive_runtime:
          healthState.can_receive_runtime ??
          connectionState.can_receive_runtime,
        authenticated:
          healthState.authenticated ?? connectionState.authenticated,
        provider_state:
          healthState.provider_state ?? connectionState.provider_state,
        degraded_reason:
          healthState.degraded_reason ?? connectionState.degraded_reason,
        last_probe_at:
          healthState.last_probe_at ?? connectionState.last_probe_at,
        probe_latency_ms:
          healthState.probe_latency_ms ?? connectionState.probe_latency_ms,
      },
    };
  }

  private async waitForRecreatedWorkerConnectionConfirmation(
    data: IWorkerPayload,
    workerType: EWorkerType,
    expectedRuntimeGeneration: number,
    leaseContext: ILockLeaseContext,
    options: {
      requireOnlineSession?: boolean;
      timeoutMs?: number;
      providerHandoffMode?: Extract<
        PostgresProviderHandoffReconciliationMode,
        'handoff' | 'recovery'
      >;
    } = {}
  ): Promise<RecreateConnectionReconciliation | null> {
    const protectedSessionStorageMigration =
      this.isSafeSessionStorageMigration(data) ||
      this.isSafeSessionStorageMigrationRestore(data) ||
      this.isSafeSessionStorageMigrationFinalization(data);
    const deadline =
      Date.now() +
      Math.max(
        1,
        options.timeoutMs ??
          (protectedSessionStorageMigration
            ? this.sessionStorageMigrationOnlineReconciliationWaitMs
            : this.recreateOnlineReconciliationWaitMs)
      );
    const preferRestoredOnlineSession =
      data.previous_worker_status_id === EWorkerStatus.online ||
      protectedSessionStorageMigration;
    const requireOnlineSession = options.requireOnlineSession === true;
    let consecutiveAvailableRuntimeProbes = 0;

    while (Date.now() <= deadline) {
      leaseContext.assertActive();
      const healthProbe = await this.probeRecreatedWorkerRuntimeHealth(
        data,
        workerType,
        expectedRuntimeGeneration,
        leaseContext
      );
      const healthReconciliation = healthProbe.reconciliation;

      if (requireOnlineSession) {
        const mode =
          await this.resolvePostgresProviderHandoffReconciliationMode(
            data,
            workerType
          );
        leaseContext.assertActive();
        if (mode !== options.providerHandoffMode) {
          throw new Error('postgres_provider_handoff_context_changed');
        }
      }

      if (healthReconciliation) {
        if (
          (!preferRestoredOnlineSession && !requireOnlineSession) ||
          (healthReconciliation.workerStatusId === EWorkerStatus.online &&
            (!requireOnlineSession ||
              healthProbe.providerHandoffOnlineSessionReady))
        ) {
          return healthReconciliation;
        }

        if (!requireOnlineSession) {
          consecutiveAvailableRuntimeProbes += 1;
          if (consecutiveAvailableRuntimeProbes >= 2) {
            return healthReconciliation;
          }
        }
      } else {
        // A negative or failed probe invalidates earlier availability. Never
        // finalize from a QR-ready snapshot that may be up to a minute stale.
        consecutiveAvailableRuntimeProbes = 0;
      }

      if (Date.now() > deadline) {
        break;
      }

      await this.sleep(this.recreateOnlineReconciliationPollIntervalMs);
      leaseContext.assertActive();
    }

    return null;
  }

  private buildRecreateFinalWorkerUpdate(
    data: IWorkerPayload,
    workerType: EWorkerType,
    containerId: string,
    shouldClearSessionIdentity: boolean,
    reconciliation: RecreateConnectionReconciliation
  ): IUpdateWorker {
    const inputUpdate: IUpdateWorker = {
      worker_id: data.worker_id,
      worker_status_id: reconciliation.workerStatusId,
      worker_type_id: workerType,
      container_id: containerId,
      ...(data.lifecycle_operation_id ? { lifecycle_operation_id: null } : {}),
    };

    const runtimeConfirmedSessionAbsent =
      reconciliation.workerStatusId === EWorkerStatus.disponible &&
      reconciliation.connectionState?.session_ready === false &&
      reconciliation.connectionState.authenticated === false &&
      reconciliation.connectionState.can_send === false &&
      reconciliation.connectionState.can_receive_runtime === false;

    if (shouldClearSessionIdentity || runtimeConfirmedSessionAbsent) {
      inputUpdate.number = null;
      inputUpdate.connection_date = null;
      return inputUpdate;
    }

    if (reconciliation.workerStatusId === EWorkerStatus.online) {
      inputUpdate.connection_date = currentTime();
      const phone = this.normalizeConnectionPhone(
        reconciliation.connectionState?.phone
      );
      if (phone) {
        inputUpdate.number = phone;
      }
    }

    return inputUpdate;
  }

  private async publishWorkerRecreateFinalState(
    data: IWorkerPayload,
    reconciliation: RecreateConnectionReconciliation,
    runtimeGeneration: number,
    workerType: EWorkerType
  ): Promise<PublishResult> {
    if (
      reconciliation.workerStatusId !== EWorkerStatus.online &&
      reconciliation.workerStatusId !== EWorkerStatus.disponible
    ) {
      throw new Error('worker_recreate_terminal_status_invalid');
    }
    return this.publishManagerWorkerRecreateTerminal({
      data,
      workerType,
      runtimeGeneration,
      workerStatusId: reconciliation.workerStatusId,
    });
  }

  private async reserveWorkerRuntimeGeneration(
    data: IWorkerPayload,
    sessionVolumeName: string | null,
    runtimeGeneration: number
  ): Promise<void> {
    if (!this.workerRuntimeRepository) {
      return;
    }

    await this.workerRuntimeRepository.upsert({
      worker_id: data.worker_id,
      container_id: null,
      container_name: data.worker_id,
      session_storage: this.sessionStorageFor(data),
      session_volume_name: sessionVolumeName,
      runtime_generation: runtimeGeneration,
    });
    this.logDebug('service.worker_runtime.generation_reserved', {
      trace_id: data.debug_trace_id,
      layer: 'service',
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id: data.worker_type_id,
      lifecycle_operation_id: data.lifecycle_operation_id,
      runtime_generation: runtimeGeneration,
      session_volume_name: sessionVolumeName,
    });
  }

  private async reserveNextWorkerRuntimeGeneration(
    data: IWorkerPayload,
    sessionVolumeName: string | null,
    currentRuntimeGeneration?: number | null,
    warmPoolId?: string | null
  ): Promise<number> {
    const managedWhatsappWorker =
      data.worker_type_id === EWorkerType.baileys ||
      data.worker_type_id === EWorkerType.wwebjs ||
      data.worker_type_id === EWorkerType.whatsmeow;
    const durableFenceGeneration = managedWhatsappWorker
      ? await new WhatsappRuntimeFenceService(
          this.redis
        ).viewRuntimeGenerationFloor(data.worker_id)
      : null;
    const minimumRuntimeGeneration =
      durableFenceGeneration === null
        ? undefined
        : this.incrementRuntimeGeneration(durableFenceGeneration);

    if (
      this.workerRuntimeRepository &&
      typeof this.workerRuntimeRepository.reserveNextRuntimeGeneration ===
        'function'
    ) {
      const runtimeGeneration =
        await this.workerRuntimeRepository.reserveNextRuntimeGeneration({
          worker_id: data.worker_id,
          container_name: data.worker_id,
          session_storage: this.sessionStorageFor(data),
          session_volume_name: sessionVolumeName,
          warm_pool_id: warmPoolId,
          minimum_runtime_generation: minimumRuntimeGeneration,
        });
      this.logDebug('service.worker_runtime.generation_reserved', {
        trace_id: data.debug_trace_id,
        layer: 'service',
        worker_id: data.worker_id,
        account_id: data.account_id,
        worker_type_id: data.worker_type_id,
        lifecycle_operation_id: data.lifecycle_operation_id,
        runtime_generation: runtimeGeneration,
        session_volume_name: sessionVolumeName,
        warm_pool_id: warmPoolId,
        durable_fence_generation: durableFenceGeneration,
      });
      return runtimeGeneration;
    }

    const runtimeGeneration = this.incrementRuntimeGeneration(
      Math.max(
        currentRuntimeGeneration ??
          (await this.viewWorkerRuntimeConsistent(data.worker_id))
            ?.runtime_generation ??
          0,
        durableFenceGeneration ?? 0
      )
    );
    await this.reserveWorkerRuntimeGeneration(
      data,
      sessionVolumeName,
      runtimeGeneration
    );
    return runtimeGeneration;
  }

  /**
   * A PostgreSQL provider handoff deliberately leaves `worker.worker_type_id`
   * on the source provider until the target revision has been promoted.  The
   * target recreate still has to remove the already-drained source runtime
   * before it can reserve its own generation.  Do not use the generic
   * recreate type equality fence for that one transition: prove the exact
   * handoff target against the primary database instead.
   */
  private async isPostgresProviderHandoffSourceRuntimeRemovalAuthorized(
    data: IWorkerPayload,
    worker: IWorkerMonitor | null,
    expected: RuntimeRemovalIdentity
  ): Promise<boolean> {
    if (
      data.action !== EWorkerAction.recreate ||
      expected.sessionStorage !== EWorkerSessionStorage.postgres ||
      expected.sessionVolumeName !== null ||
      !worker ||
      !data.worker_type_id ||
      worker.worker_type_id === data.worker_type_id ||
      worker.server_id !== data.server_id ||
      worker.session_storage !== EWorkerSessionStorage.postgres ||
      data.remove_session === true ||
      data.remove_volume === true
    ) {
      return false;
    }

    return this.isPostgresProviderHandoffTargetAuthorized(data, worker);
  }

  /**
   * The target command names the target provider, while the container being
   * removed still truthfully identifies the source provider. Once the same
   * primary-database handoff proof authorizes that exceptional removal, check
   * every immutable Docker field against the source identity instead of
   * weakening the container-label fence.
   */
  private async isPostgresProviderHandoffSourceContainerIdentityAuthorized(
    data: IWorkerPayload,
    inspection: WorkerContainerInspection,
    expected: RuntimeRemovalIdentity,
    worker: IWorkerMonitor | null,
    runtime: IWorkerRuntime | null
  ): Promise<boolean> {
    const sourceWorkerType = worker?.worker_type_id;
    const sourceProvider = sourceWorkerType
      ? WORKER_TYPE_SOURCE_PROVIDER[sourceWorkerType]
      : undefined;
    if (
      !sourceProvider ||
      runtime?.source_provider?.trim().toLowerCase() !== sourceProvider ||
      !(await this.isPostgresProviderHandoffSourceRuntimeRemovalAuthorized(
        data,
        worker,
        expected
      ))
    ) {
      return false;
    }

    const sourceServerId = data.previous_server_id?.trim() || data.server_id;
    const sourceConflict = this.resolveRuntimeRemovalContainerConflict(
      {
        ...data,
        server_id: sourceServerId,
        worker_type_id: sourceWorkerType,
      },
      inspection,
      expected,
      runtime
    );
    return sourceConflict === undefined;
  }

  private async assertRuntimeRemovalDatabaseFence(
    data: IWorkerPayload,
    worker: IWorkerMonitor | null,
    runtime: IWorkerRuntime | null,
    expected: RuntimeRemovalDatabaseIdentity
  ): Promise<void> {
    const allowsPreviousRuntimeIdentity = data.action === EWorkerAction.cleanup;
    const allowsLegacyVolumeToPostgresSourceIdentity =
      this.isLegacyVolumeToPostgresSourceCleanup(data, worker, expected);
    const allowsSafeSessionStorageMigrationSourceIdentity =
      this.isSafeSessionStorageMigrationSourceRuntimeRetirement(
        data,
        worker,
        runtime,
        expected
      );
    const allowsSafeSessionStorageMigrationRestoreSourceIdentity =
      this.isSafeSessionStorageMigrationRestoreSourceRuntimeRetirement(
        data,
        worker,
        runtime,
        expected
      );
    const allowsPostgresProviderHandoffSourceIdentity =
      await this.isPostgresProviderHandoffSourceRuntimeRemovalAuthorized(
        data,
        worker,
        expected
      );
    const runtimeSessionStorage =
      runtime?.session_storage ?? EWorkerSessionStorage.legacy_volume;
    const workerSessionStorage =
      worker?.session_storage ?? EWorkerSessionStorage.legacy_volume;
    const validSessionBackend =
      expected.sessionStorage === EWorkerSessionStorage.legacy_volume
        ? Boolean(expected.sessionVolumeName) &&
          runtimeSessionStorage === EWorkerSessionStorage.legacy_volume
        : expected.sessionStorage === EWorkerSessionStorage.postgres &&
          expected.sessionVolumeName === null &&
          runtimeSessionStorage === EWorkerSessionStorage.postgres &&
          /^[0-9a-f]{64}$/u.test(runtime?.runtime_capability_hash ?? '') &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
            runtime?.session_writer_epoch ?? ''
          );
    if (
      !data.lifecycle_operation_id ||
      (!allowsLegacyVolumeToPostgresSourceIdentity &&
        !allowsSafeSessionStorageMigrationSourceIdentity &&
        !allowsSafeSessionStorageMigrationRestoreSourceIdentity &&
        this.sessionStorageFor(data) !== expected.sessionStorage) ||
      !validSessionBackend ||
      !worker ||
      worker.deleted_at ||
      worker.worker_id !== data.worker_id ||
      worker.account_id !== data.account_id ||
      worker.lifecycle_operation_id !== data.lifecycle_operation_id ||
      (!allowsLegacyVolumeToPostgresSourceIdentity &&
        !allowsSafeSessionStorageMigrationSourceIdentity &&
        !allowsSafeSessionStorageMigrationRestoreSourceIdentity &&
        workerSessionStorage !== expected.sessionStorage) ||
      worker.worker_status_id !== expected.workerStatusId ||
      (worker.worker_status_id !== EWorkerStatus.recreating &&
        worker.worker_status_id !== EWorkerStatus.blocked) ||
      worker.container_id !== expected.containerId ||
      (!allowsPreviousRuntimeIdentity &&
        !allowsPostgresProviderHandoffSourceIdentity &&
        (worker.server_id !== data.server_id ||
          (data.worker_type_id &&
            worker.worker_type_id !== data.worker_type_id))) ||
      !runtime ||
      runtime.worker_id !== data.worker_id ||
      runtime.container_id !== expected.containerId ||
      runtime.container_name !== data.worker_id ||
      runtime.session_volume_name !== expected.sessionVolumeName ||
      runtime.runtime_generation !== expected.runtimeGeneration
    ) {
      throw new Error('worker_runtime_removal_database_fence_changed');
    }
  }

  private isRuntimePointerRepairAuthorized(
    data: IWorkerPayload,
    worker: IWorkerMonitor,
    runtime: IWorkerRuntime,
    expected: RuntimeRemovalDatabaseIdentity
  ): boolean {
    const repairsLegacyVolumeToPostgresSource =
      this.isLegacyVolumeToPostgresSourceCleanup(data, worker, expected);
    const repairsSafeSessionStorageMigrationSource =
      this.isSafeSessionStorageMigrationSourceRuntimeRetirement(
        data,
        worker,
        runtime,
        expected
      );
    const repairsSafeSessionStorageMigrationRestoreSource =
      this.isSafeSessionStorageMigrationRestoreSourceRuntimeRetirement(
        data,
        worker,
        runtime,
        expected
      );
    const repairsCurrentRecreate =
      data.action === EWorkerAction.recreate &&
      worker.server_id === data.server_id &&
      worker.worker_type_id === data.worker_type_id;
    const repairsPreviousRuntimeCleanup =
      data.action === EWorkerAction.cleanup &&
      data.previous_worker_type_id === data.worker_type_id &&
      (worker.server_id !== data.server_id ||
        worker.worker_type_id !== data.worker_type_id);
    const runtimeSourceProvider = runtime.source_provider?.trim().toLowerCase();
    const expectedSourceProvider = data.worker_type_id
      ? WORKER_TYPE_SOURCE_PROVIDER[data.worker_type_id]
      : undefined;
    const validPreviousCleanupIntent =
      expected.sessionStorage === EWorkerSessionStorage.legacy_volume
        ? data.remove_session === true &&
          data.remove_volume === true &&
          (this.sessionStorageFor(data) ===
            EWorkerSessionStorage.legacy_volume ||
            repairsLegacyVolumeToPostgresSource)
        : data.remove_session !== true && data.remove_volume === false;

    return Boolean(
      (repairsCurrentRecreate ||
        (repairsPreviousRuntimeCleanup && validPreviousCleanupIntent)) &&
      data.lifecycle_operation_id &&
      data.worker_type_id &&
      worker.worker_id === data.worker_id &&
      worker.account_id === data.account_id &&
      !worker.deleted_at &&
      worker.server_id &&
      worker.worker_type_id &&
      worker.worker_status_id === EWorkerStatus.recreating &&
      worker.lifecycle_operation_id === data.lifecycle_operation_id &&
      ((worker.session_storage ?? EWorkerSessionStorage.legacy_volume) ===
        expected.sessionStorage ||
        (repairsLegacyVolumeToPostgresSource &&
          worker.session_storage === EWorkerSessionStorage.postgres) ||
        repairsSafeSessionStorageMigrationSource ||
        repairsSafeSessionStorageMigrationRestoreSource) &&
      worker.runtime_container_id === expected.containerId &&
      worker.runtime_generation === expected.runtimeGeneration &&
      worker.runtime_session_volume_name === expected.sessionVolumeName &&
      runtime.worker_id === data.worker_id &&
      runtime.container_id === expected.containerId &&
      runtime.container_name === data.worker_id &&
      (runtime.session_storage ?? EWorkerSessionStorage.legacy_volume) ===
        expected.sessionStorage &&
      runtime.session_volume_name === expected.sessionVolumeName &&
      runtime.runtime_generation === expected.runtimeGeneration &&
      (!runtimeSourceProvider ||
        runtimeSourceProvider === expectedSourceProvider)
    );
  }

  /**
   * Recover the narrow crash window after a PostgreSQL handoff target claimed
   * its cold runtime but Docker removed that target before promotion finished.
   *
   * The normal pointer-repair path deliberately requires the worker row to
   * name the recreate provider. During a handoff it must still name the source
   * provider, so retrying this otherwise abandoned target reservation would
   * fence itself forever. Only same-server handoffs can prove both the drained
   * source control container and the target reservation are absent locally.
   * A cross-server migration must retain its ordinary cleanup fence instead.
   */
  private async isAbsentPostgresProviderHandoffTargetReservationRecoveryAuthorized(
    data: IWorkerPayload,
    worker: IWorkerMonitor,
    runtime: IWorkerRuntime,
    expected: RuntimeRemovalDatabaseIdentity,
    leaseContext: ILockLeaseContext
  ): Promise<boolean> {
    const sourceContainerId = worker.container_id?.trim().toLowerCase();
    const targetContainerId = expected.containerId.trim().toLowerCase();
    const previousServerId = data.previous_server_id?.trim();
    const lifecycleOperationId = data.lifecycle_operation_id?.trim();
    const targetProvider = data.worker_type_id
      ? WORKER_TYPE_SOURCE_PROVIDER[data.worker_type_id]
      : undefined;
    // The established cold-reservation recovery accepts the pre-activation
    // row by its null provider marker. Preserve that backward-compatible
    // fence; activated targets require the stronger lifecycle proof below.
    const targetRuntimeIsUnactivated = runtime.source_provider === null;
    const targetRuntimeIsActivated = Boolean(
      lifecycleOperationId &&
      targetProvider &&
      runtime.source_provider === targetProvider &&
      runtime.connection_epoch?.trim() &&
      Number.isSafeInteger(runtime.connection_sequence) &&
      runtime.connection_sequence > 0 &&
      runtime.connection_activated_at?.trim() &&
      Number.isFinite(Date.parse(runtime.connection_activated_at)) &&
      runtime.recreate_bootstrap_operation_id === lifecycleOperationId &&
      runtime.recreate_bootstrap_runtime_generation ===
        expected.runtimeGeneration &&
      runtime.recreate_bootstrap_container_id?.trim().toLowerCase() ===
        targetContainerId &&
      Boolean(runtime.recreate_bootstrap_started_at)
    );
    if (
      previousServerId !== data.server_id ||
      !sourceContainerId ||
      !DOCKER_CONTAINER_ID_PATTERN.test(sourceContainerId) ||
      !DOCKER_CONTAINER_ID_PATTERN.test(targetContainerId) ||
      sourceContainerId === targetContainerId ||
      runtime.container_id?.trim().toLowerCase() !== targetContainerId ||
      runtime.session_storage !== EWorkerSessionStorage.postgres ||
      runtime.session_volume_name !== null ||
      (!targetRuntimeIsUnactivated && !targetRuntimeIsActivated) ||
      !/^[0-9a-f]{64}$/u.test(runtime.runtime_capability_hash ?? '') ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
        runtime.session_writer_epoch ?? ''
      ) ||
      !(await this.isPostgresProviderHandoffSourceRuntimeRemovalAuthorized(
        data,
        worker,
        expected
      ))
    ) {
      return false;
    }

    const [sourceControl, targetReservation] = await Promise.all([
      this.workerService.inspectContainerWorkerByIdStrict(sourceContainerId),
      this.workerService.inspectContainerWorkerByIdStrict(targetContainerId),
    ]);
    leaseContext.assertActive();
    return !sourceControl.exists && !targetReservation.exists;
  }

  private async reconcileRuntimePointer(input: {
    data: IWorkerPayload;
    worker: IWorkerMonitor;
    runtime: IWorkerRuntime;
    expected: {
      containerId: string;
      runtimeGeneration: number;
      sessionStorage: EWorkerSessionStorage;
      sessionVolumeName: string | null;
      workerStatusId: EWorkerStatus;
    };
    leaseContext: ILockLeaseContext;
  }): Promise<IWorkerMonitor> {
    const { data, worker, runtime, expected, leaseContext } = input;
    if (worker.container_id === expected.containerId) {
      return worker;
    }
    const currentPointerRepairAuthorized =
      this.isRuntimePointerRepairAuthorized(data, worker, runtime, expected);
    const abandonedHandoffTargetReservationAuthorized =
      !currentPointerRepairAuthorized &&
      (await this.isAbsentPostgresProviderHandoffTargetReservationRecoveryAuthorized(
        data,
        worker,
        runtime,
        expected,
        leaseContext
      ));
    leaseContext.assertActive();
    if (
      (!currentPointerRepairAuthorized &&
        !abandonedHandoffTargetReservationAuthorized) ||
      !DOCKER_CONTAINER_ID_PATTERN.test(expected.containerId)
    ) {
      throw new Error('worker_runtime_removal_database_fence_changed');
    }

    const staleControlContainerId = worker.container_id?.trim();
    if (staleControlContainerId) {
      if (!DOCKER_CONTAINER_ID_PATTERN.test(staleControlContainerId)) {
        throw new Error('worker_runtime_removal_database_fence_changed');
      }
      const staleControlContainer =
        await this.workerService.inspectContainerWorkerByIdStrict(
          staleControlContainerId
        );
      leaseContext.assertActive();
      if (staleControlContainer.exists) {
        throw new Error('worker_runtime_removal_stale_control_still_exists');
      }
    }

    const runtimeContainer =
      await this.workerService.inspectContainerWorkerByIdStrict(
        expected.containerId
      );
    leaseContext.assertActive();
    if (runtimeContainer.exists) {
      await this.assertRuntimeRemovalContainerIdentityOrLegacyWarm(
        data,
        runtimeContainer,
        expected,
        worker,
        runtime
      );
    }

    const repaired =
      await this.workerService.updateWorkerByIdIfLifecycleMatches(
        worker.account_id,
        {
          worker_id: worker.worker_id,
          container_id: expected.containerId,
        },
        {
          lifecycle_operation_id: data.lifecycle_operation_id,
          container_id: worker.container_id,
          runtime_container_id: expected.containerId,
          runtime_generation: expected.runtimeGeneration,
          runtime_session_volume_name: expected.sessionVolumeName,
          server_id: worker.server_id,
          worker_type_id: worker.worker_type_id,
          worker_status_id: worker.worker_status_id,
          updated_at: worker.updated_at,
        }
      );
    leaseContext.assertActive();

    const reconciled = await this.viewWorkerForMonitorConsistent(
      data.worker_id
    );
    leaseContext.assertActive();
    if (
      !reconciled ||
      reconciled.deleted_at ||
      reconciled.account_id !== worker.account_id ||
      reconciled.server_id !== worker.server_id ||
      reconciled.worker_type_id !== worker.worker_type_id ||
      reconciled.worker_status_id !== worker.worker_status_id ||
      reconciled.lifecycle_operation_id !== data.lifecycle_operation_id ||
      reconciled.container_id !== expected.containerId ||
      reconciled.runtime_container_id !== expected.containerId ||
      reconciled.runtime_generation !== expected.runtimeGeneration ||
      reconciled.runtime_session_volume_name !== expected.sessionVolumeName
    ) {
      throw new Error('worker_runtime_removal_pointer_repair_raced');
    }

    this.logDebug('service.worker_runtime.pointer_reconciled', {
      trace_id: data.debug_trace_id,
      layer: 'service',
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id: worker.worker_type_id,
      previous_worker_type_id: data.worker_type_id,
      previous_server_id: data.server_id,
      lifecycle_operation_id: data.lifecycle_operation_id,
      stale_container_id: worker.container_id,
      runtime_container_id: expected.containerId,
      runtime_generation: expected.runtimeGeneration,
      session_volume_name: expected.sessionVolumeName,
      repaired,
    });
    return reconciled;
  }

  private resolveRuntimeRemovalContainerConflict(
    data: IWorkerPayload,
    inspection: WorkerContainerInspection,
    expected: RuntimeRemovalIdentity,
    runtime?: IWorkerRuntime | null
  ): string | undefined {
    const labels = inspection.container_labels ?? {};
    const env = inspection.container_env ?? {};
    const postgresWarmLineage = Boolean(
      expected.sessionStorage === EWorkerSessionStorage.postgres &&
      runtime?.worker_id === data.worker_id &&
      runtime.container_id === expected.containerId &&
      runtime.runtime_generation === expected.runtimeGeneration &&
      runtime.session_volume_name === null &&
      /^[0-9a-f]{64}$/u.test(runtime.runtime_capability_hash ?? '') &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
        runtime.session_writer_epoch ?? ''
      ) &&
      runtime.warm_pool_id &&
      labels['underchat.warm_pool_id'] === runtime.warm_pool_id &&
      env.WARM_POOL_ID === runtime.warm_pool_id &&
      labels['underchat.warm_standby'] === 'true' &&
      env.WARM_STANDBY === 'true' &&
      labels['underchat.worker_id'] === undefined &&
      labels['underchat.account_id'] === undefined &&
      labels['underchat.runtime_generation'] === undefined &&
      env.WORKER_ID === undefined &&
      env.ACCOUNT_ID === undefined &&
      env.RUNTIME_GENERATION === undefined
    );

    if (!inspection.exists) {
      return 'container_missing';
    }
    if (
      !inspection.container_id ||
      inspection.container_id !== expected.containerId
    ) {
      return 'container_id';
    }
    if (inspection.container_name !== data.worker_id) {
      return 'container_name';
    }
    if (
      (!postgresWarmLineage &&
        labels['underchat.worker_id'] !== data.worker_id) ||
      (!postgresWarmLineage && env.WORKER_ID !== data.worker_id)
    ) {
      return 'worker_id';
    }
    if (
      (!postgresWarmLineage &&
        labels['underchat.account_id'] !== data.account_id) ||
      (!postgresWarmLineage && env.ACCOUNT_ID !== data.account_id)
    ) {
      return 'account_id';
    }

    // Containers created before server ownership was stamped have neither
    // identity. Their removal remains fenced by the authoritative worker/runtime
    // rows and every other immutable Docker identity below. During a rolling
    // upgrade, reject any explicit server identity that contradicts that fence.
    const hasServerIdentityConflict = [
      labels['underchat.server_id'],
      env.SERVER_ID,
    ].some((serverId) => serverId !== undefined && serverId !== data.server_id);
    if (hasServerIdentityConflict) {
      return 'server_id';
    }
    if (
      !data.worker_type_id ||
      labels['underchat.worker_type_id'] !== data.worker_type_id ||
      env.WORKER_TYPE_ID !== data.worker_type_id
    ) {
      return 'worker_type_id';
    }
    if (
      (!postgresWarmLineage &&
        labels['underchat.runtime_generation'] !==
          String(expected.runtimeGeneration)) ||
      (!postgresWarmLineage &&
        env.RUNTIME_GENERATION !== String(expected.runtimeGeneration))
    ) {
      return 'runtime_generation';
    }

    const appDataMounts = (inspection.container_mounts ?? []).filter(
      (mount) => mount.destination === '/app/data'
    );
    if (expected.sessionStorage === EWorkerSessionStorage.postgres) {
      if (
        labels['underchat.session_storage'] !==
          EWorkerSessionStorage.postgres ||
        env.WORKER_SESSION_STORAGE !== EWorkerSessionStorage.postgres
      ) {
        return 'session_storage';
      }
      if (
        expected.sessionVolumeName !== null ||
        labels['underchat.session_volume_name'] !== undefined ||
        env.SESSION_VOLUME_NAME !== undefined
      ) {
        return 'session_volume_name';
      }
      if (appDataMounts.length !== 0) {
        return 'session_mount';
      }
    } else {
      if (
        !expected.sessionVolumeName ||
        (labels['underchat.session_storage'] !== undefined &&
          labels['underchat.session_storage'] !==
            EWorkerSessionStorage.legacy_volume) ||
        (env.WORKER_SESSION_STORAGE !== undefined &&
          env.WORKER_SESSION_STORAGE !== EWorkerSessionStorage.legacy_volume)
      ) {
        return 'session_storage';
      }
      if (
        labels['underchat.session_volume_name'] !==
          expected.sessionVolumeName ||
        env.SESSION_VOLUME_NAME !== expected.sessionVolumeName
      ) {
        return 'session_volume_name';
      }
      if (
        appDataMounts.length !== 1 ||
        appDataMounts[0].type !== 'volume' ||
        appDataMounts[0].name !== expected.sessionVolumeName ||
        appDataMounts[0].read_write !== true
      ) {
        return 'session_mount';
      }
    }

    return undefined;
  }

  private assertRuntimeRemovalContainerIdentity(
    data: IWorkerPayload,
    inspection: WorkerContainerInspection,
    expected: RuntimeRemovalIdentity,
    runtime?: IWorkerRuntime | null
  ): void {
    const conflict = this.resolveRuntimeRemovalContainerConflict(
      data,
      inspection,
      expected,
      runtime
    );
    if (conflict) {
      throw new Error(`worker_runtime_removal_container_conflict:${conflict}`);
    }
  }

  private async assertRuntimeRemovalContainerIdentityOrLegacyWarm(
    data: IWorkerPayload,
    inspection: WorkerContainerInspection,
    expected: RuntimeRemovalIdentity,
    worker: IWorkerMonitor | null,
    runtime: IWorkerRuntime | null
  ): Promise<'active_runtime' | 'legacy_assigned_warm'> {
    const conflict = this.resolveRuntimeRemovalContainerConflict(
      data,
      inspection,
      expected,
      runtime
    );
    if (!conflict) {
      this.assertRuntimeRemovalContainerIdentity(
        data,
        inspection,
        expected,
        runtime
      );
      return 'active_runtime';
    }

    if (
      await this.isPostgresProviderHandoffSourceContainerIdentityAuthorized(
        data,
        inspection,
        expected,
        worker,
        runtime
      )
    ) {
      this.logDebug(
        'service.provider_handoff.source_container_removal_authorized',
        {
          trace_id: data.debug_trace_id,
          layer: 'service',
          worker_id: data.worker_id,
          account_id: data.account_id,
          worker_type_id: data.worker_type_id,
          previous_worker_type_id: worker?.worker_type_id,
          lifecycle_operation_id: data.lifecycle_operation_id,
          container_id: expected.containerId,
          runtime_generation: expected.runtimeGeneration,
          reason: `source_identity:${conflict}`,
        }
      );
      return 'active_runtime';
    }

    if (expected.sessionStorage !== EWorkerSessionStorage.legacy_volume) {
      throw new Error(`worker_runtime_removal_container_conflict:${conflict}`);
    }

    const legacyConflict =
      await this.resolveLegacyAssignedWarmRuntimeRemovalConflict(
        data,
        inspection,
        expected,
        worker,
        runtime
      );
    if (legacyConflict) {
      throw new Error(`worker_runtime_removal_container_conflict:${conflict}`);
    }

    this.logDebug(
      'service.worker_runtime.legacy_assigned_warm_replacement_authorized',
      {
        trace_id: data.debug_trace_id,
        layer: 'service',
        worker_id: data.worker_id,
        account_id: data.account_id,
        worker_type_id: data.worker_type_id,
        lifecycle_operation_id: data.lifecycle_operation_id,
        container_id: expected.containerId,
        runtime_generation: expected.runtimeGeneration,
        session_volume_name: expected.sessionVolumeName,
        warm_pool_id: runtime?.warm_pool_id,
      }
    );
    return 'legacy_assigned_warm';
  }

  private async resolveLegacyAssignedWarmRuntimeRemovalConflict(
    data: IWorkerPayload,
    inspection: WorkerContainerInspection,
    expected: RuntimeRemovalIdentity,
    worker: IWorkerMonitor | null,
    runtime: IWorkerRuntime | null
  ): Promise<string | undefined> {
    const warmPoolId = runtime?.warm_pool_id?.trim();
    const recreatesCurrentRuntime =
      data.action === EWorkerAction.recreate &&
      worker?.server_id === data.server_id &&
      worker?.worker_type_id === data.worker_type_id;
    const cleansPreviousProviderRuntime =
      data.action === EWorkerAction.cleanup &&
      data.remove_session === true &&
      data.remove_volume === true &&
      data.previous_worker_type_id === data.worker_type_id &&
      Boolean(worker?.worker_type_id) &&
      (worker?.worker_type_id !== data.worker_type_id ||
        this.isLegacyVolumeToPostgresSourceCleanup(data, worker, expected));
    if (
      (!recreatesCurrentRuntime && !cleansPreviousProviderRuntime) ||
      !data.worker_type_id ||
      !data.lifecycle_operation_id ||
      !worker ||
      worker.deleted_at ||
      worker.worker_id !== data.worker_id ||
      worker.account_id !== data.account_id ||
      !worker.server_id ||
      !worker.worker_type_id ||
      worker.worker_status_id !== EWorkerStatus.recreating ||
      worker.lifecycle_operation_id !== data.lifecycle_operation_id ||
      worker.container_id !== expected.containerId ||
      !runtime ||
      expected.sessionStorage !== EWorkerSessionStorage.legacy_volume ||
      !expected.sessionVolumeName ||
      runtime.worker_id !== data.worker_id ||
      runtime.container_id !== expected.containerId ||
      runtime.container_name !== data.worker_id ||
      runtime.runtime_generation !== expected.runtimeGeneration ||
      runtime.session_volume_name !== expected.sessionVolumeName ||
      !warmPoolId ||
      expected.sessionVolumeName !== `warm-${warmPoolId}`
    ) {
      return 'database_identity';
    }

    const warm =
      await this.workerWarmPoolRepository.viewByIdConsistent(warmPoolId);
    if (
      !warm ||
      warm.state !== EWorkerWarmPoolState.assigned ||
      warm.warm_pool_id !== warmPoolId ||
      warm.server_id !== data.server_id ||
      warm.worker_type_id !== data.worker_type_id ||
      warm.reserved_by_worker_id !== data.worker_id ||
      warm.container_id !== expected.containerId ||
      (warm.container_name !== expected.sessionVolumeName &&
        warm.container_name !== data.worker_id) ||
      warm.session_volume_name !== expected.sessionVolumeName
    ) {
      return 'warm_pool_identity';
    }

    const labels = inspection.container_labels ?? {};
    const env = inspection.container_env ?? {};
    if (
      !inspection.exists ||
      inspection.container_id !== expected.containerId ||
      inspection.container_name !== data.worker_id
    ) {
      return 'container_identity';
    }
    if (
      labels['underchat.warm_standby'] !== 'true' ||
      env.WARM_STANDBY !== 'true' ||
      labels['underchat.warm_pool_id'] !== warmPoolId ||
      env.WARM_POOL_ID !== warmPoolId ||
      labels['underchat.server_id'] !== data.server_id ||
      labels['underchat.worker_type_id'] !== data.worker_type_id ||
      env.WORKER_TYPE_ID !== data.worker_type_id ||
      labels['underchat.session_volume_name'] !== expected.sessionVolumeName ||
      env.SESSION_VOLUME_NAME !== expected.sessionVolumeName
    ) {
      return 'warm_container_identity';
    }
    if (
      labels['underchat.worker_id'] !== undefined ||
      labels['underchat.account_id'] !== undefined ||
      labels['underchat.runtime_generation'] !== undefined ||
      labels['underchat.lifecycle_operation_id'] !== undefined ||
      env.WORKER_ID !== undefined ||
      env.ACCOUNT_ID !== undefined ||
      env.RUNTIME_GENERATION !== undefined
    ) {
      return 'mixed_container_identity';
    }
    if (
      !inspection.container_image ||
      labels['underchat.worker_image'] !== inspection.container_image ||
      env.WORKER_IMAGE !== inspection.container_image ||
      !env.WORKER_GRPC_PORT ||
      labels['underchat.worker_grpc_port'] !== env.WORKER_GRPC_PORT
    ) {
      return 'runtime_identity';
    }

    const appDataMounts = (inspection.container_mounts ?? []).filter(
      (mount) => mount.destination === '/app/data'
    );
    if (
      appDataMounts.length !== 1 ||
      appDataMounts[0].type !== 'volume' ||
      appDataMounts[0].name !== expected.sessionVolumeName ||
      appDataMounts[0].read_write !== true
    ) {
      return 'session_mount';
    }

    return undefined;
  }

  private isPreviousRuntimeCleanupFence(
    data: IWorkerPayload,
    worker: IWorkerMonitor
  ): boolean {
    const sessionStorage = this.sessionStorageFor(data);
    const legacyVolumeToPostgresConversion =
      this.isLegacyVolumeToPostgresSourceCleanup(data, worker);
    const removesLegacySource =
      legacyVolumeToPostgresConversion ||
      sessionStorage === EWorkerSessionStorage.legacy_volume;
    const validCleanupIntent = removesLegacySource
      ? data.remove_session === true && data.remove_volume === true
      : sessionStorage === EWorkerSessionStorage.postgres &&
        data.remove_session !== true &&
        data.remove_volume === false;
    return Boolean(
      data.action === EWorkerAction.cleanup &&
      data.previous_worker_type_id === data.worker_type_id &&
      validCleanupIntent &&
      (legacyVolumeToPostgresConversion ||
        worker.server_id !== data.server_id ||
        worker.worker_type_id !== data.worker_type_id)
    );
  }

  private isReservedRuntimeRemovalLifecycleFence(
    data: IWorkerPayload,
    worker: IWorkerMonitor
  ): boolean {
    const recreatesCurrentRuntime =
      data.action === EWorkerAction.recreate &&
      worker.server_id === data.server_id &&
      worker.worker_type_id === data.worker_type_id;
    const cleansPreviousRuntime = this.isPreviousRuntimeCleanupFence(
      data,
      worker
    );

    return Boolean(
      (recreatesCurrentRuntime || cleansPreviousRuntime) &&
      data.lifecycle_operation_id &&
      data.worker_type_id &&
      WORKER_TYPE_SOURCE_PROVIDER[data.worker_type_id] &&
      !worker.deleted_at &&
      worker.worker_id === data.worker_id &&
      worker.account_id === data.account_id &&
      worker.server_id &&
      worker.worker_type_id &&
      worker.worker_status_id === EWorkerStatus.recreating &&
      worker.lifecycle_operation_id === data.lifecycle_operation_id
    );
  }

  private isReservedRuntimeRemovalFence(
    data: IWorkerPayload,
    worker: IWorkerMonitor,
    runtime: IWorkerRuntime
  ): boolean {
    const expectedSourceProvider = data.worker_type_id
      ? WORKER_TYPE_SOURCE_PROVIDER[data.worker_type_id]
      : undefined;
    const runtimeSourceProvider = runtime.source_provider?.trim().toLowerCase();
    const legacyVolumeToPostgresConversion =
      this.isLegacyVolumeToPostgresSourceCleanup(data, worker);
    const safeStorageMigration = this.isSafeSessionStorageMigration(data);
    const sessionStorage = this.isSafeSessionStorageMigrationRestore(data)
      ? EWorkerSessionStorage.postgres
      : legacyVolumeToPostgresConversion || safeStorageMigration
        ? (data.previous_session_storage ?? EWorkerSessionStorage.legacy_volume)
        : this.sessionStorageFor(data);
    const runtimeSessionStorage =
      runtime.session_storage ?? EWorkerSessionStorage.legacy_volume;
    const validSessionBackend =
      sessionStorage === EWorkerSessionStorage.legacy_volume
        ? runtimeSessionStorage === EWorkerSessionStorage.legacy_volume &&
          Boolean(runtime.session_volume_name?.trim()) &&
          (!safeStorageMigration ||
            runtime.session_volume_name === data.legacy_session_volume_name)
        : sessionStorage === EWorkerSessionStorage.postgres &&
          runtimeSessionStorage === EWorkerSessionStorage.postgres &&
          runtime.session_volume_name === null &&
          /^[0-9a-f]{64}$/u.test(runtime.runtime_capability_hash ?? '') &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
            runtime.session_writer_epoch ?? ''
          );

    return Boolean(
      this.isReservedRuntimeRemovalLifecycleFence(data, worker) &&
      validSessionBackend &&
      runtime.worker_id === data.worker_id &&
      (runtime.container_id === null || runtime.container_id === undefined) &&
      runtime.container_name === data.worker_id &&
      Number.isSafeInteger(runtime.runtime_generation) &&
      runtime.runtime_generation > 0 &&
      // activate_warm owns this crash window and its warm-row lineage. The
      // generic recreate cleanup must never delete an activating target.
      !runtime.warm_pool_id &&
      expectedSourceProvider &&
      (!runtimeSourceProvider ||
        runtimeSourceProvider === expectedSourceProvider)
    );
  }

  private async assertDurableControlContainerAbsent(
    worker: IWorkerMonitor,
    canonicalContainerName: string,
    leaseContext: ILockLeaseContext
  ): Promise<void> {
    const controlContainerId = worker.container_id?.trim().toLowerCase();
    if (!controlContainerId || controlContainerId === canonicalContainerName) {
      return;
    }
    if (!DOCKER_CONTAINER_ID_PATTERN.test(controlContainerId)) {
      throw new Error('worker_runtime_removal_database_fence_changed');
    }

    const controlContainer =
      await this.workerService.inspectContainerWorkerByIdStrict(
        controlContainerId
      );
    leaseContext.assertActive();
    if (controlContainer.exists) {
      throw new Error('worker_runtime_removal_stale_control_still_exists');
    }
  }

  /**
   * Repairs the create -> worker_runtime pointer crash window before removing a
   * runtime. The Docker name alone is never sufficient: every immutable
   * lifecycle, provider, image, generation and session backend identity must
   * agree. Legacy volumes additionally need exactly one matching mount owner.
   */
  private async repairReservedRuntimeRemovalPointer(input: {
    data: IWorkerPayload;
    worker: IWorkerMonitor;
    runtime: IWorkerRuntime;
    inspection: WorkerContainerInspection;
    leaseContext: ILockLeaseContext;
  }): Promise<{ worker: IWorkerMonitor; runtime: IWorkerRuntime }> {
    const { data, worker, runtime, inspection, leaseContext } = input;
    const lifecycleOperationId = data.lifecycle_operation_id;
    const containerId = inspection.container_id?.trim().toLowerCase();
    const cleansPreviousRuntime = this.isPreviousRuntimeCleanupFence(
      data,
      worker
    );
    const claimFunctionAvailable = cleansPreviousRuntime
      ? typeof this.workerRuntimeRepository.claimPreviousRuntimeContainer ===
        'function'
      : typeof this.workerRuntimeRepository.claimReservedRuntimeContainer ===
        'function';
    if (
      !lifecycleOperationId ||
      !data.worker_type_id ||
      !containerId ||
      !this.isReservedRuntimeRemovalFence(data, worker, runtime) ||
      !claimFunctionAvailable
    ) {
      throw new Error('worker_runtime_removal_immutable_identity_missing');
    }

    const resolvedWorker: ResolvedWorkerDataForContainer = {
      accountIdResolved: data.account_id,
      serverId: data.server_id,
      workerTypeId: data.worker_type_id,
      workerStatusId: worker.worker_status_id,
      controlContainerId: worker.container_id,
      runtimeContainerId: null,
      containerId: worker.container_id,
      lifecycleOperationId,
      runtimeGeneration: runtime.runtime_generation,
      warmPoolId: runtime.warm_pool_id,
    };
    const conflict = this.resolveReservedRuntimeContainerRemovalConflict({
      worker: resolvedWorker,
      runtime,
      inspection,
      containerId,
      lifecycleOperationId,
      runtimeGeneration: runtime.runtime_generation,
    });
    if (conflict) {
      throw new Error(
        `worker_runtime_removal_immutable_identity_conflict:${conflict}`
      );
    }
    if (runtime.session_storage === EWorkerSessionStorage.legacy_volume) {
      this.assertLegacyRuntimeSession(runtime);
      const mountedContainerIds =
        await this.workerService.listContainerIdsMountingVolumeStrict(
          runtime.session_volume_name
        );
      leaseContext.assertActive();
      if (
        mountedContainerIds.length !== 1 ||
        mountedContainerIds[0] !== containerId
      ) {
        throw new Error('worker_runtime_removal_volume_owner_changed');
      }
    }

    const claimInput = {
      worker_id: data.worker_id,
      account_id: data.account_id,
      lifecycle_operation_id: lifecycleOperationId,
      expected_worker_status_id: EWorkerStatus.recreating,
      container_id: containerId,
      container_name: data.worker_id,
      session_storage:
        runtime.session_storage ?? EWorkerSessionStorage.legacy_volume,
      session_volume_name: runtime.session_volume_name,
      runtime_generation: runtime.runtime_generation,
      warm_pool_id: runtime.warm_pool_id,
      source_provider: runtime.source_provider,
    };
    const claimed = cleansPreviousRuntime
      ? await this.workerRuntimeRepository.claimPreviousRuntimeContainer({
          ...claimInput,
          current_server_id: worker.server_id,
          current_worker_type_id: worker.worker_type_id,
          previous_server_id: data.server_id,
          previous_worker_type_id: data.worker_type_id,
          remove_session: data.remove_session === true,
          remove_volume: data.remove_volume === true,
        })
      : await this.workerRuntimeRepository.claimReservedRuntimeContainer({
          ...claimInput,
          server_id: worker.server_id,
          worker_type_id: worker.worker_type_id,
        });
    leaseContext.assertActive();

    const [refreshedWorker, refreshedRuntime] = await Promise.all([
      this.viewWorkerForMonitorConsistent(data.worker_id),
      this.workerRuntimeRepository.viewByWorkerIdConsistent(data.worker_id),
    ]);
    leaseContext.assertActive();
    if (
      !refreshedWorker ||
      !refreshedRuntime ||
      !this.isReservedRuntimeRemovalLifecycleFence(data, refreshedWorker) ||
      refreshedWorker.server_id !== worker.server_id ||
      refreshedWorker.worker_type_id !== worker.worker_type_id ||
      refreshedWorker.worker_status_id !== worker.worker_status_id ||
      refreshedWorker.container_id !== worker.container_id ||
      refreshedRuntime.worker_id !== data.worker_id ||
      refreshedRuntime.container_id?.trim().toLowerCase() !== containerId ||
      refreshedRuntime.container_name !== data.worker_id ||
      (refreshedRuntime.session_storage ??
        EWorkerSessionStorage.legacy_volume) !==
        (runtime.session_storage ?? EWorkerSessionStorage.legacy_volume) ||
      refreshedRuntime.session_volume_name !== runtime.session_volume_name ||
      refreshedRuntime.runtime_generation !== runtime.runtime_generation ||
      (refreshedRuntime.warm_pool_id ?? null) !==
        (runtime.warm_pool_id ?? null) ||
      refreshedWorker.runtime_container_id?.trim().toLowerCase() !==
        containerId ||
      refreshedWorker.runtime_generation !== runtime.runtime_generation ||
      refreshedWorker.runtime_session_volume_name !==
        runtime.session_volume_name
    ) {
      throw new Error('worker_runtime_removal_pointer_repair_raced');
    }
    this.logDebug('service.worker_runtime.removal_pointer_repaired', {
      trace_id: data.debug_trace_id,
      layer: 'service',
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id: data.worker_type_id,
      lifecycle_operation_id: lifecycleOperationId,
      container_id: containerId,
      runtime_generation: runtime.runtime_generation,
      session_volume_name: runtime.session_volume_name,
      reason: claimed
        ? 'reserved_runtime_claimed'
        : 'concurrent_runtime_claim_confirmed',
    });

    return { worker: refreshedWorker, runtime: refreshedRuntime };
  }

  /**
   * Completes a reset idempotently when a reserved runtime never acquired a
   * container identity. Existing unmounted volumes are removed only through a
   * double-inspected Docker signature and a fresh lifecycle/runtime DB fence.
   */
  private async compensateAbsentReservedRuntime(input: {
    data: IWorkerPayload;
    removeVolume: boolean;
    worker: IWorkerMonitor;
    runtime: IWorkerRuntime | null;
    leaseContext: ILockLeaseContext;
  }): Promise<boolean | null> {
    const { data, removeVolume, worker, runtime, leaseContext } = input;
    if (!this.isReservedRuntimeRemovalLifecycleFence(data, worker)) {
      return null;
    }
    await this.assertDurableControlContainerAbsent(
      worker,
      data.worker_id,
      leaseContext
    );
    if (!removeVolume) {
      return true;
    }

    const volumeName = runtime?.session_volume_name?.trim() ?? data.worker_id;
    if (runtime && !this.isReservedRuntimeRemovalFence(data, worker, runtime)) {
      return null;
    }
    const volume =
      await this.workerService.inspectVolumeByNameStrict(volumeName);
    leaseContext.assertActive();
    if (!volume.exists) {
      return true;
    }
    if (!runtime) {
      // A surviving legacy volume without a worker_runtime row has no durable
      // identity. Preserve it until an explicit, independently proven repair.
      return null;
    }

    const mountedContainerIds =
      await this.workerService.listContainerIdsMountingVolumeStrict(volumeName);
    leaseContext.assertActive();
    if (mountedContainerIds.length !== 0) {
      throw new Error('worker_runtime_removal_volume_still_mounted');
    }

    const [confirmedWorker, confirmedRuntime, confirmedNamed] =
      await Promise.all([
        this.viewWorkerForMonitorConsistent(data.worker_id),
        this.workerRuntimeRepository.viewByWorkerIdConsistent(data.worker_id),
        this.workerService.inspectContainerWorkerByIdStrict(data.worker_id),
      ]);
    leaseContext.assertActive();
    if (
      !confirmedWorker ||
      !confirmedRuntime ||
      confirmedNamed.exists ||
      confirmedWorker.container_id !== worker.container_id ||
      confirmedWorker.server_id !== worker.server_id ||
      confirmedWorker.worker_type_id !== worker.worker_type_id ||
      !this.isReservedRuntimeRemovalFence(
        data,
        confirmedWorker,
        confirmedRuntime
      ) ||
      confirmedRuntime.session_volume_name !== volumeName ||
      confirmedRuntime.runtime_generation !== runtime.runtime_generation
    ) {
      throw new Error('worker_runtime_removal_database_fence_changed');
    }
    await this.assertDurableControlContainerAbsent(
      confirmedWorker,
      data.worker_id,
      leaseContext
    );
    const removed = await this.workerService.removeWorkerVolumeByProof(
      volumeName,
      volume.signature
    );
    leaseContext.assertActive();
    if (!removed) {
      throw new Error('worker_runtime_removal_volume_failed');
    }
    return true;
  }

  private async removeRuntimeContainerWithLifecycleProof(
    data: IWorkerPayload,
    removeVolume: boolean,
    initialWorker: IWorkerMonitor,
    leaseContext: ILockLeaseContext,
    boundSourceRuntime?: {
      containerId: string;
      runtimeGeneration: number;
      sourceProvider: string;
    }
  ): Promise<boolean> {
    if (!data.lifecycle_operation_id || !this.workerRuntimeRepository) {
      throw new Error('worker_runtime_removal_requires_lifecycle_identity');
    }

    leaseContext.assertActive();
    let runtime = await this.workerRuntimeRepository.viewByWorkerIdConsistent(
      data.worker_id
    );
    leaseContext.assertActive();
    if (
      boundSourceRuntime &&
      (!runtime ||
        runtime.container_id !== boundSourceRuntime.containerId ||
        runtime.runtime_generation !== boundSourceRuntime.runtimeGeneration ||
        runtime.source_provider !== boundSourceRuntime.sourceProvider)
    ) {
      // The target replaced worker_runtime after the source drain ACK. Treat
      // this old cleanup as complete; its immutable source identity no longer
      // exists and must never be rebound to the target container.
      return true;
    }
    let removalWorker = initialWorker;
    let containerId = runtime?.container_id?.trim();
    let sessionStorage =
      runtime?.session_storage ?? EWorkerSessionStorage.legacy_volume;
    let sessionVolumeName = runtime?.session_volume_name?.trim() ?? null;
    let runtimeGeneration = runtime?.runtime_generation;
    const hasValidSessionBackend = (): boolean =>
      sessionStorage === EWorkerSessionStorage.legacy_volume
        ? Boolean(sessionVolumeName)
        : sessionStorage === EWorkerSessionStorage.postgres &&
          sessionVolumeName === null &&
          /^[0-9a-f]{64}$/u.test(runtime?.runtime_capability_hash ?? '') &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
            runtime?.session_writer_epoch ?? ''
          );
    if (
      !runtime ||
      !containerId ||
      !hasValidSessionBackend() ||
      !Number.isSafeInteger(runtimeGeneration) ||
      Number(runtimeGeneration) <= 0
    ) {
      const named = await this.workerService.inspectContainerWorkerByIdStrict(
        data.worker_id
      );
      leaseContext.assertActive();
      if (named.exists) {
        if (!runtime) {
          throw new Error('worker_runtime_removal_immutable_identity_missing');
        }
        const repaired = await this.repairReservedRuntimeRemovalPointer({
          data,
          worker: initialWorker,
          runtime,
          inspection: named,
          leaseContext,
        });
        removalWorker = repaired.worker;
        runtime = repaired.runtime;
        containerId = runtime.container_id?.trim();
        sessionStorage =
          runtime.session_storage ?? EWorkerSessionStorage.legacy_volume;
        sessionVolumeName = runtime.session_volume_name?.trim() ?? null;
        runtimeGeneration = runtime.runtime_generation;
      } else {
        const compensated = await this.compensateAbsentReservedRuntime({
          data,
          removeVolume,
          worker: initialWorker,
          runtime,
          leaseContext,
        });
        if (compensated !== null) {
          return compensated;
        }
      }
      if (
        !runtime ||
        !containerId ||
        !hasValidSessionBackend() ||
        !Number.isSafeInteger(runtimeGeneration) ||
        Number(runtimeGeneration) <= 0
      ) {
        if (
          removeVolume &&
          sessionStorage === EWorkerSessionStorage.legacy_volume
        ) {
          throw new Error('worker_runtime_removal_volume_identity_missing');
        }
        throw new Error('worker_runtime_removal_immutable_identity_missing');
      }
    }

    if (
      !runtime ||
      !containerId ||
      !hasValidSessionBackend() ||
      !Number.isSafeInteger(runtimeGeneration) ||
      Number(runtimeGeneration) <= 0
    ) {
      throw new Error('worker_runtime_removal_immutable_identity_missing');
    }
    if (sessionStorage === EWorkerSessionStorage.postgres && removeVolume) {
      throw new Error('postgres_worker_must_not_remove_session_volume');
    }

    const expected = {
      containerId,
      runtimeGeneration: Number(runtimeGeneration),
      sessionStorage,
      sessionVolumeName,
      workerStatusId: removalWorker.worker_status_id as EWorkerStatus,
    };
    const reconciledWorker = await this.reconcileRuntimePointer({
      data,
      worker: removalWorker,
      runtime,
      expected,
      leaseContext,
    });
    await this.assertRuntimeRemovalDatabaseFence(
      data,
      reconciledWorker,
      runtime,
      expected
    );

    const volumeBefore =
      removeVolume &&
      sessionStorage === EWorkerSessionStorage.legacy_volume &&
      sessionVolumeName
        ? await this.workerService.inspectVolumeByNameStrict(sessionVolumeName)
        : undefined;
    leaseContext.assertActive();
    const inspection =
      await this.workerService.inspectContainerWorkerByIdStrict(containerId);
    leaseContext.assertActive();
    if (inspection.exists) {
      await this.assertRuntimeRemovalContainerIdentityOrLegacyWarm(
        data,
        inspection,
        expected,
        reconciledWorker,
        runtime
      );
      leaseContext.assertActive();
      if (sessionStorage === EWorkerSessionStorage.legacy_volume) {
        if (!sessionVolumeName) {
          throw new Error('worker_runtime_removal_volume_identity_missing');
        }
        const mountedBefore =
          await this.workerService.listContainerIdsMountingVolumeStrict(
            sessionVolumeName
          );
        leaseContext.assertActive();
        if (
          mountedBefore.length !== 1 ||
          mountedBefore[0] !== containerId.toLowerCase()
        ) {
          throw new Error('worker_runtime_removal_volume_owner_changed');
        }
      }

      const [confirmedWorker, confirmedRuntime] = await Promise.all([
        this.viewWorkerForMonitorConsistent(data.worker_id),
        this.workerRuntimeRepository.viewByWorkerIdConsistent(data.worker_id),
      ]);
      leaseContext.assertActive();
      await this.assertRuntimeRemovalDatabaseFence(
        data,
        confirmedWorker,
        confirmedRuntime,
        expected
      );
      const confirmedContainer =
        await this.workerService.inspectContainerWorkerByIdStrict(containerId);
      leaseContext.assertActive();
      await this.assertRuntimeRemovalContainerIdentityOrLegacyWarm(
        data,
        confirmedContainer,
        expected,
        confirmedWorker,
        confirmedRuntime
      );
      leaseContext.assertActive();

      if (sessionStorage === EWorkerSessionStorage.postgres) {
        let gracefulStopSucceeded = false;
        try {
          gracefulStopSucceeded =
            await this.workerService.stopContainerWorkerByIdGracefully(
              containerId
            );
        } catch (error) {
          // A frozen provider must not hold the recreate behind the session
          // TTL. The generation takeover in PostgreSQL fences it after this
          // exact lifecycle/container identity is revalidated below.
          this.logDebug('service.worker_runtime.graceful_stop_failed', {
            trace_id: data.debug_trace_id,
            layer: 'service',
            worker_id: data.worker_id,
            account_id: data.account_id,
            worker_type_id: data.worker_type_id,
            lifecycle_operation_id: data.lifecycle_operation_id,
            container_id: containerId,
            runtime_generation: expected.runtimeGeneration,
            reason: getErrorMessage(error),
          });
        }
        leaseContext.assertActive();

        // Graceful shutdown lets every provider flush and release its lease.
        // Re-read both durable fences and Docker identity before falling back
        // to force removal, because SIGTERM waited outside a DB transaction.
        const [postStopWorker, postStopRuntime] = await Promise.all([
          this.viewWorkerForMonitorConsistent(data.worker_id),
          this.workerRuntimeRepository.viewByWorkerIdConsistent(data.worker_id),
        ]);
        leaseContext.assertActive();
        await this.assertRuntimeRemovalDatabaseFence(
          data,
          postStopWorker,
          postStopRuntime,
          expected
        );
        const postStopContainer =
          await this.workerService.inspectContainerWorkerByIdStrict(
            containerId
          );
        leaseContext.assertActive();
        if (postStopContainer.exists) {
          await this.assertRuntimeRemovalContainerIdentityOrLegacyWarm(
            data,
            postStopContainer,
            expected,
            postStopWorker,
            postStopRuntime
          );
        }
        this.logDebug('service.worker_runtime.graceful_stop_completed', {
          trace_id: data.debug_trace_id,
          layer: 'service',
          worker_id: data.worker_id,
          account_id: data.account_id,
          worker_type_id: data.worker_type_id,
          lifecycle_operation_id: data.lifecycle_operation_id,
          container_id: containerId,
          runtime_generation: expected.runtimeGeneration,
          graceful_stop_succeeded: gracefulStopSucceeded,
          container_still_exists: postStopContainer.exists,
          container_still_running: postStopContainer.running === true,
        });
      }

      const removed =
        await this.workerService.removeContainerWorkerById(containerId);
      leaseContext.assertActive();
      if (!removed) {
        throw new Error('worker_runtime_removal_container_failed');
      }
    }

    if (!removeVolume) {
      return true;
    }

    if (!sessionVolumeName) {
      throw new Error('worker_runtime_removal_volume_identity_missing');
    }

    const [confirmedWorker, confirmedRuntime, mountedAfter] = await Promise.all(
      [
        this.viewWorkerForMonitorConsistent(data.worker_id),
        this.workerRuntimeRepository.viewByWorkerIdConsistent(data.worker_id),
        this.workerService.listContainerIdsMountingVolumeStrict(
          sessionVolumeName
        ),
      ]
    );
    leaseContext.assertActive();
    await this.assertRuntimeRemovalDatabaseFence(
      data,
      confirmedWorker,
      confirmedRuntime,
      expected
    );
    if (mountedAfter.length !== 0) {
      throw new Error('worker_runtime_removal_volume_still_mounted');
    }
    const volumeRemoved = await this.workerService.removeWorkerVolumeByProof(
      sessionVolumeName,
      volumeBefore?.signature
    );
    leaseContext.assertActive();
    if (!volumeRemoved) {
      throw new Error('worker_runtime_removal_volume_failed');
    }
    return true;
  }

  private async removeRuntimeContainer(
    workerId: string,
    removeVolume: boolean,
    options: { cleanup?: boolean; preserveRuntime?: boolean } = {}
  ): Promise<boolean> {
    if (!this.workerRuntimeRepository) {
      return options.cleanup
        ? this.workerService.cleanupContainerWorker(workerId, removeVolume)
        : this.workerService.removeContainerWorker(workerId, removeVolume);
    }

    const runtime = await this.viewWorkerRuntimeConsistent(workerId);
    const volumeName = runtime?.session_volume_name ?? workerId;
    const containerName = runtime?.container_name || workerId;
    const removed = await this.workerService.removeContainerByNameAndVolume(
      containerName,
      volumeName,
      removeVolume
    );

    if (removed && removeVolume && options.preserveRuntime !== true) {
      await this.workerRuntimeRepository.deleteByWorkerId(workerId);
    }

    return removed;
  }

  private async viewWorkerRuntimeConsistent(
    workerId: string
  ): Promise<Awaited<ReturnType<WorkerRuntimeRepository['viewByWorkerId']>>> {
    if (!this.workerRuntimeRepository) {
      return null;
    }

    if (
      typeof this.workerRuntimeRepository.viewByWorkerIdConsistent ===
      'function'
    ) {
      return this.workerRuntimeRepository.viewByWorkerIdConsistent(workerId);
    }

    // Compatibility for isolated tests and rolling instances created before
    // the primary-read method existed.
    return this.workerRuntimeRepository.viewByWorkerId(workerId);
  }

  private async deletePostgresWhatsappSessionWithLifecycleFence(
    data: IWorkerPayload,
    expectedWorkerStatusId: EWorkerStatus.recreating | EWorkerStatus.deleting,
    runtimeFence: WhatsappSessionDeletionRuntimeFence | null
  ): Promise<void> {
    const lifecycleOperationId = data.lifecycle_operation_id?.trim();
    const runtimeGeneration = runtimeFence
      ? this.optionalRuntimeGeneration(runtimeFence.runtime_generation)
      : undefined;
    if (!lifecycleOperationId || (runtimeFence && !runtimeGeneration)) {
      throw new Error('postgres_worker_session_delete_fence_rejected');
    }

    const deleted =
      await this.workerRuntimeRepository?.deletePostgresWhatsappSessionByWorkerId(
        {
          worker_id: data.worker_id,
          account_id: data.account_id,
          lifecycle_operation_id: lifecycleOperationId,
          expected_worker_status_id: expectedWorkerStatusId,
          expected_runtime_generation: runtimeGeneration ?? null,
          expected_container_id: runtimeFence?.container_id ?? null,
          ...(runtimeFence
            ? {
                expected_runtime_session_storage: runtimeFence.session_storage,
                expected_session_volume_name: runtimeFence.session_volume_name,
              }
            : {}),
        }
      );
    if (deleted !== true) {
      throw new Error('postgres_worker_session_delete_fence_rejected');
    }
  }

  private async viewWorkerForMonitorConsistent(
    workerId: string
  ): Promise<Awaited<ReturnType<WorkerService['viewWorkerForMonitor']>>> {
    if (
      typeof this.workerService.viewWorkerForMonitorConsistent !== 'function'
    ) {
      throw new Error(
        'Authoritative worker lifecycle database reader is unavailable'
      );
    }
    return this.workerService.viewWorkerForMonitorConsistent(workerId);
  }

  private incrementRuntimeGeneration(
    runtimeGeneration?: number | null
  ): number {
    const currentGeneration = this.optionalRuntimeGeneration(runtimeGeneration);
    return currentGeneration === undefined ? 1 : currentGeneration + 1;
  }

  private async preparePostgresProviderHandoffSource(
    data: IWorkerPayload,
    leaseContext: ILockLeaseContext
  ): Promise<
    | { status: 'not_handoff' | 'already_replaced' }
    | {
        status: 'remove_source';
        sourceContainerId: string;
        runtimeGeneration: number;
        sourceProvider: string;
      }
  > {
    if (
      this.sessionStorageFor(data) !== EWorkerSessionStorage.postgres ||
      data.remove_session === true ||
      data.remove_volume === true ||
      !data.lifecycle_operation_id ||
      !data.worker_type_id ||
      !this.workerRuntimeRepository ||
      typeof this.workerRuntimeRepository
        .viewWhatsappProviderHandoffLifecycleContext !== 'function'
    ) {
      return { status: 'not_handoff' };
    }

    const context =
      await this.workerRuntimeRepository.viewWhatsappProviderHandoffLifecycleContext(
        {
          worker_id: data.worker_id,
          account_id: data.account_id,
          lifecycle_operation_id: data.lifecycle_operation_id,
        }
      );
    leaseContext.assertActive();
    if (!context) {
      // Missing/empty sessions are switched atomically without a handoff row.
      return { status: 'not_handoff' };
    }
    if (context.state === 'failed') {
      // A failed handoff owns the restored source. It must never be removed by
      // this stale dependency.
      return { status: 'already_replaced' };
    }
    if (context.state === 'activating') {
      // Promotion already CASed worker ownership to the target provider. A
      // retried source cleanup is now stale and must not even inspect, stop or
      // remove the target runtime while activation is still converging.
      return { status: 'already_replaced' };
    }

    const sourceProvider = WORKER_TYPE_SOURCE_PROVIDER[data.worker_type_id];
    if (!sourceProvider || sourceProvider !== context.source_provider) {
      throw new Error('whatsapp_handoff_source_provider_changed');
    }

    const runtime = await this.viewWorkerRuntimeConsistent(data.worker_id);
    leaseContext.assertActive();
    if (
      context.state !== 'requested' &&
      context.state !== 'draining' &&
      runtime?.source_provider !== context.source_provider
    ) {
      // Retry after the target replaced worker_runtime: the durable handoff
      // phase proves source drain already committed. Never stop the target.
      return { status: 'already_replaced' };
    }
    const runtimeGeneration = this.optionalRuntimeGeneration(
      runtime?.runtime_generation
    );
    const sourceContainerId = runtime?.container_id?.trim();
    if (
      !runtime ||
      !runtimeGeneration ||
      runtime.session_storage !== EWorkerSessionStorage.postgres ||
      runtime.session_volume_name !== null ||
      runtime.source_provider !== context.source_provider ||
      !sourceContainerId
    ) {
      if (context.state !== 'requested' && context.state !== 'draining') {
        return { status: 'already_replaced' };
      }
      throw new Error('whatsapp_handoff_source_runtime_changed');
    }

    if (context.state === 'requested' || context.state === 'draining') {
      if (
        typeof this.workerBaileysGrpcClientService.prepareProviderHandoff !==
        'function'
      ) {
        throw new Error('whatsapp_handoff_prepare_rpc_unavailable');
      }
      let response: Awaited<
        ReturnType<WorkerBaileysGrpcClientService['prepareProviderHandoff']>
      > | null = null;
      let sizeBytes: string | undefined;
      let recordCount: string | undefined;
      let localProofInvalid = false;
      try {
        response =
          await this.workerBaileysGrpcClientService.prepareProviderHandoff(
            data.worker_id,
            {
              worker_id: data.worker_id,
              account_id: data.account_id,
              handoff_id: context.handoff_id,
              lifecycle_operation_id: data.lifecycle_operation_id,
              source_provider: context.source_provider,
              target_provider: context.target_provider,
              source_revision_id: context.source_revision_id,
              runtime_generation: runtimeGeneration,
              debug_trace_id: data.debug_trace_id,
            },
            data.worker_type_id
          );
        leaseContext.assertActive();

        sizeBytes = response.checkpoint_size_bytes?.trim();
        recordCount = response.checkpoint_record_count?.trim();
        const checkpointProofMatches = Boolean(
          response.prepared === true &&
          response.consumers_drained === true &&
          response.writes_paused === true &&
          response.checkpoint_persisted === true &&
          response.provider_disconnected === true &&
          response.lease_released === true &&
          response.worker_id === data.worker_id &&
          response.provider === context.source_provider &&
          response.handoff_id === context.handoff_id &&
          response.lifecycle_operation_id === data.lifecycle_operation_id &&
          response.source_revision_id === context.source_revision_id &&
          response.runtime_generation === runtimeGeneration &&
          /^[0-9a-f]{64}$/u.test(response.checkpoint_checksum_sha256 ?? '') &&
          sizeBytes &&
          /^[0-9]+$/u.test(sizeBytes) &&
          recordCount &&
          /^[0-9]+$/u.test(recordCount) &&
          response.prepared_at?.trim() &&
          !response.error?.trim()
        );
        if (!checkpointProofMatches || !sizeBytes || !recordCount) {
          localProofInvalid = true;
          throw new Error(WHATSAPP_HANDOFF_PREPARE_PROOF_INVALID);
        }
      } catch (error) {
        const errorCode = localProofInvalid
          ? WHATSAPP_HANDOFF_PREPARE_PROOF_INVALID
          : resolveWhatsappHandoffPreDrainFailureCode(
              error,
              context.source_provider
            );
        if (
          !errorCode ||
          typeof this.workerRuntimeRepository
            .failWhatsappProviderHandoffBeforeSourceDrain !== 'function'
        ) {
          throw error;
        }

        leaseContext.assertActive();
        let failed = false;
        try {
          failed =
            await this.workerRuntimeRepository.failWhatsappProviderHandoffBeforeSourceDrain(
              {
                worker_id: data.worker_id,
                account_id: data.account_id,
                lifecycle_operation_id: data.lifecycle_operation_id,
                handoff_id: context.handoff_id,
                source_provider: context.source_provider,
                target_provider: context.target_provider,
                source_revision_id: context.source_revision_id,
                target_revision_id: context.target_revision_id,
                runtime_generation: runtimeGeneration,
                source_container_id: sourceContainerId,
                error_code: errorCode,
              }
            );
        } catch (failureError) {
          this.logDebug(
            'service.whatsapp_handoff.source_prepare_failure_cas_failed',
            {
              trace_id: data.debug_trace_id,
              layer: 'service',
              worker_id: data.worker_id,
              account_id: data.account_id,
              lifecycle_operation_id: data.lifecycle_operation_id,
              handoff_id: context.handoff_id,
              source_provider: context.source_provider,
              target_provider: context.target_provider,
              runtime_generation: runtimeGeneration,
              error_code: errorCode,
              cas_reason: getErrorMessage(failureError),
            }
          );
          throw error;
        }
        leaseContext.assertActive();
        if (!failed) throw error;

        this.logDebug(
          'service.whatsapp_handoff.source_prepare_failed_before_drain',
          {
            trace_id: data.debug_trace_id,
            layer: 'service',
            worker_id: data.worker_id,
            account_id: data.account_id,
            lifecycle_operation_id: data.lifecycle_operation_id,
            handoff_id: context.handoff_id,
            source_provider: context.source_provider,
            target_provider: context.target_provider,
            runtime_generation: runtimeGeneration,
            error_code: errorCode,
          }
        );
        return { status: 'already_replaced' };
      }

      if (!response || !sizeBytes || !recordCount) {
        throw new Error(WHATSAPP_HANDOFF_PREPARE_PROOF_INVALID);
      }

      const acknowledged =
        await this.workerRuntimeRepository.acknowledgeWhatsappProviderHandoffSourceDrained(
          {
            worker_id: data.worker_id,
            account_id: data.account_id,
            lifecycle_operation_id: data.lifecycle_operation_id,
            handoff_id: context.handoff_id,
            source_provider: context.source_provider,
            source_revision_id: context.source_revision_id,
            runtime_generation: runtimeGeneration,
            checkpoint_checksum_sha256: response.checkpoint_checksum_sha256,
            checkpoint_size_bytes: sizeBytes,
            checkpoint_record_count: recordCount,
          }
        );
      leaseContext.assertActive();
      if (!acknowledged) {
        throw new Error('whatsapp_handoff_source_drain_not_acknowledged');
      }
    }

    const stopped =
      await this.workerService.stopContainerWorkerByIdGracefully(
        sourceContainerId
      );
    leaseContext.assertActive();
    if (!stopped) {
      throw new Error('whatsapp_handoff_source_graceful_stop_failed');
    }
    return {
      status: 'remove_source',
      sourceContainerId,
      runtimeGeneration,
      sourceProvider: context.source_provider,
    };
  }

  private async cleanupWorker(
    data: IWorkerPayload,
    leaseContext: ILockLeaseContext
  ): Promise<void> {
    this.stopConnectionRequestRetry(data.worker_id);

    if (
      !(await this.isLifecycleOperationCurrent(
        data,
        {
          allowServerMismatch: true,
          allowWorkerTypeMismatch: true,
        },
        true
      ))
    ) {
      return;
    }

    const discardContext =
      data.lifecycle_operation_id &&
      typeof this.workerRuntimeRepository
        .viewWhatsappProviderHandoffDiscardCleanupContext === 'function'
        ? await this.workerRuntimeRepository.viewWhatsappProviderHandoffDiscardCleanupContext(
            {
              worker_id: data.worker_id,
              account_id: data.account_id,
              operation_id: data.lifecycle_operation_id,
            }
          )
        : null;
    leaseContext.assertActive();
    if (discardContext?.cleanup_finalized_at) {
      // The exact source container was removed and the session reset committed
      // in the same fenced transaction that wrote this timestamp. A delayed
      // cleanup delivery may now observe the target runtime/session and must
      // never bind itself to, stop, or remove that replacement.
      return;
    }

    const handoffPreparation = await this.preparePostgresProviderHandoffSource(
      data,
      leaseContext
    );
    if (handoffPreparation.status === 'already_replaced') {
      return;
    }

    // Older proto3 peers could not preserve the presence of an explicit
    // `false` scalar. The authoritative backend is therefore the final
    // safety fence: a PostgreSQL session never has a Docker volume to remove.
    // An explicit `true` still fails closed in the removal proof below.
    const cleanupRemovesVolume =
      data.remove_volume === true ||
      (this.sessionStorageFor(data) === EWorkerSessionStorage.legacy_volume &&
        data.remove_volume !== false);
    if (data.remove_session === true && cleanupRemovesVolume) {
    } else if (data.remove_session === true) {
      const disconnectPayload: StatusConnectionWorkerRequest = {
        worker_id: data.worker_id,
        status: EWorkerStatus.disponible,
        type: EBaileysConnectionType.qrcode,
        remove_session: true,
        debug_trace_id: data.debug_trace_id,
      };

      let workerType: EWorkerType | undefined;
      try {
        workerType = await this.resolveWorkerTypeForConnection(
          data.worker_id,
          data.account_id
        );
      } catch (err) {
        console.error(
          'Failed to resolve worker provider before cleanup disconnect',
          {
            workerId: data.worker_id,
            accountId: data.account_id,
            error: getErrorMessage(err),
          }
        );
      }

      if (workerType) {
        await this.assertLifecycleOperationCurrent(
          data,
          'cleanup provider session disconnect',
          {
            allowServerMismatch: true,
            allowWorkerTypeMismatch: true,
          }
        );

        try {
          await this.workerBaileysGrpcClientService.requestConnection(
            data.worker_id,
            disconnectPayload,
            workerType
          );
        } catch (err) {
          console.error('Failed to request worker disconnect before cleanup', {
            workerId: data.worker_id,
            accountId: data.account_id,
            error: getErrorMessage(err),
          });
        }
      }
    }

    const cleaned = await this.retryOperation(
      async () => {
        await this.assertLifecycleOperationCurrent(
          data,
          'cleanup runtime removal',
          {
            allowServerMismatch: true,
            allowWorkerTypeMismatch: true,
          }
        );
        const current = await this.viewWorkerForMonitorConsistent(
          data.worker_id
        );
        leaseContext.assertActive();
        if (!current) {
          return true;
        }
        return this.removeRuntimeContainerWithLifecycleProof(
          data,
          cleanupRemovesVolume,
          current,
          leaseContext,
          handoffPreparation.status === 'remove_source'
            ? {
                containerId: handoffPreparation.sourceContainerId,
                runtimeGeneration: handoffPreparation.runtimeGeneration,
                sourceProvider: handoffPreparation.sourceProvider,
              }
            : undefined
        );
      },
      (r) => !r
    );

    if (!cleaned) {
      throw new Error('Worker cleanup failed');
    }

    if (discardContext) {
      leaseContext.assertActive();
      const finalized =
        await this.workerRuntimeRepository.finalizeWhatsappProviderHandoffDiscardCleanup(
          {
            worker_id: data.worker_id,
            account_id: data.account_id,
            handoff_id: discardContext.handoff_id,
            operation_id: discardContext.operation_id,
            expected_runtime_generation: discardContext.runtime_generation,
            expected_container_id: discardContext.container_id,
          }
        );
      leaseContext.assertActive();
      if (!finalized) {
        throw new Error('whatsapp_handoff_discard_cleanup_fence_rejected');
      }
    }
  }

  private async deleteWorker(
    data: IWorkerPayload,
    deletionRequest: PermanentWorkerTopicDeletionRequest,
    deletionAuthorization: PermanentWorkerDeletionIntentAuthorization
  ): Promise<PublishResult> {
    const alreadyDeleted = deletionAuthorization.permanently_deleted;
    if (alreadyDeleted) {
      console.warn('Worker not found during delete. Continuing cleanup.', {
        workerId: data.worker_id,
        accountId: data.account_id,
      });
    }

    const inputUpdate: IUpdateWorker = {
      worker_id: data.worker_id,
      // Keep the permanent-deletion fence durable until the row becomes a
      // tombstone. A crash at any later point must be retryable by the same
      // lifecycle operation; changing this to disponible/error would make the
      // authoritative intent check reject its own recovery.
      worker_status_id: EWorkerStatus.deleting,
      number: null,
      container_id: null,
      connection_date: null,
    };

    if (!alreadyDeleted) {
      const updated = await this.retryOperation(
        async () =>
          this.workerService.updateWorkerByIdIfLifecycleMatches(
            data.account_id,
            inputUpdate,
            {
              lifecycle_operation_id: deletionRequest.lifecycle_operation_id,
              server_id: data.server_id,
              worker_status_id: EWorkerStatus.deleting,
            }
          ),
        (r) => !r
      );

      if (!updated) {
        throw new Error('Worker deletion lifecycle changed before cleanup');
      }
    }

    const runtimeBeforeDelete = await this.viewWorkerRuntimeConsistent(
      data.worker_id
    );
    const postgresSession =
      data.session_storage === EWorkerSessionStorage.postgres ||
      runtimeBeforeDelete?.session_storage === EWorkerSessionStorage.postgres;
    let containerRemoved = false;
    try {
      containerRemoved = await this.retryOperation(
        async () =>
          this.removeRuntimeContainer(data.worker_id, !postgresSession),
        (r) => !r
      );
    } catch (err) {
      /*
       * Manager/config deletion soft-deletes the worker before this remote
       * cleanup runs. That must not turn Docker failures into success: the
       * command-resource finalization only runs after this method resolves.
       * For a live deletion intent, retain status=deleting so redelivery can
       * resume idempotently after a Docker outage or process crash.
       */
      throw err;
    }

    if (!containerRemoved) {
      throw new Error('Worker removal failed');
    }

    if (postgresSession) {
      await this.deletePostgresWhatsappSessionWithLifecycleFence(
        {
          ...data,
          lifecycle_operation_id: deletionRequest.lifecycle_operation_id,
        },
        EWorkerStatus.deleting,
        runtimeBeforeDelete
          ? {
              runtime_generation: runtimeBeforeDelete.runtime_generation,
              container_id: runtimeBeforeDelete.container_id ?? null,
              session_storage: EWorkerSessionStorage.postgres,
              session_volume_name: null,
            }
          : null
      );
    }

    if (!alreadyDeleted) {
      const deleted = await this.retryOperation(
        async () =>
          this.workerService.deleteWorkerById(data.account_id, data.worker_id, {
            lifecycleOperationId: deletionRequest.lifecycle_operation_id,
            expectedLifecycleOperationId:
              deletionRequest.lifecycle_operation_id,
          }),
        (r) => !r
      );

      if (!deleted) {
        /*
         * Permanent deletion is a monotonic lifecycle. At this point the
         * runtime has already been removed and the durable revocation/proof
         * remains pending. Never compensate the worker back to `error`: doing
         * so would invalidate the deleting fence and make the finalizer
         * redelivery unable to prove that it may resume.
         */
        throw new Error('Failed to delete worker');
      }
    }

    const dataPublish: IBaileysConnectionState = {
      event_type: 'status',
      code: ECodeMessage.info,
      status: EBaileysConnectionStatus.info,
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id: data.worker_type_id,
      worker_status_id: EWorkerStatus.delete,
      lifecycle_operation_id: deletionRequest.lifecycle_operation_id,
      debug_trace_id: data.debug_trace_id,
      ...(runtimeBeforeDelete?.runtime_generation
        ? { runtime_generation: runtimeBeforeDelete.runtime_generation }
        : data.expected_runtime_generation
          ? { runtime_generation: data.expected_runtime_generation }
          : {}),
    };

    const [result] = await Promise.all([
      this.centrifugoService.publishSubStrict(
        workerCentrifugoQueue(dataPublish.account_id),
        dataPublish
      ),
      this.centrifugoService.publishStrict(
        channelsConfigCentrifugo(),
        dataPublish
      ),
    ]);
    return result;
  }

  private async createWorker(
    data: IWorkerPayload,
    connectionRequest?: StatusConnectionWorkerRequest,
    options: CreateWorkerOptions = {},
    leaseContext?: ILockLeaseContext
  ): Promise<PublishResult> {
    this.logDebug('service.create_worker.start', {
      trace_id: data.debug_trace_id,
      layer: 'service',
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id: data.worker_type_id,
      lifecycle_operation_id: data.lifecycle_operation_id,
    });
    if (!data?.worker_type_id) {
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.action,
        data.server_id,
        data.lifecycle_operation_id
      );
      throw new Error('Worker type ID is required');
    }

    const workerType = data.worker_type_id;
    if (workerType === EWorkerType.whatsapp) {
      this.logDebug('service.create_worker.skip_official', {
        trace_id: data.debug_trace_id,
        layer: 'service',
        worker_id: data.worker_id,
        account_id: data.account_id,
        worker_type_id: workerType,
        lifecycle_operation_id: data.lifecycle_operation_id,
        reason: 'official_whatsapp_has_no_runtime',
      });
      return {} as PublishResult;
    }

    if (!(await this.isLifecycleOperationCurrent(data, {}, true))) {
      this.logDebug('service.create_worker.stale', {
        trace_id: data.debug_trace_id,
        layer: 'service',
        worker_id: data.worker_id,
        account_id: data.account_id,
        worker_type_id: data.worker_type_id,
        lifecycle_operation_id: data.lifecycle_operation_id,
        reason: 'lifecycle_operation_not_current',
      });
      return {} as PublishResult;
    }
    if (
      !data.lifecycle_operation_id &&
      !(await this.isWorkerSnapshotCurrent(
        data.worker_id,
        data.account_id,
        data.server_id,
        workerType
      ))
    ) {
      throw new Error('Worker lifecycle changed before create');
    }

    const createMaxAttempts = 2;
    const resolvedHealthOptions = this.buildNewContainerHealthOptions(
      options.healthOptions
    );

    const inputUpdateCreating: IUpdateWorker = {
      worker_id: data.worker_id,
      worker_status_id: EWorkerStatus.creating,
    };

    const creatingUpdated = await this.updateWorkerWithLifecycleGuard(
      data.account_id,
      inputUpdateCreating,
      data,
      workerType
    );

    if (!creatingUpdated) {
      return {} as PublishResult;
    }

    const dataPublishCreating: IBaileysConnectionState = {
      code: ECodeMessage.info,
      status: EBaileysConnectionStatus.info,
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_status_id: EWorkerStatus.creating,
      debug_trace_id: data.debug_trace_id,
    };

    void this.centrifugoPublish(dataPublishCreating).catch((err) => {
      console.error('Failed to publish worker creating status:', err);
    });

    const imageName = getImageWorker(workerType);
    const runtimeBeforeCreate = await this.viewWorkerRuntimeConsistent(
      data.worker_id
    );
    const runtimeSessionVolumeName = this.optionalNonEmpty(
      runtimeBeforeCreate?.session_volume_name
    );
    const sessionStorage = this.sessionStorageFor(data);
    const adoptedSessionVolumeName =
      sessionStorage === EWorkerSessionStorage.legacy_volume &&
      data.remove_volume !== true &&
      runtimeSessionVolumeName &&
      runtimeSessionVolumeName !== data.worker_id &&
      (await this.workerService.existsVolumeByNameStrict(
        runtimeSessionVolumeName
      ))
        ? runtimeSessionVolumeName
        : undefined;
    const sessionVolumeName =
      sessionStorage === EWorkerSessionStorage.postgres
        ? null
        : (adoptedSessionVolumeName ?? data.worker_id);
    if (!leaseContext) throw new Error('worker_lifecycle_lease_required');
    const adoptedColdRuntime = await this.adoptPersistedColdRuntimeIfPresent({
      data,
      workerType,
      sessionStorage,
      sessionVolumeName,
      expectedWorkerStatus: EWorkerStatus.creating,
      leaseContext,
    });
    const nextRuntimeGeneration =
      adoptedColdRuntime?.status === 'adopted'
        ? adoptedColdRuntime.runtimeGeneration
        : await this.reserveNextWorkerRuntimeGeneration(
            data,
            sessionVolumeName
          );

    const proxy =
      options.proxyOverride === undefined
        ? await this.resolveWorkerProxyConfig(data.worker_id, data.server_id)
        : (options.proxyOverride ?? undefined);

    let containerId: string | undefined;
    let lastError: unknown;

    for (
      let createAttempt = 1;
      createAttempt <= createMaxAttempts;
      createAttempt++
    ) {
      try {
        containerId = await this.runCreateWorkerProvisionAttempt(
          data,
          workerType,
          imageName,
          proxy,
          options.proxyMode,
          resolvedHealthOptions,
          createAttempt,
          nextRuntimeGeneration,
          adoptedSessionVolumeName,
          leaseContext,
          createAttempt === 1 && adoptedColdRuntime?.status === 'adopted'
            ? adoptedColdRuntime.containerId
            : undefined
        );
        this.logDebug('service.create_worker.container_created', {
          trace_id: data.debug_trace_id,
          layer: 'service',
          worker_id: data.worker_id,
          account_id: data.account_id,
          worker_type_id: workerType,
          lifecycle_operation_id: data.lifecycle_operation_id,
          container_id: containerId,
          runtime_generation: nextRuntimeGeneration,
          attempt: createAttempt,
        });
        break;
      } catch (err) {
        lastError = err;
        const reason =
          err instanceof WorkerCreateAttemptError
            ? err.reason
            : 'create_attempt_failed';

        if (this.isStaleCreateAttemptReason(reason)) {
          return {} as PublishResult;
        }

        if (createAttempt < createMaxAttempts) {
          if (!leaseContext) {
            throw new Error('worker_create_retry_lease_required');
          }
          const retryPrepared = await this.prepareCreateWorkerRetry(
            data,
            workerType,
            nextRuntimeGeneration,
            sessionVolumeName,
            err instanceof WorkerCreateAttemptError
              ? err.containerId
              : undefined,
            leaseContext
          );
          if (!retryPrepared) {
            return {} as PublishResult;
          }
          continue;
        }

        await this.updateWorkerErrorStatus(
          data.worker_id,
          data.account_id,
          data.action,
          data.server_id,
          data.lifecycle_operation_id
        );
        throw err;
      }
    }

    if (!containerId) {
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.action,
        data.server_id,
        data.lifecycle_operation_id
      );
      throw lastError instanceof Error
        ? lastError
        : new Error('Failed to create worker container');
    }

    const inputUpdate: IUpdateWorker = {
      worker_id: data.worker_id,
      worker_status_id: EWorkerStatus.disponible,
      container_id: containerId,
      ...(data.lifecycle_operation_id ? { lifecycle_operation_id: null } : {}),
    };

    const updated = await this.updateWorkerWithLifecycleGuardAndLegacyRetry(
      data.account_id,
      inputUpdate,
      data,
      workerType,
      {
        expectedWorkerStatusId: EWorkerStatus.creating,
        expectedRuntimeContainerId: containerId,
        expectedRuntimeGeneration: nextRuntimeGeneration,
      }
    );

    const finalizedAsOnline = updated
      ? false
      : await this.finalizeAlreadyOnlineWorkerLifecycle(
          data.account_id,
          data,
          workerType,
          containerId,
          nextRuntimeGeneration
        );

    if (!updated && !finalizedAsOnline) {
      console.error('Failed to update worker status after create', {
        workerId: data.worker_id,
        accountId: data.account_id,
        containerId,
      });
      await this.removeSupersededContainer(
        containerId,
        data,
        'create_lifecycle_changed'
      );
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.action,
        data.server_id,
        data.lifecycle_operation_id
      );
      throw new Error(
        'Create lifecycle could not be finalized by its active operation'
      );
    }

    await this.workerRuntimeRepository?.upsert({
      worker_id: data.worker_id,
      container_id: containerId,
      container_name: data.worker_id,
      session_storage: sessionStorage,
      session_volume_name: sessionVolumeName,
      runtime_generation: nextRuntimeGeneration,
      activated_at: currentTime(),
    });
    await this.cleanupAssignedWarmPoolReferences(data.worker_id);
    this.logDebug('service.create_worker.available_published', {
      trace_id: data.debug_trace_id,
      layer: 'service',
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id: workerType,
      lifecycle_operation_id: data.lifecycle_operation_id,
      container_id: containerId,
      runtime_generation: nextRuntimeGeneration,
      status: EWorkerStatus.disponible,
    });

    if (!finalizedAsOnline) {
      const dataPublish: IBaileysConnectionState = {
        code: ECodeMessage.info,
        status: EBaileysConnectionStatus.info,
        worker_id: data.worker_id,
        account_id: data.account_id,
        worker_status_id: EWorkerStatus.disponible,
        runtime_generation: nextRuntimeGeneration,
      };

      void this.centrifugoPublish(dataPublish).catch((err) => {
        console.error('Failed to publish worker available status:', err);
      });
    }

    if (
      !finalizedAsOnline &&
      connectionRequest &&
      (workerType === EWorkerType.baileys ||
        workerType === EWorkerType.wwebjs ||
        workerType === EWorkerType.whatsmeow)
    ) {
      const payload: StatusConnectionWorkerRequest = {
        worker_id: data.worker_id,
        status: connectionRequest.status,
        type: connectionRequest.type,
        connection_attempt_id: connectionRequest.connection_attempt_id,
        debug_trace_id: connectionRequest.debug_trace_id ?? data.debug_trace_id,
        runtime_generation: nextRuntimeGeneration,
        warm_pool_id: connectionRequest.warm_pool_id,
        ...(connectionRequest.phone_connection
          ? { phone_connection: connectionRequest.phone_connection }
          : {}),
        ...(connectionRequest.remove_session === true
          ? { remove_session: true }
          : {}),
      };

      this.startConnectionRequestRetry(payload);
    }

    return {} as PublishResult;
  }

  private buildNewContainerHealthOptions(
    overrides: ContainerHealthCheckOptions = {}
  ): ContainerHealthCheckOptions {
    return {
      maxAttempts: 30,
      delayMs: 1000,
      requiredConsecutiveSuccesses: 3,
      failFastAfterFirstSuccessFailures: 3,
      ...overrides,
    };
  }

  /**
   * Keep the terminal HTTP probe diagnosis available before checking the
   * lifecycle fence again. A failed provider-handoff target can trigger its
   * rollback while its health wait is still running; checking only the legacy
   * boolean result afterward used to make that race look like a generic
   * lifecycle change and hid the actual failed probe.
   */
  private async checkRecreatedContainerHealth(input: {
    data: IWorkerPayload;
    workerType: EWorkerType;
    containerId: string;
    stage: 'cold_recreate' | 'adopted_recreate';
  }): Promise<ContainerHealthResult> {
    const health = await this.containerHealthService.checkServiceHealth(
      input.containerId,
      this.buildNewContainerHealthOptions()
    );
    if (health.healthy) {
      return health;
    }

    const statusCode = this.getContainerHealthStatusCode(
      health.health_status_code
    );
    this.logDebug('service.recreate_worker.health_not_ready', {
      trace_id: input.data.debug_trace_id,
      layer: 'service',
      worker_id: input.data.worker_id,
      account_id: input.data.account_id,
      worker_type_id: input.workerType,
      lifecycle_operation_id: input.data.lifecycle_operation_id,
      container_id: input.containerId,
      provider: WORKER_TYPE_SOURCE_PROVIDER[input.workerType],
      stage: input.stage,
      provider_handoff_target:
        input.data.session_storage === EWorkerSessionStorage.postgres &&
        input.data.previous_worker_type_id !== undefined &&
        input.data.previous_worker_type_id !== input.workerType &&
        input.data.remove_session !== true &&
        input.data.remove_volume !== true,
      reason:
        health.health_failure_reason === 'health_flapping_after_success'
          ? 'health_flapping_after_success'
          : 'http_health_not_ready',
      health_probe_state: this.getRecreatedContainerHealthProbeState(health),
      health_error_code: this.getRecreatedContainerHealthErrorCode(health),
      ...(statusCode === undefined ? {} : { http_status_code: statusCode }),
      health_attempt: health.health_attempt,
      health_max_attempts: health.health_max_attempts,
      health_delay_ms: health.health_delay_ms,
      health_duration_ms: health.health_duration_ms,
      consecutive_successes: health.consecutive_successes,
      required_consecutive_successes: health.required_consecutive_successes,
    });
    return health;
  }

  private getContainerHealthStatusCode(value: string): number | undefined {
    const normalized = value.trim();
    return /^\d{3}$/u.test(normalized) ? Number(normalized) : undefined;
  }

  private getRecreatedContainerHealthProbeState(
    health: ContainerHealthResult
  ):
    | 'flapping_after_success'
    | 'insufficient_consecutive_successes'
    | 'not_ready' {
    if (health.health_failure_reason === 'health_flapping_after_success') {
      return 'flapping_after_success';
    }

    return health.health_status_code === '200'
      ? 'insufficient_consecutive_successes'
      : 'not_ready';
  }

  private getRecreatedContainerHealthErrorCode(
    health: ContainerHealthResult
  ):
    | 'connection_refused'
    | 'container_missing'
    | 'http_probe_failed'
    | 'none'
    | 'probe_timeout' {
    const error = health.health_error?.toLowerCase() ?? '';
    if (!error) {
      return 'none';
    }
    if (/no such container|not found/u.test(error)) {
      return 'container_missing';
    }
    if (/connection refused|curl_exit_code=7/u.test(error)) {
      return 'connection_refused';
    }
    if (
      /timeout|curl_exit_code=28|container_health_exec_stream_timeout/u.test(
        error
      )
    ) {
      return 'probe_timeout';
    }
    return 'http_probe_failed';
  }

  private async runCreateWorkerProvisionAttempt(
    data: IWorkerPayload,
    workerType: EWorkerType,
    imageName: ReturnType<typeof getImageWorker>,
    proxy: ResolvedWorkerProxyConfig | undefined,
    proxyMode: 'proxy' | 'direct' | 'direct_fallback' | undefined,
    healthOptions: ContainerHealthCheckOptions,
    createAttempt: number,
    runtimeGeneration: number,
    adoptedSessionVolumeName: string | undefined,
    leaseContext: ILockLeaseContext,
    adoptedContainerId?: string
  ): Promise<string> {
    if (!(await this.isLifecycleOperationCurrent(data))) {
      throw new WorkerCreateAttemptError(
        'Worker lifecycle operation is stale',
        'stale_lifecycle_operation'
      );
    }

    if (
      !data.lifecycle_operation_id &&
      !(await this.isWorkerSnapshotCurrent(
        data.worker_id,
        data.account_id,
        data.server_id,
        workerType
      ))
    ) {
      throw new WorkerCreateAttemptError(
        'Worker snapshot changed',
        'worker_snapshot_changed'
      );
    }

    const containerId =
      adoptedContainerId ??
      (await this.retryOperation(
        async () => {
          const runtimeIdentity =
            await this.preparePostgresRuntimeWriterIdentity(
              data,
              runtimeGeneration
            );
          const metadata = {
            workerTypeId: workerType,
            workerGrpcPort: this.getExpectedWorkerGrpcPort(workerType),
            runtimeGeneration,
            serverId: data.server_id,
            ...(data.lifecycle_operation_id
              ? { lifecycleOperationId: data.lifecycle_operation_id }
              : {}),
            proxyMode: proxyMode ?? (proxy ? 'proxy' : 'direct'),
            ...runtimeIdentity,
          };
          const sessionVolumeName =
            runtimeIdentity.sessionStorage === EWorkerSessionStorage.postgres
              ? null
              : (adoptedSessionVolumeName ?? data.worker_id);
          const beforeStart =
            runtimeIdentity.runtimeCapability && runtimeIdentity.writerEpoch
              ? async (createdContainerId: string): Promise<void> =>
                  this.bindReservedColdRuntimeBeforeStart({
                    data,
                    workerType,
                    expectedWorkerStatus: EWorkerStatus.creating,
                    runtimeGeneration,
                    sessionStorage: runtimeIdentity.sessionStorage,
                    sessionVolumeName,
                    runtimeCapability:
                      runtimeIdentity.runtimeCapability as string,
                    writerEpoch: runtimeIdentity.writerEpoch as string,
                    containerId: createdContainerId,
                    leaseContext,
                  })
              : undefined;

          if (adoptedSessionVolumeName) {
            return this.workerService.createContainerWorker(
              imageName,
              data.worker_id,
              data.account_id,
              false,
              balanceEnvironment.grpcHost,
              balanceEnvironment.grpcPort,
              proxy,
              metadata,
              adoptedSessionVolumeName,
              {
                requireExistingVolume: true,
                requireContainerNameAvailable: true,
                ...(beforeStart ? { beforeStart } : {}),
              }
            );
          }

          return this.workerService.createContainerWorker(
            imageName,
            data.worker_id,
            data.account_id,
            runtimeIdentity.sessionStorage ===
              EWorkerSessionStorage.legacy_volume && createAttempt === 1,
            balanceEnvironment.grpcHost,
            balanceEnvironment.grpcPort,
            proxy,
            metadata,
            undefined,
            {
              requireContainerNameAvailable: true,
              ...(beforeStart ? { beforeStart } : {}),
            }
          );
        },
        (r) => !r
      ));

    if (!containerId) {
      throw new WorkerCreateAttemptError(
        'Failed to create worker container',
        'create_container_failed'
      );
    }

    try {
      await this.workerRuntimeRepository?.upsert({
        worker_id: data.worker_id,
        container_id: containerId,
        container_name: data.worker_id,
        session_storage: this.sessionStorageFor(data),
        session_volume_name:
          this.sessionStorageFor(data) === EWorkerSessionStorage.postgres
            ? null
            : (adoptedSessionVolumeName ?? data.worker_id),
        runtime_generation: runtimeGeneration,
        activated_at: currentTime(),
      });
    } catch (error) {
      if (error instanceof StaleWorkerRuntimeGenerationError) {
        await this.removeSupersededContainer(
          containerId,
          data,
          'stale_runtime_generation'
        );
        throw new WorkerCreateAttemptError(
          error.message,
          'stale_runtime_generation',
          containerId
        );
      }
      throw error;
    }

    let healthResult: ContainerHealthResult;
    try {
      healthResult = await this.containerHealthService.checkServiceHealth(
        containerId,
        healthOptions
      );
    } catch (err) {
      throw new WorkerCreateAttemptError(
        getErrorMessage(err),
        'create_health_failed',
        containerId
      );
    }

    if (!healthResult.healthy) {
      const reason = this.getCreateHealthFailureReason(healthResult);

      throw new WorkerCreateAttemptError(
        'Worker service is not healthy',
        reason,
        containerId,
        healthResult
      );
    }

    if (this.isWorkerGrpcReadinessRequired(workerType)) {
      try {
        await this.waitForWorkerGrpcReady(data.worker_id, workerType);
      } catch (err) {
        throw new WorkerCreateAttemptError(
          getErrorMessage(err),
          'create_grpc_readiness_failed',
          containerId,
          healthResult
        );
      }
    }

    return containerId;
  }

  private getCreateHealthFailureReason(
    healthResult: ContainerHealthResult
  ): string {
    if (
      healthResult.health_failure_reason === 'health_flapping_after_success'
    ) {
      return 'create_health_flapping_after_success';
    }

    return 'create_health_failed';
  }

  private isStaleCreateAttemptReason(reason: string): boolean {
    return (
      reason === 'stale_lifecycle_operation' ||
      reason === 'worker_snapshot_changed' ||
      reason === 'stale_runtime_generation'
    );
  }

  private async prepareCreateWorkerRetry(
    data: IWorkerPayload,
    workerType: EWorkerType,
    runtimeGeneration: number,
    sessionVolumeName: string | null,
    containerId: string | undefined,
    leaseContext: ILockLeaseContext
  ): Promise<boolean> {
    if (!data.lifecycle_operation_id) {
      throw new Error('worker_create_retry_requires_lifecycle_identity');
    }

    leaseContext.assertActive();
    const discovered =
      await this.workerService.inspectContainerWorkerByIdStrict(
        containerId ?? data.worker_id
      );
    leaseContext.assertActive();
    if (!discovered.exists) {
      await this.reserveWorkerRuntimeGeneration(
        data,
        sessionVolumeName,
        runtimeGeneration
      );
      leaseContext.assertActive();
      return true;
    }

    const exactContainerId = discovered.container_id?.trim().toLowerCase();
    if (
      !exactContainerId ||
      (containerId && exactContainerId !== containerId.trim().toLowerCase())
    ) {
      throw new Error('worker_create_retry_container_identity_changed');
    }
    this.assertCreateRetryContainerIdentity(
      data,
      workerType,
      runtimeGeneration,
      sessionVolumeName,
      exactContainerId,
      discovered
    );

    if (
      await this.finalizeAlreadyOnlineWorkerLifecycle(
        data.account_id,
        data,
        workerType,
        exactContainerId,
        runtimeGeneration
      )
    ) {
      leaseContext.assertActive();
      return false;
    }

    const runtime =
      await this.workerRuntimeRepository?.viewByWorkerIdConsistent(
        data.worker_id
      );
    leaseContext.assertActive();
    if (
      !runtime ||
      runtime.worker_id !== data.worker_id ||
      runtime.runtime_generation !== runtimeGeneration ||
      runtime.session_volume_name !== sessionVolumeName ||
      (runtime.container_id !== null &&
        runtime.container_id !== undefined &&
        runtime.container_id !== exactContainerId)
    ) {
      throw new Error('worker_create_retry_runtime_identity_changed');
    }

    const claimed = await this.workerService.updateWorkerByIdIfLifecycleMatches(
      data.account_id,
      {
        worker_id: data.worker_id,
        worker_status_id: EWorkerStatus.error,
      },
      {
        lifecycle_operation_id: data.lifecycle_operation_id,
        server_id: data.server_id,
        worker_type_id: workerType,
        worker_status_id: EWorkerStatus.creating,
        runtime_generation: runtimeGeneration,
        ...(runtime.container_id === exactContainerId
          ? { runtime_container_id: exactContainerId }
          : {}),
      }
    );
    leaseContext.assertActive();
    if (!claimed) {
      if (
        await this.finalizeAlreadyOnlineWorkerLifecycle(
          data.account_id,
          data,
          workerType,
          exactContainerId,
          runtimeGeneration
        )
      ) {
        leaseContext.assertActive();
        return false;
      }
      const current = await this.workerService.viewWorkerForMonitorConsistent(
        data.worker_id
      );
      leaseContext.assertActive();
      if (
        !current ||
        current.lifecycle_operation_id !== data.lifecycle_operation_id ||
        current.server_id !== data.server_id ||
        current.worker_type_id !== workerType
      ) {
        return false;
      }
      throw new Error('worker_create_retry_quarantine_claim_failed');
    }

    const [claimedWorker, claimedRuntime, confirmedContainer] =
      await Promise.all([
        this.workerService.viewWorkerForMonitorConsistent(data.worker_id),
        this.workerRuntimeRepository?.viewByWorkerIdConsistent(data.worker_id),
        this.workerService.inspectContainerWorkerByIdStrict(exactContainerId),
      ]);
    leaseContext.assertActive();
    if (
      !claimedWorker ||
      claimedWorker.deleted_at ||
      claimedWorker.account_id !== data.account_id ||
      claimedWorker.server_id !== data.server_id ||
      claimedWorker.worker_type_id !== workerType ||
      claimedWorker.worker_status_id !== EWorkerStatus.error ||
      claimedWorker.lifecycle_operation_id !== data.lifecycle_operation_id ||
      !claimedRuntime ||
      claimedRuntime.runtime_generation !== runtimeGeneration ||
      claimedRuntime.session_volume_name !== sessionVolumeName ||
      (claimedRuntime.container_id !== null &&
        claimedRuntime.container_id !== undefined &&
        claimedRuntime.container_id !== exactContainerId)
    ) {
      throw new Error('worker_create_retry_quarantine_fence_changed');
    }
    this.assertCreateRetryContainerIdentity(
      data,
      workerType,
      runtimeGeneration,
      sessionVolumeName,
      exactContainerId,
      confirmedContainer
    );

    const removed =
      await this.workerService.removeContainerWorkerById(exactContainerId);
    leaseContext.assertActive();
    if (!removed) {
      throw new Error('worker_create_retry_container_removal_failed');
    }

    await this.reserveWorkerRuntimeGeneration(
      data,
      sessionVolumeName,
      runtimeGeneration
    );
    leaseContext.assertActive();
    const released =
      await this.workerService.updateWorkerByIdIfLifecycleMatches(
        data.account_id,
        {
          worker_id: data.worker_id,
          worker_status_id: EWorkerStatus.creating,
        },
        {
          lifecycle_operation_id: data.lifecycle_operation_id,
          server_id: data.server_id,
          worker_type_id: workerType,
          worker_status_id: EWorkerStatus.error,
          runtime_generation: runtimeGeneration,
        }
      );
    leaseContext.assertActive();
    if (!released) {
      throw new Error('worker_create_retry_quarantine_release_failed');
    }
    return true;
  }

  private assertCreateRetryContainerIdentity(
    data: IWorkerPayload,
    workerType: EWorkerType,
    runtimeGeneration: number,
    sessionVolumeName: string | null,
    containerId: string,
    inspection: WorkerContainerInspection
  ): void {
    const labels = inspection.container_labels ?? {};
    const env = inspection.container_env ?? {};
    const mounts = (inspection.container_mounts ?? []).filter(
      (mount) => mount.destination === '/app/data'
    );
    const sessionStorage = this.sessionStorageFor(data);
    const sessionBackendMismatch =
      labels['underchat.session_storage'] !== sessionStorage ||
      env.WORKER_SESSION_STORAGE !== sessionStorage ||
      (sessionStorage === EWorkerSessionStorage.postgres
        ? labels['underchat.session_volume_name'] !== undefined ||
          env.SESSION_VOLUME_NAME !== undefined ||
          mounts.length !== 0
        : !sessionVolumeName ||
          labels['underchat.session_volume_name'] !== sessionVolumeName ||
          env.SESSION_VOLUME_NAME !== sessionVolumeName ||
          mounts.length !== 1 ||
          mounts[0].type !== 'volume' ||
          mounts[0].name !== sessionVolumeName ||
          mounts[0].read_write !== true);
    const mismatch = !inspection.exists
      ? 'container_missing'
      : inspection.container_id?.trim().toLowerCase() !== containerId
        ? 'container_id'
        : inspection.container_name !== data.worker_id
          ? 'container_name'
          : labels['underchat.worker_id'] !== data.worker_id ||
              env.WORKER_ID !== data.worker_id
            ? 'worker_id'
            : labels['underchat.account_id'] !== data.account_id ||
                env.ACCOUNT_ID !== data.account_id
              ? 'account_id'
              : labels['underchat.server_id'] !== data.server_id
                ? 'server_id'
                : labels['underchat.worker_type_id'] !== workerType ||
                    env.WORKER_TYPE_ID !== workerType
                  ? 'worker_type_id'
                  : labels['underchat.runtime_generation'] !==
                        String(runtimeGeneration) ||
                      env.RUNTIME_GENERATION !== String(runtimeGeneration)
                    ? 'runtime_generation'
                    : sessionBackendMismatch
                      ? 'session_backend'
                      : labels['underchat.lifecycle_operation_id'] !==
                          data.lifecycle_operation_id
                        ? 'lifecycle_operation_id'
                        : undefined;
    if (mismatch) {
      throw new Error(`worker_create_retry_container_conflict:${mismatch}`);
    }
  }

  private readonly sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

  private readonly retryOperation = async <T>(
    operation: () => Promise<T>,
    shouldRetry: (result: T) => boolean
  ): Promise<T> => {
    let lastResult: T | undefined;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const result = await operation();
      lastResult = result;
      if (!shouldRetry(result)) return result;
      if (attempt < this.maxRetries) await this.sleep(this.retryIntervalMs);
    }
    if (lastResult === undefined) {
      throw new Error('Retry operation failed: no result');
    }
    return lastResult;
  };
}
