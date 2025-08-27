import * as schema from '@core/models';
import { userAddress } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { IUpdateUserAddress } from '@core/common/interfaces/IUpdateUserAddress';

@injectable()
export class UserAddressUpdaterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private updateInput(
    input: IUpdateUserAddress
  ): Partial<typeof userAddress.$inferInsert> {
    const inputUpdate: Partial<typeof userAddress.$inferInsert> = {};

    if (input.country_id) {
      inputUpdate.country_id = input.country_id;
    }

    if (input.zip_code) {
      inputUpdate.zip_code = input.zip_code;
    }

    if (input.address1) {
      inputUpdate.address1 = input.address1;
    }

    if (input.address1_partial) {
      inputUpdate.address1_partial = input.address1_partial;
    }

    if (input.address2) {
      inputUpdate.address2 = input.address2;
    }

    if (input.address2_partial) {
      inputUpdate.address2_partial = input.address2_partial;
    }

    if (input.city) {
      inputUpdate.city = input.city;
    }

    if (input.state) {
      inputUpdate.state = input.state;
    }

    if (input.district) {
      inputUpdate.district = input.district;
    }

    return inputUpdate;
  }

  updateUserAddressById = async (
    userId: string,
    input: IUpdateUserAddress
  ): Promise<boolean> => {
    const updateInput = this.updateInput(input);

    const result = await this.db
      .update(userAddress)
      .set(updateInput)
      .where(eq(userAddress.user_id, userId))
      .execute();

    return result.rowCount === 1;
  };
}
