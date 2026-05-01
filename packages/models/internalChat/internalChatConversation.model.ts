import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  text,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { account, user } from '@core/models';
import { EInternalChatConversationType } from '@core/common/enums/internalChat/EInternalChatConversationType';
import { internalChatConversationParticipant } from './internalChatConversationParticipant.model';

export const internalChatConversation = pgTable(
  'internal_chat_conversation',
  {
    internal_chat_conversation_id: uuid().primaryKey().notNull(),
    account_id: uuid()
      .references(() => account.account_id)
      .notNull(),
    type: varchar({ length: 20 })
      .$type<EInternalChatConversationType>()
      .notNull(),
    direct_user_a_id: uuid().references(() => user.user_id),
    direct_user_b_id: uuid().references(() => user.user_id),
    direct_pair_key: varchar({ length: 120 }),
    name: varchar({ length: 255 }),
    photo: varchar({ length: 500 }),
    leader_user_id: uuid().references(() => user.user_id),
    created_by_user_id: uuid()
      .references(() => user.user_id)
      .notNull(),
    last_message_id: varchar({ length: 80 }),
    last_message_preview: text(),
    last_message_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }),
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
    index('internal_chat_conversation_account_id_idx').on(table.account_id),
    index('internal_chat_conversation_type_idx').on(table.type),
    index('internal_chat_conversation_last_message_at_idx').on(
      table.last_message_at
    ),
    index('internal_chat_conversation_deleted_at_idx').on(table.deleted_at),
    index('internal_chat_conversation_direct_pair_key_idx').on(
      table.direct_pair_key
    ),
    uniqueIndex('internal_chat_conversation_direct_pair_key_unique')
      .on(table.account_id, table.direct_pair_key)
      .where(
        sql`${table.type} = 'direct'::varchar AND ${table.deleted_at} IS NULL`
      ),
  ]
);

export const internalChatConversationRelations = relations(
  internalChatConversation,
  ({ one, many }) => ({
    acc: one(account, {
      fields: [internalChatConversation.account_id],
      references: [account.account_id],
    }),
    dua: one(user, {
      fields: [internalChatConversation.direct_user_a_id],
      references: [user.user_id],
    }),
    dub: one(user, {
      fields: [internalChatConversation.direct_user_b_id],
      references: [user.user_id],
    }),
    ldr: one(user, {
      fields: [internalChatConversation.leader_user_id],
      references: [user.user_id],
    }),
    cby: one(user, {
      fields: [internalChatConversation.created_by_user_id],
      references: [user.user_id],
    }),
    pts: many(internalChatConversationParticipant),
  })
);
