import * as schema from '@core/models';
import {
  whatsappSessionStorageMigration,
  whatsappSession,
  whatsappSessionRevision,
  worker,
  workerRuntime,
  type WhatsappSessionStorageMigrationEvidence,
  type WhatsappSessionStorageMigrationState,
  type WorkerWhatsappSessionProvider,
} from '@core/models';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import type { SessionStorageMigrationSummary } from '@core/schema/config/sessionStorageMigration/response.schema';
import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';

const RECOVERABLE_STATES: WhatsappSessionStorageMigrationState[] = [
  'queued',
  'capturing',
  'staged',
  'cutting_over',
  'starting',
  'validating',
  'retry_wait',
  'restoring',
];

const PROVIDER_BY_WORKER_TYPE: Partial<
  Record<EWorkerType, WorkerWhatsappSessionProvider>
> = {
  [EWorkerType.baileys]: 'baileys',
  [EWorkerType.wwebjs]: 'wwebjs',
  [EWorkerType.whatsmeow]: 'whatsmeow',
};

type MigrationRow = typeof whatsappSessionStorageMigration.$inferSelect;

export interface SessionStorageMigrationCandidate {
  worker_id: string;
  account_id: string;
  worker_type_id: EWorkerType;
  provider: WorkerWhatsappSessionProvider;
  worker_session_storage: EWorkerSessionStorage;
  runtime_session_storage: EWorkerSessionStorage;
  runtime_generation: number;
  source_volume_name: string;
  expected_phone: string | null;
  container_id: string | null;
  server_id: string | null;
}

export interface ClaimedSessionStorageMigration extends MigrationRow {
  worker_type_id: string;
  server_id: string | null;
  container_id: string | null;
  runtime_container_id: string | null;
  runtime_session_storage: EWorkerSessionStorage;
  runtime_generation: number;
}

export interface SessionStorageMigrationCleanupFence {
  migration: MigrationRow;
  worker_session_storage: EWorkerSessionStorage;
  runtime_session_storage: EWorkerSessionStorage;
  runtime_generation: number;
  runtime_container_id: string | null;
  active_revision_id: number | null;
  session_provider: string | null;
  session_state: string | null;
  server_id: string | null;
}

export const toSessionStorageMigrationSummary = (
  migration: MigrationRow
): SessionStorageMigrationSummary => ({
  migration_id: migration.migration_id,
  state: migration.state,
  phase: migration.state,
  attempt_count: migration.attempt_count,
  max_attempts: 3,
  created_at: migration.created_at,
  updated_at: migration.updated_at,
  attempt_started_at: migration.attempt_started_at,
  attempt_deadline_at: migration.attempt_deadline_at,
  next_attempt_at: migration.next_attempt_at,
  source_volume_preserved: migration.source_volume_preserved,
  target_revision_id: migration.target_revision_id,
  target_runtime_generation: migration.target_runtime_generation,
  target_validated_at: migration.target_validated_at,
  cleanup_pending: ['cleanup_pending', 'deleting_volume'].includes(
    migration.state
  ),
  restored_at: migration.restored_at,
  volume_deleted_at: migration.volume_deleted_at,
  completed_at: migration.completed_at,
  evidence: migration.health_evidence,
  last_error_code: migration.last_error_code,
});

@injectable()
export class SessionStorageMigrationRepository {
  constructor(
    @inject('DatabaseRw')
    private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  async viewCandidate(
    workerId: string
  ): Promise<SessionStorageMigrationCandidate | null> {
    const [candidate] = await this.dbRw
      .select({
        worker_id: worker.worker_id,
        account_id: worker.account_id,
        worker_type_id: worker.worker_type_id,
        worker_session_storage: worker.session_storage,
        runtime_session_storage: workerRuntime.session_storage,
        runtime_generation: workerRuntime.runtime_generation,
        source_volume_name: workerRuntime.session_volume_name,
        expected_phone: worker.number,
        container_id: workerRuntime.container_id,
        server_id: worker.server_id,
      })
      .from(worker)
      .innerJoin(workerRuntime, eq(workerRuntime.worker_id, worker.worker_id))
      .where(and(eq(worker.worker_id, workerId), isNull(worker.deleted_at)))
      .limit(1)
      .execute();

    if (!candidate) return null;

    const provider =
      PROVIDER_BY_WORKER_TYPE[candidate.worker_type_id as EWorkerType];
    if (!provider || !candidate.source_volume_name) return null;

    return {
      ...candidate,
      worker_type_id: candidate.worker_type_id as EWorkerType,
      provider,
      source_volume_name: candidate.source_volume_name,
    };
  }

  async createOrGetActive(
    expected: SessionStorageMigrationCandidate
  ): Promise<MigrationRow> {
    return this.dbRw.transaction(async (tx) => {
      const [locked] = await tx
        .select({
          account_id: worker.account_id,
          worker_type_id: worker.worker_type_id,
          worker_session_storage: worker.session_storage,
          runtime_session_storage: workerRuntime.session_storage,
          runtime_generation: workerRuntime.runtime_generation,
          source_volume_name: workerRuntime.session_volume_name,
          expected_phone: worker.number,
        })
        .from(worker)
        .innerJoin(workerRuntime, eq(workerRuntime.worker_id, worker.worker_id))
        .where(
          and(
            eq(worker.worker_id, expected.worker_id),
            isNull(worker.deleted_at)
          )
        )
        .for('update')
        .limit(1)
        .execute();

      if (!locked) throw new Error('session_storage_migration_channel_missing');

      const provider =
        PROVIDER_BY_WORKER_TYPE[locked.worker_type_id as EWorkerType];
      if (!provider) {
        throw new Error('session_storage_migration_provider_unsupported');
      }

      const [active] = await tx
        .select()
        .from(whatsappSessionStorageMigration)
        .where(
          and(
            eq(whatsappSessionStorageMigration.worker_id, expected.worker_id),
            sql`${whatsappSessionStorageMigration.state} NOT IN ('recovery_required', 'restored', 'completed')`
          )
        )
        .limit(1)
        .execute();
      if (active) return active;

      if (
        locked.account_id !== expected.account_id ||
        locked.worker_session_storage !== EWorkerSessionStorage.legacy_volume ||
        locked.runtime_session_storage !==
          EWorkerSessionStorage.legacy_volume ||
        locked.runtime_generation !== expected.runtime_generation ||
        locked.source_volume_name !== expected.source_volume_name
      ) {
        throw new Error('session_storage_migration_preflight_stale');
      }

      const [created] = await tx
        .insert(whatsappSessionStorageMigration)
        .values({
          worker_id: expected.worker_id,
          account_id: expected.account_id,
          provider,
          source_volume_name: expected.source_volume_name,
          expected_phone: locked.expected_phone,
          source_runtime_generation: expected.runtime_generation,
          next_attempt_at: sql`clock_timestamp()`,
        })
        .returning()
        .execute();

      if (!created) throw new Error('session_storage_migration_create_failed');
      return created;
    });
  }

  async latest(workerId: string): Promise<MigrationRow | null> {
    const [migration] = await this.dbRw
      .select()
      .from(whatsappSessionStorageMigration)
      .where(eq(whatsappSessionStorageMigration.worker_id, workerId))
      .orderBy(desc(whatsappSessionStorageMigration.created_at))
      .limit(1)
      .execute();
    return migration ?? null;
  }

  async getById(
    workerId: string,
    migrationId: string
  ): Promise<MigrationRow | null> {
    const [migration] = await this.dbRw
      .select()
      .from(whatsappSessionStorageMigration)
      .where(
        and(
          eq(whatsappSessionStorageMigration.worker_id, workerId),
          eq(whatsappSessionStorageMigration.migration_id, migrationId)
        )
      )
      .limit(1)
      .execute();
    return migration ?? null;
  }

  async countVolumeReferences(volumeName: string): Promise<number> {
    const [result] = await this.dbRw
      .select({ total: count() })
      .from(workerRuntime)
      .where(eq(workerRuntime.session_volume_name, volumeName))
      .execute();
    return result?.total ?? 0;
  }

  async viewCleanupFence(
    workerId: string,
    migrationId: string
  ): Promise<SessionStorageMigrationCleanupFence | null> {
    const [fence] = await this.dbRw
      .select({
        migration: whatsappSessionStorageMigration,
        worker_session_storage: worker.session_storage,
        runtime_session_storage: workerRuntime.session_storage,
        runtime_generation: workerRuntime.runtime_generation,
        runtime_container_id: workerRuntime.container_id,
        active_revision_id: whatsappSession.active_revision_id,
        session_provider: whatsappSession.provider,
        session_state: whatsappSession.state,
        server_id: worker.server_id,
      })
      .from(whatsappSessionStorageMigration)
      .innerJoin(
        worker,
        eq(worker.worker_id, whatsappSessionStorageMigration.worker_id)
      )
      .innerJoin(workerRuntime, eq(workerRuntime.worker_id, worker.worker_id))
      .leftJoin(
        whatsappSession,
        eq(whatsappSession.session_id, worker.worker_id)
      )
      .where(
        and(
          eq(whatsappSessionStorageMigration.worker_id, workerId),
          eq(whatsappSessionStorageMigration.migration_id, migrationId),
          isNull(worker.deleted_at)
        )
      )
      .limit(1)
      .execute();
    return fence ?? null;
  }

  async claimNext(
    leaseSeconds = 45
  ): Promise<ClaimedSessionStorageMigration | null> {
    return this.dbRw.transaction(async (tx) => {
      const [candidate] = await tx
        .select({
          migration: whatsappSessionStorageMigration,
          worker_type_id: worker.worker_type_id,
          server_id: worker.server_id,
          container_id: worker.container_id,
          runtime_container_id: workerRuntime.container_id,
          runtime_session_storage: workerRuntime.session_storage,
          runtime_generation: workerRuntime.runtime_generation,
        })
        .from(whatsappSessionStorageMigration)
        .innerJoin(
          worker,
          eq(worker.worker_id, whatsappSessionStorageMigration.worker_id)
        )
        .innerJoin(workerRuntime, eq(workerRuntime.worker_id, worker.worker_id))
        .where(
          and(
            inArray(whatsappSessionStorageMigration.state, RECOVERABLE_STATES),
            or(
              isNull(whatsappSessionStorageMigration.next_attempt_at),
              lte(
                whatsappSessionStorageMigration.next_attempt_at,
                sql`clock_timestamp()`
              )
            ),
            or(
              isNull(whatsappSessionStorageMigration.claim_expires_at),
              lte(
                whatsappSessionStorageMigration.claim_expires_at,
                sql`clock_timestamp()`
              )
            )
          )
        )
        .orderBy(
          whatsappSessionStorageMigration.next_attempt_at,
          whatsappSessionStorageMigration.updated_at
        )
        .for('update', { skipLocked: true })
        .limit(1)
        .execute();

      if (!candidate) return null;
      const claimToken = uuidv7();
      const [claimed] = await tx
        .update(whatsappSessionStorageMigration)
        .set({
          claim_token: claimToken,
          claim_expires_at: sql`clock_timestamp() + (${leaseSeconds} * interval '1 second')`,
          updated_at: sql`clock_timestamp()`,
        })
        .where(
          eq(
            whatsappSessionStorageMigration.migration_id,
            candidate.migration.migration_id
          )
        )
        .returning()
        .execute();

      return claimed
        ? {
            ...claimed,
            worker_type_id: candidate.worker_type_id,
            server_id: candidate.server_id,
            container_id: candidate.container_id,
            runtime_container_id: candidate.runtime_container_id,
            runtime_session_storage: candidate.runtime_session_storage,
            runtime_generation: candidate.runtime_generation,
          }
        : null;
    });
  }

  async transition(
    migrationId: string,
    claimToken: string | null,
    expectedStates: WhatsappSessionStorageMigrationState[],
    state: WhatsappSessionStorageMigrationState,
    patch: Partial<{
      attempt_count: number;
      attempt_started_at: string | null;
      attempt_deadline_at: string | null;
      next_attempt_at: string | null;
      target_runtime_generation: number | null;
      target_revision_id: number | null;
      checkpoint_checksum: string | null;
      checkpoint_size_bytes: number | null;
      checkpoint_record_count: number | null;
      expected_identity_hash: string | null;
      lifecycle_operation_id: string | null;
      source_volume_preserved: boolean;
      health_evidence: WhatsappSessionStorageMigrationEvidence;
      last_error_code: string | null;
      target_validated_at: string | null;
      restored_at: string | null;
      volume_delete_requested_at: string | null;
      volume_deleted_at: string | null;
      completed_at: string | null;
    }> = {}
  ): Promise<MigrationRow | null> {
    const filters = [
      eq(whatsappSessionStorageMigration.migration_id, migrationId),
      inArray(whatsappSessionStorageMigration.state, expectedStates),
    ];
    if (claimToken) {
      filters.push(eq(whatsappSessionStorageMigration.claim_token, claimToken));
    }

    const [updated] = await this.dbRw
      .update(whatsappSessionStorageMigration)
      .set({
        ...patch,
        state,
        claim_token: null,
        claim_expires_at: null,
        updated_at: sql`clock_timestamp()`,
      })
      .where(and(...filters))
      .returning()
      .execute();
    return updated ?? null;
  }

  async finalizeRestoration(
    migrationId: string,
    workerId: string,
    claimToken: string
  ): Promise<MigrationRow | null> {
    return this.dbRw.transaction(async (tx) => {
      const [claimed] = await tx
        .select({ migration_id: whatsappSessionStorageMigration.migration_id })
        .from(whatsappSessionStorageMigration)
        .where(
          and(
            eq(whatsappSessionStorageMigration.migration_id, migrationId),
            eq(whatsappSessionStorageMigration.worker_id, workerId),
            eq(whatsappSessionStorageMigration.state, 'restoring'),
            eq(whatsappSessionStorageMigration.claim_token, claimToken)
          )
        )
        .for('update')
        .limit(1)
        .execute();
      if (!claimed) return null;

      const result = await tx.execute<{ invalidated: boolean }>(sql`
        SELECT public.invalidate_legacy_volume_migration_revision(
          ${migrationId}::uuid,
          ${workerId}::uuid
        ) AS invalidated
      `);
      if (result.rows[0]?.invalidated !== true) {
        throw new Error(
          'session_storage_migration_revision_invalidation_failed'
        );
      }

      const [restored] = await tx
        .update(whatsappSessionStorageMigration)
        .set({
          state: 'restored',
          claim_token: null,
          claim_expires_at: null,
          next_attempt_at: null,
          restored_at: sql`clock_timestamp()`,
          updated_at: sql`clock_timestamp()`,
        })
        .where(
          and(
            eq(whatsappSessionStorageMigration.migration_id, migrationId),
            eq(whatsappSessionStorageMigration.worker_id, workerId),
            eq(whatsappSessionStorageMigration.state, 'restoring'),
            eq(whatsappSessionStorageMigration.claim_token, claimToken)
          )
        )
        .returning()
        .execute();
      if (!restored) {
        throw new Error(
          'session_storage_migration_restoration_finalize_failed'
        );
      }
      return restored;
    });
  }

  async beginLifecycle(input: {
    migrationId: string;
    claimToken: string;
    expectedStates: WhatsappSessionStorageMigrationState[];
    state: WhatsappSessionStorageMigrationState;
    targetStorage: EWorkerSessionStorage;
    targetRuntimeGeneration: number;
    lifecycleOperationId: string;
    targetRevisionId?: number;
  }): Promise<MigrationRow | null> {
    return this.dbRw.transaction(async (tx) => {
      const [migration] = await tx
        .select()
        .from(whatsappSessionStorageMigration)
        .where(
          and(
            eq(whatsappSessionStorageMigration.migration_id, input.migrationId),
            eq(whatsappSessionStorageMigration.claim_token, input.claimToken),
            inArray(whatsappSessionStorageMigration.state, input.expectedStates)
          )
        )
        .for('update')
        .limit(1)
        .execute();
      if (!migration) return null;

      const [currentWorker] = await tx
        .select({ deleted_at: worker.deleted_at })
        .from(worker)
        .where(eq(worker.worker_id, migration.worker_id))
        .for('update')
        .limit(1)
        .execute();
      if (!currentWorker || currentWorker.deleted_at) {
        throw new Error('session_storage_migration_worker_missing');
      }

      await tx
        .update(worker)
        .set({
          session_storage: input.targetStorage,
          worker_status_id: EWorkerStatus.recreating,
          lifecycle_operation_id: input.lifecycleOperationId,
          recreate_completed_operation_id: null,
          recreate_completed_runtime_generation: null,
          recreate_completed_at: null,
          updated_at: sql`clock_timestamp()`,
        })
        .where(eq(worker.worker_id, migration.worker_id))
        .execute();

      const [updated] = await tx
        .update(whatsappSessionStorageMigration)
        .set({
          state: input.state,
          target_runtime_generation: input.targetRuntimeGeneration,
          ...(input.targetRevisionId
            ? { target_revision_id: input.targetRevisionId }
            : {}),
          lifecycle_operation_id: input.lifecycleOperationId,
          claim_token: null,
          claim_expires_at: null,
          next_attempt_at: sql`clock_timestamp()`,
          updated_at: sql`clock_timestamp()`,
        })
        .where(
          eq(whatsappSessionStorageMigration.migration_id, input.migrationId)
        )
        .returning()
        .execute();
      return updated ?? null;
    });
  }

  async validationFence(workerId: string, migrationId: string) {
    const [result] = await this.dbRw
      .select({
        migration: whatsappSessionStorageMigration,
        worker_status_id: worker.worker_status_id,
        worker_type_id: worker.worker_type_id,
        worker_session_storage: worker.session_storage,
        server_id: worker.server_id,
        runtime_session_storage: workerRuntime.session_storage,
        runtime_generation: workerRuntime.runtime_generation,
        runtime_container_id: workerRuntime.container_id,
        active_revision_id: whatsappSession.active_revision_id,
        session_provider: whatsappSession.provider,
        session_state: whatsappSession.state,
        revision_status: whatsappSessionRevision.status,
        revision_source: whatsappSessionRevision.source,
      })
      .from(whatsappSessionStorageMigration)
      .innerJoin(
        worker,
        eq(worker.worker_id, whatsappSessionStorageMigration.worker_id)
      )
      .innerJoin(workerRuntime, eq(workerRuntime.worker_id, worker.worker_id))
      .leftJoin(
        whatsappSession,
        eq(whatsappSession.session_id, worker.worker_id)
      )
      .leftJoin(
        whatsappSessionRevision,
        and(
          eq(whatsappSessionRevision.session_id, worker.worker_id),
          eq(
            whatsappSessionRevision.revision_id,
            whatsappSession.active_revision_id
          )
        )
      )
      .where(
        and(
          eq(whatsappSessionStorageMigration.worker_id, workerId),
          eq(whatsappSessionStorageMigration.migration_id, migrationId),
          isNull(worker.deleted_at)
        )
      )
      .limit(1)
      .execute();
    return result ?? null;
  }
}
