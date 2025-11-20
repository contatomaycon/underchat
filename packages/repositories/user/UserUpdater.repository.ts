import * as schema from '@core/models';
import { user } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';
import { IUpdateUser } from '@core/common/interfaces/IUpdateUser';

@injectable()
export class UserUpdaterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private updateInput(input: IUpdateUser): Partial<typeof user.$inferInsert> {
    const inputUpdate: Partial<typeof user.$inferInsert> = {};

    if (input.user_status_id) {
      inputUpdate.user_status_id = input.user_status_id;
    }

    if (input.email) {
      inputUpdate.email = input.email;
    }

    if (input.email_partial) {
      inputUpdate.email_partial = input.email_partial;
    }

    if (input.email_c) {
      inputUpdate.email_c = input.email_c;
    }

    if (input.password) {
      inputUpdate.password = input.password;
    }

    if (input.account_id) {
      inputUpdate.account_id = input.account_id;
    }

    return inputUpdate;
  }

  updateUserById = async (
    userId: string,
    input: IUpdateUser,
    accountId: string,
    isAdministrator: boolean
  ): Promise<boolean> => {
    const updateInput = this.updateInput(input);

    const whereCondition = isAdministrator && input.account_id
      ? eq(user.user_id, userId)
      : and(eq(user.user_id, userId), eq(user.account_id, accountId));

    const result = await this.db
      .update(user)
      .set(updateInput)
      .where(whereCondition)
      .execute();

    return result.rowCount === 1;
  };
}
