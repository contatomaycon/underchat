import { randomUUID } from 'node:crypto';
import { inject, singleton } from 'tsyringe';
import type Redis from 'ioredis';
import type { Pool, PoolClient } from 'pg';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { EWhatsappConnectionStatus } from '@core/common/enums/EWhatsappConnectionStatus';
import {
  channelsConfigCentrifugo,
  workerCentrifugoQueue,
} from '@core/common/functions/centrifugoQueue';
import { workerErrorFailureReason } from '@core/common/functions/workerErrorDiagnostics';
import { isWhatsappQrCredentialConsumedState } from '@core/common/functions/isWhatsappQrCredentialConsumedState';
import { isWhatsappQrAttemptExhaustedState } from '@core/common/functions/isWhatsappQrAttemptExhaustedState';
import { projectWorkerRecreatePhaseProjection } from '@core/common/functions/workerRecreatePhase';
import { normalizeWhatsappConnectionStatusObservedAt } from '@core/common/functions/whatsappConnectionStatus';
import { CentrifugoService } from '@core/services/centrifugo.service';

type WorkerRuntimeEventProvider = 'baileys' | 'wwebjs' | 'whatsmeow';

interface WorkerRuntimeEventOutboxRow {
  outbox_id: number | string;
  event_id: string;
  worker_id: string;
  account_id: string;
  provider: WorkerRuntimeEventProvider;
  container_id: string;
  runtime_generation: number;
  writer_epoch: string;
  connection_sequence: number | string;
  capability_hash: string;
  event_type: string;
  payload: Record<string, unknown>;
  attempt_count: number;
  worker_name: string | null;
  session_storage: EWorkerSessionStorage;
  runtime_is_current: boolean;
  connection_online_acknowledged: boolean;
  worker_status_id: string;
  worker_status_observed_at: string;
  lifecycle_operation_id: string | null;
  worker_container_id: string | null;
  runtime_container_id: string | null;
  recreate_bootstrap_operation_id: string | null;
  recreate_bootstrap_runtime_generation: number | null;
  recreate_bootstrap_container_id: string | null;
  recreate_bootstrap_started_at: string | null;
  recreate_retired_operation_id: string | null;
  recreate_retired_runtime_generation: number | null;
  recreate_retired_container_id: string | null;
  recreate_retired_at: string | null;
  connection_status_observed_at: string;
}

interface WorkerRuntimeEventPayload extends Record<string, unknown> {
  event_id: string;
  event_type: string;
  worker_id: string;
  account_id: string;
  worker_type_id: EWorkerType;
  container_id: string;
  runtime_generation: number;
  connection_sequence: number;
  session_storage: EWorkerSessionStorage;
  worker_name?: string;
}

interface ActiveQrAttemptEnvelope {
  worker_type_id?: string;
  runtime_generation?: number | string;
  ack?: {
    connection_attempt_id?: string;
    worker_type_id?: string;
    runtime_generation?: number | string;
  };
}

interface CachedQrAttemptEnvelope extends Record<string, unknown> {
  connection_attempt_id?: string;
  runtime_generation?: number | string;
  qrcode?: string;
  pairing_code?: string;
  passkey_public_key?: string;
  passkey_confirmation_code?: string;
  qr_generated_at?: string;
  expires_at?: string;
}

interface QrConnectingWorkerPromotion {
  worker_status_observed_at: string;
}

type QrAttemptValidationResult =
  { accepted: true } | { accepted: false; reason: string };

interface WorkerRuntimeEventOutboxServiceOptions {
  batchSize?: number;
  cleanupBatchSize?: number;
  cleanupIntervalMs?: number;
  deadLetterRetentionMs?: number;
  expiredOnlineAckBatchSize?: number;
  expiredOnlineAckIntervalMs?: number;
  leaseMs?: number;
  maxAttempts?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  pollIntervalMs?: number;
  publishedRetentionMs?: number;
}

interface WorkerRuntimeEventOutboxLoopOptions {
  onError?: (error: unknown) => void;
}

const PROVIDER_WORKER_TYPE: Record<WorkerRuntimeEventProvider, EWorkerType> = {
  baileys: EWorkerType.baileys,
  wwebjs: EWorkerType.wwebjs,
  whatsmeow: EWorkerType.whatsmeow,
};

const QR_PROMOTION_TERMINAL_NATIVE_STATUSES = [
  EWhatsappConnectionStatus.offline,
  EWhatsappConnectionStatus.loggedOut,
  EWhatsappConnectionStatus.invalidSession,
  EWhatsappConnectionStatus.conflict,
  EWhatsappConnectionStatus.leaseLost,
  EWhatsappConnectionStatus.stopped,
  EWhatsappConnectionStatus.error,
] as const;

const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_LEASE_MS = 90_000;
const DEFAULT_MAX_ATTEMPTS = 12;
const DEFAULT_RETRY_BASE_MS = 1_000;
const DEFAULT_RETRY_MAX_MS = 60_000;
const DEFAULT_POLL_INTERVAL_MS = 250;
const DEFAULT_CLEANUP_BATCH_SIZE = 5_000;
const DEFAULT_CLEANUP_INTERVAL_MS = 5 * 60_000;
const DEFAULT_PUBLISHED_RETENTION_MS = 7 * 24 * 60 * 60_000;
const DEFAULT_DEAD_LETTER_RETENTION_MS = 30 * 24 * 60 * 60_000;
const DEFAULT_EXPIRED_ONLINE_ACK_BATCH_SIZE = 100;
const DEFAULT_EXPIRED_ONLINE_ACK_INTERVAL_MS = 5_000;
const MAX_EXPIRED_ONLINE_ACKS_PER_CYCLE = 1_000;
const DEDUPLICATION_TTL_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_QR_MAX_AGE_MS = 120_000;
// Must remain greater than CentrifugoService's strict HTTP timeout. Strict
// publications perform one attempt per outbox drain, so a normally expiring
// lease cannot cross the external publish window.
const ONLINE_ACK_LEASE_SAFETY_MS = 20_000;
const EXPIRED_ONLINE_ACK_LEASE_MARGIN_MS = 5_000;
const SENSITIVE_PAYLOAD_KEYS = [
  'qrcode',
  'pairing_code',
  'passkey_public_key',
  'passkey_confirmation_code',
  'connection_status_lease_owner_id',
  'connection_status_fencing_token',
] as const;

class OnlineAcknowledgementInvalidatedError extends Error {
  constructor() {
    super('online_ack_invalidated_before_publish');
    this.name = 'OnlineAcknowledgementInvalidatedError';
  }
}

function readBoundedInteger(input: {
  value: unknown;
  fallback: number;
  minimum: number;
  maximum: number;
}): number {
  const parsed = Number(input.value);
  if (!Number.isFinite(parsed)) {
    return input.fallback;
  }
  return Math.max(input.minimum, Math.min(input.maximum, Math.floor(parsed)));
}

/**
 * Drains directly persisted worker status events without keeping database
 * locks open during Redis or Centrifugo I/O.
 */
@singleton()
export class WorkerRuntimeEventOutboxService {
  private readonly leaseOwner = randomUUID();
  private readonly batchSize: number;
  private readonly leaseMs: number;
  private readonly maxAttempts: number;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly pollIntervalMs: number;
  private readonly cleanupBatchSize: number;
  private readonly cleanupIntervalMs: number;
  private readonly publishedRetentionMs: number;
  private readonly deadLetterRetentionMs: number;
  private readonly expiredOnlineAckBatchSize: number;
  private readonly expiredOnlineAckIntervalMs: number;
  private isStopping = true;
  private isDraining = false;
  private isCleaning = false;
  private isReconcilingExpiredOnlineAcks = false;
  private loopTimer: ReturnType<typeof setTimeout> | null = null;
  private activeDrain: Promise<number> | null = null;
  private nextCleanupAt: number;
  private nextExpiredOnlineAckReconciliationAt = 0;

  constructor(
    @inject('DatabasePoolRw') private readonly pool: Pool,
    @inject('Redis') private readonly redis: Redis,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject('WorkerRuntimeEventOutboxOptions', { isOptional: true })
    options: WorkerRuntimeEventOutboxServiceOptions = {}
  ) {
    this.batchSize = readBoundedInteger({
      value:
        options.batchSize ??
        process.env.SERVICE_API_WORKER_RUNTIME_OUTBOX_BATCH_SIZE,
      fallback: DEFAULT_BATCH_SIZE,
      minimum: 1,
      maximum: 100,
    });
    this.leaseMs = readBoundedInteger({
      value:
        options.leaseMs ??
        process.env.SERVICE_API_WORKER_RUNTIME_OUTBOX_LEASE_MS,
      fallback: DEFAULT_LEASE_MS,
      minimum: 30_000,
      maximum: 10 * 60_000,
    });
    this.maxAttempts = readBoundedInteger({
      value:
        options.maxAttempts ??
        process.env.SERVICE_API_WORKER_RUNTIME_OUTBOX_MAX_ATTEMPTS,
      fallback: DEFAULT_MAX_ATTEMPTS,
      minimum: 1,
      maximum: 100,
    });
    this.retryBaseMs = readBoundedInteger({
      value:
        options.retryBaseMs ??
        process.env.SERVICE_API_WORKER_RUNTIME_OUTBOX_RETRY_BASE_MS,
      fallback: DEFAULT_RETRY_BASE_MS,
      minimum: 100,
      maximum: 60_000,
    });
    this.retryMaxMs = readBoundedInteger({
      value:
        options.retryMaxMs ??
        process.env.SERVICE_API_WORKER_RUNTIME_OUTBOX_RETRY_MAX_MS,
      fallback: DEFAULT_RETRY_MAX_MS,
      minimum: this.retryBaseMs,
      maximum: 60 * 60_000,
    });
    this.pollIntervalMs = readBoundedInteger({
      value:
        options.pollIntervalMs ??
        process.env.SERVICE_API_WORKER_RUNTIME_OUTBOX_POLL_INTERVAL_MS,
      fallback: DEFAULT_POLL_INTERVAL_MS,
      minimum: 25,
      maximum: 30_000,
    });
    this.cleanupBatchSize = readBoundedInteger({
      value:
        options.cleanupBatchSize ??
        process.env.SERVICE_API_WORKER_RUNTIME_OUTBOX_CLEANUP_BATCH_SIZE,
      fallback: DEFAULT_CLEANUP_BATCH_SIZE,
      minimum: 100,
      maximum: 20_000,
    });
    this.cleanupIntervalMs = readBoundedInteger({
      value:
        options.cleanupIntervalMs ??
        process.env.SERVICE_API_WORKER_RUNTIME_OUTBOX_CLEANUP_INTERVAL_MS,
      fallback: DEFAULT_CLEANUP_INTERVAL_MS,
      minimum: 30_000,
      maximum: 24 * 60 * 60_000,
    });
    this.publishedRetentionMs = readBoundedInteger({
      value:
        options.publishedRetentionMs ??
        process.env.SERVICE_API_WORKER_RUNTIME_OUTBOX_PUBLISHED_RETENTION_MS,
      fallback: DEFAULT_PUBLISHED_RETENTION_MS,
      minimum: 60 * 60_000,
      maximum: 365 * 24 * 60 * 60_000,
    });
    this.deadLetterRetentionMs = readBoundedInteger({
      value:
        options.deadLetterRetentionMs ??
        process.env.SERVICE_API_WORKER_RUNTIME_OUTBOX_DEAD_LETTER_RETENTION_MS,
      fallback: DEFAULT_DEAD_LETTER_RETENTION_MS,
      minimum: 24 * 60 * 60_000,
      maximum: 365 * 24 * 60 * 60_000,
    });
    this.expiredOnlineAckBatchSize = readBoundedInteger({
      value: options.expiredOnlineAckBatchSize,
      fallback: DEFAULT_EXPIRED_ONLINE_ACK_BATCH_SIZE,
      minimum: 1,
      maximum: 1_000,
    });
    this.expiredOnlineAckIntervalMs = readBoundedInteger({
      value: options.expiredOnlineAckIntervalMs,
      fallback: DEFAULT_EXPIRED_ONLINE_ACK_INTERVAL_MS,
      minimum: 1_000,
      maximum: 30_000,
    });
    this.nextCleanupAt = Date.now() + this.cleanupIntervalMs;
  }

  start(options: WorkerRuntimeEventOutboxLoopOptions = {}): void {
    if (!this.isStopping) {
      return;
    }
    this.isStopping = false;

    const run = (): void => {
      if (this.isStopping) {
        return;
      }
      this.activeDrain = this.drainOnce();
      void this.activeDrain
        .catch((error: unknown) => options.onError?.(error))
        .finally(() => {
          this.activeDrain = null;
          if (!this.isStopping) {
            this.loopTimer = setTimeout(run, this.pollIntervalMs);
            this.loopTimer.unref?.();
          }
        });
    };

    run();
  }

  async close(): Promise<void> {
    this.isStopping = true;
    if (this.loopTimer) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }
    await this.activeDrain?.catch(() => undefined);
  }

  async drainOnce(): Promise<number> {
    if (this.isDraining) {
      return 0;
    }
    this.isDraining = true;
    try {
      await this.reconcileExpiredOnlineAcksIfDue();
      const rows = await this.claimBatch();
      await Promise.all(rows.map((row) => this.processClaimedEvent(row)));
      await this.cleanupIfDue();
      return rows.length;
    } finally {
      this.isDraining = false;
    }
  }

  private async reconcileExpiredOnlineAcksIfDue(): Promise<void> {
    if (Date.now() < this.nextExpiredOnlineAckReconciliationAt) {
      return;
    }
    try {
      await this.reconcileExpiredOnlineAcksOnce();
    } finally {
      this.nextExpiredOnlineAckReconciliationAt =
        Date.now() + this.expiredOnlineAckIntervalMs;
    }
  }

  /**
   * Materializes a realtime connectivity invalidation when a PostgreSQL session loses
   * the exact lease without its provider process delivering a callback. The
   * database function is a bounded, SKIP LOCKED CAS; multiple service-api
   * replicas may call it safely.
   */
  async reconcileExpiredOnlineAcksOnce(): Promise<number> {
    if (this.isReconcilingExpiredOnlineAcks) {
      return 0;
    }
    this.isReconcilingExpiredOnlineAcks = true;
    try {
      let reconciledTotal = 0;
      while (reconciledTotal < MAX_EXPIRED_ONLINE_ACKS_PER_CYCLE) {
        const batchLimit = Math.min(
          this.expiredOnlineAckBatchSize,
          MAX_EXPIRED_ONLINE_ACKS_PER_CYCLE - reconciledTotal
        );
        const result = await this.pool.query<{ reconciled: number }>(
          `SELECT public.reconcile_expired_whatsapp_online_acks(
             $1::integer,
             $2::integer
           ) AS reconciled`,
          [batchLimit, EXPIRED_ONLINE_ACK_LEASE_MARGIN_MS]
        );
        const reconciled = Number(result.rows[0]?.reconciled ?? 0);
        reconciledTotal += reconciled;
        if (reconciled < batchLimit) {
          break;
        }
      }
      return reconciledTotal;
    } finally {
      this.isReconcilingExpiredOnlineAcks = false;
    }
  }

  private async cleanupIfDue(): Promise<void> {
    if (Date.now() < this.nextCleanupAt || this.isCleaning) {
      return;
    }

    try {
      await this.cleanupTerminalEventsOnce();
    } finally {
      this.nextCleanupAt = Date.now() + this.cleanupIntervalMs;
    }
  }

  /**
   * Deletes a bounded terminal batch. Partial retention indexes keep this
   * maintenance independent from both the live queue and historical volume.
   */
  async cleanupTerminalEventsOnce(): Promise<number> {
    if (this.isCleaning) {
      return 0;
    }
    this.isCleaning = true;
    try {
      const result = await this.pool.query(
        `WITH expired AS MATERIALIZED (
           SELECT queue.outbox_id
             FROM worker_runtime_event_outbox AS queue
            WHERE (
                    queue.state = 'published'
                AND queue.published_at < statement_timestamp()
                      - ($1::double precision * interval '1 millisecond')
                  ) OR (
                    queue.state = 'dead_letter'
                AND queue.created_at < statement_timestamp()
                      - ($2::double precision * interval '1 millisecond')
                  )
            ORDER BY queue.outbox_id
            LIMIT $3
            FOR UPDATE SKIP LOCKED
         )
         DELETE FROM worker_runtime_event_outbox AS queue
          USING expired
          WHERE queue.outbox_id = expired.outbox_id`,
        [
          this.publishedRetentionMs,
          this.deadLetterRetentionMs,
          this.cleanupBatchSize,
        ]
      );
      return result.rowCount ?? 0;
    } finally {
      this.isCleaning = false;
    }
  }

  private async claimBatch(): Promise<WorkerRuntimeEventOutboxRow[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<WorkerRuntimeEventOutboxRow>(
        `WITH first_unpublished AS (
           SELECT DISTINCT ON (queue.worker_id)
                  queue.worker_id, queue.outbox_id, queue.created_at
             FROM worker_runtime_event_outbox AS queue
            WHERE queue.state IN ('pending', 'publishing')
            ORDER BY queue.worker_id, queue.outbox_id
         ), eligible AS (
           SELECT queue.outbox_id, queue.created_at
             FROM worker_runtime_event_outbox AS queue
             JOIN first_unpublished AS first
               ON first.outbox_id = queue.outbox_id
            WHERE (
                    queue.state = 'pending'
                AND queue.available_at <= clock_timestamp()
                  ) OR (
                    queue.state = 'publishing'
                AND queue.lease_expires_at <= clock_timestamp()
                  )
            ORDER BY queue.created_at, queue.outbox_id
            LIMIT $2
            FOR UPDATE OF queue SKIP LOCKED
         ), claimed AS (
           UPDATE worker_runtime_event_outbox AS queue
              SET state = 'publishing',
                  attempt_count = queue.attempt_count + 1,
                  lease_owner = $1::uuid,
                  lease_expires_at = clock_timestamp()
                    + ($3::integer * interval '1 millisecond'),
                  last_error = NULL
             FROM eligible
            WHERE queue.outbox_id = eligible.outbox_id
          RETURNING queue.*
         )
         SELECT claimed.*,
                worker.name AS worker_name,
                worker.session_storage,
                worker.worker_status_id::text AS worker_status_id,
                worker.updated_at::text AS worker_status_observed_at,
                worker.lifecycle_operation_id::text AS lifecycle_operation_id,
                worker.container_id AS worker_container_id,
                runtime.container_id AS runtime_container_id,
                runtime.recreate_bootstrap_operation_id::text
                  AS recreate_bootstrap_operation_id,
                runtime.recreate_bootstrap_runtime_generation,
                runtime.recreate_bootstrap_container_id,
                runtime.recreate_bootstrap_started_at::text
                  AS recreate_bootstrap_started_at,
                runtime.recreate_retired_operation_id::text
                  AS recreate_retired_operation_id,
                runtime.recreate_retired_runtime_generation,
                runtime.recreate_retired_container_id,
                runtime.recreate_retired_at::text AS recreate_retired_at,
                claimed.created_at::text AS connection_status_observed_at,
                (
                  runtime.worker_id IS NOT NULL
                  AND runtime.runtime_generation = claimed.runtime_generation
                  AND runtime.session_writer_epoch = claimed.writer_epoch
                  AND runtime.runtime_capability_hash = claimed.capability_hash
                  AND runtime.source_provider = claimed.provider
                  AND runtime.session_storage = worker.session_storage
                  AND (
                    (
                      claimed.connection_sequence > 0
                      AND runtime.connection_sequence = claimed.connection_sequence
                    ) OR (
                      claimed.connection_sequence = 0
                      AND runtime.connection_sequence = 0
                      AND worker.worker_status_id IS DISTINCT FROM $4::uuid
                    )
                  )
                  AND (
                    runtime.container_id = claimed.container_id
                    OR runtime.container_id LIKE claimed.container_id || '%'
                    OR claimed.container_id LIKE runtime.container_id || '%'
                  )
                ) AS runtime_is_current,
                (
                  runtime.native_connection_status_outbox_id =
                    claimed.outbox_id
                  AND runtime.native_connection_online_acknowledged
                  AND runtime.session_storage = worker.session_storage
                  AND (
                    runtime.session_storage <> 'postgres'
                    OR session_lease.session_id IS NOT NULL
                  )
                ) AS connection_online_acknowledged
           FROM claimed
           JOIN worker ON worker.worker_id = claimed.worker_id
      LEFT JOIN worker_runtime AS runtime
             ON runtime.worker_id = claimed.worker_id
      LEFT JOIN whatsapp_session_lease AS session_lease
             ON session_lease.session_id = claimed.worker_id
            AND session_lease.provider = claimed.provider
            AND session_lease.generation = claimed.runtime_generation
            AND session_lease.epoch = claimed.writer_epoch
            AND session_lease.owner_id =
                  runtime.native_connection_status_lease_owner_id
            AND session_lease.fencing_token =
                  runtime.native_connection_status_fencing_token
            AND session_lease.expires_at > clock_timestamp()
                  + ($5::integer * interval '1 millisecond')
          ORDER BY claimed.created_at, claimed.outbox_id`,
        [
          this.leaseOwner,
          this.batchSize,
          this.leaseMs,
          EWorkerStatus.online,
          ONLINE_ACK_LEASE_SAFETY_MS,
        ]
      );
      await client.query('COMMIT');
      return result.rows;
    } catch (error) {
      await this.rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  private async rollback(client: PoolClient): Promise<void> {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The original claim error is more useful than a secondary rollback error.
    }
  }

  private async processClaimedEvent(
    row: WorkerRuntimeEventOutboxRow
  ): Promise<void> {
    const startedAt = Date.now();
    if (!row.runtime_is_current) {
      this.logSessionDebug('status_outbox.dead_lettered', row, {
        reason: 'stale_runtime',
        duration_ms: Date.now() - startedAt,
      });
      await this.markDeadLetter(row, 'stale_runtime');
      return;
    }

    const deduplicationKey = this.deduplicationKey(row.event_id);
    const alreadyPublished = await this.redis
      .get(deduplicationKey)
      .then((value) => value === '1')
      .catch(() => false);
    if (alreadyPublished) {
      await this.markPublished(row);
      this.logSessionDebug('status_outbox.publication_recovered', row, {
        duration_ms: Date.now() - startedAt,
      });
      return;
    }

    try {
      const rawPayload = this.buildPayload(row);
      const isQrAttemptPayload = this.isQrOrPasskeyPayload(rawPayload);
      const isSuccessfulConnection =
        this.isSuccessfulConnectionPayload(rawPayload);
      const isAcknowledgedOnlineConnection =
        isSuccessfulConnection &&
        rawPayload.connection_online_acknowledged === true &&
        (rawPayload.connection_status as { status?: unknown } | undefined)
          ?.status === EWhatsappConnectionStatus.online;
      const consumedQrCredential =
        isQrAttemptPayload && isWhatsappQrCredentialConsumedState(rawPayload);
      const requiresQrConnectingPromotion =
        consumedQrCredential && !isSuccessfulConnection;
      if (isQrAttemptPayload) {
        const validation = await this.validateQrAttempt(rawPayload);
        /*
         * A restored session may legitimately retain its historical
         * connection_attempt_id after the active QR key has been consumed and
         * deleted. The terminal ONLINE projection is already fenced by the
         * current runtime and, when acknowledged, by the exact live session
         * lease immediately before Centrifugo publication. Only that precise
         * missing-key case is recoverable: an invalid or different active
         * attempt remains fail-closed so an old ONLINE cannot cross a newer
         * pairing attempt.
         */
        const clearedHistoricalAttempt =
          isAcknowledgedOnlineConnection &&
          !validation.accepted &&
          validation.reason === 'active_attempt_missing';
        if (!validation.accepted && !clearedHistoricalAttempt) {
          this.logSessionDebug('status_outbox.dead_lettered', row, {
            reason: `stale_qr:${validation.reason}`,
            duration_ms: Date.now() - startedAt,
          });
          await this.markDeadLetter(row, `stale_qr:${validation.reason}`);
          return;
        }
      }
      const payload = requiresQrConnectingPromotion
        ? await this.promoteConsumedQrCredential(row, rawPayload)
        : rawPayload;
      if (!payload) {
        this.logSessionDebug('status_outbox.dead_lettered', row, {
          reason: 'qr_connecting_fence_rejected',
          duration_ms: Date.now() - startedAt,
        });
        await this.markDeadLetter(row, 'qr_connecting_fence_rejected');
        return;
      }
      this.logSessionDebug('status_outbox.publish_started', row, {
        channel_count: 2,
        qr_credential_consumed: consumedQrCredential,
      });
      await this.publishPayload(payload, row);
      await this.redis
        .setex(deduplicationKey, DEDUPLICATION_TTL_SECONDS, '1')
        .catch(() => undefined);
      await this.markPublished(row);
      this.logSessionDebug('status_outbox.published', row, {
        channel_count: 2,
        duration_ms: Date.now() - startedAt,
      });
    } catch (error) {
      if (error instanceof OnlineAcknowledgementInvalidatedError) {
        this.logSessionDebug('status_outbox.dead_lettered', row, {
          reason: error.message,
          duration_ms: Date.now() - startedAt,
        });
        await this.markDeadLetter(row, error.message);
        return;
      }
      const failureCode = this.safeFailureCode(error);
      if (row.attempt_count >= this.maxAttempts) {
        this.logSessionDebug('status_outbox.dead_lettered', row, {
          reason: failureCode,
          duration_ms: Date.now() - startedAt,
        });
        await this.markDeadLetter(row, failureCode);
        return;
      }
      this.logSessionDebug('status_outbox.retry_scheduled', row, {
        reason: failureCode,
        duration_ms: Date.now() - startedAt,
      });
      await this.releaseForRetry(row, failureCode);
    }
  }

  /**
   * Emits an allowlisted implementation trace. Outbox payloads can contain QR
   * data, phone numbers and other customer material, so this method never
   * serializes the payload itself (or account/container/capability identity).
   */
  private logSessionDebug(
    event: string,
    row: WorkerRuntimeEventOutboxRow,
    fields: Record<string, string | number | boolean> = {}
  ): void {
    if (
      process.env.WHATSAPP_SESSION_DEBUG_ENABLED?.trim().toLowerCase() !==
      'true'
    ) {
      return;
    }
    const nativeStatus =
      row.payload.connection_status &&
      typeof row.payload.connection_status === 'object' &&
      !Array.isArray(row.payload.connection_status)
        ? (row.payload.connection_status as Record<string, unknown>)
        : undefined;
    const status =
      typeof nativeStatus?.status === 'string' &&
      /^[a-z0-9][a-z0-9_.:-]{0,127}$/.test(nativeStatus.status)
        ? nativeStatus.status
        : 'unknown';
    const sequence = Number(nativeStatus?.sequence);
    const record = {
      timestamp: new Date().toISOString(),
      event,
      trace_id: row.event_id,
      session_id: row.worker_id,
      provider: row.provider,
      runtime_generation: row.runtime_generation,
      outbox_id: String(row.outbox_id),
      event_type: row.event_type,
      status,
      sequence: Number.isSafeInteger(sequence) && sequence > 0 ? sequence : 0,
      attempt: row.attempt_count,
      connection_online_acknowledged:
        row.connection_online_acknowledged === true,
      ...fields,
    };
    console.log('[whatsapp-session-debug]', JSON.stringify(record));
  }

  private buildPayload(
    row: WorkerRuntimeEventOutboxRow
  ): WorkerRuntimeEventPayload {
    const connectionSequence = Number(row.connection_sequence);
    const safePayload = { ...row.payload };
    delete safePayload.connection_status_lease_owner_id;
    delete safePayload.connection_status_fencing_token;
    // Runtime input cannot self-assert manager-owned lifecycle presentation.
    delete safePayload.recreate_phase;
    delete safePayload.recreate_phase_observed_at;
    delete safePayload.recreate_runtime_retired;
    delete safePayload.lifecycle_operation_id;
    delete safePayload.lifecycle_source;
    delete safePayload.lifecycle_action;
    delete safePayload.lifecycle_phase;
    delete safePayload.connection_status_observed_at;
    delete safePayload.worker_status_id;
    delete safePayload.worker_status_observed_at;
    delete safePayload.recreate_completed_operation_id;
    delete safePayload.recreate_completed_runtime_generation;
    delete safePayload.recreate_completed_at;
    if (row.event_type === 'telemetry') {
      delete safePayload.disconnected_user;
    }
    const recreatePhase = projectWorkerRecreatePhaseProjection({
      workerStatusId: row.worker_status_id,
      lifecycleOperationId: row.lifecycle_operation_id,
      workerContainerId: row.worker_container_id,
      runtimeContainerId: row.runtime_container_id,
      runtimeGeneration: row.runtime_generation,
      bootstrapOperationId: row.recreate_bootstrap_operation_id,
      bootstrapRuntimeGeneration: row.recreate_bootstrap_runtime_generation,
      bootstrapContainerId: row.recreate_bootstrap_container_id,
      bootstrapStartedAt: row.recreate_bootstrap_started_at,
      retiredOperationId: row.recreate_retired_operation_id,
      retiredRuntimeGeneration: row.recreate_retired_runtime_generation,
      retiredContainerId: row.recreate_retired_container_id,
      retiredAt: row.recreate_retired_at,
    });
    return {
      ...safePayload,
      event_id: row.event_id,
      event_type: row.event_type,
      worker_id: row.worker_id,
      account_id: row.account_id,
      worker_type_id: PROVIDER_WORKER_TYPE[row.provider],
      container_id: row.container_id,
      runtime_generation: row.runtime_generation,
      connection_sequence: Number.isSafeInteger(connectionSequence)
        ? connectionSequence
        : 0,
      session_storage: row.session_storage,
      connection_status_order: String(row.outbox_id),
      connection_online_acknowledged:
        row.connection_online_acknowledged === true,
      connection_status_observed_at:
        normalizeWhatsappConnectionStatusObservedAt(
          row.connection_status_observed_at
        ),
      ...(row.event_type !== 'telemetry'
        ? {
            worker_status_id: row.worker_status_id,
            worker_status_observed_at:
              normalizeWhatsappConnectionStatusObservedAt(
                row.worker_status_observed_at
              ),
          }
        : {}),
      ...(row.lifecycle_operation_id
        ? { lifecycle_operation_id: row.lifecycle_operation_id }
        : {}),
      ...(recreatePhase
        ? {
            recreate_phase: recreatePhase.phase,
            recreate_runtime_retired: recreatePhase.runtimeRetired,
            ...(recreatePhase.observedAt
              ? { recreate_phase_observed_at: recreatePhase.observedAt }
              : {}),
          }
        : {}),
      ...(row.worker_name ? { worker_name: row.worker_name } : {}),
    };
  }

  private async publishPayload(
    payload: WorkerRuntimeEventPayload,
    row?: WorkerRuntimeEventOutboxRow
  ): Promise<void> {
    if (
      isWhatsappQrAttemptExhaustedState(payload) ||
      this.isSuccessfulConnectionPayload(payload)
    ) {
      await this.clearFinishedQrAttempt(payload);
    } else if (this.isQrOrPasskeyPayload(payload)) {
      await this.cacheQrOrPasskeyPayload(payload);
    }

    // No database transaction is held during Centrifugo I/O. Recheck the
    // exact materialized outbox/worker/runtime fence at the last possible
    // point, with a lease margin covering the external publish window.
    if (
      row &&
      payload.connection_online_acknowledged === true &&
      (payload.connection_status as { status?: unknown } | undefined)
        ?.status === 'online' &&
      !(await this.isOnlineAcknowledgementStillValid(row))
    ) {
      throw new OnlineAcknowledgementInvalidatedError();
    }

    await Promise.all([
      this.centrifugoService.publishSubStrict(
        workerCentrifugoQueue(payload.account_id),
        payload
      ),
      this.centrifugoService.publishStrict(channelsConfigCentrifugo(), payload),
    ]);
  }

  private async isOnlineAcknowledgementStillValid(
    row: WorkerRuntimeEventOutboxRow
  ): Promise<boolean> {
    const result = await this.pool.query<{ valid: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM worker_runtime AS runtime
           JOIN worker
             ON worker.worker_id = runtime.worker_id
      LEFT JOIN whatsapp_session_lease AS session_lease
             ON session_lease.session_id = runtime.worker_id
            AND session_lease.provider = runtime.source_provider
            AND session_lease.generation = runtime.runtime_generation
            AND session_lease.epoch = runtime.session_writer_epoch
            AND session_lease.owner_id =
                  runtime.native_connection_status_lease_owner_id
            AND session_lease.fencing_token =
                  runtime.native_connection_status_fencing_token
            AND session_lease.expires_at > clock_timestamp()
                  + ($10::integer * interval '1 millisecond')
          WHERE runtime.worker_id = $1::uuid
            AND worker.account_id = $2::uuid
            AND worker.worker_status_id = $3::uuid
            AND worker.session_storage = $4
            AND runtime.session_storage = $4
            AND runtime.runtime_generation = $5
            AND runtime.source_provider = $6
            AND runtime.session_writer_epoch = $7::uuid
            AND runtime.connection_sequence = $8::bigint
            AND runtime.native_connection_status_outbox_id = $9::bigint
            AND runtime.runtime_capability_hash = $11
            AND (
              runtime.container_id = $12
              OR runtime.container_id LIKE $12 || '%'
              OR $12 LIKE runtime.container_id || '%'
            )
            AND runtime.native_connection_online_acknowledged
            AND runtime.native_connection_status ->> 'provider' = $6
            AND runtime.native_connection_status ->> 'status' = 'online'
            AND runtime.native_connection_status -> 'connected' =
              'true'::jsonb
            AND runtime.native_connection_status -> 'authenticated' =
              'true'::jsonb
            AND runtime.native_connection_status -> 'sessionValid' =
              'true'::jsonb
            AND runtime.native_connection_status -> 'qrAvailable' =
              'false'::jsonb
            AND (
              runtime.session_storage <> 'postgres'
              OR session_lease.session_id IS NOT NULL
            )
       ) AS valid`,
      [
        row.worker_id,
        row.account_id,
        EWorkerStatus.online,
        row.session_storage,
        row.runtime_generation,
        row.provider,
        row.writer_epoch,
        row.connection_sequence,
        row.outbox_id,
        ONLINE_ACK_LEASE_SAFETY_MS,
        row.capability_hash,
        row.container_id,
      ]
    );
    return result.rows[0]?.valid === true;
  }

  private isQrOrPasskeyPayload(payload: WorkerRuntimeEventPayload): boolean {
    // WhatsMeow may move directly from native `qr` to an authenticated
    // `connecting` snapshot without delivering the QR-channel `success`
    // callback. Only treat that fallback as QR progress when it remains tied
    // to an explicit connection attempt; restored-session telemetry without
    // an attempt must keep its ordinary publication path.
    const consumedCredentialForActiveAttempt = Boolean(
      this.nonEmptyString(payload.connection_attempt_id) &&
      isWhatsappQrCredentialConsumedState(payload)
    );
    return Boolean(
      payload.qrcode ||
      payload.pairing_code ||
      payload.passkey_public_key ||
      payload.passkey_confirmation_code ||
      payload.qr_pending === true ||
      payload.code === ECodeMessage.awaitingReadQrCode ||
      payload.code === ECodeMessage.awaitingPairingCode ||
      payload.code === ECodeMessage.awaitingPasskey ||
      payload.code === ECodeMessage.awaitingPasskeyConfirmation ||
      payload.code === ECodeMessage.pairingInProgress ||
      payload.code === ECodeMessage.newLoginAttempt ||
      consumedCredentialForActiveAttempt ||
      isWhatsappQrAttemptExhaustedState(payload)
    );
  }

  private normalizeConsumedQrCredentialPayload(
    payload: WorkerRuntimeEventPayload,
    workerStatusObservedAt: string
  ): WorkerRuntimeEventPayload {
    const normalized: WorkerRuntimeEventPayload = {
      ...payload,
      event_type: 'status',
      worker_status_id: EWorkerStatus.connecting,
      worker_status_observed_at: workerStatusObservedAt,
      status: EBaileysConnectionStatus.connecting,
      code: ECodeMessage.pairingInProgress,
      qr_pending: false,
    };
    delete normalized.qrcode;
    delete normalized.qr_generated_at;
    delete normalized.expires_at;
    return normalized;
  }

  /**
   * Commits the manager-owned pairing boundary before realtime publication.
   * The provider event is only evidence: the exact outbox lease, runtime,
   * consumed pairing grant and connection attempt must still agree. The
   * session lease is deliberately not revalidated here: a provider may
   * replace its internal connection source while completing pairing, so that
   * lease can be momentarily absent or already renewed by publication time.
   * The immutable writer epoch plus the current runtime, capability, sequence
   * and consumed grant remain the authority fence. An already-online or
   * superseded worker is never regressed to connecting.
   */
  private async promoteConsumedQrCredential(
    row: WorkerRuntimeEventOutboxRow,
    payload: WorkerRuntimeEventPayload
  ): Promise<WorkerRuntimeEventPayload | null> {
    const connectionAttemptId = this.nonEmptyString(
      payload.connection_attempt_id
    );
    if (!connectionAttemptId) {
      return null;
    }

    const result = await this.pool.query<QrConnectingWorkerPromotion>(
      `WITH qr_connecting_fence AS MATERIALIZED (
         SELECT owner.worker_status_id::text AS previous_worker_status_id,
                owner.updated_at AS previous_worker_status_observed_at
           FROM worker_runtime_event_outbox AS queue
           JOIN worker AS owner
             ON owner.worker_id = queue.worker_id
            AND owner.account_id = queue.account_id
           JOIN worker_runtime AS runtime
             ON runtime.worker_id = queue.worker_id
           JOIN whatsapp_pairing_activation_grant AS pairing_grant
             ON pairing_grant.connection_attempt_id::text = $14
            AND pairing_grant.worker_id = queue.worker_id
            AND pairing_grant.account_id = queue.account_id
            AND pairing_grant.provider = queue.provider
            AND pairing_grant.runtime_generation = queue.runtime_generation
            AND pairing_grant.container_id = queue.container_id
          WHERE queue.outbox_id = $1::bigint
            AND queue.state = 'publishing'
            AND queue.lease_owner = $2::uuid
            AND queue.worker_id = $3::uuid
            AND queue.account_id = $4::uuid
            AND queue.runtime_generation = $5
            AND queue.provider = $6
            AND queue.writer_epoch = $7::uuid
            AND queue.connection_sequence = $8::bigint
            AND queue.capability_hash = $9
            AND queue.container_id = $10
            AND queue.payload ->> 'connection_attempt_id' = $14
            AND owner.worker_type_id = $15::uuid
            AND owner.session_storage = $11
            AND owner.lifecycle_operation_id IS NULL
            AND owner.deleted_at IS NULL
            AND owner.worker_status_id IN ($12::uuid, $13::uuid)
            AND runtime.runtime_generation = queue.runtime_generation
            AND runtime.session_writer_epoch = queue.writer_epoch
            AND runtime.runtime_capability_hash = queue.capability_hash
            AND runtime.source_provider = queue.provider
            AND runtime.session_storage = owner.session_storage
            AND runtime.connection_sequence = queue.connection_sequence
            AND NOT (
              runtime.native_connection_status_outbox_id > queue.outbox_id
              AND COALESCE(
                NULLIF(
                  runtime.native_connection_public_status ->> 'status',
                  ''
                ),
                runtime.native_connection_status ->> 'status'
              ) = ANY($16::text[])
            )
            AND (
              runtime.container_id = queue.container_id
              OR runtime.container_id LIKE queue.container_id || '%'
              OR queue.container_id LIKE runtime.container_id || '%'
            )
            AND pairing_grant.consumed_at IS NOT NULL
            AND pairing_grant.revoked_at IS NULL
            AND pairing_grant.authorized_connection_epoch::text =
                  runtime.connection_epoch
            AND runtime.connection_sequence =
                  pairing_grant.connection_sequence_at_grant + 1
          FOR UPDATE OF owner
       ), promoted AS (
         UPDATE worker AS owner
            SET worker_status_id = $13::uuid,
                updated_at = CASE
                  WHEN qr_connecting_fence.previous_worker_status_id =
                       $13::text
                       AND qr_connecting_fence.previous_worker_status_observed_at
                             IS NOT NULL
                    THEN qr_connecting_fence.previous_worker_status_observed_at
                  ELSE clock_timestamp()
                END
           FROM qr_connecting_fence
          WHERE owner.worker_id = $3::uuid
            AND owner.account_id = $4::uuid
        RETURNING owner.updated_at::text AS worker_status_observed_at
       )
       SELECT promoted.worker_status_observed_at
         FROM promoted`,
      [
        row.outbox_id,
        this.leaseOwner,
        row.worker_id,
        row.account_id,
        row.runtime_generation,
        row.provider,
        row.writer_epoch,
        row.connection_sequence,
        row.capability_hash,
        row.container_id,
        row.session_storage,
        EWorkerStatus.disponible,
        EWorkerStatus.connecting,
        connectionAttemptId,
        PROVIDER_WORKER_TYPE[row.provider],
        [...QR_PROMOTION_TERMINAL_NATIVE_STATUSES],
      ]
    );
    const observedAt =
      result.rows[0]?.worker_status_observed_at?.trim() || null;
    return observedAt
      ? this.normalizeConsumedQrCredentialPayload(payload, observedAt)
      : null;
  }

  private isSuccessfulConnectionPayload(
    payload: WorkerRuntimeEventPayload
  ): boolean {
    return (
      payload.status === EBaileysConnectionStatus.connected ||
      payload.worker_status_id === EWorkerStatus.online ||
      payload.code === ECodeMessage.connectionEstablished
    );
  }

  private async cacheQrOrPasskeyPayload(
    payload: WorkerRuntimeEventPayload
  ): Promise<void> {
    const ttlSeconds = this.qrCacheTtlSeconds(payload);
    await this.redis.setex(
      this.qrAttemptCacheKey(payload),
      ttlSeconds,
      JSON.stringify(payload)
    );
  }

  private async validateQrAttempt(
    payload: WorkerRuntimeEventPayload
  ): Promise<QrAttemptValidationResult> {
    const connectionAttemptId = this.nonEmptyString(
      payload.connection_attempt_id
    );
    if (!connectionAttemptId) {
      return { accepted: false, reason: 'connection_attempt_missing' };
    }

    const activeRaw = await this.redis.get(this.activeQrAttemptKey(payload));
    if (!activeRaw) {
      return { accepted: false, reason: 'active_attempt_missing' };
    }

    let active: ActiveQrAttemptEnvelope;
    try {
      active = JSON.parse(activeRaw) as ActiveQrAttemptEnvelope;
    } catch {
      return { accepted: false, reason: 'active_attempt_invalid' };
    }

    const activeConnectionAttemptId = this.nonEmptyString(
      active.ack?.connection_attempt_id
    );
    if (!activeConnectionAttemptId) {
      return { accepted: false, reason: 'active_attempt_identity_missing' };
    }
    if (activeConnectionAttemptId !== connectionAttemptId) {
      return { accepted: false, reason: 'connection_attempt_mismatch' };
    }

    const activeWorkerTypeId = this.nonEmptyString(
      active.worker_type_id ?? active.ack?.worker_type_id
    );
    if (activeWorkerTypeId && activeWorkerTypeId !== payload.worker_type_id) {
      return { accepted: false, reason: 'worker_type_mismatch' };
    }

    const activeRuntimeGeneration = this.positiveSafeInteger(
      active.runtime_generation ?? active.ack?.runtime_generation
    );
    if (activeRuntimeGeneration === undefined) {
      return { accepted: false, reason: 'runtime_generation_missing' };
    }
    if (activeRuntimeGeneration !== payload.runtime_generation) {
      return { accepted: false, reason: 'runtime_generation_mismatch' };
    }

    const freshness = this.validateQrFreshness(payload);
    if (!freshness.accepted) {
      return freshness;
    }

    return this.validateAgainstCachedQrAttempt(payload, connectionAttemptId);
  }

  private async validateAgainstCachedQrAttempt(
    payload: WorkerRuntimeEventPayload,
    connectionAttemptId: string
  ): Promise<QrAttemptValidationResult> {
    const cachedRaw = await this.redis.get(this.qrAttemptCacheKey(payload));
    if (!cachedRaw) {
      return { accepted: true };
    }

    let cached: CachedQrAttemptEnvelope;
    try {
      cached = JSON.parse(cachedRaw) as CachedQrAttemptEnvelope;
    } catch {
      return { accepted: true };
    }

    if (
      this.nonEmptyString(cached.connection_attempt_id) !== connectionAttemptId
    ) {
      return { accepted: true };
    }
    const cachedRuntimeGeneration = this.positiveSafeInteger(
      cached.runtime_generation
    );
    if (
      cachedRuntimeGeneration !== undefined &&
      cachedRuntimeGeneration !== payload.runtime_generation
    ) {
      return { accepted: true };
    }

    const cachedHasCredential = this.hasConnectionCredential(cached);
    if (
      !this.hasConnectionCredential(payload) &&
      cachedHasCredential &&
      !isWhatsappQrCredentialConsumedState(payload) &&
      !isWhatsappQrAttemptExhaustedState(payload)
    ) {
      return { accepted: false, reason: 'cached_credential_wins' };
    }

    const incomingGeneratedAt = this.dateMilliseconds(payload.qr_generated_at);
    const cachedGeneratedAt = this.dateMilliseconds(cached.qr_generated_at);
    if (
      this.nonEmptyString(payload.qrcode) &&
      this.nonEmptyString(cached.qrcode) &&
      incomingGeneratedAt !== undefined &&
      cachedGeneratedAt !== undefined &&
      incomingGeneratedAt < cachedGeneratedAt
    ) {
      return { accepted: false, reason: 'newer_qr_already_cached' };
    }

    return { accepted: true };
  }

  private validateQrFreshness(
    payload: WorkerRuntimeEventPayload
  ): QrAttemptValidationResult {
    if (!this.nonEmptyString(payload.qrcode)) {
      return { accepted: true };
    }

    const generatedAt = this.dateMilliseconds(payload.qr_generated_at);
    if (generatedAt === undefined) {
      return { accepted: false, reason: 'qr_generated_at_invalid' };
    }
    const maxAgeMs = readBoundedInteger({
      value: process.env.CONNECTION_QRCODE_MAX_AGE_MS,
      fallback: DEFAULT_QR_MAX_AGE_MS,
      minimum: 1_000,
      maximum: 10 * 60_000,
    });
    if (Date.now() - generatedAt >= maxAgeMs) {
      return { accepted: false, reason: 'qr_expired' };
    }

    if (payload.expires_at !== undefined) {
      const expiresAt = this.dateMilliseconds(payload.expires_at);
      if (expiresAt === undefined) {
        return { accepted: false, reason: 'qr_expires_at_invalid' };
      }
      if (expiresAt <= Date.now()) {
        return { accepted: false, reason: 'qr_expired' };
      }
    }

    return { accepted: true };
  }

  private hasConnectionCredential(payload: Record<string, unknown>): boolean {
    return Boolean(
      this.nonEmptyString(payload.qrcode) ||
      this.nonEmptyString(payload.pairing_code) ||
      this.nonEmptyString(payload.passkey_public_key) ||
      this.nonEmptyString(payload.passkey_confirmation_code)
    );
  }

  private nonEmptyString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }
    const normalized = value.trim();
    return normalized || undefined;
  }

  private positiveSafeInteger(value: unknown): number | undefined {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
  }

  private dateMilliseconds(value: unknown): number | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private qrCacheTtlSeconds(payload: WorkerRuntimeEventPayload): number {
    if (!payload.qrcode) {
      return readBoundedInteger({
        value: process.env.CONNECTION_QRCODE_ATTEMPT_TTL_SECONDS,
        fallback: 180,
        minimum: 1,
        maximum: 600,
      });
    }
    const configured = readBoundedInteger({
      value: process.env.CONNECTION_QRCODE_CACHE_TTL_SECONDS,
      fallback: 115,
      minimum: 1,
      maximum: 600,
    });
    if (typeof payload.expires_at !== 'string') {
      return configured;
    }
    const expiresAt = Date.parse(payload.expires_at);
    if (!Number.isFinite(expiresAt)) {
      return configured;
    }
    return Math.max(
      1,
      Math.min(configured, Math.floor((expiresAt - Date.now()) / 1000))
    );
  }

  private qrAttemptCacheKey(payload: WorkerRuntimeEventPayload): string {
    return `connection:qrcode:${payload.worker_type_id}:${payload.worker_id}:attempt`;
  }

  private activeQrAttemptKey(payload: WorkerRuntimeEventPayload): string {
    return `connection:qrcode:${payload.worker_type_id}:${payload.worker_id}:active_attempt`;
  }

  private async clearFinishedQrAttempt(
    payload: WorkerRuntimeEventPayload
  ): Promise<void> {
    await this.redis
      .del(this.qrAttemptCacheKey(payload))
      .catch(() => undefined);
    if (typeof payload.connection_attempt_id !== 'string') {
      return;
    }
    const activeKey = this.activeQrAttemptKey(payload);
    const active = await this.redis.get(activeKey).catch(() => null);
    if (!active) {
      return;
    }
    try {
      const parsed = JSON.parse(active) as {
        ack?: { connection_attempt_id?: string };
      };
      if (parsed.ack?.connection_attempt_id === payload.connection_attempt_id) {
        await this.redis.del(activeKey).catch(() => undefined);
      }
    } catch {
      await this.redis.del(activeKey).catch(() => undefined);
    }
  }

  private deduplicationKey(eventId: string): string {
    return `worker-runtime-outbox:published:${eventId}`;
  }

  private retryDelayMs(attemptCount: number): number {
    return Math.min(
      this.retryMaxMs,
      this.retryBaseMs * 2 ** Math.min(Math.max(0, attemptCount - 1), 10)
    );
  }

  private safeFailureCode(error: unknown): string {
    return workerErrorFailureReason(
      'worker_runtime_event_publish_failed',
      error
    );
  }

  private async markPublished(row: WorkerRuntimeEventOutboxRow): Promise<void> {
    await this.pool.query(
      `UPDATE worker_runtime_event_outbox
          SET state = 'published', published_at = clock_timestamp(),
              lease_owner = NULL, lease_expires_at = NULL, last_error = NULL,
              payload = payload - $3::text[]
        WHERE outbox_id = $1::bigint
          AND state = 'publishing'
          AND lease_owner = $2::uuid`,
      [row.outbox_id, this.leaseOwner, SENSITIVE_PAYLOAD_KEYS]
    );
  }

  private async releaseForRetry(
    row: WorkerRuntimeEventOutboxRow,
    failureCode: string
  ): Promise<void> {
    await this.pool.query(
      `UPDATE worker_runtime_event_outbox
          SET state = 'pending',
              available_at = clock_timestamp()
                + ($3::integer * interval '1 millisecond'),
              lease_owner = NULL, lease_expires_at = NULL,
              last_error = $4
        WHERE outbox_id = $1::bigint
          AND state = 'publishing'
          AND lease_owner = $2::uuid`,
      [
        row.outbox_id,
        this.leaseOwner,
        this.retryDelayMs(row.attempt_count),
        failureCode,
      ]
    );
  }

  private async markDeadLetter(
    row: WorkerRuntimeEventOutboxRow,
    failureCode: string
  ): Promise<void> {
    await this.pool.query(
      `UPDATE worker_runtime_event_outbox
          SET state = 'dead_letter', lease_owner = NULL,
              lease_expires_at = NULL, last_error = $3,
              payload = payload - $4::text[]
        WHERE outbox_id = $1::bigint
          AND state = 'publishing'
          AND lease_owner = $2::uuid`,
      [row.outbox_id, this.leaseOwner, failureCode, SENSITIVE_PAYLOAD_KEYS]
    );
  }
}
