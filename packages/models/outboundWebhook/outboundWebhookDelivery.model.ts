import { relations, sql } from 'drizzle-orm';
import {
  AnyPgColumn,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { user } from '@core/models';
import { outboundWebhook } from './outboundWebhook.model';
import { outboundWebhookEvent } from './outboundWebhookEvent.model';
import { outboundWebhookDeliveryAttempt } from './outboundWebhookDeliveryAttempt.model';

export type OutboundWebhookDeliveryStatus =
  'pending' | 'leased' | 'retrying' | 'succeeded' | 'dead' | 'suppressed';

export const outboundWebhookDelivery = pgTable(
  'outbound_webhook_delivery',
  {
    outbound_webhook_delivery_id: uuid().primaryKey().notNull(),
    outbound_webhook_id: uuid()
      .references(() => outboundWebhook.outbound_webhook_id, {
        onDelete: 'cascade',
      })
      .notNull(),
    outbound_webhook_event_id: uuid()
      .references(() => outboundWebhookEvent.outbound_webhook_event_id, {
        onDelete: 'cascade',
      })
      .notNull(),
    config_version: integer().notNull(),
    status: varchar({ length: 20 })
      .$type<OutboundWebhookDeliveryStatus>()
      .notNull()
      .default('pending'),
    attempt_count: integer().notNull().default(0),
    next_attempt_at: timestamp({ mode: 'string', withTimezone: true })
      .defaultNow()
      .notNull(),
    lease_token: uuid(),
    lease_expires_at: timestamp({ mode: 'string', withTimezone: true }),
    delivered_at: timestamp({ mode: 'string', withTimezone: true }),
    dead_at: timestamp({ mode: 'string', withTimezone: true }),
    suppressed_at: timestamp({ mode: 'string', withTimezone: true }),
    last_error: text(),
    redelivery_of_delivery_id: uuid().references(
      (): AnyPgColumn => outboundWebhookDelivery.outbound_webhook_delivery_id,
      { onDelete: 'set null' }
    ),
    requested_by_user_id: uuid().references(() => user.user_id, {
      onDelete: 'set null',
    }),
    created_at: timestamp({ mode: 'string', withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp({ mode: 'string', withTimezone: true })
      .defaultNow()
      .notNull(),
    expires_at: timestamp({ mode: 'string', withTimezone: true })
      .default(sql`NOW() + INTERVAL '30 days'`)
      .notNull(),
  },
  (table) => [
    index('outbound_webhook_delivery_webhook_created_idx').on(
      table.outbound_webhook_id,
      table.created_at.desc(),
      table.outbound_webhook_delivery_id.desc()
    ),
    index('outbound_webhook_delivery_event_id_idx').on(
      table.outbound_webhook_event_id
    ),
    index('outbound_webhook_delivery_claim_idx')
      .on(table.next_attempt_at, table.created_at)
      .where(sql`${table.status} IN ('pending', 'retrying')`),
    index('outbound_webhook_delivery_lease_expires_idx')
      .on(table.lease_expires_at)
      .where(sql`${table.status} = 'leased'`),
    index('outbound_webhook_delivery_verification_idx')
      .on(
        table.outbound_webhook_id,
        table.config_version,
        table.delivered_at.desc()
      )
      .where(sql`${table.status} = 'succeeded'`),
    index('outbound_webhook_delivery_redelivery_of_idx').on(
      table.redelivery_of_delivery_id
    ),
    index('outbound_webhook_delivery_requested_by_user_idx').on(
      table.requested_by_user_id
    ),
    index('outbound_webhook_delivery_expires_at_idx').on(table.expires_at),
    uniqueIndex('outbound_webhook_delivery_initial_uidx')
      .on(table.outbound_webhook_id, table.outbound_webhook_event_id)
      .where(sql`${table.redelivery_of_delivery_id} IS NULL`),
    check(
      'outbound_webhook_delivery_status_check',
      sql`${table.status} IN ('pending', 'leased', 'retrying', 'succeeded', 'dead', 'suppressed')`
    ),
    check(
      'outbound_webhook_delivery_attempt_count_check',
      sql`${table.attempt_count} >= 0`
    ),
    check(
      'outbound_webhook_delivery_config_version_check',
      sql`${table.config_version} > 0`
    ),
  ]
);

export const outboundWebhookDeliveryRelations = relations(
  outboundWebhookDelivery,
  ({ one, many }) => ({
    webhook: one(outboundWebhook, {
      fields: [outboundWebhookDelivery.outbound_webhook_id],
      references: [outboundWebhook.outbound_webhook_id],
    }),
    event: one(outboundWebhookEvent, {
      fields: [outboundWebhookDelivery.outbound_webhook_event_id],
      references: [outboundWebhookEvent.outbound_webhook_event_id],
    }),
    redeliveryOf: one(outboundWebhookDelivery, {
      fields: [outboundWebhookDelivery.redelivery_of_delivery_id],
      references: [outboundWebhookDelivery.outbound_webhook_delivery_id],
      relationName: 'outboundWebhookRedeliveries',
    }),
    redeliveries: many(outboundWebhookDelivery, {
      relationName: 'outboundWebhookRedeliveries',
    }),
    requestedBy: one(user, {
      fields: [outboundWebhookDelivery.requested_by_user_id],
      references: [user.user_id],
    }),
    attempts: many(outboundWebhookDeliveryAttempt),
  })
);
