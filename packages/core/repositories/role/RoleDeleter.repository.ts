import * as schema from '@core/models';
import { permissionRole } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class RoleDeleterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  deleteRoleById = async (
    roleId: string,
    accountId: string,
    isAdministrator: boolean
  ): Promise<boolean> => {
    const date = currentTime();
    const accountCondition = isAdministrator
      ? undefined
      : eq(permissionRole.account_id, accountId);

    const result = await this.db
      .update(permissionRole)
      .set({
        deleted_at: date,
      })
      .where(
        and(accountCondition, eq(permissionRole.permission_role_id, roleId))
      )
      .execute();

    return result.rowCount === 1;
  };
}
