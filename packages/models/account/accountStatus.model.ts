import { pgTable, timestamp, varchar, uuid, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { account } from '@core/models';

export const accountStatus = pgTable(
  'account_status',
  {
    account_status_id: uuid().primaryKey().notNull(),
    name: varchar({ length: 20 }).notNull(),
    created_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    updated_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
  },
  (table) => [index('account_status_name_idx').on(table.name)]
);

export const accountStatusRelations = relations(accountStatus, ({ many }) => ({
  aac: many(account),
}));
