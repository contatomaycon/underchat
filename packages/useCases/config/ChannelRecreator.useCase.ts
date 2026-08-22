import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerService } from '@core/services/worker.service';
import { AccountService } from '@core/services/account.service';
import { ConfigService } from '@core/services/config.service';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { IWorkerPayload } from '@core/common/interfaces/IWorkerPayload';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { CentrifugoService } from '@core/services/centrifugo.service';
import {
  workerCentrifugoQueue,
  channelsConfigCentrifugo,
} from '@core/common/functions/centrifugoQueue';
import { IUpdateWorker } from '@core/common/interfaces/IUpdateWorker';
import { v7 as uuidv7 } from 'uuid';
import { WorkerLifecycleQueueService } from '@core/services/workerLifecycleQueue.service';
import { IWorkerLifecycleAck } from '@core/common/interfaces/IWorkerLifecycleAck';
import { IWorkerLifecycleQueueMessage } from '@core/common/interfaces/IWorkerLifecycleQueueMessage';
import { currentTime } from '@core/common/functions/currentTime';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import {
  ConnectionLifecycleDebugService,
  createConnectionLifecycleDebugTraceId,
  isConnectionLifecycleDebugEnabled,
} from '@core/services/connectionLifecycleDebug.service';
import {
  assertNonOfficialRuntimeFeature,
  isOfficialWhatsappWorker,
} from '@core/common/functions/workerOfficialCapabilities';
import {
  publishPreparedWorkerLifecycle,
  retryWorkerLifecycleBoundary,
} from '@core/common/functions/workerLifecycleBoundary';
import { WorkerLifecycleLockService } from '@core/services/workerLifecycleLock.service';
import { ILockLeaseContext } from '@core/common/functions/withLock';
import { IWorkerMonitor } from '@core/common/interfaces/IWorkerMonitor';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { buildManagerWorkerRecreatingStatusEvent } from '@core/common/functions/workerLifecycleRealtimeStatus';

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
const RECREATE_LIFECYCLE_SOURCES = new Set<
  IWorkerLifecycleQueueMessage['source']
>([
  'worker_recreate',
  'worker_update',
  'config_recreate',
  'reset_connection',
  'self_heal',
]);

export interface ChannelRecreatorExecutionOptions {
  recreate_server_slot_key?: string;
  recreate_server_slot_token?: string;
  /**
   * A durable caller may reserve the lifecycle identity before invoking this
   * use case. Replays then prepare/redrive the same operation instead of
   * manufacturing another destructive command.
   */
  lifecycle_operation_id?: string;
  expected_worker_identity?: {
    account_id: string;
    server_id: string;
    worker_type_id: string;
  };
  /**
   * Runs after the worker row is known to be fenced by an operation and before
   * a newly claimed operation is published. Awaiting this hook closes the
   * crash window between the worker CAS and the caller's durable journal.
   */
  onLifecycleClaimed?: (
    operationId: string,
    lifecycleJournal: readonly IWorkerLifecycleQueueMessage[]
  ) => Promise<void>;
  onLifecycleEnqueued?: () => void;
}

export class PermanentChannelRecreateError extends Error {
  constructor(
    readonly reason:
      | 'account_not_found'
      | 'worker_not_found'
      | 'worker_identity_changed'
      | 'worker_blocked_by_plan'
      | 'official_runtime_not_supported'
      | 'lifecycle_operation_conflict',
    message: string
  ) {
    super(message);
    this.name = 'PermanentChannelRecreateError';
  }
}

class RetryableChannelRecreateLifecycleConflictError extends Error {
  constructor(operationId: string, workerStatusId: EWorkerStatus) {
    super(
      `channel_recreate_lifecycle_conflict:${operationId}:${workerStatusId}`
    );
    this.name = 'RetryableChannelRecreateLifecycleConflictError';
  }
}

@injectable()
export class ChannelRecreatorUseCase {
  constructor(
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(AccountService)
    private readonly accountService: AccountService,
    @inject(ConfigService)
    private readonly configService: ConfigService,
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
  ): Promise<void> {
    const consistentAccountLookup = (
      this.configService as ConfigService & {
        existsActiveAccountByIdConsistent?: (
          requestedAccountId: string
        ) => Promise<boolean>;
      }
    ).existsActiveAccountByIdConsistent;
    const existsAccountById = consistentAccountLookup
      ? await consistentAccountLookup.call(this.configService, accountId)
      : await this.accountService.existsAccountById(accountId);

    if (!existsAccountById) {
      throw new PermanentChannelRecreateError(
        'account_not_found',
        t('account_not_found')
      );
    }
  }

  private findCoherentRecreatePrimary(
    journal: readonly IWorkerLifecycleQueueMessage[],
    workerSnapshot: IWorkerMonitor,
    operationId: string
  ): IWorkerLifecycleQueueMessage | null {
    const primary = journal.filter(
      (message) => message.action !== 'cleanup_previous_runtime'
    );
    if (primary.length !== 1) {
      return null;
    }

    const recreate = primary[0];
    if (
      recreate.action !== 'recreate' ||
      !RECREATE_LIFECYCLE_SOURCES.has(recreate.source) ||
      recreate.operation_id !== operationId ||
      recreate.worker_id !== workerSnapshot.worker_id ||
      recreate.account_id !== workerSnapshot.account_id ||
      recreate.server_id !== workerSnapshot.server_id ||
      recreate.worker_type_id !== workerSnapshot.worker_type_id ||
      recreate.worker_status_id !== EWorkerStatus.recreating
    ) {
      return null;
    }

    const journalIdentityIsCoherent = journal.every(
      (message) =>
        message.operation_id === operationId &&
        message.worker_id === workerSnapshot.worker_id &&
        message.account_id === workerSnapshot.account_id &&
        (message === recreate || message.action === 'cleanup_previous_runtime')
    );
    return journalIdentityIsCoherent ? recreate : null;
  }

  private resolveDurableLifecycleConflict(
    requestedOperationId: string | undefined,
    workerStatusId: EWorkerStatus,
    canAdoptExistingRecreate: boolean
  ): { present: boolean; canSupersedeTerminalOnline: boolean } {
    const present = Boolean(requestedOperationId && !canAdoptExistingRecreate);
    return {
      present,
      canSupersedeTerminalOnline:
        present && workerStatusId === EWorkerStatus.online,
    };
  }

  private assertReservedOperationJournalCompatible(input: {
    requestedOperationId: string | undefined;
    existingOperationId: string;
    existingLifecycleJournal: readonly IWorkerLifecycleQueueMessage[];
    coherentRecreatePrimary: IWorkerLifecycleQueueMessage | null;
  }): void {
    if (
      input.requestedOperationId !== input.existingOperationId ||
      input.existingLifecycleJournal.length === 0 ||
      input.coherentRecreatePrimary !== null
    ) {
      return;
    }

    throw new PermanentChannelRecreateError(
      'lifecycle_operation_conflict',
      `channel_recreate_lifecycle_journal_conflict:${input.existingOperationId}`
    );
  }

  private buildLifecycleMessage(input: {
    payload: IWorkerPayload;
    operationId: string;
    recreateServerSlot?: {
      key: string;
      token: string;
    };
  }): IWorkerLifecycleQueueMessage {
    return {
      request_id: uuidv7(),
      operation_id: input.operationId,
      action: 'recreate',
      worker_id: input.payload.worker_id,
      account_id: input.payload.account_id,
      server_id: input.payload.server_id,
      worker_type_id: input.payload.worker_type_id,
      session_storage: input.payload.session_storage,
      worker_status_id: input.payload.worker_status_id,
      source: 'config_recreate',
      previous_worker_status_id: input.payload.previous_worker_status_id,
      recreate_server_slot_key: input.recreateServerSlot?.key,
      recreate_server_slot_token: input.recreateServerSlot?.token,
      debug_trace_id: input.payload.debug_trace_id,
      requested_at: currentTime(),
    };
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

  private async throwAfterAmbiguousLifecycleClaim(
    lifecycleMessage: IWorkerLifecycleQueueMessage,
    claimError: unknown,
    publishWhenUnconfirmed: boolean
  ): Promise<never> {
    if (publishWhenUnconfirmed) {
      try {
        /*
         * A manual request has no durable caller to redrive a prepared
         * command. Publishing is safe when the CAS did not commit because the
         * lifecycle consumer rejects a mismatched operation_id.
         */
        await this.enqueuePreparedLifecycle(lifecycleMessage);
      } catch (boundaryError) {
        throw new AggregateError(
          [claimError, boundaryError],
          'Channel recreate lifecycle claim could not be recovered'
        );
      }
    }

    throw claimError;
  }

  private async enqueueRecoveredLifecycleClaim(
    lifecycleMessage: IWorkerLifecycleQueueMessage,
    options: ChannelRecreatorExecutionOptions | undefined,
    debugTraceId: string | undefined
  ): Promise<IWorkerLifecycleAck> {
    await this.enqueuePreparedLifecycle(lifecycleMessage);
    options?.onLifecycleEnqueued?.();

    void this.connectionLifecycleDebugService.log(
      'manager.channel_recreate.ambiguous_claim_recovered',
      {
        trace_id: debugTraceId,
        layer: 'manager',
        worker_id: lifecycleMessage.worker_id,
        account_id: lifecycleMessage.account_id,
        worker_type_id: lifecycleMessage.worker_type_id,
        lifecycle_operation_id: lifecycleMessage.operation_id,
        status: EWorkerStatus.recreating,
      }
    );

    return {
      code: 202,
      status: 'queued',
      queued: true,
      worker_id: lifecycleMessage.worker_id,
      account_id: lifecycleMessage.account_id,
      server_id: lifecycleMessage.server_id,
      worker_type_id: lifecycleMessage.worker_type_id as EWorkerType,
      worker_status_id: EWorkerStatus.recreating,
      operation_id: lifecycleMessage.operation_id,
      reason: 'recreate_claim_recovered',
      debug_trace_id: debugTraceId,
    };
  }

  private async recoverAmbiguousLifecycleClaim(input: {
    lifecycleMessage: IWorkerLifecycleQueueMessage;
    claimError: unknown;
    options?: ChannelRecreatorExecutionOptions;
    debugTraceId?: string;
  }): Promise<IWorkerLifecycleAck> {
    const { lifecycleMessage, claimError, options, debugTraceId } = input;
    let snapshot: IWorkerMonitor | null = null;
    try {
      snapshot = await this.workerService.viewWorkerForMonitorConsistent(
        lifecycleMessage.worker_id
      );
    } catch {
      // The original database error remains the authoritative failure.
    }

    const claimWasCommitted = Boolean(
      snapshot &&
      !snapshot.deleted_at &&
      snapshot.worker_id === lifecycleMessage.worker_id &&
      snapshot.account_id === lifecycleMessage.account_id &&
      snapshot.server_id === lifecycleMessage.server_id &&
      snapshot.worker_type_id === lifecycleMessage.worker_type_id &&
      snapshot.worker_status_id === EWorkerStatus.recreating &&
      snapshot.lifecycle_operation_id === lifecycleMessage.operation_id
    );

    if (!claimWasCommitted || !snapshot) {
      /*
       * Durable bulk callers already own a prepared journal and will retry.
       * Do not publish an unconfirmed claim for them: if the CAS committed,
       * the retry adopts that fence; if it did not, the retry performs a new
       * CAS with the same immutable operation. This closes the double-recreate
       * window without requiring a distributed transaction.
       */
      if (!options?.onLifecycleClaimed) {
        return this.throwAfterAmbiguousLifecycleClaim(
          lifecycleMessage,
          claimError,
          true
        );
      }

      try {
        /*
         * The durable target update joins the primary worker row and succeeds
         * only while this exact lifecycle fence is active. It is therefore a
         * second authoritative confirmation when the direct primary reread is
         * unavailable after a throws-after-commit database response.
         */
        await options.onLifecycleClaimed(lifecycleMessage.operation_id, [
          lifecycleMessage,
        ]);
      } catch (durableConfirmationError) {
        throw new AggregateError(
          [claimError, durableConfirmationError],
          'Channel recreate lifecycle claim could not be durably confirmed'
        );
      }

      return this.enqueueRecoveredLifecycleClaim(
        lifecycleMessage,
        options,
        debugTraceId
      );
    }

    await options?.onLifecycleClaimed?.(lifecycleMessage.operation_id, [
      lifecycleMessage,
    ]);
    return this.enqueueRecoveredLifecycleClaim(
      lifecycleMessage,
      options,
      debugTraceId
    );
  }

  async execute(
    t: TFunction<'translation', undefined>,
    channelId: string,
    debugTraceIdInput?: string,
    options?: ChannelRecreatorExecutionOptions
  ): Promise<IWorkerLifecycleAck> {
    return this.executeInternal(t, channelId, debugTraceIdInput, options);
  }

  private async redrivePreparedWithOwnedClaim(
    channelId: string,
    operationId: string,
    debugTraceId: string | undefined,
    redriveClaimToken: string | undefined
  ): Promise<IWorkerLifecycleQueueMessage[]> {
    if (redriveClaimToken) {
      return (
        (await this.workerLifecycleQueueService.redrivePrepared?.(
          channelId,
          operationId,
          debugTraceId,
          redriveClaimToken
        )) ?? []
      );
    }
    return (
      (await this.workerLifecycleQueueService.redrivePrepared?.(
        channelId,
        operationId,
        debugTraceId
      )) ?? []
    );
  }

  private async executeInternal(
    t: TFunction<'translation', undefined>,
    channelId: string,
    debugTraceIdInput: string | undefined,
    options: ChannelRecreatorExecutionOptions | undefined,
    adoptOnlyOperationId?: string
  ): Promise<IWorkerLifecycleAck> {
    const requestedLifecycleOperationId =
      options?.lifecycle_operation_id?.trim() || undefined;
    const debugTraceId =
      debugTraceIdInput ??
      (isConnectionLifecycleDebugEnabled()
        ? createConnectionLifecycleDebugTraceId('channel_recreate')
        : undefined);

    void this.connectionLifecycleDebugService.log(
      'manager.channel_recreate.start',
      {
        trace_id: debugTraceId,
        layer: 'manager',
        worker_id: channelId,
      }
    );

    const channelContext =
      await this.configService.viewChannelContext(channelId);

    if (!channelContext) {
      throw new PermanentChannelRecreateError(
        'worker_not_found',
        t('worker_not_found')
      );
    }

    if (isOfficialWhatsappWorker(channelContext.worker_type_id)) {
      throw new PermanentChannelRecreateError(
        'official_runtime_not_supported',
        t('whatsapp_official_runtime_action_not_supported')
      );
    }

    await this.validate(t, channelContext.account_id);

    const workerSnapshot =
      await this.workerService.viewWorkerForMonitorConsistent(channelId);

    if (
      !workerSnapshot ||
      workerSnapshot.worker_id !== channelId ||
      workerSnapshot.account_id !== channelContext.account_id ||
      workerSnapshot.deleted_at !== null ||
      !workerSnapshot.server_id ||
      !workerSnapshot.worker_type_id ||
      !workerSnapshot.worker_status_id
    ) {
      throw new PermanentChannelRecreateError(
        'worker_not_found',
        t('worker_not_found')
      );
    }

    const expectedIdentity = options?.expected_worker_identity;
    if (
      expectedIdentity &&
      (workerSnapshot.account_id !== expectedIdentity.account_id ||
        workerSnapshot.server_id !== expectedIdentity.server_id ||
        workerSnapshot.worker_type_id !== expectedIdentity.worker_type_id)
    ) {
      throw new PermanentChannelRecreateError(
        'worker_identity_changed',
        t('worker_not_found')
      );
    }

    if (
      adoptOnlyOperationId &&
      workerSnapshot.lifecycle_operation_id !== adoptOnlyOperationId
    ) {
      throw new Error(t('worker_not_found'));
    }

    assertNonOfficialRuntimeFeature(
      workerSnapshot.worker_type_id,
      t('whatsapp_official_runtime_action_not_supported')
    );

    if (
      workerSnapshot.worker_status_id === EWorkerStatus.blocked ||
      workerSnapshot.worker_status_id === EWorkerStatus.deleting ||
      workerSnapshot.worker_status_id === EWorkerStatus.delete
    ) {
      throw new PermanentChannelRecreateError(
        'worker_blocked_by_plan',
        t('worker_blocked_by_plan')
      );
    }

    if (workerSnapshot.lifecycle_operation_id) {
      const existingOperationId = workerSnapshot.lifecycle_operation_id;
      const existingLifecycleJournal =
        (await this.workerLifecycleQueueService.loadPrepared?.(
          channelId,
          existingOperationId
        )) ?? [];
      const coherentRecreatePrimary = this.findCoherentRecreatePrimary(
        existingLifecycleJournal,
        workerSnapshot,
        existingOperationId
      );
      this.assertReservedOperationJournalCompatible({
        requestedOperationId: requestedLifecycleOperationId,
        existingOperationId,
        existingLifecycleJournal,
        coherentRecreatePrimary,
      });
      const canAdoptExistingRecreate =
        workerSnapshot.worker_status_id === EWorkerStatus.recreating &&
        coherentRecreatePrimary !== null;
      const durableLifecycleConflict = this.resolveDurableLifecycleConflict(
        requestedLifecycleOperationId,
        workerSnapshot.worker_status_id as EWorkerStatus,
        canAdoptExistingRecreate
      );

      /*
       * A durable bulk target may adopt only a proven recreate operation. If
       * the current fence belongs to create/activate/delete, or its journal is
       * incomplete, returning 202 would leave the target in `processing`
       * without a lifecycle baseline and could later classify the unrelated
       * operation as a failed recreate. Surface a retryable conflict instead;
       * the executor releases its reservation and retries after that lifecycle
       * reaches a terminal state.
       */
      if (
        durableLifecycleConflict.present &&
        !durableLifecycleConflict.canSupersedeTerminalOnline
      ) {
        throw new RetryableChannelRecreateLifecycleConflictError(
          existingOperationId,
          workerSnapshot.worker_status_id as EWorkerStatus
        );
      }

      const lifecycleIsLocked =
        await this.workerLifecycleLockService.isLocked(channelId);
      if (canAdoptExistingRecreate) {
        await options?.onLifecycleClaimed?.(
          existingOperationId,
          existingLifecycleJournal
        );
      }
      if (lifecycleIsLocked) {
        if (durableLifecycleConflict.present) {
          throw new RetryableChannelRecreateLifecycleConflictError(
            existingOperationId,
            workerSnapshot.worker_status_id as EWorkerStatus
          );
        }
        return {
          code: 202,
          status: 'queued',
          queued: true,
          worker_id: channelId,
          account_id: workerSnapshot.account_id,
          server_id: workerSnapshot.server_id,
          worker_type_id: workerSnapshot.worker_type_id as EWorkerType,
          worker_status_id: EWorkerStatus.recreating,
          operation_id: existingOperationId,
          reason: 'recreate_already_running',
          debug_trace_id: debugTraceId,
        };
      }

      const canRedriveExistingRecreate = canAdoptExistingRecreate;
      if (canRedriveExistingRecreate) {
        const redriveClaimed =
          await this.workerLifecycleLockService.tryClaimRedrive(
            channelId,
            existingOperationId,
            MANUAL_LIFECYCLE_REDRIVE_COOLDOWN_MS
          );
        if (!redriveClaimed) {
          return {
            code: 202,
            status: 'queued',
            queued: true,
            worker_id: channelId,
            account_id: workerSnapshot.account_id,
            server_id: workerSnapshot.server_id,
            worker_type_id: workerSnapshot.worker_type_id as EWorkerType,
            worker_status_id: EWorkerStatus.recreating,
            operation_id: existingOperationId,
            reason: 'recreate_already_running',
            debug_trace_id: debugTraceId,
          };
        }
        const redriveClaimToken =
          typeof redriveClaimed === 'string' ? redriveClaimed : undefined;

        let redriven: IWorkerLifecycleQueueMessage[];
        try {
          redriven = await this.redrivePreparedWithOwnedClaim(
            channelId,
            existingOperationId,
            debugTraceId,
            redriveClaimToken
          );
        } catch (error) {
          await this.workerLifecycleLockService
            .releaseRedriveClaim(
              channelId,
              existingOperationId,
              redriveClaimToken
            )
            .catch(() => undefined);
          throw error;
        }
        if (redriven.length > 0) {
          void this.connectionLifecycleDebugService.log(
            'manager.channel_recreate.lifecycle_resumed',
            {
              trace_id: debugTraceId,
              layer: 'manager',
              worker_id: channelId,
              account_id: workerSnapshot.account_id,
              worker_type_id: workerSnapshot.worker_type_id,
              lifecycle_operation_id: existingOperationId,
              status: EWorkerStatus.recreating,
              recovered_messages: redriven.length,
            }
          );

          return {
            code: 202,
            status: 'queued',
            queued: true,
            worker_id: channelId,
            account_id: workerSnapshot.account_id,
            server_id: workerSnapshot.server_id,
            worker_type_id: workerSnapshot.worker_type_id as EWorkerType,
            worker_status_id: EWorkerStatus.recreating,
            operation_id: existingOperationId,
            reason: 'recreate_resumed',
            debug_trace_id: debugTraceId,
          };
        }
        await this.workerLifecycleLockService.releaseRedriveClaim(
          channelId,
          existingOperationId,
          redriveClaimToken
        );
      }

      const manualTerminalOnlineRecreate =
        !requestedLifecycleOperationId &&
        workerSnapshot.worker_status_id === EWorkerStatus.online;
      const terminalOnlineLifecycleCanBeSuperseded =
        manualTerminalOnlineRecreate ||
        durableLifecycleConflict.canSupersedeTerminalOnline;
      const updatedAtMs = new Date(workerSnapshot.updated_at ?? 0).getTime();
      const lifecycleIsRecent =
        Number.isFinite(updatedAtMs) &&
        Date.now() - updatedAtMs < STALE_LIFECYCLE_MANUAL_SUPERSEDE_AFTER_MS;
      const lifecycleRelocked =
        await this.workerLifecycleLockService.isLocked(channelId);
      if (
        (!terminalOnlineLifecycleCanBeSuperseded && lifecycleIsRecent) ||
        lifecycleRelocked
      ) {
        if (durableLifecycleConflict.present) {
          throw new RetryableChannelRecreateLifecycleConflictError(
            existingOperationId,
            workerSnapshot.worker_status_id as EWorkerStatus
          );
        }
        return {
          code: 202,
          status: 'queued',
          queued: true,
          worker_id: channelId,
          account_id: workerSnapshot.account_id,
          server_id: workerSnapshot.server_id,
          worker_type_id: workerSnapshot.worker_type_id as EWorkerType,
          worker_status_id: EWorkerStatus.recreating,
          operation_id: existingOperationId,
          reason: 'recreate_already_running',
          debug_trace_id: debugTraceId,
        };
      }

      /*
       * A durable bulk target adopts an already fenced operation rather than
       * superseding it. Its journal records that exact operation before the
       * target is released, so a later recovery cannot turn an old Kafka
       * replay into a second recreation.
       */
      if (
        requestedLifecycleOperationId &&
        !durableLifecycleConflict.canSupersedeTerminalOnline
      ) {
        return {
          code: 202,
          status: 'queued',
          queued: true,
          worker_id: channelId,
          account_id: workerSnapshot.account_id,
          server_id: workerSnapshot.server_id,
          worker_type_id: workerSnapshot.worker_type_id as EWorkerType,
          worker_status_id: EWorkerStatus.recreating,
          operation_id: existingOperationId,
          reason: 'recreate_already_running',
          debug_trace_id: debugTraceId,
        };
      }

      /*
       * Terminal online operations with an incoherent/missing journal cannot
       * be adopted safely. A manual click receives a fresh operation ID; a
       * durable bulk target reuses its immutable reserved operation ID. The
       * final read, journal replacement and database CAS share the command
       * handler's distributed lock, closing the prior check-to-CAS window.
       */
      const replacementOperationId = requestedLifecycleOperationId ?? uuidv7();
      const replacementPayload: IWorkerPayload = {
        action: EWorkerAction.recreate,
        worker_id: channelId,
        server_id: workerSnapshot.server_id,
        account_id: workerSnapshot.account_id,
        worker_type_id: workerSnapshot.worker_type_id as EWorkerType,
        session_storage:
          workerSnapshot.session_storage ?? EWorkerSessionStorage.legacy_volume,
        worker_status_id: EWorkerStatus.recreating,
        lifecycle_operation_id: replacementOperationId,
        debug_trace_id: debugTraceId,
        previous_worker_status_id: workerSnapshot.worker_status_id,
      };
      const replacementMessage = this.buildLifecycleMessage({
        payload: replacementPayload,
        operationId: replacementOperationId,
        recreateServerSlot:
          options?.recreate_server_slot_key &&
          options?.recreate_server_slot_token
            ? {
                key: options.recreate_server_slot_key,
                token: options.recreate_server_slot_token,
              }
            : undefined,
      });
      let replaced = false;
      try {
        replaced = await this.workerLifecycleLockService.withLock(
          channelId,
          'channel_recreate_supersede',
          async (leaseContext) => {
            leaseContext.assertActive();
            const finalSnapshot =
              await this.workerService.viewWorkerForMonitorConsistent(
                channelId
              );
            leaseContext.assertActive();
            const finalUpdatedAtMs = new Date(
              finalSnapshot?.updated_at ?? 0
            ).getTime();
            const finalLifecycleIsTerminalOnline =
              finalSnapshot?.worker_status_id === EWorkerStatus.online;
            const finalLifecycleIsStale =
              Number.isFinite(finalUpdatedAtMs) &&
              Date.now() - finalUpdatedAtMs >=
                STALE_LIFECYCLE_MANUAL_SUPERSEDE_AFTER_MS;
            if (
              !finalSnapshot ||
              finalSnapshot.deleted_at ||
              finalSnapshot.account_id !== workerSnapshot.account_id ||
              finalSnapshot.server_id !== workerSnapshot.server_id ||
              finalSnapshot.worker_type_id !== workerSnapshot.worker_type_id ||
              finalSnapshot.worker_status_id !==
                workerSnapshot.worker_status_id ||
              finalSnapshot.lifecycle_operation_id !== existingOperationId ||
              finalSnapshot.updated_at !== workerSnapshot.updated_at ||
              (!finalLifecycleIsTerminalOnline && !finalLifecycleIsStale)
            ) {
              return false;
            }

            await this.workerLifecycleQueueService.prepare(replacementMessage);
            leaseContext.assertActive();
            const claimed =
              await this.workerService.updateWorkerByIdIfLifecycleMatches(
                workerSnapshot.account_id,
                {
                  worker_id: channelId,
                  worker_status_id: EWorkerStatus.recreating,
                  lifecycle_operation_id: replacementOperationId,
                },
                {
                  lifecycle_operation_id: existingOperationId,
                  server_id: workerSnapshot.server_id,
                  worker_type_id: workerSnapshot.worker_type_id,
                  worker_status_id: workerSnapshot.worker_status_id,
                  updated_at: workerSnapshot.updated_at,
                }
              );
            leaseContext.assertActive();
            return claimed;
          },
          {
            acquireTimeoutMs: 1_000,
            retryDelayMs: 100,
          }
        );
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes('Worker lifecycle lock timeout')
        ) {
          if (durableLifecycleConflict.present) {
            throw new RetryableChannelRecreateLifecycleConflictError(
              existingOperationId,
              workerSnapshot.worker_status_id as EWorkerStatus
            );
          }
          return {
            code: 202,
            status: 'queued',
            queued: true,
            worker_id: channelId,
            account_id: workerSnapshot.account_id,
            server_id: workerSnapshot.server_id,
            worker_type_id: workerSnapshot.worker_type_id as EWorkerType,
            worker_status_id: EWorkerStatus.recreating,
            operation_id: existingOperationId,
            reason: 'recreate_already_running',
            debug_trace_id: debugTraceId,
          };
        }
        throw error;
      }
      if (!replaced) {
        if (durableLifecycleConflict.present) {
          throw new RetryableChannelRecreateLifecycleConflictError(
            existingOperationId,
            workerSnapshot.worker_status_id as EWorkerStatus
          );
        }
        return {
          code: 202,
          status: 'queued',
          queued: true,
          worker_id: channelId,
          account_id: workerSnapshot.account_id,
          server_id: workerSnapshot.server_id,
          worker_type_id: workerSnapshot.worker_type_id as EWorkerType,
          worker_status_id: EWorkerStatus.recreating,
          operation_id: existingOperationId,
          reason: 'recreate_already_running',
          debug_trace_id: debugTraceId,
        };
      }
      await options?.onLifecycleClaimed?.(replacementOperationId, [
        replacementMessage,
      ]);
      await this.enqueuePreparedLifecycle(replacementMessage);
      options?.onLifecycleEnqueued?.();
      void this.connectionLifecycleDebugService.log(
        'manager.channel_recreate.lifecycle_superseded',
        {
          trace_id: debugTraceId,
          layer: 'manager',
          worker_id: channelId,
          account_id: workerSnapshot.account_id,
          worker_type_id: workerSnapshot.worker_type_id,
          lifecycle_operation_id: replacementOperationId,
          previous_lifecycle_operation_id: existingOperationId,
          status: EWorkerStatus.recreating,
        }
      );

      return {
        code: 202,
        status: 'queued',
        queued: true,
        worker_id: channelId,
        account_id: workerSnapshot.account_id,
        server_id: workerSnapshot.server_id,
        worker_type_id: workerSnapshot.worker_type_id as EWorkerType,
        worker_status_id: EWorkerStatus.recreating,
        operation_id: replacementOperationId,
        reason: 'recreate_superseded_stale_operation',
        debug_trace_id: debugTraceId,
      };
    }

    const lifecycleOperationId = requestedLifecycleOperationId ?? uuidv7();
    const inputRecreate: IWorkerPayload = {
      action: EWorkerAction.recreate,
      worker_id: channelId,
      server_id: workerSnapshot.server_id,
      account_id: workerSnapshot.account_id,
      worker_type_id: workerSnapshot.worker_type_id as EWorkerType,
      session_storage:
        workerSnapshot.session_storage ?? EWorkerSessionStorage.legacy_volume,
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: lifecycleOperationId,
      debug_trace_id: debugTraceId,
      previous_worker_status_id: workerSnapshot.worker_status_id,
    };

    const inputUpdate: IUpdateWorker = {
      worker_id: channelId,
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: lifecycleOperationId,
    };

    const lifecycleMessage = this.buildLifecycleMessage({
      payload: inputRecreate,
      operationId: lifecycleOperationId,
      recreateServerSlot:
        options?.recreate_server_slot_key && options?.recreate_server_slot_token
          ? {
              key: options.recreate_server_slot_key,
              token: options.recreate_server_slot_token,
            }
          : undefined,
    });

    await this.workerLifecycleQueueService.prepare(lifecycleMessage);

    let lifecycleMarked = false;
    try {
      lifecycleMarked =
        await this.workerService.updateWorkerByIdIfLifecycleMatches(
          channelContext.account_id,
          inputUpdate,
          {
            lifecycle_operation_id: null,
            server_id: workerSnapshot.server_id,
            worker_type_id: workerSnapshot.worker_type_id,
            worker_status_id: workerSnapshot.worker_status_id,
          }
        );
    } catch (claimError) {
      return this.recoverAmbiguousLifecycleClaim({
        lifecycleMessage,
        claimError,
        options,
        debugTraceId,
      });
    }
    if (!lifecycleMarked) {
      /*
       * Another request or the liveness monitor may have installed a
       * lifecycle fence after our primary snapshot. Never rebuild the caller's
       * reserved operation from a newer status: doing that would mutate its
       * durable semantic fingerprint. Adopt the winner, or retry the same
       * already-prepared payload once against the revalidated row.
       */
      const racedSnapshot =
        await this.workerService.viewWorkerForMonitorConsistent(channelId);
      if (racedSnapshot?.lifecycle_operation_id) {
        return this.executeInternal(
          t,
          channelId,
          debugTraceId,
          options,
          racedSnapshot.lifecycle_operation_id
        );
      }

      const raceIdentityIsValid =
        racedSnapshot &&
        !racedSnapshot.deleted_at &&
        racedSnapshot.worker_id === workerSnapshot.worker_id &&
        racedSnapshot.account_id === workerSnapshot.account_id &&
        racedSnapshot.server_id === workerSnapshot.server_id &&
        racedSnapshot.worker_type_id === workerSnapshot.worker_type_id &&
        racedSnapshot.worker_status_id !== EWorkerStatus.blocked &&
        racedSnapshot.worker_status_id !== EWorkerStatus.deleting &&
        racedSnapshot.worker_status_id !== EWorkerStatus.delete;
      const rowChangedAfterInitialSnapshot =
        raceIdentityIsValid &&
        (racedSnapshot.worker_status_id !== workerSnapshot.worker_status_id ||
          racedSnapshot.updated_at !== workerSnapshot.updated_at);
      if (rowChangedAfterInitialSnapshot) {
        try {
          lifecycleMarked =
            await this.workerService.updateWorkerByIdIfLifecycleMatches(
              channelContext.account_id,
              inputUpdate,
              {
                lifecycle_operation_id: null,
                server_id: racedSnapshot.server_id,
                worker_type_id: racedSnapshot.worker_type_id,
                worker_status_id: racedSnapshot.worker_status_id,
              }
            );
        } catch (claimError) {
          return this.recoverAmbiguousLifecycleClaim({
            lifecycleMessage,
            claimError,
            options,
            debugTraceId,
          });
        }
      }

      if (!lifecycleMarked) {
        const winnerSnapshot =
          await this.workerService.viewWorkerForMonitorConsistent(channelId);
        if (winnerSnapshot?.lifecycle_operation_id) {
          return this.executeInternal(
            t,
            channelId,
            debugTraceId,
            options,
            winnerSnapshot.lifecycle_operation_id
          );
        }
        throw new Error(t('worker_not_found'));
      }
    }
    void this.connectionLifecycleDebugService.log(
      'manager.channel_recreate.db_updated',
      {
        trace_id: debugTraceId,
        layer: 'manager',
        worker_id: channelId,
        account_id: channelContext.account_id,
        worker_type_id: inputRecreate.worker_type_id,
        lifecycle_operation_id: lifecycleOperationId,
        status: EWorkerStatus.recreating,
      }
    );

    await options?.onLifecycleClaimed?.(lifecycleOperationId, [
      lifecycleMessage,
    ]);
    await this.enqueuePreparedLifecycle(lifecycleMessage);
    options?.onLifecycleEnqueued?.();
    void this.connectionLifecycleDebugService.log(
      'manager.channel_recreate.lifecycle_enqueued',
      {
        trace_id: debugTraceId,
        layer: 'manager',
        worker_id: channelId,
        account_id: channelContext.account_id,
        worker_type_id: inputRecreate.worker_type_id,
        lifecycle_operation_id: lifecycleOperationId,
      }
    );

    const recreatingStatus = buildManagerWorkerRecreatingStatusEvent(
      inputRecreate,
      workerSnapshot.runtime_generation
    );
    await Promise.all([
      this.centrifugoService.publishSub(
        workerCentrifugoQueue(inputRecreate.account_id),
        recreatingStatus
      ),
      this.centrifugoService.publish(
        channelsConfigCentrifugo(),
        recreatingStatus
      ),
    ]).catch(() => undefined);

    return {
      code: 202,
      status: 'queued',
      queued: true,
      worker_id: channelId,
      account_id: channelContext.account_id,
      server_id: workerSnapshot.server_id,
      worker_type_id: inputRecreate.worker_type_id,
      worker_status_id: EWorkerStatus.recreating,
      operation_id: lifecycleOperationId,
      reason: 'recreate_queued',
      ...(recreatingStatus.runtime_generation
        ? { runtime_generation: recreatingStatus.runtime_generation }
        : {}),
      debug_trace_id: debugTraceId,
    };
  }
}
