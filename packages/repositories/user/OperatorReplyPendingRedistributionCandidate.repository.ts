import * as schema from '@core/models';
import { user, userInfo } from '@core/models';
import { EUserStatus } from '@core/common/enums/EUserStatus';
import { IViewUserNamePhoto } from '@core/common/interfaces/IViewUserNamePhoto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class OperatorReplyPendingRedistributionCandidateRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  async listActiveUsers(accountId: string): Promise<IViewUserNamePhoto[]> {
    const result = await this.dbRo
      .select({
        id: user.user_id,
        name: userInfo.name,
        photo: userInfo.photo,
      })
      .from(user)
      .leftJoin(userInfo, eq(userInfo.user_id, user.user_id))
      .where(
        and(
          eq(user.account_id, accountId),
          eq(user.user_status_id, EUserStatus.active),
          isNull(user.deleted_at),
          isNull(userInfo.deleted_at)
        )
      )
      .orderBy(asc(user.user_id))
      .execute();

    return result.map((candidate) => ({
      id: candidate.id,
      name: candidate.name ?? '',
      photo: candidate.photo ?? null,
    }));
  }
}
