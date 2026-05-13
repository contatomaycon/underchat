import {
  pgTable,
  timestamp,
  uuid,
  text,
  index,
  boolean,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { worker } from '@core/models';
import { notificationType } from './notificationType.model';

export const notifications = pgTable(
  'notifications',
  {
    notification_id: uuid().primaryKey().notNull(),
    worker_id: uuid().references(() => worker.worker_id),
    notification_type_id: uuid()
      .references(() => notificationType.notification_type_id)
      .notNull(),
    message_whatsapp: text(),
    whatsapp_enabled: boolean().notNull().default(false),
    email_subject: text(),
    message_email: text(),
    email_enabled: boolean().notNull().default(false),
    created_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    updated_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    deleted_at: timestamp({ mode: 'string', withTimezone: true }),
  },
  (table) => [
    index('notifications_worker_id_idx').on(table.worker_id),
    index('notifications_notification_type_id_idx').on(
      table.notification_type_id
    ),
    index('notifications_deleted_at_idx').on(table.deleted_at),
    index('notifications_notification_type_id_deleted_at_idx').on(
      table.notification_type_id,
      table.deleted_at
    ),
    index('notifications_worker_id_deleted_at_idx').on(
      table.worker_id,
      table.deleted_at
    ),
  ]
);

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
