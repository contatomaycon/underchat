import {
  pgTable,
  uuid,
  timestamp,
  numeric,
  integer,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { planCrossSell, accountPayment } from '@core/models';

export const accountPaymentCrossSell = pgTable('account_payment_cross_sell', {
  account_payment_cross_sell_id: uuid().primaryKey().notNull(),
  plan_cross_sell_id: uuid()
    .references(() => planCrossSell.plan_cross_sell_id)
    .notNull(),
  account_payment_id: uuid()
    .references(() => accountPayment.account_payment_id)
    .notNull(),
  quantity: integer().notNull(),
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

export const accountPaymentCrossSellRelations = relations(
  accountPaymentCrossSell,
  ({ one }) => ({
    apc: one(planCrossSell, {
      fields: [accountPaymentCrossSell.plan_cross_sell_id],
      references: [planCrossSell.plan_cross_sell_id],
    }),
    app: one(accountPayment, {
      fields: [accountPaymentCrossSell.account_payment_id],
      references: [accountPayment.account_payment_id],
    }),
  })
);
