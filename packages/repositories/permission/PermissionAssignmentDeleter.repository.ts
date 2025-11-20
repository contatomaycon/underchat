import * as schema from '@core/models';
import { permissionAssignment } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';

@injectable()
export class PermissionAssignmentDeleterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  deletePermissionAssignmentByUserId = async (
    userId: string
  ): Promise<boolean> => {
    const result = await this.db
      .delete(permissionAssignment)
      .where(eq(permissionAssignment.user_id, userId))
      .execute();

    return (result.rowCount ?? 0) > 0;
  };
}

