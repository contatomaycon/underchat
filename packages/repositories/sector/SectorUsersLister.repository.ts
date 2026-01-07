import * as schema from '@core/models';
import { sectorUser, sector, user, userInfo } from '@core/models';
import { ListSectorUsersResponse } from '@core/schema/sector/listSectorUsers/response.schema';
import { and, eq, isNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { PresenceService } from '@core/services/presence.service';

@injectable()
export class SectorUsersListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>,
    private readonly presenceService: PresenceService
  ) {}

  listSectorUsers = async (
    accountId: string,
    sectorId: string
  ): Promise<ListSectorUsersResponse[]> => {
    const result = await this.dbRo
      .select({
        user_id: user.user_id,
        email_partial: user.email_partial,
        user_info: {
          name: userInfo.name,
          last_name: userInfo.last_name,
          photo: userInfo.photo,
        },
      })
      .from(sectorUser)
      .innerJoin(sector, eq(sectorUser.sector_id, sector.sector_id))
      .innerJoin(user, eq(sectorUser.user_id, user.user_id))
      .leftJoin(userInfo, eq(user.user_id, userInfo.user_id))
      .where(
        and(
          eq(sectorUser.sector_id, sectorId),
          eq(sector.account_id, accountId),
          eq(user.account_id, accountId),
          isNull(sectorUser.deleted_at),
          isNull(sector.deleted_at),
          isNull(user.deleted_at),
          isNull(userInfo.deleted_at)
        )
      )
      .groupBy(
        user.user_id,
        user.email_partial,
        userInfo.name,
        userInfo.last_name,
        userInfo.photo
      )
      .execute();

    if (!result?.length) {
      return [];
    }

    const usersWithStatus = await Promise.all(
      result.map(async (row) => {
        const status = await this.presenceService.getStatus(row.user_id);
        return {
          ...row,
          chat_user: {
            status: status,
          },
        };
      })
    );

    return usersWithStatus as ListSectorUsersResponse[];
  };
}
