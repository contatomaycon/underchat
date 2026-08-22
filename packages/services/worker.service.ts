import { injectable, inject } from 'tsyringe';
import Docker from 'dockerode';
import { EWorkerImage } from '@core/common/enums/EWorkerImage';
import { WorkerCreatorRepository } from '@core/repositories/worker/WorkerCreator.repository';
import { ICreateWorker } from '@core/common/interfaces/ICreateWorker';
import { WorkerServerListerRepository } from '@core/repositories/worker/WorkerServerLister.repository';
import { WorkerServerViewerRepository } from '@core/repositories/worker/WorkerServerViewer.repository';
import { WorkerTotalViewerRepository } from '@core/repositories/worker/WorkerTotalViewer.repository';
import { WorkerListerRepository } from '@core/repositories/worker/WorkerLister.repository';
import { ListWorkerRequest } from '@core/schema/worker/listWorker/request.schema';
import { ListWorkerResponse } from '@core/schema/worker/listWorker/response.schema';
import {
  WorkerLifecycleUpdateGuard,
  WorkerUpdaterRepository,
} from '@core/repositories/worker/WorkerUpdater.repository';
import { WorkerViewerRepository } from '@core/repositories/worker/WorkerViewer.repository';
import { ViewWorkerResponse } from '@core/schema/worker/viewWorker/response.schema';
import { WorkerNameAndContainerIdViewerRepository } from '@core/repositories/worker/WorkerNameAndContainerIdViewer.repository';
import { WorkerViewerExistsRepository } from '@core/repositories/worker/WorkerViewerExists.repository';
import { WorkerBalancerViewerRepository } from '@core/repositories/worker/WorkerBalancerViewer.repository';
import {
  WorkerDeleterRepository,
  type WorkerDeletionOptions,
} from '@core/repositories/worker/WorkerDeleter.repository';
import { WorkerPhoneConnectionDateViewerRepository } from '@core/repositories/worker/WorkerPhoneConnectionDateViewer.repository';
import { IViewWorkerPhoneConnectionDate } from '@core/common/interfaces/IViewWorkerPhoneConnectionDate';
import { WorkerPhoneStatusConnectionDateUpdaterRepository } from '@core/repositories/worker/WorkerPhoneStatusConnectionDateUpdater.repository';
import { IUpdateWorkerPhoneStatusConnectionDate } from '@core/common/interfaces/IUpdateWorkerPhoneStatusConnectionDate';
import { WorkerPhoneConnectionViewerRepository } from '@core/repositories/worker/WorkerPhoneConnectionViewer.repository';
import { IViewWorkerPhoneConnection } from '@core/common/interfaces/IViewWorkerPhoneConnection';
import { WorkerPhoneConnectionUpdaterRepository } from '@core/repositories/worker/WorkerPhoneConnectionUpdater.repository';
import { IUpdateWorkerPhoneConnection } from '@core/common/interfaces/IUpdateWorkerPhoneConnection';
import { WorkerPhoneConnectionCreatorRepository } from '@core/repositories/worker/WorkerPhoneConnectionCreator.repository';
import { ICreateWorkerPhoneConnection } from '@core/common/interfaces/ICreateWorkerPhoneConnection';
import { WorkerTypeViewerRepository } from '@core/repositories/worker/WorkerTypeViewer.repository';
import { IViewWorkerType } from '@core/common/interfaces/IViewWorkerType';
import { IUpdateWorker } from '@core/common/interfaces/IUpdateWorker';
import { IListWorkerServer } from '@core/common/interfaces/IListWorkerServer';
import {
  IViewWorkerLifecycleServer,
  IViewWorkerServer,
} from '@core/common/interfaces/IViewWorkerServer';
import { WorkerBaileysActivitiesListerRepository } from '@core/repositories/worker/WorkerBaileysActivitiesLister.repository';
import { IListWorkerActivities } from '@core/common/interfaces/IListWorkerActivities';
import { WorkerStatusUpdaterRepository } from '@core/repositories/worker/WorkerStatusUpdater.repository';
import { WorkerNewStatusListerRepository } from '@core/repositories/worker/WorkerNewStatusLister.repository';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { IViewWorkerNameAndContainerId } from '@core/common/interfaces/IViewWorkerNameAndContainerId';
import { WorkerNameAndIdViewerRepository } from '@core/repositories/worker/WorkerNameAndIdViewer.repository';
import { IViewWorkerNameAndId } from '@core/common/interfaces/IViewWorkerNameAndId';
import { WorkerConfigFieldsViewerRepository } from '@core/repositories/worker/WorkerConfigFieldsViewer.repository';
import { IWorkerConfigFields } from '@core/common/interfaces/IWorkerConfigFields';
import { WorkerAllListerRepository } from '@core/repositories/worker/WorkerAllLister.repository';
import { WorkerMonitorViewerRepository } from '@core/repositories/worker/WorkerMonitorViewer.repository';
import { IWorkerMonitor } from '@core/common/interfaces/IWorkerMonitor';
import { TransferWorker } from '@core/schema/chat/listTransferOptions/response.schema';
import { WorkerUpdatedAtUpdaterRepository } from '@core/repositories/worker/WorkerUpdatedAtUpdater.repository';
import { WorkerLastConnectionCheckUpdaterRepository } from '@core/repositories/worker/WorkerLastConnectionCheckUpdater.repository';
import Redis from 'ioredis';
import { EProxyProtocol } from '@core/common/enums/EProxyProtocol';
import { APP_TIMEZONE } from '@core/common/constants/timezone';
import { WhatsappRuntimeFenceService } from '@core/services/whatsappRuntimeFence.service';
import { BALANCER_RUNTIME_FENCE_TOKEN_ENV } from '@core/common/functions/balancerRuntimeFenceAuth';
import { balanceRuntimeFenceToken } from '@core/common/functions/balanceRuntimeFenceCredential';
import {
  buildWorkerContainerDatabaseUrl,
  isInheritedWorkerEnvironmentKeyAllowed,
  WORKER_OVERRIDE_ENV_KEYS,
} from '@core/common/functions/workerContainerEnvironmentPolicy';
import { workerProxyFingerprint } from '@core/common/functions/workerProxyFingerprint';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import {
  IChromiumLockCleanupAuthorizationRequestProto,
  IChromiumLockCleanupAuthorizationResponseProto,
} from '@core/common/interfaces/IChromiumLockCleanupAuthorizationProto';
import { WorkerRuntimeRepository } from '@core/repositories/worker/WorkerRuntime.repository';
import {
  balanceEnvironment,
  databaseEnvironment,
} from '@core/config/environments';
import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { EAppEnvironment } from '@core/common/enums/EAppEnvironment';
import { WORKER_LIVENESS_LOCAL_DOCKER_READ_TIMEOUT_MS } from '@core/common/functions/workerContainerLivenessPolicy';
import { WorkerImageProvisionerService } from '@core/services/workerImageProvisioner.service';
import { resolveWorkerContainerResourcePolicy } from '@core/common/functions/workerContainerResourcePolicy';
import { NODE_WORKER_CONTAINER_STOP_TIMEOUT_SECONDS } from '@core/common/functions/nodeWorkerGracefulShutdown';
import { runWithWorkerContainerAdmission } from '@core/common/functions/workerContainerAdmission';
import {
  getWwebjsRuntimeSafetyReasons,
  type WwebjsRuntimeSafetyReason,
} from '@core/common/functions/wwebjsRuntimeSafety';

export interface WorkerContainerInspection {
  exists: boolean;
  container_id?: string;
  container_name?: string;
  container_image?: string;
  container_image_reference?: string;
  container_image_id?: string;
  container_state?: string;
  container_status?: string;
  container_started_at?: string;
  container_finished_at?: string;
  container_restart_count?: number;
  container_exit_code?: number;
  container_health_status?: string;
  container_health_failing_streak?: number;
  container_health_log?: string;
  container_paused?: boolean;
  container_labels?: Record<string, string>;
  container_env?: Record<string, string>;
  container_mounts?: WorkerContainerMountInspection[];
  container_entrypoint?: string[];
  container_pids_limit?: number | null;
  running?: boolean;
  error?: string;
}

export interface WorkerContainerMountInspection {
  destination?: string;
  name?: string;
  read_write?: boolean;
  type?: string;
}

export interface WorkerVolumeInspection {
  exists: boolean;
  name: string;
  signature?: string;
}

export interface WorkerContainerMetadata {
  workerTypeId?: string;
  workerGrpcPort?: number;
  runtimeGeneration?: number;
  lifecycleOperationId?: string;
  warmPoolId?: string;
  serverId?: string;
  proxyFingerprint?: string;
  proxyMode?: 'proxy' | 'direct' | 'direct_fallback';
  sessionStorage?: EWorkerSessionStorage;
  runtimeCapability?: string;
  writerEpoch?: string;
  sessionStorageMigrationId?: string;
  legacySessionVolumeName?: string;
  legacySessionChecksum?: string;
}

export interface WorkerRuntimeWriterIdentity {
  runtimeCapability: string;
  writerEpoch: string;
}

export interface WorkerContainerCreateOptions {
  requireExistingVolume?: boolean;
  requireContainerNameAvailable?: boolean;
  imageContentId?: string;
  /**
   * Persists the immutable Docker identity while the container is still
   * stopped. Managed WhatsApp runtimes use this hook to close the
   * create/start -> worker_runtime pointer race.
   */
  beforeStart?: (containerId: string) => Promise<void>;
}

export interface ActiveWorkerImageDrift {
  readonly account_id: string;
  readonly alias: EWorkerImage;
  readonly container_id: string;
  readonly current_content_id: string;
  readonly expected_content_id: string;
  readonly runtime_generation: number;
  readonly server_id: string;
  readonly worker_id: string;
}

export interface ActiveWwebjsRuntimeSafetyDrift extends ActiveWorkerImageDrift {
  readonly safety_reasons: readonly WwebjsRuntimeSafetyReason[];
}

export interface WorkerLivenessRemovalFence {
  containerId: string;
  startedAt: string;
  restartCount: number;
  healthStatus: string;
  paused: boolean;
  workerId: string;
  accountId: string;
  serverId: string;
  workerTypeId: string;
  runtimeGeneration: number;
  forceRemove?: boolean;
  /**
   * Exact durable recreate-retirement operation proven by the manager after
   * revoking runtime/session authority. This is the only authorization that
   * allows the host fence to remove a Docker-healthy process.
   */
  retiredLifecycleOperationId?: string;
  warmPoolId?: string;
  sessionStorage?: EWorkerSessionStorage;
}

export interface WorkerLivenessConditionalRemoveResult {
  status: 'removed' | 'recovered' | 'pending' | 'stale';
  reason: string;
  observedRestartCount?: number;
}

type ChromiumLockCleanupDecisionReason =
  | 'authorized'
  | 'control_plane_unavailable'
  | 'docker_snapshot_changed'
  | 'docker_unavailable'
  | 'invalid_request'
  | 'lock_owner_ambiguous'
  | 'lock_owner_present'
  | 'requester_identity_mismatch'
  | 'requester_mount_invalid'
  | 'requester_not_found'
  | 'requester_not_running'
  | 'runtime_identity_mismatch'
  | 'volume_shared';

interface ValidChromiumLockCleanupAuthorizationRequest {
  requestId: string;
  workerId: string;
  accountId: string;
  workerTypeId: EWorkerType.wwebjs;
  runtimeGeneration: number;
  requesterContainerId: string;
  sessionVolumeName: string;
  singletonLockTarget: string;
  ownerContainerId: string;
}

interface ChromiumLockCleanupDockerSnapshot {
  requesterSignature: string;
  volumeMountContainerIds: string[];
}

interface ChromiumLockCleanupControlPlaneSnapshot {
  containerId: string;
  lifecycleOperationId?: string;
  runtimePointerMode: 'steady' | 'transition';
  serverId: string;
  signature: string;
  warmPoolId?: string;
}

interface DockerContainerLookup {
  exists: boolean;
  info?: Docker.ContainerInspectInfo;
}

interface ChromiumLockCleanupSnapshotResult {
  denialReason?: ChromiumLockCleanupDecisionReason;
  snapshot?: ChromiumLockCleanupDockerSnapshot;
}

const CHROMIUM_LOCK_DOCKER_TIMEOUT_MS = 2_000;
const CHROMIUM_LOCK_AUTHORIZATION_WINDOW_MS = 1_500;
const CONTAINER_ID_PATTERN = /^[a-f0-9]{12,64}$/u;
const FULL_CONTAINER_ID_PATTERN = /^[a-f0-9]{64}$/u;
const CANONICAL_DOCKER_IMAGE_ID_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const WORKER_DOCKER_API_TIMEOUT_MS = 10_000;
const WORKER_LIVENESS_REMOVE_TIMEOUT_MS = 60_000;
const execFileAsync = promisify(execFile);
const RESOURCE_MANAGED_WORKER_IMAGES = new Set<EWorkerImage>([
  EWorkerImage.baileys,
  EWorkerImage.wwebjs,
  EWorkerImage.whatsmeow,
]);
const REQUEST_ID_PATTERN =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
const UUID_PATTERN =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
const VOLUME_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/u;
const SINGLETON_LOCK_TARGET_PATTERN = /^([a-f0-9]{12,64})-([1-9][0-9]{0,9})$/u;
function confirmedDockerContainerNotFound(error: unknown): boolean {
  const statusCode = dockerErrorStatusCode(error);
  return statusCode === 404;
}

function isAmbiguousDockerContainerError(error: unknown): boolean {
  const message = dockerErrorMessage(error).toLowerCase();
  return (
    message.includes('ambiguous') ||
    message.includes('multiple containers') ||
    message.includes('multiple matches')
  );
}

async function withChromiumLockOperationTimeout<T>(
  operation: Promise<T>
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error('chromium_lock_cleanup_docker_timeout'));
    }, CHROMIUM_LOCK_DOCKER_TIMEOUT_MS);
    timeout.unref();
  });

  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function withStrictDockerInspectTimeout<T>(
  operation: Promise<T>
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error('worker_docker_strict_inspect_timeout'));
    }, WORKER_LIVENESS_LOCAL_DOCKER_READ_TIMEOUT_MS);
    timeout.unref?.();
  });

  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function validateChromiumLockCleanupRequest(
  input: IChromiumLockCleanupAuthorizationRequestProto
): ValidChromiumLockCleanupAuthorizationRequest | undefined {
  const requestId = input.request_id?.trim() ?? '';
  const workerId = input.worker_id?.trim() ?? '';
  const accountId = input.account_id?.trim() ?? '';
  const workerTypeId = input.worker_type_id?.trim() ?? '';
  const requesterContainerId =
    input.requester_container_id?.trim().toLowerCase() ?? '';
  const sessionVolumeName = input.session_volume_name?.trim() ?? '';
  const singletonLockTarget =
    input.singleton_lock_target?.trim().toLowerCase() ?? '';
  const runtimeGeneration = Number(input.runtime_generation);
  const lockTargetMatch =
    SINGLETON_LOCK_TARGET_PATTERN.exec(singletonLockTarget);
  const ownerPid = Number(lockTargetMatch?.[2]);

  if (
    !REQUEST_ID_PATTERN.test(requestId) ||
    !UUID_PATTERN.test(workerId) ||
    !UUID_PATTERN.test(accountId) ||
    workerTypeId !== EWorkerType.wwebjs ||
    !Number.isSafeInteger(runtimeGeneration) ||
    runtimeGeneration <= 0 ||
    runtimeGeneration > 2_147_483_647 ||
    !CONTAINER_ID_PATTERN.test(requesterContainerId) ||
    !VOLUME_NAME_PATTERN.test(sessionVolumeName) ||
    !lockTargetMatch ||
    !Number.isSafeInteger(ownerPid) ||
    ownerPid <= 0
  ) {
    return undefined;
  }

  return {
    requestId,
    workerId,
    accountId,
    workerTypeId: EWorkerType.wwebjs,
    runtimeGeneration,
    requesterContainerId,
    sessionVolumeName,
    singletonLockTarget,
    ownerContainerId: lockTargetMatch[1],
  };
}

function chromiumLockCleanupResponse(
  request:
    | IChromiumLockCleanupAuthorizationRequestProto
    | ValidChromiumLockCleanupAuthorizationRequest,
  reason: ChromiumLockCleanupDecisionReason,
  expiresAtUnixMs: number = 0
): IChromiumLockCleanupAuthorizationResponseProto {
  const validated =
    'requestId' in request
      ? request
      : validateChromiumLockCleanupRequest(request);

  return {
    authorized: reason === 'authorized',
    reason,
    request_id: validated?.requestId ?? '',
    requester_container_id: validated?.requesterContainerId ?? '',
    owner_container_id: validated?.ownerContainerId ?? '',
    session_volume_name: validated?.sessionVolumeName ?? '',
    singleton_lock_target: validated?.singletonLockTarget ?? '',
    expires_at_unix_ms: expiresAtUnixMs,
  };
}

function dockerErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function dockerErrorStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const candidate = error as {
    statusCode?: unknown;
    status?: unknown;
    code?: unknown;
  };
  const value = candidate.statusCode ?? candidate.status ?? candidate.code;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function isIdempotentDockerRemoveError(error: unknown): boolean {
  const statusCode = dockerErrorStatusCode(error);
  const message = dockerErrorMessage(error).toLowerCase();

  if (statusCode !== undefined) {
    return statusCode === 404;
  }

  return (
    message.includes('no such container') || message.includes('no such volume')
  );
}

function isIdempotentDockerStopError(error: unknown): boolean {
  const statusCode = dockerErrorStatusCode(error);
  const message = dockerErrorMessage(error).toLowerCase();
  return (
    statusCode === 304 ||
    statusCode === 404 ||
    message.includes('already stopped') ||
    message.includes('is not running') ||
    message.includes('no such container')
  );
}

function isDockerNotFoundError(error: unknown): boolean {
  const statusCode = dockerErrorStatusCode(error);
  const message = dockerErrorMessage(error).toLowerCase();

  return (
    statusCode === 404 ||
    message.includes('no such volume') ||
    message.includes('no such container') ||
    message.includes('not found')
  );
}

function resolveWorkerDatabaseUrlFromDiscreteConfiguration():
  string | undefined {
  try {
    const workerUser = databaseEnvironment.workerDbUser;
    const workerPassword = databaseEnvironment.workerDbPassword;
    if (
      workerUser === databaseEnvironment.dbUser ||
      workerPassword === databaseEnvironment.dbPassword
    ) {
      throw new InvalidConfigurationError(
        'WORKER_DB credentials must differ from DB credentials.'
      );
    }
    return buildWorkerContainerDatabaseUrl({
      host: databaseEnvironment.dbHostRw,
      port: databaseEnvironment.dbPortRw,
      user: workerUser,
      password: workerPassword,
      database: databaseEnvironment.dbDatabase,
      sslMode: databaseEnvironment.dbSslMode,
    });
  } catch (error) {
    if (error instanceof InvalidConfigurationError) {
      return undefined;
    }
    throw error;
  }
}

function isWhatsappWorkerType(workerTypeId: string | undefined): boolean {
  return (
    workerTypeId === EWorkerType.baileys ||
    workerTypeId === EWorkerType.wwebjs ||
    workerTypeId === EWorkerType.whatsmeow
  );
}

const STRICT_BOOLEAN_WORKER_ENVIRONMENT_KEYS = new Set([
  'CONNECTION_LIFECYCLE_DEBUG_ENABLED',
  'NATS_TLS',
  'WHATSAPP_SESSION_DEBUG_ENABLED',
]);

interface NormalizedWorkerEnvironmentValue {
  readonly value: string;
  readonly discardedEnvironmentKey?: string;
}

function normalizeWorkerEnvironmentValue(
  key: string,
  value: string,
  options: { recoverConcatenatedBoolean: boolean }
): NormalizedWorkerEnvironmentValue {
  if (/\u0000|\r|\n/u.test(value)) {
    throw new Error(`worker_container_env_value_invalid:${key}`);
  }

  if (!STRICT_BOOLEAN_WORKER_ENVIRONMENT_KEYS.has(key)) {
    return { value };
  }

  const candidate = value.trim();
  const normalized = candidate.toLowerCase();
  if (normalized === 'true' || normalized === 'false') {
    return { value: normalized };
  }

  if (options.recoverConcatenatedBoolean) {
    for (const booleanPrefix of ['true', 'false'] as const) {
      if (!normalized.startsWith(booleanPrefix)) {
        continue;
      }

      const discardedSuffix = candidate.slice(booleanPrefix.length);
      const assignment = /^([A-Z][A-Z0-9_]*)=/u.exec(discardedSuffix);
      if (assignment) {
        return {
          value: booleanPrefix,
          discardedEnvironmentKey: assignment[1],
        };
      }
    }
  }

  throw new Error(`worker_container_env_value_invalid:${key}`);
}

function normalizeWorkerNatsURLList(value: string, key: string): string {
  const servers = Array.from(
    new Set(
      value
        .split(',')
        .map((server) => server.trim())
        .filter(Boolean)
    )
  );
  if (servers.length === 0) {
    throw new Error(`worker_container_env_value_invalid:${key}`);
  }
  return servers.join(',');
}

@injectable()
export class WorkerService {
  private readonly docker: Docker;
  private readonly inspectedEnvKeys = new Set<string>([
    'WORKER_ID',
    'ACCOUNT_ID',
    'WORKER_TYPE_ID',
    'WORKER_IMAGE',
    'WORKER_GRPC_PORT',
    'RUNTIME_GENERATION',
    'BALANCER_GRPC_HOST',
    'BALANCER_GRPC_PORT',
    'CONNECTION_LIFECYCLE_DEBUG_ENABLED',
    'WHATSAPP_SESSION_DEBUG_ENABLED',
    'CONNECTION_QR_FIRST_QR_TIMEOUT_MS',
    'CONNECTION_QR_RENEWAL_TIMEOUT_MS',
    'CONNECTION_QRCODE_WWEBJS_LOCAL_REQUEST_TIMEOUT_MS',
    'WORKER_DAILY_MAINTENANCE_HOUR',
    'WORKER_DAILY_MAINTENANCE_TIME',
    'WORKER_DAILY_MAINTENANCE_ENABLED',
    'WWEBJS_USER_AGENT',
    'WWEBJS_CLIENT_DESTROY_TIMEOUT_MS',
    'WWEBJS_PENDING_TEARDOWN_TIMEOUT_MS',
    'PROXY_PROTOCOL',
    'PROXY_HOST',
    'PROXY_PORT',
    'WARM_STANDBY',
    'WARM_POOL_ID',
    'SESSION_VOLUME_NAME',
    'WORKER_SESSION_STORAGE',
    'SESSION_STORAGE_MIGRATION_ID',
    'LEGACY_SESSION_VOLUME_NAME',
    'LEGACY_SESSION_CHECKSUM_SHA256',
    'TZ',
    'PGTZ',
  ]);
  private readonly inspectedLabelKeys = new Set<string>([
    'underchat.worker_id',
    'underchat.account_id',
    'underchat.worker_type_id',
    'underchat.worker_image',
    'underchat.worker_image_content_id',
    'underchat.worker_grpc_port',
    'underchat.runtime_generation',
    'underchat.lifecycle_operation_id',
    'underchat.proxy_mode',
    'underchat.proxy_fingerprint',
    'underchat.warm_standby',
    'underchat.warm_pool_id',
    'underchat.server_id',
    'underchat.session_volume_name',
    'underchat.session_storage',
    'underchat.session_storage_migration_id',
    'underchat.legacy_session_volume_name',
    'underchat.legacy_session_checksum_sha256',
    'underchat.resource_policy',
    'underchat.resource_profile',
    'underchat.resource_memory_bytes',
    'underchat.resource_memory_reservation_bytes',
    'underchat.resource_memory_swap_bytes',
    'underchat.resource_nano_cpus',
    'underchat.resource_oom_kill_disable',
    'underchat.resource_oom_score_adj',
    'underchat.resource_pids_limit',
  ]);

  constructor(
    @inject(WorkerCreatorRepository)
    private readonly workerCreatorRepository: WorkerCreatorRepository,
    @inject(WorkerServerListerRepository)
    private readonly workerServerListerRepository: WorkerServerListerRepository,
    @inject(WorkerServerViewerRepository)
    private readonly workerServerViewerRepository: WorkerServerViewerRepository,
    @inject(WorkerTotalViewerRepository)
    private readonly workerTotalViewerRepository: WorkerTotalViewerRepository,
    @inject(WorkerListerRepository)
    private readonly workerListerRepository: WorkerListerRepository,
    @inject(WorkerUpdaterRepository)
    private readonly workerUpdaterRepository: WorkerUpdaterRepository,
    @inject(WorkerViewerRepository)
    private readonly workerViewerRepository: WorkerViewerRepository,
    @inject(WorkerNameAndContainerIdViewerRepository)
    private readonly workerNameAndContainerIdViewerRepository: WorkerNameAndContainerIdViewerRepository,
    @inject(WorkerViewerExistsRepository)
    private readonly workerViewerExistsRepository: WorkerViewerExistsRepository,
    @inject(WorkerBalancerViewerRepository)
    private readonly workerBalancerViewerRepository: WorkerBalancerViewerRepository,
    @inject(WorkerDeleterRepository)
    private readonly workerDeleterRepository: WorkerDeleterRepository,
    @inject(WorkerPhoneConnectionDateViewerRepository)
    private readonly workerPhoneConnectionDateViewerRepository: WorkerPhoneConnectionDateViewerRepository,
    @inject(WorkerPhoneStatusConnectionDateUpdaterRepository)
    private readonly workerPhoneStatusConnectionDateUpdaterRepository: WorkerPhoneStatusConnectionDateUpdaterRepository,
    @inject(WorkerPhoneConnectionViewerRepository)
    private readonly workerPhoneConnectionViewerRepository: WorkerPhoneConnectionViewerRepository,
    @inject(WorkerPhoneConnectionUpdaterRepository)
    private readonly workerPhoneConnectionUpdaterRepository: WorkerPhoneConnectionUpdaterRepository,
    @inject(WorkerPhoneConnectionCreatorRepository)
    private readonly workerPhoneConnectionCreatorRepository: WorkerPhoneConnectionCreatorRepository,
    @inject(WorkerTypeViewerRepository)
    private readonly workerTypeViewerRepository: WorkerTypeViewerRepository,
    @inject(WorkerBaileysActivitiesListerRepository)
    private readonly workerBaileysActivitiesListerRepository: WorkerBaileysActivitiesListerRepository,
    @inject(WorkerNewStatusListerRepository)
    private readonly workerNewStatusListerRepository: WorkerNewStatusListerRepository,
    @inject(WorkerStatusUpdaterRepository)
    private readonly workerStatusUpdaterRepository: WorkerStatusUpdaterRepository,
    @inject(WorkerNameAndIdViewerRepository)
    private readonly workerNameAndIdViewerRepository: WorkerNameAndIdViewerRepository,
    @inject(WorkerConfigFieldsViewerRepository)
    private readonly workerConfigFieldsViewerRepository: WorkerConfigFieldsViewerRepository,
    @inject(WorkerAllListerRepository)
    private readonly workerAllListerRepository: WorkerAllListerRepository,
    @inject(WorkerMonitorViewerRepository)
    private readonly workerMonitorViewerRepository: WorkerMonitorViewerRepository,
    @inject(WorkerUpdatedAtUpdaterRepository)
    private readonly workerUpdatedAtUpdaterRepository: WorkerUpdatedAtUpdaterRepository,
    @inject(WorkerLastConnectionCheckUpdaterRepository)
    private readonly workerLastConnectionCheckUpdaterRepository: WorkerLastConnectionCheckUpdaterRepository,
    @inject('Redis') private readonly redis: Redis,
    @inject(WorkerImageProvisionerService)
    private readonly workerImageProvisionerService: WorkerImageProvisionerService,
    @inject(WorkerRuntimeRepository)
    private readonly workerRuntimeRepository: WorkerRuntimeRepository = undefined as never
  ) {
    this.docker = new Docker({
      socketPath: '/var/run/docker.sock',
      timeout: WORKER_DOCKER_API_TIMEOUT_MS,
    });
  }

  private buildContainerEnv(overrides: string[]): string[] {
    const envMap = new Map<string, string>();

    for (const [key, value] of Object.entries(process.env)) {
      if (value === undefined) {
        continue;
      }

      if (!/^[A-Z0-9_]+$/.test(key)) {
        continue;
      }

      if (!isInheritedWorkerEnvironmentKeyAllowed(key)) {
        continue;
      }

      const normalized = normalizeWorkerEnvironmentValue(key, value, {
        recoverConcatenatedBoolean: true,
      });
      envMap.set(key, normalized.value);
      if (normalized.discardedEnvironmentKey) {
        console.warn(
          '[worker-container-env]',
          JSON.stringify({
            event: 'worker.container_env.malformed_boolean_recovered',
            environment_key: key,
            discarded_environment_key: normalized.discardedEnvironmentKey,
            action: 'discarded_concatenated_suffix',
          })
        );
      }
    }

    for (const envEntry of overrides) {
      const separatorIndex = envEntry.indexOf('=');
      if (separatorIndex <= 0) {
        throw new Error('worker_container_env_override_invalid');
      }

      const key = envEntry.slice(0, separatorIndex);
      const value = envEntry.slice(separatorIndex + 1);
      if (!/^[A-Z0-9_]+$/.test(key) || !WORKER_OVERRIDE_ENV_KEYS.has(key)) {
        throw new Error(`worker_container_env_override_not_allowed:${key}`);
      }
      envMap.set(
        key,
        normalizeWorkerEnvironmentValue(key, value, {
          recoverConcatenatedBoolean: false,
        }).value
      );
    }

    envMap.set('TZ', APP_TIMEZONE);
    envMap.set('PGTZ', APP_TIMEZONE);
    /*
     * Worker images are an external runtime trust boundary. Never let the
     * balance process override their public endpoint scope or downgrade
     * production-only safety checks through inherited environment values.
     */
    envMap.set('NODE_ENV', 'production');
    envMap.set('UNDERCHAT_ENV_SCOPE', 'public');
    /*
     * Channel containers always run in the public endpoint scope, including
     * containers created on remote Docker hosts. Normalize the preferred
     * public server list into the canonical NATS_URL consumed by every worker
     * implementation. The private cluster DNS must never cross this boundary.
     */
    const natsPublicURL = envMap.get('NATS_PUBLIC_URL');
    const natsURL = envMap.get('NATS_URL');
    const selectedNatsURL = natsPublicURL?.trim() ? natsPublicURL : natsURL;
    if (selectedNatsURL?.trim()) {
      const normalizedNatsURL = normalizeWorkerNatsURLList(
        selectedNatsURL,
        natsPublicURL?.trim() ? 'NATS_PUBLIC_URL' : 'NATS_URL'
      );
      envMap.set('NATS_URL', normalizedNatsURL);
      if (natsPublicURL?.trim()) {
        envMap.set('NATS_PUBLIC_URL', normalizedNatsURL);
      }
    } else {
      envMap.delete('NATS_URL');
      envMap.delete('NATS_PUBLIC_URL');
    }
    envMap.delete('NATS_PRIVATE_URL');
    this.injectStaticWorkerNatsAuthentication(envMap);
    const needsLegacyWwebjsBalancerAccess =
      envMap.get('WORKER_TYPE_ID') === EWorkerType.wwebjs &&
      envMap.get('WORKER_SESSION_STORAGE') ===
        EWorkerSessionStorage.legacy_volume;
    if (needsLegacyWwebjsBalancerAccess) {
      /*
       * Chromium lock cleanup is the sole worker-to-Balance RPC left. It is
       * scoped to legacy WWebJS volumes, so no other worker receives this
       * credential or the Balance endpoint.
       */
      envMap.set(BALANCER_RUNTIME_FENCE_TOKEN_ENV, balanceRuntimeFenceToken());
    } else {
      envMap.delete(BALANCER_RUNTIME_FENCE_TOKEN_ENV);
      envMap.delete('BALANCER_GRPC_HOST');
      envMap.delete('BALANCER_GRPC_PORT');
    }

    const needsWorkerDatabaseAccess = isWhatsappWorkerType(
      envMap.get('WORKER_TYPE_ID')
    );
    const workerDatabaseUrl = needsWorkerDatabaseAccess
      ? resolveWorkerDatabaseUrlFromDiscreteConfiguration()
      : undefined;
    if (needsWorkerDatabaseAccess && !workerDatabaseUrl) {
      throw new Error('postgres_worker_database_url_missing');
    }
    if (workerDatabaseUrl) {
      envMap.set('WORKER_DATABASE_URL', workerDatabaseUrl);
    } else {
      envMap.delete('WORKER_DATABASE_URL');
    }

    return [...envMap.entries()]
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([key, value]) => `${key}=${value}`);
  }

  private injectStaticWorkerNatsAuthentication(
    envMap: Map<string, string>
  ): void {
    // Production uses the static runtime principal configured in the
    // UNDERCHAT NATS account. Never allow an old token or per-channel JWT to
    // override that single authentication contract.
    envMap.delete('NATS_TOKEN');
    envMap.delete('NATS_CREDS_BASE64');

    const authentication = this.resolveStaticWorkerNatsAuthentication({
      user: envMap.get('NATS_USER'),
      password: envMap.get('NATS_PASSWORD'),
    });
    if (!authentication) {
      envMap.delete('NATS_USER');
      envMap.delete('NATS_PASSWORD');
      return;
    }

    envMap.set('NATS_USER', authentication.user);
    envMap.set('NATS_PASSWORD', authentication.password);
  }

  private resolveStaticWorkerNatsAuthentication(
    input: {
      user?: string;
      password?: string;
    } = {
      user: process.env.NATS_USER,
      password: process.env.NATS_PASSWORD,
    }
  ): { user: string; password: string } | null {
    const user = input.user?.trim();
    const password = input.password;

    if (Boolean(user) !== Boolean(password?.length)) {
      throw new Error('nats_worker_static_credentials_incomplete');
    }
    if (!user || !password) {
      if (process.env.APP_ENVIRONMENT !== EAppEnvironment.local) {
        throw new Error('nats_worker_static_credentials_missing');
      }
      return null;
    }
    return { user, password };
  }

  private buildContainerLabels(input: {
    imageName: EWorkerImage;
    workerId: string;
    accountId: string;
    metadata?: WorkerContainerMetadata;
    sessionVolumeName?: string;
  }): Record<string, string> {
    return {
      'underchat.worker_id': input.workerId,
      'underchat.account_id': input.accountId,
      'underchat.worker_image': input.imageName,
      ...(input.sessionVolumeName
        ? { 'underchat.session_volume_name': input.sessionVolumeName }
        : {}),
      ...(input.metadata?.sessionStorage
        ? {
            'underchat.session_storage': input.metadata.sessionStorage,
          }
        : {}),
      ...(input.metadata?.sessionStorageMigrationId
        ? {
            'underchat.session_storage_migration_id':
              input.metadata.sessionStorageMigrationId,
            'underchat.legacy_session_volume_name': input.metadata
              .legacySessionVolumeName as string,
            'underchat.legacy_session_checksum_sha256': input.metadata
              .legacySessionChecksum as string,
          }
        : {}),
      ...(input.metadata?.workerTypeId
        ? { 'underchat.worker_type_id': input.metadata.workerTypeId }
        : {}),
      ...(input.metadata?.workerGrpcPort !== undefined
        ? {
            'underchat.worker_grpc_port': String(input.metadata.workerGrpcPort),
          }
        : {}),
      ...(input.metadata?.runtimeGeneration !== undefined
        ? {
            'underchat.runtime_generation': String(
              input.metadata.runtimeGeneration
            ),
          }
        : {}),
      ...(input.metadata?.lifecycleOperationId
        ? {
            'underchat.lifecycle_operation_id':
              input.metadata.lifecycleOperationId,
          }
        : {}),
      ...(input.metadata?.warmPoolId
        ? {
            'underchat.warm_pool_id': input.metadata.warmPoolId,
            'underchat.warm_standby': 'false',
          }
        : {}),
      ...(input.metadata?.serverId
        ? { 'underchat.server_id': input.metadata.serverId }
        : {}),
      ...(input.metadata?.proxyFingerprint
        ? {
            'underchat.proxy_fingerprint': input.metadata.proxyFingerprint,
          }
        : {}),
      ...(input.metadata?.proxyMode
        ? { 'underchat.proxy_mode': input.metadata.proxyMode }
        : {}),
    };
  }

  private getAllowedLabels(
    labels: Record<string, string> | undefined
  ): Record<string, string> {
    const safeLabels: Record<string, string> = {};

    for (const [key, value] of Object.entries(labels ?? {})) {
      if (this.inspectedLabelKeys.has(key)) {
        safeLabels[key] = value;
      }
    }

    return safeLabels;
  }

  private getAllowedEnv(env: string[] | undefined): Record<string, string> {
    const safeEnv: Record<string, string> = {};

    for (const envEntry of env ?? []) {
      const separatorIndex = envEntry.indexOf('=');
      if (separatorIndex <= 0) {
        continue;
      }

      const key = envEntry.slice(0, separatorIndex);
      if (!this.inspectedEnvKeys.has(key)) {
        continue;
      }

      safeEnv[key] = envEntry.slice(separatorIndex + 1);
    }

    return safeEnv;
  }

  private sanitizeDiagnosticText(
    value: string | undefined
  ): string | undefined {
    const normalized = value
      ?.replace(/[\u0000-\u001F\u007F]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .replace(
        /([A-Z0-9_]*(?:PASSWORD|TOKEN|SECRET|KEY)[A-Z0-9_]*=)[^ ]+/giu,
        '$1[redacted]'
      )
      .trim();

    if (!normalized) {
      return undefined;
    }

    return normalized.length > 4000
      ? `${normalized.slice(0, 4000)}...`
      : normalized;
  }

  public async existsContainerWorkerById(workerId: string): Promise<boolean> {
    const inspection = await this.inspectContainerWorkerById(workerId);
    return inspection.exists;
  }

  public async inspectContainerWorkerById(
    workerId: string
  ): Promise<WorkerContainerInspection> {
    try {
      const container = this.docker.getContainer(workerId);
      const info = await withStrictDockerInspectTimeout(container.inspect());
      return this.buildWorkerContainerInspection(workerId, info);
    } catch (error) {
      const inspection: WorkerContainerInspection = {
        exists: false,
        container_name: workerId,
        error: dockerErrorMessage(error),
      };

      return inspection;
    }
  }

  /**
   * Strict variant for lifecycle decisions. A confirmed Docker 404 means the
   * container is absent; daemon, transport and authorization failures are
   * propagated so callers do not replace a potentially recoverable session.
   */
  public async inspectContainerWorkerByIdStrict(
    workerId: string
  ): Promise<WorkerContainerInspection> {
    try {
      const container = this.docker.getContainer(workerId);
      const info = await withStrictDockerInspectTimeout(container.inspect());
      return this.buildWorkerContainerInspection(workerId, info);
    } catch (error) {
      if (confirmedDockerContainerNotFound(error)) {
        return {
          exists: false,
          container_name: workerId,
          error: dockerErrorMessage(error),
        };
      }
      throw error;
    }
  }

  /**
   * Reads only the two runtime-fence secrets from Docker's immutable
   * container configuration. They are intentionally excluded from the normal
   * inspection projection so lifecycle diagnostics can never serialize them.
   */
  public async inspectRuntimeWriterIdentityByContainerIdStrict(
    containerId: string
  ): Promise<WorkerRuntimeWriterIdentity> {
    const info = await withStrictDockerInspectTimeout(
      this.docker.getContainer(containerId).inspect()
    );
    const env = new Map<string, string>();
    for (const entry of info.Config?.Env ?? []) {
      const separator = entry.indexOf('=');
      if (separator <= 0) continue;
      env.set(entry.slice(0, separator), entry.slice(separator + 1));
    }
    const runtimeCapability =
      env.get('WORKER_RUNTIME_CAPABILITY')?.trim() ?? '';
    const writerEpoch = env.get('WORKER_WRITER_EPOCH')?.trim() ?? '';
    if (runtimeCapability.length < 32 || !UUID_PATTERN.test(writerEpoch)) {
      throw new Error('worker_runtime_writer_identity_invalid');
    }
    return { runtimeCapability, writerEpoch };
  }

  /**
   * Removes an unhealthy runtime through one host-side compare-and-remove
   * operation. The helper fences Docker auto-restart before its final snapshot,
   * so a healthcheck SIGKILL cannot restart the same container between the
   * liveness comparison and `docker rm`.
   */
  public async removeContainerIfLivenessFenceMatches(
    input: WorkerLivenessRemovalFence
  ): Promise<WorkerLivenessConditionalRemoveResult> {
    const containerId = input.containerId.trim().toLowerCase();
    const healthStatus = input.healthStatus.trim().toLowerCase();
    const retiredLifecycleOperationId =
      input.retiredLifecycleOperationId?.trim().toLowerCase() ?? '';
    if (
      !FULL_CONTAINER_ID_PATTERN.test(containerId) ||
      !input.startedAt ||
      !Number.isFinite(Date.parse(input.startedAt)) ||
      !Number.isSafeInteger(input.restartCount) ||
      input.restartCount < 0 ||
      !['unhealthy', 'healthy', 'starting', 'none'].includes(healthStatus) ||
      typeof input.paused !== 'boolean' ||
      (input.forceRemove !== true &&
        !input.paused &&
        healthStatus !== 'unhealthy' &&
        !(healthStatus === 'starting' && input.restartCount >= 1)) ||
      !input.workerId ||
      !input.accountId ||
      !input.serverId ||
      !input.workerTypeId ||
      !Number.isSafeInteger(input.runtimeGeneration) ||
      input.runtimeGeneration <= 0 ||
      (retiredLifecycleOperationId !== '' &&
        (!UUID_PATTERN.test(retiredLifecycleOperationId) ||
          input.forceRemove !== true))
    ) {
      throw new TypeError('Invalid worker liveness removal fence');
    }

    const scriptPath = this.resolveWorkerLivenessConditionalRemoveScript();
    const { stdout } = await execFileAsync(
      scriptPath,
      [
        containerId,
        input.startedAt,
        String(input.restartCount),
        healthStatus,
        String(input.paused),
        input.workerId,
        input.accountId,
        input.serverId,
        input.workerTypeId,
        String(input.runtimeGeneration),
        String(input.forceRemove === true),
        input.warmPoolId ?? '',
        input.sessionStorage ?? '',
        retiredLifecycleOperationId,
      ],
      {
        encoding: 'utf8',
        timeout: WORKER_LIVENESS_REMOVE_TIMEOUT_MS,
        maxBuffer: 64 * 1024,
      }
    );
    const resultLine = stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1);
    if (!resultLine) {
      throw new Error('Worker liveness conditional removal returned no result');
    }

    let parsed: {
      status?: unknown;
      reason?: unknown;
      observed_restart_count?: unknown;
    };
    try {
      parsed = JSON.parse(resultLine) as typeof parsed;
    } catch {
      throw new Error(
        'Worker liveness conditional removal returned an invalid result'
      );
    }
    if (
      typeof parsed.reason !== 'string' ||
      parsed.reason.length === 0 ||
      parsed.reason.length > 100
    ) {
      throw new Error(
        'Worker liveness conditional removal returned an invalid reason'
      );
    }
    if (parsed.status === 'error') {
      throw new Error(
        `Worker liveness conditional removal failed: ${parsed.reason}`
      );
    }
    if (
      parsed.status !== 'removed' &&
      parsed.status !== 'recovered' &&
      parsed.status !== 'pending' &&
      parsed.status !== 'stale'
    ) {
      throw new Error(
        'Worker liveness conditional removal returned an invalid status'
      );
    }
    if (
      parsed.observed_restart_count !== undefined &&
      (typeof parsed.observed_restart_count !== 'number' ||
        !Number.isSafeInteger(parsed.observed_restart_count) ||
        parsed.observed_restart_count < 0)
    ) {
      throw new Error(
        'Worker liveness conditional removal returned an invalid restart count'
      );
    }

    return {
      status: parsed.status,
      reason: parsed.reason,
      ...(parsed.observed_restart_count !== undefined
        ? { observedRestartCount: parsed.observed_restart_count }
        : {}),
    };
  }

  private resolveWorkerLivenessConditionalRemoveScript(): string {
    const scriptName = 'worker-liveness-conditional-remove.sh';
    const configuredPath =
      process.env.WORKER_LIVENESS_CONDITIONAL_REMOVE_SCRIPT?.trim();
    const candidates = [
      configuredPath,
      '/app/scripts/worker-liveness-conditional-remove.sh',
      path.resolve(process.cwd(), 'scripts', scriptName),
      path.resolve(process.cwd(), '..', '..', 'scripts', scriptName),
    ].filter((candidate): candidate is string => Boolean(candidate));
    const scriptPath = candidates.find((candidate) => existsSync(candidate));
    if (!scriptPath) {
      throw new Error(
        'Worker liveness conditional removal helper is unavailable'
      );
    }
    return scriptPath;
  }

  public async authorizeChromiumLockCleanup(
    input: IChromiumLockCleanupAuthorizationRequestProto
  ): Promise<IChromiumLockCleanupAuthorizationResponseProto> {
    const request = validateChromiumLockCleanupRequest(input);
    if (!request) {
      return chromiumLockCleanupResponse(input, 'invalid_request');
    }

    let controlPlaneBefore: ChromiumLockCleanupControlPlaneSnapshot | undefined;
    try {
      controlPlaneBefore =
        await this.captureChromiumLockCleanupControlPlaneSnapshot(request);
    } catch {
      return chromiumLockCleanupResponse(request, 'control_plane_unavailable');
    }
    if (!controlPlaneBefore) {
      return chromiumLockCleanupResponse(request, 'runtime_identity_mismatch');
    }

    let dockerBefore: ChromiumLockCleanupSnapshotResult;
    try {
      dockerBefore = await this.captureChromiumLockCleanupDockerSnapshot(
        request,
        controlPlaneBefore
      );
    } catch (error) {
      return chromiumLockCleanupResponse(
        request,
        isAmbiguousDockerContainerError(error)
          ? 'lock_owner_ambiguous'
          : 'docker_unavailable'
      );
    }
    if (!dockerBefore.snapshot) {
      return chromiumLockCleanupResponse(
        request,
        dockerBefore.denialReason ?? 'docker_unavailable'
      );
    }

    let dockerAfter: ChromiumLockCleanupSnapshotResult;
    try {
      dockerAfter = await this.captureChromiumLockCleanupDockerSnapshot(
        request,
        controlPlaneBefore
      );
    } catch (error) {
      return chromiumLockCleanupResponse(
        request,
        isAmbiguousDockerContainerError(error)
          ? 'lock_owner_ambiguous'
          : 'docker_unavailable'
      );
    }
    if (
      !dockerAfter.snapshot ||
      JSON.stringify(dockerAfter.snapshot) !==
        JSON.stringify(dockerBefore.snapshot)
    ) {
      return chromiumLockCleanupResponse(request, 'docker_snapshot_changed');
    }

    let controlPlaneAfter: ChromiumLockCleanupControlPlaneSnapshot | undefined;
    try {
      controlPlaneAfter =
        await this.captureChromiumLockCleanupControlPlaneSnapshot(request);
    } catch {
      return chromiumLockCleanupResponse(request, 'control_plane_unavailable');
    }
    if (
      !controlPlaneAfter ||
      controlPlaneAfter.signature !== controlPlaneBefore.signature
    ) {
      return chromiumLockCleanupResponse(request, 'runtime_identity_mismatch');
    }

    return chromiumLockCleanupResponse(
      request,
      'authorized',
      Date.now() + CHROMIUM_LOCK_AUTHORIZATION_WINDOW_MS
    );
  }

  private hasChromiumLockCleanupControlPlane(): boolean {
    return (
      typeof this.workerMonitorViewerRepository?.viewWorkerConsistent ===
        'function' &&
      typeof this.workerRuntimeRepository?.viewByWorkerIdConsistent ===
        'function'
    );
  }

  private async captureChromiumLockCleanupControlPlaneSnapshot(
    request: ValidChromiumLockCleanupAuthorizationRequest
  ): Promise<ChromiumLockCleanupControlPlaneSnapshot | undefined> {
    if (!this.hasChromiumLockCleanupControlPlane()) {
      throw new Error('chromium_lock_cleanup_control_plane_unavailable');
    }

    const [worker, runtime] = await withChromiumLockOperationTimeout(
      Promise.all([
        this.workerMonitorViewerRepository.viewWorkerConsistent(
          request.workerId
        ),
        this.workerRuntimeRepository.viewByWorkerIdConsistent(request.workerId),
      ])
    );
    const containerId = runtime?.container_id?.trim().toLowerCase() ?? '';
    const workerContainerId = worker?.container_id?.trim().toLowerCase() ?? '';
    const lifecycleOperationId = worker?.lifecycle_operation_id?.trim() ?? '';
    const forbiddenStatus =
      worker?.worker_status_id === EWorkerStatus.delete ||
      worker?.worker_status_id === EWorkerStatus.deleting ||
      worker?.worker_status_id === EWorkerStatus.blocked ||
      worker?.worker_status_id === EWorkerStatus.stopped;
    const steadyRuntimePointer = containerId === workerContainerId;
    const previousPointerMatchesOwner =
      CONTAINER_ID_PATTERN.test(workerContainerId) &&
      workerContainerId.startsWith(request.ownerContainerId);
    const fencedRuntimeTransition =
      Boolean(lifecycleOperationId) &&
      ((worker?.worker_status_id === EWorkerStatus.recreating &&
        previousPointerMatchesOwner) ||
        (worker?.worker_status_id === EWorkerStatus.creating &&
          (!workerContainerId || previousPointerMatchesOwner)));

    if (
      !worker ||
      !runtime ||
      forbiddenStatus ||
      worker.deleted_at !== null ||
      worker.worker_id !== request.workerId ||
      worker.account_id !== request.accountId ||
      worker.server_id !== balanceEnvironment.serverId ||
      worker.worker_type_id !== EWorkerType.wwebjs ||
      runtime.worker_id !== request.workerId ||
      runtime.runtime_generation !== request.runtimeGeneration ||
      runtime.session_volume_name !== request.sessionVolumeName ||
      !CONTAINER_ID_PATTERN.test(containerId) ||
      (!steadyRuntimePointer && !fencedRuntimeTransition) ||
      !containerId.startsWith(request.requesterContainerId)
    ) {
      return undefined;
    }

    const signature = JSON.stringify({
      worker_id: worker.worker_id,
      account_id: worker.account_id,
      server_id: worker.server_id,
      worker_type_id: worker.worker_type_id,
      worker_status_id: worker.worker_status_id,
      worker_container_id: workerContainerId,
      lifecycle_operation_id: lifecycleOperationId || null,
      runtime_pointer_mode: steadyRuntimePointer ? 'steady' : 'transition',
      runtime_worker_id: runtime.worker_id,
      runtime_container_id: containerId,
      runtime_generation: runtime.runtime_generation,
      session_volume_name: runtime.session_volume_name,
      warm_pool_id: runtime.warm_pool_id ?? null,
    });

    return {
      containerId,
      lifecycleOperationId: lifecycleOperationId || undefined,
      runtimePointerMode: steadyRuntimePointer ? 'steady' : 'transition',
      serverId: worker.server_id,
      signature,
      warmPoolId: runtime.warm_pool_id ?? undefined,
    };
  }

  private async captureChromiumLockCleanupDockerSnapshot(
    request: ValidChromiumLockCleanupAuthorizationRequest,
    controlPlane: ChromiumLockCleanupControlPlaneSnapshot
  ): Promise<ChromiumLockCleanupSnapshotResult> {
    const [requester, owner, containers] = await Promise.all([
      this.inspectContainerForChromiumLockCleanup(request.requesterContainerId),
      this.inspectContainerForChromiumLockCleanup(request.ownerContainerId),
      withChromiumLockOperationTimeout(
        this.docker.listContainers({ all: true })
      ),
    ]);

    if (!requester.exists || !requester.info) {
      return { denialReason: 'requester_not_found' };
    }
    if (owner.exists) {
      return { denialReason: 'lock_owner_present' };
    }

    const requesterRejection =
      this.resolveChromiumLockCleanupRequesterRejection(
        request,
        controlPlane,
        requester.info
      );
    if (requesterRejection) {
      return { denialReason: requesterRejection };
    }

    const volumeMountContainerIds =
      this.resolveChromiumLockCleanupVolumeMountContainerIds(
        containers,
        request.sessionVolumeName
      );
    if (
      volumeMountContainerIds.length !== 1 ||
      volumeMountContainerIds[0] !== controlPlane.containerId
    ) {
      return { denialReason: 'volume_shared' };
    }

    return {
      snapshot: {
        requesterSignature: this.buildChromiumLockCleanupRequesterSignature(
          requester.info
        ),
        volumeMountContainerIds,
      },
    };
  }

  private async inspectContainerForChromiumLockCleanup(
    containerId: string
  ): Promise<DockerContainerLookup> {
    try {
      const info = await withChromiumLockOperationTimeout(
        this.docker.getContainer(containerId).inspect()
      );
      return { exists: true, info };
    } catch (error) {
      if (confirmedDockerContainerNotFound(error)) {
        return { exists: false };
      }
      throw error;
    }
  }

  private resolveChromiumLockCleanupRequesterRejection(
    request: ValidChromiumLockCleanupAuthorizationRequest,
    controlPlane: ChromiumLockCleanupControlPlaneSnapshot,
    info: Docker.ContainerInspectInfo
  ): ChromiumLockCleanupDecisionReason | undefined {
    const state = info.State as
      | {
          Dead?: boolean;
          Paused?: boolean;
          Restarting?: boolean;
          Running?: boolean;
          Status?: string;
        }
      | undefined;
    if (
      state?.Running !== true ||
      state.Restarting === true ||
      state.Paused === true ||
      state.Dead === true ||
      state.Status !== 'running'
    ) {
      return 'requester_not_running';
    }

    const config = info.Config as
      | {
          Env?: string[];
          Hostname?: string;
          Image?: string;
          Labels?: Record<string, string>;
        }
      | undefined;
    const containerId = info.Id?.toLowerCase() ?? '';
    const hostname = config?.Hostname?.trim().toLowerCase() ?? '';
    const labels = config?.Labels ?? {};
    const env = this.getAllowedEnv(config?.Env);
    const expectedGeneration = String(request.runtimeGeneration);
    const warmIdentityMatches = this.chromiumLockCleanupWarmIdentityMatches(
      labels,
      env,
      controlPlane.warmPoolId
    );
    const lifecycleIdentityMatches =
      controlPlane.runtimePointerMode === 'steady' ||
      (Boolean(controlPlane.lifecycleOperationId) &&
        labels['underchat.lifecycle_operation_id'] ===
          controlPlane.lifecycleOperationId);
    const configuredImage = config?.Image?.trim().toLowerCase() ?? '';
    const runtimeImageId =
      (info as { Image?: string }).Image?.trim().toLowerCase() ?? '';
    const configuredImageMatches =
      config?.Image === EWorkerImage.wwebjs ||
      (CANONICAL_DOCKER_IMAGE_ID_PATTERN.test(configuredImage) &&
        configuredImage === runtimeImageId);
    const identityMismatch =
      !CONTAINER_ID_PATTERN.test(containerId) ||
      containerId !== controlPlane.containerId ||
      hostname !== request.requesterContainerId ||
      !containerId.startsWith(hostname) ||
      info.Name !== `/${request.workerId}` ||
      labels['underchat.worker_id'] !== request.workerId ||
      labels['underchat.account_id'] !== request.accountId ||
      (labels['underchat.server_id'] !== undefined &&
        labels['underchat.server_id'] !== controlPlane.serverId) ||
      labels['underchat.worker_type_id'] !== EWorkerType.wwebjs ||
      labels['underchat.runtime_generation'] !== expectedGeneration ||
      labels['underchat.session_volume_name'] !== request.sessionVolumeName ||
      labels['underchat.worker_image'] !== EWorkerImage.wwebjs ||
      !configuredImageMatches ||
      env.WORKER_ID !== request.workerId ||
      env.ACCOUNT_ID !== request.accountId ||
      env.WORKER_TYPE_ID !== EWorkerType.wwebjs ||
      env.RUNTIME_GENERATION !== expectedGeneration ||
      env.SESSION_VOLUME_NAME !== request.sessionVolumeName ||
      env.WORKER_IMAGE !== EWorkerImage.wwebjs ||
      !warmIdentityMatches ||
      !lifecycleIdentityMatches;
    if (identityMismatch) {
      return 'requester_identity_mismatch';
    }

    const appDataMounts = (info.Mounts ?? []).filter(
      (mount) => mount.Destination === '/app/data'
    );
    if (
      appDataMounts.length !== 1 ||
      appDataMounts[0]?.Type !== 'volume' ||
      appDataMounts[0].Name !== request.sessionVolumeName ||
      appDataMounts[0].RW !== true
    ) {
      return 'requester_mount_invalid';
    }

    return undefined;
  }

  private chromiumLockCleanupWarmIdentityMatches(
    labels: Record<string, string>,
    env: Record<string, string>,
    durableWarmPoolId: string | undefined
  ): boolean {
    const labelWarmPoolId = labels['underchat.warm_pool_id'];
    const envWarmPoolId = env.WARM_POOL_ID;
    const labelStandby = labels['underchat.warm_standby'];
    const envStandby = env.WARM_STANDBY;

    if (durableWarmPoolId) {
      const currentWarmMetadataMatches =
        labelWarmPoolId === durableWarmPoolId &&
        envWarmPoolId === durableWarmPoolId &&
        labelStandby === 'false' &&
        envStandby === 'false';
      const legacyWarmMetadataIsAbsent =
        labelWarmPoolId === undefined &&
        envWarmPoolId === undefined &&
        labelStandby === undefined &&
        envStandby === undefined;

      return currentWarmMetadataMatches || legacyWarmMetadataIsAbsent;
    }

    return (
      labelWarmPoolId === undefined &&
      envWarmPoolId === undefined &&
      labelStandby === envStandby &&
      (labelStandby === undefined || labelStandby === 'false')
    );
  }

  private resolveChromiumLockCleanupVolumeMountContainerIds(
    containers: Docker.ContainerInfo[],
    sessionVolumeName: string
  ): string[] {
    return containers
      .filter((container) =>
        (container.Mounts ?? []).some(
          (mount) => mount.Type === 'volume' && mount.Name === sessionVolumeName
        )
      )
      .map((container) => container.Id?.toLowerCase() ?? '')
      .sort();
  }

  private buildChromiumLockCleanupRequesterSignature(
    info: Docker.ContainerInspectInfo
  ): string {
    const state = info.State as
      | {
          Dead?: boolean;
          Paused?: boolean;
          Restarting?: boolean;
          Running?: boolean;
          StartedAt?: string;
          Status?: string;
        }
      | undefined;
    const config = info.Config as
      | {
          Env?: string[];
          Hostname?: string;
          Image?: string;
          Labels?: Record<string, string>;
        }
      | undefined;

    return JSON.stringify({
      id: info.Id,
      name: info.Name,
      restart_count: info.RestartCount,
      state: {
        dead: state?.Dead,
        paused: state?.Paused,
        restarting: state?.Restarting,
        running: state?.Running,
        started_at: state?.StartedAt,
        status: state?.Status,
      },
      config: {
        hostname: config?.Hostname,
        image: config?.Image,
        labels: this.getAllowedLabels(config?.Labels),
        env: this.getAllowedEnv(config?.Env),
      },
      mounts: (info.Mounts ?? [])
        .map((mount) => ({
          destination: mount.Destination,
          name: mount.Name,
          rw: mount.RW,
          source: mount.Source,
          type: mount.Type,
        }))
        .sort((first, second) =>
          JSON.stringify(first).localeCompare(JSON.stringify(second))
        ),
    });
  }

  private buildWorkerContainerInspection(
    workerId: string,
    info: Docker.ContainerInspectInfo
  ): WorkerContainerInspection {
    const state = info.State as
      | {
          Status?: string;
          StartedAt?: string;
          FinishedAt?: string;
          Running?: boolean;
          Restarting?: boolean;
          Paused?: boolean;
          ExitCode?: number;
          Health?: {
            Status?: string;
            FailingStreak?: number;
            Log?: Array<{
              Output?: string;
            }>;
          };
        }
      | undefined;
    const config = info.Config as
      | {
          Image?: string;
          Env?: string[];
          Entrypoint?: string[];
          Labels?: Record<string, string>;
        }
      | undefined;
    const hostConfig = info.HostConfig as
      | {
          PidsLimit?: number | null;
        }
      | undefined;
    const healthLog = state?.Health?.Log?.at(-1)?.Output;
    const labels = this.getAllowedLabels(config?.Labels);
    const env = this.getAllowedEnv(config?.Env);
    const logicalImage =
      labels['underchat.worker_image'] === env.WORKER_IMAGE &&
      Object.values(EWorkerImage).includes(env.WORKER_IMAGE as EWorkerImage)
        ? env.WORKER_IMAGE
        : config?.Image;

    return {
      exists: true,
      container_id: info.Id,
      container_name: info.Name?.replace(/^\//u, '') || workerId,
      container_image: logicalImage,
      container_image_reference: config?.Image,
      container_image_id: (info as { Image?: string }).Image,
      container_state: state?.Status,
      container_status: (info as { Status?: string }).Status ?? state?.Status,
      container_started_at: state?.StartedAt,
      container_finished_at: state?.FinishedAt,
      container_restart_count: (info as { RestartCount?: number }).RestartCount,
      container_exit_code: state?.ExitCode,
      container_health_status: state?.Health?.Status,
      container_health_failing_streak: state?.Health?.FailingStreak,
      container_health_log: this.sanitizeDiagnosticText(healthLog),
      container_paused: state?.Paused === true,
      container_labels: labels,
      container_env: env,
      container_mounts: (info.Mounts ?? []).map((mount) => ({
        destination: mount.Destination,
        name: mount.Name,
        read_write: mount.RW,
        type: mount.Type,
      })),
      container_entrypoint: config?.Entrypoint,
      container_pids_limit: hostConfig?.PidsLimit,
      running: state?.Running === true,
    };
  }

  public async removeContainerWorkerById(workerId: string): Promise<boolean> {
    try {
      const container = this.docker.getContainer(workerId);
      await container.remove({ force: true });

      return true;
    } catch (error) {
      if (isIdempotentDockerRemoveError(error)) {
        return true;
      }

      throw new Error('The worker removal failed');
    }
  }

  /**
   * Sends SIGTERM and waits for the worker's provider-specific shutdown hook.
   * Provider handoff callers verify the released PostgreSQL lease separately
   * before using force-remove only as final filesystem cleanup.
   */
  public async stopContainerWorkerByIdGracefully(
    containerId: string
  ): Promise<boolean> {
    const container = this.docker.getContainer(containerId);
    try {
      await container.stop({
        t: NODE_WORKER_CONTAINER_STOP_TIMEOUT_SECONDS,
      });
    } catch (error) {
      if (!isIdempotentDockerStopError(error)) {
        const current =
          await this.inspectContainerWorkerByIdStrict(containerId);
        if (current.exists && current.running === true) {
          throw new Error('The worker graceful stop failed');
        }
      }
    }

    const stopped = await this.inspectContainerWorkerByIdStrict(containerId);
    return !stopped.exists || stopped.running !== true;
  }

  /**
   * Removes a PostgreSQL warm runtime together with anonymous volumes created
   * by an image-level VOLUME declaration. Docker's `v` flag removes anonymous
   * container-owned volumes only; named volumes remain untouched. Callers
   * must establish the exact PostgreSQL warm ownership fence first.
   */
  public async removePostgresWarmContainerWithAnonymousVolumesById(
    containerId: string
  ): Promise<boolean> {
    try {
      const container = this.docker.getContainer(containerId);
      await container.remove({ force: true, v: true });

      return true;
    } catch (error) {
      if (isIdempotentDockerRemoveError(error)) {
        return true;
      }

      throw new Error('The PostgreSQL warm worker removal failed');
    }
  }

  public async removeVolumeWorkerById(workerId: string): Promise<boolean> {
    return this.removeVolumeByName(workerId);
  }

  public async removeVolumeByName(volumeName: string): Promise<boolean> {
    try {
      const volume = this.docker.getVolume(volumeName);
      await volume.remove();

      return true;
    } catch (error) {
      if (isIdempotentDockerRemoveError(error)) {
        return true;
      }

      throw new Error('The worker volume removal failed');
    }
  }

  public async existsVolumeWorkerById(workerId: string): Promise<boolean> {
    return this.existsVolumeByName(workerId);
  }

  public async existsVolumeByName(volumeName: string): Promise<boolean> {
    try {
      const volume = this.docker.getVolume(volumeName);
      await volume.inspect();

      return true;
    } catch (error) {
      if (isDockerNotFoundError(error)) {
        return false;
      }

      console.warn(`Volume ${volumeName} does not exist or is inaccessible:`, {
        error: dockerErrorMessage(error),
      });

      return false;
    }
  }

  /**
   * Strict variant for lifecycle decisions. Only a confirmed Docker not-found
   * is absence; transport/daemon/permission failures must fail closed so a
   * recoverable WhatsApp session is never replaced by an empty volume.
   */
  public async existsVolumeByNameStrict(volumeName: string): Promise<boolean> {
    try {
      const volume = this.docker.getVolume(volumeName);
      await withStrictDockerInspectTimeout(volume.inspect());
      return true;
    } catch (error) {
      if (confirmedDockerContainerNotFound(error)) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Lists every running or stopped Docker container that still mounts the
   * exact named volume. Lifecycle cleanup uses the unfiltered daemon inventory
   * deliberately: a stale/active owner without Underchat labels must still
   * fence deletion.
   */
  public async listContainerIdsMountingVolumeStrict(
    volumeName: string
  ): Promise<string[]> {
    if (!VOLUME_NAME_PATTERN.test(volumeName)) {
      throw new Error('worker_volume_reference_name_invalid');
    }

    const containers = await withStrictDockerInspectTimeout(
      this.docker.listContainers({ all: true })
    );
    const containerIds = containers
      .filter((container) =>
        (container.Mounts ?? []).some(
          (mount) => mount.Type === 'volume' && mount.Name === volumeName
        )
      )
      .map((container) => container.Id?.trim().toLowerCase() ?? '');

    if (
      containerIds.some(
        (containerId) => !FULL_CONTAINER_ID_PATTERN.test(containerId)
      )
    ) {
      throw new Error('worker_volume_reference_container_id_invalid');
    }

    return [...new Set(containerIds)].sort();
  }

  public async inspectVolumeByNameStrict(
    volumeName: string
  ): Promise<WorkerVolumeInspection> {
    if (!VOLUME_NAME_PATTERN.test(volumeName)) {
      throw new Error('worker_volume_inspection_name_invalid');
    }

    try {
      const volume = this.docker.getVolume(volumeName);
      const info = await withStrictDockerInspectTimeout(volume.inspect());
      const createdAt = (info as typeof info & { CreatedAt?: string })
        .CreatedAt;
      const labels = Object.entries(info.Labels ?? {}).sort(
        ([first], [second]) => first.localeCompare(second)
      );
      const signature = JSON.stringify({
        name: info.Name,
        created_at: createdAt,
        driver: info.Driver,
        labels,
        mountpoint: info.Mountpoint,
        scope: info.Scope,
      });
      if (info.Name !== volumeName) {
        throw new Error('worker_volume_inspection_identity_mismatch');
      }
      return {
        exists: true,
        name: info.Name,
        signature,
      };
    } catch (error) {
      if (confirmedDockerContainerNotFound(error)) {
        return { exists: false, name: volumeName };
      }
      throw error;
    }
  }

  /**
   * Explicit finalizer for a previously fenced legacy warm reclaim. This is
   * intentionally separate from removeVolumeByName: an unlabelled volume is
   * removable only after an all-container mount snapshot is empty and the
   * exact volume identity is re-inspected immediately before Docker removal.
   */
  public async removeLegacyWarmVolumeByProof(
    volumeName: string,
    expectedSignature: string | undefined
  ): Promise<boolean> {
    return this.removeWarmVolumeByProof(
      volumeName,
      expectedSignature,
      'legacy_warm_reclaim'
    );
  }

  public async removeConvertedWarmVolumeByProof(
    volumeName: string,
    expectedSignature: string | undefined
  ): Promise<boolean> {
    return this.removeWarmVolumeByProof(
      volumeName,
      expectedSignature,
      'converted_warm_reclaim'
    );
  }

  public async removeFailedWarmActivationVolumeByProof(
    volumeName: string,
    expectedSignature: string | undefined
  ): Promise<boolean> {
    return this.removeWarmVolumeByProof(
      volumeName,
      expectedSignature,
      'failed_warm_activation'
    );
  }

  public async removeWorkerVolumeByProof(
    volumeName: string,
    expectedSignature: string | undefined
  ): Promise<boolean> {
    return this.removeWarmVolumeByProof(
      volumeName,
      expectedSignature,
      'worker_runtime_reclaim'
    );
  }

  private async removeWarmVolumeByProof(
    volumeName: string,
    expectedSignature: string | undefined,
    errorPrefix:
      | 'legacy_warm_reclaim'
      | 'converted_warm_reclaim'
      | 'failed_warm_activation'
      | 'worker_runtime_reclaim'
  ): Promise<boolean> {
    const mountedContainerIds =
      await this.listContainerIdsMountingVolumeStrict(volumeName);
    if (mountedContainerIds.length !== 0) {
      throw new Error(`${errorPrefix}_volume_still_mounted`);
    }

    const confirmed = await this.inspectVolumeByNameStrict(volumeName);
    if (!confirmed.exists) {
      return true;
    }
    if (
      !expectedSignature ||
      !confirmed.signature ||
      confirmed.signature !== expectedSignature
    ) {
      throw new Error(`${errorPrefix}_volume_identity_changed`);
    }

    try {
      // No awaited operation belongs between the strict re-inspection above
      // and remove: Docker itself remains the final atomic in-use fence.
      await this.docker.getVolume(volumeName).remove();
      return true;
    } catch (error) {
      if (isIdempotentDockerRemoveError(error)) {
        return true;
      }
      throw new Error(`${errorPrefix}_volume_removal_failed`);
    }
  }

  public async checkVolumeAndCreate(
    workerId: string,
    isCreateVolume: boolean
  ): Promise<void> {
    await this.checkVolumeNameAndCreate(workerId, isCreateVolume);
  }

  public async checkVolumeNameAndCreate(
    volumeName: string,
    isCreateVolume: boolean,
    labels?: Record<string, string>
  ): Promise<void> {
    const getVolume = await this.existsVolumeByName(volumeName);

    if (!getVolume || isCreateVolume) {
      try {
        await this.docker.createVolume({
          Name: volumeName,
          ...(labels ? { Labels: labels } : {}),
        });
      } catch (error) {
        throw error;
      }
    } else {
    }
  }

  public async removeContainerByNameAndVolume(
    containerName: string,
    volumeName?: string | null,
    isRemoveVolume: boolean = true
  ): Promise<boolean> {
    /*
     * The remove operations are already idempotent for a confirmed Docker
     * not-found. Avoid a non-strict inspect preflight here: daemon/transport
     * failures must abort the warm deletion so its database tombstone remains
     * available for durable redrive.
     */
    const removeContainerWorkerById =
      await this.removeContainerWorkerById(containerName);
    if (!removeContainerWorkerById) {
      throw new Error('The worker removal failed');
    }

    if (isRemoveVolume && volumeName) {
      const removeVolumeWorkerById = await this.removeVolumeByName(volumeName);
      if (!removeVolumeWorkerById) {
        throw new Error('The worker volume removal failed');
      }
    }

    return true;
  }

  public async renameContainer(
    currentName: string,
    nextName: string
  ): Promise<boolean> {
    if (currentName === nextName) {
      return true;
    }

    const container = this.docker.getContainer(currentName);
    await (
      container as unknown as { rename(input: { name: string }): Promise<void> }
    ).rename({
      name: nextName,
    });

    return true;
  }

  public async startContainerWorkerById(containerId: string): Promise<boolean> {
    const container = this.docker.getContainer(containerId);
    try {
      await container.start();
    } catch (error) {
      const current = await this.inspectContainerWorkerByIdStrict(containerId);
      if (
        current.exists &&
        current.container_id === containerId &&
        current.running === true
      ) {
        return true;
      }
      throw error;
    }
    const started = await this.inspectContainerWorkerByIdStrict(containerId);
    return (
      started.exists &&
      started.container_id === containerId &&
      started.running === true
    );
  }

  public async createContainerWorker(
    imageName: EWorkerImage,
    workerId: string,
    accountId: string,
    isCreateVolume: boolean = true,
    grpcHost?: string,
    grpcPort?: number,
    proxy?: {
      protocol?: EProxyProtocol;
      host: string;
      port: number;
      username?: string | null;
      password?: string | null;
    },
    metadata?: WorkerContainerMetadata,
    sessionVolumeName?: string,
    options: WorkerContainerCreateOptions = {}
  ): Promise<string> {
    // Authenticate before any image, volume or container mutation. Recreate
    // must leave the serving runtime untouched when production credentials are
    // absent or incomplete.
    this.resolveStaticWorkerNatsAuthentication();
    if (
      metadata?.runtimeGeneration !== undefined &&
      (!Number.isSafeInteger(metadata.runtimeGeneration) ||
        metadata.runtimeGeneration <= 0)
    ) {
      throw new TypeError('runtimeGeneration must be a positive safe integer');
    }
    if (
      options.imageContentId !== undefined &&
      !/^sha256:[0-9a-f]{64}$/iu.test(options.imageContentId)
    ) {
      throw new TypeError('imageContentId must be a canonical Docker image ID');
    }
    const sessionStorage =
      metadata?.sessionStorage ?? EWorkerSessionStorage.legacy_volume;
    const usesSessionVolume =
      sessionStorage === EWorkerSessionStorage.legacy_volume;
    const hasLegacyMigrationMount = Boolean(
      metadata?.sessionStorageMigrationId ||
      metadata?.legacySessionVolumeName ||
      metadata?.legacySessionChecksum
    );
    if (
      hasLegacyMigrationMount &&
      (sessionStorage !== EWorkerSessionStorage.postgres ||
        !metadata?.sessionStorageMigrationId ||
        !UUID_PATTERN.test(metadata.sessionStorageMigrationId) ||
        !metadata.legacySessionVolumeName ||
        !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,254}$/u.test(
          metadata.legacySessionVolumeName
        ) ||
        !/^[0-9a-f]{64}$/u.test(metadata.legacySessionChecksum ?? ''))
    ) {
      throw new Error('session_storage_migration_mount_identity_invalid');
    }
    const requiresRuntimeWriterIdentity = isWhatsappWorkerType(
      metadata?.workerTypeId
    );
    const requiresWorkerDatabaseAccess = requiresRuntimeWriterIdentity;
    if (
      requiresRuntimeWriterIdentity &&
      (!metadata?.runtimeCapability ||
        metadata.runtimeCapability.length < 32 ||
        !metadata.writerEpoch ||
        !UUID_PATTERN.test(metadata.writerEpoch))
    ) {
      throw new Error('postgres_worker_runtime_identity_incomplete');
    }
    if (
      requiresWorkerDatabaseAccess &&
      !resolveWorkerDatabaseUrlFromDiscreteConfiguration()
    ) {
      throw new Error('postgres_worker_database_url_missing');
    }
    if (
      requiresRuntimeWriterIdentity &&
      !metadata?.warmPoolId &&
      !options.beforeStart
    ) {
      throw new Error('whatsapp_worker_runtime_before_start_required');
    }
    if (
      !usesSessionVolume &&
      (options.requireExistingVolume === true ||
        sessionVolumeName !== undefined)
    ) {
      throw new Error('postgres_worker_must_not_use_session_volume');
    }
    const imageContentId = options.imageContentId
      ? await this.assertLocalImageContentId(options.imageContentId)
      : (await this.workerImageProvisionerService.ensureImage(imageName))
          .contentId;

    const volumeName = usesSessionVolume
      ? sessionVolumeName || workerId
      : undefined;
    const existingVolume = volumeName
      ? options.requireExistingVolume === true
        ? await this.existsVolumeByNameStrict(volumeName)
        : await this.existsVolumeByName(volumeName)
      : false;
    if (
      hasLegacyMigrationMount &&
      !(await this.existsVolumeByNameStrict(
        metadata?.legacySessionVolumeName as string
      ))
    ) {
      throw new Error('session_storage_migration_volume_missing');
    }

    if (
      volumeName &&
      options.requireExistingVolume === true &&
      !existingVolume
    ) {
      throw new Error(`Required worker session volume ${volumeName} not found`);
    }

    if (volumeName && (!existingVolume || isCreateVolume)) {
      await this.docker.createVolume({
        Name: volumeName,
      });

      const createdVolume = await this.existsVolumeByNameStrict(volumeName);
      if (!createdVolume) {
        throw new Error('Volume creation failed');
      }
    }

    const envOverrides = [`WORKER_ID=${workerId}`, `ACCOUNT_ID=${accountId}`];
    envOverrides.push(`WORKER_IMAGE=${imageName}`);
    envOverrides.push(`WORKER_SESSION_STORAGE=${sessionStorage}`);
    if (volumeName) {
      envOverrides.push(`SESSION_VOLUME_NAME=${volumeName}`);
    }
    if (hasLegacyMigrationMount) {
      envOverrides.push(
        `SESSION_STORAGE_MIGRATION_ID=${metadata?.sessionStorageMigrationId}`,
        `LEGACY_SESSION_VOLUME_NAME=${metadata?.legacySessionVolumeName}`,
        `LEGACY_SESSION_CHECKSUM_SHA256=${metadata?.legacySessionChecksum}`
      );
    }
    if (requiresRuntimeWriterIdentity) {
      envOverrides.push(
        `WORKER_RUNTIME_CAPABILITY=${metadata?.runtimeCapability ?? ''}`,
        `WORKER_WRITER_EPOCH=${metadata?.writerEpoch ?? ''}`
      );
    }

    if (metadata?.workerTypeId) {
      envOverrides.push(`WORKER_TYPE_ID=${metadata.workerTypeId}`);
    }

    if (metadata?.workerGrpcPort !== undefined) {
      envOverrides.push(`WORKER_GRPC_PORT=${metadata.workerGrpcPort}`);
    }

    if (metadata?.runtimeGeneration !== undefined) {
      envOverrides.push(`RUNTIME_GENERATION=${metadata.runtimeGeneration}`);
    }
    if (metadata?.warmPoolId) {
      envOverrides.push(
        'WARM_STANDBY=false',
        `WARM_POOL_ID=${metadata.warmPoolId}`
      );
    }

    if (
      metadata?.workerTypeId === EWorkerType.wwebjs &&
      usesSessionVolume &&
      grpcHost !== undefined &&
      grpcPort !== undefined
    ) {
      envOverrides.push(
        `BALANCER_GRPC_HOST=${grpcHost}`,
        `BALANCER_GRPC_PORT=${grpcPort}`
      );
    }

    if (proxy?.host && Number.isFinite(proxy.port)) {
      envOverrides.push(`PROXY_HOST=${proxy.host}`, `PROXY_PORT=${proxy.port}`);
      envOverrides.push(
        `PROXY_PROTOCOL=${proxy.protocol ?? EProxyProtocol.http}`
      );
      if (proxy.username) {
        envOverrides.push(`PROXY_USERNAME=${proxy.username}`);
      }
      if (proxy.password) {
        envOverrides.push(`PROXY_PASSWORD=${proxy.password}`);
      }
    }
    const resourcePolicy = resolveWorkerContainerResourcePolicy(imageName);
    if (!resourcePolicy && RESOURCE_MANAGED_WORKER_IMAGES.has(imageName)) {
      throw new Error('worker_container_resource_policy_required');
    }
    const labels = {
      ...this.buildContainerLabels({
        imageName,
        workerId,
        accountId,
        metadata: {
          ...metadata,
          proxyFingerprint: workerProxyFingerprint(proxy),
        },
        sessionVolumeName: volumeName,
      }),
      'underchat.worker_image_content_id': imageContentId,
      ...(resourcePolicy?.labels ?? {}),
    };
    const containerEnv = this.buildContainerEnv(envOverrides);

    const createAndStart = async (): Promise<string> => {
      /*
       * Keep admission, replacement and create/start in one serialized claim.
       * A rejected request leaves the serving container untouched, while a
       * concurrent request cannot spend the same physical headroom.
       */
      if (options.requireContainerNameAvailable === true) {
        const existingContainer =
          await this.inspectContainerWorkerByIdStrict(workerId);
        if (existingContainer.exists) {
          throw new Error(`Worker container name ${workerId} is not available`);
        }
      } else {
        const existingContainer =
          await this.inspectContainerWorkerByIdStrict(workerId);
        if (existingContainer.exists) {
          await this.removeContainerWorkerById(
            existingContainer.container_id as string
          );
        }
      }

      const container = await this.docker.createContainer({
        Image: imageContentId,
        name: workerId,
        StopTimeout: NODE_WORKER_CONTAINER_STOP_TIMEOUT_SECONDS,
        HostConfig: {
          /*
           * Every worker image ships one pinned tini entrypoint. Enabling
           * Docker's host-provided init as well would nest two init processes,
           * break the liveness PID contract and keep the image behavior
           * dependent on daemon packaging.
           */
          Init: false,
          ...(resourcePolicy?.hostConfig ?? {}),
          ...(volumeName || hasLegacyMigrationMount
            ? {
                Binds: [
                  ...(volumeName ? [`${volumeName}:/app/data:nocopy`] : []),
                  ...(hasLegacyMigrationMount
                    ? [
                        `${metadata?.legacySessionVolumeName}:/app/legacy-session:ro,nocopy`,
                      ]
                    : []),
                ],
              }
            : {}),
          NetworkMode: 'underchat',
          RestartPolicy: {
            Name: 'unless-stopped',
          },
        },
        ...(volumeName || hasLegacyMigrationMount
          ? {
              Volumes: {
                ...(volumeName ? { '/app/data': {} } : {}),
                ...(hasLegacyMigrationMount
                  ? { '/app/legacy-session': {} }
                  : {}),
              },
            }
          : {}),
        Env: containerEnv,
        Labels: labels,
      });

      try {
        await options.beforeStart?.(container.id);
      } catch (error) {
        /*
         * The callback failed before the process could observe any runtime
         * secret or session state. Remove only this immutable, still-stopped
         * container; session volumes and PostgreSQL data are deliberately
         * outside this compensation.
         */
        try {
          await container.remove({ force: true });
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            'worker_container_before_start_failed_and_cleanup_failed'
          );
        }
        throw error;
      }

      await container.start();

      return container.id;
    };

    if (!resourcePolicy) {
      return createAndStart();
    }
    return runWithWorkerContainerAdmission(
      this.docker,
      {
        image: imageName,
        profile: 'active',
        policy: resourcePolicy,
        ...(options.requireContainerNameAvailable === true
          ? {}
          : { replacingContainerName: workerId }),
      },
      createAndStart
    );
  }

  public async createWarmContainerWorker(input: {
    imageName: EWorkerImage;
    imageContentId: string;
    warmPoolId: string;
    serverId: string;
    workerTypeId: string;
    grpcHost?: string;
    grpcPort?: number;
    workerGrpcPort?: number;
    sessionStorage?: EWorkerSessionStorage;
    runtimeCapability: string;
    writerEpoch: string;
    proxy?: {
      protocol?: EProxyProtocol;
      host: string;
      port: number;
      username?: string | null;
      password?: string | null;
    };
  }): Promise<{
    container_id: string;
    container_name: string;
    session_volume_name: string;
  }> {
    this.resolveStaticWorkerNatsAuthentication();
    if (!/^sha256:[0-9a-f]{64}$/iu.test(input.imageContentId)) {
      throw new TypeError('imageContentId must be a canonical Docker image ID');
    }
    if (
      input.runtimeCapability.length < 32 ||
      !UUID_PATTERN.test(input.writerEpoch)
    ) {
      throw new Error('postgres_warm_worker_runtime_identity_incomplete');
    }
    const containerName = `warm-${input.warmPoolId}`;
    const sessionVolumeName = `warm-${input.warmPoolId}`;
    const sessionStorage =
      input.sessionStorage ?? EWorkerSessionStorage.postgres;
    const usesSessionVolume =
      sessionStorage === EWorkerSessionStorage.legacy_volume;
    if (
      isWhatsappWorkerType(input.workerTypeId) &&
      !resolveWorkerDatabaseUrlFromDiscreteConfiguration()
    ) {
      throw new Error('postgres_worker_database_url_missing');
    }
    const existing = await this.inspectContainerWorkerByIdStrict(containerName);
    if (existing.exists) {
      throw new Error('warm_container_already_exists');
    }

    const imageContentId = await this.assertLocalImageContentId(
      input.imageContentId
    );
    if (usesSessionVolume) {
      await this.checkVolumeNameAndCreate(sessionVolumeName, true, {
        'underchat.warm_pool_id': input.warmPoolId,
        'underchat.server_id': input.serverId,
        'underchat.worker_type_id': input.workerTypeId,
        'underchat.worker_image': input.imageName,
      });
    }

    const envOverrides = [
      'WARM_STANDBY=true',
      `WARM_POOL_ID=${input.warmPoolId}`,
      `WORKER_TYPE_ID=${input.workerTypeId}`,
      `WORKER_IMAGE=${input.imageName}`,
      `WORKER_SESSION_STORAGE=${sessionStorage}`,
      `WORKER_RUNTIME_CAPABILITY=${input.runtimeCapability}`,
      `WORKER_WRITER_EPOCH=${input.writerEpoch}`,
    ];
    if (usesSessionVolume) {
      envOverrides.push(`SESSION_VOLUME_NAME=${sessionVolumeName}`);
    }

    if (input.workerGrpcPort !== undefined) {
      envOverrides.push(`WORKER_GRPC_PORT=${input.workerGrpcPort}`);
    }

    if (
      input.workerTypeId === EWorkerType.wwebjs &&
      usesSessionVolume &&
      input.grpcHost !== undefined &&
      input.grpcPort !== undefined
    ) {
      envOverrides.push(
        `BALANCER_GRPC_HOST=${input.grpcHost}`,
        `BALANCER_GRPC_PORT=${input.grpcPort}`
      );
    }

    if (input.proxy?.host && Number.isFinite(input.proxy.port)) {
      envOverrides.push(
        `PROXY_HOST=${input.proxy.host}`,
        `PROXY_PORT=${input.proxy.port}`,
        `PROXY_PROTOCOL=${input.proxy.protocol ?? EProxyProtocol.http}`
      );
      if (input.proxy.username) {
        envOverrides.push(`PROXY_USERNAME=${input.proxy.username}`);
      }
      if (input.proxy.password) {
        envOverrides.push(`PROXY_PASSWORD=${input.proxy.password}`);
      }
    }

    /*
     * PostgreSQL warms are promoted in place by ActivateRuntime. They must
     * therefore be born with the serving ceiling: Docker labels and
     * OomScoreAdj are immutable, and leaving the bootstrap profile attached
     * makes Chromium (and eventually the socket workers under load) run with
     * standby resources after activation. Legacy-volume warms are replaced
     * during activation and can keep the smaller bootstrap boundary.
     */
    const resourceProfile = usesSessionVolume ? 'warm' : 'active';
    const resourcePolicy = resolveWorkerContainerResourcePolicy(
      input.imageName,
      resourceProfile
    );
    if (
      !resourcePolicy &&
      RESOURCE_MANAGED_WORKER_IMAGES.has(input.imageName)
    ) {
      throw new Error('worker_container_resource_policy_required');
    }
    const labels: Record<string, string> = {
      'underchat.warm_standby': 'true',
      'underchat.warm_pool_id': input.warmPoolId,
      'underchat.server_id': input.serverId,
      'underchat.worker_type_id': input.workerTypeId,
      'underchat.worker_image': input.imageName,
      'underchat.worker_image_content_id': imageContentId,
      'underchat.session_storage': sessionStorage,
      ...(usesSessionVolume
        ? { 'underchat.session_volume_name': sessionVolumeName }
        : {}),
      ...(input.workerGrpcPort !== undefined
        ? { 'underchat.worker_grpc_port': String(input.workerGrpcPort) }
        : {}),
      'underchat.proxy_mode': input.proxy ? 'proxy' : 'direct',
      'underchat.proxy_fingerprint': workerProxyFingerprint(input.proxy),
      ...(resourcePolicy?.labels ?? {}),
    };
    const containerEnv = this.buildContainerEnv(envOverrides);

    const createAndStart = async (): Promise<{
      container_id: string;
      container_name: string;
      session_volume_name: string;
    }> => {
      const existingContainer =
        await this.inspectContainerWorkerByIdStrict(containerName);
      if (existingContainer.exists) {
        throw new Error('warm_container_already_exists');
      }

      const container = await this.docker.createContainer({
        Image: imageContentId,
        name: containerName,
        StopTimeout: NODE_WORKER_CONTAINER_STOP_TIMEOUT_SECONDS,
        HostConfig: {
          // Every image owns exactly one pinned init/subreaper.
          Init: false,
          ...(resourcePolicy?.hostConfig ?? {}),
          ...(usesSessionVolume
            ? { Binds: [`${sessionVolumeName}:/app/data:nocopy`] }
            : {}),
          NetworkMode: 'underchat',
          RestartPolicy: {
            Name: 'unless-stopped',
          },
        },
        ...(usesSessionVolume ? { Volumes: { '/app/data': {} } } : {}),
        Env: containerEnv,
        Labels: labels,
      });

      await container.start();

      return {
        container_id: container.id,
        container_name: containerName,
        session_volume_name: usesSessionVolume ? sessionVolumeName : '',
      };
    };

    if (!resourcePolicy) {
      return createAndStart();
    }
    return runWithWorkerContainerAdmission(
      this.docker,
      {
        image: input.imageName,
        profile: resourceProfile,
        policy: resourcePolicy,
      },
      createAndStart
    );
  }

  public async existsImage(imageName: string): Promise<boolean> {
    try {
      const image = this.docker.getImage(imageName);

      await image.inspect();

      return true;
    } catch {
      return false;
    }
  }

  public async inspectImageContentId(imageName: string): Promise<string> {
    const inspection = (await this.docker.getImage(imageName).inspect()) as {
      Id?: string;
    };
    const imageId = inspection.Id?.trim().toLowerCase();
    if (!imageId || !/^sha256:[0-9a-f]{64}$/u.test(imageId)) {
      throw new Error('worker_image_content_id_invalid');
    }
    return imageId;
  }

  private async assertLocalImageContentId(
    expectedImageContentId: string
  ): Promise<string> {
    const expected = expectedImageContentId.trim().toLowerCase();
    let actual: string;
    try {
      actual = await this.inspectImageContentId(expected);
    } catch {
      throw new Error('worker_image_content_unavailable');
    }
    if (actual !== expected) {
      throw new Error('worker_image_content_fence_mismatch');
    }
    return expected;
  }

  public async ensureWorkerImageContentId(
    imageName: EWorkerImage
  ): Promise<string> {
    const provisioned =
      await this.workerImageProvisionerService.ensureImage(imageName);
    return provisioned.contentId;
  }

  public async listActiveWorkerImageDrifts(
    expectedContentIds: Readonly<Record<string, string>>,
    limit: number = 100
  ): Promise<ActiveWorkerImageDrift[]> {
    const serverId = process.env.SERVER_ID?.trim();
    if (!serverId) {
      throw new Error('worker_image_rollout_server_id_missing');
    }

    const boundedLimit = Math.max(
      1,
      Math.min(1_000, Math.floor(Number.isFinite(limit) ? limit : 100))
    );
    const containers = await this.docker.listContainers({
      all: false,
      filters: {
        label: ['underchat.worker_id'],
      },
    });
    const drifts: ActiveWorkerImageDrift[] = [];

    for (const container of containers) {
      const labels = container.Labels ?? {};
      const workerId = labels['underchat.worker_id']?.trim() ?? '';
      const accountId = labels['underchat.account_id']?.trim() ?? '';
      const containerId = container.Id?.trim().toLowerCase() ?? '';
      const alias = labels['underchat.worker_image'] as
        EWorkerImage | undefined;
      const expectedContentId = alias
        ? expectedContentIds[alias]?.trim().toLowerCase()
        : undefined;
      const currentContentId =
        (container as { ImageID?: string }).ImageID?.trim().toLowerCase() ?? '';
      const runtimeGeneration = Number(labels['underchat.runtime_generation']);

      if (
        labels['underchat.warm_standby'] === 'true' ||
        labels['underchat.server_id'] !== serverId ||
        !UUID_PATTERN.test(workerId) ||
        !UUID_PATTERN.test(accountId) ||
        !FULL_CONTAINER_ID_PATTERN.test(containerId) ||
        !alias ||
        !Object.values(EWorkerImage).includes(alias) ||
        !expectedContentId ||
        !CANONICAL_DOCKER_IMAGE_ID_PATTERN.test(expectedContentId) ||
        !CANONICAL_DOCKER_IMAGE_ID_PATTERN.test(currentContentId) ||
        !Number.isSafeInteger(runtimeGeneration) ||
        runtimeGeneration <= 0 ||
        currentContentId === expectedContentId
      ) {
        continue;
      }

      drifts.push({
        account_id: accountId,
        alias,
        container_id: containerId,
        current_content_id: currentContentId,
        expected_content_id: expectedContentId,
        runtime_generation: runtimeGeneration,
        server_id: serverId,
        worker_id: workerId,
      });
    }

    return drifts
      .sort((first, second) => first.worker_id.localeCompare(second.worker_id))
      .slice(0, boundedLimit);
  }

  /**
   * Finds serving WWebJS runtimes that predate the host-safety contract.
   *
   * This scanner deliberately accepts only the two legacy omissions observed
   * in production (`underchat.server_id` and lifecycle labels). Every other
   * Docker identity, runtime generation and session-volume proof must be
   * internally exact before the database fence is even consulted.
   */
  public async listActiveWwebjsRuntimeSafetyDrifts(
    expectedContentIdInput: string,
    limit: number = 100
  ): Promise<ActiveWwebjsRuntimeSafetyDrift[]> {
    const serverId = process.env.SERVER_ID?.trim();
    if (!serverId) {
      throw new Error('worker_wwebjs_safety_migration_server_id_missing');
    }
    const expectedContentId = expectedContentIdInput.trim().toLowerCase();
    if (!CANONICAL_DOCKER_IMAGE_ID_PATTERN.test(expectedContentId)) {
      throw new Error('worker_wwebjs_safety_migration_expected_image_invalid');
    }

    const boundedLimit = Math.max(
      1,
      Math.min(1_000, Math.floor(Number.isFinite(limit) ? limit : 100))
    );
    const containers = await this.docker.listContainers({
      all: false,
      filters: {
        label: ['underchat.worker_id'],
      },
    });
    const drifts: ActiveWwebjsRuntimeSafetyDrift[] = [];

    for (const container of containers) {
      const listedLabels = container.Labels ?? {};
      const listedContainerId = container.Id?.trim().toLowerCase() ?? '';
      if (
        listedLabels['underchat.worker_image'] !== EWorkerImage.wwebjs ||
        listedLabels['underchat.warm_standby'] === 'true' ||
        (listedLabels['underchat.server_id'] !== undefined &&
          listedLabels['underchat.server_id'] !== serverId) ||
        !FULL_CONTAINER_ID_PATTERN.test(listedContainerId)
      ) {
        continue;
      }

      const inspection =
        await this.inspectContainerWorkerByIdStrict(listedContainerId);
      const labels = inspection.container_labels ?? {};
      const env = inspection.container_env ?? {};
      const workerId = labels['underchat.worker_id']?.trim() ?? '';
      const accountId = labels['underchat.account_id']?.trim() ?? '';
      const currentContentId =
        inspection.container_image_id?.trim().toLowerCase() ?? '';
      const runtimeGeneration = Number(labels['underchat.runtime_generation']);
      const sessionVolumeName =
        labels['underchat.session_volume_name']?.trim() ?? '';
      const appDataMounts = (inspection.container_mounts ?? []).filter(
        (mount) => mount.destination === '/app/data'
      );
      const dockerIdentityMatches =
        inspection.exists === true &&
        inspection.running === true &&
        inspection.container_id?.trim().toLowerCase() === listedContainerId &&
        inspection.container_name === workerId &&
        inspection.container_image === EWorkerImage.wwebjs &&
        CANONICAL_DOCKER_IMAGE_ID_PATTERN.test(currentContentId) &&
        UUID_PATTERN.test(workerId) &&
        UUID_PATTERN.test(accountId) &&
        labels['underchat.worker_type_id'] === EWorkerType.wwebjs &&
        labels['underchat.worker_image'] === EWorkerImage.wwebjs &&
        (labels['underchat.server_id'] === undefined ||
          labels['underchat.server_id'] === serverId) &&
        labels['underchat.warm_standby'] !== 'true' &&
        Number.isSafeInteger(runtimeGeneration) &&
        runtimeGeneration > 0 &&
        env.WORKER_ID === workerId &&
        env.ACCOUNT_ID === accountId &&
        env.WORKER_TYPE_ID === EWorkerType.wwebjs &&
        env.WORKER_IMAGE === EWorkerImage.wwebjs &&
        env.RUNTIME_GENERATION === String(runtimeGeneration) &&
        sessionVolumeName.length > 0 &&
        env.SESSION_VOLUME_NAME === sessionVolumeName &&
        env.WARM_STANDBY !== 'true' &&
        appDataMounts.length === 1 &&
        appDataMounts[0].type === 'volume' &&
        appDataMounts[0].name === sessionVolumeName &&
        appDataMounts[0].read_write === true;
      if (!dockerIdentityMatches) {
        continue;
      }

      const safetyReasons = getWwebjsRuntimeSafetyReasons({
        currentContentId,
        entrypoint: inspection.container_entrypoint,
        expectedContentId,
        pidsLimit: inspection.container_pids_limit,
      });
      if (safetyReasons.length === 0) {
        continue;
      }

      drifts.push({
        account_id: accountId,
        alias: EWorkerImage.wwebjs,
        container_id: listedContainerId,
        current_content_id: currentContentId,
        expected_content_id: expectedContentId,
        runtime_generation: runtimeGeneration,
        safety_reasons: safetyReasons,
        server_id: serverId,
        worker_id: workerId,
      });
    }

    return drifts
      .sort((first, second) => first.worker_id.localeCompare(second.worker_id))
      .slice(0, boundedLimit);
  }

  public async removeContainerWorker(
    workerId: string,
    isRemoveVolume: boolean = true
  ): Promise<boolean> {
    const existsContainerById = await this.existsContainerWorkerById(workerId);

    if (existsContainerById) {
      const removeContainerWorkerById =
        await this.removeContainerWorkerById(workerId);

      if (!removeContainerWorkerById) {
        throw new Error('The worker removal failed');
      }
    }

    if (isRemoveVolume) {
      const removeVolumeWorkerById =
        await this.removeVolumeWorkerById(workerId);

      if (!removeVolumeWorkerById) {
        throw new Error('The worker volume removal failed');
      }
    }

    return true;
  }

  public async cleanupContainerWorker(
    workerId: string,
    isRemoveVolume: boolean = true
  ): Promise<boolean> {
    const existsContainerById = await this.existsContainerWorkerById(workerId);

    if (existsContainerById) {
      const removeContainerWorkerById =
        await this.removeContainerWorkerById(workerId);

      if (!removeContainerWorkerById) {
        throw new Error('The worker removal failed');
      }
    }

    if (isRemoveVolume) {
      const existsVolumeById = await this.existsVolumeWorkerById(workerId);

      if (existsVolumeById) {
        const removeVolumeWorkerById =
          await this.removeVolumeWorkerById(workerId);

        if (!removeVolumeWorkerById) {
          throw new Error('The worker volume removal failed');
        }
      }
    }

    return true;
  }

  public async createWorker(input: ICreateWorker): Promise<boolean> {
    return this.workerCreatorRepository.createWorker(input);
  }

  public async listWorkerServers(): Promise<IListWorkerServer[]> {
    return this.workerServerListerRepository.listWorkerServers();
  }

  public async viewWorkerServer(
    accountId: string
  ): Promise<IViewWorkerServer | null> {
    return this.workerServerViewerRepository.viewWorkerServer(accountId);
  }

  public async totalWorkerByAccountId(accountId: string): Promise<number> {
    return this.workerTotalViewerRepository.totalWorkerByAccountId(accountId);
  }

  listWorker = async (
    accountId: string,
    perPage: number,
    currentPage: number,
    query: ListWorkerRequest
  ): Promise<[ListWorkerResponse[], number]> => {
    const [result, total] = await Promise.all([
      this.workerListerRepository.listWorker(
        accountId,
        perPage,
        currentPage,
        query
      ),
      this.workerListerRepository.listWorkerTotal(accountId, query),
    ]);

    return [result, total];
  };

  updateWorkerById = async (
    accountId: string,
    input: IUpdateWorker
  ): Promise<boolean> => {
    return this.workerUpdaterRepository.updateWorkerById(accountId, input);
  };

  updateWorkerByIdIfLifecycleMatches = async (
    accountId: string,
    input: IUpdateWorker,
    guard: WorkerLifecycleUpdateGuard
  ): Promise<boolean> => {
    return this.workerUpdaterRepository.updateWorkerByIdIfLifecycleMatches(
      accountId,
      input,
      guard
    );
  };

  updateWorkerByIdIfRecreateAvailable = async (
    accountId: string,
    input: IUpdateWorker,
    now: string,
    guard?: WorkerLifecycleUpdateGuard
  ): Promise<boolean> => {
    return this.workerUpdaterRepository.updateWorkerByIdIfRecreateAvailable(
      accountId,
      input,
      now,
      guard
    );
  };

  viewWorker = async (
    accountId: string,
    workerId: string
  ): Promise<ViewWorkerResponse | null> => {
    return this.workerViewerRepository.viewWorker(accountId, workerId);
  };

  viewWorkerNameAndContainerId = async (
    accountId: string,
    workerId: string
  ): Promise<IViewWorkerNameAndContainerId | null> => {
    return this.workerNameAndContainerIdViewerRepository.viewWorkerNameAndContainerId(
      accountId,
      workerId
    );
  };

  existsWorkerById = async (
    accountId: string,
    workerId: string
  ): Promise<boolean> => {
    return this.workerViewerExistsRepository.existsWorkerById(
      accountId,
      workerId
    );
  };

  viewWorkerBalancer = async (
    accountId: string,
    workerId: string
  ): Promise<IViewWorkerServer | null> => {
    return this.workerBalancerViewerRepository.viewWorkerBalancer(
      accountId,
      workerId
    );
  };

  viewWorkerLifecycleServer = async (
    accountId: string,
    workerId: string
  ): Promise<IViewWorkerLifecycleServer | null> => {
    return this.workerBalancerViewerRepository.viewWorkerLifecycleServer(
      accountId,
      workerId
    );
  };

  deleteWorkerById = async (
    accountId: string,
    workerId: string,
    options?: WorkerDeletionOptions
  ): Promise<boolean> => {
    const runtimeFence = new WhatsappRuntimeFenceService(this.redis);
    if (options?.lifecycleOperationId) {
      await runtimeFence.revokeForDeletion(
        workerId,
        accountId,
        options.lifecycleOperationId
      );
      await runtimeFence.assertDeletionRevoked(
        workerId,
        accountId,
        options.lifecycleOperationId
      );
    } else {
      await runtimeFence.revoke(workerId);
      await runtimeFence.assertRevoked(workerId);
    }

    const deleted = options
      ? await this.workerDeleterRepository.deleteWorkerById(
          accountId,
          workerId,
          options
        )
      : await this.workerDeleterRepository.deleteWorkerById(
          accountId,
          workerId
        );

    return deleted;
  };

  viewWorkerPhoneConnectionDate = async (
    workerId: string
  ): Promise<IViewWorkerPhoneConnectionDate | null> => {
    return this.workerPhoneConnectionDateViewerRepository.viewWorkerPhoneConnectionDate(
      workerId
    );
  };

  updateWorkerPhoneStatusConnectionDate = async (
    input: IUpdateWorkerPhoneStatusConnectionDate
  ): Promise<boolean> => {
    return this.workerPhoneStatusConnectionDateUpdaterRepository.updateWorkerPhoneStatusConnectionDate(
      input
    );
  };

  viewWorkerPhoneConnection = async (
    number: string
  ): Promise<IViewWorkerPhoneConnection | null> => {
    return this.workerPhoneConnectionViewerRepository.viewWorkerPhoneConnection(
      number
    );
  };

  totalWorkerPhoneConnection = async (number: string): Promise<number> => {
    return this.workerPhoneConnectionViewerRepository.totalWorkerPhoneConnection(
      number
    );
  };

  updateWorkerPhoneConnection = async (
    input: IUpdateWorkerPhoneConnection
  ): Promise<boolean> => {
    return this.workerPhoneConnectionUpdaterRepository.updateWorkerPhoneConnection(
      input
    );
  };

  createWorkerPhoneConnection = async (
    input: ICreateWorkerPhoneConnection
  ): Promise<boolean> => {
    return this.workerPhoneConnectionCreatorRepository.createWorkerPhoneConnection(
      input
    );
  };

  viewWorkerType = async (
    accountId: string,
    workerId: string
  ): Promise<IViewWorkerType | null> => {
    return this.workerTypeViewerRepository.viewWorkerType(accountId, workerId);
  };

  listWorkerBaileysActivities = async (): Promise<IListWorkerActivities[]> => {
    return this.workerBaileysActivitiesListerRepository.listWorkerBaileysActivities();
  };

  listWorkerNewStatus = async (): Promise<IListWorkerActivities[]> => {
    return this.workerNewStatusListerRepository.listWorkerNewStatus();
  };

  updateStatusWorker = async (
    workerId: string,
    workerStatusId: EWorkerStatus
  ): Promise<boolean> => {
    return this.workerStatusUpdaterRepository.updateStatusWorker(
      workerId,
      workerStatusId
    );
  };

  viewWorkerNameAndId = async (
    accountId: string,
    workerId: string
  ): Promise<IViewWorkerNameAndId | null> => {
    return this.workerNameAndIdViewerRepository.viewWorkerNameAndId(
      accountId,
      workerId
    );
  };

  viewWorkerNameAndIdConsistent = async (
    accountId: string,
    workerId: string
  ): Promise<IViewWorkerNameAndId | null> => {
    return this.workerNameAndIdViewerRepository.viewWorkerNameAndIdConsistent(
      accountId,
      workerId
    );
  };

  viewWorkerConfigFieldsByWorkerId = async (
    workerId: string
  ): Promise<IWorkerConfigFields | null> => {
    const cacheKey = `worker:${workerId}:config_fields`;

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as IWorkerConfigFields;
      } catch {
        await this.redis.del(cacheKey);
      }
    }

    const result =
      await this.workerConfigFieldsViewerRepository.viewWorkerConfigFieldsByWorkerId(
        workerId
      );

    if (result) {
      await this.redis.set(cacheKey, JSON.stringify(result), 'EX', 60 * 60 * 8);
    }

    return result;
  };

  listAllWorkers = async (accountId: string): Promise<TransferWorker[]> => {
    return this.workerAllListerRepository.listAllWorkers(accountId);
  };

  listWorkersForMonitor = async (): Promise<IWorkerMonitor[]> => {
    return this.workerMonitorViewerRepository.listWorkers();
  };

  listLivenessLifecycleRedriveCandidates = async (
    limit = 100,
    afterWorkerId?: string
  ): Promise<IWorkerMonitor[]> => {
    return this.workerMonitorViewerRepository.listLivenessLifecycleRedriveCandidates(
      limit,
      afterWorkerId
    );
  };

  listMissingRuntimeRecoveryCandidates = async (
    limit = 250,
    afterWorkerId?: string
  ): Promise<IWorkerMonitor[]> => {
    return this.workerMonitorViewerRepository.listMissingRuntimeRecoveryCandidates(
      limit,
      afterWorkerId
    );
  };

  viewWorkerForMonitor = async (
    workerId: string
  ): Promise<IWorkerMonitor | null> => {
    return this.workerMonitorViewerRepository.viewWorker(workerId);
  };

  viewWorkerForMonitorConsistent = async (
    workerId: string
  ): Promise<IWorkerMonitor | null> => {
    return this.workerMonitorViewerRepository.viewWorkerConsistent(workerId);
  };

  failStaleWhatsappProviderHandoffTarget = async (input: {
    worker_id: string;
    account_id: string;
    lifecycle_operation_id: string;
  }) => {
    if (
      typeof this.workerRuntimeRepository
        ?.failStaleWhatsappProviderHandoffTarget !== 'function'
    ) {
      throw new Error(
        'stale_whatsapp_handoff_reconciliation_repository_unavailable'
      );
    }
    return this.workerRuntimeRepository.failStaleWhatsappProviderHandoffTarget(
      input
    );
  };

  viewWhatsappProviderHandoffTerminalLifecycleProof = async (input: {
    worker_id: string;
    account_id: string;
    lifecycle_operation_id: string;
  }) => {
    if (
      typeof this.workerRuntimeRepository
        ?.viewWhatsappProviderHandoffTerminalLifecycleProof !== 'function'
    ) {
      throw new Error(
        'whatsapp_handoff_terminal_lifecycle_repository_unavailable'
      );
    }
    return this.workerRuntimeRepository.viewWhatsappProviderHandoffTerminalLifecycleProof(
      input
    );
  };

  updateWorkerUpdatedAt = async (workerId: string): Promise<boolean> => {
    return this.workerUpdatedAtUpdaterRepository.updateUpdatedAt(workerId);
  };

  updateWorkerLastConnectionCheckAt = async (
    workerId: string
  ): Promise<boolean> => {
    return this.workerLastConnectionCheckUpdaterRepository.updateLastConnectionCheckAt(
      workerId
    );
  };
}
