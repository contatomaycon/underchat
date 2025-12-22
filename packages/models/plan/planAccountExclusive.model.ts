import { pgTable, uuid, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { account, plan } from '@core/models';

export const planAccountExclusive = pgTable('plan_account_exclusive', {
  plan_account_exclusive_id: uuid().primaryKey().notNull(),
  plan_id: uuid()
    .references(() => plan.plan_id)
    .notNull(),
  account_id: uuid()
    .references(() => account.account_id)
    .notNull(),
  created_at: timestamp({
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
  updated_at: timestamp({
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
});

export const planAccountExclusiveRelations = relations(
  planAccountExclusive,
  ({ one }) => ({
    pac: one(account, {
      fields: [planAccountExclusive.account_id],
      references: [account.account_id],
    }),
    ppl: one(plan, {
      fields: [planAccountExclusive.plan_id],
      references: [plan.plan_id],
    }),
  })
);
