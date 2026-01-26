import * as schema from '@core/models';
import { apiKey, worker } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';

@injectable()
export class IntegrationViewerByIdRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  viewIntegrationById = async (
    accountId: string,
    apiKeyId: string
  ): Promise<{
    api_key_id: string;
    key: string;
    name: string;
    status: string;
    worker_id: string | null;
    worker_name: string | null;
  } | null> => {
    const result = await this.dbRo
      .select({
        api_key_id: apiKey.api_key_id,
        key: apiKey.key,
        name: apiKey.name,
        status: apiKey.status,
        worker_id: apiKey.worker_id,
        worker_name: worker.name,
      })
      .from(apiKey)
      .leftJoin(worker, eq(worker.worker_id, apiKey.worker_id))
      .where(
        and(
          eq(apiKey.api_key_id, apiKeyId),
          eq(apiKey.account_id, accountId),
          isNull(apiKey.deleted_at)
        )
      )
      .limit(1)
      .execute();

    if (!result?.length) {
      return null;
    }

    return {
      api_key_id: result[0].api_key_id,
      key: result[0].key,
      name: result[0].name,
      status: result[0].status,
      worker_id: result[0].worker_id,
      worker_name: result[0].worker_name,
    };
  };
}
