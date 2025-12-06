import { pgTable, timestamp, uuid, text } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { worker } from '@core/models';
import { notificationType } from './notificationType.model';

export const notifications = pgTable('notifications', {
  notification_id: uuid().primaryKey().notNull(),
  worker_id: uuid().references(() => worker.worker_id),
  notification_type_id: uuid()
    .references(() => notificationType.notification_type_id)
    .notNull(),
  message_whatsapp: text(),
  message_email: text(),
  created_at: timestamp({
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
  updated_at: timestamp({
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
  deleted_at: timestamp({ mode: 'string', withTimezone: true }),
});

export const notificationsRelations = relations(notifications, ({ one }) => ({
  nnt: one(notificationType, {
    fields: [notifications.notification_type_id],
    references: [notificationType.notification_type_id],
  }),
  nwr: one(worker, {
    fields: [notifications.worker_id],
    references: [worker.worker_id],
  }),
}));
