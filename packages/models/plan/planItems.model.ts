import { pgTable, integer, timestamp, uuid, index } from 'drizzle-orm/pg-core';
import { planProduct, plan } from '@core/models';
import { relations } from 'drizzle-orm';

export const planItems = pgTable(
  'plan_items',
  {
    plan_item_id: uuid().primaryKey().notNull(),
    plan_product_id: uuid()
      .references(() => planProduct.plan_product_id)
      .notNull(),
    plan_id: uuid()
      .references(() => plan.plan_id)
      .notNull(),
    quantity: integer().notNull(),
    created_at: timestamp('created_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    updated_at: timestamp('updated_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    deleted_at: timestamp('deleted_at', { mode: 'string', withTimezone: true }),
  },
  (table) => [
    index('plan_items_plan_product_id_idx').on(table.plan_product_id),
    index('plan_items_plan_id_idx').on(table.plan_id),
    index('plan_items_deleted_at_idx').on(table.deleted_at),
  ]
);

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
