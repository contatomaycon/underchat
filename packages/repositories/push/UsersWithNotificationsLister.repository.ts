import * as schema from '@core/models';
import { user, chatUser } from '@core/models';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';

@injectable()
export class UsersWithNotificationsListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  listUsersWithNotifications = async (
    accountId: string,
    status?: EChatStatus
  ): Promise<string[]> => {
    let whereClause = and(
      eq(user.account_id, accountId),
      eq(chatUser.notifications, true),
      eq(chatUser.notifications_push, true),
      isNull(user.deleted_at)
    );

    if (status === EChatStatus.queue) {
      whereClause = and(
        whereClause,
        eq(chatUser.notifications_status_update, true),
        eq(chatUser.notifications_status_queue, true)
      );
    }

    if (status === EChatStatus.in_chat) {
      whereClause = and(
        whereClause,
        eq(chatUser.notifications_status_update, true),
        eq(chatUser.notifications_status_in_chat, true)
      );
    }

    const result = await this.dbRo
      .select({
        user_id: user.user_id,
      })
      .from(user)
      .innerJoin(chatUser, eq(chatUser.user_id, user.user_id))
      .where(whereClause)
      .execute();

    if (!result?.length) {
      return [];
    }

    return result.map((row) => row.user_id);
  };
}
