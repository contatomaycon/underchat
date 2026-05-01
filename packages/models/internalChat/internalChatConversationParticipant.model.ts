import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  boolean,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { account, user } from '@core/models';
import { internalChatConversation } from './internalChatConversation.model';
import { EInternalChatConversationParticipantRole } from '@core/common/enums/internalChat/EInternalChatConversationParticipantRole';

export const internalChatConversationParticipant = pgTable(
  'internal_chat_conversation_participant',
  {
    internal_chat_conversation_participant_id: uuid().primaryKey().notNull(),
    internal_chat_conversation_id: uuid()
      .references(
        () => internalChatConversation.internal_chat_conversation_id,
        {
          onDelete: 'cascade',
        }
      )
      .notNull(),
    account_id: uuid()
      .references(() => account.account_id)
      .notNull(),
    user_id: uuid()
      .references(() => user.user_id)
      .notNull(),
    role: varchar({ length: 20 })
      .$type<EInternalChatConversationParticipantRole>()
      .notNull()
      .default(EInternalChatConversationParticipantRole.member),
    is_active: boolean().notNull().default(true),
    closed_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }),
    unread_count: integer().notNull().default(0),
    last_read_message_id: varchar({ length: 80 }),
    last_read_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }),
    joined_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
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
    index('internal_chat_conversation_participant_conversation_id_idx').on(
      table.internal_chat_conversation_id
    ),
    index('internal_chat_conversation_participant_user_id_idx').on(
      table.user_id
    ),
    index('internal_chat_conversation_participant_account_id_idx').on(
      table.account_id
    ),
    index('internal_chat_conversation_participant_closed_at_idx').on(
      table.closed_at
    ),
    index('internal_chat_conversation_participant_deleted_at_idx').on(
      table.deleted_at
    ),
    index('internal_chat_conversation_participant_open_by_user_idx').on(
      table.user_id,
      table.closed_at,
      table.deleted_at
    ),
    uniqueIndex('internal_chat_conversation_participant_unique')
      .on(table.internal_chat_conversation_id, table.user_id)
      .where(sql`${table.deleted_at} IS NULL`),
  ]
);

export const internalChatConversationParticipantRelations = relations(
  internalChatConversationParticipant,
  ({ one }) => ({
    con: one(internalChatConversation, {
      fields: [
        internalChatConversationParticipant.internal_chat_conversation_id,
      ],
      references: [internalChatConversation.internal_chat_conversation_id],
    }),
    acc: one(account, {
      fields: [internalChatConversationParticipant.account_id],
      references: [account.account_id],
    }),
    usr: one(user, {
      fields: [internalChatConversationParticipant.user_id],
      references: [user.user_id],
    }),
  })
);
