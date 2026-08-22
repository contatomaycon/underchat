import { randomUUID } from 'node:crypto';
import { inject, singleton } from 'tsyringe';
import type { Pool, PoolClient } from 'pg';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import type { IWorkerSelfHealingRequestProto } from '@core/common/interfaces/IWorkerSelfHealingRequestProto';
import { WorkerGrpcClientService } from '@core/services/workerGrpcClient.service';
import { workerErrorFailureReason } from '@core/common/functions/workerErrorDiagnostics';

type SelfHealProvider = 'baileys' | 'wwebjs' | 'whatsmeow';

interface SelfHealRequestRow {
  request_id: string;
  worker_id: string;
  account_id: string;
  provider: SelfHealProvider;
  container_id: string;
  runtime_generation: number;
  reason: string;
  evidence: Record<string, unknown>;
  attempt_count: number;
  server_id: string | null;
  runtime_is_current: boolean;
  worker_is_dispatchable: boolean;
}

interface WorkerSelfHealDispatcherOptions {
  batchSize?: number;
  leaseMs?: number;
  maxAttempts?: number;
  pollIntervalMs?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
}

interface WorkerSelfHealDispatcherLoopOptions {
  onError?: (error: unknown) => void;
}

const PROVIDER_WORKER_TYPE: Record<SelfHealProvider, EWorkerType> = {
  baileys: EWorkerType.baileys,
  wwebjs: EWorkerType.wwebjs,
  whatsmeow: EWorkerType.whatsmeow,
};

const DEFAULT_BATCH_SIZE = 5;
const DEFAULT_LEASE_MS = 90_000;
const DEFAULT_MAX_ATTEMPTS = 12;
const DEFAULT_POLL_INTERVAL_MS = 500;
const DEFAULT_RETRY_BASE_MS = 1_000;
const DEFAULT_RETRY_MAX_MS = 60_000;

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

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function optionalPositiveInteger(value: unknown): number | undefined {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/u.test(value.trim())
        ? Number(value.trim())
        : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 2_147_483_647
    ? parsed
    : undefined;
}

/**
 * Converts a worker-authenticated database request into the one operation
 * that still belongs to Balance: Docker/lifecycle reconciliation.
 */
@singleton()
export class WorkerSelfHealRequestDispatcherService {
  private readonly leaseOwner = randomUUID();
  private readonly batchSize: number;
  private readonly leaseMs: number;
  private readonly maxAttempts: number;
  private readonly pollIntervalMs: number;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private isStopping = true;
  private isDraining = false;
  private loopTimer: ReturnType<typeof setTimeout> | null = null;
  private activeDrain: Promise<number> | null = null;

  constructor(
    @inject('DatabasePoolRw') private readonly pool: Pool,
    @inject(WorkerGrpcClientService)
    private readonly workerGrpcClientService: WorkerGrpcClientService,
    @inject('WorkerSelfHealDispatcherOptions', { isOptional: true })
    options: WorkerSelfHealDispatcherOptions = {}
  ) {
    this.batchSize = boundedInteger(
      options.batchSize ?? process.env.SERVICE_API_SELF_HEAL_BATCH_SIZE,
      DEFAULT_BATCH_SIZE,
      1,
      50
    );
    this.leaseMs = boundedInteger(
      options.leaseMs ?? process.env.SERVICE_API_SELF_HEAL_LEASE_MS,
      DEFAULT_LEASE_MS,
      30_000,
      10 * 60_000
    );
    this.maxAttempts = boundedInteger(
      options.maxAttempts ?? process.env.SERVICE_API_SELF_HEAL_MAX_ATTEMPTS,
      DEFAULT_MAX_ATTEMPTS,
      1,
      100
    );
    this.pollIntervalMs = boundedInteger(
      options.pollIntervalMs ??
        process.env.SERVICE_API_SELF_HEAL_POLL_INTERVAL_MS,
      DEFAULT_POLL_INTERVAL_MS,
      50,
      30_000
    );
    this.retryBaseMs = boundedInteger(
      options.retryBaseMs ?? process.env.SERVICE_API_SELF_HEAL_RETRY_BASE_MS,
      DEFAULT_RETRY_BASE_MS,
      100,
      60_000
    );
    this.retryMaxMs = boundedInteger(
      options.retryMaxMs ?? process.env.SERVICE_API_SELF_HEAL_RETRY_MAX_MS,
      DEFAULT_RETRY_MAX_MS,
      this.retryBaseMs,
      60 * 60_000
    );
  }

  start(options: WorkerSelfHealDispatcherLoopOptions = {}): void {
    if (!this.isStopping) return;
    this.isStopping = false;
    const run = (): void => {
      if (this.isStopping) return;
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
    if (this.isDraining) return 0;
    this.isDraining = true;
    try {
      const rows = await this.claimBatch();
      await Promise.all(rows.map((row) => this.process(row)));
      return rows.length;
    } finally {
      this.isDraining = false;
    }
  }

  private async claimBatch(): Promise<SelfHealRequestRow[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<SelfHealRequestRow>(
        `WITH eligible AS (
           SELECT request.request_id
             FROM worker_self_heal_request AS request
            WHERE (
                    (
                      request.state = 'queued'
                      AND request.available_at <= clock_timestamp()
                    ) OR (
                      request.state = 'processing'
                      AND request.lease_expires_at <= clock_timestamp()
                    )
                  )
            ORDER BY request.available_at, request.created_at, request.request_id
            LIMIT $2
            FOR UPDATE SKIP LOCKED
         ), claimed AS (
           UPDATE worker_self_heal_request AS request
              SET state = 'processing',
                  attempt_count = request.attempt_count + 1,
                  lease_owner = $1::uuid,
                  lease_expires_at = clock_timestamp()
                    + ($3::integer * interval '1 millisecond'),
                  last_error = NULL,
                  updated_at = clock_timestamp()
             FROM eligible
            WHERE request.request_id = eligible.request_id
          RETURNING request.*
         )
         SELECT claimed.*,
                worker.server_id,
                (
                  runtime.worker_id IS NOT NULL
                  AND runtime.runtime_generation = claimed.runtime_generation
                  AND runtime.session_writer_epoch = claimed.writer_epoch
                  AND runtime.runtime_capability_hash = claimed.capability_hash
                  AND runtime.source_provider = claimed.provider
                  AND (
                    runtime.container_id = claimed.container_id
                    OR runtime.container_id LIKE claimed.container_id || '%'
                    OR claimed.container_id LIKE runtime.container_id || '%'
                  )
                ) AS runtime_is_current,
                (
                  worker.deleted_at IS NULL
                  AND worker.server_id IS NOT NULL
                  AND worker.lifecycle_operation_id IS NULL
                  AND worker.worker_status_id = $4::uuid
                  AND worker.worker_type_id = CASE claimed.provider
                    WHEN 'baileys' THEN $5::uuid
                    WHEN 'wwebjs' THEN $6::uuid
                    WHEN 'whatsmeow' THEN $7::uuid
                  END
                  AND worker.container_id = runtime.container_id
                ) AS worker_is_dispatchable
           FROM claimed
           JOIN worker ON worker.worker_id = claimed.worker_id
      LEFT JOIN worker_runtime AS runtime
             ON runtime.worker_id = claimed.worker_id
          ORDER BY claimed.created_at, claimed.request_id`,
        [
          this.leaseOwner,
          this.batchSize,
          this.leaseMs,
          EWorkerStatus.online,
          EWorkerType.baileys,
          EWorkerType.wwebjs,
          EWorkerType.whatsmeow,
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
      // Keep the original database error.
    }
  }

  private async process(row: SelfHealRequestRow): Promise<void> {
    if (row.attempt_count > this.maxAttempts) {
      await this.cancel(row, 'max_attempts_exhausted');
      return;
    }

    if (
      row.runtime_is_current !== true ||
      row.worker_is_dispatchable !== true ||
      !row.server_id
    ) {
      await this.cancel(row, 'stale_runtime');
      return;
    }

    try {
      await this.workerGrpcClientService.requestWorkerSelfHealing(
        row.server_id,
        this.buildPayload(row)
      );
      await this.complete(row);
    } catch (error) {
      const failure = this.safeFailureCode(error);
      if (row.attempt_count >= this.maxAttempts) {
        await this.cancel(row, failure);
        return;
      }
      await this.retry(row, failure);
    }
  }

  private buildPayload(
    row: SelfHealRequestRow
  ): IWorkerSelfHealingRequestProto {
    const evidence = row.evidence ?? {};
    return {
      worker_id: row.worker_id,
      account_id: row.account_id,
      worker_type_id: PROVIDER_WORKER_TYPE[row.provider],
      runtime_generation: row.runtime_generation,
      reason: row.reason.trim(),
      source: optionalString(evidence.source) ?? 'health_monitor',
      provider_state: optionalString(evidence.provider_state),
      degraded_reason: optionalString(evidence.degraded_reason),
      kafka_unhealthy: optionalBoolean(evidence.kafka_unhealthy),
      session_ready: optionalBoolean(evidence.session_ready),
      can_send: optionalBoolean(evidence.can_send),
      can_receive_runtime: optionalBoolean(evidence.can_receive_runtime),
      authenticated: optionalBoolean(evidence.authenticated),
      phone: optionalString(evidence.phone),
      debug_trace_id: optionalString(evidence.debug_trace_id),
      recovery_window_seconds: optionalPositiveInteger(
        evidence.recovery_window_seconds
      ),
    };
  }

  private async complete(row: SelfHealRequestRow): Promise<void> {
    await this.pool.query(
      `UPDATE worker_self_heal_request
          SET state = 'completed', dispatched_at = clock_timestamp(),
              completed_at = clock_timestamp(), lease_owner = NULL,
              lease_expires_at = NULL, last_error = NULL,
              updated_at = clock_timestamp()
        WHERE request_id = $1::uuid AND state = 'processing'
          AND lease_owner = $2::uuid`,
      [row.request_id, this.leaseOwner]
    );
  }

  private async cancel(
    row: SelfHealRequestRow,
    failure: string
  ): Promise<void> {
    await this.pool.query(
      `UPDATE worker_self_heal_request
          SET state = 'cancelled', completed_at = clock_timestamp(),
              lease_owner = NULL, lease_expires_at = NULL,
              last_error = $3, updated_at = clock_timestamp()
        WHERE request_id = $1::uuid AND state = 'processing'
          AND lease_owner = $2::uuid`,
      [row.request_id, this.leaseOwner, failure]
    );
  }

  private async retry(row: SelfHealRequestRow, failure: string): Promise<void> {
    const exponent = Math.max(0, Math.min(20, row.attempt_count - 1));
    const retryMs = Math.min(this.retryMaxMs, this.retryBaseMs * 2 ** exponent);
    await this.pool.query(
      `UPDATE worker_self_heal_request
          SET state = 'queued',
              available_at = clock_timestamp()
                + ($3::integer * interval '1 millisecond'),
              lease_owner = NULL, lease_expires_at = NULL,
              last_error = $4, updated_at = clock_timestamp()
        WHERE request_id = $1::uuid AND state = 'processing'
          AND lease_owner = $2::uuid`,
      [row.request_id, this.leaseOwner, retryMs, failure]
    );
  }

  private safeFailureCode(error: unknown): string {
    return workerErrorFailureReason('worker_self_heal_dispatch_failed', error);
  }
}
