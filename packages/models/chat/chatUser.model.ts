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
