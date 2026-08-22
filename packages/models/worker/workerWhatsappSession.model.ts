import { sql } from 'drizzle-orm';
import {
  AnyPgColumn,
  bigint,
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { worker } from './worker.model';

export type WhatsappSessionProvider = 'baileys' | 'wwebjs' | 'whatsmeow';
export type WorkerWhatsappSessionProvider = WhatsappSessionProvider;

export type WhatsappSessionState =
  'empty' | 'preparing' | 'ready' | 'handoff' | 'error';
export type WorkerWhatsappSessionState = WhatsappSessionState;

export type WhatsappSessionRevisionStatus =
  'staging' | 'validating' | 'active' | 'retired' | 'failed';
export type WorkerWhatsappSessionRevisionStatus = WhatsappSessionRevisionStatus;
export type WhatsappSessionGcRevisionStatus = Extract<
  WhatsappSessionRevisionStatus,
  'staging' | 'failed' | 'retired'
>;

export type WhatsappSessionRevisionSource =
  | 'pairing'
  | 'checkpoint'
  | 'secure_import'
  | 'handoff'
  | 'rollback'
  | 'legacy_volume_migration';
export type WorkerWhatsappSessionRevisionSource = WhatsappSessionRevisionSource;

export type WhatsappSessionHandoffState =
  | 'requested'
  | 'draining'
  | 'transforming'
  | 'hydrating'
  | 'validating'
  | 'promoting'
  | 'activating'
  | 'completed'
  | 'failed';

export type WhatsappSessionHandoffRecoveryState =
  | 'none'
  | 'pending'
  | 'dispatching'
  | 'running'
  | 'completed'
  | 'blocked'
  | 'cancelled';

export type WhatsappSessionHandoffResolutionAction = 'return' | 'discard';
export type WhatsappSessionHandoffResolutionState = 'running' | 'completed';

export type WhatsappArtifactStatus = 'staging' | 'ready' | 'failed' | 'retired';

export type WhatsappWwebjsProfileAnchorState = 'active' | 'previous';
export type WhatsappWwebjsProfileCheckpointMode =
  | 'legacy_adoption_v1'
  | 'full_profile_plus_fresh_canonical_v1'
  | 'immutable_profile_anchor_plus_fresh_canonical_v1'
  | 'last_good_plus_fresh_canonical_v1';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

const generatedBigint = customType<{
  data: number;
  driverData: string;
  notNull: true;
  default: true;
}>({
  dataType() {
    return 'bigserial';
  },
  fromDriver(value) {
    return Number(value);
  },
});

export const whatsappSessionRevision = pgTable(
  'whatsapp_session_revision',
  {
    session_id: uuid()
      .references((): AnyPgColumn => whatsappSession.session_id, {
        onDelete: 'cascade',
      })
      .notNull(),
    revision_id: generatedBigint(),
    provider: varchar({ length: 20 })
      .$type<WhatsappSessionProvider>()
      .notNull(),
    status: varchar({ length: 20 })
      .$type<WhatsappSessionRevisionStatus>()
      .notNull()
      .default('staging'),
    source: varchar({ length: 30 })
      .$type<WhatsappSessionRevisionSource>()
      .notNull(),
    schema_version: integer().notNull().default(17),
    codec_version: integer().notNull().default(1),
    format: varchar({ length: 80 }).notNull(),
    checksum_sha256: varchar({ length: 64 }),
    size_bytes: bigint({ mode: 'number' }).notNull().default(0),
    writer_generation: integer().notNull(),
    writer_epoch: uuid().notNull(),
    capability_hash: varchar({ length: 64 }).notNull(),
    error_code: varchar({ length: 100 }),
    created_at: timestamp({ mode: 'string', withTimezone: true })
      .defaultNow()
      .notNull(),
    persisted_at: timestamp({ mode: 'string', withTimezone: true }),
    validated_at: timestamp({ mode: 'string', withTimezone: true }),
    promoted_at: timestamp({ mode: 'string', withTimezone: true }),
    retired_at: timestamp({ mode: 'string', withTimezone: true }),
  },
  (table) => [
    primaryKey({
      name: 'whatsapp_session_revision_pk',
      columns: [table.session_id, table.revision_id],
    }),
    index('whatsapp_session_revision_gc_idx')
      .on(table.created_at, table.session_id, table.revision_id)
      .where(sql`${table.status} IN ('staging', 'failed', 'retired')`),
    uniqueIndex('whatsapp_session_revision_active_uidx')
      .on(table.session_id)
      .where(sql`${table.status} = 'active'`),
    check(
      'whatsapp_session_revision_provider_check',
      sql`${table.provider} IN ('baileys', 'wwebjs', 'whatsmeow')`
    ),
    check(
      'whatsapp_session_revision_status_check',
      sql`${table.status} IN ('staging', 'validating', 'active', 'retired', 'failed')`
    ),
    check(
      'whatsapp_session_revision_source_check',
      sql`${table.source} IN ('pairing', 'checkpoint', 'secure_import', 'handoff', 'rollback', 'legacy_volume_migration')`
    ),
    check(
      'whatsapp_session_revision_size_check',
      sql`${table.size_bytes} >= 0`
    ),
    check(
      'whatsapp_session_revision_generation_check',
      sql`${table.writer_generation} > 0`
    ),
    check(
      'whatsapp_session_revision_checksum_check',
      sql`${table.checksum_sha256} IS NULL OR ${table.checksum_sha256} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      'whatsapp_session_revision_capability_check',
      sql`${table.capability_hash} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      'whatsapp_session_revision_version_check',
      sql`${table.schema_version} = 17 AND ${table.codec_version} > 0`
    ),
  ]
);

export const whatsappSession = pgTable(
  'whatsapp_session',
  {
    session_id: uuid().primaryKey().notNull(),
    provider: varchar({ length: 20 })
      .$type<WhatsappSessionProvider>()
      .notNull(),
    state: varchar({ length: 20 })
      .$type<WhatsappSessionState>()
      .notNull()
      .default('empty'),
    active_revision_id: bigint({ mode: 'number' }),
    previous_revision_id: bigint({ mode: 'number' }),
    generation: integer().notNull().default(1),
    epoch: uuid(),
    capability_hash: varchar({ length: 64 }),
    active_device_fingerprint: bytea(),
    active_device_fingerprint_version: varchar({ length: 80 }),
    last_persisted_at: timestamp({ mode: 'string', withTimezone: true }),
    last_error_at: timestamp({ mode: 'string', withTimezone: true }),
    created_at: timestamp({ mode: 'string', withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp({ mode: 'string', withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: 'whatsapp_session_worker_fk',
      columns: [table.session_id],
      foreignColumns: [worker.worker_id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'whatsapp_session_active_revision_fk',
      columns: [table.session_id, table.active_revision_id],
      foreignColumns: [
        whatsappSessionRevision.session_id,
        whatsappSessionRevision.revision_id,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'whatsapp_session_previous_revision_fk',
      columns: [table.session_id, table.previous_revision_id],
      foreignColumns: [
        whatsappSessionRevision.session_id,
        whatsappSessionRevision.revision_id,
      ],
    }).onDelete('restrict'),
    uniqueIndex('whatsapp_session_active_device_fingerprint_uidx')
      .on(
        table.active_device_fingerprint_version,
        table.active_device_fingerprint
      )
      .where(
        sql`${table.active_device_fingerprint_version} IS NOT NULL AND ${table.active_device_fingerprint} IS NOT NULL`
      ),
    check(
      'whatsapp_session_provider_check',
      sql`${table.provider} IN ('baileys', 'wwebjs', 'whatsmeow')`
    ),
    check(
      'whatsapp_session_state_check',
      sql`${table.state} IN ('empty', 'preparing', 'ready', 'handoff', 'error')`
    ),
    check('whatsapp_session_generation_check', sql`${table.generation} > 0`),
    check(
      'whatsapp_session_revision_distinct_check',
      sql`${table.active_revision_id} IS NULL OR ${table.previous_revision_id} IS NULL OR ${table.active_revision_id} <> ${table.previous_revision_id}`
    ),
    check(
      'whatsapp_session_capability_check',
      sql`${table.capability_hash} IS NULL OR ${table.capability_hash} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      'whatsapp_session_fingerprint_check',
      sql`(${table.active_device_fingerprint} IS NULL AND ${table.active_device_fingerprint_version} IS NULL) OR (${table.active_device_fingerprint} IS NOT NULL AND ${table.active_device_fingerprint_version} IS NOT NULL AND octet_length(${table.active_device_fingerprint}) = 32 AND ${table.active_device_fingerprint_version} IN ('underchat-whatsapp-device-fingerprint-v1', 'underchat-whatsapp-device-fingerprint-v2'))`
    ),
  ]
);

// Global pre-network reservation: unlike protocol state, this table is
// intentionally fingerprint-first so two session_ids cannot open cloned
// companion credentials concurrently. Revisions of the same session share it.
export const whatsappCompanionReservation = pgTable(
  'whatsapp_companion_reservation',
  {
    fingerprint_version: varchar({ length: 80 }).notNull(),
    device_fingerprint: bytea().notNull(),
    session_id: uuid()
      .references(() => whatsappSession.session_id, { onDelete: 'cascade' })
      .notNull(),
    reserved_at: timestamp({ mode: 'string', withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: 'whatsapp_companion_reservation_pk',
      columns: [table.fingerprint_version, table.device_fingerprint],
    }),
    uniqueIndex('whatsapp_companion_reservation_session_uidx').on(
      table.session_id
    ),
    check(
      'whatsapp_companion_reservation_fingerprint_check',
      sql`${table.fingerprint_version} = 'underchat-whatsapp-device-fingerprint-v2' AND octet_length(${table.device_fingerprint}) = 32`
    ),
  ]
);

export const whatsappSessionGcQueue = pgTable(
  'whatsapp_session_gc_queue',
  {
    session_id: uuid().notNull(),
    revision_id: bigint({ mode: 'number' }).notNull(),
    revision_status: varchar({ length: 20 })
      .$type<WhatsappSessionGcRevisionStatus>()
      .notNull(),
    eligible_at: timestamp({ mode: 'string', withTimezone: true }).notNull(),
    claim_token: uuid(),
    claim_expires_at: timestamp({ mode: 'string', withTimezone: true }),
    attempt_count: integer().notNull().default(0),
    last_error_code: varchar({ length: 100 }),
    created_at: timestamp({ mode: 'string', withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp({ mode: 'string', withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: 'whatsapp_session_gc_queue_pk',
      columns: [table.session_id, table.revision_id],
    }),
    foreignKey({
      name: 'whatsapp_session_gc_queue_revision_fk',
      columns: [table.session_id, table.revision_id],
      foreignColumns: [
        whatsappSessionRevision.session_id,
        whatsappSessionRevision.revision_id,
      ],
    }).onDelete('cascade'),
    index('whatsapp_session_gc_queue_dispatch_idx')
      .on(table.eligible_at, table.session_id, table.revision_id)
      .where(sql`${table.claim_token} IS NULL`),
    index('whatsapp_session_gc_queue_claim_expiry_idx')
      .on(table.claim_expires_at, table.session_id, table.revision_id)
      .where(sql`${table.claim_token} IS NOT NULL`),
    check(
      'whatsapp_session_gc_queue_status_check',
      sql`${table.revision_status} IN ('staging', 'failed', 'retired')`
    ),
    check(
      'whatsapp_session_gc_queue_attempt_check',
      sql`${table.attempt_count} >= 0`
    ),
    check(
      'whatsapp_session_gc_queue_claim_check',
      sql`(${table.claim_token} IS NULL AND ${table.claim_expires_at} IS NULL) OR (${table.claim_token} IS NOT NULL AND ${table.claim_expires_at} IS NOT NULL)`
    ),
  ]
);

export const whatsappSessionLease = pgTable(
  'whatsapp_session_lease',
  {
    session_id: uuid().primaryKey().notNull(),
    owner_id: uuid(),
    provider: varchar({ length: 20 }).$type<WhatsappSessionProvider>(),
    fencing_token: bigint({ mode: 'number' }).notNull().default(0),
    generation: integer().notNull().default(1),
    epoch: uuid(),
    acquired_at: timestamp({ mode: 'string', withTimezone: true }),
    heartbeat_at: timestamp({ mode: 'string', withTimezone: true }),
    expires_at: timestamp({ mode: 'string', withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: 'whatsapp_session_lease_session_fk',
      columns: [table.session_id],
      foreignColumns: [whatsappSession.session_id],
    }).onDelete('cascade'),
    check(
      'whatsapp_session_lease_token_check',
      sql`${table.fencing_token} >= 0 AND ${table.generation} > 0`
    ),
    check(
      'whatsapp_session_lease_owner_fields_check',
      sql`(${table.owner_id} IS NULL AND ${table.provider} IS NULL AND ${table.epoch} IS NULL AND ${table.expires_at} IS NULL) OR (${table.owner_id} IS NOT NULL AND ${table.provider} IS NOT NULL AND ${table.epoch} IS NOT NULL AND ${table.acquired_at} IS NOT NULL AND ${table.heartbeat_at} IS NOT NULL AND ${table.expires_at} IS NOT NULL)`
    ),
    check(
      'whatsapp_session_lease_provider_check',
      sql`${table.provider} IS NULL OR ${table.provider} IN ('baileys', 'wwebjs', 'whatsmeow')`
    ),
  ]
);

export const whatsappProviderRecord = pgTable(
  'whatsapp_provider_record',
  {
    session_id: uuid().notNull(),
    revision_id: bigint({ mode: 'number' }).notNull(),
    namespace: varchar({ length: 100 }).notNull(),
    record_key: varchar({ length: 500 }).notNull(),
    codec_version: integer().notNull().default(1),
    payload: bytea().notNull(),
    updated_at: timestamp({ mode: 'string', withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: 'whatsapp_provider_record_pk',
      columns: [
        table.session_id,
        table.revision_id,
        table.namespace,
        table.record_key,
      ],
    }),
    foreignKey({
      name: 'whatsapp_provider_record_revision_fk',
      columns: [table.session_id, table.revision_id],
      foreignColumns: [
        whatsappSessionRevision.session_id,
        whatsappSessionRevision.revision_id,
      ],
    }).onDelete('cascade'),
    check(
      'whatsapp_provider_record_codec_check',
      sql`${table.codec_version} > 0 AND octet_length(${table.payload}) > 0`
    ),
    check(
      'whatsapp_provider_record_payload_check',
      sql`octet_length(${table.payload}) BETWEEN 1 AND 8388608`
    ),
  ]
);

export const whatsappArtifact = pgTable(
  'whatsapp_artifact',
  {
    session_id: uuid().notNull(),
    artifact_id: uuid().notNull().defaultRandom(),
    revision_id: bigint({ mode: 'number' }).notNull(),
    provider: varchar({ length: 20 })
      .$type<WhatsappSessionProvider>()
      .notNull(),
    kind: varchar({ length: 50 }).notNull(),
    status: varchar({ length: 20 })
      .$type<WhatsappArtifactStatus>()
      .notNull()
      .default('staging'),
    manifest: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    checksum_sha256: varchar({ length: 64 }).notNull(),
    size_bytes: bigint({ mode: 'number' }).notNull(),
    chunk_count: integer().notNull(),
    created_at: timestamp({ mode: 'string', withTimezone: true })
      .defaultNow()
      .notNull(),
    persisted_at: timestamp({ mode: 'string', withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: 'whatsapp_artifact_pk',
      columns: [table.session_id, table.artifact_id],
    }),
    foreignKey({
      name: 'whatsapp_artifact_revision_fk',
      columns: [table.session_id, table.revision_id],
      foreignColumns: [
        whatsappSessionRevision.session_id,
        whatsappSessionRevision.revision_id,
      ],
    }).onDelete('cascade'),
    unique('whatsapp_artifact_revision_artifact_uq').on(
      table.session_id,
      table.revision_id,
      table.artifact_id
    ),
    index('whatsapp_artifact_revision_idx').on(
      table.session_id,
      table.revision_id,
      table.created_at
    ),
    uniqueIndex('whatsapp_artifact_wwebjs_ready_profile_uidx')
      .on(table.session_id, table.revision_id)
      .where(
        sql`${table.provider} = 'wwebjs' AND ${table.kind} = 'wwebjs_profile' AND ${table.status} = 'ready'`
      ),
    index('whatsapp_artifact_wwebjs_retired_profile_gc_idx')
      .on(
        table.persisted_at,
        table.session_id,
        table.revision_id,
        table.artifact_id
      )
      .where(
        sql`${table.provider} = 'wwebjs' AND ${table.kind} = 'wwebjs_profile' AND ${table.status} = 'retired'`
      ),
    check(
      'whatsapp_artifact_checksum_check',
      sql`${table.checksum_sha256} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      'whatsapp_artifact_size_check',
      sql`${table.size_bytes} >= 0 AND ${table.size_bytes} <= 536870912`
    ),
    check(
      'whatsapp_artifact_chunk_count_check',
      sql`${table.chunk_count} >= 0 AND ${table.chunk_count} <= 65536`
    ),
    check(
      'whatsapp_artifact_status_check',
      sql`${table.status} IN ('staging', 'ready', 'failed', 'retired')`
    ),
    check(
      'whatsapp_artifact_manifest_check',
      sql`jsonb_typeof(${table.manifest}) = 'object'`
    ),
    check(
      'whatsapp_artifact_manifest_size_check',
      sql`octet_length(${table.manifest}::text) <= 1048576`
    ),
    check(
      'whatsapp_artifact_provider_check',
      sql`${table.provider} IN ('baileys', 'wwebjs', 'whatsmeow')`
    ),
  ]
);

export const whatsappWwebjsProfileAnchor = pgTable(
  'whatsapp_wwebjs_profile_anchor',
  {
    session_id: uuid().notNull(),
    revision_id: bigint({ mode: 'number' }).notNull(),
    anchor_generation: bigint({ mode: 'number' }).notNull(),
    artifact_id: uuid().notNull(),
    state: varchar({ length: 16 })
      .$type<WhatsappWwebjsProfileAnchorState>()
      .notNull(),
    checkpoint_mode: varchar({ length: 64 })
      .$type<WhatsappWwebjsProfileCheckpointMode>()
      .notNull(),
    artifact_checksum_sha256: varchar({ length: 64 }).notNull(),
    artifact_size_bytes: bigint({ mode: 'number' }).notNull(),
    artifact_chunk_count: integer().notNull(),
    artifact_persisted_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).notNull(),
    artifact_verified_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).notNull(),
    baseline_app_state_checksum_sha256: varchar({ length: 64 }),
    current_app_state_checksum_sha256: varchar({ length: 64 }).notNull(),
    app_state_overlay_required: boolean().notNull(),
    canonical_generation: bigint({ mode: 'number' }).notNull(),
    canonical_checksum_sha256: varchar({ length: 64 }).notNull(),
    canonical_record_count: integer().notNull(),
    canonical_size_bytes: bigint({ mode: 'number' }).notNull(),
    canonical_persisted_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).notNull(),
    source: varchar({ length: 64 }).notNull(),
    last_profile_observed_size_bytes: bigint({ mode: 'number' }),
    retain_until: timestamp({ mode: 'string', withTimezone: true }),
    created_at: timestamp({ mode: 'string', withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp({ mode: 'string', withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: 'whatsapp_wwebjs_profile_anchor_pk',
      columns: [table.session_id, table.revision_id, table.anchor_generation],
    }),
    unique('whatsapp_wwebjs_profile_anchor_artifact_uq').on(
      table.session_id,
      table.revision_id,
      table.artifact_id
    ),
    foreignKey({
      name: 'whatsapp_wwebjs_profile_anchor_revision_fk',
      columns: [table.session_id, table.revision_id],
      foreignColumns: [
        whatsappSessionRevision.session_id,
        whatsappSessionRevision.revision_id,
      ],
    }).onDelete('cascade'),
    foreignKey({
      name: 'whatsapp_wwebjs_profile_anchor_artifact_fk',
      columns: [table.session_id, table.revision_id, table.artifact_id],
      foreignColumns: [
        whatsappArtifact.session_id,
        whatsappArtifact.revision_id,
        whatsappArtifact.artifact_id,
      ],
    }).onDelete('cascade'),
    uniqueIndex('whatsapp_wwebjs_profile_anchor_active_uidx')
      .on(table.session_id, table.revision_id)
      .where(sql`${table.state} = 'active'`),
    uniqueIndex('whatsapp_wwebjs_profile_anchor_previous_uidx')
      .on(table.session_id, table.revision_id)
      .where(sql`${table.state} = 'previous'`),
    index('whatsapp_wwebjs_profile_anchor_gc_idx')
      .on(
        table.retain_until,
        table.session_id,
        table.revision_id,
        table.anchor_generation
      )
      .where(sql`${table.state} = 'previous'`),
    index('whatsapp_wwebjs_profile_anchor_artifact_idx').on(
      table.session_id,
      table.artifact_id
    ),
    check(
      'whatsapp_wwebjs_profile_anchor_generation_check',
      sql`${table.anchor_generation} > 0 AND ${table.canonical_generation} > 0`
    ),
    check(
      'whatsapp_wwebjs_profile_anchor_state_check',
      sql`${table.state} IN ('active', 'previous')`
    ),
    check(
      'whatsapp_wwebjs_profile_anchor_mode_check',
      sql`${table.checkpoint_mode} IN ('legacy_adoption_v1', 'full_profile_plus_fresh_canonical_v1', 'immutable_profile_anchor_plus_fresh_canonical_v1', 'last_good_plus_fresh_canonical_v1')`
    ),
    check(
      'whatsapp_wwebjs_profile_anchor_artifact_checksum_check',
      sql`${table.artifact_checksum_sha256} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      'whatsapp_wwebjs_profile_anchor_artifact_size_check',
      sql`${table.artifact_size_bytes} BETWEEN 1 AND 536870912`
    ),
    check(
      'whatsapp_wwebjs_profile_anchor_artifact_chunk_count_check',
      sql`${table.artifact_chunk_count} BETWEEN 1 AND 65536`
    ),
    check(
      'whatsapp_wwebjs_profile_anchor_baseline_checksum_check',
      sql`${table.baseline_app_state_checksum_sha256} IS NULL OR ${table.baseline_app_state_checksum_sha256} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      'whatsapp_wwebjs_profile_anchor_current_checksum_check',
      sql`${table.current_app_state_checksum_sha256} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      'whatsapp_wwebjs_profile_anchor_overlay_check',
      sql`${table.app_state_overlay_required} OR ${table.baseline_app_state_checksum_sha256} = ${table.current_app_state_checksum_sha256}`
    ),
    check(
      'whatsapp_wwebjs_profile_anchor_canonical_checksum_check',
      sql`${table.canonical_checksum_sha256} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      'whatsapp_wwebjs_profile_anchor_canonical_shape_check',
      sql`${table.canonical_record_count} >= 0 AND ${table.canonical_size_bytes} BETWEEN 1 AND 67108864`
    ),
    check(
      'whatsapp_wwebjs_profile_anchor_source_check',
      sql`${table.source} ~ '^[a-z][a-z0-9_]{0,63}$'`
    ),
    check(
      'whatsapp_wwebjs_profile_anchor_observed_size_check',
      sql`${table.last_profile_observed_size_bytes} IS NULL OR ${table.last_profile_observed_size_bytes} >= 0`
    ),
    check(
      'whatsapp_wwebjs_profile_anchor_retention_check',
      sql`(${table.state} = 'active' AND ${table.retain_until} IS NULL) OR (${table.state} = 'previous' AND ${table.retain_until} IS NOT NULL)`
    ),
  ]
);

export const whatsappArtifactBlob = pgTable(
  'whatsapp_artifact_blob',
  {
    session_id: uuid().notNull(),
    sha256: varchar({ length: 64 }).notNull(),
    payload: bytea().notNull(),
    size_bytes: integer().notNull(),
    created_at: timestamp({ mode: 'string', withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: 'whatsapp_artifact_blob_pk',
      columns: [table.session_id, table.sha256],
    }),
    index('whatsapp_artifact_blob_gc_idx').on(
      table.created_at,
      table.session_id,
      table.sha256
    ),
    foreignKey({
      name: 'whatsapp_artifact_blob_session_fk',
      columns: [table.session_id],
      foreignColumns: [whatsappSession.session_id],
    }).onDelete('cascade'),
    check(
      'whatsapp_artifact_blob_checksum_check',
      sql`${table.sha256} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      'whatsapp_artifact_blob_digest_check',
      sql`${table.sha256} = encode(digest(${table.payload}, 'sha256'), 'hex')`
    ),
    check(
      'whatsapp_artifact_blob_payload_check',
      sql`${table.size_bytes} = octet_length(${table.payload}) AND ${table.size_bytes} > 0 AND ${table.size_bytes} <= 1048576`
    ),
  ]
);

export const whatsappArtifactChunk = pgTable(
  'whatsapp_artifact_chunk',
  {
    session_id: uuid().notNull(),
    artifact_id: uuid().notNull(),
    chunk_index: integer().notNull(),
    sha256: varchar({ length: 64 }).notNull(),
  },
  (table) => [
    primaryKey({
      name: 'whatsapp_artifact_chunk_pk',
      columns: [table.session_id, table.artifact_id, table.chunk_index],
    }),
    index('whatsapp_artifact_chunk_blob_idx').on(
      table.session_id,
      table.sha256
    ),
    foreignKey({
      name: 'whatsapp_artifact_chunk_artifact_fk',
      columns: [table.session_id, table.artifact_id],
      foreignColumns: [
        whatsappArtifact.session_id,
        whatsappArtifact.artifact_id,
      ],
    }).onDelete('cascade'),
    foreignKey({
      name: 'whatsapp_artifact_chunk_blob_fk',
      columns: [table.session_id, table.sha256],
      foreignColumns: [
        whatsappArtifactBlob.session_id,
        whatsappArtifactBlob.sha256,
      ],
    }).onDelete('restrict'),
    check(
      'whatsapp_artifact_chunk_index_check',
      sql`${table.chunk_index} >= 0`
    ),
  ]
);

export const whatsappSessionHandoff = pgTable(
  'whatsapp_session_handoff',
  {
    session_id: uuid().notNull(),
    handoff_id: uuid().notNull().defaultRandom(),
    lifecycle_operation_id: uuid(),
    source_provider: varchar({ length: 20 })
      .$type<WhatsappSessionProvider>()
      .notNull(),
    target_provider: varchar({ length: 20 })
      .$type<WhatsappSessionProvider>()
      .notNull(),
    source_revision_id: bigint({ mode: 'number' }).notNull(),
    target_revision_id: bigint({ mode: 'number' }),
    state: varchar({ length: 20 })
      .$type<WhatsappSessionHandoffState>()
      .notNull()
      .default('requested'),
    attempt_count: integer().notNull().default(0),
    next_attempt_at: timestamp({ mode: 'string', withTimezone: true })
      .defaultNow()
      .notNull(),
    error_code: varchar({ length: 100 }),
    source_checkpoint_checksum_sha256: varchar({ length: 64 }),
    source_checkpoint_size_bytes: bigint({ mode: 'number' }),
    source_checkpoint_record_count: bigint({ mode: 'number' }),
    source_drained_at: timestamp({ mode: 'string', withTimezone: true }),
    point_of_no_return_at: timestamp({ mode: 'string', withTimezone: true }),
    pre_activation_artifact_id: uuid(),
    created_at: timestamp({ mode: 'string', withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp({ mode: 'string', withTimezone: true })
      .defaultNow()
      .notNull(),
    completed_at: timestamp({ mode: 'string', withTimezone: true }),
    recovery_state: varchar({ length: 20 })
      .$type<WhatsappSessionHandoffRecoveryState>()
      .notNull()
      .default('none'),
    recovery_operation_id: uuid(),
    recovery_cleanup_required: boolean(),
    recovery_from_generation: integer(),
    recovery_attempt_count: integer().notNull().default(0),
    recovery_next_attempt_at: timestamp({ mode: 'string', withTimezone: true }),
    recovery_claim_token: uuid(),
    recovery_claim_expires_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }),
    recovery_last_error_code: varchar({ length: 100 }),
    recovery_started_at: timestamp({ mode: 'string', withTimezone: true }),
    recovery_completed_at: timestamp({ mode: 'string', withTimezone: true }),
  },
  (table) => [
    primaryKey({
      name: 'whatsapp_session_handoff_pk',
      columns: [table.session_id, table.handoff_id],
    }),
    foreignKey({
      name: 'whatsapp_session_handoff_source_revision_fk',
      columns: [table.session_id, table.source_revision_id],
      foreignColumns: [
        whatsappSessionRevision.session_id,
        whatsappSessionRevision.revision_id,
      ],
    }).onDelete('cascade'),
    foreignKey({
      name: 'whatsapp_session_handoff_target_revision_fk',
      columns: [table.session_id, table.target_revision_id],
      foreignColumns: [
        whatsappSessionRevision.session_id,
        whatsappSessionRevision.revision_id,
      ],
    }).onDelete('cascade'),
    uniqueIndex('whatsapp_session_handoff_active_uidx')
      .on(table.session_id)
      .where(
        sql`${table.state} IN ('requested', 'draining', 'transforming', 'hydrating', 'validating', 'promoting', 'activating')`
      ),
    uniqueIndex('whatsapp_session_handoff_lifecycle_uidx')
      .on(table.session_id, table.lifecycle_operation_id)
      .where(sql`${table.lifecycle_operation_id} IS NOT NULL`),
    index('whatsapp_session_handoff_dispatch_idx')
      .on(
        table.next_attempt_at,
        table.created_at,
        table.session_id,
        table.handoff_id
      )
      .where(sql`${table.state} = 'requested'`),
    index('whatsapp_session_handoff_gc_idx')
      .on(table.completed_at, table.session_id, table.handoff_id)
      .where(sql`${table.state} IN ('completed', 'failed')`),
    index('whatsapp_session_handoff_pre_activation_artifact_idx')
      .on(table.session_id, table.pre_activation_artifact_id)
      .where(sql`${table.pre_activation_artifact_id} IS NOT NULL`),
    index('whatsapp_session_handoff_recovery_idx')
      .on(table.recovery_next_attempt_at, table.session_id, table.handoff_id)
      .where(
        sql`${table.state} = 'failed' AND ${table.recovery_state} IN ('pending', 'dispatching', 'running')`
      ),
    check(
      'whatsapp_session_handoff_provider_check',
      sql`${table.source_provider} IN ('baileys', 'wwebjs', 'whatsmeow') AND ${table.target_provider} IN ('baileys', 'wwebjs', 'whatsmeow')`
    ),
    check(
      'whatsapp_session_handoff_state_check',
      sql`${table.state} IN ('requested', 'draining', 'transforming', 'hydrating', 'validating', 'promoting', 'activating', 'completed', 'failed')`
    ),
    check(
      'whatsapp_session_handoff_attempt_check',
      sql`${table.attempt_count} >= 0`
    ),
    check(
      'whatsapp_session_handoff_checkpoint_checksum_check',
      sql`${table.source_checkpoint_checksum_sha256} IS NULL OR ${table.source_checkpoint_checksum_sha256} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      'whatsapp_session_handoff_checkpoint_size_check',
      sql`${table.source_checkpoint_size_bytes} IS NULL OR ${table.source_checkpoint_size_bytes} >= 0`
    ),
    check(
      'whatsapp_session_handoff_checkpoint_record_count_check',
      sql`${table.source_checkpoint_record_count} IS NULL OR ${table.source_checkpoint_record_count} >= 0`
    ),
    check(
      'whatsapp_session_handoff_source_drain_proof_check',
      sql`(${table.source_drained_at} IS NULL AND ${table.source_checkpoint_checksum_sha256} IS NULL AND ${table.source_checkpoint_size_bytes} IS NULL AND ${table.source_checkpoint_record_count} IS NULL) OR (${table.source_drained_at} IS NOT NULL AND ${table.source_checkpoint_checksum_sha256} IS NOT NULL AND ${table.source_checkpoint_size_bytes} IS NOT NULL AND ${table.source_checkpoint_record_count} IS NOT NULL)`
    ),
    check(
      'whatsapp_session_handoff_activation_boundary_check',
      sql`(${table.state} = 'activating' AND ${table.point_of_no_return_at} IS NOT NULL AND ${table.pre_activation_artifact_id} IS NOT NULL) OR (${table.state} <> 'activating')`
    ),
    check(
      'whatsapp_session_handoff_recovery_attempt_check',
      sql`${table.recovery_attempt_count} >= 0`
    ),
    check(
      'whatsapp_session_handoff_recovery_generation_check',
      sql`${table.recovery_from_generation} IS NULL OR ${table.recovery_from_generation} > 0`
    ),
    check(
      'whatsapp_session_handoff_recovery_state_check',
      sql`${table.recovery_state} IN ('none', 'pending', 'dispatching', 'running', 'completed', 'blocked', 'cancelled')`
    ),
    check(
      'whatsapp_session_handoff_recovery_identity_check',
      sql`(${table.recovery_state} = 'none' AND ${table.recovery_operation_id} IS NULL) OR (${table.recovery_state} <> 'none' AND ${table.recovery_operation_id} IS NOT NULL AND ${table.recovery_next_attempt_at} IS NOT NULL)`
    ),
    check(
      'whatsapp_session_handoff_recovery_claim_check',
      sql`(${table.recovery_claim_token} IS NULL AND ${table.recovery_claim_expires_at} IS NULL) OR (${table.recovery_claim_token} IS NOT NULL AND ${table.recovery_claim_expires_at} IS NOT NULL)`
    ),
    check(
      'whatsapp_session_handoff_recovery_completion_check',
      sql`(${table.recovery_state} = 'completed' AND ${table.recovery_completed_at} IS NOT NULL) OR (${table.recovery_state} <> 'completed' AND ${table.recovery_completed_at} IS NULL)`
    ),
  ]
);

/**
 * Durable user decision for a failed provider handoff.
 *
 * This intentionally belongs to the worker rather than whatsapp_session: a
 * discard removes the complete session tree (including the handoff row), but
 * its idempotency/result must remain queryable until the worker is deleted.
 */
export const whatsappSessionHandoffResolution = pgTable(
  'whatsapp_session_handoff_resolution',
  {
    session_id: uuid()
      .references(() => worker.worker_id, { onDelete: 'cascade' })
      .notNull(),
    handoff_id: uuid().notNull(),
    handoff_lifecycle_operation_id: uuid().notNull(),
    account_id: uuid().notNull(),
    source_provider: varchar({ length: 20 })
      .$type<WhatsappSessionProvider>()
      .notNull(),
    target_provider: varchar({ length: 20 })
      .$type<WhatsappSessionProvider>()
      .notNull(),
    source_revision_id: bigint({ mode: 'number' }).notNull(),
    target_revision_id: bigint({ mode: 'number' }),
    action: varchar({ length: 20 })
      .$type<WhatsappSessionHandoffResolutionAction>()
      .notNull(),
    state: varchar({ length: 20 })
      .$type<WhatsappSessionHandoffResolutionState>()
      .notNull(),
    operation_id: uuid().notNull(),
    last_error_code: varchar({ length: 100 }),
    requested_at: timestamp({ mode: 'string', withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp({ mode: 'string', withTimezone: true })
      .defaultNow()
      .notNull(),
    cleanup_finalized_at: timestamp({ mode: 'string', withTimezone: true }),
    completed_at: timestamp({ mode: 'string', withTimezone: true }),
  },
  (table) => [
    primaryKey({
      name: 'whatsapp_session_handoff_resolution_pk',
      columns: [table.session_id, table.handoff_id],
    }),
    uniqueIndex('whatsapp_session_handoff_resolution_operation_uidx').on(
      table.session_id,
      table.operation_id
    ),
    index('whatsapp_session_handoff_resolution_pending_idx')
      .on(table.session_id, table.updated_at, table.handoff_id)
      .where(sql`${table.state} = 'running'`),
    check(
      'whatsapp_session_handoff_resolution_provider_check',
      sql`${table.source_provider} IN ('baileys', 'wwebjs', 'whatsmeow') AND ${table.target_provider} IN ('baileys', 'wwebjs', 'whatsmeow') AND ${table.source_provider} <> ${table.target_provider}`
    ),
    check(
      'whatsapp_session_handoff_resolution_action_check',
      sql`${table.action} IN ('return', 'discard')`
    ),
    check(
      'whatsapp_session_handoff_resolution_state_check',
      sql`${table.state} IN ('running', 'completed')`
    ),
    check(
      'whatsapp_session_handoff_resolution_completion_check',
      sql`(${table.state} = 'completed' AND ${table.completed_at} IS NOT NULL) OR (${table.state} = 'running' AND ${table.completed_at} IS NULL)`
    ),
  ]
);

export type WorkerRuntimeEventOutboxState =
  'pending' | 'publishing' | 'published' | 'dead_letter';

export const workerRuntimeEventOutbox = pgTable(
  'worker_runtime_event_outbox',
  {
    outbox_id: generatedBigint(),
    event_id: uuid().notNull(),
    worker_id: uuid().notNull(),
    account_id: uuid().notNull(),
    provider: varchar({ length: 20 })
      .$type<WorkerWhatsappSessionProvider>()
      .notNull(),
    container_id: varchar({ length: 100 }).notNull(),
    runtime_generation: integer().notNull(),
    writer_epoch: uuid().notNull(),
    connection_sequence: bigint({ mode: 'number' }).notNull(),
    capability_hash: varchar({ length: 64 }).notNull(),
    event_type: varchar({ length: 50 }).notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    state: varchar({ length: 20 })
      .$type<WorkerRuntimeEventOutboxState>()
      .notNull()
      .default('pending'),
    attempt_count: integer().notNull().default(0),
    available_at: timestamp({ mode: 'string', withTimezone: true })
      .defaultNow()
      .notNull(),
    lease_owner: uuid(),
    lease_expires_at: timestamp({ mode: 'string', withTimezone: true }),
    last_error: varchar({ length: 1000 }),
    created_at: timestamp({ mode: 'string', withTimezone: true })
      .defaultNow()
      .notNull(),
    published_at: timestamp({ mode: 'string', withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: 'worker_runtime_event_outbox_worker_fk',
      columns: [table.worker_id],
      foreignColumns: [worker.worker_id],
    }).onDelete('cascade'),
    primaryKey({
      name: 'worker_runtime_event_outbox_pk',
      columns: [table.outbox_id],
    }),
    foreignKey({
      name: 'worker_runtime_event_outbox_account_worker_fk',
      columns: [table.account_id, table.worker_id],
      foreignColumns: [worker.account_id, worker.worker_id],
    }).onDelete('cascade'),
    uniqueIndex('worker_runtime_event_outbox_event_id_uidx').on(table.event_id),
    index('worker_runtime_event_outbox_pending_idx')
      .on(table.available_at, table.outbox_id)
      .where(sql`${table.state} = 'pending'`),
    index('worker_runtime_event_outbox_unpublished_worker_idx')
      .on(table.worker_id, table.outbox_id)
      .where(sql`${table.state} IN ('pending', 'publishing')`),
    index('worker_runtime_event_outbox_published_retention_idx')
      .on(table.published_at, table.outbox_id)
      .where(sql`${table.state} = 'published'`),
    index('worker_runtime_event_outbox_dead_letter_retention_idx')
      .on(table.created_at, table.outbox_id)
      .where(sql`${table.state} = 'dead_letter'`),
    index('worker_runtime_event_outbox_worker_created_idx').on(
      table.worker_id,
      table.created_at
    ),
    check(
      'worker_runtime_event_outbox_provider_check',
      sql`${table.provider} IN ('baileys', 'wwebjs', 'whatsmeow')`
    ),
    check(
      'worker_runtime_event_outbox_state_check',
      sql`${table.state} IN ('pending', 'publishing', 'published', 'dead_letter')`
    ),
    check(
      'worker_runtime_event_outbox_event_type_check',
      sql`${table.event_type} IN ('status', 'telemetry')`
    ),
    check(
      'worker_runtime_event_outbox_payload_object_check',
      sql`jsonb_typeof(${table.payload}) = 'object'`
    ),
    check(
      'worker_runtime_event_outbox_generation_check',
      sql`${table.runtime_generation} > 0 AND ${table.connection_sequence} >= 0`
    ),
    check(
      'worker_runtime_event_outbox_capability_check',
      sql`${table.capability_hash} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      'worker_runtime_event_outbox_attempt_check',
      sql`${table.attempt_count} >= 0`
    ),
  ]
);

export type WorkerSelfHealRequestState =
  'queued' | 'processing' | 'dispatched' | 'completed' | 'cancelled';

export const workerSelfHealRequest = pgTable(
  'worker_self_heal_request',
  {
    request_id: uuid().primaryKey().notNull().defaultRandom(),
    request_key: varchar({ length: 255 }).notNull(),
    worker_id: uuid().notNull(),
    account_id: uuid().notNull(),
    provider: varchar({ length: 20 })
      .$type<WorkerWhatsappSessionProvider>()
      .notNull(),
    container_id: varchar({ length: 100 }).notNull(),
    runtime_generation: integer().notNull(),
    writer_epoch: uuid().notNull(),
    capability_hash: varchar({ length: 64 }).notNull(),
    reason: varchar({ length: 100 }).notNull(),
    evidence: jsonb().$type<Record<string, unknown>>().notNull(),
    state: varchar({ length: 20 })
      .$type<WorkerSelfHealRequestState>()
      .notNull()
      .default('queued'),
    attempt_count: integer().notNull().default(0),
    available_at: timestamp({ mode: 'string', withTimezone: true })
      .defaultNow()
      .notNull(),
    lease_owner: uuid(),
    lease_expires_at: timestamp({ mode: 'string', withTimezone: true }),
    last_error: varchar({ length: 1000 }),
    created_at: timestamp({ mode: 'string', withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp({ mode: 'string', withTimezone: true })
      .defaultNow()
      .notNull(),
    dispatched_at: timestamp({ mode: 'string', withTimezone: true }),
    completed_at: timestamp({ mode: 'string', withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: 'worker_self_heal_request_worker_fk',
      columns: [table.worker_id],
      foreignColumns: [worker.worker_id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'worker_self_heal_request_account_worker_fk',
      columns: [table.account_id, table.worker_id],
      foreignColumns: [worker.account_id, worker.worker_id],
    }).onDelete('cascade'),
    index('worker_self_heal_request_key_idx').on(table.request_key),
    uniqueIndex('worker_self_heal_request_active_uidx')
      .on(
        table.worker_id,
        table.runtime_generation,
        table.capability_hash,
        table.reason
      )
      .where(sql`${table.state} IN ('queued', 'processing', 'dispatched')`),
    index('worker_self_heal_request_claim_idx')
      .on(table.available_at, table.created_at, table.request_id)
      .where(sql`${table.state} = 'queued'`),
    index('worker_self_heal_request_processing_lease_idx')
      .on(table.lease_expires_at, table.created_at, table.request_id)
      .where(sql`${table.state} = 'processing'`),
    check(
      'worker_self_heal_request_provider_check',
      sql`${table.provider} IN ('baileys', 'wwebjs', 'whatsmeow')`
    ),
    check(
      'worker_self_heal_request_state_check',
      sql`${table.state} IN ('queued', 'processing', 'dispatched', 'completed', 'cancelled')`
    ),
    check(
      'worker_self_heal_request_generation_check',
      sql`${table.runtime_generation} > 0`
    ),
    check(
      'worker_self_heal_request_capability_check',
      sql`${table.capability_hash} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      'worker_self_heal_request_attempt_check',
      sql`${table.attempt_count} >= 0`
    ),
  ]
);
