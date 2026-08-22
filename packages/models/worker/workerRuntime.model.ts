import {
  bigint,
  boolean,
  check,
  integer,
  index,
  jsonb,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { worker, workerWarmPool } from '@core/models';
import { relations, sql } from 'drizzle-orm';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import type { IWhatsappConnectionStatus } from '@core/common/interfaces/IWhatsappConnectionStatus';

export const workerRuntime = pgTable(
  'worker_runtime',
  {
    worker_id: uuid()
      .primaryKey()
      .references(() => worker.worker_id)
      .notNull(),
    container_id: varchar({ length: 100 }),
    container_name: varchar({ length: 150 }),
    session_storage: varchar({ length: 20 })
      .$type<EWorkerSessionStorage>()
      .notNull()
      .default(EWorkerSessionStorage.postgres),
    session_volume_name: varchar({ length: 150 }),
    runtime_generation: integer().notNull().default(1),
    runtime_capability_hash: varchar({ length: 64 }),
    session_writer_epoch: uuid(),
    connection_epoch: varchar({ length: 100 }),
    disconnected_connection_epoch: varchar({ length: 100 }),
    connection_disconnected_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }),
    connection_sequence: bigint({ mode: 'number' }).notNull().default(0),
    source_provider: varchar({ length: 20 }),
    native_connection_status: jsonb().$type<IWhatsappConnectionStatus | null>(),
    native_connection_public_status:
      jsonb().$type<IWhatsappConnectionStatus | null>(),
    native_connection_status_source_id: uuid(),
    native_connection_status_sequence: bigint({ mode: 'number' }),
    native_connection_status_outbox_id: bigint({ mode: 'bigint' }),
    native_connection_status_lease_owner_id: uuid(),
    native_connection_status_fencing_token: bigint({ mode: 'bigint' }),
    native_connection_status_changed_at_high_watermark: timestamp({
      mode: 'string',
      withTimezone: true,
    }),
    native_connection_status_retired_source_ids: uuid()
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    native_connection_online_acknowledged: boolean().notNull().default(false),
    connection_activated_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }),
    recreate_bootstrap_operation_id: uuid(),
    recreate_bootstrap_runtime_generation: integer(),
    recreate_bootstrap_container_id: varchar({ length: 100 }),
    recreate_bootstrap_started_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }),
    recreate_retired_operation_id: uuid(),
    recreate_retired_runtime_generation: integer(),
    recreate_retired_container_id: varchar({ length: 100 }),
    recreate_retired_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }),
    warm_pool_id: uuid().references(() => workerWarmPool.warm_pool_id),
    activated_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }),
    created_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    updated_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
  },
  (table) => [
    index('worker_runtime_container_id_idx').on(table.container_id),
    index('worker_runtime_container_name_idx').on(table.container_name),
    index('worker_runtime_session_volume_name_idx').on(
      table.session_volume_name
    ),
    index('worker_runtime_warm_pool_id_idx').on(table.warm_pool_id),
    index('worker_runtime_session_storage_idx').on(table.session_storage),
    check(
      'worker_runtime_connection_sequence_nonnegative_check',
      sql`${table.connection_sequence} >= 0`
    ),
    check(
      'worker_runtime_disconnect_barrier_check',
      sql`(
        ${table.disconnected_connection_epoch} IS NULL
        AND ${table.connection_disconnected_at} IS NULL
      ) OR (
        ${table.connection_disconnected_at} IS NOT NULL
        AND (
          ${table.disconnected_connection_epoch} IS NULL
          OR length(trim(${table.disconnected_connection_epoch})) BETWEEN 1 AND 100
        )
      )`
    ),
    check(
      'worker_runtime_recreate_bootstrap_marker_check',
      sql`(
        (
          ${table.recreate_bootstrap_operation_id} IS NULL
          AND ${table.recreate_bootstrap_runtime_generation} IS NULL
          AND ${table.recreate_bootstrap_container_id} IS NULL
          AND ${table.recreate_bootstrap_started_at} IS NULL
        ) OR (
          ${table.recreate_bootstrap_operation_id} IS NOT NULL
          AND ${table.recreate_bootstrap_runtime_generation} IS NOT NULL
          AND ${table.recreate_bootstrap_runtime_generation} > 0
          AND ${table.recreate_bootstrap_runtime_generation} = ${table.runtime_generation}
          AND ${table.recreate_bootstrap_container_id} IS NOT NULL
          AND lower(trim(${table.recreate_bootstrap_container_id})) ~ '^[0-9a-f]{12,64}$'
          AND ${table.container_id} IS NOT NULL
          AND lower(trim(${table.recreate_bootstrap_container_id})) = lower(trim(${table.container_id}))
          AND ${table.recreate_bootstrap_started_at} IS NOT NULL
        )
      )`
    ),
    check(
      'worker_runtime_recreate_retired_marker_check',
      sql`(
        (
          ${table.recreate_retired_operation_id} IS NULL
          AND ${table.recreate_retired_runtime_generation} IS NULL
          AND ${table.recreate_retired_container_id} IS NULL
          AND ${table.recreate_retired_at} IS NULL
        ) OR (
          ${table.recreate_retired_operation_id} IS NOT NULL
          AND ${table.recreate_retired_runtime_generation} IS NOT NULL
          AND ${table.recreate_retired_runtime_generation} > 0
          AND ${table.recreate_retired_runtime_generation} = ${table.runtime_generation}
          AND ${table.recreate_retired_container_id} IS NOT NULL
          AND lower(trim(${table.recreate_retired_container_id})) ~ '^[0-9a-f]{12,64}$'
          AND ${table.container_id} IS NOT NULL
          AND lower(trim(${table.recreate_retired_container_id})) = lower(trim(${table.container_id}))
          AND ${table.recreate_retired_at} IS NOT NULL
          AND ${table.runtime_capability_hash} IS NULL
          AND ${table.session_writer_epoch} IS NULL
          AND ${table.connection_epoch} IS NULL
          AND ${table.connection_sequence} = 0
          AND ${table.source_provider} IS NULL
          AND ${table.connection_activated_at} IS NULL
          AND ${table.recreate_bootstrap_operation_id} IS NULL
          AND ${table.recreate_bootstrap_runtime_generation} IS NULL
          AND ${table.recreate_bootstrap_container_id} IS NULL
          AND ${table.recreate_bootstrap_started_at} IS NULL
          AND ${table.native_connection_status} IS NULL
          AND ${table.native_connection_public_status} IS NULL
          AND ${table.native_connection_status_source_id} IS NULL
          AND ${table.native_connection_status_sequence} IS NULL
          AND ${table.native_connection_status_outbox_id} IS NULL
          AND ${table.native_connection_status_lease_owner_id} IS NULL
          AND ${table.native_connection_status_fencing_token} IS NULL
          AND ${table.native_connection_status_changed_at_high_watermark} IS NULL
          AND cardinality(${table.native_connection_status_retired_source_ids}) = 0
          AND ${table.native_connection_online_acknowledged} IS FALSE
        )
      )`
    ),
    check(
      'worker_runtime_native_connection_projection_check',
      sql`COALESCE(((
        ${table.native_connection_status} IS NULL
        AND ${table.native_connection_public_status} IS NULL
        AND ${table.native_connection_status_source_id} IS NULL
        AND ${table.native_connection_status_sequence} IS NULL
        AND ${table.native_connection_status_outbox_id} IS NULL
        AND ${table.native_connection_status_lease_owner_id} IS NULL
        AND ${table.native_connection_status_fencing_token} IS NULL
        AND ${table.native_connection_status_changed_at_high_watermark} IS NULL
        AND cardinality(${table.native_connection_status_retired_source_ids}) = 0
        AND NOT ${table.native_connection_online_acknowledged}
      ) OR (
        jsonb_typeof(${table.native_connection_status}) = 'object'
        AND jsonb_typeof(${table.native_connection_public_status}) = 'object'
        AND ${table.native_connection_status_source_id} IS NOT NULL
        AND ${table.native_connection_status_sequence} BETWEEN 1 AND 9007199254740991
        AND ${table.native_connection_status_outbox_id} > 0
        AND (
          (${table.native_connection_status_lease_owner_id} IS NULL
            AND ${table.native_connection_status_fencing_token} IS NULL)
          OR
          (${table.native_connection_status_lease_owner_id} IS NOT NULL
            AND ${table.native_connection_status_fencing_token} > 0)
        )
        AND ${table.native_connection_status_changed_at_high_watermark} IS NOT NULL
        AND ${table.native_connection_public_status} ->> 'provider' = ${table.source_provider}
        AND ${table.native_connection_public_status} ->> 'sequence' = ${table.native_connection_status_sequence}::text
        AND jsonb_typeof(${table.native_connection_public_status} -> 'status') = 'string'
        AND jsonb_typeof(${table.native_connection_public_status} -> 'connected') = 'boolean'
        AND jsonb_typeof(${table.native_connection_public_status} -> 'authenticated') = 'boolean'
        AND jsonb_typeof(${table.native_connection_public_status} -> 'sessionValid') IN ('boolean', 'null')
        AND jsonb_typeof(${table.native_connection_public_status} -> 'recoverable') = 'boolean'
        AND jsonb_typeof(${table.native_connection_public_status} -> 'qrAvailable') = 'boolean'
        AND ${table.native_connection_public_status} ->> 'changedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?Z$'
        AND array_position(${table.native_connection_status_retired_source_ids}, NULL) IS NULL
        AND NOT (${table.native_connection_status_source_id} = ANY(${table.native_connection_status_retired_source_ids}))
      )), false)`
    ),
    check(
      'worker_runtime_native_connection_ack_check',
      sql`COALESCE((NOT ${table.native_connection_online_acknowledged} OR (
        jsonb_typeof(${table.native_connection_status} -> 'provider') = 'string'
        AND ${table.native_connection_status} ->> 'provider' = ${table.source_provider}
        AND ${table.native_connection_status} ->> 'status' = 'online'
        AND ${table.native_connection_status} -> 'connected' = 'true'::jsonb
        AND ${table.native_connection_status} -> 'authenticated' = 'true'::jsonb
        AND ${table.native_connection_status} -> 'sessionValid' = 'true'::jsonb
        AND jsonb_typeof(${table.native_connection_status} -> 'recoverable') = 'boolean'
        AND ${table.native_connection_status} -> 'qrAvailable' = 'false'::jsonb
        AND jsonb_typeof(${table.native_connection_status} -> 'sequence') = 'number'
        AND ${table.native_connection_status} ->> 'sequence' = ${table.native_connection_status_sequence}::text
        AND jsonb_typeof(${table.native_connection_status} -> 'changedAt') = 'string'
        AND ${table.native_connection_status} ->> 'changedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,9})?Z$'
        AND (
          (${table.session_storage} = 'legacy_volume'
            AND ${table.native_connection_status_lease_owner_id} IS NULL
            AND ${table.native_connection_status_fencing_token} IS NULL)
          OR
          (${table.session_storage} = 'postgres'
            AND ${table.native_connection_status_lease_owner_id} IS NOT NULL
            AND ${table.native_connection_status_fencing_token} > 0)
        )
      )), false)`
    ),
    check(
      'worker_runtime_generation_positive_check',
      sql`${table.runtime_generation} > 0`
    ),
    check(
      'worker_runtime_session_backend_check',
      sql`(
        ${table.session_storage} = 'legacy_volume'
        AND ${table.session_volume_name} IS NOT NULL
      ) OR (
        ${table.session_storage} = 'postgres'
        AND ${table.session_volume_name} IS NULL
      )`
    ),
    check(
      'worker_runtime_capability_hash_check',
      sql`${table.runtime_capability_hash} IS NULL OR ${table.runtime_capability_hash} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      'worker_runtime_writer_identity_pair_check',
      sql`(
        ${table.runtime_capability_hash} IS NULL
        AND ${table.session_writer_epoch} IS NULL
      ) OR (
        ${table.runtime_capability_hash} IS NOT NULL
        AND ${table.session_writer_epoch} IS NOT NULL
      )`
    ),
  ]
);

export const workerRuntimeRelations = relations(workerRuntime, ({ one }) => ({
  wkr: one(worker, {
    fields: [workerRuntime.worker_id],
    references: [worker.worker_id],
  }),
  wwp: one(workerWarmPool, {
    fields: [workerRuntime.warm_pool_id],
    references: [workerWarmPool.warm_pool_id],
  }),
}));
