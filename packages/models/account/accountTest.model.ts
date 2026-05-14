import {
  pgTable,
  uuid,
  timestamp,
  varchar,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

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
    status: varchar({ length: 20 }).notNull().default('created'),
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
    index('account_test_status_idx').on(table.status),
    uniqueIndex('account_test_document_c_unique').on(table.document_c),
    uniqueIndex('account_test_phone_c_unique').on(table.phone_c),
    uniqueIndex('account_test_email_c_unique').on(table.email_c),
  ]
);
