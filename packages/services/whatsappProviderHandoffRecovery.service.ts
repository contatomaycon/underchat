import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { inject, singleton } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';
import { currentTime } from '@core/common/functions/currentTime';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import type { IWorkerLifecycleQueueMessage } from '@core/common/interfaces/IWorkerLifecycleQueueMessage';
import type { IWhatsappProviderHandoffRecoveryCentrifugo } from '@core/common/interfaces/IWhatsappProviderHandoffRecoveryCentrifugo';
import { workerProviderHandoffRecoveryCentrifugoQueue } from '@core/common/functions/centrifugoQueue';
import type { ILockLeaseContext } from '@core/common/functions/withLock';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { WorkerLifecycleQueueService } from '@core/services/workerLifecycleQueue.service';
import { WorkerLifecycleLockService } from '@core/services/workerLifecycleLock.service';

type WhatsappProvider = 'baileys' | 'wwebjs' | 'whatsmeow';

interface RecoveryClaim {
  session_id: string;
  handoff_id: string;
  recovery_operation_id: string;
  recovery_attempt_count: number;
}

interface RecoveryHandoffRow extends RecoveryClaim {
  lifecycle_operation_id: string | null;
  source_provider: string;
  target_provider: string;
  source_revision_id: number | string;
  target_revision_id: number | string | null;
  state: string;
  recovery_state: string;
  recovery_cleanup_required: boolean | null;
  recovery_from_generation: number | null;
}

interface RecoveryWorkerRow {
  worker_id: string;
  account_id: string;
  server_id: string;
  worker_type_id: string;
  worker_status_id: string;
  session_storage: string | null;
  lifecycle_operation_id: string | null;
  container_id: string | null;
  deleted_at: Date | string | null;
}

interface RecoveryRuntimeRow {
  container_id: string | null;
  session_storage: string;
  runtime_generation: number;
  runtime_capability_hash: string | null;
  session_writer_epoch: string | null;
  source_provider: string | null;
  connection_activated_at: Date | string | null;
  native_connection_online_acknowledged: boolean | null;
  native_connection_status_source_id: string | null;
  native_connection_status_sequence: number | string | null;
  native_connection_status: Record<string, unknown> | null;
  native_connection_status_lease_owner_id: string | null;
  native_connection_status_fencing_token: number | string | null;
}

interface RecoverySessionRow {
  provider: string;
  state: string;
  active_revision_id: number | string | null;
  generation: number;
  epoch: string | null;
  capability_hash: string | null;
}

interface RecoverySourceRevisionRow {
  revision_id: number | string;
  provider: string;
  status: string;
  writer_generation: number | null;
  writer_epoch: string | null;
  capability_hash: string | null;
}

interface RecoveryLeaseRow {
  owner_id: string | null;
  provider: string | null;
  generation: number | null;
  epoch: string | null;
  fencing_token: number | string | null;
  expires_at: Date | string | null;
  database_now: Date | string;
}

interface RecoveryDispatch {
  sessionId: string;
  handoffId: string;
  operationId: string;
  accountId: string;
  serverId: string;
  sourceProvider: WhatsappProvider;
  targetProvider: WhatsappProvider;
  cleanupRequired: boolean;
  claimToken: string;
}

type PrepareRecoveryResult =
  | { outcome: 'dispatch'; dispatch: RecoveryDispatch }
  | {
      outcome: 'completed' | 'blocked' | 'cancelled';
      publication?: IWhatsappProviderHandoffRecoveryCentrifugo;
    }
  | { outcome: 'deferred' };

export interface WhatsappProviderHandoffRecoveryResult {
  claimed: number;
  dispatched: number;
  completed: number;
  deferred: number;
  blocked: number;
  cancelled: number;
  errors: number;
  skipped: boolean;
}

export interface WhatsappProviderHandoffRecoveryOptions {
  batchSize?: number;
  claimTtlMs?: number;
  retryDelayMs?: number;
  runningProbeMs?: number;
}

/**
 * A user-selected return must not wait for the periodic recovery job.  The
 * database row remains the source of truth; this input only narrows an
 * immediate, fenced redrive to that one handoff.
 */
export interface WhatsappProviderHandoffRecoveryRedriveInput {
  accountId: string;
  handoffId: string;
  workerId: string;
}

export type WhatsappProviderHandoffRecoveryRedriveOutcome =
  'dispatched' | 'completed' | 'deferred' | 'blocked' | 'cancelled' | 'error';

export interface WhatsappProviderHandoffRecoveryRedriveResult {
  outcome: WhatsappProviderHandoffRecoveryRedriveOutcome;
}

const PROVIDER_WORKER_TYPE: Record<WhatsappProvider, EWorkerType> = {
  baileys: EWorkerType.baileys,
  wwebjs: EWorkerType.wwebjs,
  whatsmeow: EWorkerType.whatsmeow,
};
const RECOVERABLE_STATES = new Set(['pending', 'dispatching', 'running']);
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_CLAIM_TTL_MS = 2 * 60_000;
const DEFAULT_RETRY_DELAY_MS = 15_000;
const DEFAULT_RUNNING_PROBE_MS = 30_000;
const MAX_RETRY_DELAY_MS = 15 * 60_000;
const MAX_ACTIVE_SOURCE_LEASE_RECOVERY_ATTEMPTS = 3;
const LOCK_TIMEOUT_MS = 2_000;
const STATEMENT_TIMEOUT_MS = 15_000;
const RECOVERY_LIFECYCLE_LOCK_OPERATION = 'whatsapp_provider_handoff_recovery';
const RECOVERY_LIFECYCLE_LOCK_TTL_MS = 30_000;
const RECOVERY_LIFECYCLE_LOCK_ACQUIRE_TIMEOUT_MS = 1;
const RECOVERY_LIFECYCLE_LOCK_RETRY_DELAY_MS = 1;
const RECOVERY_LIFECYCLE_LOCK_HEARTBEAT_MS = 10_000;

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(parsed)));
}

function isProvider(value: string): value is WhatsappProvider {
  return value === 'baileys' || value === 'wwebjs' || value === 'whatsmeow';
}

function numericRevisionId(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function safeErrorCode(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.name || error.message
      : typeof error === 'string'
        ? error
        : 'whatsapp_handoff_recovery_error';
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/gu, '_')
    .slice(0, 100);
}

/**
 * Reconciles the control-plane after a protocol-level provider rollback.
 *
 * The failed handoff row is the durable queue. A short database transaction
 * fences the old target lifecycle and CASes the worker back to the source
 * provider. Redis/Kafka work happens only after commit; an ambiguous publish
 * is retried with the same recovery operation and semantic journal payload.
 */
@singleton()
export class WhatsappProviderHandoffRecoveryService {
  private readonly batchSize: number;
  private readonly claimTtlMs: number;
  private readonly retryDelayMs: number;
  private readonly runningProbeMs: number;
  private running = false;

  constructor(
    @inject('DatabasePoolRw') private readonly pool: Pool,
    @inject(WorkerLifecycleQueueService)
    private readonly lifecycleQueue: WorkerLifecycleQueueService,
    @inject(WorkerLifecycleLockService)
    private readonly workerLifecycleLockService: WorkerLifecycleLockService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject('WhatsappProviderHandoffRecoveryOptions', { isOptional: true })
    options: WhatsappProviderHandoffRecoveryOptions = {}
  ) {
    this.batchSize = boundedInteger(
      options.batchSize,
      DEFAULT_BATCH_SIZE,
      1,
      100
    );
    this.claimTtlMs = boundedInteger(
      options.claimTtlMs,
      DEFAULT_CLAIM_TTL_MS,
      30_000,
      10 * 60_000
    );
    this.retryDelayMs = boundedInteger(
      options.retryDelayMs,
      DEFAULT_RETRY_DELAY_MS,
      1_000,
      5 * 60_000
    );
    this.runningProbeMs = boundedInteger(
      options.runningProbeMs,
      DEFAULT_RUNNING_PROBE_MS,
      5_000,
      5 * 60_000
    );
  }

  recoverOnce = async (): Promise<WhatsappProviderHandoffRecoveryResult> => {
    const result: WhatsappProviderHandoffRecoveryResult = {
      claimed: 0,
      dispatched: 0,
      completed: 0,
      deferred: 0,
      blocked: 0,
      cancelled: 0,
      errors: 0,
      skipped: false,
    };
    if (this.running) {
      result.skipped = true;
      return result;
    }

    this.running = true;
    const startedAt = Date.now();
    const claimToken = randomUUID();
    try {
      const claims = await this.claimBatch(claimToken);
      result.claimed = claims.length;
      this.debug('recovery.batch.claimed', { claimed: claims.length });

      for (const claim of claims) {
        const outcome = await this.recoverClaim(claim, claimToken);
        if (outcome === 'completed') result.completed += 1;
        if (outcome === 'blocked') result.blocked += 1;
        if (outcome === 'cancelled') result.cancelled += 1;
        if (outcome === 'deferred') result.deferred += 1;
        if (outcome === 'dispatched') result.dispatched += 1;
        if (outcome === 'error') result.errors += 1;
      }

      this.debug('recovery.batch.completed', {
        duration_ms: Date.now() - startedAt,
        ...result,
      });
      return result;
    } finally {
      this.running = false;
    }
  };

  /**
   * Runs the same durable recovery protocol as the cron job for one return
   * request.  It never performs an unfenced worker mutation: failure to claim
   * simply leaves the row for the normal periodic redrive.
   */
  async recoverHandoffNow(
    input: WhatsappProviderHandoffRecoveryRedriveInput
  ): Promise<WhatsappProviderHandoffRecoveryRedriveResult> {
    const claimToken = randomUUID();
    try {
      const [claim] = await this.claimBatch(claimToken, input);
      if (!claim) return { outcome: 'deferred' };
      return { outcome: await this.recoverClaim(claim, claimToken) };
    } catch (error) {
      this.debug('recovery.redrive.error', {
        session_id: input.workerId,
        handoff_id: input.handoffId,
        reason: safeErrorCode(error),
      });
      return { outcome: 'error' };
    }
  }

  private async recoverClaim(
    claim: RecoveryClaim,
    claimToken: string
  ): Promise<WhatsappProviderHandoffRecoveryRedriveOutcome> {
    try {
      /*
       * Acquire the exact same worker lifecycle mutex as the command handler.
       * A preceding isLocked() probe would be a TOCTOU: the handler could
       * acquire after the read and remove a healthy runtime when our recovery
       * clears its lifecycle. Keep the mutex only through the fenced database
       * decision and release it before Redis journal/Kafka publication.
       */
      let prepared: PrepareRecoveryResult;
      try {
        prepared = await this.workerLifecycleLockService.withLock(
          claim.session_id,
          RECOVERY_LIFECYCLE_LOCK_OPERATION,
          async (lockContext) => {
            lockContext.assertActive();
            const result = await this.prepareRecovery(
              claim,
              claimToken,
              lockContext
            );
            lockContext.assertActive();
            return result;
          },
          {
            ttlMs: RECOVERY_LIFECYCLE_LOCK_TTL_MS,
            acquireTimeoutMs: RECOVERY_LIFECYCLE_LOCK_ACQUIRE_TIMEOUT_MS,
            retryDelayMs: RECOVERY_LIFECYCLE_LOCK_RETRY_DELAY_MS,
            heartbeatIntervalMs: RECOVERY_LIFECYCLE_LOCK_HEARTBEAT_MS,
          }
        );
      } catch (error) {
        if (this.isLifecycleLockContention(error, claim.session_id)) {
          await this.releaseClaimForActiveLifecycle(
            claim,
            claimToken,
            'worker_lifecycle_lock_active'
          );
          return 'deferred';
        }
        throw error;
      }
      if (prepared.outcome !== 'dispatch') {
        if ('publication' in prepared && prepared.publication) {
          await this.publishTerminalRecovery(prepared.publication);
        }
        return prepared.outcome;
      }

      await this.dispatchRecovery(prepared.dispatch);
      return 'dispatched';
    } catch (error) {
      await this.deferClaim(claim, claimToken, safeErrorCode(error));
      this.debug('recovery.item.error', {
        session_id: claim.session_id,
        handoff_id: claim.handoff_id,
        lifecycle_operation_id: claim.recovery_operation_id,
        reason: safeErrorCode(error),
      });
      return 'error';
    }
  }

  private async claimBatch(
    claimToken: string,
    target?: WhatsappProviderHandoffRecoveryRedriveInput
  ): Promise<RecoveryClaim[]> {
    const targetPredicate = target
      ? `AND handoff.session_id = $4::uuid
         AND handoff.handoff_id = $5::uuid
         AND worker.account_id = $6::uuid`
      : '';
    const targetValues = target
      ? [target.workerId, target.handoffId, target.accountId]
      : [];
    const claimed = await this.pool.query<RecoveryClaim>(
      `WITH candidates AS MATERIALIZED (
         SELECT handoff.session_id, handoff.handoff_id
           FROM whatsapp_session_handoff AS handoff
           JOIN worker
             ON worker.worker_id = handoff.session_id
            AND worker.deleted_at IS NULL
           LEFT JOIN worker_runtime AS runtime
             ON runtime.worker_id = handoff.session_id
           LEFT JOIN whatsapp_session_lease AS lease
             ON lease.session_id = handoff.session_id
          WHERE handoff.state = 'failed'
            AND handoff.recovery_state IN ('pending', 'dispatching', 'running')
            AND handoff.recovery_operation_id IS NOT NULL
            AND handoff.recovery_next_attempt_at <= statement_timestamp()
            AND (
              handoff.recovery_claim_token IS NULL
              OR handoff.recovery_claim_expires_at <= statement_timestamp()
            )
            AND (
              lease.session_id IS NULL
              OR lease.owner_id IS NULL
              OR lease.expires_at <= statement_timestamp()
              -- A source lease can remain alive while a failed handoff asks
              -- that same source to rebuild its socket.  Rejecting it here
              -- creates a circular wait: the worker awaits a clean restart,
              -- while the manager awaits the worker's lease to disappear.
              -- The transaction below still permits takeover only after it
              -- proves the source session/revision/runtime fence.
              OR (
                lease.provider = handoff.source_provider
                AND worker.worker_type_id = CASE handoff.source_provider
                  WHEN 'baileys' THEN '${EWorkerType.baileys}'::uuid
                  WHEN 'wwebjs' THEN '${EWorkerType.wwebjs}'::uuid
                  WHEN 'whatsmeow' THEN '${EWorkerType.whatsmeow}'::uuid
                END
                AND runtime.session_storage = 'postgres'
                AND runtime.source_provider = handoff.source_provider
              )
            )
            ${targetPredicate}
          ORDER BY handoff.recovery_next_attempt_at,
                   handoff.session_id,
                   handoff.handoff_id
          LIMIT $1
          FOR UPDATE OF handoff SKIP LOCKED
       )
       UPDATE whatsapp_session_handoff AS handoff
          SET recovery_claim_token = $2::uuid,
              recovery_claim_expires_at = statement_timestamp()
                + ($3::double precision * interval '1 millisecond'),
              recovery_attempt_count = handoff.recovery_attempt_count + 1,
              recovery_state = CASE
                WHEN handoff.recovery_state = 'pending' THEN 'dispatching'
                ELSE handoff.recovery_state
              END,
              recovery_last_error_code = NULL,
              updated_at = statement_timestamp()
         FROM candidates
        WHERE handoff.session_id = candidates.session_id
          AND handoff.handoff_id = candidates.handoff_id
       RETURNING handoff.session_id,
                 handoff.handoff_id,
                 handoff.recovery_operation_id,
                 handoff.recovery_attempt_count`,
      [
        target ? 1 : this.batchSize,
        claimToken,
        this.claimTtlMs,
        ...targetValues,
      ]
    );
    return claimed.rows;
  }

  private async prepareRecovery(
    claim: RecoveryClaim,
    claimToken: string,
    lockContext: ILockLeaseContext
  ): Promise<PrepareRecoveryResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('lock_timeout', $1, true),
                set_config('statement_timeout', $2, true),
                set_config('app.whatsapp_session_id', $3, true)`,
        [`${LOCK_TIMEOUT_MS}ms`, `${STATEMENT_TIMEOUT_MS}ms`, claim.session_id]
      );

      // Keep the lifecycle lock order aligned with runtime activation and
      // canonical session mutations:
      // worker -> runtime -> lease -> session -> revision -> handoff.
      const worker = (
        await client.query<RecoveryWorkerRow>(
          `SELECT worker.worker_id,
                  worker.account_id,
                  worker.server_id,
                  worker.worker_type_id,
                  worker.worker_status_id,
                  worker.session_storage,
                  worker.lifecycle_operation_id,
                  worker.container_id,
                  worker.deleted_at
             FROM worker
            WHERE worker.worker_id = $1::uuid
            FOR UPDATE OF worker`,
          [claim.session_id]
        )
      ).rows[0];
      const runtime = (
        await client.query<RecoveryRuntimeRow>(
          `SELECT runtime.container_id,
                  runtime.session_storage,
                  runtime.runtime_generation,
                  runtime.runtime_capability_hash,
                  runtime.session_writer_epoch,
                  runtime.source_provider,
                  runtime.connection_activated_at,
                  runtime.native_connection_online_acknowledged,
                  runtime.native_connection_status_source_id,
                  runtime.native_connection_status_sequence,
                  runtime.native_connection_status,
                  runtime.native_connection_status_lease_owner_id,
                  runtime.native_connection_status_fencing_token
             FROM worker_runtime AS runtime
            WHERE runtime.worker_id = $1::uuid
            FOR UPDATE OF runtime`,
          [claim.session_id]
        )
      ).rows[0];
      const lease = (
        await client.query<RecoveryLeaseRow>(
          `SELECT lease.owner_id,
                  lease.provider,
                  lease.generation,
                  lease.epoch,
                  lease.fencing_token,
                  lease.expires_at,
                  statement_timestamp() AS database_now
             FROM whatsapp_session_lease AS lease
            WHERE lease.session_id = $1::uuid
            FOR UPDATE OF lease`,
          [claim.session_id]
        )
      ).rows[0];
      const session = (
        await client.query<RecoverySessionRow>(
          `SELECT session.provider,
                  session.state,
                  session.active_revision_id,
                  session.generation,
                  session.epoch,
                  session.capability_hash
             FROM whatsapp_session AS session
            WHERE session.session_id = $1::uuid
            FOR UPDATE OF session`,
          [claim.session_id]
        )
      ).rows[0];
      const sourceRevision = (
        await client.query<RecoverySourceRevisionRow>(
          `SELECT source_revision.revision_id,
                  source_revision.provider,
                  source_revision.status,
                  source_revision.writer_generation,
                  source_revision.writer_epoch,
                  source_revision.capability_hash
             FROM whatsapp_session_revision AS source_revision
             JOIN whatsapp_session_handoff AS source_handoff
               ON source_handoff.session_id = source_revision.session_id
              AND source_handoff.source_revision_id =
                  source_revision.revision_id
            WHERE source_handoff.session_id = $1::uuid
              AND source_handoff.handoff_id = $2::uuid
              AND source_handoff.recovery_claim_token = $3::uuid
            FOR UPDATE OF source_revision`,
          [claim.session_id, claim.handoff_id, claimToken]
        )
      ).rows[0];
      const handoff = (
        await client.query<RecoveryHandoffRow>(
          `SELECT handoff.session_id,
                  handoff.handoff_id,
                  handoff.lifecycle_operation_id,
                  handoff.source_provider,
                  handoff.target_provider,
                  handoff.source_revision_id,
                  handoff.target_revision_id,
                  handoff.state,
                  handoff.recovery_state,
                  handoff.recovery_operation_id,
                  handoff.recovery_cleanup_required,
                  handoff.recovery_from_generation,
                  handoff.recovery_attempt_count
             FROM whatsapp_session_handoff AS handoff
            WHERE handoff.session_id = $1::uuid
              AND handoff.handoff_id = $2::uuid
              AND handoff.recovery_claim_token = $3::uuid
            FOR UPDATE OF handoff`,
          [claim.session_id, claim.handoff_id, claimToken]
        )
      ).rows[0];
      lockContext.assertActive();

      if (!handoff || !RECOVERABLE_STATES.has(handoff.recovery_state)) {
        await client.query('ROLLBACK');
        return { outcome: 'deferred' };
      }

      if (!worker || worker.deleted_at) {
        await this.finishTerminal(
          client,
          claim,
          claimToken,
          'cancelled',
          'worker_deleted'
        );
        await this.commitRecoveryTransaction(client, lockContext);
        return this.terminalResult('cancelled', worker, handoff);
      }

      if (
        handoff.state !== 'failed' ||
        !handoff.lifecycle_operation_id ||
        handoff.recovery_operation_id !== claim.recovery_operation_id ||
        handoff.recovery_operation_id === handoff.lifecycle_operation_id ||
        !isProvider(handoff.source_provider) ||
        !isProvider(handoff.target_provider) ||
        handoff.source_provider === handoff.target_provider ||
        numericRevisionId(handoff.target_revision_id) === null ||
        numericRevisionId(handoff.target_revision_id) ===
          numericRevisionId(handoff.source_revision_id) ||
        worker.session_storage !== EWorkerSessionStorage.postgres ||
        !session ||
        !sourceRevision ||
        session.provider !== handoff.source_provider ||
        session.state !== 'ready' ||
        numericRevisionId(session.active_revision_id) !==
          numericRevisionId(handoff.source_revision_id) ||
        numericRevisionId(sourceRevision.revision_id) !==
          numericRevisionId(handoff.source_revision_id) ||
        sourceRevision.provider !== handoff.source_provider ||
        sourceRevision.status !== 'active' ||
        sourceRevision.writer_generation !== session.generation ||
        !session.epoch ||
        sourceRevision.writer_epoch !== session.epoch ||
        !session.capability_hash ||
        sourceRevision.capability_hash !== session.capability_hash
      ) {
        await this.finishTerminal(
          client,
          claim,
          claimToken,
          'blocked',
          worker.session_storage !== EWorkerSessionStorage.postgres
            ? 'legacy_volume_recovery_forbidden'
            : 'source_session_not_restored'
        );
        await this.commitRecoveryTransaction(client, lockContext);
        return this.terminalResult('blocked', worker, handoff);
      }

      const sourceProvider = handoff.source_provider;
      const targetProvider = handoff.target_provider;
      const sourceWorkerType = PROVIDER_WORKER_TYPE[sourceProvider];
      const targetWorkerType = PROVIDER_WORKER_TYPE[targetProvider];

      if (
        this.sourceRuntimeIsHealthy({
          worker,
          runtime,
          session,
          sourceRevision,
          lease,
          sourceProvider,
          sourceWorkerType,
          fromGeneration: handoff.recovery_from_generation,
          recoveryOperationId: handoff.recovery_operation_id,
        })
      ) {
        if (worker.lifecycle_operation_id === handoff.recovery_operation_id) {
          lockContext.assertActive();
          await this.finishHealthyRecoveryWithAttachedLifecycle({
            client,
            claim,
            claimToken,
            worker,
            runtime: runtime as RecoveryRuntimeRow,
            handoff,
            sourceWorkerType,
            lockContext,
          });
        } else {
          await this.finishTerminal(
            client,
            claim,
            claimToken,
            'completed',
            null
          );
        }
        await this.commitRecoveryTransaction(client, lockContext);
        this.debug('recovery.source.healthy', {
          session_id: claim.session_id,
          handoff_id: claim.handoff_id,
          provider: sourceProvider,
          lifecycle_operation_id: claim.recovery_operation_id,
          runtime_generation: runtime?.runtime_generation,
        });
        return this.terminalResult('completed', worker, handoff);
      }

      const canTakeOverStaleSourceRuntime = this.canTakeOverStaleSourceRuntime({
        worker,
        runtime,
        session,
        lease,
        sourceProvider,
        sourceWorkerType,
        handoffLifecycleOperationId: handoff.lifecycle_operation_id,
        recoveryOperationId: handoff.recovery_operation_id,
        recoveryFromGeneration: handoff.recovery_from_generation,
      });
      if (this.leaseIsActive(lease) && canTakeOverStaleSourceRuntime) {
        // Fence the old source writer before the recovery journal can make a
        // new source runtime visible.  The worker command subsequently stops
        // the exact runtime and reserves the next generation; an old socket
        // cannot renew or write after this transaction commits.
        await this.fenceActiveSourceLease(client, claim, lease, sourceProvider);
      } else if (this.leaseIsActive(lease)) {
        if (
          this.shouldBlockStalledActiveSourceLease({
            claim,
            worker,
            runtime,
            session,
            lease,
            sourceProvider,
            sourceWorkerType,
            handoffLifecycleOperationId: handoff.lifecycle_operation_id,
            recoveryOperationId: handoff.recovery_operation_id,
            recoveryFromGeneration: handoff.recovery_from_generation,
          })
        ) {
          await this.finishTerminal(
            client,
            claim,
            claimToken,
            'blocked',
            'source_pq_recovery_failed'
          );
          await this.commitRecoveryTransaction(client, lockContext);
          return this.terminalResult('blocked', worker, handoff);
        }
        await this.releaseClaimAfter(
          client,
          claim,
          claimToken,
          this.retryDelayMs,
          'lease_still_active'
        );
        await this.commitRecoveryTransaction(client, lockContext);
        return { outcome: 'deferred' };
      }

      const currentLifecycle = worker.lifecycle_operation_id;
      const recoveryLifecycle = handoff.recovery_operation_id;
      const recoveryAlreadyOwnsWorker =
        worker.worker_type_id === sourceWorkerType &&
        currentLifecycle === recoveryLifecycle &&
        worker.worker_status_id === EWorkerStatus.recreating;

      let cleanupRequired = handoff.recovery_cleanup_required;
      let fromGeneration = handoff.recovery_from_generation;
      if (!recoveryAlreadyOwnsWorker) {
        // Once a recovery command has been journaled its semantic payload is
        // immutable. If that lifecycle finalized without reaching strict
        // source health, keep probing instead of reusing the operation UUID
        // with a different cleanup dependency.
        if (
          handoff.recovery_cleanup_required !== null &&
          worker.worker_type_id === sourceWorkerType &&
          currentLifecycle === null
        ) {
          await this.releaseClaimAfter(
            client,
            claim,
            claimToken,
            this.runningProbeMs,
            'source_runtime_not_healthy'
          );
          await this.commitRecoveryTransaction(client, lockContext);
          return { outcome: 'deferred' };
        }

        const lifecycleCanBeTaken =
          currentLifecycle === handoff.lifecycle_operation_id ||
          currentLifecycle === null ||
          canTakeOverStaleSourceRuntime;
        const workerTypeCanBeRecovered =
          worker.worker_type_id === targetWorkerType ||
          worker.worker_type_id === sourceWorkerType;
        const terminalStatus =
          worker.worker_status_id === EWorkerStatus.deleting ||
          worker.worker_status_id === EWorkerStatus.delete ||
          worker.worker_status_id === EWorkerStatus.blocked ||
          worker.worker_status_id === EWorkerStatus.stopped;

        if (terminalStatus) {
          await this.finishTerminal(
            client,
            claim,
            claimToken,
            'cancelled',
            'worker_terminal_status'
          );
          await this.commitRecoveryTransaction(client, lockContext);
          return this.terminalResult('cancelled', worker, handoff);
        }
        if (!lifecycleCanBeTaken || !workerTypeCanBeRecovered) {
          await this.releaseClaimAfter(
            client,
            claim,
            claimToken,
            this.runningProbeMs,
            'worker_lifecycle_conflict'
          );
          await this.commitRecoveryTransaction(client, lockContext);
          return { outcome: 'deferred' };
        }

        cleanupRequired =
          worker.worker_type_id === targetWorkerType ||
          runtime?.source_provider === targetProvider;
        fromGeneration = Math.max(
          runtime?.runtime_generation ?? 0,
          session.generation
        );
        if (!Number.isSafeInteger(fromGeneration) || fromGeneration <= 0) {
          await this.finishTerminal(
            client,
            claim,
            claimToken,
            'blocked',
            'runtime_generation_invalid'
          );
          await this.commitRecoveryTransaction(client, lockContext);
          return this.terminalResult('blocked', worker, handoff);
        }

        const changed = await client.query(
          `UPDATE worker
              SET worker_type_id = $2::uuid,
                  worker_status_id = $3::uuid,
                  lifecycle_operation_id = $4::uuid,
                  connection_date = NULL,
                  updated_at = statement_timestamp()
            WHERE worker_id = $1::uuid
              AND account_id = $5::uuid
              AND server_id = $6::uuid
              AND session_storage = 'postgres'
              AND deleted_at IS NULL
              AND worker_type_id = $7::uuid
              AND lifecycle_operation_id IS NOT DISTINCT FROM $8::uuid`,
          [
            claim.session_id,
            sourceWorkerType,
            EWorkerStatus.recreating,
            recoveryLifecycle,
            worker.account_id,
            worker.server_id,
            worker.worker_type_id,
            currentLifecycle,
          ]
        );
        if ((changed.rowCount ?? 0) !== 1) {
          throw new Error('whatsapp_handoff_recovery_worker_cas_changed');
        }
      }

      const scheduled = await client.query(
        `UPDATE whatsapp_session_handoff
            SET recovery_state = 'dispatching',
                recovery_cleanup_required = $4,
                recovery_from_generation = $5,
                recovery_started_at = COALESCE(
                  recovery_started_at,
                  statement_timestamp()
                ),
                recovery_next_attempt_at = statement_timestamp()
                  + ($6::double precision * interval '1 millisecond'),
                recovery_last_error_code = NULL,
                updated_at = statement_timestamp()
          WHERE session_id = $1::uuid
            AND handoff_id = $2::uuid
            AND recovery_claim_token = $3::uuid
            AND recovery_operation_id = $7::uuid
            AND recovery_state IN ('pending', 'dispatching', 'running')`,
        [
          claim.session_id,
          claim.handoff_id,
          claimToken,
          cleanupRequired,
          fromGeneration,
          this.runningProbeMs,
          recoveryLifecycle,
        ]
      );
      if ((scheduled.rowCount ?? 0) !== 1) {
        throw new Error('whatsapp_handoff_recovery_claim_changed');
      }

      await this.commitRecoveryTransaction(client, lockContext);
      return {
        outcome: 'dispatch',
        dispatch: {
          sessionId: claim.session_id,
          handoffId: claim.handoff_id,
          operationId: recoveryLifecycle,
          accountId: worker.account_id,
          serverId: worker.server_id,
          sourceProvider,
          targetProvider,
          cleanupRequired: cleanupRequired === true,
          claimToken,
        },
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async dispatchRecovery(input: RecoveryDispatch): Promise<void> {
    const now = currentTime();
    const sourceWorkerType = PROVIDER_WORKER_TYPE[input.sourceProvider];
    const targetWorkerType = PROVIDER_WORKER_TYPE[input.targetProvider];
    const previousWorkerType = input.cleanupRequired
      ? targetWorkerType
      : sourceWorkerType;
    const base = {
      operation_id: input.operationId,
      worker_id: input.sessionId,
      account_id: input.accountId,
      session_storage: EWorkerSessionStorage.postgres,
      worker_status_id: EWorkerStatus.recreating,
      source: 'worker_update' as const,
      remove_session: false,
      remove_volume: false,
      previous_server_id: input.serverId,
      previous_worker_type_id: previousWorkerType,
      previous_worker_status_id: EWorkerStatus.online,
      requested_at: now,
      debug_trace_id: `whatsapp_handoff_recovery_${input.handoffId}`,
    };
    const primary: IWorkerLifecycleQueueMessage = {
      ...base,
      request_id: uuidv7(),
      action: 'recreate',
      server_id: input.serverId,
      worker_type_id: sourceWorkerType,
      cleanup_previous_runtime_required: input.cleanupRequired,
    };
    const cleanup: IWorkerLifecycleQueueMessage | null = input.cleanupRequired
      ? {
          ...base,
          request_id: uuidv7(),
          action: 'cleanup_previous_runtime',
          server_id: input.serverId,
          worker_type_id: targetWorkerType,
        }
      : null;

    // Persist the complete dependency graph before publishing either record.
    await this.lifecycleQueue.prepare(primary);
    if (cleanup) await this.lifecycleQueue.prepare(cleanup);
    if (cleanup) await this.lifecycleQueue.publish(cleanup);
    await this.lifecycleQueue.publish(primary);

    const marked = await this.pool.query(
      `UPDATE whatsapp_session_handoff
          SET recovery_state = 'running',
              recovery_claim_token = NULL,
              recovery_claim_expires_at = NULL,
              recovery_next_attempt_at = statement_timestamp()
                + ($5::double precision * interval '1 millisecond'),
              recovery_last_error_code = NULL,
              updated_at = statement_timestamp()
        WHERE session_id = $1::uuid
          AND handoff_id = $2::uuid
          AND recovery_operation_id = $3::uuid
          AND recovery_claim_token = $4::uuid
          AND recovery_state = 'dispatching'`,
      [
        input.sessionId,
        input.handoffId,
        input.operationId,
        input.claimToken,
        this.runningProbeMs,
      ]
    );
    if ((marked.rowCount ?? 0) !== 1) {
      throw new Error('whatsapp_handoff_recovery_dispatch_ack_changed');
    }

    this.debug('recovery.lifecycle.dispatched', {
      session_id: input.sessionId,
      handoff_id: input.handoffId,
      provider: input.sourceProvider,
      previous_provider: input.targetProvider,
      lifecycle_operation_id: input.operationId,
      cleanup_required: input.cleanupRequired,
    });
  }

  private sourceRuntimeIsHealthy(input: {
    worker: RecoveryWorkerRow;
    runtime: RecoveryRuntimeRow | undefined;
    session: RecoverySessionRow;
    sourceRevision: RecoverySourceRevisionRow;
    lease: RecoveryLeaseRow | undefined;
    sourceProvider: WhatsappProvider;
    sourceWorkerType: EWorkerType;
    fromGeneration: number | null;
    recoveryOperationId: string;
  }): boolean {
    const { worker, runtime, session, sourceRevision, lease } = input;
    const leaseExpiresAt = new Date(lease?.expires_at ?? '').getTime();
    const databaseNow = new Date(lease?.database_now ?? '').getTime();
    const nativeStatus = runtime?.native_connection_status;
    const nativeStatusSequence = Number(
      runtime?.native_connection_status_sequence
    );
    return Boolean(
      input.fromGeneration &&
      runtime &&
      worker.worker_type_id === input.sourceWorkerType &&
      worker.worker_status_id === EWorkerStatus.online &&
      (worker.lifecycle_operation_id === null ||
        worker.lifecycle_operation_id === input.recoveryOperationId) &&
      worker.container_id &&
      runtime.container_id === worker.container_id &&
      runtime.session_storage === EWorkerSessionStorage.postgres &&
      runtime.source_provider === input.sourceProvider &&
      runtime.connection_activated_at &&
      runtime.native_connection_online_acknowledged === true &&
      runtime.native_connection_status_source_id !== null &&
      Number.isSafeInteger(nativeStatusSequence) &&
      nativeStatusSequence > 0 &&
      nativeStatusSequence <= Number.MAX_SAFE_INTEGER &&
      nativeStatus?.provider === input.sourceProvider &&
      nativeStatus.status === 'online' &&
      nativeStatus.connected === true &&
      nativeStatus.authenticated === true &&
      nativeStatus.sessionValid === true &&
      nativeStatus.qrAvailable === false &&
      runtime.runtime_generation > input.fromGeneration &&
      session.provider === input.sourceProvider &&
      session.state === 'ready' &&
      session.generation === runtime.runtime_generation &&
      session.epoch !== null &&
      session.epoch === runtime.session_writer_epoch &&
      session.capability_hash !== null &&
      session.capability_hash === runtime.runtime_capability_hash &&
      numericRevisionId(sourceRevision.revision_id) ===
        numericRevisionId(session.active_revision_id) &&
      sourceRevision.provider === input.sourceProvider &&
      sourceRevision.status === 'active' &&
      sourceRevision.writer_generation === session.generation &&
      sourceRevision.writer_epoch !== null &&
      sourceRevision.writer_epoch === session.epoch &&
      sourceRevision.capability_hash !== null &&
      sourceRevision.capability_hash === session.capability_hash &&
      lease?.provider === input.sourceProvider &&
      lease.generation === runtime.runtime_generation &&
      lease.epoch !== null &&
      lease.epoch === runtime.session_writer_epoch &&
      lease.owner_id !== null &&
      runtime.native_connection_status_lease_owner_id === lease.owner_id &&
      Number(lease.fencing_token) > 0 &&
      runtime.native_connection_status_fencing_token === lease.fencing_token &&
      Number.isFinite(leaseExpiresAt) &&
      Number.isFinite(databaseNow) &&
      leaseExpiresAt > databaseNow + 5_000
    );
  }

  /**
   * A native online event can commit after the worker command materialized the
   * replacement but before its gRPC response reached the lifecycle consumer.
   * Finalize that ambiguous success in one database statement: either both
   * the exact worker lifecycle and its claimed recovery row advance, or
   * neither does. The worker/runtime/lease/session/source-revision/handoff
   * rows are already locked and sourceRuntimeIsHealthy has checked their full
   * generation, epoch, capability, ACK, lease and no-QR identity.
   *
   * The Redis journal is intentionally not deleted here. Its monitor only
   * redrives the operation currently named by worker.lifecycle_operation_id;
   * after this CAS, any Kafka copy already in flight is classified as stale
   * and committed without dispatching runtime work, while the bounded journal
   * remains available for audit until its normal TTL expires.
   */
  private async finishHealthyRecoveryWithAttachedLifecycle(input: {
    client: PoolClient;
    claim: RecoveryClaim;
    claimToken: string;
    worker: RecoveryWorkerRow;
    runtime: RecoveryRuntimeRow;
    handoff: RecoveryHandoffRow;
    sourceWorkerType: EWorkerType;
    lockContext: ILockLeaseContext;
  }): Promise<void> {
    input.lockContext.assertActive();
    const finalized = await input.client.query(
      `WITH finalized_worker AS (
         UPDATE worker
            SET lifecycle_operation_id = NULL,
                updated_at = statement_timestamp()
          WHERE worker_id = $1::uuid
            AND account_id = $4::uuid
            AND server_id = $5::uuid
            AND worker_type_id = $6::uuid
            AND worker_status_id = $7::uuid
            AND session_storage = 'postgres'
            AND lifecycle_operation_id = $8::uuid
            AND container_id = $9
            AND deleted_at IS NULL
          RETURNING worker_id
       )
       UPDATE whatsapp_session_handoff AS handoff
          SET recovery_state = 'completed',
              recovery_claim_token = NULL,
              recovery_claim_expires_at = NULL,
              recovery_next_attempt_at = statement_timestamp(),
              recovery_last_error_code = NULL,
              recovery_completed_at = statement_timestamp(),
              updated_at = statement_timestamp()
         FROM finalized_worker
        WHERE handoff.session_id = finalized_worker.worker_id
          AND handoff.session_id = $1::uuid
          AND handoff.handoff_id = $2::uuid
          AND handoff.recovery_claim_token = $3::uuid
          AND handoff.recovery_operation_id = $8::uuid
          AND handoff.state = 'failed'
          AND handoff.recovery_state IN ('pending', 'dispatching', 'running')
          AND handoff.source_provider = $10
          AND handoff.source_revision_id = $11::bigint
          AND handoff.recovery_from_generation = $12::integer
          AND handoff.recovery_cleanup_required IS NOT NULL`,
      [
        input.claim.session_id,
        input.claim.handoff_id,
        input.claimToken,
        input.worker.account_id,
        input.worker.server_id,
        input.sourceWorkerType,
        EWorkerStatus.online,
        input.claim.recovery_operation_id,
        input.runtime.container_id,
        input.handoff.source_provider,
        input.handoff.source_revision_id,
        input.handoff.recovery_from_generation,
      ]
    );
    if ((finalized.rowCount ?? 0) !== 1) {
      throw new Error(
        'whatsapp_handoff_recovery_healthy_lifecycle_cas_changed'
      );
    }
  }

  private async commitRecoveryTransaction(
    client: PoolClient,
    lockContext: ILockLeaseContext
  ): Promise<void> {
    lockContext.assertActive();
    await client.query('COMMIT');
  }

  private terminalResult(
    state: 'completed' | 'blocked' | 'cancelled',
    worker: RecoveryWorkerRow | undefined,
    handoff: RecoveryHandoffRow
  ): PrepareRecoveryResult {
    if (
      !worker ||
      !handoff.lifecycle_operation_id ||
      handoff.recovery_operation_id === handoff.lifecycle_operation_id ||
      !isProvider(handoff.source_provider) ||
      !isProvider(handoff.target_provider) ||
      handoff.source_provider === handoff.target_provider
    ) {
      return { outcome: state };
    }

    return {
      outcome: state,
      publication: {
        event_type: 'whatsapp_provider_handoff_recovery_terminal',
        account_id: worker.account_id,
        worker_id: worker.worker_id,
        handoff_id: handoff.handoff_id,
        handoff_lifecycle_operation_id: handoff.lifecycle_operation_id,
        recovery_operation_id: handoff.recovery_operation_id,
        recovery_state: state,
        source_provider: handoff.source_provider,
        target_provider: handoff.target_provider,
      },
    };
  }

  /**
   * The database transition is already committed and the lifecycle mutex has
   * been released when this runs. Centrifugo is therefore a read-side wakeup,
   * never part of the recovery transaction or its correctness boundary.
   */
  private async publishTerminalRecovery(
    publication: IWhatsappProviderHandoffRecoveryCentrifugo
  ): Promise<void> {
    try {
      // This path uses Centrifugo's bounded retry and history-enabled direct
      // publish. Its deterministic payload also produces a stable transport
      // idempotency key across ambiguous attempts.
      await this.centrifugoService.publishSubImmediate(
        workerProviderHandoffRecoveryCentrifugoQueue(publication.account_id),
        publication
      );
      this.debug('recovery.terminal.published', {
        session_id: publication.worker_id,
        handoff_id: publication.handoff_id,
        lifecycle_operation_id: publication.handoff_lifecycle_operation_id,
        recovery_operation_id: publication.recovery_operation_id,
        recovery_state: publication.recovery_state,
      });
    } catch (error) {
      // Recovery is durable and must not be regressed after COMMIT because a
      // best-effort projection wakeup failed. Reconnect history plus the
      // authoritative subscription reconciliation remains the fallback.
      this.debug('recovery.terminal.publish_failed', {
        session_id: publication.worker_id,
        handoff_id: publication.handoff_id,
        lifecycle_operation_id: publication.handoff_lifecycle_operation_id,
        recovery_operation_id: publication.recovery_operation_id,
        recovery_state: publication.recovery_state,
        reason: safeErrorCode(error),
      });
    }
  }

  /**
   * A failed source can hold its own lease while it waits for a fresh socket
   * after a provider rollback.  We may replace it only when the control-plane
   * pointer is already stale and every durable identity still names the
   * preserved source.  This is intentionally narrower than a generic
   * lifecycle takeover: it cannot target a live target provider, an online
   * source, a legacy volume, or a changed session revision.
   */
  private canTakeOverStaleSourceRuntime(input: {
    worker: RecoveryWorkerRow;
    runtime: RecoveryRuntimeRow | undefined;
    session: RecoverySessionRow;
    lease: RecoveryLeaseRow | undefined;
    sourceProvider: WhatsappProvider;
    sourceWorkerType: EWorkerType;
    handoffLifecycleOperationId: string;
    recoveryOperationId: string;
    recoveryFromGeneration: number | null;
  }): boolean {
    const {
      worker,
      runtime,
      session,
      lease,
      sourceProvider,
      sourceWorkerType,
      handoffLifecycleOperationId,
      recoveryOperationId,
      recoveryFromGeneration,
    } = input;
    const workerContainerId = worker.container_id?.trim();
    const runtimeContainerId = runtime?.container_id?.trim();
    return Boolean(
      this.leaseIsActive(lease) &&
      lease?.provider === sourceProvider &&
      worker.worker_type_id === sourceWorkerType &&
      worker.worker_status_id === EWorkerStatus.recreating &&
      worker.lifecycle_operation_id === handoffLifecycleOperationId &&
      worker.lifecycle_operation_id !== recoveryOperationId &&
      (recoveryFromGeneration === null ||
        (runtime !== undefined &&
          runtime.runtime_generation <= recoveryFromGeneration)) &&
      workerContainerId &&
      runtimeContainerId &&
      workerContainerId !== runtimeContainerId &&
      runtime?.session_storage === EWorkerSessionStorage.postgres &&
      runtime.source_provider === sourceProvider &&
      runtime.connection_activated_at &&
      session.provider === sourceProvider &&
      session.state === 'ready' &&
      session.active_revision_id !== null &&
      session.generation === runtime.runtime_generation &&
      session.epoch !== null &&
      session.epoch === runtime.session_writer_epoch &&
      session.capability_hash !== null &&
      session.capability_hash === runtime.runtime_capability_hash &&
      lease?.generation === runtime.runtime_generation &&
      lease.epoch !== null &&
      lease.epoch === runtime.session_writer_epoch &&
      Number(lease.fencing_token) > 0
    );
  }

  /**
   * This is a compare-and-fence, not a best-effort lease release.  The
   * transaction already locks the row, while the predicates make the durable
   * handoff proof explicit and protect against a future lock-order change.
   */
  private async fenceActiveSourceLease(
    client: PoolClient,
    claim: RecoveryClaim,
    lease: RecoveryLeaseRow,
    sourceProvider: WhatsappProvider
  ): Promise<void> {
    if (
      !lease.owner_id ||
      !lease.epoch ||
      !lease.generation ||
      !lease.fencing_token ||
      !lease.expires_at
    ) {
      throw new Error(
        'whatsapp_handoff_recovery_source_lease_identity_missing'
      );
    }
    const fenced = await client.query(
      `UPDATE whatsapp_session_lease
          SET owner_id = NULL,
              provider = NULL,
              fencing_token = fencing_token + 1,
              epoch = NULL,
              acquired_at = NULL,
              heartbeat_at = NULL,
              expires_at = NULL
        WHERE session_id = $1::uuid
          AND owner_id = $2::uuid
          AND provider = $3
          AND generation = $4::integer
          AND epoch = $5::uuid
          AND fencing_token = $6::bigint
          AND expires_at > statement_timestamp()`,
      [
        claim.session_id,
        lease.owner_id,
        sourceProvider,
        lease.generation,
        lease.epoch,
        lease.fencing_token,
      ]
    );
    if ((fenced.rowCount ?? 0) !== 1) {
      throw new Error('whatsapp_handoff_recovery_source_lease_fence_changed');
    }
  }

  private shouldBlockStalledActiveSourceLease(input: {
    claim: RecoveryClaim;
    worker: RecoveryWorkerRow;
    runtime: RecoveryRuntimeRow | undefined;
    session: RecoverySessionRow;
    lease: RecoveryLeaseRow | undefined;
    sourceProvider: WhatsappProvider;
    sourceWorkerType: EWorkerType;
    handoffLifecycleOperationId: string;
    recoveryOperationId: string;
    recoveryFromGeneration: number | null;
  }): boolean {
    const {
      claim,
      worker,
      runtime,
      session,
      lease,
      sourceProvider,
      sourceWorkerType,
      handoffLifecycleOperationId,
      recoveryOperationId,
      recoveryFromGeneration,
    } = input;
    return Boolean(
      claim.recovery_attempt_count >=
        MAX_ACTIVE_SOURCE_LEASE_RECOVERY_ATTEMPTS &&
      lease?.provider === sourceProvider &&
      worker.worker_type_id === sourceWorkerType &&
      worker.worker_status_id === EWorkerStatus.recreating &&
      worker.lifecycle_operation_id === handoffLifecycleOperationId &&
      worker.lifecycle_operation_id !== recoveryOperationId &&
      (recoveryFromGeneration === null ||
        (runtime !== undefined &&
          runtime.runtime_generation <= recoveryFromGeneration)) &&
      session.provider === sourceProvider &&
      session.state === 'ready' &&
      session.active_revision_id !== null
    );
  }

  private leaseIsActive(lease: RecoveryLeaseRow | undefined): boolean {
    if (!lease?.owner_id || !lease.expires_at) return false;
    return (
      new Date(lease.expires_at).getTime() >
      new Date(lease.database_now).getTime()
    );
  }

  private async finishTerminal(
    client: PoolClient,
    claim: RecoveryClaim,
    claimToken: string,
    state: 'completed' | 'blocked' | 'cancelled',
    errorCode: string | null
  ): Promise<void> {
    const updated = await client.query(
      `UPDATE whatsapp_session_handoff
          -- Keep parameter $4 explicitly varchar. PostgreSQL otherwise
          -- infers it as varchar from the assignment and text from the CASE
          -- comparison below, which aborts a healthy recovery at its terminal
          -- transition with "inconsistent types deduced for parameter $4".
          SET recovery_state = $4::varchar,
              recovery_claim_token = NULL,
              recovery_claim_expires_at = NULL,
              recovery_next_attempt_at = statement_timestamp(),
              recovery_last_error_code = $5,
              recovery_completed_at = CASE
                WHEN $4::varchar = 'completed'::varchar THEN statement_timestamp()
                ELSE NULL
              END,
              updated_at = statement_timestamp()
        WHERE session_id = $1::uuid
          AND handoff_id = $2::uuid
          AND recovery_claim_token = $3::uuid
          AND recovery_operation_id = $6::uuid`,
      [
        claim.session_id,
        claim.handoff_id,
        claimToken,
        state,
        errorCode,
        claim.recovery_operation_id,
      ]
    );
    if ((updated.rowCount ?? 0) !== 1) {
      throw new Error('whatsapp_handoff_recovery_terminal_cas_changed');
    }
  }

  private async releaseClaimAfter(
    client: PoolClient,
    claim: RecoveryClaim,
    claimToken: string,
    delayMs: number,
    errorCode: string
  ): Promise<void> {
    const released = await client.query(
      `UPDATE whatsapp_session_handoff
          SET recovery_claim_token = NULL,
              recovery_claim_expires_at = NULL,
              recovery_next_attempt_at = statement_timestamp()
                + ($4::double precision * interval '1 millisecond'),
              recovery_last_error_code = $5,
              updated_at = statement_timestamp()
        WHERE session_id = $1::uuid
          AND handoff_id = $2::uuid
          AND recovery_claim_token = $3::uuid`,
      [claim.session_id, claim.handoff_id, claimToken, delayMs, errorCode]
    );
    if ((released.rowCount ?? 0) !== 1) {
      throw new Error('whatsapp_handoff_recovery_defer_cas_changed');
    }
  }

  private async releaseClaimForActiveLifecycle(
    claim: RecoveryClaim,
    claimToken: string,
    errorCode: string
  ): Promise<void> {
    const released = await this.pool.query(
      `UPDATE whatsapp_session_handoff
          SET recovery_claim_token = NULL,
              recovery_claim_expires_at = NULL,
              recovery_next_attempt_at = statement_timestamp()
                + ($4::double precision * interval '1 millisecond'),
              recovery_last_error_code = $5,
              updated_at = statement_timestamp()
        WHERE session_id = $1::uuid
          AND handoff_id = $2::uuid
          AND recovery_claim_token = $3::uuid
          AND recovery_operation_id = $6::uuid
          AND recovery_state IN ('pending', 'dispatching', 'running')`,
      [
        claim.session_id,
        claim.handoff_id,
        claimToken,
        this.runningProbeMs,
        errorCode,
        claim.recovery_operation_id,
      ]
    );
    if ((released.rowCount ?? 0) !== 1) {
      throw new Error('whatsapp_handoff_recovery_lock_defer_cas_changed');
    }
  }

  private isLifecycleLockContention(error: unknown, workerId: string): boolean {
    return (
      error instanceof Error &&
      error.message ===
        `Worker lifecycle lock timeout for ${workerId} (${RECOVERY_LIFECYCLE_LOCK_OPERATION})`
    );
  }

  private async deferClaim(
    claim: RecoveryClaim,
    claimToken: string,
    errorCode: string
  ): Promise<void> {
    const exponent = Math.min(Math.max(claim.recovery_attempt_count - 1, 0), 6);
    const delayMs = Math.min(
      MAX_RETRY_DELAY_MS,
      this.retryDelayMs * 2 ** exponent
    );
    await this.pool.query(
      `UPDATE whatsapp_session_handoff
          SET recovery_state = 'pending',
              recovery_claim_token = NULL,
              recovery_claim_expires_at = NULL,
              recovery_next_attempt_at = statement_timestamp()
                + ($4::double precision * interval '1 millisecond'),
              recovery_last_error_code = $5,
              updated_at = statement_timestamp()
        WHERE session_id = $1::uuid
          AND handoff_id = $2::uuid
          AND recovery_claim_token = $3::uuid
          AND recovery_state IN ('pending', 'dispatching', 'running')`,
      [claim.session_id, claim.handoff_id, claimToken, delayMs, errorCode]
    );
  }

  private debug(event: string, fields: Record<string, unknown>): void {
    if (process.env.WHATSAPP_SESSION_DEBUG_ENABLED === 'false') return;
    console.log(
      '[whatsapp-session-debug]',
      JSON.stringify({
        event: `manager.handoff.${event}`,
        provider: 'manager',
        timestamp: new Date().toISOString(),
        ...fields,
      })
    );
  }
}
