import * as schema from '@core/models';
import { permissionRole } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, count, eq, inArray } from 'drizzle-orm';
import { CreateSectorRoleRequest } from '@core/schema/sector/createSectorRole/request.schema';

@injectable()
export class PermissionRoleCountSectorViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  countRolesSector = async (
    accountId: string,
    rolesId: CreateSectorRoleRequest
  ): Promise<boolean> => {
    const result = await this.db
      .select({
        total: count(),
      })
      .from(permissionRole)
      .where(
        and(
          eq(permissionRole.account_id, accountId),
          inArray(permissionRole.permission_role_id, rolesId.permission_role_id)
        )
      )
      .execute();

    return result[0]?.total === rolesId.permission_role_id.length;
  };
}
