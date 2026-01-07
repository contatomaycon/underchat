import { pgTable, timestamp, uuid, varchar, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { worker } from '@core/models';

export const workerType = pgTable(
  'worker_type',
  {
    worker_type_id: uuid().primaryKey().notNull(),
    type: varchar({ length: 500 }),
    created_at: timestamp('created_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    updated_at: timestamp('updated_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
  },
  (table) => [index('worker_type_type_idx').on(table.type)]
);

export const workerTypeRelations = relations(workerType, ({ many }) => ({
  wts: many(worker),
}));
