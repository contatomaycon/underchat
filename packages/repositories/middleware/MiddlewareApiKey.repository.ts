import * as schema from '@core/models';
import { inject, injectable } from 'tsyringe';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { IApiKeyGroupHierarchy } from '@core/common/interfaces/IApiKeyGroupHierarchy';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';
import { EStatusApiKey } from '@core/common/enums/EStatusApiKey';

@injectable()
export class MiddlewareApiKeyRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  async find(
    keyApi: string,
    routeModule: string,
    module: ERouteModule
  ): Promise<IApiKeyGroupHierarchy[]> {
    const query = `
      SELECT DISTINCT
          ac.account_id,
          ak.api_key_id,
          ak.key AS api_key,
          ak.name,
          '${module}' AS module_name
      FROM "api_key" ak
      JOIN "account" ac ON ac.account_id = ak.account_id 
        AND ac.deleted_at IS NULL 
        AND ac.account_status_id = '${EAccountStatus.active}'
      WHERE ak.key = '${keyApi}' 
        AND ak.deleted_at IS NULL 
        AND ak.status = '${EStatusApiKey.active}';
    `;

    const result = await this.dbRo.execute(query);

    if (result?.rowCount === 0) {
      return [] as IApiKeyGroupHierarchy[];
    }

    return result.rows as unknown as IApiKeyGroupHierarchy[];
  }
}
