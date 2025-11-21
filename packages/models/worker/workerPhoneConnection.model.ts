import {
  pgTable,
  timestamp,
  uuid,
  varchar,
  integer,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { worker } from '@core/models';

export const workerPhoneConnection = pgTable('worker_phone_connection', {
  worker_phone_connection_id: uuid().primaryKey().notNull(),
  worker_id: uuid()
    .references(() => worker.worker_id)
    .notNull(),
  number: varchar({ length: 20 }),
  attempt: integer().notNull().default(0),
  date_attempt: timestamp({ mode: 'string', withTimezone: true }).defaultNow(),
  created_at: timestamp('created_at', {
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
  updated_at: timestamp('updated_at', {
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
});

export const workerPhoneConnectionRelations = relations(
  workerPhoneConnection,
  ({ one }) => ({
    wwr: one(worker, {
      fields: [workerPhoneConnection.worker_id],
      references: [worker.worker_id],
    }),
  })
);
