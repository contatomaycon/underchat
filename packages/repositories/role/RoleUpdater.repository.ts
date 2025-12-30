import * as schema from '@core/models';
import { permissionRole } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';

@injectable()
export class RoleUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  updateRoleById = async (
    roleId: string,
    roleName: string,
    accountId: string,
    description: string | null | undefined
  ): Promise<string | null> => {
    const result = await this.dbRw
      .update(permissionRole)
      .set({
        name: roleName,
        description: description ?? null,
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
