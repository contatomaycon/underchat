import {
  integer,
  numeric,
  pgTable,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { planProduct } from '@core/models';
import { relations } from 'drizzle-orm';

export const planCrossSell = pgTable('plan_cross_sell', {
  plan_cross_sell_id: uuid().primaryKey().notNull(),
  plan_product_id: uuid()
    .references(() => planProduct.plan_product_id)
    .notNull(),
  quantity: integer().notNull(),
  price: numeric({ precision: 10, scale: 2 }).notNull(),
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

export const planCrossSellRelations = relations(planCrossSell, ({ one }) => ({
  ppt: one(planProduct, {
    fields: [planCrossSell.plan_product_id],
    references: [planProduct.plan_product_id],
  }),
}));
