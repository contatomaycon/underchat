import * as schema from '@core/models';
import { user, chatUser } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';

@injectable()
export class UsersWithNotificationsListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  listUsersWithNotifications = async (accountId: string): Promise<string[]> => {
    const result = await this.dbRo
      .select({
        user_id: user.user_id,
      })
      .from(user)
      .innerJoin(chatUser, eq(chatUser.user_id, user.user_id))
      .where(
        and(
          eq(user.account_id, accountId),
          eq(chatUser.notifications, true),
          eq(chatUser.notifications_push, true),
          isNull(user.deleted_at)
        )
      )
      .execute();

    if (!result?.length) {
      return [];
    }

    return result.map((row) => row.user_id);
  };
}
