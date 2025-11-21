import * as schema from '@core/models';
import { permissionAssignment } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';

@injectable()
export class PermissionAssignmentViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  getUserRole = async (userId: string): Promise<string | null> => {
    const result = await this.db
      .select({
        permission_role_id: permissionAssignment.permission_role_id,
      })
      .from(permissionAssignment)
      .where(eq(permissionAssignment.user_id, userId))
      .limit(1)
      .execute();

    if (!result.length) {
      return null;
    }

    return result[0].permission_role_id;
  };
}
