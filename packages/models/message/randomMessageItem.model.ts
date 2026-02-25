import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { account, randomMessage } from '@core/models';

export const randomMessageItem = pgTable(
  'random_message_item',
  {
    random_message_item_id: uuid().primaryKey().notNull(),
    random_message_id: uuid()
      .references(() => randomMessage.random_message_id, {
        onDelete: 'cascade',
      })
      .notNull(),
    account_id: uuid()
      .references(() => account.account_id)
      .notNull(),
    message: text().notNull(),
    status: varchar({ length: 20 }).notNull().default('active'),
    type: varchar({ length: 50 }).notNull().default('text'),
    attachment_url: varchar({ length: 500 }),
    mimetype: varchar({ length: 100 }),
    duration: integer(),
    width: integer(),
    height: integer(),
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
    index('random_message_item_random_message_id_idx').on(
      table.random_message_id
    ),
    index('random_message_item_account_id_idx').on(table.account_id),
    index('random_message_item_status_idx').on(table.status),
    index('random_message_item_created_at_idx').on(table.created_at),
  ]
);

export const randomMessageItemRelations = relations(
  randomMessageItem,
  ({ one }) => ({
    rmir: one(randomMessage, {
      fields: [randomMessageItem.random_message_id],
      references: [randomMessage.random_message_id],
    }),
    rmia: one(account, {
      fields: [randomMessageItem.account_id],
      references: [account.account_id],
    }),
  })
);
