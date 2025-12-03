import * as schema from '@core/models';
import { account } from '@core/models';
import { CreateAccountRequest } from '@core/schema/account/createAccount/request.schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';

@injectable()
export class AccountCreatorRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  createAccount = async (
    input: CreateAccountRequest
  ): Promise<string | null> => {
    const accountId = uuidv7();

    const result = await this.db
      .insert(account)
      .values({
        account_id: accountId,
        account_status_id: input.account_status.account_status_id,
        name: input.name,
      })
      .execute();

    if (!result) {
      return null;
    }

    return accountId;
  };
}
