import { pgTable, uuid, timestamp, varchar } from 'drizzle-orm/pg-core';

export const accountTest = pgTable('account_test', {
  account_test_id: uuid().primaryKey().notNull(),
  document: varchar({ length: 500 }).notNull(),
  phone: varchar({ length: 50 }).notNull(),
  email: varchar({ length: 255 }).notNull(),
  created_at: timestamp({
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
  updated_at: timestamp({
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
});
