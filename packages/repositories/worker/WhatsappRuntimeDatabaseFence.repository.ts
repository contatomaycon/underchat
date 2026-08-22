import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import type { Transaction } from '@core/common/types/Transaction.type';
import { worker, workerRuntime } from '@core/models';
import { and, eq, isNull, notInArray, sql } from 'drizzle-orm';

export interface WhatsappRuntimeDatabaseFence {
  account_id: string;
  worker_id: string;
  source_provider: string;
  runtime_generation: number;
  connection_epoch: string;
}

export interface WhatsappRuntimeDatabaseFenceActivation extends WhatsappRuntimeDatabaseFence {
  connection_attempt_id?: string;
}

export interface WhatsappRuntimeDatabaseFenceActivationResult {
  connection_sequence: number;
  already_active: boolean;
}

const PROVIDER_WORKER_TYPE = {
  baileys: EWorkerType.baileys,
  wwebjs: EWorkerType.wwebjs,
  whatsmeow: EWorkerType.whatsmeow,
} as const satisfies Record<string, EWorkerType>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CONTAINER_ID_PATTERN = /^[0-9a-f]{12,64}$/iu;

interface WhatsappPairingActivationGrantRow {
  connection_attempt_id?: string;
  expected_connection_epoch?: string | null;
  authorized_connection_epoch?: string;
  connection_sequence_at_grant?: number | string;
  grant_live?: boolean;
  consumed_at?: string | null;
}

interface WhatsappRuntimeActivationSnapshot {
  runtime_generation: number;
  connection_epoch: string | null;
  connection_sequence: number;
  source_provider: string | null;
  disconnected_connection_epoch: string | null;
  connection_disconnected_at: string | null;
  container_id: string;
  session_storage: string;
  runtime_capability_hash: string | null;
  session_writer_epoch: string | null;
}

export class StaleWhatsappRuntimeDatabaseFenceError extends Error {
  public readonly reason = 'whatsapp_runtime_database_fence_stale' as const;

  constructor() {
    super('WhatsApp runtime database fence is stale');
    this.name = 'StaleWhatsappRuntimeDatabaseFenceError';
  }
}

function normalizeFence(
  input: WhatsappRuntimeDatabaseFence
): WhatsappRuntimeDatabaseFence | null {
  const accountId = input.account_id?.trim();
  const workerId = input.worker_id?.trim();
  const sourceProvider = input.source_provider?.trim().toLowerCase();
  const runtimeGeneration = Number(input.runtime_generation);
  const connectionEpoch = input.connection_epoch?.trim();

  if (
    !accountId ||
    !UUID_PATTERN.test(accountId) ||
    !workerId ||
    !UUID_PATTERN.test(workerId) ||
    !connectionEpoch ||
    !UUID_PATTERN.test(connectionEpoch) ||
    !Object.prototype.hasOwnProperty.call(
      PROVIDER_WORKER_TYPE,
      sourceProvider
    ) ||
    !Number.isSafeInteger(runtimeGeneration) ||
    runtimeGeneration <= 0
  ) {
    return null;
  }

  return {
    account_id: accountId,
    worker_id: workerId,
    source_provider: sourceProvider,
    runtime_generation: runtimeGeneration,
    connection_epoch: connectionEpoch,
  };
}

function isExactPendingGrantActivation(
  grant: WhatsappPairingActivationGrantRow,
  fence: WhatsappRuntimeDatabaseFence,
  current: WhatsappRuntimeActivationSnapshot,
  connectionAttemptId: string | undefined
): boolean {
  return (
    grant.grant_live === true &&
    Boolean(connectionAttemptId) &&
    grant.connection_attempt_id === connectionAttemptId &&
    grant.authorized_connection_epoch === fence.connection_epoch &&
    (grant.expected_connection_epoch ?? null) ===
      (current.connection_epoch ?? null) &&
    Number(grant.connection_sequence_at_grant) === current.connection_sequence
  );
}

function isExactPendingGrantCompletion(
  grant: WhatsappPairingActivationGrantRow,
  fence: WhatsappRuntimeDatabaseFence,
  current: WhatsappRuntimeActivationSnapshot,
  connectionAttemptId: string | undefined,
  exactDisconnectBarrier: boolean
): boolean {
  return (
    !exactDisconnectBarrier &&
    Boolean(connectionAttemptId) &&
    grant.connection_attempt_id === connectionAttemptId &&
    grant.authorized_connection_epoch === fence.connection_epoch &&
    current.connection_epoch === fence.connection_epoch &&
    current.source_provider === fence.source_provider &&
    current.connection_sequence ===
      Number(grant.connection_sequence_at_grant) + 1
  );
}

async function inspectPairingSessionReadinessInTransaction(
  tx: Transaction,
  fence: WhatsappRuntimeDatabaseFence,
  current: WhatsappRuntimeActivationSnapshot,
  exactDisconnectBarrier: boolean
): Promise<boolean> {
  if (current.session_storage !== 'postgres') {
    return true;
  }

  await tx.execute(sql`
    SELECT set_config('app.whatsapp_session_id', ${fence.worker_id}, true)
  `);
  const sessionLock = await tx.execute(sql`
    SELECT session.session_id
    FROM public.whatsapp_session AS session
    WHERE session.session_id = ${fence.worker_id}::uuid
    FOR SHARE
  `);
  const sessionFound = (sessionLock.rowCount ?? 0) === 1;

  const sessionResult = await tx.execute(sql`
    SELECT session.state,
           session.provider,
           session.generation,
           session.epoch::text AS epoch,
           session.capability_hash,
           session.active_revision_id,
           session.previous_revision_id,
           session.active_device_fingerprint,
           session.active_device_fingerprint_version,
           session.last_persisted_at,
           session.last_error_at,
           NOT EXISTS (
             SELECT 1 FROM public.whatsapp_session_revision
             WHERE session_id = ${fence.worker_id}::uuid
           ) AND NOT EXISTS (
             SELECT 1 FROM public.whatsapp_companion_reservation
             WHERE session_id = ${fence.worker_id}::uuid
           ) AND NOT EXISTS (
             SELECT 1 FROM public.whatsapp_session_handoff
             WHERE session_id = ${fence.worker_id}::uuid
           ) AND NOT EXISTS (
             SELECT 1 FROM public.whatsapp_session_gc_queue
             WHERE session_id = ${fence.worker_id}::uuid
           ) AND NOT EXISTS (
             SELECT 1 FROM public.whatsapp_provider_record
             WHERE session_id = ${fence.worker_id}::uuid
           ) AND NOT EXISTS (
             SELECT 1 FROM public.whatsapp_artifact
             WHERE session_id = ${fence.worker_id}::uuid
           ) AND NOT EXISTS (
             SELECT 1 FROM public.whatsapp_wwebjs_profile_anchor
             WHERE session_id = ${fence.worker_id}::uuid
           ) AND NOT EXISTS (
             SELECT 1 FROM public.whatsapp_artifact_chunk
             WHERE session_id = ${fence.worker_id}::uuid
           ) AND NOT EXISTS (
             SELECT 1 FROM public.whatsapp_artifact_blob
             WHERE session_id = ${fence.worker_id}::uuid
           ) AS operational_tree_empty,
           session.state = 'preparing'
             AND session.provider = 'baileys'
             AND session.active_revision_id IS NOT NULL
             AND session.previous_revision_id IS NULL
             AND session.active_device_fingerprint IS NULL
             AND session.active_device_fingerprint_version IS NULL
             AND session.last_error_at IS NULL
             AND (SELECT count(*) FROM public.whatsapp_session_revision
                   WHERE session_id = ${fence.worker_id}::uuid) = 1
             AND (SELECT count(*) FROM public.whatsapp_companion_reservation
                   WHERE session_id = ${fence.worker_id}::uuid) = 0
             AND (SELECT count(*) FROM public.whatsapp_session_handoff
                   WHERE session_id = ${fence.worker_id}::uuid) = 0
             AND (SELECT count(*) FROM public.whatsapp_session_gc_queue
                   WHERE session_id = ${fence.worker_id}::uuid) <= 1
             AND (SELECT count(*) FROM public.whatsapp_provider_record
                   WHERE session_id = ${fence.worker_id}::uuid) <= 1
             AND NOT EXISTS (
               SELECT 1 FROM public.whatsapp_provider_record
               WHERE session_id = ${fence.worker_id}::uuid
                 AND namespace <> 'baileys/creds'
             )
             AND (SELECT count(*) FROM public.whatsapp_device
                   WHERE session_id = ${fence.worker_id}::uuid) <= 1
             AND NOT EXISTS (
               SELECT 1 FROM public.whatsapp_artifact
               WHERE session_id = ${fence.worker_id}::uuid
             )
             AND NOT EXISTS (
               SELECT 1 FROM public.whatsapp_wwebjs_profile_anchor
               WHERE session_id = ${fence.worker_id}::uuid
             )
             AND NOT EXISTS (
               SELECT 1 FROM public.whatsapp_artifact_chunk
               WHERE session_id = ${fence.worker_id}::uuid
             )
             AND NOT EXISTS (
               SELECT 1 FROM public.whatsapp_artifact_blob
               WHERE session_id = ${fence.worker_id}::uuid
             )
             AND EXISTS (
               SELECT 1
               FROM public.whatsapp_session_revision AS revision
               WHERE revision.session_id = session.session_id
                 AND revision.revision_id = session.active_revision_id
                 AND revision.provider = 'baileys'
                 AND revision.status = 'staging'
                 AND revision.source = 'pairing'
                 AND revision.writer_generation = ${fence.runtime_generation}
                 AND revision.writer_epoch =
                   ${current.session_writer_epoch}::uuid
                 AND revision.capability_hash =
                   ${current.runtime_capability_hash}
                 AND NOT EXISTS (
                   SELECT 1
                   FROM public.whatsapp_device AS device
                   WHERE device.session_id = revision.session_id
                     AND device.revision_id = revision.revision_id
                     AND (
                       device.jid IS NOT NULL
                       OR device.device_fingerprint IS NOT NULL
                       OR device.registration_id IS NOT NULL
                       OR device.noise_key IS NOT NULL
                       OR device.identity_key IS NOT NULL
                       OR device.signed_pre_key IS NOT NULL
                       OR device.signed_pre_key_sig IS NOT NULL
                     )
                 )
             ) AS resumable_pairing_draft
    FROM public.whatsapp_session AS session
    WHERE session.session_id = ${fence.worker_id}::uuid
  `);
  const session = (
    sessionResult as unknown as {
      rows?: Array<{
        state?: string;
        provider?: string;
        generation?: number | string;
        epoch?: string | null;
        capability_hash?: string | null;
        active_revision_id?: number | string | null;
        previous_revision_id?: number | string | null;
        active_device_fingerprint?: Buffer | null;
        active_device_fingerprint_version?: string | null;
        last_persisted_at?: string | null;
        last_error_at?: string | null;
        operational_tree_empty?: boolean;
        resumable_pairing_draft?: boolean;
      }>;
    }
  ).rows?.[0];
  const canonicalHeaderMatches =
    Boolean(session) &&
    session?.provider === fence.source_provider &&
    Number(session?.generation) === fence.runtime_generation &&
    (session?.epoch ?? null) === current.session_writer_epoch &&
    (session?.capability_hash ?? null) === current.runtime_capability_hash;
  const canonicalHeaderEmpty =
    canonicalHeaderMatches &&
    (session?.state === 'empty' || session?.state === 'preparing') &&
    session?.operational_tree_empty === true &&
    (session?.active_revision_id ?? null) === null &&
    (session?.previous_revision_id ?? null) === null &&
    (session?.active_device_fingerprint ?? null) === null &&
    (session?.active_device_fingerprint_version ?? null) === null &&
    (session?.last_persisted_at ?? null) === null &&
    (session?.last_error_at ?? null) === null;
  const resumablePairingDraft =
    canonicalHeaderMatches && session?.resumable_pairing_draft === true;

  const leaseResult = await tx.execute(sql`
    SELECT lease.fencing_token,
           lease.generation,
           lease.owner_id::text AS owner_id,
           lease.provider,
           lease.epoch::text AS epoch,
           lease.owner_id IS NULL
             AND lease.provider IS NULL
             AND lease.epoch IS NULL
             AND lease.expires_at IS NULL AS lease_released,
           lease.owner_id IS NOT NULL
             AND lease.expires_at <= clock_timestamp() AS lease_expired,
           lease.owner_id IS NOT NULL
             AND lease.expires_at > clock_timestamp() AS lease_live
    FROM public.whatsapp_session_lease AS lease
    WHERE lease.session_id = ${fence.worker_id}::uuid
    FOR UPDATE
  `);
  const lease = (
    leaseResult as unknown as {
      rows?: Array<{
        fencing_token?: number | string;
        generation?: number | string;
        owner_id?: string | null;
        provider?: string | null;
        epoch?: string | null;
        lease_released?: boolean;
        lease_expired?: boolean;
        lease_live?: boolean;
      }>;
    }
  ).rows?.[0];
  const matchingOwnedLease =
    Boolean(lease?.owner_id) &&
    lease?.provider === fence.source_provider &&
    (lease?.epoch ?? null) === current.session_writer_epoch;
  const leaseSafe =
    Boolean(lease) &&
    Number(lease?.fencing_token) > 0 &&
    Number(lease?.generation) === fence.runtime_generation &&
    (lease?.lease_released === true ||
      (matchingOwnedLease &&
        (lease?.lease_expired === true ||
          (!exactDisconnectBarrier && lease?.lease_live === true))));
  return (
    sessionFound && (canonicalHeaderEmpty || resumablePairingDraft) && leaseSafe
  );
}

async function consumePendingGrantInTransaction(
  tx: Transaction,
  fence: WhatsappRuntimeDatabaseFence,
  current: WhatsappRuntimeActivationSnapshot,
  grant: WhatsappPairingActivationGrantRow,
  connectionAttemptId: string,
  allowExpiredCompletion: boolean
): Promise<void> {
  const consumed = await tx.execute(sql`
    UPDATE public.whatsapp_pairing_activation_grant AS activation_grant
    SET consumed_at = clock_timestamp()
    WHERE activation_grant.connection_attempt_id = ${connectionAttemptId}::uuid
      AND activation_grant.worker_id = ${fence.worker_id}::uuid
      AND activation_grant.account_id = ${fence.account_id}::uuid
      AND activation_grant.provider = ${fence.source_provider}
      AND activation_grant.runtime_generation = ${fence.runtime_generation}
      AND activation_grant.container_id = ${current.container_id}
      AND activation_grant.expected_connection_epoch IS NOT DISTINCT FROM
        ${grant.expected_connection_epoch ?? null}
      AND activation_grant.authorized_connection_epoch =
        ${fence.connection_epoch}::uuid
      AND activation_grant.connection_sequence_at_grant =
        ${Number(grant.connection_sequence_at_grant)}
      AND activation_grant.consumed_at IS NULL
      AND activation_grant.revoked_at IS NULL
      AND (
        ${allowExpiredCompletion}
        OR activation_grant.expires_at > clock_timestamp()
      )
  `);
  if ((consumed.rowCount ?? 0) !== 1) {
    throw new StaleWhatsappRuntimeDatabaseFenceError();
  }
}

/**
 * Serializes durable runtime/connection changes with a PostgreSQL mutation.
 * `FOR SHARE` allows current events to run concurrently across service pods,
 * while conflicting with worker/runtime UPDATE and DELETE operations until
 * the guarded domain mutation commits.
 */
export async function assertCurrentWhatsappRuntimeInTransaction(
  tx: Transaction,
  input: WhatsappRuntimeDatabaseFence
): Promise<void> {
  const fence = normalizeFence(input);
  if (!fence) {
    throw new StaleWhatsappRuntimeDatabaseFenceError();
  }

  const expectedWorkerType =
    PROVIDER_WORKER_TYPE[
      fence.source_provider as keyof typeof PROVIDER_WORKER_TYPE
    ];
  const workerRows = await tx
    .select({ worker_id: worker.worker_id })
    .from(worker)
    .where(
      and(
        eq(worker.worker_id, fence.worker_id),
        eq(worker.account_id, fence.account_id),
        eq(worker.worker_type_id, expectedWorkerType),
        notInArray(worker.worker_status_id, [
          EWorkerStatus.deleting,
          EWorkerStatus.delete,
        ]),
        isNull(worker.deleted_at)
      )
    )
    .for('share')
    .limit(1)
    .execute();
  if (!workerRows[0]) {
    throw new StaleWhatsappRuntimeDatabaseFenceError();
  }

  const runtimeRows = await tx
    .select({
      runtime_generation: workerRuntime.runtime_generation,
      connection_epoch: workerRuntime.connection_epoch,
      disconnected_connection_epoch:
        workerRuntime.disconnected_connection_epoch,
      connection_disconnected_at: workerRuntime.connection_disconnected_at,
      source_provider: workerRuntime.source_provider,
    })
    .from(workerRuntime)
    .where(eq(workerRuntime.worker_id, fence.worker_id))
    .for('share')
    .limit(1)
    .execute();
  if (
    !runtimeRows[0] ||
    runtimeRows[0].runtime_generation !== fence.runtime_generation ||
    runtimeRows[0].connection_epoch !== fence.connection_epoch ||
    runtimeRows[0].source_provider !== fence.source_provider ||
    ((runtimeRows[0].connection_disconnected_at ?? null) !== null &&
      (runtimeRows[0].disconnected_connection_epoch ?? null) ===
        (runtimeRows[0].connection_epoch ?? null))
  ) {
    throw new StaleWhatsappRuntimeDatabaseFenceError();
  }
}

/**
 * Durably linearizes a provider connection before the matching Redis fence is
 * published. The worker row is locked first so provider/account changes use
 * the same lock order as guarded domain mutations. The runtime row is then
 * locked exclusively, which waits for already-running current mutations and
 * prevents any stale event waiting on the row from passing after activation.
 *
 * Repeating the exact epoch is idempotent and returns the same sequence. A new
 * epoch increments the database sequence; Redis uses that sequence to reject a
 * delayed publication from an older activation.
 */
export async function activateWhatsappRuntimeFenceInTransaction(
  tx: Transaction,
  input: WhatsappRuntimeDatabaseFenceActivation
): Promise<WhatsappRuntimeDatabaseFenceActivationResult> {
  const fence = normalizeFence(input);
  const connectionAttemptId = input.connection_attempt_id?.trim();
  if (
    !fence ||
    (input.connection_attempt_id !== undefined &&
      (!connectionAttemptId || !UUID_PATTERN.test(connectionAttemptId)))
  ) {
    throw new StaleWhatsappRuntimeDatabaseFenceError();
  }

  // The Redis activation lease is intentionally longer than these database
  // bounds. A stalled transaction must terminate before another pod can
  // acquire the activation lease and linearize a replacement epoch.
  await tx.execute(sql`SET LOCAL lock_timeout = '10s'`);
  await tx.execute(sql`SET LOCAL statement_timeout = '15s'`);

  const expectedWorkerType =
    PROVIDER_WORKER_TYPE[
      fence.source_provider as keyof typeof PROVIDER_WORKER_TYPE
    ];
  const workerRows = await tx
    .select({ worker_id: worker.worker_id })
    .from(worker)
    .where(
      and(
        eq(worker.worker_id, fence.worker_id),
        eq(worker.account_id, fence.account_id),
        eq(worker.worker_type_id, expectedWorkerType),
        notInArray(worker.worker_status_id, [
          EWorkerStatus.deleting,
          EWorkerStatus.delete,
        ]),
        isNull(worker.deleted_at)
      )
    )
    .for('share')
    .limit(1)
    .execute();
  if (!workerRows[0]) {
    throw new StaleWhatsappRuntimeDatabaseFenceError();
  }

  const runtimeRows = await tx
    .select({
      runtime_generation: workerRuntime.runtime_generation,
      connection_epoch: workerRuntime.connection_epoch,
      connection_sequence: workerRuntime.connection_sequence,
      source_provider: workerRuntime.source_provider,
      disconnected_connection_epoch:
        workerRuntime.disconnected_connection_epoch,
      connection_disconnected_at: workerRuntime.connection_disconnected_at,
      container_id: workerRuntime.container_id,
      session_storage: workerRuntime.session_storage,
      runtime_capability_hash: workerRuntime.runtime_capability_hash,
      session_writer_epoch: workerRuntime.session_writer_epoch,
    })
    .from(workerRuntime)
    .where(eq(workerRuntime.worker_id, fence.worker_id))
    .for('update')
    .limit(1)
    .execute();
  const current = runtimeRows[0];
  const currentContainerId = current?.container_id;
  if (
    !current ||
    current.runtime_generation !== fence.runtime_generation ||
    !currentContainerId ||
    !CONTAINER_ID_PATTERN.test(currentContainerId) ||
    (current.source_provider !== null &&
      current.source_provider !== fence.source_provider) ||
    !Number.isSafeInteger(current.connection_sequence) ||
    current.connection_sequence < 0
  ) {
    throw new StaleWhatsappRuntimeDatabaseFenceError();
  }
  const activeCurrent: WhatsappRuntimeActivationSnapshot = {
    ...current,
    container_id: currentContainerId,
  };
  const exactDisconnectBarrier =
    (current.connection_disconnected_at ?? null) !== null &&
    (current.connection_epoch ?? null) ===
      (current.disconnected_connection_epoch ?? null);

  // Keep the global lock order identical to the SQL activation boundary:
  // worker -> runtime -> canonical session -> lease -> pairing grant. The
  // readiness result is enforced only for a fresh pending activation. A
  // completion retry must still be able to consume its stranded marker after
  // the runtime epoch/sequence were durably advanced by an older deployment.
  const pairingSessionReady = await inspectPairingSessionReadinessInTransaction(
    tx,
    fence,
    activeCurrent,
    exactDisconnectBarrier
  );

  const grantResult = await tx.execute(sql`
    SELECT activation_grant.connection_attempt_id::text
             AS connection_attempt_id,
           activation_grant.expected_connection_epoch,
           activation_grant.authorized_connection_epoch::text
             AS authorized_connection_epoch,
           activation_grant.connection_sequence_at_grant,
           activation_grant.expires_at > clock_timestamp() AS grant_live,
           activation_grant.consumed_at,
           activation_grant.revoked_at
    FROM public.whatsapp_pairing_activation_grant AS activation_grant
    WHERE activation_grant.worker_id = ${fence.worker_id}::uuid
      AND activation_grant.account_id = ${fence.account_id}::uuid
      AND activation_grant.provider = ${fence.source_provider}
      AND activation_grant.runtime_generation = ${fence.runtime_generation}
      AND activation_grant.container_id IS NOT DISTINCT FROM
        ${current.container_id}
      AND activation_grant.revoked_at IS NULL
      AND (
        activation_grant.consumed_at IS NULL
        OR activation_grant.authorized_connection_epoch::text =
          ${current.connection_epoch}
      )
    ORDER BY activation_grant.consumed_at NULLS FIRST
    FOR UPDATE
  `);
  const grantRows =
    (
      grantResult as unknown as
        | {
            rows?: WhatsappPairingActivationGrantRow[];
          }
        | undefined
    )?.rows ?? [];
  const pendingGrant = grantRows.find(
    (grant) => (grant.consumed_at ?? null) === null
  );
  const ownedGrant = grantRows.find(
    (grant) =>
      (grant.consumed_at ?? null) !== null &&
      grant.authorized_connection_epoch === current.connection_epoch
  );

  if (pendingGrant) {
    const exactPendingActivation = isExactPendingGrantActivation(
      pendingGrant,
      fence,
      activeCurrent,
      connectionAttemptId
    );
    const exactPendingCompletion = isExactPendingGrantCompletion(
      pendingGrant,
      fence,
      activeCurrent,
      connectionAttemptId,
      exactDisconnectBarrier
    );
    if (!exactPendingActivation && !exactPendingCompletion) {
      throw new StaleWhatsappRuntimeDatabaseFenceError();
    }
    if (!connectionAttemptId) {
      throw new StaleWhatsappRuntimeDatabaseFenceError();
    }
    if (exactPendingCompletion) {
      await consumePendingGrantInTransaction(
        tx,
        fence,
        activeCurrent,
        pendingGrant,
        connectionAttemptId,
        true
      );
      return {
        connection_sequence: current.connection_sequence,
        already_active: true,
      };
    }
    if (!pairingSessionReady) {
      throw new StaleWhatsappRuntimeDatabaseFenceError();
    }
  } else if (ownedGrant) {
    if (
      fence.connection_epoch !== current.connection_epoch ||
      (connectionAttemptId !== undefined &&
        connectionAttemptId !== ownedGrant.connection_attempt_id)
    ) {
      throw new StaleWhatsappRuntimeDatabaseFenceError();
    }
  } else if (exactDisconnectBarrier || connectionAttemptId) {
    throw new StaleWhatsappRuntimeDatabaseFenceError();
  }

  if (
    current.connection_epoch === fence.connection_epoch &&
    current.source_provider === fence.source_provider &&
    current.connection_sequence > 0
  ) {
    return {
      connection_sequence: current.connection_sequence,
      already_active: true,
    };
  }

  const [activated] = await tx
    .update(workerRuntime)
    .set({
      connection_epoch: fence.connection_epoch,
      disconnected_connection_epoch: null,
      connection_disconnected_at: null,
      connection_sequence: sql`${workerRuntime.connection_sequence} + 1`,
      source_provider: fence.source_provider,
      connection_activated_at: sql`clock_timestamp()`,
      updated_at: sql`clock_timestamp()`,
    })
    .where(
      and(
        eq(workerRuntime.worker_id, fence.worker_id),
        eq(workerRuntime.runtime_generation, fence.runtime_generation)
      )
    )
    .returning({
      connection_sequence: workerRuntime.connection_sequence,
    })
    .execute();

  if (
    !activated ||
    !Number.isSafeInteger(activated.connection_sequence) ||
    activated.connection_sequence <= current.connection_sequence
  ) {
    throw new StaleWhatsappRuntimeDatabaseFenceError();
  }

  if (pendingGrant && connectionAttemptId) {
    await consumePendingGrantInTransaction(
      tx,
      fence,
      activeCurrent,
      pendingGrant,
      connectionAttemptId,
      false
    );
  }

  return {
    connection_sequence: activated.connection_sequence,
    already_active: false,
  };
}
