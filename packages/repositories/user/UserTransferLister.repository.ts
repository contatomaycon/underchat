import * as schema from '@core/models';
import { user, userInfo } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, asc, eq, isNull, ne } from 'drizzle-orm';
import { TransferUserResponse } from '@core/schema/chat/listTransferUsers/response.schema';

@injectable()
export class UserTransferListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  listUsersForTransfer = async (
    accountId: string,
    excludeUserId: string
  ): Promise<TransferUserResponse[]> => {
    const result = await this.db
      .select({
        id: user.user_id,
        name: userInfo.name,
        email_partial: user.email_partial,
      })
      .from(user)
      .leftJoin(userInfo, eq(user.user_id, userInfo.user_id))
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
    }));
  };
}
