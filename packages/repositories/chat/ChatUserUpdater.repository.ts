import * as schema from '@core/models';
import { chatUser } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, count, ExtractTablesWithRelations } from 'drizzle-orm';
import { UpdateChatsUserRequest } from '@core/schema/chat/updateChatsUser/request.schema';
import { PgTransaction } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';

@injectable()
export class ChatUserUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  private updateInput(
    input: UpdateChatsUserRequest
  ): Partial<typeof chatUser.$inferInsert> {
    const inputUpdate: Partial<typeof chatUser.$inferInsert> = {};

    if (input.about !== undefined) {
      inputUpdate.about = input.about;
    }

    if (input.notifications !== undefined) {
      inputUpdate.notifications = input.notifications;
    }

    if (input.notifications_sound !== undefined) {
      inputUpdate.notifications_sound = input.notifications_sound;
    }

    if (input.notifications_vibrate !== undefined) {
      inputUpdate.notifications_vibrate = input.notifications_vibrate;
    }

    if (input.notifications_toast !== undefined) {
      inputUpdate.notifications_toast = input.notifications_toast;
    }

    if (input.notifications_browser !== undefined) {
      inputUpdate.notifications_browser = input.notifications_browser;
    }

    if (input.notifications_push !== undefined) {
      inputUpdate.notifications_push = input.notifications_push;
    }

    if (input.notifications_message_queue !== undefined) {
      inputUpdate.notifications_message_queue =
        input.notifications_message_queue;
    }

    if (input.notifications_message_in_chat !== undefined) {
      inputUpdate.notifications_message_in_chat =
        input.notifications_message_in_chat;
    }

    if (input.notifications_message_chatbot !== undefined) {
      inputUpdate.notifications_message_chatbot =
        input.notifications_message_chatbot;
    }

    if (input.notifications_transfer !== undefined) {
      inputUpdate.notifications_transfer = input.notifications_transfer;
    }

    if (input.notifications === false) {
      inputUpdate.notifications_sound = false;
      inputUpdate.notifications_vibrate = false;
      inputUpdate.notifications_toast = false;
      inputUpdate.notifications_browser = false;
      inputUpdate.notifications_push = false;
      inputUpdate.notifications_message_queue = false;
      inputUpdate.notifications_message_in_chat = false;
      inputUpdate.notifications_message_chatbot = false;
      inputUpdate.notifications_transfer = false;
    }

    if (input.notifications_internal_chat !== undefined) {
      inputUpdate.notifications_internal_chat =
        input.notifications_internal_chat;
    }

    if (input.notifications_internal_chat_direct !== undefined) {
      inputUpdate.notifications_internal_chat_direct =
        input.notifications_internal_chat_direct;
    }

    if (input.notifications_internal_chat_group !== undefined) {
      inputUpdate.notifications_internal_chat_group =
        input.notifications_internal_chat_group;
    }

    if (input.notifications_internal_chat_sound !== undefined) {
      inputUpdate.notifications_internal_chat_sound =
        input.notifications_internal_chat_sound;
    }

    if (input.notifications_internal_chat_vibrate !== undefined) {
      inputUpdate.notifications_internal_chat_vibrate =
        input.notifications_internal_chat_vibrate;
    }

    if (input.notifications_internal_chat_toast !== undefined) {
      inputUpdate.notifications_internal_chat_toast =
        input.notifications_internal_chat_toast;
    }

    if (input.notifications_internal_chat_browser !== undefined) {
      inputUpdate.notifications_internal_chat_browser =
        input.notifications_internal_chat_browser;
    }

    if (input.notifications_internal_chat_push !== undefined) {
      inputUpdate.notifications_internal_chat_push =
        input.notifications_internal_chat_push;
    }

    if (input.notifications_internal_chat === false) {
      inputUpdate.notifications_internal_chat_direct = false;
      inputUpdate.notifications_internal_chat_group = false;
      inputUpdate.notifications_internal_chat_sound = false;
      inputUpdate.notifications_internal_chat_vibrate = false;
      inputUpdate.notifications_internal_chat_toast = false;
      inputUpdate.notifications_internal_chat_browser = false;
      inputUpdate.notifications_internal_chat_push = false;
    }

    if (input.sort_by_chat_order !== undefined) {
      inputUpdate.sort_by_chat_order = input.sort_by_chat_order;
    }

    if (input.sort_in_chat_order !== undefined) {
      inputUpdate.sort_in_chat_order = input.sort_in_chat_order;
    }

    if (input.sort_by_my_chats_order !== undefined) {
      inputUpdate.sort_by_my_chats_order = input.sort_by_my_chats_order;
    }

    if (input.sort_my_chats_order !== undefined) {
      inputUpdate.sort_my_chats_order = input.sort_my_chats_order;
    }

    if (input.sort_by_queue_order !== undefined) {
      inputUpdate.sort_by_queue_order = input.sort_by_queue_order;
    }

    if (input.sort_queue_order !== undefined) {
      inputUpdate.sort_queue_order = input.sort_queue_order;
    }

    if (input.sort_by_chatbot_order !== undefined) {
      inputUpdate.sort_by_chatbot_order = input.sort_by_chatbot_order;
    }

    if (input.sort_chatbot_order !== undefined) {
      inputUpdate.sort_chatbot_order = input.sort_chatbot_order;
    }

    return inputUpdate;
  }

  updateChatUserById = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    userId: string,
    input: UpdateChatsUserRequest
  ): Promise<boolean> => {
    const updateInput = this.updateInput(input);

    if (Object.keys(updateInput).length === 0) {
      return false;
    }

    const result = await tx
      .update(chatUser)
      .set(updateInput)
      .where(and(eq(chatUser.user_id, userId)))
      .execute();

    return result.rowCount === 1;
  };

  addChatUserById = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    userId: string,
    input: UpdateChatsUserRequest
  ): Promise<boolean> => {
    const updateInput = this.updateInput(input);
    const chatUserId = uuidv7();

    const result = await tx
      .insert(chatUser)
      .values({
        chat_user_id: chatUserId,
        user_id: userId,
        ...updateInput,
      })
      .execute();

    return result.rowCount === 1;
  };

  checkExistsUserByid = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    userId: string
  ): Promise<boolean> => {
    const result = await tx
      .select({
        total: count(),
      })
      .from(chatUser)
      .where(eq(chatUser.user_id, userId))
      .execute();

    return result[0]?.total > 0;
  };

  updateChatUser = async (
    userId: string,
    input: UpdateChatsUserRequest
  ): Promise<boolean> => {
    return this.dbRw.transaction(async (tx) => {
      const exists = await this.checkExistsUserByid(tx, userId);

      if (exists) {
        return this.updateChatUserById(tx, userId, input);
      }

      return this.addChatUserById(tx, userId, input);
    });
  };
}
