import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { inject, singleton } from 'tsyringe';

type WhatsappSessionGcRevisionStatus = 'staging' | 'failed' | 'retired';

interface WhatsappSessionGcClaim {
  session_id: string;
  revision_id: number | string;
  revision_status: WhatsappSessionGcRevisionStatus;
}

interface WhatsappSessionGcSessionRow {
  state: string;
  active_revision_id: number | string | null;
  previous_revision_id: number | string | null;
}

interface WhatsappSessionGcRevisionRow {
  status: string;
  eligible_at: Date | string;
  database_now: Date | string;
}

interface WhatsappSessionGcHandoffRow {
  state: string;
  recovery_state: string;
  protected_until: Date | string;
  database_now: Date | string;
}

interface WhatsappWwebjsProfileArtifactGcCandidate {
  session_id: string;
  revision_id: number | string;
  artifact_id: string;
}

interface WhatsappWwebjsProfileAnchorGcRow {
  state: 'active' | 'previous';
  retain_until: Date | string | null;
  database_now: Date | string;
}

interface WhatsappWwebjsProfileArtifactGcRow {
  status: string;
  provider: string;
  kind: string;
  unanchored_eligible_at: Date | string;
  database_now: Date | string;
}

type WhatsappSessionGcOutcome =
  'deleted' | 'deferred' | 'orphan_blobs_cleaned' | 'stale_queue_removed';

export interface WhatsappSessionGarbageCollectionResult {
  claimed: number;
  deletedRevisions: number;
  deletedArtifactBlobs: number;
  deferred: number;
  staleQueueRows: number;
  recoveredClaims: number;
  profileArtifactsScanned: number;
  deletedProfileArtifacts: number;
  deferredProfileArtifacts: number;
  errors: number;
  skipped: boolean;
}

export interface WhatsappSessionGarbageCollectorOptions {
  batchSize?: number;
  artifactBlobBatchSize?: number;
  claimTtlMs?: number;
  retryDelayMs?: number;
  rollbackRetentionMs?: number;
  profileArtifactBatchSize?: number;
  profileArtifactRetentionMs?: number;
}

const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_ARTIFACT_BLOB_BATCH_SIZE = 1_000;
const DEFAULT_PROFILE_ARTIFACT_BATCH_SIZE = 100;
const DEFAULT_PROFILE_ARTIFACT_RETENTION_MS = 24 * 60 * 60_000;
const DEFAULT_CLAIM_TTL_MS = 10 * 60_000;
const DEFAULT_RETRY_DELAY_MS = 15 * 60_000;
const DEFAULT_ROLLBACK_RETENTION_MS = 7 * 24 * 60 * 60_000;
const ACTIVE_HANDOFF_RETRY_MS = 60 * 60_000;
const ORPHAN_BLOB_GRACE_MS = 60 * 60_000;
const GC_LOCK_TIMEOUT_MS = 1_000;
const GC_STATEMENT_TIMEOUT_MS = 30_000;
const ACTIVE_HANDOFF_STATES = new Set([
  'requested',
  'draining',
  'transforming',
  'hydrating',
  'validating',
  'promoting',
  'activating',
]);
const COLLECTIBLE_REVISION_STATES = new Set(['staging', 'failed', 'retired']);

function boundedInteger(input: {
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

function numericRevisionId(value: number | string | null): number | null {
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const candidate = Reflect.get(error, 'code');
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim().slice(0, 100);
    }
    const name = Reflect.get(error, 'name');
    if (typeof name === 'string' && name.trim()) {
      return name.trim().slice(0, 100);
    }
  }
  return 'whatsapp_session_gc_error';
}

/**
 * Bounded, manager-only collector for terminal canonical WhatsApp revisions.
 *
 * Claims are committed before any session lock is taken. Processing then uses
 * the same lock order as lifecycle operations (session -> revision -> handoff
 * -> artifact -> queue), avoiding a queue/session lock inversion with the
 * revision-status enqueue trigger.
 */
@singleton()
export class WhatsappSessionGarbageCollectorService {
  private readonly batchSize: number;
  private readonly artifactBlobBatchSize: number;
  private readonly claimTtlMs: number;
  private readonly retryDelayMs: number;
  private readonly rollbackRetentionMs: number;
  private readonly profileArtifactBatchSize: number;
  private readonly profileArtifactRetentionMs: number;
  private running = false;

  constructor(
    @inject('DatabasePoolRw') private readonly pool: Pool,
    @inject('WhatsappSessionGarbageCollectorOptions', { isOptional: true })
    options: WhatsappSessionGarbageCollectorOptions = {}
  ) {
    this.batchSize = boundedInteger({
      value: options.batchSize,
      fallback: DEFAULT_BATCH_SIZE,
      minimum: 1,
      maximum: 100,
    });
    this.artifactBlobBatchSize = boundedInteger({
      value: options.artifactBlobBatchSize,
      fallback: DEFAULT_ARTIFACT_BLOB_BATCH_SIZE,
      minimum: 1,
      maximum: 1_000,
    });
    this.claimTtlMs = boundedInteger({
      value: options.claimTtlMs,
      fallback: DEFAULT_CLAIM_TTL_MS,
      minimum: 60_000,
      maximum: 60 * 60_000,
    });
    this.retryDelayMs = boundedInteger({
      value: options.retryDelayMs,
      fallback: DEFAULT_RETRY_DELAY_MS,
      minimum: 60_000,
      maximum: 24 * 60 * 60_000,
    });
    this.rollbackRetentionMs = boundedInteger({
      value: options.rollbackRetentionMs,
      fallback: DEFAULT_ROLLBACK_RETENTION_MS,
      minimum: 24 * 60 * 60_000,
      maximum: 30 * 24 * 60 * 60_000,
    });
    this.profileArtifactBatchSize = boundedInteger({
      value: options.profileArtifactBatchSize,
      fallback: DEFAULT_PROFILE_ARTIFACT_BATCH_SIZE,
      minimum: 1,
      maximum: 500,
    });
    this.profileArtifactRetentionMs = boundedInteger({
      value: options.profileArtifactRetentionMs,
      fallback: DEFAULT_PROFILE_ARTIFACT_RETENTION_MS,
      minimum: 60 * 60_000,
      maximum: 30 * 24 * 60 * 60_000,
    });
  }

  collectOnce = async (): Promise<WhatsappSessionGarbageCollectionResult> => {
    const result: WhatsappSessionGarbageCollectionResult = {
      claimed: 0,
      deletedRevisions: 0,
      deletedArtifactBlobs: 0,
      deferred: 0,
      staleQueueRows: 0,
      recoveredClaims: 0,
      profileArtifactsScanned: 0,
      deletedProfileArtifacts: 0,
      deferredProfileArtifacts: 0,
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
      result.recoveredClaims = await this.recoverExpiredClaims();
      const claims = await this.claimBatch(claimToken);
      result.claimed = claims.length;

      this.debug('gc_batch_claimed', {
        claimed: claims.length,
        recovered_claims: result.recoveredClaims,
      });

      for (const claim of claims) {
        try {
          const processed = await this.processClaim(claim, claimToken);
          result.deletedArtifactBlobs += processed.deletedArtifactBlobs;
          if (processed.outcome === 'deleted') {
            result.deletedRevisions += 1;
          } else if (processed.outcome === 'deferred') {
            result.deferred += 1;
          } else if (processed.outcome === 'stale_queue_removed') {
            result.staleQueueRows += 1;
          }
        } catch (error) {
          result.errors += 1;
          const code = errorCode(error);
          await this.deferFailedClaim(claim, claimToken, code);
          this.debug('gc_revision_error', {
            session_id: claim.session_id,
            revision_id: Number(claim.revision_id),
            error_code: code,
          });
        }
      }

      try {
        const profileArtifacts = await this.listExpiredProfileArtifacts();
        result.profileArtifactsScanned = profileArtifacts.length;
        for (const candidate of profileArtifacts) {
          try {
            const processed = await this.processProfileArtifact(candidate);
            result.deletedArtifactBlobs += processed.deletedArtifactBlobs;
            result.deletedProfileArtifacts += Number(processed.deleted);
            result.deferredProfileArtifacts += Number(!processed.deleted);
          } catch (error) {
            result.errors += 1;
            this.debug('gc_wwebjs_profile_artifact_error', {
              session_id: candidate.session_id,
              revision_id: Number(candidate.revision_id),
              artifact_id: candidate.artifact_id,
              error_code: errorCode(error),
            });
          }
        }
      } catch (error) {
        result.errors += 1;
        this.debug('gc_wwebjs_profile_artifact_scan_error', {
          error_code: errorCode(error),
        });
      }

      // A revision delete cascades its queue row. Sweep content-addressed
      // blobs independently so a session with more than one blob batch never
      // loses its continuation signal when that revision row disappears.
      try {
        result.deletedArtifactBlobs +=
          await this.sweepOrphanArtifactBlobsGlobally();
      } catch (error) {
        result.errors += 1;
        this.debug('gc_orphan_blob_sweep_error', {
          error_code: errorCode(error),
        });
      }

      this.debug('gc_batch_completed', {
        duration_ms: Date.now() - startedAt,
        claimed: result.claimed,
        deleted_revisions: result.deletedRevisions,
        deleted_artifact_blobs: result.deletedArtifactBlobs,
        deferred: result.deferred,
        stale_queue_rows: result.staleQueueRows,
        profile_artifacts_scanned: result.profileArtifactsScanned,
        deleted_profile_artifacts: result.deletedProfileArtifacts,
        deferred_profile_artifacts: result.deferredProfileArtifacts,
        errors: result.errors,
      });
      return result;
    } finally {
      this.running = false;
    }
  };

  private async listExpiredProfileArtifacts(): Promise<
    WhatsappWwebjsProfileArtifactGcCandidate[]
  > {
    const candidates =
      await this.pool.query<WhatsappWwebjsProfileArtifactGcCandidate>(
        `SELECT artifact.session_id,
                artifact.revision_id,
                artifact.artifact_id
           FROM whatsapp_artifact AS artifact
           LEFT JOIN whatsapp_wwebjs_profile_anchor AS anchor
             ON anchor.session_id = artifact.session_id
            AND anchor.revision_id = artifact.revision_id
            AND anchor.artifact_id = artifact.artifact_id
          WHERE artifact.provider = 'wwebjs'
            AND artifact.kind = 'wwebjs_profile'
            AND artifact.status = 'retired'
            AND (
              (
                anchor.state = 'previous'
                AND anchor.retain_until <= statement_timestamp()
              )
              OR (
                anchor.session_id IS NULL
                AND COALESCE(artifact.persisted_at, artifact.created_at)
                    <= statement_timestamp()
                       - ($2::double precision * interval '1 millisecond')
              )
            )
          ORDER BY COALESCE(
                     anchor.retain_until,
                     artifact.persisted_at,
                     artifact.created_at
                   ),
                   artifact.session_id,
                   artifact.revision_id,
                   artifact.artifact_id
          LIMIT $1`,
        [this.profileArtifactBatchSize, this.profileArtifactRetentionMs]
      );
    return candidates.rows;
  }

  private async processProfileArtifact(
    candidate: WhatsappWwebjsProfileArtifactGcCandidate
  ): Promise<{ deleted: boolean; deletedArtifactBlobs: number }> {
    const revisionId = numericRevisionId(candidate.revision_id);
    if (revisionId === null) {
      throw new Error('invalid WWebJS profile artifact GC revision id');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('lock_timeout', $1, true),
                set_config('statement_timeout', $2, true)`,
        [`${GC_LOCK_TIMEOUT_MS}ms`, `${GC_STATEMENT_TIMEOUT_MS}ms`]
      );

      const session = await client.query(
        `SELECT session.session_id
           FROM whatsapp_session AS session
          WHERE session.session_id = $1::uuid
          FOR UPDATE OF session`,
        [candidate.session_id]
      );
      if (session.rowCount !== 1) {
        await client.query('COMMIT');
        return { deleted: false, deletedArtifactBlobs: 0 };
      }

      const revision = await client.query(
        `SELECT revision.revision_id
           FROM whatsapp_session_revision AS revision
          WHERE revision.session_id = $1::uuid
            AND revision.revision_id = $2::bigint
          FOR UPDATE OF revision`,
        [candidate.session_id, revisionId]
      );
      if (revision.rowCount !== 1) {
        await client.query('COMMIT');
        return { deleted: false, deletedArtifactBlobs: 0 };
      }

      const handoffs = await client.query<{
        pre_activation_artifact_id: string | null;
      }>(
        `SELECT handoff.pre_activation_artifact_id
           FROM whatsapp_session_handoff AS handoff
          WHERE handoff.session_id = $1::uuid
            AND (
              handoff.source_revision_id = $2::bigint
              OR handoff.target_revision_id = $2::bigint
              OR handoff.pre_activation_artifact_id = $3::uuid
            )
          ORDER BY handoff.handoff_id
          FOR UPDATE OF handoff`,
        [candidate.session_id, revisionId, candidate.artifact_id]
      );
      if (
        handoffs.rows.some(
          (handoff) =>
            handoff.pre_activation_artifact_id === candidate.artifact_id
        )
      ) {
        await client.query('COMMIT');
        return { deleted: false, deletedArtifactBlobs: 0 };
      }

      const anchorResult = await client.query<WhatsappWwebjsProfileAnchorGcRow>(
        `SELECT anchor.state,
                  anchor.retain_until,
                  statement_timestamp() AS database_now
             FROM whatsapp_wwebjs_profile_anchor AS anchor
            WHERE anchor.session_id = $1::uuid
              AND anchor.revision_id = $2::bigint
              AND anchor.artifact_id = $3::uuid
            FOR UPDATE OF anchor`,
        [candidate.session_id, revisionId, candidate.artifact_id]
      );
      if ((anchorResult.rowCount ?? 0) > 1) {
        throw new Error('ambiguous WWebJS profile artifact anchor');
      }

      const artifactResult =
        await client.query<WhatsappWwebjsProfileArtifactGcRow>(
          `SELECT artifact.status,
                  artifact.provider,
                  artifact.kind,
                  COALESCE(artifact.persisted_at, artifact.created_at)
                    + ($4::double precision * interval '1 millisecond')
                      AS unanchored_eligible_at,
                  statement_timestamp() AS database_now
             FROM whatsapp_artifact AS artifact
            WHERE artifact.session_id = $1::uuid
              AND artifact.revision_id = $2::bigint
              AND artifact.artifact_id = $3::uuid
            FOR UPDATE OF artifact`,
          [
            candidate.session_id,
            revisionId,
            candidate.artifact_id,
            this.profileArtifactRetentionMs,
          ]
        );
      const artifact = artifactResult.rows[0];
      if (!artifact) {
        await client.query('COMMIT');
        return { deleted: false, deletedArtifactBlobs: 0 };
      }
      if (
        artifactResult.rowCount !== 1 ||
        artifact.provider !== 'wwebjs' ||
        artifact.kind !== 'wwebjs_profile' ||
        artifact.status !== 'retired'
      ) {
        await client.query('COMMIT');
        return { deleted: false, deletedArtifactBlobs: 0 };
      }

      const anchor = anchorResult.rows[0];
      const databaseNow = new Date(artifact.database_now).getTime();
      const eligible = anchor
        ? anchor.state === 'previous' &&
          anchor.retain_until !== null &&
          new Date(anchor.retain_until).getTime() <= databaseNow
        : new Date(artifact.unanchored_eligible_at).getTime() <= databaseNow;
      if (!eligible) {
        await client.query('COMMIT');
        return { deleted: false, deletedArtifactBlobs: 0 };
      }

      const deleted = await client.query(
        `DELETE FROM whatsapp_artifact AS artifact
          WHERE artifact.session_id = $1::uuid
            AND artifact.revision_id = $2::bigint
            AND artifact.artifact_id = $3::uuid
            AND artifact.provider = 'wwebjs'
            AND artifact.kind = 'wwebjs_profile'
            AND artifact.status = 'retired'
            AND (
              EXISTS (
                SELECT 1
                FROM whatsapp_wwebjs_profile_anchor AS expired_anchor
                WHERE expired_anchor.session_id = artifact.session_id
                  AND expired_anchor.revision_id = artifact.revision_id
                  AND expired_anchor.artifact_id = artifact.artifact_id
                  AND expired_anchor.state = 'previous'
                  AND expired_anchor.retain_until <= statement_timestamp()
              )
              OR (
                NOT EXISTS (
                  SELECT 1
                  FROM whatsapp_wwebjs_profile_anchor AS any_anchor
                  WHERE any_anchor.session_id = artifact.session_id
                    AND any_anchor.revision_id = artifact.revision_id
                    AND any_anchor.artifact_id = artifact.artifact_id
                )
                AND COALESCE(artifact.persisted_at, artifact.created_at)
                    <= statement_timestamp()
                       - ($4::double precision * interval '1 millisecond')
              )
            )
            AND NOT EXISTS (
              SELECT 1
              FROM whatsapp_session_handoff AS retained_handoff
              WHERE retained_handoff.session_id = artifact.session_id
                AND retained_handoff.pre_activation_artifact_id =
                    artifact.artifact_id
            )
        RETURNING artifact.artifact_id`,
        [
          candidate.session_id,
          revisionId,
          candidate.artifact_id,
          this.profileArtifactRetentionMs,
        ]
      );
      if (deleted.rowCount !== 1) {
        await client.query('COMMIT');
        return { deleted: false, deletedArtifactBlobs: 0 };
      }

      const deletedArtifactBlobs = await this.deleteOrphanArtifactBlobs(
        client,
        candidate.session_id
      );
      await client.query('COMMIT');
      this.debug('gc_wwebjs_profile_artifact_deleted', {
        session_id: candidate.session_id,
        revision_id: revisionId,
        artifact_id: candidate.artifact_id,
        deleted_artifact_blobs: deletedArtifactBlobs,
      });
      return { deleted: true, deletedArtifactBlobs };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async recoverExpiredClaims(): Promise<number> {
    const recovered = await this.pool.query(
      `WITH expired AS MATERIALIZED (
         SELECT queue.session_id, queue.revision_id
           FROM whatsapp_session_gc_queue AS queue
          WHERE queue.claim_token IS NOT NULL
            AND queue.claim_expires_at <= statement_timestamp()
          ORDER BY queue.claim_expires_at, queue.session_id, queue.revision_id
          LIMIT $1
          FOR UPDATE OF queue SKIP LOCKED
       )
       UPDATE whatsapp_session_gc_queue AS queue
          SET claim_token = NULL,
              claim_expires_at = NULL,
              updated_at = statement_timestamp()
         FROM expired
        WHERE queue.session_id = expired.session_id
          AND queue.revision_id = expired.revision_id`,
      [this.batchSize * 2]
    );
    return recovered.rowCount ?? 0;
  }

  private async claimBatch(
    claimToken: string
  ): Promise<WhatsappSessionGcClaim[]> {
    const claimed = await this.pool.query<WhatsappSessionGcClaim>(
      `WITH candidates AS MATERIALIZED (
         SELECT queue.session_id, queue.revision_id
           FROM whatsapp_session_gc_queue AS queue
          WHERE queue.claim_token IS NULL
            AND queue.eligible_at <= statement_timestamp()
          ORDER BY queue.eligible_at, queue.session_id, queue.revision_id
          LIMIT $1
          FOR UPDATE OF queue SKIP LOCKED
       )
       UPDATE whatsapp_session_gc_queue AS queue
          SET claim_token = $2::uuid,
              claim_expires_at = statement_timestamp()
                + ($3::double precision * interval '1 millisecond'),
              attempt_count = queue.attempt_count + 1,
              last_error_code = NULL,
              updated_at = statement_timestamp()
         FROM candidates
        WHERE queue.session_id = candidates.session_id
          AND queue.revision_id = candidates.revision_id
       RETURNING queue.session_id, queue.revision_id, queue.revision_status`,
      [this.batchSize, claimToken, this.claimTtlMs]
    );
    return claimed.rows;
  }

  private async processClaim(
    claim: WhatsappSessionGcClaim,
    claimToken: string
  ): Promise<{
    outcome: WhatsappSessionGcOutcome;
    deletedArtifactBlobs: number;
  }> {
    const revisionId = numericRevisionId(claim.revision_id);
    if (revisionId === null) {
      throw new Error('invalid whatsapp session GC revision id');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('lock_timeout', $1, true),
                set_config('statement_timeout', $2, true)`,
        [`${GC_LOCK_TIMEOUT_MS}ms`, `${GC_STATEMENT_TIMEOUT_MS}ms`]
      );

      const sessionResult = await client.query<WhatsappSessionGcSessionRow>(
        `SELECT session.state,
                session.active_revision_id,
                session.previous_revision_id
           FROM whatsapp_session AS session
          WHERE session.session_id = $1::uuid
          FOR UPDATE OF session`,
        [claim.session_id]
      );
      const session = sessionResult.rows[0];
      if (!session) {
        await this.deleteOwnedQueueRow(client, claim, claimToken);
        await client.query('COMMIT');
        return { outcome: 'stale_queue_removed', deletedArtifactBlobs: 0 };
      }

      const revisionResult = await client.query<WhatsappSessionGcRevisionRow>(
        `SELECT revision.status,
                queue.eligible_at,
                statement_timestamp() AS database_now
           FROM whatsapp_session_revision AS revision
           JOIN whatsapp_session_gc_queue AS queue
             ON queue.session_id = revision.session_id
            AND queue.revision_id = revision.revision_id
          WHERE revision.session_id = $1::uuid
            AND revision.revision_id = $2::bigint
            AND queue.claim_token = $3::uuid
          FOR UPDATE OF revision`,
        [claim.session_id, revisionId, claimToken]
      );
      const revision = revisionResult.rows[0];
      if (!revision) {
        await this.deleteOwnedQueueRow(client, claim, claimToken);
        await client.query('COMMIT');
        return { outcome: 'stale_queue_removed', deletedArtifactBlobs: 0 };
      }

      if (!COLLECTIBLE_REVISION_STATES.has(revision.status)) {
        await this.deleteOwnedQueueRow(client, claim, claimToken);
        await client.query('COMMIT');
        return { outcome: 'stale_queue_removed', deletedArtifactBlobs: 0 };
      }

      if (
        new Date(revision.eligible_at).getTime() >
        new Date(revision.database_now).getTime()
      ) {
        await this.releaseClaimAt(
          client,
          claim,
          claimToken,
          revision.eligible_at
        );
        await client.query('COMMIT');
        return { outcome: 'deferred', deletedArtifactBlobs: 0 };
      }

      const activeRevisionId = numericRevisionId(session.active_revision_id);
      const previousRevisionId = numericRevisionId(
        session.previous_revision_id
      );
      if (activeRevisionId === revisionId || session.state === 'handoff') {
        await this.releaseClaimAfter(
          client,
          claim,
          claimToken,
          ACTIVE_HANDOFF_RETRY_MS
        );
        await client.query('COMMIT');
        return { outcome: 'deferred', deletedArtifactBlobs: 0 };
      }

      const handoffs = await client.query<WhatsappSessionGcHandoffRow>(
        `SELECT handoff.state,
                handoff.recovery_state,
                COALESCE(
                  handoff.completed_at,
                  handoff.updated_at,
                  handoff.created_at
                ) + ($3::double precision * interval '1 millisecond')
                  AS protected_until,
                statement_timestamp() AS database_now
           FROM whatsapp_session_handoff AS handoff
          WHERE handoff.session_id = $1::uuid
            AND (
              handoff.source_revision_id = $2::bigint
              OR handoff.target_revision_id = $2::bigint
            )
          ORDER BY handoff.handoff_id
          FOR UPDATE OF handoff`,
        [claim.session_id, revisionId, this.rollbackRetentionMs]
      );

      if (
        handoffs.rows.some(
          (handoff) =>
            ACTIVE_HANDOFF_STATES.has(handoff.state) ||
            (handoff.state === 'failed' &&
              handoff.recovery_state !== 'completed' &&
              handoff.recovery_state !== 'cancelled' &&
              handoff.recovery_state !== 'blocked')
        )
      ) {
        await this.releaseClaimAfter(
          client,
          claim,
          claimToken,
          ACTIVE_HANDOFF_RETRY_MS
        );
        await client.query('COMMIT');
        return { outcome: 'deferred', deletedArtifactBlobs: 0 };
      }

      const protectedUntil = handoffs.rows.reduce<number | null>(
        (latest, handoff) => {
          const candidate = new Date(handoff.protected_until).getTime();
          const databaseNow = new Date(handoff.database_now).getTime();
          if (!Number.isFinite(candidate) || candidate <= databaseNow) {
            return latest;
          }
          return latest === null ? candidate : Math.max(latest, candidate);
        },
        null
      );
      if (protectedUntil !== null) {
        await this.releaseClaimAt(
          client,
          claim,
          claimToken,
          new Date(protectedUntil)
        );
        await client.query('COMMIT');
        return { outcome: 'deferred', deletedArtifactBlobs: 0 };
      }

      await client.query(
        `DELETE FROM whatsapp_session_handoff AS handoff
          WHERE handoff.session_id = $1::uuid
            AND (
              handoff.source_revision_id = $2::bigint
              OR handoff.target_revision_id = $2::bigint
            )
            AND handoff.state IN ('completed', 'failed')
            AND (
              handoff.state <> 'failed'
              OR handoff.recovery_state IN ('completed', 'cancelled', 'blocked')
            )
            AND COALESCE(
                  handoff.completed_at,
                  handoff.updated_at,
                  handoff.created_at
                ) <= statement_timestamp()
                  - ($3::double precision * interval '1 millisecond')`,
        [claim.session_id, revisionId, this.rollbackRetentionMs]
      );

      if (previousRevisionId === revisionId) {
        await client.query(
          `UPDATE whatsapp_session AS session
              SET previous_revision_id = NULL,
                  updated_at = statement_timestamp()
            WHERE session.session_id = $1::uuid
              AND session.previous_revision_id = $2::bigint`,
          [claim.session_id, revisionId]
        );
      }

      const deletedRevision = await client.query(
        `DELETE FROM whatsapp_session_revision AS revision
          WHERE revision.session_id = $1::uuid
            AND revision.revision_id = $2::bigint
            AND revision.status IN ('staging', 'failed', 'retired')
            AND EXISTS (
              SELECT 1
              FROM whatsapp_session_gc_queue AS queue
              WHERE queue.session_id = revision.session_id
                AND queue.revision_id = revision.revision_id
                AND queue.claim_token = $3::uuid
            )
            AND NOT EXISTS (
              SELECT 1
              FROM whatsapp_session AS session
              WHERE session.session_id = revision.session_id
                AND (
                  session.active_revision_id = revision.revision_id
                  OR session.previous_revision_id = revision.revision_id
                )
            )
            AND NOT EXISTS (
              SELECT 1
              FROM whatsapp_session_handoff AS handoff
              WHERE handoff.session_id = revision.session_id
                AND (
                  handoff.source_revision_id = revision.revision_id
                  OR handoff.target_revision_id = revision.revision_id
                )
            )
        RETURNING revision.revision_id`,
        [claim.session_id, revisionId, claimToken]
      );
      if ((deletedRevision.rowCount ?? 0) !== 1) {
        await this.releaseClaimAfter(
          client,
          claim,
          claimToken,
          ACTIVE_HANDOFF_RETRY_MS
        );
        await client.query('COMMIT');
        return { outcome: 'deferred', deletedArtifactBlobs: 0 };
      }

      const deletedArtifactBlobs = await this.deleteOrphanArtifactBlobs(
        client,
        claim.session_id
      );
      await client.query('COMMIT');

      this.debug('gc_revision_deleted', {
        session_id: claim.session_id,
        revision_id: revisionId,
        revision_status: revision.status,
        deleted_artifact_blobs: deletedArtifactBlobs,
      });
      return {
        outcome: 'deleted',
        deletedArtifactBlobs,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async deleteOrphanArtifactBlobs(
    client: PoolClient,
    sessionId: string
  ): Promise<number> {
    const deleted = await client.query(
      `WITH orphaned AS MATERIALIZED (
         SELECT blob.session_id, blob.sha256
           FROM whatsapp_artifact_blob AS blob
          WHERE blob.session_id = $1::uuid
            AND blob.created_at <= statement_timestamp()
              - ($3::double precision * interval '1 millisecond')
            AND NOT EXISTS (
              SELECT 1
              FROM whatsapp_artifact_chunk AS chunk
              WHERE chunk.session_id = blob.session_id
                AND chunk.sha256 = blob.sha256
            )
          ORDER BY blob.sha256
          LIMIT $2
          FOR UPDATE OF blob SKIP LOCKED
       )
       DELETE FROM whatsapp_artifact_blob AS blob
        USING orphaned
        WHERE blob.session_id = orphaned.session_id
          AND blob.sha256 = orphaned.sha256`,
      [sessionId, this.artifactBlobBatchSize, ORPHAN_BLOB_GRACE_MS]
    );
    return deleted.rowCount ?? 0;
  }

  private async sweepOrphanArtifactBlobsGlobally(): Promise<number> {
    const deleted = await this.pool.query(
      `WITH orphaned AS MATERIALIZED (
         SELECT blob.session_id, blob.sha256
           FROM whatsapp_artifact_blob AS blob
          WHERE blob.created_at <= statement_timestamp()
                  - ($2::double precision * interval '1 millisecond')
            AND NOT EXISTS (
              SELECT 1
              FROM whatsapp_artifact_chunk AS chunk
              WHERE chunk.session_id = blob.session_id
                AND chunk.sha256 = blob.sha256
            )
          ORDER BY blob.created_at, blob.session_id, blob.sha256
          LIMIT $1
          FOR UPDATE OF blob SKIP LOCKED
       )
       DELETE FROM whatsapp_artifact_blob AS blob
        USING orphaned
        WHERE blob.session_id = orphaned.session_id
          AND blob.sha256 = orphaned.sha256`,
      [this.artifactBlobBatchSize, ORPHAN_BLOB_GRACE_MS]
    );
    return deleted.rowCount ?? 0;
  }

  private async deleteOwnedQueueRow(
    client: PoolClient,
    claim: WhatsappSessionGcClaim,
    claimToken: string
  ): Promise<void> {
    await client.query(
      `DELETE FROM whatsapp_session_gc_queue AS queue
        WHERE queue.session_id = $1::uuid
          AND queue.revision_id = $2::bigint
          AND queue.claim_token = $3::uuid`,
      [claim.session_id, claim.revision_id, claimToken]
    );
  }

  private async releaseClaimAt(
    client: PoolClient,
    claim: WhatsappSessionGcClaim,
    claimToken: string,
    eligibleAt: Date | string
  ): Promise<void> {
    await client.query(
      `UPDATE whatsapp_session_gc_queue AS queue
          SET eligible_at = GREATEST($4::timestamptz, statement_timestamp()),
              claim_token = NULL,
              claim_expires_at = NULL,
              updated_at = statement_timestamp()
        WHERE queue.session_id = $1::uuid
          AND queue.revision_id = $2::bigint
          AND queue.claim_token = $3::uuid`,
      [claim.session_id, claim.revision_id, claimToken, eligibleAt]
    );
  }

  private async releaseClaimAfter(
    client: PoolClient,
    claim: WhatsappSessionGcClaim,
    claimToken: string,
    delayMs: number
  ): Promise<void> {
    await client.query(
      `UPDATE whatsapp_session_gc_queue AS queue
          SET eligible_at = statement_timestamp()
                + ($4::double precision * interval '1 millisecond'),
              claim_token = NULL,
              claim_expires_at = NULL,
              updated_at = statement_timestamp()
        WHERE queue.session_id = $1::uuid
          AND queue.revision_id = $2::bigint
          AND queue.claim_token = $3::uuid`,
      [claim.session_id, claim.revision_id, claimToken, delayMs]
    );
  }

  private async deferFailedClaim(
    claim: WhatsappSessionGcClaim,
    claimToken: string,
    code: string
  ): Promise<void> {
    await this.pool.query(
      `UPDATE whatsapp_session_gc_queue AS queue
          SET eligible_at = statement_timestamp()
                + ($4::double precision * interval '1 millisecond'),
              claim_token = NULL,
              claim_expires_at = NULL,
              last_error_code = $5,
              updated_at = statement_timestamp()
        WHERE queue.session_id = $1::uuid
          AND queue.revision_id = $2::bigint
          AND queue.claim_token = $3::uuid`,
      [claim.session_id, claim.revision_id, claimToken, this.retryDelayMs, code]
    );
  }

  private debug(stage: string, fields: Record<string, unknown>): void {
    console.log(
      `[whatsapp-session-debug] ${JSON.stringify({
        provider: 'manager',
        stage,
        ...fields,
      })}`
    );
  }
}
