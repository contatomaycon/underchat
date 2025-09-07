import * as schema from '@core/models';
import { inject, injectable } from 'tsyringe';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { IApiKeyGroupHierarchy } from '@core/common/interfaces/IApiKeyGroupHierarchy';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';

@injectable()
export class MiddlewareApiKeyRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  async find(
    keyApi: string,
    routeModule: string,
    module: ERouteModule
  ): Promise<IApiKeyGroupHierarchy[]> {
    const query = `
      WITH UserPermissions AS (
        SELECT DISTINCT
            ac.account_id,
            pa.permission_role_id,
            ak.api_key_id,
            ak.key AS api_key,
            ak.name,
            pr.name AS role_name,
            pm.module AS module_name,
            paa.action AS action_name
        FROM "permission_assignment" pa
        JOIN "api_key" ak ON ak.account_id =  pa.account_id AND ak.deleted_at IS NULL
        JOIN "account" ac ON ac.account_id =  ak.account_id AND ac.deleted_at IS NULL AND ac.account_status_id = '${EAccountStatus.active}'
        JOIN "permission_role" pr ON pa.permission_role_id = pr.permission_role_id
        JOIN "permission_role_action" pra ON pra.permission_role_id = pr.permission_role_id
        JOIN "permission_action" paa ON paa.permission_action_id = pra.permission_action_id
        JOIN "permission_module" pm ON paa.permission_module_id = pm.module_id
        WHERE ak.key = '${keyApi}'
      )
      SELECT *
      FROM UserPermissions
      WHERE (module_name = '${routeModule}' OR module_name = '${module}');
    `;

    const result = await this.db.execute(query);

    if (result?.rowCount === 0) {
      return [] as IApiKeyGroupHierarchy[];
    }

    return result.rows as unknown as IApiKeyGroupHierarchy[];
  }
}
