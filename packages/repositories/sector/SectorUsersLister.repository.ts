import * as schema from '@core/models';
import {
  sectorRole,
  permissionRole,
  permissionAssignment,
  user,
  userInfo,
  chatUser,
} from '@core/models';
import { ListSectorUsersResponse } from '@core/schema/sector/listSectorUsers/response.schema';
import { and, eq, isNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class SectorUsersListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  listSectorUsers = async (
    accountId: string,
    sectorId: string
  ): Promise<ListSectorUsersResponse[]> => {
    const result = await this.db
      .select({
        user_id: user.user_id,
        email_partial: user.email_partial,
        user_info: {
          name: userInfo.name,
          last_name: userInfo.last_name,
          photo: userInfo.photo,
        },
        chat_user: {
          status: chatUser.status,
        },
      })
      .from(sectorRole)
      .innerJoin(
        permissionRole,
        eq(sectorRole.permission_role_id, permissionRole.permission_role_id)
      )
      .innerJoin(
        permissionAssignment,
        eq(
          permissionAssignment.permission_role_id,
          permissionRole.permission_role_id
        )
      )
      .innerJoin(user, eq(permissionAssignment.user_id, user.user_id))
      .leftJoin(userInfo, eq(user.user_id, userInfo.user_id))
      .leftJoin(chatUser, eq(user.user_id, chatUser.user_id))
      .where(
        and(
          eq(sectorRole.sector_id, sectorId),
          eq(permissionRole.account_id, accountId),
          eq(user.account_id, accountId),
          isNull(user.deleted_at),
          isNull(userInfo.deleted_at)
        )
      )
      .groupBy(
        user.user_id,
        user.email_partial,
        userInfo.name,
        userInfo.last_name,
        userInfo.photo,
        chatUser.status
      )
      .execute();

    if (!result?.length) {
      return [];
    }

    return result as ListSectorUsersResponse[];
  };
}
