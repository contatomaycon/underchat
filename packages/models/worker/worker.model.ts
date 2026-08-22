import {
  pgTable,
  timestamp,
  varchar,
  uuid,
  check,
  index,
  integer,
  bigint,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  account,
  workerStatus,
  workerType,
  server,
  workerPhoneConnection,
  workerConfig,
  notifications,
  schedule,
  apiKey,
  userChannel,
} from '@core/models';
import { relations, sql } from 'drizzle-orm';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';

export const worker = pgTable(
  'worker',
  {
    worker_id: uuid().primaryKey().notNull(),
    worker_status_id: uuid()
      .references(() => workerStatus.worker_status_id)
      .notNull(),
    worker_type_id: uuid()
      .references(() => workerType.worker_type_id)
      .notNull(),
    server_id: uuid().references(() => server.server_id),
    account_id: uuid()
      .references(() => account.account_id)
      .notNull(),
    name: varchar({ length: 50 }).notNull(),
    session_storage: varchar({ length: 20 })
      .$type<EWorkerSessionStorage>()
      .notNull()
      .default(EWorkerSessionStorage.postgres),
    number: varchar({ length: 20 }),
    container_id: varchar({ length: 100 }),
    lifecycle_operation_id: uuid(),
    external_connection_revision: bigint({ mode: 'number' })
      .notNull()
      .default(1),
    recreate_completed_operation_id: uuid(),
    recreate_completed_runtime_generation: integer(),
    recreate_completed_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }),
    connection_date: timestamp({
      mode: 'string',
      withTimezone: true,
    }),
    last_connection_check_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }),
    recreate_available_at: timestamp({
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
    deleted_at: timestamp({ mode: 'string', withTimezone: true }),
  },
  (table) => [
    index('worker_worker_status_id_idx').on(table.worker_status_id),
    index('worker_worker_type_id_idx').on(table.worker_type_id),
    index('worker_server_id_idx').on(table.server_id),
    index('worker_lifecycle_operation_id_idx').on(table.lifecycle_operation_id),
    index('worker_account_id_idx').on(table.account_id),
    index('worker_session_storage_idx').on(table.session_storage),
    check(
      'worker_session_storage_check',
      sql`${table.session_storage} IN ('legacy_volume', 'postgres')`
    ),
    check(
      'worker_external_connection_revision_check',
      sql`${table.external_connection_revision} > 0`
    ),
    check(
      'worker_recreate_completed_marker_check',
      sql`(
        (
          ${table.recreate_completed_operation_id} IS NULL
          AND ${table.recreate_completed_runtime_generation} IS NULL
          AND ${table.recreate_completed_at} IS NULL
        ) OR (
          ${table.recreate_completed_operation_id} IS NOT NULL
          AND ${table.recreate_completed_runtime_generation} IS NOT NULL
          AND ${table.recreate_completed_runtime_generation} > 0
          AND ${table.recreate_completed_at} IS NOT NULL
        )
      )`
    ),
    uniqueIndex('worker_account_worker_uidx').on(
      table.account_id,
      table.worker_id
    ),
    index('worker_deleted_at_idx').on(table.deleted_at),
    index('worker_account_id_deleted_at_idx').on(
      table.account_id,
      table.deleted_at
    ),
    index('worker_account_id_deleted_at_created_at_idx').on(
      table.account_id,
      table.deleted_at,
      table.created_at
    ),
  ]
);

export const workerRelations = relations(worker, ({ one, many }) => ({
  wws: one(workerStatus, {
    fields: [worker.worker_status_id],
    references: [workerStatus.worker_status_id],
  }),
  wwt: one(workerType, {
    fields: [worker.worker_type_id],
    references: [workerType.worker_type_id],
  }),
  wsr: one(server, {
    fields: [worker.server_id],
    references: [server.server_id],
  }),
  wac: one(account, {
    fields: [worker.account_id],
    references: [account.account_id],
  }),
  wwp: many(workerPhoneConnection),
  wwc: many(workerConfig),
  wwn: many(notifications),
  wsc: many(schedule),
  wak: many(apiKey),
  uch: many(userChannel),
}));
