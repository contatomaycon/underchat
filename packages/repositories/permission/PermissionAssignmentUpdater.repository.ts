import * as schema from '@core/models';
import { permissionAssignment } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';

@injectable()
export class PermissionAssignmentUpdaterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  updatePermissionAssignment = async (
    userId: string,
    permissionRoleId: string,
    accountId: string
  ): Promise<boolean> => {
    const result = await this.db
      .update(permissionAssignment)
      .set({
        permission_role_id: permissionRoleId,
        account_id: accountId,
      })
      .where(eq(permissionAssignment.user_id, userId))
      .execute();

    return result.rowCount === 1;
  };
}
