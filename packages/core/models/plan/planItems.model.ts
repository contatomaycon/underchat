import { pgTable, smallint, timestamp } from 'drizzle-orm/pg-core';
import { planProduct, plan } from '@core/models';
import { relations } from 'drizzle-orm';

export const planItems = pgTable('plan_items', {
  plan_item_id: smallint()
    .primaryKey()
    .generatedByDefaultAsIdentity()
    .notNull(),
  plan_product_id: smallint()
    .references(() => planProduct.plan_product_id)
    .notNull(),
  plan_id: smallint()
    .references(() => plan.plan_id)
    .notNull(),
  quantity: smallint().notNull(),
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

export const planItemsRelations = relations(planItems, ({ one }) => ({
  ppr: one(planProduct, {
    fields: [planItems.plan_product_id],
    references: [planProduct.plan_product_id],
  }),
  ppl: one(plan, {
    fields: [planItems.plan_id],
    references: [plan.plan_id],
  }),
}));
