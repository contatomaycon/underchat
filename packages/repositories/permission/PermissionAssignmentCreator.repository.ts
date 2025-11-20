import * as schema from '@core/models';
import { permissionAssignment } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';

@injectable()
export class PermissionAssignmentCreatorRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  createPermissionAssignment = async (
    userId: string,
    permissionRoleId: string,
    accountId: string
  ): Promise<string | null> => {
    const permissionAssignmentId = uuidv7();

    const result = await this.db
      .insert(permissionAssignment)
      .values({
        permission_assignment_id: permissionAssignmentId,
        permission_role_id: permissionRoleId,
        user_id: userId,
        account_id: accountId,
      })
      .execute();

    if (!result) {
      return null;
    }

    return permissionAssignmentId;
  };
}

