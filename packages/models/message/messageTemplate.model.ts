import { pgTable, uuid, timestamp, varchar, text } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { messageStatus, account } from '@core/models';

export const messageTemplate = pgTable('message_template', {
  message_template_id: uuid().primaryKey().notNull(),
  account_id: uuid()
    .references(() => account.account_id)
    .notNull(),
  message_status_id: uuid()
    .references(() => messageStatus.message_status_id)
    .notNull(),
  command: varchar({ length: 100 }).notNull(),
  message: text().notNull(),
  attachment_url: varchar({ length: 500 }),
  type: varchar({ length: 50 }).notNull().default('text'),
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

export const messageTemplateRelations = relations(
  messageTemplate,
  ({ one }) => ({
    mta: one(account, {
      fields: [messageTemplate.account_id],
      references: [account.account_id],
    }),
    mts: one(messageStatus, {
      fields: [messageTemplate.message_status_id],
      references: [messageStatus.message_status_id],
    }),
  })
);
