import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { IConfigChannelsRecreateAllFilters } from '@core/common/interfaces/IConfigChannelsRecreateAllPayload';
import { configChannelsRecreateTarget } from './configChannelsRecreateTarget.model';

export type ConfigChannelsRecreateBatchStatus =
  'queued' | 'running' | 'completed';

export const configChannelsRecreateBatch = pgTable(
  'config_channels_recreate_batch',
  {
    config_channels_recreate_batch_id: uuid().primaryKey().notNull(),
    request_id: uuid().notNull(),
    source_topic: varchar({ length: 255 }).notNull(),
    source_partition: integer().notNull(),
    source_offset: bigint({ mode: 'number' }).notNull(),
    account_id: uuid().notNull(),
    filters: jsonb().$type<IConfigChannelsRecreateAllFilters>().notNull(),
    status: varchar({ length: 20 })
      .$type<ConfigChannelsRecreateBatchStatus>()
      .notNull()
      .default('queued'),
    total_count: integer().notNull().default(0),
    success_count: integer().notNull().default(0),
    error_count: integer().notNull().default(0),
    last_error: text(),
    completion_lease_owner: uuid(),
    completion_lease_expires_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }),
    completion_attempt_count: integer().notNull().default(0),
    next_completion_attempt_at: timestamp({
      mode: 'string',
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    completion_published_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }),
    created_at: timestamp({ mode: 'string', withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp({ mode: 'string', withTimezone: true })
      .defaultNow()
      .notNull(),
    started_at: timestamp({ mode: 'string', withTimezone: true }),
    finished_at: timestamp({ mode: 'string', withTimezone: true }),
  },
  (table) => [
    uniqueIndex('config_channels_recreate_batch_request_id_uq').on(
      table.request_id
    ),
    uniqueIndex('config_channels_recreate_batch_source_uq').on(
      table.source_topic,
      table.source_partition,
      table.source_offset
    ),
    index('config_channels_recreate_batch_status_idx').on(table.status),
    index('config_channels_recreate_batch_completion_claim_idx')
      .on(
        table.next_completion_attempt_at,
        table.completion_lease_expires_at,
        table.finished_at
      )
      .where(
        sql`${table.status} = 'completed' AND ${table.completion_published_at} IS NULL`
      ),
    check(
      'config_channels_recreate_batch_counts_nonnegative_check',
      sql`${table.total_count} >= 0 AND ${table.success_count} >= 0 AND ${table.error_count} >= 0`
    ),
    check(
      'config_recreate_batch_completion_attempt_nonnegative_ck',
      sql`${table.completion_attempt_count} >= 0`
    ),
    check(
      'config_channels_recreate_batch_status_check',
      sql`${table.status} IN ('queued', 'running', 'completed')`
    ),
  ]
);

export const configChannelsRecreateBatchRelations = relations(
  configChannelsRecreateBatch,
  ({ many }) => ({
    targets: many(configChannelsRecreateTarget),
  })
);
