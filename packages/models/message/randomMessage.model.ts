import { index, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { account, randomMessageItem } from '@core/models';

export const randomMessage = pgTable(
  'random_message',
  {
    random_message_id: uuid().primaryKey().notNull(),
    account_id: uuid()
      .references(() => account.account_id)
      .notNull(),
    name: varchar({ length: 250 }).notNull(),
    status: varchar({ length: 20 }).notNull().default('active'),
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
    index('random_message_account_id_idx').on(table.account_id),
    index('random_message_status_idx').on(table.status),
    index('random_message_name_idx').on(table.name),
    index('random_message_created_at_idx').on(table.created_at),
  ]
);

export const randomMessageRelations = relations(
  randomMessage,
  ({ one, many }) => ({
    rma: one(account, {
      fields: [randomMessage.account_id],
      references: [account.account_id],
    }),
    rmi: many(randomMessageItem),
  })
);
