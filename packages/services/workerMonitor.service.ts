import { injectable, inject } from 'tsyringe';
import {
  type ActiveWorkerImageDrift,
  type ActiveWwebjsRuntimeSafetyDrift,
  WorkerService,
} from './worker.service';
import { ServerService } from './server.service';
import { SshService } from './ssh.service';
import { PasswordEncryptorService } from './passwordEncryptor.service';
import { IBalanceMonitorServer } from '@core/common/interfaces/IBalanceMonitorServer';
import { ConnectConfig } from 'ssh2';
import { IWorkerMonitor } from '@core/common/interfaces/IWorkerMonitor';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { supportsWhatsappSessionStorage } from '@core/common/functions/workerSessionStorage';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { CentrifugoService } from './centrifugo.service';
import { WorkerLifecycleQueueService } from './workerLifecycleQueue.service';
import {
  channelsConfigCentrifugo,
  workerCentrifugoQueue,
} from '@core/common/functions/centrifugoQueue';
import { IWorkerPayload } from '@core/common/interfaces/IWorkerPayload';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';
import { EWhatsappConnectionStatus } from '@core/common/enums/EWhatsappConnectionStatus';
import { AccountService } from './account.service';
import { IPlanAccountStatus } from '@core/common/interfaces/IPlanAccountStatus';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';
import { IConnectionFailureTracker } from '@core/common/interfaces/IConnectionFailureTracker';
import { logLocalConnectionStatus } from '@core/common/functions/localConnectionStatusLog';
import {
  isWhatsappConnectionOnline,
  normalizeWhatsappConnectionStatus,
  normalizeWhatsappConnectionStatusSourceId,
} from '@core/common/functions/whatsappConnectionStatus';
import { buildManagerWorkerRecreateTerminalStatusEvent } from '@core/common/functions/workerLifecycleRealtimeStatus';
import type {
  IWhatsappConnectionStatus,
  WhatsappConnectionStatusProvider,
} from '@core/common/interfaces/IWhatsappConnectionStatus';
import { WorkerCommandHandlerService } from './workerCommandHandler.service';
import { IWorkerLifecycleQueueMessage } from '@core/common/interfaces/IWorkerLifecycleQueueMessage';
import { currentTime } from '@core/common/functions/currentTime';
import { v7 as uuidv7 } from 'uuid';
import {
  ILockLeaseContext,
  UNFENCED_LOCK_LEASE_CONTEXT,
} from '@core/common/functions/withLock';
import { WorkerLifecycleLockService } from './workerLifecycleLock.service';
import Redis from 'ioredis';
import {
  getWorkerContainerLivenessJitterMs,
  WORKER_CONTAINER_LIVENESS_DISCOVERY_BATCH_SIZE,
  WORKER_CONTAINER_STARTING_FAILURE_MIN_AGE_MS,
  WORKER_CONTAINER_LIVENESS_REMOTE_COMMAND_TIMEOUT_MS,
  WORKER_CONTAINER_LIVENESS_REMOTE_PROCESS_TIMEOUT_MS,
  WORKER_CONTAINER_LIVENESS_SSH_READY_TIMEOUT_MS,
  WORKER_LIVENESS_LIFECYCLE_REDRIVE_AFTER_MS,
  WORKER_LIVENESS_LIFECYCLE_REDRIVE_CLAIM_MS,
  WORKER_LIVENESS_COOLDOWN_STALE_GRACE_MS,
  WORKER_MISSING_RUNTIME_CONFIRMATION_MIN_AGE_MS,
  WORKER_MISSING_RUNTIME_OBSERVATION_TTL_MS,
  WORKER_MISSING_RUNTIME_RECOVERY_MAX_PER_CYCLE,
  WORKER_MISSING_RUNTIME_RECOVERY_MAX_PER_SERVER,
  WORKER_MISSING_RUNTIME_SCAN_BATCH_SIZE,
} from '@core/common/functions/workerContainerLivenessPolicy';
import { planCompletedWhatsappProviderHandoffLifecycle } from '@core/common/functions/whatsappProviderHandoffLifecycleCompletion';

const MINUTE_MS = 60_000;
const WORKER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTAINER_ID_PATTERN = /^[0-9a-f]{64}$/i;

function positiveTimeout(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/*
 * General lifecycle recovery must remain fast enough to keep all 22 physical
 * recreate slots flowing. The operation-scoped Redis claim and worker lock
 * already prevent concurrent delivery, so a one-minute fixed cadence is a
 * safe upper bound after a terminal consumer retry. Keep these operational
 * values explicit instead of adding environment configuration.
 */
const WORKER_LIFECYCLE_REDRIVE_AFTER_MS = MINUTE_MS;
const WORKER_LIFECYCLE_REDRIVE_COOLDOWN_MS = MINUTE_MS;
const WORKER_LIFECYCLE_MAX_ACTIVE_MS = 30 * MINUTE_MS;
const CONNECTION_DISCONNECT_TERMINAL_MARKER_TTL_SECONDS = 7 * 24 * 60 * 60;
const WORKER_LIVENESS_RECREATE_COOLDOWN_SECONDS = Math.max(
  60,
  Math.min(
    3600,
    positiveTimeout(
      process.env.WORKER_LIVENESS_RECREATE_COOLDOWN_SECONDS,
      10 * 60
    )
  )
);
const WORKER_LIVENESS_REDRIVE_BATCH_SIZE = 100;
const WORKER_LIVENESS_REDRIVE_CONCURRENCY = 8;
const WORKER_LIVENESS_REDRIVE_MAX_SCAN_PER_CYCLE = 1_000;
const WORKER_LIFECYCLE_ACTION_SOURCES: Record<
  Exclude<IWorkerLifecycleQueueMessage['action'], 'cleanup_previous_runtime'>,
  ReadonlySet<IWorkerLifecycleQueueMessage['source']>
> = {
  create: new Set(['worker_create']),
  recreate: new Set([
    'worker_recreate',
    'worker_update',
    'config_recreate',
    'reset_connection',
    'self_heal',
  ]),
  activate_warm: new Set(['worker_create', 'worker_update']),
  delete: new Set(['plan_cancellation', 'channel_delete', 'worker_delete']),
};

const mapConcurrent = async <T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let index = 0;

  const worker = async (): Promise<void> => {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  };

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
};

interface IRunningWorkerContainer {
  name: string;
  isWarmStandby: boolean;
  warmPoolId?: string;
}

interface IPersistentlyUnhealthyContainer {
  containerId: string;
  name: string;
  running: boolean;
  healthStatus: 'unhealthy' | 'healthy' | 'starting' | 'none';
  isWarmStandby: boolean;
  warmPoolId?: string;
  workerId?: string;
  accountId?: string;
  serverId?: string;
  workerTypeId?: string;
  lifecycleOperationId?: string;
  runtimeGeneration?: number;
  startedAt?: string;
  createdAt?: string;
  restartCount?: number;
  paused: boolean;
}

interface IExactRuntimeContainerOwnership {
  containerId: string;
  name: string;
  running: boolean;
  labels: Record<string, string>;
  env: Record<string, string>;
  mounts: Array<{
    destination?: string;
    name?: string;
    readWrite?: boolean;
    type?: string;
  }>;
}

interface IValidatedLivenessCandidate {
  worker: IWorkerMonitor;
  container: IPersistentlyUnhealthyContainer;
}

interface IContainerIdentitySnapshot {
  containerIds: ReadonlySet<string>;
  containerNames: ReadonlySet<string>;
}

interface IConnectionHealthCheckResult {
  healthy: boolean;
  code: number | null;
  body: unknown;
  worker_id?: string;
  account_id?: string;
  worker_type_id?: string;
  runtime_state?: string;
  activated?: boolean;
  standby?: boolean;
  session_ready?: boolean;
  connected?: boolean;
  can_send?: boolean;
  can_receive_runtime?: boolean;
  authenticated?: boolean;
  provider_state?: string;
  degraded_reason?: string;
  last_probe_at?: string;
  probe_latency_ms?: number;
  phone?: string;
  central_online_acknowledged?: boolean;
  runtime_generation?: number;
  kafka_consumers_ready?: boolean;
  kafka_consumers_authorized?: boolean;
  runtime_health_schema_version?: number;
  has_session?: boolean;
  qr_stream_ready?: boolean;
  error?: string;
  session_storage?: EWorkerSessionStorage;
  native_connection_online?: boolean;
  connection_status?: IWhatsappConnectionStatus;
  connection_status_source_id?: string;
  connection_status_source_current?: boolean;
  connection_status_lease_required?: boolean;
  connection_status_lease_proof_valid?: boolean;
  connection_status_present: boolean;
  connection_status_source_present: boolean;
  kafka_unhealthy: boolean;
}

type TerminalReplacementReadiness =
  EWorkerStatus.online | EWorkerStatus.disponible | 'not_ready' | 'unavailable';

type WorkerRecreateTrigger =
  | 'orphan_lifecycle'
  | 'stuck_lifecycle'
  | 'worker_error'
  | 'fastify_unhealthy'
  | 'missing_container'
  | 'container_unhealthy';

@injectable()
export class WorkerMonitorService {
  private readonly timeoutMinutes = 5;
  private readonly maxConnectionFailures = 3;
  private readonly sshConcurrencyPerServer = 5;
  private readonly serverConcurrency = 2;
  private readonly livenessServerConcurrency = 12;
  private readonly livenessDiscoveryCursors = new Map<string, string>();
  private readonly connectionCheckIntervalMs = 60 * 1000;
  private readonly stoppedTimeoutMinutes = 24 * 60;
  private livenessRedriveCursor: string | undefined;
  private missingRuntimeRecoveryCursor: string | undefined;
  private readonly connectionFailureTrackers = new Map<
    string,
    IConnectionFailureTracker
  >();

  constructor(
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(ServerService)
    private readonly serverService: ServerService,
    @inject(SshService)
    private readonly sshService: SshService,
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService,
    @inject(WorkerLifecycleQueueService)
    private readonly workerLifecycleQueueService: WorkerLifecycleQueueService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject(AccountService)
    private readonly accountService: AccountService,
    @inject(WorkerCommandHandlerService)
    private readonly workerCommandHandlerService: WorkerCommandHandlerService,
    @inject('Redis')
    private readonly redis: Redis,
    @inject(WorkerLifecycleLockService)
    private readonly workerLifecycleLockService: WorkerLifecycleLockService = {
      isLocked: async () => false,
      tryClaimRedrive: async () => true,
      releaseRedriveClaim: async () => undefined,
    } as unknown as WorkerLifecycleLockService
  ) {}

  private readonly executeFenced = async <T>(
    context: ILockLeaseContext,
    operation: () => Promise<T>
  ): Promise<T> => {
    context.assertActive();
    const result = await operation();
    context.assertActive();
    return result;
  };

  public enqueueImageDriftRecreate = async (
    drift: ActiveWorkerImageDrift
  ): Promise<boolean> => {
    // Kept as a fail-closed compatibility boundary for older callers. Image
    // drift is observation-only; only the explicit manual flow may recreate.
    void drift;
    return false;
  };

  public enqueueWwebjsRuntimeSafetyRecreate = async (
    drift: ActiveWwebjsRuntimeSafetyDrift
  ): Promise<boolean> => {
    // Runtime-safety drift remains visible in health, but image publication
    // never authorizes lifecycle mutation without a manual recreate request.
    void drift;
    return false;
  };

  run = async (
    context: ILockLeaseContext = UNFENCED_LOCK_LEASE_CONTEXT
  ): Promise<void> => {
    await this.redrivePendingPermanentDeletionFinalizers(context);
    const servers = await this.executeFenced(context, () =>
      this.serverService.listBalanceServers()
    );
    const workers = await this.executeFenced(context, () =>
      this.workerService.listWorkersForMonitor()
    );

    if (!servers.length) {
      return;
    }

    const workersById = new Map<string, IWorkerMonitor>(
      workers.map((worker) => [worker.worker_id, worker])
    );

    const workersByServer = new Map<string, IWorkerMonitor[]>();
    for (const worker of workers) {
      const list = workersByServer.get(worker.server_id) ?? [];
      list.push(worker);
      workersByServer.set(worker.server_id, list);
    }

    await mapConcurrent(servers, this.serverConcurrency, async (server) => {
      try {
        await this.checkServer(server, workersById, workersByServer, context);
      } catch (error) {
        // A revoked distributed lease must still abort the whole pass. Ordinary
        // SSH/provider failures are isolated to this server so every other
        // server continues to be reconciled in the same monitor cycle.
        context.assertActive();
        logLocalConnectionStatus('service.monitor.server_check_failed', {
          layer: 'service.monitor',
          server_id: server.server_id,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    });
    context.assertActive();
  };

  /**
   * Fast, liveness-only reconciliation for containers whose local HTTP event
   * loop has failed Docker's hysteresis. This pass is intentionally separate
   * from the comprehensive ten-minute monitor: it performs one aggregate
   * Docker observation per server and never probes WhatsApp/Kafka readiness.
   */
  runLiveness = async (
    context: ILockLeaseContext = UNFENCED_LOCK_LEASE_CONTEXT
  ): Promise<void> => {
    const jitterMs = getWorkerContainerLivenessJitterMs();
    if (jitterMs > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, jitterMs);
      });
      context.assertActive();
    }

    await this.redriveStalledLivenessLifecycles(context);

    const servers = await this.executeFenced(context, () =>
      this.serverService.listBalanceServers()
    );

    if (!servers.length) {
      return;
    }

    await this.recoverMissingRuntimeCandidates(servers, context);

    await mapConcurrent(
      servers,
      this.livenessServerConcurrency,
      async (server) => {
        let observed: IPersistentlyUnhealthyContainer[];
        try {
          observed = await this.listPersistentlyUnhealthyContainers(
            server,
            context
          );
        } catch (error) {
          context.assertActive();
          logLocalConnectionStatus('service.monitor.liveness_scan_failed', {
            layer: 'service.monitor',
            server_id: server.server_id,
            reason: error instanceof Error ? error.message : String(error),
          });
          return;
        }

        const candidates = observed.filter(
          (container) =>
            this.isPersistentLivenessFailure(container) &&
            !container.isWarmStandby &&
            WORKER_ID_PATTERN.test(container.name) &&
            CONTAINER_ID_PATTERN.test(container.containerId) &&
            Boolean(container.startedAt) &&
            Number.isSafeInteger(container.restartCount)
        );

        const validated = (
          await mapConcurrent(
            candidates,
            this.sshConcurrencyPerServer,
            async (container): Promise<IValidatedLivenessCandidate | null> => {
              try {
                return await this.validatePersistentlyUnhealthyContainer(
                  container,
                  server,
                  context
                );
              } catch (error) {
                context.assertActive();
                logLocalConnectionStatus(
                  'service.monitor.liveness_candidate_failed',
                  {
                    layer: 'service.monitor',
                    worker_id: container.workerId ?? container.name,
                    account_id: container.accountId,
                    worker_type_id: container.workerTypeId,
                    server_id: server.server_id,
                    container_id: container.containerId,
                    reason:
                      error instanceof Error ? error.message : String(error),
                  }
                );
                return null;
              }
            }
          )
        ).filter(
          (candidate): candidate is IValidatedLivenessCandidate =>
            candidate !== null
        );

        if (!validated.length) {
          return;
        }

        const confirmedById = await this.confirmLivenessCandidates(
          server,
          validated,
          context
        );
        await mapConcurrent(
          validated,
          this.sshConcurrencyPerServer,
          async (candidate) => {
            const currentObservation = confirmedById.get(
              candidate.container.containerId
            );
            if (
              !currentObservation ||
              !this.isSameUnhealthyContainerObservation(
                candidate.container,
                currentObservation
              )
            ) {
              logLocalConnectionStatus(
                'service.monitor.liveness_recreate_skipped_recovered',
                {
                  layer: 'service.monitor',
                  worker_id: candidate.worker.worker_id,
                  account_id: candidate.worker.account_id,
                  server_id: server.server_id,
                  container_id: candidate.container.containerId,
                }
              );
              return;
            }

            try {
              await this.requestPersistentlyUnhealthyRecreate(
                candidate.worker,
                currentObservation,
                server,
                context
              );
            } catch (error) {
              context.assertActive();
              logLocalConnectionStatus(
                'service.monitor.liveness_candidate_failed',
                {
                  layer: 'service.monitor',
                  worker_id: candidate.worker.worker_id,
                  account_id: candidate.worker.account_id,
                  worker_type_id: candidate.worker.worker_type_id,
                  server_id: server.server_id,
                  container_id: candidate.container.containerId,
                  reason:
                    error instanceof Error ? error.message : String(error),
                }
              );
            }
          }
        );
      }
    );

    context.assertActive();
  };

  private readonly recoverMissingRuntimeCandidates = async (
    servers: IBalanceMonitorServer[],
    context: ILockLeaseContext
  ): Promise<void> => {
    let candidates: IWorkerMonitor[];
    try {
      candidates = await this.executeFenced(context, () =>
        this.workerService.listMissingRuntimeRecoveryCandidates(
          WORKER_MISSING_RUNTIME_SCAN_BATCH_SIZE,
          this.missingRuntimeRecoveryCursor
        )
      );
    } catch (error) {
      context.assertActive();
      logLocalConnectionStatus(
        'service.monitor.missing_runtime_candidate_scan_failed',
        {
          layer: 'service.monitor',
          cursor: this.missingRuntimeRecoveryCursor,
          reason: error instanceof Error ? error.message : String(error),
        }
      );
      return;
    }

    if (!candidates.length) {
      this.missingRuntimeRecoveryCursor = undefined;
      return;
    }

    this.missingRuntimeRecoveryCursor =
      candidates[candidates.length - 1]?.worker_id;
    if (candidates.length < WORKER_MISSING_RUNTIME_SCAN_BATCH_SIZE) {
      this.missingRuntimeRecoveryCursor = undefined;
    }

    const serverById = new Map(
      servers.map((server) => [server.server_id, server] as const)
    );
    const candidatesByServer = new Map<string, IWorkerMonitor[]>();
    for (const candidate of candidates) {
      const expectedContainerId = candidate.container_id?.trim().toLowerCase();
      const runtimeContainerId = candidate.runtime_container_id
        ?.trim()
        .toLowerCase();
      if (
        !serverById.has(candidate.server_id) ||
        !WORKER_ID_PATTERN.test(candidate.worker_id) ||
        !expectedContainerId ||
        !CONTAINER_ID_PATTERN.test(expectedContainerId) ||
        expectedContainerId !== runtimeContainerId ||
        candidate.worker_status_id !== EWorkerStatus.online ||
        candidate.lifecycle_operation_id !== null ||
        !Number.isSafeInteger(candidate.runtime_generation) ||
        Number(candidate.runtime_generation) <= 0
      ) {
        continue;
      }

      const serverCandidates =
        candidatesByServer.get(candidate.server_id) ?? [];
      serverCandidates.push(candidate);
      candidatesByServer.set(candidate.server_id, serverCandidates);
    }

    const confirmedByServer = await mapConcurrent(
      [...candidatesByServer.entries()],
      this.livenessServerConcurrency,
      async ([serverId, serverCandidates]) => {
        const server = serverById.get(serverId);
        if (!server) {
          return [] as IWorkerMonitor[];
        }

        try {
          return await this.confirmMissingRuntimeCandidates(
            server,
            serverCandidates,
            context
          );
        } catch (error) {
          context.assertActive();
          logLocalConnectionStatus(
            'service.monitor.missing_runtime_confirmation_failed',
            {
              layer: 'service.monitor',
              server_id: server.server_id,
              candidate_count: serverCandidates.length,
              reason: error instanceof Error ? error.message : String(error),
            }
          );
          return [] as IWorkerMonitor[];
        }
      }
    );
    const selected = confirmedByServer
      .flat()
      .sort((left, right) => left.worker_id.localeCompare(right.worker_id))
      .slice(0, WORKER_MISSING_RUNTIME_RECOVERY_MAX_PER_CYCLE);

    await mapConcurrent(
      selected,
      Math.min(
        WORKER_MISSING_RUNTIME_RECOVERY_MAX_PER_CYCLE,
        this.sshConcurrencyPerServer
      ),
      async (candidate) => {
        const server = serverById.get(candidate.server_id);
        if (!server) {
          return;
        }

        try {
          await this.handleMissingContainer(
            candidate,
            server,
            this.buildSshConfig(server),
            context
          );
        } catch (error) {
          context.assertActive();
          logLocalConnectionStatus(
            'service.monitor.missing_runtime_recovery_failed',
            {
              layer: 'service.monitor',
              worker_id: candidate.worker_id,
              account_id: candidate.account_id,
              worker_type_id: candidate.worker_type_id,
              server_id: candidate.server_id,
              container_id: candidate.container_id ?? undefined,
              reason: error instanceof Error ? error.message : String(error),
            }
          );
        }
      }
    );
    context.assertActive();
  };

  private readonly confirmMissingRuntimeCandidates = async (
    server: IBalanceMonitorServer,
    candidates: IWorkerMonitor[],
    context: ILockLeaseContext
  ): Promise<IWorkerMonitor[]> => {
    const firstSnapshot = await this.captureContainerIdentitySnapshot(
      server,
      context
    );
    const absent = candidates.filter((candidate) =>
      this.isRuntimeAbsentFromSnapshot(candidate, firstSnapshot)
    );
    if (!absent.length) {
      return [];
    }

    const previouslyObserved: IWorkerMonitor[] = [];
    for (const candidate of absent) {
      context.assertActive();
      if (await this.hasMatureMissingRuntimeObservation(candidate, context)) {
        previouslyObserved.push(candidate);
      }
      if (
        previouslyObserved.length >=
        WORKER_MISSING_RUNTIME_RECOVERY_MAX_PER_SERVER
      ) {
        break;
      }
    }
    if (!previouslyObserved.length) {
      return [];
    }

    /*
     * The Redis observation proves absence across monitor cycles. Re-read the
     * complete Docker identity immediately before handing candidates to the
     * durable lifecycle CAS so a container that appeared during this pass
     * cannot be mistaken for a missing runtime.
     */
    const finalSnapshot = await this.captureContainerIdentitySnapshot(
      server,
      context
    );
    return previouslyObserved.filter((candidate) =>
      this.isRuntimeAbsentFromSnapshot(candidate, finalSnapshot)
    );
  };

  private readonly captureContainerIdentitySnapshot = async (
    server: IBalanceMonitorServer,
    context: ILockLeaseContext
  ): Promise<IContainerIdentitySnapshot> => {
    const marker = '__UNDERCHAT_RUNTIME_IDENTITY_SNAPSHOT_OK__';
    const timeoutSeconds = Math.max(
      1,
      Math.ceil(WORKER_CONTAINER_LIVENESS_REMOTE_PROCESS_TIMEOUT_MS / 1000)
    );
    const command = String.raw`timeout --signal=KILL ${timeoutSeconds}s sh -c 'docker ps -a --no-trunc --format "{{.ID}}|{{.Names}}" && printf "%s\n" "${marker}"'`;
    const outputs = await this.runSshFenced(
      context,
      server.server_id,
      {
        ...this.buildSshConfig(server),
        readyTimeout: WORKER_CONTAINER_LIVENESS_SSH_READY_TIMEOUT_MS,
      },
      [command],
      {
        failOnNonZero: true,
        connectMaxAttempts: 1,
        commandTimeoutMs: WORKER_CONTAINER_LIVENESS_REMOTE_COMMAND_TIMEOUT_MS,
      }
    );
    const lines = outputs
      .map((item) => item.output)
      .join('')
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.at(-1) !== marker) {
      throw new Error('runtime_identity_snapshot_incomplete');
    }

    const containerIds = new Set<string>();
    const containerNames = new Set<string>();
    for (const line of lines.slice(0, -1)) {
      const separator = line.indexOf('|');
      const containerId = line.slice(0, separator).trim().toLowerCase();
      const containerName = line.slice(separator + 1).trim();
      if (
        separator <= 0 ||
        !CONTAINER_ID_PATTERN.test(containerId) ||
        !containerName
      ) {
        throw new Error('runtime_identity_snapshot_malformed');
      }
      containerIds.add(containerId);
      containerNames.add(containerName);
    }

    return { containerIds, containerNames };
  };

  private readonly isRuntimeAbsentFromSnapshot = (
    candidate: IWorkerMonitor,
    snapshot: IContainerIdentitySnapshot
  ): boolean => {
    const expectedContainerId = candidate.container_id?.trim().toLowerCase();
    return Boolean(
      expectedContainerId &&
      CONTAINER_ID_PATTERN.test(expectedContainerId) &&
      !snapshot.containerIds.has(expectedContainerId) &&
      !snapshot.containerNames.has(candidate.worker_id)
    );
  };

  private readonly hasMatureMissingRuntimeObservation = async (
    candidate: IWorkerMonitor,
    context: ILockLeaseContext
  ): Promise<boolean> => {
    const expectedContainerId = candidate.container_id?.trim().toLowerCase();
    if (!expectedContainerId) {
      return false;
    }

    const key =
      `underchat:worker:missing-runtime:v1:${candidate.worker_id}:` +
      expectedContainerId;
    const now = Date.now();
    const observedAt = await this.executeFenced(context, () =>
      this.redis.get(key)
    );
    if (observedAt) {
      const timestamp = Number(observedAt);
      return (
        Number.isFinite(timestamp) &&
        now - timestamp >= WORKER_MISSING_RUNTIME_CONFIRMATION_MIN_AGE_MS
      );
    }

    await this.executeFenced(context, () =>
      this.redis.set(
        key,
        String(now),
        'PX',
        WORKER_MISSING_RUNTIME_OBSERVATION_TTL_MS,
        'NX'
      )
    );
    return false;
  };

  private readonly confirmLivenessCandidates = async (
    server: IBalanceMonitorServer,
    candidates: IValidatedLivenessCandidate[],
    context: ILockLeaseContext
  ): Promise<Map<string, IPersistentlyUnhealthyContainer>> => {
    const confirmations = await mapConcurrent(
      candidates,
      this.sshConcurrencyPerServer,
      async (candidate) => {
        try {
          const [confirmed] = await this.inspectExactContainers(
            server,
            [candidate.container.containerId],
            context
          );
          return confirmed
            ? ([confirmed.containerId, confirmed] as const)
            : null;
        } catch (error) {
          context.assertActive();
          logLocalConnectionStatus(
            'service.monitor.liveness_reinspection_failed',
            {
              layer: 'service.monitor',
              worker_id: candidate.worker.worker_id,
              account_id: candidate.worker.account_id,
              server_id: server.server_id,
              container_id: candidate.container.containerId,
              reason: error instanceof Error ? error.message : String(error),
            }
          );
          return null;
        }
      }
    );

    return new Map(
      confirmations.filter(
        (
          confirmation
        ): confirmation is readonly [string, IPersistentlyUnhealthyContainer] =>
          confirmation !== null
      )
    );
  };

  private readonly checkServer = async (
    server: IBalanceMonitorServer,
    workersById: Map<string, IWorkerMonitor>,
    workersByServer: Map<string, IWorkerMonitor[]>,
    context: ILockLeaseContext = UNFENCED_LOCK_LEASE_CONTEXT
  ): Promise<void> => {
    const sshConfig = this.buildSshConfig(server);
    const containers = await this.listContainers(
      server.server_id,
      sshConfig,
      context
    );

    const workerIds = containers.filter((name) => WORKER_ID_PATTERN.test(name));
    const setContainers = new Set(workerIds);

    const serverWorkers = workersByServer.get(server.server_id) ?? [];
    if (containers.length === 0 && serverWorkers.length > 0) {
      logLocalConnectionStatus(
        'service.monitor.container_snapshot_empty_skipped',
        {
          layer: 'service.monitor',
          server_id: server.server_id,
          expected_worker_count: serverWorkers.length,
        }
      );
    }

    const missingWorkers = serverWorkers.filter(
      (worker) => !setContainers.has(worker.worker_id)
    );

    const allItems: Array<{
      workerId: string;
      run: () => Promise<void>;
    }> = [
      ...workerIds.map((workerId) => ({
        workerId,
        run: () =>
          this.processContainer(
            workerId,
            server,
            sshConfig,
            workersById,
            context
          ),
      })),
      ...missingWorkers.map((worker) => ({
        workerId: worker.worker_id,
        run: async () => {
          const confirmedMissing = await this.confirmContainerMissing(
            worker.worker_id,
            server.server_id,
            sshConfig,
            context
          );
          if (!confirmedMissing) {
            return;
          }

          await this.handleMissingContainer(worker, server, sshConfig, context);
        },
      })),
    ];
    if (!allItems.length) {
      return;
    }

    await mapConcurrent(
      allItems,
      this.sshConcurrencyPerServer,
      async (item) => {
        try {
          await item.run();
        } catch (error) {
          // Do not let one malformed/stale container or one worker-specific DB
          // failure cancel reconciliation for every other worker on the server.
          context.assertActive();
          logLocalConnectionStatus('service.monitor.worker_check_failed', {
            layer: 'service.monitor',
            worker_id: item.workerId,
            server_id: server.server_id,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
    );
    context.assertActive();
  };

  private readonly processContainer = async (
    workerId: string,
    server: IBalanceMonitorServer,
    sshConfig: ConnectConfig,
    workersById: Map<string, IWorkerMonitor>,
    context: ILockLeaseContext = UNFENCED_LOCK_LEASE_CONTEXT
  ): Promise<void> => {
    const worker = workersById.get(workerId);

    if (!worker) {
      const currentWorker = await this.executeFenced(context, () =>
        this.workerService.viewWorkerForMonitorConsistent(workerId)
      );
      if (currentWorker && !currentWorker.deleted_at) {
        workersById.set(workerId, currentWorker);
        await this.processContainer(
          workerId,
          server,
          sshConfig,
          workersById,
          context
        );
        return;
      }

      await this.removeContainer(
        context,
        workerId,
        server.server_id,
        sshConfig
      );
      return;
    }

    if (worker.deleted_at) {
      const currentWorker = await this.executeFenced(context, () =>
        this.workerService.viewWorkerForMonitorConsistent(workerId)
      );
      if (currentWorker && !currentWorker.deleted_at) {
        return;
      }

      await this.removeContainer(
        context,
        workerId,
        server.server_id,
        sshConfig
      );
      return;
    }

    if (worker.server_id !== server.server_id) {
      await this.reconcileContainerOnDifferentServer(
        worker,
        server,
        sshConfig,
        context
      );
      return;
    }

    if (await this.reconcileConnectionDisconnectBarrier(worker, context)) {
      return;
    }

    if (await this.repairStaleTerminalLifecycleFence(worker, server, context)) {
      return;
    }

    if (worker.worker_status_id === EWorkerStatus.delete) {
      logLocalConnectionStatus(
        'service.monitor.legacy_delete_status_manual_recovery_required',
        {
          layer: 'service.monitor',
          worker_id: worker.worker_id,
          account_id: worker.account_id,
          worker_type_id: worker.worker_type_id,
          worker_status_id: worker.worker_status_id,
          lifecycle_operation_id: worker.lifecycle_operation_id ?? undefined,
          container_exists: true,
        }
      );
      return;
    }

    if (worker.worker_status_id === EWorkerStatus.deleting) {
      if (await this.redriveStalledLifecycleIfNeeded(worker, server, context)) {
        return;
      }
      if (this.isDeletingTimeout(worker)) {
        await this.handleDeleting(worker, server, sshConfig, true, context);
      }
      return;
    }

    if (worker.worker_status_id === EWorkerStatus.stopped) {
      return;
    }

    if (worker.worker_status_id === EWorkerStatus.blocked) {
      const currentWorker = await this.executeFenced(context, () =>
        this.workerService.viewWorkerForMonitorConsistent(workerId)
      );
      if (
        !currentWorker ||
        currentWorker.deleted_at ||
        currentWorker.account_id !== worker.account_id ||
        currentWorker.server_id !== server.server_id ||
        currentWorker.worker_type_id !== worker.worker_type_id ||
        currentWorker.worker_status_id !== EWorkerStatus.blocked ||
        currentWorker.lifecycle_operation_id
      ) {
        return;
      }

      await this.removeContainer(
        context,
        workerId,
        server.server_id,
        sshConfig
      );
      return;
    }

    const planStatus = await this.executeFenced(context, () =>
      this.accountService.viewPlanStatus(worker.account_id)
    );
    const planCancelled = this.isPlanCancelled(planStatus);
    if (planCancelled) {
      logLocalConnectionStatus('service.monitor.plan_inactive_passive', {
        layer: 'service.monitor',
        worker_id: worker.worker_id,
        account_id: worker.account_id,
        worker_type_id: worker.worker_type_id,
        server_id: server.server_id,
      });
      return;
    }

    if (
      await this.reconcileProvisioningLifecycleRuntimeDivergence(
        worker,
        server,
        context
      )
    ) {
      return;
    }

    if (this.isLifecycleOrphan(worker)) {
      await this.handleRecreate(worker, server, 'orphan_lifecycle', context);
      return;
    }

    if (
      await this.redriveStalledLifecycleIfNeeded(worker, server, context, true)
    ) {
      return;
    }

    if (this.isStuck(worker)) {
      await this.handleRecreate(worker, server, 'stuck_lifecycle', context);
      return;
    }

    if (worker.worker_status_id === EWorkerStatus.error) {
      return;
    }

    if (this.shouldStopDueToInactivity(worker)) {
      await this.handleStop(worker, server, sshConfig, context);
      return;
    }

    const checkFastify = this.shouldCheckFastify(worker);
    if (checkFastify) {
      const healthy = await this.checkFastify(
        workerId,
        server.server_id,
        sshConfig,
        context
      );

      if (!healthy) {
        logLocalConnectionStatus('service.monitor.fastify_unhealthy_passive', {
          layer: 'service.monitor',
          worker_id: worker.worker_id,
          account_id: worker.account_id,
          worker_type_id: worker.worker_type_id,
          worker_status_id: worker.worker_status_id,
          server_id: server.server_id,
        });
        return;
      }
    }

    const checkConnection = this.shouldCheckConnection(worker);

    if (!checkConnection) {
      return;
    }

    const connectionHealth = await this.checkConnection(
      worker,
      server.server_id,
      sshConfig,
      context
    );

    await this.syncConnectionStatusWithFailureTracking(
      worker,
      connectionHealth,
      server.server_id,
      sshConfig,
      context
    );
  };

  private readonly reconcileContainerOnDifferentServer = async (
    snapshot: IWorkerMonitor,
    observedServer: IBalanceMonitorServer,
    sshConfig: ConnectConfig,
    context: ILockLeaseContext = UNFENCED_LOCK_LEASE_CONTEXT
  ): Promise<void> => {
    const current = await this.executeFenced(context, () =>
      this.workerService.viewWorkerForMonitorConsistent(snapshot.worker_id)
    );

    if (
      current &&
      !current.deleted_at &&
      current.account_id === snapshot.account_id &&
      current.server_id === observedServer.server_id
    ) {
      logLocalConnectionStatus(
        'service.monitor.container_server_mismatch_skipped_after_fence',
        {
          layer: 'service.monitor',
          worker_id: snapshot.worker_id,
          account_id: snapshot.account_id,
          worker_type_id: snapshot.worker_type_id,
          snapshot_server_id: snapshot.server_id,
          current_server_id: current.server_id,
          observed_server_id: observedServer.server_id,
          lifecycle_operation_id: current.lifecycle_operation_id ?? undefined,
        }
      );
      return;
    }

    if (
      current &&
      !current.deleted_at &&
      current.account_id !== snapshot.account_id
    ) {
      logLocalConnectionStatus(
        'service.monitor.container_server_mismatch_account_fence',
        {
          layer: 'service.monitor',
          worker_id: snapshot.worker_id,
          account_id: snapshot.account_id,
          current_account_id: current.account_id,
          snapshot_server_id: snapshot.server_id,
          current_server_id: current.server_id,
          observed_server_id: observedServer.server_id,
        }
      );
      return;
    }

    await this.removeContainer(
      context,
      snapshot.worker_id,
      observedServer.server_id,
      sshConfig
    );
    logLocalConnectionStatus(
      'service.monitor.container_removed_from_superseded_server',
      {
        layer: 'service.monitor',
        worker_id: snapshot.worker_id,
        account_id: snapshot.account_id,
        worker_type_id: snapshot.worker_type_id,
        snapshot_server_id: snapshot.server_id,
        current_server_id: current?.server_id,
        observed_server_id: observedServer.server_id,
        lifecycle_operation_id: current?.lifecycle_operation_id ?? undefined,
      }
    );
  };

  private readonly handleMissingContainer = async (
    worker: IWorkerMonitor,
    server: IBalanceMonitorServer,
    sshConfig: ConnectConfig,
    context: ILockLeaseContext = UNFENCED_LOCK_LEASE_CONTEXT
  ): Promise<void> => {
    if (worker.deleted_at) {
      return;
    }

    if (await this.repairStaleTerminalLifecycleFence(worker, server, context)) {
      return;
    }

    if (
      worker.worker_status_id === EWorkerStatus.blocked ||
      worker.worker_status_id === EWorkerStatus.stopped
    ) {
      return;
    }

    if (worker.worker_status_id === EWorkerStatus.delete) {
      logLocalConnectionStatus(
        'service.monitor.legacy_delete_status_manual_recovery_required',
        {
          layer: 'service.monitor',
          worker_id: worker.worker_id,
          account_id: worker.account_id,
          worker_type_id: worker.worker_type_id,
          worker_status_id: worker.worker_status_id,
          lifecycle_operation_id: worker.lifecycle_operation_id ?? undefined,
          container_exists: false,
        }
      );
      return;
    }

    if (worker.worker_status_id === EWorkerStatus.deleting) {
      if (await this.redriveStalledLifecycleIfNeeded(worker, server, context)) {
        return;
      }
      if (this.isDeletingTimeout(worker)) {
        await this.handleDeleting(worker, server, sshConfig, false, context);
      }
      return;
    }

    const planStatus = await this.executeFenced(context, () =>
      this.accountService.viewPlanStatus(worker.account_id)
    );
    const planCancelled = this.isPlanCancelled(planStatus);
    if (planCancelled) {
      logLocalConnectionStatus('service.monitor.plan_inactive_passive', {
        layer: 'service.monitor',
        worker_id: worker.worker_id,
        account_id: worker.account_id,
        worker_type_id: worker.worker_type_id,
        server_id: server.server_id,
      });
      return;
    }

    if (this.isLifecycleOrphan(worker)) {
      await this.handleRecreate(worker, server, 'orphan_lifecycle', context);
      return;
    }

    if (
      await this.redriveStalledLifecycleIfNeeded(worker, server, context, true)
    ) {
      return;
    }

    if (this.isStuck(worker)) {
      await this.handleRecreate(worker, server, 'stuck_lifecycle', context);
      return;
    }

    const isRuntimeAbsentStatus =
      worker.worker_status_id === EWorkerStatus.offline ||
      worker.worker_status_id === EWorkerStatus.mismatched ||
      worker.worker_status_id === EWorkerStatus.disponible ||
      worker.worker_status_id === EWorkerStatus.error;
    if (isRuntimeAbsentStatus) {
      if (this.shouldStopDueToInactivity(worker)) {
        logLocalConnectionStatus(
          'service.monitor.inactivity_stop_skipped_without_runtime_evidence',
          {
            layer: 'service.monitor',
            worker_id: worker.worker_id,
            account_id: worker.account_id,
            worker_type_id: worker.worker_type_id,
            worker_status_id: worker.worker_status_id,
            server_id: worker.server_id,
            reason: 'container_missing',
          }
        );
      }
      await this.applyCanonicalStoppedStatus(
        worker,
        'container_missing',
        context
      );
      return;
    }

    const provisioning = this.isProvisioning(worker);
    if (provisioning) {
      return;
    }

    await this.handleRecreate(worker, server, 'missing_container', context);
  };

  private readonly handleDeleting = async (
    worker: IWorkerMonitor,
    server: IBalanceMonitorServer,
    sshConfig: ConnectConfig,
    containerExists: boolean,
    context: ILockLeaseContext = UNFENCED_LOCK_LEASE_CONTEXT
  ): Promise<void> => {
    const currentWorker = await this.executeFenced(context, () =>
      this.workerService.viewWorkerForMonitorConsistent(worker.worker_id)
    );
    if (
      !currentWorker ||
      currentWorker.deleted_at ||
      currentWorker.account_id !== worker.account_id ||
      currentWorker.server_id !== server.server_id ||
      currentWorker.worker_type_id !== worker.worker_type_id ||
      currentWorker.worker_status_id !== EWorkerStatus.deleting ||
      !this.isDeletingTimeout(currentWorker)
    ) {
      logLocalConnectionStatus('service.monitor.delete_skipped_after_fence', {
        layer: 'service.monitor',
        worker_id: worker.worker_id,
        account_id: worker.account_id,
        worker_type_id: worker.worker_type_id,
        current_worker_status_id: currentWorker?.worker_status_id,
        current_server_id: currentWorker?.server_id,
        lifecycle_operation_id:
          currentWorker?.lifecycle_operation_id ?? undefined,
      });
      return;
    }

    logLocalConnectionStatus('service.monitor.delete_proof_redrive_pending', {
      layer: 'service.monitor',
      worker_id: currentWorker.worker_id,
      account_id: currentWorker.account_id,
      worker_type_id: currentWorker.worker_type_id,
      session_storage: currentWorker.session_storage,
      lifecycle_operation_id: currentWorker.lifecycle_operation_id ?? undefined,
      container_exists: containerExists,
      server_id: server.server_id,
      reason: currentWorker.lifecycle_operation_id
        ? 'immutable_command_not_yet_completed'
        : 'immutable_delete_proof_missing_manual_recovery_required',
    });
  };

  private readonly handleStop = async (
    worker: IWorkerMonitor,
    server: IBalanceMonitorServer,
    sshConfig: ConnectConfig,
    context: ILockLeaseContext = UNFENCED_LOCK_LEASE_CONTEXT
  ): Promise<void> => {
    const runtimeConfirmedInactive = await this.confirmRuntimeInactive(
      worker,
      server,
      sshConfig,
      context
    );
    if (!runtimeConfirmedInactive) {
      return;
    }

    const stopped = await this.applyStoppedStatus(worker, context);
    if (!stopped) {
      return;
    }

    await this.removeContainer(
      context,
      worker.worker_id,
      server.server_id,
      sshConfig
    );
  };

  private readonly confirmRuntimeInactive = async (
    worker: IWorkerMonitor,
    server: IBalanceMonitorServer,
    sshConfig: ConnectConfig,
    context: ILockLeaseContext = UNFENCED_LOCK_LEASE_CONTEXT
  ): Promise<boolean> => {
    const connectionHealth = await this.checkConnection(
      worker,
      server.server_id,
      sshConfig,
      context
    );

    if (connectionHealth.healthy) {
      await this.syncConnectionStatusWithFailureTracking(
        worker,
        connectionHealth,
        server.server_id,
        sshConfig,
        context
      );
      logLocalConnectionStatus(
        'service.monitor.inactivity_stop_skipped_active_runtime',
        {
          layer: 'service.monitor',
          worker_id: worker.worker_id,
          account_id: worker.account_id,
          worker_type_id: worker.worker_type_id,
          worker_status_id: worker.worker_status_id,
          server_id: server.server_id,
          reason: 'connection_health_ready',
        }
      );
      return false;
    }

    if (this.hasActiveProviderSessionEvidence(connectionHealth)) {
      logLocalConnectionStatus(
        'service.monitor.inactivity_stop_skipped_active_runtime',
        {
          layer: 'service.monitor',
          worker_id: worker.worker_id,
          account_id: worker.account_id,
          worker_type_id: worker.worker_type_id,
          worker_status_id: worker.worker_status_id,
          server_id: server.server_id,
          provider_state: connectionHealth.provider_state,
          reason: 'active_provider_session',
        }
      );
      return false;
    }

    if (!this.hasStrongSessionAbsenceEvidence(connectionHealth)) {
      logLocalConnectionStatus(
        'service.monitor.inactivity_stop_skipped_inconclusive_probe',
        {
          layer: 'service.monitor',
          worker_id: worker.worker_id,
          account_id: worker.account_id,
          worker_type_id: worker.worker_type_id,
          worker_status_id: worker.worker_status_id,
          server_id: server.server_id,
          status_code: connectionHealth.code,
          provider_state: connectionHealth.provider_state,
          degraded_reason: connectionHealth.degraded_reason,
          reason: 'strong_session_absence_not_proven',
        }
      );
      return false;
    }

    return true;
  };

  private readonly handleRecreate = async (
    worker: IWorkerMonitor,
    server: IBalanceMonitorServer,
    trigger: WorkerRecreateTrigger,
    context: ILockLeaseContext = UNFENCED_LOCK_LEASE_CONTEXT,
    expectedContainer?: IPersistentlyUnhealthyContainer,
    livenessCooldownOwner?: string
  ): Promise<void> => {
    await this.handleRecreateOutcome(
      worker,
      server,
      trigger,
      context,
      expectedContainer,
      livenessCooldownOwner
    );
  };

  private readonly handleRecreateOutcome = async (
    worker: IWorkerMonitor,
    server: IBalanceMonitorServer,
    trigger: WorkerRecreateTrigger,
    context: ILockLeaseContext = UNFENCED_LOCK_LEASE_CONTEXT,
    expectedContainer?: IPersistentlyUnhealthyContainer,
    livenessCooldownOwner?: string
  ): Promise<boolean> => {
    const currentWorker = await this.executeFenced(context, () =>
      this.workerService.viewWorkerForMonitorConsistent(worker.worker_id)
    );
    const canSupersedeStuckLifecycle =
      trigger === 'stuck_lifecycle' &&
      Boolean(currentWorker?.lifecycle_operation_id) &&
      Boolean(currentWorker && this.isStuck(currentWorker));

    if (
      !currentWorker ||
      currentWorker.deleted_at ||
      currentWorker.account_id !== worker.account_id ||
      currentWorker.server_id !== server.server_id ||
      (trigger === 'missing_container' &&
        (!worker.container_id ||
          currentWorker.container_id !== worker.container_id ||
          !worker.runtime_container_id ||
          currentWorker.runtime_container_id !== worker.runtime_container_id ||
          !Number.isSafeInteger(worker.runtime_generation) ||
          currentWorker.runtime_generation !== worker.runtime_generation ||
          (Boolean(worker.runtime_session_volume_name) &&
            currentWorker.runtime_session_volume_name !==
              worker.runtime_session_volume_name))) ||
      (trigger === 'container_unhealthy' &&
        (currentWorker.worker_type_id !== worker.worker_type_id ||
          !worker.container_id ||
          currentWorker.container_id !== worker.container_id ||
          !worker.runtime_container_id ||
          currentWorker.runtime_container_id !== worker.runtime_container_id ||
          !Number.isSafeInteger(worker.runtime_generation) ||
          currentWorker.runtime_generation !== worker.runtime_generation)) ||
      (Boolean(currentWorker.lifecycle_operation_id) &&
        !canSupersedeStuckLifecycle) ||
      !this.shouldRecreateAfterConsistentRead(currentWorker, trigger)
    ) {
      logLocalConnectionStatus('service.monitor.recreate_skipped_after_fence', {
        layer: 'service.monitor',
        worker_id: worker.worker_id,
        account_id: worker.account_id,
        worker_type_id: worker.worker_type_id,
        trigger,
        current_worker_status_id: currentWorker?.worker_status_id,
        lifecycle_operation_id:
          currentWorker?.lifecycle_operation_id ?? undefined,
        current_server_id: currentWorker?.server_id,
      });
      return false;
    }

    const supersededOperationId = currentWorker.lifecycle_operation_id ?? null;
    const operationId =
      trigger === 'container_unhealthy' && livenessCooldownOwner
        ? livenessCooldownOwner
        : uuidv7();
    const expectedLivenessFence =
      trigger === 'container_unhealthy' &&
      expectedContainer &&
      expectedContainer.containerId === currentWorker.container_id &&
      expectedContainer.runtimeGeneration ===
        currentWorker.runtime_generation &&
      expectedContainer.startedAt &&
      Number.isSafeInteger(expectedContainer.restartCount) &&
      this.isPersistentLivenessFailure(expectedContainer)
        ? {
            expected_container_id: expectedContainer.containerId,
            expected_container_started_at: expectedContainer.startedAt,
            expected_container_restart_count: expectedContainer.restartCount,
            expected_container_health_status: expectedContainer.healthStatus,
            expected_container_paused: expectedContainer.paused,
            expected_runtime_generation: expectedContainer.runtimeGeneration,
          }
        : null;
    if (trigger === 'container_unhealthy' && !expectedLivenessFence) {
      logLocalConnectionStatus('service.monitor.recreate_skipped_after_fence', {
        layer: 'service.monitor',
        worker_id: worker.worker_id,
        account_id: worker.account_id,
        worker_type_id: worker.worker_type_id,
        trigger,
        reason: 'docker_liveness_identity_missing',
      });
      return false;
    }
    const payload: IWorkerPayload = {
      action: EWorkerAction.recreate,
      worker_id: currentWorker.worker_id,
      server_id: currentWorker.server_id,
      account_id: currentWorker.account_id,
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: currentWorker.worker_type_id,
      session_storage: currentWorker.session_storage,
      name: currentWorker.name,
      worker_name: currentWorker.name,
      previous_worker_status_id: currentWorker.worker_status_id,
      lifecycle_operation_id: operationId,
      ...(expectedLivenessFence ?? {}),
    };
    const statusPayload: IBaileysConnectionState = {
      code: ECodeMessage.info,
      status: EBaileysConnectionStatus.info,
      worker_id: currentWorker.worker_id,
      worker_name: currentWorker.name,
      account_id: currentWorker.account_id,
      worker_type_id: currentWorker.worker_type_id,
      worker_status_id: EWorkerStatus.recreating,
    };
    const lifecycleMessage: IWorkerLifecycleQueueMessage = {
      request_id: uuidv7(),
      operation_id: operationId,
      action: 'recreate',
      worker_id: currentWorker.worker_id,
      account_id: currentWorker.account_id,
      server_id: currentWorker.server_id,
      worker_type_id: currentWorker.worker_type_id,
      session_storage: currentWorker.session_storage,
      worker_status_id: EWorkerStatus.recreating,
      source: 'worker_recreate',
      previous_worker_status_id: currentWorker.worker_status_id,
      requested_at: currentTime(),
      ...(expectedLivenessFence ?? {}),
    };
    let exactRuntimeFence: {
      container_id: string;
      runtime_container_id: string;
      runtime_generation: number;
      runtime_session_volume_name?: string;
    } | null = null;
    if (trigger === 'container_unhealthy' || trigger === 'missing_container') {
      const containerId = currentWorker.container_id;
      const runtimeContainerId = currentWorker.runtime_container_id;
      const runtimeGeneration = currentWorker.runtime_generation;
      const runtimeSessionVolumeName =
        currentWorker.runtime_session_volume_name?.trim() || undefined;
      if (
        !containerId ||
        !runtimeContainerId ||
        typeof runtimeGeneration !== 'number' ||
        !Number.isSafeInteger(runtimeGeneration)
      ) {
        logLocalConnectionStatus(
          'service.monitor.recreate_skipped_after_fence',
          {
            layer: 'service.monitor',
            worker_id: currentWorker.worker_id,
            account_id: currentWorker.account_id,
            worker_type_id: currentWorker.worker_type_id,
            trigger,
            reason: 'runtime_identity_missing_after_consistent_read',
          }
        );
        return false;
      }
      exactRuntimeFence = {
        container_id: containerId,
        runtime_container_id: runtimeContainerId,
        runtime_generation: runtimeGeneration,
        ...(runtimeSessionVolumeName
          ? {
              runtime_session_volume_name: runtimeSessionVolumeName,
            }
          : {}),
      };
    }

    await this.executeFenced(context, () =>
      this.workerLifecycleQueueService.prepare(lifecycleMessage)
    );

    let fenced = false;
    try {
      context.assertActive();
      fenced = await this.workerService.updateWorkerByIdIfLifecycleMatches(
        currentWorker.account_id,
        {
          worker_id: currentWorker.worker_id,
          worker_status_id: EWorkerStatus.recreating,
          lifecycle_operation_id: operationId,
        },
        {
          lifecycle_operation_id: supersededOperationId,
          ...(exactRuntimeFence ?? {}),
          server_id: currentWorker.server_id,
          worker_type_id: currentWorker.worker_type_id,
          worker_status_id: currentWorker.worker_status_id,
        }
      );
      context.assertActive();
    } catch (claimError) {
      let lifecycleClaimWasApplied: boolean | undefined;
      let primaryReadError: unknown;
      try {
        const observed =
          await this.workerService.viewWorkerForMonitorConsistent(
            currentWorker.worker_id
          );
        lifecycleClaimWasApplied =
          observed?.account_id === currentWorker.account_id &&
          observed.server_id === currentWorker.server_id &&
          observed.worker_type_id === currentWorker.worker_type_id &&
          !observed.deleted_at &&
          observed.worker_status_id === EWorkerStatus.recreating &&
          observed.lifecycle_operation_id === operationId &&
          (!exactRuntimeFence ||
            (observed.container_id === exactRuntimeFence.container_id &&
              observed.runtime_container_id ===
                exactRuntimeFence.runtime_container_id &&
              observed.runtime_generation ===
                exactRuntimeFence.runtime_generation &&
              (exactRuntimeFence.runtime_session_volume_name === undefined ||
                observed.runtime_session_volume_name ===
                  exactRuntimeFence.runtime_session_volume_name)));
      } catch (error) {
        primaryReadError = error;
      }

      if (lifecycleClaimWasApplied !== false) {
        try {
          await this.publishLifecycleRecovery(lifecycleMessage);
        } catch (publishError) {
          throw new AggregateError(
            [
              claimError,
              ...(primaryReadError ? [primaryReadError] : []),
              publishError,
            ],
            `Worker recreate lifecycle ${operationId} remains prepared for fast redrive`
          );
        }
      }
      throw claimError;
    }

    if (!fenced) {
      logLocalConnectionStatus('service.monitor.recreate_fence_lost', {
        layer: 'service.monitor',
        worker_id: currentWorker.worker_id,
        account_id: currentWorker.account_id,
        worker_type_id: currentWorker.worker_type_id,
        trigger,
      });
      return false;
    }

    try {
      context.assertActive();
      await this.publishLifecycleRecovery(lifecycleMessage);
      context.assertActive();
    } catch (error) {
      /*
       * The exact command and database claim are both durable. Kafka failure
       * therefore leaves the operation intact for the ten-second fast
       * redrive; reverting the row would orphan the journal.
       */
      logLocalConnectionStatus(
        'service.monitor.lifecycle_publish_pending_redrive',
        {
          layer: 'service.monitor',
          worker_id: currentWorker.worker_id,
          account_id: currentWorker.account_id,
          worker_type_id: currentWorker.worker_type_id,
          lifecycle_operation_id: operationId,
          server_id: currentWorker.server_id,
          trigger,
          reason: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
    }

    logLocalConnectionStatus('service.monitor.recreate_enqueued', {
      layer: 'service.monitor',
      worker_id: currentWorker.worker_id,
      account_id: currentWorker.account_id,
      worker_type_id: currentWorker.worker_type_id,
      lifecycle_operation_id: operationId,
      trigger,
      superseded_lifecycle_operation_id: supersededOperationId ?? undefined,
    });

    context.assertActive();
    await Promise.all([
      this.centrifugoService.publishSub(
        workerCentrifugoQueue(currentWorker.account_id),
        statusPayload
      ),
      this.centrifugoService.publish(channelsConfigCentrifugo(), payload),
    ]).catch((error) => {
      logLocalConnectionStatus(
        'service.monitor.recreate_status_publish_failed',
        {
          layer: 'service.monitor',
          worker_id: currentWorker.worker_id,
          account_id: currentWorker.account_id,
          worker_type_id: currentWorker.worker_type_id,
          lifecycle_operation_id: operationId,
          trigger,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    });
    context.assertActive();
    return true;
  };

  private readonly shouldRecreateAfterConsistentRead = (
    worker: IWorkerMonitor,
    trigger: WorkerRecreateTrigger
  ): boolean => {
    if (
      worker.worker_status_id === EWorkerStatus.deleting ||
      worker.worker_status_id === EWorkerStatus.delete ||
      worker.worker_status_id === EWorkerStatus.blocked ||
      worker.worker_status_id === EWorkerStatus.stopped
    ) {
      return false;
    }

    if (trigger === 'orphan_lifecycle') {
      return this.isLifecycleOrphan(worker);
    }

    if (trigger === 'stuck_lifecycle') {
      return this.isStuck(worker);
    }

    if (trigger === 'worker_error') {
      return false;
    }

    if (trigger === 'fastify_unhealthy') {
      return false;
    }

    if (trigger === 'container_unhealthy') {
      return worker.worker_status_id === EWorkerStatus.online;
    }

    if (this.isProvisioning(worker)) {
      return this.isLifecycleOrphan(worker) || this.isStuck(worker);
    }

    return worker.worker_status_id === EWorkerStatus.online;
  };

  private readonly publishLifecycleRecovery = async (
    lifecycleMessage: IWorkerLifecycleQueueMessage
  ): Promise<void> => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await this.workerLifecycleQueueService.publish(lifecycleMessage);
        return;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(
          `Unable to publish lifecycle recovery for worker ${lifecycleMessage.worker_id}`
        );
  };

  private readonly syncConnectionStatusWithFailureTracking = async (
    worker: IWorkerMonitor,
    connectionHealth: IConnectionHealthCheckResult,
    _serverId: string,
    _sshConfig: ConnectConfig,
    context: ILockLeaseContext = UNFENCED_LOCK_LEASE_CONTEXT
  ): Promise<void> => {
    const now = Date.now();
    const tracker = this.connectionFailureTrackers.get(worker.worker_id);
    const connectionHealthy = connectionHealth.healthy;

    if (this.hasActiveConnectionDisconnectBarrier(worker)) {
      this.connectionFailureTrackers.delete(worker.worker_id);
      logLocalConnectionStatus(
        'service.monitor.connection_status_suppressed_by_disconnect_barrier',
        {
          layer: 'service.monitor',
          worker_id: worker.worker_id,
          account_id: worker.account_id,
          worker_type_id: worker.worker_type_id,
          worker_status_id: worker.worker_status_id,
          runtime_generation: worker.runtime_generation,
          connection_epoch: worker.connection_epoch,
          provider_state: connectionHealth.provider_state,
          degraded_reason: connectionHealth.degraded_reason,
          reason: 'worker_connection_disconnect_in_progress',
        }
      );
      return;
    }

    if (connectionHealthy) {
      logLocalConnectionStatus('service.monitor.connection_check.healthy', {
        layer: 'service.monitor',
        worker_id: worker.worker_id,
        account_id: worker.account_id,
        worker_type_id: worker.worker_type_id,
        worker_status_id: worker.worker_status_id,
        connection_healthy: true,
        session_ready: connectionHealth.session_ready,
        connected: connectionHealth.connected,
        can_send: connectionHealth.can_send,
        can_receive_runtime: connectionHealth.can_receive_runtime,
        authenticated: connectionHealth.authenticated,
        provider_state: connectionHealth.provider_state,
        degraded_reason: connectionHealth.degraded_reason,
        phone: connectionHealth.phone,
        had_tracker: Boolean(tracker),
      });
      if (tracker) {
        this.connectionFailureTrackers.delete(worker.worker_id);
      }

      await this.executeFenced(context, () =>
        this.workerService.updateWorkerLastConnectionCheckAt(worker.worker_id)
      );

      if (this.shouldPromoteReadyWorkerToOnline(worker.worker_status_id)) {
        await this.reconcileReadyWorkerToOnline(
          worker,
          connectionHealth,
          context
        );
      }

      return;
    }

    if (worker.worker_status_id === EWorkerStatus.disponible) {
      if (tracker) {
        this.connectionFailureTrackers.delete(worker.worker_id);
      }

      logLocalConnectionStatus('service.monitor.disponible_not_ready', {
        layer: 'service.monitor',
        worker_id: worker.worker_id,
        account_id: worker.account_id,
        worker_type_id: worker.worker_type_id,
        worker_status_id: worker.worker_status_id,
        connection_healthy: false,
        status_code: connectionHealth.code,
        session_ready: connectionHealth.session_ready,
        connected: connectionHealth.connected,
        can_send: connectionHealth.can_send,
        can_receive_runtime: connectionHealth.can_receive_runtime,
        authenticated: connectionHealth.authenticated,
        provider_state: connectionHealth.provider_state,
        degraded_reason: connectionHealth.degraded_reason,
        kafka_unhealthy: connectionHealth.kafka_unhealthy,
      });

      return;
    }

    if (!tracker) {
      this.connectionFailureTrackers.set(worker.worker_id, {
        failureCount: 1,
        lastCheckTimestamp: now,
      });
      logLocalConnectionStatus('service.monitor.connection_check.failure', {
        layer: 'service.monitor',
        worker_id: worker.worker_id,
        account_id: worker.account_id,
        worker_type_id: worker.worker_type_id,
        worker_status_id: worker.worker_status_id,
        connection_healthy: false,
        failure_count: 1,
        max_failures: this.maxConnectionFailures,
        started_continuous_check: false,
      });

      return;
    }

    const newFailureCount = tracker.failureCount + 1;
    this.connectionFailureTrackers.set(worker.worker_id, {
      failureCount: newFailureCount,
      lastCheckTimestamp: now,
    });
    logLocalConnectionStatus('service.monitor.connection_check.failure', {
      layer: 'service.monitor',
      worker_id: worker.worker_id,
      account_id: worker.account_id,
      worker_type_id: worker.worker_type_id,
      session_storage: worker.session_storage,
      worker_status_id: worker.worker_status_id,
      connection_healthy: false,
      failure_count: newFailureCount,
      max_failures: this.maxConnectionFailures,
    });

    if (newFailureCount >= this.maxConnectionFailures) {
      await this.handlePersistentConnectionDegradation(
        worker,
        connectionHealth,
        context
      );
    }
  };

  private readonly handlePersistentConnectionDegradation = async (
    worker: IWorkerMonitor,
    connectionHealth: IConnectionHealthCheckResult,
    context: ILockLeaseContext = UNFENCED_LOCK_LEASE_CONTEXT
  ): Promise<void> => {
    this.connectionFailureTrackers.delete(worker.worker_id);

    await this.updateWorkerDegradedStatus(worker, connectionHealth, context);
  };

  private readonly updateWorkerDegradedStatus = async (
    worker: IWorkerMonitor,
    connectionHealth: IConnectionHealthCheckResult,
    context: ILockLeaseContext = UNFENCED_LOCK_LEASE_CONTEXT
  ): Promise<boolean> => {
    const degradedReason =
      connectionHealth.degraded_reason ??
      (connectionHealth.kafka_unhealthy
        ? 'kafka_unhealthy'
        : 'connection_health_failed');

    const currentWorker = await this.executeFenced(context, () =>
      this.workerService.viewWorkerForMonitorConsistent(worker.worker_id)
    );
    if (
      !currentWorker ||
      currentWorker.deleted_at ||
      currentWorker.account_id !== worker.account_id ||
      currentWorker.server_id !== worker.server_id ||
      currentWorker.worker_type_id !== worker.worker_type_id ||
      currentWorker.lifecycle_operation_id ||
      this.hasActiveConnectionDisconnectBarrier(currentWorker) ||
      currentWorker.worker_status_id !== worker.worker_status_id
    ) {
      logLocalConnectionStatus(
        'service.monitor.degraded_status_skipped_after_fence',
        {
          layer: 'service.monitor',
          worker_id: worker.worker_id,
          account_id: worker.account_id,
          worker_type_id: worker.worker_type_id,
          previous_worker_status_id: worker.worker_status_id,
          current_worker_status_id: currentWorker?.worker_status_id,
          lifecycle_operation_id:
            currentWorker?.lifecycle_operation_id ?? undefined,
        }
      );
      return false;
    }

    if (!this.hasStrongSessionAbsenceEvidence(connectionHealth)) {
      logLocalConnectionStatus(
        'service.monitor.degraded_status_preserved_without_session_absence',
        {
          layer: 'service.monitor',
          worker_id: currentWorker.worker_id,
          account_id: currentWorker.account_id,
          worker_type_id: currentWorker.worker_type_id,
          worker_status_id: currentWorker.worker_status_id,
          session_ready: connectionHealth.session_ready,
          connected: connectionHealth.connected,
          can_send: connectionHealth.can_send,
          can_receive_runtime: connectionHealth.can_receive_runtime,
          authenticated: connectionHealth.authenticated,
          provider_state: connectionHealth.provider_state,
          degraded_reason: degradedReason,
          kafka_unhealthy: connectionHealth.kafka_unhealthy,
          active_session_evidence:
            this.hasActiveProviderSessionEvidence(connectionHealth),
          reason: 'strong_session_absence_not_proven',
        }
      );
      return false;
    }

    const updated = await this.executeFenced(context, () =>
      this.workerService.updateWorkerByIdIfLifecycleMatches(
        currentWorker.account_id,
        {
          worker_id: currentWorker.worker_id,
          worker_status_id: EWorkerStatus.disponible,
        },
        {
          lifecycle_operation_id: null,
          server_id: currentWorker.server_id,
          worker_type_id: currentWorker.worker_type_id,
          worker_status_id: currentWorker.worker_status_id,
          updated_at: currentWorker.updated_at,
        }
      )
    );
    if (!updated) {
      return false;
    }

    const payload: IBaileysConnectionState = {
      code: ECodeMessage.awaitConnection,
      status: EBaileysConnectionStatus.connecting,
      worker_id: worker.worker_id,
      worker_name: worker.name,
      account_id: worker.account_id,
      worker_type_id: worker.worker_type_id,
      worker_status_id: EWorkerStatus.disponible,
      session_ready: false,
      can_send: false,
      can_receive_runtime: false,
      authenticated: false,
      provider_state: connectionHealth.provider_state ?? 'degraded',
      degraded_reason: degradedReason,
    };

    logLocalConnectionStatus('service.monitor.degraded_status_update', {
      layer: 'service.monitor',
      worker_id: worker.worker_id,
      account_id: worker.account_id,
      worker_type_id: worker.worker_type_id,
      previous_worker_status_id: worker.worker_status_id,
      worker_status_id: EWorkerStatus.disponible,
      session_ready: connectionHealth.session_ready,
      can_send: connectionHealth.can_send,
      can_receive_runtime: connectionHealth.can_receive_runtime,
      authenticated: connectionHealth.authenticated,
      provider_state: payload.provider_state,
      degraded_reason: degradedReason,
      kafka_unhealthy: connectionHealth.kafka_unhealthy,
      status_code: connectionHealth.code,
    });

    await this.executeFenced(context, () =>
      this.centrifugoService.publishSub(
        workerCentrifugoQueue(worker.account_id),
        payload
      )
    );
    return true;
  };

  private readonly hasActiveProviderSessionEvidence = (
    connectionHealth: IConnectionHealthCheckResult
  ): boolean => {
    const state = (connectionHealth.provider_state ?? '').trim().toLowerCase();
    const activeProviderState =
      state.includes('connected') ||
      state === 'open' ||
      state === 'ready' ||
      state === 'kafka_consumers_not_ready';

    return (
      connectionHealth.authenticated === true ||
      connectionHealth.connected === true ||
      connectionHealth.session_ready === true ||
      (connectionHealth.authenticated !== false &&
        Boolean(connectionHealth.phone?.trim()) &&
        activeProviderState)
    );
  };

  private readonly hasActiveConnectionDisconnectBarrier = (
    worker: IWorkerMonitor
  ): boolean =>
    worker.connection_disconnected_at !== null &&
    worker.connection_disconnected_at !== undefined &&
    (worker.connection_epoch ?? null) ===
      (worker.disconnected_connection_epoch ?? null);

  private readonly reconcileConnectionDisconnectBarrier = async (
    worker: IWorkerMonitor,
    context: ILockLeaseContext
  ): Promise<boolean> => {
    if (
      !this.hasActiveConnectionDisconnectBarrier(worker) ||
      worker.lifecycle_operation_id
    ) {
      return false;
    }

    const runtimeGeneration = Number(worker.runtime_generation);
    if (!Number.isSafeInteger(runtimeGeneration) || runtimeGeneration <= 0) {
      logLocalConnectionStatus(
        'service.monitor.connection_disconnect_recovery_invalid_runtime',
        {
          layer: 'service.monitor',
          worker_id: worker.worker_id,
          account_id: worker.account_id,
          worker_type_id: worker.worker_type_id,
          runtime_generation: worker.runtime_generation,
        }
      );
      return true;
    }

    try {
      await this.executeFenced(context, () =>
        this.workerCommandHandlerService.handleChangeConnectionStatus(
          {
            worker_id: worker.worker_id,
            status: EWorkerStatus.disponible,
            type: EBaileysConnectionType.qrcode,
            remove_session: true,
            runtime_generation: runtimeGeneration,
            debug_trace_id: `disconnect-monitor:${worker.worker_id}`,
          },
          worker.account_id
        )
      );

      const current = await this.executeFenced(context, () =>
        this.workerService.viewWorkerForMonitorConsistent(worker.worker_id)
      );
      if (
        !current ||
        current.account_id !== worker.account_id ||
        current.deleted_at ||
        !this.hasActiveConnectionDisconnectBarrier(current) ||
        current.worker_status_id !== EWorkerStatus.disponible ||
        current.number !== null ||
        current.connection_date !== null
      ) {
        return true;
      }

      const observedAt =
        current.updated_at ??
        current.connection_disconnected_at ??
        currentTime();
      const markerKey = [
        'worker:connection-disconnect:terminal',
        current.worker_id,
        runtimeGeneration,
        current.connection_disconnected_at ?? 'unknown',
      ].join(':');
      const alreadyPublished = await this.redis
        .get(markerKey)
        .catch(() => null);
      if (!alreadyPublished) {
        const payload: IBaileysConnectionState = {
          action: EWorkerAction.notify,
          event_type: 'status',
          status: EBaileysConnectionStatus.disconnected,
          code: ECodeMessage.loggedOut,
          worker_id: current.worker_id,
          worker_name: current.name,
          account_id: current.account_id,
          worker_type_id: current.worker_type_id,
          worker_status_id: EWorkerStatus.disponible,
          disconnected_user: true,
          session_removed: true,
          runtime_generation: runtimeGeneration,
          container_id:
            current.runtime_container_id ?? current.container_id ?? undefined,
          worker_status_observed_at: observedAt,
          reason: 'worker_connection_session_removed_monitor_replay',
        };
        await this.executeFenced(context, () =>
          this.centrifugoService.publishSub(
            workerCentrifugoQueue(current.account_id),
            payload
          )
        );
        await this.redis
          .set(
            markerKey,
            observedAt,
            'EX',
            CONNECTION_DISCONNECT_TERMINAL_MARKER_TTL_SECONDS,
            'NX'
          )
          .catch(() => undefined);
      }

      logLocalConnectionStatus(
        'service.monitor.connection_disconnect_recovered',
        {
          layer: 'service.monitor',
          worker_id: current.worker_id,
          account_id: current.account_id,
          worker_type_id: current.worker_type_id,
          worker_status_id: current.worker_status_id,
          runtime_generation: runtimeGeneration,
          terminal_replayed: !alreadyPublished,
        }
      );
    } catch (error) {
      logLocalConnectionStatus(
        'service.monitor.connection_disconnect_recovery_pending',
        {
          layer: 'service.monitor',
          worker_id: worker.worker_id,
          account_id: worker.account_id,
          worker_type_id: worker.worker_type_id,
          worker_status_id: worker.worker_status_id,
          runtime_generation: runtimeGeneration,
          reason: error instanceof Error ? error.message : String(error),
        }
      );
    }

    // A durable disconnect tombstone always suppresses normal health/status
    // reconciliation. A later monitor cycle retries the exact fenced cleanup.
    return true;
  };

  private readonly hasStrongSessionAbsenceEvidence = (
    connectionHealth: IConnectionHealthCheckResult
  ): boolean => {
    if (this.hasActiveProviderSessionEvidence(connectionHealth)) {
      return false;
    }

    const explicitlyInactive =
      connectionHealth.authenticated === false &&
      connectionHealth.connected === false &&
      connectionHealth.session_ready === false;
    if (!explicitlyInactive) {
      return false;
    }

    const state = `${connectionHealth.provider_state ?? ''} ${
      connectionHealth.degraded_reason ?? ''
    }`.toLowerCase();
    return [
      'qr',
      'pairing',
      'no_session',
      'missing_local_session',
      'session_absent',
      'session_missing',
    ].some((marker) => state.includes(marker));
  };

  private readonly shouldPromoteReadyWorkerToOnline = (
    status: EWorkerStatus
  ): boolean => {
    return [
      EWorkerStatus.offline,
      EWorkerStatus.mismatched,
      EWorkerStatus.disponible,
    ].includes(status);
  };

  private readonly reconcileReadyWorkerToOnline = async (
    worker: IWorkerMonitor,
    connectionHealth: IConnectionHealthCheckResult,
    context: ILockLeaseContext = UNFENCED_LOCK_LEASE_CONTEXT
  ): Promise<void> => {
    const runtimeGeneration = connectionHealth.runtime_generation;
    const hasRuntimeGeneration =
      Number.isSafeInteger(runtimeGeneration) && Number(runtimeGeneration) > 0;
    const hasPendingLifecycle = Boolean(worker.lifecycle_operation_id);
    const hasCentralAcknowledgement =
      connectionHealth.central_online_acknowledged === true;

    if (
      !hasCentralAcknowledgement ||
      !hasRuntimeGeneration ||
      hasPendingLifecycle
    ) {
      logLocalConnectionStatus(
        'service.monitor.ready_worker_reconciliation_skipped',
        {
          layer: 'service.monitor',
          worker_id: worker.worker_id,
          account_id: worker.account_id,
          worker_type_id: worker.worker_type_id,
          worker_status_id: worker.worker_status_id,
          central_online_acknowledged: hasCentralAcknowledgement,
          runtime_generation: runtimeGeneration,
          lifecycle_operation_id: worker.lifecycle_operation_id,
          reason: hasPendingLifecycle
            ? 'lifecycle_operation_pending'
            : !hasCentralAcknowledgement
              ? 'central_online_not_acknowledged'
              : 'runtime_generation_missing',
        }
      );
      return;
    }

    context.assertActive();
    try {
      await this.workerCommandHandlerService.notifyWorkerStatus({
        code: ECodeMessage.connectionEstablished,
        status: EBaileysConnectionStatus.connected,
        worker_id: worker.worker_id,
        account_id: worker.account_id,
        worker_type_id: worker.worker_type_id,
        worker_status_id: EWorkerStatus.online,
        container_id: worker.container_id ?? undefined,
        runtime_generation: runtimeGeneration,
        phone: connectionHealth.phone,
        session_ready: true,
        can_send: connectionHealth.can_send === true,
        can_receive_runtime: connectionHealth.can_receive_runtime === true,
        authenticated: connectionHealth.authenticated === true,
        provider_state: connectionHealth.provider_state,
        degraded_reason: connectionHealth.degraded_reason,
        last_probe_at: connectionHealth.last_probe_at,
        probe_latency_ms: connectionHealth.probe_latency_ms,
      });
      context.assertActive();

      logLocalConnectionStatus(
        'service.monitor.ready_worker_reconciled_through_handler',
        {
          layer: 'service.monitor',
          worker_id: worker.worker_id,
          account_id: worker.account_id,
          worker_type_id: worker.worker_type_id,
          previous_worker_status_id: worker.worker_status_id,
          worker_status_id: EWorkerStatus.online,
          runtime_generation: runtimeGeneration,
        }
      );
    } catch (error) {
      context.assertActive();
      logLocalConnectionStatus(
        'service.monitor.ready_worker_reconciliation_rejected',
        {
          layer: 'service.monitor',
          worker_id: worker.worker_id,
          account_id: worker.account_id,
          worker_type_id: worker.worker_type_id,
          previous_worker_status_id: worker.worker_status_id,
          runtime_generation: runtimeGeneration,
          reason: error instanceof Error ? error.message : String(error),
        }
      );
    }
  };

  private readonly buildSshConfig = (
    server: IBalanceMonitorServer
  ): ConnectConfig => ({
    host: server.ssh_ip,
    port: server.ssh_port,
    username: this.passwordEncryptorService.decrypt(server.ssh_username),
    password: this.passwordEncryptorService.decrypt(server.ssh_password),
  });

  private readonly runSshFenced = async (
    context: ILockLeaseContext,
    serverId: string,
    sshConfig: ConnectConfig,
    commands: string[],
    options: {
      failOnNonZero?: boolean;
      connectMaxAttempts?: number;
      commandTimeoutMs?: number;
    } = {}
  ): Promise<Awaited<ReturnType<SshService['runCommands']>>> => {
    context.assertActive();
    const cancellationKey = `worker-monitor:${serverId}:${uuidv7()}`;
    const cancel = () => {
      this.sshService.cancelServerExecution(cancellationKey);
    };
    context.signal.addEventListener('abort', cancel, { once: true });

    try {
      context.assertActive();
      const result = await this.sshService.runCommands(
        serverId,
        sshConfig,
        commands,
        false,
        {
          ...options,
          cancellationKey,
          signal: context.signal,
        }
      );
      context.assertActive();
      return result;
    } catch (error) {
      context.assertActive();
      throw error;
    } finally {
      context.signal.removeEventListener('abort', cancel);
    }
  };

  private readonly parsePersistentlyUnhealthyContainerLine = (
    line: string
  ): IPersistentlyUnhealthyContainer | null => {
    const trimmed = line.trim();
    if (!trimmed) {
      return null;
    }

    const [
      rawContainerId,
      rawName,
      rawRunning,
      rawHealthStatus,
      rawStartedAt,
      rawRestartCount,
    ] = trimmed.split('|');
    const fields = trimmed.split('|');
    const rawPaused = fields[6]?.trim().toLowerCase();
    const hasPausedField = rawPaused === 'true' || rawPaused === 'false';
    const paused = hasPausedField ? rawPaused === 'true' : false;
    const metadataStartIndex = hasPausedField ? 7 : 6;
    const rawCreatedAt = fields[metadataStartIndex]?.trim();
    const hasCreatedAtField =
      Boolean(rawCreatedAt) &&
      !rawCreatedAt?.startsWith('{') &&
      Number.isFinite(Date.parse(rawCreatedAt ?? ''));
    const createdAt = hasCreatedAtField ? rawCreatedAt : undefined;
    const rawLabels = fields.slice(
      metadataStartIndex + (hasCreatedAtField ? 1 : 0)
    );
    const containerId = rawContainerId?.trim().toLowerCase();
    const name = rawName?.trim().replace(/^\/+/, '');
    const healthStatus = rawHealthStatus?.trim().toLowerCase();
    const running = rawRunning?.trim().toLowerCase() === 'true';
    const startedAt = rawStartedAt?.trim();
    const parsedRestartCount = Number(rawRestartCount);
    const restartCount =
      Number.isSafeInteger(parsedRestartCount) && parsedRestartCount >= 0
        ? parsedRestartCount
        : undefined;
    if (
      !containerId ||
      !CONTAINER_ID_PATTERN.test(containerId) ||
      !name ||
      !['unhealthy', 'healthy', 'starting', 'none'].includes(healthStatus)
    ) {
      return null;
    }

    let labels: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(rawLabels.join('|').trim()) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        labels = parsed as Record<string, unknown>;
      }
    } catch {
      labels = {};
    }

    const warmStandby =
      String(labels['underchat.warm_standby'] ?? '').toLowerCase() === 'true';
    const warmPoolId = String(labels['underchat.warm_pool_id'] ?? '').trim();
    const workerId = String(labels['underchat.worker_id'] ?? '').trim();
    const accountId = String(labels['underchat.account_id'] ?? '').trim();
    const serverId = String(labels['underchat.server_id'] ?? '').trim();
    const workerTypeId = String(
      labels['underchat.worker_type_id'] ?? ''
    ).trim();
    const lifecycleOperationId = String(
      labels['underchat.lifecycle_operation_id'] ?? ''
    ).trim();
    const rawRuntimeGeneration = Number(labels['underchat.runtime_generation']);
    const runtimeGeneration =
      Number.isSafeInteger(rawRuntimeGeneration) && rawRuntimeGeneration > 0
        ? rawRuntimeGeneration
        : undefined;
    const activatedWorkerName = WORKER_ID_PATTERN.test(name);
    const isWarmStandby =
      name.startsWith('warm-') ||
      (!activatedWorkerName && (warmStandby || Boolean(warmPoolId)));

    return {
      containerId,
      name,
      running,
      /*
       * Docker may retain a stale `healthy` value after SIGKILL and reports
       * `none` for runtimes without a Health map. A confirmed non-running
       * container is itself the liveness failure; normalize it into the
       * existing durable unhealthy fence so rolling consumers need no new
       * protocol field. Exact identity and running state are rechecked below.
       */
      healthStatus: (running
        ? healthStatus
        : 'unhealthy') as IPersistentlyUnhealthyContainer['healthStatus'],
      isWarmStandby,
      warmPoolId: warmPoolId || undefined,
      workerId: workerId || undefined,
      accountId: accountId || undefined,
      serverId: serverId || undefined,
      workerTypeId: workerTypeId || undefined,
      lifecycleOperationId: lifecycleOperationId || undefined,
      runtimeGeneration,
      startedAt: startedAt || undefined,
      createdAt,
      restartCount,
      paused,
    };
  };

  private readonly listPersistentlyUnhealthyContainers = async (
    server: IBalanceMonitorServer,
    context: ILockLeaseContext
  ): Promise<IPersistentlyUnhealthyContainer[]> => {
    const timeoutSeconds = Math.max(
      1,
      Math.ceil(WORKER_CONTAINER_LIVENESS_REMOTE_PROCESS_TIMEOUT_MS / 1000)
    );
    /*
     * A paused cgroup cannot execute its own healthcheck and may retain a stale
     * healthy value forever. A cold-start crash loop can also remain `starting`
     * forever because every restart resets Docker's start period. Finally, a
     * SIGKILL may leave an unless-stopped container in created/exited/dead
     * instead of restarting it. Discover all of those states; terminal
     * discovery is restricted to labelled workers and every candidate still
     * passes exact Docker/DB identity plus a second observation.
     */
    const command = String.raw`timeout --signal=KILL ${timeoutSeconds}s sh -c 'unhealthy="$(docker ps --no-trunc --filter health=unhealthy --format "{{.ID}}")" || exit $?; starting="$(docker ps --no-trunc --filter health=starting --format "{{.ID}}")" || exit $?; paused="$(docker ps --no-trunc --filter status=paused --format "{{.ID}}")" || exit $?; terminal="$(docker ps -a --no-trunc --filter label=underchat.worker_id --filter status=created --filter status=exited --filter status=dead --format "{{.ID}}")" || exit $?; printf "%s\n%s\n%s\n%s\n" "$unhealthy" "$starting" "$paused" "$terminal" | sed "/^$/d" | sort -u'`;
    const outputs = await this.runSshFenced(
      context,
      server.server_id,
      {
        ...this.buildSshConfig(server),
        readyTimeout: WORKER_CONTAINER_LIVENESS_SSH_READY_TIMEOUT_MS,
      },
      [command],
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

    const lines = combined
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);
    /*
     * Keep parser compatibility with captured Docker fixtures while production
     * discovery emits only IDs. Exact per-ID inspection prevents one container
     * disappearing or timing out from invalidating every other observation.
     */
    const capturedSnapshots = lines
      .map((line) => this.parsePersistentlyUnhealthyContainerLine(line))
      .filter(
        (container): container is IPersistentlyUnhealthyContainer =>
          container !== null
      );
    if (capturedSnapshots.length > 0) {
      return capturedSnapshots;
    }

    const selectedIds = this.selectLivenessDiscoveryBatch(
      server.server_id,
      lines.filter((line) => CONTAINER_ID_PATTERN.test(line.toLowerCase()))
    );
    const inspected = await mapConcurrent(
      selectedIds,
      this.sshConcurrencyPerServer,
      async (containerId) => {
        try {
          const [container] = await this.inspectExactContainers(
            server,
            [containerId],
            context
          );
          return container ?? null;
        } catch (error) {
          context.assertActive();
          logLocalConnectionStatus(
            'service.monitor.liveness_discovery_inspect_failed',
            {
              layer: 'service.monitor',
              server_id: server.server_id,
              container_id: containerId,
              reason: error instanceof Error ? error.message : String(error),
            }
          );
          return null;
        }
      }
    );
    return inspected.filter(
      (container): container is IPersistentlyUnhealthyContainer =>
        container !== null
    );
  };

  private readonly selectLivenessDiscoveryBatch = (
    serverId: string,
    containerIds: string[]
  ): string[] => {
    const sorted = [
      ...new Set(containerIds.map((containerId) => containerId.toLowerCase())),
    ].sort();
    if (sorted.length <= WORKER_CONTAINER_LIVENESS_DISCOVERY_BATCH_SIZE) {
      this.livenessDiscoveryCursors.delete(serverId);
      return sorted;
    }

    const cursor = this.livenessDiscoveryCursors.get(serverId);
    const startIndex = cursor
      ? Math.max(
          0,
          (() => {
            const next = sorted.findIndex(
              (containerId) => containerId > cursor
            );
            return next === -1 ? 0 : next;
          })()
        )
      : 0;
    const rotated = [
      ...sorted.slice(startIndex),
      ...sorted.slice(0, startIndex),
    ];
    const selected = rotated.slice(
      0,
      WORKER_CONTAINER_LIVENESS_DISCOVERY_BATCH_SIZE
    );
    const last = selected.at(-1);
    if (last) {
      this.livenessDiscoveryCursors.set(serverId, last);
    }
    return selected;
  };

  private readonly inspectExactContainers = async (
    server: IBalanceMonitorServer,
    containerIds: string[],
    context: ILockLeaseContext
  ): Promise<IPersistentlyUnhealthyContainer[]> => {
    const ids = [
      ...new Set(
        containerIds
          .map((containerId) => containerId.trim().toLowerCase())
          .filter((containerId) => CONTAINER_ID_PATTERN.test(containerId))
      ),
    ];
    if (!ids.length) {
      return [];
    }

    const timeoutSeconds = Math.max(
      1,
      Math.ceil(WORKER_CONTAINER_LIVENESS_REMOTE_PROCESS_TIMEOUT_MS / 1000)
    );
    const command = String.raw`timeout --signal=KILL ${timeoutSeconds}s docker inspect --type=container --format '{{.Id}}|{{.Name}}|{{.State.Running}}|{{with index .State "Health"}}{{index . "Status"}}{{else}}none{{end}}|{{.State.StartedAt}}|{{.RestartCount}}|{{.State.Paused}}|{{.Created}}|{{json .Config.Labels}}' ${ids.join(
      ' '
    )}`;
    const outputs = await this.runSshFenced(
      context,
      server.server_id,
      {
        ...this.buildSshConfig(server),
        readyTimeout: WORKER_CONTAINER_LIVENESS_SSH_READY_TIMEOUT_MS,
      },
      [command],
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
      .map((line) => this.parsePersistentlyUnhealthyContainerLine(line))
      .filter(
        (container): container is IPersistentlyUnhealthyContainer =>
          container !== null
      );
  };

  private readonly inspectExactRuntimeContainerOwnership = async (
    server: IBalanceMonitorServer,
    containerId: string,
    context: ILockLeaseContext
  ): Promise<IExactRuntimeContainerOwnership | null> => {
    const normalizedContainerId = containerId.trim().toLowerCase();
    if (!CONTAINER_ID_PATTERN.test(normalizedContainerId)) {
      return null;
    }

    const timeoutSeconds = Math.max(
      1,
      Math.ceil(WORKER_CONTAINER_LIVENESS_REMOTE_PROCESS_TIMEOUT_MS / 1000)
    );
    /*
     * The ordinary liveness snapshot intentionally reads labels only. Legacy
     * replacement adoption is stronger: it can change the authoritative
     * control pointer, so collect a second immutable-ID proof containing only
     * the identity env keys plus the complete mount set. Base64 keeps Docker
     * JSON and environment values from corrupting the transport delimiter.
     */
    const command = String.raw`timeout --signal=KILL ${timeoutSeconds}s sh -ceu '
identity="$(docker inspect --type=container --format "{{.Id}}|{{.Name}}|{{.State.Running}}|{{json .Config.Labels}}" "$1")"
environment="$(docker inspect --type=container --format "{{range .Config.Env}}{{println .}}{{end}}" "$1" | sed -n -E "/^(WORKER_ID|ACCOUNT_ID|SERVER_ID|WORKER_TYPE_ID|RUNTIME_GENERATION|SESSION_VOLUME_NAME|WARM_STANDBY)=/p")"
mounts="$(docker inspect --type=container --format "{{json .Mounts}}" "$1")"
printf "%s" "$identity" | base64 -w0
printf "|"
printf "%s" "$environment" | base64 -w0
printf "|"
printf "%s" "$mounts" | base64 -w0
' sh ${normalizedContainerId}`;
    const outputs = await this.runSshFenced(
      context,
      server.server_id,
      {
        ...this.buildSshConfig(server),
        readyTimeout: WORKER_CONTAINER_LIVENESS_SSH_READY_TIMEOUT_MS,
      },
      [command],
      {
        failOnNonZero: true,
        connectMaxAttempts: 1,
        commandTimeoutMs: WORKER_CONTAINER_LIVENESS_REMOTE_COMMAND_TIMEOUT_MS,
      }
    );
    const encoded = outputs
      .map((item) => item.output)
      .join('')
      .trim();
    const parts = encoded.split('|');
    if (parts.length !== 3) {
      return null;
    }

    const decode = (value: string): string | null => {
      if (value && !/^[a-z0-9+/]+={0,2}$/iu.test(value)) {
        return null;
      }
      const decoded = Buffer.from(value, 'base64');
      const canonical = decoded.toString('base64');
      if (canonical !== value) {
        return null;
      }
      return decoded.toString('utf8');
    };
    const rawIdentity = decode(parts[0]);
    const rawEnvironment = decode(parts[1]);
    const rawMounts = decode(parts[2]);
    if (rawIdentity === null || rawEnvironment === null || rawMounts === null) {
      return null;
    }

    const identityFields = rawIdentity.split('|');
    const inspectedContainerId = identityFields[0]?.trim().toLowerCase();
    const name = identityFields[1]?.trim().replace(/^\/+/, '');
    const runningValue = identityFields[2]?.trim().toLowerCase();
    if (
      inspectedContainerId !== normalizedContainerId ||
      !name ||
      (runningValue !== 'true' && runningValue !== 'false')
    ) {
      return null;
    }

    let labels: Record<string, string>;
    let rawMountRecords: unknown;
    try {
      const parsedLabels = JSON.parse(
        identityFields.slice(3).join('|')
      ) as unknown;
      rawMountRecords = JSON.parse(rawMounts) as unknown;
      if (
        !parsedLabels ||
        typeof parsedLabels !== 'object' ||
        Array.isArray(parsedLabels) ||
        !Array.isArray(rawMountRecords)
      ) {
        return null;
      }
      labels = {};
      for (const [key, value] of Object.entries(parsedLabels)) {
        if (typeof value !== 'string') {
          return null;
        }
        labels[key] = value;
      }
    } catch {
      return null;
    }

    const env: Record<string, string> = {};
    for (const line of rawEnvironment.split(/\r?\n/u)) {
      if (!line) {
        continue;
      }
      const separatorIndex = line.indexOf('=');
      if (separatorIndex <= 0) {
        return null;
      }
      const key = line.slice(0, separatorIndex);
      if (Object.prototype.hasOwnProperty.call(env, key)) {
        return null;
      }
      env[key] = line.slice(separatorIndex + 1);
    }

    const mounts = rawMountRecords.map((rawMount) => {
      const mount =
        rawMount && typeof rawMount === 'object' && !Array.isArray(rawMount)
          ? (rawMount as Record<string, unknown>)
          : {};
      return {
        destination:
          typeof mount.Destination === 'string' ? mount.Destination : undefined,
        name: typeof mount.Name === 'string' ? mount.Name : undefined,
        readWrite: typeof mount.RW === 'boolean' ? mount.RW : undefined,
        type: typeof mount.Type === 'string' ? mount.Type : undefined,
      };
    });

    return {
      containerId: inspectedContainerId,
      name,
      running: runningValue === 'true',
      labels,
      env,
      mounts,
    };
  };

  private readonly isSameUnhealthyContainerObservation = (
    expected: IPersistentlyUnhealthyContainer,
    current: IPersistentlyUnhealthyContainer
  ): boolean => {
    const exactProcessObservation =
      expected.healthStatus !== 'starting' &&
      current.startedAt === expected.startedAt &&
      current.restartCount === expected.restartCount;
    /*
     * A fast crash loop changes StartedAt and RestartCount on every observation.
     * Requiring those volatile fields to remain byte-identical lets a container
     * restart forever inside Docker's start period. Conversely, Docker retains
     * historical RestartCount for a stable process, so equality would turn an
     * old container's ordinary cold boot into a false crash loop. Container
     * Created is immutable: accept only real RestartCount or StartedAt progress
     * for that exact container/runtime generation.
     */
    const expectedStartedAtMs = Date.parse(expected.startedAt ?? '');
    const currentStartedAtMs = Date.parse(current.startedAt ?? '');
    const startingRestartProgressed =
      (Number.isSafeInteger(expected.restartCount) &&
        Number.isSafeInteger(current.restartCount) &&
        Number(current.restartCount) > Number(expected.restartCount)) ||
      (Number.isFinite(expectedStartedAtMs) &&
        Number.isFinite(currentStartedAtMs) &&
        currentStartedAtMs > expectedStartedAtMs);
    const samePersistentStartingCrashLoop =
      expected.healthStatus === 'starting' &&
      current.healthStatus === 'starting' &&
      Boolean(expected.createdAt) &&
      current.createdAt === expected.createdAt &&
      Number.isSafeInteger(expected.restartCount) &&
      Number(expected.restartCount) >= 1 &&
      Number.isSafeInteger(current.restartCount) &&
      Number(current.restartCount) >= Number(expected.restartCount) &&
      startingRestartProgressed;

    return (
      current.running === expected.running &&
      this.isPersistentLivenessFailure(current) &&
      current.containerId === expected.containerId &&
      current.name === expected.name &&
      current.workerId === expected.workerId &&
      current.accountId === expected.accountId &&
      current.serverId === expected.serverId &&
      current.workerTypeId === expected.workerTypeId &&
      current.runtimeGeneration === expected.runtimeGeneration &&
      (exactProcessObservation || samePersistentStartingCrashLoop) &&
      current.paused === expected.paused &&
      current.isWarmStandby === expected.isWarmStandby &&
      current.warmPoolId === expected.warmPoolId
    );
  };

  private readonly isPersistentLivenessFailure = (
    container: IPersistentlyUnhealthyContainer
  ): boolean => {
    if (!container.running) {
      return true;
    }
    if (container.paused || container.healthStatus === 'unhealthy') {
      return true;
    }
    if (
      container.healthStatus !== 'starting' ||
      !Number.isSafeInteger(container.restartCount) ||
      Number(container.restartCount) < 1 ||
      !container.startedAt
    ) {
      return false;
    }

    const lifetimeAnchor = container.createdAt ?? container.startedAt;
    const startedAtMs = Date.parse(lifetimeAnchor);
    return (
      Number.isFinite(startedAtMs) &&
      Date.now() - startedAtMs >= WORKER_CONTAINER_STARTING_FAILURE_MIN_AGE_MS
    );
  };

  private readonly livenessCooldownKey = (
    workerId: string,
    containerId: string
  ): string => `underchat:worker:liveness-recreate:${workerId}:${containerId}`;

  private readonly releaseLivenessCooldown = async (
    key: string,
    owner: string
  ): Promise<void> => {
    await this.redis.eval(
      `
        if redis.call("GET", KEYS[1]) == ARGV[1] then
          return redis.call("DEL", KEYS[1])
        end
        return 0
      `,
      1,
      key,
      owner
    );
  };

  private readonly tryClaimLivenessCooldown = async (
    workerId: string,
    containerId: string,
    context: ILockLeaseContext
  ): Promise<{ key: string; owner: string } | null> => {
    const key = this.livenessCooldownKey(workerId, containerId);
    const owner = uuidv7();
    const ttlMs = WORKER_LIVENESS_RECREATE_COOLDOWN_SECONDS * 1_000;
    context.assertActive();
    let claimed = await this.redis.set(
      key,
      owner,
      'EX',
      WORKER_LIVENESS_RECREATE_COOLDOWN_SECONDS,
      'NX'
    );

    try {
      context.assertActive();
    } catch (error) {
      if (claimed === 'OK') {
        await this.releaseLivenessCooldown(key, owner).catch(() => undefined);
      }
      throw error;
    }

    if (claimed !== 'OK') {
      const redisWithIntrospection = this.redis as Redis & {
        get?: (redisKey: string) => Promise<string | null>;
        pttl?: (redisKey: string) => Promise<number>;
      };
      if (
        typeof redisWithIntrospection.get === 'function' &&
        typeof redisWithIntrospection.pttl === 'function'
      ) {
        const [existingOwner, remainingTtlMs] = await Promise.all([
          redisWithIntrospection.get(key),
          redisWithIntrospection.pttl(key),
        ]);
        const oldEnough =
          remainingTtlMs === -2 ||
          (remainingTtlMs > 0 &&
            remainingTtlMs <= ttlMs - WORKER_LIVENESS_COOLDOWN_STALE_GRACE_MS);
        if (existingOwner && oldEnough) {
          const current = await this.executeFenced(context, () =>
            this.workerService.viewWorkerForMonitorConsistent(workerId)
          );
          const terminalExactRuntime =
            current &&
            !current.deleted_at &&
            current.worker_status_id === EWorkerStatus.online &&
            !current.lifecycle_operation_id &&
            current.container_id?.trim().toLowerCase() === containerId &&
            current.runtime_container_id?.trim().toLowerCase() === containerId;
          if (terminalExactRuntime) {
            await this.releaseLivenessCooldown(key, existingOwner);
            context.assertActive();
            claimed = await this.redis.set(
              key,
              owner,
              'EX',
              WORKER_LIVENESS_RECREATE_COOLDOWN_SECONDS,
              'NX'
            );
            context.assertActive();
          }
        }
      }
    }

    return claimed === 'OK' ? { key, owner } : null;
  };

  private readonly isCompleteLivenessLifecycleMessage = (
    payload: IWorkerLifecycleQueueMessage,
    worker: IWorkerMonitor
  ): boolean => {
    const expectedContainerId = payload.expected_container_id
      ?.trim()
      .toLowerCase();
    const expectedStartedAt = payload.expected_container_started_at?.trim();
    const expectedRestartCount = payload.expected_container_restart_count;
    const expectedHealthStatus = payload.expected_container_health_status
      ?.trim()
      .toLowerCase();
    const expectedPaused = payload.expected_container_paused;
    const expectedRuntimeGeneration = payload.expected_runtime_generation;
    const controlContainerId = worker.container_id?.trim().toLowerCase();
    const runtimeContainerId = worker.runtime_container_id
      ?.trim()
      .toLowerCase();
    const runtimeGeneration = worker.runtime_generation;
    const livenessState =
      expectedPaused === true ||
      expectedHealthStatus === 'unhealthy' ||
      (expectedHealthStatus === 'starting' &&
        typeof expectedRestartCount === 'number' &&
        expectedRestartCount >= 1);
    const exactOriginalRuntime =
      runtimeContainerId === expectedContainerId &&
      runtimeGeneration === expectedRuntimeGeneration;
    /*
     * A crash after the command handler created its replacement but before the
     * terminal worker CAS leaves container_id on the observed runtime while
     * runtime_container_id/runtime_generation already identify the replacement.
     * Only a different, syntactically valid container at a strictly newer
     * generation is a candidate for the handler's label-fenced reconciliation.
     */
    const ownedReplacementCandidate =
      Boolean(runtimeContainerId) &&
      CONTAINER_ID_PATTERN.test(runtimeContainerId ?? '') &&
      runtimeContainerId !== expectedContainerId &&
      typeof runtimeGeneration === 'number' &&
      Number.isSafeInteger(runtimeGeneration) &&
      typeof expectedRuntimeGeneration === 'number' &&
      runtimeGeneration > expectedRuntimeGeneration;

    return (
      payload.action === 'recreate' &&
      payload.source === 'worker_recreate' &&
      payload.operation_id === worker.lifecycle_operation_id &&
      payload.worker_id === worker.worker_id &&
      payload.account_id === worker.account_id &&
      payload.server_id === worker.server_id &&
      payload.worker_type_id === worker.worker_type_id &&
      Boolean(payload.requested_at) &&
      Number.isFinite(Date.parse(payload.requested_at)) &&
      (worker.worker_status_id === EWorkerStatus.recreating ||
        worker.worker_status_id === EWorkerStatus.online) &&
      Boolean(expectedContainerId) &&
      CONTAINER_ID_PATTERN.test(expectedContainerId ?? '') &&
      controlContainerId === expectedContainerId &&
      Boolean(expectedStartedAt) &&
      Number.isFinite(Date.parse(expectedStartedAt ?? '')) &&
      typeof expectedRestartCount === 'number' &&
      Number.isSafeInteger(expectedRestartCount) &&
      expectedRestartCount >= 0 &&
      ['unhealthy', 'healthy', 'starting', 'none'].includes(
        expectedHealthStatus ?? ''
      ) &&
      typeof expectedPaused === 'boolean' &&
      livenessState &&
      typeof expectedRuntimeGeneration === 'number' &&
      Number.isSafeInteger(expectedRuntimeGeneration) &&
      expectedRuntimeGeneration > 0 &&
      (exactOriginalRuntime || ownedReplacementCandidate)
    );
  };

  private readonly isValidLifecyclePrimaryForRedrive = (
    payload: IWorkerLifecycleQueueMessage,
    worker: IWorkerMonitor
  ): boolean => {
    const isPendingPostgresProviderHandoff =
      payload.action === 'recreate' &&
      payload.source === 'worker_update' &&
      worker.worker_status_id === EWorkerStatus.recreating &&
      worker.session_storage === EWorkerSessionStorage.postgres &&
      payload.session_storage === EWorkerSessionStorage.postgres &&
      payload.remove_session === false &&
      payload.remove_volume === false &&
      payload.cleanup_previous_runtime_required === true &&
      payload.previous_worker_type_id === worker.worker_type_id &&
      payload.worker_type_id !== worker.worker_type_id &&
      supportsWhatsappSessionStorage(payload.previous_worker_type_id) &&
      supportsWhatsappSessionStorage(payload.worker_type_id);
    if (
      payload.action === 'cleanup_previous_runtime' ||
      payload.operation_id !== worker.lifecycle_operation_id ||
      payload.worker_id !== worker.worker_id ||
      payload.account_id !== worker.account_id ||
      payload.server_id !== worker.server_id ||
      (payload.worker_type_id !== worker.worker_type_id &&
        !isPendingPostgresProviderHandoff) ||
      !this.isOlderThan(
        payload.requested_at,
        WORKER_LIVENESS_LIFECYCLE_REDRIVE_AFTER_MS
      ) ||
      !WORKER_LIFECYCLE_ACTION_SOURCES[payload.action].has(payload.source)
    ) {
      return false;
    }

    const declaredStatusMatchesAction =
      (payload.action === 'create' &&
        payload.worker_status_id === EWorkerStatus.creating) ||
      (payload.action === 'recreate' &&
        payload.worker_status_id === EWorkerStatus.recreating) ||
      (payload.action === 'activate_warm' &&
        (payload.worker_status_id === EWorkerStatus.creating ||
          payload.worker_status_id === EWorkerStatus.recreating)) ||
      (payload.action === 'delete' &&
        payload.worker_status_id === EWorkerStatus.deleting);
    if (!declaredStatusMatchesAction) {
      return false;
    }

    if (worker.worker_status_id === EWorkerStatus.online) {
      /*
       * Provider online notification can win the race before the lifecycle
       * handler clears operation_id. Replaying the exact prepared operation
       * lets the idempotent command handler finish that terminal CAS. Strict
       * liveness messages retain their additional runtime identity checks.
       */
      return payload.expected_container_id
        ? this.isCompleteLivenessLifecycleMessage(payload, worker)
        : payload.action === 'create' ||
            payload.action === 'recreate' ||
            payload.action === 'activate_warm';
    }
    if (worker.worker_status_id === EWorkerStatus.error) {
      /*
       * Legacy compensation could leave an exact durable operation in error.
       * Replaying that exact fenced primary is safer than clearing its claim.
       */
      return true;
    }
    if (worker.worker_status_id === EWorkerStatus.creating) {
      return payload.action === 'create' || payload.action === 'activate_warm';
    }
    if (worker.worker_status_id === EWorkerStatus.recreating) {
      return (
        payload.action === 'recreate' || payload.action === 'activate_warm'
      );
    }
    return (
      worker.worker_status_id === EWorkerStatus.deleting &&
      payload.action === 'delete'
    );
  };

  private readonly validateLifecycleJournalForFastRedrive = (
    prepared: IWorkerLifecycleQueueMessage[],
    worker: IWorkerMonitor
  ): IWorkerLifecycleQueueMessage | null => {
    const primary = prepared.filter(
      (payload) => payload.action !== 'cleanup_previous_runtime'
    );
    const cleanup = prepared.filter(
      (payload) => payload.action === 'cleanup_previous_runtime'
    );

    if (primary.length === 0) {
      const standaloneCleanup = cleanup[0];
      if (
        cleanup.length !== 1 ||
        !standaloneCleanup ||
        standaloneCleanup.source !== 'plan_limit_enforcement' ||
        standaloneCleanup.worker_status_id !== EWorkerStatus.blocked ||
        worker.worker_status_id !== EWorkerStatus.blocked ||
        standaloneCleanup.operation_id !== worker.lifecycle_operation_id ||
        standaloneCleanup.worker_id !== worker.worker_id ||
        standaloneCleanup.account_id !== worker.account_id ||
        standaloneCleanup.server_id !== worker.server_id ||
        standaloneCleanup.worker_type_id !== worker.worker_type_id ||
        standaloneCleanup.previous_server_id !== worker.server_id ||
        standaloneCleanup.previous_worker_type_id !== worker.worker_type_id ||
        !this.isOlderThan(
          standaloneCleanup.requested_at,
          WORKER_LIVENESS_LIFECYCLE_REDRIVE_AFTER_MS
        )
      ) {
        return null;
      }
      return standaloneCleanup;
    }

    const authoritativePrimary = primary[0];
    if (
      primary.length !== 1 ||
      !authoritativePrimary ||
      !this.isValidLifecyclePrimaryForRedrive(authoritativePrimary, worker) ||
      cleanup.length > 1
    ) {
      return null;
    }

    const cleanupMessage = cleanup[0];
    const isPendingPostgresProviderHandoff =
      authoritativePrimary.worker_type_id !== worker.worker_type_id;
    if (
      (isPendingPostgresProviderHandoff && !cleanupMessage) ||
      (cleanupMessage &&
        (authoritativePrimary.source !== 'worker_update' ||
          cleanupMessage.source !== 'worker_update' ||
          cleanupMessage.operation_id !== authoritativePrimary.operation_id ||
          cleanupMessage.worker_id !== authoritativePrimary.worker_id ||
          cleanupMessage.account_id !== authoritativePrimary.account_id ||
          cleanupMessage.server_id !==
            authoritativePrimary.previous_server_id ||
          cleanupMessage.worker_type_id !==
            authoritativePrimary.previous_worker_type_id ||
          cleanupMessage.previous_server_id !==
            authoritativePrimary.previous_server_id ||
          cleanupMessage.previous_worker_type_id !==
            authoritativePrimary.previous_worker_type_id ||
          cleanupMessage.session_storage !==
            authoritativePrimary.session_storage ||
          cleanupMessage.remove_session !==
            authoritativePrimary.remove_session ||
          cleanupMessage.remove_volume !== authoritativePrimary.remove_volume ||
          cleanupMessage.worker_status_id !== EWorkerStatus.recreating ||
          !this.isOlderThan(
            cleanupMessage.requested_at,
            WORKER_LIVENESS_LIFECYCLE_REDRIVE_AFTER_MS
          )))
    ) {
      return null;
    }

    return authoritativePrimary;
  };

  private readonly reconcileStaleWhatsappProviderHandoffTarget = async (
    worker: IWorkerMonitor,
    context: ILockLeaseContext
  ): Promise<boolean> => {
    if (
      worker.worker_status_id !== EWorkerStatus.recreating ||
      worker.session_storage !== EWorkerSessionStorage.postgres ||
      !worker.lifecycle_operation_id
    ) {
      return false;
    }
    if (
      typeof this.workerService.failStaleWhatsappProviderHandoffTarget !==
      'function'
    ) {
      throw new Error(
        'stale_whatsapp_handoff_reconciliation_service_unavailable'
      );
    }

    const reconciliation = await this.executeFenced(context, () =>
      this.workerService.failStaleWhatsappProviderHandoffTarget({
        worker_id: worker.worker_id,
        account_id: worker.account_id,
        lifecycle_operation_id: worker.lifecycle_operation_id as string,
      })
    );
    if (reconciliation.outcome === 'not_applicable') {
      return false;
    }

    logLocalConnectionStatus(
      reconciliation.outcome === 'failed'
        ? 'service.monitor.whatsapp_handoff_stale_target_failed'
        : 'service.monitor.whatsapp_handoff_stale_target_recovery_owned',
      {
        layer: 'service.monitor',
        worker_id: worker.worker_id,
        account_id: worker.account_id,
        worker_type_id: worker.worker_type_id,
        lifecycle_operation_id: worker.lifecycle_operation_id,
        server_id: worker.server_id,
        handoff_id: reconciliation.handoff_id ?? undefined,
        recovery_operation_id:
          reconciliation.recovery_operation_id ?? undefined,
        recovery_state: reconciliation.recovery_state ?? undefined,
        error_code: reconciliation.error_code ?? undefined,
      }
    );
    return true;
  };

  private readonly suppressTerminalWhatsappProviderHandoffRedrive = async (
    worker: IWorkerMonitor,
    context: ILockLeaseContext
  ): Promise<boolean> => {
    if (
      (worker.worker_status_id !== EWorkerStatus.recreating &&
        worker.worker_status_id !== EWorkerStatus.error &&
        worker.worker_status_id !== EWorkerStatus.online) ||
      worker.session_storage !== EWorkerSessionStorage.postgres ||
      !worker.lifecycle_operation_id
    ) {
      return false;
    }
    if (
      typeof this.workerService
        .viewWhatsappProviderHandoffTerminalLifecycleProof !== 'function'
    ) {
      throw new Error(
        'whatsapp_handoff_terminal_lifecycle_service_unavailable'
      );
    }

    const proof = await this.executeFenced(context, () =>
      this.workerService.viewWhatsappProviderHandoffTerminalLifecycleProof({
        worker_id: worker.worker_id,
        account_id: worker.account_id,
        lifecycle_operation_id: worker.lifecycle_operation_id as string,
      })
    );
    if (!proof) {
      return false;
    }

    const completionPlan = planCompletedWhatsappProviderHandoffLifecycle(
      proof,
      worker
    );
    if (completionPlan) {
      const completed = await this.executeFenced(context, () =>
        this.workerService.updateWorkerByIdIfLifecycleMatches(
          completionPlan.accountId,
          {
            worker_id: worker.worker_id,
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
              mode: 'replacement_runtime_already_online' as const,
            },
          }
        )
      );
      const reconciled = await this.executeFenced(context, () =>
        this.workerService.viewWorkerForMonitorConsistent(worker.worker_id)
      );
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

      const state = buildManagerWorkerRecreateTerminalStatusEvent(
        {
          action: EWorkerAction.recreate,
          worker_id: worker.worker_id,
          account_id: completionPlan.accountId,
          server_id: completionPlan.serverId,
          worker_type_id: completionPlan.workerTypeId,
          lifecycle_operation_id: completionPlan.lifecycleOperationId,
          debug_trace_id: completionPlan.lifecycleOperationId,
        },
        completionPlan.runtimeGeneration,
        EWorkerStatus.online,
        reconciled.recreate_completed_at as string
      );
      await Promise.all([
        this.executeFenced(context, () =>
          this.centrifugoService.publishSub(
            workerCentrifugoQueue(completionPlan.accountId),
            state
          )
        ),
        this.executeFenced(context, () =>
          this.centrifugoService.publish(channelsConfigCentrifugo(), state)
        ),
      ]);
      logLocalConnectionStatus(
        'service.monitor.whatsapp_handoff_completed_lifecycle_reconciled',
        {
          layer: 'service.monitor',
          worker_id: worker.worker_id,
          account_id: completionPlan.accountId,
          worker_type_id: completionPlan.workerTypeId,
          lifecycle_operation_id: completionPlan.lifecycleOperationId,
          server_id: completionPlan.serverId,
          handoff_id: proof.handoff_id,
          runtime_generation: completionPlan.runtimeGeneration,
          already_completed: completed !== true,
        }
      );
      return true;
    }

    logLocalConnectionStatus(
      'service.monitor.whatsapp_handoff_terminal_redrive_suppressed',
      {
        layer: 'service.monitor',
        worker_id: worker.worker_id,
        account_id: worker.account_id,
        worker_type_id: worker.worker_type_id,
        lifecycle_operation_id: worker.lifecycle_operation_id,
        server_id: worker.server_id,
        handoff_id: proof.handoff_id,
        handoff_state: proof.handoff_state,
        error_code: proof.error_code ?? undefined,
        recovery_operation_id: proof.recovery_operation_id ?? undefined,
        recovery_state: proof.recovery_state,
        resolution_operation_id: proof.resolution_operation_id ?? undefined,
        resolution_state: proof.resolution_state ?? undefined,
        point_of_no_return_at: proof.point_of_no_return_at ?? undefined,
      }
    );
    return true;
  };

  private readonly redriveStalledLivenessLifecycle = async (
    snapshot: IWorkerMonitor,
    context: ILockLeaseContext
  ): Promise<void> => {
    const operationId = snapshot.lifecycle_operation_id;
    if (!operationId) {
      return;
    }

    const prepared = await this.executeFenced(context, () =>
      this.workerLifecycleQueueService.loadPrepared(
        snapshot.worker_id,
        operationId
      )
    );
    const preparedPrimary = this.validateLifecycleJournalForFastRedrive(
      prepared,
      snapshot
    );
    if (!preparedPrimary) {
      return;
    }

    const current = await this.executeFenced(context, () =>
      this.workerService.viewWorkerForMonitorConsistent(snapshot.worker_id)
    );
    if (
      !current ||
      current.deleted_at ||
      current.lifecycle_operation_id !== operationId ||
      current.account_id !== snapshot.account_id ||
      current.server_id !== snapshot.server_id ||
      current.worker_type_id !== snapshot.worker_type_id ||
      !this.validateLifecycleJournalForFastRedrive(prepared, current)
    ) {
      return;
    }

    if (
      await this.executeFenced(context, () =>
        this.workerLifecycleLockService.isLocked(current.worker_id)
      )
    ) {
      return;
    }

    if (
      await this.suppressTerminalWhatsappProviderHandoffRedrive(
        current,
        context
      )
    ) {
      return;
    }

    if (
      await this.reconcileStaleWhatsappProviderHandoffTarget(current, context)
    ) {
      return;
    }

    const isStrictLivenessRecovery = this.isCompleteLivenessLifecycleMessage(
      preparedPrimary,
      current
    );
    /*
     * This scan intentionally gives every durable lifecycle one early
     * recovery attempt. Only a recreate carrying the complete, exact Docker
     * liveness fence may keep the short retry claim. General lifecycle work
     * keeps the normal cooldown after that first publish, otherwise a blocked
     * Kafka partition accumulates another copy every 30-60 seconds behind the
     * very message that is preventing progress.
     */
    const redriveClaimTtlMs = isStrictLivenessRecovery
      ? WORKER_LIVENESS_LIFECYCLE_REDRIVE_CLAIM_MS
      : WORKER_LIFECYCLE_REDRIVE_COOLDOWN_MS;
    const claimed = await this.executeFenced(context, () =>
      this.workerLifecycleLockService.tryClaimRedrive(
        current.worker_id,
        operationId,
        redriveClaimTtlMs
      )
    );
    if (!claimed) {
      return;
    }
    const redriveClaimToken = typeof claimed === 'string' ? claimed : undefined;
    try {
      if (
        await this.suppressTerminalWhatsappProviderHandoffRedrive(
          current,
          context
        )
      ) {
        await this.workerLifecycleLockService
          .releaseRedriveClaim(
            current.worker_id,
            operationId,
            redriveClaimToken
          )
          .catch(() => undefined);
        return;
      }
      const redriven = await this.executeFenced(context, () =>
        redriveClaimToken
          ? this.workerLifecycleQueueService.redrivePrepared(
              current.worker_id,
              operationId,
              preparedPrimary.debug_trace_id,
              redriveClaimToken
            )
          : this.workerLifecycleQueueService.redrivePrepared(
              current.worker_id,
              operationId,
              preparedPrimary.debug_trace_id
            )
      );
      if (redriven.length === 0) {
        await this.workerLifecycleLockService
          .releaseRedriveClaim(
            current.worker_id,
            operationId,
            redriveClaimToken
          )
          .catch(() => undefined);
      }
      logLocalConnectionStatus('service.monitor.lifecycle_fast_redriven', {
        layer: 'service.monitor',
        worker_id: current.worker_id,
        account_id: current.account_id,
        worker_type_id: current.worker_type_id,
        lifecycle_operation_id: operationId,
        server_id: current.server_id,
        action: preparedPrimary.action,
        source: preparedPrimary.source,
        container_id: preparedPrimary.expected_container_id,
        recovery_class: isStrictLivenessRecovery
          ? 'strict_liveness'
          : 'general_lifecycle',
        redrive_cooldown_ms: redriveClaimTtlMs,
        recovered_messages: redriven.length,
      });
    } catch (error) {
      await this.workerLifecycleLockService
        .releaseRedriveClaim(current.worker_id, operationId, redriveClaimToken)
        .catch(() => undefined);
      throw error;
    }
  };

  private readonly redriveStalledLivenessLifecycles = async (
    context: ILockLeaseContext
  ): Promise<void> => {
    let scanned = 0;
    while (scanned < WORKER_LIVENESS_REDRIVE_MAX_SCAN_PER_CYCLE) {
      let candidates: IWorkerMonitor[];
      try {
        candidates = await this.executeFenced(context, () =>
          this.workerService.listLivenessLifecycleRedriveCandidates(
            WORKER_LIVENESS_REDRIVE_BATCH_SIZE,
            this.livenessRedriveCursor
          )
        );
      } catch (error) {
        context.assertActive();
        logLocalConnectionStatus(
          'service.monitor.lifecycle_fast_redrive_scan_failed',
          {
            layer: 'service.monitor',
            cursor: this.livenessRedriveCursor,
            reason: error instanceof Error ? error.message : String(error),
          }
        );
        return;
      }

      if (!candidates.length) {
        this.livenessRedriveCursor = undefined;
        return;
      }
      scanned += candidates.length;
      this.livenessRedriveCursor = candidates[candidates.length - 1]?.worker_id;

      await mapConcurrent(
        candidates,
        WORKER_LIVENESS_REDRIVE_CONCURRENCY,
        async (candidate) => {
          try {
            await this.redriveStalledLivenessLifecycle(candidate, context);
          } catch (error) {
            context.assertActive();
            logLocalConnectionStatus(
              'service.monitor.lifecycle_fast_redrive_failed',
              {
                layer: 'service.monitor',
                worker_id: candidate.worker_id,
                account_id: candidate.account_id,
                worker_type_id: candidate.worker_type_id,
                lifecycle_operation_id:
                  candidate.lifecycle_operation_id ?? undefined,
                server_id: candidate.server_id,
                reason: error instanceof Error ? error.message : String(error),
              }
            );
          }
        }
      );
      context.assertActive();
      if (candidates.length < WORKER_LIVENESS_REDRIVE_BATCH_SIZE) {
        this.livenessRedriveCursor = undefined;
        return;
      }
    }
  };

  private readonly validatePersistentlyUnhealthyContainer = async (
    container: IPersistentlyUnhealthyContainer,
    server: IBalanceMonitorServer,
    context: ILockLeaseContext
  ): Promise<IValidatedLivenessCandidate | null> => {
    const current = await this.executeFenced(context, () =>
      this.workerService.viewWorkerForMonitorConsistent(container.name)
    );
    const validStatus = container.running
      ? current?.worker_status_id === EWorkerStatus.online
      : Boolean(
          current?.worker_status_id &&
          [
            EWorkerStatus.online,
            EWorkerStatus.offline,
            EWorkerStatus.disponible,
            EWorkerStatus.mismatched,
            EWorkerStatus.error,
          ].includes(current.worker_status_id)
        );
    if (
      !current ||
      current.deleted_at ||
      current.worker_id !== container.name ||
      current.server_id !== server.server_id ||
      !validStatus ||
      current.lifecycle_operation_id ||
      current.container_id?.trim().toLowerCase() !== container.containerId ||
      current.runtime_container_id?.trim().toLowerCase() !==
        container.containerId ||
      !Number.isSafeInteger(current.runtime_generation) ||
      Number(current.runtime_generation) <= 0 ||
      container.workerId !== current.worker_id ||
      container.accountId !== current.account_id ||
      container.serverId !== current.server_id ||
      container.workerTypeId !== current.worker_type_id ||
      container.runtimeGeneration !== current.runtime_generation
    ) {
      logLocalConnectionStatus(
        'service.monitor.liveness_recreate_skipped_identity_changed',
        {
          layer: 'service.monitor',
          worker_id: container.workerId ?? container.name,
          account_id: container.accountId,
          server_id: server.server_id,
          observed_container_id: container.containerId,
          current_container_id: current?.container_id ?? undefined,
          runtime_container_id: current?.runtime_container_id ?? undefined,
          observed_runtime_generation: container.runtimeGeneration,
          current_runtime_generation: current?.runtime_generation ?? undefined,
          current_worker_status_id: current?.worker_status_id,
          lifecycle_operation_id: current?.lifecycle_operation_id ?? undefined,
        }
      );
      return null;
    }

    const planStatus = await this.executeFenced(context, () =>
      this.accountService.viewPlanStatus(current.account_id)
    );
    if (this.isPlanCancelled(planStatus)) {
      return null;
    }

    return { worker: current, container };
  };

  private readonly requestPersistentlyUnhealthyRecreate = async (
    current: IWorkerMonitor,
    container: IPersistentlyUnhealthyContainer,
    server: IBalanceMonitorServer,
    context: ILockLeaseContext
  ): Promise<void> => {
    if (!container.running) {
      const latest = (
        await this.inspectExactContainers(
          server,
          [container.containerId],
          context
        )
      ).find((item) => item.containerId === container.containerId);
      if (
        !latest ||
        latest.running ||
        !this.isSameUnhealthyContainerObservation(container, latest)
      ) {
        return;
      }
      await this.applyCanonicalStoppedStatus(
        current,
        'container_not_running',
        context
      );
      return;
    }

    const cooldown = await this.tryClaimLivenessCooldown(
      current.worker_id,
      container.containerId,
      context
    );
    if (!cooldown) {
      logLocalConnectionStatus(
        'service.monitor.liveness_recreate_suppressed_by_cooldown',
        {
          layer: 'service.monitor',
          worker_id: current.worker_id,
          account_id: current.account_id,
          server_id: current.server_id,
          container_id: container.containerId,
        }
      );
      return;
    }
    try {
      const latest = (
        await this.inspectExactContainers(
          server,
          [container.containerId],
          context
        )
      ).find((item) => item.containerId === container.containerId);
      if (
        !latest ||
        !this.isSameUnhealthyContainerObservation(container, latest)
      ) {
        await this.releaseLivenessCooldown(cooldown.key, cooldown.owner).catch(
          () => undefined
        );
        logLocalConnectionStatus(
          'service.monitor.liveness_recreate_skipped_recovered',
          {
            layer: 'service.monitor',
            worker_id: current.worker_id,
            account_id: current.account_id,
            server_id: current.server_id,
            container_id: container.containerId,
            reason: 'pre_claim_identity_changed',
          }
        );
        return;
      }
      await this.handleRecreate(
        current,
        server,
        'container_unhealthy',
        context,
        latest,
        cooldown.owner
      );
      const afterRequest = await this.executeFenced(context, () =>
        this.workerService.viewWorkerForMonitorConsistent(current.worker_id)
      );
      if (afterRequest?.lifecycle_operation_id !== cooldown.owner) {
        await this.releaseLivenessCooldown(cooldown.key, cooldown.owner).catch(
          () => undefined
        );
      }
    } catch (error) {
      await this.releaseLivenessCooldown(cooldown.key, cooldown.owner).catch(
        () => undefined
      );
      throw error;
    }
  };

  private readonly parseRunningContainerLine = (
    line: string
  ): IRunningWorkerContainer | null => {
    const trimmed = line.trim();
    if (!trimmed) {
      return null;
    }

    const [rawName, rawWarmStandby, rawWarmPoolId] = trimmed.split('|');
    const name = rawName?.trim();
    if (!name) {
      return null;
    }

    const warmStandby = rawWarmStandby?.trim().toLowerCase() === 'true';
    const warmPoolId = rawWarmPoolId?.trim();
    const isActivatedWorkerName = WORKER_ID_PATTERN.test(name);
    const isWarmStandby =
      name.startsWith('warm-') ||
      (!isActivatedWorkerName && (warmStandby || !!warmPoolId));

    return {
      name,
      isWarmStandby,
      warmPoolId: warmPoolId || undefined,
    };
  };

  private readonly listContainers = async (
    serverId: string,
    sshConfig: ConnectConfig,
    context: ILockLeaseContext = UNFENCED_LOCK_LEASE_CONTEXT
  ): Promise<string[]> => {
    const command = `docker ps --format '{{.Names}}|{{.Label "underchat.warm_standby"}}|{{.Label "underchat.warm_pool_id"}}'`;
    const outputs = await this.runSshFenced(
      context,
      serverId,
      sshConfig,
      [command],
      { failOnNonZero: true }
    );

    /*
     * SshService emits one result per arbitrary stream data chunk, not per
     * logical line. Adding a newline between chunks can split a UUID (for
     * example `019db6` + the remainder) and previously made PostgreSQL reject
     * it as an invalid uuid, aborting the complete monitor pass.
     */
    const combined = outputs
      .map((item) => item.output)
      .join('')
      .trim();
    const list = combined
      .split('\n')
      .map((line) => this.parseRunningContainerLine(line))
      .filter(
        (container): container is IRunningWorkerContainer =>
          !!container &&
          !container.isWarmStandby &&
          WORKER_ID_PATTERN.test(container.name)
      )
      .map((container) => container.name);
    const result = list.filter((name) => !!name);
    return result;
  };

  private readonly isContainerNotFoundError = (
    error: unknown,
    expectedContainerId: string
  ): boolean => {
    const record =
      error && typeof error === 'object'
        ? (error as { causeError?: unknown; output?: unknown })
        : null;
    const cause =
      record?.causeError && typeof record.causeError === 'object'
        ? (record.causeError as { output?: unknown })
        : record;
    const output = typeof cause?.output === 'string' ? cause.output : '';
    const escapedExpected = expectedContainerId.replace(
      /[.*+?^${}()|[\]\\]/gu,
      '\\$&'
    );

    return new RegExp(
      `(?:^|\\n)(?:(?:Error response from daemon|Error): )?No such (?:object|container):? ${escapedExpected}(?:\\r?$|\\n)`,
      'iu'
    ).test(output);
  };

  private readonly confirmContainerMissing = async (
    workerId: string,
    serverId: string,
    sshConfig: ConnectConfig,
    context: ILockLeaseContext
  ): Promise<boolean> => {
    const command = `docker inspect --type=container --format '{{.State.Status}}|{{.Name}}' ${workerId}`;
    try {
      const outputs = await this.runSshFenced(
        context,
        serverId,
        sshConfig,
        [command],
        {
          failOnNonZero: true,
        }
      );
      const state = outputs
        .map((item) => item.output)
        .join('')
        .trim()
        .split('|')[0]
        ?.trim()
        .toLowerCase();
      return state === 'exited' || state === 'dead' || state === 'created';
    } catch (error) {
      context.assertActive();
      if (this.isContainerNotFoundError(error, workerId)) {
        return true;
      }

      logLocalConnectionStatus(
        'service.monitor.container_missing_confirmation_failed',
        {
          layer: 'service.monitor',
          worker_id: workerId,
          server_id: serverId,
          reason: error instanceof Error ? error.message : String(error),
        }
      );
      return false;
    }
  };

  private readonly checkFastify = async (
    workerId: string,
    serverId: string,
    sshConfig: ConnectConfig,
    context: ILockLeaseContext = UNFENCED_LOCK_LEASE_CONTEXT
  ): Promise<boolean> => {
    const command = String.raw`timeout --signal=KILL 8s docker exec ${workerId} curl -sS --connect-timeout 2 --max-time 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:3005/v1/health/check`;

    const outputs = await this.runSshFenced(context, serverId, sshConfig, [
      command,
    ]);

    const code = this.parseHttpCode(outputs.map((r) => r.output).join(''));
    const healthy = code === 200;
    return healthy;
  };

  private readonly checkConnection = async (
    worker: IWorkerMonitor,
    serverId: string,
    sshConfig: ConnectConfig,
    context: ILockLeaseContext = UNFENCED_LOCK_LEASE_CONTEXT
  ): Promise<IConnectionHealthCheckResult> => {
    const workerId = worker.worker_id;
    const command = String.raw`timeout --signal=KILL 8s docker exec ${workerId} curl -sS --connect-timeout 2 --max-time 5 -w '__HTTP_STATUS__%{http_code}' http://127.0.0.1:3005/v1/connection/health/check`;

    try {
      const outputs = await this.runSshFenced(context, serverId, sshConfig, [
        command,
      ]);

      const rawOutput = outputs.map((r) => r.output).join('');
      const health = this.parseHttpResponse(rawOutput);
      const code = health.code;
      const healthy =
        code === 200 && this.hasSessionReadyBody(health.body, worker);
      const result = this.buildConnectionHealthCheckResult(
        healthy,
        code,
        health.body,
        worker.worker_type_id
      );
      logLocalConnectionStatus('service.monitor.connection_health_http', {
        layer: 'service.monitor',
        worker_id: worker.worker_id,
        account_id: worker.account_id,
        worker_type_id: worker.worker_type_id,
        worker_status_id: worker.worker_status_id,
        status_code: code,
        connection_healthy: result.healthy,
        session_ready: result.session_ready,
        connected: result.connected,
        can_send: result.can_send,
        can_receive_runtime: result.can_receive_runtime,
        authenticated: result.authenticated,
        provider_state: result.provider_state,
        degraded_reason: result.degraded_reason,
        last_probe_at: result.last_probe_at,
        probe_latency_ms: result.probe_latency_ms,
        phone: result.phone,
        kafka_consumers_ready: result.kafka_consumers_ready,
        kafka_consumers_authorized: result.kafka_consumers_authorized,
        runtime_health_schema_version: result.runtime_health_schema_version,
        health_worker_id: result.worker_id,
        health_account_id: result.account_id,
        health_worker_type_id: result.worker_type_id,
        runtime_state: result.runtime_state,
        activated: result.activated,
        standby: result.standby,
        has_session: result.has_session,
        qr_stream_ready: result.qr_stream_ready,
        central_online_acknowledged: result.central_online_acknowledged,
        session_storage: result.session_storage,
        native_connection_online: result.native_connection_online,
        connection_status: result.connection_status?.status,
        connection_status_source_id: result.connection_status_source_id,
        connection_status_source_current:
          result.connection_status_source_current,
        connection_status_lease_required:
          result.connection_status_lease_required,
        connection_status_lease_proof_valid:
          result.connection_status_lease_proof_valid,
        kafka_unhealthy: result.kafka_unhealthy,
      });
      return result;
    } catch (error) {
      context.assertActive();
      logLocalConnectionStatus('service.monitor.connection_health_error', {
        layer: 'service.monitor',
        worker_id: worker.worker_id,
        account_id: worker.account_id,
        worker_type_id: worker.worker_type_id,
        worker_status_id: worker.worker_status_id,
        reason: error instanceof Error ? error.message : String(error),
      });
      return {
        healthy: false,
        code: null,
        body: null,
        connection_status_present: false,
        connection_status_source_present: false,
        kafka_unhealthy: false,
        degraded_reason: error instanceof Error ? error.message : String(error),
      };
    }
  };

  private readonly parseHttpCode = (raw: string): number | null => {
    const trimmed = raw.trim();
    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric)) {
      return null;
    }

    return numeric;
  };

  private readonly parseHttpResponse = (
    raw: string
  ): { code: number | null; body: unknown } => {
    const marker = '__HTTP_STATUS__';
    const markerIndex = raw.lastIndexOf(marker);
    if (markerIndex < 0) {
      return {
        code: this.parseHttpCode(raw),
        body: null,
      };
    }

    const bodyRaw = raw.slice(0, markerIndex).trim();
    const code = this.parseHttpCode(raw.slice(markerIndex + marker.length));
    return {
      code,
      body: this.parseJsonBody(bodyRaw),
    };
  };

  private readonly parseJsonBody = (raw: string): unknown => {
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  };

  private readonly hasSessionReadyBody = (
    body: unknown,
    worker: Pick<IWorkerMonitor, 'worker_type_id' | 'session_storage'>
  ): boolean => {
    const payload = this.getConnectionHealthPayload(body);
    if (!payload || typeof payload !== 'object') {
      return false;
    }

    const record = payload as {
      session_ready?: unknown;
      connected?: unknown;
      can_send?: unknown;
      can_receive_runtime?: unknown;
      authenticated?: unknown;
      kafka_unhealthy?: unknown;
      kafka_consumers_ready?: unknown;
      kafka_consumers_authorized?: unknown;
      runtime_health_schema_version?: unknown;
      central_online_acknowledged?: unknown;
      session_storage?: unknown;
      native_connection_online?: unknown;
      connection_status?: unknown;
      connection_status_source_id?: unknown;
      connection_status_source_current?: unknown;
      connection_status_lease_required?: unknown;
      connection_status_lease_proof_valid?: unknown;
      phone?: unknown;
    };

    const expectedProvider = this.expectedWhatsappConnectionStatusProvider(
      worker.worker_type_id
    );
    const nativeStatus = expectedProvider
      ? normalizeWhatsappConnectionStatus(
          record.connection_status,
          expectedProvider
        )
      : undefined;
    const sourceId = normalizeWhatsappConnectionStatusSourceId(
      record.connection_status_source_id
    );
    const sessionStorage =
      record.session_storage === EWorkerSessionStorage.postgres ||
      record.session_storage === EWorkerSessionStorage.legacy_volume
        ? record.session_storage
        : undefined;
    const expectedSessionStorage = worker.session_storage;
    const leaseRequired = sessionStorage === EWorkerSessionStorage.postgres;

    // Telegram/Discord are monitored by this same service but do not expose
    // the WhatsApp-native envelope. Preserve their existing readiness
    // contract; schema v3 is mandatory only for the three WhatsApp providers
    // covered by this integration.
    if (!expectedProvider) {
      const requiresDispatchAuthorization =
        typeof record.runtime_health_schema_version === 'number' &&
        record.runtime_health_schema_version >= 2;
      return (
        record.session_ready === true &&
        record.connected === true &&
        record.can_send === true &&
        record.can_receive_runtime === true &&
        record.authenticated === true &&
        (!requiresDispatchAuthorization ||
          (record.kafka_consumers_ready === true &&
            record.kafka_consumers_authorized === true &&
            record.central_online_acknowledged === true)) &&
        typeof record.phone === 'string' &&
        record.phone.trim().length > 0 &&
        record.kafka_unhealthy !== true
      );
    }

    return (
      typeof record.runtime_health_schema_version === 'number' &&
      record.runtime_health_schema_version >= 3 &&
      sessionStorage !== undefined &&
      expectedSessionStorage !== undefined &&
      sessionStorage === expectedSessionStorage &&
      isWhatsappConnectionOnline(nativeStatus) &&
      record.native_connection_online === true &&
      sourceId !== undefined &&
      record.connection_status_source_current === true &&
      record.connection_status_lease_required === leaseRequired &&
      record.connection_status_lease_proof_valid === true &&
      record.session_ready === true &&
      record.connected === true &&
      record.can_send === true &&
      record.can_receive_runtime === true &&
      record.authenticated === true &&
      record.kafka_consumers_ready === true &&
      record.kafka_consumers_authorized === true &&
      record.central_online_acknowledged === true &&
      typeof record.phone === 'string' &&
      record.phone.trim().length > 0 &&
      record.kafka_unhealthy !== true
    );
  };

  private readonly getConnectionHealthPayload = (body: unknown): unknown => {
    if (!body || typeof body !== 'object') {
      return body;
    }

    const data = (body as Record<string, unknown>).data;
    if (data && typeof data === 'object') {
      return data;
    }

    return body;
  };

  private readonly readBooleanBody = (
    body: unknown,
    key: string
  ): boolean | undefined => {
    const payload = this.getConnectionHealthPayload(body);
    if (!payload || typeof payload !== 'object') {
      return undefined;
    }

    const value = (payload as Record<string, unknown>)[key];
    return typeof value === 'boolean' ? value : undefined;
  };

  private readonly readStringBody = (
    body: unknown,
    key: string
  ): string | undefined => {
    const payload = this.getConnectionHealthPayload(body);
    if (!payload || typeof payload !== 'object') {
      return undefined;
    }

    const value = (payload as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : undefined;
  };

  private readonly readNumberBody = (
    body: unknown,
    key: string
  ): number | undefined => {
    const payload = this.getConnectionHealthPayload(body);
    if (!payload || typeof payload !== 'object') {
      return undefined;
    }

    const value = (payload as Record<string, unknown>)[key];
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : undefined;
  };

  private readonly buildConnectionHealthCheckResult = (
    healthy: boolean,
    code: number | null,
    body: unknown,
    workerTypeId: string
  ): IConnectionHealthCheckResult => {
    const expectedProvider =
      this.expectedWhatsappConnectionStatusProvider(workerTypeId);
    return {
      healthy,
      code,
      body,
      worker_id: this.readStringBody(body, 'worker_id'),
      account_id: this.readStringBody(body, 'account_id'),
      worker_type_id: this.readStringBody(body, 'worker_type_id'),
      runtime_state: this.readStringBody(body, 'runtime_state'),
      activated: this.readBooleanBody(body, 'activated'),
      standby: this.readBooleanBody(body, 'standby'),
      session_ready: this.readBooleanBody(body, 'session_ready'),
      connected: this.readBooleanBody(body, 'connected'),
      can_send: this.readBooleanBody(body, 'can_send'),
      can_receive_runtime: this.readBooleanBody(body, 'can_receive_runtime'),
      authenticated: this.readBooleanBody(body, 'authenticated'),
      provider_state: this.readStringBody(body, 'provider_state'),
      degraded_reason: this.readStringBody(body, 'degraded_reason'),
      last_probe_at: this.readStringBody(body, 'last_probe_at'),
      probe_latency_ms: this.readNumberBody(body, 'probe_latency_ms'),
      phone: this.normalizePhone(this.readStringBody(body, 'phone')),
      central_online_acknowledged: this.readBooleanBody(
        body,
        'central_online_acknowledged'
      ),
      runtime_generation: this.readNumberBody(body, 'runtime_generation'),
      kafka_consumers_ready: this.readBooleanBody(
        body,
        'kafka_consumers_ready'
      ),
      kafka_consumers_authorized: this.readBooleanBody(
        body,
        'kafka_consumers_authorized'
      ),
      runtime_health_schema_version: this.readNumberBody(
        body,
        'runtime_health_schema_version'
      ),
      has_session: this.readBooleanBody(body, 'has_session'),
      qr_stream_ready: this.readBooleanBody(body, 'qr_stream_ready'),
      error: this.readStringBody(body, 'error'),
      session_storage: this.readSessionStorageBody(body),
      native_connection_online: this.readBooleanBody(
        body,
        'native_connection_online'
      ),
      connection_status: expectedProvider
        ? normalizeWhatsappConnectionStatus(
            this.readUnknownBody(body, 'connection_status'),
            expectedProvider
          )
        : undefined,
      connection_status_source_id: normalizeWhatsappConnectionStatusSourceId(
        this.readStringBody(body, 'connection_status_source_id')
      ),
      connection_status_source_current: this.readBooleanBody(
        body,
        'connection_status_source_current'
      ),
      connection_status_lease_required: this.readBooleanBody(
        body,
        'connection_status_lease_required'
      ),
      connection_status_lease_proof_valid: this.readBooleanBody(
        body,
        'connection_status_lease_proof_valid'
      ),
      connection_status_present:
        this.readUnknownBody(body, 'connection_status') !== undefined &&
        this.readUnknownBody(body, 'connection_status') !== null,
      connection_status_source_present: Boolean(
        this.readStringBody(body, 'connection_status_source_id')?.trim()
      ),
      kafka_unhealthy: this.readKafkaUnhealthy(body),
    };
  };

  private readonly readUnknownBody = (body: unknown, key: string): unknown => {
    const payload = this.getConnectionHealthPayload(body);
    if (!payload || typeof payload !== 'object') {
      return undefined;
    }
    return (payload as Record<string, unknown>)[key];
  };

  private readonly readSessionStorageBody = (
    body: unknown
  ): EWorkerSessionStorage | undefined => {
    const value = this.readStringBody(body, 'session_storage');
    return value === EWorkerSessionStorage.postgres ||
      value === EWorkerSessionStorage.legacy_volume
      ? value
      : undefined;
  };

  private readonly expectedWhatsappConnectionStatusProvider = (
    workerTypeId: string
  ): WhatsappConnectionStatusProvider | undefined => {
    switch (workerTypeId) {
      case EWorkerType.baileys:
        return 'baileys';
      case EWorkerType.wwebjs:
        return 'wwebjs';
      case EWorkerType.whatsmeow:
        return 'whatsmeow';
      default:
        return undefined;
    }
  };

  private readonly normalizePhone = (
    phone: string | null | undefined
  ): string | undefined => {
    const normalized = phone?.trim();
    return normalized || undefined;
  };

  private readonly readKafkaUnhealthy = (body: unknown): boolean => {
    if (!body || typeof body !== 'object') {
      return false;
    }

    const record = body as Record<string, unknown>;
    if (record.kafka_unhealthy === true) {
      return true;
    }

    const payload = this.getConnectionHealthPayload(body);
    return (
      !!payload &&
      typeof payload === 'object' &&
      (payload as Record<string, unknown>).kafka_unhealthy === true
    );
  };

  private readonly removeContainer = async (
    context: ILockLeaseContext,
    workerId: string,
    serverId: string,
    sshConfig: ConnectConfig
  ): Promise<void> => {
    const command = `docker rm -f ${workerId}`;

    try {
      await this.runSshFenced(context, serverId, sshConfig, [command], {
        failOnNonZero: true,
      });
    } catch (error) {
      context.assertActive();
      if (!this.isContainerNotFoundError(error, workerId)) {
        throw error;
      }
    }
  };

  private readonly removeStorage = async (
    context: ILockLeaseContext,
    workerId: string,
    serverId: string,
    sshConfig: ConnectConfig
  ): Promise<void> => {
    const command = `rm -rf /app/data/storage/${workerId}`;
    await this.runSshFenced(context, serverId, sshConfig, [command], {
      failOnNonZero: true,
    });
  };

  private readonly shouldCheckFastify = (worker: IWorkerMonitor): boolean => {
    return worker.worker_status_id === EWorkerStatus.online;
  };

  private readonly shouldCheckConnection = (
    worker: IWorkerMonitor
  ): boolean => {
    const statuses = [
      EWorkerStatus.online,
      EWorkerStatus.offline,
      EWorkerStatus.mismatched,
      EWorkerStatus.disponible,
    ];

    const result = statuses.includes(worker.worker_status_id);
    return result;
  };

  private readonly isProvisioning = (worker: IWorkerMonitor): boolean => {
    const statuses = [
      EWorkerStatus.new,
      EWorkerStatus.recreating,
      EWorkerStatus.creating,
    ];

    const result = statuses.includes(worker.worker_status_id);
    return result;
  };

  private readonly isLifecycleOrphan = (worker: IWorkerMonitor): boolean => {
    return this.isProvisioning(worker) && !worker.lifecycle_operation_id;
  };

  private readonly repairStaleTerminalLifecycleFence = async (
    worker: IWorkerMonitor,
    server: IBalanceMonitorServer,
    context: ILockLeaseContext
  ): Promise<boolean> => {
    const terminalStatuses = [
      EWorkerStatus.online,
      EWorkerStatus.disponible,
      EWorkerStatus.offline,
      EWorkerStatus.mismatched,
      EWorkerStatus.stopped,
      EWorkerStatus.blocked,
    ];
    if (
      !terminalStatuses.includes(worker.worker_status_id) ||
      !worker.lifecycle_operation_id ||
      !this.isOlderThan(worker.updated_at, WORKER_LIFECYCLE_REDRIVE_AFTER_MS)
    ) {
      return false;
    }

    const current = await this.executeFenced(context, () =>
      this.workerService.viewWorkerForMonitorConsistent(worker.worker_id)
    );
    if (
      !current ||
      current.deleted_at ||
      current.account_id !== worker.account_id ||
      current.server_id !== worker.server_id ||
      current.worker_type_id !== worker.worker_type_id ||
      current.worker_status_id !== worker.worker_status_id ||
      current.lifecycle_operation_id !== worker.lifecycle_operation_id ||
      !terminalStatuses.includes(current.worker_status_id) ||
      !this.isOlderThan(current.updated_at, WORKER_LIFECYCLE_REDRIVE_AFTER_MS)
    ) {
      return true;
    }

    const operationId = current.lifecycle_operation_id;
    if (!operationId) {
      return true;
    }

    try {
      const prepared = await this.executeFenced(context, () =>
        this.workerLifecycleQueueService.loadPrepared(
          current.worker_id,
          operationId
        )
      );
      if (prepared.length > 0) {
        const validPrepared = this.validateLifecycleJournalForFastRedrive(
          prepared,
          current
        );
        logLocalConnectionStatus(
          validPrepared
            ? 'service.monitor.terminal_lifecycle_journal_pending'
            : 'service.monitor.terminal_lifecycle_journal_invalid',
          {
            layer: 'service.monitor',
            worker_id: current.worker_id,
            account_id: current.account_id,
            worker_type_id: current.worker_type_id,
            worker_status_id: current.worker_status_id,
            lifecycle_operation_id: operationId,
            server_id: current.server_id,
            prepared_messages: prepared.length,
          }
        );
        /*
         * Never clear a database fence while its durable command still
         * exists. The fast redrive owns valid entries; invalid entries stay
         * fail-closed instead of becoming executable orphans.
         */
        return true;
      }
    } catch (error) {
      logLocalConnectionStatus(
        'service.monitor.terminal_lifecycle_journal_read_failed',
        {
          layer: 'service.monitor',
          worker_id: current.worker_id,
          account_id: current.account_id,
          worker_type_id: current.worker_type_id,
          worker_status_id: current.worker_status_id,
          lifecycle_operation_id: operationId,
          server_id: current.server_id,
          reason: error instanceof Error ? error.message : String(error),
        }
      );
      return true;
    }

    const lifecycleActive = await this.executeFenced(context, () =>
      this.workerLifecycleLockService.isLocked(current.worker_id)
    );
    if (lifecycleActive) {
      logLocalConnectionStatus(
        'service.monitor.terminal_lifecycle_fence_active_skipped',
        {
          layer: 'service.monitor',
          worker_id: current.worker_id,
          account_id: current.account_id,
          worker_type_id: current.worker_type_id,
          worker_status_id: current.worker_status_id,
          lifecycle_operation_id: operationId,
          server_id: current.server_id,
        }
      );
      return true;
    }

    if (
      await this.reconcileTerminalLifecycleRuntimeDivergence(
        current,
        server,
        context
      )
    ) {
      return true;
    }

    const runtimeContainerId = current.runtime_container_id
      ?.trim()
      .toLowerCase();
    const runtimeGeneration = current.runtime_generation;
    const recreateMarkerState = this.recreateCompletionMarkerState(
      current,
      operationId,
      runtimeContainerId,
      runtimeGeneration
    );
    if (recreateMarkerState !== 'none') {
      if (
        recreateMarkerState !== 'exact' ||
        !runtimeContainerId ||
        !current.container_id ||
        (current.worker_status_id !== EWorkerStatus.online &&
          current.worker_status_id !== EWorkerStatus.disponible) ||
        typeof runtimeGeneration !== 'number'
      ) {
        logLocalConnectionStatus(
          'service.monitor.terminal_recreate_completion_preserved',
          {
            layer: 'service.monitor',
            worker_id: current.worker_id,
            account_id: current.account_id,
            worker_type_id: current.worker_type_id,
            worker_status_id: current.worker_status_id,
            lifecycle_operation_id: operationId,
            runtime_container_id: runtimeContainerId,
            runtime_generation: runtimeGeneration ?? undefined,
            reason: 'recreate_marker_not_exact',
          }
        );
        return true;
      }

      const completed = await this.executeFenced(context, () =>
        this.workerService.updateWorkerByIdIfLifecycleMatches(
          current.account_id,
          {
            worker_id: current.worker_id,
            worker_status_id: EWorkerStatus.online,
            container_id: runtimeContainerId,
            lifecycle_operation_id: null,
          },
          {
            lifecycle_operation_id: operationId,
            container_id: current.container_id,
            runtime_container_id: runtimeContainerId,
            runtime_generation: runtimeGeneration,
            server_id: current.server_id,
            worker_type_id: current.worker_type_id,
            worker_status_id: current.worker_status_id,
            recreate_completion: {
              operation_id: operationId,
              runtime_generation: runtimeGeneration,
              mode: 'replacement_runtime_already_online',
            },
          }
        )
      );
      logLocalConnectionStatus(
        completed
          ? 'service.monitor.terminal_recreate_completion_recorded'
          : 'service.monitor.terminal_recreate_completion_cas_lost',
        {
          layer: 'service.monitor',
          worker_id: current.worker_id,
          account_id: current.account_id,
          worker_type_id: current.worker_type_id,
          worker_status_id: current.worker_status_id,
          lifecycle_operation_id: operationId,
          runtime_container_id: runtimeContainerId,
          runtime_generation: runtimeGeneration,
        }
      );
      return true;
    }

    const repaired = await this.executeFenced(context, () =>
      this.workerService.updateWorkerByIdIfLifecycleMatches(
        current.account_id,
        {
          worker_id: current.worker_id,
          worker_status_id: current.worker_status_id,
          lifecycle_operation_id: null,
        },
        {
          lifecycle_operation_id: operationId,
          ...('container_id' in current
            ? { container_id: current.container_id ?? null }
            : {}),
          ...(current.runtime_container_id &&
          typeof current.runtime_generation === 'number' &&
          Number.isSafeInteger(current.runtime_generation)
            ? {
                runtime_container_id: current.runtime_container_id,
                runtime_generation: current.runtime_generation,
              }
            : {}),
          server_id: current.server_id,
          worker_type_id: current.worker_type_id,
          worker_status_id: current.worker_status_id,
        }
      )
    );
    if (repaired && current.container_id) {
      await this.releaseLivenessCooldown(
        this.livenessCooldownKey(current.worker_id, current.container_id),
        operationId
      ).catch(() => undefined);
    }
    logLocalConnectionStatus(
      repaired
        ? 'service.monitor.terminal_lifecycle_fence_repaired'
        : 'service.monitor.terminal_lifecycle_fence_cas_lost',
      {
        layer: 'service.monitor',
        worker_id: current.worker_id,
        account_id: current.account_id,
        worker_type_id: current.worker_type_id,
        worker_status_id: current.worker_status_id,
        lifecycle_operation_id: operationId,
        server_id: current.server_id,
      }
    );
    return true;
  };

  private readonly reconcileProvisioningLifecycleRuntimeDivergence = async (
    snapshot: IWorkerMonitor,
    server: IBalanceMonitorServer,
    context: ILockLeaseContext
  ): Promise<boolean> => {
    const provisioningStatuses = [
      EWorkerStatus.creating,
      EWorkerStatus.recreating,
    ];
    const snapshotControlContainerId = snapshot.container_id
      ?.trim()
      .toLowerCase();
    const snapshotRuntimeContainerId = snapshot.runtime_container_id
      ?.trim()
      .toLowerCase();
    if (
      !provisioningStatuses.includes(snapshot.worker_status_id) ||
      !snapshot.lifecycle_operation_id ||
      !snapshotControlContainerId ||
      !snapshotRuntimeContainerId ||
      snapshotControlContainerId === snapshotRuntimeContainerId ||
      !CONTAINER_ID_PATTERN.test(snapshotControlContainerId) ||
      !CONTAINER_ID_PATTERN.test(snapshotRuntimeContainerId) ||
      typeof snapshot.runtime_generation !== 'number' ||
      !Number.isSafeInteger(snapshot.runtime_generation) ||
      snapshot.runtime_generation <= 0
    ) {
      return false;
    }

    const current = await this.executeFenced(context, () =>
      this.workerService.viewWorkerForMonitorConsistent(snapshot.worker_id)
    );
    const controlContainerId = current?.container_id?.trim().toLowerCase();
    const runtimeContainerId = current?.runtime_container_id
      ?.trim()
      .toLowerCase();
    if (
      !current ||
      current.deleted_at ||
      current.account_id !== snapshot.account_id ||
      current.server_id !== server.server_id ||
      current.worker_type_id !== snapshot.worker_type_id ||
      current.worker_status_id !== snapshot.worker_status_id ||
      current.lifecycle_operation_id !== snapshot.lifecycle_operation_id ||
      controlContainerId !== snapshotControlContainerId ||
      runtimeContainerId !== snapshotRuntimeContainerId ||
      current.runtime_generation !== snapshot.runtime_generation
    ) {
      return true;
    }

    const lifecycleActive = await this.executeFenced(context, () =>
      this.workerLifecycleLockService.isLocked(current.worker_id)
    );
    if (lifecycleActive) {
      logLocalConnectionStatus(
        'service.monitor.provisioning_runtime_reconciliation_active_skipped',
        {
          layer: 'service.monitor',
          worker_id: current.worker_id,
          account_id: current.account_id,
          worker_type_id: current.worker_type_id,
          worker_status_id: current.worker_status_id,
          lifecycle_operation_id: current.lifecycle_operation_id ?? undefined,
          control_container_id: controlContainerId,
          runtime_container_id: runtimeContainerId,
          runtime_generation: current.runtime_generation ?? undefined,
        }
      );
      return true;
    }

    let replacement: IPersistentlyUnhealthyContainer | undefined;
    try {
      [replacement] = await this.inspectExactContainers(
        server,
        [runtimeContainerId as string],
        context
      );
    } catch (error) {
      context.assertActive();
      logLocalConnectionStatus(
        'service.monitor.provisioning_runtime_reconciliation_deferred',
        {
          layer: 'service.monitor',
          worker_id: current.worker_id,
          account_id: current.account_id,
          worker_type_id: current.worker_type_id,
          worker_status_id: current.worker_status_id,
          lifecycle_operation_id: current.lifecycle_operation_id ?? undefined,
          control_container_id: controlContainerId,
          runtime_container_id: runtimeContainerId,
          runtime_generation: current.runtime_generation ?? undefined,
          reason: error instanceof Error ? error.message : String(error),
        }
      );
      return false;
    }

    const exactLifecycleReplacement =
      replacement !== undefined &&
      this.isExactTerminalLifecycleReplacement(
        current,
        replacement,
        runtimeContainerId as string,
        current.runtime_generation as number,
        current.lifecycle_operation_id as string
      );
    let legacyUnlabelledReplacementProven = false;
    if (
      !exactLifecycleReplacement &&
      replacement &&
      this.isExactUnlabelledLifecycleReplacement(
        current,
        replacement,
        runtimeContainerId as string,
        current.runtime_generation as number
      )
    ) {
      const controlContainerAbsent = await this.confirmContainerAbsent(
        server,
        controlContainerId as string,
        context
      );
      let ownership: IExactRuntimeContainerOwnership | null = null;
      if (controlContainerAbsent) {
        try {
          ownership = await this.inspectExactRuntimeContainerOwnership(
            server,
            runtimeContainerId as string,
            context
          );
        } catch (error) {
          context.assertActive();
          logLocalConnectionStatus(
            'service.monitor.provisioning_runtime_ownership_probe_deferred',
            {
              layer: 'service.monitor',
              worker_id: current.worker_id,
              account_id: current.account_id,
              worker_type_id: current.worker_type_id,
              worker_status_id: current.worker_status_id,
              lifecycle_operation_id:
                current.lifecycle_operation_id ?? undefined,
              control_container_id: controlContainerId,
              runtime_container_id: runtimeContainerId,
              runtime_generation: current.runtime_generation ?? undefined,
              reason: error instanceof Error ? error.message : String(error),
            }
          );
        }
      }
      legacyUnlabelledReplacementProven =
        controlContainerAbsent &&
        ownership !== null &&
        this.isExactLegacyUnlabelledRuntimeOwnership(
          current,
          ownership,
          runtimeContainerId as string,
          current.runtime_generation as number
        );
      if (legacyUnlabelledReplacementProven) {
        logLocalConnectionStatus(
          'service.monitor.provisioning_runtime_legacy_identity_proven',
          {
            layer: 'service.monitor',
            worker_id: current.worker_id,
            account_id: current.account_id,
            worker_type_id: current.worker_type_id,
            worker_status_id: current.worker_status_id,
            lifecycle_operation_id: current.lifecycle_operation_id ?? undefined,
            control_container_id: controlContainerId,
            runtime_container_id: runtimeContainerId,
            runtime_generation: current.runtime_generation ?? undefined,
            reason: 'control_container_confirmed_absent',
          }
        );
      }
    }
    const exactReplacement =
      exactLifecycleReplacement || legacyUnlabelledReplacementProven;
    if (
      !exactReplacement ||
      !this.isDockerOperationalReplacement(replacement)
    ) {
      logLocalConnectionStatus(
        'service.monitor.provisioning_runtime_reconciliation_deferred',
        {
          layer: 'service.monitor',
          worker_id: current.worker_id,
          account_id: current.account_id,
          worker_type_id: current.worker_type_id,
          worker_status_id: current.worker_status_id,
          lifecycle_operation_id: current.lifecycle_operation_id ?? undefined,
          control_container_id: controlContainerId,
          runtime_container_id: runtimeContainerId,
          runtime_generation: current.runtime_generation ?? undefined,
          reason: exactReplacement
            ? 'replacement_not_operational'
            : 'replacement_identity_not_exact',
        }
      );
      return false;
    }

    const readiness = await this.loadTerminalReplacementReadiness(
      current,
      server,
      current.runtime_generation as number,
      context
    );
    if (
      (readiness === 'not_ready' || readiness === 'unavailable') &&
      legacyUnlabelledReplacementProven
    ) {
      await this.alignLegacyProvisioningRuntimeAndRedrive(
        current,
        controlContainerId as string,
        runtimeContainerId as string,
        current.runtime_generation as number,
        current.lifecycle_operation_id as string,
        context,
        readiness
      );
      return true;
    }
    if (readiness === 'not_ready' || readiness === 'unavailable') {
      return false;
    }

    await this.finalizeTerminalLifecycleReplacement(
      current,
      controlContainerId as string,
      runtimeContainerId as string,
      current.runtime_generation as number,
      current.lifecycle_operation_id as string,
      context,
      readiness,
      current.worker_status_id
    );
    return true;
  };

  private readonly alignLegacyProvisioningRuntimeAndRedrive = async (
    worker: IWorkerMonitor,
    controlContainerId: string,
    runtimeContainerId: string,
    runtimeGeneration: number,
    lifecycleOperationId: string,
    context: ILockLeaseContext,
    readiness: 'not_ready' | 'unavailable'
  ): Promise<void> => {
    /*
     * Older service versions could materialize the replacement and persist the
     * worker_runtime pointer before stamping the lifecycle label. The runtime
     * cannot report strict readiness while the authoritative worker is still
     * provisioning, so promoting it directly would create a circular gate.
     *
     * After exact Docker/runtime identity and physical absence of the stale
     * control container were proven by the caller, align only the control
     * pointer. Status and lifecycle ownership stay fenced. The original
     * durable journal can then run the normal recreate command against the
     * exact current runtime; only that command may complete the lifecycle.
     */
    const aligned = await this.executeFenced(context, () =>
      this.workerService.updateWorkerByIdIfLifecycleMatches(
        worker.account_id,
        {
          worker_id: worker.worker_id,
          worker_status_id: worker.worker_status_id,
          container_id: runtimeContainerId,
        },
        {
          lifecycle_operation_id: lifecycleOperationId,
          container_id: controlContainerId,
          runtime_container_id: runtimeContainerId,
          runtime_generation: runtimeGeneration,
          server_id: worker.server_id,
          worker_type_id: worker.worker_type_id,
          worker_status_id: worker.worker_status_id,
        }
      )
    );
    if (!aligned) {
      logLocalConnectionStatus(
        'service.monitor.provisioning_runtime_control_alignment_cas_lost',
        {
          layer: 'service.monitor',
          worker_id: worker.worker_id,
          account_id: worker.account_id,
          worker_type_id: worker.worker_type_id,
          worker_status_id: worker.worker_status_id,
          lifecycle_operation_id: lifecycleOperationId,
          control_container_id: controlContainerId,
          runtime_container_id: runtimeContainerId,
          runtime_generation: runtimeGeneration,
          readiness,
        }
      );
      return;
    }

    logLocalConnectionStatus(
      'service.monitor.provisioning_runtime_control_aligned',
      {
        layer: 'service.monitor',
        worker_id: worker.worker_id,
        account_id: worker.account_id,
        worker_type_id: worker.worker_type_id,
        worker_status_id: worker.worker_status_id,
        lifecycle_operation_id: lifecycleOperationId,
        control_container_id: controlContainerId,
        runtime_container_id: runtimeContainerId,
        runtime_generation: runtimeGeneration,
        readiness,
      }
    );

    const claimed = await this.executeFenced(context, () =>
      this.workerLifecycleLockService.tryClaimRedrive(
        worker.worker_id,
        lifecycleOperationId,
        WORKER_LIVENESS_LIFECYCLE_REDRIVE_CLAIM_MS
      )
    );
    if (!claimed) {
      logLocalConnectionStatus(
        'service.monitor.provisioning_runtime_redrive_already_claimed',
        {
          layer: 'service.monitor',
          worker_id: worker.worker_id,
          account_id: worker.account_id,
          worker_type_id: worker.worker_type_id,
          worker_status_id: worker.worker_status_id,
          lifecycle_operation_id: lifecycleOperationId,
          runtime_container_id: runtimeContainerId,
          runtime_generation: runtimeGeneration,
        }
      );
      return;
    }
    const redriveClaimToken = typeof claimed === 'string' ? claimed : undefined;

    try {
      const redriven = await this.executeFenced(context, () =>
        redriveClaimToken
          ? this.workerLifecycleQueueService.redrivePrepared(
              worker.worker_id,
              lifecycleOperationId,
              lifecycleOperationId,
              redriveClaimToken
            )
          : this.workerLifecycleQueueService.redrivePrepared(
              worker.worker_id,
              lifecycleOperationId,
              lifecycleOperationId
            )
      );
      const reconstructed =
        redriven.length === 0
          ? await this.reconstructAndPublishAlignedProvisioningJournal(
              worker,
              runtimeContainerId,
              runtimeGeneration,
              lifecycleOperationId,
              redriveClaimToken,
              context
            )
          : false;
      if (redriven.length === 0 && !reconstructed) {
        await this.workerLifecycleLockService
          .releaseRedriveClaim(
            worker.worker_id,
            lifecycleOperationId,
            redriveClaimToken
          )
          .catch(() => undefined);
      }
      logLocalConnectionStatus(
        'service.monitor.provisioning_runtime_redriven',
        {
          layer: 'service.monitor',
          worker_id: worker.worker_id,
          account_id: worker.account_id,
          worker_type_id: worker.worker_type_id,
          worker_status_id: worker.worker_status_id,
          lifecycle_operation_id: lifecycleOperationId,
          runtime_container_id: runtimeContainerId,
          runtime_generation: runtimeGeneration,
          recovered_messages: redriven.length + (reconstructed ? 1 : 0),
          recovery_source: reconstructed
            ? 'reconstructed_same_operation'
            : 'durable_journal',
        }
      );
    } catch (error) {
      await this.workerLifecycleLockService
        .releaseRedriveClaim(
          worker.worker_id,
          lifecycleOperationId,
          redriveClaimToken
        )
        .catch(() => undefined);
      throw error;
    }
  };

  private readonly reconstructAndPublishAlignedProvisioningJournal = async (
    worker: IWorkerMonitor,
    runtimeContainerId: string,
    runtimeGeneration: number,
    lifecycleOperationId: string,
    redriveClaimToken: string | undefined,
    context: ILockLeaseContext
  ): Promise<boolean> => {
    const current = await this.executeFenced(context, () =>
      this.workerService.viewWorkerForMonitorConsistent(worker.worker_id)
    );
    if (
      !current ||
      current.deleted_at ||
      current.account_id !== worker.account_id ||
      current.server_id !== worker.server_id ||
      current.worker_type_id !== worker.worker_type_id ||
      current.worker_status_id !== worker.worker_status_id ||
      current.lifecycle_operation_id !== lifecycleOperationId ||
      current.container_id?.trim().toLowerCase() !== runtimeContainerId ||
      current.runtime_container_id?.trim().toLowerCase() !==
        runtimeContainerId ||
      current.runtime_generation !== runtimeGeneration
    ) {
      return false;
    }

    const lifecycleActive = await this.executeFenced(context, () =>
      this.workerLifecycleLockService.isLocked(current.worker_id)
    );
    if (lifecycleActive) {
      return false;
    }

    const recovery =
      this.reconstructMissingProvisioningLifecyclePayload(current);
    if (!recovery || recovery.operation_id !== lifecycleOperationId) {
      return false;
    }

    /*
     * `redrivePrepared([])` proves that Redis has no durable primary for this
     * operation. Persist a conservative, session-preserving command under the
     * same operation before publishing it. A concurrent original Kafka
     * delivery remains harmless because both paths share the database fence
     * and lifecycle lock.
     */
    await this.executeFenced(context, () =>
      this.workerLifecycleQueueService.prepare(recovery)
    );
    await this.executeFenced(context, () =>
      this.workerLifecycleQueueService.publish({
        ...recovery,
        ...(redriveClaimToken
          ? { redrive_claim_token: redriveClaimToken }
          : {}),
      })
    );
    logLocalConnectionStatus(
      'service.monitor.provisioning_runtime_journal_reconstructed',
      {
        layer: 'service.monitor',
        worker_id: current.worker_id,
        account_id: current.account_id,
        worker_type_id: current.worker_type_id,
        worker_status_id: current.worker_status_id,
        lifecycle_operation_id: lifecycleOperationId,
        runtime_container_id: runtimeContainerId,
        runtime_generation: runtimeGeneration,
        action: recovery.action,
        source: recovery.source,
      }
    );
    return true;
  };

  private readonly isExactUnlabelledLifecycleReplacement = (
    worker: IWorkerMonitor,
    replacement: IPersistentlyUnhealthyContainer,
    runtimeContainerId: string,
    runtimeGeneration: number
  ): boolean => {
    return (
      replacement.containerId === runtimeContainerId &&
      replacement.name === worker.worker_id &&
      replacement.workerId === worker.worker_id &&
      replacement.accountId === worker.account_id &&
      (replacement.serverId === undefined ||
        replacement.serverId === worker.server_id) &&
      replacement.workerTypeId === worker.worker_type_id &&
      replacement.runtimeGeneration === runtimeGeneration &&
      replacement.lifecycleOperationId === undefined
    );
  };

  private readonly isExactLegacyUnlabelledRuntimeOwnership = (
    worker: IWorkerMonitor,
    ownership: IExactRuntimeContainerOwnership,
    runtimeContainerId: string,
    runtimeGeneration: number
  ): boolean => {
    const sessionVolumeName = worker.runtime_session_volume_name?.trim();
    if (!sessionVolumeName) {
      return false;
    }

    const labels = ownership.labels;
    const env = ownership.env;
    const serverLabel = labels['underchat.server_id'];
    const serverEnv = env.SERVER_ID;
    const appDataMounts = ownership.mounts.filter(
      (mount) => mount.destination === '/app/data'
    );
    return (
      ownership.containerId === runtimeContainerId &&
      ownership.name === worker.worker_id &&
      ownership.running === true &&
      labels['underchat.worker_id'] === worker.worker_id &&
      labels['underchat.account_id'] === worker.account_id &&
      labels['underchat.worker_type_id'] === worker.worker_type_id &&
      labels['underchat.runtime_generation'] === String(runtimeGeneration) &&
      labels['underchat.session_volume_name'] === sessionVolumeName &&
      labels['underchat.lifecycle_operation_id'] === undefined &&
      labels['underchat.warm_standby'] !== 'true' &&
      (serverLabel === undefined || serverLabel === worker.server_id) &&
      env.WORKER_ID === worker.worker_id &&
      env.ACCOUNT_ID === worker.account_id &&
      env.WORKER_TYPE_ID === worker.worker_type_id &&
      env.RUNTIME_GENERATION === String(runtimeGeneration) &&
      env.SESSION_VOLUME_NAME === sessionVolumeName &&
      env.WARM_STANDBY !== 'true' &&
      (serverEnv === undefined || serverEnv === worker.server_id) &&
      appDataMounts.length === 1 &&
      appDataMounts[0].type === 'volume' &&
      appDataMounts[0].name === sessionVolumeName &&
      appDataMounts[0].readWrite === true
    );
  };

  private readonly confirmContainerAbsent = async (
    server: IBalanceMonitorServer,
    containerId: string,
    context: ILockLeaseContext
  ): Promise<boolean> => {
    try {
      const [container] = await this.inspectExactContainers(
        server,
        [containerId],
        context
      );
      return !container;
    } catch (error) {
      context.assertActive();
      return this.isContainerNotFoundError(error, containerId);
    }
  };

  private readonly reconcileTerminalLifecycleRuntimeDivergence = async (
    worker: IWorkerMonitor,
    server: IBalanceMonitorServer,
    context: ILockLeaseContext
  ): Promise<boolean> => {
    const controlContainerId = worker.container_id?.trim().toLowerCase();
    const runtimeContainerId = worker.runtime_container_id
      ?.trim()
      .toLowerCase();
    const runtimeGeneration = worker.runtime_generation;
    if (
      !controlContainerId ||
      !runtimeContainerId ||
      runtimeContainerId === controlContainerId
    ) {
      return false;
    }

    const lifecycleOperationId = worker.lifecycle_operation_id;
    if (
      worker.worker_status_id !== EWorkerStatus.online ||
      !lifecycleOperationId ||
      !CONTAINER_ID_PATTERN.test(controlContainerId) ||
      !CONTAINER_ID_PATTERN.test(runtimeContainerId) ||
      typeof runtimeGeneration !== 'number' ||
      !Number.isSafeInteger(runtimeGeneration) ||
      runtimeGeneration <= 0
    ) {
      logLocalConnectionStatus(
        'service.monitor.terminal_lifecycle_runtime_divergence_preserved',
        {
          layer: 'service.monitor',
          worker_id: worker.worker_id,
          account_id: worker.account_id,
          worker_type_id: worker.worker_type_id,
          worker_status_id: worker.worker_status_id,
          lifecycle_operation_id: lifecycleOperationId ?? undefined,
          control_container_id: controlContainerId,
          runtime_container_id: runtimeContainerId,
          runtime_generation: runtimeGeneration ?? undefined,
          reason: 'terminal_runtime_identity_not_reconcilable',
        }
      );
      return true;
    }

    let replacement: IPersistentlyUnhealthyContainer | undefined;
    let replacementConfirmedAbsent = false;
    try {
      [replacement] = await this.inspectExactContainers(
        server,
        [runtimeContainerId],
        context
      );
    } catch (error) {
      context.assertActive();
      if (this.isContainerNotFoundError(error, runtimeContainerId)) {
        replacementConfirmedAbsent = true;
      } else {
        logLocalConnectionStatus(
          'service.monitor.terminal_lifecycle_runtime_divergence_preserved',
          {
            layer: 'service.monitor',
            worker_id: worker.worker_id,
            account_id: worker.account_id,
            worker_type_id: worker.worker_type_id,
            lifecycle_operation_id: lifecycleOperationId,
            control_container_id: controlContainerId,
            runtime_container_id: runtimeContainerId,
            runtime_generation: runtimeGeneration,
            reason:
              error instanceof Error ? error.message : 'docker_inspect_failed',
          }
        );
        return true;
      }
    }

    const exactReplacement = replacement
      ? this.isExactTerminalLifecycleReplacement(
          worker,
          replacement,
          runtimeContainerId,
          runtimeGeneration,
          lifecycleOperationId
        )
      : false;
    if (!replacementConfirmedAbsent && !exactReplacement) {
      logLocalConnectionStatus(
        'service.monitor.terminal_lifecycle_runtime_divergence_preserved',
        {
          layer: 'service.monitor',
          worker_id: worker.worker_id,
          account_id: worker.account_id,
          worker_type_id: worker.worker_type_id,
          lifecycle_operation_id: lifecycleOperationId,
          control_container_id: controlContainerId,
          runtime_container_id: runtimeContainerId,
          runtime_generation: runtimeGeneration,
          reason: 'replacement_identity_not_exact',
        }
      );
      return true;
    }

    if (replacement && this.isDockerOperationalReplacement(replacement)) {
      const readiness = await this.loadTerminalReplacementReadiness(
        worker,
        server,
        runtimeGeneration,
        context
      );
      if (readiness === 'unavailable') {
        return true;
      }
      if (
        readiness === EWorkerStatus.online ||
        readiness === EWorkerStatus.disponible
      ) {
        await this.finalizeTerminalLifecycleReplacement(
          worker,
          controlContainerId,
          runtimeContainerId,
          runtimeGeneration,
          lifecycleOperationId,
          context,
          readiness,
          worker.worker_status_id
        );
        return true;
      }
    }

    await this.queueMissingTerminalLifecycleRecovery(
      worker,
      controlContainerId,
      runtimeContainerId,
      runtimeGeneration,
      lifecycleOperationId,
      context
    );
    return true;
  };

  private readonly isExactTerminalLifecycleReplacement = (
    worker: IWorkerMonitor,
    replacement: IPersistentlyUnhealthyContainer,
    runtimeContainerId: string,
    runtimeGeneration: number,
    lifecycleOperationId: string
  ): boolean => {
    return (
      replacement.containerId === runtimeContainerId &&
      replacement.name === worker.worker_id &&
      replacement.workerId === worker.worker_id &&
      replacement.accountId === worker.account_id &&
      replacement.serverId === worker.server_id &&
      replacement.workerTypeId === worker.worker_type_id &&
      replacement.runtimeGeneration === runtimeGeneration &&
      replacement.lifecycleOperationId === lifecycleOperationId
    );
  };

  private readonly isDockerOperationalReplacement = (
    replacement: IPersistentlyUnhealthyContainer
  ): boolean => {
    return (
      replacement.running &&
      replacement.paused !== true &&
      (replacement.healthStatus === 'healthy' ||
        replacement.healthStatus === 'starting')
    );
  };

  private readonly loadTerminalReplacementReadiness = async (
    worker: IWorkerMonitor,
    server: IBalanceMonitorServer,
    runtimeGeneration: number,
    context: ILockLeaseContext
  ): Promise<TerminalReplacementReadiness> => {
    const connection = await this.checkConnection(
      worker,
      server.server_id,
      this.buildSshConfig(server),
      context
    );
    if (connection.code === null) {
      logLocalConnectionStatus(
        'service.monitor.terminal_lifecycle_runtime_divergence_preserved',
        {
          layer: 'service.monitor',
          worker_id: worker.worker_id,
          account_id: worker.account_id,
          worker_type_id: worker.worker_type_id,
          lifecycle_operation_id: worker.lifecycle_operation_id ?? undefined,
          runtime_container_id: worker.runtime_container_id ?? undefined,
          runtime_generation: runtimeGeneration,
          reason: 'replacement_readiness_unavailable',
        }
      );
      return 'unavailable';
    }

    const strictReady =
      connection.healthy &&
      connection.session_ready === true &&
      connection.connected === true &&
      connection.can_send === true &&
      connection.can_receive_runtime === true &&
      connection.authenticated === true &&
      connection.kafka_unhealthy === false &&
      connection.kafka_consumers_ready === true &&
      (Number(connection.runtime_health_schema_version ?? 0) < 2 ||
        connection.kafka_consumers_authorized === true) &&
      connection.central_online_acknowledged === true &&
      connection.runtime_generation === runtimeGeneration &&
      Boolean(connection.phone?.trim());
    if (strictReady) {
      return EWorkerStatus.online;
    }

    const hasAnyNativeEvidence =
      connection.connection_status_present ||
      connection.connection_status_source_present;
    const nativeStatus = connection.connection_status;
    const nativeEvidenceAllowsPairing =
      !hasAnyNativeEvidence ||
      (connection.connection_status_present &&
        connection.connection_status_source_present &&
        connection.connection_status_source_current === true &&
        nativeStatus !== undefined &&
        nativeStatus.connected === false &&
        nativeStatus.authenticated === false &&
        nativeStatus.sessionValid !== true &&
        [
          EWhatsappConnectionStatus.initializing,
          EWhatsappConnectionStatus.connecting,
          EWhatsappConnectionStatus.qr,
          EWhatsappConnectionStatus.offline,
          EWhatsappConnectionStatus.stopped,
        ].includes(nativeStatus.status));
    const explicitlyAvailable =
      Number(connection.runtime_health_schema_version ?? 0) >= 3 &&
      connection.worker_id === worker.worker_id &&
      connection.account_id === worker.account_id &&
      connection.worker_type_id === worker.worker_type_id &&
      connection.runtime_state === 'active' &&
      connection.activated === true &&
      connection.standby === false &&
      connection.runtime_generation === runtimeGeneration &&
      connection.has_session === false &&
      connection.qr_stream_ready === true &&
      connection.connected === false &&
      connection.session_ready === false &&
      connection.can_send === false &&
      connection.can_receive_runtime === false &&
      connection.authenticated === false &&
      connection.central_online_acknowledged === false &&
      connection.native_connection_online === false &&
      connection.kafka_consumers_authorized !== true &&
      !connection.error &&
      !connection.phone?.trim() &&
      !this.hasActiveProviderSessionEvidence(connection) &&
      nativeEvidenceAllowsPairing &&
      (worker.session_storage === undefined ||
        connection.session_storage === worker.session_storage);
    return explicitlyAvailable ? EWorkerStatus.disponible : 'not_ready';
  };

  private readonly finalizeTerminalLifecycleReplacement = async (
    worker: IWorkerMonitor,
    controlContainerId: string,
    runtimeContainerId: string,
    runtimeGeneration: number,
    lifecycleOperationId: string,
    context: ILockLeaseContext,
    terminalWorkerStatus: EWorkerStatus.online | EWorkerStatus.disponible,
    expectedWorkerStatus: EWorkerStatus = EWorkerStatus.online
  ): Promise<void> => {
    const recreateMarkerState = this.recreateCompletionMarkerState(
      worker,
      lifecycleOperationId,
      runtimeContainerId,
      runtimeGeneration
    );
    if (recreateMarkerState === 'mismatch') {
      logLocalConnectionStatus(
        'service.monitor.terminal_recreate_completion_preserved',
        {
          layer: 'service.monitor',
          worker_id: worker.worker_id,
          account_id: worker.account_id,
          worker_type_id: worker.worker_type_id,
          lifecycle_operation_id: lifecycleOperationId,
          control_container_id: controlContainerId,
          runtime_container_id: runtimeContainerId,
          runtime_generation: runtimeGeneration,
          reason: 'recreate_marker_not_exact',
        }
      );
      return;
    }
    const reconciled = await this.executeFenced(context, () =>
      this.workerService.updateWorkerByIdIfLifecycleMatches(
        worker.account_id,
        {
          worker_id: worker.worker_id,
          worker_status_id: terminalWorkerStatus,
          container_id: runtimeContainerId,
          lifecycle_operation_id: null,
          ...(terminalWorkerStatus === EWorkerStatus.disponible
            ? { number: null, connection_date: null }
            : {}),
        },
        {
          lifecycle_operation_id: lifecycleOperationId,
          container_id: controlContainerId,
          runtime_container_id: runtimeContainerId,
          runtime_generation: runtimeGeneration,
          server_id: worker.server_id,
          worker_type_id: worker.worker_type_id,
          worker_status_id: expectedWorkerStatus,
          ...(recreateMarkerState === 'exact'
            ? {
                recreate_completion: {
                  operation_id: lifecycleOperationId,
                  runtime_generation: runtimeGeneration,
                  mode: 'replacement_runtime' as const,
                },
              }
            : {}),
        }
      )
    );
    if (reconciled) {
      await this.releaseLivenessCooldown(
        this.livenessCooldownKey(worker.worker_id, controlContainerId),
        lifecycleOperationId
      ).catch(() => undefined);

      if (recreateMarkerState === 'exact') {
        const completed = await this.executeFenced(context, () =>
          this.workerService.viewWorkerForMonitorConsistent(worker.worker_id)
        );
        const completionVerified = Boolean(
          completed &&
          completed.worker_status_id === terminalWorkerStatus &&
          completed.container_id?.trim().toLowerCase() === runtimeContainerId &&
          completed.lifecycle_operation_id === null &&
          completed.runtime_generation === runtimeGeneration &&
          completed.recreate_completed_operation_id === lifecycleOperationId &&
          completed.recreate_completed_runtime_generation ===
            runtimeGeneration &&
          completed.recreate_completed_at
        );

        if (completionVerified && completed?.recreate_completed_at) {
          try {
            const state = buildManagerWorkerRecreateTerminalStatusEvent(
              {
                action: EWorkerAction.recreate,
                worker_id: worker.worker_id,
                account_id: worker.account_id,
                server_id: worker.server_id,
                worker_type_id: worker.worker_type_id,
                lifecycle_operation_id: lifecycleOperationId,
                debug_trace_id: lifecycleOperationId,
              },
              runtimeGeneration,
              terminalWorkerStatus,
              completed.recreate_completed_at
            );
            await this.executeFenced(context, () =>
              this.centrifugoService.publishSub(
                workerCentrifugoQueue(worker.account_id),
                state
              )
            );
          } catch (error) {
            logLocalConnectionStatus(
              'service.monitor.terminal_recreate_status_publish_failed',
              {
                layer: 'service.monitor',
                worker_id: worker.worker_id,
                account_id: worker.account_id,
                worker_type_id: worker.worker_type_id,
                worker_status_id: terminalWorkerStatus,
                lifecycle_operation_id: lifecycleOperationId,
                runtime_container_id: runtimeContainerId,
                runtime_generation: runtimeGeneration,
                reason: error instanceof Error ? error.message : String(error),
              }
            );
          }
        } else {
          logLocalConnectionStatus(
            'service.monitor.terminal_recreate_completion_unverified',
            {
              layer: 'service.monitor',
              worker_id: worker.worker_id,
              account_id: worker.account_id,
              worker_type_id: worker.worker_type_id,
              worker_status_id: terminalWorkerStatus,
              lifecycle_operation_id: lifecycleOperationId,
              runtime_container_id: runtimeContainerId,
              runtime_generation: runtimeGeneration,
            }
          );
        }
      }
    }
    logLocalConnectionStatus(
      reconciled
        ? 'service.monitor.terminal_lifecycle_runtime_divergence_reconciled'
        : 'service.monitor.terminal_lifecycle_runtime_divergence_cas_lost',
      {
        layer: 'service.monitor',
        worker_id: worker.worker_id,
        account_id: worker.account_id,
        worker_type_id: worker.worker_type_id,
        lifecycle_operation_id: lifecycleOperationId,
        worker_status_id: terminalWorkerStatus,
        control_container_id: controlContainerId,
        runtime_container_id: runtimeContainerId,
        runtime_generation: runtimeGeneration,
      }
    );
  };

  private readonly recreateCompletionMarkerState = (
    worker: IWorkerMonitor,
    lifecycleOperationId: string,
    runtimeContainerId: string | undefined,
    runtimeGeneration: number | null | undefined
  ): 'none' | 'exact' | 'mismatch' => {
    const markerValues = [
      worker.recreate_bootstrap_operation_id,
      worker.recreate_bootstrap_runtime_generation,
      worker.recreate_bootstrap_container_id,
      worker.recreate_bootstrap_started_at,
      worker.recreate_retired_operation_id,
      worker.recreate_retired_runtime_generation,
      worker.recreate_retired_container_id,
      worker.recreate_retired_at,
    ];
    if (markerValues.every((value) => value === null || value === undefined)) {
      return 'none';
    }

    const bootstrapContainerId = worker.recreate_bootstrap_container_id
      ?.trim()
      .toLowerCase();
    return runtimeContainerId &&
      Number.isSafeInteger(runtimeGeneration) &&
      (runtimeGeneration as number) > 0 &&
      worker.recreate_bootstrap_operation_id === lifecycleOperationId &&
      worker.recreate_bootstrap_runtime_generation === runtimeGeneration &&
      bootstrapContainerId === runtimeContainerId &&
      Boolean(worker.recreate_bootstrap_started_at) &&
      worker.recreate_retired_operation_id === null &&
      worker.recreate_retired_runtime_generation === null &&
      worker.recreate_retired_container_id === null &&
      worker.recreate_retired_at === null
      ? 'exact'
      : 'mismatch';
  };

  private readonly queueMissingTerminalLifecycleRecovery = async (
    worker: IWorkerMonitor,
    controlContainerId: string,
    runtimeContainerId: string,
    runtimeGeneration: number,
    lifecycleOperationId: string,
    context: ILockLeaseContext
  ): Promise<void> => {
    const recoveryMessage: IWorkerLifecycleQueueMessage = {
      request_id: uuidv7(),
      operation_id: lifecycleOperationId,
      action: 'recreate',
      worker_id: worker.worker_id,
      account_id: worker.account_id,
      server_id: worker.server_id,
      worker_type_id: worker.worker_type_id,
      session_storage: worker.session_storage,
      worker_status_id: EWorkerStatus.recreating,
      source: 'worker_recreate',
      previous_worker_status_id: EWorkerStatus.online,
      recovery_without_journal: true,
      debug_trace_id: lifecycleOperationId,
      requested_at: currentTime(),
    };
    await this.executeFenced(context, () =>
      this.workerLifecycleQueueService.prepare(recoveryMessage)
    );
    const transitioned = await this.executeFenced(context, () =>
      this.workerService.updateWorkerByIdIfLifecycleMatches(
        worker.account_id,
        {
          worker_id: worker.worker_id,
          worker_status_id: EWorkerStatus.recreating,
        },
        {
          lifecycle_operation_id: lifecycleOperationId,
          container_id: controlContainerId,
          runtime_container_id: runtimeContainerId,
          runtime_generation: runtimeGeneration,
          server_id: worker.server_id,
          worker_type_id: worker.worker_type_id,
          worker_status_id: EWorkerStatus.online,
        }
      )
    );
    if (transitioned) {
      await this.executeFenced(context, () =>
        this.workerLifecycleQueueService.publish(recoveryMessage)
      );
    }
    logLocalConnectionStatus(
      transitioned
        ? 'service.monitor.terminal_lifecycle_runtime_recovery_enqueued'
        : 'service.monitor.terminal_lifecycle_runtime_recovery_cas_lost',
      {
        layer: 'service.monitor',
        worker_id: worker.worker_id,
        account_id: worker.account_id,
        worker_type_id: worker.worker_type_id,
        lifecycle_operation_id: lifecycleOperationId,
        control_container_id: controlContainerId,
        runtime_container_id: runtimeContainerId,
        runtime_generation: runtimeGeneration,
      }
    );
  };

  private readonly redriveStalledLifecycleIfNeeded = async (
    worker: IWorkerMonitor,
    server: IBalanceMonitorServer,
    context: ILockLeaseContext,
    terminalizeExpiredProvisioning = false
  ): Promise<boolean> => {
    if (
      (worker.worker_status_id !== EWorkerStatus.recreating &&
        worker.worker_status_id !== EWorkerStatus.creating &&
        worker.worker_status_id !== EWorkerStatus.error &&
        worker.worker_status_id !== EWorkerStatus.deleting) ||
      !worker.lifecycle_operation_id ||
      (!this.isOlderThan(
        worker.updated_at,
        WORKER_LIFECYCLE_REDRIVE_AFTER_MS
      ) &&
        !this.isExpiredProvisioningLifecycle(
          worker,
          terminalizeExpiredProvisioning
        ))
    ) {
      return false;
    }

    const current = await this.executeFenced(context, () =>
      this.workerService.viewWorkerForMonitorConsistent(worker.worker_id)
    );
    if (
      !current ||
      current.deleted_at ||
      current.account_id !== worker.account_id ||
      current.server_id !== server.server_id ||
      current.worker_type_id !== worker.worker_type_id ||
      (current.worker_status_id !== EWorkerStatus.recreating &&
        current.worker_status_id !== EWorkerStatus.creating &&
        current.worker_status_id !== EWorkerStatus.error &&
        current.worker_status_id !== EWorkerStatus.deleting) ||
      current.lifecycle_operation_id !== worker.lifecycle_operation_id ||
      (!this.isOlderThan(
        current.updated_at,
        WORKER_LIFECYCLE_REDRIVE_AFTER_MS
      ) &&
        !this.isExpiredProvisioningLifecycle(
          current,
          terminalizeExpiredProvisioning
        ))
    ) {
      return false;
    }
    const lifecycleOperationId = current.lifecycle_operation_id;
    if (!lifecycleOperationId) {
      return false;
    }

    const lifecycleActive = await this.executeFenced(context, () =>
      this.workerLifecycleLockService.isLocked(current.worker_id)
    );
    if (lifecycleActive) {
      logLocalConnectionStatus(
        'service.monitor.lifecycle_redrive_active_skipped',
        {
          layer: 'service.monitor',
          worker_id: current.worker_id,
          account_id: current.account_id,
          worker_type_id: current.worker_type_id,
          lifecycle_operation_id: lifecycleOperationId,
          server_id: current.server_id,
        }
      );
      return true;
    }

    if (
      await this.suppressTerminalWhatsappProviderHandoffRedrive(
        current,
        context
      )
    ) {
      return true;
    }

    if (
      await this.reconcileStaleWhatsappProviderHandoffTarget(current, context)
    ) {
      return true;
    }

    const claimed = await this.executeFenced(context, () =>
      this.workerLifecycleLockService.tryClaimRedrive(
        current.worker_id,
        lifecycleOperationId,
        WORKER_LIFECYCLE_REDRIVE_COOLDOWN_MS
      )
    );
    if (!claimed) {
      return true;
    }
    const redriveClaimToken = typeof claimed === 'string' ? claimed : undefined;

    if (
      terminalizeExpiredProvisioning &&
      this.isExpiredProvisioningLifecycle(current, true)
    ) {
      const lifecycleBecameActive = await this.executeFenced(context, () =>
        this.workerLifecycleLockService.isLocked(current.worker_id)
      );
      if (lifecycleBecameActive) {
        await this.workerLifecycleLockService
          .releaseRedriveClaim(
            current.worker_id,
            lifecycleOperationId,
            redriveClaimToken
          )
          .catch(() => undefined);
        return true;
      }
      await this.terminalizeExpiredProvisioningLifecycle(
        current,
        lifecycleOperationId,
        context
      );
      await this.workerLifecycleLockService
        .releaseRedriveClaim(
          current.worker_id,
          lifecycleOperationId,
          redriveClaimToken
        )
        .catch(() => undefined);
      return true;
    }

    let redriven: IWorkerLifecycleQueueMessage[];
    try {
      if (
        await this.suppressTerminalWhatsappProviderHandoffRedrive(
          current,
          context
        )
      ) {
        await this.workerLifecycleLockService
          .releaseRedriveClaim(
            current.worker_id,
            lifecycleOperationId,
            redriveClaimToken
          )
          .catch(() => undefined);
        return true;
      }
      redriven = await this.executeFenced(
        context,
        () =>
          (redriveClaimToken
            ? this.workerLifecycleQueueService.redrivePrepared?.(
                current.worker_id,
                lifecycleOperationId,
                undefined,
                redriveClaimToken
              )
            : this.workerLifecycleQueueService.redrivePrepared?.(
                current.worker_id,
                lifecycleOperationId
              )) ?? Promise.resolve([])
      );
    } catch (error) {
      await this.workerLifecycleLockService
        .releaseRedriveClaim(
          current.worker_id,
          lifecycleOperationId,
          redriveClaimToken
        )
        .catch(() => undefined);
      throw error;
    }

    if (redriven.length === 0) {
      if (current.worker_status_id === EWorkerStatus.error) {
        try {
          await this.clearMissingErrorLifecycleFence(
            current,
            lifecycleOperationId,
            context
          );
        } catch (error) {
          await this.workerLifecycleLockService
            .releaseRedriveClaim(
              current.worker_id,
              lifecycleOperationId,
              redriveClaimToken
            )
            .catch(() => undefined);
          throw error;
        }
        await this.workerLifecycleLockService
          .releaseRedriveClaim(
            current.worker_id,
            lifecycleOperationId,
            redriveClaimToken
          )
          .catch(() => undefined);
        return true;
      }

      const confirmed = await this.executeFenced(context, () =>
        this.workerService.viewWorkerForMonitorConsistent(current.worker_id)
      );
      if (
        !confirmed ||
        confirmed.deleted_at ||
        confirmed.account_id !== current.account_id ||
        confirmed.server_id !== current.server_id ||
        confirmed.worker_type_id !== current.worker_type_id ||
        confirmed.worker_status_id !== current.worker_status_id ||
        confirmed.lifecycle_operation_id !== lifecycleOperationId ||
        confirmed.container_id !== current.container_id ||
        confirmed.runtime_container_id !== current.runtime_container_id ||
        confirmed.runtime_generation !== current.runtime_generation
      ) {
        await this.workerLifecycleLockService
          .releaseRedriveClaim(
            current.worker_id,
            lifecycleOperationId,
            redriveClaimToken
          )
          .catch(() => undefined);
        return true;
      }
      const lifecycleBecameActive = await this.executeFenced(context, () =>
        this.workerLifecycleLockService.isLocked(confirmed.worker_id)
      );
      if (lifecycleBecameActive) {
        await this.workerLifecycleLockService
          .releaseRedriveClaim(
            current.worker_id,
            lifecycleOperationId,
            redriveClaimToken
          )
          .catch(() => undefined);
        return true;
      }

      const reconstructed =
        this.reconstructMissingProvisioningLifecyclePayload(confirmed);
      if (reconstructed) {
        try {
          await this.executeFenced(context, () =>
            this.workerLifecycleQueueService.prepare(reconstructed)
          );
          await this.executeFenced(context, () =>
            this.workerLifecycleQueueService.publish({
              ...reconstructed,
              ...(redriveClaimToken
                ? { redrive_claim_token: redriveClaimToken }
                : {}),
            })
          );
        } catch (error) {
          await this.workerLifecycleLockService
            .releaseRedriveClaim(
              current.worker_id,
              lifecycleOperationId,
              redriveClaimToken
            )
            .catch(() => undefined);
          throw error;
        }

        logLocalConnectionStatus(
          'service.monitor.lifecycle_redrive_reconstructed_cold',
          {
            layer: 'service.monitor',
            worker_id: current.worker_id,
            account_id: current.account_id,
            worker_type_id: current.worker_type_id,
            lifecycle_operation_id: lifecycleOperationId,
            server_id: current.server_id,
            action: reconstructed.action,
            reason: 'durable_payload_missing',
          }
        );
        return true;
      }

      logLocalConnectionStatus(
        'service.monitor.lifecycle_redrive_payload_missing',
        {
          layer: 'service.monitor',
          worker_id: current.worker_id,
          account_id: current.account_id,
          worker_type_id: current.worker_type_id,
          lifecycle_operation_id: lifecycleOperationId,
          server_id: current.server_id,
        }
      );
      await this.workerLifecycleLockService
        .releaseRedriveClaim(
          current.worker_id,
          lifecycleOperationId,
          redriveClaimToken
        )
        .catch(() => undefined);
      return true;
    }

    logLocalConnectionStatus('service.monitor.lifecycle_redrive_enqueued', {
      layer: 'service.monitor',
      worker_id: current.worker_id,
      account_id: current.account_id,
      worker_type_id: current.worker_type_id,
      lifecycle_operation_id: lifecycleOperationId,
      server_id: current.server_id,
      recovered_messages: redriven.length,
    });
    return true;
  };

  private readonly terminalizeExpiredProvisioningLifecycle = async (
    worker: IWorkerMonitor,
    lifecycleOperationId: string,
    context: ILockLeaseContext
  ): Promise<void> => {
    const terminalized = await this.executeFenced(context, () =>
      this.workerService.updateWorkerByIdIfLifecycleMatches(
        worker.account_id,
        {
          worker_id: worker.worker_id,
          worker_status_id: EWorkerStatus.error,
          lifecycle_operation_id: null,
        },
        {
          lifecycle_operation_id: lifecycleOperationId,
          container_id: worker.container_id,
          ...(worker.runtime_container_id &&
          Number.isSafeInteger(worker.runtime_generation) &&
          Number(worker.runtime_generation) > 0
            ? {
                runtime_container_id: worker.runtime_container_id,
                runtime_generation: Number(worker.runtime_generation),
              }
            : {}),
          server_id: worker.server_id,
          worker_type_id: worker.worker_type_id,
          worker_status_id: worker.worker_status_id,
          updated_at: worker.updated_at,
        }
      )
    );

    logLocalConnectionStatus(
      terminalized
        ? 'service.monitor.provisioning_lifecycle_max_age_terminalized'
        : 'service.monitor.provisioning_lifecycle_max_age_cas_lost',
      {
        layer: 'service.monitor',
        worker_id: worker.worker_id,
        account_id: worker.account_id,
        worker_type_id: worker.worker_type_id,
        previous_worker_status_id: worker.worker_status_id,
        worker_status_id: terminalized
          ? EWorkerStatus.error
          : worker.worker_status_id,
        lifecycle_operation_id: lifecycleOperationId,
        server_id: worker.server_id,
        runtime_container_id: worker.runtime_container_id ?? undefined,
        runtime_generation: worker.runtime_generation ?? undefined,
        max_active_ms: WORKER_LIFECYCLE_MAX_ACTIVE_MS,
      }
    );
  };

  private readonly clearMissingErrorLifecycleFence = async (
    worker: IWorkerMonitor,
    lifecycleOperationId: string,
    context: ILockLeaseContext
  ): Promise<void> => {
    const cleared = await this.executeFenced(context, () =>
      this.workerService.updateWorkerByIdIfLifecycleMatches(
        worker.account_id,
        {
          worker_id: worker.worker_id,
          worker_status_id: EWorkerStatus.error,
          lifecycle_operation_id: null,
        },
        {
          lifecycle_operation_id: lifecycleOperationId,
          server_id: worker.server_id,
          worker_type_id: worker.worker_type_id,
          worker_status_id: EWorkerStatus.error,
        }
      )
    );

    logLocalConnectionStatus(
      cleared
        ? 'service.monitor.error_lifecycle_missing_journal_fence_cleared'
        : 'service.monitor.error_lifecycle_missing_journal_cas_lost',
      {
        layer: 'service.monitor',
        worker_id: worker.worker_id,
        account_id: worker.account_id,
        worker_type_id: worker.worker_type_id,
        worker_status_id: EWorkerStatus.error,
        lifecycle_operation_id: lifecycleOperationId,
        server_id: worker.server_id,
      }
    );
  };

  private readonly reconstructMissingProvisioningLifecyclePayload = (
    worker: IWorkerMonitor
  ): IWorkerLifecycleQueueMessage | null => {
    const operationId = worker.lifecycle_operation_id;
    if (!operationId) {
      return null;
    }

    if (worker.worker_status_id === EWorkerStatus.creating) {
      return {
        request_id: uuidv7(),
        operation_id: operationId,
        action: 'create',
        worker_id: worker.worker_id,
        account_id: worker.account_id,
        server_id: worker.server_id,
        worker_type_id: worker.worker_type_id,
        worker_status_id: EWorkerStatus.creating,
        source: 'worker_create',
        debug_trace_id: operationId,
        requested_at: currentTime(),
      };
    }

    if (worker.worker_status_id !== EWorkerStatus.recreating) {
      return null;
    }

    /*
     * The immutable Redis journal is the source of truth for destructive
     * reset flags and warm identity. If it was lost, the only safe automatic
     * recovery is a cold, session-preserving recreate under the same database
     * fence. A queued original delivery or a later redelivery then becomes an
     * idempotent/stale no-op instead of leaving the channel in `recreating`.
     */
    return {
      request_id: uuidv7(),
      operation_id: operationId,
      action: 'recreate',
      worker_id: worker.worker_id,
      account_id: worker.account_id,
      server_id: worker.server_id,
      worker_type_id: worker.worker_type_id,
      worker_status_id: EWorkerStatus.recreating,
      source: 'worker_recreate',
      previous_worker_status_id: EWorkerStatus.recreating,
      recovery_without_journal: true,
      debug_trace_id: operationId,
      requested_at: currentTime(),
    };
  };

  private readonly redrivePendingPermanentDeletionFinalizers = async (
    context: ILockLeaseContext
  ): Promise<void> => {
    let pending: IWorkerLifecycleQueueMessage[];
    try {
      pending = await this.executeFenced(context, () =>
        this.workerLifecycleQueueService.listPendingPermanentDeletions(100)
      );
    } catch (error) {
      logLocalConnectionStatus(
        'service.monitor.delete_finalizer_index_unavailable',
        {
          layer: 'service.monitor',
          reason: error instanceof Error ? error.message : String(error),
        }
      );
      return;
    }

    for (const payload of pending) {
      context.assertActive();
      const current = await this.executeFenced(context, () =>
        this.workerService.viewWorkerForMonitorConsistent(payload.worker_id)
      );
      if (
        !current ||
        current.account_id !== payload.account_id ||
        current.worker_status_id !== EWorkerStatus.deleting ||
        current.lifecycle_operation_id !== payload.operation_id
      ) {
        logLocalConnectionStatus(
          'service.monitor.delete_finalizer_not_authoritative',
          {
            layer: 'service.monitor',
            worker_id: payload.worker_id,
            account_id: payload.account_id,
            lifecycle_operation_id: payload.operation_id,
            persisted_account_id: current?.account_id,
            persisted_worker_status_id: current?.worker_status_id,
            persisted_lifecycle_operation_id:
              current?.lifecycle_operation_id ?? undefined,
            persisted_deleted_at: current?.deleted_at,
          }
        );
        continue;
      }
      if (await this.workerLifecycleLockService.isLocked(payload.worker_id)) {
        continue;
      }
      const claimed = await this.workerLifecycleLockService.tryClaimRedrive(
        payload.worker_id,
        payload.operation_id,
        WORKER_LIFECYCLE_REDRIVE_COOLDOWN_MS
      );
      if (!claimed) {
        continue;
      }
      const redriveClaimToken =
        typeof claimed === 'string' ? claimed : undefined;
      try {
        await this.executeFenced(context, () =>
          this.workerLifecycleQueueService.publish(
            redriveClaimToken
              ? { ...payload, redrive_claim_token: redriveClaimToken }
              : payload
          )
        );
        logLocalConnectionStatus('service.monitor.delete_finalizer_redriven', {
          layer: 'service.monitor',
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          lifecycle_operation_id: payload.operation_id,
          persisted_deleted_at: current.deleted_at,
        });
      } catch (error) {
        await this.workerLifecycleLockService
          .releaseRedriveClaim(
            payload.worker_id,
            payload.operation_id,
            redriveClaimToken
          )
          .catch(() => undefined);
        logLocalConnectionStatus(
          'service.monitor.delete_finalizer_redrive_failed',
          {
            layer: 'service.monitor',
            worker_id: payload.worker_id,
            account_id: payload.account_id,
            lifecycle_operation_id: payload.operation_id,
            reason: error instanceof Error ? error.message : String(error),
          }
        );
      }
    }
  };

  private readonly isStuck = (worker: IWorkerMonitor): boolean => {
    if (worker.lifecycle_operation_id) {
      /*
       * An existing operation is redriven with the same id above. Never
       * supersede its database fence merely because a worst-case gRPC deadline
       * elapsed; the original process may still be completing an external
       * effect.
       */
      return false;
    }

    if (!this.isProvisioning(worker)) {
      return false;
    }

    return this.isOlderThan(worker.updated_at, this.timeoutMinutes * MINUTE_MS);
  };

  private readonly isDeletingTimeout = (worker: IWorkerMonitor): boolean => {
    if (worker.worker_status_id !== EWorkerStatus.deleting) {
      return false;
    }

    const result = this.isOlderThanTimeout(worker.updated_at);
    return result;
  };

  private readonly isPlanCancelled = (
    plan: IPlanAccountStatus | null
  ): boolean => {
    if (!plan) {
      return false;
    }

    const blocked = plan.account_status_id === EAccountStatus.blocked;
    if (blocked) {
      return true;
    }

    const nextPayment = plan.next_payment_date
      ? new Date(plan.next_payment_date)
      : null;
    const invalidDate = !nextPayment || Number.isNaN(nextPayment.getTime());
    if (invalidDate) {
      return false;
    }

    const expired = nextPayment.getTime() <= Date.now();
    if (expired) {
      return true;
    }

    const inactive = plan.account_status_id === EAccountStatus.inactive;
    if (inactive && plan.cancellation_date) {
      return true;
    }

    return false;
  };

  private readonly isOlderThanTimeout = (dateIso: string | null): boolean => {
    return this.isOlderThan(dateIso, this.timeoutMinutes * MINUTE_MS);
  };

  private readonly isOlderThan = (
    dateIso: string | null,
    timeoutMs: number
  ): boolean => {
    if (!dateIso) {
      return true;
    }

    const parsed = new Date(dateIso);
    if (Number.isNaN(parsed.getTime())) {
      return true;
    }

    const diff = Date.now() - parsed.getTime();
    const result = diff > timeoutMs;
    return result;
  };

  private readonly isLifecycleOperationOlderThan = (
    lifecycleOperationId: string,
    fallbackUpdatedAt: string | null,
    timeoutMs: number
  ): boolean => {
    const match =
      /^([0-9a-f]{8})-([0-9a-f]{4})-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.exec(
        lifecycleOperationId
      );
    if (!match) {
      return this.isOlderThan(fallbackUpdatedAt, timeoutMs);
    }

    const createdAtMs = Number.parseInt(`${match[1]}${match[2]}`, 16);
    if (!Number.isSafeInteger(createdAtMs) || createdAtMs <= 0) {
      return this.isOlderThan(fallbackUpdatedAt, timeoutMs);
    }

    return Date.now() - createdAtMs > timeoutMs;
  };

  private readonly isExpiredProvisioningLifecycle = (
    worker: IWorkerMonitor,
    enabled: boolean
  ): boolean => {
    return Boolean(
      enabled &&
      worker.lifecycle_operation_id &&
      (worker.worker_status_id === EWorkerStatus.recreating ||
        worker.worker_status_id === EWorkerStatus.creating) &&
      this.isLifecycleOperationOlderThan(
        worker.lifecycle_operation_id,
        worker.updated_at,
        WORKER_LIFECYCLE_MAX_ACTIVE_MS
      )
    );
  };

  private readonly isConnectionCheckTimeout = (
    worker: IWorkerMonitor
  ): boolean => {
    if (!worker.last_connection_check_at) {
      return false;
    }

    const parsed = new Date(worker.last_connection_check_at);
    if (Number.isNaN(parsed.getTime())) {
      return false;
    }

    const diff = Date.now() - parsed.getTime();
    const minutes = diff / 1000 / 60;
    const result = minutes > this.stoppedTimeoutMinutes;
    return result;
  };

  private readonly isLatestActivityOlderThanOneDay = (
    worker: IWorkerMonitor
  ): boolean => {
    const timestamps = [
      worker.last_connection_check_at,
      worker.updated_at,
      worker.created_at,
    ]
      .map((dateIso) => {
        if (!dateIso) {
          return null;
        }

        const parsed = new Date(dateIso);
        if (Number.isNaN(parsed.getTime())) {
          return null;
        }

        return parsed.getTime();
      })
      .filter((timestamp): timestamp is number => timestamp !== null);

    if (!timestamps.length) {
      return true;
    }

    const latestActivity = Math.max(...timestamps);
    const diff = Date.now() - latestActivity;
    const minutes = diff / 1000 / 60;

    return minutes > this.stoppedTimeoutMinutes;
  };

  private readonly shouldStopDueToInactivity = (
    worker: IWorkerMonitor
  ): boolean => {
    const statuses = [
      EWorkerStatus.offline,
      EWorkerStatus.mismatched,
      EWorkerStatus.disponible,
    ];

    if (!statuses.includes(worker.worker_status_id)) {
      return false;
    }

    return this.isLatestActivityOlderThanOneDay(worker);
  };

  private readonly applyStoppedStatus = async (
    worker: IWorkerMonitor,
    context: ILockLeaseContext = UNFENCED_LOCK_LEASE_CONTEXT
  ): Promise<boolean> => {
    const currentWorker = await this.executeFenced(context, () =>
      this.workerService.viewWorkerForMonitorConsistent(worker.worker_id)
    );
    if (
      !currentWorker ||
      currentWorker.deleted_at ||
      currentWorker.account_id !== worker.account_id ||
      currentWorker.server_id !== worker.server_id ||
      currentWorker.worker_type_id !== worker.worker_type_id ||
      currentWorker.worker_status_id !== worker.worker_status_id ||
      currentWorker.lifecycle_operation_id ||
      !this.shouldStopDueToInactivity(currentWorker)
    ) {
      logLocalConnectionStatus(
        'service.monitor.inactivity_stop_skipped_after_fence',
        {
          layer: 'service.monitor',
          worker_id: worker.worker_id,
          account_id: worker.account_id,
          worker_type_id: worker.worker_type_id,
          previous_worker_status_id: worker.worker_status_id,
          current_worker_status_id: currentWorker?.worker_status_id,
          current_server_id: currentWorker?.server_id,
          lifecycle_operation_id:
            currentWorker?.lifecycle_operation_id ?? undefined,
        }
      );
      return false;
    }

    const updated = await this.executeFenced(context, () =>
      this.workerService.updateWorkerByIdIfLifecycleMatches(
        currentWorker.account_id,
        {
          worker_id: currentWorker.worker_id,
          worker_status_id: EWorkerStatus.stopped,
        },
        {
          lifecycle_operation_id: null,
          server_id: currentWorker.server_id,
          worker_type_id: currentWorker.worker_type_id,
          worker_status_id: currentWorker.worker_status_id,
          updated_at: currentWorker.updated_at,
          last_connection_check_at: currentWorker.last_connection_check_at,
        }
      )
    );
    if (!updated) {
      logLocalConnectionStatus('service.monitor.inactivity_stop_fence_lost', {
        layer: 'service.monitor',
        worker_id: currentWorker.worker_id,
        account_id: currentWorker.account_id,
        worker_type_id: currentWorker.worker_type_id,
        previous_worker_status_id: currentWorker.worker_status_id,
      });
      return false;
    }

    console.info('Worker stopped by inactivity monitor', {
      source: 'inactivity_monitor',
      worker_id: currentWorker.worker_id,
      account_id: currentWorker.account_id,
      worker_type_id: currentWorker.worker_type_id,
      previous_worker_status_id: currentWorker.worker_status_id,
      observed_updated_at: currentWorker.updated_at,
      observed_last_connection_check_at: currentWorker.last_connection_check_at,
    });

    const payload: IBaileysConnectionState = {
      code: ECodeMessage.info,
      status: EBaileysConnectionStatus.info,
      worker_id: currentWorker.worker_id,
      worker_name: currentWorker.name,
      account_id: currentWorker.account_id,
      worker_type_id: currentWorker.worker_type_id,
      worker_status_id: EWorkerStatus.stopped,
    };

    await this.executeFenced(context, () =>
      this.centrifugoService.publishSub(
        workerCentrifugoQueue(currentWorker.account_id),
        payload
      )
    );
    return true;
  };

  private readonly applyCanonicalStoppedStatus = async (
    worker: IWorkerMonitor,
    reason: 'container_missing' | 'container_not_running',
    context: ILockLeaseContext = UNFENCED_LOCK_LEASE_CONTEXT
  ): Promise<boolean> => {
    const currentWorker = await this.executeFenced(context, () =>
      this.workerService.viewWorkerForMonitorConsistent(worker.worker_id)
    );
    if (
      !currentWorker ||
      currentWorker.deleted_at ||
      currentWorker.account_id !== worker.account_id ||
      currentWorker.server_id !== worker.server_id ||
      currentWorker.worker_type_id !== worker.worker_type_id ||
      currentWorker.worker_status_id !== worker.worker_status_id ||
      currentWorker.container_id !== worker.container_id ||
      currentWorker.runtime_container_id !== worker.runtime_container_id ||
      currentWorker.runtime_generation !== worker.runtime_generation ||
      currentWorker.lifecycle_operation_id
    ) {
      return false;
    }

    const updated = await this.executeFenced(context, () =>
      this.workerService.updateWorkerByIdIfLifecycleMatches(
        currentWorker.account_id,
        {
          worker_id: currentWorker.worker_id,
          worker_status_id: EWorkerStatus.stopped,
        },
        {
          lifecycle_operation_id: null,
          container_id: currentWorker.container_id,
          runtime_container_id: currentWorker.runtime_container_id ?? undefined,
          runtime_generation:
            Number.isSafeInteger(currentWorker.runtime_generation) &&
            Number(currentWorker.runtime_generation) > 0
              ? Number(currentWorker.runtime_generation)
              : undefined,
          allow_disconnected_runtime: true,
          server_id: currentWorker.server_id,
          worker_type_id: currentWorker.worker_type_id,
          worker_status_id: currentWorker.worker_status_id,
          updated_at: currentWorker.updated_at,
          last_connection_check_at: currentWorker.last_connection_check_at,
        }
      )
    );
    if (!updated) {
      return false;
    }

    logLocalConnectionStatus('service.monitor.runtime_stopped_persisted', {
      layer: 'service.monitor',
      worker_id: currentWorker.worker_id,
      account_id: currentWorker.account_id,
      worker_type_id: currentWorker.worker_type_id,
      previous_worker_status_id: currentWorker.worker_status_id,
      worker_status_id: EWorkerStatus.stopped,
      server_id: currentWorker.server_id,
      container_id: currentWorker.runtime_container_id ?? undefined,
      runtime_generation: currentWorker.runtime_generation ?? undefined,
      reason,
    });

    const payload: IBaileysConnectionState = {
      code: ECodeMessage.info,
      status: EBaileysConnectionStatus.info,
      worker_id: currentWorker.worker_id,
      worker_name: currentWorker.name,
      account_id: currentWorker.account_id,
      worker_type_id: currentWorker.worker_type_id,
      worker_status_id: EWorkerStatus.stopped,
    };
    await this.executeFenced(context, () =>
      this.centrifugoService.publishSub(
        workerCentrifugoQueue(currentWorker.account_id),
        payload
      )
    );
    return true;
  };
}
