import {
  pgTable,
  uuid,
  timestamp,
  varchar,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { user } from '@core/models';

export const userCustomer = pgTable(
  'user_customer',
  {
    user_customer_id: uuid().primaryKey().notNull(),
    user_id: uuid()
      .references(() => user.user_id)
      .notNull(),
    user_customer: varchar({ length: 500 }).notNull(),
    created_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    updated_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
  },
  (table) => [uniqueIndex('user_customer_user_id_unique_idx').on(table.user_id)]
);

export const userCustomerRelations = relations(userCustomer, ({ one }) => ({
  ucu: one(user, {
    fields: [userCustomer.user_id],
    references: [user.user_id],
  }),
}));
