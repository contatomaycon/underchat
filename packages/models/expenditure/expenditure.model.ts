import {
  pgTable,
  uuid,
  timestamp,
  varchar,
  numeric,
  text,
} from 'drizzle-orm/pg-core';

export const expenditure = pgTable('expenditure', {
  expenditure_id: uuid().primaryKey().notNull(),
  name: varchar({ length: 200 }).notNull(),
  description: text(),
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
