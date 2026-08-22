import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { v5 as uuidv5, v7 as uuidv7 } from 'uuid';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { currentTime } from '@core/common/functions/currentTime';
import { IWorkerLifecycleQueueMessage } from '@core/common/interfaces/IWorkerLifecycleQueueMessage';
import {
  WorkerRuntimeRepository,
  WhatsappProviderHandoffDecisionSnapshot,
  WhatsappProviderHandoffOutboxEvidence,
  WhatsappProviderHandoffResolutionClaim,
} from '@core/repositories/worker/WorkerRuntime.repository';
import { WorkerLifecycleQueueService } from '@core/services/workerLifecycleQueue.service';
import { WhatsappProviderHandoffRecoveryService } from '@core/services/whatsappProviderHandoffRecovery.service';

type ResolutionAction = 'return' | 'discard';
type Provider = 'baileys' | 'wwebjs' | 'whatsmeow';

const PROVIDER_WORKER_TYPE: Record<Provider, EWorkerType> = {
  baileys: EWorkerType.baileys,
  wwebjs: EWorkerType.wwebjs,
  whatsmeow: EWorkerType.whatsmeow,
};

// Stable per-handoff operation identity makes concurrent/retried discard
// requests write the same lifecycle journal before the database CAS.
const HANDOFF_DISCARD_OPERATION_NAMESPACE =
  'a27b5607-5a31-4a4e-a9e0-61a9ec43a3a8';

export interface WorkerWhatsappProviderHandoffView {
  worker_id: string;
  handoff_id: string;
  lifecycle_operation_id: string | null;
  handoff_lifecycle_operation_id: string | null;
  state: string;
  source_provider: Provider;
  target_provider: Provider;
  source_revision_id: string;
  target_revision_id: string | null;
  error_code: string | null;
  recovery_state: string;
  recovery_operation_id: string | null;
  recovery_error_code: string | null;
  source_revision_preserved: boolean;
  source_runtime_restored: boolean;
  resolution_required: boolean;
  can_return: boolean;
  can_discard: boolean;
  resolution_action: ResolutionAction | null;
  resolution_state: 'running' | 'completed' | null;
  resolution_operation_id: string | null;
  resolution_status:
    | 'in_progress'
    | 'completed'
    | 'restoring_source'
    | 'awaiting_decision'
    | 'rollback_blocked';
  created_at: string;
  updated_at: string;
}

export interface WorkerWhatsappProviderHandoffResolution {
  action: ResolutionAction;
  status: 'queued' | 'completed' | 'blocked';
  reason: string;
  handoff: WorkerWhatsappProviderHandoffView | null;
  operation_id?: string;
}

@injectable()
export class WorkerWhatsappProviderHandoffUseCase {
  constructor(
    @inject(WorkerRuntimeRepository)
    private readonly runtimeRepository: WorkerRuntimeRepository,
    @inject(WorkerLifecycleQueueService)
    private readonly lifecycleQueue: WorkerLifecycleQueueService,
    @inject(WhatsappProviderHandoffRecoveryService)
    private readonly recoveryService?: WhatsappProviderHandoffRecoveryService
  ) {}

  /**
   * The durable row is still redriven by the scheduled recovery job, but a
   * user explicitly choosing to return must not appear inert while waiting for
   * that separate process.  The service claims the exact handoff with the
   * same database fences, so concurrent cron/API attempts are idempotent.
   */
  private async redriveReturnNow(input: {
    accountId: string;
    handoffId: string;
    workerId: string;
  }): Promise<void> {
    const recoveryService = this.recoveryService;
    if (!recoveryService) return;
    await recoveryService.recoverHandoffNow(input).catch(() => undefined);
  }

  private map(
    snapshot: WhatsappProviderHandoffDecisionSnapshot
  ): WorkerWhatsappProviderHandoffView {
    // A Postgres worker can legitimately be between runtime generations. A
    // missing runtime is a recoverable/quiescing state, not a legacy volume;
    // only an explicit legacy runtime must fail closed here.
    const postgresSession =
      snapshot.worker_session_storage === EWorkerSessionStorage.postgres &&
      snapshot.runtime_session_storage !== EWorkerSessionStorage.legacy_volume;
    const postgresRuntime =
      snapshot.runtime_session_storage === EWorkerSessionStorage.postgres;
    const sourceRevisionPreserved =
      postgresSession &&
      snapshot.session_provider === snapshot.source_provider &&
      snapshot.session_state === 'ready' &&
      snapshot.active_revision_id === snapshot.source_revision_id;
    const leaseExpiresAt = Date.parse(snapshot.lease_expires_at ?? '');
    const databaseNow = Date.parse(snapshot.database_now);
    const sourceRuntimeRestored = Boolean(
      postgresSession &&
      sourceRevisionPreserved &&
      snapshot.worker_type_id ===
        PROVIDER_WORKER_TYPE[snapshot.source_provider] &&
      snapshot.worker_status_id === EWorkerStatus.online &&
      snapshot.worker_lifecycle_operation_id === null &&
      snapshot.worker_container_id &&
      snapshot.worker_container_id === snapshot.runtime_container_id &&
      snapshot.runtime_session_storage === EWorkerSessionStorage.postgres &&
      snapshot.runtime_source_provider === snapshot.source_provider &&
      snapshot.runtime_online_acknowledged === true &&
      snapshot.runtime_connection_activated_at &&
      snapshot.session_generation &&
      snapshot.session_generation > 0 &&
      snapshot.runtime_generation === snapshot.session_generation &&
      snapshot.session_epoch &&
      snapshot.runtime_writer_epoch &&
      snapshot.runtime_writer_epoch === snapshot.session_epoch &&
      snapshot.session_capability_hash &&
      snapshot.runtime_capability_hash &&
      snapshot.runtime_capability_hash === snapshot.session_capability_hash &&
      snapshot.lease_provider === snapshot.source_provider &&
      snapshot.lease_generation === snapshot.runtime_generation &&
      snapshot.lease_epoch &&
      snapshot.lease_epoch === snapshot.runtime_writer_epoch &&
      snapshot.lease_owner_id &&
      snapshot.runtime_status_lease_owner_id &&
      snapshot.lease_owner_id === snapshot.runtime_status_lease_owner_id &&
      snapshot.lease_fencing_token &&
      snapshot.runtime_status_fencing_token &&
      snapshot.lease_fencing_token === snapshot.runtime_status_fencing_token &&
      Number.isFinite(leaseExpiresAt) &&
      Number.isFinite(databaseNow) &&
      leaseExpiresAt > databaseNow + 5_000
    );
    const failed = snapshot.state === 'failed';
    const hasResolution = snapshot.resolution_action !== null;
    const sourceLifecycleCanBeDiscarded =
      (snapshot.worker_status_id === EWorkerStatus.online &&
        snapshot.worker_lifecycle_operation_id === null) ||
      (snapshot.worker_status_id === EWorkerStatus.recreating &&
        snapshot.worker_lifecycle_operation_id !== null &&
        ((!hasResolution &&
          snapshot.worker_lifecycle_operation_id ===
            snapshot.handoff_lifecycle_operation_id) ||
          (snapshot.resolution_action === 'return' &&
            snapshot.resolution_state === 'running' &&
            (snapshot.worker_lifecycle_operation_id ===
              snapshot.resolution_operation_id ||
              snapshot.worker_lifecycle_operation_id ===
                snapshot.recovery_operation_id))));
    // Discard is destructive, so it has a narrower proof than return. It is
    // deliberately independent of the source revision/online lease proof:
    // the cleanup flow only needs a bound Postgres runtime whose durable
    // identity still names the preserved source.
    const sourceRuntimeCanBeDiscarded = Boolean(
      postgresSession &&
      postgresRuntime &&
      snapshot.worker_type_id ===
        PROVIDER_WORKER_TYPE[snapshot.source_provider] &&
      snapshot.runtime_source_provider === snapshot.source_provider &&
      snapshot.runtime_container_id &&
      sourceLifecycleCanBeDiscarded
    );
    const pendingReturnCanBeDiscarded =
      failed &&
      snapshot.resolution_action === 'return' &&
      snapshot.resolution_state === 'running' &&
      sourceRuntimeCanBeDiscarded;
    const directDiscardCanBeStarted =
      failed && !hasResolution && sourceRuntimeCanBeDiscarded;
    const resolutionStatus =
      snapshot.resolution_state === 'completed' ||
      (snapshot.state === 'completed' && !hasResolution)
        ? 'completed'
        : hasResolution
          ? snapshot.resolution_action === 'return'
            ? snapshot.recovery_state === 'blocked'
              ? 'rollback_blocked'
              : 'restoring_source'
            : 'in_progress'
          : !failed
            ? 'in_progress'
            : sourceRuntimeRestored
              ? 'awaiting_decision'
              : sourceRevisionPreserved
                ? 'restoring_source'
                : 'rollback_blocked';

    return {
      worker_id: snapshot.worker_id,
      handoff_id: snapshot.handoff_id,
      // This is the immutable identity of the provider switch. The worker's
      // current lifecycle operation is cleared when rollback finishes and is
      // replaced by a new operation when the user chooses discard, so it
      // cannot be used by a reload-safe monitor.
      lifecycle_operation_id: snapshot.handoff_lifecycle_operation_id,
      handoff_lifecycle_operation_id: snapshot.handoff_lifecycle_operation_id,
      state: snapshot.state,
      source_provider: snapshot.source_provider,
      target_provider: snapshot.target_provider,
      source_revision_id: snapshot.source_revision_id,
      target_revision_id: snapshot.target_revision_id,
      error_code: snapshot.error_code,
      recovery_state: snapshot.recovery_state,
      recovery_operation_id: snapshot.recovery_operation_id,
      recovery_error_code: snapshot.recovery_last_error_code,
      source_revision_preserved: sourceRevisionPreserved,
      source_runtime_restored: sourceRuntimeRestored,
      resolution_required:
        postgresSession &&
        failed &&
        (!hasResolution || pendingReturnCanBeDiscarded),
      // A return is specifically the action that repairs an unhealthy source
      // runtime, so it is safe as soon as the durable source revision is
      // preserved.  It immediately redrives the fenced recovery below.
      can_return: failed && !hasResolution && sourceRevisionPreserved,
      // Discard has its own safe identity proof (bound Postgres source
      // runtime), so it remains available even if the source connection is
      // not currently online. An already-running return can be superseded;
      // the database atomically cancels that recovery, fences its lease, and
      // installs cleanup-before-target before any Kafka work is published.
      can_discard: directDiscardCanBeStarted || pendingReturnCanBeDiscarded,
      resolution_action: snapshot.resolution_action,
      resolution_state: snapshot.resolution_state,
      resolution_operation_id: snapshot.resolution_operation_id,
      resolution_status: resolutionStatus,
      created_at: snapshot.created_at,
      updated_at: snapshot.updated_at,
    };
  }

  async viewLatest(
    accountId: string,
    workerId: string
  ): Promise<WorkerWhatsappProviderHandoffView | null> {
    const snapshot =
      await this.runtimeRepository.viewWhatsappProviderHandoffDecision({
        account_id: accountId,
        worker_id: workerId,
      });
    return snapshot ? this.map(snapshot) : null;
  }

  async viewOutboxEvidence(input: {
    accountId: string;
    workerId: string;
    afterOrder?: string;
    operationId?: string;
    debugTraceId?: string;
  }): Promise<WhatsappProviderHandoffOutboxEvidence> {
    return this.runtimeRepository.viewWhatsappProviderHandoffOutboxEvidence({
      account_id: input.accountId,
      worker_id: input.workerId,
      after_order: input.afterOrder,
      operation_id: input.operationId,
      debug_trace_id: input.debugTraceId,
    });
  }

  private buildDiscardMessages(
    snapshot: WhatsappProviderHandoffDecisionSnapshot,
    operationId: string
  ): {
    primary: IWorkerLifecycleQueueMessage;
    cleanup: IWorkerLifecycleQueueMessage;
  } {
    if (!snapshot.worker_server_id) {
      throw new Error('whatsapp_handoff_discard_server_missing');
    }
    const requestedAt = currentTime();
    const sourceWorkerType = PROVIDER_WORKER_TYPE[snapshot.source_provider];
    const targetWorkerType = PROVIDER_WORKER_TYPE[snapshot.target_provider];
    const base = {
      operation_id: operationId,
      worker_id: snapshot.worker_id,
      account_id: snapshot.account_id,
      session_storage: EWorkerSessionStorage.postgres,
      worker_status_id: EWorkerStatus.recreating,
      source: 'worker_update' as const,
      // The source cleanup performs the session reset through the dedicated
      // manager-side resolution CAS after removing the exact old container.
      // Neither provider RPC nor the target recreate is allowed to delete it.
      remove_session: false,
      remove_volume: false,
      previous_server_id: snapshot.worker_server_id,
      previous_worker_type_id: sourceWorkerType,
      previous_worker_status_id: EWorkerStatus.online,
      requested_at: requestedAt,
      debug_trace_id: `whatsapp_handoff_discard_${snapshot.handoff_id}`,
    };
    return {
      primary: {
        ...base,
        request_id: uuidv7(),
        action: 'recreate',
        server_id: snapshot.worker_server_id,
        worker_type_id: targetWorkerType,
        cleanup_previous_runtime_required: true,
      },
      cleanup: {
        ...base,
        request_id: uuidv7(),
        action: 'cleanup_previous_runtime',
        server_id: snapshot.worker_server_id,
        worker_type_id: sourceWorkerType,
      },
    };
  }

  private blocked(
    action: ResolutionAction,
    reason: string,
    view: WorkerWhatsappProviderHandoffView | null,
    operationId?: string | null
  ): WorkerWhatsappProviderHandoffResolution {
    return {
      action,
      status: 'blocked',
      reason,
      handoff: view,
      ...(operationId ? { operation_id: operationId } : {}),
    };
  }

  private reasonForClaim(
    action: ResolutionAction,
    claim: WhatsappProviderHandoffResolutionClaim
  ): string {
    if (claim.outcome === 'conflict') return 'resolution_action_conflict';
    if (claim.outcome === 'handoff_completed') {
      return 'handoff_already_completed';
    }
    if (claim.outcome === 'handoff_in_progress') {
      return 'handoff_still_in_progress';
    }
    if (claim.outcome === 'source_revision_unavailable') {
      return 'source_rollback_blocked';
    }
    if (claim.outcome === 'source_runtime_not_restored') {
      return 'source_must_be_restored_before_discard';
    }
    if (claim.outcome === 'source_runtime_identity_unavailable') {
      return 'source_runtime_identity_unavailable';
    }
    if (claim.outcome === 'return_recovery_quiescing') {
      return 'return_recovery_quiescing';
    }
    return action === 'return'
      ? 'source_restore_queued'
      : 'session_discard_queued';
  }

  async resolve(
    _t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    handoffId: string,
    action: ResolutionAction
  ): Promise<WorkerWhatsappProviderHandoffResolution | null> {
    const snapshot =
      await this.runtimeRepository.viewWhatsappProviderHandoffDecision({
        account_id: accountId,
        worker_id: workerId,
        handoff_id: handoffId,
      });
    if (!snapshot) return null;

    let view = this.map(snapshot);
    if (
      snapshot.worker_session_storage !== EWorkerSessionStorage.postgres ||
      snapshot.runtime_session_storage === EWorkerSessionStorage.legacy_volume
    ) {
      return this.blocked(
        action,
        'legacy_volume_handoff_recovery_forbidden',
        view
      );
    }
    const pendingReturnCanBeDiscarded =
      action === 'discard' &&
      snapshot.resolution_action === 'return' &&
      snapshot.resolution_state === 'running';
    if (
      snapshot.resolution_action &&
      snapshot.resolution_action !== action &&
      !pendingReturnCanBeDiscarded
    ) {
      return this.blocked(
        action,
        'resolution_action_conflict',
        view,
        snapshot.resolution_operation_id
      );
    }
    if (snapshot.resolution_state === 'completed') {
      return {
        action,
        status: 'completed',
        reason:
          action === 'return' ? 'source_restored' : 'session_discard_completed',
        handoff: view,
        operation_id: snapshot.resolution_operation_id ?? undefined,
      };
    }
    if (snapshot.state !== 'failed') {
      return this.blocked(
        action,
        snapshot.state === 'completed'
          ? 'handoff_already_completed'
          : 'handoff_still_in_progress',
        view
      );
    }

    // A prior discard claim already owns the deterministic lifecycle graph.
    // Retrying from the dialog must be idempotent: do not re-prepare or
    // re-publish cleanup/target commands, and do not reject it merely because
    // the worker has already moved to the target lifecycle.
    if (
      action === 'discard' &&
      snapshot.resolution_action === 'discard' &&
      snapshot.resolution_state === 'running' &&
      snapshot.resolution_operation_id
    ) {
      // Re-deliver only the immutable, already-prepared graph. This covers a
      // crash after the database claim and before Kafka publish without
      // allowing a retry to synthesize a second cleanup/target operation.
      const queue = this.lifecycleQueue as unknown as {
        redrivePrepared?: (
          workerId: string,
          operationId: string,
          debugTraceId?: string
        ) => Promise<unknown>;
      };
      if (typeof queue.redrivePrepared === 'function') {
        await queue.redrivePrepared(
          workerId,
          snapshot.resolution_operation_id,
          `whatsapp_handoff_discard_${handoffId}`
        );
      }
      return {
        action,
        status: 'queued',
        reason: 'session_discard_queued',
        handoff: view,
        operation_id: snapshot.resolution_operation_id,
      };
    }

    // Do this before writing a lifecycle journal. A stale browser view must
    // not leave an inert prepared discard graph when the current runtime no
    // longer has a safe, bound source identity. The database claim remains
    // the authority for the narrow race after this read.
    if (action === 'discard' && !view.can_discard) {
      return this.blocked(
        action,
        snapshot.resolution_action === 'return' &&
          snapshot.resolution_state === 'running'
          ? 'return_recovery_quiescing'
          : 'source_runtime_identity_unavailable',
        view,
        snapshot.resolution_operation_id
      );
    }

    if (action === 'return') {
      const claim =
        await this.runtimeRepository.claimWhatsappProviderHandoffReturn({
          account_id: accountId,
          worker_id: workerId,
          handoff_id: handoffId,
          operation_id: snapshot.resolution_operation_id ?? uuidv7(),
        });
      if (claim.outcome === 'not_found') return null;
      if (
        !['claimed', 'idempotent'].includes(claim.outcome) ||
        !claim.operation_id
      ) {
        return this.blocked(
          action,
          this.reasonForClaim(action, claim),
          view,
          claim.operation_id
        );
      }
      if (claim.resolution_state !== 'completed') {
        await this.redriveReturnNow({
          accountId,
          handoffId,
          workerId,
        });
      }
      const refreshed =
        await this.runtimeRepository.viewWhatsappProviderHandoffDecision({
          account_id: accountId,
          worker_id: workerId,
          handoff_id: handoffId,
        });
      view = refreshed ? this.map(refreshed) : view;
      const completed = claim.resolution_state === 'completed';
      return {
        action,
        status: completed ? 'completed' : 'queued',
        reason: completed ? 'source_restored' : 'source_restore_queued',
        handoff: view,
        operation_id: claim.operation_id,
      };
    }

    const operationId = uuidv5(
      `whatsapp-provider-handoff-discard:${handoffId}`,
      HANDOFF_DISCARD_OPERATION_NAMESPACE
    );
    const { primary, cleanup } = this.buildDiscardMessages(
      snapshot,
      operationId
    );
    // Complete journal first. If the following database CAS commits and Kafka
    // is unavailable, the monitor can redrive the exact dependency graph.
    await this.lifecycleQueue.prepare(primary);
    await this.lifecycleQueue.prepare(cleanup);

    const claim =
      await this.runtimeRepository.claimWhatsappProviderHandoffDiscard({
        account_id: accountId,
        worker_id: workerId,
        handoff_id: handoffId,
        operation_id: operationId,
        expected_server_id: snapshot.worker_server_id ?? '',
      });
    if (claim.outcome === 'not_found') return null;
    if (
      !['claimed', 'idempotent'].includes(claim.outcome) ||
      !claim.operation_id
    ) {
      return this.blocked(
        action,
        this.reasonForClaim(action, claim),
        view,
        claim.operation_id
      );
    }
    if (claim.operation_id !== operationId) {
      return this.blocked(
        action,
        'resolution_operation_mismatch',
        view,
        claim.operation_id
      );
    }

    if (claim.resolution_state !== 'completed') {
      // Stop/delete the source before the target recreate is made available.
      // The primary also carries cleanup_previous_runtime_required, so a
      // consumer cannot activate it ahead of this dependency.
      await this.lifecycleQueue.publish(cleanup);
      await this.lifecycleQueue.publish(primary);
    }
    const refreshed =
      await this.runtimeRepository.viewWhatsappProviderHandoffDecision({
        account_id: accountId,
        worker_id: workerId,
        handoff_id: handoffId,
      });
    view = refreshed ? this.map(refreshed) : view;
    return {
      action,
      status: claim.resolution_state === 'completed' ? 'completed' : 'queued',
      reason:
        claim.resolution_state === 'completed'
          ? 'session_discard_completed'
          : 'session_discard_queued',
      handoff: view,
      operation_id: claim.operation_id,
    };
  }
}
