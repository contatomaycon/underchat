import { pgTable, uuid, timestamp, varchar, text } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { labelStatus } from './labelStatus.model';
import { account } from '../account';

export const labelTemplate = pgTable('label_template', {
  label_template_id: uuid().primaryKey().notNull(),
  account_id: uuid()
    .references(() => account.account_id)
    .notNull(),
  label_status_id: uuid()
    .references(() => labelStatus.label_status_id)
    .notNull(),
  command: varchar({ length: 100 }).notNull(),
  message: text().notNull(),
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

export const labelTemplateRelations = relations(labelTemplate, ({ one }) => ({
  lta: one(account, {
    fields: [labelTemplate.account_id],
    references: [account.account_id],
  }),
  lts: one(labelStatus, {
    fields: [labelTemplate.label_status_id],
    references: [labelStatus.label_status_id],
  }),
}));
