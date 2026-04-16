import * as schema from '@core/models';
import { chatUser } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';
import { ListChatsUserResponse } from '@core/schema/chat/listChatsUser/response.schema';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import { PresenceService } from '@core/services/presence.service';
import Redis from 'ioredis';

@injectable()
export class ChatUserViewerRepository {
  private readonly keyPrefix = 'presence:user:';

  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>,
    @inject('Redis') private readonly redis: Redis,
    @inject(PresenceService)
    private readonly presenceService: PresenceService
  ) {}

  viewChatUser = async (
    userId: string
  ): Promise<ListChatsUserResponse | null> => {
    const result = await this.dbRo
      .select({
        chat_user_id: chatUser.chat_user_id,
        about: chatUser.about,
        notifications: chatUser.notifications,
        notifications_sound: chatUser.notifications_sound,
        notifications_toast: chatUser.notifications_toast,
        notifications_browser: chatUser.notifications_browser,
        notifications_push: chatUser.notifications_push,
        sort_by_chat_order: chatUser.sort_by_chat_order,
        sort_in_chat_order: chatUser.sort_in_chat_order,
        sort_by_my_chats_order: chatUser.sort_by_my_chats_order,
        sort_my_chats_order: chatUser.sort_my_chats_order,
        sort_by_queue_order: chatUser.sort_by_queue_order,
        sort_queue_order: chatUser.sort_queue_order,
        sort_by_chatbot_order: chatUser.sort_by_chatbot_order,
        sort_chatbot_order: chatUser.sort_chatbot_order,
      })
      .from(chatUser)
      .where(and(eq(chatUser.user_id, userId)))
      .execute();

    if (!result?.length) {
      return null;
    }

    const status = await this.presenceService.getStatus(userId);

    return {
      ...result[0],
      status: status ?? null,
    } as ListChatsUserResponse;
  };

  findStatusByUserId = async (
    userId: string
  ): Promise<EChatUserStatus | null> => {
    return this.presenceService.getStatus(userId);
  };

  listUserIdsByStatuses = async (
    statuses: EChatUserStatus[]
  ): Promise<string[]> => {
    if (!statuses.length) {
      return [];
    }

    const activeUserIds: string[] = [];
    const pattern = `${this.keyPrefix}*`;
    let cursor = '0';

    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100
      );

      cursor = nextCursor;

      for (const key of keys) {
        const userId = key.replace(this.keyPrefix, '');
        if (userId) {
          const value = await this.redis.get(key);
          if (value && statuses.includes(value as EChatUserStatus)) {
            activeUserIds.push(userId);
          }
        }
      }
    } while (cursor !== '0');

    return activeUserIds;
  };
}
