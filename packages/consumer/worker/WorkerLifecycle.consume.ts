import { FastifyInstance } from 'fastify';
import { inject, singleton } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { WorkerGrpcClientService } from '@core/services/workerGrpcClient.service';
import { WorkerService } from '@core/services/worker.service';
import { WorkerLifecycleQueueService } from '@core/services/workerLifecycleQueue.service';
import {
  IWorkerLifecycleQueueMessage,
  workerLifecycleQueueActionToWorkerAction,
} from '@core/common/interfaces/IWorkerLifecycleQueueMessage';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';
import type { KafkaConsumerRunnerDiscardReason } from '@core/common/interfaces/KafkaConsumerRunnerOptions';
import { ConnectionLifecycleDebugService } from '@core/services/connectionLifecycleDebug.service';
import { WorkerRecreateServerSlotService } from '@core/services/workerRecreateServerSlot.service';
import { WorkerLifecycleLockService } from '@core/services/workerLifecycleLock.service';
import { WorkerRuntimeRepository } from '@core/repositories/worker/WorkerRuntime.repository';
import type { IWorkerRuntimeHealthResponseProto } from '@core/common/interfaces/IWorkerRuntimeActivationProto';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import type { IWorkerMonitor } from '@core/common/interfaces/IWorkerMonitor';
import { canActivateWorkerWarmRuntime } from '@core/common/functions/workerWarmActivationPolicy';
import { WARM_ACTIVATION_CONFIRMED_CLEANUP } from '@core/common/functions/workerWarmActivationOutcome';
import { workerLifecycleSemanticFingerprint } from '@core/common/functions/workerLifecycleSemanticFingerprint';
import {
  isWorkerLifecycleBudgetExhaustionError,
  workerLifecycleBudgets,
} from '@core/common/functions/workerLifecycleBudgets';
import { isWorkerLifecycleAuthoritativeConflictError } from '@core/common/functions/workerLifecycleErrorPolicy';
import {
  isWhatsappConnectionOnline,
  normalizeWhatsappConnectionStatus,
} from '@core/common/functions/whatsappConnectionStatus';
import {
  hasWorkerLifecycleSessionStorageMigrationMetadata,
  isProtectedWorkerLifecycleSessionStorageMigration,
  isProtectedWorkerLifecycleSessionStorageMigrationFinalization,
} from '@core/common/functions/workerLifecycleSessionStorageMigration';

const WORKER_LIFECYCLE_MAX_RETRIES = 3;
const WORKER_LIFECYCLE_MAX_IN_FLIGHT_TOTAL = 8;
const WORKER_LIFECYCLE_MAX_IN_FLIGHT_PER_PARTITION = 4;
const WARM_ACTIVATION_GRPC_DEADLINE_MS = workerLifecycleBudgets.grpcDeadlineMs;
const LIFECYCLE_QUEUE_DELAY_WARN_MS = 60_000;
const WORKER_LIFECYCLE_ACTIONS = new Set([
  'create',
  'recreate',
  'activate_warm',
  'cleanup_previous_runtime',
  'delete',
] as const);
const WORKER_LIFECYCLE_SOURCES = new Set([
  'worker_create',
  'worker_recreate',
  'worker_update',
  'config_recreate',
  'reset_connection',
  'self_heal',
  'plan_limit_enforcement',
  'plan_cancellation',
  'channel_delete',
  'worker_delete',
] as const);
const WORKER_TYPES = new Set<string>(Object.values(EWorkerType));
const WORKER_STATUSES = new Set<string>(Object.values(EWorkerStatus));
const WORKER_SESSION_STORAGES = new Set<string>(
  Object.values(EWorkerSessionStorage)
);
const CONTAINER_ID_PATTERN = /^[0-9a-f]{64}$/i;
const CONNECTION_STATUS_SOURCE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const WORKER_TYPE_CONNECTION_PROVIDER: Partial<
  Record<EWorkerType, 'baileys' | 'wwebjs' | 'whatsmeow'>
> = {
  [EWorkerType.baileys]: 'baileys',
  [EWorkerType.wwebjs]: 'wwebjs',
  [EWorkerType.whatsmeow]: 'whatsmeow',
};
const CONTAINER_HEALTH_STATUSES = new Set([
  'unhealthy',
  'healthy',
  'starting',
  'none',
]);
const ACTION_STATUSES: Record<
  IWorkerLifecycleQueueMessage['action'],
  ReadonlySet<EWorkerStatus>
> = {
  create: new Set([EWorkerStatus.creating]),
  recreate: new Set([EWorkerStatus.recreating]),
  activate_warm: new Set([EWorkerStatus.creating, EWorkerStatus.recreating]),
  cleanup_previous_runtime: new Set([
    EWorkerStatus.recreating,
    EWorkerStatus.blocked,
  ]),
  delete: new Set([EWorkerStatus.deleting]),
};
const ACTION_SOURCES: Record<
  IWorkerLifecycleQueueMessage['action'],
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
  cleanup_previous_runtime: new Set([
    'worker_update',
    'reset_connection',
    'plan_limit_enforcement',
  ]),
  delete: new Set(['plan_cancellation', 'channel_delete', 'worker_delete']),
};

type TerminalRuntimeReconciliation =
  | 'not_applicable'
  | 'not_ready'
  | 'reconciled'
  | 'fence_changed'
  | 'probe_unavailable';

type OnlineRecreateRearm = 'rearmed' | 'fence_changed';

type PostgresProviderHandoffTargetDecision =
  'not_handoff' | 'pending_source_drain' | 'authorized';

class WorkerProviderHandoffSourceDrainPendingError extends Error {
  constructor(readonly workerId: string) {
    super(
      `WhatsApp provider handoff source drain remains pending for ${workerId}`
    );
    this.name = 'WorkerProviderHandoffSourceDrainPendingError';
    Object.setPrototypeOf(
      this,
      WorkerProviderHandoffSourceDrainPendingError.prototype
    );
  }
}

function resolveWorkerLifecycleCoalesceKey(
  payload: IWorkerLifecycleQueueMessage
): string {
  return workerLifecycleSemanticFingerprint(payload);
}

@singleton()
export class WorkerLifecycleConsume {
  private consumer: KafkaConsumer | null = null;
  private runner: KafkaConsumerRunner<IWorkerLifecycleQueueMessage> | null =
    null;
  private isRunning = false;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(WorkerGrpcClientService)
    private readonly workerGrpcClientService: WorkerGrpcClientService,
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(WorkerLifecycleQueueService)
    private readonly workerLifecycleQueueService: WorkerLifecycleQueueService,
    @inject(ConnectionLifecycleDebugService)
    private readonly connectionLifecycleDebugService: ConnectionLifecycleDebugService = {
      log: async () => undefined,
    } as unknown as ConnectionLifecycleDebugService,
    @inject(WorkerRecreateServerSlotService)
    private readonly workerRecreateServerSlotService: WorkerRecreateServerSlotService = {
      releaseReservedSlot: async () => undefined,
    } as unknown as WorkerRecreateServerSlotService,
    @inject(WorkerLifecycleLockService)
    private readonly workerLifecycleLockService: WorkerLifecycleLockService = {
      isLocked: async () => false,
      releaseRedriveClaim: async () => false,
    } as unknown as WorkerLifecycleLockService,
    @inject(WorkerRuntimeRepository)
    private readonly workerRuntimeRepository: WorkerRuntimeRepository = undefined as never
  ) {}

  async execute(server: FastifyInstance): Promise<void> {
    if (this.consumer && this.isRunning) {
      return;
    }

    const topic = this.kafkaServiceQueueService.workerLifecycleRequest();
    this.runner = new KafkaConsumerRunner<IWorkerLifecycleQueueMessage>({
      kafka: this.kafka,
      topic,
      groupId: 'group-underchat-worker-lifecycle',
      parse: (message) => this.parsePayload(message.value),
      resolveCoalesceKey: resolveWorkerLifecycleCoalesceKey,
      resolveEntityKey: (payload) => payload.worker_id,
      preserveEntityOrder: true,
      handle: (payload, context) => {
        this.warnIfQueueDeliveryIsDelayed(server, payload);
        return this.processPayload(payload, context.assertActive);
      },
      onInvalidMessage: () => {
        server.log.warn('Skipping invalid worker lifecycle payload');
      },
      onFailed: (payload, context, error) => {
        if (isWorkerLifecycleAuthoritativeConflictError(error)) {
          server.log.warn(
            {
              err: error,
              workerId: payload.worker_id,
              action: payload.action,
              operationId: payload.operation_id,
              attempt: context.attempt,
            },
            'Worker lifecycle authoritative conflict deferred to durable redrive'
          );
          return;
        }

        server.log.error(
          {
            err: error,
            workerId: payload.worker_id,
            action: payload.action,
            operationId: payload.operation_id,
          },
          'Worker lifecycle consume failed'
        );
      },
      onDiscarded: async (payload, context, error, discardReason) => {
        const lifecycleBudgetExhausted =
          isWorkerLifecycleBudgetExhaustionError(error);
        const authoritativeLifecycleConflict =
          isWorkerLifecycleAuthoritativeConflictError(error);
        if (
          !(await this.isAuthoritativePreparedPayload(
            payload,
            context.assertActive
          ))
        ) {
          return;
        }

        if (await this.isConcurrentLifecycleStillActive(payload)) {
          await this.releaseOwnedRedriveClaim(payload);
          server.log.warn(
            {
              workerId: payload.worker_id,
              operationId: payload.operation_id,
            },
            'Discarding duplicate lifecycle redrive while the original operation remains active'
          );
          return;
        }

        try {
          await this.runPreparedCleanupDependency(
            payload,
            context.assertActive
          );
          if (
            await this.finalizeAlreadyOnlineLifecycle(
              payload,
              context.assertActive
            )
          ) {
            await this.releaseReservedRecreateSlotBestEffort(payload);
            return;
          }
        } catch (onlineReconciliationError) {
          void this.connectionLifecycleDebugService.log(
            'service.lifecycle_queue.online_reconciliation_deferred',
            {
              trace_id: payload.debug_trace_id,
              layer: 'service',
              worker_id: payload.worker_id,
              account_id: payload.account_id,
              worker_type_id: payload.worker_type_id,
              lifecycle_operation_id: payload.operation_id,
              action: payload.action,
              source: payload.source,
              reason:
                onlineReconciliationError instanceof Error
                  ? onlineReconciliationError.message
                  : String(onlineReconciliationError),
            }
          );
          await this.releaseReservedRecreateSlotBestEffort(payload);
          return;
        }

        if (payload.expected_container_id) {
          if (
            !lifecycleBudgetExhausted &&
            !authoritativeLifecycleConflict &&
            (await this.hasOwnedLivenessReplacement(payload))
          ) {
            try {
              context.assertActive();
              await this.processPayload(payload, context.assertActive);
              context.assertActive();
              await this.releaseReservedRecreateSlotBestEffort(payload);
              return;
            } catch (recoveryError) {
              void this.connectionLifecycleDebugService.log(
                'service.lifecycle_queue.liveness_replacement_recovery_deferred',
                {
                  trace_id: payload.debug_trace_id,
                  layer: 'service',
                  worker_id: payload.worker_id,
                  account_id: payload.account_id,
                  worker_type_id: payload.worker_type_id,
                  lifecycle_operation_id: payload.operation_id,
                  container_id: payload.expected_container_id,
                  runtime_generation: payload.expected_runtime_generation,
                  reason:
                    recoveryError instanceof Error
                      ? recoveryError.message
                      : String(recoveryError),
                }
              );
            }
          }
          /*
           * A liveness recreate may have already disabled restart policy,
           * removed the old container, or lost a Docker response. Clearing its
           * lifecycle fence after the in-memory retry budget would make the
           * prepared command stale and could strand restart=no forever. Keep
           * the durable operation/journal intact; the lifecycle reconciler can
           * redrive the same idempotent compare-and-remove command.
           */
          void this.connectionLifecycleDebugService.log(
            'service.lifecycle_queue.liveness_recreate_retry_pending',
            {
              trace_id: payload.debug_trace_id,
              layer: 'service',
              worker_id: payload.worker_id,
              account_id: payload.account_id,
              worker_type_id: payload.worker_type_id,
              lifecycle_operation_id: payload.operation_id,
              container_id: payload.expected_container_id,
              runtime_generation: payload.expected_runtime_generation,
              source: payload.source,
              reason: error instanceof Error ? error.message : String(error),
            }
          );
          await this.releaseReservedRecreateSlotBestEffort(payload);
          return;
        }

        if (
          payload.action !== 'cleanup_previous_runtime' &&
          payload.action !== 'delete' &&
          payload.worker_status_id
        ) {
          try {
            const reconciliation = await this.reconcileHealthyTerminalRuntime(
              payload,
              payload.worker_status_id,
              context.assertActive
            );
            if (
              reconciliation === 'reconciled' ||
              reconciliation === 'fence_changed'
            ) {
              await this.releaseReservedRecreateSlotBestEffort(payload);
              return;
            }
          } catch (reconciliationError) {
            void this.connectionLifecycleDebugService.log(
              'service.lifecycle_queue.runtime_reconciliation_deferred',
              {
                trace_id: payload.debug_trace_id,
                layer: 'service',
                worker_id: payload.worker_id,
                account_id: payload.account_id,
                worker_type_id: payload.worker_type_id,
                lifecycle_operation_id: payload.operation_id,
                source: payload.source,
                reason:
                  reconciliationError instanceof Error
                    ? reconciliationError.message
                    : String(reconciliationError),
              }
            );
          }
        }

        if (
          discardReason !== 'invalid_payload' &&
          (await this.terminalizePostgresServerMigrationFailure(
            payload,
            error,
            discardReason,
            context.assertActive
          ))
        ) {
          await this.releaseReservedRecreateSlotBestEffort(payload);
          return;
        }

        /*
         * The exact command is durable and the database operation remains its
         * execution fence. Exhausting the in-memory retry budget commits this
         * Kafka record so the partition can progress, but never clears the
         * claim: the fast journal redrive republishes the same idempotent
         * operation after the external dependency recovers.
         */
        void this.connectionLifecycleDebugService.log(
          'service.lifecycle_queue.retry_pending_fast_redrive',
          {
            trace_id: payload.debug_trace_id,
            layer: 'service',
            worker_id: payload.worker_id,
            account_id: payload.account_id,
            worker_type_id: payload.worker_type_id,
            lifecycle_operation_id: payload.operation_id,
            action: payload.action,
            source: payload.source,
            reason: error instanceof Error ? error.message : String(error),
          }
        );
        await this.releaseReservedRecreateSlotBestEffort(payload);
      },
      classifyError: (_payload, _context, error) =>
        this.classifyLifecycleError(error),
      failOnDiscardedHookError: true,
      /*
       * A slow Balance must neither consume the whole process budget nor hold
       * every later worker hashed to the same Kafka partition. Four records
       * per partition allow independent workers to bypass one slow head while
       * entity ordering still serializes commands for the same worker. The
       * per-process total bounds memory and remote pressure.
       *
       * Warm activation retries are deliberately finite. The exact command is
       * journaled before publication and the monitor can redrive it, so an
       * unavailable server cannot pin a partition forever.
       */
      maxInFlightTotal: WORKER_LIFECYCLE_MAX_IN_FLIGHT_TOTAL,
      maxInFlightPerPartition: WORKER_LIFECYCLE_MAX_IN_FLIGHT_PER_PARTITION,
      maxRetries: WORKER_LIFECYCLE_MAX_RETRIES,
      retryDelaysMs: [1000, 5000],
      logger: server.log,
    });

    await this.runner.start(() => {
      this.isRunning = true;
    });
    this.consumer = this.runner.consumer;
  }

  async close(): Promise<void> {
    this.isRunning = false;
    if (this.runner) {
      await this.runner.close();
      this.runner = null;
    }
    this.consumer = null;
  }

  private warnIfQueueDeliveryIsDelayed(
    server: FastifyInstance,
    payload: IWorkerLifecycleQueueMessage
  ): void {
    const requestedAtMs = Date.parse(payload.requested_at);
    const queueDelayMs = Date.now() - requestedAtMs;
    if (
      !Number.isFinite(queueDelayMs) ||
      queueDelayMs < LIFECYCLE_QUEUE_DELAY_WARN_MS
    ) {
      return;
    }

    server.log.warn(
      {
        workerId: payload.worker_id,
        serverId: payload.server_id,
        action: payload.action,
        operationId: payload.operation_id,
        queueDelayMs,
      },
      'Worker lifecycle command delivery exceeded its queue-delay budget'
    );
  }

  private async processPayload(
    payload: IWorkerLifecycleQueueMessage,
    assertActive: () => void
  ): Promise<void> {
    assertActive();
    void this.connectionLifecycleDebugService.log(
      'service.lifecycle_queue.consumed',
      {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        worker_type_id: payload.worker_type_id,
        lifecycle_operation_id: payload.operation_id,
        action: payload.action,
        source: payload.source,
      }
    );
    if (!(await this.isAuthoritativePreparedPayload(payload, assertActive))) {
      void this.connectionLifecycleDebugService.log(
        'service.lifecycle_queue.stale_journal_payload',
        {
          trace_id: payload.debug_trace_id,
          layer: 'service',
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          worker_type_id: payload.worker_type_id,
          lifecycle_operation_id: payload.operation_id,
          action: payload.action,
          source: payload.source,
        }
      );
      return;
    }
    assertActive();
    let staleResolution = await this.resolveStaleReason(payload);
    let cleanupDependencySatisfied = false;
    if (staleResolution.providerHandoffTargetPendingSourceDrain) {
      void this.connectionLifecycleDebugService.log(
        'service.lifecycle_queue.provider_handoff_source_drain_dependency',
        {
          trace_id: payload.debug_trace_id,
          layer: 'service',
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          worker_type_id: payload.worker_type_id,
          lifecycle_operation_id: payload.operation_id,
          action: payload.action,
          source: payload.source,
          reason: 'target_waiting_for_source_drain',
        }
      );
      await this.runPreparedCleanupDependency(payload, assertActive);
      cleanupDependencySatisfied = true;
      assertActive();
      staleResolution = await this.resolveStaleReason(payload);
      assertActive();
      if (staleResolution.providerHandoffTargetPendingSourceDrain) {
        throw new WorkerProviderHandoffSourceDrainPendingError(
          payload.worker_id
        );
      }
    }
    const stale = staleResolution.reason;
    assertActive();
    if (stale) {
      void this.connectionLifecycleDebugService.log(
        'service.lifecycle_queue.stale',
        {
          trace_id: payload.debug_trace_id,
          layer: 'service',
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          worker_type_id: payload.worker_type_id,
          lifecycle_operation_id: payload.operation_id,
          action: payload.action,
          source: payload.source,
          reason: stale,
        }
      );
      assertActive();
      await this.releaseReservedRecreateSlot(payload);
      assertActive();
      return;
    }

    assertActive();
    if (
      await this.suppressTerminalWhatsappProviderHandoffDelivery(
        payload,
        assertActive
      )
    ) {
      return;
    }
    assertActive();
    if (await this.isConcurrentLifecycleStillActive(payload)) {
      await this.releaseOwnedRedriveClaim(payload);
      assertActive();
      void this.connectionLifecycleDebugService.log(
        'service.lifecycle_queue.concurrent_operation_deferred',
        {
          trace_id: payload.debug_trace_id,
          layer: 'service',
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          worker_type_id: payload.worker_type_id,
          lifecycle_operation_id: payload.operation_id,
          action: payload.action,
          source: payload.source,
          reason: 'worker_lifecycle_lock_active_or_unavailable',
        }
      );
      throw new Error(
        `Worker lifecycle operation remains active for ${payload.worker_id}`
      );
    }
    assertActive();

    if (!cleanupDependencySatisfied) {
      await this.runPreparedCleanupDependency(payload, assertActive);
      assertActive();
    }

    if (await this.finalizeAlreadyOnlineLifecycle(payload, assertActive)) {
      await this.releaseReservedRecreateSlot(payload);
      assertActive();
      return;
    }

    // Reuse the primary snapshot already read by the stale fence. Besides
    // avoiding one database round trip per lifecycle delivery, this keeps the
    // dispatched storage mode tied to the exact snapshot that passed the
    // account/server/provider/lifecycle checks above.
    const sessionStorage = staleResolution.sessionStorage;

    const lifecycleSemanticFingerprint =
      workerLifecycleSemanticFingerprint(payload);
    const workerPayload = {
      action: workerLifecycleQueueActionToWorkerAction(payload.action),
      worker_id: payload.worker_id,
      account_id: payload.account_id,
      server_id: payload.server_id,
      previous_server_id: payload.previous_server_id,
      worker_status_id: payload.worker_status_id,
      worker_type_id: payload.worker_type_id,
      session_storage: sessionStorage,
      previous_session_storage: payload.previous_session_storage,
      session_storage_migration_id: payload.session_storage_migration_id,
      legacy_session_volume_name: payload.legacy_session_volume_name,
      legacy_session_checksum: payload.legacy_session_checksum,
      previous_worker_status_id: payload.previous_worker_status_id,
      previous_worker_type_id: payload.previous_worker_type_id,
      remove_session: payload.remove_session,
      remove_volume: payload.remove_volume,
      recreate_server_slot_key: payload.recreate_server_slot_key,
      recreate_server_slot_token: payload.recreate_server_slot_token,
      recovery_without_journal: payload.recovery_without_journal,
      expected_container_id: payload.expected_container_id,
      expected_container_started_at: payload.expected_container_started_at,
      expected_container_restart_count:
        payload.expected_container_restart_count,
      expected_container_health_status:
        payload.expected_container_health_status,
      expected_container_paused: payload.expected_container_paused,
      expected_runtime_generation: payload.expected_runtime_generation,
      lifecycle_operation_id: payload.operation_id,
      lifecycle_semantic_fingerprint: lifecycleSemanticFingerprint,
      debug_trace_id: payload.debug_trace_id,
    };

    if (payload.action === 'activate_warm') {
      if (!canActivateWorkerWarmRuntime(payload)) {
        void this.connectionLifecycleDebugService.log(
          'service.lifecycle_queue.warm_activation_blocked_session_preservation',
          {
            trace_id: payload.debug_trace_id,
            layer: 'service',
            worker_id: payload.worker_id,
            account_id: payload.account_id,
            worker_type_id: payload.worker_type_id,
            lifecycle_operation_id: payload.operation_id,
            server_id: payload.server_id,
            warm_pool_id: payload.warm_pool_id,
            source: payload.source,
            remove_session: payload.remove_session === true,
            remove_volume: payload.remove_volume === true,
          }
        );
        assertActive();
        await this.workerGrpcClientService.recreateWorker({
          ...workerPayload,
          action: EWorkerAction.recreate,
        });
        assertActive();
        return;
      }

      void this.connectionLifecycleDebugService.log(
        'service.lifecycle_queue.dispatch_activate_warm',
        {
          trace_id: payload.debug_trace_id,
          layer: 'service',
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          worker_type_id: payload.worker_type_id,
          lifecycle_operation_id: payload.operation_id,
          server_id: payload.server_id,
          warm_pool_id: payload.warm_pool_id,
        }
      );
      assertActive();
      await this.activateWarmOrFallback(payload, sessionStorage, assertActive);
      assertActive();
      return;
    }

    if (payload.action === 'create') {
      void this.connectionLifecycleDebugService.log(
        'service.lifecycle_queue.dispatch_create_grpc',
        {
          trace_id: payload.debug_trace_id,
          layer: 'service',
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          worker_type_id: payload.worker_type_id,
          lifecycle_operation_id: payload.operation_id,
          server_id: payload.server_id,
        }
      );
      assertActive();
      await this.workerGrpcClientService.createWorker(workerPayload);
      assertActive();
      return;
    }

    if (payload.action === 'recreate') {
      void this.connectionLifecycleDebugService.log(
        'service.lifecycle_queue.dispatch_recreate_grpc',
        {
          trace_id: payload.debug_trace_id,
          layer: 'service',
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          worker_type_id: payload.worker_type_id,
          lifecycle_operation_id: payload.operation_id,
          server_id: payload.server_id,
        }
      );
      assertActive();
      await this.workerGrpcClientService.recreateWorker(workerPayload);
      assertActive();
      await this.suppressTerminalWhatsappProviderHandoffDelivery(
        payload,
        assertActive
      );
      assertActive();
      return;
    }

    if (payload.action === 'delete') {
      void this.connectionLifecycleDebugService.log(
        'service.lifecycle_queue.dispatch_delete_grpc',
        {
          trace_id: payload.debug_trace_id,
          layer: 'service',
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          worker_type_id: payload.worker_type_id,
          lifecycle_operation_id: payload.operation_id,
          server_id: payload.server_id,
        }
      );
      assertActive();
      await this.workerGrpcClientService.deleteWorker(workerPayload);
      assertActive();
      return;
    }

    if (payload.action === 'cleanup_previous_runtime') {
      assertActive();
      await this.workerGrpcClientService.cleanupWorker({
        ...workerPayload,
        action: EWorkerAction.cleanup,
      });
      assertActive();
      if (payload.source === 'plan_limit_enforcement') {
        await this.finalizeStandaloneCleanup(payload, assertActive);
        assertActive();
      }
      return;
    }

    throw new Error(`Unsupported worker lifecycle action: ${payload.action}`);
  }

  private async isAuthoritativePreparedPayload(
    payload: IWorkerLifecycleQueueMessage,
    assertActive: () => void
  ): Promise<boolean> {
    assertActive();
    const authoritative =
      await this.workerLifecycleQueueService.loadAuthoritativePreparedPayload(
        payload
      );
    assertActive();
    return Boolean(
      authoritative &&
      resolveWorkerLifecycleCoalesceKey(authoritative) ===
        resolveWorkerLifecycleCoalesceKey(payload)
    );
  }

  private async runPreparedCleanupDependency(
    payload: IWorkerLifecycleQueueMessage,
    assertActive: () => void
  ): Promise<void> {
    if (
      (payload.source !== 'worker_update' &&
        payload.source !== 'reset_connection') ||
      (payload.action !== 'recreate' && payload.action !== 'activate_warm')
    ) {
      return;
    }

    assertActive();
    const prepared = await this.workerLifecycleQueueService.loadPrepared(
      payload.worker_id,
      payload.operation_id
    );
    assertActive();
    const cleanup = prepared.find(
      (candidate) =>
        candidate.action === 'cleanup_previous_runtime' &&
        candidate.source === payload.source
    );
    const cleanupRequired =
      payload.cleanup_previous_runtime_required === true ||
      (payload.cleanup_previous_runtime_required === undefined &&
        ((Boolean(payload.previous_server_id) &&
          payload.previous_server_id !== payload.server_id) ||
          (Boolean(payload.previous_worker_type_id) &&
            payload.previous_worker_type_id !== payload.worker_type_id)));
    if (!cleanup && cleanupRequired) {
      throw new Error(
        `Prepared cleanup dependency is missing for lifecycle ${payload.operation_id}`
      );
    }
    if (!cleanup) {
      return;
    }

    /*
     * The standalone cleanup Kafka record normally runs first, but a bounded
     * retry may be discarded while the target server recovers. Repeating the
     * idempotent prepared cleanup here makes it an execution dependency of the
     * primary, so a new runtime can never be activated while the authoritative
     * previous runtime cleanup is still failing.
     */
    await this.processPayload(cleanup, assertActive);
    assertActive();
  }

  private async finalizeAlreadyOnlineLifecycle(
    payload: IWorkerLifecycleQueueMessage,
    assertActive: () => void
  ): Promise<boolean> {
    if (
      payload.action === 'cleanup_previous_runtime' ||
      payload.action === 'delete'
    ) {
      return false;
    }

    const current = await this.workerService.viewWorkerForMonitorConsistent(
      payload.worker_id
    );
    assertActive();
    if (
      !current ||
      current.deleted_at ||
      current.account_id !== payload.account_id ||
      current.lifecycle_operation_id !== payload.operation_id
    ) {
      return true;
    }

    const controlContainerId = current.container_id?.trim().toLowerCase();
    const runtimeContainerId = current.runtime_container_id
      ?.trim()
      .toLowerCase();
    const isOnlineLifecycle = current.worker_status_id === EWorkerStatus.online;
    const isMaterializedReplacement =
      payload.action !== 'activate_warm' &&
      current.worker_status_id === payload.worker_status_id &&
      Boolean(runtimeContainerId) &&
      runtimeContainerId !== controlContainerId;
    if (!isOnlineLifecycle && !isMaterializedReplacement) {
      return false;
    }

    const reconciliation = await this.reconcileHealthyTerminalRuntime(
      payload,
      current.worker_status_id,
      assertActive
    );
    assertActive();
    if (reconciliation === 'reconciled' || reconciliation === 'fence_changed') {
      return true;
    }
    if (payload.action === 'recreate') {
      /*
       * A delayed ONLINE emitted by the pre-existing runtime may have won
       * before the database projection started deferring old-runtime events.
       * The explicit recreate still owns the lifecycle, but Balance correctly
       * refuses to retire a runtime while the primary status is ONLINE.
       * Re-arm only the exact lifecycle/container/generation fence before
       * dispatching the idempotent recreate. This write has no Docker effect.
       */
      const rearm = await this.rearmOnlineRecreateLifecycle(
        payload,
        current,
        assertActive
      );
      return rearm === 'fence_changed';
    }
    if (reconciliation === 'probe_unavailable') {
      throw new Error(
        `Online lifecycle readiness probe is unavailable for ${payload.operation_id}`
      );
    }

    /*
     * Only a strict not-ready result may fall through to the idempotent
     * create/recreate command. This avoids destroying a healthy runtime whose
     * online notification won the race with lifecycle finalization.
     */
    return false;
  }

  private async rearmOnlineRecreateLifecycle(
    payload: IWorkerLifecycleQueueMessage,
    current: IWorkerMonitor,
    assertActive: () => void
  ): Promise<OnlineRecreateRearm> {
    const runtimeContainerId = current.runtime_container_id?.trim();
    const runtimeGeneration = this.normalizeRuntimeGeneration(
      current.runtime_generation
    );
    if (!runtimeContainerId || !runtimeGeneration) {
      throw new Error(
        `Online recreate runtime fence is incomplete for ${payload.operation_id}`
      );
    }

    const rearmed = await this.workerService.updateWorkerByIdIfLifecycleMatches(
      payload.account_id,
      {
        worker_id: payload.worker_id,
        worker_status_id: EWorkerStatus.recreating,
      },
      {
        lifecycle_operation_id: payload.operation_id,
        container_id: current.container_id,
        runtime_container_id: runtimeContainerId,
        runtime_generation: runtimeGeneration,
        allow_disconnected_runtime: true,
        server_id: payload.server_id,
        worker_type_id: payload.worker_type_id,
        worker_status_id: EWorkerStatus.online,
      }
    );
    assertActive();
    if (rearmed) {
      void this.connectionLifecycleDebugService.log(
        'service.lifecycle_queue.online_recreate_rearmed',
        {
          trace_id: payload.debug_trace_id,
          layer: 'service',
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          worker_type_id: payload.worker_type_id,
          lifecycle_operation_id: payload.operation_id,
          runtime_generation: runtimeGeneration,
          container_id: runtimeContainerId,
          reason: 'exact_old_runtime_projection_rearmed',
        }
      );
      return 'rearmed';
    }

    const afterCas = await this.workerService.viewWorkerForMonitorConsistent(
      payload.worker_id
    );
    assertActive();
    if (
      !afterCas ||
      afterCas.deleted_at ||
      afterCas.account_id !== payload.account_id ||
      afterCas.server_id !== payload.server_id ||
      afterCas.worker_type_id !== payload.worker_type_id ||
      afterCas.lifecycle_operation_id !== payload.operation_id
    ) {
      return 'fence_changed';
    }

    const afterRuntimeContainerId = afterCas.runtime_container_id?.trim();
    if (
      afterCas.worker_status_id === EWorkerStatus.recreating &&
      afterCas.container_id === current.container_id &&
      afterRuntimeContainerId === runtimeContainerId &&
      this.normalizeRuntimeGeneration(afterCas.runtime_generation) ===
        runtimeGeneration
    ) {
      // Another delivery re-armed the same operation concurrently.
      return 'rearmed';
    }

    throw new Error(
      `Online recreate lifecycle rearm remains pending for ${payload.operation_id}`
    );
  }

  private async finalizeStandaloneCleanup(
    payload: IWorkerLifecycleQueueMessage,
    assertActive: () => void
  ): Promise<void> {
    const finalized =
      await this.workerService.updateWorkerByIdIfLifecycleMatches(
        payload.account_id,
        {
          worker_id: payload.worker_id,
          worker_status_id: EWorkerStatus.blocked,
          lifecycle_operation_id: null,
        },
        {
          lifecycle_operation_id: payload.operation_id,
          server_id: payload.server_id,
          worker_type_id: payload.worker_type_id,
          worker_status_id: EWorkerStatus.blocked,
        }
      );
    assertActive();
    if (finalized) {
      return;
    }

    const current = await this.workerService.viewWorkerForMonitorConsistent(
      payload.worker_id
    );
    assertActive();
    const sameCleanupStillOwnsFence =
      current &&
      !current.deleted_at &&
      current.account_id === payload.account_id &&
      current.server_id === payload.server_id &&
      current.worker_type_id === payload.worker_type_id &&
      current.worker_status_id === EWorkerStatus.blocked &&
      current.lifecycle_operation_id === payload.operation_id;
    if (sameCleanupStillOwnsFence) {
      throw new Error(
        `Standalone cleanup finalization was not confirmed for ${payload.operation_id}`
      );
    }
  }

  private async releaseReservedRecreateSlot(
    payload: IWorkerLifecycleQueueMessage
  ): Promise<void> {
    if (payload.action !== 'recreate') {
      return;
    }

    await this.workerRecreateServerSlotService.releaseReservedSlot({
      serverId: payload.server_id,
      key: payload.recreate_server_slot_key,
      token: payload.recreate_server_slot_token,
    });
  }

  private async releaseReservedRecreateSlotBestEffort(
    payload: IWorkerLifecycleQueueMessage
  ): Promise<void> {
    try {
      await this.releaseReservedRecreateSlot(payload);
    } catch (error) {
      /*
       * The reservation is leased and expires independently. Once the runner
       * exhausted the lifecycle retry budget, a Redis cleanup failure must not
       * pin this Kafka partition or erase the durable DB/journal recovery
       * fence.
       */
      void this.connectionLifecycleDebugService.log(
        'service.lifecycle_queue.recreate_slot_release_deferred',
        {
          trace_id: payload.debug_trace_id,
          layer: 'service',
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          worker_type_id: payload.worker_type_id,
          lifecycle_operation_id: payload.operation_id,
          server_id: payload.server_id,
          reason: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  private async isConcurrentLifecycleStillActive(
    payload: IWorkerLifecycleQueueMessage
  ): Promise<boolean> {
    try {
      return await this.workerLifecycleLockService.isLocked(payload.worker_id);
    } catch (error) {
      /*
       * Lock availability is part of the destructive lifecycle fence. A
       * failed probe cannot prove that Balance is idle, so reconciling or
       * redispatching would be allowed to clear the fence underneath the
       * original create/recreate/warm handler. Treat uncertainty as active;
       * the prepared journal remains available for a later redrive.
       */
      void this.connectionLifecycleDebugService.log(
        'service.lifecycle_queue.concurrent_operation_probe_failed',
        {
          trace_id: payload.debug_trace_id,
          layer: 'service',
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          worker_type_id: payload.worker_type_id,
          lifecycle_operation_id: payload.operation_id,
          action: payload.action,
          source: payload.source,
          reason: error instanceof Error ? error.message : String(error),
        }
      );
      return true;
    }
  }

  private async releaseOwnedRedriveClaim(
    payload: IWorkerLifecycleQueueMessage
  ): Promise<void> {
    const claimToken = payload.redrive_claim_token?.trim();
    if (!claimToken) {
      return;
    }
    await this.workerLifecycleLockService.releaseRedriveClaim(
      payload.worker_id,
      payload.operation_id,
      claimToken
    );
  }

  /**
   * A provider-handoff journal can be published immediately before its durable
   * handoff becomes terminal. Suppress that queued delivery from the primary
   * database before it can execute a prepared cleanup or cross the gRPC
   * boundary. The command handler repeats the same proof while holding the
   * lifecycle mutex, closing the remaining read-to-dispatch race.
   */
  private async suppressTerminalWhatsappProviderHandoffDelivery(
    payload: IWorkerLifecycleQueueMessage,
    assertActive: () => void
  ): Promise<boolean> {
    if (
      payload.source !== 'worker_update' ||
      (payload.action !== 'recreate' &&
        payload.action !== 'cleanup_previous_runtime') ||
      payload.session_storage !== EWorkerSessionStorage.postgres ||
      payload.remove_session !== false ||
      payload.remove_volume !== false ||
      !payload.operation_id?.trim()
    ) {
      return false;
    }

    if (payload.action === 'cleanup_previous_runtime') {
      const current = await this.workerService.viewWorkerForMonitorConsistent(
        payload.worker_id
      );
      assertActive();
      if (
        current &&
        !current.deleted_at &&
        current.account_id === payload.account_id &&
        current.lifecycle_operation_id === payload.operation_id &&
        current.worker_status_id === EWorkerStatus.recreating &&
        current.session_storage === EWorkerSessionStorage.postgres &&
        current.worker_type_id !== payload.worker_type_id
      ) {
        const recoveryProvider =
          WORKER_TYPE_CONNECTION_PROVIDER[current.worker_type_id];
        const failedTargetProvider = payload.worker_type_id
          ? WORKER_TYPE_CONNECTION_PROVIDER[payload.worker_type_id]
          : undefined;
        if (
          !recoveryProvider ||
          !failedTargetProvider ||
          typeof this.workerRuntimeRepository
            .viewWhatsappProviderHandoffRecoveryLifecycleProof !== 'function'
        ) {
          throw new Error(
            'whatsapp_handoff_recovery_cleanup_consumer_fence_unavailable'
          );
        }
        const recoveryProof =
          await this.workerRuntimeRepository.viewWhatsappProviderHandoffRecoveryLifecycleProof(
            {
              worker_id: payload.worker_id,
              account_id: payload.account_id,
              recovery_operation_id: payload.operation_id,
              recovery_worker_type_id: current.worker_type_id,
              recovery_provider: recoveryProvider,
            }
          );
        assertActive();
        if (
          recoveryProof?.recovery_ownership_unique === true &&
          recoveryProof.recovery_context_valid === true &&
          recoveryProof.source_session_valid === true &&
          recoveryProof.recovery_source_runtime_reserved === true &&
          recoveryProof.recovery_operation_id === payload.operation_id &&
          recoveryProof.source_provider === recoveryProvider &&
          recoveryProof.failed_target_provider === failedTargetProvider
        ) {
          await this.releaseOwnedRedriveClaim(payload);
          assertActive();
          void this.connectionLifecycleDebugService.log(
            'service.lifecycle_queue.provider_handoff_recovery_cleanup_suppressed',
            {
              trace_id: payload.debug_trace_id,
              layer: 'service',
              worker_id: payload.worker_id,
              account_id: payload.account_id,
              worker_type_id: current.worker_type_id,
              lifecycle_operation_id: payload.operation_id,
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
        .viewWhatsappProviderHandoffTerminalLifecycleProof !== 'function'
    ) {
      throw new Error(
        'whatsapp_handoff_terminal_lifecycle_consumer_fence_unavailable'
      );
    }

    const proof =
      await this.workerRuntimeRepository.viewWhatsappProviderHandoffTerminalLifecycleProof(
        {
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          lifecycle_operation_id: payload.operation_id,
        }
      );
    assertActive();
    if (!proof) {
      return false;
    }

    await this.releaseOwnedRedriveClaim(payload);
    assertActive();
    await this.releaseReservedRecreateSlot(payload);
    assertActive();
    void this.connectionLifecycleDebugService.log(
      'service.lifecycle_queue.provider_handoff_terminal_suppressed',
      {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        worker_type_id: payload.worker_type_id,
        lifecycle_operation_id: payload.operation_id,
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

  private async hasOwnedLivenessReplacement(
    payload: IWorkerLifecycleQueueMessage
  ): Promise<boolean> {
    const expectedContainerId = payload.expected_container_id
      ?.trim()
      .toLowerCase();
    const expectedRuntimeGeneration = payload.expected_runtime_generation;
    if (
      !expectedContainerId ||
      typeof expectedRuntimeGeneration !== 'number' ||
      !Number.isSafeInteger(expectedRuntimeGeneration)
    ) {
      return false;
    }

    try {
      const current = await this.workerService.viewWorkerForMonitorConsistent(
        payload.worker_id
      );
      const runtimeContainerId = current?.runtime_container_id
        ?.trim()
        .toLowerCase();
      return (
        Boolean(current) &&
        !current?.deleted_at &&
        current?.account_id === payload.account_id &&
        current?.server_id === payload.server_id &&
        current?.worker_type_id === payload.worker_type_id &&
        current?.worker_status_id === EWorkerStatus.recreating &&
        current?.lifecycle_operation_id === payload.operation_id &&
        current?.container_id?.trim().toLowerCase() === expectedContainerId &&
        Boolean(runtimeContainerId) &&
        runtimeContainerId !== expectedContainerId &&
        typeof current?.runtime_generation === 'number' &&
        Number.isSafeInteger(current.runtime_generation) &&
        current.runtime_generation > expectedRuntimeGeneration
      );
    } catch {
      return false;
    }
  }

  private async reconcileHealthyTerminalRuntime(
    payload: IWorkerLifecycleQueueMessage,
    observedStatus: EWorkerStatus,
    assertActive: () => void
  ): Promise<TerminalRuntimeReconciliation> {
    if (
      (payload.action !== 'create' && payload.action !== 'recreate') ||
      !payload.worker_type_id ||
      !this.workerRuntimeRepository
    ) {
      return 'not_applicable';
    }

    assertActive();
    const current = await this.workerService.viewWorkerForMonitorConsistent(
      payload.worker_id
    );
    assertActive();
    if (
      !current ||
      current.deleted_at ||
      current.account_id !== payload.account_id ||
      current.lifecycle_operation_id !== payload.operation_id
    ) {
      return 'fence_changed';
    }

    if (
      current.server_id !== payload.server_id ||
      current.worker_type_id !== payload.worker_type_id
    ) {
      return 'not_applicable';
    }

    const controlContainerId = current.container_id?.trim().toLowerCase();
    const monitorRuntimeContainerId = current.runtime_container_id
      ?.trim()
      .toLowerCase();
    if (
      observedStatus !== EWorkerStatus.online &&
      (current.worker_status_id !== observedStatus ||
        !monitorRuntimeContainerId ||
        monitorRuntimeContainerId === controlContainerId)
    ) {
      /*
       * A healthy pre-existing runtime is not proof that a create/recreate
       * command completed. During provisioning we only reconcile a runtime
       * generation that was already materialized behind the legacy worker
       * pointer.
       */
      return 'not_ready';
    }

    const runtime = await this.workerRuntimeRepository.viewByWorkerIdConsistent(
      payload.worker_id
    );
    assertActive();
    const containerId = runtime?.container_id?.trim();
    const runtimeGeneration = this.normalizeRuntimeGeneration(
      runtime?.runtime_generation
    );

    // A container reservation alone is not proof that the provider owning the
    // generation ever activated. Without that proof the regular terminal
    // compensation remains the safe result.
    if (
      !runtime ||
      !containerId ||
      !runtimeGeneration ||
      !runtime.connection_epoch?.trim() ||
      (observedStatus !== EWorkerStatus.online &&
        containerId.toLowerCase() !== monitorRuntimeContainerId)
    ) {
      return 'not_ready';
    }

    let health: IWorkerRuntimeHealthResponseProto;
    try {
      health = await this.workerGrpcClientService.runtimeHealth(
        payload.server_id,
        { worker_id: payload.worker_id }
      );
      assertActive();
    } catch (error) {
      void this.connectionLifecycleDebugService.log(
        'service.lifecycle_queue.terminal_runtime_probe_unavailable',
        {
          trace_id: payload.debug_trace_id,
          layer: 'service',
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          worker_type_id: payload.worker_type_id,
          lifecycle_operation_id: payload.operation_id,
          runtime_generation: runtimeGeneration,
          container_id: containerId,
          reason: error instanceof Error ? error.message : String(error),
        }
      );
      return 'probe_unavailable';
    }

    if (
      !this.isStrictHealthyTerminalRuntime(payload, runtimeGeneration, health)
    ) {
      return 'not_ready';
    }

    const reconciled =
      await this.workerRuntimeRepository.reconcileHealthyRuntimeLifecycle({
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        server_id: payload.server_id,
        worker_type_id: payload.worker_type_id,
        lifecycle_operation_id: payload.operation_id,
        expected_worker_status_id: observedStatus,
        lifecycle_action: payload.action,
        container_id: containerId,
        runtime_generation: runtimeGeneration,
        phone: health.phone?.trim() ?? '',
      });
    assertActive();

    let reconciliation: TerminalRuntimeReconciliation = 'reconciled';
    if (!reconciled) {
      const afterCas = await this.workerService.viewWorkerForMonitorConsistent(
        payload.worker_id
      );
      assertActive();
      const afterCasRuntimeContainerId = afterCas?.runtime_container_id
        ?.trim()
        .toLowerCase();
      const sameLifecycleFence = Boolean(
        afterCas &&
        !afterCas.deleted_at &&
        afterCas.account_id === payload.account_id &&
        afterCas.server_id === payload.server_id &&
        afterCas.worker_type_id === payload.worker_type_id &&
        afterCas.worker_status_id === observedStatus &&
        afterCas.lifecycle_operation_id === payload.operation_id &&
        afterCasRuntimeContainerId === containerId.toLowerCase() &&
        this.normalizeRuntimeGeneration(afterCas.runtime_generation) ===
          runtimeGeneration
      );

      /*
       * A failed completion CAS does not by itself prove that ownership moved.
       * The runtime repository also rejects a healthy pre-existing container
       * whose recreate bootstrap marker belongs to an older operation. In
       * that case the lifecycle is still current and must continue to the
       * idempotent recreate command instead of being acknowledged forever.
       */
      reconciliation = sameLifecycleFence ? 'not_ready' : 'fence_changed';
    }

    void this.connectionLifecycleDebugService.log(
      reconciliation === 'reconciled'
        ? 'service.lifecycle_queue.terminal_runtime_reconciled'
        : reconciliation === 'fence_changed'
          ? 'service.lifecycle_queue.terminal_runtime_fence_changed'
          : 'service.lifecycle_queue.terminal_runtime_bootstrap_not_ready',
      {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        worker_type_id: payload.worker_type_id,
        lifecycle_operation_id: payload.operation_id,
        runtime_generation: runtimeGeneration,
        container_id: containerId,
        worker_status_id: EWorkerStatus.online,
      }
    );

    return reconciliation;
  }

  /**
   * Provider handoffs have their own durable recovery protocol and must keep
   * their source provider claim while it decides whether to return or discard
   * the session. A server-only PostgreSQL migration, on the other hand,
   * already points the worker row at the requested server and has no provider
   * rollback protocol to wait for.
   */
  private isPostgresProviderHandoffRecreate(
    payload: IWorkerLifecycleQueueMessage
  ): boolean {
    return Boolean(
      payload.action === 'recreate' &&
      payload.source === 'worker_update' &&
      payload.session_storage === EWorkerSessionStorage.postgres &&
      payload.remove_session === false &&
      payload.remove_volume === false &&
      payload.cleanup_previous_runtime_required === true &&
      payload.previous_worker_type_id &&
      payload.worker_type_id &&
      payload.previous_worker_type_id !== payload.worker_type_id
    );
  }

  /**
   * Keep terminal compensation deliberately constrained to the one migration
   * that can be safely surfaced as an error without discarding a session:
   * PostgreSQL, preserving flags, same provider and a different source
   * server. In particular, this must never match a provider handoff, legacy
   * conversion, ordinary/manual recreate, or liveness recreate.
   */
  private isPostgresServerOnlyMigrationRecreate(
    payload: IWorkerLifecycleQueueMessage
  ): boolean {
    const previousServerId = payload.previous_server_id?.trim();
    return Boolean(
      payload.action === 'recreate' &&
      payload.source === 'worker_update' &&
      payload.session_storage === EWorkerSessionStorage.postgres &&
      payload.remove_session === false &&
      payload.remove_volume === false &&
      previousServerId &&
      previousServerId !== payload.server_id &&
      payload.previous_worker_type_id &&
      payload.worker_type_id &&
      payload.previous_worker_type_id === payload.worker_type_id &&
      !payload.expected_container_id &&
      !this.isPostgresProviderHandoffRecreate(payload)
    );
  }

  private isTerminalGrpcLifecycleError(error: unknown): boolean {
    const code =
      typeof error === 'object' &&
      error !== null &&
      typeof (error as { code?: unknown }).code === 'number'
        ? (error as { code: number }).code
        : undefined;

    return Boolean(
      code !== undefined &&
      [
        GrpcStatus.INVALID_ARGUMENT,
        GrpcStatus.NOT_FOUND,
        GrpcStatus.ALREADY_EXISTS,
        GrpcStatus.PERMISSION_DENIED,
        GrpcStatus.UNAUTHENTICATED,
        GrpcStatus.FAILED_PRECONDITION,
        GrpcStatus.OUT_OF_RANGE,
        GrpcStatus.UNIMPLEMENTED,
      ].includes(code)
    );
  }

  private async terminalizePostgresServerMigrationFailure(
    payload: IWorkerLifecycleQueueMessage,
    error: unknown,
    discardReason: KafkaConsumerRunnerDiscardReason,
    assertActive: () => void
  ): Promise<boolean> {
    if (
      discardReason !== 'terminal_error' ||
      !this.isTerminalGrpcLifecycleError(error) ||
      !this.isPostgresServerOnlyMigrationRecreate(payload) ||
      payload.worker_status_id !== EWorkerStatus.recreating ||
      !payload.worker_type_id ||
      payload.expected_container_id
    ) {
      return false;
    }

    assertActive();
    const current = await this.workerService.viewWorkerForMonitorConsistent(
      payload.worker_id
    );
    assertActive();
    if (
      !current ||
      current.deleted_at ||
      current.account_id !== payload.account_id ||
      current.server_id !== payload.server_id ||
      current.worker_type_id !== payload.worker_type_id ||
      current.worker_status_id !== EWorkerStatus.recreating ||
      current.lifecycle_operation_id !== payload.operation_id
    ) {
      void this.connectionLifecycleDebugService.log(
        'service.lifecycle_queue.terminal_server_migration_failure_fence_changed',
        {
          trace_id: payload.debug_trace_id,
          layer: 'service',
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          worker_type_id: payload.worker_type_id,
          lifecycle_operation_id: payload.operation_id,
          action: payload.action,
          source: payload.source,
          reason: discardReason,
        }
      );
      return true;
    }

    const markedError =
      await this.workerService.updateWorkerByIdIfLifecycleMatches(
        payload.account_id,
        {
          worker_id: payload.worker_id,
          worker_status_id: EWorkerStatus.error,
          lifecycle_operation_id: null,
        },
        {
          lifecycle_operation_id: payload.operation_id,
          server_id: payload.server_id,
          worker_type_id: payload.worker_type_id,
          worker_status_id: EWorkerStatus.recreating,
        }
      );
    assertActive();

    void this.connectionLifecycleDebugService.log(
      markedError
        ? 'service.lifecycle_queue.terminal_server_migration_failure_marked_error'
        : 'service.lifecycle_queue.terminal_server_migration_failure_fence_changed',
      {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        worker_type_id: payload.worker_type_id,
        lifecycle_operation_id: payload.operation_id,
        action: payload.action,
        source: payload.source,
        reason: `${discardReason}:${
          error instanceof Error ? error.message : String(error)
        }`,
      }
    );

    // A failed CAS means another lifecycle/state already won the exact guard.
    // Never redrive this old journal record over that newer state.
    return true;
  }

  private isStrictHealthyTerminalRuntime(
    payload: IWorkerLifecycleQueueMessage,
    expectedRuntimeGeneration: number,
    health: IWorkerRuntimeHealthResponseProto
  ): boolean {
    const healthGeneration = this.normalizeRuntimeGeneration(
      health.runtime_generation
    );
    const expectedProvider = payload.worker_type_id
      ? WORKER_TYPE_CONNECTION_PROVIDER[payload.worker_type_id as EWorkerType]
      : undefined;
    const nativeStatus = expectedProvider
      ? normalizeWhatsappConnectionStatus(
          health.connection_status,
          expectedProvider
        )
      : undefined;

    return (
      healthGeneration === expectedRuntimeGeneration &&
      Number(health.runtime_health_schema_version ?? 0) >= 3 &&
      Boolean(expectedProvider) &&
      CONNECTION_STATUS_SOURCE_ID_PATTERN.test(
        health.connection_status_source_id?.trim() ?? ''
      ) &&
      isWhatsappConnectionOnline(nativeStatus) &&
      (!health.worker_id || health.worker_id === payload.worker_id) &&
      (!health.account_id || health.account_id === payload.account_id) &&
      (!health.worker_type_id ||
        health.worker_type_id === payload.worker_type_id) &&
      health.has_session === true &&
      health.has_qr !== true &&
      health.session_ready === true &&
      health.can_send === true &&
      health.can_receive_runtime === true &&
      health.authenticated === true &&
      health.activated === true &&
      health.ready === true &&
      health.standby !== true &&
      health.kafka_unhealthy !== true &&
      health.kafka_consumers_ready === true &&
      health.kafka_consumers_authorized === true &&
      !health.error &&
      Boolean(health.phone?.trim())
    );
  }

  private normalizeRuntimeGeneration(value: unknown): number | undefined {
    const normalized =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim()
          ? Number(value)
          : Number.NaN;

    return Number.isSafeInteger(normalized) && normalized > 0
      ? normalized
      : undefined;
  }

  private async activateWarmOrFallback(
    payload: IWorkerLifecycleQueueMessage,
    sessionStorage: EWorkerSessionStorage,
    assertActive: () => void
  ): Promise<void> {
    if (!payload.warm_pool_id || !payload.worker_type_id) {
      throw new Error('Missing warm_pool_id or worker_type_id');
    }

    try {
      assertActive();
      const response = await this.workerGrpcClientService.activateWarmWorker(
        payload.server_id,
        {
          warm_pool_id: payload.warm_pool_id,
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          server_id: payload.server_id,
          worker_type_id: payload.worker_type_id,
          session_storage: sessionStorage,
          lifecycle_operation_id: payload.operation_id,
          remove_session: payload.remove_session,
          remove_volume: payload.remove_volume,
          previous_worker_type_id: payload.previous_worker_type_id,
          previous_worker_status_id: payload.previous_worker_status_id,
          lifecycle_semantic_fingerprint:
            workerLifecycleSemanticFingerprint(payload),
          debug_trace_id: payload.debug_trace_id,
        },
        WARM_ACTIVATION_GRPC_DEADLINE_MS
      );
      assertActive();
      if (response.claimed === false) {
        if (response.error !== WARM_ACTIVATION_CONFIRMED_CLEANUP) {
          throw new Error(
            `warm_activation_unrecognized_unclaimed_response:${response.error ?? 'missing_error'}`
          );
        }
        const coldAction =
          payload.source === 'worker_create'
            ? EWorkerAction.create
            : EWorkerAction.recreate;
        const coldWorkerPayload = {
          action: coldAction,
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          server_id: payload.server_id,
          previous_server_id: payload.previous_server_id,
          worker_type_id: payload.worker_type_id,
          session_storage: sessionStorage,
          previous_session_storage: payload.previous_session_storage,
          session_storage_migration_id: payload.session_storage_migration_id,
          legacy_session_volume_name: payload.legacy_session_volume_name,
          legacy_session_checksum: payload.legacy_session_checksum,
          worker_status_id: payload.worker_status_id,
          remove_session: payload.remove_session,
          remove_volume: payload.remove_volume,
          previous_worker_type_id: payload.previous_worker_type_id,
          previous_worker_status_id: payload.previous_worker_status_id,
          recreate_server_slot_key: payload.recreate_server_slot_key,
          recreate_server_slot_token: payload.recreate_server_slot_token,
          recovery_without_journal: payload.recovery_without_journal,
          lifecycle_operation_id: payload.operation_id,
          lifecycle_semantic_fingerprint:
            workerLifecycleSemanticFingerprint(payload),
          debug_trace_id: payload.debug_trace_id,
        };
        if (coldAction === EWorkerAction.create) {
          await this.workerGrpcClientService.createWorker(coldWorkerPayload);
        } else {
          await this.workerGrpcClientService.recreateWorker(coldWorkerPayload);
        }
        assertActive();
      }
      return;
    } catch (error) {
      assertActive();
      const lifecycleStillActive =
        await this.isConcurrentLifecycleStillActive(payload);
      assertActive();
      if (lifecycleStillActive) {
        await this.releaseOwnedRedriveClaim(payload);
        assertActive();
        void this.connectionLifecycleDebugService.log(
          'service.lifecycle_queue.warm_activation_deferred_active',
          {
            trace_id: payload.debug_trace_id,
            layer: 'service',
            worker_id: payload.worker_id,
            account_id: payload.account_id,
            worker_type_id: payload.worker_type_id,
            lifecycle_operation_id: payload.operation_id,
            server_id: payload.server_id,
            warm_pool_id: payload.warm_pool_id,
            reason: error instanceof Error ? error.message : String(error),
          }
        );
        /*
         * The Balance still owns the worker lock, so a transport deadline is
         * not a failed activation. Commit this delivery: either the original
         * handler finalizes it or the durable lifecycle journal is redriven by
         * the monitor after the lock expires.
         */
        return;
      }
      console.error(
        'Warm activation outcome is uncertain; retrying idempotently',
        {
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          server_id: payload.server_id,
          worker_type_id: payload.worker_type_id,
          lifecycle_operation_id: payload.operation_id,
          error,
        }
      );
      /*
       * A deadline or transport failure can arrive after ActivateWarmWorker
       * committed. Deleting the warm row or creating another container here
       * would race that committed/activating runtime. The Kafka runner retries
       * the same lifecycle record; ActivateWarmWorker is idempotent for both
       * activating and assigned states.
       */
      throw error;
    }
  }

  private async resolveStaleReason(
    payload: IWorkerLifecycleQueueMessage
  ): Promise<{
    reason?: string;
    sessionStorage: EWorkerSessionStorage;
    providerHandoffTargetPendingSourceDrain?: boolean;
  }> {
    const current = await this.workerService.viewWorkerForMonitorConsistent(
      payload.worker_id
    );

    if (!current) {
      return {
        reason: 'worker_not_found',
        sessionStorage:
          payload.session_storage ?? EWorkerSessionStorage.legacy_volume,
      };
    }

    const sessionStorage =
      current.session_storage ??
      payload.session_storage ??
      EWorkerSessionStorage.legacy_volume;

    if (current.deleted_at && payload.action !== 'delete') {
      return { reason: 'worker_deleted', sessionStorage };
    }

    if (current.account_id !== payload.account_id) {
      return { reason: 'account_mismatch', sessionStorage };
    }

    if (current.lifecycle_operation_id !== payload.operation_id) {
      return { reason: 'lifecycle_operation_mismatch', sessionStorage };
    }

    if (
      payload.action !== 'cleanup_previous_runtime' &&
      current.server_id !== payload.server_id
    ) {
      return { reason: 'server_mismatch', sessionStorage };
    }

    if (
      payload.worker_type_id &&
      payload.action !== 'cleanup_previous_runtime' &&
      current.worker_type_id !== payload.worker_type_id
    ) {
      const providerHandoffDecision =
        await this.resolvePostgresProviderHandoffTargetDecision(
          payload,
          current,
          sessionStorage
        );
      if (providerHandoffDecision === 'pending_source_drain') {
        return {
          sessionStorage,
          providerHandoffTargetPendingSourceDrain: true,
        };
      }
      if (providerHandoffDecision !== 'authorized') {
        return { reason: 'worker_type_mismatch', sessionStorage };
      }
    }

    if (
      payload.session_storage &&
      current.session_storage &&
      current.session_storage !== payload.session_storage
    ) {
      return { reason: 'session_storage_mismatch', sessionStorage };
    }

    return { sessionStorage };
  }

  /**
   * During a PostgreSQL provider handoff the worker row intentionally keeps
   * the source provider until the target revision is validated and promoted.
   * Consequently, the target recreate is the only legitimate lifecycle
   * command whose provider may differ from the current worker snapshot.
   *
   * Keep this exception narrower than the database authorization itself: the
   * immutable journal must explicitly preserve the session, require cleanup
   * of the previous provider and name that exact current provider. A database
   * read failure is allowed to bubble up so Kafka retries instead of
   * committing a potentially current command as stale.
   */
  private async resolvePostgresProviderHandoffTargetDecision(
    payload: IWorkerLifecycleQueueMessage,
    current: IWorkerMonitor,
    sessionStorage: EWorkerSessionStorage
  ): Promise<PostgresProviderHandoffTargetDecision> {
    const targetWorkerType = payload.worker_type_id;
    if (
      payload.action !== 'recreate' ||
      payload.source !== 'worker_update' ||
      sessionStorage !== EWorkerSessionStorage.postgres ||
      payload.session_storage !== EWorkerSessionStorage.postgres ||
      payload.remove_session !== false ||
      payload.remove_volume !== false ||
      payload.cleanup_previous_runtime_required !== true ||
      payload.previous_worker_type_id !== current.worker_type_id ||
      current.worker_status_id !== EWorkerStatus.recreating ||
      !targetWorkerType ||
      targetWorkerType === current.worker_type_id ||
      !WORKER_TYPE_CONNECTION_PROVIDER[current.worker_type_id] ||
      !WORKER_TYPE_CONNECTION_PROVIDER[targetWorkerType] ||
      typeof this.workerRuntimeRepository
        .isWhatsappProviderHandoffTargetAuthorized !== 'function' ||
      typeof this.workerRuntimeRepository
        .viewWhatsappProviderHandoffLifecycleContext !== 'function'
    ) {
      return 'not_handoff';
    }

    const authorized =
      await this.workerRuntimeRepository.isWhatsappProviderHandoffTargetAuthorized(
        {
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          lifecycle_operation_id: payload.operation_id,
          target_worker_type_id: targetWorkerType,
        }
      );
    if (authorized) {
      return 'authorized';
    }

    const context =
      await this.workerRuntimeRepository.viewWhatsappProviderHandoffLifecycleContext(
        {
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          lifecycle_operation_id: payload.operation_id,
        }
      );
    const sourceProvider =
      WORKER_TYPE_CONNECTION_PROVIDER[current.worker_type_id];
    const targetProvider = WORKER_TYPE_CONNECTION_PROVIDER[targetWorkerType];
    if (
      !context ||
      !sourceProvider ||
      !targetProvider ||
      context.lifecycle_operation_id !== payload.operation_id ||
      context.source_provider !== sourceProvider ||
      context.target_provider !== targetProvider
    ) {
      return 'not_handoff';
    }

    if (context.state === 'requested' || context.state === 'draining') {
      return 'pending_source_drain';
    }
    if (
      context.state === 'transforming' ||
      context.state === 'hydrating' ||
      context.state === 'validating' ||
      context.state === 'promoting'
    ) {
      /*
       * The first authorization read may have observed requested/draining
       * immediately before the source ACK committed. The lifecycle context
       * is the later primary-database snapshot, so accepting the exact active
       * phase avoids turning that harmless race into a stale command.
       */
      return 'authorized';
    }

    return 'not_handoff';
  }

  private parsePayload(
    value: Buffer | null
  ): IWorkerLifecycleQueueMessage | null {
    if (!value) {
      return null;
    }

    try {
      const parsed = JSON.parse(value.toString('utf8')) as Record<
        string,
        unknown
      >;
      if (
        !this.isNonEmptyString(parsed.request_id) ||
        !this.isNonEmptyString(parsed.operation_id) ||
        !this.isNonEmptyString(parsed.action) ||
        !WORKER_LIFECYCLE_ACTIONS.has(
          parsed.action as IWorkerLifecycleQueueMessage['action']
        ) ||
        !this.isNonEmptyString(parsed.worker_id) ||
        !this.isNonEmptyString(parsed.account_id) ||
        !this.isNonEmptyString(parsed.server_id) ||
        !this.isNonEmptyString(parsed.source) ||
        !WORKER_LIFECYCLE_SOURCES.has(
          parsed.source as IWorkerLifecycleQueueMessage['source']
        ) ||
        !this.isNonEmptyString(parsed.requested_at) ||
        !Number.isFinite(Date.parse(parsed.requested_at))
      ) {
        return null;
      }

      const action = parsed.action as IWorkerLifecycleQueueMessage['action'];
      const source = parsed.source as IWorkerLifecycleQueueMessage['source'];
      if (!ACTION_SOURCES[action].has(source)) {
        return null;
      }

      if (
        !this.isNonEmptyString(parsed.worker_type_id) ||
        !WORKER_TYPES.has(parsed.worker_type_id)
      ) {
        return null;
      }

      if (
        !this.isNonEmptyString(parsed.worker_status_id) ||
        !WORKER_STATUSES.has(parsed.worker_status_id) ||
        !ACTION_STATUSES[action].has(parsed.worker_status_id as EWorkerStatus)
      ) {
        return null;
      }

      if (
        action === 'delete' &&
        !this.isNonEmptyString(parsed.debug_trace_id)
      ) {
        return null;
      }

      if (
        action === 'activate_warm' &&
        !this.isNonEmptyString(parsed.warm_pool_id)
      ) {
        return null;
      }

      if (
        parsed.previous_worker_type_id !== undefined &&
        (!this.isNonEmptyString(parsed.previous_worker_type_id) ||
          !WORKER_TYPES.has(parsed.previous_worker_type_id))
      ) {
        return null;
      }

      if (
        parsed.previous_server_id !== undefined &&
        !this.isNonEmptyString(parsed.previous_server_id)
      ) {
        return null;
      }

      if (
        parsed.redrive_claim_token !== undefined &&
        (!this.isNonEmptyString(parsed.redrive_claim_token) ||
          !parsed.redrive_claim_token.startsWith(`${parsed.operation_id}:`) ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
            parsed.redrive_claim_token.slice(parsed.operation_id.length + 1)
          ))
      ) {
        return null;
      }

      if (
        (parsed.session_storage !== undefined &&
          (!this.isNonEmptyString(parsed.session_storage) ||
            !WORKER_SESSION_STORAGES.has(parsed.session_storage))) ||
        (parsed.previous_session_storage !== undefined &&
          (!this.isNonEmptyString(parsed.previous_session_storage) ||
            !WORKER_SESSION_STORAGES.has(parsed.previous_session_storage)))
      ) {
        return null;
      }

      const legacyToPostgresConversion =
        (source === 'worker_update' || source === 'reset_connection') &&
        (action === 'recreate' || action === 'cleanup_previous_runtime') &&
        parsed.previous_session_storage ===
          EWorkerSessionStorage.legacy_volume &&
        parsed.session_storage === EWorkerSessionStorage.postgres &&
        parsed.remove_session === true &&
        parsed.remove_volume === true;
      const protectedSessionStorageMigration =
        isProtectedWorkerLifecycleSessionStorageMigration(
          parsed as unknown as IWorkerLifecycleQueueMessage
        );
      const protectedSessionStorageMigrationFinalization =
        isProtectedWorkerLifecycleSessionStorageMigrationFinalization(
          parsed as unknown as IWorkerLifecycleQueueMessage
        );
      const protectedSessionStorageMigrationCommand =
        protectedSessionStorageMigration ||
        protectedSessionStorageMigrationFinalization;
      const hasSessionStorageMigrationMetadata =
        hasWorkerLifecycleSessionStorageMigrationMetadata(
          parsed as unknown as IWorkerLifecycleQueueMessage
        );
      if (
        (parsed.previous_session_storage !== undefined &&
          !legacyToPostgresConversion &&
          !protectedSessionStorageMigrationCommand) ||
        (hasSessionStorageMigrationMetadata &&
          !protectedSessionStorageMigrationCommand) ||
        (legacyToPostgresConversion &&
          action === 'recreate' &&
          parsed.cleanup_previous_runtime_required !== true)
      ) {
        return null;
      }

      for (const booleanField of [
        'remove_session',
        'remove_volume',
        'recovery_without_journal',
        'cleanup_previous_runtime_required',
      ] as const) {
        if (
          parsed[booleanField] !== undefined &&
          typeof parsed[booleanField] !== 'boolean'
        ) {
          return null;
        }
      }

      const hasSlotKey = this.isNonEmptyString(parsed.recreate_server_slot_key);
      const hasSlotToken = this.isNonEmptyString(
        parsed.recreate_server_slot_token
      );
      if (hasSlotKey !== hasSlotToken) {
        return null;
      }

      const livenessFenceFields = [
        'expected_container_id',
        'expected_container_started_at',
        'expected_container_restart_count',
        'expected_container_health_status',
        'expected_container_paused',
        'expected_runtime_generation',
      ] as const;
      const presentLivenessFenceFields = livenessFenceFields.filter(
        (field) => parsed[field] !== undefined
      );
      if (
        presentLivenessFenceFields.length !== 0 &&
        presentLivenessFenceFields.length !== livenessFenceFields.length
      ) {
        return null;
      }
      if (presentLivenessFenceFields.length === livenessFenceFields.length) {
        const expectedContainerId = parsed.expected_container_id;
        const expectedStartedAt = parsed.expected_container_started_at;
        const expectedRestartCount = parsed.expected_container_restart_count;
        const expectedHealthStatus = parsed.expected_container_health_status;
        const expectedPaused = parsed.expected_container_paused;
        const expectedRuntimeGeneration = parsed.expected_runtime_generation;
        if (
          action !== 'recreate' ||
          source !== 'worker_recreate' ||
          !this.isNonEmptyString(expectedContainerId) ||
          !CONTAINER_ID_PATTERN.test(expectedContainerId) ||
          !this.isNonEmptyString(expectedStartedAt) ||
          !Number.isFinite(Date.parse(expectedStartedAt)) ||
          typeof expectedRestartCount !== 'number' ||
          !Number.isSafeInteger(expectedRestartCount) ||
          expectedRestartCount < 0 ||
          !this.isNonEmptyString(expectedHealthStatus) ||
          !CONTAINER_HEALTH_STATUSES.has(expectedHealthStatus) ||
          typeof expectedPaused !== 'boolean' ||
          (!expectedPaused &&
            expectedHealthStatus !== 'unhealthy' &&
            !(
              expectedHealthStatus === 'starting' && expectedRestartCount >= 1
            )) ||
          typeof expectedRuntimeGeneration !== 'number' ||
          !Number.isSafeInteger(expectedRuntimeGeneration) ||
          expectedRuntimeGeneration <= 0
        ) {
          return null;
        }
      }

      return parsed as unknown as IWorkerLifecycleQueueMessage;
    } catch {
      return null;
    }
  }

  private isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }

  private classifyLifecycleError(error: unknown): 'terminal' | 'retryable' {
    if (error instanceof WorkerProviderHandoffSourceDrainPendingError) {
      /*
       * Source cleanup may have completed while its fenced database ACK is
       * still unavailable to this read. Never terminally consume the target:
       * the same durable lifecycle command must be retried/redriven until the
       * handoff phase proves that the destination is authorized.
       */
      return 'retryable';
    }

    if (
      isWorkerLifecycleBudgetExhaustionError(error) ||
      isWorkerLifecycleAuthoritativeConflictError(error)
    ) {
      /*
       * The operation and its journal remain durable. A consumed deadline or
       * an authoritative compare-and-swap conflict cannot improve through an
       * inline retry. End this delivery so the lifecycle reconciler can
       * republish the same idempotent command from fresh state.
       */
      return 'terminal';
    }

    const code =
      typeof error === 'object' &&
      error !== null &&
      typeof (error as { code?: unknown }).code === 'number'
        ? (error as { code: number }).code
        : undefined;

    return code !== undefined &&
      [
        GrpcStatus.INVALID_ARGUMENT,
        GrpcStatus.NOT_FOUND,
        GrpcStatus.ALREADY_EXISTS,
        GrpcStatus.PERMISSION_DENIED,
        GrpcStatus.UNAUTHENTICATED,
        GrpcStatus.FAILED_PRECONDITION,
        GrpcStatus.OUT_OF_RANGE,
        GrpcStatus.UNIMPLEMENTED,
      ].includes(code)
      ? 'terminal'
      : 'retryable';
  }
}
