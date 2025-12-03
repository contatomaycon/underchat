import { pgTable, timestamp, varchar, uuid } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { planAccount } from '@core/models';

export const planAccountStatus = pgTable('plan_account_status', {
  plan_account_status_id: uuid().primaryKey().notNull(),
  name: varchar({ length: 20 }).notNull(),
  created_at: timestamp({
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
  updated_at: timestamp({
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
});

export const planAccountStatusRelations = relations(
  planAccountStatus,
  ({ many }) => ({
    pas: many(planAccount),
  })
);
