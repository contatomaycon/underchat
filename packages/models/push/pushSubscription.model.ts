import {
  pgTable,
  timestamp,
  uuid,
  text,
  varchar,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { user } from '@core/models';

export const pushSubscription = pgTable(
  'push_subscription',
  {
    push_subscription_id: uuid().primaryKey().notNull(),
    user_id: uuid()
      .references(() => user.user_id)
      .notNull(),
    provider: varchar({ length: 20 }).default('webpush').notNull(),
    platform: varchar({ length: 20 }),
    endpoint: text().notNull(),
    p256dh: text(),
    auth: text(),
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
  },
  (table) => [
    index('push_subscription_user_id_idx').on(table.user_id),
    index('push_subscription_deleted_at_idx').on(table.deleted_at),
    index('push_subscription_user_id_deleted_at_idx').on(
      table.user_id,
      table.deleted_at
    ),
  ]
);

export const pushSubscriptionRelations = relations(
  pushSubscription,
  ({ one }) => ({
    usr: one(user, {
      fields: [pushSubscription.user_id],
      references: [user.user_id],
    }),
  })
);
