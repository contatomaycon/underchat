import * as schema from '@core/models';
import { apiKey } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class IntegrationDeleterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  deleteIntegration = async (
    accountId: string,
    apiKeyId: string
  ): Promise<boolean> => {
    const date = currentTime();

    const result = await this.dbRw
      .update(apiKey)
      .set({
        deleted_at: date,
      })
      .where(
        and(
          eq(apiKey.api_key_id, apiKeyId),
          eq(apiKey.account_id, accountId),
          isNull(apiKey.deleted_at)
        )
      )
      .execute();

    return result.rowCount === 1;
  };
}
