import { pgTable, timestamp, uuid, text, varchar } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { user } from '@core/models';

export const pushSubscription = pgTable('push_subscription', {
  push_subscription_id: uuid().primaryKey().notNull(),
  user_id: uuid()
    .references(() => user.user_id)
    .notNull(),
  endpoint: text().notNull(),
  p256dh: text().notNull(),
  auth: text().notNull(),
  user_agent: varchar({ length: 500 }),
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

export const pushSubscriptionRelations = relations(
  pushSubscription,
  ({ one }) => ({
    usr: one(user, {
      fields: [pushSubscription.user_id],
      references: [user.user_id],
    }),
  })
);
