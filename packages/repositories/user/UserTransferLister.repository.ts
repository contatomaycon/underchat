import * as schema from '@core/models';
import { user, userInfo, chatUser } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, asc, eq, isNull, ne } from 'drizzle-orm';
import { TransferUserResponse } from '@core/schema/chat/listTransferUsers/response.schema';

@injectable()
export class UserTransferListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  listUsersForTransfer = async (
    accountId: string,
    excludeUserId: string
  ): Promise<TransferUserResponse[]> => {
    const result = await this.dbRo
      .select({
        id: user.user_id,
        name: userInfo.name,
        email_partial: user.email_partial,
        photo: userInfo.photo,
        status: chatUser.status,
      })
      .from(user)
      .leftJoin(userInfo, eq(user.user_id, userInfo.user_id))
      .leftJoin(chatUser, eq(user.user_id, chatUser.user_id))
      .where(
        and(
          eq(user.account_id, accountId),
          isNull(user.deleted_at),
          ne(user.user_id, excludeUserId),
          isNull(userInfo.deleted_at)
        )
      )
      .orderBy(asc(user.email_partial))
      .execute();

    if (!result || result.length === 0) {
      return [];
    }

    return result.map((user) => ({
      id: user.id,
      name: user.name || user.email_partial || '',
      photo: user.photo || null,
      status: user.status || null,
    }));
  };
}
