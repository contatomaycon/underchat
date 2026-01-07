import { pgTable, timestamp, uuid, varchar, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { worker } from '@core/models';

export const workerStatus = pgTable(
  'worker_status',
  {
    worker_status_id: uuid().primaryKey().notNull(),
    status: varchar({ length: 500 }),
    created_at: timestamp('created_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    updated_at: timestamp('updated_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
  },
  (table) => [index('worker_status_status_idx').on(table.status)]
);

export const workerStatusRelations = relations(workerStatus, ({ many }) => ({
  wss: many(worker),
}));
