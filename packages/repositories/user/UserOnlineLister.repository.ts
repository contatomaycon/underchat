import * as schema from '@core/models';
import { user, chatUser, userInfo } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import { IViewUserNamePhoto } from '@core/common/interfaces/IViewUserNamePhoto';
import { EUserStatus } from '@core/common/enums/EUserStatus';

@injectable()
export class UserOnlineListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  listOnlineUsersByAccount = async (
    accountId: string
  ): Promise<IViewUserNamePhoto[]> => {
    const result = await this.dbRo
      .select({
        id: user.user_id,
        name: userInfo.name,
        photo: userInfo.photo,
      })
      .from(user)
      .innerJoin(chatUser, eq(chatUser.user_id, user.user_id))
      .innerJoin(userInfo, eq(userInfo.user_id, user.user_id))
      .where(
        and(
          isNull(user.deleted_at),
          isNull(userInfo.deleted_at),
          eq(user.user_status_id, EUserStatus.active),
          eq(user.account_id, accountId),
          eq(chatUser.status, EChatUserStatus.online)
        )
      )
      .limit(100)
      .execute();

    if (!result.length) {
      return [];
    }

    return result as IViewUserNamePhoto[];
  };
}
