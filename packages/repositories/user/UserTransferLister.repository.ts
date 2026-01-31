import * as schema from '@core/models';
import { user, userInfo } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { TransferUserResponse } from '@core/schema/chat/listTransferUsers/response.schema';
import { PresenceService } from '@core/services/presence.service';

@injectable()
export class UserTransferListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>,
    private readonly presenceService: PresenceService
  ) {}

  listUsersForTransfer = async (
    accountId: string
  ): Promise<TransferUserResponse[]> => {
    const result = await this.dbRo
      .select({
        id: user.user_id,
        name: userInfo.name,
        last_name: userInfo.last_name,
        nickname: user.email_partial,
        email_partial: user.email_partial,
        photo: userInfo.photo,
      })
      .from(user)
      .leftJoin(userInfo, eq(user.user_id, userInfo.user_id))
      .where(
        and(
          eq(user.account_id, accountId),
          isNull(user.deleted_at),
          isNull(userInfo.deleted_at)
        )
      )
      .orderBy(asc(user.email_partial))
      .execute();

    if (!result || result.length === 0) {
      return [];
    }

    const usersWithStatus = await Promise.all(
      result.map(async (user) => {
        const status = await this.presenceService.getStatus(user.id);
        return {
          id: user.id,
          name: user.name || user.email_partial || '',
          last_name: user.last_name || null,
          nickname: user.nickname || user.email_partial || null,
          photo: user.photo || null,
          status: status || null,
        };
      })
    );

    return usersWithStatus;
  };
}
