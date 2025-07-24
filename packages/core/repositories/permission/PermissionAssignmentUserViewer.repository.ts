import { IViewPermissionByUserId } from '@core/common/interfaces/IViewPermissionByUserId';
import * as schema from '@core/models';
import {
  permissionAssignment,
  permissionRole,
  permissionRoleAction,
  permissionAction,
} from '@core/models';
import { and, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class PermissionAssignmentUserViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  viewPermissionByUserId = async (
    userId: number
  ): Promise<IViewPermissionByUserId[]> => {
    const result = await this.db
      .select({
        action: permissionAction.action,
      })
      .from(permissionAssignment)
      .innerJoin(
        permissionRole,
        eq(
          permissionRole.permission_role_id,
          permissionAssignment.permission_role_id
        )
      )
      .innerJoin(
        permissionRoleAction,
        and(
          eq(
            permissionRoleAction.permission_role_id,
            permissionRole.permission_role_id
          )
        )
      )
      .innerJoin(
        permissionAction,
        and(
          eq(
            permissionAction.permission_action_id,
            permissionRoleAction.permission_action_id
          )
        )
      )
      .where(and(eq(permissionAssignment.user_id, userId)))
      .execute();

    if (!result.length) {
      return [] as IViewPermissionByUserId[];
    }

    return result as IViewPermissionByUserId[];
  };
}
