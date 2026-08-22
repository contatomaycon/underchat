import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { outboundWebhook } from './outboundWebhook.model';

export const outboundWebhookSubscription = pgTable(
  'outbound_webhook_subscription',
  {
    outbound_webhook_subscription_id: uuid().primaryKey().notNull(),
    outbound_webhook_id: uuid()
      .references(() => outboundWebhook.outbound_webhook_id, {
        onDelete: 'cascade',
      })
      .notNull(),
    event_type: varchar({ length: 100 }).notNull(),
    active: boolean().notNull().default(true),
    created_at: timestamp({ mode: 'string', withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp({ mode: 'string', withTimezone: true })
      .defaultNow()
      .notNull(),
    deleted_at: timestamp({ mode: 'string', withTimezone: true }),
  },
  (table) => [
    uniqueIndex('outbound_webhook_subscription_webhook_event_uidx').on(
      table.outbound_webhook_id,
      table.event_type
    ),
    index('outbound_webhook_subscription_webhook_id_idx').on(
      table.outbound_webhook_id
    ),
    index('outbound_webhook_subscription_active_event_idx')
      .on(table.event_type, table.outbound_webhook_id)
      .where(sql`${table.active} = TRUE AND ${table.deleted_at} IS NULL`),
  ]
);

export const outboundWebhookSubscriptionRelations = relations(
  outboundWebhookSubscription,
  ({ one }) => ({
    webhook: one(outboundWebhook, {
      fields: [outboundWebhookSubscription.outbound_webhook_id],
      references: [outboundWebhook.outbound_webhook_id],
    }),
  })
);
