import {
  pgTable,
  timestamp,
  uuid,
  boolean,
  varchar,
  integer,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { worker, chatbot } from '@core/models';

export const workerConfig = pgTable('worker_config', {
  worker_config_id: uuid().primaryKey().notNull(),
  worker_id: uuid()
    .references(() => worker.worker_id)
    .notNull(),
  is_automatic_attendance: boolean().default(false),
  show_attendee_name: boolean().default(false),
  show_worker_name: boolean().default(false),
  allow_attendance_only_online: boolean().default(false),
  simultaneous_attendance: integer(),
  generate_protocol_at_start: varchar({ length: 2000 }),
  generate_protocol_at_transfer: varchar({ length: 2000 }),
  show_message_on_call: varchar({ length: 2000 }),
  send_message_on_finish_attendance: varchar({ length: 2000 }),
  reject_call: boolean().default(false),
  auto_save_contacts: boolean().default(false),
  chatbot_id: uuid().references(() => chatbot.chatbot_id),
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
}));
