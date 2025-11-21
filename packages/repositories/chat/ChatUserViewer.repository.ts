import * as schema from '@core/models';
import { chatUser } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';
import { ListChatsUserResponse } from '@core/schema/chat/listChatsUser/response.schema';

@injectable()
export class ChatUserViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  viewChatUser = async (
    userId: string
  ): Promise<ListChatsUserResponse | null> => {
    const result = await this.db
      .select({
        chat_user_id: chatUser.chat_user_id,
        about: chatUser.about,
        status: chatUser.status,
        notifications: chatUser.notifications,
      })
      .from(chatUser)
      .where(and(eq(chatUser.user_id, userId)))
      .execute();

    if (!result?.length) {
      return null;
    }

    return result[0] as ListChatsUserResponse;
  };
}
