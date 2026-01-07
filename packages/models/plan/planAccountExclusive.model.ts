import { pgTable, uuid, timestamp, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { account, plan } from '@core/models';

export const planAccountExclusive = pgTable(
  'plan_account_exclusive',
  {
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
  },
  (table) => [
    index('plan_account_exclusive_plan_id_idx').on(table.plan_id),
    index('plan_account_exclusive_account_id_idx').on(table.account_id),
    index('plan_account_exclusive_account_id_plan_id_idx').on(
      table.account_id,
      table.plan_id
    ),
  ]
);

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
