import * as schema from '@core/models';
import { inject, injectable } from 'tsyringe';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import { EUserStatus } from '@core/common/enums/EUserStatus';

@injectable()
export class MiddlewareJwtRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  async find(
    userId: string,
    routeModule: string,
    module: ERouteModule
  ): Promise<IJwtGroupHierarchy[]> {
    const query = `
      WITH UserPermissions AS (
          SELECT DISTINCT
              pa.permission_role_id,
              pa.account_id,
              pr.name AS role_name,
              pm.module AS module_name,
              paa.action AS action_name
          FROM "permission_assignment" pa
          JOIN "user" u ON u.user_id = pa.user_id AND u.user_status_id = '${EUserStatus.active}' AND u.deleted_at IS NULL
          JOIN "permission_role" pr ON pa.permission_role_id = pr.permission_role_id
          JOIN "permission_role_action" pra ON pra.permission_role_id = pr.permission_role_id
          JOIN "permission_action" paa ON paa.permission_action_id = pra.permission_action_id
          JOIN "permission_module" pm ON paa.permission_module_id = pm.module_id
          WHERE u.user_id = '${userId}'
      )
      SELECT * 
      FROM UserPermissions
      WHERE (module_name = '${routeModule}' OR module_name = '${module}');
    `;

    const result = await this.db.execute(query);

    if (result?.rowCount === 0) {
      return [] as IJwtGroupHierarchy[];
    }

    return result.rows as unknown as IJwtGroupHierarchy[];
  }
}
