import { pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import {
  worker,
  chatbot,
  workerConfigStatus,
  workerConfigType,
} from '@core/models';

export const workerConfig = pgTable('worker_config', {
  worker_config_id: uuid().primaryKey().notNull(),
  worker_id: uuid()
    .references(() => worker.worker_id)
    .notNull(),
  worker_config_status_id: uuid()
    .references(() => workerConfigStatus.worker_config_status_id)
    .notNull(),
  worker_config_type_id: uuid()
    .references(() => workerConfigType.worker_config_type_id)
    .notNull(),
  chatbot_id: uuid().references(() => chatbot.chatbot_id),
  value: varchar({ length: 2000 }),
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
  chatbot: one(chatbot, {
    fields: [workerConfig.chatbot_id],
    references: [chatbot.chatbot_id],
  }),
  wcs: one(workerConfigStatus, {
    fields: [workerConfig.worker_config_status_id],
    references: [workerConfigStatus.worker_config_status_id],
  }),
  wct: one(workerConfigType, {
    fields: [workerConfig.worker_config_type_id],
    references: [workerConfigType.worker_config_type_id],
  }),
}));
