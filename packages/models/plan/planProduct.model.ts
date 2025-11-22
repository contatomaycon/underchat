import { pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { planItems } from './planItems.model';
import { planProductDescription } from './planProductDescription.model';

export const planProduct = pgTable('plan_product', {
  plan_product_id: uuid().primaryKey().notNull(),
  name: varchar({ length: 500 }),
  created_at: timestamp('created_at', {
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
  updated_at: timestamp('updated_at', {
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
});

export const planProductRelations = relations(planProduct, ({ many, one }) => ({
  ppt: many(planItems),
  ppd: one(planProductDescription, {
    fields: [planProduct.plan_product_id],
    references: [planProductDescription.plan_product_id],
  }),
}));
