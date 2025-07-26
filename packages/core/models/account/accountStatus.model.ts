import { pgTable, timestamp, varchar, uuid } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { account } from '@core/models';

export const accountStatus = pgTable('account_status', {
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
});

export const accountStatusRelations = relations(accountStatus, ({ many }) => ({
  aac: many(account),
}));
