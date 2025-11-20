import * as schema from '@core/models';
import { permissionAssignment } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, count, eq } from 'drizzle-orm';

@injectable()
export class PermissionAssignmentExistsRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  existsPermissionAssignment = async (
    userId: string,
    permissionRoleId: string
  ): Promise<boolean> => {
    const result = await this.db
      .select({
        total: count(),
      })
      .from(permissionAssignment)
      .where(
        and(
          eq(permissionAssignment.user_id, userId),
          eq(permissionAssignment.permission_role_id, permissionRoleId)
        )
      )
      .execute();

    if (!result.length) {
      return false;
    }

    return result[0].total > 0;
  };
}
