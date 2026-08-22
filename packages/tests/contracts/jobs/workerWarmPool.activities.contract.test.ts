import 'reflect-metadata';

jest.mock('uuid', () => ({
  v7: jest.fn(() => 'uuid-v7'),
}));
jest.mock('@core/repositories/worker/WorkerServerLister.repository', () => ({
  WorkerServerListerRepository: class WorkerServerListerRepository {},
}));
jest.mock('@core/repositories/worker/WorkerWarmPool.repository', () => ({
  WorkerWarmPoolRepository: class WorkerWarmPoolRepository {},
}));
jest.mock('@core/services/workerWarmPoolQueue.service', () => ({
  WorkerWarmPoolQueueService: class WorkerWarmPoolQueueService {},
}));
jest.mock('@core/services/workerLifecycleQueue.service', () => ({
  WorkerLifecycleQueueService: class WorkerLifecycleQueueService {},
}));
jest.mock('@core/services/workerLifecycleLock.service', () => ({
  WorkerLifecycleLockService: class WorkerLifecycleLockService {},
}));
jest.mock('@core/services/ssh.service', () => ({
  SshService: class SshService {},
}));
jest.mock('@core/services/passwordEncryptor.service', () => ({
  PasswordEncryptorService: class PasswordEncryptorService {},
}));
jest.mock('@core/services/workerGrpcClient.service', () => ({
  WorkerGrpcClientService: class WorkerGrpcClientService {},
}));

import { WorkerWarmPoolActivity } from '@core/jobs/activities/workerWarmPool.activities';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerWarmPoolState } from '@core/common/enums/EWorkerWarmPoolState';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { EServerStatus } from '@core/common/enums/EServerStatus';
import { IBalanceMonitorServer } from '@core/common/interfaces/IBalanceMonitorServer';
import { IWorkerWarmPool } from '@core/common/interfaces/IWorkerWarmPool';
import { IWorkerWarmPoolSettings } from '@core/common/interfaces/IWorkerWarmPoolSettings';
import { IWorkerLifecycleQueueMessage } from '@core/common/interfaces/IWorkerLifecycleQueueMessage';
import type {
  AdoptedWarmRuntimeIdentity,
  StaleActivatingWarmPoolContext,
} from '@core/repositories/worker/WorkerWarmPool.repository';
import { getImageWorker } from '@core/common/functions/getImageWorker';

const ORPHAN_WARM_POOL_ID = '019f6f00-0000-7000-8000-000000000001';
const STALE_WARM_POOL_ID = '019f6f00-0000-7000-8000-000000000011';
const STALE_WORKER_ID = '019f6f00-0000-7000-8000-000000000012';
const STALE_ACCOUNT_ID = '019f6f00-0000-7000-8000-000000000013';
const STALE_SOURCE_CONTAINER_ID = 'a'.repeat(64);
const ORPHAN_CONTAINER_ID = 'd'.repeat(64);
const BAILEYS_IMAGE_ID = `sha256:${'1'.repeat(64)}`;
const ADOPTED_WORKER_ID = '019f6f00-0000-7000-8000-000000000021';
const ADOPTED_ACCOUNT_ID = '019f6f00-0000-7000-8000-000000000022';
const ADOPTED_OPERATION_ID = '019f6f00-0000-7000-8000-000000000023';

function expectedWarmImageSnapshot(
  baileysImageId: string = BAILEYS_IMAGE_ID
): string {
  return [
    `${EWorkerType.baileys}|under-worker-baileys:latest|${baileysImageId}`,
    `${EWorkerType.wwebjs}|under-worker-wwebjs:latest|sha256:${'2'.repeat(64)}`,
    `${EWorkerType.whatsmeow}|under-worker-whatsmeow:latest|sha256:${'3'.repeat(64)}`,
  ].join('\n');
}

function exactHealthyWarmContainer(input: {
  warmPoolId: string;
  containerId: string;
  imageId?: string;
  imageName?: string;
  workerTypeId?: EWorkerType;
  state?: string;
  health?: string;
  paused?: boolean;
  restartCount?: number;
  startedAt?: string;
  createdAt?: string;
  sessionStorage?: EWorkerSessionStorage;
}): string {
  const workerTypeId = input.workerTypeId ?? EWorkerType.baileys;
  const defaultImageId =
    workerTypeId === EWorkerType.baileys
      ? BAILEYS_IMAGE_ID
      : workerTypeId === EWorkerType.wwebjs
        ? `sha256:${'2'.repeat(64)}`
        : `sha256:${'3'.repeat(64)}`;
  const sessionStorage =
    input.sessionStorage ?? EWorkerSessionStorage.legacy_volume;
  const sessionVolumeName =
    sessionStorage === EWorkerSessionStorage.legacy_volume
      ? `warm-${input.warmPoolId}`
      : '';
  return [
    input.containerId,
    `/warm-${input.warmPoolId}`,
    input.state ?? 'running',
    input.health ?? 'healthy',
    'true',
    input.warmPoolId,
    workerTypeId,
    input.startedAt ?? '2026-07-30T11:00:00.000Z',
    String(input.restartCount ?? 0),
    String(input.paused ?? false),
    'server-1',
    sessionVolumeName,
    '',
    '',
    '',
    input.imageId ?? defaultImageId,
    input.imageName ?? getImageWorker(workerTypeId),
    '',
    sessionVolumeName,
    '',
    input.createdAt ?? '2026-07-30T10:59:00.000Z',
    sessionStorage,
  ].join('|');
}

function exactAdoptedWarmContainer(input: {
  warmPoolId: string;
  containerId: string;
  workerTypeId?: EWorkerType;
  workerId?: string;
  accountId?: string;
  operationId?: string;
  runtimeGeneration?: number | null;
  sessionVolumeName?: string;
  createdAt?: string;
  sessionStorage?: EWorkerSessionStorage;
}): string {
  const workerTypeId = input.workerTypeId ?? EWorkerType.baileys;
  const workerId = input.workerId ?? ADOPTED_WORKER_ID;
  const accountId = input.accountId ?? ADOPTED_ACCOUNT_ID;
  const operationId = input.operationId ?? ADOPTED_OPERATION_ID;
  const sessionStorage =
    input.sessionStorage ?? EWorkerSessionStorage.legacy_volume;
  const sessionVolumeName =
    input.sessionVolumeName ??
    (sessionStorage === EWorkerSessionStorage.legacy_volume
      ? `warm-${input.warmPoolId}`
      : '');
  const imageId =
    workerTypeId === EWorkerType.baileys
      ? BAILEYS_IMAGE_ID
      : workerTypeId === EWorkerType.wwebjs
        ? `sha256:${'2'.repeat(64)}`
        : `sha256:${'3'.repeat(64)}`;

  return [
    input.containerId,
    `/${workerId}`,
    'running',
    'healthy',
    'false',
    input.warmPoolId,
    workerTypeId,
    '2026-07-30T11:00:00.000Z',
    '0',
    'false',
    'server-1',
    sessionVolumeName,
    workerId,
    accountId,
    operationId,
    imageId,
    getImageWorker(workerTypeId),
    imageId,
    sessionVolumeName,
    input.runtimeGeneration === null
      ? ''
      : String(input.runtimeGeneration ?? 7),
    input.createdAt ?? '2026-07-30T10:59:00.000Z',
    sessionStorage,
  ].join('|');
}

function exactLegacyAdoptedWarmContainer(input: {
  warmPoolId: string;
  containerId: string;
  workerId: string;
  workerTypeId?: EWorkerType;
  dockerWorkerId?: string;
  dockerAccountId?: string;
  dockerOperationId?: string;
  dockerRuntimeGeneration?: number;
  sessionVolumeName?: string;
  createdAt?: string;
}): string {
  const workerTypeId = input.workerTypeId ?? EWorkerType.baileys;
  const sessionVolumeName =
    input.sessionVolumeName ?? `warm-${input.warmPoolId}`;
  const imageId =
    workerTypeId === EWorkerType.baileys
      ? BAILEYS_IMAGE_ID
      : workerTypeId === EWorkerType.wwebjs
        ? `sha256:${'2'.repeat(64)}`
        : `sha256:${'3'.repeat(64)}`;

  return [
    input.containerId,
    `/${input.workerId}`,
    'running',
    'healthy',
    'true',
    input.warmPoolId,
    workerTypeId,
    '2026-07-30T11:00:00.000Z',
    '0',
    'false',
    'server-1',
    sessionVolumeName,
    input.dockerWorkerId ?? '',
    input.dockerAccountId ?? '',
    input.dockerOperationId ?? '',
    imageId,
    getImageWorker(workerTypeId),
    imageId,
    sessionVolumeName,
    input.dockerRuntimeGeneration ? String(input.dockerRuntimeGeneration) : '',
    input.createdAt ?? '2026-07-30T10:59:00.000Z',
    EWorkerSessionStorage.legacy_volume,
  ].join('|');
}

function adoptedRuntimeIdentity(input: {
  warmPoolId: string;
  containerId: string;
  workerTypeId?: EWorkerType;
  workerId?: string;
  accountId?: string;
  operationId?: string | null;
  runtimeGeneration?: number;
  sessionVolumeName?: string;
  workerStatusId?: EWorkerStatus;
  sessionStorage?: EWorkerSessionStorage;
}): AdoptedWarmRuntimeIdentity {
  const workerId = input.workerId ?? ADOPTED_WORKER_ID;
  return {
    worker_id: workerId,
    account_id: input.accountId ?? ADOPTED_ACCOUNT_ID,
    server_id: 'server-1',
    worker_type_id: input.workerTypeId ?? EWorkerType.baileys,
    worker_status_id: input.workerStatusId ?? EWorkerStatus.online,
    worker_container_id: input.containerId,
    lifecycle_operation_id: input.operationId ?? null,
    runtime_container_id: input.containerId,
    runtime_container_name: workerId,
    session_storage:
      input.sessionStorage ?? EWorkerSessionStorage.legacy_volume,
    session_volume_name:
      input.sessionVolumeName ??
      (input.sessionStorage === EWorkerSessionStorage.postgres
        ? null
        : `warm-${input.warmPoolId}`),
    runtime_generation: input.runtimeGeneration ?? 7,
    warm_pool_id: input.warmPoolId,
  };
}

function makeServer(): IBalanceMonitorServer {
  return {
    server_id: 'server-1',
    server_status_id: 'online',
    ssh_ip: '127.0.0.1',
    ssh_port: 22,
    ssh_username: 'encrypted-root',
    ssh_password: 'encrypted-password',
    web_domain: null,
    web_port: 80,
    web_protocol: 'http',
  };
}

function makeWarmPool(
  overrides: Partial<IWorkerWarmPool> = {}
): IWorkerWarmPool {
  return {
    warm_pool_id: 'warm-1',
    server_id: 'server-1',
    worker_type_id: EWorkerType.baileys,
    container_id: 'container-1',
    container_name: 'warm-warm-1',
    session_storage: EWorkerSessionStorage.legacy_volume,
    session_volume_name: 'warm-warm-1',
    runtime_generation: 1,
    state: EWorkerWarmPoolState.ready,
    reserved_by_worker_id: null,
    reservation_expires_at: null,
    last_health_at: new Date().toISOString(),
    last_error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeSettings(
  overrides: Partial<IWorkerWarmPoolSettings> = {}
): IWorkerWarmPoolSettings {
  return {
    settings_id: 'default',
    warmup_enabled: true,
    target_ready_baileys: 2,
    target_ready_wwebjs: 2,
    target_ready_whatsmeow: 2,
    scan_interval_seconds: 30,
    reservation_ttl_seconds: 90,
    warming_stale_after_seconds: 180,
    created_at: '2026-06-05T12:00:00.000Z',
    updated_at: '2026-06-05T12:00:00.000Z',
    ...overrides,
  };
}

function repeatedWorkerTypes(
  ...slots: Array<[workerTypeId: EWorkerType, count: number]>
): EWorkerType[] {
  return slots.flatMap(([workerTypeId, count]) =>
    Array.from({ length: count }, () => workerTypeId)
  );
}

function makeStaleActivatingContext(
  overrides: Partial<StaleActivatingWarmPoolContext> = {}
): StaleActivatingWarmPoolContext {
  const entry = makeWarmPool({
    warm_pool_id: STALE_WARM_POOL_ID,
    container_id: STALE_SOURCE_CONTAINER_ID,
    container_name: `warm-${STALE_WARM_POOL_ID}`,
    session_volume_name: `warm-${STALE_WARM_POOL_ID}`,
    state: EWorkerWarmPoolState.activating,
    reserved_by_worker_id: STALE_WORKER_ID,
    reservation_expires_at: '2026-07-30T10:00:00.000Z',
    created_at: '2026-07-30T09:00:00.000Z',
    updated_at: '2026-07-30T09:01:00.000Z',
  });
  return {
    entry,
    owner: {
      worker_id: STALE_WORKER_ID,
      account_id: STALE_ACCOUNT_ID,
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: 'superseding-operation',
      updated_at: '2026-07-30T09:02:00.000Z',
      deleted_at: null,
    },
    ...overrides,
  };
}

function makePreparedLifecycleMessage(
  overrides: Partial<IWorkerLifecycleQueueMessage> = {}
): IWorkerLifecycleQueueMessage {
  return {
    request_id: 'request-1',
    operation_id: 'superseding-operation',
    action: 'recreate',
    worker_id: STALE_WORKER_ID,
    account_id: STALE_ACCOUNT_ID,
    server_id: 'server-1',
    worker_type_id: EWorkerType.baileys,
    worker_status_id: EWorkerStatus.recreating,
    source: 'worker_recreate',
    requested_at: '2026-07-30T09:03:00.000Z',
    ...overrides,
  };
}

function makeActivity(
  overrides: {
    activeEntries?: IWorkerWarmPool[];
    physicalOwnershipIds?: string[];
    capacityOwnershipIds?: string[];
    dockerOutput?: string;
    dockerExactOutput?: string;
    activeCounts?: Partial<Record<EWorkerType, number>>;
    readyExcessEntries?: Partial<Record<EWorkerType, IWorkerWarmPool[]>>;
    tombstonedDecommissionedServerEntries?: number;
    deletingRuntimeLineageIds?: string[];
    staleDeletingEntries?: IWorkerWarmPool[];
    terminalErrorEntries?: IWorkerWarmPool[];
    staleAssignedEntries?: IWorkerWarmPool[];
    runtimeReferenceActive?: boolean;
    adoptedRuntimeIdentities?: AdoptedWarmRuntimeIdentity[];
    dockerOrphanClaimed?: boolean;
    missingRuntimeClaimed?: boolean;
    startingRuntimeMarker?: string | null;
    publishDeleteReject?: boolean;
    settings?: Partial<IWorkerWarmPoolSettings>;
    shouldRunScan?: boolean;
    servers?: IBalanceMonitorServer[];
    eligibleServers?: IBalanceMonitorServer[];
    reconcileServers?: IBalanceMonitorServer[];
    staleActivatingContexts?: StaleActivatingWarmPoolContext[];
    refreshedStaleActivatingContext?: StaleActivatingWarmPoolContext | null;
    preparedLifecycleMessages?: IWorkerLifecycleQueueMessage[];
    staleActivatingClaim?: IWorkerWarmPool | null;
    lifecycleLockReject?: boolean;
    runtimeHealthResponse?: Record<string, unknown>;
    runtimeHealthReject?: boolean;
    unpersistedWarmingClaim?: IWorkerWarmPool | null;
  } = {}
): {
  activity: WorkerWarmPoolActivity;
  workerWarmPoolRepository: {
    releaseExpiredReservations: jest.Mock;
    tombstoneUnreferencedDecommissionedServerEntries: jest.Mock;
    listActiveByServer: jest.Mock;
    listPhysicalOwnershipIdsByServer: jest.Mock;
    listCapacityOwnershipIdsByServer: jest.Mock;
    countAvailableByServerAndType: jest.Mock;
    markReadyExcessAsDeleting: jest.Mock;
    claimStaleDeletingForRetry: jest.Mock;
    listDeletingRuntimeLineageIds: jest.Mock;
    reconcileDeletingRuntimeLineage: jest.Mock;
    claimErrorsForCleanup: jest.Mock;
    deleteUnreferencedAssignedForCleanup: jest.Mock;
    claimMissingRuntimeForCleanup: jest.Mock;
    observeStartingRuntime: jest.Mock;
    confirmHealthyReadyRuntime: jest.Mock;
    invalidateReadyRuntimeHealth: jest.Mock;
    isRuntimeReferenceActive: jest.Mock;
    listAdoptedRuntimeIdentitiesByServer: jest.Mock;
    viewByIdConsistent: jest.Mock;
    claimDockerOrphanForCleanup: jest.Mock;
    claimUnpersistedWarmingRuntimeForCleanup: jest.Mock;
    restoreDeletingToReady: jest.Mock;
    listStaleActivatingForReconcile: jest.Mock;
    viewStaleActivatingForReconcile: jest.Mock;
    claimStaleActivatingForCleanup: jest.Mock;
  };
  workerWarmPoolQueueService: {
    ensure: jest.Mock;
    publishReplenish: jest.Mock;
    publishDelete: jest.Mock;
  };
  workerWarmPoolSettingsService: {
    view: jest.Mock;
    shouldRunScan: jest.Mock;
  };
  workerLifecycleQueueService: { loadPrepared: jest.Mock };
  workerLifecycleLockService: { withLock: jest.Mock };
  sshService: { runCommands: jest.Mock };
  workerGrpcClientService: { runtimeHealth: jest.Mock };
} {
  const workerServerListerRepository = {
    listWarmPoolEligibleBalanceServers: jest.fn(
      async () =>
        overrides.eligibleServers ?? overrides.servers ?? [makeServer()]
    ),
    listWarmPoolReconcileBalanceServers: jest.fn(
      async () =>
        overrides.reconcileServers ?? overrides.servers ?? [makeServer()]
    ),
  };
  const workerWarmPoolRepository = {
    releaseExpiredReservations: jest.fn(async () => 0),
    tombstoneUnreferencedDecommissionedServerEntries: jest.fn(
      async () => overrides.tombstonedDecommissionedServerEntries ?? 0
    ),
    listActiveByServer: jest.fn(async () => overrides.activeEntries ?? []),
    listPhysicalOwnershipIdsByServer: jest.fn(
      async () =>
        overrides.physicalOwnershipIds ??
        (overrides.activeEntries ?? []).map((entry) => entry.warm_pool_id)
    ),
    listCapacityOwnershipIdsByServer: jest.fn(
      async () =>
        overrides.capacityOwnershipIds ??
        (overrides.activeEntries ?? []).map((entry) => entry.warm_pool_id)
    ),
    countAvailableByServerAndType: jest.fn(
      async (_serverId: string, workerTypeId: EWorkerType) =>
        overrides.activeCounts?.[workerTypeId] ?? 2
    ),
    markReadyExcessAsDeleting: jest.fn(
      async (input: { workerTypeId: EWorkerType }) =>
        overrides.readyExcessEntries?.[input.workerTypeId] ?? []
    ),
    claimStaleDeletingForRetry: jest.fn(
      async () => overrides.staleDeletingEntries ?? []
    ),
    listDeletingRuntimeLineageIds: jest.fn(
      async () => overrides.deletingRuntimeLineageIds ?? []
    ),
    reconcileDeletingRuntimeLineage: jest.fn(async () => true),
    claimErrorsForCleanup: jest.fn(
      async () => overrides.terminalErrorEntries ?? []
    ),
    deleteUnreferencedAssignedForCleanup: jest.fn(
      async () => overrides.staleAssignedEntries ?? []
    ),
    claimMissingRuntimeForCleanup: jest.fn(
      async () => overrides.missingRuntimeClaimed ?? true
    ),
    observeStartingRuntime: jest.fn(async () =>
      'startingRuntimeMarker' in overrides
        ? (overrides.startingRuntimeMarker ?? null)
        : `warm_runtime_starting:${Date.now()}:0`
    ),
    confirmHealthyReadyRuntime: jest.fn(async () => true),
    invalidateReadyRuntimeHealth: jest.fn(async () => true),
    isRuntimeReferenceActive: jest.fn(
      async () => overrides.runtimeReferenceActive ?? false
    ),
    listAdoptedRuntimeIdentitiesByServer: jest.fn(
      async () => overrides.adoptedRuntimeIdentities ?? []
    ),
    viewByIdConsistent: jest.fn(
      async (warmPoolId: string) =>
        (overrides.activeEntries ?? []).find(
          (entry) => entry.warm_pool_id === warmPoolId
        ) ?? null
    ),
    claimDockerOrphanForCleanup: jest.fn(
      async () => overrides.dockerOrphanClaimed ?? true
    ),
    claimUnpersistedWarmingRuntimeForCleanup: jest.fn(
      async () => overrides.unpersistedWarmingClaim ?? null
    ),
    restoreDeletingToReady: jest.fn(async () => true),
    listStaleActivatingForReconcile: jest.fn(
      async () => overrides.staleActivatingContexts ?? []
    ),
    viewStaleActivatingForReconcile: jest.fn(async () => {
      if ('refreshedStaleActivatingContext' in overrides) {
        return overrides.refreshedStaleActivatingContext ?? null;
      }
      return overrides.staleActivatingContexts?.[0] ?? null;
    }),
    claimStaleActivatingForCleanup: jest.fn(
      async (input: {
        cleanupContainerId: string;
        cleanupContainerName: string;
        lastError: string;
      }) => {
        if ('staleActivatingClaim' in overrides) {
          return overrides.staleActivatingClaim ?? null;
        }
        const context = overrides.staleActivatingContexts?.[0];
        return context
          ? {
              ...context.entry,
              state: EWorkerWarmPoolState.deleting,
              container_id: input.cleanupContainerId,
              container_name: input.cleanupContainerName,
              last_error: input.lastError,
            }
          : null;
      }
    ),
  };
  const workerWarmPoolQueueService = {
    ensure: jest.fn(async () => undefined),
    publishReplenish: jest.fn(async () => undefined),
    publishDelete: jest.fn(async () => {
      if (overrides.publishDeleteReject) {
        throw new Error('publish failed');
      }
      return undefined;
    }),
  };
  const workerWarmPoolSettingsService = {
    view: jest.fn(async () => makeSettings(overrides.settings)),
    shouldRunScan: jest.fn(async () => overrides.shouldRunScan ?? true),
  };
  const workerLifecycleQueueService = {
    loadPrepared: jest.fn(
      async () => overrides.preparedLifecycleMessages ?? []
    ),
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
      ) => {
        if (overrides.lifecycleLockReject) {
          throw new Error('Worker lifecycle lock timeout');
        }
        return callback({
          signal: new AbortController().signal,
          assertActive: jest.fn(),
        });
      }
    ),
  };
  const sshService = {
    runCommands: jest.fn(
      async (_serverId: string, _config: unknown, commands: string[]) => [
        {
          output: commands[0]?.includes('docker image inspect')
            ? [
                `${EWorkerType.baileys}|under-worker-baileys:latest|sha256:${'1'.repeat(64)}`,
                `${EWorkerType.wwebjs}|under-worker-wwebjs:latest|sha256:${'2'.repeat(64)}`,
                `${EWorkerType.whatsmeow}|under-worker-whatsmeow:latest|sha256:${'3'.repeat(64)}`,
              ].join('\n')
            : commands[0]?.includes('docker inspect --type=container') &&
                overrides.dockerExactOutput !== undefined
              ? overrides.dockerExactOutput
              : (overrides.dockerOutput ??
                'warm-running|running|true|warm-running|019a930d-c6f6-766d-9c84-62b9c3e7d1f0'),
        },
      ]
    ),
  };
  const passwordEncryptorService = {
    decrypt: jest.fn((value: string) => value.replace('encrypted-', '')),
  };
  const workerGrpcClientService = {
    runtimeHealth: jest.fn(
      async (
        _serverId: string,
        request: { warm_pool_id?: string; worker_type_id?: string }
      ) => {
        if (overrides.runtimeHealthReject) {
          throw new Error('runtime probe failed');
        }
        return {
          worker_id: '',
          account_id: '',
          warm_pool_id: request.warm_pool_id,
          worker_type_id: request.worker_type_id,
          standby: true,
          activated: false,
          ready: true,
          runtime_state: 'warm_standby',
          kafka_unhealthy: false,
          kafka_consumers_ready: false,
          error: '',
          ...overrides.runtimeHealthResponse,
        };
      }
    ),
  };

  const activity = new WorkerWarmPoolActivity(
    workerServerListerRepository as never,
    workerWarmPoolRepository as never,
    workerWarmPoolQueueService as never,
    workerWarmPoolSettingsService as never,
    workerLifecycleQueueService as never,
    workerLifecycleLockService as never,
    sshService as never,
    passwordEncryptorService as never,
    workerGrpcClientService as never
  );

  return {
    activity,
    workerWarmPoolRepository,
    workerWarmPoolQueueService,
    workerWarmPoolSettingsService,
    workerLifecycleQueueService,
    workerLifecycleLockService,
    sshService,
    workerGrpcClientService,
  };
}

describe('WorkerWarmPoolActivity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('durably tombstones decommissioned-server metadata before redriving stale deletes', async () => {
    const consoleWarn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const stale = makeWarmPool({
      warm_pool_id: 'stale-deleting',
      state: EWorkerWarmPoolState.deleting,
    });
    const deps = makeActivity({
      tombstonedDecommissionedServerEntries: 11,
      staleDeletingEntries: [stale],
    });
    const operationOrder: string[] = [];
    deps.workerWarmPoolRepository.tombstoneUnreferencedDecommissionedServerEntries.mockImplementation(
      async () => {
        operationOrder.push('tombstone');
        return 11;
      }
    );
    deps.workerWarmPoolRepository.claimStaleDeletingForRetry.mockImplementation(
      async () => {
        operationOrder.push('redrive');
        return [stale];
      }
    );

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository
        .tombstoneUnreferencedDecommissionedServerEntries
    ).toHaveBeenCalledWith(100);
    expect(operationOrder).toEqual(['tombstone', 'redrive']);
    expect(consoleWarn).toHaveBeenCalledWith(
      'Parked decommissioned-server warm pool cleanup',
      { tombstoned_count: 11 }
    );
    consoleWarn.mockRestore();
  });

  it('starts every warm server scan without head-of-line blocking on a hung host', async () => {
    const secondServer = {
      ...makeServer(),
      server_id: 'server-2',
      ssh_ip: '127.0.0.2',
    };
    let releaseFirstServer!: (value: { output: string }[]) => void;
    const firstServerBlocked = new Promise<{ output: string }[]>((resolve) => {
      releaseFirstServer = resolve;
    });
    const deps = makeActivity({
      servers: [makeServer(), secondServer],
    });
    deps.sshService.runCommands.mockImplementation((serverId: string) =>
      serverId === 'server-1'
        ? firstServerBlocked
        : Promise.resolve([{ output: '' }])
    );
    const scanPromise = deps.activity.scan();

    await new Promise<void>((resolve) => setImmediate(resolve));
    const startedServerIds = (
      deps.sshService.runCommands.mock.calls as unknown as Array<[string]>
    ).map((call) => call[0]);
    releaseFirstServer([{ output: '' }]);
    await scanPromise;

    expect(startedServerIds).toEqual(
      expect.arrayContaining(['server-1', 'server-2'])
    );
  });

  it('stops before publishing replenish when the distributed lease is lost', async () => {
    const deps = makeActivity({
      activeCounts: {
        [EWorkerType.baileys]: 0,
        [EWorkerType.wwebjs]: 0,
        [EWorkerType.whatsmeow]: 0,
      },
    });
    const controller = new AbortController();
    const leaseLost = new Error('warm pool scan lease lost');
    const leaseContext = {
      signal: controller.signal,
      assertActive: (): void => {
        if (controller.signal.aborted) {
          throw leaseLost;
        }
      },
    };
    deps.workerWarmPoolRepository.countAvailableByServerAndType.mockImplementationOnce(
      async () => {
        controller.abort();
        return 0;
      }
    );

    await expect(deps.activity.scan(leaseContext)).rejects.toBe(leaseLost);

    expect(
      deps.workerWarmPoolRepository.countAvailableByServerAndType
    ).toHaveBeenCalledTimes(1);
    expect(
      deps.workerWarmPoolQueueService.publishReplenish
    ).not.toHaveBeenCalled();
  });

  it('renews a due ready lease only after stable image identity and standby RuntimeHealth', async () => {
    const warmPoolId = '019f6f00-0000-7000-8000-000000000021';
    const containerId = '1'.repeat(64);
    const entry = makeWarmPool({
      warm_pool_id: warmPoolId,
      container_id: containerId,
      container_name: `warm-${warmPoolId}`,
      session_volume_name: `warm-${warmPoolId}`,
      last_health_at: '2000-01-01T00:00:00.000Z',
    });
    const deps = makeActivity({ activeEntries: [entry] });
    deps.sshService.runCommands.mockImplementation(
      async (_serverId: string, _config: unknown, commands: string[]) => {
        const command = commands[0] ?? '';
        if (command.includes('docker image inspect')) {
          return [{ output: expectedWarmImageSnapshot() }];
        }
        if (command.includes('docker inspect --type=container')) {
          return [
            {
              output: exactHealthyWarmContainer({ warmPoolId, containerId }),
            },
          ];
        }
        return [
          {
            output: `${containerId}|warm-${warmPoolId}|running|Up 2 minutes (healthy)|true|${warmPoolId}|${EWorkerType.baileys}`,
          },
        ];
      }
    );

    await deps.activity.scan();

    expect(deps.workerGrpcClientService.runtimeHealth).toHaveBeenCalledWith(
      'server-1',
      {
        warm_pool_id: warmPoolId,
        worker_type_id: EWorkerType.baileys,
        server_id: 'server-1',
      },
      12_000
    );
    expect(
      deps.workerWarmPoolRepository.confirmHealthyReadyRuntime
    ).toHaveBeenCalledWith({
      warmPoolId,
      expectedContainerId: containerId,
    });
    expect(
      deps.workerWarmPoolRepository.invalidateReadyRuntimeHealth
    ).not.toHaveBeenCalled();
  });

  it('keeps a pinned warm unchanged when the Balance RuntimeHealth transport is unavailable', async () => {
    const warmPoolId = '019f6f00-0000-7000-8000-000000000022';
    const containerId = '2'.repeat(64);
    const pinnedOlderImageId = `sha256:${'8'.repeat(64)}`;
    const pinnedOlderImageName =
      'registry.internal/under-worker-baileys:previous-version';
    const entry = makeWarmPool({
      warm_pool_id: warmPoolId,
      container_id: containerId,
      container_name: `warm-${warmPoolId}`,
      session_volume_name: `warm-${warmPoolId}`,
      last_health_at: null,
      last_error: 'warm_runtime_health_probe_failed',
      updated_at: new Date(Date.now() - 181_000).toISOString(),
    });
    const deps = makeActivity({
      activeEntries: [entry],
      runtimeHealthReject: true,
    });
    deps.sshService.runCommands.mockImplementation(
      async (_serverId: string, _config: unknown, commands: string[]) => {
        const command = commands[0] ?? '';
        if (command.includes('docker image inspect')) {
          return [{ output: expectedWarmImageSnapshot() }];
        }
        if (command.includes('docker inspect --type=container')) {
          return [
            {
              output: exactHealthyWarmContainer({
                warmPoolId,
                containerId,
                imageId: pinnedOlderImageId,
                imageName: pinnedOlderImageName,
              }),
            },
          ];
        }
        return [
          {
            output: `${containerId}|warm-${warmPoolId}|running|Up 2 minutes (healthy)|true|${warmPoolId}|${EWorkerType.baileys}`,
          },
        ];
      }
    );

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.invalidateReadyRuntimeHealth
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.confirmHealthyReadyRuntime
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.claimMissingRuntimeForCleanup
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishDelete
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishReplenish
    ).not.toHaveBeenCalled();
  });

  it('does not probe or mutate ready warms while the Balance server is installing a version', async () => {
    const warmPoolId = '019f6f00-0000-7000-8000-000000000034';
    const containerId = 'c'.repeat(64);
    const entry = makeWarmPool({
      warm_pool_id: warmPoolId,
      container_id: containerId,
      container_name: `warm-${warmPoolId}`,
      session_volume_name: `warm-${warmPoolId}`,
      last_health_at: null,
      last_error: 'warm_runtime_health_probe_failed',
      updated_at: new Date(Date.now() - 181_000).toISOString(),
    });
    const installingServer = {
      ...makeServer(),
      server_status_id: EServerStatus.installing,
    };
    const deps = makeActivity({
      activeEntries: [entry],
      eligibleServers: [],
      reconcileServers: [installingServer],
    });
    deps.sshService.runCommands.mockImplementation(
      async (_serverId: string, _config: unknown, commands: string[]) => {
        const command = commands[0] ?? '';
        if (command.includes('docker inspect --type=container')) {
          return [
            {
              output: exactHealthyWarmContainer({ warmPoolId, containerId }),
            },
          ];
        }
        return [
          {
            output: `${containerId}|warm-${warmPoolId}|running|Up 10 minutes (healthy)|true|${warmPoolId}|${EWorkerType.baileys}`,
          },
        ];
      }
    );

    await deps.activity.scan();

    expect(deps.workerGrpcClientService.runtimeHealth).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.invalidateReadyRuntimeHealth
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.claimMissingRuntimeForCleanup
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishDelete
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishReplenish
    ).not.toHaveBeenCalled();
  });

  it('preserves an exact ready standby after an explicit RuntimeHealth rejection beyond grace', async () => {
    const warmPoolId = '019f6f00-0000-7000-8000-000000000032';
    const containerId = 'a'.repeat(64);
    const entry = makeWarmPool({
      warm_pool_id: warmPoolId,
      container_id: containerId,
      container_name: `warm-${warmPoolId}`,
      session_volume_name: `warm-${warmPoolId}`,
      last_health_at: null,
      last_error: 'warm_runtime_health_probe_failed',
      updated_at: new Date(Date.now() - 181_000).toISOString(),
    });
    const deps = makeActivity({
      activeEntries: [entry],
      runtimeHealthResponse: { ready: false },
      settings: { target_ready_baileys: 1 },
      activeCounts: {
        [EWorkerType.baileys]: 1,
        [EWorkerType.wwebjs]: 2,
        [EWorkerType.whatsmeow]: 2,
      },
      physicalOwnershipIds: [warmPoolId],
      capacityOwnershipIds: [],
    });
    deps.sshService.runCommands.mockImplementation(
      async (_serverId: string, _config: unknown, commands: string[]) => {
        const command = commands[0] ?? '';
        if (command.includes('docker image inspect')) {
          return [{ output: expectedWarmImageSnapshot() }];
        }
        if (command.includes('docker inspect --type=container')) {
          return [
            {
              output: exactHealthyWarmContainer({ warmPoolId, containerId }),
            },
          ];
        }
        return [
          {
            output: `${containerId}|warm-${warmPoolId}|running|Up 10 minutes (healthy)|true|${warmPoolId}|${EWorkerType.baileys}`,
          },
        ];
      }
    );

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.invalidateReadyRuntimeHealth
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.claimMissingRuntimeForCleanup
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishDelete
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishReplenish
    ).not.toHaveBeenCalled();
  });

  it('clears a durable RuntimeHealth failure marker when the standby recovers before cleanup CAS', async () => {
    const warmPoolId = '019f6f00-0000-7000-8000-000000000033';
    const containerId = 'b'.repeat(64);
    const entry = makeWarmPool({
      warm_pool_id: warmPoolId,
      container_id: containerId,
      container_name: `warm-${warmPoolId}`,
      session_volume_name: `warm-${warmPoolId}`,
      last_health_at: null,
      last_error: 'warm_runtime_health_probe_failed',
      updated_at: new Date(Date.now() - 181_000).toISOString(),
    });
    const deps = makeActivity({ activeEntries: [entry] });
    deps.sshService.runCommands.mockImplementation(
      async (_serverId: string, _config: unknown, commands: string[]) => {
        const command = commands[0] ?? '';
        if (command.includes('docker image inspect')) {
          return [{ output: expectedWarmImageSnapshot() }];
        }
        if (command.includes('docker inspect --type=container')) {
          return [
            {
              output: exactHealthyWarmContainer({ warmPoolId, containerId }),
            },
          ];
        }
        return [
          {
            output: `${containerId}|warm-${warmPoolId}|running|Up 10 minutes (healthy)|true|${warmPoolId}|${EWorkerType.baileys}`,
          },
        ];
      }
    );

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.confirmHealthyReadyRuntime
    ).toHaveBeenCalledWith({
      warmPoolId,
      expectedContainerId: containerId,
    });
    expect(
      deps.workerWarmPoolRepository.invalidateReadyRuntimeHealth
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.claimMissingRuntimeForCleanup
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishDelete
    ).not.toHaveBeenCalled();
  });

  it('keeps a healthy warm on its pinned older repository, tag and digest after the configured image advances', async () => {
    const warmPoolId = '019f6f00-0000-7000-8000-000000000023';
    const containerId = '3'.repeat(64);
    const pinnedOlderImageId = `sha256:${'9'.repeat(64)}`;
    const pinnedOlderImageName =
      'legacy-registry.internal/archived/worker-baileys:previous-stable';
    const entry = makeWarmPool({
      warm_pool_id: warmPoolId,
      container_id: containerId,
      container_name: `warm-${warmPoolId}`,
      session_volume_name: `warm-${warmPoolId}`,
      last_health_at: '2000-01-01T00:00:00.000Z',
    });
    const deps = makeActivity({ activeEntries: [entry] });
    deps.sshService.runCommands.mockImplementation(
      async (_serverId: string, _config: unknown, commands: string[]) => {
        const command = commands[0] ?? '';
        if (command.includes('docker inspect --type=container')) {
          return [
            {
              output: exactHealthyWarmContainer({
                warmPoolId,
                containerId,
                imageId: pinnedOlderImageId,
                imageName: pinnedOlderImageName,
              }),
            },
          ];
        }
        return [
          {
            output: `${containerId}|warm-${warmPoolId}|running|Up 2 minutes (healthy)|true|${warmPoolId}|${EWorkerType.baileys}`,
          },
        ];
      }
    );

    await deps.activity.scan();

    expect(deps.workerGrpcClientService.runtimeHealth).toHaveBeenCalledWith(
      'server-1',
      {
        warm_pool_id: warmPoolId,
        worker_type_id: EWorkerType.baileys,
        server_id: 'server-1',
      },
      12_000
    );
    expect(
      deps.workerWarmPoolRepository.confirmHealthyReadyRuntime
    ).toHaveBeenCalledWith({
      warmPoolId,
      expectedContainerId: containerId,
    });
    expect(
      deps.workerWarmPoolRepository.claimMissingRuntimeForCleanup
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.invalidateReadyRuntimeHealth
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishDelete
    ).not.toHaveBeenCalled();
    expect(deps.sshService.runCommands.mock.calls).not.toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          expect.anything(),
          expect.anything(),
          expect.arrayContaining([
            expect.stringContaining('docker image inspect'),
          ]),
        ]),
      ])
    );
  });

  it('preserves a ready standby whose observed provider identity differs from its pool row', async () => {
    const warmPoolId = '019f6f00-0000-7000-8000-000000000024';
    const containerId = '4'.repeat(64);
    const entry = makeWarmPool({
      warm_pool_id: warmPoolId,
      container_id: containerId,
      container_name: `warm-${warmPoolId}`,
      session_volume_name: `warm-${warmPoolId}`,
      last_health_at: '2000-01-01T00:00:00.000Z',
    });
    const deps = makeActivity({ activeEntries: [entry] });
    deps.sshService.runCommands.mockImplementation(
      async (_serverId: string, _config: unknown, commands: string[]) => {
        const command = commands[0] ?? '';
        if (command.includes('docker inspect --type=container')) {
          return [
            {
              output: exactHealthyWarmContainer({
                warmPoolId,
                containerId,
                imageName:
                  'legacy-registry.internal/archived/worker-wwebjs:v17',
                workerTypeId: EWorkerType.wwebjs,
              }),
            },
          ];
        }
        return [
          {
            output: `${containerId}|warm-${warmPoolId}|running|Up 2 minutes (healthy)|true|${warmPoolId}|${EWorkerType.wwebjs}`,
          },
        ];
      }
    );

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.invalidateReadyRuntimeHealth
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.claimMissingRuntimeForCleanup
    ).not.toHaveBeenCalled();
    expect(deps.workerGrpcClientService.runtimeHealth).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishDelete
    ).not.toHaveBeenCalled();
  });

  it('renews healthy providers without consulting whether their mutable image tags are locally available', async () => {
    const baileysWarmPoolId = '019f6f00-0000-7000-8000-000000000025';
    const wwebjsWarmPoolId = '019f6f00-0000-7000-8000-000000000026';
    const baileysContainerId = '5'.repeat(64);
    const wwebjsContainerId = '6'.repeat(64);
    const baileysEntry = makeWarmPool({
      warm_pool_id: baileysWarmPoolId,
      container_id: baileysContainerId,
      container_name: `warm-${baileysWarmPoolId}`,
      session_volume_name: `warm-${baileysWarmPoolId}`,
      worker_type_id: EWorkerType.baileys,
      last_health_at: '2000-01-01T00:00:00.000Z',
    });
    const wwebjsEntry = makeWarmPool({
      warm_pool_id: wwebjsWarmPoolId,
      container_id: wwebjsContainerId,
      container_name: `warm-${wwebjsWarmPoolId}`,
      session_volume_name: `warm-${wwebjsWarmPoolId}`,
      worker_type_id: EWorkerType.wwebjs,
      last_health_at: '2000-01-01T00:00:00.000Z',
    });
    const deps = makeActivity({
      activeEntries: [baileysEntry, wwebjsEntry],
    });
    deps.sshService.runCommands.mockImplementation(
      async (_serverId: string, _config: unknown, commands: string[]) => {
        const command = commands[0] ?? '';
        if (command.includes('docker inspect --type=container')) {
          return [
            {
              output: [
                exactHealthyWarmContainer({
                  warmPoolId: baileysWarmPoolId,
                  containerId: baileysContainerId,
                }),
                exactHealthyWarmContainer({
                  warmPoolId: wwebjsWarmPoolId,
                  containerId: wwebjsContainerId,
                  workerTypeId: EWorkerType.wwebjs,
                }),
              ].join('\n'),
            },
          ];
        }
        return [
          {
            output: [
              `${baileysContainerId}|warm-${baileysWarmPoolId}|running|Up 2 minutes (healthy)|true|${baileysWarmPoolId}|${EWorkerType.baileys}`,
              `${wwebjsContainerId}|warm-${wwebjsWarmPoolId}|running|Up 2 minutes (healthy)|true|${wwebjsWarmPoolId}|${EWorkerType.wwebjs}`,
            ].join('\n'),
          },
        ];
      }
    );

    await deps.activity.scan();

    expect(deps.workerGrpcClientService.runtimeHealth).toHaveBeenCalledTimes(2);
    expect(deps.workerGrpcClientService.runtimeHealth).toHaveBeenCalledWith(
      'server-1',
      {
        warm_pool_id: baileysWarmPoolId,
        worker_type_id: EWorkerType.baileys,
        server_id: 'server-1',
      },
      12_000
    );
    expect(
      deps.workerWarmPoolRepository.confirmHealthyReadyRuntime
    ).toHaveBeenCalledWith({
      warmPoolId: baileysWarmPoolId,
      expectedContainerId: baileysContainerId,
    });
    expect(
      deps.workerWarmPoolRepository.confirmHealthyReadyRuntime
    ).toHaveBeenCalledWith({
      warmPoolId: wwebjsWarmPoolId,
      expectedContainerId: wwebjsContainerId,
    });
    expect(
      deps.workerWarmPoolRepository.invalidateReadyRuntimeHealth
    ).not.toHaveBeenCalled();
    expect(deps.sshService.runCommands.mock.calls).not.toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          expect.anything(),
          expect.anything(),
          expect.arrayContaining([
            expect.stringContaining('docker image inspect'),
          ]),
        ]),
      ])
    );
  });

  it('continues cleanup but never replenishes when warmup is disabled', async () => {
    const consoleWarn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const deps = makeActivity({
      settings: { warmup_enabled: false },
      tombstonedDecommissionedServerEntries: 3,
      staleDeletingEntries: [
        makeWarmPool({
          warm_pool_id: 'must-not-redrive',
          state: EWorkerWarmPoolState.deleting,
        }),
      ],
    });

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository
        .tombstoneUnreferencedDecommissionedServerEntries
    ).toHaveBeenCalledWith(100);
    expect(consoleWarn).toHaveBeenCalledWith(
      'Parked decommissioned-server warm pool cleanup',
      { tombstoned_count: 3 }
    );
    expect(
      deps.workerWarmPoolRepository.releaseExpiredReservations
    ).toHaveBeenCalledTimes(1);
    expect(
      deps.workerWarmPoolRepository.claimStaleDeletingForRetry
    ).toHaveBeenCalledTimes(1);
    expect(deps.workerWarmPoolQueueService.ensure).toHaveBeenCalledTimes(1);
    expect(deps.workerWarmPoolQueueService.publishDelete).toHaveBeenCalledWith(
      expect.objectContaining({ warm_pool_id: 'must-not-redrive' })
    );
    expect(
      deps.workerWarmPoolQueueService.publishReplenish
    ).not.toHaveBeenCalled();
    consoleWarn.mockRestore();
  });

  it('preserves a ready warm pool entry missing in Docker until manual recreation', async () => {
    const staleReady = makeWarmPool({
      warm_pool_id: 'missing-baileys',
      container_id: 'container-missing',
      container_name: 'warm-missing-baileys',
      session_volume_name: 'warm-missing-baileys',
      worker_type_id: EWorkerType.baileys,
      state: EWorkerWarmPoolState.ready,
    });
    const deps = makeActivity({
      activeEntries: [staleReady],
      dockerOutput: '',
      settings: { target_ready_baileys: 1 },
      activeCounts: {
        [EWorkerType.baileys]: 1,
        [EWorkerType.wwebjs]: 2,
        [EWorkerType.whatsmeow]: 2,
      },
    });

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.claimMissingRuntimeForCleanup
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishDelete
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishReplenish
    ).not.toHaveBeenCalled();
  });

  it('does not tombstone a healthy exact runtime after a transient empty Docker listing', async () => {
    const warmPoolId = '019f6f00-0000-7000-8000-000000000008';
    const containerId = '7'.repeat(64);
    const entry = makeWarmPool({
      warm_pool_id: warmPoolId,
      container_id: containerId,
      container_name: `warm-${warmPoolId}`,
      session_volume_name: `warm-${warmPoolId}`,
      worker_type_id: EWorkerType.baileys,
      state: EWorkerWarmPoolState.ready,
    });
    const exactHealthy =
      `${containerId}|/warm-${warmPoolId}|running|healthy|true|${warmPoolId}|${EWorkerType.baileys}|` +
      '2026-07-30T11:00:00.000Z|0|false';
    const deps = makeActivity({
      activeEntries: [entry],
      dockerOutput: '',
    });
    deps.sshService.runCommands
      .mockResolvedValueOnce([{ output: '' }])
      .mockResolvedValueOnce([{ output: exactHealthy }]);

    await deps.activity.scan();

    expect(deps.sshService.runCommands).toHaveBeenCalledTimes(1);
    expect(
      deps.workerWarmPoolRepository.confirmHealthyReadyRuntime
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.claimMissingRuntimeForCleanup
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishDelete
    ).not.toHaveBeenCalled();
  });

  it('fails closed when exact reinspection finds the same container ID with foreign warm identity', async () => {
    const warmPoolId = '019f6f00-0000-7000-8000-000000000009';
    const foreignWarmPoolId = '019f6f00-0000-7000-8000-00000000000a';
    const containerId = '6'.repeat(64);
    const entry = makeWarmPool({
      warm_pool_id: warmPoolId,
      container_id: containerId,
      container_name: `warm-${warmPoolId}`,
      session_volume_name: `warm-${warmPoolId}`,
      worker_type_id: EWorkerType.baileys,
      state: EWorkerWarmPoolState.ready,
    });
    const foreignIdentity =
      `${containerId}|/warm-${foreignWarmPoolId}|running|healthy|true|${foreignWarmPoolId}|${EWorkerType.wwebjs}|` +
      '2026-07-30T11:00:00.000Z|0|false';
    const deps = makeActivity({
      activeEntries: [entry],
      dockerOutput: '',
    });
    deps.sshService.runCommands
      .mockResolvedValueOnce([{ output: '' }])
      .mockResolvedValueOnce([{ output: foreignIdentity }]);
    const consoleWarn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.claimMissingRuntimeForCleanup
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishDelete
    ).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    consoleWarn.mockRestore();
  });

  it('does not reconcile a fresh warming entry that is not visible in Docker yet', async () => {
    const freshWarming = makeWarmPool({
      warm_pool_id: 'fresh-warming',
      container_name: 'warm-fresh-warming',
      session_volume_name: 'warm-fresh-warming',
      worker_type_id: EWorkerType.baileys,
      state: EWorkerWarmPoolState.warming,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const deps = makeActivity({
      activeEntries: [freshWarming],
      dockerOutput: '',
      activeCounts: {
        [EWorkerType.baileys]: 1,
        [EWorkerType.wwebjs]: 2,
        [EWorkerType.whatsmeow]: 2,
      },
    });

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.claimMissingRuntimeForCleanup
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishDelete
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishReplenish
    ).toHaveBeenCalledTimes(1);
  });

  it('never reconciles a reserved standby while activation may be adopting it', async () => {
    const deps = makeActivity({
      activeEntries: [
        makeWarmPool({
          warm_pool_id: 'reserved-adopting',
          state: EWorkerWarmPoolState.reserved,
          container_name: 'warm-reserved-adopting',
          session_volume_name: 'warm-reserved-adopting',
        }),
      ],
      dockerOutput: '',
    });

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.claimMissingRuntimeForCleanup
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishDelete
    ).not.toHaveBeenCalled();
  });

  it('fences and cleans a stale activation that crashed after beginActivation', async () => {
    const context = makeStaleActivatingContext();
    const sourceOutput = exactHealthyWarmContainer({
      warmPoolId: STALE_WARM_POOL_ID,
      containerId: STALE_SOURCE_CONTAINER_ID,
    });
    const deps = makeActivity({
      staleActivatingContexts: [context],
      preparedLifecycleMessages: [makePreparedLifecycleMessage()],
    });
    deps.sshService.runCommands.mockImplementation(
      async (_serverId: string, _config: unknown, commands: string[]) => {
        const command = commands[0] ?? '';
        if (command.includes('docker inspect --type=container')) {
          return [{ output: sourceOutput }];
        }
        if (command.includes('docker volume inspect')) {
          return [{ output: `warm-${STALE_WARM_POOL_ID}` }];
        }
        return [{ output: '' }];
      }
    );

    await deps.activity.scan();

    expect(deps.workerLifecycleLockService.withLock).toHaveBeenCalledWith(
      STALE_WORKER_ID,
      'reconcile_stale_warm_activation',
      expect.any(Function),
      expect.objectContaining({ acquireTimeoutMs: 50 })
    );
    expect(
      deps.workerWarmPoolRepository.claimStaleActivatingForCleanup
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        warmPoolId: STALE_WARM_POOL_ID,
        reservedByWorkerId: STALE_WORKER_ID,
        expectedSourceContainerId: STALE_SOURCE_CONTAINER_ID,
        cleanupContainerId: STALE_SOURCE_CONTAINER_ID,
        cleanupContainerName: `warm-${STALE_WARM_POOL_ID}`,
        lastError:
          'warm_activation_abandoned:activation_started_before_source_removal',
      })
    );
    expect(deps.workerWarmPoolQueueService.publishDelete).toHaveBeenCalledWith(
      expect.objectContaining({
        warm_pool_id: STALE_WARM_POOL_ID,
        container_id: STALE_SOURCE_CONTAINER_ID,
        container_name: `warm-${STALE_WARM_POOL_ID}`,
      })
    );
  });

  it('never claims a stale activation after the scan leadership lease is lost', async () => {
    const context = makeStaleActivatingContext();
    const deps = makeActivity({
      staleActivatingContexts: [context],
      preparedLifecycleMessages: [makePreparedLifecycleMessage()],
    });
    const controller = new AbortController();
    const leaseLost = new Error('warm pool scan lease lost');
    const leaseContext = {
      signal: controller.signal,
      assertActive: (): void => {
        if (controller.signal.aborted) {
          throw leaseLost;
        }
      },
    };
    deps.workerWarmPoolRepository.viewStaleActivatingForReconcile.mockImplementationOnce(
      async () => {
        controller.abort();
        return context;
      }
    );

    await expect(deps.activity.scan(leaseContext)).rejects.toBe(leaseLost);

    expect(
      deps.workerWarmPoolRepository.claimStaleActivatingForCleanup
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishDelete
    ).not.toHaveBeenCalled();
  });

  it('recovers the crash cut after source removal and before target creation', async () => {
    const context = makeStaleActivatingContext();
    const deps = makeActivity({
      staleActivatingContexts: [context],
      preparedLifecycleMessages: [makePreparedLifecycleMessage()],
    });
    deps.sshService.runCommands.mockImplementation(
      async (_serverId: string, _config: unknown, commands: string[]) => {
        const command = commands[0] ?? '';
        if (command.includes('docker volume inspect')) {
          return [{ output: `warm-${STALE_WARM_POOL_ID}` }];
        }
        return [{ output: '' }];
      }
    );

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.claimStaleActivatingForCleanup
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        cleanupContainerId: STALE_SOURCE_CONTAINER_ID,
        cleanupContainerName: `warm-${STALE_WARM_POOL_ID}`,
        lastError: 'warm_activation_abandoned:source_removed_before_target',
      })
    );
    expect(deps.workerWarmPoolQueueService.publishDelete).toHaveBeenCalledWith(
      expect.objectContaining({
        warm_pool_id: STALE_WARM_POOL_ID,
        session_volume_name: `warm-${STALE_WARM_POOL_ID}`,
        remove_volume: true,
      })
    );
  });

  it('selects the exact generated target after target creation and before runtime upsert', async () => {
    const context = makeStaleActivatingContext();
    const targetContainerId = 'b'.repeat(64);
    const targetOutput = exactAdoptedWarmContainer({
      warmPoolId: STALE_WARM_POOL_ID,
      containerId: targetContainerId,
      workerId: STALE_WORKER_ID,
      accountId: STALE_ACCOUNT_ID,
      operationId: 'old-operation',
    });
    const deps = makeActivity({
      staleActivatingContexts: [context],
      preparedLifecycleMessages: [makePreparedLifecycleMessage()],
    });
    deps.sshService.runCommands.mockImplementation(
      async (_serverId: string, _config: unknown, commands: string[]) => {
        const command = commands[0] ?? '';
        if (command.includes('docker inspect --type=container')) {
          return [{ output: targetOutput }];
        }
        if (command.includes('docker volume inspect')) {
          return [{ output: `warm-${STALE_WARM_POOL_ID}` }];
        }
        return [{ output: '' }];
      }
    );

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.claimStaleActivatingForCleanup
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        cleanupContainerId: targetContainerId,
        cleanupContainerName: STALE_WORKER_ID,
        lastError: 'warm_activation_abandoned:target_created_before_runtime',
      })
    );
    expect(deps.workerWarmPoolQueueService.publishDelete).toHaveBeenCalledWith(
      expect.objectContaining({
        container_id: targetContainerId,
        container_name: STALE_WORKER_ID,
      })
    );
  });

  it('never claims a converted target with divergent activation identity', async () => {
    const context = makeStaleActivatingContext();
    const targetContainerId = 'd'.repeat(64);
    const divergentTargetOutput =
      `${targetContainerId}|/${STALE_WORKER_ID}|running|healthy|false|` +
      `${STALE_WARM_POOL_ID}|${EWorkerType.baileys}|2026-07-30T09:04:00.000Z|0|false|` +
      `server-1|warm-${STALE_WARM_POOL_ID}|${STALE_WORKER_ID}|foreign-account|old-operation`;
    const deps = makeActivity({
      staleActivatingContexts: [context],
      preparedLifecycleMessages: [makePreparedLifecycleMessage()],
    });
    deps.sshService.runCommands.mockImplementation(
      async (_serverId: string, _config: unknown, commands: string[]) => {
        if ((commands[0] ?? '').includes('docker inspect --type=container')) {
          return [{ output: divergentTargetOutput }];
        }
        return [{ output: '' }];
      }
    );
    const consoleWarn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.claimStaleActivatingForCleanup
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishDelete
    ).not.toHaveBeenCalled();
    expect(consoleWarn).toHaveBeenCalledWith(
      'Skipped stale warm activation after Docker identity conflict',
      expect.objectContaining({
        warm_pool_id: STALE_WARM_POOL_ID,
        worker_id: STALE_WORKER_ID,
        target_present: true,
      })
    );
    consoleWarn.mockRestore();
  });

  it('never publishes cleanup when the runtime-upsert fence rejects the stale claim', async () => {
    const context = makeStaleActivatingContext();
    const targetContainerId = 'c'.repeat(64);
    const targetOutput = exactAdoptedWarmContainer({
      warmPoolId: STALE_WARM_POOL_ID,
      containerId: targetContainerId,
      workerId: STALE_WORKER_ID,
      accountId: STALE_ACCOUNT_ID,
      operationId: 'old-operation',
    });
    const deps = makeActivity({
      staleActivatingContexts: [context],
      preparedLifecycleMessages: [makePreparedLifecycleMessage()],
      staleActivatingClaim: null,
    });
    deps.sshService.runCommands.mockImplementation(
      async (_serverId: string, _config: unknown, commands: string[]) => {
        const command = commands[0] ?? '';
        if (command.includes('docker inspect --type=container')) {
          return [{ output: targetOutput }];
        }
        if (command.includes('docker volume inspect')) {
          return [{ output: `warm-${STALE_WARM_POOL_ID}` }];
        }
        return [{ output: '' }];
      }
    );

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.claimStaleActivatingForCleanup
    ).toHaveBeenCalledTimes(1);
    expect(
      deps.workerWarmPoolQueueService.publishDelete
    ).not.toHaveBeenCalled();
  });

  it('leaves a stale row untouched while its exact activation journal remains authoritative', async () => {
    const owner = makeStaleActivatingContext().owner;
    if (!owner) {
      throw new Error('stale activation owner fixture is required');
    }
    const context = makeStaleActivatingContext({
      owner: {
        ...owner,
        lifecycle_operation_id: 'current-activation',
      },
    });
    const deps = makeActivity({
      staleActivatingContexts: [context],
      preparedLifecycleMessages: [
        makePreparedLifecycleMessage({
          operation_id: 'current-activation',
          action: 'activate_warm',
          source: 'worker_update',
          warm_pool_id: STALE_WARM_POOL_ID,
        }),
      ],
    });

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.claimStaleActivatingForCleanup
    ).not.toHaveBeenCalled();
    const exactInspectCalls = deps.sshService.runCommands.mock.calls.filter(
      (call) => {
        const commands = (call as unknown as [unknown, unknown, string[]])[2];
        return String(commands?.[0] ?? '').includes(
          'docker inspect --type=container'
        );
      }
    );
    expect(exactInspectCalls).toHaveLength(0);
  });

  it.each([EWorkerStatus.online, EWorkerStatus.disponible])(
    'never treats an active owner status %s as abandoned only because worker_runtime is absent',
    async (workerStatusId) => {
      const owner = makeStaleActivatingContext().owner;
      if (!owner) {
        throw new Error('stale activation owner fixture is required');
      }
      const deps = makeActivity({
        staleActivatingContexts: [
          makeStaleActivatingContext({
            owner: {
              ...owner,
              worker_status_id: workerStatusId,
            },
          }),
        ],
        preparedLifecycleMessages: [makePreparedLifecycleMessage()],
      });

      await deps.activity.scan();

      expect(
        deps.workerWarmPoolRepository.claimStaleActivatingForCleanup
      ).not.toHaveBeenCalled();
      expect(
        deps.workerWarmPoolQueueService.publishDelete
      ).not.toHaveBeenCalled();
      expect(deps.sshService.runCommands).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.arrayContaining([
          expect.stringContaining('docker inspect --type=container'),
        ])
      );
    }
  );

  it('does not race a stale reconciler against a lifecycle handler holding the worker lock', async () => {
    const consoleWarn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const deps = makeActivity({
      staleActivatingContexts: [makeStaleActivatingContext()],
      lifecycleLockReject: true,
    });

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.viewStaleActivatingForReconcile
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.claimStaleActivatingForCleanup
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishDelete
    ).not.toHaveBeenCalled();
    consoleWarn.mockRestore();
  });

  it('keeps physical reconciliation enabled when automatic warmup is disabled', async () => {
    const deps = makeActivity({
      settings: {
        warmup_enabled: false,
      },
    });

    await deps.activity.scan();

    expect(deps.workerWarmPoolSettingsService.view).toHaveBeenCalledTimes(1);
    expect(deps.workerWarmPoolSettingsService.shouldRunScan).toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository
        .tombstoneUnreferencedDecommissionedServerEntries
    ).toHaveBeenCalledWith(100);
    expect(deps.workerWarmPoolQueueService.ensure).toHaveBeenCalledTimes(1);
    expect(
      deps.workerWarmPoolRepository.releaseExpiredReservations
    ).toHaveBeenCalledTimes(1);
    expect(
      deps.workerWarmPoolQueueService.publishReplenish
    ).not.toHaveBeenCalled();
  });

  it('does not scan when the configured interval has not elapsed', async () => {
    const deps = makeActivity({
      shouldRunScan: false,
    });

    await deps.activity.scan();

    expect(deps.workerWarmPoolSettingsService.shouldRunScan).toHaveBeenCalled();
    expect(deps.workerWarmPoolQueueService.ensure).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.releaseExpiredReservations
    ).not.toHaveBeenCalled();
  });

  it('uses configured targets by worker type and accepts zero', async () => {
    const deps = makeActivity({
      dockerOutput: '',
      settings: {
        target_ready_baileys: 0,
        target_ready_wwebjs: 1,
        target_ready_whatsmeow: 0,
      },
      activeCounts: {
        [EWorkerType.baileys]: 0,
        [EWorkerType.wwebjs]: 0,
        [EWorkerType.whatsmeow]: 0,
      },
    });

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolQueueService.publishReplenish
    ).toHaveBeenCalledTimes(1);
    expect(
      deps.workerWarmPoolQueueService.publishReplenish
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        reason: 'scheduled_scan',
      })
    );
  });

  it('performs no automatic create or delete when every provider is exactly at target', async () => {
    const deps = makeActivity({
      dockerOutput: '',
      settings: {
        target_ready_baileys: 4,
        target_ready_wwebjs: 2,
        target_ready_whatsmeow: 2,
      },
      activeCounts: {
        [EWorkerType.baileys]: 4,
        [EWorkerType.wwebjs]: 2,
        [EWorkerType.whatsmeow]: 2,
      },
    });

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolQueueService.publishReplenish
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishDelete
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.markReadyExcessAsDeleting
    ).not.toHaveBeenCalled();
  });

  it('preserves ready warm channels above the target until manual recreation', async () => {
    const excessEntries = [
      makeWarmPool({
        warm_pool_id: 'excess-1',
        container_id: 'container-excess-1',
        container_name: 'warm-excess-1',
        session_storage: EWorkerSessionStorage.postgres,
        session_volume_name: null,
        worker_type_id: EWorkerType.baileys,
      }),
      makeWarmPool({
        warm_pool_id: 'excess-2',
        container_id: 'container-excess-2',
        container_name: 'warm-excess-2',
        session_volume_name: 'warm-excess-2',
        worker_type_id: EWorkerType.baileys,
      }),
      makeWarmPool({
        warm_pool_id: 'excess-3',
        container_id: 'container-excess-3',
        container_name: 'warm-excess-3',
        session_volume_name: 'warm-excess-3',
        worker_type_id: EWorkerType.baileys,
      }),
    ];
    const deps = makeActivity({
      activeCounts: {
        [EWorkerType.baileys]: 5,
        [EWorkerType.wwebjs]: 2,
        [EWorkerType.whatsmeow]: 2,
      },
      readyExcessEntries: {
        [EWorkerType.baileys]: excessEntries,
      },
    });

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.markReadyExcessAsDeleting
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishDelete
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishReplenish
    ).not.toHaveBeenCalled();
  });

  it('preserves ready warm channels when the configured target becomes zero', async () => {
    const deps = makeActivity({
      settings: {
        target_ready_baileys: 0,
        target_ready_wwebjs: 0,
        target_ready_whatsmeow: 0,
      },
      activeCounts: {
        [EWorkerType.baileys]: 2,
        [EWorkerType.wwebjs]: 0,
        [EWorkerType.whatsmeow]: 0,
      },
      readyExcessEntries: {
        [EWorkerType.baileys]: [
          makeWarmPool({ warm_pool_id: 'excess-1' }),
          makeWarmPool({ warm_pool_id: 'excess-2' }),
        ],
      },
    });

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.markReadyExcessAsDeleting
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishDelete
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishReplenish
    ).not.toHaveBeenCalled();
  });

  it('redrives stale deleting warm channels before reconciling targets', async () => {
    const stale = makeWarmPool({
      warm_pool_id: 'stale-deleting',
      state: EWorkerWarmPoolState.deleting,
      container_name: 'warm-stale-deleting',
      session_volume_name: 'warm-stale-deleting',
    });
    const deps = makeActivity({
      staleDeletingEntries: [stale],
    });

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.claimStaleDeletingForRetry
    ).toHaveBeenCalledWith({
      staleBefore: expect.any(String),
      limit: 100,
    });
    expect(deps.workerWarmPoolQueueService.publishDelete).toHaveBeenCalledWith(
      expect.objectContaining({
        warm_pool_id: 'stale-deleting',
        container_name: 'warm-stale-deleting',
        session_volume_name: 'warm-stale-deleting',
        remove_volume: true,
        reason: 'pool_reconcile',
      })
    );
  });

  it('repairs a deleting row from runtime lineage after a crash before Kafka delete completion', async () => {
    const deps = makeActivity({
      deletingRuntimeLineageIds: ['lineage-after-crash'],
    });

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.listDeletingRuntimeLineageIds
    ).toHaveBeenCalledWith(100);
    expect(
      deps.workerWarmPoolRepository.reconcileDeletingRuntimeLineage
    ).toHaveBeenCalledWith('lineage-after-crash');
    expect(
      deps.workerWarmPoolQueueService.publishDelete
    ).not.toHaveBeenCalled();
  });

  it('claims terminal errors and removes stale unreferenced assignment metadata', async () => {
    const terminalError = makeWarmPool({
      warm_pool_id: 'terminal-error',
      state: EWorkerWarmPoolState.error,
      container_name: 'warm-terminal-error',
      session_volume_name: 'warm-terminal-error',
    });
    const staleAssigned = makeWarmPool({
      warm_pool_id: 'stale-assigned',
      state: EWorkerWarmPoolState.assigned,
      container_name: 'warm-stale-assigned',
      session_volume_name: 'warm-stale-assigned',
    });
    const deps = makeActivity({
      terminalErrorEntries: [terminalError],
      staleAssignedEntries: [staleAssigned],
    });

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.claimErrorsForCleanup
    ).toHaveBeenCalledWith({
      staleBefore: expect.any(String),
      limit: 100,
    });
    expect(
      deps.workerWarmPoolRepository.deleteUnreferencedAssignedForCleanup
    ).toHaveBeenCalledWith({
      staleBefore: expect.any(String),
      limit: 100,
    });
    expect(deps.workerWarmPoolQueueService.publishDelete).toHaveBeenCalledWith(
      expect.objectContaining({
        warm_pool_id: 'terminal-error',
        reason: 'pool_reconcile',
      })
    );
    expect(deps.workerWarmPoolQueueService.publishDelete).toHaveBeenCalledTimes(
      1
    );
  });

  it('leaves failed terminal cleanup claims deleting for cooldown redrive', async () => {
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const deps = makeActivity({
      terminalErrorEntries: [
        makeWarmPool({
          warm_pool_id: 'terminal-publish-failure',
          state: EWorkerWarmPoolState.error,
        }),
      ],
      publishDeleteReject: true,
    });

    await expect(deps.activity.scan()).resolves.toBeUndefined();

    expect(
      deps.workerWarmPoolRepository.restoreDeletingToReady
    ).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to publish terminal error warm cleanup',
      expect.objectContaining({
        warm_pool_id: 'terminal-publish-failure',
      })
    );
    consoleError.mockRestore();
  });

  it('discovers exact Docker-only standby orphans with docker ps -a and publishes cleanup', async () => {
    const deps = makeActivity({
      dockerOutput: `${ORPHAN_CONTAINER_ID}|warm-${ORPHAN_WARM_POOL_ID}|exited|Exited (1)|true|${ORPHAN_WARM_POOL_ID}|${EWorkerType.baileys}`,
      dockerExactOutput: exactHealthyWarmContainer({
        warmPoolId: ORPHAN_WARM_POOL_ID,
        containerId: ORPHAN_CONTAINER_ID,
      }),
    });

    await deps.activity.scan();

    expect(deps.sshService.runCommands).toHaveBeenCalledWith(
      'server-1',
      expect.anything(),
      [expect.stringContaining('docker ps -a --no-trunc --format')],
      false,
      expect.objectContaining({
        failOnNonZero: true,
        connectMaxAttempts: 1,
      })
    );
    expect(
      deps.workerWarmPoolRepository.isRuntimeReferenceActive
    ).toHaveBeenCalledWith({
      warmPoolId: ORPHAN_WARM_POOL_ID,
      containerName: `warm-${ORPHAN_WARM_POOL_ID}`,
      sessionVolumeName: `warm-${ORPHAN_WARM_POOL_ID}`,
    });
    expect(
      deps.workerWarmPoolRepository.claimDockerOrphanForCleanup
    ).toHaveBeenCalledWith({
      warmPoolId: ORPHAN_WARM_POOL_ID,
      serverId: 'server-1',
      workerTypeId: EWorkerType.baileys,
      containerId: ORPHAN_CONTAINER_ID,
      containerName: `warm-${ORPHAN_WARM_POOL_ID}`,
      sessionStorage: EWorkerSessionStorage.legacy_volume,
      sessionVolumeName: `warm-${ORPHAN_WARM_POOL_ID}`,
    });
    expect(deps.workerWarmPoolQueueService.publishDelete).toHaveBeenCalledWith(
      expect.objectContaining({
        warm_pool_id: ORPHAN_WARM_POOL_ID,
        container_name: `warm-${ORPHAN_WARM_POOL_ID}`,
        session_volume_name: `warm-${ORPHAN_WARM_POOL_ID}`,
        remove_volume: true,
        reason: 'pool_reconcile',
      })
    );
  });

  it('reassembles arbitrary SSH stdout chunks before parsing warm containers', async () => {
    const containerLine = `${ORPHAN_CONTAINER_ID}|warm-${ORPHAN_WARM_POOL_ID}|exited|Exited (1)|true|${ORPHAN_WARM_POOL_ID}|${EWorkerType.baileys}`;
    const deps = makeActivity({
      dockerExactOutput: exactHealthyWarmContainer({
        warmPoolId: ORPHAN_WARM_POOL_ID,
        containerId: ORPHAN_CONTAINER_ID,
      }),
    });
    deps.sshService.runCommands.mockResolvedValueOnce([
      { output: containerLine.slice(0, 17) },
      { output: containerLine.slice(17) },
    ]);

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.claimDockerOrphanForCleanup
    ).toHaveBeenCalledWith({
      warmPoolId: ORPHAN_WARM_POOL_ID,
      serverId: 'server-1',
      workerTypeId: EWorkerType.baileys,
      containerId: ORPHAN_CONTAINER_ID,
      containerName: `warm-${ORPHAN_WARM_POOL_ID}`,
      sessionStorage: EWorkerSessionStorage.legacy_volume,
      sessionVolumeName: `warm-${ORPHAN_WARM_POOL_ID}`,
    });
  });

  it('does not delete an exact warm standby that was adopted by worker_runtime', async () => {
    const deps = makeActivity({
      dockerOutput: `${ORPHAN_CONTAINER_ID}|warm-${ORPHAN_WARM_POOL_ID}|running|Up 1 minute|true|${ORPHAN_WARM_POOL_ID}|${EWorkerType.wwebjs}`,
      dockerExactOutput: exactHealthyWarmContainer({
        warmPoolId: ORPHAN_WARM_POOL_ID,
        containerId: ORPHAN_CONTAINER_ID,
        workerTypeId: EWorkerType.wwebjs,
      }),
      runtimeReferenceActive: true,
    });

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.isRuntimeReferenceActive
    ).toHaveBeenCalledTimes(1);
    expect(
      deps.workerWarmPoolRepository.claimDockerOrphanForCleanup
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishDelete
    ).not.toHaveBeenCalled();
  });

  it('does not treat a renamed adopted runtime as a Docker warm orphan', async () => {
    const deps = makeActivity({
      dockerOutput: `worker-live-channel|running|true|${ORPHAN_WARM_POOL_ID}|${EWorkerType.whatsmeow}`,
    });

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.isRuntimeReferenceActive
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.claimDockerOrphanForCleanup
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishDelete
    ).not.toHaveBeenCalled();
  });

  it('preserves an unhealthy ready runtime until manual recreation', async () => {
    const containerId = 'e'.repeat(64);
    const entry = makeWarmPool({
      warm_pool_id: ORPHAN_WARM_POOL_ID,
      container_id: containerId,
      container_name: `warm-${ORPHAN_WARM_POOL_ID}`,
      session_volume_name: `warm-${ORPHAN_WARM_POOL_ID}`,
      state: EWorkerWarmPoolState.ready,
    });
    const initial = `${containerId}|warm-${ORPHAN_WARM_POOL_ID}|running|Up 2 minutes (unhealthy)|true|${ORPHAN_WARM_POOL_ID}|${EWorkerType.baileys}`;
    const confirmed = exactHealthyWarmContainer({
      warmPoolId: ORPHAN_WARM_POOL_ID,
      containerId,
      health: 'unhealthy',
    });
    const deps = makeActivity({
      activeEntries: [entry],
      settings: { target_ready_baileys: 1 },
      activeCounts: {
        [EWorkerType.baileys]: 1,
        [EWorkerType.wwebjs]: 2,
        [EWorkerType.whatsmeow]: 2,
      },
      physicalOwnershipIds: [ORPHAN_WARM_POOL_ID],
      capacityOwnershipIds: [],
    });
    deps.sshService.runCommands
      .mockResolvedValueOnce([{ output: initial }])
      .mockResolvedValueOnce([{ output: confirmed }]);

    await deps.activity.scan();

    expect(deps.sshService.runCommands).toHaveBeenCalledTimes(2);
    for (const call of deps.sshService.runCommands.mock.calls) {
      expect(call[1]).toEqual(expect.objectContaining({ readyTimeout: 5_000 }));
      expect(call[4]).toEqual(
        expect.objectContaining({
          connectMaxAttempts: 1,
          commandTimeoutMs: 6_000,
        })
      );
    }
    expect(
      deps.workerWarmPoolRepository.claimMissingRuntimeForCleanup
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishDelete
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishReplenish
    ).not.toHaveBeenCalled();
  });

  it('preserves vanished and unhealthy ready runtimes until manual recreation', async () => {
    const vanishedWarmPoolId = '019f6f00-0000-7000-8000-000000000006';
    const unhealthyWarmPoolId = '019f6f00-0000-7000-8000-000000000007';
    const vanishedContainerId = '8'.repeat(64);
    const unhealthyContainerId = '9'.repeat(64);
    const vanished = makeWarmPool({
      warm_pool_id: vanishedWarmPoolId,
      container_id: vanishedContainerId,
      container_name: `warm-${vanishedWarmPoolId}`,
      session_volume_name: `warm-${vanishedWarmPoolId}`,
    });
    const unhealthy = makeWarmPool({
      warm_pool_id: unhealthyWarmPoolId,
      container_id: unhealthyContainerId,
      container_name: `warm-${unhealthyWarmPoolId}`,
      session_volume_name: `warm-${unhealthyWarmPoolId}`,
    });
    const initial = [
      `${vanishedContainerId}|warm-${vanishedWarmPoolId}|running|Up 2 minutes (unhealthy)|true|${vanishedWarmPoolId}|${EWorkerType.baileys}`,
      `${unhealthyContainerId}|warm-${unhealthyWarmPoolId}|running|Up 2 minutes (unhealthy)|true|${unhealthyWarmPoolId}|${EWorkerType.baileys}`,
    ].join('\n');
    const confirmedUnhealthy = exactHealthyWarmContainer({
      warmPoolId: unhealthyWarmPoolId,
      containerId: unhealthyContainerId,
      health: 'unhealthy',
    });
    const deps = makeActivity({
      activeEntries: [vanished, unhealthy],
      activeCounts: {
        [EWorkerType.baileys]: 2,
        [EWorkerType.wwebjs]: 2,
        [EWorkerType.whatsmeow]: 2,
      },
    });
    deps.sshService.runCommands
      .mockResolvedValueOnce([{ output: initial }])
      // The per-ID host loop suppresses only Docker's confirmed no-such result
      // for the first ID and still emits the second exact snapshot.
      .mockResolvedValueOnce([{ output: confirmedUnhealthy }]);
    const consoleWarn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    await deps.activity.scan();

    const exactInspectCommand =
      deps.sshService.runCommands.mock.calls[1]?.[2]?.[0] ?? '';
    expect(exactInspectCommand).toContain('docker inspect --type=container');
    expect(exactInspectCommand).toContain('No such (container|object)');
    expect(exactInspectCommand).toContain('unexpected=');
    expect(exactInspectCommand).toContain('with index .State "Health"');
    expect(exactInspectCommand).toContain(vanishedContainerId);
    expect(exactInspectCommand).toContain(unhealthyContainerId);
    expect(
      deps.workerWarmPoolRepository.claimMissingRuntimeForCleanup
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishDelete
    ).not.toHaveBeenCalled();
    consoleWarn.mockRestore();
  });

  it('fails closed when the unhealthy warm runtime recovered before re-inspection', async () => {
    const containerId = 'f'.repeat(64);
    const entry = makeWarmPool({
      warm_pool_id: ORPHAN_WARM_POOL_ID,
      container_id: containerId,
      container_name: `warm-${ORPHAN_WARM_POOL_ID}`,
      state: EWorkerWarmPoolState.ready,
    });
    const initial = `${containerId}|warm-${ORPHAN_WARM_POOL_ID}|running|Up 2 minutes (unhealthy)|true|${ORPHAN_WARM_POOL_ID}|${EWorkerType.baileys}`;
    const recovered = `${containerId}|/warm-${ORPHAN_WARM_POOL_ID}|running|healthy|true|${ORPHAN_WARM_POOL_ID}|${EWorkerType.baileys}`;
    const deps = makeActivity({ activeEntries: [entry] });
    deps.sshService.runCommands
      .mockResolvedValueOnce([{ output: initial }])
      .mockResolvedValueOnce([{ output: recovered }]);
    const consoleWarn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.claimMissingRuntimeForCleanup
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishDelete
    ).not.toHaveBeenCalled();
    consoleWarn.mockRestore();
  });

  it('fails closed when exact warm identity changes before re-inspection', async () => {
    const containerId = 'a'.repeat(64);
    const replacementContainerId = 'b'.repeat(64);
    const entry = makeWarmPool({
      warm_pool_id: ORPHAN_WARM_POOL_ID,
      container_id: containerId,
      container_name: `warm-${ORPHAN_WARM_POOL_ID}`,
      state: EWorkerWarmPoolState.ready,
    });
    const initial = `${containerId}|warm-${ORPHAN_WARM_POOL_ID}|running|Up 2 minutes (unhealthy)|true|${ORPHAN_WARM_POOL_ID}|${EWorkerType.baileys}`;
    const replacement = `${replacementContainerId}|/warm-${ORPHAN_WARM_POOL_ID}|running|unhealthy|true|${ORPHAN_WARM_POOL_ID}|${EWorkerType.baileys}`;
    const deps = makeActivity({ activeEntries: [entry] });
    deps.sshService.runCommands
      .mockResolvedValueOnce([{ output: initial }])
      .mockResolvedValueOnce([{ output: replacement }]);
    const consoleWarn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.claimMissingRuntimeForCleanup
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishDelete
    ).not.toHaveBeenCalled();
    consoleWarn.mockRestore();
  });

  it('never claims an activating warm runtime during unhealthy adoption', async () => {
    const containerId = '9'.repeat(64);
    const entry = makeWarmPool({
      warm_pool_id: ORPHAN_WARM_POOL_ID,
      container_id: containerId,
      container_name: `warm-${ORPHAN_WARM_POOL_ID}`,
      state: EWorkerWarmPoolState.activating,
    });
    const unhealthy = `${containerId}|warm-${ORPHAN_WARM_POOL_ID}|running|Up 2 minutes (unhealthy)|true|${ORPHAN_WARM_POOL_ID}|${EWorkerType.baileys}`;
    const confirmed = `${containerId}|/warm-${ORPHAN_WARM_POOL_ID}|running|unhealthy|true|${ORPHAN_WARM_POOL_ID}|${EWorkerType.baileys}`;
    const deps = makeActivity({ activeEntries: [entry] });
    deps.sshService.runCommands
      .mockResolvedValueOnce([{ output: unhealthy }])
      .mockResolvedValueOnce([{ output: confirmed }]);

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.claimMissingRuntimeForCleanup
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishDelete
    ).not.toHaveBeenCalled();
  });

  it('does not mutate ready rows from starting or legacy Docker health observations', async () => {
    const secondWarmPoolId = '019f6f00-0000-7000-8000-000000000002';
    const startingId = 'c'.repeat(64);
    const legacyId = 'd'.repeat(64);
    const initial = [
      `${startingId}|warm-${ORPHAN_WARM_POOL_ID}|running|Up 30 seconds (health: starting)|true|${ORPHAN_WARM_POOL_ID}|${EWorkerType.baileys}`,
      `${legacyId}|warm-${secondWarmPoolId}|running|Up 2 minutes|true|${secondWarmPoolId}|${EWorkerType.baileys}`,
    ].join('\n');
    const exact = [
      exactHealthyWarmContainer({
        warmPoolId: ORPHAN_WARM_POOL_ID,
        containerId: startingId,
        health: 'starting',
      }),
      exactHealthyWarmContainer({
        warmPoolId: secondWarmPoolId,
        containerId: legacyId,
        health: '',
      }),
    ].join('\n');
    const deps = makeActivity({
      activeEntries: [
        makeWarmPool({
          warm_pool_id: ORPHAN_WARM_POOL_ID,
          container_id: startingId,
          container_name: `warm-${ORPHAN_WARM_POOL_ID}`,
          session_volume_name: `warm-${ORPHAN_WARM_POOL_ID}`,
        }),
        makeWarmPool({
          warm_pool_id: secondWarmPoolId,
          container_id: legacyId,
          container_name: `warm-${secondWarmPoolId}`,
          session_volume_name: `warm-${secondWarmPoolId}`,
        }),
      ],
      dockerOutput: initial,
    });
    deps.sshService.runCommands
      .mockResolvedValueOnce([{ output: initial }])
      .mockResolvedValueOnce([{ output: exact }]);

    await deps.activity.scan();

    expect(deps.sshService.runCommands).toHaveBeenCalledTimes(2);
    expect(
      deps.workerWarmPoolRepository.observeStartingRuntime
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.claimMissingRuntimeForCleanup
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishDelete
    ).not.toHaveBeenCalled();
  });

  it('never records a starting marker for reserved or activating standbys', async () => {
    const reservedWarmPoolId = '019f6f00-0000-7000-8000-000000000004';
    const activatingWarmPoolId = '019f6f00-0000-7000-8000-000000000005';
    const reservedId = '2'.repeat(64);
    const activatingId = '3'.repeat(64);
    const deps = makeActivity({
      activeEntries: [
        makeWarmPool({
          warm_pool_id: reservedWarmPoolId,
          container_id: reservedId,
          container_name: `warm-${reservedWarmPoolId}`,
          session_volume_name: `warm-${reservedWarmPoolId}`,
          state: EWorkerWarmPoolState.reserved,
        }),
        makeWarmPool({
          warm_pool_id: activatingWarmPoolId,
          container_id: activatingId,
          container_name: `warm-${activatingWarmPoolId}`,
          session_volume_name: `warm-${activatingWarmPoolId}`,
          state: EWorkerWarmPoolState.activating,
        }),
      ],
    });
    deps.sshService.runCommands
      .mockResolvedValueOnce([
        {
          output: [
            `${reservedId}|warm-${reservedWarmPoolId}|running|Up 5 minutes (health: starting)|true|${reservedWarmPoolId}|${EWorkerType.baileys}`,
            `${activatingId}|warm-${activatingWarmPoolId}|running|Up 5 minutes (health: starting)|true|${activatingWarmPoolId}|${EWorkerType.baileys}`,
          ].join('\n'),
        },
      ])
      .mockResolvedValueOnce([
        {
          output: [
            `${reservedId}|/warm-${reservedWarmPoolId}|running|starting|true|${reservedWarmPoolId}|${EWorkerType.baileys}|2026-07-30T11:00:00.000Z|5|false`,
            `${activatingId}|/warm-${activatingWarmPoolId}|running|starting|true|${activatingWarmPoolId}|${EWorkerType.baileys}|2026-07-30T11:00:00.000Z|5|false`,
          ].join('\n'),
        },
      ]);

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.observeStartingRuntime
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.claimMissingRuntimeForCleanup
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishDelete
    ).not.toHaveBeenCalled();
  });

  it('preserves a ready runtime after a persistent starting timeout', async () => {
    const nowMs = Date.parse('2026-07-30T12:00:00.000Z');
    const dateNow = jest.spyOn(Date, 'now').mockReturnValue(nowMs);
    const containerId = '7'.repeat(64);
    const entry = makeWarmPool({
      warm_pool_id: ORPHAN_WARM_POOL_ID,
      container_id: containerId,
      container_name: `warm-${ORPHAN_WARM_POOL_ID}`,
      session_volume_name: `warm-${ORPHAN_WARM_POOL_ID}`,
    });
    const initial = `${containerId}|warm-${ORPHAN_WARM_POOL_ID}|running|Up 10 minutes (health: starting)|true|${ORPHAN_WARM_POOL_ID}|${EWorkerType.baileys}`;
    const exact = exactHealthyWarmContainer({
      warmPoolId: ORPHAN_WARM_POOL_ID,
      containerId,
      health: 'starting',
      restartCount: 8,
      startedAt: '2026-07-30T11:50:00.000Z',
    });
    const deps = makeActivity({
      activeEntries: [entry],
      settings: { target_ready_baileys: 1 },
      startingRuntimeMarker: `warm_runtime_starting:${nowMs - 301_000}:8`,
      activeCounts: {
        [EWorkerType.baileys]: 1,
        [EWorkerType.wwebjs]: 2,
        [EWorkerType.whatsmeow]: 2,
      },
      physicalOwnershipIds: [ORPHAN_WARM_POOL_ID],
      capacityOwnershipIds: [],
    });
    deps.sshService.runCommands
      .mockResolvedValueOnce([{ output: initial }])
      .mockResolvedValueOnce([{ output: exact }]);

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.observeStartingRuntime
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.claimMissingRuntimeForCleanup
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishDelete
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishReplenish
    ).not.toHaveBeenCalled();
    dateNow.mockRestore();
  });

  it('preserves exactly identified paused ready and activating standbys', async () => {
    const pausedId = '6'.repeat(64);
    const activatingId = '5'.repeat(64);
    const activatingWarmPoolId = '019f6f00-0000-7000-8000-000000000003';
    const paused = makeWarmPool({
      warm_pool_id: ORPHAN_WARM_POOL_ID,
      container_id: pausedId,
      container_name: `warm-${ORPHAN_WARM_POOL_ID}`,
      session_volume_name: `warm-${ORPHAN_WARM_POOL_ID}`,
    });
    const activating = makeWarmPool({
      warm_pool_id: activatingWarmPoolId,
      container_id: activatingId,
      container_name: `warm-${activatingWarmPoolId}`,
      session_volume_name: `warm-${activatingWarmPoolId}`,
      state: EWorkerWarmPoolState.activating,
    });
    const initial = [
      `${pausedId}|warm-${ORPHAN_WARM_POOL_ID}|running|Up 3 minutes (Paused)|true|${ORPHAN_WARM_POOL_ID}|${EWorkerType.baileys}`,
      `${activatingId}|warm-${activatingWarmPoolId}|running|Up 3 minutes (Paused)|true|${activatingWarmPoolId}|${EWorkerType.baileys}`,
    ].join('\n');
    const exact = [
      exactHealthyWarmContainer({
        warmPoolId: ORPHAN_WARM_POOL_ID,
        containerId: pausedId,
        paused: true,
      }),
      exactHealthyWarmContainer({
        warmPoolId: activatingWarmPoolId,
        containerId: activatingId,
        paused: true,
      }),
    ].join('\n');
    const deps = makeActivity({ activeEntries: [paused, activating] });
    deps.sshService.runCommands
      .mockResolvedValueOnce([{ output: initial }])
      .mockResolvedValueOnce([{ output: exact }]);

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.claimMissingRuntimeForCleanup
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishDelete
    ).not.toHaveBeenCalled();
  });

  it('does not clear a durable starting marker from Docker health alone', async () => {
    const containerId = '4'.repeat(64);
    const entry = makeWarmPool({
      warm_pool_id: ORPHAN_WARM_POOL_ID,
      container_id: containerId,
      container_name: `warm-${ORPHAN_WARM_POOL_ID}`,
      last_error: 'warm_runtime_starting:1000:3',
    });
    const initial = `${containerId}|warm-${ORPHAN_WARM_POOL_ID}|running|Up 2 minutes (health: starting)|true|${ORPHAN_WARM_POOL_ID}|${EWorkerType.baileys}`;
    const recovered = `${containerId}|/warm-${ORPHAN_WARM_POOL_ID}|running|healthy|true|${ORPHAN_WARM_POOL_ID}|${EWorkerType.baileys}|2026-07-30T11:58:00.000Z|3|false`;
    const deps = makeActivity({ activeEntries: [entry] });
    deps.sshService.runCommands
      .mockResolvedValueOnce([{ output: initial }])
      .mockResolvedValueOnce([{ output: recovered }]);

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.confirmHealthyReadyRuntime
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.claimMissingRuntimeForCleanup
    ).not.toHaveBeenCalled();
  });

  it('does not refresh a health lease from a healthy Docker list alone', async () => {
    const containerId = '1'.repeat(64);
    const entry = makeWarmPool({
      warm_pool_id: ORPHAN_WARM_POOL_ID,
      container_id: containerId,
      container_name: `warm-${ORPHAN_WARM_POOL_ID}`,
      last_error: null,
    });
    const deps = makeActivity({
      activeEntries: [entry],
      dockerOutput: `${containerId}|warm-${ORPHAN_WARM_POOL_ID}|running|Up 2 minutes (healthy)|true|${ORPHAN_WARM_POOL_ID}|${EWorkerType.baileys}`,
    });

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.confirmHealthyReadyRuntime
    ).not.toHaveBeenCalled();
  });

  it('preserves returned ready reservations even when capacity is above target', async () => {
    const returned = [
      makeWarmPool({ warm_pool_id: 'returned-1' }),
      makeWarmPool({ warm_pool_id: 'returned-2' }),
    ];
    const deps = makeActivity({
      settings: { target_ready_baileys: 4 },
      activeCounts: {
        [EWorkerType.baileys]: 6,
        [EWorkerType.wwebjs]: 2,
        [EWorkerType.whatsmeow]: 2,
      },
      readyExcessEntries: {
        [EWorkerType.baileys]: returned,
      },
    });

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.markReadyExcessAsDeleting
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishDelete
    ).not.toHaveBeenCalled();
  });

  it('preserves a stopped ready warm runtime until manual recreation', async () => {
    const stoppedContainerId = '9'.repeat(64);
    const stopped = makeWarmPool({
      warm_pool_id: ORPHAN_WARM_POOL_ID,
      container_id: stoppedContainerId,
      container_name: `warm-${ORPHAN_WARM_POOL_ID}`,
      session_volume_name: `warm-${ORPHAN_WARM_POOL_ID}`,
      state: EWorkerWarmPoolState.ready,
    });
    const deps = makeActivity({
      activeEntries: [stopped],
      dockerOutput: `${stoppedContainerId}|warm-${ORPHAN_WARM_POOL_ID}|exited|Exited (1)|true|${ORPHAN_WARM_POOL_ID}|${EWorkerType.baileys}`,
      dockerExactOutput: exactHealthyWarmContainer({
        warmPoolId: ORPHAN_WARM_POOL_ID,
        containerId: stoppedContainerId,
        state: 'exited',
        health: 'none',
      }),
    });

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.claimMissingRuntimeForCleanup
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.claimDockerOrphanForCleanup
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishDelete
    ).not.toHaveBeenCalled();
  });

  it('blocks replenish while exact physical standbys already fill the target', async () => {
    const secondWarmPoolId = '019f6f00-0000-7000-8000-000000000002';
    const firstContainerId = '4'.repeat(64);
    const secondContainerId = '5'.repeat(64);
    const entries = [
      makeWarmPool({
        warm_pool_id: ORPHAN_WARM_POOL_ID,
        container_id: firstContainerId,
        container_name: `warm-${ORPHAN_WARM_POOL_ID}`,
        session_volume_name: `warm-${ORPHAN_WARM_POOL_ID}`,
      }),
      makeWarmPool({
        warm_pool_id: secondWarmPoolId,
        container_id: secondContainerId,
        container_name: `warm-${secondWarmPoolId}`,
        session_volume_name: `warm-${secondWarmPoolId}`,
      }),
    ];
    const deps = makeActivity({
      activeEntries: entries,
      activeCounts: {
        [EWorkerType.baileys]: 0,
        [EWorkerType.wwebjs]: 2,
        [EWorkerType.whatsmeow]: 2,
      },
      dockerOutput: [
        `${firstContainerId}|warm-${ORPHAN_WARM_POOL_ID}|running|Up 1 minute (healthy)|true|${ORPHAN_WARM_POOL_ID}|${EWorkerType.baileys}`,
        `${secondContainerId}|warm-${secondWarmPoolId}|running|Up 1 minute (healthy)|true|${secondWarmPoolId}|${EWorkerType.baileys}`,
      ].join('\n'),
      dockerExactOutput: [
        exactHealthyWarmContainer({
          warmPoolId: ORPHAN_WARM_POOL_ID,
          containerId: firstContainerId,
        }),
        exactHealthyWarmContainer({
          warmPoolId: secondWarmPoolId,
          containerId: secondContainerId,
        }),
      ].join('\n'),
    });

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolQueueService.publishReplenish
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.claimDockerOrphanForCleanup
    ).not.toHaveBeenCalled();
  });

  it('isolates an ambiguous typed warm container to its provider', async () => {
    const containerId = '6'.repeat(64);
    const foreignServerInspection = exactHealthyWarmContainer({
      warmPoolId: ORPHAN_WARM_POOL_ID,
      containerId,
      createdAt: new Date().toISOString(),
    }).replace('|server-1|', '|server-foreign|');
    const deps = makeActivity({
      activeCounts: {
        [EWorkerType.baileys]: 0,
        [EWorkerType.wwebjs]: 0,
        [EWorkerType.whatsmeow]: 0,
      },
      dockerOutput: `${containerId}|warm-${ORPHAN_WARM_POOL_ID}|running|Up 1 minute|true|${ORPHAN_WARM_POOL_ID}|${EWorkerType.baileys}`,
      dockerExactOutput: foreignServerInspection,
    });

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.claimDockerOrphanForCleanup
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishDelete
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishReplenish.mock.calls.map(
        ([request]) => request.worker_type_id
      )
    ).toEqual(
      repeatedWorkerTypes([EWorkerType.wwebjs, 2], [EWorkerType.whatsmeow, 2])
    );
  });

  it('blocks all providers for an ambiguous warm container without a type', async () => {
    const containerId = '6'.repeat(64);
    const unscopedInspection = exactHealthyWarmContainer({
      warmPoolId: ORPHAN_WARM_POOL_ID,
      containerId,
      createdAt: new Date().toISOString(),
    }).replace(`|${EWorkerType.baileys}|`, '||');
    const deps = makeActivity({
      activeCounts: {
        [EWorkerType.baileys]: 0,
        [EWorkerType.wwebjs]: 0,
        [EWorkerType.whatsmeow]: 0,
      },
      dockerOutput: `${containerId}|warm-${ORPHAN_WARM_POOL_ID}|running|Up 1 minute|true|${ORPHAN_WARM_POOL_ID}||`,
      dockerExactOutput: unscopedInspection,
    });

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolQueueService.publishReplenish
    ).not.toHaveBeenCalled();
  });

  it('replenishes only to configured targets beside a twice-observed old typed ambiguity without deleting it', async () => {
    const containerId = '6'.repeat(64);
    const foreignServerInspection = exactHealthyWarmContainer({
      warmPoolId: ORPHAN_WARM_POOL_ID,
      containerId,
      createdAt: new Date(Date.now() - 240_000).toISOString(),
    }).replace('|server-1|', '|server-foreign|');
    const deps = makeActivity({
      settings: {
        target_ready_baileys: 4,
        target_ready_wwebjs: 2,
        target_ready_whatsmeow: 2,
      },
      activeCounts: {
        [EWorkerType.baileys]: 3,
        [EWorkerType.wwebjs]: 2,
        [EWorkerType.whatsmeow]: 2,
      },
      dockerOutput: `${containerId}|warm-${ORPHAN_WARM_POOL_ID}|running|Up 1 minute|true|${ORPHAN_WARM_POOL_ID}|${EWorkerType.baileys}`,
      dockerExactOutput: foreignServerInspection,
    });
    const consoleWarn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    await deps.activity.scan();
    expect(
      deps.workerWarmPoolQueueService.publishReplenish
    ).not.toHaveBeenCalled();

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolQueueService.publishReplenish
    ).toHaveBeenCalledTimes(1);
    expect(
      deps.workerWarmPoolQueueService.publishReplenish
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
      })
    );
    expect(
      deps.workerWarmPoolRepository.claimDockerOrphanForCleanup
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishDelete
    ).not.toHaveBeenCalled();
    consoleWarn.mockRestore();
  });

  it('releases all provider deficits beside a twice-observed old untyped ambiguity without deleting it', async () => {
    const containerId = '6'.repeat(64);
    const unscopedInspection = exactHealthyWarmContainer({
      warmPoolId: ORPHAN_WARM_POOL_ID,
      containerId,
      createdAt: new Date(Date.now() - 240_000).toISOString(),
    }).replace(`|${EWorkerType.baileys}|`, '||');
    const deps = makeActivity({
      activeCounts: {
        [EWorkerType.baileys]: 0,
        [EWorkerType.wwebjs]: 0,
        [EWorkerType.whatsmeow]: 0,
      },
      dockerOutput: `${containerId}|warm-${ORPHAN_WARM_POOL_ID}|running|Up 1 minute|true|${ORPHAN_WARM_POOL_ID}||`,
      dockerExactOutput: unscopedInspection,
    });
    const consoleWarn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    await deps.activity.scan();
    expect(
      deps.workerWarmPoolQueueService.publishReplenish
    ).not.toHaveBeenCalled();

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolQueueService.publishReplenish.mock.calls.map(
        ([request]) => request.worker_type_id
      )
    ).toEqual(
      repeatedWorkerTypes(
        [EWorkerType.baileys, 2],
        [EWorkerType.wwebjs, 2],
        [EWorkerType.whatsmeow, 2]
      )
    );
    expect(
      deps.workerWarmPoolRepository.claimDockerOrphanForCleanup
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishDelete
    ).not.toHaveBeenCalled();
    consoleWarn.mockRestore();
  });

  it('keeps a repeatedly observed young ambiguity fenced until its grace expires', async () => {
    const containerId = '6'.repeat(64);
    let nowMs = Date.parse('2026-07-30T12:00:00.000Z');
    const dateNow = jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
    const unscopedInspection = exactHealthyWarmContainer({
      warmPoolId: ORPHAN_WARM_POOL_ID,
      containerId,
      startedAt: '2026-07-30T12:00:00.000Z',
      createdAt: '2026-07-30T12:00:00.000Z',
    }).replace(`|${EWorkerType.baileys}|`, '||');
    const deps = makeActivity({
      settings: { warming_stale_after_seconds: 1 },
      activeCounts: {
        [EWorkerType.baileys]: 0,
        [EWorkerType.wwebjs]: 0,
        [EWorkerType.whatsmeow]: 0,
      },
      dockerOutput: `${containerId}|warm-${ORPHAN_WARM_POOL_ID}|running|Up 1 second|true|${ORPHAN_WARM_POOL_ID}||`,
      dockerExactOutput: unscopedInspection,
    });
    const consoleWarn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    await deps.activity.scan();
    await deps.activity.scan();
    expect(
      deps.workerWarmPoolQueueService.publishReplenish
    ).not.toHaveBeenCalled();

    nowMs += 1_001;
    await deps.activity.scan();

    expect(
      deps.workerWarmPoolQueueService.publishReplenish
    ).toHaveBeenCalledTimes(6);
    consoleWarn.mockRestore();
    dateNow.mockRestore();
  });

  it('cannot refreeze an extended-old exact ambiguity after scheduler observation state is lost', async () => {
    const containerId = '6'.repeat(64);
    const unscopedInspection = exactHealthyWarmContainer({
      warmPoolId: ORPHAN_WARM_POOL_ID,
      containerId,
      createdAt: new Date(Date.now() - 400_000).toISOString(),
    }).replace(`|${EWorkerType.baileys}|`, '||');
    const deps = makeActivity({
      activeCounts: {
        [EWorkerType.baileys]: 0,
        [EWorkerType.wwebjs]: 0,
        [EWorkerType.whatsmeow]: 0,
      },
      dockerOutput: `${containerId}|warm-${ORPHAN_WARM_POOL_ID}|running|Up 10 minutes|true|${ORPHAN_WARM_POOL_ID}||`,
      dockerExactOutput: unscopedInspection,
    });
    const consoleWarn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolQueueService.publishReplenish
    ).toHaveBeenCalledTimes(6);
    expect(
      deps.workerWarmPoolQueueService.publishDelete
    ).not.toHaveBeenCalled();
    consoleWarn.mockRestore();
  });

  it('resets ambiguous identity proof after an intermittent SSH inventory failure', async () => {
    const containerId = '6'.repeat(64);
    const unscopedInspection = exactHealthyWarmContainer({
      warmPoolId: ORPHAN_WARM_POOL_ID,
      containerId,
      createdAt: new Date(Date.now() - 240_000).toISOString(),
    }).replace(`|${EWorkerType.baileys}|`, '||');
    const raw = `${containerId}|warm-${ORPHAN_WARM_POOL_ID}|running|Up 1 minute|true|${ORPHAN_WARM_POOL_ID}||`;
    const deps = makeActivity({
      activeCounts: {
        [EWorkerType.baileys]: 0,
        [EWorkerType.wwebjs]: 0,
        [EWorkerType.whatsmeow]: 0,
      },
    });
    let inventoryCount = 0;
    deps.sshService.runCommands.mockImplementation(
      async (_serverId: string, _config: unknown, commands: string[]) => {
        const command = String(commands[0] ?? '');
        if (command.includes('docker ps -a --no-trunc')) {
          inventoryCount += 1;
          if (inventoryCount === 2) {
            throw new Error('SSH inventory unavailable');
          }
          return [{ output: raw }];
        }
        if (command.includes('docker inspect --type=container')) {
          return [{ output: unscopedInspection }];
        }
        return [{ output: '' }];
      }
    );
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await deps.activity.scan();
    await expect(deps.activity.scan()).rejects.toThrow(
      'warm_physical_snapshot_unavailable'
    );
    await deps.activity.scan();
    expect(
      deps.workerWarmPoolQueueService.publishReplenish
    ).not.toHaveBeenCalled();

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolQueueService.publishReplenish
    ).toHaveBeenCalledTimes(6);
    consoleError.mockRestore();
  });

  it('drops ambiguity history and converges immediately after the physical conflict resolves', async () => {
    const containerId = '6'.repeat(64);
    const unscopedInspection = exactHealthyWarmContainer({
      warmPoolId: ORPHAN_WARM_POOL_ID,
      containerId,
      createdAt: new Date().toISOString(),
    }).replace(`|${EWorkerType.baileys}|`, '||');
    const deps = makeActivity({
      activeCounts: {
        [EWorkerType.baileys]: 0,
        [EWorkerType.wwebjs]: 0,
        [EWorkerType.whatsmeow]: 0,
      },
    });
    let conflictPresent = true;
    deps.sshService.runCommands.mockImplementation(
      async (_serverId: string, _config: unknown, commands: string[]) => {
        const command = String(commands[0] ?? '');
        if (command.includes('docker ps -a --no-trunc')) {
          return [
            {
              output: conflictPresent
                ? `${containerId}|warm-${ORPHAN_WARM_POOL_ID}|running|Up 1 minute|true|${ORPHAN_WARM_POOL_ID}||`
                : '__underchat_warm_volumes_v1__',
            },
          ];
        }
        if (command.includes('docker inspect --type=container')) {
          return [{ output: unscopedInspection }];
        }
        return [{ output: '' }];
      }
    );

    await deps.activity.scan();
    conflictPresent = false;
    await deps.activity.scan();

    expect(
      deps.workerWarmPoolQueueService.publishReplenish.mock.calls.map(
        ([request]) => request.worker_type_id
      )
    ).toEqual(
      repeatedWorkerTypes(
        [EWorkerType.baileys, 2],
        [EWorkerType.wwebjs, 2],
        [EWorkerType.whatsmeow, 2]
      )
    );
  });

  it('ignores one strictly adopted active runtime and replenishes every provider deficit independently', async () => {
    const adoptedContainerId = '7'.repeat(64);
    const adopted = exactAdoptedWarmContainer({
      warmPoolId: ORPHAN_WARM_POOL_ID,
      containerId: adoptedContainerId,
    });
    const deps = makeActivity({
      settings: {
        target_ready_baileys: 4,
        target_ready_wwebjs: 2,
        target_ready_whatsmeow: 2,
      },
      activeCounts: {
        [EWorkerType.baileys]: 3,
        [EWorkerType.wwebjs]: 1,
        [EWorkerType.whatsmeow]: 1,
      },
      dockerOutput: adopted,
      dockerExactOutput: adopted,
      adoptedRuntimeIdentities: [
        adoptedRuntimeIdentity({
          warmPoolId: ORPHAN_WARM_POOL_ID,
          containerId: adoptedContainerId,
        }),
      ],
    });

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.listAdoptedRuntimeIdentitiesByServer
    ).toHaveBeenCalledWith('server-1');
    expect(
      deps.workerWarmPoolQueueService.publishReplenish
    ).toHaveBeenCalledTimes(3);
    expect(
      deps.workerWarmPoolQueueService.publishReplenish.mock.calls.map(
        ([request]) => request.worker_type_id
      )
    ).toEqual([EWorkerType.baileys, EWorkerType.wwebjs, EWorkerType.whatsmeow]);
  });

  it('replenishes S10-style deficits beside DB-proven legacy adopted runtimes for every provider', async () => {
    const legacyRuntimes = [
      {
        workerTypeId: EWorkerType.baileys,
        warmPoolId: '019f6f00-0000-7000-8000-000000000031',
        workerId: '019f6f00-0000-7000-8000-000000000041',
        accountId: '019f6f00-0000-7000-8000-000000000051',
        containerId: 'a'.repeat(64),
      },
      {
        workerTypeId: EWorkerType.wwebjs,
        warmPoolId: '019f6f00-0000-7000-8000-000000000032',
        workerId: '019f6f00-0000-7000-8000-000000000042',
        accountId: '019f6f00-0000-7000-8000-000000000052',
        containerId: 'b'.repeat(64),
      },
      {
        workerTypeId: EWorkerType.whatsmeow,
        warmPoolId: '019f6f00-0000-7000-8000-000000000033',
        workerId: '019f6f00-0000-7000-8000-000000000043',
        accountId: '019f6f00-0000-7000-8000-000000000053',
        containerId: 'c'.repeat(64),
      },
    ];
    const exactLegacyContainers = legacyRuntimes.map((runtime) =>
      exactLegacyAdoptedWarmContainer(runtime)
    );
    const deps = makeActivity({
      settings: {
        target_ready_baileys: 4,
        target_ready_wwebjs: 4,
        target_ready_whatsmeow: 4,
      },
      activeCounts: {
        [EWorkerType.baileys]: 0,
        [EWorkerType.wwebjs]: 0,
        [EWorkerType.whatsmeow]: 0,
      },
      dockerOutput: exactLegacyContainers.join('\n'),
      dockerExactOutput: exactLegacyContainers.join('\n'),
      adoptedRuntimeIdentities: legacyRuntimes.map((runtime) =>
        adoptedRuntimeIdentity({
          ...runtime,
          operationId: ADOPTED_OPERATION_ID,
        })
      ),
    });

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.listAdoptedRuntimeIdentitiesByServer
    ).toHaveBeenCalledWith('server-1');
    expect(
      deps.workerWarmPoolQueueService.publishReplenish.mock.calls.map(
        ([request]) => request.worker_type_id
      )
    ).toEqual(
      repeatedWorkerTypes(
        [EWorkerType.baileys, 4],
        [EWorkerType.wwebjs, 4],
        [EWorkerType.whatsmeow, 4]
      )
    );
    expect(
      deps.workerWarmPoolRepository.claimDockerOrphanForCleanup
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishDelete
    ).not.toHaveBeenCalled();
  });

  it('replenishes only the S11-style Baileys deficit beside a DB-proven legacy adopted runtime', async () => {
    const legacyRuntime = {
      workerTypeId: EWorkerType.baileys,
      warmPoolId: '019f6f00-0000-7000-8000-000000000061',
      workerId: '019f6f00-0000-7000-8000-000000000062',
      accountId: '019f6f00-0000-7000-8000-000000000063',
      containerId: 'e'.repeat(64),
    };
    const exactLegacyContainer = exactLegacyAdoptedWarmContainer({
      ...legacyRuntime,
      createdAt: new Date().toISOString(),
    });
    const deps = makeActivity({
      settings: {
        target_ready_baileys: 4,
        target_ready_wwebjs: 4,
        target_ready_whatsmeow: 4,
      },
      activeCounts: {
        [EWorkerType.baileys]: 0,
        [EWorkerType.wwebjs]: 4,
        [EWorkerType.whatsmeow]: 4,
      },
      dockerOutput: exactLegacyContainer,
      dockerExactOutput: exactLegacyContainer,
      adoptedRuntimeIdentities: [
        adoptedRuntimeIdentity({
          ...legacyRuntime,
          operationId: ADOPTED_OPERATION_ID,
        }),
      ],
    });

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolQueueService.publishReplenish.mock.calls.map(
        ([request]) => request.worker_type_id
      )
    ).toEqual(repeatedWorkerTypes([EWorkerType.baileys, 4]));
    expect(
      deps.workerWarmPoolRepository.claimDockerOrphanForCleanup
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishDelete
    ).not.toHaveBeenCalled();
  });

  it('keeps a contradictory legacy adopted runtime fail-closed without gaining deletion authority', async () => {
    const legacyRuntime = {
      workerTypeId: EWorkerType.baileys,
      warmPoolId: '019f6f00-0000-7000-8000-000000000071',
      workerId: '019f6f00-0000-7000-8000-000000000072',
      accountId: '019f6f00-0000-7000-8000-000000000073',
      containerId: 'f'.repeat(64),
    };
    const exactLegacyContainer = exactLegacyAdoptedWarmContainer({
      ...legacyRuntime,
      createdAt: new Date().toISOString(),
    });
    const deps = makeActivity({
      activeCounts: {
        [EWorkerType.baileys]: 0,
        [EWorkerType.wwebjs]: 0,
        [EWorkerType.whatsmeow]: 0,
      },
      dockerOutput: exactLegacyContainer,
      dockerExactOutput: exactLegacyContainer,
      adoptedRuntimeIdentities: [
        adoptedRuntimeIdentity({
          ...legacyRuntime,
          sessionVolumeName: 'warm-019f6f00-0000-7000-8000-000000000099',
        }),
      ],
    });

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolQueueService.publishReplenish.mock.calls.map(
        ([request]) => request.worker_type_id
      )
    ).toEqual(
      repeatedWorkerTypes([EWorkerType.wwebjs, 2], [EWorkerType.whatsmeow, 2])
    );
    expect(
      deps.workerWarmPoolRepository.claimDockerOrphanForCleanup
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishDelete
    ).not.toHaveBeenCalled();
  });

  it.each([
    EWorkerStatus.offline,
    EWorkerStatus.mismatched,
    EWorkerStatus.error,
    EWorkerStatus.deleting,
    EWorkerStatus.blocked,
  ])(
    'keeps an exactly adopted runtime isolated from warm capacity while its worker is %s',
    async (workerStatusId) => {
      const adoptedContainerId = '7'.repeat(64);
      const adopted = exactAdoptedWarmContainer({
        warmPoolId: ORPHAN_WARM_POOL_ID,
        containerId: adoptedContainerId,
      });
      const deps = makeActivity({
        activeCounts: {
          [EWorkerType.baileys]: 0,
          [EWorkerType.wwebjs]: 0,
          [EWorkerType.whatsmeow]: 0,
        },
        dockerOutput: adopted,
        dockerExactOutput: adopted,
        adoptedRuntimeIdentities: [
          adoptedRuntimeIdentity({
            warmPoolId: ORPHAN_WARM_POOL_ID,
            containerId: adoptedContainerId,
            workerStatusId,
          }),
        ],
      });

      await deps.activity.scan();

      expect(
        deps.workerWarmPoolQueueService.publishReplenish.mock.calls.map(
          ([request]) => request.worker_type_id
        )
      ).toEqual(
        repeatedWorkerTypes(
          [EWorkerType.baileys, 2],
          [EWorkerType.wwebjs, 2],
          [EWorkerType.whatsmeow, 2]
        )
      );
    }
  );

  it('keeps fail-closed when warm_standby=false lacks matching durable identity', async () => {
    const adoptedContainerId = '7'.repeat(64);
    const incomplete = exactAdoptedWarmContainer({
      warmPoolId: ORPHAN_WARM_POOL_ID,
      containerId: adoptedContainerId,
      runtimeGeneration: null,
      createdAt: new Date().toISOString(),
    });
    const deps = makeActivity({
      activeCounts: {
        [EWorkerType.baileys]: 0,
        [EWorkerType.wwebjs]: 0,
        [EWorkerType.whatsmeow]: 0,
      },
      dockerOutput: incomplete,
      dockerExactOutput: incomplete,
    });

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.listAdoptedRuntimeIdentitiesByServer
    ).toHaveBeenCalledWith('server-1');
    expect(
      deps.workerWarmPoolQueueService.publishReplenish.mock.calls.map(
        ([request]) => request.worker_type_id
      )
    ).toEqual(
      repeatedWorkerTypes([EWorkerType.wwebjs, 2], [EWorkerType.whatsmeow, 2])
    );
  });

  it('keeps fail-closed when Docker adoption metadata conflicts with durable lineage', async () => {
    const adoptedContainerId = '7'.repeat(64);
    const adopted = exactAdoptedWarmContainer({
      warmPoolId: ORPHAN_WARM_POOL_ID,
      containerId: adoptedContainerId,
      createdAt: new Date().toISOString(),
    });
    const deps = makeActivity({
      activeCounts: {
        [EWorkerType.baileys]: 0,
        [EWorkerType.wwebjs]: 0,
        [EWorkerType.whatsmeow]: 0,
      },
      dockerOutput: adopted,
      dockerExactOutput: adopted,
      adoptedRuntimeIdentities: [
        adoptedRuntimeIdentity({
          warmPoolId: '019f6f00-0000-7000-8000-000000000099',
          containerId: adoptedContainerId,
        }),
      ],
    });

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.listAdoptedRuntimeIdentitiesByServer
    ).toHaveBeenCalledWith('server-1');
    expect(
      deps.workerWarmPoolQueueService.publishReplenish.mock.calls.map(
        ([request]) => request.worker_type_id
      )
    ).toEqual(
      repeatedWorkerTypes([EWorkerType.wwebjs, 2], [EWorkerType.whatsmeow, 2])
    );
  });

  it('captures an immutable late-created container for a stale warming row', async () => {
    const containerId = '8'.repeat(64);
    const staleUpdatedAt = '2026-07-29T10:00:00.000Z';
    const stale = makeWarmPool({
      warm_pool_id: ORPHAN_WARM_POOL_ID,
      container_id: null,
      container_name: null,
      session_volume_name: `warm-${ORPHAN_WARM_POOL_ID}`,
      state: EWorkerWarmPoolState.warming,
      created_at: staleUpdatedAt,
      updated_at: staleUpdatedAt,
    });
    const claimed = {
      ...stale,
      container_id: containerId,
      container_name: `warm-${ORPHAN_WARM_POOL_ID}`,
      state: EWorkerWarmPoolState.deleting,
      last_error: 'warm_creation_unpersisted_physical_runtime',
    };
    const deps = makeActivity({
      activeEntries: [stale],
      dockerOutput: `${containerId}|warm-${ORPHAN_WARM_POOL_ID}|running|Up 1 minute (healthy)|true|${ORPHAN_WARM_POOL_ID}|${EWorkerType.baileys}`,
      dockerExactOutput: exactHealthyWarmContainer({
        warmPoolId: ORPHAN_WARM_POOL_ID,
        containerId,
      }),
      unpersistedWarmingClaim: claimed,
    });

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.claimUnpersistedWarmingRuntimeForCleanup
    ).toHaveBeenCalledWith({
      warmPoolId: ORPHAN_WARM_POOL_ID,
      serverId: 'server-1',
      workerTypeId: EWorkerType.baileys,
      expectedWarmUpdatedAt: staleUpdatedAt,
      containerId,
      containerName: `warm-${ORPHAN_WARM_POOL_ID}`,
      sessionStorage: EWorkerSessionStorage.legacy_volume,
      sessionVolumeName: `warm-${ORPHAN_WARM_POOL_ID}`,
    });
    expect(deps.workerWarmPoolQueueService.publishDelete).toHaveBeenCalledWith(
      expect.objectContaining({
        warm_pool_id: ORPHAN_WARM_POOL_ID,
        container_id: containerId,
      })
    );
  });

  it('removes only a twice-observed, old and ownership-labelled orphan volume', async () => {
    const volumeName = `warm-${ORPHAN_WARM_POOL_ID}`;
    const volumeSnapshot =
      `__underchat_warm_volumes_v1__\n` +
      `${volumeName}|2026-07-29T10:00:00.000Z|${ORPHAN_WARM_POOL_ID}|server-1`;
    const deps = makeActivity({
      settings: { warmup_enabled: false },
    });
    deps.sshService.runCommands.mockImplementation(
      async (_serverId: string, _config: unknown, commands: string[]) => {
        const command = commands[0] ?? '';
        if (command.includes('docker volume rm')) {
          return [{ output: 'removed' }];
        }
        if (command.includes('docker ps -a --no-trunc')) {
          return [{ output: volumeSnapshot }];
        }
        if (command.includes('docker volume inspect --format')) {
          return [
            {
              output: `${volumeName}|2026-07-29T10:00:00.000Z|${ORPHAN_WARM_POOL_ID}|server-1`,
            },
          ];
        }
        return [{ output: '' }];
      }
    );

    await deps.activity.scan();
    expect(
      deps.sshService.runCommands.mock.calls.some((call) =>
        String(call[2]?.[0]).includes('docker volume rm')
      )
    ).toBe(false);

    await deps.activity.scan();

    expect(
      deps.sshService.runCommands.mock.calls.filter((call) =>
        String(call[2]?.[0]).includes('docker volume rm')
      )
    ).toHaveLength(1);
    expect(
      deps.workerWarmPoolRepository.isRuntimeReferenceActive
    ).toHaveBeenCalledWith({
      warmPoolId: ORPHAN_WARM_POOL_ID,
      containerName: volumeName,
      sessionVolumeName: volumeName,
    });
  });

  it('never auto-removes an unlabelled legacy warm-shaped volume', async () => {
    const volumeName = `warm-${ORPHAN_WARM_POOL_ID}`;
    const volumeSnapshot =
      `__underchat_warm_volumes_v1__\n` +
      `${volumeName}|2026-07-29T10:00:00.000Z||`;
    const deps = makeActivity({
      settings: { warmup_enabled: false },
    });
    deps.sshService.runCommands.mockImplementation(
      async (_serverId: string, _config: unknown, commands: string[]) => {
        const command = commands[0] ?? '';
        if (command.includes('docker volume rm')) {
          return [{ output: 'removed' }];
        }
        if (command.includes('docker ps -a --no-trunc')) {
          return [{ output: volumeSnapshot }];
        }
        if (command.includes('docker volume inspect --format')) {
          return [
            {
              output: `${volumeName}|2026-07-29T10:00:00.000Z||`,
            },
          ];
        }
        return [{ output: '' }];
      }
    );

    await deps.activity.scan();
    expect(
      deps.sshService.runCommands.mock.calls.some((call) =>
        String(call[2]?.[0]).includes('docker volume rm')
      )
    ).toBe(false);

    await deps.activity.scan();

    expect(
      deps.sshService.runCommands.mock.calls.filter((call) =>
        String(call[2]?.[0]).includes('docker volume rm')
      )
    ).toHaveLength(0);
    expect(
      deps.workerWarmPoolRepository.viewByIdConsistent
    ).not.toHaveBeenCalled();
  });

  it('preserves a legacy volume referenced by a promoted worker runtime', async () => {
    const volumeName = `warm-${ORPHAN_WARM_POOL_ID}`;
    const deps = makeActivity({
      settings: { warmup_enabled: false },
      runtimeReferenceActive: true,
    });
    deps.sshService.runCommands.mockResolvedValue([
      {
        output:
          `__underchat_warm_volumes_v1__\n` +
          `${volumeName}|2026-07-29T10:00:00.000Z||`,
      },
    ]);

    await deps.activity.scan();
    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.isRuntimeReferenceActive
    ).not.toHaveBeenCalled();
    expect(
      deps.sshService.runCommands.mock.calls.some(
        (call) =>
          String(call[2]?.[0]).includes('docker volume inspect --format') &&
          !String(call[2]?.[0]).includes('docker ps -a --no-trunc')
      )
    ).toBe(false);
    expect(
      deps.sshService.runCommands.mock.calls.some((call) =>
        String(call[2]?.[0]).includes('docker volume rm')
      )
    ).toBe(false);
  });

  it('preserves a legacy volume mounted by a stopped promoted container', async () => {
    const volumeName = `warm-${ORPHAN_WARM_POOL_ID}`;
    const stoppedPromotedContainer = [
      'a'.repeat(64),
      'promoted-worker',
      'exited',
      'Exited (0)',
      '',
      '',
      '',
      '',
      '',
      '',
      'server-1',
      '',
      'worker-1',
      'account-1',
      '',
      '',
      '',
      '',
      volumeName,
    ].join('|');
    const deps = makeActivity({
      settings: { warmup_enabled: false },
    });
    deps.sshService.runCommands.mockResolvedValue([
      {
        output:
          `${stoppedPromotedContainer}\n` +
          `__underchat_warm_volumes_v1__\n` +
          `${volumeName}|2026-07-29T10:00:00.000Z||`,
      },
    ]);

    await deps.activity.scan();
    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.viewByIdConsistent
    ).not.toHaveBeenCalled();
    expect(
      deps.sshService.runCommands.mock.calls.some((call) =>
        String(call[2]?.[0]).includes('docker volume rm')
      )
    ).toBe(false);
  });

  it('preserves a legacy orphan whenever the primary database is ambiguous', async () => {
    const consoleWarn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const volumeName = `warm-${ORPHAN_WARM_POOL_ID}`;
    const deps = makeActivity({
      settings: { warmup_enabled: false },
    });
    deps.workerWarmPoolRepository.viewByIdConsistent.mockRejectedValue(
      new Error('primary database unavailable')
    );
    deps.sshService.runCommands.mockResolvedValue([
      {
        output:
          `__underchat_warm_volumes_v1__\n` +
          `${volumeName}|2026-07-29T10:00:00.000Z||`,
      },
    ]);

    await deps.activity.scan();
    await deps.activity.scan();

    expect(
      deps.sshService.runCommands.mock.calls.some((call) =>
        String(call[2]?.[0]).includes('docker volume rm')
      )
    ).toBe(false);
    consoleWarn.mockRestore();
  });

  it('preserves the first observation when the next SSH inventory is ambiguous', async () => {
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const volumeName = `warm-${ORPHAN_WARM_POOL_ID}`;
    const volumeSnapshot =
      `__underchat_warm_volumes_v1__\n` +
      `${volumeName}|2026-07-29T10:00:00.000Z||`;
    const deps = makeActivity({
      settings: { warmup_enabled: false },
    });
    let inventoryCount = 0;
    deps.sshService.runCommands.mockImplementation(
      async (_serverId: string, _config: unknown, commands: string[]) => {
        if (String(commands[0]).includes('docker ps -a --no-trunc')) {
          inventoryCount += 1;
          if (inventoryCount === 2) {
            throw new Error('SSH inventory unavailable');
          }
        }
        return [{ output: volumeSnapshot }];
      }
    );

    await deps.activity.scan();
    await expect(deps.activity.scan()).rejects.toThrow(
      'warm_physical_snapshot_unavailable'
    );

    expect(
      deps.sshService.runCommands.mock.calls.some((call) =>
        String(call[2]?.[0]).includes('docker volume rm')
      )
    ).toBe(false);
    consoleError.mockRestore();
  });

  it('preserves warm-shaped volumes with conflicting ownership labels', async () => {
    const volumeName = `warm-${ORPHAN_WARM_POOL_ID}`;
    const deps = makeActivity({
      settings: { warmup_enabled: false },
    });
    deps.sshService.runCommands.mockResolvedValue([
      {
        output:
          `__underchat_warm_volumes_v1__\n` +
          `${volumeName}|2026-07-29T10:00:00.000Z|${ORPHAN_WARM_POOL_ID}|server-foreign`,
      },
    ]);

    await deps.activity.scan();
    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.viewByIdConsistent
    ).not.toHaveBeenCalled();
    expect(
      deps.sshService.runCommands.mock.calls.some((call) =>
        String(call[2]?.[0]).includes('docker volume rm')
      )
    ).toBe(false);
  });

  it('preserves ready capacity on an offline Balance server and never replenishes it', async () => {
    const containerId = '9'.repeat(64);
    const offline = { ...makeServer(), server_status_id: 'offline' };
    const stopped = makeWarmPool({
      warm_pool_id: ORPHAN_WARM_POOL_ID,
      container_id: containerId,
      container_name: `warm-${ORPHAN_WARM_POOL_ID}`,
      session_volume_name: `warm-${ORPHAN_WARM_POOL_ID}`,
    });
    const deps = makeActivity({
      eligibleServers: [],
      reconcileServers: [offline],
      activeEntries: [stopped],
      dockerOutput: `${containerId}|warm-${ORPHAN_WARM_POOL_ID}|exited|Exited (1)|true|${ORPHAN_WARM_POOL_ID}|${EWorkerType.baileys}`,
      dockerExactOutput: exactHealthyWarmContainer({
        warmPoolId: ORPHAN_WARM_POOL_ID,
        containerId,
        state: 'exited',
        health: 'none',
      }),
    });

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.claimMissingRuntimeForCleanup
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishDelete
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishReplenish
    ).not.toHaveBeenCalled();
  });

  it('does not publish missing warming-runtime cleanup when the atomic claim loses a race', async () => {
    const deps = makeActivity({
      activeEntries: [
        makeWarmPool({
          warm_pool_id: 'missing-raced',
          container_id: 'container-missing',
          state: EWorkerWarmPoolState.warming,
          created_at: '2000-01-01T00:00:00.000Z',
          updated_at: '2000-01-01T00:00:00.000Z',
        }),
      ],
      dockerOutput: '',
      missingRuntimeClaimed: false,
    });

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.claimMissingRuntimeForCleanup
    ).toHaveBeenCalledTimes(1);
    expect(
      deps.workerWarmPoolQueueService.publishDelete
    ).not.toHaveBeenCalled();
  });

  it('never creates an excess tombstone during a scheduled scan', async () => {
    const deps = makeActivity({
      activeCounts: {
        [EWorkerType.baileys]: 3,
        [EWorkerType.wwebjs]: 2,
        [EWorkerType.whatsmeow]: 2,
      },
      readyExcessEntries: {
        [EWorkerType.baileys]: [
          makeWarmPool({
            warm_pool_id: 'excess-rollback',
            worker_type_id: EWorkerType.baileys,
          }),
        ],
      },
      publishDeleteReject: true,
    });

    await expect(deps.activity.scan()).resolves.toBeUndefined();

    expect(
      deps.workerWarmPoolRepository.restoreDeletingToReady
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.markReadyExcessAsDeleting
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishDelete
    ).not.toHaveBeenCalled();
  });

  it('recognizes and cleans a PostgreSQL Docker orphan without inventing a volume', async () => {
    const observed = exactHealthyWarmContainer({
      warmPoolId: ORPHAN_WARM_POOL_ID,
      containerId: ORPHAN_CONTAINER_ID,
      sessionStorage: EWorkerSessionStorage.postgres,
    });
    const deps = makeActivity({
      dockerOutput: observed,
      dockerExactOutput: observed,
      settings: {
        target_ready_baileys: 0,
        target_ready_wwebjs: 0,
        target_ready_whatsmeow: 0,
      },
    });

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.claimDockerOrphanForCleanup
    ).toHaveBeenCalledWith({
      warmPoolId: ORPHAN_WARM_POOL_ID,
      serverId: 'server-1',
      workerTypeId: EWorkerType.baileys,
      containerId: ORPHAN_CONTAINER_ID,
      containerName: `warm-${ORPHAN_WARM_POOL_ID}`,
      sessionStorage: EWorkerSessionStorage.postgres,
      sessionVolumeName: null,
    });
    expect(deps.workerWarmPoolQueueService.publishDelete).toHaveBeenCalledWith(
      expect.objectContaining({
        warm_pool_id: ORPHAN_WARM_POOL_ID,
        session_volume_name: null,
        remove_volume: false,
      })
    );
  });

  it('counts an exact PostgreSQL standby without a volume as physical capacity', async () => {
    const observed = exactHealthyWarmContainer({
      warmPoolId: ORPHAN_WARM_POOL_ID,
      containerId: ORPHAN_CONTAINER_ID,
      sessionStorage: EWorkerSessionStorage.postgres,
    });
    const entry = makeWarmPool({
      warm_pool_id: ORPHAN_WARM_POOL_ID,
      container_id: ORPHAN_CONTAINER_ID,
      container_name: `warm-${ORPHAN_WARM_POOL_ID}`,
      session_storage: EWorkerSessionStorage.postgres,
      session_volume_name: null,
      state: EWorkerWarmPoolState.warming,
    });
    const deps = makeActivity({
      activeEntries: [entry],
      physicalOwnershipIds: [ORPHAN_WARM_POOL_ID],
      capacityOwnershipIds: [ORPHAN_WARM_POOL_ID],
      dockerOutput: observed,
      dockerExactOutput: observed,
      activeCounts: {
        [EWorkerType.baileys]: 0,
        [EWorkerType.wwebjs]: 0,
        [EWorkerType.whatsmeow]: 0,
      },
      settings: {
        target_ready_baileys: 1,
        target_ready_wwebjs: 0,
        target_ready_whatsmeow: 0,
      },
    });

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolQueueService.publishReplenish
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.claimDockerOrphanForCleanup
    ).not.toHaveBeenCalled();
  });

  it('probes a due PostgreSQL standby with no session volume', async () => {
    const observed = exactHealthyWarmContainer({
      warmPoolId: ORPHAN_WARM_POOL_ID,
      containerId: ORPHAN_CONTAINER_ID,
      sessionStorage: EWorkerSessionStorage.postgres,
    });
    const entry = makeWarmPool({
      warm_pool_id: ORPHAN_WARM_POOL_ID,
      container_id: ORPHAN_CONTAINER_ID,
      container_name: `warm-${ORPHAN_WARM_POOL_ID}`,
      session_storage: EWorkerSessionStorage.postgres,
      session_volume_name: null,
      last_health_at: '2000-01-01T00:00:00.000Z',
    });
    const deps = makeActivity({
      activeEntries: [entry],
      dockerOutput: observed,
      dockerExactOutput: observed,
    });

    await deps.activity.scan();

    expect(deps.workerGrpcClientService.runtimeHealth).toHaveBeenCalledWith(
      'server-1',
      expect.objectContaining({ warm_pool_id: ORPHAN_WARM_POOL_ID }),
      12_000
    );
    expect(
      deps.workerWarmPoolRepository.confirmHealthyReadyRuntime
    ).toHaveBeenCalledWith({
      warmPoolId: ORPHAN_WARM_POOL_ID,
      expectedContainerId: ORPHAN_CONTAINER_ID,
    });
  });

  it('rejects an explicit PostgreSQL standby that still mounts a named volume', async () => {
    const fields = exactHealthyWarmContainer({
      warmPoolId: ORPHAN_WARM_POOL_ID,
      containerId: ORPHAN_CONTAINER_ID,
      sessionStorage: EWorkerSessionStorage.postgres,
    }).split('|');
    fields[11] = `warm-${ORPHAN_WARM_POOL_ID}`;
    fields[18] = `warm-${ORPHAN_WARM_POOL_ID}`;
    const malformed = fields.join('|');
    const deps = makeActivity({
      dockerOutput: malformed,
      dockerExactOutput: malformed,
      settings: {
        target_ready_baileys: 0,
        target_ready_wwebjs: 0,
        target_ready_whatsmeow: 0,
      },
    });

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.claimDockerOrphanForCleanup
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishDelete
    ).not.toHaveBeenCalled();
  });

  it('fences stale PostgreSQL activation cleanup by container identity only', async () => {
    const base = makeStaleActivatingContext();
    const context = makeStaleActivatingContext({
      entry: {
        ...base.entry,
        session_storage: EWorkerSessionStorage.postgres,
        session_volume_name: null,
      },
    });
    const source = exactHealthyWarmContainer({
      warmPoolId: STALE_WARM_POOL_ID,
      containerId: STALE_SOURCE_CONTAINER_ID,
      sessionStorage: EWorkerSessionStorage.postgres,
    });
    const deps = makeActivity({
      staleActivatingContexts: [context],
      preparedLifecycleMessages: [makePreparedLifecycleMessage()],
    });
    deps.sshService.runCommands.mockImplementation(
      async (_serverId: string, _config: unknown, commands: string[]) => {
        if ((commands[0] ?? '').includes('docker inspect --type=container')) {
          return [{ output: source }];
        }
        return [{ output: '' }];
      }
    );

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.claimStaleActivatingForCleanup
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        warmPoolId: STALE_WARM_POOL_ID,
        sessionStorage: EWorkerSessionStorage.postgres,
        sessionVolumeName: null,
      })
    );
    expect(
      deps.sshService.runCommands.mock.calls.some(
        (call) => call[2]?.[0]?.includes('volume_name=$2') === true
      )
    ).toBe(false);
    expect(deps.workerWarmPoolQueueService.publishDelete).toHaveBeenCalledWith(
      expect.objectContaining({
        warm_pool_id: STALE_WARM_POOL_ID,
        session_volume_name: null,
        remove_volume: false,
      })
    );
  });
});
