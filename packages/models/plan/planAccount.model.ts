import {
  pgTable,
  uuid,
  timestamp,
  boolean,
  numeric,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { account, billingPeriod, plan, accountPayment } from '@core/models';

export const planAccount = pgTable('plan_account', {
  plan_account_id: uuid().primaryKey().notNull(),
  account_id: uuid()
    .references(() => account.account_id)
    .notNull(),
  plan_id: uuid()
    .references(() => plan.plan_id)
    .notNull(),
  account_payment_id: uuid().references(
    () => accountPayment.account_payment_id
  ),
  billing_period_id: uuid().references(() => billingPeriod.billing_period_id),
  recurring_payment: boolean().notNull().default(false),
  last_payment_date: timestamp({
    mode: 'string',
    withTimezone: true,
  }),
  next_payment_date: timestamp({
    mode: 'string',
    withTimezone: true,
  }),
  cancellation_date: timestamp({
    mode: 'string',
    withTimezone: true,
  }),
  value: numeric({ precision: 10, scale: 2 }).notNull(),
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
  bpl: one(billingPeriod, {
    fields: [planAccount.billing_period_id],
    references: [billingPeriod.billing_period_id],
  }),
  apy: one(accountPayment, {
    fields: [planAccount.account_payment_id],
    references: [accountPayment.account_payment_id],
  }),
}));
