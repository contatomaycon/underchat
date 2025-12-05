import { pgTable, timestamp, varchar, uuid } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { accountPayment } from '@core/models';

export const paymentBillingType = pgTable('payment_billing_type', {
  payment_billing_type_id: uuid().primaryKey().notNull(),
  name: varchar({ length: 50 }).notNull(),
  created_at: timestamp({
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
  updated_at: timestamp({
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
});

export const paymentBillingTypeRelations = relations(
  paymentBillingType,
  ({ many }) => ({
    apm: many(accountPayment),
  })
);
