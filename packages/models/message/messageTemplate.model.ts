import {
  pgTable,
  uuid,
  timestamp,
  varchar,
  text,
  integer,
  boolean,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { messageStatus, account, worker } from '@core/models';

export const messageTemplate = pgTable(
  'message_template',
  {
    message_template_id: uuid().primaryKey().notNull(),
    account_id: uuid()
      .references(() => account.account_id)
      .notNull(),
    channel_id: uuid().references(() => worker.worker_id),
    message_status_id: uuid()
      .references(() => messageStatus.message_status_id)
      .notNull(),
    command: varchar({ length: 100 }).notNull(),
    message: text().notNull(),
    attachment_url: varchar({ length: 500 }),
    type: varchar({ length: 50 }).notNull().default('text'),
    mimetype: varchar({ length: 100 }),
    duration: integer(),
    width: integer(),
    height: integer(),
    auto_send: boolean().notNull().default(false),
    created_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    updated_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    deleted_at: timestamp({ mode: 'string', withTimezone: true }),
  },
  (table) => [
    index('message_template_account_id_idx').on(table.account_id),
    index('message_template_channel_id_idx').on(table.channel_id),
    index('message_template_message_status_id_idx').on(table.message_status_id),
    index('message_template_command_idx').on(table.command),
    index('message_template_deleted_at_idx').on(table.deleted_at),
    index('message_template_account_id_deleted_at_idx').on(
      table.account_id,
      table.deleted_at
    ),
    index('message_template_account_id_channel_id_deleted_at_idx').on(
      table.account_id,
      table.channel_id,
      table.deleted_at
    ),
  ]
);

export const messageTemplateRelations = relations(
  messageTemplate,
  ({ one }) => ({
    mta: one(account, {
      fields: [messageTemplate.account_id],
      references: [account.account_id],
    }),
    mtw: one(worker, {
      fields: [messageTemplate.channel_id],
      references: [worker.worker_id],
    }),
    mts: one(messageStatus, {
      fields: [messageTemplate.message_status_id],
      references: [messageStatus.message_status_id],
    }),
  })
);
