import * as schema from '@core/models';
import { chatUserPinnedChat } from '@core/models';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';

export interface ChatUserPinnedChatRow {
  chat_user_pinned_chat_id: string;
  user_id: string;
  chat_id: string;
  pinned_at: string;
}

@injectable()
export class ChatUserPinnedRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>,
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  listByUserId = async (userId: string): Promise<ChatUserPinnedChatRow[]> => {
    return this.dbRo
      .select({
        chat_user_pinned_chat_id:
          chatUserPinnedChat.chat_user_pinned_chat_id,
        user_id: chatUserPinnedChat.user_id,
        chat_id: chatUserPinnedChat.chat_id,
        pinned_at: chatUserPinnedChat.pinned_at,
      })
      .from(chatUserPinnedChat)
      .where(eq(chatUserPinnedChat.user_id, userId))
      .orderBy(desc(chatUserPinnedChat.pinned_at))
      .execute();
  };

  pinChat = async (userId: string, chatId: string): Promise<boolean> => {
    const result = await this.dbRw
      .insert(chatUserPinnedChat)
      .values({
        chat_user_pinned_chat_id: uuidv7(),
        user_id: userId,
        chat_id: chatId,
      })
      .onConflictDoUpdate({
        target: [chatUserPinnedChat.user_id, chatUserPinnedChat.chat_id],
        set: {
          pinned_at: new Date().toISOString(),
        },
      })
      .execute();

    return (result.rowCount ?? 0) > 0;
  };

  unpinChat = async (userId: string, chatId: string): Promise<boolean> => {
    const result = await this.dbRw
      .delete(chatUserPinnedChat)
      .where(
        and(
          eq(chatUserPinnedChat.user_id, userId),
          eq(chatUserPinnedChat.chat_id, chatId)
        )
      )
      .execute();

    return (result.rowCount ?? 0) > 0;
  };

  clearPinnedChatsByChatId = async (chatId: string): Promise<boolean> => {
    const result = await this.dbRw
      .delete(chatUserPinnedChat)
      .where(eq(chatUserPinnedChat.chat_id, chatId))
      .execute();

    return (result.rowCount ?? 0) > 0;
  };

  clearPinnedChatsByUserIdAndChatIds = async (
    userId: string,
    chatIds: string[]
  ): Promise<boolean> => {
    if (!chatIds.length) {
      return false;
    }

    const result = await this.dbRw
      .delete(chatUserPinnedChat)
      .where(
        and(
          eq(chatUserPinnedChat.user_id, userId),
          inArray(chatUserPinnedChat.chat_id, chatIds)
        )
      )
      .execute();

    return (result.rowCount ?? 0) > 0;
  };
}
