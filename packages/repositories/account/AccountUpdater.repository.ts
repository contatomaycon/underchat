import * as schema from '@core/models';
import { account } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { UpdateAccountRequest } from '@core/schema/account/editAccount/request.schema';

@injectable()
export class AccountUpdaterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private updateInput(
    input: UpdateAccountRequest
  ): Partial<typeof account.$inferInsert> {
    const inputUpdate: Partial<typeof account.$inferInsert> = {};

    if (input.name) {
      inputUpdate.name = input.name;
    }

    if (input.account_status?.account_status_id) {
      inputUpdate.account_status_id = input.account_status.account_status_id;
    }

    if (input.plan?.plan_id) {
      inputUpdate.plan_id = input.plan.plan_id;
    }

    return inputUpdate;
  }

  updateAccountById = async (
    input: UpdateAccountRequest,
    accountId: string
  ): Promise<boolean> => {
    const updateInput = this.updateInput(input);

    const result = await this.db
      .update(account)
      .set(updateInput)
      .where(eq(account.account_id, accountId))
      .execute();

    return result.rowCount === 1;
  };
}
