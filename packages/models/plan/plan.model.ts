import {
  pgTable,
  uuid,
  timestamp,
  varchar,
  numeric,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { planItems, planAccount } from '@core/models';

export const plan = pgTable('plan', {
  plan_id: uuid().primaryKey().notNull(),
  name: varchar({ length: 50 }).notNull(),
  price: numeric({ precision: 10, scale: 2 }).notNull(),
  price_old: numeric({ precision: 10, scale: 2 }).notNull(),
  description: varchar({ length: 500 }),
  annual_discount: numeric({ precision: 5, scale: 2 }),
  icon: varchar({ length: 100 }),
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
  pac: many(planAccount),
}));
