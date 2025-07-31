import { pgTable, timestamp, varchar, uuid } from 'drizzle-orm/pg-core';
import { account, workerStatus, workerType, server } from '@core/models';
import { relations } from 'drizzle-orm';

export const worker = pgTable('worker', {
  worker_id: uuid().primaryKey().notNull(),
  worker_status_id: uuid()
    .references(() => workerStatus.worker_status_id)
    .notNull(),
  worker_type_id: uuid()
    .references(() => workerType.worker_type_id)
    .notNull(),
  server_id: uuid()
    .references(() => server.server_id)
    .notNull(),
  account_id: uuid()
    .references(() => account.account_id)
    .notNull(),
  name: varchar({ length: 50 }).notNull(),
  number: varchar({ length: 20 }),
  container_id: varchar({ length: 100 }).notNull(),
  connection_date: timestamp({
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
});

export const workerRelations = relations(worker, ({ one }) => ({
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
}));
