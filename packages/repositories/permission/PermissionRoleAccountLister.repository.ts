import * as schema from '@core/models';
import { permissionRole } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { ListRoleAccountResponse } from '@core/schema/sector/listSectorRoleAccount/response.schema';

@injectable()
export class PermissionRoleAccountListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  listPermissionRoleAccountById = async (
    accountId: string,
    isAdministrator: boolean
  ): Promise<ListRoleAccountResponse[]> => {
    const masterRoleId = '019a930d-c6f5-75af-82a5-8c20f9d0e6e2';

    if (isAdministrator) {
      const result = await this.db
        .select({
          id: permissionRole.permission_role_id,
          name: permissionRole.name,
        })
        .from(permissionRole)
        .where(
          and(
            eq(permissionRole.permission_role_id, masterRoleId),
            isNull(permissionRole.deleted_at)
          )
        )
        .execute();

      if (!result?.length) {
        return [];
      }

      return result as ListRoleAccountResponse[];
    }

    const result = await this.db
      .select({
        id: permissionRole.permission_role_id,
        name: permissionRole.name,
      })
      .from(permissionRole)
      .where(
        and(
          eq(permissionRole.account_id, accountId),
          isNull(permissionRole.deleted_at)
        )
      )
      .execute();

    if (!result?.length) {
      return [];
    }

    return result as ListRoleAccountResponse[];
  };
}
