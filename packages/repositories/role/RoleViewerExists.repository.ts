import * as schema from '@core/models';
import { permissionRole } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, count, eq, isNull } from 'drizzle-orm';

@injectable()
export class RoleViewerExistsRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  existsRoleById = async (
    roleId: string,
    accountId: string,
    isAdministrator: boolean
  ): Promise<boolean> => {
    const accountCondition = isAdministrator
      ? undefined
      : eq(permissionRole.account_id, accountId);

    const result = await this.db
      .select({
        total: count(),
      })
      .from(permissionRole)
      .where(
        and(
          accountCondition,
          eq(permissionRole.permission_role_id, roleId),
          isNull(permissionRole.deleted_at)
        )
      )
      .execute();

    if (!result.length) {
      return false;
    }

    return result[0].total > 0;
  };
}
