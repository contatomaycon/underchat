import { IViewPermissionByUserId } from '@core/common/interfaces/IViewPermissionByUserId';
import * as schema from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class PermissionAssignmentUserViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  viewPermissionByUserId = async (
    userId: string
  ): Promise<IViewPermissionByUserId[]> => {
    const query = `
      WITH UserPermissions AS (
        SELECT DISTINCT
            paa.action AS action
        FROM "permission_assignment" pa
        JOIN "permission_role" pr ON pa.permission_role_id = pr.permission_role_id
        JOIN "permission_role_action" pra ON pra.permission_role_id = pr.permission_role_id
        JOIN "permission_action" paa ON paa.permission_action_id = pra.permission_action_id
        WHERE pa.user_id = '${userId}' AND pra.permission_action_id IS NOT NULL
        UNION
        SELECT DISTINCT
            pag.action AS action
        FROM "permission_assignment" pa
        JOIN "permission_role" pr ON pa.permission_role_id = pr.permission_role_id
        JOIN "permission_role_action" pra ON pra.permission_role_id = pr.permission_role_id
        JOIN "permission_action_groups" pag ON pag.permission_action_group_id = pra.permission_action_group_id
        WHERE pa.user_id = '${userId}' AND pra.permission_action_group_id IS NOT NULL
      )
      SELECT action
      FROM UserPermissions;
    `;

    const result = await this.db.execute(query);

    if (result?.rowCount === 0) {
      return [] as IViewPermissionByUserId[];
    }

    return result.rows as unknown as IViewPermissionByUserId[];
  };
}
