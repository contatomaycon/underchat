import { relations, sql } from 'drizzle-orm';
import {
  boolean,
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
import type { IWorkerLifecycleQueueMessage } from '@core/common/interfaces/IWorkerLifecycleQueueMessage';
import { configChannelsRecreateBatch } from './configChannelsRecreateBatch.model';

export type ConfigChannelsRecreateTargetStatus =
  'pending' | 'processing' | 'enqueued' | 'succeeded' | 'failed';

export const configChannelsRecreateTarget = pgTable(
  'config_channels_recreate_target',
  {
    config_channels_recreate_target_id: uuid().primaryKey().notNull(),
    config_channels_recreate_batch_id: uuid()
      .references(
        () => configChannelsRecreateBatch.config_channels_recreate_batch_id,
        { onDelete: 'cascade' }
      )
      .notNull(),
    worker_id: uuid().notNull(),
    worker_account_id: uuid().notNull(),
    server_id: uuid().notNull(),
    worker_type_id: uuid().notNull(),
    lifecycle_operation_id: uuid().notNull(),
    lifecycle_journal: jsonb().$type<IWorkerLifecycleQueueMessage[]>(),
    attempt_baseline_operation_id: uuid(),
    attempt_baseline_worker_status_id: uuid(),
    attempt_baseline_worker_container_id: varchar({ length: 100 }),
    attempt_baseline_runtime_exists: boolean(),
    attempt_baseline_runtime_container_id: varchar({ length: 100 }),
    attempt_baseline_runtime_generation: integer(),
    attempt_baseline_captured_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }),
    initial_worker_status_id: uuid().notNull(),
    initial_worker_container_id: varchar({ length: 100 }),
    initial_runtime_container_id: varchar({ length: 100 }),
    initial_runtime_generation: integer(),
    status: varchar({ length: 20 })
      .$type<ConfigChannelsRecreateTargetStatus>()
      .notNull()
      .default('pending'),
    attempt_count: integer().notNull().default(0),
    next_attempt_at: timestamp({ mode: 'string', withTimezone: true })
      .defaultNow()
      .notNull(),
    lease_owner: uuid(),
    lease_expires_at: timestamp({ mode: 'string', withTimezone: true }),
    recreate_server_slot_key: varchar({ length: 500 }),
    recreate_server_slot_token: varchar({ length: 500 }),
    recreate_server_slot_index: integer(),
    last_error: text(),
    created_at: timestamp({ mode: 'string', withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp({ mode: 'string', withTimezone: true })
      .defaultNow()
      .notNull(),
    started_at: timestamp({ mode: 'string', withTimezone: true }),
    enqueued_at: timestamp({ mode: 'string', withTimezone: true }),
    finished_at: timestamp({ mode: 'string', withTimezone: true }),
  },
  (table) => [
    uniqueIndex('config_channels_recreate_target_batch_worker_uq').on(
      table.config_channels_recreate_batch_id,
      table.worker_id
    ),
    index('config_channels_recreate_target_batch_status_idx').on(
      table.config_channels_recreate_batch_id,
      table.status
    ),
    index('config_channels_recreate_target_pending_claim_idx')
      .on(
        table.next_attempt_at,
        table.created_at,
        table.config_channels_recreate_target_id
      )
      .where(sql`${table.status} = 'pending'`),
    index('config_channels_recreate_target_leased_claim_idx')
      .on(
        table.next_attempt_at,
        table.lease_expires_at,
        table.created_at,
        table.config_channels_recreate_target_id
      )
      .where(sql`${table.status} IN ('processing', 'enqueued')`),
    index('config_channels_recreate_target_server_status_idx').on(
      table.server_id,
      table.status
    ),
    check(
      'config_channels_recreate_target_attempt_nonnegative_check',
      sql`${table.attempt_count} >= 0`
    ),
    check(
      'config_channels_recreate_target_status_check',
      sql`${table.status} IN ('pending', 'processing', 'enqueued', 'succeeded', 'failed')`
    ),
    check(
      'config_channels_recreate_target_generation_nonnegative_check',
      sql`${table.initial_runtime_generation} IS NULL OR ${table.initial_runtime_generation} >= 0`
    ),
    check(
      'config_recreate_target_attempt_baseline_generation_ck',
      sql`${table.attempt_baseline_runtime_generation} IS NULL OR ${table.attempt_baseline_runtime_generation} >= 0`
    ),
    check(
      'config_recreate_target_attempt_baseline_consistency_ck',
      sql`(
        ${table.attempt_baseline_operation_id} IS NULL
        AND ${table.attempt_baseline_worker_status_id} IS NULL
        AND ${table.attempt_baseline_worker_container_id} IS NULL
        AND ${table.attempt_baseline_runtime_exists} IS NULL
        AND ${table.attempt_baseline_runtime_container_id} IS NULL
        AND ${table.attempt_baseline_runtime_generation} IS NULL
        AND ${table.attempt_baseline_captured_at} IS NULL
      ) OR (
        ${table.attempt_baseline_operation_id} IS NOT NULL
        AND ${table.attempt_baseline_worker_status_id} IS NOT NULL
        AND ${table.attempt_baseline_runtime_exists} IS NOT NULL
        AND ${table.attempt_baseline_captured_at} IS NOT NULL
        AND (
          (
            ${table.attempt_baseline_runtime_exists} = FALSE
            AND ${table.attempt_baseline_runtime_container_id} IS NULL
            AND ${table.attempt_baseline_runtime_generation} IS NULL
          )
          OR (
            ${table.attempt_baseline_runtime_exists} = TRUE
            AND ${table.attempt_baseline_runtime_generation} IS NOT NULL
          )
        )
      )`
    ),
    check(
      'config_channels_recreate_target_slot_index_nonnegative_check',
      sql`${table.recreate_server_slot_index} IS NULL OR ${table.recreate_server_slot_index} >= 0`
    ),
  ]
);

export const configChannelsRecreateTargetRelations = relations(
  configChannelsRecreateTarget,
  ({ one }) => ({
    batch: one(configChannelsRecreateBatch, {
      fields: [configChannelsRecreateTarget.config_channels_recreate_batch_id],
      references: [
        configChannelsRecreateBatch.config_channels_recreate_batch_id,
      ],
    }),
  })
);
