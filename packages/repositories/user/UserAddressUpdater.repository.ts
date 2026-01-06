import * as schema from '@core/models';
import { userAddress } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { IUpdateUserAddress } from '@core/common/interfaces/IUpdateUserAddress';

@injectable()
export class UserAddressUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  private updateInput(
    input: IUpdateUserAddress
  ): Partial<typeof userAddress.$inferInsert> {
    const inputUpdate: Partial<typeof userAddress.$inferInsert> = {};

    if (input.country_id !== undefined && input.country_id !== null) {
      inputUpdate.country_id = input.country_id;
      inputUpdate.deleted_at = null;
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

    if (input.address1_c) {
      inputUpdate.address1_c = input.address1_c;
    }

    if (input.address2) {
      inputUpdate.address2 = input.address2;
    }

    if (input.address2_partial) {
      inputUpdate.address2_partial = input.address2_partial;
    }

    if (input.address2_c) {
      inputUpdate.address2_c = input.address2_c;
    }

    if (input.city_fiscal_code !== undefined) {
      inputUpdate.city_fiscal_code = input.city_fiscal_code;
    }

    if (input.state_fiscal_code !== undefined) {
      inputUpdate.state_fiscal_code = input.state_fiscal_code;
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

    const result = await this.dbRw
      .update(userAddress)
      .set(updateInput)
      .where(eq(userAddress.user_id, userId))
      .execute();

    return result.rowCount === 1;
  };

  deleteUserAddressById = async (userId: string): Promise<boolean> => {
    const result = await this.dbRw
      .update(userAddress)
      .set({ deleted_at: new Date().toISOString() })
      .where(eq(userAddress.user_id, userId))
      .execute();

    return (result.rowCount ?? 0) >= 0;
  };

  existsUserAddressByUserId = async (userId: string): Promise<boolean> => {
    const result = await this.dbRw
      .select({ user_address_id: userAddress.user_address_id })
      .from(userAddress)
      .where(eq(userAddress.user_id, userId))
      .limit(1)
      .execute();

    return result.length > 0;
  };
}
