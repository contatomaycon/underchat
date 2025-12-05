import { pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { worker } from '@core/models';

export const notifications = pgTable('notifications', {
  notification_id: uuid().primaryKey().notNull(),
  two_factor_notification: uuid()
    .references(() => worker.worker_id)
    .notNull(),
  plan_notification: uuid()
    .references(() => worker.worker_id)
    .notNull(),
  plan_expiration_reminder: uuid()
    .references(() => worker.worker_id)
    .notNull(),
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
  ntw: one(worker, {
    fields: [notifications.two_factor_notification],
    references: [worker.worker_id],
  }),
  npw: one(worker, {
    fields: [notifications.plan_notification],
    references: [worker.worker_id],
  }),
  new: one(worker, {
    fields: [notifications.plan_expiration_reminder],
    references: [worker.worker_id],
  }),
}));
