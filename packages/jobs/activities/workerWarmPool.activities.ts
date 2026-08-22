import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';
import { ConnectConfig } from 'ssh2';
import { WorkerServerListerRepository } from '@core/repositories/worker/WorkerServerLister.repository';
import {
  WorkerWarmPoolRepository,
  type AdoptedWarmRuntimeIdentity,
  type StaleActivatingWarmPoolContext,
} from '@core/repositories/worker/WorkerWarmPool.repository';
import { WorkerWarmPoolQueueService } from '@core/services/workerWarmPoolQueue.service';
import { WorkerWarmPoolSettingsService } from '@core/services/workerWarmPoolSettings.service';
import { WorkerLifecycleQueueService } from '@core/services/workerLifecycleQueue.service';
import { WorkerLifecycleLockService } from '@core/services/workerLifecycleLock.service';
import { SshService } from '@core/services/ssh.service';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import { WorkerGrpcClientService } from '@core/services/workerGrpcClient.service';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerWarmPoolState } from '@core/common/enums/EWorkerWarmPoolState';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { currentTime } from '@core/common/functions/currentTime';
import { IBalanceMonitorServer } from '@core/common/interfaces/IBalanceMonitorServer';
import { IWorkerWarmPool } from '@core/common/interfaces/IWorkerWarmPool';
import { IWorkerWarmPoolSettings } from '@core/common/interfaces/IWorkerWarmPoolSettings';
import type { IWorkerLifecycleQueueMessage } from '@core/common/interfaces/IWorkerLifecycleQueueMessage';
import {
  WORKER_CONTAINER_LIVENESS_REMOTE_COMMAND_TIMEOUT_MS,
  WORKER_CONTAINER_LIVENESS_REMOTE_PROCESS_TIMEOUT_MS,
  WORKER_CONTAINER_LIVENESS_SSH_READY_TIMEOUT_MS,
} from '@core/common/functions/workerContainerLivenessPolicy';
import { IWorkerRuntimeHealthResponseProto } from '@core/common/interfaces/IWorkerRuntimeActivationProto';
import {
  ILockLeaseContext,
  UNFENCED_LOCK_LEASE_CONTEXT,
} from '@core/common/functions/withLock';

const WARM_WORKER_TYPES = [
  EWorkerType.baileys,
  EWorkerType.wwebjs,
  EWorkerType.whatsmeow,
];
const WARM_WORKER_TYPE_SET = new Set<string>(WARM_WORKER_TYPES);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTAINER_ID_PATTERN = /^[0-9a-f]{64}$/i;
const IMAGE_ID_PATTERN = /^sha256:[0-9a-f]{64}$/i;

function positiveIntegerEnv(
  value: string | undefined,
  fallback: number
): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
const WARM_DELETE_REDRIVE_AFTER_SECONDS = Math.max(
  60,
  positiveIntegerEnv(
    process.env.WORKER_WARM_POOL_DELETE_REDRIVE_AFTER_SECONDS,
    300
  )
);
const WARM_DELETE_REDRIVE_BATCH_SIZE = Math.max(
  1,
  Math.min(
    500,
    positiveIntegerEnv(
      process.env.WORKER_WARM_POOL_DELETE_REDRIVE_BATCH_SIZE,
      100
    )
  )
);
const WARM_SERVER_RECONCILE_CONCURRENCY = 5;
const WARM_ACTIVATING_RECONCILE_BATCH_SIZE = 100;
const WARM_ACTIVATING_RECONCILE_CONCURRENCY = 5;
const WARM_ACTIVATING_LOCK_ACQUIRE_TIMEOUT_MS = 50;
const WARM_ACTIVATING_LOCK_RETRY_DELAY_MS = 25;
const WARM_ACTIVATING_LOCK_TTL_MS = 75_000;
const WARM_ACTIVATING_LOCK_HEARTBEAT_MS = 15_000;
const WARM_STARTING_MIN_BUDGET_MS = 120_000;
const WARM_STARTING_MAX_BUDGET_MS = 300_000;
const WARM_STARTING_MARKER_PATTERN = /^warm_runtime_starting:(\d+):(\d+)$/;
const WARM_RUNTIME_HEALTH_FAILURE_MARKER = 'warm_runtime_health_probe_failed';
const WARM_STANDBY_PROBE_CONCURRENCY = 2;
const WARM_STANDBY_RUNTIME_HEALTH_TIMEOUT_MS = 12_000;
const WARM_VOLUME_RECONCILE_CONCURRENCY = 2;
const WARM_DOCKER_VOLUME_SECTION = '__underchat_warm_volumes_v1__';

async function mapSettledBounded<T>(
  items: T[],
  concurrency: number,
  operation: (item: T) => Promise<void>
): Promise<PromiseSettledResult<void>[]> {
  const results: PromiseSettledResult<void>[] = new Array(items.length);
  let nextIndex = 0;
  const runner = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      try {
        await operation(items[index]);
        results[index] = { status: 'fulfilled', value: undefined };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runner())
  );
  return results;
}

interface IObservedWarmContainer {
  containerId?: string;
  name: string;
  exactInspection: boolean;
  inventoryConfirmed?: boolean;
  running: boolean;
  paused: boolean;
  warmStandby: boolean;
  warmStandbyValue?: 'true' | 'false';
  warmPoolId?: string;
  workerTypeId?: string;
  serverId?: string;
  sessionStorage?: EWorkerSessionStorage;
  sessionVolumeName?: string;
  workerId?: string;
  accountId?: string;
  lifecycleOperationId?: string;
  healthStatus?: 'healthy' | 'unhealthy' | 'starting';
  createdAt?: string;
  startedAt?: string;
  restartCount?: number;
  imageId?: string;
  imageName?: string;
  configuredImageReference?: string;
  mountNames: string[];
  runtimeGeneration?: number;
}

interface IObservedWarmDockerSnapshot {
  containers: IObservedWarmContainer[];
  volumes: IObservedWarmVolume[];
}

interface IObservedWarmVolume {
  name: string;
  createdAt?: string;
  warmPoolId?: string;
  serverId?: string;
}

interface IWarmServerReconcileResult {
  reconciled: number;
  snapshot: IObservedWarmDockerSnapshot;
}

type WarmRuntimeHealthProbeOutcome =
  | { kind: 'accepted' }
  | { kind: 'rejected'; reason: string }
  | { kind: 'unavailable' };

interface IAmbiguousWarmPhysicalObservation {
  firstObservedAtMs: number;
  observations: number;
}

type WarmPoolCleanupEntry = Pick<
  IWorkerWarmPool,
  | 'warm_pool_id'
  | 'server_id'
  | 'worker_type_id'
  | 'container_id'
  | 'container_name'
  | 'session_storage'
  | 'session_volume_name'
> &
  Partial<IWorkerWarmPool>;

@injectable()
export class WorkerWarmPoolActivity {
  private readonly orphanVolumeFirstObservations = new Set<string>();
  private readonly ambiguousPhysicalObservations = new Map<
    string,
    IAmbiguousWarmPhysicalObservation
  >();

  constructor(
    @inject(WorkerServerListerRepository)
    private readonly workerServerListerRepository: WorkerServerListerRepository,
    @inject(WorkerWarmPoolRepository)
    private readonly workerWarmPoolRepository: WorkerWarmPoolRepository,
    @inject(WorkerWarmPoolQueueService)
    private readonly workerWarmPoolQueueService: WorkerWarmPoolQueueService,
    @inject(WorkerWarmPoolSettingsService)
    private readonly workerWarmPoolSettingsService: WorkerWarmPoolSettingsService,
    @inject(WorkerLifecycleQueueService)
    private readonly workerLifecycleQueueService: WorkerLifecycleQueueService,
    @inject(WorkerLifecycleLockService)
    private readonly workerLifecycleLockService: WorkerLifecycleLockService,
    @inject(SshService)
    private readonly sshService: SshService,
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService,
    @inject(WorkerGrpcClientService)
    private readonly workerGrpcClientService: WorkerGrpcClientService
  ) {}

  async scan(
    leaseContext: ILockLeaseContext = UNFENCED_LOCK_LEASE_CONTEXT
  ): Promise<void> {
    leaseContext.assertActive();
    const settings = await this.workerWarmPoolSettingsService.view();
    leaseContext.assertActive();
    const shouldRun =
      await this.workerWarmPoolSettingsService.shouldRunScan(settings);
    leaseContext.assertActive();
    if (!shouldRun) {
      return;
    }

    const tombstonedDecommissionedServerEntries =
      await this.workerWarmPoolRepository.tombstoneUnreferencedDecommissionedServerEntries(
        WARM_DELETE_REDRIVE_BATCH_SIZE
      );
    leaseContext.assertActive();
    if (tombstonedDecommissionedServerEntries > 0) {
      console.warn('Parked decommissioned-server warm pool cleanup', {
        tombstoned_count: tombstonedDecommissionedServerEntries,
      });
    }

    await this.workerWarmPoolRepository.releaseExpiredReservations();
    leaseContext.assertActive();
    await this.workerWarmPoolQueueService.ensure();
    leaseContext.assertActive();
    await this.redriveStaleDeletingWarmPool(leaseContext);
    leaseContext.assertActive();
    await this.cleanupTerminalWarmPool(settings, leaseContext);
    leaseContext.assertActive();
    const [eligibleServers, reconcileServers] = await Promise.all([
      settings.warmup_enabled
        ? this.workerServerListerRepository.listWarmPoolEligibleBalanceServers()
        : Promise.resolve([]),
      this.workerServerListerRepository.listWarmPoolReconcileBalanceServers(),
    ]);
    leaseContext.assertActive();
    const eligibleServerIds = new Set(
      eligibleServers.map((server) => server.server_id)
    );
    const targets = this.getTargetsByType(settings);
    await this.reconcileStaleActivatingWarmPool(
      settings,
      reconcileServers,
      leaseContext
    );
    leaseContext.assertActive();

    const serverResults = await mapSettledBounded(
      reconcileServers,
      WARM_SERVER_RECONCILE_CONCURRENCY,
      async (server) => {
        leaseContext.assertActive();
        const physical = await this.reconcileServerWarmPool(
          server,
          settings.warming_stale_after_seconds * 1000,
          Date.now() - settings.scan_interval_seconds * 1000,
          eligibleServerIds.has(server.server_id),
          leaseContext
        );
        leaseContext.assertActive();
        const [durablePhysicalOwnershipIds, capacityPhysicalOwnershipIds] =
          await Promise.all([
            this.workerWarmPoolRepository.listPhysicalOwnershipIdsByServer(
              server.server_id
            ),
            this.workerWarmPoolRepository.listCapacityOwnershipIdsByServer(
              server.server_id
            ),
          ]);
        leaseContext.assertActive();
        const durableWarmPhysicalOwnershipIds = new Set(
          durablePhysicalOwnershipIds
        );
        const capacityWarmPhysicalOwnershipIds = new Set(
          capacityPhysicalOwnershipIds
        );
        const physicalCounts = this.countPhysicalStandbysByType(
          physical.snapshot.containers,
          server.server_id,
          durableWarmPhysicalOwnershipIds,
          capacityWarmPhysicalOwnershipIds
        );
        const adoptedDockerCandidates = physical.snapshot.containers.filter(
          (container) =>
            this.hasAdoptedWarmRuntimeDockerCandidateIdentity(
              container,
              server.server_id
            )
        );
        const adoptedRuntimeIdentities =
          adoptedDockerCandidates.length > 0
            ? await this.workerWarmPoolRepository.listAdoptedRuntimeIdentitiesByServer(
                server.server_id
              )
            : [];
        leaseContext.assertActive();
        const adoptedRuntimeIdentitiesByContainerId = new Map<
          string,
          AdoptedWarmRuntimeIdentity | null
        >();
        for (const identity of adoptedRuntimeIdentities) {
          adoptedRuntimeIdentitiesByContainerId.set(
            identity.runtime_container_id,
            adoptedRuntimeIdentitiesByContainerId.has(
              identity.runtime_container_id
            )
              ? null
              : identity
          );
        }
        const ambiguousWarmPhysicalIdentities =
          physical.snapshot.containers.filter(
            (container) =>
              this.isWarmShapedContainer(container) &&
              !this.isStrictStandbyContainer(container, server.server_id) &&
              !this.isAdoptedWarmRuntimeForCapacity(
                container,
                server.server_id,
                container.containerId
                  ? adoptedRuntimeIdentitiesByContainerId.get(
                      container.containerId
                    )
                  : undefined
              )
          );
        const matureAmbiguousWarmPhysicalIdentityKeys =
          this.observeAmbiguousWarmPhysicalIdentities(
            server.server_id,
            ambiguousWarmPhysicalIdentities,
            settings.warming_stale_after_seconds * 1000
          );
        const ambiguousWarmWorkerTypes = new Set<EWorkerType>();
        let hasUnscopedAmbiguousWarmPhysicalIdentity = false;
        for (const container of ambiguousWarmPhysicalIdentities) {
          const observationKey = this.ambiguousPhysicalObservationKey(
            server.server_id,
            container
          );
          if (
            observationKey &&
            matureAmbiguousWarmPhysicalIdentityKeys.has(observationKey) &&
            !this.isAmbiguousPhysicalIdentityDurablyWarmOwned(
              container,
              durableWarmPhysicalOwnershipIds
            )
          ) {
            /*
             * Persistent ambiguity is never deletion authority. Once the same
             * immutable Docker identity has survived repeated inventory +
             * exact-inspect observations beyond the grace window, stop
             * sacrificing capacity and allow the normal target-fenced
             * replenish path to create a bounded non-destructive replacement.
             */
            console.warn(
              'Allowing bounded warm replacement beside persistent ambiguous physical identity',
              {
                server_id: server.server_id,
                worker_type_id: container.workerTypeId ?? null,
                container_id: container.containerId ?? null,
              }
            );
            continue;
          }
          if (
            container.workerTypeId &&
            WARM_WORKER_TYPE_SET.has(container.workerTypeId)
          ) {
            ambiguousWarmWorkerTypes.add(container.workerTypeId as EWorkerType);
          } else {
            /*
             * A malformed runtime without a trustworthy provider type could
             * collide with any target, so only this unscoped case freezes all
             * replenishment. A Baileys conflict must not suppress independent
             * WWebJS/WhatsMeow capacity (and vice versa).
             */
            hasUnscopedAmbiguousWarmPhysicalIdentity = true;
          }
        }

        /*
         * Disabling warmup or taking a Balance server offline stops only new
         * capacity. Physical reconciliation and orphan cleanup continue so
         * stopped containers/volumes cannot accumulate indefinitely.
         */
        if (
          !settings.warmup_enabled ||
          !eligibleServerIds.has(server.server_id)
        ) {
          return;
        }

        for (const workerTypeId of WARM_WORKER_TYPES) {
          leaseContext.assertActive();
          const target = targets[workerTypeId] ?? 0;
          const availableCount =
            await this.workerWarmPoolRepository.countAvailableByServerAndType(
              server.server_id,
              workerTypeId
            );
          leaseContext.assertActive();

          /*
           * A scheduled scan may fill a deficit, but it must never shrink or
           * replace ready capacity. In particular, a build can change the
           * default image while every existing standby remains deliberately
           * pinned to its old image. The explicit "Recriar Todos" flow is the
           * sole owner of ready -> deleting transitions.
           */
          if (availableCount >= target) {
            continue;
          }

          const missing = Math.max(0, target - availableCount);

          const physicalCount = physicalCounts.get(workerTypeId) ?? 0;
          const replenishCount = Math.min(
            missing,
            Math.max(0, target - physicalCount)
          );

          if (
            replenishCount > 0 &&
            !hasUnscopedAmbiguousWarmPhysicalIdentity &&
            !ambiguousWarmWorkerTypes.has(workerTypeId) &&
            physicalCount < target
          ) {
            /*
             * Each signal owns one candidate capacity slot. The consumer
             * rechecks every candidate under a DB advisory lock and a target
             * CAS, so publishing the bounded deficit converges in one scan
             * without permitting an overshoot when scans or consumers race.
             */
            for (let index = 0; index < replenishCount; index += 1) {
              leaseContext.assertActive();
              await this.workerWarmPoolQueueService.publishReplenish({
                request_id: uuidv7(),
                server_id: server.server_id,
                worker_type_id: workerTypeId,
                reason: 'scheduled_scan',
                requested_at: currentTime(),
              });
              leaseContext.assertActive();
            }
          }
        }
      }
    );
    leaseContext.assertActive();

    const failures = serverResults
      .map((result, index) => ({
        result,
        server: reconcileServers[index],
      }))
      .filter(
        (
          item
        ): item is {
          result: PromiseRejectedResult;
          server: IBalanceMonitorServer;
        } => item.result.status === 'rejected'
      );
    for (const failure of failures) {
      console.error('Failed to reconcile warm pool server', {
        server_id: failure.server.server_id,
        error: failure.result.reason,
      });
    }
    if (failures.length) {
      throw failures[0].result.reason;
    }
  }

  private async publishDeleteEntry(
    entry: WarmPoolCleanupEntry,
    reason: 'pool_excess' | 'pool_reconcile'
  ): Promise<void> {
    const isLegacyVolume =
      entry.session_storage === EWorkerSessionStorage.legacy_volume;
    const isPostgres = entry.session_storage === EWorkerSessionStorage.postgres;
    if (
      (!isLegacyVolume && !isPostgres) ||
      (isLegacyVolume && !entry.session_volume_name) ||
      (isPostgres && entry.session_volume_name !== null)
    ) {
      throw new Error('warm_pool_session_storage_invariant_invalid');
    }
    const reference = this.getWarmPoolReference(entry);
    await this.workerWarmPoolQueueService.publishDelete({
      request_id: uuidv7(),
      warm_pool_id: entry.warm_pool_id,
      server_id: entry.server_id,
      worker_type_id: entry.worker_type_id,
      container_id: entry.container_id,
      container_name: reference.containerName,
      session_volume_name: entry.session_volume_name,
      remove_volume: isLegacyVolume,
      reason,
      requested_at: currentTime(),
    });
  }

  private async publishClaimedCleanupEntries(
    entries: WarmPoolCleanupEntry[],
    context: string,
    leaseContext: ILockLeaseContext = UNFENCED_LOCK_LEASE_CONTEXT
  ): Promise<number> {
    let published = 0;
    for (const entry of entries) {
      leaseContext.assertActive();
      try {
        await this.publishDeleteEntry(entry, 'pool_reconcile');
        leaseContext.assertActive();
        published += 1;
      } catch (error) {
        leaseContext.assertActive();
        /*
         * The database row intentionally remains deleting. The stale-delete
         * claim below retries it after the cooldown without racing this scan.
         */
        console.error(`Failed to publish ${context} warm cleanup`, {
          warm_pool_id: entry.warm_pool_id,
          server_id: entry.server_id,
          worker_type_id: entry.worker_type_id,
          error,
        });
      }
    }

    return published;
  }

  private async redriveStaleDeletingWarmPool(
    leaseContext: ILockLeaseContext
  ): Promise<number> {
    leaseContext.assertActive();
    /*
     * A runtime can acquire durable lineage after a cleanup tombstone was
     * claimed and before its Kafka/gRPC hop completes. Reconcile that metadata
     * independently of the delete cooldown: the delete redrive intentionally
     * excludes live lineage and therefore cannot own this transition.
     */
    const lineageIds =
      await this.workerWarmPoolRepository.listDeletingRuntimeLineageIds(
        WARM_DELETE_REDRIVE_BATCH_SIZE
      );
    leaseContext.assertActive();
    const lineageResults = await mapSettledBounded(
      lineageIds,
      WARM_SERVER_RECONCILE_CONCURRENCY,
      async (warmPoolId) => {
        leaseContext.assertActive();
        await this.workerWarmPoolRepository.reconcileDeletingRuntimeLineage(
          warmPoolId
        );
        leaseContext.assertActive();
      }
    );
    for (const [index, result] of lineageResults.entries()) {
      if (result.status === 'rejected') {
        console.warn('Failed to reconcile deleting warm runtime lineage', {
          warm_pool_id: lineageIds[index],
          error: result.reason,
        });
      }
    }

    const staleBefore = new Date(
      Date.now() - WARM_DELETE_REDRIVE_AFTER_SECONDS * 1000
    ).toISOString();
    const entries =
      await this.workerWarmPoolRepository.claimStaleDeletingForRetry({
        staleBefore,
        limit: WARM_DELETE_REDRIVE_BATCH_SIZE,
      });
    leaseContext.assertActive();

    return this.publishClaimedCleanupEntries(
      entries,
      'stale deleting',
      leaseContext
    );
  }

  private async cleanupTerminalWarmPool(
    settings: IWorkerWarmPoolSettings,
    leaseContext: ILockLeaseContext
  ): Promise<number> {
    leaseContext.assertActive();
    const staleBefore = new Date(
      Date.now() - settings.warming_stale_after_seconds * 1000
    ).toISOString();
    const [errors, removedUnreferencedAssigned] = await Promise.all([
      this.workerWarmPoolRepository.claimErrorsForCleanup({
        staleBefore,
        limit: WARM_DELETE_REDRIVE_BATCH_SIZE,
      }),
      this.workerWarmPoolRepository.deleteUnreferencedAssignedForCleanup({
        staleBefore,
        limit: WARM_DELETE_REDRIVE_BATCH_SIZE,
      }),
    ]);
    leaseContext.assertActive();

    /*
     * Assigned rows are metadata for an already-adopted runtime. Removing the
     * old warm container/volume by that stale identity could target a legacy
     * live session that predates worker_runtime. Delete only the stale DB
     * reference here; an actual exact `warm-<id>` Docker standby is discovered
     * independently below and receives its own fenced deletion tombstone.
     */
    const errorPublished = await this.publishClaimedCleanupEntries(
      errors,
      'terminal error',
      leaseContext
    );

    return errorPublished + removedUnreferencedAssigned.length;
  }

  private getTargetsByType(
    settings: IWorkerWarmPoolSettings
  ): Partial<Record<EWorkerType, number>> {
    return {
      [EWorkerType.baileys]: settings.target_ready_baileys,
      [EWorkerType.wwebjs]: settings.target_ready_wwebjs,
      [EWorkerType.whatsmeow]: settings.target_ready_whatsmeow,
    };
  }

  private buildSshConfig(server: IBalanceMonitorServer): ConnectConfig {
    return {
      host: server.ssh_ip,
      port: server.ssh_port,
      username: this.passwordEncryptorService.decrypt(server.ssh_username),
      password: this.passwordEncryptorService.decrypt(server.ssh_password),
    };
  }

  private parseObservedWarmContainerLine(
    line: string,
    allowNonWarmContainer = false,
    exactInspection = false
  ): IObservedWarmContainer | null {
    const trimmed = line.trim();
    if (!trimmed) {
      return null;
    }

    const fields = trimmed.split('|');
    const [
      rawContainerId,
      rawName,
      rawState,
      rawStatus,
      rawWarmStandby,
      rawWarmPoolId,
      rawWorkerTypeId,
      rawStartedAt,
      rawRestartCount,
      rawPaused,
      rawServerId,
      rawSessionVolumeName,
      rawWorkerId,
      rawAccountId,
      rawLifecycleOperationId,
      rawImageId,
      rawImageName,
      rawConfiguredImageName,
      rawMounts,
      rawRuntimeGeneration,
      rawCreatedAt,
      rawSessionStorage,
    ] =
      fields.length >= 7
        ? fields
        : [
            undefined,
            fields[0],
            fields[1],
            undefined,
            fields[2],
            fields[3],
            fields[4],
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
          ];
    const normalizeDockerLabel = (
      value: string | undefined
    ): string | undefined => {
      const normalized = value?.trim();
      return normalized && normalized !== '<no value>' ? normalized : undefined;
    };
    const name = rawName?.trim().replace(/^\/+/, '');
    if (!name) {
      return null;
    }

    const normalizedWarmStandby =
      normalizeDockerLabel(rawWarmStandby)?.toLowerCase();
    const warmStandbyValue =
      normalizedWarmStandby === 'true' || normalizedWarmStandby === 'false'
        ? normalizedWarmStandby
        : undefined;
    const warmStandby = warmStandbyValue === 'true';
    const normalizedState = rawState?.trim().toLowerCase() ?? '';
    const warmPoolId = normalizeDockerLabel(rawWarmPoolId);
    const workerTypeId = normalizeDockerLabel(rawWorkerTypeId);
    const containerId = rawContainerId?.trim().toLowerCase();
    const status = rawStatus?.trim().toLowerCase() ?? '';
    const paused =
      rawPaused?.trim().toLowerCase() === 'true' ||
      normalizedState === 'paused' ||
      status.includes('paused');
    const running = normalizedState === 'running' || paused;
    const rawRestartCountValue = Number(rawRestartCount?.trim());
    const restartCount =
      Number.isFinite(rawRestartCountValue) && rawRestartCountValue >= 0
        ? Math.floor(rawRestartCountValue)
        : undefined;
    const rawRuntimeGenerationValue = Number(rawRuntimeGeneration?.trim());
    const runtimeGeneration =
      Number.isSafeInteger(rawRuntimeGenerationValue) &&
      rawRuntimeGenerationValue > 0
        ? rawRuntimeGenerationValue
        : undefined;
    const normalizedSessionStorage = normalizeDockerLabel(rawSessionStorage);
    const sessionStorage =
      normalizedSessionStorage === EWorkerSessionStorage.legacy_volume ||
      normalizedSessionStorage === EWorkerSessionStorage.postgres
        ? normalizedSessionStorage
        : undefined;
    const startedAt = rawStartedAt?.trim();
    const healthStatus = status.includes('unhealthy')
      ? 'unhealthy'
      : status === 'starting' ||
          status.includes('health: starting') ||
          status.includes('(starting)')
        ? 'starting'
        : status === 'healthy' || status.includes('(healthy)')
          ? 'healthy'
          : undefined;
    const isWarmContainer =
      warmStandby || !!warmPoolId || name.startsWith('warm-');

    if (!isWarmContainer && !allowNonWarmContainer) {
      return null;
    }

    return {
      containerId: containerId || undefined,
      name,
      exactInspection,
      running,
      paused,
      warmStandby,
      warmStandbyValue,
      warmPoolId: warmPoolId || undefined,
      workerTypeId: workerTypeId || undefined,
      serverId: normalizeDockerLabel(rawServerId),
      sessionStorage,
      sessionVolumeName: normalizeDockerLabel(rawSessionVolumeName),
      workerId: normalizeDockerLabel(rawWorkerId),
      accountId: normalizeDockerLabel(rawAccountId),
      lifecycleOperationId: normalizeDockerLabel(rawLifecycleOperationId),
      healthStatus,
      createdAt: normalizeDockerLabel(rawCreatedAt),
      startedAt: startedAt || undefined,
      restartCount,
      imageId: normalizeDockerLabel(rawImageId)?.toLowerCase(),
      imageName: normalizeDockerLabel(rawImageName),
      configuredImageReference: normalizeDockerLabel(rawConfiguredImageName),
      mountNames: (rawMounts ?? '')
        .split(',')
        .map((mount) => mount.trim())
        .filter(Boolean),
      runtimeGeneration,
    };
  }

  private async listObservedWarmDockerSnapshot(
    server: IBalanceMonitorServer
  ): Promise<IObservedWarmDockerSnapshot | null> {
    const processTimeoutSeconds = Math.ceil(
      WORKER_CONTAINER_LIVENESS_REMOTE_PROCESS_TIMEOUT_MS / 1_000
    );
    const containerFormat =
      '{{.ID}}|{{.Names}}|{{.State}}|{{.Status}}|{{.Label "underchat.warm_standby"}}|{{.Label "underchat.warm_pool_id"}}|{{.Label "underchat.worker_type_id"}}||||{{.Label "underchat.server_id"}}|{{.Label "underchat.session_volume_name"}}|{{.Label "underchat.worker_id"}}|{{.Label "underchat.account_id"}}|{{.Label "underchat.lifecycle_operation_id"}}||{{.Label "underchat.worker_image"}}||{{.Mounts}}|{{.Label "underchat.runtime_generation"}}||{{.Label "underchat.session_storage"}}';
    const volumeFormat =
      '{{.Name}}|{{.CreatedAt}}|{{index .Labels "underchat.warm_pool_id"}}|{{index .Labels "underchat.server_id"}}';
    /*
     * `docker volume ls --format` does not expose CreatedAt on supported
     * Docker CLIs. List exact names first, then inspect them in one daemon
     * call so the legacy-age fence is based on authoritative metadata.
     */
    const command = String.raw`timeout --signal=KILL ${processTimeoutSeconds}s sh -c 'container_format=$1; volume_format=$2; marker=$3; docker ps -a --no-trunc --format "$container_format" || exit 1; printf "\n%s\n" "$marker"; all_volume_names="$(docker volume ls -q)" || exit 1; volume_names="$(printf "%s\n" "$all_volume_names" | grep -E "^warm-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$" || true)"; if [ -n "$volume_names" ]; then docker volume inspect --format "$volume_format" $volume_names || exit 1; fi' sh '${containerFormat}' '${volumeFormat}' '${WARM_DOCKER_VOLUME_SECTION}'`;

    try {
      const outputs = await this.sshService.runCommands(
        server.server_id,
        {
          ...this.buildSshConfig(server),
          readyTimeout: WORKER_CONTAINER_LIVENESS_SSH_READY_TIMEOUT_MS,
        },
        [command],
        false,
        {
          failOnNonZero: true,
          connectMaxAttempts: 1,
          commandTimeoutMs: WORKER_CONTAINER_LIVENESS_REMOTE_COMMAND_TIMEOUT_MS,
        }
      );
      const combined = outputs
        .map((item) => item.output)
        // SshService results are arbitrary stdout chunks. Preserve their
        // original byte adjacency or a split UUID/label becomes two lines.
        .join('')
        .trim();

      if (!combined) {
        return { containers: [], volumes: [] };
      }

      const lines = combined.split('\n');
      const volumeSectionIndex = lines.findIndex(
        (line) => line.trim() === WARM_DOCKER_VOLUME_SECTION
      );
      const containerLines =
        volumeSectionIndex >= 0 ? lines.slice(0, volumeSectionIndex) : lines;
      const volumeLines =
        volumeSectionIndex >= 0 ? lines.slice(volumeSectionIndex + 1) : [];
      const containers = containerLines
        .map((line) => this.parseObservedWarmContainerLine(line, true))
        .filter(
          (container): container is IObservedWarmContainer => !!container
        );
      const volumesByName = new Map<string, IObservedWarmVolume>();
      for (const line of volumeLines) {
        const [rawName, rawCreatedAt, rawWarmPoolId, rawServerId] = line
          .split('|')
          .map((value) => value.trim());
        const warmPoolId = rawName?.startsWith('warm-')
          ? rawName.slice('warm-'.length)
          : '';
        if (
          !rawName ||
          !UUID_PATTERN.test(warmPoolId) ||
          rawName !== `warm-${warmPoolId}`
        ) {
          continue;
        }
        const normalizeLabel = (value?: string): string | undefined =>
          value && value !== '<no value>' ? value : undefined;
        volumesByName.set(rawName, {
          name: rawName,
          createdAt: normalizeLabel(rawCreatedAt),
          warmPoolId: normalizeLabel(rawWarmPoolId),
          serverId: normalizeLabel(rawServerId),
        });
      }
      const volumes = [...volumesByName.values()];
      return { containers, volumes };
    } catch {
      return null;
    }
  }

  private async inspectExactWarmContainers(
    server: IBalanceMonitorServer,
    containerReferences: string[]
  ): Promise<IObservedWarmContainer[]> {
    const references = [
      ...new Set(
        containerReferences
          .map((reference) => reference.trim().toLowerCase())
          .filter(
            (reference) =>
              CONTAINER_ID_PATTERN.test(reference) ||
              UUID_PATTERN.test(reference)
          )
      ),
    ];
    if (!references.length) {
      return [];
    }

    const processTimeoutSeconds = Math.ceil(
      WORKER_CONTAINER_LIVENESS_REMOTE_PROCESS_TIMEOUT_MS / 1_000
    );
    const inspectFormat =
      '{{.Id}}|{{.Name}}|{{.State.Status}}|{{with index .State "Health"}}{{index . "Status"}}{{else}}none{{end}}|{{index .Config.Labels "underchat.warm_standby"}}|{{index .Config.Labels "underchat.warm_pool_id"}}|{{index .Config.Labels "underchat.worker_type_id"}}|{{.State.StartedAt}}|{{.RestartCount}}|{{.State.Paused}}|{{index .Config.Labels "underchat.server_id"}}|{{index .Config.Labels "underchat.session_volume_name"}}|{{index .Config.Labels "underchat.worker_id"}}|{{index .Config.Labels "underchat.account_id"}}|{{index .Config.Labels "underchat.lifecycle_operation_id"}}|{{.Image}}|{{index .Config.Labels "underchat.worker_image"}}|{{.Config.Image}}|{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}},{{end}}{{end}}|{{index .Config.Labels "underchat.runtime_generation"}}|{{.Created}}|{{index .Config.Labels "underchat.session_storage"}}';
    /*
     * Docker still emits every extant snapshot on stdout when one ID in a
     * multi-ID inspect vanished; only stderr contains the exact no-such error.
     * Preserve that bounded batch performance and accept a non-zero status
     * only when every stderr line is a confirmed absence for an immutable ID.
     * Daemon, permission, timeout and template failures remain fail-closed.
     */
    const command = String.raw`timeout --signal=KILL ${processTimeoutSeconds}s sh -c 'format=$1; shift; error_file="$(mktemp)" || exit 1; trap "rm -f \"$error_file\"" EXIT HUP INT TERM; snapshots="$(docker inspect --type=container --format "$format" "$@" 2>"$error_file")"; rc=$?; if [ "$rc" -eq 0 ]; then [ -z "$snapshots" ] || printf "%s\n" "$snapshots"; exit 0; fi; unexpected="$(grep -Eiv "^(Error response from daemon: )?No such (container|object):? ([0-9a-f]{64}|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$|^Error: No such object: ([0-9a-f]{64}|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$" "$error_file" | sed "/^[[:space:]]*$/d")"; if [ -s "$error_file" ] && [ -z "$unexpected" ]; then [ -z "$snapshots" ] || printf "%s\n" "$snapshots"; exit 0; fi; cat "$error_file" >&2; exit "$rc"' sh '${inspectFormat}' ${references.join(
      ' '
    )}`;
    const outputs = await this.sshService.runCommands(
      server.server_id,
      {
        ...this.buildSshConfig(server),
        readyTimeout: WORKER_CONTAINER_LIVENESS_SSH_READY_TIMEOUT_MS,
      },
      [command],
      false,
      {
        failOnNonZero: true,
        connectMaxAttempts: 1,
        commandTimeoutMs: WORKER_CONTAINER_LIVENESS_REMOTE_COMMAND_TIMEOUT_MS,
      }
    );
    const combined = outputs
      .map((item) => item.output)
      .join('')
      .trim();
    if (!combined) {
      return [];
    }

    return combined
      .split('\n')
      .map((line) => this.parseObservedWarmContainerLine(line, true, true))
      .filter(
        (container): container is IObservedWarmContainer => container !== null
      );
  }

  private async hydrateObservedWarmContainerIdentities(
    server: IBalanceMonitorServer,
    snapshot: IObservedWarmDockerSnapshot,
    leaseContext: ILockLeaseContext
  ): Promise<IObservedWarmDockerSnapshot> {
    const candidateIds = snapshot.containers
      .filter(
        (
          container
        ): container is IObservedWarmContainer & { containerId: string } =>
          this.isWarmShapedContainer(container) &&
          Boolean(container.containerId) &&
          CONTAINER_ID_PATTERN.test(container.containerId ?? '')
      )
      .map((container) => container.containerId);
    if (!candidateIds.length) {
      return snapshot;
    }

    try {
      leaseContext.assertActive();
      const exact = await this.inspectExactWarmContainers(server, candidateIds);
      leaseContext.assertActive();
      const exactById = new Map(
        exact
          .filter(
            (
              container
            ): container is IObservedWarmContainer & {
              containerId: string;
            } =>
              Boolean(container.containerId) &&
              CONTAINER_ID_PATTERN.test(container.containerId ?? '')
          )
          .map((container) => [container.containerId, container])
      );

      return {
        ...snapshot,
        /*
         * Keep an unconfirmed first observation as an ambiguous physical
         * runtime. This fail-closed representation blocks replenishment until
         * a later scan either proves the full identity or observes absence.
         */
        containers: snapshot.containers.map((container) => {
          const exactContainer = container.containerId
            ? exactById.get(container.containerId)
            : undefined;
          return exactContainer
            ? { ...exactContainer, inventoryConfirmed: true }
            : container;
        }),
      };
    } catch (error) {
      leaseContext.assertActive();
      console.warn('Failed to inspect complete warm container identities', {
        server_id: server.server_id,
        candidate_count: candidateIds.length,
        error,
      });
      return snapshot;
    }
  }

  private async inspectExactWarmVolume(
    server: IBalanceMonitorServer,
    volumeName: string
  ): Promise<IObservedWarmVolume | null> {
    const warmPoolId = volumeName.startsWith('warm-')
      ? volumeName.slice('warm-'.length)
      : '';
    if (!UUID_PATTERN.test(warmPoolId) || volumeName !== `warm-${warmPoolId}`) {
      throw new Error('warm_activation_volume_identity_invalid');
    }

    const processTimeoutSeconds = Math.ceil(
      WORKER_CONTAINER_LIVENESS_REMOTE_PROCESS_TIMEOUT_MS / 1_000
    );
    const inspectFormat =
      '{{.Name}}|{{.CreatedAt}}|{{index .Labels "underchat.warm_pool_id"}}|{{index .Labels "underchat.server_id"}}';
    const command = String.raw`timeout --signal=KILL ${processTimeoutSeconds}s sh -c 'format=$1; volume_name=$2; error_file="$(mktemp)" || exit 1; trap "rm -f \"$error_file\"" EXIT HUP INT TERM; snapshot="$(docker volume inspect --format "$format" "$volume_name" 2>"$error_file")"; rc=$?; if [ "$rc" -eq 0 ]; then [ -z "$snapshot" ] || printf "%s\n" "$snapshot"; exit 0; fi; unexpected="$(grep -Eiv "^(Error response from daemon: )?(No such volume: ${volumeName}|get ${volumeName}: no such volume)$|^Error: No such volume: ${volumeName}$" "$error_file" | sed "/^[[:space:]]*$/d")"; if [ -s "$error_file" ] && [ -z "$unexpected" ]; then exit 0; fi; cat "$error_file" >&2; exit "$rc"' sh '${inspectFormat}' '${volumeName}'`;
    const outputs = await this.sshService.runCommands(
      server.server_id,
      {
        ...this.buildSshConfig(server),
        readyTimeout: WORKER_CONTAINER_LIVENESS_SSH_READY_TIMEOUT_MS,
      },
      [command],
      false,
      {
        failOnNonZero: true,
        connectMaxAttempts: 1,
        commandTimeoutMs: WORKER_CONTAINER_LIVENESS_REMOTE_COMMAND_TIMEOUT_MS,
      }
    );
    const output = outputs
      .map((item) => item.output)
      .join('')
      .trim();
    if (!output) {
      return null;
    }
    const [inspectedName, createdAt, inspectedWarmPoolId, inspectedServerId] =
      output.split('|').map((field) => field.trim());
    if (inspectedName !== volumeName) {
      throw new Error('warm_activation_volume_identity_conflict');
    }
    return {
      name: inspectedName,
      createdAt:
        createdAt && createdAt !== '<no value>' ? createdAt : undefined,
      warmPoolId:
        inspectedWarmPoolId && inspectedWarmPoolId !== '<no value>'
          ? inspectedWarmPoolId
          : undefined,
      serverId:
        inspectedServerId && inspectedServerId !== '<no value>'
          ? inspectedServerId
          : undefined,
    };
  }

  private async removeExactWarmVolumeIfUnattached(
    server: IBalanceMonitorServer,
    expectedVolume: IObservedWarmVolume,
    leaseContext: ILockLeaseContext
  ): Promise<'absent' | 'in_use' | 'removed'> {
    const volumeName = expectedVolume.name;
    const expectedWarmPoolId = volumeName.slice('warm-'.length);
    leaseContext.assertActive();
    const inspected = await this.inspectExactWarmVolume(server, volumeName);
    leaseContext.assertActive();
    if (!inspected) {
      return 'absent';
    }
    if (
      inspected.createdAt !== expectedVolume.createdAt ||
      this.resolveWarmVolumeOwnershipMode(
        inspected,
        expectedWarmPoolId,
        server.server_id
      ) !==
        this.resolveWarmVolumeOwnershipMode(
          expectedVolume,
          expectedWarmPoolId,
          server.server_id
        )
    ) {
      throw new Error('warm_orphan_volume_ownership_conflict');
    }

    const processTimeoutSeconds = Math.ceil(
      WORKER_CONTAINER_LIVENESS_REMOTE_PROCESS_TIMEOUT_MS / 1_000
    );
    /*
     * `docker volume rm` is the final atomic mount fence: Docker refuses an
     * in-use volume even if a container attached after our DB/Docker snapshot.
     * The UUID-shaped exact name is validated by inspectExactWarmVolume before
     * it ever reaches this single-quoted argument.
     */
    const command = String.raw`timeout --signal=KILL ${processTimeoutSeconds}s sh -c 'volume=$1; mounted="$(docker ps -aq --filter "volume=$volume")" || exit 1; if [ -n "$mounted" ]; then printf "in_use\n"; exit 0; fi; docker volume rm "$volume" >/dev/null || exit 1; printf "removed\n"' sh '${volumeName}'`;
    const outputs = await this.sshService.runCommands(
      server.server_id,
      {
        ...this.buildSshConfig(server),
        readyTimeout: WORKER_CONTAINER_LIVENESS_SSH_READY_TIMEOUT_MS,
      },
      [command],
      false,
      {
        failOnNonZero: true,
        connectMaxAttempts: 1,
        commandTimeoutMs: WORKER_CONTAINER_LIVENESS_REMOTE_COMMAND_TIMEOUT_MS,
      }
    );
    leaseContext.assertActive();
    const result = outputs
      .map((item) => item.output)
      .join('')
      .trim();
    if (result === 'in_use') {
      return 'in_use';
    }
    if (result !== 'removed') {
      throw new Error('warm_orphan_volume_removal_result_invalid');
    }
    return 'removed';
  }

  private resolveWarmVolumeOwnershipMode(
    volume: IObservedWarmVolume,
    expectedWarmPoolId: string,
    expectedServerId: string
  ): 'labelled' | null {
    if (!volume.warmPoolId && !volume.serverId) {
      /*
       * A warm-shaped name is not positive ownership proof. Legacy volumes
       * may already hold an active channel session after promotion, including
       * while its container/runtime metadata is temporarily absent during
       * recovery. Keep unlabelled volumes for explicit/manual reconciliation.
       */
      return null;
    }
    if (
      volume.warmPoolId === expectedWarmPoolId &&
      volume.serverId === expectedServerId
    ) {
      return 'labelled';
    }
    /*
     * Partial or conflicting labels are ambiguous ownership. A warm-looking
     * name can never override an explicit contradictory durable identity.
     */
    return null;
  }

  private warmVolumeObservationKey(
    serverId: string,
    volume: IObservedWarmVolume,
    ownershipMode: 'labelled'
  ): string {
    return [serverId, volume.name, volume.createdAt ?? '', ownershipMode].join(
      ':'
    );
  }

  private clearWarmVolumeObservationsForServer(serverId: string): void {
    for (const key of [...this.orphanVolumeFirstObservations]) {
      if (key.startsWith(`${serverId}:`)) {
        this.orphanVolumeFirstObservations.delete(key);
      }
    }
  }

  private async reconcileOrphanWarmVolumes(
    server: IBalanceMonitorServer,
    activeEntries: IWorkerWarmPool[],
    snapshot: IObservedWarmDockerSnapshot,
    warmingStaleAfterMs: number,
    leaseContext: ILockLeaseContext
  ): Promise<number> {
    const activeWarmPoolIds = new Set(
      activeEntries.map((entry) => entry.warm_pool_id)
    );
    const activeVolumeNames = new Set(
      activeEntries.map((entry) => entry.session_volume_name)
    );
    const rawCandidates = snapshot.volumes.filter((volume) => {
      const volumeName = volume.name;
      const warmPoolId = volumeName.slice('warm-'.length);
      if (
        activeWarmPoolIds.has(warmPoolId) ||
        activeVolumeNames.has(volumeName)
      ) {
        return false;
      }
      return !snapshot.containers.some(
        (container) =>
          container.name === volumeName ||
          container.name.includes(warmPoolId) ||
          container.warmPoolId === warmPoolId ||
          container.sessionVolumeName === volumeName ||
          container.mountNames.includes(volumeName)
      );
    });
    const rawCandidateKeys = new Set(
      rawCandidates.flatMap((volume) => {
        const warmPoolId = volume.name.slice('warm-'.length);
        const ownershipMode = this.resolveWarmVolumeOwnershipMode(
          volume,
          warmPoolId,
          server.server_id
        );
        return ownershipMode
          ? [
              this.warmVolumeObservationKey(
                server.server_id,
                volume,
                ownershipMode
              ),
            ]
          : [];
      })
    );
    for (const key of [...this.orphanVolumeFirstObservations]) {
      if (!key.startsWith(`${server.server_id}:`)) {
        continue;
      }
      if (!rawCandidateKeys.has(key)) {
        this.orphanVolumeFirstObservations.delete(key);
      }
    }
    const nowMs = Date.now();
    const candidates = rawCandidates.filter((volume) => {
      const warmPoolId = volume.name.slice('warm-'.length);
      const ownershipMode = this.resolveWarmVolumeOwnershipMode(
        volume,
        warmPoolId,
        server.server_id
      );
      if (!ownershipMode) {
        return false;
      }
      const createdAtMs = this.getEntryTimestampMs(volume.createdAt);
      if (createdAtMs === 0 || nowMs - createdAtMs < warmingStaleAfterMs) {
        return false;
      }
      const observationKey = this.warmVolumeObservationKey(
        server.server_id,
        volume,
        ownershipMode
      );
      if (!this.orphanVolumeFirstObservations.has(observationKey)) {
        this.orphanVolumeFirstObservations.add(observationKey);
        return false;
      }
      return true;
    });

    let removed = 0;
    const results = await mapSettledBounded(
      candidates,
      WARM_VOLUME_RECONCILE_CONCURRENCY,
      async (volume) => {
        const volumeName = volume.name;
        const warmPoolId = volumeName.slice('warm-'.length);
        const ownershipMode = this.resolveWarmVolumeOwnershipMode(
          volume,
          warmPoolId,
          server.server_id
        );
        if (!ownershipMode) {
          return;
        }
        leaseContext.assertActive();
        await this.workerLifecycleLockService.withLock(
          `warm-pool:${warmPoolId}`,
          'reconcile_orphan_warm_volume',
          async (volumeLeaseContext) => {
            const combinedLease = {
              signal: AbortSignal.any([
                leaseContext.signal,
                volumeLeaseContext.signal,
              ]),
              assertActive: (): void => {
                leaseContext.assertActive();
                volumeLeaseContext.assertActive();
              },
            };
            combinedLease.assertActive();
            const durableRow =
              await this.workerWarmPoolRepository.viewByIdConsistent(
                warmPoolId
              );
            combinedLease.assertActive();
            if (durableRow) {
              this.orphanVolumeFirstObservations.delete(
                this.warmVolumeObservationKey(
                  server.server_id,
                  volume,
                  ownershipMode
                )
              );
              return;
            }

            const runtimeReferenced =
              await this.workerWarmPoolRepository.isRuntimeReferenceActive({
                warmPoolId,
                containerName: volumeName,
                sessionVolumeName: volumeName,
              });
            combinedLease.assertActive();
            if (runtimeReferenced) {
              this.orphanVolumeFirstObservations.delete(
                this.warmVolumeObservationKey(
                  server.server_id,
                  volume,
                  ownershipMode
                )
              );
              return;
            }

            const result = await this.removeExactWarmVolumeIfUnattached(
              server,
              volume,
              combinedLease
            );
            combinedLease.assertActive();
            if (result === 'removed') {
              this.orphanVolumeFirstObservations.delete(
                this.warmVolumeObservationKey(
                  server.server_id,
                  volume,
                  ownershipMode
                )
              );
              removed += 1;
              console.warn('Removed unreferenced warm session volume', {
                server_id: server.server_id,
                warm_pool_id: warmPoolId,
                session_volume_name: volumeName,
              });
            } else {
              /*
               * A concurrent mount or disappearance breaks the consecutive
               * orphan proof. Require two new clean observations.
               */
              this.orphanVolumeFirstObservations.delete(
                this.warmVolumeObservationKey(
                  server.server_id,
                  volume,
                  ownershipMode
                )
              );
            }
          },
          {
            acquireTimeoutMs: WARM_ACTIVATING_LOCK_ACQUIRE_TIMEOUT_MS,
            retryDelayMs: WARM_ACTIVATING_LOCK_RETRY_DELAY_MS,
            ttlMs: WARM_ACTIVATING_LOCK_TTL_MS,
            heartbeatIntervalMs: WARM_ACTIVATING_LOCK_HEARTBEAT_MS,
          }
        );
        leaseContext.assertActive();
      }
    );
    leaseContext.assertActive();
    for (const [index, result] of results.entries()) {
      if (result.status === 'rejected') {
        const volume = candidates[index];
        const warmPoolId = volume.name.slice('warm-'.length);
        const ownershipMode = this.resolveWarmVolumeOwnershipMode(
          volume,
          warmPoolId,
          server.server_id
        );
        if (ownershipMode) {
          this.orphanVolumeFirstObservations.delete(
            this.warmVolumeObservationKey(
              server.server_id,
              volume,
              ownershipMode
            )
          );
        }
        console.warn('Failed orphan warm volume reconciliation', {
          server_id: server.server_id,
          session_volume_name: candidates[index].name,
          error: result.reason,
        });
      }
    }
    return removed;
  }

  private async resolveStaleActivationAuthority(
    context: StaleActivatingWarmPoolContext
  ): Promise<'current' | 'superseded' | 'unknown'> {
    const { entry, owner } = context;
    if (!owner || owner.deleted_at) {
      return 'superseded';
    }

    /*
     * A missing worker_runtime row is not evidence that an online/disponible
     * Docker target is abandoned. Those states can legitimately precede the
     * runtime metadata write, so the converted-target path must remain
     * fail-closed and be reconciled by the active worker lifecycle.
     */
    if (
      owner.worker_status_id === EWorkerStatus.online ||
      owner.worker_status_id === EWorkerStatus.disponible
    ) {
      return 'unknown';
    }

    if (
      owner.worker_status_id !== EWorkerStatus.creating &&
      owner.worker_status_id !== EWorkerStatus.recreating
    ) {
      return 'superseded';
    }

    const operationId = owner.lifecycle_operation_id?.trim();
    if (!operationId) {
      /*
       * The lifecycle lock proves that a legacy/no-journal activation is no
       * longer executing. A stale activating row with no current operation
       * therefore has no authoritative owner left.
       */
      return 'superseded';
    }

    let prepared: IWorkerLifecycleQueueMessage[];
    try {
      prepared = await this.workerLifecycleQueueService.loadPrepared(
        owner.worker_id,
        operationId
      );
    } catch (error) {
      console.warn(
        'Skipped stale warm activation because lifecycle authority is unavailable',
        {
          warm_pool_id: entry.warm_pool_id,
          worker_id: owner.worker_id,
          lifecycle_operation_id: operationId,
          error,
        }
      );
      return 'unknown';
    }

    const primary = prepared.find(
      (message) => message.action !== 'cleanup_previous_runtime'
    );
    if (!primary) {
      /*
       * An empty or cleanup-only journal is not positive proof that the
       * creating/recreating operation was superseded. Fail closed; the normal
       * lifecycle redriver can restore its authoritative primary command.
       */
      return 'unknown';
    }

    const isCurrentActivation =
      primary.action === 'activate_warm' &&
      primary.operation_id === operationId &&
      primary.worker_id === owner.worker_id &&
      primary.account_id === owner.account_id &&
      primary.server_id === entry.server_id &&
      primary.worker_type_id === entry.worker_type_id &&
      primary.warm_pool_id === entry.warm_pool_id;
    return isCurrentActivation ? 'current' : 'superseded';
  }

  private isExactStaleWarmSource(
    container: IObservedWarmContainer,
    context: StaleActivatingWarmPoolContext
  ): boolean {
    const { entry } = context;
    const expectedName = `warm-${entry.warm_pool_id}`;
    return Boolean(
      entry.container_id &&
      container.containerId === entry.container_id.toLowerCase() &&
      container.name === expectedName &&
      container.warmStandbyValue === 'true' &&
      container.warmPoolId === entry.warm_pool_id &&
      container.workerTypeId === entry.worker_type_id &&
      container.serverId === entry.server_id &&
      this.hasMatchingSessionStorage(container, entry) &&
      !container.workerId
    );
  }

  private isExactStaleWarmTarget(
    container: IObservedWarmContainer,
    context: StaleActivatingWarmPoolContext
  ): boolean {
    const { entry, owner } = context;
    const workerId = entry.reserved_by_worker_id as string;
    return Boolean(
      container.containerId &&
      CONTAINER_ID_PATTERN.test(container.containerId) &&
      container.name === workerId &&
      container.warmStandbyValue === 'false' &&
      container.warmPoolId === entry.warm_pool_id &&
      container.workerTypeId === entry.worker_type_id &&
      container.serverId === entry.server_id &&
      this.hasMatchingSessionStorage(container, entry) &&
      container.workerId === workerId &&
      (!owner || container.accountId === owner.account_id)
    );
  }

  private hasValidStaleActivationRowIdentity(
    context: StaleActivatingWarmPoolContext
  ): boolean {
    const { entry } = context;
    const expectedName = `warm-${entry.warm_pool_id}`;
    const hasBackendIdentity =
      entry.session_storage === EWorkerSessionStorage.postgres
        ? entry.session_volume_name === null
        : entry.session_storage === EWorkerSessionStorage.legacy_volume &&
          entry.session_volume_name === expectedName;
    return Boolean(
      UUID_PATTERN.test(entry.warm_pool_id) &&
      entry.reserved_by_worker_id &&
      UUID_PATTERN.test(entry.reserved_by_worker_id) &&
      entry.container_id &&
      CONTAINER_ID_PATTERN.test(entry.container_id) &&
      entry.container_name === expectedName &&
      hasBackendIdentity &&
      entry.updated_at
    );
  }

  private async reconcileOneStaleActivatingWarmPool(
    initial: StaleActivatingWarmPoolContext,
    server: IBalanceMonitorServer,
    staleBefore: string,
    scanLeaseContext: ILockLeaseContext
  ): Promise<number> {
    scanLeaseContext.assertActive();
    const workerId = initial.entry.reserved_by_worker_id;
    if (!workerId || !UUID_PATTERN.test(workerId)) {
      return 0;
    }

    let claimed: IWorkerWarmPool | null = null;
    try {
      claimed = await this.workerLifecycleLockService.withLock(
        workerId,
        'reconcile_stale_warm_activation',
        async (leaseContext) => {
          scanLeaseContext.assertActive();
          leaseContext.assertActive();
          const current =
            await this.workerWarmPoolRepository.viewStaleActivatingForReconcile(
              {
                warmPoolId: initial.entry.warm_pool_id,
                staleBefore,
              }
            );
          scanLeaseContext.assertActive();
          leaseContext.assertActive();
          if (
            !current ||
            current.entry.server_id !== server.server_id ||
            !this.hasValidStaleActivationRowIdentity(current)
          ) {
            return null;
          }

          const authority = await this.resolveStaleActivationAuthority(current);
          scanLeaseContext.assertActive();
          leaseContext.assertActive();
          if (authority !== 'superseded') {
            return null;
          }

          const sourceContainerId = current.entry.container_id as string;
          const ownerWorkerId = current.entry.reserved_by_worker_id as string;
          const observed = await this.inspectExactWarmContainers(server, [
            sourceContainerId,
            ownerWorkerId,
          ]);
          scanLeaseContext.assertActive();
          leaseContext.assertActive();

          const sourceObservation = observed.find(
            (container) =>
              container.containerId === sourceContainerId.toLowerCase()
          );
          const targetObservation = observed.find(
            (container) => container.name === ownerWorkerId
          );
          const exactSource =
            sourceObservation &&
            this.isExactStaleWarmSource(sourceObservation, current)
              ? sourceObservation
              : null;
          const exactTarget =
            targetObservation &&
            this.isExactStaleWarmTarget(targetObservation, current)
              ? targetObservation
              : null;

          if (
            (sourceObservation && !exactSource) ||
            (targetObservation && !exactTarget) ||
            (exactSource && exactTarget)
          ) {
            console.warn(
              'Skipped stale warm activation after Docker identity conflict',
              {
                warm_pool_id: current.entry.warm_pool_id,
                worker_id: ownerWorkerId,
                source_present: Boolean(sourceObservation),
                target_present: Boolean(targetObservation),
              }
            );
            return null;
          }

          const sessionVolumeName = current.entry.session_volume_name;
          const isLegacyVolume =
            current.entry.session_storage ===
            EWorkerSessionStorage.legacy_volume;
          const volumeExists =
            isLegacyVolume && sessionVolumeName
              ? await this.inspectExactWarmVolume(server, sessionVolumeName)
              : null;
          scanLeaseContext.assertActive();
          leaseContext.assertActive();
          if (isLegacyVolume && (exactSource || exactTarget) && !volumeExists) {
            console.warn(
              'Skipped stale warm activation after session volume conflict',
              {
                warm_pool_id: current.entry.warm_pool_id,
                worker_id: ownerWorkerId,
                session_volume_name: current.entry.session_volume_name,
              }
            );
            return null;
          }

          const cleanupContainerId =
            exactTarget?.containerId ??
            exactSource?.containerId ??
            sourceContainerId;
          const cleanupContainerName =
            exactTarget?.name ??
            exactSource?.name ??
            (current.entry.container_name as string);
          const recoveryCut = exactTarget
            ? 'target_created_before_runtime'
            : exactSource
              ? 'activation_started_before_source_removal'
              : volumeExists
                ? 'source_removed_before_target'
                : 'runtime_resources_absent';

          scanLeaseContext.assertActive();
          const cleanup =
            await this.workerWarmPoolRepository.claimStaleActivatingForCleanup({
              warmPoolId: current.entry.warm_pool_id,
              reservedByWorkerId: ownerWorkerId,
              expectedSourceContainerId: sourceContainerId,
              expectedWarmUpdatedAt: current.entry.updated_at as string,
              cleanupContainerId,
              cleanupContainerName,
              sessionStorage: current.entry.session_storage,
              sessionVolumeName,
              expectedOwner: current.owner,
              lastError: `warm_activation_abandoned:${recoveryCut}`,
            });
          scanLeaseContext.assertActive();
          leaseContext.assertActive();
          return cleanup;
        },
        {
          ttlMs: WARM_ACTIVATING_LOCK_TTL_MS,
          acquireTimeoutMs: WARM_ACTIVATING_LOCK_ACQUIRE_TIMEOUT_MS,
          retryDelayMs: WARM_ACTIVATING_LOCK_RETRY_DELAY_MS,
          heartbeatIntervalMs: WARM_ACTIVATING_LOCK_HEARTBEAT_MS,
        }
      );
      scanLeaseContext.assertActive();
    } catch (error) {
      scanLeaseContext.assertActive();
      console.warn('Failed to reconcile stale warm activation safely', {
        warm_pool_id: initial.entry.warm_pool_id,
        worker_id: workerId,
        error,
      });
      return 0;
    }

    if (!claimed) {
      return 0;
    }
    return this.publishClaimedCleanupEntries(
      [claimed],
      'stale activating',
      scanLeaseContext
    );
  }

  private async reconcileStaleActivatingWarmPool(
    settings: IWorkerWarmPoolSettings,
    servers: IBalanceMonitorServer[],
    leaseContext: ILockLeaseContext
  ): Promise<number> {
    leaseContext.assertActive();
    const staleBefore = new Date(
      Date.now() - settings.warming_stale_after_seconds * 1000
    ).toISOString();
    const candidates =
      await this.workerWarmPoolRepository.listStaleActivatingForReconcile({
        staleBefore,
        limit: WARM_ACTIVATING_RECONCILE_BATCH_SIZE,
      });
    leaseContext.assertActive();
    if (!candidates.length) {
      return 0;
    }

    const serversById = new Map(
      servers.map((server) => [server.server_id, server] as const)
    );
    let reconciled = 0;
    const results = await mapSettledBounded(
      candidates,
      WARM_ACTIVATING_RECONCILE_CONCURRENCY,
      async (candidate) => {
        leaseContext.assertActive();
        const server = serversById.get(candidate.entry.server_id);
        if (!server) {
          return;
        }
        reconciled += await this.reconcileOneStaleActivatingWarmPool(
          candidate,
          server,
          staleBefore,
          leaseContext
        );
        leaseContext.assertActive();
      }
    );
    leaseContext.assertActive();
    for (const [index, result] of results.entries()) {
      if (result.status === 'rejected') {
        console.warn('Failed stale warm activation reconciliation batch item', {
          warm_pool_id: candidates[index].entry.warm_pool_id,
          error: result.reason,
        });
      }
    }
    return reconciled;
  }

  private getWarmPoolReference(
    entry: Pick<IWorkerWarmPool, 'warm_pool_id' | 'container_name'>
  ): {
    warmPoolId: string;
    containerName: string;
  } {
    return {
      warmPoolId: entry.warm_pool_id,
      containerName: entry.container_name || `warm-${entry.warm_pool_id}`,
    };
  }

  private isEntryVisibleInDocker(
    entry: IWorkerWarmPool,
    observedContainers: IObservedWarmContainer[]
  ): boolean {
    const reference = this.getWarmPoolReference(entry);

    return observedContainers.some(
      (container) =>
        container.running &&
        !container.paused &&
        container.healthStatus !== 'unhealthy' &&
        (!entry.container_id ||
          !container.containerId ||
          entry.container_id.toLowerCase() === container.containerId) &&
        (container.warmPoolId === reference.warmPoolId ||
          container.name === reference.containerName)
    );
  }

  private isEntryPersistentlyUnhealthyInDocker(
    entry: IWorkerWarmPool,
    observedContainers: IObservedWarmContainer[]
  ): boolean {
    const container = this.findExactEntryStandbyContainer(
      entry,
      observedContainers
    );
    return (
      container?.running === true &&
      !container.paused &&
      container.healthStatus === 'unhealthy'
    );
  }

  private isEntryPersistentlyStartingInDocker(
    entry: IWorkerWarmPool,
    observedContainers: IObservedWarmContainer[]
  ): IObservedWarmContainer | null {
    const container = this.findExactEntryStandbyContainer(
      entry,
      observedContainers
    );
    return container?.running &&
      !container.paused &&
      container.healthStatus === 'starting'
      ? container
      : null;
  }

  private isEntryPersistentlyPausedInDocker(
    entry: IWorkerWarmPool,
    observedContainers: IObservedWarmContainer[]
  ): boolean {
    return (
      this.findExactEntryStandbyContainer(entry, observedContainers)?.paused ===
      true
    );
  }

  private isEntryPersistentlyStoppedInDocker(
    entry: IWorkerWarmPool,
    observedContainers: IObservedWarmContainer[]
  ): boolean {
    return (
      this.findExactEntryStandbyContainer(entry, observedContainers)
        ?.running === false
    );
  }

  private findExactEntryStandbyContainer(
    entry: IWorkerWarmPool,
    observedContainers: IObservedWarmContainer[]
  ): IObservedWarmContainer | null {
    const reference = this.getWarmPoolReference(entry);

    return (
      observedContainers.find(
        (container) =>
          Boolean(entry.container_id) &&
          Boolean(container.containerId) &&
          CONTAINER_ID_PATTERN.test(entry.container_id ?? '') &&
          CONTAINER_ID_PATTERN.test(container.containerId ?? '') &&
          entry.container_id?.toLowerCase() === container.containerId &&
          container.warmStandby &&
          container.warmPoolId === reference.warmPoolId &&
          container.name === reference.containerName &&
          container.workerTypeId === entry.worker_type_id &&
          container.serverId === entry.server_id &&
          this.hasMatchingSessionStorage(container, entry) &&
          !container.workerId &&
          !container.accountId &&
          !container.lifecycleOperationId
      ) ?? null
    );
  }

  private hasEntryContainerIdObservation(
    entry: IWorkerWarmPool,
    observedContainers: IObservedWarmContainer[]
  ): boolean {
    const expectedContainerId = entry.container_id?.trim().toLowerCase();
    return Boolean(
      expectedContainerId &&
      CONTAINER_ID_PATTERN.test(expectedContainerId) &&
      observedContainers.some(
        (container) =>
          container.containerId?.trim().toLowerCase() === expectedContainerId
      )
    );
  }

  private hasEntryUnhealthyObservation(
    entry: IWorkerWarmPool,
    observedContainers: IObservedWarmContainer[]
  ): boolean {
    const reference = this.getWarmPoolReference(entry);

    return observedContainers.some(
      (container) =>
        container.running &&
        container.healthStatus === 'unhealthy' &&
        (container.warmPoolId === reference.warmPoolId ||
          container.name === reference.containerName)
    );
  }

  private hasEntryStartingObservation(
    entry: IWorkerWarmPool,
    observedContainers: IObservedWarmContainer[]
  ): boolean {
    const reference = this.getWarmPoolReference(entry);

    return observedContainers.some(
      (container) =>
        container.running &&
        !container.paused &&
        container.healthStatus === 'starting' &&
        (container.warmPoolId === reference.warmPoolId ||
          container.name === reference.containerName)
    );
  }

  private hasEntryPausedObservation(
    entry: IWorkerWarmPool,
    observedContainers: IObservedWarmContainer[]
  ): boolean {
    const reference = this.getWarmPoolReference(entry);

    return observedContainers.some(
      (container) =>
        container.paused &&
        (container.warmPoolId === reference.warmPoolId ||
          container.name === reference.containerName)
    );
  }

  private hasEntryStoppedObservation(
    entry: IWorkerWarmPool,
    observedContainers: IObservedWarmContainer[]
  ): boolean {
    const reference = this.getWarmPoolReference(entry);

    return observedContainers.some(
      (container) =>
        !container.running &&
        (container.warmPoolId === reference.warmPoolId ||
          container.name === reference.containerName)
    );
  }

  private parseStartingMarker(
    marker?: string | null
  ): { firstObservedAtMs: number; restartCount: number } | null {
    const match = marker?.match(WARM_STARTING_MARKER_PATTERN);
    if (!match) {
      return null;
    }

    const firstObservedAtMs = Number(match[1]);
    const restartCount = Number(match[2]);
    if (
      !Number.isFinite(firstObservedAtMs) ||
      firstObservedAtMs <= 0 ||
      !Number.isFinite(restartCount) ||
      restartCount < 0
    ) {
      return null;
    }

    return { firstObservedAtMs, restartCount };
  }

  private getStartingBudgetMs(warmingStaleAfterMs: number): number {
    const configured = Number.isFinite(warmingStaleAfterMs)
      ? warmingStaleAfterMs
      : WARM_STARTING_MIN_BUDGET_MS;
    return Math.max(
      WARM_STARTING_MIN_BUDGET_MS,
      Math.min(WARM_STARTING_MAX_BUDGET_MS, configured)
    );
  }

  private getFirstStartingObservationMs(
    container: IObservedWarmContainer,
    nowMs: number
  ): number {
    const startedAtMs = this.getEntryTimestampMs(container.startedAt);
    return startedAtMs > 0 && startedAtMs <= nowMs ? startedAtMs : nowMs;
  }

  private isStrictStandbyContainer(
    container: IObservedWarmContainer,
    expectedServerId?: string
  ): container is IObservedWarmContainer & {
    containerId: string;
    warmPoolId: string;
    workerTypeId: string;
    serverId: string;
    sessionStorage: EWorkerSessionStorage;
    imageId: string;
    imageName: string;
  } {
    const expectedName = container.warmPoolId
      ? `warm-${container.warmPoolId}`
      : '';
    return Boolean(
      container.containerId &&
      CONTAINER_ID_PATTERN.test(container.containerId) &&
      container.warmStandby &&
      container.warmStandbyValue === 'true' &&
      container.warmPoolId &&
      UUID_PATTERN.test(container.warmPoolId) &&
      container.workerTypeId &&
      WARM_WORKER_TYPE_SET.has(container.workerTypeId) &&
      container.name === expectedName &&
      container.serverId &&
      (!expectedServerId || container.serverId === expectedServerId) &&
      this.hasValidObservedSessionStorage(container) &&
      !container.workerId &&
      !container.accountId &&
      !container.lifecycleOperationId &&
      this.hasPinnedImageIdentity(container)
    );
  }

  private resolveObservedSessionStorage(
    container: IObservedWarmContainer
  ): EWorkerSessionStorage | null {
    if (container.sessionStorage) {
      return container.sessionStorage;
    }

    const expectedVolume = container.warmPoolId
      ? `warm-${container.warmPoolId}`
      : '';
    /*
     * Containers created before the storage label existed are recognized as
     * legacy only with both the canonical volume label and the actual named
     * volume mount. PostgreSQL ownership always requires the explicit label.
     */
    return expectedVolume &&
      container.sessionVolumeName === expectedVolume &&
      container.mountNames.includes(expectedVolume)
      ? EWorkerSessionStorage.legacy_volume
      : null;
  }

  private hasValidObservedSessionStorage(
    container: IObservedWarmContainer
  ): container is IObservedWarmContainer & {
    sessionStorage: EWorkerSessionStorage;
  } {
    const storage = this.resolveObservedSessionStorage(container);
    if (!storage) {
      return false;
    }
    const expectedVolume = container.warmPoolId
      ? `warm-${container.warmPoolId}`
      : '';
    const valid =
      storage === EWorkerSessionStorage.postgres
        ? container.sessionStorage === EWorkerSessionStorage.postgres &&
          !container.sessionVolumeName &&
          container.mountNames.length === 0
        : container.sessionVolumeName === expectedVolume &&
          container.mountNames.includes(expectedVolume);
    if (valid && !container.sessionStorage) {
      container.sessionStorage = storage;
    }
    return valid;
  }

  private hasMatchingSessionStorage(
    container: IObservedWarmContainer,
    entry: Pick<IWorkerWarmPool, 'session_storage' | 'session_volume_name'>
  ): boolean {
    if (!this.hasValidObservedSessionStorage(container)) {
      return false;
    }
    return (
      container.sessionStorage === entry.session_storage &&
      (entry.session_storage === EWorkerSessionStorage.postgres
        ? entry.session_volume_name === null && !container.sessionVolumeName
        : Boolean(entry.session_volume_name) &&
          container.sessionVolumeName === entry.session_volume_name)
    );
  }

  private hasPinnedImageIdentity(
    container: IObservedWarmContainer
  ): container is IObservedWarmContainer & {
    imageId: string;
    imageName: string;
    workerTypeId: string;
  } {
    if (
      !container.workerTypeId ||
      !WARM_WORKER_TYPE_SET.has(container.workerTypeId) ||
      !container.imageId ||
      !IMAGE_ID_PATTERN.test(container.imageId) ||
      !container.imageName
    ) {
      return false;
    }

    /*
     * The immutable content ID identifies the running revision. The image
     * label is retained only as opaque, non-empty provenance and is compared
     * between exact snapshots by the caller. Provider ownership comes from
     * the durable worker-type identity plus RuntimeHealth, never from the
     * currently configured repository/tag/digest.
     */
    return true;
  }

  private hasAdoptedWarmRuntimeDockerCandidateIdentity(
    container: IObservedWarmContainer,
    expectedServerId: string
  ): boolean {
    return Boolean(
      container.exactInspection &&
      container.inventoryConfirmed &&
      container.containerId &&
      CONTAINER_ID_PATTERN.test(container.containerId) &&
      (container.warmStandbyValue === 'false' ||
        container.warmStandbyValue === 'true') &&
      container.warmPoolId &&
      UUID_PATTERN.test(container.warmPoolId) &&
      container.workerTypeId &&
      WARM_WORKER_TYPE_SET.has(container.workerTypeId) &&
      container.serverId === expectedServerId &&
      this.hasValidObservedSessionStorage(container) &&
      UUID_PATTERN.test(container.name) &&
      (!container.workerId || UUID_PATTERN.test(container.workerId)) &&
      (!container.accountId || UUID_PATTERN.test(container.accountId)) &&
      (!container.lifecycleOperationId ||
        UUID_PATTERN.test(container.lifecycleOperationId)) &&
      (!container.runtimeGeneration ||
        (Number.isSafeInteger(container.runtimeGeneration) &&
          container.runtimeGeneration > 0)) &&
      this.hasPinnedImageIdentity(container)
    );
  }

  private isAdoptedWarmRuntimeForCapacity(
    container: IObservedWarmContainer,
    expectedServerId: string,
    durable: AdoptedWarmRuntimeIdentity | null | undefined
  ): boolean {
    if (
      !this.hasAdoptedWarmRuntimeDockerCandidateIdentity(
        container,
        expectedServerId
      ) ||
      !durable
    ) {
      return false;
    }

    const assignedRuntime =
      durable.worker_container_id === container.containerId;
    const transitioningRuntime =
      durable.lifecycle_operation_id !== null &&
      durable.lifecycle_operation_id === container.lifecycleOperationId;
    const optionalDockerIdentityMatches =
      (!container.workerId || durable.worker_id === container.workerId) &&
      (!container.accountId || durable.account_id === container.accountId) &&
      (!container.lifecycleOperationId ||
        durable.lifecycle_operation_id === null ||
        durable.lifecycle_operation_id === container.lifecycleOperationId) &&
      (!container.runtimeGeneration ||
        durable.runtime_generation === container.runtimeGeneration);

    /*
     * worker_status_id is intentionally not an adoption fence. Provider and
     * lifecycle state can move through offline, mismatched, error, deleting or
     * stopped while the exact worker_runtime still owns this former standby.
     * Treating that mutable status as identity would freeze replenishment for
     * the provider precisely while a channel is degraded.
     *
     * Early warm activation renamed the container and persisted worker_runtime
     * but left `warm_standby=true` and omitted the mutable active labels. Those
     * labels may be absent, never contradictory: the exact Docker
     * container/name/image/session identity plus the durable runtime row is
     * the capacity proof. This classification only excludes an active runtime
     * from the replenishment ambiguity gate; it grants no deletion authority.
     */
    return (
      UUID_PATTERN.test(durable.worker_id) &&
      UUID_PATTERN.test(durable.account_id) &&
      durable.worker_id === container.name &&
      optionalDockerIdentityMatches &&
      durable.server_id === expectedServerId &&
      durable.worker_type_id === container.workerTypeId &&
      durable.runtime_container_id === container.containerId &&
      durable.runtime_container_name === container.name &&
      durable.session_storage === container.sessionStorage &&
      durable.session_volume_name === (container.sessionVolumeName ?? null) &&
      Number.isSafeInteger(durable.runtime_generation) &&
      durable.runtime_generation > 0 &&
      durable.warm_pool_id === container.warmPoolId &&
      (assignedRuntime || transitioningRuntime)
    );
  }

  private isWarmShapedContainer(container: IObservedWarmContainer): boolean {
    const nameWarmPoolId = container.name.startsWith('warm-')
      ? container.name.slice('warm-'.length)
      : '';
    return (
      container.warmStandby ||
      Boolean(container.warmPoolId) ||
      UUID_PATTERN.test(nameWarmPoolId)
    );
  }

  private ambiguousPhysicalObservationKey(
    expectedServerId: string,
    container: IObservedWarmContainer
  ): string | null {
    if (
      !container.inventoryConfirmed ||
      !container.exactInspection ||
      !container.containerId ||
      !CONTAINER_ID_PATTERN.test(container.containerId)
    ) {
      return null;
    }

    /*
     * Only ownership/lineage fields participate in the fingerprint. Runtime
     * health and process state are mutable and must not restart the ambiguity
     * grace forever. The Docker ID and creation timestamp bind the observation
     * to one immutable physical object.
     */
    return `${expectedServerId}\u0000${JSON.stringify([
      container.containerId,
      container.createdAt ?? '',
      container.name,
      container.warmStandbyValue ?? '',
      container.warmPoolId ?? '',
      container.workerTypeId ?? '',
      container.serverId ?? '',
      container.sessionStorage ?? '',
      container.sessionVolumeName ?? '',
      container.workerId ?? '',
      container.accountId ?? '',
      container.lifecycleOperationId ?? '',
      container.imageId ?? '',
      container.imageName ?? '',
      container.runtimeGeneration ?? '',
      [...container.mountNames].sort(),
    ])}`;
  }

  private isAmbiguousPhysicalIdentityDurablyWarmOwned(
    container: IObservedWarmContainer,
    durableWarmPoolIds: Set<string>
  ): boolean {
    if (container.warmPoolId && durableWarmPoolIds.has(container.warmPoolId)) {
      return true;
    }
    const nameWarmPoolId = container.name.startsWith('warm-')
      ? container.name.slice('warm-'.length)
      : '';
    return (
      UUID_PATTERN.test(nameWarmPoolId) &&
      durableWarmPoolIds.has(nameWarmPoolId)
    );
  }

  private observeAmbiguousWarmPhysicalIdentities(
    expectedServerId: string,
    containers: IObservedWarmContainer[],
    graceMs: number
  ): Set<string> {
    const nowMs = Date.now();
    const boundedGraceMs = Math.max(1, graceMs);
    const currentKeys = new Set<string>();
    const matureKeys = new Set<string>();

    for (const container of containers) {
      const key = this.ambiguousPhysicalObservationKey(
        expectedServerId,
        container
      );
      if (!key) {
        continue;
      }
      currentKeys.add(key);
      const createdAtMs = this.getEntryTimestampMs(container.createdAt);
      const startedAtMs = this.getEntryTimestampMs(container.startedAt);
      const physicalSinceMs =
        createdAtMs > 0 && createdAtMs <= nowMs
          ? createdAtMs
          : startedAtMs > 0 && startedAtMs <= nowMs
            ? startedAtMs
            : nowMs;
      const previous = this.ambiguousPhysicalObservations.get(key);
      const observation = {
        firstObservedAtMs: previous?.firstObservedAtMs ?? physicalSinceMs,
        observations: Math.min(2, (previous?.observations ?? 0) + 1),
      };
      this.ambiguousPhysicalObservations.set(key, observation);

      const observedAgeMs = nowMs - observation.firstObservedAtMs;
      if (
        observedAgeMs >= boundedGraceMs &&
        /*
         * Normally require two successful scans. The extended physical-age
         * fallback prevents a scheduler restart/failover on every scan from
         * resetting an old exact ambiguity forever. Its current inventory and
         * exact Docker inspect are still two independent observations; the
         * fallback only relaxes cross-scan memory after twice the grace.
         */
        (observation.observations >= 2 || observedAgeMs >= boundedGraceMs * 2)
      ) {
        matureKeys.add(key);
      }
    }

    const serverPrefix = `${expectedServerId}\u0000`;
    for (const key of [...this.ambiguousPhysicalObservations.keys()]) {
      if (key.startsWith(serverPrefix) && !currentKeys.has(key)) {
        this.ambiguousPhysicalObservations.delete(key);
      }
    }

    return matureKeys;
  }

  private clearAmbiguousPhysicalObservationsForServer(serverId: string): void {
    const serverPrefix = `${serverId}\u0000`;
    for (const key of [...this.ambiguousPhysicalObservations.keys()]) {
      if (key.startsWith(serverPrefix)) {
        this.ambiguousPhysicalObservations.delete(key);
      }
    }
  }

  private countPhysicalStandbysByType(
    containers: IObservedWarmContainer[],
    expectedServerId: string,
    durableWarmPoolIds: ReadonlySet<string>,
    capacityWarmPoolIds: ReadonlySet<string>
  ): Map<EWorkerType, number> {
    const counts = new Map<EWorkerType, number>();
    for (const container of containers) {
      if (!this.isStrictStandbyContainer(container, expectedServerId)) {
        continue;
      }
      /*
       * A strict physical orphan still blocks creation until its fenced orphan
       * claim succeeds. Once a durable row exists, only active warm states are
       * capacity: deleting/error/assigned rows are cleanup or runtime lineage
       * and must not prevent a bounded target replacement.
       */
      if (
        durableWarmPoolIds.has(container.warmPoolId) &&
        !capacityWarmPoolIds.has(container.warmPoolId)
      ) {
        continue;
      }
      const workerTypeId = container.workerTypeId as EWorkerType;
      counts.set(workerTypeId, (counts.get(workerTypeId) ?? 0) + 1);
    }
    return counts;
  }

  private findUnpersistedWarmingCandidate(
    entry: IWorkerWarmPool,
    containers: IObservedWarmContainer[]
  ): (IObservedWarmContainer & { containerId: string }) | null {
    const expectedName = `warm-${entry.warm_pool_id}`;
    return (
      containers.find(
        (
          container
        ): container is IObservedWarmContainer & { containerId: string } =>
          Boolean(
            container.containerId &&
            CONTAINER_ID_PATTERN.test(container.containerId) &&
            container.warmStandby &&
            container.warmPoolId === entry.warm_pool_id &&
            container.name === expectedName &&
            container.workerTypeId === entry.worker_type_id
          )
      ) ?? null
    );
  }

  private isExactUnpersistedWarmingStandby(
    entry: IWorkerWarmPool,
    expectedContainerId: string,
    container: IObservedWarmContainer | null
  ): container is IObservedWarmContainer {
    const expectedName = `warm-${entry.warm_pool_id}`;
    return Boolean(
      container &&
      container.containerId === expectedContainerId &&
      container.warmStandby &&
      container.warmPoolId === entry.warm_pool_id &&
      container.name === expectedName &&
      container.workerTypeId === entry.worker_type_id &&
      container.serverId === entry.server_id &&
      this.hasMatchingSessionStorage(container, entry) &&
      !container.workerId &&
      !container.accountId &&
      !container.lifecycleOperationId &&
      this.hasPinnedImageIdentity(container)
    );
  }

  private getEntryTimestampMs(value?: string | null): number {
    if (!value) {
      return 0;
    }

    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private shouldReconcileMissingEntry(
    entry: IWorkerWarmPool,
    nowMs: number,
    warmingStaleAfterMs: number
  ): boolean {
    if (entry.state === EWorkerWarmPoolState.ready) {
      return true;
    }

    if (entry.state === EWorkerWarmPoolState.reserved) {
      const expiresAt = this.getEntryTimestampMs(entry.reservation_expires_at);
      return expiresAt > 0 && expiresAt <= nowMs;
    }

    if (entry.state === EWorkerWarmPoolState.warming) {
      const updatedAt = this.getEntryTimestampMs(entry.updated_at);
      const createdAt = this.getEntryTimestampMs(entry.created_at);
      const lastTouchedAt = Math.max(updatedAt, createdAt);
      return (
        lastTouchedAt === 0 || nowMs - lastTouchedAt >= warmingStaleAfterMs
      );
    }

    return false;
  }

  private resolveWarmStandbyHealthRejection(
    health: IWorkerRuntimeHealthResponseProto,
    entry: IWorkerWarmPool
  ): string | undefined {
    if (health.error?.trim()) return 'worker_reported_error';
    if (health.warm_pool_id !== entry.warm_pool_id) {
      return 'warm_pool_id_mismatch';
    }
    if (health.worker_type_id !== entry.worker_type_id) {
      return 'worker_type_id_mismatch';
    }
    if (health.worker_id && health.worker_id !== entry.warm_pool_id) {
      return 'worker_id_mismatch';
    }
    if (health.account_id && health.account_id !== 'warm-standby') {
      return 'account_id_mismatch';
    }
    if (health.standby !== true) return 'standby_not_true';
    if (health.ready !== true) return 'ready_not_true';
    if (health.activated !== false) return 'activated_not_false';
    if (health.runtime_state !== 'warm_standby') {
      return 'runtime_state_mismatch';
    }
    if (health.kafka_unhealthy === true) return 'kafka_unhealthy';
    if (health.kafka_consumers_ready === true) {
      return 'kafka_consumers_started_in_standby';
    }
    return undefined;
  }

  private isHealthyExactStandby(
    entry: IWorkerWarmPool,
    container: IObservedWarmContainer | null
  ): container is IObservedWarmContainer {
    return Boolean(
      container &&
      this.findExactEntryStandbyContainer(entry, [container]) &&
      container.running &&
      !container.paused &&
      container.healthStatus === 'healthy'
    );
  }

  private async reconcileStaleUnpersistedWarmingRuntimes(
    server: IBalanceMonitorServer,
    activeEntries: IWorkerWarmPool[],
    observedContainers: IObservedWarmContainer[],
    nowMs: number,
    warmingStaleAfterMs: number,
    leaseContext: ILockLeaseContext
  ): Promise<{ reconciled: number; handledWarmPoolIds: Set<string> }> {
    const candidates = activeEntries
      .map((entry) => ({
        entry,
        container: this.findUnpersistedWarmingCandidate(
          entry,
          observedContainers
        ),
      }))
      .filter(
        (
          item
        ): item is {
          entry: IWorkerWarmPool;
          container: IObservedWarmContainer & { containerId: string };
        } =>
          item.entry.state === EWorkerWarmPoolState.warming &&
          !item.entry.container_id &&
          Boolean(item.entry.updated_at) &&
          this.shouldReconcileMissingEntry(
            item.entry,
            nowMs,
            warmingStaleAfterMs
          ) &&
          item.container !== null
      );
    const handledWarmPoolIds = new Set<string>();
    let reconciled = 0;
    const results = await mapSettledBounded(
      candidates,
      WARM_ACTIVATING_RECONCILE_CONCURRENCY,
      async ({ entry, container }) => {
        leaseContext.assertActive();
        await this.workerLifecycleLockService.withLock(
          `warm-pool:${entry.warm_pool_id}`,
          'reconcile_unpersisted_warm_creation',
          async (warmLeaseContext) => {
            const combinedLease = {
              signal: AbortSignal.any([
                leaseContext.signal,
                warmLeaseContext.signal,
              ]),
              assertActive: (): void => {
                leaseContext.assertActive();
                warmLeaseContext.assertActive();
              },
            };
            combinedLease.assertActive();
            const current =
              await this.workerWarmPoolRepository.viewByIdConsistent(
                entry.warm_pool_id
              );
            combinedLease.assertActive();
            if (
              !current ||
              current.state !== EWorkerWarmPoolState.warming ||
              current.container_id ||
              current.server_id !== entry.server_id ||
              current.worker_type_id !== entry.worker_type_id ||
              current.session_storage !== entry.session_storage ||
              current.session_volume_name !== entry.session_volume_name ||
              current.updated_at !== entry.updated_at ||
              !this.shouldReconcileMissingEntry(
                current,
                Date.now(),
                warmingStaleAfterMs
              )
            ) {
              return;
            }

            const exact = await this.inspectExactWarmContainers(server, [
              container.containerId,
            ]);
            combinedLease.assertActive();
            const exactContainer =
              exact.find(
                (item) => item.containerId === container.containerId
              ) ?? null;
            if (
              !this.isExactUnpersistedWarmingStandby(
                current,
                container.containerId,
                exactContainer
              )
            ) {
              return;
            }

            const claimed =
              await this.workerWarmPoolRepository.claimUnpersistedWarmingRuntimeForCleanup(
                {
                  warmPoolId: current.warm_pool_id,
                  serverId: current.server_id,
                  workerTypeId: current.worker_type_id,
                  expectedWarmUpdatedAt: current.updated_at as string,
                  containerId: container.containerId,
                  containerName: `warm-${current.warm_pool_id}`,
                  sessionStorage: current.session_storage,
                  sessionVolumeName: current.session_volume_name,
                }
              );
            combinedLease.assertActive();
            if (!claimed) {
              return;
            }
            handledWarmPoolIds.add(current.warm_pool_id);
            reconciled += await this.publishClaimedCleanupEntries(
              [claimed],
              'unpersisted warm creation',
              combinedLease
            );
          },
          {
            acquireTimeoutMs: WARM_ACTIVATING_LOCK_ACQUIRE_TIMEOUT_MS,
            retryDelayMs: WARM_ACTIVATING_LOCK_RETRY_DELAY_MS,
            ttlMs: WARM_ACTIVATING_LOCK_TTL_MS,
            heartbeatIntervalMs: WARM_ACTIVATING_LOCK_HEARTBEAT_MS,
          }
        );
        leaseContext.assertActive();
      }
    );
    leaseContext.assertActive();
    for (const [index, result] of results.entries()) {
      if (result.status === 'rejected') {
        console.warn('Failed unpersisted warm creation reconciliation', {
          warm_pool_id: candidates[index].entry.warm_pool_id,
          server_id: server.server_id,
          error: result.reason,
        });
      }
    }
    return { reconciled, handledWarmPoolIds };
  }

  private async reconcileReadyHealthLeases(
    server: IBalanceMonitorServer,
    activeEntries: IWorkerWarmPool[],
    observedContainers: IObservedWarmContainer[],
    probeDueBeforeMs: number,
    leaseContext: ILockLeaseContext
  ): Promise<{ reconciled: number; handledWarmPoolIds: Set<string> }> {
    leaseContext.assertActive();
    const readyEntries = activeEntries.filter(
      (entry) =>
        entry.state === EWorkerWarmPoolState.ready &&
        Boolean(entry.container_id) &&
        CONTAINER_ID_PATTERN.test(entry.container_id ?? '') &&
        !this.hasEntryUnhealthyObservation(entry, observedContainers) &&
        !this.hasEntryStartingObservation(entry, observedContainers) &&
        !this.hasEntryPausedObservation(entry, observedContainers) &&
        !this.hasEntryStoppedObservation(entry, observedContainers) &&
        (this.getEntryTimestampMs(entry.last_health_at) <= probeDueBeforeMs ||
          entry.last_error === WARM_RUNTIME_HEALTH_FAILURE_MARKER)
    );
    const handledWarmPoolIds = new Set<string>();
    if (!readyEntries.length) {
      return { reconciled: 0, handledWarmPoolIds };
    }

    const containerIds = readyEntries.map(
      (entry) => entry.container_id as string
    );
    let exactBefore: IObservedWarmContainer[];
    try {
      exactBefore = await this.inspectExactWarmContainers(server, containerIds);
      leaseContext.assertActive();
    } catch (error) {
      leaseContext.assertActive();
      console.warn('Failed to establish initial warm standby health snapshot', {
        server_id: server.server_id,
        candidate_count: readyEntries.length,
        error,
      });
      return { reconciled: 0, handledWarmPoolIds };
    }

    const grpcOutcomes = new Map<string, WarmRuntimeHealthProbeOutcome>();
    /*
     * A Docker tag is mutable deployment metadata, not runtime health. Warm
     * containers are intentionally pinned to the content ID they were created
     * with and remain eligible while that immutable image, exact durable warm
     * identity and RuntimeHealth all stay valid. The original repository/tag
     * is provenance only and never compared with current configuration.
     * Publishing a newer image must never turn this scheduled scan into an
     * implicit rollout; the manual warm recreate flow owns image upgrades.
     */
    const probeEntries = readyEntries.filter((entry) => {
      const container = this.findExactEntryStandbyContainer(entry, exactBefore);
      return (
        this.isHealthyExactStandby(entry, container) &&
        this.hasPinnedImageIdentity(container)
      );
    });
    await mapSettledBounded(
      probeEntries,
      WARM_STANDBY_PROBE_CONCURRENCY,
      async (entry) => {
        leaseContext.assertActive();
        try {
          const health = await this.workerGrpcClientService.runtimeHealth(
            server.server_id,
            {
              warm_pool_id: entry.warm_pool_id,
              worker_type_id: entry.worker_type_id,
              server_id: entry.server_id,
            },
            WARM_STANDBY_RUNTIME_HEALTH_TIMEOUT_MS
          );
          leaseContext.assertActive();
          const rejection = this.resolveWarmStandbyHealthRejection(
            health,
            entry
          );
          grpcOutcomes.set(
            entry.warm_pool_id,
            rejection
              ? { kind: 'rejected', reason: rejection }
              : { kind: 'accepted' }
          );
        } catch {
          leaseContext.assertActive();
          /*
           * The probe crosses the Balance process. During a version rollout
           * that process is intentionally restarted while the pinned warm
           * container keeps running. A transport failure therefore proves
           * nothing about the standby and must never become deletion
           * authority. An explicit RuntimeHealth response is useful telemetry,
           * but scheduled health observation never owns deletion of a ready
           * standby.
           */
          grpcOutcomes.set(entry.warm_pool_id, { kind: 'unavailable' });
        }
      }
    );
    leaseContext.assertActive();

    let exactAfter: IObservedWarmContainer[];
    try {
      exactAfter = await this.inspectExactWarmContainers(server, containerIds);
      leaseContext.assertActive();
    } catch (error) {
      leaseContext.assertActive();
      console.warn(
        'Failed to establish confirmation warm standby health snapshot',
        {
          server_id: server.server_id,
          candidate_count: readyEntries.length,
          error,
        }
      );
      return { reconciled: 0, handledWarmPoolIds };
    }

    for (const entry of readyEntries) {
      leaseContext.assertActive();
      const containerBefore = this.findExactEntryStandbyContainer(
        entry,
        exactBefore
      );
      const containerAfter = this.findExactEntryStandbyContainer(
        entry,
        exactAfter
      );
      const stableContainerImage =
        Boolean(containerBefore) &&
        Boolean(containerAfter) &&
        this.hasPinnedImageIdentity(
          containerBefore as IObservedWarmContainer
        ) &&
        this.hasPinnedImageIdentity(containerAfter as IObservedWarmContainer) &&
        containerBefore?.imageId === containerAfter?.imageId &&
        containerBefore?.imageName === containerAfter?.imageName;

      const grpcOutcome = grpcOutcomes.get(entry.warm_pool_id);
      if (grpcOutcome?.kind === 'unavailable') {
        continue;
      }
      const grpcRejection =
        grpcOutcome?.kind === 'rejected' ? grpcOutcome.reason : null;
      if (
        stableContainerImage &&
        this.isHealthyExactStandby(entry, containerBefore) &&
        this.isHealthyExactStandby(entry, containerAfter) &&
        grpcOutcome?.kind === 'accepted' &&
        entry.container_id
      ) {
        await this.workerWarmPoolRepository.confirmHealthyReadyRuntime({
          warmPoolId: entry.warm_pool_id,
          expectedContainerId: entry.container_id,
        });
        leaseContext.assertActive();
        continue;
      }

      console.warn('Preserved ready warm channel after health rejection', {
        warm_pool_id: entry.warm_pool_id,
        server_id: entry.server_id,
        worker_type_id: entry.worker_type_id,
        reason:
          grpcRejection ??
          (!stableContainerImage
            ? 'container_image_or_identity_changed_during_probe'
            : 'runtime_not_healthy'),
      });
    }

    return { reconciled: 0, handledWarmPoolIds };
  }

  private async reconcileServerWarmPool(
    server: IBalanceMonitorServer,
    warmingStaleAfterMs: number,
    probeDueBeforeMs: number,
    canProbeRuntimeHealth: boolean,
    leaseContext: ILockLeaseContext
  ): Promise<IWarmServerReconcileResult> {
    leaseContext.assertActive();
    const [rawSnapshot, activeEntries] = await Promise.all([
      this.listObservedWarmDockerSnapshot(server),
      this.workerWarmPoolRepository.listActiveByServer(server.server_id),
    ]);
    leaseContext.assertActive();

    if (!rawSnapshot) {
      this.clearWarmVolumeObservationsForServer(server.server_id);
      this.clearAmbiguousPhysicalObservationsForServer(server.server_id);
      throw new Error('warm_physical_snapshot_unavailable');
    }
    const snapshot = await this.hydrateObservedWarmContainerIdentities(
      server,
      rawSnapshot,
      leaseContext
    );
    leaseContext.assertActive();
    const observedContainers = snapshot.containers;

    const nowMs = Date.now();
    const unpersistedWarmingReconciliation =
      await this.reconcileStaleUnpersistedWarmingRuntimes(
        server,
        activeEntries,
        observedContainers,
        nowMs,
        warmingStaleAfterMs,
        leaseContext
      );
    leaseContext.assertActive();
    const readyHealthReconciliation = canProbeRuntimeHealth
      ? await this.reconcileReadyHealthLeases(
          server,
          activeEntries,
          observedContainers,
          probeDueBeforeMs,
          leaseContext
        )
      : { reconciled: 0, handledWarmPoolIds: new Set<string>() };
    leaseContext.assertActive();
    let reconciled =
      unpersistedWarmingReconciliation.reconciled +
      readyHealthReconciliation.reconciled;
    /*
     * hydrateObservedWarmContainerIdentities is already the second Docker
     * observation for every visible immutable ID. Reuse that full inspection
     * for unhealthy/paused/stopped decisions instead of issuing a third,
     * redundant round trip.
     */
    let confirmedFaultyContainers: IObservedWarmContainer[] =
      observedContainers.filter(
        (container) =>
          this.isWarmShapedContainer(container) &&
          Boolean(container.serverId) &&
          this.hasValidObservedSessionStorage(container) &&
          (container.healthStatus === 'unhealthy' ||
            container.healthStatus === 'starting' ||
            container.paused ||
            !container.running)
      );
    let confirmedMissingContainers: IObservedWarmContainer[] = [];
    let missingReinspectionFailed = false;
    const faultyContainerIds = observedContainers
      .filter(
        (
          container
        ): container is IObservedWarmContainer & { containerId: string } =>
          this.isWarmShapedContainer(container) &&
          (container.healthStatus === 'unhealthy' ||
            container.healthStatus === 'starting' ||
            container.paused ||
            !container.running) &&
          Boolean(container.containerId) &&
          CONTAINER_ID_PATTERN.test(container.containerId ?? '')
      )
      .map((container) => container.containerId);
    const faultyContainerIdSet = new Set(faultyContainerIds);
    const missingCandidateIds = activeEntries
      .filter(
        (entry) =>
          entry.state === EWorkerWarmPoolState.warming &&
          Boolean(entry.container_id) &&
          CONTAINER_ID_PATTERN.test(entry.container_id ?? '') &&
          !faultyContainerIdSet.has(entry.container_id?.toLowerCase() ?? '') &&
          !this.isEntryVisibleInDocker(entry, observedContainers) &&
          this.shouldReconcileMissingEntry(entry, nowMs, warmingStaleAfterMs)
      )
      .map((entry) => entry.container_id?.toLowerCase() ?? '')
      .filter((containerId) => CONTAINER_ID_PATTERN.test(containerId));
    if (missingCandidateIds.length) {
      try {
        confirmedMissingContainers = await this.inspectExactWarmContainers(
          server,
          missingCandidateIds
        );
        leaseContext.assertActive();
        /*
         * A partial/empty `docker ps` can hide a faulty runtime too. Feed exact
         * second-observation results into the normal unhealthy/paused/starting
         * path instead of treating every omitted row as absent.
         */
        confirmedFaultyContainers = [
          ...confirmedFaultyContainers,
          ...confirmedMissingContainers,
        ];
      } catch (error) {
        leaseContext.assertActive();
        missingReinspectionFailed = true;
        console.warn('Failed to confirm missing warm containers', {
          server_id: server.server_id,
          candidate_count: missingCandidateIds.length,
          error,
        });
      }
    }
    const missingCandidateIdSet = new Set(missingCandidateIds);
    const exactObservationUniverse = [
      ...observedContainers,
      ...confirmedFaultyContainers,
      ...confirmedMissingContainers,
    ];

    for (const entry of activeEntries) {
      leaseContext.assertActive();
      if (
        unpersistedWarmingReconciliation.handledWarmPoolIds.has(
          entry.warm_pool_id
        ) ||
        readyHealthReconciliation.handledWarmPoolIds.has(entry.warm_pool_id)
      ) {
        continue;
      }
      /*
       * Scheduled physical reconciliation owns only incomplete `warming`
       * attempts. Once a row reaches `ready`, no Docker/health observation is
       * allowed to turn it into `deleting`; that destructive transition is
       * exclusive to the explicit "Recriar Todos" command. Reserved and
       * activating rows remain owned by the activation lifecycle.
       */
      if (entry.state !== EWorkerWarmPoolState.warming) {
        continue;
      }

      if (
        this.hasEntryContainerIdObservation(entry, exactObservationUniverse) &&
        !this.findExactEntryStandbyContainer(entry, exactObservationUniverse)
      ) {
        /*
         * Presence of the same immutable Docker ID with foreign labels/name is
         * an identity conflict, never proof of absence. Fail closed so this
         * reconciler cannot delete a container that another lifecycle adopted.
         */
        console.warn(
          'Skipped warm cleanup after exact container identity conflict',
          {
            warm_pool_id: entry.warm_pool_id,
            server_id: entry.server_id,
            worker_type_id: entry.worker_type_id,
            container_id: entry.container_id,
          }
        );
        continue;
      }

      const persistentlyUnhealthy = this.isEntryPersistentlyUnhealthyInDocker(
        entry,
        confirmedFaultyContainers
      );
      const persistentlyPaused = this.isEntryPersistentlyPausedInDocker(
        entry,
        confirmedFaultyContainers
      );
      const persistentlyStarting = this.isEntryPersistentlyStartingInDocker(
        entry,
        confirmedFaultyContainers
      );
      const persistentlyStopped = this.isEntryPersistentlyStoppedInDocker(
        entry,
        confirmedFaultyContainers
      );
      const exactConfirmedContainer = this.findExactEntryStandbyContainer(
        entry,
        confirmedFaultyContainers
      );
      if (
        this.hasEntryUnhealthyObservation(entry, observedContainers) &&
        !persistentlyUnhealthy
      ) {
        console.warn(
          'Skipped unhealthy warm cleanup after runtime identity mismatch',
          {
            warm_pool_id: entry.warm_pool_id,
            server_id: entry.server_id,
            worker_type_id: entry.worker_type_id,
            container_id: entry.container_id,
          }
        );
        continue;
      }
      if (
        this.hasEntryPausedObservation(entry, observedContainers) &&
        !persistentlyPaused
      ) {
        console.warn(
          'Skipped paused warm cleanup after runtime identity mismatch',
          {
            warm_pool_id: entry.warm_pool_id,
            server_id: entry.server_id,
            worker_type_id: entry.worker_type_id,
            container_id: entry.container_id,
          }
        );
        continue;
      }
      if (
        this.hasEntryStartingObservation(entry, observedContainers) &&
        !persistentlyStarting
      ) {
        /*
         * A healthy exact reinspection means the runtime recovered between
         * docker ps and docker inspect. Clear only our durable starting marker.
         */
        if (
          !exactConfirmedContainer?.running ||
          exactConfirmedContainer.paused ||
          exactConfirmedContainer.healthStatus !== 'healthy'
        ) {
          console.warn(
            'Skipped starting warm observation after runtime identity mismatch',
            {
              warm_pool_id: entry.warm_pool_id,
              server_id: entry.server_id,
              worker_type_id: entry.worker_type_id,
              container_id: entry.container_id,
            }
          );
        }
        continue;
      }
      if (
        this.hasEntryStoppedObservation(entry, observedContainers) &&
        !persistentlyStopped
      ) {
        console.warn(
          'Skipped stopped warm cleanup after runtime identity mismatch',
          {
            warm_pool_id: entry.warm_pool_id,
            server_id: entry.server_id,
            worker_type_id: entry.worker_type_id,
            container_id: entry.container_id,
          }
        );
        continue;
      }

      let exactFailure:
        | 'warm_runtime_unhealthy_in_docker'
        | 'warm_runtime_paused_in_docker'
        | 'warm_runtime_stopped_in_docker'
        | null = null;
      if (persistentlyUnhealthy) {
        exactFailure = 'warm_runtime_unhealthy_in_docker';
      } else if (persistentlyPaused) {
        exactFailure = 'warm_runtime_paused_in_docker';
      } else if (persistentlyStopped) {
        exactFailure = 'warm_runtime_stopped_in_docker';
      }

      if (exactFailure && entry.container_id) {
        const marked =
          await this.workerWarmPoolRepository.claimMissingRuntimeForCleanup({
            warmPoolId: entry.warm_pool_id,
            expectedContainerId: entry.container_id,
            lastError: exactFailure,
          });
        leaseContext.assertActive();
        if (marked) {
          reconciled += await this.publishClaimedCleanupEntries(
            [
              {
                ...entry,
                state: EWorkerWarmPoolState.deleting,
                last_error: exactFailure,
              },
            ],
            persistentlyPaused
              ? 'paused runtime'
              : persistentlyStopped
                ? 'stopped runtime'
                : 'unhealthy runtime',
            leaseContext
          );
        }
        continue;
      }

      if (persistentlyStarting && entry.container_id) {
        const marker =
          await this.workerWarmPoolRepository.observeStartingRuntime({
            warmPoolId: entry.warm_pool_id,
            expectedContainerId: entry.container_id,
            firstObservedAtMs: this.getFirstStartingObservationMs(
              persistentlyStarting,
              nowMs
            ),
            restartCount: persistentlyStarting.restartCount ?? 0,
          });
        leaseContext.assertActive();
        const observation = this.parseStartingMarker(marker);
        if (
          !observation ||
          nowMs - observation.firstObservedAtMs <
            this.getStartingBudgetMs(warmingStaleAfterMs)
        ) {
          continue;
        }

        const marked =
          await this.workerWarmPoolRepository.claimMissingRuntimeForCleanup({
            warmPoolId: entry.warm_pool_id,
            expectedContainerId: entry.container_id,
            lastError: 'warm_runtime_starting_timeout_in_docker',
          });
        leaseContext.assertActive();
        if (marked) {
          reconciled += await this.publishClaimedCleanupEntries(
            [
              {
                ...entry,
                state: EWorkerWarmPoolState.deleting,
                last_error: 'warm_runtime_starting_timeout_in_docker',
              },
            ],
            'starting timeout runtime',
            leaseContext
          );
        }
        continue;
      }

      if (this.isEntryVisibleInDocker(entry, confirmedMissingContainers)) {
        continue;
      }

      if (this.isEntryVisibleInDocker(entry, observedContainers)) {
        continue;
      }

      if (
        !this.shouldReconcileMissingEntry(entry, nowMs, warmingStaleAfterMs)
      ) {
        continue;
      }
      if (
        missingReinspectionFailed &&
        entry.container_id &&
        missingCandidateIdSet.has(entry.container_id.toLowerCase())
      ) {
        continue;
      }

      const marked =
        await this.workerWarmPoolRepository.claimMissingRuntimeForCleanup({
          warmPoolId: entry.warm_pool_id,
        });
      leaseContext.assertActive();

      if (!marked) {
        continue;
      }

      reconciled += await this.publishClaimedCleanupEntries(
        [
          {
            ...entry,
            state: EWorkerWarmPoolState.deleting,
            last_error: 'warm_runtime_missing_in_docker',
          },
        ],
        'missing runtime',
        leaseContext
      );
    }

    const activeIds = new Set(activeEntries.map((entry) => entry.warm_pool_id));
    for (const container of observedContainers) {
      leaseContext.assertActive();
      if (
        !this.isStrictStandbyContainer(container, server.server_id) ||
        activeIds.has(container.warmPoolId)
      ) {
        continue;
      }

      const sessionStorage = container.sessionStorage;
      const sessionVolumeName =
        sessionStorage === EWorkerSessionStorage.legacy_volume
          ? `warm-${container.warmPoolId}`
          : null;
      let claimedContainer: IObservedWarmContainer | null;
      try {
        claimedContainer = await this.workerLifecycleLockService.withLock(
          `warm-pool:${container.warmPoolId}`,
          'reconcile_docker_warm_orphan',
          async (warmLeaseContext): Promise<IObservedWarmContainer | null> => {
            const combinedLease = {
              signal: AbortSignal.any([
                leaseContext.signal,
                warmLeaseContext.signal,
              ]),
              assertActive: (): void => {
                leaseContext.assertActive();
                warmLeaseContext.assertActive();
              },
            };
            combinedLease.assertActive();

            /*
             * The seven-field `docker ps` inventory is only discovery. Claim
             * deletion from a second full inspect of the immutable ID while
             * holding the lifecycle lock, and require every standby ownership
             * fence before touching durable state.
             */
            const exact = await this.inspectExactWarmContainers(server, [
              container.containerId,
            ]);
            combinedLease.assertActive();
            const exactContainer =
              exact.find(
                (item) => item.containerId === container.containerId
              ) ?? null;
            if (
              !exactContainer ||
              !this.isStrictStandbyContainer(
                exactContainer,
                server.server_id
              ) ||
              exactContainer.warmPoolId !== container.warmPoolId ||
              exactContainer.workerTypeId !== container.workerTypeId ||
              exactContainer.name !== container.name
            ) {
              return null;
            }

            const [durableRow, adopted] = await Promise.all([
              this.workerWarmPoolRepository.viewByIdConsistent(
                container.warmPoolId
              ),
              this.workerWarmPoolRepository.isRuntimeReferenceActive({
                warmPoolId: container.warmPoolId,
                containerName: exactContainer.name,
                sessionVolumeName,
              }),
            ]);
            combinedLease.assertActive();
            if (durableRow || adopted) {
              return null;
            }

            const claimed =
              await this.workerWarmPoolRepository.claimDockerOrphanForCleanup({
                warmPoolId: container.warmPoolId,
                serverId: server.server_id,
                workerTypeId: container.workerTypeId,
                containerId: container.containerId,
                containerName: container.name,
                sessionStorage,
                sessionVolumeName,
              });
            combinedLease.assertActive();
            return claimed ? exactContainer : null;
          },
          {
            acquireTimeoutMs: WARM_ACTIVATING_LOCK_ACQUIRE_TIMEOUT_MS,
            retryDelayMs: WARM_ACTIVATING_LOCK_RETRY_DELAY_MS,
            ttlMs: WARM_ACTIVATING_LOCK_TTL_MS,
            heartbeatIntervalMs: WARM_ACTIVATING_LOCK_HEARTBEAT_MS,
          }
        );
      } catch (error) {
        leaseContext.assertActive();
        console.warn('Skipped Docker warm orphan after fenced reinspection', {
          server_id: server.server_id,
          warm_pool_id: container.warmPoolId,
          container_id: container.containerId,
          error,
        });
        claimedContainer = null;
      }
      leaseContext.assertActive();
      if (!claimedContainer) {
        /*
         * A row already exists (terminal, assigned or currently being
         * cleaned). Its state-specific claim owns deletion and prevents this
         * Docker observation from racing an activation.
         */
        continue;
      }

      reconciled += await this.publishClaimedCleanupEntries(
        [
          {
            warm_pool_id: container.warmPoolId,
            server_id: server.server_id,
            worker_type_id: container.workerTypeId,
            container_id: container.containerId,
            container_name: claimedContainer.name,
            session_storage: sessionStorage,
            session_volume_name: sessionVolumeName,
          },
        ],
        'Docker orphan',
        leaseContext
      );
    }

    reconciled += await this.reconcileOrphanWarmVolumes(
      server,
      activeEntries,
      snapshot,
      warmingStaleAfterMs,
      leaseContext
    );
    leaseContext.assertActive();

    return { reconciled, snapshot };
  }
}
