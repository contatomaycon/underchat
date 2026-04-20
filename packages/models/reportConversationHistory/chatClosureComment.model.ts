import {
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { account, user } from '@core/models';

export const chatClosureComment = pgTable(
  'chat_closure_comment',
  {
    chat_closure_comment_id: uuid().primaryKey().notNull().defaultRandom(),
    account_id: uuid()
      .references(() => account.account_id)
      .notNull(),
    chat_id: uuid().notNull(),
    user_id: uuid()
      .references(() => user.user_id)
      .notNull(),
    comment: text().notNull(),
    closed_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).notNull(),
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
    index('chat_closure_comment_account_id_idx').on(table.account_id),
    index('chat_closure_comment_chat_id_idx').on(table.chat_id),
    index('chat_closure_comment_user_id_idx').on(table.user_id),
    index('chat_closure_comment_account_id_chat_id_idx').on(
      table.account_id,
      table.chat_id
    ),
  ]
);

export const chatClosureCommentRelations = relations(
  chatClosureComment,
  ({ one }) => ({
    ccca: one(account, {
      fields: [chatClosureComment.account_id],
      references: [account.account_id],
    }),
    cccu: one(user, {
      fields: [chatClosureComment.user_id],
      references: [user.user_id],
    }),
  })
);
