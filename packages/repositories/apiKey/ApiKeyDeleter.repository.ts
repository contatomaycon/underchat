import * as schema from '@core/models';
import { apiKey } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class ApiKeyDeleterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  deleteApiKeyById = async (accountId: string): Promise<boolean> => {
    const date = currentTime();

    const result = await this.db
      .update(apiKey)
      .set({
        deleted_at: date,
      })
      .where(eq(apiKey.account_id, accountId))
      .execute();

    return result.rowCount === 1;
  };
}
