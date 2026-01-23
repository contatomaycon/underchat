import { pgTable, timestamp, varchar, uuid, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { account } from '@core/models';
import { EChatbotType } from '@core/common/enums/EChatbotType';

export const chatbot = pgTable(
  'chatbot',
  {
    chatbot_id: uuid().primaryKey().notNull(),
    account_id: uuid()
      .references(() => account.account_id)
      .notNull(),
    name: varchar({ length: 255 }).notNull(),
    type: varchar({ length: 20 })
      .$type<EChatbotType>()
      .default(EChatbotType.input),
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
    index('chatbot_account_id_idx').on(table.account_id),
    index('chatbot_name_idx').on(table.name),
  ]
);

export const chatbotRelations = relations(chatbot, ({ one }) => ({
  acc: one(account, {
    fields: [chatbot.account_id],
    references: [account.account_id],
  }),
}));
