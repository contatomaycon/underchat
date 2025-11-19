import { pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { workerConfig } from '@core/models';

export const workerConfigStatus = pgTable('worker_config_status', {
  worker_config_status_id: uuid().primaryKey().notNull(),
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

export const workerConfigStatusRelations = relations(
  workerConfigStatus,
  ({ many }) => ({
    wcss: many(workerConfig),
  })
);
