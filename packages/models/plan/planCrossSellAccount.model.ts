import { pgTable, uuid, timestamp, index } from 'drizzle-orm/pg-core';
import { planCrossSell, account } from '@core/models';
import { relations } from 'drizzle-orm';

export const planCrossSellAccount = pgTable(
  'plan_cross_sell_account',
  {
    plan_cross_sell_account_id: uuid().primaryKey().notNull(),
    plan_cross_sell_id: uuid()
      .references(() => planCrossSell.plan_cross_sell_id)
      .notNull(),
    account_id: uuid()
      .references(() => account.account_id)
      .notNull(),
    created_at: timestamp('created_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    updated_at: timestamp('updated_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    deleted_at: timestamp('deleted_at', { mode: 'string', withTimezone: true }),
  },
  (table) => [
    index('plan_cross_sell_account_plan_cross_sell_id_idx').on(
      table.plan_cross_sell_id
    ),
    index('plan_cross_sell_account_account_id_idx').on(table.account_id),
    index('plan_cross_sell_account_deleted_at_idx').on(table.deleted_at),
    index('plan_cross_sell_account_account_id_deleted_at_idx').on(
      table.account_id,
      table.deleted_at
    ),
    index(
      'plan_cross_sell_account_account_id_plan_cross_sell_id_deleted_at_idx'
    ).on(table.account_id, table.plan_cross_sell_id, table.deleted_at),
  ]
);

export const planCrossSellAccountRelations = relations(
  planCrossSellAccount,
  ({ one }) => ({
    pca: one(planCrossSell, {
      fields: [planCrossSellAccount.plan_cross_sell_id],
      references: [planCrossSell.plan_cross_sell_id],
    }),
    pac: one(account, {
      fields: [planCrossSellAccount.account_id],
      references: [account.account_id],
    }),
  })
);
