import { relations, sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { account } from '@core/models';
import { worker } from '../worker/worker.model';
import { outboundWebhookSubscription } from './outboundWebhookSubscription.model';
import { outboundWebhookDelivery } from './outboundWebhookDelivery.model';

export type OutboundWebhookStatus = 'inactive' | 'active' | 'suspended';

export const outboundWebhook = pgTable(
  'outbound_webhook',
  {
    outbound_webhook_id: uuid().primaryKey().notNull(),
    account_id: uuid()
      .references(() => account.account_id, { onDelete: 'cascade' })
      .notNull(),
    channel_id: uuid().notNull(),
    name: varchar({ length: 200 }).notNull(),
    url: varchar({ length: 2048 }).notNull(),
    secret_hash: varchar({ length: 64 }).notNull(),
    secret_encrypted: varchar({ length: 512 }).notNull(),
    secret_preview: varchar({ length: 32 }).notNull(),
    status: varchar({ length: 20 })
      .$type<OutboundWebhookStatus>()
      .notNull()
      .default('inactive'),
    config_version: integer().notNull().default(1),
    consecutive_dead_deliveries: integer().notNull().default(0),
    suspended_at: timestamp({ mode: 'string', withTimezone: true }),
    suspension_reason: text(),
    created_at: timestamp({ mode: 'string', withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp({ mode: 'string', withTimezone: true })
      .defaultNow()
      .notNull(),
    deleted_at: timestamp({ mode: 'string', withTimezone: true }),
  },
  (table) => [
    uniqueIndex('outbound_webhook_secret_hash_uidx').on(table.secret_hash),
    index('outbound_webhook_account_id_idx').on(table.account_id),
    index('outbound_webhook_account_channel_idx').on(
      table.account_id,
      table.channel_id
    ),
    index('outbound_webhook_account_deleted_created_idx').on(
      table.account_id,
      table.deleted_at,
      table.created_at.desc()
    ),
    index('outbound_webhook_active_account_idx')
      .on(table.account_id, table.updated_at.desc())
      .where(sql`${table.deleted_at} IS NULL AND ${table.status} = 'active'`),
    index('outbound_webhook_active_account_channel_idx')
      .on(table.account_id, table.channel_id)
      .where(sql`${table.deleted_at} IS NULL AND ${table.status} = 'active'`),
    foreignKey({
      name: 'outbound_webhook_account_channel_fkey',
      columns: [table.account_id, table.channel_id],
      foreignColumns: [worker.account_id, worker.worker_id],
    }).onDelete('restrict'),
    check(
      'outbound_webhook_status_check',
      sql`${table.status} IN ('inactive', 'active', 'suspended')`
    ),
    check(
      'outbound_webhook_config_version_check',
      sql`${table.config_version} > 0`
    ),
    check(
      'outbound_webhook_consecutive_dead_deliveries_check',
      sql`${table.consecutive_dead_deliveries} >= 0`
    ),
  ]
);

export const outboundWebhookRelations = relations(
  outboundWebhook,
  ({ one, many }) => ({
    account: one(account, {
      fields: [outboundWebhook.account_id],
      references: [account.account_id],
    }),
    channel: one(worker, {
      fields: [outboundWebhook.account_id, outboundWebhook.channel_id],
      references: [worker.account_id, worker.worker_id],
    }),
    subscriptions: many(outboundWebhookSubscription),
    deliveries: many(outboundWebhookDelivery),
  })
);
