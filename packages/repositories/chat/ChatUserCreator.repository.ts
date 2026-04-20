import * as schema from '@core/models';
import { chatUser } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { ExtractTablesWithRelations } from 'drizzle-orm';
import { PgTransaction } from 'drizzle-orm/pg-core';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';

@injectable()
export class ChatUserCreatorRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  createChatUser = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    userId: string
  ): Promise<boolean> => {
    const chatUserId = uuidv7();

    const result = await tx
      .insert(chatUser)
      .values({
        chat_user_id: chatUserId,
        user_id: userId,
        notifications: true,
        notifications_sound: true,
        notifications_toast: true,
        notifications_browser: true,
        notifications_push: true,
        notifications_status_update: true,
        notifications_status_queue: false,
        notifications_status_in_chat: true,
        notifications_status_chatbot: true,
      })
      .execute();

    return result.rowCount === 1;
  };
}
