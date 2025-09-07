import * as schema from '@core/models';
import { permissionRole, account } from '@core/models';
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
    roleId: string,
    accountId: string,
    isAdministrator: boolean
  ): Promise<ViewRoleResponse | null> => {
    const accountCondition = isAdministrator
      ? undefined
      : eq(permissionRole.account_id, accountId);

    const result = await this.db
      .select({
        permission_role_id: permissionRole.permission_role_id,
        name: permissionRole.name,
        account: {
          id: account.account_id,
          name: account.name,
        },
        created_at: permissionRole.created_at,
      })
      .from(permissionRole)
      .leftJoin(account, eq(permissionRole.account_id, account.account_id))
      .where(
        and(
          accountCondition,
          eq(permissionRole.permission_role_id, roleId),
          isNull(permissionRole.deleted_at)
        )
      )
      .execute();

    if (!result?.length) {
      return null;
    }

    const item = result[0] as ViewRoleResponse;

    return {
      permission_role_id: item.permission_role_id,
      name: item.name,
      account: isAdministrator ? item.account : undefined,
      created_at: item.created_at,
    };
  };
}
