import * as schema from '@core/models';
import { permissionRole } from '@core/models';
import { EPermissionRoleStatus } from '@core/common/enums/EPermissionRoleStatus';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { ListReleasePermissionRolesResponse } from '@core/schema/release/listReleasePermissionRoles/response.schema';

@injectable()
export class ReleasePermissionRolesListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  listReleasePermissionRoles = async (
    accountId: string
  ): Promise<ListReleasePermissionRolesResponse> => {
    const result = await this.dbRo
      .select({
        id: permissionRole.permission_role_id,
        name: permissionRole.name,
      })
      .from(permissionRole)
      .where(
        and(
          eq(permissionRole.account_id, accountId),
          eq(permissionRole.status, EPermissionRoleStatus.active),
          isNull(permissionRole.deleted_at)
        )
      )
      .execute();

    if (!result || result.length === 0) {
      return [];
    }

    return result;
  };
}
