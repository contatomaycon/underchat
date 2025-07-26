import {
  pgTable,
  smallint,
  timestamp,
  varchar,
  numeric,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { planItems, account } from '@core/models';

export const plan = pgTable('plan', {
  plan_id: smallint().primaryKey().generatedByDefaultAsIdentity().notNull(),
  name: varchar({ length: 50 }).notNull(),
  price: numeric({ precision: 10, scale: 2 }).notNull(),
  price_old: numeric({ precision: 10, scale: 2 }).notNull(),
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

export const planRelations = relations(plan, ({ many }) => ({
  ppi: many(planItems),
  ppa: many(account),
}));
