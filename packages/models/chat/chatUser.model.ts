import {
  pgTable,
  timestamp,
  varchar,
  uuid,
  boolean,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { user } from '@core/models';

export const chatUser = pgTable(
  'chat_user',
  {
    chat_user_id: uuid().primaryKey().notNull(),
    user_id: uuid()
      .references(() => user.user_id)
      .notNull(),
    about: varchar({ length: 200 }),
    notifications: boolean().default(true),
    notifications_sound: boolean().default(true),
    notifications_toast: boolean().default(true),
    notifications_browser: boolean().default(true),
    notifications_push: boolean().default(true),
    notifications_status_update: boolean().default(true),
    notifications_status_queue: boolean().default(false),
    notifications_status_in_chat: boolean().default(true),
    notifications_status_chatbot: boolean().default(true),
    sort_by_chat_order: varchar({ length: 50 }),
    sort_in_chat_order: varchar({ length: 10 }),
    sort_by_my_chats_order: varchar({ length: 50 }),
    sort_my_chats_order: varchar({ length: 10 }),
    sort_by_queue_order: varchar({ length: 50 }),
    sort_queue_order: varchar({ length: 10 }),
    sort_by_chatbot_order: varchar({ length: 50 }),
    sort_chatbot_order: varchar({ length: 10 }),
    created_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    updated_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
  },
  (table) => [index('chat_user_user_id_idx').on(table.user_id)]
);

export const chatUserRelations = relations(chatUser, ({ one }) => ({
  cuu: one(user, {
    fields: [chatUser.user_id],
    references: [user.user_id],
  }),
}));
