import * as schema from '@core/models';
import {
  configChannelsRecreateBatch,
  configChannelsRecreateTarget,
  type ConfigChannelsRecreateTargetStatus,
} from '@core/models';
import type { IConfigChannelRecreateTarget } from '@core/common/interfaces/IConfigChannelRecreateTarget';
import type { IConfigChannelsRecreateAllFilters } from '@core/common/interfaces/IConfigChannelsRecreateAllPayload';
import type { IWorkerLifecycleQueueMessage } from '@core/common/interfaces/IWorkerLifecycleQueueMessage';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { currentTime } from '@core/common/functions/currentTime';
import type { Transaction } from '@core/common/types/Transaction.type';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, count, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';

const ACTIVE_TARGET_STATUSES: ConfigChannelsRecreateTargetStatus[] = [
  'pending',
  'processing',
  'enqueued',
];
const TARGET_INSERT_CHUNK_SIZE = 250;
export interface ConfigChannelsRecreateBatchSource {
  readonly requestId: string;
  readonly topic: string;
  readonly partition: number;
  readonly offset: number;
  readonly accountId: string;
}

export interface CreateConfigChannelsRecreateBatchResult {
  readonly batchId: string;
  readonly created: boolean;
  readonly targetCount: number;
}

export interface ClaimedConfigChannelsRecreateTarget {
  readonly targetId: string;
  readonly batchId: string;
  readonly accountId: string;
  readonly workerId: string;
  readonly workerAccountId: string;
  readonly serverId: string;
  readonly workerTypeId: string;
  readonly lifecycleOperationId: string;
  readonly lifecycleJournal: IWorkerLifecycleQueueMessage[] | null;
  readonly status: 'processing' | 'enqueued';
  readonly attemptCount: number;
  readonly slotKey: string | null;
  readonly slotToken: string | null;
  readonly slotIndex: number | null;
}

export interface ClaimedConfigChannelsRecreateCompletion {
  readonly batchId: string;
  readonly accountId: string;
  readonly success: number;
  readonly errors: number;
}

export type ConfigChannelsRecreateFailureDisposition =
  'retry_scheduled' | 'enqueued_retry_scheduled' | 'failed' | 'lease_lost';
export type ConfigChannelsRecreateSettlement =
  'succeeded' | 'failed' | 'in_progress' | 'retry_scheduled' | 'lease_lost';

export class ConfigChannelsRecreateBatchIdentityConflictError extends Error {
  constructor() {
    super('config_channels_recreate_batch_identity_conflict');
    this.name = 'ConfigChannelsRecreateBatchIdentityConflictError';
  }
}

interface ClaimedTargetRow {
  config_channels_recreate_target_id: string;
  config_channels_recreate_batch_id: string;
  account_id: string;
  worker_id: string;
  worker_account_id: string;
  server_id: string;
  worker_type_id: string;
  lifecycle_operation_id: string;
  lifecycle_journal: IWorkerLifecycleQueueMessage[] | null;
  status: 'processing' | 'enqueued';
  attempt_count: number;
  recreate_server_slot_key: string | null;
  recreate_server_slot_token: string | null;
  recreate_server_slot_index: number | null;
}

interface ExistingBatchRow {
  batch_id: string;
  account_id: string;
  request_id: string;
  source_topic: string;
  source_partition: number;
  source_offset: number;
  filters: IConfigChannelsRecreateAllFilters;
  target_count: number;
}

interface ClaimedCompletionRow {
  config_channels_recreate_batch_id: string;
  account_id: string;
  success_count: number;
  error_count: number;
}

interface TargetSettlementRow {
  config_channels_recreate_batch_id: string;
  outcome: Exclude<ConfigChannelsRecreateSettlement, 'lease_lost'>;
  persisted: boolean;
}

function rowsOf<TRow>(result: unknown): TRow[] {
  if (!result || typeof result !== 'object' || !('rows' in result)) {
    return [];
  }

  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as TRow[]) : [];
}

function filtersIdentity(filters: IConfigChannelsRecreateAllFilters): string {
  return JSON.stringify({
    status: filters.status ?? null,
    type: filters.type ?? null,
    session_storage: filters.session_storage ?? null,
    account: filters.account ?? null,
    name: filters.name ?? null,
    number: filters.number ?? null,
  });
}

function resolveExistingBatch(
  candidates: ExistingBatchRow[],
  source: ConfigChannelsRecreateBatchSource,
  filters: IConfigChannelsRecreateAllFilters
): CreateConfigChannelsRecreateBatchResult | null {
  const requestMatch = candidates.find(
    (candidate) => candidate.request_id === source.requestId
  );
  const sourceMatch = candidates.find(
    (candidate) =>
      candidate.source_topic === source.topic &&
      candidate.source_partition === source.partition &&
      candidate.source_offset === source.offset
  );
  const existing = requestMatch ?? sourceMatch;
  if (!existing) {
    return null;
  }
  if (
    existing.account_id !== source.accountId ||
    filtersIdentity(existing.filters) !== filtersIdentity(filters) ||
    (!requestMatch && Boolean(sourceMatch)) ||
    (sourceMatch?.request_id !== undefined &&
      sourceMatch.request_id !== source.requestId)
  ) {
    throw new ConfigChannelsRecreateBatchIdentityConflictError();
  }

  return {
    batchId: existing.batch_id,
    created: false,
    targetCount: existing.target_count,
  };
}

@injectable()
export class ConfigChannelsRecreateBatchRepository {
  constructor(
    @inject('DatabaseRw')
    private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  async loadExistingBatch(
    source: ConfigChannelsRecreateBatchSource,
    filters: IConfigChannelsRecreateAllFilters
  ): Promise<CreateConfigChannelsRecreateBatchResult | null> {
    const candidates = await this.dbRw
      .select({
        batch_id: configChannelsRecreateBatch.config_channels_recreate_batch_id,
        account_id: configChannelsRecreateBatch.account_id,
        request_id: configChannelsRecreateBatch.request_id,
        source_topic: configChannelsRecreateBatch.source_topic,
        source_partition: configChannelsRecreateBatch.source_partition,
        source_offset: configChannelsRecreateBatch.source_offset,
        filters: configChannelsRecreateBatch.filters,
        target_count: configChannelsRecreateBatch.total_count,
      })
      .from(configChannelsRecreateBatch)
      .where(
        or(
          eq(configChannelsRecreateBatch.request_id, source.requestId),
          and(
            eq(configChannelsRecreateBatch.source_topic, source.topic),
            eq(configChannelsRecreateBatch.source_partition, source.partition),
            eq(configChannelsRecreateBatch.source_offset, source.offset)
          )
        )
      )
      .execute();

    return resolveExistingBatch(candidates, source, filters);
  }

  async createOrLoadBatch(
    source: ConfigChannelsRecreateBatchSource,
    filters: IConfigChannelsRecreateAllFilters,
    targets: IConfigChannelRecreateTarget[],
    emptyBatchError: string
  ): Promise<CreateConfigChannelsRecreateBatchResult> {
    const now = currentTime();
    const batchId = source.requestId;

    return this.dbRw.transaction(async (tx) => {
      const [createdBatch] = await tx
        .insert(configChannelsRecreateBatch)
        .values({
          config_channels_recreate_batch_id: batchId,
          request_id: source.requestId,
          source_topic: source.topic,
          source_partition: source.partition,
          source_offset: source.offset,
          account_id: source.accountId,
          filters,
          status: targets.length > 0 ? 'queued' : 'completed',
          total_count: targets.length,
          success_count: 0,
          error_count: targets.length > 0 ? 0 : 1,
          last_error: targets.length > 0 ? null : emptyBatchError,
          created_at: now,
          updated_at: now,
          finished_at: targets.length > 0 ? null : now,
        })
        .onConflictDoNothing()
        .returning({
          batch_id:
            configChannelsRecreateBatch.config_channels_recreate_batch_id,
        })
        .execute();

      if (createdBatch) {
        if (targets.length > 0) {
          for (
            let start = 0;
            start < targets.length;
            start += TARGET_INSERT_CHUNK_SIZE
          ) {
            const chunk = targets
              .slice(start, start + TARGET_INSERT_CHUNK_SIZE)
              .map((target) => ({
                config_channels_recreate_target_id: uuidv7(),
                config_channels_recreate_batch_id: batchId,
                worker_id: target.worker_id,
                worker_account_id: target.worker_account_id,
                server_id: target.server_id,
                worker_type_id: target.worker_type_id,
                lifecycle_operation_id: uuidv7(),
                initial_worker_status_id: target.worker_status_id,
                initial_worker_container_id: target.worker_container_id,
                initial_runtime_container_id: target.runtime_container_id,
                initial_runtime_generation: target.runtime_generation,
                status: 'pending' as const,
                attempt_count: 0,
                next_attempt_at: now,
                created_at: now,
                updated_at: now,
              }));
            await tx
              .insert(configChannelsRecreateTarget)
              .values(chunk)
              .execute();
          }
        }

        return {
          batchId,
          created: true,
          targetCount: targets.length,
        };
      }

      const existingCandidates = await tx
        .select({
          batch_id:
            configChannelsRecreateBatch.config_channels_recreate_batch_id,
          account_id: configChannelsRecreateBatch.account_id,
          request_id: configChannelsRecreateBatch.request_id,
          source_topic: configChannelsRecreateBatch.source_topic,
          source_partition: configChannelsRecreateBatch.source_partition,
          source_offset: configChannelsRecreateBatch.source_offset,
          filters: configChannelsRecreateBatch.filters,
          target_count: configChannelsRecreateBatch.total_count,
        })
        .from(configChannelsRecreateBatch)
        .where(
          or(
            eq(configChannelsRecreateBatch.request_id, source.requestId),
            and(
              eq(configChannelsRecreateBatch.source_topic, source.topic),
              eq(
                configChannelsRecreateBatch.source_partition,
                source.partition
              ),
              eq(configChannelsRecreateBatch.source_offset, source.offset)
            )
          )
        )
        .execute();

      const existing = resolveExistingBatch(
        existingCandidates,
        source,
        filters
      );
      if (!existing) {
        throw new ConfigChannelsRecreateBatchIdentityConflictError();
      }

      return existing;
    });
  }

  async claimNextTarget(
    ownerId: string,
    leaseDurationMs: number,
    serverConcurrency = 2
  ): Promise<ClaimedConfigChannelsRecreateTarget | null> {
    const normalizedServerConcurrency =
      Number.isSafeInteger(serverConcurrency) && serverConcurrency > 0
        ? serverConcurrency
        : 1;
    return this.dbRw.transaction(async (tx) => {
      /*
       * Lock one server first, then claim its target in a second statement.
       * READ COMMITTED gives the second statement a fresh snapshot after the
       * per-server lock, so concurrent Service pods cannot all observe the
       * same free capacity and over-claim that host.
       */
      const serverResult = await tx.execute(sql`
        WITH eligible_server AS MATERIALIZED (
          SELECT
            target.server_id,
            MIN(target.next_attempt_at) AS oldest_next_attempt_at,
            MIN(target.created_at) AS oldest_created_at
          FROM config_channels_recreate_target AS target
          INNER JOIN config_channels_recreate_batch AS batch
            ON batch.config_channels_recreate_batch_id =
              target.config_channels_recreate_batch_id
          WHERE batch.status IN ('queued', 'running')
            AND (
              SELECT COUNT(*)
              FROM config_channels_recreate_target AS leased_target
              INNER JOIN config_channels_recreate_batch AS leased_batch
                ON leased_batch.config_channels_recreate_batch_id =
                  leased_target.config_channels_recreate_batch_id
              WHERE leased_target.server_id = target.server_id
                AND leased_batch.status IN ('queued', 'running')
                AND (
                  leased_target.status = 'processing'
                  OR (
                    leased_target.status = 'enqueued'
                    AND leased_target.recreate_server_slot_key IS NOT NULL
                    AND leased_target.recreate_server_slot_token IS NOT NULL
                  )
                )
                AND leased_target.lease_expires_at > clock_timestamp()
            ) < ${normalizedServerConcurrency}
            AND (
              (
                target.status = 'pending'
                AND target.next_attempt_at <= clock_timestamp()
                AND (
                  SELECT COUNT(*)
                  FROM config_channels_recreate_target AS active_target
                  INNER JOIN config_channels_recreate_batch AS active_batch
                    ON active_batch.config_channels_recreate_batch_id =
                      active_target.config_channels_recreate_batch_id
                  WHERE active_target.server_id = target.server_id
                    AND active_batch.status IN ('queued', 'running')
                    AND (
                      active_target.status = 'processing'
                      OR (
                        active_target.status = 'enqueued'
                        AND active_target.recreate_server_slot_key IS NOT NULL
                        AND active_target.recreate_server_slot_token IS NOT NULL
                      )
                    )
                ) < ${normalizedServerConcurrency}
              )
              OR (
                target.status IN ('processing', 'enqueued')
                AND target.next_attempt_at <= clock_timestamp()
                AND (
                  target.lease_expires_at IS NULL
                  OR target.lease_expires_at <= clock_timestamp()
                )
              )
            )
          GROUP BY target.server_id
        )
        SELECT target_server.server_id
        FROM eligible_server
        INNER JOIN server AS target_server
          ON target_server.server_id = eligible_server.server_id
        ORDER BY
          eligible_server.oldest_next_attempt_at ASC,
          eligible_server.oldest_created_at ASC,
          target_server.server_id ASC
        LIMIT 1
        FOR UPDATE OF target_server SKIP LOCKED
      `);
      const [claimedServer] = rowsOf<{ server_id: string }>(serverResult);
      if (!claimedServer) {
        return null;
      }

      const result = await tx.execute(sql`
        WITH candidate AS MATERIALIZED (
          SELECT target.config_channels_recreate_target_id
          FROM config_channels_recreate_target AS target
          INNER JOIN config_channels_recreate_batch AS batch
            ON batch.config_channels_recreate_batch_id =
              target.config_channels_recreate_batch_id
          WHERE target.server_id = ${claimedServer.server_id}
            AND batch.status IN ('queued', 'running')
            AND (
              SELECT COUNT(*)
              FROM config_channels_recreate_target AS leased_target
              INNER JOIN config_channels_recreate_batch AS leased_batch
                ON leased_batch.config_channels_recreate_batch_id =
                  leased_target.config_channels_recreate_batch_id
              WHERE leased_target.server_id = target.server_id
                AND leased_batch.status IN ('queued', 'running')
                AND (
                  leased_target.status = 'processing'
                  OR (
                    leased_target.status = 'enqueued'
                    AND leased_target.recreate_server_slot_key IS NOT NULL
                    AND leased_target.recreate_server_slot_token IS NOT NULL
                  )
                )
                AND leased_target.lease_expires_at > clock_timestamp()
            ) < ${normalizedServerConcurrency}
            AND (
              (
                target.status = 'pending'
                AND target.next_attempt_at <= clock_timestamp()
                AND (
                  SELECT COUNT(*)
                  FROM config_channels_recreate_target AS active_target
                  INNER JOIN config_channels_recreate_batch AS active_batch
                    ON active_batch.config_channels_recreate_batch_id =
                      active_target.config_channels_recreate_batch_id
                  WHERE active_target.server_id = target.server_id
                    AND active_batch.status IN ('queued', 'running')
                    AND (
                      active_target.status = 'processing'
                      OR (
                        active_target.status = 'enqueued'
                        AND active_target.recreate_server_slot_key IS NOT NULL
                        AND active_target.recreate_server_slot_token IS NOT NULL
                      )
                    )
                ) < ${normalizedServerConcurrency}
              )
              OR (
                target.status IN ('processing', 'enqueued')
                AND target.next_attempt_at <= clock_timestamp()
                AND (
                  target.lease_expires_at IS NULL
                  OR target.lease_expires_at <= clock_timestamp()
                )
              )
            )
          ORDER BY
            target.next_attempt_at ASC,
            target.created_at ASC,
            target.config_channels_recreate_target_id ASC
          LIMIT 1
          FOR UPDATE OF target SKIP LOCKED
        ), claimed AS (
          UPDATE config_channels_recreate_target AS target
          SET
            status = CASE
              WHEN target.status = 'enqueued' THEN 'enqueued'
              ELSE 'processing'
            END,
            attempt_count = target.attempt_count + 1,
            lease_owner = ${ownerId},
            lease_expires_at = clock_timestamp() +
              (${Math.max(1, Math.floor(leaseDurationMs))} *
                INTERVAL '1 millisecond'),
            started_at = COALESCE(target.started_at, clock_timestamp()),
            updated_at = clock_timestamp()
          FROM candidate
          WHERE target.config_channels_recreate_target_id =
            candidate.config_channels_recreate_target_id
          RETURNING target.*
        ), started_batch AS (
          UPDATE config_channels_recreate_batch AS batch
          SET
            status = 'running',
            started_at = COALESCE(batch.started_at, clock_timestamp()),
            updated_at = clock_timestamp()
          FROM claimed
          WHERE batch.config_channels_recreate_batch_id =
            claimed.config_channels_recreate_batch_id
            AND batch.status = 'queued'
          RETURNING batch.config_channels_recreate_batch_id
        )
        SELECT
          claimed.config_channels_recreate_target_id,
          claimed.config_channels_recreate_batch_id,
          batch.account_id,
          claimed.worker_id,
          claimed.worker_account_id,
          claimed.server_id,
          claimed.worker_type_id,
          claimed.lifecycle_operation_id,
          claimed.lifecycle_journal,
          claimed.status,
          claimed.attempt_count,
          claimed.recreate_server_slot_key,
          claimed.recreate_server_slot_token,
          claimed.recreate_server_slot_index
        FROM claimed
        INNER JOIN config_channels_recreate_batch AS batch
          ON batch.config_channels_recreate_batch_id =
            claimed.config_channels_recreate_batch_id
      `);
      const [row] = rowsOf<ClaimedTargetRow>(result);
      if (!row) {
        return null;
      }

      return {
        targetId: row.config_channels_recreate_target_id,
        batchId: row.config_channels_recreate_batch_id,
        accountId: row.account_id,
        workerId: row.worker_id,
        workerAccountId: row.worker_account_id,
        serverId: row.server_id,
        workerTypeId: row.worker_type_id,
        lifecycleOperationId: row.lifecycle_operation_id,
        lifecycleJournal: row.lifecycle_journal,
        status: row.status,
        attemptCount: row.attempt_count,
        slotKey: row.recreate_server_slot_key,
        slotToken: row.recreate_server_slot_token,
        slotIndex: row.recreate_server_slot_index,
      };
    });
  }

  async renewTargetLease(
    targetId: string,
    ownerId: string,
    leaseDurationMs: number
  ): Promise<boolean> {
    const result = await this.dbRw
      .update(configChannelsRecreateTarget)
      .set({
        lease_expires_at: sql`clock_timestamp() + (
          ${Math.max(1, Math.floor(leaseDurationMs))} *
          INTERVAL '1 millisecond'
        )`,
        updated_at: currentTime(),
      })
      .where(
        and(
          eq(
            configChannelsRecreateTarget.config_channels_recreate_target_id,
            targetId
          ),
          eq(configChannelsRecreateTarget.lease_owner, ownerId),
          inArray(
            configChannelsRecreateTarget.status,
            ACTIVE_TARGET_STATUSES.slice(1)
          )
        )
      )
      .execute();

    return result.rowCount === 1;
  }

  async storeTargetSlot(
    targetId: string,
    ownerId: string,
    slot: { key: string; token: string; index: number }
  ): Promise<boolean> {
    const result = await this.dbRw
      .update(configChannelsRecreateTarget)
      .set({
        recreate_server_slot_key: slot.key,
        recreate_server_slot_token: slot.token,
        recreate_server_slot_index: slot.index,
        updated_at: currentTime(),
      })
      .where(
        and(
          eq(
            configChannelsRecreateTarget.config_channels_recreate_target_id,
            targetId
          ),
          eq(configChannelsRecreateTarget.lease_owner, ownerId),
          eq(configChannelsRecreateTarget.status, 'processing')
        )
      )
      .execute();

    return result.rowCount === 1;
  }

  /**
   * The Redis slot protects only physical container provisioning. Once the
   * balancer releases the exact token, keep lifecycle reconciliation durable
   * but stop charging that target against the server's two physical slots.
   */
  async markTargetSlotReleased(
    targetId: string,
    ownerId: string,
    slot: { key: string; token: string }
  ): Promise<boolean> {
    const result = await this.dbRw
      .update(configChannelsRecreateTarget)
      .set({
        recreate_server_slot_key: null,
        recreate_server_slot_token: null,
        recreate_server_slot_index: null,
        updated_at: currentTime(),
      })
      .where(
        and(
          eq(
            configChannelsRecreateTarget.config_channels_recreate_target_id,
            targetId
          ),
          eq(configChannelsRecreateTarget.lease_owner, ownerId),
          eq(configChannelsRecreateTarget.status, 'enqueued'),
          eq(configChannelsRecreateTarget.recreate_server_slot_key, slot.key),
          eq(
            configChannelsRecreateTarget.recreate_server_slot_token,
            slot.token
          )
        )
      )
      .execute();

    return result.rowCount === 1;
  }

  async markTargetEnqueued(
    targetId: string,
    ownerId: string,
    lifecycleOperationId: string,
    lifecycleJournal: readonly IWorkerLifecycleQueueMessage[] = []
  ): Promise<boolean> {
    const serializedJournal =
      lifecycleJournal.length > 0
        ? JSON.stringify([...lifecycleJournal])
        : null;
    const result = await this.dbRw.execute(sql`
      WITH fenced_worker AS MATERIALIZED (
        SELECT
          target.config_channels_recreate_target_id,
          active_worker.worker_id,
          active_worker.account_id,
          active_worker.server_id,
          active_worker.worker_type_id,
          active_worker.worker_status_id,
          active_worker.container_id
        FROM config_channels_recreate_target AS target
        INNER JOIN worker AS active_worker
          ON active_worker.worker_id = target.worker_id
        WHERE target.config_channels_recreate_target_id = ${targetId}
          AND target.lease_owner = ${ownerId}
          AND target.status IN ('processing', 'enqueued')
          AND active_worker.deleted_at IS NULL
          AND active_worker.account_id = target.worker_account_id
          AND active_worker.server_id = target.server_id
          AND active_worker.worker_type_id = target.worker_type_id
          AND active_worker.worker_status_id = ${EWorkerStatus.recreating}
          AND active_worker.lifecycle_operation_id =
            ${lifecycleOperationId}
        FOR KEY SHARE OF active_worker
      ), runtime_baseline AS MATERIALIZED (
        SELECT
          active_runtime.worker_id,
          active_runtime.container_id,
          active_runtime.runtime_generation
        FROM worker_runtime AS active_runtime
        INNER JOIN fenced_worker
          ON fenced_worker.worker_id = active_runtime.worker_id
        FOR SHARE OF active_runtime
      )
      UPDATE config_channels_recreate_target AS target
      SET
        lifecycle_operation_id = ${lifecycleOperationId},
        lifecycle_journal = CASE
          WHEN target.status = 'enqueued'
            AND target.lifecycle_operation_id = ${lifecycleOperationId}
            AND ${serializedJournal}::jsonb IS NULL
            THEN target.lifecycle_journal
          ELSE ${serializedJournal}::jsonb
        END,
        attempt_baseline_operation_id = CASE
          WHEN target.status = 'enqueued'
            AND target.attempt_baseline_operation_id =
              ${lifecycleOperationId}
            THEN target.attempt_baseline_operation_id
          ELSE ${lifecycleOperationId}
        END,
        attempt_baseline_worker_status_id = CASE
          WHEN target.status = 'enqueued'
            AND target.attempt_baseline_operation_id =
              ${lifecycleOperationId}
            THEN target.attempt_baseline_worker_status_id
          ELSE fenced_worker.worker_status_id
        END,
        attempt_baseline_worker_container_id = CASE
          WHEN target.status = 'enqueued'
            AND target.attempt_baseline_operation_id =
              ${lifecycleOperationId}
            THEN target.attempt_baseline_worker_container_id
          ELSE fenced_worker.container_id
        END,
        attempt_baseline_runtime_exists = CASE
          WHEN target.status = 'enqueued'
            AND target.attempt_baseline_operation_id =
              ${lifecycleOperationId}
            THEN target.attempt_baseline_runtime_exists
          ELSE runtime_baseline.worker_id IS NOT NULL
        END,
        attempt_baseline_runtime_container_id = CASE
          WHEN target.status = 'enqueued'
            AND target.attempt_baseline_operation_id =
              ${lifecycleOperationId}
            THEN target.attempt_baseline_runtime_container_id
          ELSE runtime_baseline.container_id
        END,
        attempt_baseline_runtime_generation = CASE
          WHEN target.status = 'enqueued'
            AND target.attempt_baseline_operation_id =
              ${lifecycleOperationId}
            THEN target.attempt_baseline_runtime_generation
          ELSE runtime_baseline.runtime_generation
        END,
        attempt_baseline_captured_at = CASE
          WHEN target.status = 'enqueued'
            AND target.attempt_baseline_operation_id =
              ${lifecycleOperationId}
            THEN target.attempt_baseline_captured_at
          ELSE clock_timestamp()
        END,
        status = 'enqueued',
        enqueued_at = COALESCE(target.enqueued_at, clock_timestamp()),
        last_error = NULL,
        updated_at = clock_timestamp()
      FROM fenced_worker
      LEFT JOIN runtime_baseline
        ON runtime_baseline.worker_id = fenced_worker.worker_id
      WHERE target.config_channels_recreate_target_id =
        fenced_worker.config_channels_recreate_target_id
        AND target.lease_owner = ${ownerId}
        AND target.status IN ('processing', 'enqueued')
      RETURNING target.config_channels_recreate_target_id
    `);

    return rowsOf(result).length === 1;
  }

  async completeTarget(
    targetId: string,
    ownerId: string
  ): Promise<ConfigChannelsRecreateSettlement> {
    return this.dbRw.transaction(async (tx) => {
      const now = currentTime();
      const result = await tx.execute(sql`
        WITH observation AS MATERIALIZED (
          SELECT
            target.config_channels_recreate_target_id,
            target.config_channels_recreate_batch_id,
            target.worker_account_id,
            target.server_id,
            target.worker_type_id,
            target.initial_worker_status_id,
            target.lifecycle_operation_id,
            target.attempt_count,
            target.attempt_baseline_operation_id,
            target.attempt_baseline_worker_status_id,
            target.attempt_baseline_worker_container_id,
            target.attempt_baseline_runtime_exists,
            target.attempt_baseline_runtime_container_id,
            target.attempt_baseline_runtime_generation,
            target.attempt_baseline_captured_at,
            recovered_worker.worker_id AS observed_worker_id,
            recovered_worker.account_id AS observed_account_id,
            recovered_worker.server_id AS observed_server_id,
            recovered_worker.worker_type_id AS observed_worker_type_id,
            recovered_worker.worker_status_id,
            recovered_worker.lifecycle_operation_id AS observed_operation_id,
            recovered_worker.container_id AS observed_container_id,
            recovered_worker.deleted_at AS observed_deleted_at,
            recovered_runtime.worker_id AS observed_runtime_worker_id,
            recovered_runtime.container_id AS observed_runtime_container_id,
            recovered_runtime.runtime_generation
          FROM config_channels_recreate_target AS target
          LEFT JOIN worker AS recovered_worker
            ON recovered_worker.worker_id = target.worker_id
          LEFT JOIN worker_runtime AS recovered_runtime
            ON recovered_runtime.worker_id = recovered_worker.worker_id
          WHERE target.config_channels_recreate_target_id = ${targetId}
            AND target.lease_owner = ${ownerId}
            AND target.status IN ('processing', 'enqueued')
          FOR UPDATE OF target
        ), evaluated AS (
          SELECT
            observation.*,
            (
              worker_status_id = ${EWorkerStatus.online}
              OR (
                initial_worker_status_id = ${EWorkerStatus.disponible}
                AND worker_status_id = ${EWorkerStatus.disponible}
              )
            ) AS terminal_status_accepted
          FROM observation
        ), classified AS (
          SELECT
            evaluated.*,
            CASE
              WHEN observed_worker_id IS NULL
                OR observed_deleted_at IS NOT NULL
                OR observed_account_id IS DISTINCT FROM worker_account_id
                OR observed_server_id IS DISTINCT FROM server_id
                OR observed_worker_type_id IS DISTINCT FROM worker_type_id
                OR (
                  observed_operation_id IS NOT NULL
                  AND observed_operation_id IS DISTINCT FROM
                    lifecycle_operation_id
                )
                THEN 'failed'
              WHEN observed_operation_id = lifecycle_operation_id
                THEN 'in_progress'
              WHEN observed_operation_id IS NULL
                AND terminal_status_accepted
                AND attempt_baseline_operation_id =
                  lifecycle_operation_id
                AND attempt_baseline_captured_at IS NOT NULL
                AND attempt_baseline_worker_status_id =
                  ${EWorkerStatus.recreating}
                AND observed_runtime_worker_id IS NOT NULL
                AND observed_container_id IS NOT NULL
                AND observed_runtime_container_id = observed_container_id
                AND (
                  attempt_baseline_runtime_exists = FALSE
                  OR (
                    attempt_baseline_runtime_exists = TRUE
                    AND attempt_baseline_runtime_generation IS NOT NULL
                    AND runtime_generation >
                      attempt_baseline_runtime_generation
                  )
                )
                THEN 'succeeded'
              WHEN observed_operation_id IS NULL
                AND terminal_status_accepted
                THEN 'retry_scheduled'
              ELSE 'failed'
            END AS outcome,
            CASE
              WHEN observed_worker_id IS NULL
                THEN 'recreate_target_worker_missing'
              WHEN observed_deleted_at IS NOT NULL
                THEN 'recreate_target_worker_deleted'
              WHEN observed_account_id IS DISTINCT FROM worker_account_id
                OR observed_server_id IS DISTINCT FROM server_id
                OR observed_worker_type_id IS DISTINCT FROM worker_type_id
                THEN 'recreate_target_worker_identity_changed'
              WHEN observed_operation_id IS NOT NULL
                AND observed_operation_id IS DISTINCT FROM
                  lifecycle_operation_id
                THEN 'recreate_target_operation_superseded'
              WHEN observed_operation_id = lifecycle_operation_id
                THEN NULL
              WHEN observed_operation_id IS NULL
                AND terminal_status_accepted
                AND (
                  attempt_baseline_operation_id IS DISTINCT FROM
                    lifecycle_operation_id
                  OR attempt_baseline_captured_at IS NULL
                  OR attempt_baseline_worker_status_id IS DISTINCT FROM
                    ${EWorkerStatus.recreating}
                  OR attempt_baseline_runtime_exists IS NULL
                )
                THEN 'recreate_attempt_baseline_missing'
              WHEN observed_operation_id IS NULL
                AND terminal_status_accepted
                AND attempt_baseline_runtime_exists = TRUE
                AND attempt_baseline_runtime_generation IS NOT NULL
                AND observed_container_id =
                  attempt_baseline_worker_container_id
                AND observed_runtime_container_id =
                  attempt_baseline_runtime_container_id
                AND observed_runtime_container_id =
                  observed_container_id
                AND runtime_generation <=
                  attempt_baseline_runtime_generation
                THEN 'recreate_rolled_back_to_attempt_baseline'
              WHEN observed_operation_id IS NULL
                AND terminal_status_accepted
                AND attempt_baseline_operation_id =
                  lifecycle_operation_id
                AND attempt_baseline_captured_at IS NOT NULL
                AND attempt_baseline_worker_status_id =
                  ${EWorkerStatus.recreating}
                AND observed_runtime_worker_id IS NOT NULL
                AND observed_container_id IS NOT NULL
                AND observed_runtime_container_id = observed_container_id
                AND (
                  attempt_baseline_runtime_exists = FALSE
                  OR (
                    attempt_baseline_runtime_exists = TRUE
                    AND attempt_baseline_runtime_generation IS NOT NULL
                    AND runtime_generation >
                      attempt_baseline_runtime_generation
                  )
                )
                THEN NULL
              WHEN observed_runtime_worker_id IS NULL
                OR observed_container_id IS NULL
                OR observed_runtime_container_id IS DISTINCT FROM
                  observed_container_id
                OR attempt_baseline_runtime_generation IS NULL
                OR runtime_generation <=
                  attempt_baseline_runtime_generation
                THEN 'recreate_completed_without_runtime_proof'
              WHEN NOT terminal_status_accepted
                THEN concat(
                  'recreate_completed_unexpected_status:',
                  worker_status_id
                )
              ELSE NULL
            END AS terminal_reason
          FROM evaluated
        ), settled AS (
          UPDATE config_channels_recreate_target AS target
          SET
            status = CASE
              WHEN classified.outcome = 'retry_scheduled'
                THEN 'pending'
              ELSE classified.outcome
            END,
            next_attempt_at = CASE
              WHEN classified.outcome = 'retry_scheduled'
                THEN clock_timestamp() + (
                  LEAST(
                    60000,
                    5000 * power(
                      2,
                      LEAST(
                        10,
                        GREATEST(0, classified.attempt_count - 1)
                      )
                    )
                  ) * INTERVAL '1 millisecond'
                )
              ELSE target.next_attempt_at
            END,
            lease_owner = NULL,
            lease_expires_at = NULL,
            lifecycle_journal = CASE
              WHEN classified.outcome = 'retry_scheduled'
                THEN NULL
              ELSE target.lifecycle_journal
            END,
            attempt_baseline_operation_id = CASE
              WHEN classified.outcome = 'retry_scheduled'
                THEN NULL
              ELSE target.attempt_baseline_operation_id
            END,
            attempt_baseline_worker_status_id = CASE
              WHEN classified.outcome = 'retry_scheduled'
                THEN NULL
              ELSE target.attempt_baseline_worker_status_id
            END,
            attempt_baseline_worker_container_id = CASE
              WHEN classified.outcome = 'retry_scheduled'
                THEN NULL
              ELSE target.attempt_baseline_worker_container_id
            END,
            attempt_baseline_runtime_exists = CASE
              WHEN classified.outcome = 'retry_scheduled'
                THEN NULL
              ELSE target.attempt_baseline_runtime_exists
            END,
            attempt_baseline_runtime_container_id = CASE
              WHEN classified.outcome = 'retry_scheduled'
                THEN NULL
              ELSE target.attempt_baseline_runtime_container_id
            END,
            attempt_baseline_runtime_generation = CASE
              WHEN classified.outcome = 'retry_scheduled'
                THEN NULL
              ELSE target.attempt_baseline_runtime_generation
            END,
            attempt_baseline_captured_at = CASE
              WHEN classified.outcome = 'retry_scheduled'
                THEN NULL
              ELSE target.attempt_baseline_captured_at
            END,
            recreate_server_slot_key = CASE
              WHEN classified.outcome = 'retry_scheduled'
                THEN NULL
              ELSE target.recreate_server_slot_key
            END,
            recreate_server_slot_token = CASE
              WHEN classified.outcome = 'retry_scheduled'
                THEN NULL
              ELSE target.recreate_server_slot_token
            END,
            recreate_server_slot_index = CASE
              WHEN classified.outcome = 'retry_scheduled'
                THEN NULL
              ELSE target.recreate_server_slot_index
            END,
            enqueued_at = CASE
              WHEN classified.outcome = 'retry_scheduled'
                THEN NULL
              ELSE target.enqueued_at
            END,
            last_error = classified.terminal_reason,
            finished_at = CASE
              WHEN classified.outcome = 'retry_scheduled'
                THEN NULL
              ELSE clock_timestamp()
            END,
            updated_at = clock_timestamp()
          FROM classified
          WHERE target.config_channels_recreate_target_id =
              classified.config_channels_recreate_target_id
            AND classified.outcome IN (
              'succeeded',
              'failed',
              'retry_scheduled'
            )
          RETURNING target.config_channels_recreate_target_id
        )
        SELECT
          classified.config_channels_recreate_batch_id,
          classified.outcome,
          settled.config_channels_recreate_target_id IS NOT NULL AS persisted
        FROM classified
        LEFT JOIN settled
          ON settled.config_channels_recreate_target_id =
            classified.config_channels_recreate_target_id
      `);
      const [settlement] = rowsOf<TargetSettlementRow>(result);

      if (!settlement) {
        return 'lease_lost';
      }
      if (settlement.outcome === 'in_progress') {
        return 'in_progress';
      }
      if (!settlement.persisted) {
        return 'lease_lost';
      }
      if (settlement.outcome === 'retry_scheduled') {
        return 'retry_scheduled';
      }

      await this.refreshBatchWithinTransaction(
        tx,
        settlement.config_channels_recreate_batch_id,
        now
      );
      return settlement.outcome;
    });
  }

  async failOrRetryTarget(
    targetId: string,
    ownerId: string,
    errorMessage: string,
    permanent: boolean,
    retryDelayMs: number
  ): Promise<ConfigChannelsRecreateFailureDisposition> {
    return this.dbRw.transaction(async (tx) => {
      const [target] = await tx
        .select({
          status: configChannelsRecreateTarget.status,
          attempt_count: configChannelsRecreateTarget.attempt_count,
          batch_id:
            configChannelsRecreateTarget.config_channels_recreate_batch_id,
        })
        .from(configChannelsRecreateTarget)
        .where(
          and(
            eq(
              configChannelsRecreateTarget.config_channels_recreate_target_id,
              targetId
            ),
            eq(configChannelsRecreateTarget.lease_owner, ownerId)
          )
        )
        .for('update')
        .limit(1)
        .execute();

      if (!target) {
        return 'lease_lost';
      }
      if (target.status === 'enqueued') {
        const now = currentTime();
        await tx
          .update(configChannelsRecreateTarget)
          .set({
            status: permanent ? 'failed' : 'enqueued',
            next_attempt_at: permanent
              ? now
              : sql`clock_timestamp() + (
                  ${Math.max(1, Math.floor(retryDelayMs))} *
                  INTERVAL '1 millisecond'
                )`,
            lease_owner: null,
            lease_expires_at: null,
            last_error: errorMessage.slice(0, 4000),
            finished_at: permanent ? now : null,
            updated_at: now,
          })
          .where(
            and(
              eq(
                configChannelsRecreateTarget.config_channels_recreate_target_id,
                targetId
              ),
              eq(configChannelsRecreateTarget.lease_owner, ownerId),
              eq(configChannelsRecreateTarget.status, 'enqueued')
            )
          )
          .execute();
        if (permanent) {
          await this.refreshBatchWithinTransaction(tx, target.batch_id, now);
          return 'failed';
        }
        return 'enqueued_retry_scheduled';
      }
      if (target.status !== 'processing') {
        return 'lease_lost';
      }

      const now = currentTime();
      await tx
        .update(configChannelsRecreateTarget)
        .set({
          status: permanent ? 'failed' : 'pending',
          next_attempt_at: permanent
            ? now
            : sql`clock_timestamp() + (
                ${Math.max(1, Math.floor(retryDelayMs))} *
                INTERVAL '1 millisecond'
              )`,
          lease_owner: null,
          lease_expires_at: null,
          recreate_server_slot_key: null,
          recreate_server_slot_token: null,
          recreate_server_slot_index: null,
          last_error: errorMessage.slice(0, 4000),
          finished_at: permanent ? now : null,
          updated_at: now,
        })
        .where(
          and(
            eq(
              configChannelsRecreateTarget.config_channels_recreate_target_id,
              targetId
            ),
            eq(configChannelsRecreateTarget.lease_owner, ownerId),
            eq(configChannelsRecreateTarget.status, 'processing')
          )
        )
        .execute();

      if (permanent) {
        await this.refreshBatchWithinTransaction(tx, target.batch_id, now);
        return 'failed';
      }

      return 'retry_scheduled';
    });
  }

  async claimCompletedBatch(
    ownerId: string,
    leaseDurationMs: number
  ): Promise<ClaimedConfigChannelsRecreateCompletion | null> {
    const result = await this.dbRw.execute(sql`
      WITH candidate AS MATERIALIZED (
        SELECT batch.config_channels_recreate_batch_id
        FROM config_channels_recreate_batch AS batch
        WHERE batch.status = 'completed'
          AND batch.completion_published_at IS NULL
          AND batch.next_completion_attempt_at <= clock_timestamp()
          AND (
            batch.completion_lease_expires_at IS NULL
            OR batch.completion_lease_expires_at <= clock_timestamp()
          )
        ORDER BY
          batch.finished_at ASC NULLS FIRST,
          batch.created_at ASC,
          batch.config_channels_recreate_batch_id ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE config_channels_recreate_batch AS batch
      SET
        completion_lease_owner = ${ownerId},
        completion_lease_expires_at = clock_timestamp() +
          (${Math.max(1, Math.floor(leaseDurationMs))} *
            INTERVAL '1 millisecond'),
        completion_attempt_count = batch.completion_attempt_count + 1,
        updated_at = clock_timestamp()
      FROM candidate
      WHERE batch.config_channels_recreate_batch_id =
        candidate.config_channels_recreate_batch_id
      RETURNING
        batch.config_channels_recreate_batch_id,
        batch.account_id,
        batch.success_count,
        batch.error_count
    `);
    const [row] = rowsOf<ClaimedCompletionRow>(result);
    if (!row) {
      return null;
    }

    return {
      batchId: row.config_channels_recreate_batch_id,
      accountId: row.account_id,
      success: row.success_count,
      errors: row.error_count,
    };
  }

  async markCompletionPublished(
    batchId: string,
    ownerId: string
  ): Promise<boolean> {
    const now = currentTime();
    const result = await this.dbRw
      .update(configChannelsRecreateBatch)
      .set({
        completion_published_at: now,
        completion_lease_owner: null,
        completion_lease_expires_at: null,
        updated_at: now,
      })
      .where(
        and(
          eq(
            configChannelsRecreateBatch.config_channels_recreate_batch_id,
            batchId
          ),
          eq(configChannelsRecreateBatch.completion_lease_owner, ownerId),
          isNull(configChannelsRecreateBatch.completion_published_at)
        )
      )
      .execute();

    return result.rowCount === 1;
  }

  async releaseCompletionClaim(
    batchId: string,
    ownerId: string
  ): Promise<void> {
    await this.dbRw
      .update(configChannelsRecreateBatch)
      .set({
        completion_lease_owner: null,
        completion_lease_expires_at: null,
        next_completion_attempt_at: sql`clock_timestamp() + (
          LEAST(
            60000,
            1000 * power(
              2,
              LEAST(
                10,
                GREATEST(
                  0,
                  ${configChannelsRecreateBatch.completion_attempt_count} - 1
                )
              )
            )
          ) * INTERVAL '1 millisecond'
        )`,
        updated_at: currentTime(),
      })
      .where(
        and(
          eq(
            configChannelsRecreateBatch.config_channels_recreate_batch_id,
            batchId
          ),
          eq(configChannelsRecreateBatch.completion_lease_owner, ownerId),
          isNull(configChannelsRecreateBatch.completion_published_at)
        )
      )
      .execute();
  }

  private async refreshBatchWithinTransaction(
    tx: Transaction,
    batchId: string,
    now: string
  ): Promise<void> {
    await tx
      .select({
        batch_id: configChannelsRecreateBatch.config_channels_recreate_batch_id,
      })
      .from(configChannelsRecreateBatch)
      .where(
        eq(
          configChannelsRecreateBatch.config_channels_recreate_batch_id,
          batchId
        )
      )
      .for('update')
      .limit(1)
      .execute();

    const [counts] = await tx
      .select({
        total: count(),
        success: count(
          sql`CASE WHEN ${configChannelsRecreateTarget.status} = 'succeeded' THEN 1 END`
        ),
        errors: count(
          sql`CASE WHEN ${configChannelsRecreateTarget.status} = 'failed' THEN 1 END`
        ),
        active: count(
          sql`CASE WHEN ${configChannelsRecreateTarget.status} IN ('pending', 'processing', 'enqueued') THEN 1 END`
        ),
      })
      .from(configChannelsRecreateTarget)
      .where(
        eq(
          configChannelsRecreateTarget.config_channels_recreate_batch_id,
          batchId
        )
      )
      .execute();

    const active = Number(counts?.active ?? 0);
    await tx
      .update(configChannelsRecreateBatch)
      .set({
        total_count: Number(counts?.total ?? 0),
        success_count: Number(counts?.success ?? 0),
        error_count: Number(counts?.errors ?? 0),
        status: active === 0 ? 'completed' : 'running',
        finished_at: active === 0 ? now : null,
        updated_at: now,
      })
      .where(
        eq(
          configChannelsRecreateBatch.config_channels_recreate_batch_id,
          batchId
        )
      )
      .execute();
  }
}
