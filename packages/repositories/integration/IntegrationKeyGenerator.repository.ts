import * as schema from '@core/models';
import { apiKey } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class IntegrationKeyGeneratorRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  generateNewKey = async (
    accountId: string,
    apiKeyId: string
  ): Promise<string | null> => {
    const newKey = randomBytes(16).toString('hex');
    const date = currentTime();

    const result = await this.dbRw
      .update(apiKey)
      .set({
        key: newKey,
        updated_at: date,
      })
      .where(
        and(
          eq(apiKey.api_key_id, apiKeyId),
          eq(apiKey.account_id, accountId),
          isNotNull(apiKey.worker_id),
          isNull(apiKey.deleted_at)
        )
      )
      .execute();

    if (result.rowCount !== 1) {
      return null;
    }

    return newKey;
  };
}
