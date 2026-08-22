import { account, planProduct } from '@core/models';
import {
  bigint,
  boolean,
  check,
  index,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const accountPlanProductEntitlementRevision = pgTable(
  'account_plan_product_entitlement_revision',
  {
    account_id: uuid()
      .references(() => account.account_id, { onDelete: 'cascade' })
      .notNull(),
    plan_product_id: uuid()
      .references(() => planProduct.plan_product_id, { onDelete: 'cascade' })
      .notNull(),
    revision: bigint({ mode: 'bigint' })
      .notNull()
      .default(sql`1`),
    allowed: boolean().notNull().default(false),
    deny_fence_token: uuid(),
    deny_fence_created_at: timestamp('deny_fence_created_at', {
      mode: 'string',
      withTimezone: true,
    }),
    deny_fence_released_at: timestamp('deny_fence_released_at', {
      mode: 'string',
      withTimezone: true,
    }),
    deny_fence_operation_key: varchar('deny_fence_operation_key', {
      length: 255,
    }),
    updated_at: timestamp('updated_at', {
      mode: 'string',
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: 'account_plan_product_entitlement_revision_pkey',
      columns: [table.account_id, table.plan_product_id],
    }),
    index('account_plan_product_entitlement_revision_product_idx').on(
      table.plan_product_id,
      table.account_id
    ),
    check(
      'account_plan_product_entitlement_revision_positive_check',
      sql`${table.revision} > 0`
    ),
    check(
      'account_plan_product_entitlement_revision_fence_pair_check',
      sql`(
        (${table.deny_fence_token} IS NULL
          AND ${table.deny_fence_created_at} IS NULL
          AND ${table.deny_fence_released_at} IS NULL
          AND ${table.deny_fence_operation_key} IS NULL)
        OR
        (${table.deny_fence_token} IS NOT NULL
          AND ${table.deny_fence_created_at} IS NOT NULL)
      )`
    ),
  ]
);
