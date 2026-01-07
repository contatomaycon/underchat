import { pgTable, timestamp, uuid, varchar, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { workerProfileStatus } from '@core/models';

export const workerProfileStatusType = pgTable(
  'worker_profile_status_type',
  {
    worker_profile_status_type_id: uuid().primaryKey().notNull(),
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
  (table) => [index('worker_profile_status_type_type_idx').on(table.type)]
);

export const workerProfileStatusTypeRelations = relations(
  workerProfileStatusType,
  ({ many }) => ({
    wpsts: many(workerProfileStatus),
  })
);
