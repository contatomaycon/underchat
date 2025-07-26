import { pgTable, timestamp, smallint, varchar } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { worker } from '@core/models';

export const workerStatus = pgTable('worker_status', {
  worker_status_id: smallint()
    .primaryKey()
    .generatedByDefaultAsIdentity()
    .notNull(),
  status: varchar({ length: 500 }),
  created_at: timestamp('created_at', {
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
  updated_at: timestamp('updated_at', {
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
});

export const workerStatusRelations = relations(workerStatus, ({ many }) => ({
  wss: many(worker),
}));
