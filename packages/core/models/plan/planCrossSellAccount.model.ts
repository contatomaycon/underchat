import { pgTable, smallint, timestamp } from 'drizzle-orm/pg-core';
import { planCrossSell, account } from '@core/models';
import { relations } from 'drizzle-orm';

export const planCrossSellAccount = pgTable('plan_cross_sell_account', {
  plan_cross_sell_account_id: smallint()
    .primaryKey()
    .generatedByDefaultAsIdentity()
    .notNull(),
  plan_cross_sell_id: smallint()
    .references(() => planCrossSell.plan_cross_sell_id)
    .notNull(),
  account_id: smallint()
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
});

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
