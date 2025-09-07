import { pgTable, uuid, timestamp, varchar } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import {
  accountInfo,
  accountStatus,
  apiKey,
  permissionAssignment,
  worker,
  plan,
  sector,
} from '@core/models';

export const account = pgTable('account', {
  account_id: uuid().primaryKey().notNull(),
  account_status_id: uuid()
    .references(() => accountStatus.account_status_id)
    .notNull(),
  plan_id: uuid()
    .references(() => plan.plan_id)
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
  apl: one(plan, {
    fields: [account.plan_id],
    references: [plan.plan_id],
  }),
  aak: many(apiKey),
  swk: many(worker),
  sct: many(sector),
}));
