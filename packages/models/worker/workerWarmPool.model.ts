import {
  check,
  index,
  integer,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { server, worker, workerType } from '@core/models';
import { EWorkerWarmPoolState } from '@core/common/enums/EWorkerWarmPoolState';
import { relations, sql } from 'drizzle-orm';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';

export const workerWarmPool = pgTable(
  'worker_warm_pool',
  {
    warm_pool_id: uuid().primaryKey().notNull(),
    server_id: uuid()
      .references(() => server.server_id)
      .notNull(),
    worker_type_id: uuid()
      .references(() => workerType.worker_type_id)
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
    state: varchar({ length: 20 })
      .$type<EWorkerWarmPoolState>()
      .notNull()
      .default(EWorkerWarmPoolState.warming),
    reserved_by_worker_id: uuid().references(() => worker.worker_id),
    reservation_expires_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }),
    last_health_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }),
    last_error: varchar({ length: 1000 }),
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
    index('worker_warm_pool_server_type_state_idx').on(
      table.server_id,
      table.worker_type_id,
      table.state
    ),
    index('worker_warm_pool_reserved_by_worker_id_idx').on(
      table.reserved_by_worker_id
    ),
    index('worker_warm_pool_reservation_expires_at_idx').on(
      table.reservation_expires_at
    ),
    index('worker_warm_pool_container_id_idx').on(table.container_id),
    index('worker_warm_pool_container_name_idx').on(table.container_name),
    index('worker_warm_pool_session_storage_idx').on(table.session_storage),
    check(
      'worker_warm_pool_runtime_generation_positive_check',
      sql`${table.runtime_generation} > 0`
    ),
    check(
      'worker_warm_pool_session_backend_check',
      sql`(
        ${table.session_storage} = 'legacy_volume'
        AND ${table.session_volume_name} IS NOT NULL
      ) OR (
        ${table.session_storage} = 'postgres'
        AND ${table.session_volume_name} IS NULL
      )`
    ),
    check(
      'worker_warm_pool_capability_hash_check',
      sql`${table.runtime_capability_hash} IS NULL OR ${table.runtime_capability_hash} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      'worker_warm_pool_writer_identity_pair_check',
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

export const workerWarmPoolRelations = relations(workerWarmPool, ({ one }) => ({
  wsr: one(server, {
    fields: [workerWarmPool.server_id],
    references: [server.server_id],
  }),
  wwt: one(workerType, {
    fields: [workerWarmPool.worker_type_id],
    references: [workerType.worker_type_id],
  }),
  reservedWorker: one(worker, {
    fields: [workerWarmPool.reserved_by_worker_id],
    references: [worker.worker_id],
  }),
}));
