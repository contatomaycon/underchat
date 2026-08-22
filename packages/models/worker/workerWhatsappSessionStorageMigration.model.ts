import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { worker } from './worker.model';
import type { WorkerWhatsappSessionProvider } from './workerWhatsappSession.model';

export type WhatsappSessionStorageMigrationState =
  | 'queued'
  | 'capturing'
  | 'staged'
  | 'cutting_over'
  | 'starting'
  | 'validating'
  | 'retry_wait'
  | 'restoring'
  | 'recovery_required'
  | 'restored'
  | 'cleanup_pending'
  | 'deleting_volume'
  | 'completed';

export interface WhatsappSessionStorageMigrationEvidence {
  authenticated?: boolean;
  session_ready?: boolean;
  can_send?: boolean;
  can_receive_runtime?: boolean;
  native_connection_valid?: boolean;
  kafka_ready?: boolean;
  command_ingress_ready?: boolean;
  command_ingress_authorized?: boolean;
  runtime_generation?: number;
  revision_id?: number;
  phone_matches?: boolean;
  identity_matches?: boolean;
  volume_absent?: boolean;
}

/**
 * Durable control-plane journal for the one-way legacy-volume migration.
 * Session material never belongs in this table; evidence is deliberately
 * restricted to health booleans, counters and hashes.
 */
export const whatsappSessionStorageMigration = pgTable(
  'whatsapp_session_storage_migration',
  {
    migration_id: uuid().primaryKey().notNull().defaultRandom(),
    worker_id: uuid().notNull(),
    account_id: uuid().notNull(),
    provider: varchar({ length: 20 })
      .$type<WorkerWhatsappSessionProvider>()
      .notNull(),
    state: varchar({ length: 24 })
      .$type<WhatsappSessionStorageMigrationState>()
      .notNull()
      .default('queued'),
    source_volume_name: varchar({ length: 255 }).notNull(),
    expected_phone: varchar({ length: 32 }),
    expected_identity_hash: varchar({ length: 64 }),
    source_runtime_generation: integer().notNull(),
    target_runtime_generation: integer(),
    target_revision_id: bigint({ mode: 'number' }),
    checkpoint_checksum: varchar({ length: 64 }),
    checkpoint_size_bytes: bigint({ mode: 'number' }),
    checkpoint_record_count: integer(),
    attempt_count: integer().notNull().default(0),
    max_attempts: integer().notNull().default(3),
    attempt_started_at: timestamp({ mode: 'string', withTimezone: true }),
    attempt_deadline_at: timestamp({ mode: 'string', withTimezone: true }),
    next_attempt_at: timestamp({ mode: 'string', withTimezone: true }),
    claim_token: uuid(),
    claim_expires_at: timestamp({ mode: 'string', withTimezone: true }),
    lifecycle_operation_id: uuid(),
    source_volume_preserved: boolean().notNull().default(true),
    health_evidence: jsonb()
      .$type<WhatsappSessionStorageMigrationEvidence>()
      .notNull()
      .default({}),
    last_error_code: varchar({ length: 100 }),
    created_at: timestamp({ mode: 'string', withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp({ mode: 'string', withTimezone: true })
      .defaultNow()
      .notNull(),
    target_validated_at: timestamp({ mode: 'string', withTimezone: true }),
    restored_at: timestamp({ mode: 'string', withTimezone: true }),
    volume_delete_requested_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }),
    volume_deleted_at: timestamp({ mode: 'string', withTimezone: true }),
    completed_at: timestamp({ mode: 'string', withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: 'whatsapp_session_storage_migration_worker_fk',
      columns: [table.worker_id],
      foreignColumns: [worker.worker_id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'whatsapp_session_storage_migration_account_worker_fk',
      columns: [table.account_id, table.worker_id],
      foreignColumns: [worker.account_id, worker.worker_id],
    }).onDelete('cascade'),
    uniqueIndex('whatsapp_session_storage_migration_active_worker_uidx')
      .on(table.worker_id)
      .where(
        sql`${table.state} NOT IN ('recovery_required', 'restored', 'completed')`
      ),
    index('whatsapp_session_storage_migration_claim_idx')
      .on(table.next_attempt_at, table.updated_at, table.migration_id)
      .where(
        sql`${table.state} IN ('queued', 'capturing', 'staged', 'cutting_over', 'starting', 'validating', 'retry_wait', 'restoring')`
      ),
    index('whatsapp_session_storage_migration_account_idx').on(
      table.account_id,
      table.created_at
    ),
    check(
      'whatsapp_session_storage_migration_provider_check',
      sql`${table.provider} IN ('baileys', 'wwebjs', 'whatsmeow')`
    ),
    check(
      'whatsapp_session_storage_migration_state_check',
      sql`${table.state} IN ('queued', 'capturing', 'staged', 'cutting_over', 'starting', 'validating', 'retry_wait', 'restoring', 'recovery_required', 'restored', 'cleanup_pending', 'deleting_volume', 'completed')`
    ),
    check(
      'whatsapp_session_storage_migration_attempt_check',
      sql`${table.max_attempts} = 3 AND ${table.attempt_count} BETWEEN 0 AND ${table.max_attempts}`
    ),
    check(
      'whatsapp_session_storage_migration_generation_check',
      sql`${table.source_runtime_generation} > 0 AND (${table.target_runtime_generation} IS NULL OR ${table.target_runtime_generation} > ${table.source_runtime_generation})`
    ),
    check(
      'whatsapp_session_storage_migration_checksum_check',
      sql`${table.checkpoint_checksum} IS NULL OR ${table.checkpoint_checksum} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      'whatsapp_session_storage_migration_identity_hash_check',
      sql`${table.expected_identity_hash} IS NULL OR ${table.expected_identity_hash} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      'whatsapp_session_storage_migration_size_check',
      sql`(${table.checkpoint_size_bytes} IS NULL OR ${table.checkpoint_size_bytes} >= 0) AND (${table.checkpoint_record_count} IS NULL OR ${table.checkpoint_record_count} >= 0)`
    ),
    check(
      'whatsapp_session_storage_migration_terminal_check',
      sql`(${table.state} = 'restored' AND ${table.restored_at} IS NOT NULL AND ${table.completed_at} IS NULL) OR (${table.state} = 'completed' AND ${table.completed_at} IS NOT NULL AND ${table.volume_deleted_at} IS NOT NULL) OR (${table.state} NOT IN ('restored', 'completed') AND ${table.completed_at} IS NULL)`
    ),
    check(
      'whatsapp_session_storage_migration_recovery_required_check',
      sql`${table.state} <> 'recovery_required' OR (${table.source_volume_preserved} = false AND ${table.next_attempt_at} IS NULL AND ${table.last_error_code} = 'session_storage_migration_source_volume_missing')`
    ),
  ]
);
