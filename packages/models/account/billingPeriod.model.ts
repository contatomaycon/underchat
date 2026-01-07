import { pgTable, timestamp, varchar, uuid, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { accountPayment, planAccount } from '@core/models';

export const billingPeriod = pgTable(
  'billing_period',
  {
    billing_period_id: uuid().primaryKey().notNull(),
    name: varchar({ length: 20 }).notNull(),
    created_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    updated_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
  },
  (table) => [index('billing_period_name_idx').on(table.name)]
);

export const billingPeriodRelations = relations(billingPeriod, ({ many }) => ({
  apm: many(accountPayment),
  pac: many(planAccount),
}));
