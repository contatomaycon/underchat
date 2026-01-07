import { pgTable, timestamp, uuid, varchar, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { worker } from '@core/models';

export const workerProfileInfo = pgTable(
  'worker_profile_info',
  {
    worker_profile_info_id: uuid().primaryKey().notNull(),
    worker_id: uuid()
      .references(() => worker.worker_id)
      .notNull(),
    name: varchar({ length: 100 }),
    message: varchar({ length: 500 }),
    photo: varchar({ length: 500 }),
    created_at: timestamp('created_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    updated_at: timestamp('updated_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
  },
  (table) => [index('worker_profile_info_worker_id_idx').on(table.worker_id)]
);

export const workerProfileInfoRelations = relations(
  workerProfileInfo,
  ({ one }) => ({
    wpw: one(worker, {
      fields: [workerProfileInfo.worker_id],
      references: [worker.worker_id],
    }),
  })
);
