import { pgTable, timestamp, smallint, varchar } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import {
  accountInfo,
  accountStatus,
  apiKey,
  permissionAssignment,
} from '@core/models';

export const account = pgTable('account', {
  account_id: smallint().primaryKey().generatedByDefaultAsIdentity().notNull(),
  account_status_id: smallint()
    .references(() => accountStatus.account_status_id)
    .notNull(),
  name: varchar({ length: 10 }).notNull(),
  created_at: timestamp({
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
  updated_at: timestamp({
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
  deleted_at: timestamp({ mode: 'string', withTimezone: true }),
});

export const accountRelations = relations(account, ({ one, many }) => ({
  aac: one(accountStatus, {
    fields: [account.account_status_id],
    references: [accountStatus.account_status_id],
  }),
  aai: one(accountInfo, {
    fields: [account.account_id],
    references: [accountInfo.account_id],
  }),
  apa: one(permissionAssignment, {
    fields: [account.account_id],
    references: [permissionAssignment.account_id],
  }),
  aak: many(apiKey),
}));
