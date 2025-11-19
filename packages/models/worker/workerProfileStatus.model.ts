import {
  boolean,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { worker, workerConfig, workerProfileStatusType } from '@core/models';

export const workerProfileStatus = pgTable('worker_profile_status', {
  worker_profile_status_id: uuid().primaryKey().notNull(),
  worker_id: uuid()
    .references(() => worker.worker_id)
    .notNull(),
  worker_profile_status_type_id: uuid()
    .references(() => workerProfileStatusType.worker_profile_status_type_id)
    .notNull(),
  value: varchar({ length: 500 }).notNull(),
  is_permanent: boolean().default(false),
  external_id: varchar({ length: 500 }),
  created_at: timestamp('created_at', {
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
  updated_at: timestamp('updated_at', {
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
});

export const workerProfileStatusRelations = relations(
  workerProfileStatus,
  ({ many, one }) => ({
    wpw: one(worker, {
      fields: [workerProfileStatus.worker_id],
      references: [worker.worker_id],
    }),
    wpst: one(workerProfileStatusType, {
      fields: [workerProfileStatus.worker_profile_status_type_id],
      references: [workerProfileStatusType.worker_profile_status_type_id],
    }),
    wps: many(workerConfig),
  })
);
