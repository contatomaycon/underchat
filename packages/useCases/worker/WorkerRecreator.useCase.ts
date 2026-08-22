import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerService } from '@core/services/worker.service';
import { AccountService } from '@core/services/account.service';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { IWorkerPayload } from '@core/common/interfaces/IWorkerPayload';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { CentrifugoService } from '@core/services/centrifugo.service';
import {
  channelsConfigCentrifugo,
  workerCentrifugoQueue,
} from '@core/common/functions/centrifugoQueue';
import { IUpdateWorker } from '@core/common/interfaces/IUpdateWorker';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { v7 as uuidv7 } from 'uuid';
import { WorkerLifecycleQueueService } from '@core/services/workerLifecycleQueue.service';
import { IWorkerLifecycleAck } from '@core/common/interfaces/IWorkerLifecycleAck';
import { IWorkerLifecycleQueueMessage } from '@core/common/interfaces/IWorkerLifecycleQueueMessage';
import { currentTime } from '@core/common/functions/currentTime';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { WorkerRecreateCooldownError } from '@core/common/exceptions/WorkerRecreateCooldownError';
import { getWorkerRecreateAvailableAt } from '@core/common/functions/workerRecreateCooldown';
import {
  ConnectionLifecycleDebugService,
  createConnectionLifecycleDebugTraceId,
  isConnectionLifecycleDebugEnabled,
} from '@core/services/connectionLifecycleDebug.service';
import { assertNonOfficialRuntimeFeature } from '@core/common/functions/workerOfficialCapabilities';
import { IWorkerMonitor } from '@core/common/interfaces/IWorkerMonitor';
import {
  publishPreparedWorkerLifecycle,
  retryWorkerLifecycleBoundary,
} from '@core/common/functions/workerLifecycleBoundary';
import { WorkerLifecycleLockService } from '@core/services/workerLifecycleLock.service';
import { ILockLeaseContext } from '@core/common/functions/withLock';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import {
  buildManagerWorkerRecreatingStatusEvent,
  normalizeWorkerLifecycleRuntimeGeneration,
} from '@core/common/functions/workerLifecycleRealtimeStatus';

const STALE_LIFECYCLE_MANUAL_SUPERSEDE_AFTER_MS = Math.max(
  60_000,
  Number(
    process.env.WORKER_LIFECYCLE_MANUAL_SUPERSEDE_AFTER_MS ?? 5 * 60_000
  ) || 5 * 60_000
);
const MANUAL_LIFECYCLE_REDRIVE_COOLDOWN_MS = Math.max(
  5_000,
  Number(process.env.WORKER_LIFECYCLE_MANUAL_REDRIVE_COOLDOWN_MS ?? 30_000) ||
    30_000
);

const RECREATE_STATUS_PUBLISH_TIMEOUT_MS = Math.max(
  500,
  Math.min(
    10_000,
    Number(process.env.CONNECTION_RECREATE_STATUS_PUBLISH_TIMEOUT_MS) || 2_500
  )
);

@injectable()
export class WorkerRecreatorUseCase {
  constructor(
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(AccountService)
    private readonly accountService: AccountService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject(WorkerLifecycleQueueService)
    private readonly workerLifecycleQueueService: WorkerLifecycleQueueService,
    @inject(ConnectionLifecycleDebugService)
    private readonly connectionLifecycleDebugService: ConnectionLifecycleDebugService = {
      log: async () => undefined,
    } as unknown as ConnectionLifecycleDebugService,
    @inject(WorkerLifecycleLockService)
    private readonly workerLifecycleLockService: WorkerLifecycleLockService = {
      isLocked: async () => false,
      tryClaimRedrive: async () => true,
      releaseRedriveClaim: async () => undefined,
      withLock: async <T>(
        _workerId: string,
        _operation: string,
        callback: (context: ILockLeaseContext) => Promise<T>
      ) =>
        callback({
          assertActive: () => undefined,
          signal: new AbortController().signal,
        }),
    } as unknown as WorkerLifecycleLockService
  ) {}

  private async validate(
    t: TFunction<'translation', undefined>,
    accountId: string
  ) {
    const existsAccountById =
      await this.accountService.existsAccountById(accountId);

    if (!existsAccountById) {
      throw new Error(t('account_not_found'));
    }
  }

  private isValidWorkerSnapshot(
    snapshot: IWorkerMonitor | null,
    accountId: string,
    workerId: string
  ): snapshot is IWorkerMonitor {
    return Boolean(
      snapshot &&
      snapshot.worker_id === workerId &&
      snapshot.account_id === accountId &&
      snapshot.deleted_at === null &&
      snapshot.server_id &&
      snapshot.worker_type_id &&
      snapshot.worker_status_id
    );
  }

  private isSameLifecycleSnapshot(
    current: IWorkerMonitor,
    expected: IWorkerMonitor
  ): boolean {
    return (
      current.lifecycle_operation_id === expected.lifecycle_operation_id &&
      current.server_id === expected.server_id &&
      current.worker_type_id === expected.worker_type_id &&
      current.worker_status_id === expected.worker_status_id
    );
  }

  private isSamePendingLifecycleSnapshot(
    current: IWorkerMonitor | null,
    expected: IWorkerMonitor
  ): current is IWorkerMonitor {
    return Boolean(
      current &&
      this.isValidWorkerSnapshot(
        current,
        expected.account_id,
        expected.worker_id
      ) &&
      current.lifecycle_operation_id &&
      this.isSameLifecycleSnapshot(current, expected)
    );
  }

  private pendingLifecycleAck(
    snapshot: IWorkerMonitor,
    debugTraceId: string | undefined,
    reason: 'recreate_already_running' | 'recreate_resumed'
  ): IWorkerLifecycleAck {
    const runtimeGeneration = normalizeWorkerLifecycleRuntimeGeneration(
      snapshot.runtime_generation
    );

    return {
      code: 202,
      status: 'queued',
      queued: true,
      worker_id: snapshot.worker_id,
      account_id: snapshot.account_id,
      server_id: snapshot.server_id,
      worker_type_id: snapshot.worker_type_id,
      worker_status_id: EWorkerStatus.recreating,
      operation_id: snapshot.lifecycle_operation_id as string,
      reason,
      ...(runtimeGeneration ? { runtime_generation: runtimeGeneration } : {}),
      debug_trace_id: debugTraceId,
    };
  }

  private isLifecycleStale(snapshot: IWorkerMonitor): boolean {
    if (!snapshot.updated_at) {
      return false;
    }

    const updatedAtMs = new Date(snapshot.updated_at).getTime();
    return (
      Number.isFinite(updatedAtMs) &&
      Date.now() - updatedAtMs >= STALE_LIFECYCLE_MANUAL_SUPERSEDE_AFTER_MS
    );
  }

  private canSupersedeLifecycle(snapshot: IWorkerMonitor): boolean {
    /*
     * `online` is a terminal lifecycle state. A lifecycle marker that remains
     * after the worker is already online cannot be redriven as the old
     * recreate: doing so would restart a healthy runtime unexpectedly. It may
     * be replaced immediately, but only under the distributed lock and the
     * full snapshot CAS performed by execute(). Non-terminal recreates retain
     * the stale-age fence before they may be superseded.
     */
    return (
      snapshot.worker_status_id === EWorkerStatus.online ||
      this.isLifecycleStale(snapshot)
    );
  }

  private async recoverPendingLifecycle(
    t: TFunction<'translation', undefined>,
    snapshot: IWorkerMonitor,
    debugTraceId: string | undefined
  ): Promise<
    | { kind: 'ack'; ack: IWorkerLifecycleAck }
    | { kind: 'supersede'; snapshot: IWorkerMonitor }
  > {
    if (!snapshot.lifecycle_operation_id) {
      throw new Error(t('worker_not_found'));
    }

    const isPendingRecreate =
      snapshot.worker_status_id === EWorkerStatus.recreating;
    const isTerminalOnline = snapshot.worker_status_id === EWorkerStatus.online;
    if (!isPendingRecreate && !isTerminalOnline) {
      throw new Error(t('worker_not_found'));
    }

    const workerId = snapshot.worker_id;
    const existingOperationId = snapshot.lifecycle_operation_id;
    const readSameFence = async (): Promise<IWorkerMonitor> => {
      const current =
        await this.workerService.viewWorkerForMonitorConsistent(workerId);
      if (!this.isSamePendingLifecycleSnapshot(current, snapshot)) {
        throw new Error(t('worker_not_found'));
      }
      return current;
    };

    if (await this.workerLifecycleLockService.isLocked(workerId)) {
      const current = await readSameFence();
      return {
        kind: 'ack',
        ack: this.pendingLifecycleAck(
          current,
          debugTraceId,
          'recreate_already_running'
        ),
      };
    }

    /*
     * Never redrive an operation whose database lifecycle is already
     * terminal. The replacement path acquires the lifecycle lock, rereads the
     * primary and uses lifecycle/status/server/type/updated_at as its CAS
     * fence before publishing a new recreate operation.
     */
    if (isTerminalOnline) {
      return { kind: 'supersede', snapshot: await readSameFence() };
    }

    const redriveClaimed =
      await this.workerLifecycleLockService.tryClaimRedrive(
        workerId,
        existingOperationId,
        MANUAL_LIFECYCLE_REDRIVE_COOLDOWN_MS
      );
    if (!redriveClaimed) {
      const current = await readSameFence();
      return {
        kind: 'ack',
        ack: this.pendingLifecycleAck(
          current,
          debugTraceId,
          'recreate_already_running'
        ),
      };
    }
    const redriveClaimToken =
      typeof redriveClaimed === 'string' ? redriveClaimed : undefined;

    let current: IWorkerMonitor;
    let redriven: IWorkerLifecycleQueueMessage[];
    try {
      current = await readSameFence();
      redriven =
        (await (redriveClaimToken
          ? this.workerLifecycleQueueService.redrivePrepared?.(
              workerId,
              existingOperationId,
              debugTraceId,
              redriveClaimToken
            )
          : this.workerLifecycleQueueService.redrivePrepared?.(
              workerId,
              existingOperationId,
              debugTraceId
            ))) ?? [];
    } catch (error) {
      await this.workerLifecycleLockService
        .releaseRedriveClaim(workerId, existingOperationId, redriveClaimToken)
        .catch(() => undefined);
      throw error;
    }

    if (redriven.length > 0) {
      current = await readSameFence();
      void this.connectionLifecycleDebugService.log(
        'manager.worker_recreate.lifecycle_resumed',
        {
          trace_id: debugTraceId,
          layer: 'manager',
          worker_id: workerId,
          account_id: current.account_id,
          worker_type_id: current.worker_type_id,
          lifecycle_operation_id: existingOperationId,
          status: EWorkerStatus.recreating,
          recovered_messages: redriven.length,
        }
      );
      return {
        kind: 'ack',
        ack: this.pendingLifecycleAck(
          current,
          debugTraceId,
          'recreate_resumed'
        ),
      };
    }

    await this.workerLifecycleLockService.releaseRedriveClaim(
      workerId,
      existingOperationId,
      redriveClaimToken
    );

    current = await readSameFence();
    if (
      !this.canSupersedeLifecycle(current) ||
      (await this.workerLifecycleLockService.isLocked(workerId))
    ) {
      return {
        kind: 'ack',
        ack: this.pendingLifecycleAck(
          current,
          debugTraceId,
          'recreate_already_running'
        ),
      };
    }

    /*
     * A final consistent read narrows the check-to-CAS window. The update below
     * also fences operation, server, type, status and updated_at, so a concurrent
     * lifecycle/status change cannot be overwritten by this manual recovery.
     */
    current = await readSameFence();
    if (
      !this.canSupersedeLifecycle(current) ||
      (await this.workerLifecycleLockService.isLocked(workerId))
    ) {
      return {
        kind: 'ack',
        ack: this.pendingLifecycleAck(
          current,
          debugTraceId,
          'recreate_already_running'
        ),
      };
    }

    return { kind: 'supersede', snapshot: current };
  }

  private async publishLogoutInProgress(
    accountId: string,
    workerId: string
  ): Promise<void> {
    const payload: IBaileysConnectionState = {
      status: EBaileysConnectionStatus.connecting,
      code: ECodeMessage.logoutInProgress,
      worker_id: workerId,
      account_id: accountId,
      disconnected_user: true,
    };

    try {
      await this.centrifugoService.publishSub(
        workerCentrifugoQueue(accountId),
        payload
      );
    } catch {}
  }

  private buildLifecycleMessage(input: {
    payload: IWorkerPayload;
    operationId: string;
    action?: 'recreate' | 'cleanup_previous_runtime';
    source?: IWorkerLifecycleQueueMessage['source'];
    previousServerId?: string;
    previousWorkerTypeId?: EWorkerType;
    cleanupPreviousRuntimeRequired?: boolean;
  }): IWorkerLifecycleQueueMessage {
    return {
      request_id: uuidv7(),
      operation_id: input.operationId,
      action: input.action ?? 'recreate',
      worker_id: input.payload.worker_id,
      account_id: input.payload.account_id,
      server_id: input.payload.server_id,
      worker_type_id: input.payload.worker_type_id,
      session_storage: input.payload.session_storage,
      previous_session_storage: input.payload.previous_session_storage,
      worker_status_id: input.payload.worker_status_id,
      source: input.source ?? 'worker_recreate',
      remove_session: input.payload.remove_session,
      remove_volume: input.payload.remove_volume,
      previous_server_id: input.previousServerId,
      previous_worker_type_id: input.previousWorkerTypeId,
      previous_worker_status_id: input.payload.previous_worker_status_id,
      cleanup_previous_runtime_required: input.cleanupPreviousRuntimeRequired,
      debug_trace_id: input.payload.debug_trace_id,
      requested_at: currentTime(),
    };
  }

  private async prepareLifecycleJournal(
    primary: IWorkerLifecycleQueueMessage,
    cleanup?: IWorkerLifecycleQueueMessage
  ): Promise<void> {
    await this.workerLifecycleQueueService.prepare(primary);
    if (cleanup) {
      await this.workerLifecycleQueueService.prepare(cleanup);
    }
  }

  private async enqueueLifecycleJournal(
    primary: IWorkerLifecycleQueueMessage,
    cleanup?: IWorkerLifecycleQueueMessage
  ): Promise<void> {
    if (cleanup) {
      await this.enqueuePreparedLifecycle(cleanup);
    }
    await this.enqueuePreparedLifecycle(primary);
  }

  private async enqueuePreparedLifecycle(
    message: IWorkerLifecycleQueueMessage
  ): Promise<void> {
    await retryWorkerLifecycleBoundary(() =>
      this.workerLifecycleQueueService.prepare(message)
    );
    await publishPreparedWorkerLifecycle({
      publish: () => this.workerLifecycleQueueService.publish(message),
    });
  }

  private async publishRecreatingStatus(
    payload: IWorkerPayload,
    runtimeGeneration?: number | null
  ): Promise<void> {
    const event = buildManagerWorkerRecreatingStatusEvent(
      payload,
      runtimeGeneration
    );
    await Promise.all([
      this.centrifugoService.publishSub(
        workerCentrifugoQueue(payload.account_id),
        event
      ),
      this.centrifugoService.publish(channelsConfigCentrifugo(), event),
    ]);
  }

  private publishRecreatingStatusBestEffort(
    payload: IWorkerPayload,
    runtimeGeneration?: number | null
  ): void {
    void this.withTimeout(
      this.publishRecreatingStatus(payload, runtimeGeneration),
      RECREATE_STATUS_PUBLISH_TIMEOUT_MS
    ).catch(() => {});
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`operation timeout after ${timeoutMs}ms`)),
        timeoutMs
      );

      promise.then(
        (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        (error) => {
          clearTimeout(timeout);
          reject(error);
        }
      );
    });
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    options?: {
      remove_session?: boolean;
      remove_volume?: boolean;
      enforce_recreate_cooldown?: boolean;
      lifecycle_operation_id?: string;
      previous_worker_status_id?: EWorkerStatus;
      debug_trace_id?: string;
      /**
       * Explicitly discards the current identity and always starts on the
       * PostgreSQL session backend. This destructive path may supersede an
       * unrelated in-flight lifecycle; ordinary recreates never do so.
       */
      fresh_connection?: boolean;
    }
  ): Promise<IWorkerLifecycleAck> {
    const lifecycleOperationId = options?.lifecycle_operation_id ?? uuidv7();
    const debugTraceId =
      options?.debug_trace_id ??
      (isConnectionLifecycleDebugEnabled()
        ? createConnectionLifecycleDebugTraceId('worker_recreate')
        : undefined);

    void this.connectionLifecycleDebugService.log(
      'manager.worker_recreate.start',
      {
        trace_id: debugTraceId,
        layer: 'manager',
        worker_id: workerId,
        account_id: accountId,
        lifecycle_operation_id: lifecycleOperationId,
        remove_session: options?.remove_session === true,
        remove_volume: options?.remove_volume === true,
        fresh_connection: options?.fresh_connection === true,
      }
    );

    await this.validate(t, accountId);

    let workerSnapshot =
      await this.workerService.viewWorkerForMonitorConsistent(workerId);

    if (!this.isValidWorkerSnapshot(workerSnapshot, accountId, workerId)) {
      const viewWorker = await this.workerService.viewWorker(
        accountId,
        workerId
      );

      if (viewWorker?.status?.id === EWorkerStatus.blocked) {
        throw new Error(t('worker_blocked_by_plan'));
      }

      assertNonOfficialRuntimeFeature(
        viewWorker?.type?.id,
        t('whatsapp_official_runtime_action_not_supported')
      );

      throw new Error(t('worker_not_found'));
    }

    if (
      workerSnapshot.worker_status_id === EWorkerStatus.blocked ||
      workerSnapshot.worker_status_id === EWorkerStatus.deleting ||
      workerSnapshot.worker_status_id === EWorkerStatus.delete
    ) {
      throw new Error(t('worker_blocked_by_plan'));
    }

    assertNonOfficialRuntimeFeature(
      workerSnapshot.worker_type_id,
      t('whatsapp_official_runtime_action_not_supported')
    );

    const previousSessionStorage =
      workerSnapshot.session_storage ?? EWorkerSessionStorage.legacy_volume;
    const startsFreshConnection = options?.fresh_connection === true;
    const sessionStorage = startsFreshConnection
      ? EWorkerSessionStorage.postgres
      : previousSessionStorage;
    const convertsLegacySession =
      startsFreshConnection &&
      previousSessionStorage === EWorkerSessionStorage.legacy_volume;
    const removeSession =
      startsFreshConnection || options?.remove_session === true;
    const removeVolumeRequested =
      startsFreshConnection || options?.remove_volume === true;
    const removeVolume =
      removeVolumeRequested &&
      previousSessionStorage === EWorkerSessionStorage.legacy_volume;

    let supersededLifecycleOperationId: string | undefined;
    if (workerSnapshot.lifecycle_operation_id) {
      if (startsFreshConnection) {
        // A destructive reset is an explicit operator decision. Replacing the
        // database fence immediately makes every older lifecycle stale; its
        // handler will stop at the next authoritative boundary, while the new
        // command waits for the same distributed execution lock before doing
        // any container or session work.
        supersededLifecycleOperationId = workerSnapshot.lifecycle_operation_id;
      } else {
        const recovery = await this.recoverPendingLifecycle(
          t,
          workerSnapshot,
          debugTraceId
        );
        if (recovery.kind === 'ack') {
          void this.connectionLifecycleDebugService.log(
            'manager.worker_recreate.response',
            {
              trace_id: debugTraceId,
              layer: 'manager',
              worker_id: workerId,
              account_id: recovery.ack.account_id,
              worker_type_id: recovery.ack.worker_type_id,
              lifecycle_operation_id: recovery.ack.operation_id,
              status: recovery.ack.status,
              reason: recovery.ack.reason,
            }
          );
          return recovery.ack;
        }

        workerSnapshot = recovery.snapshot;
        supersededLifecycleOperationId = recovery.snapshot
          .lifecycle_operation_id as string;
      }
    }

    const inputRecreate: IWorkerPayload = {
      action: EWorkerAction.recreate,
      worker_id: workerId,
      server_id: workerSnapshot.server_id,
      account_id: workerSnapshot.account_id,
      worker_type_id: workerSnapshot.worker_type_id as EWorkerType,
      session_storage: sessionStorage,
      ...(convertsLegacySession
        ? {
            previous_session_storage: EWorkerSessionStorage.legacy_volume,
          }
        : {}),
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: lifecycleOperationId,
      debug_trace_id: debugTraceId,
      previous_worker_status_id:
        options?.previous_worker_status_id ?? workerSnapshot.worker_status_id,
      ...(removeSession ? { remove_session: true } : {}),
      ...(removeVolumeRequested ? { remove_volume: removeVolume } : {}),
    };

    const shouldApplyCooldown = options?.enforce_recreate_cooldown === true;
    const recreateAvailableAt = shouldApplyCooldown
      ? getWorkerRecreateAvailableAt()
      : undefined;

    if (recreateAvailableAt) {
      inputRecreate.recreate_available_at = recreateAvailableAt;
    }

    const inputUpdate: IUpdateWorker = {
      worker_id: workerId,
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: lifecycleOperationId,
      ...(recreateAvailableAt
        ? { recreate_available_at: recreateAvailableAt }
        : {}),
      ...(removeSession ? { number: null, connection_date: null } : {}),
      ...(startsFreshConnection
        ? { session_storage: EWorkerSessionStorage.postgres }
        : {}),
    };

    const lifecycleMessage = this.buildLifecycleMessage({
      payload: inputRecreate,
      operationId: lifecycleOperationId,
      source: startsFreshConnection ? 'reset_connection' : 'worker_recreate',
      previousServerId: convertsLegacySession
        ? workerSnapshot.server_id
        : undefined,
      previousWorkerTypeId: convertsLegacySession
        ? (workerSnapshot.worker_type_id as EWorkerType)
        : undefined,
      cleanupPreviousRuntimeRequired: convertsLegacySession || undefined,
    });
    const cleanupLifecycleMessage = convertsLegacySession
      ? this.buildLifecycleMessage({
          payload: {
            ...inputRecreate,
            action: EWorkerAction.cleanup,
            server_id: workerSnapshot.server_id,
            worker_type_id: workerSnapshot.worker_type_id as EWorkerType,
          },
          operationId: lifecycleOperationId,
          action: 'cleanup_previous_runtime',
          source: 'reset_connection',
          previousServerId: workerSnapshot.server_id,
          previousWorkerTypeId: workerSnapshot.worker_type_id as EWorkerType,
        })
      : undefined;

    let workerUpdated = false;
    const lifecycleClaimGuard = {
      lifecycle_operation_id: supersededLifecycleOperationId ?? null,
      server_id: workerSnapshot.server_id,
      worker_type_id: workerSnapshot.worker_type_id,
      worker_status_id: workerSnapshot.worker_status_id,
      ...(supersededLifecycleOperationId
        ? { updated_at: workerSnapshot.updated_at }
        : {}),
    };
    try {
      if (supersededLifecycleOperationId && !startsFreshConnection) {
        workerUpdated = await this.workerLifecycleLockService.withLock(
          workerId,
          'worker_recreate_supersede',
          async (leaseContext) => {
            leaseContext.assertActive();
            const finalSnapshot =
              await this.workerService.viewWorkerForMonitorConsistent(workerId);
            leaseContext.assertActive();
            if (
              !this.isSamePendingLifecycleSnapshot(
                finalSnapshot,
                workerSnapshot
              ) ||
              finalSnapshot.updated_at !== workerSnapshot.updated_at ||
              !this.canSupersedeLifecycle(finalSnapshot)
            ) {
              return false;
            }
            await this.prepareLifecycleJournal(
              lifecycleMessage,
              cleanupLifecycleMessage
            );
            leaseContext.assertActive();
            const claimed = shouldApplyCooldown
              ? await this.workerService.updateWorkerByIdIfRecreateAvailable(
                  accountId,
                  inputUpdate,
                  new Date().toISOString(),
                  lifecycleClaimGuard
                )
              : await this.workerService.updateWorkerByIdIfLifecycleMatches(
                  accountId,
                  inputUpdate,
                  lifecycleClaimGuard
                );
            leaseContext.assertActive();
            return claimed;
          },
          {
            acquireTimeoutMs: 1_000,
            retryDelayMs: 100,
          }
        );
      } else {
        await this.prepareLifecycleJournal(
          lifecycleMessage,
          cleanupLifecycleMessage
        );
        workerUpdated = shouldApplyCooldown
          ? await this.workerService.updateWorkerByIdIfRecreateAvailable(
              accountId,
              inputUpdate,
              new Date().toISOString(),
              lifecycleClaimGuard
            )
          : await this.workerService.updateWorkerByIdIfLifecycleMatches(
              accountId,
              inputUpdate,
              lifecycleClaimGuard
            );
      }
    } catch (claimError) {
      if (
        claimError instanceof Error &&
        claimError.message.includes('Worker lifecycle lock timeout') &&
        supersededLifecycleOperationId
      ) {
        return this.pendingLifecycleAck(
          workerSnapshot,
          debugTraceId,
          'recreate_already_running'
        );
      }
      try {
        await this.enqueueLifecycleJournal(
          lifecycleMessage,
          cleanupLifecycleMessage
        );
      } catch (boundaryError) {
        throw new AggregateError(
          [claimError, boundaryError],
          'Worker recreate lifecycle claim could not be recovered'
        );
      }

      throw claimError;
    }

    void this.connectionLifecycleDebugService.log(
      'manager.worker_recreate.db_updated',
      {
        trace_id: debugTraceId,
        layer: 'manager',
        worker_id: workerId,
        account_id: workerSnapshot.account_id,
        worker_type_id: inputRecreate.worker_type_id,
        lifecycle_operation_id: lifecycleOperationId,
        previous_lifecycle_operation_id: supersededLifecycleOperationId,
        status: EWorkerStatus.recreating,
        worker_updated: workerUpdated,
      }
    );

    if (!workerUpdated && shouldApplyCooldown) {
      const currentSnapshot =
        await this.workerService.viewWorkerForMonitorConsistent(workerId);

      if (
        !this.isValidWorkerSnapshot(currentSnapshot, accountId, workerId) ||
        !this.isSameLifecycleSnapshot(currentSnapshot, workerSnapshot) ||
        (supersededLifecycleOperationId &&
          currentSnapshot.updated_at !== workerSnapshot.updated_at)
      ) {
        throw new Error(t('worker_not_found'));
      }

      const currentWorker = await this.workerService.viewWorker(
        accountId,
        workerId
      );
      const currentRecreateAvailableAt =
        currentWorker?.recreate_available_at ?? null;

      throw new WorkerRecreateCooldownError(
        t('worker_recreate_cooldown_active'),
        currentRecreateAvailableAt
      );
    }

    if (!workerUpdated) {
      throw new Error(t('worker_not_found'));
    }

    await this.enqueueLifecycleJournal(
      lifecycleMessage,
      cleanupLifecycleMessage
    );

    if (removeSession) {
      await this.publishLogoutInProgress(accountId, workerId);
    }

    void this.connectionLifecycleDebugService.log(
      'manager.worker_recreate.lifecycle_enqueued',
      {
        trace_id: debugTraceId,
        layer: 'manager',
        worker_id: workerId,
        account_id: workerSnapshot.account_id,
        worker_type_id: inputRecreate.worker_type_id,
        lifecycle_operation_id: lifecycleOperationId,
      }
    );
    this.publishRecreatingStatusBestEffort(
      inputRecreate,
      workerSnapshot.runtime_generation
    );

    const runtimeGeneration = normalizeWorkerLifecycleRuntimeGeneration(
      workerSnapshot.runtime_generation
    );
    const ack: IWorkerLifecycleAck = {
      code: 202,
      status: 'queued',
      queued: true,
      worker_id: workerId,
      account_id: workerSnapshot.account_id,
      server_id: workerSnapshot.server_id,
      worker_type_id: inputRecreate.worker_type_id,
      worker_status_id: EWorkerStatus.recreating,
      operation_id: lifecycleOperationId,
      reason: startsFreshConnection
        ? 'reset_queued'
        : supersededLifecycleOperationId
          ? 'recreate_superseded_stale_operation'
          : options?.remove_session === true
            ? 'reset_queued'
            : 'recreate_queued',
      recreate_available_at: recreateAvailableAt,
      ...(runtimeGeneration ? { runtime_generation: runtimeGeneration } : {}),
      debug_trace_id: debugTraceId,
    };

    void this.connectionLifecycleDebugService.log(
      'manager.worker_recreate.response',
      {
        trace_id: debugTraceId,
        layer: 'manager',
        worker_id: workerId,
        account_id: workerSnapshot.account_id,
        worker_type_id: inputRecreate.worker_type_id,
        lifecycle_operation_id: lifecycleOperationId,
        status: ack.status,
        reason: ack.reason,
      }
    );

    return ack;
  }
}
