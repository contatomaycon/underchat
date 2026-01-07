import { pgTable, uuid, timestamp, varchar, index } from 'drizzle-orm/pg-core';

export const accountTest = pgTable(
  'account_test',
  {
    account_test_id: uuid().primaryKey().notNull(),
    document: varchar({ length: 500 }).notNull(),
    document_c: varchar({ length: 500 }).notNull(),
    phone: varchar({ length: 500 }).notNull(),
    phone_c: varchar({ length: 500 }).notNull(),
    email: varchar({ length: 500 }).notNull(),
    email_c: varchar({ length: 500 }).notNull(),
    created_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    updated_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
  },
  (table) => [
    index('account_test_document_idx').on(table.document),
    index('account_test_phone_idx').on(table.phone),
    index('account_test_email_idx').on(table.email),
  ]
);
