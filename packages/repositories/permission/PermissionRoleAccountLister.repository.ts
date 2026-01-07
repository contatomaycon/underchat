import * as schema from '@core/models';
import { permissionRole } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { IRoleAccount } from '@core/common/interfaces/IRoleAccount';

@injectable()
export class PermissionRoleAccountListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  listPermissionRoleAccountById = async (
    accountId: string
  ): Promise<IRoleAccount[]> => {
    const result = await this.dbRo
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

    return result as IRoleAccount[];
  };
}
