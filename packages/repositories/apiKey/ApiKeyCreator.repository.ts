import * as schema from '@core/models';
import { apiKey } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'crypto';

@injectable()
export class ApiKeyCreatorRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  createApiKey = async (
    accountId: string,
    name: string
  ): Promise<string | null> => {
    const apiKeyId = uuidv4();
    const key = randomBytes(16).toString('hex');

    const result = await this.db
      .insert(apiKey)
      .values({
        api_key_id: apiKeyId,
        account_id: accountId,
        key,
        name: name,
      })
      .execute();

    if (!result) {
      return null;
    }

    return apiKeyId;
  };
}
