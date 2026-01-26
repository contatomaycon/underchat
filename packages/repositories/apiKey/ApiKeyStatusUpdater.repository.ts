import * as schema from '@core/models';
import { apiKey } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { EStatusApiKey } from '@core/common/enums/EStatusApiKey';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class ApiKeyStatusUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  updateApiKeyStatus = async (
    accountId: string,
    status: EStatusApiKey
  ): Promise<boolean> => {
    const date = currentTime();

    const result = await this.dbRw
      .update(apiKey)
      .set({
        status,
        updated_at: date,
      })
      .where(and(eq(apiKey.account_id, accountId), isNull(apiKey.deleted_at)))
      .execute();

    return result.rowCount === 1;
  };
}
