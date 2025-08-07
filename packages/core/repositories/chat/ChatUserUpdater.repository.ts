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
import { v4 as uuidv4 } from 'uuid';

@injectable()
export class ChatUserUpdaterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private updateInput(
    input: UpdateChatsUserRequest
  ): Partial<typeof chatUser.$inferInsert> {
    const inputUpdate: Partial<typeof chatUser.$inferInsert> = {};

    if (input.about) {
      inputUpdate.about = input.about;
    }

    if (input.notifications) {
      inputUpdate.notifications = input.notifications;
    }

    if (input.status) {
      inputUpdate.status = input.status;
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
    const chatUserId = uuidv4();

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
    return this.db.transaction(async (tx) => {
      const exists = await this.checkExistsUserByid(tx, userId);

      if (exists) {
        return this.updateChatUserById(tx, userId, input);
      }

      return this.addChatUserById(tx, userId, input);
    });
  };
}
