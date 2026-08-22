import { EPermissionRoleStatus } from '@core/common/enums/EPermissionRoleStatus';
import { EUserStatus } from '@core/common/enums/EUserStatus';
import type { ListAllUsersResponse } from '@core/schema/user/listAllUsers/response.schema';
import * as schema from '@core/models';
import {
  account,
  permissionAssignment,
  permissionRole,
  sector,
  user,
  userInfo,
  worker,
} from '@core/models';
import { and, countDistinct, eq, inArray, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class PublicUserScopeRepository {
  constructor(
    @inject('DatabaseRo')
    private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  async listActiveUsers(accountId: string): Promise<ListAllUsersResponse[]> {
    const result = await this.dbRo
      .selectDistinct({
        user_id: user.user_id,
        first_name: userInfo.name,
        last_name: userInfo.last_name,
        account_id: account.account_id,
        account_name: account.name,
      })
      .from(user)
      .innerJoin(account, eq(account.account_id, user.account_id))
      .leftJoin(userInfo, eq(userInfo.user_id, user.user_id))
      .innerJoin(
        permissionAssignment,
        and(
          eq(permissionAssignment.user_id, user.user_id),
          eq(permissionAssignment.account_id, accountId)
        )
      )
      .innerJoin(
        permissionRole,
        eq(
          permissionRole.permission_role_id,
          permissionAssignment.permission_role_id
        )
      )
      .where(
        and(
          eq(user.account_id, accountId),
          eq(user.user_status_id, EUserStatus.active),
          isNull(user.deleted_at),
          isNull(userInfo.deleted_at),
          eq(permissionRole.account_id, accountId),
          eq(permissionRole.status, EPermissionRoleStatus.active),
          isNull(permissionRole.deleted_at)
        )
      )
      .execute();

    return result.map((item) => ({
      user_id: item.user_id,
      first_name: item.first_name ?? null,
      last_name: item.last_name ?? null,
      account_id: item.account_id,
      account_name: item.account_name,
    }));
  }

  async userBelongsToAccount(
    userId: string,
    accountId: string
  ): Promise<boolean> {
    const result = await this.dbRo
      .select({ user_id: user.user_id })
      .from(user)
      .where(
        and(
          eq(user.user_id, userId),
          eq(user.account_id, accountId),
          isNull(user.deleted_at)
        )
      )
      .limit(1)
      .execute();

    return result.length > 0;
  }

  async roleBelongsToAccount(
    permissionRoleId: string,
    accountId: string
  ): Promise<boolean> {
    const result = await this.dbRo
      .select({ permission_role_id: permissionRole.permission_role_id })
      .from(permissionRole)
      .where(
        and(
          eq(permissionRole.permission_role_id, permissionRoleId),
          eq(permissionRole.account_id, accountId),
          eq(permissionRole.status, EPermissionRoleStatus.active),
          isNull(permissionRole.deleted_at)
        )
      )
      .limit(1)
      .execute();

    return result.length > 0;
  }

  async sectorsBelongToAccount(
    sectorIds: string[],
    accountId: string
  ): Promise<boolean> {
    const uniqueSectorIds = [...new Set(sectorIds)];
    if (uniqueSectorIds.length === 0) return true;

    const result = await this.dbRo
      .select({ total: countDistinct(sector.sector_id) })
      .from(sector)
      .where(
        and(
          inArray(sector.sector_id, uniqueSectorIds),
          eq(sector.account_id, accountId),
          isNull(sector.deleted_at)
        )
      )
      .execute();

    return Number(result[0]?.total ?? 0) === uniqueSectorIds.length;
  }

  async channelsBelongToAccount(
    channelIds: string[],
    accountId: string
  ): Promise<boolean> {
    const uniqueChannelIds = [...new Set(channelIds)];
    if (uniqueChannelIds.length === 0) return true;

    const result = await this.dbRo
      .select({ total: countDistinct(worker.worker_id) })
      .from(worker)
      .where(
        and(
          inArray(worker.worker_id, uniqueChannelIds),
          eq(worker.account_id, accountId),
          isNull(worker.deleted_at)
        )
      )
      .execute();

    return Number(result[0]?.total ?? 0) === uniqueChannelIds.length;
  }
}
