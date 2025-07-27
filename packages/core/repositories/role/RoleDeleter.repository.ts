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
    accountId: string
  ): Promise<boolean> => {
    const date = currentTime();

    const result = await this.db
      .update(permissionRole)
      .set({
        deleted_at: date,
      })
      .where(
        and(
          eq(permissionRole.permission_role_id, roleId),
          eq(permissionRole.account_id, accountId)
        )
      )
      .execute();

    return result.rowCount === 1;
  };
}
