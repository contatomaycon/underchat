import {
  pgTable,
  uuid,
  timestamp,
  varchar,
  text,
  numeric,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const expenditure = pgTable(
  'expenditure',
  {
    expenditure_id: uuid().primaryKey().notNull(),
    name: varchar({ length: 200 }).notNull(),
    description: text(),
    price: numeric({ precision: 10, scale: 2 }).notNull(),
    created_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    updated_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    deleted_at: timestamp({ mode: 'string', withTimezone: true }),
  },
  (table) => [
    index('expenditure_deleted_at_idx').on(table.deleted_at),
    index('expenditure_deleted_at_created_at_idx').on(
      table.deleted_at,
      table.created_at
    ),
    index('expenditure_created_at_idx').on(table.created_at),
  ]
);

export const expenditureRelations = relations(expenditure, () => ({}));
