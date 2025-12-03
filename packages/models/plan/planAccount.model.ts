import { pgTable, uuid, timestamp, boolean } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { account, plan, planAccountStatus } from '@core/models';

export const planAccount = pgTable('plan_account', {
  plan_account_id: uuid().primaryKey().notNull(),
  account_id: uuid()
    .references(() => account.account_id)
    .notNull(),
  plan_id: uuid()
    .references(() => plan.plan_id)
    .notNull(),
  plan_account_status_id: uuid()
    .references(() => planAccountStatus.plan_account_status_id)
    .notNull(),
  recurring_payment: boolean().notNull().default(false),
  last_payment_date: timestamp({
    mode: 'string',
    withTimezone: true,
  }),
  next_payment_date: timestamp({
    mode: 'string',
    withTimezone: true,
  }),
  created_at: timestamp({
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
  updated_at: timestamp({
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
});

export const planAccountRelations = relations(planAccount, ({ one }) => ({
  pac: one(account, {
    fields: [planAccount.account_id],
    references: [account.account_id],
  }),
  ppl: one(plan, {
    fields: [planAccount.plan_id],
    references: [plan.plan_id],
  }),
  pas: one(planAccountStatus, {
    fields: [planAccount.plan_account_status_id],
    references: [planAccountStatus.plan_account_status_id],
  }),
}));
