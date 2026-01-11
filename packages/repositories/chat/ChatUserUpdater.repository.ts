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
