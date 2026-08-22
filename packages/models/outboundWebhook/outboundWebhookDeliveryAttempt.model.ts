import { relations, sql } from 'drizzle-orm';
import {
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
import { outboundWebhookDelivery } from './outboundWebhookDelivery.model';

export type OutboundWebhookDeliveryAttemptOutcome =
  | 'succeeded'
  | 'http_error'
  | 'network_error'
  | 'timeout'
  | 'internal_error'
  | 'suppressed';

export const outboundWebhookDeliveryAttempt = pgTable(
  'outbound_webhook_delivery_attempt',
  {
    outbound_webhook_delivery_attempt_id: uuid().primaryKey().notNull(),
    outbound_webhook_delivery_id: uuid()
      .references(() => outboundWebhookDelivery.outbound_webhook_delivery_id, {
        onDelete: 'cascade',
      })
      .notNull(),
    attempt_number: integer().notNull(),
    started_at: timestamp({ mode: 'string', withTimezone: true }).notNull(),
    finished_at: timestamp({ mode: 'string', withTimezone: true }),
    outcome: varchar({
      length: 30,
    }).$type<OutboundWebhookDeliveryAttemptOutcome>(),
    http_status: integer(),
    error_code: varchar({ length: 100 }),
    error_message: text(),
    response_body: text(),
    duration_ms: integer(),
    retry_after_ms: integer(),
    created_at: timestamp({ mode: 'string', withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp({ mode: 'string', withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('outbound_webhook_delivery_attempt_number_uidx').on(
      table.outbound_webhook_delivery_id,
      table.attempt_number
    ),
    index('outbound_webhook_delivery_attempt_delivery_created_idx').on(
      table.outbound_webhook_delivery_id,
      table.created_at
    ),
    index('outbound_webhook_delivery_attempt_created_at_idx').on(
      table.created_at
    ),
    check(
      'outbound_webhook_delivery_attempt_number_check',
      sql`${table.attempt_number} > 0`
    ),
    check(
      'outbound_webhook_delivery_attempt_outcome_check',
      sql`${table.outcome} IS NULL OR ${table.outcome} IN ('succeeded', 'http_error', 'network_error', 'timeout', 'internal_error', 'suppressed')`
    ),
    check(
      'outbound_webhook_delivery_attempt_http_status_check',
      sql`${table.http_status} IS NULL OR ${table.http_status} BETWEEN 100 AND 599`
    ),
    check(
      'outbound_webhook_delivery_attempt_duration_check',
      sql`${table.duration_ms} IS NULL OR ${table.duration_ms} >= 0`
    ),
    check(
      'outbound_webhook_delivery_attempt_retry_after_check',
      sql`${table.retry_after_ms} IS NULL OR ${table.retry_after_ms} >= 0`
    ),
  ]
);

export const outboundWebhookDeliveryAttemptRelations = relations(
  outboundWebhookDeliveryAttempt,
  ({ one }) => ({
    delivery: one(outboundWebhookDelivery, {
      fields: [outboundWebhookDeliveryAttempt.outbound_webhook_delivery_id],
      references: [outboundWebhookDelivery.outbound_webhook_delivery_id],
    }),
  })
);
