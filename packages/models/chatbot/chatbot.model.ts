import { pgTable, timestamp, varchar, uuid, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { account } from '@core/models';
import { EChatbotType } from '@core/common/enums/EChatbotType';
import { EChatbotStatus } from '@core/common/enums/EChatbotStatus';

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
    status: varchar({ length: 20 })
      .$type<EChatbotStatus>()
      .notNull()
      .default(EChatbotStatus.active),
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
    index('chatbot_status_idx').on(table.status),
    index('chatbot_account_id_status_idx').on(table.account_id, table.status),
  ]
);

export const chatbotRelations = relations(chatbot, ({ one }) => ({
  acc: one(account, {
    fields: [chatbot.account_id],
    references: [account.account_id],
  }),
}));
