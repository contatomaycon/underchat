import * as schema from '@core/models';
import { apiKey } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';

@injectable()
export class ApiKeyViewerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  viewApiKeyByAccountId = async (
    accountId: string
  ): Promise<{
    api_key_id: string;
    key: string;
    name: string;
    status: string;
  } | null> => {
    const result = await this.dbRo
      .select({
        api_key_id: apiKey.api_key_id,
        key: apiKey.key,
        name: apiKey.name,
        status: apiKey.status,
      })
      .from(apiKey)
      .where(and(eq(apiKey.account_id, accountId), isNull(apiKey.deleted_at)))
      .limit(1)
      .execute();

    if (!result?.length) {
      return null;
    }

    return result[0];
  };

  viewApiKeyById = async (
    apiKeyId: string
  ): Promise<{
    api_key_id: string;
    account_id: string;
    worker_id: string | null;
    key: string;
    name: string;
    status: string;
  } | null> => {
    const result = await this.dbRo
      .select({
        api_key_id: apiKey.api_key_id,
        account_id: apiKey.account_id,
        worker_id: apiKey.worker_id,
        key: apiKey.key,
        name: apiKey.name,
        status: apiKey.status,
      })
      .from(apiKey)
      .where(and(eq(apiKey.api_key_id, apiKeyId), isNull(apiKey.deleted_at)))
      .limit(1)
      .execute();

    if (!result?.length) {
      return null;
    }

    return result[0];
  };
}
