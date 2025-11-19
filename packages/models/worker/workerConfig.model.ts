import { pgTable, timestamp, uuid, boolean } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { worker, workerConfigStatus } from '@core/models';

export const workerConfig = pgTable('worker_config', {
  worker_config_id: uuid().primaryKey().notNull(),
  worker_id: uuid()
    .references(() => worker.worker_id)
    .notNull(),
  worker_config_status_id: uuid()
    .references(() => workerConfigStatus.worker_config_status_id)
    .notNull(),
  is_automatic_attendance: boolean().default(false),
  show_attendee_name: boolean().default(false),
  show_worker_name: boolean().default(false),
  generate_protocol_at_ura: boolean().default(false),
  generate_protocol_at_start: boolean().default(false),
  generate_protocol_at_transfer: boolean().default(false),
  created_at: timestamp({
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
  updated_at: timestamp({
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
});

export const workerConfigRelations = relations(workerConfig, ({ one }) => ({
  wcw: one(worker, {
    fields: [workerConfig.worker_id],
    references: [worker.worker_id],
  }),
  wcs: one(workerConfigStatus, {
    fields: [workerConfig.worker_config_status_id],
    references: [workerConfigStatus.worker_config_status_id],
  }),
}));
