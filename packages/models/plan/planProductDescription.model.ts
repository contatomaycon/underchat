import {
  pgTable,
  timestamp,
  uuid,
  varchar,
  text,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { planProduct } from './planProduct.model';

export const planProductDescription = pgTable(
  'plan_product_description',
  {
    plan_product_description_id: uuid().primaryKey().notNull(),
    plan_product_id: uuid()
      .references(() => planProduct.plan_product_id)
      .notNull()
      .unique(),
    name: varchar({ length: 500 }).notNull(),
    description: text(),
    created_at: timestamp('created_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    updated_at: timestamp('updated_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
  },
  (table) => [
    index('plan_product_description_plan_product_id_idx').on(
      table.plan_product_id
    ),
  ]
);

export const planProductDescriptionRelations = relations(
  planProductDescription,
  ({ one }) => ({
    ppt: one(planProduct, {
      fields: [planProductDescription.plan_product_id],
      references: [planProduct.plan_product_id],
    }),
  })
);
