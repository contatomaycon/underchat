import * as schema from '@core/models';
import { permissionRole } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { ViewRoleResponse } from '@core/schema/role/viewRole/response.schema';

@injectable()
export class RoleViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  viewRoleById = async (
    roleId: number,
    accountId: number
  ): Promise<ViewRoleResponse | null> => {
    const result = await this.db
      .select({
        permission_role_id: permissionRole.permission_role_id,
        name: permissionRole.name,
        created_at: permissionRole.created_at,
      })
      .from(permissionRole)
      .where(
        and(
          eq(permissionRole.permission_role_id, roleId),
          eq(permissionRole.account_id, accountId),
          isNull(permissionRole.deleted_at)
        )
      )
      .execute();

    if (!result?.length) {
      return null;
    }

    return result[0] as ViewRoleResponse;
  };
}
