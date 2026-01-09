import * as schema from '@core/models';
import { userAddress } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
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
    let hasAnyField = false;

    if (
      input.country_id !== undefined &&
      input.country_id !== null &&
      input.country_id !== 0
    ) {
      inputUpdate.country_id = input.country_id;
      hasAnyField = true;
    }

    if (input.zip_code !== undefined) {
      inputUpdate.zip_code = input.zip_code;
      hasAnyField = true;
    }

    if (input.address1 !== undefined) {
      inputUpdate.address1 = input.address1;
      hasAnyField = true;
    }

    if (input.address1_partial !== undefined) {
      inputUpdate.address1_partial = input.address1_partial;
      hasAnyField = true;
    }

    if (input.address1_c !== undefined) {
      inputUpdate.address1_c = input.address1_c;
      hasAnyField = true;
    }

    if (input.address2 !== undefined) {
      inputUpdate.address2 = input.address2;
      hasAnyField = true;
    }

    if (input.address2_partial !== undefined) {
      inputUpdate.address2_partial = input.address2_partial;
      hasAnyField = true;
    }

    if (input.address2_c !== undefined) {
      inputUpdate.address2_c = input.address2_c;
      hasAnyField = true;
    }

    if (input.city_fiscal_code !== undefined) {
      inputUpdate.city_fiscal_code = input.city_fiscal_code;
      hasAnyField = true;
    }

    if (input.state_fiscal_code !== undefined) {
      inputUpdate.state_fiscal_code = input.state_fiscal_code;
      hasAnyField = true;
    }

    if (input.district !== undefined) {
      inputUpdate.district = input.district;
      hasAnyField = true;
    }

    if (hasAnyField) {
      inputUpdate.deleted_at = null;
    }

    return inputUpdate;
  }

  updateUserAddressById = async (
    userId: string,
    input: IUpdateUserAddress
  ): Promise<boolean> => {
    const updateInput = this.updateInput(input);

    const hasFields = Object.keys(updateInput).length > 0;
    if (!hasFields) {
      return false;
    }

    const result = await this.dbRw
      .update(userAddress)
      .set(updateInput)
      .where(eq(userAddress.user_id, userId))
      .execute();

    return (result.rowCount ?? 0) > 0;
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
      .where(
        and(eq(userAddress.user_id, userId), isNull(userAddress.deleted_at))
      )
      .limit(1)
      .execute();

    return result.length > 0;
  };
}
