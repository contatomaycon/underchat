import * as schema from '@core/models';
import { userInfo } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { IUpdateUserInfo } from '@core/common/interfaces/IUpdateUserInfo';

@injectable()
export class UserInfoUpdaterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private updateInput(
    input: IUpdateUserInfo
  ): Partial<typeof userInfo.$inferInsert> {
    const inputUpdate: Partial<typeof userInfo.$inferInsert> = {};

    if (input.phone_ddi) {
      inputUpdate.phone_ddi = input.phone_ddi;
    }

    if (input.phone) {
      inputUpdate.phone = input.phone;
    }

    if (input.phone_partial) {
      inputUpdate.phone_partial = input.phone_partial;
    }

    if (input.name) {
      inputUpdate.name = input.name;
    }

    if (input.last_name) {
      inputUpdate.last_name = input.last_name;
    }

    if (input.birth_date) {
      inputUpdate.birth_date = input.birth_date;
    }

    return inputUpdate;
  }

  updateUserInfoById = async (
    userId: string,
    input: IUpdateUserInfo
  ): Promise<boolean> => {
    const updateInput = this.updateInput(input);

    const result = await this.db
      .update(userInfo)
      .set(updateInput)
      .where(eq(userInfo.user_id, userId))
      .execute();

    return result.rowCount === 1;
  };
}
