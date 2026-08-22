import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { worker } from './worker.model';

export type WhatsappPairingActivationGrantProvider =
  'baileys' | 'wwebjs' | 'whatsmeow';

/**
 * One-shot control-plane authorization for replacing an explicitly
 * disconnected connection epoch without replacing the worker runtime.
 */
export const whatsappPairingActivationGrant = pgTable(
  'whatsapp_pairing_activation_grant',
  {
    connection_attempt_id: uuid().primaryKey().notNull(),
    worker_id: uuid().notNull(),
    account_id: uuid().notNull(),
    provider: varchar({ length: 20 })
      .$type<WhatsappPairingActivationGrantProvider>()
      .notNull(),
    runtime_generation: integer().notNull(),
    container_id: varchar({ length: 100 }).notNull(),
    expected_connection_epoch: varchar({ length: 100 }),
    authorized_connection_epoch: uuid().notNull(),
    connection_sequence_at_grant: bigint({ mode: 'number' }).notNull(),
    expires_at: timestamp({ mode: 'string', withTimezone: true }).notNull(),
    consumed_at: timestamp({ mode: 'string', withTimezone: true }),
    revoked_at: timestamp({ mode: 'string', withTimezone: true }),
    created_at: timestamp({ mode: 'string', withTimezone: true })
      .default(sql`clock_timestamp()`)
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: 'whatsapp_pairing_activation_grant_worker_fk',
      columns: [table.account_id, table.worker_id],
      foreignColumns: [worker.account_id, worker.worker_id],
    }).onDelete('cascade'),
    uniqueIndex('whatsapp_pairing_activation_grant_epoch_uidx').on(
      table.authorized_connection_epoch
    ),
    index('whatsapp_pairing_activation_grant_worker_idx').on(
      table.worker_id,
      table.account_id
    ),
    uniqueIndex('whatsapp_pairing_activation_grant_active_worker_uidx')
      .on(table.worker_id)
      .where(sql`${table.consumed_at} IS NULL AND ${table.revoked_at} IS NULL`),
    index('whatsapp_pairing_activation_grant_expiry_idx')
      .on(table.expires_at)
      .where(sql`${table.consumed_at} IS NULL AND ${table.revoked_at} IS NULL`),
    check(
      'whatsapp_pairing_activation_grant_provider_check',
      sql`${table.provider} IN ('baileys', 'wwebjs', 'whatsmeow')`
    ),
    check(
      'whatsapp_pairing_activation_grant_generation_check',
      sql`${table.runtime_generation} > 0`
    ),
    check(
      'whatsapp_pairing_activation_grant_container_check',
      sql`lower(trim(${table.container_id})) ~ '^[0-9a-f]{12,64}$'`
    ),
    check(
      'whatsapp_pairing_activation_grant_sequence_check',
      sql`${table.connection_sequence_at_grant} >= 0`
    ),
    check(
      'whatsapp_pairing_activation_grant_epoch_transition_check',
      sql`${table.authorized_connection_epoch}::text IS DISTINCT FROM ${table.expected_connection_epoch}`
    ),
    check(
      'whatsapp_pairing_activation_grant_expiry_check',
      sql`${table.expires_at} > ${table.created_at}`
    ),
    check(
      'whatsapp_pairing_activation_grant_terminal_check',
      sql`NOT (${table.consumed_at} IS NOT NULL AND ${table.revoked_at} IS NOT NULL)`
    ),
  ]
);
