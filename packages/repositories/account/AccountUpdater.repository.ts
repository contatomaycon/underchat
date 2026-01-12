import * as schema from '@core/models';
import { account } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { UpdateAccountRequest } from '@core/schema/account/editAccount/request.schema';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class AccountUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
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

    if (
      input.generate_invoice !== undefined &&
      input.generate_invoice !== null
    ) {
      inputUpdate.generate_invoice = input.generate_invoice;
    }

    return inputUpdate;
  }

  updateAccountById = async (
    input: UpdateAccountRequest,
    accountId: string
  ): Promise<boolean> => {
    const updateInput = this.updateInput(input);

    const result = await this.dbRw
      .update(account)
      .set(updateInput)
      .where(eq(account.account_id, accountId))
      .execute();

    return result.rowCount === 1;
  };

  updateAccountStatusById = async (
    accountId: string,
    accountStatusId: string
  ): Promise<boolean> => {
    const result = await this.dbRw
      .update(account)
      .set({
        account_status_id: accountStatusId,
        updated_at: currentTime(),
      })
      .where(eq(account.account_id, accountId))
      .execute();

    return (result.rowCount ?? 0) > 0;
  };
}
