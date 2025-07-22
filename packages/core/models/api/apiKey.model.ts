import { pgTable, timestamp, smallint, varchar } from 'drizzle-orm/pg-core';
import { account, permissionAssignment } from '@core/models';
import { relations } from 'drizzle-orm';

export const apiKey = pgTable('api_key', {
  api_key_id: smallint().primaryKey().generatedByDefaultAsIdentity().notNull(),
  account_id: smallint()
    .references(() => account.account_id)
    .notNull(),
  key: varchar({ length: 32 }).notNull(),
  name: varchar({ length: 200 }).notNull(),
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

export const apiKeyRelations = relations(apiKey, ({ many, one }) => ({
  apa: many(permissionAssignment),
  aac: one(account, {
    fields: [apiKey.account_id],
    references: [account.account_id],
  }),
}));
