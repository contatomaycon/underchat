import * as schema from '@core/models';
import { permissionRole } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';

@injectable()
export class RoleUpdaterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  updateRoleById = async (
    roleId: string,
    roleName: string,
    accountId: string
  ): Promise<string | null> => {
    const result = await this.db
      .update(permissionRole)
      .set({
        name: roleName,
      })
      .where(
        and(
          eq(permissionRole.permission_role_id, roleId),
          eq(permissionRole.account_id, accountId)
        )
      )
      .execute();

    if (result.rowCount === 0) {
      return null;
    }

    return accountId;
  };
}
