import * as schema from '@core/models';
import { whatsappSessionLease, worker, workerRuntime } from '@core/models';
import { IWorkerRuntime } from '@core/common/interfaces/IWorkerRuntime';
import type { IWhatsappConnectionStatus } from '@core/common/interfaces/IWhatsappConnectionStatus';
import { currentTime } from '@core/common/functions/currentTime';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import {
  and,
  eq,
  ExtractTablesWithRelations,
  isNull,
  lt,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import { PgTransaction } from 'drizzle-orm/pg-core';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import {
  activateWhatsappRuntimeFenceInTransaction,
  type WhatsappRuntimeDatabaseFenceActivation,
  type WhatsappRuntimeDatabaseFenceActivationResult,
} from './WhatsappRuntimeDatabaseFence.repository';

function isNullish(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CONTAINER_ID_PATTERN = /^[0-9a-f]{12,64}$/iu;

const WORKER_TYPE_BY_PROVIDER = {
  baileys: EWorkerType.baileys,
  wwebjs: EWorkerType.wwebjs,
  whatsmeow: EWorkerType.whatsmeow,
} as const;

const PAIRING_GRANTABLE_WORKER_STATUSES = new Set<string>([
  EWorkerStatus.disponible,
  EWorkerStatus.offline,
  EWorkerStatus.mismatched,
  EWorkerStatus.error,
]);

const PAIRING_RUNTIME_REATTACHABLE_WORKER_STATUSES = new Set<string>([
  EWorkerStatus.disponible,
  EWorkerStatus.offline,
  EWorkerStatus.mismatched,
  EWorkerStatus.error,
]);

type DatabaseTransaction = PgTransaction<
  NodePgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

function nativeProjectionSignalsOnline(value: unknown): boolean {
  if (typeof value === 'string') {
    try {
      return nativeProjectionSignalsOnline(JSON.parse(value));
    } catch {
      return false;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const projection = value as Record<string, unknown>;
  return (
    projection.status === 'online' ||
    projection.connected === true ||
    projection.sessionReady === true ||
    projection.session_ready === true
  );
}

export interface UpsertWorkerRuntimeInput {
  worker_id: string;
  container_id?: string | null;
  container_name?: string | null;
  session_storage?: EWorkerSessionStorage;
  session_volume_name: string | null;
  runtime_capability_hash?: string | null;
  session_writer_epoch?: string | null;
  runtime_generation?: number;
  warm_pool_id?: string | null;
  activated_at?: string | null;
}

export interface ReserveWorkerRuntimeGenerationInput {
  worker_id: string;
  container_name?: string | null;
  session_storage: EWorkerSessionStorage;
  session_volume_name: string | null;
  warm_pool_id?: string | null;
  minimum_runtime_generation?: number;
}

export interface PrepareWorkerRuntimeWriterIdentityInput {
  worker_id: string;
  runtime_generation: number;
  runtime_capability_hash: string;
  session_writer_epoch: string;
}

export interface MarkWorkerRecreateBootstrapStartedInput {
  worker_id: string;
  account_id: string;
  server_id: string;
  lifecycle_operation_id: string;
  runtime_generation: number;
  container_id: string;
}

export interface RecreatedWorkerUnavailableNativeTerminalProof {
  container_id: string;
  connection_status: IWhatsappConnectionStatus;
  connection_status_source_id: string;
  connection_status_sequence: number;
  connection_status_changed_at: string;
}

export interface RevokeFailedOnlineLivenessReplacementRuntimeInput {
  worker_id: string;
  account_id: string;
  server_id: string;
  worker_type_id: EWorkerType;
  lifecycle_operation_id: string;
  expected_old_container_id: string;
  expected_old_runtime_generation: number;
  failed_container_id: string;
  failed_runtime_generation: number;
}

export interface DeletePostgresWhatsappSessionInput {
  worker_id: string;
  account_id: string;
  lifecycle_operation_id: string;
  expected_worker_status_id: EWorkerStatus.recreating | EWorkerStatus.deleting;
  expected_runtime_generation: number | null;
  expected_container_id: string | null;
  /**
   * A destructive legacy-volume -> PostgreSQL reset may still have the exact
   * retired legacy runtime in worker_runtime after Docker cleanup. The
   * canonical PostgreSQL tree is nevertheless part of the discarded
   * connection and must be removed before the replacement generation starts.
   */
  expected_runtime_session_storage?: EWorkerSessionStorage;
  expected_session_volume_name?: string | null;
}

export interface FinalizeWorkerConnectionDisconnectInput {
  worker_id: string;
  account_id: string;
  expected_runtime_generation: number;
  expected_container_id: string | null;
  expected_connection_epoch: string | null;
}

export type PrepareWorkerConnectionDisconnectInput =
  FinalizeWorkerConnectionDisconnectInput;

export type PrepareWorkerConnectionDisconnectResult =
  | { status: 'prepared'; already_prepared: boolean }
  | {
      status: 'not_found' | 'lifecycle_active' | 'runtime_mismatch';
      lifecycle_operation_id?: string;
    };

export type FinalizeWorkerConnectionDisconnectResult =
  | {
      status: 'completed';
      worker_id: string;
      worker_status_id: EWorkerStatus.disponible;
      runtime_generation: number;
      container_id: string | null;
      worker_status_observed_at: string;
    }
  | {
      status:
        | 'not_found'
        | 'lifecycle_active'
        | 'runtime_mismatch'
        | 'session_not_empty'
        | 'session_fence_invalid';
      lifecycle_operation_id?: string;
    };

export interface PrepareWorkerConnectionPairingActivationInput extends FinalizeWorkerConnectionDisconnectInput {
  provider: 'baileys' | 'wwebjs' | 'whatsmeow';
  connection_attempt_id: string;
  authorized_connection_epoch: string;
  expires_at: string;
  /**
   * Exact Docker identity observed running immediately before this grant.
   * It is only used to repair a missing worker.container_id left by an
   * in-place session logout; it never authorizes replacing another identity.
   */
  verified_running_container_id?: string;
}

export type PrepareWorkerConnectionPairingActivationResult =
  | {
      status: 'granted';
      already_granted: boolean;
      worker_status_id: EWorkerStatus.disponible;
      worker_status_observed_at: string;
    }
  | {
      status:
        | 'not_found'
        | 'lifecycle_active'
        | 'runtime_mismatch'
        | 'terminal_state_invalid'
        | 'session_not_empty'
        | 'session_fence_invalid'
        | 'grant_conflict';
      lifecycle_operation_id?: string;
    };

export interface WorkerConnectionPairingActivationGrantIdentity {
  worker_id: string;
  account_id: string;
  provider: 'baileys' | 'wwebjs' | 'whatsmeow';
  runtime_generation: number;
  container_id: string;
  connection_attempt_id: string;
  authorized_connection_epoch: string;
}

interface ExistingWorkerConnectionPairingActivationGrant {
  worker_id?: number | string | null;
  account_id?: number | string | null;
  provider?: number | string | null;
  runtime_generation?: number | string | null;
  container_id?: number | string | null;
  expected_connection_epoch?: number | string | null;
  authorized_connection_epoch?: number | string | null;
  connection_sequence_at_grant?: number | string | null;
  expires_at?: number | string | null;
  grant_live?: boolean;
  consumed_at?: number | string | null;
  revoked_at?: number | string | null;
}

interface PairingActivationLeaseRow {
  owner_id?: string | null;
  provider?: string | null;
  fencing_token?: number | string;
  generation?: number | string;
  epoch?: string | null;
  expires_at?: string | null;
  lease_released?: boolean;
  lease_expired?: boolean;
  lease_live?: boolean;
}

interface PairingActivationSessionRow {
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
}

interface PairingActivationRevisionRow {
  revision_id?: number | string;
  provider?: string;
  status?: string;
  source?: string;
  writer_generation?: number | string;
  writer_epoch?: string | null;
  capability_hash?: string | null;
  devices?: number | string;
  identified_devices?: number | string;
  non_pairing_provider_records?: number | string;
}

type PairingActivationTreeRow = Record<string, number | string | null>;

interface PairingActivationCanonicalFence {
  provider: 'baileys' | 'wwebjs' | 'whatsmeow';
  runtime_generation: number;
  session_writer_epoch: string;
  runtime_capability_hash: string;
  no_disconnect_barrier: boolean;
  exact_disconnect_barrier: boolean;
}

function isPairingOperationalTreeEmpty(
  treeRow: PairingActivationTreeRow | undefined
): boolean {
  return (
    Boolean(treeRow) &&
    Object.values(treeRow ?? {}).every((value) => Number(value ?? 0) === 0)
  );
}

function isPairingCanonicalHeaderEmpty(
  sessionRow: PairingActivationSessionRow | undefined
): boolean {
  return (
    Boolean(sessionRow) &&
    (sessionRow?.state === 'empty' || sessionRow?.state === 'preparing') &&
    isNullish(sessionRow?.active_revision_id) &&
    isNullish(sessionRow?.previous_revision_id) &&
    isNullish(sessionRow?.active_device_fingerprint) &&
    isNullish(sessionRow?.active_device_fingerprint_version) &&
    isNullish(sessionRow?.last_persisted_at) &&
    isNullish(sessionRow?.last_error_at)
  );
}

function doesPairingCanonicalFenceMatch(
  sessionRow: PairingActivationSessionRow | undefined,
  fence: PairingActivationCanonicalFence
): boolean {
  return (
    sessionRow?.provider === fence.provider &&
    Number(sessionRow?.generation) === fence.runtime_generation &&
    (sessionRow?.epoch ?? null) === fence.session_writer_epoch &&
    (sessionRow?.capability_hash ?? null) === fence.runtime_capability_hash
  );
}

function isResumablePairingDraft(input: {
  session_row: PairingActivationSessionRow | undefined;
  revision_row: PairingActivationRevisionRow | undefined;
  tree_row: PairingActivationTreeRow | undefined;
  active_revision_id: number | string | null;
  canonical_fence_matches: boolean;
  fence: PairingActivationCanonicalFence;
}): boolean {
  const { session_row: sessionRow, revision_row: revisionRow } = input;
  const { tree_row: treeRow, fence } = input;
  const providerTreeMatches =
    fence.provider === 'baileys'
      ? Number(treeRow?.provider_records ?? 0) <= 1 &&
        Number(treeRow?.devices ?? 0) <= 1
      : Number(treeRow?.provider_records ?? 0) === 0 &&
        Number(treeRow?.devices ?? 0) === 0;
  return (
    input.canonical_fence_matches &&
    fence.no_disconnect_barrier &&
    sessionRow?.state === 'preparing' &&
    !isNullish(input.active_revision_id) &&
    isNullish(sessionRow?.previous_revision_id) &&
    isNullish(sessionRow?.active_device_fingerprint) &&
    isNullish(sessionRow?.active_device_fingerprint_version) &&
    isNullish(sessionRow?.last_error_at) &&
    Number(treeRow?.revisions ?? 0) === 1 &&
    Number(treeRow?.reservations ?? 0) === 0 &&
    Number(treeRow?.handoffs ?? 0) === 0 &&
    Number(treeRow?.gc_entries ?? 0) <= 1 &&
    providerTreeMatches &&
    Number(treeRow?.artifacts ?? 0) === 0 &&
    Number(treeRow?.profile_anchors ?? 0) === 0 &&
    Number(treeRow?.artifact_chunks ?? 0) === 0 &&
    Number(treeRow?.artifact_blobs ?? 0) === 0 &&
    Number(revisionRow?.revision_id ?? 0) ===
      Number(input.active_revision_id) &&
    revisionRow?.provider === fence.provider &&
    revisionRow?.status === 'staging' &&
    revisionRow?.source === 'pairing' &&
    Number(revisionRow?.writer_generation) === fence.runtime_generation &&
    (revisionRow?.writer_epoch ?? null) === fence.session_writer_epoch &&
    (revisionRow?.capability_hash ?? null) === fence.runtime_capability_hash &&
    Number(revisionRow?.identified_devices ?? 0) === 0 &&
    Number(revisionRow?.non_pairing_provider_records ?? 0) === 0
  );
}

function doesPairingLeaseFenceMatch(
  leaseRow: PairingActivationLeaseRow | undefined,
  fence: PairingActivationCanonicalFence
): boolean {
  return (
    Boolean(leaseRow) &&
    Number(leaseRow?.fencing_token) > 0 &&
    Number(leaseRow?.generation) === fence.runtime_generation &&
    (leaseRow?.lease_released === true ||
      ((leaseRow?.lease_expired === true ||
        ((fence.no_disconnect_barrier || fence.exact_disconnect_barrier) &&
          leaseRow?.lease_live === true)) &&
        Boolean(leaseRow?.owner_id) &&
        leaseRow?.provider === fence.provider &&
        (leaseRow?.epoch ?? null) === fence.session_writer_epoch))
  );
}

function isExactPendingWorkerConnectionPairingActivationGrant(
  existing: ExistingWorkerConnectionPairingActivationGrant,
  expected: {
    worker_id: string;
    account_id: string;
    provider: 'baileys' | 'wwebjs' | 'whatsmeow';
    runtime_generation: number;
    container_id: string;
    expected_connection_epoch: string | null;
    authorized_connection_epoch: string;
    connection_sequence_at_grant: number;
  }
): boolean {
  return (
    existing.worker_id === expected.worker_id &&
    existing.account_id === expected.account_id &&
    existing.provider === expected.provider &&
    Number(existing.runtime_generation) === expected.runtime_generation &&
    existing.container_id === expected.container_id &&
    (existing.expected_connection_epoch ?? null) ===
      expected.expected_connection_epoch &&
    existing.authorized_connection_epoch ===
      expected.authorized_connection_epoch &&
    Number(existing.connection_sequence_at_grant) ===
      expected.connection_sequence_at_grant &&
    isNullish(existing.consumed_at) &&
    isNullish(existing.revoked_at) &&
    existing.grant_live === true
  );
}

function isValidWorkerConnectionPairingActivationGrantIdentity(
  input: WorkerConnectionPairingActivationGrantIdentity
): boolean {
  return (
    UUID_PATTERN.test(input.worker_id?.trim() ?? '') &&
    UUID_PATTERN.test(input.account_id?.trim() ?? '') &&
    Object.prototype.hasOwnProperty.call(
      WORKER_TYPE_BY_PROVIDER,
      input.provider?.trim().toLowerCase()
    ) &&
    Number.isSafeInteger(input.runtime_generation) &&
    input.runtime_generation > 0 &&
    CONTAINER_ID_PATTERN.test(input.container_id?.trim() ?? '') &&
    UUID_PATTERN.test(input.connection_attempt_id?.trim() ?? '') &&
    UUID_PATTERN.test(input.authorized_connection_epoch?.trim() ?? '')
  );
}

export interface WhatsappProviderHandoffLifecycleContext {
  handoff_id: string;
  lifecycle_operation_id: string;
  source_provider: 'baileys' | 'wwebjs' | 'whatsmeow';
  target_provider: 'baileys' | 'wwebjs' | 'whatsmeow';
  source_revision_id: string;
  target_revision_id: string;
  state:
    | 'requested'
    | 'draining'
    | 'transforming'
    | 'hydrating'
    | 'validating'
    | 'promoting'
    | 'activating'
    | 'completed'
    | 'failed';
}

export const STALE_WHATSAPP_PROVIDER_HANDOFF_TARGET_ERROR_CODE =
  'whatsapp_handoff_target_lease_expired_before_promotion';

export interface StaleWhatsappProviderHandoffTargetReconciliation {
  outcome: 'failed' | 'recovery_owned' | 'not_applicable';
  handoff_id: string | null;
  recovery_operation_id: string | null;
  recovery_state: string | null;
  error_code: string | null;
}

export type WhatsappProviderHandoffRecoveryState =
  | 'none'
  | 'pending'
  | 'dispatching'
  | 'running'
  | 'blocked'
  | 'cancelled'
  | 'completed';

export interface WhatsappProviderHandoffTerminalLifecycleProof {
  handoff_id: string;
  lifecycle_operation_id: string;
  handoff_state: 'failed' | 'completed';
  error_code: string | null;
  source_provider: 'baileys' | 'wwebjs' | 'whatsmeow';
  target_provider: 'baileys' | 'wwebjs' | 'whatsmeow';
  recovery_state: WhatsappProviderHandoffRecoveryState;
  recovery_operation_id: string | null;
  resolution_state: 'running' | 'completed' | null;
  resolution_operation_id: string | null;
  point_of_no_return_at: string | null;
  worker_type_id: EWorkerType;
  worker_status_id: EWorkerStatus;
  terminal_ownership_unique: boolean;
}

export interface WhatsappProviderHandoffRecoveryLifecycleProof {
  handoff_id: string;
  handoff_lifecycle_operation_id: string | null;
  recovery_operation_id: string;
  source_provider: 'baileys' | 'wwebjs' | 'whatsmeow';
  failed_target_provider: 'baileys' | 'wwebjs' | 'whatsmeow';
  source_revision_id: string;
  recovery_state: string;
  recovery_cleanup_required: boolean | null;
  recovery_from_generation: number | null;
  recovery_ownership_unique: boolean;
  recovery_context_valid: boolean;
  source_session_valid: boolean;
  runtime_source_provider: string | null;
  runtime_generation: number | null;
  runtime_container_id: string | null;
  recovery_source_runtime_reserved: boolean;
}

export interface WhatsappProviderHandoffDecisionSnapshot {
  worker_id: string;
  account_id: string;
  worker_server_id: string | null;
  worker_session_storage: string | null;
  worker_type_id: string;
  worker_status_id: string;
  worker_lifecycle_operation_id: string | null;
  worker_container_id: string | null;
  handoff_id: string;
  handoff_lifecycle_operation_id: string | null;
  source_provider: 'baileys' | 'wwebjs' | 'whatsmeow';
  target_provider: 'baileys' | 'wwebjs' | 'whatsmeow';
  source_revision_id: string;
  target_revision_id: string | null;
  state: WhatsappProviderHandoffLifecycleContext['state'];
  error_code: string | null;
  recovery_state:
    | 'none'
    | 'pending'
    | 'dispatching'
    | 'running'
    | 'completed'
    | 'blocked'
    | 'cancelled';
  recovery_operation_id: string | null;
  recovery_last_error_code: string | null;
  resolution_action: 'return' | 'discard' | null;
  resolution_state: 'running' | 'completed' | null;
  resolution_operation_id: string | null;
  resolution_last_error_code: string | null;
  resolution_requested_at: string | null;
  resolution_updated_at: string | null;
  resolution_cleanup_finalized_at: string | null;
  resolution_completed_at: string | null;
  session_provider: string | null;
  session_state: string | null;
  active_revision_id: string | null;
  session_generation: number | null;
  session_epoch: string | null;
  session_capability_hash: string | null;
  runtime_container_id: string | null;
  runtime_session_storage: string | null;
  runtime_generation: number | null;
  runtime_capability_hash: string | null;
  runtime_writer_epoch: string | null;
  runtime_source_provider: string | null;
  runtime_connection_activated_at: string | null;
  runtime_online_acknowledged: boolean | null;
  runtime_status_lease_owner_id: string | null;
  runtime_status_fencing_token: string | null;
  lease_provider: string | null;
  lease_generation: number | null;
  lease_epoch: string | null;
  lease_owner_id: string | null;
  lease_fencing_token: string | null;
  lease_expires_at: string | null;
  database_now: string;
  created_at: string;
  updated_at: string;
}

export interface WhatsappProviderHandoffOutboxEvidence {
  after_order: string | null;
  observed_through_order: string | null;
  first_window_order: string | null;
  last_window_order: string | null;
  window_event_count: number;
  operation_event_count: number;
  trace_event_count: number;
  correlated_event_count: number;
  pending_event_count: number;
  dead_letter_event_count: number;
  qr_event_count: number;
  pairing_event_count: number;
  passkey_event_count: number;
  interactive_login_event_count: number;
  interactive_login_detected: boolean;
  window_limit: number;
  window_truncated: boolean;
}

const WHATSAPP_HANDOFF_EVIDENCE_WINDOW_LIMIT = 10_000;

export interface WhatsappProviderHandoffResolutionClaim {
  outcome:
    | 'claimed'
    | 'idempotent'
    | 'conflict'
    | 'not_found'
    | 'handoff_completed'
    | 'handoff_in_progress'
    | 'source_revision_unavailable'
    | 'source_runtime_not_restored'
    | 'source_runtime_identity_unavailable'
    | 'return_recovery_quiescing';
  resolution_state: 'running' | 'completed' | null;
  operation_id: string | null;
}

export interface WhatsappProviderHandoffDiscardCleanupContext {
  handoff_id: string;
  operation_id: string;
  source_provider: 'baileys' | 'wwebjs' | 'whatsmeow';
  target_provider: 'baileys' | 'wwebjs' | 'whatsmeow';
  runtime_generation: number;
  container_id: string;
  session_present: boolean;
  cleanup_finalized_at: string | null;
}

export interface WhatsappProviderHandoffDiscardPrimaryGate {
  handoff_id: string;
  operation_id: string;
  source_provider: 'baileys' | 'wwebjs' | 'whatsmeow';
  target_provider: 'baileys' | 'wwebjs' | 'whatsmeow';
  session_present: boolean;
  cleanup_finalized_at: string | null;
}

export interface WhatsappProviderEmptySwitchPrimaryProof {
  lifecycle_operation_id: string;
  worker_type_id: string;
  runtime_session_storage: string | null;
  runtime_source_provider: string | null;
}

export interface AcknowledgeWhatsappProviderHandoffDrainInput {
  worker_id: string;
  account_id: string;
  lifecycle_operation_id: string;
  handoff_id: string;
  source_provider: 'baileys' | 'wwebjs' | 'whatsmeow';
  source_revision_id: string;
  runtime_generation: number;
  checkpoint_checksum_sha256: string;
  checkpoint_size_bytes: string;
  checkpoint_record_count: string;
}

export interface ClearWorkerRuntimeWarmPoolReferenceInput {
  worker_id: string;
  warm_pool_id: string;
  runtime_generation: number;
  session_volume_name: string;
}

export interface TombstoneWarmActivationRuntimeInput extends ClearWorkerRuntimeWarmPoolReferenceInput {
  container_id: string;
  tombstone_session_volume_name: string;
}

export interface ReconcileHealthyRuntimeLifecycleInput {
  worker_id: string;
  account_id: string;
  server_id: string;
  worker_type_id: string;
  lifecycle_operation_id: string;
  expected_worker_status_id: EWorkerStatus;
  lifecycle_action: 'create' | 'recreate';
  container_id: string;
  runtime_generation: number;
  phone: string;
}

export interface ClaimReservedRuntimeContainerInput {
  worker_id: string;
  account_id: string;
  server_id: string;
  worker_type_id: string;
  lifecycle_operation_id: string | null;
  expected_worker_status_id: EWorkerStatus;
  container_id: string;
  container_name: string;
  session_storage: EWorkerSessionStorage;
  session_volume_name: string | null;
  runtime_generation: number;
  warm_pool_id?: string | null;
  source_provider?: string | null;
}

export interface ClaimPreviousRuntimeContainerInput {
  worker_id: string;
  account_id: string;
  current_server_id: string;
  current_worker_type_id: string;
  previous_server_id: string;
  previous_worker_type_id: string;
  lifecycle_operation_id: string;
  expected_worker_status_id: EWorkerStatus;
  remove_session: boolean;
  remove_volume: boolean;
  container_id: string;
  container_name: string;
  session_storage: EWorkerSessionStorage;
  session_volume_name: string | null;
  runtime_generation: number;
  warm_pool_id?: string | null;
  source_provider?: string | null;
}

interface ClaimRuntimeContainerWithWorkerFenceInput {
  worker_id: string;
  account_id: string;
  expected_current_server_id: string;
  expected_current_worker_type_id: string;
  lifecycle_operation_id: string | null;
  expected_worker_status_id: EWorkerStatus;
  container_id: string;
  container_name: string;
  session_storage: EWorkerSessionStorage;
  session_volume_name: string | null;
  runtime_generation: number;
  warm_pool_id?: string | null;
  source_provider?: string | null;
}

function resolveRuntimeSourceProvider(
  workerTypeId: string
): 'baileys' | 'wwebjs' | 'whatsmeow' | null {
  switch (workerTypeId) {
    case EWorkerType.baileys:
      return 'baileys';
    case EWorkerType.wwebjs:
      return 'wwebjs';
    case EWorkerType.whatsmeow:
      return 'whatsmeow';
    default:
      return null;
  }
}

export class StaleWorkerRuntimeGenerationError extends Error {
  constructor(workerId: string, runtimeGeneration: number) {
    super(
      `Refused stale worker runtime generation ${runtimeGeneration} for ${workerId}`
    );
    this.name = 'StaleWorkerRuntimeGenerationError';
  }
}

class WorkerRuntimeRetirementAtomicityError extends Error {}

class WorkerConnectionDisconnectAtomicityError extends Error {}

class WorkerConnectionPairingActivationAtomicityError extends Error {}

@injectable()
export class WorkerRuntimeRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>,
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  async viewByWorkerId(workerId: string): Promise<IWorkerRuntime | null> {
    return this.viewByWorkerIdFrom(this.dbRo, workerId);
  }

  /**
   * Lifecycle and generation-fencing decisions must observe the latest write.
   * A read replica can legitimately lag immediately after a generation is
   * reserved, so those callers explicitly read from the primary database.
   */
  async viewByWorkerIdConsistent(
    workerId: string
  ): Promise<IWorkerRuntime | null> {
    return this.viewByWorkerIdFrom(this.dbRw, workerId);
  }

  /**
   * A provider may durably publish its final unavailable state and terminate
   * before the manager can reach RuntimeHealth over gRPC. Prove that terminal
   * state from the primary database without accepting a stale lifecycle,
   * generation, container, source, or pre-bootstrap projection.
   */
  async viewRecreatedWorkerUnavailableNativeTerminalProof(input: {
    worker_id: string;
    account_id: string;
    server_id: string;
    worker_type_id: EWorkerType;
    lifecycle_operation_id: string;
    runtime_generation: number;
  }): Promise<RecreatedWorkerUnavailableNativeTerminalProof | null> {
    const provider = resolveRuntimeSourceProvider(input.worker_type_id);
    if (!provider) {
      return null;
    }

    const result = await this.dbRw.execute(sql`
      SELECT runtime.container_id,
        runtime.native_connection_public_status AS connection_status,
        runtime.native_connection_status_source_id::text
          AS connection_status_source_id,
        runtime.native_connection_status_sequence::bigint
          AS connection_status_sequence,
        runtime.native_connection_status_changed_at_high_watermark::text
          AS connection_status_changed_at
      FROM public.worker AS worker
      JOIN public.worker_runtime AS runtime
        ON runtime.worker_id = worker.worker_id
      WHERE worker.worker_id = ${input.worker_id}::uuid
        AND worker.account_id = ${input.account_id}::uuid
        AND worker.server_id = ${input.server_id}::uuid
        AND worker.worker_type_id = ${input.worker_type_id}::uuid
        AND worker.worker_status_id = ${EWorkerStatus.recreating}::uuid
        AND worker.lifecycle_operation_id =
          ${input.lifecycle_operation_id}::uuid
        AND worker.deleted_at IS NULL
        AND runtime.runtime_generation = ${input.runtime_generation}
        AND runtime.container_id IS NOT NULL
        AND lower(trim(runtime.container_id)) ~ '^[0-9a-f]{12,64}$'
        AND runtime.source_provider = ${provider}
        AND runtime.recreate_bootstrap_operation_id =
          ${input.lifecycle_operation_id}::uuid
        AND runtime.recreate_bootstrap_runtime_generation =
          ${input.runtime_generation}
        AND lower(trim(runtime.recreate_bootstrap_container_id)) =
          lower(trim(runtime.container_id))
        AND runtime.recreate_bootstrap_started_at IS NOT NULL
        AND runtime.recreate_retired_operation_id IS NULL
        AND runtime.recreate_retired_runtime_generation IS NULL
        AND runtime.recreate_retired_container_id IS NULL
        AND runtime.recreate_retired_at IS NULL
        AND runtime.native_connection_status IS NOT NULL
        AND runtime.native_connection_public_status IS NOT NULL
        AND runtime.native_connection_status_source_id IS NOT NULL
        AND runtime.native_connection_status_sequence BETWEEN 1 AND 9007199254740991
        AND runtime.native_connection_status_outbox_id > 0
        AND runtime.native_connection_status_changed_at_high_watermark >=
          runtime.recreate_bootstrap_started_at
        AND NOT runtime.native_connection_online_acknowledged
        AND NOT (
          runtime.native_connection_status_source_id = ANY(
            runtime.native_connection_status_retired_source_ids
          )
        )
        AND runtime.native_connection_status ->> 'provider' = ${provider}
        AND runtime.native_connection_public_status ->> 'provider' = ${provider}
        AND runtime.native_connection_status ->> 'sequence' =
          runtime.native_connection_status_sequence::text
        AND runtime.native_connection_public_status ->> 'sequence' =
          runtime.native_connection_status_sequence::text
        AND runtime.native_connection_status ->> 'status' =
          runtime.native_connection_public_status ->> 'status'
        AND runtime.native_connection_status -> 'connected' = 'false'::jsonb
        AND runtime.native_connection_public_status -> 'connected' =
          'false'::jsonb
        AND runtime.native_connection_status -> 'authenticated' =
          'false'::jsonb
        AND runtime.native_connection_public_status -> 'authenticated' =
          'false'::jsonb
        AND runtime.native_connection_status -> 'sessionValid' IS DISTINCT FROM
          'true'::jsonb
        AND runtime.native_connection_public_status -> 'sessionValid'
          IS DISTINCT FROM 'true'::jsonb
        AND (runtime.native_connection_status ->> 'changedAt')::timestamptz =
          runtime.native_connection_status_changed_at_high_watermark
        AND (
          runtime.native_connection_public_status ->> 'changedAt'
        )::timestamptz =
          runtime.native_connection_status_changed_at_high_watermark
        AND (
          (
            runtime.native_connection_status ->> 'status' = 'qr'
            AND runtime.native_connection_status -> 'qrAvailable' =
              'true'::jsonb
            AND runtime.native_connection_public_status -> 'qrAvailable' =
              'true'::jsonb
          )
          OR (
            runtime.native_connection_status ->> 'status' IN (
              'logged_out', 'invalid_session'
            )
            AND runtime.native_connection_status -> 'sessionValid' =
              'false'::jsonb
            AND runtime.native_connection_public_status -> 'sessionValid' =
              'false'::jsonb
          )
          OR (
            runtime.native_connection_status ->> 'status' = 'error'
            AND runtime.native_connection_status -> 'recoverable' =
              'false'::jsonb
            AND runtime.native_connection_public_status -> 'recoverable' =
              'false'::jsonb
          )
        )
      LIMIT 1
    `);
    const row = (
      result as unknown as {
        rows?: Array<{
          container_id?: string | null;
          connection_status?: IWhatsappConnectionStatus | null;
          connection_status_source_id?: string | null;
          connection_status_sequence?: number | string | null;
          connection_status_changed_at?: string | null;
        }>;
      }
    ).rows?.[0];
    const sequence = Number(row?.connection_status_sequence);
    if (
      !row?.container_id ||
      !row.connection_status ||
      !row.connection_status_source_id ||
      !row.connection_status_changed_at ||
      !Number.isSafeInteger(sequence) ||
      sequence <= 0
    ) {
      return null;
    }

    return {
      container_id: row.container_id,
      connection_status: row.connection_status,
      connection_status_source_id: row.connection_status_source_id,
      connection_status_sequence: sequence,
      connection_status_changed_at: row.connection_status_changed_at,
    };
  }

  async viewWhatsappProviderHandoffLifecycleContext(input: {
    worker_id: string;
    account_id: string;
    lifecycle_operation_id: string;
  }): Promise<WhatsappProviderHandoffLifecycleContext | null> {
    const result = await this.dbRw.execute(sql`
      SELECT handoff.handoff_id::text,
        handoff.lifecycle_operation_id::text,
        handoff.source_provider,
        handoff.target_provider,
        handoff.source_revision_id::text,
        handoff.target_revision_id::text,
        handoff.state
      FROM public.worker AS worker
      JOIN public.whatsapp_session_handoff AS handoff
        ON handoff.session_id = worker.worker_id
       AND handoff.lifecycle_operation_id = worker.lifecycle_operation_id
      WHERE worker.worker_id = ${input.worker_id}::uuid
        AND worker.account_id = ${input.account_id}::uuid
        AND worker.lifecycle_operation_id = ${input.lifecycle_operation_id}::uuid
        AND worker.session_storage = 'postgres'
        AND worker.deleted_at IS NULL
        AND (
          (
            handoff.state IN (
              'requested', 'draining', 'transforming', 'hydrating',
              'validating', 'promoting', 'failed'
            )
            AND worker.worker_status_id = ${EWorkerStatus.recreating}::uuid
            AND worker.worker_type_id = CASE handoff.source_provider
              WHEN 'baileys' THEN ${EWorkerType.baileys}::uuid
              WHEN 'wwebjs' THEN ${EWorkerType.wwebjs}::uuid
              WHEN 'whatsmeow' THEN ${EWorkerType.whatsmeow}::uuid
            END
          )
          OR (
            handoff.state IN ('activating', 'completed')
            AND worker.worker_status_id IN (
              ${EWorkerStatus.recreating}::uuid,
              ${EWorkerStatus.online}::uuid
            )
            AND worker.worker_type_id = CASE handoff.target_provider
              WHEN 'baileys' THEN ${EWorkerType.baileys}::uuid
              WHEN 'wwebjs' THEN ${EWorkerType.wwebjs}::uuid
              WHEN 'whatsmeow' THEN ${EWorkerType.whatsmeow}::uuid
            END
          )
        )
      LIMIT 1
    `);
    const rows = (
      result as unknown as {
        rows?: WhatsappProviderHandoffLifecycleContext[];
      }
    ).rows;
    return rows?.[0] ?? null;
  }

  /**
   * Proves from the primary that the worker's exact lifecycle operation already
   * belongs to a terminal provider handoff. A terminal handoff is immutable;
   * its distinct recovery/resolution operation owns every later effect, so the
   * original Kafka journal must never be redriven.
   */
  async viewWhatsappProviderHandoffTerminalLifecycleProof(input: {
    worker_id: string;
    account_id: string;
    lifecycle_operation_id: string;
  }): Promise<WhatsappProviderHandoffTerminalLifecycleProof | null> {
    const result = await this.dbRw.execute(sql`
      SELECT handoff.handoff_id::text,
        handoff.lifecycle_operation_id::text,
        handoff.state AS handoff_state,
        handoff.error_code,
        handoff.source_provider,
        handoff.target_provider,
        handoff.recovery_state,
        handoff.recovery_operation_id::text,
        resolution.state AS resolution_state,
        resolution.operation_id::text AS resolution_operation_id,
        handoff.point_of_no_return_at::text,
        worker.worker_type_id::text,
        worker.worker_status_id::text,
        (count(*) OVER () = 1) AS terminal_ownership_unique
      FROM public.worker AS worker
      JOIN public.whatsapp_session_handoff AS handoff
        ON handoff.session_id = worker.worker_id
       AND handoff.lifecycle_operation_id = worker.lifecycle_operation_id
      LEFT JOIN public.whatsapp_session_handoff_resolution AS resolution
        ON resolution.session_id = handoff.session_id
       AND resolution.handoff_id = handoff.handoff_id
       AND resolution.handoff_lifecycle_operation_id =
         handoff.lifecycle_operation_id
      WHERE worker.worker_id = ${input.worker_id}::uuid
        AND worker.account_id = ${input.account_id}::uuid
        AND worker.lifecycle_operation_id = ${input.lifecycle_operation_id}::uuid
        AND worker.session_storage = 'postgres'
        AND worker.deleted_at IS NULL
        AND handoff.state IN ('failed', 'completed')
      LIMIT 2
    `);
    const rows = (
      result as unknown as {
        rows?: WhatsappProviderHandoffTerminalLifecycleProof[];
      }
    ).rows;
    if (!rows || rows.length === 0) {
      return null;
    }
    const row = rows[0];
    if (!row || rows.length !== 1 || row.terminal_ownership_unique !== true) {
      throw new Error('whatsapp_handoff_terminal_lifecycle_proof_ambiguous');
    }

    const recoveryStateValid = [
      'none',
      'pending',
      'dispatching',
      'running',
      'blocked',
      'cancelled',
      'completed',
    ].includes(row.recovery_state);
    const recoveryIdentityValid =
      row.recovery_state === 'none'
        ? row.recovery_operation_id === null
        : Boolean(
            row.recovery_operation_id?.trim() &&
            row.recovery_operation_id !== input.lifecycle_operation_id
          );
    const resolutionIdentityValid =
      row.resolution_state === null
        ? row.resolution_operation_id === null
        : ['running', 'completed'].includes(row.resolution_state) &&
          Boolean(
            row.resolution_operation_id?.trim() &&
            row.resolution_operation_id !== input.lifecycle_operation_id &&
            row.resolution_operation_id !== row.recovery_operation_id
          );
    const workerProvider = resolveRuntimeSourceProvider(row.worker_type_id);
    const workerIdentityValid =
      workerProvider !== null &&
      [row.source_provider, row.target_provider].includes(workerProvider) &&
      [
        EWorkerStatus.recreating,
        EWorkerStatus.online,
        EWorkerStatus.error,
      ].includes(row.worker_status_id);
    const terminalErrorValid =
      row.handoff_state === 'failed'
        ? Boolean(row.error_code?.trim())
        : row.error_code === null;
    if (
      !row.handoff_id?.trim() ||
      row.lifecycle_operation_id !== input.lifecycle_operation_id ||
      !['failed', 'completed'].includes(row.handoff_state) ||
      !recoveryStateValid ||
      !recoveryIdentityValid ||
      !resolutionIdentityValid ||
      !workerIdentityValid ||
      !terminalErrorValid
    ) {
      throw new Error('whatsapp_handoff_terminal_lifecycle_proof_invalid');
    }

    return row;
  }

  /**
   * Fails only an exact pre-promotion handoff whose target PostgreSQL lease is
   * durably stale. The database capability performs rollback and recovery
   * scheduling in one locked transaction; this primary-only wrapper also
   * validates the returned proof before a monitor suppresses Kafka redrive.
   */
  async failStaleWhatsappProviderHandoffTarget(input: {
    worker_id: string;
    account_id: string;
    lifecycle_operation_id: string;
  }): Promise<StaleWhatsappProviderHandoffTargetReconciliation> {
    const result = await this.dbRw.execute(sql`
      SELECT outcome,
        handoff_id::text,
        recovery_operation_id::text,
        recovery_state,
        error_code
      FROM public.fail_stale_whatsapp_handoff_target(
        ${input.worker_id}::uuid,
        ${input.account_id}::uuid,
        ${input.lifecycle_operation_id}::uuid
      )
    `);
    const row = (
      result as unknown as {
        rows?: StaleWhatsappProviderHandoffTargetReconciliation[];
      }
    ).rows?.[0];
    if (
      !row ||
      !['failed', 'recovery_owned', 'not_applicable'].includes(row.outcome)
    ) {
      throw new Error('stale_whatsapp_handoff_reconciliation_result_invalid');
    }

    if (row.outcome !== 'not_applicable') {
      if (
        !row.handoff_id?.trim() ||
        !row.recovery_operation_id?.trim() ||
        row.recovery_operation_id === input.lifecycle_operation_id ||
        ![
          'pending',
          'dispatching',
          'running',
          'blocked',
          'cancelled',
          'completed',
        ].includes(row.recovery_state ?? '') ||
        (row.outcome === 'failed' && row.recovery_state !== 'pending') ||
        row.error_code !== STALE_WHATSAPP_PROVIDER_HANDOFF_TARGET_ERROR_CODE
      ) {
        throw new Error('stale_whatsapp_handoff_reconciliation_proof_invalid');
      }
    }

    return row;
  }

  /**
   * A rollback is restored by a separate, durable lifecycle operation. The
   * original handoff lookup cannot authorize that UUID because the failed row
   * deliberately retains its original lifecycle identity. Prove the exact
   * recovery operation and preserved canonical source on the primary so the
   * worker can restore the existing session without opening an interactive
   * QR flow.
   */
  async viewWhatsappProviderHandoffRecoveryLifecycleProof(input: {
    worker_id: string;
    account_id: string;
    recovery_operation_id: string;
    recovery_worker_type_id: EWorkerType;
    recovery_provider: 'baileys' | 'wwebjs' | 'whatsmeow';
  }): Promise<WhatsappProviderHandoffRecoveryLifecycleProof | null> {
    const result = await this.dbRw.execute(sql`
      SELECT handoff.handoff_id::text,
        handoff.lifecycle_operation_id::text
          AS handoff_lifecycle_operation_id,
        handoff.recovery_operation_id::text,
        handoff.source_provider,
        handoff.target_provider AS failed_target_provider,
        handoff.source_revision_id::text,
        handoff.recovery_state,
        handoff.recovery_cleanup_required,
        handoff.recovery_from_generation,
        (count(*) OVER () = 1) AS recovery_ownership_unique,
        COALESCE(
          worker.deleted_at IS NULL
          AND worker.session_storage = 'postgres'
          AND worker.worker_status_id IN (
            ${EWorkerStatus.recreating}::uuid,
            ${EWorkerStatus.online}::uuid
          )
          AND worker.worker_type_id = ${input.recovery_worker_type_id}::uuid
          AND ${input.recovery_provider} = CASE worker.worker_type_id
            WHEN ${EWorkerType.baileys}::uuid THEN 'baileys'
            WHEN ${EWorkerType.wwebjs}::uuid THEN 'wwebjs'
            WHEN ${EWorkerType.whatsmeow}::uuid THEN 'whatsmeow'
          END
          AND handoff.state = 'failed'
          AND handoff.lifecycle_operation_id IS NOT NULL
          AND handoff.recovery_operation_id <>
            handoff.lifecycle_operation_id
          AND handoff.source_provider = ${input.recovery_provider}
          AND handoff.target_provider <> handoff.source_provider
          AND handoff.target_revision_id IS NOT NULL
          AND handoff.target_revision_id <> handoff.source_revision_id
          AND handoff.recovery_state IN ('pending', 'dispatching', 'running')
          AND handoff.recovery_cleanup_required IS NOT NULL
          AND handoff.recovery_from_generation > 0,
          false
        ) AS recovery_context_valid,
        COALESCE(
          session.provider = handoff.source_provider
          AND session.state = 'ready'
          AND session.active_revision_id = handoff.source_revision_id
          AND source_revision.provider = handoff.source_provider
          AND source_revision.status = 'active'
          AND source_revision.writer_generation = session.generation
          AND source_revision.writer_epoch = session.epoch
          AND source_revision.capability_hash = session.capability_hash,
          false
        ) AS source_session_valid,
        runtime.source_provider AS runtime_source_provider,
        runtime.runtime_generation,
        runtime.container_id AS runtime_container_id,
        COALESCE(
          runtime.session_storage = 'postgres'
          AND runtime.session_volume_name IS NULL
          AND runtime.runtime_generation > handoff.recovery_from_generation
          AND runtime.runtime_capability_hash ~ '^[0-9a-f]{64}$'
          AND runtime.session_writer_epoch IS NOT NULL
          AND (
            runtime.source_provider IS NULL
            OR runtime.source_provider = handoff.source_provider
          ),
          false
        ) AS recovery_source_runtime_reserved
      FROM public.worker AS worker
      JOIN public.whatsapp_session_handoff AS handoff
        ON handoff.session_id = worker.worker_id
       AND handoff.recovery_operation_id = worker.lifecycle_operation_id
      LEFT JOIN public.whatsapp_session AS session
        ON session.session_id = handoff.session_id
      LEFT JOIN public.whatsapp_session_revision AS source_revision
        ON source_revision.session_id = handoff.session_id
       AND source_revision.revision_id = handoff.source_revision_id
      LEFT JOIN public.worker_runtime AS runtime
        ON runtime.worker_id = worker.worker_id
      WHERE worker.worker_id = ${input.worker_id}::uuid
        AND worker.account_id = ${input.account_id}::uuid
        AND worker.lifecycle_operation_id =
          ${input.recovery_operation_id}::uuid
        AND handoff.recovery_operation_id =
          ${input.recovery_operation_id}::uuid
      LIMIT 2
    `);
    return (
      (
        result as unknown as {
          rows?: WhatsappProviderHandoffRecoveryLifecycleProof[];
        }
      ).rows?.[0] ?? null
    );
  }

  /**
   * Returns aggregate-only canary evidence. The outbox payload may contain QR,
   * pairing, passkey and phone material, so no payload field or diagnostic
   * value is selected across this repository boundary.
   */
  async viewWhatsappProviderHandoffOutboxEvidence(input: {
    worker_id: string;
    account_id: string;
    after_order?: string;
    operation_id?: string;
    debug_trace_id?: string;
  }): Promise<WhatsappProviderHandoffOutboxEvidence> {
    const qrPredicate = sql`(
      (
        outbox.payload ? 'qrcode'
        AND length(btrim(COALESCE(outbox.payload ->> 'qrcode', ''))) > 0
      )
      OR outbox.payload ->> 'qr_pending' = 'true'
      OR outbox.payload ->> 'is_new_login' = 'true'
      OR outbox.payload -> 'connection_status' ->> 'status' = 'qr'
      OR outbox.payload -> 'connection_status' ->> 'qrAvailable' = 'true'
      OR outbox.payload ->> 'code' IN ('201', '202')
    )`;
    const pairingPredicate = sql`(
      (
        outbox.payload ? 'pairing_code'
        AND length(btrim(COALESCE(outbox.payload ->> 'pairing_code', ''))) > 0
      )
      OR outbox.payload ->> 'code' IN ('204', '206')
    )`;
    const passkeyPredicate = sql`(
      (
        outbox.payload ? 'passkey_public_key'
        AND length(
          btrim(COALESCE(outbox.payload ->> 'passkey_public_key', ''))
        ) > 0
      )
      OR (
        outbox.payload ? 'passkey_confirmation_code'
        AND length(
          btrim(COALESCE(outbox.payload ->> 'passkey_confirmation_code', ''))
        ) > 0
      )
      OR outbox.payload ->> 'passkey_pending' = 'true'
      OR outbox.payload ->> 'code' IN ('207', '208')
    )`;
    const result = await this.dbRw.execute(sql`
      WITH authorized_worker AS MATERIALIZED (
        SELECT worker.worker_id
        FROM public.worker AS worker
        WHERE worker.worker_id = ${input.worker_id}::uuid
          AND worker.account_id = ${input.account_id}::uuid
          AND worker.deleted_at IS NULL
      ), observed AS MATERIALIZED (
        SELECT max(outbox.outbox_id) AS observed_through_order
        FROM public.worker_runtime_event_outbox AS outbox
        JOIN authorized_worker AS authorized
          ON authorized.worker_id = outbox.worker_id
        WHERE outbox.account_id = ${input.account_id}::uuid
      ), bounded_window AS MATERIALIZED (
        SELECT outbox.*,
          (
            ${input.operation_id ?? null}::uuid IS NOT NULL
            AND (
              outbox.payload ->> 'lifecycle_operation_id' =
                ${input.operation_id ?? null}
              OR outbox.payload ->> 'operation_id' =
                ${input.operation_id ?? null}
            )
          ) AS operation_matches,
          (
            ${input.debug_trace_id ?? null}::text IS NOT NULL
            AND outbox.payload ->> 'debug_trace_id' =
              ${input.debug_trace_id ?? null}
          ) AS trace_matches,
          ${qrPredicate} AS has_qr,
          ${pairingPredicate} AS has_pairing,
          ${passkeyPredicate} AS has_passkey
        FROM public.worker_runtime_event_outbox AS outbox
        JOIN authorized_worker AS authorized
          ON authorized.worker_id = outbox.worker_id
        CROSS JOIN observed
        WHERE outbox.account_id = ${input.account_id}::uuid
          AND ${input.after_order ?? null}::bigint IS NOT NULL
          AND outbox.outbox_id > ${input.after_order ?? null}::bigint
          AND outbox.outbox_id <= observed.observed_through_order
        ORDER BY outbox.outbox_id
        LIMIT ${WHATSAPP_HANDOFF_EVIDENCE_WINDOW_LIMIT + 1}
      ), window_events AS MATERIALIZED (
        SELECT bounded.*
        FROM bounded_window AS bounded
        ORDER BY bounded.outbox_id
        LIMIT ${WHATSAPP_HANDOFF_EVIDENCE_WINDOW_LIMIT}
      )
      SELECT ${input.after_order ?? null}::text AS after_order,
        observed.observed_through_order::text,
        min(window_events.outbox_id)::text AS first_window_order,
        max(window_events.outbox_id)::text AS last_window_order,
        count(window_events.outbox_id)::integer AS window_event_count,
        count(*) FILTER (
          WHERE window_events.operation_matches
        )::integer AS operation_event_count,
        count(*) FILTER (
          WHERE window_events.trace_matches
        )::integer AS trace_event_count,
        count(*) FILTER (
          WHERE window_events.operation_matches OR window_events.trace_matches
        )::integer AS correlated_event_count,
        count(*) FILTER (
          WHERE window_events.state IN ('pending', 'publishing')
        )::integer AS pending_event_count,
        count(*) FILTER (
          WHERE window_events.state = 'dead_letter'
        )::integer AS dead_letter_event_count,
        count(*) FILTER (WHERE window_events.has_qr)::integer
          AS qr_event_count,
        count(*) FILTER (WHERE window_events.has_pairing)::integer
          AS pairing_event_count,
        count(*) FILTER (WHERE window_events.has_passkey)::integer
          AS passkey_event_count,
        count(*) FILTER (
          WHERE window_events.has_qr
            OR window_events.has_pairing
            OR window_events.has_passkey
        )::integer AS interactive_login_event_count,
        COALESCE(
          bool_or(
            window_events.has_qr
            OR window_events.has_pairing
            OR window_events.has_passkey
          ),
          false
        ) AS interactive_login_detected,
        ${WHATSAPP_HANDOFF_EVIDENCE_WINDOW_LIMIT}::integer AS window_limit,
        (
          SELECT count(*) > ${WHATSAPP_HANDOFF_EVIDENCE_WINDOW_LIMIT}
          FROM bounded_window
        ) AS window_truncated
      FROM observed
      LEFT JOIN window_events ON true
      GROUP BY observed.observed_through_order
    `);
    const rows = (
      result as unknown as {
        rows?: WhatsappProviderHandoffOutboxEvidence[];
      }
    ).rows;
    const row = rows?.[0];
    // Keep this an explicit allowlist even though the HTTP response schema is
    // also closed. A future SQL edit must never make payload JSON serializable.
    return {
      after_order: row?.after_order ?? input.after_order ?? null,
      observed_through_order: row?.observed_through_order ?? null,
      first_window_order: row?.first_window_order ?? null,
      last_window_order: row?.last_window_order ?? null,
      window_event_count: Number(row?.window_event_count ?? 0),
      operation_event_count: Number(row?.operation_event_count ?? 0),
      trace_event_count: Number(row?.trace_event_count ?? 0),
      correlated_event_count: Number(row?.correlated_event_count ?? 0),
      pending_event_count: Number(row?.pending_event_count ?? 0),
      dead_letter_event_count: Number(row?.dead_letter_event_count ?? 0),
      qr_event_count: Number(row?.qr_event_count ?? 0),
      pairing_event_count: Number(row?.pairing_event_count ?? 0),
      passkey_event_count: Number(row?.passkey_event_count ?? 0),
      interactive_login_event_count: Number(
        row?.interactive_login_event_count ?? 0
      ),
      interactive_login_detected: row?.interactive_login_detected === true,
      window_limit: WHATSAPP_HANDOFF_EVIDENCE_WINDOW_LIMIT,
      window_truncated: row?.window_truncated === true,
    };
  }

  async viewWhatsappProviderHandoffDecision(input: {
    worker_id: string;
    account_id: string;
    handoff_id?: string;
  }): Promise<WhatsappProviderHandoffDecisionSnapshot | null> {
    // Resolution completion is derived from fenced database state, not from a
    // browser callback. This makes reload/new-tab reads authoritative and also
    // closes lifecycle operations that completed while no UI was connected.
    await this.dbRw.execute(sql`
      SELECT public.reconcile_whatsapp_handoff_resolution(
        ${input.worker_id}::uuid,
        ${input.account_id}::uuid,
        ${input.handoff_id ?? null}::uuid
      )
    `);
    const handoffFilter = input.handoff_id
      ? sql`AND handoff.handoff_id = ${input.handoff_id}::uuid`
      : sql``;
    const result = await this.dbRw.execute(sql`
      SELECT worker.worker_id::text,
        worker.account_id::text,
        worker.server_id::text AS worker_server_id,
        worker.session_storage AS worker_session_storage,
        worker.worker_type_id::text,
        worker.worker_status_id::text,
        worker.lifecycle_operation_id::text AS worker_lifecycle_operation_id,
        worker.container_id AS worker_container_id,
        handoff.handoff_id::text,
        handoff.lifecycle_operation_id::text AS handoff_lifecycle_operation_id,
        handoff.source_provider,
        handoff.target_provider,
        handoff.source_revision_id::text,
        handoff.target_revision_id::text,
        handoff.state,
        handoff.error_code,
        handoff.recovery_state,
        handoff.recovery_operation_id::text,
        handoff.recovery_last_error_code,
        resolution.action AS resolution_action,
        resolution.state AS resolution_state,
        resolution.operation_id::text AS resolution_operation_id,
        resolution.last_error_code AS resolution_last_error_code,
        resolution.requested_at::text AS resolution_requested_at,
        resolution.updated_at::text AS resolution_updated_at,
        resolution.cleanup_finalized_at::text
          AS resolution_cleanup_finalized_at,
        resolution.completed_at::text AS resolution_completed_at,
        session.provider AS session_provider,
        session.state AS session_state,
        session.active_revision_id::text,
        session.generation AS session_generation,
        session.epoch::text AS session_epoch,
        session.capability_hash AS session_capability_hash,
        runtime.container_id AS runtime_container_id,
        runtime.session_storage AS runtime_session_storage,
        runtime.runtime_generation,
        runtime.runtime_capability_hash,
        runtime.session_writer_epoch::text AS runtime_writer_epoch,
        runtime.source_provider AS runtime_source_provider,
        runtime.connection_activated_at::text AS runtime_connection_activated_at,
        runtime.native_connection_online_acknowledged AS runtime_online_acknowledged,
        runtime.native_connection_status_lease_owner_id::text AS runtime_status_lease_owner_id,
        runtime.native_connection_status_fencing_token::text AS runtime_status_fencing_token,
        lease.provider AS lease_provider,
        lease.generation AS lease_generation,
        lease.epoch::text AS lease_epoch,
        lease.owner_id::text AS lease_owner_id,
        lease.fencing_token::text AS lease_fencing_token,
        lease.expires_at::text AS lease_expires_at,
        clock_timestamp()::text AS database_now,
        handoff.created_at::text,
        handoff.updated_at::text
      FROM public.worker AS worker
      JOIN public.whatsapp_session_handoff AS handoff
        ON handoff.session_id = worker.worker_id
      LEFT JOIN public.whatsapp_session AS session
        ON session.session_id = worker.worker_id
      LEFT JOIN public.worker_runtime AS runtime
        ON runtime.worker_id = worker.worker_id
      LEFT JOIN public.whatsapp_session_lease AS lease
        ON lease.session_id = worker.worker_id
      LEFT JOIN public.whatsapp_session_handoff_resolution AS resolution
        ON resolution.session_id = handoff.session_id
       AND resolution.handoff_id = handoff.handoff_id
      WHERE worker.worker_id = ${input.worker_id}::uuid
        AND worker.account_id = ${input.account_id}::uuid
        AND worker.deleted_at IS NULL
        AND worker.session_storage = 'postgres'
        ${handoffFilter}
      ORDER BY handoff.created_at DESC, handoff.handoff_id DESC
      LIMIT 1
    `);
    const rows = (
      result as unknown as {
        rows?: WhatsappProviderHandoffDecisionSnapshot[];
      }
    ).rows;
    if (rows?.[0]) return rows[0];

    // Discard removes whatsapp_session and cascades its handoff row. The
    // worker-owned resolution remains the durable source for idempotent API
    // retries and for a page opened after that cascade.
    const resolutionFilter = input.handoff_id
      ? sql`AND resolution.handoff_id = ${input.handoff_id}::uuid`
      : sql``;
    const fallback = await this.dbRw.execute(sql`
      SELECT worker.worker_id::text,
        worker.account_id::text,
        worker.server_id::text AS worker_server_id,
        worker.session_storage AS worker_session_storage,
        worker.worker_type_id::text,
        worker.worker_status_id::text,
        worker.lifecycle_operation_id::text AS worker_lifecycle_operation_id,
        worker.container_id AS worker_container_id,
        resolution.handoff_id::text,
        resolution.handoff_lifecycle_operation_id::text
          AS handoff_lifecycle_operation_id,
        resolution.source_provider,
        resolution.target_provider,
        resolution.source_revision_id::text,
        resolution.target_revision_id::text,
        'failed'::text AS state,
        resolution.last_error_code AS error_code,
        CASE
          WHEN resolution.action = 'return' AND resolution.state = 'running'
            THEN 'running'
          WHEN resolution.action = 'return' THEN 'completed'
          ELSE 'cancelled'
        END::text AS recovery_state,
        CASE WHEN resolution.action = 'return'
          THEN resolution.operation_id::text ELSE NULL::text END
          AS recovery_operation_id,
        resolution.last_error_code AS recovery_last_error_code,
        resolution.action AS resolution_action,
        resolution.state AS resolution_state,
        resolution.operation_id::text AS resolution_operation_id,
        resolution.last_error_code AS resolution_last_error_code,
        resolution.requested_at::text AS resolution_requested_at,
        resolution.updated_at::text AS resolution_updated_at,
        resolution.cleanup_finalized_at::text
          AS resolution_cleanup_finalized_at,
        resolution.completed_at::text AS resolution_completed_at,
        session.provider AS session_provider,
        session.state AS session_state,
        session.active_revision_id::text,
        session.generation AS session_generation,
        session.epoch::text AS session_epoch,
        session.capability_hash AS session_capability_hash,
        runtime.container_id AS runtime_container_id,
        runtime.session_storage AS runtime_session_storage,
        runtime.runtime_generation,
        runtime.runtime_capability_hash,
        runtime.session_writer_epoch::text AS runtime_writer_epoch,
        runtime.source_provider AS runtime_source_provider,
        runtime.connection_activated_at::text AS runtime_connection_activated_at,
        runtime.native_connection_online_acknowledged AS runtime_online_acknowledged,
        runtime.native_connection_status_lease_owner_id::text AS runtime_status_lease_owner_id,
        runtime.native_connection_status_fencing_token::text AS runtime_status_fencing_token,
        lease.provider AS lease_provider,
        lease.generation AS lease_generation,
        lease.epoch::text AS lease_epoch,
        lease.owner_id::text AS lease_owner_id,
        lease.fencing_token::text AS lease_fencing_token,
        lease.expires_at::text AS lease_expires_at,
        clock_timestamp()::text AS database_now,
        resolution.requested_at::text AS created_at,
        resolution.updated_at::text AS updated_at
      FROM public.worker AS worker
      JOIN public.whatsapp_session_handoff_resolution AS resolution
        ON resolution.session_id = worker.worker_id
       AND resolution.account_id = worker.account_id
      LEFT JOIN public.whatsapp_session AS session
        ON session.session_id = worker.worker_id
      LEFT JOIN public.worker_runtime AS runtime
        ON runtime.worker_id = worker.worker_id
      LEFT JOIN public.whatsapp_session_lease AS lease
        ON lease.session_id = worker.worker_id
      WHERE worker.worker_id = ${input.worker_id}::uuid
        AND worker.account_id = ${input.account_id}::uuid
        AND worker.deleted_at IS NULL
        AND worker.session_storage = 'postgres'
        ${resolutionFilter}
      ORDER BY resolution.requested_at DESC, resolution.handoff_id DESC
      LIMIT 1
    `);
    return (
      (
        fallback as unknown as {
          rows?: WhatsappProviderHandoffDecisionSnapshot[];
        }
      ).rows?.[0] ?? null
    );
  }

  async claimWhatsappProviderHandoffReturn(input: {
    worker_id: string;
    account_id: string;
    handoff_id: string;
    operation_id: string;
  }): Promise<WhatsappProviderHandoffResolutionClaim> {
    const result = await this.dbRw.execute(sql`
      SELECT outcome, resolution_state, operation_id::text
      FROM public.resolve_whatsapp_provider_handoff_return(
        ${input.worker_id}::uuid,
        ${input.account_id}::uuid,
        ${input.handoff_id}::uuid,
        ${input.operation_id}::uuid
      )
    `);
    return (
      (
        result as unknown as {
          rows?: WhatsappProviderHandoffResolutionClaim[];
        }
      ).rows?.[0] ?? {
        outcome: 'not_found',
        resolution_state: null,
        operation_id: null,
      }
    );
  }

  async claimWhatsappProviderHandoffDiscard(input: {
    worker_id: string;
    account_id: string;
    handoff_id: string;
    operation_id: string;
    expected_server_id: string;
  }): Promise<WhatsappProviderHandoffResolutionClaim> {
    const result = await this.dbRw.execute(sql`
      SELECT outcome, resolution_state, operation_id::text
      FROM public.resolve_whatsapp_provider_handoff_discard(
        ${input.worker_id}::uuid,
        ${input.account_id}::uuid,
        ${input.handoff_id}::uuid,
        ${input.operation_id}::uuid,
        ${input.expected_server_id}::uuid
      )
    `);
    return (
      (
        result as unknown as {
          rows?: WhatsappProviderHandoffResolutionClaim[];
        }
      ).rows?.[0] ?? {
        outcome: 'not_found',
        resolution_state: null,
        operation_id: null,
      }
    );
  }

  async viewWhatsappProviderHandoffDiscardCleanupContext(input: {
    worker_id: string;
    account_id: string;
    operation_id: string;
  }): Promise<WhatsappProviderHandoffDiscardCleanupContext | null> {
    const result = await this.dbRw.execute(sql`
      SELECT resolution.handoff_id::text,
        resolution.operation_id::text,
        resolution.source_provider,
        resolution.target_provider,
        runtime.runtime_generation,
        runtime.container_id,
        (session.session_id IS NOT NULL) AS session_present,
        resolution.cleanup_finalized_at::text AS cleanup_finalized_at
      FROM public.worker AS worker
      JOIN public.whatsapp_session_handoff_resolution AS resolution
        ON resolution.session_id = worker.worker_id
       AND resolution.account_id = worker.account_id
      JOIN public.worker_runtime AS runtime
        ON runtime.worker_id = worker.worker_id
      LEFT JOIN public.whatsapp_session AS session
        ON session.session_id = worker.worker_id
      WHERE worker.worker_id = ${input.worker_id}::uuid
        AND worker.account_id = ${input.account_id}::uuid
        AND worker.deleted_at IS NULL
        AND worker.session_storage = 'postgres'
        AND worker.worker_status_id = ${EWorkerStatus.recreating}::uuid
        AND worker.lifecycle_operation_id = ${input.operation_id}::uuid
        AND resolution.action = 'discard'
        AND resolution.state = 'running'
        AND resolution.operation_id = worker.lifecycle_operation_id
        AND worker.worker_type_id = CASE resolution.target_provider
          WHEN 'baileys' THEN ${EWorkerType.baileys}::uuid
          WHEN 'wwebjs' THEN ${EWorkerType.wwebjs}::uuid
          WHEN 'whatsmeow' THEN ${EWorkerType.whatsmeow}::uuid
        END
        AND runtime.session_storage = 'postgres'
        AND runtime.container_id IS NOT NULL
        AND (
          resolution.cleanup_finalized_at IS NOT NULL
          OR
          session.session_id IS NULL
          OR runtime.source_provider = resolution.source_provider
        )
      LIMIT 1
    `);
    return (
      (
        result as unknown as {
          rows?: WhatsappProviderHandoffDiscardCleanupContext[];
        }
      ).rows?.[0] ?? null
    );
  }

  async viewWhatsappProviderHandoffDiscardPrimaryGate(input: {
    worker_id: string;
    account_id: string;
    operation_id: string;
  }): Promise<WhatsappProviderHandoffDiscardPrimaryGate | null> {
    const result = await this.dbRw.execute(sql`
      SELECT resolution.handoff_id::text,
        resolution.operation_id::text,
        resolution.source_provider,
        resolution.target_provider,
        (session.session_id IS NOT NULL) AS session_present,
        resolution.cleanup_finalized_at::text AS cleanup_finalized_at
      FROM public.worker AS worker
      JOIN public.whatsapp_session_handoff_resolution AS resolution
        ON resolution.session_id = worker.worker_id
       AND resolution.account_id = worker.account_id
      LEFT JOIN public.whatsapp_session AS session
        ON session.session_id = worker.worker_id
      WHERE worker.worker_id = ${input.worker_id}::uuid
        AND worker.account_id = ${input.account_id}::uuid
        AND worker.deleted_at IS NULL
        AND worker.session_storage = 'postgres'
        AND worker.lifecycle_operation_id = ${input.operation_id}::uuid
        AND resolution.action = 'discard'
        AND resolution.operation_id = worker.lifecycle_operation_id
        AND worker.worker_type_id = CASE resolution.target_provider
          WHEN 'baileys' THEN ${EWorkerType.baileys}::uuid
          WHEN 'wwebjs' THEN ${EWorkerType.wwebjs}::uuid
          WHEN 'whatsmeow' THEN ${EWorkerType.whatsmeow}::uuid
        END
      LIMIT 1
    `);
    return (
      (
        result as unknown as {
          rows?: WhatsappProviderHandoffDiscardPrimaryGate[];
        }
      ).rows?.[0] ?? null
    );
  }

  /**
   * A provider switch for a channel that never created whatsapp_session has no
   * handoff row. Absence alone is not authorization: prove the exact worker
   * lifecycle and empty canonical state on the primary before allowing the
   * target runtime to start an interactive connection.
   */
  async viewWhatsappProviderEmptySwitchPrimaryProof(input: {
    worker_id: string;
    account_id: string;
    lifecycle_operation_id: string;
    target_worker_type_id: EWorkerType;
    target_provider: 'baileys' | 'wwebjs' | 'whatsmeow';
  }): Promise<WhatsappProviderEmptySwitchPrimaryProof | null> {
    const result = await this.dbRw.execute(sql`
      SELECT worker.lifecycle_operation_id::text,
        worker.worker_type_id::text,
        runtime.session_storage AS runtime_session_storage,
        runtime.source_provider AS runtime_source_provider
      FROM public.worker AS worker
      LEFT JOIN public.whatsapp_session AS session
        ON session.session_id = worker.worker_id
      LEFT JOIN public.worker_runtime AS runtime
        ON runtime.worker_id = worker.worker_id
      WHERE worker.worker_id = ${input.worker_id}::uuid
        AND worker.account_id = ${input.account_id}::uuid
        AND worker.deleted_at IS NULL
        AND worker.worker_status_id = ${EWorkerStatus.recreating}::uuid
        AND worker.session_storage = 'postgres'
        AND worker.lifecycle_operation_id = ${input.lifecycle_operation_id}::uuid
        AND worker.worker_type_id = ${input.target_worker_type_id}::uuid
        AND ${input.target_provider} = CASE worker.worker_type_id
          WHEN ${EWorkerType.baileys}::uuid THEN 'baileys'
          WHEN ${EWorkerType.wwebjs}::uuid THEN 'wwebjs'
          WHEN ${EWorkerType.whatsmeow}::uuid THEN 'whatsmeow'
        END
        AND session.session_id IS NULL
        AND (
          runtime.worker_id IS NULL
          OR (
            runtime.session_storage = 'postgres'
            AND (
              runtime.source_provider IS NULL
              OR runtime.source_provider = ${input.target_provider}
            )
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.whatsapp_session_handoff AS handoff
          WHERE handoff.session_id = worker.worker_id
            AND handoff.lifecycle_operation_id = worker.lifecycle_operation_id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.whatsapp_session_handoff_resolution AS resolution
          WHERE resolution.session_id = worker.worker_id
            AND resolution.account_id = worker.account_id
            AND resolution.operation_id = worker.lifecycle_operation_id
        )
      LIMIT 1
    `);
    return (
      (
        result as unknown as {
          rows?: WhatsappProviderEmptySwitchPrimaryProof[];
        }
      ).rows?.[0] ?? null
    );
  }

  async finalizeWhatsappProviderHandoffDiscardCleanup(input: {
    worker_id: string;
    account_id: string;
    handoff_id: string;
    operation_id: string;
    expected_runtime_generation: number;
    expected_container_id: string;
  }): Promise<boolean> {
    const result = await this.dbRw.execute(sql`
      SELECT public.finalize_whatsapp_handoff_discard_cleanup(
        ${input.worker_id}::uuid,
        ${input.account_id}::uuid,
        ${input.handoff_id}::uuid,
        ${input.operation_id}::uuid,
        ${input.expected_runtime_generation}::integer,
        ${input.expected_container_id}::text
      ) AS finalized
    `);
    return (
      (result as unknown as { rows?: Array<{ finalized: boolean }> }).rows?.[0]
        ?.finalized === true
    );
  }

  async requestWhatsappProviderHandoffRecovery(input: {
    worker_id: string;
    account_id: string;
    handoff_id: string;
  }): Promise<boolean> {
    const result = await this.dbRw.execute(sql`
      UPDATE public.whatsapp_session_handoff AS handoff
         SET recovery_next_attempt_at = LEAST(
               COALESCE(handoff.recovery_next_attempt_at, clock_timestamp()),
               clock_timestamp()
             ),
             updated_at = statement_timestamp()
        FROM public.worker AS worker
       WHERE worker.worker_id = ${input.worker_id}::uuid
         AND worker.account_id = ${input.account_id}::uuid
         AND worker.deleted_at IS NULL
         AND worker.session_storage = 'postgres'
         AND handoff.session_id = worker.worker_id
         AND handoff.handoff_id = ${input.handoff_id}::uuid
         AND handoff.state = 'failed'
         AND handoff.recovery_state IN ('pending', 'dispatching', 'running')
       RETURNING handoff.handoff_id
    `);
    return Number((result as unknown as { rowCount?: number }).rowCount) === 1;
  }

  async failWhatsappProviderHandoffBeforeSourceDrain(input: {
    worker_id: string;
    account_id: string;
    lifecycle_operation_id: string;
    handoff_id: string;
    source_provider: 'baileys' | 'wwebjs' | 'whatsmeow';
    target_provider: 'baileys' | 'wwebjs' | 'whatsmeow';
    source_revision_id: string;
    target_revision_id: string;
    runtime_generation: number;
    source_container_id: string;
    error_code: string;
  }): Promise<boolean> {
    const result = await this.dbRw.execute(sql`
      SELECT public.fail_whatsapp_handoff_before_source_drain(
        ${input.worker_id}::uuid,
        ${input.account_id}::uuid,
        ${input.lifecycle_operation_id}::uuid,
        ${input.handoff_id}::uuid,
        ${input.source_provider}::text,
        ${input.target_provider}::text,
        ${input.source_revision_id}::bigint,
        ${input.target_revision_id}::bigint,
        ${input.runtime_generation}::integer,
        ${input.source_container_id}::text,
        ${input.error_code}::text
      ) AS failed
    `);
    return (
      (result as unknown as { rows?: Array<{ failed: boolean }> }).rows?.[0]
        ?.failed === true
    );
  }

  async acknowledgeWhatsappProviderHandoffSourceDrained(
    input: AcknowledgeWhatsappProviderHandoffDrainInput
  ): Promise<boolean> {
    const result = await this.dbRw.execute(sql`
      SELECT public.acknowledge_whatsapp_handoff_source_drained(
        ${input.worker_id}::uuid,
        ${input.account_id}::uuid,
        ${input.lifecycle_operation_id}::uuid,
        ${input.handoff_id}::uuid,
        ${input.source_provider}::text,
        ${input.source_revision_id}::bigint,
        ${input.runtime_generation}::integer,
        ${input.checkpoint_checksum_sha256}::text,
        ${input.checkpoint_size_bytes}::bigint,
        ${input.checkpoint_record_count}::bigint
      ) AS acknowledged
    `);
    const rows = (
      result as unknown as { rows?: Array<{ acknowledged: boolean }> }
    ).rows;
    return rows?.[0]?.acknowledged === true;
  }

  async isWhatsappProviderHandoffTargetAuthorized(input: {
    worker_id: string;
    account_id: string;
    lifecycle_operation_id: string;
    target_worker_type_id: string;
  }): Promise<boolean> {
    const targetProvider = resolveRuntimeSourceProvider(
      input.target_worker_type_id
    );
    if (!targetProvider) return false;

    const result = await this.dbRw.execute(sql`
      SELECT EXISTS (
        SELECT 1
        FROM public.worker AS worker
        JOIN public.whatsapp_session_handoff AS handoff
          ON handoff.session_id = worker.worker_id
         AND handoff.lifecycle_operation_id = worker.lifecycle_operation_id
        WHERE worker.worker_id = ${input.worker_id}::uuid
          AND worker.account_id = ${input.account_id}::uuid
          AND worker.lifecycle_operation_id = ${input.lifecycle_operation_id}::uuid
          AND worker.worker_status_id = ${EWorkerStatus.recreating}::uuid
          AND worker.session_storage = 'postgres'
          AND worker.deleted_at IS NULL
          AND handoff.target_provider = ${targetProvider}
          AND worker.worker_type_id = CASE handoff.source_provider
            WHEN 'baileys' THEN ${EWorkerType.baileys}::uuid
            WHEN 'wwebjs' THEN ${EWorkerType.wwebjs}::uuid
            WHEN 'whatsmeow' THEN ${EWorkerType.whatsmeow}::uuid
          END
          AND handoff.state IN (
            'transforming', 'hydrating', 'validating', 'promoting'
          )
      ) AS authorized
    `);
    const rows = (
      result as unknown as { rows?: Array<{ authorized: boolean }> }
    ).rows;
    return rows?.[0]?.authorized === true;
  }

  private async viewByWorkerIdFrom(
    database: NodePgDatabase<typeof schema>,
    workerId: string
  ): Promise<IWorkerRuntime | null> {
    const result = await database
      .select()
      .from(workerRuntime)
      .where(eq(workerRuntime.worker_id, workerId))
      .limit(1)
      .execute();

    return (result[0] as IWorkerRuntime | undefined) ?? null;
  }

  async resolveSessionVolumeName(workerId: string): Promise<string> {
    const runtime = await this.viewByWorkerId(workerId);
    return runtime?.session_volume_name || workerId;
  }

  async isSessionVolumeReferencedConsistent(
    sessionVolumeName: string
  ): Promise<boolean> {
    const [runtime] = await this.dbRw
      .select({ worker_id: workerRuntime.worker_id })
      .from(workerRuntime)
      .where(eq(workerRuntime.session_volume_name, sessionVolumeName))
      .limit(1)
      .execute();

    return Boolean(runtime);
  }

  async isSessionVolumeReferencedByOtherWorkerConsistent(
    sessionVolumeName: string,
    workerId: string
  ): Promise<boolean> {
    const [runtime] = await this.dbRw
      .select({ worker_id: workerRuntime.worker_id })
      .from(workerRuntime)
      .where(
        and(
          eq(workerRuntime.session_volume_name, sessionVolumeName),
          ne(workerRuntime.worker_id, workerId)
        )
      )
      .limit(1)
      .execute();

    return Boolean(runtime);
  }

  /**
   * A failed warm activation must release only the association it installed.
   * The generation and volume predicates fence this compensation from a newer
   * activation while deliberately preserving the adopted session volume.
   */
  async clearWarmPoolReferenceIfMatches(
    input: ClearWorkerRuntimeWarmPoolReferenceInput
  ): Promise<boolean> {
    const result = await this.dbRw
      .update(workerRuntime)
      .set({
        warm_pool_id: null,
        updated_at: currentTime(),
      })
      .where(
        and(
          eq(workerRuntime.worker_id, input.worker_id),
          eq(workerRuntime.warm_pool_id, input.warm_pool_id),
          eq(workerRuntime.runtime_generation, input.runtime_generation),
          eq(workerRuntime.session_volume_name, input.session_volume_name)
        )
      )
      .execute();

    return result.rowCount === 1;
  }

  async tombstoneWarmActivationIfMatches(
    input: TombstoneWarmActivationRuntimeInput
  ): Promise<boolean> {
    const result = await this.dbRw
      .update(workerRuntime)
      .set({
        container_id: null,
        container_name: input.worker_id,
        session_volume_name: input.tombstone_session_volume_name.slice(0, 150),
        warm_pool_id: null,
        connection_epoch: null,
        connection_sequence: 0,
        source_provider: null,
        connection_activated_at: null,
        activated_at: null,
        updated_at: currentTime(),
      })
      .where(
        and(
          eq(workerRuntime.worker_id, input.worker_id),
          eq(workerRuntime.warm_pool_id, input.warm_pool_id),
          eq(workerRuntime.runtime_generation, input.runtime_generation),
          eq(workerRuntime.session_volume_name, input.session_volume_name),
          eq(workerRuntime.container_id, input.container_id)
        )
      )
      .execute();

    return result.rowCount === 1;
  }

  /**
   * A lifecycle gRPC response can be lost after the replacement runtime has
   * already become ready. Reconcile the legacy worker pointer only when the
   * lifecycle snapshot and the exact runtime generation are still current.
   *
   * Keeping the runtime predicate in the same UPDATE prevents a terminal
   * consumer from publishing an older container after a concurrent generation
   * reservation. Repeating the operation is idempotent because the lifecycle
   * fence is cleared by the first successful update.
   */
  async reconcileHealthyRuntimeLifecycle(
    input: ReconcileHealthyRuntimeLifecycleInput
  ): Promise<boolean> {
    const expectedSourceProvider = resolveRuntimeSourceProvider(
      input.worker_type_id
    );
    if (!expectedSourceProvider) {
      return false;
    }

    const now = currentTime();
    const recordsRecreateCompletion = input.lifecycle_action === 'recreate';
    const recreateRuntimeFence = recordsRecreateCompletion
      ? sql`
        AND ${workerRuntime.recreate_bootstrap_operation_id} =
          ${input.lifecycle_operation_id}
        AND ${workerRuntime.recreate_bootstrap_runtime_generation} =
          ${input.runtime_generation}
        AND ${workerRuntime.recreate_bootstrap_container_id} =
          ${input.container_id}
        AND ${workerRuntime.recreate_bootstrap_started_at} IS NOT NULL
        AND ${workerRuntime.recreate_retired_operation_id} IS NULL
        AND ${workerRuntime.recreate_retired_runtime_generation} IS NULL
        AND ${workerRuntime.recreate_retired_container_id} IS NULL
        AND ${workerRuntime.recreate_retired_at} IS NULL
      `
      : sql``;
    const matchingRuntime = sql`EXISTS (
      SELECT 1
      FROM ${workerRuntime}
      WHERE ${workerRuntime.worker_id} = ${input.worker_id}
        AND ${workerRuntime.container_id} = ${input.container_id}
        AND ${workerRuntime.runtime_generation} = ${input.runtime_generation}
        AND ${workerRuntime.source_provider} = ${expectedSourceProvider}
        ${recreateRuntimeFence}
        AND ${workerRuntime.native_connection_online_acknowledged} IS TRUE
        AND ${workerRuntime.native_connection_status_source_id} IS NOT NULL
        AND ${workerRuntime.native_connection_status_sequence}
          BETWEEN 1 AND 9007199254740991
        AND ${workerRuntime.native_connection_status} ->> 'provider' =
          ${workerRuntime.source_provider}
        AND ${workerRuntime.native_connection_status} ->> 'status' = 'online'
        AND ${workerRuntime.native_connection_status} -> 'connected' =
          'true'::jsonb
        AND ${workerRuntime.native_connection_status} -> 'authenticated' =
          'true'::jsonb
        AND ${workerRuntime.native_connection_status} -> 'sessionValid' =
          'true'::jsonb
        AND ${workerRuntime.native_connection_status} -> 'qrAvailable' =
          'false'::jsonb
        AND (
          (
            ${workerRuntime.session_storage} =
              ${EWorkerSessionStorage.legacy_volume}
            AND ${workerRuntime.native_connection_status_lease_owner_id}
              IS NULL
            AND ${workerRuntime.native_connection_status_fencing_token}
              IS NULL
          )
          OR (
            ${workerRuntime.session_storage} =
              ${EWorkerSessionStorage.postgres}
            AND EXISTS (
              SELECT 1
              FROM ${whatsappSessionLease}
              WHERE ${whatsappSessionLease.session_id} =
                ${workerRuntime.worker_id}
                AND ${whatsappSessionLease.provider} =
                  ${workerRuntime.source_provider}
                AND ${whatsappSessionLease.generation} =
                  ${workerRuntime.runtime_generation}
                AND ${whatsappSessionLease.epoch} =
                  ${workerRuntime.session_writer_epoch}
                AND ${whatsappSessionLease.owner_id} =
                  ${workerRuntime.native_connection_status_lease_owner_id}
                AND ${whatsappSessionLease.fencing_token} =
                  ${workerRuntime.native_connection_status_fencing_token}
                AND ${whatsappSessionLease.expires_at} >
                  clock_timestamp() + interval '5 seconds'
            )
          )
        )
    )`;

    return this.dbRw.transaction(async (transaction) => {
      await transaction.execute(sql`SET LOCAL lock_timeout = '5s'`);
      await transaction.execute(sql`SET LOCAL statement_timeout = '15s'`);

      // Recreate retirement and every exact completion take these locks in
      // the same worker -> runtime order. A stale statement snapshot can
      // therefore never clear a lifecycle after its bootstrap was retired.
      const workerLock = await transaction.execute(sql`
        SELECT owner.worker_id::text AS worker_id
        FROM public.worker AS owner
        WHERE owner.worker_id = ${input.worker_id}::uuid
        FOR UPDATE
      `);
      const lockedWorkerId = (
        workerLock as unknown as {
          rows?: Array<{ worker_id?: string }>;
        }
      ).rows?.[0]?.worker_id;
      if (lockedWorkerId !== input.worker_id) {
        return false;
      }

      const runtimeLock = await transaction.execute(sql`
        SELECT runtime.worker_id::text AS worker_id
        FROM public.worker_runtime AS runtime
        WHERE runtime.worker_id = ${input.worker_id}::uuid
        FOR UPDATE
      `);
      const lockedRuntimeWorkerId = (
        runtimeLock as unknown as {
          rows?: Array<{ worker_id?: string }>;
        }
      ).rows?.[0]?.worker_id;
      if (lockedRuntimeWorkerId !== input.worker_id) {
        return false;
      }

      const result = await transaction
        .update(worker)
        .set({
          container_id: input.container_id,
          worker_status_id: EWorkerStatus.online,
          lifecycle_operation_id: null,
          ...(recordsRecreateCompletion
            ? {
                recreate_completed_operation_id: input.lifecycle_operation_id,
                recreate_completed_runtime_generation: input.runtime_generation,
                recreate_completed_at: sql`clock_timestamp()`,
              }
            : {}),
          number: input.phone,
          connection_date: now,
          last_connection_check_at: now,
          updated_at: now,
        })
        .where(
          and(
            eq(worker.worker_id, input.worker_id),
            eq(worker.account_id, input.account_id),
            isNull(worker.deleted_at),
            eq(worker.server_id, input.server_id),
            eq(worker.worker_type_id, input.worker_type_id),
            eq(worker.lifecycle_operation_id, input.lifecycle_operation_id),
            eq(worker.worker_status_id, input.expected_worker_status_id),
            matchingRuntime
          )
        )
        .execute();

      return result.rowCount === 1;
    });
  }

  /**
   * Claims the immutable Docker identity for a generation that was durably
   * reserved before container creation. This closes the create/start ->
   * runtime-upsert crash window without allowing a notification to overwrite
   * a newer generation or a superseding lifecycle operation.
   */
  async claimReservedRuntimeContainer(
    input: ClaimReservedRuntimeContainerInput
  ): Promise<boolean> {
    return this.claimRuntimeContainerWithWorkerFence({
      ...input,
      expected_current_server_id: input.server_id,
      expected_current_worker_type_id: input.worker_type_id,
    });
  }

  /**
   * Records the customer-facing bootstrap boundary through the database-owned
   * worker -> runtime CAS. The SQL function is not granted to runtime roles;
   * only the manager may advance this marker after physical activation.
   */
  async markRecreateBootstrapStarted(
    input: MarkWorkerRecreateBootstrapStartedInput
  ): Promise<boolean> {
    const result = await this.dbRw.execute(sql`
      SELECT public.mark_worker_recreate_bootstrap_started(
        ${input.worker_id}::uuid,
        ${input.account_id}::uuid,
        ${input.server_id}::uuid,
        ${input.lifecycle_operation_id}::uuid,
        ${input.runtime_generation}::integer,
        ${input.container_id}::text
      ) AS marked
    `);
    return Boolean(
      (
        result as unknown as {
          rows?: Array<{ marked?: boolean }>;
        }
      ).rows?.[0]?.marked === true
    );
  }

  /**
   * Claims a generation created by the previous provider/server after the
   * worker row has already moved to its target identity. Keeping both
   * identities explicit prevents the lifecycle CAS from being evaluated
   * against the retired provider.
   */
  async claimPreviousRuntimeContainer(
    input: ClaimPreviousRuntimeContainerInput
  ): Promise<boolean> {
    const expectedPreviousProvider = resolveRuntimeSourceProvider(
      input.previous_worker_type_id
    );
    const runtimeSourceProvider = input.source_provider?.trim().toLowerCase();
    const hasValidSessionCleanupIntent =
      input.session_storage === EWorkerSessionStorage.legacy_volume
        ? input.remove_session === true &&
          input.remove_volume === true &&
          Boolean(input.session_volume_name)
        : input.session_storage === EWorkerSessionStorage.postgres
          ? input.remove_session === false &&
            input.remove_volume === false &&
            input.session_volume_name === null
          : false;
    if (
      !hasValidSessionCleanupIntent ||
      !expectedPreviousProvider ||
      (input.session_storage !== EWorkerSessionStorage.postgres &&
        input.current_server_id === input.previous_server_id &&
        input.current_worker_type_id === input.previous_worker_type_id) ||
      (runtimeSourceProvider &&
        runtimeSourceProvider !== expectedPreviousProvider)
    ) {
      return false;
    }

    return this.claimRuntimeContainerWithWorkerFence({
      worker_id: input.worker_id,
      account_id: input.account_id,
      expected_current_server_id: input.current_server_id,
      expected_current_worker_type_id: input.current_worker_type_id,
      lifecycle_operation_id: input.lifecycle_operation_id,
      expected_worker_status_id: input.expected_worker_status_id,
      container_id: input.container_id,
      container_name: input.container_name,
      session_storage: input.session_storage,
      session_volume_name: input.session_volume_name,
      runtime_generation: input.runtime_generation,
      warm_pool_id: input.warm_pool_id,
      source_provider: input.source_provider,
    });
  }

  private async claimRuntimeContainerWithWorkerFence(
    input: ClaimRuntimeContainerWithWorkerFenceInput
  ): Promise<boolean> {
    const now = currentTime();
    const lifecycleOperationMatches =
      input.lifecycle_operation_id === null
        ? sql`${worker.lifecycle_operation_id} IS NULL`
        : sql`${worker.lifecycle_operation_id} = ${input.lifecycle_operation_id}`;
    const expectedTargetProvider = resolveRuntimeSourceProvider(
      input.expected_current_worker_type_id
    );
    const workerTypeStillOwnsReservation = expectedTargetProvider
      ? sql`(
          ${worker.worker_type_id} = ${input.expected_current_worker_type_id}
          OR (
            ${input.session_storage} = ${EWorkerSessionStorage.postgres}
            AND EXISTS (
              SELECT 1
              FROM public.whatsapp_session_handoff AS handoff
              WHERE handoff.session_id = ${worker.worker_id}
                AND handoff.lifecycle_operation_id = ${worker.lifecycle_operation_id}
                AND handoff.target_provider = ${expectedTargetProvider}
                AND ${worker.worker_type_id} = CASE handoff.source_provider
                  WHEN 'baileys' THEN ${EWorkerType.baileys}::uuid
                  WHEN 'wwebjs' THEN ${EWorkerType.wwebjs}::uuid
                  WHEN 'whatsmeow' THEN ${EWorkerType.whatsmeow}::uuid
                END
                AND handoff.state IN (
                  'transforming', 'hydrating', 'validating', 'promoting'
                )
            )
          )
        )`
      : sql`${worker.worker_type_id} = ${input.expected_current_worker_type_id}`;
    const lifecycleStillOwnsReservation = sql`EXISTS (
      SELECT 1
      FROM ${worker}
      WHERE ${worker.worker_id} = ${input.worker_id}
        AND ${worker.account_id} = ${input.account_id}
        AND ${worker.deleted_at} IS NULL
        AND ${worker.server_id} = ${input.expected_current_server_id}
        AND ${workerTypeStillOwnsReservation}
        AND ${lifecycleOperationMatches}
        AND ${worker.worker_status_id} = ${input.expected_worker_status_id}
    )`;
    const result = await this.dbRw
      .update(workerRuntime)
      .set({
        container_id: input.container_id,
        activated_at: now,
        updated_at: now,
      })
      .where(
        and(
          eq(workerRuntime.worker_id, input.worker_id),
          isNull(workerRuntime.container_id),
          eq(workerRuntime.container_name, input.container_name),
          eq(workerRuntime.session_storage, input.session_storage),
          input.session_volume_name === null
            ? isNull(workerRuntime.session_volume_name)
            : eq(workerRuntime.session_volume_name, input.session_volume_name),
          eq(workerRuntime.runtime_generation, input.runtime_generation),
          input.warm_pool_id !== null && input.warm_pool_id !== undefined
            ? eq(workerRuntime.warm_pool_id, input.warm_pool_id)
            : isNull(workerRuntime.warm_pool_id),
          input.source_provider
            ? eq(workerRuntime.source_provider, input.source_provider)
            : isNull(workerRuntime.source_provider),
          lifecycleStillOwnsReservation
        )
      )
      .execute();

    return result.rowCount === 1;
  }

  async reserveNextRuntimeGeneration(
    input: ReserveWorkerRuntimeGenerationInput
  ): Promise<number> {
    const now = currentTime();
    const minimumRuntimeGeneration =
      Number.isSafeInteger(input.minimum_runtime_generation) &&
      Number(input.minimum_runtime_generation) > 0
        ? Number(input.minimum_runtime_generation)
        : 1;
    const [reservation] = await this.dbRw
      .insert(workerRuntime)
      .values({
        worker_id: input.worker_id,
        container_id: null,
        container_name: input.container_name ?? input.worker_id,
        session_storage: input.session_storage,
        session_volume_name: input.session_volume_name,
        runtime_generation: minimumRuntimeGeneration,
        warm_pool_id: input.warm_pool_id ?? null,
        activated_at: now,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: workerRuntime.worker_id,
        set: {
          container_id: null,
          container_name: input.container_name ?? input.worker_id,
          session_storage: input.session_storage,
          session_volume_name: input.session_volume_name,
          runtime_capability_hash: null,
          session_writer_epoch: null,
          runtime_generation: sql`GREATEST(
            ${workerRuntime.runtime_generation} + 1,
            ${minimumRuntimeGeneration}
          )`,
          connection_epoch: null,
          connection_sequence: 0,
          source_provider: null,
          connection_activated_at: null,
          warm_pool_id: input.warm_pool_id ?? null,
          activated_at: now,
          updated_at: now,
        },
      })
      .returning({ runtime_generation: workerRuntime.runtime_generation })
      .execute();

    if (!reservation) {
      throw new Error('Failed to reserve worker runtime generation');
    }

    return reservation.runtime_generation;
  }

  /**
   * Fences a failed liveness replacement before the host removes it. The
   * worker row is locked before worker_runtime, matching every provider status
   * transaction. A provider that won ONLINE before this transaction makes the
   * worker snapshot fail; one waiting behind it wakes with its capability,
   * writer epoch and activation revoked and therefore cannot re-admit the
   * failed generation. Container/generation identity is retained so host
   * removal can be retried idempotently.
   */
  async revokeFailedOnlineLivenessReplacementRuntime(
    input: RevokeFailedOnlineLivenessReplacementRuntimeInput
  ): Promise<boolean> {
    const workerId = input.worker_id?.trim();
    const accountId = input.account_id?.trim();
    const serverId = input.server_id?.trim();
    const lifecycleOperationId = input.lifecycle_operation_id?.trim();
    const expectedOldContainerId = input.expected_old_container_id
      ?.trim()
      .toLowerCase();
    const failedContainerId = input.failed_container_id?.trim().toLowerCase();
    const expectedOldRuntimeGeneration = input.expected_old_runtime_generation;
    const failedRuntimeGeneration = input.failed_runtime_generation;
    const expectedProvider = resolveRuntimeSourceProvider(input.worker_type_id);
    if (
      !workerId ||
      !UUID_PATTERN.test(workerId) ||
      !accountId ||
      !UUID_PATTERN.test(accountId) ||
      !serverId ||
      !lifecycleOperationId ||
      !expectedProvider ||
      !/^[0-9a-f]{64}$/u.test(expectedOldContainerId ?? '') ||
      !/^[0-9a-f]{64}$/u.test(failedContainerId ?? '') ||
      expectedOldContainerId === failedContainerId ||
      !Number.isSafeInteger(expectedOldRuntimeGeneration) ||
      expectedOldRuntimeGeneration <= 0 ||
      !Number.isSafeInteger(failedRuntimeGeneration) ||
      failedRuntimeGeneration <= expectedOldRuntimeGeneration
    ) {
      return false;
    }

    try {
      return await this.dbRw.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout = '10s'`);
        await tx.execute(sql`SET LOCAL statement_timeout = '20s'`);

        const workerResult = await tx.execute(sql`
        SELECT "worker_id"::text AS "worker_id",
               "account_id"::text AS "account_id",
               "server_id"::text AS "server_id",
               "worker_type_id"::text AS "worker_type_id",
               "worker_status_id"::text AS "worker_status_id",
               "session_storage",
               "lifecycle_operation_id"::text AS "lifecycle_operation_id",
               lower(trim("container_id")) AS "container_id",
               "deleted_at"
        FROM "worker"
        WHERE "worker_id" = ${workerId}::uuid
        FOR UPDATE
      `);
        const workerRow = (
          workerResult as unknown as {
            rows?: Array<{
              worker_id?: string;
              account_id?: string;
              server_id?: string;
              worker_type_id?: string;
              worker_status_id?: string;
              session_storage?: string;
              lifecycle_operation_id?: string | null;
              container_id?: string | null;
              deleted_at?: string | null;
            }>;
          }
        ).rows?.[0];
        if (
          !workerRow ||
          workerRow.worker_id !== workerId ||
          workerRow.account_id !== accountId ||
          workerRow.server_id !== serverId ||
          workerRow.worker_type_id !== input.worker_type_id ||
          workerRow.worker_status_id !== EWorkerStatus.recreating ||
          (workerRow.session_storage !== EWorkerSessionStorage.postgres &&
            workerRow.session_storage !==
              EWorkerSessionStorage.legacy_volume) ||
          workerRow.lifecycle_operation_id !== lifecycleOperationId ||
          workerRow.container_id !== expectedOldContainerId ||
          workerRow.deleted_at
        ) {
          return false;
        }

        const runtimeResult = await tx.execute(sql`
        SELECT lower(trim("container_id")) AS "container_id",
               "runtime_generation",
               "session_storage",
               "runtime_capability_hash",
               "session_writer_epoch"::text AS "session_writer_epoch",
               "connection_epoch"::text AS "connection_epoch",
               "connection_sequence",
               "source_provider",
               "connection_activated_at",
               "recreate_bootstrap_operation_id"::text
                 AS "recreate_bootstrap_operation_id",
               "recreate_bootstrap_runtime_generation",
               lower(trim("recreate_bootstrap_container_id"))
                 AS "recreate_bootstrap_container_id",
               "recreate_bootstrap_started_at",
               "recreate_retired_operation_id"::text
                 AS "recreate_retired_operation_id",
               "recreate_retired_runtime_generation",
               lower(trim("recreate_retired_container_id"))
                 AS "recreate_retired_container_id",
               "recreate_retired_at",
               "native_connection_status_lease_owner_id"::text
                 AS "native_connection_status_lease_owner_id",
               "native_connection_status_fencing_token"
                 AS "native_connection_status_fencing_token"
        FROM "worker_runtime"
        WHERE "worker_id" = ${workerId}::uuid
        FOR UPDATE
      `);
        const runtimeRow = (
          runtimeResult as unknown as {
            rows?: Array<{
              container_id?: string | null;
              runtime_generation?: number | string;
              session_storage?: string;
              runtime_capability_hash?: string | null;
              session_writer_epoch?: string | null;
              connection_epoch?: string | null;
              connection_sequence?: number | string;
              source_provider?: string | null;
              connection_activated_at?: string | null;
              recreate_bootstrap_operation_id?: string | null;
              recreate_bootstrap_runtime_generation?: number | string | null;
              recreate_bootstrap_container_id?: string | null;
              recreate_bootstrap_started_at?: string | null;
              recreate_retired_operation_id?: string | null;
              recreate_retired_runtime_generation?: number | string | null;
              recreate_retired_container_id?: string | null;
              recreate_retired_at?: string | null;
              native_connection_status_lease_owner_id?: string | null;
              native_connection_status_fencing_token?: number | string | null;
            }>;
          }
        ).rows?.[0];
        if (
          !runtimeRow ||
          runtimeRow.container_id !== failedContainerId ||
          Number(runtimeRow.runtime_generation) !== failedRuntimeGeneration ||
          runtimeRow.session_storage !== workerRow.session_storage
        ) {
          return false;
        }

        const retirementMarkerEmpty =
          !runtimeRow.recreate_retired_operation_id &&
          !runtimeRow.recreate_retired_runtime_generation &&
          !runtimeRow.recreate_retired_container_id &&
          !runtimeRow.recreate_retired_at;
        const exactRetirementMarker =
          runtimeRow.recreate_retired_operation_id === lifecycleOperationId &&
          Number(runtimeRow.recreate_retired_runtime_generation) ===
            failedRuntimeGeneration &&
          runtimeRow.recreate_retired_container_id === failedContainerId &&
          Boolean(runtimeRow.recreate_retired_at);
        if (!retirementMarkerEmpty && !exactRetirementMarker) {
          return false;
        }

        const runtimeAlreadyRevoked =
          exactRetirementMarker &&
          !runtimeRow.runtime_capability_hash &&
          !runtimeRow.session_writer_epoch &&
          !runtimeRow.connection_epoch &&
          Number(runtimeRow.connection_sequence) === 0 &&
          !runtimeRow.source_provider &&
          !runtimeRow.connection_activated_at &&
          !runtimeRow.recreate_bootstrap_operation_id &&
          !runtimeRow.recreate_bootstrap_runtime_generation &&
          !runtimeRow.recreate_bootstrap_container_id &&
          !runtimeRow.recreate_bootstrap_started_at;

        if (runtimeRow.session_storage === EWorkerSessionStorage.postgres) {
          await tx.execute(sql`
          SELECT set_config('app.whatsapp_session_id', ${workerId}, true)
        `);
          const leaseResult = await tx.execute(sql`
          SELECT "owner_id"::text AS "owner_id",
                 "provider",
                 "fencing_token",
                 "generation",
                 "epoch"::text AS "epoch",
                 "acquired_at",
                 "heartbeat_at",
                 "expires_at"
          FROM "whatsapp_session_lease"
          WHERE "session_id" = ${workerId}::uuid
          FOR UPDATE
        `);
          const leaseRow = (
            leaseResult as unknown as {
              rows?: Array<{
                owner_id?: string | null;
                provider?: string | null;
                fencing_token?: number | string;
                generation?: number | string;
                epoch?: string | null;
                acquired_at?: string | null;
                heartbeat_at?: string | null;
                expires_at?: string | null;
              }>;
            }
          ).rows?.[0];
          if (!leaseRow) {
            return false;
          }
          const leaseAlreadyReleased =
            !leaseRow.owner_id &&
            !leaseRow.provider &&
            !leaseRow.epoch &&
            !leaseRow.acquired_at &&
            !leaseRow.heartbeat_at &&
            !leaseRow.expires_at;
          if (
            !Number.isSafeInteger(Number(leaseRow.generation)) ||
            Number(leaseRow.generation) < expectedOldRuntimeGeneration ||
            Number(leaseRow.generation) > failedRuntimeGeneration
          ) {
            return false;
          }

          // Lease functions lock lease -> session. Keep that order inside the
          // wider worker -> runtime lifecycle fence so an old process can neither
          // renew nor reacquire after this transaction commits.
          const sessionResult = await tx.execute(sql`
          SELECT "provider",
                 "generation",
                 "epoch"::text AS "epoch",
                 "capability_hash"
          FROM "whatsapp_session"
          WHERE "session_id" = ${workerId}::uuid
          FOR UPDATE
        `);
          const sessionRow = (
            sessionResult as unknown as {
              rows?: Array<{
                provider?: string;
                generation?: number | string;
                epoch?: string | null;
                capability_hash?: string | null;
              }>;
            }
          ).rows?.[0];
          const sessionGeneration = Number(sessionRow?.generation);
          if (
            !sessionRow ||
            sessionRow.provider !== expectedProvider ||
            !Number.isSafeInteger(sessionGeneration) ||
            sessionGeneration < expectedOldRuntimeGeneration ||
            sessionGeneration > failedRuntimeGeneration
          ) {
            return false;
          }

          const sessionAlreadyRevoked =
            !sessionRow.epoch && !sessionRow.capability_hash;
          if (
            Boolean(sessionRow.epoch) !== Boolean(sessionRow.capability_hash) ||
            (!sessionAlreadyRevoked &&
              !/^[0-9a-f]{64}$/u.test(sessionRow.capability_hash ?? '')) ||
            (sessionGeneration === failedRuntimeGeneration &&
              !sessionAlreadyRevoked &&
              (runtimeRow.source_provider !== expectedProvider ||
                sessionRow.epoch !== runtimeRow.session_writer_epoch ||
                sessionRow.capability_hash !==
                  runtimeRow.runtime_capability_hash)) ||
            (sessionGeneration < failedRuntimeGeneration &&
              !sessionAlreadyRevoked &&
              runtimeRow.source_provider !== null)
          ) {
            return false;
          }

          if (!leaseAlreadyReleased) {
            const leaseGeneration = Number(leaseRow.generation);
            const leaseMatchesCurrentHeader =
              leaseGeneration === sessionGeneration &&
              leaseRow.epoch === sessionRow.epoch;
            const leaseIsRetiringEarlierWriter =
              leaseGeneration < sessionGeneration && Boolean(leaseRow.epoch);
            if (
              !leaseRow.owner_id ||
              leaseRow.provider !== expectedProvider ||
              !leaseRow.epoch ||
              !leaseRow.acquired_at ||
              !leaseRow.heartbeat_at ||
              !leaseRow.expires_at ||
              !/^[1-9][0-9]*$/u.test(String(leaseRow.fencing_token)) ||
              (!leaseMatchesCurrentHeader && !leaseIsRetiringEarlierWriter)
            ) {
              return false;
            }
            const released = await tx.execute(sql`
            UPDATE "whatsapp_session_lease"
            SET "owner_id" = NULL,
                "provider" = NULL,
                "fencing_token" = "fencing_token" + 1,
                "epoch" = NULL,
                "acquired_at" = NULL,
                "heartbeat_at" = NULL,
                "expires_at" = NULL
            WHERE "session_id" = ${workerId}::uuid
              AND "owner_id" = ${leaseRow.owner_id}::uuid
              AND "provider" = ${leaseRow.provider}
              AND "fencing_token" = ${String(leaseRow.fencing_token)}::bigint
              AND "generation" = ${Number(leaseRow.generation)}
              AND "epoch" = ${leaseRow.epoch}::uuid
          `);
            if ((released.rowCount ?? 0) !== 1) {
              throw new WorkerRuntimeRetirementAtomicityError(
                'failed to release PostgreSQL session lease'
              );
            }
          }

          if (!sessionAlreadyRevoked) {
            const invalidatedSession = await tx.execute(sql`
            UPDATE "whatsapp_session"
            SET "epoch" = NULL,
                "capability_hash" = NULL,
                "updated_at" = clock_timestamp()
            WHERE "session_id" = ${workerId}::uuid
              AND "provider" = ${sessionRow.provider}
              AND "generation" = ${sessionGeneration}
              AND "epoch" = ${sessionRow.epoch}::uuid
              AND "capability_hash" = ${sessionRow.capability_hash}
          `);
            if ((invalidatedSession.rowCount ?? 0) !== 1) {
              throw new WorkerRuntimeRetirementAtomicityError(
                'failed to invalidate PostgreSQL session header'
              );
            }
          }
        } else if (
          runtimeRow.session_storage !== EWorkerSessionStorage.legacy_volume ||
          runtimeRow.native_connection_status_lease_owner_id ||
          runtimeRow.native_connection_status_fencing_token !== null
        ) {
          return false;
        }

        if (runtimeAlreadyRevoked) {
          return true;
        }

        const revoked = await tx.execute(sql`
        UPDATE "worker_runtime"
        SET "runtime_capability_hash" = NULL,
            "session_writer_epoch" = NULL,
            "connection_epoch" = NULL,
            "connection_sequence" = 0,
            "source_provider" = NULL,
            "connection_activated_at" = NULL,
            "recreate_bootstrap_operation_id" = NULL,
            "recreate_bootstrap_runtime_generation" = NULL,
            "recreate_bootstrap_container_id" = NULL,
            "recreate_bootstrap_started_at" = NULL,
            "recreate_retired_operation_id" = ${lifecycleOperationId}::uuid,
            "recreate_retired_runtime_generation" = ${failedRuntimeGeneration},
            "recreate_retired_container_id" = "container_id",
            "recreate_retired_at" = COALESCE(
              "recreate_retired_at",
              CASE
                WHEN "recreate_bootstrap_started_at" IS NULL
                  THEN clock_timestamp()
                ELSE GREATEST(
                  clock_timestamp(),
                  "recreate_bootstrap_started_at" + interval '1 millisecond'
                )
              END
            ),
            "native_connection_status" = NULL,
            "native_connection_public_status" = NULL,
            "native_connection_status_source_id" = NULL,
            "native_connection_status_sequence" = NULL,
            "native_connection_status_outbox_id" = NULL,
            "native_connection_status_lease_owner_id" = NULL,
            "native_connection_status_fencing_token" = NULL,
            "native_connection_status_changed_at_high_watermark" = NULL,
            "native_connection_status_retired_source_ids" = '{}'::uuid[],
            "native_connection_online_acknowledged" = false,
            "updated_at" = clock_timestamp()
        WHERE "worker_id" = ${workerId}::uuid
          AND "runtime_generation" = ${failedRuntimeGeneration}
          AND lower(trim("container_id")) = ${failedContainerId}
          AND (
            "recreate_retired_operation_id" IS NULL
            OR (
              "recreate_retired_operation_id" = ${lifecycleOperationId}::uuid
              AND "recreate_retired_runtime_generation" =
                ${failedRuntimeGeneration}
              AND lower(trim("recreate_retired_container_id")) =
                ${failedContainerId}
              AND "recreate_retired_at" IS NOT NULL
            )
          )
      `);
        if ((revoked.rowCount ?? 0) !== 1) {
          throw new WorkerRuntimeRetirementAtomicityError(
            'failed to revoke worker runtime authority'
          );
        }
        return true;
      });
    } catch (error) {
      if (error instanceof WorkerRuntimeRetirementAtomicityError) {
        return false;
      }
      throw error;
    }
  }

  async prepareRuntimeWriterIdentity(
    input: PrepareWorkerRuntimeWriterIdentityInput
  ): Promise<boolean> {
    const result = await this.dbRw
      .update(workerRuntime)
      .set({
        runtime_capability_hash: input.runtime_capability_hash,
        session_writer_epoch: input.session_writer_epoch,
        updated_at: currentTime(),
      })
      .where(
        and(
          eq(workerRuntime.worker_id, input.worker_id),
          eq(workerRuntime.runtime_generation, input.runtime_generation),
          isNull(workerRuntime.container_id)
        )
      )
      .execute();

    return result.rowCount === 1;
  }

  /**
   * Deletes one channel's PostgreSQL session only while the lifecycle that
   * removed its container still owns the exact durable worker/runtime
   * snapshot. The worker row is locked before worker_runtime to match the
   * canonical lifecycle lock order. Session writers already lock the runtime
   * row, so this also waits for in-flight writes. The accepted transaction
   * revokes the writer capability/epoch before deleting data, preventing a
   * queued stale writer from resuming after commit or crossing a generation
   * reservation.
   *
   * The delete statements deliberately do not depend on affected-row counts:
   * retrying the same accepted fence after a crash is idempotent. A changed
   * lifecycle, generation or container returns false without touching session
   * data.
   */
  async deletePostgresWhatsappSessionByWorkerId(
    input: DeletePostgresWhatsappSessionInput
  ): Promise<boolean> {
    const workerId = input.worker_id?.trim();
    const accountId = input.account_id?.trim();
    const lifecycleOperationId = input.lifecycle_operation_id?.trim();
    const expectedStatus = input.expected_worker_status_id;
    const expectedRuntimeGeneration = input.expected_runtime_generation;
    const expectedContainerId =
      input.expected_container_id === null
        ? null
        : input.expected_container_id?.trim();
    const expectedRuntimeSessionStorage =
      input.expected_runtime_session_storage ?? EWorkerSessionStorage.postgres;
    const expectedSessionVolumeName =
      input.expected_session_volume_name === null ||
      input.expected_session_volume_name === undefined
        ? null
        : input.expected_session_volume_name.trim();
    const acceptsLegacyConversionRuntime =
      expectedRuntimeSessionStorage === EWorkerSessionStorage.legacy_volume &&
      expectedStatus === EWorkerStatus.recreating &&
      expectedRuntimeGeneration !== null &&
      Boolean(expectedContainerId) &&
      Boolean(expectedSessionVolumeName);
    const acceptsPostgresRuntime =
      expectedRuntimeSessionStorage === EWorkerSessionStorage.postgres &&
      expectedSessionVolumeName === null;
    if (
      !workerId ||
      !accountId ||
      !lifecycleOperationId ||
      (expectedStatus !== EWorkerStatus.recreating &&
        expectedStatus !== EWorkerStatus.deleting) ||
      (expectedRuntimeGeneration !== null &&
        (!Number.isSafeInteger(expectedRuntimeGeneration) ||
          expectedRuntimeGeneration <= 0)) ||
      (input.expected_container_id !== null && !expectedContainerId) ||
      (expectedRuntimeGeneration === null && expectedContainerId !== null) ||
      (!acceptsPostgresRuntime && !acceptsLegacyConversionRuntime)
    ) {
      return false;
    }

    return this.dbRw.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '10s'`);
      await tx.execute(sql`SET LOCAL statement_timeout = '20s'`);

      const workerResult = await tx.execute(sql`
        SELECT "account_id"::text AS "account_id",
               "lifecycle_operation_id"::text AS "lifecycle_operation_id",
               "worker_status_id"::text AS "worker_status_id",
               "session_storage",
               "deleted_at"
        FROM "worker"
        WHERE "worker_id" = ${workerId}::uuid
        FOR UPDATE
      `);
      const workerRow = (
        workerResult as unknown as {
          rows?: Array<{
            account_id?: string;
            lifecycle_operation_id?: string | null;
            worker_status_id?: string;
            session_storage?: string;
            deleted_at?: string | null;
          }>;
        }
      ).rows?.[0];
      if (
        !workerRow ||
        workerRow.account_id !== accountId ||
        workerRow.lifecycle_operation_id !== lifecycleOperationId ||
        workerRow.worker_status_id !== expectedStatus ||
        workerRow.session_storage !== EWorkerSessionStorage.postgres ||
        (expectedStatus === EWorkerStatus.recreating && workerRow.deleted_at)
      ) {
        return false;
      }

      const runtime = await tx.execute(sql`
        SELECT "session_storage", "session_volume_name",
               "runtime_generation", "container_id"
        FROM "worker_runtime"
        WHERE "worker_id" = ${workerId}::uuid
        FOR UPDATE
      `);
      const row = (
        runtime as unknown as {
          rows?: Array<{
            session_storage?: string;
            session_volume_name?: string | null;
            runtime_generation?: number | string;
            container_id?: string | null;
          }>;
        }
      ).rows?.[0];
      if (expectedRuntimeGeneration === null) {
        if (row) {
          return false;
        }
      } else if (
        !row ||
        row.session_storage !== expectedRuntimeSessionStorage ||
        (row.session_volume_name ?? null) !== expectedSessionVolumeName ||
        Number(row.runtime_generation) !== expectedRuntimeGeneration ||
        (row.container_id ?? null) !== expectedContainerId
      ) {
        return false;
      }

      if (
        expectedRuntimeGeneration !== null &&
        expectedRuntimeSessionStorage === EWorkerSessionStorage.postgres
      ) {
        // A session writer that was already waiting on worker_runtime must
        // wake up stale after this transaction commits. Keeping generation
        // and container intact preserves deletion retries, while revoking the
        // capability/epoch prevents the retired runtime from recreating the
        // just-deleted session before the next generation is reserved.
        await tx.execute(sql`
          UPDATE "worker_runtime"
          SET "runtime_capability_hash" = NULL,
              "session_writer_epoch" = NULL,
              "connection_epoch" = NULL,
              "source_provider" = NULL,
              "connection_activated_at" = NULL,
              "updated_at" = clock_timestamp()
          WHERE "worker_id" = ${workerId}::uuid
            AND "runtime_generation" = ${expectedRuntimeGeneration}
            AND "container_id" IS NOT DISTINCT FROM ${expectedContainerId}
        `);
      }

      // FORCE RLS remains active for the control-plane connection. Install the
      // exact transaction-local scope, then remove the header before its
      // revisions so the active/previous composite FKs cannot block cleanup.
      await tx.execute(sql`
        SELECT set_config('app.whatsapp_session_id', ${workerId}, true)
      `);
      await tx.execute(sql`
        DELETE FROM "whatsapp_session_handoff"
        WHERE "session_id" = ${workerId}::uuid
      `);
      // The session cascade reaches artifact blobs before PostgreSQL can
      // guarantee that artifact chunks are gone. Chunks intentionally keep a
      // RESTRICT reference to blobs so garbage collection cannot remove a
      // referenced payload. Delete the dependent chunks explicitly first,
      // matching clear_whatsapp_session's dependency order and keeping the
      // protective FK semantics intact.
      await tx.execute(sql`
        DELETE FROM "whatsapp_artifact_chunk"
        WHERE "session_id" = ${workerId}::uuid
      `);
      await tx.execute(sql`
        DELETE FROM "whatsapp_session"
        WHERE "session_id" = ${workerId}::uuid
      `);
      await tx.execute(sql`
        DELETE FROM "whatsapp_session_revision"
        WHERE "session_id" = ${workerId}::uuid
      `);
      return true;
    });
  }

  /**
   * Installs the exact connection-epoch tombstone before the provider logout.
   * Locking the canonical header after worker/runtime drains every session
   * writer that started before the barrier; subsequent writes are rejected by
   * the migration trigger until a genuinely new connection epoch activates.
   */
  async prepareWorkerConnectionDisconnect(
    input: PrepareWorkerConnectionDisconnectInput
  ): Promise<PrepareWorkerConnectionDisconnectResult> {
    const workerId = input.worker_id?.trim();
    const accountId = input.account_id?.trim();
    const expectedContainerId =
      input.expected_container_id === null
        ? null
        : input.expected_container_id?.trim();
    const expectedConnectionEpoch =
      input.expected_connection_epoch === null
        ? null
        : input.expected_connection_epoch?.trim();
    const expectedRuntimeGeneration = input.expected_runtime_generation;
    if (
      !workerId ||
      !accountId ||
      !Number.isSafeInteger(expectedRuntimeGeneration) ||
      expectedRuntimeGeneration <= 0 ||
      (input.expected_container_id !== null && !expectedContainerId) ||
      (input.expected_connection_epoch !== null && !expectedConnectionEpoch)
    ) {
      throw new TypeError('Invalid worker connection disconnect fence');
    }

    return this.dbRw.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '10s'`);
      await tx.execute(sql`SET LOCAL statement_timeout = '20s'`);

      const workerResult = await tx.execute(sql`
        SELECT owner.account_id::text AS account_id,
               owner.lifecycle_operation_id::text AS lifecycle_operation_id,
               owner.session_storage,
               owner.deleted_at
        FROM public.worker AS owner
        WHERE owner.worker_id = ${workerId}::uuid
        FOR UPDATE
      `);
      const workerRow = (
        workerResult as unknown as {
          rows?: Array<{
            account_id?: string;
            lifecycle_operation_id?: string | null;
            session_storage?: string;
            deleted_at?: string | null;
          }>;
        }
      ).rows?.[0];
      if (
        !workerRow ||
        workerRow.account_id !== accountId ||
        workerRow.deleted_at
      ) {
        return { status: 'not_found' } as const;
      }
      if (workerRow.lifecycle_operation_id) {
        return {
          status: 'lifecycle_active',
          lifecycle_operation_id: workerRow.lifecycle_operation_id,
        } as const;
      }

      const runtimeResult = await tx.execute(sql`
        SELECT runtime.runtime_generation,
               runtime.container_id,
               runtime.session_storage,
               runtime.connection_epoch,
               runtime.disconnected_connection_epoch,
               runtime.connection_disconnected_at
        FROM public.worker_runtime AS runtime
        WHERE runtime.worker_id = ${workerId}::uuid
        FOR UPDATE
      `);
      const runtimeRow = (
        runtimeResult as unknown as {
          rows?: Array<{
            runtime_generation?: number | string;
            container_id?: string | null;
            session_storage?: string;
            connection_epoch?: string | null;
            disconnected_connection_epoch?: string | null;
            connection_disconnected_at?: string | null;
          }>;
        }
      ).rows?.[0];
      if (
        !runtimeRow ||
        Number(runtimeRow.runtime_generation) !== expectedRuntimeGeneration ||
        (runtimeRow.container_id ?? null) !== expectedContainerId ||
        (runtimeRow.connection_epoch ?? null) !== expectedConnectionEpoch ||
        runtimeRow.session_storage !== workerRow.session_storage
      ) {
        return { status: 'runtime_mismatch' } as const;
      }

      // Wait for every transaction that already owns the canonical session
      // or lease before committing the barrier. Their writes therefore finish
      // before provider cleanup; later writes observe the tombstone and fail.
      if (workerRow.session_storage === EWorkerSessionStorage.postgres) {
        await tx.execute(sql`
          SELECT set_config('app.whatsapp_session_id', ${workerId}, true)
        `);
        await tx.execute(sql`
          SELECT session.session_id
          FROM public.whatsapp_session AS session
          WHERE session.session_id = ${workerId}::uuid
          FOR UPDATE
        `);
        await tx.execute(sql`
          SELECT lease.session_id
          FROM public.whatsapp_session_lease AS lease
          WHERE lease.session_id = ${workerId}::uuid
          FOR SHARE
        `);
      }

      const alreadyPrepared =
        !isNullish(runtimeRow.connection_disconnected_at) &&
        (runtimeRow.disconnected_connection_epoch ?? null) ===
          expectedConnectionEpoch;
      if (alreadyPrepared) {
        return { status: 'prepared', already_prepared: true } as const;
      }
      if (!isNullish(runtimeRow.connection_disconnected_at)) {
        return { status: 'runtime_mismatch' } as const;
      }

      const prepared = await tx.execute(sql`
        UPDATE public.worker_runtime AS runtime
        SET disconnected_connection_epoch = runtime.connection_epoch,
            connection_disconnected_at = clock_timestamp(),
            updated_at = clock_timestamp()
        WHERE runtime.worker_id = ${workerId}::uuid
          AND runtime.runtime_generation = ${expectedRuntimeGeneration}
          AND runtime.container_id IS NOT DISTINCT FROM ${expectedContainerId}
          AND runtime.connection_epoch IS NOT DISTINCT FROM
            ${expectedConnectionEpoch}
          AND runtime.connection_disconnected_at IS NULL
      `);
      if ((prepared.rowCount ?? 0) !== 1) {
        return { status: 'runtime_mismatch' } as const;
      }
      return { status: 'prepared', already_prepared: false } as const;
    });
  }

  private async preparePostgresPairingActivationSession(input: {
    tx: DatabaseTransaction;
    worker_id: string;
    fence: PairingActivationCanonicalFence;
  }): Promise<'ready' | 'session_not_empty' | 'session_fence_invalid'> {
    const { tx, worker_id: workerId, fence } = input;
    await tx.execute(sql`
      SELECT set_config('app.whatsapp_session_id', ${workerId}, true)
    `);

    // Global order: worker -> runtime -> canonical session -> lease.
    // Taking the header lock before the lease avoids inversion with the
    // disconnect barrier/finalizer and activation boundary.
    await tx.execute(sql`
      SELECT session.session_id
      FROM public.whatsapp_session AS session
      WHERE session.session_id = ${workerId}::uuid
      FOR UPDATE
    `);

    const leaseResult = await tx.execute(sql`
      SELECT lease.owner_id::text AS owner_id,
             lease.provider,
             lease.fencing_token,
             lease.generation,
             lease.epoch::text AS epoch,
             lease.expires_at,
             lease.owner_id IS NULL
               AND lease.provider IS NULL
               AND lease.epoch IS NULL
               AND lease.expires_at IS NULL AS lease_released,
             lease.owner_id IS NOT NULL
               AND lease.expires_at <= clock_timestamp() AS lease_expired,
             lease.owner_id IS NOT NULL
               AND lease.expires_at > clock_timestamp() AS lease_live
      FROM public.whatsapp_session_lease AS lease
      WHERE lease.session_id = ${workerId}::uuid
      FOR UPDATE
    `);
    const leaseRow = (
      leaseResult as unknown as { rows?: PairingActivationLeaseRow[] }
    ).rows?.[0];

    const sessionResult = await tx.execute(sql`
      SELECT session.state,
             session.provider,
             session.generation,
             session.epoch,
             session.capability_hash,
             session.active_revision_id,
             session.previous_revision_id,
             session.active_device_fingerprint,
             session.active_device_fingerprint_version,
             session.last_persisted_at,
             session.last_error_at
      FROM public.whatsapp_session AS session
      WHERE session.session_id = ${workerId}::uuid
      FOR SHARE
    `);
    const sessionRow = (
      sessionResult as unknown as { rows?: PairingActivationSessionRow[] }
    ).rows?.[0];
    const activeRevisionId = sessionRow?.active_revision_id ?? null;

    const pairingRevisionResult = await tx.execute(sql`
      SELECT revision.revision_id,
             revision.provider,
             revision.status,
             revision.source,
             revision.writer_generation,
             revision.writer_epoch,
             revision.capability_hash,
             (SELECT count(*)
                FROM public.whatsapp_device AS device
               WHERE device.session_id = revision.session_id
                 AND device.revision_id = revision.revision_id)::integer
               AS devices,
             (SELECT count(*)
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
                 ))::integer AS identified_devices,
             (SELECT count(*)
                FROM public.whatsapp_provider_record AS provider_record
               WHERE provider_record.session_id = revision.session_id
                 AND provider_record.revision_id = revision.revision_id
                 AND provider_record.namespace <> 'baileys/creds')::integer
               AS non_pairing_provider_records
      FROM public.whatsapp_session_revision AS revision
      WHERE revision.session_id = ${workerId}::uuid
        AND revision.revision_id = ${activeRevisionId}::bigint
      FOR UPDATE
    `);
    const pairingRevisionRow = (
      pairingRevisionResult as unknown as {
        rows?: PairingActivationRevisionRow[];
      }
    ).rows?.[0];

    const treeResult = await tx.execute(sql`
      SELECT
        (SELECT count(*) FROM public.whatsapp_session_revision
          WHERE session_id = ${workerId}::uuid)::integer AS revisions,
        (SELECT count(*) FROM public.whatsapp_companion_reservation
          WHERE session_id = ${workerId}::uuid)::integer AS reservations,
        (SELECT count(*) FROM public.whatsapp_session_handoff
          WHERE session_id = ${workerId}::uuid)::integer AS handoffs,
        (SELECT count(*) FROM public.whatsapp_session_gc_queue
          WHERE session_id = ${workerId}::uuid)::integer AS gc_entries,
        (SELECT count(*) FROM public.whatsapp_provider_record
          WHERE session_id = ${workerId}::uuid)::integer AS provider_records,
        (SELECT count(*) FROM public.whatsapp_device
          WHERE session_id = ${workerId}::uuid)::integer AS devices,
        (SELECT count(*) FROM public.whatsapp_artifact
          WHERE session_id = ${workerId}::uuid)::integer AS artifacts,
        (SELECT count(*) FROM public.whatsapp_wwebjs_profile_anchor
          WHERE session_id = ${workerId}::uuid)::integer AS profile_anchors,
        (SELECT count(*) FROM public.whatsapp_artifact_chunk
          WHERE session_id = ${workerId}::uuid)::integer AS artifact_chunks,
        (SELECT count(*) FROM public.whatsapp_artifact_blob
          WHERE session_id = ${workerId}::uuid)::integer AS artifact_blobs
    `);
    const treeRow = (
      treeResult as unknown as { rows?: PairingActivationTreeRow[] }
    ).rows?.[0];
    const operationalTreeEmpty = isPairingOperationalTreeEmpty(treeRow);
    const canonicalHeaderEmpty = isPairingCanonicalHeaderEmpty(sessionRow);
    const canonicalFenceMatches = doesPairingCanonicalFenceMatch(
      sessionRow,
      fence
    );
    const resumableDraft = isResumablePairingDraft({
      session_row: sessionRow,
      revision_row: pairingRevisionRow,
      tree_row: treeRow,
      active_revision_id: activeRevisionId,
      canonical_fence_matches: canonicalFenceMatches,
      fence,
    });
    if ((!operationalTreeEmpty || !canonicalHeaderEmpty) && !resumableDraft) {
      return 'session_not_empty';
    }

    // A QR timeout leaves the exact runtime-owned staging revision open. It
    // is intentionally reusable by the next user attempt. Baileys may have
    // only its empty creds/device placeholders; WWebJS and WhatsMeow must
    // still have zero provider records and devices. Mutating that revision
    // here would invalidate the native store while it owns (and renews) the
    // canonical lease, producing LEASE_LOST instead of a fresh QR.

    return canonicalFenceMatches && doesPairingLeaseFenceMatch(leaseRow, fence)
      ? 'ready'
      : 'session_fence_invalid';
  }

  private async transitionWorkerToPairingReady(input: {
    tx: DatabaseTransaction;
    worker_id: string;
    account_id: string;
    worker_type_id: EWorkerType;
    expected_worker_status_id: string;
    current_container_id: string | null;
    expected_container_id: string;
  }): Promise<string> {
    const transitioned = await input.tx.execute(sql`
      UPDATE public.worker AS owner
      SET worker_status_id = ${EWorkerStatus.disponible}::uuid,
          container_id = ${input.expected_container_id},
          number = NULL,
          connection_date = NULL,
          last_connection_check_at = NULL,
          updated_at = clock_timestamp()
      WHERE owner.worker_id = ${input.worker_id}::uuid
        AND owner.account_id = ${input.account_id}::uuid
        AND owner.worker_type_id = ${input.worker_type_id}::uuid
        AND owner.worker_status_id = ${input.expected_worker_status_id}::uuid
        AND owner.lifecycle_operation_id IS NULL
        AND owner.deleted_at IS NULL
        AND owner.container_id IS NOT DISTINCT FROM ${input.current_container_id}
      RETURNING to_char(
        owner.updated_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ) AS worker_status_observed_at
    `);
    const observedAt = (
      transitioned as unknown as {
        rows?: Array<{ worker_status_observed_at?: string }>;
      }
    ).rows?.[0]?.worker_status_observed_at;
    if ((transitioned.rowCount ?? 0) !== 1 || !observedAt) {
      throw new WorkerConnectionPairingActivationAtomicityError();
    }
    return observedAt;
  }

  /**
   * Creates the one-shot authorization consumed by the next provider
   * connection activation. The worker/runtime/session proof is repeated under
   * the same locks as disconnect finalization; a manager response cannot turn
   * an old, non-empty or still-live session into a pairing attempt.
   */
  async prepareWorkerConnectionPairingActivation(
    input: PrepareWorkerConnectionPairingActivationInput
  ): Promise<PrepareWorkerConnectionPairingActivationResult> {
    const workerId = input.worker_id?.trim();
    const accountId = input.account_id?.trim();
    const provider = input.provider?.trim().toLowerCase() as
      keyof typeof WORKER_TYPE_BY_PROVIDER | undefined;
    const expectedContainerId = input.expected_container_id?.trim();
    const verifiedRunningContainerId =
      input.verified_running_container_id?.trim();
    const expectedConnectionEpoch =
      input.expected_connection_epoch === null
        ? null
        : input.expected_connection_epoch?.trim();
    const connectionAttemptId = input.connection_attempt_id?.trim();
    const authorizedConnectionEpoch = input.authorized_connection_epoch?.trim();
    const expectedRuntimeGeneration = input.expected_runtime_generation;
    const expiresAt = input.expires_at?.trim();
    if (
      !workerId ||
      !UUID_PATTERN.test(workerId) ||
      !accountId ||
      !UUID_PATTERN.test(accountId) ||
      !provider ||
      !Object.prototype.hasOwnProperty.call(
        WORKER_TYPE_BY_PROVIDER,
        provider
      ) ||
      !expectedContainerId ||
      !CONTAINER_ID_PATTERN.test(expectedContainerId) ||
      (input.verified_running_container_id !== undefined &&
        (!verifiedRunningContainerId ||
          !CONTAINER_ID_PATTERN.test(verifiedRunningContainerId) ||
          verifiedRunningContainerId !== expectedContainerId)) ||
      !Number.isSafeInteger(expectedRuntimeGeneration) ||
      expectedRuntimeGeneration <= 0 ||
      (input.expected_connection_epoch !== null &&
        (!expectedConnectionEpoch ||
          !UUID_PATTERN.test(expectedConnectionEpoch))) ||
      !connectionAttemptId ||
      !UUID_PATTERN.test(connectionAttemptId) ||
      !authorizedConnectionEpoch ||
      !UUID_PATTERN.test(authorizedConnectionEpoch) ||
      authorizedConnectionEpoch === expectedConnectionEpoch ||
      !expiresAt ||
      !Number.isFinite(Date.parse(expiresAt))
    ) {
      throw new TypeError('Invalid worker pairing activation grant');
    }

    return this.dbRw.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '10s'`);
      await tx.execute(sql`SET LOCAL statement_timeout = '20s'`);

      const workerResult = await tx.execute(sql`
        SELECT owner.account_id::text AS account_id,
               owner.worker_type_id::text AS worker_type_id,
               owner.worker_status_id::text AS worker_status_id,
               owner.lifecycle_operation_id::text AS lifecycle_operation_id,
               owner.session_storage,
               owner.container_id,
               owner.number,
               owner.connection_date,
               owner.last_connection_check_at,
               owner.deleted_at
        FROM public.worker AS owner
        WHERE owner.worker_id = ${workerId}::uuid
        FOR UPDATE
      `);
      const workerRow = (
        workerResult as unknown as {
          rows?: Array<{
            account_id?: string;
            worker_type_id?: string;
            worker_status_id?: string;
            lifecycle_operation_id?: string | null;
            session_storage?: string;
            container_id?: string | null;
            number?: string | null;
            connection_date?: string | null;
            last_connection_check_at?: string | null;
            deleted_at?: string | null;
          }>;
        }
      ).rows?.[0];
      if (
        !workerRow ||
        workerRow.account_id !== accountId ||
        workerRow.worker_type_id !== WORKER_TYPE_BY_PROVIDER[provider] ||
        workerRow.deleted_at
      ) {
        return { status: 'not_found' } as const;
      }
      if (workerRow.lifecycle_operation_id) {
        return {
          status: 'lifecycle_active',
          lifecycle_operation_id: workerRow.lifecycle_operation_id,
        } as const;
      }
      const workerContainerId = workerRow.container_id?.trim() || null;
      const shouldReattachRunningRuntime =
        workerContainerId === null &&
        verifiedRunningContainerId === expectedContainerId &&
        PAIRING_RUNTIME_REATTACHABLE_WORKER_STATUSES.has(
          workerRow.worker_status_id ?? ''
        );
      if (
        !PAIRING_GRANTABLE_WORKER_STATUSES.has(
          workerRow.worker_status_id ?? ''
        ) ||
        (workerContainerId !== expectedContainerId &&
          !shouldReattachRunningRuntime)
      ) {
        return { status: 'terminal_state_invalid' } as const;
      }

      const runtimeResult = await tx.execute(sql`
        SELECT runtime.runtime_generation,
               runtime.container_id,
               runtime.session_storage,
               runtime.source_provider,
               runtime.runtime_capability_hash,
               runtime.session_writer_epoch,
               runtime.connection_epoch,
               runtime.disconnected_connection_epoch,
               runtime.connection_disconnected_at,
               runtime.connection_sequence,
               runtime.native_connection_status,
               runtime.native_connection_public_status,
               runtime.native_connection_status_source_id,
               runtime.native_connection_status_sequence,
               runtime.native_connection_status_outbox_id,
               runtime.native_connection_status_lease_owner_id,
               runtime.native_connection_status_fencing_token,
               runtime.native_connection_status_changed_at_high_watermark,
               runtime.native_connection_status_retired_source_ids,
               runtime.native_connection_online_acknowledged
        FROM public.worker_runtime AS runtime
        WHERE runtime.worker_id = ${workerId}::uuid
        FOR UPDATE
      `);
      const runtimeRow = (
        runtimeResult as unknown as {
          rows?: Array<{
            runtime_generation?: number | string;
            container_id?: string | null;
            session_storage?: string;
            source_provider?: string | null;
            runtime_capability_hash?: string | null;
            session_writer_epoch?: string | null;
            connection_epoch?: string | null;
            disconnected_connection_epoch?: string | null;
            connection_disconnected_at?: string | null;
            connection_sequence?: number | string;
            native_connection_status?: unknown;
            native_connection_public_status?: unknown;
            native_connection_status_source_id?: string | null;
            native_connection_status_sequence?: number | string | null;
            native_connection_status_outbox_id?: number | string | null;
            native_connection_status_lease_owner_id?: string | null;
            native_connection_status_fencing_token?: number | string | null;
            native_connection_status_changed_at_high_watermark?: string | null;
            native_connection_status_retired_source_ids?: string[] | null;
            native_connection_online_acknowledged?: boolean;
          }>;
        }
      ).rows?.[0];
      const runtimeConnectionEpoch = runtimeRow?.connection_epoch ?? null;
      const exactDisconnectBarrier =
        !isNullish(runtimeRow?.connection_disconnected_at) &&
        (runtimeRow?.disconnected_connection_epoch ?? null) ===
          runtimeConnectionEpoch;
      const noDisconnectBarrier =
        isNullish(runtimeRow?.connection_disconnected_at) &&
        isNullish(runtimeRow?.disconnected_connection_epoch);
      if (
        !runtimeRow ||
        Number(runtimeRow.runtime_generation) !== expectedRuntimeGeneration ||
        (runtimeRow.container_id ?? null) !== expectedContainerId ||
        runtimeConnectionEpoch !== expectedConnectionEpoch ||
        runtimeRow.session_storage !== workerRow.session_storage ||
        (runtimeRow.source_provider !== null &&
          runtimeRow.source_provider !== provider) ||
        !runtimeRow.runtime_capability_hash ||
        !runtimeRow.session_writer_epoch ||
        !Number.isSafeInteger(Number(runtimeRow.connection_sequence)) ||
        Number(runtimeRow.connection_sequence) < 0 ||
        (!exactDisconnectBarrier && !noDisconnectBarrier)
      ) {
        return { status: 'runtime_mismatch' } as const;
      }

      const nativeProjectionSafe =
        runtimeRow.native_connection_online_acknowledged !== true &&
        !nativeProjectionSignalsOnline(runtimeRow.native_connection_status) &&
        !nativeProjectionSignalsOnline(
          runtimeRow.native_connection_public_status
        );
      if (!nativeProjectionSafe) {
        return { status: 'terminal_state_invalid' } as const;
      }

      if (workerRow.session_storage === EWorkerSessionStorage.postgres) {
        const sessionPreparation =
          await this.preparePostgresPairingActivationSession({
            tx,
            worker_id: workerId,
            fence: {
              provider,
              runtime_generation: expectedRuntimeGeneration,
              session_writer_epoch: runtimeRow.session_writer_epoch,
              runtime_capability_hash: runtimeRow.runtime_capability_hash,
              no_disconnect_barrier: noDisconnectBarrier,
              exact_disconnect_barrier: exactDisconnectBarrier,
            },
          });
        if (sessionPreparation !== 'ready') {
          return { status: sessionPreparation } as const;
        }
      }

      await tx.execute(sql`
        UPDATE public.whatsapp_pairing_activation_grant AS activation_grant
        SET revoked_at = clock_timestamp()
        WHERE activation_grant.worker_id = ${workerId}::uuid
          AND activation_grant.consumed_at IS NULL
          AND activation_grant.revoked_at IS NULL
          AND activation_grant.expires_at <= clock_timestamp()
      `);

      const existingResult = await tx.execute(sql`
        SELECT activation_grant.worker_id::text AS worker_id,
               activation_grant.account_id::text AS account_id,
               activation_grant.provider,
               activation_grant.runtime_generation,
               activation_grant.container_id,
               activation_grant.expected_connection_epoch,
               activation_grant.authorized_connection_epoch::text
                 AS authorized_connection_epoch,
               activation_grant.connection_sequence_at_grant,
               activation_grant.expires_at,
               activation_grant.expires_at > clock_timestamp() AS grant_live,
               activation_grant.consumed_at,
               activation_grant.revoked_at
        FROM public.whatsapp_pairing_activation_grant AS activation_grant
        WHERE activation_grant.connection_attempt_id =
          ${connectionAttemptId}::uuid
        FOR UPDATE
      `);
      const existingRow = (
        existingResult as unknown as {
          rows?: ExistingWorkerConnectionPairingActivationGrant[];
        }
      ).rows?.[0];
      if (existingRow) {
        const exactExisting =
          isExactPendingWorkerConnectionPairingActivationGrant(existingRow, {
            worker_id: workerId,
            account_id: accountId,
            provider,
            runtime_generation: expectedRuntimeGeneration,
            container_id: expectedContainerId,
            expected_connection_epoch: expectedConnectionEpoch,
            authorized_connection_epoch: authorizedConnectionEpoch,
            connection_sequence_at_grant: Number(
              runtimeRow.connection_sequence
            ),
          });
        if (!exactExisting) {
          return { status: 'grant_conflict' } as const;
        }
        const workerStatusObservedAt =
          await this.transitionWorkerToPairingReady({
            tx,
            worker_id: workerId,
            account_id: accountId,
            worker_type_id: WORKER_TYPE_BY_PROVIDER[provider],
            expected_worker_status_id: workerRow.worker_status_id as string,
            current_container_id: workerContainerId,
            expected_container_id: expectedContainerId,
          });
        return {
          status: 'granted',
          already_granted: true,
          worker_status_id: EWorkerStatus.disponible,
          worker_status_observed_at: workerStatusObservedAt,
        } as const;
      }

      const activeResult = await tx.execute(sql`
        SELECT activation_grant.connection_attempt_id
        FROM public.whatsapp_pairing_activation_grant AS activation_grant
        WHERE activation_grant.worker_id = ${workerId}::uuid
          AND activation_grant.consumed_at IS NULL
          AND activation_grant.revoked_at IS NULL
        FOR UPDATE
      `);
      if ((activeResult.rowCount ?? 0) > 0) {
        // The Redis active-attempt claim is acquired before this transaction.
        // A different pending row therefore belongs to an earlier claimant
        // whose Redis ownership has already been superseded. Revoke it under
        // the worker/runtime locks so the current claim can make progress.
        await tx.execute(sql`
          UPDATE public.whatsapp_pairing_activation_grant AS activation_grant
          SET revoked_at = clock_timestamp()
          WHERE activation_grant.worker_id = ${workerId}::uuid
            AND activation_grant.connection_attempt_id IS DISTINCT FROM
              ${connectionAttemptId}::uuid
            AND activation_grant.consumed_at IS NULL
            AND activation_grant.revoked_at IS NULL
        `);
      }

      const inserted = await tx.execute(sql`
        INSERT INTO public.whatsapp_pairing_activation_grant (
          connection_attempt_id,
          worker_id,
          account_id,
          provider,
          runtime_generation,
          container_id,
          expected_connection_epoch,
          authorized_connection_epoch,
          connection_sequence_at_grant,
          expires_at
        )
        SELECT ${connectionAttemptId}::uuid,
               ${workerId}::uuid,
               ${accountId}::uuid,
               ${provider},
               ${expectedRuntimeGeneration},
               ${expectedContainerId},
               ${expectedConnectionEpoch},
               ${authorizedConnectionEpoch}::uuid,
               ${Number(runtimeRow.connection_sequence)},
               ${expiresAt}::timestamptz
        WHERE ${expiresAt}::timestamptz > clock_timestamp()
          AND ${expiresAt}::timestamptz <=
            clock_timestamp() + interval '15 minutes'
      `);
      if ((inserted.rowCount ?? 0) !== 1) {
        return { status: 'grant_conflict' } as const;
      }
      const workerStatusObservedAt = await this.transitionWorkerToPairingReady({
        tx,
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: WORKER_TYPE_BY_PROVIDER[provider],
        expected_worker_status_id: workerRow.worker_status_id as string,
        current_container_id: workerContainerId,
        expected_container_id: expectedContainerId,
      });
      return {
        status: 'granted',
        already_granted: false,
        worker_status_id: EWorkerStatus.disponible,
        worker_status_observed_at: workerStatusObservedAt,
      } as const;
    });
  }

  async hasCurrentWorkerConnectionPairingAuthorization(
    input: WorkerConnectionPairingActivationGrantIdentity
  ): Promise<boolean> {
    if (!isValidWorkerConnectionPairingActivationGrantIdentity(input)) {
      return false;
    }
    const result = await this.dbRw.execute(sql`
      SELECT 1
      FROM public.whatsapp_pairing_activation_grant AS activation_grant
      JOIN public.worker_runtime AS runtime
        ON runtime.worker_id = activation_grant.worker_id
       AND runtime.runtime_generation = activation_grant.runtime_generation
       AND runtime.container_id = activation_grant.container_id
      JOIN public.worker AS owner
        ON owner.worker_id = activation_grant.worker_id
       AND owner.account_id = activation_grant.account_id
      WHERE activation_grant.connection_attempt_id =
          ${input.connection_attempt_id}::uuid
        AND activation_grant.worker_id = ${input.worker_id}::uuid
        AND activation_grant.account_id = ${input.account_id}::uuid
        AND activation_grant.provider = ${input.provider}
        AND activation_grant.runtime_generation = ${input.runtime_generation}
        AND activation_grant.container_id = ${input.container_id}
        AND activation_grant.authorized_connection_epoch =
          ${input.authorized_connection_epoch}::uuid
        AND activation_grant.revoked_at IS NULL
        AND owner.deleted_at IS NULL
        AND (
          (
            activation_grant.consumed_at IS NULL
            AND activation_grant.expires_at > clock_timestamp()
            AND runtime.connection_epoch IS NOT DISTINCT FROM
              activation_grant.expected_connection_epoch
            AND runtime.connection_sequence =
              activation_grant.connection_sequence_at_grant
          )
          OR (
            activation_grant.consumed_at IS NULL
            AND activation_grant.authorized_connection_epoch::text =
              runtime.connection_epoch
            AND runtime.source_provider = activation_grant.provider
            AND runtime.connection_sequence =
              activation_grant.connection_sequence_at_grant + 1
          )
          OR (
            activation_grant.consumed_at IS NOT NULL
            AND activation_grant.authorized_connection_epoch::text =
              runtime.connection_epoch
            AND runtime.source_provider = activation_grant.provider
            AND runtime.connection_sequence =
              activation_grant.connection_sequence_at_grant + 1
          )
        )
      LIMIT 1
    `);
    return (result.rowCount ?? 0) === 1;
  }

  async revokeWorkerConnectionPairingActivation(
    input: WorkerConnectionPairingActivationGrantIdentity
  ): Promise<boolean> {
    if (!isValidWorkerConnectionPairingActivationGrantIdentity(input)) {
      return false;
    }
    const result = await this.dbRw.execute(sql`
      UPDATE public.whatsapp_pairing_activation_grant AS activation_grant
      SET revoked_at = clock_timestamp()
      WHERE activation_grant.connection_attempt_id =
          ${input.connection_attempt_id}::uuid
        AND activation_grant.worker_id = ${input.worker_id}::uuid
        AND activation_grant.account_id = ${input.account_id}::uuid
        AND activation_grant.provider = ${input.provider}
        AND activation_grant.runtime_generation = ${input.runtime_generation}
        AND activation_grant.container_id = ${input.container_id}
        AND activation_grant.authorized_connection_epoch =
          ${input.authorized_connection_epoch}::uuid
        AND activation_grant.consumed_at IS NULL
        AND activation_grant.revoked_at IS NULL
    `);
    return (result.rowCount ?? 0) === 1;
  }

  /**
   * Commits the control-plane terminal state for an explicit, in-place
   * disconnect. The provider has already performed its fenced logout before
   * this method runs. This transaction proves that the exact runtime is still
   * current and that no operational PostgreSQL session material survived,
   * then clears only connection projections. Runtime/container identity,
   * writer authority, the empty session header, its live lease, and durable
   * handoff-resolution history are deliberately preserved.
   */
  async finalizeWorkerConnectionDisconnect(
    input: FinalizeWorkerConnectionDisconnectInput
  ): Promise<FinalizeWorkerConnectionDisconnectResult> {
    const workerId = input.worker_id?.trim();
    const accountId = input.account_id?.trim();
    const expectedContainerId =
      input.expected_container_id === null
        ? null
        : input.expected_container_id?.trim();
    const expectedConnectionEpoch =
      input.expected_connection_epoch === null
        ? null
        : input.expected_connection_epoch?.trim();
    const expectedRuntimeGeneration = input.expected_runtime_generation;
    if (
      !workerId ||
      !accountId ||
      !Number.isSafeInteger(expectedRuntimeGeneration) ||
      expectedRuntimeGeneration <= 0 ||
      (input.expected_container_id !== null && !expectedContainerId) ||
      (input.expected_connection_epoch !== null && !expectedConnectionEpoch)
    ) {
      throw new TypeError('Invalid worker connection disconnect fence');
    }

    try {
      return await this.dbRw.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout = '10s'`);
        await tx.execute(sql`SET LOCAL statement_timeout = '20s'`);

        const workerResult = await tx.execute(sql`
        SELECT owner.account_id::text AS account_id,
               owner.lifecycle_operation_id::text AS lifecycle_operation_id,
               owner.session_storage,
               owner.container_id,
               owner.worker_status_id::text AS worker_status_id,
               owner.number,
               owner.connection_date,
               owner.last_connection_check_at,
               owner.deleted_at
        FROM public.worker AS owner
        WHERE owner.worker_id = ${workerId}::uuid
        FOR UPDATE
      `);
        const workerRow = (
          workerResult as unknown as {
            rows?: Array<{
              account_id?: string;
              lifecycle_operation_id?: string | null;
              session_storage?: string;
              container_id?: string | null;
              worker_status_id?: string;
              number?: string | null;
              connection_date?: string | null;
              last_connection_check_at?: string | null;
              deleted_at?: string | null;
            }>;
          }
        ).rows?.[0];
        if (
          !workerRow ||
          workerRow.account_id !== accountId ||
          workerRow.deleted_at
        ) {
          return { status: 'not_found' } as const;
        }
        if (workerRow.lifecycle_operation_id) {
          return {
            status: 'lifecycle_active',
            lifecycle_operation_id: workerRow.lifecycle_operation_id,
          } as const;
        }

        const runtimeResult = await tx.execute(sql`
        SELECT runtime.runtime_generation,
               runtime.container_id,
               runtime.session_storage,
               runtime.source_provider,
               runtime.runtime_capability_hash,
               runtime.session_writer_epoch,
               runtime.connection_epoch,
               runtime.disconnected_connection_epoch,
               runtime.connection_disconnected_at,
               runtime.native_connection_status,
               runtime.native_connection_public_status,
               runtime.native_connection_status_source_id,
               runtime.native_connection_status_sequence,
               runtime.native_connection_status_outbox_id,
               runtime.native_connection_status_lease_owner_id,
               runtime.native_connection_status_fencing_token,
               runtime.native_connection_status_changed_at_high_watermark,
               runtime.native_connection_status_retired_source_ids,
               runtime.native_connection_online_acknowledged
        FROM public.worker_runtime AS runtime
        WHERE runtime.worker_id = ${workerId}::uuid
        FOR UPDATE
      `);
        const runtimeRow = (
          runtimeResult as unknown as {
            rows?: Array<{
              runtime_generation?: number | string;
              container_id?: string | null;
              session_storage?: string;
              source_provider?: string | null;
              runtime_capability_hash?: string | null;
              session_writer_epoch?: string | null;
              connection_epoch?: string | null;
              disconnected_connection_epoch?: string | null;
              connection_disconnected_at?: string | null;
              native_connection_status?: unknown;
              native_connection_public_status?: unknown;
              native_connection_status_source_id?: string | null;
              native_connection_status_sequence?: number | string | null;
              native_connection_status_outbox_id?: number | string | null;
              native_connection_status_lease_owner_id?: string | null;
              native_connection_status_fencing_token?: number | string | null;
              native_connection_status_changed_at_high_watermark?:
                string | null;
              native_connection_status_retired_source_ids?: string[] | null;
              native_connection_online_acknowledged?: boolean;
            }>;
          }
        ).rows?.[0];
        if (
          !runtimeRow ||
          Number(runtimeRow.runtime_generation) !== expectedRuntimeGeneration ||
          (runtimeRow.container_id ?? null) !== expectedContainerId ||
          (runtimeRow.connection_epoch ?? null) !== expectedConnectionEpoch ||
          runtimeRow.session_storage !== workerRow.session_storage
        ) {
          return { status: 'runtime_mismatch' } as const;
        }

        // FORCE RLS remains enabled for the manager connection. Scope every
        // canonical-session proof to this worker inside the transaction.
        await tx.execute(sql`
        SELECT set_config('app.whatsapp_session_id', ${workerId}, true)
      `);

        const sessionResult = await tx.execute(sql`
        SELECT session.state,
               session.provider,
               session.generation,
               session.epoch,
               session.capability_hash,
               session.active_revision_id,
               session.previous_revision_id,
               session.active_device_fingerprint,
               session.active_device_fingerprint_version,
               session.last_persisted_at,
               session.last_error_at
        FROM public.whatsapp_session AS session
        WHERE session.session_id = ${workerId}::uuid
        FOR SHARE
      `);
        const sessionRow = (
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
            }>;
          }
        ).rows?.[0];

        const leaseResult = await tx.execute(sql`
        SELECT lease.owner_id::text AS owner_id,
               lease.provider,
               lease.fencing_token,
               lease.generation,
               lease.epoch::text AS epoch,
               lease.expires_at,
               lease.expires_at > clock_timestamp() + interval '5 seconds'
                 AS lease_live,
               lease.owner_id IS NULL
                 AND lease.provider IS NULL
                 AND lease.epoch IS NULL
                 AND lease.expires_at IS NULL AS lease_released,
               lease.owner_id IS NOT NULL
                 AND lease.expires_at <=
                   clock_timestamp() + interval '5 seconds' AS lease_expired
        FROM public.whatsapp_session_lease AS lease
        WHERE lease.session_id = ${workerId}::uuid
        FOR SHARE
      `);
        const leaseRow = (
          leaseResult as unknown as {
            rows?: Array<{
              owner_id?: string | null;
              provider?: string | null;
              fencing_token?: number | string;
              generation?: number | string;
              epoch?: string | null;
              expires_at?: string | null;
              lease_live?: boolean;
              lease_released?: boolean;
              lease_expired?: boolean;
            }>;
          }
        ).rows?.[0];

        const treeResult = await tx.execute(sql`
        SELECT
          (SELECT count(*) FROM public.whatsapp_session_revision
            WHERE session_id = ${workerId}::uuid)::integer AS revisions,
          (SELECT count(*) FROM public.whatsapp_companion_reservation
            WHERE session_id = ${workerId}::uuid)::integer AS reservations,
          (SELECT count(*) FROM public.whatsapp_session_handoff
            WHERE session_id = ${workerId}::uuid)::integer AS handoffs,
          (SELECT count(*) FROM public.whatsapp_session_gc_queue
            WHERE session_id = ${workerId}::uuid)::integer AS gc_entries,
          (SELECT count(*) FROM public.whatsapp_provider_record
            WHERE session_id = ${workerId}::uuid)::integer AS provider_records,
          (SELECT count(*) FROM public.whatsapp_artifact
            WHERE session_id = ${workerId}::uuid)::integer AS artifacts,
          (SELECT count(*) FROM public.whatsapp_wwebjs_profile_anchor
            WHERE session_id = ${workerId}::uuid)::integer AS profile_anchors,
          (SELECT count(*) FROM public.whatsapp_artifact_chunk
            WHERE session_id = ${workerId}::uuid)::integer AS artifact_chunks,
          (SELECT count(*) FROM public.whatsapp_artifact_blob
            WHERE session_id = ${workerId}::uuid)::integer AS artifact_blobs
      `);
        const treeRow = (
          treeResult as unknown as {
            rows?: Array<Record<string, number | string | null>>;
          }
        ).rows?.[0];
        const operationalTreeEmpty =
          Boolean(treeRow) &&
          Object.values(
            treeRow as Record<string, number | string | null>
          ).every((value) => Number(value ?? 0) === 0);
        const canonicalHeaderEmpty =
          !sessionRow ||
          (sessionRow.state === 'empty' &&
            isNullish(sessionRow.active_revision_id) &&
            isNullish(sessionRow.previous_revision_id) &&
            isNullish(sessionRow.active_device_fingerprint) &&
            isNullish(sessionRow.active_device_fingerprint_version) &&
            isNullish(sessionRow.last_persisted_at) &&
            isNullish(sessionRow.last_error_at));
        if (!operationalTreeEmpty || !canonicalHeaderEmpty) {
          return { status: 'session_not_empty' } as const;
        }
        const exactDisconnectBarrier =
          !isNullish(runtimeRow.connection_disconnected_at) &&
          (runtimeRow.disconnected_connection_epoch ?? null) ===
            expectedConnectionEpoch;
        const canonicalSessionFenceMatches =
          Boolean(sessionRow) &&
          sessionRow?.provider === runtimeRow.source_provider &&
          Number(sessionRow?.generation) === expectedRuntimeGeneration &&
          (sessionRow?.epoch ?? null) ===
            (runtimeRow.session_writer_epoch ?? null) &&
          (sessionRow?.capability_hash ?? null) ===
            (runtimeRow.runtime_capability_hash ?? null);
        const retainedLeaseFence =
          Boolean(leaseRow) &&
          Number(leaseRow?.fencing_token) > 0 &&
          Number(leaseRow?.generation) === expectedRuntimeGeneration &&
          (leaseRow?.lease_released === true ||
            (Boolean(leaseRow?.owner_id) &&
              leaseRow?.provider === runtimeRow.source_provider &&
              (leaseRow?.epoch ?? null) ===
                (runtimeRow.session_writer_epoch ?? null) &&
              (leaseRow?.lease_live === true ||
                leaseRow?.lease_expired === true)));
        const retainedPostgresFence =
          exactDisconnectBarrier &&
          (workerRow.session_storage !== EWorkerSessionStorage.postgres ||
            (canonicalSessionFenceMatches && retainedLeaseFence));
        if (!retainedPostgresFence) {
          return { status: 'session_fence_invalid' } as const;
        }

        const readObservedAt = async (): Promise<string> => {
          const observedAtResult = await tx.execute(sql`
          SELECT to_char(
            owner.updated_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          ) AS worker_status_observed_at
          FROM public.worker AS owner
          JOIN public.worker_runtime AS runtime
            ON runtime.worker_id = owner.worker_id
          WHERE owner.worker_id = ${workerId}::uuid
            AND owner.container_id IS NOT DISTINCT FROM runtime.container_id
            AND runtime.runtime_generation = ${expectedRuntimeGeneration}
        `);
          const observedAt = (
            observedAtResult as unknown as {
              rows?: Array<{ worker_status_observed_at?: string }>;
            }
          ).rows?.[0]?.worker_status_observed_at;
          if (!observedAt) {
            throw new WorkerConnectionDisconnectAtomicityError();
          }
          return observedAt;
        };

        const nativeProjectionEmpty =
          isNullish(runtimeRow.native_connection_status) &&
          isNullish(runtimeRow.native_connection_public_status) &&
          isNullish(runtimeRow.native_connection_status_source_id) &&
          isNullish(runtimeRow.native_connection_status_sequence) &&
          isNullish(runtimeRow.native_connection_status_outbox_id) &&
          isNullish(runtimeRow.native_connection_status_lease_owner_id) &&
          isNullish(runtimeRow.native_connection_status_fencing_token) &&
          isNullish(
            runtimeRow.native_connection_status_changed_at_high_watermark
          ) &&
          (runtimeRow.native_connection_status_retired_source_ids?.length ??
            0) === 0 &&
          runtimeRow.native_connection_online_acknowledged !== true;
        const alreadyFinalized =
          workerRow.worker_status_id === EWorkerStatus.disponible &&
          isNullish(workerRow.number) &&
          isNullish(workerRow.connection_date) &&
          isNullish(workerRow.last_connection_check_at) &&
          (workerRow.container_id ?? null) === expectedContainerId &&
          !isNullish(runtimeRow.connection_disconnected_at) &&
          (runtimeRow.disconnected_connection_epoch ?? null) ===
            expectedConnectionEpoch &&
          nativeProjectionEmpty;
        if (alreadyFinalized) {
          return {
            status: 'completed',
            worker_id: workerId,
            worker_status_id: EWorkerStatus.disponible,
            runtime_generation: expectedRuntimeGeneration,
            container_id: expectedContainerId,
            worker_status_observed_at: await readObservedAt(),
          } as const;
        }

        const runtimeUpdate = await tx.execute(sql`
        UPDATE public.worker_runtime
        SET disconnected_connection_epoch = connection_epoch,
            connection_disconnected_at = COALESCE(
              connection_disconnected_at,
              clock_timestamp()
            ),
            native_connection_status = NULL,
            native_connection_public_status = NULL,
            native_connection_status_source_id = NULL,
            native_connection_status_sequence = NULL,
            native_connection_status_outbox_id = NULL,
            native_connection_status_lease_owner_id = NULL,
            native_connection_status_fencing_token = NULL,
            native_connection_status_changed_at_high_watermark = NULL,
            native_connection_status_retired_source_ids = '{}'::uuid[],
            native_connection_online_acknowledged = false,
            updated_at = clock_timestamp()
        WHERE worker_id = ${workerId}::uuid
          AND runtime_generation = ${expectedRuntimeGeneration}
          AND container_id IS NOT DISTINCT FROM ${expectedContainerId}
          AND connection_epoch IS NOT DISTINCT FROM ${expectedConnectionEpoch}
      `);
        if ((runtimeUpdate.rowCount ?? 0) !== 1) {
          throw new WorkerConnectionDisconnectAtomicityError();
        }

        const workerUpdate = await tx.execute(sql`
        UPDATE public.worker
        SET worker_status_id = ${EWorkerStatus.disponible}::uuid,
            number = NULL,
            connection_date = NULL,
            last_connection_check_at = NULL,
            container_id = ${expectedContainerId},
            external_connection_revision = external_connection_revision + 1,
            updated_at = clock_timestamp()
        WHERE worker_id = ${workerId}::uuid
          AND account_id = ${accountId}::uuid
          AND lifecycle_operation_id IS NULL
          AND deleted_at IS NULL
      `);
        if ((workerUpdate.rowCount ?? 0) !== 1) {
          throw new WorkerConnectionDisconnectAtomicityError();
        }

        const workerStatusObservedAt = await readObservedAt();

        return {
          status: 'completed',
          worker_id: workerId,
          worker_status_id: EWorkerStatus.disponible,
          runtime_generation: expectedRuntimeGeneration,
          container_id: expectedContainerId,
          worker_status_observed_at: workerStatusObservedAt,
        } as const;
      });
    } catch (error) {
      if (error instanceof WorkerConnectionDisconnectAtomicityError) {
        return { status: 'runtime_mismatch' };
      }
      throw error;
    }
  }

  async upsert(input: UpsertWorkerRuntimeInput): Promise<IWorkerRuntime> {
    const now = currentTime();
    const [result] = await this.dbRw
      .insert(workerRuntime)
      .values({
        worker_id: input.worker_id,
        container_id: input.container_id,
        container_name: input.container_name,
        session_storage:
          input.session_storage ?? EWorkerSessionStorage.legacy_volume,
        session_volume_name: input.session_volume_name,
        runtime_capability_hash: input.runtime_capability_hash,
        session_writer_epoch: input.session_writer_epoch,
        runtime_generation: input.runtime_generation ?? 1,
        warm_pool_id: input.warm_pool_id ?? null,
        activated_at: input.activated_at ?? now,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: workerRuntime.worker_id,
        set: {
          container_id: input.container_id,
          container_name: input.container_name,
          ...(input.session_storage !== undefined
            ? { session_storage: input.session_storage }
            : {}),
          session_volume_name: input.session_volume_name,
          ...(input.runtime_capability_hash !== undefined
            ? { runtime_capability_hash: input.runtime_capability_hash }
            : {}),
          ...(input.session_writer_epoch !== undefined
            ? { session_writer_epoch: input.session_writer_epoch }
            : {}),
          runtime_generation:
            input.runtime_generation ??
            sql`${workerRuntime.runtime_generation} + 1`,
          connection_epoch:
            input.runtime_generation === undefined
              ? null
              : sql`CASE
                  WHEN ${workerRuntime.runtime_generation} = ${input.runtime_generation}
                    THEN ${workerRuntime.connection_epoch}
                  ELSE NULL
                END`,
          connection_sequence:
            input.runtime_generation === undefined
              ? 0
              : sql`CASE
                  WHEN ${workerRuntime.runtime_generation} = ${input.runtime_generation}
                    THEN ${workerRuntime.connection_sequence}
                  ELSE 0
                END`,
          source_provider:
            input.runtime_generation === undefined
              ? null
              : sql`CASE
                  WHEN ${workerRuntime.runtime_generation} = ${input.runtime_generation}
                    THEN ${workerRuntime.source_provider}
                  ELSE NULL
                END`,
          connection_activated_at:
            input.runtime_generation === undefined
              ? null
              : sql`CASE
                  WHEN ${workerRuntime.runtime_generation} = ${input.runtime_generation}
                    THEN ${workerRuntime.connection_activated_at}
                  ELSE NULL
                END`,
          warm_pool_id: input.warm_pool_id ?? null,
          activated_at: input.activated_at ?? now,
          updated_at: now,
        },
        ...(input.runtime_generation !== undefined
          ? {
              setWhere: or(
                lt(workerRuntime.runtime_generation, input.runtime_generation),
                and(
                  eq(
                    workerRuntime.runtime_generation,
                    input.runtime_generation
                  ),
                  or(
                    isNull(workerRuntime.recreate_retired_operation_id),
                    sql`${workerRuntime.container_id} IS NOT DISTINCT FROM ${input.container_id ?? null}`
                  )
                )
              ),
            }
          : {}),
      })
      .returning()
      .execute();

    if (!result && input.runtime_generation !== undefined) {
      throw new StaleWorkerRuntimeGenerationError(
        input.worker_id,
        input.runtime_generation
      );
    }

    if (!result) {
      throw new Error('Failed to upsert worker runtime');
    }

    return result;
  }

  async activateWhatsappRuntimeFence(
    input: WhatsappRuntimeDatabaseFenceActivation
  ): Promise<WhatsappRuntimeDatabaseFenceActivationResult> {
    return this.dbRw.transaction((tx) =>
      activateWhatsappRuntimeFenceInTransaction(tx, input)
    );
  }

  async deleteByWorkerId(workerId: string): Promise<boolean> {
    const result = await this.dbRw
      .delete(workerRuntime)
      .where(eq(workerRuntime.worker_id, workerId))
      .execute();

    return result.rowCount === 1;
  }
}
