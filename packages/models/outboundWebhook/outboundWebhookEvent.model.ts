import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { account } from '@core/models';
import { outboundWebhookDelivery } from './outboundWebhookDelivery.model';
import type { OutboundWebhookEnvelope } from '@core/common/functions/outboundWebhookPayload';
import { OUTBOUND_WEBHOOK_MAX_ENDPOINTS_PER_ACCOUNT } from '@core/common/constants/outboundWebhookEvents';

export type OutboundWebhookEventState =
  'preparing' | 'ready' | 'discarded' | 'cancelled' | 'quarantined';

export interface OutboundWebhookTargetSnapshot {
  webhook_id: string;
  channel_id: string;
  config_version: number;
}

export const outboundWebhookEvent = pgTable(
  'outbound_webhook_event',
  {
    outbound_webhook_event_id: uuid().primaryKey().notNull(),
    account_id: uuid()
      .references(() => account.account_id, { onDelete: 'cascade' })
      .notNull(),
    event_type: varchar({ length: 100 }).notNull(),
    state: varchar({ length: 20 })
      .$type<OutboundWebhookEventState>()
      .notNull()
      .default('preparing'),
    aggregate_type: varchar({ length: 32 }).notNull(),
    aggregate_id: varchar({ length: 255 }).notNull(),
    routing_channel_ids: uuid().array().notNull(),
    payload: jsonb().$type<OutboundWebhookEnvelope>().notNull(),
    target_snapshot: jsonb().$type<OutboundWebhookTargetSnapshot[]>().notNull(),
    idempotency_key: varchar({ length: 255 }).notNull(),
    is_test: boolean().notNull().default(false),
    source: varchar({ length: 64 }),
    integration_entitlement_revision: varchar({ length: 64 }),
    occurred_at: timestamp({ mode: 'string', withTimezone: true }).notNull(),
    domain_applied_at: timestamp({ mode: 'string', withTimezone: true }),
    ready_at: timestamp({ mode: 'string', withTimezone: true }),
    cancelled_at: timestamp({ mode: 'string', withTimezone: true }),
    created_at: timestamp({ mode: 'string', withTimezone: true })
      .defaultNow()
      .notNull(),
    expires_at: timestamp({ mode: 'string', withTimezone: true })
      .default(sql`NOW() + INTERVAL '30 days'`)
      .notNull(),
  },
  (table) => [
    index('outbound_webhook_event_account_created_idx').on(
      table.account_id,
      table.created_at.desc(),
      table.outbound_webhook_event_id.desc()
    ),
    index('outbound_webhook_event_state_created_idx').on(
      table.state,
      table.created_at
    ),
    index('outbound_webhook_event_expires_at_idx').on(table.expires_at),
    uniqueIndex('outbound_webhook_event_idempotency_uidx').on(
      table.account_id,
      table.event_type,
      table.idempotency_key
    ),
    check(
      'outbound_webhook_event_state_check',
      sql`${table.state} IN ('preparing', 'ready', 'discarded', 'cancelled', 'quarantined')`
    ),
    check(
      'outbound_webhook_event_target_snapshot_check',
      sql`jsonb_typeof(${table.target_snapshot}) = 'array'
        AND jsonb_array_length(${table.target_snapshot}) > 0
        AND jsonb_array_length(${table.target_snapshot}) <= ${sql.raw(String(OUTBOUND_WEBHOOK_MAX_ENDPOINTS_PER_ACCOUNT))}
      `
    ),
    check(
      'outbound_webhook_event_routing_channels_check',
      sql`cardinality(${table.routing_channel_ids}) > 0
        AND array_position(${table.routing_channel_ids}, NULL) IS NULL`
    ),
  ]
);

export const outboundWebhookEventRelations = relations(
  outboundWebhookEvent,
  ({ one, many }) => ({
    account: one(account, {
      fields: [outboundWebhookEvent.account_id],
      references: [account.account_id],
    }),
    deliveries: many(outboundWebhookDelivery),
  })
);
